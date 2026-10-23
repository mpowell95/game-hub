// eight-ball/js/engine.js - Pool as data: the table, the balls, the physics and the rules of every
// mode (8-ball, 9-ball, Cutthroat) and option (call every shot, banks only, bar obstacles). Pure, no
// DOM, deterministic (the same shot from the same table always ends the same way), so the computer
// can try shots by simulating them, a save can replay a shot that was still rolling, and an online
// match can send only the shot (Flick Soccer's model, flick-soccer/js/engine.js).
//
// CROSS-DEVICE DETERMINISM: the physics path uses only + - * / and Math.sqrt, which IEEE 754
// requires to be correctly rounded, so every phone steps a shot to the very same bits. Math.hypot,
// Math.exp, Math.sin/cos never appear on it (the rack shuffle and the obstacles use integer maths).
//
// Units are "table units": the cloth is W x H, portrait, the breaker's end (the kitchen) at the
// BOTTOM, the rack at the top. Ball 0 is the cue ball; 1-15 the numbered balls (9-ball uses 1-9).
// The table's sizes depend on the match's table version (TABLE VERSIONS below).

export const W = 100;
export const H = 200;

/**
 * TABLE VERSIONS. Every match carries `tb`, the table it was started on, and keeps it to the end:
 * an online match replays its whole log from the seed, so changing the table under a match in
 * progress would replay it into a different game (THE LAW). A match with no `tb` is table 1.
 *  1: the first table (2026-10-22): a 7-foot bar table's proportions, jaws at real WPA mouth widths.
 *  2: GamePigeon's table, measured off Matt's screenshot (2026-10-22): cloth 717 px x 1444 px, ball
 *     41 px, cushion 30 px, wood 77 px, pockets 84 px across (2 balls), the corner holes 30 px out
 *     past the cloth's corner, the side holes touching the cushion line. A ball drops as it reaches
 *     the black (`rp`), as there.
 * `useTable(tb)` points the live bindings below at one of them; every function here that takes a
 * match does it first, and so must anything that steps balls or draws them.
 */
export const TABLE_NOW = 4;
const T1 = (() => {
  const R = 2.8, G = 8.1, S = 6.2, HOLE = 5.4;
  return {
    R, G, S, padPlace: R, cushion: 3.4, wood: 6.4, mitre: 0.6, woodOff: true,
    pockets: [
      { cx: 0.25, cy: 0.25, r: HOLE, rp: HOLE, ax: 2.4, ay: 2.4 },
      { cx: W - 0.25, cy: 0.25, r: HOLE, rp: HOLE, ax: W - 2.4, ay: 2.4 },
      { cx: -4, cy: H / 2, r: HOLE, rp: HOLE, ax: -1.2, ay: H / 2 },
      { cx: W + 4, cy: H / 2, r: HOLE, rp: HOLE, ax: W + 1.2, ay: H / 2 },
      { cx: 0.25, cy: H - 0.25, r: HOLE, rp: HOLE, ax: 2.4, ay: H - 2.4 },
      { cx: W - 0.25, cy: H - 0.25, r: HOLE, rp: HOLE, ax: W - 2.4, ay: H - 2.4 },
    ],
  };
})();
const T2 = (() => {
  const px = W / 717;                         // table units per screenshot pixel
  const R = 20.5 * px, HOLE = 42 * px;
  const G = 21 * px, S = 16 * px;             // where the cushions' noses end
  const CO = -21.5 * px, SO = -42.5 * px;     // the hole centres, past the cloth's edge
  // Where a ball's centre drops: its edge reaching the black, plus a little more at the corners,
  // whose jaws are narrower than a ball (as drawn there). Tuned (tools: scratch mouth sweep,
  // 2026-10-22) so a ball goes in across the same width as on table 1, which has real WPA mouths:
  // corners 1.3-1.6 balls wide straight in to 40 degrees off, sides 1.45 straight in, 0.7 at 60.
  const RPC = HOLE + R + 2.8, RPS = HOLE + R + 1.0;
  return {
    R, G, S, padPlace: 0.3, cushion: 30 * px, wood: 77 * px, mitre: -0.8, woodOff: false,
    pockets: [
      { cx: CO, cy: CO, r: HOLE, rp: RPC, ax: 1.4, ay: 1.4 },
      { cx: W - CO, cy: CO, r: HOLE, rp: RPC, ax: W - 1.4, ay: 1.4 },
      { cx: SO, cy: H / 2, r: HOLE, rp: RPS, ax: 0.6, ay: H / 2 },
      { cx: W - SO, cy: H / 2, r: HOLE, rp: RPS, ax: W - 0.6, ay: H / 2 },
      { cx: CO, cy: H - CO, r: HOLE, rp: RPC, ax: 1.4, ay: H - 1.4 },
      { cx: W - CO, cy: H - CO, r: HOLE, rp: RPC, ax: W - 1.4, ay: H - 1.4 },
    ],
  };
})();
/** Table 3 = GamePigeon's, measured again at full size (Matt, 2026-10-23: "are you sure the balls
 *  are the same size? ... make sure the invisible hole of the pocket matches the visual and that
 *  it doesn't suck balls in"). Table 2 read the cushion's BACK edge as its end; the noses stop much
 *  further out (47 px from a corner, 45 px either side of a side pocket), with angled jaws behind
 *  them, so a ball fits between them and drops only when its centre is over the black. Ball 42 px. */
