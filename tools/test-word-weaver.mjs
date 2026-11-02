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

// --- hints recorded at tap time (Matt, 2026-10-29: "Close the hint gap") ---
{
  const lvAt = (rec, n) => P.wwLevels(rec)[n];
  // A save wiped after 2 hints, the level then finished "clean": it reads as 1 star, not 3.
  const wiped = { ww: { lv: { L7: { s: 3, h: 0, t: 200 } }, hint: { L7: { c: 2, t: 100 } }, x: 0 } };
  ok('hint cap: 2 hints recorded before a "clean" finish = 1 star', lvAt(wiped, 7).s === 1 && P.wwStars(wiped) === 1);
  ok('hint cap: the stored entry itself is untouched (read-time only)', wiped.ww.lv.L7.s === 3);
  // A hint on a second phone AFTER a clean finish on the first changes nothing.
  const later = { ww: { lv: { L7: { s: 3, h: 0, t: 100 } }, hint: { L7: { c: 4, t: 500 } } } };
  ok('hint cap: a hint after the completion does not lower it', lvAt(later, 7).s === 3);
  ok('hint cap: 1 hint before = 2 stars', lvAt({ ww: { lv: { L3: { s: 3, t: 9 } }, hint: { L3: { c: 1, t: 5 } } } }, 3).s === 2);
  ok('hint cap: Spanish hints cap only the Spanish ladder', P.wwLevels({ ww: { lv: { L2: { s: 3, t: 9 } }, es: { L2: { s: 3, t: 9 } }, esHint: { L2: { c: 3, t: 1 } } } }, 'es')[2].s === 1
    && P.wwLevels({ ww: { lv: { L2: { s: 3, t: 9 } }, esHint: { L2: { c: 3, t: 1 } } } })[2].s === 3);
  ok('hint merge: most hints, earliest first hint', JSON.stringify(P.wwHintBest({ c: 1, t: 50 }, { c: 3, t: 90 })) === JSON.stringify({ c: 3, t: 50 }));
  ok('hint merge: junk ignored', P.wwHintBest(null, { c: 0 }) === null && JSON.stringify(P.wwHintBest('x', { c: 2, t: 4 })) === JSON.stringify({ c: 2, t: 4 }));

  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaverHint(11, 1);
  G.recordWordWeaverHint(11, 2);
  G.recordWordWeaverHint(11, 1);                     // a lower count never lowers it
  G.recordWordWeaverHint(12, 1, 'es');
  const ww = G.loadStats().games.wordweaver.ww;
  ok('recorder: the hint count only grows, the first time is kept', ww.hint.L11.c === 2 && ww.hint.L11.t > 0);
  ok('recorder: Spanish hints go to esHint', ww.esHint && ww.esHint.L12.c === 1 && !ww.hint.L12);
  ok('recorder: a bad level writes nothing', G.recordWordWeaverHint(0, 1) === null && G.recordWordWeaverHint(2.5, 1) === null);
  G.recordWordWeaver(11, { hints: 0, extra: 0 });   // the save was wiped: the game thinks 0 hints
  ok('recorder + cap: the wiped-save replay scores 1 star', P.wwLevels(G.loadStats().games.wordweaver)[11].s === 1);

  // Two phones: hints on one, the level finished on the other later = capped once merged.
  const rec = (playerId, ww) => ({ profile: { playerId, name: 'Hinter' }, stats: { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww } } }, updatedAt: 100 });
  const g = A.aggregatePlayers({
    d1: rec('HH111', { lv: {}, x: 0, hint: { L5: { c: 2, t: 10 } } }),
    d2: rec('HH111', { lv: { L5: { s: 3, h: 0, t: 20 } }, x: 0 }),
  })[0].games.wordweaver;
  ok('merge: hint maps survive the combine and cap the other phone\'s finish', g.ww.hint.L5.c === 2 && P.wwLevels(g)[5].s === 1);
}

