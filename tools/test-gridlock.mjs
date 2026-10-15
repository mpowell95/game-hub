import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-gridlock.mjs - Gridlock's points and stars (js/gridlock-points.js), its recorder
// (js/game-stats.js recordGridlock) and the cross-device merge (js/players-agg.js).
// Run: node tools/test-gridlock.mjs
//
// THE LAW is what matters here: a level's entry only ever improves, a replay never adds points,
// a level cleared on two phones counts once, and the per-level map survives the trip through
// Firebase (which turns numerically keyed objects into arrays: the keys are 'L<n>' for that).

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

const P = await import('../js/gridlock-points.js');
const G = await import('../js/game-stats.js');
const A = await import('../js/players-agg.js');

const { V1_TO_V2 } = await import('../js/gridlock-v1map.js');

// --- bands, points, stars (ladder 2) ---
ok('bands', P.glBandOf(1) === 'easy' && P.glBandOf(1000) === 'easy' && P.glBandOf(1001) === 'medium' && P.glBandOf(3000) === 'hard' && P.glBandOf(3001) === 'expert' && P.glBandOf(9999) === 'expert');
ok('band ends', P.glBandEnd('easy') === 1000 && P.glBandEnd('hard') === 3000 && P.glBandEnd('expert', 4000) === 4000);
ok('points: 1 for 1-500, +1 every 500, cap 8', P.glLevelPoints(1) === 1 && P.glLevelPoints(500) === 1 && P.glLevelPoints(501) === 2 && P.glLevelPoints(1001) === 3 && P.glLevelPoints(3501) === 8 && P.glLevelPoints(9000) === 8);
ok('points never jump more than 1 between neighbours', Array.from({ length: 4000 }, (_, i) => P.glLevelPoints(i + 2) - P.glLevelPoints(i + 1)).every((d) => d === 0 || d === 1));
ok('a hinted level pays half, rounded up', P.glHintedPoints(1) === 1 && P.glHintedPoints(1001) === 2 && P.glHintedPoints(3501) === 4);
ok('stars: fewest = 3', P.glStars(10, 10) === 3 && P.glStars(9, 10) === 3);
ok('stars: within a quarter (min 2) = 2', P.glStars(12, 10) === 2 && P.glStars(13, 10) === 2 && P.glStars(14, 10) === 1);

// --- the recorder ---
G.recordGridlock('easy', { level: 1, moves: 6, stars: 1, hints: 0 });
let g = G.loadStats().games.gridlock;
ok('a solve: one play, one win, in Easy', g.total.played === 1 && g.total.won === 1 && g.byDiff.easy.won === 1);
ok('a solve with no hint: written to ladder 2 with the crown and its time', g.gl.lv2.L1 && g.gl.lv2.L1.c === 1 && g.gl.lv2.L1.t > 0 && g.gl.lv2.L1.m === 6);
ok('...full points, the crown', P.glPoints(g) === 1 && P.glNoHint(g) === 1);
G.recordGridlock('easy', { level: 1, moves: 3, stars: 3, hints: 0 });
g = G.loadStats().games.gridlock;
ok('replay: counted as a play, the entry improves, NO extra points', g.total.won === 2 && g.gl.lv2.L1.m === 3 && g.gl.lv2.L1.s === 3 && P.glPoints(g) === 1 && P.glCleared(g) === 1);
// A hint AFTER a clean solve takes nothing away.
G.recordGridlockHint(1);
g = G.loadStats().games.gridlock;
ok('a hint after a clean solve keeps the crown and full points', P.glNoHint(g) === 1 && P.glPoints(g) === 1);

// Hint first on a Medium level: half points and no crown, for good.
G.recordGridlockHint(1600);
const firstHint = G.loadStats().games.gridlock.gl.hint.L1600;
G.recordGridlockHint(1600);
g = G.loadStats().games.gridlock;
ok('the first hint time is kept, never moved', g.gl.hint.L1600 === firstHint);
G.recordGridlock('medium', { level: 1600, moves: 20, stars: 2, hints: 1 });
g = G.loadStats().games.gridlock;
ok('solved with a hint: half points (level 1600 is worth 4, pays 2), no crown', P.glPoints(g, 'medium') === 2 && P.glNoHint(g, 'medium') === 0);
// Leave the level, come back, solve it with no hint in THIS attempt: still remembered per level.
G.recordGridlock('medium', { level: 1600, moves: 18, stars: 3, hints: 0 });
g = G.loadStats().games.gridlock;
ok('a later clean replay of a hinted level is still half, no crown (the crown trick is closed)', P.glPoints(g, 'medium') === 2 && P.glNoHint(g, 'medium') === 0 && g.gl.lv2.L1600.c === 0);
ok('...but its stars and moves still improve', g.gl.lv2.L1600.s === 3 && g.gl.lv2.L1600.m === 18);
ok('hints add', g.gl.hints === 1);
G.recordGridlock('easy', { level: 'x', moves: 0 });
g = G.loadStats().games.gridlock;
ok('a malformed solve records the play but invents no level (rule 4)', g.total.won === 5 && Object.keys(g.gl.lv2).length === 2);
ok('stored keys are L<n>, never bare numbers', ['lv2', 'hint'].every((k) => Object.keys(g.gl[k]).every((x) => /^L\d+$/.test(x))));

