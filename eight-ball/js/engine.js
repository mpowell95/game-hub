// eight-ball/js/engine.js - Pool as data: the table, the balls, the physics and the 8-ball rules.
// Pure, no DOM, deterministic (the same shot from the same table always ends the same way), so the
// computer can try shots by simulating them, a save can replay a shot that was still rolling, and a
// future online mode can send only the shot (Flick Soccer's model, flick-soccer/js/engine.js).
//
// CROSS-DEVICE DETERMINISM: the physics path uses only + - * / and Math.sqrt, which IEEE 754
// requires to be correctly rounded, so every phone steps a shot to the very same bits. Math.hypot,
// Math.exp, Math.sin/cos never appear on it (the rack's shuffle uses integer maths only).
//
// Units are "table units": the cloth is W x H, portrait, the breaker's end (the kitchen) at the
// BOTTOM, the rack at the top. Ball 0 is the cue ball, 1-7 group 'a', 8 the eight, 9-15 group 'b'.

export const W = 100;
export const H = 200;
export const R = 2.6;
/** A corner pocket's jaws sit this far along each rail from the corner; a ball whose CENTRE crosses
 *  the line between them is in. The side pockets' jaws are this far either side of the middle. */
export const CORNER_G = 7.8;
export const SIDE_S = 6.2;
export const HEAD_Y = H * 0.75;              // the head string: the kitchen is below it
export const FOOT_Y = H * 0.25;              // the foot spot: the rack's apex
export const HEAD_SPOT = [W / 2, HEAD_Y + 12];
export const CUE = 0;
export const EIGHT = 8;
export const N_BALLS = 16;
export const RACK_OPTIONS = [1, 2, 3];
/** The fastest a full-strength shot sends the cue ball. Per-step travel (MAX_SPEED * DT, ~1.7) stays
 *  well under R, the thinnest thing that can be hit, so nothing tunnels (docs/BUILDING-A-GAME.md,
 *  Part 3). Raise it only with the step. */
export const MAX_SPEED = 400;
/** The break hits harder than any other shot (a break cue, a full swing): 540 u/s, ~2.25 a step,
 *  still under R. Without it a full rack hardly opens (measured: 0.1 balls potted a break). */
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
/** Top spin / back spin a full tip offset puts on the cue ball, as a multiple of its speed. */
const SPIN_FOLLOW = 1.25;
const SPIN_DRAW = 1.3;

/** The cushions, as segments. Their end points are the pocket jaws (a ball meeting one bounces off
 *  it like a knuckle, with no separate code). The gaps between them are the six pockets. */
const G = CORNER_G, S = SIDE_S;
export const SEGS = [
  [G, 0, W - G, 0], [G, H, W - G, H],
  [0, G, 0, H / 2 - S], [0, H / 2 + S, 0, H - G],
  [W, G, W, H / 2 - S], [W, H / 2 + S, W, H - G],
].map(([ax, ay, bx, by]) => ({ ax, ay, bx, by }));

/** The six pockets: the black hole that is drawn (cx, cy, r) is also where a ball drops: a ball
 *  whose CENTRE is over it is in, so what a player sees is the rule. A corner's hole meets the line
 *  between its jaws; a side's sits behind the cushion line. (ax, ay) is where the computer aims. */
export const POCKETS = [
  { cx: 0.9, cy: 0.9, r: 6.6, ax: 2.2, ay: 2.2 },
  { cx: W - 0.9, cy: 0.9, r: 6.6, ax: W - 2.2, ay: 2.2 },
  { cx: -2.2, cy: H / 2, r: 5.0, ax: -1.5, ay: H / 2 },
  { cx: W + 2.2, cy: H / 2, r: 5.0, ax: W + 1.5, ay: H / 2 },
  { cx: 0.9, cy: H - 0.9, r: 6.6, ax: 2.2, ay: H - 2.2 },
  { cx: W - 0.9, cy: H - 0.9, r: 6.6, ax: W - 2.2, ay: H - 2.2 },
];

/** Which pocket a ball centred at (x, y) is in, or -1: over a hole, or past the line between a
 *  pocket's jaws (a ball can only get there through a pocket's mouth: the cushions stop it
 *  anywhere else). */
export function pocketOf(x, y) {
  for (let k = 0; k < POCKETS.length; k++) {
    const p = POCKETS[k], dx = x - p.cx, dy = y - p.cy;
    if (dx * dx + dy * dy < p.r * p.r) return k;
  }
  if (x + y < G) return 0;
  if (W - x + y < G) return 1;
  if (x + (H - y) < G) return 4;
  if (W - x + (H - y) < G) return 5;
  if (x < 0) return 2;
  if (x > W) return 3;
  // Never expected, but a ball must never escape the table.
  if (y < -R) return x < W / 2 ? 0 : 1;
  if (y > H + R) return x < W / 2 ? 4 : 5;
  return -1;
}

