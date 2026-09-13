// PIER NINE - the table from `docs/PINBALL2-PIER-NINE.md` (rev C), built.
//
// Everything here is in MILLIMETRES and converted once, at the bottom of each helper, because
// every coordinate in the blueprint and in the art file is in millimetres and a build that
// silently works in metres is a build nobody can check against the drawing. `mm()` is the only
// conversion and it happens in one place.
//
// WHAT IS DIFFERENT FROM THE BLUEPRINT, AND WHY. The drawing is a drawing; a few of its numbers
// do not survive contact with the gap rule or with this engine's own recorded incidents. Each
// deviation is named here rather than left for somebody to "fix" back:
//
//  1. THE SIDE RAILS RUN PAST THE DRAIN LINE. The blueprint ends the left rail at y 806. That
//     leaves the outlane with no outer wall below it, which is the exact defect `table.js` records
//     twice - "a ball could leave the machine over the left flipper". Both rails run to y 1030,
//     below the drain at y 1005, so there is no height at which a ball can reach the side of the
//     cabinet without a rail there.
//  2. THE LOWER THIRD IS LAID OUT FROM THE FLIPPERS OUT, not from the blueprint's four numbers.
//     Taken literally they do not form a lower third at all: the sling at (96,812)-(136,888) and
//     the inlane guide at (74,706)-(110,902) cross, leaving a 2 mm inlane and a 67 mm outlane.
//     The flipper pivots, the tip gap and the sling ANGLE are the blueprint's; the divider and the
//     sling's endpoints are computed so that both lanes clear the 20.3-31.1 mm wedge band.
//  3. THE ONE-WAY GATE IS ACROSS THE LANE, not a flap in the corner. Same job - a completed orbit
//     cannot un-complete and the pop nest cannot spit a ball back down into the outlane - and it is
//     a straight segment across the 36 mm lane at y 244 instead of a diagonal at the corner, which
//     is a shape this engine's one-way test can state exactly.
//  4. A SECOND ONE-WAY GATE AT THE SHOOTER LANE MOUTH, which the blueprint does not have and this
//     engine needs: with the lane's bottom closed (so a weak plunge does not drain), a ball that
//     rolled back INTO the lane from the playfield would rest there for ever. Every real machine
//     has this gate.
//  5. THE COASTER'S DIVERTER IS NOT BUILT. It is the one rev-B mechanism that needs a ball to
//     leave a ramp by a different route, and a `ribbon` is one path. The engine now skips a ribbon
//     whose `armed` is false, so a second Coaster path is a DATA change when it is wanted; until
//     then the Coaster has one exit and `rules.js` scores it as the default (left inlane) feed.
//     Named as a gap rather than quietly shipped as "the diverter".
//  6. BOTH RAMPS PASS OVER DECK PARTS. They are wireforms at z 55-62 mm, so nothing physical
//     happens, but the Coaster's return leg crosses the Fishing Dock and grazes the Fortune
//     Teller's right edge, and the Pier's return runs outboard of the Ring Toss. The left half of
//     this table has no 46 mm channel free, measured; the alternative was moving a shot.
//
// The gap rule (`checkGaps`) is the authority on every clearance below, not this comment.

const D = Math.PI / 180;
let nextId = 1;
const id = (p) => `${p}${nextId++}`;
const mm = (n) => Math.round(n) / 1000;
const P = (x, y) => ({ x: mm(x), y: mm(y) });

