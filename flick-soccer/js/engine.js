// flick-soccer/js/engine.js - the whole game as data: the pitch, the discs, the physics and the
// rules. Pure, no DOM, deterministic (the same shot from the same position always ends the same
// way), so the computer can try shots by simulating them and the headless test can replay a match.
//
// CROSS-DEVICE DETERMINISM (2026-10-11, online challenges): the physics uses only + - * / and
// Math.sqrt, which IEEE 754 requires to be correctly rounded, so an iPhone (JavaScriptCore) and an
// Android phone (V8) step a shot to the very same bits. Math.hypot, Math.exp, Math.sin/cos are NOT
// required to agree across engines, so they never appear on the physics path. An online match is a
// log of flicks replayed on each phone; one differing last bit can grow into a different goal.
//
// Units are "pitch units": the playing area is W x H with seat 0 at the BOTTOM attacking the top
// goal, seat 1 at the top attacking the bottom goal. Bodies: index 0 is the ball, 1-5 are seat 0's
// discs, 6-10 are seat 1's.

export const W = 100;
export const H = 160;
export const GOAL_W = 30;
export const GOAL_D = 9;
export const GX0 = (W - GOAL_W) / 2;
export const GX1 = GX0 + GOAL_W;
export const DISC_R = 6.2;
export const BALL_R = 3.6;
const DISC_M = 1;
const BALL_M = 0.5;
/** The fastest a flick can send a disc. Per-step travel (MAX_SPEED * DT, and SPEED_CAP * DT after a
 *  collision hands the light ball more) stays well under BALL_R, the thinnest thing that can be hit,
 *  so nothing tunnels through a wall or a post (docs/BUILDING-A-GAME.md, Part 3). */
export const MAX_SPEED = 250;
const SPEED_CAP = 380;
export const DT = 1 / 240;
/** A shot that has not come to rest after this long is stopped where it is. */
const MAX_SHOT_SECS = 14;
export const DISCS = 5;
export const BALL = 0;

// Rolling resistance: exponential damping (most of the slow-down) plus a small constant drag so a
// body actually reaches zero. The ball is lighter and rolls further.
const FRICTION = { disc: { damp: 1.35, drag: 22 }, ball: { damp: 0.95, drag: 16 } };
const STOP = 1.2;                          // a body slower than this stops
const E_DISC_DISC = 0.82;
const E_DISC_BALL = 0.9;
const E_WALL = 0.7;
const E_WALL_BALL = 0.78;

/** The walls, as segments. Their end points are the corners and the goal posts (a circle meeting an
 *  end point bounces off it like a post). The two goal LINES are disc-only: a disc cannot go into a
 *  goal (no keeper parked in the net), the ball can. */
export const SEGS = [
  [0, 0, 0, H], [W, 0, W, H],
  [0, 0, GX0, 0], [GX1, 0, W, 0],
  [0, H, GX0, H], [GX1, H, W, H],
  [GX0, 0, GX0, -GOAL_D], [GX0, -GOAL_D, GX1, -GOAL_D], [GX1, -GOAL_D, GX1, 0],
  [GX0, H, GX0, H + GOAL_D], [GX0, H + GOAL_D, GX1, H + GOAL_D], [GX1, H + GOAL_D, GX1, H],
  [GX0, 0, GX1, 0, 1], [GX0, H, GX1, H, 1],
].map(([ax, ay, bx, by, discOnly]) => ({ ax, ay, bx, by, discOnly: !!discOnly }));

/** Starting line-ups, as seat 0 stands them (bottom half). Seat 1 mirrors its own choice. Every
 *  one has a keeper, keeps each disc in its own half and clear of the centre circle, so a kick-off
 *  is never blocked. 'balanced' is the original, and what any match saved before line-ups read as. */