// --- free hints: every 10 bonus words earn one that costs no star (Matt, 2026-11-01) ---
{
  ok('free: 9 bonus words = 0, 10 = 1, 25 = 2', P.wwFreeHints({ ww: { x: 9 } }) === 0 && P.wwFreeHints({ ww: { x: 10 } }) === 1 && P.wwFreeHints({ ww: { x: 25 } }) === 2);
  ok('free: this level\'s bonus words count too', P.wwFreeHints({ ww: { x: 8 } }, 2) === 1);
  ok('free: used ones come off, never below 0', P.wwFreeHints({ ww: { x: 20, fu: 1 } }) === 1 && P.wwFreeHints({ ww: { x: 5, fu: 3 } }) === 0);
  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaver(1, { hints: 0, extra: 12 });
  ok('free: 12 bonus words recorded = 1 free hint', P.wwFreeHints(G.loadStats().games.wordweaver) === 1);
  G.recordWordWeaverFreeHint();
  const w = G.loadStats().games.wordweaver;
  ok('free: using one counts it (fu) and leaves no star cost', w.ww.fu === 1 && P.wwFreeHints(w) === 0 && !w.ww.hint);
  const rec = (playerId, ww) => ({ profile: { playerId, name: 'Free' }, stats: { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww } } }, updatedAt: 100 });
  const g = A.aggregatePlayers({ d1: rec('FF111', { lv: {}, x: 15, fu: 1 }), d2: rec('FF111', { lv: {}, x: 7, fu: 1 }) })[0].games.wordweaver;
  ok('free: two phones add bonus words and used free hints', g.ww.x === 22 && g.ww.fu === 2 && P.wwFreeHints(g) === 0);
}

// --- bonus squares and the bonus counter (Matt, 2026-11-02) ---
{
  ok('bonus squares: they count toward free hints with bonus words', P.wwBonuses({ ww: { x: 6, b: 3 } }, 1) === 10 && P.wwFreeHints({ ww: { x: 6, b: 3 } }, 1) === 1);
  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaver(3, { hints: 0, extra: 2, sym: 2 });
  G.recordWordWeaver(4, { hints: 0, extra: 0, sym: 9 });          // never more than 3 a level
  const w = G.loadStats().games.wordweaver.ww;
  ok('recorder: bonus squares add to ww.b (at most 3 a level), extra words stay their own count', w.b === 5 && w.x === 2);
  const rec = (playerId, ww) => ({ profile: { playerId, name: 'Sq' }, stats: { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww } } }, updatedAt: 100 });
  const g = A.aggregatePlayers({ d1: rec('SQ111', { lv: {}, x: 1, b: 2 }), d2: rec('SQ111', { lv: {}, x: 0, b: 4 }) })[0].games.wordweaver;
  ok('merge: bonus squares add across phones', g.ww.b === 6);
}

// --- at most 3 free hints banked (Matt, 2026-11-02) ---
{
  ok('cap: 50 bonuses earn 5 but only 3 are banked', P.wwFreeHints({ ww: { x: 50 } }) === 3 && P.wwFreeRaw({ ww: { x: 50 } }) === 5);
  ok('cap: lost ones are gone for good, not saved for later', P.wwFreeHints({ ww: { x: 50, fl: 2, fu: 3 } }) === 0 && P.wwFreeHints({ ww: { x: 60, fl: 2, fu: 3 } }) === 1);
  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaver(1, { hints: 0, extra: 45 });
  G.recordWordWeaverFreeLost(1);
  const w = G.loadStats().games.wordweaver;
  ok('recorder: lost ones counted in ww.fl; 4 earned, 1 lost = 3 banked', w.ww.fl === 1 && P.wwFreeHints(w) === 3 && P.wwFreeRaw(w) === 3);
  ok('recorder: a bad count writes nothing', G.recordWordWeaverFreeLost(0) === null);
}

