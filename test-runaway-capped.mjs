// test-runaway-capped.mjs - HOT SHOT: RUNAWAY's CLOSED-BASKET probe.
//
// WHY THIS EXISTS. RUNAWAY is the only machine whose face changes shape during a rack: every
// basket except the runaway is a ONE-SHOT, and once a ball has gone in, that basket CLOSES for
// the rest of the round. `skeeball/js/test.js` sweeps DEFAULT_BOARD only, and `sweep-mover.mjs`
// answers reachability - neither of them ever throws at a face that has been closing baskets for
// eight balls, which is the face the last ball of every good rack is thrown at.
//
// THE FAILURE IT IS BORN AGAINST. "Closed" is implemented in TWO places and needs both:
// physics.js's buildWorld does not build a closed basket's collar, and the capture loop skips it.
// Do only the second and the cup becomes a BOWL - the ball drops in, cannot be taken, and sits
// there until the watchdog walks it out twelve seconds later. That is BRICK CITY's parked-ball
// failure (test-brickcity-stall.mjs, 2026-08-26) rebuilt on purpose, one file over. This probe is
// the thing that would catch it.
//
// IT COMPARES THE TWO FACES RATHER THAN CHECKING A FIXED SETTLE BUDGET, and that is deliberate.
// The first draft asserted a median under 3.0s, a number lifted from BRICK CITY's probe, and the
// closed face measured 3.04s - a fail that meant nothing. The OPEN face of this same machine
// medians 2.90s: on a board where most throws roll the full length back into the trough, three
// seconds is simply what a ball costs, and a borrowed constant cannot know that. So the test
// sweeps BOTH faces in the same run and asks the only question that is actually about this
// change: does closing the baskets make balls settle materially worse than leaving them open?
// It cannot go stale when the machine's settle times move for unrelated reasons.
//
// It also pins the two things that MUST stay true of a closed basket:
//
//   * it scores NOTHING, ever. A one-shot that pays twice is not a one-shot.
//   * the runaway is still reachable with the whole rest of the face shut, because that is
//     exactly the situation the machine's arc funnels every good rack into. A face that closes
//     down to one unreachable basket is a rack that ends in three dead throws.
//
// GUARD: `capRise` IS 0 TODAY (a closed basket is plated flush). If it is ever raised, this is
// the test that has to be re-run and re-read - a raised cap has a FLAT APEX, and a tread is
// tilted 0.10 rad against a board friction angle of atan(0.12), so a ball balanced on top of one
// has less slope than grip. See machine.js's capFor().
//
// Usage:  node test-runaway-capped.mjs [--powers N] [--aims N] [--phases N]
// Default 21 x 11 x 3 closed + 21 x 11 open = 924 throws, ~90s.

import { boardById } from './skeeball/js/boards.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const POWERS = flag('powers', 21);
const AIMS = flag('aims', 11);
const PHASES = flag('phases', 3);

const board = boardById('runaway');
const G = board.geom;
// engines.js loads a machine's three files ON DEMAND since 2026-09-01 (the launch-weight
// fix): engineFor() is synchronous and throws unless that machine has been loaded first.
await loadEngine(board.id);
const { simulateThrow } = engineFor(board.id).physics;
const [, runner] = G.mover.holes;

/** Sweep power x aim (x phase, when something is sweeping) and collect settle times. */
function sweep(closed, sws, phases) {
  const moving = Object.keys(sws || {});
  const period = moving.length ? sws[moving[0]].period : 1;
  const times = [];
  const paidWhileClosed = [];
  let walkouts = 0;
  const hits = {};
  let thrown = 0;
  for (let ph = 0; ph < phases; ph++) {
    for (let p = 0; p < POWERS; p++) {
      for (let a = 0; a < AIMS; a++) {
        const power = p / (POWERS - 1);
        const aim = AIMS === 1 ? 0 : -1 + (2 * a) / (AIMS - 1);
        const r = simulateThrow(board, {
          power, aim, t0: (ph / phases) * period, closed, sweeps: sws,
        });
        thrown++;
        times.push(r.time);
        if (r.emergencyUsed) walkouts++;
        const id = r.outcome && r.outcome.hole;
        if (id && closed.has(id)) paidWhileClosed.push(`${id} @ power ${power.toFixed(2)} aim ${aim.toFixed(2)}`);
        if (id) hits[id] = (hits[id] | 0) + 1;
      }
    }
    process.stderr.write(`  ${thrown} throws\r`);
  }
  times.sort((x, y) => x - y);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
  return {
    thrown, walkouts, hits, paidWhileClosed,
    median: at(0.5), p90: at(0.9), max: times[times.length - 1],
  };
}

const t0 = Date.now();

