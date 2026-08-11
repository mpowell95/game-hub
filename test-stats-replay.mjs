// test-stats-replay.mjs - LAW rule 7 made runnable (CLAUDE.md "THE LAW", ARCH-REVIEW.md S7-3):
// real historical gamehub.stats shapes, written by the ACTUAL old writer code, loaded with the
// CURRENT js/game-stats.js, then checked against the ACTUAL visibility gates the UIs use.
//
// This test failing means someone's history just went invisible - the month-scale failure in
// ARCH-REVIEW.md S6, and the exact class of the July 2026 Ball Run incident (commits d7f284b
// through a5571f3).
//
// FIXTURE PROVENANCE - these are NOT hand-invented shapes (rule 7: "a migration test that seeds
// a synthetic new-shape store proves nothing"). Each literal below was produced by running the
// real historical writer headless (git show <commit>:js/game-stats.js, imported with a stubbed
// localStorage) and dumping what it wrote:
//
//   FIXTURE_PRE_METRIC   written by `git show d7f284b~1:js/game-stats.js` (the last pre-metric-
//                        change writer, SW v140 era): recordBallRun() in METERS
//                        (br.bestDistance/bestByDiff), 5 runs recorded (2 easy, 2 medium,
//                        1 hard), plus mancala/connect4/chinchon plays for cross-game sanity.
//   FIXTURE_BROKEN_ERA   the same device after ONE loadStats() under `git show
//                        d7f284b:js/game-stats.js` (v141, the era with the migration bug):
//                        br archived to brLegacyMeters VERBATIM-PLUS-BOLTED-ON-ZEROES (the
//                        fifth-playthrough hybrid: ensureBr had already stamped
//                        bestObstacles:0 fields onto it), live br zeroed including runs
//                        (the sixth-playthrough incident), no _brRunsRefolded yet.
//   FIXTURE_PRE_UNIFIED  a device that predates gamehub.stats entirely: only the per-game
//                        legacy stores 'chinchon-stats' (shape from chinchon/js/ui.js's
//                        STORE_STATS writer) and 'bd-stats' (business-deal/js/ui.js's
//                        _recordResult writer). No gamehub.stats key at all.
//
// The visibility gates below are REPLICAS of the real UI expressions - if the UI gates change,
// update these WITH them (each cites its source file:line as of this test's writing):
//   G1 game-stats-ui.js ballRunScreen:   `if (!runs && !legacy) return emptyState(...)`
//      (js/game-stats-ui.js:192 - visible iff br.runs > 0 OR brLegacyMeters exists)
//   G2 leaderboard-ui.js ballrunRows:    `.filter((g) => g.games.ballrun.br && (g.games.ballrun.br.runs | 0) > 0)`
//      (js/leaderboard-ui.js:81)
//   G3 game-stats-ui.js chinchonScreen:  `if (!finished) return emptyState(...)` where
//      finished = total.played (js/game-stats-ui.js:97-99)
//   G4 game-stats-ui.js recordScreen:    `if (!played) return emptyState(...)` (js/game-stats-ui.js:140)
//      - the gate for Monopoly Deal / Parchis tabs
//   G5 game-stats-ui.js ballRunScreen legacy table: renders `legacy.bestByDiff` meters rows when
//      brLegacyMeters exists (js/game-stats-ui.js:199-207) - archived data must stay SHOWN
//
// Node-only, no deps, players-agg.test.mjs idiom. Run: node test-stats-replay.mjs

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

let fail = 0;
function ok(name, cond) {
  if (cond) { console.log(`ok    ${name}`); return; }
  fail++; console.log(`FAIL  ${name}`);
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { console.log(`ok    ${name}`); return; }
  fail++; console.log(`FAIL  ${name}\n      got:  ${g}\n      want: ${w}`);
}

let backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => { backing.set(k, String(v)); },
  removeItem: (k) => { backing.delete(k); },
};
globalThis.self = globalThis;
const freshStore = (seed = {}) => { backing = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])); };

const gs = await import(pathToFileURL(join(ROOT, 'js', 'game-stats.js')).href);

