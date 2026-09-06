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
  // THE SENTINEL PINE CANNOT BE FLOWN BY ANYTHING. Matt, 2026-09-05: holes *"must change
  // directions with trees too tall to hit over."* MEASURED against the stock bag: the
  // highest-peaking club in it is the 8 iron at 32.3 yds of apex, reached halfway through a
  // 120 yd shot - so a 40 yd canopy is over every ball in the game from every distance. A corner
  // planted with these has to be gone AROUND, which is what turns a dogleg from a suggestion into
  // a decision. Used sparingly and only at corners: a hole walled with them is not a hole.
  { name: 'sentinel', trunk: 1.2, canopy: 9.0, height: 40 },
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
    // RE-CUT 2026-09-05. These two rings used to be eight points a side at a DEAD CONSTANT 15 yd
    // half-width - a 1.0 : 1 corridor, on the first hole anybody plays. Matt: "your fairways are
    // almost perfect rectangles, so it's not challenging or fun." The centreline, the water, the
    // bunkers, the green and its slope grid are all untouched; only the corridor is new.
    //
    // The profile is DESIGNED against the stock ladder, the same rule holegen.js now applies to
    // the other thirty-three: the drive carries 215, so the fairway necks to 9-10 yds there and
    // opens to 19-21 either side of it. The two edges are cut SEPARATELY - the hole bends right to
    // y=200 and back left after it, so the left edge (the outside of that first bend) swings while
    // the right holds a near-straight line. That is the reference frame's own signature, measured:
    // left edge sd 40 px against right edge sd 77 px over the same 776 px of hole.
    { kind: 'lightRough', poly: [
      [26.1,12.7], [26.2,17.7], [26.3,22.7], [26.5,27.8], [26.7,32.8], [26.9,37.8],
      [27.1,42.8], [27.5,47.8], [27.8,52.8], [28.2,58], [28.6,63.1], [28.9,68.1],
      [29.3,73.1], [29.6,78.1], [30,83.1], [30.3,88.1], [30.5,93.1], [30.7,98.1],
      [30.9,103.1], [31,107.7], [31.3,112.3], [31.6,117.3], [31.9,122.3], [32.2,127.4],
      [32.5,132.4], [32.9,137.4], [33.2,142.5], [33.6,147.5], [33.9,152.5], [34.4,158.3],
      [34.6,164], [34.8,169], [35,174], [35.3,179], [35.5,184], [35.8,189],
      [36.1,194], [36.3,200.3], [36.4,206.7], [36.7,211.7], [36.9,216.8], [37.1,221.8],
      [37.3,226.9], [37.4,231.9], [37.5,236.9], [37.5,242], [37.5,247], [37.7,253.1],
      [37.4,259.2], [37.3,264.3], [37.1,269.4], [37,274.5], [36.9,279.6], [36.9,284.7],
      [36.8,289.9], [36.9,295], [35.8,300], [35,301.2], [34.9,302.4], [35,307.4],
      [35,312.4], [35,317.5], [35,322.5], [34.8,327.6], [34.7,332.6], [-21.5,337.4],
      [-22.2,332.5], [-22.9,327.5], [-23.6,322.5], [-24.4,317.5], [-25.2,312.6], [-26.1,307.6],
      [-27,298.8], [-26.3,290], [-25.8,285], [-24.5,280.1], [-23.1,275.1], [-21.7,270.3],
      [-20.1,265.4], [-18.6,260.5], [-16.9,255.6], [-15.2,250.8], [-13.6,246.9], [-12.4,243],
      [-11.2,238.1], [-10,233.1], [-8.9,228.2], [-7.8,223.3], [-6.8,218.3], [-5.8,213.3],
      [-4.9,208.4], [-4.1,203.4], [-3.6,199.7], [-4.5,196], [-5.6,191.1], [-6.7,186.1],
      [-7.9,181.1], [-9.1,176.2], [-10.3,171.2], [-11.6,166.3], [-12.9,162.3], [-14.4,158.3],
      [-16,153.5], [-17.6,148.6], [-18.7,143.6], [-19.5,138.7], [-20.3,133.7], [-21,128.7],
      [-21.6,123.7], [-22.3,118.7], [-23.1,113.1], [-23.6,107.5], [-24.2,102.5], [-24.7,97.5],
      [-25.4,92.5], [-26.1,87.6], [-26.9,82.6], [-27.7,77.6], [-28.2,72.6], [-28.5,67.6],
      [-28.7,62.8], [-29,57.9], [-29.1,52.9], [-29.3,47.8], [-29.3,42.8], [-29.2,37.8],
      [-29.1,32.7], [-28.9,27.6], [-28.6,22.6], [-28.2,17.5]] },
    { kind: 'fairway', poly: [
      [15.1,13.7], [15.2,18.7], [15.4,23.7], [15.5,28.7], [15.7,33.8], [15.9,38.8],
      [16.2,43.8], [16.5,48.8], [16.8,53.8], [17.2,58.9], [17.6,63.9], [17.9,68.9],
      [18.3,74], [18.7,79], [19,84], [19.3,89], [19.6,94], [19.8,99],
      [20,104], [20.1,108.8], [20.4,113.6], [20.7,118.6], [21,123.7], [21.3,128.7],
      [21.6,133.7], [22,138.8], [22.3,143.8], [22.6,148.8], [23,153.8], [23.5,159.2],
      [23.6,164.5], [23.8,169.5], [24,174.5], [24.3,179.5], [24.6,184.5], [24.8,189.5],
      [25.1,194.5], [25.3,200.1], [25.4,205.8], [25.7,210.8], [26,215.9], [26.2,220.9],
      [26.3,226], [26.5,231], [26.5,236.1], [26.6,241.1], [26.5,246.1], [26.7,251.8],
      [26.5,257.5], [26.4,262.6], [26.3,267.7], [26.1,272.8], [26,277.9], [26,283],
      [26,288.1], [26,293.3], [24.9,298.2], [24,300.7], [24,303.3], [24,308.4],
      [24.1,313.4], [24.1,318.4], [24,323.5], [23.9,328.5], [23.7,333.6], [-10.6,336.5],
      [-11.2,331.5], [-11.9,326.5], [-12.7,321.6], [-13.4,316.6], [-14.3,311.6], [-15.1,306.7],
      [-16,299.3], [-15.4,291.8], [-15,286.7], [-13.6,281.8], [-12.3,276.9], [-10.8,272],
      [-9.3,267.1], [-7.7,262.2], [-6,257.4], [-4.3,252.5], [-2.7,248.2], [-1.5,243.9],
      [-0.3,239], [0.9,234], [2.1,229.1], [3.2,224.1], [4.2,219.2], [5.1,214.2],
      [6,209.3], [6.8,204.3], [7.4,199.9], [6.4,195.5], [5.4,190.5], [4.3,185.5],
      [3.1,180.6], [1.9,175.6], [0.6,170.7], [-0.7,165.7], [-1.9,161.4], [-3.5,157],
      [-5.1,152.1], [-6.7,147.3], [-7.8,142.3], [-8.6,137.4], [-9.3,132.4], [-10,127.4],
      [-10.7,122.4], [-11.4,117.4], [-12.1,112], [-12.6,106.6], [-13.2,101.6], [-13.8,96.6],
      [-14.4,91.7], [-15.1,86.7], [-15.9,81.7], [-16.7,76.8], [-17.3,71.8], [-17.5,66.8],
      [-17.8,61.8], [-18,56.9], [-18.2,51.9], [-18.3,46.9], [-18.3,41.8], [-18.3,36.8],
      [-18.1,31.7], [-17.9,26.7], [-17.6,21.6], [-17.2,16.5]] },
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
    // The last argument is the green's SHAPE SEED: holes 1-3 are hand-authored, so they name it
    // rather than getting `n * 6151 + 991` from holegen.js. A green and its own fringe must share
    // it, or the collar crosses the putting surface.
    { kind: 'fringe', poly: greenPoly(10, 362, 20, 20, 7142) },
    // The drive's landing zone, now that the corridor necks to about 9 yds there. Every other hole
    // gets one of these from holegen.js's `defend` rule; hole 1 is hand-authored, so it is written
    // out. It sits just off the RIGHT edge at the neck - the inside of the first bend, which is
    // the corner a big drive is tempted to cut.
    { kind: 'fairwayBunker', poly: [[22.5, 199], [26, 195.5], [30.5, 195], [33.5, 198], [34, 203], [32, 208], [28, 210.5], [24, 209], [22, 205]] },
    { kind: 'greensideBunker', poly: [[-7, 340], [-5, 345], [0, 347], [5, 345], [7, 340], [5, 335], [0, 333], [-5, 335]] },
    { kind: 'greensideBunker', poly: [[26, 358], [28, 362], [32, 364], [36, 362], [38, 358], [36, 354], [32, 352], [28, 354]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-6, 0], [6, 0], [6, 10], [-6, 10]] },
  ],
  green: {
    poly: greenPoly(10, 362, 14, 14, 7142),
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
    { kind: 'fringe', poly: greenPoly(4, 185, 20, 16, 13293) },
    { kind: 'greensideBunker', poly: [[-19, 182], [-17, 190], [-12, 196], [-6, 195], [-4, 188], [-7, 179], [-13, 176], [-17, 177]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-7, 0], [7, 0], [7, 11], [-7, 11]] },
  ],
  green: {
    // Kidney-shaped: a 12-gon squeezed on one axis, with the bunker biting into its left.
    poly: greenPoly(4, 185, 15, 11, 13293),
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
    // MOVED AND THINNED 2026-09-05. The diagonal lake is this hole's documented feature and it
    // stays, but it used to start at y=246 - which, once distance began to scatter inside the green
    // band, left only ~30 yds of dry ground between a 215 yd drive and the water. Measured, the
    // hole played to +2.98 with 48 % bogey-or-worse, on the THIRD hole of the course, which is
    // meant to be the gentlest golf on the property. Pulled back 16 yds and narrowed, so the lay-up
    // band is ~55 yds wide and the carry is a decision rather than a coin toss.
    { kind: 'water', poly: [[-14, 262], [16, 272], [42, 296], [58, 326], [48, 337], [24, 313], [-2, 292], [-18, 283]] },
    { kind: 'fairwayBunker', poly: [[16, 176], [20, 184], [26, 186], [30, 180], [28, 170], [22, 166], [17, 169]] },
    { kind: 'fringe', poly: greenPoly(58, 538, 20, 21, 19444) },
    { kind: 'greensideBunker', poly: [[74, 512], [78, 520], [84, 522], [88, 515], [86, 505], [80, 501], [75, 505]] },
    { kind: 'greensideBunker', poly: [[68, 552], [72, 560], [78, 562], [83, 556], [81, 546], [75, 543], [69, 546]] },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-6, 0], [6, 0], [6, 10], [-6, 10]] },
  ],
  green: {
    poly: greenPoly(58, 538, 14, 15, 19444),
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
  // The belts squeeze the corridor to 9 yards exactly where a drive lands, so the safe play is a
  // 3 wood short of the gate. The green has sand across its front, so the lay-back still has to be
  // flown in.
  //
  // RE-CUT 2026-09-06 with the rest of the front nine. It used to run [[0,5],[2,120],[7,250],
  // [5,372]] - 4 yards of offset from the straight tee-to-pin line over 367 yards, which is a
  // ruler. THE LEAN IS SET IN THE FIRST 70 YARDS and then the hole runs straight: the tee shot is
  // aimed a long way left of the pin and everything after it is honest. No other hole out here
  // turns before the ball has left the tee, and it costs nothing on the opening stretch - a hole
  // that asks you to AIM is not a hole that asks you to gamble.
  path: [[0, 5], [-18, 70], [-38, 145], [-42, 235], [-36, 320], [-30, 372]],
  fw: [{ at: 0, w: 17 }, { at: 0.45, w: 9 }, { at: 0.7, w: 11 }, { at: 1, w: 15 }],
  belts: { left: { depth: 26, spacing: 8, seed: 401 }, right: { depth: 26, spacing: 8, seed: 402 } },
  bunkers: [{ at: 0.5, side: 1, off: 15, r: 6, kind: 'fairwayBunker' }],
  water: [{ at: 1, side: 1, off: 36, rx: 17, ry: 24, seed: 403 }],
  // A TEARDROP THE OTHER WAY UP FROM HOLE 12'S. That one has its point AT you, so the target
  // narrows the harder you carry it. This one is fat at the front and tapers away behind, so a
  // shot that lands is safe and one that flies the pin runs out of green. Same family, opposite
  // question, which is the whole reason the shapes are radius functions with an angle.
  guard: ['frontJaws', 'rightSand'],
  greenShape: 'teardrop',
  greenAngle: 0,
  slope: 'gentle',
  // NO SIZE OVERRIDE, and that was checked rather than assumed. A teardrop's point is a few yards
  // of radius by construction - measured 4.0-19.3 here, against the three already shipped: hole 12
  // 3.6-16.6, hole 15 4.2-18.8, hole 18 3.8-16.9. The tip is the TAIL of the drop, at the BACK on
  // this hole, and nobody aims at it. Hole 15's `greenR` bump was for the opposite case, where the
  // notch ate the part of the green being played to.
});

