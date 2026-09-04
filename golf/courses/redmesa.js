// golf/courses/redmesa.js - RED MESA, eighteen holes of high desert. The second course, and
// deliberately nothing like the first.
//
// Pine Valley is a wooded parkland course: green from edge to edge, corridors walled with pines,
// water as the recurring hazard. Red Mesa is its opposite in every axis that the engine can
// actually express, which is the whole point of building a second course rather than eighteen
// more of the same:
//
//  - THE GROUND IS THE HAZARD. `base` is the desert floor, and the turf is a narrow irrigated
//    ribbon laid on top of it. On Pine Valley the fairway sits inside rough inside woods; here the
//    fairway simply STOPS and there is red dirt and rock. Missing by ten yards is a different kind
//    of miss.
//  - THE OBSTACLES ARE NOT TREES. A saguaro is a pillar - you cannot fly it with anything and it
//    is barely wider than its own trunk, so it is gone around or hit. A palo verde is low and wide:
//    trivial to fly, awkward to walk out from under. A BOULDER blocks at any height at all. That is
//    three genuinely different obstacle behaviours out of the same `{trunk, canopy, height}` triple
//    the pines already used, with no engine change.
//  - IT IS SHORTER AND TIGHTER. Par 71 over ~6,200 yards against Pine Valley's 72 over ~6,500, but
//    the corridors are narrower and there is far less rough between the turf and trouble.
//
// Built entirely with `makeHole()` (golf/js/holegen.js) from design specs; every hole passes
// validateHole() and golf/js/test.js plays all eighteen out with clean strikes.
//
// Yards throughout. x across the hole (right positive), y up it away from the tee.

import { makeHole } from '../js/holegen.js';

/** Red Mesa's obstacle table. All three are `trees` to the engine, and all three behave
 *  differently, which is the point of the {trunk, canopy, height} triple.
 *
 *  A saguaro CANNOT BE FLOWN: its canopy stops at 15 yards and nothing in the bag peaks under that
 *  from any meaningful distance, so in practice it only ever blocks with its trunk - a narrow
 *  pillar to go round. A palo verde is the reverse: 8 yards tall and 6.5 wide, so any wedge clears
 *  it and a long iron never will. A boulder's canopy equals its trunk at 30 yards of height, which
 *  is this engine's way of saying "solid": it blocks at any height, from any club.
 */
const DESERT_TYPES = [
  { name: 'saguaro', trunk: 0.9, canopy: 1.8, height: 15 },
  { name: 'paloverde', trunk: 0.7, canopy: 6.5, height: 8 },
  { name: 'boulder', trunk: 3.2, canopy: 3.2, height: 30 },
];

/** Red Mesa's house style: sparse scrub both sides, saguaros by default, and a narrower collar of
 *  rough than Pine Valley's - the desert starts sooner here. */
const rm = (spec) => makeHole({
  treeTypes: DESERT_TYPES,
  rough: 7,
  belts: { left: { depth: 20, spacing: 14 }, right: { depth: 20, spacing: 14 } },
  ...spec,
});

export const HOLE_1 = rm({
  n: 1, par: 4, nickname: 'Sunrise Wash',
  // A generous opener, and the only wide fairway on the front nine. A dry wash cuts across it at
  // driving distance: carry it or lay back, and the lay-back leaves a full 5 iron.
  path: [[0, 5], [4, 130], [-4, 250], [2, 356]],
  fw: [{ at: 0, w: 19 }, { at: 0.5, w: 16 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 15, seed: 2101 }, right: { depth: 22, spacing: 15, seed: 2102 } },
  bunkers: [
    { at: 0.47, side: 0, off: 0, r: 20, ry: 6, kind: 'fairwayBunker', seed: 2103 },
    { at: 0.97, side: 1, off: 19, r: 6 },
  ],
  slope: { fall: [0.04, -0.14] },
});

