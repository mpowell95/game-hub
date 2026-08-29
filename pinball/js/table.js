// pinball/js/table.js - the playfield itself: every wall, post, bumper, target and switch, in one
// place, as pure data. No DOM, no canvas, no rules. physics.js pushes the ball around this; game.js
// decides what each contact is worth; render.js draws it.
//
// COORDINATES. One fixed logical playfield, 400 x 760 units, y DOWN (screen convention, so
// "gravity" is +y and the flippers are at large y). Everything scales from this at draw time, so
// the geometry below is the same on every device and the physics is resolution-independent. A ball
// is 18 units across, which is the number every clearance below is checked against: any channel
// narrower than 18 is deliberately sealed, and any channel meant to pass a ball is at least 24.
//
// THE SHOT MAP (this is the part worth understanding before moving anything):
//
//        .-----------------------------------.
//        |   [orbit lane]  H  U  B  lanes     |   the arch is a real 34-wide channel: the
//        |  spinner   (o) (o)   (o)  \ scoop  |   plunger fires INTO it, and a left-orbit
//        |   |        pop bumpers      |      |   shot travels the whole way round and drops
//        |  [drop bank]      \ramp/    |      |   back out at the top right
//        |   \deflector      |    |    |      |
//        |    stand-up      ramp mouth |stand |
//        |      \  sling        sling /       |
//        |       \  \ inlane   /  /           |   plunger
//        |         \_[  ]  [  ]_/             |   lane -->
//        '------------ drain -----------------'
//
//   LEFT FLIPPER  -> the ramp (centre) and the SCOOP (up the right wall; the scoop's mouth faces
//                    straight down, so the right wall lane feeds it and a slightly-left shot
//                    carries on into the pop bumpers instead).
//   RIGHT FLIPPER -> the ramp, the DROP TARGET BANK (upper left), and the LEFT ORBIT, which runs
//                    up the left lane past the spinner, round the arch, and back down the right.
//
// WHY THE ORBIT DEFLECTOR IS A ONE-WAY. The left lane needs to be enterable from below (that is the
// orbit shot) and to spit a returning ball back into the playfield instead of into the outlane
// (which is what an undefended lane exit does, and it makes the best shot on the table a drain).
// One collider does both: it exists only for a ball travelling DOWNWARD, so an ascending shot
// passes through it as if it were not there. Same trick, same reason, as the shooter-lane gate.

import { seg, circle, arc, flipper, BALL_R } from './physics.js';

export const W = 400;
export const H = 760;
export const DRAIN_Y = 726;
export { BALL_R };

const TAU = Math.PI * 2;
const D = Math.PI / 180;

// The arch is centred on the whole table, not on the playfield: it has to span the shooter lane too.
export const ARCH = { cx: 201, cy: 250, rOut: 189, rIn: 155 };
/** Playfield mirror axis. The shooter lane eats the right edge, so the play area is 16..352 and its
 *  centre is 184, NOT 200. Every left/right pair below is `x` and `368 - x`. */
export const AXIS = 184;
const mx = (x) => 368 - x;

// `minV` is deliberately just under the speed needed to clear the arch: a stab at the plunger
// dribbles back down the lane and has to be re-plunged, a normal pull makes the orbit. That is the
// whole plunger skill curve, and it only works because a dribbled ball is handed straight back to
// the plunger (game.js's shooter-lane rest check) rather than sitting there dead.
export const PLUNGER = { x: 373, y: 708, minV: 686, maxV: 1274, laneX: 360 };  // 2026-08-29: x0.845 with GRAVITY 790 -> 564 (a v^2/2g gate; see game.js GRAVITY)

/** Flipper geometry, shared with the renderer so the paddle art and the collider can never drift. */
export const FLIP = { len: 58, r: 8, rest: 27 * D, sweep: 52 * D, pivotY: 640, dx: 68 };

// --- switches (non-physical trigger regions) ---------------------------------------------------
// A switch is a circle the ball's CENTRE has to enter. game.js edge-detects entry, so a ball that
// parks inside one scores exactly once. `need` is an optional velocity gate.
export const SWITCHES = [
  { id: 'orbitTop', x: 201, y: 78, r: 16 },                     // top of the arch channel
  { id: 'spinner', x: 30, y: 336, r: 15 },                      // left lane, orbit shot
  { id: 'laneH', x: 152, y: 146, r: 13 },
  { id: 'laneU', x: 192, y: 132, r: 13 },
  { id: 'laneB', x: 232, y: 146, r: 13 },
  { id: 'rampIn', x: 184, y: 396, r: 17, needUp: 161 },         // fast enough UP = made the ramp (x0.845, see game.js GRAVITY)
  { id: 'scoop', x: 298, y: 302, r: 10, capture: true },        // saucer: holds the ball (see SCOOP)
  { id: 'inlaneL', x: 93, y: 568, r: 12 },
  { id: 'inlaneR', x: mx(93), y: 568, r: 12 },
  { id: 'outlaneL', x: 58, y: 638, r: 13 },
  { id: 'outlaneR', x: mx(58), y: 638, r: 13 },
];

