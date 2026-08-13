// skeeball/js/test.js - headless assertions for the PHYSICS engine and the rules around it.
// Run: node skeeball/js/test.js   (also part of run-all-tests.mjs)
//
// THE 2026-08-12 CONTRACT (Matt): "I wanted it to be able to miss a hole and bounce like in real
// life. And like in 'correct bouncing.mov'". Scoring is EMERGENT from simulation - resolveThrow
// does not exist any more; gravity decides. So these tests pin PHYSICAL truths (deterministic,
// terminates, bounces happen, the ball ends inside the hole that scored) and HAND truths (the
// speed bands a thumb must hit, measured in canvas-heights/second through the real flick
// mapping), not tables.

import { Game, BALLS_PER_RACK, MULTIPLIER, flickToThrow, FLICK, throwSim, findThrow, machineFor } from './game.js';
import { simulate, buildMachine, BALL_R } from './physics.js';
import { BOARDS, boardById, multTargetsFor, nextBoard, DEFAULT_BOARD } from './boards.js';

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}`); if (!cond) fails += 1; };
const eq = (name, got, want) => ok(`${name} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

const classic = boardById('classic');
const MC = machineFor('classic');

// A real flick gesture -> a throw, so the hand-unit blocks go through the REAL mapping.
const MS = 130;
const gestureAt = (chs, deg = 0) => {
  const a = (deg * Math.PI) / 180;
  const d = chs * (MS / 1000);
  return { dx: d * Math.sin(a), dy: -d * Math.cos(a), vx: chs * Math.sin(a), vy: -chs * Math.cos(a) };
};
const throwAt = (chs, deg = 0, boardId = 'classic') => {
  const f = flickToThrow(gestureAt(chs, deg));
  return f ? throwSim(boardId, f.v0, f.dir) : null;
};

console.log('-- every board is well formed --');
for (const b of BOARDS) {
  const rings = b.geom.rings;
  ok(`${b.id}: has a name key and a palette`, !!b.nameKey && !!b.palette && !!b.palette.wall);
  ok(`${b.id}: ring ids are unique`, new Set(rings.map((r) => r.id)).size === rings.length);
  ok(`${b.id}: every OPENING fits the ball - a hole the ball cannot pass is a lie`,
    rings.every((r) => r.basin || r.R > BALL_R * 1.15));
  ok(`${b.id}: every cup collar is LOWER than the ball's centre, so a slow roll can tip in`,
    rings.every((r) => r.basin || r.h < BALL_R));
  ok(`${b.id}: the basin wall (if any) is taller than the ball's centre, so it contains`,
    rings.every((r) => !r.basin || (r.wallHigh && r.h > BALL_R * 1.5)));
  ok(`${b.id}: has a bottom trough drain, so the outer board always resolves`,
    b.geom.drains.some((d) => !d.insideOf && d.w0 <= 0));
  ok(`${b.id}: the badge list is every scoring cup and never the 10`,
    multTargetsFor(b).length >= 4 && !multTargetsFor(b).includes(b.geom.drainId));
}

console.log('\n-- the flick: speed IS the launch speed, angle IS the direction --');
{
  const soft = flickToThrow(gestureAt(2.0));
  const hard = flickToThrow(gestureAt(4.0));
  ok('a faster flick launches faster - no blending, no curve',
    hard.v0 > soft.v0 && Math.abs(hard.v0 / soft.v0 - 2) < 0.05);
  eq('the mapping is the one constant', Math.round(soft.v0 * 1000), Math.round(2.0 * FLICK.MPS_PER_CHS * 1000));
  const aimed = flickToThrow(gestureAt(3.0, 10));
  const aimedHard = flickToThrow(gestureAt(5.0, 10));
  ok('the direction is the swipe angle, identical at any speed',
    Math.abs(aimed.dir - aimedHard.dir) < 1e-9 && Math.abs(aimed.dir - (10 * Math.PI) / 180) < 1e-6);
  ok('a tap is not a throw', flickToThrow(gestureAt(0.2)) === null);
  ok('yanking the finger back down cancels', flickToThrow({ dx: 0, dy: -0.4, vx: 0, vy: 2.5 }) === null);
  ok('garbage is not a throw', flickToThrow({ dx: NaN, dy: 0, vx: 0, vy: 0 }) === null);
  ok('launch speed is clamped to a real arm', flickToThrow(gestureAt(30)).v0 <= FLICK.V_MAX);
}

