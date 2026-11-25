// sim.js — fixed-timestep simulation (brief section 3, non-negotiables 1 and 2).
// Owns plain-data game state only: ball position/speed, run status, score. No
// Three.js objects are read or written here; render.js maps this state onto
// meshes every animation frame. step() advances exactly one SIM_DT tick.

import {
  SIM_DT, BALL_RADIUS, BALL_DIAMETER, SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND,
  OBSTACLE_SIZE, DRAG_SENSITIVITY, STEER_MAX_SPEED_BASE, LATERAL_MAX_SPEED_BASE,
  LATERAL_SPEED_SCALE_WITH_FORWARD, LATERAL_DAMPING, FALL_GRAVITY,
  CRASH_BEAT_MS, difficultyConfig,
} from './config.js';
import { Track } from './track.js';

export const RunState = Object.freeze({
  PLAYING: 'playing',
  AIRBORNE: 'airborne', // mid-Jump flight (BALLRUNMAP2ORBITALSPEC.md section 3): no edge/obstacle/
                         // void checks, only the landing check can end this - steering still works
  CRASHING: 'crashing', // obstacle hit: forward motion stopped, brief beat before game-over
  FALLING: 'falling',   // off the edge: gravity drop, camera holds, brief beat before game-over
  GAME_OVER: 'gameover',
});

export class Sim {
  constructor(mapKey, difficultyKey, seed) {
    this.mapKey = mapKey;
    this.difficultyKey = difficultyKey;
    this.cfg = difficultyConfig(difficultyKey);
    this.track = new Track(mapKey, difficultyKey, seed);

    this.state = RunState.PLAYING;
    this.elapsed = 0;       // seconds of active play (paused time excluded)
    this.z = 0;              // forward distance traveled; kept for track-generation pacing, speedpoint
                              // timing, and a secondary flavor stat (fourth-playthrough item 2) - NOT the score
    this.speed = this.cfg.baseSpeed;
    this.tiersPassed = 0;

    // Score (fourth-playthrough item 2): +1 the moment the ball's z crosses the far edge (z1) of an
    // obstacle row segment, without the run ending on that row. Every spawned row is its own track
    // segment (see track.js's placeObstacleRow), including each row of a merged combined pattern, so
    // scoring one point per crossed obstacle-type segment automatically scores merged patterns one
    // point per row. Rows the generator dropped during auto-repair never became a segment, so they
    // never score. _lastScoredSegmentIndex tracks the highest track segment index already resolved
    // (scored or not) so each segment is only ever considered once, scanned forward with zero
    // allocations (plain array index scan, breaks as soon as it reaches an uncrossed segment).
    this.score = 0;
    this._lastScoredSegmentIndex = -1;

    this.lateralOffset = 0;  // relative to the track centerline
    this.lateralVelocity = 0;
    this._keySteer = false;  // the sideways speed left over came from an arrow key (it coasts out, as it always did)
    this.steerOwed = 0;      // world units of finger drag the ball has not travelled yet (see steer())

    this.rollAngle = 0;      // ball roll, radians, driven by forward speed (visual, but cheap enough to keep as sim data)

    this.crashTimer = 0;
    this.fallVelocityY = 0;
    this.fallY = 0;
    this.crashReason = null; // 'obstacle' | 'edge'

    // Guards so a tunnel's speed-tier bonus is only ever applied once.
    this._countedTunnelIndex = -1;

    // Jump (Orbital only, section 3): `y` is the ball's world HEIGHT, kept in sync every tick
    // regardless of state - `track.frameAt(z).y` while grounded (always 0 outside a Jump's own
    // segments), physics-integrated while AIRBORNE. render.js reads this directly for the ball's
    // vertical position and the camera's height damping; it is 0 for the lifetime of any run that
    // never encounters a Jump (Classic, or Orbital before Phase 3), so this is a no-op change for
    // every map/event this file already supported.
    this.y = 0;
    this.vy = 0;
    this.jumpLandingY = 0;
    this.jumpGravity = 0;
    this._lastGapEntryIndex = -1; // guards a jump's launch to fire exactly once, mirrors _countedTunnelIndex

    // Pickups (Phase 4, Orbital only): `lives` is a banked extra-chance count (0 on every map/run
    // that never spawns one - Classic, or Orbital before this phase - so this is a no-op change
    // for everything this file already supported). `invincibleUntil` is an `elapsed` timestamp;
    // spending a life buys a grace window during which the obstacle/void/edge checks below are
    // skipped entirely, not "survive this one hit" - see stepPlaying's own comment on why.
    // `orbsCollected` is a secondary flavor stat (mirrors `tiersPassed`), not the score itself -
    // an orb's value is added straight to `this.score`, the same tally Split/Jump already add to.
    this.lives = 0;
    this.invincibleUntil = 0;
    this.orbsCollected = 0;
    // Per-run facts saved with the result (2026-11-16, Matt: "save all data from every play"). Plain
    // counters, read by ui.js's runDetail(); nothing in the sim reads them back.
    this.stats = { obst: 0, splits: 0, jumps: 0, jumpMiss: 0, lifeGot: 0, lifeUsed: 0, saves: {}, topSpeed: this.speed };
    this.crashCause = null; // 'obstacle' | 'edge' | 'void' | 'landing' (crashReason stays 'obstacle'|'edge' for the screens)
    // Transient event queue (Phase 4 follow-up): `{ type: 'orb'|'life'|'lifeSpent' }` pushed the
    // instant each happens, so render.js/ui.js can trigger a one-shot animation (a "+1" floater,
    // "extra life used!") tied to the actual moment rather than inferring it from a value change
    // next frame. Plain data, no callbacks - matches this file's "owns plain-data state only"
    // discipline. ui.js drains (splices) this every rendered frame, since several ticks can run
    // per frame under the fixed-timestep accumulator and none should be missed.
    this.pickupEvents = [];
  }

