// darts/js/test.js - headless tests for the rules: scoring geometry, the 301 match (bust, win,
// turn hand-over), the computer's targets, and the flick mapping. No DOM, no browser.
//
//   node darts/js/test.js
//
// Not deployed (not in sw.js ASSETS); run by run-all-tests.mjs as a plain node script.
import {
  ORDER, RING, scoreAt, targetPoint, newMatch, throwDart, nextTurn, validMatch,
  chooseTarget, computerThrow, flickLanding, FLICK_MID, SPREAD,
} from './engine.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// 1. Geometry: every target scores what it names.
eq('bull is 50', scoreAt(0, 0).pts, 50);
eq('outer bull is 25', scoreAt(0, -0.06).pts, 25);
eq('straight up, inner single, is 20', scoreAt(0, -0.3).pts, 20);
eq('straight up, treble, is 60', scoreAt(0, -0.6).pts, 60);
eq('straight up, double, is 40', scoreAt(0, -0.97).pts, 40);
eq('right of centre is 6', scoreAt(0.4, 0).num, 6);
eq('straight down is 3', scoreAt(0, 0.4).num, 3);
eq('left of centre is 11', scoreAt(-0.4, 0).num, 11);
eq('the black frame scores nothing', scoreAt(0, -1.1), { pts: 0, num: 0, mult: 0, ring: 'frame' });
eq('off the board scores nothing', scoreAt(0, -2).ring, 'off');
let allTargets = true, bad = '';
for (const n of ORDER) for (const ring of ['single', 'treble', 'double']) {
  const p = targetPoint(n, ring);
  const h = scoreAt(p.x, p.y);
  const want = n * (ring === 'treble' ? 3 : ring === 'double' ? 2 : 1);
  if (h.pts !== want || h.ring !== ring) { allTargets = false; bad = `${ring} ${n} -> ${JSON.stringify(h)}`; }
}
ok('every single, treble and double target scores its own value', allTargets, bad);
// Wedge edges: 9 degrees either side of straight up is still the 20.
const edge = (deg, r) => scoreAt(Math.sin(deg * Math.PI / 180) * r, -Math.cos(deg * Math.PI / 180) * r).num;
eq('8.9 degrees right is still 20', edge(8.9, 0.4), 20);
eq('9.1 degrees right is the 1', edge(9.1, 0.4), 1);
eq('9.1 degrees left is the 5', edge(-9.1, 0.4), 5);

// 2. The match.
{
  const m = newMatch(0);
  eq('starts at 301 each', m.scores, [301, 301]);
  const t20 = targetPoint(20, 'treble');
  eq('first dart scores', throwDart(m, t20.x, t20.y).event, 'score');
  eq('score drops by 60', m.scores[0], 241);
  throwDart(m, t20.x, t20.y);
  eq('third dart ends the turn', throwDart(m, t20.x, t20.y).event, 'end');
  eq('three trebles: 121 left', m.scores[0], 121);
  nextTurn(m);
  eq('turn passes to seat 1', [m.turn, m.darts.length, m.turnStart], [1, 0, 301]);
}
{
  const m = newMatch(1);
  eq('seat 1 can start', m.turn, 1);
  m.scores[1] = 30; m.turnStart = 30;
  const s20 = targetPoint(20, 'single');
  throwDart(m, s20.x, s20.y);
  eq('10 left after a 20', m.scores[1], 10);
  const r = throwDart(m, s20.x, s20.y);
  eq('going below zero is a bust', r.event, 'bust');
  eq('a bust puts the score back to the start of the turn', m.scores[1], 30);
}
{
  const m = newMatch(0);
  m.scores[0] = 40; m.turnStart = 40;
  const d20 = targetPoint(20, 'double');
  const r = throwDart(m, d20.x, d20.y);
  eq('exactly zero wins', [r.event, m.winner, m.scores[0]], ['win', 0, 0]);
  eq('no more darts after a win', throwDart(m, 0, 0).event, 'over');
}
{
  const m = newMatch(0);
  m.scores[0] = 7; m.turnStart = 7;
  const s7 = targetPoint(7, 'single');
  eq('no double-out: a single can finish', throwDart(m, s7.x, s7.y).event, 'win');
}
ok('validMatch accepts a fresh match', !!validMatch(newMatch(0)));
ok('validMatch refuses junk', !validMatch({ scores: [1] }) && !validMatch(null) && !validMatch({ ...newMatch(0), turn: 2 }));