const T3 = (() => {
  const px = W / 717;
  const R = 21 * px, HOLE = 42 * px, C = 30 * px;
  const G = 47 * px, S = 45 * px;             // where the cushions' noses end
  const GB = 30 * px, SB = 39 * px;           // ...and their backs (the jaws run between)
  const CO = -21.5 * px, SO = -42.5 * px;
  return {
    R, G, S, GB, SB, jaws: true, padPlace: 0.3, cushion: C, wood: 77 * px, woodOff: false,
    pockets: [
      { cx: CO, cy: CO, r: HOLE, rp: HOLE, ax: 1.2, ay: 1.2 },
      { cx: W - CO, cy: CO, r: HOLE, rp: HOLE, ax: W - 1.2, ay: 1.2 },
      { cx: SO, cy: H / 2, r: HOLE, rp: HOLE, ax: -0.6, ay: H / 2 },
      { cx: W - SO, cy: H / 2, r: HOLE, rp: HOLE, ax: W + 0.6, ay: H / 2 },
      { cx: CO, cy: H - CO, r: HOLE, rp: HOLE, ax: 1.2, ay: H - 1.2 },
      { cx: W - CO, cy: H - CO, r: HOLE, rp: HOLE, ax: W - 1.2, ay: H - 1.2 },
    ],
  };
})();
/** Table 4 (2026-10-23): table 3 with balls 25% BIGGER than GamePigeon's (Anita, test playing it:
 *  "but these balls are very very tiny"; Matt: "do both. Just get it right"). Everything round a
 *  pocket grows with the ball (holes still 2 balls, mouths and jaws in the same proportion to it);
 *  the cushions, the rails and the cloth stay GamePigeon's. The rack has GamePigeon's small gaps
 *  (2.5 px of 42 between balls, `rackGap`). */
const T4 = (() => {
  const px = W / 717, k = 1.25;
  const R = 21 * px * k, HOLE = 2 * R, C = 30 * px;
  const G = 47 * px * k, S = 45 * px * k, GB = 30 * px * k, SB = 39 * px * k;
  const CO = -21.5 * px * k, SO = -42.5 * px * k;
  return {
    R, G, S, GB, SB, jaws: true, padPlace: 0.3, cushion: C, wood: 77 * px, woodOff: false, rackGap: 0.06 * 2 * R,
    rackMid: 13, rackKeep: 34,   // the bigger rack: obstacles kept further off it
    pockets: [
      { cx: CO, cy: CO, r: HOLE, rp: HOLE, ax: 1.5, ay: 1.5 },
      { cx: W - CO, cy: CO, r: HOLE, rp: HOLE, ax: W - 1.5, ay: 1.5 },
      { cx: SO, cy: H / 2, r: HOLE, rp: HOLE, ax: -0.75, ay: H / 2 },
      { cx: W - SO, cy: H / 2, r: HOLE, rp: HOLE, ax: W + 0.75, ay: H / 2 },
      { cx: CO, cy: H - CO, r: HOLE, rp: HOLE, ax: 1.5, ay: H - 1.5 },
      { cx: W - CO, cy: H - CO, r: HOLE, rp: HOLE, ax: W - 1.5, ay: H - 1.5 },
    ],
  };
})();
const TABLES = { 1: T1, 2: T2, 3: T3, 4: T4 };
/** A known table id, or null. */
const knownTable = (tb) => (tb === 1 || tb === 2 || tb === 3 || tb === 4 ? tb : null);
export const tableOf = (m) => (m && knownTable(m.tb)) || 1;

/** The live table: the ball's radius; a corner pocket's jaws sit CORNER_G along each rail from the
 *  corner, a side pocket's SIDE_S either side of the middle (a ball whose CENTRE crosses the line
 *  between a corner's jaws is in); the cushions as segments (their end points are the jaws, which a
 *  ball bounces off like a knuckle); the six pockets: (cx, cy, r) the hole drawn, rp where a ball's
 *  centre drops, (ax, ay) where the computer aims. TABLE is the whole record (drawing sizes too). */
export let TB = 0;
export let TABLE = T1;
export let R = T1.R;
export let CORNER_G = T1.G;
export let SIDE_S = T1.S;
export let SEGS = [];
export let POCKETS = T1.pockets;
let G = T1.G, S = T1.S;
export function useTable(tb) {
  const id = knownTable(tb) || 1;
  if (id === TB) return;
  TB = id;
  TABLE = TABLES[id];
  R = TABLE.R; G = CORNER_G = TABLE.G; S = SIDE_S = TABLE.S; POCKETS = TABLE.pockets;
  SEGS = [
    [G, 0, W - G, 0], [G, H, W - G, H],
    [0, G, 0, H / 2 - S], [0, H / 2 + S, 0, H - G],
    [W, G, W, H / 2 - S], [W, H / 2 + S, W, H - G],
    ...(TABLE.jaws ? jawSegs(TABLE) : []),
  ].map(([ax, ay, bx, by]) => ({ ax, ay, bx, by }));
}
/** The pocket jaws (table 3): from each cushion's nose end back to its back end. */
function jawSegs(T) {
  const C = T.cushion, out = [];
  for (const [sx, cx] of [[1, 0], [-1, W]]) {
    for (const [sy, cy] of [[1, 0], [-1, H]]) {
      out.push([cx + sx * T.G, cy, cx + sx * T.GB, cy - sy * C]);
      out.push([cx, cy + sy * T.G, cx - sx * C, cy + sy * T.GB]);
    }
    for (const sy of [1, -1]) out.push([cx, H / 2 - sy * T.S, cx - sx * C, H / 2 - sy * T.SB]);
  }
  return out;
}
useTable(1);

export const HEAD_Y = H * 0.75;              // the head string: the kitchen is below it
export const FOOT_Y = H * 0.25;              // the foot spot: the rack's apex
export const HEAD_SPOT = [W / 2, HEAD_Y + 12];
export const CUE = 0;
export const EIGHT = 8;
export const NINE = 9;
export const MODES = ['8', '9', 'ct'];
export const RACK_OPTIONS = [1, 2, 3];
/** Seats per mode: Cutthroat is three players. */
export const seatsOf = (mode) => (mode === 'ct' ? 3 : 2);
/** Balls per mode, the cue ball included. */
export const ballCount = (mode) => (mode === '9' ? 10 : 16);
/** The fastest a full-strength shot sends the cue ball. Per-step travel (MAX_SPEED * DT, ~1.7) stays
 *  well under R, the thinnest thing that can be hit, so nothing tunnels (docs/BUILDING-A-GAME.md,
 *  Part 3). Raise it only with the step. */
export const MAX_SPEED = 400;
/** The break hits harder than any other shot: 540 u/s, ~2.25 a step, still under R. */
const BREAK_BOOST = 1.35;
export const DT = 1 / 240;
const MAX_SHOT_SECS = 20;

