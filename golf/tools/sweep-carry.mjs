// golf/tools/sweep-carry.mjs - prints carry/total/hang-time/apex per club per power on flat
// ground. Also spin01 = -1 and +1 for driver, 7i, PW. See §12.2 of GOLF-HANDOFF.md.
// Run: node golf/tools/sweep-carry.mjs

import { build } from '../js/terrain.js';
import { simulateShot, SPIN_BRAKE, SPIN_BITE } from '../js/physics.js';
import { CLUBS } from '../js/clubs.js';

function flatHole() {
  return {
    n: 1, par: 4, seed: 101, tee: [0, 0], pin: [0, 400], target: [0, 200],
    fairway: { path: [[0, 0], [0, 400]], width: 400 },
    green: { center: [0, 400], radius: 20, tilt: [0, 0] }, fringe: 3,
    bunkers: [], water: [], hills: [], trees: { count: 0 },
    intro: { from: [0, 20, 420], to: [0, 10, -10] },
  };
}

const terrain = build(flatHole());
const POWERS = [1.0, 0.9, 0.8, 0.7, 0.6];

function row(clubId, power, spin01) {
  const r = simulateShot(terrain, {
    from: { x: 0, z: 0 }, dirDeg: 0, clubId, lie: 'fairway',
    power01: power, spin01, wind: { x: 0, z: 0 }, seed: 7,
  });
  const land = r.events.find(e => e.kind === 'land');
  const hang = land ? land.t : 0;
  const apex = r.samples.reduce((m, s) => Math.max(m, s.y), 0);
  return { carry: r.carryM, total: r.totalM, hang, apex };
}

console.log(`Club x Power -> carry(m) total(m) hang(s) apex(m)  [spin01 = 0, "straight", bar centered, SPIN_BRAKE=${SPIN_BRAKE}, SPIN_BITE=${SPIN_BITE}]`);
for (const club of CLUBS) {
  if (club.id === 'pt') continue;
  console.log(`\n${club.name.en} (${club.id})`);
  for (const p of POWERS) {
    const r = row(club.id, p, 0);
    console.log(`  power ${p.toFixed(1)}  carry ${r.carry.toFixed(1)}  total ${r.total.toFixed(1)}  hang ${r.hang.toFixed(2)}  apex ${r.apex.toFixed(1)}`);
  }
}

console.log('\nSpin variants (driver, 7i, PW) at power 1.0:');
for (const id of ['dr', '7i', 'pw']) {
  for (const spin01 of [-1, 1]) {
    const r = row(id, 1.0, spin01);
    console.log(`  ${id} spin01=${spin01}  carry ${r.carry.toFixed(1)}  total ${r.total.toFixed(1)}  hang ${r.hang.toFixed(2)}  apex ${r.apex.toFixed(1)}`);
  }
}
