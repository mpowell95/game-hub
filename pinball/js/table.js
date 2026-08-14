// pinball/js/table.js - the playfield itself: every wall, post, bumper, target and switch, in one
// place, as pure data. No DOM, no canvas, no rules. physics.js pushes the ball around this; game.js
// decides what each contact is worth; render.js draws it.
//
// COORDINATES, AND THE REAL-WORLD SCALE THEY ARE ON (rebuilt 2026-08-14). One fixed logical
// playfield, 400 x 820 units, y DOWN (screen convention, so "downhill" is +y and the flippers are
// at large y). A ball is 21 units across and a real pinball is 1 1/16 in (26.99 mm), so
//
//     1 unit = 1.285 mm = 0.0506 in       400 x 820 units = 20.2 x 41.5 in
//
// and a real WPC playfield is 20.25 x 42 in. EVERY NUMBER BELOW IS ON THAT SCALE, which is the
// point: a clearance is not "looks about right", it is a measurement that can be checked against a
// parts list. Any channel meant to pass a ball is at least 24 clear (one ball plus a little), and
// anything narrower than 21 is deliberately sealed.
//
// THE FLIPPERS ARE TO SPEC, AND THIS IS THE PART THAT WAS WRONG. Matt: "The paddles are too close
// together. The space between them barely fits the ball... Look online for a real answer for this
// spacing." The answer, from the WPC flipper-hole spec and the Williams bat dimensions:
//
//     pivot to pivot     6 13/16 - 7 in  (6 7/8 in is the common value)  -> 136 units
//     bat length         2.8 - 3 in, tapering 0.6 in at the base to 0.2  -> len 56, r 7 -> 3
//     rest angle         ~30 deg below horizontal, ~50 deg of sweep
//     => gap between the tips AT REST                                     33 units = 1.57 balls
//     => gap between the tips HELD UP                                     25 units = 1.18 balls
//
// The old table had the pivots 7.6 balls apart with 3.2-ball flippers, which closed the rest gap to
// 1.24 balls - measurably tighter than any real machine, and exactly what "barely fits the ball"
// describes. test.js asserts both gaps in ball diameters, so this cannot drift again.
//
// THE SHOT MAP (this is the part worth understanding before moving anything). The layout is a clone
// of the reference table Matt supplied: a four-target bank across the top, twin pop bumpers under
// it, a pair of UPPER FLIPPERS on the shoulders, three arcs of lit posts across the middle, the big
// teardrop centre ramp, and one pop bumper dead centre BELOW the main flippers.
//
//        .-----------------------------------.
//        |  H   U   B  lanes  (under the arch)|   the arch is a real 38-wide channel: the
//        |     [ | | | ] drop bank            |   plunger fires INTO it and a left-orbit shot
//        |  (o)  pop pop  (o)      \ scoop    |   travels the whole way round and drops back
//        |   \ upper flipper  flipper /       |   out at the top right
//        |      * star rollover               |
//        |    o    o    o    o    o  post arc |
//        |         /teardrop\                 |
//        |  stand  |  RAMP  |    stand        |
//        |   \  sling    sling  /             |   plunger
//        |     \_[  ]    [  ]_/               |   lane -->
//        |         \  (o)  /                  |   (o) = the centre bumper, below the flippers
//        '------------ drain -----------------'
//
//   LOWER LEFT   -> the RAMP (dead centre) and the SCOOP (up the right wall).
//   LOWER RIGHT  -> the RAMP, and the LEFT ORBIT past the spinner, round the arch and back down.
//   UPPER LEFT/RIGHT (same two buttons) -> the DROP BANK and the pop bumpers, which the teardrop
//                   ramp hides from the main flippers. That is what the upper pair is FOR.
//
// WHY THE ORBIT DEFLECTOR IS A ONE-WAY. The left lane needs to be enterable from below (that is the
// orbit shot) and to spit a returning ball back into the playfield instead of into the outlane
// (which is what an undefended lane exit does, and it makes the best shot on the table a drain).
// One collider does both: it exists only for a ball travelling DOWNWARD, so an ascending shot
// passes through it as if it were not there. Same trick, same reason, as the shooter-lane gate.

