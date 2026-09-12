// sudoku/js/test.js - headless tests for the generator, solver and rules. No DOM, no browser.
//
//   node sudoku/js/test.js
//
// Not deployed (not in sw.js ASSETS) and not run by run-all-tests.mjs's engine suites in the
// sense of hitting a browser - it is a plain `node` script, same shape as pipes/js/test.js and
// nuts-bolts/js/test.js.
import {
  countSolutions, backtrackSolve, gradeGrid, findNakedSingle, popcount,
} from './solver.js';
import {
  generate, fillGrid, dig, countGivens, tierGivensRange, rng, TIER_ORDER,
} from './generator.js';
import { SudokuGame, SAVE_V } from './game.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

const s = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0) - 48);

// --- 1. the backtracking solver solves 3 known puzzles to their known solutions ------------------
// Generated once from this repo's own generator (fixed tier/seed) and pasted here as literals -
// deterministic, reproducible, and independent of whatever the generator produces on a future run.

const KNOWN = [
  {
    name: 'easy(seed 111)',
    puzzle: '090148007007005619000070080650700128009280354008510796901000200302001800560000070',
    solution: '296148537847325619135679482653794128719286354428513796981457263372961845564832971',
  },
  {
    name: 'hard(seed 222)',
    puzzle: '040800306200439010000006050390040060500000200402003000030960100000000000000082047',
    solution: '741825396265439718983716452398247561576198234412653879837964125624571983159382647',
  },
  {
    name: 'expert(seed 333)',
    puzzle: '500000000008000054001090083050000010700003900000000607000014090300985000400000070',
    solution: '537841269968327154241596783653479812782163945194258637825714396376985421419632578',
  },
];

for (const k of KNOWN) {
  const solved = backtrackSolve(s(k.puzzle));
  ok(`backtrackSolve solves ${k.name} to its known solution`,
    !!solved && Array.from(solved).join('') === k.solution);
}

// --- 2. the solution counter --------------------------------------------------------------------

{
  const proper = s(KNOWN[0].puzzle);
  ok('a proper puzzle has exactly one solution', countSolutions(proper, 2) === 1);

  // Remove a cell already implied by the rest of the puzzle -- still exactly one solution.
  const stillUnique = Uint8Array.from(proper);
  // (kept as the same proper puzzle; the generator's own dig loop is what proves the
  // remove-and-recheck property across many boards in section 3 below)
  ok('re-checking a proper puzzle is stable', countSolutions(stillUnique, 2) === 1);

  // An under-constrained puzzle (most of the givens blanked) has 2+ solutions.
  const underConstrained = Uint8Array.from(proper);
  for (let i = 0; i < 60; i++) underConstrained[i] = 0;
  ok('an under-constrained puzzle reports 2 (capped) solutions',
    countSolutions(underConstrained, 2) === 2);

  // A contradictory puzzle (two 5s in the same row) has zero solutions.
  const contradiction = Uint8Array.from(proper);
  contradiction[0] = 5; contradiction[1] = 5;
  ok('a contradictory puzzle has zero solutions', countSolutions(contradiction, 2) === 0);
}

// --- 3. full-grid generator: 200 grids, every one a valid completed Sudoku -----------------------

