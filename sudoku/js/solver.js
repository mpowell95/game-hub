// sudoku/js/solver.js - PURE: no DOM, no timers, no ambient randomness.
//
// Two independent things live here, on purpose:
//   1. A BACKTRACKING solution counter (`countSolutions`), capped at 2 - used by the generator
//      to prove a dug puzzle still has exactly one solution, and by the tests to prove a puzzle
//      is neither under- nor over-constrained.
//   2. A HUMAN-TECHNIQUE solver (`gradeGrid`) that applies the same four techniques a person
//      would (naked single, hidden single, pointing pair / box-line reduction, naked pair /
//      hidden pair) and reports the hardest technique it needed, or that it STALLED (needs
//      guessing/backtracking to finish at all). This is what grades a puzzle's difficulty -
//      grading by givens count alone cannot tell a genuinely hard puzzle from an easy one with
//      few givens.
//
// A cell's CANDIDATE SET is a 9-bit mask, bit (d-1) set means digit d is still possible there.
// Rows/cols/boxes are precomputed once as index lists (UNITS), and PEERS[i] is the union of the
// three units cell i belongs to, minus i itself (at most 20 cells).

const SIZE = 9;
const N = 81;

function boxOf(i) {
  const r = (i / SIZE) | 0, c = i % SIZE;
  return (((r / 3) | 0) * 3 + ((c / 3) | 0));
}

