// pinball/js/table.js - the playfield itself: every wall, post, bumper, target and switch, in one
// place, as pure data. No DOM, no canvas, no rules. physics.js pushes the ball around this; game.js
// decides what each contact is worth; render.js draws it.
//
// THIS IS THE ATTACHED PLAYFIELD DESIGN (2026-09-06), converted. Matt supplied a three.js model of
// a machine - deck outline, arch, three pop bumpers, two slingshots, a drop bank, standups, a
// spinner, a scoop, a violet U-channel loop ramp with support legs, a left wireform return, a
// sixteen-lamp rosette, top rollover lanes, posts with rubber, arrow inserts, plunger and apron -
// and it replaces STARHUB's old layout entirely. What follows is that model in this engine's
// coordinates, plus the handful of places the conversion had to make a decision. Those are all
// marked "DESIGN NOTE" and each says what the model showed and why the table does something else.
//
// THE CONVERSION. The model works in metres with y up: x is across (-0.26 .. 0.26), y is up-field
// (0 at the flipper line, 1.04 at the crown of the arch), h is height above the deck. This engine
// works in table units with y DOWN. So:
//
//     table_x = 174 + 666.67 * model_x        table_y = 694 - 666.67 * model_y
//
// 666.67 units per model metre is not arbitrary: the model's ball is 0.027 across and this engine's
// is 18 units, so that factor is what makes the two the same ball. Everything else follows, and the
// table comes out 348 x 694 - which is 19.3 balls across, against a real machine's 19.0. The
// proportions are the model's, honestly scaled.
//
// COORDINATES. 348 x 694 units, y DOWN, so gravity is +y and the flippers are at large y. A ball is
// 18 units across, which is the number every clearance below is checked against: any channel meant
// to pass a ball is at least 26 wide, and anything narrower than 18 is deliberately sealed.
//
// TWO CENTRE LINES, AND THEY ARE NOT THE SAME. The arch is centred on the CABINET (ARCH.cx = 174)
// because it has to span the shooter lane too. The lower playfield is centred on the PLAY AREA
// (AXIS = 157), because the shooter lane eats the right-hand 38 units and the flippers belong in
// the middle of what is left. Every left/right pair below the arch is `x` and `314 - x`. The model
// mirrors everything about the cabinet centre and lets the shooter lane overlap the right outlane;
// that cannot work in a solver, so the lower playfield is shifted 17 units left as one piece.
//
// THE SHOT MAP (the part worth understanding before moving anything):
//
//        .-------------------------------------.
//        |        H   U   B   rollover lanes   |  the arch is a real 34-wide channel between
//        |    /      (o)       (o)      \      |  rIn 128 and rOut 170: the plunger fires INTO
//        |   |  spin      (o)      scoop |     |  it, a left-orbit shot runs the whole way
//        |   |     [drop bank]           |     |  round, and the one-way gate at the top right
//        |   \  \deflect   RAMP loop     |     |  drops a returning ball into the playfield
//        |    stand      (rosette)      stand  |  instead of back down the shooter lane
//        |      \  sling      sling  /         |
//        |       \  \ inlane  /  /             |  plunger
//        |         \_[  ]  [  ]_/              |  lane -->
//        '-------------- drain ----------------'
//
//   LEFT FLIPPER  -> the RAMP (centre) and the SCOOP (up the right wall).
//   RIGHT FLIPPER -> the RAMP, the DROP BANK (up the middle, inside the ramp loop), and the LEFT
//                    ORBIT, which runs up the left lane past the spinner, round the arch, and back
//                    into the playfield.
//   BUMPER KICKOUTS -> the three H-U-B rollover lanes across the crown.
//
//   The RAMP is the model's violet U-channel and it loops round EVERYTHING: up the middle, out to
//   the left, over the top and down the right. It is elevated, so it crosses the left lane, the
//   drop bank and the rosette without any of them caring - render.js draws it translucent for
//   exactly that reason.
//
// WEDGES. Two convex surfaces a little under one ball apart used to make a permanent parking space
// on this table, and four of them shipped in the old layout. physics.js's `escapeWedge` now lets a
// pinched ball out on its own, so the geometry below is no longer one wrong number away from a dead
// game - but the clearances are still checked, because a ball that has to escape a pinch every
// twenty seconds is a table that feels wrong even when it is not broken. `node pinball/js/test.js`
// asserts them.

