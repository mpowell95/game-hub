// test-recorder-contract.mjs - contract test between the TWO implementations of the
// stats-write path (ARCH-REVIEW.md S3-1 / S5-8):
//
//   js/game-stats.js         the ES-module recorder (hub + module games)
//   js/game-stats-global.js  the classic window.__ghStats port (Business Deal, Parchis)
//
// Identical input sequences must produce equivalent localStorage['gamehub.stats']
// structures ON THE SHARED SURFACE. The two implementations legitimately differ in
// scope; this test deliberately covers ONLY what both claim to do:
//
//   COVERED (the contract):
//     - record(gameId, difficulty, won) semantics for 'business' and 'parchis'
//       (played/won/lost totals, byDiff bucketing, difficulty normalization,
//       draw = played only)
//     - the one-time legacy folds (chinchon-stats -> chinchon, bd-stats -> business)
//       including the _leg fold-once guard, and that the guard INTEROPERATES:
//       whichever implementation folds first, the other must skip
//     - unknown gameIds are rejected by both
//     - the Business Deal pending-stats drain (gamehub.bd.pendingStats.v1) routes
//       through record() and clears the queue (global port only - the ESM side's
//       equivalent drain lives in game-stats.js and is covered by its own callers)
//     - business-deal/js/game-stats-global.js must be a BYTE-IDENTICAL copy of
//       js/game-stats-global.js (CLAUDE.md "Business Deal's must-stay-synced
//       duplicates" item 3)
//
//   EXCLUDED (documented, deliberate - do not "fix" a failure by widening this list
//   without reading ARCH-REVIEW.md S3-1 first):
//     - ESM-only migrations and extras: the Ball Run metric migration
//       (_brMetricMigrated/_brRunsRefolded/brLegacyMeters), chinchon cc seeding
//       (_ccSeeded), connect4 grid, nutsbolts nb, escoba es, per-game ensure* shapes
//     - the ESM normalize() creating all 9 game buckets vs the global port's 4
//     - updatedAt timestamps
//
// Node-only, no deps, mirrors players-agg.test.mjs's idiom. Run: node test-recorder-contract.mjs

import { readFileSync } from 'node:fs';
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

// --- localStorage stub with a swappable backing store -----------------------------
// Both implementations read the GLOBAL localStorage at call time, so one facade with
// a swappable Map lets each scenario run on a fresh store without re-importing.
let backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => { backing.set(k, String(v)); },
  removeItem: (k) => { backing.delete(k); },
};
globalThis.self = globalThis;   // game-stats-global.js attaches to self.__ghStats
const freshStore = (seed = {}) => { backing = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])); };
const readStats = () => JSON.parse(backing.get('gamehub.stats') || 'null');

// --- BD in-scope copy stays in sync (checked before anything else, needs no stub) -
// CLAUDE.md ("Business Deal's must-stay-synced duplicates" item 3) calls the copy
// "byte-identical"; in reality business-deal/js/game-stats-global.js prepends a
// 13-line why-this-copy-exists header ending in the marker line below, and the code
// AFTER the marker is the canonical file verbatim. The enforceable invariant is that
// verbatim-after-marker property (the CLAUDE.md wording is the inaccuracy, noted in
// the tripwire report - not a code bug).
// Line endings are normalized before comparing: the canonical file is CRLF on a
// Windows checkout while the copy is LF - a checkout artifact, not drift.
{
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const canonical = norm(readFileSync(join(ROOT, 'js', 'game-stats-global.js'), 'utf8'));
  const copy = norm(readFileSync(join(ROOT, 'business-deal', 'js', 'game-stats-global.js'), 'utf8'));
  const MARKER = '// ---- everything below is the canonical file, verbatim ----\n//\n';
  const at = copy.indexOf(MARKER);
  ok('BD copy declares its verbatim-after-header marker', at >= 0);
  ok('BD copy code is the canonical js/game-stats-global.js verbatim after the marker (CLAUDE.md sync point 3)',
    at >= 0 && copy.slice(at + MARKER.length) === canonical);
}

// --- the drain test must run at global-port IMPORT time (drainPending fires once,
// --- when the script loads) so the queue is seeded BEFORE the first import --------
freshStore({
  'gamehub.bd.pendingStats.v1': [
    { game: 'business', diff: 'normal', won: true },
    { game: 'business', diff: 'hard', won: false },
    null,                                   // a corrupt entry must not break the drain
    { game: 'business', diff: 'easy', won: null },
  ],
});
await import(pathToFileURL(join(ROOT, 'js', 'game-stats-global.js')).href);
const record = globalThis.__ghStats.record;   // stable reference; store is swapped per scenario
{
  const st = readStats();
  ok('drain: pending queue was drained through record() at load', !!st);
  eq('drain: business totals reflect the 3 valid queued games', st.games.business.total, { played: 3, won: 1, lost: 1 });
  eq('drain: byDiff buckets landed', [st.games.business.byDiff.normal.won, st.games.business.byDiff.hard.lost, st.games.business.byDiff.easy.played], [1, 1, 1]);
  ok('drain: queue key removed after drain', backing.get('gamehub.bd.pendingStats.v1') === undefined);
}

