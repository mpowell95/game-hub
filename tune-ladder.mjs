// tune-ladder.mjs - Skeeball's power ladder, measured.
//
//   node tune-ladder.mjs                    the shipped classic board
//   node tune-ladder.mjs '{"maxSpeed":3.6}' the same board with geom overrides
//   node tune-ladder.mjs --aim              also sweep aim x power (where the 100s live)
//   node tune-ladder.mjs --touch            also report the touched-the-board rate
//
// WHY THIS EXISTS. On 2026-08-14 a play review measured the shipped ladder and found it was
// noise: 43 of 100 adjacent 0.01 power steps flipped the outcome, 30 of the 44 contiguous bands
// were a single 0.01 step wide, and 0.002 of power - 0.6px of thumb travel over the swipe's
// measurement window - was the difference between 10 and 30 points. There is no way to look at
// physics.js and see that. You have to run every step and count.
//
// So: this runs the REAL engine (physics.js's simulateThrow, the same call the game makes) over
// the whole power range and prints what a player would actually be able to learn. It needs no
// browser and no dependency - physics.js imports only cannon-es and machine.js, neither of which
// touches the DOM - so a tuning pass is seconds, not minutes.
//
// WHAT GOOD LOOKS LIKE: few flips, wide bands, no dead zone at either end, every value on the
// board reachable, and monotonic - harder goes further - up to the overshoot.

import { simulateThrow } from './skeeball/js/physics.js';
import { BOARDS } from './skeeball/js/boards.js';

const args = process.argv.slice(2);
const overrides = JSON.parse(args.find((a) => a.startsWith('{')) || '{}');
const WANT_AIM = args.includes('--aim');
const WANT_TOUCH = args.includes('--touch');
const STEPS = 100;

let trial = 0;
/** A board with geom overrides and a UNIQUE id - physics.js caches the built machine by id. */
function boardWith(over) {
  const base = BOARDS[0];
  return {
    ...base,
    id: `tune-${trial++}`,
    geom: { ...base.geom, ...over, holes: { ...base.geom.holes, ...(over.holes || {}) },
      mat: { ...base.geom.mat, ...(over.mat || {}) },
      ring: { ...base.geom.ring, ...(over.ring || {}) } },
  };
}

const board = boardWith(overrides);
const at = (p, a = 0) => simulateThrow(board, { power: p, aim: a });

// --- the straight-on ladder ---------------------------------------------------------------------
const ladder = [];
for (let i = 0; i <= STEPS; i++) {
  const p = i / STEPS;
  const r = at(+p.toFixed(4));
  ladder.push({
    p: +p.toFixed(2),
    v: r.outcome ? r.outcome.value : -1,
    hole: r.outcome ? r.outcome.hole : 'RETURNED',
    t: r.time, touched: r.touchedBoard, emerg: r.emergencyUsed,
    back: r.events.filter((e) => e === 'backboard').length,
  });
}

const bands = [];
for (const r of ladder) {
  const last = bands[bands.length - 1];
  if (last && last.v === r.v) { last.to = r.p; last.n++; }
  else bands.push({ v: r.v, hole: r.hole, from: r.p, to: r.p, n: 1 });
}
let flips = 0;
for (let i = 1; i < ladder.length; i++) if (ladder[i].v !== ladder[i - 1].v) flips++;

console.log(`=== STRAIGHT-ON POWER LADDER (aim 0), ${STEPS + 1} steps ===`);
for (const b of bands) {
  const w = Math.round((100 * b.n) / (STEPS + 1));
  console.log(`  ${b.from.toFixed(2)} - ${b.to.toFixed(2)}  ${String(b.n).padStart(3)} steps (${String(w).padStart(2)}%)  ${String(b.v).padStart(4)} pts  ${b.hole}  ${'#'.repeat(Math.max(1, Math.round(b.n / 2)))}`);
}
const oneStep = bands.filter((b) => b.n === 1).length;
console.log(`\n  flips between adjacent 0.01 steps : ${flips}/${STEPS}   (was 43/100)`);
console.log(`  contiguous bands                  : ${bands.length}   (was 44)`);
console.log(`  bands only one 0.01 step wide     : ${oneStep}/${bands.length}   (was 30/44)`);
console.log(`  mean band width                   : ${(( STEPS + 1) / bands.length).toFixed(1)} steps   (was 2.3)`);
console.log(`  narrowest band                    : ${Math.min(...bands.map((b) => b.n))} steps`);

// dead zones: a run of the SAME floor value at either end
const floorV = 10;
let lowDead = 0;
for (const r of ladder) { if (r.v === floorV || r.v === -1 || r.v === 0) lowDead++; else break; }
let highDead = 0;
for (let i = ladder.length - 1; i >= 0; i--) { if (ladder[i].v === floorV || ladder[i].v === 0) highDead++; else break; }
console.log(`  dead zone at the SOFT end         : ${lowDead} steps   (was 25: 0.00-0.04 returned, 0.05-0.25 all 10)`);
console.log(`  dead zone at the HARD end         : ${highDead} steps   (was 9 at 0.86-0.94, plus 3 more at 0.96-0.98)`);

const values = [...new Set(ladder.map((r) => r.v))].sort((a, b) => a - b);
console.log(`  values reachable straight on      : ${values.join(', ')}`);
const emerg = ladder.filter((r) => r.emerg).length;
console.log(`  throws needing the jam watchdog   : ${emerg}/${ladder.length}`);
console.log(`  mean flight                       : ${(ladder.reduce((a, b) => a + b.t, 0) / ladder.length).toFixed(2)}s   max ${Math.max(...ladder.map((r) => r.t)).toFixed(2)}s   (was 1.76 / 3.99)`);

// monotonic-up check: is the ladder non-decreasing until it peaks?
const peak = ladder.reduce((best, r, i) => (r.v > ladder[best].v ? i : best), 0);
let rises = 0, falls = 0;
for (let i = 1; i <= peak; i++) { if (ladder[i].v > ladder[i - 1].v) rises++; else if (ladder[i].v < ladder[i - 1].v) falls++; }
console.log(`  below the peak (step ${peak}): ${rises} rises, ${falls} falls   <- harder must go further`);

if (WANT_TOUCH) {
  const t = ladder.filter((r) => r.touched).length;
  const b = ladder.filter((r) => r.back > 0).length;
  console.log(`\n  TOUCHED the scoring face          : ${t}/${ladder.length}   (was 20/51)`);
  console.log(`  NEVER touched it                  : ${ladder.length - t}/${ladder.length}   (was 31/51)`);
  console.log(`  reached the BACK WALL             : ${b}/${ladder.length}   (was 25/51)`);
}

if (WANT_AIM) {
  console.log('\n=== AIM x POWER  (rows = power, cols = aim -1 .. +1) ===');
  const aims = [];
  for (let a = -1; a <= 1.0001; a += 0.1) aims.push(+a.toFixed(1));
  console.log('        ' + aims.map((a) => String(a).padStart(5)).join(''));
  let hundreds = 0, cells = 0;
  for (let p = 0.2; p <= 1.0001; p += 0.1) {
    const row = aims.map((a) => { const r = at(+p.toFixed(2), a); return r.outcome ? r.outcome.value : -1; });
    hundreds += row.filter((v) => v === 100).length;
    cells += row.length;
    console.log(`  p=${p.toFixed(2)} ` + row.map((v) => String(v).padStart(5)).join(''));
  }
  console.log(`\n  cells scoring 100: ${hundreds}/${cells}   (straight on the 100 was unreachable at all 101 power steps)`);
}
