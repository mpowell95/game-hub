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

import { step, makeBall, seg, circle, flipper, PHYS_DT, MAX_SPEED, BALL_R, ROLL_A } from './physics.js';
import {
  W, H, DRAIN_Y, buildTable, SWITCHES, RAMP_PATH, flipperGap, FLIP, AXIS, MM_PER_UNIT,
} from './table.js';
import { Pinball, mulberry32, rampPoint, MISSIONS, PTS, gravityForPitch, DIFFS } from './game.js';

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
  const world = { colliders: [], flippers: [], gravity: 1000, roll: 0 };
  const b = makeBall(0, 0);
  for (let i = 0; i < 480; i++) step(world, [b], null);
  // AIR_K alone costs a few per cent over a second; ROLL_A is switched off so this measures gravity.
  ok('gravity: one second of unresisted fall reaches ~1000 u/s', near(b.vy, 1000, 40), `vy=${b.vy.toFixed(1)}`);
}

// --- 1a. the table is a PLAYFIELD, not a wall -----------------------------------------------------
//
// Matt, on the shipped build (2026-08-14): "the ball falls as if the machine is a vertical wall.
// Real pinball is much flatter than 90 degrees vertical." A real cabinet is pitched 6.5 degrees and
// the ball rolls, so its downhill acceleration is (5/7) g sin(6.5) = 0.79 m/s^2. These assertions
// pin the conversion in BOTH directions - the maths, and what it means on the table - so nobody can
// "tune the feel" back into a free fall without the number saying so.

{
  const g65 = gravityForPitch(6.5);
  const mps2 = g65 * MM_PER_UNIT / 1000;
  ok('a 6.5 degree playfield accelerates the ball at 0.79 m/s^2', near(mps2, 0.793, 0.02),
    `${mps2.toFixed(3)} m/s^2`);
  ok('...which is a twelfth of a free fall, not most of one', mps2 < 9.81 / 10, `${(9.81 / mps2).toFixed(1)}x weaker`);
  ok('every difficulty is a real operator pitch (6 to 7 degrees)',
    Object.values(DIFFS).every((d) => d.pitch >= 6 && d.pitch <= 7),
    Object.values(DIFFS).map((d) => d.pitch).join(', '));
  // A drained ball rolls the length of a real playfield in about 1.5 - 1.8 s. Anything much under
  // that is the old "vertical wall" feel coming back.
  const world = { colliders: [], flippers: [], gravity: g65 };
  const b = makeBall(200, 40, 0, 0);
  let t = 0;
  while (b.y < FLIP.pivotY && t < 10) { step(world, [b], null); t += PHYS_DT; }
  ok('a ball takes ~1.5 s to roll from the top of the playfield to the flippers', t > 1.2 && t < 2.2,
    `${t.toFixed(2)} s`);
}

// --- 1b. [KNOWN-BUG PROBE] rolling along a surface must not BRAKE the ball -----------------------
//
// Matt, same report: "When the ball is rolling on the bottom level, it drastically slows down when
// it hits the paddle. It's confusing and not good."
//
// It was not the paddle. `resolve()` used to remove a fixed FRACTION of the tangential speed on
// every resolved contact - and a resting contact is re-resolved on every physics step, 480 times a
// second. At mu = 0.05 that is a 42 ms time constant: a ball rolling along ANY surface in the table
// lost 92% of its speed in a fifth of a second, and the flipper is simply where a rolling ball
// spends longest. Friction is Coulomb now (bounded by the normal impulse), so a resting ball barely
// feels it and the honest per-second loss comes from ROLL_A instead.
//
// Verified RED against the old resolver: 400 -> 33 u/s over the same 0.2 s.

{
  const { flippers } = buildTable({});
  const f = flippers[0];
  const world = { colliders: [], flippers: [f], gravity: gravityForPitch(6.5) };
  const a = f.angle;
  // Sit the ball on the bat's upper face, 20 units out from the pivot, rolling toward the tip.
  const b = makeBall(
    f.px + Math.cos(a) * 20 - Math.sin(a) * (BALL_R + 6),
    f.py + Math.sin(a) * 20 + Math.cos(a) * (BALL_R + 6),
    Math.cos(a) * 400, Math.sin(a) * 400,
  );
  const v0 = Math.hypot(b.vx, b.vy);
  for (let i = 0; i < 96; i++) step(world, [b], null);      // 0.2 s on the paddle
  const v1 = Math.hypot(b.vx, b.vy);
  ok('[KNOWN-BUG PROBE] a ball rolling on a resting flipper is not braked by it', v1 > v0 * 0.85,
    `${v0.toFixed(0)} -> ${v1.toFixed(0)} u/s in 0.2 s`);

  // ...and rolling resistance still exists, or the ball would never settle anywhere.
  const flat = { colliders: [], flippers: [], gravity: 0 };
  const c = makeBall(0, 0, 600, 0);
  for (let i = 0; i < 480; i++) step(flat, [c], null);
  const lost = 600 - c.vx;
  ok('rolling resistance is real but small (a coasting ball loses ~10% a second)',
    lost > ROLL_A * 0.6 && lost < 600 * 0.25, `lost ${lost.toFixed(0)} u/s in 1 s`);
}

