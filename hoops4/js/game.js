// hoops4/js/game.js - the rules of a MATCH. Pure: no DOM, no clock, no rng.
//
// The Connect 4 rules themselves are NOT reimplemented here. connect-four/js/board.js is a
// bitboard already running at exactly 7 x 6 with its own win detection and its own tests, so this
// imports it. That is the repo's "USE WHAT EXISTS" rule, and it is safe in a way sharing a
// skeeball ENGINE would not be: board.js is pure rules with no per-game tuning in it.
import { Board, COLS, ROWS, PLAYER_ONE, PLAYER_TWO } from '../../connect-four/js/board.js';

export { COLS, ROWS, PLAYER_ONE, PLAYER_TWO };
export const RED = PLAYER_ONE;
export const YELLOW = PLAYER_TWO;

export class Match {
  /** @param {object} opts  { vsCpu:boolean, cpuSkill:number, first:0|1 } */
  constructor(opts = {}) {
    this.board = new Board();
    this.vsCpu = !!opts.vsCpu;
    this.cpuSkill = opts.cpuSkill ?? 2;
    this.first = opts.first === 1 ? 1 : 0;
    this.turn = this.first;
    this.over = false;
    this.winner = null;         // 0 | 1 | null (null with over=true means a draw)
    this.winCells = null;
    this.shotsThisTurn = 0;
    this.shots = [0, 0];        // total shots taken, per player - the accuracy stat
    this.moves = [];            // { by, col, shots }
  }

  /** Which columns still have room. A shot into a FULL column is a miss (see `land`). */
  openColumns() { return this.board.legalMoves(); }

  isCpuTurn() { return this.vsCpu && this.turn === YELLOW && !this.over; }

  /** A shot was taken and went nowhere. THE TURN DOES NOT PASS. */
  miss() {
    if (this.over) return { type: 'miss' };
    this.shotsThisTurn++;
    this.shots[this.turn]++;
    return { type: 'miss', shots: this.shotsThisTurn };
  }

  /**
   * A ball went through hoop `col` (0-based). THIS IS THE MOVE, whether or not it was the hoop
   * the player meant - a rim-out into the next hoop counts, in THAT column.
   *
   * A shot into a FULL column cannot be a move (there is nowhere for the disc to go), so it is
   * scored as a miss and the player shoots again. That is the only case where going in is not a
   * move, and it is a rule about the BOARD rather than about the shot.
   */
  land(col) {
    if (this.over) return { type: 'over' };
    this.shotsThisTurn++;
    this.shots[this.turn]++;
    if (!this.board.canPlay(col)) {
      return { type: 'full', col, shots: this.shotsThisTurn };
    }
    const by = this.turn;
    const row = this.board.heights[col];
    this.board.play(col, by);
    this.moves.push({ by, col, shots: this.shotsThisTurn });

    if (this.board.isWin(by)) {
      this.over = true;
      this.winner = by;
      this.winCells = this._findWin(by);
      return { type: 'win', by, col, row, cells: this.winCells };
    }
    if (this.board.isFull()) {
      this.over = true;
      this.winner = null;
      return { type: 'draw', by, col, row };
    }
    this.turn = by === RED ? YELLOW : RED;
    this.shotsThisTurn = 0;
    return { type: 'move', by, col, row, next: this.turn };
  }

  /** The four cells that won it, for the screen to ring. */
  _findWin(player) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (this.board.cellAt(c, r) !== player) continue;
        for (const [dc, dr] of dirs) {
          const cells = [[c, r]];
          for (let k = 1; k < 4; k++) {
            const cc = c + dc * k, rr = r + dr * k;
            if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) break;
            if (this.board.cellAt(cc, rr) !== player) break;
            cells.push([cc, rr]);
          }
          if (cells.length === 4) return cells;
        }
      }
    }
    return null;
  }

  /** `cells[col][row]`, row 0 at the bottom - what render.js paints on the screen. */
  cells() {
    const out = [];
    for (let c = 0; c < COLS; c++) {
      out[c] = [];
      for (let r = 0; r < ROWS; r++) {
        const v = this.board.cellAt(c, r);
        out[c][r] = (v === RED || v === YELLOW) ? v : null;
      }
    }
    return out;
  }

  /** The payload the hub's recorder gets. Accuracy is the stat this game is actually about. */
  result() {
    const taken = this.shots[RED] + this.shots[YELLOW];
    return {
      won: this.winner === RED,
      lost: this.winner === YELLOW,
      tied: this.over && this.winner === null,
      discs: this.moves.length,
      shots: taken,
      myShots: this.shots[RED],
      myDiscs: this.moves.filter((m) => m.by === RED).length,
    };
  }
}

export default { Match, COLS, ROWS, RED, YELLOW };
