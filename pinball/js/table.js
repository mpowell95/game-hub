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

/**
 * Flipper geometry, shared with the renderer so the paddle art and the collider can never drift.
 *
 * `dx` IS 74 BECAUSE THE BALL HAS TO FIT BETWEEN THE TIPS, and at 71 it did not. Matt, on a clip
 * of the shipped build: *"It's impossible for the ball to go between the paddles"* - and the
 * footage shows exactly that, the ball sitting in the V between the two tips for frame after
 * frame, bouncing but never falling through.
 *
 * THE ARITHMETIC THAT WAS WRONG, because it is easy to get wrong the same way twice. The gap is
 * not the distance between the tip CENTRES: physics.js models the paddle as a capsule that tapers
 * to 65% of `r` at the tip, so each tip eats another 5.2 units. At dx 71 the centres were 27.8
 * apart and the clear gap was 17.4 - against a ball of 18. **0.97 balls.** The table could not
 * drain down the middle at all, which also means every "centre drain" the soak reported was a
 * ball going round the OUTSIDE of a flipper and the classifier mislabelling it.
 *
 * At dx 74 the clear gap is 23.4, or 1.30 balls. Real machines run 1.2 to 1.6.
 *
 * If you move `len`, `r` or `rest`, recompute it: gap = (2*dx - 2*len*cos(rest)) - 2*(0.65*r).
 * test.js asserts it, so the arithmetic lives there too and cannot drift again.
 */
export const FLIP = { len: 63, r: 8, rest: 25 * D, sweep: 52 * D, pivotY: 592, dx: 74 };

// --- switches (non-physical trigger regions) ---------------------------------------------------
// A switch is a circle the ball's CENTRE has to enter. game.js edge-detects entry, so a ball that
// parks inside one scores exactly once. `need` is an optional velocity gate.
export const SWITCHES = [
  { id: 'orbitTop', x: 174, y: 25, r: 18 },                     // crown of the arch channel
  { id: 'spinner', x: 25, y: 262, r: 15 },                      // left lane, on the orbit
  { id: 'laneH', x: 139, y: 84, r: 14 },
  { id: 'laneU', x: 174, y: 84, r: 14 },
  { id: 'laneB', x: 209, y: 84, r: 14 },
  { id: 'rampIn', x: 112, y: 432, r: 12, needUp: 300 },         // fast enough UP = made the ramp
  { id: 'scoop', x: 286, y: 206, r: 13, capture: true },        // saucer: holds the ball
  // Both pairs sit on the CENTRE-LINE of their own channel, computed from the divider and the
  // funnel either side of it. The first placement put outlaneR inside the funnel wall and
  // inlaneR on the flipper pivot, so a soak logged 18 outlane drains and zero outlane switches.
  { id: 'inlaneL', x: 88, y: 558, r: 13 },
  { id: 'inlaneR', x: mx(88), y: 558, r: 13 },
  { id: 'outlaneL', x: 63, y: 566, r: 12 },
  { id: 'outlaneR', x: mx(63), y: 566, r: 12 },
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
  [112, 436], [86, 392], [58, 330], [61, 240], [110, 172], [190, 158],
  [258, 196], [294, 268], [304, 352], [300, 432], [288, 492], [258, 528], [224, 548],
];
// A HABITRAIL HAS TO PUT THE BALL IN THE INLANE, NOT THE OUTLANE. The first routing ended at
// (262, 552), which is the middle of the right OUTLANE - so every made ramp posted the ball
// straight down the drain. A save-off soak scored ramp:10 and then drained 10 of its 12 balls
// within six units of the same spot on the right. The last four points curve the rail inboard,
// past the divider, so it lands at x 222 where the inlane feeds the flipper.
export const RAMP_EXIT_V = [-70, 200];    // along the right inlane, downhill toward the flipper
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
const SCOOP = { x: 286, y: 206, rad: 18, mouth: 2.25, half: 1.0 };

/** The three pop bumpers, in the model's triangle. `rad` is what the ball touches (the model's
 *  ring), not the wider skirt the renderer draws. */
const POPS = [[120, 200], [222, 196], [174, 258]];
const POP_R = 21;

/** The rollover lanes across the crown: three 35-wide channels between four dividers.
 *  DESIGN NOTE. The model draws two dividers and three lamps that are not centred on them (the lamp
 *  row starts at -0.088 and steps 0.044, so it sits half a lane left of the pair at -0.052/+0.052).
 *  Four dividers is what actually makes three lanes, so there are four, and the lamps are centred
 *  on them. */
