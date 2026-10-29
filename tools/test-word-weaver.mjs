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

// The recorder logic here is tested as a RELEASED game (switched live in the admin-config cache, which
// is memoized at its first read): while a game is admin-only its plays go to a test area instead,
// proven by tools/test-admin-only-plays.mjs (Matt, 2026-10-28).
localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
const P = await import('../js/word-weaver-points.js');
const G = await import('../js/game-stats.js');
G.isTestGame('wordweaver');   // memoize the config before any store.clear()
const A = await import('../js/players-agg.js');

// --- the stars rule (Matt, 2026-10-28) ---
ok('stars: 0 hints = 3, 1 hint = 2, 2+ hints = 1', P.wwStarsFor(0) === 3 && P.wwStarsFor(1) === 2 && P.wwStarsFor(2) === 1 && P.wwStarsFor(9) === 1);
ok('stars: junk hint counts read as 0', P.wwStarsFor(undefined) === 3 && P.wwStarsFor(-2) === 3 && P.wwStarsFor('x') === 3);
ok('best: stars Math.max, hints Math.min, the earliest time', JSON.stringify(P.wwBest({ s: 2, h: 1, t: 50 }, { s: 3, h: 0, t: 90 })) === JSON.stringify({ s: 3, h: 0, t: 50 }));
ok('best: a malformed side is ignored, never invented', JSON.stringify(P.wwBest(null, { s: 2, h: 1, t: 5 })) === JSON.stringify({ s: 2, h: 1, t: 5 }) && P.wwBest(null, 'x') === null);
ok('levels: only L<n> keys count', Object.keys(P.wwLevels({ ww: { lv: { L1: { s: 3 }, 2: { s: 3 }, L0: { s: 3 }, Lx: { s: 1 } } } })).join() === '1');
ok('an empty record reads zero everywhere', P.wwStars({}) === 0 && P.wwPoints({}) === 0 && P.wwCleared(null) === 0 && P.wwThreeStars(undefined) === 0 && P.wwExtra({}) === 0);

// --- bands and points (Matt, 2026-10-29) ---
ok('bands: tiers, starts, size', P.WW_TIERS.join() === 'easy,medium,hard,expert' && P.WW_BAND_SIZE === 500
  && P.WW_BAND_START.easy === 1 && P.WW_BAND_START.medium === 501 && P.WW_BAND_START.hard === 1001 && P.WW_BAND_START.expert === 1501);
ok('bandOf at every edge', P.wwBandOf(1) === 'easy' && P.wwBandOf(500) === 'easy' && P.wwBandOf(501) === 'medium' && P.wwBandOf(1000) === 'medium'
  && P.wwBandOf(1001) === 'hard' && P.wwBandOf(1500) === 'hard' && P.wwBandOf(1501) === 'expert' && P.wwBandOf(9999) === 'expert');
ok('band ends; Expert ends at the last level', P.wwBandEnd('easy') === 500 && P.wwBandEnd('medium') === 1000 && P.wwBandEnd('hard') === 1500 && P.wwBandEnd('expert', 2000) === 2000 && P.wwBandEnd('expert') === Infinity);
ok('multipliers 1/2/3/4', JSON.stringify(P.WW_MULT) === JSON.stringify({ easy: 1, medium: 2, hard: 3, expert: 4 }));
{
  const rec = { ww: { lv: { L1: { s: 3 }, L500: { s: 1 }, L501: { s: 2 }, L1001: { s: 3 }, L1501: { s: 3 }, L2000: { s: 1 } } } };
  ok('points: stars x band (3+1)x1 + 2x2 + 3x3 + (3+1)x4 = 33', P.wwPoints(rec) === 33);
  ok('points per band', P.wwPoints(rec, 'easy') === 4 && P.wwPoints(rec, 'medium') === 4 && P.wwPoints(rec, 'hard') === 9 && P.wwPoints(rec, 'expert') === 16);
  ok('stars, cleared, three-star per band', P.wwStars(rec) === 13 && P.wwStars(rec, 'expert') === 4 && P.wwCleared(rec, 'easy') === 2 && P.wwCleared(rec, 'hard') === 1
    && P.wwThreeStars(rec) === 3 && P.wwThreeStars(rec, 'easy') === 1 && P.wwThreeStars(rec, 'medium') === 0);
}

