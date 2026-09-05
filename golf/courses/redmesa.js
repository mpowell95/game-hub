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
  // 40, NOT 30. MEASURED: the highest-peaking club in the stock bag is the 8 iron at 32.3 yds of
  // apex, so a 30 yd boulder could be flown at the top of an 8 iron's arc - which quietly undid
  // the one thing this obstacle exists to say. At 40 it is solid to everything, from anywhere.
  { name: 'boulder', trunk: 3.2, canopy: 3.2, height: 40 },
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
  // A generous opener, and the only wide fairway on the front nine. The green is the kindest out
  // here: everything on it feeds toward the middle.
  path: [[0, 5], [4, 130], [-4, 250], [2, 356]],
  fw: [{ at: 0, w: 19 }, { at: 0.5, w: 16 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 15, seed: 2101 }, right: { depth: 22, spacing: 15, seed: 2102 } },
  bunkers: [{ at: 0.55, side: 1, off: 20, r: 8, kind: 'fairwayBunker' }],
  guard: ['rightSand'],
  slope: 'bowl',
});

export const HOLE_2 = rm({
  n: 2, par: 4, nickname: 'Coyote Bend',
  // Dogleg left round a boulder field. Boulders block at ANY height, so there is no flying the
  // corner: the only question is how much of it you dare cut on the ground.
  path: [[0, 5], [4, 110], [-24, 230], [-52, 320], [-58, 382]],
  fw: [{ at: 0, w: 16 }, { at: 0.45, w: 12 }, { at: 1, w: 14 }],
  belts: { left: { depth: 18, spacing: 16, type: 2, seed: 2201 }, right: { depth: 22, spacing: 14, seed: 2202 } },
  trees: [{ at: 0.44, side: -1, off: 12, type: 2 }, { at: 0.5, side: -1, off: 15, type: 2 }],
  guard: ['leftSand', 'backSand'],
  slope: 'gentle',
});

export const HOLE_3 = rm({
  n: 3, par: 3, nickname: 'Ocotillo',
  // Over a rocky gully to a green that is wide and shallow: the miss is long or short, never side
  // to side, and long is the desert.
  path: [[0, 5], [-2, 90], [0, 166]],
  fw: [{ at: 0, w: 12 }, { at: 0.5, w: 9 }, { at: 1, w: 13 }],
  belts: { left: { depth: 20, spacing: 13, seed: 2301 }, right: { depth: 20, spacing: 13, seed: 2302 } },
  guard: ['frontJaws'],
  slope: 'gentle',
  greenR: 18, greenRy: 10,
});

export const HOLE_4 = rm({
  n: 4, par: 5, nickname: 'The Long Arroyo',
  // A sand arroyo runs the entire right side from the tee to the green, and a second one CROSSES
  // the corridor at 205: the tee shot is a lay-up, and the arroyo is playable rather than penal,
  // so the punishment is three straight shots at 88 % power with half the accuracy band.
  path: [[0, 5], [-6, 140], [6, 300], [-2, 420], [4, 512]],
  fw: [{ at: 0, w: 17 }, { at: 0.45, w: 13 }, { at: 1, w: 15 }],
  belts: { left: { depth: 22, spacing: 14, seed: 2401 }, right: false },
  // A CROSS HAZARD ONLY FORCES A LAY-UP IF A DRIVER CANNOT CARRY IT. Measured: bands centred at
  // 188-205 yds did almost nothing, because the drive carries 215 and simply flew them. The band
  // has to sit WHERE THE DRIVE LANDS - centred near 220, deep enough that clearing it needs more
  // than the bag has - so the choice is lay up short of 200 or be in it.
  cross: [{ yd: 222, kind: 'waste', depth: 34 }],
  bunkers: [{ at: 0.55, side: 1, off: 19, r: 10, ry: 30, kind: 'fairwayBunker', seed: 2402 }],
  guard: ['rightSand', 'frontSand'],
  slope: 'spine',
});

export const HOLE_5 = rm({
  n: 5, par: 4, nickname: 'Cactus Alley',
  // The narrowest driving test on the property: turf between two stands of saguaro. They cannot be
  // flown - the canopy stops at 15 yards and nothing peaks under that - so this is straight or
  // nothing, and the green tilts hard to the right once you get there.
  path: [[0, 5], [2, 120], [-2, 240], [0, 334]],
  fw: [{ at: 0, w: 13 }, { at: 0.4, w: 9 }, { at: 0.8, w: 9 }, { at: 1, w: 13 }],
  belts: { left: { depth: 24, spacing: 10, seed: 2501 }, right: { depth: 24, spacing: 10, seed: 2502 } },
  bunkers: [{ at: 0.97, side: 1, off: 18, r: 6 }],
  guard: ['leftSand'],
  slope: 'rightShed',
});

