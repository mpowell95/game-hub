// test-arcade-scores.mjs - the shared arcade high-score + unlock layer (js/arcade-scores.js),
// used by Skeeball and next by Pinball. Run: node test-arcade-scores.mjs (in run-all-tests.mjs).
//
// This module is where THE LAW meets a feature that SOUNDS like it deletes things ("a daily high
// score that resets every 24 hours"). It does not, and these assertions are what keeps it that way.

import {
  dayKey, recordBoardGame, unlockBoard, isUnlocked, bestOn, todayBestOn,
  mergeBoards, mergeUnlocked, appWideBest,
} from './js/arcade-scores.js';

let fail = 0;
const ok = (label, cond) => { if (!cond) { fail++; console.log(`FAIL  ${label}`); } else console.log(`ok    ${label}`); };
const eq = (label, got, want) => ok(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const D1 = new Date(2026, 7, 11, 13, 0, 0).getTime();   // local noon-ish, 2026-08-11
const D2 = new Date(2026, 7, 12, 9, 0, 0).getTime();    // the next local day

console.log('\n-- the day key --');
eq('is the LOCAL calendar day', dayKey(D1), '2026-08-11');
eq('and rolls at local midnight', dayKey(D2), '2026-08-12');
ok('the same instant always gives the same key', dayKey(D1) === dayKey(new Date(D1)));

console.log('\n-- recording, and THE LAW rule 2 (nothing is ever zeroed) --');
{
  const sk = {};
  recordBoardGame(sk, 'classic', { score: 300, bestThrow: 100, at: D1 });
  recordBoardGame(sk, 'classic', { score: 520, bestThrow: 300, at: D1 });
  recordBoardGame(sk, 'classic', { score: 120, bestThrow: 50, at: D1 });
  eq('plays count every rack', sk.boards.classic.plays, 3);
  eq('points are a lifetime running total', sk.boards.classic.points, 940);
  eq('the all-time best is the best, not the last', bestOn(sk, 'classic'), 520);
  eq('the best single throw likewise', sk.boards.classic.bestThrow, 300);
  eq("today's best is the best of today", todayBestOn(sk, 'classic', D1), 520);

  // The heart of it: a new day does NOT clear anything. It reads a different key.
  recordBoardGame(sk, 'classic', { score: 200, bestThrow: 40, at: D2 });
  eq("the NEXT day starts fresh for 'today'", todayBestOn(sk, 'classic', D2), 200);
  eq('but yesterday is still there, untouched', sk.boards.classic.daily['2026-08-11'], 520);
  eq('and the all-time best is not dragged down by a worse day', bestOn(sk, 'classic'), 520);
  eq('the daily map is APPEND-ONLY: one entry per day played', Object.keys(sk.boards.classic.daily).sort(), ['2026-08-11', '2026-08-12']);

  // A worse score today must not lower today's number either.
  recordBoardGame(sk, 'classic', { score: 10, at: D2 });
  eq("a bad game cannot lower today's best", todayBestOn(sk, 'classic', D2), 200);
}
{
  const sk = {};
  recordBoardGame(sk, 'classic', { score: 100, at: D1 });
  recordBoardGame(sk, 'stars', { score: 700, at: D1 });
  eq('boards keep separate records', [bestOn(sk, 'classic'), bestOn(sk, 'stars')], [100, 700]);
  eq('a board never played reads zero, not undefined', bestOn(sk, 'nope'), 0);
  eq('and neither does its day', todayBestOn(sk, 'nope', D1), 0);
}

console.log('\n-- unlocking --');
{
  const sk = {};
  ok('the default machine is open before anything is recorded', isUnlocked(sk, 'classic', 'classic'));
  ok('a later machine is not', !isUnlocked(sk, 'stars', 'classic'));
  unlockBoard(sk, 'stars');
  ok('until it is unlocked', isUnlocked(sk, 'stars', 'classic'));
  unlockBoard(sk, 'stars');
  eq('unlocking twice is idempotent', Object.keys(sk.unlocked), ['stars']);
  ok('playing a board records it as unlocked too', (() => {
    const s2 = {}; recordBoardGame(s2, 'x', { score: 1, at: D1 }); unlockBoard(s2, 'x');
    return isUnlocked(s2, 'x', 'classic');
  })());
}

console.log('\n-- the cross-device combine (THE LAW rule 1: nothing vanishes on a 2nd device) --');
{
  const a = {}; recordBoardGame(a, 'classic', { score: 400, bestThrow: 100, at: D1 });
  const b = {}; recordBoardGame(b, 'classic', { score: 650, bestThrow: 300, at: D1 });
  recordBoardGame(b, 'stars', { score: 300, at: D2 });
  const dst = {};
  mergeBoards(dst, a.boards); mergeBoards(dst, b.boards);
  eq('plays add across devices', dst.classic.plays, 2);
  eq('points add', dst.classic.points, 1050);
  eq('the best is the MAX, never the sum - a summed best is a score nobody threw', dst.classic.best, 650);
  eq('best throw likewise', dst.classic.bestThrow, 300);
  eq('the SAME day on two devices keeps the better of the two', dst.classic.daily['2026-08-11'], 650);
  eq('a board only one device has still comes through', dst.stars.best, 300);
  eq('merging an absent record is a no-op, not a crash', mergeBoards({ z: { plays: 1, points: 1, best: 1, bestThrow: 0, daily: {} } }, undefined).z.plays, 1);
}
{
  // The rule that matters most: a second device must never TAKE AWAY a board.
  const phone = { stars: true }, tablet = {};
  const dst = {};
  mergeUnlocked(dst, phone); mergeUnlocked(dst, tablet);
  ok('unlocks are a UNION - the tablet does not re-lock what the phone earned', dst.stars === true);
  const dst2 = {};
  mergeUnlocked(dst2, tablet); mergeUnlocked(dst2, phone);
  ok('and it does not depend on which device syncs last', dst2.stars === true);
}

console.log('\n-- the app-wide record --');
{
  const mk = (name, board, best) => ({ name, games: { skeeball: { sk: { boards: { [board]: { best } } } } } });
  const rows = [mk('Matt', 'classic', 640), mk('Ana', 'classic', 910), mk('Lili', 'stars', 300)];
  eq('the record is the best anyone has thrown on that machine', appWideBest(rows, 'skeeball', 'sk', 'classic'), { score: 910, name: 'Ana' });
  eq('and it is per machine', appWideBest(rows, 'skeeball', 'sk', 'stars'), { score: 300, name: 'Lili' });
  eq('a machine nobody has played has no record, and says so with 0 rather than a wrong number',
    appWideBest(rows, 'skeeball', 'sk', 'nobody'), { score: 0, name: '' });
  eq('no players at all is not a crash', appWideBest([], 'skeeball', 'sk', 'classic'), { score: 0, name: '' });
  eq('neither is undefined', appWideBest(undefined, 'skeeball', 'sk', 'classic'), { score: 0, name: '' });
  eq('a record from a game that is not this one is ignored', appWideBest(rows, 'pinball', 'pb', 'classic'), { score: 0, name: '' });
  eq('and the sub-counter key really is per game - Skeeball\'s boards are not read as Pinball\'s',
    appWideBest(rows, 'skeeball', 'pb', 'classic'), { score: 0, name: '' });
}

console.log('\n-- malformed input never throws --');
{
  ok('recording into nothing', recordBoardGame(null, 'a', { score: 1 }) === null);
  ok('recording with no board id', (() => { const s = {}; recordBoardGame(s, '', { score: 1 }); return !s.boards; })());
  ok('a junk score reads as zero', (() => { const s = {}; recordBoardGame(s, 'a', { score: 'x', at: D1 }); return bestOn(s, 'a') === 0; })());
  ok('a junk stored record self-repairs on read', bestOn({ boards: { a: null } }, 'a') === 0);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
