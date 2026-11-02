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
//   6. EVERY record call in the repo goes through withMode / carries a modeTag (tools/scan-game-modes.mjs,
//      a full scan of every file since 2026-11-02; there is no list of files to forget a game on);
//   7. a result recorded OUTSIDE withMode still counts, filed under byMode['?'] and logged `m: '?'`;
//   8. withMode's `detail` adds counters into games.<id>.dt, merged by sum per person, kept by the
//      server-built board (functions/boards.js).
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
const LL = await import('../js/live-leave.js');
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

// 3. no mode (2026-11-02): the result still counts exactly as before, filed under '?', logged '?'
const errs = []; const realErr = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
GS.recordResult('darts', 'easy', true);
console.error = realErr;
g = GS.loadStoredStats().games.darts;
ok('a result outside withMode still counts in byDiff/total', g.byDiff.easy.won === 1 && g.total.won === 2 && g.total.played === 4);
ok("...and is filed under byMode['?'] at its counted bucket", g.byMode['?'] && g.byMode['?'].easy.won === 1 && g.byMode['?'].easy.played === 1, JSON.stringify(g.byMode['?']));
ok('...and says so loudly', errs.some((e) => /OUTSIDE withMode/.test(e)));
const bareLog = readQueue().filter((x) => x.g === 'darts').pop();
ok("...and its play log entry says m: '?'", bareLog && bareLog.m === '?', bareLog && bareLog.m);
// a recorder that is not a result (a hint, the head-to-head side count) gets no '?'
GS.recordHeadToHead('darts', { deviceId: 'dev-x', name: 'x' }, true);
ok("a head-to-head side count adds no '?'", GS.loadStoredStats().games.darts.byMode['?'].easy.played === 1);
// a recorder that bumps by hand (Sudoku) is netted too
GS.recordSudoku('easy', { timeMs: 1000, mistakes: 0, hints: 0 });
ok("Sudoku outside withMode lands under '?'", GS.loadStoredStats().games.sudoku.byMode['?'].easy.won === 1);
GS.withMode({ sd: 1 }, 'easy', () => GS.recordSudoku('easy', { timeMs: 900 }));
ok('Sudoku inside withMode lands under its mode (it bumps by hand)', GS.loadStoredStats().games.sudoku.byMode['sd=1'].easy.won === 1);
// an empty mode object is a declared "no options" ('-'), never '?'
GS.withMode({}, 'easy', () => GS.recordResult('uno', 'easy', true));
ok("withMode({}) is key '-', not '?'", GS.loadStoredStats().games.uno.byMode['-'].easy.won === 1 && !GS.loadStoredStats().games.uno.byMode['?']);

// 3a. a queued result (an earlier failed write) drained INSIDE another recorder's withMode keeps its own
//     mode, and never takes the live result's (it did before 2026-11-02: the drain ran first)
store.set('gamehub.pendingResults.v1', JSON.stringify([
  { at: 1, game: 'escoba', diff: 'hard', won: true, extras: { escobas: 1 }, m: { key: 'n=2|to=21', diff: 'hard' } },
  { at: 2, game: 'escoba', diff: 'hard', won: false, extras: { escobas: 0 } },
]));
console.error = () => {};
GS.withMode({ n: 4, to: 31 }, 'easy', () => GS.recordEscoba('easy', true, { escobas: 2 }));
console.error = realErr;
const es = GS.loadStoredStats().games.escoba.byMode;
ok('a drained queued result keeps its queued mode', es['n=2|to=21'] && es['n=2|to=21'].hard.won === 1, JSON.stringify(es));
ok("a drained queued result with no mode goes to '?'", es['?'] && es['?'].hard.lost === 1);
ok('the live result keeps ITS mode', es['n=4|to=31'] && es['n=4|to=31'].easy.won === 1);

