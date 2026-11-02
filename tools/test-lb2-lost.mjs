// Leaderboard v2 Lost records: the pure diff in js/lb2-lost.js.   node tools/test-lb2-lost.mjs
import { diffHeld, LOST_CAP } from '../js/lb2-lost.js';
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (d ? '  ' + JSON.stringify(d) : '')); } };
const mine = { mine: true, by: [] }, theirs = (...by) => ({ mine: false, by });

const s = diffHeld(null, { darts: mine, uno: theirs('Ana') }, 100);
ok('first run seeds held, no losses', s.held.darts === 100 && !('uno' in s.held) && s.lost.length === 0, s);
const s2 = diffHeld(s, { darts: mine, uno: theirs('Ana') }, 200);
ok('unchanged: first-seen time kept', s2.held.darts === 100 && s2.lost.length === 0, s2);
const s3 = diffHeld(s2, { darts: theirs('Ben'), uno: theirs('Ana') }, 300);
ok('held -> lost: entry with names and time', s3.lost.length === 1 && s3.lost[0].game === 'darts' && s3.lost[0].takenBy[0] === 'Ben' && s3.lost[0].at === 300 && !('darts' in s3.held), s3);
const s4 = diffHeld(s3, { darts: theirs('Cy'), uno: theirs('Ana') }, 400);
ok('still lost: holder updates, noticed time kept', s4.lost.length === 1 && s4.lost[0].takenBy[0] === 'Cy' && s4.lost[0].at === 300, s4);
const s5 = diffHeld(s4, { darts: mine, uno: theirs('Ana') }, 500);
ok('regained: entry dropped, held again', s5.lost.length === 0 && s5.held.darts === 500, s5);
const t = diffHeld(s5, { darts: theirs('Ben', 'Cy') }, 600);
ok('lost to a tie of two: both named', t.lost[0].takenBy.join() === 'Ben,Cy', t);
const tie = diffHeld(s5, { darts: { mine: true, by: ['Ben'] } }, 600);
ok('tie for 1st still holds, no loss', tie.lost.length === 0 && 'darts' in tie.held, tie);
const unk = diffHeld(s5, { uno: theirs('Ana') }, 700);
ok('game missing from the data: untouched', 'darts' in unk.held && unk.lost.length === 0, unk);
const nob = diffHeld(s5, { darts: theirs() }, 700);
ok('nobody else at #1: no fake loss', nob.lost.length === 0, nob);
const many = {}, gone = {};
for (let i = 0; i < 60; i++) { many['g' + i] = mine; gone['g' + i] = theirs('X'); }
const b = diffHeld(diffHeld(null, many, 1), gone, 2);
ok('cap ' + LOST_CAP, b.lost.length === LOST_CAP, b.lost.length);
const two = diffHeld(diffHeld(null, { a: mine, b: mine }, 1), { a: theirs('P') }, 5);
const two2 = diffHeld(two, { b: theirs('Q') }, 9);
ok('newest first', two2.lost.map((x) => x.game).join() === 'b,a', two2.lost);
ok('input state not mutated', s3.lost.length === 1 && s3.lost[0].takenBy[0] === 'Ben' && s4.lost[0].takenBy[0] === 'Cy');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
