// tools/test-number-merge.mjs - Number Merge: the engine (number-merge/js/engine.js), the recorder (js/game-stats.js
// recordNumberMerge, nmDayBest) and the per-person merge (js/players-agg.js). Pure node, a fake localStorage, a made-up
// player (never Matt's code or name). Run: node tools/test-number-merge.mjs
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzmerge', playerId: 'ZZZM8' }));
const E = await import('../number-merge/js/engine.js');
const G = await import('../js/game-stats.js');
const { aggregatePlayers, SOLO } = await import('../js/players-agg.js');

// --- engine ---
const row = (a) => [...a, ...new Array(12).fill(0)];
ok('2 2 2 2 left = 4 4 (each tile merges once)', eq(E.slide(row([2, 2, 2, 2]), 'left').grid.slice(0, 4), [4, 4, 0, 0]));
ok('2 2 4 _ left = 4 4 (a merged tile does not merge again)', eq(E.slide(row([2, 2, 4, 0]), 'left').grid.slice(0, 4), [4, 4, 0, 0]));
ok('4 _ 4 8 left = 8 8', eq(E.slide(row([4, 0, 4, 8]), 'left').grid.slice(0, 4), [8, 8, 0, 0]));
ok('2 2 2 _ right = _ _ 2 4 (nearest the wall merge first)', eq(E.slide(row([2, 2, 2, 0]), 'right').grid.slice(0, 4), [0, 0, 2, 4]));
ok('score gained = the merged values', E.slide(row([2, 2, 4, 4]), 'left').gained === 12);
const col = [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0];
const up = E.slide(col, 'up');
ok('a column slides up and merges', up.grid[0] === 4 && up.grid[4] === 0 && up.grid[12] === 0 && up.merged.length === 1);
ok('down too', E.slide(col, 'down').grid[12] === 4);
ok('nothing to move = not moved', !E.slide(row([2, 4, 8, 16]), 'left').moved);
const full = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
ok('a full board with no pairs cannot move', !E.canMove(full));
ok('one pair = can move', E.canMove([2, 2, ...full.slice(2)]));

const a = E.newGame(12345), b = E.newGame(12345);
ok('a new game has two tiles', a.grid.filter(Boolean).length === 2);
ok('same seed, same start', eq(a, b));
let s1 = a, s2 = b, same = true;
const dirs = ['left', 'up', 'right', 'down'];
for (let i = 0; i < 300; i++) { const d = dirs[i % 4]; s1 = E.move(s1, d).state; s2 = E.move(s2, d).state; if (!eq(s1, s2)) same = false; }
ok('same seed + same moves = same game (300 moves)', same);
ok('the daily seed is the same for a day and differs the next', E.dailySeed('2026-11-13') === E.dailySeed('2026-11-13') && E.dailySeed('2026-11-13') !== E.dailySeed('2026-11-14'));
const m = E.move(E.newGame(7), 'left');
ok('a move that moved adds exactly one tile', !m.moved || m.state.grid.filter(Boolean).length <= 3);
// a whole game played to the end
let g = E.newGame(99), n = 0;
while (!g.over && n < 20000) { let moved = false; for (const d of dirs) { const r = E.move(g, d); if (r.moved) { g = r.state; moved = true; break; } } if (!moved) break; n++; }
ok('a game plays to game over', g.over && !E.canMove(g.grid));
ok('moves counted', g.moves === n);
let tiles4 = 0, spawns = 0, rng = 1;
for (let i = 0; i < 4000; i++) { const sp = E.spawn(new Array(16).fill(0), rng); rng = sp.rng; spawns++; if (sp.grid[sp.at] === 4) tiles4++; }
ok('a 4 about one time in ten', tiles4 / spawns > 0.07 && tiles4 / spawns < 0.13);
ok('cleanState refuses a bad grid', E.cleanState({ grid: [3, ...new Array(15).fill(0)] }) === null && E.cleanState({ grid: [2] }) === null);
ok('cleanState keeps a good one', !!E.cleanState({ grid: row([2, 4, 0, 0]), rng: 5, score: 8, moves: 3 }));

// --- recorder ---
const gm = () => (G.loadStats().games || {}).numbermerge;
ok('admin-only: plays go to the test record', G.isTestGame('numbermerge'));
const rec = (sc, o) => G.withMode(() => ({ mode: o.mode }), o.mode, () => G.recordNumberMerge(sc, o), () => ({ hi: sc, detail: () => ({ moves: o.moves, top: String(o.tile), end: 'over' }) }));
rec(1200, { mode: 'classic', tile: 128, moves: 150 });
let x = gm();
ok('classic: one play and one win under classic', x.total.played === 1 && x.byDiff.classic.won === 1 && x.nm.games === 1);
ok('classic: best, top tile, sums', x.nm.best === 1200 && x.nm.bestTile === 128 && x.nm.moves === 150 && x.nm.score === 1200);
ok('mode noted with its score', !!(x.byMode && x.byMode['mode=classic'] && x.byMode['mode=classic'].classic));
rec(800, { mode: 'classic', tile: 256, moves: 90 });
x = gm();
ok('a lower score never lowers the best (rule 2); top tile rises', x.nm.best === 1200 && x.nm.bestTile === 256 && x.nm.games === 2 && x.nm.score === 2000);
rec(3000, { mode: 'daily', tile: 256, moves: 300, day: '2026-11-13' });
x = gm();
ok('daily: one play under daily, its own entry, not Classic\'s best', x.byDiff.daily.won === 1 && x.nm.dl['2026-11-13'].sc === 3000 && x.nm.best === 1200 && x.nm.bestDaily === 3000);
rec(100, { mode: 'daily', tile: 16, moves: 20, day: '2026-11-13' });
x = gm();
ok('the same day again: no second play, the better entry kept whole', x.byDiff.daily.played === 1 && x.nm.dl['2026-11-13'].sc === 3000 && x.nm.dl['2026-11-13'].mv === 300);
ok('daily: a bad day records nothing', rec(5, { mode: 'daily', tile: 2, moves: 1, day: '13-11-2026' }) === null);
ok('the stored REAL record did not get the test plays', !(((G.loadStoredStats().games || {}).numbermerge || {}).nm || {}).games);

// --- merge per person ---
const dev = (id, nm) => ({ profile: { playerId: 'ZZZM8', name: 'zzzmerge' }, updatedAt: id === 'd1' ? 100 : 200,
  stats: { games: { numbermerge: { total: { played: nm.games, won: nm.games, lost: 0 }, byDiff: { classic: { played: nm.games, won: nm.games, lost: 0 } }, nm } } } });
const all = {
  d1: dev('d1', { games: 2, moves: 100, score: 900, best: 600, bestDaily: 0, bestTile: 64, dl: { '2026-11-13': { sc: 500, tl: 64, mv: 50, t: 20 } } }),
  d2: dev('d2', { games: 3, moves: 200, score: 4000, best: 2500, bestDaily: 900, bestTile: 256, dl: { '2026-11-13': { sc: 900, tl: 128, mv: 80, t: 10 } } }),
};
const p = aggregatePlayers(all)[0].games.numbermerge.nm;
ok('merge: counters add', p.games === 5 && p.moves === 300 && p.score === 4900);
ok('merge: bests take the max', p.best === 2500 && p.bestTile === 256 && p.bestDaily === 900);
ok('merge: a day keeps the better game whole, earliest time', p.dl['2026-11-13'].sc === 900 && p.dl['2026-11-13'].mv === 80 && p.dl['2026-11-13'].t === 10);
ok('Number Merge counts as a SOLO game', SOLO.has('numbermerge'));

console.log(`\nnumber-merge tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
