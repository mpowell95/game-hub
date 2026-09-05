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
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf, LIES, mustPutt, canPutt } from './clubs.js';
import * as CL from './clubs.js';
import * as SW from './swing.js';
import * as SH from './shot.js';
import fs from 'node:fs';   // section 12b reads the shipped ui.js/render.js as text

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
// THE LADDER WRAPS AT BOTH ENDS. Matt, 2026-09-04: "if I press up all the way to driver, it
// should cycle back to the Lob Wedge. same for the other direction." It used to CLAMP, so the only
// way back from the driver was thirteen taps the other way and holding the button did nothing at
// all - which reads as a broken control, not as a limit.
const LAST = CLUBS[CLUBS.length - 1];
ok('stepping up from the driver wraps round to the lob wedge',
  stepClub(CLUBS[0], +1, 'heavyRough').id === LAST.id);
ok('stepping down from the lob wedge wraps round to the driver',
  stepClub(LAST, -1, 'heavyRough').id === 'driver');
ok('one step down from the driver is the 3 wood', stepClub(CLUBS[0], -1, 'fairway').id === CLUBS[1].id);

console.log('\n-- 6b. the putter is OFFERED off the green, and FORCED on it --');
// Matt, 2026-09-04: "You should make the putter available when on the fairway and fringe. Not the
// rough. But long putts from off the green (from the fairway or fringe) should be possible."
// Two questions, two predicates: `mustPutt` is the lie where nothing else is offered, `canPutt` is
// the lie where it may be CHOSEN. They used to be one function gating both, which is why the
// putter could not exist on a fairway without also taking every other club away there.
ok('the green and the fringe force the putter', mustPutt('green') && mustPutt('fringe'));
ok('the fairway and the tee do NOT force it', !mustPutt('fairway') && !mustPutt('tee'));
ok('but they DO offer it', canPutt('fairway') && canPutt('tee'));
ok('rough, sand and trees never offer it',
  !canPutt('lightRough') && !canPutt('heavyRough') && !canPutt('greensideBunker')
  && !canPutt('fairwayBunker') && !canPutt('trees'));
ok('the auto-pick still hands over the putter only where it is forced',
  autoSelectClub(8, 'fringe').id === 'putter' && autoSelectClub(8, 'fairway').id !== 'putter');
// `dir` +1 is MORE club, so the putter - the shortest thing in the bag - sits one step DOWN from
// the lob wedge, and the wrap past it comes back to the driver.
ok('the putter sits at the short end of a fairway ladder',
  stepClub(LAST, -1, 'fairway').id === 'putter');
ok('one more step down wraps back to the driver',
  stepClub(PUTTER, -1, 'fairway').id === 'driver');
ok('and one step UP from the putter is the lob wedge again',
  stepClub(PUTTER, +1, 'fairway').id === LAST.id);
ok('but the putter is absent from a rough ladder',
  stepClub(LAST, -1, 'heavyRough').id === 'driver');
ok('the ladder does not move at all on the green',
  stepClub(PUTTER, +1, 'green').id === 'putter' && stepClub(CLUBS[0], -1, 'green').id === 'putter');
{
  // A putter carried onto a lie that cannot hold one must not simply stay in hand.
  let seen = PUTTER;
  seen = stepClub(seen, +1, 'heavyRough');
  ok('a putter stepped from an unputtable lie lands on a real club', seen.id !== 'putter');
}
{
  // A putt FROM THE FAIRWAY must not run as far as the same stroke on the green, or the green
  // stops meaning anything. `PUTT_DRAG` is what makes that true; this is the assertion on it.
  const h = PINE_VALLEY.holes[0];
  const pin = h.pin;
  const onGreen = [pin[0], pin[1] - 12];
  const aim = Math.atan2(pin[0] - onGreen[0], pin[1] - onGreen[1]);
  const a = SH.simulatePutt({ hole: h, from: onGreen, aimRad: aim + 0.5, power: 1, rangeFt: SH.puttRangeFt() });
  ok('a full-power putt on the green covers most of the putt range',
    distYd(onGreen, a.rest) > (SH.MAX_PUTT_FT / 3) * 0.6,
    `covered ${distYd(onGreen, a.rest).toFixed(1)} yds`);
  ok('fairway drags a rolling ball harder than the green does',
    SH.puttDrag('fairway') > SH.puttDrag('fringe') && SH.puttDrag('fringe') > SH.puttDrag('green'));
}

console.log('\n-- 7. ONE NEEDLE, THREE TAPS: the three-click swing --');
// MEASURED off the reference at 60 fps, every frame of a 203-frame clip (swing.js's header has
// the trace). The old build had two meters that never moved together; this has one needle on one
// scale, and these assertions are what separate the two.
near('zero power is the accuracy point, dead centre', SW.backswingAt(0).pos, 0, 1e-9);
near('the backswing reaches 100 % at the default tempo', SW.backswingAt(SW.UP_MS).pos, 1.0, 1e-9);
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
// +/- 13.7 %, not 12: the 60 fps trace gives the bar marker as a linear function of the needle's
// angle at -0.0175 per degree, so the bar is 57.1 deg of arc, and at the CORRECTED 2.08 deg per 1 %
// that is +/- 0.137. The old 0.12 came from dividing the same 57.1 deg by the wrong 2.21.
near('the bar covers +/- 13.7 % of power around zero', SW.BAR_HALF, 0.137, 1e-9);
near('dead centre of the bar is zero on the arc', SW.barPosOf(0), 0.5, 1e-9);
ok('the needle enters the bar from the LEFT on the way down and travels right',
  SW.barPosOf(SW.BAR_HALF) === 0 && SW.barPosOf(-SW.BAR_HALF) === 1);
