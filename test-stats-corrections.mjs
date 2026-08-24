// test-stats-corrections.mjs - headless tests for js/stats-corrections.js, the admin overlay that
// makes "those scores were thrown on a broken board" stick.
//
// Run: node test-stats-corrections.mjs   (also wired into run-all-tests.mjs)
//
// WHAT IS AND IS NOT COVERED: the maths - what a void removes, what it deliberately leaves alone,
// and that a score thrown AFTER the void counts normally. The Firebase write (js/admin-config.js's
// setSkeeballCorrection) and the admin page's Scores section need a browser and a real database and
// are not covered here, the same caveat test-admin-config.mjs carries.
//
// THE LAW is the reason most of these assertions exist. A correction is an OVERLAY, so:
//   rule 1  the raw record is never touched - every test below checks the input is unchanged
//   rule 2  nothing is subtracted from a counter it cannot be attributed to (balls, 100s, 50s and
//           the colour counters have no per-machine breakdown, so a per-machine void leaves them)
//   rule 4  a best is not a sum and cannot be un-summed: it survives only if a later score beat the
//           voided one, and otherwise reads 0 rather than an invented number

import { correctBoard, correctSkeeballRecord, correctStats, correctionFor, snapshotOf } from './js/stats-corrections.js';

let passed = 0;
const failures = [];
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`ok    ${label}`); return; }
  failures.push(label);
  console.log(`FAIL  ${label}${extra ? `\n        ${extra}` : ''}`);
}
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const board = () => ({ plays: 12, points: 5400, best: 700, bestThrow: 100,
  daily: { '2026-08-20': 700, '2026-08-22': 480, '2026-08-26': 260 } });

console.log('\n--- one board ---');
{
  const raw = board();
  const corr = snapshotOf(raw, '2026-08-24');
  const out = correctBoard(raw, corr);
  eq('plays and points drop to zero when everything is voided', [out.plays, out.points], [0, 0]);
  eq('the best reads 0 rather than an invented lower number', out.best, 0);
  eq('daily bests up to the void date are dropped, later ones kept', Object.keys(out.daily), ['2026-08-26']);
  eq('THE RAW RECORD IS UNTOUCHED (rule 1)', raw, board());
  eq('no correction is a pass-through, not a copy', correctBoard(raw, null), raw);
}
{
  // The point of a BASELINE rather than a fixed subtraction: play on after the void and it counts.
  const raw = board();
  const corr = snapshotOf(raw, '2026-08-24');
  const later = Object.assign({}, raw, { plays: 15, points: 6300, best: 900, bestThrow: 100,
    daily: Object.assign({}, raw.daily, { '2026-08-27': 900 }) });
  const out = correctBoard(later, corr);
  eq('three racks thrown after the void still count', [out.plays, out.points], [3, 900]);
  eq('a NEW best that beat the voided one survives', out.best, 900);
  ok('a best that only EQUALS the voided one does not survive',
    correctBoard(Object.assign({}, later, { best: 700 }), corr).best === 0);
}

