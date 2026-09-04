// golf/courses/pinevalley.js - Pine Valley, holes 1-3, in the format documented in
// golf/CLAUDE.md ("The hole-data format"). Read that before editing: the renderer, the lie
// lookup, the tree collision test and the putting break all read these same objects.
//
// Yards throughout. x across the hole (right positive), y up it away from the tee.
//
// `bounds` deliberately runs WELL BEHIND EACH TEE and past each green, and that margin is not
// slack: the camera clamps itself inside bounds, so a hole that stopped at its own tee would pin
// the ball to the bottom edge of the screen - underneath the club tile and the aim row - for the
// whole of the tee shot. 45 yards behind the tee is enough to keep the ball clear of the controls
// at both phone heights. Nothing is drawn out there but the base surface.
//
// The three holes are the ones the reference footage documents (golf-reference-spec.md §17.1):
// 1 is a 360.7 yd par 4 double dogleg, 2 a 181.0 yd par 3 island green, 3 a 608.6 yd par 5 with a
// lake crossing the fairway. Holes 4-9 are out of scope and are ours to design later.
//
// Every hole here passes validateHole(); golf/js/test.js runs it over all three.

// Shared by every hole on the course. `trunk` blocks at any height; `canopy` blocks a ball
// travelling below `height`. That pair is the whole punch-low-or-loft-over decision.
const TREE_TYPES = [
  { name: 'pine', trunk: 0.6, canopy: 4.5, height: 18 },   // tall and narrow: clearing it costs a club
  { name: 'oak', trunk: 1.0, canopy: 8.0, height: 13 },    // wide and low: easier over, harder around
];

// A 12-gon green, so the three holes' greens are built the same way rather than three hand-drawn
// blobs that each need re-checking against their own slope grid.
function greenPoly(cx, cy, rx, ry = rx) {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    pts.push([+(cx + rx * Math.cos(a)).toFixed(1), +(cy + ry * Math.sin(a)).toFixed(1)]);
  }
  return pts;
}

/** Build a slope grid: `fall` is the baseline downhill direction, `spine` spreads each half toward
 *  its own side, `back` is how much steeper the back of the green is than the front. Writing 64
 *  pairs by hand invites a typo that nothing at runtime would notice; this makes the shape of a
 *  green's break reviewable in one line. The GRID is still what ships and what the tick marks are
 *  drawn from - this only generates it. */
function slopeGrid({ fall, spine = 0.055, back = 0.09, cols = 8, rows = 8 }) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const mag = 1 + back * r;
    for (let c = 0; c < cols; c++) {
      const dx = fall[0] * mag + (c - (cols - 1) / 2) * spine * (0.6 + back * r);
      const dy = fall[1] * mag;
      cells.push([+Math.max(-1, Math.min(1, dx)).toFixed(2), +Math.max(-1, Math.min(1, dy)).toFixed(2)]);
    }
  }
  return { cols, rows, cells };
}