// --- the recorder ---
ok('recordWordWeaver is exported with (level, { hints, extra })', typeof G.recordWordWeaver === 'function');
let st = G.recordWordWeaver(1, { hints: 0, extra: 2 });
ok('a first completion returns the store (truthy)', !!st);
let g = G.loadStats().games.wordweaver;
ok('one play and one win, in the level\'s band (byDiff.easy)', g.total.played === 1 && g.total.won === 1 && g.byDiff.easy.won === 1 && !g.byDiff.ladder);
ok('level 1 stored as L1 { s: 3, h: 0, t }', g.ww.lv.L1 && g.ww.lv.L1.s === 3 && g.ww.lv.L1.h === 0 && g.ww.lv.L1.t > 0);
ok('extras added to x', g.ww.x === 2);
const t1 = g.ww.lv.L1.t;

G.recordWordWeaver(2, { hints: 1, extra: 0 });
G.recordWordWeaver(3, { hints: 4 });
g = G.loadStats().games.wordweaver;
ok('1 hint = 2 stars, 4 hints = 1 star', g.ww.lv.L2.s === 2 && g.ww.lv.L3.s === 1 && g.ww.lv.L3.h === 4);
ok('total stars 3 + 2 + 1 = 6, 3 levels, 1 three-star', P.wwStars(g) === 6 && P.wwCleared(g) === 3 && P.wwThreeStars(g) === 1);
G.recordWordWeaver(1600, { hints: 0 });
g = G.loadStats().games.wordweaver;
ok('an Expert level goes to byDiff.expert and is worth 3 x 4 = 12 points', g.byDiff.expert.won === 1 && P.wwPoints(g) === 6 + 12 && P.wwPoints(g, 'expert') === 12);

// A second call for a finished level (should not happen; the game calls once) never makes it worse.
G.recordWordWeaver(1, { hints: 3, extra: 1 });
g = G.loadStats().games.wordweaver;
ok('a worse result never lowers a stored level (rule 2)', g.ww.lv.L1.s === 3 && g.ww.lv.L1.h === 0 && g.ww.lv.L1.t === t1);
ok('...and the level still counts ONCE', P.wwCleared(g) === 4 && P.wwStars(g) === 9);
ok('x only increments', g.ww.x === 3);
G.recordWordWeaver(3, { hints: 0 });
g = G.loadStats().games.wordweaver;
ok('a better result improves the stored level', g.ww.lv.L3.s === 3 && g.ww.lv.L3.h === 0);

G.recordWordWeaver(0, { hints: 0, extra: 1 });
G.recordWordWeaver(2.5, { hints: 0 });
G.recordWordWeaver('abc', { hints: 0 });
g = G.loadStats().games.wordweaver;
ok('a bad level number records the play but invents no level (rule 4)', P.wwCleared(g) === 4 && Object.keys(g.ww.lv).length === 4 && g.ww.x === 4);
ok('...and its play has no band: byDiff.ladder (All only)', g.byDiff.ladder && g.byDiff.ladder.won === 3);
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
ok('merge: level 2 on both phones counts ONCE: the MOST hints either used (1), stars capped by them (2), the earliest time (2026-10-29)', m.ww.lv.L2.s === 2 && m.ww.lv.L2.h === 1 && m.ww.lv.L2.t === 2);
ok('merge: levels only one phone finished are there', m.ww.lv.L1 && m.ww.lv.L5 && m.ww.lv.L5.s === 1);
ok('merge: extra words add', m.ww.x === 12);
ok('merge: 3 distinct levels, 3 + 2 + 1 = 6 stars (hints on one phone cap a clean finish on the other)', P.wwCleared(m) === 3 && P.wwStars(m) === 6 && P.wwThreeStars(m) === 1);
ok('wordweaver is a SOLO game', A.SOLO.has('wordweaver'));

// Plays from before the bands (byDiff 'ladder', rule 5) still count beside band plays.
{
  const phoneC = { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: { expert: { played: 1, won: 1, lost: 0 } },
    ww: { lv: { L1600: { s: 2, h: 1, t: 5 } }, x: 0 } } } };
  const m2 = A.aggregatePlayers({
    devA: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneA, updatedAt: 2 },
    devC: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneC, updatedAt: 1 },
  })[0].games.wordweaver;
  ok('old ladder plays and new band plays both count', m2.total.won === 3 && m2.byDiff.ladder.won === 2 && m2.byDiff.expert.won === 1);
  ok('...and old levels show under their band: points 3x1 + 2x1 + 2x4 = 13', P.wwPoints(m2) === 13 && P.wwCleared(m2, 'easy') === 2 && P.wwPoints(m2, 'expert') === 8);
}

