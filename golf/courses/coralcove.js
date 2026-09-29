// golf/courses/coralcove.js - CORAL COVE, nine holes on a tropical island. The fourth course, and
// the first on the Tropical look (render.js THEMES.tropical).
//
// Matt, 2026-09-29: *"Can you create a fun new golf course for our golf game? 9 holes and admin
// only to start."* Admin only is `COURSE_ADMIN_ONLY_BY_DEFAULT` in golf/js/progress.js, not
// anything in this file.
//
// What makes it play differently from the other three, in things the engine can actually express:
//
//  - AN ISLAND GREEN (hole 8, the `island` guard): the only way on is through the air.
//  - A VOLCANO (hole 4): lava-rock piles are `rockpile`, solid to every club at any height, so the
//    rocks are gone around, never over - and a creek crosses short of the green to make the second
//    shot a real decision.
//  - A MANGROVE SWAMP (hole 6): a `swamp` cross band, which plays as a surface you hit OUT of
//    rather than a penalty (clubs.js LIES.swamp) - a different kind of trouble from water.
//  - A DRIVABLE-LOOKING PAR 4 (hole 7) with a waste band across it and sand all round the green.
//  - A LAGOON FINISH (hole 9): a par 5 bending round water, with water in front of the green.
//
// Built entirely with `makeHole()` (golf/js/holegen.js). The obstacle table is the shared
// catalogue (golf/js/obstacles.js), whose ORDER IS FROZEN; every type below is looked up by NAME
// through OBSTACLE_INDEX, so no hand-counted index can drift. Same shape as a Course Creator
// export, so the hole editor could open it later.
//
// Yards throughout. x across the hole (right positive), y up it away from the tee.

import { makeHole } from '../js/holegen.js';
import { OBSTACLE_CATALOG as TREE_TYPES, OBSTACLE_INDEX as T } from '../js/obstacles.js';

/** Course-level defaults every recipe below is laid on top of: palms both sides. */
export const CC_DEFAULTS = {
  treeTypes: TREE_TYPES,
  belts: {
    left: { depth: 20, spacing: 14, type: T.palm },
    right: { depth: 20, spacing: 14, type: T.palm },
  },
};
const cc = (spec) => makeHole({ ...CC_DEFAULTS, ...spec });

// H1  Welcome Wave  Par 4. A gentle opener, bending right past the lagoon.
export const SPEC_1 = {
  n: 1,
  par: 4,
  nickname: 'Welcome Wave',
  path: [[0, 5], [4, 170], [14, 342]],
  fw: [{ at: 0, w: 19 }, { at: 0.5, w: 18 }, { at: 1, w: 15 }],
  hard: 0,
  seed: 4101,
  greenSeed: 51013,
  greenShape: 'kidney',
  greenAngle: 60,
  slope: 'gentle',
  guard: ['leftSand'],
  water: [{ yd: 205, side: 1, off: 34, rx: 14, ry: 26, seed: 4111 }],
  trees: [
    { yd: 120, side: -1, off: 30, type: T.frangipani },
    { yd: 280, side: -1, off: 28, type: T.frangipani },
  ],
  belts: {
    left: { depth: 20, spacing: 15, type: T.coconut, seed: 4121 },
    right: { depth: 16, spacing: 16, type: T.fanpalm, seed: 4122 },
  },
};
export const HOLE_1 = cc(SPEC_1);

// H2  Coconut Alley  Par 4. Straight and tight: coconut palms both sides, sand in the drive zone.
export const SPEC_2 = {
  n: 2,
  par: 4,
  nickname: 'Coconut Alley',
  path: [[0, 5], [-2, 190], [0, 372]],
  fw: [{ at: 0, w: 16 }, { at: 0.55, w: 13 }, { at: 1, w: 14 }],
  rough: 9,
  hard: 0.12,
  seed: 4201,
  greenSeed: 52027,
  greenShape: 'long',
  greenAngle: 0,
  slope: 'crown',
  guard: ['frontJaws'],
  bunkers: [{ yd: 212, side: -1, off: 15, r: 7, kind: 'fairwayBunker' }],
  belts: {
    left: { depth: 20, spacing: 12, type: T.coconut, seed: 4221 },
    right: { depth: 20, spacing: 12, type: T.coconut, seed: 4222 },
  },
};
export const HOLE_2 = cc(SPEC_2);

