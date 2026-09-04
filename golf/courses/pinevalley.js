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
import { makeHole, greenPoly, slopeGrid } from '../js/holegen.js';

const TREE_TYPES = [
  { name: 'pine', trunk: 0.6, canopy: 4.5, height: 18 },   // tall and narrow: clearing it costs a club
  { name: 'oak', trunk: 1.0, canopy: 8.0, height: 13 },    // wide and low: easier over, harder around
];

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
  // The playing line, taken off the fairway polygon's own midpoints. Art and tests only, never a
  // rule - see holegen.js's `route`. A test player that aims at the pin from a dogleg tee walks
  // into the trees and reports a good hole as broken.
  route: [[0, 5], [0, 15], [4, 60], [8, 110], [14, 160], [16, 200], [12, 250], [4, 300], [7, 335], [12, 365.5]],
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
  route: [[0, 5], [2, 185]],
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
  route: [[0, 5], [-1, 90], [-1, 180], [3, 245], [14, 320], [35, 376], [58, 416], [74, 460], [70, 505], [58, 540]],
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


// ================================================================== holes 4-18 ====
//
// Holes 1-3 above are hand-authored, because they are the three the reference footage documents
// and every polygon in them was placed against a frame. The other fifteen are built by
// `makeHole()` (golf/js/holegen.js) from a DESIGN SPEC: a centreline, a fairway width profile, and
// the hazards placed as "at 0.55 of the way round, 18 yards left". Both forms produce the same
// hole object and validateHole() checks them identically - see holegen.js's header for why the
// second form exists at all.
//
// PAR 72, and the yardages are cut to THE STOCK BAG rather than to a real scorecard. Driver 215 +
// 3 wood 195 is the whole of a two-shot hole, so a par 4 over about 400 yds could not be reached
// in regulation by anyone, ever - it would be a par 5 wearing a 4. Every hole here is reachable in
// regulation with clean strikes, and golf/js/test.js asserts exactly that over all 36 holes on
// both courses.
//
// The nicknames are not decoration: they are the one-line statement of what each hole is FOR, and
// they show on the hole-select screen and the scorecard.

/** Pine Valley's house style: pines and oaks down both sides unless a hole says otherwise. */
const pv = (spec) => makeHole({ treeTypes: TREE_TYPES, ...spec });

export const HOLE_4 = pv({
  n: 4, par: 4, nickname: 'The Chute',
  // Dead straight, and that is the trick: the tree belts squeeze the corridor to 9 yards exactly
  // where a drive lands, so the safe play is a 3 wood short of the gate.
  path: [[0, 5], [2, 120], [7, 250], [5, 372]],
  fw: [{ at: 0, w: 17 }, { at: 0.45, w: 9 }, { at: 0.7, w: 11 }, { at: 1, w: 15 }],
  belts: { left: { depth: 26, spacing: 8, seed: 401 }, right: { depth: 26, spacing: 8, seed: 402 } },
  bunkers: [
    { at: 0.5, side: 1, off: 15, r: 6, kind: 'fairwayBunker' },
    { at: 0.97, side: -1, off: 19, r: 6 },
  ],
  water: [{ at: 1, side: -1, off: 36, rx: 17, ry: 24, seed: 403 }],
  slope: { fall: [0.05, -0.15] },
});

export const HOLE_5 = pv({
  n: 5, par: 4, nickname: 'Bell Ridge',
  // Dogleg right around a stand of oaks. Cutting the corner is 20 yards nearer the green and
  // brings the fairway bunker on the inside of the bend into play.
  path: [[0, 5], [-4, 110], [22, 240], [54, 330], [62, 398]],
  fw: [{ at: 0, w: 16 }, { at: 0.4, w: 13 }, { at: 0.75, w: 12 }, { at: 1, w: 15 }],
  belts: { left: { depth: 24, spacing: 9, seed: 501 }, right: { depth: 24, spacing: 9, type: 1, seed: 502 } },
  bunkers: [
    { at: 0.55, side: 1, off: 17, r: 8, ry: 5, kind: 'fairwayBunker' },
    { at: 0.96, side: -1, off: 18, r: 6 },
    { at: 1, side: 1, off: 21, r: 6 },
  ],
  slope: { fall: [-0.06, -0.14], back: 0.11 },
});