// Cloth friction, from the standard sliding/rolling model (a struck ball skids, the cloth turns the
// skid into roll, then it rolls): `A_SLIDE` is the skid's deceleration (mu ~0.2), `A_ROLL` plus
// `DAMP` the roll's. `r` on a ball is the speed its spin would roll it at: v === r is pure rolling.
const A_SLIDE = 150;
const A_ROLL = 11;
const DAMP = 0.5;
const STOP = 1.0;
const E_BALL = 0.96;
const E_RAIL = 0.8;
const E_OBST = 0.6;
/** A spill (the obstacles option) drags a ball crossing it this much harder. */
const SPILL_DRAG = 70;
const SPILL_DAMP = 2.4;
/** Top spin / back spin a full tip offset puts on the cue ball, as a multiple of its speed. */
const SPIN_FOLLOW = 1.25;
const SPIN_DRAW = 1.3;

/** Which pocket a ball centred at (x, y) is in, or -1. */
export function pocketOf(x, y) {
  for (let k = 0; k < POCKETS.length; k++) {
    const p = POCKETS[k], dx = x - p.cx, dy = y - p.cy;
    if (dx * dx + dy * dy < p.rp * p.rp) return k;
  }
  if (TABLE.jaws) {
    // Table 3: only the black is in. A ball that somehow got behind the cushions goes down the
    // nearest pocket rather than off the table.
    const C = TABLE.cushion;
    if (x > -C && x < W + C && y > -C && y < H + C) return -1;
    let best = 0, bd = Infinity;
    for (let k = 0; k < POCKETS.length; k++) { const p = POCKETS[k], d = (x - p.cx) * (x - p.cx) + (y - p.cy) * (y - p.cy); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  if (x + y < G) return 0;
  if (W - x + y < G) return 1;
  if (x + (H - y) < G) return 4;
  if (W - x + (H - y) < G) return 5;
  if (x < 0) return 2;          // through a side pocket (the corners were caught above)
  if (x > W) return 3;
  // Never expected, but a ball must never escape the table.
  if (y < -R) return x < W / 2 ? 0 : 1;
  if (y > H + R) return x < W / 2 ? 4 : 5;
  return -1;
}

/** A ball's group in a mode: 8-ball 'a' (solids 1-7) / 'b' (stripes 9-15); Cutthroat 'l' (1-5),
 *  'm' (6-10), 'h' (11-15); 9-ball has none. */
export function groupOf(i, mode = '8') {
  if (mode === 'ct') return i >= 1 && i <= 5 ? 'l' : i >= 6 && i <= 10 ? 'm' : i >= 11 && i <= 15 ? 'h' : null;
  if (mode === '9') return null;
  return i >= 1 && i <= 7 ? 'a' : i >= 9 && i <= 15 ? 'b' : null;
}
export const GROUP_BALLS = {
  a: [1, 2, 3, 4, 5, 6, 7], b: [9, 10, 11, 12, 13, 14, 15],
  l: [1, 2, 3, 4, 5], m: [6, 7, 8, 9, 10], h: [11, 12, 13, 14, 15],
};
export const ballsOf = (g) => GROUP_BALLS[g] || [];
/** Cutthroat's groups, by seat: fixed from the break (seat 0 low, 1 middle, 2 high). */
const CT_GROUPS = ['l', 'm', 'h'];

/** A seeded integer RNG (xorshift32), deterministic everywhere. */
export function rng32(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const nextSeed = (seed) => ((Math.imul(seed >>> 0, 1103515245) + 12345) >>> 0) || 1;
const ball = (x, y) => ({ x, y, vx: 0, vy: 0, rx: 0, ry: 0, on: true });
const shuffle = (list, rnd) => { for (let k = list.length - 1; k > 0; k--) { const j = rnd() % (k + 1); [list[k], list[j]] = [list[j], list[k]]; } return list; };

/** A fresh rack for `mode`, shuffled from `seed`, the cue ball on the head spot.
 *  8-ball: the 8 in the middle of row three, a solid and a stripe in the back corners.
 *  9-ball: a diamond, the 1 at the front, the 9 in the middle.
 *  Cutthroat: the 1 at the front, the 6 and the 11 in the back corners. */
export function rackBalls(mode, seed) {
  const rnd = rng32(seed);
  const dx = 2 * R + (TABLE.rackGap || 0.02), dy = dx * Math.sqrt(3) / 2;
  const b = new Array(ballCount(mode));
  b[CUE] = ball(HEAD_SPOT[0], HEAD_SPOT[1]);
  if (mode === '9') {
    const rows = [1, 2, 3, 2, 1];
    const rest = shuffle([2, 3, 4, 5, 6, 7, 8], rnd);
    rows.forEach((n, row) => {
      for (let k = 0; k < n; k++) {
        const x = W / 2 + (k - (n - 1) / 2) * dx, y = FOOT_Y - row * dy;
        const id = row === 0 ? 1 : row === 2 && k === 1 ? NINE : rest.shift();
        b[id] = ball(x, y);
      }
    });
    return b;
  }
  const slots = [];
  for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) slots.push({ row, k, x: W / 2 + (k - row / 2) * dx, y: FOOT_Y - row * dy });
  let fixed;
  let pool;
  if (mode === 'ct') {
    pool = shuffle([2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15], rnd);
    const [left, right] = rnd() & 1 ? [6, 11] : [11, 6];
    fixed = (sl) => (sl.row === 0 ? 1 : sl.row === 4 && sl.k === 0 ? left : sl.row === 4 && sl.k === 4 ? right : null);
  } else {
    pool = shuffle([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15], rnd);
    const ca = pool.splice(pool.findIndex((n) => n < 8), 1)[0];
    const cb = pool.splice(pool.findIndex((n) => n > 8), 1)[0];
    const [left, right] = rnd() & 1 ? [ca, cb] : [cb, ca];
    fixed = (sl) => (sl.row === 2 && sl.k === 1 ? EIGHT : sl.row === 4 && sl.k === 0 ? left : sl.row === 4 && sl.k === 4 ? right : null);
  }
  for (const sl of slots) { const f = fixed(sl); b[f != null ? f : pool.shift()] = ball(sl.x, sl.y); }
  return b;
}

// --- bar obstacles (the obstacles option) -------------------------------------------------------
/** A beer bottle lying on its side and a cigarette butt (solid capsules), a can standing up (a solid
 *  circle), and a spill that slows any ball rolling through it. Placed from the rack's seed, clear of the rack, the head
 *  spot, the pockets and each other, so every phone draws the same table. */
export const OBSTACLE_KINDS = ['bottle', 'can', 'butt'];
export function makeObstacles(seed) {
  const rnd = rng32(nextSeed(seed ^ 0x5bd1e995));
  const out = [];
  const far = (x, y, d, list) => list.every((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) >= d * d);
  const keepOff = [{ x: W / 2, y: FOOT_Y - (TABLE.rackMid || 10) }, { x: HEAD_SPOT[0], y: HEAD_SPOT[1] }, ...POCKETS.map((p) => ({ x: p.cx, y: p.cy }))];
  const want = ['spill', OBSTACLE_KINDS[rnd() % 3], OBSTACLE_KINDS[rnd() % 3]];
  for (const k of want) {
    for (let tries = 0; tries < 200; tries++) {
      const x = 12 + (rnd() % 7601) / 100, y = 16 + (rnd() % 16801) / 100;
      if (!far(x, y, TABLE.rackKeep || 26, keepOff.slice(0, 1)) || !far(x, y, 15, keepOff.slice(1)) || !far(x, y, 17, out)) continue;
      if (k === 'spill') out.push({ k, x, y, r: 7.5 });
      else if (k === 'can') out.push({ k, x, y, r: 3.4 });
      else {
        const [ux, uy] = SPOKES[rnd() % SPOKES.length];
        const h = k === 'bottle' ? 5.4 : 3.6, r = k === 'bottle' ? 2.3 : 0.95;
        out.push({ k, x, y, r, h, ax: x - ux * h, ay: y - uy * h, bx: x + ux * h, by: y + uy * h });
      }
      break;
    }
  }
  return out;
}
/** The solid point of obstacle `o` nearest (x, y) (a circle's centre; a capsule's nearest point). */
function obstCore(o, x, y) {
  if (o.ax == null) return [o.x, o.y];
  const ex = o.bx - o.ax, ey = o.by - o.ay;
  let t = ((x - o.ax) * ex + (y - o.ay) * ey) / (ex * ex + ey * ey);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [o.ax + ex * t, o.ay + ey * t];
}
const solidObs = (obs) => (obs || []).filter((o) => o.k !== 'spill');

/** A new match. `mode` '8' | '9' | 'ct'; first to `racks`; `breaker` breaks the first rack; `seed`
 *  shuffles it; `opts` { call: every shot is called, bank: only banked pots count, obst: obstacles }. */
export function newMatch(mode = '8', racks = 1, breaker = 0, seed = 1, opts = {}, tb = TABLE_NOW) {
  const tbl = knownTable(tb) || TABLE_NOW;
  useTable(tbl);
  const md = MODES.includes(mode) ? mode : '8';
  const n = seatsOf(md);
  const st = Number.isInteger(breaker) && breaker >= 0 && breaker < n ? breaker : 0;
  const sd = (seed >>> 0) || 1;
  const o = { call: !!opts.call, bank: !!opts.bank, obst: !!opts.obst };
  return {
    v: 2,
    tb: tbl,
    mode: md,
    n,
    opts: o,
    racks: RACK_OPTIONS.includes(racks) ? racks : 1,
    scores: new Array(n).fill(0),
    rack: 1,
    seed: sd,
    breaker: st,
    turn: st,
    groups: md === 'ct' ? CT_GROUPS.slice() : null,   // 8-ball: [seat 0's, seat 1's] once decided
    out: new Array(n).fill(false),                    // Cutthroat: every ball of theirs is down
    broke: false,          // the break has been played this rack
    inHand: 'kitchen',     // 'kitchen' (behind the head string) | 'any' | null
    shots: 0,
    winner: null,
    last: null,            // what the last shot did: { foul, pots, again, rack, outs }
    obs: o.obst ? makeObstacles(sd) : [],
    b: rackBalls(md, sd),
  };
}

/** A saved match is only trusted if it has the shape this engine writes, at rest. */
export function validMatch(m) {
  if (!m || m.v !== 2 || (m.tb != null && !knownTable(m.tb)) || !MODES.includes(m.mode) || m.n !== seatsOf(m.mode)) return false;
  if (!Array.isArray(m.b) || m.b.length !== ballCount(m.mode)) return false;
  if (!RACK_OPTIONS.includes(m.racks) || !Array.isArray(m.scores) || m.scores.length !== m.n) return false;
  if (!Number.isInteger(m.turn) || m.turn < 0 || m.turn >= m.n) return false;
  if (!m.opts || !Array.isArray(m.obs) || !Array.isArray(m.out)) return false;
  return m.b.every((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y)) && m.b[CUE].on;
}

export function cloneBalls(b) { return b.map((o) => ({ x: o.x, y: o.y, vx: o.vx, vy: o.vy, rx: o.rx, ry: o.ry, on: o.on })); }
export function cloneMatch(m) {
  return {
    ...m,
    scores: m.scores.slice(), out: m.out.slice(), groups: m.groups ? m.groups.slice() : null,
    last: m.last ? { ...m.last, pots: m.last.pots.slice() } : null, b: cloneBalls(m.b),
  };
}

export const atRest = (b) => b.every((o) => !o.on || (o.vx === 0 && o.vy === 0));
export function freeze(b) { for (const o of b) { o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; } }

/** The seat after `from` that is still in (Cutthroat skips players with every ball down). */
export function nextSeat(m, from) {
  for (let k = 1; k <= m.n; k++) { const s = (from + k) % m.n; if (!m.out[s]) return s; }
  return from;
}

/** The balls `seat` may hit first. 8-ball: its group, the 8 once that is cleared, any but the 8
 *  while the table is open. 9-ball: the lowest number on the table. Cutthroat: any ball. */
export function targetsOf(m, seat) {
  const on = [];
  for (let i = 1; i < m.b.length; i++) if (m.b[i].on) on.push(i);
  if (m.mode === '9') return on.length ? [on[0]] : [];
  if (m.mode === 'ct') return on;
  if (!m.groups) { const t = on.filter((i) => i !== EIGHT); return t.length ? t : [EIGHT]; }
  const t = ballsOf(m.groups[seat]).filter((i) => m.b[i].on);
  return t.length ? t : [EIGHT];
}
export const onEight = (m, seat) => m.mode === '8' && !!m.groups && targetsOf(m, seat)[0] === EIGHT;
/** The balls that are `seat`'s own (8-ball after the groups are decided, Cutthroat always). */
export const ownBalls = (m, seat) => (m.groups ? ballsOf(m.groups[seat]) : []);
/** Must this shot name a pocket first? Every shot with the call option (not the break), and the 8
 *  in 8-ball always. */
export const needCall = (m, seat) => !!m.broke && (!!m.opts.call || onEight(m, seat));

/** Is (x, y) a legal place for the cue ball (`kitchen`: behind the head string)? */
export function canPlace(m, x, y, kitchen) {
  useTable(m.tb);
  const b = m.b;
  if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
  if (kitchen && y < HEAD_Y) return false;
  if (x + y < G + R || W - x + y < G + R || x + H - y < G + R || W - x + H - y < G + R) return false;
  const pad = TABLE.padPlace;
  for (const p of POCKETS) { const dx = x - p.cx, dy = y - p.cy; if (dx * dx + dy * dy < (p.rp + pad) * (p.rp + pad)) return false; }
  for (let i = 1; i < b.length; i++) {
    const o = b[i];
    if (!o.on) continue;
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < 4 * R * R + 0.01) return false;
  }
  for (const o of solidObs(m.obs)) {
    const [cx, cy] = obstCore(o, x, y);
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < (R + o.r + 0.05) * (R + o.r + 0.05)) return false;
  }
  return true;
}

