// test-lb-points.mjs - the wins boards' POINTS (js/lb-points.js, 2026-11-02) and the "+X pts" maths
// (js/points-toast.js winPoints). Pure; no browser. With backups/lb-z.json present (read-only copy of the
// live board, `node tools/read-lb-snapshot.mjs`), also prints each board's top 3 on real data.
//   node tools/test-lb-points.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { gamePoints, pointsForWin, pointsKey, POINT_GAMES, CAP, setNewPrices, newPricesOn } from '../js/lb-points.js';
import { LB_RULES } from '../js/lb-rules.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const rec = (byDiff, more = {}) => {
  const total = { played: 0, won: 0, lost: 0 };
  for (const b of Object.values(byDiff)) { total.played += b.played || b.won || 0; total.won += b.won || 0; }
  return { total, byDiff, ...more };
};
const W = (n) => ({ played: n, won: n, lost: 0 });

// Every wins board has a table.
for (const id of Object.keys(LB_RULES).filter((k) => ['wins', 'cuppong'].includes(LB_RULES[k].by))) {
  ok(`${id}: has points (table or 1 a win)`, pointsKey(id).on >= 1);
}
ok('Connect Four 1/6/8/12, online 5', gamePoints(rec({ easy: W(2), medium: W(1), hard: W(1), expert: W(1), mp: W(2) }), 'connect4').pts === 2 + 6 + 8 + 12 + 10);
ok('a level tab counts that level only', gamePoints(rec({ easy: W(2), hard: W(1) }), 'connect4', 3).pts === 8);
ok('Tic Tac Toe Classic Easy + Medium: 1 a win, max 20 together', gamePoints(rec({ beginner: W(193), intermediate: W(30) }), 'tictactoe').pts === CAP);
ok('...Hard is outside the cap', gamePoints(rec({ beginner: W(193), pro: W(1) }), 'tictactoe').pts === CAP + 5);
ok('Ultimate wins (saved mode) at Ultimate values, uncapped',
  gamePoints(rec({ intermediate: W(2) }, { byMode: { 'first=you|v=ultimate|went=me': { intermediate: W(2) } }, tt: { ultimate: W(2), classic: W(0) } }), 'tictactoe').pts === 6);
ok('Ultimate wins with no saved mode go to Medium first', gamePoints(rec({ beginner: W(5), intermediate: W(5) }, { tt: { ultimate: W(3), classic: W(7) } }), 'tictactoe').pts === 3 * 3 + 7);
ok('Flick 3 goals: Hard 9', gamePoints(rec({ hard: W(1) }, { byMode: { 'goals=3|off=x': { hard: W(1) } } }), 'flicksoccer').pts === 9);
ok('Dots Large x2', gamePoints(rec({ pro: W(1) }, { byMode: { 'size=large': { pro: W(1) } } }), 'dotsboxes').pts === 10);
// Each board its own points (Matt, 2026-11-09): Small 1/3/5, Medium 1/4/8, Large 2/6/10; no saved board = Small.
{ const dbm = (size) => ({ [`first=you|size=${size}|undo=0|went=me`]: { beginner: W(1), intermediate: W(1), pro: W(1) } });
  const r3 = (size) => gamePoints(rec({ beginner: W(1), intermediate: W(1), pro: W(1) }, size ? { byMode: dbm(size) } : {}), 'dotsboxes').pts;
  ok('Dots Small 1/3/5', r3('small') === 9);
  ok('Dots Medium 1/4/8', r3('medium') === 13);
  ok('Dots Large 2/6/10', r3('large') === 18);
  ok('Dots win with no saved board = Small (never guessed upward)', r3(null) === 9);
  ok('Dots pointsForWin Medium Hard = 8', pointsForWin('dotsboxes', 'pro', { size: 'medium', first: 'you' }) === 8);
  ok('Dots online stays 3 on every board', pointsForWin('dotsboxes', 'mp', { size: 'medium' }) === 3); }