// --- 1c. the flipper gap, to the WPC spec ---------------------------------------------------------
//
// "The paddles are too close together. The space between them barely fits the ball... Look online
// for a real answer for this spacing." The real answer: WPC drills the flipper holes 6 13/16 to 7 in
// apart and the bat is 2.8 to 3 in, which leaves about a ball and a half between the tips at rest
// and a shade over one ball with both flippers held up. The old table measured 1.24 balls at rest -
// tighter than any real machine. Asserted in ball diameters so it cannot drift with the scale.

{
  const inches = (u) => u * MM_PER_UNIT / 25.4;
  ok('the ball is a real pinball (1 1/16 in)', near(inches(BALL_R * 2), 1.0625, 0.02),
    `${inches(BALL_R * 2).toFixed(3)} in`);
  ok('the flipper pivots are 6 13/16 - 7 in apart, as WPC drills them',
    inches(FLIP.dx * 2) >= 6.75 && inches(FLIP.dx * 2) <= 7.05, `${inches(FLIP.dx * 2).toFixed(2)} in`);
  ok('the bat is a real 2.8 - 3 in flipper', inches(FLIP.len) >= 2.7 && inches(FLIP.len) <= 3.05,
    `${inches(FLIP.len).toFixed(2)} in`);
  ok('the gap between the tips AT REST is about a ball and a half',
    flipperGap(false) >= 1.45 && flipperGap(false) <= 1.75, `${flipperGap(false).toFixed(2)} balls`);
  ok('...and a shade over one ball with both flippers HELD UP',
    flipperGap(true) >= 1.05 && flipperGap(true) <= 1.35, `${flipperGap(true).toFixed(2)} balls`);
  ok('the drain gap is measurably wider than the old table (1.24 balls)', flipperGap(false) > 1.35);
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
  for (let i = 0; i < 480; i++) step(world, [b], null);
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
  ok('the table builds a full collider set', colliders.length > 25 && flippers.length === 4,
    `${colliders.length} colliders, ${flippers.length} flippers`);
  ok('there is an upper flipper on each side', flippers.some((f) => f.id === 'flipUL') && flippers.some((f) => f.id === 'flipUR'));
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
  ok('the ramp ends at the right inlane', end.x > 280 && end.y > 480, `${end.x},${end.y}`);
}

// --- 2b. EVERY SHOT MUST BE REACHABLE FROM A FLIPPER ----------------------------------------------
//
// The block that would have saved a whole afternoon. A pinball table is not a picture: a shot that
// no flipper can reach is not a hard shot, it is a dead one, and nothing else in this file notices.
// Rebuilding the playfield in one go produced, at various points, a scoop reachable in 2% of timed
// shots, a left orbit reachable in NONE, a post arc across the middle that was a wall with holes in
// it, and an inlane that delivered the ball past the flipper into the drain (the lower centre of a
// soak heat map was completely blank). All four passed every other assertion here.
//
// So: drop a ball onto each bat at a fan of contact points, flip at a fan of moments, and require
// that the shots the table's own header promises actually land. The thresholds are deliberately
// loose - this is a "the shot exists" probe, not a difficulty tuner.

function reachFrom(side, budgetFrames = 260) {
  const px = AXIS + (side === 'left' ? -FLIP.dx : FLIP.dx);
  const hits = {};
  let trials = 0;
  for (let off = 8; off <= 58; off += 2) {
    for (let delay = 0; delay <= 26; delay += 1) {
      trials++;
      const g = new Pinball({ difficulty: 'medium', rand: mulberry32(3) });
      g.start();
      g.plungerUp();
      const b = g.balls[0];
      b.held = false; b.onPlunger = false; b.sw = {};
      const a = side === 'left' ? FLIP.rest : Math.PI - FLIP.rest;
      b.x = px + Math.cos(a) * off;
      b.y = FLIP.pivotY + Math.sin(a) * off - 26;
      b.vx = 0; b.vy = 260;
      const seen = new Set();
      for (let i = 0; i < budgetFrames && b.live; i++) {
        if (i === delay) g.setFlipper(side, true);
        if (i === delay + 12) g.setFlipper(side, false);
        g.update(1 / 120);
        for (const s of SWITCHES) if (b.sw && b.sw[s.id]) seen.add(s.id);
      }
      for (const k of seen) hits[k] = (hits[k] || 0) + 1;
    }
  }
  const pct = {};
  for (const k of Object.keys(hits)) pct[k] = hits[k] / trials;
  return pct;
}

