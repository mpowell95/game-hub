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
//   * **A PAR 4, WHICH IS THE SHAPE OF ALMOST EVERY HOLE IN THE GAME.** It shipped as a par 3 on
//     2026-09-08 and Matt's verdict was blunt: *"it should be a par 4."* He is right, and the
//     reason is that a par 3 teaches the one hole type a player will hardly ever meet. A par 4
//     teaches the actual loop - a DRIVE, then an APPROACH with a different club from a different
//     lie, then a putt - which is also the only way the club ladder gets taught by using it rather
//     than by being described.
//   * **372 yards, which is a stock driver and a mid iron.** The approved ladder carries a driver
//     215 and a 6 iron 139, so two clean strikes finish about 18 yards short of the pin: a putt,
//     never a tap-in, and never a lay-up to explain.
//
//     THE PAR WAS SAFE TO CHANGE, AND THAT WAS CHECKED RATHER THAN ASSUMED (THE LAW rule 4). A
//     stored `tutorial:1` of 3 means a par on a par 3 and a birdie on a par 4 - the same number
//     silently changing meaning, which is exactly what blocked the Pine Valley hole-3 swap. A
//     fresh RTDB read on 2026-09-09: 255 player device records, 52 carrying a golf key, and
//     ZERO carrying any `tutorial:*` record at all. Nobody had finished the lesson, so there was
//     no meaning to break. Re-run that check before touching this par again; the moment one
//     person completes it, it is frozen.
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
const GREEN_CY = 377;

/** The corridor: a plain rectangle of fairway with a soft waist, wide enough that a first swing
 *  cannot really leave it. Authored rather than generated, because `makeHole`'s landing-zone pinch
 *  and auto-defend bunkers are exactly what this hole must not have. */
const FAIRWAY = [
  [-24, -6], [-26, 60], [-25, 130], [-24, 200], [-26, 280], [-25, 340], [-26, 400],
  [26, 400], [25, 340], [26, 280], [24, 200], [25, 130], [26, 60], [24, -6],
];
const ROUGH = [
  [-36, -12], [-38, 60], [-37, 130], [-36, 200], [-38, 280], [-37, 340], [-38, 412],
  [38, 412], [37, 340], [38, 280], [36, 200], [37, 130], [38, 60], [36, -12],
];

export const TUTORIAL_HOLE = {
  n: 1,
  par: 4,
  cardYards: 372,
  tee: [0, 5],
  pin: [GREEN_CX, GREEN_CY],
  // 60 yds behind the tee, same as every generated hole: the camera clamps inside `bounds`, and a
  // hole that stopped at its own tee would pin the ball under the controls for the whole tee shot.
  bounds: { minX: -48, maxX: 48, minY: -55, maxY: 424 },
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
  route: [[0, 5], [0, 110], [0, 215], [0, 300], [GREEN_CX, GREEN_CY]],
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
  par: 4,
};

export default TUTORIAL_COURSE;
