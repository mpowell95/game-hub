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
  step, atRest, restScorer, SEGS, OPEN_SEGS,
} from './engine.js';

export const DIFFS = ['easy', 'medium', 'hard'];
/** Expert (Matt, 2026-11-06: "Add an expert level for admin only that's the perfect one"): ADMIN DEVICES ONLY,
 *  so it is not in DIFFS (which also feeds the online aiming-help row). */
export const EXPERT = 'expert';
const LEVEL = {
  //       shots to try  angle noise (rad)  power noise  how much it fears the reply  keeps a keeper
  easy:   { budget: 26, aim: 0.11, pow: 0.14, fear: 0, keeper: 0 },
  medium: { budget: 80, aim: 0.04, pow: 0.07, fear: 0.6, keeper: 12 },
  hard:   { budget: 190, aim: 0.013, pow: 0.025, fear: 1, keeper: 22 },
  // Expert: Hard's shots, then EVERY flick that touches the ball (each disc, straight or off either side wall,
  // across the whole cone, at SWEEP_POW strengths), no aim or strength error, and it shoots the first goal it
  // finds. The physics is deterministic, so a goal found is a goal scored. Defence as Hard when none exists.
  expert: { budget: 190, aim: 0, pow: 0, fear: 1, keeper: 22, sweep: true },
};
const SWEEP_ANGLES = 61;
const SWEEP_POW = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Expert's sweep, nearest disc first and straight at the ball before the banks. */
function* sweep(b, seat) {
  const ball = b[BALL];
  const targets = [[ball.x, ball.y], [2 * DISC_R - ball.x, ball.y], [2 * (W - DISC_R) - ball.x, ball.y]];
  const discs = discsOf(seat).slice().sort((p, q) => Math.hypot(b[p].x - ball.x, b[p].y - ball.y) - Math.hypot(b[q].x - ball.x, b[q].y - ball.y));
  for (let t = 0; t < targets.length; t++) {
    for (const i of discs) {
      const d = b[i];
      const [tx, ty] = targets[t];
      const dist = Math.hypot(tx - d.x, ty - d.y);
      if (dist < 1e-6) continue;
      const a0 = Math.atan2(ty - d.y, tx - d.x);
      let hw = Math.asin(Math.min(1, (DISC_R + BALL_R) / dist));
      if (t > 0) hw *= 1.6;   // a wall bounce loses speed, so the mirror image is only roughly right
      for (let k = 0; k < SWEEP_ANGLES; k++) {
        const a = a0 - hw + (2 * hw * k) / (SWEEP_ANGLES - 1);
        for (const power of SWEEP_POW) yield { i, dx: Math.cos(a), dy: Math.sin(a), power };
      }
    }
  }
}

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

/** A random stream that is a pure function of (match seed, the position): the same position in the
 *  same match always plans the same shot, so killing the app before the computer shoots and resuming
 *  cannot re-roll its plan (2026-10-29). A new match has a new seed. */
