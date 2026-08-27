// test-brickcity-stall.mjs - HOT SHOT: BRICK CITY's parked-ball probe.
//
// [KNOWN-BUG PROBE] Matt, 2026-08-26, on the build that had just been made smooth: "the ball
// sometimes gets stuck IN the negative baskets. Like instead of falling in, it's just stuck
// there."
//
// It was real, it was geometry, and nothing tested it: BRICK CITY has no engine suite of its own
// (skeeball/js/test.js sweeps DEFAULT_BOARD, which is THE CLASSIC), so a machine whose staircase
// removed THE CLASSIC's "a resting ball always rolls back down" guarantee shipped with no check
// that its balls ever stop resting.
//
// THE BUG, FOUND 2026-08-26 AND CORRECTED HERE. Two earlier readings of it were wrong, and both
// were wrong the same way - they trusted a face-coordinate number over what Matt was looking at.
// The first called the ball "perched on the rim, 32cm from any basket, Matt is misreading
// perspective"; the second called cup rim and riser "a cradle". Matt said, twice, that the ball
// was IN the basket, half in and half out, with "nothing for them to get stuck on". He was right
// on both counts, and the second half of that sentence was the clue.
//
// It was an INVISIBLE LEDGE INSIDE EVERY BOTTOM-ROW BASKET, and it was pure machine.js.
// A collar is 14 boxes on a circle of radius rr around the hole at (H.u, H.v), each placed by
// faceToWorld(pu, pv, h/2). faceToWorld resolves v through frameAt(v) - which segment of the
// STAIRCASE that v lands on. The bottom row sits at v 0.1909 with rr 0.1151, so its two rearmost
// segments carry pv 0.3031, past the first tread's back edge at 0.3000: they were built in the
// RISER'S frame and landed 6.96cm LOW and 6.86cm FORWARD - a 5cm-wide bar straight across the
// throat of the basket, 60% of the way down, oriented for a tread they were no longer on.
// render.js never draws cupSeg boxes (it draws a smooth wire basket instead), so the ledge was
// invisible: nothing to get stuck on, exactly as Matt said, and a ball dropping in stopped on it
// with its centre a hair under the rim. The mid and top rows are unaffected - their collars are
// small enough not to reach past their own tread.
//
// SECOND, SMALLER DEFECT, fixed with it: worldToFace hands back the NEAREST segment's
// coordinates, and a ball deep in a bottom-row basket is nearer the riser plane (0.1085 behind
// the mouth) than the tread it is sunk into (0.1455 deep). Above h 0.121 every basket on this
// machine resolved to a riser frame, so physics.js section 2 measured the hole's distance as
// 0.22 against a 0.09 mouth and skipped the cup the ball was sitting in. Latent on its own -
// it moved 0 of 861 outcomes once the ledge was gone - but it is what stopped capture rescuing
// the parked ball. Both fixes ask each hole's question in THAT HOLE'S OWN frame
// (machine.js faceToWorldIn / worldToFaceIn).
//
// Measured over the full 41x21 grid: 4 of 861 throws parked in a basket before, 0 after; the
// worst settle fell 10.91s -> 5.51s; 12 outcomes moved, 10 of them AGAINST the player, because a
// ball that used to die on the ledge as a 0 now falls in and takes its penalty. That is the fix
// working, not a regression - Matt: "I want them to not get stuck midway through the basket."
//
// The 0.6s watchdog in machines/brickcity/physics.js section 6 stays. It is what covers a ball
// parked on a TREAD, which is a different thing and still happens (103 of 861); it was never a
// fix for this, and shortening it was the band-aid Matt rejected.
//
// Born RED against the pre-fix engine (worst dead-still stretch 2.62s against this file's 0.75s
// bound) and green after. Re-run it after ANY change to that machine's geometry, materials or
// watchdog:  node test-brickcity-stall.mjs
//
// Scope: BRICK CITY only, deliberately. The other four machines keep their own watchdogs and
// their own copies of physics.js (skeeball/CLAUDE.md, "HARD RULE: every machine owns its own
// engine"), and THE CLASSIC's continuous slope is exactly why it never needed this.

