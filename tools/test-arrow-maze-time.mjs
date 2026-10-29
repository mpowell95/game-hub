import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-arrow-maze-time.mjs - Arrow Maze's timer (2026-10-13): js/arrow-maze-time.js and
// js/game-stats.js's recordWayOut. Run: node tools/test-arrow-maze-time.mjs
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

const T = await import('../js/arrow-maze-time.js');
const G = await import('../js/game-stats.js');

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
ok('bands: Easy 1-50, Medium 51-100, Hard 101-200, Expert 201 on', T.bandOf(1) === 'easy' && T.bandOf(50) === 'easy'
  && T.bandOf(51) === 'medium' && T.bandOf(100) === 'medium' && T.bandOf(101) === 'hard' && T.bandOf(200) === 'hard'
  && T.bandOf(201) === 'expert' && T.bandOf(9999) === 'expert');
ok('band ends', T.bandEnd('easy') === 50 && T.bandEnd('medium') === 100 && T.bandEnd('hard') === 200 && T.bandEnd('expert') === Infinity);
ok('points per level: Easy 1, Medium 2, Hard 4, Expert 6', T.woLevelPoints(1) === 1 && T.woLevelPoints(50) === 1
  && T.woLevelPoints(51) === 2 && T.woLevelPoints(100) === 2 && T.woLevelPoints(101) === 4 && T.woLevelPoints(200) === 4
  && T.woLevelPoints(201) === 6 && T.woLevelPoints(5000) === 6);
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

// --- Rush (2026-10-14) ---
ok('week key: the Monday, in UTC', T.woWeekKey(Date.UTC(2026, 9, 14, 3)) === '2026-10-12' && T.woWeekKey(Date.UTC(2026, 9, 12, 0)) === '2026-10-12'
  && T.woWeekKey(Date.UTC(2026, 9, 11, 23, 59)) === '2026-10-05' && T.woWeekKey(Date.UTC(2026, 9, 18, 23)) === '2026-10-12');
ok('week end: the next Monday 00:00 UTC', T.woWeekEnd(Date.UTC(2026, 9, 14, 3)) === Date.UTC(2026, 9, 19) && T.woWeekEnd(Date.UTC(2026, 9, 18, 23, 59)) === Date.UTC(2026, 9, 19)
  && T.woWeekEnd(Date.UTC(2026, 9, 19)) === Date.UTC(2026, 9, 26));
store.clear();
G.recordWayOut('easy', { timeMs: 20000, penaltyMs: 0, arrows: 12, rounds: 4, timed: true, level: 2, gen: 6 });
const mon = Date.UTC(2026, 9, 13, 12);
G.recordWayOutRush('easy', { arrows: 25, boards: 1, ms: 31000, mistakes: 1, seed: 77, at: mon });
G.recordWayOutRush('easy', { arrows: 40, boards: 2, ms: 45000, mistakes: 0, seed: 78, at: mon + 1000, left: true });
G.recordWayOutRush('easy', { arrows: 18, boards: 1, ms: 25000, mistakes: 2, seed: 79, at: mon + 2000 });
G.recordWayOutRush('hard', { arrows: 9, boards: 0, ms: 15000, mistakes: 0, seed: 80, at: mon + 3000 });
G.recordWayOutRush('easy', { arrows: 3, boards: 0, ms: 9000, mistakes: 0, seed: 81, at: Date.UTC(2026, 9, 20, 9) });
g = G.loadStats().games.wayout;
ok('rush: every run is kept raw, the lost one too', g.wo.rush.runs.easy.length === 4 && g.wo.rush.runs.easy[1].left === 1 && g.wo.rush.runs.easy[0].sd === 77);
ok('rush: a week\'s best is the best COUNTED run (the left one never counts)', T.woRushBest(g, 'easy', '2026-10-12') === 25 && T.woRushBest(g, 'hard', '2026-10-12') === 9);
ok('rush: a new week starts its own best', T.woRushBest(g, 'easy', '2026-10-19') === 3 && T.woRushBest(g, 'hard', '2026-10-19') === null);
ok('rush: the weeks, newest first', T.woRushWeeks(g).join() === '2026-10-19,2026-10-12');
ok('rush: a run is not a level (no play, no points)', g.total.played === 1 && g.byDiff.easy.won === 1 && T.woPoints(g) === 1);
ok('rush: the level log is untouched', g.wo.log.easy.length === 1 && g.wo.timed.easy === 1);
ok('rush: an unknown mode records nothing', G.recordWayOutRush('expert', { arrows: 5 }) === null);
ok('rush: a malformed run list is cleaned, not crashed on', T.woRushRuns([null, { s: 'x' }, { s: 4, d: 5, w: 'nope' }, { s: 4, d: 5, w: '2026-10-12' }]).length === 1);

