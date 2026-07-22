// test.js - headless engine + AI assertions (Node, no DOM, no dependencies).
//   node dots-boxes/js/test.js
// Requires Node >= 22.7 (ESM syntax detection; there is no package.json), same
// as every other game's test.js in this repo.

import {
  newGame, cloneGame, edgeKey, legalMoves, applyMove, edgeCount,
  adjacentBoxes, isOver, score,
} from './game.js';
import { chooseMove } from './ai.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

// === test helpers: building synthetic mid/end-game rows of chains ==========
//
// A row of chains laid out left-to-right in a single-row (1 x N) board:
// every chain-separating wall (and both true board edges) is pre-drawn, so
// each chain is its own connected region. Every chain's end boxes get one of
// top/bottom left undrawn as their "outer end" (in a 1-row board top/bottom
// are always boundary edges, never a link to another box), UNLESS
// `openFirstChain` opens the very first chain from its left board edge,
// leaving that chain's leftmost box at exactly 1 undrawn edge (a frontier).
// `bankedForP0` prepends that many extra fully-drawn boxes owned by player 0,
// to simulate boxes already captured earlier in the game.
function buildRowChains(lengths, openFirstChain, bankedForP0 = 0) {
  const cols = bankedForP0 + lengths.reduce((a, b) => a + b, 0);
  const s = newGame(1, cols);
  for (let c = 0; c < bankedForP0; c++) {
    s.hEdges[0][c] = 0; s.hEdges[1][c] = 0; s.vEdges[0][c] = 0; s.vEdges[0][c + 1] = 0;
    s.boxes[0][c] = 0;
  }
  for (let c = bankedForP0; c < cols; c++) { s.hEdges[0][c] = 0; s.hEdges[1][c] = 0; }
  let idx = bankedForP0;
  const wallCols = [idx];
  for (const len of lengths) { idx += len; wallCols.push(idx); }
  for (const w of wallCols) s.vEdges[0][w] = 0;

  idx = bankedForP0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    const leftBox = idx, rightBox = idx + len - 1;
    const opened = openFirstChain && i === 0;
    if (len === 1) {
      if (!opened) { s.hEdges[0][leftBox] = null; s.hEdges[1][leftBox] = null; }
    } else {
      if (!opened) s.hEdges[1][leftBox] = null;
      s.hEdges[1][rightBox] = null;
    }
    idx += len;
  }
  s.drawnEdges = 0;
  for (let c = 0; c < cols; c++) { if (s.hEdges[0][c] !== null) s.drawnEdges++; if (s.hEdges[1][c] !== null) s.drawnEdges++; }
  for (let c = 0; c <= cols; c++) if (s.vEdges[0][c] !== null) s.drawnEdges++;
  s.turn = 0;
  return s;
}

function playMatch(rows, cols, tierP0, tierP1, rng) {
  const s = newGame(rows, cols);
  const tiers = [tierP0, tierP1];
  let guard = 0;
  while (!isOver(s) && guard++ < rows * cols * 4 + 50) {
    const move = chooseMove(s, tiers[s.turn], rng);
    if (!move) break;
    applyMove(s, move);
  }
  return { finalScore: score(s), finished: isOver(s) };
}

// === Engine ==================================================================

// Drawing the 4th edge of a box claims it and grants another turn.
{
  const s = newGame(1, 1);
  applyMove(s, { type: 'h', r: 0, c: 0 });
  applyMove(s, { type: 'h', r: 1, c: 0 });
  applyMove(s, { type: 'v', r: 0, c: 0 });
  ok('engine: box at 3 sides is not yet claimed', s.boxes[0][0] === null);
  const turnBeforeCapture = s.turn;
  const res = applyMove(s, { type: 'v', r: 0, c: 1 });
  ok('engine: 4th edge claims the box for whoever drew it', s.boxes[0][0] === turnBeforeCapture);
  ok('engine: claiming grants another turn (turn unchanged)', s.turn === turnBeforeCapture);
  ok('engine: applyMove reports the claim', res.claimed === 1 && res.again === true);
}

