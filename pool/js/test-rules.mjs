// test-rules.mjs — Phase 5 regression tripwires for the standard 8-ball
// ball-in-hand rule (spec §13.5 / HANDOFF-POOL-VISUAL-REBUILD.md §6.4):
// restricted to behind the head string ONLY for a scratch on the break;
// every other foul (including a later scratch) is ball-in-hand anywhere.
// Pure Node, synthetic `events` objects — rules.js only reads events.hits/
// events.pocketed/events.rails, never physics.js's actual simulation.
import * as rules from './rules.js';

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('ok    ' + msg);
  else { failures++; console.log('FAIL  ' + msg); }
}

function scratchEvents() {
  return { hits: [{ a: 'cue', b: 'b1' }], rails: 1, pocketed: ['cue'] };
}
function wrongBallFoulEvents() {
  // First contact is a stripe while seat 0's group is solids and table isn't open.
  return { hits: [{ a: 'cue', b: 'b9' }], rails: 1, pocketed: [] };
}

// ---- 1. Scratch on the break: restricted -------------------------------
{
  const g0 = rules.newGame();
  ok(g0.broken === false, 'newGame(): broken starts false');
  const { state: g1, outcome } = rules.resolveShot(g0, scratchEvents());
  ok(outcome.foul && outcome.foulReason === 'scratch', 'break scratch: recognized as a foul (scratch)');
  ok(g1.ballInHand === true, 'break scratch: ball-in-hand is true');
  ok(g1.headStringRestricted === true, 'break scratch: headStringRestricted is true (spec §13.5)');
  ok(g1.broken === true, 'break scratch: broken flips to true after the first shot');

  // ---- 2. A scratch on a LATER shot: NOT restricted ---------------------
  const { state: g2 } = rules.resolveShot(g1, scratchEvents());
  ok(g2.ballInHand === true, 'later scratch: ball-in-hand is true');
  ok(g2.headStringRestricted === false, 'later scratch: headStringRestricted is false (only the break scratch restricts)');
}

// ---- 3. A non-scratch foul on the break: NOT restricted -----------------
{
  const g0 = rules.newGame();
  const { state: g1 } = rules.resolveShot(g0, { hits: [], rails: 0, pocketed: [] }); // no contact at all, foul, no scratch
  ok(g1.ballInHand === true, 'break no-contact foul: ball-in-hand is true');
  ok(g1.headStringRestricted === false, 'break no-contact foul: headStringRestricted is false (must be a SCRATCH specifically)');
}

// ---- 4. A wrong-ball foul later in the game: NOT restricted --------------
{
  let g = rules.newGame();
  g = rules.resolveShot(g, { hits: [{ a: 'cue', b: 'b1' }], rails: 0, pocketed: ['b1'] }).state; // legal open-table pot, assigns groups
  ok(g.openTable === false && g.groups[0] === 'solid', 'group assignment happened as expected (test setup sanity)');
  const { state: g2, outcome } = rules.resolveShot(g, wrongBallFoulEvents());
  ok(outcome.foul && outcome.foulReason === 'wrong_ball', 'later wrong-ball contact: recognized as a foul');
  ok(g2.ballInHand === true && g2.headStringRestricted === false, 'later wrong-ball foul: ball-in-hand anywhere, not restricted');
}

// ---- 5. A clean, non-foul shot: no ball-in-hand at all -------------------
{
  const g0 = rules.newGame();
  const { state: g1 } = rules.resolveShot(g0, { hits: [{ a: 'cue', b: 'b1' }], rails: 0, pocketed: ['b1'] });
  ok(g1.ballInHand === false, 'clean legal pot: no ball-in-hand');
  ok(g1.headStringRestricted === false, 'clean legal pot: not restricted (nothing to restrict)');
}

console.log('');
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
