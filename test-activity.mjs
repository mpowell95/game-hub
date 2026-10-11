// test-activity.mjs - WHEN each game is played (js/game-stats.js `gamehub.activity.v1`, 2026-10-11).
//
// The activity log is a REPORT for read-activity.mjs. What must hold: every play is stamped once,
// a refused play is not, it is additive only, it never touches the stats store's shape, two players
// on one phone stay apart, and the classic port (Monopoly Deal, Parchís) writes the same shape.
//
// Run: node test-activity.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
const G = await import('./js/game-stats.js');
const act = () => JSON.parse(store.get('gamehub.activity.v1') || '{}');

// --- the week key ---
const sun = new Date(2026, 9, 11, 23, 0).getTime();   // Sunday 11 Oct 2026
const mon = new Date(2026, 9, 12, 0, 30).getTime();   // Monday 12 Oct
ok('a Sunday belongs to the week that started the Monday before', G.activityWeek(sun) === '2026-10-05');
ok('a Monday starts its own week', G.activityWeek(mon) === '2026-10-12');

// --- the pure stamp ---
let s = G.stampActivity(null, 'snake', sun);
s = G.stampActivity(s, 'snake', mon);
s = G.stampActivity(s, 'snake', sun - 1000);
ok('counts each play into its week', s.snake.w['2026-10-05'] === 2 && s.snake.w['2026-10-12'] === 1);
ok('first only ever moves earlier', s.snake.first === sun - 1000);
ok('last only ever moves later', s.snake.last === mon);
ok('junk input becomes a valid slice', G.stampActivity('x', 'uno', sun).uno.w['2026-10-05'] === 1);

// --- through a real recorder ---
store.clear();
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Ann', playerId: 'ABCDE' }));
G.recordSnake(10, 'easy', 'on');
G.recordResult('uno', 'easy', true);
G.recordResult('uno', 'easy', false);
let a = act()['gamehub.stats'];
ok('a real Snake result is stamped', a && a.snake && Object.values(a.snake.w)[0] === 1);
ok('two Uno results are stamped twice', a && Object.values(a.uno.w)[0] === 2);
ok('activityReport returns the active player slice', G.activityReport().uno === undefined ? false : true);
const stats = JSON.parse(store.get('gamehub.stats'));
ok('the stats store shape is untouched (no activity inside it)', !('activity' in stats) && !('w' in stats.games.uno));
ok('an unknown game is not stamped', (G.recordResult('nope', 'easy', true), !act()['gamehub.stats'].nope));

// --- refused plays are not stamped ---
const before = Object.values(act()['gamehub.stats'].tictactoe?.w || {}).reduce((x, y) => x + y, 0);
for (let i = 0; i < 40; i++) G.recordTicTacToe('classic', 'easy', true);
const after = Object.values(act()['gamehub.stats'].tictactoe.w).reduce((x, y) => x + y, 0);
ok('only the plays the rate gate let through are stamped', after - before === 30);

// --- a second player on the same phone stays apart ---
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Bo', playerId: 'FGHJK' }));
G.recordResult('uno', 'easy', true);
const all = act();
ok('second player gets their own slice', all['gamehub.stats.p.FGHJK'] && Object.values(all['gamehub.stats.p.FGHJK'].uno.w)[0] === 1);
ok('first player slice unchanged', Object.values(all['gamehub.stats'].uno.w)[0] === 2);
ok('report follows the active player', Object.values(G.activityReport().uno.w)[0] === 1 && !G.activityReport().snake);

// --- nothing yet -> null, so the mirror omits the node ---
store.clear();
ok('no activity reports null', G.activityReport() === null);

// --- the classic port writes the same shape ---
store.clear();
const ctx = { localStorage: globalThis.localStorage, console, Date, JSON };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync('./js/game-stats-global.js', 'utf8'), ctx);
ctx.__ghStats.record('parchis', 'easy', true);
a = act()['gamehub.stats'];
ok('the classic port stamps Parchis', a && a.parchis && Object.values(a.parchis.w)[0] === 1 && a.parchis.first > 0);
ok('the port uses the same week key', Object.keys(a.parchis.w)[0] === G.activityWeek(Date.now()));

// --- the mirror sends it, and never as null ---
const net = readFileSync('./js/stats-net.js', 'utf8');
ok('stats-net mirrors activity only when there is some', /if \(activity\) rec\.activity = activity;/.test(net));

console.log(`\nActivity tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