export const HOLE_6 = pv({
  n: 6, par: 3, nickname: 'Cathedral',
  // Short, straight, and framed by pines the whole way. The green is small and falls hard from
  // back to front, so anything long comes back down to you - or past you.
  path: [[0, 5], [0, 80], [2, 152]],
  fw: [{ at: 0, w: 13 }, { at: 1, w: 12 }],
  greenR: 12,
  belts: { left: { depth: 28, spacing: 7, seed: 601 }, right: { depth: 28, spacing: 7, seed: 602 } },
  bunkers: [
    { at: 0.98, side: -1, off: 17, r: 6 },
    { at: 0.98, side: 1, off: 17, r: 6 },
  ],
  slope: { fall: [0, -0.34], spine: 0.05, back: 0.14 },
});

export const HOLE_7 = pv({
  n: 7, par: 5, nickname: 'Long Meadow',
  // A gentle S with a creek across it at the lay-up. Three-shot for most people; two for anyone
  // who takes the carry on. The green is open in front, so a running third is a real option.
  path: [[0, 5], [-8, 130], [14, 280], [4, 400], [10, 505]],
  fw: [{ at: 0, w: 17 }, { at: 0.5, w: 14 }, { at: 0.78, w: 11 }, { at: 1, w: 16 }],
  belts: { left: { depth: 22, spacing: 10, seed: 701 }, right: { depth: 22, spacing: 10, seed: 702 } },
  water: [{ at: 0.63, side: 0, off: 0, rx: 26, ry: 9, seed: 703, n: 14 }],
  bunkers: [
    { at: 0.42, side: -1, off: 16, r: 7, kind: 'fairwayBunker' },
    { at: 0.99, side: 1, off: 19, r: 6 },
  ],
  slope: { fall: [0.03, -0.13] },
});

export const HOLE_8 = pv({
  n: 8, par: 4, nickname: 'Short Straw',
  // 298 yards: a driver gets there. So does the water, which runs the whole left side from the tee
  // to the green, and the green is ringed with sand. The bail-out is a 7 iron and a wedge.
  path: [[0, 5], [6, 110], [12, 210], [10, 298]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 12 }, { at: 1, w: 13 }],
  belts: { left: false, right: { depth: 26, spacing: 8, seed: 802 } },
  water: [{ at: 0.5, side: -1, off: 30, rx: 15, ry: 100, seed: 803, n: 16 }],
  bunkers: [
    { at: 0.98, side: 1, off: 19, r: 6 },
    { at: 1, side: 0, off: 0, r: 0.1, poly: null, kind: 'greensideBunker', at2: 0 },
    { at: 0.93, side: 0, off: -20, r: 6 },
  ],
  slope: { fall: [-0.04, -0.19], back: 0.12 },
});

export const HOLE_9 = pv({
  n: 9, par: 4, nickname: 'Homeward',
  // Dogleg left, uphill in feel: a big bunker sits on the corner where a drawn drive wants to
  // finish, and the green has a false front that rejects anything short.
  path: [[0, 5], [8, 120], [-14, 250], [-34, 330], [-38, 386]],
  fw: [{ at: 0, w: 16 }, { at: 0.45, w: 12 }, { at: 1, w: 14 }],
  belts: { left: { depth: 24, spacing: 9, type: 1, seed: 901 }, right: { depth: 24, spacing: 9, seed: 902 } },
  bunkers: [
    { at: 0.52, side: -1, off: 16, r: 9, ry: 5, kind: 'fairwayBunker' },
    { at: 0.95, side: 1, off: 19, r: 6 },
  ],
  slope: { fall: [0.05, -0.28], spine: 0.06, back: 0.16 },
});

export const HOLE_10 = pv({
  n: 10, par: 4, nickname: 'Split Oak',
  // One oak, alone in the middle of the fairway at driving distance. Left of it is 8 yards wider;
  // right of it is the shorter way in. This is the hole the tree-object model exists for.
  path: [[0, 5], [-2, 120], [6, 240], [2, 348]],
  fw: [{ at: 0, w: 18 }, { at: 0.55, w: 17 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 10, seed: 1001 }, right: { depth: 22, spacing: 10, seed: 1002 } },
  trees: [{ at: 0.56, side: 1, off: 3, type: 1 }, { at: 0.62, side: -1, off: 7, type: 1 }],
  bunkers: [
    { at: 0.97, side: -1, off: 18, r: 6 },
    { at: 0.99, side: 1, off: 20, r: 5 },
  ],
  slope: { fall: [0.02, -0.15] },
});