export const HOLE_5 = pv({
  n: 5, par: 4, nickname: 'Bell Ridge',
  // Bends hard right round a stand of oaks. The green sits on a shelf that steps up halfway
  // through it, so the pin position decides whether the approach is a 6 iron or a 5.
  path: [[0, 5], [-4, 110], [22, 240], [54, 330], [62, 398]],
  fw: [{ at: 0, w: 16 }, { at: 0.4, w: 13 }, { at: 0.75, w: 11 }, { at: 1, w: 14 }],
  belts: { left: { depth: 24, spacing: 9, seed: 501 }, right: { depth: 24, spacing: 9, type: 1, seed: 502 } },
  bunkers: [{ at: 0.55, side: -1, off: 17, r: 8, kind: 'fairwayBunker' }],
  // BROADSIDE: long and narrow turned 90 degrees ACROSS the approach, so the green is wide and
  // shallow and depth is the only thing that matters. On the longest par 4 on the property that is
  // the right ask - the approach is a long iron, and a long iron's miss is long or short.
  // Hole 7 uses the same family END-ON for the opposite reason.
  guard: ['leftSand', 'backSand'],
  greenShape: 'long',
  greenAngle: 90,
  slope: 'tier',
});

export const HOLE_6 = pv({
  n: 6, par: 3, nickname: 'Cathedral',
  // Straight down an avenue of pines to a green in a bowl. Everything that lands on it feeds
  // toward the middle, which is why this is the last genuinely kind green out here.
  path: [[0, 5], [0, 80], [2, 152]],
  fw: [{ at: 0, w: 13 }, { at: 1, w: 12 }],
  belts: { left: { depth: 28, spacing: 7, seed: 601 }, right: { depth: 28, spacing: 7, seed: 602 } },
  // THE ONE GENUINELY FLAT GREEN ON THE PROPERTY, which is what makes the sentence above literal
  // rather than a claim. `bowl` was doing that job and it is hole 12's green; a bowl is not kind,
  // it is a different kind of unkind, because it feeds a good shot away from a pin on the rim.
  // Flat is the only thing on the list that asks nothing of the read, and one of those is right.
  guard: ['leftSand', 'rightSand'],
  greenShape: 'round',
  slope: 'flat',
});

