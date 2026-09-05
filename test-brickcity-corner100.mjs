// test-brickcity-corner100.mjs - HOT SHOT: BRICK CITY's corner-100 probe: does a ball dropped ONTO
// the basket go IN?
//
// [KNOWN-BUG PROBE] Matt, 2026-09-02, with two screen recordings: a swipe that visually looks aimed
// at the corner 100 "sometimes scores, sometimes misses completely", and a change of a degree of
// angle or a hair of power flips it. A first fix capped the machine's aimMax to 0.12 rad (commit
// a5ec37d) - which moved the problem, not the ball: the basket is drawn 8.9 deg off the ball on
// screen and now needed a 20.8 deg swipe. Matt: "why would we move the physical basket around
// instead of simply correcting that physics issue?"
//
// THE PHYSICS ISSUE, measured step by step (5.5 deg / power 0.70): the ball arrived 2 cm off the
// basket's axis, dead centre, descending at 2.4 m/s - and capture could not see it, because
// section 2's gate (`f.h < ballR * 1.9`, THE CLASSIC's number for flush holes a ball ROLLS over)
// only looks within 10 cm of the TREAD, and this rim stands 11.6 cm above it. So the ball's
// underside grazed the rim's inner top EDGE, whose 45-degree normal turned the descent into a
// 1.5 m/s kick across the mouth; the far edge turned that into 1.6 m/s straight UP, and out it
// went. A second defect: a ball that slid down the riser and came to rest on the rim's inner edge
// with its centre 5.0 cm off the axis of a 5.8 cm mouth - over the opening - was refused by the
// crossing inset (4.3 cm) and teetered off into the -10.
//
// Three rules in machines/brickcity/physics.js close it, all in section 2: the gate is measured
// from each basket's RIM; a captured ball stops colliding with the collar it was captured by ("the
// net" - every other collar, the riser and the wall stay solid); and a ball resting on a lip with
// its centre over the opening falls in. Plus the input half in boards.js / ui.js: `aimCurve: 1`
// makes serve angle proportional to swipe angle on this machine, and `aimMax: 0.235` is the
// proportion that puts a swipe at the basket's on-screen bearing onto its real serve bearing.
//
// Two halves here. 1 THROWS at the real engine over the serve band that reaches the basket and
// counts what happens to balls that ARRIVE OVER THE MOUTH: born red at 9 of 36 (25%), 23 of 29
// after. 2 is STRUCTURAL: the three engine rules and the two aim numbers are present, so a session
// that "tidies" any one of them back out trips this the same day. ~45s, no browser:
//   node test-brickcity-corner100.mjs
//
// Scope: BRICK CITY only, deliberately (skeeball/CLAUDE.md, "HARD RULE: every machine owns its own
// engine"). The basket did not move and its 3.20 in mouth did not change.
import { readFileSync } from 'node:fs';
import { boardById } from './skeeball/js/boards.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';
import { buildMachine } from './skeeball/js/machines/brickcity/machine.js';

