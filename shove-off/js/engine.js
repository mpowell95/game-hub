// shove-off/js/engine.js - SHOVE OFF's rules and physics (2026-11-18). PURE: no DOM, no storage, no clock.
//
// Matt filmed GamePigeon's Knockout and asked for "our own version of this". Two players, four pieces
// each, on a square platform. Each ROUND both aim every living piece in secret (an arrow: direction =
// where it slides, length = how hard), then everything slides AT ONCE: friction, equal-mass bounces,
// and a piece whose centre leaves the platform falls in. The platform shrinks every round. Last player
// with pieces on it wins; both lose their last pieces in the same round = SUDDEN DEATH.
//
// DETERMINISM IS THE WHOLE POINT. Both phones replay the match from the same log of aims and must land
// every piece in exactly the same place, bit for bit, in any browser. So the simulation uses ONLY
// + - * / and Math.sqrt (each correctly rounded by IEEE 754 in every engine), a FIXED step (no clock),
// a fixed step cap, and a fixed order over pieces and pairs. No Math.sin/cos/atan2/exp/pow/hypot in
// here: shove-off/js/test.js scans this file's text for them. Trig is only for DRAWING (art.js).
// Aims are INTEGERS in platform units (the round-1 platform is 2000 units across).

export const H0 = 1000;          // round 1: the platform is the square |x| <= 1000, |y| <= 1000
export const R = 100;            // every piece's radius
export const SHRINK = 0.88;      // after each round the platform's half-size is multiplied by this...
export const H_MIN = 460;        // ...down to this floor (9 rounds in)
export const SD_H = 520;         // sudden death's small platform (half-size)
export const MAX_AIM = 560;      // the longest arrow (= the hardest shove)
export const SPEED_K = 0.07;     // starting speed per step = aim * SPEED_K
export const DAMP = 0.965;       // friction: speed kept per step
export const STOP2 = 0.0025;     // a piece slower than 0.05 units a step has stopped
export const REST = 0.92;        // bounce: share of the closing speed returned (equal masses)
export const MAX_STEPS = 900;    // a round never runs longer than this (it settles in ~300)
export const ROUND_MAX = 30;     // a normal round count cap (players who never shove); see `resolveRound`
export const SD_MAX = 10;        // sudden-death rounds before it is a DRAW
export const DRAW = 'draw';
export const PIECES = 4;

// Start: a ring of eight, the two sides INTERLEAVED (Matt's video). Turning the platform a quarter turn,
// (x, y) -> (-y, x), maps every 'a' spot onto a 'b' spot and back, so neither side has a better spot.
export const START = {
  a: [[560, 180], [-560, -180], [-230, 230], [230, -230]],
  b: [[-180, 560], [180, -560], [230, 230], [-230, -230]],
};
// Sudden death: one piece each, mirror images across the middle.
export const SD_START = { a: [[-230, 0]], b: [[230, 0]] };

const other = (s) => (s === 'a' ? 'b' : 'a');
export { other };

function placePieces(layout) {
  const out = [];
  for (const s of ['a', 'b']) layout[s].forEach(([x, y], i) => out.push({ s, i, x, y, alive: true }));
  return out;
}

/** A fresh match. `round` counts every round played (sudden death included), from 1. */
export function newMatch() {
  return { round: 1, H: H0, sd: 0, sdr: 0, pieces: placePieces(START), sent: { a: null, b: null }, winner: null, end: '', rounds: [] };
}

export const alive = (m, s) => m.pieces.filter((p) => p.alive && p.s === s);
export const aliveCount = (m, s) => alive(m, s).length;
/** The piece slots a side must aim this round (its living pieces, by slot index). */
export const slotsOf = (m, s) => alive(m, s).map((p) => p.i);
/** How many slots a side has in the current layout (4, or 1 in sudden death). */
export const slotCount = (m) => (m.sd > 0 ? 1 : PIECES);

// --- aims: one string per side per round, Firebase-safe (no arrays with holes) ----------------------
// "dx,dy;dx,dy;-;dx,dy": one part per SLOT, '-' for a piece that is out. Integers, |aim| <= MAX_AIM.
export function aimsToString(list) {
  return list.map((a) => (a ? `${a[0] | 0},${a[1] | 0}` : '-')).join(';');
}
/** Parse and check aims for side `s` against match `m`: an array (by slot) of [dx, dy] or null, or
 *  null if the string is malformed or does not fit the side's living pieces exactly. */
