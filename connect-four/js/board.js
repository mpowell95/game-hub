// board.js — Connect Four bitboard engine (Session 1: engine only)
//
// Representation
// --------------
// Standard board is 7 columns x 6 rows. The engine uses the classic
// Connect Four bitboard layout (Tromp / Pascal Pons): each column is given
// ROWS + 1 = 7 bits, the extra top bit being an always-empty "sentinel" row.
// One BigInt per player holds that player's stones. JS has no native 64-bit
// integer, so BigInt is used to hold the 49-bit board.
//
// Bit index for (col, row), row 0 = bottom:   idx = col * 7 + row
//
//   col:   0   1   2   3   4   5   6
//        --------------------------------
//   r6 |   6  13  20  27  34  41  48   <- sentinel row, ALWAYS empty
//   r5 |   5  12  19  26  33  40  47
//   r4 |   4  11  18  25  32  39  46
//   r3 |   3  10  17  24  31  38  45
//   r2 |   2   9  16  23  30  37  44
//   r1 |   1   8  15  22  29  36  43
//   r0 |   0   7  14  21  28  35  42   <- bottom row
//
// The sentinel row is what makes the shift-based win detection correct: the
// row of guaranteed-zero bits between the top of one column and the bottom of
// the next prevents shifts from wrapping a line across the column boundary.

export const COLS = 7;
export const ROWS = 6;

// Player identifiers. The board itself is turn-agnostic — it just stores two
// sets of stones; game.js decides whose turn it is.
export const PLAYER_ONE = 0;
export const PLAYER_TWO = 1;

const H1 = ROWS + 1;            // bits per column, including the sentinel row (7)
const COL_BITS = BigInt(H1);   // = 7n, the horizontal shift distance

// Direction shift distances for win detection (see layout above):
//   vertical    : adjacent rows in a column      -> shift 1
//   horizontal  : adjacent columns, same row     -> shift H1   (7)
//   diagonal "/" : up-right (col+1, row+1)        -> shift H1+1 (8)
//   diagonal "\" : up-left  (col+1, row-1)        -> shift H1-1 (6)
const SHIFTS = [1n, COL_BITS, COL_BITS + 1n, COL_BITS - 1n];

// Mask of the six *playable* cells of column 0 (bits 0..5); shifted per column.
const COLUMN_PLAYABLE = ((1n << BigInt(ROWS)) - 1n);

/** Count set bits in a (non-negative) BigInt. */
function popcount(bits) {
  let n = 0;
  while (bits > 0n) {
    bits &= bits - 1n;
    n++;
  }
  return n;
}

export class Board {
  constructor() {
    this.reset();
  }

  reset() {
    // One bitboard per player (two bit-packed integers, one per player).
    this.pieces = [0n, 0n];
    // Next free row index per column (0..ROWS). heights[c] === ROWS => full.
    this.heights = new Array(COLS).fill(0);
    this.moveCount = 0;
  }

  /** Bitboard of all occupied cells (both players). */
  mask() {
    return this.pieces[PLAYER_ONE] | this.pieces[PLAYER_TWO];
  }

  /** True if `col` is a legal move (in range and not full). */
  canPlay(col) {
    return col >= 0 && col < COLS && this.heights[col] < ROWS;
  }

  /** Array of column indices that are currently legal to play. */
  legalMoves() {
    const moves = [];
    for (let c = 0; c < COLS; c++) {
      if (this.heights[c] < ROWS) moves.push(c);
    }
    return moves;
  }

  /**
   * Drop a stone for `player` into `col`. Returns the bit index used so the
   * move can be cheaply undone (handy for AI search in a later session).
   * Throws if the column is full or out of range.
   */
  play(col, player) {
    if (!this.canPlay(col)) {
      throw new Error(`Illegal move: column ${col} is full or out of range`);
    }
    const idx = BigInt(col * H1 + this.heights[col]);
    this.pieces[player] |= (1n << idx);
    this.heights[col]++;
    this.moveCount++;
    return idx;
  }

  /**
   * Undo the most recent stone dropped in `col` for `player`.
   * Caller is responsible for passing the same column/player that was played.
   */
  undo(col, player) {
    if (this.heights[col] <= 0) {
      throw new Error(`Cannot undo: column ${col} is empty`);
    }
    this.heights[col]--;
    const idx = BigInt(col * H1 + this.heights[col]);
    this.pieces[player] &= ~(1n << idx);
    this.moveCount--;
  }

