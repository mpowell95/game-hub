// cup-pong/js/geom.js - every size in the game, once, in METRES. Pure data, no DOM, no engine.
//
// y is up, the table top is y = 0, the shooter stands at +z and throws toward -z, where the
// opponent's rack sits. physics.js builds its bodies from these numbers and render.js draws from
// the same ones, so the cup you see is the cup the ball hits.
//
// Real-world sources, so a future session does not re-derive them: a beer pong table is 8 ft x
// 2 ft (2.44 x 0.61 m); a 16 oz party cup is ~9.5 cm across the top, ~6 cm across the base and
// ~12 cm tall; a ping pong ball is 40 mm across and weighs 2.7 g.

export const TABLE = { len: 2.44, width: 0.61, thick: 0.05 };

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
/** Where row 0 (the row furthest from the shooter) sits: its cups' rims 3 cm in from the far edge. */
export const RACK_Z0 = -TABLE.len / 2 + CUP.topR + 0.03;

export const BALL = { r: 0.02, mass: 0.0027 };

/** THE THROW. The ball is released from a fixed point in front of the camera at a fixed angle;
 *  the swipe decides only its SPEED (power) and its heading (aim).
 *
 *  TUNE THESE WITH MATT'S HAND, NOT BY REASONING (brief section 6, stage 1). `node
 *  cup-pong/js/tune.mjs` prints where each power lands; the band was set so the middle of the
 *  natural swipe range (power ~0.55, see skeeball/js/swipe.js) lands in the middle of the rack. */
export const THROW = {
  z0: TABLE.len / 2 + 0.08,  // just behind the near edge
  y0: 0.30,                  // above the table top
  elev: 0.62,                // launch angle above horizontal, radians
  // power 0 -> minSpeed, power 1 -> maxSpeed, interpolated as ENERGY (v^2), like skeeball's.
  minSpeed: 3.62,
  maxSpeed: 6.28,
  // Swipe angle (radians off straight up) -> heading. 0.24 turns a 20-degree swipe into ~5 degrees,
  // which is the back corner cup from the release point.
  aimGain: 0.24,
  aimMax: 0.14,              // heading clamp, radians - past the table's edge either way
};

/** Contact materials. A ping pong ball on a table bounces high; on a thin plastic cup it loses
 *  more. `tableRest` is the bounce-shot lever (see cup-pong/CLAUDE.md, "Bounce shots"). */
export const MAT = { tableRest: 0.78, tableFric: 0.22, cupRest: 0.52, cupFric: 0.12 };

// Air drag on a ping pong ball is real (terminal velocity ~9 m/s): a = -k |v| v, k = g / vt^2.
export const DRAG_K = 0.12;

/** The camera: the shooter's eye, behind the near end and above the table. render.js widens the
 *  field until every point in `fit` is on screen, so a phone of any shape keeps the rack and the
 *  resting ball in frame. */
export const CAMERA = {
  pos: [0, 1.00, 2.60],
  // The top of a mid-dial throw's arc. The frame holds it, so the ball stays on screen as it
  // rises and drops into the cups - the GamePigeon view, where the arc happens above the rack.
  apex: [0, 0.78, 0.20],
};
