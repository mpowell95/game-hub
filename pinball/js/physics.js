// pinball/js/physics.js - the deterministic 2D solver. Pure: no DOM, no timers, no randomness
// that isn't handed in. `node pinball/js/test.js` drives it headless.
//
// WHAT THIS FILE IS. A pinball table is a handful of static shapes, two rotating paddles, and one
// to four small heavy circles. Everything below is that and nothing else: shapes -> contacts,
// contacts -> impulses. It knows nothing about scoring, lamps, missions or sound. table.js says
// where the shapes are, game.js says what a contact MEANS, and this file is the only place a
// velocity ever changes for a physical reason.
//
// WHY FIXED-STEP SUBSTEPPING (and why the speed cap is not cosmetic). A pinball leaves a flipper
// tip at around 2000 table-units/second. At a 60 Hz frame that is 33 units of travel in one
// integration - nearly four ball diameters - so a naive per-frame step would put the ball on the
// far side of a wall before any test ran, and the ball would leave the table. So: a FIXED
// PHYS_DT of 1/480 s, run as many times as the frame needs, with the speed hard-capped at
// MAX_SPEED. 1820 / 480 = 3.8 units of travel per step against a combined ball+wall radius of at
// least 13, which means every wall in the table is sampled at least twice while the ball crosses
// it. The cap is therefore a CORRECTNESS bound, not a difficulty knob: raising it without
// shortening PHYS_DT re-opens tunnelling. `test.js`'s soak asserts no ball ever leaves the table.
//
// WHY SURFACES CARRY VELOCITY. A flipper does not bounce the ball, it THROWS it: the impulse comes
// almost entirely from the paddle's own surface speed at the contact point (omega x r), not from
// restitution. That is why `resolve()` works in the surface's frame of reference and adds the
// surface velocity back afterwards, and it is why a flipper feels alive while a wall feels dead
// even though both use the same three lines of maths.

export const PHYS_DT = 1 / 480;      // one physics step, seconds (see header)
export const MAX_SPEED = 1820;       // table-units/s; a correctness bound, see header
export const BALL_R = 9;

/** A ball. Plain data so game.js can serialise/inspect it and test.js can build one by hand. */
export function makeBall(x, y, vx = 0, vy = 0) {
  return { x, y, vx, vy, r: BALL_R, live: true, held: false, spin: 0, restTime: 0 };
}

// --- shape constructors ------------------------------------------------------------------------
// Every collider is a plain object with a `t` tag. `e` is restitution, `r` the surface's own
// thickness radius (so a wall is a capsule, never a zero-width line - a zero-width line is the
// classic 2D-physics tunnelling trap and there is no reason to accept it here).
//
// `kick` is the pinball-specific one: instead of bouncing, the surface guarantees a MINIMUM
// outgoing speed along its normal. That is what a pop bumper and a slingshot physically do (they
// fire a solenoid), and modelling them as very-high-restitution walls instead gives the tell-tale
// wrong behaviour where a slowly-rolling ball barely reacts.

/** A capsule wall from a to b. `oneWay`, if set, is a unit normal: the wall only exists for a ball
 *  whose velocity points along it (used for the shooter-lane gate, which passes a launch going up
 *  and stops the same ball coming back down). */
export function seg(ax, ay, bx, by, opts = {}) {
  return {
    t: 'seg', ax, ay, bx, by,
    r: opts.r ?? 4, e: opts.e ?? 0.42, mu: opts.mu ?? 0,
    kick: opts.kick ?? 0, id: opts.id || '', oneWay: opts.oneWay || null,
    on: opts.on !== false,
  };
}

/** A solid disc: posts, and (with `kick`) pop bumpers. */
export function circle(x, y, r, opts = {}) {
  return {
    t: 'circle', x, y, r,
    e: opts.e ?? 0.5, mu: opts.mu ?? 0, kick: opts.kick ?? 0,
    id: opts.id || '', on: opts.on !== false,
  };
}

/** A curved wall of thickness `r`, TWO-SIDED on purpose: the arch over the table is the playfield's
 *  ceiling seen from below and the orbit lane's floor seen from above, and one collider serving
 *  both is the whole reason the orbit reads as a real lane rather than two unrelated walls. */
