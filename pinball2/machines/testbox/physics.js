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

  if (sh.kind === 'seg') {
    const { flanks, circles } = taperedParts(sh.a, sh.r + br, sh.b, sh.r + br);
    for (const f of flanks) take(toiPointSeg(p, v, f.A, f.B, tmax));
    for (const c of circles) take(toiPointCircleOut(p, v, c.c, c.R, tmax));
  } else if (sh.kind === 'circle') {
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
    this.statics = table.shapes.filter((s) => s.kind === 'seg' || s.kind === 'arc' || s.kind === 'circle');
    this.drains = table.shapes.filter((s) => s.kind === 'drain');
    this.events = [];
    this.jams = 0;                 // contacts budget exhausted: a diagnostic, never a silent fix
    this.time = 0;
  }

  addBall(p, v) {
    const b = { p: { x: p.x, y: p.y }, v: { x: (v && v.x) || 0, y: (v && v.y) || 0 }, spin: 0, alive: true, resting: false };
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

      // A driven bat can arrive where the ball already is. Let the ball out along the bat's own
      // normal and give it the bat's surface velocity. Never a velocity from the correction.
      for (const f of this.flippers) {
        const pen = penetration(f.def, b.p, cfg.BALL_R, f);
        if (!pen) continue;
        b.p = add(b.p, mul(pen.n, pen.depth + cfg.SKIN));
        const u = f.surfaceVel(pen.at);
        const vn = dot(sub(b.v, u), pen.n);
        if (vn < 0) this.resolve(b, pen.n, u, f.def, -vn);
      }

      let left = h;
      let events = 0;
      b.resting = false;
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
        this.resolve(b, hit.n, u, hit.shape, closing);
        if (hit.flipper) {
          if (hit.flipper.held && closing < cfg.REST_SPEED) {
            const k = Math.max(0, 1 - cfg.CRADLE_DAMP * hit.t);
            b.v = mul(b.v, k);                    // a held bat lets the ball settle, so it can be aimed
          }
        }
        left -= hit.t;
        events++;
      }
      if (events >= cfg.MAX_EVENTS) this.jams++;

      // Rolling resistance, charged by time. Per contact it would depend on how often the ball
      // happened to touch, which is a solver detail and not something a player can feel.
      if (b.resting) {
        const sp = len(b.v);
        if (sp > EPS) {
          const drop = Math.min(sp, cfg.ROLL_DECEL * h);
          b.v = mul(b.v, (sp - drop) / sp);
        }
      }

      this.checkDrain(b);
    }
  }

  firstImpact(b, tmax) {
    const br = this.cfg.BALL_R;
    let best = null;
    for (const s of this.statics) {
      const r = shapeImpact(s, b.p, b.v, br, tmax);
      if (r && (!best || r.t < best.t)) best = r;
    }
    for (const f of this.flippers) {
      const r = f.impact(b.p, b.v, br, tmax);
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
      e = Math.max(0.05, cfg.FLIP_E - cfg.FLIP_E_FADE * Math.abs(vn));
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
  }
}

export const _geom = { toiPointSeg, toiPointCircleOut, toiPointCircleIn, taperedParts, shapeImpact };
