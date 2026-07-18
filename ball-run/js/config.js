// config.js — every tuning constant for Ball Run in one place (brief section 13).
// Feel changes go through Matt after his first playthrough; don't retune silently.

// Fixed-timestep simulation rate. 60Hz keeps the accumulator math simple and
// matches the render target, while staying independent of display refresh rate.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_STEPS_PER_FRAME = 8; // clamp the accumulator after a tab stall

// World units: 1 unit == 1 ball diameter, per brief section 8.
export const BALL_RADIUS = 0.5;
export const BALL_DIAMETER = BALL_RADIUS * 2;

// Track geometry.
export const TILE_SIZE = BALL_DIAMETER; // one grid tile == one ball diameter
export const SEGMENT_LENGTH = TILE_SIZE * 2; // z-length of one generated segment
export const SEGMENTS_AHEAD = 36; // rolling window in front of the ball
export const SEGMENTS_BEHIND = 10; // kept behind before recycling
export const BASE_TRACK_WIDTH = 5; // in ball-widths, per brief section 5
export const MIN_TRACK_WIDTH = 3; // never narrower than this
export const NARROW_STEP = 1; // width steps down/up by this many ball-widths

// Curves: gentle arcs spread across several segments, not instant kinks.
export const CURVE_SEGMENTS = 10; // how many segments an arc is spread across
export const CURVE_LATERAL_PER_SEGMENT = { easy: 0.16, medium: 0.24, hard: 0.34 }; // world units of centerline drift per segment while curving

// Obstacles.
export const OBSTACLE_MIN_GAP = 2; // ball-widths of guaranteed clear gap
export const OBSTACLE_CUBE_SIZE = TILE_SIZE * 0.8;

// Speedpoint tunnels.
export const TUNNEL_SEGMENTS = 8;
export const TUNNEL_MIN_STRAIGHT_AFTER = 3; // segments of guaranteed straight after a tunnel exit

// Difficulty presets. Each controls the speed model and generation weights.
export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    baseSpeed: 6,
    speedRampPerSec: 0.045,
    tierBonus: 1.6,
    maxSpeed: 16,
    tunnelSpacingMeters: 90,
    weights: { straight: 0.55, curve: 0.16, narrow: 0.12, obstacle: 0.14, tunnel: 0.03 },
    obstacleRowsPerEvent: [1, 1],
    curveArcChance: 0.5, // of a 'curve' pick, chance it's a full multi-segment arc vs a short one
  },
  medium: {
    label: 'Medium',
    baseSpeed: 8,
    speedRampPerSec: 0.07,
    tierBonus: 2.1,
    maxSpeed: 22,
    tunnelSpacingMeters: 75,
    weights: { straight: 0.4, curve: 0.22, narrow: 0.16, obstacle: 0.18, tunnel: 0.04 },
    obstacleRowsPerEvent: [1, 2],
    curveArcChance: 0.65,
  },
  hard: {
    label: 'Hard',
    baseSpeed: 10,
    speedRampPerSec: 0.1,
    tierBonus: 2.6,
    maxSpeed: 30,
    tunnelSpacingMeters: 60,
    weights: { straight: 0.28, curve: 0.28, narrow: 0.2, obstacle: 0.2, tunnel: 0.04 },
    obstacleRowsPerEvent: [2, 3],
    curveArcChance: 0.8,
  },
};
export const DEFAULT_DIFFICULTY = 'medium';

// Lateral control (brief section 4). A full comfortable thumb swipe (~40% of
// screen width) should traverse the full track width. Exposed here so it's
// easy to retune from one place; input.js reads it, doesn't own it.
export const DRAG_SENSITIVITY = 12.5; // world units of lateral offset per 1.0 of normalized (screen-width-relative) drag
export const LATERAL_MAX_SPEED_BASE = 6; // world units/sec at base forward speed
export const LATERAL_SPEED_SCALE_WITH_FORWARD = 0.5; // fraction of forward-speed growth that adds to lateral max speed
export const LATERAL_DAMPING = 14; // how fast lateral velocity approaches its target (1/sec)

// Camera.
export const CAMERA_LAG = 0.12; // lerp factor per frame toward the ball's lateral position
export const CAMERA_HEIGHT = 3.2;
export const CAMERA_BACK = 6.5;
export const CAMERA_LOOK_AHEAD = 8;
export const CAMERA_BASE_FOV = 62;
export const CAMERA_MAX_FOV_KICK = 7; // added at max speed

// Crash feedback (brief section 9).
export const CRASH_SHAKE_MS = 150;
export const CRASH_BEAT_MS = 600; // pause before the game-over overlay
export const FALL_GRAVITY = 18;

// Colors (brief sections 1, 5, 10). Kept as hex ints for Three.js materials.
export const COLOR_VOID = 0x000000;
export const COLOR_BALL = 0xe91ec4;
export const COLOR_TRACK_TILE = 0x2b2f6b;
export const COLOR_TRACK_GROUT = 0x8f9aef;
export const COLOR_OBSTACLE = 0x9b1fd6;
export const COLOR_OBSTACLE_EDGE = 0xff5fe0;
export const COLOR_TUNNEL_WALL = 0xb020c8;
export const COLOR_TUNNEL_EDGE = 0xff59e8;
export const COLOR_CHEVRON = 0x39f4ff;
export const COLOR_SHADOW = 0x000000;

export function difficultyConfig(key) {
  return DIFFICULTIES[key] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}
