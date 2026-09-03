// golf/js/test.js - headless tests. Run with `node golf/js/test.js`.
// Part 1: tests 1 (heightfield mapping), 2 (determinism), 3 (carry table), 7 (meters).
// Part 2: tests 4 (reachability), 5 (putt sweep). Part 5: test 6 (points table, game.js).
// Part 6: test 8 (fixture replay, golf/tools/refixture.mjs). See §12.1 of GOLF-HANDOFF.md.

import { build, heightAt, surfaceAt, rng, S } from './terrain.js';
import { simulateShot, dropTest } from './physics.js';
import { CLUBS, TARGET_CARRY_M, TARGET_PUTT_ROLL_M, autoSelectClub } from './clubs.js';
import { pos } from './meters.js';
import { holePoints } from './game.js';
import harborCourse from '../courses/harbor/course.js';
import harborFixture from '../courses/harbor/fixture.json' with { type: 'json' };

const HARBOR_H1 = harborCourse.holes[0];

function bearingDeg(fromXZ, toXZ) {
  const dx = toXZ[0] - fromXZ[0], dz = toXZ[1] - fromXZ[1];
  return Math.atan2(dx, dz) * 180 / Math.PI;
}

function lieName(surfCode) {
  switch (surfCode) {
    case S.TEE: return 'tee';
    case S.FAIRWAY: return 'fairway';
    case S.FRINGE: return 'fringe';
    case S.ROUGH: return 'rough';
    case S.SAND: return 'sand';
    case S.GREEN: return 'green';
    default: return 'rough';
  }
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + msg); }
}
function approx(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/- ${tol})`);
}

function flatHoleDef(overrides) {
  return Object.assign({
    n: 1, par: 4, seed: 101, tee: [0, 0], pin: [0, 400], target: [0, 200],
    fairway: { path: [[0, 0], [0, 400]], width: 400 },
    green: { center: [0, 400], radius: 20, tilt: [0, 0] }, fringe: 3,
    bunkers: [], water: [], hills: [], trees: { count: 0 },
    intro: { from: [0, 20, 420], to: [0, 10, -10] },
  }, overrides || {});
}

// ---- Test 1: heightfield mapping ----
function test1() {
  const t = build(flatHoleDef());
  const points = [[0, 0], [20, 100], [-30, 250]];
  for (const [x, z] of points) {
    const rest = dropTest(t, x, z);
    const expected = heightAt(t, rest.x, rest.z) + 0.02134;
    approx(rest.y, expected, 0.01, `heightfield mapping at (${x},${z})`);
    approx(rest.x, x, 3, `heightfield mapping at (${x},${z}): stays near drop point (x)`);
    approx(rest.z, z, 3, `heightfield mapping at (${x},${z}): stays near drop point (z)`);
  }
}

// ---- Test 1b: ground-guard robustness, 80 seeded random points on Harbor hole 1 ----
function test1b() {
  const t = build(HARBOR_H1);
  const gen = rng(9001);
  const minX = t.x0 + 5, maxX = t.x0 + t.nx - 5;
  const minZ = t.z0 + 5, maxZ = t.z0 + t.nz - 5;
  let worst = 0;
  let below = 0;
  for (let i = 0; i < 80; i++) {
    const x = minX + gen() * (maxX - minX);
    const z = minZ + gen() * (maxZ - minZ);
    const rest = dropTest(t, x, z);
    // compare against the height AT WHERE IT LANDED, not the drop point - a ball can roll
    // (e.g. down the water hazard's edge, §6.4's flat 1.2m cliff) before settling.
    const expected = heightAt(t, rest.x, rest.z) + 0.02134;
    const diff = rest.y - expected;
    if (Math.abs(diff) > worst) worst = Math.abs(diff);
    if (diff < -0.01) below++;
  }
  approx(worst, 0, 0.01, 'ground guard: worst rest deviation over 80 points');
  assert(below === 0, `ground guard: ${below} of 80 points ended below the terrain`);
}

// ---- Test 2: determinism ----
function test2() {
  const t = build(flatHoleDef());
  const input = {
    from: { x: 0, z: 0 }, dirDeg: 3, clubId: '7i', lie: 'fairway',
    power01: 0.9, spin01: 0.2, wind: { x: 1, z: 0.5 }, seed: 42,
  };
  const r1 = simulateShot(t, input);
  const r2 = simulateShot(t, input);
  assert(r1.rest.x === r2.rest.x && r1.rest.y === r2.rest.y && r1.rest.z === r2.rest.z,
    `determinism: rest identical (${JSON.stringify(r1.rest)} vs ${JSON.stringify(r2.rest)})`);
}

// ---- Test 3: carry table ----
function test3() {
  const t = build(flatHoleDef());
  for (const club of CLUBS) {
    if (club.id === 'pt') continue;
    // Sanity floor from the 2026-09-02 spinAxis-sign bug hunt: a club speed outside 25-80 m/s
    // is a bug signal (unrealistic ball speed), not a legitimate tuning result - see
    // DECISIONS.md#spinaxis-sign-bug.
    assert(club.speed >= 25 && club.speed <= 80, `club speed in range: ${club.id} = ${club.speed}`);
    const target = TARGET_CARRY_M[club.id];
    if (target === undefined) continue;
    const r = simulateShot(t, {
      from: { x: 0, z: 0 }, dirDeg: 0, clubId: club.id, lie: 'fairway',
      power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
    });
    const tol = target * 0.05;
    approx(r.carryM, target, tol, `carry ${club.id}`);
    if (club.id === 'dr') {
      const apex = r.samples.reduce((m, s) => Math.max(m, s.y), 0);
      assert(apex >= 22 && apex <= 38, `driver apex in range (got ${apex.toFixed(1)})`);
    }
  }
  // Dedicated oversized-green hole so a 36m roll never leaves the green (into fairway noise)
  // and never starts on/near the cup (pin moved well off to the side) - either confound was
  // enough to make this measurement meaningless. Aimed away from the pin's bearing regardless.
  const puttHole = flatHoleDef({
    pin: [1000, 400], green: { center: [0, 400], radius: 80, tilt: [0, 0] },
  });
  const tPutt = build(puttHole);
  const putt = simulateShot(tPutt, {
    from: { x: 0, z: 400 }, dirDeg: 180, clubId: 'pt', lie: 'green',
    power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
  });
  approx(putt.totalM, TARGET_PUTT_ROLL_M, TARGET_PUTT_ROLL_M * 0.05, 'putt roll');
}

// ---- Test 3b: rollout bands (Part 2 amendment, 2026-09-02) ----
// Flat test hole, power 1.0, spin01=0, no wind. rollout = total - carry.
function rolloutOf(t, clubId, lie, dirDeg, fromXZ) {
  const r = simulateShot(t, {
    from: { x: fromXZ[0], z: fromXZ[1] }, dirDeg, clubId, lie,
    power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
  });
  const landT = r.events.find(e => e.kind === 'land')?.t;
  const nextT = r.events.find(e => e.kind === 'bounce')?.t ?? Infinity;
  let bounceH = 0;
  if (landT !== undefined) {
    for (const s of r.samples) if (s.t >= landT && s.t <= nextT) bounceH = Math.max(bounceH, s.y);
  }
  return { rollout: r.totalM - r.carryM, bounceH };
}
function test3b() {
  const t = build(flatHoleDef());
  const dr1 = rolloutOf(t, 'dr', 'fairway', 0, [0, 0]);
  assert(dr1.rollout >= 15 && dr1.rollout <= 35, `driver/fairway rollout in 15-35m (got ${dr1.rollout.toFixed(1)})`);
  assert(dr1.bounceH < 1.5, `driver/fairway first bounce under 1.5m (got ${dr1.bounceH.toFixed(2)})`);

  const i7 = rolloutOf(t, '7i', 'fairway', 0, [0, 0]);
  assert(i7.rollout >= 4 && i7.rollout <= 15, `7 iron/fairway rollout in 4-15m (got ${i7.rollout.toFixed(1)})`);

  const pwF = rolloutOf(t, 'pw', 'fairway', 0, [0, 0]);
  assert(pwF.rollout >= -3 && pwF.rollout <= 8, `wedge/fairway rollout in -3..8m (got ${pwF.rollout.toFixed(1)})`);

  // dedicated hole: a narrow fairway well off to the side, so a straight drive from the tee
  // lands and rolls on genuine ROUGH (not the wide flat hole's own fairway).
  const roughHole = flatHoleDef({
    pin: [0, 1000], target: [0, 500],
    fairway: { path: [[500, 0], [500, 400]], width: 10 },
    green: { center: [0, 1000], radius: 20, tilt: [0, 0] },
  });
  const tRough = build(roughHole);
  const drR = rolloutOf(tRough, 'dr', 'tee', 0, [0, 0]);
  assert(drR.rollout < 6, `driver/rough rollout under 6m (got ${drR.rollout.toFixed(1)})`);

  // dedicated hole: a bunker centered where a full-power wedge from the fairway actually lands.
  const sandHole = flatHoleDef({
    pin: [0, 300], target: [0, 150],
    fairway: { path: [[0, 0], [0, 300]], width: 200 },
    green: { center: [0, 300], radius: 20, tilt: [0, 0] },
    bunkers: [{ center: [0, 100], radius: 15 }],
  });
  const tSand = build(sandHole);
  const pwS = rolloutOf(tSand, 'pw', 'fairway', 0, [0, 0]);
  assert(pwS.rollout < 2, `wedge/sand rollout under 2m (got ${pwS.rollout.toFixed(1)})`);

  // putter/green must be unaffected (green's roll is untouched)
  const puttHole2 = flatHoleDef({
    pin: [1000, 400], green: { center: [0, 400], radius: 80, tilt: [0, 0] },
  });
  const tPutt2 = build(puttHole2);
  const putt2 = simulateShot(tPutt2, {
    from: { x: 0, z: 400 }, dirDeg: 180, clubId: 'pt', lie: 'green',
    power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
  });
  approx(putt2.totalM, TARGET_PUTT_ROLL_M, TARGET_PUTT_ROLL_M * 0.05, 'putt/green total unaffected by rollout tuning');
}

// ---- Test 4: reachability, per Harbor hole ----
function test4() {
  for (const hole of harborCourse.holes) {
    const t = build(hole);

    // Leg 1: tee -> target, auto club, aim 0 (straight at target), power 1.0
    const teeLie = 'tee';
    const d1 = Math.hypot(hole.target[0] - hole.tee[0], hole.target[1] - hole.tee[1]);
    const club1 = autoSelectClub(teeLie, d1, 0);
    const dir1 = bearingDeg(hole.tee, hole.target);
    const r1 = simulateShot(t, {
      from: { x: hole.tee[0], z: hole.tee[1] }, dirDeg: dir1, clubId: club1, lie: teeLie,
      power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
    });
    const s1 = surfaceAt(t, r1.rest.x, r1.rest.z);
    assert(s1 === S.FAIRWAY || s1 === S.FRINGE || s1 === S.GREEN,
      `H${hole.n} leg1 (tee->target) rest surface is FAIRWAY/FRINGE/GREEN (got ${s1}, club ${club1})`);

    // Leg 2: target -> pin, auto club (from the surface actually under the target), aim at pin
    const lie2 = lieName(surfaceAt(t, hole.target[0], hole.target[1]));
    const d2 = Math.hypot(hole.pin[0] - hole.target[0], hole.pin[1] - hole.target[1]);
    const club2 = autoSelectClub(lie2, d2, 0);
    const dir2 = bearingDeg(hole.target, hole.pin);
    const r2 = simulateShot(t, {
      from: { x: hole.target[0], z: hole.target[1] }, dirDeg: dir2, clubId: club2, lie: lie2,
      power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
    });
    const dPin = Math.hypot(r2.rest.x - hole.pin[0], r2.rest.z - hole.pin[1]);
    const s2 = surfaceAt(t, r2.rest.x, r2.rest.z);
    assert(dPin <= 25, `H${hole.n} leg2 (target->pin) rest within 25m of pin (got ${dPin.toFixed(1)}, club ${club2})`);
    assert(s2 !== S.WATER && s2 !== S.OB, `H${hole.n} leg2 rest not WATER/OB (got ${s2})`);
  }
}

// ---- Test 5: putt sweep, per Harbor hole ----
function test5() {
  for (const hole of harborCourse.holes) {
    const t = build(hole);
    let anyHoled = false;
    for (let k = 0; k < 8 && !anyHoled; k++) {
      const ang = (k / 8) * 2 * Math.PI;
      const fromXZ = [hole.pin[0] + 4 * Math.sin(ang), hole.pin[1] + 4 * Math.cos(ang)];
      const dir = bearingDeg(fromXZ, hole.pin);
      for (let p = 0.05; p <= 0.6 + 1e-9 && !anyHoled; p += 0.05) {
        const r = simulateShot(t, {
          from: { x: fromXZ[0], z: fromXZ[1] }, dirDeg: dir, clubId: 'pt', lie: 'green',
          power01: p, spin01: 0, wind: { x: 0, z: 0 }, seed: 7,
        });
        if (r.outcome === 'hole') anyHoled = true;
      }
    }
    assert(anyHoled, `H${hole.n} putt sweep: at least one of the 8x12 sweep holes out`);
  }
}

// ---- Test 6: points table ----
function test6() {
  const par = 4;
  const want = { '-3': 8, '-2': 5, '-1': 2, '0': 0, '1': -1, '2': -3, '3': -3 };
  for (const dStr of Object.keys(want)) {
    const d = Number(dStr);
    assert(holePoints(par + d, par) === want[dStr], `holePoints d=${d} -> ${want[dStr]} (got ${holePoints(par + d, par)})`);
  }
}

// ---- Test 7: meters ----
function test7() {
  const T = 1.0;
  approx(pos(0, T), 0, 1e-9, 'pos(0,T)=0');
  approx(pos(T, T), 1, 1e-9, 'pos(T,T)=1');
  approx(pos(2 * T, T), 0, 1e-9, 'pos(2T,T)=0');
}

// ---- Test 8: fixture replay ----
function test8() {
  const fixtures = [{ courseId: 'harbor', course: harborCourse, fixture: harborFixture }];
  for (const { courseId, course, fixture } of fixtures) {
    assert(fixture.courseId === courseId, `fixture courseId matches (${fixture.courseId})`);
    const terrainByHole = new Map();
    for (const shot of fixture.shots) {
      let terrain = terrainByHole.get(shot.hole);
      if (!terrain) {
        const hole = course.holes.find((h) => h.n === shot.hole);
        terrain = build(hole);
        terrainByHole.set(shot.hole, terrain);
      }
      const r = simulateShot(terrain, shot.input);
      const [ex, ey, ez] = shot.rest;
      const dist = Math.hypot(r.rest.x - ex, r.rest.y - ey, r.rest.z - ez);
      if (dist > 0.02) {
        console.error(`FAIL: fixture replay ${courseId} hole ${shot.hole} shot ${fixture.shots.indexOf(shot)}: ` +
          `expected rest [${ex}, ${ey}, ${ez}], got [${r.rest.x}, ${r.rest.y}, ${r.rest.z}] (off by ${dist.toFixed(4)}m)`);
      }
      assert(dist <= 0.02, `fixture replay ${courseId} hole ${shot.hole} shot ${fixture.shots.indexOf(shot)} within 0.02m`);
    }
  }
}

test1();
test1b();
test2();
test3();
test3b();
test4();
test5();
test6();
test7();
test8();

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
