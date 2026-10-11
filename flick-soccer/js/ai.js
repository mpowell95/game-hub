// flick-soccer/js/ai.js - the computer. It does what a person does: picks a disc, lines it up
// behind the ball, and hits it toward the goal (straight, or off a side wall). Every candidate shot
// is SIMULATED on a copy of the pitch with the real physics (engine.js runToRest), and the one whose
// outcome scores best is played. Difficulty changes how many shots it tries, how far it looks at
// the danger it leaves behind, and how cleanly it hits the shot it chose.
//
// planShot is a generator so the UI can run it a slice at a time between frames; `plan` runs it
// to the end (the headless test, and a match finished off-screen).

import {
  W, H, GX0, GX1, DISC_R, BALL_R, BALL, discsOf, attackGoal, ownGoal, cloneBodies, flick, runToRest,
} from './engine.js';

export const DIFFS = ['easy', 'medium', 'hard'];
const LEVEL = {
  //       shots to try  angle noise (rad)  power noise  how much it fears the reply  keeps a keeper
  easy:   { budget: 26, aim: 0.11, pow: 0.14, fear: 0, keeper: 0 },
  medium: { budget: 80, aim: 0.04, pow: 0.07, fear: 0.6, keeper: 12 },
  hard:   { budget: 190, aim: 0.013, pow: 0.025, fear: 1, keeper: 22 },
};

/** A small seeded RNG so a test can replay a computer's choices. */
export function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(rng) {
  let u = 0; while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Every shot worth trying for `seat`: { i, dx, dy, power }. */
function candidates(b, seat, rng, budget) {
  const ball = b[BALL];
  const goal = attackGoal(seat);
  const mine = ownGoal(seat);
  const out = [];
  // Points just inside the goal it attacks, and their reflections in each side wall (a bank shot).
  const gy = goal.y + goal.dir * 3;
  const aims = [];
  for (const x of [GX0 + 5, (GX0 + GX1) / 2, GX1 - 5]) aims.push([x, gy], [-x, gy], [2 * W - x, gy]);
  const powers = [0.5, 0.75, 1];
  for (const i of discsOf(seat)) {
    const d = b[i];
    for (const [tx, ty] of aims) {
      // Where the disc must be at contact to send the ball at (tx, ty): the "ghost" behind the ball.
      let ux = tx - ball.x, uy = ty - ball.y;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const gx = ball.x - ux * (BALL_R + DISC_R), gy2 = ball.y - uy * (BALL_R + DISC_R);
      const dx = gx - d.x, dy = gy2 - d.y;
      // From the wrong side of the ball the cut is impossible; skip it rather than waste a sim.
      if (dx * ux + dy * uy <= 0) continue;
      for (const p of powers) out.push({ i, dx, dy, power: p });
    }
    // Straight through the middle of the ball: a clearance, hard or soft.
    const cx = ball.x - d.x, cy = ball.y - d.y;
    out.push({ i, dx: cx, dy: cy, power: 1 }, { i, dx: cx, dy: cy, power: 0.6 });
    // Back toward its own goal: a disc dropping in to defend.
    const hx = (mine.x + (rng() - 0.5) * 20) - d.x, hy = (mine.y - mine.dir * (14 + rng() * 14)) - d.y;
    out.push({ i, dx: hx, dy: hy, power: Math.min(1, Math.hypot(hx, hy) / 150 + 0.1) });
  }
  // Shuffle so a small budget still samples every disc, then top up with random flicks.
  for (let k = out.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [out[k], out[j]] = [out[j], out[k]]; }
  out.length = Math.min(out.length, Math.max(8, budget - 6));
  const discs = discsOf(seat);
  while (out.length < budget) {
    const a = rng() * Math.PI * 2;
    out.push({ i: discs[Math.floor(rng() * discs.length)], dx: Math.cos(a), dy: Math.sin(a), power: 0.35 + rng() * 0.65 });
  }
  return out;
}

/** How good a resting position is for `seat` (higher is better). */
function judge(b, seat, lv) {
  const ball = b[BALL];
  const mine = ownGoal(seat);
  // Ball progress: how far the ball is from my own goal line, 0..1.
  const far = Math.abs(ball.y - mine.y) / H;
  let s = far * 300;
  // Ball near the middle of the pitch's width is more dangerous both ways; mostly track depth.
  if (lv.fear) {
    // The reply: an opponent disc that sits behind the ball, lined up on my goal, is a shot on.
    let ux = mine.x - ball.x, uy = mine.y - ball.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const gx = ball.x - ux * (BALL_R + DISC_R), gy = ball.y - uy * (BALL_R + DISC_R);
    let threat = 0;
    for (const j of discsOf(seat ^ 1)) {
      const d = b[j];
      const ax = gx - d.x, ay = gy - d.y;
      const al = Math.hypot(ax, ay);
      if (al < 1e-6 || ax * ux + ay * uy <= 0) continue;
      const cos = (ax * ux + ay * uy) / al;           // 1 = perfectly lined up
      threat = Math.max(threat, Math.max(0, cos) ** 2 * (1 / (1 + al / 40)));
    }
    // Is one of mine standing in the way, between the ball and my goal?
    let blocked = 0;
    for (const j of discsOf(seat)) {
      const d = b[j];
      const fx = d.x - ball.x, fy = d.y - ball.y;
      const along = fx * ux + fy * uy;
      if (along <= 0 || along > ul) continue;
      const perp = Math.abs(fx * uy - fy * ux);
      if (perp < DISC_R + BALL_R + 1) { blocked = 1; break; }
    }
    s -= lv.fear * threat * (1 - far) * (blocked ? 120 : 520);
  }
  if (lv.keeper) {
    // A disc of mine in front of my own goal mouth.
    let best = Infinity;
    for (const j of discsOf(seat)) best = Math.min(best, Math.hypot(b[j].x - mine.x, b[j].y - mine.y));
    if (best < 24) s += lv.keeper;
  }
  return s;
}

/** Generator: yields between candidates, returns the chosen { i, dx, dy, power } (noise applied). */
export function* planShot(bodies, seat, diff, rng = Math.random) {
  const lv = LEVEL[diff] || LEVEL.medium;
  const list = candidates(bodies, seat, rng, lv.budget);
  let best = null, bestScore = -Infinity;
  const scored = [];
  for (const c of list) {
    const b = cloneBodies(bodies);
    flick(b, c.i, c.dx, c.dy, c.power);
    const r = runToRest(b, 9);
    let s;
    if (r.scorer === seat) s = 10000 - r.steps * 0.01;
    else if (r.scorer === (seat ^ 1)) s = -20000;
    else s = judge(b, seat, lv);
    scored.push([s, c]);
    if (s > bestScore) { bestScore = s; best = c; }
    yield;
  }
  // Easy is not only shaky, it also does not always see the best shot.
  if (diff === 'easy' && scored.length > 3 && rng() < 0.45) {
    scored.sort((a, b2) => b2[0] - a[0]);
    const pool = scored.slice(0, Math.max(2, Math.ceil(scored.length * 0.35)));
    best = pool[Math.floor(rng() * pool.length)][1];
  }
  // The hand is not perfect: a little error in angle and strength.
  const a = Math.atan2(best.dy, best.dx) + gauss(rng) * lv.aim;
  const power = Math.max(0.2, Math.min(1, best.power * (1 + gauss(rng) * lv.pow)));
  return { i: best.i, dx: Math.cos(a), dy: Math.sin(a), power };
}

/** Run planShot to the end. */
export function plan(bodies, seat, diff, rng) {
  const g = planShot(bodies, seat, diff, rng);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
