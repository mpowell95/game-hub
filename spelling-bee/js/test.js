// spelling-bee/js/test.js - headless tests for the engine, against the real data file.
//   node spelling-bee/js/test.js
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseData, puzzleAt, answersFor, totalPoints, rankThresholds, rankIndex, checkWord, praiseFor,
  scoreWord, isPangram, hintsFor, dayNumber, GENIUS, shuffled,
} from './engine.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}

const raw = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/bee.json', import.meta.url)), 'utf8'));
const data = parseData(raw);

ok('word list is big', data.words.length > 10000, String(data.words.length));
ok('no word has an S or is under 4 letters', data.words.every((w) => /^[a-rt-z]{4,}$/.test(w)));
ok('at least 1000 puzzles', data.puzzles.length >= 1000);
ok('puzzle keys are unique', new Set(data.puzzles).size === data.puzzles.length);

let allFair = true, bad = '';
for (let n = 0; n < data.puzzles.length; n++) {
  const p = puzzleAt(data, n);
  const a = answersFor(data, p);
  const max = totalPoints(a, p);
  if (p.letters.size !== 7 || !a.some((w) => isPangram(w, p)) || a.length < 20 || a.length > 60 || max < 60 || max > 300) { allFair = false; bad = p.key; break; }
}
ok('every puzzle: 7 letters, a pangram, 20-60 words, 60-300 points', allFair, bad);

ok('day 0 is the epoch', dayNumber('2026-10-22', new Date(2026, 9, 22, 23, 59)) === 0);
ok('day 1 the next local day', dayNumber('2026-10-22', new Date(2026, 9, 23, 0, 1)) === 1);
ok('puzzle index wraps', puzzleAt(data, data.puzzles.length).key === puzzleAt(data, 0).key);

const p = { center: 'a', outer: ['b', 'c', 'e', 'l', 't', 'r'], letters: new Set('abcelrt') };
ok('4 letters = 1', scoreWord('able', p) === 1);
ok('5 letters = 5', scoreWord('table', p) === 5);
ok('pangram = length + 7', scoreWord('bracelet', p) === 15 && isPangram('bracelet', p));
const set = new Set(['table', 'bracelet']);
ok('too short', checkWord('tab', p, set, new Set()) === 'too_short');
ok('bad letters', checkWord('tablez', p, set, new Set()) === 'bad_letters');
ok('missing center', checkWord('tree', p, set, new Set()) === 'missing_center');
ok('not in list', checkWord('blat', p, set, new Set()) === 'not_in_list');
ok('already found', checkWord('table', p, set, new Set(['table'])) === 'already_found');
ok('a new answer passes', checkWord('table', p, set, new Set()) === null);
ok('praise', praiseFor('able', p) === 'good' && praiseFor('table', p) === 'nice' && praiseFor('tabletal', p) === 'awesome' && praiseFor('bracelet', p) === 'pangram');

const th = rankThresholds(100);
ok('NYT thresholds at 100 points', th.join(',') === '0,2,5,8,15,25,40,50,70,100');
ok('genius at 70%', rankIndex(70, 100) === GENIUS && rankIndex(69, 100) === GENIUS - 1);

const p0 = puzzleAt(data, 1);
const a0 = answersFor(data, p0);
const h = hintsFor(a0, new Set([a0[0]]), p0);
ok('hints count what is left', h.words === a0.length - 1);
const gridSum = h.firsts.reduce((s, f) => s + h.lens.reduce((t, l) => t + h.grid[f][l], 0), 0);
ok('hint grid adds up', gridSum === h.words);
ok('two-letter list adds up', h.two.reduce((s, [, n]) => s + n, 0) === h.words);
ok('shuffle keeps the letters', shuffled(['a', 'b', 'c', 'd', 'e', 'f']).sort().join('') === 'abcdef');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
