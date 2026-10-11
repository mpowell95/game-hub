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

/** The level a player actually plays. */
export function buildLevel(tier, level) {
  const t = TIERS.includes(tier) ? tier : 'easy';
  return generate(levelSpec(t, level), seedOf(t, level));
}

/** Point -> arrow id for the arrows still on the board (`gone[id]` true = already sent out). */
export function occupancy(lvl, gone) {
  const occ = new Int16Array(lvl.cols * lvl.rows).fill(-1);
  lvl.arrows.forEach((cells, id) => { if (!gone[id]) for (const c of cells) occ[c] = id; });
  return occ;
}

/** An arrow that can go right now (for the hint), preferring one the player has not already
 *  bumped. -1 only when the board is empty. */
export function hintArrow(lvl, gone, red) {
  const occ = occupancy(lvl, gone);
  let fallback = -1;
  for (let id = 0; id < lvl.arrows.length; id++) {
    if (gone[id]) continue;
    if (!blockerOf(lvl.arrows[id], occ, lvl.cols, lvl.rows, id)) {
      if (!red || !red[id]) return id;
      if (fallback < 0) fallback = id;
    }
  }
  return fallback;
}
