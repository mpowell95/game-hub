// sweep-mover.mjs - REACHABILITY ON A MACHINE WITH A MOVING PART AND A FACE THAT CHANGES SHAPE.
//
// MACHINE-SPEC.md section 19: a new board's reachability is not tested automatically, so you
// sweep it yourself - every hole must be capturable somewhere in the input space with no watchdog
// walkouts. On every machine before HOT SHOT: RUNAWAY that space was two-dimensional (power x
// aim) and skeeball/js/test.js's 41x21 grid covered it.
//
// RUNAWAY BREAKS THAT IN TWO WAYS, AND NEITHER IS OPTIONAL TO MEASURE:
//
//   1. A MOVING BASKET ADDS A PHASE AXIS. The same (power, aim) lands somewhere different
//      depending on where the basket is when the ball leaves the ramp, so a two-axis sweep
//      measures ONE arbitrary phase and will report the moving 100 as unreachable or as trivial
//      at random, depending on which phase it froze.
//   2. THE FACE IS DIFFERENT ON BALL 1 AND ON BALL 9. The rack starts with two STILL 100s and a
//      full set of open baskets; by the end one 100 is sweeping (faster every catch) and the rest
//      have closed. Those are different machines and each has to be swept as one.
//
// So this tool sweeps a STAGE of a rack, not "the board":
//
//   --stage open     every basket still, nothing closed        (ball 1 - the default)
//   --stage run      one 100 capped, the other sweeping        (with --rung N for the ladder)
//   --stage rows     a lower row down to its LAST basket, which is therefore sweeping
//   --stage endgame  every row down to one, so THREE baskets are moving at once
//   --ladder         run `run` at EVERY rung of geom.mover.periods and print the curve
//
// It reports, per stage:
//
//   * every hole captured at least once, and how often          (reachability)
//   * watchdog walkouts as a share of all throws                (the jam budget - the number
//     POPONGO's first draft failed at 12%, BRICK CITY's first row-1 size at 12.89%)
//   * the slowest settle against physics.js's 12s emergency cap
//   * for the runaway: WHICH PHASES score it, so "reachable" can be told apart from "reachable
//     only at the two instants it is stationary at the ends of its travel"
//
// GUARD: --ladder IS THE ONLY HONEST WAY TO TALK ABOUT THE ESCALATION. A shorter period does NOT
// simply mean harder: during the ball's ~0.45s flight a faster basket sweeps through MORE
// positions, so more (power, aim) pairs coincide with it on arrival - measured, 7s -> 6s bought
// 70% MORE catching cells. Pushing back the other way is the relative-velocity capture rule: a
// fast rim means a fast crossing speed, and a ball that cannot fall past the lip in the time it
// takes to cross the mouth rattles out. Where those two cross is an empirical question. Never
// state which way a rung moved the difficulty without running this.
//
// Usage:  node sweep-mover.mjs [boardId] [--stage open|run|endgame] [--rung N] [--ladder]
//                              [--powers N] [--aims N] [--phases N] [--full]
// Default is a 21 x 11 x 8 grid (1,848 throws, ~1 min). --full is 41 x 21 x 12 (10,332).
// On a board with no `geom.mover` the phase axis collapses to a single pass and stages are moot.

import { boardById, BOARDS } from './skeeball/js/boards.js';
import { sweepU } from './skeeball/js/machines/runaway/machine.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';

const X = 1.00 / 6.875;

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const str = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const full = argv.includes('--full');
const ladder = argv.includes('--ladder');
const STAGES = ['open', 'run', 'rows', 'endgame'];
const stageArg = str('stage', ladder ? 'run' : 'open');
if (!STAGES.includes(stageArg)) {
  console.error(`--stage must be one of: ${STAGES.join(', ')}`);
  process.exit(1);
}
const known = new Set(BOARDS.map((b) => b.id));
const boardId = argv.find((a) => !a.startsWith('--') && known.has(a)) || 'runaway';
const board = boardById(boardId);

