// air-hockey/js/physics.js - the table, the puck and the two mallets. Pure: no DOM, no clock, no
// allocation per step, so the headless test (js/test.js) runs the exact code the game runs.
//
// Coordinates are LOGICAL units: the playing surface is TABLE.W x TABLE.H, origin top-left, the
// computer's goal at y = 0 (top) and the player's at y = H (bottom). Side 0 is the player (bottom
// half), side 1 the computer / far player (top half).
//
// TUNNELLING (docs/BUILDING-A-GAME.md, "Preventing physics tunnelling through thin geometry"):
//   - fixed 240 Hz step with a MAX_STEPS catch-up cap, so a stalled tab cannot teleport the puck;
//   - PUCK_MAX / 240 = 9.6 units per step, well under the puck's 22-unit radius, so a wall or a
//     goal post (a point) can never be stepped over;
//   - the mallet is the one fast thin-ish thing, and it moves up to MALLET_MAX / 240 = 16 units a
//     step AGAINST a puck moving 9.6 the other way, so mallet-vs-puck is SWEPT: the exact time of
//     contact inside the step is solved for, never sampled.

export const TABLE = {
  W: 500,
  H: 900,
  CORNER: 70,      // radius of the rounded corners
  GOAL_W: 170,     // goal slot width, centred in each end wall
  PUCK_R: 22,
  MALLET_R: 36,
  RIM: 24,         // drawn only; the playing surface is 0..W x 0..H
};

export const PHYS = {
  DT: 1 / 240,
  MAX_STEPS: 24,         // at most 0.1 s of catch-up per frame
  FRICTION: 0.3,         // per second, exponential: the puck keeps ~74% of its speed after 1 s
  WALL_E: 0.88,          // wall bounce keeps 88% of the normal speed
  MALLET_E: 0.8,         // mallet hit restitution (the mallet is infinitely heavy)
  PUCK_MAX: 2300,
  MALLET_MAX: 3800,
  STUCK_SPEED: 45,       // below this the puck counts as sitting still
  STUCK_TIME: 5,         // seconds sitting still in one half before it is moved to that player
  GOAL_PAUSE: 1.2,       // seconds between a goal and the serve
  WIN: 7,
};

const { W, H, CORNER: C, PUCK_R: PR, MALLET_R: MR } = TABLE;
const GX0 = (W - TABLE.GOAL_W) / 2;
const GX1 = (W + TABLE.GOAL_W) / 2;
export const GOAL_X0 = GX0, GOAL_X1 = GX1;

function mallet(side) {
  const y = side === 0 ? H - 110 : 110;
  // (tx,ty) is where the mallet is being asked to go by the end of this frame; (fx,fy) where it
  // was asked to be at the end of the last one. Each sub-step aims at the interpolation between
  // them, so a finger that moved 40 units in a frame gives four 10-unit steps (a smooth velocity)
  // rather than one 40-unit jump and three still steps (a velocity spike, and a random shot).
  return { side, x: W / 2, y, ox: W / 2, oy: y, vx: 0, vy: 0, tx: W / 2, ty: y, fx: W / 2, fy: y };
}

export function createMatch() {
  return {
    phase: 'play',         // play | goal | over
    timer: 0,              // goal pause countdown
    score: [0, 0],
    winner: -1,
    lastGoal: -1,          // side that SCORED the last goal
    puck: { x: W / 2, y: H * 0.72, vx: 0, vy: 0, live: true },
    mallets: [mallet(0), mallet(1)],
    stuckHalf: -1,
    stuckT: 0,
    acc: 0,
    // Events for the UI, reset by it after reading (sound, flash). Numbers only, no allocation.
    ev: { hit: 0, wall: 0, goal: -1, stuck: -1 },
  };
}

/** Reset positions for a fresh match (keeps the object: no allocation on rematch). */
export function resetMatch(s, server = 0) {
  s.phase = 'play'; s.timer = 0; s.score[0] = 0; s.score[1] = 0; s.winner = -1; s.lastGoal = -1;
  s.stuckHalf = -1; s.stuckT = 0; s.acc = 0;
  for (const m of s.mallets) {
    const y = m.side === 0 ? H - 110 : 110;
    m.x = m.tx = m.fx = W / 2; m.y = m.ty = m.fy = y; m.vx = m.vy = 0;
  }
  serve(s, server);
}

/** Put the puck, still, in `side`'s half for that player to play. Avoids landing on a mallet. */
export function serve(s, side) {
  const p = s.puck;
  const y = side === 0 ? H * 0.7 : H * 0.3;
  const m = s.mallets[side];
  let x = W / 2;
  if (Math.hypot(m.x - x, m.y - y) < MR + PR + 8) x = m.x < W / 2 ? W / 2 + 110 : W / 2 - 110;
  p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.live = true;
  s.stuckHalf = -1; s.stuckT = 0;
}

