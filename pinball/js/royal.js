// pinball/js/royal.js - the rules for the ROYAL FLUSH board (pinball/js/table-royal.js).
//
// WHY THIS IS A SEPARATE CLASS AND NOT A BRANCH INSIDE game.js. game.js's rules are welded to
// STARHUB's shots: missions keyed off a scoop, a lock lit by five ramps, H-U-B lanes, a scripted
// habitrail with its own RAMP_PATH. Royal Flush has none of those - no scoop, no H-U-B, four drop
// banks instead of one, an upper right flipper, three ELEVATED RAMPS the ball actually climbs. Threading
// two shot maps through one 849-line class would put a board check on every rule in it and leave
// STARHUB one typo away from breaking. So this file is deliberately SMALL and deliberately DUMB:
// it is the same public surface ui.js already drives (start/update/setFlipper/plungerDown/
// plungerUp/nudge/hud/takeEvents/result/score/phase) over a much simpler rule set.
//
// THE BOARD IS IMPORTED WHOLE: all four layers, all 18 sensors, every colour. What is NOT here is
// their RULES - the Java Field9Delegate - which we are not taking. Scoring is the parts themselves,
// at the point values the source table carries. No missions, multiball, bonus or tilt yet.
//
// THE LAW: this class stores nothing. The only record of a score is recordPinball() in
// js/game-stats.js, exactly as STARHUB's is - see pinball/CLAUDE.md, "Persistence".
import { step, makeBall, PHYS_DT, BALL_R } from './physics.js';
import T, { buildLayer } from './table-royal.js';

const SAVE_SECS = 8;          // ball save at the start of every ball, as STARHUB's Standard does
const MAX_HOLD = 3;           // seconds; the held-ball invariant from pinball/CLAUDE.md
const DROP_RESET_SECS = 2;    // their table's own `reset` value on all four banks
const SEARCH_DIST = 22;       // units a ball must cover to count as "moving" - just over one ball
const SEARCH_SECS = 3;        // seconds parked inside that circle before the table shoves it
const SEARCH_VX = 210;        // sideways shove. At GRAVITY 80 a gentler one just re-parked it -
const SEARCH_VY = 150;        // the first try used 120/70 and the soak still logged 59 episodes.

export class RoyalPinball {
  constructor(opts = {}) {
    this.difficulty = 'medium';       // one board, one setting; kept so result() stays uniform
    this.rand = opts.rand || Math.random;
    this.events = [];
    this.reset();
  }

  reset() {
    this.down = new Set();            // drop-target keys currently knocked over
    this.retracted = new Set();       // retract-when-hit wall ids (their two ball savers)
    this._rebuild();
    this.balls = [];
    this.phase = 'attract';
    this.score = 0;
    this.ball = 1;
    this.ballsTotal = T.BALLS;
    this.time = 0;
    this.plungerPower = 0;
    this.plungerHeld = false;
    this.saveTimer = 0;
    this.dropTimers = [];
    this.rollLit = new Map();
    this.stats = { bumpers: 0, drops: 0, spins: 0, rollovers: 0, banks: 0, bestBall: 0 };
    this.ballScore = 0;
    this.events.length = 0;
  }

  /**
   * FOUR WORLDS, ONE PER LAYER. The source table is a playfield with three elevated ramps stacked
   * over it, and a ball on a ramp must touch that ramp's walls and NOTHING on the playfield below -
   * that separation is the entire difference between a ramp and a wall lying across the table. So
   * each layer gets its own collider set and each ball carries the layer it is on.
   *
   * Everything is REBUILT rather than mutated when a drop target falls or a wall retracts, the same
   * discipline table.js uses for STARHUB's bank.
   */
  _rebuild() {
    this.layers = [0, 1, 2, 3].map((n) => {
      const built = buildLayer(n, this.down, this.retracted);
      return {
        colliders: built.colliders, flippers: built.flippers,
        gravity: T.GRAVITY, drag: 0.04, nudgeX: 0, nudgeY: 0,
      };
    });
    // The playfield is where the flippers live, and ui.js and the renderer both read these.
    this.world = this.layers[0];
    this.colliders = this.layers[0].colliders;
    this.flippers = this.layers[0].flippers;
  }