ok('Cup Pong Hard 0 reracks x2', gamePoints(rec({ hard: W(1) }, { byMode: { 'gent=1|rr=0': { hard: W(1) } } }), 'cuppong').pts === 6);
// Session 6 (docs/HANDOFF-LB-POINTS-INFO.md): no reracks doubles EVERY level, still inside the 20-point limit.
ok('Cup Pong Easy/Medium 0 reracks x2', gamePoints(rec({ easy: W(1), medium: W(1) }, { byMode: { 'gent=1|rr=0': { easy: W(1), medium: W(1) } } }), 'cuppong').pts === 4);
ok('...and still capped at 20 together', gamePoints(rec({ easy: W(30) }, { byMode: { 'gent=1|rr=0': { easy: W(30) } } }), 'cuppong').pts === CAP);
ok('Cup Pong 2 reracks: no bonus', gamePoints(rec({ hard: W(1) }, { byMode: { 'gent=1|rr=2': { hard: W(1) } } }), 'cuppong').pts === 3);
ok('Darts Cricket in order x2 (2/4/6)', gamePoints(rec({ easy: W(1), medium: W(1), hard: W(1) }, { byMode: { 'kind=cricket-order|first=me': { easy: W(1), medium: W(1), hard: W(1) } } }), 'darts').pts === 12);
ok('...no-points Cricket in order too', pointsForWin('darts', 'hard', { kind: 'cricket-order-np', first: 'me' }) === 6);
ok('...plain Cricket and 301 unchanged', pointsForWin('darts', 'hard', { kind: 'cricket' }) === 3 && pointsForWin('darts', 'hard', { kind: '301' }) === 3);
// Dots and Boxes: Medium on the small board with the computer going first pays 1, under the 20-point limit (Matt, 2026-11-16).
{ const k = 'first=opponent|size=small|undo=0|went=them';
  ok('Dots small Medium, computer first: 21 wins = 20 points', gamePoints(rec({ intermediate: W(21) }, { byMode: { [k]: { intermediate: W(21) } } }), 'dotsboxes').pts === 20);
  ok('Dots small Medium, computer first: 5 wins = 5, and Hard beside it is untouched', gamePoints(rec({ intermediate: W(5), pro: W(2) }, { byMode: { [k]: { intermediate: W(5), pro: W(2) } } }), 'dotsboxes').pts === 15);
  ok('Dots small Medium going first still pays 3', gamePoints(rec({ intermediate: W(2) }, { byMode: { 'first=you|size=small|undo=0|went=me': { intermediate: W(2) } } }), 'dotsboxes').pts === 6);
  ok('Dots small Medium, computer first, at the Medium level only', gamePoints(rec({ intermediate: W(21) }, { byMode: { [k]: { intermediate: W(21) } } }), 'dotsboxes', 2).pts === 20);
  ok('Dots pointsForWin small Medium, computer first = 1', pointsForWin('dotsboxes', 'intermediate', { size: 'small', first: 'opponent', went: 'them' }) === 1); }
ok('a multiplier never counts more wins than the level holds', gamePoints(rec({ pro: W(1) }, { byMode: { 'size=large': { pro: W(5) } } }), 'dotsboxes').pts === 10);
ok('online wins never take the mode bonus', gamePoints(rec({ mp: W(1) }, { byMode: { 'size=large': { mp: W(1) } } }), 'dotsboxes').pts === 3);
ok('legacy wins (no level) = 1', gamePoints(rec({ legacy: W(4) }), 'business').pts === 4);
ok('ties: wins reported', gamePoints(rec({ easy: W(3), mp: W(1) }), 'darts').wins === 4);
ok('pointsForWin Hard Connect Four = 8', pointsForWin('connect4', 'hard', null) === 8);
ok('pointsForWin online Flick = 3', pointsForWin('flicksoccer', 'mp', null) === 3);
ok('pointsForWin Ultimate Hard = 10', pointsForWin('tictactoe', 'pro', { v: 'ultimate' }) === 10);
ok('pointsForWin Pool 3 racks Hard = 10', pointsForWin('eightball', 'hard', { racks: 3 }) === 10);

