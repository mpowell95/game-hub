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
// `s` = the server's clock at upload: a couple of seconds after the guess, as on a phone online.
const g = (t, w, r = 'ok') => ({ t: T0 + t * 1000, e: 'guess', w, r, s: T0 + t * 1000 + 2000 });
const ev = (t, e) => ({ t: T0 + t * 1000, e, s: T0 + t * 1000 + 2000 });
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
// Speed skips NOTHING (2026-10-29, Matt): a 30-minute break before Genius counts in full.
const breakGame = [ev(0, 'open'), g(5, 'dead'), ev(10, 'hidden'), ev(1810, 'visible'), g(1815, 'deed'), ev(1820, 'win')];
ok('speed: clock time from opening to Genius, breaks included', detectCopying(breakGame, { words: 2 }).geniusMs === 1820 * 1000);
ok('speed needs the whole game in the log', detectCopying(copier, { words: 99 }).geniusMs === null && detectCopying(copier, { words: 3 }).geniusMs !== null);
// Supporting rules alone: both needed.
const fastOnly = [ev(0, 'open'), ...Array.from({ length: 9 }, (_, i) => [g(i * 20 + 5, `x${i}`), g(i * 20 + 10, 'no', 'not_in_list')]).flat(), ev(200, 'win')];
ok('speed alone does not void', !detectCopying(fastOnly).void && detectCopying(fastOnly).supporting.includes('speed'));
const already = [g(1, 'abed'), g(2, 'aced'), g(3, 'ache'), g(4, 'ache', 'already_found'), g(5, 'bade'), g(6, 'beau'), g(7, 'each')];
ok('an already-found guess restarts a sorted run', detectCopying(already).sorted === 3);

// --- the three checks added 2026-10-28 (best words first, right vs wrong, re-typed) -------------
// Scores come from length and the key's letters (a pangram uses all seven): stand-in words only.
const PZ = { key: 'e:abcdhu', top: [16, 16, 14, 10, 9, 8, 8, 8, 8, 7, 7, 7, 7, 7, 6] };
const PAN9 = 'abcdhueee', PAN9B = 'abcdhueeb', PAN7 = 'abcdhue';
const best = [ev(0, 'open'), g(5, 'eeee'), g(9, 'eeeh'), ev(20, 'hidden'), ev(29, 'visible'),
  g(41, 'eeeeeeeeee'), g(48, 'zzzzzzz', 'not_in_list'), g(57, 'eeeeeeeeb'), g(65, 'eeeeeeec'), g(73, PAN7), g(80, PAN9), g(96, PAN9B), g(100, 'eebe')];
const db1 = detectCopying(best, { puzzle: PZ });
ok('best words first: the 6 top answers after coming back, misses between', db1.best === 6 && db1.strong.includes('best') && db1.void);
ok('best words first: named for Matt', /Best 6 first/.test(flagSummary(db1)));
ok('best words first needs the puzzle', detectCopying(best).best === 0);
const honestStart = [ev(0, 'open'), g(10, 'eeee'), g(20, PAN9), g(30, 'eeeeeeeeee'), g(40, 'eeeeeeeeb'), g(50, 'eeeeeeec'), g(60, PAN7)];
ok('a small word first breaks it (pangrams later count for nothing)', detectCopying(honestStart, { puzzle: PZ }).best === 0);
const slow = [ev(0, 'visible'), g(30, 'eeeeeeeeee'), g(60, 'eeeeeeeeb'), g(90, 'eeeeeeec'), g(110, PAN7), g(130, PAN9)];
ok('only the first 2 minutes after coming back count', detectCopying(slow, { puzzle: PZ }).best === 4);
const left = [ev(0, 'visible'), g(5, 'eeeeeeeeee'), g(10, 'eeeeeeeeb'), ev(12, 'hidden'), ev(20, 'visible'), g(25, 'eeeeeeec'), g(30, PAN7), g(35, PAN9)];
ok('leaving again ends the stretch; the new one starts from what is left', detectCopying(left, { puzzle: PZ }).best === 3);
const late = [ev(0, 'open'), ...[PAN9, PAN9B, PAN7, 'eeeeeeeeee', 'eeeeeeeeb', 'eeeeeeeec', 'eeeeeeeed', 'eeeeeeee', 'eeeeeeeb', 'eeeeeeeh', 'eeeeeeeu'].map((w, i) => g(100 + i * 60, w)),
  ev(2000, 'visible'), ...['eeeeeee', 'eeeeeeb', 'eeeeeec', 'eeeeeeh', 'eeeeeeu'].map((w, i) => g(2010 + i * 5, w))];
