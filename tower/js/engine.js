// tower/js/engine.js — Tower's rules, PURE (no DOM, no clock). The UI owns drawing and time; this
// file owns the stack. A world is WORLD_W units wide; the UI scales it to the screen, so a phone and a
// tablet play the same game.
//
// The rule: a block slides across; on a drop, the part that overlaps the block below stays and the
// rest is cut off. Land within `perfect` units and the block keeps its full width (a PERFECT). A block
// NEVER grows back (Matt, 2026-11-02: "No growing back ever"; the 5-in-a-row regrow is gone). No overlap at
// all = the run is over. Score = blocks stacked on the base.

export const DIFFS = ['easy', 'medium', 'hard', 'expert'];
export const WORLD_W = 400;
export const START_W = 250;
export const BLOCK_H = 40;   // 2026-11-02, Matt: "each block should be taller" (was 26)

// v0: first block's speed (units/s); dv: added per block, FOREVER (no top speed: Matt, 2026-11-02, "There
// shouldn't be a max speed"); perfect: units of slack.
export const TUNE = {
  easy:   { v0: 150, dv: 8,  perfect: 8 },
  medium: { v0: 180, dv: 11, perfect: 6 },
  hard:   { v0: 220, dv: 14, perfect: 4.5 },
  expert: { v0: 420, dv: 17, perfect: 3.5 },   // v0 was 270 (Matt, 2026-11-12: "Expert starts way too slow still")
};

export function normDiff(d) { return DIFFS.indexOf(d) >= 0 ? d : 'medium'; }

/** A new run: the base slab, then the first sliding block. */
export function createRun(diff) {
  const run = {
    diff: normDiff(diff),
    stack: [{ x: (WORLD_W - START_W) / 2, w: START_W }],
    mover: null, streak: 0, bestStreak: 0, perfects: 0, over: false,
  };
  spawn(run);
  return run;
}

export function score(run) { return run.stack.length - 1; }

export function speedFor(diff, n) {
  const k = TUNE[normDiff(diff)];
  return k.v0 + k.dv * Math.max(0, n - 1);
}

/** The travel range for a block of width w: it may hang 60% off either edge. */
function range(w) { return { lo: -w * 0.6, hi: WORLD_W - w * 0.4 }; }

export function spawn(run) {
  const top = run.stack[run.stack.length - 1];
  const n = run.stack.length;
  const fromLeft = n % 2 === 1;
  const r = range(top.w);
  run.mover = { w: top.w, x: fromLeft ? r.lo : r.hi, dir: fromLeft ? 1 : -1, v: speedFor(run.diff, n) };
}

/** Move the sliding block dt seconds, bouncing at the ends. */
export function stepMover(run, dt) {
  const m = run.mover;
  if (!m || run.over) return;
  const r = range(m.w);
  m.x += m.dir * m.v * dt;
  // A long frame can overshoot more than once; fold it back until it is inside.
  for (let i = 0; i < 64 && (m.x > r.hi || m.x < r.lo); i++) {
    if (m.x > r.hi) { m.x = 2 * r.hi - m.x; m.dir = -1; }
    if (m.x < r.lo) { m.x = 2 * r.lo - m.x; m.dir = 1; }
  }
  m.x = Math.max(r.lo, Math.min(r.hi, m.x));
}

/** Drop the sliding block where it is. Returns what happened:
 *  { kind: 'perfect' | 'cut' | 'miss', cut: {x, w, dir} | null, grew: bool }. */
export function drop(run) {
  if (run.over || !run.mover) return { kind: 'none', cut: null, grew: false };
  const m = run.mover, top = run.stack[run.stack.length - 1];
  const diff = m.x - top.x;
  const tol = TUNE[run.diff].perfect;
  run.mover = null;
  if (Math.abs(diff) <= tol) {
    run.streak += 1; run.perfects += 1;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
    run.stack.push({ x: top.x, w: top.w });
    spawn(run);
    return { kind: 'perfect', cut: null, grew: false };
  }
  run.streak = 0;
  const left = Math.max(m.x, top.x), right = Math.min(m.x + m.w, top.x + top.w);
  const keep = right - left;
  if (keep <= 0) {
    run.over = true;
    return { kind: 'miss', cut: { x: m.x, w: m.w, dir: diff > 0 ? 1 : -1 }, grew: false };
  }
  run.stack.push({ x: left, w: keep });
  const cut = diff > 0 ? { x: right, w: m.w - keep, dir: 1 } : { x: m.x, w: m.w - keep, dir: -1 };
  spawn(run);
  return { kind: 'cut', cut, grew: false };
}

export default { DIFFS, WORLD_W, START_W, BLOCK_H, TUNE, createRun, score, spawn, stepMover, drop, speedFor, normDiff };
