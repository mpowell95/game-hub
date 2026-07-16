// test.js: headless tests for the Nuts & Bolts engine (game.js + generator.js).
//
// Run with:  node js/test.js   (from the nuts-bolts/ folder)
//
// Exits with code 0 if every check passes, 1 otherwise. No UI / browser required.
// Array convention throughout: index 0 is the BOTTOM of a bolt's stack, the last
// index is the TOP (the end a player can select, move, or that gets revealed).

import { NutsBoltsGame, getTopRun } from './game.js';
import { generateLevel, replaySolutionBackward, isSolved, CAP } from './generator.js';

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

function makeGame(stacks) {
  const initial = stacks.map((s) => s.map((nut) => ({ ...nut })));
  return new NutsBoltsGame(1, { stacks, initial, moves: 0, history: [], revealedIds: [] });
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

console.log(`\nEngine checks: ${pass} passed, ${fail} failed.`);

// --- 8. Generator self-test: 200+ runs across every difficulty row ---
console.log('\n=== Generator: solvability + integrity self-test ===\n');

const testLevels = [1, 2, 3, 4, 6, 8, 9, 12, 15, 16, 20, 25, 26, 33, 40, 41, 55, 80];
const runsPerLevel = 12; // 18 levels * 12 = 216 runs
let genRuns = 0;
let genFailures = 0;

for (const level of testLevels) {
  for (let i = 0; i < runsPerLevel; i++) {
    genRuns++;
    try {
      const lvl = generateLevel(level);

      const counts = {};
      for (const stack of lvl.stacks) {
        for (const nut of stack) counts[nut.color] = (counts[nut.color] || 0) + 1;
      }
      for (const color of lvl.colorsUsed) {
        if (counts[color] !== CAP) {
          genFailures++;
          console.error(`FAIL: level ${level} run ${i}: color ${color} count ${counts[color]} !== ${CAP}`);
        }
      }

      const solved = replaySolutionBackward(lvl.stacks, lvl.solution);
      if (!isSolved(solved)) {
        genFailures++;
        console.error(`FAIL: level ${level} run ${i}: replayed solution did not solve the board`);
      }

      if (isSolved(lvl.stacks)) {
        genFailures++;
        console.error(`FAIL: level ${level} run ${i}: level started already solved`);
      }

      const { K, E } = lvl.difficulty;
      if (lvl.stacks.length !== K + E) {
        genFailures++;
        console.error(`FAIL: level ${level} run ${i}: bolt count ${lvl.stacks.length} !== K+E ${K + E}`);
      }
    } catch (e) {
      genFailures++;
      console.error(`FAIL: level ${level} run ${i}: threw ${e.message}`);
    }
  }
}

console.log(`Generator checks: ${genRuns} runs, ${genFailures} failures.`);

const allOk = fail === 0 && genFailures === 0;
console.log(`\n=== Overall: ${allOk ? 'ALL PASS' : 'FAILURES PRESENT'} ===`);
process.exit(allOk ? 0 : 1);
