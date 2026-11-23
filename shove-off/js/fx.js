// shove-off/js/fx.js - Shove Off's garnish (2026-11-23, Matt: "Make it as fun as possible (include animations
// and stuff)"): particles (impact bursts, splashes, dust, crumbs, confetti), screen shake, and the impact list read
// from a round's frames. DRAWING ONLY: Math.random and trig are fine here, NEVER in engine.js (both phones replay
// the engine bit for bit; nothing here feeds back into it). No sound, ever (root CLAUDE.md).
//
// Reduced motion (docs/BUILDING-A-GAME.md, Part 0): the slide IS the game and keeps moving; everything in this
// file is garnish, so `reduced()` turns it off (no particles, no shake, no confetti).

export function reduced() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const CONFETTI = ['#F2B705', '#1F5FA8', '#E0532F', '#178A7A', '#ffffff', '#ffce3a'];
const MAX = 420;                                  // never more than this many alive (a weak phone stays smooth)

/** A pool of short-lived particles in canvas px. `step(now)` ages them, `draw(ctx, now)` paints them. */
export class Particles {
  constructor() { this.list = []; this.last = 0; }
  get busy() { return this.list.length > 0; }
  clear() { this.list.length = 0; }
  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    p.t0 = p.t0 || performance.now();
    this.list.push(p);
  }
  draw(ctx, now = performance.now()) {
    const dt = Math.min(0.05, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    const keep = [];
    for (const p of this.list) {
      const age = (now - p.t0) / p.life;
      if (age >= 1 || age < -3) continue;               // done (or a clock that jumped back: dropped)
      if (age < 0) { keep.push(p); continue; }          // not started yet (a staggered spray)
      keep.push(p);
      if (p.vx != null) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.g) p.vy += p.g * dt;
        if (p.drag) { const k = Math.pow(p.drag, dt * 60); p.vx *= k; p.vy *= k; }
        if (p.vr) p.rot += p.vr * dt;
      }
      paint(ctx, p, age);
    }
    this.list = keep;
  }
}

function paint(ctx, p, age) {
  ctx.save();
  const fade = p.fade === false ? 1 : 1 - age;
  ctx.globalAlpha = Math.max(0, Math.min(1, fade * (p.a == null ? 1 : p.a)));
  switch (p.type) {
    case 'dot': {
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * (p.shrink ? 1 - age * 0.7 : 1)), 0, TAU); ctx.fill();
      break;
    }
    case 'puff': {
      const r = p.r * (0.5 + age * 1.1);
      ctx.globalAlpha *= 0.4;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      break;
    }
    case 'ring': {
      const r = p.r * (0.4 + easeOut(age) * (p.grow || 1.6));
      ctx.strokeStyle = p.c;
      ctx.lineWidth = Math.max(1, p.w * (1 - age));
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      break;
    }
    case 'star': {
      // a comic impact burst: spikes that shoot out and thin away
      const n = p.n || 8;
      ctx.globalAlpha *= (1 - age);                      // a burst snaps out: gone fast
      const r0 = p.r * (0.25 + age * 0.25), r1 = p.r * (0.7 + easeOut(age) * 0.5);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = p.rot + (i / (n * 2)) * TAU;
        const rr = i % 2 ? r0 : r1 * (i % 4 === 0 ? 1 : 0.72);
        const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(110,55,0,0.55)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha *= 0.9;
      ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 0.9, 0, TAU); ctx.fill();
      break;
    }
    case 'streak': {
      // a speed line flying out of an impact
      ctx.strokeStyle = p.c; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, p.w * (1 - age));
      const l = p.len * (1 - age * 0.5);
      const ux = Math.cos(p.rot), uy = Math.sin(p.rot);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - ux * l, p.y - uy * l); ctx.stroke();
      break;
    }
    case 'confetti': {
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 1.7 + p.ph));            // the flutter: a strip turning over
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
      break;
    }
    default: break;
  }
  ctx.restore();
}
function easeOut(k) { return 1 - (1 - k) * (1 - k); }