import { seg, circle, arc, flipper, BALL_R } from './physics.js';

export const W = 400;
export const H = 820;
export const DRAIN_Y = 786;
export { BALL_R };

/** Millimetres per table unit. The one number the whole scale hangs off (see the header): a real
 *  pinball is 1 1/16 in across and it is BALL_R * 2 units across. game.js turns a playfield PITCH
 *  in degrees into a gravity in units/s^2 with it. */
export const MM_PER_UNIT = 26.9875 / (BALL_R * 2);

const TAU = Math.PI * 2;
const D = Math.PI / 180;

// The arch is centred on the whole table, not on the playfield: it has to span the shooter lane too.
// rOut - rIn = 38 gives 30 units of clear channel, one ball plus 9.
export const ARCH = { cx: 202, cy: 224, rOut: 190, rIn: 152 };
/** Playfield mirror axis. The shooter lane eats the right edge, so the play area is 12..360 and its
 *  centre is 186, NOT 200. Every left/right pair below is `x` and `372 - x`. */
export const AXIS = 186;
const mx = (x) => 372 - x;

// `minV` is deliberately just under the speed needed to carry the arch: a stab at the plunger
// dribbles back down the lane and has to be re-plunged, a normal pull makes the orbit. That is the
// whole plunger skill curve, and it only works because a dribbled ball is handed straight back to
// the plunger (game.js's shooter-lane rest check) rather than sitting there dead.
export const PLUNGER = { x: 376, y: 758, minV: 1080, maxV: 2500, laneX: 352 };

/** Flipper geometry, shared with the renderer so the paddle art and the collider can never drift.
 *  Straight off the WPC spec - see the header block, and don't change one of these without redoing
 *  the gap arithmetic there. `dx` is HALF the 136-unit (6 7/8 in) pivot-to-pivot spacing. */
export const FLIP = {
  len: 56, r: 7, rTip: 3, rest: 30 * D, sweep: 50 * D, pivotY: 626, dx: 68,
  // The upper pair: real upper flippers are the 2 in bat, two thirds of the main one.
  // upX/upPivotY are a CLEARANCE, not a look: at (112, 364) the pivot sat 16 units from the orbit
  // deflector, and a soak wedged the ball in the V between them for 33 seconds - untouchable,
  // because a pivot's surface speed is exactly zero however hard you flip.
  upLen: 38, upR: 6, upRTip: 3, upPivotY: 340, upX: 124,
};

/** The teardrop in the middle of the reference table, with a line down its centre, is a RAMP: the
 *  mouth faces the flippers, the habitrail runs up its spine. Physically it is a near-closed ring
 *  (same shape as the scoop, four times the size) plus two segments closing the pointed top, so the
 *  ball goes AROUND it unless it is shot up the middle. */
const DROP_RING = { cx: 186, cy: 436, rad: 40, mouth: Math.PI / 2, half: 0.50, apex: [186, 372] };
export const TEARDROP = DROP_RING;

// --- switches (non-physical trigger regions) ---------------------------------------------------
// A switch is a circle the ball's CENTRE has to enter. game.js edge-detects entry, so a ball that
// parks inside one scores exactly once. `need` is an optional velocity gate.
export const SWITCHES = [
  { id: 'orbitTop', x: 202, y: 53, r: 17 },                     // top of the arch channel
  { id: 'spinner', x: 37, y: 296, r: 17 },                      // left lane, orbit shot
  { id: 'laneH', x: 142, y: 128, r: 14 },
  { id: 'laneU', x: 186, y: 114, r: 14 },
  { id: 'laneB', x: 230, y: 128, r: 14 },
  { id: 'star', x: 186, y: 336, r: 15 },                        // the skill-shot rollover
  { id: 'rampIn', x: 186, y: 472, r: 18, needUp: 520 },         // fast enough UP = made the ramp
  { id: 'scoop', x: 300, y: 320, r: 11, capture: true },        // saucer: holds the ball
  { id: 'inlaneL', x: 102, y: 574, r: 14 },
  { id: 'inlaneR', x: mx(102), y: 574, r: 14 },
  { id: 'outlaneL', x: 63, y: 582, r: 13 },
  { id: 'outlaneR', x: mx(63), y: 582, r: 13 },
];

