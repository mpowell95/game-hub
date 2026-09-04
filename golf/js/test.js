// golf/js/test.js - the engine suite. `node golf/js/test.js`. No browser, no dependency.
//
// Everything measurable about this game is in a pure module so that it can be measured HERE
// rather than by playing it: the hole data (holes.js + courses/), the bag and the lie table
// (clubs.js), the three-tap meters and the mishit model (swing.js), and the flight, roll and putt
// (shot.js). ui.js is the only file with no coverage here, by design - it owns no rule.
//
// The numbers this file pins are the ones golf-reference-spec.md marks [MEASURED]. Where a value
// is ours, the assertion says so, and the test is a regression guard rather than a claim about
// the reference.

import { validateHole, surfaceAt, pointInPoly, slopeAt, treesOf, distYd, SURFACE_KINDS,
  greenBox as greenBoxOf } from './holes.js';
import { PINE_VALLEY } from '../courses/pinevalley.js';
import { RED_MESA } from '../courses/redmesa.js';
import { COURSES, ROUNDS, roundKey, roundHoles, roundPar, stablefordPoints } from './rounds.js';
import { GOLF_COURSE_PAR, GOLF_BOARD_COURSE } from '../../js/leaderboard-rank.js';
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf, LIES, isPuttable } from './clubs.js';
import * as SW from './swing.js';
import * as SH from './shot.js';

let fail = 0;
const ok = (label, cond, extra) => {
  if (!cond) { fail++; console.log(`FAIL ${label}${extra ? `\n  ${extra}` : ''}`); } else console.log(`ok   ${label}`);
};
const near = (label, got, want, tol) => ok(`${label} (${got.toFixed(3)} vs ${want} +/-${tol})`, Math.abs(got - want) <= tol);

// ---------------------------------------------------------------------------
console.log('\n-- 1. the hole data is valid --');
for (const c of COURSES) {
  let bad = 0;
  for (const h of c.holes) {
    const errs = validateHole(h);
    if (errs.length) { bad++; console.log(`  ${c.id} hole ${h.n}: ${errs.join('; ')}`); }
  }
  ok(`${c.name}: all ${c.holes.length} holes pass validateHole`, bad === 0, `${bad} invalid`);
  ok(`${c.name}: the hole numbers run 1..${c.holes.length} with no gap`,
    c.holes.every((h, i) => h.n === i + 1));
}
ok('Pine Valley is 18 holes of par 72', PINE_VALLEY.holes.length === 18 && PINE_VALLEY.par === 72);
ok('Red Mesa is 18 holes of par 71', RED_MESA.holes.length === 18 && RED_MESA.par === 71);
ok('the two courses have different themes', PINE_VALLEY.theme !== RED_MESA.theme);

// THE FROZEN KEY FALLS OUT OF THE RULE. `pinevalley3` was frozen as a bestRoundByCourse key when
// Pine Valley WAS three holes; the course id is now `pinevalley` and the quick round's suffix is
// `3`, so the key is unchanged with nothing repurposed (THE LAW rule 5).
ok('the quick round on Pine Valley is still the frozen key pinevalley3',
  roundKey(PINE_VALLEY, 'quick3') === 'pinevalley3');
ok('...and the front nine is the pinevalley9 this file promised when holes 4-9 shipped',
  roundKey(PINE_VALLEY, 'front9') === 'pinevalley9');
ok('every round key is distinct across both courses',
  new Set(COURSES.flatMap((c) => ROUNDS.map((r) => roundKey(c, r.id)))).size === COURSES.length * ROUNDS.length);

// js/leaderboard-rank.js copies these pars rather than importing two courses of polygon data onto
// the hub's critical path. This is the link that keeps the copy honest.
for (const c of COURSES) {
  for (const r of ROUNDS) {
    const key = roundKey(c, r.id);
    ok(`GOLF_COURSE_PAR.${key} matches the course data (${roundPar(c, r.id)})`,
      GOLF_COURSE_PAR[key] === roundPar(c, r.id), `table says ${GOLF_COURSE_PAR[key]}`);
  }
}
ok('the leaderboard\'s board round exists in the par table', Number.isFinite(GOLF_COURSE_PAR[GOLF_BOARD_COURSE]));
ok('a round plays the holes it says it does',
  roundHoles(PINE_VALLEY, 'back9').join(',') === '9,10,11,12,13,14,15,16,17');
ok('Stableford still pays 2 for a birdie and -1 for a bogey',
  stablefordPoints(3, 4) === 2 && stablefordPoints(5, 4) === -1 && stablefordPoints(4, 4) === 0);

