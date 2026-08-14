// measure-arc.mjs - is the ball actually FLYING, and where does it come down?
//
//   node measure-arc.mjs                     the shipped classic board
//   node measure-arc.mjs '{"humpAngles":[...]}'   with geom overrides
//
// WHY THIS EXISTS. On 2026-08-14 the ramp was flattened to stop the ball sailing over the whole
// board, and it was flattened too far: the launch angle ended up SHALLOWER than the board's own
// tilt, which makes an arc geometrically impossible. A ball launched at 17 degrees at a face
// that rises at 32 degrees cannot get above that face - it meets the bottom edge and rolls from
// there, every time, at every power. `tune-ladder.mjs --touch` reported that as 101/101 "touched
// the scoring face" and called it a win, which is how a metric that was pointing the wrong way
// got optimised all the way to 100%.
//
// So this measures the thing that number could not see: how high the ball gets ABOVE the board's
// plane, and how far up the board it is when it first comes down onto it. For skeeball those two
// are the game - the ball leaves the ramp, flies, and drops in.
//
// THE RULE THIS EXISTS TO ENFORCE: the launch angle must EXCEED `boardTilt`, or there is no arc
// at any power. Range up the slope for a projectile onto an incline is
//     R = 2 v^2 cos(t) sin(t - a) / (g cos^2(a))
// which is zero at t = a and negative below it. Everything else here is tuning; that is geometry.

import { startThrow, step } from './skeeball/js/physics.js';
import { buildMachine } from './skeeball/js/machine.js';
import { BOARDS } from './skeeball/js/boards.js';

const overrides = JSON.parse(process.argv.find((a) => a.startsWith('{')) || '{}');
const base = BOARDS[0];
const board = { ...base, id: `arc-${Math.round(Math.random() * 1e9) || 1}`, geom: { ...base.geom, ...overrides } };
const G = board.geom;
const M = buildMachine(G);
const sinT = Math.sin(M.tilt);
const cosT = Math.cos(M.tilt);
const face = (p) => ({
  v: (p.y - M.lipY) * sinT - (p.z - M.lipZ) * cosT,
  h: (p.y - M.lipY) * cosT + (p.z - M.lipZ) * sinT,
});

const launch = Math.max(...G.humpAngles);
console.log(`launch angle ${launch.toFixed(2)} rad (${(launch * 180 / Math.PI).toFixed(0)} deg)  vs  boardTilt ${G.boardTilt.toFixed(2)} rad (${(G.boardTilt * 180 / Math.PI).toFixed(0)} deg)`);
if (launch <= G.boardTilt) {
  console.log('  ** LAUNCH IS SHALLOWER THAN THE BOARD: no arc is possible at any power. **');
} else {
  console.log(`  ok: launch clears the board's tilt by ${((launch - G.boardTilt) * 180 / Math.PI).toFixed(0)} degrees`);
}
console.log('');
console.log(' power  peak height    airborne   lands at   final   flight   (holes at v=' +
  Object.values(G.holes).map((h) => h.v.toFixed(2)).filter((v, i, a) => a.indexOf(v) === i).sort().join('/') + ')');
console.log('        over the face  over face  face-v     hole');

const rows = [];
for (let i = 0; i <= 20; i++) {
  const p = i / 20;
  const st = startThrow(board, { power: p, aim: 0 });
  let peak = -9;          // max h above the face while over the board's length
  let landAt = null;      // face-v at first contact with the face
  let airborne = 0;       // seconds spent clear of the face, over the board
  let guard = 5000;
  while (!st.done && guard-- > 0) {
    step(board, st, 1 / 240);
    const f = face(st.ball.position);
    if (f.v > 0 && f.v < G.boardLen) {
      if (f.h > peak) peak = f.h;
      if (f.h > G.ballR * 1.35) airborne += 1 / 240;
      if (landAt === null && f.h <= G.ballR * 1.12) landAt = f.v;
    }
  }
  rows.push({
    p: +p.toFixed(2),
    peak: peak < -8 ? null : +(peak - G.ballR).toFixed(3),   // clearance of the ball's underside
    air: +airborne.toFixed(3),
    landAt: landAt === null ? null : +landAt.toFixed(3),
    hole: st.outcome ? st.outcome.hole : 'RETURNED',
    t: +st.t.toFixed(2),
  });
}
for (const r of rows) {
  const bar = r.peak == null ? '' : '#'.repeat(Math.max(0, Math.round(r.peak * 120)));
  console.log(`  ${r.p.toFixed(2)}   ${String(r.peak == null ? '  -  ' : r.peak.toFixed(3)).padStart(6)}m  ${String(r.air.toFixed(2)).padStart(6)}s   ${String(r.landAt == null ? ' -- ' : r.landAt.toFixed(3)).padStart(6)}   ${String(r.hole).padEnd(8)} ${r.t.toFixed(2)}s ${bar}`);
}
const flown = rows.filter((r) => r.peak != null && r.peak > 0.02).length;
const landedHigh = rows.filter((r) => r.landAt != null && r.landAt > 0.10).length;
console.log(`\n  throws that genuinely got airborne over the board (>2cm clearance): ${flown}/${rows.length}`);
console.log(`  throws that first touched the board ABOVE its bottom edge (v > 0.10): ${landedHigh}/${rows.length}`);
console.log(`  landing spread: ${rows.filter((r) => r.landAt != null).length ? Math.min(...rows.filter((r) => r.landAt != null).map((r) => r.landAt)).toFixed(2) + ' .. ' + Math.max(...rows.filter((r) => r.landAt != null).map((r) => r.landAt)).toFixed(2) : 'n/a'}`);