export const groupOf = (i) => (i >= 1 && i <= 7 ? 'a' : i >= 9 && i <= 15 ? 'b' : null);
export const ballsOf = (g) => (g === 'a' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]);

/** A seeded integer RNG (xorshift32), deterministic everywhere. */
export function rng32(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const nextSeed = (seed) => ((Math.imul(seed >>> 0, 1103515245) + 12345) >>> 0) || 1;

/** A fresh rack: the 8 in the middle of the third row, one ball of each group in the back corners,
 *  the rest shuffled from `seed`. The cue ball on the head spot. */
export function rackBalls(seed) {
  const rnd = rng32(seed);
  const pool = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let k = pool.length - 1; k > 0; k--) { const j = rnd() % (k + 1); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  // Back corners: the first 'a' and the first 'b' left in the shuffle, sides chosen by the seed.
  const ca = pool.splice(pool.findIndex((n) => n < 8), 1)[0];
  const cb = pool.splice(pool.findIndex((n) => n > 8), 1)[0];
  const [left, right] = rnd() & 1 ? [ca, cb] : [cb, ca];
  const slots = [];
  const dx = 2 * R + 0.02, dy = dx * Math.sqrt(3) / 2;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) slots.push({ row, k, x: W / 2 + (k - row / 2) * dx, y: FOOT_Y - row * dy });
  }
  const order = [];
  for (const sl of slots) {
    if (sl.row === 2 && sl.k === 1) order.push(EIGHT);
    else if (sl.row === 4 && sl.k === 0) order.push(left);
    else if (sl.row === 4 && sl.k === 4) order.push(right);
    else order.push(pool.shift());
  }
  const b = new Array(N_BALLS);
  b[CUE] = ball(HEAD_SPOT[0], HEAD_SPOT[1]);
  slots.forEach((sl, k) => { b[order[k]] = ball(sl.x, sl.y); });
  return b;
}
const ball = (x, y) => ({ x, y, vx: 0, vy: 0, rx: 0, ry: 0, on: true });

/** A new match: first to `racks` racks; `breaker` breaks the first rack; `seed` shuffles it. */
export function newMatch(racks = 1, breaker = 0, seed = 1) {
  const st = breaker ? 1 : 0;
  const sd = (seed >>> 0) || 1;
  return {
    v: 1,
    racks: RACK_OPTIONS.includes(racks) ? racks : 1,
    scores: [0, 0],
    rack: 1,
    seed: sd,
    breaker: st,
    turn: st,
    groups: null,          // [seat 0's group, seat 1's] once the table is no longer open
    broke: false,          // the break has been played this rack
    inHand: 'kitchen',     // 'kitchen' (behind the head string) | 'any' | null
    shots: 0,
    winner: null,
    last: null,            // what the last shot did: { foul, pots, again, rack }
    b: rackBalls(sd),
  };
}

/** A saved match is only trusted if it has the shape this engine writes, at rest. */
export function validMatch(m) {
  if (!m || m.v !== 1 || !Array.isArray(m.b) || m.b.length !== N_BALLS) return false;
  if (!RACK_OPTIONS.includes(m.racks) || !Array.isArray(m.scores) || m.scores.length !== 2) return false;
  if (m.turn !== 0 && m.turn !== 1) return false;
  if (m.groups != null && !(Array.isArray(m.groups) && m.groups.length === 2)) return false;
  return m.b.every((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y)) && m.b[CUE].on;
}

export function cloneBalls(b) { return b.map((o) => ({ x: o.x, y: o.y, vx: o.vx, vy: o.vy, rx: o.rx, ry: o.ry, on: o.on })); }
export function cloneMatch(m) {
  return { ...m, scores: m.scores.slice(), groups: m.groups ? m.groups.slice() : null, last: m.last ? { ...m.last, pots: m.last.pots.slice() } : null, b: cloneBalls(m.b) };
}

export const atRest = (b) => b.every((o) => !o.on || (o.vx === 0 && o.vy === 0));
export function freeze(b) { for (const o of b) { o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; } }

/** The balls `seat` may hit first: its group, the 8 once that is cleared, any but the 8 while the
 *  table is open. */
