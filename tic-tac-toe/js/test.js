// test.js - headless engine + AI assertions (Node, no DOM, no dependencies).
//   node tic-tac-toe/js/test.js
// Requires Node >= 22.7 (ESM syntax detection; there is no package.json), same
// as every other game's test.js in this repo.

import {
  X, O, DEAD, WIN_LINES, findWinLine,
  newClassicGame, cloneClassic, legalMovesClassic, applyMoveClassic,
  newUltimateGame, legalMovesUltimate, applyMoveUltimate,
} from './game.js';
import { chooseClassicMove, chooseUltimateMove } from './ai.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

// === Classic =================================================================

// All eight win lines detected, for both players.
for (const line of WIN_LINES) {
  for (const mark of [X, O]) {
    const board = new Array(9).fill(null);
    for (const i of line) board[i] = mark;
    const win = findWinLine(board);
    ok(`classic: line [${line}] detected for ${mark}`, !!win && win.mark === mark && win.line.join() === line.join());
  }
}

// A real playthrough (via applyMoveClassic) also reaches the same conclusion,
// not just the findWinLine util in isolation.
{
  let s = newClassicGame(X);
  for (const cell of [0, 3, 1, 4, 2]) applyMoveClassic(s, cell);   // X: 0,1,2 (top row) / O: 3,4
  ok('classic: playthrough win sets winner/over/winLine', s.over && s.winner === X && s.winLine.join() === '0,1,2');
}

// Full board, no line, is a draw. Verified-by-hand sequence (see HANDOFF): no
// win line completes at any prefix of this sequence.
{
  let s = newClassicGame(X);
  const seq = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  for (const cell of seq) applyMoveClassic(s, cell);
  ok('classic: full board with no line is a draw', s.over && s.isDraw && s.winner === null);
  ok('classic: draw board is actually full', s.board.every((c) => c !== null));
}

// Illegal move (occupied cell) is rejected: a no-op, turn does not advance.
{
  let s = newClassicGame(X);
  applyMoveClassic(s, 0);           // X takes 0
  const turnBefore = s.turn, movesBefore = s.moves;
  applyMoveClassic(s, 0);           // O illegally retries 0
  ok('classic: occupied cell is rejected', s.board[0] === X && s.turn === turnBefore && s.moves === movesBefore);
}

// Pro AI never loses (it can only win or draw), from either seat, over 200 games
// against a uniformly random legal opponent.
{
  let losses = 0;
  for (let i = 0; i < 200; i++) {
    const proMark = i % 2 === 0 ? X : O;
    const rng = lcg(1000 + i);
    let s = newClassicGame(X);
    while (!s.over) {
      const moves = legalMovesClassic(s);
      const move = s.turn === proMark ? chooseClassicMove(s, 'pro') : moves[Math.floor(rng() * moves.length)];
      applyMoveClassic(s, move);
    }
    if (s.winner && s.winner !== proMark) losses++;
  }
  ok('classic: Pro AI never loses across 200 games (either seat)', losses === 0);
}

// === Ultimate =================================================================

// Move in small board b, cell c forces the opponent into small board c.
{
  let s = newUltimateGame(X);
  applyMoveUltimate(s, { board: 0, cell: 5 });
  ok('ultimate: move forces opponent into the matching board', s.forcedBoard === 5 && s.turn === O);
  const moves = legalMovesUltimate(s);
  ok('ultimate: forced-board moves are confined to that board', moves.length > 0 && moves.every((m) => m.board === 5));
}

// If the dictated board is already won, the opponent gets a free move.
{
  let s = newUltimateGame(X);
  s.meta[5] = X;   // test-only: seed as already resolved
  applyMoveUltimate(s, { board: 0, cell: 5 });
  ok('ultimate: a won target board grants a free move', s.forcedBoard === null);
  const boards = new Set(legalMovesUltimate(s).map((m) => m.board));
  ok('ultimate: free move spans multiple open boards', boards.size > 1);
}

// If the dictated board is full-and-drawn (dead), same free move.
{
  let s = newUltimateGame(X);
  s.meta[5] = DEAD;
  applyMoveUltimate(s, { board: 0, cell: 5 });
  ok('ultimate: a dead target board also grants a free move', s.forcedBoard === null);
}

// Winning three small boards in a meta-line wins the match.
{
  let s = newUltimateGame(X);
  s.meta[0] = X; s.meta[1] = X;
  s.boards[2][0] = X; s.boards[2][1] = X;   // one X move from completing board 2's top row
  s.turn = X; s.forcedBoard = 2;
  applyMoveUltimate(s, { board: 2, cell: 2 });
  ok('ultimate: completing a meta-line wins the match', s.over && s.winner === X);
  ok('ultimate: winLine reported is the meta top row', s.winLine && s.winLine.join() === '0,1,2');
}

// A drawn small board is dead: counts for neither player, and no further
// moves into it are legal (it has no empty cells left to offer, by
// construction of a full board -- and is excluded from every free-move set).
{
  let s = newUltimateGame(X);
  const b = 3;
  const seq = [0, 1, 2, 4, 3, 5, 7, 6, 8];   // same verified draw sequence as the classic test
  for (const cell of seq) { s.forcedBoard = b; applyMoveUltimate(s, { board: b, cell }); }
  ok('ultimate: a filled no-winner board resolves to DEAD', s.meta[b] === DEAD);
  s.forcedBoard = b;   // test-only: force a send into the now-dead board
  const forcedBack = legalMovesUltimate(s);
  ok('ultimate: forcing into a DEAD board yields a free move set, not that board', forcedBack.every((m) => m.board !== b));
}

// Match termination: ~50 AI-vs-AI matches never hang and never throw.
{
  let finished = 0, threw = false;
  for (let seed = 0; seed < 50; seed++) {
    const rng = lcg(2000 + seed);
    try {
      let s = newUltimateGame(X);
      let guard = 0;
      while (!s.over && guard++ < 200) {
        const tier = s.turn === X ? 'beginner' : (seed % 2 ? 'beginner' : 'intermediate');
        const move = chooseUltimateMove(s, tier, rng);
        applyMoveUltimate(s, move);
      }
      if (s.over) finished++;
    } catch (err) {
      threw = true;
      console.error('  Ultimate sim threw:', err);
    }
  }
  ok('ultimate: 50 AI-vs-AI matches all terminate', finished === 50);
  ok('ultimate: no match threw', !threw);
}

// Pro Ultimate responds within a generous multiple of its ~380ms budget on a
// mid-game-ish position (catches gross performance regressions, not meant to
// be a tight timing assertion).
{
  const rng = lcg(4242);
  let s = newUltimateGame(X);
  for (let i = 0; i < 12 && !s.over; i++) applyMoveUltimate(s, chooseUltimateMove(s, 'beginner', rng));
  if (!s.over) {
    const start = Date.now();
    const move = chooseUltimateMove(s, 'pro', rng);
    const elapsed = Date.now() - start;
    ok('ultimate: Pro responds within budget on a mid-game position', !!move && elapsed < 1500);
  } else {
    ok('ultimate: Pro timing check (match ended early, skipped)', true);
  }
}

console.log(`\nTic Tac Toe tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