import { seg, circle, arc, flipper, BALL_R } from './physics.js';

export const W = 348;
export const H = 694;
export const DRAIN_Y = 650;
export { BALL_R };

const TAU = Math.PI * 2;
const D = Math.PI / 180;

/** Model-to-table conversion, exported so the renderer and any future tool can use the same one. */
export const K = 666.67;
export const mdlX = (x) => 174 + K * x;
export const mdlY = (y) => 694 - K * y;

/** The arch, centred on the CABINET. `rOut` is the deck's own edge (the model's outline arc);
 *  `rIn` is the model's `orbit-wall-inner`, which makes the crown a real 34-wide lane. */
export const ARCH = { cx: 174, cy: 174, rOut: 170, rIn: 128 };

/** Lower-playfield mirror axis. The shooter lane eats the right edge, so the play area is 8..306
 *  and its centre is 157, NOT 174. Every left/right pair below is `x` and `314 - x`. */
export const AXIS = 157;
const mx = (x) => 314 - x;

/** `minV` is deliberately just under the speed needed to clear the arch: a stab at the plunger
 *  dribbles back down the lane and has to be re-plunged, a normal pull makes the orbit. That is the
 *  whole plunger skill curve, and it only works because a dribbled ball is handed straight back to
 *  the plunger (game.js's shooter-lane rest check) rather than sitting there dead.
 *  The gate is v^2/2g against GRAVITY 515 over the 570 units from the plunger to the crown, which
 *  needs 766 u/s: 700 fails, and anything past about 800 makes it. */
export const PLUNGER = { x: 327, y: 622, minV: 700, maxV: 1120, laneX: 300 };

/** Flipper geometry, shared with the renderer so the paddle art and the collider can never drift.
 *  The model's flippers are 0.095 long with their pivots 0.212 apart, which is a modern long-flipper
 *  machine: 63 units of paddle and a 28-unit gap between the tips at rest, or 1.55 balls. Real
 *  machines run 1.3 to 1.6. */
export const FLIP = { len: 63, r: 8, rest: 25 * D, sweep: 52 * D, pivotY: 592, dx: 71 };

// --- switches (non-physical trigger regions) ---------------------------------------------------
// A switch is a circle the ball's CENTRE has to enter. game.js edge-detects entry, so a ball that
// parks inside one scores exactly once. `need` is an optional velocity gate.
export const SWITCHES = [
  { id: 'orbitTop', x: 174, y: 25, r: 18 },                     // crown of the arch channel
  { id: 'spinner', x: 25, y: 262, r: 15 },                      // left lane, on the orbit
  { id: 'laneH', x: 139, y: 84, r: 14 },
  { id: 'laneU', x: 174, y: 84, r: 14 },
  { id: 'laneB', x: 209, y: 84, r: 14 },
  { id: 'rampIn', x: 157, y: 512, r: 17, needUp: 150 },         // fast enough UP = made the ramp
  { id: 'scoop', x: 288, y: 150, r: 11, capture: true },        // saucer: holds the ball
  { id: 'inlaneL', x: 80, y: 545, r: 13 },
  { id: 'inlaneR', x: mx(80), y: 545, r: 13 },
  { id: 'outlaneL', x: 46, y: 570, r: 12 },
  { id: 'outlaneR', x: mx(46), y: 570, r: 12 },
];

/** The habitrail the ramp shot rides: a scripted path, not physics. Entering the mouth fast enough
 *  (`needUp`) hands the ball to this spline for RAMP_TIME and drops it into the right inlane, which
 *  is how every real ramp behaves and is far kinder than trying to simulate a banked wire in 2D.
 *
 *  These eleven points ARE the model's `rampCurve`, converted - it is the violet U-channel that
 *  climbs from the centre of the playfield, loops anticlockwise round the whole upper table and
 *  comes down the right. The last two points are ours: the model's channel simply stops at the
 *  right-hand descent, and a ramp has to put the ball somewhere, so it carries on to the right
 *  inlane. It is drawn ELEVATED (support legs, in the model and in render.js) which is why it may
 *  cross the left lane, the drop bank and the rosette without any of them caring. */