export const HOLE_7 = pv({
  n: 7, par: 5, nickname: 'Long Meadow',
  // THE SECOND SHOT IS THE HOLE, twice over: the creek crosses the corridor at 408 yards - which
  // is exactly where a drive plus a 3 wood comes down - AND the corner turns right in the same
  // place. So going for it means carrying water and bending the ball, and laying up leaves a full
  // wedge from the straight part. Nothing else out here asks both questions with one swing.
  //
  // RE-CUT 2026-09-06. It used to bend right in its first third and straighten out, which put the
  // shape where the drive was and left the interesting shot flat. THE CORNER IS NOW AT 71-92 % OF
  // THE HOLE, and the drive is honest.
  path: [[0, 5], [-4, 120], [2, 250], [6, 365], [28, 428], [52, 478], [66, 522], [70, 552]],
  fw: [{ at: 0, w: 15 }, { at: 0.38, w: 9 }, { at: 0.52, w: 13 }, { at: 0.66, w: 9 }, { at: 0.78, w: 9 }, { at: 1, w: 13 }],
  belts: { left: { depth: 24, spacing: 9, seed: 701 }, right: { depth: 24, spacing: 9, seed: 702 } },
  // THE LAY-UP HAS TO COST SOMETHING TOO, or moving the corner late just hands the hole away: with
  // the drive honest and the second shot free to stop in front of the creek, this measured -0.46 -
  // the easiest hole on the property, on a course whose complaint was that every hole was a birdie.
  // Sand either side of where a lay-up finishes, and the corridor necked to 9 yards through the
  // whole of it, so stopping short is a placement rather than a default.
  bunkers: [
    { at: 0.62, side: -1, off: 14, r: 7, kind: 'fairwayBunker', seed: 703 },
    { at: 0.67, side: 1, off: 13, r: 7, kind: 'fairwayBunker', seed: 704 },
  ],
  // The band used to sit at 222, along with every other cross on the course - a lay-up off the
  // tee, on a hole whose own comment described a creek at 340. It is where the shot with a
  // decision in it actually lands now. See "The back nine, as a SET" in golf/CLAUDE.md.
  cross: [{ yd: 408, kind: 'water', depth: 30 }],
  // END-ON: the same `long` family as hole 5, turned to point straight back down the approach, so
  // this green is DEEP and NARROW where that one is wide and shallow. After a shot that has just
  // carried water and turned a corner, the miss that matters is left and right, not long and short.
  guard: ['frontSand', 'rightSand', 'backSand'],
  greenShape: 'long',
  greenAngle: 0,
  slope: 'saddle',
  greenR: 13,
});

