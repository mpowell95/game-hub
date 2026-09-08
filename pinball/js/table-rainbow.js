// pinball/js/table-rainbow.js - the RAINBOW board: geometry, sensors and paint.
//
// WHERE IT CAME FROM. Two reference images of a custom wooden table (a playfield render and a CAD
// wireframe) plus a written spec, handed over 2026-09-08. There is no rulesheet, no manual and no
// source code for the original - the spec's own scoring section says so and marks itself as
// PROPOSED. So: the LAYOUT here is a reading of the images, and the RULES (js/rainbow.js) are the
// spec's proposal implemented as written.
//
// IT IS IN STARHUB'S UNITS AND AT STARHUB'S SCALE. 350 x 690 with a ball of radius 9, so
// js/physics.js runs it with no constants of its own: the same gravity, the same MAX_TRAVEL, the
// same flipper sweep, the same tuning that took four playtests to settle. A board in its own units
// would have needed all of that re-derived.
//
// TWO CENTRE LINES, AND THEY ARE NOT THE SAME - the lesson STARHUB's table.js already carries, and
// the first draft of this file paid for by ignoring it. `AXIS` (155) is the PLAY AREA's centre; the
// cabinet is 350 wide because the SHOOTER LANE eats the right-hand 40 units. Mirroring about the
// cabinet centre instead put the right wall at x 342, straight through the lane, and the very first
// launch hit it: the ball came off the plunger at 1050 units/s and was thrown sideways at 865
// before it had left the lane. Every left/right pair below is `x` and `mx(x)` = `310 - x`.
//
// THE CONVERSION IS TWO FACTORS AND THAT IS DELIBERATE. The reference playfield spans image x
// 30..975 and y 10..1900; x maps onto 4..306 (0.320) and y onto 4..684 (0.360). The 12% difference
// is the shooter lane coming out of the width. It makes this table slightly taller in proportion
// than the photograph, which is if anything closer to a real playfield (20.25in x 42in, about
// 1:2.07) than the reference crop is.
//
// THREE PLACES THE LAYOUT IS NOT LITERAL, and each one is a playability floor rather than a taste:
//
//   1. THE MAIN FLIPPERS. Measured off the render their tips sit about six ball widths apart, which
//      is not a drain a person can defend. The CAD wireframe disagrees with the render here - its
//      two bottom bars converge to nearly meet, and the render's tips are hidden behind the bottom
//      bumper - so they use STARHUB's proven pivot spread (dx 74). That puts the clear gap at 1.3
//      balls, the figure pinball/CLAUDE.md records as the one that finally worked.
//   2. THE CENTRE OVAL. Drawn full size, because it is the largest single thing on the reference and
//      the table does not read as that table without it. But a HOLE 96 units across, dead centre,
//      would swallow nearly every ball that came down the middle. The paint is full size; the scoop
//      that actually captures is r 15 at its centre, which is catchable and missable.
//   3. THE LOWER GREEN KITES ARE SLINGSHOTS. The spec reads all four green triangles as one-way
//      gates. The upper pair are, and behave that way here. The lower pair sit exactly where
//      slingshots go on every table ever built, in a mirrored pair immediately above the flippers,
//      and a lower playfield with no slingshots has nothing to keep a ball alive.

import { seg, circle, arc, flipper, BALL_R } from './physics.js';

export const NAME = 'RAINBOW';

export const W = 350;
export const H = 690;
export const DRAIN_Y = 646;

/** The PLAY AREA's centre. Not W/2 - see the header. */
export const AXIS = 155;
/** The play area's right edge, and the mirror line's double. */
const PLAY_R = 306;

/** Mirror an x about the play area's centre. Every mirrored pair below is written once. */
export const mx = (x) => PLAY_R + 4 - x;

/** Reference-image pixel -> table unit. Two factors; see the header. */
export const rx = (px) => 4 + (px - 30) * ((PLAY_R - 4) / 945);
export const ry = (py) => 4 + (py - 10) * 0.36;

const D = Math.PI / 180;