export function arc(cx, cy, rad, a0, a1, opts = {}) {
  return {
    t: 'arc', cx, cy, rad, a0, a1,
    r: opts.r ?? 4, e: opts.e ?? 0.42, mu: opts.mu ?? 0,
    kick: opts.kick ?? 0, id: opts.id || '', on: opts.on !== false,
  };
}

/** A flipper: a capsule that rotates about `px,py`. `rest`/`up` are absolute angles in radians;
 *  `dir` is only used by the renderer to know which way the paddle faces.
 *
 *  `e` IS 0.65 ON PURPOSE AND MUST STAY ABOVE THE WALLS. It was 0.3 until 2026-08-20, which made the
 *  paddle the DEADEST surface on the whole table - below a wall (0.42), the arch (0.40) and a post
 *  (0.50). A ball fed down the inlane arrived at 668 units/s and was down to 80 within two touches:
 *  it lost more energy hitting the flipper than it would have hitting the woodwork, and a playtest
 *  recording shows the result, a ball that dribbles and dies every time it lands on a paddle. Real
 *  flipper rubber returns 0.6-0.8. Lowering this again to 'calm the table down' re-breaks the one
 *  surface the player actually controls; if the table needs calming, calm the kickers instead.
 *
 *  `speed` and every other velocity here are on the 2026-08-20 incline rescale - see game.js's
 *  GRAVITY. They are sqrt(790/1150) of their old values, which leaves trajectories identical. */
export function flipper(px, py, len, rest, up, opts = {}) {
  return {
    t: 'flipper', px, py, len, rest, up,
    r: opts.r ?? 8, e: opts.e ?? 0.65, mu: opts.mu ?? 0,
    id: opts.id || '', angle: rest, omega: 0, pressed: false,
    speed: opts.speed ?? 22.4,   // rad/s; a real flipper sweeps ~50 degrees in ~40 ms
  };
}

// --- small maths -------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Normalise to [0, TAU). */
function norm(a) { a %= TAU; return a < 0 ? a + TAU : a; }

/** Is angle `a` inside the arc [a0, a1] (both already normalised, a1 may wrap past TAU)? */
function inArc(a, a0, a1) {
  const span = a1 - a0;
  let d = norm(a - a0);
  return d <= span;
}

/** Closest point on segment ab to p, as a parametric t in [0,1]. */
function closestT(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  return clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
}

// --- the one contact resolver ------------------------------------------------------------------

/**
 * Resolve one contact. `nx,ny` is a UNIT normal pointing from the surface toward the ball,
 * `pen` the overlap depth, `sv` the surface's own velocity at the contact point.
 *
 * The order matters and is the part worth reading: separate first, then work entirely in the
 * SURFACE's frame (subtract sv), reflect, apply tangential friction, then add sv back. Doing it
 * in the world frame instead is the bug that makes a moving flipper feel like a wall - the paddle's
 * speed gets thrown away by the reflection instead of being handed to the ball.
 */