/** The habitrail the ramp shot rides: a scripted path, not physics. Entering the ramp mouth fast
 *  enough hands the ball to this spline for ~1.15 s and drops it into the right inlane, which is
 *  how every real ramp behaves and is far kinder than trying to simulate a banked wire in 2D. */
// It hugs the right wall on the way down deliberately: at its first routing it came back through
// (326, 286) and drew straight over the scoop, hiding the table's second-most-important shot.
export const RAMP_PATH = [
  [184, 392], [184, 330], [192, 268], [214, 222], [250, 200], [290, 204],
  [320, 232], [336, 278], [340, 338], [336, 404], [326, 462], [309, 512],
];
export const RAMP_EXIT_V = [-118, 219];   // along the right inlane, downhill toward the flipper
export const RAMP_TIME = 1.39;            // seconds end to end

/** Drop target bank: four targets on one diagonal, upper left. Fed by the RIGHT flipper. */
const BANK_A = [70, 338], BANK_U = [0.8, 0.6], BANK_LEN = 19, BANK_STEP = 23.67;
export const DROP_COUNT = 4;

function dropTarget(i) {
  const s = i * BANK_STEP;
  return seg(
    BANK_A[0] + BANK_U[0] * s, BANK_A[1] + BANK_U[1] * s,
    BANK_A[0] + BANK_U[0] * (s + BANK_LEN), BANK_A[1] + BANK_U[1] * (s + BANK_LEN),
    { r: 4.5, e: 0.5, id: `drop${i}` },
  );
}

/** The scoop rim: a near-closed ring with its mouth pointing straight DOWN, so the right lane feeds
 *  it. Opening half-width 0.85 rad gives a 22-unit gap, just over one ball.
 *
 *  ITS X POSITION IS A CLEARANCE CONSTRAINT, NOT A TASTE DECISION. A convex rim sitting a little
 *  under one ball-width from another convex surface is a perfect wedge: the ball rolls in, touches
 *  both, and stops dead forever. The first draft had the scoop at x=330, two units off the right
 *  wall, and test.js's soak duly wedged every ball at (358, 268) and sat there for the whole game.
 *  So: at least 26 units of clear air on BOTH sides (wall at 352, pop bumper 2 to the left), which
 *  is one ball plus margin. Moving the scoop, the right wall or that bumper means re-checking this. */
const SCOOP = { x: 298, y: 302, rad: 20, mouth: Math.PI / 2, half: 0.85 };

/**
 * Build a fresh set of colliders + flippers.
 * @param {{ outlaneSaves?: boolean }} opts  `outlaneSaves` adds the Casual-only rails that close
 *        both outlanes. They are real, visible, physical rails rather than a hidden "sometimes the
 *        ball comes back" fudge, so what saved you is always legible on the playfield.
 */