export function targetsOf(m, seat) {
  const on = (i) => m.b[i].on;
  if (!m.groups) {
    const t = [];
    for (let i = 1; i < N_BALLS; i++) if (i !== EIGHT && on(i)) t.push(i);
    return t.length ? t : [EIGHT];
  }
  const t = ballsOf(m.groups[seat]).filter(on);
  return t.length ? t : [EIGHT];
}
export const onEight = (m, seat) => { const t = targetsOf(m, seat); return t.length === 1 && t[0] === EIGHT; };

/** Is (x, y) a legal place for the cue ball (`kitchen`: behind the head string)? */
export function canPlace(b, x, y, kitchen) {
  if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
  if (kitchen && y < HEAD_Y) return false;
  if (x + y < G + R || W - x + y < G + R || x + H - y < G + R || W - x + H - y < G + R) return false;
  for (const p of POCKETS) { const dx = x - p.cx, dy = y - p.cy; if (dx * dx + dy * dy < (p.r + R) * (p.r + R)) return false; }
  for (let i = 1; i < N_BALLS; i++) {
    const o = b[i];
    if (!o.on) continue;
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < 4 * R * R + 0.01) return false;
  }
  return true;
}

/** The nearest legal place to (x, y) for the cue ball, searched outward in rings. */
export function nearestPlace(b, x, y, kitchen) {
  const cx = Math.max(R, Math.min(W - R, x)), cy = Math.max(kitchen ? HEAD_Y : R, Math.min(H - R, y));
  if (canPlace(b, cx, cy, kitchen)) return { x: cx, y: cy };
  for (let rad = 0.5; rad < H; rad += 0.5) {
    const n = Math.max(8, Math.ceil(rad * 4));
    for (let k = 0; k < n; k++) {
      // Integer spokes and a fixed table of unit vectors keep this off sin/cos.
      const [ux, uy] = SPOKES[Math.floor((k * SPOKES.length) / n)];
      const px = cx + ux * rad, py = cy + uy * rad;
      if (canPlace(b, px, py, kitchen)) return { x: px, y: py };
    }
  }
  return { x: HEAD_SPOT[0], y: HEAD_SPOT[1] };
}
const SPOKES = (() => {
  const out = [];
  for (let k = 0; k < 32; k++) {
    // Points on a square, normalised: unit vectors without trigonometry.
    const t = (k % 8) / 8, side = Math.floor(k / 8);
    const [x, y] = side === 0 ? [1, -1 + 2 * t] : side === 1 ? [1 - 2 * t, 1] : side === 2 ? [-1, 1 - 2 * t] : [-1 + 2 * t, -1];
    const l = Math.sqrt(x * x + y * y);
    out.push([x / l, y / l]);
  }
  return out;
})();

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

/** A fresh event record for one shot: what the rules need to know about it. */
export const newEvents = () => ({ first: -1, rail: false, pots: [], pocketAt: [] });

/** One physics step. `ev` collects the first ball the cue ball touched, whether any ball reached a
 *  cushion after that, and every ball potted (in order). */