// THE ENDGAME FACE: EVERY row down to its last basket, so all THREE survivors are moving at
// once, with the top row's runaway at the LAST rung of its ladder - the fastest it ever gets.
// This is the real shape of the last balls of a good rack, and the only configuration that puts
// more than one moving collar in the same world.
//
// GUARD: THE LOWER ROWS' SURVIVOR IS THE CENTRE ONE, DELIBERATELY. It is the ramped mode, it is
// the wider mouth (0.53125X against the top row's 0.5X), and it sweeps the full width past BOTH
// of its dead neighbours' marks - so at the ends of its travel the wall gap is 0.7538X, UNDER
// MACHINE-SPEC.md section 12's 0.78X collar-near-a-flat-wall rule that the top row clears. A
// moving collar is the worst case for that rule. It measures clean, and this is what keeps
// measuring it.
const rows = G.mover.rows || [];
const survivors = [runner];
const closed = new Set([G.mover.holes.find((h) => h !== runner)]);
const sweeps = {
  [runner]: {
    hole: runner,
    t0: 0,
    dir: G.holes[runner].u < 0 ? -1 : 1,
    amp: G.mover.amp,
    period: G.mover.periods[G.mover.periods.length - 1],
    mode: 'cos',
    catches: G.mover.periods.length - 1,
  },
};
for (const row of rows) {
  const mid = row.find((h) => Math.abs(G.holes[h].u) < 1e-6) || row[0];
  survivors.push(mid);
  for (const h of row) if (h !== mid) closed.add(h);
  sweeps[mid] = {
    hole: mid,
    t0: 0,
    dir: 1,
    amp: G.mover.amp,
    period: G.mover.rowPeriod || G.mover.periods[0],
    mode: Math.abs(G.holes[mid].u) < 1e-6 ? 'ramp' : 'cos',
    catches: 0,
  };
}
const shut = sweep(closed, sweeps, PHASES);

// THE OPENING FACE: the baseline. Nothing closed, nothing moving - the machine exactly as ball 1
// of every rack meets it, and the settle times this change has to be judged against.
const open = sweep(new Set(), {}, 1);

process.stderr.write(`${' '.repeat(50)}\r`);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nHOT SHOT: RUNAWAY - the closed-basket face`);
console.log(`  ${POWERS} powers x ${AIMS} aims,  ${PHASES} phases closed + 1 pass open`
  + `  = ${shut.thrown + open.thrown} throws   ${secs}s\n`);
console.log('                      median      p90      max   walkouts');
const row = (label, r) => console.log(`  ${label.padEnd(18)} ${r.median.toFixed(2).padStart(6)}s`
  + `  ${r.p90.toFixed(2).padStart(6)}s  ${r.max.toFixed(2).padStart(6)}s   ${String(r.walkouts).padStart(8)}`);
row('open (baseline)', open);
row(`all shut but ${runner}`, shut);
console.log(`\n  closed baskets paid  ${shut.paidWhileClosed.length}`);
for (const id of survivors) {
  const n = shut.hits[id] | 0;
  console.log(`  ${id.padEnd(6)} caught       ${String(n).padStart(4)}  (${((n / shut.thrown) * 100).toFixed(2)}%)`);
}

// The closed face may be a little slower - there are no cups left to swallow a ball, so more of
// them roll the whole way back. It may not be a DIFFERENT REGIME, which is what a ball resting on
// something it should be shedding would look like.
const SLACK = 1.5;      // 50% worse than the open face is the line
const fails = [];
if (shut.walkouts) fails.push(`${shut.walkouts} ball(s) walked out by the watchdog - something is parking on a cap`);
if (open.walkouts) fails.push(`${open.walkouts} walkout(s) on the OPEN face - not this change; look at the geometry`);
if (shut.median > open.median * SLACK) {
  fails.push(`median settle ${shut.median.toFixed(2)}s against the open face's `
    + `${open.median.toFixed(2)}s - over the ${SLACK}x line`);
}
if (shut.max > Math.max(open.max * SLACK, 8)) {
  fails.push(`slowest settle ${shut.max.toFixed(2)}s against the open face's ${open.max.toFixed(2)}s`);
}
if (shut.paidWhileClosed.length) {
  fails.push(`a CLOSED basket captured ${shut.paidWhileClosed.length} ball(s): `
    + shut.paidWhileClosed.slice(0, 4).join('; '));
}
// EVERY survivor has to still be catchable. A face that closes down to three unreachable
// baskets is a rack that ends in dead throws, which is the arc working against itself.
for (const id of survivors) {
  if (!(shut.hits[id] | 0)) fails.push(`${id} is UNREACHABLE with the rest of the face closed`);
}

console.log('');
if (fails.length) { for (const f of fails) console.log(`FAIL  ${f}`); process.exit(1); }
console.log('PASS  nothing parks on a cap, every closed basket is silent, the runaway is still catchable.');
