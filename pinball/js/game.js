// pinball/js/game.js - the rules. Pure: no DOM, no canvas, no audio, no timers of its own. It owns
// the ball(s), drives physics.js over table.js, turns contacts into score, and emits an EVENT
// STREAM that ui.js drains once a frame for sound, popups and lamps.
//
// WHY AN EVENT STREAM RATHER THAN CALLBACKS INTO THE UI. A pinball frame can produce a dozen
// scoring contacts, and half the fun is that they land as a burst. Queuing them and letting the
// presentation layer decide what to show, flash and play keeps this file testable with `node`
// (test.js plays thousands of simulated seconds and never constructs a single DOM node) and stops
// rendering concerns leaking into the rules, which is where every "why is the score wrong" bug in a
// game like this comes from.
//
// USER-VISIBLE TEXT IS NEVER BUILT HERE. Messages are emitted as dictionary KEYS plus params
// (`{ type: 'msg', key: 'msg_jackpot', params: { n } }`); ui.js resolves them through t() at render
// time. That is the hub's standing i18n rule (root CLAUDE.md item 9) and it is also why the rules
// can be unit-tested without loading a dictionary at all.

import { step, makeBall, PHYS_DT, BALL_R } from './physics.js';
import {
  W, H, DRAIN_Y, SWITCHES, RAMP_PATH, RAMP_EXIT_V, RAMP_TIME,
  buildTable, PLUNGER, DROP_COUNT, ART,
} from './table.js';

/**
 * Acceleration DOWN THE PLAYFIELD, table-units/s^2 - not free fall. The table is 400 x 760 units
 * standing in for a real 20.25 x 42 inch playfield, so one unit is 1.40 mm (which also makes the
 * 18-unit ball 25.3 mm, against a real pinball's 27 - the scale is honest, so this number can be
 * checked against a real machine and is, in test.js section 6e).
 *
 * 790 units/s^2 = 1.62 m/s^2 = g * sin(6.5 degrees), which is exactly how a real cabinet is set up.
 * It was 1150 until 2026-08-20: g * sin(9.5 degrees), steeper than any real machine (tournament
 * setups stop around 7) and the reason a playtester said the table felt "basically on a vertical
 * wall."
 *
 * THIS WAS A UNIFORM TIME-RESCALE, NOT A PHYSICS REWRITE, and that is the part to preserve. Every
 * velocity constant in physics.js and table.js was multiplied by sqrt(790/1150) at the same time -
 * MAX_SPEED, the flipper sweep rate, both plunger limits, both kicker strengths, the ramp exit and
 * its duration, the ramp's needUp gate. Since a ballistic rise is v^2/2g and both halves scaled
 * together, EVERY TRAJECTORY IS GEOMETRICALLY IDENTICAL to the shipped table: the shot map, the
 * clearances in table.js and the plunger skill curve are all untouched, and the ball simply travels
 * the same paths 21% slower. Change this number on its own and all of that silently drifts - the
 * plunger skill curve is the first thing to go, because minV is tuned to just barely FAIL to clear
 * the arch.
 */
export const GRAVITY = 790;

/** Difficulty is the shared 1-4 tier vocabulary on the stats WRITE path, so these keys go straight
 *  into byDiff and difficulty-tiers.js maps them for the leaderboard with no translation layer. */
export const DIFFS = {
  easy: { balls: 5, save: 12, gravity: 0.92, outlaneSaves: true },
  medium: { balls: 3, save: 8, gravity: 1.0, outlaneSaves: false },
  hard: { balls: 3, save: 3, gravity: 1.08, outlaneSaves: false },
};

export const PTS = {
  bumper: 1000, sling: 250, spinner: 300, lane: 1000, laneSet: 12000,
  drop: 2500, bankDone: 30000, ramp: 6000, rampCombo: 6000, orbit: 8000,
  scoop: 15000, lock: 40000, mbStart: 75000, jackpot: 60000, jackpotStep: 30000,
  superJackpot: 300000, standup: 1500, missionHit: 30000, skill: 50000,
};

/** The four timed missions, in fixed order. Each is started from the scoop once the drop bank has
 *  been cleared, and each is scored off ONE kind of switch, so the shot being asked for is always
 *  obvious from the table itself rather than only from the display. */
export const MISSIONS = [
  { id: 'bumper', need: 14, time: 26, lamp: 'pops' },
  { id: 'spin', need: 45, time: 26, lamp: 'orbit' },
  { id: 'ramp', need: 5, time: 30, lamp: 'ramp' },
  { id: 'target', need: 8, time: 26, lamp: 'bank' },
];

