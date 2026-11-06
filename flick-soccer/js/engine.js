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
const wallsFor = (d) => [
  [0, 0, 0, H], [W, 0, W, H],
  [0, 0, GX0, 0], [GX1, 0, W, 0],
  [0, H, GX0, H], [GX1, H, W, H],
  [GX0, 0, GX0, -d], [GX0, -d, GX1, -d], [GX1, -d, GX1, 0],
  [GX0, H, GX0, H + d], [GX0, H + d, GX1, H + d], [GX1, H + d, GX1, H],
  [GX0, 0, GX1, 0, 1], [GX0, H, GX1, H, 1],
].map(([ax, ay, bx, by, discOnly]) => ({ ax, ay, bx, by, discOnly: !!discOnly }));
export const SEGS = wallsFor(GOAL_D);
/** Admin Test mode's walls (2026-11-06): no disc-only goal lines, so a disc can go into a net. The nets
 *  are the SAME size as always (Matt: "I didn't want anything to change size"; they were 18 deep for a day). */
export let OPEN_GOAL_D = GOAL_D;
export let OPEN_SEGS = wallsFor(OPEN_GOAL_D).filter((s) => !s.discOnly);
export function __setOpenDepth(d) { OPEN_GOAL_D = d; OPEN_SEGS = wallsFor(d).filter((s) => !s.discOnly); }   // tests only

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
/** A seat's two line-ups (2026-10-14, Matt: "two different types of lineups that you have to
 *  assign in the start menu. Offense and defense ... that will be your lineup every time"):
 *  [when this seat kicks off, when the other seat does]. A role not known reads null. */
const cleanPair = (p) => [0, 1].map((k) => (Array.isArray(p) && FORM_IDS.includes(p[k]) ? p[k] : null));
/** Both seats' pairs [[off0, def0], [off1, def1]], or null for a match without them (every match
 *  before 2026-10-14, which keeps one line-up per seat for the whole match, `forms`). */
export const cleanPairs = (p) => (Array.isArray(p) && p.some((x) => Array.isArray(x)) ? [cleanPair(p[0]), cleanPair(p[1])] : null);
/** The line-ups for a kick-off by seat `kicker`: each seat its kick-off line-up when it is the one
 *  kicking off, its defending one when not. A role with none falls back to that seat's `forms`. */
export function kickoffForms(pairs, forms, kicker) {
  const f = cleanForms(forms);
  if (!pairs) return f;
  return [0, 1].map((s) => (pairs[s] && pairs[s][s === kicker ? 0 : 1]) || f[s]);
}
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

/** A new match. `goals` to win (1-3); `starter` kicks off; `forms` [seat 0, seat 1] line-ups.
 *  With `pairs` (2026-10-14) each seat stands its kick-off line-up when it kicks off and its
 *  defending one otherwise, at the start and after every goal, and `forms` is what is standing now.
 *  Without, `forms` is used again after every goal, as every match before. */
