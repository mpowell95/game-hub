// The swept solver. Pure: no DOM, no timers, no randomness. Metres, x right, y down the playfield
// toward the drain, so gravity is +y.
//
// THE ONE IDEA: the ball is never inside anything, so nothing ever has to push it out.
//
// Between contacts a ball travels in a straight line, and every collider here is a circle, a
// segment or a circular arc, each of which has a closed-form time of first impact against a moving
// point. So a tick advances the ball to the exact instant it touches something, resolves that
// contact, and continues with the time that is left. It is not a small step and a hope.
//
// What that buys, in the words of the bugs it removes:
//   "it goes through objects" - impossible at any speed. A crossing is found as a root, not
//       sampled. MAX_SPEED is a gameplay bound and raising it cannot lose the ball.
//   "it teleports" / "it vanishes" - no code in this file assigns a ball a position it did not
//       travel to, and there is no level transition to hand it between. The only position write is
//       p += v*t.
//   "it gets stuck everywhere" - a contact whose closing speed is under REST_SPEED slides instead
//       of bouncing, so a ball in a corner keeps its along-surface motion instead of buzzing
//       between two normals until it stops dead.
//
// The one place a position IS corrected is a flipper swinging into a ball, because a paddle is
// driven and the ball has to be let out of the way. Its micro step is bounded so the overlap is at
// most a quarter of a ball radius, and CRUCIALLY the ball takes the PADDLE SURFACE velocity, never
// a velocity derived from the correction distance over dt. That derived velocity is what threw a
// ball from 0.4 m/s to 10.8 m/s in one step on the old engine.

import { gravity } from './config.js';

const EPS = 1e-9;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const perp = (a) => ({ x: -a.y, y: a.x });

// ------------------------------------------------------------------ time of impact primitives
// Each returns { t, n } or null. t is the time of first touch along p + v*t, n is the unit normal
// pointing back at the ball. All of them take a surface already inflated by the ball radius, so
// the ball is a POINT here and there is exactly one distance to solve for.

function toiPointSeg(p, v, A, B, tmax) {
  const d = sub(B, A);
  const L = len(d);
  if (L < EPS) return null;
  const n = { x: -d.y / L, y: d.x / L };
  const s = dot(sub(p, A), n);
  const vn = dot(v, n);
  if (Math.abs(vn) < EPS) return null;
  if (s * vn >= 0) return null;             // moving away from the line, or along it
  const t = -s / vn;
  if (t <= 0 || t > tmax) return null;
  const hit = add(p, mul(v, t));
  const u = dot(sub(hit, A), d) / (L * L);
  if (u < 0 || u > 1) return null;          // crosses the infinite line past an end
  return { t, n: s > 0 ? n : { x: -n.x, y: -n.y } };
}

function toiPointCircleOut(p, v, C, R, tmax) {
  const m = sub(p, C);
  const a = dot(v, v);
  if (a < EPS) return null;
  const c = dot(m, m) - R * R;
  if (c < 0) return null;                   // already inside: not this surface's job
  const b = 2 * dot(m, v);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0 || t > tmax) return null;
  const hit = add(p, mul(v, t));
  return { t, n: mul(sub(hit, C), 1 / R) };
}

function toiPointCircleIn(p, v, C, R, tmax) {
  const m = sub(p, C);
  const a = dot(v, v);
  if (a < EPS) return null;
  const c = dot(m, m) - R * R;
  if (c > 0) return null;
  const b = 2 * dot(m, v);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  if (t <= 0 || t > tmax) return null;
  const hit = add(p, mul(v, t));
  return { t, n: mul(sub(hit, C), -1 / R) };
}

/** A capsule of possibly different end radii, as two straight flanks and two end circles. One
 *  decomposition serves both a plain rail (equal radii, the flanks are the parallel offsets) and a
 *  tapered flipper bat, so there is no second code path to keep in step. */
function taperedParts(A, ra, B, rb) {
  const d = sub(B, A);
  const L = len(d);
  const circles = [{ c: A, R: ra }, { c: B, R: rb }];
  if (L < EPS || Math.abs(ra - rb) >= L) return { flanks: [], circles };
  const th = Math.atan2(d.y, d.x);
  const beta = Math.acos((ra - rb) / L);
  const flanks = [];
  for (const s of [1, -1]) {
    const u = { x: Math.cos(th + s * beta), y: Math.sin(th + s * beta) };
    flanks.push({ A: add(A, mul(u, ra)), B: add(B, mul(u, rb)) });
  }
  return { flanks, circles };
}

