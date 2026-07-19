// config.js — every tuning constant for Ball Run in one place (brief section 13).
// Feel changes go through Matt after his first playthrough; don't retune silently.

// Dev-only runtime checks (e.g. obstacle row reachability). Off by default so a console.assert
// never runs in production; flip locally or via ?debug=1 (see track.js) when auditing generation.
export const DEBUG_ASSERTIONS = typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search);

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
// Matt's third-playthrough item 1: both curve-camera presentations (world-aligned, then
// track-frame) were rejected. Curves default OFF; the generation/camera code paths stay intact
// behind this flag for whenever curves are revisited, they're just not selected by default.
export const CURVES_ENABLED = false;
export const CURVE_SEGMENTS = 10; // how many segments an arc is spread across
export const CURVE_LATERAL_PER_SEGMENT = { easy: 0.16, medium: 0.24, hard: 0.34 }; // world units of centerline drift per segment while curving

// Obstacles.
export const OBSTACLE_MIN_GAP = 2; // ball-widths of guaranteed clear gap
// Cube edge length, derived from the ball diameter (Matt's second-playthrough item 3: cubes must
// read as a bigger threat than the ball, not smaller). Kept as a multiplier so it can never drift
// out of ratio from BALL_DIAMETER again.
export const OBSTACLE_SIZE_MULTIPLIER = 1.5;
export const OBSTACLE_SIZE = BALL_DIAMETER * OBSTACLE_SIZE_MULTIPLIER;
// Forced clean (obstacle-free) segments after an obstacle event ends, so
// consecutive obstacle events read as a slalom rather than a solid wall.
export const OBSTACLE_MIN_STRAIGHT_AFTER = 2;

// Row-to-row reachability spacing (Matt's third-playthrough item 3, the "46m wall"): the old
// per-row-pair reach clamp floored its reach distance at OBSTACLE_MIN_GAP (a GAP-WIDTH constant,
// not a reach-distance constant), which made the floor bigger than the entire addressable gap-center
// range for most track widths - the clamp was mathematically unable to ever constrain anything.
// Replaced with an explicit time-derived minimum spacing: minSpacing = (lateralDistanceBetweenCorridor
// Centers / maxLateralSpeed) * forwardSpeed * OBSTACLE_SPACING_SAFETY_FACTOR, evaluated at the
// difficulty's effective speed where the row actually lands (see Track.estimateSpeedAt).
export const OBSTACLE_SPACING_SAFETY_FACTOR = 1.5; // Matt's suggested starting value
// Any two obstacle rows closer together than this (ball-diameters) longitudinally must share one
// contiguous corridor at least OBSTACLE_COMBINE_MIN_CORRIDOR_BW wide (item 3c): this categorically
// rules out the offset-double-wall shape even in edge cases where the time-based formula alone,
// with a very small lateral offset, might not flag it.
export const OBSTACLE_COMBINE_SPAN_BW = 6; // ball-diameters
export const OBSTACLE_COMBINE_MIN_CORRIDOR_BW = 2.0; // ball-diameters
// Auto-repair (item 3b): how many extra single-segment pushes downtrack to try before giving up
// and dropping the row rather than shipping a spacing violation.
export const OBSTACLE_ROW_MAX_PUSH_ATTEMPTS = 6;

// Obstacle distance-pacing (Matt's second-playthrough item 2: first obstacle landed at 281m under
// pure weighted-random occurrence, since a run could roll many non-obstacle events before ever
// drawing "obstacle"). Occurrence is now a distance scheduler; weighted-random only picks what an
// obstacle event *looks like* (row count, via obstacleRowsPerEvent) once the scheduler has decided
// one happens here.
export const OBSTACLE_FIRST_EVENT_MIN_M = 40; // first obstacle event must land in this window, every run, every difficulty
export const OBSTACLE_FIRST_EVENT_MAX_M = 60;
// hard: 22 -> 19 (third-playthrough item 1: Hard's other difficulty compensation nudge for losing
// curves as a lever, tighter obstacle-event cadence).
export const OBSTACLE_EVENT_GAP_BASE_M = { easy: 55, medium: 35, hard: 19 }; // meters between events, before jitter/speed-tier shrink
export const OBSTACLE_EVENT_GAP_JITTER_FRAC = 0.3; // +/- fraction of the base gap
export const OBSTACLE_EVENT_GAP_SHRINK_PER_TIER = 0.94; // multiplicative shrink of the gap per estimated speed tier passed
export const OBSTACLE_EVENT_GAP_MIN_M = 12; // floor so shrink-per-tier can't collapse cadence into a wall