  /** One fixed-step tick. dragAxis is the normalized drag delta accumulated this tick; keyAxis is -1/0/1. */
  step(dragAxis, keyAxis) {
    const dt = SIM_DT;
    if (this.state === RunState.PLAYING) this.stepPlaying(dt, dragAxis, keyAxis);
    else if (this.state === RunState.AIRBORNE) this.stepAirborne(dt, dragAxis, keyAxis);
    else if (this.state === RunState.CRASHING) this.stepCrashing(dt);
    else if (this.state === RunState.FALLING) this.stepFalling(dt);
  }

  /** Sideways steering, the same on the ground and in the air.
   *  A finger drag moves the ball EXACTLY DRAG_SENSITIVITY world units per screen width dragged, however fast
   *  the swipe (2026-11-25, Matt: "i have to move my thumb a farther distance across my phone to move the ball
   *  a certain distance"). Until then a drag was turned into a speed and clipped at lateralMax, and the clipped
   *  part was thrown away: a 40% swipe in 0.15 s moved the ball 20-45% of the way at the start of a run. Now the
   *  part the ball cannot cover this tick is OWED (steerOwed) and covered on the next ticks, at the same top
   *  sideways top speed (STEER_MAX_SPEED_BASE; Track's obstacle spacing reads its own LATERAL_MAX_SPEED_BASE, unchanged).
   *  Arrow keys are unchanged: a steady speed while held. */
  steer(dt, dragAxis, keyAxis) {
    const lateralMax = STEER_MAX_SPEED_BASE * (1 + LATERAL_SPEED_SCALE_WITH_FORWARD * (this.speed / this.cfg.baseSpeed - 1));
    const damp = Math.min(1, LATERAL_DAMPING * dt);
    // World +X renders as screen-LEFT (see stepPlaying), hence the minus.
    if (dragAxis !== 0) this.steerOwed += -dragAxis * DRAG_SENSITIVITY;
    if (dragAxis === 0 && this.steerOwed === 0) {
      if (keyAxis === 0 && !this._keySteer) {
        // a finger drag already finished exactly where it was owed: no drift, only the lean (render.js) settles
        this.lateralVelocity *= 1 - damp;
        return;
      }
      this._keySteer = true; // an arrow key's speed coasts out after release, as it always did (until the next drag)
      const commanded = -keyAxis * 1.6 * DRAG_SENSITIVITY;
      // arrow keys keep their old top speed exactly (LATERAL_MAX_SPEED_BASE); only finger steering got faster
      const keyMax = LATERAL_MAX_SPEED_BASE * (1 + LATERAL_SPEED_SCALE_WITH_FORWARD * (this.speed / this.cfg.baseSpeed - 1));
      const clamped = Math.max(-keyMax, Math.min(keyMax, commanded));
      this.lateralVelocity += (clamped - this.lateralVelocity) * damp;
      this.lateralOffset += this.lateralVelocity * dt;
      return;
    }
    this._keySteer = false;
    const owed = this.steerOwed;
    const want = Math.max(-lateralMax, Math.min(lateralMax, owed / dt));
    this.lateralVelocity += (want - this.lateralVelocity) * damp;
    let move = this.lateralVelocity * dt;
    // never past what is owed (no overshoot and wobble back): finish exactly on it
    if ((owed > 0 && move > owed) || (owed < 0 && move < owed)) { move = owed; this.lateralVelocity = move / dt; }
    this.lateralOffset += move;
    this.steerOwed = Math.abs(owed - move) < 1e-6 ? 0 : owed - move;
  }