// 3c. THUNKS (2026-11-02): mode and detail are read INSIDE withMode / modeTag; one that throws never
//     costs the result. Each case: the result lands exactly once.
{
  const boom = () => { throw new Error('boom'); };
  const tot = () => GS.loadStoredStats().games.filler.total.played;
  console.error = () => {};
  let before = tot();
  GS.withMode(boom, 'pro', () => GS.recordResult('filler', 'pro', true), { detail: () => ({ mine: 40 }) });
  let f = GS.loadStoredStats().games.filler;
  ok('a THROWING mode thunk: the result lands once, under \'?\', with its detail', tot() === before + 1 && f.byMode['?'].pro.won === 1 && f.dt.mine === 40);
  let lg = readQueue().filter((x) => x.g === 'filler').pop();
  ok('...and the play log says the mode failed', lg && lg.m === '?@pro' && JSON.parse(lg.d)._err === 'mode', lg && (lg.m + ' ' + lg.d));
  before = tot();
  GS.withMode(() => ({ first: 'me' }), 'pro', () => GS.recordResult('filler', 'pro', false), { detail: boom });
  f = GS.loadStoredStats().games.filler;
  ok('a THROWING detail thunk: the result lands once, under its mode, with no detail', tot() === before + 1 && f.byMode['first=me'].pro.lost === 1 && f.dt._n === 1);
  lg = readQueue().filter((x) => x.g === 'filler').pop();
  ok('...and the play log says the detail failed', lg && JSON.parse(lg.d)._err === 'detail');
  before = tot();
  GS.withMode(() => ({ first: 'them' }), boom, () => GS.recordResult('filler', 'pro', true), boom);
  ok('a throwing chosen difficulty and a throwing score thunk: still once', tot() === before + 1);
  // deferred: quit loss, live leave (armed), live claim/win; the arm itself never throws
  before = tot();
  let tag; let threw = false;
  try { tag = GS.modeTag(boom, 'pro', { detail: boom }); } catch { threw = true; }
  ok('modeTag never throws on a throwing mode or detail', !threw && tag && tag.m === '?');
  GS.armQuitLoss('filler', 'recordResult', ['filler', 'pro', false], tag);
  GS.takeQuitLoss('filler');
  ok('quit loss with a throwing mode: recorded once, under \'?\'', tot() === before + 1 && GS.loadStoredStats().games.filler.byMode['?'].pro.lost === 1);
  before = tot();
  LL.armLeave('filler', 'filler:ROOM:9', 'recordResult', ['filler', 'mp', false], [], GS.modeTag(boom, 'mp'));
  LL.forfeitNow('filler');
  ok('armed live leave with a throwing mode: recorded once', tot() === before + 1 && GS.loadStoredStats().games.filler.byMode['?'].mp.lost === 1);
  before = tot();
  LL.recordLeaveWin('filler', 'filler:ROOM:10', 'recordResult', ['filler', 'mp', true], [], GS.modeTag(() => ({ first: 'me' }), 'mp', { detail: boom }));
  ok('live claim/leave win with a throwing detail: recorded once, under its mode', tot() === before + 1 && GS.loadStoredStats().games.filler.byMode['first=me'].mp.won === 1);
  before = tot();
  LL.onRoomEnded({ forfeit: { x: { seat: 'guest', n: 11 } } }, { statsId: 'filler', key: 'filler:ROOM:11', n: 11, mySeat: 'host', fn: 'recordResult', winArgs: ['filler', 'mp', true], opps: [], tag: GS.modeTag(boom, 'mp') });
  ok('onRoomEnded (the other left) with a throwing mode: recorded once', tot() === before + 1);
  console.error = realErr;
}

