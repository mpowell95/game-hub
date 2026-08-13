// skeeball/js/test.js - headless engine tests (wired into run-all-tests.mjs). No DOM, no
// storage: physics.js, game.js and boards.js are pure, and everything here drives them the way
// ui.js does - through throw params and the event stream, never by poking fields - so a rename
// fails a test instead of silently passing.
//
// The reachability sweep is the load-bearing block: it proves every hole on the machine can
// actually be scored by SOME swipe, that a too-weak roll comes back, and that the power curve
// keeps its shape (up through the rings to the 50, then down the far side on an overshoot).
// Those are the mechanics Matt tunes by feel; this pins them so a physics tweak that kills the
// 100 pockets or the rollback fails here before anyone plays a broken machine.

import { simulateThrow, startThrow, step, STEP, R } from './physics.js';
import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { BOARDS, boardById, unlocksEarned, DEFAULT_BOARD } from './boards.js';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const board = boardById(DEFAULT_BOARD);
const outcomeOf = (power, aim) => {
  const st = simulateThrow(board, { power, aim });
  return st.phase === 'done' ? (st.outcome ? st.outcome.hole : 'returned') : 'STUCK';
};

// --- 1. determinism ---------------------------------------------------------------------------

{
  const a = simulateThrow(board, { power: 0.63, aim: 0.21 });
  const b = simulateThrow(board, { power: 0.63, aim: 0.21 });
  eq('same throw, same outcome, same timing', [a.outcome, a.t], [b.outcome, b.t]);
}

// --- 2. reachability: every hole on the machine can be scored ---------------------------------

{
  const found = new Map();          // hole -> first {power, aim} that scores it
  for (let p = 0; p <= 60; p++) {
    for (const aim of [0, 0.15, 0.3, 0.45, -0.45, 0.55, -0.55, 0.4, -0.4, 0.5, -0.5]) {
      const st = simulateThrow(board, { power: p / 60, aim });
      const hole = st.outcome ? st.outcome.hole : 'returned';
      if (!found.has(hole)) found.set(hole, { power: p / 60, aim });
    }
  }
  for (const hole of ['r10', 'r20', 'r30', 'r40', 'r50', '100L', '100R', 'gutter', 'returned']) {
    ok(`reachable: ${hole}`, found.has(hole),
      `no (power, aim) in the sweep produced ${hole}; found: ${[...found.keys()].join(', ')}`);
  }
  // The 100 is a skill shot: it must NOT be scorable with a straight ball.
  let straight100 = false;
  for (let p = 0; p <= 60; p++) {
    if (String(outcomeOf(p / 60, 0)).startsWith('100')) straight100 = true;
  }
  ok('the 100 pockets need real aim, never a straight ball', !straight100);
}

// --- 3. the power curve keeps its shape (aim 0) ------------------------------------------------

{
  const at = (p) => outcomeOf(p, 0);
  ok('a feeble roll comes back to the player (not spent)', at(0.02) === 'returned');
  ok('an undershoot dies in the pit for zero', at(0.25) === 'gutter');
  const seq = [];
  for (let p = 0; p <= 100; p += 2) {
    const h = at(p / 100);
    if (seq[seq.length - 1] !== h) seq.push(h);
  }
  const upRamp = seq.join(' ');
  ok('rings come up in order on the way to the 50', upRamp.indexOf('r10') < upRamp.indexOf('r30')
    && upRamp.indexOf('r30') < upRamp.indexOf('r50'),
    `sequence was: ${upRamp}`);
  ok('an overshoot climbs past the 50 and scores less, not more',
    upRamp.indexOf('r50') !== -1 && upRamp.lastIndexOf('r20') > upRamp.indexOf('r50'),
    `sequence was: ${upRamp}`);
}

// --- 4. aim symmetry ---------------------------------------------------------------------------

{
  const mirror = (h) => (h === '100L' ? '100R' : h === '100R' ? '100L' : h);
  let sym = true; let broke = '';
  for (const [p, a] of [[0.5, 0.3], [0.7, 0.45], [0.93, 0.5], [0.6, 0.2]]) {
    const l = outcomeOf(p, -a), r = outcomeOf(p, a);
    if (mirror(l) !== r) { sym = false; broke = `power ${p} aim ${a}: left ${l} vs right ${r}`; break; }
  }
  ok('the machine is left/right symmetric', sym, broke);
}

// --- 5. the soak: no throw ever hangs, leaks or invents a value --------------------------------

{
  // Deterministic pseudo-random driver (mulberry32) - reproducible failures or none at all.
  let seed = 0xC0FFEE;
  const rng = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const LEGAL = new Set([0, 10, 20, 30, 40, 50, 100]);
  let bad = '';
  for (let i = 0; i < 600 && !bad; i++) {
    const power = rng(), aim = rng() * 2 - 1;
    const st = startThrow(board, { power, aim });
    let steps = 0;
    while (st.phase !== 'done' && steps < 240 * 14) {
      step(board, st, STEP); steps++;
      if (!Number.isFinite(st.x + st.y + st.z)) { bad = `NaN position at throw ${i} (p=${power}, a=${aim})`; break; }
      if (Math.abs(st.x) > 2 || st.y > 6 || st.y < -1 || st.z > 4 || st.z < -1) {
        bad = `ball left the machine at throw ${i}: (${st.x.toFixed(2)}, ${st.y.toFixed(2)}, ${st.z.toFixed(2)})`; break;
      }
    }
    if (!bad && st.phase !== 'done') bad = `throw ${i} never settled (p=${power}, a=${aim})`;
    if (!bad && st.outcome && !LEGAL.has(st.outcome.value)) bad = `invented value ${st.outcome.value}`;
  }
  ok('600-throw soak: every throw settles, in bounds, to a legal value', !bad, bad);
}

