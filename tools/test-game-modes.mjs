// tools/test-game-modes.mjs - every game's MODE is recorded with its result (2026-10-30).
//
// Matt: "they MUST be recorded for posterity". Until that day Darts never said Cricket or 301, Pool
// never said 8-ball or 9-ball, a shorter match was folded one tier down and online matches said only
// 'mp'. Proven here, headless, with a fake storage:
//   1. withMode() bumps games.<id>.byMode[<key>][<chosen diff>] in the SAME write as byDiff;
//   2. it is additive: byDiff/total exactly as without it, counters only grow;
//   3. a challenge result also notes its match's mode (mpModes) beside mpIds;
//   4. the play log entry carries the key (`m`);
//   5. players-agg sums byMode per person; old records without it aggregate as before;
//   6. every game listed in MODE_GAMES routes each record call through withMode (static scan).
//   node tools/test-game-modes.mjs
// Test profiles only (test1 / DREG5), never Matt's (root CLAUDE.md).
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
store.set('gamehub.profile', JSON.stringify({ name: 'test1', emoji: '🧪', playerId: 'DREG5' }));
store.set('gamehub.deviceId', 'dev-modes');

const GS = await import('../js/game-stats.js');
const { aggregatePlayers } = await import('../js/players-agg.js');
const { readQueue } = await import('../js/play-log-queue.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// 1. the key
ok('modeKey sorts and joins', GS.modeKey({ legs: 3, kind: '301' }) === 'kind=301|legs=3');
ok('modeKey drops empties and objects', GS.modeKey({ a: '', b: null, c: {}, d: 'x' }) === 'd=x');
ok('modeKey strips Firebase-illegal characters', GS.modeKey({ 'k.e/y': 'v$a#l[u]e.' }) === 'key=value');
ok('modeKey of nothing is empty', GS.modeKey(null) === '' && GS.modeKey({}) === '');

// 2. a vs-computer result with a mode
GS.withMode({ kind: '201', in: 'any' }, 'hard', () => GS.recordResult('darts', 'medium', true));
let g = GS.loadStoredStats().games.darts;
ok('byDiff keeps the counted bucket', g.byDiff.medium && g.byDiff.medium.won === 1 && g.total.won === 1);
ok('byMode keeps the CHOSEN difficulty', g.byMode['in=any|kind=201'].hard.won === 1 && g.byMode['in=any|kind=201'].hard.played === 1);
GS.withMode({ kind: '201', in: 'any' }, 'hard', () => GS.recordResult('darts', 'medium', false));
GS.withMode({ kind: '201', in: 'any' }, 'hard', () => GS.recordResult('darts', 'medium', null));
g = GS.loadStoredStats().games.darts;
const b = g.byMode['in=any|kind=201'].hard;
ok('counters add: played 3, won 1, lost 1', b.played === 3 && b.won === 1 && b.lost === 1, JSON.stringify(b));
ok('total unchanged by the mode', g.total.played === 3 && g.total.won === 1 && g.total.lost === 1);

// 3. no mode = exactly as before
GS.recordResult('darts', 'easy', true);
g = GS.loadStoredStats().games.darts;
ok('a result outside withMode adds no mode', Object.keys(g.byMode).length === 1 && g.byDiff.easy.won === 1);

// 4. challenge: mpModes beside mpIds
GS.withChallengeMatch('darts', 'match_0001', () => GS.withMode({ kind: 'cricket' }, 'mp', () => GS.recordResult('darts', 'mp', true)));
g = GS.loadStoredStats().games.darts;
ok('challenge notes its match id', g.mpIds.match_0001 === 'w');
ok('challenge notes its match mode', g.mpModes.match_0001 === 'kind=cricket');
ok('challenge mode counted under mp', g.byMode['kind=cricket'].mp.won === 1);

// 5. the play log
const last = readQueue().filter((x) => x.g === 'darts').pop();
ok('play log carries the mode', last && last.m === 'kind=cricket@mp', last && last.m);

// 6. a throwing mode never stops the result
const before = GS.loadStoredStats().games.darts.total.played;
const bad = {}; Object.defineProperty(bad, 'x', { enumerable: true, get() { throw new Error('boom'); } });
GS.withMode(bad, 'hard', () => GS.recordResult('darts', 'hard', true));
ok('a broken mode still counts the result', GS.loadStoredStats().games.darts.total.played === before + 1);

// 6b. per-mode bests
GS.withMode({ m: 'endless' }, 'easy', () => GS.recordResult('snake', 'easy', true), { hi: 40 });
GS.withMode({ m: 'endless' }, 'easy', () => GS.recordResult('snake', 'easy', true), { hi: 25 });
GS.withMode({ m: 'endless' }, 'easy', () => GS.recordResult('snake', 'easy', true), { lo: 900 });
GS.withMode({ m: 'endless' }, 'easy', () => GS.recordResult('snake', 'easy', true), { lo: 1200 });
const sb = GS.loadStoredStats().games.snake.byMode['m=endless'].easy;
ok('hi best only improves', sb.hi === 40, JSON.stringify(sb));
ok('lo best only improves', sb.lo === 900, JSON.stringify(sb));

// 6c. a deferred quit loss carries its mode
GS.armQuitLoss('darts', 'recordResult', ['darts', 'easy', false], GS.modeTag({ kind: '101' }, 'medium'));
GS.takeQuitLoss('darts');
ok('quit loss recorded under its mode', GS.loadStoredStats().games.darts.byMode['kind=101'].medium.lost === 1);
// 6d. a live-room leave carries its mode
GS.recordLiveResult('darts:ROOM:1', 'darts', 'recordResult', ['darts', 'mp', true], [], true, GS.modeTag({ kind: 'cricket' }, 'mp'));
ok('live leave recorded under its mode', GS.loadStoredStats().games.darts.byMode['kind=cricket'].mp.won === 2);
const LL = await import('../js/live-leave.js');
LL.armLeave('darts', 'darts:ROOM:2', 'recordResult', ['darts', 'mp', false], [], GS.modeTag({ kind: 'cricket' }, 'mp'));
LL.forfeitNow('darts');
ok('armed live leave recorded under its mode', GS.loadStoredStats().games.darts.byMode['kind=cricket'].mp.lost === 1);

// 7. players-agg
const recA = { profile: { name: 'test1', emoji: '🧪', playerId: 'DREG5' }, updatedAt: 1, stats: GS.loadStoredStats() };
const recOld = { profile: { name: 'test1', emoji: '🧪', playerId: 'DREG5' }, updatedAt: 1, stats: { version: 1, games: { darts: { total: { played: 2, won: 1, lost: 1 }, byDiff: { hard: { played: 2, won: 1, lost: 1 } } } } } };
const p = aggregatePlayers({ 'dev-a': recA, 'dev-b': recOld }).find((x) => x.playerId === 'DREG5');
ok('agg sums byMode', p.games.darts.byMode['in=any|kind=201'].hard.played === 3);
ok('agg keeps old records in byDiff', p.games.darts.byDiff.hard.played >= 2);
const pOld = aggregatePlayers({ 'dev-b': recOld }).find((x) => x.playerId === 'DREG5');
ok('a person with no modes has no byMode', !pOld.games.darts.byMode);

// 8. static: every game that has modes wraps every record call (withMode) and tags every deferred one
//    (modeTag: armQuitLoss, LL.armLeave, LL.recordLeaveWin, LL.onRoomEnded's `tag`), counted together.
export const MODE_GAMES = JSON.parse(readFileSync(new URL('./game-modes.json', import.meta.url), 'utf8'));
for (const [file, n] of Object.entries(MODE_GAMES)) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const calls = (src.match(/withMode\(|modeTag\(/g) || []).length;
  ok(`${file}: ${n} record call(s) wrapped in withMode / tagged with modeTag`, calls >= n, `found ${calls}`);
}

console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${pass} passed, ${fail} failed)`);
if (fail) process.exit(1);
