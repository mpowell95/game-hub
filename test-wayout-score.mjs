// test-wayout-score.mjs - Arrow Maze's timed score (2026-10-13): js/wayout-score.js and
// js/game-stats.js's recordWayOut. Run: node test-wayout-score.mjs
//
// What matters most here is THE LAW: a level cleared before the timer still counts as solved, a
// stored best only ever moves to a better run, and nothing is invented for a level with no honest
// time. Rule 7: the "old store" below is written by the OLD writer, recordResult('wayout', ...),
// which is still in game-stats.js unchanged and is what every device used until this shipped.

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

const S = await import('./js/wayout-score.js');
const G = await import('./js/game-stats.js');

// --- the maths ---
ok('15 recent, best 10 count', S.WO_RECENT === 15 && S.WO_RUN === 10);
ok('par: arrows and rounds', S.woParMs(40, 10) === 40 * 1500 + 10 * 2500);
ok('a finish at par scores 100', Math.round(S.woFinishScore({ t: 85000, a: 40, r: 10 })) === 100);
ok('twice as fast as par scores 200', Math.round(S.woFinishScore({ t: 42500, a: 40, r: 10 })) === 200);
ok('no cap: 10x faster than par scores 1000', Math.round(S.woFinishScore({ t: 8500, a: 40, r: 10 })) === 1000 && S.WO_SCORE_CAP === undefined);
ok('junk is not a finish', S.woFinishScore({ t: 0, a: 40, r: 10 }) === null && S.woFinishScore(null) === null);
ok('no finishes, no run score', S.woRunScore([]) === null);
ok('one finish at 200 counts the other 9 as par: 110', Math.round(S.woRunScore([{ t: 42500, a: 40, r: 10 }])) === 110);
const ten = Array.from({ length: 12 }, () => ({ t: 85000, a: 40, r: 10 }));
ok('a run uses the last 10 only', Math.round(S.woRunScore(ten)) === 100);
ok('Firebase object form reads as a list', S.woList({ 1: { t: 5, a: 1, r: 1 }, 0: { t: 4, a: 1, r: 1 } }).map((f) => f.t).join() === '4,5');
ok('mistakes climb: easy 10s then 20s', S.woMistakeMs('easy', 1) === 10000 && S.woMistakeMs('easy', 2) === 20000);
ok('expert mistakes: 30s then 60s', S.woMistakeMs('expert', 1) === 30000 && S.woMistakeMs('expert', 2) === 60000);
ok('a hint costs the base once', S.woHintMs('medium') === 15000 && S.woHintMs('hard') === 20000);
ok('clock', S.woClock(0) === '0:00' && S.woClock(83500) === '1:23' && S.woClock(3600000) === '60:00');

// --- the recorder, on top of a store the OLD writer made (rule 7) ---
G.recordResult('wayout', 'easy', true);
G.recordResult('wayout', 'hard', true);
let g = G.loadStats().games.wayout;
ok('old solves load intact', g.total.won === 2 && g.byDiff.hard.won === 1 && g.byDiff.easy.won === 1);
ok('the new sub-counter is added empty', g.wo && g.wo.timed.hard === 0 && g.wo.best.hard.length === 0);

G.recordWayOut('hard', { timeMs: 80000, penaltyMs: 5000, arrows: 40, rounds: 10, mistakes: 1, hints: 0, timed: true });
g = G.loadStats().games.wayout;
ok('a timed level counts as solved like before', g.total.won === 3 && g.total.played === 3 && g.byDiff.hard.won === 2);
ok('it is timed, penalties included', g.wo.timed.hard === 1 && g.wo.recent.hard[0].t === 85000 && g.wo.mistakes === 1);
ok('its run is the best run', S.woRating(g.wo, 'hard') === 100);

G.recordWayOut('hard', { timeMs: 0, penaltyMs: 0, arrows: 40, rounds: 10, timed: false });
g = G.loadStats().games.wayout;
ok('an untimed level counts as solved, adds no score', g.total.won === 4 && g.wo.timed.hard === 1 && g.wo.recent.hard.length === 1);

G.recordWayOut('hard', { timeMs: 170000, penaltyMs: 0, arrows: 40, rounds: 10, timed: true });   // score 50
g = G.loadStats().games.wayout;
ok('a slow level joins recent', g.wo.recent.hard.length === 2);
// recent [100, 50] -> best 10 of them, the other 8 as par: (150 + 800)/10 = 95
ok('under 10 levels, a slow one counts (nothing to drop yet)', S.woRating(g.wo, 'hard') === 95);
ok('...but the stored best 10-in-a-row run never gets worse (rule 2)', S.woRunScore(g.wo.best.hard) === 100);

for (let i = 0; i < 3; i++) G.recordWayOut('hard', { timeMs: 42500, penaltyMs: 0, arrows: 40, rounds: 10, timed: true });
g = G.loadStats().games.wayout;
// recent [100, 50, 200, 200, 200] -> (750 + 500)/10 = 125
ok('fast levels lift the score', S.woRating(g.wo, 'hard') === 125);
ok('tiers are separate', S.woRating(g.wo, 'easy') === null);

// Matt: "I don't want to penalize someone who puts the phone down mid play." 10 at par and 5
// distracted ones: the 5 are dropped, the score stays 100.
const par = { t: 85000, a: 40, r: 10 }, slow = { t: 425000, a: 40, r: 10 };   // slow = 20
ok('best 10 of the last 15: five bad levels are dropped', Math.round(S.woFormScore([...Array(10).fill(par), ...Array(5).fill(slow)])) === 100);
ok('...a sixth bad one is not', Math.round(S.woFormScore([...Array(9).fill(par), ...Array(6).fill(slow)])) === 92);
ok('only the last 15 count', Math.round(S.woFormScore([...Array(5).fill(slow), ...Array(15).fill(par)])) === 100);
for (let i = 0; i < 20; i++) G.recordWayOut('medium', { timeMs: 85000, penaltyMs: 0, arrows: 40, rounds: 10, timed: true });
ok('recent keeps the last 15', G.loadStats().games.wayout.wo.recent.medium.length === 15);

console.log(`\nArrow Maze score tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