/** The nearest legal place to (x, y) for the cue ball, searched outward in rings. */
export function nearestPlace(m, x, y, kitchen) {
  useTable(m.tb);
  const cx = Math.max(R, Math.min(W - R, x)), cy = Math.max(kitchen ? HEAD_Y : R, Math.min(H - R, y));
  if (canPlace(m, cx, cy, kitchen)) return { x: cx, y: cy };
  for (let rad = 0.5; rad < H; rad += 0.5) {
    const n = Math.max(8, Math.ceil(rad * 4));
    for (let k = 0; k < n; k++) {
      const [ux, uy] = SPOKES[Math.floor((k * SPOKES.length) / n)];
      const px = cx + ux * rad, py = cy + uy * rad;
      if (canPlace(m, px, py, kitchen)) return { x: px, y: py };
    }
  }
  return { x: HEAD_SPOT[0], y: HEAD_SPOT[1] };
}
/** Unit vectors without trigonometry: points on a square, normalised. */
const SPOKES = (() => {
  const out = [];
  for (let k = 0; k < 32; k++) {
    const t = (k % 8) / 8, side = Math.floor(k / 8);
    const [x, y] = side === 0 ? [1, -1 + 2 * t] : side === 1 ? [1 - 2 * t, 1] : side === 2 ? [-1, 1 - 2 * t] : [-1 + 2 * t, -1];
    const l = Math.sqrt(x * x + y * y);
    out.push([x / l, y / l]);
  }
  return out;
})();