console.log('\n-- 2. validateHole actually catches a broken hole --');
// A validator nobody has seen fail is a validator nobody knows works.
const clone = () => JSON.parse(JSON.stringify(PINE_VALLEY.holes[0]));
{
  const h = clone(); h.pin = [200, 200];
  ok('a pin outside the green fails', validateHole(h).some((e) => /pin is not inside/.test(e)));
}
{
  const h = clone(); h.green.slope.cells.pop();
  ok('a slope grid with the wrong number of cells fails', validateHole(h).some((e) => /cells, expected/.test(e)));
}
{
  const h = clone(); h.green.slope.cells[0] = [3, 0];
  ok('a gradient outside -1..+1 fails', validateHole(h).some((e) => /\[dx,dy\] pair/.test(e)));
}
{
  const h = clone(); h.surfaces[0].kind = 'lava';
  ok('an unknown surface kind fails', validateHole(h).some((e) => /is not a surface kind/.test(e)));
}
{
  const h = clone(); h.surfaces[1].poly[0] = [9999, 0];
  ok('a point outside bounds fails', validateHole(h).some((e) => /outside bounds/.test(e)));
}
{
  const h = clone(); h.tee = [40, 300];
  ok('a tee not on a tee surface fails', validateHole(h).some((e) => /tee is not inside/.test(e)));
}
{
  const h = clone(); h.treeBelts[0].type = 7;
  ok('a tree belt naming a type that does not exist fails', validateHole(h).some((e) => /does not exist/.test(e)));
}

console.log('\n-- 3. the lie lookup follows the PAINT ORDER --');
// The last polygon containing the point wins, for the lie exactly as for the paint. That one rule
// is what stops the art and the physics ever disagreeing about what the ball is sitting on.
const h1 = PINE_VALLEY.holes[0];
ok('the tee is a tee', surfaceAt(h1, 0, 5) === 'tee');
ok('the pin is on the green', surfaceAt(h1, h1.pin[0], h1.pin[1]) === 'green');
ok('the middle of the fairway is fairway', surfaceAt(h1, 16, 200) === 'fairway');
ok('the lake left of the tee is water', surfaceAt(h1, -40, 30) === 'water');
ok('deep left of the corridor is the base surface', surfaceAt(h1, -52, 200) === 'heavyRough');
ok('the greenside bunker is a greenside bunker', surfaceAt(h1, 0, 340) === 'greensideBunker');
ok('hole 2 is water everywhere except its island', surfaceAt(PINE_VALLEY.holes[1], 30, 100) === 'water');
ok("...and the island's green is a green", surfaceAt(PINE_VALLEY.holes[1], 4, 185) === 'green');
ok('every kind used by every hole is in the closed set',
  PINE_VALLEY.holes.every((h) => h.surfaces.every((s) => SURFACE_KINDS.has(s.kind))));

console.log('\n-- 4. tree belts are DETERMINISTIC --');
// A belt that reshuffled per load would make a hole play differently every visit and make any
// reachability measurement meaningless.
{
  const a = treesOf(PINE_VALLEY.holes[0]).map((t) => `${t.x.toFixed(4)},${t.y.toFixed(4)}`).join('|');
  const fresh = JSON.parse(JSON.stringify(PINE_VALLEY.holes[0]));
  const b = treesOf(fresh).map((t) => `${t.x.toFixed(4)},${t.y.toFixed(4)}`).join('|');
  ok('the same belt expands to the same trees every time', a === b);
  ok('hole 1 has trees lining both sides', treesOf(PINE_VALLEY.holes[0]).length > 60);
  ok("hole 2's island has no trees at all", treesOf(PINE_VALLEY.holes[1]).length === 0);
}

console.log('\n-- 5. the club ladder is the APPROVED one (spec 21.3) --');
ok('the stock driver carries 215, NOT the reference-measured 287', CLUBS[0].carry === 215);
ok('the bag is 14 clubs from driver to lob wedge', CLUBS.length === 14 && CLUBS[13].carry === 50);
ok('the ladder descends with no ties', CLUBS.every((c, i) => i === 0 || CLUBS[i - 1].carry > c.carry));
ok('the putter is NOT in the yardage ladder (it is measured in feet)',
  !CLUBS.some((c) => c.id === 'putter') && PUTTER.maxFeet === 60);
// How the real holes play for a beginner (spec 21.3's own worked example).
ok('hole 1 (360.7, par 4) is a drive plus a 6 iron', CLUBS[0].carry + CLUBS[7].carry >= 350);
ok('hole 2 (181, par 3) is a slightly stretched 2 iron', CLUBS[3].carry === 175 && CLUBS[3].carry * 1.1 > 181);
ok('hole 3 (608.6, par 5) is a genuine three-shot hole',
  CLUBS[0].carry + CLUBS[1].carry * 2 >= 600 && CLUBS[0].carry * 3 < 700);

console.log('\n-- 6. auto-select takes ENOUGH club, not the most club --');
ok('360 yds off the tee offers the driver', autoSelectClub(360, 'tee').id === 'driver');
ok('139 yds from the fairway offers the 6 iron', autoSelectClub(139, 'fairway').id === '6iron');
ok('the green always offers the putter', autoSelectClub(4, 'green').id === 'putter');
ok('a heavy-rough lie takes MORE club for the same distance',
  CLUBS.indexOf(autoSelectClub(139, 'heavyRough')) < CLUBS.indexOf(autoSelectClub(139, 'fairway')));
ok('stepping up from the driver stays on the driver', stepClub(CLUBS[0], +1).id === 'driver');
ok('stepping down from the lob wedge stays on the lob wedge', stepClub(CLUBS[13], -1).id === 'lwedge');