const EXTRA_BALL_AT = [750000, 2500000];
const BONUS_MAX_MULT = 8;
const RAMPS_TO_LIGHT_LOCK = 5;
const LOCKS_FOR_MULTIBALL = 3;
const COMBO_WINDOW = 6;          // seconds a ramp/orbit combo stays alive
const STUCK_NUDGE_AT = 3.5;      // seconds of near-zero speed before a gentle shove
const STUCK_RESERVE_AT = 8;      // ...and before the ball is re-served outright
// The ORBIT watchdog (see _drainTick). STUCK_* above catches a ball that is WEDGED; these catch a
// ball that is LOOPING, which is a different failure and the one this table actually has.
const LOOP_Y = 470;              // below this line is the slingshot/flipper pocket
const LOOP_MIN_SPEED = 70;       // under this the ball is cradled, not looping - leave it alone
const LOOP_BREAK_AT = 6;         // seconds of looping down there before the table shoves it out
const LOOP_KICK_OUT = 560;       // upward speed of that shove: clears the slingshot tops with room
const SLING_REPAY = 0.45;        // seconds before the same slingshot may score again
const MAX_HOLD = 3;              // seconds a ball may legitimately be HELD (ramp ride is 1.15)

/** Deterministic PRNG so test.js can replay a whole game exactly. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Position along the ramp habitrail at 0..1, plus the local direction (for drawing the ball's
 *  travel). Piecewise-linear over RAMP_PATH: the path has enough points that the seams are
 *  invisible and it stays trivially inspectable. */
export function rampPoint(t) {
  const n = RAMP_PATH.length - 1;
  const f = Math.max(0, Math.min(0.9999, t)) * n;
  const i = Math.floor(f);
  const k = f - i;
  const a = RAMP_PATH[i], b = RAMP_PATH[i + 1];
  return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), dx: b[0] - a[0], dy: b[1] - a[1] };
}

export class Pinball {
  /**
   * @param {{ difficulty?: string, rand?: () => number }} opts
   */
  constructor(opts = {}) {
    this.difficulty = DIFFS[opts.difficulty] ? opts.difficulty : 'medium';
    this.rand = opts.rand || Math.random;
    this.events = [];
    this.reset();
  }

  // --- lifecycle ---------------------------------------------------------------------------------

  reset() {
    const cfg = DIFFS[this.difficulty];
    const built = buildTable({ outlaneSaves: cfg.outlaneSaves });
    this.colliders = built.colliders;
    this.flippers = built.flippers;
    this.world = {
      colliders: this.colliders, flippers: this.flippers,
      gravity: GRAVITY * cfg.gravity, drag: 0.16, nudgeX: 0, nudgeY: 0,
    };
    this.balls = [];
    this.phase = 'attract';        // attract | ready | play | bonus | over
    this.score = 0;
    this.ball = 1;
    this.ballsTotal = cfg.balls;
    this.extraBalls = 0;
    this.extraAwarded = 0;
    this.time = 0;
    this.plungerPower = 0;
    this.plungerHeld = false;
    this.tiltMeter = 0;
    this.tilted = false;
    this.events.length = 0;
    this._resetBallState();
    this._resetGameProgress();
  }

  /** Everything that survives a drain but not a new game. */
  _resetGameProgress() {
    this.missionIdx = 0;
    this.missionsDone = 0;
    this.mission = null;
    this.bankLit = false;          // drop bank cleared: the scoop will start a mission
    this.locks = 0;
    this.lockLit = false;
    this.rampsForLock = 0;
    this.multiball = null;
    this.jackpots = 0;
    this.superLit = false;
    this.scoreMult = 1;
    this.stats = { bumpers: 0, ramps: 0, orbits: 0, drops: 0, spins: 0, jackpots: 0, multiballs: 0, missions: 0, bestBall: 0 };
    this.lanes = { laneH: false, laneU: false, laneB: false };
    this.laneSets = 0;
    this.slingPaid = {};
    this._resetDrops();
  }

  /** Everything that is per-ball: bonus, combos, the ball save. */
  _resetBallState() {
    this.bonus = { bumpers: 0, drops: 0, ramps: 0, orbits: 0, spins: 0, stands: 0, mult: 1 };
    this.ballScoreStart = this.score || 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.saveTimer = 0;
    this.skillLit = false;
  }

  _resetDrops() {
    this.drops = [];
    for (let i = 0; i < DROP_COUNT; i++) this.drops.push(false);
    for (const c of this.colliders) if (c.id && c.id.startsWith('drop')) c.on = true;
  }

