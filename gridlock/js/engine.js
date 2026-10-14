// gridlock/js/engine.js - the whole puzzle, pure (no DOM): read a board, list the legal slides,
// solve it. ui.js draws and animates; nothing in ui.js decides anything about the puzzle. The level
// maker (build-gridlock-levels.mjs) and the tests (gridlock/js/test.js) use this same file.
//
// THE BOARD is 6 x 6. A board is written as 36 characters, row by row from the top left (Michael
// Fogleman's notation, https://michaelfogleman.com/rush): 'o' an empty cell, 'x' a fixed wall,
// 'A' the red block, 'B'..'Z' the others. Every block is 2 or 3 cells long, one cell wide, and
// slides only along its own length; it never turns. The red block is horizontal on row 2 (the
// third row) and the EXIT is the right edge of that row: the puzzle is solved when red reaches
// columns 4-5.
//
// A MOVE is one block slid any distance in one go (how Unblock Me and Fogleman count it), so the
// solver below is a breadth-first search where each edge is one slide. Its answer is the FEWEST
// moves, which the game shows as "Fewest" and the stars are judged against.

export const N = 6;
export const EXIT_ROW = 2;
export const SOLVED_POS = N - 2;   // red's column when it sits against the exit

/** A board string -> { pieces, walls }. pieces[0] is always the red block. Each piece is
 *  { id, h (horizontal), len, line (its fixed row if h, fixed column if not), pos (its first
 *  cell along that line) }. Throws on anything that is not a well formed board. */
export function parse(str) {
  const s = String(str || '');
  if (s.length !== N * N) throw new Error('board must be 36 cells');
  const cells = {};
  const walls = [];
  for (let i = 0; i < N * N; i++) {
    const ch = s[i];
    if (ch === 'o' || ch === '.') continue;
    if (ch === 'x') { walls.push(i); continue; }
    if (!/[A-Z]/.test(ch)) throw new Error(`bad cell "${ch}"`);
    (cells[ch] ||= []).push(i);
  }
  if (!cells.A) throw new Error('no red block');
  const ids = Object.keys(cells).sort();
  const pieces = ids.map((id) => {
    const at = cells[id];
    const rs = at.map((i) => (i / N) | 0), cs = at.map((i) => i % N);
    const h = rs.every((r) => r === rs[0]);
    const v = cs.every((c) => c === cs[0]);
    if (h === v) throw new Error(`block ${id} is not a straight line`);
    const len = at.length;
    if (len < 2 || len > 3) throw new Error(`block ${id} is ${len} long`);
    const line = h ? rs[0] : cs[0];
    const pos = h ? Math.min(...cs) : Math.min(...rs);
    const span = h ? cs : rs;
    if (Math.max(...span) - pos !== len - 1) throw new Error(`block ${id} has a gap`);
    return { id, h, len, line, pos };
  });
  const red = pieces[0];
  if (!red.h || red.line !== EXIT_ROW || red.len !== 2) throw new Error('red must be 2 long, horizontal, on the exit row');
  return { pieces, walls };
}

/** The positions of a parsed board's pieces, as a plain array (the state the solver moves). */
export function positions(pz) { return pz.pieces.map((p) => p.pos); }

/** Cell index of piece p's k-th cell at position pos. */
export function cellOf(p, pos, k) {
  return p.h ? p.line * N + pos + k : (pos + k) * N + p.line;
}

/** Who is in each cell: 0 empty, i+1 piece i, 255 a wall. */
export function occupancy(pz, pos) {
  const occ = new Uint8Array(N * N);
  for (const w of pz.walls) occ[w] = 255;
  for (let i = 0; i < pz.pieces.length; i++) {
    const p = pz.pieces[i];
    for (let k = 0; k < p.len; k++) occ[cellOf(p, pos[i], k)] = i + 1;
  }
  return occ;
}

/** How far piece i can slide each way from where it is: { lo, hi } positions it can reach. */
export function range(pz, pos, i, occ = occupancy(pz, pos)) {
  const p = pz.pieces[i];
  let lo = pos[i], hi = pos[i];
  while (lo > 0 && occ[cellOf(p, lo - 1, 0)] === 0) lo--;
  while (hi + p.len < N && occ[cellOf(p, hi + 1, p.len - 1)] === 0) hi++;
  return { lo, hi };
}