  stepPlaying(dt, dragAxis, keyAxis) {
    this.elapsed += dt;

    // --- Speed model (brief section 7) ---
    const ramped = this.cfg.baseSpeed + this.cfg.speedRampPerSec * this.elapsed + this.cfg.tierBonus * this.tiersPassed;
    this.speed = Math.min(this.cfg.maxSpeed, ramped);
    if (this.speed > this.stats.topSpeed) this.stats.topSpeed = this.speed;
    this.z += this.speed * dt;
    this.rollAngle -= (this.speed * dt) / BALL_RADIUS;

    // --- Track window maintenance (non-negotiable 3: rolling window, recycled data) ---
    this.track.ensureAhead(this.z + SEGMENTS_AHEAD * SEGMENT_LENGTH);
    this.track.trimBehind(this.z - SEGMENTS_BEHIND * SEGMENT_LENGTH);

    // --- Lateral steering ---
    // World +X renders as screen-LEFT here (the track's forward direction is
    // +Z, and the chase camera looks down +Z, which flips the camera's local
    // +X/right relative to world +X). Drag right / ArrowRight must move the
    // ball right on screen, so the input axis is negated once, here, to land
    // in world space. This is the single sign flip in the whole input chain;
    // DRAG_SENSITIVITY itself stays a plain positive constant (config.js).
    this.steer(dt, dragAxis, keyAxis);

    // --- Track frame at the ball's new position ---
    const frame = this.track.frameAt(this.z);
    const halfWidth = frame.width / 2;
    this.y = frame.y; // grounded height sync (Jump only; 0 everywhere else) - launchJump below
                       // overrides this to an exact 0 the instant a jump's gap is entered, since
                       // this per-tick frame lookup can already be a little way into the gap's own
                       // height ramp by the time this check fires (see launchJump's own comment)

    // --- Jump launch (section 3): the instant z enters a jump's gap, go airborne. `jumpMeta` is
    // set ONLY on a gap's first segment (track.js's emitJump), so this fires exactly once per
    // jump - no separate "is this the first gap segment" query needed, unlike the tunnel-tier
    // guard below, which has no such marker to key off. ---
    const seg = frame.segment;
    if (seg && seg.jumpMeta && seg.index !== this._lastGapEntryIndex) {
      this._lastGapEntryIndex = seg.index;
      this.launchJump(seg.jumpMeta);
      return; // airborne now - none of this tick's grounded checks below apply (section 3: "no
              // edge check, no obstacle check, no void check" while in flight)
    }

    // --- Speedpoint tunnel entry: apply the next speed tier once per tunnel ---
    if (seg && seg.isTunnel && seg.index !== this._countedTunnelIndex) {
      // Only count once, at the first tunnel segment of the event (the event's own index run is monotonic).
      const isFirstTunnelSegment = !this.track.segments.some((s) => s.isTunnel && s.index === seg.index - 1);
      if (isFirstTunnelSegment) {
        this._countedTunnelIndex = seg.index;
        this.tiersPassed += 1;
      }
    }

    // --- Pickups (Phase 4, Orbital only): collect before any crash check below can consume this
    // same segment - an orb/life sitting on a segment is never a hazard, so there is no ordering
    // concern the way there could be with an obstacle. `seg.pickup` is cleared on collection so a
    // second pass over the same segment (this ball doesn't move fast enough to skip a whole
    // segment most ticks, but the guard costs nothing either way) can never double-collect it. */
    if (seg && seg.pickup) {
      const radius = this.track.map.pickups.radiusBW * BALL_DIAMETER;
      if (Math.abs(this.lateralOffset - (frame.wCenter + seg.pickup.lateral)) < radius + BALL_RADIUS) {
        this.collectPickup(seg.pickup);
        seg.pickup = null;
      }
    }

    // --- Invincibility (Phase 4): a spent life buys a grace window, not "survive this one hit" -
    // while it's active, EVERY hazard check below is skipped outright, so a ball drifting outside
    // bounds or sitting against an obstacle gets real time to recover rather than immediately
    // re-triggering the same crash next tick. The window is deliberately not extended by passing
    // through more hazards during it - it always expires at the time it was granted.
    const invincible = this.elapsed < this.invincibleUntil;

    // --- Obstacle collision ---
    if (!invincible && seg && seg.obstacles && seg.obstacles.length) {
      const halfCube = OBSTACLE_SIZE / 2;
      for (const cube of seg.obstacles) {
        if (Math.abs(this.lateralOffset - cube.lateral) < halfCube + BALL_RADIUS) {
          if (!this.spendLifeIfAny('obstacle')) { this.crashCause = 'obstacle'; this.beginCrash('obstacle'); return; }
          break; // one spent life covers every cube this tick, not one consumed per cube
        }
      }
    }

    // --- Void fall (Split, BALLRUNMAP2ORBITALSPEC.md section 2): the ball's CENTER inside the
    // void band is a fall, same crash reason/animation as the outer edge (spec: "Sim change
    // (small)") - reuses the existing FALLING state, no new game-over path. `frame.voidHalfWidth`
    // is 0 for every non-Split segment, so this is a no-op on Classic and on Orbital outside a
    // Split event. `frame.voidCenter` is relative to the pad's own center (`frame.wCenter`, a
    // Jump offset-landing thing - 0 everywhere else), so the void's true position relative to cx
    // is their sum.
    if (!invincible && frame.voidHalfWidth > 0 && Math.abs(this.lateralOffset - (frame.wCenter + frame.voidCenter)) < frame.voidHalfWidth) {
      if (!this.spendLifeIfAny('void')) { this.crashCause = 'void'; this.beginCrash('edge'); return; }
    }

    // --- Edge fall: ball's CENTER passes the track edge (brief section 5). `frame.wCenter` is a
    // Jump offset-landing pad's own center, relative to cx (0 everywhere else, including every
    // grounded segment outside that one variety). ---
    if (!invincible && Math.abs(this.lateralOffset - frame.wCenter) > halfWidth) {
      if (!this.spendLifeIfAny('edge')) { this.crashCause = 'edge'; this.beginCrash('edge'); return; }
    }

    this.updateScore();
  }

