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

console.log(`\nArrow Maze timer tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