// H3  Tiki Hut  Par 3. A short iron to a round green with sand either side.
export const SPEC_3 = {
  n: 3,
  par: 3,
  nickname: 'Tiki Hut',
  path: [[0, 5], [0, 75], [3, 142]],
  fw: [{ at: 0, w: 11 }, { at: 1, w: 12 }],
  hard: 0.2,
  seed: 4301,
  greenSeed: 53021,
  slope: 'bowl',
  guard: ['leftSand', 'rightSand'],
  trees: [
    { yd: 60, side: 1, off: 22, type: T.banana },
    { yd: 95, side: -1, off: 22, type: T.birdofparadise },
  ],
  belts: {
    left: { depth: 18, spacing: 14, type: T.fanpalm, seed: 4321 },
    right: { depth: 18, spacing: 14, type: T.banana, seed: 4322 },
  },
};
export const HOLE_3 = cc(SPEC_3);

// H4  Volcano  Par 5. Double bend between lava rocks; a creek crosses short of the green, so the
// second shot is carry-it or lay-up.
export const SPEC_4 = {
  n: 4,
  par: 5,
  nickname: 'Volcano',
  path: [[0, 5], [-10, 200], [12, 360], [4, 512]],
  fw: [{ at: 0, w: 18 }, { at: 0.5, w: 15 }, { at: 1, w: 14 }],
  hard: 0.35,
  seed: 4401,
  greenSeed: 54049,
  greenShape: 'peanut',
  greenAngle: 90,
  slope: 'tier',
  guard: ['backSand'],
  cross: [{ yd: 440, kind: 'water', depth: 20 }],
  trees: [
    { yd: 150, side: 1, off: 26, type: T.rockpile },
    { yd: 245, side: -1, off: 27, type: T.rockpile },
    { yd: 300, side: 1, off: 28, type: T.boulder },
    { yd: 380, side: -1, off: 26, type: T.rockpile },
  ],
  // Lava fields: clusters of rock off both shoulders.
  sentinels: [
    { yd: 190, side: -1, off: 30, n: 4, spread: 6, type: T.smallrock },
    { yd: 275, side: 1, off: 30, n: 4, spread: 6, type: T.smallrock },
    { yd: 350, side: -1, off: 30, n: 3, spread: 6, type: T.boulder },
  ],
  belts: {
    left: { depth: 20, spacing: 15, type: T.palm, seed: 4421 },
    right: { depth: 20, spacing: 15, type: T.palm, seed: 4422 },
  },
};
export const HOLE_4 = cc(SPEC_4);

// H5  Hammock  Par 3. Banyans crowd the right shoulder, so a right pin is not attackable.
export const SPEC_5 = {
  n: 5,
  par: 3,
  nickname: 'Hammock',
  path: [[0, 5], [-2, 85], [-5, 168]],
  fw: [{ at: 0, w: 11 }, { at: 1, w: 12 }],
  hard: 0.45,
  seed: 4501,
  greenSeed: 55061,
  greenShape: 'teardrop',
  greenAngle: 0,
  slope: 'saddle',
  guard: ['rightTrees', 'leftSand', 'backSand'],
  guardTree: T.banyan,
  belts: {
    left: { depth: 18, spacing: 15, type: T.jacaranda, seed: 4521 },
    right: { depth: 18, spacing: 14, type: T.banyan, seed: 4522 },
  },
};
export const HOLE_5 = cc(SPEC_5);

