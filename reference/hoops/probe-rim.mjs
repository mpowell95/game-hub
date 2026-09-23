// probe-rim.mjs - WHERE DOES A SHOT THAT ARRIVES AT A HOOP END UP, AND WHEN DOES IT GO THROUGH?
//
// Matt, 2026-09-22: "It's too easy to get the one you aim for. i want it bouncier. i don't want it
// to always bounce off and get nothing. I want it to have to be a perfect shot to go right in,
// otherwise it's like a 50-50 chance it bounces into the one you wanted or into a different one."
//
// So every throw is classified by the hoop it ARRIVED at - the first moment it comes down to rim
// height, before it has touched any rim - and by how far off that hoop's centre it was, as a
// fraction of the mouth radius. Then: did it end in THAT hoop, a DIFFERENT hoop, or NOTHING.
//   perfect   off < 0.25 r   (touches no rim: the mouth clears the ball by 0.25 r. Matt: "a perfect shot to go right in")
//   good      0.25 - 1.0 r   (over the mouth, not centred)
//   rim       1.0 - 1.75 r   (centre outside the mouth, ball still on the rim)
//   wide      beyond          (between hoops / nowhere near one)
// It also times the gap from `capture` and from `through` (the ball wholly below the rim) to the
// throw resolving, which is what the falling disc has to be synchronised with.
//
// node reference/hoops/probe-rim.mjs [--set=k=v,k=v ...] [--seeds=N]
// --set works like probe-bounce's (mat.* keys go to the materials, the rest to geom).
import { BOARD } from '../../hoops4/js/boarddef.js';
import { buildMachine } from '../../hoops4/js/machine.js';
import { startThrow, substep } from '../../hoops4/js/physics.js';

const P = +(process.env.POWERS || 11), A = +(process.env.AIMS || 21);
const args = process.argv.slice(2);
const SEEDS = +((args.find((a) => a.startsWith('--seeds=')) || '--seeds=1').slice(8));
const sets = args.filter((a) => a.startsWith('--set=')).map((a) => a.slice(6));
function variant(tag, over) {
  const b = structuredClone(BOARD);
  b.id = 'probe-rim-' + tag;
  for (const [k, v] of Object.entries(over)) {
    if (k in b.geom.mat) b.geom.mat[k] = v; else b.geom[k] = v;
  }
  return b;
}
const RUNS = sets.length ? sets.map((sp, i) => {
  const over = {};
  for (const kv of sp.split(',')) { const [k, v] = kv.split('='); over[k] = Number(v); }
  return { tag: sp, board: variant(String(i), over) };
}) : [{ tag: 'as shipped', board: BOARD }];

const pct = (n, d) => (d ? (100 * n / d).toFixed(0).padStart(3) + '%' : '   -');
const q = (arr, f) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

for (const run of RUNS) {
  const BRD = run.board, G = BRD.geom, M = buildMachine(G);
  const ids = Object.keys(G.holes);
  const B = { perfect: [0, 0, 0, 0], good: [0, 0, 0, 0], rim: [0, 0, 0, 0], wide: [0, 0, 0, 0] };
  let scored = 0, shots = 0, parked = 0, rimouts = 0, throughThenOther = 0;
  const capLag = [], thrLag = [], capToThr = [];
  for (let s = 0; s < SEEDS; s++) for (let p = 0; p < P; p++) for (let a = 0; a < A; a++) {
    const st = startThrow(BRD, { power: p / (P - 1), aim: -1 + 2 * a / (A - 1), seed: SEEDS > 1 ? s * 1000 + p * 50 + a : null });
    let arrived = null, off = 0, g = 30000, tCap = -1, tThr = -1, capHole = null, thrHole = null, nCaps = 0;
    while (!st.done && g-- > 0) {
      substep(st);
      const pos = st.ball.position;
      if (!arrived) {
        // nearest hole in u, in its own frame
        let best = null;
        for (const id of ids) {
          const h = G.holes[id];
          const fh = M.worldToFaceIn(M.frameAt(h.v), pos);
          const d = Math.hypot(fh.u - h.u, fh.v - h.v);
          if (!best || d < best.d) best = { id, d, fh, h };
        }
        if (best && best.fh.h < best.h.collarH + G.ballR && st.ball.velocity.y < 0 && best.d < 3 * best.h.r) {
          arrived = best.id; off = best.d / best.h.r;
        }
      }
      for (const ev of st.events) {
        if (ev._seen) continue; ev._seen = true;
        if (ev.type === 'capture') { nCaps++; if (tCap < 0) { tCap = st.t; capHole = ev.hole; } }
        if (ev.type === 'through' && tThr < 0) { tThr = st.t; thrHole = ev.hole; }
      }
    }
    shots++;
    if (st.emergencyUsed) parked++;
    const hole = st.outcome && G.holes[st.outcome.hole] ? st.outcome.hole : null;
    if (hole) scored++;
    if (nCaps > 1 || (capHole && hole !== capHole)) rimouts++;
    if (thrHole && hole !== thrHole) throughThenOther++;
    if (tCap >= 0 && hole) capLag.push(st.t - tCap);
    if (tThr >= 0 && hole) { thrLag.push(st.t - tThr); if (tCap >= 0) capToThr.push(tThr - tCap); }
    const band = !arrived ? 'wide' : off < 0.25 ? 'perfect' : off < 1.0 ? 'good' : off < 1.75 ? 'rim' : 'wide';
    const row = B[band];
    row[0]++;
    if (hole && hole === arrived) row[1]++; else if (hole) row[2]++; else row[3]++;
  }
  console.log(`\n=== ${run.tag}  (${shots} throws)`);
  console.log(`scored ${pct(scored, shots)}   parked ${pct(parked, shots)}   rimouts(capture that did not score there) ${rimouts}   through-then-elsewhere ${throughThenOther}`);
  console.log('band        n    that hoop   other hoop   nothing');
  for (const [k, r] of Object.entries(B)) console.log(`${k.padEnd(8)} ${String(r[0]).padStart(4)}     ${pct(r[1], r[0])}        ${pct(r[2], r[0])}       ${pct(r[3], r[0])}`);
  const ms = (v) => (isNaN(v) ? '  -  ' : (v * 1000).toFixed(0).padStart(4) + 'ms');
  console.log(`capture -> resolved   median ${ms(q(capLag, 0.5))}  p90 ${ms(q(capLag, 0.9))}  max ${ms(q(capLag, 1))}`);
  console.log(`through -> resolved   median ${ms(q(thrLag, 0.5))}  p90 ${ms(q(thrLag, 0.9))}  max ${ms(q(thrLag, 1))}`);
  console.log(`capture -> through    median ${ms(q(capToThr, 0.5))}  p90 ${ms(q(capToThr, 0.9))}  max ${ms(q(capToThr, 1))}`);
}