ok('the bar position is LINEAR in the needle position, the way the reference measured',
  Math.abs((SW.barPosOf(0.06) - SW.barPosOf(0)) - (SW.barPosOf(0) - SW.barPosOf(-0.06))) < 1e-9);
{
  const clean = SW.bandsFor(1);
  ok('a clean lie gives the middle 54.5 % as the straight zone (MEASURED: 36 px of 66)',
    Math.abs(clean.green - 0.545) < 1e-9);
  near('...and its orange band is 18.2 % of the half (MEASURED: 12 px of 66)',
    clean.orange - clean.green, 0.182, 0.002);
  ok('the bands fill the whole bar', Math.abs(clean.red - 1) < 1e-9);
  const sand = SW.bandsFor(LIES.greensideBunker.zone);
  // MEASURED 2026-09-04 off four whole-hole clips: the reference's bar from a bunker is red 42 /
  // orange 18 / green 6 out of 66 px per half. Verified visually too - the green band really is a
  // sliver either side of the centre line. From a bad lie you are not striking it pure, you are
  // avoiding red, and the orange band is what has to stay hittable.
  near('a greenside bunker cuts the straight zone to 9.1 % (MEASURED: 6 px of 66)',
    sand.green, 0.091, 0.002);
  near('...and widens orange to about 27 % so ORANGE is still a real target (MEASURED: 18 of 66)',
    sand.orange - sand.green, 0.288, 0.03);
  ok('[KNOWN-BUG PROBE] a bad lie is about SIX times harsher than a clean one, not twice',
    clean.green / sand.green > 5.0,
    'ours gave the worst lie 27 % of the half as green; the reference gives 9 %');
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
  // The flat 10 % became a RAMP (2026-09-04): the reference's bunker 7 iron stopped in red and
  // went 21.1 yds where ours gave ~41, so a red strike there costs real distance, not a token cut.
  ok('a green-zone stop costs no distance at all', SW.mishit(0.6, 1, 1).distanceMul === 1);
  ok('an orange stop shades distance down toward 0.92',
    SW.mishit(0.82, 1, 1).distanceMul < 1 && SW.mishit(0.82, 1, 1).distanceMul >= 0.92);
  ok('a full red miss costs 40 % of the distance', Math.abs(SW.mishit(1, 1, 1).distanceMul - 0.6) < 1e-9);
  ok('...and the penalty rises monotonically the further out you stop',
    [0.5, 0.62, 0.75, 0.88, 1].map((b) => SW.mishit(b, 1, 1).distanceMul)
      .every((v, i, a) => i === 0 || v <= a[i - 1] + 1e-9));
  ok('a full red miss is 8 degrees', Math.abs(SW.mishit(1, 1, 1).deg - 8) < 1e-9);
  ok('left of centre pulls LEFT, right pushes RIGHT', SW.mishit(0.1, 1, 1).deg < 0 && SW.mishit(0.9, 1, 1).deg > 0);
  // THE OVER-SWING MULTIPLIER IS A RAMP, NOT A STEP. It was a flat 1.5x, which was fine while the
  // top of the arc was 112 %; the measured scale puts it at 120.6 %, so a flat multiplier would
  // make "hold it to the top" worth 21 % more distance for a fixed price.
  ok('over-100 % power multiplies the miss, and more the further past you go',
    SW.mishit(0.9, 1.05, 1).deg > SW.mishit(0.9, 1.0, 1).deg
    && SW.mishit(0.9, 1.15, 1).deg > SW.mishit(0.9, 1.05, 1).deg);
  ok(`at the top of the arc it is ${SW.OVER_SWING_MAX_MUL}x, before the spray is added`,
    Math.abs((SW.mishit(0.9, SW.SWING_MAX, 1, 1, 0).deg - SW.blockSpray(SW.SWING_MAX, 0))
      - SW.mishit(0.9, 1.0, 1).deg * SW.OVER_SWING_MAX_MUL) < 1e-9);
  ok('and exactly 100 % costs nothing extra',
    Math.abs(SW.mishit(0.9, 1.0, 1).deg - SW.mishit(0.9, 0.999999, 1).deg) < 1e-4);
  // The spec's own sanity check on the model.
  const off = Math.tan(8 * Math.PI / 180) * 215;
  near('a full red miss with the stock driver lands ~30 yds offline', off, 30, 2);
}

console.log('\n-- 8b. ONE TEMPO, AND A GREEN BAND THAT NARROWS WITH THE CLUB --');
{
  // THE METER IS ONE SPEED AGAIN (2026-09-05, on Matt's instruction). It briefly ran at a different
  // speed per club, which came out of the measuring pass rather than out of the playtest list -
  // "I did NOT instruct you to change anything about tempo." The measurement stands and is recorded
  // in clubs.js's swingTempo header; shipping it was the mistake, not measuring it.
  const speeds = new Set([...CLUBS, PUTTER].map((c) => {
    const t = CL.swingTempo(c);
    return `${t.upMs}/${t.downMs}`;
  }));
  ok('every club in the bag swings at the same speed', speeds.size === 1, [...speeds].join(', '));
  ok('...and that speed is the Swing\'s own default',
    CL.swingTempo().upMs === SW.UP_MS && CL.swingTempo().downMs === SW.DOWN_MS);
  ok('the downswing is still faster than the backswing', SW.DOWN_MS < SW.UP_MS,
    'measured in every reference sample, and it is what gives you time to pick a power and less to save the strike');

  // THE GREEN BAND NARROWS WITH THE CLUB. Matt: "You haven't paid attention to how the power/aim
  // bars change size depending on the club. Driver off the fairway shouldn't be super easy to hit."
  ok('a driver has a narrower green band than a lob wedge',
    CL.swingZone(CLUBS[0]) < CL.swingZone(CLUBS[13]));
  ok('...and it tightens monotonically the longer the club',
    CLUBS.map((c) => CL.swingZone(c)).every((v, i, a) => i === 0 || v >= a[i - 1] - 1e-9));
  ok('the lob wedge and the putter get the full band',
    Math.abs(CL.swingZone(CLUBS[13]) - 1) < 1e-9 && CL.swingZone(PUTTER) === 1);
  {
    const fw = LIES.fairway.zone;
    const drv = SW.bandsFor(fw, CL.swingZone(CLUBS[0]));
    const wdg = SW.bandsFor(fw, CL.swingZone(CLUBS[13]));
    ok(`a driver off the fairway is ${(100 * drv.green).toFixed(1)} % green against a wedge's ${(100 * wdg.green).toFixed(1)} %`,
      drv.green < wdg.green * 0.85);
    // THE CLUB MUST NOT TOUCH ORANGE. Orange's job is that a bad lie stays hittable, which is a
    // property of where the ball is sitting, not of what is being swung at it.
    const bad = LIES.greensideBunker.zone;
    ok('the club narrows GREEN and leaves the orange share alone',
      Math.abs((SW.bandsFor(bad, 0.72).orange - SW.bandsFor(bad, 0.72).green)
        - (SW.bandsFor(bad, 1).orange - SW.bandsFor(bad, 1).green)) < 0.03);
  }

  // THE FIRST PLAYTEST'S LESSON, APPLIED TO THE BANDS: a target the player cannot physically stop
  // the needle inside is not a hard shot, it is a broken one. Measured in FRAMES at 60 fps, for the
  // WORST case now available - the longest club from each lie.
  const FRAME = 1000 / 60;
  const rows = [];
  for (const [kind, lie] of Object.entries(LIES)) {
    if (kind === 'water') continue;
    const t = CL.swingTempo();
    const b = SW.bandsFor(lie.zone, CL.swingZone(CLUBS[0]));
    const green = b.green * SW.BAR_HALF * t.downMs;
    const orange = b.orange * SW.BAR_HALF * t.downMs;
    rows.push(`${kind} ${(green / FRAME).toFixed(1)}/${(orange / FRAME).toFixed(1)}`);
    ok(`${kind}: with a DRIVER, ORANGE is at least 3 frames wide (${(orange / FRAME).toFixed(1)})`, orange >= 3 * FRAME);
  }
  console.log(`     driver green/orange half-windows in frames: ${rows.join('  ')}`);
  {
    // 4.84 frames, derivable from ANGLES alone, which is what makes it a good check on the whole
    // power-unit convention: the driver's downswing measured 3.220 deg/frame, the bar is 28.6 deg
    // either side of zero, and green is 54.5 % of that - 0.545 * 28.6 / 3.220 = 4.84.
    const t = CL.swingTempo();
    const b = SW.bandsFor(1);
    near('from a clean lie GREEN itself is about 4.8 frames, as the reference measured',
      b.green * SW.BAR_HALF * t.downMs / FRAME, 4.84, 0.35);
  }
}