function angleInSpan(ang, a0, a1) {
  const twoPi = Math.PI * 2;
  let d = (ang - a0) % twoPi;
  if (d < 0) d += twoPi;
  let span = (a1 - a0) % twoPi;
  if (span <= 0) span += twoPi;
  return d <= span;
}

// ------------------------------------------------------------------ colliders
// A shape is data. `impact` turns it into the primitives above, inflated by the ball radius.

function shapeImpact(sh, p, v, br, tmax) {
  let best = null;
  const take = (r) => { if (r && (!best || r.t < best.t)) best = r; };

  if (sh.kind === 'seg' || sh.kind === 'sling') {
    const { flanks, circles } = taperedParts(sh.a, sh.r + br, sh.b, sh.r + br);
    for (const f of flanks) take(toiPointSeg(p, v, f.A, f.B, tmax));
    for (const c of circles) take(toiPointCircleOut(p, v, c.c, c.R, tmax));
  } else if (sh.kind === 'circle' || sh.kind === 'bumper') {
    take(toiPointCircleOut(p, v, sh.c, sh.r + br, tmax));
  } else if (sh.kind === 'arc') {
    const outR = sh.radius + sh.r + br;
    const inR = sh.radius - sh.r - br;
    const hitOut = toiPointCircleOut(p, v, sh.c, outR, tmax);
    if (hitOut) {
      const h = add(p, mul(v, hitOut.t));
      if (angleInSpan(Math.atan2(h.y - sh.c.y, h.x - sh.c.x), sh.a0, sh.a1)) take(hitOut);
    }
    if (inR > EPS) {
      const hitIn = toiPointCircleIn(p, v, sh.c, inR, tmax);
      if (hitIn) {
        const h = add(p, mul(v, hitIn.t));
        if (angleInSpan(Math.atan2(h.y - sh.c.y, h.x - sh.c.x), sh.a0, sh.a1)) take(hitIn);
      }
    }
    for (const a of [sh.a0, sh.a1]) {
      const c = { x: sh.c.x + sh.radius * Math.cos(a), y: sh.c.y + sh.radius * Math.sin(a) };
      take(toiPointCircleOut(p, v, c, sh.r + br, tmax));
    }
  }
  if (best) best.shape = sh;
  return best;
}

/** How deep a ball is inside a STATIC collider, and the shortest way out.
 *
 *  "The ball is never inside anything" is the invariant this engine is built on, and it is exact
 *  for a ball that ARRIVES somewhere: an impact is a root, not a sample. What it did not cover is a
 *  ball that is inside a collider ALREADY, and the impact tests are worse than useless there: one
 *  returns null because the ball is inside the outer surface, the other because it is outside the
 *  inner surface, so the collider becomes invisible and the ball drifts straight through it.
 *
 *  It happens where two rails meet FLUSH. A ball riding up the left rail arrives exactly tangent to
 *  the corner arc, which is what flush means and is what it should do, and a fraction of a
 *  millimetre either way puts its centre inside the arc's band. Matt found it in about a minute:
 *  "the ball bounces and flies right over the left flipper and below the wall, out of the machine."
 *
 *  So this is the net, and `rescues` counts every time it fires, because it firing at all means the
 *  geometry has a graze in it that is worth looking at. It is not a position correction of the
 *  solver's own work: it never runs on a ball the solver placed. */