export function step(b, ev) {
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
        if (ev && ev.first < 0 && (i === CUE || j === CUE)) ev.first = i === CUE ? j : i;
      }
    }
  }
  // Ball against cushion and jaw.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (!o.on || (o.vx === 0 && o.vy === 0)) continue;
    for (const s of SEGS) {
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      let tt = ((o.x - s.ax) * ex + (o.y - s.ay) * ey) / (ex * ex + ey * ey);
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const cx = s.ax + ex * tt, cy = s.ay + ey * tt;
      const dx = o.x - cx, dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-9) {
        const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
        nx = -o.vx / sp; ny = -o.vy / sp; d = 0;
      } else { nx = dx / d; ny = dy / d; }
      o.x += nx * (R - d); o.y += ny * (R - d);
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) {
        o.vx -= (1 + E_RAIL) * vn * nx; o.vy -= (1 + E_RAIL) * vn * ny;
        const rn = o.rx * nx + o.ry * ny;
        if (rn < 0) { o.rx -= (1 + E_RAIL) * rn * nx; o.ry -= (1 + E_RAIL) * rn * ny; }
        if (ev && ev.first >= 0) ev.rail = true;
      }
    }
  }
  // Cloth: skid turns into roll, roll slows down.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (!o.on || (o.vx === 0 && o.vy === 0 && o.rx === 0 && o.ry === 0)) continue;
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
      if (sp < STOP && Math.sqrt((o.vx - o.rx) * (o.vx - o.rx) + (o.vy - o.ry) * (o.vy - o.ry)) < STOP) { o.vx = 0; o.vy = 0; o.rx = 0; o.ry = 0; }
    } else {
      const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      const ns = sp - (A_ROLL + DAMP * sp) * DT;
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

export const maxShotSteps = () => Math.round(MAX_SHOT_SECS / DT);

/** Run a shot to the end on balls `b` (mutated). Returns the step count. */
export function runToRest(b, ev, maxSecs = MAX_SHOT_SECS) {
  const max = Math.round(maxSecs / DT);
  for (let k = 1; k <= max; k++) {
    step(b, ev);
    if (atRest(b)) { freeze(b); return k; }
  }
  freeze(b);
  return max;
}

/** A shot, as stored: { x, y } where the cue ball is put first (only with the ball in hand), the
 *  direction (dx, dy), the power p 0-1 and the spin s -1..1. Puts it in motion on `m.b` and returns
 *  the event record to step it with. Null if it is not a shot this position allows. */
export function begin(m, shot) {
  if (!shot || ![shot.dx, shot.dy, shot.p].every(Number.isFinite)) return null;
  if (m.inHand && Number.isFinite(shot.x) && Number.isFinite(shot.y)) {
    if (!canPlace(m.b, shot.x, shot.y, m.inHand === 'kitchen')) return null;
    m.b[CUE].x = shot.x; m.b[CUE].y = shot.y;
  }
  strike(m.b, shot.dx, shot.dy, shot.p, shot.s || 0, !m.broke);
  const ev = newEvents();
  ev.targets = targetsOf(m, m.turn);
  ev.isBreak = !m.broke;
  return ev;
}

/** Play a whole shot at once (the computer's look-ahead, a save's rolling shot). Returns settle's. */
export function play(m, shot, maxSecs) {
  const ev = begin(m, shot);
  if (!ev) return null;
  runToRest(m.b, ev, maxSecs);
  return settle(m, ev);
}

/**
 * A shot has come to rest: the rules (bar-room 8-ball, one rack at a time).
 *  - Foul: the cue ball potted; no ball hit; the first ball hit not one of the shooter's targets;
 *    nothing potted and no ball reaching a cushion after the hit. A foul gives the other player
 *    the ball in hand anywhere. The break only fouls by potting the cue ball or missing everything.
 *  - The 8 potted: on the break, the breaker wins the rack (loses it with a foul); later, the
 *    shooter wins the rack if the 8 was their target and nothing was a foul, and loses it otherwise.
 *  - The table is open until the first ball potted on a clean shot after the break: its group is
 *    the shooter's, the other the opponent's.
 *  - The shooter goes again after potting one of their own group (any ball while the table was
 *    open) with no foul; otherwise the turn passes.
 * Returns { kind: 'again' | 'turn' | 'foul' | 'rack' | 'win', foul, rackWinner }.
 */
export function settle(m, ev) {
  freeze(m.b);
  relax(m.b);
  m.shots++;
  const seat = m.turn, opp = seat ^ 1;
  const pots = ev.pots.filter((i) => i !== CUE);
  const scratch = ev.pots.includes(CUE);
  const isBreak = !!ev.isBreak;
  const targets = ev.targets || targetsOf(m, seat);
  let foul = null;
  if (scratch) foul = 'scratch';
  else if (ev.first < 0) foul = 'nohit';
  else if (!isBreak && !targets.includes(ev.first)) foul = 'wrong';
  else if (!isBreak && !pots.length && !ev.rail) foul = 'norail';
  m.broke = true;
  m.inHand = null;
  if (scratch) m.b[CUE].on = true;     // placed by the next shooter (below)
  const wasOpen = !m.groups;
  if (pots.includes(EIGHT)) {
    const wins = isBreak ? !foul : (!foul && targets.length === 1 && targets[0] === EIGHT);
    return endRack(m, wins ? seat : opp, { foul, pots });
  }
  if (!foul && wasOpen && !isBreak) {
    const g = pots.map(groupOf).find(Boolean);
    if (g) m.groups = seat === 0 ? [g, g === 'a' ? 'b' : 'a'] : [g === 'a' ? 'b' : 'a', g];
  }
  const mine = m.groups ? pots.filter((i) => groupOf(i) === m.groups[seat]) : pots;
  if (foul) {
    m.turn = opp;
    m.inHand = 'any';
    const c = m.b[CUE];
    if (scratch) { const p = nearestPlace(m.b, HEAD_SPOT[0], HEAD_SPOT[1], false); c.x = p.x; c.y = p.y; }
    m.last = { foul, pots, again: false };
    return { kind: 'foul', foul };
  }
  const again = mine.length > 0;
  if (!again) m.turn = opp;
  m.last = { foul: null, pots, again };
  return { kind: again ? 'again' : 'turn', foul: null };
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
      if (o.x < R && pocketOf(o.x, o.y) < 0 && (o.y < H / 2 - S || o.y > H / 2 + S)) o.x = R;
      if (o.x > W - R && pocketOf(o.x, o.y) < 0 && (o.y < H / 2 - S || o.y > H / 2 + S)) o.x = W - R;
      if (o.y < R && pocketOf(o.x, o.y) < 0) o.y = R;
      if (o.y > H - R && pocketOf(o.x, o.y) < 0) o.y = H - R;
    }
    if (!moved) break;
  }
}