// --- THE DAILY PUZZLE (2026-11-02, Matt: "Do 1") ---
{
  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaver(5, { hints: 0, extra: 1 });
  const before = P.wwPoints(G.loadStats().games.wordweaver);
  const D = 'en-2026-11-02';
  const st = G.withMode({ mode: 'daily', lang: 'en' }, 'daily', () => G.recordWordWeaverDaily(D, { hints: 1, extra: 4, sym: 2, ms: 95000 }));
  let w = G.loadStats().games.wordweaver;
  ok('daily recorder: returns the store', !!st);
  ok('daily: the entry is ww.dl[<lang>-<day>] = { s, h, t, ms }', w.ww.dl[D].s === 2 && w.ww.dl[D].h === 1 && w.ww.dl[D].ms === 95000 && w.ww.dl[D].t > 0);
  ok('daily: one play and one win under byDiff.daily, nothing in a band', w.byDiff.daily.played === 1 && w.byDiff.daily.won === 1 && w.byDiff.easy.played === 1);
  ok('daily: its MODE is recorded (byMode lang=en|mode=daily, chosen "daily")', w.byMode['lang=en|mode=daily'].daily.won === 1);
  ok('daily: no ladder points, no ladder level', P.wwPoints(w) === before && P.wwCleared(w) === 1 && !w.ww.lv.L1);
  ok('daily: its bonus words and squares count toward free hints', w.ww.x === 5 && w.ww.b === 2);
  ok('daily: counted once in the lifetime daily count', P.wwDailyCount(w) === 1);
  // Again on the same day (a wiped save): no second play; the entry only improves.
  G.withMode({ mode: 'daily', lang: 'en' }, 'daily', () => G.recordWordWeaverDaily(D, { hints: 0, ms: 120000 }));
  w = G.loadStats().games.wordweaver;
  ok('daily: the same day again is not a second play', w.byDiff.daily.played === 1 && w.total.played === 2);
  ok('daily: the same day again only improves (stars up, hints down, fastest kept)', w.ww.dl[D].s === 3 && w.ww.dl[D].h === 0 && w.ww.dl[D].ms === 95000);
  // Hints at tap time cap the stars (the hint-gap rule), keyed by the day, never a ladder level.
  const E = 'es-2026-11-03';
  ok('daily hint: recorded at tap time in ww.dh', !!G.recordWordWeaverDailyHint(E, 2) && G.loadStats().games.wordweaver.ww.dh[E].c === 2);
  G.withMode({ mode: 'daily', lang: 'es' }, 'daily', () => G.recordWordWeaverDaily(E, { hints: 0 }));
  w = G.loadStats().games.wordweaver;
  ok('daily hint: a wiped save gains nothing (3 stars stored, read as 1)', w.ww.dl[E].s === 3 && P.wwDaily(w)[E].s === 1);
  ok('daily hint: never in a ladder level\'s hint map', !w.ww.hint && !w.ww.esHint);
  ok('daily: the Spanish mode is its own', w.byMode['lang=es|mode=daily'].daily.won === 1);
  ok('daily: a bad key writes nothing', G.recordWordWeaverDaily('2026-11-02', { hints: 0 }) === null && G.recordWordWeaverDaily('12', { hints: 0 }) === null && G.recordWordWeaverDailyHint('L5', 1) === null);
  ok('daily: keys are never bare numbers', Object.keys(w.ww.dl).every((k) => P.WW_DAY_RE.test(k)));
  // Merge across a person's phones: the most hints, stars capped, the earliest time, the fastest solve; hints too.
  const rec = (ww) => ({ profile: { playerId: 'DD111', name: 'Daily' }, stats: { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: { daily: { played: 1, won: 1, lost: 0 } }, ww } } }, updatedAt: 100 });
  const g = A.aggregatePlayers({
    d1: rec({ lv: {}, x: 0, dl: { [D]: { s: 3, h: 0, t: 50, ms: 90000 } } }),
    d2: rec({ lv: {}, x: 0, dl: { [D]: { s: 2, h: 1, t: 70, ms: 60000 }, 'es-2026-11-04': { s: 3, h: 0, t: 9 } }, dh: { [D]: { c: 1, t: 60 } } }),
  })[0].games.wordweaver;
  ok('merge: a day on two phones is ONE day, the most hints and stars capped', JSON.stringify(g.ww.dl[D]) === JSON.stringify({ s: 2, h: 1, t: 50, ms: 60000 }));
  ok('merge: days add up across phones, hints merged', P.wwDailyCount(g) === 2 && g.ww.dh[D].c === 1);
  ok('merge: wwDailyBest vs wwDailyMerge', JSON.stringify(P.wwDailyBest({ s: 2, h: 1, t: 5, ms: 900 }, { s: 3, h: 0, t: 9, ms: 1200 })) === JSON.stringify({ s: 3, h: 0, t: 5, ms: 900 }));
}