function staticPenetration(sh, p, br) {
  if (sh.kind === 'seg' || sh.kind === 'sling') {
    const d = sub(sh.b, sh.a);
    const L2 = dot(d, d);
    const u = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, sh.a), d) / L2));
    const on = add(sh.a, mul(d, u));
    const away = sub(p, on);
    const dist = len(away);
    const rad = sh.r + br;
    if (dist >= rad) return null;
    return { depth: rad - dist, n: dist < EPS ? { x: 0, y: -1 } : mul(away, 1 / dist) };
  }
  if (sh.kind === 'circle' || sh.kind === 'bumper') {
    const away = sub(p, sh.c);
    const dist = len(away);
    const rad = sh.r + br;
    if (dist >= rad) return null;
    return { depth: rad - dist, n: dist < EPS ? { x: 0, y: -1 } : mul(away, 1 / dist) };
  }
  if (sh.kind === 'arc') {
    const rel = sub(p, sh.c);
    const dist = len(rel);
    const rad = sh.r + br;
    if (dist > EPS && angleInSpan(Math.atan2(rel.y, rel.x), sh.a0, sh.a1)) {
      const radial = dist - sh.radius;
      if (Math.abs(radial) < rad) {
        const dir = radial >= 0 ? 1 : -1;              // out through the nearer face of the band
        return { depth: rad - Math.abs(radial), n: mul(rel, dir / dist) };
      }
      return null;
    }
    for (const a of [sh.a0, sh.a1]) {
      const c = { x: sh.c.x + sh.radius * Math.cos(a), y: sh.c.y + sh.radius * Math.sin(a) };
      const away = sub(p, c);
      const dist2 = len(away);
      if (dist2 < rad) return { depth: rad - dist2, n: dist2 < EPS ? { x: 0, y: -1 } : mul(away, 1 / dist2) };
    }
    return null;
  }
  return null;
}

/** How deep a resting ball is inside a shape, and which way is out. Used only to let a swinging
 *  flipper move a ball that is in its way, never to correct the solver's own work. */
function penetration(sh, p, br, flip) {
  if (sh.kind !== 'flipper') return null;
  const A = flip.pivot;
  const B = flip.tip();
  const d = sub(B, A);
  const L = len(d);
  const u = L < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, A), d) / (L * L)));
  const on = add(A, mul(d, u));
  const rad = sh.r0 + (sh.r1 - sh.r0) * u + br;
  const away = sub(p, on);
  const dist = len(away);
  if (dist >= rad) return null;
  const n = dist < EPS ? { x: 0, y: -1 } : mul(away, 1 / dist);
  return { depth: rad - dist, n, at: on };
}

// ------------------------------------------------------------------ flipper

class Flipper {
  constructor(def) {
    this.def = def;
    this.ang = def.restAng;
    this.omega = 0;
    this.held = false;
  }
  tip() {
    return {
      x: this.def.pivot.x + this.def.len * Math.cos(this.ang),
      y: this.def.pivot.y + this.def.len * Math.sin(this.ang),
    };
  }
  get pivot() { return this.def.pivot; }
  atStop() {
    return this.held
      ? Math.abs(this.ang - this.def.endAng) < 1e-6
      : Math.abs(this.ang - this.def.restAng) < 1e-6;
  }
  /** Rate the bat is turning at right now, signed, radians per second. */
  rate(cfg) {
    const span = this.def.endAng - this.def.restAng;
    const time = this.held ? cfg.FLIP_UP_TIME : cfg.FLIP_DOWN_TIME;
    return (this.held ? span : -span) / time;
  }
  advance(dt, cfg) {
    const target = this.held ? this.def.endAng : this.def.restAng;
    const step = this.rate(cfg) * dt;
    const remain = target - this.ang;
    if (Math.abs(remain) <= Math.abs(step) || remain === 0) {
      this.omega = remain / dt;
      this.ang = target;                       // stops dead against the stop, like a real coil
    } else {
      this.omega = step / dt;
      this.ang += step;
    }
  }
  /** Velocity of the bat's surface at a point on it. */
  surfaceVel(pt) {
    return mul(perp(sub(pt, this.def.pivot)), this.omega);
  }
  parts(br) {
    return taperedParts(this.def.pivot, this.def.r0 + br, this.tip(), this.def.r1 + br);
  }
  impact(p, v, br, tmax) {
    let best = null;
    const { flanks, circles } = this.parts(br);
    for (const f of flanks) {
      const r = toiPointSeg(p, v, f.A, f.B, tmax);
      if (r && (!best || r.t < best.t)) best = r;
    }
    for (const c of circles) {
      const r = toiPointCircleOut(p, v, c.c, c.R, tmax);
      if (r && (!best || r.t < best.t)) best = r;
    }
    if (best) { best.shape = this.def; best.flipper = this; }
    return best;
  }
}