{
  const L = reachFrom('left'), R = reachFrom('right');
  const show = (p, k) => `${(100 * (p[k] || 0)).toFixed(0)}%`;
  ok('REACH: the left flipper can shoot the RAMP', (L.rampIn || 0) > 0.08, show(L, 'rampIn'));
  ok('REACH: the left flipper can shoot the SCOOP', (L.scoop || 0) > 0.05, show(L, 'scoop'));
  ok('REACH: the right flipper can shoot the RAMP', (R.rampIn || 0) > 0.08, show(R, 'rampIn'));
  ok('REACH: the right flipper can shoot the LEFT ORBIT past the spinner', (R.spinner || 0) > 0.02,
    show(R, 'spinner'));
  ok('REACH: an orbit shot carries the whole way round the arch', (R.orbitTop || 0) > 0.005,
    show(R, 'orbitTop'));
  ok('REACH: both flippers feed the inlanes (the ball comes BACK to a flipper)',
    (L.inlaneL || 0) + (L.inlaneR || 0) > 0.03 && (R.inlaneL || 0) + (R.inlaneR || 0) > 0.03,
    `L ${show(L, 'inlaneL')}/${show(L, 'inlaneR')}  R ${show(R, 'inlaneL')}/${show(R, 'inlaneR')}`);
}

{
  // ...and the UPPER pair, which is the only thing that reaches the top of the table: the teardrop
  // ramp stands between the main flippers and the drop bank on purpose. If this ever reads 0 the
  // upper flippers are decoration and the drop bank (and therefore every mission) is unreachable.
  let bankHits = 0, laneHits = 0, trials = 0;
  for (let off = 6; off <= 36; off += 2) {
    for (let delay = 0; delay <= 24; delay += 2) {
      trials++;
      const g = new Pinball({ difficulty: 'medium', rand: mulberry32(5) });
      g.start();
      g.plungerUp();
      const up = g.flippers.find((f) => f.id === 'flipUR');
      const b = g.balls[0];
      b.held = false; b.onPlunger = false; b.sw = {};
      const a = up.angle;
      b.x = up.px + Math.cos(a) * off;
      b.y = up.py + Math.sin(a) * off - 24;
      b.vx = 0; b.vy = 240;
      let bank = false, lane = false;
      for (let i = 0; i < 180 && b.live; i++) {
        if (i === delay) g.setFlipper('right', true);
        if (i === delay + 12) g.setFlipper('right', false);
        g.update(1 / 120);
        for (const ev of g.takeEvents()) if (ev.type === 'drop') bank = true;
        for (const k of ['laneH', 'laneU', 'laneB']) if (b.sw && b.sw[k]) lane = true;
      }
      if (bank) bankHits++;
      if (lane) laneHits++;
    }
  }
  ok('REACH: an UPPER flipper can shoot the drop bank across the top', bankHits / trials > 0.05,
    `${(100 * bankHits / trials).toFixed(0)}% of ${trials} timed shots`);
  ok('REACH: ...and the H-U-B lanes above it', laneHits > 0, `${laneHits}/${trials}`);
}

// --- 2c. [KNOWN-BUG PROBE] a solenoid cannot machine-gun ------------------------------------------
//
// A slingshot facing a wall a ball and a half away is a perfect resonator: full-power kick, bounce,
// full-power kick, 30 ms apart, forever. Six soak games produced 15,633 slingshot hits and a mean
// score inflated by an order of magnitude. Real coils have a pulse and a re-arm; physics.js has
// COIL_REARM, and game.js refuses to SCORE a contact whose coil did not actually fire (fixing it in
// the physics but not the score would leave the half a player can see).