// -------------------------------------------------------------------- hole 1 ----
// Par 4, 360.7 yds. Gentle double dogleg (right, then back left). Water left of the tee; tree
// belts pinch the drive landing area; a bunker short-left of the green and another to its right;
// water hard along the green's left and back edges.
//
// tee -> pin is exactly 360.70 yds, so card and HUD agree on this hole. They will not on hole 3,
// and that is correct - see "Two different yardages" in golf/CLAUDE.md.
//
// The stock ladder plays it as a drive (215) plus a 6 iron (139): 359 up the hole against a pin at
// 365.5, which leaves a putt rather than a tap-in.
export const HOLE_1 = {
  n: 1,
  par: 4,
  cardYards: 360.7,
  tee: [0, 5],
  pin: [12, 365.5],
  bounds: { minX: -55, maxX: 55, minY: -45, maxY: 435 },
  base: 'heavyRough',
  surfaces: [
    { kind: 'lightRough', poly: [
      [-27, 10], [-23, 60], [-19, 110], [-13, 160], [-11, 200], [-15, 250], [-23, 300], [-20, 340],
      [34, 340], [31, 300], [39, 250], [43, 200], [41, 160], [35, 110], [31, 60], [27, 10]] },
    { kind: 'fairway', poly: [
      [-15, 15], [-11, 60], [-7, 110], [-1, 160], [1, 200], [-3, 250], [-11, 300], [-8, 335],
      [22, 335], [19, 300], [27, 250], [31, 200], [29, 160], [23, 110], [19, 60], [15, 15]] },
    { kind: 'trees', poly: [
      [-30, 20], [-26, 120], [-16, 190], [-14, 230], [-22, 300], [-23, 340], [-48, 340], [-48, 20]] },
    { kind: 'trees', poly: [
      [30, 20], [33, 80], [37, 150], [38, 210], [40, 240], [45, 300], [36, 340], [48, 340], [48, 20]] },
    { kind: 'water', poly: [[-55, -10], [-24, -10], [-24, 75], [-40, 90], [-55, 90]] },
    { kind: 'water', poly: [
      [-30, 320], [-10, 326], [-8, 352], [-9, 378], [-2, 384], [16, 386], [30, 383], [40, 378],
      [50, 378], [50, 435], [-30, 435]] },
    // The collar. Painted BEFORE the green so the green sits on top of it, and before the bunkers
    // so sand still wins where they overlap.
    { kind: 'fringe', poly: greenPoly(10, 362, 20) },
    { kind: 'greensideBunker', poly: [[-7, 340], [-5, 345], [0, 347], [5, 345], [7, 340], [5, 335], [0, 333], [-5, 335]] },
    { kind: 'greensideBunker', poly: [[26, 358], [28, 362], [32, 364], [36, 362], [38, 358], [36, 354], [32, 352], [28, 354]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-6, 0], [6, 0], [6, 10], [-6, 10]] },
  ],
  green: {
    poly: greenPoly(10, 362, 14),
    // Back-to-front with a soft spine down the middle, steepening toward the water behind.
    slope: slopeGrid({ fall: [0, -0.15] }),
  },
  treeTypes: TREE_TYPES,
  trees: [],
  treeBelts: [
    { poly: [[-30, 20], [-26, 120], [-16, 190], [-14, 230], [-22, 300], [-23, 340], [-48, 340], [-48, 20]], type: 0, spacing: 9, seed: 101 },
    { poly: [[30, 20], [33, 80], [37, 150], [38, 210], [40, 240], [45, 300], [36, 340], [48, 340], [48, 20]], type: 0, spacing: 9, seed: 102 },
  ],
  decor: [
    { kind: 'path', poly: [[-34, 10], [-31, 10], [-27, 120], [-19, 200], [-27, 300], [-30, 340], [-33, 340], [-30, 300], [-22, 200], [-30, 120]] },
  ],
};

// -------------------------------------------------------------------- hole 2 ----
// Par 3, 181.0 yds. THE ISLAND GREEN: the entire hole is water, with a kidney-shaped green and one
// large bunker on its left sitting in the middle of it. No fairway at all.
//
// This is the hole that pays for `base`: water as the base surface plus a green, a bunker and a
// tee IS an island green. Nothing else is needed.
//
// A slightly stretched 2 iron (175 stock) off the tee. There is no bail-out, by design.
export const HOLE_2 = {
  n: 2,
  par: 3,
  cardYards: 181.0,
  tee: [0, 5],
  pin: [2, 185],
  bounds: { minX: -50, maxX: 50, minY: -45, maxY: 270 },
  base: 'water',
  surfaces: [
    // The island itself: a rough collar the green and bunker sit on.
    { kind: 'lightRough', poly: [
      [-24, 176], [-20, 200], [-8, 212], [8, 214], [22, 206], [28, 190],
      [26, 172], [14, 158], [-2, 154], [-16, 160]] },
    { kind: 'fringe', poly: greenPoly(4, 185, 20, 16) },
    { kind: 'greensideBunker', poly: [[-19, 182], [-17, 190], [-12, 196], [-6, 195], [-4, 188], [-7, 179], [-13, 176], [-17, 177]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-7, 0], [7, 0], [7, 11], [-7, 11]] },
  ],
  green: {
    // Kidney-shaped: a 12-gon squeezed on one axis, with the bunker biting into its left.
    poly: greenPoly(4, 185, 15, 11),
    // Falls toward the front-right, away from the bunker side, so a long miss feeds back down.
    slope: slopeGrid({ fall: [0.06, -0.18], spine: 0.04 }),
  },
  treeTypes: TREE_TYPES,
  trees: [],
  treeBelts: [],
  decor: [],
};