  /**
   * True if `player` has four in a row (horizontal, vertical, or either
   * diagonal). Pure bit twiddling: for each direction, AND the board with a
   * copy shifted by the direction stride to find pairs, then AND again at
   * double the stride to find four-in-a-row.
   */
  isWin(player) {
    const pos = this.pieces[player];
    for (const s of SHIFTS) {
      const m = pos & (pos >> s);
      if ((m & (m >> (s * 2n))) !== 0n) return true;
    }
    return false;
  }

  /** True if every playable cell is filled. */
  isFull() {
    return this.moveCount >= COLS * ROWS;
  }

  /**
   * True for a drawn position: board full with neither player winning.
   * (A win still ends the game even on the final stone, so check both.)
   */
  isDraw() {
    return this.isFull() && !this.isWin(PLAYER_ONE) && !this.isWin(PLAYER_TWO);
  }

  /**
   * Serialize the full board to a single BigInt value. Player one's stones
   * occupy the low 49 bits, player two's the next 49 — so the value uniquely
   * identifies the position and is suitable as a transposition-table key in a
   * later session (combine with whose-turn-it-is, which lives in game.js).
   */
  getState() {
    return this.pieces[PLAYER_ONE] | (this.pieces[PLAYER_TWO] << 49n);
  }

  /** Deep copy of this board (stones, heights, move count). */
  clone() {
    const b = new Board();
    b.pieces[PLAYER_ONE] = this.pieces[PLAYER_ONE];
    b.pieces[PLAYER_TWO] = this.pieces[PLAYER_TWO];
    b.heights = this.heights.slice();
    b.moveCount = this.moveCount;
    return b;
  }

  /** Restore a board previously produced by getState(). */
  restore(state) {
    const low = (1n << 49n) - 1n;
    this.pieces[PLAYER_ONE] = state & low;
    this.pieces[PLAYER_TWO] = (state >> 49n) & low;
    // Rebuild per-column heights and the move count from the stones.
    this.moveCount = 0;
    const all = this.mask();
    for (let c = 0; c < COLS; c++) {
      const colMask = (all >> BigInt(c * H1)) & COLUMN_PLAYABLE;
      const h = popcount(colMask);
      this.heights[c] = h;
      this.moveCount += h;
    }
    return this;
  }

  /**
   * Occupant of cell (col, row), row 0 = bottom:
   * PLAYER_ONE, PLAYER_TWO, or -1 if empty. Convenience accessor for the AI's
   * heuristic evaluation and (later) the UI renderer.
   */
  cellAt(col, row) {
    const bit = 1n << BigInt(col * H1 + row);
    if (this.pieces[PLAYER_ONE] & bit) return PLAYER_ONE;
    if (this.pieces[PLAYER_TWO] & bit) return PLAYER_TWO;
    return -1;
  }