export const HOLE_2 = rm({
  n: 2, par: 4, nickname: 'Coyote Bend',
  // Dogleg left around a boulder field. The boulders block at ANY height, so there is no flying
  // the corner: the only question is how much of it you dare cut on the ground.
  path: [[0, 5], [4, 110], [-24, 230], [-52, 320], [-58, 382]],
  fw: [{ at: 0, w: 16 }, { at: 0.45, w: 12 }, { at: 1, w: 14 }],
  belts: { left: { depth: 18, spacing: 16, type: 2, seed: 2201 }, right: { depth: 22, spacing: 14, seed: 2202 } },
  trees: [{ at: 0.44, side: -1, off: 12, type: 2 }, { at: 0.5, side: -1, off: 15, type: 2 }],
  bunkers: [
    { at: 0.52, side: 1, off: 15, r: 7, kind: 'fairwayBunker' },
    { at: 0.96, side: -1, off: 18, r: 6 },
  ],
  slope: { fall: [-0.06, -0.16] },
});

export const HOLE_3 = rm({
  n: 3, par: 3, nickname: 'Ocotillo',
  // Over a rocky gully to a green that is wide and shallow: the miss is long or short, never side
  // to side, and long is the desert.
  path: [[0, 5], [-2, 90], [0, 166]],
  fw: [{ at: 0, w: 12 }, { at: 0.5, w: 9 }, { at: 1, w: 13 }],
  greenR: 18, greenRy: 10,
  belts: { left: { depth: 20, spacing: 13, seed: 2301 }, right: { depth: 20, spacing: 13, seed: 2302 } },
  bunkers: [
    { at: 0.78, side: 0, off: 0, r: 16, ry: 6, kind: 'greensideBunker', seed: 2303 },
    { at: 1, side: 1, off: 22, r: 6 },
  ],
  slope: { fall: [0, -0.3], spine: 0.09, back: 0.12 },
});

export const HOLE_4 = rm({
  n: 4, par: 5, nickname: 'The Long Arroyo',
  // A sand arroyo runs the entire right side from the tee to the green. It is a fairway bunker,
  // not a penalty, so it is playable - but 88 % power and half the accuracy band for three
  // straight shots is its own punishment.
  path: [[0, 5], [-6, 140], [6, 300], [-2, 420], [4, 512]],
  fw: [{ at: 0, w: 17 }, { at: 0.45, w: 13 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 14, seed: 2401 }, right: false },
  bunkers: [
    { at: 0.3, side: 1, off: 22, r: 12, ry: 34, kind: 'fairwayBunker', seed: 2402 },
    { at: 0.62, side: 1, off: 22, r: 12, ry: 34, kind: 'fairwayBunker', seed: 2403 },
    { at: 0.98, side: -1, off: 19, r: 6 },
  ],
  slope: { fall: [0.05, -0.13] },
});

export const HOLE_5 = rm({
  n: 5, par: 4, nickname: 'Cactus Alley',
  // The narrowest hole on the property: 9 yards of turf between two stands of saguaro. They cannot
  // be flown - the canopy stops at 15 yards and nothing peaks under that - so this is a driving
  // test with no way out but straight.
  path: [[0, 5], [2, 120], [-2, 240], [0, 334]],
  fw: [{ at: 0, w: 13 }, { at: 0.4, w: 9 }, { at: 0.8, w: 9 }, { at: 1, w: 13 }],
  belts: { left: { depth: 24, spacing: 10, seed: 2501 }, right: { depth: 24, spacing: 10, seed: 2502 } },
  bunkers: [{ at: 0.97, side: 1, off: 18, r: 6 }, { at: 0.93, side: -1, off: 17, r: 5 }],
  slope: { fall: [0.03, -0.18] },
});