export function buildTable(opts = {}) {
  const colliders = [];
  const add = (c) => { colliders.push(c); return c; };

  // --- outer shell -----------------------------------------------------------------------------
  add(arc(ARCH.cx, ARCH.cy, ARCH.rOut, Math.PI, TAU, { id: 'archOut', e: 0.4 }));
  // Inner arch stops 20 degrees short of vertical on the right: that gap IS the orbit's exit into
  // the playfield. Closing it would make the orbit a dead end.
  add(arc(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 20 * D, { id: 'archIn', e: 0.4 }));

  add(seg(12, 250, 12, 556, { id: 'wallL' }));
  add(seg(12, 556, 76, 716, { id: 'funnelL' }));
  add(seg(390, 250, 390, 730, { id: 'wallR' }));            // shooter lane, outer
  add(seg(356, 290, 356, 730, { id: 'wallPF' }));           // shooter lane inner = playfield right
  add(seg(356, 556, mx(76), 716, { id: 'funnelR' }));
  add(seg(356, 724, 390, 724, { id: 'plungerFloor', e: 0.1 }));

  // Shooter-lane gate. Exists only for a DOWNWARD-moving ball, and slopes down to the left, so a
  // ball returning round the orbit is caught and rolled out into the playfield instead of dribbling
  // back to the plunger.
  add(seg(390, 250, 356, 290, { id: 'gate', e: 0.25, oneWay: [0, 1] }));

  // Left orbit lane + its one-way exit deflector (see the file header).
  add(seg(46, 250, 46, 392, { id: 'orbitWall' }));
  add(seg(46, 392, 92, 444, { id: 'orbitDeflect', e: 0.3, oneWay: [0, 1] }));

  // --- upper playfield -------------------------------------------------------------------------
  add(circle(110, 262, 20, { id: 'pop0', kick: 356, e: 0.45 }));
  add(circle(184, 196, 20, { id: 'pop1', kick: 356, e: 0.45 }));
  add(circle(250, 242, 20, { id: 'pop2', kick: 356, e: 0.45 }));

  add(circle(172, 140, 6, { id: 'lanePost0', e: 0.6 }));
  add(circle(212, 140, 6, { id: 'lanePost1', e: 0.6 }));

  for (let i = 0; i < DROP_COUNT; i++) add(dropTarget(i));

  // Stand-up targets, one per side wall, at the height the ball falls past on its way to the
  // outlane. They double as a soft outlane defence, which is deliberate.
  // Flush to the side walls (3 units of gap, well under a ball) so nothing can wedge behind them:
  // at x=30 the soak found balls parking in the V between the target's end cap and the wall.
  add(seg(24, 462, 24, 492, { r: 5, e: 0.55, id: 'standL' }));
  add(seg(mx(24), 462, mx(24), 492, { r: 5, e: 0.55, id: 'standR' }));

  // Scoop rim.
  add(arc(SCOOP.x, SCOOP.y, SCOOP.rad, SCOOP.mouth + SCOOP.half, SCOOP.mouth - SCOOP.half + TAU,
    { id: 'scoopRim', e: 0.25, r: 4 }));

  // Ramp mouth guides.
  add(seg(158, 436, 168, 396, { id: 'rampGuideL', e: 0.35 }));
  add(seg(210, 436, 200, 396, { id: 'rampGuideR', e: 0.35 }));

  // --- lower playfield -------------------------------------------------------------------------
  // Slingshots first: `kick` means a guaranteed outgoing speed, which is what the solenoid does.
  add(seg(75, 501, 145, 612, { r: 7, e: 0.4, kick: 431, id: 'slingL' }));
  add(seg(mx(75), 501, mx(145), 612, { r: 7, e: 0.4, kick: 431, id: 'slingR' }));
  // Inlane/outlane dividers. Their lower ends deliberately OVERLAP the flipper pivots (8.5 apart
  // against 13 of combined thickness). An end cap sitting a few units clear of the pivot instead
  // makes a narrow upward-facing V, and a V between two convex surfaces is a STABLE resting place:
  // test.js's soak parked the ball at (258, 624) and left it there for four minutes of game time,
  // untouchable because the contact point is the pivot itself, where the paddle's surface speed is
  // exactly zero. Overlapping them leaves one convex blob, which has no stable top.
  add(seg(40, 524, 110, 634, { r: 5, e: 0.4, id: 'divL' }));
  add(seg(mx(40), 524, mx(110), 634, { r: 5, e: 0.4, id: 'divR' }));

  if (opts.outlaneSaves) {
    // Casual seals each outlane, and WHERE it does that is the whole trick. Both earlier attempts
    // put something part-way DOWN the outlane, which cannot work: an outlane is a dead end, so
    // anything that stops the ball there has nowhere to send it, and the soak duly parked balls in
    // the corner for whole games. This post sits at the outlane's MOUTH instead, wedged between the
    // side wall and the top of the inlane divider (both overlapping, so there is no gap and no V).
    // The ball rolls over one convex blob and down the divider's other face into the INLANE, which
    // is exactly what a real outlane post does.
    add(circle(29, 518, 10, { id: 'savePostL', e: 0.55 }));
    add(circle(mx(29), 518, 10, { id: 'savePostR', e: 0.55 }));
  }

  const flippers = [
    flipper(AXIS - FLIP.dx, FLIP.pivotY, FLIP.len, FLIP.rest, FLIP.rest - FLIP.sweep, { id: 'flipL', r: FLIP.r }),
    flipper(AXIS + FLIP.dx, FLIP.pivotY, FLIP.len, Math.PI - FLIP.rest, Math.PI - FLIP.rest + FLIP.sweep, { id: 'flipR', r: FLIP.r }),
  ];

  return { colliders, flippers };
}

/** Everything the renderer needs that is not a collider: lamp positions, paint, labels. Kept here
 *  so the art and the physics read the same numbers (js/CLAUDE.md's standing complaint about
 *  duplicated geometry drifting apart). */
export const ART = {
  scoop: SCOOP,
  bank: { a: BANK_A, u: BANK_U, len: BANK_LEN, step: BANK_STEP, count: DROP_COUNT },
  pops: [[110, 262], [184, 196], [250, 242]],
  lanes: [[152, 146], [192, 132], [232, 146]],
  slings: [[[75, 501], [145, 612]], [[mx(75), 501], [mx(145), 612]]],
  stands: [[[24, 462], [24, 492]], [[mx(24), 462], [mx(24), 492]]],
  savePosts: [[29, 518], [mx(29), 518]],
  // Lamp inserts: small painted lenses that game.js lights. [x, y, key, rotation]
  inserts: [
    [184, 452, 'ramp', 0],
    [298, 340, 'scoop', 0],
    [106, 314, 'bank', 0.64],
    [30, 372, 'orbit', 0],
    [93, 568, 'inlaneL', 1.0],
    [mx(93), 568, 'inlaneR', -1.0],
    [56, 604, 'saveL', 0],
    [mx(56), 604, 'saveR', 0],
  ],
};

export default { W, H, DRAIN_Y, ARCH, AXIS, PLUNGER, FLIP, SWITCHES, RAMP_PATH, RAMP_EXIT_V, RAMP_TIME, buildTable, ART, DROP_COUNT, BALL_R };
