// cup-pong/js/geom.js - every size in the game, once, in METRES. Pure data, no DOM, no engine.
//
// y is up, the table top is y = 0, the shooter stands at +z and throws toward -z, where the
// opponent's rack sits. physics.js builds its bodies from these numbers and render.js draws from
// the same ones, so the cup you see is the cup the ball hits.
//
// Real-world sources, so a future session does not re-derive them: a beer pong table is 8 ft x
// 2 ft (2.44 x 0.61 m); a 16 oz party cup is ~9.5 cm across the top, ~6 cm across the base and
// ~12 cm tall; a ping pong ball is 40 mm across and weighs 2.7 g.

// GamePigeon's table is WIDER than a real 2 ft one relative to its cups: fitting a camera to Matt's
// recording (2026-09-27) put it at 0.72 m against the real cup size. It is the look being cloned.
export const TABLE = { len: 2.44, width: 0.72, thick: 0.05 };

export const CUP = {
  topR: 0.0475,      // outer radius at the rim
  botR: 0.030,       // outer radius at the base
  h: 0.12,
  wall: 0.006,       // collision thickness. Visually the cup is thinner; this is for the solver
  segs: 20,          // wall boxes round the cone (and as many rim spheres between them)
};

// Cups in a rack sit on a HEX GRID of touching positions (rack.js). The 2 mm gap keeps two cups'
// collision walls from overlapping; on screen they read as touching.
export const CUP_D = CUP.topR * 2 + 0.002;
export const ROW_H = CUP_D * Math.sqrt(3) / 2;
/** Where row 0 (the row furthest from the shooter) sits: its cups' rims just in from the far edge. */
export const RACK_Z0 = -TABLE.len / 2 + CUP.topR + 0.012;

const BALL_R = 0.02;
export const BALL = { r: BALL_R, mass: 0.0027 };

/** THE THROW. The ball waits ON THE TABLE at mid-court, where GamePigeon serves it (the camera fit
 *  to Matt's recording put it at z ~0), and leaves at a fixed angle; the swipe decides only its
 *  SPEED (power) and its heading (aim).
 *
 *  THE BAND: power 0 (skeeball's measured slowest natural flick) lands ~0.4 m on, power 0.55 crosses
 *  the rim plane at the middle of the rack, power 1 flies off the far end. Flight to the rack is
 *  ~0.33 s, which is what the recording shows (15 fps frames: release to the front cups in 4-5 frames). Re-derive with the landing table test.js prints. */
export const THROW = {
  z0: 0,
  y0: BALL_R + 0.001,
  elev: 0.55,                // launch angle: the recording reaches the cups in ~0.33 s without climbing above them on screen
  // power 0 -> minSpeed, power 1 -> maxSpeed, interpolated as ENERGY (v^2), like skeeball's.
  minSpeed: 2.12,
  maxSpeed: 4.85,
  aimMax: 0.30,              // heading clamp, radians - well past the table's edge either way
};

/** Contact materials. A ping pong ball on a table bounces high; on a thin plastic cup it loses
 *  more. `tableRest` is the bounce-shot lever (see cup-pong/CLAUDE.md, "Bounce shots"). */
export const MAT = { tableRest: 0.78, tableFric: 0.22, cupRest: 0.52, cupFric: 0.12 };

// Air drag on a ping pong ball is real (terminal velocity ~9 m/s): a = -k |v| v, k = g / vt^2.
export const DRAG_K = 0.12;

/** THE CAMERA, FITTED TO MATT'S GAMEPIGEON RECORDING (2026-09-27), not designed: high over the
 *  near half of the table, pitched 44 degrees down, 42 degree vertical field on a 1:2 phone. The
 *  fit matched the far edge, the far edge's width, where the side edges leave the screen, the
 *  ball, the rack's point and back row, and the rack's width to within a few pixels. render.js
 *  keeps the WIDTH it shows on a taller phone and the HEIGHT on a wider screen. */
export const CAMERA = { pos: [0, 1.305, 0.803], pitch: 44.0, vfov: 41.8, aspect: 0.5 };