function resolve(ball, nx, ny, pen, e, mu, kick, sv) {
  ball.x += nx * pen;
  ball.y += ny * pen;

  const svx = sv ? sv.x : 0, svy = sv ? sv.y : 0;
  const rvx = ball.vx - svx, rvy = ball.vy - svy;
  const vn = rvx * nx + rvy * ny;

  let out = { speed: -vn, nx, ny };
  if (vn < 0) {
    const j = -(1 + e) * vn;
    let nvx = rvx + j * nx, nvy = rvy + j * ny;
    // Tangential friction, and WHY EVERY SURFACE ON THIS TABLE NOW DEFAULTS TO mu = 0.
    //
    // This is charged ONCE PER CONTACT RESOLUTION, not once per impact, and those are not the same
    // thing. A ball that bounces off a wall pays it once and does not care. A ball RIDING a surface
    // - the orbit lane's floor, an inlane divider, a resting paddle - is in contact on every one of
    // the 480 physics steps in a second, so it paid mu 480 times a second. At the old 0.02 that is
    // (1 - 0.02)^480 = 6e-5 of its tangential speed per second of contact, against which gravity can
    // only hold a terminal creep of g*dt/mu = 82 units/s. A healthy ball moves at ~800. The orbit is
    // this table's headline shot and it is one long sustained contact with archIn, so the shot the
    // right flipper exists to make was the shot that reliably turned the ball into a crawl: a
    // 60-ball soak charged 344 s of sub-90 u/s crawling to archIn alone, and 40 s more to the two
    // inlane dividers. Zeroing mu takes the same soak from 36.9% of ball life spent crawling to
    // 20.0%, and cuts the dividers by 10-30x.
    //
    // Nothing is lost by removing it, because it was double-counting: the `drag` term in step() is
    // already the playfield's rolling resistance and its own comment says so. Coulomb friction
    // (tangential impulse bounded by mu * NORMAL impulse) would be the principled way to keep a
    // little without the sustained-contact blowup - it is deliberately not done here, because
    // nothing on this table needs it and an unused mechanism that behaves this badly when it does
    // engage is worse than no mechanism. mu is kept as a per-collider option, defaulting to 0, so a
    // future surface that genuinely wants grip can ask for it and own the consequences.
    const tx = nvx - (nvx * nx + nvy * ny) * nx;
    const ty = nvy - (nvx * nx + nvy * ny) * ny;
    nvx -= tx * mu; nvy -= ty * mu;
    ball.vx = nvx + svx; ball.vy = nvy + svy;
  }

  if (kick) {
    // A solenoid guarantees an outgoing speed, it does not add to whatever was there. Taking the
    // max rather than adding is what stops a fast ball ping-ponging out of a bumper nest at
    // absurd speed while still giving a dead-slow ball the full kick.
    const vn2 = ball.vx * nx + ball.vy * ny;
    if (vn2 < kick) {
      ball.vx += (kick - vn2) * nx;
      ball.vy += (kick - vn2) * ny;
    }
    out.speed = Math.max(out.speed, kick);
  }
  return out;
}

// --- per-shape contact tests -------------------------------------------------------------------

function hitSeg(ball, s) {
  const t = closestT(ball.x, ball.y, s.ax, s.ay, s.bx, s.by);
  const qx = s.ax + (s.bx - s.ax) * t, qy = s.ay + (s.by - s.ay) * t;
  let nx = ball.x - qx, ny = ball.y - qy;
  const d = Math.hypot(nx, ny);
  const reach = ball.r + s.r;
  if (d >= reach) return null;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  if (s.oneWay) {
    // The gate only exists for a ball travelling the forbidden way. A ball already moving in the
    // allowed direction passes through it as if it were not there, which is exactly what the
    // sprung metal flap on a real shooter lane does.
    const along = ball.vx * s.oneWay[0] + ball.vy * s.oneWay[1];
    if (along <= 0) return null;
  }
  return resolve(ball, nx, ny, reach - d, s.e, s.mu, s.kick, null);
}

function hitCircle(ball, c) {
  let nx = ball.x - c.x, ny = ball.y - c.y;
  const d = Math.hypot(nx, ny);
  const reach = ball.r + c.r;
  if (d >= reach) return null;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  return resolve(ball, nx, ny, reach - d, c.e, c.mu, c.kick, null);
}

function hitArc(ball, a) {
  const vx = ball.x - a.cx, vy = ball.y - a.cy;
  const d = Math.hypot(vx, vy);
  if (d < 1e-6) return null;
  const delta = d - a.rad;                       // signed: outside the arc is positive
  const reach = ball.r + a.r;
  if (Math.abs(delta) >= reach) return null;
  if (!inArc(norm(Math.atan2(vy, vx)), a.a0, a.a1)) return null;
  const sign = delta >= 0 ? 1 : -1;              // push out the side the ball is already on
  const nx = (vx / d) * sign, ny = (vy / d) * sign;
  return resolve(ball, nx, ny, reach - Math.abs(delta), a.e, a.mu, a.kick, null);
}

function hitFlipper(ball, f) {
  const ex = f.px + Math.cos(f.angle) * f.len;
  const ey = f.py + Math.sin(f.angle) * f.len;
  const t = closestT(ball.x, ball.y, f.px, f.py, ex, ey);
  const qx = f.px + (ex - f.px) * t, qy = f.py + (ey - f.py) * t;
  let nx = ball.x - qx, ny = ball.y - qy;
  const d = Math.hypot(nx, ny);
  // A real flipper is a wedge: fat at the pivot, tapered at the tip. Modelling that (instead of a
  // constant-radius capsule) is what makes a tip shot fly flatter than a base shot, which is the
  // whole vocabulary of aiming in this game.
  const surf = f.r * (1 - 0.35 * t);
  const reach = ball.r + surf;
  if (d >= reach) return null;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  // Surface velocity at the contact point: omega x r, in 2D that is omega * perpendicular(r).
  const rx = qx - f.px, ry = qy - f.py;
  const sv = { x: -f.omega * ry, y: f.omega * rx };
  return resolve(ball, nx, ny, reach - d, f.e, f.mu, 0, sv);
}