// 3b. per-match DETAIL
GS.withMode({ one: 0, first: 'me' }, 'easy', () => GS.recordResult('hoops4', 'easy', true), { detail: { shots: 12, made: 7, missed: 5, rack: 'tri10' } });
GS.withMode({ one: 0, first: 'them' }, 'easy', () => GS.recordResult('hoops4', 'easy', false), { detail: { shots: 9, made: 4, missed: 5, rack: 'tri10', bad: -3, nan: NaN, up: true } });
GS.withMode({ one: 0 }, 'easy', () => GS.recordResult('hoops4', 'easy', false), { detail: { rack: 'diamond' } });
let dt = GS.loadStoredStats().games.hoops4.dt;
ok('detail counters ADD', dt.shots === 21 && dt.made === 11 && dt.missed === 10, JSON.stringify(dt));
ok('detail facts count their value', dt.rack.tri10 === 2 && dt.rack.diamond === 1, JSON.stringify(dt.rack));
ok('negative and NaN detail are ignored; true counts 1', !('bad' in dt) && !('nan' in dt) && dt.up === 1);
ok('dt._n counts the results that carried detail', dt._n === 3);
ok('detail never changes the counts', GS.loadStoredStats().games.hoops4.total.played === 3);
const dLog = readQueue().filter((x) => x.g === 'hoops4').pop();
ok('the play log carries the detail (d)', dLog && typeof dLog.d === 'string' && JSON.parse(dLog.d).rack === 'diamond', dLog && dLog.d);
// detail through a deferred result
GS.armQuitLoss('hoops4', 'recordResult', ['hoops4', 'easy', false], GS.modeTag({ one: 1 }, 'easy', { detail: { shots: 2 } }));
GS.takeQuitLoss('hoops4');
dt = GS.loadStoredStats().games.hoops4.dt;
ok('a deferred result carries its detail', dt.shots === 23 && GS.loadStoredStats().games.hoops4.byMode['one=1'].easy.lost === 1);
// a key used as a counter is never overwritten by a fact (and the other way round)
GS.withMode({ one: 0 }, 'easy', () => GS.recordResult('hoops4', 'easy', true), { detail: { shots: 'lots', rack: 4 } });
dt = GS.loadStoredStats().games.hoops4.dt;
ok('a counter key is never turned into a fact, nor a fact into a counter', dt.shots === 23 && dt.rack.tri10 === 2);

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
// detail merges by SUM across a person's devices
const recB = { profile: { name: 'test1', emoji: '🧪', playerId: 'DREG5' }, updatedAt: 2, stats: { version: 1, games: { hoops4: { total: { played: 1, won: 1, lost: 0 }, byDiff: { easy: { played: 1, won: 1, lost: 0 } }, dt: { _n: 1, shots: 5, made: 5, rack: { tri10: 1, line3: 1 } } } } } };
const pd = aggregatePlayers({ 'dev-a': recA, 'dev-b': recB }).find((x) => x.playerId === 'DREG5');
const myDt = recA.stats.games.hoops4.dt;
ok('agg sums dt counters across devices', pd.games.hoops4.dt.shots === myDt.shots + 5 && pd.games.hoops4.dt._n === myDt._n + 1, JSON.stringify(pd.games.hoops4.dt));
ok('agg sums dt facts across devices', pd.games.hoops4.dt.rack.tri10 === myDt.rack.tri10 + 1 && pd.games.hoops4.dt.rack.line3 === 1);
ok('a person with no detail has no dt', !pOld.games.darts.dt);
// ...and the server-built board hands the phone the very same dt
{
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [new URL('./sync-functions-shared.mjs', import.meta.url).pathname], { stdio: 'ignore' });
  const { buildBoardParts, packBoard } = await import('../functions/boards.js');
  const { unpackBoard, boardList } = await import('../js/stats-net.js');
  const back = await unpackBoard(packBoard(buildBoardParts({ 'dev-a': recA, 'dev-b': recB }, {})));
  const grp = boardList(back).list.find((x) => x.playerId === 'DREG5');
  ok('the server-built board keeps dt', grp && JSON.stringify(grp.games.hoops4.dt) === JSON.stringify(pd.games.hoops4.dt), grp && JSON.stringify(grp.games.hoops4.dt));
}

