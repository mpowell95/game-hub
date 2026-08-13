// skeeball/js/test.js - headless engine tests (wired into run-all-tests.mjs). No DOM, no
// storage: physics.js (cannon-es underneath since 2026-08-13), game.js and boards.js are pure,
// and everything here drives them the way ui.js does - through throw params and the event
// stream, never by poking fields - so a rename fails a test instead of silently passing.
//
// The reachability sweep is the load-bearing block: it proves every hole on the machine can
// actually be scored by SOME swipe, that a too-weak roll comes back, and that the power curve
// keeps its shape (up through the cups as power climbs; overshoot pays on average). Those are
// the mechanics Matt tunes by feel; this pins them so a geometry or material tweak that kills
// the 100 pockets or the rollback fails here before anyone plays a broken machine.
//
// What changed with the engine swap: outcomes come from a real rigid-body solver, so a few old
// assertions were re-grounded in what a REAL machine does - there is no "gutter void" any more
// (a dead lob rolls into the 10 slot, exactly like the real bottom slot), and "max power must
// not be a clean 50" became "overshoot pays ON AVERAGE" (a slammed ball genuinely can rattle
// into the 50 now and then; what must not happen is full power beating aimed mid power).

import { simulateThrow, startThrow, step, takeEvents, STEP } from './physics.js';
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
  const r = simulateThrow(board, { power, aim });
  return r.outcome ? r.outcome.hole : 'returned';
};
const valueOf = (power, aim) => {
  const r = simulateThrow(board, { power, aim });
  return r.outcome ? r.outcome.value : 0;
};

// --- 1. determinism ---------------------------------------------------------------------------

{
  const a = simulateThrow(board, { power: 0.63, aim: 0.21 });
  const b = simulateThrow(board, { power: 0.63, aim: 0.21 });
  eq('same throw, same outcome, same timing', [a.outcome, a.time], [b.outcome, b.time]);
}

// --- 2. reachability: every hole on the machine can be scored ---------------------------------
// The outcome EMERGES from the solver (the ball drains wherever it drains), so this sweep is
// the source of truth for what a throw can do - and `found` feeds block 6, so the rules test
// always plays throws this same engine just proved out.

const found = new Map();          // hole -> first {power, aim} that produced it
let sweepEmergencies = 0;
let sweepSlowest = 0;
{
  for (let p = 0; p <= 40; p++) {
    for (const aim of [0, 0.25, -0.25, 0.5, -0.5, 0.65, -0.65, 0.8, -0.8, 1, -1]) {
      const r = simulateThrow(board, { power: p / 40, aim });
      const hole = r.outcome ? r.outcome.hole : 'returned';
      if (!found.has(hole)) found.set(hole, { power: p / 40, aim });
      if (r.emergencyUsed) sweepEmergencies++;
      sweepSlowest = Math.max(sweepSlowest, r.time);
    }
  }
  for (const hole of ['h10', 'h20', 'c30', 'c40', 'c50', '100L', '100R', 'corner0', 'returned']) {
    ok(`reachable: ${hole}`, found.has(hole),
      `no (power, aim) in the sweep produced ${hole}; found: ${[...found.keys()].join(', ')}`);
  }
  ok('nothing in the sweep needed more than 9s to settle', sweepSlowest < 9,
    `slowest: ${sweepSlowest.toFixed(1)}s`);
  ok('the walkout/emergency path stays rare (under 2% of the sweep)',
    sweepEmergencies <= Math.ceil(41 * 11 * 0.02), `${sweepEmergencies} of ${41 * 11}`);
  // The 100 is a skill shot: it must NOT be scorable with a straight ball.
  let straight100 = false;
  for (let p = 0; p <= 60; p++) {
    if (String(outcomeOf(p / 60, 0)).startsWith('100')) straight100 = true;
  }
  ok('the 100 cups need real aim, never a straight ball', !straight100);
}

// --- 3. the power curve keeps its emergent shape (aim 0) ---------------------------------------

{
  const at = (p) => outcomeOf(p, 0);
  ok('a feeble roll comes back to the player (not spent)', at(0.02) === 'returned');
  ok('a dead lob rolls into the 10 slot, like the real bottom slot', at(0.16) === 'h10',
    `p 0.16 straight gave ${at(0.16)}`);
  // Straight balls past the rollback essentially always score - the classic's floor. (A rim-out
  // to a corner 0 is real physics and allowed, but it must be the exception.)
  let zeros = 0;
  for (let p = 3; p <= 20; p++) if (valueOf(p / 20, 0) === 0) zeros++;
  ok('straight power almost always scores (at most one corner-0 fluke in the ladder)', zeros <= 1,
    `${zeros} zeros among 18 straight powers`);
  // The cups come within reach in ladder order as power climbs (first power that lands each).
  const firstAt = (want) => {
    for (let p = 0; p <= 100; p++) if (at(p / 100) === want) return p / 100;
    return null;
  };
  const p30 = firstAt('c30'), p40 = firstAt('c40'), p50 = firstAt('c50');
  ok('straight power finds the 30, then the 40, then the 50, in that order',
    p30 !== null && p40 !== null && p50 !== null && p30 < p40 && p40 < p50,
    `first powers: c30=${p30} c40=${p40} c50=${p50}`);
  // Overshoot pays ON AVERAGE: slamming full power must score worse than the aimed mid-power
  // band. (A single slammed ball rattling into the 50 is real; a STRATEGY of slamming is not.)
  const mean = (lo, hi) => {
    let s = 0, n = 0;
    for (let p = lo; p <= hi; p += 0.02) { s += valueOf(p, 0); n++; }
    return s / n;
  };
  const mid = mean(0.55, 0.7);
  const slam = mean(0.86, 1.0);
  ok('max power scores worse than mid power on average (overshoot has a price)', slam < mid,
    `mid-power mean ${mid.toFixed(1)} vs slam mean ${slam.toFixed(1)}`);
}