export const RAMP_PATH = [
  [157, 517], [137, 474], [94, 407], [55, 321], [61, 227], [122, 164],
  [204, 161], [267, 217], [298, 311], [302, 407], [298, 474], [286, 522], [262, 552],
];
export const RAMP_EXIT_V = [-96, 210];    // along the right inlane, downhill toward the flipper
export const RAMP_TIME = 1.5;             // seconds end to end; it is a long loop

/** Drop target bank: three targets on one diagonal in the upper left, fed by the RIGHT flipper.
 *  DESIGN NOTE. The model puts its three drop targets across the top centre at model y 0.855,
 *  directly under the rollover lanes at 0.905 - which in a solver is a wall across the lane exits,
 *  so the ball can never reach the lanes the model also draws. The bank keeps its three targets and
 *  its angle and moves INSIDE the ramp loop, into the one genuinely empty band on the upper
 *  playfield: between the pop bumpers above it and the rosette below. Outside the loop there is
 *  nowhere for it to go that the ramp does not fly straight over - the first placement, in the
 *  upper left, put all three targets underneath the ramp's left descent, and a screenshot showed
 *  them simply not there. */
const BANK_A = [118, 298], BANK_U = [0.95, 0.31], BANK_LEN = 18, BANK_STEP = 30;
export const DROP_COUNT = 3;

function dropTarget(i) {
  const s = i * BANK_STEP;
  return seg(
    BANK_A[0] + BANK_U[0] * s, BANK_A[1] + BANK_U[1] * s,
    BANK_A[0] + BANK_U[0] * (s + BANK_LEN), BANK_A[1] + BANK_U[1] * (s + BANK_LEN),
    { r: 4.5, e: 0.5, mu: 0, id: `drop${i}` },
  );
}

/** The scoop rim: a near-closed ring with its mouth pointing DOWN AND LEFT, so a left-flipper shot
 *  up the right wall feeds it. Opening half-width 0.85 rad leaves a 24-unit gap, just over one ball.
 *  DESIGN NOTE. The model's scoop sits at (0.152, 0.905), which converts to a point inside the arch
 *  CHANNEL rather than on the playfield - the model's two concentric horseshoes leave it in the
 *  lane. It moves 60 units down-field onto the playfield proper, where the one-way gate feeds it
 *  from the orbit and the left flipper can reach it up the right wall. */
const SCOOP = { x: 288, y: 150, rad: 21, mouth: 2.25, half: 0.85 };

/** The three pop bumpers, in the model's triangle. `rad` is what the ball touches (the model's
 *  ring), not the wider skirt the renderer draws. */
const POPS = [[120, 200], [228, 200], [174, 258]];
const POP_R = 21;

/** The rollover lanes across the crown: three 35-wide channels between four dividers.
 *  DESIGN NOTE. The model draws two dividers and three lamps that are not centred on them (the lamp
 *  row starts at -0.088 and steps 0.044, so it sits half a lane left of the pair at -0.052/+0.052).
 *  Four dividers is what actually makes three lanes, so there are four, and the lamps are centred
 *  on them. */
const LANE_X = [121, 156, 191, 226];

export const ART_STANDS = [[[12, 396], [12, 428]], [[mx(12), 396], [mx(12), 428]]];

/**
 * Build a fresh set of colliders + flippers.
 * @param {{ outlaneSaves?: boolean }} opts  `outlaneSaves` adds the Casual-only posts that close
 *        both outlane mouths. They are real, visible, physical posts rather than a hidden
 *        "sometimes the ball comes back" fudge, so what saved you is always legible.
 */