/** Two pieces hit: a burst (white + yellow, sized by how hard), speed lines, a ring. `s` 0..1 = strength. */
export function impact(P, x, y, s, r) {
  const big = s > 0.45;
  P.add({ type: 'star', x, y, r: r * (0.75 + s * 0.85), c: big ? '#ffd23f' : '#fff1a8', n: big ? 9 : 7, rot: rnd(0, TAU), life: 150 + s * 90 });
  if (big) P.add({ type: 'ring', x, y, r: r * 0.9, w: Math.max(2, r * 0.18), c: 'rgba(255,255,255,0.9)', grow: 1.4 + s, life: 340 });
  const n = 3 + Math.round(s * 7);
  for (let i = 0; i < n; i++) {
    const a = rnd(0, TAU), sp = r * rnd(6, 14) * (0.5 + s);
    P.add({ type: 'streak', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: a, len: r * rnd(0.4, 0.9), w: Math.max(1.5, r * 0.1), c: i % 2 ? '#ffffff' : '#ffce3a', drag: 0.86, life: rnd(200, 360) });
  }
}

/** Puffs kicked up behind a piece as it launches (`ux, uy` = its direction, unit). */
export function launchPuff(P, kind, x, y, r, ux, uy, s) {
  const c = kind === 'car' ? 'rgba(255,255,255,0.75)' : kind === 'sumo' ? 'rgba(236,210,160,0.9)' : 'rgba(205,220,240,0.8)';
  const n = 2 + Math.round(s * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(-uy, -ux) + rnd(-0.7, 0.7), sp = r * rnd(1.5, 4);
    P.add({ type: 'puff', x: x - ux * r * 0.8, y: y - uy * r * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: r * rnd(0.25, 0.45), c, drag: 0.9, life: rnd(300, 480) });
  }
}

/** A piece went over the edge: water for the bumper cars, a cloud of clay dust off the dohyo, chips and a thud
 *  ring off the air table. (`vx, vy` = its drift in px a second, so the spray follows it.) */
export function splash(P, kind, x, y, r, vx = 0, vy = 0) {
  if (kind === 'car') {
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, TAU), sp = r * rnd(3, 9);
      P.add({ type: 'dot', x, y, vx: Math.cos(a) * sp + vx * 0.25, vy: Math.sin(a) * sp - r * rnd(2, 6) + vy * 0.25, g: r * 26, r: r * rnd(0.08, 0.2), c: i % 3 ? '#e8f6ff' : '#9fd2f5', shrink: true, life: rnd(500, 820) });
    }
    P.add({ type: 'ring', x, y, r: r * 0.9, w: Math.max(2, r * 0.16), c: 'rgba(255,255,255,0.85)', grow: 2.2, life: 700 });
    P.add({ type: 'ring', x, y, r: r * 0.6, w: Math.max(1.5, r * 0.12), c: 'rgba(200,235,255,0.7)', grow: 3.2, life: 1000, t0: performance.now() + 140 });
  } else if (kind === 'sumo') {
    for (let i = 0; i < 9; i++) {
      const a = rnd(0, TAU), sp = r * rnd(1, 4);
      P.add({ type: 'puff', x, y, vx: Math.cos(a) * sp + vx * 0.2, vy: Math.sin(a) * sp + vy * 0.2, r: r * rnd(0.45, 0.85), c: i % 2 ? 'rgba(231,204,150,0.95)' : 'rgba(190,150,95,0.9)', drag: 0.9, life: rnd(600, 950) });
    }
    for (let i = 0; i < 8; i++) {
      const a = rnd(0, TAU), sp = r * rnd(3, 8);
      P.add({ type: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - r * 3, g: r * 22, r: r * rnd(0.06, 0.13), c: '#7d5a2c', life: rnd(400, 700) });
    }
  } else {
    P.add({ type: 'ring', x, y, r: r * 0.8, w: Math.max(2, r * 0.2), c: 'rgba(255,255,255,0.8)', grow: 1.8, life: 520 });
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, TAU), sp = r * rnd(4, 10);
      P.add({ type: 'streak', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: a, len: r * rnd(0.3, 0.7), w: Math.max(1.5, r * 0.1), c: i % 2 ? '#ffffff' : '#9fb7d8', drag: 0.88, life: rnd(260, 480) });
    }
  }
}