function endRack(m, w, info) {
  m.scores[w]++;
  m.last = { foul: info.foul, pots: info.pots, again: false, rack: w };
  if (m.scores[w] >= m.racks) {
    m.winner = w;
    m.turn = w;
    return { kind: 'win', foul: info.foul, rackWinner: w };
  }
  return { kind: 'rack', foul: info.foul, rackWinner: w };
}

/** The next rack after a rack has ended (`settle` said 'rack'): the break alternates. */
export function nextRack(m) {
  m.rack++;
  m.seed = nextSeed(m.seed);
  m.breaker ^= 1;
  m.turn = m.breaker;
  m.groups = null;
  m.broke = false;
  m.inHand = 'kitchen';
  m.b = rackBalls(m.seed);
}

/**
 * The aim guide for the cue ball sent along unit (dx, dy): where it first touches something, as
 * { x, y, hit } (the cue ball's CENTRE there; hit is the ball index, or -1 for a cushion), with,
 * when it is a ball, where that ball heads (`ox, oy` unit) and where the cue ball glances off
 * (`cx, cy` unit, the tangent line). Display only, never on the physics path.
 */
export function aimContact(b, dx, dy, range = 260) {
  const o = b[CUE];
  let best = range, hit = -2;
  for (let j = 1; j < b.length; j++) {
    const q = b[j];
    if (!q.on) continue;
    const fx = q.x - o.x, fy = q.y - o.y;
    const along = fx * dx + fy * dy;
    if (along <= 0) continue;
    const perp2 = fx * fx + fy * fy - along * along;
    if (perp2 >= 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - perp2);
    if (t >= 0 && t < best) { best = t; hit = j; }
  }
  // Cushions: the straight edges are enough for a guide (a pocket mouth reads as open table).
  const x0 = R, x1 = W - R, y0 = R, y1 = H - R;
  const tx = dx > 0 ? (x1 - o.x) / dx : dx < 0 ? (x0 - o.x) / dx : Infinity;
  const ty = dy > 0 ? (y1 - o.y) / dy : dy < 0 ? (y0 - o.y) / dy : Infinity;
  const tw = Math.max(0, Math.min(tx, ty));
  if (tw < best) { best = tw; hit = -1; }
  if (hit === -2) return null;
  const x = o.x + dx * best, y = o.y + dy * best;
  const out = { x, y, hit };
  if (hit >= 0) {
    const q = b[hit];
    let nx = q.x - x, ny = q.y - y;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl;
    out.ox = nx; out.oy = ny;
    // The cue ball leaves along the tangent: its direction minus the part along the line of centres.
    const dn = dx * nx + dy * ny;
    let cx = dx - dn * nx, cy = dy - dn * ny;
    const cl = Math.sqrt(cx * cx + cy * cy);
    if (cl > 1e-6) { cx /= cl; cy /= cl; out.cx = cx; out.cy = cy; out.cut = cl; }
  }
  return out;
}

/** A straight line from (x, y) along unit (dx, dy), stopped at the first ball (other than `skip`)
 *  or cushion within `len`, for drawing the object ball's and cue ball's paths. */
export function rayStop(b, x, y, dx, dy, len, skip) {
  let best = len;
  for (let j = 0; j < b.length; j++) {
    if (skip.includes(j) || !b[j].on) continue;
    const q = b[j];
    const fx = q.x - x, fy = q.y - y;
    const along = fx * dx + fy * dy;
    if (along <= 0) continue;
    const perp2 = fx * fx + fy * fy - along * along;
    if (perp2 >= 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - perp2);
    if (t >= 0 && t < best) best = t;
  }
  const x0 = R, x1 = W - R, y0 = R, y1 = H - R;
  const tx = dx > 0 ? (x1 - x) / dx : dx < 0 ? (x0 - x) / dx : Infinity;
  const ty = dy > 0 ? (y1 - y) / dy : dy < 0 ? (y0 - y) / dy : Infinity;
  best = Math.max(0, Math.min(best, tx, ty));
  return { x: x + dx * best, y: y + dy * best };
}