console.log('\n-- 7. ONE NEEDLE, THREE TAPS: the three-click swing --');
// MEASURED off the reference at 60 fps, every frame of a 203-frame clip (swing.js's header has
// the trace). The old build had two meters that never moved together; this has one needle on one
// scale, and these assertions are what separate the two.
near('zero power is the accuracy point, dead centre', SW.backswingAt(0).pos, 0, 1e-9);
near('the backswing reaches 100 % in 1.65 s, not 0.75', SW.backswingAt(SW.UP_MS).pos, 1.0, 1e-9);
ok('the arc continues PAST 100 into the over-swing block', SW.SWING_MAX > 1);
{
  // [KNOWN-BUG PROBE] The downswing is measurably FASTER than the backswing (1.46x). A symmetric
  // sweep - which is what the old build had - gives the player as long to save the strike as to
  // pick the power, and that is not the shape of the original at all.
  const upRate = 1 / SW.UP_MS;
  const downRate = 1 / SW.DOWN_MS;
  ok('[KNOWN-BUG PROBE] the downswing runs ~1.45x faster than the backswing',
    downRate / upRate > 1.35 && downRate / upRate < 1.55,
    `measured 1665 ms/unit up against 1143 ms/unit down; this build is ${(downRate / upRate).toFixed(2)}x`);
}
{
  // Holding past the top is not a free extra lap: the power is spent and the needle is already
  // coming back down.
  const past = SW.backswingAt(SW.TOP_MS + 200);
  ok('holding past the top spends the power at maximum and starts the downswing',
    past.topped && past.power === SW.SWING_MAX && past.pos < SW.SWING_MAX);
}
near('the downswing falls from wherever the power was locked',
  SW.downswingAt(SW.DOWN_MS, 1.0), 0, 1e-9);
{
  const s = new SW.Swing();
  ok('the meter is STATIC until tap 1', s.read(0).pos === 0 && s.read(9999).pos === 0);
  ok('...and nothing is planted on the arc yet', s.read(500).power === null);
  s.tap(0);
  ok('tap 1 starts the backswing', s.phase === SW.PHASE.BACK && s.read(400).pos > 0);
  ok('the marker is still unplanted during the backswing', s.read(400).power === null);
  s.tap(SW.UP_MS);
  near('tap 2 locks the power the needle was showing', s.power, 1.0, 1e-9);
  ok('...and PLANTS it on the arc for the whole downswing',
    s.read(SW.UP_MS + 100).power === 1 && s.read(SW.UP_MS + 800).power === 1);
  ok('[KNOWN-BUG PROBE] the needle KEEPS MOVING after the power is locked',
    s.read(SW.UP_MS + 600).pos < s.read(SW.UP_MS + 100).pos,
    'the old build parked the needle and started a SECOND, independent meter; the reference plants a marker and runs the same needle back down');
  near('it arrives back at zero one downswing later',
    s.read(SW.UP_MS + SW.DOWN_MS).pos, 0, 1e-9);
  const fired = s.tap(SW.UP_MS + SW.DOWN_MS);
  ok('tap 3 fires', fired === 'fire' && s.phase === SW.PHASE.LIVE);
  near('...and a needle stopped exactly on zero is a perfect strike', SW.barPosOf(s.pos), 0.5, 1e-9);
  s.settle(9000);
  ok('input is LOCKED for ~1.4 s after the shot', s.locked(10000) && !s.locked(10500));
  ok('...and a tap during the lock does nothing', s.tap(10000) === null);
}
{
  // The swing must not be able to hang waiting for a tap the player never makes.
  const s = new SW.Swing();
  s.tap(0); s.tap(SW.UP_MS);
  const late = s.read(SW.UP_MS + SW.DOWN_MS * 1.5);
  ok('running the needle off the bottom of the bar EXPIRES the swing', late.expired && late.pos < -SW.BAR_HALF);
  ok('...and that reads as the worst accuracy the bar can express', SW.barPosOf(late.pos) === 1);
}
{
  // A tap after the swing has already topped out is the ACCURACY tap, not a second power tap.
  const s = new SW.Swing();
  s.tap(0);
  const r = s.tap(SW.TOP_MS + 300);
  ok('a tap after the top fires instead of re-locking the power',
    r === 'fire' && s.power === SW.SWING_MAX && s.phase === SW.PHASE.LIVE);
}

console.log('\n-- 8. the accuracy bar is the same needle, magnified --');
near('the bar covers +/- 12 % of power around zero', SW.BAR_HALF, 0.12, 1e-9);
near('dead centre of the bar is zero on the arc', SW.barPosOf(0), 0.5, 1e-9);
ok('the needle enters the bar from the LEFT on the way down and travels right',
  SW.barPosOf(SW.BAR_HALF) === 0 && SW.barPosOf(-SW.BAR_HALF) === 1);
