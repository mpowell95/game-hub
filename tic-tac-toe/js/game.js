// game.js - Tic Tac Toe engine: Classic 3x3 and Ultimate (9 nested 3x3 boards).
// Pure logic, no DOM. Mirrors Filler/Mancala's synchronous-state pattern (no
// async agent interface -- a tic-tac-toe move has no multi-step resolution to
// await, so the extra machinery Escoba/Chinchon use for pacing isn't needed).
//
// Shared move-line table: a 3x3 grid's eight winning lines, used both for a
// Classic board and for the Ultimate meta-board (whoever owns 3 small boards
// in a row).

export const X = 'X';
export const O = 'O';
// A small board that fills with no winner is DEAD: it counts for neither
// player on the meta-board and can never be played in again (see the
// Ultimate meta-board draw rule below).
export const DEAD = 'D';

export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const otherMark = (m) => (m === X ? O : X);

/** First line of three matching, non-null, non-DEAD marks, or null. Shared by
 *  a Classic board and the Ultimate meta-board (DEAD entries never match). */
export function findWinLine(cells) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const v = cells[a];
    if (v && v !== DEAD && v === cells[b] && v === cells[c]) return { mark: v, line };
  }
  return null;
}

/** Would placing `mark` at `cell` complete a line on this 9-cell board? Used
 *  by the AI without mutating or cloning state. */
export function wouldWin(cells, cell, mark) {
  const probe = cells.slice();
  probe[cell] = mark;
  const win = findWinLine(probe);
  return !!(win && win.mark === mark);
}

// --- Classic ------------------------------------------------------------

export function newClassicGame(firstMark = X) {
  return {
    variant: 'classic',
    board: new Array(9).fill(null),
    turn: firstMark,
    winner: null,
    winLine: null,
    over: false,
    isDraw: false,
    moves: 0,
  };
}

export function cloneClassic(s) {
  return { ...s, board: s.board.slice(), winLine: s.winLine ? s.winLine.slice() : null };
}

export function legalMovesClassic(s) {
  if (s.over) return [];
  const out = [];
  for (let i = 0; i < 9; i++) if (s.board[i] === null) out.push(i);
  return out;
}

/** Mutates `s` in place with the current player's move at `cell`; returns `s`.
 *  A no-op (returns `s` unchanged) if the game is over or the cell is taken. */
export function applyMoveClassic(s, cell) {
  if (s.over || s.board[cell] !== null) return s;
  s.board[cell] = s.turn;
  s.moves += 1;
  const win = findWinLine(s.board);
  if (win) {
    s.winner = win.mark;
    s.winLine = win.line;
    s.over = true;
  } else if (s.moves === 9) {
    s.over = true;
    s.isDraw = true;
  } else {
    s.turn = otherMark(s.turn);
  }
  return s;
}

// --- Ultimate -------------------------------------------------------------
//
// Nine small boards (3x3 of 3x3). Playing cell `c` of small board `b` sends
// the opponent to small board `c` next; if that board is already resolved
// (won or dead), the opponent gets a free move: any cell in any still-open
// board. Winning three small boards in a meta-line wins the match; if every
// small board resolves with no meta-line, the match is a draw (the simpler,
// standard scoring -- NOT the count-of-boards-won variant, which this engine
// does not implement).

export function newUltimateGame(firstMark = X) {
  return {
    variant: 'ultimate',
    boards: Array.from({ length: 9 }, () => new Array(9).fill(null)),
    meta: new Array(9).fill(null),
    turn: firstMark,
    forcedBoard: null,   // null = free move (any open board)
    winner: null,
    winLine: null,
    over: false,
    isDraw: false,
    moves: 0,
    lastMove: null,
  };
}

export function cloneUltimate(s) {
  return {
    ...s,
    boards: s.boards.map((b) => b.slice()),
    meta: s.meta.slice(),
    winLine: s.winLine ? s.winLine.slice() : null,
    lastMove: s.lastMove ? { ...s.lastMove } : null,
  };
}

/** A board can still be played in: unresolved (no winner, not full/dead). */
function boardPlayable(s, b) { return s.meta[b] === null; }

export function legalMovesUltimate(s) {
  if (s.over) return [];
  const moves = [];
  if (s.forcedBoard !== null && boardPlayable(s, s.forcedBoard)) {
    const b = s.forcedBoard;
    for (let c = 0; c < 9; c++) if (s.boards[b][c] === null) moves.push({ board: b, cell: c });
    return moves;
  }
  for (let b = 0; b < 9; b++) {
    if (!boardPlayable(s, b)) continue;
    for (let c = 0; c < 9; c++) if (s.boards[b][c] === null) moves.push({ board: b, cell: c });
  }
  return moves;
}

/** Mutates `s` in place with the current player's move `{board, cell}`;
 *  returns `s`. A no-op if the game is over, the target board isn't
 *  playable, or the cell is taken. */
export function applyMoveUltimate(s, move) {
  const { board, cell } = move;
  if (s.over || !boardPlayable(s, board) || s.boards[board][cell] !== null) return s;
  const mark = s.turn;
  s.boards[board][cell] = mark;
  s.moves += 1;
  s.lastMove = { board, cell };

  // Resolve the small board just played in, if this move settled it.
  const smallWin = findWinLine(s.boards[board]);
  if (smallWin) {
    s.meta[board] = mark;
  } else if (s.boards[board].every((v) => v !== null)) {
    s.meta[board] = DEAD;
  }

  // Resolve the match on the meta-board.
  const metaWin = findWinLine(s.meta);
  if (metaWin) {
    s.winner = metaWin.mark;
    s.winLine = metaWin.line;
    s.over = true;
    return s;
  }
  if (s.meta.every((v) => v !== null)) {
    s.over = true;
    s.isDraw = true;
    return s;
  }

  // Next forced board is the cell just played; a resolved target board
  // (won or dead) grants the opponent a free move instead.
  s.forcedBoard = boardPlayable(s, cell) ? cell : null;
  s.turn = otherMark(mark);
  return s;
}

// --- Unified dispatch (variant-agnostic callers: ai.js, ui.js, test.js) ---

export function newGame(variant, firstMark = X) {
  return variant === 'ultimate' ? newUltimateGame(firstMark) : newClassicGame(firstMark);
}
export function cloneGame(s) {
  return s.variant === 'ultimate' ? cloneUltimate(s) : cloneClassic(s);
}
export function legalMoves(s) {
  return s.variant === 'ultimate' ? legalMovesUltimate(s) : legalMovesClassic(s);
}
export function applyMove(s, move) {
  return s.variant === 'ultimate' ? applyMoveUltimate(s, move) : applyMoveClassic(s, move);
}

export default {
  X, O, DEAD, WIN_LINES, otherMark, findWinLine, wouldWin,
  newClassicGame, cloneClassic, legalMovesClassic, applyMoveClassic,
  newUltimateGame, cloneUltimate, legalMovesUltimate, applyMoveUltimate,
  newGame, cloneGame, legalMoves, applyMove,
};