// --- Hints and lost lives cost points (2026-10-17) ---
ok('slip table: Expert 6, 4, 2, 1; Hard 4, 3, 2, 1; Medium 2, 1; Easy 1',
  [0, 1, 2, 3, 9].map((n) => T.woEarnedPoints('expert', n)).join() === '6,4,2,1,1'
  && [0, 1, 2, 3, 4].map((n) => T.woEarnedPoints('hard', n)).join() === '4,3,2,1,1'
  && [0, 1, 5].map((n) => T.woEarnedPoints('medium', n)).join() === '2,1,1'
  && [0, 3].map((n) => T.woEarnedPoints('easy', n)).join() === '1,1' && T.woEarnedPoints('nope', 0) === 0);
store.clear();
G.recordWayOut('expert', { timeMs: 90000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 1, hints: 1, timed: true, level: 201, gen: 6 });
G.recordWayOut('expert', { timeMs: 80000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, timed: true, level: 202, gen: 6 });
g = G.loadStats().games.wayout;
ok('a hint and a lost life on Expert earn 2, a clean Expert level 6', g.wo.pts.expert === 8 && g.wo.ptsN.expert === 2 && T.woPoints(g) === 8 && T.woPoints(g, 'expert') === 8);
G.recordWayOut('hard', { timeMs: 0, arrows: 60, rounds: 20, mistakes: 3, hints: 0, timed: false, level: 101, gen: 6 });
g = G.loadStats().games.wayout;
ok('an untimed level (slips unknown) keeps its full points', g.byDiff.hard.won === 1 && g.wo.ptsN.hard === 0 && T.woPoints(g, 'hard') === 4 && T.woPoints(g) === 12);
const stripped = JSON.parse(JSON.stringify(g)); delete stripped.wo.pts; delete stripped.wo.ptsN;
ok('a record from before this (no pts counters) scores every level in full, as it always did', T.woPoints(stripped) === 6 * 2 + 4);
ok('counters out of range are clamped: never more than full, never under 1 a level',
  T.woPoints({ byDiff: { expert: { won: 2 } }, wo: { pts: { expert: 99 }, ptsN: { expert: 2 } } }) === 12
  && T.woPoints({ byDiff: { expert: { won: 2 } }, wo: { pts: { expert: 0 }, ptsN: { expert: 2 } } }) === 2
  && T.woPoints({ byDiff: { expert: { won: 1 } }, wo: { pts: { expert: 6 }, ptsN: { expert: 5 } } }) === 6);

// Rush mistake cost, rules 3 (2026-10-22): never capped, +0.5 s a board from board 13.
const costs = (m) => Array.from({ length: 31 }, (_, i) => T.rushMissMs(m, i) / 1000).join(' ');
ok('Rush: Easy 0,1,2 then 3/4/5 by threes, then +0.5 s a board (board 30 = 14 s)',
  costs('easy') === '0 1 2 3 3 3 4 4 4 5 5 5 5.5 6 6.5 7 7.5 8 8.5 9 9.5 10 10.5 11 11.5 12 12.5 13 13.5 14 14.5');
ok('Rush: Hard 3/4/5/6 by threes, then +0.5 s a board (board 30 = 15 s)',
  costs('hard') === '3 3 3 4 4 4 5 5 5 6 6 6 6.5 7 7.5 8 8.5 9 9.5 10 10.5 11 11.5 12 12.5 13 13.5 14 14.5 15 15.5');
