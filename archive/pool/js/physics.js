// physics.js — pure, headless (no DOM) pool physics engine for Pool.
//
// Grounded in published billiards physics rather than tuned by feel (per the
// build guide): the sliding/rolling friction split and the relative contact-point
// slip formula follow the standard rigid-sphere-on-cloth treatment used in Marlow's
// "The Physics of Pocket Billiards" (1994) and Dr. Dave Alciatore's published
// technical proofs (billiards.colostate.edu) — a ball slides while its contact
// point still slips against the cloth, decelerating faster (mu_slide) and bleeding
// spin into roll, then rolls at the slower mu_roll once slip reaches zero. Cushion
// and cue-tip-contact formulas are the same family's standard approximations.
// Units: SI (meters, seconds, kg, radians). No randomness anywhere: same inputs,
// same shot, same result, every time (deterministic — required both by the build
// guide and by lockstep multiplayer, which transmits only shot parameters and
// re-simulates locally on each device).

export const R = 0.028575;          // ball radius (m) - standard 57.15mm diameter ball
export const BALL_D = 2 * R;
export const G = 9.81;

// Table: a 7-ft "bar box" playing surface, 39in x 78in (0.9906m x 1.9812m) — the
// common ratio-2:1 size, good for a mobile screen. Cushion (rail) face sits at the
// playing-surface edge; pockets are capture circles at the 6 standard positions.
export const TABLE = {
  w: 0.9906,
  h: 1.9812,
};
export const POCKET_R = R * 1.9;   // capture radius at each pocket center
// Note: corner pockets use the same plain capture circle as side pockets. Real
// corner pockets are cut on a diagonal with a narrower effective mouth (the "jaw"),
// which is a known fidelity gap (BUILD-SPEC §6 #11) — not modeled here.

// Friction coefficients (dimensionless, published-range values):
export const MU_SLIDE = 0.2;    // cloth sliding friction
export const MU_ROLL = 0.011;   // cloth rolling resistance
export const MU_SPIN = 0.044;   // spin (vertical-axis) decay coefficient
const SLIDE_EPS = 1e-4;         // relative slip speed (m/s) below which slide -> roll
const STOP_V = 0.004;           // linear speed (m/s) below which a rolling ball is "stopped"
const STOP_W = 0.06;            // spin (rad/s) below which residual spin is zeroed

// Cushion: coefficient of restitution is not constant — harder hits lose
// relatively more energy to the rail's cloth-wrapped rubber (published curves put
// COR roughly between 0.6 at high speed and 0.85+ near-stationary). Modeled with a
// simple decaying curve rather than a fixed constant, per the build guide's "cushions
// absorb energy differently depending on how hard you hit them."
function cushionRestitution(speed) {
  return 0.5 + 0.35 * Math.exp(-speed / 3.2);
}
const CUSHION_MU = 0.2;          // tangential friction at the rail
const CUSHION_ENGLISH = 0.42;    // how much side-spin (english) skews the rebound angle
const CUSHION_GRIP = 0.28;       // how much roll spin the rail imparts on rebound

// Cue-tip contact model constants (see strikeCueBall):
const SPIN_GAIN = 0.92;    // fraction of the "natural roll" spin a max-offset hit imparts
const SQUIRT_COEFF = 0.055; // rad of aim deflection per unit of side offset at full english
const CURVE_COEFF = 0.9;   // masse curve strength scaler (only active with cue raised)

export function createBall(id, x, y, kind, number) {
  // kind: 'cue' | 'solid' | 'stripe' | 'eight'
  return { id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, kind, number, pocketed: false, moving: false };
}

function len(x, y) { return Math.sqrt(x * x + y * y); }

/** Relative slip velocity of the cloth contact point (Alciatore's standard formula):
 *  u = v + R * (up x w), up=(0,0,1) -> (up x w) = (-wy, wx, 0). */
function slip(b) {
  return { x: b.vx - R * b.wy, y: b.vy + R * b.wx };
}

/** Spin a moving ball's (wx,wy) into exact natural-roll alignment for velocity v. */
function naturalRollSpin(vx, vy) {
  return { wx: -vy / R, wy: vx / R };
}

