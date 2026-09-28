// pinball/js/physics.js - the deterministic 2D solver. Pure: no DOM, no timers, no randomness that
// isn't derived from the ball's own state. `node pinball/js/test.js` drives it headless.
//
// REWRITTEN 2026-09-06, completely, alongside the new playfield. Matt: "completely rewrite the
// physics doc to make the game playable." The old solver was correct-ish and unpleasant, and the
// four things below are why. Each one is a behaviour a player feels, not a tidy-up.
//
// 1. THE STEP IS ADAPTIVE, SO TUNNELLING IS IMPOSSIBLE BY CONSTRUCTION.
//    The old file ran a fixed 1/480 s step and then hard-capped the ball at MAX_SPEED, because
//    speed x step had to stay under the thinnest wall. That made the cap a CORRECTNESS bound: the
//    table could not have a fast ball, and its own header said raising the cap "re-opens
//    tunnelling, and the ball leaves the table". A pinball that cannot be hit hard is not a
//    pinball. So the step is subdivided instead: no ball and no flipper tip ever advances more
//    than MAX_TRAVEL (0.3 ball radii) in one micro-step, however fast it is going. MAX_SPEED is
//    still here, but it is now a GAMEPLAY bound (nothing on a real machine leaves the flipper at
//    more than about 6 m/s) and moving it can no longer lose the ball.
//
// 2. CONTACTS ARE RESOLVED TOGETHER, AND A PINCHED BALL LETS ITSELF OUT.
//    The old solver walked the collider list and resolved each contact in isolation, so two
//    surfaces a little under one ball apart formed a PERMANENT parking space: each resolve pushed
//    the ball into the other surface, the pair was a stable equilibrium, and nothing shook it
//    loose. The old table.js header lists four of these as shipped bugs and the old game.js
//    carries two watchdogs whose whole job is to paper over them. Here, every contact in a
//    micro-step is collected first; if a ball is in two or more contacts whose normals oppose each
//    other while it is barely moving, it is in a WEDGE, and `escapeWedge()` gives it a small
//    outward impulse along the normals' resultant. A real ball rolls out of a pinch because it is
//    a sphere on a tilted plane; this is the 2D stand-in for that. The watchdogs in game.js stay,
//    because a safety net you never need is the correct amount of safety net - but the table is no
//    longer built on top of them.
//
// 3. A FLIPPER HAS ANGULAR MOMENTUM, AND ITS RUBBER SOFTENS WITH SPEED.
//    The old paddle snapped to a constant angular velocity for one step and reported `omega` from
//    the step it happened to take, which made a flip an instantaneous event: the ball either met
//    the paddle during that one step and was launched, or met it a step later and was not. Here
//    the paddle ACCELERATES to `speed` and stops dead against its stop, so a flip has a real
//    ~30 ms profile, a late flip is a soft shot rather than no shot, and holding the flipper up is
//    a wall (omega = 0). Restitution falls with impact speed the way real flipper rubber does, so
//    a hard shot is thrown by the paddle's own motion rather than trampolined by its bounce.
//
// 4. THE BALL ROLLS AND CAN BE CRADLED.
//    `spin` is a real degree of freedom (solid sphere, I = 2/5 m r^2) driven by Coulomb friction
//    bounded by the normal impulse, so friction spends itself spinning the ball up and then stops
//    braking it. And a slow ball resting on a stationary flipper is DAMPED, which is what makes a
//    cradle possible; without it the ball trickles off the paddle every time and the player never
//    gets to aim.
//
// WHAT IT STILL KNOWS NOTHING ABOUT: scoring, lamps, missions, sound. table.js says where the
// shapes are, game.js says what a contact MEANS, and this file is the only place a velocity ever
// changes for a physical reason.

export const PHYS_DT = 1 / 240;      // one solver tick; subdivided internally, see MAX_TRAVEL
export const MAX_SPEED = 1900;       // table-units/s; a GAMEPLAY bound now, not a correctness one
export const BALL_R = 9;             // ball is 18 units across

/** No ball centre and no flipper tip may move further than this in one micro-step. It is what
 *  makes tunnelling impossible regardless of speed: the thinnest surface on any table here is a
 *  capsule of radius 3, so a ball travelling 2.7 units per micro-step is sampled inside it at
 *  least four times on the way through. */
const MAX_TRAVEL = BALL_R * 0.3;
const MAX_SUBSTEPS = 16;