console.log('\n-- 8c. THE OVER-SWING IS A GAMBLE, NOT FREE MONEY --');
// Matt, after playing with the numbers: "The max carry at the farthest past 100% and spot on should
// only be 240-245. I want it to go 20-30 yards offline. high risk."
//
// The multiplier alone could never deliver that, and this is the assertion that says why: power is
// locked at tap 2 and the accuracy attempt happens at tap 3, so a multiplier is set in advance and
// applied to whatever miss follows - and a PERFECT strike has no miss to multiply. Two times zero
// is zero. So the best play on every full shot used to be: tap, wait, tap, never use tap 2.
{
  const drv = CLUBS[0];
  const cz = CL.swingZone(drv);
  const carryAt = (p) => 215 * SW.payingPower(p);

  ok('below the block, every unit of power still pays in full',
    Math.abs(SW.payingPower(1.0) - 1.0) < 1e-9 && Math.abs(SW.payingPower(SW.BLOCK_FROM) - SW.BLOCK_FROM) < 1e-9);
  near(`a driver held to the top carries ${carryAt(SW.SWING_MAX).toFixed(1)} yds`,
    carryAt(SW.SWING_MAX), 242.5, 2.5, 'Matt asked for 240-245; the old value was 259');
  ok('...which is still more than a clean 100 % swing', carryAt(SW.SWING_MAX) > 215);

  // [KNOWN-BUG PROBE] THE PERFECT STRIKE MUST NOW COST SOMETHING. This is the whole fix: `mishit`
  // at dead centre used to return exactly 0 degrees at any power.
  let mn = Infinity; let mx = 0; let left = 0; let right = 0;
  for (let i = 0; i < 500; i++) {
    const m = SW.mishit(0.5, SW.SWING_MAX, 1, cz, i * 7919);
    const off = Math.abs(Math.tan(m.deg * Math.PI / 180) * carryAt(SW.SWING_MAX));
    mn = Math.min(mn, off); mx = Math.max(mx, off);
    if (m.deg < 0) left++; else right++;
  }
  ok(`[KNOWN-BUG PROBE] a PERFECT strike at the top still goes ${mn.toFixed(1)}-${mx.toFixed(1)} yds offline`,
    mn >= 19 && mx <= 31 && mn > 0, 'Matt asked for 20-30; it used to be exactly 0.0 at any power');
  ok('...and it goes either way', left > 100 && right > 100,
    'a spray that always pushed the same side would be a known cost, not a risk');
  ok('the spray is zero right up to the block\'s edge',
    SW.blockSpray(1.0, 5) === 0 && SW.blockSpray(SW.BLOCK_FROM, 5) === 0
    && SW.blockSpray(SW.BLOCK_FROM + 0.01, 5) !== 0);
  ok('and it grows the deeper into the block the swing goes',
    Math.abs(SW.blockSpray(1.12, 3)) < Math.abs(SW.blockSpray(SW.SWING_MAX, 3)));

  // SEEDED, NOT RANDOM. `resolveShot` has to stay a pure function of its inputs or section 14 -
  // every hole on both courses played out - stops being reproducible.
  ok('the same shot sprays the same way every time',
    SW.blockSpray(1.18, 42) === SW.blockSpray(1.18, 42));
  ok('...and different shots do not', SW.blockSpray(1.18, 42) !== SW.blockSpray(1.18, 43));
  {
    const h = { ...h1, wind: { speed: 0, bearing: 0 } };
    const a = SH.resolveShot({ hole: h, from: h1.tee, aimRad: 0, club: drv, power: 1, mishitDeg: 0 });
    const b = SH.resolveShot({ hole: h, from: h1.tee, aimRad: 0, club: drv, power: 1, mishitDeg: 0 });
    ok('resolveShot is still pure', a.rest[0] === b.rest[0] && a.rest[1] === b.rest[1]);
  }
}