/** Rolling-resistance deceleration, clamped so it can never overshoot past
 *  zero speed in one step (the same overshoot-oscillation bug as the sliding
 *  branch, just simpler to hit here since there's only one rate to clamp). */
function applyRollFriction(b, dt) {
  if (dt <= 0) return;
  const sp = len(b.vx, b.vy);
  if (sp > 1e-9) {
    const dec = Math.min(MU_ROLL * G * dt, sp);
    b.vx -= (b.vx / sp) * dec;
    b.vy -= (b.vy / sp) * dec;
  }
  const roll = naturalRollSpin(b.vx, b.vy);
  b.wx = roll.wx; b.wy = roll.wy;
}

/** Advance one ball by dt under cloth friction (sliding, then rolling) plus a
 *  simplified masse curve term when the ball still carries side-spin from an
 *  elevated-cue strike. Mutates `b` in place. */
export function stepBall(b, dt) {
  if (b.pocketed) return;
  const speed = len(b.vx, b.vy);
  const spinMag = Math.abs(b.wz);
  if (speed < STOP_V && len(b.wx, b.wy) < STOP_W && spinMag < STOP_W) {
    b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0; b.moving = false;
    return;
  }
  b.moving = true;
  const u = slip(b);
  const uMag = len(u.x, u.y);
  if (uMag > SLIDE_EPS) {
    // Sliding: cloth friction decelerates translation and spins the ball toward
    // roll. Kinetic friction is CONSTANT magnitude regardless of slip speed, so
    // combining the linear (dv/dt = -mu*g*u_hat) and angular EOMs gives a slip
    // vector |u| that shrinks at a CONSTANT rate (7/2 * mu*g) with a FIXED
    // direction until it hits exactly zero (see pool/CLAUDE.md's physics
    // section) — the transition happens in finite, computable time. A naive
    // fixed-magnitude-per-step decrement doesn't know that: once |u| gets
    // smaller than one step's worth of decrement, it overshoots PAST zero,
    // flipping u's direction, which then gets "corrected" by an equally
    // oversized decrement next step — a stable limit cycle that never
    // actually reaches zero. That bug made shots settle into an imperceptible
    // but perpetual creep instead of stopping, so isMoving() never returned
    // false and a shot could hang "in progress" indefinitely. Clamp to the
    // exact crossing point instead.
    const ux = u.x / uMag, uy = u.y / uMag;
    const aLin = MU_SLIDE * G;
    const spinRate = (5 / (2 * R)) * MU_SLIDE * G;
    const uCloseRate = 3.5 * MU_SLIDE * G; // (7/2)*mu*g, derived above
    const tCross = uMag / uCloseRate;
    if (tCross < dt) {
      // This step crosses from sliding into rolling partway through: advance
      // only the fraction that completes the transition, snap to the exact
      // natural-roll spin (kills any float residue), then spend the rest of
      // dt as ordinary rolling friction.
      b.vx -= aLin * ux * tCross;
      b.vy -= aLin * uy * tCross;
      b.wx += -spinRate * uy * tCross;
      b.wy += spinRate * ux * tCross;
      const roll = naturalRollSpin(b.vx, b.vy);
      b.wx = roll.wx; b.wy = roll.wy;
      applyRollFriction(b, dt - tCross);
    } else {
      b.vx -= aLin * ux * dt;
      b.vy -= aLin * uy * dt;
      b.wx += -spinRate * uy * dt;
      b.wy += spinRate * ux * dt;
      // Curve (masse): only meaningful with side-spin present; a raised-cue
      // shot's curve is applied once at strike time via extra initial wz and
      // this ongoing lateral nudge while still sliding, then stops once
      // rolling begins.
      if (spinMag > STOP_W) {
        const sp = len(b.vx, b.vy);
        if (sp > 1e-6) {
          const perp = { x: -b.vy / sp, y: b.vx / sp };
          const curveA = CURVE_COEFF * b.wz * 0.002;
          b.vx += perp.x * curveA;
          b.vy += perp.y * curveA;
        }
      }
    }
  } else {
    applyRollFriction(b, dt);
  }
  // Vertical-axis (side) spin decays independently under spin friction.
  if (spinMag > 0) {
    const decay = (5 / (2 * R)) * MU_SPIN * G;
    if (spinMag <= decay * dt) b.wz = 0;
    else b.wz -= Math.sign(b.wz) * decay * dt;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/** Strike the cue ball. dir is a unit {x,y} aim vector, power is initial speed (m/s),
 *  offset (a,b) each in [-1,1] as a fraction of R (a: side/english, +right of aim;
 *  b: vertical, + above center = follow/topspin, - below = draw/backspin),
 *  elevation in radians (0 = level cue, up to ~0.5 for a raised masse-ish stroke). */
export function strikeCueBall(cue, dir, power, offset, elevation) {
  const a = Math.max(-0.62, Math.min(0.62, offset.a || 0));
  const b = Math.max(-0.62, Math.min(0.62, offset.b || 0));
  const elev = Math.max(0, Math.min(0.5, elevation || 0));
  // Squirt: an off-center hit deflects the cue ball's initial path slightly
  // opposite the offset (the cue's own moment of inertia effect).
  const squirt = -a * SQUIRT_COEFF;
  const cosT = Math.cos(squirt), sinT = Math.sin(squirt);
  const fx = dir.x * cosT - dir.y * sinT;
  const fy = dir.x * sinT + dir.y * cosT;
  const v0 = power * Math.cos(elev);
  cue.vx = fx * v0;
  cue.vy = fy * v0;
  const roll = naturalRollSpin(fx * v0, fy * v0);
  cue.wx = b * roll.wx * SPIN_GAIN;
  cue.wy = b * roll.wy * SPIN_GAIN;
  cue.wz = (a * v0 / R) * SPIN_GAIN * (1 + elev * 1.4);
  cue.moving = true;
}

/** Resolve an instantaneous ball-ball collision (equal mass, elastic along the line
 *  of centers). The moving ball's normal-component velocity transfers fully to the
 *  struck ball ("stun"); it keeps only its tangential component. A small "throw"
 *  nudge (real friction-during-contact effect) skews the struck ball off the pure
 *  line of centers when the striker carries side-spin. Returns true if it collided. */
export function resolveBallCollision(a, c) {
  const dx = c.x - a.x, dy = c.y - a.y;
  const dist = len(dx, dy);
  if (dist <= 0 || dist > 2 * R) return false;
  const nx = dx / dist, ny = dy / dist;
  const tx = -ny, ty = nx;
  const relVx = a.vx - c.vx, relVy = a.vy - c.vy;
  const closing = relVx * nx + relVy * ny;
  if (closing <= 0) return false; // moving apart already
  // separate overlapping balls along the normal before resolving
  const overlap = 2 * R - dist;
  if (overlap > 0) {
    a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
    c.x += nx * overlap * 0.5; c.y += ny * overlap * 0.5;
  }
  const aVn = a.vx * nx + a.vy * ny, aVt = a.vx * tx + a.vy * ty;
  const cVn = c.vx * nx + c.vy * ny, cVt = c.vx * tx + c.vy * ty;
  // Equal-mass elastic exchange of normal components; tangential unchanged.
  const newAVn = cVn, newCVn = aVn;
  a.vx = newAVn * nx + aVt * tx;
  a.vy = newAVn * ny + aVt * ty;
  c.vx = newCVn * nx + cVt * tx;
  c.vy = newCVn * ny + cVt * ty;
  // Throw: side-spin at the striker's contact point nudges the struck ball's
  // tangential velocity a little (friction-during-contact), scaled by closing speed.
  const throwAmt = 0.045 * a.wz * closing / Math.max(closing, 1);
  c.vx += tx * throwAmt * R;
  c.vy += ty * throwAmt * R;
  a.moving = true; c.moving = true;
  return true;
}

/** Reflect a ball off a straight cushion with outward unit normal n. */
export function reflectCushion(b, nx, ny) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return; // moving away from the cushion already
  const speed = len(b.vx, b.vy);
  const e = cushionRestitution(speed);
  const tx = -ny, ty = nx;
  const vt = b.vx * tx + b.vy * ty;
  const newVn = -vn * e;
  let newVt = vt * (1 - CUSHION_MU);
  // English off the rail: side-spin skews the tangential rebound velocity.
  newVt += b.wz * CUSHION_ENGLISH * R * 0.5;
  b.vx = newVn * nx + newVt * tx;
  b.vy = newVn * ny + newVt * ty;
  // The rail imparts a little roll toward the new direction; keep it partial —
  // real cushion contact is far too brief to fully re-align spin.
  const roll = naturalRollSpin(b.vx, b.vy);
  b.wx = b.wx * (1 - CUSHION_GRIP) + roll.wx * CUSHION_GRIP;
  b.wy = b.wy * (1 - CUSHION_GRIP) + roll.wy * CUSHION_GRIP;
  b.wz *= (1 - CUSHION_MU * 0.5);
  b.moving = true;
}

/** All 6 pocket centers for TABLE, in table-local coordinates, origin at center. */
export function pocketCenters() {
  const hw = TABLE.w / 2, hh = TABLE.h / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh },
    { x: -hw, y: 0 }, { x: hw, y: 0 },
    { x: -hw, y: hh }, { x: hw, y: hh },
  ];
}

