// ai.js - Tic Tac Toe bots for both variants. Tiers map onto the hub's shared
// difficulty labels (beginner/intermediate/pro -- see js/game-stats-ui.js's
// DIFF_META) and both variants share the same three tier NAMES, but not the
// same search: Classic is small enough to solve exhaustively; Ultimate needs
// a real heuristic search under a time budget (Mancala's Pro tier is the
// precedent for the iterative-deepening-under-a-deadline shape).

import {
  WIN_LINES, otherMark, wouldWin,
  legalMovesClassic, cloneClassic, applyMoveClassic,
  legalMovesUltimate, cloneUltimate, applyMoveUltimate,
} from './game.js';

const CENTER = 4;
const CORNERS = [0, 2, 6, 8];
const EDGES = [1, 3, 5, 7];
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// === Classic ================================================================

function beginnerClassic(s, moves, rng) {
  for (const m of moves) if (wouldWin(s.board, m, s.turn)) return m;
  return pick(moves, rng);
}

function intermediateClassic(s, moves, rng) {
  const me = s.turn, opp = otherMark(me);
  for (const m of moves) if (wouldWin(s.board, m, me)) return m;
  for (const m of moves) if (wouldWin(s.board, m, opp)) return m;
  if (moves.includes(CENTER)) return CENTER;
  const corners = moves.filter((m) => CORNERS.includes(m));
  if (corners.length) return pick(corners, rng);
  const edges = moves.filter((m) => EDGES.includes(m));
  if (edges.length) return pick(edges, rng);
  return moves[0];
}

/** Exhaustive minimax with alpha-beta (pruning only -- the search still
 *  covers every line to a terminal state, no depth cutoff). Classic's tree
 *  is tiny (<= 9! nodes before pruning), so this is fast with no time
 *  budget needed. Scores favor a faster win / slower loss so the AI never
 *  stalls a won position or hands back a tempo in a lost one. */