/** The platform shrinks: crumbs break off the old edge (`rad` px) and fall away outward. */
export function crumble(P, kind, cx, cy, rad, r) {
  const c = kind === 'car' ? ['#f2b705', '#1b1f27'] : kind === 'sumo' ? ['#e3cf8f', '#ad8047'] : ['#8a98ab', '#dde6ef'];
  const n = Math.min(46, Math.round(rad / 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(-0.05, 0.05), sp = r * rnd(0.8, 2.6);
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    P.add({ type: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: r * rnd(0.08, 0.18), c: c[i % 2], shrink: true, drag: 0.94, life: rnd(500, 900), t0: performance.now() + rnd(0, 260) });
  }
}

/** A burst of confetti from the top of a `W` x `H` canvas (a win). */
export function confetti(P, W, H, n = 140) {
  const now = performance.now();
  for (let i = 0; i < n; i++) {
    const fromLeft = i % 2 === 0;
    const x = fromLeft ? rnd(-10, W * 0.2) : rnd(W * 0.8, W + 10);
    const a = fromLeft ? rnd(-1.35, -0.75) : rnd(-2.4, -1.8);
    const sp = rnd(H * 0.5, H * 1.05);
    P.add({ type: 'confetti', x, y: H * rnd(0.55, 0.85), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: H * 0.95, drag: 0.965,
      r: rnd(4, 7), rot: rnd(0, TAU), vr: rnd(-9, 9), ph: rnd(0, TAU), c: CONFETTI[i % CONFETTI.length], fade: false, life: rnd(2200, 3200), t0: now + rnd(0, 220) });
  }
}

/** Screen shake: `kick(px)` adds a jolt that dies away in ~0.4 s; `offset()` = this frame's [dx, dy]. */
export class Shake {
  constructor() { this.amp = 0; this.t0 = 0; }
  kick(px) {
    const now = performance.now();
    const left = this.level(now);
    this.amp = Math.min(12, Math.max(left, px)); this.t0 = now;
  }
  level(now) { const k = (now - this.t0) / 420; return k >= 1 || k < 0 ? 0 : this.amp * (1 - k) * (1 - k); }
  get busy() { return this.level(performance.now()) > 0.2; }
  offset(now = performance.now()) {
    const a = this.level(now);
    if (a <= 0.2) return [0, 0];
    return [Math.sin(now * 0.09) * a, Math.cos(now * 0.113) * a * 0.8];
  }
}

/**
 * The hits in a round's frames (drawing only): each first touch of two pieces, with where (world units), the
 * frame it happened and how hard (0..1 against the hardest possible shove). `before` = the round's pieces,
 * `frames[k]` = [x0, y0, x1, y1, ...] after step k; `falls` / `fallAt` say when a piece stopped counting.
 */
export function findHits(before, frames, falls, fallAt, R, maxSpeed) {
  const n = before.length;
  const gone = new Array(n).fill(Infinity);
  falls.forEach((k, i) => { gone[k] = fallAt[i]; });
  const out = [];
  const touch = new Set();
  const D = 2 * R + 1.5, D2 = D * D;
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k], pf = k > 0 ? frames[k - 1] : null;
    for (let i = 0; i < n; i++) {
      if (!before[i].alive || k > gone[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!before[j].alive || k > gone[j]) continue;
        const dx = f[j * 2] - f[i * 2], dy = f[j * 2 + 1] - f[i * 2 + 1];
        const key = i * 64 + j;
        if (dx * dx + dy * dy <= D2) {
          if (touch.has(key)) continue;
          touch.add(key);
          // how hard: the change in the two pieces' speeds across the hit
          let s = 0;
          if (pf && k + 1 < frames.length) {
            const nf = frames[k + 1];
            const sp = (a) => Math.hypot(nf[a * 2] - f[a * 2] - (f[a * 2] - pf[a * 2]), nf[a * 2 + 1] - f[a * 2 + 1] - (f[a * 2 + 1] - pf[a * 2 + 1]));
            s = Math.min(1, (sp(i) + sp(j)) / (maxSpeed * 1.2));
          }
          out.push({ k, i, j, x: (f[i * 2] + f[j * 2]) / 2, y: (f[i * 2 + 1] + f[j * 2 + 1]) / 2, s, ang: Math.atan2(dy, dx) });
        } else touch.delete(key);
      }
    }
  }
  return out;
}
