// test.js: headless tests for the Nuts & Bolts engine (game.js + generator.js).
//
// Run with:  node js/test.js   (from the nuts-bolts/ folder)
//
// Exits with code 0 if every check passes, 1 otherwise. No UI / browser required.
// Array convention throughout: index 0 is the BOTTOM of a bolt's stack, the last
// index is the TOP (the end a player can select, move, or that gets revealed).

import { NutsBoltsGame, getTopRun } from './game.js';
import { generateLevel, replaySolutionBackward, isSolved, isBoltComplete, CAP } from './generator.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', msg);
  }
}
function colorsOf(stack) {
  return stack.map((n) => (n.hidden ? 'hidden:' + n.color : n.color));
}
function n(color, hidden, id) {
  return { color, hidden: !!hidden, id };
}

// Color-only solved check, ignoring hidden flags. This is what the
// reverse-scramble proof actually guarantees (a pure color-arrangement
// proof). A bolt the scramble never touched can end up with a leftover
// hidden nut after replay (replaySolutionBackward only reveals stacks it
// actually moves nuts through); that nut is still freely excavatable in
// real play (see engine test 4 and the WP1 tests: a bolt with a hidden nut
// is never locked, and every tier keeps E>=1 empty parking bolts in the
// solved arrangement), so it is not a solvability failure, just something
// the hidden-aware isSolved() correctly still calls incomplete.
function colorArrangementSolved(stacks) {
  return stacks.every((s) => s.length === 0 || (s.length === CAP && s.every((nut) => nut.color === s[0].color)));
}

function makeGame(stacks) {
  const initial = stacks.map((s) => s.map((nut) => ({ ...nut })));
  return new NutsBoltsGame('easy', 1, { difficulty: 'easy', stacks, initial, moves: 0, history: [], revealedIds: [] });
}

console.log('=== Nuts & Bolts engine: headless tests ===\n');

// --- 1. Known-stack move: exact resulting arrays (source and destination) ---
{
  const stacks = [
    [n('orange', false, 1), n('blue', false, 2), n('blue', false, 3)], // top run: blue x2
    [n('blue', false, 4)], // freeSpace 3, top blue
  ];
  const game = makeGame(stacks);
  const result = game.tryMove(0, 1);
  ok(result.legal === true, 'known move: reported legal');
  ok(result.count === 2, 'known move: moved count is 2 (min(run=2, freeSpace=3))');
  ok(
    JSON.stringify(colorsOf(game.stacks[0])) === JSON.stringify(['orange']),
    'known move: source left with exactly [orange], got ' + JSON.stringify(colorsOf(game.stacks[0]))
  );
  ok(
    JSON.stringify(colorsOf(game.stacks[1])) === JSON.stringify(['blue', 'blue', 'blue']),
    'known move: destination is exactly [blue,blue,blue] with the original bottom nut preserved at index 0, got ' +
      JSON.stringify(colorsOf(game.stacks[1]))
  );
}

// --- 2. Partial group move: destination has less space than the run length ---
{
  const stacks = [
    [n('yellow', false, 5), n('yellow', false, 6), n('yellow', false, 7)], // run length 3
    [n('yellow', false, 8), n('yellow', false, 9)], // freeSpace 2
  ];
  const game = makeGame(stacks);
  const result = game.tryMove(0, 1);
  ok(result.count === 2, 'partial move: moves min(run=3, freeSpace=2)=2');
  ok(
    JSON.stringify(colorsOf(game.stacks[0])) === JSON.stringify(['yellow']),
    'partial move: source keeps the one nut that did not fit, got ' + JSON.stringify(colorsOf(game.stacks[0]))
  );
  ok(
    game.stacks[1].length === CAP && game.stacks[1].every((nut) => nut.color === 'yellow'),
    'partial move: destination now full and single-color (locked)'
  );
}

// --- 3. Illegal moves are rejected without mutating state ---
{
  const stacks = [
    [n('orange', false, 1), n('orange', false, 2)],
    [n('blue', false, 3), n('blue', false, 4), n('blue', false, 5), n('blue', false, 6)], // full, locked
    [n('teal', false, 7)],
  ];
  const game = makeGame(stacks);
  const before = JSON.stringify(game.stacks.map(colorsOf));

  const r1 = game.tryMove(0, 1); // destination full (locked single-color)
  ok(r1.legal === false && r1.reason === 'That bolt is full', 'illegal: full destination reported full, got ' + r1.reason);

  const r2 = game.tryMove(0, 2); // color mismatch
  ok(r2.legal === false && r2.reason === "Colors don't match", 'illegal: mismatched color rejected, got ' + r2.reason);

  ok(JSON.stringify(game.stacks.map(colorsOf)) === before, 'illegal: board unchanged after rejected moves');
}