// --- the real UI gates, replicated (sources cited in the header) ------------------
const gateStatsUiBallrun = (rec) => { const runs = ((rec.br || {}).runs | 0); const legacy = rec.brLegacyMeters || null; return !(!runs && !legacy); };  // G1
const gateLeaderboardBallrun = (rec) => !!(rec.br && (rec.br.runs | 0) > 0);                                                                             // G2
const gateStatsUiChinchon = (rec) => ((rec.total || {}).played | 0) > 0;                                                                                 // G3
const gateStatsUiRecord = (rec) => ((rec.total || {}).played | 0) > 0;                                                                                   // G4
const legacyTableRenders = (rec) => !!rec.brLegacyMeters;                                                                                                // G5

// ==================================================================================
// FIXTURE_PRE_METRIC - written by d7f284b~1 (see provenance header)
// ==================================================================================
const FIXTURE_PRE_METRIC = {"version":1,"games":{"connect4":{"total":{"played":2,"won":1,"lost":1},"byDiff":{"hard":{"played":1,"won":1,"lost":0},"expert":{"played":1,"won":0,"lost":1}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":1,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":1}}}},"chinchon":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"normal":{"played":1,"won":1,"lost":0}},"cc":{"closed":3,"minusTen":1,"chinchons":0},"_leg":true,"_ccSeeded":true},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"_leg":true},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"pro":{"played":1,"won":1,"lost":0}}},"ballrun":{"total":{"played":5,"won":5,"lost":0},"byDiff":{"easy":{"played":2,"won":2,"lost":0},"medium":{"played":2,"won":2,"lost":0},"hard":{"played":1,"won":1,"lost":0}},"br":{"runs":5,"bestDistance":300,"bestByDiff":{"easy":123,"medium":300,"hard":55}}}},"updatedAt":"2026-07-01T00:00:00.000Z"};

