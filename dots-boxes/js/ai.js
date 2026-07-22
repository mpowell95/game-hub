// ai.js - Dots and Boxes bots. Pure, no DOM, no Worker (chain analysis is
// cheap at these board sizes and the endgame solve below is bounded).
//
// A greedy "always capture every available box" AI plays badly: it takes a
// short chain, then is forced to open a long one and hands over the game.
// The fix is the double-cross (the "hard-hearted handout"): when eating a
// chain/loop, take all but the last 2 boxes (all but 4 for a loop) and play
// the move that leaves those for the opponent instead. You sacrifice 2 (or
// 4) boxes; in exchange the opponent must open the NEXT chain, and that
// control is worth far more than the sacrifice in any long endgame. Pro is
// the only tier that does this; Intermediate always takes everything.
//
// Every decision here is recomputed fresh from the current state each call
// (chooseMove is invoked once per move, including once per capture inside a
// chain-eating turn, since applyMove keeps `turn` on the same player while
// `again` is true) -- cheap at board sizes up to 5x5, and it means no
// per-turn state needs to be threaded through the caller.

import {
  edgeKey, legalMoves, applyMove, cloneGame, edgeCount, boxEdges,
  adjacentBoxes, neighborAcross, isOver, score,
} from './game.js';

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function edgeDrawn(s, e) { return (e.type === 'h' ? s.hEdges[e.r][e.c] : s.vEdges[e.r][e.c]) !== null; }

/** Legal moves that complete (capture) at least one box right now. */
function captureMoves(state, moves) {
  return moves.filter((m) => adjacentBoxes(state, m).some(([r, c]) => state.boxes[r][c] === null && edgeCount(state, r, c) === 3));
}

/** Legal, non-capturing moves that raise no box to 3 sides (the "opening game": play
 *  these as long as they exist and nothing is lost). */
function safeMoves(state, moves, captures) {
  const capSet = new Set(captures.map(edgeKey));
  return moves.filter((m) => !capSet.has(edgeKey(m))
    && adjacentBoxes(state, m).every(([r, c]) => !(state.boxes[r][c] === null && edgeCount(state, r, c) === 2)));
}

// --- chain/loop analysis -----------------------------------------------------
//
// A "region" is a connected component of not-yet-claimed boxes, linked by
// their shared undrawn edges (the "open graph" from the design doc, minus
// the virtual outer node -- boundary-touching open edges are instead
// collected per region as `outerEdges`). In a loony position (no safe moves
// left) every region is a pure chain (2 outer-touching ends) or loop (0
// outer-touching edges, a closed cycle, >= 4 boxes). Mid-chain-eating, a
// region also carries 1 or 2 "frontier" boxes (edgeCount 3, immediately
// capturable) -- 1 for a chain being eaten from one end, 2 for a cut loop
// being eaten from both ends at once.
function regionsOf(state) {
  const visited = new Set();
  const regions = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (state.boxes[r][c] !== null) continue;
      const startKey = `${r},${c}`;
      if (visited.has(startKey)) continue;
      const stack = [[r, c]];
      visited.add(startKey);
      const boxes = [];
      const outerEdges = [];
      while (stack.length) {
        const [br, bc] = stack.pop();
        boxes.push([br, bc]);
        for (const e of boxEdges(br, bc)) {
          if (edgeDrawn(state, e)) continue;
          const nb = neighborAcross(state, e, br, bc);
          if (!nb) { outerEdges.push(e); continue; }
          const nk = `${nb[0]},${nb[1]}`;
          if (visited.has(nk)) continue;
          visited.add(nk);
          stack.push(nb);
        }
      }
      const frontiers = boxes.filter(([br, bc]) => edgeCount(state, br, bc) === 3);
      regions.push({ boxes, size: boxes.length, frontiers, outerEdges });
    }
  }
  return regions;
}

/** Forced to open (no capture, no safe move left): open the shortest region to
 *  minimize the gift. A chain opens at one of its outer ends; a loop (no outer
 *  edge) opens at any of its internal edges -- structurally equivalent either way. */
function openShortestChain(state, moves, rng) {
  const regions = regionsOf(state).filter((r) => r.size > 0);
  if (!regions.length) return pick(moves, rng);
  const minSize = Math.min(...regions.map((r) => r.size));
  const region = pick(regions.filter((r) => r.size === minSize), rng);
  if (region.outerEdges.length) return pick(region.outerEdges, rng);
  const internal = [];
  for (const [r, c] of region.boxes) for (const e of boxEdges(r, c)) if (!edgeDrawn(state, e)) internal.push(e);
  return internal.length ? pick(internal, rng) : pick(moves, rng);
}

/** Double-cross a 2-box chain tail: decline the frontier capture and instead
 *  play the tail box's OTHER open edge (not the link to the frontier). That
 *  raises the tail to 3 sides too without completing anything, leaving both
 *  boxes for the opponent to take with one move (their shared link edge). */
function doubleCrossChainEdge(state, region, frontierR, frontierC) {
  const tail = region.boxes.find(([r, c]) => !(r === frontierR && c === frontierC));
  if (!tail) return null;
  const [tr, tc] = tail;
  for (const e of boxEdges(tr, tc)) {
    if (edgeDrawn(state, e)) continue;
    const nb = neighborAcross(state, e, tr, tc);
    if (!(nb && nb[0] === frontierR && nb[1] === frontierC)) return e;
  }
  return null;
}

/** Double-cross the last 4 boxes of a loop: play the link edge between the two
 *  still-untouched middle boxes. Both go from 2 to 3 sides (nothing captured),
 *  splitting the 4 into two capturable dominoes for the opponent. */