// --- the shooter lane ------------------------------------------------------------------------------
// The reference's grey strip down the right. 26 units of clear channel between the two wall
// surfaces, against a ball of 18: the number that matters is the CLEAR width, not the wall spacing,
// and ROYAL FLUSH's import spent two builds with a ball that could not fit down its own launch lane
// because the wall radius was eaten out of the channel from both sides.
const LANE_X = 310;          // the playfield-side wall
const LANE_OUT = 346;        // the cabinet's own right edge
export const PLUNGER = { x: (LANE_X + LANE_OUT) / 2, y: 606 };

// --- the parts, as data ------------------------------------------------------------------------------
// Positions are shared by the colliders, the sensors and the renderer, so the paint and the physics
// cannot drift apart. That is the rule js/table.js's ART block follows, and it exists because this
// game once shipped a renderer carrying its own private copy of the guide polylines.

/** The four-target drop bank across the top. Reference: four white rectangles at image y 45..80. */
export const DROP_COUNT = 4;
// WIDER AND DEEPER THAN THE REFERENCE MEASURES, and the reason is measured too. At the
// reference's own 60 units the bank sits directly above the two pop bumpers, which deflect
// almost everything sideways: a 6-game soak scored 7 drops and ONE cleared bank, so the bonus
// multiplier - the spec's only route to one - was effectively a dead feature. 84 wide with a
// 7-unit collider reaches into the band a launched ball actually crosses.
export const BANK = { x: AXIS, y: 26, w: 84, h: 12 };

/** The three starburst pop bumpers: two up top, one guarding the drain. */
export const POPS = [[117, 97], [mx(117), 97], [AXIS, 505]];
export const POP_R = 25;

/** The upper flippers, on the reference's raised platform. Pivot at the OUTER end, as flippers are. */
export const UPPER = { len: 42, r: 6, pivotY: 227, dx: 65, rest: 22 * D, sweep: 48 * D };

/** The main flippers. `dx` is STARHUB's, not the reference's - see the header, deviation 1. */
export const FLIP = { len: 63, r: 8, rest: 25 * D, sweep: 52 * D, pivotY: 556, dx: 74 };

/** The red-and-white standup targets in the two top clusters, up the shoulders of the crown.
 *  Reference: image (130,180) rising to (300,55), and mirrored. */
export const STANDUPS = [];
for (let i = 0; i < 5; i++) {
  const x = 36 + i * 13.5, y = 65 - i * 11;
  STANDUPS.push([x, y], [mx(x), y]);
}

/** The olive rubber discs interleaved with them, plus the four further down the side lanes. */
export const RUBBERS = [];
for (let i = 0; i < 4; i++) {
  const x = 43 + i * 13.5, y = 60 - i * 11;
  RUBBERS.push([x, y], [mx(x), y]);
}
// 44, not the reference's 39. Clearance from the side wall, which is the number that decides
// whether a piece of furniture is a lane or a trap: a ball is 18 across and the wall surface is
// at x 11, so 39 left 20 units - one ball and a hair. The soak parked a ball there. 44 leaves 25.
RUBBERS.push([44, 376], [mx(44), 376], [28, 436], [mx(28), 436]);

/**
 * THE RAINBOW ROWS, the feature the board is named for: purple 4, blue 9 in an upward arc, red 4.
 *
 * They are SENSORS, not colliders - a rollover is a wire the ball passes over - so nothing here is
 * in the collider list.
 */
export const ROWS = {
  purple: [-27, -9, 9, 27].map((d) => [AXIS + d, 305]),
  blue: [-78, -58, -39, -19, 0, 19, 39, 58, 78].map((d) => {
    const k = d / 78;
    return [AXIS + d, 326 + k * k * 27];
  }),
  // 372, not 356. At 356 the red row sat level with the ENDS of the blue arc (353) and the two
  // read as one tangled band; the reference has red clearly below the blue and inside it.
  red: [-27, -9, 9, 27].map((d) => [AXIS + d, 372]),
};

/** The lone yellow standups: one above the purple row, one in each side lane. */
// The side pair is at x 40 for the same clearance reason as the rubbers above: at the
// reference's 33 the gap to the wall was 16 units against a ball of 18, which is the exact shape
// pinball/CLAUDE.md warns about - too narrow to pass, wide enough to be squeezed into.
export const YELLOWS = [[AXIS, 276], [40, 407], [mx(40), 407]];