console.log('\n-- determinism: same flick, same everything --');
{
  const a = simulate(3.7, 0.04, MC);
  const b = simulate(3.7, 0.04, MC);
  eq('same outcome', a.outcome, b.outcome);
  ok('same flight, frame for frame', a.frames.length === b.frames.length
    && a.frames.every((f, i) => f.x === b.frames[i].x && f.y === b.frames[i].y && f.z === b.frames[i].z));
}

console.log('\n-- every throw terminates, on every machine --');
for (const b of BOARDS) {
  let timeouts = 0, maxT = 0, n = 0;
  for (let v = 1.2; v <= 7.4; v += 0.06) {
    for (const d of [-0.28, -0.18, -0.09, -0.03, 0, 0.03, 0.09, 0.18, 0.28]) {
      const r = simulate(v, d, buildMachine(b.geom));
      n += 1;
      maxT = Math.max(maxT, r.settleT);
      if (r.events.some((e) => e.type === 'timeout')) timeouts += 1;
      if (!(r.outcome.points > 0 || r.outcome.kind === 'short')) timeouts += 1000; // zero that isn't a roll-back
    }
  }
  ok(`${b.id}: ${n} throws, zero timeouts, zero stuck balls (worst settle ${maxT.toFixed(1)}s)`,
    timeouts === 0 && maxT < 7.9);
}

console.log('\n-- [KNOWN-BUG PROBE] CORRECT BOUNCING (the reference clip is the contract) --');
{
  // 1. Rim bounces are COMMON - the cup openings are ~1.7 ball diameters, so near-misses clip
  //    the collar and deflect. A build where nothing ever touches a rim has drifted back to
  //    table-lookup feel and must fail here.
  let rims = 0, tot = 0, rimStillScores = 0, rimElsewhere = 0;
  for (let v = 2.8; v <= 6.4; v += 0.12) {
    for (let d = -0.22; d <= 0.221; d += 0.04) {
      const r = simulate(v, d, MC);
      tot += 1;
      const rimmed = r.events.filter((e) => e.type === 'rim' && e.ring !== 'big');
      if (rimmed.length) {
        rims += 1;
        if (r.outcome.points > 0) rimStillScores += 1;
        if (r.outcome.target && rimmed.every((e) => e.ring !== r.outcome.target)) rimElsewhere += 1;
      }
    }
  }
  ok(`rim hits happen constantly (${Math.round(100 * rims / tot)}% of a coarse grid; need >= 25%)`,
    rims / tot >= 0.25);
  ok('every rim bounce still ends in a hole - deflected, never deleted', rimStillScores === rims);
  // Most rim contacts rattle into the ring they clipped (also physical); a healthy minority
  // deflect somewhere else entirely, which is the clip's own story.
  ok(`and a deflection can change the outcome, like the clip's 40-rim into the 20 (${rimElsewhere} of ${rims})`,
    rimElsewhere >= Math.max(15, rims * 0.1));

  // 2. The clip's own choreography: some throw must clip a HIGH ring and end in a LOW one,
  //    having visibly travelled the basin in between (>= 0.8s from rim to rest).
  let clipLike = 0;
  for (let v = 3.2; v <= 5.6; v += 0.06) {
    for (const d of [-0.05, -0.025, 0.025, 0.05]) {
      const r = simulate(v, d, MC);
      const rim = r.events.find((e) => e.type === 'rim' && ['30', '40', '50'].includes(e.ring));
      if (rim && ['20', '10'].includes(r.outcome.target) && r.settleT - rim.t >= 0.8) clipLike += 1;
    }
  }
  ok(`the reference throw exists in this engine: rim a high ring, rattle, settle low (${clipLike} found)`,
    clipLike >= 3);

  // 3. Physics never invents energy: across a sweep, the ball's speed right after any rim
  //    bounce is never higher than right before it.
  let gained = 0;
  for (let v = 3.0; v <= 6.0; v += 0.2) {
    const r = simulate(v, 0.03, MC);
    for (const e of r.events) {
      if (e.type !== 'rim') continue;
      const before = r.frames.filter((f) => f.t < e.t).slice(-2);
      const after = r.frames.filter((f) => f.t > e.t).slice(0, 2);
      if (before.length === 2 && after.length === 2) {
        const sp = (p) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y, p[1].z - p[0].z) / Math.max(1e-6, p[1].t - p[0].t);
        if (sp(after) > sp(before) * 1.12) gained += 1;   // 12% tolerance: frame quantisation
      }
    }
  }
  ok('no bounce ever speeds the ball up', gained === 0);
}