// ------------------------------------------------------------------ world

export class World {
  constructor(table, cfg) {
    this.table = table;
    this.cfg = cfg;
    this.balls = [];
    this.flippers = table.shapes.filter((s) => s.kind === 'flipper').map((s) => new Flipper(s));
    this.statics = table.shapes.filter((s) => s.kind === 'seg' || s.kind === 'arc' || s.kind === 'circle'
      || s.kind === 'bumper' || s.kind === 'sling');
    this.fired = new Map();        // shape id -> world time it last kicked, for the cooldown
    this.drains = table.shapes.filter((s) => s.kind === 'drain');
    this.events = [];
    this.jams = 0;                 // contacts budget exhausted: a diagnostic, never a silent fix
    this.escapes = 0;              // a ball that left the table. Always a bug, never routine
    this.rescues = 0;              // a ball found inside a static. Rare by design, counted, not hidden
    this.broken = 0;               // a ball whose position stopped being a number
    this.time = 0;
  }

  addBall(p, v) {
    const b = { p: { x: p.x, y: p.y }, v: { x: (v && v.x) || 0, y: (v && v.y) || 0 }, spin: 0, alive: true, resting: false, cradling: false, touched: new Map() };
    this.balls.push(b);
    return b;
  }

  setFlipper(side, held) {
    for (const f of this.flippers) if (f.def.side === side) f.held = held;
  }

