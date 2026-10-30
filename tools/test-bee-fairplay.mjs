// test-bee-fairplay.mjs - Spelling Bee's fair-play display rules (docs/SPELLING-BEE-INTEGRITY-SPEC.md).
// Pure halves only: what other people see on a puzzle's board (own-day numbers, voided rows at 0,
// the viewer's own row never touched), the void list (code list + server flags - Matt's undo), and
// the admin undo resolver. Headless, no network.
//
//   node tools/test-bee-fairplay.mjs

import { rowsOf, shownRows, voidedOn, byPoints } from '../spelling-bee/js/board.js';
import { voidedCodesFor } from '../js/stats-corrections.js';
import { resolveBeeUndone } from '../js/admin-config.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name); } };

// --- rowsOf: own-day fields carried, order by points -------------------------------------------
const node = {
  AAAAA: { name: 'Ana', emoji: '🦁', words: 18, points: 38, rank: 3 },
  KKKKK: { name: 'King', emoji: '🤴', words: 46, points: 223, rank: 8, dw: 46, dp: 223, dr: 8 },
  MMMMM: { name: 'Matt', emoji: '🧊', words: 30, points: 40, rank: 4, dw: 10, dp: 25, dr: 3 },
  LLLLL: { name: 'Lili', emoji: '🐢', words: 12, points: 60, rank: 5, dw: 0, dp: 0, dr: 0 },
  TTTTT: { name: 'test1', emoji: '🧪', words: 99, points: 999, rank: 9 },
};
const rows = rowsOf(node);
ok('test accounts stay hidden', !rows.some((r) => r.code === 'TTTTT'));
ok('rows sort by points, not words', rows.map((r) => r.code).join() === 'KKKKK,LLLLL,MMMMM,AAAAA');
ok('own-day fields are carried', rows.find((r) => r.code === 'MMMMM').dw === 10 && !('dw' in rows.find((r) => r.code === 'AAAAA')));

// --- shownRows: what another phone shows ---------------------------------------------------------
const seen = shownRows(rows, { me: 'AAAAA', voided: new Set(['KKKKK']) });
const by = Object.fromEntries(seen.map((r) => [r.code, r]));
ok('a voided row shows played with 0 words, 0 points, no rank', by.KKKKK && by.KKKKK.words === 0 && by.KKKKK.points === 0 && by.KKKKK.rank === 0);
ok('a voided row is last', seen[seen.length - 1].code === 'KKKKK');
ok('everyone else moves up past the voided row', seen[0].code === 'AAAAA' || seen[0].code === 'MMMMM');
ok('others show OWN-DAY numbers', by.MMMMM.words === 10 && by.MMMMM.points === 25 && by.MMMMM.rank === 3);
ok('a row with nothing found on its day is left out', !by.LLLLL);
ok('a row without own-day fields counts whole', by.AAAAA.words === 18 && by.AAAAA.points === 38);

// The voided player's OWN phone: nothing changes, not even with his code in the void list.
const his = shownRows(rows, { me: 'KKKKK', voided: new Set(['KKKKK']) });
const hisRow = his.find((r) => r.code === 'KKKKK');
ok('the viewer\'s own row is never voided', hisRow.words === 46 && hisRow.points === 223 && hisRow.rank === 8);
ok('the viewer\'s own row shows own-day numbers too, like every other phone (2026-10-30)', shownRows(rows, { me: 'MMMMM' }).find((r) => r.code === 'MMMMM').words === 10);
ok('his own phone still ranks him first', his[0].code === 'KKKKK');
// Every phone shows the same numbers and order (2026-10-30: Lili's phone counted 7 next-day words, 486 vs Ana's 434,
// and put her 1st; Ana's phone showed Lili's on-day 428, 2nd). Real Oct 28 Spanish rows.
{
  const oct28 = rowsOf({
    K99MB: { name: 'Anita Bonita', emoji: '🦁', words: 87, points: 434, rank: 8, dw: 87, dp: 434, dr: 8 },
    S2BEP: { name: 'Lili', emoji: '🐢', words: 86, points: 486, rank: 8, dw: 79, dp: 428, dr: 8 },
    QZCC4: { name: 'MattyIce', emoji: '🧊', words: 1, points: 5, rank: 1, dw: 1, dp: 5, dr: 1 },
  });
  const view = (me) => shownRows(oct28, { me }).map((r) => `${r.code}:${r.words}:${r.points}`).join();
  ok('Lili\'s phone and Ana\'s phone show the same board', view('S2BEP') === view('K99MB') && view('K99MB') === view(''));
  ok('Ana is first on Lili\'s phone', shownRows(oct28, { me: 'S2BEP' })[0].code === 'K99MB');
}
ok('no void: the same rows minus nothing-on-the-day', shownRows(rows, { me: '' }).length === 3);

// --- voidedOn: code list + flags - undo -----------------------------------------------------------
ok('the code list voids King on Oct 28 English', voidedOn('e:abcdhu', {}).has('3VN33'));
ok('the code list does not touch another puzzle', !voidedOn('es:a:bcdefg', {}).has('3VN33'));
ok('a server flag voids that code', voidedOn('es:a:bcdefg', { ZZZZZ: { rules: ['burst'] } }).has('ZZZZZ'));
ok('voidedCodesFor matches the code list', voidedCodesFor('spellingbee', 'a:chlnrt').has('3VN33') && voidedCodesFor('spellingbee', 'a:ciltuy').has('3VN33'));

// --- the admin undo resolver ----------------------------------------------------------------------
const cfg = { bee: { undo: { 'e-abcdhu': { '3VN33': true, XXXXX: false } } } };
ok('an undo marked true is undone', resolveBeeUndone(cfg, 'e-abcdhu', '3VN33') === true);
ok('false or absent is not undone', !resolveBeeUndone(cfg, 'e-abcdhu', 'XXXXX') && !resolveBeeUndone(cfg, 'e-abcdhu', 'YYYYY') && !resolveBeeUndone(null, 'e-abcdhu', '3VN33'));

// --- byPoints ties --------------------------------------------------------------------------------
ok('ties on points go to more words, then name', [{ name: 'b', points: 5, words: 2 }, { name: 'a', points: 5, words: 2 }, { name: 'c', points: 5, words: 3 }].sort(byPoints).map((r) => r.name).join('') === 'cab');

console.log(`\nSpelling Bee fair-play tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
