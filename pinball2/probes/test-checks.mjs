// Do the CHECKS tell the truth? `run.mjs` asks questions about a table; this asks whether the
// functions answering them are right, against gaps whose size is known by construction.
//
//   node pinball2/probes/test-checks.mjs        (no browser, no server, under a second)
//
// The gap rule is the one worth pinning hardest, because it is the check a table is DESIGNED
// against: every clearance on a playfield is deliberately pushed under 0.75 of a ball or over 1.15,
// and if the measurement is wrong the design is wrong everywhere at once.

import { CONFIG } from '../machines/testbox/config.js';
import { checkGaps, restSweep } from './checks.js';
import { World } from '../machines/testbox/physics.js';
import { makeBoardwalk } from '../machines/testbox/tables/boardwalk.js';

let pass = 0;
let fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n      ' + detail : ''}`); }
};

const BALL = CONFIG.BALL_R * 2;                 // 27mm
const drain = { id: 'd', kind: 'drain', x: 0, y: 1.005, w: 0.515, h: 0.062 };
const table = (shapes) => ({ name: 'T', w: 0.515, h: 1.067, launch: { x: 0.25, y: 0.1 }, shapes: shapes.concat([drain]) });

/** The gap checkGaps reports between the only two parts on a table, or null if it says nothing. */
const measured = (a, b) => {
  const f = checkGaps(table([a, b]), CONFIG).filter((x) => x.kind === 'gap');
  return f.length ? f[0].gap : null;
};
const flagged = (a, b) => measured(a, b) != null;

const postAt = (x, y, r) => ({ id: `p${x}`, kind: 'circle', c: { x, y }, r });
const bumpAt = (x, y, r) => ({ id: `b${x}`, kind: 'bumper', c: { x, y }, r });
const railAt = (x, y0, y1, r) => ({ id: `w${x}`, kind: 'seg', a: { x, y: y0 }, b: { x, y: y1 }, r });

// ------------------------------------------------- [KNOWN-BUG PROBE] the radius counted twice
// `surfacePoints` returns a shape's CENTRELINE, because `checkGaps` subtracts that shape's own
// radius afterwards. For a circle it used to return the SURFACE, so the radius came off twice and
// every clearance next to a post or a bumper read short - by 9mm beside a post and 25mm beside a
// bumper. Both directions are wrong, and the second one is the dangerous one.
//
// Two posts, centres 60mm apart, r 10mm each: the ball-sized gap between them is 40mm, which is
// wider than 1.15 balls and must NOT be flagged. Before the fix it measured 30mm and failed.
{
  const g = measured(postAt(0.200, 0.500, 0.010), postAt(0.260, 0.500, 0.010));
  ok(g == null, `two posts 40mm apart are an open lane, not a wedge (${g == null ? 'not flagged' : (g * 1000).toFixed(1) + 'mm'})`);
}

// A bumper beside a rail with 50mm of real clearance. The old maths called it 25mm: a fail on a
// table that was fine, and the exact shape of the false alarm that makes a check get ignored.
{
  const g = measured(bumpAt(0.200, 0.400, 0.025), railAt(0.283, 0.300, 0.500, 0.008));
  ok(g == null, `a bumper 50mm clear of a rail is not a wedge (${g == null ? 'not flagged' : (g * 1000).toFixed(1) + 'mm'})`);
}

// THE ONE THAT MATTERS. A post and a rail with a real gap of exactly one ball: the thing the whole
// check exists to find. The old maths made it 27 - 9 = 18mm, under the 0.75-ball floor, so it was
// not flagged as a gap at all - and a NEGATIVE result would have been filed as a deliberate
// overlap, which is a note rather than a failure. A wedge could hide next to any post on the table.
{
  const a = postAt(0.200, 0.500, 0.010);
  const b = railAt(0.200 + 0.010 + BALL + 0.008, 0.400, 0.600, 0.008);
  const g = measured(a, b);
  ok(g != null && Math.abs(g - BALL) < 0.001,
    `a one-ball gap beside a post is found, and measured as one ball (${g == null ? 'MISSED' : (g * 1000).toFixed(1) + 'mm against ' + (BALL * 1000).toFixed(1)}`);
}

// The same gap between two rails, which was always measured correctly. It is here so the fix is
// pinned as agreement between the kinds, not just as a number.
{
  const g = measured(railAt(0.200, 0.400, 0.600, 0.010), railAt(0.200 + 0.010 + BALL + 0.008, 0.400, 0.600, 0.008));
  ok(g != null && Math.abs(g - BALL) < 0.001,
    `and between two rails it measures the same (${g == null ? 'MISSED' : (g * 1000).toFixed(1) + 'mm'})`);
}

// Either side of the window: 0.75 and 1.15 ball widths are the edges, so 0.6 and 1.4 must be quiet.
{
  const shut = measured(postAt(0.200, 0.500, 0.010), railAt(0.200 + 0.010 + BALL * 0.6 + 0.008, 0.400, 0.600, 0.008));
  const open = measured(postAt(0.200, 0.500, 0.010), railAt(0.200 + 0.010 + BALL * 1.4 + 0.008, 0.400, 0.600, 0.008));
  ok(shut == null, `a clearly shut gap beside a post is quiet (${shut == null ? 'not flagged' : (shut * 1000).toFixed(1) + 'mm'})`);
  ok(open == null, `a clearly open one is quiet too (${open == null ? 'not flagged' : (open * 1000).toFixed(1) + 'mm'})`);
}

