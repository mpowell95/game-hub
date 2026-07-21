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

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
