// number-merge/js/engine.js - Number Merge's rules. PURE: no DOM, no storage, no clock.
//
// A 4x4 grid of numbers (0 = empty), stored row by row (index = row * 4 + col). A swipe slides every tile that
// way; two equal tiles that meet merge into one of double the value (each tile merges at most once a move); one
// new tile appears after every move that changed the grid. The game is over when no swipe can change it.
//
// Tiles come from a SEEDED random generator (mulberry32) whose state is part of the game, so a saved game resumes
// with the same next tiles, and the daily game (one seed per day, `dailySeed`) gives everyone the same tile
// sequence: each new tile draws twice, once for its value (4 one time in ten, else 2) and once for its place
// among the empty squares.

export const N = 4;
export const DIRS = ['up', 'down', 'left', 'right'];

/** mulberry32: one draw in [0, 1) from a uint32 state. Returns [value, nextState]. */
export function draw(state) {
  let a = (state + 0x6D2B79F5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** FNV-1a of a string: the seed for a day ('2026-11-13' -> uint32). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const dailySeed = (dayKey) => hashSeed('number-merge-daily|' + dayKey);

/** The squares of each line, listed from the wall the tiles slide toward. */
function lines(dir) {
  const out = [];
  for (let k = 0; k < N; k++) {
    const l = [];
    for (let j = 0; j < N; j++) {
      if (dir === 'left') l.push(k * N + j);
      else if (dir === 'right') l.push(k * N + (N - 1 - j));
      else if (dir === 'up') l.push(j * N + k);
      else l.push((N - 1 - j) * N + k);
    }
    out.push(l);
  }
  return out;
}

/** Put one new tile on an empty square. Returns { grid, rng, at } (at = -1 when the grid is full). */
export function spawn(grid, rng) {
  const empty = [];
  for (let i = 0; i < grid.length; i++) if (!grid[i]) empty.push(i);
  if (!empty.length) return { grid, rng, at: -1 };
  let r1, r2, s = rng;
  [r1, s] = draw(s);
  [r2, s] = draw(s);
  const at = empty[Math.min(empty.length - 1, Math.floor(r2 * empty.length))];
  const g = grid.slice();
  g[at] = r1 < 0.1 ? 4 : 2;
  return { grid: g, rng: s, at };
}

/** A new game from a seed: two tiles. */
export function newGame(seed) {
  let g = new Array(N * N).fill(0);
  let rng = seed >>> 0;
  const a = spawn(g, rng); g = a.grid; rng = a.rng;
  const b = spawn(g, rng); g = b.grid; rng = b.rng;
  return { grid: g, rng, score: 0, moves: 0, merges: 0, over: false };
}

/** Slide without the new tile. Returns { grid, gained, slides: [{ from, to }], merged: [index], moved }. */
export function slide(grid, dir) {
  const g = new Array(N * N).fill(0);
  const slides = [];
  const merged = [];
  let gained = 0, moved = false;
  for (const l of lines(dir)) {
    let w = 0;
    let canMerge = false;
    for (let j = 0; j < N; j++) {
      const v = grid[l[j]];
      if (!v) continue;
      if (canMerge && g[l[w - 1]] === v) {
        g[l[w - 1]] = v * 2;
        gained += v * 2;
        merged.push(l[w - 1]);
        slides.push({ from: l[j], to: l[w - 1] });
        canMerge = false;
        moved = true;
      } else {
        g[l[w]] = v;
        slides.push({ from: l[j], to: l[w] });
        if (l[w] !== l[j]) moved = true;
        canMerge = true;
        w++;
      }
    }
  }
  return { grid: g, gained, slides, merged, moved };
}

/** Can any swipe change the grid? */
export function canMove(grid) {
  for (let i = 0; i < N * N; i++) {
    if (!grid[i]) return true;
    const r = Math.floor(i / N), c = i % N;
    if (c < N - 1 && grid[i] === grid[i + 1]) return true;
    if (r < N - 1 && grid[i] === grid[i + N]) return true;
  }
  return false;
}

/** One move. Returns { state, moved, gained, slides, merged, at } (state unchanged when nothing moved). */
export function move(state, dir) {
  if (state.over || DIRS.indexOf(dir) < 0) return { state, moved: false, gained: 0, slides: [], merged: [], at: -1 };
  const s = slide(state.grid, dir);
  if (!s.moved) return { state, moved: false, gained: 0, slides: [], merged: [], at: -1 };
  const sp = spawn(s.grid, state.rng);
  const next = { grid: sp.grid, rng: sp.rng, score: state.score + s.gained, moves: state.moves + 1, merges: (state.merges | 0) + s.merged.length, over: false };
  next.over = !canMove(next.grid);
  return { state: next, moved: true, gained: s.gained, slides: s.slides, merged: s.merged, at: sp.at };
}

export const bestTile = (grid) => grid.reduce((m, v) => (v > m ? v : m), 0);

/** A saved game read back, or null when it does not add up (never trusted blindly). */
export function cleanState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.grid) || s.grid.length !== N * N) return null;
  const okV = (v) => v === 0 || (Number.isInteger(v) && v >= 2 && v <= 1 << 20 && (v & (v - 1)) === 0);
  if (!s.grid.every(okV)) return null;
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const grid = s.grid.slice();
  return { grid, rng: n(s.rng) >>> 0, score: n(s.score), moves: n(s.moves), merges: n(s.merges), over: !canMove(grid) };
}
