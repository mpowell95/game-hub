// test-stats-identity.mjs - the stats store is keyed by WHOSE stats they are, not just which device.
//
// This is the regression suite for the fix to the incident CLAUDE.md records as "The Ana/Natalia
// correction": two people shared one phone, every play either of them made landed in the same
// per-device counters, and there was no per-play log left to unpick them with. game-stats.js now
// resolves the store from the ACTIVE PROFILE'S PLAYER CODE (see its "WHOSE stats these are" block).
//
// THE LAW rule 7 is the reason for the fixture below: a migration/identity test that seeds a
// synthetic new-shape store proves nothing. REAL_SHARED_DEVICE is the actual, unedited
// `stats` object read out of Firebase at players/1f75ff86-... on 2026-07-23 - the very device the
// incident happened on, 18 real plays in the real stored shape (counters only; it carries no name or
// other identifying field). The first thing this suite asserts is that a device like this one sees
// ZERO change: same key, same node, same numbers, nothing migrated.
//
// The two properties that actually matter, and that nothing else in the suite can check:
//   1. NOBODY WHO EXISTS TODAY IS DISTURBED. The first code seen on a device owns the legacy
//      `gamehub.stats` key and the `players/<deviceId>` node, so no data is copied, moved, rewritten
//      or re-keyed by this change (rules 1, 3, 5 hold by construction, not by careful handling).
//   2. A SECOND PERSON CANNOT BLEND INTO THE FIRST. A different code gets its own store and its own
//      sync node, the device-wide legacy stores are never folded into it, and the first person's
//      store is byte-for-byte untouched by anything the second person does.
//
// Node-only, no deps, players-agg.test.mjs / test-stats-replay.mjs idiom.
// Run: node test-stats-identity.mjs

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
  key: (i) => [...backing.keys()][i],
  get length() { return backing.size; },
};
globalThis.self = globalThis;
const seed = (o = {}) => { backing = new Map(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])); };
const raw = (k) => backing.get(k);
const asProfile = (name, code) => JSON.stringify({ version: 1, name, emoji: '🙂', playerId: code, preferredColor: null, opponents: [] });
const plays = (st) => Object.values((st && st.games) || {}).reduce((n, g) => n + ((g.total || {}).played | 0), 0);

const gs = await import(pathToFileURL(join(ROOT, 'js', 'game-stats.js')).href);
const agg = await import(pathToFileURL(join(ROOT, 'js', 'players-agg.js')).href);

// ==================================================================================
// REAL_SHARED_DEVICE - the actual store from players/1f75ff86-... (see header). 18 plays.
// ==================================================================================
const REAL_SHARED_DEVICE = {"games":{"ballrun":{"_brMetricMigrated":true,"_brRunsRefolded":true,"br":{"bestObstacles":39,"bestObstaclesByDiff":{"easy":0,"hard":39,"medium":20},"runs":8},"byDiff":{"hard":{"lost":0,"played":2,"won":2},"medium":{"lost":0,"played":6,"won":6}},"total":{"lost":0,"played":8,"won":8}},"boggle":{"bg":{"bestScore":16,"longestWord":{"len":5,"word":"WORST"},"lost":1,"played":1,"tied":0,"won":0,"words":13},"byDiff":{"intermediate":{"lost":1,"played":1,"won":0}},"total":{"lost":1,"played":1,"won":0}},"business":{"_leg":true,"total":{"lost":0,"played":0,"won":0}},"chinchon":{"_ccSeeded":true,"_leg":true,"byDiff":{"legacy":{"lost":0,"played":1,"won":1},"normal":{"lost":1,"played":1,"won":0}},"cc":{"chinchons":0,"closed":6,"minusTen":1},"total":{"lost":1,"played":2,"won":1}},"connect4":{"grid":{"computer":{"easy":{"l":0,"w":0},"expert":{"l":0,"w":0},"hard":{"l":0,"w":0},"medium":{"l":0,"w":0}},"player":{"easy":{"l":0,"w":0},"expert":{"l":0,"w":0},"hard":{"l":0,"w":0},"medium":{"l":0,"w":0}}},"total":{"lost":0,"played":0,"won":0}},"dotsboxes":{"byDiff":{"intermediate":{"lost":0,"played":1,"won":1}},"db":{"bestChain":10,"boxes":13,"lost":0,"played":1,"tied":0,"won":1},"total":{"lost":0,"played":1,"won":1}},"escoba":{"byDiff":{"easy":{"lost":0,"played":1,"won":1}},"es":{"escobas":9},"total":{"lost":0,"played":1,"won":1}},"filler":{"byDiff":{"intermediate":{"lost":0,"played":2,"won":2}},"total":{"lost":0,"played":2,"won":2}},"mancala":{"byDiff":{"beginner":{"lost":1,"played":1,"won":0}},"total":{"lost":1,"played":1,"won":0}},"nutsbolts":{"byDiff":{"medium":{"lost":0,"played":1,"won":1}},"nb":{"bestByTier":{"medium":1},"bestLevel":1,"moves":19,"solved":1},"total":{"lost":0,"played":1,"won":1}},"parchis":{"byDiff":{"intermediate":{"lost":1,"played":1,"won":0}},"total":{"lost":1,"played":1,"won":0}},"tictactoe":{"total":{"lost":0,"played":0,"won":0},"tt":{"classic":{"lost":0,"played":0,"tied":0,"won":0},"ultimate":{"lost":0,"played":0,"tied":0,"won":0}}}},"updatedAt":"2026-07-22T10:10:27.096Z","version":1};

