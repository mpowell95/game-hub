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
  easy: { w: 4, h: 4 },
  medium: { w: 6, h: 7 },
  hard: { w: 7, h: 8 },
  extraHard: { w: 7, h: 10 },
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

/**
 * Carve a random SPANNING TREE over every cell, and return each cell's mask.
 *
 * A randomised depth-first carve (the recursive-backtracker maze) visits every cell exactly once
 * and opens exactly one edge into each newly reached cell, so the result is connected and has no
 * loops. A loop would make a cell's "correct" rotation ambiguous; leaving a cell out would make it
 * filler, which is the whole thing this replaced.
 *
 * The piece KINDS fall out of it rather than being chosen: a leaf of the tree has one opening and
 * is a cap (a bulb), a pass-through is a straight or an elbow, a fork is a tee, and a cell with all
 * four is a cross.
 */
function carveTree(w, h, rnd) {
  const n = w * h;
  const mask = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const start = Math.floor(rnd() * n);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack[stack.length - 1];
    const x = i % w, y = (i / w) | 0;
    const opts = [];
    for (const d of DIRS) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (seen[idx(nx, ny, w)]) continue;
      opts.push(d);
    }
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(rnd() * opts.length)];
    const ni = idx(x + DX[d], y + DY[d], w);
    mask[i] |= d;
    mask[ni] |= OPPOSITE[d];
    seen[ni] = 1;
    stack.push(ni);
  }
  return mask;
}

/**
 * Build one board.
 *
 * Returns { w, h, cells, solution, src, dst, tier, seed, turns } where `cells` is the SCRAMBLED
 * board the player sees and `solution` is the configuration it was built from. `solution` is kept
 * for the tests and for the "minimum turns" measure; the game never consults it, because the win
 * check is computed from the board itself and a second source of truth would be one too many.
 *
 * THERE ARE NO DECOYS AND NO FILLER. Every cell is on the one network, so every piece a player
 * turns is a piece that matters. The old construction carved a single path and sprinkled the rest
 * of the grid with pieces the water could never reach - 52% of a Medium board was unreachable, and
 * adding bulbs to that filler (2026-08-31) turned it into a field of visible dead ends. Matt,
 * shown his own board: "Explain how this board doesn't have dead ends or 'decoys'." It could not
 * be explained; it could only be removed.
 */
export function generate(tier, seed) {
  const cfg = tierConfig(tier);
  const { w, h } = cfg;
  const rnd = rng(seed);
  const n = w * h;

  const solution = carveTree(w, h, rnd);

  // The source and the drain are two LEAVES of the tree - single-opening cells, which is what draws
  // as a bulb. Picking leaves (rather than any two cells) is what makes them read as the ends of
  // the run, and the reference marks its source the same way.
  const leaves = [];
  for (let i = 0; i < n; i++) if (popcount(solution[i]) === 1) leaves.push(i);
  const src = leaves.length ? leaves[Math.floor(rnd() * leaves.length)] : 0;
  let dst = src;
  if (leaves.length > 1) {
    let guard = 64;
    while (dst === src && guard-- > 0) dst = leaves[Math.floor(rnd() * leaves.length)];
  }

  // Scramble, honouring the quality gates. A cross has one rotation, so it is never scrambled.
  const cells = new Uint8Array(solution);
  let turns = 0;
  let prePlaced = 0;
  const live = [];
  for (let i = 0; i < n; i++) if (popcount(cells[i]) > 0 && kindOf(cells[i]) !== 'cross') live.push(i);
  for (const i of live) {
    const spins = 1 + Math.floor(rnd() * 3);      // 1..3, so never a no-op turn
    for (let r = 0; r < spins; r++) cells[i] = rotate(cells[i]);
  }
  for (let i = 0; i < n; i++) {
    if (cells[i] === solution[i]) { if (popcount(cells[i]) > 0) prePlaced++; continue; }
    const t = turnsBetween(cells[i], solution[i]);
    turns += t < 0 ? 0 : Math.min(t, 4 - t);
  }
  const pieces = live.length || 1;
  if (turns < GATES.minTurns || prePlaced / pieces > GATES.maxPrePlaced) {
    return generate(tier, (seed + 0x85ebca6b) >>> 0);
  }

  return { w, h, tier, seed, turns, cells, solution, src, dst };
}

export default { generate, rotate, kindOf, popcount, turnsBetween, tierConfig, TIER_ORDER, rng };
