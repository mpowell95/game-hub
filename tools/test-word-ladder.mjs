// tools/test-word-ladder.mjs - Word Ladder's recorders and merge (js/game-stats.js recordWordLadder, recordWordLadderDaily,
// wlBest, wlSolved, wlBandOf). Pure node, a fake localStorage, a made-up player (never Matt's code or name).
// Run: node tools/test-word-ladder.mjs   (the levels and pars: node word-ladder/js/data-test.js)
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name); } };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzladder', playerId: 'ZZZL7' }));
const G = await import('../js/game-stats.js');
const E = await import('../word-ladder/js/engine.js');

const gm = () => (G.loadStats().games || {}).wordladder;
ok('admin-only: plays go to the test record', G.isTestGame('wordladder'));

G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 5, par: 3, hints: 0, band: 'easy' }), { detail: () => ({ moves: 5, par: 3, hints: 0 }) });
let g = gm();
ok('first completion: one play and one win in its band', g.total.played === 1 && g.total.won === 1 && g.byDiff.easy.won === 1);
ok('entry: 2 stars at par + 2', g.wl.lv.L1.s === 2 && g.wl.lv.L1.m === 5 && g.wl.lv.L1.p === 3);
ok('mode noted', !!(g.byMode && g.byMode['lang=en|mode=ladder'] && g.byMode['lang=en|mode=ladder'].easy.won === 1));

G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 3, par: 3, hints: 0, band: 'easy' }), { detail: () => ({ moves: 3, par: 3, hints: 0 }) });
g = gm();
ok('a second completion only improves the entry, no second play', g.total.played === 1 && g.wl.lv.L1.s === 3 && g.wl.lv.L1.m === 3);
G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 9, par: 3, hints: 2, band: 'easy' }));
ok('a worse completion never lowers it (rule 2)', gm().wl.lv.L1.s === 3 && gm().wl.lv.L1.m === 3 && gm().wl.lv.L1.h === 0);

G.withMode(() => ({ mode: 'ladder', lang: 'es' }), 'medium', () => G.recordWordLadder(150, { moves: 4, par: 4, hints: 1, lang: 'es', band: 'medium' }));
ok('Spanish ladder in wl.es, its own numbers', gm().wl.es.L150.s === 2 && !gm().wl.lv.L150 && gm().byDiff.medium.won === 1);
ok('bad level number records nothing', G.withMode(() => ({ mode: 'ladder' }), 'easy', () => G.recordWordLadder(0, { moves: 1, par: 1 })) === null);

G.withMode(() => ({ mode: 'daily', lang: 'en' }), 'daily', () => G.recordWordLadderDaily('en-2026-11-13', { moves: 4, par: 4, hints: 0 }));
ok('daily: one play under byDiff.daily, entry keyed by language and day', gm().byDiff.daily.won === 1 && gm().wl.dl['en-2026-11-13'].s === 3);
ok('daily: a malformed key records nothing', G.withMode(() => ({ mode: 'daily' }), 'daily', () => G.recordWordLadderDaily('2026-11-13', { moves: 1, par: 1 })) === null);
ok('the stored REAL record did not get the test plays', !((G.loadStoredStats().games || {}).wordladder || {}).wl || !Object.keys(G.loadStoredStats().games.wordladder.wl.lv || {}).length);

// wlBest keeps the better attempt whole
const b = G.wlBest({ s: 1, m: 4, h: 2, p: 3, t: 20 }, { s: 2, m: 9, h: 0, p: 3, t: 10 });
ok('wlBest: more stars wins whole (never 4 moves with 0 hints)', b.s === 2 && b.m === 9 && b.h === 0 && b.t === 10);
const c = G.wlBest({ s: 3, m: 4, h: 0, t: 5 }, { s: 3, m: 3, h: 0, t: 9 });
ok('wlBest: same stars, fewer moves wins; earliest time kept', c.m === 3 && c.t === 5);

// band and board count agree with the engine
ok('wlBandOf = engine bandOf at every boundary', [1, 100, 101, 250, 251, 400, 401, 500].every((n) => G.wlBandOf(n) === E.bandOf(n)));
ok('wlSolved counts both ladders, by band', G.wlSolved(gm()) === 2 && G.wlSolved(gm(), 'medium') === 1 && G.wlSolved(gm(), 'hard') === 0);
// stars rule identical in the engine and the recorder
let same = true;
// 20 cases (the rate gate allows 30 results a minute; this file records 27 in all)
for (let m = 4; m <= 8; m++) for (let h = 0; h < 4; h++) {
  G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'hard', () => G.recordWordLadder(300 + m * 4 + h, { moves: m, par: 5, hints: h, band: 'hard' }));
  if (gm().wl.lv['L' + (300 + m * 4 + h)].s !== E.starsFor(m, 5, h)) same = false;
}
ok('recorder stars = engine starsFor for every moves/hints', same);

console.log(`Word Ladder tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