  /**
   * The four cells of `player`'s first 4-in-a-row as [col, row] pairs, or null
   * if `player` has no win. Used by the UI to highlight the winning line.
   */
  findWinningLine(player) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]; // →, ↑, ↗, ↘
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (this.cellAt(c, r) !== player) continue;
        for (const [dc, dr] of dirs) {
          const line = [[c, r]];
          let cc = c + dc, rr = r + dr;
          while (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && this.cellAt(cc, rr) === player) {
            line.push([cc, rr]);
            if (line.length === 4) return line;
            cc += dc; rr += dr;
          }
        }
      }
    }
    return null;
  }

  /** Human-readable board, bottom row last. '.' empty, 'X' P1, 'O' P2. */
  toString() {
    const rows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      let line = '';
      for (let c = 0; c < COLS; c++) {
        const bit = 1n << BigInt(c * H1 + r);
        if (this.pieces[PLAYER_ONE] & bit) line += 'X ';
        else if (this.pieces[PLAYER_TWO] & bit) line += 'O ';
        else line += '. ';
      }
      rows.push(line.trimEnd());
    }
    return rows.join('\n') + '\n' + '0 1 2 3 4 5 6';
  }

  // --- Headless tests -------------------------------------------------------

  /**
   * Scripted sanity tests for the bitboard. Plays a known vertical,
   * horizontal, and diagonal win and a known full-board draw, plus a few
   * state round-trip / move-generation checks. Logs pass/fail per case and
   * returns true iff every case passed. No UI required.
   */
  static test() {
    const results = [];
    const check = (name, cond) => {
      results.push({ name, pass: !!cond });
      console.log(`${cond ? 'PASS' : 'FAIL'}  Board: ${name}`);
    };

    // 1. Vertical win — four P1 stones stacked in column 3.
    {
      const b = new Board();
      for (let i = 0; i < 4; i++) b.play(3, PLAYER_ONE);
      check('vertical win detected', b.isWin(PLAYER_ONE));
      check('vertical win not credited to P2', !b.isWin(PLAYER_TWO));
      const line = b.findWinningLine(PLAYER_ONE);
      check('winning line has 4 cells', line && line.length === 4);
      check('winning line is in column 3', line && line.every(([c]) => c === 3));
      check('no winning line for P2', b.findWinningLine(PLAYER_TWO) === null);
    }

    // 2. Horizontal win — P1 across the bottom row, columns 0..3.
    {
      const b = new Board();
      for (const c of [0, 1, 2, 3]) b.play(c, PLAYER_ONE);
      check('horizontal win detected', b.isWin(PLAYER_ONE));
    }

    // 3. Diagonal "/" win — P1 on (0,0)(1,1)(2,2)(3,3), P2 as filler beneath.
    {
      const b = new Board();
      b.play(0, PLAYER_ONE);                                   // (0,0)
      b.play(1, PLAYER_TWO); b.play(1, PLAYER_ONE);            // (1,1)
      b.play(2, PLAYER_TWO); b.play(2, PLAYER_TWO); b.play(2, PLAYER_ONE); // (2,2)
      b.play(3, PLAYER_TWO); b.play(3, PLAYER_TWO); b.play(3, PLAYER_TWO); b.play(3, PLAYER_ONE); // (3,3)
      check('diagonal win detected', b.isWin(PLAYER_ONE));
    }

    // 3b. Diagonal "\" win — P1 on (3,0)(2,1)(1,2)(0,3), P2 as filler beneath.
    {
      const b = new Board();
      b.play(3, PLAYER_ONE);                                              // (3,0)
      b.play(2, PLAYER_TWO); b.play(2, PLAYER_ONE);                       // (2,1)
      b.play(1, PLAYER_TWO); b.play(1, PLAYER_TWO); b.play(1, PLAYER_ONE); // (1,2)
      b.play(0, PLAYER_TWO); b.play(0, PLAYER_TWO); b.play(0, PLAYER_TWO); b.play(0, PLAYER_ONE); // (0,3)
      check('anti-diagonal win detected', b.isWin(PLAYER_ONE));
    }

    // 4. Three-in-a-row is NOT a win (guards against off-by-one in the shifts).
    {
      const b = new Board();
      for (let i = 0; i < 3; i++) b.play(2, PLAYER_ONE);
      check('three-in-a-row is not a win', !b.isWin(PLAYER_ONE));
    }

    // 5. Full-board draw — replay a verified 42-move winless game (DRAW_SEQUENCE),
    //    alternating players, and confirm the result is a draw.
    {
      const b = Board.fromDrawSequence();
      check('draw board is full', b.isFull());
      check('draw board has no P1 win', !b.isWin(PLAYER_ONE));
      check('draw board has no P2 win', !b.isWin(PLAYER_TWO));
      check('draw board reports draw', b.isDraw());
    }

    // 6. Move generation — full column drops out of the legal-move list.
    {
      const b = new Board();
      check('all 7 columns legal at start', b.legalMoves().length === COLS);
      for (let i = 0; i < ROWS; i++) b.play(0, PLAYER_ONE);
      check('column 0 full -> not playable', !b.canPlay(0));
      check('6 columns legal after filling one', b.legalMoves().length === COLS - 1);
    }

    // 7. State round-trip — getState/restore reproduces stones and heights.
    {
      const b = new Board();
      for (const c of [3, 3, 4, 2, 5, 1]) b.play(c, b.moveCount % 2);
      const snapshot = b.getState();
      const r = new Board().restore(snapshot);
      check('restore reproduces stones',
        r.pieces[0] === b.pieces[0] && r.pieces[1] === b.pieces[1]);
      check('restore reproduces heights',
        r.heights.join(',') === b.heights.join(','));
      check('restore reproduces move count', r.moveCount === b.moveCount);
    }

    const passed = results.filter(r => r.pass).length;
    console.log(`Board.test(): ${passed}/${results.length} passed`);
    return passed === results.length;
  }

  /**
   * Build a full, winless board by replaying DRAW_SEQUENCE with alternating
   * players (move i is played by player i % 2), exactly as a real game would.
   */
  static fromDrawSequence() {
    const b = new Board();
    DRAW_SEQUENCE.forEach((col, i) => b.play(col, i % 2));
    return b;
  }
}

// A verified full-board draw: 42 alternating moves (column indices) that fill
// the board with no four-in-a-row ever formed. Found by exhaustive search and
// re-verified by Board.test()/Game.test().
export const DRAW_SEQUENCE = [
  3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4,
  0, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0,
  6, 6, 6, 6, 6, 6,
];

export default Board;
