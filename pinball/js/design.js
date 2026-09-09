// pinball/js/design.js - the rules for the FOUNDRY board (js/table-design.js).
//
// A separate class for the reason royal.js and rainbow.js both give: game.js is welded to STARHUB's
// shot map, and this board has its own - two ramps to an upper deck, a drop hole back down, three
// rollover rows, a capture saucer under the centre arch, four pop bumpers and two upper flippers.
// This is the same public surface ui.js already drives over its own rules.
//
// THE SCORING IS PLAIN AND DELIBERATELY SO. There is no rulesheet for the reference table, and this
// board exists to be PLAYED and judged, not to ship a ruleset. Points for the parts, a saucer that
// captures and pays, a ramp that pays, three balls. Anything cleverer would be inventing.
//
// THE LAW: this class stores nothing. The only record of a score is recordPinball() in
// js/game-stats.js, exactly as the other three boards' are.

import { step, makeBall, PHYS_DT, BALL_R } from './physics.js';
import T, { buildLevel } from './table-design.js';

const BALLS = 3;
/** How long an UPPER paddle stays up on one press. Long enough to be a real swing at a ball,
 *  short enough that it can never be the shelf the deck sweep measured. */
const UPPER_HOLD = 0.22;
/** How long a ball takes to climb a ramp. A real habitrail is about half a second of travel. */
const RAMP_CLIMB = 0.55;
const SAVE_SECS = 7;
const GRAVITY = 515;
const SAUCER_HOLD = 0.9;
const SEARCH_DIST = 30, SEARCH_SECS = 3, SEARCH_VX = 210, SEARCH_VY = 150, SEARCH_GIVE_UP = 3;

const PTS = {
  bumper: 100, sling: 50, post: 10, target: 500,
  dot: 300, row: 2500, allRows: 10000,
  ramp: 2000, saucer: 5000, yellow: 250,
};

export class DesignPinball {
  constructor(opts = {}) {
    this.difficulty = 'medium';
    this.rand = opts.rand || Math.random;
    this.events = [];
    this.reset();
  }

  reset() {
    this.down = new Set();
    this._rebuild();
    this.balls = [];
    this.phase = 'attract';
    this.score = 0;
    this.ball = 1;
    this.ballsTotal = BALLS;
    this.time = 0;
    this.plungerPower = 0;
    this.plungerHeld = false;
    this.saveTimer = 0;
    this.saveUsed = false;
    this.rowLit = { magenta: new Set(), blue: new Set(), red: new Set() };
    this.rowsThisBall = new Set();
    this.ramps = 0;
    this._touch = new Set();
    this._touchPrev = new Set();
    this._cool = new Map();
    this.stats = { bumpers: 0, ramps: 0, saucers: 0, rows: 0, allRows: 0, bestBall: 0 };
    this.ballScore = 0;
    this.events.length = 0;
  }

  /** One world per level. A ball on the main playfield must touch the arch bands and nothing on the
   *  deck above it - that separation is the whole difference between a second level and a wall. */
  _rebuild() {
    this.levels = [0, 1, 2].map((n) => {
      if (n === 0) return { colliders: [], flippers: [], gravity: GRAVITY, drag: 0.16, nudgeX: 0, nudgeY: 0 };
      const built = buildLevel(n, { down: this.down });
      return { colliders: built.colliders, flippers: built.flippers, gravity: GRAVITY, drag: 0.16, nudgeX: 0, nudgeY: 0 };
    });
    this.world = this.levels[1];
    this.colliders = this.levels[1].colliders;
    // ui.js and the renderer read ONE list; the two buttons drive all four paddles.
    this.flippers = [...this.levels[1].flippers, ...this.levels[2].flippers];
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
    // THE SHOOTER LANE IS ON LEVEL 2, AND THAT IS WHAT MAKES THE PLUNGE REAL. The lane feeds the
    // DECK, so a ball that rides it is a deck ball for the whole trip: it climbs, meets the top
    // wall and turns left through the gap in the board right wall, all under the solver. The old
    // build served on level 1 and moved the ball across the wall by hand at the top.
    b.layer = 2; b.lift = 1;
    this.balls.push(b);
    if (!this.saveUsed) this.saveTimer = SAVE_SECS;
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
    b.vy = -(430 + 620 * p);
    b.vx = 0;
    this.phase = 'play';
    this.emit({ type: 'launch', power: p });
  }