// --- 3b. the footage contract: rattle is real, settle always ends ------------------------------

{
  // Somewhere in the sweep a ball must genuinely rattle (the reference clips' 1.5s-3s settles,
  // on top of ~0.7s of lane), and the emergency cap must never be the thing that ends a throw.
  let longest = 0; let longestParams = null;
  for (let p = 0; p <= 30; p++) {
    for (const aim of [0, 0.25, -0.25, 0.5, -0.5]) {
      const r = simulateThrow(board, { power: p / 30, aim });
      if (!r.emergencyUsed && r.time > longest) { longest = r.time; longestParams = { power: p / 30, aim }; }
    }
  }
  ok('at least one throw works the board for over 2s, like the footage', longest > 2,
    `longest honest settle in the probe sweep: ${longest.toFixed(2)}s`);
  // And that longest rattler produces real bounce events - the thing the old model faked.
  const st = startThrow(board, longestParams || { power: 0.5, aim: 0.3 });
  let bounces = 0;
  for (let i = 0; i < 240 * 14 && !st.done; i++) {
    step(board, st, STEP);
    for (const ev of takeEvents(st)) if (ev.type === 'bounce' || ev.type === 'backboard') bounces++;
  }
  ok('the rattler emits real bounce events along the way', bounces >= 1,
    `saw ${bounces} bounces over ${longest.toFixed(2)}s`);
}

// --- 4. aim symmetry ---------------------------------------------------------------------------
// The machine is geometrically mirror-symmetric, but the solver iterates contacts in list
// order, so knife-edge throws can genuinely split. Demand symmetry in the large, not per throw.

{
  const mirror = (h) => (h === '100L' ? '100R' : h === '100R' ? '100L' : h);
  let agree = 0;
  const pairs = [[0.5, 0.3], [0.7, 0.45], [0.9, 0.8], [0.22, 1], [0.6, 0.2], [0.8, 0.65], [0.35, 0.5]];
  const detail = [];
  for (const [p, a] of pairs) {
    const l = outcomeOf(p, -a), r = outcomeOf(p, a);
    if (mirror(l) === r) agree++;
    else detail.push(`p${p}/a${a}: L ${l} vs R ${r}`);
  }
  ok('the machine plays left/right symmetric (allowing knife-edge splits)', agree >= pairs.length - 2,
    detail.join('; '));
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
  for (let i = 0; i < 250 && !bad; i++) {
    const power = rng(), aim = rng() * 2 - 1;
    const st = startThrow(board, { power, aim });
    let steps = 0;
    while (!st.done && steps < 240 * 14) {
      step(board, st, STEP); steps++;
      const p = st.ball.position;
      if (!Number.isFinite(p.x + p.y + p.z)) { bad = `NaN position at throw ${i} (p=${power}, a=${aim})`; break; }
      if (Math.abs(p.x) > 2.5 || p.y > 4 || p.y < -1.5 || p.z > 2 || p.z < -4) {
        bad = `ball left the machine at throw ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`; break;
      }
    }
    if (!bad && !st.done) bad = `throw ${i} never settled (p=${power}, a=${aim})`;
    if (!bad && st.outcome && !LEGAL.has(st.outcome.value)) bad = `invented value ${st.outcome.value}`;
  }
  ok('250-throw soak: every throw settles, in bounds, to a legal value', !bad, bad);
}

// --- 6. the rules: nine balls, additive score, honest counters ---------------------------------

{
  const g = new SkeeballGame('classic');
  // Drive through the real API: throw, then pump update() until the ball settles.
  const play = (power, aim) => {
    if (!g.throwBall({ power, aim })) return [];
    const evs = [];
    for (let i = 0; i < 240 * 15 && g.ball; i++) { g.update(STEP); evs.push(...g.takeEvents()); }
    return evs;
  };

  // A rolled-back ball is not spent.
  const back = play(0.02, 0);
  ok('rolled-back ball: not spent, no score', g.ballsUsed === 0 && g.score === 0
    && back.some((e) => e.type === 'ballBack'));

  // Score a ladder sourced from the reachability sweep itself, so this block can never drift
  // from the engine's real behavior: one of each outcome the sweep found, padded with repeats.
  const throwsPlan = [
    found.get('c50'), found.get('c40'), found.get('c30'), found.get('h20'), found.get('h10'),
    found.get('100R') || found.get('100L'), found.get('corner0'), found.get('h20'), found.get('h10'),
  ].map((f) => f || { power: 0.5, aim: 0 });
  let overEv = null;
  for (let i = 0; i < 9; i++) {
    const evs = play(throwsPlan[i].power, throwsPlan[i].aim);
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
    for (let i = 0; i < 240 * 15 && g.ball; i++) { g.update(STEP); }
    g.takeEvents();
  };
  play(0.65, 0); play(0.45, 0); play(0.8, 0.65);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const r = SkeeballGame.restore(snap);
  eq('restore: score, balls, counters, log all survive',
    [r.score, r.ballsUsed, r.hundreds, r.fifties, r.bestThrow, r.throws],
    [g.score, g.ballsUsed, g.hundreds, g.fifties, g.bestThrow, g.throws]);
  ok('restored rack continues to completion', (() => {
    for (let i = r.ballsUsed; i < BALLS_PER_GAME; i++) {
      r.throwBall({ power: 0.6, aim: 0 });
      for (let s = 0; s < 240 * 15 && r.ball; s++) r.update(STEP);
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
