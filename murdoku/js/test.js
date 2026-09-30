// murdoku/js/test.js - headless tests for the generator and solvers. No DOM, no browser.
//
//   node murdoku/js/test.js
//
// Not deployed (not in sw.js ASSETS); run by run-all-tests.mjs as a plain node script.
import {
  generate, countSolutions, humanSolve, checkBoard, holds, validPuzzle, personInfo,
  TIERS, TIER_N, isBlocker, SAVE_V, nextHint, visibleDomains,
} from './engine.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

const SEEDS = 40;

// 1. Every tier, many seeds: the puzzle is well formed, the stored solution obeys every rule and
//    every clue, the SEARCH solver finds exactly one arrangement and it is the stored one, and
//    the HUMAN solver at the tier's level finishes it (so no case ever needs a guess).
const LEVEL = { easy: 1, medium: 2, hard: 3, expert: 3 };
for (const tier of TIERS) {
  let shape = 0, rules = 0, unique = 0, human = 0, killer = 0, clueless = 0, floor = 0;
  for (let i = 1; i <= SEEDS; i++) {
    const seed = i * 104729 + TIERS.indexOf(tier);
    const p = generate(tier, seed);
    const n = TIER_N[tier];
    if (validPuzzle(p) && p.n === n && p.people.length === n) shape++;
    const rowsOk = new Set(p.solution.map((s) => (s / n) | 0)).size === n;
    const colsOk = new Set(p.solution.map((s) => s % n)).size === n;
    const noBlock = p.solution.every((s) => !isBlocker(p.objects[s]));
    const cluesTrue = p.clues.every((cl) => holds(p, cl, p.solution) === true);
    if (rowsOk && colsOk && noBlock && cluesTrue) rules++;
    const c = countSolutions(p, p.clues, 2);
    if (c.count === 1 && c.sols[0].every((s, k) => s === p.solution[k])) unique++;
    if (humanSolve(p, p.clues, LEVEL[tier]).solved) human++;
    // The murderer: the one person sharing the victim's room, and nobody else is in it.
    const vRoom = p.rooms[p.solution[p.victim]];
    const mates = p.solution.map((s, q) => (q !== p.victim && p.rooms[s] === vRoom ? q : -1)).filter((q) => q >= 0);
    if (mates.length === 1 && mates[0] === p.killer) killer++;
    const perPerson = p.people.map((_, q) => p.clues.filter((cl) => cl.p === q).length);
    if (perPerson.every((k) => k >= 1)) clueless++;
    // Not solvable by singles alone above easy.
    if (tier === 'easy' || !humanSolve(p, p.clues, 1).solved) floor++;
  }
  ok(`${tier}: ${SEEDS} puzzles well formed`, shape === SEEDS, `${shape}/${SEEDS}`);
  ok(`${tier}: stored solution obeys every rule and clue`, rules === SEEDS, `${rules}/${SEEDS}`);
  ok(`${tier}: exactly one answer (search solver)`, unique === SEEDS, `${unique}/${SEEDS}`);
  ok(`${tier}: solvable without guessing at level ${LEVEL[tier]}`, human === SEEDS, `${human}/${SEEDS}`);
  ok(`${tier}: the murderer is the one person alone with the victim`, killer === SEEDS, `${killer}/${SEEDS}`);
  ok(`${tier}: every person has at least one clue`, clueless === SEEDS, `${clueless}/${SEEDS}`);
  ok(`${tier}: harder than singles-only (above easy)`, floor === SEEDS, `${floor}/${SEEDS}`);
}

// 2. Deterministic: the same (tier, seed) is the same case, so a save could be rebuilt.
{
  const a = JSON.stringify(generate('hard', 777)), b = JSON.stringify(generate('hard', 777));
  ok('same tier + seed = same puzzle', a === b);
  ok('different seed = different puzzle', a !== JSON.stringify(generate('hard', 778)));
}

// 3. JSON round trip (the save stores the puzzle itself).
{
  const p = generate('medium', 31337);
  const q = JSON.parse(JSON.stringify(p));
  ok('puzzle survives a JSON round trip', validPuzzle(q) && q.v === SAVE_V);
  ok('validPuzzle rejects junk', !validPuzzle(null) && !validPuzzle({}) && !validPuzzle({ ...q, v: 99 }) && !validPuzzle({ ...q, rooms: [] }));
}