  _plungerBall() { return this.balls.find((b) => b.onPlunger) || null; }

  /** One button per side drives the lower paddle and the upper one above it, which is how a machine
   *  with upper flippers is wired and the only thing a phone has room for.
   *
   *  AN UPPER FLIPPER CANNOT BE HELD, AND THAT IS WHAT STOPS THE DECK BEING A BALL TRAP.
   *  Measured: dropping a ball at rest on 1,312 points of the deck, 84 came to rest with the
   *  paddles down and **762 - 58% - came to rest with them held**, nearly all of them ON a raised
   *  bat. A raised upper flipper is a bar lying across the middle of the deck, and 105 of those
   *  balls sat in the V the two of them make straddling the drop hole. `pinball/CLAUDE.md` already
   *  states the shape for RAINBOW: the upper paddles share the lower paddles' buttons, and a
   *  player holds a button to cradle, so a held upper paddle is a shelf in the middle of the table.
   *
   *  So the upper pair AUTO-RELEASE: a press swings them and they drop back on their own after
   *  UPPER_HOLD. That is a real mechanism, it keeps the paddle worth pressing, and a paddle that
   *  cannot stay up cannot be a shelf. The LOWER pair are untouched - a cradle down there is the
   *  player aiming, and taking it away would be taking the game away.
   */
  setFlipper(side, down) {
    const left = side === 'left';
    for (const f of this.flippers) {
      if (/left/.test(f.id) !== left) continue;
      if (/upper/.test(f.id)) {
        if (down && !f.pressed) f._upT = UPPER_HOLD;   // a fresh press starts the swing
        if (!down) f._upT = 0;
        f.pressed = down;
      } else f.pressed = down;
    }
  }

  /**
   * WALK A BALL UP A RAMP. The ball is held for RAMP_CLIMB seconds and moved along the ramp's own
   * centre line from the mouth (py 908) to the top (py 600), rising as it goes - `b.lift` is 0 on
   * the playfield and 1 on the deck, and js/render-design.js draws the ball at that height, so the
   * climb is something you watch rather than a jump.
   *
   * It only becomes a level-2 ball at the TOP. Setting the layer at the foot would put it on the
   * deck's world while it is still visibly down at the deck edge.
   */
  _rampRide(dt) {
    for (const b of this.balls) {
      if (!b._climbR) continue;
      const r = b._climbR;
      b._climb = Math.min(1, (b._climb || 0) + dt / RAMP_CLIMB);
      const e = b._climb * b._climb * (3 - 2 * b._climb);   // ease, so it slows as it crests
      b.x = b._climbFrom[0] + (r.top.x - b._climbFrom[0]) * e;
      b.y = b._climbFrom[1] + (r.top.y - b._climbFrom[1]) * e;
      b.vx = 0; b.vy = 0;
      b.lift = e;
      if (b._climb < 1) continue;
      b._climbR = null; b.held = false; b.holdT = 0; b.lift = 1;
      b.layer = 2; b.vx = r.top.vx; b.vy = r.top.vy;
      this.emit({ type: 'rampexit', x: b.x, y: b.y });
    }
  }