// H6  Mangrove Maze  Par 4. Dogleg left through the mangroves; a swamp crosses where a big drive
// finishes, so the tee shot is how far, not just which way.
export const SPEC_6 = {
  n: 6,
  par: 4,
  nickname: 'Mangrove Maze',
  path: [[0, 5], [4, 150], [-14, 280], [-40, 390]],
  fw: [{ at: 0, w: 17 }, { at: 0.5, w: 14 }, { at: 1, w: 14 }],
  hard: 0.55,
  seed: 4601,
  greenSeed: 56081,
  slope: 'spine',
  guard: ['rightSand'],
  cross: [{ yd: 238, kind: 'swamp', depth: 22 }],
  trees: [
    { yd: 175, side: -1, off: 20, type: T.mangrove },
    { yd: 320, side: 1, off: 20, type: T.mangrove },
  ],
  belts: {
    left: { depth: 22, spacing: 12, type: T.mangrove, seed: 4621 },
    right: { depth: 20, spacing: 13, type: T.mangrove, seed: 4622 },
  },
};
export const HOLE_6 = cc(SPEC_6);

// H7  Tiki Torch  Par 4. Short, but a waste band sits exactly where a driver lands and the green
// is ringed with sand: lay up and wedge on, or take it on.
export const SPEC_7 = {
  n: 7,
  par: 4,
  nickname: 'Tiki Torch',
  path: [[0, 5], [6, 160], [0, 318]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 13 }, { at: 1, w: 12 }],
  hard: 0.7,
  seed: 4701,
  greenSeed: 57089,
  greenR: 11,
  slope: 'quarters',
  guard: ['ringSand'],
  cross: [{ yd: 205, kind: 'waste', depth: 26 }],
  belts: {
    left: { depth: 20, spacing: 13, type: T.bamboo, seed: 4721 },
    right: { depth: 20, spacing: 13, type: T.coconut, seed: 4722 },
  },
};
export const HOLE_7 = cc(SPEC_7);

// H8  Shark Bite  Par 3. The island green. Water all the way round; the only way on is through
// the air.
export const SPEC_8 = {
  n: 8,
  par: 3,
  nickname: 'Shark Bite',
  path: [[0, 5], [0, 80], [0, 152]],
  fw: [{ at: 0, w: 11 }, { at: 1, w: 10 }],
  hard: 0.85,
  seed: 4801,
  greenSeed: 58111,
  greenR: 14,
  slope: 'crown',
  guard: ['island'],
  belts: {
    left: { depth: 18, spacing: 15, type: T.palm, seed: 4821 },
    right: { depth: 18, spacing: 15, type: T.palm, seed: 4822 },
  },
};
export const HOLE_8 = cc(SPEC_8);

// H9  Sunset Lagoon  Par 5. Bends right round the lagoon, and the lagoon comes back in front of
// the green: go for it in two over the water, or lay up and pitch.
export const SPEC_9 = {
  n: 9,
  par: 5,
  nickname: 'Sunset Lagoon',
  path: [[0, 5], [-6, 210], [14, 380], [40, 506]],
  fw: [{ at: 0, w: 18 }, { at: 0.5, w: 15 }, { at: 1, w: 13 }],
  hard: 1,
  seed: 4901,
  greenSeed: 59123,
  greenShape: 'kidney',
  greenAngle: 270,
  slope: 'steep',
  guard: ['frontWater', 'backSand'],
  water: [{ yd: 300, side: 1, off: 38, rx: 18, ry: 40, seed: 4911 }],
  trees: [
    { yd: 140, side: -1, off: 26, type: T.coconut },
    { yd: 250, side: -1, off: 26, type: T.coconut },
  ],
  belts: {
    left: { depth: 22, spacing: 13, type: T.coconut, seed: 4921 },
    right: { depth: 16, spacing: 16, type: T.fanpalm, seed: 4922 },
  },
};
export const HOLE_9 = cc(SPEC_9);

/** THE RECIPES, in slot order. Each SPEC_n is exactly the object HOLE_n is built from. */
export const SPECS = [SPEC_1, SPEC_2, SPEC_3, SPEC_4, SPEC_5, SPEC_6, SPEC_7, SPEC_8, SPEC_9];

export const HOLES = [HOLE_1, HOLE_2, HOLE_3, HOLE_4, HOLE_5, HOLE_6, HOLE_7, HOLE_8, HOLE_9];

export const CORAL_COVE = {
  id: 'coralcove',
  name: 'Coral Cove',
  theme: 'tropical',
  blurbKey: 'blurb_coralcove',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 35
};

export default CORAL_COVE;
