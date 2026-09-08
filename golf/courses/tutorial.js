// golf/courses/tutorial.js - THE TEACHING HOLE. One hole, and it belongs to no course.
//
// Matt, 2026-09-08: *"I want a super basic golf hole (not part of any existing course). It must
// have popups and arrows and stuff telling the person how to play. Once they've finished that hole
// (score doesn't matter), they can play the first set of 3 holes."*
//
// ============================================================================================
// IT IS AN ORDINARY HOLE OBJECT AND IT PASSES `validateHole()`, WHICH IS THE POINT.
//
// A lesson that runs on a special-cased fake hole teaches the wrong game: the player would learn a
// swing, an aim and a putt that the real courses then behave differently from. Everything here goes
// through the same `holes.js` / `shot.js` / `render.js` as Pine Valley, so what is learned here is
// exactly what transfers. The coaching lives on top, in `golf/js/tutorial.js`, and touches none of
// the physics.
//
// WHAT IT IS DESIGNED TO TEACH, AND WHY IT IS SHAPED LIKE THIS:
//
//   * **One full shot, then one putt.** That is the whole game in two strokes - the three-tap
//     swing and the read - and nothing else. A par 3 is the only length that guarantees it.
//   * **123 yards, which is a stock 8 iron.** Short enough that the auto-picked club really can
//     reach the green from the tee, so the lesson never has to explain a lay-up.
//   * **NO TREES, NO WATER, NO BUNKERS, NO ROUGH WORTH THE NAME.** Every hazard is a second thing
//     to explain and a way for a first-timer's ball to end up somewhere the lesson has no script
//     for. The corridor is fairway from wall to wall with a ring of light rough outside it, so a
//     bad shot is recoverable and a terrible one is still playable.
//   * **A BIG, NEARLY FLAT GREEN.** 20 x 18 yards against Pine Valley's 10-15, and a slope grid at
//     a tenth of a real green's strength - enough that the chevrons are there to be pointed at,
//     far too little to make the first putt anybody ever hits a guessing game.
//   * **DEAD CALM.** `wind: { speed: 0 }` is honoured by `windFor`, so the wind panel reads 0.0 and
//     the lesson does not have to teach a correction before it has taught a swing.
//
// THE ID IS FROZEN THE MOMENT ANYBODY FINISHES IT (THE LAW rule 5). Completing the hole writes
// `gf.bestHole['tutorial:1']` through the ordinary per-hole path, and `golf/js/progress.js` reads
// exactly that key to decide whether holes 1-3 are open. Renaming the course id, or renumbering the
// hole, would orphan that record and silently re-lock the game for every player who has already
// done the lesson.
// ============================================================================================

import { greenPoly, slopeGrid } from '../js/holegen.js';

const GREEN_CX = 0;
const GREEN_CY = 128;

/** The corridor: a plain rectangle of fairway with a soft waist, wide enough that a first swing
 *  cannot really leave it. Authored rather than generated, because `makeHole`'s landing-zone pinch
 *  and auto-defend bunkers are exactly what this hole must not have. */
const FAIRWAY = [
  [-22, -6], [-24, 30], [-23, 70], [-22, 105], [-24, 150],
  [24, 150], [22, 105], [23, 70], [24, 30], [22, -6],
];
const ROUGH = [
  [-34, -12], [-36, 30], [-35, 70], [-34, 105], [-36, 158],
  [36, 158], [34, 105], [35, 70], [36, 30], [34, -12],
];

export const TUTORIAL_HOLE = {
  n: 1,
  par: 3,
  cardYards: 123,
  tee: [0, 5],
  pin: [GREEN_CX, GREEN_CY],
  // 60 yds behind the tee, same as every generated hole: the camera clamps inside `bounds`, and a
  // hole that stopped at its own tee would pin the ball under the controls for the whole tee shot.
  bounds: { minX: -46, maxX: 46, minY: -55, maxY: 172 },
  base: 'lightRough',
  surfaces: [
    { kind: 'lightRough', poly: ROUGH },
    { kind: 'fairway', poly: FAIRWAY },
    { kind: 'fringe', poly: greenPoly(GREEN_CX, GREEN_CY, 16, 15, 7301, 'round') },
    { kind: 'green', poly: 'green' },
    { kind: 'tee', poly: [[-6, 0], [6, 0], [6, 10], [-6, 10]] },
  ],
  green: {
    poly: greenPoly(GREEN_CX, GREEN_CY, 10, 9, 7301, 'round'),
    // A TENTH OF A REAL GREEN'S BREAK. `slopeGrid`'s `fall` is the baseline downhill vector, and
    // Pine Valley's greens run 0.15-0.25 there; 0.04 is enough for `render.js` to draw chevrons
    // (its `SLOPE_FLAT` cutoff is 0.06 magnitude, which the spine pushes this just past) and far
    // too little to turn the first putt anybody ever hits into a guess.
    slope: slopeGrid({ fall: [0, -0.04], spine: 0.03, back: 0.02 }),
  },
  treeTypes: [],
  trees: [],
  treeBelts: [],
  decor: [],
  // DEAD CALM, stated rather than left to `windFor`'s per-hole seed. A hole may carry its own
  // `wind` and it wins; nothing else on the property does, and this is what that escape hatch was
  // written for.
  wind: { speed: 0, bearing: 0 },
  route: [[0, 5], [0, 60], [GREEN_CX, GREEN_CY]],
};

/** A COURSE-SHAPED OBJECT, DELIBERATELY NOT IN `COURSES`.
 *
 *  It is shaped like a course because `ui.js` plays a hole through `this.course` - `holeKey`,
 *  `paletteFor(course.theme)` and `buildMap` all read it - so giving the lesson a course object
 *  means the play screen needs no special case at all. It is kept OUT of the `COURSES` array
 *  because it has no rounds, no bests, no leaderboard row and no business in the course picker. */
export const TUTORIAL_COURSE = {
  id: 'tutorial',
  name: 'Tutorial',
  theme: 'pine',
  blurbKey: 'blurb_tutorial',
  holes: [TUTORIAL_HOLE],
  par: 3,
};

export default TUTORIAL_COURSE;
