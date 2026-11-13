// test-battlearena-carry.mjs - Battle Arena's TEST plays count once it is released (Matt, 2026-11-13: "have test
// plays count. and have plays from non-admins count").
//
// While a game is admin-only its plays go to `testGames.<id>`, which STARTED AS A COPY of the real record
// (js/game-stats.js swapInTestGames). So at release the two must not be ADDED: the real record's games are already
// inside the test one (the only real data, Matt's phone on 2026-11-13: real 6 played, test 7 -> 7, not 13).
// This runs the release: the admin switch on (battle-arena live), then a load, and checks every player's store.
//   node tools/test-battlearena-carry.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); } };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
// A made-up player (never Matt's code or name). Battle Arena RELEASED: the switch is on.
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzprobe', playerId: 'ZZZQ9' }));
localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'battle-arena': { live: true } } }));
const real = { total: { played: 6, won: 5, lost: 1 }, byDiff: { easy: { played: 6, won: 5, lost: 1 } },
  byMode: { 'first=me|t1=emberkit|t2=zapup': { easy: { played: 6, won: 5, lost: 1, lo: 9 } } }, mpIds: { aaaaaaaa: 'w' } };
const test = { total: { played: 9, won: 7, lost: 2 }, byDiff: { easy: { played: 7, won: 6, lost: 1 }, mp: { played: 2, won: 1, lost: 1 } },
  byMode: { 'first=me|t1=emberkit|t2=zapup': { easy: { played: 7, won: 6, lost: 1, lo: 7 } }, 'first=me|t1=driplet|t2=zapup|via=live': { mp: { played: 2, won: 1, lost: 1 } } },
  mpIds: { aaaaaaaa: 'w', bbbbbbbb: 'l' }, dt: { _n: 3, moves: 120, end: { ko: 3 } } };
localStorage.setItem('gamehub.stats', JSON.stringify({
  version: 1, games: { battlearena: real }, testGames: { battlearena: test },
  h2h: { battlearena: { devOld: { name: 'Old', w: 1, l: 0 } } },
  testH2h: { battlearena: { devOld: { name: 'Old', w: 2, l: 1 }, devNew: { name: 'New', w: 0, l: 1 } } },
}));
const G = await import('../js/game-stats.js');
ok('Battle Arena is listed to carry, with its own combiner', G.CARRY_TEST.battlearena === true && G.CARRY_COMBINE.battlearena === G.combineCopiedRecords);
ok('released: no longer a test game', !G.isTestGame('battlearena'));
// Pure: Matt-shaped numbers are never added twice.
const m = G.combineCopiedRecords({ total: { played: 6, won: 5, lost: 1 } }, { total: { played: 7, won: 6, lost: 1 } });
ok('real 6 + a test copy that grew to 7 = 7 (not 13)', m.total.played === 7 && m.total.won === 6 && m.total.lost === 1);
ok('a player with only test plays keeps them all', G.combineCopiedRecords(undefined, { total: { played: 3, won: 2, lost: 1 } }).total.played === 3);
ok('a player with only real plays keeps them all', G.combineCopiedRecords({ total: { played: 4, won: 1, lost: 3 } }, undefined).total.played === 4);
ok('if a real record ever moved after the copy, neither side drops', G.combineCopiedRecords({ total: { played: 9 } }, { total: { played: 7 } }).total.played === 9);
// The release load.
G.loadStats();
const raw = JSON.parse(localStorage.getItem('gamehub.stats'));
const ba = raw.games.battlearena;
ok('stored once: total 9 played, 7 won, 2 lost (the test record, every game once)', ba.total.played === 9 && ba.total.won === 7 && ba.total.lost === 2, JSON.stringify(ba.total));
ok('by difficulty: easy 7, online 2', ba.byDiff.easy.played === 7 && ba.byDiff.mp.played === 2);
ok('modes kept: the shared team once (7), the online one added, `lo` the best (7)', ba.byMode['first=me|t1=emberkit|t2=zapup'].easy.played === 7
  && ba.byMode['first=me|t1=emberkit|t2=zapup'].easy.lo === 7 && ba.byMode['first=me|t1=driplet|t2=zapup|via=live'].mp.played === 2);
ok('challenge ids joined (one count per match per person stays right)', ba.mpIds.aaaaaaaa === 'w' && ba.mpIds.bbbbbbbb === 'l');
ok('detail carried', ba.dt && ba.dt._n === 3 && ba.dt.moves === 120);
ok('head-to-head: the test copy, every opponent once', raw.h2h.battlearena.devOld.w === 2 && raw.h2h.battlearena.devOld.l === 1 && raw.h2h.battlearena.devNew.l === 1);
ok('stamped carried.battlearena; the test record is KEPT (rule 5)', raw.carried && raw.carried.battlearena > 0 && raw.testGames.battlearena.total.played === 9 && raw.testH2h.battlearena.devNew);
ok('the game sees it (unlocks read loadStats: 7 wins)', G.loadStats().games.battlearena.total.won === 7);
G.loadStats();
const again = JSON.parse(localStorage.getItem('gamehub.stats'));
ok('a second load changes nothing (carried once)', JSON.stringify(again.games.battlearena) === JSON.stringify(ba) && again.carried.battlearena === raw.carried.battlearena);
G.withMode(() => ({ t1: 'emberkit', t2: 'zapup', first: 'me' }), 'easy', () => G.recordResult('battlearena', 'easy', true));
ok('a new game after release lands in the real record', JSON.parse(localStorage.getItem('gamehub.stats')).games.battlearena.total.played === 10);
// The leaderboard's read-time combine (a phone not opened since the release): the same numbers.
const agg = G.carriedGame({ games: { battlearena: real }, testGames: { battlearena: test } }, 'battlearena');
ok('read time (players-agg carriedGame), an unstamped record: 9 played, not 15', agg.total.played === 9);
console.log(`\nBattle Arena carry tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