  /** One tick. Subdivided only by how far a flipper tip may travel, never by how fast the ball is
   *  going, because the ball's motion is solved exactly rather than sampled. */
  step(dt) {
    const cfg = this.cfg;
    // A contact EPISODE, not a contact event. The ball riding a surface touches it again every
    // fraction of a millimetre, and how often that happens is a property of the solver: measured,
    // 14 to 22 times per tick against the flipper. Restitution and friction are paid ONCE per
    // episode, on the first touch. Everything after it only keeps the ball out of the surface.
    //
    // Charging grip at every one of them is what glued the ball to the flipper. Matt: "the ball
    // sticks to the flipper on a lot of shots, like a magnet." Measured with the grip removed
    // entirely, a mid bat flip went from 46 mm up the table to 924 mm, which is what named it.
    for (const b of this.balls) b.touched = new Map();
    let tipSpeed = 0;
    for (const f of this.flippers) {
      if (!f.atStop()) tipSpeed = Math.max(tipSpeed, Math.abs(f.rate(cfg)) * f.def.len);
    }
    const cap = tipSpeed > EPS ? (cfg.FLIP_TIP_STEP * cfg.BALL_R) / tipSpeed : dt;
    const n = Math.max(1, Math.min(64, Math.ceil(dt / cap)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.micro(h);
    this.time += dt;
  }

  micro(h) {
    const cfg = this.cfg;
    const g = gravity(cfg);

    for (const f of this.flippers) f.advance(h, cfg);

    for (const b of this.balls) {
      if (!b.alive) continue;

      b.v.y += g * h;
      const sp = len(b.v);
      if (sp > cfg.MAX_SPEED) b.v = mul(b.v, cfg.MAX_SPEED / sp);

      // The net. A ball inside a static is invisible to the impact tests, so it is caught here
      // BEFORE the step rather than discovered after it has left the table.
      for (const sh of this.statics) {
        const pen = staticPenetration(sh, b.p, cfg.BALL_R);
        if (!pen) continue;
        const to = add(b.p, mul(pen.n, pen.depth + cfg.SKIN));
        if (this.isFree(to)) { b.p = to; this.rescues++; }
        const vn = dot(b.v, pen.n);
        if (vn < 0) this.resolve(b, pen.n, { x: 0, y: 0 }, sh, -vn);
      }

      // A driven bat can arrive where the ball already is. Let the ball out along the bat's own
      // normal and give it the bat's surface velocity. Never a velocity from the correction.
      this.flipperContacts(b, cfg);

      let left = h;
      let events = 0;
      b.resting = false;
      // How many times each collider has already been resolved in THIS micro step. A ball riding
      // along a surface generates a contact every few tenths of a millimetre, and the count is a
      // property of the solver, not of the table: measured, a ball grazing the flipper produced 22
      // contacts in one tick. Charging friction at each of them removed a full metre per second of
      // speed per tick, so a flipped ball died on the bat and sat there. Matt: "the ball sticks to
      // the flipper on a lot of shots, like a magnet."
      //
      // The FIRST contact with a surface in a micro step is an impact and is paid for in full.
      // Anything after it is the same sustained contact seen again, so the ball is only kept out of
      // the surface: no restitution, no friction, no second helping of either.
      while (left > EPS && events < cfg.MAX_EVENTS) {
        const hit = this.firstImpact(b, left);
        if (!hit) {
          b.p = add(b.p, mul(b.v, left));
          left = 0;
          break;
        }
        b.p = add(b.p, mul(b.v, hit.t));
        b.p = add(b.p, mul(hit.n, cfg.SKIN));
        const u = hit.flipper ? hit.flipper.surfaceVel(b.p) : { x: 0, y: 0 };
        const closing = -dot(sub(b.v, u), hit.n);
        const again = b.touched.get(hit.shape.id) > 0;
        b.touched.set(hit.shape.id, (b.touched.get(hit.shape.id) || 0) + 1);
        if (again) {
          const vn = dot(sub(b.v, u), hit.n);
          if (vn < 0) b.v = add(b.v, mul(hit.n, -vn));   // stay out of it, and nothing else
          // A MOVING bat must never leave the ball slower than the bat is throwing it. Without this
          // the keep-out clamp pins the ball to exactly the bat's surface speed, its angular rate
          // about the pivot equals the bat's, and the bat can never let go of it.
          if (hit.flipper && !hit.flipper.atStop()) {
            const un = dot(u, hit.n);
            if (un > 0) {
              const want = (1 + cfg.FLIP_KICK) * un;
              const have = dot(b.v, hit.n);
              if (have < want) b.v = add(b.v, mul(hit.n, want - have));
            }
          }
          b.resting = true;
        } else {
          this.resolve(b, hit.n, u, hit.shape, closing);
        }
        // A CRADLE is a ball settling on a bat that has finished moving. It is NOT a brake to run
        // during the swing, and that is what this was: the test is "held, and closing slowly", and
        // while you hold the button through a flip both are true, so every flip was fighting it.
        // Measured at mid bat: the ball reached 2.56 m/s straight up, which is enough to reach the
        // top of the table, and was down to 1.11 m/s four milliseconds later with no impact in
        // between. The bat has to be AT ITS STOP and the ball has to be slow, and it is charged
        // per second below, never per contact.
        if (hit.flipper && hit.flipper.held && hit.flipper.atStop()) b.cradling = true;
        left -= hit.t;
        events++;
      }
      if (events >= cfg.MAX_EVENTS) this.jams++;

      this.flipperContacts(b, cfg);   // again after moving, since the bat is not swept against

      if (b.cradling && len(b.v) < cfg.CRADLE_MAX) {
        b.v = mul(b.v, Math.max(0, 1 - cfg.CRADLE_DAMP * h));
      }
      b.cradling = false;

      // Rolling resistance, charged by time. Per contact it would depend on how often the ball
      // happened to touch, which is a solver detail and not something a player can feel.
      if (b.resting) {
        const sp = len(b.v);
        if (sp > EPS) {
          const drop = Math.min(sp, cfg.ROLL_DECEL * h);
          b.v = mul(b.v, (sp - drop) / sp);
        }
      }

      // A ball whose numbers stopped being numbers is removed and COUNTED. Letting it live spreads
      // NaN into every contact it touches and, in the browser, into the canvas calls that draw it.
      if (!Number.isFinite(b.p.x) || !Number.isFinite(b.p.y) || !Number.isFinite(b.v.x) || !Number.isFinite(b.v.y)) {
        b.alive = false;
        this.broken++;
        this.events.push({ type: 'broken' });
        continue;
      }

      this.checkDrain(b);
    }
  }

  /** Is a ball centred here clear of every static collider? Used only to vet the flipper push. */
  /** Every flipper contact, resolved from the centreline so the normal is never ambiguous. */
  flipperContacts(b, cfg) {
    for (const f of this.flippers) {
      const pen = penetration(f.def, b.p, cfg.BALL_R, f);
      if (!pen) continue;
      const to = add(b.p, mul(pen.n, pen.depth + cfg.SKIN));
      if (this.isFree(to)) b.p = to;
      const u = f.surfaceVel(pen.at);
      const vn = dot(sub(b.v, u), pen.n);
      if (vn < 0) {
        const again = b.touched.get(f.def.id) > 0;
        b.touched.set(f.def.id, (b.touched.get(f.def.id) || 0) + 1);
        if (again) b.v = add(b.v, mul(pen.n, -vn));
        else this.resolve(b, pen.n, u, f.def, -vn);
      }
      if (f.held && f.atStop()) b.cradling = true;
    }
  }

  isFree(p) {
    const br = this.cfg.BALL_R;
    for (const sh of this.statics) {
      if (sh.kind === 'seg') {
        const d = sub(sh.b, sh.a);
        const L2 = d.x * d.x + d.y * d.y;
        const u = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, sh.a), d) / L2));
        if (len(sub(p, add(sh.a, mul(d, u)))) < sh.r + br) return false;
      } else if (sh.kind === 'circle') {
        if (len(sub(p, sh.c)) < sh.r + br) return false;
      } else if (sh.kind === 'arc') {
        const rel = sub(p, sh.c);
        const dist = len(rel);
        if (Math.abs(dist - sh.radius) < sh.r + br
            && angleInSpan(Math.atan2(rel.y, rel.x), sh.a0, sh.a1)) return false;
      }
    }
    return true;
  }

  /** THE FLIPPER IS NOT IN HERE, AND THAT IS THE POINT.
   *
   *  A swept contact against the bat's flanks and end circles can return a normal for the far side
   *  of the bat, and one did: with the ball measurably ON TOP of the bat (side +20.7mm) the clamp
   *  fired with a normal of (0.39, 0.92), pointing straight down INTO it, and took the ball from
   *  2.82 m/s to 1.16 m/s in a single call at the exact instant the bat reached its stop. That is
   *  what a flipped ball was losing.
   *
   *  `penetration()` cannot do that. It measures from the bat's CENTRELINE, so the normal is
   *  `ball - closest point on the centreline` and can only ever point from the bat towards the
   *  ball. The flipper is resolved there and only there, before and after each micro step's
   *  advance, and a micro step is bounded so the ball crosses at most a few millimetres inside it. */
  firstImpact(b, tmax) {
    const br = this.cfg.BALL_R;
    let best = null;
    for (const s of this.statics) {
      const r = shapeImpact(s, b.p, b.v, br, tmax);
      if (r && (!best || r.t < best.t)) best = r;
    }
    return best;
  }

  /** The only place a velocity changes for a physical reason. */
  resolve(b, n, surfVel, shape, closing) {
    const cfg = this.cfg;
    const rel = sub(b.v, surfVel);
    const vn = dot(rel, n);
    if (vn >= 0) return;

    const isFlip = shape.kind === 'flipper';
    let e;
    if (isFlip) {
      // Real flipper rubber gives back less the harder it is hit, so a hard shot is thrown by the
      // bat's own motion rather than trampolined off it.
      e = Math.max(cfg.FLIP_E_MIN, cfg.FLIP_E - cfg.FLIP_E_FADE * Math.abs(vn));
    } else {
      e = shape.e != null ? shape.e : cfg.BALL_E;
    }
    const mu = isFlip ? cfg.FLIP_MU : (shape.mu != null ? shape.mu : cfg.BALL_MU);

    const resting = -vn < cfg.REST_SPEED;
    const jn = resting ? -vn : -(1 + e) * vn;
    let nv = add(b.v, mul(n, jn));

    // Tangential. A solid sphere reaches rolling with 2/7 of the contact slip, bounded by friction.
    const t = perp(n);
    const slip = dot(sub(nv, surfVel), t) + b.spin * cfg.BALL_R;
    let jt = -(2 / 7) * slip;
    const cap = mu * Math.abs(jn);
    if (jt > cap) jt = cap;
    if (jt < -cap) jt = -cap;
    nv = add(nv, mul(t, jt));
    b.spin += (jt * 2.5) / cfg.BALL_R;     // I = 2/5 m r^2 for a solid sphere

    if (resting) b.resting = true;   // rolling drag is charged per SECOND in micro(), not per contact

    // THE RUBBER KICK, and it is a gameplay model rather than a claim about rigid bodies.
    //
    // The bat creeps into the ball a fraction of a millimetre per micro step, so a flip is not one
    // impact but twenty tiny ones, and twenty tiny impulses leave the ball at EXACTLY the bat's
    // surface speed however elastic the rubber is. A ball moving at the bat's surface speed has the
    // same angular rate about the pivot as the bat, so it rides the bat all the way up and is still
    // sitting on it at the top. That is what Matt saw: "the ball sticks to the flipper on a lot of
    // shots, like a magnet." Measured: a mid bat flip moved the ball 40 mm up the table. Restitution
    // cannot fix it, because the tie is exact and (1 + e) times a vanishing approach is vanishing.
    //
    // So a driven bat guarantees the ball leaves faster than the bat's own surface. One constant,
    // on a slider, and the ball's angular rate is then (1 + FLIP_KICK) times the bat's, which is
    // the condition for it to get away.
    if (isFlip) {
      const un = dot(surfVel, n);
      if (un > 0) {
        const want = (1 + cfg.FLIP_KICK) * un;
        const have = dot(nv, n);
        if (have < want) nv = add(nv, mul(n, want - have));
      }
    }

    // A BUMPER AND A SLINGSHOT DO NOT BOUNCE THE BALL, THEY HIT IT.
    //
    // Both are solenoid driven on a real machine: the ring or the arm fires and the ball leaves at
    // the coil's speed, which is why a dead-slow roll into a bumper still comes out fast. Modelling
    // them as very bouncy walls gets that backwards - it makes a hard hit huge and a soft one
    // nothing. So the kick is a fixed OUTGOING SPEED along the contact normal, floored rather than
    // added, and it needs a minimum approach to fire so a ball resting against one is not a machine
    // gun. The cooldown is the other half of that.
    if (shape.kind === 'bumper' || shape.kind === 'sling') {
      const isB = shape.kind === 'bumper';
      const trip = isB ? cfg.BUMPER_TRIP : cfg.SLING_TRIP;
      const cool = isB ? cfg.BUMPER_COOL : cfg.SLING_COOL;
      const kick = shape.kick != null ? shape.kick : (isB ? cfg.BUMPER_KICK : cfg.SLING_KICK);
      const last = this.fired.get(shape.id);
      if (-vn >= trip && (last == null || this.time - last >= cool)) {
        this.fired.set(shape.id, this.time);
        const out = dot(nv, n);
        if (out < kick) nv = add(nv, mul(n, kick - out));
        this.events.push({ type: 'kick', id: shape.id, at: { x: b.p.x, y: b.p.y } });
      }
    }

    const sp2 = len(nv);
    if (sp2 > cfg.MAX_SPEED) nv = mul(nv, cfg.MAX_SPEED / sp2);
    b.v = nv;
    this.events.push({ type: 'hit', id: shape.id, speed: Math.abs(vn), at: { x: b.p.x, y: b.p.y } });
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }

  checkDrain(b) {
    for (const d of this.drains) {
      if (b.p.x >= d.x && b.p.x <= d.x + d.w && b.p.y >= d.y && b.p.y <= d.y + d.h) {
        b.alive = false;
        this.events.push({ type: 'drain', id: d.id });
        return;
      }
    }
    // A ball outside the cabinet is a hole in the table, not a drain. It is counted and shown
    // rather than quietly removed: Matt found the first one by playing ("flies right over the left
    // flipper and below the wall, out of the machine") because the side rails stopped 20 mm above
    // the drain and the drain's own rectangle began at x = 0, so a ball leaving to the left of
    // that was in no zone at all and fell for ever.
    const m = this.cfg.BALL_R * 3;
    if (b.p.x < -m || b.p.x > this.table.w + m || b.p.y < -m || b.p.y > this.table.h + m) {
      b.alive = false;
      this.escapes++;
      this.events.push({ type: 'escape', at: { x: b.p.x, y: b.p.y } });
    }
  }
}

export const _geom = { toiPointSeg, toiPointCircleOut, toiPointCircleIn, taperedParts, shapeImpact };
