// golf/tools/refixture.mjs - generates golf/courses/<courseId>/fixture.json. See §12.1 of
// GOLF-HANDOFF.md. Run: `node golf/tools/refixture.mjs harbor`.
//
// Eight shots per hole (six straight since Part 6, two curved since Part 9B), fixed inputs
// chosen for reproducibility (NOT for "does this shot score well" - this is a regression
// fixture, not a tuning table; test8 only checks that physics.js still produces the SAME rest
// for the SAME input, not that the input is a good golf shot):
//   1-3. Tee shot, driver/3w/5i, power 1.0/0.8/0.6, aim 0 (dirDeg = bearing from tee to the
//        hole's own `target` - "aim 0" throughout this codebase means straight at the natural
//        aim point, e.g. ui.js's targetBearingDeg + aimOffset with aimOffset 0).
//   4.   From `target`, the auto-selected club for the lie actually under it, aimed at the pin,
//        power 1.0 - same convention as test4's reachability leg 2.
//   5-6. Putts from 3m and 8m short of the pin (due "north", matching test5's angle-0 sweep
//        point), putter, power 0.3, aimed at the pin.
//
// Regenerating a fixture is a deliberate act (§15): the commit that runs this must say what
// physics change caused it and which holes' outcomes changed.

import { build, surfaceAt } from '../js/terrain.js';
import { simulateShot } from '../js/physics.js';
import { autoSelectClub } from '../js/clubs.js';

const S_LIE = { 0: 'ob', 1: 'rough', 2: 'fairway', 3: 'fringe', 4: 'green', 5: 'sand', 6: 'water', 7: 'tee' };

function bearingDeg(a, b) { return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; }

async function main() {
  const courseId = process.argv[2];
  if (!courseId) {
    console.error('usage: node golf/tools/refixture.mjs <courseId>');
    process.exit(1);
  }
  const mod = await import(`../courses/${courseId}/course.js`);
  const course = mod.default;
  const terrainByHole = course.holes.map((h) => build(h));

  const shots = [];
  course.holes.forEach((hole, hi) => {
    const terrain = terrainByHole[hi];
    const dirTee = bearingDeg(hole.tee, hole.target);

    // 1-3: tee shot, driver/3w/5i at power 1.0/0.8/0.6, aim 0
    [['dr', 1.0], ['3w', 0.8], ['5i', 0.6]].forEach(([clubId, power01]) => {
      const input = {
        from: { x: hole.tee[0], z: hole.tee[1] }, dirDeg: dirTee, clubId, lie: 'tee',
        power01, spin01: 0, wind: { x: 0, z: 0 }, seed: 7001 + hi,
      };
      const r = simulateShot(terrain, input);
      shots.push({ hole: hole.n, input, rest: [r.rest.x, r.rest.y, r.rest.z], outcome: r.outcome });
    });

    // 4: from target, auto club, aimed at pin, power 1.0
    {
      const lieCode = surfaceAt(terrain, hole.target[0], hole.target[1]);
      const lie = S_LIE[lieCode] || 'rough';
      const d = Math.hypot(hole.pin[0] - hole.target[0], hole.pin[1] - hole.target[1]);
      const clubId = autoSelectClub(lie, d, 0);
      const dir = bearingDeg(hole.target, hole.pin);
      const input = {
        from: { x: hole.target[0], z: hole.target[1] }, dirDeg: dir, clubId, lie,
        power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7004 + hi,
      };
      const r = simulateShot(terrain, input);
      shots.push({ hole: hole.n, input, rest: [r.rest.x, r.rest.y, r.rest.z], outcome: r.outcome });
    }

    // 5-6: putts from 3m and 8m short of the pin, power 0.3, aimed at the pin
    [3, 8].forEach((dist, i) => {
      const fromXZ = [hole.pin[0], hole.pin[1] + dist];
      const dir = bearingDeg(fromXZ, hole.pin);
      const input = {
        from: { x: fromXZ[0], z: fromXZ[1] }, dirDeg: dir, clubId: 'pt', lie: 'green',
        power01: 0.3, spin01: 0, wind: { x: 0, z: 0 }, seed: 7005 + hi * 10 + i,
      };
      const r = simulateShot(terrain, input);
      shots.push({ hole: hole.n, input, rest: [r.rest.x, r.rest.y, r.rest.z], outcome: r.outcome });
    });

    // 7-8 (Part 9B): two curved driver tee shots, curve01 = +0.6 (slice) and -0.6 (hook), power
    // 1.0, aim 0. Appended AFTER the six straight shots so the straight ones keep their indices
    // (test 8b's bit-identity check walks them by position and skips anything with curve01).
    [0.6, -0.6].forEach((curve01, i) => {
      const input = {
        from: { x: hole.tee[0], z: hole.tee[1] }, dirDeg: dirTee, clubId: 'dr', lie: 'tee',
        power01: 1.0, spin01: 0, wind: { x: 0, z: 0 }, seed: 7007 + hi * 10 + i, curve01,
      };
      const r = simulateShot(terrain, input);
      shots.push({ hole: hole.n, input, rest: [r.rest.x, r.rest.y, r.rest.z], outcome: r.outcome });
    });
  });

  const fixture = { courseId, engine: 1, shots };
  const outPath = new URL(`../courses/${courseId}/fixture.json`, import.meta.url);
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Wrote ${shots.length} shots (${course.holes.length} holes x 8) to ${outPath.pathname}`);
}

main();
