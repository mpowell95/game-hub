// Leaderboard v2's pure board maths (js/leaderboard2-boards.js, 2026-10-31).
//   node tools/test-leaderboard2.mjs
import * as B from '../js/leaderboard2-boards.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + JSON.stringify(detail) : '')); }
}
const bk = (played, won, lost = played - won) => ({ played, won, lost });
function person(key, name, games) {
  const g = { key, name, emoji: '', games: {} };
  for (const id of Object.keys(games)) {
    const src = games[id];
    const byDiff = src.byDiff || {};
    const total = { played: 0, won: 0, lost: 0 };
    for (const k of Object.keys(byDiff)) { total.played += byDiff[k].played; total.won += byDiff[k].won; total.lost += byDiff[k].lost; }
    g.games[id] = { total: src.total || total, byDiff, ...(src.byMode ? { byMode: src.byMode } : {}) };
  }
  return g;
}

// --- Win % needs 10 games; Wins ranks by `won`; a draw is not a win -----------------------------------
const people = [
  person('a', 'Ana', { darts: { byDiff: { hard: bk(20, 15), mp: bk(8, 6) }, byMode: { 'first=me|kind=301': { hard: bk(12, 10), mp: bk(5, 4) }, 'first=them|kind=301': { hard: bk(2, 1) }, 'first=me|kind=cricket': { hard: bk(6, 4) } } } }),
  person('b', 'Bo', { darts: { byDiff: { hard: bk(9, 9), easy: bk(30, 20), mp: bk(10, 6) } } }),
  person('c', 'Cy', { darts: { byDiff: { hard: { played: 12, won: 9, lost: 1 } } } }),   // 2 draws
  person('d', 'Di', { darts: { byDiff: { hard: bk(40, 30) } } }),
]
const pct = B.winsRows(people, 'darts', { opp: 'ai', mode: '', diff: 3, rankBy: 'pct' });
ok('Win % board leaves out fewer than 10 games (Bo, 9 games)', !pct.some((r) => r.key === 'b'), pct.map((r) => r.key));
ok('Win %: 75% (Ana 15/20) ties 75% (Di 30/40) and Cy 9/12 too: all rank 1', pct.every((r) => r.rank === 1), pct.map((r) => [r.key, r.rank, r.pct]));
ok('Win % tie: more games drawn first', pct[0].key === 'd', pct.map((r) => r.key));
const wins = B.winsRows(people, 'darts', { opp: 'ai', mode: '', diff: 3, rankBy: 'wins' });
ok('Wins board ranks by won (Di 30, Ana 15, Cy 9, Bo 9)', wins.map((r) => r.key).join('') === 'dabc' || wins.map((r) => r.key).join('') === 'dacb', wins.map((r) => [r.key, r.won]));
ok('Wins board: equal wins share a rank (Cy 9, Bo 9 -> 3, 3)', wins.filter((r) => r.won === 9).every((r) => r.rank === 3), wins.map((r) => [r.key, r.rank]));
const cy = wins.find((r) => r.key === 'c');
ok('a draw is not a win: Cy has 9 wins from 12 games, 2 drawn', cy.won === 9 && cy.games === 12, cy);

// --- All modes = byDiff; one mode from byMode, extra parts summed -----------------------------------
const allModes = B.winsRecord(people[0], 'darts', { opp: 'ai', mode: '', diff: 3 });
ok('All modes = byDiff (Ana Hard 20 played, 15 won)', allModes.played === 20 && allModes.won === 15, allModes);
const m301 = B.winsRecord(people[0], 'darts', { opp: 'ai', mode: 'kind=301', diff: 3 });
ok('one mode from byMode, first=me and first=them summed (301 Hard: 14 played, 11 won)', m301.played === 14 && m301.won === 11, m301);
ok('projectMode keeps only the shown dimensions', B.projectMode('darts', 'first=me|kind=cricket-order') === 'kind=cricket-order');
ok('a game with no mode split projects to ""', B.projectMode('connect4', 'aid=0|first=me') === '');
const mp301 = B.winsRecord(people[0], 'darts', { opp: 'mp', mode: 'kind=301' });
ok('Multiplayer per mode = byMode[key].mp', mp301.played === 5 && mp301.won === 4, mp301);
const mpAll = B.winsRows(people, 'darts', { opp: 'mp', mode: '' });
ok('Multiplayer All modes = byDiff.mp, ranked by Wins (Ana 6, Bo 6 tied)', mpAll.length === 2 && mpAll.every((r) => r.rank === 1), mpAll.map((r) => [r.key, r.won, r.rank]));
const sh = B.winsShape(people, 'darts');
ok('shape: tiers present, modes present', JSON.stringify(sh.aiTiers) === '[1,3]' && sh.aiModes.join(',') === ',kind=301,kind=cricket' && sh.mpModes.join(',') === ',kind=301', sh);