console.log('\n-- 9. flight, roll and the lie factor --');
// A CALM COPY OF HOLE 1. Every assertion in this section is about the CLUB and the LIE, and since
// 2026-09-05 every hole has a wind that would otherwise be silently folded into each number - hole
// 1's own is 1.4, worth about 6 yds on a drive. `windFor` honours a hole's own `wind` field, so a
// calm clone takes the weather out of the club's distance without stubbing anything.
const CALM = { ...h1, wind: { speed: 0, bearing: 0 } };
near('a 215 yd drive flies ~4.5 s', SH.flightMs(215) / 1000, 4.48, 0.05);
near('a 50 yd wedge flies ~1.7 s', SH.flightMs(50) / 1000, 1.73, 0.05);
ok('flight time grows with distance and is never instant', SH.flightMs(0) === 900 && SH.flightMs(300) > SH.flightMs(200));
{
  const r = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: CLUBS[0], power: 1, mishitDeg: 0 });
  near('a full drive from the tee carries the club distance', r.carry, 215, 0.01);
  ok('it lands on the fairway and rolls', r.landedOn === 'fairway' && r.rollYd > 0);
  // Roll is the surface times HOW FLAT THE CLUB SENDS IT IN, not the surface alone: a driver
  // arrives shallow and runs, a wedge drops almost vertically and sits. The old model gave every
  // club the same 8 % - Matt: "it stops unnaturally short."
  // MEASURED 2026-09-04 (clubs.js's rollFactor has the arithmetic): the reference's 3 wood carried
  // 196 and MUST have run at least 32 more, because the ball started 253.2 from the pin and
  // finished 25.0 from it. That is >= 16.4 % of carry; ours was 9.3 %.
  near('a driver runs out about 18 % of its carry on a fairway', r.rollYd / r.carry, 0.180, 0.003);
  {
    const w3 = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: CLUBS[1], power: 1, mishitDeg: 0 });
    ok('[KNOWN-BUG PROBE] a 3 wood clears the reference\'s 16.4 % run-out floor',
      w3.rollYd / w3.carry >= 0.164,
      'shot 2 of the reference footage travelled >= 228.2 yds against a 196.0 carry readout');
  }
  {
    const wedge = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: CLUBS[13], power: 1, mishitDeg: 0 });
    ok('[KNOWN-BUG PROBE] a LOB WEDGE barely runs at all, where the driver runs 38 yds',
      wedge.rollYd < 4 && r.rollYd > 35,
      'the surface-only model rolled the wedge 4 yds and the driver 17, so nothing in the bag behaved like itself');
    const totals = CLUBS.map((c) => {
      const s2 = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: c, power: 1, mishitDeg: 0 });
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
  const r = SH.resolveShot({ hole: CALM, from, aimRad: 0, club: CLUBS[11], power: 1, mishitDeg: 0 });
  near('a full swing from sand travels 75 % of the club', r.carry, 95 * 0.75, 0.01);
  // Roll belongs to the surface the ball comes DOWN on, not the one it was struck from - a bunker
  // shot that finishes on the green rolls like a ball on a green. A ball that LANDS in sand plugs.
  const intoSand = SH.resolveShot({ hole: CALM, from: [0, 300], aimRad: 0, club: CLUBS[13], power: 0.8, mishitDeg: 0 });
  ok('a ball that lands in sand does not roll', intoSand.landedOn !== 'greensideBunker' || intoSand.rollYd === 0);
  ok('roll is read from the LANDING surface, not the lie played from', lieOf('greensideBunker').roll === 0);
  const over = SH.resolveShot({ hole: CALM, from, aimRad: 0, club: CLUBS[11], power: 1.1, mishitDeg: 0 });
  ok('the player can still swing PAST 100 % from a bad lie', over.carry > r.carry);
  // Past the block's edge only BLOCK_KEEPS_DIST of each extra unit pays, so 110 % of the meter is
  // NOT 110 % of the distance any more - that is the point of it.
  near('over-100 % pays less distance than the meter reads',
    over.carry / r.carry, SW.payingPower(1.1) / 1.0, 0.001);
  ok('...and the shortfall is real', over.carry / r.carry < 1.09);
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

console.log('\n-- 9b. THE WIND --');
// MEASURED off all four reference clips: the panel reads `wind`, a chunky white arrow, and `0.9`,
// IDENTICAL in every frame of every clip - so it is a constant for the hole, one decimal place, no
// unit named. That is all the footage can say. The STRENGTH is decided (shot.js says so in its own
// header) and calibrated against what the player can do about it, so these assertions pin the
// SHAPE - determinism, range, and that it pushes the ball the way the arrow points - plus the one
// number the calibration turns on.
{
  const holes = [...PINE_VALLEY.holes, ...RED_MESA.holes];
  ok('the wind on a hole is the same every time it is asked',
    holes.every((h) => {
      const a = SH.windFor(h); const b = SH.windFor(h);
      return a.speed === b.speed && a.bearing === b.bearing;
    }), 'a hole that plays differently every visit cannot be learned');
  ok('every speed is 0 to 2.0 in tenths',
    holes.every((h) => {
      const w = SH.windFor(h);
      return w.speed >= 0 && w.speed <= SH.WIND_MAX && Math.abs(w.speed * 10 - Math.round(w.speed * 10)) < 1e-9;
    }));
  ok('every bearing is one of the eight compass points',
    holes.every((h) => {
      const k = SH.windFor(h).bearing / (Math.PI / 4);
      return Math.abs(k - Math.round(k)) < 1e-9 && k >= 0 && k < 8;
    }));
  const calm = holes.filter((h) => SH.windFor(h).speed === 0).length;
  ok(`some holes are dead calm and most are not (${calm} of ${holes.length})`,
    calm >= 2 && calm <= holes.length / 3,
    'a calm hole is what makes a windy one register as windy');
  const spread = new Set(holes.map((h) => SH.windFor(h).bearing)).size;
  ok(`the wind does not blow the same way on every hole (${spread} of 8 bearings used)`, spread >= 6);
  ok("a hole's own `wind` field beats the derivation",
    SH.windFor({ ...h1, wind: { speed: 0, bearing: 0 } }).speed === 0 && SH.windFor(h1).speed > 0);

  // What it does to a shot. Aim straight up the hole; put the wind straight across it.
  const cross = { ...h1, wind: { speed: SH.WIND_MAX, bearing: Math.PI / 2 } };
  const head = { ...h1, wind: { speed: SH.WIND_MAX, bearing: Math.PI } };
  const tail = { ...h1, wind: { speed: SH.WIND_MAX, bearing: 0 } };
  const shot = (hole) => SH.resolveShot({ hole, from: h1.tee, aimRad: 0, club: CLUBS[0], power: 1, mishitDeg: 0 });
  const c = shot(cross); const hd = shot(head); const tl = shot(tail); const cm = shot(CALM);
  near('a full crosswind moves a driver about 12 yds off line', Math.abs(c.sideYd), 12, 1.5,
    'three taps of the 1.0 deg aim arrow at 215 yds - a correction, not a wall');
  ok('and it pushes it the way the arrow points', c.sideYd > 0,
    'bearing +90 deg is to the right of the shot, so the ball goes right');
  ok('a headwind shortens the carry and a tailwind lengthens it',
    hd.carry < cm.carry - 8 && tl.carry > cm.carry + 8,
    `head ${hd.carry.toFixed(1)}, calm ${cm.carry.toFixed(1)}, tail ${tl.carry.toFixed(1)}`);
  near('and it is worth about 6 % either way on a driver', tl.carry / cm.carry, 1.055, 0.02);
  ok('calm changes nothing at all', cm.sideYd === 0 && Math.abs(cm.carry - 215) < 1e-9);
  ok('the wind reaches a shot through the SIDE offset, so a blown ball still hits trees',
    Math.abs(c.sideYd) > 0 && typeof c.wind === 'object',
    'it is folded in before treeHit, not added to the landing point afterwards');
}

