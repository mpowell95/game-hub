// archery/js/test.js - headless checks for Archery's rules (engine.js).  node archery/js/test.js
import { scoreAt, windFor, driftOf, newMatch, shoot, totals, validMatch, shotOrder, drainGauge, GAUGE,
  swayAt, panicPoint, landing, cpuShot, mulberry32, hashStr, WIND_RANGES, stageScore, arrowsFor, ROUNDS,
  round4, newHand, stepHand } from './engine.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// 1. scoring
ok('the middle is 10', scoreAt(0, 0) === 10);
ok('a line-cutter on the 10 line is 10', scoreAt(0.1, 0) === 10);
ok('just outside it is 9', scoreAt(0.1001, 0) === 9);
ok('0.55 out is 5', scoreAt(0, 0.55) === 5);
ok('0.5 exactly (on the line) is 6', scoreAt(0.5, 0) === 6);
ok('the outer white is 1', scoreAt(0.99, 0) === 1);
ok('the outside line counts 1', scoreAt(1, 0) === 1);
ok('off the face is 0', scoreAt(1.0001, 0) === 0 && scoreAt(0, 3) === 0);
for (let r = 1; r <= 10; r++) {
  const d = (10 - r) / 10 + 0.05;
  if (!ok(`ring ${r} scores ${r}`, scoreAt(d, 0) === r)) break;
}

// 2. wind: same seed, same wind; harder each round; in range
const seed = hashStr('matchid0001');
ok('the wind is the same on both phones', JSON.stringify(windFor(seed, 1)) === JSON.stringify(windFor(seed, 1)));
let inRange = true, rising = 0, n = 0;
for (let s = 0; s < 400; s++) {
  const w = [0, 1, 2, 3, 4].map((st) => windFor(hashStr('m' + s), st));
  w.forEach((x, st) => { const r = WIND_RANGES[Math.min(st, 2)]; if (x.mph < r[0] - 1e-9 || x.mph > r[1] + 1e-9 || x.dir < 0 || x.dir > 7) inRange = false; });
  if (w[0].mph <= w[1].mph && w[1].mph <= w[2].mph) rising++;
  n++;
}
ok('every wind is in its round\'s range, dir 0-7', inRange);
ok('the wind never drops from round to round', rising === n, `${rising}/${n}`);
ok('wind varies per round', windFor(seed, 0).mph !== windFor(seed, 1).mph);
const d = driftOf({ mph: 3, dir: 4 });
ok('a 3 mph wind to the left drifts about 0.27 left', Math.abs(d.x + 0.27) < 1e-9 && Math.abs(d.y) < 1e-9);
ok('dir 2 blows up', driftOf({ mph: 1, dir: 2 }).y > 0.08);

// 3. a whole match, the starter first every round
let m = newMatch(seed, 1);
ok('the starter shoots first', m.turn === 1);
let ev = [];
const bull = [0, 0], seven = [0.35, 0];
for (let st = 0; st < 3; st++) {
  for (let i = 0; i < 3; i++) ev.push(shoot(m, ...bull).event);       // starter (seat 1): 10s
  for (let i = 0; i < 3; i++) ev.push(shoot(m, ...seven).event);      // seat 0: 7s
}
ok('events: arrow, arrow, turn, then arrow, arrow, round', ev.slice(0, 6).join() === 'arrow,arrow,turn,arrow,arrow,round');
ok('the starter shoots first again in round 2', ev[6] === 'arrow' && m.stage === 2 || m.winner != null);
ok('the match ends after round 3 on the second player\'s last arrow', ev[17] === 'win' && m.winner === 1);
ok('totals', totals(m)[1] === 90 && totals(m)[0] === 63);
ok('a stage score', stageScore(m, 0, 1) === 21);
ok('no arrow after the end', shoot(m, 0, 0) === null);
ok('a finished match validates', validMatch(m));

// 4. a tie goes to a shoot-off: one arrow each, closest wins
m = newMatch(seed, 0);
for (let st = 0; st < 3; st++) for (let k = 0; k < 6; k++) shoot(m, 0.25, 0);
ok('level after 3 rounds: a shoot-off', m.winner == null && m.stage === 3 && m.turn === 0 && arrowsFor(m.stage) === 1);
ok('the starter shoots the first shoot-off arrow', shoot(m, 0.05, 0).event === 'turn');
ok('same score, closer to the middle wins', shoot(m, 0.08, 0).event === 'win' && m.winner === 0);
m = newMatch(seed, 0);
for (let st = 0; st < 3; st++) for (let k = 0; k < 6; k++) shoot(m, 0.25, 0);
shoot(m, 0, 0.3);
ok('exactly level again: another shoot-off', shoot(m, 0.3, 0).event === 'tie' && m.stage === 4);
ok('...and a higher score wins it', shoot(m, 0.95, 0) && shoot(m, 0.05, 0).event === 'win' && m.winner === 1);
ok('shoot-off arrows are not in the round totals', totals(m)[0] === 72 && totals(m)[1] === 72);
ok('a shoot-off match validates', validMatch(m));
ok('shotOrder replays in order', shotOrder(m).length === 22 && shotOrder(m)[0].seat === 0 && shotOrder(m)[3].seat === 1);