// 8. static: the FULL scan (tools/scan-game-modes.mjs). Every file, every recorder call; no list of files.
const SCAN = await import('./scan-game-modes.mjs');
const scan = SCAN.scanRepo();
ok(`full scan: every one of ${scan.calls} record calls in ${scan.files} files is in withMode / carries a modeTag`, scan.bad.length === 0,
  '\n' + scan.bad.map((x) => `    ${x.file}:${x.line}  ${x.what}`).join('\n'));
ok('the scan finds a sensible number of record calls (it is not silently reading nothing)', scan.calls >= 80, `found ${scan.calls}`);
// the scanner itself: a bare call fails, a wrapped one passes, a deferred one needs its tag
const t1 = SCAN.scanSource(`import { recordResult } from 'x';\nfunction f(){ recordResult('filler', 'pro', true); }`);
ok('scanner: a bare recordResult fails', t1.bad.length === 1);
const t2 = SCAN.scanSource(`function f(){ try { withMode(() => modeOf(s), d, () => recordResult('filler', d, true), { detail }); } catch {} }`);
ok('scanner: a wrapped recordResult passes', t2.bad.length === 0 && t2.calls.length === 1);
const t3 = SCAN.scanSource(`LL.armLeave(A, k, 'recordResult', ['x', 'mp', false], [o]);\nLL.armLeave(A, k, 'recordResult', ['x', 'mp', false], [o], modeTag(m, 'mp'));`);
ok('scanner: armLeave needs a modeTag', t3.bad.length === 1);
const t4 = SCAN.scanSource(`const o = { fn: 'recordResult', winArgs: ['x', 'mp', true], opps: [] };`);
ok('scanner: a winArgs object needs a tag', t4.bad.length === 1);
const t5 = SCAN.scanSource('const s = `${a}`; // recordResult(x)\n/* recordSnake(1) */ const q = "recordResult(";');
ok('scanner: comments and strings are not calls', t5.calls.length === 0 && t5.bad.length === 0);
const t6 = SCAN.scanSource('el.innerHTML = `<b>${t(`x${y}`)}</b>`; recordSnake(1, d, w);');
ok('scanner: a nested template does not hide the code after it', t6.bad.length === 1);
// mode and detail must be thunks (or literals / identifiers): an argument computed at the call site that
// throws would skip the record call itself
const t7 = SCAN.scanSource(`withMode(modeOf(m), d, () => recordResult('x', d, true));`);
ok('scanner: a computed mode argument fails', t7.bad.length === 1);
const t8 = SCAN.scanSource(`withMode(() => modeOf(m), d, () => recordResult('x', d, true), { detail: hoopsDetail(m, me) });`);
ok('scanner: a computed detail fails', t8.bad.length === 1);
const t9 = SCAN.scanSource(`withMode({ to: 21, lang }, d, () => recordResult('x', d, true), { detail: () => det(m), hi: score });\nwithMode(mode, 'mp', () => recordResult('x', 'mp', w), score);`);
ok('scanner: thunks, literal objects and identifiers pass', t9.bad.length === 0, JSON.stringify(t9.bad));
const t10 = SCAN.scanSource(`LL.armLeave(A, k, 'recordResult', ['x', 'mp', false], [o], modeTag(liveMode(mp), 'mp'));`);
ok('scanner: a computed modeTag mode fails', t10.bad.length === 1);
// the runtime net and the scanner agree on what is not a result
const gsSrc = readFileSync(new URL('../js/game-stats.js', import.meta.url), 'utf8');
const nar = gsSrc.slice(gsSrc.indexOf('const NOT_A_RESULT'), gsSrc.indexOf(']);', gsSrc.indexOf('const NOT_A_RESULT')));
for (const name of Object.keys(SCAN.AUX)) ok(`${name} is in both AUX (scan) and NOT_A_RESULT (run time)`, nar.includes(`'${name}'`));

console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} (${pass} passed, ${fail} failed)`);
if (fail) process.exit(1);
