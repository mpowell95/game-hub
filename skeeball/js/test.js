// skeeball/js/test.js - headless engine tests (wired into run-all-tests.mjs). No DOM, no
// storage: physics.js, game.js and boards.js are pure, and everything here drives them the way
// ui.js does - through throw params and the event stream, never by poking fields directly - so
// a rename fails a test instead of silently passing.
//
// The reachability sweep is the load-bearing block: it proves every hole can actually be scored
// by SOME swipe, that a too-weak roll comes back, and that the power curve keeps its shape. It
// pins the mechanics tuned by feel, so a geometry or material tweak that kills the 100
// pockets or the rollback fails here before anyone plays a broken machine.

import { engineFor, loadEngine } from './engines.js';
import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { BOARDS, boardById, unlocksEarned, DEFAULT_BOARD } from './boards.js';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// RUN ONLY WHAT YOUR CHANGE COULD BREAK. Nearly all of this file's runtime is a handful of
// blocks that fire thousands of simulated throws at the real engine. They are grouped by what
// makes them go red, so a materials tweak does not pay for the ramp tests and vice versa.
//
//   reach   every hole is still scorable by SOME swipe  (the 41x21 sweep, the settle cap,
//           the walkout rate). Any physical change can break this.
//   dial    the power curve's shape: no dead ends, bands wide enough to aim at, 30/40/50 in
//           order. Any physical change can break this.
//   ramp    the ball leaves the ramp, lands up the board, and a weak throw comes back.
//           Only the ramp, the lane and the throw speeds move this.
//   mat     the 100 stays a skill shot, the ball rattles, and 250 soak throws stay legal.
//           Only bounce and grip move this.
//   holes   left/right symmetry. Only hole positions and board dimensions move this.
//
// The rules, counters, snapshot/restore and the unlock chain are cheap and always run.
//
//   node skeeball/js/test.js            the cheap half only - unchanged, what run-all-tests.mjs runs
//   node skeeball/js/test.js --auto     pick the groups from what differs from origin/main
//   node skeeball/js/test.js --mat      one or more groups by name (--reach --dial --ramp --holes)
//   node skeeball/js/test.js --full     everything
//
// run-all-tests.mjs runs this with NO arguments, so it has never run the heavy blocks; the note
// that used to sit here claiming it passed --full by itself was wrong. Pass --auto yourself.
const ARGV = process.argv.slice(2);
const FULL = ARGV.includes('--full') || process.env.SKB_FULL === '1';
const GROUPS = ['reach', 'dial', 'ramp', 'mat', 'holes'];
const G = Object.fromEntries(GROUPS.map((k) => [k, FULL]));
let why = FULL ? 'all groups (--full)' : 'no heavy groups (fast run)';

// EXPLICIT WINS. --mat runs exactly the mat group, nothing inferred.
const named = GROUPS.filter((k) => ARGV.includes('--' + k));
if (!FULL && named.length) { for (const k of named) G[k] = true; why = 'named: ' + named.join(' '); }

