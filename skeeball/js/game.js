// skeeball/js/game.js - the rules of one game (a "rack") on one machine. Pure: no DOM, no
// storage, no clock of its own. Nine balls, every settled ball scores its hole's value, and
// `result()` is exactly the payload `recordSkeeball` in js/game-stats.js expects. The ui owns
// WHEN to persist; this file owns WHAT is true.
//
// "No clock of its own" still holds, and `machineT` below is not a hole in it: this file never
// READS a clock, it only accumulates the `dt` its caller already hands `update()`. Same dt in,
// same machineT out - which is what keeps a machine with a moving part deterministic and
// replayable. See "The moving basket" in skeeball/CLAUDE.md.
//
// `snapshot()` captures only the between-throws state, never a ball in flight - that is what
// makes leaving mid-rack lossless (the hub contract's autosave/resume class, root CLAUDE.md).
// `SkeeballGame.restore` rebuilds a game from one.

import { engineFor } from './engines.js';
import { boardById, BALLS_PER_GAME, cupAt, scoringColors } from './boards.js';

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
    // LIVE THROWS, oldest first. More than one can be in the air: the next ball arrives when
    // the last one TOUCHES THE BOARD, not when it finishes settling, because settling can take up
    // to the 12s emergency cap and nobody should ever wait that long to throw again (Matt,
    // 2026-08-20). `ball` below still answers "is anything in flight" for everything that only
    // needs to know that.
    this.balls = [];
    // Balls SENT. This is what the nine-ball limit counts, NOT ballsUsed - with two in the air,
    // counting settled balls would let a tenth be thrown while the ninth was still rolling. A
    // ball that comes back unspent is subtracted again in _settle.
    this.thrown = 0;
    this.over = false;
    this.events = [];
    // THE RACK CLOCK, for machines with a MOVING PART (HOT SHOT: RUNAWAY's sliding 100 basket -
    // skeeball/js/machines/runaway/). Seconds since this rack began, advanced ONLY by the dt
    // handed to update().
    //
    // GUARD: ONE CLOCK, THREE READERS, AND THEY MUST BE THE SAME ONE. Every throw builds its own
    // cannon world (physics.js) and more than one ball can be in the air at a time, so the two
    // live sims and the renderer are three independent things that each need to know where the
    // basket is. They agree because all three are pure functions of THIS number: throwBall hands
    // it to startThrow as `t0`, and render() reads `game.machineT` directly. Give any of them a
    // clock of its own and the basket the ball hits stops being the basket on screen.
    //
    // Zero on every other machine, which never reads it.
    this.machineT = 0;
  }

  static restore(snap) {
    const g = new SkeeballGame(snap && snap.board);
    if (!snap || typeof snap !== 'object') return g;
    g.score = snap.score | 0;
    g.ballsUsed = Math.min(BALLS_PER_GAME, Math.max(0, snap.ballsUsed | 0));
    g.throws = Array.isArray(snap.throws)
      ? snap.throws.slice(0, g.ballsUsed).map((t) => ({
        value: t.value | 0,
        hole: String(t.hole || 'gutter'),
        // `earned` arrived with the equalizer (2026-08-22): what this ball still contributes to
        // the score after any later equalizer wiped it. Old saves predate it - there the ball
        // still holds everything it scored.
        earned: Number.isFinite(t.earned) ? t.earned | 0 : t.value | 0,
      }))
      : [];
    g.hundreds = snap.hundreds | 0;
    g.fifties = snap.fifties | 0;
    g.bestThrow = snap.bestThrow | 0;
    // The rack clock survives a resume so a moving basket picks up mid-sweep instead of jumping
    // back to the centre of its travel. Absent in every save written before RUNAWAY existed,
    // which reads as 0 - the centre - and is exactly right for a machine that has no mover.
    g.machineT = Number.isFinite(snap.machineT) ? Math.max(0, snap.machineT) : 0;
    g.over = g.ballsUsed >= BALLS_PER_GAME;
    // A snapshot is only ever written with nothing in the air (ui.js checks), so every ball that
    // was thrown has also settled.
    g.thrown = g.ballsUsed;
    return g;
  }

  snapshot() {
    return {
      v: 1,
      board: this.board.id,
      score: this.score,
      ballsUsed: this.ballsUsed,
      throws: this.throws.map((t) => ({ value: t.value, hole: t.hole, earned: t.earned })),
      hundreds: this.hundreds,
      fifties: this.fifties,
      bestThrow: this.bestThrow,
      // ADDITIVE, and read back defensively (see restore): an old save has no machineT and
      // resumes at 0. THE LAW rule 5 - this adds a key, it repurposes nothing.
      machineT: this.machineT,
    };
  }

  ballsLeft() { return BALLS_PER_GAME - this.ballsUsed; }

  /** The oldest throw still in the air, or null. Kept because most callers only ask "is a ball
   *  live?", and it means the renderer, the tests and the how-to demo did not all need rewriting
   *  when a second ball became possible. */
  get ball() { return this.balls[0] || null; }

  canThrow() {
    if (this.over || this.thrown >= BALLS_PER_GAME) return false;
    const last = this.balls[this.balls.length - 1];
    return !last || !!last.arrived;   // physics.js sets this on the first contact at the board end
  }

  /** Roll one ball. power 0..1, aim -1..1 (see physics.js). */
  throwBall(params) {
    if (!this.canThrow()) return false;
    // `t0` is the rack clock at the instant of release: where a machine with a moving part had
    // its basket when this ball left the ramp. Ignored by every other machine's startThrow.
    this.balls.push(engineFor(this.board.id).physics.startThrow(
      this.board, { ...params, t0: this.machineT },
    ));
    this.thrown += 1;
    this.events.push({ type: 'throw' });
    return true;
  }

  update(dt) {
    // GUARD: BEFORE the early return, not after. The basket keeps sweeping while the player is
    // standing there deciding - that is the whole game on a machine with a mover, and a clock
    // that only ran while a ball was in the air would freeze the target between throws.
    this.machineT += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (!this.balls.length) return;
    // A COPY: _settle removes from this.balls while we are walking it.
    for (const ball of this.balls.slice()) {
      const P = engineFor(this.board.id).physics;
      P.step(this.board, ball, dt);
      for (const ev of P.takeEvents(ball)) {
        // Physics events pass through for the renderer, and the rules react to the two that
        // matter: 'done' (the ball settled in a hole or the gutter) and 'returned' (it rolled
        // back home, which resolves the throw without spending the ball).
        this.events.push(ev);
        if (ev.type === 'done' || ev.type === 'returned') this._settle(ball, ball.outcome);
      }
    }
  }

  _settle(ball, outcome) {
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
    if (!outcome) {
      // Rolled back to the player: the ball is not spent, no score changes - and it goes back on
      // the count, so the player gets to throw it again.
      this.thrown -= 1;
      this.events.push({ type: 'ballBack' });
      return;
    }
    // THE ARRANGEMENT LAYER: physics reports the SLOT; the cup sitting in it (boards.js's
    // `arrangement`) decides what that is worth. On a board with no cups (THE CLASSIC) the cup
    // is null and the hole's own value stands - identical numbers today, since boards.js stamps
    // hole values FROM the arrangement, but scoring through the cup is what lets a future
    // rearrangement be a data change instead of an engine change.
    const cup = cupAt(this.board, outcome.hole);
    let value = cup ? cup.value | 0 : outcome.value | 0;
    // THE EQUALIZER (Popongo's black cups): landing here wipes whatever the immediately previous
    // ball EARNED this rack - its `earned`, not its printed value, so an already-wiped ball (or
    // a previous equalizer) has nothing left to lose and wipes as zero. The real game's rule,
    // solo-adapted; the wipe itself is worth nothing and cannot go below what the previous ball
    // actually contributed, so the score can never go negative.
    let eq = false;
    let wiped = 0;
    if (cup && cup.effect === 'equalizer') {
      eq = true;
      value = 0;
      const prev = this.throws[this.throws.length - 1];
      if (prev && (prev.earned | 0) > 0) {
        wiped = prev.earned | 0;
        this.score -= wiped;
        prev.earned = 0;
      }
    }
    this.ballsUsed += 1;
    this.score += value;
    // A RACK NEVER FINISHES BELOW ZERO (2026-08-24, with BRICK CITY's penalty row - the first
    // machine whose cups carry NEGATIVE values). Without this floor the screen and the record
    // would disagree: `recordSkeeball` in js/game-stats.js clamps with Math.max(0, e.score | 0),
    // so a rack shown as -40 would be filed as 0 and the player would be told two different
    // things about the same nine balls. Matt's call, asked and answered the day the machine was
    // built: penalties eat what you have earned, they do not put you in debt. Clamping HERE (the
    // one place that owns what is true) rather than loosening the recorder keeps that a display
    // question rather than a THE LAW question - nothing recorded ever changes shape.
    // GUARD: every board without negative cups is untouched by this line, because their scores
    // never go under zero in the first place.
    if (this.score < 0) this.score = 0;
    this.throws.push({ value, hole: outcome.hole, earned: value });
    // GUARD: hundreds/fifties are THE CLASSIC's counters (the global sk.hundreds feeds its
    // five-100s goal, and Matt ruled machines "completely distinct", 2026-08-22). A cup board
    // paying 100 or 50 (HOT SHOT's top row) counts those landings in its own per-board
    // record (sk.boards.<id>), never here.
    if (!this.board.cups) {
      if (value === 100) this.hundreds += 1;
      if (value === 50) this.fifties += 1;
    }
    this.bestThrow = Math.max(this.bestThrow, value);
    this.events.push({
      type: 'ballDone',
      value, hole: outcome.hole, eq, wiped,
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
    // tens..forties are COUNTED FROM this.throws rather than kept as four more running counters,
    // so they need no place in the snapshot - `throws` is already in it, so they survive a
    // resume for free. hundreds/fifties keep their existing counters; they predate this.
    const by = (v) => this.throws.reduce((n, t) => n + (t.value === v ? 1 : 0), 0);
    // GUARD: `by` matches EXACT values, so BRICK CITY's -10 and -20 balls land in no counter at
    // all, and that is deliberate. tens/twenties/thirties/forties are the "every point value"
    // counters (js/game-stats.js's sk block, merged cross-device by js/players-agg.js); they
    // count points EARNED. Folding a -20 into `twenties` would make a penalty read as a 20 in My
    // Stats and on the leaderboard, and giving penalties their own counters would be three new
    // additive keys plus the three-edit rule for each, for a number nothing asks for. If a
    // machine ever needs "penalties taken", add it then as its own counter - do not overload
    // these.
    // The cup-board extras: how many distinct scoring COLORS this rack has landed, and whether
    // that is all of them (POPONGO's "all four colors in one game" objective - js/goals.js reads
    // colorsHit live, recordSkeeball counts colorSweep into sk.colorSweeps). Both stay 0 on a
    // board with no cups.
    const colors = new Set();
    if (this.board.cups) {
      for (const th of this.throws) {
        const cup = cupAt(this.board, th.hole);
        if (cup && (cup.value | 0) > 0) colors.add(cup.color);
      }
    }
    const need = scoringColors(this.board).size;
    // WHICH baskets this rack landed in, as slot ids, and whether the rack was CLEAN. Both feed
    // BRICK CITY's objectives (js/goals.js) through the per-board record, so they are per-machine
    // by construction and no machine can satisfy another's version of them.
    //
    // `slotsHit` counts only real holes: the trough's `gutter` and `corner0` are outcomes, not
    // baskets, and "hit every basket" must not be completable by missing.
    const holes = this.board.geom.holes || {};
    const slotsHit = [...new Set(this.throws.map((th) => th.hole).filter((h) => holes[h]))];
    // A CLEAN RACK: all nine balls thrown, points on the board, and not one ball in a basket that
    // takes points away.
    //
    // GUARD: gated on the board actually HAVING a penalty basket, the same way colorSweep is
    // gated on need > 1. On a machine where nothing can cost you points every scoring rack is
    // trivially "clean", and a counter that every machine feeds means nothing on the one machine
    // that asks the question.
    //
    // GUARD: `score > 0` is the half Matt asked for in so many words - you cannot pass this by
    // throwing all nine balls away for zeros and never touching a penalty. Doing nothing is not
    // a clean rack.
    const hasPenalty = Object.values(this.board.cups || {}).some((c) => (c.value | 0) < 0);
    // HOW MANY TIMES each basket was landed this round, not just which ones. BRICK CITY's first
    // objective is "hit every basket THREE times" (Matt, 2026-08-25), and a set cannot answer
    // that. Same `holes` filter as slotsHit, for the same reason: the trough is not a basket.
    const slotCounts = {};
    for (const th of this.throws) {
      if (holes[th.hole]) slotCounts[th.hole] = (slotCounts[th.hole] | 0) + 1;
    }
    // A PERFECT ROUND: all nine balls thrown and EVERY ONE of them scored - no zeros and no
    // penalties. Matt's definition, 2026-08-25, in those words. It is strictly harder than
    // cleanRack below, which lets a ball miss entirely as long as it does not cost points.
    //
    // GUARD: NOT gated on the board having a penalty basket, where cleanRack is. "Every ball
    // scored" is a real, hard statement on any machine - nine for nine into rings or cups is
    // never trivially true - so gating it would only hide a fact that is already honest.
    const perfectRack = this.ballsUsed >= BALLS_PER_GAME
      && this.throws.length >= BALLS_PER_GAME
      && this.throws.every((th) => (th.value | 0) > 0) ? 1 : 0;
    const cleanRack = hasPenalty
      && this.ballsUsed >= BALLS_PER_GAME
      && this.score > 0
      && this.throws.every((th) => (th.value | 0) >= 0) ? 1 : 0;
    return {
      score: this.score,
      balls: this.ballsUsed,
      slotsHit,
      slotCounts,
      cleanRack,
      perfectRack,
      tens: by(10),
      twenties: by(20),
      thirties: by(30),
      forties: by(40),
      hundreds: this.hundreds,
      fifties: this.fifties,
      bestThrow: this.bestThrow,
      colorsHit: colors.size,
      // GUARD: need > 1, not > 0. sk.colorSweeps is a GLOBAL counter and POPONGO's colors goal
      // reads it as "swept ever"; on a one-color cup board (HOT SHOT's all-orange hoops)
      // every scoring rack would trivially "sweep" and falsely complete that goal. A sweep of
      // one color is not a sweep.
      colorSweep: need > 1 && colors.size >= need ? 1 : 0,
    };
  }

  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export default { SkeeballGame, BALLS_PER_GAME };