const OWNER = '89N3N';        // the code on that device
const SECOND = 'C5PXN';       // the second person who played on it

// ==================================================================================
// A. LAW rules 1 + 7: a device that exists TODAY is completely undisturbed
// ==================================================================================
console.log('\n-- A: an existing device sees no change at all (real history, real shape) --');
{
  seed({
    'gamehub.deviceId': 'dev-1',
    'gamehub.stats': REAL_SHARED_DEVICE,
    'gamehub.profile': asProfile('Anita Bonita', OWNER),
  });

  eq('store key is still the legacy device-wide one', gs.statsKey(), 'gamehub.stats');
  eq('sync node is still players/<deviceId>, unsuffixed', gs.statsId(), 'dev-1');

  const st = gs.loadStats();
  eq('every one of the 18 real plays is visible', plays(st), 18);
  eq('Ball Run runs survive', st.games.ballrun.br.runs, 8);
  eq('Ball Run best obstacles survive', st.games.ballrun.br.bestObstacles, 39);
  eq('Boggle longest word survives intact', st.games.boggle.bg.longestWord, { len: 5, word: 'WORST' });
  eq('Dots and Boxes best chain survives', st.games.dotsboxes.db.bestChain, 10);
  eq('Escoba escobas survive', st.games.escoba.es.escobas, 9);
  eq('Chinchon folded-legacy bucket survives', st.games.chinchon.byDiff.legacy, { lost: 0, played: 1, won: 1 });

  ok('the first code seen claims ownership of the device store', (gs.statsOwner() || {}).code === OWNER);
  ok('no per-player store was created', ![...backing.keys()].some((k) => k.startsWith('gamehub.stats.p.')));

  gs.recordResult('filler', 'intermediate', true);
  eq('a new play lands in the SAME legacy key', plays(JSON.parse(raw('gamehub.stats'))), 19);
  ok('and still no per-player store exists', ![...backing.keys()].some((k) => k.startsWith('gamehub.stats.p.')));
}

