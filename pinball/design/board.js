// board.js — pinball playfield. three.js primitives only, no assets.
// export buildBoard(THREE) -> THREE.Group   (every mesh + material named)
// export LEVELS, TRANSITIONS, FOOTPRINTS, BALL_DIAMETER, PX (for the 2D engine)
//
// Units: meters, y-up, origin at table center, base at y=0.
// Top-down 2D coords used by the engine: (x, z). +x = right, +z = toward player.
// Level 1 (main playfield) surface y = 0.020, runs the full cabinet length (also under the deck).
// Level 2 (upper deck) surface y = 0.070, semi-transparent, covers the top section only.
//
// Layout is authored in reference-image pixels (986 x 1990) and converted with PX():
//   x = (px - 493) * 0.000527,  z = (py - 995) * 0.000527   (table 0.52 m x 1.05 m)

import { LAYOUT, REMOVED, ADDED } from './layout.js';

export const VERSION = 'v7 — Matt\'s editor layout, applied from layout.js';
export const BALL_DIAMETER = 0.027;
const S = 0.000527, CX = 493, CY = 995;
export const PX = (px, py) => [r4((px - CX) * S), r4((py - CY) * S)];
const M = 986;                       // mirror helper: px -> M - px
const Y1 = 0.02, Y2 = 0.07;   // deck underside at 0.058 -> 0.038 m clearance for the L1 ball passing beneath
function r4(v) { return Math.round(v * 1e4) / 1e4; }

// ---------------------------------------------------------------- layout
// levels: [1], [2], [1,2] = colliding on those levels; [] = decoration
const P = [];
const wall  = (name, a, b, t, h, y0, mat, levels, note) => P.push({ type: 'wall', name, a, b, t, h, y0, mat, levels, note });
/** A ONE-WAY GATE: a wall that only exists for a ball travelling the forbidden way. `oneWay` is a
 *  unit normal in TABLE axes (+x right, +y down-field); the gate blocks a ball whose velocity has
 *  a positive component along it and is not there at all for one going the other way. This is the
 *  sprung metal flap every real machine has at the top of its shooter lane, and js/physics.js has
 *  had the mechanism since STARHUB - see `oneWay` there. */
const gate  = (name, a, b, t, h, y0, mat, levels, oneWay, note) => P.push({ type: 'gate', name, a, b, t, h, y0, mat, levels, oneWay, note });
const post  = (name, at, r, h, y0, mat, levels) => P.push({ type: 'post', name, at, r, h, y0, mat, levels });
const disc  = (name, at, r, y0, mat, lit) => P.push({ type: 'disc', name, at, r, y0, mat, lit, levels: [] });
const mirror2 = (fn) => fn(false) || fn(true);

// cabinet
P.push({ type: 'base', name: 'cabinet_floor', levels: [] });
// PUT BACK where it was. It was moved (+20, -40) in the layout editor and Matt read that as a
// stray drag rather than an intention - the sheet had ended up 20 px right and 40 px high of the
// cabinet around it, because every wall and post stayed put. The editor is the thing that got
// fixed, not this line: a tap on a phone was starting a drag.
P.push({ type: 'poly', name: 'playfield_L1', pts: [[45,40],[955,40],[955,1750],[891,1750],[891,1650],[600,1880],[390,1880],[45,1650]], y0: 0.004, d: Y1 - 0.004, mat: 'maple', levels: [] });
// THE UPPER DECK SLAB IS DELETED. It was the translucent sheet the top section stood on - render
// only, `levels: []`, so level 2 still exists in the physics exactly as before and the ball still
// rides it. What is gone is the floor you could see under it.
wall('wall_left',   [22.5, 0],   [22.5, 1990], 45 * S, 0.09, 0, 'darkwood', [1, 2]);
// THE BOARD'S RIGHT WALL, AND THE FEED GAP AT THE TOP OF IT.
//
// Matt, on the shipped build: *"The ball goes up the launch chute then magically appears on the
// other side of the wood wall."* It did: the wall ran the full 1990 px, so the chute was a
// closed tube and the only way out of it was to move the ball by hand.
//
// A real shooter lane is not a tube. It ends at the top of the cabinet and the ball rolls out of
// it into the playfield over the top of the board's own side wall. So the wall stops at py 300
// ON LEVEL 2 - the deck - and the ball rides the chute the whole way up under its own power,
// meets the top wall, and turns left onto the deck through a real opening. Nothing is teleported.
//
// It stays FULL LENGTH ON LEVEL 1, because level 1 is the lower playfield and a ball down there
// has no business in the shooter lane.
wall('wall_right',       [963.5, 300], [963.5, 1990], 45 * S, 0.09, 0, 'darkwood', [1, 2], 'the playing board ENDS here; its outboard face is the launch chute left wall');
wall('wall_right_upper', [963.5, 0],   [963.5, 300],  45 * S, 0.09, 0, 'darkwood', [1],    'closed on L1; gated on L2, which is the shooter lane feed');
// THE FEED IS A ONE-WAY GATE, NOT A HOLE. Matt, on 47 seconds of play in which the ball did almost
// nothing else: *"I just hit the ball all the way back down the chute... OBVIOUSLY this should be
// impossible."* He is right, and this repo already knew it: STARHUB's own shooter lane has had
// exactly this gate since the day it was built, and `pinball/CLAUDE.md` describes it - *the
// shooter-lane gate exists only for a DOWNWARD-moving ball, so a launch passes through it and a
// returning ball is caught*. Opening a plain gap here made the lane a two-way corridor, so every
// ball that reached the deck rolled straight back into the chute and fell the whole way down.
//
// It blocks +x (a ball heading back toward the chute) and does not exist for -x (a ball leaving it).
gate('chute_gate', [963.5, 40], [963.5, 300], 0.010, 0.05, Y2, 'steel', [2], [1, 0], 'the shooter lane flap: out onto the deck yes, back into the chute never');
// THE FEED ITSELF. A gap alone is not a feed: traced, a plunged ball rose the full length of the
// chute at x 1020, hit the top wall square on and came straight back down, twelve times. Every
// real machine has a curved guide across the top of the shooter lane that turns the ball into the
// playfield, and this is it - a diagonal on level 2 only, so the lower playfield never sees it.
wall('chute_feed', [1076, 210], [968, 60], 0.006, 0.03, Y2, 'steel', [2], 'turns a rising plunge left, out of the lane and onto the deck');
// 60 px, not 40: Matt thickened it in the layout editor.
wall('wall_top',    [0, 20],     [1100, 20],   60 * S, 0.09, 0, 'darkwood', [1, 2]);
// THE DRAIN HAS TO BE A GAP, NOT A NOTE. This wall ran the full width with a comment saying the
// band x 390..600 was the drain - so in the solver the ball landed on it and stopped. Played, that
// is 861 of 1008 dropped balls coming to rest along the bottom wall and NOT ONE draining. This
// repo already has the lesson written down: ROYAL FLUSH did exactly this, scored normally and
// never drained once in four games, because a kill zone built as a collider is a floor.
wall('wall_bottom_left',  [0, 1970],   [390, 1970],  40 * S, 0.09, 0, 'darkwood', [1]);
wall('wall_bottom_right', [600, 1970], [1100, 1970], 40 * S, 0.09, 0, 'darkwood', [1], 'the 210 px between the two is the DRAIN');

/**
 * THE LAUNCH CHUTE IS BESIDE THE BOARD, NOT PART OF IT.
 *
 * Matt: *"the chute is BESIDE the game board. NOT part of it. The left wall of the chute is the
 * rightmost - final - wall of the actual playing board... Create the full board without the launch
 * chute. Then stick the launch chute onto the right side. Stop factoring it into the board."*
 *
 * Three builds went wrong because the chute was carved OUT of the playfield's width. It was not a
 * placement problem: measured, the strip between the arch's right leg (x 866 at the deck edge) and
 * the board's own right wall is 89 px, and a ball needs about 57 - so a chute taken out of that
 * strip left no room for the right ramp, and every attempt ended with the two stacked on top of
 * each other. The strip is the RIGHT RAMP'S LANE and nothing else. The chute hangs off the OUTSIDE
 * of the board's right wall, in its own channel, and the cabinet is that much wider.
 */