/** Put ball `i` back on the table (a foul in Cutthroat, the 9 potted on a foul): on the foot spot,
 *  or the nearest free point up the long string from it, or down it. */
export function spotBall(m, i) {
  useTable(m.tb);
  const o = m.b[i];
  const free = (x, y) => {
    for (let j = 0; j < m.b.length; j++) {
      if (j === i || !m.b[j].on) continue;
      const q = m.b[j];
      if ((q.x - x) * (q.x - x) + (q.y - y) * (q.y - y) < 4 * R * R + 0.01) return false;
    }
    for (const ob of solidObs(m.obs)) {
      const [cx, cy] = obstCore(ob, x, y);
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < (R + ob.r + 0.05) * (R + ob.r + 0.05)) return false;
    }
    return true;
  };
  let y = FOOT_Y;
  for (let k = 0; k < 400; k++) {
    const yy = k % 2 ? FOOT_Y - ((k + 1) / 2) * 0.5 : FOOT_Y + (k / 2) * 0.5;
    if (yy > R + G && yy < H - R - G && free(W / 2, yy)) { y = yy; break; }
  }
  o.x = W / 2; o.y = y; o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; o.on = true;
}

/** Strike the cue ball: `power` 0-1 along unit-ish (dx, dy); `spin` -1 (draw) .. 1 (follow). The
 *  speed grows faster than the pull, so a soft touch is easy to find. */
export function strike(b, dx, dy, power, spin = 0, isBreak = false) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const p = Math.max(0, Math.min(1, power));
  const sp = MAX_SPEED * p * (0.3 + 0.7 * p) * (isBreak ? BREAK_BOOST : 1);
  const ux = dx / len, uy = dy / len;
  const c = b[CUE];
  c.vx = ux * sp; c.vy = uy * sp;
  const s = Math.max(-1, Math.min(1, spin || 0));
  const k = s >= 0 ? s * SPIN_FOLLOW : s * SPIN_DRAW;
  c.rx = ux * sp * k; c.ry = uy * sp * k;
}

/** A fresh event record for one shot: what the rules need to know about it. `kiss[i]`: ball i
 *  bounced off a cushion, an obstacle or another object ball (a bank, a kiss or a combination);
 *  `cueRail`: the cue ball did, before it touched a ball (a kick). */
export const newEvents = (n = 16) => ({ first: -1, rail: false, cueRail: false, pots: [], pocketAt: [], kiss: new Array(n).fill(false), call: -1 });

/** One physics step. `ev` collects the first ball the cue ball touched, cushions reached after
 *  that, bounces (for banks only), and every ball potted (in order, with its pocket). */