// Session 7 (Matt, 2026-11-04, docs/mockups/final/sheet-hoops4 and sheet-chinchon): two read-time changes.
// 1. Hoops "Until you score" on Hard = 2 (recorded one level down at Medium, where a win is 3). Byte for byte what the
//    game saves: byDiff at statsDiff (one down), byMode at the chosen level, key from modeKey ('first=me|one=0').
ok('Hoops Until you score, Hard: 2', gamePoints(rec({ medium: W(1) }, { byMode: { 'first=me|one=0': { hard: W(1) } } }), 'hoops4').pts === 2);
ok('...on the Medium tab too', gamePoints(rec({ medium: W(1) }, { byMode: { 'first=me|one=0': { hard: W(1) } } }), 'hoops4', 2).pts === 2);
ok('...Until you score, Medium (recorded Easy): 1', gamePoints(rec({ easy: W(1) }, { byMode: { 'first=me|one=0': { medium: W(1) } } }), 'hoops4').pts === 1);
ok('...Until you score, Easy: 1', gamePoints(rec({ easy: W(1) }, { byMode: { 'first=me|one=0': { easy: W(1) } } }), 'hoops4').pts === 1);
ok('...One shot unchanged 1/3/5', gamePoints(rec({ easy: W(1), medium: W(1), hard: W(1) }, { byMode: { 'first=me|one=1': { easy: W(1), medium: W(1), hard: W(1) } } }), 'hoops4').pts === 9);
ok('...a Medium win with no saved mode stays 3', gamePoints(rec({ medium: W(1) }), 'hoops4').pts === 3);
ok('...One shot Medium beside Until you score Hard: 3 + 2', gamePoints(rec({ medium: W(2) }, { byMode: { 'first=me|one=1': { medium: W(1) }, 'first=me|one=0': { hard: W(1) } } }), 'hoops4').pts === 5);
ok('...online unchanged', gamePoints(rec({ mp: W(1) }, { byMode: { 'one=0': { mp: W(1) } } }), 'hoops4').pts === 3);
ok('...pointsForWin (the +X pts): recorded Medium, one=0 = 2', pointsForWin('hoops4', 'medium', { one: 0, first: 'me' }) === 2);
ok('...pointsForWin One shot Medium = 3', pointsForWin('hoops4', 'medium', { one: 1 }) === 3);
// 2. Chinchón, Escoba, Parchís at a table of 2 or 3 computers: each computer's 1v1 points added up. Recorded at the
//    easiest computer (byDiff), the table in byMode `ai` at the chosen (easiest) level.
const cc = (ai, more = '') => `ace=0|ai=${ai}|ext=0|fig=0|jk=0|mc=3|n=${ai.split('-').length + 1}|neg=-10|place=auto|rem=1|res=1|sl=100|vc=points|wwc=1${more}`;
ok('Chinchón Easy + Hard = 5', gamePoints(rec({ easy: W(1) }, { byMode: { [cc('easy-hard')]: { easy: W(1) } } }), 'chinchon').pts === 5);
ok('...Hard + Normal (seat order) = 6', gamePoints(rec({ normal: W(1) }, { byMode: { [cc('hard-normal')]: { normal: W(1) } } }), 'chinchon').pts === 6);
ok('...three Hard = 12', gamePoints(rec({ hard: W(1) }, { byMode: { [cc('hard-hard-hard')]: { hard: W(1) } } }), 'chinchon').pts === 12);
ok('...one computer unchanged (Hard 4)', gamePoints(rec({ hard: W(1) }, { byMode: { [cc('hard')]: { hard: W(1) } } }), 'chinchon').pts === 4);
const ccShortKey = cc('easy-hard').replace('sl=100', 'sl=50');
ok('...short match: each one level down, Easy + Hard = 1 + 2 = 3', gamePoints(rec({ easy: W(1) }, { byMode: { [ccShortKey]: { easy: W(1) } } }), 'chinchon').pts === 3);
ok('...short match, one Hard computer: still Medium 2', gamePoints(rec({ normal: W(1) }, { byMode: { [cc('hard').replace('sl=100', 'sl=50')]: { hard: W(1) } } }), 'chinchon').pts === 2);
ok('...short by rounds: 2 Hard = 2 + 2', gamePoints(rec({ normal: W(1) }, { byMode: { [cc('hard-hard').replace('sl=100|vc=points', 'rl=5|vc=rounds')]: { hard: W(1) } } }), 'chinchon').pts === 4);
ok('...on the Easy tab (the recorded level): 5', gamePoints(rec({ easy: W(1) }, { byMode: { [cc('easy-hard')]: { easy: W(1) } } }), 'chinchon', 1).pts === 5);
ok('...no table saved (before 2026-10-30): the easiest computer, 1', gamePoints(rec({ easy: W(1) }), 'chinchon').pts === 1);
ok('...losses add nothing', gamePoints(rec({ easy: { played: 3, won: 0, lost: 3 } }, { byMode: { [cc('easy-hard')]: { easy: { played: 3, won: 0, lost: 3 } } } }), 'chinchon').pts === 0);
ok('...pointsForWin Easy + Hard = 5', pointsForWin('chinchon', 'easy', { ai: 'easy-hard', vc: 'points', sl: 100 }) === 5);
ok('Escoba Easy + Hard = 5', gamePoints(rec({ easy: W(1) }, { byMode: { 'ai=easy-hard|assist=1|deck=spanish|n=3|to=21': { easy: W(1) } } }), 'escoba').pts === 5);
ok('...Normal + Normal + Hard = 8', gamePoints(rec({ normal: W(2) }, { byMode: { 'ai=normal-normal-hard|assist=1|deck=spanish|n=4|to=21': { normal: W(2) } } }), 'escoba').pts === 16);
ok('...online unchanged (2)', gamePoints(rec({ mp: W(1) }, { byMode: { 'assist=1|deck=spanish|n=2|to=21': { mp: W(1) } } }), 'escoba').pts === 2);
ok('Parchís beginner + pro (sorted) = 5', gamePoints(rec({ beginner: W(1) }, { byMode: { 'ai=beginner-pro|humans=1|mode=x|players=3': { beginner: W(1) } } }), 'parchis').pts === 5);
ok('...three computers 1 + 2 + 4 = 7', gamePoints(rec({ beginner: W(1) }, { byMode: { 'ai=beginner-intermediate-pro|humans=1|mode=x|players=4': { beginner: W(1) } } }), 'parchis').pts === 7);
ok('...two people at the table: unchanged (easiest computer)', gamePoints(rec({ beginner: W(1) }, { byMode: { 'ai=beginner-pro|humans=2|mode=x|players=4': { beginner: W(1) } } }), 'parchis').pts === 1);
ok('the other wins games are untouched by the table rule', pointsForWin('mancala', 'pro', { ai: 'easy-hard' }) === 6);