export function parseAims(m, s, str) {
  if (typeof str !== 'string' || str.length > 120) return null;
  const parts = str.split(';');
  if (parts.length !== slotCount(m)) return null;
  const live = new Set(slotsOf(m, s));
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!live.has(i)) { if (p !== '-') return null; out.push(null); continue; }
    if (!/^-?\d{1,4},-?\d{1,4}$/.test(p)) return null;
    const [dx, dy] = p.split(',').map(Number);
    if (dx * dx + dy * dy > MAX_AIM * MAX_AIM) return null;
    out.push([dx, dy]);
  }
  return out;
}
/** Clamp a dragged arrow to an integer aim inside MAX_AIM. Uses only * / and sqrt. */
export function clampAim(dx, dy) {
  let x = dx, y = dy;
  const d2 = x * x + y * y;
  if (d2 > MAX_AIM * MAX_AIM) { const k = MAX_AIM / Math.sqrt(d2); x *= k; y *= k; }
  x = Math.round(x); y = Math.round(y);
  // Rounding can push a capped arrow a hair past the cap: pull it back one unit at a time.
  while (x * x + y * y > MAX_AIM * MAX_AIM) { x -= Math.sign(x); y -= Math.sign(y); }
  return [x, y];
}

// --- the slide -------------------------------------------------------------------------------------
/**
 * Slide every living piece from its aim, all at once, until everything stops (or MAX_STEPS). Mutates
 * the pieces' x/y/alive. `frames` (optional array) receives one entry per step: [x0, y0, x1, y1, ...] for
 * every piece in `m.pieces` order (a fallen piece keeps sliding in the picture, flagged by `falls`).
 * Returns { steps, falls: [{ k, step }] } where k is the piece's index in m.pieces.
 */
export function slide(m, aims, frames = null) {
  const P = m.pieces;
  const n = P.length;
  const vx = new Array(n).fill(0), vy = new Array(n).fill(0);
  const live = P.map((p) => p.alive);
  for (let k = 0; k < n; k++) {
    if (!live[k]) continue;
    const a = aims[P[k].s] && aims[P[k].s][P[k].i];
    if (a) { vx[k] = a[0] * SPEED_K; vy[k] = a[1] * SPEED_K; }
  }
  const H = m.H;
  const D = 2 * R, D2 = D * D;
  const falls = [];
  // Fallen pieces keep drifting in the picture only (never in the physics).
  const gx = P.map((p) => p.x), gy = P.map((p) => p.y), gvx = vx.slice(), gvy = vy.slice();
  let step = 0;
  for (; step < MAX_STEPS; step++) {
    let moving = false;
    for (let k = 0; k < n; k++) if (live[k] && (vx[k] !== 0 || vy[k] !== 0)) { moving = true; break; }
    if (!moving) break;
    // 1. move
    for (let k = 0; k < n; k++) {
      if (!live[k]) continue;
      P[k].x += vx[k]; P[k].y += vy[k];
    }
    // 2. bounce, every pair once, in a fixed order
    for (let i = 0; i < n; i++) {
      if (!live[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!live[j]) continue;
        let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D2) continue;
        let d = Math.sqrt(d2);
        let nx, ny;
        if (d > 0) { nx = dx / d; ny = dy / d; } else { nx = 1; ny = 0; d = 0; }
        // push apart so they just touch (half each)
        const half = (D - d) / 2;
        P[i].x -= nx * half; P[i].y -= ny * half;
        P[j].x += nx * half; P[j].y += ny * half;
        // equal masses: swap the closing speed along the line between them, less a little
        const vn = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        if (vn > 0) {
          const imp = vn * (1 + REST) / 2;
          vx[i] -= imp * nx; vy[i] -= imp * ny;
          vx[j] += imp * nx; vy[j] += imp * ny;
        }
      }
    }
    // 3. fall: a centre off the platform is out, at once
    for (let k = 0; k < n; k++) {
      if (!live[k]) continue;
      const p = P[k];
      if (p.x > H || p.x < -H || p.y > H || p.y < -H) {
        live[k] = false; p.alive = false;
        falls.push({ k, step });
        gx[k] = p.x; gy[k] = p.y; gvx[k] = vx[k]; gvy[k] = vy[k];
        vx[k] = 0; vy[k] = 0;
      }
    }
    // 4. friction
    for (let k = 0; k < n; k++) {
      if (!live[k]) continue;
      vx[k] *= DAMP; vy[k] *= DAMP;
      if (vx[k] * vx[k] + vy[k] * vy[k] < STOP2) { vx[k] = 0; vy[k] = 0; }
    }
    if (frames) {
      const f = [];
      for (let k = 0; k < n; k++) {
        if (live[k]) f.push(P[k].x, P[k].y);
        else if (P[k].alive === false && falls.some((x) => x.k === k)) { gx[k] += gvx[k]; gy[k] += gvy[k]; gvx[k] *= DAMP; gvy[k] *= DAMP; f.push(gx[k], gy[k]); }
        else f.push(P[k].x, P[k].y);
      }
      frames.push(f);
    }
  }
  return { steps: step, falls };
}