/** A ball. Plain data so game.js can serialise/inspect it and test.js can build one by hand. */
export function makeBall(x, y, vx = 0, vy = 0) {
  return {
    x, y, vx, vy, r: BALL_R, live: true, held: false, spin: 0, restTime: 0,
    pinch: 0,      // seconds spent wedged between opposing surfaces (see escapeWedge)
    avgV: 0,       // smoothed speed; the wedge test uses this, never the instantaneous one
    seed: 1,       // per-ball counter; the ONLY source of "randomness" here, so replays are exact
  };
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
    r: opts.r ?? 4, e: opts.e ?? 0.42, mu: opts.mu ?? 0.06,
    kick: opts.kick ?? 0, kickN: opts.kickN || null,
    id: opts.id || '', oneWay: opts.oneWay || null,
    on: opts.on !== false,
  };
}

/** A solid disc: posts, and (with `kick`) pop bumpers. */
export function circle(x, y, r, opts = {}) {
  return {
    t: 'circle', x, y, r,
    e: opts.e ?? 0.5, mu: opts.mu ?? 0.06, kick: opts.kick ?? 0,
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
 * A flipper: a tapered capsule that rotates about `px,py`. `rest`/`up` are absolute angles in
 * radians.
 *
 * `speed` is the paddle's TOP angular speed and `accel` how fast it gets there. A real flipper
 * sweeps ~50 degrees in ~35 ms and spends most of that at full speed, so the defaults put it at
 * top speed within about 8 ms. It stops DEAD against either stop (omega = 0), which is what makes
 * a held flipper a wall rather than a permanent catapult.
 *
 * `e` IS 0.62 AND MUST STAY ABOVE THE WALLS. It was 0.3 for a while in 2026-08, which made the
 * paddle the deadest surface on the table - below a wall (0.42), the arch (0.40) and a post (0.50)
 * - and a ball fed down the inlane at 668 units/s was under 80 within two touches. Real flipper
 * rubber returns 0.6-0.8. If the table needs calming, calm the kickers, never this.
 */
export function flipper(px, py, len, rest, up, opts = {}) {
  const speed = opts.speed ?? 26;
  return {
    t: 'flipper', px, py, len, rest, up,
    r: opts.r ?? 8, e: opts.e ?? 0.62, mu: opts.mu ?? 0.14,
    id: opts.id || '', angle: rest, omega: 0, pressed: false,
    speed,
    accel: opts.accel ?? speed * 130,   // rad/s^2: full speed in ~8 ms
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
  const d = norm(a - a0);
  return d <= span;
}

/** Closest point on segment ab to p, as a parametric t in [0,1]. */
function closestT(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  return clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
}

/** A deterministic 0..1 from a ball's own counter. The wedge escape needs a hair of asymmetry to
 *  break a perfectly symmetric pinch, and taking it from the ball rather than from Math.random
 *  keeps test.js's replays exact. */
function jitter(ball) {
  ball.seed = (ball.seed * 1664525 + 1013904223) >>> 0;
  return ball.seed / 4294967296;
}

// --- the one contact resolver ------------------------------------------------------------------

/**
 * Resolve one contact. `nx,ny` is a UNIT normal pointing from the surface toward the ball, `pen`
 * the overlap depth, `sv` the surface's own velocity at the contact point.
 *
 * The order matters and is the part worth reading: separate first, then work entirely in the
 * SURFACE's frame (subtract sv), reflect, apply rolling friction, then add sv back. Doing it in
 * the world frame instead is the bug that makes a moving flipper feel like a wall - the paddle's
 * speed gets thrown away by the reflection instead of being handed to the ball.
 *
 * Returns the contact record the caller collects, or null if the ball was already separating (a
 * grazing pass still counts as a contact for scoring, so `speed` may be 0).
 */
function resolve(ball, nx, ny, pen, e, mu, kick, sv, kickN) {
  // Positional correction with a slop: leaving a hair of overlap stops a ball resting on a surface
  // from being re-launched a thousandth of a unit every step, which is what makes a resting ball
  // buzz instead of sit.
  const push = Math.max(0, pen - 0.02);
  ball.x += nx * push;
  ball.y += ny * push;

  const svx = sv ? sv.x : 0, svy = sv ? sv.y : 0;
  const rvx = ball.vx - svx, rvy = ball.vy - svy;
  const vn = rvx * nx + rvy * ny;

  const out = { nx, ny, speed: -vn };
  if (vn < 0) {
    // Restitution falls with impact speed. Real rubber and real wood both do this; modelling it
    // flat is why a hard shot used to trampoline off the slingshots and the arch at a speed the
    // player never put into it.
    const soft = 1 - 0.3 * Math.min(1, -vn / 900);
    const j = -(1 + e * soft) * vn;
    let nvx = rvx + j * nx, nvy = rvy + j * ny;

    // ROLLING FRICTION, NOT STICKING FRICTION. The contact point's tangential speed is
    // (v . t) - w r; the impulse that brings it to zero is |slip| / (1/m + r^2/I) = |slip| / 3.5
    // for a solid sphere, and Coulomb caps it at mu * j. Below the cap the ball starts ROLLING and
    // stops losing speed; above it, it slides and is braked. Plain Coulomb friction without the
    // rotational degree of freedom can only ever brake, which turns every slope into flypaper -
    // that was measured on the imported ROYAL FLUSH board (parked-ball episodes 24 -> 96) and is
    // the reason `spin` is real here rather than a render-only decoration.
    if (mu > 0) {
      const tx = -ny, ty = nx;
      const slip = (nvx * tx + nvy * ty) - ball.spin * ball.r;
      if (Math.abs(slip) > 1e-6) {
        const jt = Math.min(Math.abs(slip) / 3.5, mu * j) * Math.sign(slip);
        nvx -= tx * jt;
        nvy -= ty * jt;
        ball.spin += (jt * ball.r) / (0.4 * ball.r * ball.r);
      }
    }
    ball.vx = nvx + svx; ball.vy = nvy + svy;
  }

  // A SLINGSHOT IS ONLY LIVE ON ITS FRONT FACE, and `kickN` is what says which face that is.
  // Without it the inlane side of a slingshot is a solenoid pointed at the wrong half of the
  // table: a soak measured 53% of all ball life bouncing in the pocket above the right inlane,
  // because every time the ball rolled down the back of the slingshot the coil fired it straight
  // back up there. On a real machine that face is buried in plastic and has no switch behind it.
  if (kick && kickN && (nx * kickN[0] + ny * kickN[1]) < 0.5) kick = 0;
  if (kick) {
    // A solenoid guarantees an outgoing speed, it does not add to whatever was there. Taking the
    // max rather than adding is what stops a fast ball ping-ponging out of a bumper nest at absurd
    // speed while still giving a dead-slow ball the full kick.
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
// Each returns the contact record from resolve(), or null when the shape is out of reach.

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
  return resolve(ball, nx, ny, reach - d, s.e, s.mu, s.kick, null, s.kickN);
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

/** The paddle's contact point and surface radius at parametric `t` along it. A real flipper is a
 *  wedge - fat at the pivot, tapered at the tip - and modelling that instead of a constant-radius
 *  capsule is what makes a tip shot fly flatter than a base shot, which is the whole vocabulary of
 *  aiming in this game. */
function flipperNear(ball, f) {
  const ex = f.px + Math.cos(f.angle) * f.len;
  const ey = f.py + Math.sin(f.angle) * f.len;
  const t = closestT(ball.x, ball.y, f.px, f.py, ex, ey);
  const qx = f.px + (ex - f.px) * t, qy = f.py + (ey - f.py) * t;
  return { t, qx, qy, surf: f.r * (1 - 0.35 * t) };
}

function hitFlipper(ball, f) {
  const { qx, qy, surf } = flipperNear(ball, f);
  let nx = ball.x - qx, ny = ball.y - qy;
  const d = Math.hypot(nx, ny);
  const reach = ball.r + surf;
  if (d >= reach) return null;
  if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  // Surface velocity at the contact point: omega x r, in 2D that is omega * perpendicular(r).
  const rx = qx - f.px, ry = qy - f.py;
  const sv = { x: -f.omega * ry, y: f.omega * rx };
  const hit = resolve(ball, nx, ny, reach - d, f.e, f.mu, 0, sv);
  if (hit && f.pressed) hit.cradle = true;

  // THE CRADLE. A slow ball resting on a stationary paddle is damped along the paddle, so it
  // settles into the pivot corner and stays there instead of trickling off. Trapping the ball is
  // how a player aims, and without this the table never lets them: every catch dribbled away and
  // the only shot available was a reflex swat at a moving ball.
  // Only while the paddle is HELD UP. That is what a real cradle is: the ball resting in the
  // crook between a raised flipper and the inlane guide. A paddle at its DOWN stop must still let
  // the ball roll off the end - damping there is flypaper, and test.js has a probe for it.
  if (f.omega === 0 && f.pressed) {
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp < 150) {
      const damp = 1 - 0.55 * (1 - sp / 150);
      const tx = -ny, ty = nx;
      const vt = (ball.vx * tx + ball.vy * ty) * damp;
      const vn = ball.vx * nx + ball.vy * ny;
      ball.vx = tx * vt + nx * vn;
      ball.vy = ty * vt + ny * vn;
    }
  }
  return hit;
}

// --- wedges ---------------------------------------------------------------------------------------

/**
 * A ball touching two or more surfaces whose normals oppose each other, while barely moving, is
 * WEDGED: a stable equilibrium that nothing in a rigid-body solver can shake loose, because every
 * separation push is cancelled by the opposite surface. That is not a hypothetical - the old
 * table.js header lists four of them as shipped bugs, each one a permanent parking space found by
 * a soak rather than by reading the code, and the old game.js grew two watchdogs to cover them.
 *
 * A real ball gets out because it is a sphere on a tilted plane and the pinch is never quite
 * symmetric. This is the 2D stand-in: once a ball has been pinched for WEDGE_TIME, give it a small
 * outward impulse along the resultant of the contact normals, with a hair of asymmetry from the
 * ball's own counter so a perfectly symmetric pinch still breaks. It is small enough (about a
 * fifth of a slingshot) that it can never launch a shot, and it fires only when the ball is going
 * nowhere, so it can never alter live play.
 */
const WEDGE_TIME = 0.25;      // seconds pinched before the ball lets itself out
const WEDGE_SPEED = 110;      // SMOOTHED speed below which a ball counts as going nowhere
const WEDGE_KICK = 110;       // table-units/s of escape

/**
 * IT TESTS THE SMOOTHED SPEED, NOT THE INSTANTANEOUS ONE, AND THAT IS THE WHOLE FIX.
 * A wedged ball does not sit still: it buzzes between its two surfaces, and a measurement taken
 * on any single step crosses any threshold you pick several times a second. The first version
 * read `Math.hypot(vx, vy)` against 60 and duly never fired - a soak parked 81% of all ball life
 * in one crook beside the right flipper, with the instantaneous speed swinging 1 to 66 the whole
 * time. `ball.avgV` is an exponential average over about a tenth of a second, which a buzz
 * cannot fool. It is the same lesson game.js's ball-search records: measure where the ball IS
 * going, never how fast it happens to be moving this step.
 *
 * A DELIBERATE CRADLE IS EXEMPT. A ball held in the crook of a RAISED flipper is also two
 * opposing contacts at low speed, and shoving it out would take away the one thing a player uses
 * to aim. A flipper at its DOWN stop gets no such exemption - a ball stuck against a resting
 * paddle and a wall is a wedge, not a skill.
 */
function escapeWedge(ball, contacts, dt) {
  const sp = ball.avgV;
  if (contacts.some((c) => c.cradle)) { ball.pinch = 0; return false; }
  let opposed = false;
  for (let i = 0; i < contacts.length && !opposed; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i], b = contacts[j];
      if (a.nx * b.nx + a.ny * b.ny < -0.2) { opposed = true; break; }
    }
  }
  if (!opposed || sp > WEDGE_SPEED) { ball.pinch = 0; return false; }

  ball.pinch += dt;
  if (ball.pinch < WEDGE_TIME) return false;
  ball.pinch = 0;

  let nx = 0, ny = 0;
  for (const c of contacts) { nx += c.nx; ny += c.ny; }
  const len = Math.hypot(nx, ny);
  if (len < 1e-4) {
    // Perfectly opposed: there is no resultant to escape along, so take the tangent of the first
    // contact and let the incline decide the rest.
    nx = -contacts[0].ny; ny = contacts[0].nx;
  } else {
    nx /= len; ny /= len;
  }
  const wob = (jitter(ball) - 0.5) * 0.5;
  const cos = Math.cos(wob), sin = Math.sin(wob);
  ball.vx += (nx * cos - ny * sin) * WEDGE_KICK;
  ball.vy += (nx * sin + ny * cos) * WEDGE_KICK;
  return true;
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

// --- flippers ------------------------------------------------------------------------------------

/** Advance one paddle by `h` seconds. It accelerates toward its target and stops DEAD against the
 *  stop, so `omega` is honest: non-zero only while the paddle is genuinely sweeping. */
function stepFlipper(f, h) {
  const target = f.pressed ? f.up : f.rest;
  const diff = target - f.angle;
  if (diff === 0) { f.omega = 0; return; }
  const dir = Math.sign(diff);
  f.omega = clamp(f.omega + dir * f.accel * h, -f.speed, f.speed);
  const move = f.omega * h;
  if (Math.abs(move) >= Math.abs(diff)) { f.angle = target; f.omega = 0; return; }
  f.angle += move;
}

/** Fastest point on a paddle, used only to size the micro-step. */
function flipperTipSpeed(f) { return Math.abs(f.omega) * f.len; }

// --- the step ------------------------------------------------------------------------------------

/**
 * Advance the world by exactly one PHYS_DT, internally subdivided so nothing moves more than
 * MAX_TRAVEL per micro-step.
 *
 * @param {object} world  { colliders, flippers, gravity, drag, nudgeX, nudgeY }
 * @param {Array}  balls
 * @param {(kind, id, x, y, speed, ball) => void} onContact  called once per resolved contact;
 *        game.js turns these into score and lamps. Called AFTER the impulse, so `speed` is the
 *        closing speed that produced it.
 */
export function step(world, balls, onContact) {
  const { flippers, colliders } = world;

  // How finely does THIS tick have to be cut? Take the fastest thing in the world - a ball, or a
  // paddle tip already sweeping - and also look one tick ahead at what the paddles are about to do,
  // so a flip that starts inside this tick is still sampled finely enough to catch the ball.
  let fastest = 0;
  for (const b of balls) {
    if (!b.live || b.held) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > fastest) fastest = sp;
  }
  for (const f of flippers) {
    const sweeping = f.pressed ? f.angle !== f.up : f.angle !== f.rest;
    const sp = sweeping ? f.speed * f.len : flipperTipSpeed(f);
    if (sp > fastest) fastest = sp;
  }
  const n = clamp(Math.ceil((fastest * PHYS_DT) / MAX_TRAVEL), 1, MAX_SUBSTEPS);
  const h = PHYS_DT / n;

  for (let s = 0; s < n; s++) {
    for (const f of flippers) stepFlipper(f, h);

    for (const ball of balls) {
      if (!ball.live || ball.held) continue;

      ball.vy += world.gravity * h;
      if (world.nudgeX) ball.vx += world.nudgeX * h;
      if (world.nudgeY) ball.vy += world.nudgeY * h;

      // Rolling resistance of the playfield itself. Without it a ball trapped in a bumper nest
      // never loses energy and never settles.
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > 0) {
        const d = 1 - Math.min(0.9, (world.drag ?? 0.16) * h * (0.5 + sp / 746));
        ball.vx *= d; ball.vy *= d;
      }

      ball.x += ball.vx * h;
      ball.y += ball.vy * h;

      // Collect every contact this micro-step, then decide about wedges knowing all of them. The
      // old solver resolved each collider in isolation and could not see a pinch at all.
      const contacts = [];
      for (const c of colliders) {
        if (!c.on) continue;
        const hit = c.t === 'seg' ? hitSeg(ball, c)
          : c.t === 'circle' ? hitCircle(ball, c)
            : c.t === 'arc' ? hitArc(ball, c) : null;
        if (!hit) continue;
        contacts.push(hit);
        if (onContact) onContact(c.id ? 'id' : 'wall', c.id, ball.x, ball.y, hit.speed, ball);
      }
      for (const f of flippers) {
        const hit = hitFlipper(ball, f);
        if (!hit) continue;
        contacts.push(hit);
        if (onContact) onContact('flipper', f.id, ball.x, ball.y, hit.speed, ball);
      }
      if (contacts.length > 1) escapeWedge(ball, contacts, h);
      else ball.pinch = 0;

      const s2 = Math.hypot(ball.vx, ball.vy);
      if (s2 > MAX_SPEED) { ball.vx = ball.vx / s2 * MAX_SPEED; ball.vy = ball.vy / s2 * MAX_SPEED; }
      // Smoothed speed for the wedge test: a ~0.1 s time constant, so a buzz cannot fool it.
      const k = Math.min(1, h / 0.1);
      ball.avgV += (Math.min(s2, MAX_SPEED) - ball.avgV) * k;
    }

    ballPairs(balls, (x, y, spd) => { if (onContact) onContact('ball', 'ball', x, y, spd, null); });
  }
}

export default { PHYS_DT, MAX_SPEED, BALL_R, makeBall, seg, circle, arc, flipper, step };
