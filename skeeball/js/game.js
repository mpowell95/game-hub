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
    // THE ONE-SHOT FACE, for HOT SHOT: RUNAWAY (skeeball/js/machines/runaway/). Slot ids that
    // have already been landed in this rack: their collars are not built and they never capture
    // again, so a later ball rolls straight over a flat plate. Empty on every other machine,
    // which never writes to it, and empty at the start of every rack.
    this.closed = [];
    // THE BASKETS THAT ARE CURRENTLY MOVING, keyed by hole id. Empty until a row is down to its
    // LAST OPEN BASKET; each entry is
    //   { hole, t0, dir, amp, period, mode, catches }
    // saying when that basket came off its mark, which way it set off, how far and how fast it
    // sweeps, and how it started (machine.js has two modes, one for a survivor standing at an end
    // of the travel and one for a survivor standing at the centre). Up to THREE at once: the top
    // row's runaway plus the last basket standing in each lower row.
    //
    // GUARD: THIS OBJECT IS SHARED BY REFERENCE with every ball in the air (physics.js's
    // startThrow holds it, it does not copy it) and with the renderer. That is what keeps ONE
    // machine on the screen: two balls can be live at once in two separate cannon worlds, and
    // they agree only because all three readers evaluate the same pure functions against this
    // same object. MUTATE IT IN PLACE, never swap in a fresh object once a ball is live.
    this.sweeps = {};
    // How many balls this rack has landed in the TOP ROW's basket while it was running. This is
    // the only honest measure of the machine's headline shot, and it needs its own counter
    // because nothing else can express it: the two 100s are ordinary static baskets on ball 1, so
    // a `bestThrow` of 100 no longer proves the sweep was ever beaten.
    this.runawayCatches = 0;
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
    // The one-shot face and the runaway survive a resume, so leaving mid-rack cannot hand back a
    // machine with its baskets re-opened or its 100 parked. Both are ADDITIVE keys, absent from
    // every save written before this shipped, and both read back as "fresh face, nothing moving"
    // - which is exactly right for a machine that has neither. THE LAW rule 5.
    //
    // Read back defensively and against the board's OWN holes: a slot id that no longer exists is
    // dropped rather than trusted, so a save cannot close a basket the machine does not have.
    {
      const holes = (g.board && g.board.geom && g.board.geom.holes) || {};
      g.closed = Array.isArray(snap.closed)
        ? [...new Set(snap.closed.map(String).filter((h) => holes[h]))] : [];
      g.runawayCatches = Math.max(0, snap.runawayCatches | 0);
      // Every sweep is read back against the board's OWN holes and dropped if the hole is gone
      // or the record is malformed, so a save can never start a basket the machine does not have.
      // A save written before this shipped has none, which reads as "nothing moving" - exactly
      // right for a machine that has no movers.
      const mv = (g.board && g.board.geom && g.board.geom.mover) || null;
      const raw = snap.sweeps && typeof snap.sweeps === 'object' ? snap.sweeps : {};
      g.sweeps = {};
      for (const id of Object.keys(raw)) {
        const s = raw[id];
        if (!s || typeof s !== 'object' || !holes[id] || !mv) continue;
        if (!Number.isFinite(s.period) || !(s.period > 0)) continue;
        if (!Number.isFinite(s.amp) || !(s.amp > 0)) continue;
        g.sweeps[id] = {
          hole: id,
          t0: Number.isFinite(s.t0) ? s.t0 : 0,
          dir: s.dir < 0 ? -1 : 1,
          amp: s.amp,
          period: s.period,
          mode: s.mode === 'ramp' ? 'ramp' : 'cos',
          catches: Math.max(0, s.catches | 0),
        };
      }
    }
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
      // Same contract: two more additive keys, absent on every save written before RUNAWAY's
      // one-shot face existed, and empty/null on every machine that does not have one.
      closed: this.closed.slice(),
      sweeps: Object.fromEntries(Object.entries(this.sweeps).map(([k, v]) => [k, { ...v }])),
      runawayCatches: this.runawayCatches,
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
    // `t0` is the rack clock at the instant of release; `closed` and `sweeps` are the shape of
    // the face right now. All three are ignored by every other machine's startThrow.
    //
    // GUARD: `sweeps` GOES BY REFERENCE, ON PURPOSE. It can change while this ball is still in
    // the air - close a row's second basket with another ball already thrown and the survivor
    // comes off its mark mid-flight. Sharing the object is what keeps the ball, any other live
    // ball, and the renderer looking at ONE machine. `closed` is passed as a Set built here,
    // which physics.js only reads.
    this.balls.push(engineFor(this.board.id, { physics: true }).physics.startThrow(
      this.board,
      { ...params, t0: this.machineT, closed: new Set(this.closed), sweeps: this.sweeps },
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
      const P = engineFor(this.board.id, { physics: true }).physics;
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
    // THE FACE REACTS TO THE BALL. Scored first, reconfigured after: what this ball was worth is
    // decided by the machine it was thrown at, never by the machine it leaves behind.
    this._reshape(outcome.hole);
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

  /** HOT SHOT: RUNAWAY's one-shot face, and nothing else in the repo. A ball has just settled in
   *  `hole`; decide what that does to the machine.
   *
   *    - the top row's runaway   NEVER closes. It ESCALATES: one rung down the period ladder,
   *                              every time it is caught.
   *    - any other basket        CLOSES. It pays once a rack and then plates over.
   *    - and then EVERY ROW IS RE-CHECKED: a row down to its LAST OPEN BASKET sets that basket
   *                              sweeping, whichever of the three it is.
   *
   *  The top row is a `rows` group of two, so it reaches "one left" after a single ball; the
   *  lower rows are three, so they take two. One rule covers all of them.
   *
   *  GUARD: EVERY MACHINE WITHOUT `geom.mover` LEAVES HERE ON THE FIRST LINE. This is a per-board
   *  rule living in the shared rules file (the same way the equalizer and the negative-score
   *  floor do), and an engine rule with no gate hits every machine by default.
   *
   *  GUARD: A MISS CLOSES NOTHING. `gutter` and `corner0` are outcomes, not baskets, so the
   *  `holes[hole]` test drops them - otherwise throwing balls away would reshape the face.
   *
   *  GUARD: THE ESCALATION RE-ANCHORS WITH THE PHASE PRESERVED. The basket is somewhere in the
   *  middle of its stroke when you catch it, not at an end, so recomputing `t0` naively would
   *  teleport it to a turnaround. Solving for the t0 that keeps the current phase angle under the
   *  NEW period leaves its position exactly where it is and only changes how fast it is going -
   *  which is the whole point of the rung. */
  _reshape(hole) {
    const G = this.board.geom;
    const cfg = G.mover;
    if (!cfg || !Array.isArray(cfg.holes)) return;      // not this machine
    if (!G.holes[hole]) return;                          // a miss is not a basket
    const isTop = cfg.holes.indexOf(hole) >= 0;

    // CATCHING A MOVING BASKET, whichever row it was on. Matt, 2026-08-27, asked whether the
    // objective meant the top row or any row and chose ANY: this machine's identity is baskets
    // that run away, not one basket that does. A row survivor counts exactly as much as the 100.
    if (this.sweeps[hole]) this.runawayCatches += 1;

    // THE TOP ROW'S RUNAWAY: it does not close, it speeds up. Every other moving basket is still
    // a one-shot and falls through to the close below, which also ends its sweep.
    if (isTop && this.sweeps[hole]) {
      const s = this.sweeps[hole];
      const next = cfg.periods[Math.min(s.catches + 1, cfg.periods.length - 1)];
      const theta = (2 * Math.PI * (this.machineT - s.t0)) / s.period;   // where it is, in radians
      s.t0 = this.machineT - (theta * next) / (2 * Math.PI);             // same angle, new period
      s.period = next;
      s.catches += 1;
      this.events.push({ type: 'runaway', hole, period: next, catches: s.catches });
      return;
    }

    if (this.closed.indexOf(hole) < 0) this.closed.push(hole);
    // A closed basket is not a moving basket. Catching a row's last one empties that row.
    delete this.sweeps[hole];
    this.events.push({ type: 'closed', hole });

    this._checkRows();
  }

  /** LAST ONE STANDING. Every `rows` group with exactly one basket still open sets that basket
   *  sweeping, if it is not already.
   *
   *  Matt, 2026-08-27: "when there's 1 basket left, regardless of which one it is, it starts
   *  moving." The top row is the same rule with a group of two, which is why the twin 100s need
   *  no special case here.
   *
   *  GUARD: THE MODE DEPENDS ON WHERE THE SURVIVOR IS STANDING, and both modes exist for one
   *  reason - a basket must come off its mark AT its mark and at ZERO SPEED. An OUTER basket
   *  rests at +/-amp, which is an end of the travel, so a cosine anchored now does both for free.
   *  A CENTRE basket rests at 0, which no cosine can start from, and a plain sine would be at its
   *  mark but at MAXIMUM speed - a step change in wall velocity handed to anything touching the
   *  rim. It gets machine.js's RAMPED sine instead, which winds up to the full travel over its
   *  first period. See machine.js for the maths.
   *
   *  GUARD: never restarts a sweep that is already running. `t0` is what anchors the motion, so
   *  rewriting it mid-stroke would teleport the basket. */
  _checkRows() {
    const G = this.board.geom;
    const cfg = G.mover;
    const rows = Array.isArray(cfg.rows) ? cfg.rows.slice() : [];
    // The top row plays by the same rule, with a group of two.
    if (Array.isArray(cfg.holes)) rows.push(cfg.holes);
    for (const row of rows) {
      const open = row.filter((h) => G.holes[h] && this.closed.indexOf(h) < 0);
      if (open.length !== 1) continue;
      const id = open[0];
      if (this.sweeps[id]) continue;
      const isTop = cfg.holes.indexOf(id) >= 0;
      const u = G.holes[id].u;
      const outer = Math.abs(u) > 1e-6;
      this.sweeps[id] = {
        hole: id,
        t0: this.machineT,
        dir: outer ? (u < 0 ? -1 : 1) : 1,
        amp: cfg.amp,
        period: isTop ? cfg.periods[0] : (cfg.rowPeriod || cfg.periods[0]),
        mode: outer ? 'cos' : 'ramp',
        catches: 0,
      };
      this.events.push({
        type: 'runaway', hole: id, period: this.sweeps[id].period, catches: 0, top: isTop,
      });
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
      // RUNAWAY's headline shot: balls caught in ANY basket WHILE IT WAS SWEEPING - the top row's
      // 100 or a lower row's last one standing. recordSkeeball adds it into sk.runaways, a
      // lifetime counter, and skeeball/js/goals.js's first RUNAWAY objective reads it. 0 on every
      // other machine, which never sets it.
      //
      // GUARD: A COUNTER, NOT A FLAG, and not the same thing as landing a basket. Nothing on this
      // machine is moving on ball 1, so only a landing AFTER that basket's row is down to one
      // counts. bestThrow and slotsHit cannot tell those apart and must not be asked to.
      runaways: this.runawayCatches,
      // EVERY BASKET IN ONE ROUND (Matt's objective, 2026-08-27). On a face where each basket
      // CLOSES when you hit it, covering all of them means one scoring ball into every basket the
      // machine has - and the last one in each row is sweeping by the time you reach it.
      // recordBoardGame counts it into the PER-BOARD record (js/arcade-scores.js), never a global
      // counter: "every basket" means a different thing on every machine.
      //
      // GUARD: measured against the board's OWN holes, so it cannot be satisfied by a machine with
      // fewer baskets, and `slotsHit` already excludes the trough - you cannot complete it by
      // missing.
      fullRack: Object.keys(holes).length > 0 && slotsHit.length >= Object.keys(holes).length ? 1 : 0,
    };
  }

  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export default { SkeeballGame, BALLS_PER_GAME };