// ==================================================================================
// B. The fix itself: a second person on the same phone cannot blend into the first
// ==================================================================================
console.log('\n-- B: a second player on the same device gets their own store and node --');
let ownerStoreAfterFork = null;
{
  const ownerStoreBefore = raw('gamehub.stats');
  backing.set('gamehub.profile', asProfile('Natalia', SECOND));

  eq('store key is now the second player\'s own', gs.statsKey(), `gamehub.stats.p.${SECOND}`);
  eq('sync node is now <deviceId>-<CODE>', gs.statsId(), `dev-1-${SECOND}`);
  ok('the two players never share a sync node', gs.statsId() !== 'dev-1');

  const st = gs.loadStats();
  eq('the second player starts from zero, not the first player\'s 19', plays(st), 0);
  eq('...including Ball Run', st.games.ballrun.br.runs, 0);
  eq('...including the first player\'s Boggle best', st.games.boggle.bg.longestWord, { word: '', len: 0 });

  gs.recordEscoba('easy', true, { escobas: 3 });
  gs.recordBoggle('pro', false, { words: 5, score: 9, longestWord: { word: 'PLAY', len: 4 } });

  const mine = JSON.parse(raw(`gamehub.stats.p.${SECOND}`));
  eq('the second player\'s plays land in their own store', plays(mine), 2);
  eq('...with their own escoba counter', mine.games.escoba.es.escobas, 3);
  eq('...and their own longest word', mine.games.boggle.bg.longestWord, { word: 'PLAY', len: 4 });

  ownerStoreAfterFork = raw('gamehub.stats');
  ok('THE FIRST PLAYER\'S STORE IS BYTE-FOR-BYTE UNTOUCHED', ownerStoreAfterFork === ownerStoreBefore);
  eq('the first player still has exactly their own 19 plays', plays(JSON.parse(ownerStoreAfterFork)), 19);

  const forks = JSON.parse(raw('gamehub.stats.forks.v1') || 'null');
  ok('the fork is logged for diagnosis', Array.isArray(forks) && forks.length === 1 && forks[0].code === SECOND);
  eq('...recording how many plays the previous player had', forks[0].prevPlays, 19);
  eq('the owner record still names the FIRST player', (gs.statsOwner() || {}).code, OWNER);
}

// ==================================================================================
// C. Switching back: each player sees their own history, neither sees the other's
// ==================================================================================
console.log('\n-- C: switching profiles back and forth never mixes the two --');
{
  backing.set('gamehub.profile', asProfile('Anita Bonita', OWNER));
  eq('back on the owner\'s key', gs.statsKey(), 'gamehub.stats');
  eq('the owner sees their own 19, not 21', plays(gs.loadStats()), 19);

  backing.set('gamehub.profile', asProfile('Natalia', SECOND));
  eq('the second player sees their own 2, not 21', plays(gs.loadStats()), 2);
  ok('a second switch does not log a duplicate fork', JSON.parse(raw('gamehub.stats.forks.v1')).length === 1);
  ok('the owner store is STILL untouched after all the switching', raw('gamehub.stats') === ownerStoreAfterFork);
}

// ==================================================================================
// D. The device-wide legacy stores belong to the owner and are never re-folded
// ==================================================================================
console.log('\n-- D: chinchon-stats / bd-stats never fold into a second player\'s store --');
{
  seed({
    'gamehub.deviceId': 'dev-2',
    'gamehub.profile': asProfile('First', OWNER),
    'chinchon-stats': { games: 12, wins: 5, losses: 6, closes: 9, chinchons: 1, minusTen: 2 },
    'bd-stats': { played: 7, won: 4, lost: 3 },
  });

  const first = gs.loadStats();
  eq('the owner folds the legacy chinchon store, as always', first.games.chinchon.total.played, 12);
  eq('the owner folds the legacy Monopoly Deal store, as always', first.games.business.total.played, 7);
  eq('...and the close-quality counters seed too', first.games.chinchon.cc.closed, 9);

  backing.set('gamehub.profile', asProfile('Second', SECOND));
  const second = gs.loadStats();
  eq('the second player does NOT inherit the legacy chinchon history', second.games.chinchon.total.played, 0);
  eq('the second player does NOT inherit the legacy Monopoly Deal history', second.games.business.total.played, 0);
  eq('...nor the close-quality counters', second.games.chinchon.cc.closed, 0);
  ok('the fold-once guards are latched so a later load cannot fold them either', second.games.chinchon._leg === true && second.games.business._leg === true && second.games.chinchon._ccSeeded === true);
  ok('a second load still does not fold them', gs.loadStats().games.chinchon.total.played === 0);

  ok('the legacy keys themselves are untouched (LAW rule 5)', !!raw('chinchon-stats') && !!raw('bd-stats'));
  eq('and the owner still sees their folded history', (backing.set('gamehub.profile', asProfile('First', OWNER)), gs.loadStats().games.chinchon.total.played), 12);
}

