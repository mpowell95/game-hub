// test-admin-only-plays.mjs - an admin-only game's plays go to a TEST area (Matt, 2026-10-28).
//
// Matt: "admin only games should be released with 0 plays by anyone... Leave all data as is, and
// start doing this going forward." js/game-stats.js swaps each admin-only game's test record
// (`testGames.<id>`, `testH2h.<id>`) into the view loadStats() returns, so the recorders and the
// games' own progress reads work while testing; persist() writes the real record back untouched,
// and everything that shows or uploads stats reads loadStoredStats(). This proves:
//   - a play in an admin-only game lands in testGames, the real record is byte-for-byte unchanged;
//   - plays recorded before 2026-10-28 (the real record) are kept and seen by loadStoredStats();
//   - a game switched live from the admin page records into its real record, its old test record
//     untouched (that is what "released with 0 plays" means at the store);
//   - released games are not touched at all; h2h follows the same split;
//   - the upload and the screens that show stats read the stored shape.
//
// Run: node tools/test-admin-only-plays.mjs
import { fileURLToPath as __toolsF2P } from 'node:url';
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name); } };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// A made-up player (never Matt's code or name). Baseball is switched LIVE from the admin page;
// every other admin-only game is still admin-only.
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzprobe', playerId: 'ZZZQ9' }));
localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { baseball: { live: true } } }));
// Plays recorded BEFORE this existed sit in the real records (Matt: "leave them, count them"),
// plus an old test record for Baseball that must never come back once it is live.
// (Archery stands in for Gridlock, Word Weaver and Tower Stack here since their releases.)
const legacyGl = { total: { played: 22, won: 22, lost: 0 }, byDiff: { easy: { played: 22, won: 22, lost: 0 } } };
const legacyBa = { total: { played: 6, won: 3, lost: 3 }, byDiff: { mp: { played: 6, won: 3, lost: 3 } } };
localStorage.setItem('gamehub.stats', JSON.stringify({
  version: 1,
  games: { archery: legacyGl, battlearena: legacyBa, cupbaseball: { total: { played: 4, won: 1, lost: 3 }, byDiff: { easy: { played: 4, won: 1, lost: 3 } } }, uno: { total: { played: 2, won: 1, lost: 1 }, byDiff: {} },
    numbermerge: { total: { played: 3, won: 3, lost: 0 }, byDiff: { classic: { played: 3, won: 3, lost: 0 } }, nm: { games: 3, best: 556, bestTile: 2048, dl: {} } } },
  h2h: { battlearena: { devOld: { name: 'Old', w: 1, l: 0 } } },
  testGames: { cupbaseball: { total: { played: 9, won: 2, lost: 7 }, byDiff: { hard: { played: 9, won: 2, lost: 7 } } }, baseball: { total: { played: 5, won: 5, lost: 0 }, byDiff: { easy: { played: 5, won: 5, lost: 0 } } },
    numbermerge: { total: { played: 7, won: 7, lost: 0 }, byDiff: { daily: { played: 7, won: 7, lost: 0 } }, nm: { games: 7, best: 900, bestTile: 512, dl: { '2026-11-13': { sc: 64, tl: 64, mv: 9, t: 5 } } } } },
}));
const raw = () => JSON.parse(store.get('gamehub.stats'));

const G = await import('../js/game-stats.js');

ok('Archery and Battle Arena are admin-only right now', G.isTestGame('archery') && G.isTestGame('battlearena'));
ok('Baseball, switched live from the admin page, is not', !G.isTestGame('baseball'));
ok('Cup Baseball, archived 2026-11-13, is no longer a test game (its stored records are left where they are)', !G.isTestGame('cupbaseball'));
ok('a released game is never a test game', !G.isTestGame('uno') && !G.isTestGame('darts') && !G.isTestGame('gridlock') && !G.isTestGame('wordweaver') && !G.isTestGame('tower'));

const before = JSON.stringify(raw().games.archery);
G.recordResult('archery', 'easy', true);
G.recordResult('battlearena', 'mp', true);
let r = raw();
ok('an admin-only play lands in testGames (which started as a copy of the real record)', r.testGames.archery.total.played === 23 && r.testGames.battlearena.total.played === 7 && r.testGames.battlearena.total.won === 4);
ok('the real Archery record is byte-for-byte unchanged', JSON.stringify(r.games.archery) === before);
ok('the real Battle Arena record is unchanged', JSON.stringify(r.games.battlearena) === JSON.stringify(legacyBa));
ok('the tester\'s progress carries on in the test record', r.testGames.archery.byDiff.easy.played === 23 && r.testGames.archery.total.won === 23);
ok('...and the real record did not gain the game', r.games.archery.byDiff.easy.played === 22);

