// Measures what a MISS actually does: what it hits, WHICH WAY it bounces, and WHERE IT ENDS UP.
//
// The direction half (2026-09-22) is Matt's: "right now it bounces forward and rolls off the
// front of the machine a lot... I want it to bounce only horizontally." A bounce that throws the
// ball SIDEWAYS across the hoop row is the randomness he asked for - it changes which column a
// shot lands in. A bounce that throws it FORWARD only walks it off the front edge of the shelf,
// which costs a shot and buys nothing. Both read as "bouncy" on screen, so the earlier probe
// (which counted bounces and their height and nothing else) could not tell them apart, and the
// build it signed off on traded 14 points of scoring rate for the wrong one.
//
// world x is the face's u axis (across the hoop row); +z is TOWARD THE PLAYER. So at each bounce
// the split is |vx| lateral against max(vz, 0) forward, and `off the front` is a ball that got
// onto the shelf and then came back over its front edge.
import { BOARD } from '../../hoops4/js/boarddef.js';
import { buildMachine } from '../../hoops4/js/machine.js';
import { startThrow, substep } from '../../hoops4/js/physics.js';
const P = 11, A = 21;
const X = 1.00 / 6.875;
const SHELF_V = X * 4.80;          // face v where the display panel ends and the shelf begins
// --set boardRest=0.3,riserRest=0.4  (repeatable) - measures a candidate without editing boarddef
const sets = process.argv.slice(2).filter(a => a.startsWith('--set=')).map(a => a.slice(6));
function variant(tag, over) {
  const b = structuredClone(BOARD);
  b.id = 'probe-' + tag;                       // buildMachine caches by id; a variant needs its own
  // mat.* goes to the contact materials; anything else is a geom knob (captureDrop, aimMax...).
  for (const [k, v] of Object.entries(over)) {
    // shelfTilt reaches into steps[1], which is not a flat geom key - it is the one geometry knob
    // that decides whether a miss rolls off the front edge, so it has to be measurable here.
    if (k === 'shelfTilt') b.geom.steps[1].tilt = v;
    else if (k in b.geom.mat) b.geom.mat[k] = v; else b.geom[k] = v;
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
let latSum = 0, fwdSum = 0, nBounce = 0, offFront = 0, reachedShelf = 0, lateral20 = 0;
for (let p = 0; p < P; p++) for (let a = 0; a < A; a++) {
  const st = startThrow(BRD, { power: p / (P - 1), aim: -1 + 2 * a / (A - 1) });
  let g = 20000, prevVy = 0, bounces = 0, apex = 0;
  let onShelf = false, cameBack = false, lat = 0, fwd = 0, big = 0;
  const hit = new Set();
  while (!st.done && g-- > 0) {
    substep(st);
    const v = st.ball.velocity;
    // A BOUNCE: the ball was falling and is now rising fast enough to see.
    if (prevVy < -0.25 && v.y > 0.45) {
      bounces++; apex = Math.max(apex, v.y);
      lat += Math.abs(v.x); fwd += Math.max(v.z, 0); nBounce++;
      if (Math.abs(v.x) > 0.20) big++;
    }
    prevVy = v.y;
    for (const c of (st.world ? st.world.contacts : [])) {
      const b = c.bi === st.ball ? c.bj : (c.bj === st.ball ? c.bi : null);
      if (b && b.userData && b.userData.part) hit.add(b.userData.part);
    }
    const f = M.worldToFace(st.ball.position);
    if (f.v > SHELF_V + G.ballR) onShelf = true;
    else if (onShelf && f.v < SHELF_V - G.ballR) cameBack = true;
  }
  shots++;
  const h = st.outcome && st.outcome.hole;
  // GUARD: `st.outcome` has no `parked` field - the watchdog is `st.emergencyUsed`, which is
  // what hoops4/js/test.js reads. The first draft of this probe asked for `outcome.parked` and
  // printed a flat 0.0% on every build, while test.js was measuring 4.6% on the same engine.
  if (st.emergencyUsed) parked++;
  if (h && G.holes[h]) scored++;
  else {
    if (bounces) bouncy++;
    totalBounces += bounces; apexSum += apex; latSum += lat; fwdSum += fwd; lateral20 += big;
    if (onShelf) { reachedShelf++; if (cameBack) offFront++; }
  }
  for (const k of hit) parts.set(k, (parts.get(k) || 0) + 1);
}
const misses = shots - scored;
const pc = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';
console.log(`\n${tag}`);
console.log(`  scored ${scored}/${shots} (${pc(scored, shots)})  parked ${pc(parked, shots)}`);
console.log(`  misses that bounced ${pc(bouncy, misses)}   bounces per miss ${(totalBounces / misses).toFixed(2)}   mean best rebound ${(apexSum / misses).toFixed(2)} m/s`);
console.log(`  per bounce: lateral ${(latSum / (nBounce || 1)).toFixed(2)} m/s   forward ${(fwdSum / (nBounce || 1)).toFixed(2)} m/s   ratio ${(latSum / (fwdSum || 1e-9)).toFixed(2)}:1`);
console.log(`  bounces with a real sideways kick (>0.20 m/s) ${pc(lateral20, nBounce)}`);
console.log(`  misses that got onto the shelf ${reachedShelf}, of which came back over the FRONT edge ${offFront} (${pc(offFront, reachedShelf)})`);
}
