// hoops4/js/replay.js - what a turn-by-turn match's landed moves decide. PURE (2026-10-28).
//
// Shared by mp.js (validateGame refuses a match whose stored `over` is not this) and by the
// integrity checks on the server (js/integrity.js). connect-four/js/board.js is the board, as in
// game.js.
import { Board } from '../../connect-four/js/board.js';

/** `moves`: [{ by: 'a' | 'b', col, miss }] in order. Returns { winner: 'a' | 'b' | null, over }, `over`
 *  false while nobody has four and the board is not full; null when a move cannot be played (a full
 *  column) or comes after the game was already decided. */
export function replayResult(moves) {
  const board = new Board();
  let winner = null, over = false;
  for (const m of moves || []) {
    if (!m || m.miss) continue;
    const col = +m.col;
    if (over || !board.canPlay(col)) return null;
    const p = m.by === 'a' ? 0 : 1;
    board.play(col, p);
    if (board.isWin(p)) { winner = m.by; over = true; } else if (board.isFull()) over = true;
  }
  return { winner, over };
}

/** Does a stored winner ('a' | 'b' | null for a draw) agree with what the moves decide? */
export function sameResult(r, winner) {
  return !!r && r.over && r.winner === (winner == null ? null : winner);
}

export default { replayResult, sameResult };