export const HOLE_6 = rm({
  n: 6, par: 3, nickname: 'Kiln',
  // The green is an island of turf in a sea of sand, and it crowns in the middle, so a ball that
  // lands anywhere but the plateau runs off it into one. There is no rough here at all.
  path: [[0, 5], [0, 74], [2, 144]],
  fw: [{ at: 0, w: 9 }, { at: 1, w: 8 }],
  belts: false,
  guard: ['ringSand'],
  slope: 'crown',
  greenR: 13,
});

export const HOLE_7 = rm({
  n: 7, par: 4, nickname: 'Mesa Rim',
  // The fairway sits on a shelf with desert falling away both sides and a pool hard against the
  // green's left. The tee shot is comfortable; the approach is a saddle green with water on the
  // low side, which is as uncomfortable as this course gets before the turn.
  path: [[0, 5], [8, 130], [16, 250], [12, 384]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 12 }, { at: 1, w: 12 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2701 }, right: { depth: 20, spacing: 15, type: 1, seed: 2702 } },
  bunkers: [{ at: 0.56, side: -1, off: 16, r: 8, kind: 'fairwayBunker' }],
  guard: ['leftWater', 'frontJaws'],
  slope: 'saddle',
  greenR: 12,
});

export const HOLE_8 = rm({
  n: 8, par: 5, nickname: 'Thunder Valley',
  // A double dogleg with a waste area on the outside of each bend, so both drives are aimed at
  // sand, and a wash crossing at 205 that makes the first of them a lay-up.
  path: [[0, 5], [16, 150], [-10, 300], [10, 430], [22, 530]],
  fw: [{ at: 0, w: 17 }, { at: 0.35, w: 12 }, { at: 0.7, w: 12 }, { at: 1, w: 16 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2801 }, right: { depth: 20, spacing: 15, seed: 2802 } },
  cross: [{ yd: 222, kind: 'waste', depth: 34 }],
  guard: ['frontJaws', 'backSand'],
  slope: 'tier',
});

export const HOLE_9 = rm({
  n: 9, par: 4, nickname: 'Adobe',
  // Straight and honest until the last forty yards, where sand crosses the front of the green.
  // There is no running one in here, and the green falls a different way in every quarter.
  path: [[0, 5], [-6, 120], [4, 250], [-2, 362]],
  fw: [{ at: 0, w: 16 }, { at: 0.5, w: 12 }, { at: 1, w: 12 }],
  belts: { left: { depth: 20, spacing: 15, seed: 2901 }, right: { depth: 20, spacing: 15, seed: 2902 } },
  guard: ['frontSand', 'leftSand', 'rightSand'],
  slope: 'quarters',
});

export const HOLE_10 = rm({
  n: 10, par: 4, nickname: 'Rattler',
  // It bends right, then left, then right again. Position, not distance - and the green steps up
  // halfway through, so the club into it depends on where the pin is.
  path: [[0, 5], [18, 110], [-8, 200], [18, 280], [8, 340]],
  fw: [{ at: 0, w: 16 }, { at: 0.3, w: 13 }, { at: 0.7, w: 13 }, { at: 1, w: 14 }],
  belts: { left: { depth: 18, spacing: 13, seed: 3001 }, right: { depth: 18, spacing: 13, seed: 3002 } },
  bunkers: [{ at: 0.62, side: 1, off: 18, r: 8, kind: 'fairwayBunker' }],
  guard: ['rightSand', 'backSand'],
  slope: 'tier',
});

export const HOLE_11 = rm({
  n: 11, par: 3, nickname: 'High Noon',
  // All of it over water, to a green with sand behind. Everything about it says take one more
  // club, and one more club is the back bunker.
  path: [[0, 5], [0, 92], [-4, 176]],
  fw: [{ at: 0, w: 10 }, { at: 0.55, w: 8 }, { at: 1, w: 13 }],
  belts: { left: false, right: { depth: 18, spacing: 14, seed: 3102 } },
  water: [{ at: 0.5, side: 0, off: 0, rx: 34, ry: 46, seed: 3103, n: 14 }],
  guard: ['backSand', 'leftSand'],
  slope: 'crown',
  greenR: 13,
});

export const HOLE_12 = rm({
  n: 12, par: 4, nickname: 'Painted Hills',
  // Boulders stand in the middle of the fairway at driving distance and more of them line the left
  // shoulder of the green. They block at any height, so both the tee shot and the approach are
  // decisions about a route rather than swings.
  path: [[0, 5], [-4, 120], [8, 250], [2, 378]],
  fw: [{ at: 0, w: 18 }, { at: 0.5, w: 15 }, { at: 1, w: 14 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3201 }, right: { depth: 20, spacing: 15, seed: 3202 } },
  sentinels: [{ at: 0.55, side: 0, off: 4, n: 3, spread: 9, type: 2 }],
  guard: ['leftTrees', 'rightSand'],
  guardTree: 2,
  slope: 'tier',
});

