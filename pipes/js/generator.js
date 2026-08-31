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
  // decoy 1 = EVERY cell off the path carries a piece. The reference board has no holes in it at
  // all (IMG_4602: 63 cells, 63 pieces) and "a mess of pipes" was the brief; at 0.35 easy came out
  // 43% empty and read as a handful of scattered fragments rather than plumbing. See the decoy
  // block below for why filling those cells cannot cost solvability.
  // 'cap' IS IN EVERY LIST, and it is what puts BULBS on the board. The reference's boards are
  // dotted with them and ours had exactly two, which is most of why a board of ours read as bare
  // lines next to one of theirs. A cap is a dead end: under this game's rule it can never leak
  // (nothing reaches it), so it is a pure piece of texture. The inlet and outlet stay legible
  // because a bulb the water is IN gets a hole punched through it - the reference's own tell.
  // 4x4 IS THE REFERENCE'S OWN EARLY BOARD (its level 2, measured off the recording: 1047px square
  // on a 1206px screen, four cells across). Fewer, bigger cells is most of why its pipes read as
  // fat and confident where a 5x5 of ours read as thin lines - the art ratios were already right,
  // the cells were just smaller.
  easy: { w: 4, h: 4, pieces: ['straight', 'elbow', 'cap'], decoy: 1, minPath: 6 },
  medium: { w: 6, h: 7, pieces: ['straight', 'elbow', 'tee', 'cap'], decoy: 1, minPath: 14 },
  hard: { w: 7, h: 8, pieces: ['straight', 'elbow', 'tee', 'cross', 'cap'], decoy: 1, minPath: 20 },
  extraHard: { w: 7, h: 10, pieces: ['straight', 'elbow', 'tee', 'cross', 'cap'], decoy: 1, minPath: 30 },
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

  // Decoys - every cell that is not on the path, with no restriction on where they may point.
  //
  // THIS USED TO REFUSE ANY DECOY THAT POINTED AT THE PATH, on the stated grounds that it "would be
  // unsolvable under the no-leaks rule", and downgraded the piece (cross -> tee -> elbow ->
  // straight -> blank) until one fitted. That was wrong, and it cost a quarter of the board: it is
  // where the blank cells came from, and it is why a cross could never sit beside the path.
  //
  // A decoy pointing INTO a path cell cannot leak, because a leak is only ever reported for a cell
  // the water REACHES (`flow()` in game.js walks `order`, and only pushes a cell it can get to).
  // Two cells are joined only when EACH opens toward the other, and in the constructed solution a
  // path cell opens along the path and nowhere else - so it never opens back at a decoy, the decoy
  // never joins the network, and it stays dry whatever it is pointing at. The solved board is still
  // solved with a piece in every cell; pipes/js/test.js proves it independently over every tier and
  // 40 seeds, and would go red here first if this reasoning were wrong.
  const MASKS = { straight: N | S, elbow: N | E, tee: N | E | S, cross: N | E | S | W, cap: N };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (onPath[i]) continue;
      if (rnd() >= cfg.decoy) continue;
      const kind = cfg.pieces[Math.floor(rnd() * cfg.pieces.length)];
      let m = MASKS[kind];
      const spins = Math.floor(rnd() * 4);
      for (let r = 0; r < spins; r++) m = rotate(m);
      solution[i] = m;
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