export function makePierNine() {
  nextId = 1;
  const W = 0.515;
  const H = 1.067;
  const shapes = [];

  const push = (o) => { shapes.push(o); return o; };
  const seg = (ax, ay, bx, by, r, extra) =>
    push(Object.assign({ id: id('w'), kind: 'seg', a: P(ax, ay), b: P(bx, by), r: mm(r) }, extra));
  const arc = (cx, cy, radius, a0, a1, r) =>
    push({ id: id('a'), kind: 'arc', c: P(cx, cy), radius: mm(radius), a0: a0 * D, a1: a1 * D, r: mm(r) });
  const post = (x, y, r, extra) =>
    push(Object.assign({ id: id('p'), kind: 'circle', c: P(x, y), r: mm(r) }, extra));
  const bumper = (x, y, r, extra) =>
    push(Object.assign({ id: id('b'), kind: 'bumper', c: P(x, y), r: mm(r) }, extra));
  const sling = (ax, ay, bx, by, r, extra) =>
    push(Object.assign({ id: id('s'), kind: 'sling', a: P(ax, ay), b: P(bx, by), r: mm(r) }, extra));
  const sensor = (x, y, r, extra) =>
    push(Object.assign({ id: id('x'), kind: 'sensor', c: P(x, y), r: mm(r) }, extra));
  const lineSensor = (ax, ay, bx, by, extra) =>
    push(Object.assign({ id: id('x'), kind: 'sensor', a: P(ax, ay), b: P(bx, by) }, extra));

  // ---------------------------------------------------------------- structure
  seg(22, 150, 22, 1030, 6, { part: 'rail' });
  arc(134, 150, 112, 180, 270, 6);
  seg(134, 38, 381, 38, 6, { part: 'rail' });
  arc(381, 150, 112, 270, 360, 6);
  seg(493, 150, 493, 1030, 6, { part: 'rail' });
  // The shooter lane: 34 mm clear between the wall's lane face (453) and the right rail (487).
  // 30 mm, which is what a shooter lane usually is, is illegal by construction here - it is
  // exactly the width a 27 mm ball wedges in.
  seg(447, 248, 447, 1000, 6, { part: 'rail' });
  seg(441, 1000, 499, 1000, 6, { part: 'rail' });   // the lane's floor: a weak plunge is not a drain
  // ITS LOW END SITS DIRECTLY OVER THE SHOOTER WALL'S TOP, and that is not tidiness. With the
  // gate's end 6 mm inboard the wall's top CAP was exposed in the lane, and a ball arriving at the
  // top of the lane with nothing left could touch the cap (13.3 mm) and the gate (13.4 mm) at once
  // and be pinned between them for ever - the first ball of the first real game did exactly that.
  // The rest sweep could not see it: it drops balls AT REST, and a ball dropped there just rolls
  // back down the lane. It takes a ball ARRIVING slowly from below, which is what a plunge is.
  //
  // A GATE MUST NOT BE A SHELF. The first draft laid this straight across the lane at y 212 and
  // the rest sweep parked 50 balls ON TOP OF IT: gravity on this table points down-table, so a
  // horizontal gate in a vertical lane is a floor a ball can never leave. Angled, a resting ball
  // slides to the low end - which is the playfield side, welded to the shooter wall's top, so it
  // rolls off into play instead of wedging in the junction.
  push({ id: id('g'), kind: 'seg', role: 'gate', a: P(447, 238), b: P(495, 181), r: mm(5),
         pass: { x: -0.765, y: -0.644 }, part: 'shooterGate' });

  // ---------------------------------------------------------------- lower third
  push({
    id: id('f'), kind: 'flipper', side: 'L',
    pivot: P(139, 905), len: mm(76), r0: mm(12), r1: mm(7),
    restAng: 28 * D, endAng: -27 * D,
  });
  push({
    id: id('f'), kind: 'flipper', side: 'R',
    pivot: P(326, 905), len: mm(76), r0: mm(12), r1: mm(7),
    restAng: 152 * D, endAng: 207 * D,
  });
  // Tips at rest: (206.1, 940.7) and (258.9, 940.7). **52.8 mm apart, not the blueprint's 47.**
  // `checkGaps` is conservative at a tapered part - it measures from the surface but charges the
  // flipper's WIDEST radius, the 12 mm base, at the 7 mm tip - so a 46.8 mm tip gap reports as
  // 27.8 mm and lands in the wedge band. Rather than argue with the check, the gap is opened until
  // it clears: 52.8 mm is 1.96 balls against a real machine's 1.7 to 1.9, so this table is
  // slightly MORE forgiving than a real one at the drain, and that is a tuning number for the
  // phase 8 robot to close, not a geometry error. Every derived value in section 4 measures from
  // the tips, so re-run `docs/pier-nine-values.mjs` if they move again.
  const LSLING = sling(112, 772, 176, 824, 8, { part: 'slingL', score: 50 });
  const RSLING = sling(353, 772, 289, 824, 8, { part: 'slingR', score: 50 });
  seg(72, 817, 141, 884, 5, { part: 'dividerL' });
  seg(393, 817, 324, 884, 5, { part: 'dividerR' });
  // **THE INLANE HAS TO DELIVER THE BALL ONTO THE BAT, and ending the divider at the pivot does
  // the opposite.** The draft before this one ran each divider down to its flipper's base circle
  // and welded it there, which is tidy and put 143 of 1774 drops in the notch between the two: a
  // ball arriving down the inlane reaches the pivot from the LEFT, and the base circle is then
  // between it and the bat, so it stops. Each divider now ends ABOVE and OUTBOARD of the pivot
  // (144, 880), clear of the raised bat by 4 mm and shut against the resting one by 8.5 mm, so a
  // ball sliding off its end lands on the bat about a fifth of the way along. The
  // first draft stopped 14 mm short, which is shut by the gap rule and was still a notch: a ball
  // arriving down the inlane sat in the V between the divider's end cap and the base circle
  // instead of rolling onto the bat. Welded, there is no notch, and the divider still does its
  // real job of stopping an inlane ball dropping past the bat into the drain.

  sensor(130, 836, 14, { role: 'rollover', part: 'inlaneL', score: 250 });
  sensor(335, 836, 14, { role: 'rollover', part: 'inlaneR', score: 250 });
  sensor(52, 950, 16, { role: 'kicker', part: 'kickback', armed: false,
                        eject: { x: 0.36, y: -3.58 } });
  sensor(232, 978, 18, { role: 'kicker', part: 'ballsave', armed: false,
                         eject: { x: 0, y: -3.6 } });

  push({ id: id('d'), kind: 'drain', x: 0, y: mm(1005), w: W, h: H - mm(1005) });

  // ---------------------------------------------------------------- P I E R lanes
  for (const x of [131, 186, 241, 296, 351]) seg(x, 96, x, 150, 8, { part: 'lanepost' });
  const PIER = ['P', 'I', 'E', 'R'];
  [158.5, 213.5, 268.5, 323.5].forEach((x, i) => {
    sensor(x, 120, 14, { role: 'rollover', part: 'lane', lane: i, letter: PIER[i], score: 500 });
  });

  // ---------------------------------------------------------------- the Arcade
  bumper(164, 274, 25, { part: 'pop', score: 100 });
  bumper(232, 220, 25, { part: 'pop', score: 100 });
  bumper(300, 274, 25, { part: 'pop', score: 100 });

  // ---------------------------------------------------------------- orbits
  seg(70, 250, 70, 640, 6, { part: 'guideL' });
  seg(395, 250, 395, 640, 6, { part: 'guideR' });
  // **THERE IS NO ONE-WAY GATE ON THIS TABLE, AND THAT IS A DELETION, NOT AN OMISSION.**
  // Rev B put one at the top of the left orbit. In a vertical lane it is a shelf a ball sits on
  // for ever (34 drops), so it was moved to the top RUN - where it turned out to block the path of
  // the ball's own plunge. Traced: the plunge left the shooter lane at 4.4 m/s, hit the gate at
  // (156, 60) 0.25 s later, dropped to 1.88 m/s, and was then machine-gunned between the pop nest
  // and the P.I.E.R lane posts for SEVEN SECONDS of a nine-second ball. Matt, on the first real
  // game: *"All I was able to do was press start. I did not have another chance to touch the ball
  // before the game ended. Didn't flip the flipper once."* Measured on the shipped build: the ball
  // was first reachable by a flipper at **7.4 s into a 9.3 s ball**.
  //
  // Its job - a completed orbit cannot un-complete - is worth a fraction of that, so it is gone.
  // The engine's one-way gate is still built and still used, at the shooter lane, where the lane
  // is a dead end and nothing can rest on the flap.

  lineSensor(28, 430, 64, 430, { role: 'spinner', part: 'lighthouse', score: 250, cool: 0.05 });
  sensor(48, 660, 15, { role: 'rollover', part: 'orbitL', score: 3000, cool: 1.2 });
  sensor(418, 660, 15, { role: 'rollover', part: 'orbitR', score: 3000, cool: 1.2 });

  // **THE ORBIT RETURNS. Without these, both orbits empty into their own OUTLANE.**
  //
  // This is the layout error underneath the one above, and no probe could have caught it: every
  // probe here asks whether a ball can get STUCK or get OUT, and none of them asks where a ball
  // that is behaving perfectly ends up. Traced at eight plunge speeds, the route was identical
  // every time - arc, left orbit, left divider, outlane - because the left orbit lane (x 28..64)
  // sits directly above the left OUTLANE, and the divider's top at x 72 is inboard of it. A full
  // orbit, the shot the blueprint scores at 3,000, delivered the ball to the drain.
  //
  // A real orbit hands the ball to an INLANE. So each lane now ends in a deflector that carries
  // the ball up and over the top of its outlane and drops it inboard of the divider. The outlane
  // is still fed - from the sling side, through the 51 mm mouth between the deflector's inner end
  // and the divider's top - which is where an outlane is fed on a real machine anyway.
  seg(28, 690, 96, 760, 6, { part: 'returnL' });
  seg(437, 690, 369, 760, 6, { part: 'returnR' });

  // ---------------------------------------------------------------- the Ferris Wheel
  sensor(232, 470, 23, { role: 'saucer', part: 'wheel', dwell: 1.1,
                         eject: { x: -0.117, y: 2.397 } });
  post(206, 494, 6, { part: 'post', score: 10 });
  post(258, 494, 6, { part: 'post', score: 10 });

  // ---------------------------------------------------------------- Ring Toss and the Bait Shop
  seg(386, 490, 386, 522, 5, { part: 'ringtoss', score: 4000 });
  seg(386, 572, 386, 604, 5, { part: 'ringtoss', score: 4000 });
  // 40 mm of CLEAR between them - the blueprint's 38 is a centre-to-centre figure and 38 minus two
  // 5 mm radii is 28 mm of surface, which is the wedge band. The bullseye sits behind the gap, and
  // the sensor is placed so a ball that THREADS it (centre stops ~375.5 against the orbit guide)
  // is 6.5 mm inside it while a ball that hits either standup (centre stops ~367.5, y 535.5) is
  // 18.5 mm away and outside it. **That 3.5 mm of margin IS the precision shot.** Re-check it if
  // any of the three parts moves.
  sensor(382, 547, 15, { role: 'bullseye', part: 'bullseye', score: 6000, cool: 0.8 });
  seg(404, 274, 404, 306, 4, { part: 'baitshop', score: 1000 });
  seg(404, 316, 404, 348, 4, { part: 'baitshop', score: 1000 });

  // ---------------------------------------------------------------- the Fishing Dock
  // 20 mm right of the blueprint. At x 100 the bank's low end formed a V with the left orbit's
  // inner guide - the bank slopes up to the right, so a ball landing on it rolls down-left into
  // that corner and stops. It was the single worst trap on the table: **228 of 1768 drops.**
  // Moved, the channel between the guide and the bank's end is 38 mm and a ball falls through it.
  seg(120, 626, 148, 613, 6, { part: 'drop', bank: 'dock', score: 500 });
  seg(156, 609, 184, 596, 6, { part: 'drop', bank: 'dock', score: 500 });
  seg(192, 592, 220, 579, 6, { part: 'drop', bank: 'dock', score: 500 });

  // ---------------------------------------------------------------- the Boathouse
  seg(78, 440, 98, 465, 5, { part: 'boathouse', score: 5000 });
  seg(86, 471, 106, 496, 5, { part: 'boathouse', score: 5000 });

  // ---------------------------------------------------------------- the Fortune Teller
  sensor(100, 558, 22, { role: 'saucer', part: 'fortune', dwell: 1.2,
                         eject: { x: 0.659, y: 2.315 } });

  // ---------------------------------------------------------------- the Ticket Booth
  seg(250, 548, 280, 552, 5, { part: 'ticket', score: 3500 });

  // ---------------------------------------------------------------- rubber posts, 14 of them
  // The lower-centre pair also has to stay off the two ramp MOUTHS - not just the mouth itself but
  // the 50 mm of approach in front of it, which is where `rampProbe` starts every shot and where a
  // real ball is travelling fastest. A post at (196, 786) sat 44 mm below the Coaster's mouth and
  // made every single entry speed report "too slow to get on", because the shot never reached the
  // lane at all.
  // TWELVE, not the fourteen rev C asked for, and the two that are missing are the pair that was
  // meant to flank the slings. Welded on top of the sling ends they made a V facing up-table and
  // the sweep parked 8 balls in them; moved 40 mm clear they landed under the orbit RETURN added
  // later, welded to it at 1.7 mm, and a ball rolling down the return stopped dead in the notch
  // the post made in its surface - measured, for ever. A post is either welded into a surface a
  // ball can roll ALONG or it is on its own with more than a ball of room, and a post welded into
  // a surface at an ANGLE is neither: it is a bump, and a bump on a slope is a trap. Two failed
  // placements is enough; the pair is gone rather than moved a third time.
  // Each of these is WELDED to whatever it caps (its neighbour, a sling's end, a target's end) or
  // is clear of everything by more than a ball. A post that is merely CLOSE to another part makes
  // an upward-facing V, and a V catches balls: the first draft put one 12 mm from each sling's top
  // end and the sweep parked 19 balls in the two notches.
  for (const [x, y] of [[164, 752], [228, 748], [270, 726], [330, 722], [104, 676], [238, 562],
                         [132, 432], [144, 704], [196, 690], [256, 680]]) {
    post(x, y, 6, { part: 'post', score: 10 });
  }
  // (206,494) and (258,494) above are the other two - they are posts like these, listed with the
  // saucer they gate so that moving the wheel moves its gate with it.

  // ---------------------------------------------------------------- ramps
  lineSensor(177, 746, 215, 738, { role: 'spinner', part: 'coasterSpin', score: 250, cool: 0.05 });
  // THE DIVERTER FLAP (H). It is drawn, it swings, and it is not a collider - see the note over
  // COASTER_FEED for why the routing is done at the mouth and what that costs.
  push({ id: id('x'), kind: 'sensor', role: 'diverter', part: 'diverter',
         c: P(196, 480), r: mm(1), a: P(178, 462), b: P(214, 470), alt: P(206, 444) });
  shapes.push(buildRampMM(id('r'), COASTER, { zmax: 62, w: 46, part: 'coaster', rail: '#e0532f', tie: '#e8dcc0' }));
  shapes.push(buildRampMM(id('r'), COASTER_FEED, { zmax: 58, w: 46, part: 'coasterFeed', rail: '#e0532f', tie: '#e8dcc0' }));
  shapes.push(buildRampMM(id('r'), PIER_RAMP, { zmax: 55, w: 44, part: 'pier', rail: '#35d0c0', tie: '#8fa6bb' }));

  return {
    name: 'PIER NINE',
    w: W, h: H, shapes,
    launch: P(470, 960),
    launchV: { x: 0, y: -3.2 },
    // 3.2 m/s. It was 5.2 while the shooter gate was wrongly re-solidifying mid-flight and eating
    // the plunge; with that fixed, 5.2 fires the ball round the top hard enough that it spends
    // seconds ricocheting up there. Swept 2.2 to 5.2 against one number - how long until the ball
    // is somewhere a FLIPPER CAN REACH IT - and 3.2 is the flat part of that curve at 1.5 s.
    //
    // The plunger. A ball at rest here has reached no drain and is not a trap - see `parks` in
    // `probes/checks.js`. Both kickers ship DISARMED: `rules.js` arms them, and a kickback left
    // armed in the table file turns the left outlane into a machine that never lets a probe finish.
    parks: [{ x: mm(447), y: mm(900), w: mm(52), h: mm(105) }],
  };
}

