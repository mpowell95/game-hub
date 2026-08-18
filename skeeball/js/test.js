// skeeball/js/test.js - headless engine tests (wired into run-all-tests.mjs). No DOM, no
// storage: physics.js, game.js and boards.js are pure, and everything here drives them the way
// ui.js does - through throw params and the event stream, never by poking fields directly - so
// a rename fails a test instead of silently passing.
//
// The reachability sweep is the load-bearing block: it proves every hole can actually be scored
// by SOME swipe, that a too-weak roll comes back, and that the power curve keeps its shape. It
// pins the mechanics tuned by feel, so a geometry or material tweak that kills the 100
// pockets or the rollback fails here before anyone plays a broken machine.

import { simulateThrow, startThrow, step, takeEvents, STEP } from './physics.js';
import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { BOARDS, boardById, unlocksEarned, DEFAULT_BOARD } from './boards.js';
import { buildMachine } from './machine.js';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const board = boardById(DEFAULT_BOARD);
const M = buildMachine(board.geom);
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
  // Every SCORING outcome must be reachable somewhere in the (power, aim) space. `returned` is
  // deliberately NOT in this list: the classic's minSpeed starts where the 20 starts, so nothing
  // on this machine rolls back unspent. The rollback path itself is still exercised in block 6,
  // on a board whose minSpeed sits under the hump.
  for (const hole of ['h10', 'h20', 'c30', 'c40', 'c50', '100L', '100R', 'corner0']) {
    ok(`reachable: ${hole}`, found.has(hole),
      `no (power, aim) in the sweep produced ${hole}; found: ${[...found.keys()].join(', ')}`);
  }
  // THE SOFT END OF THE DIAL IS NEVER WASTED: no straight throw may fail to reach the board. A
  // ball that banks off a side rail on a hard angled fling and comes back is a different thing -
  // real, rare, and allowed within a bound.
  {
    let straightRoll = 0;
    let anyRoll = 0;
    for (let p = 0; p <= 40; p++) {
      for (const aim of [0, 0.25, -0.25, 0.5, -0.5, 0.65, -0.65, 0.8, -0.8, 1, -1]) {
        if (simulateThrow(board, { power: p / 40, aim }).outcome) continue;
        anyRoll++;
        if (Math.abs(aim) <= 0.25) straightRoll++;
      }
    }
    ok('no straight throw ever rolls back unspent (the soft end of the dial is real)',
      straightRoll === 0, `${straightRoll} straight throws rolled back`);
    ok('a rail carom that comes back stays rare', anyRoll <= Math.ceil(41 * 11 * 0.02),
      `${anyRoll} of ${41 * 11} rolled back`);
  }

  // THE BALL MUST GET IN THE AIR. A "touched the scoring face" check alone cannot see a ramp
  // that never launches - see DECISIONS.md#launch-angle-history.
  ok('the ramp launches STEEPER than the board is tilted (or no arc is possible at all)',
    Math.max(...board.geom.humpAngles) > board.geom.boardTilt + 0.15,
    `launch ${Math.max(...board.geom.humpAngles)} rad vs boardTilt ${board.geom.boardTilt} rad`);
  {
    // How far up the face is the ball when it FIRST comes down on it? A real throw drops into a
    // cup or lands high; only a dribble should land on the bottom edge.
    const landings = [];
    for (let p = 2; p <= 20; p++) {
      const st = startThrow(board, { power: p / 20, aim: 0 });
      let land = null;
      let guard = 5000;
      const sT = Math.sin(M.tilt), cT = Math.cos(M.tilt);
      while (!st.done && guard-- > 0) {
        step(board, st, STEP);
        const p2 = st.ball.position;
        const fv = (p2.y - M.lipY) * sT - (p2.z - M.lipZ) * cT;
        const fh = (p2.y - M.lipY) * cT + (p2.z - M.lipZ) * sT;
        if (land === null && fv > 0 && fv < board.geom.boardLen && fh <= board.geom.ballR * 1.12) land = fv;
      }
      if (land !== null) landings.push(land);
    }
    const high = landings.filter((v) => v > 0.10).length;
    ok('throws land UP the board, not all on its bottom edge', high >= landings.length * 0.7,
      `${high} of ${landings.length} first touched above v=0.10`);
    ok('the landing point spreads across the board with power',
      landings.length > 4 && Math.max(...landings) - Math.min(...landings) > 0.45,
      `landings ${Math.min(...landings).toFixed(2)}..${Math.max(...landings).toFixed(2)}`);
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
// This block IS the current contract for the power curve - see DECISIONS.md#power-curve-rebuild
// for why it looks like this rather than the simpler "overshoot always costs you" shape.
{
  const at = (p) => outcomeOf(p, 0);
  const ladder = [];
  for (let p = 0; p <= 100; p++) ladder.push(valueOf(p / 100, 0));

  // NO DEAD ZONE AT EITHER END: neither the softest nor the hardest end of the dial may be a run
  // of the floor value. This is the headline defect of the pre-rebuild build, in one assertion.
  let low = 0;
  for (const v of ladder) { if (v === 10 || v === 0) low++; else break; }
  let high = 0;
  for (let i = ladder.length - 1; i >= 0; i--) { if (ladder[i] === 10 || ladder[i] === 0) high++; else break; }
  ok('no dead zone at the soft end of the dial (was 25 steps)', low <= 6, `${low} floor steps at the bottom`);
  ok('no dead zone at the hard end of the dial (was 12 steps)', high <= 6, `${high} floor steps at the top`);

  // THE BANDS ARE WIDE ENOUGH TO AIM AT. A player must be able to repeat a swipe and repeat the
  // result; that is impossible if the outcome flips every step.
  let flips = 0;
  for (let i = 1; i < ladder.length; i++) if (ladder[i] !== ladder[i - 1]) flips++;
  ok('the ladder is not noise: few flips between adjacent power steps (was 43/100)', flips <= 22,
    `${flips} flips in 100 steps`);
  const bands = [];
  for (const v of ladder) { const l = bands[bands.length - 1]; if (l && l.v === v) l.n++; else bands.push({ v, n: 1 }); }
  ok('few one-step bands (was 30 of 44)', bands.filter((b) => b.n === 1).length <= 12,
    `${bands.filter((b) => b.n === 1).length} of ${bands.length} bands are one step wide`);

  // Straight balls essentially always score - the classic's floor. (A rim-out to a corner 0 is
  // real physics and allowed, but it must be the exception.)
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

  // HARDER GOES FURTHER. The whole point of the dial: averaged over each quarter, a harder
  // quarter must not score less than a softer one.
  const mean = (lo, hi) => {
    let s = 0, n = 0;
    for (let p = lo; p <= hi; p += 0.02) { s += valueOf(p, 0); n++; }
    return s / n;
  };
  const q = [mean(0.00, 0.24), mean(0.25, 0.49), mean(0.50, 0.74), mean(0.75, 1.00)];
  ok('harder goes further: each quarter of the dial outscores the one below it',
    q[0] < q[1] && q[1] < q[2] && q[2] < q[3], `quarter means ${q.map((v) => v.toFixed(1)).join(' < ')}`);

  // THE 100 IS THE RISK. It needs full power and a hard sideways aim, it is worth double the 50,
  // and missing it costs the ball - which is what stops "slam it straight" being the whole game.
  const corner = (p, a) => valueOf(p, a);
  // SEARCHED, not hardcoded: which power reaches the corners depends on the ramp and the
  // board, and a fixed p0.95 went stale the moment the geometry moved. What must hold is that
  // the 100 is reachable SOMEWHERE with a hard angle.
  {
    let best = null;
    for (let p = 20; p <= 100; p += 2) {
      for (const a2 of [0.8, 0.9, 1.0, -0.8, -0.9, -1.0]) {
        if (valueOf(p / 100, a2) === 100) { best = { p: p / 100, a: a2 }; break; }
      }
      if (best) break;
    }
    ok('the 100 is reachable with a hard angle', best !== null,
      'no (power, aim) with |aim| >= 0.8 scored 100');
    if (best) console.log('        (first at power ' + best.p.toFixed(2) + ', aim ' + best.a + ')');
  }
  // The 100 needs a real ANGLE, which is the axis its risk lives on, not power - a hard-angled
  // ball can bank off the side rail into the corner from mid power up. What must stay true is
  // that a HALF-hearted angle never pays.
  for (const a of [0.3, 0.45, -0.3, -0.45]) {
    ok(`a half-angled ball never pays 100 (aim ${a})`,
      corner(0.85, a) !== 100, `aim ${a} at p0.85 scored ${corner(0.85, a)}`);
  }
  const missAim = [0.5, 0.6, 0.7].map((a) => corner(0.95, a));
  ok('missing the corner costs the ball (a half-aimed slam does not still pay 50)',
    missAim.every((v) => v < 50), `half-aimed slams scored ${missAim.join('/')}`);
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
  // And that longest rattler produces real bounce events.
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

  // A rolled-back ball is not spent. The classic board can no longer produce one (its minSpeed
  // starts where the 20 starts), but the rule belongs to game.js, not to one machine's tuning -
  // drive it on a synthetic board whose minSpeed sits under the hump so the rollback path stays
  // covered.
  {
    const slow = { ...board, id: 'test-rollback', geom: { ...board.geom, minSpeed: 0.55, maxSpeed: 0.6 } };
    const g2 = new SkeeballGame('classic');
    g2.board = slow;
    g2.throwBall({ power: 0, aim: 0 });
    const evs = [];
    for (let i = 0; i < 240 * 15 && g2.ball; i++) { g2.update(STEP); evs.push(...g2.takeEvents()); }
    ok('rolled-back ball: not spent, no score', g2.ballsUsed === 0 && g2.score === 0
      && evs.some((e) => e.type === 'ballBack'),
      `ballsUsed=${g2.ballsUsed} score=${g2.score} sawBallBack=${evs.some((e) => e.type === 'ballBack')}`);
  }

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