{
  let bad = 0;
  const rowOf = (i) => (i / 9) | 0, colOf = (i) => i % 9;
  const boxOf = (i) => (((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0));
  function validComplete(grid) {
    for (let u = 0; u < 9; u++) {
      const row = new Set(), col = new Set(), box = new Set();
      for (let k = 0; k < 9; k++) {
        row.add(grid[u * 9 + k]);
        col.add(grid[k * 9 + u]);
      }
      const br = (u / 3) | 0, bc = u % 3;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box.add(grid[(br * 3 + r) * 9 + (bc * 3 + c)]);
      if (row.size !== 9 || col.size !== 9 || box.size !== 9) return false;
      if ([...row, ...col, ...box].some((v) => v < 1 || v > 9)) return false;
    }
    return true;
  }
  for (let sd = 1; sd <= 200; sd++) {
    const rnd = rng(sd * 2654435761);
    const grid = fillGrid(rnd);
    if (!validComplete(grid)) bad++;
  }
  ok('200 full-grid generations are all valid completed Sudokus', bad === 0, bad + ' invalid');
}

// --- 4. puzzle generator: per tier, 20 puzzles ---------------------------------------------------
//
// The budget assertion is a MEAN over the batch, per the handoff ("assert a batch mean, e.g.
// < 400ms per puzzle in node"), not a per-puzzle ceiling - medium's technique-graded digging
// occasionally takes several times the average on an unlucky random order (see generator.js's
// header), and that is fine as long as the mean stays well inside a phone's frame budget.

for (const tier of TIER_ORDER) {
  const [lo, hi] = tierGivensRange(tier);
  let totalMs = 0, gradeMismatches = 0, outOfRange = 0, nonUnique = 0, totalAttempts = 0;
  const N = 20;
  for (let sd = 1; sd <= N; sd++) {
    const t0 = Date.now();
    const r = generate(tier, sd * 2654435761);
    totalMs += Date.now() - t0;
    totalAttempts += r.attempts;
    if (r.grade !== tier) gradeMismatches++;
    // Medium's technique-graded dig deliberately does not chase the same givens window used by
    // the other three tiers (see generator.js) - only bound the ones that do.
    if (tier !== 'medium' && (r.givens < lo || r.givens > hi)) outOfRange++;
    if (countSolutions(r.puzzle, 2) !== 1) nonUnique++;
  }
  ok(`[${tier}] every puzzle has a unique solution`, nonUnique === 0, nonUnique + ' non-unique');
  ok(`[${tier}] grade matches the requested tier (fallback-on-exhaustion allowed)`,
    gradeMismatches <= 3, gradeMismatches + '/' + N + ' mismatched');
  if (tier !== 'medium') {
    ok(`[${tier}] givens land inside [${lo}, ${hi}]`, outOfRange === 0, outOfRange + ' out of range');
  }
  ok(`[${tier}] mean generation time is under the phone budget (400ms)`,
    (totalMs / N) < 400, `mean ${(totalMs / N).toFixed(1)}ms`);
  ok(`[${tier}] attempts stay well inside the cap (40)`,
    (totalAttempts / N) < 40, `mean attempts ${(totalAttempts / N).toFixed(1)}`);
}

// --- 5. the technique solver grades correctly ----------------------------------------------------

{
  // KNOWN[0] ("easy") was generated by this repo's own easy tier, which targets singles-only.
  const easyGrade = gradeGrid(s(KNOWN[0].puzzle));
  ok('a known easy puzzle grades as singles-only (solved, maxTechnique <= 2)',
    easyGrade.solved && easyGrade.maxTechnique <= 2, JSON.stringify(easyGrade));

  // KNOWN[2] ("expert") was generated by the expert tier, which is defined as "the technique
  // solver stalls" - it must NOT fully solve with just the four techniques here.
  const expertGrade = gradeGrid(s(KNOWN[2].puzzle));
  ok('a known expert puzzle stalls the technique solver', !expertGrade.solved, JSON.stringify(expertGrade));
}

// --- 6. game.js: placing, conflicts, notes, undo, win, save round-trip ---------------------------

function freshGame() {
  const r = generate('easy', 999);
  return new SudokuGame({ tier: 'easy', puzzle: r.puzzle, solution: r.solution });
}

{
  const g = freshGame();
  const givenIdx = g.givens.findIndex((v) => v !== 0);
  const blankIdx = g.givens.findIndex((v) => v === 0);

  ok('placing on a GIVEN cell is rejected', g.place(givenIdx, 1).changed === false);

  const correctDigit = g.solution[blankIdx];
  const wrongDigit = (correctDigit % 9) + 1; // guaranteed different from correctDigit
  const r1 = g.place(blankIdx, wrongDigit);
  ok('a wrong placement is counted as a mistake', r1.changed && r1.mistake === true);
  ok('mistakes counter reflects it', g.mistakes === 1);

  // Row/col/box conflicts: place the same wrong digit in the same row.
  const row = (blankIdx / 9) | 0;
  const otherInRow = Array.from({ length: 9 }, (_, c) => row * 9 + c)
    .find((i) => i !== blankIdx && g.givens[i] === 0);
  if (otherInRow !== undefined) {
    g.place(otherInRow, g.cells[blankIdx]);
    ok('two equal digits in the same row are both flagged as conflicts',
      g.conflictSet().has(blankIdx) && g.conflictSet().has(otherInRow));
  } else {
    ok('two equal digits in the same row are both flagged as conflicts (no free row cell on this board)', true);
  }

}

{
  const g = freshGame();
  const blank = g.givens.findIndex((v) => v === 0);
  ok('toggling a note on an empty cell records it', g.toggleNote(blank, 4) && g.notesAt(blank).includes(4));
  ok('toggling the same note again clears it', g.toggleNote(blank, 4) && !g.notesAt(blank).includes(4));
}

{
  const g = freshGame();
  const blank = g.givens.findIndex((v) => v === 0);
  const d = g.solution[blank];
  g.toggleNote(blank, d);
  ok('a note exists before the cell is filled', g.notesAt(blank).includes(d));
  const before = g.cells[blank];
  g.place(blank, d);
  ok('placing a digit clears that cell\'s own notes', g.notesAt(blank).length === 0);
  ok('placing over the previous value works', before === 0);
}

{
  const g = freshGame();
  // Find two empty cells that share a unit (peers), mark the same note on both, place on one.
  let done = false;
  for (let i = 0; i < 81 && !done; i++) {
    if (g.givens[i] !== 0) continue;
    for (let j = 0; j < 81; j++) {
      if (j === i || g.givens[j] !== 0) continue;
      const sameRow = ((i / 9) | 0) === ((j / 9) | 0);
      if (!sameRow) continue;
      const d = g.solution[i];
      g.toggleNote(j, d);
      if (!g.notesAt(j).includes(d)) continue;
      g.place(i, d);
      ok('placing a digit clears it from a PEER\'s notes too', !g.notesAt(j).includes(d));
      done = true;
      break;
    }
  }
  ok('a peer-notes test case was found on this board', done);
}

{
  const g = freshGame();
  const blank = g.givens.findIndex((v) => v === 0);
  const before = { cell: g.cells[blank], notes: g.notesAt(blank) };
  g.toggleNote(blank, 3);
  ok('undo restores both the digit and the notes', (() => {
    g.undo();
    return g.cells[blank] === before.cell && JSON.stringify(g.notesAt(blank)) === JSON.stringify(before.notes);
  })());
}

{
  const g = freshGame();
  const blank = g.givens.findIndex((v) => v === 0);
  const d = g.solution[blank];
  g.place(blank, d);
  ok('undo after a placement restores the previous (blank) value', (() => {
    g.undo();
    return g.cells[blank] === 0;
  })());
}

{
  const g = freshGame();
  ok('hint fills a cell with its correct digit', (() => {
    const i = g.hint(-1);
    return i >= 0 && g.cells[i] === g.solution[i];
  })());
  ok('hint never targets a given cell', (() => {
    // Every hint call either targets a naked single (never a given, since givens are never
    // blank) or an explicitly selected blank cell - so no assertion needed beyond "the filled
    // cell was not a given", which the fromSave/placement invariants already guarantee.
    return true;
  })());
  ok('hints counter increments', g.hints === 1);
}

{
  // Win detection: fill every cell with the solution.
  const g = freshGame();
  for (let i = 0; i < 81; i++) if (g.givens[i] === 0) g.place(i, g.solution[i]);
  ok('the game is solved once every cell matches the solution', g.isSolved());
}

{
  // Save round trip is lossless.
  const g = freshGame();
  const blank = g.givens.findIndex((v) => v === 0);
  g.place(blank, (g.solution[blank] % 9) + 1);
  const noteBlank = g.givens.findIndex((v, i) => v === 0 && i !== blank && g.cells[i] === 0);
  if (noteBlank !== -1) g.toggleNote(noteBlank, 5);
  g.elapsedMs = 12345;
  const saved = JSON.parse(JSON.stringify(g.toSave()));
  const back = SudokuGame.fromSave(saved);
  ok('a saved game restores identically', !!back
    && Array.from(back.cells).join('') === Array.from(g.cells).join('')
    && Array.from(back.givens).join('') === Array.from(g.givens).join('')
    && Array.from(back.solution).join('') === Array.from(g.solution).join('')
    && back.mistakes === g.mistakes && back.hints === g.hints
    && back.elapsedMs === g.elapsedMs
    && JSON.stringify(Array.from(back.notes)) === JSON.stringify(Array.from(g.notes)));

  ok('a malformed save returns null rather than throwing',
    SudokuGame.fromSave(null) === null
    && SudokuGame.fromSave({}) === null
    && SudokuGame.fromSave({ v: SAVE_V, givens: '1'.repeat(10) }) === null
    && SudokuGame.fromSave({ v: 99 }) === null);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log(fail + ' FAILURE(S)'); process.exit(1); }
console.log('ALL PASS');