// --- a game with no data, and a game with no tier ---------------------------------------------------------
const none = B.gameBoards(people, 'mancala', { isScore: () => false, score: null });
ok('a game nobody played has no boards (the screen shows "1st place is open")', none.length === 0);
const emptyBoard = B.buildBoard(people, { game: 'mancala', type: 'wins', opp: 'ai', mode: '', diff: 3, rankBy: 'pct' });
ok('...and its board builds empty', emptyBoard.rows.length === 0 && emptyBoard.id);
const yz = [person('y', 'Yo', { yahtzee: { byDiff: { ai: bk(12, 7) } } })];
const yzShape = B.winsShape(yz, 'yahtzee');
ok('a game whose buckets map to no tier gets one tierless board', JSON.stringify(yzShape.aiTiers) === '[null]', yzShape);
ok('...holding its plays', B.winsRows(yz, 'yahtzee', { opp: 'ai', mode: '', diff: null, rankBy: 'wins' })[0].won === 7);

// --- Hall of Fame: 1sts, then 2nds, then 3rds; ties give each tied player the place -------------------
const mk = (game, diff, ranks, opp = 'ai') => ({ game, diff, opp, rows: ranks.map(([key, rank]) => ({ key, name: key, rank })) });
const boards = [
  mk('darts', 3, [['a', 1], ['b', 2], ['c', 3]]),
  mk('darts', 1, [['b', 1], ['a', 2]]),
  mk('pool', 3, [['c', 1], ['b', 1], ['a', 3]]),     // a tie at 1st: both get a 1st
  mk('pool', 2, [['c', 1], ['a', 2]]),
  mk('pool', null, [['a', 1]], 'mp'),
];
const hof = B.hallOfFame(boards);
const row = (k) => hof.find((r) => r.key === k);
ok('HoF tally: a = 2 firsts, 2 seconds, 1 third', row('a').firsts === 2 && row('a').seconds === 2 && row('a').thirds === 1, row('a'));
ok('HoF tied 1st counts for both (b and c have a pool 1st)', row('b').firsts === 2 && row('c').firsts === 2);
ok('HoF tie-break by 2nds: a (2 seconds) above b (1) above c (0)', hof.map((r) => r.key).join('') === 'abc', hof.map((r) => [r.key, r.p]));
const top = B.hallOfFame(boards, { topLevel: true });
const trow = (k) => top.find((r) => r.key === k) || { firsts: 0 };
ok('Top level counts only each game\'s hardest level (Hard), never Multiplayer', trow('a').firsts === 1 && trow('b').firsts === 1 && trow('c').firsts === 1 && trow('a').thirds === 1, top.map((r) => [r.key, r.p]));
ok('firstsToPass: one more 1st passes a row equal on 1sts when 2nds lose', B.firstsToPass({ firsts: 2, seconds: 0, thirds: 0 }, { firsts: 2, seconds: 1, thirds: 0, rank: 1 }) === 1);
ok('firstsToPass: 3 behind on 1sts, better on 2nds = 3', B.firstsToPass({ firsts: 1, seconds: 5, thirds: 0 }, { firsts: 4, seconds: 1, thirds: 0 }) === 3);

