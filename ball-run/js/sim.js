// sim.js — fixed-timestep simulation (brief section 3, non-negotiables 1 and 2).
// Owns plain-data game state only: ball position/speed, run status, score. No
// Three.js objects are read or written here; render.js maps this state onto
// meshes every animation frame. step() advances exactly one SIM_DT tick.

import {
  SIM_DT, BALL_RADIUS, SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND,
  OBSTACLE_CUBE_SIZE, DRAG_SENSITIVITY, LATERAL_MAX_SPEED_BASE,
  LATERAL_SPEED_SCALE_WITH_FORWARD, LATERAL_DAMPING, FALL_GRAVITY,
  CRASH_BEAT_MS, difficultyConfig,
} from './config.js';
import { Track } from './track.js';

export const RunState = Object.freeze({
  PLAYING: 'playing',
  CRASHING: 'crashing', // obstacle hit: forward motion stopped, brief beat before game-over
  FALLING: 'falling',   // off the edge: gravity drop, camera holds, brief beat before game-over
  GAME_OVER: 'gameover',
});

export class Sim {
  constructor(difficultyKey, seed) {
    this.difficultyKey = difficultyKey;
    this.cfg = difficultyConfig(difficultyKey);
    this.track = new Track(difficultyKey, seed);

    this.state = RunState.PLAYING;
    this.elapsed = 0;       // seconds of active play (paused time excluded)
    this.z = 0;              // forward distance traveled == score
    this.speed = this.cfg.baseSpeed;
    this.tiersPassed = 0;

    this.lateralOffset = 0;  // relative to the track centerline
    this.lateralVelocity = 0;

    this.rollAngle = 0;      // ball roll, radians, driven by forward speed (visual, but cheap enough to keep as sim data)

    this.crashTimer = 0;
    this.fallVelocityY = 0;
    this.fallY = 0;
    this.crashReason = null; // 'obstacle' | 'edge'

    // Guards so a tunnel's speed-tier bonus is only ever applied once.
    this._countedTunnelIndex = -1;
  }

  /** One fixed-step tick. dragAxis is the normalized drag delta accumulated this tick; keyAxis is -1/0/1. */
  step(dragAxis, keyAxis) {
    const dt = SIM_DT;
    if (this.state === RunState.PLAYING) this.stepPlaying(dt, dragAxis, keyAxis);
    else if (this.state === RunState.CRASHING) this.stepCrashing(dt);
    else if (this.state === RunState.FALLING) this.stepFalling(dt);
  }

  stepPlaying(dt, dragAxis, keyAxis) {
    this.elapsed += dt;

    // --- Speed model (brief section 7) ---
    const ramped = this.cfg.baseSpeed + this.cfg.speedRampPerSec * this.elapsed + this.cfg.tierBonus * this.tiersPassed;
    this.speed = Math.min(this.cfg.maxSpeed, ramped);
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
    const inputAxis = dragAxis !== 0 ? dragAxis : keyAxis * dt * 1.6;
    const lateralMax = LATERAL_MAX_SPEED_BASE * (1 + LATERAL_SPEED_SCALE_WITH_FORWARD * (this.speed / this.cfg.baseSpeed - 1));
    const commandedVelocity = -(inputAxis / dt) * DRAG_SENSITIVITY;
    const clampedCommand = Math.max(-lateralMax, Math.min(lateralMax, commandedVelocity));
    const damp = Math.min(1, LATERAL_DAMPING * dt);
    this.lateralVelocity += (clampedCommand - this.lateralVelocity) * damp;
    this.lateralOffset += this.lateralVelocity * dt;

    // --- Track frame at the ball's new position ---
    const frame = this.track.frameAt(this.z);
    const halfWidth = frame.width / 2;

    // --- Speedpoint tunnel entry: apply the next speed tier once per tunnel ---
    const seg = frame.segment;
    if (seg && seg.isTunnel && seg.index !== this._countedTunnelIndex) {
      // Only count once, at the first tunnel segment of the event (the event's own index run is monotonic).
      const isFirstTunnelSegment = !this.track.segments.some((s) => s.isTunnel && s.index === seg.index - 1);
      if (isFirstTunnelSegment) {
        this._countedTunnelIndex = seg.index;
        this.tiersPassed += 1;
      }
    }

    // --- Obstacle collision ---
    if (seg && seg.obstacles && seg.obstacles.length) {
      const halfCube = OBSTACLE_CUBE_SIZE / 2;
      for (const cube of seg.obstacles) {
        if (Math.abs(this.lateralOffset - cube.lateral) < halfCube + BALL_RADIUS) {
          this.beginCrash('obstacle');
          return;
        }
      }
    }

    // --- Edge fall: ball's CENTER passes the track edge (brief section 5) ---
    if (Math.abs(this.lateralOffset) > halfWidth) {
      this.beginCrash('edge');
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

  /** Track-frame-relative world X of the ball right now (centerline + lateral offset). */
  ballWorldX() {
    return this.track.frameAt(this.z).cx + this.lateralOffset;
  }

  isOver() {
    return this.state === RunState.GAME_OVER;
  }
}