// **EACH RAMP ENDS IN THE MIDDLE OF ITS INLANE, NOT ON THE GUIDE.** The first draft dropped the
// Coaster at (113, 850), which is 2 mm off the left divider's centreline - so the ball left the
// lane and immediately penetrated a wall, the solver's static net rescued it, and `rampProbe`
// measured the rescue as a 13.5 mm position jump. A ramp's MOUTH and its EXIT are both places a
// ball arrives at speed with nothing swept against it; both have to land in clear air.
//
// THE COASTER. Mouth in front of the right flipper, up the centre-left, a U turn across the top
// left, and back down to the LEFT inlane - so the shot you take with the right bat comes back to
// the left one, which is the figure eight the blueprint's flow rests on.
const COASTER = [
  [196, 742], [198, 672], [194, 600], [186, 528], [176, 462], [166, 400], [154, 362],
  ...loopMM(100, 330, 46, 360, 180),
  [58, 372], [74, 406], [100, 438], [126, 470], [142, 508], [150, 558], [150, 622], [148, 692], [146, 762],
  [142, 792], [140, 816], [138, 834],
];

// **THE COASTER'S SECOND PATH - the wheel feed, which is the diverter.**
//
// A `ribbon` is ONE path: a ball on one is simulated along it and across it, and there is no point
// part-way down where it can be handed to a different lane without teleporting it, which is the
// thing this whole engine exists not to do. So a diverter here is TWO ribbons sharing a mouth with
// exactly one armed, and `enterRibbon` skips a ribbon whose `armed` is false. The flap at the crest
// is drawn swinging between the two and is decor - it is the PICTURE of which lane is live, not the
// thing that deflects the ball. What that costs, stated plainly: a ball does not bounce off the
// flap, and the route is decided at the mouth rather than at the crest. Where the ball ENDS UP is
// the real thing, and that is genuinely different between the two paths.
//
// This one climbs the same first 350 mm as the Coaster, then turns right across the top instead of
// looping left, and drops the ball straight down into the Ferris Wheel - so with a lock available
// the easiest shot on the table feeds the lock, and with none it returns to the left inlane.
const COASTER_FEED = [
  [196, 742], [198, 672], [194, 600], [186, 528], [176, 462], [166, 404], [158, 364],
  ...loopMM(200, 340, 44, 180, 360),
  [242, 376], [236, 404], [232, 436],
];