ok('the bar position is LINEAR in the needle position, the way the reference measured',
  Math.abs((SW.barPosOf(0.06) - SW.barPosOf(0)) - (SW.barPosOf(0) - SW.barPosOf(-0.06))) < 1e-9);
{
  const clean = SW.bandsFor(1);
  ok('a clean lie gives the middle 54 % as the straight zone (MEASURED)', Math.abs(clean.green - 0.54) < 1e-9);
  ok('the bands fill the whole bar', Math.abs(clean.red - 1) < 1e-9);
  const sand = SW.bandsFor(LIES.greensideBunker.zone);
  ok('a greenside bunker halves the straight zone', sand.green < clean.green * 0.55);
  ok('...but the bar is still full, so the needle sweeps at the same speed', Math.abs(sand.red - 1) < 1e-9);
}
{
  // [MEASURED, and explicitly retracted in the spec] The window does NOT narrow as power rises.
  const a = SW.bandsFor(1); const b = SW.bandsFor(1);
  ok('[KNOWN-BUG PROBE] the accuracy window does NOT narrow with power',
    JSON.stringify(SW.mishit(0.62, 0.4, 1)) === JSON.stringify(SW.mishit(0.62, 0.4, 1)) && a.green === b.green,
    'the reference LOOKED like it narrowed at 15 fps; measured, the green pixel count is pinned for the whole sweep');
  ok('dead centre is dead straight', SW.mishit(0.5, 1, 1).deg === 0);
  ok('a green-zone stop is effectively straight', Math.abs(SW.mishit(0.62, 1, 1).deg) <= 1.5);
  ok('a red-zone stop also loses 10 % of its distance', SW.mishit(0.99, 1, 1).distanceMul === 0.9);
  ok('a full red miss is 8 degrees', Math.abs(SW.mishit(1, 1, 1).deg - 8) < 1e-9);
  ok('left of centre pulls LEFT, right pushes RIGHT', SW.mishit(0.1, 1, 1).deg < 0 && SW.mishit(0.9, 1, 1).deg > 0);
  ok('over-100 % power multiplies the miss by 1.5',
    Math.abs(SW.mishit(0.9, 1.1, 1).deg - SW.mishit(0.9, 1.0, 1).deg * 1.5) < 1e-9);
  // The spec's own sanity check on the model.
  const off = Math.tan(8 * Math.PI / 180) * 215;
  near('a full red miss with the stock driver lands ~30 yds offline', off, 30, 2);
}

console.log('\n-- 9. flight, roll and the lie factor --');
near('a 215 yd drive flies ~4.5 s', SH.flightMs(215) / 1000, 4.48, 0.05);
near('a 50 yd wedge flies ~1.7 s', SH.flightMs(50) / 1000, 1.73, 0.05);
ok('flight time grows with distance and is never instant', SH.flightMs(0) === 900 && SH.flightMs(300) > SH.flightMs(200));
{
  const r = SH.resolveShot({ hole: h1, from: h1.tee, aimRad: 0.04, club: CLUBS[0], power: 1, mishitDeg: 0 });
  near('a full drive from the tee carries the club distance', r.carry, 215, 0.01);
  ok('it lands on the fairway and rolls', r.landedOn === 'fairway' && r.rollYd > 0);
  // Roll is the surface times HOW FLAT THE CLUB SENDS IT IN, not the surface alone: a driver
  // arrives shallow and runs, a wedge drops almost vertically and sits. The old model gave every
  // club the same 8 % - Matt: "it stops unnaturally short."
  near('a driver runs out about 10 % of its carry on a fairway', r.rollYd / r.carry, 0.099, 0.002);
  {
    const wedge = SH.resolveShot({ hole: h1, from: h1.tee, aimRad: 0.04, club: CLUBS[13], power: 1, mishitDeg: 0 });
    ok('[KNOWN-BUG PROBE] a LOB WEDGE barely runs at all, where the driver runs 21 yds',
      wedge.rollYd < 2 && r.rollYd > 20,
      'the surface-only model rolled the wedge 4 yds and the driver 17, so nothing in the bag behaved like itself');
    const totals = CLUBS.map((c) => {
      const s2 = SH.resolveShot({ hole: h1, from: h1.tee, aimRad: 0.04, club: c, power: 1, mishitDeg: 0 });
      return s2.rollYd;
    });
    ok('...and roll falls monotonically as loft rises, right through the bag',
      totals.every((v, i) => i === 0 || v <= totals[i - 1] + 1e-9));
  }
  ok('the ball finishes past where it landed', r.rest[1] > r.landing[1]);
}
{
  // lieFactor SCALES the result; it does NOT clamp the meter.
  const from = [0, 340];                                     // the greenside bunker on hole 1
  ok('the bunker lie is found', surfaceAt(h1, from[0], from[1]) === 'greensideBunker');
  const r = SH.resolveShot({ hole: h1, from, aimRad: 0, club: CLUBS[11], power: 1, mishitDeg: 0 });
  near('a full swing from sand travels 75 % of the club', r.carry, 95 * 0.75, 0.01);
  // Roll belongs to the surface the ball comes DOWN on, not the one it was struck from - a bunker
  // shot that finishes on the green rolls like a ball on a green. A ball that LANDS in sand plugs.
  const intoSand = SH.resolveShot({ hole: h1, from: [0, 300], aimRad: 0, club: CLUBS[13], power: 0.8, mishitDeg: 0 });
  ok('a ball that lands in sand does not roll', intoSand.landedOn !== 'greensideBunker' || intoSand.rollYd === 0);
  ok('roll is read from the LANDING surface, not the lie played from', lieOf('greensideBunker').roll === 0);
  const over = SH.resolveShot({ hole: h1, from, aimRad: 0, club: CLUBS[11], power: 1.1, mishitDeg: 0 });
  ok('the player can still swing PAST 100 % from a bad lie', over.carry > r.carry);
  near('over-100 % is worth up to +10 % distance', over.carry / r.carry, 1.1, 0.001);
}
{
  const dots = SH.aimDots(CLUBS[0], 'fairway');
  ok('the aim ladder is five dots', dots.length === 5);
  near('dot 4 is the club\'s full distance', dots[3].at, 215, 0.01);
  ok('dots 1-3 are 25/50/75 % of it', Math.abs(dots[0].at - 53.75) < 0.01 && Math.abs(dots[2].at - 161.25) < 0.01);
  ok('dot 5 is the risk band past 100 %', dots[4].risk && dots[4].at > dots[3].at);
  const sandDots = SH.aimDots(CLUBS[0], 'greensideBunker');
  ok('the ladder RE-SCALES for a bad lie, so it never lies about where a perfect strike lands',
    Math.abs(sandDots[3].at - 215 * 0.75) < 0.01);
  ok('the ladder re-scales when the club changes', SH.aimDots(CLUBS[7], 'fairway')[3].at === 139);
  ok('there is no ladder for the putter', SH.aimDots(PUTTER, 'green').length === 0);
}

