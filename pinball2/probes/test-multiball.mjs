// PIER NINE: THE 3-BALL SOAK. Build phase 5's gate, and the one thing the shipped build had
// written but never run.
//
// Multiball is the state where every invariant this engine rests on is under the most pressure at
// once: three balls in the same solver, two of them ADDED mid-game rather than served, contacts
// between a ball and geometry that another ball is also touching, and a drain rule that has to
// tell "one ball down, keep playing" from "last ball down, end it". None of the other probes ever
// puts a second ball on the table.
//
// It asserts what a soak can actually prove and nothing more: no ball leaves the machine, none is
// jammed, none goes NaN, none is stuck at the end of a run, and the ball-count bookkeeping in
// `rules.js` matches how many balls are really alive.
//
//   node pinball2/probes/test-multiball.mjs [runs] [seconds]

import { World } from '../machines/testbox/physics.js';
import { CONFIG } from '../machines/testbox/config.js';
import { makePierNine } from '../machines/testbox/tables/piernine.js';
import { createRules } from '../piernine/rules.js';
import { distToShape } from './checks.js';

const RUNS = Number(process.argv[2] || 30);
const SECS = Number(process.argv[3] || 25);
const cfg = CONFIG;

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`ok    ${msg}`); } else { fail++; console.log(`FAIL  ${msg}`); } };

const totals = {
  escapes: 0, jams: 0, broken: 0, rescues: 0,
  maxAlive: 0, drained: 0, endedEarly: 0, stuck: [], scores: [], countMismatch: 0,
  addRescues: 0, playRescues: 0,
};

for (let r = 0; r < RUNS; r++) {
  const table = makePierNine();
  const world = new World(table, cfg);
  const rules = createRules(world, table);
  rules.newGame();
  // VARY THE RUN. This engine is deterministic - no randomness anywhere - so eight identical
  // set-ups are one trajectory sampled eight times, which is not a soak, it is a unit test wearing
  // a soak's clothes. The first draft of this file scored exactly 313,760 in all eight runs and
  // that number is what gave it away. Each run gets a different plunge and a different robot
  // phase, so the three balls arrive somewhere different every time.
  const b0 = world.balls.find((b) => b.alive);
  if (b0) { b0.v.x += (r % 7 - 3) * 0.18; b0.v.y *= 1 + ((r % 5) - 2) * 0.05; }
  const phase = r % 13;
  // Straight to the state under test, through the game's own entry point.
  rules.startMultiball();
  // RESCUES AT THE ADD ARE A DIFFERENT QUESTION FROM RESCUES DURING PLAY, and the first draft of
  // this file conflated them: it read `world.rescues` at the END and blamed the whole count on the
  // placement. Adding a ball is a position write and it must land somewhere legal - that is what
  // this measures, one tick later. Rescues afterwards are the solver's own net catching a graze at
  // a junction, which the engine counts on purpose and does not call a failure.
  world.step(cfg.DT);
  rules.update();
  totals.addRescues += world.rescues;
  const baseRescues = world.rescues;

  const ticks = Math.round(SECS / cfg.DT);
  let sawThree = false;
  for (let k = 0; k < ticks; k++) {
    // A ROBOT, not a script: hold whichever bat the lowest live ball is nearest whenever any ball
    // is in the lower third, and let go 60 ms later. It is crude on purpose - the question is
    // whether the SOLVER survives three balls, not whether the robot is good.
    const live = world.balls.filter((b) => b.alive && !b.held && !b.ribbon);
    const low = live.filter((b) => b.p.y > 0.80).sort((a, b) => b.p.y - a.p.y)[0];
    if (low && (k + phase) % 16 === 0) {
      world.setFlipper(low.p.x < 0.2325 ? 'L' : 'R', true);
    } else if ((k + phase) % 16 === 8) {
      world.setFlipper('L', false);
      world.setFlipper('R', false);
    }
    world.step(cfg.DT);
    rules.update();
    const alive = world.balls.filter((b) => b.alive).length;
    if (alive >= 3) sawThree = true;
    totals.maxAlive = Math.max(totals.maxAlive, alive);
    // THE BOOKKEEPING, checked every tick rather than at the end: `rules.js` tracks how many balls
    // are in play so it can tell a multiball drain from the end of a ball, and a count that drifts
    // even for a moment is a ball that ends the ball early or one the game thinks is still out.
    if (rules.state.multiball > 1 && rules.state.multiball !== alive) totals.countMismatch++;
  }

  if (!sawThree) totals.endedEarly++;
  totals.escapes += world.escapes;
  totals.playRescues += world.rescues - baseRescues;
  totals.jams += world.jams;
  totals.broken += world.broken;
  totals.rescues += world.rescues;
  totals.scores.push(rules.state.score);
  for (const b of world.balls) {
    if (!b.alive || b.held || b.ribbon) continue;
    if (Math.hypot(b.v.x, b.v.y) >= 0.05) continue;
    // SOMETHING HAS TO BE HOLDING IT - the same call `restSweep` makes, and for the same reason.
    // Gravity here is a constant 1.111 m/s2, so a ball touching nothing is accelerating BY
    // DEFINITION: it is at the apex of an arc and the run happened to end there, not stuck. The
    // first draft of this file reported one of those as a trap, at (310, 856), touching nothing,
    // 27 mm clear of the raised bat it had just been thrown by.
    let held = null;
    for (const o of table.shapes) {
      if (o.kind === 'drain' || o.kind === 'ribbon' || o.kind === 'sensor' || o.down) continue;
      if (distToShape(o, b.p) < cfg.BALL_R + 0.002) { held = o.id; break; }
    }
    if (held) totals.stuck.push({ x: Math.round(b.p.x * 1000), y: Math.round(b.p.y * 1000), on: held });
  }
  totals.drained += world.balls.filter((b) => !b.alive).length;
}