// ==================================================================================
// E. A device with no player code behaves exactly as it always did
// ==================================================================================
console.log('\n-- E: an anonymous device is unchanged (no code, no owner, no fork) --');
{
  seed({ 'gamehub.deviceId': 'dev-3', 'gamehub.stats': REAL_SHARED_DEVICE });
  eq('device-wide key', gs.statsKey(), 'gamehub.stats');
  eq('device-wide node', gs.statsId(), 'dev-3');
  eq('all its history is visible', plays(gs.loadStats()), 18);
  ok('no owner is recorded for a device with no code', gs.statsOwner() === null);

  seed({ 'gamehub.deviceId': 'dev-4', 'gamehub.profile': JSON.stringify({ version: 1, name: 'No Code', emoji: '🙂', playerId: null }) });
  eq('a malformed/absent code falls back to the device-wide key', gs.statsKey(), 'gamehub.stats');
  ok('...and records no owner', gs.statsOwner() === null);
}

// ==================================================================================
// F. The non-module recorder (Monopoly Deal / Parchis) resolves the SAME key
// ==================================================================================
console.log('\n-- F: the global (non-module) recorder agrees with the ES-module one --');
{
  seed({
    'gamehub.deviceId': 'dev-5',
    'gamehub.profile': asProfile('First', OWNER),
    'bd-stats': { played: 7, won: 4, lost: 3 },
  });
  gs.loadStats();                                        // owner claims the device store
  await import(pathToFileURL(join(ROOT, 'js', 'game-stats-global.js')).href);

  globalThis.__ghStats.record('business', 'normal', true);
  eq('the owner\'s Monopoly Deal play lands in the device store', JSON.parse(raw('gamehub.stats')).games.business.total.played, 8);

  backing.set('gamehub.profile', asProfile('Second', SECOND));
  globalThis.__ghStats.record('business', 'normal', false);
  const forked = JSON.parse(raw(`gamehub.stats.p.${SECOND}`));
  eq('the second player\'s Monopoly Deal play lands in THEIR store', forked.games.business.total.played, 1);
  eq('...and did not fold the device-wide bd-stats into it', forked.games.business.total.won, 0);
  eq('the owner\'s Monopoly Deal record is unchanged by it', JSON.parse(raw('gamehub.stats')).games.business.total.played, 8);
  eq('the ES-module recorder resolves the same key', gs.statsKey(), `gamehub.stats.p.${SECOND}`);
}

// ==================================================================================
// G. Downstream: the leaderboard sees two people, and one person's two devices still sum
// ==================================================================================
console.log('\n-- G: aggregation keeps them apart, and still combines a real person\'s devices --');
{
  const two = {
    'dev-1': { profile: { name: 'Anita Bonita', playerId: OWNER }, stats: { games: { filler: { total: { played: 19, won: 10, lost: 9 }, byDiff: {} } } }, updatedAt: 3 },
    [`dev-1-${SECOND}`]: { profile: { name: 'Natalia', playerId: SECOND }, stats: { games: { filler: { total: { played: 2, won: 2, lost: 0 }, byDiff: {} } } }, updatedAt: 4 },
  };
  const rows = agg.aggregatePlayers(two);
  eq('one shared phone now yields TWO people, not one blended row', rows.length, 2);
  eq('the first player keeps exactly their own plays', rows.find((r) => r.playerId === OWNER).games.filler.total.played, 19);
  eq('the second player keeps exactly their own plays', rows.find((r) => r.playerId === SECOND).games.filler.total.played, 2);

  // The same person on two phones must still combine - the suffix must not fragment anyone.
  const oneP = {
    'dev-a': { profile: { name: 'Bego', playerId: 'AB123' }, stats: { games: { mancala: { total: { played: 4, won: 2, lost: 2 }, byDiff: {} } } }, updatedAt: 1 },
    'dev-b-AB123': { profile: { name: 'Bego', playerId: 'AB123' }, stats: { games: { mancala: { total: { played: 6, won: 3, lost: 3 }, byDiff: {} } } }, updatedAt: 2 },
  };
  const one = agg.aggregatePlayers(oneP);
  eq('one person on two phones is still ONE row', one.length, 1);
  eq('...with both phones\' plays summed, never double-counted', one[0].games.mancala.total.played, 10);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
