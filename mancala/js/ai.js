// ai.js - Mancala bot. Minimax with alpha-beta over the pure engine.
//
// Levels map to the hub's shared tiers:
//   1 Beginner     shallow and noisy: mostly greedy, sometimes random
//   2 Intermediate fixed depth 5 search
//   3 Pro          iterative deepening under a hard time budget
//
// Extra turns keep the same player to move, so the search flips maximizer only
// when the turn actually passes. Extra-turn chains do not consume depth, which
// would explode a fixed-depth search; the Pro tier instead deepens iteratively
// and stops at a time deadline, so a move never takes more than ~PRO_MS.

import { applyMove, legalMoves, storeOf, P1 } from './game.js';

const PRO_MS = 380;
const INTERMEDIATE_DEPTH = 5;
const ABORT = Symbol('abort');

/** Store difference from `me`'s point of view, plus a small in-hand bonus. */
function evaluate(state, me) {
  const opp = me === P1 ? 1 : 0;
  const myPits = me === P1 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
  const opPits = me === P1 ? [7, 8, 9, 10, 11, 12] : [0, 1, 2, 3, 4, 5];
  let side = 0;
  for (const p of myPits) side += state.pits[p];
  for (const p of opPits) side -= state.pits[p];
  return (state.pits[storeOf(me)] - state.pits[storeOf(opp)]) * 4 + side;
}

/** Try likely-strong moves first so alpha-beta prunes more. */
function orderMoves(state) {
  const moves = legalMoves(state);
  const myStore = storeOf(state.turn);
  return moves.slice().sort((a, b) => {
    const exactA = state.pits[a] === myStore - a ? 1 : 0;   // lands in own store
    const exactB = state.pits[b] === myStore - b ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    return state.pits[b] - state.pits[a];
  });
}

/** Alpha-beta. `ctx.deadline` (ms epoch) aborts the whole subtree via ABORT. */
function search(state, depth, alpha, beta, me, ctx) {
  if (ctx.deadline) {
    ctx.nodes = (ctx.nodes + 1) | 0;
    if ((ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) return ABORT;
  }
  if (state.over) {
    const opp = me === P1 ? 1 : 0;
    return (state.pits[storeOf(me)] - state.pits[storeOf(opp)]) * 1000;
  }
  if (depth <= 0) return evaluate(state, me);

  const moves = orderMoves(state);
  const maximizing = state.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const r = applyMove(state, m);
    if (!r) continue;
    const d = r.state.turn === state.turn ? depth : depth - 1;
    const v = search(r.state, d, alpha, beta, me, ctx);
    if (v === ABORT) return ABORT;
    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best === -Infinity || best === Infinity ? evaluate(state, me) : best;
}

/** Root search at one depth. Returns { move, value } or null when aborted. */
function bestAtDepth(state, depth, ctx) {
  const me = state.turn;
  let best = null;
  let bestV = -Infinity;
  for (const m of orderMoves(state)) {
    const r = applyMove(state, m);
    if (!r) continue;
    const d = r.state.turn === me ? depth : depth - 1;
    const v = search(r.state, d, -Infinity, Infinity, me, ctx);
    if (v === ABORT) return null;
    if (best === null || v > bestV) { bestV = v; best = m; }
  }
  return best === null ? null : { move: best, value: bestV };
}

/**
 * Pick a pit for the current player. `level` is 1..3.
 * Deterministic apart from Beginner's deliberate wobble.
 */
export function chooseMove(state, level) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  // Beginner: 40% of turns pick at random, otherwise a very shallow search.
  if (level <= 1) {
    if (Math.random() < 0.4) return moves[Math.floor(Math.random() * moves.length)];
    const r = bestAtDepth(state, 2, {});
    return r ? r.move : moves[0];
  }

  if (level === 2) {
    const r = bestAtDepth(state, INTERMEDIATE_DEPTH, { deadline: Date.now() + 150, nodes: 0 });
    if (r) return r.move;
    const g = bestAtDepth(state, 2, {});
    return g ? g.move : moves[0];
  }

  // Pro: deepen until the time budget runs out; keep the last finished depth.
  const ctx = { deadline: Date.now() + PRO_MS, nodes: 0 };
  let pick = null;
  for (let depth = 3; depth <= 13; depth++) {
    const r = bestAtDepth(state, depth, ctx);
    if (!r) break;                 // deadline hit mid-depth: discard partial result
    pick = r.move;
    if (Date.now() > ctx.deadline) break;
  }
  if (pick != null) return pick;
  const fallback = bestAtDepth(state, 3, {});
  return fallback ? fallback.move : moves[0];
}

export default { chooseMove };