// The tuning data survives the recorder AND every later record (each one re-cleans the whole list).
store.clear();
const xr = { bt: [5000, 7000, 3000], ba: [11, 16, 4], bc: [12000, 15000], mx: [0, 1000], mb: [1, 2], pk: 15500, gn: 15500, pn: 1000, res: 1, rv: 3 };
G.recordWayOutRush('easy', { ...xr, arrows: 31, boards: 2, ms: 15000, mistakes: 2, seed: 5 });
G.recordWayOutRush('easy', { arrows: 3, boards: 0, ms: 9000, mistakes: 0, seed: 6 });
const kept = G.loadStats().games.wayout.wo.rush.runs.easy[0];
ok('Rush: a run keeps its tuning data through the next record',
  Object.keys(xr).every((k) => JSON.stringify(kept[k]) === JSON.stringify(xr[k])));
ok('Rush: tuning data in Firebase object form reads back; junk is left out',
  JSON.stringify(T.woRushExtras({ bt: { 1: 7, 0: 5 }, mx: [1, 'x', -2], pk: 'no', rv: 3 })) === '{"bt":[5,7],"mx":[1],"rv":3}');
ok('Rush: time played reads m:ss / h:mm:ss', T.woRushTime(602000) === '10:02' && T.woRushTime(3725000) === '1:02:05' && T.woRushTime(0) === '0:00');

// --- REPLAY (2026-10-26): win back the points a level missed; only the difference, never twice ---
store.clear();
G.recordWayOut('expert', { timeMs: 90000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 2, hints: 0, timed: true, level: 201, gen: 6 }); // 2 of 6 (two hearts: a replay can win them back)
G.recordWayOut('expert', { timeMs: 80000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, timed: true, level: 202, gen: 6 }); // 6 of 6
G.recordWayOut('medium', { timeMs: 30000, penaltyMs: 0, arrows: 40, rounds: 14, mistakes: 1, hints: 0, timed: true, level: 61, gen: 6 }); // 1 of 2
G.recordWayOut('easy', { timeMs: 20000, penaltyMs: 0, arrows: 12, rounds: 4, mistakes: 2, hints: 0, timed: true, level: 3, gen: 6 }); // 1 of 1
G.recordWayOut('hard', { timeMs: 50000, penaltyMs: 0, arrows: 60, rounds: 20, mistakes: 0, hints: 0, timed: false, level: 101, gen: 6 }); // untimed: full
g = G.loadStats().games.wayout;
const before = JSON.parse(JSON.stringify(g));
ok('replay: only levels that missed points are listed (Easy never; clean and untimed levels never)',
  JSON.stringify(T.woMissed(g, 'expert').map((x) => [x.n, x.best, x.gain])) === '[[201,2,4]]'
  && T.woMissed(g, 'medium').length === 1 && T.woMissed(g, 'easy').length === 0 && T.woMissed(g, 'hard').length === 0);