export const HOLE_8 = pv({
  n: 8, par: 4, nickname: 'Short Straw',
  // The shortest par 4 on the property, and the tee shot is a placement rather than a swing: waste
  // sand crosses at 262, so a big drive runs into it and the club that stops short leaves a wedge.
  //
  // RE-CUT 2026-09-06. It was dead straight (6 yards of offset over 293), so the placement was the
  // only thing in it. IT TURNS LEFT LATE now - the corner is at about 200 yards, which is past
  // where the lay-up finishes - so the WEDGE is played round a bend and the drive is not.
  path: [[0, 5], [4, 95], [2, 185], [-16, 232], [-34, 270], [-40, 296]],
  fw: [{ at: 0, w: 13 }, { at: 0.5, w: 9 }, { at: 1, w: 11 }],
  belts: { left: { depth: 22, spacing: 9, seed: 801 }, right: { depth: 26, spacing: 8, seed: 802 } },
  // `over: 3` rather than the default 8: this band sits where the corridor is BENDING, and the
  // faces fan apart at a corner, so the stock reach past the rough put cream sand out in open
  // country beyond the tree belt. A hazard drawn outside the hole is not a hazard, it is a mistake.
  cross: [{ yd: 262, kind: 'waste', depth: 18, over: 3 }],
  // THIS GREEN WAS HOLE 16'S, EXACTLY: round + crown + ringSand, radius 11 against its 10. Two
  // greens on one course that are the same idea at the same size are one green drawn twice, and
  // neither of them was doing anything the other was not. 16 keeps it - the Postage Stamp's whole
  // point is that there is nothing clever about it - and this one becomes a CLOVER that sheds to
  // one side: the lobes are three separate pin areas, and a wedge in the wrong one leaves a putt
  // across a notch rather than a tap-in. On a hole whose defence is a lay-up, the second shot
  // should be where the difficulty is.
  guard: ['ringSand'],
  greenShape: 'clover',
  greenAngle: 30,
  slope: 'leftShed',
  greenR: 12,
});

