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

export const VERSION = 'v6 — arches: flat crown, measured edges';
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
const post  = (name, at, r, h, y0, mat, levels) => P.push({ type: 'post', name, at, r, h, y0, mat, levels });
const disc  = (name, at, r, y0, mat, lit) => P.push({ type: 'disc', name, at, r, y0, mat, lit, levels: [] });
const mirror2 = (fn) => fn(false) || fn(true);

// cabinet
P.push({ type: 'base', name: 'cabinet_floor', levels: [] });
P.push({ type: 'poly', name: 'playfield_L1', pts: [[45,40],[955,40],[955,1750],[891,1750],[891,1650],[600,1880],[390,1880],[45,1650]], y0: 0.004, d: Y1 - 0.004, mat: 'maple', levels: [] });
P.push({ type: 'poly', name: 'deck_L2', pts: [[45,40],[955,40],[955,640],[782,640],[545,724],[455,724],[218,640],[45,640]], y0: Y2 - 0.012, d: 0.012, mat: 'deckwood', levels: [] });
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
wall('wall_right_upper', [963.5, 0],   [963.5, 300],  45 * S, 0.09, 0, 'darkwood', [1],    'closed on L1; open on L2, which is the shooter lane feed');
// THE FEED ITSELF. A gap alone is not a feed: traced, a plunged ball rose the full length of the
// chute at x 1020, hit the top wall square on and came straight back down, twelve times. Every
// real machine has a curved guide across the top of the shooter lane that turns the ball into the
// playfield, and this is it - a diagonal on level 2 only, so the lower playfield never sees it.
wall('chute_feed', [1076, 210], [968, 60], 0.006, 0.03, Y2, 'steel', [2], 'turns a rising plunge left, out of the lane and onto the deck');
wall('wall_top',    [0, 20],     [1100, 20],   40 * S, 0.09, 0, 'darkwood', [1, 2]);
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
wall('ledge_left',  [218, 640], [455, 724], 0.008, 0.024, Y2 - 0.012, 'darkwood', [2]);
wall('ledge_right', [782, 640], [545, 724], 0.008, 0.024, Y2 - 0.012, 'darkwood', [2]);
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
  [135, 600], [150, 540], [170, 490], [200, 440], [218, 400], [232, 380], [244, 360], [252, 340], [268, 320], [290, 310], [350, 306], [430, 305], [500, 305], [570, 305], [650, 306], [700, 306],
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

P.push({ type: 'band', name: 'arch_outer', outer: OUTER_OUT, inner: OUTER_IN, yEndL: 908, yEndR: 908, h: 0.028, y0: Y1, mat: 'band', levels: [1] });
P.push({ type: 'band', name: 'arch_inner', outer: INNER_OUT, inner: INNER_IN, yEndL: 796, yEndR: 796, h: 0.028, y0: Y1, mat: 'band', levels: [1] });
P.push({ type: 'band', name: 'arch_centre', outer: CENTRE_OUT, inner: CENTRE_IN, yEndL: 700, yEndR: 700, h: 0.024, y0: Y1, mat: 'band', levels: [1] });
// short L2 lips closing the deck edge over the arch legs, so the ramp mouths are exactly the ramps' width
// The deck edge is closed everywhere EXCEPT the two ramp mouths, so a ball can only leave the deck
// down a ramp or through the drop hole. The right side needed a second piece: the ramp moved to
// x 866..936, which left the deck edge open from 936 out to the board wall at 941.
// ...and the rest of the deck edge is closed, right out to both cabinet walls, because the old
// outer ramp lanes are gone. A ball can now leave the deck ONLY down a ramp or through the drop
// hole.
wall('ledge_left_ext',   [129, 640],  [218, 640], 0.008, 0.024, Y2 - 0.012, 'darkwood', [2]);
wall('ledge_right_ext',  [782, 640], [866, 640], 0.008, 0.024, Y2 - 0.012, 'darkwood', [2]);
// THE BUTTON IN THE MOUTH OF THE CENTRE ARCH. A real capture hole, not decoration: it carries a
// footprint so the engine can score it, and it sits under the third band's crown.
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
P.push({ type: 'ramp', name: 'ramp_right', x: [866, 936], z: [640, 908], mat: 'ramp', levels: [], note: 'two-way L1<->L2, in the middle shot band' });

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
wall('ramp_rail_left_out',  [45, 640], [45, 908], 0.005, 0.026, Y1, 'steel', [1]);
wall('ramp_rail_left_in',   [129, 640], [129, 908], 0.005, 0.026, Y1, 'steel', [1]);
wall('ramp_rail_right_in',  [866, 640], [866, 908], 0.005, 0.026, Y1, 'steel', [1]);
wall('ramp_rail_right_out', [936, 640], [936, 908], 0.005, 0.026, Y1, 'steel', [1]);
// L1 backstops across each mouth. The transition to L2 fires first; these catch anything it does
// not, so level 1 has no open corridor up a ramp lane.
// AND THE OUTER LANES ARE CLOSED AT THE TOP. They used to be the ramp lanes, so the ramps closed
// them; with the ramps moved inboard they became open corridors running from the flippers to the
// top of the cabinet, and the shot map duly reported balls reaching py 66. An outlane ends at the
// drain, so its top is a wall.
wall('outlane_top_left',  [129, 908],  [250, 908], 0.005, 0.026, Y1, 'steel', [1]);
wall('outlane_top_right', [750, 908], [866, 908], 0.005, 0.026, Y1, 'steel', [1]);
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
P.push({ type: 'ramp', name: 'ramp_left', x: [45, 129], z: [640, 908], mat: 'ramp', levels: [], note: 'two-way L1<->L2, in the middle shot band' });
// left lane guide + posts
// THE LEFT LANE RAIL, MOVED INBOARD. Matt: *"the left is in a spot that is impossible for the ball
// to actually go up. there's a barrier blocking the on ramp part."* Traced: a ball climbing the
// left lane had a clear band only 19 px wide - between the cabinet wall and this rail's posts -
// against a ball 26 px across. The ramp did not need moving; its APPROACH did. At x 148 the lane
// is 0.033 m of clear channel and feeds the ramp mouth square on.
wall('lane_rail_left', [148, 980], [153, 1410], 0.006, 0.014, Y1, 'steel', [1]);
post('post_lane_1', [148, 980], 0.006, 0.022, Y1, 'steel', [1]);
post('post_lane_2', [148, 1100], 0.006, 0.022, Y1, 'steel', [1]);
post('post_lane_3', [148, 1250], 0.006, 0.022, Y1, 'steel', [1]);
// ...and its mirror, which the right ramp needs for exactly the same reason.
wall('lane_rail_right', [833, 980], [838, 1410], 0.006, 0.014, Y1, 'steel', [1]);
post('post_lane_r1', [838, 980], 0.006, 0.022, Y1, 'steel', [1]);
post('post_lane_r2', [838, 1100], 0.006, 0.022, Y1, 'steel', [1]);
post('post_lane_r3', [838, 1250], 0.006, 0.022, Y1, 'steel', [1]);
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
P.push({ type: 'bumper', name: 'bumper_upper_left',  at: [385, 270],  y0: Y2, levels: [2] });
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
[[280, 200], [225, 240], [335, 150], [445, 135], [500, 130], [555, 135], [665, 150], [720, 200], [775, 240]].forEach((a, i) => disc(`insert_dark_L2_${i + 1}`, a, 0.011, Y2, 'unlit', false));
[[190, 185], [250, 155], [796, 185], [736, 155]].forEach((a, i) => disc(`target_disc_${i + 1}`, a, 0.013, Y2, 'olive', false));
P.push({ type: 'saucer', name: 'saucer_left',  at: [85, 110],  y0: Y2, levels: [] });
P.push({ type: 'saucer', name: 'saucer_right', at: [901, 110], y0: Y2, levels: [] });
[[[155, 940], [30, 60]], [[831, 940], [-30, 60]], [[140, 1325], [45, 35]], [[805, 1315], [-45, 35]]].forEach(([tip, d], i) =>
  P.push({ type: 'wedge', name: `insert_green_wedge_${i + 1}`, tip, d, y0: Y1, levels: [] }));