// 1068, not 1052. Measured with the ball: the board wall face is at x 986 and this wall face was
// at 1032, so the chute was a 46 px channel against a 51 px ball - it could not fit down its own
// launch lane, and a traced plunge climbed 34 px and stopped. ROYAL FLUSH shipped this identical
// bug twice. At 1075 the channel is 69 px = 0.036 m of clear lane, which leaves the ball 18 px of
// sideways freedom rather than 11 - a plunge fired even slightly off centre still climbs it.
wall('chute_wall_outer', [1075, 20], [1075, 1970], 40 * S, 0.09, 0, 'darkwood', [1, 2], 'the cabinet edge, outboard of the launch chute');
wall('apron_edge_left',  [45, 1650],  [390, 1880], 0.006, 0.03, Y1, 'darkwood', [1]);
// 941, not 891. The apron's left edge starts flush against the left wall (x 45) and its right edge
// started 50 px short of the right one, leaving an open notch in the bottom-right corner that a
// ball could sit in - and 941 is 45's exact mirror.
wall('apron_edge_right', [941, 1650], [600, 1880], 0.006, 0.03, Y1, 'darkwood', [1]);
// upper-deck front lip (V ledge) — a lip on the deck edge, L2 only; the deck is open underneath. Gap 455..545 px = drop hole
// The V ledge now starts at the INNER edge of each ramp mouth, so the mouth is a real opening in
// the deck edge rather than a hole behind a lip.
// THE FRONT OF THE DECK IS AN EDGE, NOT A BARRIER. Matt: *"you put a horizontal wall where there
// should just be an edge - no barrier of any kind - under the top paddles."* There were four walls
// there (ledge_left/right and their two extensions) making a continuous lip right across the deck
// with one 90 px hole in it, so a ball that rolled down the deck stopped on the lip - 67 of them
// on a rest sweep - instead of simply falling off the front.
//
// Nothing is built there now. js/design.js drops a deck ball to level 1 once it is past py 760,
// which IS the edge: the ball rolls off the front of the raised deck and lands on the playfield
// underneath, the way it does on the real table.
// L1 under the deck: two thick solid gray arch bands (measured off the reference, see README "Arch measurements").
// Each band = semicircular annulus on top + straight vertical legs ending in round caps; legs end at different heights.
// cIn/rIn: inner-edge circle; cOut/rOut: outer-edge circle (outer band's outer edge is offset 10 px left — the
// reference's right leg is thinner than its left). yL/yR: leg end (px) left/right.
// Bands are VARIABLE-WIDTH solid raised parts, each defined by two measured edge polylines (px) running from the
// left leg end, over the top, to the right leg end. Legs measured row by row on the open playfield (saturation /
// luminance); the parts under the semi-transparent deck measured by through-deck saturation (gray-beneath vs
// wood-beneath). Outer band: flat crown y 305..414 (106 px thick), legs 90 -> 34 px. See README "Arch measurements".
/**
 * SMOOTH THE MEASURED EDGES BEFORE THEY ARE DRAWN. Matt: *"The bands are not smooth. The curved
 * parts are all jagged."* They were: the edge polylines are measurements sampled every 20-60 px,
 * and joining them with straight lines makes a faceted band however accurate the points are.
 *
 * Catmull-Rom through the measured points, resampled at about 6 px, so the shape is exactly the
 * one that was measured and only the sampling gets finer. The FOOTPRINTS keep the original
 * polyline - a chord across 6 px of a curve this size is a fraction of a millimetre, and it keeps
 * the collision list small.
 */