// --- 6. the rules: nine balls, additive score, honest counters ---------------------------------

{
  const g = new SkeeballGame('classic');
  // Drive through the real API: throw, then pump update() until the ball settles.
  const play = (power, aim) => {
    if (!g.throwBall({ power, aim })) return [];
    const evs = [];
    for (let i = 0; i < 240 * 14 && g.ball; i++) { g.update(STEP); evs.push(...g.takeEvents()); }
    return evs;
  };

  // A rolled-back ball is not spent.
  const back = play(0.02, 0);
  ok('rolled-back ball: not spent, no score', g.ballsUsed === 0 && g.score === 0
    && back.some((e) => e.type === 'ballBack'));

  // Score a known ladder: the sweep above proved these mappings.
  const holes = [];
  const powers = [0.62, 0.62, 0.62, 0.44, 0.25, 0.93, 0.93, 0.62, 0.62];
  const aims = [0, 0, 0, 0, 0, 0.5, 0.5, 0, 0];
  let overEv = null;
  for (let i = 0; i < 9; i++) {
    const evs = play(powers[i], aims[i]);
    const doneEv = evs.find((e) => e.type === 'ballDone');
    holes.push(doneEv ? doneEv.hole : '??');
    const ro = evs.find((e) => e.type === 'rackOver');
    if (ro) overEv = ro;
  }
  ok('nine settled balls end the rack', g.over && g.ballsUsed === 9 && overEv != null);
  const expected = g.throws.reduce((s, t) => s + t.value, 0);
  eq('score is the sum of the throws', g.score, expected);
  eq('hundreds counted', g.hundreds, g.throws.filter((t) => t.value === 100).length);
  eq('fifties counted', g.fifties, g.throws.filter((t) => t.value === 50).length);
  eq('bestThrow is the max single ball', g.bestThrow, Math.max(...g.throws.map((t) => t.value)));
  ok('a tenth ball is refused', !g.throwBall({ power: 0.5, aim: 0 }));

  // The recorder payload: exactly the extras recordSkeeball documents
  // (js/game-stats.js: { score, balls, hundreds, fifties, bestThrow }; `at` is the caller's).
  const res = overEv.result;
  eq('result() carries exactly the recorder extras',
    Object.keys(res).sort(), ['balls', 'bestThrow', 'fifties', 'hundreds', 'score']);
  eq('result() agrees with the game', res,
    { score: g.score, balls: 9, hundreds: g.hundreds, fifties: g.fifties, bestThrow: g.bestThrow });
}

// --- 7. snapshot / restore: leaving mid-rack is lossless ---------------------------------------

{
  const g = new SkeeballGame('classic');
  const play = (power, aim) => {
    g.throwBall({ power, aim });
    for (let i = 0; i < 240 * 14 && g.ball; i++) { g.update(STEP); }
    g.takeEvents();
  };
  play(0.62, 0); play(0.44, 0); play(0.93, 0.5);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const r = SkeeballGame.restore(snap);
  eq('restore: score, balls, counters, log all survive',
    [r.score, r.ballsUsed, r.hundreds, r.fifties, r.bestThrow, r.throws],
    [g.score, g.ballsUsed, g.hundreds, g.fifties, g.bestThrow, g.throws]);
  ok('restored rack continues to completion', (() => {
    for (let i = r.ballsUsed; i < BALLS_PER_GAME; i++) {
      r.throwBall({ power: 0.62, aim: 0 });
      for (let s = 0; s < 240 * 14 && r.ball; s++) r.update(STEP);
    }
    return r.over && r.ballsUsed === 9;
  })());
  const junk = SkeeballGame.restore({ v: 1, board: 'classic', score: -50, ballsUsed: 99, throws: 'no' });
  ok('a mangled snapshot degrades safely', junk.ballsUsed === BALLS_PER_GAME && Array.isArray(junk.throws));
  ok('restore(nothing) is a fresh game', SkeeballGame.restore(null).ballsUsed === 0);
}

// --- 8. the unlock chain (against a synthetic future - only one real machine exists yet) -------

{
  const future = [
    { id: 'classic', unlock: null },
    { id: 'cosmic', unlock: { board: 'classic', score: 450 } },
    { id: 'haunted', unlock: { board: 'cosmic', score: 500 } },
  ];
  eq('a big enough game unlocks the next machine', unlocksEarned('classic', 450, future), ['cosmic']);
  eq('one point short unlocks nothing', unlocksEarned('classic', 440, future), []);
  eq('a great game on the wrong machine unlocks nothing', unlocksEarned('haunted', 900, future), []);
  eq('the real list today: nothing to unlock yet', unlocksEarned('classic', 900), []);
  ok('every board id is unique', new Set(BOARDS.map((b) => b.id)).size === BOARDS.length);
  ok("the first machine is 'classic' (recordSkeeball's fallback id - frozen)", DEFAULT_BOARD === 'classic');
}

// --- summary -----------------------------------------------------------------------------------

console.log(`\nSkeeball engine: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