export function seededRng(seed, bodies, seat) {
  let h = 2166136261 ^ (Number(seed) >>> 0);
  let key = String(seat) + '|';
  for (const b of bodies) key += Math.round(b.x * 10) + ',' + Math.round(b.y * 10) + ';';
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generator: yields between candidates, returns the chosen { i, dx, dy, power } (noise applied). */
export function* planShot(bodies, seat, diff, rng = Math.random, opts = {}) {
  const open = !!opts.open;
  if (opts.level) return yield* planTest(bodies, seat, opts.level, rng, open);   // tests and tuning only
  if (opts.test && TEST_LEVEL[diff]) return yield* planTest(bodies, seat, TEST_LEVEL[diff], rng, open);
  const lv = LEVEL[diff] || LEVEL.medium;
  const list = candidates(bodies, seat, rng, lv.budget);
  let best = null, bestScore = -Infinity;
  const scored = [];
  const tryOne = (c) => {
    const b = cloneBodies(bodies);
    flick(b, c.i, c.dx, c.dy, c.power);
    const r = runToRest(b, 9, open);
    let s;
    if (r.scorer === seat) s = 10000 - r.steps * 0.01;
    else if (r.scorer === (seat ^ 1)) s = -20000;
    else s = judge(b, seat, lv);
    scored.push([s, c]);
    if (s > bestScore) { bestScore = s; best = c; }
    return r.scorer === seat;
  };
  let goal = false;
  for (const c of list) {
    goal = tryOne(c) || goal;
    yield;
    if (goal && lv.sweep) break;
  }
  if (lv.sweep && !goal) {
    for (const c of sweep(bodies, seat)) {
      const hit = tryOne(c);
      yield;
      if (hit) break;
    }
  }
  // Expert's hand is exact: the very flick it simulated, untouched (no angle round trip, no clamp).
  if (lv.sweep) return { i: best.i, dx: best.dx, dy: best.dy, power: best.power };
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
export function plan(bodies, seat, diff, rng, opts) {
  const g = planShot(bodies, seat, diff, rng, opts);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

// --- ADMIN TEST MODE (2026-11-06) ---------------------------------------------------------------------
// Matt: "winning a first to 3 game against hard can't be done by a person. It should be difficult, but it's
// not possible right now". In Test mode Easy, Medium and Hard see only what a person lining up a shot sees:
//   - a GOAL counts as seen only if it is CLEAN: the flicked disc touches the ball first, the ball then touches
//     no other piece, and it goes in straight (Easy) or off at most one wall or post (Medium, Hard). A goal
//     that needs a chain reaction is not seen, so it is never chosen (it can still happen by luck);
//   - each seen goal is tried with the level's OWN wobble (`tries` times) and the SUREST one is taken, but only
//     if it goes in often enough (`minP`); otherwise the best safe shot (judge(), as today);
//   - Easy (and a little Medium) sometimes just takes a decent shot instead of the best (`sloppy`).
// Expert is unchanged (it sees everything). The knobs were tuned against a stand-in player (docs in CLAUDE.md).
export const TEST_LEVEL = {
  easy:   { sight: 0, aim: 0.095, pow: 0.13, fear: 0, keeper: 0, sloppy: 0.45, minP: 0.1, tries: 6 },
  medium: { sight: 1, aim: 0.045, pow: 0.07, fear: 0.5, keeper: 10, sloppy: 0.3, minP: 0.15, tries: 8 },
  hard:   { sight: 1, aim: 0.032, pow: 0.05, fear: 0.8, keeper: 18, sloppy: 0, minP: 0.2, tries: 8 },
};

/** The shots a person would line up: each disc behind the ball at the left, middle and right of the goal,
 *  straight (and, with sight 1, off either side wall), at three strengths; two clearances through the ball;
 *  one drop back toward its own goal. */
function testCandidates(b, seat, rng, sight) {
  const ball = b[BALL], goal = attackGoal(seat), mine = ownGoal(seat), out = [];
  const gy = goal.y + goal.dir * 3, aims = [];
  for (const x of [GX0 + 5, (GX0 + GX1) / 2, GX1 - 5]) { aims.push([x, gy]); if (sight >= 1) aims.push([-x, gy], [2 * W - x, gy]); }
  for (const i of discsOf(seat)) {
    const d = b[i];
    for (const [tx, ty] of aims) {
      let ux = tx - ball.x, uy = ty - ball.y;
      const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const dx = ball.x - ux * (BALL_R + DISC_R) - d.x, dy = ball.y - uy * (BALL_R + DISC_R) - d.y;
      if (dx * ux + dy * uy <= 0) continue;
      for (const power of [0.5, 0.75, 1]) out.push({ i, dx, dy, power });
    }
    const cx = ball.x - d.x, cy = ball.y - d.y;
    out.push({ i, dx: cx, dy: cy, power: 1 }, { i, dx: cx, dy: cy, power: 0.6 });
    const hx = (mine.x + (rng() - 0.5) * 20) - d.x, hy = (mine.y - mine.dir * (14 + rng() * 14)) - d.y;
    out.push({ i, dx: hx, dy: hy, power: Math.min(1, Math.hypot(hx, hy) / 150 + 0.1) });
  }
  return out;
}

const touchesWall = (o, walls, ball) => {
  for (const s of walls) {
    if (s.discOnly && ball) continue;
    const ex = s.bx - s.ax, ey = s.by - s.ay;
    let t = ((o.x - s.ax) * ex + (o.y - s.ay) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s.ax + ex * t - o.x, qy = s.ay + ey * t - o.y;
    if (qx * qx + qy * qy <= (o.r + 0.05) * (o.r + 0.05)) return true;
  }
  return false;
};
const near = (p, q) => { const rr = p.r + q.r + 0.05; return (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= rr * rr; };

/** Play one flick on a copy, watching what touches what. Returns { scorer, steps, b, clean } where `clean`
 *  says whether a person could have seen this goal coming (see TEST_LEVEL). */
export function traceShot(bodies, seat, c, sight, open, maxSecs = 9) {
  const b = cloneBodies(bodies);
  flick(b, c.i, c.dx, c.dy, c.power);
  const walls = open ? OPEN_SEGS : SEGS, me = b[c.i], q = b[BALL];
  let first = null, other = false, bounces = 0, onWall = false;
  const max = Math.round(maxSecs * 240);
  let g = -1, k = 0;
  for (; k < max; k++) {
    g = step(b, open);
    if (first === null) {
      if (near(me, q)) first = 'ball';
      else if (touchesWall(me, walls, false)) first = 'wall';
      else for (let j = 1; j < b.length; j++) if (j !== c.i && near(me, b[j])) { first = 'piece'; break; }
    }
    if (first === 'ball') {
      for (let j = 1; j < b.length; j++) if (j !== c.i && near(q, b[j])) other = true;
      const w = touchesWall(q, walls, true);
      if (w && !onWall) bounces++;
      onWall = w;
    }
    if (g >= 0) break;
    if (atRest(b)) { g = restScorer(b); break; }
  }
  if (k >= max) { for (const o of b) { o.vx = 0; o.vy = 0; } g = restScorer(b); }
  return { scorer: g, steps: k, b, clean: first === 'ball' && !other && bounces <= sight };
}

function noisy(c, lv, rng) {
  const a = Math.atan2(c.dy, c.dx) + gauss(rng) * lv.aim;
  return { i: c.i, dx: Math.cos(a), dy: Math.sin(a), power: Math.max(0.2, Math.min(1, c.power * (1 + gauss(rng) * lv.pow))) };
}

function* planTest(bodies, seat, lv, rng, open) {
  const list = testCandidates(bodies, seat, rng, lv.sight);
  const scored = [], goals = [], safe = [];
  for (const c of list) {
    const r = traceShot(bodies, seat, c, lv.sight, open);
    if (r.scorer === (seat ^ 1)) scored.push([-20000, c]);
    else if (r.scorer === seat) { if (r.clean) goals.push({ c, steps: r.steps }); }   // an unseen goal is not a choice
    else { const j = judge(r.b, seat, lv); scored.push([j, c]); safe.push([j, c]); }
    yield;
  }
  // How often each seen goal goes in with this level's own hand.
  let bestGoal = null;
  for (const gl of goals) {
    let n = 0;
    for (let t = 0; t < lv.tries; t++) {
      const s = noisy(gl.c, lv, rng);
      const b = cloneBodies(bodies);
      flick(b, s.i, s.dx, s.dy, s.power);
      if (runToRest(b, 9, open).scorer === seat) n++;
      yield;
    }
    gl.p = n / lv.tries;
    if (!bestGoal || gl.p > bestGoal.p || (gl.p === bestGoal.p && gl.steps < bestGoal.steps)) bestGoal = gl;
    scored.push([10000 * gl.p, gl.c]);
  }
  scored.sort((a, b2) => b2[0] - a[0]);
  let pick;
  if (lv.sloppy && scored.length > 3 && rng() < lv.sloppy) {
    const pool = scored.slice(0, Math.max(2, Math.ceil(scored.length / 3)));
    pick = pool[Math.floor(rng() * pool.length)][1];
  } else if (bestGoal && bestGoal.p >= lv.minP) pick = bestGoal.c;
  else if (safe.length) pick = safe.reduce((a, x) => (x[0] > a[0] ? x : a))[1];
  else pick = (scored[0] || [0, list[0]])[1];
  return noisy(pick, lv, rng);
}