  /** Start a new game. Serves ball 1 into the shooter lane. */
  start() {
    this.reset();
    this.phase = 'ready';
    this._serve();
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: 1 }, big: true });
    return this;
  }

  /** Put a fresh ball in the shooter lane, held on the plunger. */
  _serve() {
    const b = makeBall(PLUNGER.x, PLUNGER.y);
    b.held = true;
    b.onPlunger = true;
    b.sw = {};
    this.balls.push(b);
    this.plungerPower = 0;
    this.skillLit = true;
    this.saveTimer = DIFFS[this.difficulty].save;
  }

  // --- input -------------------------------------------------------------------------------------

  setFlipper(side, down) {
    if (this.tilted) down = false;
    const f = this.flippers[side === 'left' ? 0 : 1];
    if (f.pressed === down) return;
    f.pressed = down;
    if (down) this.emit({ type: 'flip', side });
  }

  plungerDown() { if (this._plungerBall()) this.plungerHeld = true; }

  plungerUp() {
    const b = this._plungerBall();
    this.plungerHeld = false;
    if (!b) return;
    const p = this.plungerPower;
    b.held = false;
    b.onPlunger = false;
    b.vy = -(PLUNGER.minV + (PLUNGER.maxV - PLUNGER.minV) * p);
    b.vx = 0;
    this.phase = 'play';
    this.emit({ type: 'launch', power: p });
    this.plungerPower = 0;
  }

  /** A nudge. Shoves every live ball and charges the tilt meter: three inside the decay window and
   *  the ball is dead with no bonus, exactly like the real thing. */
  nudge(dir) {
    if (this.tilted || this.phase !== 'play') return;
    const ax = dir === 'left' ? -190 : dir === 'right' ? 190 : 0;
    const ay = dir === 'up' ? -150 : 0;
    for (const b of this.balls) {
      if (!b.live || b.held) continue;
      b.vx += ax; b.vy += ay - 60;
    }
    this.tiltMeter += 1;
    this.emit({ type: 'nudge', dir });
    if (this.tiltMeter >= 3) {
      this.tilted = true;
      this.bonus.mult = 1;
      for (const k of Object.keys(this.bonus)) if (k !== 'mult') this.bonus[k] = 0;
      this.emit({ type: 'tilt' });
      this.emit({ type: 'msg', key: 'msg_tilt', big: true });
    } else if (this.tiltMeter === 2) {
      this.emit({ type: 'msg', key: 'msg_tilt_warn', big: true });
    }
  }

  // --- the frame ---------------------------------------------------------------------------------

  /** Advance by `dt` real seconds (clamped by the caller). Runs whole PHYS_DT steps only. */
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;

    if (this.phase === 'bonus') { this._bonusTick(dt); return; }
    if (this.phase === 'over' || this.phase === 'attract') return;

    if (this.plungerHeld) this.plungerPower = Math.min(1, this.plungerPower + dt * 1.15);
    if (this.saveTimer > 0) this.saveTimer = Math.max(0, this.saveTimer - dt);
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (this.tiltMeter > 0 && !this.tilted) this.tiltMeter = Math.max(0, this.tiltMeter - dt * 0.55);

    this._missionTick(dt);
    this._multiballTick(dt);
    this._heldTick(dt);

    const steps = Math.max(1, Math.round(dt / PHYS_DT));
    const onContact = (kind, id, x, y, speed, ball) => this._contact(kind, id, x, y, speed, ball);
    for (let i = 0; i < steps; i++) step(this.world, this.balls, onContact);

    this._switchTick(dt);
    this._drainTick(dt);
  }

  // --- contacts ----------------------------------------------------------------------------------

  _contact(kind, id, x, y, speed, ball) {
    if (kind === 'ball') { if (speed > 120) this.emit({ type: 'clack', x, y, speed }); return; }
    if (kind === 'flipper') { if (speed > 150) this.emit({ type: 'thock', x, y, speed }); return; }
    if (!id) return;
    if (speed < 24 && !id.startsWith('pop') && !id.startsWith('sling')) return;

    if (id.startsWith('pop')) {
      this.stats.bumpers++; this.bonus.bumpers++;
      this._award(PTS.bumper, x, y);
      this.emit({ type: 'bumper', id, x, y, speed });
      this._missionProgress('bumper', 1);
      return;
    }
    if (id.startsWith('sling')) {
      // Slingshot points are debounced PER SIDE. A slingshot is the one switch on this table that can
      // legitimately fire again a few hundredths of a second later, and the award used to be
      // unconditional - line 261 above also exempts slings from the low-speed filter that debounces
      // everything else - so a ball rattling in the pocket scored 250 a frame. A 2026-08-20
      // playtest banked 17,400 points that way on ONE ball while the upper playfield went untouched.
      // The flash and the sound still fire on every contact; only the SCORE is gated, so the table
      // still feels alive while a rattle stops paying like a shot.
      if (this.time - (this.slingPaid[id] ?? -99) >= SLING_REPAY) {
        this.slingPaid[id] = this.time;
        this._award(PTS.sling, x, y);
      }
      this.emit({ type: 'sling', id, x, y });
      return;
    }
    if (id.startsWith('drop')) {
      const i = Number(id.slice(4));
      if (this.drops[i]) return;
      this.drops[i] = true;
      const col = this.colliders.find((c) => c.id === id);
      if (col) col.on = false;
      this.stats.drops++; this.bonus.drops++;
      this._award(PTS.drop, x, y);
      this.emit({ type: 'drop', index: i, x, y });
      this._missionProgress('target', 1);
      if (this.drops.every(Boolean)) this._bankComplete(x, y);
      return;
    }
    if (id === 'standL' || id === 'standR') {
      this.bonus.stands++;
      this._award(PTS.standup, x, y);
      this.emit({ type: 'standup', id, x, y });
      return;
    }
    if (speed > 220) this.emit({ type: 'clink', x, y, speed });
  }

  _bankComplete(x, y) {
    this._award(PTS.bankDone, x, y, 'bank');
    this.bankLit = true;
    this.emit({ type: 'bankdone', x, y });
    this.emit({ type: 'msg', key: this.mission ? 'msg_bank_again' : 'msg_bank_done', big: true });
    // The bank pops straight back up: with four targets and one bank on the table, leaving it down
    // would remove a third of the shots for the rest of the ball.
    setZero(this.drops);
    for (const c of this.colliders) if (c.id && c.id.startsWith('drop')) c.on = true;
  }

  // --- switches ------------------------------------------------------------------------------------

  /** Edge-detect every switch against every ball.
   *
   *  `inside` IS PURELY GEOMETRIC, AND THAT IS THE WHOLE POINT. The first version wrote
   *  `!b.held && dist < s.r`, which quietly turned the scoop into an infinite scoring loop: a held
   *  ball reads as "outside", so the instant the scoop ejected it - still inside its own 10-unit
   *  radius, because a capture parks the ball ON the switch centre - the detector saw a fresh
   *  RISING EDGE and captured it again. Eject, re-capture, score, eject, forever. Matt hit the
   *  scoop once and banked 1.5 million on ball one while the ball sat there (2026-08-11).
   *
   *  Geometrically, a held ball in the scoop is inside the switch, so the flag stays true, no new
   *  edge is generated, and the switch only re-arms once the ball has genuinely left the radius.
   *  A ball riding the ramp leaves `rampIn` naturally, because the habitrail carries it away. */
  _switchTick() {
    for (const b of this.balls) {
      if (!b.live) continue;
      if (!b.sw) b.sw = {};
      for (const s of SWITCHES) {
        const inside = Math.hypot(b.x - s.x, b.y - s.y) < s.r;
        const was = !!b.sw[s.id];
        b.sw[s.id] = inside;
        if (inside && !was) this._switchHit(s, b);
      }
    }
  }

  _switchHit(s, b) {
    switch (s.id) {
      case 'spinner': {
        // One pass, many clicks: the faster the ball crosses, the longer it rips. That is the one
        // switch on the table whose value depends on how well the shot was hit.
        const rips = Math.max(1, Math.min(12, Math.round(Math.abs(b.vy) / 55)));
        this.bonus.spins += rips; this.stats.spins += rips;
        this._award(PTS.spinner * rips, s.x, s.y, 'spinner');
        this.emit({ type: 'spinner', rips, x: s.x, y: s.y });
        this._missionProgress('spin', rips);
        break;
      }
      case 'orbitTop': {
        this.stats.orbits++; this.bonus.orbits++;
        this._combo();
        this._award(PTS.orbit * this.combo, s.x, s.y, 'orbit');
        this.emit({ type: 'orbit', combo: this.combo, x: s.x, y: s.y });
        break;
      }
      case 'laneH': case 'laneU': case 'laneB': {
        if (this.lanes[s.id]) { this._award(PTS.lane / 2, s.x, s.y); break; }
        this.lanes[s.id] = true;
        this._award(PTS.lane, s.x, s.y);
        this.emit({ type: 'lane', id: s.id, x: s.x, y: s.y });
        if (this.lanes.laneH && this.lanes.laneU && this.lanes.laneB) {
          this.lanes = { laneH: false, laneU: false, laneB: false };
          this.laneSets++;
          this.bonus.mult = Math.min(BONUS_MAX_MULT, this.bonus.mult + 1);
          this._award(PTS.laneSet, s.x, s.y, 'lanes');
          this.emit({ type: 'laneset', mult: this.bonus.mult });
          this.emit({ type: 'msg', key: 'msg_bonus_x', params: { n: this.bonus.mult }, big: true });
        }
        break;
      }
      case 'rampIn': {
        if (b.vy > -60) break;                       // rolling back down: not a made ramp
        if (b.vy > -s.needUp) {                      // hit it, but not hard enough
          b.vy = 200; b.vx += (this.rand() - 0.5) * 90;
          this.emit({ type: 'rampreject', x: s.x, y: s.y });
          break;
        }
        b.held = true;
        b.ramp = 0;
        b.vx = 0; b.vy = 0;
        this._rampMade(b);
        break;
      }
      case 'scoop': {
        b.held = true;
        b.scoop = 0.45;
        b.x = s.x; b.y = s.y; b.vx = 0; b.vy = 0;
        this._scoopMade(b);
        break;
      }
      case 'inlaneL': case 'inlaneR':
        this._award(500, s.x, s.y);
        this.emit({ type: 'inlane', id: s.id, x: s.x, y: s.y });
        break;
      case 'outlaneL': case 'outlaneR':
        this.emit({ type: 'outlane', id: s.id, x: s.x, y: s.y });
        break;
      default: break;
    }
  }

  _combo() {
    this.combo = this.comboTimer > 0 ? Math.min(6, this.combo + 1) : 1;
    this.comboTimer = COMBO_WINDOW;
  }

  _rampMade(b) {
    this.stats.ramps++; this.bonus.ramps++;
    this._combo();
    if (this.multiball) {
      this.jackpots++;
      const v = PTS.jackpot + PTS.jackpotStep * (this.jackpots - 1);
      this.stats.jackpots++;
      this._award(v, b.x, b.y, 'jackpot');
      this.emit({ type: 'jackpot', value: v, x: b.x, y: b.y });
      this.emit({ type: 'msg', key: 'msg_jackpot', params: { n: fmt(v) }, big: true });
      if (this.jackpots >= 3 && !this.superLit) {
        this.superLit = true;
        this.emit({ type: 'msg', key: 'msg_super_lit', big: true });
      }
    } else {
      this._award(PTS.ramp + PTS.rampCombo * (this.combo - 1), b.x, b.y, 'ramp');
      this.emit({ type: 'ramp', combo: this.combo, x: b.x, y: b.y });
      if (!this.lockLit && this.locks < LOCKS_FOR_MULTIBALL) {
        this.rampsForLock++;
        if (this.rampsForLock >= RAMPS_TO_LIGHT_LOCK) {
          this.rampsForLock = 0;
          this.lockLit = true;
          this.emit({ type: 'msg', key: 'msg_lock_lit', big: true });
          this.emit({ type: 'lightlock' });
        }
      }
    }
    this._missionProgress('ramp', 1);
  }

  /** The scoop is the table's one multi-purpose shot, so its priority order is fixed and is the
   *  same order the display announces: super jackpot, then a mission start, then a lock, then
   *  plain points. Anything else and the player cannot predict what their best shot will do. */
  _scoopMade(b) {
    if (this.multiball && this.superLit) {
      this.superLit = false;
      this.jackpots = 0;
      this.stats.jackpots++;
      this._award(PTS.superJackpot * (this.multiball.wizard ? 2 : 1), b.x, b.y, 'super');
      this.emit({ type: 'superjackpot', x: b.x, y: b.y });
      this.emit({ type: 'msg', key: 'msg_super', big: true });
      return;
    }
    if (this.bankLit && !this.mission && this.missionIdx < MISSIONS.length) {
      this.bankLit = false;
      this._startMission();
      return;
    }
    if (this.lockLit) {
      this.lockLit = false;
      this.locks++;
      this._award(PTS.lock, b.x, b.y, 'lock');
      this.emit({ type: 'lock', n: this.locks, x: b.x, y: b.y });
      if (this.locks >= LOCKS_FOR_MULTIBALL) {
        this.locks = 0;
        b.scoop = 0.9;
        this._startMultiball(false);
      } else {
        this.emit({ type: 'msg', key: 'msg_lock_n', params: { n: this.locks }, big: true });
      }
      return;
    }
    this._award(PTS.scoop, b.x, b.y, 'scoop');
    this.emit({ type: 'scoop', x: b.x, y: b.y });
  }

  // --- missions --------------------------------------------------------------------------------

  _startMission() {
    const def = MISSIONS[this.missionIdx];
    this.mission = { ...def, got: 0, left: def.time };
    this.emit({ type: 'missionstart', id: def.id, index: this.missionIdx });
    this.emit({ type: 'msg', key: `mission_${def.id}`, big: true });
  }

  _missionProgress(kind, n) {
    const m = this.mission;
    if (!m || m.id !== kind) return;
    m.got += n;
    this._award(PTS.missionHit, null, null);
    this.emit({ type: 'missionhit', got: m.got, need: m.need });
    if (m.got >= m.need) this._finishMission(true);
  }

  _finishMission(won) {
    const m = this.mission;
    this.mission = null;
    if (!won) { this.emit({ type: 'missionfail', id: m.id }); this.emit({ type: 'msg', key: 'msg_mission_fail' }); return; }
    this.missionsDone++;
    this.stats.missions++;
    this.missionIdx++;
    const award = 120000 * this.missionsDone;
    this._award(award, null, null, 'mission');
    this.emit({ type: 'missiondone', id: m.id, award });
    this.emit({ type: 'msg', key: 'msg_mission_done', params: { n: fmt(award) }, big: true });
    if (this.missionIdx >= MISSIONS.length && !this.multiball) this._startMultiball(true);
  }

  _missionTick(dt) {
    if (!this.mission) return;
    this.mission.left -= dt;
    if (this.mission.left <= 0) this._finishMission(false);
  }

  // --- multiball --------------------------------------------------------------------------------

  _startMultiball(wizard) {
    this.multiball = { wizard, left: wizard ? 45 : 0, feed: 0.7, toFeed: 2 };
    this.jackpots = 0;
    this.superLit = false;
    this.stats.multiballs++;
    this.scoreMult = wizard ? 3 : 1;
    this.saveTimer = Math.max(this.saveTimer, 8);
    this._award(PTS.mbStart * (wizard ? 3 : 1), null, null, 'multiball');
    this.emit({ type: 'multiball', wizard });
    this.emit({ type: 'msg', key: wizard ? 'msg_wizard' : 'msg_multiball', big: true });
  }

  _multiballTick(dt) {
    const mb = this.multiball;
    if (!mb) return;
    if (mb.toFeed > 0) {
      mb.feed -= dt;
      if (mb.feed <= 0) {
        mb.feed = 0.7;
        mb.toFeed--;
        const b = makeBall(PLUNGER.x, PLUNGER.y, 0, -PLUNGER.maxV);
        b.sw = {};
        this.balls.push(b);
        this.emit({ type: 'launch', power: 1, auto: true });
      }
    }
    if (mb.wizard) {
      mb.left -= dt;
      if (mb.left <= 0) this._endMultiball();
    }
  }

  _endMultiball() {
    if (!this.multiball) return;
    const wiz = this.multiball.wizard;
    this.multiball = null;
    this.scoreMult = 1;
    this.superLit = false;
    this.jackpots = 0;
    if (wiz) { this.missionIdx = 0; this.missionsDone = 0; }   // the loop reopens, harder each time
    this.emit({ type: 'multiballend' });
  }

  // --- held balls (ramp ride, scoop hold) -------------------------------------------------------

  _heldTick(dt) {
    for (const b of this.balls) {
      if (!b.live || !b.held) continue;
      if (b.onPlunger) { b.x = PLUNGER.x; b.y = PLUNGER.y + this.plungerPower * 16; continue; }
      if (b.ramp != null) {
        b.ramp += dt / RAMP_TIME;
        const p = rampPoint(b.ramp);
        b.x = p.x; b.y = p.y;
        if (b.ramp >= 1) {
          b.ramp = null; b.held = false;
          b.vx = RAMP_EXIT_V[0]; b.vy = RAMP_EXIT_V[1];
          this.emit({ type: 'rampexit', x: b.x, y: b.y });
        }
        continue;
      }
      if (b.scoop != null) {
        b.scoop -= dt;
        if (b.scoop <= 0) {
          b.scoop = null; b.held = false;
          b.vx = -90; b.vy = 480;
          this.emit({ type: 'kickout', x: b.x, y: b.y });
        }
      }
    }
  }

  // --- drains, ball end, bonus ------------------------------------------------------------------

  _drainTick(dt) {
    let drained = 0;
    for (const b of this.balls) {
      if (!b.live) continue;
      // A HELD ball is exempt from the stuck watchdog below (it is meant to be motionless), which
      // is precisely why it needs its own ceiling: the scoop loop parked a ball "held" forever and
      // the watchdog never looked at it once. Every legitimate hold is short and known - the ramp
      // ride is RAMP_TIME (1.15 s) and a scoop hold is under a second - so anything past MAX_HOLD
      // is a bug, and the honest response is to hand the ball back to play and say so loudly
      // rather than let it sit there.
      if (b.held) {
        b.restTime = 0;
        if (b.onPlunger) { b.heldFor = 0; continue; }
        b.heldFor = (b.heldFor || 0) + dt;
        if (b.heldFor > MAX_HOLD) {
          console.error('[pinball] a ball was held for %ss; releasing it. This is a bug.', b.heldFor.toFixed(1));
          b.heldFor = 0; b.ramp = null; b.scoop = null; b.held = false;
          b.vx = -90; b.vy = 480;
          this.emit({ type: 'ballsearch' });
        }
        continue;
      }
      b.heldFor = 0;

      // Escape hatch. Nothing in the geometry should let a ball out, and test.js's soak asserts it
      // never happens, but a physics bug that loses the ball silently is far worse than one that
      // says so: treat it as a drain and keep the game playable.
      if (b.x < -20 || b.x > W + 20 || b.y < -60) { b.live = false; drained++; continue; }

      if (b.y > DRAIN_Y) { b.live = false; drained++; this.emit({ type: 'drain', x: b.x, y: b.y }); continue; }

      // A ball that came back down the shooter lane is not stuck, it is a weak plunge. Hand it back
      // to the plunger promptly instead of letting the generic watchdog sit on it for eight seconds
      // - a dead-looking table is the fastest way to make a player think the game has broken.
      if (b.x > PLUNGER.laneX && b.y > 620 && Math.hypot(b.vx, b.vy) < 60) {
        b.laneRest = (b.laneRest || 0) + dt;
        if (b.laneRest > 0.5) {
          b.laneRest = 0; b.restTime = 0;
          b.x = PLUNGER.x; b.y = PLUNGER.y; b.vx = 0; b.vy = 0;
          b.held = true; b.onPlunger = true;
          this.plungerPower = 0;
          if (this.phase === 'play') this.phase = 'ready';
          this.emit({ type: 'reload' });
        }
        continue;
      }
      b.laneRest = 0;

      // Stuck-ball watchdog: a real table has one (the "ball search"), and a 2D table with arcs and
      // one-way gates needs one more, not less. Shove first, re-serve only if the shove failed.
      //
      // MEASURED AS DISPLACEMENT FROM AN ANCHOR, NOT AS INSTANTANEOUS SPEED. The first version
      // watched for speed < 26 and never fired, because the failure it exists for does not look
      // slow: a ball wedged between two convex surfaces jitters, crossing any speed threshold
      // several times a second while going precisely nowhere. Displacement cannot be fooled that
      // way - if the ball has not moved a ball-width in four seconds, it is stuck, whatever its
      // velocity says.
      if (Math.hypot(b.x - (b.ax ?? b.x), b.y - (b.ay ?? b.y)) > 16) {
        b.ax = b.x; b.ay = b.y; b.restTime = 0;
      } else {
        if (b.ax == null) { b.ax = b.x; b.ay = b.y; }
        b.restTime += dt;
        if (b.restTime > STUCK_RESERVE_AT) {
          b.x = PLUNGER.x; b.y = PLUNGER.y; b.vx = 0; b.vy = 0;
          b.held = true; b.onPlunger = true; b.restTime = 0;
          this.plungerPower = 0;
          if (this.phase === 'play' && this.balls.filter((x) => x.live).length === 1) this.phase = 'ready';
          this.emit({ type: 'ballsearch' });
        } else if (b.restTime > STUCK_NUDGE_AT) {
          b.vx += (this.rand() - 0.5) * 260;
          b.vy -= 190;
          b.restTime = STUCK_NUDGE_AT * 0.4;
          this.emit({ type: 'ballsearch', soft: true });
        }
      }

      // ORBIT watchdog. The block above measures DISPLACEMENT FROM AN ANCHOR, so all it can see is a
      // ball that is wedged and still. It is structurally blind to the failure this table actually
      // has: a ball ping-ponging between the two slingshots travels 60+ units a cycle, so it resets
      // that anchor several times a second while going nowhere that matters - not on a shot, not
      // draining, just farming the slings. A 2026-08-20 playtest recorded 26 seconds of exactly that
      // on one ball, with the entire upper playfield untouched and the mission banner unchanged, and
      // the displacement watchdog never fired once in 708 s of simulated play.
      //
      // Measured as TIME SPENT BELOW THE SLINGSHOTS WHILE STILL MOVING, which a lively loop cannot
      // fool the way it fools displacement. A cradled ball (under LOOP_MIN_SPEED) is exempt on
      // purpose: trapping the ball on a flipper is a skill, and the displacement watchdog above is
      // already what covers a genuinely dead one. This is a hard time bound, not a tuning knob - it
      // holds at every difficulty and survives any later change to the slingshot geometry.
      if (b.y > LOOP_Y && Math.hypot(b.vx, b.vy) > LOOP_MIN_SPEED) {
        b.loopFor = (b.loopFor || 0) + dt;
        if (b.loopFor > LOOP_BREAK_AT) {
          b.loopFor = 0;
          b.vx += (this.rand() - 0.5) * 180;
          b.vy = -Math.max(Math.abs(b.vy), LOOP_KICK_OUT);
          this.emit({ type: 'ballsearch', soft: true });
        }
      } else if (b.y < LOOP_Y) {
        b.loopFor = 0;
      }
    }
    if (drained) this.balls = this.balls.filter((b) => b.live);

    const live = this.balls.length;
    if (this.multiball && live <= 1 && this.multiball.toFeed === 0) this._endMultiball();
    if (live > 0) return;

    if (this.saveTimer > 0 && !this.tilted) {
      this.emit({ type: 'ballsave' });
      this.emit({ type: 'msg', key: 'msg_ball_saved', big: true });
      this._serve();
      this.phase = 'ready';
      return;
    }
    this._endBall();
  }

  _endBall() {
    const ballScore = this.score - this.ballScoreStart;
    if (ballScore > this.stats.bestBall) this.stats.bestBall = ballScore;
    if (this.mission) this._finishMission(false);
    this._endMultiball();
    const b = this.bonus;
    const base = b.bumpers * 150 + b.drops * 600 + b.ramps * 1500 + b.orbits * 1200 + b.spins * 60 + b.stands * 400;
    this.pendingBonus = { total: base * b.mult, paid: 0, base, mult: b.mult, t: 0 };
    this.phase = 'bonus';
    this.emit({ type: 'bonusstart', total: this.pendingBonus.total, base, mult: b.mult });
  }

  /** Bonus is counted UP over ~1.5 s rather than dumped, because the count-up is the moment the
   *  player finds out whether the lane multiplier was worth chasing. */
  _bonusTick(dt) {
    const p = this.pendingBonus;
    p.t += dt;
    const want = Math.min(p.total, Math.round(p.total * Math.min(1, p.t / 1.5)));
    if (want > p.paid) {
      this._award(want - p.paid, null, null, null, true);
      p.paid = want;
      this.emit({ type: 'bonustick', paid: p.paid, total: p.total });
    }
    if (p.t < 1.7) return;
    this.pendingBonus = null;
    this._nextBall();
  }

  _nextBall() {
    this.tilted = false;
    this.tiltMeter = 0;
    if (this.extraBalls > 0) {
      this.extraBalls--;
      this._resetBallState();
      this._serve();
      this.phase = 'ready';
      this.emit({ type: 'msg', key: 'msg_shoot_again', big: true });
      return;
    }
    if (this.ball >= this.ballsTotal) {
      this.phase = 'over';
      this.emit({ type: 'gameover', score: this.score });
      return;
    }
    this.ball++;
    this._resetBallState();
    this._resetDrops();
    this.lanes = { laneH: false, laneU: false, laneB: false };
    this._serve();
    this.phase = 'ready';
    this.emit({ type: 'msg', key: 'msg_ball_n', params: { n: this.ball }, big: true });
  }

  // --- scoring ----------------------------------------------------------------------------------

  _award(points, x, y, label, silent) {
    if (this.tilted && !silent) return;              // a tilted table scores nothing. That is the point.
    const v = Math.round(points * this.scoreMult);
    this.score += v;
    if (!silent) this.emit({ type: 'score', value: v, x, y, label });
    for (let i = this.extraAwarded; i < EXTRA_BALL_AT.length; i++) {
      if (this.score >= EXTRA_BALL_AT[i]) {
        this.extraAwarded = i + 1;
        this.extraBalls++;
        this.emit({ type: 'extraball' });
        this.emit({ type: 'msg', key: 'msg_extra_ball', big: true });
      }
    }
  }

  emit(ev) { this.events.push(ev); if (this.events.length > 400) this.events.splice(0, 200); }

  /** Drain the event queue. ui.js calls this once a frame. */
  takeEvents() { const e = this.events; this.events = []; return e; }

  _plungerBall() { return this.balls.find((b) => b.onPlunger) || null; }

  /** Everything the HUD needs, in one snapshot, so ui.js never reaches into internals. */
  hud() {
    return {
      score: this.score, ball: this.ball, ballsTotal: this.ballsTotal,
      phase: this.phase, mult: this.bonus.mult, scoreMult: this.scoreMult,
      save: this.saveTimer, tilt: this.tilted, tiltMeter: this.tiltMeter,
      mission: this.mission ? { id: this.mission.id, got: this.mission.got, need: this.mission.need, left: this.mission.left } : null,
      multiball: !!this.multiball, wizard: !!(this.multiball && this.multiball.wizard),
      locks: this.locks, lockLit: this.lockLit, bankLit: this.bankLit, superLit: this.superLit,
      missionsDone: this.missionsDone, extraBalls: this.extraBalls,
      power: this.plungerPower, onPlunger: !!this._plungerBall(),
    };
  }

  /** What game.js hands the stats recorder at game over. Counters only, all additive. */
  result() {
    return {
      score: this.score,
      difficulty: this.difficulty,
      jackpots: this.stats.jackpots,
      multiballs: this.stats.multiballs,
      missions: this.stats.missions,
      ramps: this.stats.ramps,
      bestBall: this.stats.bestBall,
    };
  }
}

function setZero(arr) { for (let i = 0; i < arr.length; i++) arr[i] = false; }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

export { ART, BALL_R };
export default { Pinball, DIFFS, MISSIONS, PTS, GRAVITY, mulberry32, rampPoint };