/** Keep a body of radius r inside the rounded table and inside y in [y0, y1]. Returns nothing;
 *  moves b.x/b.y in place. Used for mallets (the puck has its own bouncing version). */
function clampBody(b, r, y0, y1) {
  if (b.x < r) b.x = r; else if (b.x > W - r) b.x = W - r;
  if (b.y < y0) b.y = y0; else if (b.y > y1) b.y = y1;
  const inner = C - r;
  const cx = b.x < C ? C : b.x > W - C ? W - C : -1;
  const cy = b.y < C ? C : b.y > H - C ? H - C : -1;
  if (cx >= 0 && cy >= 0) {
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    if (d > inner) { b.x = cx + dx / d * inner; b.y = cy + dy / d * inner; }
  }
}

function malletBounds(m) {
  return m.side === 0 ? [H / 2 + MR, H - MR] : [MR, H / 2 - MR];
}

/** Reflect the puck's velocity off a surface with outward normal (nx,ny) if it is moving into it. */
function bounce(p, nx, ny, e, s) {
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) {
    p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny;
    if (-vn > s.ev.wall) s.ev.wall = -vn;
  }
}

/** Walls, rounded corners, goal posts and the goal slot's side walls, for the puck. */
function puckWalls(p, s) {
  const e = PHYS.WALL_E;
  if (p.x < PR) { p.x = PR; bounce(p, 1, 0, e, s); }
  else if (p.x > W - PR) { p.x = W - PR; bounce(p, -1, 0, e, s); }
  const inMouth = p.x > GX0 && p.x < GX1;
  if (!inMouth) {
    if (p.y < PR) { p.y = PR; bounce(p, 0, 1, e, s); }
    else if (p.y > H - PR) { p.y = H - PR; bounce(p, 0, -1, e, s); }
  } else if (p.y < 0 || p.y > H) {
    // Inside a goal slot: its side walls are the posts extended backwards.
    if (p.x < GX0 + PR) { p.x = GX0 + PR; bounce(p, 1, 0, e, s); }
    else if (p.x > GX1 - PR) { p.x = GX1 - PR; bounce(p, -1, 0, e, s); }
  }
  // Goal posts: the four slot corners, as points. Only while the puck is on the table side of
  // the end line; past it the slot walls above take over (the post is their end point).
  if (p.y >= 0 && p.y < PR) { post(p, GX0, 0, s); post(p, GX1, 0, s); }
  else if (p.y <= H && p.y > H - PR) { post(p, GX0, H, s); post(p, GX1, H, s); }
  // Rounded corners.
  const cx = p.x < C ? C : p.x > W - C ? W - C : -1;
  const cy = p.y < C ? C : p.y > H - C ? H - C : -1;
  if (cx >= 0 && cy >= 0) {
    const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy), inner = C - PR;
    if (d > inner) {
      const nx = -dx / d, ny = -dy / d;
      p.x = cx - nx * inner; p.y = cy - ny * inner;
      bounce(p, nx, ny, e, s);
    }
  }
}

function post(p, px, py, s) {
  const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy);
  if (d < PR && d > 1e-6) {
    const nx = dx / d, ny = dy / d;
    p.x = px + nx * PR; p.y = py + ny * PR;
    bounce(p, nx, ny, PHYS.WALL_E, s);
  }
}

/** Mallet `m` hits the puck: reflect the RELATIVE velocity about the contact normal. The mallet
 *  is infinitely heavy, so its own velocity is passed straight on: a fast swipe is a hard shot. */
function hit(p, m, nx, ny, s) {
  const wx = p.vx - m.vx, wy = p.vy - m.vy;
  const vn = wx * nx + wy * ny;
  if (vn >= 0) return;
  p.vx -= (1 + PHYS.MALLET_E) * vn * nx;
  p.vy -= (1 + PHYS.MALLET_E) * vn * ny;
  if (-vn > s.ev.hit) s.ev.hit = -vn;
}

function capSpeed(p) {
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > PHYS.PUCK_MAX) { const k = PHYS.PUCK_MAX / sp; p.vx *= k; p.vy *= k; }
}

/** One fixed step of `dt` seconds. `a` in (0,1] is how far through the frame this step ends, for
 *  the mallet target interpolation. */
