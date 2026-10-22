// sweep-mover.mjs - REACHABILITY ON A MACHINE WITH A MOVING PART.
//
// MACHINE-SPEC.md section 19: a new board's reachability is not tested automatically, so you
// sweep it yourself - every hole must be capturable somewhere in the input space with no
// watchdog walkouts. On every machine before HOT SHOT: RUNAWAY that space was two-dimensional
// (power x aim) and skeeball/js/test.js's 41x21 grid covered it.
//
// A MOVING BASKET ADDS A THIRD AXIS AND IT IS NOT OPTIONAL. The same (power, aim) lands
// somewhere different depending on where the basket is when the ball leaves the ramp, so a
// two-axis sweep measures ONE arbitrary phase of the sweep and will report the moving 100 as
// unreachable or as trivial at random, depending on which phase it happened to freeze. This tool
// walks power x aim x PHASE and reports:
//
//   * every hole that was captured at least once, and how often  (reachability)
//   * watchdog walkouts, as a share of all throws                (the jam budget - the number
//     POPONGO's first draft failed at 12%, and BRICK CITY's first row-1 size failed at 12.89%)
//   * the slowest settle against physics.js's 12s emergency cap
//   * for the mover specifically: WHICH PHASES score it, so "reachable" can be told apart from
//     "reachable only at the two instants it is stationary at the ends of its travel"
//
// Usage:  node sweep-mover.mjs [boardId] [--powers N] [--aims N] [--phases N] [--full]
// Default is a 21 x 11 x 8 grid (1,848 throws, ~1 min). --full is 41 x 21 x 12 (10,332).
// Runs on any board; on one with no `geom.mover` the phase axis collapses to a single pass.

import { boardById, BOARDS } from './skeeball/js/boards.js';
import { engineFor } from './skeeball/js/engines.js';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const full = argv.includes('--full');
const boardId = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'runaway';
const board = boardById(boardId);
if (board.id !== boardId) {
  console.error(`no board '${boardId}'. Have: ${BOARDS.map((b) => b.id).join(', ')}`);
  process.exit(1);
}

const POWERS = flag('powers', full ? 41 : 21);
const AIMS = flag('aims', full ? 21 : 11);
const mover = board.geom.mover || null;
// Phases are sampled over ONE FULL PERIOD. A half period would look like it covered the travel
// (the sine is symmetric) but every sample would be taken with the basket moving the SAME
// direction, and a basket sweeping toward the ball is not the same shot as one sweeping away.
const PHASES = mover ? flag('phases', full ? 12 : 8) : 1;

const { simulateThrow } = engineFor(board.id).physics;

const holes = Object.keys(board.geom.holes);
const hits = new Map(holes.map((h) => [h, 0]));
const moverHits = [];               // phase index -> count, for the mover only
let thrown = 0;
let emergencies = 0;
let slowest = 0;
let scored = 0;
let points = 0;

const t0 = Date.now();
for (let ph = 0; ph < PHASES; ph++) {
  const phase = mover ? (ph / PHASES) * mover.period : 0;
  let atThisPhase = 0;
  for (let p = 0; p < POWERS; p++) {
    for (let a = 0; a < AIMS; a++) {
      const power = p / (POWERS - 1);
      const aim = AIMS === 1 ? 0 : -1 + (2 * a) / (AIMS - 1);
      const r = simulateThrow(board, { power, aim, t0: phase });
      thrown++;
      if (r.emergencyUsed) emergencies++;
      slowest = Math.max(slowest, r.time);
      const id = r.outcome && r.outcome.hole;
      if (id && hits.has(id)) {
        hits.set(id, hits.get(id) + 1);
        scored++;
        points += r.outcome.value | 0;
        if (mover && id === mover.hole) atThisPhase++;
      }
    }
  }
  moverHits.push(atThisPhase);
  process.stderr.write(`  phase ${ph + 1}/${PHASES} done (${thrown} throws)\r`);
}
process.stderr.write(' '.repeat(50) + '\r');

const cells = POWERS * AIMS;
console.log(`\n${board.name}  (${board.id})`);
console.log(`grid  ${POWERS} powers x ${AIMS} aims x ${PHASES} phases = ${thrown} throws`
  + `   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (mover) {
  console.log(`mover ${mover.hole}  amp ${(mover.amp / (1 / 6.875)).toFixed(3)}X  period ${mover.period}s`
    + `  peak ${(mover.amp * 2 * Math.PI / mover.period).toFixed(3)} m/s`);
}

console.log('\nCAPTURES PER HOLE');
let unreachable = [];
for (const id of holes) {
  const n = hits.get(id);
  const pct = ((n / thrown) * 100).toFixed(2);
  const tag = mover && id === mover.hole ? '  <- MOVING' : '';
  console.log(`  ${id.padEnd(6)} ${String(n).padStart(5)}  ${pct.padStart(6)}%${tag}`);
  if (!n) unreachable.push(id);
}

if (mover) {
  console.log('\nTHE MOVING BASKET, BY PHASE  (captures per phase, out of '
    + `${cells} cells each)`);
  const wide = Math.max(1, ...moverHits);
  moverHits.forEach((n, i) => {
    const at = (i / PHASES) * mover.period;
    const u = mover.amp * Math.sin((2 * Math.PI * at) / mover.period);
    const bar = '#'.repeat(Math.round((n / wide) * 28));
    console.log(`  t=${at.toFixed(2)}s  u=${(u >= 0 ? '+' : '') + u.toFixed(3)}m  `
      + `${String(n).padStart(4)}  ${bar}`);
  });
  const dead = moverHits.filter((n) => !n).length;
  console.log(dead
    ? `  ${dead}/${PHASES} phases score it NEVER - the shot exists only in part of the sweep.`
    : `  every phase scores it: the 100 is catchable wherever the basket is, not just at the ends.`);
}

const emPct = (emergencies / thrown) * 100;
console.log('\nTOTALS');
console.log(`  scored            ${scored}/${thrown}  (${((scored / thrown) * 100).toFixed(2)}%)`);
console.log(`  points            ${points}  (mean ${(points / thrown).toFixed(1)}/throw)`);
console.log(`  watchdog walkouts ${emergencies}  (${emPct.toFixed(2)}%)`);
console.log(`  slowest settle    ${slowest.toFixed(2)}s  (cap 12s)`);

// PASS/FAIL. The two numbers that have actually failed a real build in this repo: a hole nothing
// can reach, and a jam rate (POPONGO 12%, BRICK CITY's first row-1 size 12.89%). 1% is the budget
// - well under both, well over the 0 the static machines measure.
const fails = [];
if (unreachable.length) fails.push(`UNREACHABLE: ${unreachable.join(', ')}`);
if (emPct > 1) fails.push(`jam rate ${emPct.toFixed(2)}% over the 1% budget`);
if (slowest > 12) fails.push(`settle ${slowest.toFixed(2)}s past the 12s cap`);
console.log('');
if (fails.length) { for (const f of fails) console.log(`FAIL  ${f}`); process.exit(1); }
console.log('PASS  every hole reachable, jams within budget, every ball settled.');
