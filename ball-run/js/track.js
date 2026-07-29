// track.js — procedural endless track as plain data (brief section 6). No Three.js
// objects live here; render.js maps this data onto pooled meshes each frame.
//
// The track is a sequence of short "segments" along z (forward distance). Each
// segment records the world-space lateral position of the track's CENTERLINE at
// its start and end (cx0/cx1) and the track width at its start and end (w0/w1).
// The ball's lateral offset is always relative to the centerline, so curves bend
// the world without changing the control model (brief section 6, item 2).

import {
  SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND,
  NARROW_STEP, CURVES_ENABLED, CURVE_SEGMENTS, CURVE_LATERAL_PER_SEGMENT, OBSTACLE_MIN_GAP, BALL_DIAMETER,
  OBSTACLE_SIZE, OBSTACLE_MIN_STRAIGHT_AFTER, LATERAL_MAX_SPEED_BASE,
  LATERAL_SPEED_SCALE_WITH_FORWARD, TUNNEL_SEGMENTS, TUNNEL_MIN_STRAIGHT_AFTER, difficultyConfig, mapConfig,
  OBSTACLE_FIRST_EVENT_MIN_M, OBSTACLE_FIRST_EVENT_MAX_M, OBSTACLE_EVENT_GAP_BASE_M,
  OBSTACLE_EVENT_GAP_JITTER_FRAC, OBSTACLE_EVENT_GAP_SHRINK_PER_TIER, OBSTACLE_EVENT_GAP_MIN_M,
  OBSTACLE_SPACING_SAFETY_FACTOR, OBSTACLE_COMBINE_SPAN_BW, OBSTACLE_COMBINE_MIN_CORRIDOR_BW,
  OBSTACLE_ROW_MAX_PUSH_ATTEMPTS, DEBUG_ASSERTIONS,
} from './config.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

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
  constructor(mapKey, difficultyKey, seed) {
    this.mapKey = mapKey;
    this.map = mapConfig(mapKey);
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
    this.pendingObstacleGapCenter = null; // previous obstacle row's gap center, for spacing chaining
    this.pendingObstacleRowZ = null; // previous obstacle row's z0, for spacing chaining (item 3)
    // Split (Orbital only, BALLRUNMAP2ORBITALSPEC.md section 2/6): same deterministic-cadence
    // shape as tunnels above. `this.map.split` is undefined on any map without it (Classic), so
    // every place that reads it is guarded on that.
    this.lastSplitZ = 0;
    this.lastWasSplit = false;

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
    this._width = this.map.baseTrackWidth * BALL_DIAMETER;
    this._void = 0; // running void half-width (Split only; every other event leaves this at 0)

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

    // Split (Orbital only, spec section 6): same deterministic-meter-cadence shape as tunnels,
    // never drawn from the weighted-random pool. Tunnel wins if both are due on the same tick
    // (tunnels are the speed-pacing backbone - spec section 6 says keep them); the split just
    // stays due and fires on the very next event, same pattern as obstacle-vs-tunnel below. The
    // extra `!this.lastWasSplit` guard mirrors tunnel's own - straightsOwed alone doesn't
    // guarantee the cadence gap can't already be due again the instant it's cleared.
    const splitCfg = this.map.split;
    const splitDue = !!splitCfg && !this.lastWasSplit && type !== 'tunnel'
      && this.frontZ - this.lastSplitZ >= splitCfg.cadenceM;
    if (splitDue) type = 'split';

    // Obstacle occurrence is distance-paced, not weighted-random (item 2): fire as soon as this
    // event's start distance reaches the scheduled threshold. Tunnel/split win if due on the same
    // tick; the obstacle stays due and fires on the very next event instead.
    const obstacleDue = type !== 'tunnel' && type !== 'split' && this.frontZ >= this.nextObstacleZ;
    if (obstacleDue) type = 'obstacle';

    // A multi-segment event (curve/narrow/split) can span well past one generateEvent() call, and
    // the due check above only runs once per call - so a long event picked just before the
    // threshold could sail straight past it (this is what let the first obstacle land outside its
    // guaranteed window before this fix). Only step down to a single short segment when the
    // SPECIFIC type just picked would actually overshoot, not for the whole approach window, so
    // curves/narrows/splits still generate normally right up until they'd cross the line. Scoped
    // to the first event only (see this._firstObstaclePending) so a tight later cadence can't veto
    // curves for the rest of the run. (In practice split's own ~120m cadence means this branch is
    // basically unreachable for it - the 40-60m first-obstacle window always closes first - but it
    // is handled for correctness rather than assumed away.)
    if (this._firstObstaclePending && !obstacleDue && type !== 'tunnel') {
      const worstCaseSpanM = type === 'curve' ? CURVE_SEGMENTS * SEGMENT_LENGTH
        : type === 'narrow' ? 11 * SEGMENT_LENGTH // taper(3) + hold(up to 5) + taper(3)
        : type === 'split' ? (splitCfg.widenSegs + 8 + splitCfg.holdMaxSegs + splitCfg.closeSegs + splitCfg.narrowBackSegs) * SEGMENT_LENGTH // +8: generous guess for the fairness-derived Open phase, computed for real inside emitSplit()
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
    else if (type === 'split') this.emitSplit();
    else this.emitStraight();

    this.lastWasTunnel = type === 'tunnel';
    this.lastWasSplit = type === 'split';
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
      // Split only (BALLRUNMAP2ORBITALSPEC.md section 2): void0/void1 are the segment's start/end
      // void half-width, interpolated exactly like w0/w1 above; voidCenter is constant across a
      // whole Split event (0 unless the 'unequal' side-variety rolled an off-centerline gap), so
      // it needs no start/end pair. Both default to 0 for every other event type.
      void0: this._void,
      void1: Math.max(0, this._void + (fields.dVoid || 0)),
      voidCenter: fields.voidCenter || 0,
      type: fields.type,
      isTunnel: !!fields.isTunnel,
      telegraph: !!fields.telegraph, // Split's Widen-phase divider line (render.js, visual only)
      scoreOnce: !!fields.scoreOnce, // Split's single +1, on its very last segment
      obstacles: fields.obstacles || null,
      showSpeedLabel: !!fields.showSpeedLabel,
    };
    this._cx = seg.cx1;
    this._width = Math.max(this.map.minTrackWidth * BALL_DIAMETER, seg.w1);
    this._void = seg.void1;
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
    const target = Math.max(this.map.minTrackWidth, current - NARROW_STEP - Math.floor(this.rng() * 2));
    const taperSteps = 3;
    const holdSteps = 3 + Math.floor(this.rng() * 3);
    const deltaDown = ((target - current) * BALL_DIAMETER) / taperSteps;
    for (let i = 0; i < taperSteps; i++) this.pushSegment({ type: 'narrow', dw: deltaDown });
    for (let i = 0; i < holdSteps; i++) this.pushSegment({ type: 'narrow' });
    const deltaUp = ((current - target) * BALL_DIAMETER) / taperSteps;
    for (let i = 0; i < taperSteps; i++) this.pushSegment({ type: 'narrow', dw: deltaUp });
  }

  /** Estimated forward speed at track distance z, for spacing math that runs ahead of the sim
   * (row placement happens before the ball ever gets there). Tier-based like rollObstacleGap's
   * estimatedTier; elapsed time is approximated from z / baseSpeed, which is always an
   * OVER-estimate of true elapsed time (actual speed is never below baseSpeed) and therefore an
   * over-estimate of speed too - erring toward a larger required spacing, never a smaller one. */
  estimateSpeedAt(z) {
    const cfg = this.cfg;
    const estimatedTier = Math.floor(z / cfg.tunnelSpacingMeters);
    const elapsedApprox = z / cfg.baseSpeed;
    const ramped = cfg.baseSpeed + cfg.speedRampPerSec * elapsedApprox + cfg.tierBonus * estimatedTier;
    return Math.min(cfg.maxSpeed, ramped);
  }

  /** Max lateral speed at a given forward speed (mirrors sim.js's lateralMax formula exactly). */
  lateralMaxAtSpeed(speed) {
    return LATERAL_MAX_SPEED_BASE * (1 + LATERAL_SPEED_SCALE_WITH_FORWARD * (speed / this.cfg.baseSpeed - 1));
  }

  /** Minimum longitudinal spacing (world units) between two corridor centers at distance z
   * (Matt's third-playthrough item 3a): minSpacing = (lateralDistance / maxLateralSpeed) *
   * forwardSpeed * OBSTACLE_SPACING_SAFETY_FACTOR, evaluated at the speed the ball will actually
   * have when it arrives at z, not the run-start speed. */
  minSpacingFor(gapCenterA, gapCenterB, z) {
    const lateralDistWorld = Math.abs(gapCenterB - gapCenterA) * BALL_DIAMETER;
    if (lateralDistWorld <= 0) return 0;
    const speed = this.estimateSpeedAt(z);
    const maxLateralSpeed = this.lateralMaxAtSpeed(speed);
    return (lateralDistWorld / maxLateralSpeed) * speed * OBSTACLE_SPACING_SAFETY_FACTOR;
  }

  /**
   * Place one obstacle row, chained against the previous row's gap center/z (either the row
   * before it in this same event, or the last row of a previous event - both are the same
   * `pendingObstacleGapCenter`/`pendingObstacleRowZ` chain, since a close-together pair of
   * separate events is exactly the "46m wall" Matt hit: two independently-valid corridors with
   * almost no forward distance between them). Returns { gapCenter, z0 } or null if the row had to
   * be dropped (item 3b.3).
   */
  placeObstacleRow(prevGapCenter, prevRowZ) {
    const widthBW = () => this._width / BALL_DIAMETER;
    const gapBW = OBSTACLE_MIN_GAP;

    if (prevGapCenter === null) {
      const maxGapCenterOffset = Math.max(0, (widthBW() - gapBW) / 2);
      const gapCenter = (this.rng() * 2 - 1) * maxGapCenterOffset;
      const seg = this.pushSegment({ type: 'obstacle', obstacles: this.buildObstacleRow(widthBW(), gapBW, gapCenter), gapCenterBW: gapCenter });
      return { gapCenter, z0: seg.z0 };
    }

    const maxGapCenterOffset0 = Math.max(0, (widthBW() - gapBW) / 2);
    let gapCenter = (this.rng() * 2 - 1) * maxGapCenterOffset0;
    for (let attempt = 0; attempt <= OBSTACLE_ROW_MAX_PUSH_ATTEMPTS; attempt++) {
      const z0 = this.frontZ;
      const actualSpacing = z0 - prevRowZ;
      const maxGapCenterOffset = Math.max(0, (widthBW() - gapBW) / 2);

      // 3c: rows closer than OBSTACLE_COMBINE_SPAN_BW ball-diameters must be treated as one
      // combined pattern sharing a corridor >= OBSTACLE_COMBINE_MIN_CORRIDOR_BW wide. Shift
      // toward the previous row's corridor first (this also shrinks the item-3a lateral
      // distance, so it's tried before, and folds into, the 3a repair below).
      if (actualSpacing < OBSTACLE_COMBINE_SPAN_BW * BALL_DIAMETER) {
        const maxOffsetFromPrev = Math.max(0, gapBW - OBSTACLE_COMBINE_MIN_CORRIDOR_BW);
        gapCenter = clamp(gapCenter, prevGapCenter - maxOffsetFromPrev, prevGapCenter + maxOffsetFromPrev);
        gapCenter = clamp(gapCenter, -maxGapCenterOffset, maxGapCenterOffset);
      }

      // 3a/3b.1: if the time-derived minimum spacing is still violated, shift the corridor as
      // far toward the previous row's as the available spacing allows.
      let required = this.minSpacingFor(gapCenter, prevGapCenter, z0);
      if (actualSpacing < required) {
        const speed = this.estimateSpeedAt(z0);
        const maxLateralSpeed = this.lateralMaxAtSpeed(speed);
        const maxLateralDistBW = (actualSpacing * maxLateralSpeed) / (speed * OBSTACLE_SPACING_SAFETY_FACTOR * BALL_DIAMETER);
        gapCenter = clamp(gapCenter, prevGapCenter - maxLateralDistBW, prevGapCenter + maxLateralDistBW);
        gapCenter = clamp(gapCenter, -maxGapCenterOffset, maxGapCenterOffset);
        required = this.minSpacingFor(gapCenter, prevGapCenter, z0);
      }

      if (actualSpacing >= required) {
        if (DEBUG_ASSERTIONS) {
          console.assert(actualSpacing + 1e-6 >= required,
            `Ball Run: obstacle row spacing ${actualSpacing} < required ${required} (gapCenter ${gapCenter}, prev ${prevGapCenter})`);
          if (actualSpacing < OBSTACLE_COMBINE_SPAN_BW * BALL_DIAMETER) {
            const overlap = gapBW - Math.abs(gapCenter - prevGapCenter);
            console.assert(overlap + 1e-6 >= OBSTACLE_COMBINE_MIN_CORRIDOR_BW,
              `Ball Run: combined-pattern corridor ${overlap} < ${OBSTACLE_COMBINE_MIN_CORRIDOR_BW} (rows ${actualSpacing} apart)`);
          }
        }
        const seg = this.pushSegment({ type: 'obstacle', obstacles: this.buildObstacleRow(widthBW(), gapBW, gapCenter), gapCenterBW: gapCenter });
        return { gapCenter, z0: seg.z0 };
      }

      // 3b.2: still violating after the shift - push further downtrack and retry.
      this.pushSegment({ type: 'straight' });
    }
    // 3b.3: genuinely can't satisfy the constraint within a bounded number of pushes - drop the
    // row rather than ship a violation.
    return null;
  }

  /** Each row placed here becomes its own 'obstacle' track segment (including every row of a
   * combined pattern from placeObstacleRow's 3c corridor-sharing rule) - sim.js's scoring (fourth-
   * playthrough item 2) counts one point per crossed 'obstacle' segment, so a merged 2-row pattern is
   * worth 2 points, scored as each row's far edge is individually crossed. Rows placeObstacleRow
   * drops (returns null, 3b.3) never become a segment and so never score. */
  emitObstacleRows() {
    const cfg = this.cfg;
    const [minRows, maxRows] = cfg.obstacleRowsPerEvent;
    const rows = minRows + Math.floor(this.rng() * (maxRows - minRows + 1));
    let prevGapCenter = this.pendingObstacleGapCenter;
    let prevRowZ = this.pendingObstacleRowZ;
    for (let r = 0; r < rows; r++) {
      const placed = this.placeObstacleRow(prevGapCenter, prevRowZ);
      if (placed) {
        prevGapCenter = placed.gapCenter;
        prevRowZ = placed.z0;
      }
      // A clear segment between rows so the player can react.
      if (r < rows - 1) this.pushSegment({ type: 'straight' });
    }
    this.pendingObstacleGapCenter = prevGapCenter;
    this.pendingObstacleRowZ = prevRowZ;
    this._firstObstaclePending = false;
    // Reschedule the next event from here (item 2), regardless of whether this one fired via the
    // scheduler or (in principle) some other path, so cadence stays correct either way.
    this.nextObstacleZ = this.frontZ + this.rollObstacleGap();
    // Force a clean stretch after the event so consecutive obstacle events
    // don't chain into what reads as a solid wall (Matt's verify-item A).
    this.straightsOwed = Math.max(this.straightsOwed, OBSTACLE_MIN_STRAIGHT_AFTER);
  }

  /** Cubes fill [loBW, hiBW] minus the safe gap [gapLo, gapHi] (ball-widths, relative to the
   *  centerline) - the shared core between buildObstacleRow (the full track width) and Split's
   *  buildLaneObstacleRow (one lane's own range). Anchor each fill's cube grid AT the gap edge
   *  (not at the outer bound) so no cube can ever encroach into the safety gap: a grid anchored at
   *  the outer bound instead could land its nearest-to-gap cube anywhere up to just short of
   *  gapLo/gapHi, shrinking the true passable width below the configured gap (found via a
   *  generated-track audit). Cube pitch in ball-widths (item 3: cubes are 1.5 ball-diameters, not
   *  1, so the fill grid must step by the cube's own size or adjacent cubes would overlap). */
  fillObstacleCubes(loBW, hiBW, gapLo, gapHi) {
    const cubeBW = OBSTACLE_SIZE / BALL_DIAMETER;
    const cubes = [];
    for (let x = gapLo - cubeBW / 2; x > loBW; x -= cubeBW) cubes.push({ lateral: x });
    for (let x = gapHi + cubeBW / 2; x < hiBW; x += cubeBW) cubes.push({ lateral: x });
    return cubes.map((c) => ({ lateral: c.lateral * BALL_DIAMETER }));
  }

  /** Cubes fill the track minus a `gapBW`-wide safe gap centered at `gapCenter` (ball-widths, relative to centerline). */
  buildObstacleRow(widthBW, gapBW, gapCenter) {
    const half = widthBW / 2;
    return this.fillObstacleCubes(-half, half, gapCenter - gapBW / 2, gapCenter + gapBW / 2);
  }

  /** Split's per-lane obstacle row (BALLRUNMAP2ORBITALSPEC.md section 2, "side variety" ~35%
   *  roll): confined to ONE lane's own [loBW, hiBW] range, with `gapBW` (the standard
   *  OBSTACLE_MIN_GAP) reserved somewhere inside just that lane rather than centered on the whole
   *  corridor. The caller only ever invokes this for one side, so the OTHER lane is never touched
   *  and stays clean by construction - "every Split must have at least one clean lane" (landmine
   *  #7) holds trivially, not by a separate check. */
  buildLaneObstacleRow(loBW, hiBW, gapBW) {
    const laneWidth = hiBW - loBW;
    const maxGapCenterOffset = Math.max(0, (laneWidth - gapBW) / 2);
    const gapCenter = (loBW + hiBW) / 2 + (this.rng() * 2 - 1) * maxGapCenterOffset;
    return this.fillObstacleCubes(loBW, hiBW, gapCenter - gapBW / 2, gapCenter + gapBW / 2);
  }

  emitTunnel() {
    this.lastTunnelZ = this.frontZ;
    for (let i = 0; i < TUNNEL_SEGMENTS; i++) {
      const showLabel = i === Math.floor(TUNNEL_SEGMENTS / 2);
      this.pushSegment({ type: 'tunnel', isTunnel: true, showSpeedLabel: showLabel });
    }
    this.straightsOwed = TUNNEL_MIN_STRAIGHT_AFTER;
    this.pendingObstacleGapCenter = null;
    this.pendingObstacleRowZ = null;
  }

  /**
   * Split (Orbital only, BALLRUNMAP2ORBITALSPEC.md section 2): the track widens, a void band
   * opens down the centerline, holds, closes, then narrows back - ONE wide segment with a void
   * band, never two separate tracks. This is the whole trick: the single-centerline coordinate
   * model, the one-segment collision check, and everything built on top of them (worldPointAt,
   * the camera, obstacle placement) stay completely untouched. Only reachable when
   * `this.map.split` exists (generateEvent() gates splitDue on it), so Classic never calls this.
   */
  emitSplit() {
    const cfg = this.map.split;
    this.lastSplitZ = this.frontZ;

    const totalWidth = cfg.totalWidthBW * BALL_DIAMETER;
    const voidHalf = cfg.voidHalfBW * BALL_DIAMETER;
    const baseWidth = this._width;

    // Fairness rule (section 2, "do not skip this"): a player centered on the void when it opens
    // must have time to steer clear, AT THIS EVENT'S ACTUAL forward speed. Reuses the exact same
    // time-derived spacing math as obstacle-row spacing (estimateSpeedAt/lateralMaxAtSpeed/
    // OBSTACLE_SPACING_SAFETY_FACTOR) rather than hand-rolling a simpler version - landmine #2,
    // the precise mistake that caused the "46m wall" bug.
    const speed = this.estimateSpeedAt(this.frontZ);
    const maxLateralSpeed = this.lateralMaxAtSpeed(speed);
    const timeNeeded = voidHalf / maxLateralSpeed;
    const openLengthWorld = timeNeeded * speed * OBSTACLE_SPACING_SAFETY_FACTOR;
    const openSegs = Math.max(1, Math.ceil(openLengthWorld / SEGMENT_LENGTH));

    const holdSegs = cfg.holdMinSegs + Math.floor(this.rng() * (cfg.holdMaxSegs - cfg.holdMinSegs + 1));

    // Side variety (section 2): rolled once, up front, since every phase below depends on the
    // outcome - the void's center offset for 'unequal', which Hold segment (if any) carries the
    // row for 'obstacle'. ~50% identical lanes / ~35% one lane carries a single obstacle row /
    // ~15% unequal lane widths.
    const r = this.rng();
    const sideRoll = r < cfg.sideIdenticalChance ? 'identical'
      : r < cfg.sideIdenticalChance + cfg.sideObstacleChance ? 'obstacle'
      : 'unequal';

    const halfWidthBW = cfg.totalWidthBW / 2;
    let voidCenterBW = 0;
    if (sideRoll === 'unequal') {
      // Both lanes must stay >= this.map.minTrackWidth (section 2's width formula, generalized:
      // SPLIT_TOTAL_WIDTH >= 2*MIN_TRACK_WIDTH + 2*SPLIT_VOID_HALF holds the void centered; an
      // off-center void trades that margin between the two lanes instead of spending it evenly).
      const maxOffsetBW = Math.max(0, halfWidthBW - cfg.voidHalfBW - this.map.minTrackWidth);
      voidCenterBW = (this.rng() < 0.5 ? -1 : 1) * maxOffsetBW * (0.4 + this.rng() * 0.6);
    }
    const voidCenter = voidCenterBW * BALL_DIAMETER;

    let obstacleHoldIndex = -1, obstacleLeftLane = true;
    if (sideRoll === 'obstacle') {
      obstacleHoldIndex = Math.floor(this.rng() * holdSegs);
      obstacleLeftLane = this.rng() < 0.5;
    }

    // --- Widen: width grows to totalWidth, void stays 0. Telegraph a lit divider line at lateral
    // 0 the whole time (visual only, render.js) so the player learns the shape by seeing it once -
    // no instructional text anywhere (landmine #8).
    const widenDelta = (totalWidth - baseWidth) / cfg.widenSegs;
    for (let i = 0; i < cfg.widenSegs; i++) this.pushSegment({ type: 'split', dw: widenDelta, telegraph: true });

    // --- Open: voidHalfWidth grows 0 -> voidHalf, over the fairness-derived length above. ---
    const openDelta = voidHalf / openSegs;
    for (let i = 0; i < openSegs; i++) this.pushSegment({ type: 'split', dVoid: openDelta, voidCenter });

    // --- Hold: steady void at full voidHalf; this is where the side-variety obstacle row (if
    // rolled) sits, confined to ONE lane, leaving the other completely clean.
    for (let i = 0; i < holdSegs; i++) {
      let obstacles = null;
      if (i === obstacleHoldIndex) {
        const laneLo = obstacleLeftLane ? -halfWidthBW : voidCenterBW + cfg.voidHalfBW;
        const laneHi = obstacleLeftLane ? voidCenterBW - cfg.voidHalfBW : halfWidthBW;
        obstacles = this.buildLaneObstacleRow(laneLo, laneHi, OBSTACLE_MIN_GAP);
      }
      this.pushSegment({ type: 'split', voidCenter, obstacles });
    }

    // --- Close: voidHalfWidth shrinks back to 0. ---
    const closeDelta = -voidHalf / cfg.closeSegs;
    for (let i = 0; i < cfg.closeSegs; i++) this.pushSegment({ type: 'split', dVoid: closeDelta, voidCenter });

    // --- Narrow back: width returns to normal. Scored on the very last segment only (section 2,
    // "Scoring": "+1 on clearing a Split, same as clearing an obstacle row") - once the player has
    // survived the WHOLE event, including any in-lane obstacle, not just the fork itself; mirrors
    // how an obstacle row only scores once its own far edge is crossed.
    const narrowDelta = (baseWidth - totalWidth) / cfg.narrowBackSegs;
    for (let i = 0; i < cfg.narrowBackSegs; i++) {
      this.pushSegment({ type: 'split', dw: narrowDelta, scoreOnce: i === cfg.narrowBackSegs - 1 });
    }

    // Force a clean stretch after the event so Splits can't chain (section 2), and reset the
    // obstacle-spacing chain the same way a tunnel does - the width swing invalidates the previous
    // corridor reference no less than a tunnel's does.
    this.straightsOwed = cfg.minStraightAfter;
    this.pendingObstacleGapCenter = null;
    this.pendingObstacleRowZ = null;
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
    if (!seg) return { cx: 0, width: this.map.baseTrackWidth * BALL_DIAMETER, voidHalfWidth: 0, voidCenter: 0, segment: null };
    const t = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
    return {
      cx: seg.cx0 + (seg.cx1 - seg.cx0) * t,
      width: seg.w0 + (seg.w1 - seg.w0) * t,
      // Split only (section 2): voidHalfWidth is interpolated exactly like width above (it ramps
      // within a segment during Open/Close); voidCenter is constant across a segment so no
      // interpolation is needed. Both are 0 for every non-Split segment.
      voidHalfWidth: (seg.void0 || 0) + ((seg.void1 || 0) - (seg.void0 || 0)) * t,
      voidCenter: seg.voidCenter || 0,
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
    if (!seg) return { cx: 0, width: this.map.baseTrackWidth * BALL_DIAMETER, yaw: 0, nx: 1, nz: 0, segment: null };
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
