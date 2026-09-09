// pinball/design/_playtest.mjs - PLAY the Claude Design board with this game's real solver.
//
// The export is geometry plus a FOOTPRINTS list, not a game. This turns those footprints into
// js/physics.js colliders and runs two things on them:
//
//   1. THE REST SWEEP. Drop a ball, at rest, on every point of a grid over a level; run six seconds;
//      did it reach the drain? Anything else is a trap, reported with the parts holding it. Same
//      instrument as sweep-pinball-rests.mjs and the same reason: a soak is a sample and misses the
//      corner it never visits.
//   2. A LAUNCH TRACE. Fire from the plunger and follow the ball, so "can it even get onto the
//      board" is answered by the solver rather than by reading the file.
//
// Units: the export is in metres with a 0.027 m ball; this engine uses table units with BALL_R 9,
// so one metre is 666.67 units - the same K STARHUB was converted at - and one reference pixel is
// 0.3513 units. Nothing is re-tuned.
import { step, makeBall, PHYS_DT, BALL_R, seg, circle, flipper } from '../js/physics.js';
import { FOOTPRINTS, TRANSITIONS, PARTS } from './board.js';

const K = 666.67;                       // units per metre
const S = 0.000527, CX = 493, CY = 995; // the export's own pixel scale
const U = S * K;                        // units per reference pixel = 0.3513
const ux = (m) => (m / S + CX) * U;     // metres -> units
const uy = (m) => (m / S + CY) * U;
const GRAVITY = 515;
const held = process.argv.includes('--held');
const LEVEL = Number((process.argv.find((a) => a.startsWith('--level=')) || '--level=1').split('=')[1]);
const GRID = Number((process.argv.find((a) => a.startsWith('--step=')) || '--step=10').split('=')[1]);

/** The whole cabinet, in units. */
const W = 1105 * U, H = 1990 * U;
const DRAIN_Y = 1880 * U;
const DRAIN_X = [390 * U, 600 * U];

function build(level) {
  const colliders = [], flippers = [];
  for (const f of FOOTPRINTS[level]) {
    if (f.dynamic) {
      const px = ux(f.pivot[0]), py = uy(f.pivot[1]);
      const len = f.length * K, rest = f.restAngle, sweep = f.sweep;
      flippers.push(flipper(px, py, len, rest, rest + sweep, { id: f.name, r: f.rPivot * K }));
      continue;
    }
    const opt = { id: f.name, e: 0.42, mu: f.kicks ? 0.02 : 0.05, kick: f.kicks ? 300 : 0 };
    if (f.shape === 'circle') colliders.push(circle(ux(f.c[0]), uy(f.c[1]), f.r * K, opt));
    else colliders.push(seg(ux(f.a[0]), uy(f.a[1]), ux(f.b[0]), uy(f.b[1]), { ...opt, r: f.r * K }));
  }
  return { colliders, flippers };
}

const built = build(LEVEL);
for (const f of built.flippers) { f.pressed = held; f.angle = held ? f.up : f.rest; }
const world = { colliders: built.colliders, flippers: built.flippers, gravity: GRAVITY, drag: 0.16, nudgeX: 0, nudgeY: 0 };

const blocked = (x, y) => built.colliders.some((c) => {
  if (c.t === 'circle') return Math.hypot(x - c.x, y - c.y) < c.r + BALL_R - 1;
  const dx = c.bx - c.ax, dy = c.by - c.ay, l2 = dx * dx + dy * dy || 1;
  let t = ((x - c.ax) * dx + (y - c.ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (c.ax + dx * t), y - (c.ay + dy * t)) < c.r + BALL_R - 1;
});

// A BAND IS SOLID, AND ITS FOOTPRINT IS ONLY ITS TWO EDGES - thin capsules carrying a `solidSide`
// tag. So a ball dropped BETWEEN them sits in a pocket that does not exist on the real table, and
// the first run of this probe duly reported 37 balls "at rest" inside the right arch leg. Points
// inside a band are not drops.
const BANDS = PARTS.filter((q) => q.type === 'band');
const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inBand = (X, Y) => {
  const qx = X / U, qy = Y / U;
  return BANDS.some((q) => inPoly(qx, qy, [...q.outer,
    [q.outer[q.outer.length - 1][0], q.yEndR], [q.inner[q.inner.length - 1][0], q.yEndR],
    ...[...q.inner].reverse(), [q.inner[0][0], q.yEndL], [q.outer[0][0], q.yEndL]]));
};
const onFlipper = (x, y) => built.flippers.some((f) => {
  const tx = f.px + Math.cos(f.angle) * f.len, ty = f.py + Math.sin(f.angle) * f.len;
  const dx = tx - f.px, dy = ty - f.py, l2 = dx * dx + dy * dy || 1;
  let t = ((x - f.px) * dx + (y - f.py) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (f.px + dx * t), y - (f.py + dy * t)) <= f.r + BALL_R + 6;
});

// On level 2 "got out" means falling off the deck's front edge, not reaching the drain.
const DECK_EDGE = 724 * U;
const OUT = (b) => (LEVEL === 2 ? b.y > DECK_EDGE : b.y > DRAIN_Y + BALL_R * 2) || b.x < -40 || b.x > W + 40;

// IS THIS POINT EVEN REACHABLE? A ball enters level 1 in exactly three places - the foot of each
// ramp and the drop hole - so anywhere it cannot walk to from one of those is a sealed void, and a
// ball resting there is an artefact of dropping one in rather than a trap a player can find. A
// flood fill over the free cells answers it, and it is what turns '65 at rest' into a real number.
const RSTEP = 10 * U;
const key = (i, j) => i + ',' + j;
const free = new Map();
for (let i = 0; i * RSTEP < W; i++) for (let j = 0; j * RSTEP < H; j++) {
  const x = i * RSTEP, y = j * RSTEP;
  if (!blocked(x, y) && !inBand(x, y)) free.set(key(i, j), true);
}
const seen = new Set();
const q = [];
for (const [sx, sy] of [[87, 908], [901, 908], [500, 785]]) {
  const i = Math.round(sx * U / RSTEP), j = Math.round(sy * U / RSTEP);
  if (free.has(key(i, j))) { seen.add(key(i, j)); q.push([i, j]); }
}
while (q.length) {
  const [i, j] = q.pop();
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const k = key(i + di, j + dj);
    if (free.has(k) && !seen.has(k)) { seen.add(k); q.push([i + di, j + dj]); }
  }
}
const reachable = (x, y) => seen.has(key(Math.round(x / RSTEP), Math.round(y / RSTEP)));
console.log('  reachable free cells: ' + seen.size + ' of ' + free.size);

