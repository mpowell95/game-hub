// pinball/js/physics.js - the deterministic 2D solver. Pure: no DOM, no timers, no randomness
// that isn't handed in. `node pinball/js/test.js` drives it headless.
//
// WHAT THIS FILE IS. A pinball table is a handful of static shapes, two to four rotating paddles,
// and one to four small heavy circles. Everything below is that and nothing else: shapes ->
// contacts, contacts -> impulses. It knows nothing about scoring, lamps or missions. table.js says
// where the shapes are, game.js says what a contact MEANS, and this file is the only place a
// velocity ever changes for a physical reason.
//
// THE TABLE IS MEASURED IN REAL UNITS (2026-08-14). Everything here is derived from one number:
// a pinball is 1 1/16 in (26.99 mm) across, and it is BALL_R * 2 = 21 table units across, so
//
//     1 table unit = 1.285 mm = 0.0506 in
//
// which makes the 400 x 820 playfield 20.2 x 41.5 in - a real WPC playfield is 20.25 x 42. Every
// speed, radius and clearance below is quoted in both, and the flipper geometry in table.js is
// taken straight off a Williams parts list. Keeping the scale honest is what lets a question like
// "is that gap right" be ANSWERED rather than eyeballed.
//
// A PLAYFIELD IS NOT A WALL, AND THAT IS THIS FILE'S BIGGEST SINGLE FACT. A real table is pitched
// about 6.5 degrees; the ball is rolling, not sliding, so the acceleration down the playfield is
// (5/7) * g * sin(6.5) = 0.79 m/s^2 - EIGHT PER CENT of what a vertical drop would give. game.js
// computes `gravity` from the pitch in degrees for exactly this reason. Get it wrong and the ball
// falls in tight vertical arcs instead of the long, flat, nearly-straight lines a pinball actually
// travels in, and the table reads as a wall seen from the side. (It was 1150 u/s^2 - an effective
// pitch of about 14 degrees - until Matt said so.)
//
// WHY FIXED-STEP SUBSTEPPING (and why the speed cap is not cosmetic). A ball leaves a flipper tip
// at up to MAX_SPEED. At a 60 Hz frame that is 57 units of travel in one integration - nearly three
// ball diameters - so a naive per-frame step would put the ball on the far side of a wall before
// any test ran. So: a FIXED PHYS_DT of 1/480 s, run as many times as the frame needs, with the
// speed hard-capped. 3400 / 480 = 7.1 units of travel per step against a combined ball+wall radius
// of at least 13.5, so every wall is sampled at least twice while the ball crosses it. The cap is a
// CORRECTNESS bound, not a difficulty knob: raising it without shortening PHYS_DT re-opens
// tunnelling. `test.js`'s soak asserts no ball ever leaves the table.
//
// WHY SURFACES CARRY VELOCITY. A flipper does not bounce the ball, it THROWS it: the impulse comes
// almost entirely from the paddle's own surface speed at the contact point (omega x r), not from
// restitution. That is why `resolve()` works in the surface's frame of reference and adds the
// surface velocity back afterwards, and it is why a flipper feels alive while a wall feels dead
// even though both use the same three lines of maths.

export const PHYS_DT = 1 / 480;      // one physics step, seconds (see header)
export const MAX_SPEED = 3400;       // 4.37 m/s; a correctness bound, see header
export const BALL_R = 10.5;          // 21 units across = 1 1/16 in, the real ball

/** Rolling resistance, as a real deceleration rather than a percentage. A steel ball on a lacquered
 *  playfield has a rolling-resistance coefficient around 0.006, so it sheds mu_r * g = 59 mm/s^2 =
 *  46 u/s^2 whatever its speed - about 7% of the 6.5-degree pitch that is driving it, which is why
 *  a real ball coasts so far. AIR_K is a small extra proportional term standing in for every other
 *  loss (guide rubber, the glass, the ball not being perfectly round); without something
 *  speed-dependent a ball trapped in a bumper nest never settles. */
export const ROLL_A = 46;            // u/s^2, constant, opposes motion
export const AIR_K = 0.055;          // 1/s, proportional

/** A ball. Plain data so game.js can serialise/inspect it and test.js can build one by hand. */
export function makeBall(x, y, vx = 0, vy = 0) {
  return { x, y, vx, vy, r: BALL_R, live: true, held: false, spin: 0, restTime: 0 };
}