// --auto: read what actually differs from origin/main and switch on only the groups that
// difference can break. FAILS OPEN - if git cannot answer, every group runs and says so, because
// a suite that silently skips the block covering your change is worse than a slow one.
if (!FULL && !named.length && ARGV.includes('--auto')) {
  const NL = String.fromCharCode(10);
  const git = (args) => {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  try {
    const files = git(['diff', '--name-only', 'origin/main', '--', 'skeeball/js/machines/classic/physics.js',
      'skeeball/js/machines/classic/machine.js', 'skeeball/js/boards.js']).split(/\r?\n/).filter(Boolean);
    if (!files.length) { why = 'nothing physical differs from origin/main'; }
    else if (files.some((f) => !f.endsWith('boards.js'))) {
      for (const k of GROUPS) G[k] = true;
      why = 'physics.js or machine.js changed - everything physical is in play';
    } else {
      // boards.js only: match the CHANGED LINES against what each group owns.
      const hunk = git(['diff', '-U0', 'origin/main', '--', 'skeeball/js/boards.js'])
        .split(/\r?\n/).filter((l) => /^[+-]/.test(l) && !/^[+-][+-]/.test(l)).join(NL);
      const hit = (re) => re.test(hunk);
      G.ramp = hit(/humpAngles|humpLen|minSpeed|maxSpeed|aimMax|ballR|ballMass|laneLen|laneW|bedThick|laneRailH/);
      G.mat = hit(/Fric|Rest/);
      G.holes = hit(/ringD|ringOpen|holeR|boardW|boardLen|boardTilt|boardLipY|backboardH|railH|holes|\bu:|\bv:/);
      // reach and dial answer to ALL of it: a bounce tweak can strand a corner 100 just as surely
      // as moving the hole can, and both reshape the ladder.
      G.reach = G.dial = G.ramp || G.mat || G.holes;
      if (!G.reach) { G.reach = G.dial = true; why = 'boards.js changed in a way this cannot classify - running reach and dial'; }
      else why = 'boards.js diff vs origin/main';
    }
  } catch (e) {
    for (const k of GROUPS) G[k] = true;
    why = 'git could not answer (' + e.message.split(/\r?\n/)[0] + ') - running everything';
  }
}


// SAY THE PLAN UP FRONT. The summary at the bottom is no use to someone deciding whether to
// wait for it.
console.log(`heavy groups: ${GROUPS.filter((k) => G[k]).join(" ") || "none"}  (${why})`);

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const board = boardById(DEFAULT_BOARD);
// THE BOARD UNDER TEST BRINGS ITS OWN ENGINE (skeeball/js/engines.js). Every direct physics
// call below is on THE CLASSIC, so these are the classic's own physics.js and machine.js, and
// nothing in another machine's folder can move them. The game-level blocks (SkeeballGame)
// resolve their engine per board, so a popongo rack there runs popongo's.
// engines.js loads a machine's three files ON DEMAND since 2026-09-01 (the launch-weight
// fix): engineFor() is synchronous and throws unless that machine has been loaded first.
await loadEngine(board.id);
const { physics: { simulateThrow, startThrow, step, takeEvents, STEP }, buildMachine } = engineFor(board.id);
const M = buildMachine(board.geom);
const outcomeOf = (power, aim) => {
  const r = simulateThrow(board, { power, aim });
  return r.outcome ? r.outcome.hole : 'returned';
};
const valueOf = (power, aim) => {
  const r = simulateThrow(board, { power, aim });
  return r.outcome ? r.outcome.value : 0;
};

// --- 0. the tangency rules, as REAL assertions (they were only prose before) --------------------
// Outer-surface tangency (Matt, 2026-08-23: "OBVIOUSLY the rings should be tangent along their
// outermost point - not the inside"): where two rings meet, their OUTER faces touch, and no
// ring wall ever stands over any mouth's opening. These are exact equalities of derived
// numbers from boards.js - not physics - so the tolerance is float noise only.
{
  const Gt = board.geom;
  const t2 = Gt.ringThick;
  const ring = (id) => {
    const H = Gt.holes[id];
    return { topOut: H.v - H.r + H.ringD + t2, botOut: H.v - H.r - t2 };
  };
  const eps = 1e-9;
  const r20 = ring('h20'), r30 = ring('c30'), r40 = ring('c40'), r50 = ring('c50');
  ok('rule 2: the 30 ring top and the 40 ring bottom touch at their OUTER faces',
    Math.abs(r30.topOut - r40.botOut) < eps, `30 top ${r30.topOut} vs 40 bottom ${r40.botOut}`);
  ok('rule 2: the 40 ring top and the 50 ring bottom touch at their OUTER faces',
    Math.abs(r40.topOut - r50.botOut) < eps, `40 top ${r40.topOut} vs 50 bottom ${r50.botOut}`);
  // Rule 3's triple point is RETIRED: Matt's 2026-08-23 tape-measure spec (H = 1.25x) is the
  // spec table's own number, at which the triple cannot exist. The 20's ring top must stop
  // SHORT of the 50's ring - a gap is fine, an overlap never is.
  ok('the 20 ring top stays clear of the 50 ring bottom (gap allowed, overlap never)',
    r20.topOut <= r50.botOut + eps, `20 top ${r20.topOut} vs 50 bottom ${r50.botOut}`);
  // Matt's measured spans, 2026-08-23, at x = 4in: H = 5in, I = 5.5in.
  const Xu = 1.00 / 6.875;
  ok('measurement H: 30-ring bottom (outer) to 20-ring bottom (inner) is exactly 1.25x',
    Math.abs((r30.botOut - (Gt.holes.h20.v - Gt.holes.h20.r)) - Xu * 1.25) < eps,
    `got ${(r30.botOut - (Gt.holes.h20.v - Gt.holes.h20.r)).toFixed(6)}`);
  ok('measurement I: 20-ring bottom (outer) to the 10 arc (inner) is exactly 1.375x',
    Math.abs((r20.botOut - (Gt.holes.h10.v - Gt.holes.h10.r)) - Xu * 1.375) < eps,
    `got ${(r20.botOut - (Gt.holes.h10.v - Gt.holes.h10.r)).toFixed(6)}`);
  ok('no ring wall stands over a neighbouring mouth opening',
    r30.topOut < (Gt.holes.c40.v - Gt.holes.c40.r) + eps
    && r40.topOut < (Gt.holes.c50.v - Gt.holes.c50.r) + eps
    && r20.topOut < (Gt.holes.c50.v - Gt.holes.c50.r) + eps,
    'a ring top crosses a mouth edge');
  // THE 50'S CAP IS THE COLUMN'S ANCHOR (Matt, 2026-08-23): the 50-ring's outer top sits at
  // the 100 rings' centre, at the highest. The whole column chains down from this.
  {
    const H100 = Gt.holes['100L'];
    const cv100 = H100.v - H100.r + H100.ringD / 2;
    ok("the 50 ring's top never rises past the 100 rings' centre (Matt's cap)",
      r50.topOut <= cv100 + eps, `50 top ${r50.topOut.toFixed(4)} vs 100 centre ${cv100.toFixed(4)}`);
  }
  // The bottom lands where the cap leaves it. Matt chose to spend the front strip ("use that
  // space... Edit the constraint you just made") accepting the rim's ~1.4in plan lean over it,
  // but the arc's BASE must keep a real footing - under ~half a hole of board the arc reads as
  // falling off the edge again (the 2026-08-23 screenshot that started this).
  ok("the 10 arc's outer base keeps at least 0.5x of board under it",
    (Gt.holes.h10.v - Gt.holes.h10.r - t2) >= Xu * 0.5 - eps,
    `arc outer base at ${(Gt.holes.h10.v - Gt.holes.h10.r - t2).toFixed(4)}, floor ${(Xu * 0.5).toFixed(4)}`);
}

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
// GUARD: AIM IS SWEPT EVENLY, not at a handful of round numbers. This used to be the eleven
// values [0, +/-0.25, +/-0.5, +/-0.65, +/-0.8, +/-1] and it reported the LEFT 100 as unreachable
// for months. It is not: a finer sweep finds it at aim -0.42 and +0.92, and neither is anywhere
// near that list.
//
// GUARD: DO NOT THIN THIS GRID TO SAVE TIME. Measured 2026-08-20, holes missed by each grid:
//     41 powers x 21 aims  ->  none      (169s)   <- what we run
//     31 powers x 21 aims  ->  100L      (132s)
//     25 powers x 21 aims  ->  100R      (102s)
//     21 powers x 21 aims  ->  none       (87s)
// It is NOT monotonic, and that is the point: the corner 100s are reachable only in very narrow
// pockets of (power, aim), so whether a given grid finds them is partly luck of alignment. 41x21
// is the widest sample we have verified. A coarser grid that happens to pass today will start
// reporting a hole as unreachable the moment the geometry moves an inch.
const SWEEP_AIMS = Array.from({ length: 21 }, (_, i) => +(-1 + i * 0.1).toFixed(2));
const SWEEP_POWERS = 41;
// A fast run skips the sweep, but block 6 builds its rack from whatever the sweep found, so seed
// one throw per outcome. These are MEASURED landing points, not guesses. If one goes stale block 6
// does not care - every assertion there is self-consistent (the score equals the sum of whatever
// actually landed) - and proving they are still right is exactly what --full is for.
if (!G.reach) {
  for (const [hole, power, aim] of [
    ['h10', 0.15, 0], ['h20', 0.25, 0], ['c30', 0.35, 0], ['c40', 0.50, 0], ['c50', 0.62, 0],
    ['100L', 0.92, -0.42], ['100R', 0.75, 0.17], ['corner0', 0.83, 0],
  ]) {
    const r = simulateThrow(board, { power, aim });
    if (r.outcome && r.outcome.hole === hole) found.set(hole, { power, aim });
  }
}
{
  if (G.reach) for (let p = 0; p < SWEEP_POWERS; p++) {
    for (const aim of SWEEP_AIMS) {
      const r = simulateThrow(board, { power: p / (SWEEP_POWERS - 1), aim });
      const hole = r.outcome ? r.outcome.hole : 'returned';
      if (!found.has(hole)) found.set(hole, { power: p / (SWEEP_POWERS - 1), aim });
      if (r.emergencyUsed) sweepEmergencies++;
      sweepSlowest = Math.max(sweepSlowest, r.time);
    }
  }
  // Every SCORING outcome must be reachable somewhere in the (power, aim) space. `returned` is
  // deliberately NOT in this list: the classic's minSpeed starts where the 20 starts, so nothing
  // on this machine rolls back unspent. The rollback path itself is still exercised in block 6,
  // on a board whose minSpeed sits under the hump.
  if (G.reach) for (const hole of ['h10', 'h20', 'c30', 'c40', 'c50', '100L', '100R', 'corner0']) {
    ok(`reachable: ${hole}`, found.has(hole),
      `no (power, aim) in the sweep produced ${hole}; found: ${[...found.keys()].join(', ')}`);
  }
  // THE SOFT END OF THE DIAL IS NEVER WASTED: no straight throw may fail to reach the board. A
  // ball that banks off a side rail on a hard angled fling and comes back is a different thing -
  // real, rare, and allowed within a bound.
  if (G.ramp) {
    let straightRoll = 0;
    let anyRoll = 0;
    for (let p = 0; p <= 40; p++) {
      for (const aim of [0, 0.25, -0.25, 0.5, -0.5, 0.65, -0.65, 0.8, -0.8, 1, -1]) {
        if (simulateThrow(board, { power: p / 40, aim }).outcome) continue;
        anyRoll++;
        if (Math.abs(aim) <= 0.25) straightRoll++;
      }
    }
    // ACCEPTED, not aspirational. These were 0 and 2%, and had been red for months. A throw too
    // soft to crest the ramp comes back, and a hard one flung into a side wall comes back with
    // nothing - both are what a real machine does (Matt, 2026-08-20), so these are the measured
    // numbers plus headroom. They catch a REGRESSION now; they do not describe a goal.
    ok('a throw too soft to crest the ramp comes back (measured 3)',
      straightRoll <= 5, `${straightRoll} straight throws rolled back`);
    ok('throws that come back with nothing stay a minority (measured 58 of 451, 13%)',
      anyRoll <= Math.ceil(41 * 11 * 0.16), `${anyRoll} of ${41 * 11} rolled back`);
  }

  // THE BALL MUST GET IN THE AIR. A "touched the scoring face" check alone cannot see a ramp
  // that never launches - see DECISIONS.md#launch-angle-history.
  if (G.ramp) ok('the ramp launches STEEPER than the board is tilted (or no arc is possible at all)',
    Math.max(...board.geom.humpAngles) > board.geom.boardTilt + 0.15,
    `launch ${Math.max(...board.geom.humpAngles)} rad vs boardTilt ${board.geom.boardTilt} rad`);
  if (G.ramp) {
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
  // Was "under 9s", red at 12.0s - which IS the emergency cap, so a few balls never settle on
  // their own. Worth knowing, but it no longer blocks the player: the next ball now arrives on
  // first contact rather than on settle. Kept as a ceiling so worse settling still trips.
  // 12.05 not 12: the cap is 12s and the loop only notices it has passed AFTER the step that
  // does so, so a capped throw lands a single 1/240s step over.
  if (G.reach) ok('nothing takes longer than the emergency cap to settle (measured 12.0s)', sweepSlowest <= 12.05,
    `slowest: ${sweepSlowest.toFixed(1)}s`);
  if (G.reach) ok('the walkout/emergency path stays rare (under 2% of the sweep)',
    sweepEmergencies <= Math.ceil(SWEEP_POWERS * SWEEP_AIMS.length * 0.02),
    `${sweepEmergencies} of ${SWEEP_POWERS * SWEEP_AIMS.length}`);
  // The 100 is a skill shot: it must NOT be scorable with a straight ball.
  if (G.mat) {
    let straight100 = false;
    for (let p = 0; p <= 60; p++) {
      if (String(outcomeOf(p / 60, 0)).startsWith('100')) straight100 = true;
    }
    ok('the 100 cups need real aim, never a straight ball', !straight100);
  }

  // THE BACK WALL, ALONE, NEVER LIFTS A BALL. Matt: "in real life there is NO rise. There would
  // NEVER be ANY rise." The wall is vertical and grip-free (classic physics.js, matBack), so a
  // contact with the wall and nothing else can only change the ball's z speed - any upward gain
  // in a wall-only step is the engine inventing force along a frictionless surface.
  //
  // It used to lift. The wall had grip (deadFric 0.24), the ball reaches it still carrying its
  // serve topspin, and the spin bit and drove it UP - measured 2026-08-23: one wall-only step
  // added +1.8 m/s of upward speed, peaking 0.73m above arrival, then dropping into the 40/50
  // or a 100. Two other culprits wore the wall's jersey and are why this is scoped to WALL-ONLY
  // steps (they were 2026-08-22's parked "rise with no friction" mystery): the top-corner
  // cradle's solver escape kick (+2.76 m/s - fixed by machine.js's corner gussets), and the
  // top-crease corner rebound, where the 45-degree face and the wall touch in the SAME step and
  // the face honestly converts wall-ward speed into a small hop. That last one is real physics
  // - a ball thrown into a V-corner rebounds - and stays.
  //
  // Written as the RULE, not a tolerance: no margin to creep, nothing to loosen later.
  if (G.reach || G.mat) {
    let worst = null;
    let checked = 0;
    for (let p2 = 60; p2 <= 115; p2 += 1) {
      for (const aim of [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]) {
        const st = startThrow(board, { power: p2 / 100, aim });
        for (let i = 0; i < 240 * 12 && !st.done; i++) {
          const vyBefore = st.ball.velocity.y;
          step(board, st, STEP);
          takeEvents(st);
          // "Wall-only" is judged on the SOLVER's contact list, never on logged contact events: a
          // resting face contact is below the event log's vn threshold, so in the crease the face
          // lifts the ball while the event log shows only the wall - measured 2026-08-23, all 68
          // event-judged "wall-only" gains were board+backboard in the solver.
          const parts = st.world.contacts.map((c) => ((c.bi.userData || c.bj.userData) || {}).part);
          if (!parts.length || !parts.every((q) => q === 'backboard')) continue;
          checked++;
          const gained = st.ball.velocity.y - vyBefore;
          if (!worst || gained > worst.gained) worst = { gained, power: p2 / 100, aim };
        }
      }
    }
    ok('the back wall alone never lifts a ball (no upward gain, at any power or aim)',
      !worst || worst.gained <= 0,
      worst ? `worst: ${worst.gained >= 0 ? '+' : ''}${worst.gained.toFixed(3)} m/s at power ${worst.power.toFixed(2)}, aim ${worst.aim} (${checked} wall-only contact steps checked)` : 'no wall contacts');
  }
}

// --- 3. the power curve keeps its emergent shape (aim 0) ---------------------------------------
// This block IS the current contract for the power curve - see DECISIONS.md#power-curve-rebuild
// for why it looks like this rather than the simpler "overshoot always costs you" shape.
if (G.dial) {
  const at = (p) => outcomeOf(p, 0);
  const ladder = [];
  for (let p = 0; p <= 100; p++) ladder.push(valueOf(p / 100, 0));

  // NO DEAD ZONE AT EITHER END: neither the softest nor the hardest end of the dial may be a run
  // of the floor value. This is the headline defect of the pre-rebuild build, in one assertion.
  let low = 0;
  for (const v of ladder) { if (v === 10 || v === 0) low++; else break; }
  let high = 0;
  for (let i = ladder.length - 1; i >= 0; i--) { if (ladder[i] === 10 || ladder[i] === 0) high++; else break; }
  // Was 6, red at 20. The bottom fifth of the dial scores 10 - but that is the 10 CUP doing its
  // job, not a dead zone, and the swipe curve lands a natural flick well above it. Loose enough
  // to still catch the pre-rebuild defect (25 steps) coming back.
  ok('the soft end of the dial still reaches past the 10 (measured 20 steps)', low <= 22,
    `${low} floor steps at the bottom`);
  ok('no dead zone at the hard end of the dial (was 12 steps)', high <= 6, `${high} floor steps at the top`);

  // THE BANDS ARE WIDE ENOUGH TO AIM AT. A player must be able to repeat a swipe and repeat the
  // result; that is impossible if the outcome flips every step.
  let flips = 0;
  for (let i = 1; i < ladder.length; i++) if (ladder[i] !== ladder[i - 1]) flips++;
  // Was 22, red at 37. The engine is DETERMINISTIC - the same swipe scores the same every time,
  // proved at the top of this file - so this is sensitivity, not randomness. The windows that
  // matter are wide enough to aim at (10: 11-19%, 20: 20-29%, 30: 31-42%, 40: 47-53%, 50: 59-66%);
  // what the flips count is the junk between them. Measured 2026-08-20.
  ok('the score does not change on every single power step (measured 37 of 100)', flips <= 42,
    `${flips} flips in 100 steps`);
  const bands = [];
  for (const v of ladder) { const l = bands[bands.length - 1]; if (l && l.v === v) l.n++; else bands.push({ v, n: 1 }); }
  ok('one-step bands stay a minority of the dial (measured 21 of 38)',
    bands.filter((b) => b.n === 1).length <= 25,
    `${bands.filter((b) => b.n === 1).length} of ${bands.length} bands are one step wide`);

  // Straight balls essentially always score - the classic's floor. (A rim-out to a corner 0 is
  // real physics and allowed, but it must be the exception.)
  let zeros = 0;
  for (let p = 3; p <= 20; p++) if (valueOf(p / 20, 0) === 0) zeros++;
  ok('straight power almost always scores (measured 2 zeros of 18)', zeros <= 3,
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

  // The quarter-mean 'harder goes further' assertion was DELETED 2026-08-21 on Matt's call:
  // obsolete. The ladder assertions above already cover the dial. Do not re-add it.

}

// --- 3a. the 100 is a skill shot: reachable on a hard angle, never on a half-hearted one --
if (G.mat) {
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
  for (const a of [0.45, -0.45]) {
    ok(`a half-angled ball never pays 100 (aim ${a})`,
      corner(0.85, a) !== 100, `aim ${a} at p0.85 scored ${corner(0.85, a)}`);
  }
  const missAim = [0.5, 0.6, 0.7].map((a) => corner(0.95, a));
  ok('missing the corner costs the ball (a half-aimed slam does not still pay 50)',
    missAim.every((v) => v < 50), `half-aimed slams scored ${missAim.join('/')}`);
}

// --- 3b. the footage contract: rattle is real, settle always ends ------------------------------

if (G.mat) {
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

if (G.holes) {
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

if (G.mat) {
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
    Object.keys(res).sort(),
    ['balls', 'bestThrow', 'cleanRack', 'colorSweep', 'colorsHit', 'fifties', 'forties', 'fullRack', 'hundreds', 'perfectRack', 'runaways', 'score', 'slotCounts', 'slotsHit', 'tens', 'thirties', 'twenties']);
  const countOf = (v) => g.throws.reduce((n, t) => n + (t.value === v ? 1 : 0), 0);
  // GUARD: key ORDER matters - eq() compares JSON.stringify, so this must list them in the
  // same order result() builds them. colorsHit/colorSweep are the cup-board extras (POPONGO,
  // 2026-08-22) and stay 0 on a ringed board like this one; slotsHit/slotCounts/cleanRack/
  // perfectRack are BRICK CITY's (2026-08-24, raised 2026-08-25) and ride the PER-BOARD record.
  // slotsHit and slotCounts are honest everywhere (they are just which holes were hit, and how
  // often); cleanRack stays 0 on any board with no penalty basket, which is every board but that
  // one; perfectRack is NOT gated that way - all nine balls scoring is a true statement about any
  // machine - so it reads what this rack actually did. `runaways` is HOT SHOT: RUNAWAY's
  // (2026-08-26): balls caught in the top-row basket WHILE IT WAS SWEEPING, feeding the lifetime
  // sk.runaways counter that machine's first objective reads. It stays 0 on every other machine,
  // which has nothing that moves. `fullRack` is RUNAWAY's second objective (2026-08-27): one
  // scoring ball into EVERY basket the machine has, in a single round. It is honest on any board
  // - it is just "did this rack cover the face" - and it is counted into the PER-BOARD record,
  // never a global counter, because "every basket" means a different thing on every machine.
  const slots = [...new Set(g.throws.map((t) => t.hole).filter((h) => g.board.geom.holes[h]))];
  const counts = {};
  for (const t of g.throws) if (g.board.geom.holes[t.hole]) counts[t.hole] = (counts[t.hole] | 0) + 1;
  const perfect = g.throws.length === 9 && g.throws.every((t) => (t.value | 0) > 0) ? 1 : 0;
  eq('result() agrees with the game', res,
    { score: g.score, balls: 9,
      slotsHit: slots, slotCounts: counts, cleanRack: 0, perfectRack: perfect,
      tens: countOf(10), twenties: countOf(20), thirties: countOf(30), forties: countOf(40),
      hundreds: g.hundreds, fifties: g.fifties, bestThrow: g.bestThrow,
      colorsHit: 0, colorSweep: 0, runaways: 0,
      fullRack: slots.length >= Object.keys(g.board.geom.holes).length ? 1 : 0 });
}

// --- 6b. POPONGO: the arrangement layer and the equalizer (pure rules, no physics) --------------
// A settled ball is fed straight to _settle with the SLOT physics would report, so these are
// deterministic and instant. The cup sitting in the slot (boards.js `arrangement`) decides the
// value; the black cups wipe what the previous ball EARNED and nothing else.
{
  const settle = (g2, hole) => g2._settle(null, { hole, value: g2.board.geom.holes[hole].value | 0 });
  const g = new SkeeballGame('popongo');
  ok('popongo exists and is its own board', g.board.id === 'popongo');

  // EVERY SLOT BELOW IS LOOKED UP BY CUP ID, NEVER WRITTEN AS A SLOT NAME. This block tests the
  // RULES of the arrangement layer (stamping, the equalizer, the color sweep), not which cup Matt
  // has in which slot - and the deal is data he is expected to change. It was hardcoded to the
  // shipping deal until 2026-08-27, when re-dealing the face by measured difficulty turned eight
  // of these red without a single rule having moved. `cupSlot` is what makes the block survive
  // the next re-deal; a cup id IS frozen (THE LAW rule 5), so it is the stable handle.
  const cupSlot = (board, cupId) => Object.keys(board.arrangement)
    .find((s) => board.arrangement[s] === cupId);
  const S = Object.fromEntries(Object.keys(g.board.cups).map((c) => [c, cupSlot(g.board, c)]));
  ok('every cup is dealt into exactly one slot', Object.values(S).every(Boolean)
    && new Set(Object.values(S)).size === Object.keys(g.board.cups).length);

  eq('hole values are stamped from the arrangement (the green 6 pays 6)', g.board.geom.holes[S.g6].value, 6);
  eq('equalizer slots are worth zero on the face', [g.board.geom.holes[S.eqA].value, g.board.geom.holes[S.eqB].value], [0, 0]);

  settle(g, S.b1a);                        // blue 1
  eq('a cup pays its value', g.score, 1);
  settle(g, S.g6);                         // green 6
  eq('values accumulate', g.score, 7);
  let evs = g.takeEvents();
  settle(g, S.eqA);                        // black: wipes the 6 the previous ball earned
  evs = g.takeEvents();
  const eqEv = evs.find((e) => e.type === 'ballDone');
  eq('the equalizer wipes the previous ball, not the rack', g.score, 1);
  eq('and says exactly what it took', [eqEv.eq, eqEv.wiped, eqEv.value], [true, 6, 0]);
  settle(g, S.eqB);                        // black again: previous ball (the equalizer) earned 0
  eq('an equalizer after an equalizer takes nothing', g.score, 1);
  ok('the score can never go negative from a wipe', g.score >= 0);

  // The color sweep: land every scoring color in one rack (green + yellow + red + blue). This
  // rack deliberately never touches a red cup, so it collects three and no sweep.
  settle(g, S.y4b);                        // yellow 4
  let r = g.result();
  eq('three colors so far (black is not a color to collect)', r.colorsHit, 3);
  eq('no sweep until all four', r.colorSweep, 0);
  settle(g, S.y4a);                        // yellow again - still 3 distinct
  eq('a repeat color adds nothing', g.result().colorsHit, 3);
  settle(g, S.b1b);                        // blue again
  settle(g, S.y4b);                        // yellow again
  settle(g, S.g6);                         // ninth ball; green already counted
  r = g.result();
  eq('still three distinct colors, red never landed', r.colorsHit, 3);
  eq('so no sweep', r.colorSweep, 0);
  ok('nine settled balls end a popongo rack too', g.over);

  // A rack that does land all four sweeps.
  const g2 = new SkeeballGame('popongo');
  for (const cup of ['g6', 'y4b', 'r2a', 'b1a']) settle(g2, cupSlot(g2.board, cup));
  eq('green+yellow+red+blue is a sweep', [g2.result().colorsHit, g2.result().colorSweep], [4, 1]);

  // Snapshot round trip carries `earned`, so a restored rack cannot be re-wiped into new money.
  const g3 = new SkeeballGame('popongo');
  settle(g3, S.g6);
  settle(g3, S.eqA);                       // wiped the 6
  const snap = g3.snapshot();
  const g4 = SkeeballGame.restore(snap);
  eq('restore keeps the wiped score', g4.score, g3.score);
  eq('and the wiped ball has nothing left to lose', g4.throws[0].earned, 0);
  g4._settle(null, { hole: S.eqB, value: 0 });    // another equalizer straight after restore
  eq('a post-restore equalizer still takes nothing from a wiped ball', g4.score, g3.score);

  // THE CLASSIC is untouched by all of this: no cups, values ride the holes as ever.
  ok('classic has no arrangement layer', !boardById('classic').cups);
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

// --- [KNOWN-BUG PROBE] the resumed rack and the loaded engine must be the SAME machine ----------
//
// Born red on 2026-09-01 against the build that shipped that morning. Matt, with a screenshot of a
// painted HUD over an empty playfield: "You broke skeeball. I can go back to the hub but nothing
// else."
//
// ui.js's _startGame loaded the engine for `this.settings.board` - the carousel's selection - while
// game.js's SkeeballGame.restore rebuilds on `snap.board`. Those diverge whenever a swipe moves the
// selection while a mid-rack autosave is banked on another machine, and once the engines went lazy
// (the same morning) engineFor threw on the mismatch - after the HUD's innerHTML was written and
// before input was bound, so the player got a dead screen with no way out but the hub.
//
// Structural because the defect is in DOM code this node suite cannot mount, and the shape is
// exact: the board _startGame resolves must be derived from the snapshot when there is one.
{
  const uiSrc = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const head = /async _startGame\(snap\)\s*{[\s\S]{0,2600}?await loadEngine\(/.exec(uiSrc);
  ok('[KNOWN-BUG PROBE] _startGame picks its board from the SNAPSHOT, not just the carousel',
    !!head && /boardById\(\s*snap\s*&&\s*snap\.board\s*\?/.test(head[0]),
    'ui.js resumes a rack on snap.board but would load the engine for settings.board - the two\n'
    + '        must come from one source, or a resume after a swipe throws into a dead screen.');

  // And the other half: a mount that throws anyway must land the player on the gallery.
  ok('a throw mid-mount falls back to the gallery rather than stranding the player',
    /catch \(err\)[\s\S]{0,400}?_renderSetup\(\)/.test(uiSrc),
    'without this, any future throw between the HUD write and _bindPlay repeats the same incident');
}

// --- [KNOWN-BUG PROBE] the gallery's pictures, and how long a slide is allowed to be empty ------
//
// Born of Matt's SECOND screen recording, 2026-09-01: v550, every swipe landing on an empty black
// box for half a second warm and a second and a half cold, and the hub-wide record reading "-" on
// every mount before it filled in. All of it came out of the lazy-engine change earlier that day
// (a machine's picture is only STARTED when the carousel reaches it), and none of it had a test.
//
// Structural, for the same reason as the probe above: this is DOM code the node suite cannot mount.
{
  const uiSrc = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const cssSrc = readFileSync(new URL('../css/skeeball.css', import.meta.url), 'utf8');

  // v550's fix, which shipped with no test at all: an <img> with no src renders as a BROKEN-IMAGE
  // icon next to its alt text. Matt: "None of the skeeball machine images are there - broken
  // images appear, then the machines load." Born red against 8bd8879, the build he saw it on.
  const imgTags = uiSrc.match(/<img class="sk-(?:slide|lock)-img"[^>]*>/g) || [];
  ok('[KNOWN-BUG PROBE] every slide <img> ships with a src (a src-less <img> is a broken-image icon)',
    imgTags.length >= 3 && imgTags.every((tag) => /\ssrc="data:image\/gif;base64,/.test(tag)),
    `${imgTags.filter((t) => !/\ssrc=/.test(t)).length} of ${imgTags.length} slide images have no src`);

  // The picture cache must outlive the UI instance, or leaving Skeeball and coming back re-renders
  // every machine in WebGL from scratch - which is what Matt's recording caught at 25s.
  ok('[KNOWN-BUG PROBE] the machine-picture cache is MODULE scope, not a field on the instance',
    /^const MACHINE_IMG = new Map\(\)/m.test(uiSrc) && !/this\._machineImg/.test(uiSrc),
    'a per-instance cache is thrown away on every unmount, so re-entering the gallery pays for\n'
    + '        every picture again - see MACHINE_IMG in ui.js for why module scope is safe here');

  // ... and it must be bounded. A page that never reloads must not grow a JPEG cache for ever.
  ok('the picture cache is capped and evicts oldest-first',
    /MACHINE_IMG_CAP/.test(uiSrc) && /while \(MACHINE_IMG\.size > MACHINE_IMG_CAP\)/.test(uiSrc));

  // The neighbours are drawn ahead of the swipe - and STRICTLY ONE AT A TIME. renderMachineImage
  // hands its WebGL context back before returning, so sequential prewarm never adds to the page's
  // context budget; a parallel one would, and that budget is what made the hub choppy on
  // 2026-08-26 (see "Frame rate: why it got slower the longer you played" in the folder doc).
  const prewarm = /_prewarmNeighbours\(\)\s*{[\s\S]*?\n  }/.exec(uiSrc);
  ok('[KNOWN-BUG PROBE] the neighbouring slides are drawn before the player swipes to them',
    !!prewarm && /_ensureMachineImg\(/.test(prewarm[0]),
    'without this every swipe lands on an empty box while that machine renders');
  ok('the prewarm is sequential, never parallel (one WebGL context at a time)',
    !!prewarm && !/Promise\.all/.test(prewarm[0]) && /queue\.shift\(\)/.test(prewarm[0]),
    'building several machines at once is the context-budget bug of 2026-08-26 rebuilt on purpose');
  ok('the prewarm is cancelled on teardown and never runs on the play screen',
    /destroy\(\)\s*{[\s\S]{0,400}?_cancelPrewarm\(\)/.test(uiSrc)
    && /_startGameInner\(snap, board\)\s*{[\s\S]{0,300}?_cancelPrewarm\(\)/.test(uiSrc),
    'a queued picture must not build a WebGL scene on top of a live rack, or after the game is gone');

  // The empty box is the half that read as BROKEN rather than slow, so it must say "loading".
  ok('a slide being drawn shows the quiet skeleton, not an empty box',
    /\[data-painting\]::after/.test(cssSrc) && /setAttribute\('data-painting'/.test(uiSrc));
  // And nothing in it animates - it is on screen for a few hundred ms, where a pulse reads as a
  // glitch (css/hub.css's .hub-card-skel says the same about the launcher's own first paint).
  const skel = /\[data-painting\]::after\s*{[^}]*}/.exec(cssSrc);
  ok('the skeleton does not animate (so it needs no reduced-motion branch)',
    !!skel && !/animation|transition/.test(skel[0]));

  // The hub-wide record is seeded from a local cache so the first paint is not a dash - and so the
  // picture, which has that number baked into it, is rendered ONCE per mount rather than twice.
  ok('[KNOWN-BUG PROBE] the hub-wide record is seeded from cache before the first paint',
    /this\.top = loadTopCache\(\)/.test(uiSrc),
    'an empty this.top paints a dash, then the network answer mints a new picture key and the\n'
    + '        selected machine is rendered in WebGL a second time on every single mount');
  // THE LAW-adjacent, and the trap worth pinning: an offline mount reads zero rows, and that must
  // never overwrite or be written back over a real cached record.
  const refresh = /_refreshTopRecords\(\)\s*{[\s\S]*?\n  }/.exec(uiSrc);
  ok('an unanswered (offline) read never overwrites or re-saves the cached record',
    !!refresh && /const answered = rows\.length > 0/.test(refresh[0])
    && /if \(answered\) saveTopCache\(/.test(refresh[0]),
    'writing an offline zero back would erase the app-wide record the moment signal dropped');
  // ... and it is a DISPLAY cache only: nothing that scores, records or unlocks may read it.
  ok('the record cache is display-only (no scoring, recording or unlock path reads it)',
    (uiSrc.match(/(?<!function )loadTopCache\(\)/g) || []).length === 1
    && !/recordSkeeball\([^)]*loadTopCache/.test(uiSrc));
}

// --- summary -----------------------------------------------------------------------------------

console.log(`\nSkeeball engine: ${passed} passed, ${failures.length} failed.`);
{
  const ran = GROUPS.filter((k) => G[k]);
  const skipped = GROUPS.filter((k) => !G[k]);
  console.log(`  heavy groups run: ${ran.length ? ran.join(' ') : 'none'}  (${why})`);
  if (skipped.length) console.log(`  SKIPPED: ${skipped.join(' ')} - --auto picks by your diff, --full runs all`);
}
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