console.log('\n-- the ball ends INSIDE the hole that scored (what you see is what you score) --');
{
  let checked = 0, outside = 0;
  for (const b of BOARDS) {
    const M = buildMachine(b.geom);
    for (let v = 2.2; v <= 6.8; v += 0.08) {
      for (const d of [-0.15, -0.05, 0, 0.05, 0.15]) {
        const r = simulate(v, d, M);
        if (r.outcome.kind !== 'hit') continue;
        checked += 1;
        // The last pre-sink frame, in plane coordinates.
        const last = r.frames.filter((f) => !f.sink).pop();
        const beta = M.beta;
        const du = { x: last.x - M.B.x, y: last.y - M.B.y, z: last.z - M.B.z };
        const u = du.x, w = du.y * Math.cos(beta) + du.z * Math.sin(beta);
        if (r.outcome.target === M.drainId) {
          const inDrain = M.drains.some((dr) => u >= dr.u0 - BALL_R && u <= dr.u1 + BALL_R
            && w >= dr.w0 - BALL_R && w <= dr.w1 + BALL_R);
          const belowLane = last.y < 0.05;
          if (!inDrain && !belowLane) outside += 1;
        } else {
          const ring = M.rings.find((z) => z.id === r.outcome.target);
          const rho = Math.hypot(u - ring.c[0], w - ring.c[1]);
          if (rho > ring.R + 0.005) outside += 1;
        }
      }
    }
  }
  ok(`every one of ${checked} scoring throws finished inside its own hole (${outside} did not)`,
    outside === 0);
}

