// game.js — Connect Four turn state machine (Session 1: engine only)
//
// Wraps the bitboard Board with the rules of play: whose turn it is, which
// moves are legal, game-over detection (win / draw), and a move history. The
// Board knows nothing about turns; this layer owns that.

import { Board, PLAYER_ONE, PLAYER_TWO, DRAW_SEQUENCE } from './board.js';

// Game status values.
export const PLAYING = 'playing';
export const WIN = 'win';
export const DRAW = 'draw';

export class Game {
  /**
   * @param {number} firstPlayer  Who moves first (PLAYER_ONE or PLAYER_TWO).
   *   Who goes first matters a lot in Connect Four, so it is configurable.
   */
  constructor(firstPlayer = PLAYER_ONE) {
    this.reset(firstPlayer);
  }

  reset(firstPlayer = PLAYER_ONE) {
    this.board = new Board();
    this.firstPlayer = firstPlayer;
    this.currentPlayer = firstPlayer;
    this.status = PLAYING;
    this.winner = null;        // player index when status === WIN, else null
    this.history = [];         // list of columns played, in order
    return this;
  }

  /** Columns the current player may legally play (empty array once over). */
  legalMoves() {
    return this.status === PLAYING ? this.board.legalMoves() : [];
  }

  /** True once the game has ended (win or draw). */
  isOver() {
    return this.status !== PLAYING;
  }

  /**
   * Play `col` for the current player. Updates the board, history, and status,
   * and advances the turn unless the game just ended. Returns the new status.
   * Throws if the game is already over or the move is illegal.
   */
  play(col) {
    if (this.isOver()) {
      throw new Error(`Cannot play: game is over (${this.status})`);
    }
    if (!this.board.canPlay(col)) {
      throw new Error(`Illegal move: column ${col} is full or out of range`);
    }

    const mover = this.currentPlayer;
    this.board.play(col, mover);
    this.history.push(col);

    if (this.board.isWin(mover)) {
      this.status = WIN;
      this.winner = mover;
    } else if (this.board.isFull()) {
      this.status = DRAW;
    } else {
      this.currentPlayer = mover ^ 1;   // swap 0 <-> 1
    }
    return this.status;
  }

  /** Snapshot of the full game state (board position + turn/status/history). */
  getState() {
    return {
      position: this.board.getState(),
      currentPlayer: this.currentPlayer,
      firstPlayer: this.firstPlayer,
      status: this.status,
      winner: this.winner,
      history: this.history.slice(),
    };
  }

  // --- Headless tests -------------------------------------------------------

  /**
   * Scripted tests for the turn machine: a vertical / horizontal / diagonal
   * win reached through real alternating play, a full-board draw, turn
   * alternation, history tracking, and illegal-move / play-after-over
   * rejection. Logs pass/fail per case and returns true iff all pass.
   */
  static test() {
    const results = [];
    const check = (name, cond) => {
      results.push({ name, pass: !!cond });
      console.log(`${cond ? 'PASS' : 'FAIL'}  Game: ${name}`);
    };

    // Helper: play a list of columns into a fresh game.
    const playAll = (cols, firstPlayer = PLAYER_ONE) => {
      const g = new Game(firstPlayer);
      for (const c of cols) g.play(c);
      return g;
    };

    // 1. Vertical win for P1 (P1 stacks col 3; P2 answers in col 0).
    {
      const g = playAll([3, 0, 3, 0, 3, 0, 3]);
      check('vertical win ends game', g.status === WIN);
      check('vertical win winner is P1', g.winner === PLAYER_ONE);
      check('current player stays the winner', g.currentPlayer === PLAYER_ONE);
    }

    // 2. Horizontal win for P1 across cols 0..3 (P2 stacks col 6).
    {
      const g = playAll([0, 6, 1, 6, 2, 6, 3]);
      check('horizontal win ends game', g.status === WIN);
      check('horizontal win winner is P1', g.winner === PLAYER_ONE);
    }

    // 3. Diagonal win for P1: P1 builds (0,0)(1,1)(2,2)(3,3).
    //    Moves below alternate P1/P2 legally and end on P1's diagonal stone.
    {
      const g = playAll([0, 1, 1, 2, 3, 2, 2, 3, 3, 6, 3]);
      check('diagonal win ends game', g.status === WIN);
      check('diagonal win winner is P1', g.winner === PLAYER_ONE);
    }

    // 4. Full-board draw via the verified DRAW_SEQUENCE.
    {
      const g = playAll(DRAW_SEQUENCE);
      check('draw sequence reaches draw', g.status === DRAW);
      check('draw has no winner', g.winner === null);
      check('draw used all 42 moves', g.history.length === 42);
      check('no legal moves after draw', g.legalMoves().length === 0);
    }

    // 5. Turn alternation and history tracking on a quiet opening.
    {
      const g = playAll([3, 3, 4]);
      check('turn alternates back to P2', g.currentPlayer === PLAYER_TWO);
      check('history recorded in order', g.history.join(',') === '3,3,4');
      check('game still in progress', g.status === PLAYING);
    }

    // 6. "Who goes first" is configurable.
    {
      const g = new Game(PLAYER_TWO);
      check('first player honored', g.currentPlayer === PLAYER_TWO);
      g.play(3);
      check('turn passes to P1', g.currentPlayer === PLAYER_ONE);
    }

    // 7. Illegal moves and playing after game-over are rejected.
    {
      const g = new Game();
      for (let i = 0; i < 6; i++) g.play(0);   // fill column 0
      let threwFull = false;
      try { g.play(0); } catch { threwFull = true; }
      check('full column rejected', threwFull);

      let threwRange = false;
      try { g.play(99); } catch { threwRange = true; }
      check('out-of-range column rejected', threwRange);

      const won = playAll([3, 0, 3, 0, 3, 0, 3]);   // P1 already won
      let threwOver = false;
      try { won.play(1); } catch { threwOver = true; }
      check('play after game over rejected', threwOver);
    }

    const passed = results.filter(r => r.pass).length;
    console.log(`Game.test(): ${passed}/${results.length} passed`);
    return passed === results.length;
  }
}

export default Game;
