// way-out/js/engine.js - the whole puzzle, pure (no DOM): level sizes, the generator, and the one
// rule of the game ("is this arrow's way out clear?"). ui.js draws it and animates it; nothing in
// ui.js decides anything about the puzzle.
//
// THE BOARD is a W x H grid of points (the dots). An ARROW is a chain of at least two
// orthogonally adjacent points; its last point is the HEAD and it points the way its last segment
// runs. Tapping an arrow sends it out: the head travels straight on in that direction until it
// leaves the board, and the body follows its own path behind it. So the only thing that can stop
// it is ANOTHER arrow (or its own body) somewhere on the straight line from the head to the edge.
//
// EVERY LEVEL IS SOLVABLE, BY CONSTRUCTION. The generator places arrows one at a time and only
// accepts an arrow whose way out is clear of every arrow ALREADY placed. Removing them in the
// reverse of that order therefore always works: when arrow i's turn comes, only arrows 0..i-1 are
// left, and its line was checked clear of exactly those. And because removing an arrow can only
// ever free points, an arrow that is clear stays clear, so ANY order that only ever taps clear
// arrows finishes the board (the greedy check in test.js relies on this). A mistake never makes a
// level unwinnable; it only costs a life.
//
// Arrows are placed from the middle of the board outwards (with some noise), which is what lets
// the board fill up densely: a middle arrow's way out runs through the still-empty outer ring, and
// the outer arrows placed later are the ones that block it.

import { BAND_START, bandOf, bandEnd } from '../../js/arrow-maze-time.js';
import { B8, B8_W, B8_H } from './boards8.js';
import { B9 } from './boards9.js';
import { B10, B10_W, B10_H } from './boards10.js';

export const TIERS = ['easy', 'medium', 'hard', 'expert'];
export const SAVE_V = 1;

/** mulberry32: small, fast, deterministic. Same seed, same board, on every device. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A level's seed: a pure function of tier and level, so everyone's "Easy, level 12" is the same
 *  board and Restart rebuilds exactly what was there. */
