// track.js — procedural endless track as plain data (brief section 6). No Three.js
// objects live here; render.js maps this data onto pooled meshes each frame.
//
// The track is a sequence of short "segments" along z (forward distance). Each
// segment records the world-space lateral position of the track's CENTERLINE at
// its start and end (cx0/cx1) and the track width at its start and end (w0/w1).
// The ball's lateral offset is always relative to the centerline, so curves bend
// the world without changing the control model (brief section 6, item 2).

import {
  SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND, BASE_TRACK_WIDTH, MIN_TRACK_WIDTH,
  NARROW_STEP, CURVES_ENABLED, CURVE_SEGMENTS, CURVE_LATERAL_PER_SEGMENT, OBSTACLE_MIN_GAP, BALL_DIAMETER,
  OBSTACLE_SIZE, OBSTACLE_REACH_SAFETY_FACTOR, OBSTACLE_MIN_STRAIGHT_AFTER, LATERAL_MAX_SPEED_BASE,
  LATERAL_SPEED_SCALE_WITH_FORWARD, TUNNEL_SEGMENTS, TUNNEL_MIN_STRAIGHT_AFTER, difficultyConfig,
  OBSTACLE_FIRST_EVENT_MIN_M, OBSTACLE_FIRST_EVENT_MAX_M, OBSTACLE_EVENT_GAP_BASE_M,
  OBSTACLE_EVENT_GAP_JITTER_FRAC, OBSTACLE_EVENT_GAP_SHRINK_PER_TIER, OBSTACLE_EVENT_GAP_MIN_M,
  DEBUG_ASSERTIONS,
} from './config.js';

