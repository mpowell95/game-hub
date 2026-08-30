// pipes/js/generator.js - board generation. Pure: no DOM, no timers, no ambient randomness.
//
// THE ONE IDEA IN THIS FILE: build the solution first, then destroy it. A board is never generated
// randomly and checked afterwards, because "generate and hope" is how a puzzle game ships an
// unsolvable level to a real player. Here solvability is guaranteed BY CONSTRUCTION - the board is
// laid out solved and then scrambled, so a solution provably exists - and pipes/js/test.js still
// verifies it independently on every tier and every seed, because a construction can break.
//
// A PIECE IS A 4-BIT MASK. N=1, E=2, S=4, W=8, one bit per open side. That single representation is
// most of why this engine is small:
//   - rotating clockwise is a bit rotate, `((m << 1) | (m >> 3)) & 15`;
//   - two neighbours are joined when each has the bit facing the other;
//   - the piece KIND (straight, elbow, tee, cross, cap) is derivable from the mask, so nothing has
//     to store it or keep it in sync.
//
// WIN CONDITION - "path with no leaks" (Matt's choice, 2026-08-29). Water floods from the inlet
// through joined openings; it must reach the outlet, AND no pipe the water reaches may have an
// opening that points at a neighbour which does not open back, or off the edge of the board. A
// leak is visible and fixable, which is what makes the water animation mean something rather than
// decorate. See `isSolved()` in game.js.

export const N = 1, E = 2, S = 4, W = 8;
export const DIRS = [N, E, S, W];
/** Offset per direction bit, and the bit that faces back the other way. */
export const DX = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
export const DY = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };
export const OPPOSITE = { [N]: S, [E]: W, [S]: N, [W]: E };

/** Rotate a mask one quarter turn clockwise. Four applications return the original. */
export function rotate(mask) { return ((mask << 1) | (mask >> 3)) & 15; }

export function popcount(mask) {
  let n = 0;
  for (const d of DIRS) if (mask & d) n++;
  return n;
}

/** The piece kind, derived rather than stored. 'blank' | 'cap' | 'straight' | 'elbow' | 'tee' | 'cross'. */
export function kindOf(mask) {
  const n = popcount(mask);
  if (n === 0) return 'blank';
  if (n === 1) return 'cap';
  if (n === 3) return 'tee';
  if (n === 4) return 'cross';
  return (mask === (N | S) || mask === (E | W)) ? 'straight' : 'elbow';
}

/** How many clockwise rotations take `from` to `to`, or -1 if they are not the same piece. */
export function turnsBetween(from, to) {
  let m = from;
  for (let i = 0; i < 4; i++) {
    if (m === to) return i;
    m = rotate(m);
  }
  return -1;
}

// --- tiers ---------------------------------------------------------------------------------------
//
// Four tiers onto the shared 1-4 scale in js/difficulty-tiers.js, so the colourblind-safe shape
// markers come for free (Matt is red/green colourblind; hue alone is never allowed).
//
// GRID SIZES ARE BOUNDED BY THE 44px TAP FLOOR, not by taste. On a 393px-wide phone with 12px of
// padding a side, 8 columns is 46px - just over the floor. Height is the tighter constraint: on a
// SHORT phone (664px, the height test-visual.mjs checks) the hub's chrome plus this game's own
// header leaves room for about 9 rows at 44px. Extra Hard is therefore 8x9, not the 8x10 the scope
// document proposed - measured, not guessed. See docs/BUILDING-A-GAME.md Part 0.

export const TIER_ORDER = ['easy', 'medium', 'hard', 'extraHard'];

const TIERS = {
  easy: { w: 5, h: 5, pieces: ['straight', 'elbow'], decoy: 0.35, minPath: 8 },
  medium: { w: 6, h: 7, pieces: ['straight', 'elbow', 'tee'], decoy: 0.5, minPath: 14 },
  hard: { w: 7, h: 8, pieces: ['straight', 'elbow', 'tee', 'cross'], decoy: 0.65, minPath: 20 },
  extraHard: { w: 8, h: 9, pieces: ['straight', 'elbow', 'tee', 'cross'], decoy: 0.8, minPath: 30 },
};

export function tierConfig(tier) { return TIERS[tier] || TIERS.easy; }

// Quality gates, in the generator where a player can never meet a board that failed them.
const GATES = {
  /** No more than this fraction of pieces may start already in their solved rotation. A board that
   *  arrives half-correct reads as cheap - "a mess of pipes" was the whole brief. */
  maxPrePlaced: 0.12,
  /** A board must be at least this many rotations from solved, or it is three taps from done. */
  minTurns: 6,
  /** Attempts before giving up on a walk and restarting. Generation is cheap; a bad board is not. */
  walkTries: 400,
};

