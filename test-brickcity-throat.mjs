// test-brickcity-throat.mjs - HOT SHOT: BRICK CITY. Three defects Matt filmed on 2026-09-04, all
// of them in machines/brickcity/physics.js, all of them about what happens to a ball AFTER it has
// reached a basket. [KNOWN-BUG PROBE] on all three.
//
// 1. "Some made 100 shots in the top right basket glitch and move through the basket." Capture on
//    this machine takes the floor out from under the ball AND - since "THE NET", 2026-09-02 - that
//    basket's own collar with it, so nothing was left holding the ball in and it carried its
//    arrival speed sideways out through the rim and the net. Measured over a 41x41 power/aim grid
//    on the build he filmed: a captured ball wandered up to 48 cm from its own mouth, and 284 of
//    793 captures did not pay the hole that captured them - the corner 100s 25% and 27%, the -20s
//    about half. It is not one basket: topL is as bad as topR.
//
// 2. "This one goes in the basket but through the rim, hits something INSIDE the basket, and
//    Ricochets to the right super fast, then slow." The rimout branch handed the floor and the
//    collar back UNDERNEATH a ball that was still inside them - its test was `d > hDef.r` (the RIM
//    radius, so the ball's surface could still be 5 cm deep in the wall) at `fc.h > ballR * 1.05`
//    (5.7 cm above the TREAD, half way down an 11.6 cm collar). cannon-es resolved the overlap the
//    only way it can, with a position correction: traced step by step, 0.397 m/s to 10.807 m/s in
//    one 1/240 s step, against contact impacts the solver logged at 0.10-0.37 m/s. 34 of 1,681
//    throws did it, worst 10.4 m/s, on a machine whose hardest serve leaves at 6.60.
//
// 3. "A ball on the top step vanishes and is counted as a MISS while it's still moving. It could
//    have rolled down into another basket." The stall watchdog resets its clock only once the ball
//    has covered 3 cm FROM ITS ANCHOR POINT, so a ball that settles for half a second and then
//    starts rolling is killed at 0.6 s having not yet earned the reset. 129 of the 144 balls it
//    killed were moving faster than 10 cm/s (median 0.19 m/s, still spinning at 4.4 rad/s), and 70
//    of the 144 died rolling home down the 12.9 cm channel between an outer 100's collar and the
//    side rail.
//
// The fixes: a THROAT per basket (machine.js) - the mouth continued down through the tread at
// radius r + ballR, on its own collision bit, solid only to a ball that basket has captured; a
// rimout measured from the RIM with the radial term gone; an artefact ceiling at 1.5x maxSpeed;
// and SPEED AS A VETO on the watchdog, with the displacement anchor still the primary test.
//
// Part 1 THROWS at the real engine. Part 2 is STRUCTURAL, so a session that tidies any one of the
// rules back out trips this the same day. ~2 min, no browser:
//   node test-brickcity-throat.mjs
//
// Scope: BRICK CITY only, deliberately (skeeball/CLAUDE.md, "HARD RULE: every machine owns its own
// engine"). No basket moved and no mouth changed size.
import { readFileSync } from 'node:fs';
import { boardById } from './skeeball/js/boards.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';

const BOARD = 'brickcity';
let passed = 0;
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
};

await loadEngine(BOARD, { physics: true });
const { physics: P, buildMachine } = engineFor(BOARD);
const board = boardById(BOARD);
const G = board.geom;
const M = buildMachine(G);
const H = P.STEP;

