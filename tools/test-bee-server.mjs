// test-bee-server.mjs - Spelling Bee fair play, the server half (functions/bee.js) against an
// in-memory fake of the Realtime Database, plus the shared rules (js/bee-fairplay.js) on synthetic
// logs and boards. Headless, no network. Runs tools/sync-functions-shared.mjs first (functions/bee.js
// reads functions/shared/).
//
//   node tools/test-bee-server.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['tools/sync-functions-shared.mjs'], { cwd: ROOT, stdio: 'ignore' });

const { detectCopying, flagSummary, buildBeeBoard, beeTotals } = await import('../js/bee-fairplay.js');
const B = await import('../functions/bee.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name); } };

// --- a fake Realtime Database: get / set / update / transaction on a plain tree ------------------
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  return {
    tree,
    ref: (p) => ({
      get: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
      set: async (v) => setAt(p, v),
      update: async (patch) => { for (const [k, v] of Object.entries(patch)) setAt(`${p}/${k}`, v); },
      transaction: async (fn) => { const cur = getAt(p); const next = fn(cur === undefined ? null : cur); if (next === undefined) return { committed: false }; setAt(p, next); return { committed: true }; },
    }),
  };
}

// --- synthetic logs ------------------------------------------------------------------------------
const T0 = Date.parse('2026-10-28T12:00:00Z');
const g = (t, w, r = 'ok') => ({ t: T0 + t * 1000, e: 'guess', w, r });
const ev = (t, e) => ({ t: T0 + t * 1000, e });
// A copier: leaves, comes back, types a sorted list fast, Genius.
const copier = [ev(0, 'open'), g(5, 'dead'), g(20, 'zzzx', 'not_in_list'), ev(30, 'hidden'), ev(39, 'visible'),
  ...['abed', 'aced', 'ache', 'bade', 'beau', 'each', 'hued'].map((w, i) => g(44 + i * 4, w)),
  ...['added', 'ached', 'beech', 'cache', 'cubed'].map((w, i) => g(74 + i * 4, w)), ev(100, 'win')];
// An honest player: slow, misses between, Genius after 20 minutes.
const honest = [ev(0, 'open'), ...Array.from({ length: 30 }, (_, i) => [g(i * 40 + 20, `w${String(i).padStart(3, '0')}`), g(i * 40 + 30, 'nope', 'not_in_list')]).flat(), ev(1300, 'win')];

const dc = detectCopying(copier);
ok('copier: sorted run of 7 (4-letter words in order)', dc.sorted === 7);
ok('copier: no-miss burst of 12 at 4.2 s', dc.burst.n === 12 && Math.round(dc.burst.avg) === 4182);
ok('copier: back and burst = 5+ in 60 s', dc.leave >= 5);
ok('copier: voided, both strong rules', dc.void && dc.strong.includes('sorted') && dc.strong.includes('burst'));
ok('copier: the line for Matt names the rules', /Sorted run 7/.test(flagSummary(dc)) && /Burst 12 at 4\.2 s/.test(flagSummary(dc)));
const dh = detectCopying(honest);
ok('honest: nothing fires', !dh.void && dh.sorted <= 1 && dh.burst.n <= 1 && dh.leave === 0);
ok('speed needs the whole game in the log', detectCopying(copier, { words: 99 }).geniusMs === null && detectCopying(copier, { words: 3 }).geniusMs !== null);
// Supporting rules alone: both needed.
const fastOnly = [ev(0, 'open'), ...Array.from({ length: 9 }, (_, i) => [g(i * 20 + 5, `x${i}`), g(i * 20 + 10, 'no', 'not_in_list')]).flat(), ev(200, 'win')];
ok('speed alone does not void', !detectCopying(fastOnly).void && detectCopying(fastOnly).supporting.includes('speed'));
const already = [g(1, 'abed'), g(2, 'aced'), g(3, 'ache'), g(4, 'ache', 'already_found'), g(5, 'bade'), g(6, 'beau'), g(7, 'each')];
ok('an already-found guess restarts a sorted run', detectCopying(already).sorted === 3);