export const HOLE_9 = pv({
  n: 9, par: 4, nickname: 'Homeward',
  // Doglegs left round a stand of SENTINELS - forty yards tall, so there is no flying the corner
  // with anything in the bag. Take the long way round or take your medicine. The green sheds two
  // ways off a spine down the middle, so the putt depends on which half you finish in.
  path: [[0, 5], [8, 120], [-14, 250], [-34, 330], [-38, 386]],
  fw: [{ at: 0, w: 14 }, { at: 0.45, w: 9 }, { at: 1, w: 12 }],
  belts: { left: { depth: 24, spacing: 9, type: 1, seed: 901 }, right: { depth: 24, spacing: 9, seed: 902 } },
  sentinels: [{ at: 0.52, side: -1, off: 20, n: 6, spread: 9, type: 2 }],
  // A PEANUT TURNED ACROSS THE SHOT. Its waist is what makes the closing hole of the front nine
  // ask a question the other eight do not: the two lobes are effectively two small greens, and an
  // approach that lands between them is on the narrowest part of the surface with a spine running
  // through it. `saddle` was hole 7's slope, two holes earlier and in the same nine.
  guard: ['leftSand', 'backSand'],
  greenShape: 'peanut',
  greenAngle: 140,
  slope: 'spine',
});

export const HOLE_10 = pv({
  n: 10, par: 4, nickname: 'Split Oak',
  // The lone oak in the middle of the fairway, and now a second stand short of the green: a low
  // punch out from under the first one runs straight into the second. Fly them, or go round.
  // An S: right off the tee, then back left into the green. The oak sits on the INSIDE of the
  // first bend, so the line that shortens the hole is the line that brings it into play.
  path: [[0, 5], [2, 105], [26, 180], [16, 262], [-14, 320], [-20, 362]],
  fw: [{ at: 0, w: 18 }, { at: 0.5, w: 12 }, { at: 1, w: 14 }],
  belts: { left: { depth: 22, spacing: 10, seed: 1001 }, right: { depth: 22, spacing: 10, seed: 1002 } },
  trees: [{ at: 0.44, side: 1, off: 2, type: 1 }],
  guard: ['frontTrees', 'rightSand'],
  guardTree: 1,
  greenShape: 'peanut',
  greenAngle: 0,
  slope: 'tier',
});