// --- 1. what actually happens to a ball that reaches a basket ------------------------------------
const rows = [];
for (let pi = 0; pi <= 20; pi++) {
  const power = 0.50 + pi * 0.025;                 // 0.50 .. 1.00
  // GUARD: 41 AIMS, NOT 21. Aim is what reaches the corner 100s, and a 21-wide aim axis is not
  // born red - measured, against the engine this probe was written for: it misses the 47.7 cm
  // drift and the 10.4 m/s pop entirely and only two of these assertions fail.
  for (let ai = -20; ai <= 20; ai++) {
    const aim = ai / 20;                           // -1 .. 1
    const st = P.startThrow(board, { power, aim });
    let cap = null, maxPastRim = -Infinity, maxSpeed = 0, maxJump = 0, jumpAt = 0;
    let wdSpeed = null, vPrev = 0;
    let guard = 13 * 240;
    while (!st.done && guard-- > 0) {
      P.step(board, st, H);
      const v = st.ball.velocity.length();
      if (v > maxSpeed) maxSpeed = v;
      // The serve itself is a step from 0 to `speed`; only look at what happens after it.
      if (st.t > 0.05 && v - vPrev > maxJump) { maxJump = v - vPrev; jumpAt = st.t; }
      vPrev = v;
      if (st.captured) {
        const hDef = G.holes[st.captured];
        if (!cap) cap = st.captured;
        const fc = M.worldToFaceIn(M.frameAt(hDef.v), st.ball.position);
        const past = Math.hypot(fc.u - hDef.u, fc.v - hDef.v) - hDef.r;
        if (past > maxPastRim) maxPastRim = past;
      }
      if (st.emergencyUsed && wdSpeed === null) wdSpeed = v;
    }
    rows.push({ power, aim, cap, maxPastRim, maxSpeed, maxJump, jumpAt, wdSpeed,
      clamped: st.clamped | 0, outcome: st.outcome, resolved: st.done });
  }
}
console.log(`\n${rows.length} throws.`);

ok('every throw resolves', rows.every((r) => r.resolved), '');

// 1a. THE THROAT. A captured ball is confined to d <= r by construction (the wall stands at
//     r + ballR), so it can never be more than a hair past its own rim. Born red at 47.7 cm.
{
  const caps = rows.filter((r) => r.cap);
  const worst = caps.reduce((m, r) => Math.max(m, r.maxPastRim), -Infinity);
  ok('a captured ball never travels more than 8 cm past its own rim',
    caps.length > 0 && worst < 0.08, `worst ${(worst * 100).toFixed(1)} cm over ${caps.length} captures`);
}

// 1b. AND IT GETS PAID. With the ball held over the mouth, the pass-through commit (d < r + ballR)
//     can no longer fail, so a capture that is not honoured means the ball genuinely bounced back
//     out over the rim. Born red at 64% (284 of 793 lost).
{
  const caps = rows.filter((r) => r.cap);
  const paid = caps.filter((r) => r.outcome && r.outcome.hole === r.cap);
  const rate = paid.length / Math.max(1, caps.length);
  ok('at least 92% of captured balls are paid the hole that captured them',
    rate >= 0.92, `${paid.length} of ${caps.length} (${(rate * 100).toFixed(0)}%)`);
}

// 1c. NO PENETRATION POPS. A ball leaves this machine's ramp at maxSpeed and only loses energy
//     after that; the fastest any ball legitimately goes is ~7.0 m/s. Born red at 10.9.
{
  const worst = rows.reduce((m, r) => Math.max(m, r.maxSpeed), 0);
  ok('no ball ever exceeds 1.5x the machine\'s own maxSpeed',
    worst < G.maxSpeed * 1.5, `fastest ${worst.toFixed(2)} m/s against maxSpeed ${G.maxSpeed}`);
  const clamped = rows.filter((r) => r.clamped > 0);
  ok('the artefact ceiling never actually fires', clamped.length === 0,
    `${clamped.length} throws hit it`);
  const jumped = rows.filter((r) => r.maxJump > 3.0);
  ok('no single-step speed JUMP over 3 m/s after the serve', jumped.length === 0,
    jumped.slice(0, 4).map((r) => `p${r.power.toFixed(3)} a${r.aim.toFixed(1)} +${r.maxJump.toFixed(1)} m/s at t ${r.jumpAt.toFixed(3)}`).join('; '));
}

// 1d. THE WATCHDOG NEVER KILLS A ROLLING BALL. Displacement is still the primary test - a ball
//     jittering in a cradle reads 0.00-0.01 m/s and still dies at 0.6 s. Born red at 129 of 144.
{
  const kills = rows.filter((r) => r.wdSpeed !== null);
  const moving = kills.filter((r) => r.wdSpeed > 0.10);
  ok('the stall watchdog never kills a ball moving faster than 10 cm/s', moving.length === 0,
    `${moving.length} of ${kills.length} kills were moving`
    + (moving.length ? `, fastest ${Math.max(...moving.map((r) => r.wdSpeed)).toFixed(2)} m/s` : ''));
  console.log(`      (${kills.length} of ${rows.length} throws ended on the watchdog)`);
}

