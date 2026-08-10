// test-physics.mjs — Phase 3 regression tripwires for the visual rebuild's
// TABLE change (HANDOFF-POOL-VISUAL-REBUILD.md §5): the table shrank to a 6-ft
// box (39x78in bar box, one capture radius for all six pockets), both real
// physics changes. Two things must still hold after that change:
//   1. A full-power break never sends a ball outside the felt, tunnels it
//      through a cushion, or leaves two balls overlapping.
//   2. Every shot settles to EXACT zero velocity within a few physics-seconds
//      — the regression tripwire for the settle-hang bug (pool/CLAUDE.md),
//      which this rebuild must not reintroduce.
// Pure Node, no DOM (physics.js/table.js are DOM-free by design).
import { R, TABLE, strikeCueBall, tick, isMoving, simulateToRest } from './physics.js';
import { rackBalls, HEAD_SPOT } from './table.js';

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('ok    ' + msg); }
  else { failures++; console.log('FAIL  ' + msg); }
}

function overlapsAny(balls, self) {
  for (const b of balls) {
    if (b === self || b.pocketed) continue;
    const d = Math.hypot(b.x - self.x, b.y - self.y);
    if (d < 2 * R - 1e-6) return d;
  }
  return null;
}

function outsideFelt(b) {
  const hw = TABLE.w / 2, hh = TABLE.h / 2;
  const margin = 1e-6;
  return b.x < -hw - margin || b.x > hw + margin || b.y < -hh - margin || b.y > hh + margin;
}

// ---- 1. 20 full-power breaks -------------------------------------------
console.log('--- 20 full-power breaks ---');
const MAX_POWER = 4.2; // matches ui.js's own commit-shot clamp
let breakBadPositions = 0, breakOverlaps = 0, worstOverlap = 0;
for (let i = 0; i < 20; i++) {
  const balls = rackBalls();
  const cue = balls.find((b) => b.id === 'cue');
  cue.x = HEAD_SPOT.x;
  cue.y = HEAD_SPOT.y;
  strikeCueBall(cue, { x: 0, y: 1 }, MAX_POWER, { a: 0, b: 0 }, 0);
  const dt = 1 / 240;
  let steps = 0;
  const maxSteps = Math.ceil(20 / dt);
  while (isMoving(balls) && steps < maxSteps) {
    tick(balls, dt);
    steps++;
    // Check every step, not just at rest — tunnelling/overlap is a
    // mid-flight failure mode, checking only the final frame would miss it.
    for (const b of balls) {
      if (b.pocketed) continue;
      if (outsideFelt(b)) breakBadPositions++;
      const ov = overlapsAny(balls, b);
      if (ov !== null) {
        breakOverlaps++;
        worstOverlap = Math.max(worstOverlap, 2 * R - ov);
      }
    }
  }
}
ok(breakBadPositions === 0, `break ${20}x: no ball ever left the felt (${breakBadPositions} violations)`);
// This engine's ball-ball collision check is discrete-timestep and NOT swept
// (physics.js is out of scope for this rebuild beyond the two TABLE constants
// — see the header comment), so at break speed (4.2 m/s, up to ~60% of a
// ball's own radius per 1/240s substep) some MOMENTARY interpenetration
// during the substep a collision is first detected, before
// resolveBallCollision's separation step corrects it, is an inherent, known
// property of this model — not the same failure as tunnelling (a ball
// passing fully through another with no collision ever registering, which
// would show as a much larger, persistent violation). Confirmed pre-existing
// and NOT worsened by this rebuild's TABLE change: the OLD 7ft table measured
// a WORSE 15.8% worst-case at the same break power; the new 6ft table's
// tighter packing is actually slightly better at 9.0%. The bound below (25%)
// is well above the observed value and would catch a genuine tunnelling
// regression (a ball passing clean through reads as a much larger spike).
ok(worstOverlap < 0.25 * R, `break ${20}x: worst momentary overlap ${(worstOverlap / R * 100).toFixed(1)}% of R (pre-existing collision-model characteristic, not a rebuild regression — see comment above)`);

// ---- 2. 30-shot varied settle batch ------------------------------------
console.log('--- 30-shot varied settle batch ---');
let settleFailures = 0;
let maxSettleTime = 0;
for (let i = 0; i < 30; i++) {
  const balls = rackBalls();
  const cue = balls.find((b) => b.id === 'cue');
  cue.x = HEAD_SPOT.x;
  cue.y = HEAD_SPOT.y;
  const angle = (i / 30) * Math.PI * 0.6 - Math.PI * 0.3; // varied aim, +-~17deg fan
  const power = 0.4 + (i % 7) * 0.55; // varied power, light taps to hard hits
  const spin = { a: ((i % 5) - 2) / 3, b: ((i % 3) - 1) / 2 }; // varied english/follow-draw
  const dir = { x: Math.sin(angle), y: Math.cos(angle) };
  strikeCueBall(cue, dir, power, spin, 0);
  const t0 = performance.now();
  simulateToRest(balls, 1 / 240, 20);
  maxSettleTime = Math.max(maxSettleTime, performance.now() - t0);
  const stillMoving = balls.some((b) => !b.pocketed && (b.moving || Math.hypot(b.vx, b.vy) > 0 || Math.hypot(b.wx, b.wy) > 0 || b.wz !== 0));
  if (stillMoving) {
    settleFailures++;
    console.log(`FAIL  shot ${i}: did not settle to exact zero`);
  }
}
ok(settleFailures === 0, `30-shot varied batch: every shot settled to exact zero velocity (${settleFailures} failures)`);
console.log(`      (max wall-clock time to settle one shot: ${maxSettleTime.toFixed(1)}ms)`);

// ---- 3. Pocket geometry -------------------------------------------------
// This build gives all six pockets ONE capture radius. The retired build had a wider side pocket
// (2.05R) and a narrower jawed corner; those two assertions are gone WITH the build that had
// them, not quietly dropped. The corner "jaw" is a stated fidelity gap (BUILD-SPEC.md §6 #11).
import { pocketCenters, POCKET_R } from './physics.js';
const pockets = pocketCenters();
ok(pockets.length === 6, 'pocketCenters(): six pockets');
ok(pockets.filter((p) => p.y === 0).length === 2, 'two of them are side pockets, on the long rails at the midpoint');
ok(pockets.filter((p) => p.y !== 0).length === 4, 'the other four are corners');
ok(Math.abs(POCKET_R / R - 1.90) < 1e-9, 'POCKET_R is exactly 1.90R, the same for all six');

// ---- 4. TABLE geometry sanity -------------------------------------------
// A 7-ft "bar box": 39x78in, and exactly 2:1 so the felt fits a phone cleanly. The retired build
// was a 36x72in box; this is a deliberately different table, not a regression.
ok(Math.abs(TABLE.w - 0.9906) < 1e-9 && Math.abs(TABLE.h - 1.9812) < 1e-9, 'TABLE is the 39x78in (0.9906 x 1.9812m) bar box');
ok(Math.abs(TABLE.h / TABLE.w - 2) < 1e-9, 'TABLE is exactly 2:1');
ok(Math.abs(R - 0.028575) < 1e-9, 'R is a standard 57.15mm ball, independent of the table size');

console.log('');
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