export const HOLE_11 = pv({
  n: 11, par: 5, nickname: 'The Quarry',
  // Wide off the tee and then it narrows twice. A chain of sand runs up the right; water sits
  // short-right of the green exactly where a laid-up third wants to be.
  path: [[0, 5], [10, 140], [-6, 300], [10, 430], [26, 545]],
  fw: [{ at: 0, w: 19 }, { at: 0.4, w: 14 }, { at: 0.72, w: 11 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 10, seed: 1101 }, right: { depth: 20, spacing: 11, seed: 1102 } },
  bunkers: [
    { at: 0.36, side: 1, off: 17, r: 8, ry: 5, kind: 'fairwayBunker' },
    { at: 0.5, side: 1, off: 19, r: 7, ry: 5, kind: 'fairwayBunker' },
    { at: 0.68, side: 1, off: 18, r: 7, ry: 5, kind: 'fairwayBunker' },
    { at: 0.98, side: -1, off: 19, r: 6 },
  ],
  water: [{ at: 0.93, side: 1, off: 26, rx: 15, ry: 18, seed: 1103 }],
  slope: { fall: [-0.05, -0.15] },
});

export const HOLE_12 = pv({
  n: 12, par: 3, nickname: 'Pulpit',
  // The long par 3. A pond fills the front-right and the only bail-out is left, which leaves the
  // hardest chip on the course back down the slope.
  path: [[0, 5], [4, 100], [8, 192]],
  fw: [{ at: 0, w: 12 }, { at: 0.6, w: 10 }, { at: 1, w: 14 }],
  greenR: 13, greenRy: 16,
  belts: { left: { depth: 24, spacing: 9, seed: 1201 }, right: false },
  water: [{ at: 0.86, side: 1, off: 12, rx: 22, ry: 26, seed: 1202 }],
  bunkers: [{ at: 0.98, side: -1, off: 17, r: 6 }],
  slope: { fall: [-0.08, -0.2], spine: 0.05 },
});

export const HOLE_13 = pv({
  n: 13, par: 4, nickname: 'Fox Run',
  // Short and sharp: a hard dogleg right through the pines to a small green. There is no room to
  // miss on either side, and the tee shot is deliberately a 5 iron for most people.
  path: [[0, 5], [0, 95], [22, 180], [50, 232], [70, 300]],
  fw: [{ at: 0, w: 14 }, { at: 0.5, w: 11 }, { at: 1, w: 13 }],
  greenR: 12,
  belts: { left: { depth: 26, spacing: 8, seed: 1301 }, right: { depth: 26, spacing: 8, seed: 1302 } },
  bunkers: [
    { at: 0.55, side: 1, off: 15, r: 6, kind: 'fairwayBunker' },
    { at: 0.98, side: 1, off: 17, r: 6 },
    { at: 0.94, side: -1, off: 17, r: 5 },
  ],
  slope: { fall: [0.06, -0.18], back: 0.12 },
});

export const HOLE_14 = pv({
  n: 14, par: 4, nickname: 'Highwater',
  // Water down the entire right side, and the green is a peninsula out into it. The fairway tilts
  // that way too, so the safe line is further left than it looks.
  path: [[0, 5], [-6, 130], [-2, 260], [4, 394]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 13 }, { at: 1, w: 14 }],
  belts: { left: { depth: 26, spacing: 9, seed: 1401 }, right: false },
  water: [{ at: 0.55, side: 1, off: 34, rx: 18, ry: 130, seed: 1402, n: 18 }],
  bunkers: [{ at: 0.96, side: -1, off: 18, r: 7 }],
  slope: { fall: [0.1, -0.13], spine: 0.04 },
});