// --- ball vs ball (multiball) --------------------------------------------------------------------

/** Equal-mass elastic exchange along the contact normal. Only ever runs with 2 to 4 balls on the
 *  table, so the naive O(n^2) pass is not worth indexing. */
function ballPairs(balls, onHit) {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.live || a.held) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b.live || b.held) continue;
      let nx = b.x - a.x, ny = b.y - a.y;
      const d = Math.hypot(nx, ny);
      const reach = a.r + b.r;
      if (d >= reach || d < 1e-6) continue;
      nx /= d; ny /= d;
      const pen = (reach - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen;
      b.x += nx * pen; b.y += ny * pen;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel >= 0) continue;
      const j2 = -(1 + 0.55) * rel / 2;
      a.vx -= j2 * nx; a.vy -= j2 * ny;
      b.vx += j2 * nx; b.vy += j2 * ny;
      if (onHit) onHit((a.x + b.x) / 2, (a.y + b.y) / 2, -rel);
    }
  }
}

// --- the step ------------------------------------------------------------------------------------

/**
 * Advance the world by exactly one PHYS_DT.
 *
 * @param {object} world  { colliders, flippers, gravity, drag, nudgeX, nudgeY }
 * @param {Array}  balls
 * @param {(kind, id, x, y, speed) => void} onContact  called once per resolved contact; game.js
 *        turns these into score, lamps and sound. Called AFTER the impulse, so `speed` is the
 *        closing speed that produced it.
 */
export function step(world, balls, onContact) {
  const { flippers, colliders } = world;

  for (const f of flippers) {
    const target = f.pressed ? f.up : f.rest;
    const maxStep = f.speed * PHYS_DT;
    const diff = target - f.angle;
    const move = clamp(diff, -maxStep, maxStep);
    f.angle += move;
    // omega is derived from the step actually taken, so a paddle already at its stop reports zero
    // and stops throwing the ball - a held flipper must be a wall, not a permanent catapult.
    f.omega = move / PHYS_DT;
  }

  for (const ball of balls) {
    if (!ball.live || ball.held) continue;

    ball.vy += world.gravity * PHYS_DT;
    if (world.nudgeX) ball.vx += world.nudgeX * PHYS_DT;
    if (world.nudgeY) ball.vy += world.nudgeY * PHYS_DT;

    // A very light quadratic-ish drag. Real playfield friction is mostly rolling resistance, and
    // without something here a ball trapped in a bumper nest never loses energy and never settles.
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0) {
      const d = 1 - Math.min(0.9, (world.drag ?? 0.133) * PHYS_DT * (0.5 + sp / 746));
      ball.vx *= d; ball.vy *= d;
    }

    ball.x += ball.vx * PHYS_DT;
    ball.y += ball.vy * PHYS_DT;

    for (const c of colliders) {
      if (!c.on) continue;
      const hit = c.t === 'seg' ? hitSeg(ball, c)
        : c.t === 'circle' ? hitCircle(ball, c)
          : c.t === 'arc' ? hitArc(ball, c) : null;
      if (hit && onContact) onContact(c.id ? 'id' : 'wall', c.id, ball.x, ball.y, hit.speed, ball);
    }
    for (const f of flippers) {
      const hit = hitFlipper(ball, f);
      if (hit && onContact) onContact('flipper', f.id, ball.x, ball.y, hit.speed, ball);
    }

    const s2 = Math.hypot(ball.vx, ball.vy);
    if (s2 > MAX_SPEED) { ball.vx = ball.vx / s2 * MAX_SPEED; ball.vy = ball.vy / s2 * MAX_SPEED; }
    ball.spin += ball.vx * PHYS_DT * 0.12;
  }

  ballPairs(balls, (x, y, sp) => { if (onContact) onContact('ball', 'ball', x, y, sp, null); });
}

export default { PHYS_DT, MAX_SPEED, BALL_R, makeBall, seg, circle, arc, flipper, step };