export function step(b, ev, obs) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (o.on && (o.vx !== 0 || o.vy !== 0)) { o.x += o.vx * DT; o.y += o.vy * DT; }
  }
  // Ball against ball (two balls at rest cannot have started to overlap).
  for (let i = 0; i < n; i++) {
    const p = b[i];
    if (!p.on) continue;
    const pm = p.vx !== 0 || p.vy !== 0;
    for (let j = i + 1; j < n; j++) {
      const q = b[j];
      if (!q.on || (!pm && q.vx === 0 && q.vy === 0)) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-9) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
      const over = (2 * R - d) / 2;
      p.x -= nx * over; p.y -= ny * over;
      q.x += nx * over; q.y += ny * over;
      const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (vn < 0) {
        const jm = (-(1 + E_BALL) * vn) / 2;
        p.vx -= jm * nx; p.vy -= jm * ny;
        q.vx += jm * nx; q.vy += jm * ny;
        if (ev) {
          if (i === CUE || j === CUE) { if (ev.first < 0) ev.first = i === CUE ? j : i; }
          else { ev.kiss[i] = true; ev.kiss[j] = true; }
        }
      }
    }
  }
  // Ball against cushion, jaw and obstacle.
  const solid = obs && obs.length ? solidObs(obs) : null;
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (!o.on || (o.vx === 0 && o.vy === 0)) continue;
    for (const s of SEGS) {
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      let tt = ((o.x - s.ax) * ex + (o.y - s.ay) * ey) / (ex * ex + ey * ey);
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      if (bounce(o, s.ax + ex * tt, s.ay + ey * tt, R, E_RAIL) && ev) {
        if (ev.first >= 0) ev.rail = true;
        if (i === CUE) { if (ev.first < 0) ev.cueRail = true; } else ev.kiss[i] = true;
      }
    }
    if (solid) {
      for (const ob of solid) {
        const [cx, cy] = obstCore(ob, o.x, o.y);
        if (bounce(o, cx, cy, R + ob.r, E_OBST) && ev) {
          if (i === CUE) { if (ev.first < 0) ev.cueRail = true; } else ev.kiss[i] = true;
        }
      }
    }
  }
  // Cloth: skid turns into roll, roll slows down (harder through a spill).
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (!o.on || (o.vx === 0 && o.vy === 0 && o.rx === 0 && o.ry === 0)) continue;
    let extra = 0, extraDamp = 0;
    if (obs) {
      for (const ob of obs) {
        if (ob.k !== 'spill') continue;
        const dx = o.x - ob.x, dy = o.y - ob.y;
        if (dx * dx + dy * dy < ob.r * ob.r) { extra = SPILL_DRAG; extraDamp = SPILL_DAMP; }
      }
    }
    const sx = o.vx - o.rx, sy = o.vy - o.ry;
    const sl = Math.sqrt(sx * sx + sy * sy);
    if (sl > 0.05) {
      const a = A_SLIDE * DT;
      if (3.5 * a >= sl) {
        const vx = (5 * o.vx + 2 * o.rx) / 7, vy = (5 * o.vy + 2 * o.ry) / 7;
        o.vx = vx; o.vy = vy; o.rx = vx; o.ry = vy;
      } else {
        const ux = sx / sl, uy = sy / sl;
        o.vx -= ux * a; o.vy -= uy * a;
        o.rx += ux * a * 2.5; o.ry += uy * a * 2.5;
      }
      const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      if (extra && sp > 0) {
        const ns = sp - (extra + extraDamp * sp) * DT;
        const f = ns > 0 ? ns / sp : 0;
        o.vx *= f; o.vy *= f; o.rx *= f; o.ry *= f;
      }
      const sp2 = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      if (sp2 < STOP && Math.sqrt((o.vx - o.rx) * (o.vx - o.rx) + (o.vy - o.ry) * (o.vy - o.ry)) < STOP) { o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; }
    } else {
      const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      const ns = sp - (A_ROLL + extra + (DAMP + extraDamp) * sp) * DT;
      if (ns < STOP) { o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; continue; }
      o.vx *= ns / sp; o.vy *= ns / sp;
      o.rx = o.vx; o.ry = o.vy;
    }
  }
  // Pockets.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (!o.on) continue;
    const k = pocketOf(o.x, o.y);
    if (k < 0) continue;
    o.on = false; o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0;
    if (ev) { ev.pots.push(i); ev.pocketAt.push(k); }
  }
}

/** A moving ball `o` against the solid point (cx, cy) at distance `reach`: pushed out and bounced.
 *  Returns true when it was moving into it (a real bounce). */
function bounce(o, cx, cy, reach, e) {
  const dx = o.x - cx, dy = o.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return false;
  let d = Math.sqrt(d2), nx, ny;
  if (d < 1e-9) {
    const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
    nx = -o.vx / sp; ny = -o.vy / sp; d = 0;
  } else { nx = dx / d; ny = dy / d; }
  o.x += nx * (reach - d); o.y += ny * (reach - d);
  const vn = o.vx * nx + o.vy * ny;
  if (vn >= 0) return false;
  o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny;
  const rn = o.rx * nx + o.ry * ny;
  if (rn < 0) { o.rx -= (1 + e) * rn * nx; o.ry -= (1 + e) * rn * ny; }
  return true;
}

export const maxShotSteps = () => Math.round(MAX_SHOT_SECS / DT);

/** Run a shot to the end on balls `b` (mutated). Returns the step count. */
export function runToRest(b, ev, maxSecs = MAX_SHOT_SECS, obs = null) {
  const max = Math.round(maxSecs / DT);
  for (let k = 1; k <= max; k++) {
    step(b, ev, obs);
    if (atRest(b)) { freeze(b); return k; }
  }
  freeze(b);
  return max;
}

/** A shot, as stored: { x, y } where the cue ball is put first (only with the ball in hand), the
 *  direction (dx, dy), the power p 0-1, the spin s -1..1, and c, the pocket called (0-5) when the
 *  shot needs one. Puts it in motion on `m.b` and returns the event record to step it with. Null if
 *  it is not a shot this position allows. */