/** Every legal move from a state, as [piece, newPos]. */
export function moves(pz, pos) {
  const occ = occupancy(pz, pos);
  const out = [];
  for (let i = 0; i < pz.pieces.length; i++) {
    const { lo, hi } = range(pz, pos, i, occ);
    for (let q = lo; q <= hi; q++) if (q !== pos[i]) out.push([i, q]);
  }
  return out;
}

export function isSolved(pos) { return pos[0] === SOLVED_POS; }

/** A state's key: positions packed base 8 (each is 0..4). 16 pieces fit in 48 bits, under 2^53. */
export function keyOf(pos) {
  let k = 0;
  for (let i = pos.length - 1; i >= 0; i--) k = k * 8 + pos[i];
  return k;
}

/** Shortest solution from `pos`, as a list of [piece, newPos] moves, or null when there is none
 *  (or the search passes `limit` states). An already solved state answers []. This is the HINT, so
 *  it is written for speed: states live in one flat byte buffer, a state's key is updated
 *  incrementally rather than recomputed, and nothing is allocated per state. */
export function solve(pz, pos, limit = 2000000) {
  if (isSolved(pos)) return [];
  const P = pz.pieces.length;
  const H = pz.pieces.map((p) => p.h), LEN = pz.pieces.map((p) => p.len), LINE = pz.pieces.map((p) => p.line);
  const POW = [];
  for (let i = 0, f = 1; i < P; i++, f *= 8) POW.push(f);
  const base = new Uint8Array(N * N);
  for (const w of pz.walls) base[w] = 1;
  const cell = (i, q, k) => (H[i] ? LINE[i] * N + q + k : (q + k) * N + LINE[i]);
  let buf = new Uint8Array(P * 4096), keys = new Float64Array(4096);
  let parent = new Int32Array(4096), via = new Uint16Array(4096);
  const index = new Map();
  let n = 0;
  const push = (cur, key, from, piece, q) => {
    if (n >= keys.length) {
      const grow = (a, len) => { const b = new a.constructor(len); b.set(a); return b; };
      buf = grow(buf, buf.length * 2); keys = grow(keys, keys.length * 2);
      parent = grow(parent, parent.length * 2); via = grow(via, via.length * 2);
    }
    buf.set(cur, n * P);
    keys[n] = key; parent[n] = from; via[n] = piece * 8 + q;
    index.set(key, n);
    return n++;
  };
  const cur = pos.slice();
  push(cur, keyOf(cur), -1, 0, 0);
  const occ = new Uint8Array(N * N);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < P; i++) cur[i] = buf[s * P + i];
    const k0 = keys[s];
    occ.set(base);
    for (let i = 0; i < P; i++) for (let k = 0; k < LEN[i]; k++) occ[cell(i, cur[i], k)] = 1;
    for (let i = 0; i < P; i++) {
      const p0 = cur[i];
      for (let dir = -1; dir <= 1; dir += 2) {
        for (let q = p0 + dir; q >= 0 && q + LEN[i] <= N; q += dir) {
          if (occ[cell(i, q, dir < 0 ? 0 : LEN[i] - 1)]) break;
          const key = k0 + (q - p0) * POW[i];
          if (index.has(key)) continue;
          cur[i] = q;
          const t = push(cur, key, s, i, q);
          cur[i] = p0;
          if (i === 0 && q === SOLVED_POS) {
            const path = [];
            for (let x = t; parent[x] >= 0; x = parent[x]) path.push([via[x] >> 3, via[x] & 7]);
            return path.reverse();
          }
          if (n > limit) return null;
        }
      }
    }
  }
  return null;
}

/** The fewest moves from `pos`, or -1 when it cannot be solved. */
export function fewest(pz, pos) {
  const p = solve(pz, pos);
  return p ? p.length : -1;
}

/** Back to 36 characters, pieces relettered A, B, C... in reading order of their first cell (red
 *  stays A). Two boards that are the same puzzle come out as the same string. */
export function serialize(pz, pos) {
  const out = new Array(N * N).fill('o');
  for (const w of pz.walls) out[w] = 'x';
  const order = pz.pieces.map((p, i) => ({ i, first: cellOf(p, pos[i], 0) }))
    .filter((o) => o.i !== 0).sort((a, b) => a.first - b.first);
  const letter = new Map([[0, 'A']]);
  order.forEach((o, n) => letter.set(o.i, String.fromCharCode(66 + n)));
  pz.pieces.forEach((p, i) => { for (let k = 0; k < p.len; k++) out[cellOf(p, pos[i], k)] = letter.get(i); });
  return out.join('');
}