/**
 * Both sides have sent this round: slide, shrink, decide. Mutates `m` and pushes a record of the round
 * onto `m.rounds` ({ r, sd, H, H1, before, aims, falls, shrinkFalls, after, steps }). `frames` is
 * passed to `slide` for the picture. Returns the round record.
 *
 * Choices (shove-off/CLAUDE.md, "Rules"):
 * - The platform shrinks AFTER the slide (round 1 is played on the full platform), to SHRINK x the half
 *   size, floor H_MIN; a piece whose centre is now off the smaller platform falls too ("the edge melts").
 * - One side out, the other not: the other wins. BOTH out in the same round: sudden death (one piece each
 *   on the small SD platform; a sudden-death round where both survive plays on, shrinking; both out again
 *   resets the sudden-death pieces). After SD_MAX sudden-death rounds with no winner: a DRAW.
 * - ROUND_MAX normal rounds with both still on: more pieces wins; equal goes to sudden death.
 */
export function resolveRound(m, frames = null) {
  const aims = { a: m.sent.a, b: m.sent.b };
  const before = m.pieces.map((p) => ({ s: p.s, i: p.i, x: p.x, y: p.y, alive: p.alive }));
  const H = m.H;
  const res = slide(m, aims, frames);
  const H1 = Math.max(H_MIN, H * SHRINK);
  const shrinkFalls = [];
  m.pieces.forEach((p, k) => {
    if (!p.alive) return;
    if (p.x > H1 || p.x < -H1 || p.y > H1 || p.y < -H1) { p.alive = false; shrinkFalls.push(k); }
  });
  const rec = {
    r: m.round, sd: m.sd > 0 ? 1 : 0, H, H1, before, aims, steps: res.steps,
    falls: res.falls.map((f) => f.k), shrinkFalls,
    after: m.pieces.map((p) => ({ s: p.s, i: p.i, x: p.x, y: p.y, alive: p.alive })),
  };
  m.rounds.push(rec);
  if (m.sd > 0) m.sdr += 1;
  m.H = H1;
  const na = aliveCount(m, 'a'), nb = aliveCount(m, 'b');
  m.sent = { a: null, b: null };
  m.round += 1;
  if (na > 0 && nb === 0) { m.winner = 'a'; m.end = m.sd > 0 ? 'sudden' : 'off'; }
  else if (nb > 0 && na === 0) { m.winner = 'b'; m.end = m.sd > 0 ? 'sudden' : 'off'; }
  else if (m.sd > 0 && m.sdr >= SD_MAX) { m.winner = DRAW; m.end = 'draw'; }
  else if (na === 0 && nb === 0) startSuddenDeath(m);
  else if (m.sd === 0 && rec.r >= ROUND_MAX) {
    if (na > nb) { m.winner = 'a'; m.end = 'count'; }
    else if (nb > na) { m.winner = 'b'; m.end = 'count'; }
    else startSuddenDeath(m);
  }
  rec.winner = m.winner;
  return rec;
}
function startSuddenDeath(m) {
  m.sd += 1;
  m.H = SD_H;
  m.pieces = placePieces(SD_START);
}

/**
 * One side's aims for the current round. Returns 'sent' (the other has not sent yet), 'resolved'
 * (both in: the round was played), or null if the entry is not legal now (wrong round, already sent,
 * match over, aims that do not fit) - which makes a whole log invalid (mp.js validateGame).
 */
export function applyAims(m, by, r, str, frames = null) {
  if (m.winner != null) return null;
  if (by !== 'a' && by !== 'b') return null;
  if (r !== m.round) return null;
  if (m.sent[by]) return null;
  const aims = parseAims(m, by, str);
  if (!aims) return null;
  m.sent[by] = aims;
  if (!m.sent[other(by)]) return 'sent';
  resolveRound(m, frames);
  return 'resolved';
}

/** Who still owes aims this round: { a, b } booleans (both false once the match is over). */
export function owes(m) {
  if (m.winner != null) return { a: false, b: false };
  return { a: !m.sent.a, b: !m.sent.b };
}

/** Pieces each side knocked off / lost over the whole match (for the detail). Pure over m.rounds. */
export function tally(m) {
  const out = { a: { lost: 0 }, b: { lost: 0 } };
  for (const rec of m.rounds) {
    for (const k of rec.falls.concat(rec.shrinkFalls)) { const p = rec.before[k]; if (p) out[p.s].lost++; }
  }
  return out;
}