/** The habitrail the ramp shot rides: a scripted path, not physics. Entering the mouth fast enough
 *  hands the ball to this spline for ~1.15 s and drops it into the right inlane, which is how every
 *  real ramp behaves and is far kinder than trying to simulate a banked wire in 2D. It climbs the
 *  teardrop's spine (the centre line the reference blueprint draws) and then swings right, clear of
 *  the scoop, so the table's second-most-important shot is never painted over. */
export const RAMP_PATH = [
  [186, 476], [186, 436], [186, 400], [190, 380], [202, 364], [222, 350],
  [248, 342], [276, 346], [300, 364], [314, 392], [318, 428], [314, 468],
  [308, 510], [298, 552], [288, 596],
];
export const RAMP_EXIT_V = [-170, 430];   // along the right inlane, downhill toward the flipper
export const RAMP_TIME = 1.15;            // seconds end to end

/** Drop target bank: four targets in a row across the top centre, as on the reference table. The
 *  9-unit gaps are closed by the targets' own 4.5 radius, so an intact bank is a solid wall. */
const BANK_A = [134, 176], BANK_U = [1, 0], BANK_LEN = 19, BANK_STEP = 28;
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
 *  it. Opening half-width 0.85 rad gives a 33-unit gap, one and a half balls.
 *
 *  ITS X POSITION IS A CLEARANCE CONSTRAINT, NOT A TASTE DECISION. A convex rim sitting a little
 *  under one ball-width from another convex surface is a perfect wedge: the ball rolls in, touches
 *  both, and stops dead forever. The first build had the scoop two units off the right wall, and
 *  test.js's soak duly wedged every ball there and sat on it for the whole game. So: at least 30
 *  units of clear air on BOTH sides (wall at 360, right pop bumper up and left), which is one ball
 *  plus half. Moving the scoop, the right wall or that bumper means re-checking this. */
const SCOOP = { x: 300, y: 320, rad: 22, mouth: Math.PI / 2 + 0.45, half: 0.85 };

/** The middle arcs of the reference table are LAMP INSERTS, not posts - the blueprint draws them as
 *  circles with a centre hole, which is a lamp, and eleven posts across the middle of a playfield is
 *  a bagatelle rather than a pinball table. They are painted (ART.lensArcs) and only these two are
 *  real, out on the shoulders where a real machine puts a rubber post to guard the outlane approach.
 *
 *  They started as five real posts spanning the whole width, and every one of the table's four shots
 *  measurably died: a fan of 2-degree test shots from each flipper showed the scoop reachable in a
 *  single 2-degree window and the orbit in none at all, because a post arc across the middle is a
 *  wall with holes in it. `probe`-style reachability is now an assertion in test.js. */
const ARC_POSTS = [[54, 470], [318, 470]];

/**
 * Build a fresh set of colliders + flippers.
 * @param {{ outlaneSaves?: boolean }} opts  `outlaneSaves` adds the Casual-only posts that close
 *        both outlane mouths. They are real, visible, physical posts rather than a hidden
 *        "sometimes the ball comes back" fudge, so what saved you is always legible on the
 *        playfield.
 */