// --- 4. Hidden nut reveals the instant it becomes topmost, and undo does not re-hide it ---
{
  const stacks = [
    [n('teal', true, 10), n('purple', false, 11)], // hidden teal under a revealed purple
    [],
  ];
  const game = makeGame(stacks);
  game.tryMove(0, 1); // move purple off, exposing the hidden teal
  ok(
    game.stacks[0].length === 1 && game.stacks[0][0].color === 'teal' && game.stacks[0][0].hidden === false,
    'hidden reveal: exposed nut flips to hidden:false immediately, got ' + JSON.stringify(game.stacks[0])
  );

  game.undo();
  ok(
    game.stacks[0].length === 2 && game.stacks[0][0].hidden === false,
    'hidden reveal + undo: the nut stays revealed after undo restores the stack, got ' + JSON.stringify(colorsOf(game.stacks[0]))
  );
  ok(
    JSON.stringify(colorsOf(game.stacks[0])) === JSON.stringify(['teal', 'purple']),
    'hidden reveal + undo: undo exactly restores prior arrangement, got ' + JSON.stringify(colorsOf(game.stacks[0]))
  );
}

// --- 5. Restart re-hides hidden nuts (unlike undo) ---
{
  const stacks = [
    [n('teal', true, 20), n('purple', false, 21)],
    [],
  ];
  const game = makeGame(stacks);
  game.tryMove(0, 1);
  game.restart();
  ok(
    game.stacks[0][0].hidden === true,
    'restart: hidden nut is hidden again after restart, got hidden=' + game.stacks[0][0].hidden
  );
}

// --- 6. Win detection: only single-color full bolts (or empty) count ---
{
  const solved = [
    [n('blue', false, 1), n('blue', false, 2), n('blue', false, 3), n('blue', false, 4)],
    [],
    [n('orange', false, 5), n('orange', false, 6), n('orange', false, 7), n('orange', false, 8)],
  ];
  ok(isSolved(solved) === true, 'win detection: all-single-color-or-empty board reports solved');

  const notSolved = [
    [n('blue', false, 1), n('blue', false, 2), n('orange', false, 3), n('blue', false, 4)],
  ];
  ok(isSolved(notSolved) === false, 'win detection: mixed-color full bolt is not solved');

  const notFull = [[n('blue', false, 1)]];
  ok(isSolved(notFull) === false, 'win detection: a non-empty, non-full single-color bolt does not count as solved');
}

// --- 7. getTopRun matches the run game.js actually operates on ---
{
  const stack = [n('x'), n('x'), n('y'), n('y'), n('y')];
  const run = getTopRun(stack);
  ok(run.length === 3 && run.color === 'y', 'getTopRun: reports the maximal same-color run at the top, got ' + JSON.stringify(run));
}

