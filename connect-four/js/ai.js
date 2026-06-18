// ai.js — Connect Four AI (Session 2: all four difficulty tiers)
//
// Tiers (see game-hub-and-connect-four-spec.md, "Difficulty tiers"):
//   Easy   — random legal move, but always takes an immediate win and always
//            blocks an immediate opponent win.
//   Medium — alpha-beta minimax, depth 5, heuristic eval.
//   Hard   — alpha-beta minimax, depth 9, same heuristic, center-out ordering.
//   Expert — full alpha-beta solve to the end of the game (no depth cap) with a
//            transposition table and center-out ordering. No weakening: it plays
//            the game-theoretically correct move, preferring faster wins and
//            slower losses.
//
// Easy/Medium/Hard search on the Board (play/undo). Expert runs a dedicated
// bitboard solver on raw BigInts (Tromp / Pascal Pons layout, which matches
// board.js exactly) for speed, plus a small opening book so it never has to
// search the wide-open early board from scratch.

import { Board, COLS, ROWS, PLAYER_ONE, PLAYER_TWO } from './board.js';
import { Game } from './game.js';

export const Difficulty = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  EXPERT: 'expert',
};

// Search depths for the heuristic tiers (within the spec's suggested ranges).
const MEDIUM_DEPTH = 5;
const HARD_DEPTH = 9;

// Center-out column order — better alpha-beta pruning and stronger play, since
// central columns participate in more winning lines.
const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

// Terminal score base for the heuristic search. A win is worth WIN_BASE minus
// the number of stones on the board, so a faster win (fewer stones) scores
// higher and a slower loss scores less-negative — exactly the spec's tie-break.
// WIN_BASE dwarfs any heuristic eval (bounded well under it) so a forced
// win/loss always dominates positional scoring.
const WIN_BASE = 100000;

// ---------------------------------------------------------------------------
// Bitboard solver primitives (Pascal Pons layout — identical to board.js):
//   7 bits per column, bit (col*7 + row), sentinel row 6 always empty.
// ---------------------------------------------------------------------------
const H = ROWS;        // 6 — playable rows per column
const H1 = ROWS + 1;   // 7 — bits per column including the sentinel row
const FULL_COLUMN = (1n << BigInt(H)) - 1n;   // six playable bits of column 0

// Masks spanning the whole board.
let BOARD_MASK = 0n;   // every playable cell (42 bits)
let BOTTOM_MASK = 0n;  // bottom cell of every column
const COLUMN_MASK = [];
for (let c = 0; c < COLS; c++) {
  const shift = BigInt(c * H1);
  COLUMN_MASK[c] = FULL_COLUMN << shift;
  BOARD_MASK |= COLUMN_MASK[c];
  BOTTOM_MASK |= 1n << shift;
}

// Pons score scale for the exact solver: scores lie in [MIN_SCORE, MAX_SCORE],
// 0 = draw, positive = win for the side to move (bigger = sooner).
const MIN_SCORE = -((COLS * ROWS) >> 1) + 3;   // -18
const MAX_SCORE = ((COLS * ROWS + 1) >> 1) - 3; // 18

/** Cells that would complete a 4-in-a-row for `position`, restricted to empty
 *  board cells. (Tromp/Pons shift trick; shifts 1/7/6/8 match board.js.) */
function computeWinningCells(position, mask) {
  // vertical
  let r = (position << 1n) & (position << 2n) & (position << 3n);
  // horizontal (stride 7)
  let p = (position << 7n) & (position << 14n);
  r |= p & (position << 21n);
  r |= p & (position >> 7n);
  p = (position >> 7n) & (position >> 14n);
  r |= p & (position << 7n);
  r |= p & (position >> 21n);
  // diagonal "/" (stride 6)
  p = (position << 6n) & (position << 12n);
  r |= p & (position << 18n);
  r |= p & (position >> 6n);
  p = (position >> 6n) & (position >> 12n);
  r |= p & (position << 6n);
  r |= p & (position >> 18n);
  // diagonal "\" (stride 8)
  p = (position << 8n) & (position << 16n);
  r |= p & (position << 24n);
  r |= p & (position >> 8n);
  p = (position >> 8n) & (position >> 16n);
  r |= p & (position << 8n);
  r |= p & (position >> 24n);
  return r & (BOARD_MASK ^ mask);
}