  /** Pickups (Phase 4): `type: 'orb'` adds straight to the score (the same tally Split/Jump
   *  already add to, not a separate stat) and a secondary flavor counter; `type: 'life'` banks an
   *  extra chance, capped so it can't be stockpiled without limit. */
  collectPickup(pickup) {
    const cfg = this.track.map.pickups;
    if (pickup.type === 'orb') {
      this.score += cfg.orbValue;
      this.orbsCollected += 1;
    } else if (pickup.type === 'life') {
      this.lives = Math.min(cfg.maxLives, this.lives + 1);
      this.stats.lifeGot += 1;
    }
    this.pickupEvents.push({ type: pickup.type });
  }

  /** If a life is banked, spend one and open the invincibility grace window; returns whether a
   *  life was actually available so the caller can fall through to a real crash when it wasn't. */
  spendLifeIfAny(what) {
    if (this.lives <= 0) return false;
    this.lives -= 1;
    this.stats.lifeUsed += 1;
    if (what) this.stats.saves[what] = (this.stats.saves[what] | 0) + 1;
    this.invincibleUntil = this.elapsed + this.track.map.pickups.lifeInvincibleS;
    this.pickupEvents.push({ type: 'lifeSpent' });
    return true;
  }

  /** Score any obstacle-row segments the ball has now fully cleared (z past the segment's far
   * edge), plus a Split's own single +1 on its designated last segment (`scoreOnce`, section 2:
   * "same as clearing an obstacle row" - one point for the whole event, not one per segment).
   * Never runs on a step that just crashed (both crash paths return before this call), so a row
   * or Split the run ends on is never scored. */
  updateScore() {
    const segs = this.track.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.index <= this._lastScoredSegmentIndex) continue;
      if (seg.z1 > this.z) break; // ascending order: nothing past this one has been cleared yet either
      if (seg.type === 'obstacle') { this.score += 1; this.stats.obst += 1; }
      else if (seg.scoreOnce) { this.score += 1; this.stats.splits += 1; }
      this._lastScoredSegmentIndex = seg.index;
    }
  }

  /**
   * Jump launch (BALLRUNMAP2ORBITALSPEC.md section 3, "the critical design rule"): forward speed
   * is not player-controlled, so a fixed gap length would make a straight-ahead jump missable
   * through no fault of the player (a slow early run falls short, a fast late run makes it
   * trivial). The launch impulse is computed HERE, at the moment of launch, from `this.speed` -
   * the ball's ACTUAL current forward speed, not track.js's generation-time estimate - so the
   * ball always lands exactly on the landing edge (`meta.gapLength`/`meta.landingY`, baked onto
   * the gap's first segment by emitJump()). `launchY` is always exactly 0, never
   * `this.y`/`frame.y`: by the tick this fires, `this.z` has already advanced a little way into
   * the gap's own segment (fixed-timestep steps don't land exactly on a z boundary), so the
   * grounded-height sync a few lines up in stepPlaying may already read a hair into the height
   * ramp - the spec's formula assumes a clean launchY of 0 (track stays flat outside Jump
   * segments), so this hardcodes it rather than trusting a slightly-overshot frame lookup.
   */
  launchJump(meta) {
    const jumpCfg = this.track.map.jump;
    const launchY = 0;
    const t = meta.gapLength / this.speed;
    this.vy = (meta.landingY - launchY) / t + 0.5 * jumpCfg.gravity * t;
    this.y = launchY;
    this.jumpLandingY = meta.landingY;
    this.jumpGravity = jumpCfg.gravity;
    this.state = RunState.AIRBORNE;
  }

  /** Mid-Jump flight (section 3). Forward motion and steering are IDENTICAL to stepPlaying's (same
   *  speed ramp, same lateral model) - only the vertical axis and the landing check are new, and
   *  no edge/obstacle/void check runs while airborne (explicit in the spec). Forward speed keeps
   *  ramping during flight, so real elapsed flight time comes out a little SHORTER than the
   *  `t` planned in launchJump() (never longer, since speed is never below its launch value) - the
   *  ball lands marginally past the computed point, never short, and landing is detected by z
   *  actually crossing the landing edge rather than by trusting the integrated `y` to be exact at
   *  a precomputed time, so this never needs a fudge factor (spec's own note). */
  stepAirborne(dt, dragAxis, keyAxis) {
    this.elapsed += dt;

    const ramped = this.cfg.baseSpeed + this.cfg.speedRampPerSec * this.elapsed + this.cfg.tierBonus * this.tiersPassed;
    this.speed = Math.min(this.cfg.maxSpeed, ramped);
    if (this.speed > this.stats.topSpeed) this.stats.topSpeed = this.speed;
    this.z += this.speed * dt;
    this.rollAngle -= (this.speed * dt) / BALL_RADIUS;

    // Steering still works in the air (section 3) - identical model to stepPlaying's.
    this.steer(dt, dragAxis, keyAxis);

    // Pure projectile motion from the launch impulse - never overridden until landing snaps it.
    this.vy -= this.jumpGravity * dt;
    this.y += this.vy * dt;

    this.track.ensureAhead(this.z + SEGMENTS_AHEAD * SEGMENT_LENGTH);
    this.track.trimBehind(this.z - SEGMENTS_BEHIND * SEGMENT_LENGTH);

    // --- Landing (section 3): "the instant z crosses the landing edge." frame.segment stops being
    // a gap segment the moment z reaches the landing pad's own first segment. ---
    const frame = this.track.frameAt(this.z);
    const seg = frame.segment;
    if (seg && !seg.isGap) {
      const halfWidth = frame.width / 2;
      const inVoid = frame.voidHalfWidth > 0 && Math.abs(this.lateralOffset - (frame.wCenter + frame.voidCenter)) < frame.voidHalfWidth;
      const missed = Math.abs(this.lateralOffset - frame.wCenter) > halfWidth || inVoid;
      if (missed) {
        // A missed landing is a hazard like any other (an obstacle hit, a void fall, an edge
        // fall) and MUST go through the same life-save path as all three - a banked life or an
        // active grace window saves the run here too. This was a real bug: the original code
        // called beginCrash('edge') unconditionally, so "extra lives" silently never covered the
        // one hazard players actually asked about ("Extra lives collected do not save you from
        // this either" - Matt, 2026-07-29). The grace window is also the fairness answer to "I
        // was never shown the landing zone before I had to commit" - a life now buys a real
        // second chance on a landing the player couldn't have seen coming in time to react.
        const invincible = this.elapsed < this.invincibleUntil;
        this.stats.jumpMiss += 1;
        if (!invincible && !this.spendLifeIfAny('landing')) {
          this.crashCause = 'landing';
          // "Yes, missing the landing kills you. Matt confirmed." Same FALLING state/animation as
          // every other edge fall - no new game-over path.
          this.beginCrash('edge');
          return;
        }
      }
      this.y = this.jumpLandingY;
      this.vy = 0;
      this.state = RunState.PLAYING;
      if (!missed) {
        this.stats.jumps += 1;
        this.score += 1; // "+1 on a successful landing" (section 3) - a one-time event, not the
                          // generic segment-crossing scan updateScore() uses for obstacles/Splits.
                          // A missed-but-saved landing scores nothing - surviving a miss is not
                          // the same as sticking the landing.
      }
    }
  }

  beginCrash(reason) {
    this.crashReason = reason;
    this.crashTimer = 0;
    if (reason === 'edge') {
      this.state = RunState.FALLING;
      this.fallVelocityY = 0;
      this.fallY = 0;
    } else {
      this.state = RunState.CRASHING;
    }
  }

  stepCrashing(dt) {
    this.crashTimer += dt * 1000;
    if (this.crashTimer >= CRASH_BEAT_MS) this.state = RunState.GAME_OVER;
  }

  stepFalling(dt) {
    this.crashTimer += dt * 1000;
    this.fallVelocityY += FALL_GRAVITY * dt;
    this.fallY -= this.fallVelocityY * dt;
    // Forward motion stops the instant the fall begins; only gravity acts from here.
    if (this.crashTimer >= CRASH_BEAT_MS + 400) this.state = RunState.GAME_OVER;
  }

  isOver() {
    return this.state === RunState.GAME_OVER;
  }
}