/** Deterministic RNG (mulberry32), kept behind one function so runs could be seeded later. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [key, w] of entries) { r -= w; if (r <= 0) return key; }
  return entries[entries.length - 1][0];
}

export class Track {
  constructor(difficultyKey, seed) {
    this.difficultyKey = difficultyKey;
    this.cfg = difficultyConfig(difficultyKey);
    this.rng = makeRng(seed >>> 0 || 1);
    this.segments = []; // ordered by index, contiguous z coverage from segments[0].z0
    this.nextIndex = 0;
    this.frontZ = 0; // z up to which segments have been generated
    // First tunnel is due one full cadence interval into the run (brief section
    // 6: "spawn cadence: roughly every N meters"); tunnelSpacingMeters IS that
    // interval, for the first tunnel and every one after.
    this.lastTunnelZ = 0;
    this.straightsOwed = 6; // guarantee a safe, obstacle-free start (also reused after tunnels)
    this.lastWasTunnel = false;
    this.pendingObstacleGapCenter = null; // previous obstacle row's gap center, for reachability chaining

    // Distance-paced obstacle scheduler (Matt's second-playthrough item 2): the first event is
    // guaranteed inside the 40-60m window on every run, every difficulty, independent of the RNG's
    // weighted-random draws (which only decide event *shape* now, not occurrence). The due check
    // in generateEvent() can overshoot its threshold by up to one SEGMENT_LENGTH before it fires,
    // so the draw itself stays SEGMENT_LENGTH short of the window's true max to leave room for that.
    const firstEventMax = OBSTACLE_FIRST_EVENT_MAX_M - SEGMENT_LENGTH;
    this.nextObstacleZ = OBSTACLE_FIRST_EVENT_MIN_M + this.rng() * (firstEventMax - OBSTACLE_FIRST_EVENT_MIN_M);
    // Only the FIRST event has a hard window (brief: "first obstacle event must occur within
    // 40-60m ... every run, every difficulty"); later cadence just needs to be "sensible" per the
    // gap constants, jitter and all, so the worst-case-span veto in generateEvent() (which forces
    // single-segment stepping to avoid overshoot) only applies until this fires once. Without this
    // scoping, hard's tight cadence (shrinking toward OBSTACLE_EVENT_GAP_MIN_M) would end up
    // vetoing curve/narrow events for the entire run, since their worst-case span alone exceeds
    // the gap between events (found via a generated-track audit).
    this._firstObstaclePending = true;

    this._cx = 0; // running centerline X as segments are appended
    this._width = BASE_TRACK_WIDTH * BALL_DIAMETER;

    // Reachability check (brief section 6, item 4): the gap in row N+1 must be
    // laterally reachable from row N's gap at max lateral speed, given forward
    // speed. Rows within an event are one SEGMENT_LENGTH apart; bound the
    // reachable distance using cfg.maxSpeed (the worst case, since actual speed
    // is never higher), so the guarantee holds for the whole run, not just at
    // the current instant. A damping ramp-up means the ball never truly holds
    // max lateral speed for the whole interval, hence the safety factor.
    const lateralMaxAtCap = LATERAL_MAX_SPEED_BASE * (1 + LATERAL_SPEED_SCALE_WITH_FORWARD * (this.cfg.maxSpeed / this.cfg.baseSpeed - 1));
    const timeBetweenRows = SEGMENT_LENGTH / this.cfg.maxSpeed;
    this.reachBW = Math.max(OBSTACLE_MIN_GAP, (lateralMaxAtCap * timeBetweenRows * OBSTACLE_REACH_SAFETY_FACTOR) / BALL_DIAMETER);

    this.ensureAhead(SEGMENTS_AHEAD * SEGMENT_LENGTH);
  }

  // --- Generation -------------------------------------------------------

  /** Keep segments generated up to `zFront` ahead of the current position. */
  ensureAhead(zFront) {
    while (this.frontZ < zFront) this.generateEvent();
  }

  /** Drop segments that have fully scrolled behind `zBack` (data-level recycling). */
  trimBehind(zBack) {
    let cut = 0;
    while (cut < this.segments.length && this.segments[cut].z1 < zBack) cut++;
    if (cut > 0) this.segments.splice(0, cut);
  }

  generateEvent() {
    const cfg = this.cfg;
    // 'curve' is dropped from the pool entirely when CURVES_ENABLED is false (item 1's A/B
    // switch); pickWeighted's total is computed from whatever keys are present, so the remaining
    // straight/narrow weights renormalize automatically, no manual rebalancing needed.
    const weights = CURVES_ENABLED ? cfg.weights : { straight: cfg.weights.straight, narrow: cfg.weights.narrow };
    let type = pickWeighted(this.rng, weights);

    // Tunnels are on a deterministic meter cadence (brief section 6: "spawn
    // cadence: roughly every N meters"), not a rare weighted-random pick -
    // otherwise the actual time-to-first-tunnel is dominated by RNG luck
    // rather than tunnelSpacingMeters. Force one in as soon as it's due;
    // global sanity rules still apply (never two back-to-back, no tunnel
    // during the guaranteed-straight buffer at run start or after a tunnel).
    const tunnelDue = !this.lastWasTunnel && this.frontZ - this.lastTunnelZ >= cfg.tunnelSpacingMeters;
    if (tunnelDue) type = 'tunnel';

    // Obstacle occurrence is distance-paced, not weighted-random (item 2): fire as soon as this
    // event's start distance reaches the scheduled threshold. Tunnel wins if both are due on the
    // same tick; the obstacle stays due and fires on the very next event instead.
    const obstacleDue = type !== 'tunnel' && this.frontZ >= this.nextObstacleZ;
    if (obstacleDue) type = 'obstacle';

    // A multi-segment event (curve/narrow) can span up to ~20m in one generateEvent() call, and
    // the due check above only runs once per call - so a long event picked just before the
    // threshold could sail straight past it (this is what let the first obstacle land outside its
    // guaranteed window before this fix). Only step down to a single short segment when the
    // SPECIFIC type just picked would actually overshoot, not for the whole approach window, so
    // curves/narrows still generate normally right up until they'd cross the line. Scoped to the
    // first event only (see this._firstObstaclePending) so a tight later cadence can't veto curves
    // for the rest of the run.
    if (this._firstObstaclePending && !obstacleDue && type !== 'tunnel') {
      const worstCaseSpanM = type === 'curve' ? CURVE_SEGMENTS * SEGMENT_LENGTH
        : type === 'narrow' ? 11 * SEGMENT_LENGTH // taper(3) + hold(up to 5) + taper(3)
        : 3 * SEGMENT_LENGTH; // straight, worst case
      if (this.frontZ + worstCaseSpanM > this.nextObstacleZ) type = 'straight-step';
    }

    if (this.straightsOwed > 0) { type = 'straight'; this.straightsOwed--; }

    if (type === 'straight') this.emitStraight();
    else if (type === 'straight-step') this.emitStraight(1);
    else if (type === 'curve') this.emitCurve();
    else if (type === 'narrow') this.emitNarrow();
    else if (type === 'obstacle') this.emitObstacleRows();
    else if (type === 'tunnel') this.emitTunnel();
    else this.emitStraight();

    this.lastWasTunnel = type === 'tunnel';
  }

  /** Meters until the next obstacle event, from `estimatedTier` speed tiers in (mild shrink per tier, floored). */
  rollObstacleGap() {
    const base = OBSTACLE_EVENT_GAP_BASE_M[this.difficultyKey] || OBSTACLE_EVENT_GAP_BASE_M.medium;
    // Tier isn't tracked here (that's sim.js's job); approximate it from distance travelled versus
    // this difficulty's tunnel cadence, since tiers are gained roughly once per tunnelSpacingMeters.
    const estimatedTier = Math.floor(this.frontZ / this.cfg.tunnelSpacingMeters);
    const shrunk = base * Math.pow(OBSTACLE_EVENT_GAP_SHRINK_PER_TIER, estimatedTier);
    const gap = Math.max(OBSTACLE_EVENT_GAP_MIN_M, shrunk);
    const jitter = gap * OBSTACLE_EVENT_GAP_JITTER_FRAC;
    return gap + (this.rng() * 2 - 1) * jitter;
  }

  pushSegment(fields) {
    const z0 = this.frontZ;
    const z1 = z0 + SEGMENT_LENGTH;
    const seg = {
      index: this.nextIndex++,
      z0, z1,
      cx0: this._cx,
      cx1: this._cx + (fields.dcx || 0),
      w0: this._width,
      w1: this._width + (fields.dw || 0),
      type: fields.type,
      isTunnel: !!fields.isTunnel,
      obstacles: fields.obstacles || null,
      showSpeedLabel: !!fields.showSpeedLabel,
    };
    this._cx = seg.cx1;
    this._width = Math.max(MIN_TRACK_WIDTH * BALL_DIAMETER, seg.w1);
    this.frontZ = z1;
    this.segments.push(seg);
    return seg;
  }

  emitStraight(count) {
    const n = count || (1 + Math.floor(this.rng() * 3));
    for (let i = 0; i < n; i++) this.pushSegment({ type: 'straight' });
  }

  emitCurve() {
    const cfg = this.cfg;
    const arc = this.rng() < cfg.curveArcChance ? CURVE_SEGMENTS : Math.ceil(CURVE_SEGMENTS / 2);
    const dir = this.rng() < 0.5 ? -1 : 1;
    const perSeg = CURVE_LATERAL_PER_SEGMENT[this.difficultyKey] || CURVE_LATERAL_PER_SEGMENT.medium;
    for (let i = 0; i < arc; i++) {
      // Ease the arc in/out (sine window) so it reads as a curve, not a kink.
      const t = (i + 0.5) / arc;
      const ease = Math.sin(t * Math.PI);
      this.pushSegment({ type: 'curve', dcx: dir * perSeg * ease });
    }
  }

  emitNarrow() {
    const current = this._width / BALL_DIAMETER;
    const target = Math.max(MIN_TRACK_WIDTH, current - NARROW_STEP - Math.floor(this.rng() * 2));
    const taperSteps = 3;
    const holdSteps = 3 + Math.floor(this.rng() * 3);
    const deltaDown = ((target - current) * BALL_DIAMETER) / taperSteps;
    for (let i = 0; i < taperSteps; i++) this.pushSegment({ type: 'narrow', dw: deltaDown });
    for (let i = 0; i < holdSteps; i++) this.pushSegment({ type: 'narrow' });
    const deltaUp = ((current - target) * BALL_DIAMETER) / taperSteps;
    for (let i = 0; i < taperSteps; i++) this.pushSegment({ type: 'narrow', dw: deltaUp });
  }

  emitObstacleRows() {
    const cfg = this.cfg;
    const [minRows, maxRows] = cfg.obstacleRowsPerEvent;
    const rows = minRows + Math.floor(this.rng() * (maxRows - minRows + 1));
    let prevGapCenter = this.pendingObstacleGapCenter;
    for (let r = 0; r < rows; r++) {
      const widthBW = this._width / BALL_DIAMETER; // track width in ball-widths
      const gapBW = OBSTACLE_MIN_GAP;
      const maxGapCenterOffset = Math.max(0, (widthBW - gapBW) / 2);
      let gapCenter;
      if (prevGapCenter !== null) {
        // Reachability: clamp this row's gap center to what's laterally reachable
        // from the previous row's gap (this.reachBW, computed once in the
        // constructor from the difficulty's max forward/lateral speeds - see
        // brief section 6, item 4) so every spawn stays winnable.
        const reach = this.reachBW;
        const lo = Math.max(-maxGapCenterOffset, prevGapCenter - reach);
        const hi = Math.min(maxGapCenterOffset, prevGapCenter + reach);
        gapCenter = lo + this.rng() * Math.max(0, hi - lo);
        // Safety net (item 4): the clamp above should make this unreachable by construction, but
        // assert it in debug builds so a future retune of speed/reach constants gets caught here
        // instead of shipping an unwinnable row.
        if (DEBUG_ASSERTIONS) {
          console.assert(Math.abs(gapCenter - prevGapCenter) <= reach + 1e-6,
            `Ball Run: obstacle row gap center ${gapCenter} unreachable from previous ${prevGapCenter} (reach ${reach})`);
        }
      } else {
        gapCenter = (this.rng() * 2 - 1) * maxGapCenterOffset;
      }
      const obstacles = this.buildObstacleRow(widthBW, gapBW, gapCenter);
      // gapCenterBW rides along as plain data (ball-widths, relative to centerline) purely for
      // auditing/debug tooling; gameplay and rendering never read it.
      this.pushSegment({ type: 'obstacle', obstacles, gapCenterBW: gapCenter });
      // A clear segment between rows so the player can react.
      if (r < rows - 1) this.pushSegment({ type: 'straight' });
      prevGapCenter = gapCenter;
    }
    this.pendingObstacleGapCenter = prevGapCenter;
    this._firstObstaclePending = false;
    // Reschedule the next event from here (item 2), regardless of whether this one fired via the
    // scheduler or (in principle) some other path, so cadence stays correct either way.
    this.nextObstacleZ = this.frontZ + this.rollObstacleGap();
    // Force a clean stretch after the event so consecutive obstacle events
    // don't chain into what reads as a solid wall (Matt's verify-item A).
    this.straightsOwed = Math.max(this.straightsOwed, OBSTACLE_MIN_STRAIGHT_AFTER);
  }

  /** Cubes fill the track minus a `gapBW`-wide safe gap centered at `gapCenter` (ball-widths, relative to centerline). */
  buildObstacleRow(widthBW, gapBW, gapCenter) {
    const half = widthBW / 2;
    const gapLo = gapCenter - gapBW / 2;
    const gapHi = gapCenter + gapBW / 2;
    const cubes = [];
    // Cube pitch in ball-widths (item 3: cubes are now 1.5 ball-diameters, not 1, so the fill grid
    // must step by the cube's own size or adjacent cubes would overlap).
    const cubeBW = OBSTACLE_SIZE / BALL_DIAMETER;
    // Anchor each fill's cube grid AT the gap edge (not at the track edge) so
    // no cube can ever encroach into the safety gap: a cube grid anchored at
    // the track edge instead could land its nearest-to-gap cube anywhere up
    // to just short of gapLo/gapHi, shrinking the true passable width below
    // the configured OBSTACLE_MIN_GAP (found via a generated-track audit).
    for (let x = gapLo - cubeBW / 2; x > -half; x -= cubeBW) cubes.push({ lateral: x });
    for (let x = gapHi + cubeBW / 2; x < half; x += cubeBW) cubes.push({ lateral: x });
    return cubes.map((c) => ({ lateral: c.lateral * BALL_DIAMETER }));
  }

  emitTunnel() {
    this.lastTunnelZ = this.frontZ;
    for (let i = 0; i < TUNNEL_SEGMENTS; i++) {
      const showLabel = i === Math.floor(TUNNEL_SEGMENTS / 2);
      this.pushSegment({ type: 'tunnel', isTunnel: true, showSpeedLabel: showLabel });
    }
    this.straightsOwed = TUNNEL_MIN_STRAIGHT_AFTER;
    this.pendingObstacleGapCenter = null;
  }

  // --- Queries ------------------------------------------------------------

  /** Binary-search the segment containing world distance z (segments are contiguous, ascending). */
  segmentAt(z) {
    const segs = this.segments;
    if (!segs.length) return null;
    if (z < segs[0].z0) return segs[0];
    let lo = 0, hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segs[mid];
      if (z < s.z0) hi = mid - 1;
      else if (z >= s.z1) lo = mid + 1;
      else return s;
    }
    return segs[segs.length - 1];
  }

  /** Interpolated centerline X and track width at world distance z. */
  frameAt(z) {
    const seg = this.segmentAt(z);
    if (!seg) return { cx: 0, width: BASE_TRACK_WIDTH * BALL_DIAMETER, segment: null };
    const t = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
    return {
      cx: seg.cx0 + (seg.cx1 - seg.cx0) * t,
      width: seg.w0 + (seg.w1 - seg.w0) * t,
      segment: seg,
    };
  }

  isInTunnel(z) {
    const seg = this.segmentAt(z);
    return !!(seg && seg.isTunnel);
  }

  /**
   * Track-local frame at world distance z: centerline position, width, and the segment's tangent
   * yaw (its heading in the X-Z plane) plus the unit vector perpendicular to that tangent (the
   * track's local "right", matching the wall-placement convention already used for tunnel walls).
   * This is the render/camera-only fix for the second-playthrough item-1 curve bug: cx/width alone
   * (frameAt) treat a curve as a pure world-X shear, but the floor is drawn as a chord rotated to
   * yaw, so any lateral offset applied along world-X instead of this local right vector visibly
   * drifts off the rotated floor during a curve, even though the sim's lateralOffset hasn't moved.
   */
  localFrameAt(z) {
    const seg = this.segmentAt(z);
    if (!seg) return { cx: 0, width: BASE_TRACK_WIDTH * BALL_DIAMETER, yaw: 0, nx: 1, nz: 0, segment: null };
    const t = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
    const cx = seg.cx0 + (seg.cx1 - seg.cx0) * t;
    const width = seg.w0 + (seg.w1 - seg.w0) * t;
    const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
    return { cx, width, yaw, nx: Math.cos(yaw), nz: -Math.sin(yaw), segment: seg };
  }

  /** World-space (x, z) for a point at track-distance z, offset laterally by `lateral` world units along the track's local right vector at z. */
  worldPointAt(z, lateral) {
    const f = this.localFrameAt(z);
    return { x: f.cx + lateral * f.nx, z: z + lateral * f.nz, yaw: f.yaw };
  }
}