const view = G.loadStats();
ok('the GAME sees its test record while testing (its progress reads)', view.games.archery.total.played === 23);
const stored = G.loadStoredStats();
ok('loadStoredStats() shows the REAL record (pre-change plays kept, visible)', stored.games.archery.total.played === 22);
ok('loadStoredStats() carries the test record apart', stored.testGames.archery.total.played === 23);
ok('no hidden swap marker leaks into JSON', JSON.stringify(stored) === JSON.stringify(JSON.parse(JSON.stringify(stored))) && !Object.getOwnPropertySymbols(stored).length);

G.recordHeadToHead('battlearena', { deviceId: 'devNew', name: 'New' }, true);
r = raw();
ok('an admin-only h2h row goes to testH2h (started as a copy)', !!(r.testH2h && r.testH2h.battlearena && r.testH2h.battlearena.devNew && r.testH2h.battlearena.devOld));
ok('the real h2h is unchanged', JSON.stringify(r.h2h.battlearena) === JSON.stringify({ devOld: { name: 'Old', w: 1, l: 0 } }));

G.recordResult('baseball', 'easy', true);
r = raw();
ok('a game switched live records into its REAL record (starts at 0)', r.games.baseball.total.played === 1 && r.games.baseball.total.won === 1);
ok('its old test record is kept, untouched', r.testGames.baseball.total.played === 5);

G.recordResult('uno', 'easy', true);
r = raw();
ok('a released game is untouched by any of this', r.games.uno.total.played === 3 && !('uno' in r.testGames));

for (let i = 0; i < 3; i++) { G.loadStats(); G.recordResult('uno', 'easy', false); }
r = raw();
ok('repeated loads and writes never nest or move records', r.games.archery.total.played === 22 && r.testGames.archery.total.played === 23
  && !r.testGames.testGames && !r.games.testGames && JSON.stringify(r.games.archery) === before);
// Cup Baseball, archived 2026-11-13 (Matt: "remove Cup Baseball from the gamehub and archive it"): its real AND
// test records stay exactly where they were, through loads and other games' writes (THE LAW).
ok('archived Cup Baseball: real record kept as it was', JSON.stringify(r.games.cupbaseball.total) === JSON.stringify({ played: 4, won: 1, lost: 3 }) && r.games.cupbaseball.byDiff.easy.played === 4);
ok('archived Cup Baseball: test record kept as it was', JSON.stringify(r.testGames.cupbaseball.total) === JSON.stringify({ played: 9, won: 2, lost: 7 }) && r.testGames.cupbaseball.byDiff.hard.played === 9);
ok('archived Number Merge (2026-11-13, Matt: "remove this from the gamehub"): real record and its nm kept', r.games.numbermerge.total.played === 3 && r.games.numbermerge.nm.best === 556 && r.games.numbermerge.nm.bestTile === 2048);
ok('archived Number Merge: test record and its daily kept', r.testGames.numbermerge.total.played === 7 && r.testGames.numbermerge.nm.dl['2026-11-13'].sc === 64);
ok('archived Number Merge: in GAMES and ARCHIVED_GAMES, not a test game', G.GAMES.includes('numbermerge') && G.ARCHIVED_GAMES.includes('numbermerge') && !G.isTestGame('numbermerge'));
ok('archived Cup Baseball: still in the store\'s GAMES and in ARCHIVED_GAMES (out of every total)', G.GAMES.includes('cupbaseball') && G.ARCHIVED_GAMES.includes('cupbaseball'));

// Battle Arena is listed in CARRY_TEST (Matt, 2026-11-13) but is still admin-only: nothing is carried yet.
r = raw();
ok('Battle Arena listed to carry, but while admin-only nothing is carried or stamped', G.CARRY_TEST.battlearena === true
  && G.carriedGame(r, 'battlearena') === r.games.battlearena && !(r.carried && r.carried.battlearena) && JSON.stringify(r.games.battlearena) === JSON.stringify(legacyBa));

// --- the readers: everything that shows or uploads stats reads the stored shape ---
const src = (p) => readFileSync(new URL(p, __ROOT_URL), 'utf8');
const net = src('./js/stats-net.js');
ok('the players/ upload sends the stored shape', /stats: loadStoredStats\(\),/.test(net) && !/stats: loadStats\(\)/.test(net));
ok('My Stats and the leaderboard merge read the stored shape', !/[^.]\bloadStats\(\)/.test(src('./js/game-stats-ui.js').replace(/\/\/.*$|^\s*\*.*$/gm, '')));
ok('Multiplayer Records reads the stored shape', /gs\.loadStoredStats\(\)/.test(src('./js/mp-records.js')));
for (const p of ['./holdem/js/ui.js', './way-out/js/ui.js']) {
  ok(`${p} merges the stored shape`, !/aggregateForViewer\([^)]*\bloadStats\(\)/.test(src(p)));
}

console.log(`\nAdmin-only plays tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