// --- RunLog (kept in this file so the game's file list is unchanged): EVERY STEER AND EVERY POINT OF A RUN, for the admin-only play log (2026-11-25, Matt: "Yes, build
// specific trip wires for EVERY SINGLE game ... And everything should logged"). King of Games' Ball Run 200 could not
// be checked: the play log held only the score. Data only: nothing here changes how the game plays or looks, and it
// never touches the stats store. Pure like the rest of this file: ui.js feeds it once per sim step.
//
// out() = the private log's run part:
//   steps   sim steps played; tSteps / kSteps = steps steered by a finger drag / by an arrow key (sim.js stepPlaying:
//           a drag wins over a key); steerN = steers logged (before any cut)
//   steer   "<ms since the previous token><code>" tokens, ms = sim time (sim.elapsed, paused time excluded):
//           L / R = a finger drag starts going left / right, l / r = an arrow key, 0 = steering stopped (no input for
//           LOG_STOP_STEPS steps). One token per change of direction or source.
//   pass    every point scored: "<ms since previous><kind><lateral x10>", kind o obstacle row, s split, j jump landed,
//           b orb (sim.js updateScore / stepAirborne / collectPickup); lateral = the ball's offset from the centreline
//   wallMs  real time from the first step to the end (performance.now), for the sim-time-vs-clock check
//   cut     { steer, pass } tokens dropped past the caps (the oldest are kept: the run's start)
const LOG_STOP_STEPS = 6;          // 100 ms at 60 Hz without input = the steer stopped
const STEER_MAX = 1400, PASS_MAX = 800;   // keeps x well under 20,000 characters