// --- 8. WP1 repro: a buried hidden nut must block completion, lock, and win,
//        even though its true (data) color matches the rest of the bolt.
{
  // Bolt A: hidden nut whose true color is yellow, with a revealed yellow on
  // top of it (2 nuts, so it is not yet full). Bolt B: 2 more yellow.
  const stacks = [
    [n('yellow', true, 100), n('yellow', false, 101)],
    [n('yellow', false, 102), n('yellow', false, 103)],
  ];
  const game = makeGame(stacks);

  ok(
    isBoltComplete(game.stacks[0]) === false,
    'WP1 pre-move: a 2-nut bolt is not complete regardless of hidden status (sanity)'
  );

  const result = game.tryMove(1, 0); // B's 2 yellows onto A -> A becomes 4 data-yellow nuts, one still hidden
  ok(result.legal === true, 'WP1 repro: the filling move itself is legal');
  ok(
    game.stacks[0].length === CAP && game.stacks[0].every((nut) => nut.color === 'yellow'),
    'WP1 repro: bolt A is now full of 4 same-data-color nuts, sanity check'
  );
  ok(
    isBoltComplete(game.stacks[0]) === false,
    'WP1 repro: full+monocolor bolt with a still-hidden nut is NOT complete'
  );
  ok(result.won === false, 'WP1 repro: the move must not report a win');
  ok(isSolved(game.stacks) === false, 'WP1 repro: isSolved must not treat the board as solved');

  // The "locked" bolt must still be selectable as a SOURCE, so the player can
  // excavate the hidden nut rather than being softlocked.
  const selectResult = game.select(0);
  ok(
    selectResult.reason !== 'That bolt is locked',
    'WP1 repro: a full-but-incomplete bolt must remain selectable (excavation), got reason=' + selectResult.reason
  );
  game.deselect();

  // Now reveal it: move the top run off, exposing the hidden nut, which flips
  // to revealed. Rebuilding the stack should now correctly complete it.
  const stacks2 = [
    [n('yellow', true, 200), n('yellow', false, 201), n('yellow', false, 202), n('yellow', false, 203)],
    [],
  ];
  const game2 = makeGame(stacks2);
  ok(isBoltComplete(game2.stacks[0]) === false, 'WP1 excavate: full bolt with a buried hidden nut starts incomplete');

  game2.tryMove(0, 1); // move the top run (3 revealed yellows) off, exposing the hidden one
  ok(
    game2.stacks[0].length === 1 && game2.stacks[0][0].hidden === false,
    'WP1 excavate: the previously hidden nut is revealed once topmost, got ' + JSON.stringify(colorsOf(game2.stacks[0]))
  );

  game2.tryMove(1, 0); // rebuild the stack now that every nut is revealed
  ok(
    isBoltComplete(game2.stacks[0]) === true,
    'WP1 excavate: after reveal, rebuilding the stack now correctly completes it'
  );
  ok(isSolved(game2.stacks) === true, 'WP1 excavate: board is now solved');
}

console.log(`\nEngine checks: ${pass} passed, ${fail} failed.`);

// --- 8. Generator torture test: N runs per parameter row of all four tiers ---
console.log('\n=== Generator: solvability + integrity + quality-gate self-test ===\n');

const RUNS_PER_ROW = Number(process.env.NB_TEST_RUNS || 200);

// One representative level per row, matching the maxLevel breakpoints.
const ROW_LEVELS = {
  easy: [1, 4, 9, 16],
  medium: [1, 6, 16, 31],
  hard: [1, 6, 16],
  extraHard: [1, 6, 16],
};

let genRuns = 0;
let genFailures = 0;

for (const tier of Object.keys(ROW_LEVELS)) {
  for (const level of ROW_LEVELS[tier]) {
    let regenerated = 0;
    for (let i = 0; i < RUNS_PER_ROW; i++) {
      genRuns++;
      try {
        const lvl = generateLevel(tier, level);
        if (lvl.regenAttempts > 1) regenerated++;

        const counts = {};
        for (const stack of lvl.stacks) {
          for (const nut of stack) counts[nut.color] = (counts[nut.color] || 0) + 1;
        }
        for (const color of Object.keys(counts)) {
          if (counts[color] % CAP !== 0) {
            genFailures++;
            console.error(`FAIL: ${tier} L${level} run ${i}: color ${color} count ${counts[color]} not a multiple of ${CAP}`);
          }
        }

        const solved = replaySolutionBackward(lvl.stacks, lvl.solution);
        if (!colorArrangementSolved(solved)) {
          genFailures++;
          console.error(`FAIL: ${tier} L${level} run ${i}: replayed solution did not solve the board`);
        }

        if (lvl.stacks.some((s) => s.length > 0 && isBoltComplete(s))) {
          genFailures++;
          console.error(`FAIL: ${tier} L${level} run ${i}: a bolt is already complete at level start`);
        }

        const { F, E } = lvl.difficulty;
        if (lvl.stacks.length !== F + E) {
          genFailures++;
          console.error(`FAIL: ${tier} L${level} run ${i}: bolt count ${lvl.stacks.length} !== F+E ${F + E}`);
        }
      } catch (e) {
        genFailures++;
        console.error(`FAIL: ${tier} L${level} run ${i}: threw ${e.message}`);
      }
    }
    const regenRate = regenerated / RUNS_PER_ROW;
    const flag = regenRate > 0.3 ? '  <-- FLAG: regenerating >30% of the time' : '';
    console.log(`${tier} L${level}: ${RUNS_PER_ROW} runs, regenerated ${regenerated} (${(regenRate * 100).toFixed(0)}%)${flag}`);
  }
}

console.log(`\nGenerator checks: ${genRuns} runs, ${genFailures} failures.`);

const allOk = fail === 0 && genFailures === 0;
console.log(`\n=== Overall: ${allOk ? 'ALL PASS' : 'FAILURES PRESENT'} ===`);
process.exit(allOk ? 0 : 1);
