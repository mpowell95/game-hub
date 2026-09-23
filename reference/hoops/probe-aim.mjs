// probe-aim.mjs - HOW EASY IS IT TO GET THE ONE YOU AIM FOR?
//
// Matt, 2026-09-23: "it's a little too easy again." The power x aim grid (probe-rim.mjs) cannot
// answer this - it throws evenly at every combination, including ones nobody aims for. This throws
// the shot a player ACTUALLY lines up: for each column, the measured aim that column's baskets come
// from (cpu.js COLUMN_AIM) at that column's best power, many times with the real release jitter
// (a fresh seed per shot, exactly as ui.js shoots). Result per column: in the column you aimed at /
// another column / nothing.
//
// node reference/hoops/probe-aim.mjs [--set=k=v,...] [--shots=N]
import { BOARD } from '../../hoops4/js/boarddef.js';
import { simulateThrow } from '../../hoops4/js/physics.js';
import { COLUMN_AIM } from '../../hoops4/js/cpu.js';

const args = process.argv.slice(2);
const SHOTS = +((args.find((a) => a.startsWith('--shots=')) || '--shots=60').slice(8));
const sets = args.filter((a) => a.startsWith('--set=')).map((a) => a.slice(6));
const RUNS = sets.length ? sets.map((sp, i) => {
  const b = structuredClone(BOARD); b.id = 'probe-aim-' + i;
  for (const kv of sp.split(',')) { const [k, v] = kv.split('='); if (k in b.geom.mat) b.geom.mat[k] = +v; else b.geom[k] = +v; }
  return { tag: sp, board: b };
}) : [{ tag: 'as shipped', board: BOARD }];
const pct = (n, d) => (100 * n / d).toFixed(0).padStart(3) + '%';

for (const { tag, board } of RUNS) {
  const G = board.geom;
  let T = 0, O = 0, N = 0, all = 0;
  const rows = [];
  for (let c = 0; c < 7; c++) {
    const aim = COLUMN_AIM[c], want = 'c' + (c + 1);
    // this column's best power, found once without jitter
    let bestP = 0.5, bestHit = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      let hit = 0;
      for (let s = 0; s < 8; s++) { const r = simulateThrow(board, { power: p, aim, seed: 9000 + s }); if (r.outcome && r.outcome.hole === want) hit++; }
      if (hit > bestHit) { bestHit = hit; bestP = p; }
    }
    let t = 0, o = 0, n = 0;
    for (let s = 0; s < SHOTS; s++) {
      const r = simulateThrow(board, { power: bestP, aim, seed: 1 + s * 7919 + c * 104729 });
      const h = r.outcome && G.holes[r.outcome.hole] ? r.outcome.hole : null;
      if (h === want) t++; else if (h) o++; else n++;
    }
    T += t; O += o; N += n; all += SHOTS;
    rows.push(`  col ${c + 1}  power ${bestP.toFixed(2)}   aimed ${pct(t, SHOTS)}   other ${pct(o, SHOTS)}   nothing ${pct(n, SHOTS)}`);
  }
  console.log(`\n=== ${tag}  (${all} aimed shots)`);
  console.log(`ALL    aimed column ${pct(T, all)}   another column ${pct(O, all)}   nothing ${pct(N, all)}`);
  console.log(rows.join('\n'));
}
