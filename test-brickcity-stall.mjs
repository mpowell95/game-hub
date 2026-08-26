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
// THE BUG: the bottom row's cups are the widest on the machine and stand 3in back against their
// riser, so cup rim and riser form a cradle. A ball can balance in it - measured at world
// z -2.289 every single time - where capture cannot reach it (it is on top of a 0.146m collar,
// not in the mouth). The old watchdog then took 0.9s + 0.9s + 0.9s to give up: two visible pops
// and 2.7s of a dead ball on screen. See machines/brickcity/physics.js section 6.
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
        }
      } else from = -1;
    }
    rows.push({
      power, aim, worstStall, stallAt, t: st.t,
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

console.log(`\nBRICK CITY stall probe: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