export const FORMATIONS = {
  balanced: [[50, 149], [27, 133], [73, 133], [33, 107], [67, 107]],
  attack:   [[50, 149], [50, 128], [20, 100], [50, 101], [80, 100]],
  defend:   [[50, 149], [22, 134], [50, 132], [78, 134], [50, 108]],
  diamond:  [[50, 149], [50, 128], [24, 115], [76, 115], [50, 102]],
};
export const FORM_IDS = Object.keys(FORMATIONS);
const formOf = (id) => (FORM_IDS.includes(id) ? FORMATIONS[id] : FORMATIONS.balanced);
/** A pair of line-up ids [seat 0, seat 1], unknown ids read as 'balanced'. */
export const cleanForms = (f) => [0, 1].map((k) => (Array.isArray(f) && FORM_IDS.includes(f[k]) ? f[k] : 'balanced'));
export const KICKOFF_BALL = [W / 2, H / 2];
export const GOAL_OPTIONS = [1, 2, 3];

/** Which seat owns body `i` (-1 for the ball). */
export const teamOf = (i) => (i === BALL ? -1 : i <= DISCS ? 0 : 1);
/** Body indices of a seat's discs. */
export const discsOf = (seat) => Array.from({ length: DISCS }, (_, k) => 1 + seat * DISCS + k);
/** The goal a seat attacks: its centre on the goal line, and which way is "forward" (-1 up, +1 down). */
export const attackGoal = (seat) => (seat === 0 ? { x: W / 2, y: 0, dir: -1 } : { x: W / 2, y: H, dir: 1 });
export const ownGoal = (seat) => attackGoal(seat ^ 1);

/** Both teams at kick-off. `forms` is [seat 0's line-up id, seat 1's]; absent means balanced. */
export function lineUp(forms) {
  const [f0, f1] = cleanForms(forms);
  const b = [{ x: KICKOFF_BALL[0], y: KICKOFF_BALL[1], vx: 0, vy: 0, r: BALL_R, m: BALL_M }];
  for (const [x, y] of formOf(f0)) b.push({ x, y, vx: 0, vy: 0, r: DISC_R, m: DISC_M });
  for (const [x, y] of formOf(f1)) b.push({ x: W - x, y: H - y, vx: 0, vy: 0, r: DISC_R, m: DISC_M });
  return b;
}

/** A new match. `goals` to win (1-3); `starter` kicks off; `forms` [seat 0, seat 1] line-ups,
 *  used again after every goal. */
export function newMatch(goals = 2, starter = 0, forms) {
  return {
    v: 1,
    goals: GOAL_OPTIONS.includes(goals) ? goals : 2,
    scores: [0, 0],
    starter: starter ? 1 : 0,
    turn: starter ? 1 : 0,
    shots: 0,
    winner: null,
    forms: cleanForms(forms),
    b: lineUp(forms),
  };
}

/** A saved match is only trusted if it has the shape this engine writes, at rest. */
export function validMatch(m) {
  if (!m || m.v !== 1 || !Array.isArray(m.b) || m.b.length !== 1 + 2 * DISCS) return false;
  if (!GOAL_OPTIONS.includes(m.goals) || !Array.isArray(m.scores) || m.scores.length !== 2) return false;
  if (m.turn !== 0 && m.turn !== 1) return false;
  return m.b.every((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y));
}

/** A copy safe to simulate on. */
export function cloneBodies(b) { return b.map((o) => ({ x: o.x, y: o.y, vx: o.vx, vy: o.vy, r: o.r, m: o.m })); }

export const atRest = (b) => b.every((o) => o.vx === 0 && o.vy === 0);

/** Put `i` in motion: the flick. `power` 0-1 of MAX_SPEED along unit (dx, dy). */
export function flick(b, i, dx, dy, power) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const p = Math.max(0, Math.min(1, power)) * MAX_SPEED;
  b[i].vx = (dx / len) * p;
  b[i].vy = (dy / len) * p;
}

