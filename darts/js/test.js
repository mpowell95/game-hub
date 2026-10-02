// darts/js/test.js - headless tests for the rules: scoring geometry, the 301 match (bust, win,
// turn hand-over), the computer's targets, and the flick mapping. No DOM, no browser.
//
//   node darts/js/test.js
//
// Not deployed (not in sw.js ASSETS); run by run-all-tests.mjs as a plain node script.
import {
  ORDER, RING, scoreAt, targetPoint, newMatch, throwDart, nextTurn, validMatch,
  chooseTarget, computerThrow, flickLanding, FLICK_MID, SPREAD,
  CRICKET, cricketNext, chooseCricketTarget, bedLabel, KINDS,
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

// 3b. 201 and 101 (2026-10-01): the same game from a lower start.
{
  const m2 = newMatch(0, '201'), m1 = newMatch(1, '101');
  ok('201 starts both players on 201', m2.scores[0] === 201 && m2.scores[1] === 201 && m2.kind === '201');
  ok('101 starts both on 101, and the right seat throws', m1.scores.join() === '101,101' && m1.turn === 1);
  const m = newMatch(0, '101');
  throwDart(m, 0, -0.6); throwDart(m, 0, 0.4);        // treble 20 + 3 = 63, 38 left
  ok('101: 38 left after T20 and 3', m.scores[0] === 38);
  const ev = throwDart(m, 0, -0.97).event;            // double 20 = 40: over, bust
  ok('101: going under zero busts back to 101', ev === 'bust' && m.scores[0] === 101);
  ok('an old save with no kind is read as 301', validMatch({ ...newMatch(0), kind: undefined }).kind === '301');
  ok('every game makes a valid match', KINDS.every((k) => !!validMatch(newMatch(0, k))));
}

// 3c. Cricket.
{
  const T = (num, ring) => targetPoint(num, ring);
  const hitAt = (m, num, ring) => { const p = T(num, ring); return throwDart(m, p.x, p.y); };
  const m = newMatch(0, 'cricket');
  ok('cricket starts on 0 points, nothing marked', m.scores.join() === '0,0' && m.marks.every((a) => a.every((n) => n === 0)));
  let r = hitAt(m, 20, 'treble');
  ok('a treble 20 closes 20 in one dart', m.marks[0][0] === 3 && r.hit.marks === 3 && r.hit.pts === 0);
  r = hitAt(m, 20, 'double');
  ok('marks past the third score the number while the other side has it open (D20 = 40)', m.scores[0] === 40 && r.hit.pts === 40);
  r = hitAt(m, 7, 'treble');
  ok('a number outside 15-20 counts for nothing', r.hit.marks === 0 && r.hit.pts === 0 && !r.hit.counted && r.event === 'end');
  nextTurn(m);
  hitAt(m, 20, 'treble');
  ok('closing it stops the other side scoring on it', m.marks[1][0] === 3);
  nextTurn(m);
  r = hitAt(m, 20, 'treble');
  ok('a number closed by both scores nothing', r.hit.pts === 0 && m.scores[0] === 40);
  r = hitAt(m, 25, 'bull');
  ok('the inner bull is two marks, the outer bull one', m.marks[0][6] === 2 && (hitAt(m, 25, 'obull'), m.marks[0][6] === 3));

  // Win: everything closed with at least as many points.
  const w = newMatch(0, 'cricket');
  w.marks[0] = [3, 3, 3, 3, 3, 3, 2]; w.scores = [10, 0];
  r = hitAt(w, 25, 'obull');
  ok('closing the last number while ahead wins', r.event === 'win' && w.winner === 0);
  const b = newMatch(0, 'cricket');
  b.marks[0] = [3, 3, 3, 3, 3, 3, 2]; b.scores = [0, 60];
  r = hitAt(b, 25, 'obull');
  ok('closing everything while behind does not win: keep scoring', r.event !== 'win' && b.winner == null);

  // In order.
  const o = newMatch(0, 'cricket-order');
  r = hitAt(o, 19, 'treble');
  ok('in order: 19 counts for nothing while 20 is open', r.hit.marks === 0 && o.marks[0][1] === 0);
  hitAt(o, 20, 'treble');
  ok('in order: after 20 closes, 19 is next', cricketNext(o, 0) === 1);
  r = hitAt(o, 19, 'single');
  ok('in order: now 19 takes marks', o.marks[0][1] === 1);
  ok('in order: the bull is last', CRICKET[6] === 25);
  const o2 = newMatch(0, 'cricket-order'); o2.marks[0] = [3, 0, 0, 0, 0, 0, 0];
  r = hitAt(o2, 20, 'treble');
  ok('in order: a number already closed still scores', r.hit.pts === 60);

  // The computer.
  eq('cricket computer, fresh: treble 20', chooseCricketTarget(newMatch(0, 'cricket'), 'hard'), { num: 20, ring: 'treble' });
  const c = newMatch(0, 'cricket'); c.marks[0] = [3, 0, 0, 0, 0, 0, 0]; c.scores = [0, 30];
  eq('cricket computer, behind with 20 to score on: treble 20', chooseCricketTarget(c, 'hard'), { num: 20, ring: 'treble' });
  c.scores = [30, 0];
  eq('cricket computer, ahead: close 19 next', chooseCricketTarget(c, 'hard'), { num: 19, ring: 'treble' });
  const co = newMatch(0, 'cricket-order'); co.marks[0] = [3, 3, 3, 3, 3, 3, 0];
  eq('in order, everything else closed: the bull', chooseCricketTarget(co, 'medium'), { num: 25, ring: 'bull' });
  eq('bed labels', ['treble', 'double', 'single', 'bull', 'obull'].map((ring) => bedLabel({ ring, num: 20 })), ['T20', 'D20', '20', 'BULL', '25']);
  // How many Cricket marks a computer makes in a turn (marks per round), aiming at 19.
  const mpr = (diff) => {
    const r3 = rng(11); let marks = 0;
    for (let i = 0; i < 6000; i++) {
      const g = newMatch(0, 'cricket'); g.marks[0] = [3, 0, 0, 0, 0, 0, 0];
      const p = computerThrow(g, diff, r3), h = scoreAt(p.x, p.y);
      if (h.num === 19) marks += h.mult;
    }
    return 3 * marks / 6000;
  };
  const me = mpr('easy'), mm = mpr('medium'), mh = mpr('hard');
  ok(`cricket marks a turn: easy ${me.toFixed(2)}, medium ${mm.toFixed(2)}, hard ${mh.toFixed(2)}`, me < mm && mm < mh);
  ok('medium is an ordinary player in Cricket, about one mark a turn (Matt, 2026-10-02: it "basically didn\'t miss" at 1.5)', mm > 0.8 && mm < 1.25, mm.toFixed(2));
  for (const kind of ['cricket', 'cricket-order']) {
    for (const diff of ['easy', 'hard']) {
      let turns = 0, done = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const r2 = rng(seed); const g = newMatch(0, kind); let n = 0;
        while (g.winner == null && n < 600) {
          const p = computerThrow(g, diff, r2);
          if (throwDart(g, p.x, p.y).event === 'end') { nextTurn(g); n++; }
        }
        if (g.winner != null) done++;
        turns += n;
      }
      ok(`${kind}, ${diff} vs ${diff}: every game finishes (avg ${(turns / 20).toFixed(0)} turns)`, done === 20 && turns / 20 < (diff === 'easy' ? 200 : 40));
    }
  }
}

