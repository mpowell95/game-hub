// pinball/js/test.js - headless tests for the solver, the table geometry and the rules.
// Run: node pinball/js/test.js      (also wired into run-all-tests.mjs)
//
// The block that earns its keep is the SOAK at the bottom. A pinball table is thirty-odd colliders,
// two one-way gates, two arcs and a scripted ramp, and the failure modes are not "the score is
// wrong" - they are "the ball left the table through a seam" and "the ball is wedged in a corner
// and the game is over without being over". Neither is reachable by unit-testing a function; both
// are found by playing thousands of simulated seconds and asserting invariants the whole time. So
// the soak plays complete games with random flipper input and asserts, on EVERY step, that no ball
// is outside the table and that the game keeps making progress.

import { readFileSync } from 'node:fs';
import DT from './table-design.js';
import { DesignPinball } from './design.js';
import { step, makeBall, seg, circle, flipper, PHYS_DT, MAX_SPEED, BALL_R } from './physics.js';
import { W, H, DRAIN_Y, buildTable, SWITCHES, RAMP_PATH, PLUNGER, ARCH, AXIS, FLIP, DROP_COUNT, ART } from './table.js';
import { Pinball, mulberry32, rampPoint, MISSIONS, PTS, GRAVITY } from './game.js';


let fail = 0, count = 0;
function ok(label, cond, extra) {
  count++;
  if (cond) { console.log(`ok   ${label}`); return; }
  fail++;
  console.log(`FAIL ${label}${extra ? `\n       ${extra}` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. the solver -------------------------------------------------------------------------------

{
  const world = { colliders: [], flippers: [], gravity: 1000, drag: 0 };
  const b = makeBall(0, 0);
  for (let i = 0; i < Math.round(1 / PHYS_DT); i++) step(world, [b], null);
  ok('gravity: one second of free fall reaches ~1000 u/s', near(b.vy, 1000, 12), `vy=${b.vy.toFixed(1)}`);
}

{
  const floor = seg(-100, 100, 100, 100, { e: 0.5, r: 4 });
  const world = { colliders: [floor], flippers: [], gravity: 1000, drag: 0 };
  const b = makeBall(0, 0, 0, 600);
  let bounced = false;
  for (let i = 0; i < 480 && !bounced; i++) { step(world, [b], null); if (b.vy < 0) bounced = true; }
  ok('a wall reflects, scaled by restitution', bounced && b.vy < 0 && Math.abs(b.vy) < 600,
    `vy=${b.vy.toFixed(1)}`);
  ok('a wall never lets the ball through', b.y < 100, `y=${b.y.toFixed(1)}`);
}

{
  // A one-way gate is the mechanism the shooter lane and the orbit deflector both depend on, and
  // getting its sense backwards is silent: the table still "works", it just never lets the orbit
  // return. Both directions asserted explicitly.
  const gate = seg(-50, 0, 50, 0, { e: 0.3, r: 4, oneWay: [0, 1] });
  const world = { colliders: [gate], flippers: [], gravity: 0, drag: 0 };
  const up = makeBall(0, 40, 0, -400);
  for (let i = 0; i < 120; i++) step(world, [up], null);
  ok('one-way gate: an upward ball passes straight through', up.y < -20, `y=${up.y.toFixed(1)}`);

  const down = makeBall(0, -40, 0, 400);
  for (let i = 0; i < 240; i++) step(world, [down], null);
  ok('one-way gate: a downward ball is stopped', down.y < 0, `y=${down.y.toFixed(1)}`);
}

{
  const f = flipper(0, 0, 60, 0.5, -0.5, { speed: 27 });
  const world = { colliders: [], flippers: [f], gravity: 0, drag: 0 };
  const b = makeBall(40 * Math.cos(0.5), 40 * Math.sin(0.5) - 14, 0, 0);
  f.pressed = true;
  for (let i = 0; i < 60; i++) step(world, [b], null);
  const sp = Math.hypot(b.vx, b.vy);
  ok('a swung flipper THROWS the ball (surface velocity, not restitution)', sp > 300, `speed=${sp.toFixed(0)}`);

  // ...but only while it is MOVING. Let the paddle finish its sweep FIRST, then throw a ball at
  // it: a flipper already pinned against its stop has omega 0 and must behave like any other wall.
  // (Getting this wrong is not theoretical - it is what makes a held flipper into a machine gun.)
  const f2 = flipper(0, 0, 60, 0.5, -0.5, { speed: 27 });
  const w2 = { colliders: [], flippers: [f2], gravity: 0, drag: 0 };
  f2.pressed = true;
  for (let i = 0; i < 120; i++) step(w2, [], null);     // sweep completes, omega settles to 0
  const b2 = makeBall(40 * Math.cos(-0.5), 40 * Math.sin(-0.5) - 30, 0, 260);
  for (let i = 0; i < 120; i++) step(w2, [b2], null);
  const sp2 = Math.hypot(b2.vx, b2.vy);
  ok('a flipper HELD at its stop is a wall, not a catapult', sp2 < 260, `speed=${sp2.toFixed(0)}`);
}

{
  const world = { colliders: [], flippers: [], gravity: 400000, drag: 0 };
  const b = makeBall(0, 0);
  for (let i = 0; i < Math.round(1 / PHYS_DT); i++) step(world, [b], null);
  ok('speed is hard-capped (the anti-tunnelling bound)', Math.hypot(b.vx, b.vy) <= MAX_SPEED + 1e-6);
}

{
  const world = { colliders: [], flippers: [], gravity: 0, drag: 0 };
  const a = makeBall(-20, 0, 300, 0), b = makeBall(20, 0, -300, 0);
  for (let i = 0; i < 120; i++) step(world, [a, b], null);
  ok('two balls bounce off each other (multiball)', a.vx < 0 && b.vx > 0, `${a.vx.toFixed(0)} ${b.vx.toFixed(0)}`);
}

// --- 2. table geometry ----------------------------------------------------------------------------

{
  const { colliders, flippers } = buildTable({ outlaneSaves: true });
  ok('the table builds a full collider set', colliders.length > 25 && flippers.length === 2,
    `${colliders.length} colliders`);
  const ids = colliders.map((c) => c.id).filter(Boolean);
  ok('collider ids are unique', new Set(ids).size === ids.length);

  // Every switch has to sit somewhere a ball can physically be. The cheap version of that check:
  // no switch centre is buried inside a solid collider.
  const buried = SWITCHES.filter((s) => colliders.some((c) => {
    if (c.t === 'circle') return Math.hypot(s.x - c.x, s.y - c.y) < c.r;
    return false;
  }));
  ok('no switch is buried inside a post or bumper', buried.length === 0, buried.map((b) => b.id).join(', '));

  const off = SWITCHES.filter((s) => s.x < 0 || s.x > W || s.y < 0 || s.y > H);
  ok('every switch is inside the table', off.length === 0);

  const rampOff = RAMP_PATH.filter(([x, y]) => x < 0 || x > W || y < 0 || y > H);
  ok('the ramp habitrail stays on the table', rampOff.length === 0);
}

{
  let jumps = 0, prev = rampPoint(0);
  for (let i = 1; i <= 200; i++) {
    const p = rampPoint(i / 200);
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 12) jumps++;
    prev = p;
  }
  ok('the ramp path is continuous (no teleporting ball)', jumps === 0, `${jumps} jumps`);
  const end = rampPoint(1);
  ok('the ramp ends at the right inlane', end.x > 210 && end.y > 500, `${end.x},${end.y}`);
}

// --- 3. the rules ----------------------------------------------------------------------------------

function fresh(diff = 'medium') { return new Pinball({ difficulty: diff, rand: mulberry32(7) }); }

/** Drive a game far enough to have a live ball on the playfield. */
function launched(g) {
  g.start();
  g.plungerDown();
  for (let i = 0; i < 80; i++) g.update(1 / 60);
  g.plungerUp();
  return g;
}

{
  const g = fresh();
  g.start();
  ok('a new game serves ball 1 on the plunger', g.balls.length === 1 && g.balls[0].onPlunger);
  ok('a new game scores zero', g.score === 0);
  launched(g);
  ok('releasing the plunger launches the ball upward', g.balls[0].vy < -500, `vy=${g.balls[0].vy}`);
  ok('phase moves to play', g.phase === 'play');
}

{
  // Clearing the bank lights the scoop; the scoop then starts mission 1. Driven through the real
  // contact/switch entry points, never by poking fields, so a rename in game.js fails this.
  const g = launched(fresh());
  for (let i = 0; i < DROP_COUNT; i++) g._contact('id', `drop${i}`, 100, 350, 400, g.balls[0]);
  ok('every drop target completes the bank', g.bankLit === true);
  ok('the bank resets so the shot stays available', g.drops.every((d) => d === false));
  const b = g.balls[0];
  g._switchHit(SWITCHES.find((s) => s.id === 'scoop'), b);
  ok('the scoop starts a mission when the bank is lit', !!g.mission && g.mission.id === MISSIONS[0].id);
  ok('the mission consumed the bank light', g.bankLit === false);
}

{
  const g = launched(fresh());
  const before = g.score;
  for (let i = 0; i < MISSIONS[0].need; i++) g._contact('id', 'pop0', 110, 262, 400, g.balls[0]);
  ok('bumper hits do not advance a mission that is not running', g.missionsDone === 0);
  ok('bumpers still score', g.score > before);
}

{
  const g = launched(fresh());
  for (let i = 0; i < DROP_COUNT; i++) g._contact('id', `drop${i}`, 100, 350, 400, g.balls[0]);
  g._switchHit(SWITCHES.find((s) => s.id === 'scoop'), g.balls[0]);
  const need = g.mission.need;
  for (let i = 0; i < need; i++) g._contact('id', 'pop0', 110, 262, 400, g.balls[0]);
  ok('completing a mission counts it and advances the ladder', g.missionsDone === 1 && g.missionIdx === 1);
  ok('the mission ends when it is complete', g.mission === null);
}

{
  const g = launched(fresh());
  const b = g.balls[0];
  for (let i = 0; i < 5; i++) { b.vy = -800; g._rampMade(b); }
  ok('five ramps light the lock', g.lockLit === true);
  const scoop = SWITCHES.find((s) => s.id === 'scoop');
  g._switchHit(scoop, b);
  ok('the scoop banks a lock', g.locks === 1 && g.lockLit === false);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 5; i++) { b.vy = -800; g._rampMade(b); }
    g._switchHit(scoop, g.balls[0]);
  }
  ok('three locks start multiball', !!g.multiball, `locks=${g.locks}`);
  ok('multiball resets the lock ladder', g.locks === 0);
  // Measured as the MOST balls ever on the table at once, not as a snapshot after a fixed number of
  // frames. The old form read g.balls.length at exactly frame 200 and passed only because the extra
  // balls happened to still be alive at that instant. Making every surface frictionless (2026-08-22)
  // sped the whole table up, two of the three drained a few frames earlier, and a test whose own
  // name is about FEEDING went red over drain timing. The feed was never broken - traced 1 -> 2 -> 3
  // balls with all three live at frame 175. Tightened to 3 while here, since toFeed is 2.
  let mostBalls = g.balls.length;
  for (let i = 0; i < 200; i++) { g.update(1 / 60); mostBalls = Math.max(mostBalls, g.balls.length); }
  ok('multiball feeds extra balls onto the table', mostBalls >= 3, `${mostBalls} balls at once`);
}

{
  const g = launched(fresh());
  g._startMultiball(false);
  const b = g.balls[0];
  const s0 = g.score;
  g._rampMade(b);
  ok('the ramp is the jackpot during multiball', g.jackpots === 1 && g.score - s0 >= PTS.jackpot);
  g._rampMade(b); g._rampMade(b);
  ok('three jackpots light the super jackpot', g.superLit === true);
  const s1 = g.score;
  g._switchHit(SWITCHES.find((s) => s.id === 'scoop'), b);
  ok('the scoop collects the super jackpot', g.score - s1 >= PTS.superJackpot && g.superLit === false);
}

{
  const g = launched(fresh());
  const lanes = ['laneH', 'laneU', 'laneB'];
  for (const id of lanes) g._switchHit(SWITCHES.find((s) => s.id === id), g.balls[0]);
  ok('completing H-U-B raises the bonus multiplier', g.bonus.mult === 2);
  ok('completing H-U-B resets the lanes for the next set', Object.values(g.lanes).every((v) => v === false));
}

{
  const g = launched(fresh());
  g.bonus.bumpers = 20; g.bonus.ramps = 4; g.bonus.mult = 3;
  const expect = (20 * 150 + 4 * 1500) * 3;
  const before = g.score;
  g._endBall();
  ok('bonus is base x multiplier', g.pendingBonus.total === expect, `${g.pendingBonus.total} vs ${expect}`);
  for (let i = 0; i < 200; i++) g.update(1 / 60);
  ok('the bonus is actually paid into the score', g.score - before >= expect, `${g.score - before}`);
}

{
  const g = launched(fresh());
  g.bonus.bumpers = 50;
  g.nudge('left'); g.nudge('left'); g.nudge('left');
  ok('three nudges tilt the table', g.tilted === true);
  ok('a tilt zeroes the bonus', g.bonus.bumpers === 0 && g.bonus.mult === 1);
  const s = g.score;
  g._contact('id', 'pop0', 110, 262, 400, g.balls[0]);
  ok('a tilted table scores nothing', g.score === s);
  g.setFlipper('left', true);
  ok('a tilted table has dead flippers', g.flippers[0].pressed === false);
}

{
  const g = launched(fresh('hard'));
  ok('difficulty picks the ball count', g.ballsTotal === 3);
  const e = fresh('easy');
  e.start();
  ok('Casual gives five balls', e.ballsTotal === 5);
  ok('Casual seals the outlane mouths with save posts', e.colliders.some((c) => c.id === 'savePostL'));
  ok('Tournament leaves them wide open', !g.colliders.some((c) => c.id === 'savePostL'));
}

{
  const g = launched(fresh());
  g.saveTimer = 5;
  g.balls[0].y = DRAIN_Y + 10;
  g.update(1 / 60);
  ok('the ball save re-serves instead of ending the ball', g.ball === 1 && g.balls.length === 1);
  g.saveTimer = 0;
  g.balls[0].held = false; g.balls[0].onPlunger = false;
  g.balls[0].y = DRAIN_Y + 10;
  g.update(1 / 60);
  ok('with no save left, the ball ends into the bonus count', g.phase === 'bonus');
}

{
  const g = launched(fresh());
  g.score = 800000;
  g._award(1, 0, 0);
  ok('an extra ball is awarded at the threshold', g.extraBalls === 1);
  g._award(1, 0, 0);
  ok('...and only once', g.extraBalls === 1);
}

// ---- [KNOWN-BUG PROBE] a capture switch awards ONCE per shot, not once per frame ----------------
//
// Matt shot the scoop on ball one and banked 1.5 MILLION while the ball sat in it (2026-08-11).
// The switch edge-detector read `!b.held && dist < r`, so a held ball counted as OUTSIDE its own
// switch. A capture parks the ball ON the switch centre, so the moment the scoop ejected it - still
// well inside the 10-unit radius - the detector saw a fresh rising edge and captured it again.
// Eject, re-capture, score, eject, forever, at 2.2 awards a second.
//
// Nothing in this file caught it, and that is the more interesting half. The soak's two stuck
// detectors are "the score stopped moving" and "the ball stopped moving", and this bug MAXIMISES
// the first and is exempt from the second (a held ball is skipped by the watchdog by design). So
// both probes below are new invariants, not a tightened threshold: one deterministic, and one in
// the soak measuring HELD TIME, which is the thing that was actually wrong.

{
  const g = launched(fresh());
  const sc = SWITCHES.find((x) => x.id === 'scoop');
  const before = g.score;
  const b = g.balls[0];
  b.x = sc.x; b.y = sc.y + 40; b.vx = 0; b.vy = -700;   // straight up into the scoop mouth
  let scoops = 0, maxHeld = 0, held = 0;
  for (let i = 0; i < 600; i++) {                        // ten seconds
    g.update(1 / 60);
    for (const ev of g.takeEvents()) if (ev.type === 'scoop') scoops++;
    const live = g.balls.find((x) => x.live && !x.onPlunger);
    held = live && live.held ? held + 1 / 60 : 0;
    maxHeld = Math.max(maxHeld, held);
  }
  ok('[KNOWN-BUG PROBE] the scoop awards ONCE per shot, not once per frame', scoops === 1,
    `${scoops} awards in 10 s`);
  ok('[KNOWN-BUG PROBE] one scoop shot cannot bank a fortune', g.score - before < 100000,
    `banked ${g.score - before}`);
  ok('[KNOWN-BUG PROBE] the scoop lets the ball go again', maxHeld < 2.5, `held ${maxHeld.toFixed(1)}s`);
}

// ---- ...and the ramp, which is the other switch that takes the ball away ------------------------
{
  const g = launched(fresh());
  const r = SWITCHES.find((x) => x.id === 'rampIn');
  const b = g.balls[0];
  b.x = r.x; b.y = r.y; b.vx = 0; b.vy = -700;
  let ramps = 0;
  for (let i = 0; i < 360; i++) {
    g.update(1 / 60);
    for (const ev of g.takeEvents()) if (ev.type === 'ramp') ramps++;
  }
  ok('[KNOWN-BUG PROBE] one ramp entry is one ramp, not a loop', ramps === 1, `${ramps} ramps in 6 s`);
}

// --- 4. THE SOAK: play real games and assert the invariants on every step --------------------------
//
// This is the block that catches geometry mistakes. A seam between two walls, an arc whose angular
// span is a degree short, a one-way gate facing the wrong way, two convex surfaces a whisker under
// one ball apart - none of them show up in a unit test and all of them show up here. Every wedge
// this table ever had was found by this loop and by nothing else: the scoop against the right wall,
// the inlane divider against the flipper pivot, the stand-up target against the side wall, and two
// separate wrong answers for the Casual outlane save.
//
// WHAT IT DOES NOT ASSERT, AND WHY. Not "every game finishes". Random flipping is an unrealistically
// good pinball player - perfect reflexes, no fear - so a random driver on Casual (sealed outlanes,
// 12 s ball save, five balls) legitimately keeps one ball alive for minutes. Failing on that would
// be testing the driver, not the table. The invariants below are the ones that are true of a
// CORRECT table regardless of how well it is being played; the full drain -> bonus -> next ball ->
// game over chain is proved separately, deterministically, just underneath.

{
  let escapes = 0, searches = 0, gamesFinished = 0, drains = 0, totalScore = 0;
  let maxBalls = 0, longestStall = 0, worstX = 0, worstY = 0, longestHold = 0;

  for (let gameN = 0; gameN < 6; gameN++) {
    const rand = mulberry32(1000 + gameN * 977);
    const g = new Pinball({ difficulty: ['easy', 'medium', 'hard'][gameN % 3], rand });
    g.start();
    let t = 0, lastScore = 0, stall = 0;

    while (t < 300 && g.phase !== 'over') {
      // Keyed off the ball actually sitting on the plunger, not the phase, so a dribbled plunge
      // gets re-plunged the way a real player would rather than wedging the soak against its own
      // driver (which is exactly what the first version of this loop did).
      if (g.hud().onPlunger && !g.plungerHeld) g.plungerDown();
      else if (g.plungerHeld && rand() < 0.02) g.plungerUp();
      if (rand() < 0.07) g.setFlipper('left', true);
      if (rand() < 0.14) g.setFlipper('left', false);
      if (rand() < 0.07) g.setFlipper('right', true);
      if (rand() < 0.14) g.setFlipper('right', false);
      if (rand() < 0.0015) g.nudge(rand() < 0.5 ? 'left' : 'right');

      g.update(1 / 120);
      t += 1 / 120;

      for (const b of g.balls) {
        if (!b.live) continue;
        // The invariant. -30 at the top is the arch channel's headroom, not slack: the outer arch
        // peaks at y=61 and nothing may leave the table at all.
        if (b.x < -10 || b.x > W + 10 || b.y < -30 || b.y > H + 40) escapes++;
        worstX = Math.max(worstX, Math.max(-b.x, b.x - W));
        worstY = Math.max(worstY, Math.max(-b.y, b.y - H));
      }
      maxBalls = Math.max(maxBalls, g.balls.length);
      // The invariant the scoop loop actually violated. Every legitimate hold is short and known
      // (the ramp ride is 1.15 s, a scoop hold is under a second), so a ball held for seconds on
      // end is a capture that is not letting go - whatever the score is doing.
      for (const b of g.balls) {
        if (!b.live) continue;
        if (b.held && !b.onPlunger) { b._t = (b._t || 0) + 1 / 120; longestHold = Math.max(longestHold, b._t); }
        else b._t = 0;
      }
      for (const ev of g.takeEvents()) {
        if (ev.type === 'ballsearch' && !ev.soft) searches++;
        if (ev.type === 'drain') drains++;
      }

      // A TILTED table legitimately scores nothing until the ball drains, so tilt time is excluded
      // rather than counted as a wedge. Without this the random nudges below produce a 170-second
      // "stall" that is the rules working exactly as designed.
      if (g.hud().tilt) { stall = 0; lastScore = g.score; }
      else if (g.score === lastScore) { stall += 1 / 120; longestStall = Math.max(longestStall, stall); }
      else { stall = 0; lastScore = g.score; }
    }
    if (g.phase === 'over') gamesFinished++;
    totalScore += g.score;
  }

  ok('SOAK: no ball ever leaves the table', escapes === 0,
    `${escapes} escapes; worst overshoot x=${worstX.toFixed(1)} y=${worstY.toFixed(1)}`);
  ok('SOAK: no wedges - the table is never dead for more than 25 s at a time', longestStall < 25,
    `${longestStall.toFixed(1)} s`);
  ok('SOAK: the ball-search watchdog almost never has to re-serve', searches <= 4, `${searches} re-serves`);
  // 2026-09-07: THIS THRESHOLD CAME DOWN FROM 12 TO 3, AND THE REASON IS NOT THAT THE TABLE GOT
  // EASIER TO TEST. Two things changed under it. The outlanes stopped being funnels (the lane
  // guide in table.js), and physics.js learned to CRADLE - a slow ball on a raised paddle is
  // damped and stays there. This driver presses a flipper on 7% of steps and releases on 14%,
  // so it holds one up about a third of the time, which on a table that can cradle makes it a
  // far better player than it used to be. Random flipping was always an unrealistically good
  // pinball player; it is now an unrealistically good one WITH a ball trap.
  //
  // So this assertion is no longer the one that says whether the table is playable, and pretending
  // otherwise is how a leaking table shipped. The measurement that DOES track it is the one
  // below: ball life with the save switched off. On the 2026-09-06 build that was 5.6 seconds
  // with every single drain going out an outlane and none down the middle - a table that was not
  // hard, it was leaking - and a 45-second recording of real play shows exactly that, four drains
  // and four ball saves inside 25 seconds.
  ok('SOAK: balls really do drain', drains >= 3, `${drains} drains`);
  ok('SOAK: random play scores', totalScore > 0, `total ${totalScore}`);
  ok('SOAK: the ball count stays sane (multiball adds two, never more)', maxBalls >= 1 && maxBalls <= 4,
    `max ${maxBalls} balls`);
  // Deliberately NOT asserted any more, for the reason above: with a cradle available a random
  // driver can keep a ball alive for the whole 300 s, and failing on that is testing the driver
  // rather than the table. The full drain -> bonus -> next ball -> game over chain is proved
  // deterministically in 4b, which is where it belongs.
  ok('SOAK: games make real progress', totalScore > 200000, `total ${totalScore}`);
  ok('SOAK: no capture ever holds the ball for more than 2.5 s', longestHold < 2.5,
    `longest hold ${longestHold.toFixed(1)}s - a capture switch is not letting go`);
}

// --- 4a2. THE NUMBER THAT SAYS WHETHER THE TABLE IS PLAYABLE ---------------------------------
//
// Ball life with the ball save switched OFF, and which of the three exits the ball leaves by.
// Both halves matter and the second is the one that found the bug:
//
//   2026-09-06 build:  median 5.6 s,  drains 12 left outlane / 0 centre / 6 right outlane
//   after the rework:  median 40 s,   drains  3 left outlane / 7 centre / 5 right outlane
//
// A real machine drains mostly DOWN THE MIDDLE. A table whose drains are all out of the sides
// is not difficult, it is leaking, and no assertion in this file could see that: the soak
// above passed the whole time, because a ball save was re-arming on every save and hiding it.
{
  const lives = [];
  const exits = { left: 0, centre: 0, right: 0 };
  const tipL = AXIS - FLIP.dx + Math.cos(FLIP.rest) * FLIP.len;
  const tipR = AXIS + FLIP.dx - Math.cos(FLIP.rest) * FLIP.len;
  for (let n = 0; n < 5; n++) {
    const rand = mulberry32(4400 + n * 131);
    const g = new Pinball({ difficulty: 'medium', rand });
    g.start();
    let t = 0, served = 0;
    while (t < 180 && g.phase !== 'over') {
      g.saveTimer = 0;                                  // the instrument
      if (g.phase === 'ready') {
        g.plungerDown();
        for (let i = 0; i < 55; i++) g.update(1 / 120);
        g.plungerUp();
        served = t;
      }
      if (rand() < 0.07) g.setFlipper('left', true);
      if (rand() < 0.16) g.setFlipper('left', false);
      if (rand() < 0.07) g.setFlipper('right', true);
      if (rand() < 0.16) g.setFlipper('right', false);
      g.update(1 / 120); t += 1 / 120;
      for (const ev of g.takeEvents()) {
        if (ev.type !== 'drain') continue;
        lives.push(t - served);
        served = t;
        // A drain counts as CENTRE only if it went between the tips. Anything wider than that
        // went round the OUTSIDE of a paddle, and calling it a centre drain is what hid a sealed
        // drain gap for a whole build: this block reported 7 centre drains on a table where the
        // gap was narrower than the ball and no centre drain was physically possible.
        if (ev.x < tipL) exits.left++; else if (ev.x > tipR) exits.right++; else exits.centre++;
      }
    }
  }
  lives.sort((a, b) => a - b);
  const med = lives.length ? lives[Math.floor(lives.length / 2)] : 0;
  const total = exits.left + exits.centre + exits.right;
  // THE GAP BETWEEN THE FLIPPER TIPS HAS TO BE WIDER THAN THE BALL, and for one shipped build it
  // was not: 17.4 units against a ball of 18, or 0.97 balls. Matt, on a clip of it: "It's
  // impossible for the ball to go between the paddles", and the footage shows the ball sitting in
  // the V between the two tips, bouncing, never falling through.
  //
  // The arithmetic that was got wrong is worth spelling out, because it is easy to repeat: the
  // gap is NOT the distance between the tip centres. physics.js tapers the paddle capsule to 65%
  // of `r` at the tip, so each tip eats another 0.65*r. Real machines run 1.2 to 1.6 balls.
  {
    const reach = Math.cos(FLIP.rest) * FLIP.len;
    const centres = (AXIS + FLIP.dx - reach) - (AXIS - FLIP.dx + reach);
    const gap = centres - 2 * (FLIP.r * 0.65);
    ok('the ball FITS between the flipper tips', gap > BALL_R * 2 + 2,
      `${gap.toFixed(1)} units = ${(gap / (BALL_R * 2)).toFixed(2)} balls (the 2026-09-07 build shipped 0.97)`);
    ok('...but the drain is not a barn door', gap < BALL_R * 2 * 1.8,
      `${(gap / (BALL_R * 2)).toFixed(2)} balls`);
  }

  ok('SAVE-OFF: a ball lives long enough to be a game (not the 5.6 s of the 2026-09-06 build)',
    med > 12, `median ${med.toFixed(1)}s over ${lives.length} balls`);
  ok('SAVE-OFF: the middle is a real drain, not just the outlanes',
    total > 0 && exits.centre / total >= 0.25,
    `left ${exits.left} centre ${exits.centre} right ${exits.right}`);
  // The outlanes are checked GEOMETRICALLY rather than by counting drains, and the difference is
  // worth stating. A random driver essentially never finds them - it holds a flipper about a
  // third of the time, so it cradles, and a cradled ball is not going anywhere near an outlane.
  // Counting its drains would therefore measure the driver, not the lane. What CAN be asserted
  // without a driver is that the lane is a real, passable channel: a mouth wider than a ball
  // between the slingshot's outer post and the top of the divider, and a channel wider than a
  // ball all the way down to the drain. If either closes, the outlane has become decoration and
  // the table has lost a third of the ways it can end a ball.
  {
    const cs = buildTable({}).colliders;
    const by = (id) => cs.find((c) => c.id === id);
    const post = by('slingPostL'), div = by('divL'), fun = by('funnelL');
    const mouth = Math.hypot(post.x - div.ax, post.y - div.ay) - post.r - div.r;
    // perpendicular width of the channel, measured at three heights down the divider
    const dx = div.bx - div.ax, dy = div.by - div.ay, dl = Math.hypot(dx, dy);
    const nx = -dy / dl, ny = dx / dl;
    let narrowest = 1e9;
    for (const t of [0.1, 0.35, 0.6]) {
      const px = div.ax + dx * t, py = div.ay + dy * t;
      const fx = fun.bx - fun.ax, fy = fun.by - fun.ay, fl = Math.hypot(fx, fy);
      const u = Math.max(0, Math.min(1, ((px - fun.ax) * fx + (py - fun.ay) * fy) / (fl * fl)));
      const qx = fun.ax + fx * u, qy = fun.ay + fy * u;
      narrowest = Math.min(narrowest, Math.hypot(px - qx, py - qy) - div.r - fun.r);
    }
    ok('the left outlane MOUTH is wider than a ball', mouth > BALL_R * 2 + 2,
      `${mouth.toFixed(1)} against a ball of ${BALL_R * 2}`);
    ok('the left outlane CHANNEL is wider than a ball all the way down',
      narrowest > BALL_R * 2 + 2, `narrowest ${narrowest.toFixed(1)}`);
    ok('the outlane mouth is not so wide it is a funnel', mouth < BALL_R * 2 + 18,
      `${mouth.toFixed(1)}; the 2026-09-06 build had an open bay here and drained 18 of 18 balls out of the sides`);
  }
}

// --- 4a3. THE WHOLE RULES CHAIN, DETERMINISTICALLY ----------------------------------------------
//
// Nothing in this file ever proved that a mission can be COMPLETED, that four of them start the
// wizard, that three locks start a multiball, or that a jackpot pays - and on 2026-09-07 a driven
// game reported eleven mission starts and zero finishes, which could have meant either "the rules
// are broken" or "a random driver cannot play". It was the second, but there was no way to tell
// them apart, which is the gap this block closes: it drives the rules through their REAL entry
// points - the drop bank, the scoop switch, mission progress, the ramp - and never by poking
// fields, so a rename in game.js fails the test rather than silently passing.
{
  const g = new Pinball({ difficulty: 'medium', rand: mulberry32(3) });
  g.start(); g.plungerUp();
  const ball = () => g.balls[0];
  const hitSwitch = (id) => g._switchHit(SWITCHES.find((x) => x.id === id), ball());
  const clearBank = () => {
    for (let i = 0; i < DROP_COUNT; i++) g._contact('id', `drop${i}`, 100, 300, 400, ball());
  };
  const runMission = () => {
    clearBank();
    hitSwitch('scoop');
    const m = g.mission;
    if (!m) return null;
    for (let i = 0; i < m.need + 2; i++) g._missionProgress(m.id, 1);
    return m.id;
  };

  const order = [];
  for (let n = 0; n < MISSIONS.length; n++) order.push(runMission());
  ok('every mission can be started AND completed', g.missionsDone === MISSIONS.length,
    `${g.missionsDone}/${MISSIONS.length} done, order ${order.join(' > ')}`);
  ok('all four missions run in their own order, none repeated',
    new Set(order).size === MISSIONS.length, order.join(' > '));
  ok('four completed missions start the WIZARD multiball',
    !!(g.multiball && g.multiball.wizard), `multiball=${!!g.multiball}`);

  // the other route into multiball, which does not go through a mission at all
  g._endMultiball();
  for (let i = 0; i < 3; i++) {
    for (let r = 0; r < 5; r++) { ball().flipped = true; g._rampMade(ball()); }
    g.bankLit = false;                       // so the scoop takes the LOCK, not a mission
    hitSwitch('scoop');
  }
  ok('ramps light the lock, and three locks start a multiball', !!g.multiball,
    `locks ${g.locks}, lockLit ${g.lockLit}`);
  g.takeEvents();
  ball().flipped = true;
  g._rampMade(ball());
  const paid = g.takeEvents().filter((e) => e.type === 'jackpot');
  ok('a ramp during multiball pays the JACKPOT', paid.length === 1 && paid[0].value > 0,
    `${paid.length} jackpots, value ${paid[0] && paid[0].value}`);
}

// --- 4b. the whole ball chain, deterministically ----------------------------------------------------
// The soak cannot promise a game ends, so this does: drain every ball on purpose and walk the
// drain -> bonus count-up -> next ball -> game over chain to its end.

{
  const g = new Pinball({ difficulty: 'hard', rand: mulberry32(11) });
  g.start();
  const seen = [];
  let sawGameOver = false;
  for (let ballN = 0; ballN < 3 && g.phase !== 'over'; ballN++) {
    seen.push(g.ball);
    const was = g.ball;
    g.saveTimer = 0;
    for (const b of g.balls) { b.held = false; b.onPlunger = false; b.y = DRAIN_Y + 20; }
    for (let i = 0; i < 400; i++) {
      g.update(1 / 60);
      for (const ev of g.takeEvents()) if (ev.type === 'gameover') sawGameOver = true;
      if (g.ball !== was || g.phase === 'over') break;
    }
  }
  ok('every ball is played in order', seen.join(',') === '1,2,3', seen.join(','));
  ok('the third drain ends the game', g.phase === 'over', g.phase);
  ok('game over is announced to the UI', sawGameOver);
  ok('a finished game reports a result payload', typeof g.result().score === 'number');
}

// --- 5. the recorder payload -----------------------------------------------------------------------

{
  const g = launched(fresh('hard'));
  g.score = 123456;
  g.stats.jackpots = 3; g.stats.multiballs = 1; g.stats.missions = 2;
  const r = g.result();
  ok('result() reports the difficulty key the stats layer expects', r.difficulty === 'hard');
  ok('result() carries the counters the stats screen renders',
    r.score === 123456 && r.jackpots === 3 && r.multiballs === 1 && r.missions === 2);
  ok('result() has no negative counters', Object.values(r).every((v) => typeof v !== 'number' || v >= 0));
}

// --- 6. the 2026-08-20 playtest ------------------------------------------------------------------
//
// Five defects found by watching a 35 s screen recording of one real ball, each confirmed against
// the engine before anything was changed. Every probe below was born RED against the build that
// shipped that day; they are here so none of them can come back quietly.

{
  // (a) THE PADDLE WAS THE DEADEST SURFACE ON THE TABLE. flipper() defaulted to e = 0.3, against
  // 0.42 for a wall, 0.40 for the arch and 0.50 for a post - the ball lost more energy hitting the
  // flipper than the woodwork. On a real inlane feed it arrived at 668 and was down to 80 within
  // two touches: 12% of peak. A real flipper rubber returns 0.6-0.8.
  const f = flipper(100, 640, 58, 0.4, -0.4);
  const wall = seg(0, 0, 10, 0), post = circle(0, 0, 5);
  ok('[PLAYTEST 2026-08-20] the flipper is live rubber, not the deadest thing on the table',
    f.e >= 0.55 && f.e <= 0.8 && f.e > wall.e && f.e > post.e,
    `flipper e=${f.e}, wall e=${wall.e}, post e=${post.e}`);

  const { colliders, flippers } = buildTable({});
  const world = { colliders, flippers, gravity: GRAVITY, drag: 0.133, nudgeX: 0, nudgeY: 0 };
  const b = makeBall(100, 560, 30, 300);
  let peak = 0, first = null;
  for (let i = 0; i < Math.round(2.2 / PHYS_DT) && first == null; i++) {
    peak = Math.max(peak, Math.hypot(b.vx, b.vy));
    step(world, [b], (k) => { if (k === 'flipper') first = Math.hypot(b.vx, b.vy) / peak; });
    if (b.y > DRAIN_Y) break;
  }
  ok('[PLAYTEST 2026-08-20] a ball keeps most of its speed off the first paddle contact',
    first != null && first > 0.5, `kept ${((first ?? 0) * 100).toFixed(0)}% (shipped build: 31%)`);
}

{
  // (b) SLINGSHOT POINTS HAD NO COOLDOWN. _contact awarded PTS.sling unconditionally, and the
  // speed < 24 filter that debounces every other switch explicitly exempts slings - so a ball
  // rattling in the pocket scored 250 a frame. The recording banked 17,400 points that way on ONE
  // ball while the upper playfield went untouched and the mission banner never moved.
  const g = new Pinball({ difficulty: 'medium' });
  g.start(); g.phase = 'play';
  const before = g.score;
  for (let i = 0; i < 40; i++) { g.time += 0.02; g._contact('seg', 'slingL', 100, 550, 300, g.balls[0]); }
  const paid = g.score - before;
  ok('[PLAYTEST 2026-08-20] forty slingshot contacts in 0.8 s do not pay forty times',
    paid <= PTS.sling * 3, `paid ${paid} for 40 contacts (the shipped build would pay ${PTS.sling * 40})`);

  const s2 = g.score;
  g.time += 5;
  g._contact('seg', 'slingL', 100, 550, 300, g.balls[0]);
  ok('[PLAYTEST 2026-08-20] ...but a genuine slingshot hit later still scores',
    g.score - s2 === PTS.sling, `${g.score - s2}`);
}

{
  // (c) NOTHING COULD SEE A BALL LOOPING. The stuck watchdog measures DISPLACEMENT from an anchor,
  // so it only ever catches a ball that is wedged and still; a ball ping-ponging between the two
  // slingshots travels 60+ units a cycle and resets that anchor several times a second. The
  // recording showed 26 s of exactly that, and across 708 s of simulated play the watchdog fired
  // zero times. The fix is a second watchdog measuring TIME BELOW THE SLINGSHOTS WHILE MOVING.
  const g = new Pinball({ difficulty: 'medium' });
  g.start(); g.phase = 'play';
  const b = g.balls[0];
  b.held = false; b.onPlunger = false; b.ax = null; b.ay = null; b.restTime = 0; b.loopFor = 0;
  b.x = 184; b.y = 560; b.vx = 420; b.vy = 0;
  let broke = false, worst = 0;
  const orig = g.emit.bind(g);
  g.emit = (e) => { if (e.type === 'ballsearch') broke = true; return orig(e); };
  for (let i = 0; i < 60 * 12; i++) {
    // pin the ball in the pocket the way the two slingshots do, and never flip
    if (b.live && b.y > 470) { b.y = Math.max(b.y, 520); if (Math.abs(b.vx) < 200) b.vx = b.vx < 0 ? -420 : 420; }
    g.update(1 / 60);
    if (!g.balls[0] || g.balls[0] !== b || b.held) break;
    worst = Math.max(worst, b.loopFor || 0);
    if (broke) break;
  }
  ok('[PLAYTEST 2026-08-20] a ball looping in the slingshot pocket is shoved out, not left there',
    broke, `loopFor peaked at ${worst.toFixed(1)}s, shoved=${broke}`);
  // `worst > 0.5` is not decoration: without it this passes vacuously on a build that has no
  // loopFor at all, which is exactly the build it is supposed to fail against.
  ok('[PLAYTEST 2026-08-20] the loop watchdog is a hard time bound, not a tuning knob',
    worst > 0.5 && worst <= 6.5, `${worst.toFixed(1)}s`);
}

{
  // (d) THE FLIPPER WENT WHITE THE MOMENT YOU PRESSED IT. RETIRED 2026-09-07, and the reason is
  // that the thing it tested no longer exists: the paddle gradient it probed belonged to the flat
  // 2D renderer, and STARHUB renders in three.js now (render3d.js), where the paddle is a real
  // solid lit from a real light and there is no gradient to anchor anywhere.
  //
  // It is recorded rather than deleted because the DEFECT it caught is still worth knowing: a
  // shading trick keyed to screen axes rather than to the part itself will look right at rest and
  // wrong the moment the part moves, and both flips visible in that playtest recording were misses
  // because the swept paddle clamped to the same white as the rails beside it. Nothing in a 3D
  // scene can reproduce it, which is the honest reason there is no replacement assertion here.
}
{
  // (e) THE TABLE PLAYED LIKE A WALL, TWICE. GRAVITY was 1150 (an effective 9.5 deg), then 790.
  //
  // THIS TEST WAS PART OF WHY THE SECOND ATTEMPT DID NOT WORK. It read the incline back with
  // asin(a/g) - the SLIDING formula - so it signed off on 790 at "6.5 degrees" and would sign off
  // on any sliding-ball number. A pinball ROLLS: the rolling constraint spends two sevenths of
  // gravity spinning the ball, so only a = (5/7) g sin(theta) reaches the ball's forward motion.
  // Against that, 790 was really a 9.1-degree table - Matt on the 790 build: "You tried, but it
  // didn't make the game better."
  //
  // Read back with the ROLLING formula now, so this can never again certify a number that only
  // looks right for a ball that slides. Real machines run 6-7 degrees; Visual Pinball's own
  // default is 6.0 (DefaultTableMinSlope). 564 units/s^2 reads as 6.5.
  const unit = 1.067 / H;                     // metres per table unit, from the long dimension
  const ROLL = 5 / 7;                         // rolling-inertia factor for a solid sphere
  const deg = Math.asin(GRAVITY * unit / (ROLL * 9.81)) * 180 / Math.PI;
  ok('[PLAYTEST 2026-08-20] the playfield is a real pinball incline, not a vertical wall',
    deg >= 5.5 && deg <= 7.2, `${deg.toFixed(1)} degrees rolling (1150 build: 13.4, 790 build: 9.1)`);
  ok('[PLAYTEST 2026-08-20] the ball is still a real pinball at that scale',
    Math.abs(18 * unit * 1000 - 27) < 4, `${(18 * unit * 1000).toFixed(1)} mm`);

  // The plunger skill curve has to survive the rescale: a stab still dribbles back down the lane, a
  // full pull still makes the orbit. That relationship IS the plunger, and it is easy to lose here.
  const reach = (v) => {
    const { colliders, flippers } = buildTable({});
    const world = { colliders, flippers, gravity: GRAVITY, drag: 0.133, nudgeX: 0, nudgeY: 0 };
    const b = makeBall(PLUNGER.x, PLUNGER.y, 0, -v);
    let minY = 9e9;
    for (let i = 0; i < Math.round(6 / PHYS_DT); i++) {
      step(world, [b], null); minY = Math.min(minY, b.y); if (b.y > DRAIN_Y) break;
    }
    return minY;
  };
  ok('[PLAYTEST 2026-08-20] a soft plunge still fails to make the orbit',
    reach(PLUNGER.minV) > 150, `y=${reach(PLUNGER.minV).toFixed(0)}`);
  ok('[PLAYTEST 2026-08-20] a full plunge still makes it',
    reach(PLUNGER.maxV) < 120, `y=${reach(PLUNGER.maxV).toFixed(0)}`);
}

// --- 8. the ball must not STICK to anything it rides -----------------------------------------
// Matt, 2026-08-22, playing the build above: "you have to make the walls frictionless. the ball
// gets stuck on them. same with the paddles."
//
// Cause: resolve()'s tangential friction is charged once per CONTACT RESOLUTION, not once per
// impact. A ball that bounces pays it once. A ball that RIDES a surface is in contact on all 480
// physics steps of a second and pays it 480 times, which gravity can only balance at a terminal
// creep of g*dt/mu. The orbit - the shot the right flipper exists to make - is one long sustained
// contact with archIn, so the table's headline shot was also the one that reliably killed the ball.
{
  // 2026-09-06: THE ASSERTION MOVED FROM THE CONSTRUCTORS TO THE TABLE, and that is not a
  // weakening. physics.js's constructors serve two boards now - the imported ROYAL FLUSH layout is
  // designed against Box2D and is measurably worse with no friction at all (parked episodes 24 ->
  // 96 when it was removed) - so a blanket 'every default is 0' can no longer be true. What the
  // incident was actually about is narrower: a surface the ball RIDES must not brake it. So every
  // ride surface on THIS table is asserted frictionless BY NAME, and the shared defaults are
  // asserted merely BOUNDED, so a collider added without thinking can never be flypaper.
  const RIDE = ['archIn', 'archOut', 'wallL', 'wallR', 'wallPF', 'funnelL', 'funnelR', 'orbitWall',
    'orbitDeflect', 'divL', 'divR'];
  const rideBuilt = buildTable({});
  const gritty = RIDE.filter((id) => {
    const c = rideBuilt.colliders.find((x) => x.id === id);
    return !c || c.mu !== 0;
  });
  ok('[KNOWN-BUG PROBE] every surface the ball RIDES is frictionless', gritty.length === 0,
    gritty.length ? `gritty: ${gritty.join(', ')}` : '');
  ok('[KNOWN-BUG PROBE] no shared collider default can be flypaper',
    seg(0, 0, 1, 1).mu < 0.2 && circle(0, 0, 1).mu < 0.2 && flipper(0, 0, 10, 0, 1).mu < 0.2,
    `seg ${seg(0, 0, 1, 1).mu}, circle ${circle(0, 0, 1).mu}, flipper ${flipper(0, 0, 10, 0, 1).mu}`);

  // Ride the arch on a full plunge and watch the speed. Born red: at the old mu of 0.02 the ball
  // bled down to ~335 u/s going round, against ~851 now.
  // mu === null means "leave the shipped defaults alone", which is the whole point: a probe that
  // sets mu itself measures the solver, not the table, and would pass against any defaults at all.
  const ride = (mu) => {
    const { colliders, flippers } = buildTable({});
    if (mu != null) for (const c of colliders) c.mu = mu;
    const world = { colliders, flippers, gravity: GRAVITY, drag: 0.133, nudgeX: 0, nudgeY: 0 };
    const b = makeBall(PLUNGER.x, PLUNGER.y, 0, -PLUNGER.maxV);
    let slowest = 9e9, topT = -1, exitT = -1;
    for (let i = 0; i < Math.round(12 / PHYS_DT); i++) {
      const t = i * PHYS_DT;
      step(world, [b], null);
      if (Math.hypot(b.x - ARCH.cx, b.y - ARCH.cy) > ARCH.rIn - 5 && b.y < ARCH.cy) {
        slowest = Math.min(slowest, Math.hypot(b.vx, b.vy));
      }
      if (b.y < 90 && topT < 0) topT = t;
      if (topT > 0 && b.y > 300 && exitT < 0) { exitT = t; break; }
      if (b.y > DRAIN_Y) break;
    }
    return { slowest, round: exitT > 0 ? exitT - topT : 99 };
  };
  const now = ride(null);
  ok('[KNOWN-BUG PROBE] a ball riding the orbit keeps its speed',
    now.slowest > 500, `slowest in the arch ${now.slowest.toFixed(0)} u/s (at the old mu 0.02: ${ride(0.02).slowest.toFixed(0)})`);
  ok('[KNOWN-BUG PROBE] the orbit completes promptly instead of crawling round',
    now.round < 1.0, `${now.round.toFixed(2)} s top-to-exit (at the old mu 0.02: ${ride(0.02).round.toFixed(2)} s)`);

  // A resting paddle must not be flypaper either: the ball rolls pivot -> tip under gravity alone.
  // The three thresholds below were re-measured on 2026-09-06 against the new 348 x 694 playfield
  // and its adaptive solver, and they are LOOSER than the numbers the old 400 x 760 table met.
  // That is geometry, not a regression: this paddle is 63 units long against 58, its rest angle is
  // 25 degrees against 27, and gravity is 9% lower, so the same frictionless roll takes 0.50 s
  // here against 0.42 there. Each threshold sits about 1.5x its measured frictionless value, which
  // is what makes the probe still fail loudly on the failure it exists for: when a badly-scoped
  // cradle damped a resting paddle earlier the same day, this measured 99 s.
  const rollToTip = (mu) => {
    const { colliders, flippers } = buildTable({});
    if (mu != null) for (const f of flippers) f.mu = mu;
    const world = { colliders, flippers, gravity: GRAVITY, drag: 0.133, nudgeX: 0, nudgeY: 0 };
    const px = AXIS - FLIP.dx, py = FLIP.pivotY;
    const b = makeBall(px + Math.cos(FLIP.rest) * 12, py + Math.sin(FLIP.rest) * 12 - 11, 40, 20);
    for (let i = 0; i < Math.round(3 / PHYS_DT); i++) {
      step(world, [b], null);
      const along = (b.x - px) * Math.cos(FLIP.rest) + (b.y - py) * Math.sin(FLIP.rest);
      if (along > FLIP.len - 6) return i * PHYS_DT;
      if (b.y > DRAIN_Y) break;
    }
    return 99;
  };
  ok('[KNOWN-BUG PROBE] the ball rolls down a resting paddle instead of stalling on it',
    rollToTip(null) < 0.75, `${rollToTip(null).toFixed(2)} s pivot-to-tip (frictionless: ${rollToTip(0).toFixed(2)} s)`);
}

// --- 9. THE RAINBOW BOARD ------------------------------------------------------------------------
//
// A third board, a third rules class, and the same two questions the other two had to answer: is
// the GEOMETRY playable, and can the RULES actually be completed? Those are separate questions and
// this file learned the hard way that a green soak answers neither - across six driven games of
// STARHUB it reported 6 missions started and 0 finished, which could equally have meant "the rules
// are broken" or "a random driver cannot aim", with nothing able to tell them apart.
//
// So section 9b drives RAINBOW's whole chain through its REAL entry points - the rollovers, the
// drop bank, the scoop switch - and never by poking fields, so a rename in rainbow.js fails the
// test rather than silently passing.
{
  const RB = await import('./table-rainbow.js');
  const { RainbowPinball } = await import('./rainbow.js');

  // --- 9a. geometry ------------------------------------------------------------------------------
  {
    const { colliders, flippers } = RB.buildTable({});

    // THE DRAIN GAP, measured the way pinball/CLAUDE.md says it must be. It is NOT the distance
    // between the tip centres: physics.js tapers a flipper to 65% of `r` at the tip, so each tip
    // eats another 0.65*r. STARHUB shipped a 0.97-ball drain because that term was forgotten, and
    // Matt found it by playing: "It's impossible for the ball to go between the paddles."
    const tipL = RB.AXIS - RB.FLIP.dx + Math.cos(RB.FLIP.rest) * RB.FLIP.len;
    const tipR = RB.AXIS + RB.FLIP.dx - Math.cos(RB.FLIP.rest) * RB.FLIP.len;
    const gap = (tipR - tipL) - 2 * (RB.FLIP.r * 0.65);
    ok('[RAINBOW] the ball FITS between the flipper tips', gap > BALL_R * 2 + 2,
      `${gap.toFixed(1)} units = ${(gap / (BALL_R * 2)).toFixed(2)} balls`);

    // NO SWITCH BURIED IN A SOLID. A rollover the ball can never reach is a dead feature, and this
    // board's headline award needs all sixteen of them.
    let buried = null;
    for (const sw of RB.SWITCHES) {
      for (const c of colliders) {
        if (c.t !== 'circle') continue;
        if (Math.hypot(sw.x - c.x, sw.y - c.y) < c.r) { buried = `${sw.id} inside ${c.id}`; break; }
      }
      if (buried) break;
    }
    ok('[RAINBOW] no switch is buried inside a solid', !buried, buried || `${RB.SWITCHES.length} switches`);

    // EVERYTHING IS ON THE TABLE.
    const off = RB.SWITCHES.find((sw) => sw.x < 0 || sw.x > RB.W || sw.y < 0 || sw.y > RB.H);
    ok('[RAINBOW] every switch is on the table', !off, off ? `${off.id} at ${off.x},${off.y}` : 'ok');

    // THE SHOOTER LANE PASSES A BALL. ROYAL FLUSH spent two builds with a ball that could not fit
    // down its own launch lane, because the wall radius is eaten out of the channel from BOTH
    // sides and nothing was checking the CLEAR width.
    const laneW = (RB.ART.laneOut - RB.ART.laneX) - 2 * 5;
    ok('[RAINBOW] the shooter lane is wider than the ball', laneW > BALL_R * 2,
      `${laneW} clear units against a ball of ${BALL_R * 2}`);

    ok('[RAINBOW] four flippers: two main, two upper', flippers.length === 4,
      flippers.map((f) => f.id).join(','));
  }

  // --- 9b. the whole rules chain, deterministically ------------------------------------------------
  {
    const g = new RainbowPinball({ rand: mulberry32(7) });
    g.start();
    // A real launch: plungerUp refuses a plunge with no power, and a ball still ON the plunger is
    // skipped by _sensors - so without this the whole chain below silently tests nothing.
    g.plungerDown(); g.plungerPower = 1; g.plungerUp();
    const ball = () => g.balls[0];
    // Drive a switch the way the solver would: put the ball on it, run the sensor pass, take it off.
    const trip = (id) => {
      const sw = RB.SWITCHES.find((x) => x.id === id);
      const b = ball();
      const ox = b.x, oy = b.y;
      b.x = sw.x; b.y = sw.y;
      g._sensors();
      b.x = ox; b.y = oy;
      if (b._inSensor) b._inSensor.delete(id);
    };
    const runRow = (name) => {
      const pre = name === 'purple' ? 'p' : name === 'blue' ? 'b' : 'r';
      RB.ROWS[name].forEach((_, i) => trip(pre + i));
    };

    runRow('purple');
    ok('[RAINBOW] a completed row scores and clears itself', g.stats.rows === 1 && g.rowLit.purple.size === 0,
      `rows ${g.stats.rows}, purple lit ${g.rowLit.purple.size}`);

    runRow('blue');
    runRow('red');
    ok('[RAINBOW] all three rows on one ball is the headline award', g.stats.rainbows === 1,
      `rainbows ${g.stats.rainbows}, combo ${g.combo}`);
    // THE CENTRE OVAL IS PAINT. There is no scoop, no collider and no sensor in it - see
    // table-rainbow.js's SCOOP comment - so nothing here may look one up.
    ok('[RAINBOW] the centre oval carries no sensor', !RB.SWITCHES.some((s) => s.kind === 'scoop'),
      `${RB.SWITCHES.length} switches, all rollovers`);
    ok('[RAINBOW] ...and no collider either',
      !RB.buildTable({}).colliders.some((c) => /scoop/i.test(c.id || '')), 'no scoopRim');
    ok('[RAINBOW] all three rows starts the multiball', g.multiball > 0 && g.balls.length === 3,
      `multiball ${g.multiball.toFixed(0)}s, ${g.balls.length} balls`);

    // The other route: the drop bank, which is the lock now that the scoop is gone.
    const g3 = new RainbowPinball({ rand: mulberry32(5) });
    g3.start(); g3.plungerDown(); g3.plungerPower = 1; g3.plungerUp();
    const clearBank = () => {
      g3.down.clear(); g3._rebuild();
      g3._touchPrev = new Set(); g3._touch = new Set();
      for (let i = 0; i < RB.DROP_COUNT; i++) g3._contact('id', `drop${i}`, 100, 100, 400);
    };
    const multBefore = g3.mult;
    clearBank();
    ok('[RAINBOW] clearing the drop bank raises the bonus multiplier', g3.mult === multBefore + 1,
      `${multBefore}x -> ${g3.mult}x`);
    ok('[RAINBOW] ...and takes a lock', g3.locks === 1, `locks ${g3.locks}`);
    clearBank(); clearBank();
    ok('[RAINBOW] three cleared banks start a multiball', g3.multiball > 0 && g3.balls.length === 3,
      `multiball ${g3.multiball.toFixed(0)}s, ${g3.balls.length} balls`);
    ok('[RAINBOW] the multiplier caps at 5x', g3.mult <= 5, `${g3.mult}x`);

    g.takeEvents();
    trip('b0');
    const paid = g.takeEvents().filter((e) => e.type === 'jackpot');
    ok('[RAINBOW] a row rollover during multiball pays the JACKPOT',
      paid.length === 1 && paid[0].value > 0, `${paid.length} jackpots, value ${paid[0] && paid[0].value}`);

    // THE EDGE DETECTOR, which is the bug this repo has now met three times: STARHUB's scoop banked
    // 1.5 million in one shot, ROYAL FLUSH's rollover paid eighteen times while the ball was pinned
    // against a wall, and RAINBOW's first soak paid 1,777 standup awards from a ball leaning on a
    // target. A scoring part pays on the way IN, never while the ball rests on it.
    const g2 = new RainbowPinball({ rand: mulberry32(11) });
    g2.start(); g2.plungerDown(); g2.plungerPower = 1; g2.plungerUp();
    g2._touch = new Set(); g2._touchPrev = new Set();
    let paidTimes = 0;
    for (let i = 0; i < 40; i++) {
      g2._touchPrev = g2._touch;
      g2._touch = new Set();
      const before = g2.score;
      g2._contact('id', 'stand0', 40, 60, 300);
      if (g2.score > before) paidTimes++;
    }
    ok('[KNOWN-BUG PROBE] [RAINBOW] a ball LEANING on a target is paid once, not forty times',
      paidTimes === 1, `${paidTimes} awards over 40 solver ticks of unbroken contact`);
  }

  // --- 9c. a short soak, because 9a and 9b never call update() -------------------------------------
  //
  // Which is not a hypothetical gap: removing the centre scoop made an import unused, dropping it
  // took BALL_R out of _drain, and 114 assertions passed against a board that threw on its first
  // frame. Sections 9a and 9b drive the rules through their entry points and never run the game
  // loop, so nothing above this can catch a fault in update(), step(), _drain() or the search.
  {
    const g = new RainbowPinball({ rand: mulberry32(19) });
    g.start();
    let off = null, maxBalls = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 90 && !off; i++) {
      if (g.hud().onPlunger) { g.plungerDown(); g.plungerPower = 1; g.plungerUp(); }
      if ((i % 37) === 0) g.setFlipper('left', (i % 74) === 0);
      if ((i % 41) === 0) g.setFlipper('right', (i % 82) === 0);
      g.update(dt);
      maxBalls = Math.max(maxBalls, g.balls.length);
      for (const b of g.balls) {
        if (b.x < -60 || b.x > RB.W + 60 || b.y < -120 || b.y > RB.H + 120) {
          off = `ball at ${b.x.toFixed(0)},${b.y.toFixed(0)}`;
        }
      }
      if (g.phase === 'over') break;
    }
    ok('[RAINBOW] 90 s of play without throwing', true, `score ${g.score.toLocaleString()}, ball ${g.ball}`);
    ok('[RAINBOW] no ball leaves the table', !off, off || 'all inside');
    ok('[RAINBOW] the ball count never goes silly', maxBalls <= 3 && g.balls.length >= 0, `peak ${maxBalls}`);
  }
}

// ============================================================================================
// 10. FOUNDRY - the three defects Matt found by PLAYING the shipped build, none of which any
//     headless assertion could see, because all three live between the model and the engine.
//
//     "none of the paddles move" / "the ball goes up the launch chute then magically appears on
//     the other side of the wood wall" / "you added gates to block the ramps off completely".
// ============================================================================================
{
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const board = src('../design/board.js');
  const rend = src('./render-design.js');

  // [KNOWN-BUG PROBE] the paddles did not move, and the loop that moves them threw no error.
  // board.js names each flipper GROUP `<name>_pivot`; getObjectByName(f.id) matched nothing, so
  // the render loop silently did nothing on every frame for the life of the build.
  ok('[FOUNDRY] the renderer looks the paddles up by their PIVOT GROUP name',
    /getObjectByName\(f\.id \+ .\_pivot.\)/.test(rend), 'f.id + "_pivot"');
  // ...and it must ADD the swing to the group's own rest yaw, not overwrite it.
  ok('[FOUNDRY] the paddle swing is added to the mesh\'s base yaw, never assigned over it',
    /baseYaw/.test(rend) && !/m\.rotation\.y = -\(f\.angle/.test(rend), 'baseYaw - (angle - rest)');

  // [KNOWN-BUG PROBE] every paddle swung the wrong way, and it was the PHYSICS, not the render.
  // A flipper's tip has to rise toward the playfield when it is actuated; all four went down and
  // outward, away from the ball. Nothing in a shot map or a soak reads as wrong when this is
  // backwards - the driver simply plays a worse table - so it is asserted directly.
  {
    const { flippers } = DT.buildLevel(1);
    const back = flippers.filter((f) => {
      const ry = f.py + Math.sin(f.rest) * f.len, uy = f.py + Math.sin(f.up) * f.len;
      return uy >= ry;
    }).map((f) => f.id);
    ok('[FOUNDRY] every paddle tip RISES when the flipper is actuated',
      back.length === 0, back.length ? 'swings down: ' + back.join(', ') : 'all ' + flippers.length + ' rise');
  }

  // [KNOWN-BUG PROBE] AN UPPER PADDLE MUST NOT BE HOLDABLE. Both upper paddles share the lower
  // paddles' buttons, so a player cradling holds them up too - and a raised upper paddle is a bar
  // lying across the deck. Measured on a 1,312-point rest sweep of the deck: 84 balls came to rest
  // with the paddles down and 762 with them held, nearly all ON a bat, 105 of them in the V the
  // two make over the drop hole. Driven, the ball never reached the main playfield in 90 s.
  {
    const g = new DesignPinball({});
    g.start();
    g.setFlipper('left', true); g.setFlipper('right', true);
    for (let i = 0; i < 60; i++) g.update(1 / 60);   // one second, button still held
    const up = g.flippers.filter((f) => f.pressed).map((f) => f.id);
    ok('[FOUNDRY] an UPPER paddle drops on its own, however long the button is held',
      up.every((id) => /lower/.test(id)), up.length ? 'still up: ' + up.join(', ') : 'none held');
    ok('[FOUNDRY] a LOWER paddle still cradles - holding it is the player aiming',
      g.flippers.filter((f) => /lower/.test(f.id)).every((f) => f.pressed), 'both lower paddles held');
  }

  // [KNOWN-BUG PROBE] A BOTTOM PADDLE MUST BE ABLE TO SHOOT A RAMP TO THE TOP LEVEL.
  // Matt: *"test until a ball can be hit by the bottom paddle and go directly up the ramp to the
  // top level."* Level 2 had been unreachable from the flippers: two L-shaped barriers sat across
  // py 908 (a vertical ramp rail meeting a horizontal outlane wall at its corner), the outer arch
  // band's foot ended in the mouth, three steel posts stood in each lane and the lane rail ran the
  // whole way down. Every one of those was named by a contact tally of what a rising shot hits, and
  // removing them took the shot from 0% to 31% on the left paddle.
  //
  // This drives the REAL game - the ball is put on a paddle, the paddle is flipped, and it only
  // counts if a 'ramp' event fires AND the ball is genuinely on level 2 afterwards.
  {
    let made = 0, n = 0;
    for (const side of ['left', 'right']) {
      for (let t = 0.2; t <= 0.91; t += 0.1) {
        for (let d = 0; d <= 30; d += 5) {
          const g = new DesignPinball({ rand: () => 0.5 });
          g.start();
          const b = g.balls[0];
          const f = g.flippers.find((q) => q.id === `flipper_lower_${side}`);
          b.onPlunger = false; b.layer = 1;
          b.x = f.px + Math.cos(f.angle) * f.len * t;
          b.y = f.py + Math.sin(f.angle) * f.len * t - 34;
          b.vx = 0; b.vy = 250;
          g.phase = 'play';
          let flipped = false, gotRamp = false, onL2 = false;
          for (let i = 0; i < 60 * 5; i++) {
            if (!flipped && i >= d) { g.setFlipper(side, true); flipped = true; }
            if (flipped && i === d + 8) g.setFlipper(side, false);
            g.update(1 / 60);
            for (const e of g.takeEvents()) if (e.type === 'ramp') gotRamp = true;
            const q = g.balls[0];
            if (!q) break;
            if ((q.layer | 0) === 2 && gotRamp) { onL2 = true; break; }
          }
          n++; if (onL2) made++;
        }
      }
    }
    ok('[FOUNDRY] a bottom paddle can shoot a ramp to the top level',
      made >= n * 0.08, `${made} of ${n} swept shots reached level 2 (${(100 * made / n).toFixed(1)}%)`);
  }

  // [KNOWN-BUG PROBE] the front of the deck is an EDGE, not a barrier. Four walls used to make a
  // continuous lip across it with one hole, so a ball that rolled down the deck stopped on the lip
  // - 67 of them on a rest sweep. With them gone the same sweep rests ZERO.
  ok('[FOUNDRY] nothing is built across the front of the deck',
    !/wall\('ledge_/.test(board), 'no ledge walls');
  // ...and no L-shaped barrier stands across the ramp approach.
  ok('[FOUNDRY] no outlane wall lies across py 908 beside a ramp rail',
    !/wall\('outlane_top_/.test(board), 'outlane_top_left/right deleted');

  // [KNOWN-BUG PROBE] THE BALL MUST NEVER GO BACK DOWN THE SHOOTER LANE, AND MUST NEVER JUMP.
  // Matt, on 47 seconds of play that was almost entirely the ball cycling in the chute: *"the ball
  // teleports all over the place. When the ball goes down the right ramp, it teleports to the middle
  // of the board on level 2... I just hit the ball all the way back down the chute... OBVIOUSLY this
  // should be impossible."*
  //
  // Both were real and both were mine. The feed at the top of the lane was a plain GAP, so the lane
  // was a two-way corridor - STARHUB has had a one-way gate there since it was built, and this board
  // shipped without one. And a ramp set the ball's position to a point in the middle of the deck in
  // a single step, which is what a teleport is.
  //
  // This drives eight games and measures both: a crossing INTO the lane through the feed, and any
  // one-frame position jump the solver could not have produced.
  {
    let reEntered = 0, jumps = 0, biggest = 0;
    for (let g0 = 0; g0 < 4; g0++) {
      let sd = g0 * 7 + 1;
      const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
      const g = new DesignPinball({ rand: rnd });
      g.start();
      let prev = null;
      for (let i = 0; i < 60 * 60; i++) {
        if (g.hud().onPlunger) { g.plungerDown(); for (let k = 0; k < 40; k++) g.update(1 / 60); g.plungerUp(); prev = null; }
        if (rnd() < 0.09) g.setFlipper('left', true);
        if (rnd() < 0.12) g.setFlipper('left', false);
        if (rnd() < 0.09) g.setFlipper('right', true);
        if (rnd() < 0.12) g.setFlipper('right', false);
        g.update(1 / 60);
        const b = g.balls[0];
        if (!b) { prev = null; continue; }
        if (prev && prev[0] / DT.U < 960 && b.x / DT.U > 986 && b.y / DT.U < 400) reEntered++;
        if (prev && !b.onPlunger) {
          const d = Math.hypot(b.x - prev[0], b.y - prev[1]) / DT.U;
          if (d > 90) { jumps++; biggest = Math.max(biggest, d); }
        }
        prev = [b.x, b.y];
        if (g.phase === 'over') break;
      }
    }
    // A DRIVEN COUNT IS A SAMPLE, and this one passed with the gate deleted - four random games
    // simply never sent a ball at the feed. So the real probe THROWS AT IT: a ball on the deck,
    // level with the opening, driven hard at the chute. It must not get through.
    {
      let through = 0;
      for (let py = 60; py <= 290; py += 20) {
        for (const vx of [200, 500, 900]) {
          const { colliders, flippers } = DT.buildLevel(2);
          const w = { colliders, flippers, gravity: 515, drag: 0.16, nudgeX: 0, nudgeY: 0 };
          const b = makeBall(DT.px(930), DT.px(py), vx, 0);
          for (let i = 0; i < 240 * 2; i++) { step(w, [b], () => {}); if (b.x / DT.U > 990) break; }
          if (b.x / DT.U > 990) through++;
        }
      }
      ok('[FOUNDRY] a ball driven straight at the feed from the deck cannot get into the lane',
        through === 0, `${through} of 36 aimed shots got through`);
    }
    ok('[FOUNDRY] no ball ever gets back into the shooter lane through the feed',
      reEntered === 0, `${reEntered} re-entries in four driven games`);
    ok('[FOUNDRY] the ball never jumps: no one-frame move the solver could not have made',
      jumps === 0, jumps ? `${jumps} jumps, biggest ${biggest.toFixed(0)} px` : 'no jump over 90 px');
  }
  // [KNOWN-BUG PROBE] EVERY RAIL THAT RUNS INTO A PADDLE MEETS ITS SURFACE.
  //
  // Matt reported this three times over two days - *"the rails that connect to the paddles are
  // not flush with the paddles"*, then *"same bumping problem"* about the upper pair, then *"the
  // paddles STILL are not flush with the rails connected to them."* Twice it was fixed by moving
  // the rail end to the flipper PIVOT, and twice that was the wrong point: a ball is carried
  // BESIDE a guide rail, so its centre tracks the rail axis plus both radii, and the paddle's
  // 12 mm pivot cap puts its surface a full 18 px further out than a 4.7 mm rail does. The ball
  // ran into the side of the cap.
  //
  // This checks the geometry rather than the symptom, because the symptom needs a rolling ball
  // and this needs none: for every wall ending near a flipper, the perpendicular distance from
  // the pivot to the rail's BALL-SIDE FACE must equal the cap radius. That is what flush means.
  {
    const off = [];
    for (const lv of [1, 2]) {
      const L = DT.buildLevel(lv);
      for (const f of L.flippers) {
        const fr = f.r, pv = [f.px, f.py];
        for (const c of L.colliders) {
          if (c.t !== 'seg' || /flipper|apron|sling/.test(c.id || '')) continue;
          for (const e of [[c.ax, c.ay], [c.bx, c.by]]) {
            if (Math.hypot(e[0] - pv[0], e[1] - pv[1]) > fr * 2) continue;
            // THE INVARIANT IS A BAND, NOT ZERO, AND BOTH EDGES OF IT ARE MEASURED.
            //
            // How far the pivot cap stands proud of the guide face is the one number that sets
            // both halves of this. Too proud and the cap juts into the lane and the ball runs
            // into the side of it - the shipped board was 18 px proud and threw the ball back a
            // mean of 15.9 px. Dead flush and the ball GRAZES the paddle instead of meeting it,
            // and fed rolls reaching the paddle fell to 43.6% with the rest going down the
            // middle. Swept at 1,152 fed rolls a setting, 9 px is the knee: mean throw-back
            // 4.3 px, 81.3% delivery. The band below is that knee with room either side.
            //
            // Measured off the rail's OWN axis, because the rail and the paddle are not
            // parallel - the upper pair meet at 14 degrees - so a distance taken along the
            // PADDLE's normal is only the same number where they happen to line up, and that
            // is what let the upper pair ship 5 px out while the test read green.
            const vx = c.bx - c.ax, vy = c.by - c.ay, vl = Math.hypot(vx, vy) || 1;
            const d = Math.abs((pv[0] - c.ax) * (vy / vl) - (pv[1] - c.ay) * (vx / vl));
            const proud = (fr - c.r - d) / DT.px(1);
            if (proud < 6 || proud > 12) off.push(`${f.id} stands ${proud.toFixed(1)} px proud of ${c.id}, outside 6..12`);
          }
        }
      }
    }
    ok('[FOUNDRY] every rail that runs into a paddle hands the ball on without a step',
      off.length === 0, off.length ? off.join('; ') : 'every paddle sits 6 to 12 px proud of its guide');
  }
  // [KNOWN-BUG PROBE] COMING DOWN A RAMP, THE BALL IS NEVER DRAWN UNDER THE RAMP.
  //
  // Matt reported this three times - *"the ball went through the ramp and disappeared"*, *"then
  // popped back into existence"*, *"It still disappears when going down the ramp"* - and two
  // fixes missed it because they watched the wrong frames. The first brightened the ball under
  // the deck, which is not where it went. The second gave a level-1 ball in a lane the lane's
  // own height, which is right and still could not reach this: a ball stepping off the deck is
  // part-way through a SCRIPTED FALL, and a falling ball is skipped by that rule and is still on
  // layer 2 - so every probe that filtered on layer 1 measured a clean descent and reported zero.
  //
  // Measured on the build that shipped: 90 px under the surface at x 90, py 642 - nearly two ball
  // widths - for 1,542 of 14,354 frames, with 167 one-frame jumps in drawn height of up to 93 px.
  // This walks balls off the deck across both lanes and watches the DRAWN height against the lane
  // under it the whole way down, fall frames included.
  {
    const LIFT_PX = 95, BALL = 51;      // px(95) is the gap between the decks; a ball is 51 px
    let worst = 0, at = 0, jump = 0, hidden = 0;
    for (const x of [60, 100, 140, 180, 820, 860, 900]) {
      for (const vx of [-60, 0, 60]) for (const vy of [20, 120]) {
        const g = new DesignPinball({ rand: () => 0.5 });
        g.start();
        const b = g.balls[0];
        b.onPlunger = false; b.held = false; b.layer = 2; b.lift = 1;
        b.x = DT.px(x); b.y = DT.px(560); b.vx = vx; b.vy = vy;
        let prev = null;
        for (let i = 0; i < 120 * 5; i++) {
          g.update(1 / 120);
          const q = g.balls[0]; if (!q || q.onPlunger) break;
          const surf = DT.rampLift(q.x, q.y);
          if (surf === null) { prev = null; continue; }
          const drawn = (q.lift || 0) * LIFT_PX;
          const sink = surf * LIFT_PX - drawn;
          if (sink > worst) { worst = sink; at = Math.round(q.y / DT.px(1)); }
          if (sink > BALL) hidden++;
          if (prev !== null) jump = Math.max(jump, Math.abs(drawn - prev));
          prev = drawn;
        }
      }
    }
    const clean = worst < 12 && jump < 12;
    ok('[FOUNDRY] a ball coming down a ramp is never drawn under it', clean,
      clean ? 'never sinks into the lane, and no jump in drawn height'
        : worst.toFixed(0) + ' px under the surface at py ' + at + ', ' + hidden
          + ' frames out of sight, worst one-frame jump ' + jump.toFixed(0) + ' px');
  }
  // [KNOWN-BUG PROBE] THE RAMPS CAN BE SHOT, AND NOTHING ENDS UP BEHIND THE ARCH.
  //
  // Two defects that turned out to be one driven game apart. Matt: *"the ball is not permitted to
  // get onto level 2. it goes up the ramp and acts like it hit a wall, then comes back down."*
  // The `_ramp` latch, which stops a ball rattling on a mouth being counted as forty ramps,
  // cleared only once the ball was 300 px BELOW the mouth - py 1233 - and the speed-boost pad
  // sits at py 1059, above that line. So a ball that came down a lane was kicked straight back up
  // while still latched and met the one-way top cap as a wall. Measured: the latch was on for 47%
  // of all frames, and 44 of 44 arrivals at a mouth moving up were turned away by it.
  //
  // Fixing that made the SECOND one reachable for the first time. A ball stepping off the deck at
  // x 145 was handed to level 1 sitting 36 px inside the lane's inner rail - a level-2 ball cannot
  // see a level-1 rail - and the solver ejected it 69 px in one frame, over the top cap and into
  // the dead space behind the arch: *"it should not be able to go behind that large semi-circle
  // thing."* 604 frames of it on the left, 71 on the right, and none of it was reachable while the
  // ramps did not work, which is why every earlier probe of that space read zero.
  {
    let climbs = 0, behind = 0, frames = 0;
    for (let gi = 0; gi < 8; gi++) {
      let sd = 77 + gi * 7919;
      const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const g = new DesignPinball({ rand: rnd });
      g.start();
      const climbing = new Map();
      for (let i = 0; i < 120 * 240 && g.phase !== 'over'; i++) {
        g.setFlipper('left', rnd() < 0.03);
        g.setFlipper('right', rnd() < 0.03);
        if (g.balls.some((q) => q.onPlunger) && !g.plungerHeld) { g.plungerDown(); g.plungerPower = 0.35 + rnd() * 0.65; g.plungerUp(); }
        g.update(1 / 120); frames++;
        for (const b of g.balls) {
          if (b._climbR && !climbing.get(b)) climbs++;
          climbing.set(b, !!b._climbR);
          if (b.onPlunger || (b.layer | 0) !== 1) continue;
          const bx = b.x / DT.px(1), by = b.y / DT.px(1);
          // outboard of the arch, either side, above where its legs end
          if (by < 575 && (bx < 128 || bx > 858)) behind++;
        }
      }
    }
    ok('[FOUNDRY] the ramps can actually be shot', climbs >= 8,
      climbs + ' ramp climbs in 8 driven games (the latched build managed 1)');
    ok('[FOUNDRY] no ball ever gets behind the arch on level 1', behind === 0,
      behind === 0 ? 'never outboard of the arch' : behind + ' frames of ' + frames + ' outboard of the arch');
  }
  // ...and the gate that makes the first of those true is a ONE-WAY, not a wall: a plain wall there
  // would trap the launch in its own lane.
  {
    const gate = DT.buildLevel(2).colliders.find((c) => c.id === 'chute_gate');
    ok('[FOUNDRY] the shooter lane feed is a one-way gate',
      !!gate && !!gate.oneWay && gate.oneWay[0] > 0,
      gate ? 'oneWay ' + JSON.stringify(gate.oneWay) : 'chute_gate MISSING');
  }
  // ...and a ramp is a CLIMB the ball is walked up, never a destination it is moved to.
  ok('[FOUNDRY] a ramp carries the ball up its own centre line, it does not place it',
    /_rampRide/.test(src('./design.js')) && !/r\.to\.x/.test(src('./design.js')), 'RAMPS carry `top`, and _rampRide walks the ball to it');

  // [KNOWN-BUG PROBE] the launch teleported the ball 140 px sideways through a solid wall.
  ok('[FOUNDRY] nothing moves the ball across the board wall at the top of the chute',
    !/LAUNCH_TO/.test(src('./design.js')), 'no LAUNCH_TO destination');
  ok('[FOUNDRY] the chute has a real way out: a feed guide and a gap in the right wall on L2',
    /chute_feed/.test(board) && /wall_right_upper/.test(board), 'chute_feed + wall_right_upper');

  // [KNOWN-BUG PROBE] a wall stood across each ramp entrance, so neither ramp could be shot.
  ok('[FOUNDRY] there is no wall across either ramp mouth',
    !/wall\(.ramp_mouth_/.test(board), 'ramp_mouth_left/right deleted');
}

console.log(`\n${count - fail}/${count} passed`);
if (fail) { console.log(`${fail} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
