// SCRATCH PROBE, not part of the shipped instrument set. Measures scoring rate as a function of
// the per-hole mouth radius (`geom.holes.cN.r`), which `probe-bounce.mjs`'s flat `--set` cannot
// reach because it is nested per-hole, not a single geom key. Copies probe-bounce.mjs's measure
// loop verbatim (231-throw grid, P=11 x A=21) and adds one thing: `--scale=1.05` multiplies every
// hole's `r` by that factor before the machine is built. Widening only - never pass < 1.
import { BOARD } from '../../hoops4/js/boarddef.js';
import { buildMachine } from '../../hoops4/js/machine.js';
import { startThrow, substep } from '../../hoops4/js/physics.js';
const P = 11, A = 21;

const scales = process.argv.slice(2).filter(a => a.startsWith('--scale=')).map(a => Number(a.slice(8)));
const RUNS = (scales.length ? scales : [1.0]).map(s => {
  const b = structuredClone(BOARD);
  b.id = 'probe-holeR-' + s;
  if (s !== 1.0) {
    for (const k of Object.keys(b.geom.holes)) {
      const h = b.geom.holes[k];
      if (s < 1) throw new Error('narrowing a hoop mouth is out of scope - refusing scale < 1');
      h.r = h.r * s;
    }
  }
  return { tag: `holeR x${s}`, board: b };
});
for (const run of RUNS) measure(run.tag, run.board);

function measure(tag, BRD) {
const G = BRD.geom, M = buildMachine(G);
let shots = 0, scored = 0, bouncy = 0, totalBounces = 0, apexSum = 0, parked = 0;
let latSum = 0, fwdSum = 0, nBounce = 0;
for (let p = 0; p < P; p++) for (let a = 0; a < A; a++) {
  const st = startThrow(BRD, { power: p / (P - 1), aim: -1 + 2 * a / (A - 1) });
  let g = 20000, prevVy = 0, bounces = 0, apex = 0;
  let lat = 0, fwd = 0;
  while (!st.done && g-- > 0) {
    substep(st);
    const v = st.ball.velocity;
    if (prevVy < -0.25 && v.y > 0.45) {
      bounces++; apex = Math.max(apex, v.y);
      lat += Math.abs(v.x); fwd += Math.max(v.z, 0); nBounce++;
    }
    prevVy = v.y;
  }
  shots++;
  const h = st.outcome && st.outcome.hole;
  if (st.emergencyUsed) parked++;
  if (h && G.holes[h]) scored++;
  else {
    if (bounces) bouncy++;
    totalBounces += bounces; apexSum += apex; latSum += lat; fwdSum += fwd;
  }
}
const misses = shots - scored;
const pc = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';
console.log(`\n${tag}`);
console.log(`  scored ${scored}/${shots} (${pc(scored, shots)})  parked ${pc(parked, shots)}`);
console.log(`  misses that bounced ${pc(bouncy, misses)}   mean best rebound ${(apexSum / misses).toFixed(2)} m/s   lateral:forward ${(latSum / (fwdSum || 1e-9)).toFixed(2)}:1`);
}