// 4. The flick.
eq('too slow is not a throw', flickLanding(0, 1.6, 0, -100, 0.3), null);
eq('a downward drag is not a throw', flickLanding(0, 1.6, 0, 100, 2), null);
const mid = flickLanding(0, 1.6, 0, -500, FLICK_MID);
ok('a mid-speed straight flick lands on the bull', Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9, JSON.stringify(mid));
ok('a faster flick lands higher', flickLanding(0, 1.6, 0, -500, FLICK_MID * 1.3).y < -0.3);
ok('a slower flick lands lower', flickLanding(0, 1.6, 0, -500, FLICK_MID * 0.8).y > 0.3);
ok('flicking to the right aims right', flickLanding(0, 1.6, 100, -500, FLICK_MID).x > 0.2);

// 5. The 3D throw (flight.js): it lands exactly where the rules said, the way GamePigeon's does.
{
  const F = await import('./flight.js');
  const cam = F.makeCamera(195, 285, 147);
  const hand = { x: 195, y: 560 };
  const from = F.unproject(cam, hand.x, hand.y, F.HAND_Z);
  const back = F.project(cam, from);
  ok('unproject and project are inverses', Math.abs(back.x - hand.x) < 1e-6 && Math.abs(back.y - hand.y) < 1e-6);
  const bull = F.project(cam, F.boardPoint(0, 0)), edge = F.project(cam, F.boardPoint(1, 0));
  ok('the camera draws the board where it is drawn (bull at centre, R px to the double)', Math.abs(bull.x - 195) < 1e-6 && Math.abs(edge.x - 195 - 147) < 1e-6);
  let lands = true;
  for (const [bx, by] of [[0, 0], [0, -0.6], [0.8, 0.3], [-1.1, 0.9], [0, -2]]) {
    const fl = F.makeFlight(from, bx, by);
    const end = F.project(cam, F.at(fl, fl.T).tip);
    const want = F.project(cam, F.boardPoint(bx, by));
    if (Math.hypot(end.x - want.x, end.y - want.y) > 1e-6) lands = false;
  }
  ok('every flight ends exactly on its landing point', lands);
  const fl = F.makeFlight(from, 0, 0);
  // GamePigeon's two halves: a climb to a point above the target, then a settle straight down onto it.
  const ys = [];
  for (let i = 0; i <= 60; i++) ys.push(F.project(cam, F.at(fl, fl.T * i / 60).tip).y);
  const top = Math.min(...ys), topAt = ys.indexOf(top) / 60;
  const want = 285 - (F.APEX + F.APEX_SLOPE * 0.45) * 147;
  ok('it climbs to just above its target (GamePigeon: a third of a radius above the bull)', Math.abs(top - want) < 2, top.toFixed(1));
  ok('the climb ends about 60% of the way through the flight', Math.abs(topAt - F.CLIMB) < 0.05, String(topAt));
  let mono = true;
  for (let i = 1; i < ys.length; i++) if (i / 60 <= F.CLIMB ? ys[i] > ys[i - 1] + 1e-9 : ys[i] < ys[i - 1] - 1e-9) mono = false;
  ok('up the screen while it climbs, only down while it settles (no jump, no reversal)', mono);
  {
    const hi = F.makeFlight(from, 0, -0.95), lo = F.makeFlight(from, 0, 0.9);
    const peak = (f) => { let m = Infinity; for (let i = 0; i <= 60; i++) m = Math.min(m, F.project(cam, F.at(f, f.T * i / 60).tip).y); return m; };
    const above = (f, by) => (285 + by * 147) - peak(f);
    ok('aimed high it climbs less above its target than aimed low (as in the video)', above(hi, -0.95) < above(lo, 0.9) && above(hi, -0.95) > 0.1 * 147, above(hi, -0.95).toFixed(1) + ' / ' + above(lo, 0.9).toFixed(1));
    ok('aimed at the top double it stays on screen', peak(hi) > 0);
  }
  const arrive = F.at(fl, fl.T).axis;
  const deg = Math.atan2(arrive[1], arrive[2]) * 180 / Math.PI;
  ok('it arrives pointing into the board, nose a little down (STUCK_AXIS)', arrive[2] > 0.9 && deg > 0 && deg < 25, deg.toFixed(1));
  const Lr = F.solveLength(cam, hand.x, hand.y, 180);
  const len = (k) => { const a = F.at(fl, fl.T * k), p = F.pose(cam, a.tip, a.axis, Lr); return { up: p.tail.y - p.tip.y, side: Math.abs(p.tail.x - p.tip.x) }; };
  ok('a sixth of the way it is still upright on screen, not end-on', len(1 / 6).up > 40, String(len(1 / 6).up));
  ok('it is end-on (a stub) by the end of the turn', Math.hypot(len(F.TURN).up, len(F.TURN).side) < 25, JSON.stringify(len(F.TURN)));
  let sideways = 0;
  for (let i = 0; i <= 40; i++) sideways = Math.max(sideways, len(i / 40).side);
  ok('it never turns sideways on screen (the old "big X" frame)', sideways < 1e-6, String(sideways));
  {
    // Off-centre: perspective leans it a little toward the middle, never flat.
    const side = F.makeFlight(from, -0.7, -0.2);
    let worst = 0;
    for (let i = 0; i <= 20; i++) {
      const a = F.at(side, side.T * i / 20 * F.TURN), p = F.pose(cam, a.tip, a.axis, Lr);
      const dx = Math.abs(p.tail.x - p.tip.x), dy = Math.abs(p.tail.y - p.tip.y);
      if (dy > 8) worst = Math.max(worst, dx / dy);
    }
    ok('an off-centre dart stays upright while it turns (leans less than 45 degrees)', worst < 1, worst.toFixed(2));
  }
  const sp = (a, b) => { const p = F.project(cam, F.at(fl, a).tip), q = F.project(cam, F.at(fl, b).tip); return Math.hypot(p.x - q.x, p.y - q.y); };
  ok('fast off the hand, slowing as it climbs', sp(0, fl.T * 0.1) > 3 * sp(fl.T * 0.5, fl.T * 0.6));
  const L = F.solveLength(cam, hand.x, hand.y, 180);
  const rest = F.pose(cam, from, F.REST_AXIS, L);
  ok('in the hand the dart points UP the screen and is the size asked for',
    rest.tail.y > rest.tip.y && Math.abs(Math.hypot(rest.tip.x - rest.tail.x, rest.tip.y - rest.tail.y) - 180) < 0.5);
  const stuck = F.pose(cam, F.boardPoint(0, 0), F.stuckAxis(), L);
  ok('stuck in the board it shrinks to a stub (flights end-on)', Math.hypot(stuck.tip.x - stuck.tail.x, stuck.tip.y - stuck.tail.y) < 40);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