// --- shape constructors ------------------------------------------------------------------------
// Every collider is a plain object with a `t` tag. `e` is restitution, `r` the surface's own
// thickness radius (so a wall is a capsule, never a zero-width line - a zero-width line is the
// classic 2D-physics tunnelling trap and there is no reason to accept it here).
//
// `mu` is a COULOMB friction coefficient, not a per-frame decay: see resolve().
//
// `kick` is the pinball-specific one: instead of bouncing, the surface guarantees a MINIMUM
// outgoing speed along its normal. That is what a pop bumper and a slingshot physically do (they
// fire a solenoid), and modelling them as very-high-restitution walls instead gives the tell-tale
// wrong behaviour where a slowly-rolling ball barely reacts.

/** Default coil re-arm, seconds. A real solenoid fires a fixed pulse and cannot fire again until
 *  its switch has re-opened and the driver board has re-armed; nothing on a pinball table machine
 *  -guns. Without it a slingshot facing a wall a ball-and-a-half away is a PERFECT RESONATOR: it
 *  throws the ball across the gap at full power, the wall returns it, and it fires again 30 ms
 *  later, forever. Six soak games produced 15,633 slingshot hits that way. See `rearm` below. */
export const COIL_REARM = 0.09;

/** A capsule wall from a to b. `oneWay`, if set, is a unit normal: the wall only exists for a ball
 *  whose velocity points along it (used for the shooter-lane gate, which passes a launch going up
 *  and stops the same ball coming back down). */
export function seg(ax, ay, bx, by, opts = {}) {
  return {
    t: 'seg', ax, ay, bx, by,
    r: opts.r ?? 4, e: opts.e ?? 0.42, mu: opts.mu ?? 0.06,
    kick: opts.kick ?? 0, rearm: opts.rearm ?? COIL_REARM, cool: 0,
    id: opts.id || '', oneWay: opts.oneWay || null,
    on: opts.on !== false,
  };
}

/** A solid disc: posts, and (with `kick`) pop bumpers. */
export function circle(x, y, r, opts = {}) {
  return {
    t: 'circle', x, y, r,
    e: opts.e ?? 0.5, mu: opts.mu ?? 0.06, kick: opts.kick ?? 0,
    rearm: opts.rearm ?? COIL_REARM, cool: 0,
    id: opts.id || '', on: opts.on !== false,
  };
}

/** A curved wall of thickness `r`, TWO-SIDED on purpose: the arch over the table is the playfield's
 *  ceiling seen from below and the orbit lane's floor seen from above, and one collider serving
 *  both is the whole reason the orbit reads as a real lane rather than two unrelated walls. */
export function arc(cx, cy, rad, a0, a1, opts = {}) {
  return {
    t: 'arc', cx, cy, rad, a0, a1,
    r: opts.r ?? 4, e: opts.e ?? 0.42, mu: opts.mu ?? 0.06,
    kick: opts.kick ?? 0, id: opts.id || '', on: opts.on !== false,
  };
}

/**
 * A flipper: a capsule that rotates about `px,py`. `rest`/`up` are absolute angles in radians.
 *
 * `r` is the radius at the PIVOT and `rTip` the radius at the tip, because a real flipper bat is a
 * wedge: the Williams bat is 0.6 in across at the base and 0.2 in at the tapered edge, which with
 * rubber is 7 and 3 table units. Modelling the taper (instead of a constant-radius capsule) is
 * what makes a tip shot fly flatter than a base shot, which is the whole vocabulary of aiming.
 */