// 3. The computer.
eq('20 left: single 20', chooseTarget(20, 'hard'), { num: 20, ring: 'single' });
eq('40 left: double 20', chooseTarget(40, 'hard'), { num: 20, ring: 'double' });
eq('57 left: treble 19', chooseTarget(57, 'hard'), { num: 19, ring: 'treble' });
eq('50 left: bullseye', chooseTarget(50, 'medium'), { num: 25, ring: 'bull' });
eq('301 left: treble 20', chooseTarget(301, 'hard'), { num: 20, ring: 'treble' });
const lf = chooseTarget(59, 'hard');
ok('59 left: a single that leaves a one-dart finish', lf.ring === 'single' && 59 - lf.num <= 40, JSON.stringify(lf));
// Exact finishes always score exactly what is left.
let finishes = true;
for (let left = 1; left <= 60; left++) {
  const tg = chooseTarget(left, 'hard');
  const p = targetPoint(tg.num, tg.ring);
  const h = scoreAt(p.x, p.y);
  if (h.pts > left) { finishes = false; bad = `${left} -> ${JSON.stringify(tg)} scores ${h.pts}`; }
}
ok('the computer never aims at more than it has left', finishes, bad);
// A seeded generator, so the averages below are stable.
function rng(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
const avg = (diff) => {
  const r = rng(7); let tot = 0;
  for (let i = 0; i < 4000; i++) { const p = computerThrow(301, diff, r); tot += scoreAt(p.x, p.y).pts; }
  return tot / 4000;
};
const ae = avg('easy'), am = avg('medium'), ah = avg('hard');
ok(`harder computers score more per dart (easy ${ae.toFixed(1)}, medium ${am.toFixed(1)}, hard ${ah.toFixed(1)})`, ae < am && am < ah);
ok('hard averages a strong pub player (18-35 a dart)', ah > 18 && ah < 35, ah.toFixed(1));
// Whole games finish in a sensible number of turns.
const turnsToWin = (diff, seed) => {
  const r = rng(seed); const m = newMatch(0);
  let n = 0;
  while (m.winner == null && n < 400) {
    const p = computerThrow(m.scores[m.turn], diff, r);
    const ev = throwDart(m, p.x, p.y).event;
    if (ev === 'end' || ev === 'bust') { nextTurn(m); n++; }
  }
  return n;
};
let ht = 0; for (let s = 1; s <= 30; s++) ht += turnsToWin('hard', s);
ok('hard vs hard: a 301 game ends in a reasonable number of turns', ht / 30 < 30, (ht / 30).toFixed(1));
ok('spread is tighter on harder levels', SPREAD.hard < SPREAD.medium && SPREAD.medium < SPREAD.easy);

// 4. The flick.
eq('too slow is not a throw', flickLanding(0, 1.6, 0, -100, 0.3), null);
eq('a downward drag is not a throw', flickLanding(0, 1.6, 0, 100, 2), null);
const mid = flickLanding(0, 1.6, 0, -500, FLICK_MID);
ok('a mid-speed straight flick lands on the bull', Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9, JSON.stringify(mid));
ok('a faster flick lands higher', flickLanding(0, 1.6, 0, -500, FLICK_MID * 1.3).y < -0.3);
ok('a slower flick lands lower', flickLanding(0, 1.6, 0, -500, FLICK_MID * 0.8).y > 0.3);
ok('flicking to the right aims right', flickLanding(0, 1.6, 100, -500, FLICK_MID).x > 0.2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