console.log('\n-- 10. trees block the ball, and loft is the way past them --');
{
  // A trunk blocks at any height; a canopy blocks only a ball travelling below its own height.
  // That pair IS the punch-low-or-loft-over decision, and it needs no extra UI.
  const h3 = PINE_VALLEY.holes[2];
  const tree = h3.trees[0];                                    // the lone oak: canopy 8, height 13
  // 20 yds behind the tree and 4 yds off its trunk: inside the 8 yd canopy, clear of the 1 yd
  // trunk. That offset is the whole point - a TRUNK blocks at any height, so lofting over a tree
  // you are dead in line with is not one of the options. The canopy is what loft beats.
  const from = [tree.x - 4, tree.y - 20];
  const low = SH.resolveShot({ hole: h3, from, aimRad: 0, club: CLUBS[0], power: 1, mishitDeg: 0 });
  ok('a driver punched at a tree 20 yds ahead is stopped by it', !!low.blocked,
    `a driver is only ${(SH.flightPoint(20 / 215, 215, 0, SH.apexYd(CLUBS[0], 215)).height).toFixed(1)} yds up at the tree`);
  ok('...and a blocked ball does not roll', low.rollYd === 0);
  const high = SH.resolveShot({ hole: h3, from, aimRad: 0, club: CLUBS[13], power: 1, mishitDeg: 0 });
  ok('a lob wedge clears the same canopy', !high.blocked,
    `wedge apex ${SH.apexYd(CLUBS[13], 50).toFixed(1)} yds, ` +
    `${SH.flightPoint(20 / 50, 50, 0, SH.apexYd(CLUBS[13], 50)).height.toFixed(1)} yds up at the tree, ` +
    `canopy height ${h3.treeTypes[tree.type].height}`);
  ok('the wedge gives up most of the yardage to do it', high.carry < low.carry / 3);
  // The trunk is the part no amount of loft beats: it blocks at ANY height (spec 21.2's model).
  // Dead in line with a trunk there is no shot over it, only around it - which is what makes a
  // ball finishing directly behind a tree worth the drop prompt Stage C adds.
  const dead = SH.resolveShot({ hole: h3, from: [tree.x, tree.y - 20], aimRad: 0, club: CLUBS[13], power: 1, mishitDeg: 0 });
  ok('a trunk blocks even a shot lofted 19 yds over it', !!dead.blocked);
}

console.log('\n-- 10b. THE CUP IS THE SAME RULE FOR EVERY SHOT --');
// Matt, 2026-09-04: "Anything can be holed. a 1 ft putt, a 30 ft putt, a 200 yard 3 wood shot.
// Anything. as long as it goes over the hole at a reasonable speed (you can go over it if the ball
// is moving too fast)."
//
// [KNOWN-BUG PROBE] resolveShot did not look at the cup AT ALL until this landed - only
// simulatePutt did - so a full swing could roll straight over the hole and carry on. Every shot
// that was not a putt was physically incapable of going in.
{
  const h = PINE_VALLEY.holes[0];
  ok('a ball rolling over the cup slowly DROPS', SH.cupCheck(h, h.pin[0], h.pin[1], 1.0));
  ok('...and one going over it too fast does NOT', !SH.cupCheck(h, h.pin[0], h.pin[1], 9));
  ok('a ball passing a yard wide is not holed', !SH.cupCheck(h, h.pin[0] + 1, h.pin[1], 0.5));

  // Roll a ball from short of the hole so its roll dies right at the cup.
  const start = [h.pin[0], h.pin[1] - 6];
  const rolled = SH.rollWatchingCup(h, start, 0, 6.05);
  ok('[KNOWN-BUG PROBE] a ROLL that reaches the cup at dying pace is holed', rolled.holed,
    `finished at [${rolled.rest.map((v) => v.toFixed(2))}]`);
  const past = SH.rollWatchingCup(h, start, 0, 40);
  ok('...and a roll flying over it at pace is not', !past.holed);

  // The whole point: a real club, struck from off the green, can hole out.
  let holedWithAClub = false;
  for (let pw = 0.30; pw <= 1.05 && !holedWithAClub; pw += 0.002) {
    const from = [h.pin[0], h.pin[1] - 60];
    const r = SH.resolveShot({ hole: h, from, aimRad: 0, club: CLUBS[12], power: pw, mishitDeg: 0 });
    if (r.holed) holedWithAClub = true;
  }
  ok('[KNOWN-BUG PROBE] a WEDGE from 60 yds can hole out', holedWithAClub,
    'before this, resolveShot never consulted the cup, so no full swing could ever go in');
}

