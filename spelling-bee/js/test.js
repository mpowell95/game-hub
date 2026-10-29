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
  if (p.letters.size !== 7 || !a.some((w) => isPangram(w, p)) || a.length < 20 || a.length > 90 || max < 60 || max > 450) { allFair = false; bad = p.key; break; }
}
ok('every puzzle: 7 letters, a pangram, 20-90 words, 60-450 points (size grew with the word list)', allFair, bad);

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
ok('a bonus word passes', checkWord('blat', p, set, new Set(), new Set(['blat'])) === null);
ok('queen bee needs every answer', rankIndex(100, 100, false) === GENIUS && rankIndex(100, 100, true) === GENIUS + 1);
ok('a retired puzzle is never a current day', Object.entries(data.retired).every(([d, k]) => data.puzzles[d] !== k && !data.puzzles.includes(k)));
ok('every bonus word is outside the answers', (() => { const s = new Set(data.words); return data.extra.length > 200 && data.extra.every((w) => !s.has(w)); })());
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

// Spanish (2026-10-26): its own file, the same fairness bar, no accents, Ñ its own letter (Ana).
const { fold, puzzleOf } = await import('./engine.js');
const es = parseData(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/bee-es.json', import.meta.url)), 'utf8')));
ok('es: word list is big, no accents, no S, 4+ (ñ allowed)', es.words.length > 4000 && es.words.concat(es.extra).every((w) => /^[a-rt-zñ]{4,}$/.test(w)), String(es.words.length));
ok('es: at least 1000 puzzles, unique', es.puzzles.length >= 1000 && new Set(es.puzzles).size === es.puzzles.length);
let esFair = true, esBad = '';
for (let n = 0; n < es.puzzles.length; n++) {
  const q = puzzleAt(es, n);
  const a = answersFor(es, q);
  const max = totalPoints(a, q);
  if (q.letters.size !== 7 || !a.some((w) => isPangram(w, q)) || a.length < 25 || a.length > 90 || max < 80 || max > 450) { esFair = false; esBad = q.key; break; }
}
ok('es: every puzzle 7 letters, a pangram, 25-90 words, 80-450 points', esFair, esBad);
ok('es: keys carry es: so they never meet an English save', puzzleAt(es, 0).key.startsWith('es:') && !puzzleOf('a:bcdefg').key.startsWith('es:'));
ok('es: typing drops accents but keeps Ñ', fold('Canción') === 'cancion' && fold('NIÑA') === 'niña' && fold('á') === 'a');
ok('es: Ñ is its own letter (niño counts, nino does not)', es.words.includes('niño') && !es.words.includes('nino') && !es.extra.includes('nino'));
ok('es: some puzzles have Ñ in the hive', es.puzzles.some((q) => q.includes('ñ')));
ok('es: the folded first build\'s day 0 stays playable (retired)', es.retired[0] === 'o:aeimnt');
ok('es: no bad word is an answer or a bonus word', !['puta', 'mierda', 'joder', 'cabron'].some((w) => es.words.includes(w) || es.extra.includes(w)));
ok('es: names stay out of the answers', !['maria', 'martin', 'rita'].some((w) => es.words.includes(w)));

ok('junk Matt found is no longer a bonus word (cratch, cranch, hant, anna, carl)', !['cratch', 'cranch', 'hant', 'anna', 'carl'].some((w) => data.extra.includes(w) || data.words.includes(w)));
ok('real rare words still are (dugong)', data.extra.includes('dugong'));
ok('adult words and profanity are bonus words, never answers (vagina, fuck)', ['vagina', 'fuck', 'damn'].every((w) => data.extra.includes(w) && !data.words.includes(w)));
ok('slurs stay out of both lists', !['nigger', 'faggot', 'kike', 'retard', 'wetback'].some((w) => data.extra.includes(w) || data.words.includes(w)));

// The daily board (board.js): pure parts, and the rules + backup entries it needs.
const { rowsOf, boardKey } = await import('./board.js');
ok('board key is ASCII', boardKey('a:chlnrt') === 'a-chlnrt' && boardKey('es:a:chlnrt') === 'es-a-chlnrt' && boardKey('es:c:aimopñ') === 'es-c-aimop0');
const rows = rowsOf({ A: { name: 'Ana', words: 12, points: 40, rank: 5 }, B: { name: 'test1', words: 30 }, C: { name: 'Zed', words: 12, points: 50, rank: 5 }, D: { name: 'X', words: 0 } });
ok('board: most words first, ties by points, test accounts and zero rows out', rows.map((r) => r.code).join() === 'C,A');
const fsx = await import('node:fs');
const rules = JSON.parse(fsx.readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8')).rules;
const bd = rules.beeDaily && rules.beeDaily.$puzzle && rules.beeDaily.$puzzle.$code;
ok('beeDaily rules: own code only, words never go down', !!bd && /msgAuth/.test(bd['.write']) && /newData\.child\('words'\)\.val\(\) >= data\.child\('words'\)\.val\(\)/.test(bd['.validate']));
ok('beeDaily is backed up', /'beeDaily'/.test(fsx.readFileSync(new URL('../../backups/rtdb-backup.mjs', import.meta.url), 'utf8')));

// --- the clock trick (2026-10-29): Yesterday's Answers follows the SERVER's clock -------------------
{
  const { answersShown } = await import('./engine.js');
  const ep = data.epoch;
  const realNoon = new Date(2026, 10, 3, 12).getTime();   // the server says: Nov 3, noon
  const today = dayNumber(ep, new Date(realNoon));
  ok('yesterday sheet: on the real today, yesterday\'s answers show', answersShown(ep, today, realNoon) === 'ok');
  ok('yesterday sheet: a phone set a day ahead opens "tomorrow"; the real today\'s answers stay hidden', answersShown(ep, today + 1, realNoon) === 'not_yet');
  ok('yesterday sheet: two days ahead, still hidden', answersShown(ep, today + 2, realNoon) === 'not_yet');
  ok('yesterday sheet: no server time = no answers (the phone clock is never asked)', answersShown(ep, today, NaN) === 'need_net' && answersShown(ep, 5, undefined) === 'need_net');
  ok('yesterday sheet: one second before midnight, today\'s answers stay hidden', answersShown(ep, today + 1, new Date(2026, 10, 3, 23, 59, 59).getTime()) === 'not_yet');
  ok('yesterday sheet: at midnight they show', answersShown(ep, today + 1, new Date(2026, 10, 4, 0, 0, 1).getTime()) === 'ok');
  const st = await import('../../js/server-time.js');
  st.__setServerTimeForTest(24 * 60 * 60 * 1000);   // the phone runs a day behind the server
  ok('server time: liveNow is the phone clock plus the measured gap', Math.abs(st.liveNow() - (Date.now() + 86400000)) < 1000 && Math.abs(st.bestNow() - (Date.now() + 86400000)) < 1000);
  st.__setServerTimeForTest(null);
  ok('server time: never connected = no live time', st.liveNow() === null);
  const ui = fsx.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  ok('ui.js: "today" and word times come from the server clock, never new Date() alone', !/dayNumber\(this\.data\.epoch, new Date\(\)\)/.test(ui) && /new Date\(bestNow\(\)\)/.test(ui) && /const now = bestNow\(\)/.test(ui));
  ok('ui.js: the yesterday sheet waits for the live server time', /answersShown\(this\.data\.epoch, n, /.test(ui) && /whenLive\(/.test(ui));
  const lg = rules.beeLog && rules.beeLog.$puzzle && rules.beeLog.$puzzle.$code && rules.beeLog.$puzzle.$code.$k;
  ok('beeLog rules accept the time zone (z)', !!(lg && lg.z));
  ok('boards/v1/beeOwn is readable', !!(rules.boards && rules.boards.v1 && rules.boards.v1.beeOwn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