/** The two upper green kites, which the spec reads as one-way gates. */
export const GATES = [[50, 348], [mx(50), 348]];

/** The two lower green kites: slingshots - see the header, deviation 3. `n` is the face the coil is
 *  behind, so it cannot fire a ball that rolls in from the inlane side. STARHUB spent a playtest
 *  with 53% of ball life in the pocket a live back face kept firing into. */
export const SLINGS = [
  { a: [34, 462], b: [80, 512], n: [0.736, -0.677] },
  { a: [mx(34), 462], b: [mx(80), 512], n: [-0.736, -0.677] },
];

/** The centre oval. `paint` is the reference's full-size pear; `rad` is the hole that captures. */
export const SCOOP = { x: AXIS, y: 449, rad: 15, paint: { w: 96, h: 151 } };

/** White nylon posts, from the reference's own scatter. Written once, mirrored on build. */
// FEWER AND FURTHER APART THAN THE REFERENCE'S SCATTER, and every number is a clearance.
//
// A pinball table is convex shapes near other convex shapes, and TWO OF THEM A LITTLE UNDER ONE
// BALL APART MAKE A PERMANENT PARKING SPACE - the ball rolls in, touches both, and stops. The
// first draft copied the reference's post scatter literally: posts at x 20 against a wall whose
// surface is at x 11 (9 units of gap), and a pair 28 apart with 16 units between their surfaces.
// A soak parked balls at (20, 383) and (64, 530) and called ball search 15 times in six games.
//
// So every pair below is either OPEN (surfaces more than 18 apart, a ball passes) or SEALED
// (under about 12, a ball cannot enter at all). Nothing is left in between. Four posts in the
// reference's lower cluster are gone rather than moved: they sat in the inlane, which is already
// bounded by a divider and a slingshot and has no room for anything else.
const POST_HALF = [
  [42, 250], [42, 320], [44, 400], [42, 470],
  [80, 250], [112, 268], [76, 404],
];
export const POSTS = [];
for (const [x, y] of POST_HALF) POSTS.push([x, y], [mx(x), y]);

/** The two wooden circles in the top corners of the reference. */
export const CORNER_HOLES = [[22, 42], [mx(22), 42]];

// --- the wall outline -----------------------------------------------------------------------------------
// One polyline per side. WALL_R starts at y 130, not at the top: the band above it is where the ball
// ARRIVES from the shooter lane, and a wall there would seal the launch off from the playfield.

export const WALL_TOP = [[6, 40], [40, 12], [330, 12], [LANE_OUT, 40]];
export const WALL_L = [[6, 40], [6, 500], [62, 600], [100, 660]];
export const WALL_R = [[mx(6), 130], [mx(6), 500], [mx(62), 600], [mx(100), 660]];

/** The inlane / outlane dividers. */
export const DIVS = [[[26, 470], [70, 590]], [[mx(26), 470], [mx(70), 590]]];
/** The wooden shoulders that funnel a ball off the upper platform toward its middle. */
// The inner end is at x 70, not 60, and the 10 units are a clearance. At 60 the shelf's end cap
// stood 19.4 clear units from the upper flipper's pivot - one ball and a twentieth - and a soak
// parked balls at (237, 237) and (235, 235) doing exactly what pinball/CLAUDE.md says a gap that
// size does. At 70 the gap is 9.6: a ball cannot enter it at all, and the way past is over the
// upper flipper, which is what the flipper is there for.
export const SHELVES = [[[6, 196], [70, 232]], [[mx(6), 196], [mx(70), 232]]];
/** The reference's red posts joined by wire, running down to the upper flippers. */
// The lower end is at (78, 222), which puts it 3.8 clear units from the shelf's end cap and 3
// from the upper flipper's pivot - CLOSED, one convex blob, no stable top. At the reference's
// (89, 215) the guide and the shelf converged to 15 clear units, a hair under a ball, and a soak
// parked balls at (58, 209) and (253, 209) eighteen times. STARHUB fixed the identical shape the
// identical way: overlap the two pieces rather than leave a gap the ball can be squeezed into.
export const GUIDES = [[[44, 153], [78, 222]], [[mx(44), 153], [mx(78), 222]]];

