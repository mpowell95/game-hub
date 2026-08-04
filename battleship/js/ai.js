// ai.js - three Battleship AI tiers. Pure, no DOM.
//
// NO-CHEAT SEAM, MADE STRUCTURAL (root CLAUDE.md / HANDOFF-BATTLESHIP.md section 6): every
// function here reads only the PUBLIC shots grid it is shooting at, the lengths of ships still
// afloat (derived from that grid's sunkIds, never from a fleet), and the board size. There is no
// fleet parameter anywhere in this file's signatures - not a promise, a fact you can grep for.
// `chooseShot` is called with a `state` object in test.js whose `fleets` array is `[null, null]`
// and still returns a legal shot, because the function body never once reads `.fleets`.
//
// Cost check (root CLAUDE.md): a 10x10 board with 5 ships still afloat is a few thousand
// placement tests per shot, sub-millisecond. No worker, no time budget, no iterative deepening -
// unlike Tic Tac Toe's Ultimate Pro tier, which needs all of that. Do not add machinery here.

import { CELL_UNKNOWN, CELL_MISS, CELL_HIT, CELL_SUNK, cellAt, shipsAfloat } from './game.js';
import { legalPlacements } from './fleet.js';

function untriedCells(shots) {
  const out = [];
  for (let r = 0; r < shots.size; r++) {
    for (let c = 0; c < shots.size; c++) if (cellAt(shots, r, c) === CELL_UNKNOWN) out.push([r, c]);
  }
  return out;
}

function activeHitCells(shots) {
  const out = [];
  for (let r = 0; r < shots.size; r++) {
    for (let c = 0; c < shots.size; c++) if (cellAt(shots, r, c) === CELL_HIT) out.push([r, c]);
  }
  return out;
}

function inBoundsRC(size, r, c) { return r >= 0 && c >= 0 && r < size && c < size; }

function orthoNeighbors(size, r, c) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([nr, nc]) => inBoundsRC(size, nr, nc));
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// --- Easy (beginner): uniform random, with a light habit of following up on a hit ---------------

function chooseBeginner(shots, rng) {
  const untried = untriedCells(shots);
  if (!untried.length) return null;
  const hits = activeHitCells(shots);
  if (hits.length && rng() < 0.5) {
    const [hr, hc] = pick(rng, hits);
    const candidates = orthoNeighbors(shots.size, hr, hc).filter(([r, c]) => cellAt(shots, r, c) === CELL_UNKNOWN);
    if (candidates.length) return pick(rng, candidates);
  }
  return pick(rng, untried);
}

// --- Medium (intermediate): hunt/target with line extension -------------------------------------

/** Two active hits sharing a row or column, however far apart, imply the ship's axis; extend
 *  outward from whichever end still has an untried cell before giving up on the line. */
function lineExtension(shots, hits) {
  const size = shots.size;
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const [r1, c1] = hits[i], [r2, c2] = hits[j];
      const sameRow = r1 === r2, sameCol = c1 === c2;
      if (!sameRow && !sameCol) continue;
      const cellsOnLine = hits.filter(([r, c]) => (sameRow && r === r1) || (sameCol && c === c1));
      if (sameRow) {
        const cols = cellsOnLine.map(([, c]) => c);
        const lo = Math.min(...cols), hi = Math.max(...cols);
        for (const c of [lo - 1, hi + 1]) {
          if (inBoundsRC(size, r1, c) && cellAt(shots, r1, c) === CELL_UNKNOWN) return [r1, c];
        }
      } else {
        const rows = cellsOnLine.map(([r]) => r);
        const lo = Math.min(...rows), hi = Math.max(...rows);
        for (const r of [lo - 1, hi + 1]) {
          if (inBoundsRC(size, r, c1) === false) continue;
          if (cellAt(shots, r, c1) === CELL_UNKNOWN) return [r, c1];
        }
      }
    }
  }
  return null;
}

