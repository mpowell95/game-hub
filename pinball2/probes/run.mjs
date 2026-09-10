// node pinball2/probes/run.mjs [drain|tunnel|rests|gaps|all]
// The same three checks the editor's Check panel runs, from a terminal, so a deploy can be gated
// on them.

import { makeTable } from '../machines/testbox/table.js';
import { CONFIG } from '../machines/testbox/config.js';
import { drainTime, tunnelProbe, restSweep, checkGaps, flipProbe, escapeProbe } from './checks.js';

const which = process.argv[2] || 'all';
const table = makeTable();
const cfg = CONFIG;
let bad = 0;

const t0 = Date.now();

if (which === 'drain' || which === 'all') {
  const r = drainTime(table, cfg);
  const err = r.seconds == null ? Infinity : Math.abs(r.seconds - r.analytic) / r.analytic;
  const ok = err <= 0.05;
  console.log(`gravity         ${r.gravity.toFixed(3)} m/s2 = g sin(${cfg.TILT_DEG} deg)`);
  console.log(`free fall       ${r.seconds == null ? 'NEVER DRAINED' : r.seconds.toFixed(3) + ' s'} against ${r.analytic.toFixed(3)} s analytic, ${(err * 100).toFixed(1)}% off   ${ok ? 'OK' : 'FAIL'}`);
  console.log(`ball life       ${r.alive == null ? 'still in play at 60 s' : r.alive.toFixed(1) + ' s'} released into the top left corner   (reported, not gated)`);
  if (r.jams) console.log(`   ${r.jams} jams`);
  if (!ok) bad++;
}

if (which === 'tunnel' || which === 'all') {
  const r = tunnelProbe(table, cfg);
  console.log(`tunnel probe    ${r.shots} shots at ${cfg.MAX_SPEED} m/s, ${r.fails.length} got through   ${r.fails.length ? 'FAIL' : 'OK'}`);
  for (const f of r.fails.slice(0, 10)) {
    console.log(`   ${f.shape}: from (${f.from.x.toFixed(3)}, ${f.from.y.toFixed(3)}) ended (${f.end.x.toFixed(3)}, ${f.end.y.toFixed(3)}) ${f.out ? 'OFF TABLE' : 'INSIDE ' + f.inside}`);
  }
  if (r.fails.length) bad++;
}

if (which === 'flip' || which === 'all') {
  const r = flipProbe(table, cfg);
  console.log(`flipper push    ${r.shots} balls flipped from rest against the bat, ${r.fails.length} left the machine   ${r.fails.length ? 'FAIL' : 'OK'}`);
  for (const f of r.fails.slice(0, 6)) {
    console.log(`   ${f.flipper}: from (${(f.from.x * 1000).toFixed(0)}, ${(f.from.y * 1000).toFixed(0)}) mm ended (${(f.end.x * 1000).toFixed(0)}, ${(f.end.y * 1000).toFixed(0)}) mm`);
  }
  if (r.fails.length) bad++;
}

if (which === 'escape' || which === 'all') {
  const r = escapeProbe(table, cfg);
  console.log(`escape probe    ${r.shots} balls fired hard from everywhere, ${r.fails.length} left the machine   ${r.fails.length ? 'FAIL' : 'OK'}`);
  for (const f of r.fails.slice(0, 6)) {
    console.log(`   from (${(f.from.x * 1000).toFixed(0)}, ${(f.from.y * 1000).toFixed(0)}) mm at ${f.deg} deg ${f.speed} m/s${f.hold ? ' holding ' + f.hold : ''} ended (${(f.end.x * 1000).toFixed(0)}, ${(f.end.y * 1000).toFixed(0)}) mm`);
  }
  if (r.fails.length) bad++;
}

if (which === 'gaps' || which === 'all') {
  const flags = checkGaps(table, cfg);
  const real = flags.filter((f) => f.kind === 'gap');
  console.log(`gap rule        ${real.length} ambiguous gaps, ${flags.length - real.length} deliberate overlaps   ${real.length ? 'FAIL' : 'OK'}`);
  for (const f of real) console.log(`   ${f.a} to ${f.b}: ${(f.gap * 1000).toFixed(1)} mm, a ball is ${(cfg.BALL_R * 2000).toFixed(1)} mm`);
  if (real.length) bad++;
}

if (which === 'rests' || which === 'all') {
  const r = restSweep(table, cfg, { step: 0.012 });
  console.log(`rest sweep      ${r.drops} drops, ${r.stuck.length} never reached the drain   ${r.stuck.length ? 'FAIL' : 'OK'}`);
  const seen = [];
  for (const s of r.stuck) {
    if (seen.some((q) => Math.hypot(q.x - s.at.x, q.y - s.at.y) < 0.008)) continue;
    seen.push(s.at);
    const n = r.stuck.filter((q) => Math.hypot(q.at.x - s.at.x, q.at.y - s.at.y) < 0.008).length;
    console.log(`   ${String(n).padStart(4)} rest at (${s.at.x.toFixed(3)}, ${s.at.y.toFixed(3)}) on ${s.on || 'nothing'}, moving ${s.speed.toFixed(3)} m/s`);
  }
  if (r.stuck.length) bad++;
}

console.log(`\n${bad ? bad + ' CHECK(S) FAILED' : 'all checks passed'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(bad ? 1 : 0);