// Real data (optional): the top 3 of every points board.
try {
  const z = JSON.parse(fs.readFileSync(new URL('../backups/lb-z.json', import.meta.url), 'utf8'));
  const o = JSON.parse(zlib.gunzipSync(Buffer.from(z, 'base64')).toString());
  const { isHiddenName } = await import('../js/hidden-players.js');
  const people = Object.values(o.people).map((s) => JSON.parse(s)).filter((g) => g.name && !isHiddenName(g.name));
  for (const id of POINT_GAMES) {
    const rows = people.map((g) => ({ n: g.name, ...gamePoints((g.games || {})[id] || {}, id) })).filter((r) => r.pts > 0)
      .sort((a, b) => b.pts - a.pts || a.wins - b.wins);
    console.log('  ', id.padEnd(12), rows.slice(0, 3).map((r) => `${r.n} ${r.pts}`).join(' | '));
  }
} catch { console.log('  (no backups/lb-z.json: real-data top 3 skipped)'); }

// The puzzle boards' "+X pts" (2026-11-16, Matt: "All games should have that"): js/points-toast.js winPoints.
try {
  const { winPoints } = await import('../js/points-toast.js');
  const ms = (e, m) => ({ total: { played: e + m, won: e + m, lost: 0 }, byDiff: { easy: W(e), medium: W(m) } });
  ok('Minesweeper Medium win: +3', (winPoints({ id: 'minesweeper', d: 'medium', g: ms(2, 1), after: ms(2, 2) }) || {}).pts === 3);
  ok('Minesweeper with no "after" copy shows nothing', winPoints({ id: 'minesweeper', d: 'medium', g: ms(2, 1) }) === null);
  ok('Sudoku Expert, no help: +8', (winPoints({ id: 'sudoku', d: 'expert', help: 0, g: {}, after: {} }) || {}).pts === 8);
  ok('Sudoku Expert, 1 hint: +5', (winPoints({ id: 'sudoku', d: 'expert', help: 1, g: {}, after: {} }) || {}).pts === 5);
  ok('Murdoku Hard, 7 hints: +1', (winPoints({ id: 'murdoku', d: 'hard', help: 7, g: {}, after: {} }) || {}).pts === 1);
  ok('Murdoku Expert, hints unknown: +4 (never the clean value)', (winPoints({ id: 'murdoku', d: 'expert', help: null, g: {}, after: {} }) || {}).pts === 4);
  const ww = (lv) => ({ total: { played: 1, won: 1, lost: 0 }, byDiff: {}, ww: { lv, es: {}, x: 0 } });
  ok('Word Weaver level 501, 1 hint: +4', (winPoints({ id: 'wordweaver', d: 'medium', g: ww({}), after: ww({ L501: { s: 2, h: 1, t: 1 } }) }) || {}).pts === 4);
  ok('Word Weaver replay, nothing better: 0', (winPoints({ id: 'wordweaver', d: 'medium', g: ww({ L501: { s: 2, h: 1, t: 1 } }), after: ww({ L501: { s: 2, h: 1, t: 1 } }) }) || {}).pts === 0);
  ok('Snake (no points board): nothing', winPoints({ id: 'snake', d: 'easy', g: {}, after: {} }) === null);
} catch (err) { ok('points-toast.js loads in node', false, String(err)); }


