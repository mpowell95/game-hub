// test-word-weaver.mjs - Word Weaver's stars (js/word-weaver-points.js), its recorder
// (js/game-stats.js recordWordWeaver), the cross-device merge (js/players-agg.js) and the
// leaderboard's number. Run: node tools/test-word-weaver.mjs
//
// THE LAW is what matters here: a level's entry only ever improves, the extra-word count only goes
// up, a level finished on two phones counts once, and the per-level map survives the trip through
// Firebase (which turns numerically keyed objects into arrays: the keys are 'L<n>' for that).
// The level DATA has its own test: node word-weaver/js/data-test.js.
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const P = await import('../js/word-weaver-points.js');
const G = await import('../js/game-stats.js');
const A = await import('../js/players-agg.js');

// --- the stars rule (Matt, 2026-10-28) ---
ok('stars: 0 hints = 3, 1 hint = 2, 2+ hints = 1', P.wwStarsFor(0) === 3 && P.wwStarsFor(1) === 2 && P.wwStarsFor(2) === 1 && P.wwStarsFor(9) === 1);
ok('stars: junk hint counts read as 0', P.wwStarsFor(undefined) === 3 && P.wwStarsFor(-2) === 3 && P.wwStarsFor('x') === 3);
ok('best: stars Math.max, hints Math.min, the earliest time', JSON.stringify(P.wwBest({ s: 2, h: 1, t: 50 }, { s: 3, h: 0, t: 90 })) === JSON.stringify({ s: 3, h: 0, t: 50 }));
ok('best: a malformed side is ignored, never invented', JSON.stringify(P.wwBest(null, { s: 2, h: 1, t: 5 })) === JSON.stringify({ s: 2, h: 1, t: 5 }) && P.wwBest(null, 'x') === null);
ok('levels: only L<n> keys count', Object.keys(P.wwLevels({ ww: { lv: { L1: { s: 3 }, 2: { s: 3 }, L0: { s: 3 }, Lx: { s: 1 } } } })).join() === '1');
ok('an empty record reads zero everywhere', P.wwStars({}) === 0 && P.wwCleared(null) === 0 && P.wwThreeStars(undefined) === 0 && P.wwExtra({}) === 0);

// --- the recorder ---
ok('recordWordWeaver is exported with (level, { hints, extra })', typeof G.recordWordWeaver === 'function');
let st = G.recordWordWeaver(1, { hints: 0, extra: 2 });
ok('a first completion returns the store (truthy)', !!st);
let g = G.loadStats().games.wordweaver;
ok('one play and one win, in byDiff.ladder', g.total.played === 1 && g.total.won === 1 && g.byDiff.ladder.won === 1);
ok('level 1 stored as L1 { s: 3, h: 0, t }', g.ww.lv.L1 && g.ww.lv.L1.s === 3 && g.ww.lv.L1.h === 0 && g.ww.lv.L1.t > 0);
ok('extras added to x', g.ww.x === 2);
const t1 = g.ww.lv.L1.t;

G.recordWordWeaver(2, { hints: 1, extra: 0 });
G.recordWordWeaver(3, { hints: 4 });
g = G.loadStats().games.wordweaver;
ok('1 hint = 2 stars, 4 hints = 1 star', g.ww.lv.L2.s === 2 && g.ww.lv.L3.s === 1 && g.ww.lv.L3.h === 4);
ok('total stars 3 + 2 + 1 = 6, 3 levels, 1 three-star', P.wwStars(g) === 6 && P.wwCleared(g) === 3 && P.wwThreeStars(g) === 1);

// A second call for a finished level (should not happen; the game calls once) never makes it worse.
G.recordWordWeaver(1, { hints: 3, extra: 1 });
g = G.loadStats().games.wordweaver;
ok('a worse result never lowers a stored level (rule 2)', g.ww.lv.L1.s === 3 && g.ww.lv.L1.h === 0 && g.ww.lv.L1.t === t1);
ok('...and the level still counts ONCE', P.wwCleared(g) === 3 && P.wwStars(g) === 6);
ok('x only increments', g.ww.x === 3);
G.recordWordWeaver(3, { hints: 0 });
g = G.loadStats().games.wordweaver;
ok('a better result improves the stored level', g.ww.lv.L3.s === 3 && g.ww.lv.L3.h === 0);

G.recordWordWeaver(0, { hints: 0, extra: 1 });
G.recordWordWeaver(2.5, { hints: 0 });
G.recordWordWeaver('abc', { hints: 0 });
g = G.loadStats().games.wordweaver;
ok('a bad level number records the play but invents no level (rule 4)', P.wwCleared(g) === 3 && Object.keys(g.ww.lv).length === 3 && g.ww.x === 4);
ok('stored keys are L<n>, never bare numbers', Object.keys(g.ww.lv).every((k) => /^L\d+$/.test(k)));
G.recordWordWeaver(4, { hints: 0, extra: -5 });
ok('a negative extra count never lowers x', G.loadStats().games.wordweaver.ww.x === 4);