/** Deterministic PRNG so a seed reproduces a board exactly - what makes test.js meaningful. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const idx = (x, y, w) => y * w + x;

/** A self-avoiding walk from an edge cell to a DIFFERENT edge, at least `minPath` cells long. */
function carvePath(w, h, minPath, rnd) {
  for (let attempt = 0; attempt < GATES.walkTries; attempt++) {
    const startLeft = rnd() < 0.5;
    const sx = startLeft ? 0 : w - 1;
    const sy = Math.floor(rnd() * h);
    const seen = new Uint8Array(w * h);
    const path = [[sx, sy]];
    seen[idx(sx, sy, w)] = 1;
    let x = sx, y = sy;
    let guard = w * h * 6;
    while (guard-- > 0) {
      const opts = [];
      for (const d of DIRS) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (seen[idx(nx, ny, w)]) continue;
        // Refuse a step that would touch the existing path on more than one side: that creates a
        // loop, and a loop makes the "correct" rotation of a cell ambiguous.
        let touches = 0;
        for (const e of DIRS) {
          const ax = nx + DX[e], ay = ny + DY[e];
          if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
          if (seen[idx(ax, ay, w)]) touches++;
        }
        if (touches > 1) continue;
        opts.push([nx, ny]);
      }
      if (!opts.length) break;
      const [nx, ny] = opts[Math.floor(rnd() * opts.length)];
      seen[idx(nx, ny, w)] = 1;
      path.push([nx, ny]);
      x = nx; y = ny;
      const onFarEdge = startLeft ? x === w - 1 : x === 0;
      if (onFarEdge && path.length >= minPath) return path;
    }
  }
  return null;
}

/**
 * Build one board.
 *
 * Returns { w, h, cells, solution, src, dst, tier, seed, turns } where `cells` is the SCRAMBLED
 * board the player sees and `solution` is the configuration it was built from. `solution` is kept
 * for the tests and for the "minimum turns" measure; the game never consults it, because the win
 * check is computed from the board itself and a second source of truth would be one too many.
 */
export function generate(tier, seed) {
  const cfg = tierConfig(tier);
  const { w, h } = cfg;
  const rnd = rng(seed);

  const path = carvePath(w, h, cfg.minPath, rnd);
  if (!path) return generate(tier, (seed + 0x9e3779b9) >>> 0);   // vanishingly rare; try another seed

  const solution = new Uint8Array(w * h);
  const onPath = new Uint8Array(w * h);
  for (const [x, y] of path) onPath[idx(x, y, w)] = 1;

  // Lay pipe along the path: each cell opens toward its path neighbours. The two ends get one
  // opening each, which makes them caps - the inlet and the outlet.
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    let m = 0;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= path.length) continue;
      const [ax, ay] = path[j];
      for (const d of DIRS) if (x + DX[d] === ax && y + DY[d] === ay) m |= d;
    }
    solution[idx(x, y, w)] = m;
  }

  // Decoys. A decoy must be placeable so that it does NOT touch the water's network, or the board
  // would be unsolvable under the no-leaks rule - so only a piece with a rotation whose openings
  // all avoid the path is allowed here, and the piece is downgraded until one fits. A cross beside
  // the path can never avoid it, which is exactly why crosses cannot go there.
  const order = ['cross', 'tee', 'elbow', 'straight'];
  const MASKS = { straight: N | S, elbow: N | E, tee: N | E | S, cross: N | E | S | W };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (onPath[i]) continue;
      if (rnd() >= cfg.decoy) continue;
      let forbidden = 0;
      for (const d of DIRS) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (onPath[idx(nx, ny, w)]) forbidden |= d;
      }
      const allowed = order.filter((k) => cfg.pieces.includes(k));
      const wanted = allowed[Math.floor(rnd() * allowed.length)];
      const tryOrder = [wanted, ...order.filter((k) => k !== wanted && cfg.pieces.includes(k))];
      let placed = 0;
      for (const k of tryOrder) {
        let m = MASKS[k];
        for (let r = 0; r < 4; r++) {
          if ((m & forbidden) === 0) { placed = m; break; }
          m = rotate(m);
        }
        if (placed) break;
      }
      solution[i] = placed;                       // 0 (blank) when nothing fits, which is fine
    }
  }

  // Scramble, honouring the quality gates.
  const cells = new Uint8Array(solution);
  let turns = 0;
  let prePlaced = 0;
  const live = [];
  for (let i = 0; i < cells.length; i++) if (popcount(cells[i]) > 0 && kindOf(cells[i]) !== 'cross') live.push(i);
  for (const i of live) {
    const spins = 1 + Math.floor(rnd() * 3);      // 1..3, so never a no-op turn
    for (let r = 0; r < spins; r++) cells[i] = rotate(cells[i]);
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === solution[i]) { if (popcount(cells[i]) > 0) prePlaced++; continue; }
    const t = turnsBetween(cells[i], solution[i]);
    turns += t < 0 ? 0 : Math.min(t, 4 - t);
  }
  const pieces = live.length || 1;
  if (turns < GATES.minTurns || prePlaced / pieces > GATES.maxPrePlaced) {
    return generate(tier, (seed + 0x85ebca6b) >>> 0);
  }

  const [sx, sy] = path[0];
  const [dx, dy] = path[path.length - 1];
  return {
    w, h, tier, seed, turns,
    cells, solution,
    src: idx(sx, sy, w),
    dst: idx(dx, dy, w),
  };
}

export default { generate, rotate, kindOf, popcount, turnsBetween, tierConfig, TIER_ORDER, rng };