// --- gap text ---------------------------------------------------------------------------------------------
const T = {
  lb2_first: '1st', lb2_not_ranked: 'Not ranked', lb2_behind: (p) => `${p.a} behind #${p.r}`, lb2_behind_only: (p) => `Behind #${p.r}`,
  lb2_amt: (p) => ({ pct: `${p.v}%`, wins: `${p.v} ${Number(p.n) === 1 ? 'win' : 'wins'}`, points: `${p.v} pts` })[p.k],
};
const t2 = (k, p) => (typeof T[k] === 'function' ? T[k](p || {}) : T[k]);
const pb = B.buildBoard([
  person('a', 'Ana', { darts: { byDiff: { hard: bk(10, 8) } } }),
  person('b', 'Bo', { darts: { byDiff: { hard: bk(20, 15) } } }),
  person('c', 'Cy', { darts: { byDiff: { hard: bk(10, 5) } } }),
], { game: 'darts', type: 'wins', opp: 'ai', mode: '', diff: 3, rankBy: 'pct' });
const r = (k) => pb.rows.find((x) => x.key === k);
ok('gap text, Win %: "5.0% behind #1"', B.gapLine(pb, r('b'), t2) === '5.0% behind #1', B.gapLine(pb, r('b'), t2));
ok('gap text, leading: "1st"', B.gapLine(pb, r('a'), t2) === '1st');
ok('gap text, absent: "Not ranked"', B.gapLine(pb, null, t2) === 'Not ranked');
ok('gap text, to the NEXT rank up (Cy 50% is behind #2 Bo 75%)', B.gapLine(pb, r('c'), t2) === '25.0% behind #2', B.gapLine(pb, r('c'), t2));
const wb = B.buildBoard(pb.rows.map((x) => x.g), { game: 'darts', type: 'wins', opp: 'ai', mode: '', diff: 3, rankBy: 'wins' });
ok('gap text, Wins: "7 wins behind #1" / "3 wins behind #2"', B.gapLine(wb, wb.rows[1], t2) === '7 wins behind #1' && B.gapLine(wb, wb.rows[2], t2) === '3 wins behind #2', wb.rows.map((x) => B.gapLine(wb, x, t2)));
const sb = { metric: 'score', rows: [{ key: 'x', rank: 1, num: 300 }, { key: 'y', rank: 2, num: 180 }], gapFn: (me, ab) => ({ k: 'points', v: String(ab.num - me.num), n: ab.num - me.num }) };
ok('gap text, score (provider gap): "120 pts behind #1"', B.gapLine(sb, sb.rows[1], t2) === '120 pts behind #1');

// --- score boards through the provider; extras on a wins game -----------------------------------------------
const fakeScore = {
  specs: () => ({ tiers: [null, 1, 3], views: [{ view: '', tiered: true }, { view: 'off', tiered: false }], rankBy: [], langs: null }),
  board: (list, id, spec) => ({ unit: 'points', kind: 'points', lower: false, gap: () => null,
    rows: list.map((g, i) => ({ g, key: g.key, rank: i + 1, games: 1, num: 10 - i, tier: spec.tier, html: '', text: String(10 - i) })) }),
};
const sBoards = B.gameBoards(people, 'snake', { isScore: () => true, score: fakeScore });
ok('score game: one board per tier tab + one per untiered view (All, Easy, Hard, Walls off = 4)', sBoards.length === 4, sBoards.map((b) => b.id));
const hBoards = B.gameBoards([person('h', 'Ha', { holdem: { byDiff: { medium: bk(3, 1) } } })], 'holdem', { isScore: () => false,
  score: { extras: () => ({ tiers: [], views: [{ view: 'bank', tiered: false }], rankBy: [], langs: null }), board: fakeScore.board } });
ok('a wins game with an extra board (Hold\'em Bankroll) gets it too', hBoards.some((b) => b.type === 'score' && b.view === 'bank') && hBoards.some((b) => b.type === 'wins'));

// --- arrows ---------------------------------------------------------------------------------------------
const s0 = B.rollRanks(null, '2026-10-30', { x: { [B.keyHash('a')]: 3 } });
ok('first day: no previous snapshot, no arrows', B.moveOf(s0, 'x', 'a', 1) === 0);
const s1 = B.rollRanks(s0, '2026-10-31', { x: { [B.keyHash('a')]: 1 } });
ok('next day: arrow = yesterday\'s rank - today\'s (3 -> 1 = up 2)', B.moveOf(s1, 'x', 'a', 1) === 2);
const s2 = B.rollRanks(s1, '2026-10-31', { x: { [B.keyHash('a')]: 4 } });
ok('same day: prev kept, so 3 -> 4 = down 1', B.moveOf(s2, 'x', 'a', 4) === -1);
ok('keyHash never carries the key itself', !B.keyHash('code:QQQQQ').includes('QQQQQ'));
ok('nyDay is a YYYY-MM-DD in New York (00:30 UTC Oct 31 = Oct 30 there)', B.nyDay(Date.UTC(2026, 9, 31, 0, 30)) === '2026-10-30');
const summ = B.personSummary(boards, 'a');
ok('personSummary: firsts, crowns and best rank per game', summ.firsts === 2 && summ.crowns.darts === 1 && summ.best.pool === 1 && summ.ranked === 5, summ);

console.log(`\nleaderboard2 tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
