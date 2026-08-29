// pinball/js/royal.js - the rules for the ROYAL FLUSH board (pinball/js/table-royal.js).
//
// WHY THIS IS A SEPARATE CLASS AND NOT A BRANCH INSIDE game.js. game.js's rules are welded to
// STARHUB's shots: missions keyed off a scoop, a lock lit by five ramps, H-U-B lanes, a scripted
// habitrail with its own RAMP_PATH. Royal Flush has none of those - no scoop, no H-U-B, four drop
// banks instead of one, an upper right flipper, three ramps this engine cannot yet climb. Threading
// two shot maps through one 849-line class would put a board check on every rule in it and leave
// STARHUB one typo away from breaking. So this file is deliberately SMALL and deliberately DUMB:
// it is the same public surface ui.js already drives (start/update/setFlipper/plungerDown/
// plungerUp/nudge/hud/takeEvents/result/score/phase) over a much simpler rule set.
//
// WHAT IT DOES NOT DO YET, ON PURPOSE: no missions, no multiball, no bonus count-up, no tilt. This
// build exists so the BOARD and the BALL can be judged - the thing Matt actually asked to test.
// Scores come from the parts themselves, using the point values carried in the source table.
//
// THE LAW: this class stores nothing. The only record of a score is recordPinball() in
// js/game-stats.js, exactly as STARHUB's is - see pinball/CLAUDE.md, "Persistence".
import { step, makeBall, PHYS_DT, BALL_R } from './physics.js';
import T, { buildRoyal, BUMPER_SCORES } from './table-royal.js';

const SAVE_SECS = 8;          // ball save at the start of every ball, as STARHUB's Standard does
const MAX_HOLD = 3;           // seconds; the held-ball invariant from pinball/CLAUDE.md
const DROP_RESET_SECS = 2;    // their table's own `reset` value on all four banks
const SEARCH_DIST = 22;       // units a ball must cover to count as "moving" - just over one ball
const SEARCH_SECS = 4;        // seconds parked inside that circle before the table shoves it

export class RoyalPinball {
  constructor(opts = {}) {
    this.difficulty = 'medium';       // one board, one setting; kept so result() stays uniform
    this.rand = opts.rand || Math.random;
    this.events = [];
    this.reset();
  }

  reset() {
    this.down = new Set();            // drop-target keys currently knocked over
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

  /** Colliders are REBUILT whenever a drop target falls, never mutated, so a knocked-over target
   *  simply is not a wall this frame. Same discipline table.js uses for STARHUB's bank. */
  _rebuild() {
    const built = buildRoyal(this.down);
    this.colliders = built.colliders;
    this.flippers = built.flippers;
    this.world = {
      colliders: this.colliders, flippers: this.flippers,
      gravity: T.GRAVITY, drag: 0.04, nudgeX: 0, nudgeY: 0,
    };
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
      step(this.world, this.balls, (kind, id, x, y, speed) => this._contact(kind, id, x, y, speed));
      this._rollovers();
      this._drain();
    }
    this._ballSearch(dt);
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
      b.vx += dir * 120;
      b.vy -= 70;
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
      const pts = (BUMPER_SCORES[idx] | 0) || 100;
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
      for (const [sx, sy, sr, sc] of T.SPINNERS) {
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
      const out = b.y > T.DRAIN_Y + BALL_R * 2 || b.x < -40 || b.x > T.W + 40 || b.y < -80;
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