console.log('\n-- 11. putting --');
// Only ONE number about putting was ever measured: a 17 ft putt rolled to rest in about 2.5 s.
// PUTT_DECEL is derived from it, and everything else here falls out of that derivation.
function flatGreen(grad) {
  return {
    pin: [0, 1e6], base: 'green', surfaces: [], treeTypes: [], trees: [], treeBelts: [],
    green: { poly: [[-999, -999], [999, -999], [999, 999], [-999, 999]], slope: { cols: 1, rows: 1, cells: [grad] } },
  };
}
{
  const p = SH.simulatePutt({ hole: flatGreen([0, 0]), from: [0, 0], aimRad: 0, power: 17 / SH.MAX_PUTT_FT, rangeFt: SH.MAX_PUTT_FT });
  near('a 17 ft putt rolls for ~2.5 s (the one MEASURED putt)', p.ms / 1000, 2.5, 0.1);
  near('...and it travels 17 ft', Math.hypot(p.rest[0], p.rest[1]) * 3, 17, 0.3);
}

// ---------------------------------------------------------------------------
console.log('\n-- 11b. CAN A PERSON ACTUALLY HOLE IT? (the check this suite was missing) --');
//
// THE FAILURE THIS EXISTS FOR, stated plainly. The old suite asserted "a 12 ft putt on hole 1 can
// actually be holed" by SWEEPING power values in a loop until one dropped. That proved the physics
// could hole a putt. It never asked whether a HUMAN can stop the meter at that value - and they
// could not: with a fixed 60 ft at full power, the tap window for +/- 1.5 ft was a constant
// +/- 19 ms, about ONE FRAME at 60fps, at every distance. 102 assertions were green and the game
// was unplayable. Matt took 24 shots on a par 4 and quit.
//
// So the rule now is: a distance the player is EXPECTED to face must be reachable with a tap
// window a person can actually hit. Anything else is a test of the engine, not of the game.
{
  // THE WINDOW IS MEASURED, NOT MODELLED. An earlier version of this block estimated it from
  // "how much power is +/- 1 ft of stopping distance", which is a proxy and a bad one: the cup
  // captures a ball ROLLING THROUGH it over a range of speeds, so the real window is far wider
  // than the stopping-distance one. Sweeping real putts through simulatePutt and counting the
  // powers that actually drop is the only version of this that can be trusted.
  const windowMs = (ft) => {
    const from = [h1.pin[0], h1.pin[1] - ft / 3];
    const aim = Math.atan2(h1.pin[0] - from[0], h1.pin[1] - from[1]);
    let lo = null; let hi = null;
    for (let pw = 0.002; pw <= 1.0; pw += 0.002) {
      if (SH.simulatePutt({ hole: h1, from, aimRad: aim, power: pw, rangeFt: SH.puttRangeFt() }).holed) {
        if (lo === null) lo = pw;
        hi = pw;
      }
    }
    return lo === null ? 0 : (hi - lo) * SW.UP_MS;
  };
  const FRAME = 1000 / 60;
  const windows = [];
  for (const ft of [1, 2.2, 4, 6.9, 10, 15.8, 25, 40]) {
    const w = windowMs(ft);
    windows.push(w);
    ok(`a ${ft} ft putt gives the player ${w.toFixed(0)} ms (${(w / FRAME).toFixed(1)} frames) to stop the meter`,
      w >= 3 * FRAME, 'under 3 frames is not a skill, it is a coin flip');
  }
  ok('[KNOWN-BUG PROBE] a 2 ft tap-in is not a one-frame stop', windowMs(2) >= 3 * FRAME,
    'the shipped build needed 3.7 % power, reached 28 ms after tap 1: Matt putted 2.2 ft to 12.6 ft');
  // [KNOWN-BUG PROBE] ...and the window is the SAME at every distance, which is what a fixed
  // scale buys. The range was briefly scaled to the putt in hand to widen the short-putt window;
  // Matt caught it - "if i'm 2 feet away, a 100% power putt will go 2 feet" - and a meter whose
  // scale moves under you teaches nothing, because 60 % power is a different putt every time.
  ok(`[KNOWN-BUG PROBE] the window is the SAME at every distance (${windows.map((w) => (w / FRAME).toFixed(1)).join(', ')} frames)`,
    Math.max(...windows) - Math.min(...windows) < 1.5 * FRAME,
    'a range that rescales per putt gives 96 frames on a tap-in and 10 on a long putt: no feel transfers between them');
  ok('the hole is reachable at less than full power for anything inside the putter\'s range',
    [1, 5, 20, 50].every((ft) => ft / SH.puttRangeFt() <= 1));
  ok('...and BEYOND the putter\'s 60 ft range it honestly cannot be reached',
    120 / SH.puttRangeFt() > 1);
  ok('full power means the SAME distance from every putt, and it is the putter\'s own stat',
    new Set([0.2, 2, 10, 30, 60, 500].map((ft) => SH.puttRangeFt(ft))).size === 1
    && SH.puttRangeFt() === PUTTER.maxFeet);
}
{
  const p = SH.simulatePutt({ hole: flatGreen([0.5, 0]), from: [0, 0], aimRad: 0, power: 20 / SH.MAX_PUTT_FT });
  near('a 20 ft putt across a HALF-strength slope breaks one cup width (~4 in)', p.rest[0] * 36, 4, 0.6);
}
{
  const full = SH.simulatePutt({ hole: flatGreen([1, 0]), from: [0, 0], aimRad: 0, power: 20 / SH.MAX_PUTT_FT });
  const half = SH.simulatePutt({ hole: flatGreen([0.5, 0]), from: [0, 0], aimRad: 0, power: 20 / SH.MAX_PUTT_FT });
  ok('a full slope breaks about twice as much as a half one', Math.abs(full.rest[0] / half.rest[0] - 2) < 0.15);
}
{
  const p = SH.simulatePutt({ hole: flatGreen([0, 0]), from: [0, 0], aimRad: 0, power: 1 });
  near('full power rolls 60 ft', Math.hypot(p.rest[0], p.rest[1]) * 3, 60, 1);
}
{
  // Holing out, on the real hole, from a real distance.
  const green = PINE_VALLEY.holes[0];
  const from = [green.pin[0], green.pin[1] - 4];
  let holed = false;
  for (let pw = 0.15; pw <= 0.5 && !holed; pw += 0.005) {
    const p = SH.simulatePutt({ hole: green, from, aimRad: Math.atan2(green.pin[0] - from[0], green.pin[1] - from[1]), power: pw });
    if (p.holed) holed = true;
  }
  ok('a 12 ft putt on hole 1 can be holed BY THE PHYSICS', holed,
    'this proves the simulation only - whether a PERSON can stop the meter there is section 11b');
  const blast = SH.simulatePutt({ hole: green, from, aimRad: 0, power: 1 });
  ok('a putt hammered over the cup at full pace does NOT drop', !blast.holed);
}