// --- buildBeeBoard / beeTotals: own day, voids, replaced puzzles, places -----------------------
const puzzles = { 'e-abcdhu': { lang: 'en', day: '2026-10-28', key: 'e:abcdhu' }, 'a-chlnrt': { lang: 'en', day: '2026-10-26', key: 'a:chlnrt' }, 'u-dfgino': { lang: 'en', day: '2026-10-26', key: 'u:dfgino' }, 'es-a-deiqru': { lang: 'es', day: '2026-10-27', key: 'es:a:deiqru' } };
const daily = {
  'e-abcdhu': { '3VN33': { name: 'King', words: 46, points: 223, rank: 8, dw: 46, dp: 223, dr: 8, at: 1 }, QZCC4: { name: 'Matt', words: 17, points: 55, rank: 5, dw: 17, dp: 55, dr: 5, at: 1 }, K99MB: { name: 'Ana', words: 5, points: 9, rank: 2, at: 1 }, TTTTT: { name: 'test1', words: 99, points: 999, rank: 9, at: 1 } },
  'a-chlnrt': { QZCC4: { name: 'Matt', words: 45, points: 122, rank: 7, at: 1 }, '3VN33': { name: 'King', words: 52, points: 219, rank: 8, at: 1 } },
  'u-dfgino': { QZCC4: { name: 'Matt', words: 8, points: 37, rank: 3, at: 1 } },
  'es-a-deiqru': { K99MB: { name: 'Ana', words: 29, points: 144, rank: 8, at: 1 }, S2BEP: { name: 'Lili', words: 22, points: 114, rank: 7, dw: 0, dp: 0, dr: 0, at: 1 } },
};
const board = buildBeeBoard(daily, puzzles, {}, {});
const day = (d, l) => board.days.find((x) => x.d === d && x.l === l);
const row = (d, l, c) => (day(d, l).r.find((r) => r[0] === c));
ok('test accounts are left out', !board.people.TTTTT);
ok('King on Oct 28 (code-list void): played, 0, no place', JSON.stringify(row('2026-10-28', 'en', '3VN33')) === JSON.stringify(['3VN33', 0, 0, 0, 0, 1]));
ok('Oct 28: Matt 1st, Ana 2nd (King\'s points do not count)', row('2026-10-28', 'en', 'QZCC4')[4] === 1 && row('2026-10-28', 'en', 'K99MB')[4] === 2);
ok('Oct 26 replaced puzzle: Matt\'s better row counts (122, not 37)', row('2026-10-26', 'en', 'QZCC4')[1] === 122);
ok('Oct 26: King voided (code list)', row('2026-10-26', 'en', '3VN33')[5] === 1);
ok('a row with nothing on its own day is not played', !row('2026-10-27', 'es', 'S2BEP'));
const all = beeTotals(board, { lang: 'all', by: 'points' });
const tot = Object.fromEntries(all.map((r) => [r.code, r]));
ok('All by points: Matt 177 (122 + 55), King 0 with 2 days played', tot.QZCC4.points === 177 && tot.QZCC4.days === 2 && tot['3VN33'].points === 0 && tot['3VN33'].days === 2);
ok('King never places and has no Genius', tot['3VN33'].first + tot['3VN33'].second + tot['3VN33'].third === 0 && tot['3VN33'].genius === 0);
ok('places counted: Matt 1st twice', tot.QZCC4.first === 2);
ok('Ana: Genius on the Spanish day counts', tot.K99MB.genius === 1 && tot.K99MB.first === 1);
ok('English only leaves Spanish out', beeTotals(board, { lang: 'en' }).find((r) => r.code === 'K99MB').points === 9);
ok('By words orders by words', beeTotals(board, { lang: 'all', by: 'words' })[0].code === 'QZCC4');
const undone = buildBeeBoard(daily, puzzles, {}, { bee: { undo: { 'e-abcdhu': { '3VN33': true } } } });
ok('Matt\'s undo makes a voided day count again', undone.days.find((x) => x.d === '2026-10-28').r.find((r) => r[0] === '3VN33')[1] === 223);
const flagged = buildBeeBoard(daily, puzzles, { 'es-a-deiqru': { K99MB: { rules: ['burst'] } } }, {});
ok('a server flag voids that day', flagged.days.find((x) => x.l === 'es').r.find((r) => r[0] === 'K99MB')[5] === 1);

// --- functions/bee.js against the fake database --------------------------------------------------
const NOW = Date.parse('2026-10-28T18:00:00Z');
const asLog = (arr) => Object.fromEntries(arr.map((x, i) => [`${x.t}-${i}`, x]));
const db = fakeDb({
  beeDaily: {
    'e-abcdhu': { CCCCC: { name: 'Copier', words: 13, points: 40, rank: 4, at: NOW - 60 * 60 * 1000 }, HHHHH: { name: 'Honest', words: 30, points: 90, rank: 6, at: NOW - 60 * 60 * 1000 }, GGGGG: { name: 'Gap', words: 20, points: 50, rank: 5, at: NOW - 60 * 60 * 1000 }, OOOOO: { name: 'Old build', words: 9, points: 20, rank: 3, at: NOW - 60 * 60 * 1000 } },
  },
  beeLog: { 'e-abcdhu': { CCCCC: asLog(copier), HHHHH: asLog(honest), GGGGG: asLog(honest.slice(0, 11)) } },
  adminConfig: { v1: {} },
});
ok('recent puzzles include today\'s', B.recentPuzzles(NOW).includes('e-abcdhu'));
const r1 = await B.scanRecent(db, NOW);
ok('the copier is flagged, nobody else', r1.flags.length === 1 && r1.flags[0][1] === 'CCCCC' && !!db.tree.beeFlags['e-abcdhu'].CCCCC);
ok('the flag carries the rules and a line for Matt', db.tree.beeFlags['e-abcdhu'].CCCCC.rules.includes('sorted') && /Sorted run/.test(db.tree.beeFlags['e-abcdhu'].CCCCC.summary));
ok('missing log: the player with a short log is alerted', r1.alerts.length === 1 && r1.alerts[0][1] === 'GGGGG');
ok('missing log: no log at all (older build) is not an alert', !db.tree.beeAlerts['e-abcdhu'].OOOOO);
const r2 = await B.scanRecent(db, NOW);
ok('a second pass sends nothing again (once per player per puzzle)', r2.flags.length === 0 && r2.alerts.length === 0);
ok('the logs and board rows are untouched', Object.keys(db.tree.beeLog['e-abcdhu'].CCCCC).length === copier.length && db.tree.beeDaily['e-abcdhu'].CCCCC.words === 13);
const rb = await B.rebuildBee(db);
const pkg = JSON.parse(db.tree.boards.v1.bee);
ok('the board is published as a JSON string', rb.changed && Array.isArray(pkg.days));
ok('the flagged copier shows played, 0, on the board', JSON.stringify(pkg.days[0].r.find((r) => r[0] === 'CCCCC')) === JSON.stringify(['CCCCC', 0, 0, 0, 0, 1]));
const rb2 = await B.rebuildBee(db);
ok('an unchanged board is not rewritten', rb2.changed === false);
const n1 = B.beeNote('flag', 'e-abcdhu', { name: 'Copier', summary: 'Sorted run 7' }).text('en');
ok('the push says who, when, which rules', n1.title === 'Spelling Bee' && n1.body === 'Copier flagged, Oct 28 EN. Sorted run 7');

console.log(`\nSpelling Bee server tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