ok('late in a game, 5 words of 7 points at the top of what is left still count', detectCopying(late, { puzzle: PZ }).best === 5);
const lateSmall = { key: PZ.key, top: [16, 16, 14, 10, 9, 8, 8, 8, 8, 7, 7, 6, 6, 6, 6] };
ok('...but never words under 7 points', detectCopying([...late.slice(0, 12), ev(2000, 'visible'), ...['eeeeee', 'eeeeeb', 'eeeeec', 'eeeeeh', 'eeeeeu'].map((w, i) => g(2010 + i * 5, w))], { puzzle: lateSmall }).best === 1);

const game = (rightN, wrongN, retypeN) => {
  const out = [ev(0, 'open')];
  let t = 10;
  for (let i = 0; i < rightN; i++) out.push(g((t += 60), `w${String(99 - i).padStart(2, '0')}`));   // descending: no sorted run
  for (let i = 0; i < wrongN; i++) out.push(g((t += 60), 'nope', 'not_in_list'));
  for (let i = 0; i < retypeN; i++) out.push(g((t += 60), 'x000r', 'already_found'));
  out.push(ev((t += 60), 'win'));
  return out;
};
const gr = detectCopying(game(20, 10, 1));
ok('right vs wrong: 20 right, 10 wrong = 2 per wrong, flagged', gr.supporting.includes('ratio') && gr.right === 20 && gr.wrong === 10);
ok('right vs wrong: 20 right, 11 wrong, not flagged', !detectCopying(game(20, 11, 5)).supporting.includes('ratio'));
ok('re-typed: 1 of 20 right answers, flagged', gr.supporting.includes('retype') && gr.retyped === 1);
ok('re-typed: 2 of 20 (1 in 10) is not', !detectCopying(game(20, 30, 2)).supporting.includes('retype'));
ok('right vs wrong + re-typed together void the day', gr.void && /Right 20 \/ wrong 10/.test(flagSummary(gr)) && /Re-typed 1/.test(flagSummary(gr)));
ok('one of them alone does not', !detectCopying(game(20, 10, 5)).void && !detectCopying(game(20, 30, 0)).void);
ok('both need Genius in the log', detectCopying(game(20, 10, 0).slice(0, -1)).right === null);
ok('both need 20+ right answers (a short Genius is not judged)', detectCopying(game(19, 0, 0)).supporting.length === 0 || !detectCopying(game(19, 0, 0)).supporting.some((r) => r === 'ratio' || r === 'retype'));
ok('both need every board word in the log', detectCopying(game(20, 10, 0), { words: 25 }).right === null);
ok('counted only up to Genius', detectCopying([...game(20, 10, 0), g(99999, 'nope', 'not_in_list'), g(99999, 'nope', 'not_in_list')]).wrong === 10);

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
const rb = await B.rebuildBee(db, NOW);
const pkg = JSON.parse(db.tree.boards.v1.bee);
ok('the board is published as a JSON string', rb.changed && Array.isArray(pkg.days));
ok('the flagged copier shows played, 0, on the board', JSON.stringify(pkg.days[0].r.find((r) => r[0] === 'CCCCC')) === JSON.stringify(['CCCCC', 0, 0, 0, 0, 1]));
const rb2 = await B.rebuildBee(db, NOW);
ok('an unchanged board is not rewritten', rb2.changed === false);
const n1 = B.beeNote('flag', 'e-abcdhu', { name: 'Copier', summary: 'Sorted run 7' }).text('en');
ok('the push says who, when, which rules', n1.title === 'Spelling Bee' && n1.body === 'Copier flagged, Oct 28 EN. Sorted run 7');