export class RunLog {
  constructor() {
    this.steps = 0; this.tSteps = 0; this.kSteps = 0; this.steerN = 0;
    this.steer = []; this.pass = []; this.cut = { steer: 0, pass: 0 };
    this._cur = '0'; this._idle = 0; this._lastSteerMs = 0; this._lastPassMs = 0;
    this._t0 = null; this._t1 = null;
    this._prev = null;
  }
  _push(list, tok, which, max) { if (list.length < max) list.push(tok); else this.cut[which]++; }
  /** Before sim.step(dragAxis, keyAxis): the steer this step. `now` = performance.now(). */
  before(sim, dragAxis, keyAxis, now) {
    try {
      if (this._t0 == null) this._t0 = now;
      this._t1 = now;
      this.steps++;
      this._prev = { score: sim.score | 0, obst: sim.stats.obst | 0, splits: sim.stats.splits | 0, jumps: sim.stats.jumps | 0, orbs: sim.orbsCollected | 0 };
      let code = '';
      if (dragAxis !== 0) { this.tSteps++; code = dragAxis > 0 ? 'R' : 'L'; }
      else if (keyAxis) { this.kSteps++; code = keyAxis > 0 ? 'r' : 'l'; }
      const ms = Math.round(sim.elapsed * 1000);
      if (code) {
        this._idle = 0;
        if (code !== this._cur) { this._cur = code; this.steerN++; this._push(this.steer, `${ms - this._lastSteerMs}${code}`, 'steer', STEER_MAX); this._lastSteerMs = ms; }
      } else if (this._cur !== '0' && ++this._idle >= LOG_STOP_STEPS) {
        this._cur = '0'; this.steerN++; this._push(this.steer, `${ms - this._lastSteerMs}0`, 'steer', STEER_MAX); this._lastSteerMs = ms;
      }
    } catch { /* the log never stops a run */ }
  }
  /** After sim.step: every point the step scored, by kind. */
  after(sim) {
    try {
      const p = this._prev;
      if (!p || (sim.score | 0) === p.score) return;
      const ms = Math.round(sim.elapsed * 1000), lat = Math.round((Number(sim.lateralOffset) || 0) * 10);
      const add = (k, n) => { for (let j = 0; j < n; j++) { this._push(this.pass, `${ms - this._lastPassMs}${k}${lat}`, 'pass', PASS_MAX); this._lastPassMs = ms; } };
      add('o', (sim.stats.obst | 0) - p.obst);
      add('s', (sim.stats.splits | 0) - p.splits);
      add('j', (sim.stats.jumps | 0) - p.jumps);
      add('b', (sim.orbsCollected | 0) - p.orbs);
    } catch { /* the log never stops a run */ }
  }
  out() {
    return {
      steps: this.steps, tSteps: this.tSteps, kSteps: this.kSteps, steerN: this.steerN,
      wallMs: this._t0 == null ? 0 : Math.round(this._t1 - this._t0),
      steer: this.steer.join(' '), pass: this.pass.join(' '),
      ...(this.cut.steer || this.cut.pass ? { cut: { ...this.cut } } : {}),
    };
  }
}
