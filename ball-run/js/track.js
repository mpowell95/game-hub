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
  NARROW_STEP, CURVE_SEGMENTS, CURVE_LATERAL_PER_SEGMENT, OBSTACLE_MIN_GAP, BALL_DIAMETER,
  TUNNEL_SEGMENTS, TUNNEL_MIN_STRAIGHT_AFTER, difficultyConfig,
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
    this.lastTunnelZ = -this.cfg.tunnelSpacingMeters; // allow an early tunnel
    this.straightsOwed = 6; // guarantee a safe, obstacle-free start (also reused after tunnels)
    this.lastWasTunnel = false;
    this.pendingObstacleGapCenter = null; // previous obstacle row's gap center, for reachability chaining

    this._cx = 0; // running centerline X as segments are appended
    this._width = BASE_TRACK_WIDTH * BALL_DIAMETER;

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
    let type = pickWeighted(this.rng, cfg.weights);

    // Global sanity rules (brief section 6): never two tunnels back-to-back,
    // always a straight beat right after a tunnel exit, and tunnels only spawn
    // once their meter cadence has elapsed.
    if (type === 'tunnel' && (this.lastWasTunnel || this.frontZ - this.lastTunnelZ < cfg.tunnelSpacingMeters)) {
      type = 'straight';
    }
    if (this.straightsOwed > 0) { type = 'straight'; this.straightsOwed--; }

    if (type === 'straight') this.emitStraight();
    else if (type === 'curve') this.emitCurve();
    else if (type === 'narrow') this.emitNarrow();
    else if (type === 'obstacle') this.emitObstacleRows();
    else if (type === 'tunnel') this.emitTunnel();
    else this.emitStraight();

    this.lastWasTunnel = type === 'tunnel';
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
        // from the previous row's gap at max lateral speed, given forward speed.
        // A generous +/-1.5 ball-widths per row keeps every spawn winnable.
        const reach = 1.5;
        const lo = Math.max(-maxGapCenterOffset, prevGapCenter - reach);
        const hi = Math.min(maxGapCenterOffset, prevGapCenter + reach);
        gapCenter = lo + this.rng() * Math.max(0, hi - lo);
      } else {
        gapCenter = (this.rng() * 2 - 1) * maxGapCenterOffset;
      }
      const obstacles = this.buildObstacleRow(widthBW, gapBW, gapCenter);
      this.pushSegment({ type: 'obstacle', obstacles });
      // A clear segment between rows so the player can react.
      if (r < rows - 1) this.pushSegment({ type: 'straight' });
      prevGapCenter = gapCenter;
    }
    this.pendingObstacleGapCenter = prevGapCenter;
  }

  /** Cubes fill the track minus a `gapBW`-wide safe gap centered at `gapCenter` (ball-widths, relative to centerline). */
  buildObstacleRow(widthBW, gapBW, gapCenter) {
    const half = widthBW / 2;
    const gapLo = gapCenter - gapBW / 2;
    const gapHi = gapCenter + gapBW / 2;
    const cubes = [];
    // Left fill (from left edge to the gap), right fill (from the gap to right edge),
    // one cube per ball-width, clamped so cubes never straddle the safe gap.
    for (let x = -half + 0.5; x < gapLo; x += 1) cubes.push({ lateral: x });
    for (let x = gapHi + 0.5; x < half; x += 1) cubes.push({ lateral: x });
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
}
