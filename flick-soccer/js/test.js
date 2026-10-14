// flick-soccer/js/test.js - headless checks. Run: node flick-soccer/js/test.js
//
// The physics stays inside the pitch and stops; the rules count goals (own goals too) and kick off
// the right side; a computer plays a whole match; harder computers beat easier ones; and a shot
// plays out the same way every time (the computer's simulations are only worth anything if so).
import * as E from './engine.js';
import { plan, rngFrom } from './ai.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL', label, extra); } };

// --- physics -------------------------------------------------------------------------------------
{
  // Thousands of random flicks from the kick-off: nothing leaves the pitch (bar the ball into a goal),
  // nothing overlaps once at rest, every shot ends.
  const rng = rngFrom(7);
  let shots = 0, worstSteps = 0, goals = 0;
  for (let k = 0; k < 600; k++) {
    const m = E.newMatch(3, k & 1);
    for (let s = 0; s < 6 && m.winner == null; s++) {
      const discs = E.discsOf(m.turn);
      const i = discs[Math.floor(rng() * discs.length)];
      const a = rng() * Math.PI * 2;
      E.flick(m.b, i, Math.cos(a), Math.sin(a), 0.2 + rng() * 0.8);
      const r = E.runToRest(m.b);
      shots++; worstSteps = Math.max(worstSteps, r.steps);
      if (r.scorer >= 0) goals++;
      for (let j = 0; j < m.b.length; j++) {
        const o = m.b[j];
        const inGoal = j === E.BALL && o.x > E.GX0 && o.x < E.GX1;
        ok('inside sideways', o.x >= -0.01 + o.r - 0.6 && o.x <= E.W - o.r + 0.6, `${o.x}`);
        ok('inside lengthways', inGoal || (o.y >= o.r - 0.6 && o.y <= E.H - o.r + 0.6), `body ${j} y ${o.y}`);
        if (j !== E.BALL) ok('no disc in a goal', o.y > -0.6 && o.y < E.H + 0.6, `y ${o.y}`);
      }
      if (r.scorer < 0) {
        ok('at rest', E.atRest(m.b));
        for (let p = 0; p < m.b.length; p++) for (let q = p + 1; q < m.b.length; q++) {
          const d = Math.hypot(m.b[p].x - m.b[q].x, m.b[p].y - m.b[q].y);
          ok('no overlap at rest', d > m.b[p].r + m.b[q].r - 0.75, `${p}-${q} ${d.toFixed(2)}`);
        }
      }
      E.settle(m, r.scorer);
    }
  }
  console.log(`physics: ${shots} random shots, ${goals} goals, longest shot ${(worstSteps * E.DT).toFixed(2)} s`);
  ok('a shot always ends', worstSteps <= E.maxShotSteps());
}

// --- determinism ---------------------------------------------------------------------------------
{
  const a = E.newMatch(2, 0), b = E.newMatch(2, 0);
  E.flick(a.b, 4, 0.3, -1, 0.93); E.flick(b.b, 4, 0.3, -1, 0.93);
  E.runToRest(a.b); E.runToRest(b.b);
  ok('same shot, same result', JSON.stringify(a.b) === JSON.stringify(b.b));
}