const POWERS = flag('powers', full ? 41 : 21);
const AIMS = flag('aims', full ? 21 : 11);
const mover = board.geom.mover || null;
const PERIODS = (mover && mover.periods) || [6];
// Phases are sampled over ONE FULL PERIOD. A half period would look like it covered the travel
// (the curve is symmetric) but every sample would be taken with the basket moving the SAME
// direction, and a basket sweeping toward the ball is not the same shot as one sweeping away.
const PHASES = mover ? flag('phases', full ? 12 : 8) : 1;

// engines.js loads a machine's three files ON DEMAND since 2026-09-01 (the launch-weight
// fix): engineFor() is synchronous and throws unless that machine has been loaded first.
await loadEngine(board.id);
const { simulateThrow } = engineFor(board.id).physics;
const allHoles = Object.keys(board.geom.holes);

/** One sweep record for a basket that has just become the last one standing in its row.
 *
 *  GUARD: THE MODE IS NOT A CHOICE. An OUTER basket rests at +/-amp, an end of the travel, so a
 *  cosine starts it on its own mark at zero velocity. A CENTRE basket rests at 0, which no cosine
 *  can start from, so it gets machine.js's ramped sine. game.js picks the same way; a tool that
 *  picked differently would be measuring a machine nobody plays. */
function sweepFor(id, period, catches) {
  const u = board.geom.holes[id].u;
  const outer = Math.abs(u) > 1e-6;
  return {
    hole: id,
    t0: 0,
    dir: outer ? (u < 0 ? -1 : 1) : 1,
    amp: mover.amp,
    period,
    mode: outer ? 'cos' : 'ramp',
    catches: catches | 0,
  };
}

/** The rack state for one stage: which baskets have closed, and which are sweeping.
 *  `rung` indexes geom.mover.periods - the number of times the runaway has already been caught. */
function stateFor(stage, rung) {
  if (!mover) return { closed: new Set(), sweeps: {}, run: null };
  const [capped, runner] = mover.holes;          // cap the LEFT one; the right one runs
  const period = PERIODS[Math.min(rung, PERIODS.length - 1)];
  const rowPeriod = mover.rowPeriod || PERIODS[0];
  const rows = mover.rows || [];
  if (stage === 'open') return { closed: new Set(), sweeps: {}, run: null };

  // A LOWER ROW down to its last basket. The CENTRE one is chosen deliberately: it is the ramped
  // mode, the wider mouth, and it sweeps the full width past both of its dead neighbours' marks -
  // the hardest case this machine has for the collar-near-a-rail rule.
  if (stage === 'rows') {
    const row = rows[0] || [];
    const survivor = row.find((h) => Math.abs(board.geom.holes[h].u) < 1e-6) || row[row.length - 1];
    const closed = new Set(row.filter((h) => h !== survivor));
    return { closed, sweeps: { [survivor]: sweepFor(survivor, rowPeriod, 0) }, run: survivor };
  }

  const closed = new Set([capped]);
  const sweeps = { [runner]: sweepFor(runner, period, rung) };
  if (stage === 'endgame') {
    // EVERY row down to one, so all three survivors are moving at once - the real shape of the
    // last balls of a good rack, and the only configuration that exercises more than one moving
    // collar in the same world.
    for (const row of rows) {
      const survivor = row.find((h) => Math.abs(board.geom.holes[h].u) < 1e-6) || row[0];
      for (const h of row) if (h !== survivor) closed.add(h);
      sweeps[survivor] = sweepFor(survivor, rowPeriod, 0);
    }
  }
  return { closed, sweeps, run: runner };
}