const LANE_X = [121, 156, 191, 226];

export const ART_STANDS = [[[12, 328], [12, 364]], [[mx(12), 328], [mx(12), 364]]];

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

  add(seg(4, 174, 4, 486, { id: 'wallL', mu: 0 }));                // left cabinet
  add(seg(344, 174, 344, 650, { id: 'wallR', mu: 0 }));            // shooter lane, outer
  add(seg(310, 200, 310, 650, { id: 'wallPF', mu: 0 }));           // shooter lane inner = playfield right
  add(seg(310, 646, 344, 646, { id: 'plungerFloor', e: 0.1 }));
  // The two funnels. An outlane has to be a CONSTANT-WIDTH DIAGONAL channel, not a vertical one:
  // gravity here is straight down the screen, so a vertical channel delivers the ball nowhere and a
  // ball in it simply falls past the flipper. Both the outer wall and the divider inside it run at
  // the same angle, which is what feeds the inlane onto the flipper and the outlane into the drain.
  // Each funnel is TWO segments, and the kink at y 565 is not styling. Run as one straight line
  // to the drain it passes 18 units from the flipper pivot - exactly one ball - and a soak parked
  // 81% of all ball life in that crook, jittering between the funnel and the paddle's base. The
  // lower leg peels away so the gap is 26, comfortably more than a ball can sit in. The upper leg
  // stays parallel to the divider inside it, which is what holds the outlane at 1.2 balls.
  add(seg(4, 486, 46, 565, { id: 'funnelL', mu: 0 }));
  add(seg(46, 565, 52, 650, { id: 'funnelL2', mu: 0 }));
  add(seg(310, 486, 268, 565, { id: 'funnelR', mu: 0 }));
  add(seg(268, 565, 262, 650, { id: 'funnelR2', mu: 0 }));

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

  // THE ORBIT RETURN, and it is the difference between a shot and a leak. Without it the gate
  // drops the ball at x 296 and it falls straight down the right-hand wall into the right
  // outlane: a save-off soak measured 10 of 12 drains landing within six units of the same spot,
  // and every one of them had arrived that way. A real orbit does not return a ball to the drain,
  // it returns it to the pop bumpers - so this guide carries it down and inboard into the nest.
  //
  // IT IS ONE-WAY FOR THE SAME REASON THE GATE IS. A left-flipper shot up the right wall at the
  // scoop is travelling UP; a returning orbit ball is travelling DOWN. Built as a solid wall this
  // guide would block the scoop shot outright, which is one of the two shots the left flipper has.
  add(seg(300, 232, 250, 278, { id: 'orbitReturn', e: 0.3, mu: 0, oneWay: [0, 1] }));

  // Left orbit lane + its one-way exit deflector. The lane has to be enterable from below (that is
  // the orbit shot) while still spitting a RETURNING ball into the playfield rather than straight
  // into the outlane, and one collider does both.
  add(seg(46, 174, 46, 262, { id: 'orbitWall', mu: 0 }));
  add(seg(46, 262, 86, 308, { id: 'orbitDeflect', e: 0.3, mu: 0, oneWay: [0, 1] }));

  // --- upper playfield -------------------------------------------------------------------------
  for (let i = 0; i < POPS.length; i++) {
    add(circle(POPS[i][0], POPS[i][1], POP_R, { id: `pop${i}`, kick: 380, e: 0.45, mu: 0 }));
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
  add(seg(12, 328, 12, 364, { r: 5, e: 0.55, mu: 0, id: 'standL' }));
  add(seg(mx(12), 328, mx(12), 364, { r: 5, e: 0.55, mu: 0, id: 'standR' }));

  add(arc(SCOOP.x, SCOOP.y, SCOOP.rad, SCOOP.mouth + SCOOP.half, SCOOP.mouth - SCOOP.half + TAU,
    { id: 'scoopRim', e: 0.25, r: 4 }));

  // THE RAMP ENTRANCE IS A SLOT IN THE LEFT THIRD, NOT A FUNNEL IN THE CENTRE, AND BOTH halves
  // of that were measured. A centred entrance is in BOTH flippers' natural lane, so it eats every
  // shot and nothing else on the table is reachable; moved to the left third it becomes a
  // cross-shot for the RIGHT flipper and leaves the centre lane open to the drop bank, the pop
  // bumpers and the scoop. And a slot, not a funnel: The first version splayed from 70 units wide at the flipper line down to the
  // switch, which put a catchment the width of the whole centre lane directly above both
  // paddles. A 396-throw sweep of both flippers found the result: the ramp was made by 67% of
  // every shot, and the orbit, the spinner, the scoop, the rollover lanes, the pop bumpers and
  // the drop bank were reached by NONE of them - 0%, all six, from both flippers. Every rule in
  // game.js hangs off those shots, which is why a 45-second recording never once cleared the
  // drop bank and never left the opening objective.
  //
  // Parallel guides make it a target instead: a ball has to be travelling up INSIDE the slot to
  // enter, and anything at an angle is turned away into the playfield.
  add(seg(92, 476, 92, 420, { r: 5, id: 'rampGuideL', e: 0.35 }));
  add(seg(132, 476, 132, 420, { r: 5, id: 'rampGuideR', e: 0.35 }));

  // --- lower playfield -------------------------------------------------------------------------
  //
  // REBUILT 2026-09-07, and this is the single change that turned the table into a game. Before
  // it, a save-off soak measured a MEDIAN BALL LIFE OF 5.6 SECONDS and - the number that gave it
  // away - 18 drains split 12 left outlane / 6 right outlane / **0 down the middle**. A real
  // machine drains mostly down the middle; a table that only ever drains out the sides is not
  // hard, it is leaking. Tracing the last 1.5 s of every drain named the same three colliders
  // every time - wallL > divL > funnelL, over and over. The ball was not being beaten. It was
  // walking into an open bay above the outlane mouth and riding a smooth chute to the drain.
  //
  // THE MISSING PART WAS THE LANE GUIDE. The model draws its outlane wall curving INBOARD at the
  // top - its `outlane-wall-left` runs up to model (-0.150, 0.36), well clear of the cabinet edge
  // - and the first conversion straightened it against the wall and threw that curve away. With
  // it gone, everything between the standup target and the divider was open air, and a ball
  // drifting left at y 430-460 simply fell in. `laneGuideL/R` is that curve put back: a ball
  // coming down the side is steered onto the slingshot instead of into the outlane.
  //
  // THE OUTLANE IS STILL A REAL OUTLANE. It is entered through a slot between the slingshot's
  // outer post and the top of the divider - about 1.4 balls, angled down and out, so it takes a
  // ball genuinely going the wrong way. What it is no longer is a funnel.

  // Slingshots. `kick` means a guaranteed outgoing speed, which is what the solenoid does.
  // `kickN` is the face the coil is behind: up and INBOARD, toward the middle of the table. The
  // other face is the inlane's floor and must be dead. See physics.js's resolve().
  add(seg(58, 442, 122, 548, { r: 7, e: 0.4, mu: 0, kick: 400, kickN: [0.855, -0.516], id: 'slingL' }));
  add(seg(mx(58), 442, mx(122), 548, { r: 7, e: 0.4, mu: 0, kick: 400, kickN: [-0.855, -0.516], id: 'slingR' }));

  // The slingshot's outer post, and the lane guide running from the side wall onto it. Their
  // capsules OVERLAP on purpose (2.8 units apart against 11 of combined radius): a gap there is a
  // narrow upward-facing V, which is the classic parking space.
  add(circle(60, 436, 7, { id: 'slingPostL', e: 0.55 }));
  add(circle(mx(60), 436, 7, { id: 'slingPostR', e: 0.55 }));
  add(seg(8, 392, 36, 410, { r: 4, e: 0.45, mu: 0, id: 'laneGuideL' }));
  add(seg(mx(8), 392, mx(36), 410, { r: 4, e: 0.45, mu: 0, id: 'laneGuideR' }));

  // Inlane/outlane dividers, PARALLEL to the funnel outside them so the outlane holds about 1.2
  // balls for its whole length instead of fanning open at the bottom. Their lower ends overlap the
  // flipper pivots, which is what feeds the inlane onto the paddle.
  // THE TOP CAP IS DELIBERATELY SEALED AGAINST THE SIDE WALL - 15 units of gap against a ball of
  // 18. It was 17 for one build, and 17 is the worst number available: just under a ball, so the
  // ball cannot pass but can be squeezed, and a soak duly parked 23% of all ball life jammed in
  // that corner between the divider's end cap and the wall. Either seal a gap properly or open
  // it properly; never leave one a hair under a ball.
  add(seg(28, 452, 92, 593, { r: 5, e: 0.4, mu: 0, id: 'divL' }));
  add(seg(mx(28), 452, mx(92), 593, { r: 5, e: 0.4, mu: 0, id: 'divR' }));

  if (opts.outlaneSaves) {
    // Casual closes each outlane at its MOUTH, wedged between the slingshot's outer post and the
    // top of the divider, and rolls the ball into the INLANE - which is what a real outlane post
    // does. Anything part-way DOWN an outlane cannot work: an outlane is a dead end, so a blocker
    // there has nowhere to send the ball.
    add(circle(40, 440, 10, { id: 'savePostL', e: 0.55 }));
    add(circle(mx(40), 440, 10, { id: 'savePostR', e: 0.55 }));
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
  // EVERY BALL GUIDE THE RENDERER DRAWS, AS DATA. render.js used to carry its own copy of these
  // polylines, and after one geometry pass it was drawing the funnels and the side wall where
  // they used to be - a table whose paint and whose colliders disagree, which is the standing
  // complaint in js/CLAUDE.md about duplicated geometry drifting apart. There is one copy now,
  // and it is this one.
  // A HIERARCHY, NOT A UNIFORM SET OF STRIPES. Every rail was chrome and 8-9 wide, which put three
  // and four near-parallel light-grey lines down each side of the lower playfield - a striped cage
  // the ball disappeared into. Two rules now:
  //   - anything the CABINET already draws is not drawn twice. The left wall from the arch down to
  //     the funnel, and the whole right cabinet edge, were duplicates of the cabinet band running
  //     alongside it at a different height.
  //   - STRUCTURE is steel (darker, recessive); a guide the BALL RIDES is chrome (bright). So the
  //     lanes read and the walls do not compete.
  rails: [
    { pts: [[4, 470], [46, 565], [52, 650]], w: 7, mat: 'steel' },              // left funnel
    { pts: [[310, 200], [310, 650]], w: 8, mat: 'steel' },                      // shooter lane, inner
    { pts: [[310, 470], [268, 565], [262, 650]], w: 7, mat: 'steel' },          // right funnel
    { pts: [[46, 174], [46, 262], [86, 308]], w: 8, mat: 'steel' },             // left orbit lane
    { pts: [[8, 392], [36, 410]], w: 7, mat: 'steel' },                         // lane guide, left
    { pts: [[mx(8), 392], [mx(36), 410]], w: 7, mat: 'steel' },                 // lane guide, right
    { pts: [[92, 476], [92, 420]], w: 9, mat: 'chrome' },                       // ramp entrance
    { pts: [[132, 476], [132, 420]], w: 9, mat: 'chrome' },
  ],
  gate: [[344, 174], [296, 216]],
  orbitReturn: [[300, 232], [250, 278]],
  bank: { a: BANK_A, u: BANK_U, len: BANK_LEN, step: BANK_STEP, count: DROP_COUNT },
  pops: POPS,
  popR: POP_R,
  lanes: [[139, 84], [174, 84], [209, 84]],
  laneX: LANE_X,
  slings: [[[58, 442], [122, 548]], [[mx(58), 442], [mx(122), 548]]],
  slingPosts: [[60, 436], [mx(60), 436]],
  laneGuides: [[[8, 392], [36, 410]], [[mx(8), 392], [mx(36), 410]]],
  stands: ART_STANDS,
  divs: [[[28, 452], [92, 593]], [[mx(28), 452], [mx(92), 593]]],
  savePosts: [[40, 440], [mx(40), 440]],
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
    [112, 392, 'ramp', 0],
    [278, 254, 'scoop', 0],
    [152, 352, 'bank', 0],
    [25, 330, 'orbit', 0],
    [88, 558, 'inlaneL', 1.0],
    [mx(88), 558, 'inlaneR', -1.0],
    [63, 528, 'saveL', 0],
    [mx(63), 528, 'saveR', 0],
  ],
};

export default {
  W, H, DRAIN_Y, ARCH, AXIS, PLUNGER, FLIP, SWITCHES, RAMP_PATH, RAMP_EXIT_V, RAMP_TIME,
  buildTable, ART, DROP_COUNT, BALL_R, K, mdlX, mdlY,
};