// --- rules ---------------------------------------------------------------------------------------
{
  const m = E.newMatch(2, 0);
  ok('starter kicks off', m.turn === 0);
  ok('turn passes', E.settle(m, -1) === 'turn' && m.turn === 1);
  // Seat 1 knocks it into its OWN goal (the top one, which seat 0 attacks): seat 0 scores.
  ok('own goal counts for the other side', E.settle(m, 0) === 'goal' && m.scores[0] === 1 && m.scores[1] === 0);
  ok('conceding side kicks off', m.turn === 1);
  ok('line-up after a goal', m.b[E.BALL].x === E.W / 2 && m.b[E.BALL].y === E.H / 2);
  ok('first to the target wins', E.settle(m, 0) === 'win' && m.winner === 0);
  ok('saved shape is valid', E.validMatch(JSON.parse(JSON.stringify(E.newMatch(3, 1)))));
  ok('junk is not', !E.validMatch({ v: 1, b: [] }) && !E.validMatch(null));
  // Line-ups (2026-10-11): every one legal, mirrored, kept after a goal, and old saves read balanced.
  for (const f of E.FORM_IDS) {
    const L = E.lineUp([f, f]);
    let clear = true;
    for (let i = 1; i < L.length; i++) {
      const o = L[i];
      if (o.x < o.r || o.x > E.W - o.r || Math.hypot(o.x - E.W / 2, o.y - E.H / 2) < 20) clear = false;
      if (E.teamOf(i) === 0 ? o.y <= E.H / 2 : o.y >= E.H / 2) clear = false;
      for (let j = i + 1; j < L.length; j++) if (Math.hypot(o.x - L[j].x, o.y - L[j].y) < 2 * E.DISC_R + 1) clear = false;
    }
    ok(`line-up ${f}: in its own half, clear of the centre and of each other`, clear);
  }
  {
    const m2 = E.newMatch(3, 0, ['attack', 'defend']);
    ok('each side gets its own line-up', m2.b[4].y === E.FORMATIONS.attack[3][1] && m2.b[9].y === E.H - E.FORMATIONS.defend[3][1]);
    E.settle(m2, 0);
    ok('...and lines up the same way after a goal', m2.b[4].y === E.FORMATIONS.attack[3][1] && m2.b[9].y === E.H - E.FORMATIONS.defend[3][1]);
    const old = E.newMatch(2, 0); delete old.forms;
    ok('a match saved before line-ups lines up balanced', E.validMatch(old) && (E.settle(old, 1), old.b[4].y === E.FORMATIONS.balanced[3][1]));
    ok('an unknown line-up reads as balanced', E.cleanForms(['constructor', 'nope']).join() === 'balanced,balanced');
  }
  // Offense and defense line-ups (2026-10-14): whoever kicks off stands in their offense line-up.
  {
    const y = (m, i) => m.b[i].y;
    const off = (f, k) => E.FORMATIONS[f][k][1], top = (f, k) => E.H - E.FORMATIONS[f][k][1];
    const m = E.newMatch(3, 1, null, [['attack', 'defend'], ['diamond', 'balanced']]);
    ok('kick-off: the kicker in its offense line-up, the other side in its defense one',
      m.forms.join() === 'defend,diamond' && y(m, 4) === off('defend', 3) && y(m, 9) === top('diamond', 3));
    E.settle(m, 1);   // seat 1 scores: seat 0 kicks off now
    ok('after a goal the side that conceded kicks off in ITS offense line-up',
      m.turn === 0 && m.forms.join() === 'attack,balanced' && y(m, 4) === off('attack', 3) && y(m, 9) === top('balanced', 3));
    E.settle(m, 0);
    ok('...and back again', m.turn === 1 && m.forms.join() === 'defend,diamond');
    const saved = JSON.parse(JSON.stringify(m));
    E.settle(saved, 1);
    ok('a saved match keeps its offense and defense line-ups', saved.forms.join() === 'attack,balanced' && E.validMatch(saved));
    ok('no line-up pairs: the fixed line-ups, as every match before', !('lineups' in E.newMatch(2, 0, ['attack', 'defend'])) && E.cleanLineups(['attack', 'defend']) === null);
  }
  // A ball that STOPS more than halfway into the net is a goal (2026-10-11).
  {
    const L = E.lineUp();
    L[E.BALL].x = 50; L[E.BALL].y = -1; L[E.BALL].vx = 0; L[E.BALL].vy = 0;
    for (let i = 1; i < L.length; i++) { L[i].vx = 0; L[i].vy = 0; }
    ok('a ball at rest with its centre over the line is a goal', E.runToRest(L).scorer === 0 && E.restScorer(L) === 0);
    L[E.BALL].y = 1;
    ok('one with its centre short of the line is not', E.runToRest(L).scorer === -1);
    L[E.BALL].y = E.H + 1;
    ok('the bottom net counts for the other side', E.runToRest(L).scorer === 1);
  }
  // Easy's bounce line: off the side wall, and it ends in a goal mouth when it gets there.
  {
    const L = E.lineUp();
    for (let i = 1; i < L.length; i++) { L[i].x = 4 + i * 8.5; L[i].y = 150; }   // all out of the way
    L[E.BALL].x = 50; L[E.BALL].y = 60;
    const st = E.ballPath(L, -1, { x: 50, y: 70 }, 200);
    ok('a straight bounce line ends in the goal', st.stop === 'goal' && st.pts[st.pts.length - 1].y === 0, JSON.stringify(st));
    const off = E.ballPath(L, -1, { x: 45, y: 65 }, 200, 2);
    ok('an angled one comes back off the wall', off.pts.length >= 3 && off.pts[1].x > 90, JSON.stringify(off));
  }
  // A ball rolled straight into the top goal is a goal for seat 0.
  const b = E.lineUp();
  for (let i = 1; i < b.length; i++) b[i].x = 5 + (i % 2) * 90;   // clear the middle
  b[E.BALL].x = E.W / 2; b[E.BALL].y = 30; b[E.BALL].vy = -200;
  ok('ball over the line is a goal', E.runToRest(b).scorer === 0);
  // A disc driven at the goal mouth stops at the line.
  const c = E.lineUp();
  c[E.BALL].x = 10; c[E.BALL].y = 80;
  c[4].x = E.W / 2; c[4].y = 30; c[4].vx = 0; c[4].vy = -240;
  for (let i = 1; i < c.length; i++) if (i !== 4) c[i].x = 5 + (i % 2) * 90;
  E.runToRest(c);
  ok('disc cannot enter the goal', c[4].y >= E.DISC_R - 0.6, `${c[4].y}`);
}

