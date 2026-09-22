// Measures what a MISS actually does: what it hits, and whether it bounces.
import { BOARD } from './hoops4/js/boarddef.js';
import { buildMachine } from './hoops4/js/machine.js';
import { startThrow, substep } from './hoops4/js/physics.js';
const P = 11, A = 21;
// --set boardRest=0.3,riserRest=0.4  (repeatable) - measures a candidate without editing boarddef
const sets = process.argv.slice(2).filter(a => a.startsWith('--set=')).map(a => a.slice(6));
function variant(tag, over) {
  const b = structuredClone(BOARD);
  b.id = 'probe-' + tag;                       // buildMachine caches by id; a variant needs its own
  // mat.* goes to the contact materials; anything else is a geom knob (captureDrop, aimMax...).
  for (const [k, v] of Object.entries(over)) {
    if (k in b.geom.mat) b.geom.mat[k] = v; else b.geom[k] = v;
  }
  return b;
}
const RUNS = sets.length ? sets.map((sp, i) => {
  const over = {};
  for (const kv of sp.split(',')) { const [k, v] = kv.split('='); over[k] = Number(v); }
  return { tag: sp, board: variant(String(i), over) };
}) : [{ tag: 'as shipped', board: BOARD }];
for (const run of RUNS) measure(run.tag, run.board);
function measure(tag, BRD) {
const G = BRD.geom, M = buildMachine(G);
const parts = new Map();
let shots = 0, scored = 0, bouncy = 0, totalBounces = 0, apexSum = 0, parked = 0;
for (let p = 0; p < P; p++) for (let a = 0; a < A; a++) {
  const st = startThrow(BRD, { power: p / (P - 1), aim: -1 + 2 * a / (A - 1) });
  let g = 20000, prevVy = 0, bounces = 0, apex = 0, landedT = 0;
  const hit = new Set();
  while (!st.done && g-- > 0) {
    substep(st);
    const vy = st.ball.velocity.y;
    // A BOUNCE: the ball was falling and is now rising fast enough to see.
    if (prevVy < -0.25 && vy > 0.45) { bounces++; apex = Math.max(apex, vy); }
    prevVy = vy;
    for (const c of (st.world ? st.world.contacts : [])) {
      const b = c.bi === st.ball ? c.bj : (c.bj === st.ball ? c.bi : null);
      if (b && b.userData && b.userData.part) hit.add(b.userData.part);
    }
    if (!landedT && st.t > 0.3 && Math.abs(vy) < 0.2) landedT = st.t;
  }
  shots++;
  const h = st.outcome && st.outcome.hole;
  if (st.outcome && st.outcome.parked) parked++;
  if (h && G.holes[h]) scored++;
  else { if (bounces) bouncy++; totalBounces += bounces; apexSum += apex; }
  for (const k of hit) parts.set(k, (parts.get(k) || 0) + 1);
}
const misses = shots - scored;
console.log(`\n${tag}`);
console.log(`  scored ${scored}/${shots} (${(100*scored/shots).toFixed(1)}%)  parked ${(100*parked/shots).toFixed(1)}%`);
console.log(`  misses that bounced ${(100*bouncy/misses).toFixed(0)}%   bounces per miss ${(totalBounces/misses).toFixed(2)}   mean best rebound ${(apexSum/misses).toFixed(2)} m/s`);
}