console.log('\n--- a whole skeeball record ---');
const record = () => ({
  total: { played: 14, won: 14, lost: 0 },
  byDiff: { classic: { played: 12, won: 12, lost: 0 }, popongo: { played: 2, won: 2, lost: 0 } },
  sk: {
    played: 14, points: 5700, bestGame: 700, bestThrow: 100, balls: 126, hundreds: 9, fifties: 20,
    boards: { classic: board(), popongo: { plays: 2, points: 300, best: 180, bestThrow: 30, daily: {} } },
  },
});
{
  const raw = record();
  const corrs = { classic: snapshotOf(raw.sk.boards.classic, '2026-08-24') };
  const out = correctSkeeballRecord(raw, corrs);
  eq('the voided machine is emptied', [out.sk.boards.classic.plays, out.sk.boards.classic.best], [0, 0]);
  eq('the OTHER machine is untouched', out.sk.boards.popongo, raw.sk.boards.popongo);
  eq('lifetime plays lose exactly the voided racks', out.sk.played, 2);
  eq('lifetime points lose exactly the voided points', out.sk.points, 300);
  eq('the game total drops too (the leaderboard reads it)', [out.total.played, out.total.won], [2, 2]);
  eq('the voided board\'s byDiff bucket drops with it', out.byDiff.classic, { played: 0, won: 0, lost: 0 });
  eq('the other bucket is left alone', out.byDiff.popongo, raw.byDiff.popongo);
  // The lifetime best belonged to the voided machine, so it falls back to the best that is LEFT -
  // never to a number nobody threw (rule 4).
  eq('lifetime best falls back to the best surviving machine', out.sk.bestGame, 180);
  eq('lifetime best throw does the same', out.sk.bestThrow, 30);
  // Rule 2: these have no per-machine breakdown anywhere in the store, so a per-machine void must
  // not guess at them. Leaving them is the honest answer, and the module header says so out loud.
  eq('balls / 100s / 50s are left alone, not guessed at', [out.sk.balls, out.sk.hundreds, out.sk.fifties], [126, 9, 20]);
  eq('THE RAW RECORD IS UNTOUCHED (rule 1)', raw, record());
}
{
  // A record whose lifetime best came from a machine that was NOT voided must keep it.
  const raw = record();
  raw.sk.bestGame = 1200;                       // thrown on popongo, say
  raw.sk.boards.popongo.best = 1200;
  const out = correctSkeeballRecord(raw, { classic: snapshotOf(raw.sk.boards.classic, '2026-08-24') });
  eq('a lifetime best from another machine survives the void', out.sk.bestGame, 1200);
}
{
  const raw = record();
  eq('no corrections is a pass-through', correctSkeeballRecord(raw, {}), raw);
  eq('a correction naming a machine this player never played changes nothing',
    correctSkeeballRecord(raw, { basketball: snapshotOf({}, '2026-08-24') }).sk.played, raw.sk.played);
}

console.log('\n--- a whole store, keyed by player-device ---');
{
  const stats = { version: 1, games: { skeeball: record(), uno: { total: { played: 3, won: 1, lost: 2 } } } };
  const all = { skeeball: { 'dev-A': { classic: snapshotOf(record().sk.boards.classic, '2026-08-24') } } };
  const mine = correctStats(stats, 'dev-A', all);
  eq('the named device is corrected', mine.games.skeeball.sk.played, 2);
  eq('another game in the same store is untouched', mine.games.uno, stats.games.uno);
  const other = correctStats(stats, 'dev-B', all);
  eq('a DIFFERENT device is not corrected by someone else\'s void', other, stats);
  eq('an empty corrections map is a pass-through', correctStats(stats, 'dev-A', {}), stats);
  eq('THE RAW STORE IS UNTOUCHED (rule 1)', stats.games.skeeball.sk.played, 14);
}

console.log('\n--- practice racks never reach the record ---');
{
  // The other half of the fix (js/game-stats.js): a rack thrown on a machine set to TESTING lands
  // in sk.practice, which nothing above counts. Structural, against the shipped file.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./js/game-stats.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function recordSkeeball'), src.indexOf('export function unlockSkeeballBoard'));
  ok('recordSkeeball has a practice branch', /if \(e\.practice\)/.test(body));
  // The branch must RETURN before any real counter is touched - that is the whole guarantee.
  const branch = body.slice(body.indexOf('if (e.practice)'), body.indexOf('bumpTotals'));
  ok('the practice branch returns before bumpTotals, the lifetime counters and the unlock',
    /return st;/.test(branch) && !/g\.sk\.played/.test(branch) && !/unlockBoard/.test(branch));
  ok('practice racks are written to sk.practice, not sk', /recordBoardGame\(g\.sk\.practice/.test(branch));
  const agg = readFileSync(new URL('./js/players-agg.js', import.meta.url), 'utf8');
  ok('players-agg carries practice across devices (rule 1) without folding it into any counter',
    /src\.sk\.practice/.test(agg) && /dst\.sk\.practice\.boards/.test(agg));
  const ui = readFileSync(new URL('./js/game-stats-ui.js', import.meta.url), 'utf8');
  ok('My Stats shows practice racks on their own labelled row (stored is not enough)',
    /sk\.practice/.test(ui) && /gs_sk_practice/.test(ui));
}

console.log(`\nStats corrections tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