export function isMoving(balls) {
  return balls.some((b) => !b.pocketed && b.moving);
}

/** One physics tick over every live ball: integrate, resolve ball-ball collisions,
 *  cushions, and pocket capture. Returns an event log fragment for this tick:
 *  { hits: [{a,b}] (ball ids that touched), rails: number (cushion contacts this
 *  tick), pocketed: [ball ids captured this tick], log: [...] } — `log` is the same
 *  three kinds of event (`{t:'hit',a,b}` / `{t:'rail',id}` / `{t:'pocket',id}`) but
 *  in a single ORDERED sequence (hits, then rails, then pockets, matching this
 *  function's own resolution order), so callers can ask "did X happen before Y"
 *  within a shot — e.g. whether any rail contact came after the cue ball's first
 *  hit, which a plain count can't answer. The rules engine and AI use these to
 *  score/legalize a shot without caring about rendering. */
export function tick(balls, dt) {
  const events = { hits: [], rails: 0, pocketed: [], log: [] };
  const hw = TABLE.w / 2, hh = TABLE.h / 2;
  const pockets = pocketCenters();
  const live = balls.filter((b) => !b.pocketed);
  for (const b of live) stepBall(b, dt);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (resolveBallCollision(live[i], live[j])) {
        events.hits.push({ a: live[i].id, b: live[j].id });
        events.log.push({ t: 'hit', a: live[i].id, b: live[j].id });
      }
    }
  }
  for (const b of live) {
    if (b.pocketed) continue;
    let hitRail = false;
    if (b.x - R < -hw) { b.x = -hw + R; reflectCushion(b, 1, 0); hitRail = true; }
    else if (b.x + R > hw) { b.x = hw - R; reflectCushion(b, -1, 0); hitRail = true; }
    if (b.y - R < -hh) { b.y = -hh + R; reflectCushion(b, 0, 1); hitRail = true; }
    else if (b.y + R > hh) { b.y = hh - R; reflectCushion(b, 0, -1); hitRail = true; }
    if (hitRail) { events.rails++; events.log.push({ t: 'rail', id: b.id }); }
  }
  for (const b of live) {
    if (b.pocketed) continue;
    for (const p of pockets) {
      if (len(b.x - p.x, b.y - p.y) < POCKET_R) {
        b.pocketed = true; b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0; b.moving = false;
        events.pocketed.push(b.id);
        events.log.push({ t: 'pocket', id: b.id });
        break;
      }
    }
  }
  return events;
}

/** Deterministic fixed-step simulation from the moment of a strike until every
 *  ball is at rest (or maxSeconds elapses, a safety valve). Used for real-time
 *  rendering (called once per animation frame with accumulated fixed steps) AND
 *  for instant lookahead (AI shot search, MP hash verification) by looping with
 *  no rendering in between — same function, same result either way. */
export function simulateToRest(balls, dt = 1 / 240, maxSeconds = 20) {
  let t = 0;
  const allEvents = { hits: [], rails: 0, pocketed: [], log: [] };
  while (t < maxSeconds) {
    if (!isMoving(balls)) break;
    const ev = tick(balls, dt);
    allEvents.hits.push(...ev.hits);
    allEvents.rails += ev.rails;
    allEvents.pocketed.push(...ev.pocketed);
    allEvents.log.push(...ev.log);
    t += dt;
  }
  return allEvents;
}
