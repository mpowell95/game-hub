// test-arrow-maze-time.mjs - Arrow Maze's timer (2026-10-13): js/arrow-maze-time.js and
// js/game-stats.js's recordWayOut. Run: node test-arrow-maze-time.mjs
//
// What matters most here is THE LAW: a level cleared before the timer still counts as solved,
// every timed finish is kept, the first build's finish lists are carried into the log, and nothing
// is invented for a level with no honest time. Rule 7: the "old store" below is written by the OLD
// writer, recordResult('wayout', ...), which is what every device used until the timer shipped.

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

const T = await import('./js/arrow-maze-time.js');
const G = await import('./js/game-stats.js');

// --- penalties and the clock ---
ok('Firebase object form reads as a list', T.woList({ 1: { t: 5, a: 1, r: 1 }, 0: { t: 4, a: 1, r: 1 } }).map((f) => f.t).join() === '4,5');
ok('junk is not a finish', T.woList([{ t: 0, a: 40, r: 10 }, null, 'x']).length === 0);
ok('mistakes climb: easy 10s then 20s', T.woMistakeMs('easy', 1) === 10000 && T.woMistakeMs('easy', 2) === 20000);
ok('medium 15s/30s, hard 20s/40s', T.woMistakeMs('medium', 2) === 30000 && T.woMistakeMs('hard', 1) === 20000 && T.woMistakeMs('hard', 2) === 40000);
ok('expert mistakes: 30s then 60s', T.woMistakeMs('expert', 1) === 30000 && T.woMistakeMs('expert', 2) === 60000);
ok('a hint costs the base once', T.woHintMs('easy') === 10000 && T.woHintMs('medium') === 15000 && T.woHintMs('expert') === 30000);
ok('clock', T.woClock(0) === '0:00' && T.woClock(83500) === '1:23' && T.woClock(3600000) === '60:00');

// --- the recorder, on top of a store the OLD writer made (rule 7) ---
G.recordResult('wayout', 'easy', true);
G.recordResult('wayout', 'hard', true);
let g = G.loadStats().games.wayout;
ok('old solves load intact', g.total.won === 2 && g.byDiff.hard.won === 1 && g.byDiff.easy.won === 1);

G.recordWayOut('hard', { timeMs: 50000, penaltyMs: 10000, arrows: 60, rounds: 10, mistakes: 1, hints: 2, timed: true });
g = G.loadStats().games.wayout;
ok('a timed level counts as solved like before', g.total.won === 3 && g.total.played === 3 && g.byDiff.hard.won === 2);
const f0 = g.wo.log.hard[0];
ok('it is logged raw, penalties in the time', g.wo.timed.hard === 1 && f0.t === 60000 && f0.a === 60 && f0.r === 10 && f0.m === 1 && f0.h === 2);
ok('counters', g.wo.mistakes === 1 && g.wo.hints === 2);

G.recordWayOut('hard', { timeMs: 0, penaltyMs: 0, arrows: 60, rounds: 10, timed: false });
g = G.loadStats().games.wayout;
ok('an untimed level counts as solved, logs nothing', g.total.won === 4 && g.wo.timed.hard === 1 && g.wo.log.hard.length === 1);

for (let i = 0; i < 20; i++) G.recordWayOut('hard', { timeMs: 30000 + i, penaltyMs: 0, arrows: 60, rounds: 10, timed: true });
g = G.loadStats().games.wayout;
ok('every timed finish is kept, in order', g.wo.log.hard.length === 21 && g.wo.log.hard[20].t === 30019 && g.wo.timed.hard === 21);
ok('tiers are separate', g.wo.log.easy.length === 0 && g.wo.timed.easy === 0);

// --- a store from the first timed build: `recent`/`best`, no `log` ---
store.clear();
G.recordResult('wayout', 'hard', true);
const st = G.loadStats();
st.games.wayout.wo = { timed: { hard: 2 }, mistakes: 1, hints: 0,
  recent: { hard: [{ t: 40000, a: 50, r: 9 }, { t: 41000, a: 51, r: 9 }] }, best: { hard: [{ t: 40000, a: 50, r: 9 }] } };