console.log('\n-- the ladder, in the units a HAND controls (canvas-heights/second) --');
{
  // First reachable ring per flick speed, straight. The ladder must climb in order and each
  // step must be a speed difference a thumb can produce on purpose (>= 6% per step).
  const firstAt = {};
  for (let chs = 0.6; chs <= 6.0; chs += 0.02) {
    const r = throwAt(chs);
    const k = r ? (r.outcome.target || 'short') : 'none';
    if (!(k in firstAt)) firstAt[k] = chs;
  }
  ok(`too feeble rolls back (short until ${(firstAt['10'] || 0).toFixed(2)} ch/s)`,
    firstAt.short < firstAt['10']);
  const order = ['10', '20', '30', '40', '50'];
  ok(`the ladder climbs in order (${order.map((id) => `${id}@${(firstAt[id] || 0).toFixed(2)}`).join(' ')})`,
    order.every((id, i) => i === 0 || (firstAt[id] || 99) > (firstAt[order[i - 1]] || 0)));
  ok('each rung is a real speed step a thumb can pick (>= 6%)',
    order.every((id, i) => i === 0 || (firstAt[id] - firstAt[order[i - 1]]) / firstAt[order[i - 1]] >= 0.06));
  ok('the 100s are NOT on the straight ladder - they need a deliberate diagonal',
    !('100L' in firstAt) && !('100R' in firstAt));
  const f100 = findThrow('100L');
  ok(`but a deliberate diagonal finds them (v ${f100 ? f100.v0.toFixed(1) : '-'} m/s at ${f100 ? (f100.dir * 57.3).toFixed(1) : '-'} deg)`,
    !!f100 && Math.abs(f100.dir) > 0.04);

  // A casual hand: +-12% on speed, +-2 degrees on angle, aiming the 50's first band. This is
  // the number Matt experiences. His recordings of the table-driven builds averaged ~90 a rack.
  let s = 4242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => { let u = 0, w = 0; while (!u) u = rnd(); while (!w) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  const aimChs = firstAt['50'] + 0.15;
  let sum = 0, zeros = 0; const N = 1200;
  for (let i = 0; i < N; i++) {
    const r = throwAt(aimChs * (1 + gauss() * 0.12), gauss() * 2);
    sum += r ? r.outcome.points : 0;
    if (!r || !r.outcome.points) zeros += 1;
  }
  const perRack = (sum / N) * BALLS_PER_RACK;
  ok(`a casual hand averages a real rack: ${Math.round(perRack)} (need 140-340)`,
    perRack >= 140 && perRack <= 340);
  ok(`and almost never throws a zero: ${(100 * zeros / N).toFixed(1)}% (need < 4%)`, zeros / N < 0.04);
  // Muscle must not beat control.
  let slam = 0;
  for (let i = 0; i < N; i++) {
    const r = throwAt(6.0 * (1 + Math.abs(gauss() * 0.1)), gauss() * 2);
    slam += r ? r.outcome.points : 0;
  }
  ok(`slamming flat out scores less than aiming (${Math.round((slam / N) * BALLS_PER_RACK)} vs ${Math.round(perRack)})`,
    slam < sum * 0.85);
}

console.log('\n-- every ring is winnable on every machine --');
for (const b of BOARDS) {
  for (const r of b.geom.rings) {
    if (r.basin) continue;
    const f = findThrow(r.id, b.id);
    ok(`${b.id}/${r.id}: a throw exists that lands it`, !!f);
  }
}

console.log('\n-- a rack --');
{
  const g = new Game({ board: 'classic', rng: () => 0.99 });
  eq('nine balls', g.ballsLeft, 9);
  const f50 = findThrow('50');
  const f100 = findThrow('100L');
  const r1 = g.throwBall(f100.v0, f100.dir);
  eq('a 100 is worth 100 (badge parked elsewhere by the rng)', r1.points, 100);
  const r2 = g.throwBall(f50.v0, f50.dir);
  eq('a 50 lands the 50', r2.target, '50');
  ok('the sim rides along for the UI to play back', Array.isArray(r2.sim.frames) && r2.sim.frames.length > 30);
  eq('cups are tallied', g.tally.hundreds, 1);
  eq('so are 50s', g.tally.fifties, 1);
  eq('best throw is the biggest single one', g.tally.bestThrow, 100);
  for (let i = 0; i < 7; i++) g.throwBall(2.6, 0);
  ok('the rack ends after nine', g.over);
  eq('and none are left', g.ballsLeft, 0);
  ok('a throw after the end is refused, not scored', g.throwBall(3, 0) === null);
}

console.log('\n-- the multiplier --');
{
  // rng pinned so the badge sits on the FIRST badge-able target.
  const g = new Game({ board: 'classic', rng: () => 0 });
  const first = multTargetsFor(classic)[0];
  eq('the badge sits on a real cup', g.multTarget, first);
  const f = findThrow(first);
  const r = g.throwBall(f.v0, f.dir);
  eq(`hitting the multiplied target triples it (got ${r.scored})`, r.scored, r.points * MULTIPLIER);
  ok('and says so', r.multiplied);
  const g2 = new Game({ board: 'classic', rng: () => 0 });
  const f50 = findThrow('50');
  if (first !== '50') {
    const r2 = g2.throwBall(f50.v0, f50.dir);
    eq('missing it pays face value', r2.scored, r2.points);
  }
  // The badge reaches every cup over time.
  const seen = new Set();
  const g3 = new Game({ board: 'classic' });
  for (let i = 0; i < 400 && seen.size < multTargetsFor(classic).length; i++) { g3.rollMultiplier(); seen.add(g3.multTarget); }
  eq('and reaches every one of them over time', seen.size, multTargetsFor(classic).length);
}

console.log('\n-- unlocking --');
{
  ok('classic leads somewhere', !!nextBoard('classic'));
  const g = new Game({ board: 'classic' });
  for (let i = 0; i < 9; i++) g.throwBall(1.3, 0);      // nine feeble rolls
  eq('a rack of nothing scores nothing', g.score, 0);
  ok('and unlocks nothing', g.unlocks() === null);
  const g2 = new Game({ board: 'classic', rng: () => 0.99 });
  const f100 = findThrow('100L');
  for (let i = 0; i < 9; i++) g2.throwBall(f100.v0, f100.dir);
  eq('nine 100s is 900', g2.score, 900);
  ok('which clears the target and unlocks the next machine', g2.unlocks() === nextBoard('classic'));
  ok('the target is reachable but not trivial (a perfect rack is well over it)',
    nextBoard('classic').unlockScore < 900 && nextBoard('classic').unlockScore >= 300);
  const last = BOARDS[BOARDS.length - 1];
  const g3 = new Game({ board: last.id });
  g3.score = 99999; g3.over = true;
  ok('the final board unlocks nothing (no phantom next machine)', g3.unlocks() === null);
}

console.log('\n-- save and resume --');
{
  const g = new Game({ board: 'stars' });
  g.ball = 5; g.score = 800; g.tally = { balls: 4, hundreds: 2, fifties: 1, bestThrow: 300 };
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const back = Game.restore(snap);
  ok('a snapshot round-trips', !!back);
  eq('the score survives', back.score, 800);
  eq('the ball number survives', back.ball, 5);
  eq('the MACHINE survives', back.board.id, 'stars');
  eq('and so does the tally the recorder reads', back.tally.balls, 4);
  ok('a corrupt save is "no game to resume", never a crash', Game.restore({ v: 2, board: 9, ball: 'x' }) !== undefined);
  ok('so is nonsense', Game.restore('garbage') === null);
  ok('a v1 save from the vs-computer build is declined, not misread', Game.restore({ v: 1, score: 120 }) === null);
  const missing = Game.restore({ v: 2, board: 'classic', ball: 3 });
  eq('a save missing its score restores at zero rather than NaN', missing.score, 0);
}

console.log('');
if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
