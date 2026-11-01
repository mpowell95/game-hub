// Leaderboard v2's pure tallies (js/leaderboard2-boards.js, round 1 2026-10-31: medals from the OLD board's
// one standing per game only). The boards themselves are the old board's, proven by tools/test-lb2-parity.mjs.
//   node tools/test-leaderboard2.mjs
import * as B from '../js/leaderboard2-boards.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + JSON.stringify(detail) : '')); }
}
const row = (key, rank, extra = {}) => ({ key, g: { key }, name: key.toUpperCase(), emoji: '', rank, ...extra });
// Three games' standings (as lb2Standing returns them, ranks already competition ranks).
const standings = [
  { game: 'darts', rows: [row('a', 1), row('b', 2), row('c', 3), row('d', 4)] },
  { game: 'uno', rows: [row('b', 1, { tie: true }), row('c', 1, { tie: true }), row('a', 3)] },     // a tie for 1st
  { game: 'holdem', rows: [row('a', 1), row('b', 2, { noMedal: true }), row('c', 2, { noMedal: true })] },
  { game: 'golf', rows: [] },
];
const tot = B.medalTotals(standings);
ok('one standing per game: golds = rank-1 rows, ties share (darts 1, uno 2, holdem 1 = 4)', tot[0] === 4, tot);
ok('an unused Hold\'em bankroll earns no medal (silvers: darts 1 only)', tot[1] === 1, tot);
ok('bronzes: darts c, uno a', tot[2] === 2, tot);
const hof = B.hallOfFame(standings);
const by = Object.fromEntries(hof.map((r) => [r.key, r]));
ok('Hall of Fame: a 2 golds 1 bronze, b 1 gold 1 silver, c 1 gold 1 bronze', by.a.firsts === 2 && by.a.thirds === 1 && by.b.firsts === 1 && by.b.seconds === 1 && by.c.firsts === 1 && by.c.thirds === 1, hof);
ok('Hall of Fame order: golds, then silvers, then bronzes', hof.map((r) => r.key).join('') === 'abc', hof.map((r) => r.key));
ok('Hall of Fame: nobody below 3rd, nobody without a medal (d)', !by.d);
ok('Hall of Fame gold total = medalTotals gold', hof.reduce((a, r) => a + r.firsts, 0) === tot[0]);
const pp = B.personPlaces(standings, 'b');
ok('personPlaces: b is 2nd in darts, tied 1st in uno, golds 1', pp.place.darts.rank === 2 && pp.place.uno.rank === 1 && pp.place.uno.tie && pp.golds === 1, pp);
ok('personPlaces: no row = no place (golf)', !pp.place.golf);
ok('firstsToPass: b (1,1,0) behind a (2,0,1) needs 1 more', B.firstsToPass(by.b, by.a) === 1);
ok('aboveOf: nearest higher rank', B.aboveOf(hof, by.c).key === 'b');
const s0 = B.rollRanks(null, '2026-10-30', { x: { [B.keyHash('a')]: 3 } });
ok('first day: no previous snapshot, no arrows', B.moveOf(s0, 'x', 'a', 1) === 0);
const s1 = B.rollRanks(s0, '2026-10-31', { x: { [B.keyHash('a')]: 1 } });
ok('next day: arrow = yesterday\'s rank - today\'s (3 -> 1 = up 2)', B.moveOf(s1, 'x', 'a', 1) === 2);
const s2 = B.rollRanks(s1, '2026-10-31', { x: { [B.keyHash('a')]: 4 } });
ok('same day: prev kept, so 3 -> 4 = down 1', B.moveOf(s2, 'x', 'a', 4) === -1);
ok('keyHash never carries the key itself', !B.keyHash('code:QQQQQ').includes('QQQQQ'));
ok('nyDay is a YYYY-MM-DD in New York (00:30 UTC Oct 31 = Oct 30 there)', B.nyDay(Date.UTC(2026, 9, 31, 0, 30)) === '2026-10-30');

console.log(`\nleaderboard2 tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