export function buildTable(opts = {}) {
  const colliders = [];
  const add = (c) => { colliders.push(c); return c; };

  // --- outer shell -----------------------------------------------------------------------------
  // The deck's own arch is the orbit lane's OUTER wall. The model draws a third concentric wall
  // between them at 0.212, which would leave a 38-unit channel with nothing in it and no way out;
  // collapsing the two into one 34-wide lane is what the model's own art reads as anyway.
  add(arc(ARCH.cx, ARCH.cy, ARCH.rOut, Math.PI, TAU, { id: 'archOut', e: 0.4, mu: 0 }));
  // The inner arch stops 12 degrees short of the right horizontal: that gap IS the orbit's exit.
  add(arc(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 12 * D, { id: 'archIn', e: 0.4, mu: 0 }));

  add(seg(4, 174, 4, 500, { id: 'wallL', mu: 0 }));                // left cabinet
  add(seg(344, 174, 344, 650, { id: 'wallR', mu: 0 }));            // shooter lane, outer
  add(seg(310, 200, 310, 650, { id: 'wallPF', mu: 0 }));           // shooter lane inner = playfield right
  add(seg(310, 646, 344, 646, { id: 'plungerFloor', e: 0.1 }));
  // The two funnels. An outlane has to be a CONSTANT-WIDTH DIAGONAL channel, not a vertical one:
  // gravity here is straight down the screen, so a vertical channel delivers the ball nowhere and a
  // ball in it simply falls past the flipper. Both the outer wall and the divider inside it run at
  // the same angle, which is what feeds the inlane onto the flipper and the outlane into the drain.
  add(seg(4, 500, 66, 646, { id: 'funnelL', mu: 0 }));
  add(seg(310, 500, 248, 646, { id: 'funnelR', mu: 0 }));

  // Shooter-lane gate. Exists only for a DOWNWARD-moving ball, and slopes down to the left, so a
  // launch passes through it going up and a ball returning round the orbit is caught and rolled out
  // into the playfield instead of dribbling back to the plunger.
  //
  // ITS LOW END STOPS 14 UNITS SHORT OF `wallPF`, AND THAT GAP IS THE WHOLE POINT. The first
  // version ended ON that wall, which made the two into a closed corner: every ball that completed
  // the orbit rolled down the gate, hit the wall and PARKED there. A soak measured 20% of all ball
  // life sitting in it, with the orbit, the spinner and the scoop scoring literally zero across five
  // games, and the only thing that ever got the ball out was the ball-search shove. Ending short
  // lets the ball roll off into the playfield - and 14 units against a ball of 18 plus two wall
  // radii is still far too narrow for a descending ball to slip back down the lane, so the gate
  // loses nothing by not touching.
  add(seg(344, 174, 296, 216, { id: 'gate', e: 0.25, mu: 0, oneWay: [0, 1] }));

  // Left orbit lane + its one-way exit deflector. The lane has to be enterable from below (that is
  // the orbit shot) while still spitting a RETURNING ball into the playfield rather than straight
  // into the outlane, and one collider does both.
  add(seg(46, 174, 46, 262, { id: 'orbitWall', mu: 0 }));
  add(seg(46, 262, 86, 308, { id: 'orbitDeflect', e: 0.3, mu: 0, oneWay: [0, 1] }));

  // --- upper playfield -------------------------------------------------------------------------
  for (let i = 0; i < POPS.length; i++) {
    add(circle(POPS[i][0], POPS[i][1], POP_R, { id: `pop${i}`, kick: 330, e: 0.45, mu: 0 }));
  }

  // Each divider's top is carried 3 units INTO the inner arch. A divider that stops a few units
  // short of it makes a narrow upward-facing V, which is the classic parking space; overlapping
  // them leaves one convex blob, which has no stable top.
  LANE_X.forEach((x, i) => {
    const top = ARCH.cy - Math.sqrt(ARCH.rIn * ARCH.rIn - (x - ARCH.cx) * (x - ARCH.cx)) + 3;
    add(seg(x, 108, x, top, { r: 4, e: 0.5, mu: 0, id: `lanePost${i}` }));
  });

  for (let i = 0; i < DROP_COUNT; i++) add(dropTarget(i));

  // Stand-up targets, one per side, FLUSH to the side walls (their capsules overlap the wall's, so
  // there is no V behind them for a ball to sit in). They double as a soft outlane defence.
  add(seg(12, 396, 12, 428, { r: 5, e: 0.55, mu: 0, id: 'standL' }));
  add(seg(mx(12), 396, mx(12), 428, { r: 5, e: 0.55, mu: 0, id: 'standR' }));

  add(arc(SCOOP.x, SCOOP.y, SCOOP.rad, SCOOP.mouth + SCOOP.half, SCOOP.mouth - SCOOP.half + TAU,
    { id: 'scoopRim', e: 0.25, r: 4 }));

  // Ramp mouth guides: a funnel wide at the bottom, one ball across at the switch.
  add(seg(122, 558, 142, 502, { id: 'rampGuideL', e: 0.35 }));
  add(seg(192, 558, 172, 502, { id: 'rampGuideR', e: 0.35 }));

  // --- lower playfield -------------------------------------------------------------------------
  // Slingshots first: `kick` means a guaranteed outgoing speed, which is what the solenoid does.
  add(seg(64, 456, 124, 556, { r: 7, e: 0.4, mu: 0, kick: 400, id: 'slingL' }));
  add(seg(mx(64), 456, mx(124), 556, { r: 7, e: 0.4, mu: 0, kick: 400, id: 'slingR' }));

  // Inlane/outlane dividers, near-parallel to the side wall so the outlane stays about 1.2 balls
  // wide for its whole length rather than fanning open at the bottom.
  add(seg(34, 478, 87, 604, { r: 5, e: 0.4, mu: 0, id: 'divL' }));
  add(seg(mx(34), 478, mx(87), 604, { r: 5, e: 0.4, mu: 0, id: 'divR' }));

  if (opts.outlaneSaves) {
    // Casual closes each outlane, and WHERE it does that is the whole trick. Anything part-way DOWN
    // an outlane cannot work: an outlane is a dead end, so a blocker there has nowhere to send the
    // ball. These sit at the outlane's MOUTH, wedged between the side wall and the top of the
    // divider, and roll the ball into the INLANE - which is what a real outlane post does.
    add(circle(20, 466, 10, { id: 'savePostL', e: 0.55 }));
    add(circle(mx(20), 466, 10, { id: 'savePostR', e: 0.55 }));
  }

  const flippers = [
    flipper(AXIS - FLIP.dx, FLIP.pivotY, FLIP.len, FLIP.rest, FLIP.rest - FLIP.sweep, { id: 'flipL', r: FLIP.r }),
    flipper(AXIS + FLIP.dx, FLIP.pivotY, FLIP.len, Math.PI - FLIP.rest, Math.PI - FLIP.rest + FLIP.sweep, { id: 'flipR', r: FLIP.r }),
  ];

  return { colliders, flippers };
}