// NEW PRICES (docs/HANDOFF-WINS-GAMES-FIXES.md): admin devices only until released; `cv=2` = a win vs the new computer.
ok('new prices are off in node (no admin device)', newPricesOn() === false);
ok('...and off means today\'s Air Hockey (Medium 2, no limit)', gamePoints(rec({ medium: W(30) }), 'airhockey').pts === 60);
setNewPrices(true);
{ const AH = (old, nu, easy = 0) => rec({ easy: W(easy), medium: W(old + nu) }, nu ? { byMode: { 'cv=2': { medium: W(nu) } } } : {});
  ok('Air Hockey: old Medium 1 a win, limit 20', gamePoints(AH(60, 0), 'airhockey').pts === 20);
  ok('...Easy shares the limit', gamePoints(AH(15, 0, 10), 'airhockey').pts === 20);
  ok('...new Medium (cv=2) 2 a win, no limit', gamePoints(AH(60, 15), 'airhockey').pts === 20 + 30);
  ok('...Hard unchanged 5', gamePoints(rec({ hard: W(2) }), 'airhockey').pts === 10);
  ok('...+X: old Medium 1, new 2', pointsForWin('airhockey', 'medium', {}) === 1 && pointsForWin('airhockey', 'medium', { cv: 2 }) === 2);
  ok('...Medium tab', gamePoints(AH(60, 15), 'airhockey', 2).pts === 50); }
ok('Connect Four: old Medium 6, new 3; Easy limit 20', gamePoints(rec({ easy: W(85), medium: W(3) }, { byMode: { 'cv=2|first=me': { medium: W(2) } } }), 'connect4').pts === 20 + 6 + 6);
ok('Darts: old Hard 2, new Hard 3', gamePoints(rec({ hard: W(5) }, { byMode: { 'cv=2|kind=301': { hard: W(2) } } }), 'darts').pts === 3 * 2 + 2 * 3);
ok('...Cricket in order doubles both', pointsForWin('darts', 'hard', { kind: 'cricket-order' }) === 4 && pointsForWin('darts', 'hard', { kind: 'cricket-order', cv: 2 }) === 6);
ok('...Easy/Medium unchanged', pointsForWin('darts', 'easy', {}) === 1 && pointsForWin('darts', 'medium', { kind: '301' }) === 2);
ok('Cup Pong: no reracks +1 (Hard 4)', pointsForWin('cuppong', 'hard', { rr: 0 }) === 4 && pointsForWin('cuppong', 'hard', { rr: 2 }) === 3);
ok('...Expert 6, 7 with no reracks', pointsForWin('cuppong', 'expert', { rr: 2 }) === 6 && pointsForWin('cuppong', 'expert', { rr: 0 }) === 7);
for (const [t, d, want] of [[1, 'easy', [1, 1, 2, 2]], [2, 'medium', [2, 3, 3, 4]], [3, 'hard', [3, 4, 5, 6]]]) {
  ok(`Monopoly Deal ${d} vs 1-4 computers = ${want}`, [1, 2, 3, 4].map((n) => pointsForWin('business', d, { ai: n })).join() === want.join());
}
ok('...old wins re-priced too (byMode ai=4, Hard)', gamePoints(rec({ hard: W(2) }, { byMode: { 'ai=4': { hard: W(2) } } }), 'business').pts === 12);
{ const k = 'first=opponent|size=small|undo=0|went=them';
  ok('Dots: the farm price stays on old wins', gamePoints(rec({ intermediate: W(21) }, { byMode: { [k]: { intermediate: W(21) } } }), 'dotsboxes').pts === 20);
  ok('...a win vs the new Medium pays 3', gamePoints(rec({ intermediate: W(22) }, { byMode: { [k]: { intermediate: W(21) }, [k + '|cv=2']: { intermediate: W(1) } } }), 'dotsboxes').pts === 23); }
ok('games with no new price unchanged (Mancala)', gamePoints(rec({ hard: W(1) }), 'mancala').pts === 6);
setNewPrices(false);
ok('switched off again: Monopoly Deal x computers as before', pointsForWin('business', 'hard', { ai: 4 }) === 12);
setNewPrices(null);

console.log(`\nlb-points tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
