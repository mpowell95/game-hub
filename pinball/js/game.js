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
  buildTable, PLUNGER, DROP_COUNT, ART, MM_PER_UNIT,
} from './table.js';

/** Standard gravity, mm/s^2. */
const G_MM = 9806.65;

/**
 * The playfield's downhill acceleration, in table units/s^2, for a pitch in DEGREES.
 *
 * THIS FUNCTION IS THE FIX FOR "the ball falls as if the machine is a vertical wall" (Matt,
 * 2026-08-14). A real cabinet is pitched about 6.5 degrees and the ball ROLLS rather than slides,
 * so a solid sphere's linear acceleration is (5/7) * g * sin(pitch) = 0.79 m/s^2 - one twelfth of
 * a free fall. The old table used a flat 1150 units/s^2, which on this scale works out at an
 * effective pitch of about 14 degrees, so every shot arced back down about twice as fast as it
 * should and the table read as a wall seen edge-on.
 *
 * The three difficulties are now literally the three pitches a real operator would choose between,
 * which is also why they are so close together: 6 to 7 degrees IS the whole adjustment range.
 */
export function gravityForPitch(deg) {
  return (5 / 7) * G_MM * Math.sin(deg * Math.PI / 180) / MM_PER_UNIT;
}

/** Difficulty is the shared 1-4 tier vocabulary on the stats WRITE path, so these keys go straight
 *  into byDiff and difficulty-tiers.js maps them for the leaderboard with no translation layer.
 *  `pitch` is the playfield angle in degrees; see gravityForPitch(). */
export const DIFFS = {
  easy: { balls: 5, save: 12, pitch: 6.0, outlaneSaves: true },
  medium: { balls: 3, save: 8, pitch: 6.5, outlaneSaves: false },
  hard: { balls: 3, save: 3, pitch: 7.0, outlaneSaves: false },
};

/** Kept as the medium-pitch value so anything reading a single "gravity" number still gets a
 *  sensible one. The live figure always comes from gravityForPitch(). */
export const GRAVITY = gravityForPitch(DIFFS.medium.pitch);

