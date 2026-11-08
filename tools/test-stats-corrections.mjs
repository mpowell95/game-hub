import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-stats-corrections.mjs - headless tests for js/stats-corrections.js, the admin overlay that
// makes "those scores were thrown on a broken board" stick.
//
// Run: node tools/test-stats-corrections.mjs   (also wired into run-all-tests.mjs)
//
// WHAT IS AND IS NOT COVERED: the maths - what a void removes, what it deliberately leaves alone,
// and that a score thrown AFTER the void counts normally. The Firebase write (js/admin-config.js's
// setSkeeballCorrection) and the admin page's Scores section need a browser and a real database and
// are not covered here, the same caveat test-admin-config.mjs carries.
//
// Since 2026-11-03 it also covers the integrity voids for Golf (a voided record has NO best round, so it sorts
// LAST instead of first) and Contexto (the Daily tab's own counters, ct.d, are voided with the rest); the
// last section builds those records with the games' own recorders and runs them through the real aggregation.
//
// THE LAW is the reason most of these assertions exist. A correction is an OVERLAY, so:
//   rule 1  the raw record is never touched - every test below checks the input is unchanged
//   rule 2  nothing is subtracted from a counter it cannot be attributed to (balls, 100s, 50s and
//           the colour counters have no per-machine breakdown, so a per-machine void leaves them)
//   rule 4  a best is not a sum and cannot be un-summed: it survives only if a later score beat the
//           voided one, and otherwise reads 0 rather than an invented number

import { correctBoard, correctSkeeballRecord, correctStats, correctionFor, snapshotOf, voidIntegrityGame } from '../js/stats-corrections.js';

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
  const src = readFileSync(new URL('./js/game-stats.js', __ROOT_URL), 'utf8');
  const body = src.slice(src.indexOf('export function recordSkeeball'), src.indexOf('export function unlockSkeeballBoard'));
  ok('recordSkeeball has a practice branch', /if \(e\.practice\)/.test(body));
  // The branch must RETURN before any real counter is touched - that is the whole guarantee.
  const branch = body.slice(body.indexOf('if (e.practice)'), body.indexOf('bumpTotals'));
  ok('the practice branch returns before bumpTotals, the lifetime counters and the unlock',
    /return st;/.test(branch) && !/g\.sk\.played/.test(branch) && !/unlockBoard/.test(branch));
  ok('practice racks are written to sk.practice, not sk', /recordBoardGame\(g\.sk\.practice/.test(branch));
  const agg = readFileSync(new URL('./js/players-agg.js', __ROOT_URL), 'utf8');
  ok('players-agg carries practice across devices (rule 1) without folding it into any counter',
    /src\.sk\.practice/.test(agg) && /dst\.sk\.practice\.boards/.test(agg));
  const ui = readFileSync(new URL('./js/game-stats-ui.js', __ROOT_URL), 'utf8');
  ok('My Stats shows practice racks on their own labelled row (stored is not enough)',
    /sk\.practice/.test(ui) && /gs_sk_practice/.test(ui));
}