function smoothEdge(pts, step = 6) {
  const out = [];
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(seg / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (
        2 * p1[d] + (-p0[d] + p2[d]) * t +
        (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 +
        (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const OUTER_OUT = [ // outer edge of the outer band: measured left leg (y 900 -> 640), shoulder + FLAT crown measured through the deck (y 306), right leg
  [186, 900], [176, 880], [166, 860], [158, 840], [152, 820], [149, 800], [145, 780], [143, 760], [140, 740], [137, 720], [136, 700], [133, 680], [131, 660], [129, 640],
  [135, 600], [150, 540], [170, 490], [200, 440], [218, 400], [232, 380], [244, 360], [252, 340], [268, 320], [290, 318], [350, 314], [430, 309], [500, 305], [570, 309], [650, 314], [700, 318],  // crown CAMBERED, see below
  [716, 320], [732, 340], [748, 360], [756, 380], [764, 400], [790, 440], [820, 490], [840, 540], [856, 600], [862, 640],
  [864, 660], [866, 680], [866, 700], [866, 720], [864, 740], [860, 760], [856, 780], [847, 800], [841, 820], [833, 840], [826, 860], [817, 880], [809, 900]];
const OUTER_IN = [ // inner edge of the outer band: rounder than the outer edge (crown 414), measured at x = 230..500 through the deck
  [224, 900], [222, 880], [218, 840], [214, 820], [208, 800], [206, 780], [208, 760], [212, 730], [215, 710], [216, 700], [219, 680], [225, 660], [230, 640],
  [230, 620], [245, 590], [260, 572], [290, 522], [320, 486], [350, 470], [380, 454], [410, 438], [440, 430], [470, 422], [500, 414], [530, 416], [560, 422], [590, 430], [620, 438], [650, 454], [680, 478], [702, 522], [742, 572], [757, 590], [772, 620],
  [772, 640], [775, 650], [777, 660], [783, 680], [788, 700], [789, 720], [790, 750], [790, 780], [788, 800], [784, 820], [780, 840], [774, 860], [776, 880], [776, 900]];
const INNER_OUT = [ // outer edge of the inner band: legs measured (y 790 -> 710), top measured through the deck (crown 488)
  [340, 790], [336, 780], [338, 770], [334, 760], [333, 750], [330, 740], [325, 730], [321, 720], [317, 710],
  [318, 690], [320, 600], [350, 564], [380, 540], [410, 512], [440, 504], [470, 496], [500, 488], [530, 494], [560, 504], [590, 512], [620, 540], [650, 564], [680, 600], [683, 690],
  [684, 710], [682, 720], [678, 730], [673, 740], [670, 750], [670, 760], [666, 770], [667, 780], [664, 790]];
const INNER_IN = [ // inner edge of the inner band (crown 576, just above the dome fixture)
  [364, 790], [368, 780], [366, 770], [369, 760], [370, 750], [368, 740], [367, 730], [365, 720], [363, 710],
  [366, 680], [372, 640], [380, 616], [410, 604], [440, 588], [470, 580], [500, 576], [530, 580], [560, 588], [590, 604], [620, 616], [628, 640], [634, 680],
  [641, 710], [640, 720], [639, 730], [637, 740], [634, 750], [634, 760], [637, 770], [636, 780], [640, 790]];
/**
 * THE THIRD BAND, the small central one, which the first export left out. Matt: *"He missed the
 * smallest band. The central one. It should have some sort of button or something in the center
 * top of this one that the pinball can go into."*
 *
 * It arches over the saucer, so the saucer sits in its mouth: a ball that makes it through the
 * inner arch and up the middle drops into the hole and scores. Measured proportions follow the
 * other two - about 20 px thick at the crown, tapering down legs that end higher than the inner
 * band's.
 */
const CENTRE_OUT = [
  [432, 700], [432, 672], [436, 646], [448, 626], [468, 614], [500, 611], [532, 614], [552, 626],
  [564, 646], [568, 672], [568, 700]];
const CENTRE_IN = [
  [452, 700], [452, 676], [456, 654], [466, 640], [480, 632], [500, 630], [520, 632], [534, 640],
  [544, 654], [548, 676], [548, 700]];

P.push({ type: 'band', name: 'arch_outer', outer: OUTER_OUT, inner: OUTER_IN, yEndL: 880, yEndR: 880, h: 0.028, y0: Y1, mat: 'band', levels: [1] });
P.push({ type: 'band', name: 'arch_inner', outer: INNER_OUT, inner: INNER_IN, yEndL: 796, yEndR: 796, h: 0.028, y0: Y1, mat: 'band', levels: [1] });
P.push({ type: 'band', name: 'arch_centre', outer: CENTRE_OUT, inner: CENTRE_IN, yEndL: 700, yEndR: 700, h: 0.024, y0: Y1, mat: 'band', levels: [1] });
// short L2 lips closing the deck edge over the arch legs, so the ramp mouths are exactly the ramps' width
// The deck edge is closed everywhere EXCEPT the two ramp mouths, so a ball can only leave the deck
// down a ramp or through the drop hole. The right side needed a second piece: the ramp moved to
// x 866..936, which left the deck edge open from 936 out to the board wall at 941.
// ...and the rest of the deck edge is closed, right out to both cabinet walls, because the old
// outer ramp lanes are gone. A ball can now leave the deck ONLY down a ramp or through the drop
// hole.
// (the two ledge extensions were part of that lip and are gone with it - see the deck edge above)
// THE BUTTON IN THE MOUTH OF THE CENTRE ARCH. A real capture hole, not decoration: it carries a
// footprint so the engine can score it, and it sits under the third band's crown.
/**
 * THE UPPER DECK'S FLOOR. There was not one.
 *
 * Matt: *"Things overlap... it's just messy."* The reason is this, and it is not a placement
 * problem: LEVEL 2 HAD NO SURFACE. The deck was a set of parts floating at Y2 over open air, so
 * every arch, ramp and rail on level 1 showed straight through the middle of it and the whole top
 * half read as one pile. It is also why the ramps appear to end in mid-air - there was literally
 * nothing up there for them to arrive on.
 *
 * The outline follows what is actually on the deck:
 *  - full cabinet width, x 45..941, down to py 596, which is where both ramps deliver;
 *  - narrowed to x 150..836 below that, because the outer strips are the ramps themselves;
 *  - front edge at py 760, the line design.js drops a ball off;
 *  - with the DROP HOLE cut out of that edge, x 455..545 up to py 724.
 *
 * `levels: []` because it is a floor, not an obstacle - a ball rolls ON it, and which deck it is
 * on is the layer system's business, not a collider's.
 */
P.push({
  type: 'poly', name: 'deck_L2', mat: 'deckwood', y0: Y2, d: 0.010, levels: [],
  pts: [
    [45, 40], [941, 40], [941, 596], [836, 596], [836, 760],
    [545, 760], [545, 724], [455, 724], [455, 760],
    [150, 760], [150, 596], [45, 596],
  ],
});
// THE UPPER DECK HAS AN EDGE, AND THE EDGE IS TILTED.
//
// Matt: *"if it's a separate level, by definition it has an edge. Are you talking about a wall or
// rail or barrier so it can't simply fall off the edge? because that's fine."*
//
// THE FIRST ATTEMPT WAS A FLAT BAR AT py 760 AND IT PARKED BALLS. 113 of 783 dropped on the deck
// could not get off, and they sat in two tight lines ON the bar, just outboard of each paddle.
// Matt, seeing the plot: *"You built a fucking wall then asked me why the ball kept getting stuck
// up there."* Right: a lip at constant y is perpendicular to gravity, so a ball that arrives
// anywhere except an opening has nowhere to go and simply rests against it.
//
// A REAL DECK EDGE SLOPES, so a ball running down onto it is fed along to an opening. These two
// rails drop 28 px over their 180 px run - about 9 degrees, comfortably past the 0.05 friction -
// and they drop TOWARD the ramp mouth on their own side. A ball landing anywhere on either rail
// rolls along it and out of the mouth.
//
// They stay above py 758, because design.js drops a ball off the deck at py 760: a rail hanging
// below that line would hold a ball at a position the fall has already claimed.
//
// THE MIDDLE IS OPEN, all of x 330..656. That is the stretch under the upper paddles, and Matt has
// been explicit about it twice: *"you put a horizontal wall where there should just be an edge -
// no barrier of any kind - under the top paddles."* The drop hole sits inside that opening.
// AND THEY SLOPE INBOARD, NOT OUT. The first tilt fed the ramp mouths, which sounds right and is
// wrong: THE RAMPS ONLY GO UP. Nothing carries a ball back DOWN one, so the mouth is not an exit at
// all - measured, every ball steered there simply stopped, 37% of the sweep. The deck's one real way
// off is the open stretch under the paddles, drop hole included, so that is where these feed.
const DECK_RAILS = [
  { name: 'deck_lip_left', a: [150, 730], b: [330, 758] },   // feeds the open middle
  { name: 'deck_lip_right', a: [836, 730], b: [656, 758] },  // feeds the open middle
];
for (const r of DECK_RAILS) wall(r.name, r.a, r.b, 0.008, 0.014, Y2, 'steel', [2]);
P.push({ type: 'saucer', name: 'saucer_centre', at: [500, 656], y0: Y1, levels: [1], capture: true, r: 0.016 });
// shooter lane
// shooter lane: thin wooden rail from just below the outer band's right leg end down to the plunger
// THE DIVIDER STARTS BELOW THE CHUTE, NOT INSIDE IT. Matt: *"The right ramp is not placed
// correctly. It's on top of the Launch ramp. The launch ramp is all messed up."* It was: the
// chute occupies x 862..955 over z 640..1000, and this divider ran straight up the middle of it
// from z 895 - a wall through the surface a ball is supposed to roll along. It now begins at
// z 1005, just past the chute's foot, and the chute gets its own inner wall instead.
// The launch chute's own walls and its stop. It is a plain channel outboard of the board.
wall('chute_stop', [986, 1880], [1073, 1880], 0.008, 0.02, Y1, 'darkwood', [1, 2], 'the plunger seat, on BOTH levels: a plunged ball rides the chute on level 2, so a weak plunge has to come back to a seat that is there');
// right chute: shooter incline AND right ramp in one — plunger shots climb it onto the deck, deck balls roll down it into the shooter lane
// THE RIGHT RAMP, and it lives INSIDE the board now that the chute has moved out of its way -
// the mirror of the left one, in the 89 px lane between the arch's right leg and the board's right
// wall. 70 px = 0.037 m of clear channel against a 0.027 ball.
P.push({ type: 'ramp', name: 'ramp_right', x: [836, 941], xFoot: [755, 857], z: [596, 933], mat: 'ramp', levels: [],
  note: 'two-way L1<->L2. Top against the wall, MOUTH SWUNG INBOARD - measured off the reference photo, mirrored from ramp_left.' });

// A RAIL DOWN EACH RAMP'S INNER EDGE. The arch leg only hugs the ramp near the deck - the left leg
// swings from x 129 out to 186 as it descends, and the right one from 862 in to 809 - so below the
// crown the ramp had an open side and a ball on it would simply leave sideways. These are straight
// rails on the ramp's own edge, which is what a real ramp has.
// A BACKSTOP ACROSS EACH RAMP MOUTH, ON LEVEL 1 ONLY. Design had this and I took it out as "the
// barrier" - wrongly. The barrier that made the left ramp unshootable was the ONE-WAY flag; this
// wall is a different thing and is needed. Without it level 1 has an open corridor up each ramp
// lane into the dead space above the arch, and a flood fill from the three places a ball can enter
// level 1 found 32 dropped balls resting on the arch crown up there.
//
// The TRANSITION fires first: a ball crossing py 908 moving up is handed to level 2 before it can
// touch this. It is the backstop for anything the transition does not catch.
// A rail down BOTH edges of each ramp. They used to borrow the arch leg as their inner wall; out
// here in the middle of the table neither has one, so each gets its own pair.
// THE THIN VERTICAL RAILS ARE SHORT. They ran the full py 640..908, so each ramp lane was a
// walled slot a ball had to already be inside to enter, and a shot arriving at any angle hit the
// rail's flank instead. Matt: *"Shorten the left and right thin vertical walls."* They now cover
// only the top half of the lane, which is the part that has to guide the ball onto the ramp; the
// bottom half is open, so a shot off a paddle can come into the lane from the side.
// THE RAILS FOLLOW THE LANE, FOOT TO TOP. Four straight verticals used to cover py 640..790 only,
// so the bottom 118 px of the ramp - the entire approach - had nothing guiding a ball into it.
// These are the measured edges, four segments each, mouth first.
// THE OUTER RAIL HUGS THE WALL, it does not follow the ramp floor. Tracing the floor left an 89 px
// pocket between wall_left and the rail at the mouth, narrowing to nothing at py 593 - a wedge that
// passes through every width on its way to zero, which by this repo gap rule is a parking space and
// not a lane. Measured: it swallowed 16 of the 69 rising balls per 30 games. So the rail runs up the
// wall and cuts across to the mouth corner, which seals the pocket AND funnels an arriving ball
// inboard toward the mouth instead of past it.
// NO FREE-STANDING RAILS BESIDE THE RAMP. Matt, twice: *"GET RID OF THOSE FUCKING RAILS NEXT TO
// THE RAMP. I TOLD YOU TO NOT INCLUDE THEM."* They are gone. What replaces them is not a rail
// beside the ramp - it is the ramp having SIDES, generated from its own geometry in the footprint
// pass below, so the channel and the thing you can see are the same object.
// L1 backstops across each mouth. The transition to L2 fires first; these catch anything it does
// not, so level 1 has no open corridor up a ramp lane.
// AND THE OUTER LANES ARE CLOSED AT THE TOP. They used to be the ramp lanes, so the ramps closed
// them; with the ramps moved inboard they became open corridors running from the flippers to the
// top of the cabinet, and the shot map duly reported balls reaching py 66. An outlane ends at the
// drain, so its top is a wall.
// THE TWO L-SHAPED BARRIERS ARE GONE. `outlane_top_left` ran across py 908 from x 129 to 250 and
// met the vertical `ramp_rail_left_in` at its corner; the right pair mirrored it. Matt: *"you added
// some sort of gray barrier walls in an L and reverse L shape. These help to ruin the game - by
// making sure no ball EVER gets anywhere close to going up the ramp."* They sat directly across
// the approach to both ramp mouths. There is nothing across py 908 now.
// NO WALL ACROSS EITHER RAMP MOUTH. There used to be one on each, called a backstop, and
// together with outlane_top_left/right they made an unbroken bar across py 908 from x 45 to 250
// and from 750 to 936. Matt: *"You added gates to block the ramps off completely."* He is right:
// a ball cannot shoot a ramp whose entrance has a wall in it, whatever the wall is for.
//
// What the backstop guarded against is real - without it, level 1 has an open corridor up each
// lane into the dead space above the arch. That is closed in js/design.js instead, where it
// belongs: the ramp transition fires for ANY level-1 ball above the mouth line in the lane, not
// only one still travelling upward, so there is nothing left up there to rest on.

// THE LAUNCH CHUTE, outboard of the board's right wall. A plain channel: the plunger fires a ball
// up it and over the top onto the deck. Nothing on the playfield shares its width.
P.push({ type: 'incline', name: 'launch_chute', x: [988, 1053], z: [560, 1880], mat: 'ramp', levels: [], note: 'outboard launch channel; rises to deck height at its top' });
P.push({ type: 'plunger', name: 'plunger_rod', at: [1020, 1875], len: 230 * S, levels: [] });
// ramps (upper deck -> main), gray
// ramps sit immediately outside the outer arch legs (the leg is the ramp's inner wall); cabinet wall / divider is the outer wall
// THE LEFT RAMP IS A SHOT, NOT A CHUTE. Matt: *"the left is in a spot that is impossible for the
// ball to actually go up. there's a barrier blocking the on ramp part."* The barrier was in the
// rules, not the wood: it was declared ONE-WAY DOWN, and its own exit line was to be treated as a
// wall for any L1 ball moving up the board. So a ball could only ever fall down it.
//
// It is two-way now, and its MOUTH IS FLARED to match the gap the ball actually arrives through:
// the arch's left leg tapers away as it descends, so the opening is 141 px wide at the foot and
// 84 px at the deck. `xFoot` is that wider bottom edge.
// THE RAMPS END WHERE THEIR INNER WALL DOES. The arch legs are the ramps' inner walls, and they
// stop at py 908; the ramp surfaces ran on to 935, so for the last 27 px each ramp was a slab with
// nothing down one side, ending in mid-playfield. Both now finish at 908, at the foot of the leg.
/**
 * BOTH RAMPS SLID INBOARD, SAME SHAPE, INTO THE BAND A FLIPPER ACTUALLY SHOOTS.
 *
 * Measured, not guessed: 560 flipper shots across every contact point on the paddle and every
 * flip timing reached the ramp mouths ZERO times, so level 2 could not be got to at all. It was
 * never power - the best shot reached py 442, well past the mouth line at 908 - and it was not the
 * lane rails either; shortening those changed nothing. Of the 17 shots that reached the mouth
 * line, EVERY ONE crossed it between x 250 and 750, up the middle, while the mouths sat at x
 * 45..129 and 866..936 hard against the cabinet walls. The two simply never met.
 *
 * So the ramps move to where the shots are. Their width and their climb are unchanged - it is a
 * slide, not a reshape. The old outer lanes stay as what they always were, outlanes.
 *
 * Each mouth's outboard edge is set so the gap to the arch leg beside it is 26 px = 0.014 m, which
 * is SEALED - a ball cannot enter it. The arch is not symmetric (its left leg ends at x 224, its
 * right at 776), so the two mouths are not mirror images; sealing the gap wins over symmetry.
 */
// THE LANE LEANS, AND THE LEAN IS MEASURED. `xFoot` is the mouth and `x` the top, and rampCurved
// interpolates between them, so the lane is a slanted channel rather than a vertical box. Matt,
// with the reference recoloured by hand: *"the ramp is curved towards the center (A LITTLE - DO
// NOT SEND ME SEMI CIRCLE RAMPS). This allows balls to actually go up the ramp."*
P.push({ type: 'ramp', name: 'ramp_left', x: [45, 150], xFoot: [129, 231], z: [596, 933], mat: 'ramp', levels: [],
  note: 'two-way L1<->L2. Top against the wall at x 45..140, mouth swung inboard to x 129..231 - read off the reference photo.' });
// left lane guide + posts
// THE LEFT LANE RAIL, MOVED INBOARD. Matt: *"the left is in a spot that is impossible for the ball
// to actually go up. there's a barrier blocking the on ramp part."* Traced: a ball climbing the
// left lane had a clear band only 19 px wide - between the cabinet wall and this rail's posts -
// against a ball 26 px across. The ramp did not need moving; its APPROACH did. At x 148 the lane
// is 0.033 m of clear channel and feeds the ramp mouth square on.
wall('lane_rail_left', [45, 960], [153, 1410], 0.006, 0.014, Y1, 'steel', [1]);
// EACH LANE RAIL CARRIES ONE POST NOW, AT ITS OWN TOP END. It used to have three, at py 980,
// 1100 and 1250. Shortening the rail opened the way into the ramp lane and left the top two posts
// standing free in that opening - steel bollards directly across the only path from the far paddle
// into the ramp lane, and the two heaviest blockers a rising shot met (33 and 22 contacts in a
// 240-shot sweep).
// ...and its mirror, which the right ramp needs for exactly the same reason.
wall('lane_rail_right', [941, 960], [838, 1410], 0.006, 0.014, Y1, 'steel', [1]);
// posts around ramp exits / under deck
post('post_big_left',  [345, 785], 0.009, 0.024, Y1, 'steel', [1]);
post('post_big_right', [641, 785], 0.009, 0.024, Y1, 'steel', [1]);
// THE EXIT POSTS OVERLAP THE ARCH LEGS rather than standing just clear of them. At 245 and 741
// each sat about 20 clear units from the leg beside it - too narrow for a ball to pass, wide enough
// for one to settle in the crook on top, which is what the play-test found at (750, 844). This is
// the fix pinball/CLAUDE.md already records for the same shape: overlap the two into one convex
// blob, which has no stable top.
post('post_exit_left',  [228, 880], 0.006, 0.022, Y1, 'steel', [1]);
post('post_exit_right', [770, 880], 0.006, 0.022, Y1, 'steel', [1]);
// posts along the apron edges
// THE APRON POSTS ARE MIRRORS. They were not: the left three sit exactly on the left apron edge
// (45,1650)-(390,1880), and the right three sat on a line that edge no longer follows, so each
// one made a crook with the apron beside it. Played, 24 dropped balls came to rest in those three
// crooks and none in the mirrored left ones.
[0.25, 0.5, 0.75].forEach((t, i) => {
  const x = 45 + 345 * t, y = 1650 + 230 * t;
  post(`post_apron_left_${i + 1}`,  [x, y],     0.006, 0.022, Y1, 'steel', [1]);
  post(`post_apron_right_${i + 1}`, [M - x, y], 0.006, 0.022, Y1, 'steel', [1]);
});

// ...and the apron edges now run DOWN to the bottom wall. They stopped at py 1880, leaving a dead
// pocket either side of the drain mouth that 47 dropped balls settled into rather than draining.
wall('apron_funnel_left',  [390, 1880], [390, 1950], 0.006, 0.03, Y1, 'darkwood', [1]);
wall('apron_funnel_right', [600, 1880], [600, 1950], 0.006, 0.03, Y1, 'darkwood', [1]);
// slingshots
// The slingshots move in with the flippers - a slingshot sits directly above its own paddle, and
// left where they were they would have fired into empty wood a hand's width outside it.
P.push({ type: 'sling', name: 'slingshot_left',  A: [245, 1395], B: [245, 1495], C: [312, 1500], y0: Y1, levels: [1] });
P.push({ type: 'sling', name: 'slingshot_right', A: [741, 1395], B: [741, 1495], C: [674, 1500], y0: Y1, levels: [1] });
// flippers (rest pose). Rotate about pivot; tip swings toward -z by ~50°
// THE LOWER FLIPPERS, MOVED IN. Matt: *"he made the bottom paddles WAY too far apart."* They were:
// pivots 576 px apart left tips 346 px = 0.182 m of open drain, nearly SEVEN ball widths, which no
// player can defend. The paddles are unchanged in length and angle; only the pivots move, to 330
// px apart, leaving a CLEAR 0.039 m between the tip rubbers - 1.4 balls, which is the figure a
// real machine runs and comfortably outside the 0.020..0.030 trap band.
P.push({ type: 'flipper', name: 'flipper_lower_left',  pivot: [335, 1560], tip: [450, 1650], y0: Y1, levels: [1], dir: +1 });
P.push({ type: 'flipper', name: 'flipper_lower_right', pivot: [665, 1560], tip: [550, 1650], y0: Y1, levels: [1], dir: -1 });
P.push({ type: 'flipper', name: 'flipper_upper_left',  pivot: [330, 622],  tip: [440, 690],  y0: Y2, levels: [2], dir: +1 });
P.push({ type: 'flipper', name: 'flipper_upper_right', pivot: [656, 622],  tip: [546, 690],  y0: Y2, levels: [2], dir: -1 });
// pop bumpers
// (The lower pop bumper that used to stand at [462, 1700] is GONE. Matt: *"delete the big circle
// thing between the two bottommost paddles"* - with the flippers where they are now it would sit
// in the drain mouth, inside their sweep.)
// A BUMPER MAY CARRY ITS OWN RADIUS. They shared `BUMPER_R` until Matt made the left one smaller
// in the layout editor, and one shared constant cannot express two sizes. `r` is in METRES like
// every other size in this file; a bumper without one still takes BUMPER_R.
P.push({ type: 'bumper', name: 'bumper_upper_left',  at: [385, 270],  y0: Y2, levels: [2], r: 66 * S });
P.push({ type: 'bumper', name: 'bumper_upper_right', at: [601, 270],  y0: Y2, levels: [2] });
// upper deck red posts + guide rails
[[130, 190], [240, 115], [310, 55], [150, 440], [130, 560]].forEach(([x, y], i) => {
  post(`post_red_left_${i + 1}`,  [x, y],     0.007, 0.024, Y2, 'red', [2]);
  post(`post_red_right_${i + 1}`, [M - x, y], 0.007, 0.024, Y2, 'red', [2]);
});
wall('guide_rail_upper_left',  [150, 440], [320, 610], 0.006, 0.014, Y2, 'steel', [2]);
wall('guide_rail_upper_right', [836, 440], [666, 610], 0.006, 0.014, Y2, 'steel', [2]);
// top target bank (4 cream targets against the top wall)
P.push({ type: 'targets', name: 'target_bank', xs: [415, 470, 525, 580], z: 62, y0: Y2, levels: [2] });
// decoration: lit inserts, discs, wedges, saucers, teardrop decal
disc('insert_yellow_center', [505, 765], 0.011, Y1, 'yellow', true);
[[405, 845], [465, 838], [525, 838], [590, 850]].forEach((a, i) => disc(`insert_magenta_${i + 1}`, a, 0.011, Y1, 'magenta', true));
[[255, 970], [315, 945], [375, 925], [435, 910], [495, 910], [555, 912], [620, 925], [680, 950], [735, 985]].forEach((a, i) => disc(`insert_blue_${i + 1}`, a, 0.011, Y1, 'blue', true));
[[395, 995], [455, 982], [520, 982], [575, 1005]].forEach((a, i) => disc(`insert_red_${i + 1}`, a, 0.011, Y1, 'redlit', true));
// THE RIGHT-HAND LANE INSERTS ARE THE LEFT ONES MIRRORED. They were not: they sat at x 855, 840
// and 820 against left-hand ones at 135 and 82, whose true mirrors are 851 and 904. That was
// survivable while the right lane rail was at x 118; with the rail moved out to 838 to open the
// right ramp's approach, two of the three ended up UNDER it.
const SIDE_DARK = [[135, 1045], [82, 1210]];
const SIDE_YELLOW = [[82, 1130]];
SIDE_DARK.concat(SIDE_DARK.map(([x, y]) => [M - x, y]))
  .forEach((a, i) => disc(`insert_dark_L1_${i + 1}`, a, 0.011, Y1, 'unlit', false));
SIDE_YELLOW.concat(SIDE_YELLOW.map(([x, y]) => [M - x, y]))
  .forEach((a, i) => disc(`insert_yellow_side_${i + 1}`, a, 0.011, Y1, 'yellow', true));
// The nine unlit inserts and the four olive target discs that were painted across the upper deck
// are deleted. Paint, no footprint.
P.push({ type: 'saucer', name: 'saucer_left',  at: [85, 110],  y0: Y2, levels: [] });
P.push({ type: 'saucer', name: 'saucer_right', at: [901, 110], y0: Y2, levels: [] });
// THE ARROWS POINT UP THE LANE THEY BELONG TO. Matt: *"arrows aren't pointing in the righ tdirection".*
// They were aimed by eye and then the ramp mouths moved 84 px inboard underneath them, so the two by
// the ramps were pointing at bare wood.  runs from the TIP to the base, so it is the lane heading
// negated: the lane leaves each mouth 26 degrees off vertical, toward the side wall, which is the
// (-0.44, -0.90) taken from the ramp spine in js/table-design.js. They are longer than they are wide
// now (26 x 78 rather than 30 x 60), because a stubby triangle reads as a wedge and not as an arrow.
[[[170, 930], [34, 70]], [[816, 930], [-34, 70]], [[140, 1325], [45, 35]], [[805, 1315], [-45, 35]]].forEach(([tip, d], i) =>
  P.push({ type: 'wedge', name: `insert_green_wedge_${i + 1}`, tip, d, y0: Y1, levels: [] }));
P.push({ type: 'teardrop', name: 'decal_teardrop', y0: Y1, levels: [] });

// ---------------------------------------------------------------- footprints (2D, meters)
/**
 * MATT'S LAYOUT, APPLIED. Everything above is the board as the Claude Design export built it;
 * this writes his editor export over the top, which is what makes the deployed board and the
 * layout tool agree. Three exports had been sent and none of them reached the game, because the
 * tool was seeded from a scratchpad mockup instead of from here. Matt: *"why does the board look
 * nothing like it did in the tool? I made many changes that you confirmed, but that I do not see
 * here."*
 *
 * It writes back into each part's OWN fields rather than replacing the part, so the 3D builder,
 * the material table and the footprint pass all keep working unchanged - a post stays a post.
 */
const setShape = (part, rec) => {
  const pt = rec.pts;
  switch (part.type) {
    case 'post': case 'disc': case 'bumper': case 'saucer':
      part.at = pt[0].slice();
      if (rec.r !== undefined) part.r = r4(rec.r * S);
      break;
    case 'wall': case 'gate':
      part.a = pt[0].slice(); part.b = pt[1].slice();
      // AND ITS THICKNESS. The editor draws a wall as a capsule and carries its width; without
      // this a part copied from a sibling keeps the SIBLING thickness, and the thin rails Matt
      // drew beside the flippers were built with wall_left's 45 px timber. The rest sweep found
      // 507 balls parked in the slots that made.
      if (rec.w !== undefined) part.t = r4(rec.w * S);
      break;
    case 'flipper':
      part.pivot = pt[0].slice(); part.tip = pt[1].slice();
      break;
    case 'sling':
      part.A = pt[0].slice(); part.B = pt[1].slice(); part.C = pt[2].slice();
      break;
    case 'poly': case 'wedge': case 'targets':
      if (part.pts) part.pts = pt.map((q) => q.slice());
      break;
    case 'band': {
      // A band was flattened to one ring by the editor (outer, then inner reversed). Split it
      // back the same way, or the arch comes back inside out.
      const h = pt.length / 2;
      part.outer = pt.slice(0, h).map((q) => q.slice());
      part.inner = pt.slice(h).reverse().map((q) => q.slice());
      break;
    }
    default: break;   // ramp, incline, plunger, teardrop: not the editor's to set
  }
  if (rec.levels) part.levels = rec.levels.slice();
};

/**
 * SMOOTH A HAND-DRAWN CHAIN. Chaikin corner-cutting: every segment is replaced by its quarter
 * and three-quarter points, twice, which rounds off the wobble without moving the line. The two
 * ENDS are pinned, because an arch leg has to keep finishing exactly where it finishes.
 *
 * WHY THIS EXISTS. Matt, more than five times over a day: the semi-circles are crudely drawn,
 * they are not smooth lines. *"i think i sketched them with my trackpad mouse and you treated
 * that shape as gospel."* That is exactly what happened - the arch outlines come through the
 * editor export and I applied them point for point. Measured on arch_outer: six vertices turned
 * more than 12 degrees and the worst turned 43. That is a mouse tremor, not a design.
 *
 * It runs on the PART, so the 3D mesh and the collision footprints are both built from the
 * smoothed chain. There is one shape, not two that have to be kept in step.
 */
function smoothChain(pts, passes = 4) {
  let out = pts.map((q) => q.slice());
  for (let k = 0; k < passes; k++) {
    const next = [out[0].slice()];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(out[out.length - 1].slice());
    out = next;
  }
  // ...then walk the smoothed line at a FIXED SPACING. Two Chaikin passes quadruple the point
  // count, and a band emits one collider per segment - arch_outer alone went from 101 to 400 and
  // level 1 from 270 colliders to 829. Resampling every 14 px keeps the smoothness (the curve is
  // already smooth; this only chooses where to sample it) and puts the count back where it was.
  const step = 9;
  const res = [out[0].slice()];
  let carry = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const A = out[i], B = out[i + 1];
    const seg = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let d = step - carry;
    while (d < seg) {
      const t = d / seg;
      res.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      d += step;
    }
    carry = (carry + seg) % step;
  }
  res.push(out[out.length - 1].slice());
  return res.map((q) => [r4(q[0]), r4(q[1])]);
}

{
  const gone = new Set(REMOVED);
  for (let i = P.length - 1; i >= 0; i--) if (gone.has(P[i].name)) P.splice(i, 1);
  // A part Matt DREW is built by copying a sibling of the same type, which is how it inherits the
  // fields the editor does not carry: height, material, level tag. Its GEOMETRY is overwritten by
  // setShape below, thickness included, so nothing of the sibling shape survives.
  for (const a of ADDED) {
    if (P.some((q) => q.name === a.name)) continue;
    const src = P.find((q) => q.type === a.type && q.mat === a.mat) || P.find((q) => q.type === a.type);
    if (!src) continue;
    // ...but NOT the sibling's level. The six rails Matt drew beside the flippers were copies of
    // ramp_rail_right_in, which no longer exists, so the search fell through to a steel wall on
    // the UPPER DECK and all six were built on level 2 - present in the model, absent from the
    // playfield the ball is actually on.
    P.push({ ...JSON.parse(JSON.stringify(src)), name: a.name, mat: a.mat || src.mat, levels: (a.levels || [1]).slice() });
  }
  for (const part of P) {
    const rec = LAYOUT[part.name];
    if (rec) setShape(part, rec);
  }
  // A PART ON LEVEL 2 IS DRAWN AT DECK HEIGHT. The editor sets which LEVEL a part belongs to; it
  // knows nothing about height, so a part Matt moved to level 2 kept the y0 it was built with. That
  // did not show while there was no deck - now there is one, and the four magenta inserts he moved
  // up were being drawn UNDERNEATH it. Level and height are the same fact, so they follow each other.
  for (const part of P) {
    if (part.levels && part.levels.length === 1 && part.levels[0] === 2 && part.y0 !== undefined && part.y0 < Y2) part.y0 = Y2;
  }

  // ...and every band gets the tremor taken out of it, whether it came from the editor or not.
  for (const part of P) {
    if (part.type !== 'band') continue;
    part.outer = smoothChain(part.outer);
    part.inner = smoothChain(part.inner);
  }
}

const FP = { 1: [], 2: [] };
const addFP = (levels, fp) => levels.forEach(l => FP[l].push(fp));
const circleFP = (name, levels, at, r, extra) => addFP(levels, { name, shape: 'circle', c: PX(...at), r: r4(r), ...extra });
const capsuleFP = (name, levels, a, b, r, extra) => addFP(levels, { name, shape: 'capsule', a: PX(...a), b: PX(...b), r: r4(r), ...extra });
const BUMPER_R = 0.038, FLIP_R0 = 0.012, FLIP_R1 = 0.007, SLING_POST_R = 0.006;
for (const p of P) {
  // A RAMP HAS NO  AND STILL NEEDS WALLS.  means "not a flat obstacle on either
  // deck", which is true of the SURFACE - you roll along it, not into it - but it skipped the whole
  // part, sides included, so the lane was a picture. That is what Matt found by playing it: the ball
  // rolls straight over it like paint. The ramp case below emits its own walls and says which level
  // they live on, so it must not be filtered out here.
  if (!p.levels.length && p.type !== 'ramp') continue;
  switch (p.type) {
    case 'wall': capsuleFP(p.name, p.levels, p.a, p.b, p.t / 2, p.note ? { note: p.note } : {}); break;
    case 'gate': capsuleFP(p.name, p.levels, p.a, p.b, p.t / 2, { oneWay: p.oneWay, note: p.note }); break;
    case 'post': circleFP(p.name, p.levels, p.at, p.r); break;
    case 'bumper': circleFP(p.name, p.levels, p.at, p.r || BUMPER_R, { kicks: true }); break;
    case 'band': {
      // solid variable-width band: its two edges are emitted as chains of thin capsules (r = 1 mm, faces flush with the edge)
      const chain = (pts, tag) => pts.slice(1).forEach((b, i) => capsuleFP(`${p.name}_${tag}_${i + 1}`, p.levels, pts[i], b, 0.001, { solidSide: tag === 'outer' ? 'inside' : 'outside' }));
      chain(p.outer, 'outer'); chain(p.inner, 'inner');
      // leg ends: closing segments
      capsuleFP(`${p.name}_end_left`, p.levels, [p.outer[0][0], p.yEndL], [p.inner[0][0], p.yEndL], 0.001, {});
      capsuleFP(`${p.name}_end_right`, p.levels, [p.outer[p.outer.length - 1][0], p.yEndR], [p.inner[p.inner.length - 1][0], p.yEndR], 0.001, {});
      break;
    }
    case 'saucer': circleFP(p.name, p.levels, p.at, p.r || 0.016, { captures: true,
      note: 'a ball entering is held and kicked back out up the middle; scores' }); break;
    case 'targets': capsuleFP(p.name, p.levels, [p.xs[0] - 15, p.z], [p.xs[3] + 15, p.z], 0.007); break;
    case 'ramp': {
      // MATT FOUND THIS BY PLAYING IT: *"THE REASON THE RAMPS DONT WORK IS BECAUSE YOUVE MADE
      // THEM FLAT. THE BALL TREATS IT LIKE PAINT AND ROLLS RIGHT OVER IT."* He is exactly right.
      // A `ramp` carried `levels: []`, so it generated NO collider at all: the lane was a picture
      // and the only solid things near it were the free-standing rails, now deleted.
      //
      // So the ramp builds its OWN walls, sampled along the same bend the 3D surface uses, which
      // is what makes the channel and the drawing the same object rather than two things that
      // have to be kept in step by hand. The mouth is left open - the bottom span carries no
      // wall - because a wall across it is the defect test.js already guards against.
      const xf = p.xFoot || p.x;
      const N = 10;
      const at = (side, i) => {
        const t = i / N;
        const bend = t * t * (3 - 2 * t) * 0.45 + t * 0.55;
        return [xf[side] + (p.x[side] - xf[side]) * bend, p.z[1] + (p.z[0] - p.z[1]) * t];
      };
      for (let i = 0; i < N; i++) {
        capsuleFP(`${p.name}_wall_out_${i}`, [1], at(0, i), at(0, i + 1), 0.008);
        capsuleFP(`${p.name}_wall_in_${i}`, [1], at(1, i), at(1, i + 1), 0.008);
      }
      break;
    }
    case 'sling': {
      // THE LIVE FACE IS THE HYPOTENUSE, FOUND BY MEASURING - not A-to-C by convention. Matt has
      // asked for the hypotenuse from the start, and A-to-C stopped being it the moment he rotated
      // these in the editor: on his export the sides run AB 204, BC 100, CA 178, so the kicker was
      // living on the second-longest edge, whose outward normal points at the DRAIN. Measured, a
      // ball thrown at it was returned to py 1562-1642 and went straight back down.
      //
      // Deriving it means the face stays right however he rotates or reshapes them next time.
      ['A', 'B', 'C'].forEach(k => circleFP(`${p.name}_post_${k}`, p.levels, p[k], SLING_POST_R));
      const EDGES = [['AB', p.A, p.B], ['BC', p.B, p.C], ['CA', p.C, p.A]];
      let hyp = EDGES[0], hypLen = -1;
      for (const e of EDGES) {
        const L = Math.hypot(e[2][0] - e[1][0], e[2][1] - e[1][1]);
        if (L > hypLen) { hypLen = L; hyp = e; }
      }
      for (const e of EDGES) capsuleFP(`${p.name}_face_${e[0]}`, p.levels, e[1], e[2], 0.003, e === hyp ? { kicks: true } : undefined);
      break;
    }
    case 'flipper': {
      const [ax, az] = PX(...p.pivot), [bx, bz] = PX(...p.tip);
      addFP(p.levels, { name: p.name, shape: 'capsule', a: [ax, az], b: [bx, bz], r: FLIP_R1, rPivot: FLIP_R0, rTip: FLIP_R1, dynamic: true,
        // THE SWEEP IS NEGATIVE dir, AND THE POSITIVE VERSION SWUNG ALL FOUR PADDLES BACKWARDS.
        // Matt: *"the paddles swing backwards."* Measured, with `50 * dir`: the left paddle's tip
        // went from px (450, 1650) to (340, 1706) and the right one's from (550, 1650) to
        // (660, 1706) - both DOWN and OUTWARD, away from the ball, which is the opposite of what
        // a flipper does. Table z runs down-field, so a paddle rising toward the playfield is z
        // DECREASING, which this part's own note has said all along: `tip swings toward -z`. The
        // note was right and the number disagreed with it.
        //
        // The renderer was never wrong about this. It draws the paddle exactly where the solver
        // puts it - checked by putting a mesh tip and a physics tip in the same world frame and
        // measuring the distance between them, which is 0.0 units. A backwards paddle on screen
        // meant a backwards paddle in the physics, and changing the render sign would only have
        // hidden it.
        pivot: [ax, az], length: r4(Math.hypot(bx - ax, bz - az)), restAngle: r4(Math.atan2(bz - az, bx - ax)), sweep: r4(-50 * Math.PI / 180 * p.dir),
        note: 'tapered capsule: rPivot at a, rTip at b; rotates about pivot by `sweep` radians (tip swings toward -z) when actuated' });
      break;
    }
  }
}
export const FOOTPRINTS = FP;
/** The raw part list, exported so a play-test can tell a SOLID band from open wood: a band's
 *  footprint is only its two edges, so its inside looks like free space to anything that does
 *  not know better. */
export const PARTS = P;

const [ , zLedgeTop] = PX(0, 640);
export const TRANSITIONS = [
  { name: 'ramp_left', from: 2, to: 1, oneWay: false,
    entry: { level: 2, x: [PX(45, 0)[0], PX(129, 0)[0]], z: zLedgeTop, moving: '+z' },
    arrival: { level: 1, at: PX(105, 935), dir: [0, 1] },
    note: 'TWO-WAY. The left lane between the cabinet wall and the outer arch leg, flaring from 0.044 m at the deck to 0.074 m at the foot. An L1 ball crossing z of py 908 between x of px 45..129 while moving -z CLIMBS it and arrives on L2 at PX(87, 640) moving -z; a deck ball crossing the same line moving +z rolls down and arrives on L1 at PX(87, 908) moving +z. Nothing here is a wall - it was a one-way with its exit treated as a barrier, which made the shot impossible.' },
  { name: 'drop_hole', from: 2, to: 1, oneWay: true,
    entry: { level: 2, x: [PX(455, 0)[0], PX(545, 0)[0]], z: PX(0, 724)[1], moving: '+z' },
    arrival: { level: 1, at: PX(500, 785), dir: [0, 1] },
    note: 'gap in the V ledge between the upper flipper tips; ball falls off the deck edge' },
  { name: 'ramp_right', from: 1, to: 2, oneWay: false,
    entry: { level: 1, x: [PX(862, 0)[0], PX(955, 0)[0]], z: PX(0, 1000)[1], moving: '-z' },
    arrival: { level: 2, at: PX(910, 630), dir: [0, -1] },
    reverse: { entry: { level: 2, x: [PX(862, 0)[0], PX(955, 0)[0]], z: zLedgeTop, moving: '+z' }, arrival: { level: 1, at: PX(922, 1000), dir: [0, 1] } },
    note: 'the RIGHT RAMP, inside the board, mirroring the left one: an L1 ball crossing z of py 908 between x of px 866..936 while moving -z climbs it to the deck; a deck ball crossing the same line moving +z rolls back down. The launch chute is a separate channel outboard of the board and is not this.' },
  { name: 'launch', from: 1, to: 2, oneWay: true,
    note: 'the LAUNCH CHUTE, outboard of the board right wall (x px 988..1053). A plunged ball rides it up and enters the deck over the top wall at about PX(1018, 560) moving -z. It touches no part of the playfield on the way.' },
  { name: 'drain', from: 1, to: null, oneWay: true,
    entry: { level: 1, x: [PX(390, 0)[0], PX(600, 0)[0]], z: PX(0, 1880)[1], moving: '+z' } },
];

export const LEVELS = {
  1: { name: 'main playfield', surfaceY: Y1, footprints: FP[1],
       contents: 'full-length floor: cabinet walls, apron edges, drain, shooter lane + divider, right chute, left lane rail, 2 slingshots, 2 lower flippers, lower pop bumper, 4 posts near ramp exits, ramp rails, and under the deck the two solid arch bands' },
  2: { name: 'upper deck', surfaceY: Y2, footprints: FP[2],
       contents: 'raised deck over the top section: cabinet walls, top target bank, 2 pop bumpers, 10 red posts, 2 guide rails, 2 upper flippers, V-ledge lip + extensions (with drop hole)' },
  transitions: TRANSITIONS,
};

// ---------------------------------------------------------------- build
export function buildBoard(THREE) {
  const g = new THREE.Group(); g.name = 'pinball_playfield';
  const mk = (name, color, o = {}) => Object.assign(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o }), { name });
  const MAT = {
    maple: mk('maple', 0xC58B3E, { roughness: 0.8 }),
    // The deck reads as a FLOOR now, not a tint. It was 0.62, which was fine while nothing used
    // it - the deck surface itself was never built, so this material was unused. With a real deck in
    // place 0.62 let every arch and rail on level 1 show through, and that is a large part of what
    // Matt means by *"Things overlap... it is just messy."* 0.9 keeps a hint of what runs underneath
    // without the two levels reading as one.
    deckwood: mk('deck_maple', 0xB47B36, { roughness: 0.8, transparent: true, opacity: 0.9 }),
    darkwood: mk('walnut', 0x5A3817, { roughness: 0.75 }),
    black: mk('black_paint', 0x17130F),
    cream: mk('cream', 0xF1E5C4, { roughness: 0.5 }),
    red: mk('red_plastic', 0xC22020, { roughness: 0.45 }),
    steel: mk('steel', 0xC4C8CE, { roughness: 0.35, metalness: 0.3 }),
    ramp: mk('ramp_gray', 0x8E9194, { roughness: 0.55 }),
    band: mk('band_gray', 0x7C7F83, { roughness: 0.6 }),
    yellow: mk('insert_yellow', 0xE8E11C, { emissive: 0x7A7600, roughness: 0.4 }),
    magenta: mk('insert_magenta', 0xD634D6, { emissive: 0x6A106A, roughness: 0.4 }),
    blue: mk('insert_blue', 0x2F7DE6, { emissive: 0x0F3A80, roughness: 0.4 }),
    redlit: mk('insert_red', 0xE01E1E, { emissive: 0x700808, roughness: 0.4 }),
    green: mk('insert_green', 0x2FD22F, { emissive: 0x0C6A0C, roughness: 0.4 }),
    unlit: mk('insert_unlit', 0x4A5416),
    olive: mk('target_olive', 0x9CA23C, { roughness: 0.5 }),
    // PAINT, NOT A HOLE. At 0x1E1409 against 0xC58B3E maple the teardrop decal read as a void cut
    // out of the middle of the playfield - a solid black shape a third of the lower deck across, and
    // the first thing your eye goes to in any screenshot. It is a printed graphic on a wooden sheet,
    // so it is a dark umber that sits ON the wood.
    decal: mk('decal_dark', 0x53381C, { roughness: 0.9 }),
  };
  const V3 = (px, py, y) => { const [x, z] = PX(px, py); return new THREE.Vector3(x, y, z); };
  const mesh = (name, geo, mat, p) => {
    const m = new THREE.Mesh(geo, MAT[mat]); m.name = name;
    m.userData = { level: levelTag(p), collides: p.levels };
    return m;
  };
  const levelTag = p => p.y0 === Y2 || (p.levels.length === 1 && p.levels[0] === 2) ? 2 : (p.levels.length === 2 || p.type === 'ramp' || p.type === 'incline' || p.type === 'base') ? 0 : 1;
  const yaw = (a, b) => { const [ax, az] = PX(...a), [bx, bz] = PX(...b); return Math.atan2(-(bz - az), bx - ax); };
  const len = (a, b) => { const [ax, az] = PX(...a), [bx, bz] = PX(...b); return Math.hypot(bx - ax, bz - az); };
  // shape in local (x, -z), extruded along +y after rotation.x = -PI/2
  const extrude = (name, shape, depth, mat, y0, p) => {
    const m = mesh(name, new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 }), mat, p);
    m.rotation.x = -Math.PI / 2; m.position.y = y0; return m;
  };
  const polyShape = pts => { const s = new THREE.Shape(); pts.forEach(([px, py], i) => { const [x, z] = PX(px, py); i ? s.lineTo(x, -z) : s.moveTo(x, -z); }); return s; };
  const capsuleShape = (L, r0, r1) => { const s = new THREE.Shape(); s.absarc(0, 0, r0, Math.PI / 2, 3 * Math.PI / 2, false); s.lineTo(L, -r1); s.absarc(L, 0, r1, -Math.PI / 2, Math.PI / 2, false); s.closePath(); return s; };
  const oriented = (name, a, b) => { const grp = new THREE.Group(); grp.name = name + '_pivot'; grp.position.copy(V3(a[0], a[1], 0)); grp.rotation.y = yaw(a, b); return grp; };
  const cyl = (r, h, seg = 20) => new THREE.CylinderGeometry(r, r, h, seg);
  /**
   * A RAMP, THE RIGHT WAY UP AND WITH A CHANNEL IN IT.
   *
   * Two faults in the first export, both Matt's: *"Claude Design created the ramps backwards. The
   * top part of the ramps are lower on the board - closer to the bottom paddles."* and *"The ramps
   * are also flat, perfectly rectangular boards... they should be kind of curved and easy for the
   * ball to roll up."*
   *
   * WHICH END IS HIGH. The upper deck is at the TOP of the board, which is SMALL z. So a ramp must
   * be high at z[0] and low at z[1]; the old box was tilted the other way, so both ramps climbed
   * toward the flippers and led nowhere.
   *
   * AND IT IS NOT A PLANK. The elevation eases in and out (smoothstep) instead of being a straight
   * wedge, so a ball meets the foot of the ramp almost level and is not stopped dead by a lip; and
   * the cross-section is a shallow CHANNEL with raised rails, which is what keeps the ball on it.
   */
  const rampCurved = (name, x, z, mat, p, yOff = 0) => {
    // THE CROSS-SECTION IS THE WHOLE PROBLEM WITH HOW THESE LOOK. Matt, with three screenshots:
    // *"Look how messy and ugly this is."* They read as warped sheets of card with a scallop cut
    // out of the bottom, and the reason is NW: at 13 samples across, a rail living in the outer 12%
    // is ONE vertex. One vertex is not a rail, it is a spike - which is the odd fold line running
    // down the middle of each ramp in his pictures - and with nothing standing up at the edges the
    // rest is just a bent plane.
    //
    // 30 samples across gives the rail five, which is enough to read as a wall with a rounded top.
    const NL = 56, NW = 30;
    const xf = p.xFoot || x;
    const z0 = z[0], z1 = z[1];
    // Taller, wider rails. RAIL_W is the fraction of the width each rail occupies.
    const RAIL = 0.020, RAIL_W = 0.17, DIP = 0.0022, T = 0.006;
    // elevation along the ramp: 1 at z0 (top of the board, deck height), 0 at z1 (playfield)
    const ease = (t) => t * t * (3 - 2 * t);
    const pos = [], idx = [];
    for (let i = 0; i <= NL; i++) {
      const t = i / NL;                                  // 0 at z1 (low) .. 1 at z0 (high)
      const pz = z1 + (z0 - z1) * t;
      const yBase = Y1 + (Y2 - Y1) * ease(t) + yOff;
      for (let j = 0; j <= NW; j++) {
        const u = j / NW;
        const e = Math.min(u, 1 - u);
        // A rounded rail rather than a spike: cosine, so the top of the wall is a curve and the
        // inside face meets the floor smoothly instead of at a crease.
        const k = e < RAIL_W ? (RAIL_W - e) / RAIL_W : 0;
        // AND IT DIES AWAY AT THE MOUTH. A rail standing full height at the very foot is a lip the
        // ball has to climb before it is even on the ramp - and it is what cut that scalloped
        // notch out of the bottom edge in Matt's screenshots. It grows in over the first sixth of
        // the run, so the mouth is flush with the playfield and the channel forms above it.
        const grow = Math.min(1, t / 0.16);
        const rail = (1 - Math.cos(k * Math.PI)) / 2 * RAIL * grow;
        const dip = -DIP * Math.sin(Math.PI * u) * grow;
        // `t` is 0 at the mouth and 1 at the top. Cubing the blend keeps the lane close to the
        // mouth line for the first stretch and then sweeps it across, which is the bend the
        // reference photo shows - and it is a bend rather than a taper, which the old linear
        // blend could never be.
        const bend = t * t * (3 - 2 * t) * 0.45 + t * 0.55;
        const x0 = xf[0] + (x[0] - xf[0]) * bend, x1 = xf[1] + (x[1] - xf[1]) * bend;
        const px = x0 + (x1 - x0) * u;
        const v = V3(px, pz, yBase + rail + dip);
        pos.push(v.x, v.y, v.z);
      }
    }
    // the same surface again, T lower, so the ramp has a visible underside
    const top = (NL + 1) * (NW + 1);
    for (let k = 0; k < top; k++) pos.push(pos[k * 3], pos[k * 3 + 1] - T, pos[k * 3 + 2]);
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    for (let i = 0; i < NL; i++) {
      for (let j = 0; j < NW; j++) {
        const a = i * (NW + 1) + j;
        quad(a, a + 1, a + NW + 2, a + NW + 1);
        const b = top + a;
        quad(b, b + NW + 1, b + NW + 2, b + 1);
      }
      // the two long edges, closed
      const l = i * (NW + 1), r = l + NW;
      quad(l, l + NW + 1, top + l + NW + 1, top + l);
      quad(r, top + r, top + r + NW + 1, r + NW + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return mesh(name, geo, mat, p);
  };

  for (const p of P) {
    switch (p.type) {
      case 'base': {
        const m = mesh(p.name, new THREE.BoxGeometry(986 * S, 0.004, 1990 * S), 'black', p); m.position.y = 0.002; g.add(m); break;
      }
      case 'poly': g.add(extrude(p.name, polyShape(p.pts), p.d, p.mat, p.y0, p)); break;
      case 'band': {
        // outline = outer edge (left end -> top -> right end), right end cap, inner edge reversed, left end cap
        const Q = (px, py) => { const [x, z] = PX(px, py); return [x, -z]; };
        const o = smoothEdge(p.outer), n = smoothEdge(p.inner), sh = new THREE.Shape();
        const pts = [...o, [o[o.length - 1][0], p.yEndR], [n[n.length - 1][0], p.yEndR], ...[...n].reverse(), [n[0][0], p.yEndL], [o[0][0], p.yEndL]];
        pts.forEach(([px, py], i) => i ? sh.lineTo(...Q(px, py)) : sh.moveTo(...Q(px, py)));
        sh.closePath();
        g.add(extrude(p.name, sh, p.h, p.mat, p.y0, p)); break;
      }
      case 'gate':
      case 'wall': {
        const grp = oriented(p.name, p.a, p.b), L = len(p.a, p.b);
        const m = mesh(p.name, new THREE.BoxGeometry(L, p.h, p.t), p.mat, p); m.position.set(L / 2, p.y0 + p.h / 2, 0);
        grp.add(m); g.add(grp); break;
      }
      case 'post': {
        const m = mesh(p.name, cyl(p.r, p.h, 16), p.mat, p); m.position.copy(V3(...p.at, p.y0 + p.h / 2)); g.add(m); break;
      }
      case 'disc': {
        const m = mesh(p.name, cyl(p.r, 0.0015, 24), p.mat, p); m.position.copy(V3(...p.at, p.y0 + 0.00075)); g.add(m); break;
      }
      case 'bumper': {
        // THE MESH FOLLOWS THE FOOTPRINT. A bumper may carry its own `r` now, and a skirt drawn at
        // the shared BUMPER_R while the collider used a smaller one would be the drift this board
        // exists to avoid: what you see and what the ball hits have to be the same circle.
        const br = p.r || BUMPER_R, k = br / BUMPER_R;
        const skirt = mesh(p.name + '_skirt', cyl(br, 0.005, 32), 'black', p); skirt.position.copy(V3(...p.at, p.y0 + 0.0025));
        const body = mesh(p.name + '_body', cyl(0.028 * k, 0.02, 32), 'cream', p); body.position.copy(V3(...p.at, p.y0 + 0.015));
        const cap = mesh(p.name + '_cap', new THREE.SphereGeometry(0.031 * k, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'cream', p);
        cap.scale.y = 0.45; cap.position.copy(V3(...p.at, p.y0 + 0.025));
        g.add(skirt, body, cap); break;
      }
      case 'flipper': {
        const grp = oriented(p.name, p.pivot, p.tip), L = len(p.pivot, p.tip);
        grp.add(extrude(p.name + '_rubber', capsuleShape(L, FLIP_R0, FLIP_R1), 0.013, 'red', p.y0, p));
        grp.add(extrude(p.name + '_top', capsuleShape(L - 0.002, FLIP_R0 - 0.004, FLIP_R1 - 0.003), 0.003, 'cream', p.y0 + 0.013, p));
        g.add(grp); break;
      }
      case 'sling': {
        const shrink = pts => { const c = pts.reduce((s, q) => [s[0] + q[0] / 3, s[1] + q[1] / 3], [0, 0]); return pts.map(q => [c[0] + (q[0] - c[0]) * 0.72, c[1] + (q[1] - c[1]) * 0.72]); };
        g.add(extrude(p.name + '_rubber', polyShape([p.A, p.B, p.C]), 0.012, 'red', p.y0, p));
        g.add(extrude(p.name + '_top', polyShape(shrink([p.A, p.B, p.C])), 0.003, 'cream', p.y0 + 0.012, p));
        ['A', 'B', 'C'].forEach(k => { const m = mesh(`${p.name}_post_${k}`, cyl(SLING_POST_R, 0.024, 16), 'steel', p); m.position.copy(V3(...p[k], p.y0 + 0.012)); g.add(m); });
        break;
      }
      case 'ramp': g.add(rampCurved(p.name, p.x, p.z, p.mat, p)); break;
      case 'incline': g.add(rampCurved(p.name, p.x, p.z, p.mat, p)); break;
      case 'plunger': {
        const m = mesh(p.name, cyl(0.004, p.len, 12), 'steel', p); m.rotation.x = Math.PI / 2; m.position.copy(V3(...p.at, Y1 + 0.0135));
        const knob = mesh(p.name + '_knob', new THREE.SphereGeometry(0.009, 16, 12), 'red', p); knob.position.copy(V3(p.at[0], 1985, Y1 + 0.0135));
        g.add(m, knob); break;
      }
      case 'targets': {
        p.xs.forEach((x, i) => { const m = mesh(`${p.name}_${i + 1}`, new THREE.BoxGeometry(45 * S, 0.02, 22 * S), 'cream', p); m.position.copy(V3(x, p.z, p.y0 + 0.01)); g.add(m); });
        break;
      }
      case 'saucer': {
        const ring = mesh(p.name + '_ring', cyl(0.018, 0.003, 32), 'cream', p); ring.position.copy(V3(...p.at, p.y0 + 0.0015));
        const hole = mesh(p.name + '_hole', cyl(0.009, 0.002, 24), 'darkwood', p); hole.position.copy(V3(...p.at, p.y0 + 0.003));
        g.add(ring, hole); break;
      }
      case 'wedge': {
        const [dx, dz] = p.d, n = Math.hypot(dx, dz), L = 0.032, w = 0.015;
        const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(L, -w / 2); s.lineTo(L, w / 2); s.closePath();
        const grp = oriented(p.name, p.tip, [p.tip[0] + dx, p.tip[1] + dz]);
        grp.add(extrude(p.name, s, 0.0015, 'green', p.y0, p)); g.add(grp); break;
      }
      case 'teardrop': {
        const s = new THREE.Shape(); const Q = (px, py) => { const [x, z] = PX(px, py); return [x, -z]; };
        s.moveTo(...Q(490, 1050));
        s.bezierCurveTo(...Q(560, 1060), ...Q(640, 1300), ...Q(640, 1400));
        s.bezierCurveTo(...Q(640, 1520), ...Q(330, 1520), ...Q(330, 1400));
        s.bezierCurveTo(...Q(330, 1300), ...Q(420, 1060), ...Q(490, 1050));
        g.add(extrude(p.name, s, 0.0008, 'decal', p.y0, p)); break;
      }
    }
  }
  return g;
}