// --- the daily board (word-weaver/js/board.js) and the day (word-weaver/js/daily.js) ---
{
  const B = await import('../word-weaver/js/board.js');
  const rows = B.rowsOf({
    AAAAA: { name: 'Ana', emoji: '🌸', o: 1, at: 2, stars: 3, hints: 0, sec: 300 },
    BBBBB: { name: 'Bo', emoji: '🐻', o: 1, at: 2, stars: 3, hints: 0, sec: 200 },
    CCCCC: { name: 'Cy', emoji: '🐱', o: 1, at: 2, stars: 2, hints: 1, sec: 50 },
    DDDDD: { name: 'Di', emoji: '🐶', o: 1, at: 2 },
    TTTTT: { name: 'test2', emoji: '🧪', o: 1, at: 2, stars: 3, hints: 0, sec: 1 },
  });
  ok('board: most stars, then fewest hints, then fastest; unfinished last', rows.map((r) => r.name).join() === 'Bo,Ana,Cy,Di');
  ok('board: test accounts hidden', !rows.some((r) => r.name === 'test2'));
  const shown = B.shownRows(rows, { name: 'Me', emoji: '🙂', done: true, stars: 3, hints: 0, sec: 200 }, 'AAAAA');
  ok('board: the own row comes from the phone, never twice; ties share a place', shown.map((r) => `${r.place}${r.name}`).join() === '1Bo,1Me,3Cy,0Di' && shown.filter((r) => r.me).length === 1);
  ok('board: times read m:ss', B.fmtSec(65) === '1:05' && B.fmtSec(3725) === '1:02:05' && B.fmtSec(0) === '0:00');
  const Dy = await import('../word-weaver/js/daily.js');
  ok('day: the epoch is day 0, the next local day is 1', Dy.dayNumber('2026-11-02', new Date(2026, 10, 2, 23, 59)) === 0 && Dy.dayNumber('2026-11-02', new Date(2026, 10, 3, 0, 1)) === 1);
  ok('day: the key is <lang>-<local date>', Dy.today(new Date(2026, 10, 5, 8).getTime()).key('es') === 'es-2026-11-05');
  ok('clock: the solve time is the larger of the running clock and the server wall time', Dy.clockSolve({ ms: 5000, t0: 1000, t0s: true }, { now: 61000, serverKnown: true }) === 60000
    && Dy.clockSolve({ ms: 90000, t0: 1000, t0s: true }, { now: 61000, serverKnown: true }) === 90000
    && Dy.clockSolve({ ms: 7000, t0: 1000, t0s: false }, { now: 61000, serverKnown: true }) === 7000);
  const ui = readFileSync(new URL('word-weaver/js/ui.js', ROOT), 'utf8');
  ok('ui: "today" comes from the server clock (daily.js today() = bestNow)', /today\(\)/.test(ui) && /bestNow/.test(readFileSync(new URL('word-weaver/js/daily.js', ROOT), 'utf8')) && !/new Date\(\)\.get/.test(ui));
  ok('ui: every daily result goes through withMode with mode "daily"', /withMode\(\{ mode: 'daily', lang \}, 'daily', \(\) => recordWordWeaverDaily\(/.test(ui));
  ok('ui: the daily save never touches the ladder saves', /writeDailyAttempt\(this\.daily\.key/.test(ui) && /if \(this\.daily\) return writeDailyAttempt/.test(ui));
  ok('ui: no code in the board rows (built from the in-memory list)', !/data-code|r\.code\b.*\$\{/.test(ui));
}

// --- bonus stars are a currency: hints are BOUGHT (Matt, 2026-11-02) ---
{
  ok('prices: letter 40, square 60, word 120', P.WW_PRICE.l === 40 && P.WW_PRICE.q === 60 && P.WW_PRICE.w === 120);
  ok('balance: collected (words + squares + pending) minus spent', P.wwBalance({ ww: { x: 50, b: 10 } }, 5) === 65 && P.wwCollected({ ww: { x: 50, b: 10 } }, 5) === 65);
  ok('balance: each free hint used before counts as 10 spent; lost ones do not', P.wwSpent({ ww: { fu: 3, fl: 2, sp: 40 } }) === 70 && P.wwBalance({ ww: { x: 100, fu: 3, fl: 2, sp: 40 } }) === 30);
  ok('balance: never below 0, an empty record reads 0', P.wwBalance({ ww: { x: 5, sp: 40 } }) === 0 && P.wwBalance(null) === 0 && P.wwSpent({}) === 0);
  store.clear();
  localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ games: { 'word-weaver': { live: true } } }));
  G.recordWordWeaver(1, { hints: 0, extra: 100, sym: 3 });
  ok('buy: a bad kind or cost writes nothing', G.recordWordWeaverBuy('x', 40) === null && G.recordWordWeaverBuy('l', 0) === null && !G.loadStats().games.wordweaver.ww.sp);
  G.recordWordWeaverBuy('l', 40, 'en-L2');
  G.recordWordWeaverBuy('w', 120, 'en-2026-11-02');
  G.recordWordWeaverBuy('q', 60, 'es-L3');
  G.recordWordWeaverBuy('l', 40, 'en-L2');
  const w = G.loadStats().games.wordweaver;
  ok('buy: spent counted in ww.sp, kinds in ww.by', w.ww.sp === 260 && w.ww.by.l === 2 && w.ww.by.q === 1 && w.ww.by.w === 1);
  ok('buy: never a hint (no star cost), never a play', !w.ww.hint && P.wwLevels(w)[1].s === 3 && w.total.played === 1);
  ok('buy: collected and spent read back', P.wwCollected(w) === 103 && P.wwSpent(w) === 260 && P.wwBalance(w) === 0);
  const rec = (playerId, ww) => ({ profile: { playerId, name: 'Buy' }, stats: { games: { wordweaver: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww } } }, updatedAt: 100 });
  const g = A.aggregatePlayers({ d1: rec('BY111', { lv: {}, x: 200, sp: 120, by: { w: 1 } }), d2: rec('BY111', { lv: {}, x: 60, b: 2, sp: 100, fu: 1, by: { l: 1, q: 1 } }) })[0].games.wordweaver;
  ok('merge: spent and bought add across phones', g.ww.sp === 220 && g.ww.by.l === 1 && g.ww.by.q === 1 && g.ww.by.w === 1);
  ok('merge: the person\'s balance = all collected - all spent', P.wwCollected(g) === 262 && P.wwSpent(g) === 230 && P.wwBalance(g) === 32);
  const ui = readFileSync(new URL('word-weaver/js/ui.js', ROOT), 'utf8');
  ok('ui: the spend is recorded BEFORE anything is revealed', ui.indexOf('recordWordWeaverBuy(kind, cost, where)') > 0 && ui.indexOf('recordWordWeaverBuy(kind, cost, where)') < ui.indexOf('this._reveal(keys, false)'));
  ok('ui: no free-hint writer is called any more', !/recordWordWeaverFree(Hint|Lost)\(/.test(ui));
}

// --- released (2026-11-02) ---
{
  const hub = readFileSync(new URL('js/hub.js', ROOT), 'utf8');
  const at = hub.indexOf("id: 'word-weaver'");
  if (at < 0) console.log('NOTE  js/hub.js has no word-weaver entry yet (the screens half adds it)');
  else {
    // Released 2026-11-02 (Matt: "release").
    const entry = hub.slice(at, hub.indexOf('\n  },', at));
    ok('hub: Word Weaver is released (no devOnly)', !/\bdevOnly:\s*true\b/.test(entry));
    ok('hub: Word Weaver has its released date (the New pill)', /\breleased:\s*'2026-11-02'/.test(entry));
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