export const HOLE_13 = rm({
  n: 13, par: 5, nickname: 'The Gorge',
  // Three shots for most, and the gorge crosses at 205 so the first of them is a lay-up. The third
  // is over water to a shallow green that runs hard from back to front.
  path: [[0, 5], [10, 150], [-6, 300], [4, 420], [-2, 524]],
  fw: [{ at: 0, w: 15 }, { at: 0.5, w: 11 }, { at: 0.8, w: 10 }, { at: 1, w: 13 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3301 }, right: { depth: 20, spacing: 15, seed: 3302 } },
  cross: [{ yd: 222, kind: 'water', depth: 34 }, { yd: 418, kind: 'waste', depth: 30 }],
  guard: ['frontWater', 'ringSand'],
  slope: 'steep',
  greenR: 12, greenRy: 10,
});

export const HOLE_14 = rm({
  n: 14, par: 4, nickname: 'Roadrunner',
  // A driver reaches, and everything round the green is sand on a crown that throws a ball off in
  // whatever direction it arrived from. Going for it is the wrong play and it will not feel like
  // it from the tee.
  path: [[0, 5], [-8, 110], [-4, 210], [-10, 306]],
  fw: [{ at: 0, w: 13 }, { at: 0.5, w: 9 }, { at: 1, w: 11 }],
  belts: { left: { depth: 24, spacing: 11, seed: 3401 }, right: { depth: 20, spacing: 13, seed: 3402 } },
  cross: [{ yd: 222, kind: 'water', depth: 34 }],
  guard: ['ringSand', 'backWater'],
  slope: 'crown',
  greenR: 10,
});

export const HOLE_15 = rm({
  n: 15, par: 4, nickname: 'Dust Devil',
  // Wide open off the tee, and then the fairway simply ends: the green sits alone on its own island
  // of turf with forty yards of desert in front of it and water short. The approach is all carry,
  // and the club you have left is decided back on the tee.
  path: [[0, 5], [6, 140], [-2, 270], [6, 390]],
  fw: [{ at: 0, w: 17 }, { at: 0.55, w: 13 }, { at: 0.78, w: 9 }, { at: 0.8, w: 3 }, { at: 1, w: 3 }],
  belts: { left: { depth: 20, spacing: 15, seed: 3501 }, right: { depth: 20, spacing: 15, seed: 3502 } },
  guard: ['frontWater', 'ringSand'],
  slope: 'quarters',
  greenR: 11,
});

export const HOLE_16 = rm({
  n: 16, par: 3, nickname: 'Sundial',
  // Short, and the most severe green on the course: it crowns in the middle and is ringed with
  // sand, so the putt matters far more than the tee shot and the tee shot is not easy either.
  path: [[0, 5], [4, 80], [2, 152]],
  fw: [{ at: 0, w: 9 }, { at: 1, w: 10 }],
  belts: { left: { depth: 18, spacing: 14, type: 1, seed: 3601 }, right: { depth: 18, spacing: 14, seed: 3602 } },
  guard: ['ringSand'],
  slope: 'crown',
  greenR: 11,
});

export const HOLE_17 = rm({
  n: 17, par: 4, nickname: 'Mirage',
  // Water down the whole right side and the fairway leans that way. The safe line is left, into
  // the palo verde - trivial to fly with a wedge, impossible with anything you would want to be
  // hitting from there - and boulders stand on the corner so the line cannot simply be cut.
  path: [[0, 5], [-4, 130], [4, 250], [-2, 366]],
  fw: [{ at: 0, w: 14 }, { at: 0.5, w: 9 }, { at: 1, w: 11 }],
  belts: { left: { depth: 24, spacing: 10, type: 1, seed: 3701 }, right: false },
  water: [{ at: 0.5, side: 1, off: 26, rx: 13, ry: 80, seed: 3703 }],
  sentinels: [{ at: 0.46, side: -1, off: 19, n: 4, spread: 9, type: 2 }],
  guard: ['rightWater', 'frontSand'],
  slope: 'saddle',
});

export const HOLE_18 = rm({
  n: 18, par: 4, nickname: 'Red Mesa',
  // The hole the course is named for, and the hardest here. A wash crosses at 200 so the drive is
  // a lay-up, the green then sits between water short and sand long on the smallest surface of any
  // par 4 out here, and it runs away from back to front. Par is meant to be a good score.
  path: [[0, 5], [-8, 140], [2, 270], [-4, 392]],
  fw: [{ at: 0, w: 14 }, { at: 0.5, w: 9 }, { at: 1, w: 11 }],
  belts: { left: { depth: 24, spacing: 12, seed: 3801 }, right: { depth: 20, spacing: 14, seed: 3802 } },
  cross: [{ yd: 222, kind: 'water', depth: 34 }],
  guard: ['frontWater', 'backSand', 'rightSand'],
  slope: 'steep',
  greenR: 11, greenRy: 13,
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
