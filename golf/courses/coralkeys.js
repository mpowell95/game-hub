// golf/courses/coralkeys.js - CORAL KEYS, nine holes of island hopping. The fourth course.
//
// Matt, 2026-09-29: *"Can you create a fun new golf course ... 9 holes and admin only to start."*
// The first cut (Coral Cove) was a tropical repaint of the same corridor-in-woods and he said so:
// *"it looks identical to Pine Valley ... I want something that's totally different. Something
// that looks new and is a new experience."* He picked island hopping.
//
// So THE OCEAN IS THE GROUND (`base: 'water'`). Every piece of land is an island ringed with a
// sand beach (`beach`, which plays as a fairway bunker), cross bands of sea cut the playing line
// into separate islands, and `islands` puts extra land out in the water - bail-outs and shortcuts.
// Every shot is a carry to a target; there is no rough to scramble along and no tree line to lean
// on. Both mechanisms are holegen.js additions that change nothing for a hole that does not use
// them. Admin only is `COURSE_ADMIN_ONLY_BY_DEFAULT` in golf/js/progress.js.
//
// Yards throughout. x across the hole (right positive), y up it away from the tee.

import { makeHole } from '../js/holegen.js';
import { OBSTACLE_CATALOG as TREE_TYPES, OBSTACLE_INDEX as T } from '../js/obstacles.js';

/** Every hole: open ocean, a 5 yd beach, a thin collar of rough, no tree belts, no auto-bunkers.
 *
 *  AND A SEA BREEZE ON EVERY HOLE (2026-09-29). Matt: *"Add wind though."* Left to the seeded
 *  derivation (shot.js `windFor`) this course drew THREE dead-calm holes and the lowest average
 *  wind in the game (0.83, against Pine Valley 1.11 and Oasis Sands 1.39). Each hole now states
 *  its own: never calm, 1.2 to 2.0 on the game's unchanged 0-2 scale, average 1.6, turning with
 *  the holes. `deg` 0 blows toward the green, 90 left to right, 180 into your face. */
export const CK_DEFAULTS = {
  treeTypes: TREE_TYPES,
  base: 'water',
  beach: 5,
  rough: 4,
  belts: false,
  defend: false,
};
const ck = (spec) => makeHole({ ...CK_DEFAULTS, ...spec });

// H1  Castaway  Par 4. Tee island, a big fairway island, then a short carry to the green.
export const SPEC_1 = {
  n: 1,
  par: 4,
  nickname: 'Castaway',
  path: [[0, 5], [0, 170], [8, 336]],
  fw: 22,
  wind: { speed: 1.2, deg: 45 },
  hard: 0,
  seed: 6101,
  greenSeed: 61013,
  greenShape: 'kidney',
  greenAngle: 60,
  slope: 'gentle',
  cross: [{ yd: 58, depth: 44 }, { yd: 262, depth: 34 }],
  trees: [
    { yd: 130, side: -1, off: 27, type: T.coconut },
    { yd: 205, side: 1, off: 27, type: T.coconut },
  ],
};
export const HOLE_1 = ck(SPEC_1);

// H2  Sandbar  Par 4. Dogleg right round open water. A small island on the right is the shortcut.
export const SPEC_2 = {
  n: 2,
  par: 4,
  nickname: 'Sandbar',
  path: [[0, 5], [-8, 175], [18, 300], [48, 368]],
  fw: 20,
  wind: { speed: 1.5, deg: 270 },
  hard: 0.12,
  seed: 6201,
  greenSeed: 62027,
  slope: 'crown',
  cross: [{ yd: 70, depth: 50 }, { yd: 292, depth: 26 }],
  islands: [{ yd: 230, side: 1, off: 52, rx: 13, ry: 16 }],
  guard: ['backSand'],
  trees: [
    { yd: 150, side: -1, off: 25, type: T.fanpalm },
    { yd: 230, side: 1, off: 57, type: T.coconut },
  ],
};
export const HOLE_2 = ck(SPEC_2);

// H3  Lagoon  Par 3. All carry to an island green, with a bail-out islet short and left.
export const SPEC_3 = {
  n: 3,
  par: 3,
  nickname: 'Lagoon',
  path: [[0, 5], [0, 70], [-4, 142]],
  fw: 12,
  wind: { speed: 1.4, deg: 180 },
  hard: 0.22,
  seed: 6301,
  greenSeed: 63031,
  greenR: 15,
  slope: 'bowl',
  cross: [{ yd: 72, depth: 96 }],
  islands: [{ yd: 92, side: -1, off: 34, rx: 9, ry: 8 }],
  guard: ['rightSand'],
};
export const HOLE_3 = ck(SPEC_3);

// H4  Stepping Stones  Par 5. Four islands in a row; each shot is a hop to the next one.
export const SPEC_4 = {
  n: 4,
  par: 5,
  nickname: 'Stepping Stones',
  path: [[0, 5], [6, 160], [-6, 330], [4, 488]],
  fw: 20,
  wind: { speed: 1.6, deg: 90 },
  hard: 0.35,
  seed: 6401,
  greenSeed: 64049,
  greenShape: 'peanut',
  greenAngle: 90,
  slope: 'tier',
  cross: [{ yd: 58, depth: 42 }, { yd: 250, depth: 38 }, { yd: 402, depth: 34 }],
  trees: [
    { yd: 140, side: 1, off: 25, type: T.coconut },
    { yd: 320, side: -1, off: 25, type: T.coconut },
    { yd: 330, side: 1, off: 24, type: T.fanpalm },
  ],
};
export const HOLE_4 = ck(SPEC_4);