export function buildTable(opts = {}) {
  const colliders = [];
  const add = (c) => { colliders.push(c); return c; };

  // --- outer shell -----------------------------------------------------------------------------
  add(arc(ARCH.cx, ARCH.cy, ARCH.rOut, Math.PI, TAU, { id: 'archOut', e: 0.4 }));
  // Inner arch stops 20 degrees short of vertical on the right: that gap IS the orbit's exit into
  // the playfield. Closing it would make the orbit a dead end.
  add(arc(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 20 * D, { id: 'archIn', e: 0.4 }));

  // The side walls angle inward below the slingshots, roughly PARALLEL to the outlane dividers, so
  // each outlane keeps a real 1 3/8 in (27 unit) width the whole way down instead of fanning out
  // into a funnel three balls wide. Then the drain funnels take over.
  add(seg(12, 224, 12, 520, { id: 'wallL' }));
  add(seg(12, 520, 78, 640, { id: 'wallLowL' }));
  add(seg(78, 640, 150, 790, { id: 'funnelL' }));
  add(seg(392, 224, 392, 792, { id: 'wallR' }));            // shooter lane, outer
  add(seg(360, 262, 360, 790, { id: 'wallPF' }));           // shooter lane inner = playfield right
  add(seg(mx(12), 520, mx(78), 640, { id: 'wallLowR' }));
  add(seg(mx(78), 640, mx(150), 790, { id: 'funnelR' }));
  add(seg(360, 782, 392, 782, { id: 'plungerFloor', e: 0.1 }));

  // Shooter-lane gate. Exists only for a DOWNWARD-moving ball, and slopes down to the left, so a
  // ball returning round the orbit is caught and rolled out into the playfield instead of dribbling
  // back to the plunger.
  add(seg(392, 224, 360, 262, { id: 'gate', e: 0.25, oneWay: [0, 1] }));

  // Left orbit lane + its one-way exit deflector (see the file header).
  add(seg(62, 224, 62, 344, { id: 'orbitWall' }));
  add(seg(62, 344, 120, 408, { id: 'orbitDeflect', e: 0.3, oneWay: [0, 1] }));

  // --- upper playfield -------------------------------------------------------------------------
  add(circle(140, 256, 27, { id: 'pop0', kick: 950, e: 0.45 }));
  add(circle(mx(140), 256, 27, { id: 'pop1', kick: 950, e: 0.45 }));
  // ...and the one the reference table puts DEAD CENTRE BELOW THE FLIPPERS, which is the layout's
  // single most distinctive idea: a ball that slips the flipper gap is thrown back into play about
  // half the time. It cannot seal the drain - the funnels leave a 95-unit channel down each side of
  // it - so the centre drain is still a real way to lose a ball, just no longer a certain one.
  add(circle(186, 706, 18, { id: 'pop2', kick: 700, e: 0.5 }));

  add(circle(164, 122, 7, { id: 'lanePost0', e: 0.6 }));
  add(circle(208, 122, 7, { id: 'lanePost1', e: 0.6 }));

  for (let i = 0; i < DROP_COUNT; i++) add(dropTarget(i));

  // The middle post arc. Rubber-sleeved, so they scatter rather than absorb.
  ARC_POSTS.forEach(([x, y], i) => add(circle(x, y, 5, { id: `arcPost${i}`, e: 0.62 })));

  // Stand-up targets, one per side wall, at the height the ball falls past on its way to the
  // outlane. They double as a soft outlane defence, which is deliberate.
  // Flush to the side walls (3 units of gap, well under a ball) so nothing can wedge behind them.
  add(seg(24, 430, 24, 464, { r: 5, e: 0.55, id: 'standL' }));
  add(seg(mx(24), 430, mx(24), 464, { r: 5, e: 0.55, id: 'standR' }));

  // Scoop rim.
  add(arc(SCOOP.x, SCOOP.y, SCOOP.rad, SCOOP.mouth + SCOOP.half, SCOOP.mouth - SCOOP.half + TAU,
    { id: 'scoopRim', e: 0.25, r: 4 }));

  // --- the teardrop centre ramp ----------------------------------------------------------------
  // Ring first (mouth pointing down at the flippers), then the two segments that close its pointed
  // top. Both segment ends sit ON the ring, so the joins OVERLAP into one convex blob rather than
  // leaving a V - a V between two convex surfaces is a permanent parking space for the ball.
  add(arc(DROP_RING.cx, DROP_RING.cy, DROP_RING.rad,
    DROP_RING.mouth + DROP_RING.half, DROP_RING.mouth - DROP_RING.half + TAU,
    { id: 'rampRing', e: 0.35, r: 4 }));
  const shoulderL = [DROP_RING.cx + DROP_RING.rad * Math.cos(210 * D), DROP_RING.cy + DROP_RING.rad * Math.sin(210 * D)];
  const shoulderR = [DROP_RING.cx + DROP_RING.rad * Math.cos(330 * D), DROP_RING.cy + DROP_RING.rad * Math.sin(330 * D)];
  add(seg(shoulderL[0], shoulderL[1], DROP_RING.apex[0], DROP_RING.apex[1], { r: 5, e: 0.4, id: 'rampSideL' }));
  add(seg(shoulderR[0], shoulderR[1], DROP_RING.apex[0], DROP_RING.apex[1], { r: 5, e: 0.4, id: 'rampSideR' }));

  // THERE ARE NO RAMP MOUTH GUIDES, AND THAT IS DELIBERATE. The first build funnelled the mouth
  // with two guides down at y=604 and it closed the table: each guide's outer end landed on the
  // slingshot's inner end, the two merged into one unbroken wall from the sling all the way to the
  // ramp, and the flippers could not be reached from the upper playfield at all. (A heat map of six
  // soak games had the entire lower centre blank and every ball draining down an outlane.) A real
  // ramp entrance is a bare mouth you have to hit; the 28 units of clear opening in the ring above
  // IS the shot, and the space beside it is how a ball gets down to the flipper.

  // --- lower playfield -------------------------------------------------------------------------
  // ONE divider per side, sloping down to the flipper pivot, and the slingshot well above it. That
  // ordering is the whole lower playfield and it is easy to get backwards: the OUTLANE is between
  // the side wall and the divider, the INLANE is between the divider and the slingshot, and the
  // ball rolls down the divider's UPPER face and off its end straight onto the flipper's base.
  //
  // The first attempt gave the inlane a second rail on its inner side, which put the inlane's exit
  // to the LEFT of the flipper pivot: a heat map of six soak games showed every ball rolling down
  // the inlane, missing the flipper entirely and falling into the drain. The lower centre of the
  // table was blank. One divider, ending ON the pivot, is the shape that works.
  //
  // That end deliberately OVERLAPS the pivot (7 apart against 12 of combined thickness). An end cap
  // sitting a few units clear of the pivot instead makes a narrow upward-facing V, and a V between
  // two convex surfaces is a STABLE resting place: an earlier soak parked the ball beside a pivot
  // for four minutes of game time, untouchable, because the contact point is the pivot itself where
  // the paddle's surface speed is exactly zero. Overlapping leaves one convex blob with no top.
  add(seg(46, 516, 112, 630, { r: 5, e: 0.4, id: 'divL' }));
  add(seg(mx(46), 516, mx(112), 630, { r: 5, e: 0.4, id: 'divR' }));
  // Slingshots: `kick` means a guaranteed outgoing speed, which is what the solenoid does. Their
  // distance from the teardrop is a CLEARANCE, not a look: the corridor between them is the only
  // route from the upper playfield down to a flipper, and it is 27 clear against a 21 ball.
  add(seg(86, 500, 124, 552, { r: 7, e: 0.4, kick: 1050, id: 'slingL' }));
  add(seg(mx(86), 500, mx(124), 552, { r: 7, e: 0.4, kick: 1050, id: 'slingR' }));

  if (opts.outlaneSaves) {
    // Casual seals each outlane, and WHERE it does that is the whole trick. Anything part-way DOWN
    // an outlane cannot work: an outlane is a dead end, so a blocker there has nowhere to send the
    // ball, and the soak duly parked balls in the corner for whole games. This post sits at the
    // outlane's MOUTH instead, OVERLAPPING both the side wall's clearance and the top of the
    // divider, so there is no gap and no V. The ball rolls over one convex blob and down the
    // divider's other face into the INLANE, which is exactly what a real outlane post does.
    add(circle(30, 512, 13, { id: 'savePostL', e: 0.55 }));
    add(circle(mx(30), 512, 13, { id: 'savePostR', e: 0.55 }));
  }

  const flippers = [
    flipper(AXIS - FLIP.dx, FLIP.pivotY, FLIP.len, FLIP.rest, FLIP.rest - FLIP.sweep,
      { id: 'flipL', r: FLIP.r, rTip: FLIP.rTip }),
    flipper(AXIS + FLIP.dx, FLIP.pivotY, FLIP.len, Math.PI - FLIP.rest, Math.PI - FLIP.rest + FLIP.sweep,
      { id: 'flipR', r: FLIP.r, rTip: FLIP.rTip }),
    // The upper pair. They share the two buttons with the mains (game.js's setFlipper presses both
    // on a side), which is how every real machine with an upper flipper wires it.
    flipper(FLIP.upX, FLIP.upPivotY, FLIP.upLen, FLIP.rest, FLIP.rest - FLIP.sweep,
      { id: 'flipUL', r: FLIP.upR, rTip: FLIP.upRTip }),
    flipper(mx(FLIP.upX), FLIP.upPivotY, FLIP.upLen, Math.PI - FLIP.rest, Math.PI - FLIP.rest + FLIP.sweep,
      { id: 'flipUR', r: FLIP.upR, rTip: FLIP.upRTip }),
  ];

  return { colliders, flippers };
}