// --- 2. the rules are still in the files ---------------------------------------------------------
const mach = readFileSync(new URL('./skeeball/js/machines/brickcity/machine.js', import.meta.url), 'utf8');
const phys = readFileSync(new URL('./skeeball/js/machines/brickcity/physics.js', import.meta.url), 'utf8');
const rend = readFileSync(new URL('./skeeball/js/machines/brickcity/render.js', import.meta.url), 'utf8');

// The throat is real geometry, one tube per collared basket, and its radius is the derived one.
{
  const th = M.solids.filter((s) => s.part === 'throat');
  const collared = Object.keys(G.holes).filter((id) => G.holes[id].collarH > 0);
  ok('machine: every collared basket has a throat',
    collared.every((id) => th.filter((s) => s.cup === id).length === G.cupSegments),
    `${th.length} boxes for ${collared.length} baskets at ${G.cupSegments} segments`);
  ok('machine: the throat radius is r + ballR, not r',
    /const rr = H\.r \+ G\.ballR \+ G\.collarThick \/ 2;/.test(mach), '');
  // Asked in THE HOLE'S OWN frame, never the nearest one - the mistake that cost two sessions on
  // this machine's collars (test-brickcity-stall.mjs's header). Every box's centreline stands one
  // ball radius outside the mouth, so a ball whose centre is over the mouth cannot pass it.
  const strays = [];
  for (const id of collared) {
    const H2 = G.holes[id];
    const fr = M.frameAt(H2.v);
    const want = H2.r + G.ballR + G.collarThick / 2;
    for (const s of th.filter((x) => x.cup === id)) {
      const fh = M.worldToFaceIn(fr, { x: s.pos[0], y: s.pos[1], z: s.pos[2] });
      const d = Math.hypot(fh.u - H2.u, fh.v - H2.v);
      if (Math.abs(d - want) > 1e-6) strays.push(`${id} box at ${(d * 100).toFixed(2)}cm, wanted ${(want * 100).toFixed(2)}cm`);
    }
  }
  ok('machine: every throat box stands r + ballR from its own basket\'s axis', strays.length === 0,
    strays.slice(0, 3).join('; '));
}
ok('physics: each throat is on its OWN collision bit, above the cup bits',
  /const throatBit = \(G, id\) =>/.test(phys)
  && /CUP_BIT0 << \(ids\.length \+ Math\.max\(0, ids\.indexOf\(id\)\)\)/.test(phys)
  && /s\.part === 'throat' && s\.cup \? throatBit\(G, s\.cup\)/.test(phys), '');
ok('physics: capture switches that basket\'s throat on',
  /\(st\.restMask & ~cupBit\(G, id\)\) \| throatBit\(G, id\)/.test(phys)
  && !/collisionFilterMask = st\.restMask & ~cupBit\(G, id\);/.test(phys), '');
ok('physics: a rimout needs the ball WHOLLY above the rim, with no radial term',
  /fc\.h > \(hDef\.collarH \|\| 0\) \+ G\.ballR \* 1\.05/.test(phys)
  && !/fc\.h > G\.ballR \* 1\.05 && d > hDef\.r/.test(phys), '');
ok('physics: the solver-artefact ceiling is 1.5x the board\'s own maxSpeed',
  /G\.maxSpeed : 8\) \* 1\.5/.test(phys) && /ball\.velocity\.scale\(vMax \/ vNow, ball\.velocity\)/.test(phys), '');
ok('physics: the watchdog keeps the displacement anchor AND vetoes on speed, with a bounded rope',
  /if \(moved > 0\.03\)/.test(phys)
  && /ball\.velocity\.length\(\) < 0\.05 && ball\.angularVelocity\.length\(\) < 1\.0/.test(phys)
  && /st\.anchor\.t0 != null \? st\.anchor\.t0 : st\.anchor\.t\) <= 2\.0/.test(phys)
  && /st\.t - st\.anchor\.t > 0\.6/.test(phys), '');
ok('render: the throat is not drawn (it is inside the cabinet, under the tread)',
  /s\.part === 'throat'/.test(rend) && /=== 'cupSeg' \|\| s\.part === 'throat'/.test(rend), '');

console.log(`\nBRICK CITY throat probe: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