// 5. a tampered save does not validate
m = newMatch(seed, 0); shoot(m, 0, 0); shoot(m, 0, 0);
const bad = JSON.parse(JSON.stringify(m)); bad.inTurn = 0;
ok('a save that does not replay is refused', !validMatch(bad) && validMatch(m));

// 6. the ring
let g = 1;
g = drainGauge(g, 0.3, 0.3, 0);
ok('full for the first 0.4 s', g === 1);
g = 1; for (let t = 0.4; t < 3.4; t += 0.01) g = drainGauge(g, 0.01, t + 0.01, 0);
ok('held still for 3 s it loses about 0.3', Math.abs(g - 0.7) < 0.02, g);
g = 1; for (let t = 0.4; t < 3.4; t += 0.01) g = drainGauge(g, 0.01, t + 0.01, 1);
ok('moving for 3 s it loses about 0.9', Math.abs(g - 0.1) < 0.02, g);
g = 0.05; g = drainGauge(g, 1, 5, 1);
ok('it never goes below empty', g === 0);
ok('yellow below a third', GAUGE.yellow > 0.33 && GAUGE.yellow < 0.34);

// 7. sway grows as the ring drains
let a1 = 0, a2 = 0;
for (let t = 0; t < 20; t += 0.05) { const p = swayAt(t, 1), q = swayAt(t, 0); a1 = Math.max(a1, Math.hypot(p.x, p.y)); a2 = Math.max(a2, Math.hypot(q.x, q.y)); }
ok('a fresh hold sways a little (under half a ring)', a1 < 0.05 && a1 > 0.01, a1);
ok('an empty ring sways about a ring and a half', a2 > 0.1 && a2 < 0.2, a2);

// 8. panic goes over the target
const rnd = mulberry32(7);
let allOver = true;
for (let i = 0; i < 200; i++) { const p = panicPoint({ x: 0, y: 0 }, rnd); if (scoreAt(p.x, p.y) !== 0 || p.y < 2.5) allOver = false; }
ok('a panicked arrow always flies over the target and scores 0', allOver);

// 8b. the hand: the sight has weight (Matt, 2026-10-20)
const handMove = (dist, dur, hold = 2, h = newHand()) => {
  const dt = 1 / 60, n = Math.max(1, Math.round(dur / dt));
  let peak = 0, endX = 0;
  for (let i = 0; i < n; i++) { stepHand(h, dist / n, 0, dt); peak = Math.max(peak, h.x); }
  endX = h.x;
  for (let i = 0; i < hold * 60; i++) { stepHand(h, 0, 0, dt); peak = Math.max(peak, h.x); }
  return { h, peak, endX, rest: h.x };
};
const slow = handMove(0.3, 1);
ok('a slow, small move lands where the finger put it', Math.abs(slow.rest - 0.3) < 0.01 && slow.peak < 0.33, slow);
ok('the sight lags the finger a little', handMove(0.5, 0.5).endX < 0.45);
const jerk = handMove(1, 0.1);
ok('a jerk overshoots and keeps floating that way', jerk.rest > 1.3 && jerk.rest < 1.8, jerk.rest);
const fixH = handMove(1, 0.1, 0.2).h, driftBefore = Math.hypot(fixH.dx, fixH.dy);
handMove(-0.4, 0.8, 0, fixH);
ok('a slow move back stops the floating', driftBefore > 0.1 && Math.hypot(fixH.dx, fixH.dy) < 0.01, [driftBefore, fixH.dx]);
const big = handMove(30, 0.05);
ok('it never leaves the range', big.rest <= 3 && big.peak <= 3);
const lazy = newHand({ x: 0.2, y: -0.1 }); stepHand(lazy, 0, 0, 0.05);
ok('a long frame does not blow it up', Math.abs(lazy.x - 0.2) < 1e-9 && Math.abs(lazy.y + 0.1) < 1e-9);

// 9. the wind moves a shot, and the landing point is kept to 1/10000
const L = landing({ x: 0.27, y: 0 }, { mph: 3, dir: 4 });
ok('aiming into the wind lands in the middle', scoreAt(L.x, L.y) === 10 && L.x === 0);
ok('rounding', round4(0.123456) === 0.1235);

// 10. the computer: averages per arrow by level (seeded)
const avg = (diff) => {
  const r = mulberry32(42); let sum = 0, k = 0;
  for (let s = 0; s < 300; s++) {
    const mm = newMatch(hashStr('cpu' + s), 0);
    for (let st = 0; st < 3; st++) { mm.stage = st; for (let i = 0; i < 3; i++) { const p = cpuShot(mm, diff, r); sum += scoreAt(p.x, p.y); k++; } }
  }
  return sum / k;
};
const e = avg('easy'), me = avg('medium'), h = avg('hard');
console.log(`     computer per arrow: easy ${e.toFixed(2)}, medium ${me.toFixed(2)}, hard ${h.toFixed(2)}`);
ok('easy < medium < hard', e < me && me < h);
ok('easy is beatable (under 6.5)', e < 6.5);
ok('hard is strong but not perfect (8 to 9.3)', h > 8 && h < 9.3);
ok('rounds constant', ROUNDS === 3);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