export const HOLE_11 = pv({
  n: 11, par: 5, nickname: 'The Quarry',
  // An old quarry floor crosses at 300 yards and there is water behind the green, so both the
  // second shot and the third are played to a number rather than as hard as you can. The green
  // itself runs hard from back to front: above the hole is a mistake you cannot putt out of.
  // A DOUBLE dogleg - left off the tee, right off the second - so neither of the first two shots
  // is aimed at the flag and the quarry sits across the middle of it.
  path: [[0, 5], [6, 120], [-26, 215], [-40, 300], [-10, 390], [24, 470], [34, 540]],
  fw: [{ at: 0, w: 19 }, { at: 0.4, w: 13 }, { at: 0.72, w: 10 }, { at: 1, w: 14 }],
  belts: { left: { depth: 22, spacing: 10, seed: 1101 }, right: { depth: 20, spacing: 11, seed: 1102 } },
  cross: [{ yd: 300, kind: 'waste', depth: 30 }],
  guard: ['frontJaws', 'backWater'],
  greenShape: 'long',
  greenAngle: 25,
  slope: 'steep',
});

export const HOLE_12 = pv({
  n: 12, par: 3, nickname: 'Pulpit',
  // All carry, all the way, to a green that sheds in every direction from a plateau in the middle.
  // Hit the plateau or it runs off, and everything it runs into is sand or water.
  path: [[0, 5], [4, 100], [8, 192]],
  fw: [{ at: 0, w: 12 }, { at: 0.6, w: 10 }, { at: 1, w: 14 }],
  belts: { left: { depth: 24, spacing: 9, seed: 1201 }, right: false },
  // The green is a TEARDROP with its point at you: the target narrows the further you try to
  // carry it. The surface itself is a bowl, which is the one mercy on the hole - everything that
  // lands feeds toward the middle, because everything that misses is wet or in sand.
  guard: ['frontWater', 'ringSand'],
  greenShape: 'teardrop',
  greenAngle: 180,
  slope: 'bowl',
  greenR: 14,
});

export const HOLE_13 = pv({
  n: 13, par: 4, nickname: 'Fox Run',
  // Bends right, and a pond crosses the corridor at 240 - which on a 308 yard hole means the drive
  // is a lay-up and the approach is a wedge over water. The green falls a different way in every
  // quarter, so the read changes with the pin.
  // The sharpest corner on the property, and short enough that cutting it is a real temptation:
  // 339 yards with the turn at 200, so the whole hole is how much of the trees you take on.
  path: [[0, 5], [-2, 100], [0, 195], [38, 250], [70, 282], [80, 318]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 10 }, { at: 1, w: 13 }],
  belts: { left: { depth: 26, spacing: 8, seed: 1301 }, right: { depth: 26, spacing: 8, seed: 1302 } },
  cross: [{ yd: 222, kind: 'water', depth: 34 }],
  guard: ['leftSand', 'rightSand'],
  greenShape: 'clover',
  greenAngle: 40,
  slope: 'saddle',
});