// 4. checkBoard: solved board, a row clash, a broken clue, a blocker.
{
  const p = generate('medium', 4242);
  const n = p.n;
  const good = checkBoard(p, p.solution.slice());
  ok('checkBoard: the solution is solved with nothing broken', good.solved && good.full && !good.broken.length && !good.clash.length && !good.blocked.length);
  const empty = checkBoard(p, p.solution.map(() => -1));
  ok('checkBoard: an empty board breaks nothing and is not full', !empty.full && !empty.solved && !empty.broken.length && !empty.clash.length);
  // swap two people's columns: still one per row/column, but not the answer
  const bad = p.solution.slice();
  const c0 = bad[0] % n, c1 = bad[1] % n;
  bad[0] = bad[0] - c0 + c1; bad[1] = bad[1] - c1 + c0;
  const r = checkBoard(p, bad);
  ok('checkBoard: a wrong full board is not solved', r.full && !r.solved);
  // two people in one row
  const clash = p.solution.map(() => -1);
  const row0 = [...Array(n).keys()].filter((c) => !isBlocker(p.objects[c]));
  if (row0.length >= 2) {
    clash[0] = row0[0]; clash[1] = row0[1];
    ok('checkBoard: two people in a row is a clash', checkBoard(p, clash).clash.length === 2);
  } else ok('checkBoard: two people in a row is a clash (skipped, row 0 blocked)', true);
  const blocker = p.objects.findIndex((o) => isBlocker(o));
  if (blocker >= 0) {
    const bpos = p.solution.map(() => -1); bpos[0] = blocker;
    ok('checkBoard: standing on a blocker is flagged', checkBoard(p, bpos).blocked[0] === 0);
  }
}

// 5. The victim is always the last person, and nobody's "same room" clue involves the victim.
{
  let fine = true;
  for (let i = 1; i <= 20; i++) {
    const p = generate(TIERS[i % 4], i * 13);
    if (!personInfo(p, p.victim).victim) fine = false;
    if (p.clues.some((cl) => (cl.k === 'with' || cl.k === 'notwith') && (cl.p === p.victim || cl.b === p.victim))) fine = false;
  }
  ok('victim is flagged and never in a same-room clue (that would give the answer away)', fine);
}

// 6. Hints. A player who only ever follows the hint (placing the named person on the true square)
//    reaches the solved board, and every hint's squares include the true one. 'only' is exactly
//    one square and it is the right one. A misplaced person is reported first.
for (const tier of TIERS) {
  let finished = 0, honest = true, onlyRight = true, kinds = {};
  for (let i = 1; i <= 15; i++) {
    const p = generate(tier, i * 7907 + 3);
    const pos = p.solution.map(() => -1);
    for (let step = 0; step < p.n + 2; step++) {
      const h = nextHint(p, pos);
      if (!h) break;
      kinds[h.k] = (kinds[h.k] | 0) + 1;
      if (!h.cells.includes(p.solution[h.p])) honest = false;
      if (h.k === 'only' && (h.cells.length !== 1 || h.cells[0] !== p.solution[h.p])) onlyRight = false;
      pos[h.p] = p.solution[h.p];
    }
    if (checkBoard(p, pos).solved) finished++;
  }
  ok(`${tier}: following the hints solves the case (${JSON.stringify(kinds)})`, finished === 15, `${finished}/15`);
  ok(`${tier}: every hint includes the true square`, honest);
  ok(`${tier}: an "only one square" hint is exactly the right square`, onlyRight);
}
{
  const p = generate('medium', 55);
  const pos = p.solution.map(() => -1);
  const wrong = p.solution.find((s, q) => q !== 0 && s !== p.solution[0]);
  pos[0] = wrong;
  const h = nextHint(p, pos);
  ok('hint: a misplaced person is named first', h && h.k === 'wrong' && h.p === 0);
  ok('hint: none on a solved board', nextHint(p, p.solution.slice()) === null);
  const d = visibleDomains(p, p.solution.map(() => -1));
  ok('visibleDomains: everyone can reach their true square on an empty board', d.every((cells, q) => cells.includes(p.solution[q])));
}

// 7. Speed: generation must be fast enough for a phone (expert is the slow one).
{
  const t0 = Date.now();
  for (let i = 1; i <= 10; i++) generate('expert', 900 + i);
  const avg = (Date.now() - t0) / 10;
  ok(`expert generation averages under 400 ms here (${avg.toFixed(0)} ms)`, avg < 400);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