console.log('\n-- 11c. every green has a collar --');
// [KNOWN-BUG PROBE] Hole 1's light-rough corridor stopped short of the green, so a missed green
// landed in `base` - HEAVY ROUGH, 82 % power and a 65 % accuracy band - on every side. Matt's
// playtest put him 17.5 yds from the pin in heavy rough with only a lob wedge.
for (const h of COURSES.flatMap((c) => c.holes)) {
  const gb = greenBoxOf(h);
  const cx = (gb.minX + gb.maxX) / 2; const cy = (gb.minY + gb.maxY) / 2;
  const rx = (gb.maxX - gb.minX) / 2; const ry = (gb.maxY - gb.minY) / 2;
  let harsh = 0;
  for (let a = 0; a < 360; a += 15) {
    const r = (a * Math.PI) / 180;
    const k = surfaceAt(h, cx + Math.cos(r) * (rx + 3), cy + Math.sin(r) * (ry + 3));
    if (k === 'heavyRough') harsh++;
  }
  if (harsh) ok(`hole ${h.n}: missing the green by 3 yds never lands in heavy rough`, false,
    `${harsh} of 24 points around the green are heavy rough`);
}
ok(`all ${COURSES.reduce((a, c) => a + c.holes.length, 0)} greens on both courses have a collar on every side`, true);

console.log('\n-- 12. the two yardages stay different on purpose --');
{
  let bad = 0;
  for (const h of COURSES.flatMap((c) => c.holes)) {
    if (!(h.cardYards >= distYd(h.tee, h.pin) - 1.5)) { bad++; console.log(`  hole ${h.n} card ${h.cardYards} < straight`); }
  }
  ok('no hole\'s card yardage is shorter than its own straight line', bad === 0);
}
ok("hole 3's card is well over its straight line, because it is a dogleg",
  PINE_VALLEY.holes[2].cardYards - distYd(PINE_VALLEY.holes[2].tee, PINE_VALLEY.holes[2].pin) > 50);
near('hole 1 is the one where they agree', distYd(PINE_VALLEY.holes[0].tee, PINE_VALLEY.holes[0].pin), 360.7, 0.05);

console.log('\n-- 13. a whole hole can be played out --');
// The check that matters: does a plausible sequence of good swings get the ball in the hole?
{
  const h = PINE_VALLEY.holes[0];
  let ball = [...h.tee];
  let strokes = 0;
  let holed = false;
  for (let i = 0; i < 12 && !holed; i++) {
    const lie = surfaceAt(h, ball[0], ball[1]);
    const d = distYd(ball, h.pin);
    const aim = Math.atan2(h.pin[0] - ball[0], h.pin[1] - ball[1]);
    strokes++;
    if (isPuttable(lie)) {
      const rangeFt = SH.puttRangeFt();
      const p = SH.simulatePutt({ hole: h, from: ball, aimRad: aim, power: Math.min(1, (d * 3) / rangeFt), rangeFt });
      ball = p.rest; holed = p.holed;
    } else {
      const club = autoSelectClub(d, lie);
      const power = Math.min(1, d / (club.carry * lieOf(lie).power));
      const r = SH.resolveShot({ hole: h, from: ball, aimRad: aim, club, power, mishitDeg: 0 });
      ball = r.rest;
      // A full swing can hole out now, and this loop must NOTICE - reading only `rest` left the
      // ball sitting in the cup while the loop kept "putting" from zero feet, which is exactly how
      // this assertion first reported 12 strokes for a hole that had already been holed in 2.
      holed = r.holed;
    }
  }
  ok(`hole 1 played out with clean strikes: holed in ${strokes}`, holed && strokes <= 6,
    `finished at [${ball.map((v) => v.toFixed(1))}] on ${surfaceAt(h, ball[0], ball[1])}`);
}

