// test-gridlock.mjs - Gridlock's points and stars (js/gridlock-points.js), its recorder
// (js/game-stats.js recordGridlock) and the cross-device merge (js/players-agg.js).
// Run: node test-gridlock.mjs
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

const P = await import('./js/gridlock-points.js');
const G = await import('./js/game-stats.js');
const A = await import('./js/players-agg.js');

// --- bands, points, stars ---
ok('bands', P.glBandOf(1) === 'easy' && P.glBandOf(50) === 'easy' && P.glBandOf(51) === 'medium' && P.glBandOf(150) === 'hard' && P.glBandOf(151) === 'expert' && P.glBandOf(999) === 'expert');
ok('band ends', P.glBandEnd('easy') === 50 && P.glBandEnd('hard') === 150 && P.glBandEnd('expert', 400) === 400);
ok('points: 1 for 1-25, +1 every 25, cap 8', P.glLevelPoints(1) === 1 && P.glLevelPoints(25) === 1 && P.glLevelPoints(26) === 2 && P.glLevelPoints(51) === 3 && P.glLevelPoints(176) === 8 && P.glLevelPoints(500) === 8);
ok('stars: fewest = 3', P.glStars(10, 10) === 3 && P.glStars(9, 10) === 3);
ok('stars: within a quarter (min 2) = 2', P.glStars(12, 10) === 2 && P.glStars(13, 10) === 2 && P.glStars(14, 10) === 1);
ok('stars: easy levels get 2 moves of slack', P.glStars(5, 3) === 2 && P.glStars(6, 3) === 1);
ok('stars: long levels get a quarter', P.glStars(50, 40) === 2 && P.glStars(51, 40) === 1);

// --- the recorder ---
G.recordGridlock('easy', { level: 1, moves: 6, stars: 1, hints: 1 });
let g = G.loadStats().games.gridlock;
ok('first solve: one play, one win, in Easy', g.total.played === 1 && g.total.won === 1 && g.byDiff.easy.won === 1);
ok('first solve: the level entry', JSON.stringify(g.gl.lv.L1) === JSON.stringify({ m: 6, s: 1, c: 0 }));
ok('first solve: points 1, cleared 1', P.glPoints(g) === 1 && P.glCleared(g) === 1);
// Wait out the rate gate's window with a clock that moves (it allows 30 a minute; we are far under).
G.recordGridlock('easy', { level: 1, moves: 3, stars: 3, hints: 0 });
g = G.loadStats().games.gridlock;
ok('replay: counted as a play and a win', g.total.played === 2 && g.total.won === 2);
ok('replay: the entry improves (fewer moves, more stars, no-hint)', JSON.stringify(g.gl.lv.L1) === JSON.stringify({ m: 3, s: 3, c: 1 }));
ok('replay: NO extra points', P.glPoints(g) === 1 && P.glCleared(g) === 1);
G.recordGridlock('easy', { level: 1, moves: 9, stars: 1, hints: 2 });
g = G.loadStats().games.gridlock;
ok('a worse replay never takes anything back (THE LAW rule 2)', JSON.stringify(g.gl.lv.L1) === JSON.stringify({ m: 3, s: 3, c: 1 }));
ok('hints add', g.gl.hints === 3);
G.recordGridlock('medium', { level: 60, moves: 20, stars: 2, hints: 0 });
G.recordGridlock('expert', { level: 151, moves: 40, stars: 3, hints: 0 });
g = G.loadStats().games.gridlock;
ok('points add across bands', P.glPoints(g) === 1 + 3 + 7);
ok('points per band', P.glPoints(g, 'medium') === 3 && P.glPoints(g, 'expert') === 7 && P.glPoints(g, 'hard') === 0);
ok('three-star and no-hint counts', P.glThreeStars(g) === 2 && P.glNoHint(g) === 3);
G.recordGridlock('easy', { level: 'x', moves: 0 });
g = G.loadStats().games.gridlock;
ok('a malformed solve records the play but invents no level (rule 4)', g.total.won === 6 && Object.keys(g.gl.lv).length === 3);
ok('stored keys are L<n>, never bare numbers', Object.keys(g.gl.lv).every((k) => /^L\d+$/.test(k)));

// --- through Firebase and across two phones ---
// Firebase hands a store back as JSON; the map stays an object because its keys are not numbers.
const phoneA = JSON.parse(JSON.stringify(G.loadStats()));
const phoneB = { games: { gridlock: { total: { played: 2, won: 2, lost: 0 }, byDiff: { easy: { played: 2, won: 2, lost: 0 } },
  gl: { lv: { L1: { m: 4, s: 2, c: 0 }, L2: { m: 5, s: 3, c: 1 } }, hints: 1 } } } };
const rows = A.aggregatePlayers({
  devA: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneA, updatedAt: 2 },
  devB: { profile: { name: 'Pat', playerId: 'PAT11' }, stats: phoneB, updatedAt: 1 },
});
ok('two phones are one person', rows.length === 1);
const m = rows[0].games.gridlock;
ok('merge: level 1 on both phones counts ONCE, with the best of each field', JSON.stringify(m.gl.lv.L1) === JSON.stringify({ m: 3, s: 3, c: 1 }));
ok('merge: a level only phone B cleared is there', JSON.stringify(m.gl.lv.L2) === JSON.stringify({ m: 5, s: 3, c: 1 }));
ok('merge: points are the union of levels, not a sum', P.glPoints(m) === 1 + 1 + 3 + 7);
ok('merge: hints add', m.gl.hints === 4);
ok('gridlock is a SOLO game', A.SOLO.has('gridlock'));

// A store written before Gridlock existed loads with an empty, well formed sub-counter.
store.clear();
store.set('gamehub.stats', JSON.stringify({ version: 1, games: { snake: { total: { played: 1, won: 1, lost: 0 }, byDiff: {} } } }));
g = G.loadStats().games.gridlock;
ok('an older store gains an empty gridlock record', g && g.total.played === 0 && g.gl && JSON.stringify(g.gl.lv) === '{}' && P.glPoints(g) === 0);
ok('...and keeps what it had', G.loadStats().games.snake.total.played === 1);

// --- admin only until Matt has tested it (Matt, 2026-10-14: "make sure it's admin only until I've
// had time to fully test it"). The code default must stay devOnly with no `released` date; Matt
// releases it himself from the admin page, which overrides this default without a commit. Change
// these two checks only on his word.
{
  const { readFileSync } = await import('node:fs');
  const hub = readFileSync(new URL('./js/hub.js', import.meta.url), 'utf8');
  const at = hub.indexOf("id: 'gridlock'");
  const entry = at < 0 ? '' : hub.slice(at, hub.indexOf('\n  },', at));
  ok('hub: Gridlock has a GAMES entry', at >= 0);
  ok('hub: Gridlock is admin only (devOnly: true)', /\bdevOnly:\s*true\b/.test(entry));
  ok('hub: Gridlock has no released date (that is the New pill, for release day)', !/\breleased:/.test(entry));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