function doubleCrossLoopEdge(state, region) {
  const mids = region.boxes.filter(([r, c]) => edgeCount(state, r, c) !== 3);
  if (mids.length !== 2) return null;
  const [ar, ac] = mids[0], [br, bc] = mids[1];
  for (const e of boxEdges(ar, ac)) {
    if (edgeDrawn(state, e)) continue;
    const nb = neighborAcross(state, e, ar, ac);
    if (nb && nb[0] === br && nb[1] === bc) return e;
  }
  return null;
}

/** Pro's capture decision: take the box, UNLESS this is the point where the
 *  chain/loop being eaten is down to its double-cross threshold (2 for a
 *  chain, 4 for a loop) -- and even then, only double-cross if there's
 *  another region left to fight for control over, and taking everything
 *  here would not already win the game outright on box count. An AI that
 *  double-crosses when it could just take the last chain and win has thrown
 *  the game away on principle. */
function pickCaptureOrDoubleCross(state, caps, rng) {
  const me = state.turn;
  const totalBoxes = state.rows * state.cols;
  const myScoreNow = score(state)[me === 0 ? 'p0' : 'p1'];
  const regions = regionsOf(state);
  for (const m of caps) {
    const captured = adjacentBoxes(state, m).filter(([r, c]) => state.boxes[r][c] === null && edgeCount(state, r, c) === 3);
    if (!captured.length) continue;
    const [br, bc] = captured[0];
    const region = regions.find((reg) => reg.boxes.some(([r, c]) => r === br && c === bc));
    if (!region) continue;
    const otherRemaining = regions.filter((r) => r !== region).reduce((sum, r) => sum + r.size, 0);
    const takeAllWinsOutright = myScoreNow + region.size > totalBoxes / 2;
    const isLastRegion = otherRemaining === 0;
    if (!takeAllWinsOutright && !isLastRegion) {
      if (region.frontiers.length === 1 && region.size === 2) {
        const dc = doubleCrossChainEdge(state, region, br, bc);
        if (dc) return dc;
      } else if (region.frontiers.length === 2 && region.size === 4) {
        const dc = doubleCrossLoopEdge(state, region);
        if (dc) return dc;
      }
    }
  }
  return pick(caps, rng);
}

// --- tiers --------------------------------------------------------------

function beginnerMove(state, moves, rng) {
  const caps = captureMoves(state, moves);
  return caps.length ? pick(caps, rng) : pick(moves, rng);
}

function intermediateMove(state, moves, rng) {
  const caps = captureMoves(state, moves);
  if (caps.length) return pick(caps, rng);
  const safe = safeMoves(state, moves, caps);
  if (safe.length) return pick(safe, rng);
  return openShortestChain(state, moves, rng);
}

function proHeuristicMove(state, moves, rng) {
  const caps = captureMoves(state, moves);
  if (caps.length) return pickCaptureOrDoubleCross(state, caps, rng);
  const safe = safeMoves(state, moves, caps);
  if (safe.length) return pick(safe, rng);
  return openShortestChain(state, moves, rng);
}

// --- Pro's exact endgame solve (<= 14 edges remaining) ----------------------
//
// Alpha-beta over final box-count difference. At this size the true endgame
// is cheap to solve outright and finds provably optimal play (double-crosses
// and opening order fall out of the search automatically, no chain reasoning
// needed) -- a deeper search than the heuristic above, used only this close
// to the end. A deadline guards against any freak slow case; on abort we
// fall back to the same heuristic every other position uses.
const PRO_MS = 380;
const ENDGAME_EDGE_THRESHOLD = 14;
const ABORT = Symbol('abort');

function finalDiff(state, me) {
  const sc = score(state);
  return me === 0 ? sc.p0 - sc.p1 : sc.p1 - sc.p0;
}

function solveExact(state, me, alpha, beta, ctx) {
  if (ctx.deadline) {
    ctx.nodes = (ctx.nodes + 1) | 0;
    if ((ctx.nodes & 63) === 0 && Date.now() > ctx.deadline) return ABORT;
  }
  if (isOver(state)) return finalDiff(state, me);
  const maximizing = state.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of legalMoves(state)) {
    const child = cloneGame(state);
    applyMove(child, m);
    const v = solveExact(child, me, alpha, beta, ctx);
    if (v === ABORT) return ABORT;
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

function bestExactMove(state, me, ctx) {
  let bestMove = null, bestVal = -Infinity, alpha = -Infinity;
  for (const m of legalMoves(state)) {
    const child = cloneGame(state);
    applyMove(child, m);
    const v = solveExact(child, me, alpha, Infinity, ctx);
    if (v === ABORT) return null;
    if (bestMove === null || v > bestVal) { bestVal = v; bestMove = m; }
    if (bestVal > alpha) alpha = bestVal;
  }
  return bestMove;
}

function proMove(state, moves, rng) {
  if (moves.length <= ENDGAME_EDGE_THRESHOLD) {
    const exact = bestExactMove(state, state.turn, { deadline: Date.now() + PRO_MS, nodes: 0 });
    if (exact) return exact;
  }
  return proHeuristicMove(state, moves, rng);
}

/** Pick an edge for the side to move. `tier` is 'beginner' | 'intermediate' | 'pro'. */
export function chooseMove(state, tier, rng = Math.random) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (tier === 'beginner') return beginnerMove(state, moves, rng);
  if (tier === 'intermediate') return intermediateMove(state, moves, rng);
  return proMove(state, moves, rng);
}

export default { chooseMove };