import { boardById } from './skeeball/js/boards.js';
import { engineFor } from './skeeball/js/engines.js';
import { buildMachine } from './skeeball/js/machines/brickcity/machine.js';

const BOARD = 'brickcity';
// The watchdog gives up at 0.6s; 0.75s is that plus the slack a settling frame needs. A ball
// visibly parked for longer than this is the bug back.
const STALL_BOUND = 0.75;
// Coarse on purpose - the full 41x21 grid is ~100s and this has to be cheap enough to run.
// 21 x 11 still contains the worst pre-fix offenders (p0.90 a+-1.0 stalled 2.57s).
const POWERS = 21;
const AIMS = 11;

let passed = 0;
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`not ok  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const board = boardById(BOARD);
const P = engineFor(BOARD).physics;
const G = board.geom;
const M = buildMachine(G);

console.log(`BRICK CITY parked-ball probe: ${POWERS} powers x ${AIMS} aims = ${POWERS * AIMS} throws\n`);

const rows = [];
for (let pi = 0; pi < POWERS; pi++) {
  for (let ai = 0; ai < AIMS; ai++) {
    const power = pi / (POWERS - 1);
    const aim = (ai / (AIMS - 1)) * 2 - 1;
    const st = P.startThrow(board, { power, aim });
    let n = 0;
    let from = -1;
    let worstStall = 0;
    let stallAt = null;
    let stallPos = null;
    while (!st.done && n < 4000) {
      P.step(board, st, 1 / 60);
      n++;
      const v = st.ball.velocity;
      // Uncaptured: a captured ball is falling THROUGH a mouth and is allowed to be slow.
      if (!st.captured && Math.hypot(v.x, v.y, v.z) < 0.02) {
        if (from < 0) from = st.t;
        if (st.t - from > worstStall) {
          worstStall = st.t - from;
          stallAt = { y: +st.ball.position.y.toFixed(3), z: +st.ball.position.z.toFixed(3) };
          stallPos = { x: st.ball.position.x, y: st.ball.position.y, z: st.ball.position.z };
        }
      } else from = -1;
    }
    rows.push({
      power, aim, worstStall, stallAt, stallPos, t: st.t,
      hole: st.outcome ? st.outcome.hole : 'none',
      value: st.outcome ? st.outcome.value : 0,
      resolved: st.done,
    });
  }
}

// --- 1. nothing parks -------------------------------------------------------------------------
const stalled = rows.filter((r) => r.worstStall > STALL_BOUND).sort((a, b) => b.worstStall - a.worstStall);
ok(`no ball sits dead still for more than ${STALL_BOUND}s`, stalled.length === 0,
  stalled.length
    ? `${stalled.length} of ${rows.length} did. Worst: ` + stalled.slice(0, 4).map((r) =>
      `power ${r.power.toFixed(2)} aim ${r.aim.toFixed(1)} parked ${r.worstStall.toFixed(2)}s at y${r.stallAt.y} z${r.stallAt.z}`).join('; ')
    : '');

const worst = rows.reduce((a, b) => (b.worstStall > a.worstStall ? b : a), rows[0]);
console.log(`        (worst parked stretch in the sweep: ${worst.worstStall.toFixed(2)}s)`);

// --- 2. every throw still resolves -------------------------------------------------------------
const unresolved = rows.filter((r) => !r.resolved);
ok('every throw resolves', unresolved.length === 0,
  unresolved.length ? `${unresolved.length} throws never finished` : '');

// --- 3. the watchdog did not eat the machine -----------------------------------------------------
// A shorter window is only safe while the board still plays. These are floors, not targets: the
// tuning lives in boards.js and skeeball/js/test.js, not here.
const scored = rows.filter((r) => r.value !== 0);
ok('the machine still scores', scored.length > rows.length * 0.1,
  `only ${scored.length} of ${rows.length} throws scored anything`);

const hit = new Set(rows.map((r) => r.hole));
for (const row of [['bottom row (the penalty cups)', ['lowL', 'lowC', 'lowR']],
  ['middle row', ['midL', 'midC', 'midR']],
  ['top row (the skill row)', ['topL', 'topC', 'topR']]]) {
  ok(`${row[0]} is still reachable`, row[1].some((id) => hit.has(id)),
    `none of ${row[1].join('/')} was scored anywhere in the sweep`);
}

// --- 4. settle times stay sane -------------------------------------------------------------------
const times = rows.map((r) => r.t).sort((a, b) => a - b);
const median = times[times.length >> 1];
ok('median settle stays under 3s', median < 3, `median ${median.toFixed(2)}s`);
console.log(`        (median ${median.toFixed(2)}s, worst ${times[times.length - 1].toFixed(2)}s)`);

// --- 5. [KNOWN-BUG PROBE] no collar segment leaves its own hole's tread ---------------------------
// STRUCTURAL, and it is the one that would have caught this the day the staircase shipped: it
// needs no sweep and no ball. Every box of a collar belongs to the tread its hole is cut into.
// Rebuild each one in that hole's frame and demand the machine agrees.
{
  const strays = [];
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    if (!H.collarH) continue;
    // Resolved from M.frames here, NOT from a machine.js helper, so this probe still runs
    // against an engine that does not have one - which is what born-red means.
    const fr = M.frames.find((x) => H.v <= x.v1) || M.frames[M.frames.length - 1];
    const rr = H.r + G.collarThick / 2;
    const segs = M.solids.filter((s) => s.part === 'cupSeg' && s.cup === id);
    for (let i = 0; i < G.cupSegments; i++) {
      const phi = (i / G.cupSegments) * Math.PI * 2;
      const pu = H.u + rr * Math.cos(phi);
      const pv = H.v + rr * Math.sin(phi);
      const lowFrac = typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35;
      let h = H.collarH;
      if (H.lipLow) h = H.collarH * (lowFrac + (1 - lowFrac) * (Math.sin(phi) + 1) / 2);
      const dv = pv - fr.v0;
      const want = [pu, fr.y0 + dv * fr.sin + (h / 2) * fr.cos, fr.z0 - dv * fr.cos + (h / 2) * fr.sin];
      const got = segs[i].pos;
      const off = Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
      if (off > 1e-6) strays.push(`${id} seg ${i} is ${(off * 100).toFixed(1)}cm from its own tread`);
    }
  }
  ok('every collar segment is built in its own hole\'s tread frame', strays.length === 0,
    strays.slice(0, 4).join('; '));
}

// --- 6. [KNOWN-BUG PROBE] no ball parks INSIDE a basket ------------------------------------------
// Matt's symptom in his own words, measured in WORLD coordinates and nowhere else: is the parked
// ball inside a basket's cylinder? Face coordinates are what got this wrong twice (see the
// header), so this probe refuses to use them.
{
  const axis = {};
  for (const id of Object.keys(G.holes)) {
    const h = G.holes[id];
    const a0 = M.faceToWorld(h.u, h.v, 0);
    const a1 = M.faceToWorld(h.u, h.v, 1);
    const d = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    axis[id] = { a0, dir: [d[0] / L, d[1] / L, d[2] / L], def: h };
  }
  const inCup = (pt) => {
    for (const id of Object.keys(axis)) {
      const a = axis[id];
      const w = [pt.x - a.a0[0], pt.y - a.a0[1], pt.z - a.a0[2]];
      const along = w[0] * a.dir[0] + w[1] * a.dir[1] + w[2] * a.dir[2];
      const rad = Math.sqrt(Math.max(0, w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - along ** 2));
      if (rad < a.def.r && along > 0 && along < a.def.collarH + G.ballR) return { id, along, rad };
    }
    return null;
  };
  const inside = rows.filter((r) => r.worstStall > 0.4 && r.stallPos && inCup(r.stallPos))
    .map((r) => {
      const c = inCup(r.stallPos);
      return `power ${r.power.toFixed(2)} aim ${r.aim.toFixed(1)} sat ${r.worstStall.toFixed(2)}s in `
        + `${c.id}, ${(c.along * 100).toFixed(1)}cm up a ${(G.holes[c.id].collarH * 100).toFixed(1)}cm basket`;
    });
  ok('no ball comes to rest inside a basket', inside.length === 0, inside.slice(0, 4).join('; '));
}
console.log(`\nBRICK CITY stall probe: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