/** Sweep power x aim x phase at one rack state. */
function sweepStage(state, label) {
  const hits = new Map(allHoles.map((h) => [h, 0]));
  const byPhase = [];
  let thrown = 0; let emergencies = 0; let slowest = 0; let scored = 0; let points = 0;
  const moving = Object.keys(state.sweeps || {});
  const period = state.run && state.sweeps[state.run] ? state.sweeps[state.run].period : PERIODS[0];
  const t0 = Date.now();
  for (let ph = 0; ph < PHASES; ph++) {
    // The phase axis is only meaningful while something is sweeping; with a still face every
    // pass would be identical, so collapse it to one.
    if (!moving.length && ph > 0) break;
    const phase = moving.length ? (ph / PHASES) * period : 0;
    let atThisPhase = 0;
    for (let p = 0; p < POWERS; p++) {
      for (let a = 0; a < AIMS; a++) {
        const power = p / (POWERS - 1);
        const aim = AIMS === 1 ? 0 : -1 + (2 * a) / (AIMS - 1);
        const r = simulateThrow(board, {
          power, aim, t0: phase, closed: state.closed, sweeps: state.sweeps,
        });
        thrown++;
        if (r.emergencyUsed) emergencies++;
        slowest = Math.max(slowest, r.time);
        const id = r.outcome && r.outcome.hole;
        if (id && hits.has(id)) {
          hits.set(id, hits.get(id) + 1);
          scored++;
          points += r.outcome.value | 0;
          if (state.run && id === state.run) atThisPhase++;
        }
      }
    }
    byPhase.push(atThisPhase);
    process.stderr.write(`  ${label}: phase ${ph + 1}/${PHASES} (${thrown} throws)\r`);
  }
  process.stderr.write(`${' '.repeat(60)}\r`);
  return { hits, byPhase, thrown, emergencies, slowest, scored, points, secs: (Date.now() - t0) / 1000 };
}

const cells = POWERS * AIMS;
console.log(`\n${board.name}  (${board.id})`);
console.log(`grid  ${POWERS} powers x ${AIMS} aims x ${PHASES} phases   ${cells} cells per phase`);
if (mover) {
  console.log(`top   ${mover.holes.join(' / ')}   amp ${(mover.amp / X).toFixed(3)}X`
    + `   ladder ${PERIODS.join('s -> ')}s`);
  if (mover.rows) {
    console.log(`rows  ${mover.rows.map((r) => r.join('/')).join('   ')}   last one standing`
      + `, ${mover.rowPeriod}s`);
  }
}

const fails = [];