export const HOLE_6 = rm({
  n: 6, par: 3, nickname: 'Kiln',
  // 142 yards, and the green is an island of turf in a sea of sand. There is no rough at all: you
  // are on it, or you are in a bunker.
  path: [[0, 5], [0, 74], [2, 144]],
  fw: [{ at: 0, w: 9 }, { at: 1, w: 8 }],
  rough: 4,
  greenR: 12,
  belts: false,
  bunkers: [
    { at: 0.98, side: -1, off: 17, r: 8, seed: 2601 },
    { at: 0.98, side: 1, off: 17, r: 8, seed: 2602 },
    { at: 0.88, side: 0, off: 0, r: 9, ry: 5, seed: 2603 },
    { at: 1, side: 0, off: 24, r: 8, ry: 5, seed: 2604 },
  ],
  slope: { fall: [-0.05, -0.34], spine: 0.1, back: 0.14 },
});

export const HOLE_7 = rm({
  n: 7, par: 4, nickname: 'Mesa Rim',
  // The fairway sits on a shelf with desert falling away on both sides and a pool hard against the
  // green's left. The tee shot is comfortable; the approach is not.
  path: [[0, 5], [8, 130], [16, 250], [12, 384]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 12 }, { at: 1, w: 12 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2701 }, right: { depth: 20, spacing: 15, type: 1, seed: 2702 } },
  water: [{ at: 0.97, side: -1, off: 28, rx: 14, ry: 26, seed: 2703 }],
  bunkers: [{ at: 0.98, side: 1, off: 19, r: 7 }],
  slope: { fall: [-0.07, -0.15] },
});

export const HOLE_8 = rm({
  n: 8, par: 5, nickname: 'Thunder Valley',
  // A double dogleg with a waste area on the outside of each bend, so both drives are aimed at
  // sand. Reachable in two by anyone who takes both corners on.
  path: [[0, 5], [16, 150], [-10, 300], [10, 430], [22, 530]],
  fw: [{ at: 0, w: 17 }, { at: 0.35, w: 12 }, { at: 0.7, w: 12 }, { at: 1, w: 16 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2801 }, right: { depth: 20, spacing: 15, seed: 2802 } },
  bunkers: [
    { at: 0.32, side: 1, off: 18, r: 11, ry: 7, kind: 'fairwayBunker', seed: 2803 },
    { at: 0.66, side: -1, off: 18, r: 11, ry: 7, kind: 'fairwayBunker', seed: 2804 },
    { at: 0.98, side: 1, off: 19, r: 6 },
  ],
  slope: { fall: [0.04, -0.12] },
});

export const HOLE_9 = rm({
  n: 9, par: 4, nickname: 'Adobe',
  // Straight and honest until the last forty yards, where a chain of bunkers crosses the front of
  // the green. There is no running one in here.
  path: [[0, 5], [-6, 120], [4, 250], [-2, 362]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 13 }, { at: 1, w: 13 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2901 }, right: { depth: 20, spacing: 15, seed: 2902 } },
  bunkers: [
    { at: 0.9, side: 0, off: -12, r: 8, ry: 5, seed: 2903 },
    { at: 0.9, side: 0, off: 8, r: 8, ry: 5, seed: 2904 },
    { at: 0.99, side: 1, off: 20, r: 6 },
  ],
  slope: { fall: [0.02, -0.2], back: 0.11 },
});

export const HOLE_10 = rm({
  n: 10, par: 4, nickname: 'Rattler',
  // It bends right, then left, then right again, and the fairway is never more than 12 yards wide
  // once you are past the tee. Position, not distance.
  path: [[0, 5], [18, 110], [-8, 200], [18, 280], [8, 340]],
  fw: [{ at: 0, w: 15 }, { at: 0.3, w: 11 }, { at: 0.7, w: 11 }, { at: 1, w: 13 }],
  belts: { left: { depth: 18, spacing: 13, seed: 3001 }, right: { depth: 18, spacing: 13, seed: 3002 } },
  bunkers: [
    { at: 0.5, side: 1, off: 14, r: 6, kind: 'fairwayBunker' },
    { at: 0.97, side: -1, off: 18, r: 6 },
  ],
  slope: { fall: [-0.05, -0.17] },
});