/** Everything the renderer needs that is not a collider: lamp positions, paint, labels. Kept here
 *  so the art and the physics read the same numbers. Field names follow the model's own part names
 *  wherever it has one. */
export const ART = {
  scoop: SCOOP,
  bank: { a: BANK_A, u: BANK_U, len: BANK_LEN, step: BANK_STEP, count: DROP_COUNT },
  pops: POPS,
  popR: POP_R,
  lanes: [[139, 84], [174, 84], [209, 84]],
  laneX: LANE_X,
  slings: [[[64, 456], [124, 556]], [[mx(64), 456], [mx(124), 556]]],
  stands: ART_STANDS,
  divs: [[[34, 478], [87, 604]], [[mx(34), 478], [mx(87), 604]]],
  savePosts: [[20, 466], [mx(20), 466]],
  spinner: { x: 25, y: 262, w: 30 },
  // The model's sixteen-lamp rosette, the one piece of pure paint big enough to name. Decorative:
  // no collider, the ramp flies over it.
  rosette: { x: 174, y: 427, r: 52, lamps: 16 },
  // The model's `return-rail` wireform: a chrome habitrail down the left. Decorative here - the
  // RAMP_PATH above is the one the ball actually rides - but it is what the model draws and it is
  // what makes the left of the table read as a machine rather than as paint.
  wireform: [[126, 168], [96, 214], [80, 262], [76, 306]],
  // Posts with rubber, from the model's own list, converted.
  posts: [[89, 464], [mx(89), 464], [139, 377], [209, 377], [75, 204], [273, 204]],
  // Lamp inserts: small painted lenses that game.js lights. [x, y, key, rotation]
  inserts: [
    [157, 468, 'ramp', 0],
    [288, 196, 'scoop', 0],
    [152, 352, 'bank', 0],
    [25, 330, 'orbit', 0],
    [80, 545, 'inlaneL', 1.0],
    [mx(80), 545, 'inlaneR', -1.0],
    [46, 545, 'saveL', 0],
    [mx(46), 545, 'saveR', 0],
  ],
};

export default {
  W, H, DRAIN_Y, ARCH, AXIS, PLUNGER, FLIP, SWITCHES, RAMP_PATH, RAMP_EXIT_V, RAMP_TIME,
  buildTable, ART, DROP_COUNT, BALL_R, K, mdlX, mdlY,
};