export const HOLE_14 = pv({
  n: 14, par: 4, nickname: 'Highwater',
  // RE-CUT 2026-09-06, as the pilot for the routing and green-shape pass. It used to run
  // [[0,5],[-6,130],[-2,260],[4,394]] - 41 degrees of total wiggle but only 15.7 yds of offset from
  // the straight tee-to-pin line over 389 yards, which is to say it wandered and never turned.
  // Matt: *"100 % of yours were completely straight. That's not how any golf course in the world
  // is."*
  //
  // It is a genuine dogleg right now, and the water is on the INSIDE of the elbow, so the corner is
  // a real bid rather than a decoration: take the tight line over the lake and a wedge is left,
  // bail out left and the approach is a long iron to a green turned across the shot.
  // THE BEND IS AT THE LANDING ZONE, not past it. A first attempt turned at 300 yds and measured
  // 40.8 yds of offset from the straight line - which on a hole five times taller than it is wide
  // still rendered as a leaning strip. A dogleg has to make the DRIVE go somewhere the approach
  // does not, so the corner sits where the drive finishes.
  path: [[0, 5], [0, 108], [6, 200], [44, 272], [76, 330], [86, 380]],
  fw: [{ at: 0, w: 17 }, { at: 0.45, w: 11 }, { at: 0.72, w: 10 }, { at: 1, w: 14 }],
  belts: { left: { depth: 26, spacing: 9, seed: 1401 }, right: { depth: 20, spacing: 11, seed: 1402 } },
  // The lake sits in the elbow, which is what makes cutting the corner cost something.
  water: [{ at: 0.62, side: 1, off: 26, rx: 20, ry: 40, seed: 1403 }],
  // LONG AND NARROW, TURNED 55 DEGREES ACROSS THE APPROACH. A ball coming in on the direct line
  // meets the green at its narrowest; the player who took the safe route left is looking down its
  // length. That is the whole trade of the tee shot, paid at the green rather than restated there.
  greenShape: 'long',
  greenAngle: 55,
  greenR: 15,
  guard: ['rightWater', 'frontSand'],
  slope: 'rightShed',
});

export const HOLE_15 = pv({
  n: 15, par: 5, nickname: 'The Marathon',
  // The longest hole on the property. Waste sand crosses at 205, so the tee shot is a lay-up and
  // the hole becomes four honest swings rather than three heroic ones. It carried a SECOND cross
  // at 400 for one build and measured +1.11 with 80 % bogey-or-worse - which is not a hard hole,
  // it is an unfair one, and is exactly what the difficulty probe exists to catch.
  // One long, gentle bend left rather than a corner - the shape a genuinely long hole wants, so
  // that three good swings are rewarded and no single one of them is a gamble.
  path: [[0, 5], [6, 140], [4, 280], [-28, 400], [-56, 500], [-62, 570]],
  fw: [{ at: 0, w: 19 }, { at: 0.35, w: 16 }, { at: 0.65, w: 15 }, { at: 1, w: 17 }],
  belts: { left: { depth: 18, spacing: 12, seed: 1501 }, right: { depth: 18, spacing: 12, seed: 1502 } },
  cross: [{ yd: 400, kind: 'waste', depth: 34 }],
  // The kidney's notch is turned to the BACK, so the front of the green is whole and a running
  // approach works. On the longest hole out here the third shot should be allowed to land.
  guard: ['frontJaws', 'backSand'],
  greenShape: 'kidney',
  greenAngle: 200,
  slope: 'spine',
  // A kidney's notch eats radius, so the SIZE has to be authored back up or the longest hole on the
  // property finishes at a 4.7 yd target. Measured at 16: the green runs 5.4-13.1 yds.
  greenR: 16,
});

export const HOLE_16 = pv({
  n: 16, par: 3, nickname: 'Postage',
  // 135 yards to the smallest green on the course, sand the whole way round it, and a crown in the
  // middle that throws a ball off in whichever direction it arrived from. A wedge and a nerve.
  path: [[0, 5], [-2, 70], [0, 140]],
  fw: [{ at: 0, w: 10 }, { at: 1, w: 9 }],
  belts: { left: { depth: 26, spacing: 8, seed: 1601 }, right: { depth: 26, spacing: 8, seed: 1602 } },
  // Round, and deliberately the only round green on the nine. The Postage Stamp's whole idea is
  // that there is nothing clever about it: it is small, it is ringed in sand, and it crowns.
  guard: ['ringSand'],
  greenShape: 'round',
  slope: 'crown',
  greenR: 10,
});

