// pinball/js/rainbow.js - the rules for the RAINBOW board (pinball/js/table-rainbow.js).
//
// A SEPARATE CLASS, FOR THE REASON royal.js GIVES. game.js's rules are welded to STARHUB's shots -
// missions off a scoop, a lock lit by ramps, H-U-B lanes, a scripted habitrail. This board has none
// of them: three rows of rollovers, four drop targets, three pop bumpers, a pair of upper flippers
// and one central scoop. Threading a third shot map through that class would put a board check on
// every rule in it. So this is the same public surface ui.js already drives (start/update/
// setFlipper/plungerDown/plungerUp/nudge/hud/takeEvents/result/score/phase) over its own rules.
//
// THE RULES ARE THE SPEC'S, IMPLEMENTED AS WRITTEN. There is no rulesheet for the source table -
// the handover spec says so and marks its scoring section PROPOSED - so every number below is the
// spec's number, and where the spec left a decision open the choice is recorded at the point it is
// made rather than in a list somewhere else.
//
// THE LAW: this class stores nothing. The only record of a score is recordPinball() in
// js/game-stats.js, exactly as STARHUB's and ROYAL FLUSH's are.

import { step, makeBall, PHYS_DT, BALL_R } from './physics.js';
import T, { buildTable } from './table-rainbow.js';

const BALLS = 3;              // the spec left ball count open; 3 matches the other two boards
const SAVE_SECS = 7;          // ball save at the start of every ball, as the other boards have
const GRAVITY = 515;          // STARHUB's, because this board is in STARHUB's units
const DROP_RESET_SECS = 2;
const SCOOP_LIT_SECS = 20;    // how long "all three rows" keeps the centre feature open
const MB_SECS = 30;           // the spec's jackpot window
const SCOOP_HOLD = 0.9;       // seconds the scoop keeps a ball before it kicks it back out
const SCOOP_KICK = [0, -430]; // straight back up the middle

// Ball search: the same instrument royal.js uses, and for the reason written up there - a wedged
// ball JITTERS, so speed cannot tell "not moving" from "not going anywhere". Only a bounding box
// over a window can.
const SEARCH_DIST = 30;
const SEARCH_SECS = 3;
const SEARCH_VX = 210;
const SEARCH_VY = 150;
const SEARCH_GIVE_UP = 3;

/** The spec's point values, in one block so a re-balance is one edit. */
const PTS = {
  standup: 500,
  yellow: 250,
  pop: 100,
  sling: 50,
  drop: 500,
  bankAll: 5000,
  dot: 300,
  row: 2500,
  rainbow: 10000,
  lock: 3000,
  jackpot: 5000,
  bonusPerStandup: 500,
};

const ROW_NAMES = ['purple', 'blue', 'red'];

export class RainbowPinball {
  constructor(opts = {}) {
    this.difficulty = 'medium';       // one board, one setting; kept so result() stays uniform
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
    this.dropTimers = [];

    // the rainbow state
    this.rowLit = { purple: new Set(), blue: new Set(), red: new Set() };
    this.rowsThisBall = new Set();    // which rows have been COMPLETED on this ball
    this.combo = 0;                   // the spec's "Rainbow combo meter": rows completed this game

    this.mult = 1;                    // end-of-ball bonus multiplier, raised by the drop bank
    this.bankLit = false;             // a cleared bank lights one shot at the centre feature
    this.scoopTimer = 0;              // all three rows in one ball opens it for a while
    this.locks = 0;
    this.multiball = 0;               // seconds of jackpot window left, 0 when not running
    this.standupsThisBall = 0;

    // A SCORING PART PAYS ON THE WAY IN, NOT WHILE THE BALL LEANS ON IT. See _contact.
    this._touch = new Set();
    this._touchPrev = new Set();
    this.stats = { bumpers: 0, drops: 0, rows: 0, rainbows: 0, locks: 0, multiballs: 0, jackpots: 0, banks: 0, bestBall: 0 };
    this.ballScore = 0;
    this.events.length = 0;
  }

  /** Rebuilt rather than mutated when the bank changes, the same discipline table.js uses. */
  _rebuild() {
    const built = buildTable({ down: this.down });
    this.world = {
      colliders: built.colliders, flippers: built.flippers,
      gravity: GRAVITY, drag: 0.16, nudgeX: 0, nudgeY: 0,
    };
    this.colliders = built.colliders;
    this.flippers = built.flippers;
  }

  emit(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }

  // --- lifecycle ---------------------------------------------------------------------------------