  /**
   * THE ONE-WAY KICKERS. A small pad on level 1 just in front of each ramp mouth that adds speed
   * to a ball ALREADY heading up the lane, and does nothing to one coming back down.
   *
   * Matt: *"maybe we put a little speed boost thing on level 1 just in front of the ramp so it
   * can make it up the incline. This boost would have to be 1-way functional ONLY. And allow for
   * the ball to roll down the ramp without being shot back up it."*
   *
   * ONE-WAY FALLS OUT OF THE MATHS, IT IS NOT A FLAG. The push is applied only when the ball's
   * velocity resolved ALONG THE LANE already exceeds `minAlong`. A ball rolling back out of the
   * mouth resolves NEGATIVE and is untouched, so it leaves the way a ball should. A ball drifting
   * sideways over the pad resolves near zero and is untouched too, so the pad cannot be farmed.
   *
   * It fires ONCE PER VISIT, not once per frame. `_kick` is set on the ball and cleared only when
   * it is well clear of the pad again - the same edge-detection discipline the ramp mouth needs,
   * and for the same reason: without it a ball resting on the pad is accelerated every step.
   */
  _kickers() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held || (b.layer | 0) !== 1) { b._kick = false; continue; }
      let touching = false;
      for (const k of T.KICKERS) {
        const dx = b.x - k.x, dy = b.y - k.y;
        if (dx * dx + dy * dy > k.r * k.r) continue;
        touching = true;
        if (b._kick) continue;
        const along = b.vx * k.u[0] + b.vy * k.u[1];
        if (along <= k.minAlong) continue;
        b._kick = true;
        b.vx += k.u[0] * k.boost;
        b.vy += k.u[1] * k.boost;
        this.emit({ type: 'kicker', id: k.id, x: b.x, y: b.y });
      }
      if (!touching) b._kick = false;
    }
  }

  /** Drop any upper paddle whose swing has run its course, however long the button is held. */
  _upperFlippers(dt) {
    for (const f of this.flippers) {
      if (!/upper/.test(f.id) || !f.pressed) continue;
      f._upT = (f._upT || 0) - dt;
      if (f._upT <= 0) f.pressed = false;
    }
  }

  nudge(dir) {
    if (this.phase !== 'play') return;
    const ax = dir === 'left' ? -60 : dir === 'right' ? 60 : 0;
    for (const b of this.balls) { b.vx += ax; if (dir === 'up') b.vy -= 50; }
    this.emit({ type: 'nudge', dir });
  }

  // --- the frame ---------------------------------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this._upperFlippers(dt);
    this._kickers();
    this._rampRide(dt);
    if (this.phase === 'over' || this.phase === 'attract') return;
    if (this.plungerHeld) this.plungerPower = Math.min(1, this.plungerPower + dt * 1.1);
    if (this.saveTimer > 0) {
      this.saveTimer = Math.max(0, this.saveTimer - dt);
      if (this.saveTimer === 0) this.saveUsed = true;
    }

    const steps = Math.max(1, Math.round(dt / PHYS_DT));
    for (let i = 0; i < steps; i++) {
      const held = this._plungerBall();
      if (held) { held.x = T.PLUNGER.x; held.y = T.PLUNGER.y; held.vx = 0; held.vy = 0; }
      this._saucerHold(PHYS_DT);
      this._touchPrev = this._touch;
      this._touch = new Set();
      for (const n of [1, 2]) {
        const on = this.balls.filter((b) => (b.layer | 0) === n);
        if (!on.length) { step(this.levels[n], [], null); continue; }
        step(this.levels[n], on, (kind, id, x, y, speed) => this._contact(kind, id, x, y, speed));
      }
      this._levelChange();
      this._sensors();
      this._chute();
      this._drain();
    }
    this._ballSearch(dt);
  }

  /**
   * The three ways a ball changes level.
   *
   * Both ramps are measured shots rather than chosen ones: a sweep of 560 flipper shots across every
   * contact point and flip timing reaches a mouth 28 times, about 5%, which is a real ramp rate. The
   * mouth is a WALL on level 1 as well, as a backstop; this fires first.
   */
  _levelChange() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held) continue;
      const L = b.layer | 0;
      if (L === 1) {
        // A RAMP FIRES ONCE PER APPROACH, not once per bounce. The mouth is also a WALL on level 1,
        // so a ball that arrives and rattles on it satisfies "moving up, near the mouth" on every
        // rebound - a driven game scored 840 ramps in four balls that way, the same edge-detection
        // failure this repo has now met on four boards. The flag clears only once the ball is well
        // clear of the mouth again.
        for (const r of T.RAMPS) {
          const near = b.y <= r.y + BALL_R * 3 && b.x >= r.x[0] && b.x <= r.x[1];
          if (!near) { if (b.y > r.y + 300) b._ramp = false; continue; }
          // ANY ball in the lane above the mouth line goes up, not only one still climbing. The
          // mouth used to be a WALL as well, which stopped a stalling ball dead and parked it in
          // the dead space over the arch; that wall is gone (see design/board.js) and this is
          // what replaces it. The _ramp flag still makes it once per approach, not per bounce.
          if (b._ramp || (b.vy >= 0 && b.y > r.y)) continue;
          // NO MINIMUM ENTRY SPEED, AND THAT IS A DELIBERATE TRADE. A gate here (measured at 330,
          // below the median arrival of 697) makes the ramp a shot you can fail, which is what gives
          // the kicker something to rescue. It also parks balls: the lane is FLAT with rails, so a
          // ball that fails the gate simply sits in it. The rest sweep went from 155 resting points
          // to 350 in 10 places the moment the gate went in. A stuck ball is the defect Matt has
          // reported most, so the gate waits until the lane can roll a failed ball back out of its
          // own mouth. RAMPS still carries minEntry, unused, so the experiment is one line away.
          b._ramp = true;
          // Hand the ball to the climb rather than moving it. _rampRide walks it up the ramp's own
          // centre line and lets it out at the top; nothing here changes its position.
          b.held = true; b.holdT = 99; b._climb = 0; b._climbR = r;
          b._climbFrom = [b.x, b.y];
          this.ramps++; this.stats.ramps++;
          this._award(PTS.ramp, b.x, b.y, 'ramp');
          this.emit({ type: 'ramp', x: b.x, y: b.y });
        }
        // NOTHING HAPPENS AT THE TOP OF THE CHUTE ANY MORE, AND THAT IS THE FIX. A plunged ball
        // is put on level 2 by the plunger itself and rides the chute the whole way up under its
        // own power; the board's right wall stops at py 300 on level 2, so the ball rolls out of
        // the lane and onto the deck through a real opening. The line that used to be here moved
        // it 140 px sideways through a solid wood wall.
      } else if (L === 2) {
        if (b.y > T.DROP_HOLE.y && b.x >= T.DROP_HOLE.x[0] && b.x <= T.DROP_HOLE.x[1]) {
          b.layer = 1; b.lift = 0; b.y = T.DROP_HOLE.to.y;
          this.emit({ type: 'rampexit', x: b.x, y: b.y });
        } else if (b.y > T.px(760) && b.x < T.px(941)) {
          // A BALL LEAVING THE DECK OVER A RAMP LANE MUST NOT BE SCOOPED STRAIGHT BACK UP IT.
          // The deck front is py 760 and both ramp lanes pass under it, so a ball walking off
          // the edge there landed on level 1 INSIDE the lane, satisfied the mouth test on the
          // next frame and was carried back to the deck. Measured on the shipped build: 36 of
          // 59 ramp events in 20 driven games, 61%, were this and not a shot. A plunged ball
          // could do it on its first trip, because the plunger sets layer 2 directly and never
          // arms `_ramp`. Arming it here costs nothing else: it clears itself once the ball is
          // back down the board past py 1208, exactly as it does after a real ramp.
          // ...so it does not fall there at all. Arming _ramp instead was the first try and it made
          // things worse: the ball landed in the lane, could not be taken up, and had no way out of
          // the channel either - it rattled between the rails for the whole eight seconds of a rest
          // sweep. The deck simply extends over the lane, which is what a real ramp passes under.
          if (b.x < T.px(200) || b.x > T.px(786)) continue;
          // off the front of the deck anywhere else - but the SHOOTER LANE is not the front of
          // the deck. It runs the full length of the cabinet outboard of the board (x px
          // 986..1055), so a ball riding up it is past py 760 for most of the trip. Without the
          // x guard the plunge dropped to level 1 on its first step and the ride happened on the
          // wrong level entirely.
          b.layer = 1; b.lift = 0;
        }
      }
    }
  }

  // --- contacts ------------------------------------------------------------------------------------

  /** A scoring part pays on the way IN, never while the ball leans on it, and a target is debounced
   *  on top of that. This repo has met that bug on three boards already. */
  _arm(id, secs) {
    const next = this._cool.get(id) || 0;
    if (this.time < next) return false;
    this._cool.set(id, this.time + secs);
    return true;
  }

  _contact(kind, id, x, y, speed) {
    if (!id) return;
    this._touch.add(id);
    if (this._touchPrev.has(id)) return;
    if (/^bumper/.test(id)) {
      this._award(PTS.bumper, x, y);
      this.stats.bumpers++;
      this.emit({ type: 'bumper', i: /left/.test(id) ? 0 : 1, x, y });
      return;
    }
    if (/slingshot.*face_AC/.test(id)) {
      this._award(PTS.sling, x, y);
      this.emit({ type: 'sling', id: /left/.test(id) ? 'slingL' : 'slingR', x, y });
      return;
    }
    if (/^target_bank/.test(id)) {
      if (!this._arm(id, 0.3)) return;
      this._award(PTS.target, x, y, 'bank');
      this.emit({ type: 'drop', x, y });
      return;
    }
    if (/^post_red/.test(id)) {
      if (!this._arm(id, 0.3)) return;
      this._award(PTS.post, x, y);
      this.emit({ type: 'standup', id, x, y });
      return;
    }
    if (speed > 260) this.emit({ type: 'clack', x, y });
  }

  // --- sensors -------------------------------------------------------------------------------------

  _sensors() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held || (b.layer | 0) !== 1) continue;
      if (!b._in) b._in = new Set();
      for (const s of T.SWITCHES) {
        const inside = Math.hypot(b.x - s.x, b.y - s.y) <= s.r;
        if (!inside) { b._in.delete(s.id); continue; }
        if (b._in.has(s.id)) continue;
        b._in.add(s.id);
        if (s.kind === 'saucer') this._saucer(b);
        else if (s.kind === 'yellow') this._award(PTS.yellow, b.x, b.y);
        else if (s.row) this._dot(s, b);
      }
    }
  }

  _dot(s, b) {
    const lit = this.rowLit[s.row];
    if (lit.has(s.id)) return;
    lit.add(s.id);
    this._award(PTS.dot, b.x, b.y);
    this.emit({ type: 'lane', id: s.id, x: b.x, y: b.y });
    if (lit.size < T.ROW_SIZE[s.row]) return;
    lit.clear();
    this.stats.rows++;
    this._award(PTS.row, b.x, b.y, 'row');
    this.emit({ type: 'laneset', row: s.row, x: b.x, y: b.y });
    this.rowsThisBall.add(s.row);
    if (this.rowsThisBall.size < T.ROW_NAMES.length) return;
    this.rowsThisBall.clear();
    this.stats.allRows++;
    this._award(PTS.allRows, b.x, b.y, 'rainbow');
    this.emit({ type: 'msg', key: 'msg_rainbow', big: true });
  }

  _saucer(b) {
    if (b.held) return;
    b.held = true; b.holdT = SAUCER_HOLD;
    b.vx = 0; b.vy = 0; b.x = T.SAUCER.x; b.y = T.SAUCER.y;
    this.stats.saucers++;
    this._award(PTS.saucer, b.x, b.y, 'scoop');
    this.emit({ type: 'scoop', x: b.x, y: b.y });
  }

  /** Held for a moment, then kicked back DOWN the middle - the saucer sits under the centre arch,
   *  so an upward kick would fire the ball into its own crown. */
  _saucerHold(dt) {
    for (const b of this.balls) {
      if (!b.held || b._climbR) continue;   // a ball climbing a ramp is held by the climb, not the saucer
      b.holdT -= dt;
      if (b.holdT > 0) continue;
      b.held = false;
      b.y = T.SAUCER.y + T.SAUCER.r + BALL_R + 2;
      b.vx = (this.rand() - 0.5) * 120;
      b.vy = 260;
      if (b._in) b._in.delete('saucer');
      this.emit({ type: 'kickout', x: b.x, y: b.y });
    }
  }

  // --- housekeeping ----------------------------------------------------------------------------------

  /** A ball resting in the launch chute is handed back to the plunger, as a real machine does. */
  _chute() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held) continue;
      if (b.x < T.px(960) || b.y < T.px(1400)) continue;
      if (Math.hypot(b.vx, b.vy) > 60) continue;
      b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0;
      b.onPlunger = true; b.layer = 2; b.lift = 1; b._box = null; b._still = 0;
      this.emit({ type: 'reload' });
    }
  }

  _cradled(b) {
    for (const f of this.flippers) {
      if (!/lower/.test(f.id) || !f.pressed) continue;
      const tx = f.px + Math.cos(f.angle) * f.len, ty = f.py + Math.sin(f.angle) * f.len;
      const dx = tx - f.px, dy = ty - f.py, l2 = dx * dx + dy * dy || 1;
      let t = ((b.x - f.px) * dx + (b.y - f.py) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(b.x - (f.px + dx * t), b.y - (f.py + dy * t)) <= f.r + BALL_R + 5) return true;
    }
    return false;
  }

  /** Measures a BOUNDING BOX over a window, never speed: a wedged ball jitters and crosses any speed
   *  threshold several times a second while going nowhere. */
  _ballSearch(dt) {
    if (this.phase !== 'play') return;
    for (const b of this.balls) {
      if (b.onPlunger || b.held || b.x > T.px(960) || this._cradled(b)) { b._box = null; b._still = 0; continue; }
      if (!b._box) b._box = [b.x, b.y, b.x, b.y];
      b._box[0] = Math.min(b._box[0], b.x); b._box[1] = Math.min(b._box[1], b.y);
      b._box[2] = Math.max(b._box[2], b.x); b._box[3] = Math.max(b._box[3], b.y);
      if (b._box[2] - b._box[0] > SEARCH_DIST || b._box[3] - b._box[1] > SEARCH_DIST) {
        b._box = [b.x, b.y, b.x, b.y]; b._still = 0; continue;
      }
      b._still += dt;
      if (b._still < SEARCH_SECS) continue;
      b._box = [b.x, b.y, b.x, b.y];
      const dir = (b._searches = (b._searches | 0) + 1) % 2 ? 1 : -1;
      b.vx += dir * SEARCH_VX; b.vy -= SEARCH_VY;
      if (b._searches >= SEARCH_GIVE_UP) {
        b._searches = 0;
        b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0;
        b.onPlunger = true; b.layer = 2; b.lift = 1; b._box = null;
        this.emit({ type: 'reload' });
        continue;
      }
      b._still = 0;
      this.emit({ type: 'ballsearch' });
    }
  }

  _drain() {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.held) continue;
      const out = (b.y > T.DRAIN_Y + BALL_R * 2 && (b.layer | 0) === 1)
        || b.y > T.H || b.x < -40 || b.x > T.W + 40 || b.y < -80;
      if (!out) continue;
      if (this.saveTimer > 0 && this.phase === 'play' && this.balls.length === 1) {
        b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0;
        b.onPlunger = true; b.layer = 2; b.lift = 1; b._box = null; b._still = 0;
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
    for (const n of T.ROW_NAMES) this.rowLit[n].clear();
    this.rowsThisBall.clear();
    this.saveUsed = false;
    this._rebuild();
    this.phase = 'ready';
    this._serve();
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: this.ball }, big: true });
  }

  _award(pts, x, y, label) {
    this.score += pts;
    this.ballScore += pts;
    this.emit({ type: 'score', pts, value: pts, x, y, label: label || null });
  }

  // --- what ui.js reads ----------------------------------------------------------------------------

  hud() {
    return {
      score: this.score, ball: this.ball, ballsTotal: this.ballsTotal,
      phase: this.phase, mult: 1, scoreMult: 1,
      save: this.saveTimer, tilt: false, tiltMeter: 0,
      mission: null, multiball: false, wizard: false,
      locks: 0, lockLit: false, bankLit: false, superLit: false,
      missionsDone: this.stats.allRows, extraBalls: 0,
      power: this.plungerPower, onPlunger: !!this._plungerBall(),
      rowLit: this.rowLit, ramps: this.ramps, down: this.down,
    };
  }

  result() {
    return {
      score: this.score,
      difficulty: this.difficulty,
      jackpots: this.stats.saucers,
      multiballs: 0,
      missions: this.stats.allRows,
      ramps: this.stats.ramps,
      bestBall: this.stats.bestBall,
    };
  }
}

export default { DesignPinball };