// --- the clock trick (2026-10-29): own-day words by the SERVER's clock, late posts ---------------
{
  const F = await import('../js/bee-fairplay.js');
  const H = 3600 * 1000;
  const D = '2026-11-03', D0 = Date.parse('2026-11-03T00:00:00Z');
  const ES = -60;   // Spain in November: getTimezoneOffset() = -60 (local = UTC+1)
  const at = (localH, z = ES) => D0 + localH * H + z * 60000;   // local hour on Nov 3 -> ms
  ok('own day: a word typed on the day and sent at once counts', F.countsOnDay({ t: at(20), s: at(20) + 2000, z: ES }, D));
  ok('clock trick: phone set back to 23:00 on Nov 3 the next morning (after Yesterday\'s Answers opened): out', !F.countsOnDay({ t: at(23), s: at(24 + 10), z: ES }, D));
  ok('clock trick: a past day posted 3 days later with the phone set to that day: out', !F.countsOnDay({ t: at(15), s: at(15) + 3 * 24 * H, z: ES }, D));
  ok('clock trick: phone a day ahead (tomorrow\'s puzzle played today): out', !F.countsOnDay({ t: at(10), s: at(10) - 24 * H, z: ES }, D));
  ok('a word at 23:59 sent 5 minutes after midnight still counts (10-minute grace)', F.countsOnDay({ t: at(23.98), s: at(24) + 5 * 60000, z: ES }, D));
  ok('...sent 20 minutes after midnight does not (offline: counts on the phone only)', !F.countsOnDay({ t: at(23.98), s: at(24) + 20 * 60000, z: ES }, D));
  ok('no time zone (older build): any place on Earth\'s Nov 3 counts', F.countsOnDay({ t: D0 + 30 * H, s: D0 + 30 * H + 1000 }, D) && !F.countsOnDay({ t: D0 + 37 * H, s: D0 + 37 * H }, D));
  ok('no server time on the entry: out', !F.countsOnDay({ t: at(20), z: ES }, D));
  ok('a late post: more than a day after the day ended everywhere', !F.isLatePost(D, D0 + 59 * H) && F.isLatePost(D, D0 + 61 * H));
  ok('rank from points: Genius at 70%, Queen Bee only with every answer', F.rankOf(70, 100, false) === 8 && F.rankOf(100, 100, false) === 8 && F.rankOf(100, 100, true) === 9 && F.rankOf(1, 100, false) === 0);

  const PZD = { key: 'e:abcdhu', day: D, max: 20, n: 3 };
  const lg = (arr) => Object.fromEntries(arr.map((x, i) => [`${x.t}-${i}`, { e: 'guess', r: 'ok', z: ES, ...x }]));
  // Honest: two answers on the day (1 point, then the pangram 'abcdhue' = 7 + 7) and a miss.
  const honestLog = lg([{ t: at(9), s: at(9) + 2000, w: 'eeee' }, { t: at(9.1), s: at(9.1) + 2000, w: 'xx', r: 'not_in_list' }, { t: at(9.2), s: at(9.2) + 2000, w: 'abcdhue' }]);
  const o1 = F.ownDayFromLog(honestLog, PZD);
  ok('ownDayFromLog: honest day, 2 words, 15 points', o1.w === 2 && o1.p === 15 && o1.logged === 2);
  // The cheat: two words on the day, then the next morning (answers seen) the phone set back: 3 more.
  const cheatLog = lg([{ t: at(9), s: at(9) + 2000, w: 'eeee' }, { t: at(9.2), s: at(9.2) + 2000, w: 'abcdhue' },
    { t: at(23.5), s: at(24 + 9), w: 'beee' }, { t: at(23.6), s: at(24 + 9.1), w: 'ceeee' }, { t: at(23.7), s: at(24 + 9.2), w: 'abcdhueb' }]);
  const o2 = F.ownDayFromLog(cheatLog, PZD);
  ok('ownDayFromLog: words sent after Yesterday\'s Answers opened count for nothing', o2.w === 2 && o2.p === 15 && o2.logged === 5);
  ok('ownEntry: a full log on time decides the row (the phone\'s dw is ignored)', JSON.stringify(F.ownEntry({ words: 5, dw: 5, dp: 40, at: at(24 + 9.2) }, cheatLog, PZD)) === JSON.stringify({ w: 2, p: 15, r: 8, at: at(24 + 9.2), use: 1 }));
  ok('ownEntry: no log, on time = the phone\'s own numbers (as before)', F.ownEntry({ words: 5, at: at(20) }, null, PZD) === null);
  ok('ownEntry: a log missing words, on time = the phone\'s numbers (missing-log alert covers it)', F.ownEntry({ words: 9, at: at(20) }, honestLog, PZD) === null);
  ok('ownEntry: a LATE post with no log counts nothing', JSON.stringify(F.ownEntry({ words: 40, at: D0 + 80 * H }, null, PZD)) === JSON.stringify({ w: 0, p: 0, r: 0, at: D0 + 80 * H, use: 1 }));
  ok('ownEntry: a late post with a log keeps what the log proves (an honest replay of a past day)', F.ownEntry({ words: 9, at: D0 + 80 * H }, honestLog, PZD).w === 2);
  ok('countedRow: an entry for an older post is ignored (the row moved on)', F.countedRow({ words: 9, points: 30, rank: 4, at: 5 }, { w: 1, p: 1, r: 0, at: 4, use: 1 }, D).words === 9);
  ok('countedRow: a late post with no entry counts nothing', F.countedRow({ words: 9, points: 30, rank: 4, at: D0 + 80 * H }, null, D).words === 0);

  // The whole path: the server (fake database) and the long-term board.
  const bkD = Object.keys(B.PUZZLES).find((k) => B.PUZZLES[k].day === D && B.PUZZLES[k].lang === 'en');
  const P = B.PUZZLES[bkD];
  ok('the puzzle map carries max and n', P && P.max > 0 && P.n > 0);
  const NOW2 = D0 + 20 * H;   // Nov 3, evening: today's puzzle is recent
  const word = (i) => `${P.key[0]}${'z'.repeat(3)}${i}`;   // stand-ins; scored by length only
  const onTime = (i) => ({ t: at(10) + i * 60000, s: at(10) + i * 60000 + 2000, w: word(i) });
  const db2 = fakeDb({
    beeDaily: { [bkD]: {
      HONST: { name: 'Honest', words: 3, points: 15, rank: 2, dw: 3, dp: 15, dr: 2, at: at(11) },
      CLOCK: { name: 'Clock', words: 5, points: 25, rank: 4, dw: 5, dp: 25, dr: 4, at: at(24 + 10) },
      NOLOG: { name: 'Nolog', words: 4, points: 20, rank: 3, dw: 4, dp: 20, dr: 3, at: at(12) },
    } },
    beeLog: { [bkD]: {
      HONST: lg([0, 1, 2].map((i) => onTime(i))),
      CLOCK: lg([...[0, 1].map((i) => onTime(i)), ...[2, 3, 4].map((i) => ({ t: at(23.5) + i * 1000, s: at(24 + 9.5) + i * 1000, w: word(i) }))]),
    } },
    adminConfig: { v1: {} },
  });
  await B.rebuildBee(db2, NOW2 + 24 * H);
  const pk = JSON.parse(db2.tree.boards.v1.bee);
  const dd = pk.days.find((x) => x.d === D && x.l === 'en');
  const rw = (c) => dd.r.find((r) => r[0] === c);
  ok('server: the honest player counts in full', rw('HONST')[2] === 3);
  ok('server: the clock-trick player counts only the 2 words sent on the day, not the phone\'s 5', rw('CLOCK')[2] === 2);
  ok('server: a row with no log keeps its own numbers (as before)', rw('NOLOG')[2] === 4);
  ok('server: the own-day numbers are published for the phones', db2.tree.boards.v1.beeOwn[bkD].CLOCK.w === 2 && !db2.tree.boards.v1.beeOwn[bkD].NOLOG);
  ok('server: rows and logs untouched', db2.tree.beeDaily[bkD].CLOCK.dw === 5 && Object.keys(db2.tree.beeLog[bkD].CLOCK).length === 5);
  // A past day posted late (phone set back), long after it left the recent window.
  db2.tree.beeDaily[bkD].LATE1 = { name: 'Late', words: 30, points: 150, rank: 8, dw: 30, dp: 150, dr: 8, at: D0 + 6 * 24 * H };
  db2.tree.beeLog[bkD].LATE1 = lg([0, 1, 2].map((i) => ({ t: at(15) + i * 1000, s: D0 + 6 * 24 * H, w: word(i) })));
  db2.tree.beeDaily[bkD].LATE2 = { name: 'Late2', words: 30, points: 150, rank: 8, at: D0 + 6 * 24 * H };
  await B.rebuildBee(db2, D0 + 6 * 24 * H + H);
  const dd2 = JSON.parse(db2.tree.boards.v1.bee).days.find((x) => x.d === D && x.l === 'en');
  ok('late post with the phone set back: not played on the long-term board', !dd2.r.find((r) => r[0] === 'LATE1'));
  ok('late post with no log: not played either', !dd2.r.find((r) => r[0] === 'LATE2'));
  ok('...and the on-time rows of that day are unchanged', dd2.r.find((r) => r[0] === 'HONST')[2] === 3 && dd2.r.find((r) => r[0] === 'CLOCK')[2] === 2);

  // What other phones show on the in-game board (spelling-bee/js/board.js).
  const { rowsOf, shownRows } = await import('../spelling-bee/js/board.js');
  const shown = shownRows(rowsOf(db2.tree.beeDaily[bkD]), { me: 'HONST', own: db2.tree.boards.v1.beeOwn[bkD], day: D });
  const sh = Object.fromEntries(shown.map((r) => [r.code, r]));
  ok('in-game board: the clock-trick row shows the server\'s 2 words', sh.CLOCK && sh.CLOCK.words === 2);
  ok('in-game board: late posts are not shown on other phones', !sh.LATE1 && !sh.LATE2);
  const his = shownRows(rowsOf(db2.tree.beeDaily[bkD]), { me: 'CLOCK', own: db2.tree.boards.v1.beeOwn[bkD], day: D });
  ok('in-game board: his own phone still shows his own row unchanged', his.find((r) => r.code === 'CLOCK').words === 5);
}

console.log(`\nSpelling Bee server tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