  start() {
    this.reset();
    this.phase = 'ready';
    this._serve(true);
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: 1 }, big: true });
  }

  _serve(arm = true) {
    const b = makeBall(T.PLUNGER.x, T.PLUNGER.y, 0, 0);
    b.onPlunger = true;
    this.balls.push(b);
    // ONE SAVE PER BALL, not one per serve. STARHUB shipped a save that re-armed on every serve,
    // which made it an infinite ball while the timer ran; the flag is the fix and it is carried
    // here rather than re-learned.
    if (arm && !this.saveUsed) this.saveTimer = SAVE_SECS;
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

  /**
   * ONE BUTTON DRIVES TWO FLIPPERS PER SIDE, which is how a machine with upper flippers is wired:
   * the upper left flipper is on the left button, the upper right on the right. There is no third
   * button on a real cabinet and there is no room for one on a phone.
   */
  setFlipper(side, down) {
    const left = side === 'left';
    for (const f of this.flippers) {
      const isLeft = f.id === 'flipL' || f.id === 'upperL';
      if (isLeft === left) f.pressed = down;
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
    if (this.saveTimer > 0) {
      this.saveTimer = Math.max(0, this.saveTimer - dt);
      if (this.saveTimer === 0) this.saveUsed = true;
    }
    if (this.scoopTimer > 0) this.scoopTimer = Math.max(0, this.scoopTimer - dt);
    if (this.multiball > 0) {
      this.multiball = Math.max(0, this.multiball - dt);
      if (this.multiball === 0) this.emit({ type: 'msg', key: 'msg_mb_end' });
    }

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
      this._scoopHold(PHYS_DT);
      // One solver tick, one edge window. `step` reports a contact per MICRO-step, so a ball
      // resting against a target reports it continuously - and the first soak of this board duly
      // paid 1,777 standup awards in six games, an inflated 332,000-point average, from a ball
      // leaning on a target. Same failure as STARHUB's scoop banking 1.5 million in one shot and
      // ROYAL FLUSH's rollover paying eighteen times while pinned to a wall; this is the third
      // time this repo has met it, which is why it is built in from the start here.
      this._touchPrev = this._touch;
      this._touch = new Set();
      step(this.world, this.balls, (kind, id, x, y, speed) => this._contact(kind, id, x, y, speed));
      this._sensors();
      this._shooterLane();
      this._drain();
    }
    this._ballSearch(dt);
  }

  // --- contacts ------------------------------------------------------------------------------------

  _contact(kind, id, x, y, speed) {
    if (!id) return;
    this._touch.add(id);
    // Already leaning on it when this tick began: it has been paid for. A drop target is exempt
    // because `down` already makes it a once-only, and the scoop is not a collider at all.
    if (this._touchPrev.has(id) && !id.startsWith('drop')) return;
    if (id.startsWith('pop')) {
      this._award(PTS.pop, x, y);
      this.stats.bumpers++;
      this.emit({ type: 'bumper', i: Number(id.slice(3)) || 0, x, y });
      return;
    }
    if (id.startsWith('sling')) {
      this._award(PTS.sling, x, y);
      this.emit({ type: 'sling', id: id === 'sling0' ? 'slingL' : 'slingR', x, y });
      return;
    }
    if (id.startsWith('stand')) {
      this._award(PTS.standup, x, y);
      this.standupsThisBall++;
      this.emit({ type: 'standup', id, i: Number(id.slice(5)) || 0, x, y });
      return;
    }
    if (id.startsWith('yell')) {
      this._award(PTS.yellow, x, y);
      this.standupsThisBall++;
      this.emit({ type: 'standup', id, i: Number(id.slice(4)) || 0, x, y });
      return;
    }
    if (id.startsWith('drop')) {
      if (this.down.has(id)) return;
      this.down.add(id);
      this._award(PTS.drop, x, y);
      this.stats.drops++;
      this.emit({ type: 'drop', x, y });
      this._rebuild();
      const keys = [];
      for (let i = 0; i < T.DROP_COUNT; i++) keys.push(`drop${i}`);
      if (keys.every((k) => this.down.has(k))) this._bankDone(keys, x, y);
      return;
    }
    if (speed > 260) this.emit({ type: 'clack', x, y });
  }

  _bankDone(keys, x, y) {
    this._award(PTS.bankAll, x, y, 'bank');
    this.stats.banks++;
    // The spec: all four down raises the bonus multiplier (capped at 5x) and lights one shot at
    // the centre feature.
    this.mult = Math.min(5, this.mult + 1);
    this.bankLit = true;
    this.emit({ type: 'bankdone', x, y });
    this.emit({ type: 'msg', key: 'msg_scoop_lit', big: true });
    this.dropTimers.push({ t: DROP_RESET_SECS, keys });
  }

  // --- sensors: the rainbow rows, the yellows and the scoop ------------------------------------------

  /**
   * A ROLLOVER LIGHTS ONCE PER PASS, IT DOES NOT PAY EVERY TICK.
   *
   * `_inSensor` is edge detection, and it is not optional. Both other boards in this game shipped
   * without it once: STARHUB's scoop banked 1.5 million in a single shot, and ROYAL FLUSH paid a
   * ball pinned against a wall eighteen rollover awards over thirty-one seconds. A sensor that
   * fires while the ball SITS on it is a scoring bug in every table ever written.
   */
  _sensors() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held) continue;
      if (!b._inSensor) b._inSensor = new Set();
      for (const s of T.SWITCHES) {
        const inside = Math.hypot(b.x - s.x, b.y - s.y) <= s.r;
        if (!inside) { b._inSensor.delete(s.id); continue; }
        if (b._inSensor.has(s.id)) continue;
        b._inSensor.add(s.id);
        if (s.kind === 'scoop') this._scoopHit(b);
        else if (s.row) this._dotHit(s, b);
      }
    }
  }

  _dotHit(s, b) {
    const lit = this.rowLit[s.row];
    if (this.multiball > 0) {
      // The spec's multiball: jackpots are ON the rainbow lanes, doubled if the combo meter is full.
      const full = this.combo >= ROW_NAMES.length;
      this._award(PTS.jackpot * (full ? 2 : 1), b.x, b.y, 'jackpot');
      this.stats.jackpots++;
      this.emit({ type: 'jackpot', x: b.x, y: b.y, value: PTS.jackpot * (full ? 2 : 1) });
      return;
    }
    if (lit.has(s.id)) return;        // already lit this pass: no award, no re-light
    lit.add(s.id);
    this._award(PTS.dot, b.x, b.y);
    this.emit({ type: 'lane', id: s.id, x: b.x, y: b.y });
    const total = T.ROWS[s.row].length;
    if (lit.size < total) return;

    // the row is complete
    lit.clear();                      // so the row can be run again
    this.stats.rows++;
    this.combo = Math.min(ROW_NAMES.length, this.combo + 1);
    this._award(PTS.row, b.x, b.y, 'row');
    this.emit({ type: 'laneset', row: s.row, x: b.x, y: b.y });
    this.emit({ type: 'msg', key: 'msg_row_done' });

    this.rowsThisBall.add(s.row);
    if (this.rowsThisBall.size < ROW_NAMES.length) return;

    // all three rows on one ball, which is the spec's condition
    this.rowsThisBall.clear();
    this.stats.rainbows++;
    this._award(PTS.rainbow, b.x, b.y, 'rainbow');
    this.scoopTimer = SCOOP_LIT_SECS;
    this.emit({ type: 'msg', key: 'msg_rainbow', big: true });
  }

  /** Is the centre feature open? Either route the spec gives: a cleared bank, or all three rows. */
  get scoopLit() { return this.bankLit || this.scoopTimer > 0; }

  _scoopHit(b) {
    if (b.held) return;
    b.held = true;
    b.holdT = SCOOP_HOLD;
    b.vx = 0; b.vy = 0;
    b.x = T.SCOOP.x; b.y = T.SCOOP.y;
    this.emit({ type: 'scoop', x: b.x, y: b.y });

    if (this.multiball > 0) return;   // during multiball the scoop is just a hole
    if (!this.scoopLit) return;       // unlit: it catches and kicks back, and pays nothing

    this.bankLit = false;
    this.scoopTimer = 0;
    this.locks++;
    this.stats.locks++;
    if (this.locks < 3) {
      this._award(PTS.lock, b.x, b.y, 'lock');
      this.emit({ type: 'lock', x: b.x, y: b.y });
      this.emit({ type: 'msg', key: 'msg_lock_n', params: { n: this.locks } });
      return;
    }
    this._startMultiball(b);
  }

  /**
   * Multiball. THE LOCKED BALLS ARE VIRTUAL, and that is deliberate: the spec's lock holds balls
   * one and two "in" the scoop, but a real physical lock means a ball sitting out of play while the
   * player carries on with the next one, which needs a second serve, a kick-out and a lot of state.
   * Locks one and two are counted and lit; the third RELEASES all three, which is what the player
   * sees either way.
   */
  _startMultiball(b) {
    this.locks = 0;
    this.multiball = MB_SECS;
    this.stats.multiballs++;
    for (let i = 0; i < 2; i++) {
      const nb = makeBall(T.SCOOP.x + (i ? 26 : -26), T.SCOOP.y - 20, (i ? 150 : -150), -260);
      this.balls.push(nb);
    }
    this.emit({ type: 'multiball', wizard: false });
    this.emit({ type: 'msg', key: 'msg_multiball', big: true });
  }

  /** A held ball sits in the scoop for a moment, then is kicked straight back up the middle. */
  _scoopHold(dt) {
    for (const b of this.balls) {
      if (!b.held) continue;
      b.holdT -= dt;
      if (b.holdT > 0) continue;
      b.held = false;
      b.x = T.SCOOP.x;
      b.y = T.SCOOP.y - T.SCOOP.rad - BALL_R - 2;
      b.vx = SCOOP_KICK[0] + (this.rand() - 0.5) * 60;
      b.vy = SCOOP_KICK[1];
      if (b._inSensor) b._inSensor.delete('scoop');
      this.emit({ type: 'kickout', x: b.x, y: b.y });
    }
  }

  // --- housekeeping ----------------------------------------------------------------------------------

  /** A ball resting in the shooter lane is handed back to the plunger, as a real machine does.
   *  ROYAL FLUSH sat for a hundred seconds with three balls unplayed for want of this. */
  _shooterLane() {
    for (const b of this.balls) {
      if (b.onPlunger || b.held) continue;
      const inLane = b.x > T.PLUNGER.x - 20 && b.y > T.PLUNGER.y - 60;
      if (!inLane || Math.hypot(b.vx, b.vy) > 60) continue;
      b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0;
      b.onPlunger = true;
      b._box = null; b._still = 0;
      this.emit({ type: 'reload' });
    }
  }

  _ballSearch(dt) {
    if (this.phase !== 'play') return;
    for (const b of this.balls) {
      if (b.onPlunger || b.held) { b._box = null; b._still = 0; continue; }
      // The shooter lane is _shooterLane()'s business, not the search's. A lane 26 units wide
      // has nowhere to send a sideways shove, so a search there only rattles the ball until it
      // is slow enough to be handed back to the plunger anyway - and it logged 20 of 33
      // searches doing exactly that.
      if (b.x > T.ART.laneX) { b._box = null; b._still = 0; continue; }
      // A CRADLED BALL IS NOT A STUCK BALL. js/physics.js damps a slow ball resting on a HELD
      // flipper on purpose - that is what a cradle is, and holding one is how a pinball player
      // aims. A ball sitting still on a raised paddle is therefore the machine working, and the
      // search was calling it a fault: it fired at (69, 544) and (240, 533), both inlanes, and at
      // (253, 209), which is the upper flipper, 82 times in eight games. The four flippers here
      // are driven by two buttons, so an upper one is cradling whenever its side is held.
      if (this._cradled(b)) { b._box = null; b._still = 0; continue; }
      if (!b._box) b._box = [b.x, b.y, b.x, b.y];
      b._box[0] = Math.min(b._box[0], b.x); b._box[1] = Math.min(b._box[1], b.y);
      b._box[2] = Math.max(b._box[2], b.x); b._box[3] = Math.max(b._box[3], b.y);
      if (b._box[2] - b._box[0] > SEARCH_DIST || b._box[3] - b._box[1] > SEARCH_DIST) {
        b._box = [b.x, b.y, b.x, b.y];
        b._still = 0;
        continue;
      }
      b._still += dt;
      if (b._still < SEARCH_SECS) continue;
      b._box = [b.x, b.y, b.x, b.y];
      const dir = (b._searches = (b._searches | 0) + 1) % 2 ? 1 : -1;
      b.vx += dir * SEARCH_VX;
      b.vy -= SEARCH_VY;
      if (b._searches >= SEARCH_GIVE_UP) {
        b._searches = 0;
        b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0;
        b.onPlunger = true; b._box = null;
        this.emit({ type: 'reload' });
        continue;
      }
      b._still = 0;
      this.emit({ type: 'ballsearch' });
    }
  }

  /**
   * Is this ball sitting on a flipper the player is holding up?
   *
   * MEASURED AGAINST THE BAT, NOT A CIRCLE ROUND THE PIVOT. The first version used the pivot and
   * a radius of len + r, which is a disc the paddle only ever sweeps a third of - so it exempted
   * everything BEHIND the flipper too. A soak immediately hid a real wedge inside that exemption:
   * a ball under the left shelf at about (50, 240) sat for the rest of the game, 26% of all ball
   * life in one 35x69 cell, with the search switched off by a paddle it was nowhere near.
   */
  _cradled(b) {
    for (const f of this.flippers) {
      // THE MAIN FLIPPERS ONLY. A cradle on a lower paddle is the player aiming and must not be
      // interrupted. A ball parked on an UPPER flipper is a ball that cannot come back down: the
      // two upper paddles are on the same two buttons, so they are raised whenever their side is
      // held, and a raised one is a shelf in the middle of the table. Exempting them put 74% of
      // all ball life in the four cells around them and dropped a measured soak from 24 drains
      // to 3.
      if (f.id !== 'flipL' && f.id !== 'flipR') continue;
      if (!f.pressed) continue;
      const tx = f.px + Math.cos(f.angle) * f.len;
      const ty = f.py + Math.sin(f.angle) * f.len;
      const dx = tx - f.px, dy = ty - f.py;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((b.x - f.px) * dx + (b.y - f.py) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(b.x - (f.px + dx * t), b.y - (f.py + dy * t));
      if (d <= f.r + BALL_R + 5) return true;
    }
    return false;
  }

  _drain() {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.held) continue;
      const out = b.y > T.DRAIN_Y + BALL_R * 2 || b.x < -40 || b.x > T.W + 40 || b.y < -80;
      if (!out) continue;
      // A save only rescues the LAST ball: during multiball a drained ball is simply gone, which is
      // what every machine does and what stops a save turning multiball into a free-for-all.
      if (this.saveTimer > 0 && this.phase === 'play' && this.balls.length === 1) {
        b.x = T.PLUNGER.x; b.y = T.PLUNGER.y; b.vx = 0; b.vy = 0; b.onPlunger = true;
        b._box = null; b._still = 0;
        this.emit({ type: 'ballsave' });
        continue;
      }
      this.balls.splice(i, 1);
      this.emit({ type: 'drain' });
    }
    if (this.balls.length === 0 && this.phase === 'play') this._endBall();
  }

  _endBall() {
    // The spec's end-of-ball bonus: the standups hit this ball, times the current multiplier.
    const bonus = this.standupsThisBall * PTS.bonusPerStandup * this.mult;
    if (bonus > 0) {
      this._award(bonus, null, null, 'bonus');
      this.emit({ type: 'msg', key: 'msg_bonus_x', params: { n: this.mult } });
    }
    this.stats.bestBall = Math.max(this.stats.bestBall, this.ballScore);
    if (this.ball >= this.ballsTotal) {
      this.phase = 'over';
      this.emit({ type: 'gameover', score: this.score });
      return;
    }
    this.ball++;
    // What resets with the ball, and what does not. The rows and their lit dots reset, because the
    // spec's headline award is all three rows ON ONE BALL. The combo meter and the bonus multiplier
    // are GAME state and carry, which is the only thing that makes them worth building over three
    // balls.
    this.down.clear();
    this.dropTimers.length = 0;
    for (const n of ROW_NAMES) this.rowLit[n].clear();
    this.rowsThisBall.clear();
    this.scoopTimer = 0;
    this.multiball = 0;
    this.locks = 0;
    this.standupsThisBall = 0;
    this.saveUsed = false;
    this._rebuild();
    this.phase = 'ready';
    this._serve(true);
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
      phase: this.phase, mult: this.mult, scoreMult: 1,
      save: this.saveTimer, tilt: false, tiltMeter: 0,
      // No timed missions on this board, so no mission bar. The rainbow progress is on the
      // playfield lamps, which is where a machine puts it.
      mission: null,
      multiball: this.multiball > 0, wizard: false,
      locks: this.locks, lockLit: this.scoopLit, bankLit: this.bankLit, superLit: false,
      missionsDone: this.stats.rainbows, extraBalls: 0,
      power: this.plungerPower, onPlunger: !!this._plungerBall(),
      // this board's own, read by the renderer
      rowLit: this.rowLit, combo: this.combo, rowsThisBall: this.rowsThisBall,
      down: this.down,
    };
  }

  result() {
    return {
      score: this.score,
      difficulty: this.difficulty,
      jackpots: this.stats.jackpots,
      multiballs: this.stats.multiballs,
      missions: this.stats.rainbows,    // a full rainbow is this board's "objective completed"
      ramps: this.stats.rows,           // rows completed, the shot this board is about
      bestBall: this.stats.bestBall,
    };
  }
}

export default { RainbowPinball };