const gs = await import(pathToFileURL(join(ROOT, 'js', 'game-stats.js')).href);

// The identical input sequence both implementations must agree on. Difficulty
// normalization is part of the contract: '  Normal ' -> 'normal', null -> 'unknown'.
const SEQUENCE = [
  ['business', 'easy', true],
  ['business', '  Normal ', false],
  ['business', null, null],          // a draw: played only
  ['business', 'NORMAL', true],
  ['parchis', 'dificil', true],
  ['parchis', 'facil', false],
  ['parchis', 'facil', true],
];

/** The shared surface of a store: business/parchis {total, byDiff} plus the fold
 *  guards and fold output on business/chinchon. Everything else is excluded. */
function sharedSurface(st) {
  const pick = (g) => g ? { total: g.total, byDiff: g.byDiff } : null;
  return {
    business: pick(st.games.business),
    parchis: pick(st.games.parchis),
    chinchonFold: st.games.chinchon ? { total: st.games.chinchon.total, legacy: st.games.chinchon.byDiff.legacy || null, _leg: !!st.games.chinchon._leg } : null,
    businessLeg: !!st.games.business._leg,
  };
}

// --- scenario 1: identical sequences on a fresh store -----------------------------
{
  freshStore();
  for (const [g, d, w] of SEQUENCE) record(g, d, w);
  const globalOut = sharedSurface(readStats());

  freshStore();
  for (const [g, d, w] of SEQUENCE) gs.recordResult(g, d, w);
  const esmOut = sharedSurface(readStats());

  eq('fresh store: shared surface identical after the same record sequence', globalOut, esmOut);
  eq('fresh store: business totals (draw counts as played only)', globalOut.business.total, { played: 4, won: 2, lost: 1 });
  eq('fresh store: difficulty normalization collapses "  Normal "/"NORMAL"', globalOut.business.byDiff.normal, { played: 2, won: 1, lost: 1 });
  eq('fresh store: null difficulty lands in "unknown"', globalOut.business.byDiff.unknown, { played: 1, won: 0, lost: 0 });
}

// --- scenario 2: legacy folds produce identical results ---------------------------
const LEGACY_SEED = {
  'bd-stats': { played: 7, won: 4, lost: 3 },
  'chinchon-stats': { games: 12, wins: 5, losses: 6, closes: 9, chinchons: 1, minusTen: 2 },
};
{
  freshStore(LEGACY_SEED);
  record('business', 'easy', true);
  const globalOut = sharedSurface(readStats());

  freshStore(LEGACY_SEED);
  gs.recordResult('business', 'easy', true);
  const esmOut = sharedSurface(readStats());

  eq('legacy fold: shared surface identical', globalOut, esmOut);
  eq('legacy fold: business = folded 7/4/3 + the new win', globalOut.business.total, { played: 8, won: 5, lost: 3 });
  eq('legacy fold: business byDiff.legacy snapshot', globalOut.business.byDiff.legacy, { played: 7, won: 4, lost: 3 });
  eq('legacy fold: chinchon folded from chinchon-stats', globalOut.chinchonFold.total, { played: 12, won: 5, lost: 6 });
  ok('legacy fold: both _leg guards set', globalOut.businessLeg && globalOut.chinchonFold._leg);
}

// --- scenario 3: the fold-once guard interoperates across implementations ---------
{
  // ESM folds first; the global port must NOT double-fold.
  freshStore(LEGACY_SEED);
  gs.loadStats();                              // folds, sets _leg in the shared store
  record('business', 'hard', false);           // global port records on the same store
  let st = readStats();
  eq('interop (ESM folds first): business total is fold + 1, not double-fold', st.games.business.total, { played: 8, won: 4, lost: 4 });

  // Global port folds first; the ESM side must NOT double-fold.
  freshStore(LEGACY_SEED);
  record('business', 'hard', false);           // folds, sets _leg
  gs.recordResult('business', 'easy', true);   // ESM records on the same store
  st = readStats();
  eq('interop (global folds first): business total is fold + 2, not double-fold', st.games.business.total, { played: 9, won: 5, lost: 4 });
  eq('interop: chinchon folded exactly once', st.games.chinchon.total, { played: 12, won: 5, lost: 6 });
}

// --- scenario 4: unknown gameIds rejected by both ---------------------------------
{
  freshStore();
  record('tetris', 'easy', true);
  ok('global port: unknown gameId writes nothing', readStats() === null);
  const before = JSON.stringify(readStats());
  const out = gs.recordResult('tetris', 'easy', true);
  ok('ESM: unknown gameId returns null and writes nothing new', out === null && JSON.stringify(readStats()) === before);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
