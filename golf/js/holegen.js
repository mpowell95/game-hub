// golf/js/holegen.js - the HOLE CONSTRUCTOR: it turns a compact design spec (a centreline, a
// green, a handful of hazards) into exactly the hole object golf/CLAUDE.md's "The hole-data
// format" documents. Pure and DOM-free, so golf/js/test.js exercises all of it headless.
//
// WHY THIS EXISTS. Holes 1-3 were hand-authored: roughly 60 hand-typed polygon points each, every
// one of which has to be re-checked against the green's slope grid, the tree belts and the bounds
// when anything moves. That is fine for three holes and impossible for thirty-six. Worse, it is
// impossible to REVIEW - a corridor that pinches to nothing at the dogleg looks exactly like a
// corridor that does not, in a wall of coordinate pairs.
//
// So a hole is designed as a CENTRELINE plus intent ("fairway 15 yds wide, squeezed to 9 at the
// landing zone; water short right; two bunkers at the green") and this expands it. The expansion
// is deterministic - every random choice is drawn from a seeded mulberry32, the same generator
// the tree belts already use - so the same spec is the same hole on every device and in every
// test run, and a reachability measurement means something.
//
// IT EMITS THE DOCUMENTED SHAPE AND NOTHING ELSE. There is no second format: `makeHole()`'s
// output is an ordinary hole object that validateHole() checks like any other, and a hand-authored
// hole (1-3) stays perfectly valid beside a generated one. This is the same trick `treeBelts`
// already plays - a compact authoring form expanding into the one runtime form - one level up.
//
// Units: YARDS. x across the hole (right positive), y up it away from the tee.

import { mulberry32, bboxOf } from './holes.js';

/** A 12-gon green. Shared with the hand-authored holes, which is the point: three hand-drawn
 *  blobs would each need re-checking against their own slope grid. */
export function greenPoly(cx, cy, rx, ry = rx) {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    pts.push([+(cx + rx * Math.cos(a)).toFixed(1), +(cy + ry * Math.sin(a)).toFixed(1)]);
  }
  return pts;
}

/** Build a green's slope grid. `fall` is the baseline downhill direction, `spine` spreads each
 *  half toward its own side, `back` is how much steeper the back is than the front.
 *
 *  Writing 64 pairs by hand invites a typo that nothing at runtime would notice - the read simply
 *  lies, and "putting feels wrong" is diagnosed for a week. This makes a green's break reviewable
 *  in one line. The GRID is still what ships and what the tick marks are drawn from; this only
 *  generates it. */
export function slopeGrid({ fall, spine = 0.055, back = 0.09, cols = 8, rows = 8 }) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const mag = 1 + back * r;
    for (let c = 0; c < cols; c++) {
      const dx = fall[0] * mag + (c - (cols - 1) / 2) * spine * (0.6 + back * r);
      const dy = fall[1] * mag;
      cells.push([+Math.max(-1, Math.min(1, dx)).toFixed(2), +Math.max(-1, Math.min(1, dy)).toFixed(2)]);
    }
  }
  return { cols, rows, cells };
}

/** An irregular closed blob: bunkers, lakes, waste areas. Seeded, so it is the same blob every
 *  time - a bunker that reshuffled per load would move under a ball already lying in it. */
export function blob(cx, cy, rx, ry, seed, n = 10) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.76 + rnd() * 0.46;
    pts.push([+(cx + Math.cos(a) * rx * k).toFixed(1), +(cy + Math.sin(a) * ry * k).toFixed(1)]);
  }
  return pts;
}

// --- the centreline -----------------------------------------------------------------------------

/** Catmull-Rom through the control points, resampled at a fixed arc-length step.
 *
 *  A hole is designed as three to five control points ("tee, bend right at 190, bend back at 310,
 *  pin"); everything downstream needs a dense, evenly spaced polyline with a tangent at every
 *  station. Straight segments between control points would put a corner in the fairway edge at
 *  every bend, which reads as a mowing mistake rather than as a dogleg. */