{
  const sling = seg(-60, 0, 60, 0, { kick: 900, e: 0.4, r: 6 });
  const roof = seg(-60, -40, 60, -40, { e: 0.9, r: 6 });
  const world = { colliders: [sling, roof], flippers: [], gravity: 0 };
  const b = makeBall(0, -20, 0, 300);
  let fires = 0, contacts = 0;
  for (let i = 0; i < 480; i++) {                            // one second
    step(world, [b], (kind, id, x, y, sp, ball, fired) => { if (id === '' || kind === 'id') { contacts++; if (fired) fires++; } });
  }
  ok('[KNOWN-BUG PROBE] a trapped ball cannot machine-gun a slingshot', fires <= 12,
    `${fires} coil fires in 1 s (${contacts} contacts)`);
  ok('[KNOWN-BUG PROBE] ...but the coil does still fire', fires >= 1, `${fires} fires`);

  const g = launchedLater();
  const before = g.score;
  for (let i = 0; i < 40; i++) g._contact('id', 'slingL', 100, 520, 900, g.balls[0], false);
  ok('[KNOWN-BUG PROBE] a slingshot that did not fire does not score', g.score === before,
    `+${g.score - before}`);
  g._contact('id', 'slingL', 100, 520, 900, g.balls[0], true);
  ok('[KNOWN-BUG PROBE] ...and one that did, does', g.score > before);
}

// --- 3. the rules ----------------------------------------------------------------------------------

function fresh(diff = 'medium') { return new Pinball({ difficulty: diff, rand: mulberry32(7) }); }
function launchedLater() { return launched(fresh()); }

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
  for (let i = 0; i < 4; i++) g._contact('id', `drop${i}`, 100, 350, 400, g.balls[0]);
  ok('four drop targets complete the bank', g.bankLit === true);
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
  for (let i = 0; i < 4; i++) g._contact('id', `drop${i}`, 100, 350, 400, g.balls[0]);
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
  for (let i = 0; i < 200; i++) g.update(1 / 60);
  ok('multiball feeds extra balls onto the table', g.balls.length >= 2, `${g.balls.length} balls`);
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
  // One button per side drives the main flipper AND the upper one, the way a real cabinet is wired.
  const g = launched(fresh());
  const byId = Object.fromEntries(g.flippers.map((f) => [f.id, f]));
  g.setFlipper('left', true);
  ok('a button presses both flippers on its side', byId.flipL.pressed && byId.flipUL.pressed);
  ok('...and neither on the other side', !byId.flipR.pressed && !byId.flipUR.pressed);
  g.setFlipper('left', false);
  ok('releasing lets both go', !byId.flipL.pressed && !byId.flipUL.pressed);
}

{
  // The skill shot: the star rollover is only worth the big award as the FIRST thing a ball does.
  const g = launched(fresh());
  const star = SWITCHES.find((s) => s.id === 'star');
  const s0 = g.score;
  g._switchHit(star, g.balls[0]);
  ok('the star rollover collects the skill shot on the first shot of a ball', g.score - s0 >= PTS.skill);
  const s1 = g.score;
  g._switchHit(star, g.balls[0]);
  ok('...and only once', g.score - s1 < PTS.skill);

  const h = launched(fresh());
  h._contact('id', 'pop0', 140, 256, 500, h.balls[0]);      // anything that scores spends it
  const h0 = h.score;
  h._switchHit(star, h.balls[0]);
  ok('scoring anything else first spends the skill shot', h.score - h0 < PTS.skill);
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
  // Fired along the mouth's own axis, so this stays a scoop shot if the saucer is ever re-aimed.
  const ART_SCOOP = (await import('./table.js')).ART.scoop;
  b.x = sc.x + Math.cos(ART_SCOOP.mouth) * 42;
  b.y = sc.y + Math.sin(ART_SCOOP.mouth) * 42;
  b.vx = -Math.cos(ART_SCOOP.mouth) * 700; b.vy = -Math.sin(ART_SCOOP.mouth) * 700;
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
  ok('SOAK: balls really do drain', drains >= 12, `${drains} drains`);
  ok('SOAK: random play scores', totalScore > 0, `total ${totalScore}`);
  ok('SOAK: the ball count stays sane (multiball adds two, never more)', maxBalls >= 1 && maxBalls <= 4,
    `max ${maxBalls} balls`);
  ok('SOAK: at least some games play right through to game over', gamesFinished >= 1, `${gamesFinished}/6`);
  ok('SOAK: no capture ever holds the ball for more than 2.5 s', longestHold < 2.5,
    `longest hold ${longestHold.toFixed(1)}s - a capture switch is not letting go`);
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

console.log(`\n${count - fail}/${count} passed`);
if (fail) { console.log(`${fail} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
