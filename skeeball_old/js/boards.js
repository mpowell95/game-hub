// skeeball/js/boards.js - the machines. Each board is DATA: a palette, a physical geometry, and
// the score that unlocks the next one. Matt, 2026-08-12: "this is the first of ~10 skeeball
// boards... This should be the most basic, classic skeeball machine." Adding a machine should
// mean adding an entry here and nothing else - physics.js simulates whatever geometry it is
// handed, and render.js draws the same geometry, so a new machine is a layout, never a code path.
//
// EVERYTHING IS IN METRES, in the world frame physics.js documents (x across, y up, z toward the
// machine). The ball is 0.042m radius (physics.js BALL_R); sizes below are set against it and
// against reference/skeeball/SPEC.md's 2026-08-12 section - the classic machine's cup opening is
// only ~1.7 ball diameters, which is WHY rim bounces are common, and the rim bounce is the whole
// point (Correct bouncing.MOV).
//
// A ring entry:
//   c: [u, w]  centre on the board plane (u across, w up-slope from the plane base)
//   R: opening radius - THE HOLE. The ball is swallowed when its centre drops through it.
//   T: collar wall thickness; the lip torus that deflects grazing hits sits at R + T/2.
//   h: collar height above the plane. CUPS ARE LOWER THAN THE BALL'S RADIUS on purpose: a slow
//      ball rolling across a cup tips over the collar and falls in, which is exactly what the
//      reference clip shows the 20 doing. The big ring is tall (wallHigh) so it CONTAINS the
//      basin instead.
//   points, and wallHigh for the basin ring.
//
// `drains` are the 10's real geometry: regions of the plane with no floor - the crescent at the
// bottom of the basin and the trough across the bottom of the outer board. Everything that
// reaches the board eventually funnels into a hole; the drain is why.

/** The classic machine: teal, white rings, yellow rails (SPEC.md 2026-08-12 - the app's standard
 *  alley, NOT the warm wood machine of Skeeball 1.MOV, which is a different skin). */
const CLASSIC_PALETTE = {
  wall: '#3E7F72',          // teal back wall
  wallDark: '#2C5F55',
  lane: '#4A8A7C',          // the lane is TEAL in this machine, not wood
  laneDark: '#356B5F',
  laneSeam: 'rgba(255,255,255,0.16)',
  lip: '#D8D2C4',           // pale lip where the lane meets the cabinet
  ring: '#F2EFE7',          // the white collars
  ringLit: '#FFFFFF',
  ringShade: '#B9B4A6',
  ringDeep: '#7E7A6E',
  hole: '#101715',          // openings
  ink: '#22252B',           // near-black numerals on the collars
  rail: '#E8C93E',          // glossy yellow rails
  railLit: '#F7E27A',
  railStripe: '#D7E4E8',    // the pale stripe along a rail's crown
  railDark: '#8A6E1A',
  border: '#5A1F24',        // maroon cabinet borders between machines
  borderTrim: '#C9A24B',    // gold pinstripe
  tube: '#17181C',          // the black flexible guard tubes
  tubeLit: '#3A3D45',
  net: '#B39A5C',           // khaki diamond netting
  marquee: '#0B0B0D',
  marqueeTrim: '#C9A24B',
  ledBall: '#E33528',       // BALL digit - red 7-seg
  ledBallLabel: '#E8C93E',
  ledScore: '#EAF6EE',      // SCORE digit
  ledScoreLabel: '#43B96E',
  logo: '#E8622D',          // the arched SKEE-BALL lettering
  logoDark: '#7A2A12',
};

/** A second machine (the first unlock). Ported to the physical model: same alley, scattered
 *  cups, star-branded palette. Kept simple - the ladder's real machines arrive as Matt sends
 *  their references; this one exists so the unlock path stays exercised. */
const STARS_PALETTE = {
  ...CLASSIC_PALETTE,
  wall: '#28356B',
  wallDark: '#1B2447',
  lane: '#31408A',
  laneDark: '#232E63',
  ring: '#F6D84A',
  ringLit: '#FFF2A0',
  ringShade: '#C0A428',
  ringDeep: '#7E6A12',
  ink: '#2A1B00',
  rail: '#D8DEF2',
  railLit: '#FFFFFF',
  railStripe: '#8FA0D8',
  railDark: '#4A5480',
  border: '#141B3C',
  logo: '#F6D84A',
  logoDark: '#4A3A00',
};

/** Shared alley geometry: every machine in this arcade row uses the same lane and cabinet, the
 *  way the app's do; a machine differs in its BOARD. */
const ALLEY = {
  laneLen: 2.10,          // foul line to ramp start
  rampLen: 0.28,
  lipH: 0.16,             // the jump's height; too slow to climb it = the roll-back
  launchDeg: 52,
  laneHW: 0.26,           // rails at +-x
  base: { y: 0.10, z: 2.60 },
  tiltDeg: 60,            // 30 degrees from horizontal - the real machine's gentle incline.
                          // Also what puts the reference's ~0.72 vertical squash on the drawn
                          // rings and leaves room for the numbers on the cup faces.
  boardHW: 0.62,
  boardH: 1.38,
  drainId: '10',
  drainPoints: 10,
};