export function seedOf(tier, level) {
  let h = 2166136261 >>> 0;
  const s = `wayout:${tier}:${level}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The size and character of a level. Grows with the level, then holds at the tier's cap.
 *  Matched to the reference recordings: Easy level 1 is an 8x4 grid of seven short arrows; Hard
 *  level 1 is a dense board of long winding ones a little over 20 points across. */
export function levelSpec(tier, level) {
  const L = Math.max(0, (level | 0) - 1);
  switch (tier) {
    case 'medium':
      return { cols: clamp(10 + Math.floor(L / 3), 10, 14), rows: clamp(13 + Math.floor(L / 2), 13, 19),
        minLen: 2, maxLen: 8, density: 0.93, straight: 0.55, jitter: 0.25 };
    case 'hard':
      return { cols: clamp(20 + Math.floor(L / 3), 20, 24), rows: clamp(26 + Math.floor(L / 2), 26, 32),
        minLen: 3, maxLen: 12, density: 0.97, straight: 0.5, jitter: 0.22 };
    case 'expert':
      return { cols: clamp(24 + Math.floor(L / 3), 24, 28), rows: clamp(32 + Math.floor(L / 2), 32, 38),
        minLen: 3, maxLen: 16, density: 0.98, straight: 0.45, jitter: 0.2 };
    default:   // easy
      if (L === 0) return { cols: 8, rows: 4, minLen: 2, maxLen: 4, density: 0.7, straight: 0.6, jitter: 0.3 };
      return { cols: clamp(6 + Math.floor(L / 2), 6, 10), rows: clamp(5 + L, 5, 13),
        minLen: 2, maxLen: clamp(4 + Math.floor(L / 3), 4, 8), density: 0.85, straight: 0.6, jitter: 0.3 };
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The head's direction, as [dx, dy]. */
export function dirOf(cells, W) {
  const h = cells[cells.length - 1], p = cells[cells.length - 2];
  return [(h % W) - (p % W), ((h / W) | 0) - ((p / W) | 0)];
}

/** The first point on the head's straight way out that is taken - by another arrow in `occ`
 *  (point -> arrow id, -1 for empty) or by the arrow's own body - as { steps, cell }, steps
 *  counted from the head (1 = the very next point). null when the way out is clear. */
export function blockerOf(cells, occ, W, H, selfId) {
  const [dx, dy] = dirOf(cells, W);
  const h = cells[cells.length - 1];
  let x = h % W, y = (h / W) | 0, steps = 0;
  for (;;) {
    x += dx; y += dy; steps++;
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const i = y * W + x;
    if (occ[i] >= 0 && occ[i] !== selfId) return { steps, cell: i };
    if (occ[i] === selfId || (selfId === undefined && cells.includes(i))) return { steps, cell: i };
  }
}

/** Build one level. Returns { cols, rows, arrows: [[cell, ...], ...] }, head last in each. */
export function generate(spec, seed) {
  const W = spec.cols, H = spec.rows, N = W * H;
  const R = rng(seed);
  const occ = new Int16Array(N).fill(-1);
  const arrows = [];
  const cx = (W - 1) / 2, cy = (H - 1) / 2;

  const order = [];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const d = Math.max(Math.abs(x - cx) / Math.max(1, cx), Math.abs(y - cy) / Math.max(1, cy));
    order.push({ i, k: d + R() * spec.jitter });
  }
  order.sort((a, b) => a.k - b.k);

  const free = (i) => occ[i] < 0;

  function walk(start, target) {
    const path = [start];
    const inPath = new Set(path);
    let dir = DIRS[(R() * 4) | 0];
    while (path.length < target) {
      const at = path[path.length - 1], x = at % W, y = (at / W) | 0;
      const opts = [];
      for (const d of DIRS) {
        const nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (free(ni) && !inPath.has(ni)) opts.push({ d, ni });
      }
      if (!opts.length) break;
      let pick = opts.find((o) => o.d === dir);
      if (!pick || R() > spec.straight) pick = opts[(R() * opts.length) | 0];
      dir = pick.d;
      path.push(pick.ni);
      inPath.add(pick.ni);
    }
    return path;
  }

  function clear(cells) {
    const [dx, dy] = dirOf(cells, W);
    const h = cells[cells.length - 1];
    let x = h % W, y = (h / W) | 0;
    for (;;) {
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= W || y >= H) return true;
      const i = y * W + x;
      if (!free(i) || cells.includes(i)) return false;
    }
  }

  /** The longest piece of `path` (trimmed from either end) that can face a clear way out, either
   *  way round; null if not even `minLen` points can. */
  function fit(path, minLen) {
    for (let len = path.length; len >= minLen; len--) {
      const ways = [];
      for (let from = 0; from + len <= path.length; from++) {
        const a = path.slice(from, from + len);
        ways.push(a, a.slice().reverse());
      }
      for (let k = ways.length - 1; k > 0; k--) { const j = (R() * (k + 1)) | 0; [ways[k], ways[j]] = [ways[j], ways[k]]; }
      for (const w of ways) if (clear(w)) return w;
    }
    return null;
  }
  /** A few tries from one start point; the longest arrow that fits wins (denser boards). */
  function best(start, minLen, maxLen, tries) {
    let got = null;
    for (let k = 0; k < tries; k++) {
      const target = minLen + ((R() * (maxLen - minLen + 1)) | 0);
      const w = fit(walk(start, target), minLen);
      if (w && (!got || w.length > got.length)) got = w;
    }
    return got;
  }

  function place(cells) {
    const id = arrows.length;
    for (const c of cells) occ[c] = id;
    arrows.push(cells);
  }

  for (const { i } of order) {
    if (!free(i) || R() > spec.density) continue;
    const got = best(i, spec.minLen, spec.maxLen, 3);
    if (got) place(got);
  }
  // Dense tiers: a second, short-arrow pass into whatever gaps the first one left.
  if (spec.density >= 0.9) {
    for (const { i } of order) {
      if (!free(i)) continue;
      const got = best(i, 2, 5, 4);
      if (got) place(got);
    }
  }
  // Last, grow arrows backwards into the gaps, which is what makes a board as packed and winding as
  // the reference's. Growing a TAIL never moves a head, so no arrow's way out changes; the only
  // question is whether the new point sits on the way out of an arrow that must leave BEFORE this
  // one (one placed after it), or on this arrow's own way out. `rayMax[c]` is the highest arrow
  // index whose way out crosses point c, so "c is safe for arrow b" is rayMax[c] < b.
  if (spec.density >= 0.8) {
    const rayMax = new Int16Array(N).fill(-1);
    arrows.forEach((cells, id) => {
      const [dx, dy] = dirOf(cells, W);
      const h = cells[cells.length - 1];
      let x = h % W, y = (h / W) | 0;
      for (;;) {
        x += dx; y += dy;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        rayMax[y * W + x] = id;   // ids ascend, so the last write is the highest
      }
    });
    const cap = spec.maxLen + 4;
    for (let grew = true, pass = 0; grew && pass < 6; pass++) {
      grew = false;
      for (const { i } of order) {
        if (!free(i)) continue;
        const x = i % W, y = (i / W) | 0;
        const cands = [];
        for (const d of DIRS) {
          const nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const b = occ[ny * W + nx];
          if (b >= 0 && arrows[b][0] === ny * W + nx && rayMax[i] < b && arrows[b].length < cap) cands.push(b);
        }
        if (!cands.length) continue;
        const b = cands[(R() * cands.length) | 0];
        arrows[b].unshift(i);
        occ[i] = b;
        grew = true;
      }
    }
  }
  return { cols: W, rows: H, arrows };
}

// --- harder boards (generator 2, 2026-10-12) -------------------------------------------------------
//
// Matt, on Medium level 3: *"This seems way too easy. Can you make it more challenging without
// increasing the size and making the arrows smaller/harder to press?"* Measured, generator 1's
// Medium boards let ~50-70% of the arrows leave at the very first tap and cleared in 3-5 "rounds"
// (a round = remove every arrow that is free right now). Building middle-outwards leaves most edge
// arrows pointing straight off the board.
//
// Generator 2 keeps the SAME grid sizes and the same generator, then:
//   1. FLIPS arrows that are free at the start (same points, head at the other end, so it now
//      points INTO the board), keeping a flip only if the board stays solvable and gets harder;
//   2. builds several candidate boards per level and keeps the hardest.
// "Harder" = more rounds, fewer arrows free at the start. Measured over levels 1-20 (desktop):
//   Medium: free at start 0.46 -> ~0.22, rounds 5 -> ~12;  Hard: 0.46 -> ~0.26, rounds 7 -> ~18.
//
// SOLVABILITY IS STILL PROVED, not assumed: a flip is kept only if `peel()` (remove every free
// arrow, repeat) empties the board. That is a proof for the same reason as before - removing an
// arrow only ever frees points, so any order of free taps finishes a board that peel finishes.
//
// GENERATOR 1 IS KEPT, UNCHANGED: a level already in progress (a save from before this) is rebuilt
// with the generator it was played on, or its saved "which arrows are gone" would point at
// different arrows (`gen` in the save; a save with none is generator 1).
//
// GENERATOR 3 (2026-10-13, Matt: "Expert should be more difficult than hard"): generator 2 made Expert
// BIGGER than Hard but no DEEPER (17.9 rounds each). Generator 3 changes Expert only: shorter, more
// winding arrows (more of them on the same grid) and 10 candidates at 8 passes. Measured, levels
// 1-60: 25.9 rounds (fewest 21, above Hard's AVERAGE of 18), 48 ms per build on a desktop. Same grid
// size, so the dots are no smaller. Every other tier builds exactly as generator 2.
//
// GENERATOR 4 (2026-10-13, Matt: "make later levels keep getting harder"): the board stops growing
// at level 13 in every tier, and on generators 2-3 so did the difficulty. From level 14 generator 4
// aims each board at a ROUNDS TARGET that climbs from the tier's old plateau to its ceiling over
// RAMP_LEVELS levels, then holds (`rampTarget`). It reaches it by flipping ANY arrow, not only the ones
// free at the start (`harden(..., all)`), which is what makes the deeper boards possible, and stops
// as soon as the target is met so a level is no harder than its place on the ramp. Levels 1-13 are
// exactly generator 3's boards. Same grid, same arrow sizes.
export const GEN_LATEST = 4;
const RAMP_FROM = 14, RAMP_LEVELS = 60;
const RAMP = { easy: [9, 11], medium: [14, 19], hard: [18.5, 27], expert: [26, 32] };
const RAMP_K = { easy: 8, medium: 8, hard: 8, expert: 6 };
/** The rounds a level of generator 4 aims for: null before the ramp starts (levels 1-13). */
export function rampTarget(tier, level) {
  if (!RAMP[tier] || level < RAMP_FROM) return null;
  const [lo, hi] = RAMP[tier], r = Math.min(1, (level - RAMP_FROM + 1) / RAMP_LEVELS);
  return Math.round(lo + r * (hi - lo));
}
const HARDEN = { easy: { k: 3, passes: 2 }, medium: { k: 6, passes: 4 }, hard: { k: 4, passes: 4 }, expert: { k: 3, passes: 4 } };
const GEN3 = { expert: { k: 10, passes: 8, spec: { maxLen: 12, straight: 0.3, jitter: 0.1 } } };

/** The spec a generator actually builds with: `levelSpec`, plus generator 3's Expert changes. */
export function specFor(tier, level, gen = GEN_LATEST) {
  const spec = levelSpec(tier, level), g3 = gen >= 3 && GEN3[tier];
  return g3 ? { ...spec, ...g3.spec } : spec;
}

/** Peel the board: returns { layers, layer[], clear0 } or null when it cannot be emptied. */
export function peel(W, H, arrows) {
  const n = arrows.length;
  const occ = new Int16Array(W * H).fill(-1);
  arrows.forEach((c, id) => { for (const p of c) occ[p] = id; });
  const gone = new Uint8Array(n), layer = new Int16Array(n);
  let left = n, L = 0;
  while (left) {
    L++;
    const now = [];
    for (let id = 0; id < n; id++) if (!gone[id] && !blockerOf(arrows[id], occ, W, H, id)) now.push(id);
    if (!now.length) return null;
    for (const id of now) { gone[id] = 1; layer[id] = L; for (const p of arrows[id]) occ[p] = -1; }
    left -= now.length;
  }
  let free0 = 0;
  for (let id = 0; id < n; id++) if (layer[id] === 1) free0++;
  return { layers: L, layer, clear0: n ? free0 / n : 0 };
}
const hardness = (m) => m.layers - m.clear0 * 20;

/** Flip arrows that are free at the start while that makes the board harder and keeps it solvable. */
function harden(W, H, arrows, seed, passes, all = false, target = Infinity) {
  const R = rng((seed ^ 0x9e3779b9) >>> 0);
  let cur = peel(W, H, arrows);
  for (let pass = 0; pass < passes && cur.layers < target; pass++) {
    const ids = arrows.map((_, i) => i);
    for (let k = ids.length - 1; k > 0; k--) { const j = (R() * (k + 1)) | 0; [ids[k], ids[j]] = [ids[j], ids[k]]; }
    let changed = false;
    for (const id of ids) {
      if (!all && cur.layer[id] !== 1) continue;
      arrows[id].reverse();
      const m = peel(W, H, arrows);
      if (m && hardness(m) > hardness(cur)) { cur = m; changed = true; } else arrows[id].reverse();
      if (cur.layers >= target) break;
    }
    if (!changed) break;
  }
  return cur;
}

/** The level a player actually plays. `gen` picks the generator (see above); default the latest. */
export function buildLevel(tier, level, gen = GEN_LATEST) {
  const t = TIERS.includes(tier) ? tier : 'easy';
  const seed = seedOf(t, level);
  // Generator 1, and Easy level 1 (the first board anyone sees: it stays a gentle start).
  if (gen === 1 || (t === 'easy' && level <= 1)) return generate(levelSpec(t, level), seed);
  const spec = specFor(t, level, gen);
  const target = gen >= 4 ? rampTarget(t, level) : null;
  if (target !== null) {
    // Generator 4's ramp: the first candidate that reaches the target, else the deepest one.
    let best = null;
    for (let i = 0; i < RAMP_K[t]; i++) {
      const s = (seed + i * 7919) >>> 0;
      const lvl = generate(spec, s);
      const m = harden(lvl.cols, lvl.rows, lvl.arrows, s, 8, true, target);
      if (m && (!best || m.layers > best.layers)) best = { lvl, layers: m.layers };
      if (best && best.layers >= target) break;
    }
    return best.lvl;
  }
  const { k, passes } = (gen >= 3 && GEN3[t]) || HARDEN[t];
  let best = null;
  for (let i = 0; i < k; i++) {
    const s = (seed + i * 7919) >>> 0;
    const lvl = generate(spec, s);
    const m = harden(lvl.cols, lvl.rows, lvl.arrows, s, passes);
    if (m && (!best || hardness(m) > best.score)) best = { lvl, score: hardness(m) };
  }
  return best.lvl;
}

// --- THE LADDER (2026-10-14) -----------------------------------------------------------------------
//
// Matt: *"do it more like other apps and games do it ... Easy are levels 1-25, medium 26-50, hard
// 51-75, and expert 76-100"* (with 50 each in the real game: Easy 1-50, Medium 51-100, Hard 101-150,
// Expert 151 on), *"You can start anywhere"*, and *"I want easy level 50 to be basically medium
// level 51. There shouldn't be a big jump between individual levels."*
//
// So the four tiers are no longer four separate generators that each start small: they are four
// stretches of ONE ladder, numbered 1, 2, 3 ... for ever, and every number on it is one board. Each
// of a board's settings is interpolated between the KEYFRAMES below by ladder number, so neighbours
// differ by at most one dot of grid and about one round, and the four bands meet where the ladder
// passes 50, 100 and 150 with no step at all. The keyframes sit on the old tiers' own sizes (Easy's
// 10x13 by 13, Hard's 24x32 and Expert's 28x38 at the far end) so the ladder covers the same range
// of boards the four tiers did. From level LADDER_TOP the board stops growing and stops deepening.
//
// Level 1 is still the gentle 8x4 first board (generator 1's Easy level 1). Each board aims at a
// ROUNDS TARGET (generator 4's mechanism: flip arrows until the board needs that many waves, then
// stop), so a level is no harder than its place on the ladder.
//
// Its own seeds (`seedOf('ladder', n)`), so it shares no board with the tier generators, which are
// kept unchanged for levels already in progress on them (ui.js carries those through).
// The bands themselves (where each starts, where it ends) live in js/arrow-maze-time.js, beside the
// points, because the stats screens and the leaderboard need them and must not import the game.
export { BAND_START, bandOf, bandEnd };
// Generator 5's top: from here its boards stop growing. Kept for levels in progress on it.
export const LADDER_TOP = 200;
// n, cols, rows, minLen, maxLen, density, straight, jitter, target rounds
const KEYS = [
  [2, 6, 6, 2, 4, 0.85, 0.6, 0.3, 4],
  [13, 10, 13, 2, 8, 0.88, 0.6, 0.3, 9],
  [50, 12, 16, 2, 8, 0.92, 0.55, 0.25, 13],
  [100, 17, 23, 2, 10, 0.95, 0.5, 0.22, 19],
  [150, 23, 30, 3, 12, 0.97, 0.45, 0.2, 25],
  [LADDER_TOP, 28, 38, 3, 12, 0.98, 0.3, 0.1, 31],
];

// GENERATOR 6 (2026-10-14, Matt, after real play showed Expert 152-156 were old-HARD-sized boards:
// *"maybe we spread it out more and add more hard levels in and keep expert as expert ... You came
// up with the bands so you should just make it work"*). The bands moved (js/arrow-maze-time.js):
// Hard is 101-200, Expert 201 on. Levels 1-100 are generator 5's boards exactly (Easy and Medium
// did not change). From 100 the ladder climbs through the old Hard tier's boards (its 20x26 first
// grid by 125) to the old EXPERT tier's first board at 200 (24x32, its short winding arrows, old
// Hard's deepest rounds), so Expert starts where the old Expert started and grows to the old
// Expert's largest and deepest board (28x38, 32 rounds), where it holds.
export const LADDER_GEN = 6;
export const LADDER6_TOP = 260;
const KEYS6 = [
  [100, 17, 23, 2, 10, 0.95, 0.5, 0.22, 19],      // = generator 5's level 100, Medium's last board
  [125, 20, 26, 3, 12, 0.97, 0.5, 0.22, 21],      // the old Hard tier's first grid
  [200, 24, 32, 3, 12, 0.98, 0.32, 0.12, 27],     // the old Expert tier's first grid, old Hard's deepest
  [225, 28, 38, 3, 12, 0.98, 0.3, 0.1, 29],       // the old Expert tier's largest grid
  [LADDER6_TOP, 28, 38, 3, 12, 0.98, 0.3, 0.1, 32], // and its deepest boards
];
function ladderKey(n, keys = KEYS) {
  const x = Math.max(keys[0][0], Math.min(keys[keys.length - 1][0], n));
  let i = 0;
  while (i < keys.length - 2 && x > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], u = (x - a[0]) / (b[0] - a[0]);
  return a.map((v, k) => v + (b[k] - v) * u);
}
/** The spec and rounds target of ladder level n (n >= 2; level 1 is the gentle first board) on
 *  ladder generator `gen` (5 or 6). Generator 6 is generator 5 up to level 100. */
export function ladderSpec(n, gen = LADDER_GEN) {
  const [, cols, rows, minLen, maxLen, density, straight, jitter, target] = ladderKey(n | 0, gen >= 6 && (n | 0) > 100 ? KEYS6 : KEYS);
  return {
    spec: { cols: Math.round(cols), rows: Math.round(rows), minLen: Math.round(minLen), maxLen: Math.round(maxLen),
      density: +density.toFixed(3), straight: +straight.toFixed(3), jitter: +jitter.toFixed(3) },
    target: Math.round(target),
  };
}
/** Ladder level n on ladder generator `gen` (5 or 6), the board a player plays. Deterministic: the
 *  same board on every device. Both generators share seeds, so they agree wherever their specs do
 *  (levels 1-100). */
export function buildLadder(n, gen = LADDER_GEN) {
  const L = Math.max(1, n | 0);
  if (L === 1) return generate(levelSpec('easy', 1), seedOf('easy', 1));
  const { spec, target } = ladderSpec(L, gen === 5 ? 5 : 6);
  const seed = seedOf('ladder', L);
  // Above level 100 generator 6 may try up to 10 boards (it stops at the first on target, so most
  // levels try 1-3): with 6, a big Hard board could come out 4 rounds short of its neighbours.
  const K = gen !== 5 && L > 100 ? 10 : spec.cols * spec.rows > 600 ? 6 : 8;
  // The candidate nearest the target wins: short of it counts double, so a board is deeper than its
  // place on the ladder only when no candidate lands on it (a candidate can come out of `generate`
  // already past it). Stops at the first one that lands on the target or one above.
  const miss = (layers) => (layers < target ? (target - layers) * 2 : layers - target);
  let best = null;
  for (let i = 0; i < K; i++) {
    const s = (seed + i * 7919) >>> 0;
    const lvl = generate(spec, s);
    const m = harden(lvl.cols, lvl.rows, lvl.arrows, s, 8, true, target);
    if (m && (!best || miss(m.layers) < miss(best.layers))) best = { lvl, layers: m.layers };
    if (best && best.layers >= target && best.layers <= target + 1) break;
  }
  return best.lvl;
}

// --- MORE LEVELS (2026-10-26) -------------------------------------------------------------------
//
// Matt: "People have beaten easy and medium and hard ... we need to add WAY more per difficulty. It's
// not that expert is actually more difficult, it's that people would like to play it, but the arrows
// are so small that you hit arrows you didn't mean to hit." So Easy, Medium and Hard NEVER END now,
// like Expert: past 50 / 100 / 200 each goes on, numbered on (Easy 51, 52 ...; "Easy 51" is not
// Medium 51). GENERATOR 7: each of these boards is built like a ladder level picked (by its seed)
// from the top of its own difficulty (MORE_FROM .. the band's last), never bigger than the band's
// last board, so the arrows never get smaller than the difficulty already has. Own seeds
// (`seedOf('more-<band>', n)`), so no board repeats a ladder board. Pinned by hash in test.js.
export const MORE_GEN = 7;
/** The ladder levels a band's MORE boards are modelled on: from here to the band's last level. */
export const MORE_FROM = { easy: 31, medium: 81, hard: 161 };
/** The ladder level MORE board n of `band` is built like. */
export function moreLevel(band, n) {
  const lo = MORE_FROM[band], hi = bandEnd(band);
  return lo + (seedOf(`more-pick-${band}`, n | 0) % (hi - lo + 1));
}
/** MORE board n (n past the band's last ladder level) of Easy, Medium or Hard. Deterministic. */
export function buildMore(band, n) {
  const m = moreLevel(band, n);
  const { spec, target } = ladderSpec(m, LADDER_GEN);
  const seed = seedOf(`more-${band}`, n | 0);
  const K = m > 100 ? 10 : spec.cols * spec.rows > 600 ? 6 : 8;
  const miss = (layers) => (layers < target ? (target - layers) * 2 : layers - target);
  let best = null;
  for (let i = 0; i < K; i++) {
    const s = (seed + i * 7919) >>> 0;
    const lvl = generate(spec, s);
    const h = harden(lvl.cols, lvl.rows, lvl.arrows, s, 8, true, target);
    if (h && (!best || miss(h.layers) < miss(best.layers))) best = { lvl, layers: h.layers };
    if (best && best.layers >= target && best.layers <= target + 1) break;
  }
  return best.lvl;
}
/** Is level n of `band` one of its MORE levels (past the ladder's stretch)? Expert has none. */
export function isMore(band, n) {
  return band !== 'expert' && MORE_FROM[band] != null && (n | 0) > bandEnd(band);
}

// --- GENERATOR 8: HARD AND EXPERT BY THINKING (2026-10-27) ---------------------------------------
//
// Matt played the admin test boards: "Holy shit these are WAY harder. And WAY better", and on the
// milder Hard ones "That's perfect for Hard. Make the updates". The search that finds such boards
// (tools/arrow-search.mjs) is far too slow for a phone, so tools/build-arrow-boards8.mjs builds them once
// and boards8.js ships them packed. Hard is the "hard" style throughout (45 arrows, ~2 free at a
// time, blockers ~5 dots away); Expert climbs through far blockers, mixed and forced order. Both on a
// 16x22 grid, so the arrows are BIGGER than the ladder's Hard and Expert, the mis-tap complaint.
// Level n of a band is board k = n - B8_FROM[band]; past the shipped list the boards come round again
// MIRRORED (a mirror of a solvable board is solvable: every blocker mirrors with it), Expert from the
// top of its list, so it never drops back to its gentler start.
export const B8_GEN = 8;
export const B8_FROM = { hard: 101, expert: 201 };
/** A packed generator-8 board back to arrows (tail first, head last). */
export function unpackB8(s) {
  const bin = atob(s);
  let pos = 0;
  const get = (n) => { let v = 0; for (let k = 0; k < n; k++, pos++) v = (v << 1) | ((bin.charCodeAt(pos >> 3) >> (7 - (pos & 7))) & 1); return v; };
  const step = [1, -1, B8_W, -B8_W];
  const arrows = [];
  for (let a = get(7); a > 0; a--) {
    const c = [get(9)];
    for (let len = get(4); len > 0; len--) c.push(c[c.length - 1] + step[get(2)]);
    arrows.push(c);
  }
  return arrows;
}
/** Which shipped board, and which mirror (0 none, 1 left-right, 2 top-bottom, 3 both), level n is. */
export function b8Slot(band, n, lists = B8) {
  const list = lists[band] || [], k = Math.max(0, (n | 0) - B8_FROM[band]);
  if (k < list.length) return { i: k, t: 0 };
  const from = band === 'expert' ? Math.floor(list.length * 0.6) : 0, span = list.length - from, j = k - list.length;
  return { i: from + (j % span), t: 1 + (Math.floor(j / span) % 3) };
}
/** Level n of Hard or Expert on generator 8. Deterministic: a fixed board from the shipped file. */
export function buildB8(band, n, lists = B8) {
  const { i, t } = b8Slot(band, n, lists);
  const mx = (c) => { const x = c % B8_W, y = (c / B8_W) | 0; return ((t & 2) ? B8_H - 1 - y : y) * B8_W + ((t & 1) ? B8_W - 1 - x : x); };
  return { cols: B8_W, rows: B8_H, arrows: unpackB8(lists[band][i]).map((c) => c.map(mx)) };
}
// GENERATOR 9 (2026-10-27, Matt: "I feel like the test expert levels were much more difficult than the
// ones I'm doing rn"): generator 8's Expert 201-260 were only the milder test styles. Generator 9 is
// Expert only, FORCED ORDER four levels in five (one arrow free at a time, ~50 arrows growing to ~70)
// and MIXED every fifth; boards9.js, built by tools/build-arrow-boards9.mjs, the same packing and the
// same mirrored wrap. Generator 8's Expert boards stay for levels already played or in progress.
export const B9_GEN = 9;
/** Expert level n on generator 9. */
export function buildB9(band, n) { return buildB8(band, n, B9); }
/** Is there a generator-9 board for level n of `band`? (Expert from 201.) */
export function hasB9(band, n) {
  return band === 'expert' && (B9.expert || []).length > 0 && (n | 0) >= B8_FROM.expert;
}
/** Is there a generator-8 board for level n of `band`? (Hard from 101, Expert from 201.) */
export function hasB8(band, n) {
  return B8_FROM[band] != null && (B8[band] || []).length > 0 && (n | 0) >= B8_FROM[band];
}
// GENERATOR 10 (2026-10-28, Matt, halfway through Impossible test board 11: "THIS is what Expert should
// be like", then "The new levels should replace the Expert levels that are there. I don't want anyone
// getting 6 points from the old (existing) levels"): EVERY Expert level, for everyone, is board 11's
// recipe on its 28x38 grid (exactly one arrow free at every step, the next one far away, lookalike
// arrows, no trains). boards10.js, built by tools/build-arrow-boards10.mjs (11 bits a cell, 5 bits a
// length). Level n is board n - 201; past the list the same mirrored wrap as generator 8, from 60%.
// Generators 8 and 9's Expert boards are no longer played (old saves on them start over; ui.js readSave).
export const B10_GEN = 10;
export const B10_COUNT = B10.length;
/** A packed generator-10 board back to arrows (tail first, head last). */
export function unpackB10(s) {
  const bin = atob(s);
  let pos = 0;
  const get = (n) => { let v = 0; for (let k = 0; k < n; k++, pos++) v = (v << 1) | ((bin.charCodeAt(pos >> 3) >> (7 - (pos & 7))) & 1); return v; };
  const step = [1, -1, B10_W, -B10_W];
  const arrows = [];
  for (let a = get(7); a > 0; a--) {
    const c = [get(11)];
    for (let len = get(5); len > 0; len--) c.push(c[c.length - 1] + step[get(2)]);
    arrows.push(c);
  }
  return arrows;
}
/** Expert level n on generator 10, from the first `m` shipped boards (a save names its `m`: boards are
 *  added in batches, and a level past the list wraps, so the same n can name a new board once more ship). */
export function buildB10(n, m = B10.length) {
  const list = Number.isInteger(m) && m >= 1 && m <= B10.length ? B10.slice(0, m) : B10;
  const { i, t } = b8Slot('expert', n, { expert: list });
  const mx = (c) => { const x = c % B10_W, y = (c / B10_W) | 0; return ((t & 2) ? B10_H - 1 - y : y) * B10_W + ((t & 1) ? B10_W - 1 - x : x); };
  return { cols: B10_W, rows: B10_H, arrows: unpackB10(B10[i]).map((c) => c.map(mx)) };
}
/** Is level n of `band` on generator 10? Every Expert level. */
export function hasB10(band) {
  return band === 'expert' && B10.length > 0;
}

// --- RUSH (2026-10-14) --------------------------------------------------------------------------
//
// Rush's boards (js/arrow-maze-time.js, "RUSH"): board i of a run is built to the spec of a ladder
// level that climbs as the run goes on, Easy through the Easy band's boards and Hard from the
// Medium band's (the Hard band's would leave the first board unfinishable in the time). A RANDOM seed
// per run, so a run cannot be learned by heart; the same seed always gives the same boards. Fewer
// candidates than the ladder (a board must be ready while the clock runs; it is built ahead).
/** The ladder level whose board Rush's board `i` (0 = the first) is built like. */
export function rushLevel(mode, i) {
  const k = Math.max(0, i | 0);
  return mode === 'hard' ? Math.min(120, 51 + 8 * k) : Math.min(50, 3 + 6 * k);
}
/** Rush board `i` of the run with seed `seed`. Deterministic. */
export function buildRush(mode, i, seed) {
  const { spec, target } = ladderSpec(rushLevel(mode, i), LADDER_GEN);
  let best = null;
  for (let k = 0; k < 3; k++) {
    const s = ((seed >>> 0) + (i | 0) * 104729 + k * 7919) >>> 0;
    const lvl = generate(spec, s);
    const m = harden(lvl.cols, lvl.rows, lvl.arrows, s, 8, true, target);
    if (m && (!best || Math.abs(m.layers - target) < Math.abs(best.layers - target))) best = { lvl, layers: m.layers };
    if (best && best.layers >= target) break;
  }
  return best.lvl;
}

/** Point -> arrow id for the arrows still on the board (`gone[id]` true = already sent out). */
export function occupancy(lvl, gone) {
  const occ = new Int16Array(lvl.cols * lvl.rows).fill(-1);
  lvl.arrows.forEach((cells, id) => { if (!gone[id]) for (const c of cells) occ[c] = id; });
  return occ;
}

/** An arrow that can go right now (for the hint), preferring one the player has not already
 *  bumped. -1 when none can (an empty board, or every clear arrow is mid-animation). */
export function hintArrow(lvl, gone, red, skip) {
  // `skip[id]`: never suggest this one (it is mid-animation), but it still BLOCKS - an arrow
  // bumping and springing back is on the board, so it must stay in the occupancy.
  const occ = occupancy(lvl, gone);
  let fallback = -1;
  for (let id = 0; id < lvl.arrows.length; id++) {
    if (gone[id] || (skip && skip[id])) continue;
    if (!blockerOf(lvl.arrows[id], occ, lvl.cols, lvl.rows, id)) {
      if (!red || !red[id]) return id;
      if (fallback < 0) fallback = id;
    }
  }
  return fallback;
}