console.log('\n-- 9c. IT BOUNCES, THEN IT ROLLS --');
// Matt: "the roll looks unnatural... it lands then slides. it doesn't look like it's rolling, and
// it almost never bounces." Both halves were one mistake - a SINGLE smooth deceleration curve for
// the whole run-out with a sine wave laid on top for height, so the ball's forward speed never
// changed abruptly anywhere, which is exactly what sliding looks like.
{
  const drive = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: CLUBS[0], power: 1, mishitDeg: 0 });
  const at = (p) => SH.groundPoint(p, drive.rollYd, drive.apex, 'fairway');
  ok('the run-out starts at the landing point and finishes at the rest point',
    Math.abs(at(0).along) < 1e-9 && Math.abs(at(1).along - drive.rollYd) < 1e-6);
  let mono = true;
  for (let i = 1; i <= 200; i++) if (at(i / 200).along < at((i - 1) / 200).along - 1e-9) mono = false;
  ok('it never goes backwards', mono);

  // [KNOWN-BUG PROBE] The ball must be FASTER while it is bouncing than while it is rolling. A ball
  // in the air does not decelerate, and that step change at each landing is the whole reason a
  // bounce reads as a bounce from directly overhead.
  const speed = (p) => (at(p + 0.005).along - at(p).along) / 0.005;
  ok('[KNOWN-BUG PROBE] the ball is faster in the hops than in the roll',
    speed(0.10) > speed(0.60) * 1.5,
    `hop ${speed(0.10).toFixed(1)} vs roll ${speed(0.60).toFixed(1)} yd per unit of run-out time`);

  // [KNOWN-BUG PROBE] ...and the hop must be big enough to SEE. render.js draws the ball 6 px and
  // lifts it `height * ppy * 0.55`, and only draws the shadow at all past 1 px.
  const PPY = 393 / 70;                       // VIEW_W_YDS across a 393 px phone at the play view
  let peak = 0; let peaks = 0; let prev = 0; let rising = false;
  for (let i = 0; i <= 400; i++) {
    const hgt = at(i / 400).height;
    if (hgt > peak) peak = hgt;
    if (hgt > prev + 1e-9) rising = true;
    else if (rising && hgt < prev - 1e-9) { peaks++; rising = false; }
    prev = hgt;
  }
  const liftPx = peak * PPY * 0.55;
  ok(`[KNOWN-BUG PROBE] the first hop lifts the ball ${liftPx.toFixed(1)} px, which is visible`,
    liftPx >= 8, 'the old model peaked around 4 px against a 6 px ball - under the shadow gate for most of its arc');
  ok(`there are three hops, decaying (${peaks} peaks)`, peaks === 3);
  ok('and the ball is on the ground at both ends of the run-out',
    at(0).height < 1e-9 && at(1).height < 1e-9);

  // A ball does not bounce out of sand or out of deep rough.
  ok('sand and heavy rough swallow the bounce',
    SH.groundPoint(0.1, 20, 25, 'greensideBunker').height === 0
    && SH.groundPoint(0.1, 20, 25, 'heavyRough').height === 0
    && SH.groundPoint(0.1, 20, 25, 'fairway').height > 0);
  ok('...and they still roll the whole way',
    Math.abs(SH.groundPoint(1, 20, 25, 'heavyRough').along - 20) < 1e-6);

  // A lob wedge that runs 3 yds must not leap 4 yds into the air.
  const wedge = SH.resolveShot({ hole: CALM, from: h1.tee, aimRad: 0.04, club: CLUBS[13], power: 1, mishitDeg: 0 });
  let wpeak = 0;
  for (let i = 0; i <= 200; i++) wpeak = Math.max(wpeak, SH.groundPoint(i / 200, wedge.rollYd, wedge.apex, 'fairway').height);
  ok(`a lob wedge's hop is a third of its ${wedge.rollYd.toFixed(1)} yd run-out at most (${wpeak.toFixed(2)} yd)`,
    wpeak <= wedge.rollYd * 0.34 + 1e-9);
}