console.log('\n-- 14. EVERY hole on BOTH courses can actually be finished --');
// The single most important assertion about 36 holes of course data, and the one no amount of
// looking at a screenshot can answer: with clean strikes, does the ball go in?
//
// THE TEST PLAYER AIMS DOWN THE HOLE'S `route`, NOT AT THE PIN. A player that aims at the pin from
// a dogleg tee hits the trees every time and reports a perfectly good hole as broken - which is
// how this section started. It also shortens the club rather than drown a ball, and nudges its aim
// when a trunk is in the way, because that is what a person does.
//
// It found a real, shipping SOFTLOCK on its first run: a ball that finished under a canopy was
// blocked on the first sample of its NEXT shot, dropped where it stood, and was blocked again -
// for ever, travelling 0 yards with the meter working perfectly. See treeHit's header in shot.js.
{
  const DEGR = Math.PI / 180;
  const targetFor = (hole, ball, reachYd) => {
    if (distYd(ball, hole.pin) <= reachYd) return hole.pin;
    const route = hole.route && hole.route.length > 1 ? hole.route : [hole.tee, hole.pin];
    let bi = 0; let bd = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = distYd(ball, route[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    let best = null;
    for (let i = bi; i < route.length; i++) if (distYd(ball, route[i]) <= reachYd) best = route[i];
    return best || route[Math.min(route.length - 1, bi + 1)];
  };

  const playOut = (hole) => {
    let ball = [...hole.tee];
    for (let n = 1; n <= 14; n++) {
      const lie = surfaceAt(hole, ball[0], ball[1]);
      if (isPuttable(lie)) {
        const ft = distYd(ball, hole.pin) * 3;
        const rangeFt = SH.puttRangeFt();
        const aim = Math.atan2(hole.pin[0] - ball[0], hole.pin[1] - ball[1]);
        const r = SH.simulatePutt({ hole, from: ball, aimRad: aim, power: Math.min(1, ft / rangeFt), rangeFt });
        if (r.holed) return n;
        ball = r.rest;
        continue;
      }
      const club = autoSelectClub(distYd(ball, hole.pin), lie);
      const reach = club.carry * lieOf(lie).power;
      const target = targetFor(hole, ball, reach);
      const base = Math.atan2(target[0] - ball[0], target[1] - ball[1]);
      const want = Math.min(1, distYd(ball, target) / reach);
      let best = null;
      let done = false;
      for (const dAim of [0, 4, -4, 8, -8, 14, -14, 25, -25, 40, -40]) {
        for (const mul of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
          const r = SH.resolveShot({ hole, from: ball, aimRad: base + dAim * DEGR, club, power: want * mul, mishitDeg: 0 });
          const score = (r.holed ? 1e6 : 0) + (r.restOn === 'water' ? -1e5 : 0) + (r.blocked ? -1e4 : 0) + distYd(ball, r.rest);
          if (!best || score > best.score) best = { r, score };
          if (r.holed || (!r.blocked && r.restOn !== 'water')) { done = true; break; }
        }
        if (done) break;
      }
      if (best.r.holed) return n;
      // Stage C's penalty drop, modelled: back where it was struck from, one stroke on.
      if (best.r.restOn === 'water') { n += 1; continue; }
      // A shot that moves the ball nowhere at all is the softlock signature.
      if (distYd(ball, best.r.rest) < 0.5) return -n;
      ball = best.r.rest;
    }
    return 99;
  };

  for (const c of COURSES) {
    let worst = 0; let worstHole = 0; let stuck = 0;
    for (const h of c.holes) {
      const n = playOut(h);
      if (n < 0) { stuck++; console.log(`  ${c.id} hole ${h.n}: SOFTLOCK - a shot moved the ball 0 yds`); continue; }
      if (n > worst) { worst = n; worstHole = h.n; }
      if (n > h.par + 2) console.log(`  ${c.id} hole ${h.n} (par ${h.par}): ${n} strokes`);
    }
    ok(`${c.name}: no hole softlocks the ball`, stuck === 0, `${stuck} hole(s)`);
    ok(`${c.name}: every hole is finished in par+2 or better (worst was ${worst} on hole ${worstHole})`,
      worst > 0 && c.holes.every((h) => { const n = playOut(h); return n > 0 && n <= h.par + 2; }));
  }
}

console.log(`\n${fail ? `${fail} FAILED` : 'all golf engine tests passed'}`);
process.exit(fail ? 1 : 0);