/** The gap between the two main flipper tips, in BALL DIAMETERS, at either end of their sweep.
 *  Exported because it is the number Matt asked about and the number test.js asserts: prose in a
 *  header comment is not a check, and this table's flipper spacing has been wrong once already. */
export function flipperGap(pressed = false) {
  const ang = pressed ? FLIP.rest - FLIP.sweep : FLIP.rest;
  const tipDx = FLIP.dx - FLIP.len * Math.cos(ang);       // tip centre, inward from the axis
  return (2 * tipDx - 2 * FLIP.rTip) / (BALL_R * 2);
}

/** Everything the renderer needs that is not a collider: lamp positions, paint, labels. Kept here
 *  so the art and the physics read the same numbers (js/CLAUDE.md's standing complaint about
 *  duplicated geometry drifting apart). */
export const ART = {
  scoop: SCOOP,
  ring: DROP_RING,
  bank: { a: BANK_A, u: BANK_U, len: BANK_LEN, step: BANK_STEP, count: DROP_COUNT },
  pops: [[140, 256, 27], [mx(140), 256, 27], [186, 706, 18]],
  lanes: [[142, 128], [186, 114], [230, 128]],
  lanePosts: [[164, 122], [208, 122]],
  arcPosts: ARC_POSTS,
  slings: [[[86, 500], [124, 552]], [[mx(86), 500], [mx(124), 552]]],
  stands: [[[24, 430], [24, 464]], [[mx(24), 430], [mx(24), 464]]],
  savePosts: [[30, 512], [mx(30), 512]],
  rails: [[[46, 516], [112, 630]], [[mx(46), 516], [mx(112), 630]]],
  walls: [[[12, 224], [12, 520], [78, 640], [150, 790]],
    [[360, 262], [360, 790]],
    [[mx(12), 520], [mx(78), 640], [mx(150), 790]]],
  // The reference table's thin wire guides down onto the upper flippers. Habitrail wire ABOVE the
  // playfield, so they are paint only - as colliders they would cut the orbit lane in half.
  wires: [[[40, 230], [120, 334]], [[mx(40), 230], [mx(120), 334]]],
  star: [186, 336],
  // Painted lens arcs from the reference art: four above the post arc, four across the ramp face.
  lensArcs: [
    { key: 'top', pts: [[150, 328], [174, 318], [198, 318], [222, 328]] },
    { key: 'ramp', pts: [[164, 428], [178, 421], [194, 421], [208, 428]] },
  ],
  // Lamp inserts: small painted lenses that game.js lights. [x, y, key, rotation]
  inserts: [
    [186, 524, 'ramp', 0],
    [302, 362, 'scoop', 0],
    [186, 208, 'bank', 0],
    [37, 340, 'orbit', 0],
    [102, 574, 'inlaneL', 1.05],
    [mx(102), 574, 'inlaneR', -1.05],
    [63, 582, 'saveL', 1.05],
    [mx(63), 582, 'saveR', -1.05],
  ],
};

export default {
  W, H, DRAIN_Y, ARCH, AXIS, PLUNGER, FLIP, TEARDROP, SWITCHES, RAMP_PATH, RAMP_EXIT_V, RAMP_TIME,
  buildTable, flipperGap, ART, DROP_COUNT, BALL_R, MM_PER_UNIT,
};