// H5  Coconut Island  Par 3. A long carry to a green with palms on its island.
export const SPEC_5 = {
  n: 5,
  par: 3,
  nickname: 'Coconut Island',
  path: [[0, 5], [2, 90], [6, 168]],
  fw: 12,
  wind: { speed: 1.8, deg: 225 },
  hard: 0.45,
  seed: 6501,
  greenSeed: 65061,
  greenShape: 'teardrop',
  slope: 'saddle',
  cross: [{ yd: 88, depth: 130 }],
  guard: ['leftSand'],
  trees: [
    { yd: 176, side: 1, off: 22, type: T.coconut },
    { yd: 186, side: -1, off: 20, type: T.coconut },
  ],
};
export const HOLE_5 = ck(SPEC_5);

// H6  Shipwreck  Par 4. A lagoon splits the fairway island in two, with wreckage in it. Left or
// right, and the green sits across another channel.
export const SPEC_6 = {
  n: 6,
  par: 4,
  nickname: 'Shipwreck',
  path: [[0, 5], [0, 180], [-10, 372]],
  fw: 26,
  wind: { speed: 1.3, deg: 135 },
  hard: 0.55,
  seed: 6601,
  greenSeed: 66081,
  slope: 'spine',
  cross: [{ yd: 62, depth: 46 }, { yd: 300, depth: 32 }],
  water: [{ yd: 205, side: 0, off: 0, rx: 10, ry: 40, seed: 6611 }],
  trees: [
    { yd: 200, side: 1, off: 1, type: T.rockpile },
    { yd: 222, side: -1, off: 2, type: T.boulder },
  ],
  guard: ['frontJaws'],
};
export const HOLE_6 = ck(SPEC_6);

// H7  Reef Run  Par 4. The long carry: 150 yds of reef off the tee, then a channel before the green.
export const SPEC_7 = {
  n: 7,
  par: 4,
  nickname: 'Reef Run',
  path: [[0, 5], [8, 200], [0, 392]],
  fw: 22,
  wind: { speed: 2.0, deg: 180 },
  hard: 0.7,
  seed: 6701,
  greenSeed: 67089,
  greenR: 13,
  slope: 'quarters',
  cross: [{ yd: 92, depth: 104 }, { yd: 322, depth: 30 }],
  islands: [{ yd: 110, side: -1, off: 40, rx: 11, ry: 11, fairway: false }],
  guard: ['backSand', 'rightSand'],
  trees: [{ yd: 110, side: -1, off: 40, type: T.coconut }],
};
export const HOLE_7 = ck(SPEC_7);

// H8  Shark Bite  Par 3. A small green, alone in the sea.
export const SPEC_8 = {
  n: 8,
  par: 3,
  nickname: 'Shark Bite',
  path: [[0, 5], [0, 80], [0, 152]],
  fw: 11,
  wind: { speed: 1.7, deg: 270 },
  hard: 0.85,
  seed: 6801,
  greenSeed: 68111,
  greenR: 12,
  slope: 'crown',
  beach: 3,
  cross: [{ yd: 78, depth: 128 }],
};
export const HOLE_8 = ck(SPEC_8);

// H9  Treasure Cove  Par 5. Bends left round the cove, three islands, and a green on its own.
export const SPEC_9 = {
  n: 9,
  par: 5,
  nickname: 'Treasure Cove',
  path: [[0, 5], [6, 200], [-18, 360], [-54, 500]],
  fw: 20,
  wind: { speed: 1.9, deg: 315 },
  hard: 1,
  seed: 6901,
  greenSeed: 69123,
  greenShape: 'kidney',
  greenAngle: 270,
  slope: 'steep',
  cross: [{ yd: 64, depth: 48 }, { yd: 288, depth: 44 }, { yd: 452, depth: 40 }],
  islands: [{ yd: 300, side: 1, off: 50, rx: 14, ry: 14 }],
  guard: ['backSand'],
  trees: [
    { yd: 180, side: -1, off: 25, type: T.coconut },
    { yd: 300, side: 1, off: 50, type: T.coconut },
    { yd: 380, side: 1, off: 24, type: T.fanpalm },
  ],
};
export const HOLE_9 = ck(SPEC_9);

/** THE RECIPES, in slot order. Each SPEC_n is exactly the object HOLE_n is built from. */
export const SPECS = [SPEC_1, SPEC_2, SPEC_3, SPEC_4, SPEC_5, SPEC_6, SPEC_7, SPEC_8, SPEC_9];

export const HOLES = [HOLE_1, HOLE_2, HOLE_3, HOLE_4, HOLE_5, HOLE_6, HOLE_7, HOLE_8, HOLE_9];

export const CORAL_KEYS = {
  id: 'coralkeys',
  name: 'Coral Keys',
  theme: 'tropical',
  blurbKey: 'blurb_coralkeys',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 35
};

export default CORAL_KEYS;