console.log('\n--- integrity voids: Golf must not rank first, Contexto must not keep its Daily medals (2026-11-03) ---');
// Records are written by the games' OWN recorders (js/game-stats.js), like tools/test-integrity.mjs, so
// the voided shape is the one a real device produces. The two bugs this pins:
//   GOLF     the void zeroed gf.bestRoundByCourse; players-agg merges that map with Math.min, so the 0
//            beat every real round across a person's devices, and golfBestAt read it as 0 minus par
//            ("12 under"): a voided player ranked FIRST. (The void's own header says it "sorts last".)
//   CONTEXTO the void zeroed ct.* but not ct.d, the Daily tab's own copy, so a voided player kept every
//            Daily medal (and fewestNH, a best, was left too).
{
  const { readFileSync } = await import('node:fs');
  const lsStore = new Map();
  globalThis.localStorage = {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => void lsStore.set(k, String(v)),
    removeItem: (k) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: (i) => Array.from(lsStore.keys())[i] ?? null,
    get length() { return lsStore.size; },
  };
  const G = await import('../js/game-stats.js');
  const AGG = await import('../js/players-agg.js');
  const RANK = await import('../js/leaderboard-rank.js');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const warn = console.error; console.error = () => {};   // "ran OUTSIDE withMode": true here, and not what this test is about

  G.recordGolf('pinevalley', { courseId: 'pinevalley3', holes: 3, strokes: 10, points: 14, birdies: 1, longestDriveYd: 250,
    holeScores: { 'pinevalley:1': 3, 'pinevalley:2': 3, 'pinevalley:3': 4 } });
  G.recordGolf('pinevalley', { courseId: 'pinevalley9', holes: 9, strokes: 38, points: 20,
    holeScores: { 'pinevalley:4': 4, 'pinevalley:5': 4 } });
  // Contexto: a gold, a silver, a bronze and a give-up ON THEIR DAY (daily: true), then a gold from before
  // the Daily board existed (no day recorded).
  G.recordContexto('en', true, { guesses: 4, hints: 0, daily: true });
  G.recordContexto('en', true, { guesses: 9, hints: 1, daily: true });
  G.recordContexto('en', true, { guesses: 20, hints: 2, daily: true });
  G.recordContexto('en', false, { guesses: 0, hints: 3, daily: true });
  G.recordContexto('en', true, { guesses: 30, hints: 0 });
  console.error = warn;
  const stored = G.loadStoredStats();
  const golfRaw = stored.games.golf, ctRaw = stored.games.contexto;
  ok('the recorders wrote what this test assumes (2 golf rounds, 4 daily Contexto plays)',
    golfRaw.gf.rounds === 2 && ctRaw.ct.d && ctRaw.ct.d.played === 4 && ctRaw.ct.d.noHint === 1 && ctRaw.ct.noHint === 2,
    JSON.stringify([golfRaw.gf.rounds, ctRaw.ct.d, ctRaw.ct.noHint]));

  console.log('\n  -- Golf --');
  const golfBefore = JSON.stringify(golfRaw);
  const golfV = voidIntegrityGame(golfRaw, 'golf');
  eq('GOLF void: no best round on any course (absent, not 0)', golfV.gf.bestRoundByCourse, {});
  eq('GOLF void: no hole records either', golfV.gf.bestHole, {});
  ok('GOLF void: the rounds still count as PLAYED, with no win and no points',
    golfV.gf.rounds === 2 && golfV.gf.holes === 12 && golfV.total.played === 2 && golfV.total.won === 0 && golfV.gf.points === 0);
  eq('THE RAW GOLF RECORD IS UNTOUCHED (rule 1)', JSON.stringify(golfRaw), golfBefore);
  eq('an honest record still reads 2 under on Pine Valley (holes 1-3)', RANK.golfBestAt({ games: { golf: golfRaw } }), -2);
  eq('the voided record has NO number', RANK.golfBestAt({ games: { golf: golfV } }), null);
  {
    // A board built BEFORE this fix still carries { pinevalley3: 0 } until the server rebuilds it.
    const old = clone(golfRaw); old.gf.bestRoundByCourse = { pinevalley3: 0, pinevalley9: 0 };
    eq('an already-built board with best round 0 reads as no number, never "12 under"', RANK.golfBestAt({ games: { golf: old } }), null);
  }
  {
    const worse = clone(golfRaw); worse.gf.bestRoundByCourse = { pinevalley3: 14 };          // 2 over
    const rows = [['voided', golfV], ['honest', golfRaw], ['over par', worse]]
      .map(([name, golf]) => ({ name, v: RANK.golfBestAt({ games: { golf } }) }))
      .sort((a, b) => RANK.compareBoardMetric(a.v, b.v, 'golf'));
    eq('the Golf board order: best honest round, worse honest round, the voided record LAST',
      rows.map((r) => r.name), ['honest', 'over par', 'voided']);
  }
  {
    // Through the real aggregation: a person with a voided phone AND an honest one, and a person whose only
    // phone is voided. Alex's honest +1 must stand (the void must not win the cross-device Math.min).
    const dev = (name, code, golf) => ({ profile: { name, playerId: code }, stats: { games: { golf: clone(golf) } }, updatedAt: 1 });
    const alexOther = clone(golfRaw); alexOther.gf.bestRoundByCourse = { pinevalley3: 13 };     // 1 over
    const caseyRec = clone(golfRaw); caseyRec.gf.bestRoundByCourse = { pinevalley3: 14 };       // 2 over
    const players = { a1: dev('Alex', 'AAAAA', golfRaw), a2: dev('Alex', 'AAAAA', alexOther),
      b1: dev('Blake', 'BBBBB', golfRaw), c1: dev('Casey', 'CCCCC', caseyRec) };
    const groups = AGG.aggregatePlayers(players, { integrity: { a1: { golf: true }, b1: { golf: true } } });
    const num = (name) => RANK.golfBestAt(groups.find((g) => g.name === name));
    eq('aggregated: a person\'s honest phone keeps its best when the other phone is voided', num('Alex'), 1);
    eq('aggregated: a person whose only phone is voided has no number', num('Blake'), null);
    eq('aggregated: an honest player is unaffected', num('Casey'), 2);
    const order = groups.map((g) => ({ name: g.name, v: RANK.golfBestAt(g) })).sort((a, b) => RANK.compareBoardMetric(a.v, b.v, 'golf')).map((r) => r.name);
    eq('aggregated Golf board: Alex, Casey, then Blake (voided) last', order, ['Alex', 'Casey', 'Blake']);
    ok('the voided phone is still PLAYED on the person\'s record (Blake: 2 rounds, 0 wins)',
      groups.find((g) => g.name === 'Blake').games.golf.total.played === 2 && groups.find((g) => g.name === 'Blake').games.golf.total.won === 0);
  }
  {
    const ui = readFileSync(new URL('./js/game-stats-ui.js', __ROOT_URL), 'utf8');
    ok('My Stats\' Golf table skips a stored 0 round (no "12 under" row for a record voided before the fix)',
      /Object\.keys\(gf\.bestRoundByCourse \|\| \{\}\)\.filter\(\(id\) => gf\.bestRoundByCourse\[id\] > 0\)/.test(ui));
  }

  console.log('\n  -- Contexto --');
  const ctBefore = JSON.stringify(ctRaw);
  const ctV = voidIntegrityGame(ctRaw, 'contexto');
  ok('CONTEXTO void: every lifetime medal, solve, guess count and best is 0',
    ['solved', 'noHint', 'silver', 'bronze', 'guesses', 'fewest', 'fewestNH'].every((k) => ctV.ct[k] === 0),
    JSON.stringify(ctV.ct));
  ok('CONTEXTO void: the DAILY medals, solves and guesses are 0 too (the Daily tab reads ct.d)',
    ['solved', 'noHint', 'silver', 'bronze', 'guesses'].every((k) => ctV.ct.d[k] === 0), JSON.stringify(ctV.ct.d));
  ok('CONTEXTO void: the daily puzzles still count as PLAYED (4) and the hints used stay (a count)',
    ctV.ct.d.played === 4 && ctV.ct.d.hints === ctRaw.ct.d.hints && ctV.ct.hints === ctRaw.ct.hints && ctV.total.played === 5 && ctV.total.won === 0);
  eq('THE RAW CONTEXTO RECORD IS UNTOUCHED (rule 1)', JSON.stringify(ctRaw), ctBefore);
  ok('an honest daily record scores medals; the voided one scores 0', RANK.ctMedalScore(ctRaw.ct.d) > 0 && RANK.ctMedalScore(ctV.ct.d) === 0 && RANK.ctMedalScore(ctV.ct) === 0);
  ok('the Daily tab: the voided player sorts BELOW an honest one', RANK.compareContexto(ctRaw.ct.d, ctV.ct.d) < 0);
  {
    // No Daily counters at all (plays from before the Daily board): no `d` and no `fewestNH` is invented.
    const old = { total: { played: 3, won: 3, lost: 0 }, byDiff: {}, ct: { solved: 3, guesses: 9, hints: 0, noHint: 3, silver: 0, bronze: 0, fewest: 2 } };
    const v = voidIntegrityGame(old, 'contexto');
    ok('a Contexto record with no Daily counters voids without inventing any', !('d' in v.ct) && !('fewestNH' in v.ct) && v.ct.noHint === 0 && v.total.played === 3);
  }
  {
    // Through the real aggregation: Dana's voided phone must not add its Daily medals to her honest phone's.
    const dev = (name, code, contexto) => ({ profile: { name, playerId: code }, stats: { games: { contexto: clone(contexto) } }, updatedAt: 1 });
    const honest = { total: { played: 2, won: 2, lost: 0 }, byDiff: {}, ct: { solved: 2, guesses: 10, hints: 0, noHint: 2, silver: 0, bronze: 0, fewest: 5, fewestNH: 5,
      d: { played: 2, solved: 2, guesses: 10, hints: 0, noHint: 2, silver: 0, bronze: 0 } } };
    const players = { d1: dev('Dana', 'DDDDD', ctRaw), d2: dev('Dana', 'DDDDD', honest), e1: dev('Eli', 'EEEEE', ctRaw), f1: dev('Fay', 'FFFFF', honest) };
    const groups = AGG.aggregatePlayers(players, { integrity: { d1: { contexto: true }, e1: { contexto: true } } });
    const ct = (name) => groups.find((g) => g.name === name).games.contexto.ct;
    ok('aggregated: Dana\'s Daily medals are her honest phone\'s only (2 gold), not plus the voided phone\'s', ct('Dana').d.noHint === 2 && ct('Dana').d.solved === 2 && ct('Dana').d.silver === 0 && ct('Dana').d.bronze === 0, JSON.stringify(ct('Dana').d));
    ok('aggregated: Eli (only phone voided) has no Daily medals but still played 4 daily puzzles',
      ct('Eli').d.noHint === 0 && ct('Eli').d.solved === 0 && ct('Eli').d.played === 4 && !(ct('Eli').fewestNH > 0), JSON.stringify(ct('Eli')));
    ok('aggregated Daily order: Fay and Dana (honest) both rank above Eli (voided)',
      RANK.compareContexto(ct('Fay').d, ct('Eli').d) < 0 && RANK.compareContexto(ct('Dana').d, ct('Eli').d) < 0);
  }
  {
    // The guard that makes the NEXT daily counter safe: every field players-agg sums in ct.d is zeroed by
    // the void, except the two that are counts of games / hints.
    const agg = readFileSync(new URL('./js/players-agg.js', __ROOT_URL), 'utf8');
    const m = /for \(const k of (\[[^\]]*\])\) dst\.ct\.d\[k\]/.exec(agg);
    const list = m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
    ok('players-agg\'s ct.d field list was found', list.length >= 6 && list.includes('noHint'), JSON.stringify(list));
    const KEPT = ['played', 'hints'];
    const probe = { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ct: { solved: 1, d: Object.fromEntries(list.map((k) => [k, 7])) } };
    const out = voidIntegrityGame(probe, 'contexto').ct.d;
    const leaked = list.filter((k) => !KEPT.includes(k) && out[k] !== 0);
    ok('every Daily counter the aggregator sums is zeroed by the void (except played, hints)', leaked.length === 0, `not zeroed: ${leaked.join(', ')}`);
    ok('...and played / hints are the ones kept', KEPT.every((k) => out[k] === 7));
    const lb = readFileSync(new URL('./js/leaderboard-ui.js', __ROOT_URL), 'utf8');
    ok('the Daily tab reads ct.d (so zeroing ct.d is what empties it)', /const ctDailyOf = \(g\) => ctOf\(g\)\.d \|\| \{\}/.test(lb));
  }
}