/** One physics step. Returns the seat that just SCORED (the ball wholly over a goal line), or -1. */
export function step(b) {
  const n = b.length;
  // Move.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (o.vx !== 0 || o.vy !== 0) { o.x += o.vx * DT; o.y += o.vy * DT; }
  }
  // Bodies against bodies (a pair where neither moves cannot have started to overlap).
  for (let i = 0; i < n; i++) {
    const p = b[i];
    const pm = p.vx !== 0 || p.vy !== 0;
    for (let j = i + 1; j < n; j++) {
      const q = b[j];
      if (!pm && q.vx === 0 && q.vy === 0) continue;
      const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-9) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
      const ip = 1 / p.m, iq = 1 / q.m, is = ip + iq;
      const over = rr - d;
      p.x -= nx * over * (ip / is); p.y -= ny * over * (ip / is);
      q.x += nx * over * (iq / is); q.y += ny * over * (iq / is);
      const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (vn < 0) {
        const e = i === BALL || j === BALL ? E_DISC_BALL : E_DISC_DISC;
        const jm = (-(1 + e) * vn) / is;
        p.vx -= jm * ip * nx; p.vy -= jm * ip * ny;
        q.vx += jm * iq * nx; q.vy += jm * iq * ny;
      }
    }
  }
  // Bodies against walls and posts.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (o.vx === 0 && o.vy === 0) continue;
    const ball = i === BALL;
    for (const s of SEGS) {
      if (s.discOnly && ball) continue;
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      let tt = ((o.x - s.ax) * ex + (o.y - s.ay) * ey) / (ex * ex + ey * ey);
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const cx = s.ax + ex * tt, cy = s.ay + ey * tt;
      const dx = o.x - cx, dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= o.r * o.r) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-9) {
        // Centre exactly on the line: push back the way it came.
        const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
        nx = -o.vx / sp; ny = -o.vy / sp; d = 0;
      } else { nx = dx / d; ny = dy / d; }
      o.x += nx * (o.r - d); o.y += ny * (o.r - d);
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) {
        const e = ball ? E_WALL_BALL : E_WALL;
        o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny;
      }
    }
  }
  // Rolling resistance, and the speed cap.
  for (let i = 0; i < n; i++) {
    const o = b[i];
    if (o.vx === 0 && o.vy === 0) continue;
    const f = i === BALL ? FRICTION.ball : FRICTION.disc;
    const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
    let ns = sp * (1 - f.damp * DT) - f.drag * DT;
    if (ns > SPEED_CAP) ns = SPEED_CAP;
    if (ns < STOP) { o.vx = 0; o.vy = 0; continue; }
    o.vx *= ns / sp; o.vy *= ns / sp;
  }
  const ball = b[BALL];
  if (ball.y + BALL_R < 0) return 0;
  if (ball.y - BALL_R > H) return 1;
  return -1;
}

/** Run a shot to the end on bodies `b` (mutated). Returns { scorer: seat or -1, steps }.
 *  Stops the moment a goal goes in, or when everything is at rest, or at MAX_SHOT_SECS. */
export function runToRest(b, maxSecs = MAX_SHOT_SECS) {
  const max = Math.round(maxSecs / DT);
  for (let k = 1; k <= max; k++) {
    const g = step(b);
    if (g >= 0) return { scorer: g, steps: k };
    if (atRest(b)) return { scorer: -1, steps: k };
  }
  for (const o of b) { o.vx = 0; o.vy = 0; }
  return { scorer: -1, steps: max };
}
export const maxShotSteps = () => Math.round(MAX_SHOT_SECS / DT);

/** Bring every body to a stop (the shot clock ran out). */
export function freeze(b) { for (const o of b) { o.vx = 0; o.vy = 0; } }

/** A shot has ended. `scorer` is the seat that scored, or -1. Applies the rules:
 *  a goal counts for whoever's goal it went in (an own goal counts for the other side); first to
 *  `goals` wins; after a goal both teams line up again and the side that conceded kicks off;
 *  otherwise the turn passes. Returns 'goal' | 'win' | 'turn'. */
export function settle(m, scorer) {
  m.shots++;
  if (scorer === 0 || scorer === 1) {
    m.scores[scorer]++;
    if (m.scores[scorer] >= m.goals) { m.winner = scorer; freeze(m.b); return 'win'; }
    m.b = lineUp(m.forms);
    m.turn = scorer ^ 1;
    return 'goal';
  }
  freeze(m.b);
  m.turn ^= 1;
  return 'turn';
}

/** Which of `seat`'s discs is nearest (x, y) within `reach`, or -1. */
export function discAt(b, seat, x, y, reach) {
  let best = -1, bd = reach * reach;
  for (const i of discsOf(seat)) {
    const d2 = (b[i].x - x) ** 2 + (b[i].y - y) ** 2;
    if (d2 <= bd) { bd = d2; best = i; }
  }
  return best;
}