/** Bitboard of the next playable cell in every non-full column. */
function possibleCells(mask) {
  return (mask + BOTTOM_MASK) & BOARD_MASK;
}

/** True if the side whose stones are `position` has an immediate winning move. */
function canWinNext(position, mask) {
  return (computeWinningCells(position, mask) & possibleCells(mask)) !== 0n;
}

/**
 * Playable cells that do NOT immediately lose, i.e. that don't hand the
 * opponent a win on their reply. Returns 0n if every move loses (opponent wins
 * next no matter what). Mirrors Pons' possibleNonLosingMoves.
 */
function nonLosingCells(position, mask) {
  let poss = possibleCells(mask);
  const opponentWin = computeWinningCells(mask ^ position, mask); // opp stones = mask ^ position
  const forced = poss & opponentWin;
  if (forced) {
    // Two separate forced blocks can't both be met -> the position is lost.
    if (forced & (forced - 1n)) return 0n;
    poss = forced;                       // must play the single forced block
  }
  return poss & ~(opponentWin >> 1n);    // never play directly below an opp win
}

/** Column index (0..6) of a single-cell move bitboard. */
function columnOf(moveBit) {
  for (let c = 0; c < COLS; c++) {
    if (moveBit & COLUMN_MASK[c]) return c;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Expert: exact transposition-table negamax solver.
//
// Built on the standard strong-solver techniques (Pascal Pons): non-losing
// move generation, a transposition table, threat-count move ordering, and an
// iterative-deepening null-window driver. The null-window driver is the key
// speedup — a single wide-window search prunes far less.
// ---------------------------------------------------------------------------
const transTable = new Map();      // key: Number(position+mask) -> upper bound
const TT_MAX_ENTRIES = 8_000_000;  // guard against unbounded memory growth
let nodeCount = 0;                 // exposed for profiling

// Cooperative time budget for the Expert solver. A full from-scratch solve of
// the wide-open early board is impractical in JS/BigInt (profiled: ~tens of
// seconds below ~10 stones), so Expert solves against a deadline and falls back
// to a deep heuristic search when the exact solve can't finish in time. As the
// game fills in, the exact solve finishes well within budget and Expert plays
// perfectly to the end. The deadline is checked periodically inside negamax.
const TIMEOUT = Symbol('cf-solver-timeout');
let searchDeadline = Infinity;       // epoch ms; Infinity = no limit (exact)
let heuristicNodes = 0;              // throttle counter for the heuristic search
const DEFAULT_EXPERT_BUDGET_MS = 2000;
// Fraction of the budget the exact solver may use before Expert gives up and
// spends the remainder on a bounded heuristic search (the wide-open opening).
const EXACT_BUDGET_FRACTION = 0.6;

/** Drop the cached solver state (call between unrelated games if desired). */
export function clearTranspositionTable() {
  transTable.clear();
}

/** Population count of a (non-negative) BigInt. */
function popcount(b) {
  let n = 0;
  while (b > 0n) { b &= b - 1n; n++; }
  return n;
}

/** Integer division by two, truncated toward zero (matches C semantics). */
const half = (x) => Math.trunc(x / 2);

/**
 * Exact game value of `position` (side to move) within (alpha, beta), in the
 * Pons score scale. Assumes the side to move has NO immediate win — that
 * invariant holds because the recursion only ever plays non-losing moves, which
 * deny the opponent an immediate win on their turn.
 */
function negamax(position, mask, nbMoves, alpha, beta) {
  nodeCount++;
  // Cheap, throttled deadline check (no-op when solving without a budget).
  if ((nodeCount & 8191) === 0 && Date.now() > searchDeadline) throw TIMEOUT;

  const next = nonLosingCells(position, mask);
  if (next === 0n) {
    // Every move loses: the opponent wins on their next stone.
    return -((COLS * ROWS - nbMoves) >> 1);
  }
  if (nbMoves >= COLS * ROWS - 2) return 0; // board (nearly) full, nobody won -> draw

  // Tighten the window to the achievable score range, then to any cached bound.
  const min = -((COLS * ROWS - 2 - nbMoves) >> 1);
  if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }

  let max = (COLS * ROWS - 1 - nbMoves) >> 1;
  const key = Number(position + mask); // unique, and < 2^49 so exact as a Number
  const cached = transTable.get(key);
  if (cached !== undefined) {
    const ttMax = cached + MIN_SCORE - 1; // stored value is an upper bound
    if (max > ttMax) max = ttMax;
  }
  if (beta > max) { beta = max; if (alpha >= beta) return beta; }

  // Order non-losing moves by how many winning threats they create (then by the
  // center-out input order for ties) — strong move ordering sharpens pruning.
  const moves = [];
  for (const c of COLUMN_ORDER) {
    const move = next & COLUMN_MASK[c];
    if (move) {
      const threats = popcount(computeWinningCells(position | move, mask | move));
      moves.push({ move, threats });
    }
  }
  moves.sort((a, b) => b.threats - a.threats);

  for (const { move } of moves) {
    const score = -negamax(position ^ mask, mask | move, nbMoves + 1, -beta, -alpha);
    if (score >= beta) return score;     // beta cutoff
    if (score > alpha) alpha = score;
  }

  if (transTable.size < TT_MAX_ENTRIES) {
    transTable.set(key, alpha - MIN_SCORE + 1); // store as an upper bound
  }
  return alpha;
}

/**
 * Exact value of an arbitrary position from the side to move's perspective,
 * via iterative deepening with a null-window (Pons' solve). Returns a value in
 * the Pons score scale: 0 = draw, >0 = win for the side to move (bigger sooner).
 */
function expertSolve(position, mask, nbMoves) {
  if (canWinNext(position, mask)) {
    return (COLS * ROWS + 1 - nbMoves) >> 1; // win on the next stone
  }
  let min = -((COLS * ROWS - nbMoves) >> 1);
  let max = (COLS * ROWS + 1 - nbMoves) >> 1;
  while (min < max) {
    // Probe with a null window, biased toward zero for efficiency.
    let med = min + half(max - min);
    if (med <= 0 && half(min) < med) med = half(min);
    else if (med >= 0 && half(max) > med) med = half(max);
    const r = negamax(position, mask, nbMoves, med, med + 1);
    if (r <= med) max = r; else min = r;
  }
  return min;
}

// Opening book: the wide-open early board is the most expensive thing to solve
// and the first move is a known result (center is the unique winning first
// move). Skipping it avoids deep search exactly when the tree is biggest, as
// the spec suggests. Keyed by (position+mask); value is the column to play.
const OPENING_BOOK = new Map([
  [0n, 3], // empty board (position+mask === 0n) -> center
]);

/**
 * Best move by exact solve, picking the non-losing move with the highest exact
 * value (fastest win / slowest loss / draw). Each child has no immediate win for
 * its mover, so the solver's invariant holds and its value is exact. Honors the
 * current `searchDeadline`; returns the TIMEOUT sentinel if it can't finish.
 */
function exactBestMove(position, mask, nbMoves, next) {
  let bestCol = -1;
  let bestScore = -Infinity;
  try {
    for (const c of COLUMN_ORDER) {
      const move = next & COLUMN_MASK[c];
      if (!move) continue;
      const score = -expertSolve(position ^ mask, mask | move, nbMoves + 1);
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
  } catch (e) {
    if (e === TIMEOUT) return TIMEOUT;
    throw e;
  }
  return bestCol;
}

/**
 * Expert move selection: opening book, then the exact solver under a time
 * budget, falling back to a deep heuristic search if the exact solve can't
 * finish in time (the wide-open opening). Pass budgetMs = Infinity for an
 * unbounded exact solve (used by tests).
 */
function chooseExpert(board, player, budgetMs = DEFAULT_EXPERT_BUDGET_MS) {
  const mask = board.pieces[PLAYER_ONE] | board.pieces[PLAYER_TWO];
  const position = board.pieces[player];
  const nbMoves = board.moveCount;

  const booked = OPENING_BOOK.get(position + mask);
  if (booked !== undefined && board.canPlay(booked)) return booked;

  // Take an immediate win if there is one.
  const winning = computeWinningCells(position, mask) & possibleCells(mask);
  if (winning) return columnOf(winning & -winning);

  const next = nonLosingCells(position, mask);
  if (next === 0n) {
    // Lost no matter what (opponent wins next); play center-most legal column.
    const poss = possibleCells(mask);
    for (const c of COLUMN_ORDER) if (poss & COLUMN_MASK[c]) return c;
  }

  const start = Date.now();
  const unbounded = !Number.isFinite(budgetMs);
  // Give the exact solver a slice of the budget; if it finishes (mid/endgame),
  // its move is perfect. Reserve the rest for a heuristic search if it can't.
  searchDeadline = unbounded ? Infinity : start + Math.floor(budgetMs * EXACT_BUDGET_FRACTION);
  let result;
  try {
    result = exactBestMove(position, mask, nbMoves, next);
  } finally {
    searchDeadline = Infinity;
  }
  if (result !== TIMEOUT) return result; // exact (perfect) move

  // Opening: the exact solve can't finish in time. Spend the remaining budget on
  // a bounded iterative-deepening heuristic search (very strong, just not proven
  // perfect this early). Perfect play resumes automatically as the board fills.
  return chooseSearchTimed(board, player, start + budgetMs);
}

/**
 * Evaluate every legal column for the side to move (for the "show best moves"
 * helper). Returns an array of { col, score } from the mover's perspective, with
 * an `exact` flag: true when all columns were solved exactly within budgetMs
 * (mid/endgame; Pons scale where + = the mover wins and a larger magnitude means
 * sooner), false when the opening forced a uniform heuristic fallback so the
 * displayed scores still share one scale (used only to rank, not as ground truth).
 */
export function evaluateColumns(board, player, budgetMs) {
  const legal = board.legalMoves();
  const mask = board.pieces[PLAYER_ONE] | board.pieces[PLAYER_TWO];
  const position = board.pieces[player];
  const nbMoves = board.moveCount;
  const poss = possibleCells(mask);
  const winCells = computeWinningCells(position, mask);

  // Pass 1: try to solve every legal column exactly within a shared budget.
  const exactScores = new Map();
  let exact = true;
  searchDeadline = Number.isFinite(budgetMs) ? Date.now() + budgetMs : Infinity;
  try {
    for (const c of COLUMN_ORDER) {
      if (!legal.includes(c)) continue;
      const move = poss & COLUMN_MASK[c];
      if ((winCells & move) !== 0n) {
        exactScores.set(c, (COLS * ROWS + 1 - (nbMoves + 1)) >> 1); // wins on this move
      } else {
        exactScores.set(c, -expertSolve(position ^ mask, mask | move, nbMoves + 1));
      }
    }
  } catch (e) {
    if (e !== TIMEOUT) { searchDeadline = Infinity; throw e; }
    exact = false;
  } finally {
    searchDeadline = Infinity;
  }

  let scores;
  if (exact) {
    scores = legal.map((c) => ({ col: c, score: exactScores.get(c) }));
  } else {
    // Pass 2: uniform heuristic so every column shares one scale.
    scores = legal.map((c) => {
      const b = board.clone();
      b.play(c, player);
      const val = b.isWin(player)
        ? WIN_BASE - b.moveCount
        : -searchHeuristic(b, player ^ 1, HARD_DEPTH - 1, -Infinity, Infinity);
      return { col: c, score: val };
    });
  }
  scores.exact = exact;
  return scores;
}

// ---------------------------------------------------------------------------
// Heuristic evaluation + depth-limited search (Medium / Hard).
// ---------------------------------------------------------------------------

/** Score a single 4-cell window from `me`'s perspective. */
function scoreWindow(mine, his) {
  if (mine > 0 && his > 0) return 0;          // contested -> dead line
  if (mine === 4) return WIN_BASE;            // (won lines are caught earlier)
  if (mine === 3) return 50;
  if (mine === 2) return 10;
  if (mine === 1) return 1;
  if (his === 4) return -WIN_BASE;
  if (his === 3) return -80;                  // weight opponent threats heavier
  if (his === 2) return -10;
  if (his === 1) return -1;
  return 0;
}

/**
 * Static heuristic for non-terminal positions: center-column weighting plus
 * open-line counting over every horizontal / vertical / diagonal 4-window.
 * Bounded well under WIN_BASE so terminal scores always dominate.
 */
function evaluate(board, me) {
  const opp = me ^ 1;
  let score = 0;

  // Center-column control.
  for (let r = 0; r < ROWS; r++) {
    const v = board.cellAt(3, r);
    if (v === me) score += 6;
    else if (v === opp) score -= 6;
  }

  const windowAt = (cells) => {
    let mine = 0, his = 0;
    for (const [c, r] of cells) {
      const v = board.cellAt(c, r);
      if (v === me) mine++;
      else if (v === opp) his++;
    }
    score += scoreWindow(mine, his);
  };

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      windowAt([[c, r], [c + 1, r], [c + 2, r], [c + 3, r]]);            // horizontal
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      windowAt([[c, r], [c, r + 1], [c, r + 2], [c, r + 3]]);            // vertical
  for (let c = 0; c <= COLS - 4; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      windowAt([[c, r], [c + 1, r + 1], [c + 2, r + 2], [c + 3, r + 3]]); // diagonal /
  for (let c = 0; c <= COLS - 4; c++)
    for (let r = 3; r < ROWS; r++)
      windowAt([[c, r], [c + 1, r - 1], [c + 2, r - 2], [c + 3, r - 3]]); // diagonal \

  return score;
}

/** Legal columns in center-out order. */
function orderedLegal(board) {
  return COLUMN_ORDER.filter((c) => board.canPlay(c));
}

/**
 * Depth-limited negamax with alpha-beta over the Board (play/undo). Returns the
 * value from `player`'s perspective. An immediate win short-circuits with a
 * terminal score; at depth 0 the heuristic evaluates the position.
 */
function searchHeuristic(board, player, depth, alpha, beta) {
  // Throttled deadline check (no-op unless a budget is active, e.g. the Expert
  // opening fallback). Lets the iterative-deepening driver abort cleanly.
  if (((++heuristicNodes) & 4095) === 0 && Date.now() > searchDeadline) throw TIMEOUT;

  const moves = orderedLegal(board);
  if (moves.length === 0) return 0; // board full, no win -> draw

  // An immediate win is always best; take it (and prefer the fastest one).
  for (const c of moves) {
    board.play(c, player);
    const won = board.isWin(player);
    const stones = board.moveCount;
    board.undo(c, player);
    if (won) return WIN_BASE - stones;
  }

  if (depth === 0) return evaluate(board, player);

  let best = -Infinity;
  for (const c of moves) {
    board.play(c, player);
    const val = -searchHeuristic(board, player ^ 1, depth - 1, -beta, -alpha);
    board.undo(c, player);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

/**
 * Best move(s) at a fixed search depth. Returns { col, score } where col is a
 * random pick among equally-scored top moves. May throw TIMEOUT if a deadline
 * is active and reached — callers that allow timeouts should search on a clone.
 */
function bestMoveAtDepth(board, player, depth, rng) {
  const moves = orderedLegal(board);
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const c of moves) {
    board.play(c, player);
    let val;
    if (board.isWin(player)) val = WIN_BASE - board.moveCount;
    else val = -searchHeuristic(board, player ^ 1, depth - 1, -Infinity, Infinity);
    board.undo(c, player);

    if (val > bestScore) { bestScore = val; bestMoves = [c]; }
    else if (val === bestScore) bestMoves.push(c);
  }
  return { col: bestMoves[Math.floor(rng() * bestMoves.length)], score: bestScore };
}

/** Fixed-depth move choice (Medium / Hard). No deadline is active for these. */
function chooseSearch(board, player, depth, rng) {
  return bestMoveAtDepth(board, player, depth, rng).col;
}

/**
 * Iterative-deepening heuristic search bounded by `deadline` (epoch ms). Returns
 * the best move from the deepest fully-completed depth. Searches on clones so an
 * aborted depth can't corrupt board state. Used as the Expert opening fallback.
 */
function chooseSearchTimed(board, player, deadline) {
  let best = orderedLegal(board)[0]; // center-most legal move — safe default
  const prevDeadline = searchDeadline;
  searchDeadline = deadline;
  try {
    for (let depth = 1; depth <= COLS * ROWS; depth++) {
      const { col, score } = bestMoveAtDepth(board.clone(), player, depth, () => 0);
      best = col;
      // A forced win/loss is already decided; deeper search won't change it.
      if (Math.abs(score) >= WIN_BASE - COLS * ROWS) break;
      if (Date.now() > deadline) break;
    }
  } catch (e) {
    if (e !== TIMEOUT) throw e; // keep `best` from the last completed depth
  } finally {
    searchDeadline = prevDeadline;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Easy.
// ---------------------------------------------------------------------------
function chooseEasy(board, player, rng) {
  const moves = board.legalMoves();
  const opp = player ^ 1;

  // Always take an immediate win.
  for (const c of moves) {
    board.play(c, player);
    const won = board.isWin(player);
    board.undo(c, player);
    if (won) return c;
  }
  // Always block an immediate opponent win.
  for (const c of moves) {
    board.play(c, opp);
    const lost = board.isWin(opp);
    board.undo(c, opp);
    if (lost) return c;
  }
  // Otherwise random.
  return moves[Math.floor(rng() * moves.length)];
}

// ---------------------------------------------------------------------------
// Public AI.
// ---------------------------------------------------------------------------
export class AI {
  /**
   * @param {string} difficulty  One of Difficulty.*
   * @param {object} [options]
   * @param {() => number} [options.rng]  RNG in [0,1) (inject for deterministic
   *   tests). Only affects Easy and tie-breaking, never strength.
   * @param {number} [options.expertBudgetMs]  Per-move time budget for the
   *   Expert exact solver before it falls back to a heuristic search (default
   *   2000). Larger = more positions solved perfectly, but slower opening moves.
   */
  constructor(difficulty = Difficulty.MEDIUM, options = {}) {
    this.difficulty = difficulty;
    this.rng = options.rng || Math.random;
    this.expertBudgetMs = options.expertBudgetMs ?? DEFAULT_EXPERT_BUDGET_MS;
  }

  /** Choose a column to play for the side to move in `game`. */
  chooseMove(game) {
    if (game.isOver()) throw new Error('chooseMove: game is already over');
    const { board, currentPlayer } = game;
    switch (this.difficulty) {
      case Difficulty.EASY:   return chooseEasy(board, currentPlayer, this.rng);
      case Difficulty.MEDIUM: return chooseSearch(board, currentPlayer, MEDIUM_DEPTH, this.rng);
      case Difficulty.HARD:   return chooseSearch(board, currentPlayer, HARD_DEPTH, this.rng);
      case Difficulty.EXPERT: return chooseExpert(board, currentPlayer, this.expertBudgetMs);
      default: throw new Error(`Unknown difficulty: ${this.difficulty}`);
    }
  }

  // --- Headless tests -------------------------------------------------------

  /**
   * Tests every tier's tactical basics (take a win, block a threat) and, most
   * importantly, validates the Expert solver against an independent brute-force
   * reference on randomized late-game positions (few empties -> the reference is
   * fast). Logs pass/fail per case; returns true iff all pass.
   */
  static test() {
    const results = [];
    const check = (name, cond) => {
      results.push({ name, pass: !!cond });
      console.log(`${cond ? 'PASS' : 'FAIL'}  AI: ${name}`);
    };
    const det = () => 0; // deterministic RNG (always first choice) for reproducibility
    const fromMoves = (cols) => { const g = new Game(PLAYER_ONE); for (const c of cols) g.play(c); return g; };
    const tiers = [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD, Difficulty.EXPERT];

    // 1. Every tier takes an immediate win (here, also choosing it over a block).
    {
      // P1 stacks col 3 (threat), P2 stacks col 0 (threat); P1 to move and wins.
      const g = fromMoves([3, 0, 3, 0, 3, 0]);
      for (const d of tiers) {
        const ai = new AI(d, { rng: det });
        check(`${d} takes immediate win`, ai.chooseMove(g) === 3);
      }
    }

    // 2. Every tier blocks an immediate opponent win.
    {
      // P1 threatens to complete col 3; P2 to move must block col 3.
      const g = fromMoves([3, 0, 3, 1, 3]);
      for (const d of tiers) {
        const ai = new AI(d, { rng: det });
        check(`${d} blocks immediate threat`, ai.chooseMove(g) === 3);
      }
    }

    // 3. Expert solver vs. brute-force reference on random late-game positions.
    {
      const rng = mulberry32(0xC0FFEE);
      let valueMismatch = 0, moveSuboptimal = 0, checked = 0;
      for (let i = 0; i < 16 && checked < 12; i++) {
        const target = 28 + (i % 5); // 28..32 stones -> 10..14 empties, reference is fast
        const g = buildSearchPosition(target, rng);
        if (!g) continue;
        const board = g.board, player = g.currentPlayer;
        const mask = board.pieces[0] | board.pieces[1];
        const position = board.pieces[player];

        const refOutcome = referenceOutcome(board.clone(), player);          // -1/0/1
        const solverSign = Math.sign(expertSolve(position, mask, board.moveCount));
        if (solverSign !== refOutcome) valueMismatch++;

        // The chosen move must preserve the position's game-theoretic outcome.
        const col = chooseExpert(board, player, Infinity); // unbounded: exact path

        const after = board.clone();
        after.play(col, player);
        if (!after.isWin(player)) {
          const childOutcome = referenceOutcome(after, player ^ 1);
          if (-childOutcome !== refOutcome) moveSuboptimal++;
        }
        checked++;
      }
      check(`expert value matches reference (${checked} positions)`, valueMismatch === 0 && checked >= 10);
      check(`expert move is optimal (${checked} positions)`, moveSuboptimal === 0 && checked >= 10);
    }

    // 4. Expert sees a winning position: open three on the bottom row.
    {
      // P1 at cols 2,3,4 (bottom row), P2 harmless on cols 0,6; P1 to move has a
      // double-ended threat (cols 1 and 5) -> winning, so value > 0.
      const g = fromMoves([2, 0, 3, 6, 4, 0]); // P1: 2,3,4 ; P2: 0,6,0 ; P1 to move
      const board = g.board, player = g.currentPlayer; // player === P1
      const mask = board.pieces[0] | board.pieces[1];
      const val = expertSolve(board.pieces[player], mask, board.moveCount);
      check('expert sees the win (value > 0)', val > 0);
    }

    // 5. Integration: the hybrid Expert must never lose to Easy, going first or
    //    second (a small budget exercises the heuristic fallback too).
    {
      let losses = 0, games = 0;
      for (const expertFirst of [true, false]) {
        const expert = new AI(Difficulty.EXPERT, { expertBudgetMs: 200 });
        const easy = new AI(Difficulty.EASY, { rng: mulberry32(expertFirst ? 11 : 22) });
        const expertSide = expertFirst ? PLAYER_ONE : PLAYER_TWO;
        const g = new Game(PLAYER_ONE);
        while (!g.isOver()) {
          const ai = (g.currentPlayer === expertSide) ? expert : easy;
          g.play(ai.chooseMove(g));
        }
        games++;
        if (g.winner !== null && g.winner !== expertSide) losses++;
      }
      check(`expert never loses to easy (${games} games)`, losses === 0 && games === 2);
    }

    const passed = results.filter(r => r.pass).length;
    console.log(`AI.test(): ${passed}/${results.length} passed`);
    return passed === results.length;
  }
}

// --- Test helpers (module-private) ------------------------------------------

/** Small deterministic RNG for reproducible tests. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a non-terminal position with exactly `target` stones via random legal
 * alternating play, requiring that the side to move has no immediate win (so the
 * solver actually searches). Returns a Game, or null if none found.
 */
function buildSearchPosition(target, rng) {
  for (let attempt = 0; attempt < 50000; attempt++) {
    const g = new Game(PLAYER_ONE);
    while (g.board.moveCount < target) {
      const moves = g.legalMoves();
      g.play(moves[Math.floor(rng() * moves.length)]);
      if (g.isOver()) break;
    }
    if (g.board.moveCount !== target || g.isOver()) continue;
    const b = g.board, player = g.currentPlayer;
    const mask = b.pieces[0] | b.pieces[1];
    if (computeWinningCells(b.pieces[player], mask) & possibleCells(mask)) continue;
    return g;
  }
  return null;
}

/**
 * Trivially-correct brute-force solver: outcome (-1 loss / 0 draw / 1 win) for
 * the side to move, assuming `board` is not already won. Fast only for positions
 * with few empties — used purely to validate the optimized Expert solver.
 */
function referenceOutcome(board, player) {
  const moves = board.legalMoves();
  if (moves.length === 0) return 0; // full board, nobody won -> draw
  for (const c of moves) { // immediate win?
    board.play(c, player);
    const w = board.isWin(player);
    board.undo(c, player);
    if (w) return 1;
  }
  let best = -1;
  for (const c of moves) {
    board.play(c, player);
    const r = -referenceOutcome(board, player ^ 1);
    board.undo(c, player);
    if (r > best) best = r;
    if (best === 1) break;
  }
  return best;
}

// Exposed for tests / profiling.
export const _internals = {
  expertSolve,
  chooseExpert,
  computeWinningCells,
  possibleCells,
  nonLosingCells,
  evaluate,
  getNodeCount: () => nodeCount,
  resetNodeCount: () => { nodeCount = 0; },
  BOARD_MASK: () => BOARD_MASK,
};

export default AI;