function substep(s, dt, a) {
  const p = s.puck;
  const SUM = MR + PR;

  // 1. Mallets move toward their interpolated targets, speed-capped, kept in their own half.
  for (const m of s.mallets) {
    const ox = m.x, oy = m.y;
    const gx = m.fx + (m.tx - m.fx) * a, gy = m.fy + (m.ty - m.fy) * a;
    let dx = gx - m.x, dy = gy - m.y;
    const d = Math.hypot(dx, dy), max = PHYS.MALLET_MAX * dt;
    if (d > max) { dx *= max / d; dy *= max / d; }
    m.x += dx; m.y += dy;
    const b = malletBounds(m);
    clampBody(m, MR, b[0], b[1]);
    m.vx = (m.x - ox) / dt; m.vy = (m.y - oy) / dt;
    m.ox = ox; m.oy = oy;
  }

  if (!p.live) return;

  // 2. The puck moves, swept against both mallets over the step.
  let t = 0;
  for (let pass = 0; pass < 2 && t < dt; pass++) {
    let best = -1, bestT = dt - t;
    for (let i = 0; i < 2; i++) {
      const m = s.mallets[i];
      // Mallet position at time t within the step (it moves linearly from (ox,oy) to (x,y)).
      const mx = m.ox + m.vx * t, my = m.oy + m.vy * t;
      const dx = p.x - mx, dy = p.y - my;
      const c = dx * dx + dy * dy - SUM * SUM;
      if (c < 0) {
        // Already overlapping (the puck was squeezed, or served onto a mallet): push it out
        // along the line of centres and bounce if it is moving in.
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const nx = dx / d, ny = dy / d;
        p.x = mx + nx * (SUM + 0.01); p.y = my + ny * (SUM + 0.01);
        hit(p, m, nx, ny, s);
        continue;
      }
      const wx = p.vx - m.vx, wy = p.vy - m.vy;
      const A = wx * wx + wy * wy;
      const B = 2 * (dx * wx + dy * wy);
      if (B >= 0 || A < 1e-9) continue;
      const disc = B * B - 4 * A * c;
      if (disc < 0) continue;
      const toi = (-B - Math.sqrt(disc)) / (2 * A);
      if (toi >= 0 && toi < bestT) { bestT = toi; best = i; }
    }
    p.x += p.vx * bestT; p.y += p.vy * bestT;
    t += bestT;
    if (best < 0) break;
    const m = s.mallets[best];
    const mx = m.ox + m.vx * t, my = m.oy + m.vy * t;
    const d = Math.hypot(p.x - mx, p.y - my) || 1e-6;
    hit(p, m, (p.x - mx) / d, (p.y - my) / d, s);
    capSpeed(p);
  }
  if (t < dt) { p.x += p.vx * (dt - t); p.y += p.vy * (dt - t); }

  // 3. Walls.
  puckWalls(p, s);

  // 4. Squeezed between a mallet and a wall: the wall wins, so the MALLET gives way.
  for (const m of s.mallets) {
    const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
    if (d < SUM && d > 1e-6) {
      m.x = p.x + dx / d * SUM; m.y = p.y + dy / d * SUM;
      const b = malletBounds(m);
      clampBody(m, MR, b[0], b[1]);
    }
  }

  // 5. Air-table friction, speed cap.
  const f = Math.exp(-PHYS.FRICTION * dt);
  p.vx *= f; p.vy *= f;
  capSpeed(p);

  // 6. Goals: the puck must be ALL the way into the slot.
  if (p.y + PR < 0) return goal(s, 0);
  if (p.y - PR > H) return goal(s, 1);

  // 7. Stuck puck: sitting still in one half for STUCK_TIME goes to the player on that side.
  const half = p.y < H / 2 ? 1 : 0;
  if (Math.hypot(p.vx, p.vy) < PHYS.STUCK_SPEED) {
    if (half === s.stuckHalf) s.stuckT += dt; else { s.stuckHalf = half; s.stuckT = 0; }
    if (s.stuckT >= PHYS.STUCK_TIME) { serve(s, half); s.ev.stuck = half; }
  } else { s.stuckHalf = -1; s.stuckT = 0; }
}

function goal(s, scorer) {
  s.score[scorer]++;
  s.lastGoal = scorer;
  s.puck.live = false;
  s.puck.vx = s.puck.vy = 0;
  s.ev.goal = scorer;
  if (s.score[scorer] >= PHYS.WIN) { s.phase = 'over'; s.winner = scorer; }
  else { s.phase = 'goal'; s.timer = PHYS.GOAL_PAUSE; }
}

/** Advance the match by one rendered frame of `frameDt` seconds (fixed sub-steps inside). */
export function advance(s, frameDt) {
  s.acc += frameDt;
  let n = Math.floor(s.acc / PHYS.DT);
  if (n > PHYS.MAX_STEPS) { n = PHYS.MAX_STEPS; s.acc = 0; } else s.acc -= n * PHYS.DT;
  for (let k = 0; k < n; k++) {
    if (s.phase === 'goal') {
      s.timer -= PHYS.DT;
      // The player who was scored on serves.
      if (s.timer <= 0) { s.phase = 'play'; serve(s, 1 - s.lastGoal); }
    }
    substep(s, PHYS.DT, (k + 1) / n);
  }
  if (n > 0) for (const m of s.mallets) { m.fx = m.tx; m.fy = m.ty; }
}

/** Where a mallet may be asked to go: its own half, inside the walls. */
export function clampTarget(m, x, y) {
  const b = malletBounds(m);
  m.tx = Math.max(MR, Math.min(W - MR, x));
  m.ty = Math.max(b[0], Math.min(b[1], y));
}