/** The aim guide: disc `i` sent along unit (dx, dy). Where it first touches something, as
 *  { x, y, hit } with the body index hit (or -1 for a wall), or null if it touches nothing within
 *  `range`. The disc is swept as a circle, so the point is where its CENTRE will be. */
export function aimContact(b, i, dx, dy, range = 70) {
  const o = b[i];
  let best = range, hit = -2;
  for (let j = 0; j < b.length; j++) {
    if (j === i) continue;
    const q = b[j], rr = o.r + q.r;
    const fx = q.x - o.x, fy = q.y - o.y;
    const along = fx * dx + fy * dy;
    if (along <= 0) continue;
    const perp2 = fx * fx + fy * fy - along * along;
    if (perp2 >= rr * rr) continue;
    const t = along - Math.sqrt(rr * rr - perp2);
    if (t >= 0 && t < best) { best = t; hit = j; }
  }
  // Walls: march the swept circle along the ray (cheap, and exact enough for a guide).
  for (let t = 0.5; t < best; t += 0.5) {
    const x = o.x + dx * t, y = o.y + dy * t;
    let touch = false;
    for (const s of SEGS) {
      const ex = s.bx - s.ax, ey = s.by - s.ay;
      let u = ((x - s.ax) * ex + (y - s.ay) * ey) / (ex * ex + ey * ey);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      if ((x - s.ax - ex * u) ** 2 + (y - s.ay - ey * u) ** 2 < o.r * o.r) { touch = true; break; }
    }
    if (touch) { best = t; hit = -1; break; }
  }
  if (hit === -2) return null;
  return { x: o.x + dx * best, y: o.y + dy * best, hit };
}

/**
 * Easy's "bounce line" (2026-10-11): where the ball heads after the disc at `contact` strikes it,
 * traced straight and reflected off the side and end walls, up to `bounces` times, for `len`
 * pitch units. It stops at the first disc in the way (`stop: 'disc'`) or in a goal mouth
 * (`stop: 'goal'`). A guide for the eye, not a prediction: it ignores spin, friction and the
 * shooter following through. Display only, never on the physics path.
 */
export function ballPath(b, shooter, contact, len = 80, bounces = 2) {
  const q = b[BALL];
  let dx = q.x - contact.x, dy = q.y - contact.y;
  const dl = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dl; dy /= dl;
  let x = q.x, y = q.y, left = len;
  const pts = [{ x, y }];
  const x0 = BALL_R, x1 = W - BALL_R, y0 = BALL_R, y1 = H - BALL_R;
  for (let n = 0; n <= bounces && left > 0; n++) {
    // The first disc this leg would touch.
    let tDisc = Infinity;
    for (let j = 1; j < b.length; j++) {
      if (j === shooter) continue;
      const o = b[j], rr = o.r + BALL_R;
      const fx = o.x - x, fy = o.y - y;
      const along = fx * dx + fy * dy;
      if (along <= 0) continue;
      const perp2 = fx * fx + fy * fy - along * along;
      if (perp2 >= rr * rr) continue;
      const t = along - Math.sqrt(rr * rr - perp2);
      if (t >= 0 && t < tDisc) tDisc = t;
    }
    // The first wall.
    const tx = dx > 0 ? (x1 - x) / dx : dx < 0 ? (x0 - x) / dx : Infinity;
    const ty = dy > 0 ? (y1 - y) / dy : dy < 0 ? (y0 - y) / dy : Infinity;
    const tWall = Math.min(tx, ty);
    const t = Math.min(tDisc, tWall, left);
    x += dx * t; y += dy * t;
    pts.push({ x, y });
    if (t === left && t < tDisc && t < tWall) return { pts, stop: 'end' };
    left -= t;
    if (tDisc <= tWall) return { pts, stop: 'disc' };
    if (ty <= tx) {
      if (x > GX0 && x < GX1) { pts[pts.length - 1] = { x, y: dy < 0 ? 0 : H }; return { pts, stop: 'goal' }; }
      dy = -dy;
    } else dx = -dx;
  }
  return { pts, stop: 'end' };
}
