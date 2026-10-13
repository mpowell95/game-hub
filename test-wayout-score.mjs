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
ok('no par any more', S.woParMs === undefined && S.WO_PAR_ARROW_MS === undefined);
ok('a level scores arrows per minute: 60 arrows in 1:00 = 60', Math.round(S.woFinishScore({ t: 60000, a: 60, r: 10 })) === 60);
ok('80 arrows in 0:40 = 120', Math.round(S.woFinishScore({ t: 40000, a: 80, r: 10 })) === 120);
ok('no cap: 600 arrows/min is 600', Math.round(S.woFinishScore({ t: 10000, a: 100, r: 10 })) === 600 && S.WO_SCORE_CAP === undefined);
ok('junk is not a finish', S.woFinishScore({ t: 0, a: 40, r: 10 }) === null && S.woFinishScore(null) === null);
ok('no finishes, no score', S.woFormScore([]) === null && S.woRunScore([]) === null);
ok('one level at 60, the other 9 count as 0: 6', Math.round(S.woFormScore([{ t: 60000, a: 60, r: 10 }])) === 6);
ok('Firebase object form reads as a list', S.woList({ 1: { t: 5, a: 1, r: 1 }, 0: { t: 4, a: 1, r: 1 } }).map((f) => f.t).join() === '4,5');
ok('mistakes climb: easy 10s then 20s', S.woMistakeMs('easy', 1) === 10000 && S.woMistakeMs('easy', 2) === 20000);
ok('expert mistakes: 30s then 60s', S.woMistakeMs('expert', 1) === 30000 && S.woMistakeMs('expert', 2) === 60000);
ok('a hint costs the base once', S.woHintMs('medium') === 15000 && S.woHintMs('hard') === 20000);
ok('clock', S.woClock(0) === '0:00' && S.woClock(83500) === '1:23' && S.woClock(3600000) === '60:00');

// Matt: "I don't want to penalize someone who puts the phone down mid play." 10 levels at 60 and 5
// distracted ones at 10: the 5 are dropped.
const good = { t: 60000, a: 60, r: 10 }, slow = { t: 360000, a: 60, r: 10 };   // 60 and 10 arrows/min
ok('best 10 of the last 15: five bad levels are dropped', Math.round(S.woFormScore([...Array(10).fill(good), ...Array(5).fill(slow)])) === 60);
ok('...a sixth bad one is not', Math.round(S.woFormScore([...Array(9).fill(good), ...Array(6).fill(slow)])) === 55);
ok('only the last 15 count', Math.round(S.woFormScore([...Array(5).fill(slow), ...Array(15).fill(good)])) === 60);

// --- the recorder, on top of a store the OLD writer made (rule 7) ---
G.recordResult('wayout', 'easy', true);
G.recordResult('wayout', 'hard', true);
let g = G.loadStats().games.wayout;
ok('old solves load intact', g.total.won === 2 && g.byDiff.hard.won === 1 && g.byDiff.easy.won === 1);
ok('the new sub-counter is added empty', g.wo && g.wo.timed.hard === 0 && g.wo.best.hard.length === 0);

G.recordWayOut('hard', { timeMs: 50000, penaltyMs: 10000, arrows: 60, rounds: 10, mistakes: 1, hints: 0, timed: true });
g = G.loadStats().games.wayout;
ok('a timed level counts as solved like before', g.total.won === 3 && g.total.played === 3 && g.byDiff.hard.won === 2);
ok('it is timed, penalties included', g.wo.timed.hard === 1 && g.wo.recent.hard[0].t === 60000 && g.wo.mistakes === 1);
ok('one level at 60 arrows/min: score 6 until there are 10', S.woRating(g.wo, 'hard') === 6);

G.recordWayOut('hard', { timeMs: 0, penaltyMs: 0, arrows: 60, rounds: 10, timed: false });
g = G.loadStats().games.wayout;
ok('an untimed level counts as solved, adds no score', g.total.won === 4 && g.wo.timed.hard === 1 && g.wo.recent.hard.length === 1);

for (let i = 0; i < 9; i++) G.recordWayOut('hard', { timeMs: 30000, penaltyMs: 0, arrows: 60, rounds: 10, timed: true });   // 120 each
g = G.loadStats().games.wayout;
// recent: one 60 and nine 120 -> (60 + 1080)/10 = 114
ok('ten levels: the real average', S.woRating(g.wo, 'hard') === 114);
ok('tiers are separate', S.woRating(g.wo, 'easy') === null);
const bestWas = S.woRunScore(g.wo.best.hard);
G.recordWayOut('hard', { timeMs: 360000, penaltyMs: 0, arrows: 60, rounds: 10, timed: true });   // 10
g = G.loadStats().games.wayout;
ok('a slow level is dropped from the score (best 10 of 11)', S.woRating(g.wo, 'hard') === 114);
ok('the stored best 10-in-a-row run never gets worse (rule 2)', S.woRunScore(g.wo.best.hard) === bestWas);
for (let i = 0; i < 12; i++) G.recordWayOut('medium', { timeMs: 60000, penaltyMs: 0, arrows: 60, rounds: 10, timed: true });
ok('recent keeps the last 15', G.loadStats().games.wayout.wo.recent.hard.length === 11 && G.loadStats().games.wayout.wo.recent.medium.length === 12);

console.log(`\nArrow Maze score tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
