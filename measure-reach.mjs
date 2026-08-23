// How far up the face does a throw actually get? Run the real engine with NO holes in the board,
// so nothing captures, and record the highest face-v the ball reaches. That curve is the ladder:
// put a hole where you want a band to start and the band is that wide, by construction.
import { startThrow, step } from './skeeball/js/machines/classic/physics.js';
import { buildMachine } from './skeeball/js/machines/classic/machine.js';
import { BOARDS } from './skeeball/js/boards.js';

const mn = Number(process.argv[2] || BOARDS[0].geom.minSpeed);   // default from boards.js, never a stale literal
const mx = Number(process.argv[3] || BOARDS[0].geom.maxSpeed);   // default from boards.js, never a stale literal
const base = BOARDS[0];
const board = {
  ...base, id: `reach-${mn}-${mx}`,
  geom: { ...base.geom, minSpeed: mn, maxSpeed: mx, holes: {} },
};
const M = buildMachine(board.geom);
const sinT = Math.sin(M.tilt), cosT = Math.cos(M.tilt);
const faceV = (p) => (p.y - M.lipY) * sinT - (p.z - M.lipZ) * cosT;

const rows = [];
for (let i = 0; i <= 20; i++) {
  const p = i / 20;
  const st = startThrow(board, { power: p, aim: 0 });
  let maxV = -1;
  let guard = 4000;
  while (!st.done && guard-- > 0) {
    step(board, st, 1 / 240);
    maxV = Math.max(maxV, faceV(st.ball.position));
  }
  rows.push({ p: +p.toFixed(2), maxV: +maxV.toFixed(3) });
}
console.log(`minSpeed=${mn} maxSpeed=${mx}   (board face is 0 .. ${base.geom.boardLen}m up the slope)`);
console.log('  power   highest face-v reached');
for (const r of rows) {
  const bar = r.maxV > 0 ? '#'.repeat(Math.max(0, Math.round(r.maxV * 40))) : '';
  console.log(`   ${r.p.toFixed(2)}   ${r.maxV.toFixed(3).padStart(6)}  ${bar}`);
}
// Where to put four holes so the four bands are equal in POWER.
const lo = rows.find((r) => r.maxV > 0.02);
const top = rows[rows.length - 1].maxV;
console.log(`\n  reaches the face from power ${lo ? lo.p : '?'};  top of the dial reaches v=${top.toFixed(3)}`);
const at = (pw) => {
  const i = Math.min(rows.length - 2, Math.max(0, Math.floor(pw * 20)));
  const a = rows[i], b = rows[i + 1];
  const f = (pw * 20) - i;
  return a.maxV + (b.maxV - a.maxV) * f;
};
console.log('  equal-band hole positions (the v reached at power .10/.35/.60/.85):');
console.log(`    ${[0.10, 0.35, 0.60, 0.85].map((q) => at(q).toFixed(3)).join('  ')}`);