export const HOLE_17 = pv({
  n: 17, par: 4, nickname: 'Gallery',
  // A double dogleg with SENTINELS on both corners, so the hole genuinely changes direction twice
  // and neither corner can be flown. Trees short of the green as well: the approach has to be
  // carried in high, and after a punch-out it cannot be.
  // It bends LATE - straight for 240 yards and then right - so the drive is easy and the approach
  // is played round a corner. 14 turns where the drive lands and 13 turns before it; this one
  // waits until you have already hit.
  path: [[0, 5], [2, 120], [0, 240], [8, 285], [40, 335], [62, 372]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 11 }, { at: 1, w: 12 }],
  belts: { left: { depth: 30, spacing: 7, seed: 1701 }, right: { depth: 30, spacing: 7, seed: 1702 } },
  // The first 240 yards of this hole were a plain tunnel with one auto-placed bunker in it, which
  // on the contact sheet read as dead ground - the whole hole was its last hundred yards. The
  // drive is now squeezed between two bunkers STAGGERED either side of where it lands (short-left,
  // long-right), so the tee shot is a placement even though the corner is still 100 yards further
  // on. Authored rather than left to the auto-defend, which only ever adds one, on the outside.
  bunkers: [
    { at: 0.5, side: -1, off: 13, r: 7, kind: 'fairwayBunker', seed: 1703 },
    { at: 0.62, side: 1, off: 12, r: 6, kind: 'fairwayBunker', seed: 1704 },
  ],
  // One stand, on the inside of the late corner, where it actually guards something.
  sentinels: [{ at: 0.72, side: 1, off: 21, n: 5, spread: 9, type: 2 }],
  guard: ['frontTrees', 'leftSand'],
  greenShape: 'peanut',
  greenAngle: 70,
  slope: 'quarters',
});

export const HOLE_18 = pv({
  n: 18, par: 4, nickname: 'Home',
  // RE-CUT 2026-09-06, the second hole of the routing pass, and deliberately a DIFFERENT QUESTION
  // from 14's. That one doglegs RIGHT around water sitting in the elbow, to a long green turned
  // across the shot: the tee shot is a bid and the approach collects the bill. This one bends LEFT
  // and asks nothing of the drive except that it stop short of the creek - the whole hole is the
  // second shot, into a kidney green whose notch faces the approach, so the direct line is into the
  // bay and the pin has to be come at from one side or the other.
  //
  // Two doglegs in a row would be a repeat; a dogleg and a lay-up is a pair.
  path: [[0, 5], [4, 110], [2, 200], [-32, 268], [-56, 325], [-62, 372]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 10 }, { at: 1, w: 13 }],
  belts: { left: { depth: 20, spacing: 11, seed: 1801 }, right: { depth: 24, spacing: 9, seed: 1802 } },
  cross: [{ yd: 222, kind: 'water', depth: 34 }],
  water: [{ at: 0.82, side: -1, off: 30, rx: 16, ry: 34, seed: 1803 }],
  // The notch is turned 25 degrees off the approach rather than square to it, so a ball run in from
  // the left still finds turf. Square on, the front of the green is simply missing and the hole
  // stops being a question and starts being a wall.
  greenShape: 'kidney',
  greenAngle: 25,
  guard: ['frontWater', 'ringSand'],
  slope: 'steep',
  greenR: 15,
  greenRy: 14,
  // The cart path follows the hole. It used to run straight up x=34-42 from the days when this hole
  // did too; once the routing bent left it was a stripe of tarmac stranded in open country 90 yards
  // off the fairway. Art that no longer knows where the hole went is worse than no art.
  // ...and it runs OUTSIDE the corridor, on the outside of the bend. The first re-cut followed the
  // centreline, which put a strip of tarmac straight through the creek and the pond.
  decor: [{ kind: 'path', poly: [[31, 20], [34, 20], [35, 190], [23, 268], [3, 330], [-1, 372], [-4, 372], [0, 330], [20, 268], [32, 190]] }],
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