// --- ladder 1 (the first build's 400 levels) is read as the same boards on ladder 2 ---
ok('the map has all 400 ladder 1 levels, each on a different ladder 2 level', V1_TO_V2.length === 400 && new Set(V1_TO_V2).size === 400 && V1_TO_V2.every((n) => n >= 1));
{
  const old = { gl: { lv: { L1: { m: 3, s: 3, c: 1 }, L160: { m: 31, s: 2, c: 0 } }, hints: 1 } };
  const lv = P.glLevels(old);
  const a = V1_TO_V2[0], b = V1_TO_V2[159];
  ok('a ladder 1 level counts as its ladder 2 board', lv[a] && lv[a].m === 3 && lv[b] && lv[b].m === 31 && Object.keys(lv).length === 2);
  ok('an old clean solve (no time recorded) keeps its crown', P.glCrowned(lv[a], undefined) && P.glNoHint(old) === 1);
  ok('its points are the ladder 2 level\'s', P.glPoints(old) === P.glLevelPoints(a) + P.glHintedPoints(b));
  const both = { gl: { lv: { L1: { m: 5, s: 2, c: 0 } }, lv2: { ['L' + a]: { m: 4, s: 3, c: 1, t: 50 } } } };
  ok('the same board on both ladders counts ONCE, best of each', P.glCleared(both) === 1 && P.glLevels(both)[a].m === 4 && P.glLevels(both)[a].c === 1);
}

// --- through Firebase and across two phones ---
const phoneA = JSON.parse(JSON.stringify(G.loadStats()));
const phoneB = { games: { gridlock: { total: { played: 2, won: 2, lost: 0 }, byDiff: { easy: { played: 2, won: 2, lost: 0 } },
  gl: { lv: { L1: { m: 4, s: 2, c: 0 } }, lv2: { L1: { m: 4, s: 2, c: 0 }, L2: { m: 5, s: 3, c: 1, t: 10 } }, hint: {}, hints: 1 } } } };
const rows = A.aggregatePlayers({
  devA: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneA, updatedAt: 2 },
  devB: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneB, updatedAt: 1 },
});
ok('two phones are one person', rows.length === 1);
const m = rows[0].games.gridlock;
ok('merge: level 1 on both phones counts ONCE, with the best of each field', m.gl.lv2.L1.m === 3 && m.gl.lv2.L1.s === 3 && m.gl.lv2.L1.c === 1);
ok('merge: a level only phone B cleared is there', m.gl.lv2.L2 && m.gl.lv2.L2.m === 5);
ok('merge: ladder 1 entries merge too', m.gl.lv.L1 && m.gl.lv.L1.m === 4);
ok('merge: the earliest hint time is kept', m.gl.hint.L1600 === firstHint);
ok('merge: hints add', m.gl.hints === 2);
ok('gridlock is a SOLO game', A.SOLO.has('gridlock'));
{
  // A hint on one phone at time 100, a clean solve on the other LATER (t 200): half points.
  const merged = (hintAt, t) => A.aggregatePlayers({
    a: { profile: { name: 'Q', playerId: 'QQQ11' }, stats: { games: { gridlock: { gl: { hint: { L1600: hintAt } } } } } },
    b: { profile: { name: 'Q', playerId: 'QQQ11' }, stats: { games: { gridlock: { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, gl: { lv2: { L1600: { m: 20, s: 3, c: 1, t } } } } } } },
  })[0].games.gridlock;
  ok('two phones: a clean solve AFTER a hint on the other phone pays half', P.glPoints(merged(100, 200)) === 2 && P.glNoHint(merged(100, 200)) === 0);
  ok('two phones: a clean solve BEFORE a hint on the other phone keeps the crown', P.glPoints(merged(300, 200)) === 4 && P.glNoHint(merged(300, 200)) === 1);
}

// A store written before Gridlock existed loads with an empty, well formed sub-counter, and a store
// from the first build (lv only) gains lv2 and hint and keeps lv exactly as it was.
store.clear();
store.set('gamehub.stats', JSON.stringify({ version: 1, games: { snake: { total: { played: 1, won: 1, lost: 0 }, byDiff: {} },
  gridlock: { total: { played: 1, won: 1, lost: 0 }, byDiff: { easy: { played: 1, won: 1, lost: 0 } }, gl: { lv: { L2: { m: 3, s: 3, c: 1 } }, hints: 0 } } } }));
g = G.loadStats().games.gridlock;
ok('a first-build store keeps lv as stored and gains lv2 and hint', JSON.stringify(g.gl.lv) === JSON.stringify({ L2: { m: 3, s: 3, c: 1 } }) && JSON.stringify(g.gl.lv2) === '{}' && JSON.stringify(g.gl.hint) === '{}');
ok('...and its cleared level is visible as its ladder 2 board', P.glCleared(g) === 1 && P.glLevels(g)[V1_TO_V2[1]]);
ok('...and other games are untouched', G.loadStats().games.snake.total.played === 1);

// --- admin only until Matt has tested it (Matt, 2026-10-14: "make sure it's admin only until I've
// had time to fully test it"). The code default must stay devOnly with no `released` date; Matt
// releases it himself from the admin page, which overrides this default without a commit. Change
// these two checks only on his word.
{
  const { readFileSync } = await import('node:fs');
  const hub = readFileSync(new URL('./js/hub.js', __ROOT_URL), 'utf8');
  const at = hub.indexOf("id: 'gridlock'");
  const entry = at < 0 ? '' : hub.slice(at, hub.indexOf('\n  },', at));
  ok('hub: Gridlock has a GAMES entry', at >= 0);
  ok('hub: Gridlock is admin only (devOnly: true)', /\bdevOnly:\s*true\b/.test(entry));
  ok('hub: Gridlock has no released date (that is the New pill, for release day)', !/\breleased:/.test(entry));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