function spline(ctrl, step = 4) {
  const pts = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const dense = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const seg = Math.max(8, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
    for (let k = 0; k < seg; k++) {
      const u = k / seg; const u2 = u * u; const u3 = u2 * u;
      dense.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3),
      ]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);

  // Resample by arc length so `t` means "fraction of the way round the hole" and a bunker placed
  // at 0.9 really is 90 % of the way there, not 90 % of the control points.
  let total = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    cum.push(total);
  }
  const out = [];
  for (let s = 0; s <= total; s += step) {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    out.push([dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * f, dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * f]);
  }
  if (Math.hypot(out[out.length - 1][0] - dense[dense.length - 1][0], out[out.length - 1][1] - dense[dense.length - 1][1]) > 0.5) {
    out.push(dense[dense.length - 1]);
  }

  // Stations, each carrying its arc length, its fraction and its unit normal (+x side).
  const st = [];
  let run = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    const tx = b[0] - a[0]; const ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    if (i > 0) run += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
    st.push({ x: out[i][0], y: out[i][1], s: run, nx: ty / m, ny: -tx / m, tx: tx / m, ty: ty / m });
  }
  const len = st[st.length - 1].s;
  for (const p of st) p.t = p.s / len;
  return { stations: st, length: len };
}

/** One side of a corridor, offset from the centreline.
 *
 *  THE BACKWARD-POINT GUARD IS LOAD-BEARING. On the inside of a bend the offset points crowd
 *  together and, past a certain curvature, start marching BACKWARDS along the hole - which turns
 *  the corridor polygon into a bow tie, and a self-intersecting polygon makes the ray-cast lie
 *  lookup report "outside" for a ball plainly standing on the fairway. Dropping any point that
 *  does not advance keeps the ring simple at the cost of a slightly blunter inside corner. */
function offsetSide(stations, side, widthAt, from, to) {
  const out = [];
  for (const p of stations) {
    if (p.s < from || p.s > to) continue;
    const w = widthAt(p.t, p.s);
    const x = p.x + p.nx * w * side;
    const y = p.y + p.ny * w * side;
    if (out.length) {
      const prev = out[out.length - 1];
      // advance is measured along THIS station's tangent, so a bend cannot fake progress
      if ((x - prev[0]) * p.tx + (y - prev[1]) * p.ty <= 0.05) continue;
    }
    out.push([+x.toFixed(1), +y.toFixed(1)]);
  }
  return out;
}

/** A closed corridor polygon: up the right side, back down the left. */
function corridor(stations, widthAt, from, to) {
  const right = offsetSide(stations, +1, widthAt, from, to);
  const left = offsetSide(stations, -1, widthAt, from, to);
  return [...right, ...left.reverse()];
}

/** A one-sided ribbon between two offsets - what a tree belt or a waste area is. */
function ribbon(stations, side, innerAt, outerAt, from, to) {
  const inner = offsetSide(stations, side, innerAt, from, to);
  const outer = offsetSide(stations, side, outerAt, from, to);
  return [...inner, ...outer.reverse()];
}

/** Resolve a "somewhere along the hole" placement to a world point. `at` is the fraction of the
 *  hole, `side` is -1 left / +1 right and `off` is yards from the centreline. Every hazard is
 *  placed this way so a hole reads as a sequence of decisions rather than as coordinates. */
function place(stations, at, side, off) {
  const i = Math.min(stations.length - 1, Math.max(0, Math.round(at * (stations.length - 1))));
  const p = stations[i];
  return [p.x + p.nx * off * side, p.y + p.ny * off * side];
}

// --- the constructor ----------------------------------------------------------------------------

/**
 * Build a hole from a design spec. Everything but `n`, `par` and `path` has a default.
 *
 *   n, par            the scorecard
 *   path              centreline control points, tee first, pin last (yards)
 *   base              the surface anywhere no polygon covers        (default 'heavyRough')
 *   fw                fairway half-width in yards: a number, or [{at, w}, ...] control points
 *   rough             how far the light-rough collar extends past the fairway  (default 11)
 *   greenR / greenRy  green radii; the fringe is greenR + 6
 *   slope             {fall, spine, back} for slopeGrid
 *   bunkers           [{at, side, off, r, ry, kind, seed}]
 *   water             [{at, side, off, rx, ry, seed}] or [{poly}]
 *   belts             {left, right} each false or {from, to, depth, spacing, type, seed}
 *   trees             hand-placed specimens [{at, side, off, type}] or [{x, y, type}]
 *   treeTypes         the specimen table
 *   decor             art-only polygons, verbatim
 */