export const HOLE_11 = rm({
  n: 11, par: 3, nickname: 'High Noon',
  // The long one: 176 yards, all of it over water, to a green with sand behind. Everything about
  // it says take one more club, and one more club is the back bunker.
  path: [[0, 5], [0, 92], [-4, 176]],
  fw: [{ at: 0, w: 10 }, { at: 0.55, w: 8 }, { at: 1, w: 13 }],
  greenR: 14, greenRy: 13,
  belts: { left: false, right: { depth: 18, spacing: 14, seed: 3102 } },
  water: [{ at: 0.5, side: 0, off: 0, rx: 34, ry: 46, seed: 3103, n: 14 }],
  bunkers: [{ at: 1, side: 0, off: 22, r: 9, ry: 6, seed: 3104 }],
  slope: { fall: [0.05, -0.24], back: 0.12 },
});

export const HOLE_12 = rm({
  n: 12, par: 4, nickname: 'Painted Hills',
  // Boulders stand in the middle of the fairway at driving distance. They block at any height, so
  // the tee shot is a decision rather than a swing: short of them, or through the gap.
  path: [[0, 5], [-4, 120], [8, 250], [2, 378]],
  fw: [{ at: 0, w: 18 }, { at: 0.5, w: 17 }, { at: 1, w: 14 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3201 }, right: { depth: 20, spacing: 15, seed: 3202 } },
  trees: [
    { at: 0.5, side: -1, off: 6, type: 2 },
    { at: 0.53, side: 1, off: 9, type: 2 },
    { at: 0.58, side: -1, off: 11, type: 2 },
  ],
  bunkers: [{ at: 0.97, side: 1, off: 19, r: 7 }],
  slope: { fall: [0.03, -0.15] },
});

export const HOLE_13 = rm({
  n: 13, par: 5, nickname: 'The Gorge',
  // Three shots for most, and the third is over water to a shallow green. The lay-up zone is
  // pinched by sand on both sides, so there is no comfortable place to leave it.
  path: [[0, 5], [10, 150], [-6, 300], [4, 420], [-2, 524]],
  fw: [{ at: 0, w: 17 }, { at: 0.5, w: 13 }, { at: 0.8, w: 10 }, { at: 1, w: 15 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3301 }, right: { depth: 20, spacing: 15, seed: 3302 } },
  water: [{ at: 0.88, side: 0, off: 0, rx: 26, ry: 12, seed: 3303, n: 14 }],
  bunkers: [
    { at: 0.74, side: 1, off: 15, r: 7, kind: 'fairwayBunker' },
    { at: 0.78, side: -1, off: 15, r: 7, kind: 'fairwayBunker' },
    { at: 1, side: 1, off: 21, r: 6 },
  ],
  greenR: 16, greenRy: 11,
  slope: { fall: [0, -0.22], spine: 0.07, back: 0.1 },
});

export const HOLE_14 = rm({
  n: 14, par: 4, nickname: 'Roadrunner',
  // 306 yards. A driver reaches, and everything around the green is sand: four bunkers, no rough,
  // and a green that falls away at the back.
  path: [[0, 5], [-8, 110], [-4, 210], [-10, 306]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 11 }, { at: 1, w: 12 }],
  belts: { left: { depth: 20, spacing: 13, seed: 3401 }, right: { depth: 20, spacing: 13, seed: 3402 } },
  bunkers: [
    { at: 0.96, side: -1, off: 18, r: 7, seed: 3403 },
    { at: 0.96, side: 1, off: 18, r: 7, seed: 3404 },
    { at: 0.86, side: 0, off: 0, r: 9, ry: 5, seed: 3405 },
    { at: 1, side: 0, off: 23, r: 9, ry: 5, seed: 3406 },
  ],
  greenR: 12,
  slope: { fall: [0.04, -0.3], back: 0.14 },
});