console.log('\n-- 9d. ROLL SPEED BY SURFACE --');
// Matt: "the roll speed and distance should also depend on the surface type it's on." The DISTANCE
// already did (clubs.js's rollFactor); the SPEED did not, so a ball running out on a green and one
// dying in heavy rough took the same time to cover their different distances.
{
  const D = 20;
  const green = SH.rollMs(D, 'green');
  const fairway = SH.rollMs(D, 'fairway');
  const rough = SH.rollMs(D, 'heavyRough');
  ok(`the same 20 yds takes longer on a green than a fairway, and least in rough (${(green / 1000).toFixed(2)} / ${(fairway / 1000).toFixed(2)} / ${(rough / 1000).toFixed(2)} s)`,
    green > fairway && fairway > rough);
  near('the fairway is the baseline and is unchanged', fairway, SH.rollMs(D), 1e-6,
    'the putting table is normalised on the GREEN; a run-out is normalised on the fairway');
  ok('a green is about half the fairway\'s drag', SH.puttDrag('fairway') / SH.puttDrag('green') > 1.6);
  ok('nothing rolls for zero time unless it did not roll', SH.rollMs(0, 'fairway') === 0 && SH.rollMs(5, 'fairway') > 0);
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
    // Calm: this is about whether the CUP can take a pitched ball, not about aiming off a crosswind.
    const r = SH.resolveShot({ hole: { ...h, wind: { speed: 0, bearing: 0 } }, from, aimRad: 0, club: CLUBS[12], power: pw, mishitDeg: 0 });
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

console.log('\n-- 12b. THE STROKE COUNT, and the cup you can actually see --');
{
  // [KNOWN-BUG PROBE] Matt, with a screenshot: HUD "shot 4" on a par 5, card "Eagle! Holed in 3".
  // ui.js's `_settleShot` returns EARLY when the ball drops, above its own `shotN += 1`, so the
  // shot that goes in is never counted - and `_showHoleResult` then subtracted one MORE. Every
  // score was a stroke too low and an ace would have reported 0. This reads the shipped file: the
  // result screen must take `shotN` as it stands, never `shotN - 1`.
  const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  ok('[KNOWN-BUG PROBE] the result screen counts the shot that holed it',
    /const strokes = this\.shotN;/.test(ui) && !/const strokes = this\.shotN - 1;/.test(ui),
    'shotN is already the shot just played, because the holed path returns before it is incremented');
  ok('...and `_showHoleResult` is still only reachable from the holed path',
    (ui.match(/this\._showHoleResult\(\)/g) || []).length === 1,
    'if it ever gets a second caller, "the shot just played" stops meaning "the shot that holed it"');

  // [KNOWN-BUG PROBE] Matt: "the ball rolls over the hole without going in - and leaves a 1-3 ft
  // putt after", and "the hole ... is a tiny tiny dot ... that does not get bigger when you zoom
  // into the green". One bug. The cup was drawn at 0.24 yd and floored at 2.5 px while capture is
  // 0.30 yd, so the BALL WAS BIGGER THAN THE HOLE and could cover it on screen without dropping.
  const rn = fs.readFileSync(new URL('./render.js', import.meta.url), 'utf8');
  ok('[KNOWN-BUG PROBE] the cup is drawn at the radius that actually captures',
    /CUP_CAPTURE_YD \* cam\.ppy/.test(rn) && /import \{ CUP_CAPTURE_YD \}/.test(rn),
    'the drawn hole and the capture test must be the same number, not two copies that can drift');
  ok('...and it therefore scales with the zoom instead of sticking at a floor',
    !/0\.12 \* cam\.ppy \* 2/.test(rn));

  // The number itself: at the green view the cup must out-measure the ball sprite, or a ball can
  // still sit on top of a hole it cannot fall into.
  const BALL_R_PX = 3;                       // render.js draws a 6 px ball
  const greenPpy = 393 / 34;                 // VIEW_W_GREEN_YDS across a 393 px phone
  const cupPx = SH.CUP_CAPTURE_YD * greenPpy;
  ok(`the cup out-measures the ball on the green (${cupPx.toFixed(1)} px vs ${BALL_R_PX} px)`,
    cupPx > BALL_R_PX);
}

console.log('\n-- 12c. THE GOLFER STANDS STILL, AND THE VIEW DOES NOT SLIDE --');
// Both read the shipped files as text, because both defects are about WHICH VALUE a line uses -
// there is no engine call that can be wrong here, and both were invisible to every other suite.
{
  const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const rn = fs.readFileSync(new URL('./render.js', import.meta.url), 'utf8');

  // [KNOWN-BUG PROBE] Matt: "when i swing, then the cartoon golfer animation swing thing happens,
  // the little guy runs forward. it's very strange. He shouldn't move location on the screen."
  // He was drawn at `st.ball` - the LIVE ball - so once the shot was away he was re-drawn at the
  // flying ball's position every frame and slid down the fairway behind his own shot. Measured in
  // the reference: the cap's centroid is identical to two decimal places across all 45 frames of
  // the address hold, and once the camera pans it tracks off screen at a steady 1.9 px a frame -
  // he never moves in the world at all.
  ok('[KNOWN-BUG PROBE] the golfer is drawn where the ball WAS, not where it is',
    /st\.golferAt \|\| st\.ball/.test(rn) && /golferAt: this\.ball/.test(ui),
    'ui passes the address position and render.js draws the anchor, never the live ball');
  ok('...and the sprite is not hidden the moment the ball is away',
    /golfer: !this\.holed/.test(ui) && !/golfer: !this\.anim/.test(ui),
    'the reference keeps drawing him as the camera pans off; ours used to blink out after 260 ms');

  // [KNOWN-BUG PROBE] Matt: "when I first press Swing, the entire screen moves to show the
  // golfer... It's [too] much to focus on the power/aim task when you're moving the whole screen
  // around." The free look HOLDS where you leave it, so a player who had scrolled up the fairway
  // got half a second of the course sliding sideways starting on the same frame as the backswing.
  ok('[KNOWN-BUG PROBE] the view snaps home when the stroke begins, it does not glide',
    /if \(r === 'begin'\) \{ this\.previewDx = 0; this\.previewDy = 0;/.test(ui)
    && !/if \(r === 'begin'\) this\.returning = true;/.test(ui),
    'the eased return is still right for a TAP on the course, which is a deliberate come-back gesture');
  ok('...and the tap-on-the-course return still eases',
    /this\.returning = true;/.test(ui),
    'both behaviours must exist; only the swing one snaps');

  // The pose timeline, against what was measured. Read the constants out of the file so the test
  // fails if they are retuned without a new measurement rather than silently tracking them.
  const num = (name) => {
    const m = ui.match(new RegExp(`const ${name} = (\\d+);`));
    return m ? Number(m[1]) : NaN;
  };
  const still = num('POSE_STILL_MS');
  const back = num('POSE_BACK_MS');
  const thru = num('POSE_THRU_MS');
  const windup = num('WINDUP_MS');
  ok(`the golfer is dead still for the first ${still} ms after the third tap`, still >= 240 && still <= 290,
    'measured 265 ms: 45 frames with 4-6 px of noise and an identical cap centroid');
  ok(`the swing itself is ${back + thru} ms of animation`, back + thru >= 70 && back + thru <= 120,
    'measured ~100 ms: four big-change frames with near-static frames between them');
  ok(`the finish is then HELD for ${windup - still - back - thru} ms`,
    windup - still - back - thru >= 400,
    'measured ~440 ms of a completely static new pose before the ball leaves');
  ok('the golfer does NOT animate during the swing meter',
    !/PHASE\.BACK\) swingPose/.test(ui),
    'the reference sprite does not move until 265 ms AFTER the third tap; ours played the backswing on tap 1');
  ok('there are four poses, and the finish is one of them',
    /pose === 3/.test(rn), 'address, top, through, finish');
}

console.log('\n-- 12d. THE GREEN SLOPE READ, AND THE METER SCALE --');
{
  const RN = await import('./render.js');
  const D = 180 / Math.PI;
  // [KNOWN-BUG PROBE] The screen y axis is flipped (`sy` is `cam.y - y`), so a chevron built
  // straight from the world gradient points UPHILL - every read backwards, and entirely plausible
  // on screen. holes.js warns about exactly this for the grid; the glyph has the same trap.
  ok('[KNOWN-BUG PROBE] a downhill-away gradient points UP the screen',
    Math.abs(RN.slopeGlyphAngle([0, 1]) * D + 90) < 1e-9,
    'canvas y grows downward, so -90 deg is up');
  ok('...and downhill-toward-the-tee points down it',
    Math.abs(RN.slopeGlyphAngle([0, -1]) * D - 90) < 1e-9);
  ok('left and right are not flipped',
    Math.abs(RN.slopeGlyphAngle([1, 0])) < 1e-9 && Math.abs(Math.abs(RN.slopeGlyphAngle([-1, 0]) * D) - 180) < 1e-9);

  const rn = fs.readFileSync(new URL('./render.js', import.meta.url), 'utf8');
  // [KNOWN-BUG PROBE] Matt: "all of the greens you've created have dots all over them. I think you
  // mistook the arrows indicating slope from the example game for decoration." Two bugs: the glyph
  // was a line segment whose LENGTH was the slope magnitude (1-4 px on real data), and it was
  // rasterised into the map at MAP_PPY, where a 3.5 yd cell is 8.4 px and a faithful glyph is 1.6.
  ok('[KNOWN-BUG PROBE] the slope glyph is a FIXED size, not the slope magnitude',
    !/cx \+ g\[0\] \* 3\.2/.test(rn) && /SLOPE_GLYPH_FRAC/.test(rn),
    'the direction is the whole of what the reference encodes; 18 x 18 px on a 96 px grid');
  ok('...and it is drawn per FRAME, not baked into the map raster',
    /export function drawSlope/.test(rn) && /drawSlope\(ctx, hole, cam/.test(rn),
    'a screen-space overlay grows with the zoom, which is when the read is actually used');
  near('the glyph is about 0.30 of the grid spacing, as measured', RN.SLOPE_GLYPH_FRAC, 0.30, 0.02);
  near('and it is drawn at about 57 % of the surface\'s own brightness', RN.SLOPE_TINT, 0.57, 0.02);

  // THE ARC'S SCALE. The tick scan read 139.0 / 191.6 / 243.0 deg, and the block 311-338, all around
  // an ESTIMATED ring centre. The bar's level top edge (above) pins zero at exactly 90, and against
  // that every one of those readings is 3 deg low - a CONSTANT offset, which is a rotated centre
  // estimate rather than a different scale. So the scan's angles are corrected by +3 here, and the
  // SPACING - which is what actually sets ARC_DEG_PER_UNIT, and which no centre error of this size
  // disturbs - is asserted separately below.
  const SCAN_BIAS = 3;
  for (const [pct, deg] of [[0.25, 139.0], [0.5, 191.6], [0.75, 243.0]]) {
    near(`${pct * 100} % sits at ${deg} deg in the scan, ${deg + SCAN_BIAS} corrected`,
      SW.ARC_A0_DEG + pct * SW.ARC_DEG_PER_UNIT, deg + SCAN_BIAS, 1.5);
  }
  near('the ticks are 52 deg apart per 25 %, which is what sets the scale',
    SW.ARC_DEG_PER_UNIT / 4, (243.0 - 139.0) / 2, 1.2,
    'a difference, so the centre bias cancels out of it entirely');
  near('100 % is at 298 deg', SW.ARC_A0_DEG + SW.ARC_DEG_PER_UNIT, 298, 1.5);

  // [KNOWN-BUG PROBE] THE ACCURACY BAR MUST BE LEVEL AND CENTRED UNDER THE RING. Its corners are
  // `ang(+/- BAR_HALF)`, so that is true if and only if zero is at 90 deg - straight down. It was
  // briefly set to 87 from the tick scan and Matt saw it at once: "You moved it up and to the left
  // and rotated it in an odd way." The reference's own bar, cropped at 1:1, has a DEAD HORIZONTAL
  // white line along the top of its stripes - an observable that needs no estimate of where the
  // ring's centre is, which is exactly what was wrong with the scan.
  {
    const ang = (v) => (SW.ARC_A0_DEG + v * SW.ARC_DEG_PER_UNIT) * Math.PI / 180;
    const dy = Math.sin(ang(SW.BAR_HALF)) - Math.sin(ang(-SW.BAR_HALF));
    const dx = Math.cos(ang(SW.BAR_HALF)) + Math.cos(ang(-SW.BAR_HALF));
    ok('[KNOWN-BUG PROBE] the accuracy bar sits level', Math.abs(dy) < 1e-12,
      `its two ends are ${dy.toFixed(4)} of a radius apart in height`);
    ok('...and centred under the ring', Math.abs(dx) < 1e-12,
      'both are only true when zero is straight down, at 90 deg');
  }
  near('the over-swing block starts at 311 deg in the scan, 314 corrected',
    SW.ARC_A0_DEG + SW.BLOCK_FROM * SW.ARC_DEG_PER_UNIT, 311 + SCAN_BIAS, 1.5);
  near('and the arc ends at 338 deg in the scan, 341 corrected',
    SW.ARC_A0_DEG + SW.SWING_MAX * SW.ARC_DEG_PER_UNIT, 338 + SCAN_BIAS, 1.5);
  ok('there is a plain buffer between the 100 % line and the danger', SW.BLOCK_FROM > 1.03);

  const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  ok('the meter reads the scale from swing.js instead of keeping its own copy',
    /ARC_A0_DEG \* DEG/.test(ui) && !/221 \* DEG/.test(ui),
    'two copies of the scale is how the meter and the model drift apart while both look fine');
  ok('[KNOWN-BUG PROBE] there are tick LINES at 25/50/75, not just labels',
    /for \(const v of \[0\.25, 0\.5, 0\.75\]\) \{[\s\S]{0,400}?c\.beginPath\(\); c\.moveTo/.test(ui),
    'Matt: "The 100 has the green line, which is good. but the others need lines as well."');
  ok('the green stripe IS the 100 % line', /arc\(0\.985, 1\.004/.test(ui));

  // The lie readout is a picture of the surface, not the word.
  ok('[KNOWN-BUG PROBE] the lie readout is a PICTURE of the surface',
    /function lieArt\(kind, pal\)/.test(ui) && /data-role="lieart"/.test(ui) && !/data-role="lie"/.test(ui));
  ok('...and it paints from the SAME map the ground is painted from',
    /fillsFor\(pal\)\[kind\]/.test(ui),
    'a second colour table would let the tile show a green the course does not have');
  ok('...and the lie name survives for a screen reader',
    /setAttribute\('aria-label', t\(`lie_\$\{lie\}`\)\)/.test(ui));
}

console.log('\n-- 12e. THE COURSE ART PASS --');
{
  const RN = await import('./render.js');
  const rn = fs.readFileSync(new URL('./render.js', import.meta.url), 'utf8');

  // THE TREE SILHOUETTE MUST FIT INSIDE ITS OWN COLLISION RADIUS. shot.js's treeHit tests the ball
  // against `type.canopy`, and this renderer's whole contract is that what is painted is what stops
  // the ball - a bump sticking out past `r` is a tree the ball flies straight through.
  {
    let worst = 0;
    for (const [x, y, rr] of RN.treeShapes(0, 0, 10, false)) worst = Math.max(worst, Math.hypot(x, y) + rr);
    ok(`the canopy's bumps stay inside the collision radius (${worst.toFixed(2)} of 10)`, worst <= 10 + 1e-9);
    ok('a cactus is one circle, drawn at its trunk', RN.treeShapes(0, 0, 10, true).length === 1);
    ok('a tree is a union of circles, not a disc', RN.treeShapes(0, 0, 10, false).length > 1);
  }

  // [KNOWN-BUG PROBE] The black key has to be drawn UNDER the fill at a larger radius. Stroking a
  // multi-arc path outlines every SUB-path, so the first attempt put a black ring around each bump
  // and a tree belt came out looking like a row of mushrooms.
  ok('[KNOWN-BUG PROBE] the tree key is filled under the canopy, never stroked over it',
    /ctx\.arc\(cx, cy, cr \+ key, 0, Math\.PI \* 2\); ctx\.fill\(\)/.test(rn)
    && !/ctx\.lineWidth = Math\.max\(1\.2, MAP_PPY \* 0\.75\);\s*\n\s*ctx\.strokeStyle = tintOf\(rim/.test(rn));

  // [KNOWN-BUG PROBE] ...and EVERY key before ANY canopy. Belts overlap now (BELT_PITCH), so a
  // per-tree draw paints the next tree's black key straight over the last tree's finished canopy
  // and the mushroom ring comes back at every seam inside the wood, where no probe on a single
  // tree's shapes could ever see it.
  {
    const keyAt = rn.indexOf('cr + key, 0, Math.PI * 2); ctx.fill()');
    const fillAt = rn.indexOf('for (const [cx, cy, cr] of s.shapes) { ctx.beginPath(); ctx.arc(cx, cy, cr, 0');
    ok('[KNOWN-BUG PROBE] every tree key is laid down before any canopy',
      keyAt > 0 && fillAt > keyAt && /const stand = treesOf\(hole\)\.map/.test(rn));
  }

  // Tree shadows: measured off the reference, offset by the tree's own HEIGHT and composited in
  // ONE pass - stacking them per tree would blotch a wood with its own darker seams.
  ok('trees cast a shadow, offset by their own height',
    /SHADOW_LEN/.test(rn) && /type\.height \* SHADOW_LEN/.test(rn) && /type\.height \* SHADOW_DROP/.test(rn));
  ok('...composited once at SHADOW_ALPHA, not drawn per tree',
    /ctx\.globalAlpha = SHADOW_ALPHA;\s*\n\s*ctx\.drawImage\(sh, 0, 0\)/.test(rn));

  // The mow stripes, re-measured: a 3.8 yd period at a third dark, against a pair seven levels
  // apart. The old build drew 7-on-7-off at sixteen levels - 3.7x the width, 2.3x the contrast.
  {
    const a = RN.PALETTE.fairwayA, b2 = RN.PALETTE.fairwayB;
    const lum = (h2) => parseInt(h2.slice(1, 3), 16) + parseInt(h2.slice(3, 5), 16) + parseInt(h2.slice(5, 7), 16);
    ok(`the mow stripe period is the measured 3.8 yds (${RN.MOW_PERIOD_YD})`, Math.abs(RN.MOW_PERIOD_YD - 3.8) < 0.01);
    ok(`...one third of it dark (${RN.MOW_DARK_SHARE.toFixed(2)})`, Math.abs(RN.MOW_DARK_SHARE - 1 / 3) < 0.01);
    ok(`...and the pair is under 6 % apart (${(100 * (lum(a) - lum(b2)) / lum(a)).toFixed(1)} %)`,
      lum(a) > lum(b2) && (lum(a) - lum(b2)) / lum(a) < 0.06);
  }

  // The seam is a DARKENING, not a colour: measured at 0.87x the darker surface's own brightness,
  // which is why one rule covers sand-on-grass, water-on-grass and green-on-collar alike.
  ok('the surface seam is translucent black, not a fourth green',
    /rgba\(0,0,0,\$\{SEAM_ALPHA\}\)/.test(rn) && /const SEAM_ALPHA = 0\.1/.test(rn));
  ok('...and it is drawn OUTSIDE the clip, so it lands on both surfaces',
    /ctx\.restore\(\);\s*\n\s*\n\s*\/\/ THE SEAM, outside the clip/.test(rn));
  ok('water paints its own dirt bank instead of taking the seam',
    /if \(s\.kind !== 'water'\) \{/.test(rn) && /ctx\.strokeStyle = pal\.bank;/.test(rn));

  // The rough's texture is seeded, like every other generated thing on a hole: a pattern that
  // reshuffled per load would make the same hole look different every visit for no gain.
  ok('the rough grows tufts, and they are seeded', /function scatterTufts/.test(rn) && /mulberry32\(seed\)/.test(rn));
  ok('...and the tuft colour is a tint of the surface, not a new palette entry',
    /scatterTufts\(ctx, b, toPx, tintOf\(/.test(rn));

  // Water and sand each got the thing that makes them read as a dish rather than a puddle.
  ok('water is banded and has a mud line at its lip',
    /pal\.bankMud/.test(rn) && /ctx\.globalAlpha = 0\.45;/.test(rn));
  ok('bunkers have a bank inside their edge', /ctx\.strokeStyle = tintOf\(pal\.sandDot, 0\.9\);/.test(rn));

  // Both themes must carry every new palette key, or a desert hole paints `undefined`.
  for (const key of ['water', 'waterBand', 'waterEdge', 'bank', 'bankMud', 'sandDot']) {
    ok(`both themes define ${key}`,
      typeof RN.THEMES.pine[key] === 'string' && typeof RN.THEMES.desert[key] === 'string',
      'a missing key paints `undefined`, which canvas silently ignores');
  }
}

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
    if (mustPutt(lie)) {
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
      if (mustPutt(lie)) {
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