export const HOLE_15 = pv({
  n: 15, par: 5, nickname: 'The Marathon',
  // The longest hole on the property. Double dogleg, sand staged at every landing area, and a
  // green sitting in a bowl so a long third funnels back toward the middle.
  path: [[0, 5], [-14, 150], [16, 300], [-6, 440], [8, 572]],
  fw: [{ at: 0, w: 18 }, { at: 0.35, w: 13 }, { at: 0.65, w: 12 }, { at: 1, w: 16 }],
  belts: { left: { depth: 22, spacing: 10, seed: 1501 }, right: { depth: 22, spacing: 10, seed: 1502 } },
  bunkers: [
    { at: 0.33, side: -1, off: 16, r: 7, kind: 'fairwayBunker' },
    { at: 0.62, side: 1, off: 16, r: 7, kind: 'fairwayBunker' },
    { at: 0.97, side: -1, off: 19, r: 6 },
    { at: 0.99, side: 1, off: 19, r: 6 },
  ],
  greenR: 16,
  slope: { fall: [0, -0.08], spine: 0.09, back: 0.04 },
});

export const HOLE_16 = pv({
  n: 16, par: 3, nickname: 'Postage',
  // 138 yards to a green you could park a car on, ringed by sand on three sides and falling away
  // on the fourth. A wedge, and nowhere to miss it.
  path: [[0, 5], [-2, 70], [0, 140]],
  fw: [{ at: 0, w: 11 }, { at: 1, w: 10 }],
  greenR: 10,
  belts: { left: { depth: 26, spacing: 8, seed: 1601 }, right: { depth: 26, spacing: 8, seed: 1602 } },
  bunkers: [
    { at: 0.97, side: -1, off: 15, r: 6 },
    { at: 0.97, side: 1, off: 15, r: 6 },
    { at: 0.9, side: 0, off: 0, r: 6, ry: 4 },
  ],
  slope: { fall: [0.05, -0.36], spine: 0.08, back: 0.15 },
});

export const HOLE_17 = pv({
  n: 17, par: 4, nickname: 'Gallery',
  // Straight, narrow, and walled with pines both sides for its whole length. The green is two
  // tiers - the spine down the middle is strong enough to send a putt to the wrong half.
  path: [[0, 5], [4, 130], [-2, 250], [2, 368]],
  fw: [{ at: 0, w: 14 }, { at: 0.5, w: 11 }, { at: 1, w: 13 }],
  belts: { left: { depth: 30, spacing: 7, seed: 1701 }, right: { depth: 30, spacing: 7, seed: 1702 } },
  bunkers: [
    { at: 0.6, side: -1, off: 15, r: 6, kind: 'fairwayBunker' },
    { at: 0.98, side: 1, off: 18, r: 6 },
  ],
  greenR: 15,
  slope: { fall: [0, -0.12], spine: 0.16, back: 0.06 },
});

export const HOLE_18 = pv({
  n: 18, par: 4, nickname: 'Home',
  // The finisher: a lake all the way up the left from the drive to the green, sand on the right,
  // and the biggest green on the course to aim at. Everything is on the line you dare take.
  path: [[0, 5], [8, 130], [18, 270], [14, 400]],
  fw: [{ at: 0, w: 17 }, { at: 0.5, w: 13 }, { at: 1, w: 16 }],
  belts: { left: false, right: { depth: 24, spacing: 9, seed: 1802 } },
  water: [{ at: 0.6, side: -1, off: 30, rx: 16, ry: 120, seed: 1803, n: 18 }],
  bunkers: [
    { at: 0.55, side: 1, off: 16, r: 7, kind: 'fairwayBunker' },
    { at: 0.97, side: 1, off: 20, r: 7 },
  ],
  greenR: 17, greenRy: 15,
  slope: { fall: [-0.04, -0.13], spine: 0.07 },
  decor: [{ kind: 'path', poly: [[34, 20], [37, 20], [42, 200], [40, 400], [37, 400], [39, 200]] }],
});

export const HOLES = [
  HOLE_1, HOLE_2, HOLE_3, HOLE_4, HOLE_5, HOLE_6, HOLE_7, HOLE_8, HOLE_9,
  HOLE_10, HOLE_11, HOLE_12, HOLE_13, HOLE_14, HOLE_15, HOLE_16, HOLE_17, HOLE_18,
];

export const PINE_VALLEY = {
  id: 'pinevalley',
  name: 'Pine Valley',
  theme: 'pine',
  blurbKey: 'blurb_pinevalley',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 72
};

export default PINE_VALLEY;