/**
 * Every SENSOR on the board: the three rows, the yellow standups' lamps and the scoop mouth.
 * Checked by js/rainbow.js against the ball's position each tick; none of them is a collider.
 */
export const SWITCHES = [];
ROWS.purple.forEach((p, i) => SWITCHES.push({ id: `p${i}`, row: 'purple', x: p[0], y: p[1], r: 12 }));
ROWS.blue.forEach((p, i) => SWITCHES.push({ id: `b${i}`, row: 'blue', x: p[0], y: p[1], r: 12 }));
ROWS.red.forEach((p, i) => SWITCHES.push({ id: `r${i}`, row: 'red', x: p[0], y: p[1], r: 12 }));
SWITCHES.push({ id: 'scoop', kind: 'scoop', x: SCOOP.x, y: SCOOP.y, r: SCOOP.rad });

/**
 * Build the world: colliders and flippers.
 *
 * `down` is the set of drop-target ids currently knocked over, so a dropped target stops being a
 * wall. REBUILT rather than mutated whenever the bank changes, the same discipline table.js uses.
 */
export function buildTable(opts = {}) {
  const down = opts.down || new Set();
  const colliders = [];
  const add = (c) => colliders.push(c);
  const poly = (pts, o) => {
    for (let i = 0; i < pts.length - 1; i++) {
      add(seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o));
    }
  };

  // --- the cabinet -----------------------------------------------------------------------------------
  poly(WALL_TOP, { r: 5, e: 0.4, mu: 0, id: 'wallTop' });
  poly(WALL_L, { r: 5, e: 0.4, mu: 0, id: 'wallL' });
  poly(WALL_R, { r: 5, e: 0.4, mu: 0, id: 'wallR' });

  // --- the shooter lane --------------------------------------------------------------------------------
  add(seg(LANE_X, 126, LANE_X, 640, { r: 5, e: 0.4, mu: 0, id: 'laneWall' }));
  add(seg(LANE_OUT, 40, LANE_OUT, 640, { r: 5, e: 0.4, mu: 0, id: 'laneOut' }));
  // THE GATE, and it is what turns a launch into a shot rather than a rattle. `oneWay` is a unit
  // normal and the wall exists only for a ball whose velocity points along it: [0, 1] means solid
  // for anything moving DOWN and absent for anything moving up. So the launch passes straight
  // through it, and the same ball coming back down the lane lands on it, rolls left down its slope
  // and drops into the playfield instead of dribbling back to the plunger.
  add(seg(LANE_OUT, 102, 302, 128, { r: 4, e: 0.3, mu: 0, id: 'laneGate', oneWay: [0, 1] }));

  // --- the drop target bank ------------------------------------------------------------------------------
  const step = BANK.w / DROP_COUNT;
  for (let i = 0; i < DROP_COUNT; i++) {
    const x0 = BANK.x - BANK.w / 2 + i * step + 1;
    add(seg(x0, BANK.y, x0 + step - 2, BANK.y, {
      r: 7, e: 0.36, mu: 0.05, id: `drop${i}`, on: !down.has(`drop${i}`),
    }));
  }

  // --- the targets, the rubber and the posts ------------------------------------------------------------------
  STANDUPS.forEach((p, i) => add(circle(p[0], p[1], 7, { e: 0.46, mu: 0.05, id: `stand${i}` })));
  RUBBERS.forEach((p, i) => add(circle(p[0], p[1], 8, { e: 0.62, mu: 0.02, id: `rub${i}` })));
  YELLOWS.forEach((p, i) => add(circle(p[0], p[1], 6, { e: 0.44, mu: 0.05, id: `yell${i}` })));
  POSTS.forEach((p, i) => add(circle(p[0], p[1], 6, { e: 0.5, mu: 0.02, id: `post${i}` })));
  CORNER_HOLES.forEach((p, i) => add(circle(p[0], p[1], 11, { e: 0.34, mu: 0.06, id: `hole${i}` })));

  // --- the pop bumpers ----------------------------------------------------------------------------------------
  POPS.forEach((p, i) => add(circle(p[0], p[1], POP_R, { e: 0.34, mu: 0.02, kick: 300, id: `pop${i}` })));

  // --- the upper platform, its guides, and the one-way gates ------------------------------------------------------
  // There is deliberately NO wall across the front of the platform: the upper flippers sit in the
  // open, and a wall there would trap every ball that got up there.
  for (const s of SHELVES) add(seg(s[0][0], s[0][1], s[1][0], s[1][1], { r: 5, e: 0.4, mu: 0, id: 'shelf' }));
  for (const gd of GUIDES) add(seg(gd[0][0], gd[0][1], gd[1][0], gd[1][1], { r: 4, e: 0.42, mu: 0, id: 'guide' }));
  add(seg(GATES[0][0] - 14, GATES[0][1], GATES[0][0] + 14, GATES[0][1] + 12, {
    r: 4, e: 0.3, mu: 0, id: 'gateL', oneWay: [0.4, -0.92],
  }));
  add(seg(GATES[1][0] + 14, GATES[1][1], GATES[1][0] - 14, GATES[1][1] + 12, {
    r: 4, e: 0.3, mu: 0, id: 'gateR', oneWay: [-0.4, -0.92],
  }));

  // --- the slingshots ---------------------------------------------------------------------------------------------
  SLINGS.forEach((s, i) => add(seg(s.a[0], s.a[1], s.b[0], s.b[1], {
    r: 6, e: 0.5, mu: 0.02, kick: 250, kickN: s.n, id: `sling${i}`,
  })));

  // --- the inlane / outlane dividers -----------------------------------------------------------------------------------
  for (const d of DIVS) add(seg(d[0][0], d[0][1], d[1][0], d[1][1], { r: 6, e: 0.4, mu: 0, id: 'div' }));

  // --- the scoop collar --------------------------------------------------------------------------------------------------
  // Open across the top so a ball coming down the middle can drop in; solid round the rest so one
  // arriving from the side is turned away rather than swallowed.
  add(arc(SCOOP.x, SCOOP.y, SCOOP.rad + 6, 20 * D, 160 * D, { r: 3, e: 0.3, mu: 0.1, id: 'scoopRim' }));

  // --- the flippers ------------------------------------------------------------------------------------------------------
  const flippers = [
    flipper(AXIS - FLIP.dx, FLIP.pivotY, FLIP.len, FLIP.rest, FLIP.rest - FLIP.sweep, { id: 'flipL', r: FLIP.r }),
    flipper(AXIS + FLIP.dx, FLIP.pivotY, FLIP.len, Math.PI - FLIP.rest, Math.PI - FLIP.rest + FLIP.sweep, { id: 'flipR', r: FLIP.r }),
    flipper(AXIS - UPPER.dx, UPPER.pivotY, UPPER.len, UPPER.rest, UPPER.rest - UPPER.sweep, { id: 'upperL', r: UPPER.r }),
    flipper(AXIS + UPPER.dx, UPPER.pivotY, UPPER.len, Math.PI - UPPER.rest, Math.PI - UPPER.rest + UPPER.sweep, { id: 'upperR', r: UPPER.r }),
  ];

  return { colliders, flippers };
}

/** Everything the renderer needs that is not a collider. One copy, shared - see the header. */
export const ART = {
  wallL: WALL_L, wallR: WALL_R, wallTop: WALL_TOP,
  laneX: LANE_X, laneOut: LANE_OUT, laneGate: [[LANE_OUT, 102], [302, 128]],
  bank: BANK, dropCount: DROP_COUNT,
  pops: POPS, popR: POP_R,
  standups: STANDUPS, rubbers: RUBBERS, yellows: YELLOWS, posts: POSTS,
  cornerHoles: CORNER_HOLES,
  rows: ROWS, gates: GATES, slings: SLINGS, scoop: SCOOP,
  guides: GUIDES, shelves: SHELVES, divs: DIVS,
  upper: UPPER, playR: PLAY_R,
};

export default {
  NAME, W, H, DRAIN_Y, AXIS, BALL_R, FLIP, UPPER, PLUNGER, SCOOP,
  SWITCHES, DROP_COUNT, BANK, ROWS, POPS, POP_R, buildTable, ART, mx,
};
