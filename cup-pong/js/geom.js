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
 *  ~0.67 s, as in the recording. Re-derive with the landing table test.js prints. */
export const THROW = {
  z0: 0,
  y0: BALL_R + 0.001,
  // A HIGH, FLOATY LOB: 57 degrees under GRAVITY below. Fitted to the ball's path in Matt's
  // recording (15 fps, frame by frame, 11 frames matched to within 0.02 of the screen): it climbs
  // ABOVE the rack on screen, peaks over the front cups, and drops in, ~0.67 s from release to the
  // rack. The second build's 0.55 rad at real gravity came from misreading that peak as an
  // overshoot. Matt: "It goes too low. It's like a straight line and I can barely get it to hit the
  // top of a cup."
  elev: 1.00,
  // power 0 -> minSpeed, power 1 -> maxSpeed, interpolated as ENERGY (v^2), like skeeball's.
  minSpeed: 1.87,
  maxSpeed: 3.64,
  aimMax: 0.30,              // heading clamp, radians - well past the table's edge either way
};

/** Contact materials. A ping pong ball on a table bounces high; on a thin plastic cup it loses
 *  more. `tableRest` is the bounce-shot lever (see cup-pong/CLAUDE.md, "Bounce shots"). */
// tableRest 0.88 -> 0.65 (Matt, 2026-10-02: a bounced ball must NOT go in more often than a regular
// throw). Measured on the full-rack 7,881-throw grid, counting only balls whose first cup contact
// is at the rim or that drop in clean: bounced 47.8% vs regular 41.9% at 0.88; 41.4% at 0.70 (even);
// 36.1% at 0.65 (shipped, bounced ~14% less likely, 334 bounce-ins vs 942); 29.7% at 0.60; 0 at
// 0.45 (bounce-ins impossible, Matt's 2026-09-28 complaint). Not monotonic (0.75 gave 51.9%), so
// re-measure rather than interpolate. Regular throws are untouched: 950/2267 at every value.
//
// 2026-10-03 (Matt: "Make a bounced ball closer to a regular throw"): tableRest 0.65 -> 0.68 plus
// `tableSkid` 0.9 (each table bounce keeps 90% of the ball's forward speed, read in physics.js's
// collide handler; `tableFric` does nothing measurable to a bounce in cannon-es). Measured with
// RANDOM throws at RANDOM leftover racks (1-10 cups), two seeds, 120,000 throws: bounced vs regular
// 0.80 at the old 0.65/no skid -> 0.91 and 0.98 (seeds 777, 4242) here, every rack size 0.92-1.05.
// 0.70/0.9 was 0.97 and 1.01 - too close to "more often". The fixed full-rack grid above ALIASES
// (it said 0.99 at a setting a random sample put at 0.80): measure with random throws.
//
// 2026-10-03, later (Matt: "Feels like more than 4% less" ... "I want the ball to bounce better"):
// the numbers above count only bounced balls that come DOWN onto a cup. Counting every bounced ball
// that touches a cup at all, 2 in 3 hit a cup's SIDE (a low skimming ball) and the bounce went in
// 11% against regular 28%. So the ball now comes off the table STEEPER: tableRest 0.68 -> 0.95,
// tableSkid 0.9 -> 0.6, and `tableRestLater` 0.68 for every bounce after the first. Counting every
// ball that touches a cup, random throws at random 1-10 cup racks (seed 5151, 60k): bounced 24.7%
// vs regular 29.1% (0.85x; 10 cups 33/38, 7-9 29/32, 4-6 22/25, 1-3 17/20). Was 11% vs 28%.
// Counting only balls that come DOWN onto a cup, a bounce now beats a regular throw (42% vs 33%);
// Matt chose the every-touch count. Regular throws unchanged at every setting. Swept 0.80-1.0 x
// 0.4-0.9: nothing realistic got past ~0.90x - a bounced ball into a full rack meets the front
// cups' sides. Probe: rand-rack2 (cup-pong/CLAUDE.md, "Bounce shots").
// `tableRestLater` 0.68: every table bounce after the first, so a dribbling ball still comes to rest.
export const MAT = { tableRest: 0.95, tableRestLater: 0.68, tableSkid: 0.6, tableFric: 0.22, cupRest: 0.52, cupFric: 0.12 };

/** GAME GRAVITY, m/s^2 - NOT 9.81, on purpose. GamePigeon's ball is floatier than a real one: the
 *  only arc that reproduces its screen path AND reaches the cups when the recording shows it there
 *  needed 6.5 (fitted over 3-10). Real gravity made the lob either too quick or too flat. */
export const GRAVITY = 6.5;

// Air drag on a ping pong ball is real (terminal velocity ~9 m/s): a = -k |v| v, k = g / vt^2.
export const DRAG_K = 0.12;

/** THE CAMERA, FITTED TO MATT'S GAMEPIGEON RECORDING (2026-09-27), not designed: high over the
 *  near half of the table, pitched 44 degrees down, 42 degree vertical field on a 1:2 phone. The
 *  fit matched the far edge, the far edge's width, where the side edges leave the screen, the
 *  ball, the rack's point and back row, and the rack's width to within a few pixels. render.js
 *  keeps the WIDTH it shows on a taller phone and the HEIGHT on a wider screen. */
export const CAMERA = {
  pos: [0, 1.305, 0.803], pitch: 44.0, vfov: 41.8, aspect: 0.5,
  // The OPPONENT'S TURN: behind this phone's own cups at the other end, looking back down the
  // table - the recording shows their balls coming at you over your red cups. Not fitted (the
  // recording's shot of it is brief); tuned by eye against it.
  defend: { pos: [0, 1.20, 2.30], pitch: 36 },
};