export function begin(m, shot) {
  useTable(m.tb);
  if (!shot || ![shot.dx, shot.dy, shot.p].every(Number.isFinite)) return null;
  if (m.inHand && Number.isFinite(shot.x) && Number.isFinite(shot.y)) {
    if (!canPlace(m, shot.x, shot.y, m.inHand === 'kitchen')) return null;
    m.b[CUE].x = shot.x; m.b[CUE].y = shot.y;
  }
  strike(m.b, shot.dx, shot.dy, shot.p, shot.s || 0, !m.broke);
  const ev = newEvents(m.b.length);
  ev.targets = targetsOf(m, m.turn);
  ev.isBreak = !m.broke;
  ev.needCall = needCall(m, m.turn);
  ev.call = Number.isInteger(shot.c) && shot.c >= 0 && shot.c < 6 ? shot.c : -1;
  return ev;
}

/** Play a whole shot at once (the computer's look-ahead, a save's rolling shot). Returns settle's. */
export function play(m, shot, maxSecs) {
  useTable(m.tb);
  const ev = begin(m, shot);
  if (!ev) return null;
  runToRest(m.b, ev, maxSecs, m.obs);
  return settle(m, ev);
}

/**
 * A shot has come to rest: the rules.
 *  Fouls, every mode: the cue ball potted; no ball hit; nothing potted and no ball reaching a
 *  cushion after the hit. 8-ball and 9-ball also: the first ball hit not the shooter's target (the
 *  9-ball break must hit the 1 too). A foul gives the next player the ball in hand anywhere; in
 *  Cutthroat it also brings one potted ball of each other player back onto the table.
 *  A pot only COUNTS for the shooter (keeps the turn, decides a group, wins with the 8 or 9) when it
 *  went into the called pocket (when one had to be called) and, with banks only, bounced off
 *  something on its way (or the cue ball did, first). A ball that drops without counting stays down.
 *  8-ball: open table until the first counting pot after the break; the 8 wins only as the target,
 *  clean and counting, and loses the rack otherwise (on the break it wins, unless a scratch).
 *  9-ball: the 9 wins whenever it counts (on the break too); a 9 that drops on a foul, or without
 *  counting, comes back to the foot spot.
 *  Cutthroat: seat 0 keeps 1-5 on the table, seat 1 6-10, seat 2 11-15; a player whose balls are all
 *  down is out; the last one in wins the rack. The shooter goes again after potting someone else's.
 * Returns { kind: 'again' | 'turn' | 'foul' | 'rack' | 'win', foul, rackWinner, outs }.
 */
export function settle(m, ev) {
  useTable(m.tb);
  freeze(m.b);
  relax(m.b);
  m.shots++;
  const seat = m.turn;
  const pots = ev.pots.filter((i) => i !== CUE);
  const scratch = ev.pots.includes(CUE);
  const isBreak = !!ev.isBreak;
  const targets = ev.targets || targetsOf(m, seat);
  const counts = (i) => {
    if (ev.needCall && ev.pocketAt[ev.pots.indexOf(i)] !== ev.call) return false;
    if (m.opts.bank && !isBreak && !(ev.cueRail || ev.kiss[i])) return false;
    return true;
  };
  let foul = null;
  if (scratch) foul = 'scratch';
  else if (ev.first < 0) foul = 'nohit';
  else if (m.mode !== 'ct' && (!isBreak || m.mode === '9') && !targets.includes(ev.first)) foul = 'wrong';
  else if (!isBreak && !pots.length && !ev.rail) foul = 'norail';
  m.broke = true;
  m.inHand = null;
  if (scratch) m.b[CUE].on = true;
  const counted = pots.filter(counts);
  m.last = { foul, pots, again: false, counted };

  if (m.mode === '8') {
    if (pots.includes(EIGHT)) {
      const wins = isBreak ? !foul : (!foul && targets.length === 1 && targets[0] === EIGHT && counts(EIGHT));
      return endRack(m, wins ? seat : seat ^ 1, foul);
    }
    if (!foul && !m.groups && !isBreak) {
      const g = counted.map((i) => groupOf(i, '8')).find(Boolean);
      if (g) m.groups = seat === 0 ? [g, g === 'a' ? 'b' : 'a'] : [g === 'a' ? 'b' : 'a', g];
    }
    const mine = m.groups ? counted.filter((i) => groupOf(i, '8') === m.groups[seat]) : counted;
    return passOn(m, foul, !foul && mine.length > 0);
  }

  if (m.mode === '9') {
    if (pots.includes(NINE)) {
      if (!foul && counts(NINE)) return endRack(m, seat, null);
      spotBall(m, NINE);
    }
    return passOn(m, foul, !foul && counted.length > 0);
  }

  // Cutthroat.
  if (foul) {
    for (let s = 0; s < m.n; s++) {
      if (s === seat) continue;
      const down = ballsOf(m.groups[s]).filter((i) => !m.b[i].on);
      if (down.length) spotBall(m, down[0]);
    }
  }
  const outs = [];
  for (let s = 0; s < m.n; s++) {
    const was = m.out[s];
    m.out[s] = ballsOf(m.groups[s]).every((i) => !m.b[i].on);
    if (m.out[s] && !was) outs.push(s);
  }
  m.last.outs = outs;
  const left = [];
  for (let s = 0; s < m.n; s++) if (!m.out[s]) left.push(s);
  if (left.length <= 1) {
    // The last one standing; if one shot put out the last two, the shooter's pot decides it.
    const w = left.length ? left[0] : seat;
    const r = endRack(m, w, foul);
    r.outs = outs;
    return r;
  }
  const theirs = counted.filter((i) => groupOf(i, 'ct') !== m.groups[seat]);
  const r = passOn(m, foul, !foul && !m.out[seat] && theirs.length > 0);
  r.outs = outs;
  return r;
}

/** The turn after a shot: the same player again, or the next one (with the ball in hand after a
 *  foul, the cue ball back on the table if it went down). */
function passOn(m, foul, again) {
  const seat = m.turn;
  if (foul) {
    m.turn = nextSeat(m, seat);
    m.inHand = 'any';
    const c = m.b[CUE];
    if (!c.on || foul === 'scratch') { c.on = true; const p = nearestPlace(m, HEAD_SPOT[0], HEAD_SPOT[1], false); c.x = p.x; c.y = p.y; }
    m.last.again = false;
    return { kind: 'foul', foul };
  }
  if (!again || m.out[seat]) m.turn = nextSeat(m, seat);
  m.last.again = !!again && !m.out[seat];
  return { kind: m.last.again ? 'again' : 'turn', foul: null };
}