// --- the SPANISH ladder (2026-10-29): its own map, ww.es; points count both ladders ---
{
  const one = (lvEn, lvEs, x = 0) => ({ total: { played: 0, won: 0, lost: 0 }, byDiff: {}, ww: { lv: lvEn, ...(lvEs ? { es: lvEs } : {}), x } });
  const r = one({ L1: { s: 3, h: 0, t: 1 } }, { L1: { s: 2, h: 1, t: 2 }, L1501: { s: 3, h: 0, t: 3 } });
  ok('es: Spanish level 1 is not English level 1 (two levels)', P.wwCleared(r) === 3 && Object.keys(P.wwLevels(r)).join() === '1' && Object.keys(P.wwLevels(r, 'es')).sort().join() === '1,1501');
  ok('es: points count both ladders: 3x1 + 2x1 + 3x4 = 17', P.wwPoints(r) === 17 && P.wwPoints(r, 'expert') === 12 && P.wwStars(r) === 8 && P.wwThreeStars(r) === 2);
  ok('es: a record with no Spanish map reads exactly as before', P.wwPoints(one({ L1: { s: 3, h: 0, t: 1 } })) === 3);
  store.clear();
  G.recordWordWeaver(7, { hints: 1, extra: 2, lang: 'es' });
  let gs = G.loadStats().games.wordweaver;
  ok('es: the recorder writes ww.es.L7, not ww.lv.L7', gs.ww.es && gs.ww.es.L7 && gs.ww.es.L7.s === 2 && !gs.ww.lv.L7);
  ok('es: same play/win bucket and extra counter', gs.byDiff.easy.won === 1 && gs.ww.x === 2);
  G.recordWordWeaver(7, { hints: 0 });
  gs = G.loadStats().games.wordweaver;
  ok('es: English level 7 after Spanish level 7 leaves the Spanish entry alone', gs.ww.lv.L7.s === 3 && gs.ww.es.L7.s === 2 && P.wwCleared(gs) === 2);
  G.recordWordWeaver(7, { hints: 5, lang: 'es' });
  ok('es: a worse Spanish result never lowers it (rule 2)', G.loadStats().games.wordweaver.ww.es.L7.s === 2);
  const pA = { games: { wordweaver: one({}, { L3: { s: 1, h: 3, t: 9 } }) } };
  const pB = { games: { wordweaver: one({ L3: { s: 3, h: 0, t: 1 } }, { L3: { s: 3, h: 0, t: 5 }, L4: { s: 2, h: 1, t: 6 } }) } };
  const mm = A.aggregatePlayers({
    dA: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: pA, updatedAt: 2 },
    dB: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: pB, updatedAt: 1 },
  })[0].games.wordweaver;
  ok('es: a Spanish level merges the same way (3 hints on one phone: 1 star), beside the English map', mm.ww.es.L3.s === 1 && mm.ww.es.L3.h === 3 && mm.ww.es.L3.t === 5 && mm.ww.es.L4 && mm.ww.lv.L3.s === 3 && P.wwCleared(mm) === 3);
}

// --- the leaderboard ranks by total stars (static checks: the overlay needs a DOM) ---
{
  const lb = readFileSync(new URL('js/leaderboard-ui.js', ROOT), 'utf8');
  const gs = readFileSync(new URL('js/game-stats-ui.js', ROOT), 'utf8');
  ok('leaderboard: a GAME_META row', /\{ id: 'wordweaver', labelKey: 'game_title_wordweaver' \}/.test(lb));
  ok('leaderboard: the board number is wwPoints, a band filter = that band', /id === 'wordweaver'\) return wwPoints\(g\.games\.wordweaver, tier == null \? null : WW_TIERS\[tier - 1\]\)/.test(lb));
  ok('leaderboard: All is one number across bands (no tier pill)', /\(id === 'wayout' \|\| id === 'gridlock' \|\| id === 'wordweaver'\) && _tier == null\) return null;/.test(lb));
  ok('leaderboard: band tabs and band plays come from the per-level map (old ladder plays still show)',
    /id === 'wordweaver'\) tiers = \[1, 2, 3, 4\]\.filter/.test(lb) && /id === 'wordweaver' && _tier != null\) return wwCleared/.test(lb));
  ok('leaderboard: standing records (levels completed, three-star levels)', /wordweaver: \[\s*\{ labelKey: 'lb_tex_ww_cleared'[\s\S]*?lb_tex_ww_three/.test(lb));
  ok('My Stats: the unit is points, headline wwPoints, its own screen with a per-band table', /wordweaver: 'lb_unit_points'/.test(gs) && /id === 'wordweaver'\) return \{ n: wwPoints\(rec\)/.test(gs)
    && /wordWeaverScreen\(rec\)/.test(gs) && /wwPoints\(rec, k\)/.test(gs) && /wwThreeStars\(rec, k\)/.test(gs));
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