// Speedpoint tunnels.
export const TUNNEL_SEGMENTS = 8;
export const TUNNEL_MIN_STRAIGHT_AFTER = 3; // segments of guaranteed straight after a tunnel exit

// Difficulty presets. Each controls the speed model and generation weights.
// Speed constants retuned per Matt's first-playthrough feedback (item 2): the
// old base/ramp/tier/max were far too slow to read as a "runner". Scaled ~2.5x
// across the board, tunnelSpacingMeters scaled up to match so the first
// speedpoint still lands at the same felt pace (see commit message for the
// full old -> new list).
export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    baseSpeed: 15,
    speedRampPerSec: 0.1125,
    tierBonus: 4.0,
    maxSpeed: 40,
    tunnelSpacingMeters: 280,
    // 'obstacle' occurrence is scheduler-driven now (see OBSTACLE_EVENT_GAP_*), not weighted-random;
    // these weights cover straight/curve/narrow only and are renormalized automatically by
    // pickWeighted (track.js) when CURVES_ENABLED is false and 'curve' is dropped from the pool.
    weights: { straight: 0.67, curve: 0.19, narrow: 0.14 },
    obstacleRowsPerEvent: [1, 1],
    curveArcChance: 0.5, // of a 'curve' pick, chance it's a full multi-segment arc vs a short one
  },
  medium: {
    label: 'Medium',
    baseSpeed: 20,
    speedRampPerSec: 0.175,
    tierBonus: 5.25,
    maxSpeed: 55,
    tunnelSpacingMeters: 230,
    weights: { straight: 0.54, curve: 0.27, narrow: 0.19 },
    obstacleRowsPerEvent: [1, 2],
    curveArcChance: 0.65,
  },
  hard: {
    label: 'Hard',
    baseSpeed: 25,
    speedRampPerSec: 0.25,
    tierBonus: 6.5,
    // Curves were one of Hard's three difficulty levers (brief section 13: frequency & sharpness
    // scale with difficulty); with CURVES_ENABLED false Hard loses that lever entirely. Compensated
    // with a small nudge here rather than a wholesale retune (Matt's third-playthrough item 1):
    // maxSpeed 75 -> 78.
    maxSpeed: 78,
    tunnelSpacingMeters: 185,
    weights: { straight: 0.4, curve: 0.35, narrow: 0.25 },
    obstacleRowsPerEvent: [2, 3],
    curveArcChance: 0.8,
  },
};
export const DEFAULT_DIFFICULTY = 'medium';

// Lateral control (brief section 4). A full comfortable thumb swipe (~40% of
// screen width) should traverse the full track width. Exposed here so it's
// easy to retune from one place; input.js reads it, doesn't own it.
// Verified from scratch after the item-1 sign fix (BASE_TRACK_WIDTH * BALL_DIAMETER
// world units of travel over a 0.4 normalized swipe): 5 / 0.4 = 12.5, unchanged.
export const DRAG_SENSITIVITY = 12.5; // world units of lateral offset per 1.0 of normalized (screen-width-relative) drag
export const LATERAL_MAX_SPEED_BASE = 15; // world units/sec at base forward speed
export const LATERAL_SPEED_SCALE_WITH_FORWARD = 0.5; // fraction of forward-speed growth that adds to lateral max speed
export const LATERAL_DAMPING = 14; // how fast lateral velocity approaches its target (1/sec)

// Camera. Height/back/look-ahead retuned for item 3 (shorter phone canvas):
// the ball now sits in the lower third of the frame with a generous forward
// view, instead of being pinned near the bottom edge.
// CAMERA_LAG now damps the ball's TRACK-LOCAL lateral offset (not raw world X, per the
// second-playthrough item-1 fix): the camera rides the centerline's moving frame (position along
// it, yaw aligned to the local tangent) so a curve turns the world around a visually planted ball,
// with only this small lag/easing producing on-screen lateral motion, never the curve itself.
export const CAMERA_LAG = 0.12; // lerp factor per frame toward the ball's lateral position
export const CAMERA_HEIGHT = 3.6;
export const CAMERA_BACK = 7.5;
export const CAMERA_LOOK_AHEAD = 10;
export const CAMERA_LOOK_HEIGHT_FRAC = 0.42; // fraction of CAMERA_HEIGHT the look-at target sits at (lower = steeper downward pitch)
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