  emit(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }

  // --- lifecycle ---------------------------------------------------------------------------------

  start() {
    this.reset();
    this.phase = 'ready';
    this._serve();
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: 1 }, big: true });
  }

  _serve() {
    const b = makeBall(T.PLUNGER.x, T.PLUNGER.y, 0, 0);
    b.onPlunger = true;
    b.layer = 0;                      // every ball is served onto the playfield
    this.balls.push(b);
    this.saveTimer = SAVE_SECS;
    this.ballScore = 0;
  }

  plungerDown() { if (this._plungerBall()) this.plungerHeld = true; }

  plungerUp() {
    const b = this._plungerBall();
    this.plungerHeld = false;
    if (!b) return;
    const p = this.plungerPower;
    this.plungerPower = 0;
    if (p <= 0.02) return;
    b.onPlunger = false;
    // Their launchVelocity is a straight up-the-lane shove with a small random delta, which is what
    // makes two full plunges land differently. Power scales it; the jitter is theirs.
    b.vy = -(T.PLUNGER.v * (0.45 + 0.55 * p) + (this.rand() - 0.5) * T.PLUNGER.jitter);
    b.vx = 0;
    this.phase = 'play';
    this.emit({ type: 'launch', power: p });
  }

  _plungerBall() { return this.balls.find((b) => b.onPlunger) || null; }

  setFlipper(side, down) {
    // Two lower flippers plus an UPPER RIGHT one. The upper flipper follows the right button,
    // which is how a real machine with a third flipper is wired.
    for (const f of this.flippers) {
      const isLeft = f.id.startsWith('flipL');
      if ((side === 'left') === isLeft) f.pressed = down;
    }
  }

  nudge(dir) {
    if (this.phase !== 'play') return;
    const ax = dir === 'left' ? -60 : dir === 'right' ? 60 : 0;
    const ay = dir === 'up' ? -50 : 0;
    for (const b of this.balls) { b.vx += ax; b.vy += ay; }
    this.emit({ type: 'nudge', dir });
  }

  // --- the frame ---------------------------------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (this.phase === 'over' || this.phase === 'attract') return;

    if (this.plungerHeld) this.plungerPower = Math.min(1, this.plungerPower + dt * 1.1);
    if (this.saveTimer > 0) this.saveTimer = Math.max(0, this.saveTimer - dt);

    for (let i = this.dropTimers.length - 1; i >= 0; i--) {
      this.dropTimers[i].t -= dt;
      if (this.dropTimers[i].t <= 0) {
        for (const k of this.dropTimers[i].keys) this.down.delete(k);
        this.dropTimers.splice(i, 1);
        this._rebuild();
      }
    }

    const steps = Math.max(1, Math.round(dt / PHYS_DT));
    for (let i = 0; i < steps; i++) {
      const held = this._plungerBall();
      if (held) { held.x = T.PLUNGER.x; held.y = T.PLUNGER.y; held.vx = 0; held.vy = 0; }
      // One step per layer, each with only the balls standing on it. Layer 0 is stepped even when
      // the ball is up a ramp, because that is where the flippers are and they still have to swing.
      for (let L = 0; L < this.layers.length; L++) {
        const on = this.balls.filter((b) => (b.layer | 0) === L);
        if (L !== 0 && !on.length) continue;
        step(this.layers[L], on, (kind, id, x, y, speed) => this._contact(kind, id, x, y, speed));
      }
      this._sensors();
      this._rollovers();
      this._drain();
    }
    this._ballSearch(dt);
  }

  /**
   * THE 18 SENSORS, and they come in two kinds - the difference is whether the source gave the
   * element a `ballLayer`.
   *
   *   - With one, the sensor MOVES the ball between levels: seven of them, an entry and an exit for
   *     each of the three ramps. This is how a ball gets onto a ramp and how it comes off.
   *   - Without one, it is an EVENT trigger, live only while the ball is on `ballLayerFrom` - the
   *     ramp enter/trigger/drop sensors their own rules use.
   *
   * A sensor fires on ENTRY only. `_inSensor` remembers which the ball was already inside, so a ball
   * that stops on top of one does not re-trigger it every step - the same edge-detection mistake
   * that let STARHUB's scoop bank 1.5 million in one shot (pinball/CLAUDE.md).
   */
  _sensors() {
    for (const b of this.balls) {
      if (b.onPlunger) continue;
      if (!b._inSensor) b._inSensor = new Set();
      for (let i = 0; i < T.SENSORS.length; i++) {
        const s = T.SENSORS[i];
        const inside = b.x >= s.x1 && b.x <= s.x2 && b.y >= s.y1 && b.y <= s.y2;
        const was = b._inSensor.has(i);
        if (!inside) { b._inSensor.delete(i); continue; }
        if (was) continue;
        b._inSensor.add(i);
        if (s.from !== null && (b.layer | 0) !== s.from) continue;
        if (s.to !== null) {
          b.layer = s.to;
          this.emit({ type: s.to === 0 ? 'rampexit' : 'ramp', x: b.x, y: b.y });
        } else if (s.id) {
          this.emit({ type: 'ramp', x: b.x, y: b.y, id: s.id });
        }
      }
    }
  }

  /**
   * BALL SEARCH. This board is imported geometry, not geometry we shaped, so it has pockets we did
   * not design and cannot simply widen: 583 segments meeting at whatever angles their layout has,
   * on frictionless surfaces, at a twentieth of STARHUB's gravity. The first soak of the finished
   * board logged 44 episodes of a ball sitting still for over 12 seconds, and one of them clocked
   * 185 rollover awards while parked in a lane - a stuck ball that SCORES, which is the exact
   * failure pinball/CLAUDE.md records STARHUB shipping once already.
   *
   * So this measures DISPLACEMENT FROM AN ANCHOR, never speed, for the reason written up there: a
   * wedged ball jitters, crossing any speed threshold several times a second while going nowhere.
   * A real machine does the same thing and calls it a ball search.
   */
  _ballSearch(dt) {
    if (this.phase !== 'play') return;
    for (const b of this.balls) {
      if (b.onPlunger) { b._anchor = null; b._still = 0; continue; }
      if (!b._anchor || Math.hypot(b.x - b._anchor[0], b.y - b._anchor[1]) > SEARCH_DIST) {
        b._anchor = [b.x, b.y];
        b._still = 0;
        continue;
      }
      b._still += dt;
      if (b._still < SEARCH_SECS) continue;
      // Shove it the way a solenoid would: mostly sideways, slightly up, alternating direction so
      // a second search cannot re-park it in the same corner.
      const dir = (b._searches = (b._searches | 0) + 1) % 2 ? 1 : -1;
      b.vx += dir * SEARCH_VX;
      b.vy -= SEARCH_VY;
      b._anchor = [b.x, b.y];
      b._still = 0;
      this.emit({ type: 'ballsearch' });
    }
  }

  /** Every scoring part on this board is a collider id, so one handler covers all of them. The
   *  point values are the ones carried in the source table, not invented here. */
  _contact(kind, id, x, y, speed) {
    if (!id) return;
    if (id.startsWith('bump:')) {
      const idx = Number(id.slice(5));
      const pts = ((T.BUMPERS[idx] || [])[5] | 0) || 100;
      this._award(pts, x, y);
      this.stats.bumpers++;
      this.emit({ type: 'bumper', x, y, i: idx });
      return;
    }
    if (id.startsWith('drop:')) {
      const key = id.slice(5);
      if (this.down.has(key)) return;
      this.down.add(key);
      const bank = T.DROPS.find((d) => key.startsWith(d.id + ':'));
      this._award(bank ? bank.score : 500, x, y);
      this.stats.drops++;
      this.emit({ type: 'drop', x, y });
      this._rebuild();
      if (bank) {
        const keys = bank.targets.map((_, i) => bank.id + ':' + i);
        if (keys.every((k) => this.down.has(k))) {
          this._award(bank.score * 10, x, y);
          this.stats.banks++;
          this.emit({ type: 'bankdone', x, y });
          this.dropTimers.push({ t: DROP_RESET_SECS, keys });
        }
      }
      return;
    }
    if (speed > 260) this.emit({ type: 'clack', x, y });
  }

  /** Rollovers and the spinner are not colliders - the ball passes THROUGH them - so they are
   *  tested geometrically, and a lane only re-arms once the ball has genuinely left it. */
  _rollovers() {
    for (const b of this.balls) {
      if (b.onPlunger || !b.live) continue;
      for (const g of T.ROLLOVERS) {
        if ((g.layer | 0) !== (b.layer | 0)) continue;
        for (let i = 0; i < g.pts.length; i++) {
          const key = g.id + ':' + i;
          const [px, py] = g.pts[i];
          const inside = Math.hypot(b.x - px, b.y - py) < g.r + BALL_R;
          if (inside && !this.rollLit.get(key)) {
            this.rollLit.set(key, true);
            this._award(g.score, px, py);
            this.stats.rollovers++;
            this.emit({ type: 'lane', x: px, y: py });
          } else if (!inside && this.rollLit.get(key)) {
            this.rollLit.set(key, false);
          }
        }
      }
      for (const [sx, sy, sr, sc, sl] of T.SPINNERS) {
        if ((sl | 0) !== (b.layer | 0)) continue;
        const key = 'spin:' + sx;
        const inside = Math.hypot(b.x - sx, b.y - sy) < sr + BALL_R;
        if (inside && !this.rollLit.get(key)) {
          this.rollLit.set(key, true);
          this._award(sc || 100, sx, sy);
          this.stats.spins++;
          this.emit({ type: 'spinner', rips: 1, x: sx, y: sy });
        } else if (!inside && this.rollLit.get(key)) {
          this.rollLit.set(key, false);
        }
      }
    }
  }

  _drain() {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      const out = (b.y > T.DRAIN_Y + BALL_R * 2 && (b.layer | 0) === 0) || b.x < -40 || b.x > T.W + 40 || b.y < -80;
      if (!out) continue;
      if (this.saveTimer > 0 && this.phase === 'play') {
        b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0; b.onPlunger = true;
        this.emit({ type: 'ballsave' });
        continue;
      }
      this.balls.splice(i, 1);
      this.emit({ type: 'drain' });
    }
    if (this.balls.length === 0 && this.phase === 'play') this._endBall();
  }

  _endBall() {
    this.stats.bestBall = Math.max(this.stats.bestBall, this.ballScore);
    if (this.ball >= this.ballsTotal) {
      this.phase = 'over';
      this.emit({ type: 'gameover', score: this.score });
      return;
    }
    this.ball++;
    this.down.clear();
    this.retracted.clear();
    this.dropTimers.length = 0;
    this._rebuild();
    this.phase = 'ready';
    this._serve();
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: this.ball }, big: true });
  }

  _award(pts, x, y) {
    this.score += pts;
    this.ballScore += pts;
    this.emit({ type: 'score', pts, x, y });
  }

  // --- what ui.js reads --------------------------------------------------------------------------

  hud() {
    return {
      score: this.score, ball: this.ball, ballsTotal: this.ballsTotal,
      phase: this.phase, mult: 1, scoreMult: 1,
      save: this.saveTimer, tilt: false, tiltMeter: 0,
      mission: null, multiball: false, wizard: false,
      locks: 0, lockLit: false, bankLit: false, superLit: false,
      missionsDone: 0, extraBalls: 0,
      power: this.plungerPower, onPlunger: !!this._plungerBall(),
    };
  }

  result() {
    return {
      score: this.score,
      difficulty: this.difficulty,
      jackpots: 0,
      multiballs: 0,
      missions: this.stats.banks,       // a cleared bank is this board's "objective completed"
      ramps: this.stats.drops,
      bestBall: this.stats.bestBall,
    };
  }
}

export default { RoyalPinball };