// ==================================================================================
// FIXTURE_BROKEN_ERA - FIXTURE_PRE_METRIC after one load under d7f284b (see header)
// ==================================================================================
const FIXTURE_BROKEN_ERA = {"version":1,"games":{"connect4":{"total":{"played":2,"won":1,"lost":1},"byDiff":{"hard":{"played":1,"won":1,"lost":0},"expert":{"played":1,"won":0,"lost":1}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":1,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":1}}}},"chinchon":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"normal":{"played":1,"won":1,"lost":0}},"cc":{"closed":3,"minusTen":1,"chinchons":0},"_leg":true,"_ccSeeded":true},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"_leg":true},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"pro":{"played":1,"won":1,"lost":0}}},"ballrun":{"total":{"played":5,"won":5,"lost":0},"byDiff":{"easy":{"played":2,"won":2,"lost":0},"medium":{"played":2,"won":2,"lost":0},"hard":{"played":1,"won":1,"lost":0}},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"medium":0,"hard":0}},"_brMetricMigrated":true,"brLegacyMeters":{"runs":5,"bestDistance":300,"bestByDiff":{"easy":123,"medium":300,"hard":55},"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"medium":0,"hard":0}}}},"updatedAt":"2026-07-01T00:00:00.000Z"};

// ==================================================================================
// FIXTURE_PRE_UNIFIED - per-game legacy stores only, no gamehub.stats (see header)
// ==================================================================================
const FIXTURE_PRE_UNIFIED = {
  'chinchon-stats': { games: 12, wins: 5, losses: 6, closes: 9, chinchons: 1, minusTen: 2 },
  'bd-stats': { played: 7, won: 4, lost: 3 },
};

// --- scenario A: a pre-metric device upgrades straight to CURRENT code ------------
{
  freshStore({ 'gamehub.stats': FIXTURE_PRE_METRIC });
  const st = gs.loadStats();
  const br = st.games.ballrun;

  eq('A: play count survives the metric migration (runs refolded, LAW rule 3)', br.br.runs, 5);
  eq('A: totals untouched', br.total, { played: 5, won: 5, lost: 0 });
  ok('A: meter bests archived, never converted (LAW rule 4)', br.brLegacyMeters && br.brLegacyMeters.bestDistance === 300 && br.brLegacyMeters.bestByDiff.medium === 300);
  eq('A: live obstacle metric starts fresh at 0', [br.br.bestObstacles, br.br.bestObstaclesByDiff.easy], [0, 0]);
  ok('A: G1 stats screen shows Ball Run', gateStatsUiBallrun(br));
  ok('A: G2 leaderboard shows Ball Run (runs > 0)', gateLeaderboardBallrun(br));
  ok('A: G5 legacy meters table renders', legacyTableRenders(br));
  ok('A: other games untouched (mancala/connect4/chinchon)', st.games.mancala.total.played === 1 && st.games.connect4.total.played === 2 && st.games.chinchon.cc.closed === 3);

  // Idempotency: a second load must not change anything (guards all set).
  const again = JSON.stringify(gs.loadStats().games.ballrun);
  eq('A: second load is a no-op (all guards latched)', JSON.parse(again).br.runs, 5);
}

// --- scenario B: a device that migrated under the BROKEN era gets repaired --------
{
  freshStore({ 'gamehub.stats': FIXTURE_BROKEN_ERA });
  const st = gs.loadStats();
  const br = st.games.ballrun;

  eq('B: zeroed runs are repaired from the archive (a5571f3 refold)', br.br.runs, 5);
  ok('B: archive itself is preserved, not consumed (LAW rule 5)', br.brLegacyMeters && br.brLegacyMeters.runs === 5 && br.brLegacyMeters.bestDistance === 300);
  ok('B: G1 stats screen shows Ball Run again', gateStatsUiBallrun(br));
  ok('B: G2 leaderboard shows Ball Run again', gateLeaderboardBallrun(br));
  ok('B: G5 legacy meters table renders', legacyTableRenders(br));

  // A new run on the repaired device keeps counting on top of the restored count.
  gs.recordBallRun(7, 'medium');
  const after = gs.loadStats().games.ballrun;
  eq('B: next recorded run lands on top (5 + 1)', after.br.runs, 6);
  eq('B: obstacle best is the new metric only', after.br.bestObstacles, 7);
}

// --- scenario C: a pre-unified device (legacy stores only) folds in and stays visible
{
  freshStore(FIXTURE_PRE_UNIFIED);
  const st = gs.loadStats();

  eq('C: chinchon folded from chinchon-stats', st.games.chinchon.total, { played: 12, won: 5, lost: 6 });
  eq('C: chinchon byDiff.legacy snapshot', st.games.chinchon.byDiff.legacy, { played: 12, won: 5, lost: 6 });
  eq('C: chinchon close-quality counters seeded', st.games.chinchon.cc, { closed: 9, minusTen: 2, chinchons: 1 });
  eq('C: business folded from bd-stats', st.games.business.total, { played: 7, won: 4, lost: 3 });
  ok('C: G3 chinchon stats tab visible', gateStatsUiChinchon(st.games.chinchon));
  ok('C: G4 Monopoly Deal stats tab visible', gateStatsUiRecord(st.games.business));
  ok('C: legacy source keys never deleted (LAW rule 5)', backing.has('chinchon-stats') && backing.has('bd-stats'));

  // Fold-once: another load plus a new game must not re-fold.
  gs.recordResult('business', 'normal', true);
  eq('C: fold-once holds across a follow-up game (7 + 1)', gs.loadStats().games.business.total, { played: 8, won: 5, lost: 3 });
}

// --- scenario D: Escoba's multiplayer plays come back out of the AI bucket -------------------
//
// THE LAW rule 7, literally: these five fixtures are the REAL escoba records of the only five
// devices in players/ that have any head-to-head history, read straight out of Firebase on
// 2026-08-11 and pasted here unedited. Not synthetic, not rounded, not "representative".
//
// The migration (splitEscobaMp in js/game-stats.js) moves out exactly what h2h PROVES was
// multiplayer and nothing more. What must hold on every one of them:
//   * total is byte-identical before and after - no play is created or destroyed
//   * byDiff.mp gains exactly the h2h w/l, byDiff.normal loses exactly that
//   * byDiff still sums to total
//   * it runs ONCE: a later match, and a later load, must not extract a second time
{
  // deviceId, the device's real escoba record, its real h2h.escoba map
  const REAL = [
    ['0feee28f (Anita Bonita)',
      { total: { played: 2, won: 2, lost: 0 }, byDiff: { normal: { played: 2, won: 2, lost: 0 } }, es: { escobas: 3 } },
      { oppA: { name: 'MattyIce', w: 1, l: 0 } }],
    ['1f75ff86 (Anita Bonita)',
      { total: { played: 6, won: 5, lost: 1 }, byDiff: { easy: { played: 1, won: 1, lost: 0 }, normal: { played: 5, won: 4, lost: 1 } }, es: { escobas: 11 } },
      { oppA: { name: 'MattyIce', w: 3, l: 1 }, oppB: { name: 'Unai', w: 1, l: 0 } }],
    ['288dc3cd (Lili)',
      { total: { played: 72, won: 31, lost: 41 }, byDiff: { hard: { played: 41, won: 11, lost: 30 }, normal: { played: 31, won: 20, lost: 11 } }, es: { escobas: 96 } },
      { oppA: { name: 'MattyIce', w: 4, l: 4 }, oppB: { name: 'Unai', w: 3, l: 2 }, oppC: { name: 'Bego', w: 1, l: 1 } }],
    ['a6a1f72b (Unai)',
      { total: { played: 29, won: 18, lost: 11 }, byDiff: { normal: { played: 29, won: 18, lost: 11 } }, es: { escobas: 40 } },
      { oppA: { name: 'Lili', w: 5, l: 4 } }],
    ['dc1745bc (MattyIce)',
      { total: { played: 8, won: 6, lost: 2 }, byDiff: { easy: { played: 4, won: 3, lost: 1 }, normal: { played: 4, won: 3, lost: 1 } }, es: { escobas: 12 } },
      { oppA: { name: 'Anita Bonita', w: 1, l: 0 }, oppB: { name: 'Lili', w: 0, l: 1 } }],
  ];
  const sum = (bd) => Object.values(bd).reduce((a, b) => ({
    played: a.played + (b.played | 0), won: a.won + (b.won | 0), lost: a.lost + (b.lost | 0),
  }), { played: 0, won: 0, lost: 0 });

  for (const [label, escoba, h2h] of REAL) {
    const before = JSON.parse(JSON.stringify(escoba));
    const hw = Object.values(h2h).reduce((n, r) => n + (r.w | 0), 0);
    const hl = Object.values(h2h).reduce((n, r) => n + (r.l | 0), 0);
    freshStore({ 'gamehub.stats': { version: 1, games: { escoba: before }, h2h: { escoba: h2h } } });
    const g = gs.loadStats().games.escoba;

    eq(`D ${label}: total is UNTOUCHED (no play created or destroyed)`, g.total, escoba.total);
    eq(`D ${label}: byDiff.mp is exactly what head-to-head proves`, g.byDiff.mp, { played: hw + hl, won: hw, lost: hl });
    eq(`D ${label}: the AI bucket lost exactly that much`, g.byDiff.normal,
      { played: (escoba.byDiff.normal.played | 0) - (hw + hl), won: (escoba.byDiff.normal.won | 0) - hw, lost: (escoba.byDiff.normal.lost | 0) - hl });
    eq(`D ${label}: byDiff still sums to total`, sum(g.byDiff), escoba.total);
    ok(`D ${label}: the escoba counter is untouched`, (g.es.escobas | 0) === (escoba.es.escobas | 0));
    ok(`D ${label}: the migration archived what it did (LAW rule 5, reversible by hand)`,
      !!g.esMpSplit && g.esMpSplit.moved.won === hw && g.esMpSplit.moved.lost === hl
      && g.esMpSplit.normalBefore.played === (escoba.byDiff.normal.played | 0));
    ok(`D ${label}: nothing was left unresolved (h2h and byDiff agree)`,
      g.esMpSplit.unresolved.won === 0 && g.esMpSplit.unresolved.lost === 0);

    // Run-once, the way it actually gets stressed: another load, then a real new MP match.
    gs.loadStats();
    gs.recordEscoba('mp', true, { escobas: 2 });
    gs.recordHeadToHead('escoba', { deviceId: 'oppA', name: 'X' }, true);
    const after = gs.loadStats().games.escoba;
    eq(`D ${label}: a second load + a new MP match extract nothing further`, after.byDiff.mp,
      { played: hw + hl + 1, won: hw + 1, lost: hl });
    eq(`D ${label}: ...and the AI bucket stays where the migration left it`, after.byDiff.normal, g.byDiff.normal);
  }
}

// --- scenario E: the migration's edges, which no real device happens to exercise -------------
{
  // A device whose h2h claims MORE than `normal` can release must not drive a counter negative,
  // must not invent the difference elsewhere, and must say so.
  freshStore({ 'gamehub.stats': {
    version: 1,
    games: { escoba: { total: { played: 3, won: 2, lost: 1 }, byDiff: { normal: { played: 3, won: 2, lost: 1 } }, es: { escobas: 0 } } },
    h2h: { escoba: { oppA: { name: 'X', w: 5, l: 4 } } },
  } });
  const g = gs.loadStats().games.escoba;
  eq('E: disagreement clamps to what the bucket held, never negative', g.byDiff.normal, { played: 0, won: 0, lost: 0 });
  eq('E: ...and moves only that much', g.byDiff.mp, { played: 3, won: 2, lost: 1 });
  eq('E: total STILL untouched', g.total, { played: 3, won: 2, lost: 1 });
  ok('E: the surplus is recorded as unresolved rather than invented',
    g.esMpSplit.unresolved.won === 3 && g.esMpSplit.unresolved.lost === 3);

  // A solo-only device: no h2h at all. Nothing moves, and the AI bucket is left exactly alone.
  freshStore({ 'gamehub.stats': {
    version: 1,
    games: { escoba: { total: { played: 4, won: 3, lost: 1 }, byDiff: { normal: { played: 4, won: 3, lost: 1 } }, es: { escobas: 5 } } },
  } });
  const solo = gs.loadStats().games.escoba;
  eq('E: a solo-only device keeps its whole AI record', solo.byDiff.normal, { played: 4, won: 3, lost: 1 });
  ok('E: ...and grows no empty mp bucket', !solo.byDiff.mp);
  ok('E: ...but is still latched, so it never reconsiders', solo._esMpSplit === true);

  // A device with head-to-head but NO escoba plays (h2h from a game whose result write failed).
  freshStore({ 'gamehub.stats': { version: 1, games: {}, h2h: { escoba: { oppA: { name: 'X', w: 1, l: 0 } } } } });
  const orphan = gs.loadStats().games.escoba;
  eq('E: h2h with an empty record moves nothing and stays non-negative', orphan.byDiff.normal, { played: 0, won: 0, lost: 0 });
  eq('E: total is still zero', orphan.total, { played: 0, won: 0, lost: 0 });
}

// --- scenario F: a result whose write fails is QUEUED, not lost ------------------------------
//
// Matt, 2026-08-11: "Nothing should ever be able to be lost. That's the rule." Once the engine
// records at the instant it decides (escoba/js/game.js's onDecided), the last way to lose a
// result is the write itself failing. This proves it survives that.
{
  freshStore({});
  gs.loadStats();
  const realSet = globalThis.localStorage.setItem;
  // Fail ONLY the big stats blob, exactly like a quota error does: the small queue key still fits.
  globalThis.localStorage.setItem = (k, v) => {
    if (k === 'gamehub.stats') throw new Error('QuotaExceededError (simulated)');
    return realSet(k, v);
  };
  gs.recordEscoba('mp', true, { escobas: 4 });
  gs.recordHeadToHead('escoba', { deviceId: 'oppZ', name: 'Bego' }, true);
  globalThis.localStorage.setItem = realSet;

  ok('F: the failed result was parked in its own key, not dropped', !!backing.get('gamehub.pendingResults.v1'));
  const st = gs.loadStats();
  eq('F: the next load applies it', st.games.escoba.total, { played: 1, won: 1, lost: 0 });
  eq('F: ...into the right bucket', st.games.escoba.byDiff.mp, { played: 1, won: 1, lost: 0 });
  ok('F: ...with its escobas', (st.games.escoba.es.escobas | 0) === 4);
  ok('F: ...and the head-to-head row too', ((st.h2h.escoba || {}).oppZ || {}).w === 1);
  ok('F: the queue is emptied once applied', !backing.get('gamehub.pendingResults.v1'));
  eq('F: and it is not applied twice', gs.loadStats().games.escoba.total, { played: 1, won: 1, lost: 0 });
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