const s = totals.scores.slice().sort((a, b) => a - b);
console.log(`\n${RUNS} multiballs x ${SECS}s: ${totals.drained} balls drained, `
  + `score p10/median/p90 ${s[Math.floor(RUNS * 0.1)]} / ${s[Math.floor(RUNS * 0.5)]} / ${s[Math.floor(RUNS * 0.9)]}`);
console.log(`escapes ${totals.escapes}  jams ${totals.jams}  broken ${totals.broken}  max alive ${totals.maxAlive}`);
console.log(`rescues: ${totals.addRescues} at the add, ${totals.playRescues} during ${RUNS * SECS}s of three-ball play`
  + ` (the solver's net catching a graze - counted, never hidden, and not a failure)\n`);

ok(totals.escapes === 0, `no ball left the machine (${totals.escapes})`);
ok(totals.broken === 0, `no ball's position stopped being a number (${totals.broken})`);
ok(totals.jams === 0, `no ball exhausted the contact budget (${totals.jams})`);
ok(totals.maxAlive === 3, `three balls really were in play at once (max ${totals.maxAlive})`);
ok(totals.endedEarly === 0, `every run reached three balls (${totals.endedEarly} did not)`);
ok(totals.countMismatch === 0, `the game's ball count never disagreed with how many were alive (${totals.countMismatch} ticks)`);
ok(totals.addRescues === 0, `no ball was ADDED inside a collider (${totals.addRescues} rescues on the first tick)`);
ok(new Set(totals.scores).size > 1, `the runs were not all the same trajectory (${new Set(totals.scores).size} distinct scores)`);
ok(totals.stuck.length === 0, `nothing was held still at the end of a run (${totals.stuck.length}: `
  + `${totals.stuck.slice(0, 4).map((p) => `(${p.x},${p.y}) on ${p.on}`).join(' ')})`);
// A soak is a SAMPLE and this line is the honest caveat, not a footnote: it proves these runs were
// clean, not that multiball is. `restSweep` and `escapeProbe` are the ones that do not sample.
console.log(`\nMultiball soak: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