// An edge completing boxes on both sides claims 2 and grants exactly one extra turn.
{
  const s = newGame(1, 2);
  // box0: top,bottom,left drawn (missing right = v[0][1], shared with box1's left)
  s.hEdges[0][0] = 0; s.hEdges[1][0] = 0; s.vEdges[0][0] = 0;
  // box1: top,bottom,right drawn (missing left = v[0][1], the shared edge)
  s.hEdges[0][1] = 0; s.hEdges[1][1] = 0; s.vEdges[0][2] = 0;
  s.drawnEdges = 5;
  const res = applyMove(s, { type: 'v', r: 0, c: 1 });
  ok('engine: shared edge claims both boxes at once', s.boxes[0][0] === 0 && s.boxes[0][1] === 0);
  ok('engine: double capture reports claimed=2', res.claimed === 2);
  ok('engine: double capture still grants exactly ONE extra turn', res.again === true && s.turn === 0);
}

// A move claiming nothing passes the turn.
{
  const s = newGame(2, 2);
  applyMove(s, { type: 'h', r: 0, c: 0 });
  ok('engine: a non-completing move passes the turn', s.turn === 1);
}

// Illegal move (already-drawn edge) is a no-op.
{
  const s = newGame(2, 2);
  applyMove(s, { type: 'h', r: 0, c: 0 });
  const turnBefore = s.turn, drawnBefore = s.drawnEdges;
  const res = applyMove(s, { type: 'h', r: 0, c: 0 });
  ok('engine: redrawing an existing edge is a no-op', s.turn === turnBefore && s.drawnEdges === drawnBefore && res.claimed === 0);
}

// Game ends only when every edge is drawn; final scores sum to the box count.
{
  const rng = lcg(77);
  const s = newGame(3, 3);
  let guard = 0;
  while (!isOver(s) && guard++ < 500) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(rng() * moves.length)]);
  }
  const sc = score(s);
  ok('engine: game ends exactly when all edges are drawn', s.drawnEdges === s.totalEdges);
  ok('engine: final scores sum to the total box count', sc.p0 + sc.p1 === 3 * 3);
}

// 4x4 (Medium) can produce an 8-8 tie, reported as a tie not a win.
{
  // Two vertical dominoes stacked left/right, alternating ownership by construction:
  // a hand-built 4x4 finish where each player owns exactly 8 boxes.
  const s = newGame(4, 4);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s.boxes[r][c] = (r + c) % 2;
  for (let r = 0; r <= 4; r++) for (let c = 0; c < 4; c++) s.hEdges[r][c] = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c <= 4; c++) s.vEdges[r][c] = 0;
  s.drawnEdges = s.totalEdges;
  const sc = score(s);
  ok('engine: 4x4 can produce an 8-8 tie', isOver(s) && sc.p0 === 8 && sc.p1 === 8);
}

// === AI: legality ============================================================

for (const tier of ['beginner', 'intermediate', 'pro']) {
  const rng = lcg(500 + tier.length);
  let illegal = 0;
  for (let g = 0; g < 8; g++) {
    const s = newGame(3, 3);
    let guard = 0;
    while (!isOver(s) && guard++ < 200) {
      const move = chooseMove(s, tier, rng);
      if (!move) break;
      const legal = legalMoves(s).some((m) => edgeKey(m) === edgeKey(move));
      if (!legal) illegal++;
      applyMove(s, move);
    }
  }
  ok(`AI: ${tier} only ever produces legal moves`, illegal === 0);
}

// Intermediate never plays an unsafe edge (creates a fresh 3-sided box) while a safe one exists.
{
  const rng = lcg(909);
  let violations = 0;
  for (let g = 0; g < 12; g++) {
    const s = newGame(3, 3);
    let guard = 0;
    while (!isOver(s) && guard++ < 200) {
      const moves = legalMoves(s);
      const completes = (m) => adjacentBoxes(s, m).some(([r, c]) => s.boxes[r][c] === null && edgeCount(s, r, c) === 3);
      const gifts = (m) => adjacentBoxes(s, m).some(([r, c]) => s.boxes[r][c] === null && edgeCount(s, r, c) === 2);
      const captures = moves.filter(completes);
      const safe = moves.filter((m) => !completes(m) && !gifts(m));
      const move = chooseMove(s, 'intermediate', rng);
      if (!captures.length && safe.length && gifts(move) && !completes(move)) violations++;
      applyMove(s, move);
    }
  }
  ok('AI: Intermediate never gifts a box while a safe move exists', violations === 0);
}

