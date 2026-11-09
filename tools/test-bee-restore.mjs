// tools/test-bee-restore.mjs - Spelling Bee's restore of lost words (spelling-bee/js/restore.js, 2026-11-09).
// Fake server: a code whose board says 5 words on today's puzzle, a log holding them (plus refusals and a
// for-fun guess). Checks: an empty save gets the 5 words in order with times, the day is marked counted,
// Genius marked recorded, a save already holding them is untouched, nothing is written once `alive` is false.
//   node tools/test-bee-restore.mjs
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const { restoreFromServer } = await import('../spelling-bee/js/restore.js');
const { puzzleAt, GENIUS } = await import('../spelling-bee/js/engine.js');
const { boardKey } = await import('../spelling-bee/js/board.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const data = { lang: 'en', epoch: '2026-10-22', puzzles: ['r:cegnuy', 'a:bcklpy'], retired: {} };
const today = 1, P = puzzleAt(data, today), bk = boardKey(P.key);
const log = {
  '1-0': { e: 'guess', r: 'ok', w: 'play', t: 1000 }, '1-1': { e: 'guess', r: 'not_in_list', w: 'plak', t: 900 },
  '1-2': { e: 'guess', r: 'bonus', w: 'claly', t: 2000 }, '1-3': { e: 'fguess', r: 'ok', w: 'fun', t: 2500 },
  '1-4': { e: 'guess', r: 'ok', w: 'clay', t: 1500 }, '1-5': { e: 'guess', r: 'already_found', w: 'play', t: 3000 },
  '1-6': { e: 'guess', r: 'ok', w: 'balk', t: 4000 }, '1-7': { e: 'guess', r: 'ok', w: 'back', t: 5000 },
};
const server = { [`beeDaily/${bk}/TEST1`]: { words: 5, rank: GENIUS, tg: 4500 }, [`beeLog/${bk}/TEST1`]: log };
const read = async (p) => (p in server ? server[p] : null);
const writes = [];
const write = (s) => { writes.push(JSON.parse(JSON.stringify(s))); return true; };

const save = { v: 1, games: {}, days: {} };
const n = await restoreFromServer(data, save, today, { code: 'TEST1', read, write });
const r = save.games[P.key];
ok(n === 5, 'restored 5, got ' + n);
ok(r && JSON.stringify(r.found) === '["play","clay","claly","balk","back"]', 'order by time: ' + (r && r.found));
ok(r && r.times.play === 1000 && r.times.back === 5000, 'times kept');
ok(Object.keys(save.days).length === 1 && Object.values(save.days)[0] === 1, 'day marked counted');
ok(r && r.recorded === true && r.seenGenius === true && r.geniusAt === 4500, 'Genius marked recorded');
ok(writes.length === 1, 'one write');

const before = JSON.stringify(save);
const n2 = await restoreFromServer(data, save, today, { code: 'TEST1', read, write });
ok(n2 === 0 && JSON.stringify(save) === before && writes.length === 1, 'second run changes nothing');

const s3 = { v: 1, games: { [P.key]: { day: 'x', found: ['back', 'mine'] } }, days: {} };
await restoreFromServer(data, s3, today, { code: 'TEST1', read, write });
ok(JSON.stringify(s3.games[P.key].found) === '["back","mine","play","clay","claly","balk"]', 'existing words kept first, never removed');

const s4 = { v: 1, games: {}, days: {} }, w0 = writes.length;
const n4 = await restoreFromServer(data, s4, today, { code: 'TEST1', read, write, alive: () => false });
ok(n4 === 0 && writes.length === w0, 'nothing written when no longer alive');

const s5 = { v: 1, games: {}, days: {} };
await restoreFromServer(data, s5, today, { code: 'NOBODY', read, write });
ok(Object.keys(s5.games).length === 0, 'another code: nothing');
console.log(`\nBee restore tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