P.push({ type: 'teardrop', name: 'decal_teardrop', y0: Y1, levels: [] });

// ---------------------------------------------------------------- footprints (2D, meters)
const FP = { 1: [], 2: [] };
const addFP = (levels, fp) => levels.forEach(l => FP[l].push(fp));
const circleFP = (name, levels, at, r, extra) => addFP(levels, { name, shape: 'circle', c: PX(...at), r: r4(r), ...extra });
const capsuleFP = (name, levels, a, b, r, extra) => addFP(levels, { name, shape: 'capsule', a: PX(...a), b: PX(...b), r: r4(r), ...extra });
const BUMPER_R = 0.038, FLIP_R0 = 0.012, FLIP_R1 = 0.007, SLING_POST_R = 0.006;
for (const p of P) {
  if (!p.levels.length) continue;
  switch (p.type) {
    case 'wall': capsuleFP(p.name, p.levels, p.a, p.b, p.t / 2, p.note ? { note: p.note } : {}); break;
    case 'post': circleFP(p.name, p.levels, p.at, p.r); break;
    case 'bumper': circleFP(p.name, p.levels, p.at, BUMPER_R, { kicks: true }); break;
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
    case 'sling':
      ['A', 'B', 'C'].forEach(k => circleFP(`${p.name}_post_${k}`, p.levels, p[k], SLING_POST_R));
      capsuleFP(`${p.name}_face_AC`, p.levels, p.A, p.C, 0.003, { kicks: true });
      capsuleFP(`${p.name}_face_AB`, p.levels, p.A, p.B, 0.003);
      capsuleFP(`${p.name}_face_BC`, p.levels, p.B, p.C, 0.003);
      break;
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
    deckwood: mk('deck_maple', 0xB47B36, { roughness: 0.8, transparent: true, opacity: 0.62 }),
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
    decal: mk('decal_dark', 0x1E1409, { roughness: 0.9 }),
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
    const NL = 48, NW = 13;
    // `xFoot` flares the bottom of the ramp to the width of the gap the ball arrives through.
    const xf = p.xFoot || x;
    const z0 = z[0], z1 = z[1];
    const RAIL = 0.014, DIP = 0.0025, T = 0.006;
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
        const rail = e < 0.12 ? ((0.12 - e) / 0.12) ** 2 * RAIL : 0;
        const dip = -DIP * Math.sin(Math.PI * u);
        const x0 = xf[0] + (x[0] - xf[0]) * t, x1 = xf[1] + (x[1] - xf[1]) * t;
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
        const skirt = mesh(p.name + '_skirt', cyl(BUMPER_R, 0.005, 32), 'black', p); skirt.position.copy(V3(...p.at, p.y0 + 0.0025));
        const body = mesh(p.name + '_body', cyl(0.028, 0.02, 32), 'cream', p); body.position.copy(V3(...p.at, p.y0 + 0.015));
        const cap = mesh(p.name + '_cap', new THREE.SphereGeometry(0.031, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'cream', p);
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