function minimaxClassic(s, me, alpha, beta) {
  if (s.over) return s.isDraw ? 0 : (s.winner === me ? 10 - s.moves : s.moves - 10);
  const maximizing = s.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of legalMovesClassic(s)) {
    const child = cloneClassic(s);
    applyMoveClassic(child, m);
    const v = minimaxClassic(child, me, alpha, beta);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

// Pro Classic is unbeatable BY DESIGN: exhaustive minimax over a solved game
// means a perfect opponent can only ever draw it. That is the intended
// result, not a bug to "fix" -- Ultimate exists precisely because Classic's
// small state space makes a human-unbeatable AI trivial to compute, and a
// genuinely hard AI needs the bigger nested board (see ai.js's Ultimate
// section below). Do not weaken this search to make Pro Classic winnable.
function proClassic(s, moves) {
  const me = s.turn;
  let best = null, bestV = -Infinity;
  for (const m of moves) {
    const child = cloneClassic(s);
    applyMoveClassic(child, m);
    const v = minimaxClassic(child, me, -Infinity, Infinity);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

/** Pick a cell for the side to move in a Classic state. `tier` is
 *  'beginner' | 'intermediate' | 'pro'. */
export function chooseClassicMove(s, tier, rng = Math.random) {
  const moves = legalMovesClassic(s);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (tier === 'beginner') return beginnerClassic(s, moves, rng);
  if (tier === 'intermediate') return intermediateClassic(s, moves, rng);
  return proClassic(s, moves);
}

// === Ultimate ================================================================
//
// Evaluation terms (all four matter -- see the eval weights below):
//   1. Small-board ownership, weighted positionally on the meta-board
//      (center > corners > edges, mirroring classic TTT's own positional
//      value).
//   2. Meta-line potential: two small boards won in a line with the third
//      still open is a large bonus (mirrored for the opponent).
//   3. Within still-open small boards: the standard two-in-a-row-with-an-
//      open-third heuristic, weighted well below the meta-board terms.
//   4. Send penalty: a move is scored down by the quality of the position
//      it hands the opponent, and HEAVILY down if it sends them to a
//      resolved board (a free move across the whole meta-board). This is
//      the term that makes the AI play like Ultimate instead of nine
//      unrelated games -- without it, the search locally optimizes each
//      small board and hands over free moves constantly. Do not cut it.

const META_WEIGHT = [3, 2, 3, 2, 5, 2, 3, 2, 3];   // corner=3, edge=2, center=5
const META_OWN_SCALE = 90;
const META_LINE_TWO = 260;
const META_LINE_ONE = 35;
const SMALL_LINE_TWO = 6;
const SMALL_LINE_ONE = 1;
const SMALL_CENTER_OPEN = 2;
const SEND_WIN_BONUS = 30;
const FREE_MOVE_PENALTY = 400;   // heaviest single term -- see "Send penalty" above
const WIN_SCORE = 1_000_000;

function metaOwnershipScore(meta, me, opp) {
  let s = 0;
  for (let i = 0; i < 9; i++) {
    if (meta[i] === me) s += META_WEIGHT[i] * META_OWN_SCALE;
    else if (meta[i] === opp) s -= META_WEIGHT[i] * META_OWN_SCALE;
  }
  return s;
}

function metaLinePotential(meta, me, opp) {
  let s = 0;
  for (const [a, b, c] of WIN_LINES) {
    const vals = [meta[a], meta[b], meta[c]];
    const mine = vals.filter((v) => v === me).length;
    const oppN = vals.filter((v) => v === opp).length;
    const dead = vals.filter((v) => v === 'D').length;
    if (oppN === 0 && dead === 0) s += mine === 2 ? META_LINE_TWO : mine === 1 ? META_LINE_ONE : 0;
    if (mine === 0 && dead === 0) s -= oppN === 2 ? META_LINE_TWO : oppN === 1 ? META_LINE_ONE : 0;
  }
  return s;
}

function smallBoardPotential(boards, meta, me, opp) {
  let s = 0;
  for (let b = 0; b < 9; b++) {
    if (meta[b] !== null) continue;   // only still-open boards contribute
    const cells = boards[b];
    for (const [a, b2, c] of WIN_LINES) {
      const vals = [cells[a], cells[b2], cells[c]];
      const mine = vals.filter((v) => v === me).length;
      const oppN = vals.filter((v) => v === opp).length;
      if (oppN === 0 && mine === 2) s += SMALL_LINE_TWO;
      else if (oppN === 0 && mine === 1) s += SMALL_LINE_ONE;
      if (mine === 0 && oppN === 2) s -= SMALL_LINE_TWO;
      else if (mine === 0 && oppN === 1) s -= SMALL_LINE_ONE;
    }
  }
  return s;
}

/** How good the position `state.forcedBoard` (or a free move) is for
 *  `state.turn`, the player about to be dropped into it -- positive is good
 *  for the player to move (bad for whoever just moved, which is the whole
 *  point of the term). */
function sendQuality(state) {
  if (state.forcedBoard === null) return FREE_MOVE_PENALTY;
  const cells = state.boards[state.forcedBoard];
  const forPlayer = state.turn, forOpp = otherMark(state.turn);
  let v = cells[CENTER] === null ? SMALL_CENTER_OPEN : 0;
  for (const [a, b, c] of WIN_LINES) {
    const vals = [cells[a], cells[b], cells[c]];
    const mine = vals.filter((x) => x === forPlayer).length;
    const oppN = vals.filter((x) => x === forOpp).length;
    if (oppN === 0 && mine === 2) v += SEND_WIN_BONUS;
    if (mine === 0 && oppN === 2) v -= SEND_WIN_BONUS;
  }
  return v;
}

function evaluateUltimate(state, me, opp, useSendPenalty) {
  if (state.over) {
    if (state.isDraw) return 0;
    return state.winner === me ? WIN_SCORE : -WIN_SCORE;
  }
  let score = metaOwnershipScore(state.meta, me, opp)
    + metaLinePotential(state.meta, me, opp)
    + smallBoardPotential(state.boards, state.meta, me, opp);
  if (useSendPenalty) {
    const sq = sendQuality(state);            // positive = good for state.turn
    score += state.turn === me ? sq : -sq;
  }
  return score;
}

// Center-first, then corners, then edges: a coarse move-ordering heuristic
// (center/corner cells tend to matter most, same intuition as Classic's
// intermediate tier) so alpha-beta prunes more under the tight Pro budget.
function cellRank(cell) { return cell === CENTER ? 0 : CORNERS.includes(cell) ? 1 : 2; }
function orderMovesUltimate(moves) {
  return moves.slice().sort((a, b) => cellRank(a.cell) - cellRank(b.cell));
}

const ABORT = Symbol('abort');

function searchUltimate(state, depth, alpha, beta, me, opp, useSendPenalty, ctx) {
  if (ctx && ctx.deadline) {
    ctx.nodes = (ctx.nodes + 1) | 0;
    if ((ctx.nodes & 127) === 0 && Date.now() > ctx.deadline) return ABORT;
  }
  if (state.over || depth <= 0) return evaluateUltimate(state, me, opp, useSendPenalty);
  const maximizing = state.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of orderMovesUltimate(legalMovesUltimate(state))) {
    const child = cloneUltimate(state);
    applyMoveUltimate(child, m);
    const v = searchUltimate(child, depth - 1, alpha, beta, me, opp, useSendPenalty, ctx);
    if (v === ABORT) return ABORT;
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

function bestAtDepthUltimate(state, depth, useSendPenalty, ctx) {
  const me = state.turn, opp = otherMark(me);
  let best = null, bestV = -Infinity;
  for (const m of orderMovesUltimate(legalMovesUltimate(state))) {
    const child = cloneUltimate(state);
    applyMoveUltimate(child, m);
    const v = searchUltimate(child, depth - 1, -Infinity, Infinity, me, opp, useSendPenalty, ctx);
    if (v === ABORT) return null;
    if (best === null || v > bestV) { bestV = v; best = m; }
  }
  return best === null ? null : { move: best, value: bestV };
}

const INTERMEDIATE_DEPTH = 3;
const INTERMEDIATE_MS = 150;    // soft safety deadline, same role as Mancala's level-2 tier
const PRO_MS = 380;             // matches Mancala's Pro budget (CLAUDE.md precedent)

function beginnerUltimate(state, moves, rng) {
  for (const m of moves) if (wouldWin(state.boards[m.board], m.cell, state.turn)) return m;
  return pick(moves, rng);
}

/** Pick a `{board, cell}` move for the side to move in an Ultimate state.
 *  `tier` is 'beginner' | 'intermediate' | 'pro'. Pro deepens iteratively
 *  under a ~380ms budget and keeps the last depth that finished in time. */
export function chooseUltimateMove(state, tier, rng = Math.random) {
  const moves = legalMovesUltimate(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  if (tier === 'beginner') return beginnerUltimate(state, moves, rng);

  if (tier === 'intermediate') {
    const r = bestAtDepthUltimate(state, INTERMEDIATE_DEPTH, false, { deadline: Date.now() + INTERMEDIATE_MS, nodes: 0 });
    if (r) return r.move;
    const g = bestAtDepthUltimate(state, 1, false, null);
    return g ? g.move : pick(moves, rng);
  }

  const ctx = { deadline: Date.now() + PRO_MS, nodes: 0 };
  let chosen = null;
  for (let depth = 2; depth <= 40; depth++) {
    const r = bestAtDepthUltimate(state, depth, true, ctx);
    if (!r) break;               // deadline hit mid-depth: keep the last finished depth's pick
    chosen = r.move;
    if (Date.now() > ctx.deadline) break;
  }
  if (chosen != null) return chosen;
  const fallback = bestAtDepthUltimate(state, 1, true, null);
  return fallback ? fallback.move : moves[0];
}

// === Unified dispatch ========================================================

export function chooseMove(state, tier, rng = Math.random) {
  return state.variant === 'ultimate'
    ? chooseUltimateMove(state, tier, rng)
    : chooseClassicMove(state, tier, rng);
}

export default { chooseMove, chooseClassicMove, chooseUltimateMove };