// Pro double-crosses: a short chain (2 boxes) is already open, a long chain (13
// boxes) sits closed and untouched, and nothing else is on the board -- more
// than 14 edges remain, so this exercises the heuristic double-cross path, not
// the exact endgame solver. Taking the short chain's last 2 boxes normally
// would then force Pro to open the long chain and lose it 2-13; declining
// (the double-cross) hands the opponent only the 2 free boxes and forces THEM
// to open the long chain instead.
{
  const s = buildRowChains([2, 13], true);
  ok('pro dc: setup has more than 14 edges remaining (heuristic path, not exact solve)', legalMoves(s).length > 14);
  const move = chooseMove(s, 'pro', lcg(1));
  // The double-cross move is the tail box's outer edge: chain 0 spans columns
  // [0,1]; box 0 is the already-open frontier, box 1 is the tail whose outer
  // (bottom) edge is the decline move.
  const isDoubleCross = move.type === 'h' && move.r === 1 && move.c === 1;
  const isNormalCapture = move.type === 'v' && move.r === 0 && move.c === 1;
  ok('pro dc: Pro declines the frontier capture and plays the tail\'s outer edge', isDoubleCross && !isNormalCapture);
  if (isDoubleCross) {
    const after = applyMove(cloneGame(s), move);
    ok('pro dc: the double-cross move captures nothing and passes the turn', after.claimed === 0 && after.again === false);
  }
}

// Pro's exception: Pro has already banked enough boxes that finishing the
// current short (already-open) chain secures a majority outright, even
// though a long closed chain still remains on the board (so this isn't just
// "it's the last region" -- it's a genuine banked-score majority check).
// More than 14 edges remain (same margin as the double-cross test above), so
// this exercises the heuristic path, not the exact endgame solver.
{
  const s = buildRowChains([2, 13], true, 12); // 12 banked + chain(2, open) + chain(13, closed) = 27 boxes total
  const totalBoxes = s.rows * s.cols, myScore = score(s).p0;
  ok('pro exception: setup pre-condition (taking the open chain secures a majority)', myScore + 2 > totalBoxes / 2);
  ok('pro exception: setup has more than 14 edges remaining (heuristic path, not exact solve)', legalMoves(s).length > 14);
  const move = chooseMove(s, 'pro', lcg(2));
  const isNormalCapture = move.type === 'v' && move.r === 0 && move.c === 13; // completes the frontier box
  ok('pro exception: Pro takes the chain outright instead of double-crossing', isNormalCapture);
}

// Pro beats Intermediate over ~50 games on Medium (4x4), by a clear margin.
{
  let proWins = 0, intWins = 0, ties = 0;
  for (let i = 0; i < 50; i++) {
    const rng = lcg(3000 + i);
    const proIsP0 = i % 2 === 0;
    const { finalScore } = playMatch(4, 4, proIsP0 ? 'pro' : 'intermediate', proIsP0 ? 'intermediate' : 'pro', rng);
    const proScore = proIsP0 ? finalScore.p0 : finalScore.p1;
    const intScore = proIsP0 ? finalScore.p1 : finalScore.p0;
    if (proScore > intScore) proWins++; else if (intScore > proScore) intWins++; else ties++;
  }
  console.log(`  (Pro vs Intermediate over 50 Medium games: Pro ${proWins}, Intermediate ${intWins}, ties ${ties})`);
  ok('AI: Pro beats Intermediate by a clear margin over 50 Medium games', proWins >= intWins + 15);
}

// ~50 AI-vs-AI games (mixed tiers, mixed board sizes) all terminate with no exception.
{
  let finished = 0, threw = false;
  const sizes = [[3, 3], [4, 4], [5, 5]];
  const tiers = ['beginner', 'intermediate', 'pro'];
  for (let seed = 0; seed < 50; seed++) {
    try {
      const rng = lcg(6000 + seed);
      const [rows, cols] = sizes[seed % sizes.length];
      const tierP0 = tiers[seed % 3], tierP1 = tiers[(seed + 1) % 3];
      const { finished: done } = playMatch(rows, cols, tierP0, tierP1, rng);
      if (done) finished++;
    } catch (err) {
      threw = true;
      console.error('  AI-vs-AI sim threw:', err);
    }
  }
  ok('AI: 50 AI-vs-AI matches all terminate', finished === 50);
  ok('AI: no match threw', !threw);
}

console.log(`\nDots and Boxes tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