export function newMatch(goals = 2, starter = 0, forms, pairs) {
  const pr = cleanPairs(pairs);
  const st = starter ? 1 : 0;
  const fm = kickoffForms(pr, forms, st);
  return {
    v: 1,
    goals: GOAL_OPTIONS.includes(goals) ? goals : 2,
    scores: [0, 0],
    starter: st,
    turn: st,
    shots: 0,
    winner: null,
    forms: fm,
    ...(pr ? { pairs: pr } : {}),
    b: lineUp(fm),
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

/** One physics step. Returns the seat that just SCORED (the ball wholly over a goal line), or -1.
 *  `open` (admin Test mode only, 2026-11-06, Matt: "the pieces need to be able to go in the net"): the
 *  goal lines stop no disc, so a defender can get into the net. Absent = closed, exactly as before
 *  (online replays never pass it). */
export function step(b, open) {
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
    for (const s of (open ? OPEN_SEGS : SEGS)) {
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
export function runToRest(b, maxSecs = MAX_SHOT_SECS, open) {
  const max = Math.round(maxSecs / DT);
  for (let k = 1; k <= max; k++) {
    const g = step(b, open);
    if (g >= 0) return { scorer: g, steps: k };
    if (atRest(b)) { freeze(b); return { scorer: restScorer(b), steps: k }; }
  }
  for (const o of b) { o.vx = 0; o.vy = 0; }
  return { scorer: restScorer(b), steps: max };
}

/** A shot that STOPS with the ball more than halfway over a goal line (its centre past the line,
 *  so inside the mouth: the walls allow nowhere else) is a goal (2026-10-11). The flying rule in
 *  step() still wants the whole ball over; this only settles a ball that came to rest in the net,
 *  which read as a goal to everyone watching and was being called "no goal". */
export function restScorer(b) {
  const q = b[BALL];
  if (q.y < 0) return 0;
  if (q.y > H) return 1;
  return -1;
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
    if (m.pairs) m.forms = kickoffForms(cleanPairs(m.pairs), m.forms, scorer ^ 1);
    m.b = lineUp(m.forms);
    m.turn = scorer ^ 1;
    return 'goal';
  }
  freeze(m.b);
  if (m.test) ejectFromNets(m.b);
  m.turn ^= 1;
  return 'turn';
}

/** Admin Test mode (2026-11-06, Matt: "they can go in and back out, but if the play ends and any piece is in
 *  the other team's net, it should be automatically moved out a bit"). When a shot ends with no goal, a disc
 *  with any part over the goal line of the net it ATTACKS is put back on the pitch just in front of that line
 *  (same x, kept inside the mouth), stepped further out until it overlaps nothing. A disc in its OWN net
 *  stays (that is how a defender gets at a ball on the line). Deterministic; mutates `b`. */
export function ejectFromNets(b) {
  for (let i = 1; i < b.length; i++) {
    const o = b[i], top = teamOf(i) === 0;              // seat 0 attacks the top goal
    if (top ? o.y - o.r >= 0 : o.y + o.r <= H) continue;
    if (o.x < GX0 - o.r || o.x > GX1 + o.r) continue;   // not at the mouth (cannot happen: walls)
    const x = Math.max(o.r, Math.min(W - o.r, o.x));
    for (let k = 0; k < 400; k++) {
      const y = top ? o.r + 1.5 + k * 0.5 : H - o.r - 1.5 - k * 0.5;
      let clear = true;
      for (let j = 0; j < b.length && clear; j++) {
        if (j === i) continue;
        const q = b[j], rr = o.r + q.r + 0.1;
        if ((q.x - x) * (q.x - x) + (q.y - y) * (q.y - y) < rr * rr) clear = false;
      }
      if (clear) { o.x = x; o.y = y; break; }
    }
  }
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
export function aimContact(b, i, dx, dy, range = 70, open) {
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
    for (const s of (open ? OPEN_SEGS : SEGS)) {
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

/**
 * Easy's bounce line, the REAL one (2026-11-03, Matt: "the ball doesn't do what the aim line says
 * it will"). `ballPath` above drew a straight-line guess: the angle off a glancing hit came out up
 * to 24 degrees wrong one time in ten (the engine's contact normal is read a step after touching),
 * and a wall bounce was drawn as a mirror though the ball loses speed into the wall
 * (E_WALL_BALL), so it comes off flatter. This runs the very shot (disc `i` flicked along (dx, dy)
 * at `power`) on a copy with the engine's own step, so the line is what the ball WILL do: a point
 * at every turn it takes, ending at its `bounces + 1`th turn off a wall or post, the first disc it
 * touches other than the flicked one (`stop: 'disc'`), a goal (`'goal'`), or where it stops (`'end'`).
 * Returns null if the ball is never moved. Display only: it mutates nothing it is given.
 */
export function shotPath(b, i, dx, dy, power, bounces = 2, maxSecs = 8, open) {
  const s = cloneBodies(b);
  flick(s, i, dx, dy, power);
  const q = s[BALL];
  const max = Math.round(maxSecs / DT);
  let pts = null, turns = 0;
  for (let k = 0; k < max; k++) {
    const pvx = q.vx, pvy = q.vy;
    const g = step(s, open);
    if (!pts) {
      if (q.vx === 0 && q.vy === 0) { if (atRest(s)) return null; continue; }
      pts = [{ x: b[BALL].x, y: b[BALL].y }];
      continue;
    }
    if (g >= 0) { pts.push({ x: q.x, y: q.y }); return { pts, stop: 'goal' }; }
    if (q.vx === 0 && q.vy === 0) {
      pts.push({ x: q.x, y: q.y });
      return { pts, stop: q.y < 0 || q.y > H ? 'goal' : 'end' };
    }
    // Friction never turns the ball, so any change of heading is a touch.
    const cr = pvx * q.vy - pvy * q.vx, dt = pvx * q.vx + pvy * q.vy;
    if (dt > 0 && cr * cr < 1e-5 * dt * dt) continue;
    pts.push({ x: q.x, y: q.y });
    const near = (o) => { const rr = o.r + q.r + 0.05; return (o.x - q.x) * (o.x - q.x) + (o.y - q.y) * (o.y - q.y) <= rr * rr; };
    // The flicked disc following through and catching the ball again is part of the kick: drawn,
    // never an end (it stopped the line a finger's width out, then the ball shot off sideways).
    if (near(s[i])) continue;
    for (let j = 1; j < s.length; j++) if (j !== i && near(s[j])) return { pts, stop: 'disc' };
    if (++turns > bounces) return { pts, stop: 'end' };
  }
  pts.push({ x: q.x, y: q.y });
  return { pts, stop: 'end' };
}