function chooseIntermediate(shots, rng) {
  const untried = untriedCells(shots);
  if (!untried.length) return null;
  const hits = activeHitCells(shots);
  if (hits.length) {
    const ext = lineExtension(shots, hits);
    if (ext) return ext;
    // No established line yet (a single hit, or a line whose extensions are both exhausted):
    // fall back to any untried orthogonal neighbour of any active hit.
    const neighbors = [];
    for (const [r, c] of hits) {
      for (const [nr, nc] of orthoNeighbors(shots.size, r, c)) {
        if (cellAt(shots, nr, nc) === CELL_UNKNOWN) neighbors.push([nr, nc]);
      }
    }
    if (neighbors.length) return pick(rng, neighbors);
  }
  return pick(rng, untried);
}

// --- Pro: probability-density search -------------------------------------------------------------

/** Blocked for placement purposes: a MISS or a fully-resolved SUNK cell can never hold a still-
 *  live ship segment. An untried or already-hit (unresolved) cell can. */
function placementBlocked(shots) {
  return (r, c) => {
    const v = cellAt(shots, r, c);
    return v === CELL_MISS || v === CELL_SUNK;
  };
}

/** Every legal placement, across every ship length still afloat, that could explain the board as
 *  currently known. In target mode (`hits` non-empty) restricted to placements covering at least
 *  one active hit - the standard trick that turns "hunt" and "target" into one uniform rule. */
function candidatePlacements(shots, lengths, hits) {
  const isBlocked = placementBlocked(shots);
  const all = [];
  for (const len of lengths) {
    for (const p of legalPlacements(shots.size, len, isBlocked)) {
      const cells = [];
      for (let i = 0; i < len; i++) cells.push(p.dir === 'v' ? [p.r + i, p.c] : [p.r, p.c + i]);
      all.push(cells);
    }
  }
  if (!hits.length) return all;
  const hitSet = new Set(hits.map(([r, c]) => `${r},${c}`));
  const targeted = all.filter((cells) => cells.some(([r, c]) => hitSet.has(`${r},${c}`)));
  return targeted.length ? targeted : all;
}

function densityMap(shots, placements) {
  const density = new Map();
  for (const cells of placements) {
    for (const [r, c] of cells) {
      if (cellAt(shots, r, c) !== CELL_UNKNOWN) continue;
      const key = `${r},${c}`;
      density.set(key, (density.get(key) || 0) + 1);
    }
  }
  return density;
}

function choosePro(shots, lengths, rng) {
  const untried = untriedCells(shots);
  if (!untried.length) return null;
  const hits = activeHitCells(shots);
  const placements = candidatePlacements(shots, lengths, hits);
  const density = densityMap(shots, placements);

  // Parity pruning for the shortest remaining ship, PURE-HUNT MODE ONLY (no active hits): any
  // ship of length >= 2 must occupy at least one cell of each checkerboard color, so restricting
  // the hunt to one color still guarantees eventual contact while roughly halving the search.
  let pool = untried;
  if (!hits.length && lengths.length) {
    const minLen = Math.min(...lengths);
    if (minLen >= 2) {
      const parity = untried.filter(([r, c]) => (r + c) % 2 === 0);
      if (parity.length) pool = parity;
    }
  }

  let best = null, bestScore = -1, ties = [];
  for (const [r, c] of pool) {
    const score = density.get(`${r},${c}`) || 0;
    if (score > bestScore) { bestScore = score; ties = [[r, c]]; }
    else if (score === bestScore) ties.push([r, c]);
  }
  best = ties.length ? pick(rng, ties) : pick(rng, pool.length ? pool : untried);
  return best;
}

/** The one entry point ui.js/test.js call. `state` may be a full engine state (whose `fleets` is
 *  never read here) or any object shaped `{ size }`; `targetSeat` is the seat being shot AT (its
 *  `state.shots[targetSeat]` is the only per-shot data read); `shipSet` is the full ship catalog
 *  for the board size in play (fleet.js's SHIP_SETS entry) - lengths still afloat are derived from
 *  it and `state.shots[targetSeat].sunkIds`, never from a fleet. Returns `[r, c]` or `null` if
 *  every cell has already been fired at (should not happen before `state.over`). */
export function chooseShot(state, targetSeat, shipSet, difficulty, rng = Math.random) {
  const shots = state.shots[targetSeat];
  const lengths = shipsAfloat(shipSet, shots);
  if (difficulty === 'pro') return choosePro(shots, lengths, rng);
  if (difficulty === 'intermediate') return chooseIntermediate(shots, rng);
  return chooseBeginner(shots, rng);
}

export default { chooseShot };