// --- the computer --------------------------------------------------------------------------------
function playMatch(diffs, seed, goals = 2) {
  const rng = rngFrom(seed);
  const m = E.newMatch(goals, seed & 1);
  let guard = 0, worstMs = 0;
  while (m.winner == null && guard++ < 400) {
    const t0 = performance.now();
    const s = plan(m.b, m.turn, diffs[m.turn], rng);
    worstMs = Math.max(worstMs, performance.now() - t0);
    ok('plans its own disc', E.teamOf(s.i) === m.turn);
    E.flick(m.b, s.i, s.dx, s.dy, s.power);
    E.settle(m, E.runToRest(m.b).scorer);
  }
  return { m, guard, worstMs };
}
{
  // Hard against Easy, sides swapped half the time.
  let hardWins = 0, games = 0, turns = 0, worst = 0;
  for (let k = 0; k < 10; k++) {
    const hardSeat = k & 1;
    const diffs = hardSeat ? ['easy', 'hard'] : ['hard', 'easy'];
    const { m, guard, worstMs } = playMatch(diffs, 100 + k);
    ok('a match finishes', m.winner != null, `after ${guard} turns`);
    if (m.winner === hardSeat) hardWins++;
    games++; turns += guard; worst = Math.max(worst, worstMs);
  }
  console.log(`hard v easy: hard won ${hardWins}/${games}, ${(turns / games).toFixed(1)} turns a match, slowest plan ${worst.toFixed(0)} ms`);
  ok('hard beats easy most of the time', hardWins >= 7);
  let medWins = 0;
  for (let k = 0; k < 10; k++) {
    const medSeat = k & 1;
    const { m } = playMatch(medSeat ? ['easy', 'medium'] : ['medium', 'easy'], 300 + k);
    if (m.winner === medSeat) medWins++;
  }
  console.log(`medium v easy: medium won ${medWins}/10`);
  ok('medium beats easy more often than not', medWins >= 6);
}

console.log(fails ? `${fails} FAILED` : 'flick-soccer: all checks passed');
process.exit(fails ? 1 : 0);
