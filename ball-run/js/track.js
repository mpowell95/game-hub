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
    // Jump (Orbital only, section 3/6): same deterministic-cadence shape again, offset from
    // Split's so the two schedules don't collide. `this.map.jump` is undefined on any map
    // without it.
    this.lastJumpZ = 0;
    this.lastWasJump = false;
    // Pickups (Phase 4, Orbital only): distance-paced like the obstacle scheduler, jittered per
    // spawn rather than a fixed cadence. `this.map.pickups` is undefined on any map without it.
    if (this.map.pickups) {
      const pk = this.map.pickups;
      this.nextOrbZ = pk.orbCadenceM * (1 + (this.rng() * 2 - 1) * pk.orbCadenceJitterFrac);
      this.nextLifeZ = pk.lifeCadenceM * (1 + (this.rng() * 2 - 1) * pk.lifeCadenceJitterFrac);
    }

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
    this._void = 0; // running void half-width (Split/Jump only; every other event leaves this at 0)
    this._y = 0; // running height (Jump only; every other event leaves this at 0 - "keep the track
                 // flat everywhere except Jump events", section 3)

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

    // Jump (Orbital only, section 3/6): same deterministic-cadence shape again, offset from
    // Split's (160m vs 120m) so the two schedules don't collide - "never allow two of them to
    // overlap" (section 6). Split wins if both are due on the same tick (arbitrary but
    // consistent tie-break, same shape as tunnel-vs-split above); jump just stays due and fires
    // on the very next event.
    const jumpCfg = this.map.jump;
    const jumpDue = !!jumpCfg && !this.lastWasJump && type !== 'tunnel' && type !== 'split'
      && this.frontZ - this.lastJumpZ >= jumpCfg.cadenceM;
    if (jumpDue) type = 'jump';

    // Obstacle occurrence is distance-paced, not weighted-random (item 2): fire as soon as this
    // event's start distance reaches the scheduled threshold. Tunnel/split/jump win if due on the
    // same tick; the obstacle stays due and fires on the very next event instead.
    const obstacleDue = type !== 'tunnel' && type !== 'split' && type !== 'jump' && this.frontZ >= this.nextObstacleZ;
    if (obstacleDue) type = 'obstacle';

    // A multi-segment event (curve/narrow/split/jump) can span well past one generateEvent() call,
    // and the due check above only runs once per call - so a long event picked just before the
    // threshold could sail straight past it (this is what let the first obstacle land outside its
    // guaranteed window before this fix). Only step down to a single short segment when the
    // SPECIFIC type just picked would actually overshoot, not for the whole approach window, so
    // curves/narrows/splits/jumps still generate normally right up until they'd cross the line.
    // Scoped to the first event only (see this._firstObstaclePending) so a tight later cadence
    // can't veto curves for the rest of the run. (In practice split's ~120m and jump's ~160m
    // cadences mean this branch is basically unreachable for either - the 40-60m first-obstacle
    // window always closes first - but it is handled for correctness rather than assumed away.)
    if (this._firstObstaclePending && !obstacleDue && type !== 'tunnel') {
      const worstCaseSpanM = type === 'curve' ? CURVE_SEGMENTS * SEGMENT_LENGTH
        : type === 'narrow' ? 11 * SEGMENT_LENGTH // taper(3) + hold(up to 5) + taper(3)
        : type === 'split' ? (splitCfg.widenSegs + 8 + splitCfg.holdMaxSegs + splitCfg.closeSegs + splitCfg.narrowBackSegs) * SEGMENT_LENGTH // +8: generous guess for the fairness-derived Open phase, computed for real inside emitSplit()
        : type === 'jump' ? (jumpCfg.gapMaxSegs + jumpCfg.landingHoldSegs + jumpCfg.recoverySegs) * SEGMENT_LENGTH
        : 3 * SEGMENT_LENGTH; // straight, worst case
      if (this.frontZ + worstCaseSpanM > this.nextObstacleZ) type = 'straight-step';
    }

    if (this.straightsOwed > 0) { type = 'straight'; this.straightsOwed--; }

    const frontZBefore = this.frontZ;
    if (type === 'straight') this.emitStraight();
    else if (type === 'straight-step') this.emitStraight(1);
    else if (type === 'curve') this.emitCurve();
    else if (type === 'narrow') this.emitNarrow();
    else if (type === 'obstacle') this.emitObstacleRows();
    else if (type === 'tunnel') this.emitTunnel();
    else if (type === 'split') this.emitSplit();
    else if (type === 'jump') this.emitJump();
    else this.emitStraight();

    this.lastWasTunnel = type === 'tunnel';
    this.lastWasSplit = type === 'split';
    this.lastWasJump = type === 'jump';
    this.maybePlacePickup(frontZBefore);
  }

  /**
   * Pickups (Phase 4, Orbital only, BALLRUNMAP2ORBITALSPEC.md section 7: "extra lives and
   * collectibles... much cheaper once Phases 1 to 3 exist"). True here: a pickup is never its own
   * event type or geometry change, just an extra point-in-space payload attached to whatever
   * plain 'straight' segment this same generateEvent() call already pushed, once its distance
   * cadence is due. `this.map.pickups` is undefined on any map without it (Classic), so this is a
   * no-op there.
   */
  maybePlacePickup(frontZBefore) {
    const cfg = this.map.pickups;
    if (!cfg) return;
    if (this.frontZ >= this.nextOrbZ) {
      const seg = this._findPickupSlot(frontZBefore);
      if (seg) {
        seg.pickup = { type: 'orb', lateral: this._safePickupLateral(seg) };
        this.nextOrbZ = this.frontZ + cfg.orbCadenceM * (1 + (this.rng() * 2 - 1) * cfg.orbCadenceJitterFrac);
      }
      // If no suitable segment existed this call (e.g. this event was a hazard), nextOrbZ is left
      // as-is, so the next call - almost always a plain straight or narrow event, per the
      // weighted pool - tries again immediately rather than skipping a whole cadence interval.
    }
    if (this.frontZ >= this.nextLifeZ) {
      const seg = this._findPickupSlot(frontZBefore);
      if (seg) {
        seg.pickup = { type: 'life', lateral: this._safePickupLateral(seg) };
        this.nextLifeZ = this.frontZ + cfg.lifeCadenceM * (1 + (this.rng() * 2 - 1) * cfg.lifeCadenceJitterFrac);
      }
    }
  }

  /** A plain, hazard-free segment among THIS call's newly pushed ones (never scans further back -
   *  a pickup always lands within the event that was due, not retroactively on an older one),
   *  with no pickup on it yet (so an orb and a life due on the same event land on two different
   *  segments rather than stacking on one). Deliberately excludes every hazard/geometry-changing
   *  type (obstacle rows, tunnels, Split's void, a Jump's gap/landing/recovery) so pickup
   *  placement never has to reason about voids, lanes, or in-flight state at all. */
  _findPickupSlot(frontZBefore) {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (s.z0 < frontZBefore) break;
      if (s.type === 'straight' && !s.isGap && !s.pickup && (s.void1 || 0) === 0) return s;
    }
    return null;
  }

  /** A lateral position comfortably inside the segment's own width (60% of the half-width),
   *  never near the edge - a missed pickup should read as "didn't reach it," never as "clipped
   *  the wall trying." */
  _safePickupLateral(seg) {
    const halfW = ((seg.w0 + seg.w1) / 2) / 2;
    return (this.rng() * 2 - 1) * halfW * 0.6;
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
      // Jump only (section 3): y0/y1 are the segment's start/end height, interpolated exactly
      // like w0/w1 and void0/void1 above. Track stays flat (0) everywhere except a Jump's gap/
      // landing/recovery phases - "do not add general track elevation" (section 3).
      y0: this._y,
      y1: this._y + (fields.dY || 0),
      // Jump's "landing pad laterally offset" variety ONLY (section 3): where the pad's own
      // width/void is centered, relative to cx - constant per segment, like voidCenter, and
      // combined with it the same way (`frame.wCenter + frame.voidCenter` is the void's true
      // position relative to cx). Deliberately NOT expressed as `dcx` (centerline drift): dcx
      // moves cx itself, and the ball's lateralOffset is measured relative to the CURRENT
      // segment's cx - exactly the "single centerline" trick that lets a curve carry an unsteered
      // ball along with it for free. That is precisely wrong for this variety, whose entire point
      // is that standing still (not steering) MISSES the pad - "so you must steer in the air"
      // (section 3). wCenter shifts where the SAFE ZONE is without moving the reference frame the
      // ball's offset is measured against, so an unsteered ball's offset stays exactly where it
      // was at launch while the pad moves out from under it.
      wCenter: fields.wCenter || 0,
      type: fields.type,
      isTunnel: !!fields.isTunnel,
      isGap: !!fields.isGap, // Jump's flight span: no floor, no collision (sim.js handles it as a
                             // distinct AIRBORNE state, never through the normal per-tick checks)
      telegraph: !!fields.telegraph, // Split's Widen-phase divider line (render.js, visual only)
      scoreOnce: !!fields.scoreOnce, // Split's single +1, on its very last segment
      jumpMeta: fields.jumpMeta || null, // { gapLength, landingY }, only on a jump's first gap segment
      jumpLanding: !!fields.jumpLanding, // true only on a jump's first landing-hold segment (render.js's distance-visible gate marker)
      obstacles: fields.obstacles || null,
      showSpeedLabel: !!fields.showSpeedLabel,
      // Pickups (Phase 4, Orbital only): never set at push time - maybePlacePickup() mutates this
      // directly onto an already-generated plain 'straight' segment once one is due, same
      // after-the-fact placement as everything else pickups touch being deliberately unaffected
      // by generation (no new event type, no geometry change). { type: 'orb'|'life', lateral }.
      pickup: null,
    };
    this._cx = seg.cx1;
    this._width = Math.max(this.map.minTrackWidth * BALL_DIAMETER, seg.w1);
    this._void = seg.void1;
    this._y = seg.y1;
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

  /** Split's per-lane obstacle row placement (BALLRUNMAP2ORBITALSPEC.md section 2, "side variety"
   *  ~35% roll, generalized this round to MULTIPLE rows once Hold got long enough - "I want the
   *  paths to be actual separate paths for a while" - for a single row to no longer fill it).
   *  Confined to ONE lane's own [loBW, hiBW] range - the caller only ever passes one side's bounds,
   *  so the OTHER lane is never touched and stays clean by construction ("every Split must have at
   *  least one clean lane", landmine #7), same guarantee the single-row version had.
   *
   *  Reuses the exact reachability primitives `placeObstacleRow`'s own retry loop uses
   *  (`minSpacingFor`/`estimateSpeedAt`/`lateralMaxAtSpeed`, landmine #2 - never hand-roll a
   *  simpler version, the precise mistake behind the "46m wall" bug) but does NOT retry by pushing
   *  extra segments the way `placeObstacleRow` does: the Hold phase's segment budget is fixed by
   *  `holdSegs` (rolled once by the caller), so a slot whose candidate row isn't reachable from the
   *  previous one in this same lane sequence is simply left clean instead - the multi-row analogue
   *  of 3b.3's "drop rather than ship a violation", just without growing the track to try again.
   *  Returns a gapCenter (absolute lateral, ball-widths) or `null` if this slot should stay clean. */
  laneObstacleGapCenter(loBW, hiBW, prevGapCenter, prevRowZ, z0) {
    const gapBW = OBSTACLE_MIN_GAP;
    const maxOffset = Math.max(0, (hiBW - loBW - gapBW) / 2);
    const laneMid = (loBW + hiBW) / 2;
    let gapCenter = laneMid + (this.rng() * 2 - 1) * maxOffset;
    if (prevGapCenter === null) return gapCenter;

    const actualSpacing = z0 - prevRowZ;
    let required = this.minSpacingFor(gapCenter, prevGapCenter, z0);
    if (actualSpacing < required) {
      // Same shift-toward-the-previous-row repair as placeObstacleRow's 3a/3b.1, clamped to this
      // lane's own bounds rather than the whole track's.
      const speed = this.estimateSpeedAt(z0);
      const maxLateralSpeed = this.lateralMaxAtSpeed(speed);
      const maxLateralDistBW = (actualSpacing * maxLateralSpeed) / (speed * OBSTACLE_SPACING_SAFETY_FACTOR * BALL_DIAMETER);
      gapCenter = clamp(gapCenter, prevGapCenter - maxLateralDistBW, prevGapCenter + maxLateralDistBW);
      gapCenter = clamp(gapCenter, laneMid - maxOffset, laneMid + maxOffset);
      required = this.minSpacingFor(gapCenter, prevGapCenter, z0);
    }
    return actualSpacing >= required ? gapCenter : null;
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

    // Obstacle-row slots (this round's follow-up, generalizing the old single `obstacleHoldIndex`):
    // spread `numRows` candidate positions evenly across the now much-longer Hold phase, each with
    // a little jitter so rows don't land in lockstep across different generated Splits. This is
    // only a proposal of WHERE to try - laneObstacleGapCenter (below, in the Hold loop) is the
    // actual reachability GO/NO-GO for each slot, and a slot it rejects is simply left clean.
    let obstacleLeftLane = true;
    let obstacleRowIndices = [];
    if (sideRoll === 'obstacle') {
      obstacleLeftLane = this.rng() < 0.5;
      const numRows = holdSegs >= 14 ? 3 : holdSegs >= 8 ? 2 : 1;
      for (let n = 0; n < numRows; n++) {
        const frac = (n + 0.5) / numRows;
        const jitter = (this.rng() - 0.5) * (holdSegs / numRows) * 0.6;
        const idx = Math.max(0, Math.min(holdSegs - 1, Math.round(frac * holdSegs + jitter)));
        obstacleRowIndices.push(idx);
      }
    }

    // --- Widen: width grows to totalWidth, void stays 0. Telegraph a lit divider line at lateral
    // 0 the whole time (visual only, render.js) so the player learns the shape by seeing it once -
    // no instructional text anywhere (landmine #8).
    const widenDelta = (totalWidth - baseWidth) / cfg.widenSegs;
    for (let i = 0; i < cfg.widenSegs; i++) this.pushSegment({ type: 'split', dw: widenDelta, telegraph: true });

    // --- Open: voidHalfWidth grows 0 -> voidHalf, over the fairness-derived length above. ---
    const openDelta = voidHalf / openSegs;
    for (let i = 0; i < openSegs; i++) this.pushSegment({ type: 'split', dVoid: openDelta, voidCenter });

    // --- Hold: steady void at full voidHalf; this is where the side-variety obstacle row(s) (if
    // rolled) sit, confined to ONE lane, leaving the other completely clean.
    const laneLo = obstacleLeftLane ? -halfWidthBW : voidCenterBW + cfg.voidHalfBW;
    const laneHi = obstacleLeftLane ? voidCenterBW - cfg.voidHalfBW : halfWidthBW;
    let laneGapCenter = null, laneRowZ = null;
    for (let i = 0; i < holdSegs; i++) {
      let obstacles = null;
      if (sideRoll === 'obstacle' && obstacleRowIndices.includes(i)) {
        const z0 = this.frontZ;
        const gapCenter = this.laneObstacleGapCenter(laneLo, laneHi, laneGapCenter, laneRowZ, z0);
        if (gapCenter !== null) {
          obstacles = this.fillObstacleCubes(laneLo, laneHi, gapCenter - OBSTACLE_MIN_GAP / 2, gapCenter + OBSTACLE_MIN_GAP / 2);
          laneGapCenter = gapCenter;
          laneRowZ = z0;
        }
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

  /**
   * Jump (Orbital only, BALLRUNMAP2ORBITALSPEC.md section 3): the floor is genuinely gone for a
   * few segments (the "gap"), the ball goes airborne, and lands on a pad that may be narrower,
   * offset, split, or at a different height than the launch pad - any combination, per section 3's
   * "pick one or more per jump". Forward speed is not player-controlled, so the launch impulse is
   * computed by sim.js AT THE MOMENT OF LAUNCH from the ball's actual current speed (section 3,
   * "the critical design rule") - this method only lays out the geometry and bakes the constants
   * (`gapLength`/`landingY`) sim.js needs to do that math, onto the first gap segment's
   * `jumpMeta`. Only reachable when `this.map.jump` exists, so Classic never calls this.
   */
  emitJump() {
    const cfg = this.map.jump;
    this.lastJumpZ = this.frontZ;

    const baseWidth = this._width; // launch pad width - never varied, only the landing pad is

    // Gap length: rolled first, then possibly shortened below once the apex is known (section 3:
    // "if a rolled gap length would exceed [the apex cap], shorten the gap at generation time").
    let gapSegs = cfg.gapMinSegs + Math.floor(this.rng() * (cfg.gapMaxSegs - cfg.gapMinSegs + 1));

    // Landing split (voidHalfWidth > 0 on the landing pad itself - "the fork decision happens
    // mid-air", section 3), rolled before width since it dictates its own dedicated width below.
    // Centered (voidCenter 0) - Jump doesn't layer Split's own "unequal" sub-variety on top,
    // that's one difficulty axis further than this map needs yet.
    const splitLanding = this.rng() < cfg.splitChance;
    const landingVoidHalfBW = splitLanding ? cfg.splitVoidHalfBW : 0;

    // Landing width: normal, narrower, or (if split) the dedicated wider split-landing width -
    // independent levers per section 3 ("pick one or more per jump"), except split's width
    // requirement always wins over narrow's, since a split pad literally cannot fit in a narrowed
    // one (see splitTotalWidthBW's own comment in config.js).
    const narrower = this.rng() < cfg.narrowChance;
    const landingWidthBW = splitLanding ? cfg.splitTotalWidthBW
      : narrower ? Math.max(this.map.minTrackWidth, baseWidth / BALL_DIAMETER - cfg.narrowStepBW)
      : baseWidth / BALL_DIAMETER;
    const landingWidth = landingWidthBW * BALL_DIAMETER;

    // Landing height: flat, or a step (drop more likely than a rise - "reads great as the deck
    // gives out", section 3). Height alone is presentation, not difficulty (section 3), but it
    // still has to feed the same launch-impulse math as everything else.
    const heightChange = this.rng() < cfg.heightChance;
    let landingY = heightChange
      ? (this.rng() < cfg.dropChance ? -1 : 1) * cfg.heightStepBW * BALL_DIAMETER
      : 0;

    const speedAtLaunch = this.estimateSpeedAt(this.frontZ);
    const maxLateralSpeed = this.lateralMaxAtSpeed(speedAtLaunch);

    // Apex cap (section 3): "cap the resulting apex... if a rolled gap length would exceed it,
    // shorten the gap". For a FLAT or DROP-DOWN landing (landingY <= 0), a shorter gap always
    // gives a smaller (or non-positive, i.e. no-apex) vy0, so shrinking monotonically toward
    // gapMinSegs works. For a STEP-UP (landingY > 0) it does NOT: vy0(t) = landingY/t +
    // 0.5*gravity*t diverges as t shrinks toward 0 just as much as it does as t grows large (a
    // genuine interior minimum, not a monotonic edge) - a very short, very fast flight leaves no
    // time to climb, so it needs an EVEN BIGGER impulse than a longer one would. Search every
    // gapSegs value actually allowed (gapMinSegs..gapMaxSegs) for whichever keeps the apex
    // smallest, using the same over-estimating speed approximation the rest of this file already
    // uses (estimateSpeedAt), since the real launch speed isn't known until sim.js actually
    // launches. If NOTHING in range fits under the cap, drop the height variety for this jump
    // entirely (flat landing) rather than ship a jump whose apex violates the spec's own cap -
    // the same "drop rather than ship a violation" principle placeObstacleRow's 3b.3 uses.
    const apexCap = cfg.apexCapBW * BALL_DIAMETER;
    const apexAt = (segs) => {
      const t = (segs * SEGMENT_LENGTH) / speedAtLaunch;
      const vy0Est = landingY / t + 0.5 * cfg.gravity * t;
      return vy0Est > 0 ? vy0Est * vy0Est / (2 * cfg.gravity) : 0;
    };
    let bestApex = Infinity, bestGapSegs = gapSegs;
    for (let g = cfg.gapMinSegs; g <= cfg.gapMaxSegs; g++) {
      const apexEst = apexAt(g);
      if (apexEst < bestApex) { bestApex = apexEst; bestGapSegs = g; }
    }
    if (bestApex <= apexCap) {
      gapSegs = bestGapSegs;
    } else {
      landingY = 0; // no in-range gap length keeps this rise under the cap - flatten it instead
    }
    const gapLength = gapSegs * SEGMENT_LENGTH;

    // Landing lateral offset ("steer in the air"): bounded by the SAME reachability math as
    // everything else on this map (landmine #2 - never hand-roll a simpler version). Given the
    // flight time at THIS event's actual (now possibly apex-cap-adjusted) gapSegs, the
    // safely-coverable lateral distance is the bare-minimum-reachable distance divided by the
    // safety factor - the algebraic inverse of how minSpacingFor derives a REQUIRED spacing from
    // a lateral distance.
    const offsetRolled = this.rng() < cfg.offsetChance;
    const offsetDir = this.rng() < 0.5 ? -1 : 1;
    const offsetFrac = 0.4 + this.rng() * 0.6; // biased but never maxed out every time, same shape as Split's 'unequal' bias
    const maxOffsetWorld = (gapSegs * SEGMENT_LENGTH / speedAtLaunch) * maxLateralSpeed / OBSTACLE_SPACING_SAFETY_FACTOR;
    const offset = offsetRolled ? offsetDir * maxOffsetWorld * offsetFrac : 0;

    // --- Gap: no floor, no collision (sim.js's AIRBORNE state, triggered off `jumpMeta` on the
    // first gap segment below). Width/void/height/wCenter all ramp smoothly across it toward the
    // landing target so the track's own data stays internally consistent even though nothing here
    // is ever rendered - the ball's actual flight arc is sim.js's own physics, independent of this
    // interpolation (worldPointAt's y is a look-ahead approximation for the camera only, see
    // render.js and track.js's worldPointAt doc comment). cx itself is NEVER touched here (no
    // `dcx`) - see pushSegment's own comment on `wCenter` for why the offset must not be a
    // centerline shift.
    const dw = (landingWidth - baseWidth) / gapSegs;
    const dVoid = (landingVoidHalfBW * BALL_DIAMETER) / gapSegs;
    const dY = landingY / gapSegs;
    const dWCenter = offset / gapSegs;
    let wCenter = 0;
    for (let i = 0; i < gapSegs; i++) {
      wCenter += dWCenter;
      this.pushSegment({
        type: 'jump', isGap: true, dw, dVoid, dY, wCenter, voidCenter: 0,
        jumpMeta: i === 0 ? { gapLength, landingY } : null,
      });
    }

    // --- Landing hold: steady at the landing target. Scoring ("+1 on a successful landing",
    // section 3) is NOT a segment flag here (unlike Split) - it's awarded directly by sim.js's own
    // landing-transition code, a one-time event rather than a z-crossing scan.
    //
    // `jumpLanding: true` on ONLY the first landing-hold segment (mirrors `jumpMeta`'s `i === 0`
    // marker on the gap above) - this is where the landing pad's real width/void/offset first
    // exist at their full target value, so it's the one place render.js needs to plant a
    // distance-visible warning gate. A grounded floor plane read from a shallow chase-cam angle
    // foreshortens to near-nothing at range (the same "holes blend into black" problem Split's
    // void has, worse here since the gap itself renders no floor at all to give a distance cue) -
    // a vertical gate is legible from much farther away because it isn't subject to that
    // foreshortening, so a player can read a narrow/offset/split landing BEFORE committing to the
    // jump instead of discovering it mid-air with no time left to react.
    for (let i = 0; i < cfg.landingHoldSegs; i++) {
      this.pushSegment({ type: 'jump', voidCenter: 0, wCenter: offset, jumpLanding: i === 0 });
    }

    // --- Recovery: ramp width/void/height/wCenter back to the launch pad's own baseline. "Keep
    // the track flat everywhere except Jump events" (section 3) - elevation/narrowing/void/offset
    // from this jump must not carry forward into whatever the generator picks next. `wCenter` has
    // no coupling with the lane-validity check below (when the landing's own voidCenter is 0,
    // wCenter cancels out of the two-lane-width formula entirely - a symmetric fork around any
    // offset center still produces two equal lanes), so it ramps evenly across the WHOLE recovery
    // regardless of how the sub-phases below split it.
    //
    // Width and voidHalfWidth are NOT so independent: when the landing pad was split, void MUST
    // reach 0 BEFORE width starts narrowing back down - shrinking both together can pass through
    // an intermediate segment where neither the full split-landing width nor the narrowed
    // single-lane width is actually present yet, breaking the two-lanes->=minTrackWidth invariant
    // even though both endpoints (landing and recovered) are individually safe (found via a
    // generated-track audit: width shrinking faster than void gives it room for produced a lane
    // briefly narrower than minTrackWidth). This mirrors exactly why Split's own event closes its
    // void (Close phase, width fixed) before narrowing width (Narrow-back phase, void already 0)
    // instead of doing both at once.
    const totalRecoverySegs = landingVoidHalfBW > 0 ? cfg.recoverySegs * 2 : cfg.recoverySegs;
    const rdY = -landingY / totalRecoverySegs;
    let recoveryStep = 0;
    if (landingVoidHalfBW > 0) {
      const rdVoid = -(landingVoidHalfBW * BALL_DIAMETER) / cfg.recoverySegs;
      for (let i = 0; i < cfg.recoverySegs; i++) {
        recoveryStep++;
        const wc = offset * (1 - recoveryStep / totalRecoverySegs);
        this.pushSegment({ type: 'jump', dVoid: rdVoid, dY: rdY, voidCenter: 0, wCenter: wc });
      }
    }
    const rdw = (baseWidth - landingWidth) / cfg.recoverySegs;
    for (let i = 0; i < cfg.recoverySegs; i++) {
      recoveryStep++;
      const wc = offset * (1 - recoveryStep / totalRecoverySegs);
      this.pushSegment({ type: 'jump', dw: rdw, dY: rdY, voidCenter: 0, wCenter: wc });
    }

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

  /** Interpolated centerline X, track width, void, and GROUND height at world distance z. Note:
   *  this `y` is the TRACK's own interpolated height (0 outside a Jump's gap/landing/recovery
   *  phases) - it is NOT the ball's actual height while airborne, which is sim.js's own
   *  physics-integrated `sim.y` and can differ from this interpolation mid-flight (this value
   *  linearly interpolates launch-to-landing height across the gap purely as a camera look-ahead
   *  approximation - see worldPointAt's own doc comment). */
  frameAt(z) {
    const seg = this.segmentAt(z);
    if (!seg) return { cx: 0, width: this.map.baseTrackWidth * BALL_DIAMETER, voidHalfWidth: 0, voidCenter: 0, wCenter: 0, y: 0, segment: null };
    const t = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
    return {
      cx: seg.cx0 + (seg.cx1 - seg.cx0) * t,
      width: seg.w0 + (seg.w1 - seg.w0) * t,
      // Split only (section 2): voidHalfWidth is interpolated exactly like width above (it ramps
      // within a segment during Open/Close); voidCenter is constant across a segment so no
      // interpolation is needed. Both are 0 for every non-Split segment.
      voidHalfWidth: (seg.void0 || 0) + ((seg.void1 || 0) - (seg.void0 || 0)) * t,
      voidCenter: seg.voidCenter || 0,
      // Jump's offset-landing variety only (section 3): constant per segment, like voidCenter -
      // see pushSegment's own doc comment for why this is not a `dcx`-driven cx shift.
      wCenter: seg.wCenter || 0,
      // Jump only (section 3): interpolated exactly like width. 0 for every non-Jump segment.
      y: (seg.y0 || 0) + ((seg.y1 || 0) - (seg.y0 || 0)) * t,
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
    if (!seg) return { cx: 0, width: this.map.baseTrackWidth * BALL_DIAMETER, y: 0, yaw: 0, nx: 1, nz: 0, segment: null };
    const t = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
    const cx = seg.cx0 + (seg.cx1 - seg.cx0) * t;
    const width = seg.w0 + (seg.w1 - seg.w0) * t;
    const y = (seg.y0 || 0) + ((seg.y1 || 0) - (seg.y0 || 0)) * t; // Jump only (section 3); 0 elsewhere
    const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
    return { cx, width, y, yaw, nx: Math.cos(yaw), nz: -Math.sin(yaw), segment: seg };
  }

  /**
   * World-space (x, y, z) for a point at track-distance z, offset laterally by `lateral` world
   * units along the track's local right vector at z (section 3's "invasive change": this now
   * returns a 3-component point, with `y` from localFrameAt's own track-height interpolation).
   * Every caller was audited (BALLRUNMAP2ORBITALSPEC.md section 3/landmine #1): render.js's
   * camera position/look-at both read this `y` (the whole point of the change - the camera's
   * look-ahead needs a real height at an arbitrary future z, and the track's own interpolation is
   * a fine approximation there even mid-gap). The BALL's own rendered height does NOT come from
   * here while airborne - sim.js's `sim.y` is the ball's REAL physics-integrated height (which can
   * legitimately differ from this track interpolation during the parabolic arc), so render.js
   * reads `sim.y` directly for ball placement instead of this function's `y`, exactly as it
   * already reads `sim.lateralOffset` (sim's own state) rather than deriving lateral from track
   * data. Obstacle cubes and floor/wall meshes read segment y0/y1 directly rather than calling
   * this function (matching how they already read w0/w1/void0/void1 directly, not through here) -
   * a deliberate, documented deviation from routing every consumer through one shared call, kept
   * because it matches this file's existing floor/obstacle convention rather than forcing an
   * unrelated refactor of code Phase 1/2 already left alone.
   */
  worldPointAt(z, lateral) {
    const f = this.localFrameAt(z);
    return { x: f.cx + lateral * f.nx, y: f.y, z: z + lateral * f.nz, yaw: f.yaw };
  }
}