export function makeHole(spec) {
  const { stations, length } = spline(spec.path, 4);
  const tee = spec.path[0];
  const pin = spec.path[spec.path.length - 1];
  const greenR = spec.greenR || (spec.par === 3 ? 15 : 14);
  const greenRy = spec.greenRy || greenR;
  // THE COLLAR IS 6 YARDS ON BOTH AXES, not a scaled-up copy of the green. Scaling it
  // proportionally looks equivalent and is not: a wide, shallow green (Red Mesa 3 is 18 x 10)
  // comes out with 6 yards of collar across and 3.3 up the hole, so missing it long lands in the
  // desert - THE LAW rule 1's cousin, a hazard the player was never shown. Per-axis padding gives
  // every green the same collar in every direction.
  const roughPad = spec.rough == null ? 11 : spec.rough;
  const seed0 = spec.seed || (spec.n * 977 + 13);

  // Fairway half-width along the hole. A single number is a constant corridor; a list of {at, w}
  // control points is interpolated, which is how a landing zone gets pinched without pinching the
  // whole hole.
  const fwPts = Array.isArray(spec.fw) ? spec.fw : [{ at: 0, w: spec.fw || 15 }, { at: 1, w: spec.fw || 15 }];
  const fwAt = (t) => {
    if (t <= fwPts[0].at) return fwPts[0].w;
    for (let i = 1; i < fwPts.length; i++) {
      if (t <= fwPts[i].at) {
        const f = (t - fwPts[i - 1].at) / Math.max(1e-6, fwPts[i].at - fwPts[i - 1].at);
        return fwPts[i - 1].w + (fwPts[i].w - fwPts[i - 1].w) * f;
      }
    }
    return fwPts[fwPts.length - 1].w;
  };
  const roughAt = (t) => fwAt(t) + roughPad;

  // The corridor starts just ahead of the tee box and the FAIRWAY stops at the collar - the last
  // few yards are the fringe's, which is painted over the top of the rough. Running the fairway
  // into the green instead would put a mow stripe through the putting surface.
  const fwFrom = Math.min(10, length * 0.05);
  const fwTo = Math.max(fwFrom + 20, length - (greenRy + 8));
  const rgTo = length;

  const surfaces = [];
  surfaces.push({ kind: 'lightRough', poly: corridor(stations, roughAt, Math.max(0, fwFrom - 8), rgTo) });
  surfaces.push({ kind: 'fairway', poly: corridor(stations, fwAt, fwFrom, fwTo) });

  // Tree belts / scrub: a ribbon outside the rough on each side, and the SAME polygon is both the
  // `trees` lie surface and the belt the trunks are scattered through. One polygon, so the woods a
  // player can see is exactly the woods the ball can be in.
  const belts = spec.belts === undefined ? { left: {}, right: {} } : spec.belts;
  const treeBelts = [];
  for (const [key, side] of [['left', -1], ['right', +1]]) {
    const b = belts && belts[key];
    if (!b) continue;
    const depth = b.depth == null ? 22 : b.depth;
    const from = (b.from == null ? 0.02 : b.from) * length;
    const to = (b.to == null ? 0.96 : b.to) * length;
    const poly = ribbon(stations, side, (t) => roughAt(t) + 2, (t) => roughAt(t) + 2 + depth, from, to);
    if (poly.length < 6) continue;
    surfaces.push({ kind: 'trees', poly });
    treeBelts.push({ poly, type: b.type || 0, spacing: b.spacing || 9, seed: b.seed || (seed0 + (side > 0 ? 7 : 3)) });
  }

  // Water. Placed like everything else - "at 0.55 of the way round, 14 yards left" - or handed a
  // polygon outright for a shape a blob cannot be (hole 1's shoreline behind the green).
  for (const [i, w] of (spec.water || []).entries()) {
    if (w.poly) { surfaces.push({ kind: 'water', poly: w.poly }); continue; }
    const [cx, cy] = place(stations, w.at, w.side == null ? 0 : w.side, w.off || 0);
    surfaces.push({ kind: 'water', poly: blob(cx, cy, w.rx, w.ry == null ? w.rx : w.ry, w.seed || (seed0 + 40 + i), w.n || 12) });
  }

  // Fairway bunkers go under the fringe; greenside bunkers go over it, so sand still wins where a
  // bunker bites into the collar.
  const bunkers = (spec.bunkers || []).map((b, i) => {
    if (b.poly) return { ...b, poly: b.poly };
    const [cx, cy] = place(stations, b.at, b.side == null ? 1 : b.side, b.off || 0);
    const r = b.r || 6;
    return { ...b, poly: blob(cx, cy, r, b.ry || r * 0.72, b.seed || (seed0 + 80 + i), 9) };
  });
  for (const b of bunkers) if ((b.kind || 'greensideBunker') === 'fairwayBunker') surfaces.push({ kind: 'fairwayBunker', poly: b.poly });

  surfaces.push({ kind: 'fringe', poly: greenPoly(pin[0], pin[1], greenR + 6, greenRy + 6) });
  for (const b of bunkers) if ((b.kind || 'greensideBunker') !== 'fairwayBunker') surfaces.push({ kind: 'greensideBunker', poly: b.poly });
  surfaces.push({ kind: 'green', poly: 'green' });
  surfaces.push({ kind: 'tee', poly: [[tee[0] - 6, tee[1] - 5], [tee[0] + 6, tee[1] - 5], [tee[0] + 6, tee[1] + 5], [tee[0] - 6, tee[1] + 5]] });

  const green = {
    poly: greenPoly(pin[0], pin[1], greenR, greenRy),
    slope: slopeGrid(spec.slope || { fall: [0, -0.15] }),
  };

  const trees = (spec.trees || []).map((tr) => {
    if (tr.x != null) return { x: tr.x, y: tr.y, type: tr.type || 0 };
    const [x, y] = place(stations, tr.at, tr.side == null ? 0 : tr.side, tr.off || 0);
    return { x: +x.toFixed(1), y: +y.toFixed(1), type: tr.type || 0 };
  });

  const decor = spec.decor || [];

  // BOUNDS ARE MEASURED FROM WHAT WAS ACTUALLY BUILT, then padded - never authored. Every point of
  // every polygon has to sit inside them (validateHole checks it), and a hand-written box is one
  // more thing to forget when a bunker moves.
  //
  // The 45 yards BEHIND the tee is not slack: the camera clamps itself inside bounds, so a hole
  // that stopped at its own tee would pin the ball to the bottom edge of the screen, underneath
  // the club tile and the aim row, for the whole tee shot.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  const eat = (poly) => {
    const bb = bboxOf(poly);
    minX = Math.min(minX, bb.minX); maxX = Math.max(maxX, bb.maxX);
    minY = Math.min(minY, bb.minY); maxY = Math.max(maxY, bb.maxY);
  };
  for (const s of surfaces) if (s.poly !== 'green') eat(s.poly);
  eat(green.poly);
  for (const d of decor) eat(d.poly);
  for (const tr of trees) { minX = Math.min(minX, tr.x - 9); maxX = Math.max(maxX, tr.x + 9); minY = Math.min(minY, tr.y - 9); maxY = Math.max(maxY, tr.y + 9); }
  const bounds = {
    minX: Math.floor(minX - 8),
    maxX: Math.ceil(maxX + 8),
    minY: Math.floor(Math.min(minY - 8, tee[1] - 45)),
    maxY: Math.ceil(Math.max(maxY + 8, pin[1] + 55)),
  };
  // The camera frames VIEW_W_YDS (70) across; a hole narrower than that gets centred rather than
  // clamped, which is correct but makes a narrow hole feel like it is drifting. Give every hole at
  // least that much width so the pan is honest.
  if (bounds.maxX - bounds.minX < 76) {
    const mid = (bounds.maxX + bounds.minX) / 2;
    bounds.minX = Math.floor(mid - 38); bounds.maxX = Math.ceil(mid + 38);
  }

  // THE ROUTE: the playing line, coarsened to a point every ~25 yards. Art and tests only - no
  // rule reads it, exactly like `decor`. It exists because "can this hole actually be finished?"
  // is a question a test has to answer by PLAYING it, and a test player that aims at the pin from
  // the tee walks a dogleg straight into the trees and reports a perfectly good hole as broken.
  const route = [];
  for (const p of stations) if (!route.length || p.s - route[route.length - 1].s >= 25) route.push(p);
  if (route[route.length - 1] !== stations[stations.length - 1]) route.push(stations[stations.length - 1]);

  return {
    n: spec.n,
    par: spec.par,
    route: route.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]),
    cardYards: +length.toFixed(1),
    tee: [...tee],
    pin: [...pin],
    bounds,
    base: spec.base || 'heavyRough',
    surfaces,
    green,
    treeTypes: spec.treeTypes || [],
    trees,
    treeBelts,
    decor,
    // Design intent, carried for the scorecard and the hole-select screen. Never read by any rule.
    nickname: spec.nickname || '',
  };
}

/** The stock ladder's reach, used by the tests to prove a hole can actually be finished in
 *  regulation-plus: a drive plus (par - 2) fairway shots, at fairway power. */
export function reachOf(par, clubs) {
  const driver = clubs[0].carry;
  const second = clubs[1].carry;
  if (par === 3) return clubs[3].carry;      // a 2 iron off the tee
  if (par === 4) return driver + clubs[5].carry;
  return driver + second + second;
}