export function flipper(px, py, len, rest, up, opts = {}) {
  return {
    t: 'flipper', px, py, len, rest, up,
    r: opts.r ?? 7, rTip: opts.rTip ?? 3, e: opts.e ?? 0.3, mu: opts.mu ?? 0.16,
    id: opts.id || '', angle: rest, omega: 0, pressed: false,
    speed: opts.speed ?? 26.5,   // rad/s; a real flipper sweeps 50 degrees in ~33 ms
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
 *
 * FRICTION IS COULOMB, AND THAT IS A BUG FIX, NOT A REFINEMENT (2026-08-14). This used to read
 * `nvx -= tx * mu` - remove a fixed FRACTION of the tangential speed on every resolved contact.
 * But a resting contact is re-resolved on every physics step, 480 times a second, so at mu = 0.05
 * a ball rolling along a surface lost 5% of its speed every 2 ms: a 42 ms time constant. Matt, on
 * the shipped build: "when the ball is rolling on the bottom level, it drastically slows down when
 * it hits the paddle." It was not the paddle. It was every surface in the table, and the paddle is
 * simply where a rolling ball spends longest.
 *
 * The fix is the textbook model: the tangential impulse is bounded by mu * (the NORMAL impulse).
 * A ball resting on a flipper only pushes into it by one step's worth of gravity, so its normal
 * impulse - and therefore its friction - is tiny; a ball slammed into a flipper has a large normal
 * impulse and gets a correspondingly large tangential bite. Same coefficient, right physics, and
 * the constant per-second loss a rolling ball SHOULD have now comes from ROLL_A instead, where it
 * belongs. `test.js` carries the [KNOWN-BUG PROBE].
 */
function resolve(ball, nx, ny, pen, e, mu, kick, sv) {
  ball.x += nx * pen;
  ball.y += ny * pen;

  const svx = sv ? sv.x : 0, svy = sv ? sv.y : 0;
  const rvx = ball.vx - svx, rvy = ball.vy - svy;
  const vn = rvx * nx + rvy * ny;

  let out = { speed: -vn, nx, ny };
  if (vn < 0) {
    const j = -(1 + e) * vn;                 // normal impulse per unit mass, always >= 0
    let nvx = rvx + j * nx, nvy = rvy + j * ny;
    const tx = nvx - (nvx * nx + nvy * ny) * nx;
    const ty = nvy - (nvx * nx + nvy * ny) * ny;
    const ts = Math.hypot(tx, ty);
    if (ts > 1e-6) {
      const jt = Math.min(mu * j, ts);       // Coulomb bound, and never more than a full stop
      nvx -= (tx / ts) * jt; nvy -= (ty / ts) * jt;
    }
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

/** The solenoid's live kick: zero while the coil is still cooling down. `fired` on the returned
 *  contact tells game.js whether this was a real solenoid hit or an ordinary bounce off the same
 *  rubber, so a cooling slingshot does not keep scoring while it is not kicking. */
function coilKick(c) { return c.cool > 0 ? 0 : (c.kick || 0); }

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
  const k = coilKick(s);
  const out = resolve(ball, nx, ny, reach - d, s.e, s.mu, k, null);
  if (k) { s.cool = s.rearm; out.fired = true; }
  return out;
}

function hitCircle(ball, c) {
  let nx = ball.x - c.x, ny = ball.y - c.y;
  const d = Math.hypot(nx, ny);
  const reach = ball.r + c.r;
  if (d >= reach) return null;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  const k = coilKick(c);
  const out = resolve(ball, nx, ny, reach - d, c.e, c.mu, k, null);
  if (k) { c.cool = c.rearm; out.fired = true; }
  return out;
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
  const surf = f.r + (f.rTip - f.r) * t;         // the real bat's wedge, base -> tip
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
 * @param {object} world  { colliders, flippers, gravity, roll, nudgeX, nudgeY }
 * @param {Array}  balls
 * @param {(kind, id, x, y, speed, ball, fired) => void} onContact  called once per resolved
 *        contact; game.js turns these into score and lamps. Called AFTER the impulse, so `speed`
 *        is the closing speed that produced it, and `fired` is true only when a solenoid actually
 *        pulsed (see COIL_REARM).
 */
export function step(world, balls, onContact) {
  const { flippers, colliders } = world;

  for (const c of colliders) if (c.cool > 0) c.cool -= PHYS_DT;

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

    // Rolling resistance: a constant deceleration opposing motion, plus a small proportional term.
    // See ROLL_A. The constant part is clamped so it can never reverse the ball at low speed.
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 1e-6) {
      const dec = Math.min(sp, (world.roll ?? ROLL_A) * PHYS_DT) + sp * AIR_K * PHYS_DT;
      const k = Math.max(0, 1 - dec / sp);
      ball.vx *= k; ball.vy *= k;
    }

    ball.x += ball.vx * PHYS_DT;
    ball.y += ball.vy * PHYS_DT;

    for (const c of colliders) {
      if (!c.on) continue;
      const hit = c.t === 'seg' ? hitSeg(ball, c)
        : c.t === 'circle' ? hitCircle(ball, c)
          : c.t === 'arc' ? hitArc(ball, c) : null;
      if (hit && onContact) onContact(c.id ? 'id' : 'wall', c.id, ball.x, ball.y, hit.speed, ball, !!hit.fired);
    }
    for (const f of flippers) {
      const hit = hitFlipper(ball, f);
      if (hit && onContact) onContact('flipper', f.id, ball.x, ball.y, hit.speed, ball, false);
    }

    const s2 = Math.hypot(ball.vx, ball.vy);
    if (s2 > MAX_SPEED) { ball.vx = ball.vx / s2 * MAX_SPEED; ball.vy = ball.vy / s2 * MAX_SPEED; }
    ball.spin += ball.vx * PHYS_DT * 0.12;
  }

  ballPairs(balls, (x, y, sp) => { if (onContact) onContact('ball', 'ball', x, y, sp, null); });
}

export default { PHYS_DT, MAX_SPEED, BALL_R, ROLL_A, COIL_REARM, makeBall, seg, circle, arc, flipper, step };