if (ladder) {
  // ---- THE ESCALATION CURVE -------------------------------------------------------------------
  console.log('\nTHE LADDER  (one 100 capped, the other sweeping; catching cells per rung)\n');
  console.log('  rung  period  peak m/s   catches      share   jams   slowest');
  const rows = [];
  for (let rung = 0; rung < PERIODS.length; rung++) {
    const st = stateFor('run', rung);
    const r = sweepStage(st, `rung ${rung}`);
    const n = r.hits.get(st.run);
    const per = st.sweeps[st.run].period;
    const peak = (mover.amp * 2 * Math.PI) / per;
    const jam = (r.emergencies / r.thrown) * 100;
    rows.push({ rung, period: per, peak, n, thrown: r.thrown, jam, slowest: r.slowest });
    console.log(`  ${String(rung).padStart(4)}  ${per.toFixed(1).padStart(6)}`
      + `  ${peak.toFixed(3).padStart(8)}   ${String(n).padStart(7)}`
      + `  ${((n / r.thrown) * 100).toFixed(2).padStart(8)}%`
      + `  ${jam.toFixed(1).padStart(4)}%  ${r.slowest.toFixed(2).padStart(7)}s`);
    if (!n) fails.push(`rung ${rung} (${per}s): the runaway is UNREACHABLE`);
    if (jam > 1) fails.push(`rung ${rung}: jam rate ${jam.toFixed(2)}% over the 1% budget`);
    if (r.slowest > 12) fails.push(`rung ${rung}: settle ${r.slowest.toFixed(2)}s past the 12s cap`);
  }
  const first = rows[0].n;
  const last = rows[rows.length - 1].n;
  console.log(`\n  rung 0 -> rung ${rows.length - 1}: ${first} -> ${last} catching cells`
    + `  (${last === first ? 'flat' : last < first ? `${(((first - last) / first) * 100).toFixed(0)}% HARDER` : `${(((last - first) / first) * 100).toFixed(0)}% EASIER`})`);
  console.log('  Read this before claiming the escalation makes the shot harder. A faster basket');
  console.log('  is a bigger target in TIME; only the relative-velocity capture rule pushes back.');
} else {
  // ---- ONE STAGE ------------------------------------------------------------------------------
  const rung = flag('rung', 0);
  const state = stateFor(stageArg, rung);
  const movingIds = Object.keys(state.sweeps || {});
  console.log(`stage ${stageArg}`
    + (movingIds.length
      ? `   moving: ${movingIds.map((h) => `${h}@${state.sweeps[h].period}s/${state.sweeps[h].mode}`).join(', ')}`
      : '   nothing moving')
    + (state.closed.size ? `   closed: ${[...state.closed].join(', ')}` : '   nothing closed'));
  const r = sweepStage(state, stageArg);
  console.log(`\n${r.thrown} throws in ${r.secs.toFixed(1)}s`);

  console.log('\nCAPTURES PER HOLE');
  for (const id of allHoles) {
    const n = r.hits.get(id);
    const pct = ((n / r.thrown) * 100).toFixed(2);
    const tag = state.sweeps[id] ? '  <- MOVING' : state.closed.has(id) ? '  (closed)' : '';
    console.log(`  ${id.padEnd(6)} ${String(n).padStart(5)}  ${pct.padStart(6)}%${tag}`);
    // GUARD: a CLOSED basket is SUPPOSED to score nothing, so it is not an unreachability failure
    // - it is the one-shot rule working. Anything else scoring zero is a real failure.
    if (!n && !state.closed.has(id)) fails.push(`UNREACHABLE: ${id}`);
    if (n && state.closed.has(id)) fails.push(`CLOSED BASKET STILL CAPTURING: ${id} took ${n} balls`);
  }

  if (state.run && state.sweeps[state.run]) {
    const sw = state.sweeps[state.run];
    console.log(`\nTHE MOVING BASKET ${state.run}, BY PHASE  (captures per phase, out of ${cells} cells each)`);
    const wide = Math.max(1, ...r.byPhase);
    r.byPhase.forEach((n, i) => {
      const at = (i / PHASES) * sw.period;
      const u = sweepU(sw, at);
      const bar = '#'.repeat(Math.round((n / wide) * 28));
      console.log(`  t=${at.toFixed(2)}s  u=${(u >= 0 ? '+' : '') + u.toFixed(3)}m  `
        + `${String(n).padStart(4)}  ${bar}`);
    });
    const dead = r.byPhase.filter((n) => !n).length;
    console.log(dead
      ? `  ${dead}/${PHASES} phases score it NEVER - but see the classic's corner 100s: a hole is`
        + '\n  not unreachable until a FINE sweep says so. Re-probe those phases with --aims 41.'
      : '  every phase scores it: the 100 is catchable wherever the basket is, not only at the ends.');
  }

  const emPct = (r.emergencies / r.thrown) * 100;
  console.log('\nTOTALS');
  console.log(`  scored            ${r.scored}/${r.thrown}  (${((r.scored / r.thrown) * 100).toFixed(2)}%)`);
  console.log(`  points            ${r.points}  (mean ${(r.points / r.thrown).toFixed(1)}/throw)`);
  console.log(`  watchdog walkouts ${r.emergencies}  (${emPct.toFixed(2)}%)`);
  console.log(`  slowest settle    ${r.slowest.toFixed(2)}s  (cap 12s)`);
  if (emPct > 1) fails.push(`jam rate ${emPct.toFixed(2)}% over the 1% budget`);
  if (r.slowest > 12) fails.push(`settle ${r.slowest.toFixed(2)}s past the 12s cap`);
}

console.log('');
if (fails.length) { for (const f of fails) console.log(`FAIL  ${f}`); process.exit(1); }
console.log('PASS  every open hole reachable, every closed hole silent, jams within budget.');