// A deliberate overlap is a note, never a failure: an overlap is how you SHUT a gap.
{
  const f = checkGaps(table([postAt(0.200, 0.500, 0.020), railAt(0.210, 0.400, 0.600, 0.010)]), CONFIG);
  ok(f.length === 1 && f[0].kind === 'overlap', 'two parts driven into each other are an overlap, not a gap',
    JSON.stringify(f.map((x) => x.kind)));
}

// ------------------------------------------------- a dead stop needs something holding the ball
// BOARDWALK reported two dead stops, both "on nothing", and a re-drop from each of those exact
// coordinates rolled straight out. They were balls at the APEX OF AN ARC when the six second clock
// ran out: momentarily slow, touching nothing, and accelerating the whole time. Gravity along this
// playfield is a constant, so a ball held by no solid and riding no ramp cannot be at rest - and a
// FAIL line that cries wolf is a FAIL line that stops being read.
//
// The rule has to keep catching the real thing, which is what these two pin from both sides.
{
  const BR = CONFIG.BALL_R;
  // A CUP: two walls and a floor, tight enough that a ball dropped in cannot climb out. This is the
  // shape of every trap this repo has ever found, and the probe must still name it.
  const cup = table([
    { id: 'cl', kind: 'seg', a: { x: 0.230, y: 0.400 }, b: { x: 0.230, y: 0.500 }, r: 0.006 },
    { id: 'cr', kind: 'seg', a: { x: 0.230 + BR * 2.2, y: 0.400 }, b: { x: 0.230 + BR * 2.2, y: 0.500 }, r: 0.006 },
    { id: 'cf', kind: 'seg', a: { x: 0.220, y: 0.500 }, b: { x: 0.320, y: 0.500 }, r: 0.006 },
  ]);
  const r = restSweep(cup, CONFIG, { step: 0.010, seconds: 4 });
  const inCup = r.stuck.filter((s) => s.at.y > 0.44 && s.at.x > 0.22 && s.at.x < 0.32);
  ok(inCup.length > 0, `a ball in a cup is still reported as a dead stop (${inCup.length} of ${r.stuck.length})`,
    `drops ${r.drops}, edges ${r.edges.length}`);
  ok(r.stuck.every((s) => s.on || s.ribbon), 'and every dead stop names the thing holding the ball',
    JSON.stringify(r.stuck.filter((s) => !s.on).map((s) => s.at)));
}
{
  // NOTHING TO REST ON. An open table with only its outer walls: every ball reaches the drain, and
  // any that has not in four seconds is in flight, never stuck.
  const open = table([
    { id: 'wl', kind: 'seg', a: { x: 0.008, y: 0.02 }, b: { x: 0.008, y: 1.00 }, r: 0.008 },
    { id: 'wr', kind: 'seg', a: { x: 0.507, y: 0.02 }, b: { x: 0.507, y: 1.00 }, r: 0.008 },
  ]);
  const r = restSweep(open, CONFIG, { step: 0.030, seconds: 4 });
  ok(r.stuck.length === 0, `an open playfield has no dead stops (${r.drops} drops, ${r.stuck.length})`,
    JSON.stringify(r.stuck.slice(0, 3)));
}

// ------------------------------------------------- a launch has to put the ball INTO PLAY
// The first version of the plunger was tested by asking "did the ball reach the playfield". It did,
// and the table was still unplayable: at 3.2 m/s it crested the top corner with so much speed left
// that it skimmed the whole top rail, hugged the left rail and drained in one second having touched
// no bumper, no slingshot and neither flipper. Matt: "just shoots straight out."
//
// SO THE QUESTION IS NOT WHERE THE BALL GOT TO, IT IS WHETHER ANYTHING HAPPENED. A launch that
// touches nothing that can hit back is a launch that failed, wherever the ball travelled.
{
  const KIND = {};
  const t = makeBoardwalk();
  for (const s of t.shapes) KIND[s.id] = s.kind;
  const w = new World(t, CONFIG);
  const b = w.addBall(t.launch, t.launchV || { x: 0, y: 0.1 });
  const touched = new Set();
  let secs = 0;
  for (let k = 0; k < Math.round(20 / CONFIG.DT) && b.alive; k++) {
    w.step(CONFIG.DT);
    for (const ev of w.events) if (ev.id) touched.add(ev.id);
    w.events.length = 0;
    secs = k * CONFIG.DT;
  }
  const live = [...touched].filter((i) => ['bumper', 'sling', 'flipper'].includes(KIND[i]));
  ok(t.launchV && t.launchV.y < 0, 'BOARDWALK has a plunger, firing UP its shooter lane');
  ok(live.length >= 2, `and a launch puts the ball into PLAY, not just onto the playfield (hit ${live.join(', ') || 'NOTHING that hits back'})`);
  ok(secs > 4, `the ball survives more than a moment (${secs.toFixed(1)}s before it drained)`);
}

console.log(`\nCheck tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