const BOARD = 'brickcity';
let passed = 0;
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`not ok  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const base = boardById(BOARD);
await loadEngine(BOARD);
const P = engineFor(BOARD).physics;
// Serve angles in RADIANS directly: aimMax 1 and aim = the angle.
const board = { ...base, geom: { ...base.geom, aimMax: 1 } };
const G = board.geom;
const M = buildMachine(G);
const hole = G.holes.topR;
const fr = M.frameAt(hole.v);

/** One throw; where it first touched anything on the top tread, relative to the corner 100. */
function landing(angleDeg, power) {
  const st = P.startThrow(board, { power, aim: (angleDeg * Math.PI) / 180 });
  let first = null;
  let guard = 240 * 14;
  while (!st.done && guard-- > 0) {
    P.step(board, st, P.STEP);
    const evs = st.events.splice(0);
    if (first) continue;
    for (const e of evs) {
      if (e.type !== 'contact' || ['lane', 'hump', 'laneRail', 'rail', 'flare'].includes(e.part)) continue;
      const f = M.worldToFaceIn(fr, { x: e.x, y: e.y, z: e.z });
      first = { du: f.u - hole.u, dv: f.v - hole.v };
      break;
    }
  }
  return { hit: !!(st.outcome && st.outcome.hole === 'topR'), first, t: st.t, resolved: st.done };
}

// --- 1. a ball dropped over the mouth goes in -------------------------------------------------
// 5.0-6.50 deg is the serve band that lands on this basket's axis (boards.js, the aim note);
// 0.78-0.88 is the power band that lands on its tread. 7 x 11 = 77 throws.
//
// THE POWER BAND IS TIED TO maxSpeed AND MUST BE RE-MEASURED WHEN IT MOVES (2026-09-05). It was
// 0.66-0.80 against maxSpeed 6.60; at 6.20 that band lands SHORT and only 5 of 90 throws still
// arrived over the mouth, so every number below it measured nothing. The first assertion exists
// to catch exactly that, and it did. Re-measured, the same 70% bar reads 74% (23 of 31) - so the
// corner 100 is genuinely less forgiving on the shallower dial than the 93% it managed at 6.60,
// which is the price of that change and is recorded in boards.js beside the number itself.
const rows = [];
for (let a = 5.0; a <= 6.51; a += 0.25) {
  for (let p = 0.78; p <= 0.881; p += 0.01) rows.push({ a, p: +p.toFixed(3), ...landing(a, +p.toFixed(3)) });
}
const over = rows.filter((r) => r.first && Math.abs(r.first.du) < 0.03 && Math.abs(r.first.dv) < 0.06);
const overHit = over.filter((r) => r.hit);
console.log(`corner 100: ${rows.length} throws, ${over.length} arrived over the mouth, ${overHit.length} of those scored`);
ok('enough throws arrive over the mouth for the number to mean something', over.length >= 12,
  `only ${over.length} arrivals - widen the band before trusting this file`);
ok('at least 70% of balls that arrive over the mouth score it (was 25%)',
  over.length && overHit.length / over.length >= 0.70,
  `${overHit.length} of ${over.length}: ` + over.filter((r) => !r.hit).slice(0, 6).map((r) =>
    `${r.a.toFixed(2)} deg p${r.p} du ${r.first.du.toFixed(3)} dv ${r.first.dv.toFixed(3)}`).join('; '));
ok('every throw resolves', rows.every((r) => r.resolved), '');
const slow = rows.filter((r) => r.t > 8);
ok('no throw takes more than 8s to settle', slow.length === 0, `${slow.length} did`);

// --- 2. the rules are still in the files ------------------------------------------------------
const phys = readFileSync(new URL('./skeeball/js/machines/brickcity/physics.js', import.meta.url), 'utf8');
ok('physics: the capture gate is measured from the rim, and only for a FALLING ball',
  /f\.h < G\.ballR \* 1\.9 \+ st\.maxLip/.test(phys)
  && /const falling = hDot < -0\.8/.test(phys)
  && /fh\.h >= \(falling \? lip : 0\) \+ G\.ballR \* 1\.9/.test(phys), '');
// The rule is unchanged; only its spelling moved, into `capturedMask` (2026-09-04), when capture
// also had to switch that basket's THROAT on - see test-brickcity-throat.mjs.
ok('physics: a captured ball stops colliding with its own collar (cupBit)',
  /st\.restMask & ~cupBit\(G, id\)/.test(phys) && /s\.part === 'cupSeg' && s\.cup \? cupBit\(G, s\.cup\)/.test(phys), '');
// [KNOWN-BUG PROBE] THE PERCHED 100, 2026-09-02. For a few hours this machine also captured a
// ball that was merely SITTING on a collar's rim: a widened radius (rRest), a "slower than
// 0.6 m/s" branch, and the rim-relative gate applied to EVERY ball rather than only a falling
// one. Matt filmed three racks of it - every single 100 in them was a ball that went up to the
// backboard, loitered there, came back down onto the top-right 100, settled on its rim and was
// paid 100. His rack went 140 to 440 on it.
//
// This suite's own behavioural checks above ALL PASSED while that was true, and that is the
// lesson: a ball perched on the rim still counts as "arrived over the mouth", so only the
// geometry AT THE MOMENT OF CAPTURE tells a real basket from a ball balanced on its edge.
// Measured on the engine Matt filmed: 11 of 18 corner 100s were perched. Born red there.
ok('physics: the rim-rest capture rules are gone and must not come back',
  !/rRest/.test(phys) && !/velocity\.length\(\) < 0\.6/.test(phys), '');
{
  // The REAL board, not the aimMax-1 test copy above: this probe has to go through the
  // swipe -> serve mapping a player actually gets (js/ui.js's curve, then geom.aimMax).
  const aimOf = (sw) => {
    const raw = Math.max(-1, Math.min(1, (sw * Math.PI / 180) / 0.38));
    return base.geom.aimCurve === 1 ? raw : Math.sign(raw) * (raw * raw);
  };
  const perched = [];
  let scored = 0;
  for (let sw = 0; sw <= 22; sw += 1) for (let pw = 0.55; pw <= 1.001; pw += 0.05) {
    const st = P.startThrow(base, { power: +pw.toFixed(3), aim: aimOf(sw) });
    let n = 0;
    const caps = [];
    while (!st.done && n++ < 240 * 14) {
      P.step(board, st, P.STEP);
      for (const e of st.events) if (e.type === 'capture') caps.push(e);
      st.events = [];
    }
    const o = st.outcome;
    if (!o || (o.hole !== 'topR' && o.hole !== 'topL')) continue;
    scored++;
    const e = caps.filter((c) => c.hole === o.hole).pop();
    if (!e) continue;
    const hDef = G.holes[e.hole];
    const fh = M.worldToFaceIn(M.frameAt(hDef.v), e.pos);
    const d = Math.hypot(fh.u - hDef.u, fh.v - hDef.v);
    // Over the opening, or already below the rim plane and so inside the cup. On top of the
    // rim is neither, and is what this probe exists to catch.
    if (!(d < hDef.r - G.ballR * 0.28 + 1e-9) && !(fh.h < hDef.collarH)) {
      perched.push(`swipe ${sw} power ${pw.toFixed(2)}: d ${d.toFixed(4)} vs opening `
        + `${(hDef.r - G.ballR * 0.28).toFixed(4)}, h ${fh.h.toFixed(4)} vs rim ${hDef.collarH.toFixed(4)}`);
    }
  }
  ok('no corner 100 is scored by a ball perched on the rim', perched.length === 0,
    `${perched.length} of ${scored} were. ` + perched.slice(0, 3).join('; '));
  console.log(`        (${scored} corner 100s in the sweep, ${perched.length} perched on the rim)`);
}
ok('physics: the serve is forward roll only (the full rolling spin was measured and rejected)',
  /ball\.angularVelocity\.set\(-speed \/ G\.ballR, 0, 0\)/.test(phys), '');
ok('boards: brickcity serves in proportion to the swipe (aimCurve 1) at the measured proportion',
  base.geom.aimCurve === 1 && Math.abs(base.geom.aimMax - 0.235) < 1e-9,
  `aimCurve ${base.geom.aimCurve} aimMax ${base.geom.aimMax}`);
const ui = readFileSync(new URL('./skeeball/js/ui.js', import.meta.url), 'utf8');
ok('ui: the swipe curve reads geom.aimCurve and defaults to the square',
  /geom\.aimCurve > 0 \? this\.game\.board\.geom\.aimCurve : 2/.test(ui) && /Math\.pow\(Math\.abs\(raw\), curve\)/.test(ui), '');

console.log(`\nBRICK CITY corner-100 probe: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
