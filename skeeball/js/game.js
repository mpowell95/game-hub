// skeeball/js/game.js - the rules of one game (a "rack") on one machine. Pure: no DOM, no
// storage, no clock of its own. Nine balls, every settled ball scores its hole's value, and when
// the ninth settles the rack is over and `result()` is exactly the payload `recordSkeeball` in
// js/game-stats.js expects. The ui owns WHEN to persist; this file owns WHAT is true.
//
// Snapshots: `snapshot()` captures the between-throws state (never a ball in flight - the lane is
// the stable state of skeeball, and a throw resolves in under two seconds). `SkeeballGame.restore`
// rebuilds a game from one. The ui saves after every settled ball, which is what makes leaving
// mid-rack lossless (the hub contract's autosave/resume class, root CLAUDE.md).

import { startThrow, step, takeEvents } from './physics.js';
import { boardById, BALLS_PER_GAME } from './boards.js';

export { BALLS_PER_GAME };

export class SkeeballGame {
  constructor(boardId) {
    this.board = boardById(boardId);
    this.score = 0;
    this.ballsUsed = 0;              // settled balls; a returned short roll is not spent
    this.throws = [];                // { value, hole } per settled ball, in order
    this.hundreds = 0;
    this.fifties = 0;
    this.bestThrow = 0;
    this.ball = null;                // live physics state, or null while a ball waits on the lane
    this.over = false;
    this.events = [];
  }

  static restore(snap) {
    const g = new SkeeballGame(snap && snap.board);
    if (!snap || typeof snap !== 'object') return g;
    g.score = snap.score | 0;
    g.ballsUsed = Math.min(BALLS_PER_GAME, Math.max(0, snap.ballsUsed | 0));
    g.throws = Array.isArray(snap.throws)
      ? snap.throws.slice(0, g.ballsUsed).map((t) => ({ value: t.value | 0, hole: String(t.hole || 'gutter') }))
      : [];
    g.hundreds = snap.hundreds | 0;
    g.fifties = snap.fifties | 0;
    g.bestThrow = snap.bestThrow | 0;
    g.over = g.ballsUsed >= BALLS_PER_GAME;
    return g;
  }

  snapshot() {
    return {
      v: 1,
      board: this.board.id,
      score: this.score,
      ballsUsed: this.ballsUsed,
      throws: this.throws.map((t) => ({ value: t.value, hole: t.hole })),
      hundreds: this.hundreds,
      fifties: this.fifties,
      bestThrow: this.bestThrow,
    };
  }

  ballsLeft() { return BALLS_PER_GAME - this.ballsUsed; }
  canThrow() { return !this.over && !this.ball; }

  /** Roll one ball. power 0..1, aim -1..1 (see physics.js). */
  throwBall(params) {
    if (!this.canThrow()) return false;
    this.ball = startThrow(this.board, params);
    this.events.push({ type: 'throw' });
    return true;
  }

  update(dt) {
    if (!this.ball) return;
    const ball = this.ball;
    step(this.board, ball, dt);
    for (const ev of takeEvents(ball)) {
      // Physics events pass through for the renderer, and the rules react to the two that matter:
      // 'done' (the ball settled in a hole or the gutter) and 'returned' (it rolled back home,
      // which resolves the throw without spending the ball).
      this.events.push(ev);
      if (ev.type === 'done' || ev.type === 'returned') this._settle(ball.outcome);
    }
  }

  _settle(outcome) {
    this.ball = null;
    if (!outcome) {
      // Rolled back to the player: the ball is not spent, no score changes.
      this.events.push({ type: 'ballBack' });
      return;
    }
    const value = outcome.value | 0;
    this.ballsUsed += 1;
    this.score += value;
    this.throws.push({ value, hole: outcome.hole });
    if (value === 100) this.hundreds += 1;
    if (value === 50) this.fifties += 1;
    this.bestThrow = Math.max(this.bestThrow, value);
    this.events.push({
      type: 'ballDone',
      value, hole: outcome.hole,
      score: this.score, ballsLeft: this.ballsLeft(),
    });
    if (this.ballsUsed >= BALLS_PER_GAME) {
      this.over = true;
      this.events.push({ type: 'rackOver', result: this.result() });
    }
  }

  /** The recorder payload: exactly what recordSkeeball(boardId, extras) wants, `at` supplied by
   *  the caller so tests are not clock-dependent (js/game-stats.js documents the shape). */
  result() {
    return {
      score: this.score,
      balls: this.ballsUsed,
      hundreds: this.hundreds,
      fifties: this.fifties,
      bestThrow: this.bestThrow,
    };
  }

  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export default { SkeeballGame, BALLS_PER_GAME };