export const HOLE_15 = rm({
  n: 15, par: 4, nickname: 'Dust Devil',
  // Wide open off the tee, and then the fairway simply ends: the green sits alone on its own island
  // of turf with forty yards of desert in front of it. The approach is all carry, and the club you
  // have left is decided back on the tee.
  path: [[0, 5], [6, 140], [-2, 270], [6, 390]],
  fw: [{ at: 0, w: 20 }, { at: 0.55, w: 17 }, { at: 0.78, w: 11 }, { at: 0.8, w: 3 }, { at: 1, w: 3 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3501 }, right: { depth: 20, spacing: 15, seed: 3502 } },
  bunkers: [{ at: 0.98, side: -1, off: 20, r: 7 }],
  greenR: 16,
  slope: { fall: [-0.03, -0.13], spine: 0.07 },
});

export const HOLE_16 = rm({
  n: 16, par: 3, nickname: 'Sundial',
  // Short, and the green is the most severe on the course: it falls hard from back to front and
  // sheds to both sides, so the putt matters more than the tee shot.
  path: [[0, 5], [4, 80], [2, 152]],
  fw: [{ at: 0, w: 10 }, { at: 1, w: 12 }],
  greenR: 15,
  belts: { left: { depth: 18, spacing: 14, type: 1, seed: 3601 }, right: { depth: 18, spacing: 14, seed: 3602 } },
  bunkers: [{ at: 0.94, side: -1, off: 17, r: 6 }, { at: 1, side: 1, off: 20, r: 6 }],
  slope: { fall: [0, -0.4], spine: 0.16, back: 0.16 },
});

export const HOLE_17 = rm({
  n: 17, par: 4, nickname: 'Mirage',
  // Water down the whole right side, and the fairway leans that way. The safe line is left, into
  // the palo verde - trivial to fly with a wedge, impossible with anything you would want to be
  // hitting from there.
  path: [[0, 5], [-4, 130], [4, 250], [-2, 366]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 12 }, { at: 1, w: 13 }],
  belts: { left: { depth: 22, spacing: 11, type: 1, seed: 3701 }, right: false },
  water: [{ at: 0.6, side: 1, off: 26, rx: 14, ry: 110, seed: 3702, n: 18 }],
  bunkers: [{ at: 0.96, side: -1, off: 18, r: 6 }],
  slope: { fall: [0.08, -0.14] },
});

export const HOLE_18 = rm({
  n: 18, par: 4, nickname: 'Red Mesa',
  // The hole the course is named for: a long, straight, uphill-feeling finisher with the lake down
  // the left, sand on the right, and the biggest green out here to bring it home to.
  path: [[0, 5], [-8, 140], [2, 270], [-4, 392]],
  fw: [{ at: 0, w: 17 }, { at: 0.5, w: 13 }, { at: 1, w: 16 }],
  belts: { left: false, right: { depth: 22, spacing: 13, seed: 3802 } },
  water: [{ at: 0.62, side: -1, off: 28, rx: 15, ry: 95, seed: 3803, n: 18 }],
  bunkers: [
    { at: 0.55, side: 1, off: 16, r: 8, kind: 'fairwayBunker' },
    { at: 0.98, side: 1, off: 21, r: 7 },
  ],
  greenR: 18, greenRy: 15,
  slope: { fall: [-0.05, -0.12], spine: 0.08 },
  decor: [{ kind: 'path', poly: [[26, 30], [29, 30], [34, 200], [30, 390], [27, 390], [31, 200]] }],
});

export const HOLES = [
  HOLE_1, HOLE_2, HOLE_3, HOLE_4, HOLE_5, HOLE_6, HOLE_7, HOLE_8, HOLE_9,
  HOLE_10, HOLE_11, HOLE_12, HOLE_13, HOLE_14, HOLE_15, HOLE_16, HOLE_17, HOLE_18,
];

export const RED_MESA = {
  id: 'redmesa',
  name: 'Red Mesa',
  theme: 'desert',
  blurbKey: 'blurb_redmesa',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 71
};

export default RED_MESA;