/** Balls at rest are never left overlapping: a tight cluster resolved one pair at a time can stop
 *  with two still a hair inside each other. Nudged apart, position only, a few passes. */
function relax(b) {
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < b.length; i++) {
      const p = b[i];
      if (!p.on) continue;
      for (let j = i + 1; j < b.length; j++) {
        const q = b[j];
        if (!q.on) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R - 1e-6) continue;
        let d = Math.sqrt(d2), nx = 1, ny = 0;
        if (d > 1e-9) { nx = dx / d; ny = dy / d; } else d = 0;
        const over = (2 * R - d) / 2 + 1e-4;
        p.x -= nx * over; p.y -= ny * over; q.x += nx * over; q.y += ny * over;
        moved = true;
      }
    }
    for (const o of b) {
      if (!o.on) continue;
      if (TABLE.jaws) {
        // Table 3: pushed back off a cushion only along its straight run, never inside a mouth.
        const runY = o.y > G && o.y < H - G && (o.y < H / 2 - S || o.y > H / 2 + S), runX = o.x > G && o.x < W - G;
        if (runY && o.x < R) o.x = R;
        if (runY && o.x > W - R) o.x = W - R;
        if (runX && o.y < R) o.y = R;
        if (runX && o.y > H - R) o.y = H - R;
        continue;
      }
      if (o.x < R && pocketOf(o.x, o.y) < 0 && (o.y < H / 2 - S || o.y > H / 2 + S)) o.x = R;
      if (o.x > W - R && pocketOf(o.x, o.y) < 0 && (o.y < H / 2 - S || o.y > H / 2 + S)) o.x = W - R;
      if (o.y < R && pocketOf(o.x, o.y) < 0) o.y = R;
      if (o.y > H - R && pocketOf(o.x, o.y) < 0) o.y = H - R;
    }
    if (!moved) break;
  }
}

function endRack(m, w, foul) {
  m.scores[w]++;
  m.last = { ...(m.last || { pots: [] }), foul, again: false, rack: w };
  if (m.scores[w] >= m.racks) {
    m.winner = w;
    m.turn = w;
    return { kind: 'win', foul, rackWinner: w };
  }
  return { kind: 'rack', foul, rackWinner: w };
}

/** The next rack after a rack has ended (`settle` said 'rack'): the break passes to the next seat. */
export function nextRack(m) {
  useTable(m.tb);
  m.rack++;
  m.seed = nextSeed(m.seed);
  m.breaker = (m.breaker + 1) % m.n;
  m.turn = m.breaker;
  m.groups = m.mode === 'ct' ? CT_GROUPS.slice() : null;
  m.out = new Array(m.n).fill(false);
  m.broke = false;
  m.inHand = 'kitchen';
  m.obs = m.opts.obst ? makeObstacles(m.seed) : [];
  m.b = rackBalls(m.mode, m.seed);
}

/** A ray from (x, y) along unit (dx, dy), as a swept ball: the first thing it touches within `len`,
 *  as { t, hit } (hit: a ball index, -1 a cushion, -2 an obstacle) or null. */
function sweep(b, obs, x, y, dx, dy, len, skip) {
  let best = len, hit = null;
  for (let j = 0; j < b.length; j++) {
    if (skip.includes(j) || !b[j].on) continue;
    const t = rayCircle(x, y, dx, dy, b[j].x, b[j].y, 2 * R);
    if (t != null && t < best) { best = t; hit = j; }
  }
  for (const o of solidObs(obs)) {
    // A capsule is five circles along it: close enough for a guide.
    const pts = o.ax != null ? [0, 0.25, 0.5, 0.75, 1].map((f) => [o.ax + (o.bx - o.ax) * f, o.ay + (o.by - o.ay) * f]) : [[o.x, o.y]];
    for (const [ox, oy] of pts) {
      const t = rayCircle(x, y, dx, dy, ox, oy, R + o.r);
      if (t != null && t < best) { best = t; hit = -2; }
    }
  }
  const x0 = R, x1 = W - R, y0 = R, y1 = H - R;
  const tx = dx > 0 ? (x1 - x) / dx : dx < 0 ? (x0 - x) / dx : Infinity;
  const ty = dy > 0 ? (y1 - y) / dy : dy < 0 ? (y0 - y) / dy : Infinity;
  const tw = Math.max(0, Math.min(tx, ty));
  if (tw < best) { best = tw; hit = -1; }
  return hit == null ? null : { t: best, hit };
}
function rayCircle(x, y, dx, dy, cx, cy, rr) {
  const fx = cx - x, fy = cy - y;
  const along = fx * dx + fy * dy;
  if (along <= 0) return null;
  const perp2 = fx * fx + fy * fy - along * along;
  if (perp2 >= rr * rr) return null;
  const t = along - Math.sqrt(rr * rr - perp2);
  return t >= 0 ? t : null;
}

/**
 * The aim guide for the cue ball sent along unit (dx, dy): where it first touches something, as
 * { x, y, hit } (the cue ball's CENTRE there; hit: a ball, -1 a cushion, -2 an obstacle), with, when
 * it is a ball, where that ball heads (`ox, oy` unit). Display only, never on the physics path.
 */
export function aimContact(m, dx, dy, range = 260) {
  useTable(m.tb);
  const o = m.b[CUE];
  const s = sweep(m.b, m.obs, o.x, o.y, dx, dy, range, [CUE]);
  if (!s) return null;
  const x = o.x + dx * s.t, y = o.y + dy * s.t;
  const out = { x, y, hit: s.hit };
  if (s.hit >= 0) {
    const q = m.b[s.hit];
    let nx = q.x - x, ny = q.y - y;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl;
    out.ox = nx; out.oy = ny;
  }
  return out;
}

/** Where a ball at (x, y) rolling along unit (dx, dy) stops within `len`: at the first ball (other
 *  than `skip`), obstacle or cushion. For drawing the object ball's path. */
export function rayStop(m, x, y, dx, dy, len, skip) {
  useTable(m.tb);
  const s = sweep(m.b, m.obs, x, y, dx, dy, len, skip);
  const t = s ? s.t : len;
  return { x: x + dx * t, y: y + dy * t };
}
