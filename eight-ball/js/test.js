// eight-ball/js/test.js - headless checks for Pool's engine and computer. Not deployed, not precached.
//   node eight-ball/js/test.js
// Random shots stay on the table, never leave two balls overlapping at rest, always end; a shot
// replays identically; the rules (fouls, groups, going again, the 8, racks); whole computer-vs-
// computer matches finish and the stronger level wins.

import * as E from './engine.js';
import { plan, rngFrom } from './ai.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// --- physics ------------------------------------------------------------------------------------
{
  const rnd = rngFrom(4242);
  let escaped = 0, overlaps = 0, endless = 0;
  for (let n = 0; n < 1500; n++) {
    const m = E.newMatch(1, 0, 1 + n);
    if (n % 2) { E.play(m, { dx: (rnd() - 0.5) * 0.2, dy: -1, p: 1 }); if (m.winner != null) continue; }
    const a = rnd() * Math.PI * 2;
    const ev = E.begin(m, { dx: Math.cos(a), dy: Math.sin(a), p: 0.2 + rnd() * 0.8, s: rnd() * 2 - 1 });
    const steps = E.runToRest(m.b, ev);
    E.settle(m, ev);
    if (steps >= E.maxShotSteps()) endless++;
    for (const o of m.b) if (o.on && (o.x < -0.01 || o.x > E.W + 0.01 || o.y < -0.01 || o.y > E.H + 0.01)) escaped++;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
      const p = m.b[i], q = m.b[j];
      if (p.on && q.on && Math.hypot(p.x - q.x, p.y - q.y) < 2 * E.R - 0.05) overlaps++;
    }
  }
  ok('1500 random shots: no ball leaves the table', escaped === 0, escaped);
  ok('...no two balls overlap at rest', overlaps === 0, overlaps);
  ok('...every shot comes to rest before the clock', endless === 0, endless);
}
{
  const shot = { dx: 0.013, dy: -1, p: 1, s: -0.2 };
  const a = E.newMatch(1, 0, 99), b = E.newMatch(1, 0, 99);
  E.play(a, shot); E.play(b, shot);
  ok('the same shot from the same table ends identically', JSON.stringify(a) === JSON.stringify(b));
}
{
  // A lone ball rolled straight at a corner pocket drops.
  const m = E.newMatch(1, 0, 3);
  for (let i = 1; i < 16; i++) m.b[i].on = false;
  m.b[5].on = true; m.b[5].x = 20; m.b[5].y = 20;
  m.b[0].x = 40; m.b[0].y = 40;
  m.broke = true; m.inHand = null; m.groups = ['a', 'b'];
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('a ball sent into a corner pocket drops, and the shooter goes again', r.kind === 'again' && !m.b[5].on && m.turn === 0, JSON.stringify(r));
}

// --- rules ----------------------------------------------------------------------------------------
const lone = (seat = 0, groups = ['a', 'b']) => {
  const m = E.newMatch(1, 0, 5);
  for (let i = 1; i < 16; i++) m.b[i].on = false;
  m.broke = true; m.inHand = null; m.groups = groups; m.turn = seat;
  return m;
};
{
  const m = lone();
  m.b[10].on = true; m.b[10].x = 50; m.b[10].y = 100;
  m.b[3].on = true; m.b[3].x = 20; m.b[3].y = 150;
  m.b[0].x = 50; m.b[0].y = 140;
  const r = E.play(m, { dx: 0, dy: -1, p: 0.4 });
  ok('hitting the other group first is a foul: ball in hand for the other player', r.kind === 'foul' && r.foul === 'wrong' && m.turn === 1 && m.inHand === 'any', JSON.stringify(r));
}
{
  const m = lone();
  m.b[3].on = true; m.b[3].x = 80; m.b[3].y = 40;
  m.b[0].x = 20; m.b[0].y = 160;
  const r = E.play(m, { dx: 0, dy: 1, p: 0.05 });
  ok('missing every ball is a foul', r.kind === 'foul' && r.foul === 'nohit', JSON.stringify(r));
}
{
  const m = lone();
  m.b[0].x = 4; m.b[0].y = 4.5;
  m.b[3].on = true; m.b[3].x = 60; m.b[3].y = 100;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.3 });
  ok('potting the cue ball is a foul, and it comes back on the table', r.kind === 'foul' && r.foul === 'scratch' && m.b[0].on, JSON.stringify(r));
}
{
  const m = lone(0, null);
  m.b[0].x = 40; m.b[0].y = 40;
  m.b[12].on = true; m.b[12].x = 20; m.b[12].y = 20;
  m.b[2].on = true; m.b[2].x = 60; m.b[2].y = 150;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('the first clean pot on an open table gives the shooter that group', r.kind === 'again' && m.groups && m.groups[0] === 'b' && m.groups[1] === 'a', JSON.stringify(m.groups));
}
{
  const m = lone();
  m.b[0].x = 40; m.b[0].y = 40;
  m.b[8].on = true; m.b[8].x = 20; m.b[8].y = 20;
  m.b[2].on = true; m.b[2].x = 60; m.b[2].y = 150;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('the 8 potted while your group is still up loses the rack', r.kind === 'win' && m.winner === 1, JSON.stringify(r));
}
{
  const m = lone();
  m.b[0].x = 40; m.b[0].y = 40;
  m.b[8].on = true; m.b[8].x = 20; m.b[8].y = 20;
  m.b[11].on = true; m.b[11].x = 60; m.b[11].y = 150;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('the 8 potted once your group is clear wins', r.kind === 'win' && m.winner === 0, JSON.stringify(r));
}
{
  const m = lone();
  m.racks = 2;
  m.b[0].x = 40; m.b[0].y = 40;
  m.b[8].on = true; m.b[8].x = 20; m.b[8].y = 20;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('first to 2: winning a rack is a rack, not the match', r.kind === 'rack' && m.scores[0] === 1 && m.winner == null, JSON.stringify(r));
  const brk = m.breaker;
  E.nextRack(m);
  ok('...the next rack is racked and the break passes', m.breaker === (brk ^ 1) && m.turn === m.breaker && m.b.every((o) => o.on) && !m.groups && m.inHand === 'kitchen');
}
{
  const m = E.newMatch(1, 0, 7);
  ok('the cue ball may go anywhere in the kitchen, not above the head string, never on a ball',
    E.canPlace(m.b, 30, 170, true) && !E.canPlace(m.b, 30, 100, true) && E.canPlace(m.b, 30, 100, false) && !E.canPlace(m.b, m.b[1].x, m.b[1].y + 1, false));
  ok('a shot placed somewhere illegal is refused', E.begin(m, { x: 30, y: 100, dx: 0, dy: -1, p: 0.5 }) === null);
}

// --- the computer -------------------------------------------------------------------------------
function match(d0, d1, seed) {
  const m = E.newMatch(1, seed & 1, 1000 + seed);
  const rng = rngFrom(77 + seed);
  while (m.winner == null && m.shots < 300) {
    const r = E.play(m, plan(m, m.turn, m.turn === 0 ? d0 : d1, rng));
    if (!r) return null;
    if (r.kind === 'rack') E.nextRack(m);
  }
  return m;
}
{
  let finished = 0, hardWins = 0;
  for (let g = 0; g < 8; g++) {
    const m = match('hard', 'easy', g);
    if (m && m.winner != null) { finished++; if (m.winner === 0) hardWins++; }
  }
  ok('computer vs computer: every match finishes', finished === 8, finished);
  ok('...and Hard beats Easy most of the time', hardWins >= 6, hardWins);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