const SECS = 6, STEPS = Math.round(SECS / PHYS_DT);
let dropped = 0, out = 0, moving = 0, knife = 0, sealed = 0;
const stuck = [];
const YMAX = (LEVEL === 2 ? DECK_EDGE : DRAIN_Y) - 12;
for (let x = 12 * U; x <= W - 12 * U; x += GRID) {
  for (let y = 30 * U; y <= YMAX; y += GRID) {
    if (blocked(x, y) || inBand(x, y)) continue;
    dropped++;
    const b = makeBall(x, y, 0, 0);
    const touched = new Set();
    let escaped = false;
    for (let i = 0; i < STEPS; i++) {
      const late = i > STEPS - 120;
      step(world, [b], late ? (k, id) => { if (id) touched.add(id); } : null);
      if (OUT(b)) { escaped = true; break; }
    }
    if (escaped) { out++; continue; }
    if (onFlipper(b.x, b.y)) { out++; continue; }
    const v = Math.hypot(b.vx, b.vy);
    if (v > 25) { moving++; continue; }
    let freed = false;
    for (const push of [-16, 16]) {
      const c = makeBall(b.x, b.y, push, 0);
      for (let i = 0; i < STEPS && !freed; i++) { step(world, [c], null); if (OUT(c)) freed = true; }
      if (freed) break;
    }
    if (freed) { knife++; continue; }
    if (!reachable(b.x, b.y)) { sealed++; continue; }
    stuck.push([b.x, b.y, [...touched].join('+')]);
  }
}
const clusters = [];
for (const [x, y, ids] of stuck) {
  const c = clusters.find((k) => Math.hypot(k.x - x, k.y - y) < 22);
  if (c) { c.n++; c.ids.add(ids); continue; }
  clusters.push({ x, y, n: 1, ids: new Set([ids]) });
}
clusters.sort((a, b) => b.n - a.n);

const px = (u) => Math.round(u / U);
console.log(`DESIGN BOARD, level ${LEVEL}${held ? ' [flippers HELD]' : ''} - ${built.colliders.length} colliders, ${built.flippers.length} flippers`);
console.log(`  ${dropped} drops, ${SECS}s each`);
console.log(`  got out: ${out} (${(100 * out / dropped).toFixed(1)}%)`);
console.log(`  still in play at ${SECS}s: ${moving}`);
console.log(`  knife-edge balances a nudge frees: ${knife}`);
console.log(`  at rest in a SEALED VOID a ball cannot reach: ${sealed}`);
console.log(`  AT REST somewhere else: ${stuck.length} in ${clusters.length} distinct places`);
for (const c of clusters.slice(0, 14)) {
  console.log(`    px (${px(c.x)}, ${px(c.y)})  ${c.n} starts   held by: ${[...c.ids].filter(Boolean).slice(0, 2).join(' / ') || '(nothing)'}`);
}
if (clusters.length > 14) console.log(`    ...and ${clusters.length - 14} more`);

// --- the launch, traced ---------------------------------------------------------------------------
if (LEVEL === 1) {
  const t = TRANSITIONS.find((x) => x.name === 'launch');
  console.log(`\nLAUNCH TRACE (chute at px 990..1046; transition: ${t ? t.name : 'NONE DECLARED'})`);
  // Clear of the plunger stop: started ON it, the ball is created overlapping and the first trace
  // reported a failed launch that was the harness, not the board.
  const b = makeBall(1020 * U, 1840 * U, 0, -1050);
  const w2 = { ...world };
  // The HIGHEST point reached is the honest measure. Running it to a standstill instead reports a
  // failure that is only the ball coming back down - in the game the launch transition catches it
  // at the top and puts it on the deck.
  let top = 1e9;
  for (let i = 0; i < Math.round(4 / PHYS_DT); i++) {
    step(w2, [b], null);
    if (b.y < top) top = b.y;
    if (b.y < 40 * U || OUT(b)) break;
  }
  console.log(`  highest point reached: py ${px(top)}  (the deck edge is py 640, the top wall py 40)`);
  console.log(`  clears the chute onto the deck: ${top < 640 * U ? 'YES' : 'NO'}`);
}