// -------------------------------------------------------------------- hole 3 ----
// Par 5, 608.6 yds. Long dogleg: trees pinch the tee shot, a large lake crosses the fairway as a
// mid-hole carry, bunkers guard the green right.
//
// cardYards is measured ALONG THE DOGLEG CENTRELINE and does NOT match the straight line from the
// tee to the pin - the HUD will read well under 608.6 at address. That is correct and is how every
// real scorecard differs from every real rangefinder. Do not "fix" it by deriving one from the
// other; golf/CLAUDE.md, "Two different yardages".
//
// A genuine three-shot hole on the stock ladder: driver, 3 wood, 3 wood is about 605 along the
// centreline.
export const HOLE_3 = {
  n: 3,
  par: 5,
  cardYards: 608.6,
  tee: [0, 5],
  pin: [58, 540],
  bounds: { minX: -70, maxX: 110, minY: -45, maxY: 620 },
  base: 'heavyRough',
  surfaces: [
    { kind: 'lightRough', poly: [
      [-26, 8], [-24, 90], [-20, 180], [-12, 250], [0, 320], [22, 380], [46, 420], [64, 460], [70, 510], [72, 552],
      [96, 552], [94, 500], [88, 452], [70, 404], [46, 358], [26, 302], [16, 240], [16, 170], [20, 90], [24, 8]] },
    { kind: 'fairway', poly: [
      [-15, 12], [-13, 90], [-9, 180], [-1, 250], [11, 318], [33, 376], [57, 416], [72, 458], [78, 508], [80, 548],
      [86, 548], [84, 500], [78, 448], [60, 400], [36, 354], [16, 300], [6, 240], [6, 172], [10, 90], [13, 12]] },
    { kind: 'trees', poly: [[-28, 10], [-26, 120], [-20, 220], [-10, 300], [-44, 300], [-48, 160], [-46, 10]] },
    { kind: 'trees', poly: [[26, 10], [22, 100], [22, 180], [30, 250], [58, 250], [54, 140], [52, 10]] },
    // The lake crossing the fairway: the mid-hole carry.
    { kind: 'water', poly: [[-14, 246], [16, 256], [42, 282], [58, 316], [46, 330], [22, 302], [-4, 280], [-20, 268]] },
    { kind: 'fairwayBunker', poly: [[16, 176], [20, 184], [26, 186], [30, 180], [28, 170], [22, 166], [17, 169]] },
    { kind: 'fringe', poly: greenPoly(58, 538, 20, 21) },
    { kind: 'greensideBunker', poly: [[74, 512], [78, 520], [84, 522], [88, 515], [86, 505], [80, 501], [75, 505]] },
    { kind: 'greensideBunker', poly: [[68, 552], [72, 560], [78, 562], [83, 556], [81, 546], [75, 543], [69, 546]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-6, 0], [6, 0], [6, 10], [-6, 10]] },
  ],
  green: {
    poly: greenPoly(58, 538, 14, 15),
    // Falls back-to-front and slightly left, toward the fairway the approach comes from.
    slope: slopeGrid({ fall: [-0.05, -0.16] }),
  },
  treeTypes: TREE_TYPES,
  trees: [
    // The lone fairway tree. This is hole 3's signature: the reference's tee shot finishes behind
    // it and the game prompts for a drop (golf-reference-spec.md §21.2). Hazards and the drop
    // prompt are Stage C; the tree itself is here now so the hole is the hole.
    { x: -2, y: 205, type: 1 },
  ],
  treeBelts: [
    { poly: [[-28, 10], [-26, 120], [-20, 220], [-10, 300], [-44, 300], [-48, 160], [-46, 10]], type: 0, spacing: 10, seed: 301 },
    { poly: [[26, 10], [22, 100], [22, 180], [30, 250], [58, 250], [54, 140], [52, 10]], type: 0, spacing: 10, seed: 302 },
  ],
  decor: [],
};

export const PINE_VALLEY = {
  id: 'pinevalley3',            // FROZEN: the bestRoundByCourse key (THE LAW rule 5)
  name: 'Pine Valley',
  holes: [HOLE_1, HOLE_2, HOLE_3],
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 12 over these three holes
};

export default PINE_VALLEY;