export const PTS = {
  bumper: 1000, sling: 250, spinner: 300, lane: 1000, laneSet: 12000,
  drop: 2500, bankDone: 30000, ramp: 6000, rampCombo: 6000, orbit: 8000,
  scoop: 15000, lock: 40000, mbStart: 75000, jackpot: 60000, jackpotStep: 30000,
  superJackpot: 300000, standup: 1500, missionHit: 30000, skill: 50000,
  post: 150, star: 2500,
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
const MAX_HOLD = 3;              // seconds a ball may legitimately be HELD (ramp ride is 1.15)
const STUCK_MOVE = 18;           // units of travel that count as "the ball is going somewhere"

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
      gravity: gravityForPitch(cfg.pitch), nudgeX: 0, nudgeY: 0,
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

  /** One button per side drives BOTH flippers on that side - the main one and the upper one. That
   *  is how a real machine with an upper flipper is wired (there is no third button on a pinball
   *  cabinet), and it is what makes the upper pair a skill rather than a second set of controls. */
  setFlipper(side, down) {
    if (this.tilted) down = false;
    const ids = side === 'left' ? ['flipL', 'flipUL'] : ['flipR', 'flipUR'];
    let changed = false;
    for (const f of this.flippers) {
      if (!ids.includes(f.id) || f.pressed === down) continue;
      f.pressed = down;
      changed = true;
    }
    if (changed && down) this.emit({ type: 'flip', side });
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
    const ax = dir === 'left' ? -300 : dir === 'right' ? 300 : 0;
    const ay = dir === 'up' ? -240 : 0;
    for (const b of this.balls) {
      if (!b.live || b.held) continue;
      b.vx += ax; b.vy += ay - 95;
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
    const onContact = (kind, id, x, y, speed, ball, fired) => this._contact(kind, id, x, y, speed, ball, fired);
    for (let i = 0; i < steps; i++) step(this.world, this.balls, onContact);

    this._switchTick(dt);
    this._drainTick(dt);
  }

  // --- contacts ----------------------------------------------------------------------------------

  /** `fired` (from physics.js) is true only when a solenoid actually pulsed. A slingshot whose coil
   *  is still re-arming is just a piece of rubber, and it must not score - otherwise the re-arm
   *  fixes the resonance in the physics and leaves it in the score, which is the half a player
   *  would actually see. `_contact` is also the entry point the tests drive directly, so `fired`
   *  defaults to true when it is not supplied. */
  _contact(kind, id, x, y, speed, ball, fired = true) {
    if (kind === 'ball') { if (speed > 180) this.emit({ type: 'clack', x, y, speed }); return; }
    if (kind === 'flipper') { if (speed > 225) this.emit({ type: 'thock', x, y, speed }); return; }
    if (!id) return;
    const solenoid = id.startsWith('pop') || id.startsWith('sling');
    if (solenoid && !fired) return;
    if (speed < 36 && !solenoid) return;

    if (id.startsWith('pop')) {
      this.stats.bumpers++; this.bonus.bumpers++;
      this._award(PTS.bumper, x, y);
      this.emit({ type: 'bumper', id, x, y, speed });
      this._missionProgress('bumper', 1);
      return;
    }
    if (id.startsWith('sling')) {
      this._award(PTS.sling, x, y);
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
    if (id.startsWith('arcPost')) {
      this._award(PTS.post, x, y);
      this.emit({ type: 'post', id, x, y });
      return;
    }
    if (speed > 330) this.emit({ type: 'clink', x, y, speed });
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
        const rips = Math.max(1, Math.min(12, Math.round(Math.abs(b.vy) / 85)));
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
      // The centre rollover above the teardrop. It is the SKILL SHOT: `skillLit` is set when a ball
      // is served and cleared by anything that scores, so the big award is only there for a player
      // who threads it on the very first shot of the ball. (PTS.skill and `skillLit` both existed
      // from day one and nothing ever read them; this is the shot they were waiting for.)
      case 'star': {
        if (this.skillLit) {
          this.skillLit = false;
          this._award(PTS.skill, s.x, s.y, 'skill');
          this.emit({ type: 'skill', x: s.x, y: s.y });
          this.emit({ type: 'msg', key: 'msg_skill', big: true });
        } else {
          this._combo();
          this._award(PTS.star * this.combo, s.x, s.y);
          this.emit({ type: 'star', combo: this.combo, x: s.x, y: s.y });
        }
        break;
      }
      case 'rampIn': {
        if (b.vy > -90) break;                       // rolling back down: not a made ramp
        if (b.vy > -s.needUp) {                      // hit it, but not hard enough
          b.vy = 320; b.vx += (this.rand() - 0.5) * 140;
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
          // ACROSS the table, not straight down, and jittered. A gentle downward kickout put the
          // ball on a perfectly repeatable path that walked it back into the scoop's own mouth:
          // six soak games produced 185 scoop awards, 184 of them arriving at exactly
          // (312, 334) with exactly (255, -606) of velocity. A saucer that reloads itself is a
          // slot machine, not a shot. Real kickouts are hard and slightly unrepeatable, so this
          // one throws left across the playfield with a random component off the seeded PRNG (so
          // a replayed game is still identical).
          b.vx = -430 - this.rand() * 150;
          b.vy = 380 + this.rand() * 160;
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
          b.vx = -160; b.vy = 620;
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
      if (b.x > PLUNGER.laneX && b.y > 660 && Math.hypot(b.vx, b.vy) < 90) {
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
      if (Math.hypot(b.x - (b.ax ?? b.x), b.y - (b.ay ?? b.y)) > STUCK_MOVE) {
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
          b.vx += (this.rand() - 0.5) * 400;
          b.vy -= 290;
          b.restTime = STUCK_NUDGE_AT * 0.4;
          this.emit({ type: 'ballsearch', soft: true });
        }
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
    // The skill shot is only there for the FIRST thing a ball does. Anything else that scores
    // spends it, which is what makes threading the star rollover off the plunge worth the risk.
    if (!silent && label !== 'skill') this.skillLit = false;
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
export default { Pinball, DIFFS, MISSIONS, PTS, GRAVITY, gravityForPitch, mulberry32, rampPoint };