/** 9 rows + 9 cols + 9 boxes, each a length-9 array of cell indices. */
export const UNITS = (() => {
  const units = [];
  for (let r = 0; r < SIZE; r++) units.push(Array.from({ length: SIZE }, (_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) units.push(Array.from({ length: SIZE }, (_, r) => r * SIZE + c));
  for (let b = 0; b < SIZE; b++) {
    const br = (b / 3) | 0, bc = b % 3;
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push((br * 3 + r) * SIZE + (bc * 3 + c));
    units.push(cells);
  }
  return units;
})();

export const ROW_UNITS = UNITS.slice(0, 9);
export const COL_UNITS = UNITS.slice(9, 18);
export const BOX_UNITS = UNITS.slice(18, 27);

/** Every unit index that contains cell i - always exactly [row, col, box]. */
export const UNITS_OF = (() => {
  const of = Array.from({ length: N }, () => []);
  UNITS.forEach((unit, u) => { for (const i of unit) of[i].push(u); });
  return of;
})();

export const PEERS = (() => {
  const peers = Array.from({ length: N }, () => new Set());
  for (const unit of UNITS) for (const i of unit) for (const j of unit) if (i !== j) peers[i].add(j);
  return peers.map((s) => Array.from(s));
})();

export function popcount(mask) {
  let n = 0;
  while (mask) { n += mask & 1; mask >>= 1; }
  return n;
}

/** The single digit a one-bit mask represents, or 0 for anything else. */
export function digitOfMask(mask) {
  for (let d = 1; d <= 9; d++) if (mask === (1 << (d - 1))) return d;
  return 0;
}

function candidatesAt(grid, i, given) {
  if (given[i]) return 0;
  if (grid[i]) return 0;
  let mask = 511;
  for (const j of PEERS[i]) if (grid[j]) mask &= ~(1 << (grid[j] - 1));
  return mask;
}

/**
 * Count solutions of `grid` (0 = blank), stopping as soon as `cap` are found. Uses a
 * minimum-remaining-candidates (MRV) backtracking search: at every step it fills the emptiest
 * cell first, which both finds a first solution fast and proves uniqueness fast (a second
 * solution, if one exists, tends to diverge near a low-candidate cell).
 *
 * Returns 0 (no solution / contradiction), 1, or `cap` (2 or more, capped).
 */
export function countSolutions(puzzle, cap = 2) {
  const grid = Uint8Array.from(puzzle);
  const given = new Uint8Array(N); // unused marker; candidatesAt treats grid[i]!=0 as filled
  let count = 0;
  let steps = 0;
  const MAX_STEPS = 3_000_000;

  function pickCell() {
    let best = -1, bestN = 10, deadEnd = false;
    for (let i = 0; i < N; i++) {
      if (grid[i]) continue;
      const mask = candidatesAt(grid, i, given);
      const n = popcount(mask);
      if (n === 0) { deadEnd = true; break; }
      if (n < bestN) { bestN = n; best = i; if (n === 1) break; }
    }
    return { best, deadEnd };
  }

  function solve() {
    if (count >= cap || ++steps > MAX_STEPS) return;
    const { best, deadEnd } = pickCell();
    if (deadEnd) return;
    if (best === -1) { count++; return; } // every cell filled
    const mask = candidatesAt(grid, best, given);
    for (let d = 1; d <= 9; d++) {
      if (!(mask & (1 << (d - 1)))) continue;
      grid[best] = d;
      solve();
      grid[best] = 0;
      if (count >= cap) return;
    }
  }
  solve();
  return count;
}

/** Solve a puzzle fully via backtracking (used by tests, never by the generator's uniqueness
 *  gate - that only needs a COUNT). Returns the solved grid, or null if no solution exists. */
export function backtrackSolve(puzzle) {
  const grid = Uint8Array.from(puzzle);
  let solved = null;
  function pickCell() {
    let best = -1, bestN = 10, deadEnd = false;
    for (let i = 0; i < N; i++) {
      if (grid[i]) continue;
      const mask = candidatesAt(grid, i, grid);
      const n = popcount(mask);
      if (n === 0) { deadEnd = true; break; }
      if (n < bestN) { bestN = n; best = i; if (n === 1) break; }
    }
    return { best, deadEnd };
  }
  function solve() {
    if (solved) return;
    const { best, deadEnd } = pickCell();
    if (deadEnd) return;
    if (best === -1) { solved = Uint8Array.from(grid); return; }
    const mask = candidatesAt(grid, best, grid);
    for (let d = 1; d <= 9 && !solved; d++) {
      if (!(mask & (1 << (d - 1)))) continue;
      grid[best] = d;
      solve();
      grid[best] = 0;
    }
  }
  solve();
  return solved;
}

/** Full candidate map for the current grid: cand[i] is 0 for a filled cell, else a 9-bit mask. */
export function computeCandidates(grid) {
  const cand = new Array(N);
  for (let i = 0; i < N; i++) cand[i] = grid[i] ? 0 : candidatesAt(grid, i, grid);
  return cand;
}

/** The one naked-single cell the singles solver can prove right now, or -1. Used by the game's
 *  Hint when nothing is selected: it should point at a cell logic can actually justify, not an
 *  arbitrary blank. */
export function findNakedSingle(grid) {
  const cand = computeCandidates(grid);
  for (let i = 0; i < N; i++) if (grid[i] === 0 && popcount(cand[i]) === 1) return i;
  return -1;
}

/**
 * Grade a puzzle by the hardest HUMAN TECHNIQUE it needs to finish, in this order:
 *   1 naked single    2 hidden single    3 pointing pair / box-line reduction
 *   4 naked pair / hidden pair
 * Returns { solved, maxTechnique } - `solved` is false when the four techniques above stall
 * before every cell is filled, meaning the puzzle needs backtracking/guessing to finish at all.
 *
 * This is intentionally a fixed-order, single-pass-per-round solver, not an exhaustive one: it
 * is used only to CLASSIFY a puzzle, and the generator retries when the classification does not
 * match the tier it wants. A stronger solver would just move the "stalls" boundary, not change
 * what a player actually experiences.
 */
export function gradeGrid(puzzle) {
  const grid = Uint8Array.from(puzzle);
  let maxTechnique = 0;

  for (;;) {
    const cand = computeCandidates(grid);
    let progressed = false;

    // 1. naked singles
    for (let i = 0; i < N; i++) {
      if (grid[i] === 0 && popcount(cand[i]) === 1) {
        grid[i] = digitOfMask(cand[i]);
        maxTechnique = Math.max(maxTechnique, 1);
        progressed = true;
      }
    }
    if (progressed) continue;

    // 2. hidden singles
    for (const unit of UNITS) {
      const cellOf = new Array(10).fill(-1);
      const countOf = new Array(10).fill(0);
      for (const i of unit) {
        if (grid[i] !== 0) continue;
        for (let d = 1; d <= 9; d++) if (cand[i] & (1 << (d - 1))) { countOf[d]++; cellOf[d] = i; }
      }
      for (let d = 1; d <= 9; d++) {
        if (countOf[d] === 1 && grid[cellOf[d]] === 0) {
          grid[cellOf[d]] = d;
          maxTechnique = Math.max(maxTechnique, 2);
          progressed = true;
        }
      }
    }
    if (progressed) continue;

    // 3. pointing pair (box -> line) and box-line reduction (line -> box). Both eliminate
    // candidates rather than placing a digit, so track eliminations and re-check for a fresh
    // naked/hidden single before giving up on this round.
    let eliminated = false;
    for (const box of BOX_UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cells = box.filter((i) => grid[i] === 0 && (cand[i] & (1 << (d - 1))));
        if (cells.length < 2) continue;
        const rows = new Set(cells.map((i) => (i / SIZE) | 0));
        const cols = new Set(cells.map((i) => i % SIZE));
        if (rows.size === 1) {
          const line = ROW_UNITS[[...rows][0]];
          for (const i of line) if (!box.includes(i) && grid[i] === 0 && (cand[i] & (1 << (d - 1)))) { cand[i] &= ~(1 << (d - 1)); eliminated = true; }
        }
        if (cols.size === 1) {
          const line = COL_UNITS[[...cols][0]];
          for (const i of line) if (!box.includes(i) && grid[i] === 0 && (cand[i] & (1 << (d - 1)))) { cand[i] &= ~(1 << (d - 1)); eliminated = true; }
        }
      }
    }
    for (const line of [...ROW_UNITS, ...COL_UNITS]) {
      for (let d = 1; d <= 9; d++) {
        const cells = line.filter((i) => grid[i] === 0 && (cand[i] & (1 << (d - 1))));
        if (cells.length < 2) continue;
        const boxes = new Set(cells.map((i) => boxOf(i)));
        if (boxes.size === 1) {
          const box = BOX_UNITS[[...boxes][0]];
          for (const i of box) if (!line.includes(i) && grid[i] === 0 && (cand[i] & (1 << (d - 1)))) { cand[i] &= ~(1 << (d - 1)); eliminated = true; }
        }
      }
    }
    if (eliminated) {
      maxTechnique = Math.max(maxTechnique, 3);
      for (let i = 0; i < N; i++) {
        if (grid[i] === 0 && popcount(cand[i]) === 1) { grid[i] = digitOfMask(cand[i]); progressed = true; }
      }
      if (progressed) continue;
    }

    // 4. naked pair / hidden pair, within each unit.
    let pairElim = false;
    for (const unit of UNITS) {
      const empties = unit.filter((i) => grid[i] === 0);
      for (let a = 0; a < empties.length; a++) {
        for (let b = a + 1; b < empties.length; b++) {
          const ia = empties[a], ib = empties[b];
          if (popcount(cand[ia]) === 2 && cand[ia] === cand[ib]) {
            for (const i of empties) {
              if (i === ia || i === ib) continue;
              if (cand[i] & cand[ia]) { cand[i] &= ~cand[ia]; pairElim = true; }
            }
          }
        }
      }
      const cellsForDigit = {};
      for (let d = 1; d <= 9; d++) cellsForDigit[d] = empties.filter((i) => cand[i] & (1 << (d - 1)));
      for (let d1 = 1; d1 <= 9; d1++) {
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const c1 = cellsForDigit[d1], c2 = cellsForDigit[d2];
          if (c1.length === 2 && c2.length === 2 && c1[0] === c2[0] && c1[1] === c2[1]) {
            const mask = (1 << (d1 - 1)) | (1 << (d2 - 1));
            for (const i of c1) if (cand[i] & ~mask & 511) { cand[i] &= mask; pairElim = true; }
          }
        }
      }
    }
    if (pairElim) {
      maxTechnique = Math.max(maxTechnique, 4);
      for (let i = 0; i < N; i++) {
        if (grid[i] === 0 && popcount(cand[i]) === 1) { grid[i] = digitOfMask(cand[i]); progressed = true; }
      }
      if (progressed) continue;
    }

    break; // no technique made progress this round
  }

  const solved = grid.every((v) => v !== 0);
  return { solved, maxTechnique };
}

export default { UNITS, ROW_UNITS, COL_UNITS, BOX_UNITS, UNITS_OF, PEERS, popcount, digitOfMask, countSolutions, backtrackSolve, computeCandidates, findNakedSingle, gradeGrid };