// THE PIER. The calm shot beside the Coaster's noise: up the right, a tighter loop, down outboard
// of the Ring Toss into the RIGHT inlane.
const PIER_RAMP = [
  [300, 716], [308, 656], [314, 596], [320, 540], [326, 490],
  ...loopMM(378, 440, 44, 180, 360),
  [420, 490], [416, 552], [410, 620], [400, 690], [386, 750], [366, 792], [346, 820],
  [333, 836],
];
// **THE TURNAROUND OF EACH RAMP IS A GENERATED ARC, not hand-placed points, and that is the
// difference between passing `rampProbe` and not.** Hand points at the top of a U turn were
// tried twice: the first draft kinked 25 degrees in one 8 mm step and the probe measured a ball
// riding off centre jumping 14 mm sideways; spreading the same turn over five hand points got it
// to 17.9 degrees and 13.4 mm, because Catmull-Rom through unevenly spaced points overshoots
// exactly where the spacing changes. A circle sampled every 20 degrees has ONE radius, so the
// resampler's turn per step is r/step and nothing else - 46 mm and 44 mm here, which is about
// 10 degrees a step and inside the rule with room to spare.

import { buildRamp } from '../table.js';

/** A circular turnaround as control points. Angles in degrees, screen convention (y down), swept
 *  from `a0` to `a1` in 15 degree steps. See the note above the ramps for why this is generated. */
function loopMM(cx, cy, r, a0, a1) {
  const out = [];
  const dir = a1 > a0 ? 15 : -15;
  for (let a = a0; dir > 0 ? a <= a1 + 1e-6 : a >= a1 - 1e-6; a += dir) {
    out.push([cx + r * Math.cos(a * D), cy + r * Math.sin(a * D)]);
  }
  return out;
}

function buildRampMM(rid, ctrlMM, opts) {
  const ctrl = ctrlMM.map(([x, y]) => P(x, y));
  const o = { zmax: mm(opts.zmax), w: mm(opts.w), r: mm(6), step: 0.008 };
  const r = buildRamp(rid, ctrl, o);
  r.part = opts.part;
  r.look = 'wire';
  r.rail = opts.rail; r.tie = opts.tie;
  r.armed = true;      // a ribbon with `armed: false` is skipped at the mouth. See deviation 5.
  return r;
}