export const BOARDS = [
  {
    id: 'classic',
    nameKey: 'board_classic',
    unlockScore: 0,
    palette: CLASSIC_PALETTE,
    geom: {
      ...ALLEY,
      rings: [
        // Tested in array order only for the badge list; capture is purely geometric.
        // The 100s: on the wall OUTSIDE the big ring, high corners - the skill shot. SPEC:
        // (0.315/0.685 x, 0.285 y), outer ~0.075 W. Sized so a deliberate hard diagonal from a
        // steady hand lands one in the low tens of percent - hittable on purpose, never by luck
        // (a straight throw cannot reach them at all).
        { id: '100L', c: [-0.295, 1.04], R: 0.080, T: 0.012, h: 0.030, points: 100 },
        { id: '100R', c: [0.295, 1.04], R: 0.080, T: 0.012, h: 0.030, points: 100 },
        // The centre stack, 20 low to 50 high, snug pitch like the screenshot's - the collars
        // overlap slightly, exactly as the app draws them, so the stack is a capture COLUMN:
        // between two cups there is always one of them, never a dead strip. THE 20 SITS FLUSH
        // WITH THE BASIN BOTTOM: its opening's lower edge meets the big ring's wall where the
        // wall's curve delivers rattling balls, so the funnel feeds the 20's mouth - which is
        // exactly how Correct bouncing.MOV's throw ends.
        { id: '50', c: [0, 0.850], R: 0.079, T: 0.012, h: 0.028, points: 50 },
        { id: '40', c: [0, 0.650], R: 0.083, T: 0.012, h: 0.028, points: 40 },
        { id: '30', c: [0, 0.450], R: 0.086, T: 0.012, h: 0.028, points: 30 },
        { id: '20', c: [0, 0.260], R: 0.088, T: 0.012, h: 0.028, points: 20 },
        // The big ring: the basin's wall. Its opening is not a scoring hole - it is TALL
        // (wallHigh) and the plane inside it is solid except the cups and the drain.
        { id: 'big', c: [0, 0.520], R: 0.360, T: 0.030, h: 0.085, points: 10, wallHigh: true, basin: true },
      ],
      drains: [
        // The 10's real mouth: a NARROW slot under the 20, so the big ring's curved wall
        // funnels rattling balls across the 20's opening first (Correct bouncing.MOV's own
        // ending); only what squeezes around the 20's collar drops through for the 10.
        { u0: -0.10, u1: 0.10, w0: 0.19, w1: 0.25, insideOf: 'big' },
        // The trough across the bottom of the outer board, for everything that missed wide.
        { u0: -0.62, u1: 0.62, w0: -0.02, w1: 0.055 },
      ],
    },
  },
  {
    id: 'stars',
    nameKey: 'board_stars',
    // A genuinely good classic rack with a couple of x3 hits. Measured: casual ~210, skilled
    // ~290, expert ~330 before multipliers, so 400 asks for real play without demanding luck.
    unlockScore: 400,
    palette: STARS_PALETTE,
    geom: {
      ...ALLEY,
      rings: [
        // Same basin physics as classic - the funnel is what makes this game score like the
        // real thing - but the values are placed for AIM where classic's are placed for power:
        // the 50s hang at the basin's SIDES, so the money shots are diagonals, and the centre
        // column pays modestly. The 100 crowns the top, inside the basin.
        { id: 's100', c: [0, 0.86], R: 0.068, T: 0.013, h: 0.028, points: 100 },
        { id: 's50L', c: [-0.21, 0.60], R: 0.075, T: 0.014, h: 0.028, points: 50 },
        { id: 's50R', c: [0.21, 0.60], R: 0.075, T: 0.014, h: 0.028, points: 50 },
        { id: 's30', c: [0, 0.52], R: 0.080, T: 0.014, h: 0.028, points: 30 },
        { id: 's20', c: [0, 0.260], R: 0.088, T: 0.012, h: 0.028, points: 20 },
        { id: 'sbig', c: [0, 0.520], R: 0.360, T: 0.030, h: 0.085, points: 10, wallHigh: true, basin: true },
      ],
      drains: [
        { u0: -0.10, u1: 0.10, w0: 0.19, w1: 0.25, insideOf: 'sbig' },
        { u0: -0.62, u1: 0.62, w0: -0.02, w1: 0.055 },
      ],
    },
  },
];

export const BOARD_IDS = BOARDS.map((b) => b.id);
export const DEFAULT_BOARD = BOARDS[0].id;
export const boardById = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];
export const boardIndex = (id) => Math.max(0, BOARDS.findIndex((b) => b.id === id));

/** Which targets the roaming x3 badge may sit on: every scoring cup, never the basin/drain 10
 *  (multiplying the consolation would reward the throw that missed everything). */
export const multTargetsFor = (board) =>
  board.geom.rings.filter((r) => !r.basin && r.points > board.geom.drainPoints).map((r) => r.id);

/** The board a given board unlocks, and what it costs. `null` when there is nothing after it. */
export function nextBoard(id) {
  const i = boardIndex(id);
  return i + 1 < BOARDS.length ? BOARDS[i + 1] : null;
}

export default { BOARDS, BOARD_IDS, DEFAULT_BOARD, boardById, boardIndex, nextBoard, multTargetsFor };
