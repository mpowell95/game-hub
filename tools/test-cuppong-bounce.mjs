// tools/test-cuppong-bounce.mjs - Cup Pong: a DELIBERATE bounce shot must never be the better shot (2026-11-16,
// Matt: "Intentional bounce shots go in almost always"... "fix the table").
//
// HOW TO MEASURE IT (the mistake made four times before: random throws at random racks mostly miss, so bounce and
// direct look equal). A real player aims at ONE spot and misses it by a little. So, for each rack: fly every power
// x aim on a grid, then for every aim point take the make rate a person would get there (the grid blurred by a
// hand's wobble: power sd 0.04, aim sd 0.03 rad, about what real throws show), and keep the BEST aim point for a
// bounce (most throws there meet the table first, 10 cm or more in front of the front cup) and for a direct throw.
// PASS = at every rack the best bounce is no better than the best direct throw (3 points of grid noise allowed),
// and a bounce can still go in (5% or more).
// Real throws this was built from: King of Games, 7-10 cups, bounce 62% (223/357) against direct 43% on the old table.
//
//   node tools/test-cuppong-bounce.mjs          (about a minute)
//   node tools/test-cuppong-bounce.mjs --v2     also prints the first real-life table (rest 0.90, no kick): it FAILS, on purpose
import { simulateThrow, TABLE_V2 } from '../cup-pong/js/physics.js';
import { cupsXZ } from '../cup-pong/js/rack.js';

// Rack layouts real games reach most often (unit coordinates, cup-pong/js/rack.js), plus the 6-cup triangle.
const RACKS = {
  '10 cups': [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0], [-1, 0.87], [0, 0.87], [1, 0.87], [-0.5, 1.73], [0.5, 1.73], [0, 2.6]],
  '6 cups (front row + 2)': [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0], [-1, 0.87], [1, 0.87]],
  '6 cups (triangle)': [[-1, 0], [0, 0], [1, 0], [-0.5, 0.87], [0.5, 0.87], [0, 1.73]],
  '3 cups': [[-0.5, 0], [0.5, 0], [0, 0.87]],
  '1 cup': [[0, 0]],
};
const SP = 0.04, SA = 0.03, SLACK = 0.03, MIN_BOUNCE = 0.05;
const P = [], A = [];
for (let p = 0.12; p <= 0.78001; p += 0.01) P.push(+p.toFixed(3));
for (let a = -0.12; a <= 0.12001; a += 0.015) A.push(+a.toFixed(3));

function measure(units, model) {
  const cups = cupsXZ(units.map(([u, v], i) => ({ id: `k${i}`, u, v })));
  const front = Math.max(...cups.map((c) => c.z));
  const G = P.map((p) => A.map((a) => {
    const o = simulateThrow({ power: p, aim: a, cups, model });
    const first = o.events.find((e) => e === 'table' || e === 'cup' || e === 'made');
    return { m: o.outcome.kind === 'made' ? 1 : 0, b: first === 'table' && o.firstTable && o.firstTable.z - front >= 0.1 ? 1 : 0 };
  }));
  const best = { b: 0, d: 0 };
  for (let i = 0; i < P.length; i++) for (let j = 0; j < A.length; j++) {
    let w = 0, s = 0, bw = 0;
    for (let k = Math.max(0, i - 10); k < Math.min(P.length, i + 11); k++) for (let l = 0; l < A.length; l++) {
      const g = Math.exp(-((P[k] - P[i]) ** 2) / (2 * SP * SP) - ((A[l] - A[j]) ** 2) / (2 * SA * SA));
      w += g; s += g * G[k][l].m; bw += g * G[k][l].b;
    }
    const key = bw / w > 0.5 ? 'b' : 'd';
    if (s / w > best[key]) best[key] = s / w;
  }
  return best;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); cond ? pass++ : fail++; };
const pc = (x) => `${Math.round(x * 100)}%`;
for (const [name, units] of Object.entries(RACKS)) {
  const r = measure(units, null);
  ok(`${name}: the best bounce is no better than the best direct throw`, r.b <= r.d + SLACK, `bounce ${pc(r.b)}, direct ${pc(r.d)}`);
  ok(`${name}: a bounce can still go in`, r.b >= MIN_BOUNCE, pc(r.b));
  if (process.argv.includes('--v2')) { const o = measure(units, TABLE_V2); console.log(`     first real-life table (2026-11-16, rest 0.90): bounce ${pc(o.b)}, direct ${pc(o.d)}`); }
}
console.log(`\nCup Pong bounce: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