const old = JSON.parse(JSON.stringify(g)); old.wo.log.expert[0].d = T.WO_SLIP_SINCE - 1;
ok('replay: a level finished before slips cost points (full points then) is never listed', T.woMissed(old, 'expert').length === 0);
ok('replay: a first-ladder Expert board shows today\'s number', T.woShownLevel('expert', 155, 5) === 205 && T.woShownLevel('hard', 120, 5) === 120 && T.woShownLevel('expert', 210, 6) === 210);
const p0 = T.woPoints(g);
const r1 = G.recordWayOutReplay('expert', { timeMs: 70000, penaltyMs: 30000, arrows: 90, rounds: 25, mistakes: 1, hints: 0, level: 201, gen: 6 });
g = G.loadStats().games.wayout;
ok('replay: one slip on an Expert level that earned 2 adds 2 (now 4 of 6)', r1 === 2 && T.woPoints(g) === p0 + 2 && T.woMissed(g, 'expert')[0].gain === 2);
const r2 = G.recordWayOutReplay('expert', { timeMs: 70000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 3, hints: 2, level: 201, gen: 6 });
g = G.loadStats().games.wayout;
ok('replay: a worse replay adds nothing and takes nothing', r2 === 0 && T.woPoints(g) === p0 + 2);
const r3 = G.recordWayOutReplay('expert', { timeMs: 60000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, level: 201, gen: 6 });
g = G.loadStats().games.wayout;
ok('replay: a clean replay tops it up to full points and the level leaves the list', r3 === 2 && T.woPoints(g) === p0 + 4 && T.woMissed(g, 'expert').length === 0);
const r4 = G.recordWayOutReplay('expert', { timeMs: 60000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, level: 201, gen: 6 });
const r5 = G.recordWayOutReplay('expert', { timeMs: 60000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, level: 202, gen: 6 });
g = G.loadStats().games.wayout;
ok('replay: a level already at full points can never earn more', r4 === 0 && r5 === 0 && T.woPoints(g) === p0 + 4);
ok('replay: every replay is kept raw, with what it added', g.wo.replay.expert.length === 5 && g.wo.replay.expert.map((x) => x.u).join() === '2,0,2,0,0'
  && g.wo.replay.expert.every((x) => x.l > 0 && x.g === 6 && x.d > 0 && x.t > 0));
ok('replay: not a level cleared (totals, byDiff, timed, ptsN and the log untouched)',
  ['total', 'byDiff'].every((k) => JSON.stringify(g[k]) === JSON.stringify(before[k]))
  && ['timed', 'ptsN', 'log', 'mistakes', 'hints'].every((k) => JSON.stringify(g.wo[k]) === JSON.stringify(before.wo[k])));
ok('replay: a finished level still within its full points (woPoints clamp holds)', T.woPoints(g, 'expert') === 12);
ok('replay: refused without a board, a time or a known difficulty',
  G.recordWayOutReplay('expert', { timeMs: 1000, arrows: 9, rounds: 2 }) === null && G.recordWayOutReplay('nope', { timeMs: 1, arrows: 1, rounds: 1, level: 1, gen: 6 }) === null);
G.recordWayOutReplay('medium', { timeMs: 20000, penaltyMs: 0, arrows: 40, rounds: 14, mistakes: 0, hints: 0, level: 61, gen: 6 });
g = G.loadStats().games.wayout;
ok('replay: Medium 1 of 2 tops up by 1', T.woPoints(g, 'medium') === 2 && T.woMissed(g, 'medium').length === 0);
// HINTS CARRY OVER (Matt, 2026-10-29): a level first cleared with a hint keeps the hint's cost.
{
  store.clear();
  G.recordWayOut('expert', { timeMs: 90000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 1, hints: 1, timed: true, level: 205, gen: 6 }); // 2 of 6
  let h = G.loadStats().games.wayout;
  const m = T.woMissed(h, 'expert')[0];
  ok('hints carry over: the clearing try\'s hint is in `p`; a perfect replay can reach only 4 (one slip), not 6',
    h.wo.log.expert[0].p === 1 && m && m.full === 4 && m.gain === 2);
  const up = G.recordWayOutReplay('expert', { timeMs: 60000, penaltyMs: 0, arrows: 90, rounds: 25, mistakes: 0, hints: 0, level: 205, gen: 6 });
  h = G.loadStats().games.wayout;
  ok('...a clean replay adds 2 (to 4) and the level leaves the list', up === 2 && T.woPoints(h, 'expert') === 4 && T.woMissed(h, 'expert').length === 0);
}
ok('replay: lists in Firebase object form read back', T.woReplayList({ 1: g.wo.replay.expert[1], 0: g.wo.replay.expert[0] }).map((x) => x.u).join() === '2,0');

// --- MORE LEVELS (2026-10-26): Easy 51 is an Easy level, worth Easy's points ---
ok('more levels: points follow the difficulty, not the number', T.woLevelPoints(51, 'easy') === 1 && T.woLevelPoints(150, 'medium') === 2
  && T.woLevelPoints(400, 'hard') === 4 && T.woLevelPoints(51) === 2 && T.woLevelPoints(51, 'nope') === 2);

console.log(`\nArrow Maze timer tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