// --- the rate gate: 30 results a minute per game, then null ---
let blocked = null;
for (let i = 0; i < 40 && !blocked; i++) if (G.recordWordWeaver(100 + i, { hints: 0 }) === null) blocked = 100 + i;
ok('the rate gate refuses a flood (returns null)', blocked !== null);
g = G.loadStats().games.wordweaver;
ok('...and a refused result writes nothing', !g.ww.lv['L' + blocked]);

// --- a malformed store is repaired, not crashed on ---
store.set('gamehub.stats', JSON.stringify({ version: 1, games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww: [] } } }));
g = G.loadStats().games.wordweaver;
ok('a malformed ww becomes an empty map', g.ww && typeof g.ww.lv === 'object' && !Array.isArray(g.ww.lv) && g.ww.x === 0);
store.set('gamehub.stats', JSON.stringify({ version: 1, games: { wordweaver: { total: { played: 2, won: 2, lost: 0 }, byDiff: { ladder: { played: 2, won: 2, lost: 0 } }, ww: { lv: { L1: { s: 3, h: 0, t: 1 }, L2: { s: 2, h: 1, t: 2 } }, x: 7 } } } }));
g = G.loadStats().games.wordweaver;
ok('a well formed stored map is kept as stored', g.ww.lv.L1.s === 3 && g.ww.lv.L2.h === 1 && g.ww.x === 7);

// --- through Firebase and across two phones ---
const phoneA = JSON.parse(JSON.stringify(G.loadStats()));
const phoneB = { games: { wordweaver: { total: { played: 2, won: 2, lost: 0 }, byDiff: { ladder: { played: 2, won: 2, lost: 0 } },
  ww: { lv: { L2: { s: 3, h: 0, t: 9 }, L5: { s: 1, h: 2, t: 4 } }, x: 5 } } } };
const rows = A.aggregatePlayers({
  devA: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneA, updatedAt: 2 },
  devB: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneB, updatedAt: 1 },
});
ok('two phones are one person', rows.length === 1);
const m = rows[0].games.wordweaver;
ok('merge: level 2 on both phones counts ONCE, with the best of each field', m.ww.lv.L2.s === 3 && m.ww.lv.L2.h === 0 && m.ww.lv.L2.t === 2);
ok('merge: levels only one phone finished are there', m.ww.lv.L1 && m.ww.lv.L5 && m.ww.lv.L5.s === 1);
ok('merge: extra words add', m.ww.x === 12);
ok('merge: 3 distinct levels, 3 + 3 + 1 = 7 stars', P.wwCleared(m) === 3 && P.wwStars(m) === 7 && P.wwThreeStars(m) === 2);
ok('wordweaver is a SOLO game', A.SOLO.has('wordweaver'));

// --- the leaderboard ranks by total stars (static checks: the overlay needs a DOM) ---
{
  const lb = readFileSync(new URL('js/leaderboard-ui.js', ROOT), 'utf8');
  const gs = readFileSync(new URL('js/game-stats-ui.js', ROOT), 'utf8');
  ok('leaderboard: a GAME_META row', /\{ id: 'wordweaver', labelKey: 'game_title_wordweaver' \}/.test(lb));
  ok('leaderboard: the board number is wwStars', /id === 'wordweaver'\) return tier == null \? wwStars\(g\.games\.wordweaver\)/.test(lb));
  ok('leaderboard: one ladder, no tier', /if \(id === 'wordweaver'\) return null;/.test(lb));
  ok('leaderboard: standing records (levels completed, three-star levels)', /wordweaver: \[\s*\{ labelKey: 'lb_tex_ww_cleared'[\s\S]*?lb_tex_ww_three/.test(lb));
  ok('My Stats: the unit is stars, headline wwStars, its own screen', /wordweaver: 'lb_unit_stars'/.test(gs) && /id === 'wordweaver'\) return \{ n: wwStars\(rec\)/.test(gs) && /wordWeaverScreen\(rec\)/.test(gs));
  const S = (await import('../js/strings.js')).default;
  ok('strings: title EN/ES', S.en.game_title_wordweaver === 'Word Weaver' && S.es.game_title_wordweaver === 'Tejepalabras');
  ok('strings: stars unit EN/ES', S.en.lb_unit_stars === 'stars' && S.es.lb_unit_stars === 'estrellas' && S.en.lb_yval({ k: 'stars', v: '1', n: 1 }) === '1 star');
}

// --- admin only (the screens' half adds the hub entry; when it is there it must be devOnly) ---
{
  const hub = readFileSync(new URL('js/hub.js', ROOT), 'utf8');
  const at = hub.indexOf("id: 'word-weaver'");
  if (at < 0) console.log('NOTE  js/hub.js has no word-weaver entry yet (the screens half adds it)');
  else ok('hub: Word Weaver is admin only (devOnly: true)', /\bdevOnly:\s*true\b/.test(hub.slice(at, hub.indexOf('\n  },', at))));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