// HAND RESULTS (2026-11-08, Matt: "That test win should count"): filed as the recorder would, before the full-level move.
{
  const SC = await import('../js/stats-corrections.js');
  const e = { code: 'TSTX1', diff: 'medium', chosen: 'hard', mode: 'def=defend|first=them|goals=1|off=balanced|test=1', won: true, detail: { gf: 1, ga: 0, flicks: 6 } };
  SC.HAND_RESULTS.flicksoccer.push(e);
  const gm = { total: { played: 2, won: 1, lost: 1 }, byDiff: { medium: { played: 2, won: 1, lost: 1 } }, byMode: {}, dt: { gf: 1, ga: 1, flicks: 9, _n: 2 } };
  const out = SC.handResultsGame(gm, 'flicksoccer', e.code);
  ok('hand result: one more win in the recorded bucket and the total', out.byDiff.medium.won === 2 && out.total.won === 2 && out.total.played === 3);
  ok('hand result: its byMode row at the chosen level', out.byMode[e.mode][e.chosen].won === 1);
  ok('hand result: its detail added', out.dt.gf === 2 && out.dt._n === 3);
  ok('hand result: the record passed in is not changed', gm.total.won === 1 && !gm.byMode[e.mode]);
  ok('hand result: nobody else gets it', SC.handResultsGame(gm, 'flicksoccer', 'ZZZZZ') === gm);
  const shown = SC.fullLevelGame(out, 'flicksoccer', e.code);
  ok('hand result: a first-to-1 Hard win shows at Hard', shown.byDiff.hard && shown.byDiff.hard.won === 1);
  SC.HAND_RESULTS.flicksoccer.pop();
}
// FLICK SOCCER TEST GAMES COUNT (2026-11-08, Matt: "count all test games"): fx rows with test=1, wins and losses.
{
  const SC = await import('../js/stats-corrections.js');
  const gm = { total: { played: 1, won: 1, lost: 0 }, byDiff: { easy: { played: 1, won: 1, lost: 0 } }, byMode: {},
    fx: { byDiff: { hard: { played: 3, won: 2, lost: 1 }, expert: { played: 4, won: 0, lost: 4 } }, byMode: {
      'def=defend|first=me|goals=1|off=attack|test=1': { hard: { played: 1, won: 1, lost: 0 } },
      'def=defend|first=them|goals=1|off=attack|test=1': { hard: { played: 1, won: 0, lost: 1 } },
      'def=defend|first=me|goals=2|off=attack|test=1': { hard: { played: 1, won: 1, lost: 0 } },
      'def=defend|first=me|goals=1|off=attack': { expert: { played: 4, won: 0, lost: 4 } } } } };
  const out = SC.flickTestGame(gm);
  ok('test games: total adds every Test game, wins and losses', out.total.played === 4 && out.total.won === 3 && out.total.lost === 1, JSON.stringify(out.total));
  ok('test games: first to 1 filed one level down (as recorded)', out.byDiff.medium.played === 2 && out.byDiff.medium.won === 1);
  ok('test games: first to 2 at its own level', out.byDiff.hard.played === 1 && out.byDiff.hard.won === 1);
  ok('test games: Expert stays out', !out.byDiff.expert);
  ok('test games: the record passed in is not changed', gm.total.played === 1 && !gm.byDiff.medium);
  ok('test games: a record with no Test games is returned as is', SC.flickTestGame({ total: { played: 1 } }).total.played === 1);
  const shown = SC.fullLevelGame(out, 'flicksoccer', 'X');
  ok('test games: first-to-1 Hard ones show at Hard', shown.byDiff.hard.played === 3 && shown.byDiff.hard.won === 2, JSON.stringify(shown.byDiff));
}

console.log(`\nStats corrections tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