localStorage.setItem(G.statsKey(), JSON.stringify(st));
G.recordWayOut('hard', { timeMs: 42000, penaltyMs: 0, arrows: 52, rounds: 9, timed: true });
g = G.loadStats().games.wayout;
ok('the first build\'s finishes seed the log', g.wo.log.hard.map((f) => f.t).join() === '40000,41000,42000');
ok('its recent and best stay as stored (rule 5)', g.wo.recent.hard.length === 2 && g.wo.best.hard.length === 1);
ok('counters carry on', g.wo.timed.hard === 3 && g.wo.mistakes === 1 && g.total.won === 2);

// --- the ladder and its points (2026-10-14) ---
ok('bands: Easy 1-50, Medium 51-100, Hard 101-150, Expert 151 on', T.bandOf(1) === 'easy' && T.bandOf(50) === 'easy'
  && T.bandOf(51) === 'medium' && T.bandOf(100) === 'medium' && T.bandOf(101) === 'hard' && T.bandOf(150) === 'hard'
  && T.bandOf(151) === 'expert' && T.bandOf(9999) === 'expert');
ok('band ends', T.bandEnd('easy') === 50 && T.bandEnd('hard') === 150 && T.bandEnd('expert') === Infinity);
ok('points per level: Easy 1, Medium 2, Hard 4, Expert 6', T.woLevelPoints(1) === 1 && T.woLevelPoints(50) === 1
  && T.woLevelPoints(51) === 2 && T.woLevelPoints(100) === 2 && T.woLevelPoints(101) === 4 && T.woLevelPoints(150) === 4
  && T.woLevelPoints(151) === 6 && T.woLevelPoints(5000) === 6);
ok('a band\'s points are its cleared count times its points', T.woBandPoints('easy', 26) === 26 && T.woBandPoints('medium', 1) === 2
  && T.woBandPoints('hard', 27) === 108 && T.woBandPoints('expert', 2) === 12 && T.woBandPoints('easy', 0) === 0 && T.woBandPoints('nope', 5) === 0);
ok('an old count past a band\'s 50 keeps earning the same per level', T.woBandPoints('easy', 52) === 52);
// The real players' cleared counts on 2026-10-14 (read from players/, see way-out/CLAUDE.md).
const rec = (e, m, h, x) => ({ byDiff: { easy: { won: e }, medium: { won: m }, hard: { won: h }, expert: { won: x } } });
ok('King of Games 20 Easy, 27 Hard, 1 Expert = 134', T.woPoints(rec(20, 0, 27, 1)) === 134);
ok('Anita 23 Easy, 9 Medium, 1 Expert = 47; MattyIce 1, 10, 5 = 41; Ele 26 Easy = 26', T.woPoints(rec(23, 9, 0, 1)) === 47
  && T.woPoints(rec(1, 10, 5, 0)) === 41 && T.woPoints(rec(26, 0, 0, 0)) === 26);
ok('one difficulty alone', T.woPoints(rec(20, 0, 27, 1), 'hard') === 108 && T.woPoints(rec(20, 0, 27, 1), 'nope') === 0);
ok('no record, no points', T.woPoints(null) === 0 && T.woPoints({}) === 0);
ok('the log keeps ladder level, generator and date', (() => { const f = T.woList([{ t: 9, a: 3, r: 2, l: 61, g: 5, d: 1760000000000 }])[0]; return f.l === 61 && f.g === 5 && f.d === 1760000000000; })());
store.clear();
G.recordWayOut('medium', { timeMs: 30000, penaltyMs: 0, arrows: 40, rounds: 14, timed: true, level: 61, gen: 5 });
g = G.loadStats().games.wayout;
ok('the recorder stores the ladder level, generator and date', g.wo.log.medium[0].l === 61 && g.wo.log.medium[0].g === 5 && g.wo.log.medium[0].d > 0);
ok('and counts it in its band', g.byDiff.medium.won === 1 && T.woPoints(g) === 2);

console.log(`\nArrow Maze timer tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
