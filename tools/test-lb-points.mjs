// test-lb-points.mjs - the wins boards' POINTS (js/lb-points.js, 2026-11-02) and the "+X pts" maths
// (js/points-toast.js winPoints). Pure; no browser. With backups/lb-z.json present (read-only copy of the
// live board, `node tools/read-lb-snapshot.mjs`), also prints each board's top 3 on real data.
//   node tools/test-lb-points.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { gamePoints, pointsForWin, pointsKey, POINT_GAMES, CAP } from '../js/lb-points.js';
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
ok('Cup Pong Hard 0 reracks x2', gamePoints(rec({ hard: W(1) }, { byMode: { 'gent=1|rr=0': { hard: W(1) } } }), 'cuppong').pts === 6);
// Session 6 (docs/HANDOFF-LB-POINTS-INFO.md): no reracks doubles EVERY level, still inside the 20-point limit.
ok('Cup Pong Easy/Medium 0 reracks x2', gamePoints(rec({ easy: W(1), medium: W(1) }, { byMode: { 'gent=1|rr=0': { easy: W(1), medium: W(1) } } }), 'cuppong').pts === 4);
ok('...and still capped at 20 together', gamePoints(rec({ easy: W(30) }, { byMode: { 'gent=1|rr=0': { easy: W(30) } } }), 'cuppong').pts === CAP);
ok('Cup Pong 2 reracks: no bonus', gamePoints(rec({ hard: W(1) }, { byMode: { 'gent=1|rr=2': { hard: W(1) } } }), 'cuppong').pts === 3);
ok('Darts Cricket in order x2 (2/4/6)', gamePoints(rec({ easy: W(1), medium: W(1), hard: W(1) }, { byMode: { 'kind=cricket-order|first=me': { easy: W(1), medium: W(1), hard: W(1) } } }), 'darts').pts === 12);
ok('...no-points Cricket in order too', pointsForWin('darts', 'hard', { kind: 'cricket-order-np', first: 'me' }) === 6);
ok('...plain Cricket and 301 unchanged', pointsForWin('darts', 'hard', { kind: 'cricket' }) === 3 && pointsForWin('darts', 'hard', { kind: '301' }) === 3);
ok('a multiplier never counts more wins than the level holds', gamePoints(rec({ pro: W(1) }, { byMode: { 'size=large': { pro: W(5) } } }), 'dotsboxes').pts === 10);
ok('online wins never take the mode bonus', gamePoints(rec({ mp: W(1) }, { byMode: { 'size=large': { mp: W(1) } } }), 'dotsboxes').pts === 3);
ok('legacy wins (no level) = 1', gamePoints(rec({ legacy: W(4) }), 'business').pts === 4);
ok('ties: wins reported', gamePoints(rec({ easy: W(3), mp: W(1) }), 'darts').wins === 4);
ok('pointsForWin Hard Connect Four = 8', pointsForWin('connect4', 'hard', null) === 8);
ok('pointsForWin online Flick = 3', pointsForWin('flicksoccer', 'mp', null) === 3);
ok('pointsForWin Ultimate Hard = 10', pointsForWin('tictactoe', 'pro', { v: 'ultimate' }) === 10);
ok('pointsForWin Pool 3 racks Hard = 10', pointsForWin('eightball', 'hard', { racks: 3 }) === 10);

// Real data (optional): the top 3 of every points board.
try {
  const z = JSON.parse(fs.readFileSync(new URL('../backups/lb-z.json', import.meta.url), 'utf8'));
  const o = JSON.parse(zlib.gunzipSync(Buffer.from(z, 'base64')).toString());
  const { isHiddenName } = await import('../js/hidden-players.js');
  const people = Object.values(o.people).map((s) => JSON.parse(s)).filter((g) => g.name && !isHiddenName(g.name));
  for (const id of POINT_GAMES) {
    const rows = people.map((g) => ({ n: g.name, ...gamePoints((g.games || {})[id] || {}, id) })).filter((r) => r.pts > 0)
      .sort((a, b) => b.pts - a.pts || b.wins - a.wins);
    console.log('  ', id.padEnd(12), rows.slice(0, 3).map((r) => `${r.n} ${r.pts}`).join(' | '));
  }
} catch { console.log('  (no backups/lb-z.json: real-data top 3 skipped)'); }

console.log(`\nlb-points tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
