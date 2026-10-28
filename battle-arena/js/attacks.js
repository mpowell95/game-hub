// battle-arena/js/attacks.js - every monster's OWN special attack, and the evolution scene
// (2026-10-28, Matt: "every attack looks the same: an energy ball... This is where the game must stand
// out"; the mockup he signed off: Emberkit's fire pillar, Zapup's lightning, Gloomite's shadow maw).
//
// Pure presentation: nothing here reads or writes game state or storage. `ui.js` calls `playAttack`
// right after a special's banner and `evolveScene` for an evolve event; both resolve when the picture
// is done (the HP drop, shields, heals that follow are still the engine's own events in ui.js).
// An evolved monster plays the SAME attack, bigger (`k`), with something extra on top.
//
// Coordinates are relative to `.ba-battle` (the same box `ui.centre()` measures in). Particles are
// drawn on ONE canvas in the effects layer, made on first use; its loop runs only while something is
// flying and stops by itself, so nothing is left running after a screen change or destroy().
import { ELEMENT_COLOR, BY_ID } from './monsters.js';
import { monsterSVG } from './art.js';

const ME = 0;
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const rand = (a, b) => a + Math.random() * (b - a);
const done = (a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve());

const FIRE = ['#ffd23a', '#ff8a1f', '#e0532f', '#fff1a8'];
const WATER = ['#5fb6ff', '#1F5FA8', '#cfeeff', '#ffffff'];
const ZAP = ['#ffe45a', '#bfe3ff', '#ffffff', '#f2b705'];
const LEAF = ['#2E9E44', '#7ed957', '#c8f5a0', '#fff3a0'];
const GLOOM = ['#7b4fc4', '#a77bff', '#d9c2ff', '#4a2a8a'];
const ROCK = ['#8a6a50', '#b8956f', '#5a4434', '#6e5440'];
const ICE = ['#bfe6ff', '#ffffff', '#7fc8ff', '#e8f6ff'];
const RAINBOW = ['#E0532F', '#F2B705', '#2E9E44', '#1F5FA8', '#7B4FC4', '#ffffff'];

// --- the particle canvas ---------------------------------------------------------------------------
class Sparks {
  constructor(host) {
    this.host = host;
    this.p = [];
    this.bolts = [];
    this.cv = null;
    this.running = false;
  }
  canvas() {
    const layer = this.host.fxLayer();
    if (!layer) return null;
    if (!this.cv || !this.cv.isConnected) {
      this.cv = document.createElement('canvas');
      this.cv.className = 'ba-sparks';
      layer.prepend(this.cv);
    }
    const w = layer.clientWidth, h = layer.clientHeight, d = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(w * d) || this.cv.height !== Math.round(h * d)) {
      this.cv.width = Math.round(w * d); this.cv.height = Math.round(h * d);
      this.ctx = this.cv.getContext('2d');
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    this.w = w; this.h = h;
    return this.cv;
  }
  /** n particles at (x, y). o: {ang, spread, sp:[a,b], life:[a,b], r:[a,b], c:[...], g, drag, jx, jy, to, shape} */
  emit(n, x, y, o) {
    if (!this.canvas()) return;
    for (let i = 0; i < n; i++) {
      const a = o.ang != null ? o.ang + rand(-(o.spread || 0), o.spread || 0) : rand(0, Math.PI * 2);
      const sp = rand(o.sp[0], o.sp[1]);
      this.p.push({
        x: x + rand(-(o.jx || 0), o.jx || 0), y: y + rand(-(o.jy || 0), o.jy || 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: rand(o.life[0], o.life[1]), r: rand(o.r[0], o.r[1]), c: o.c[(Math.random() * o.c.length) | 0],
        g: o.g || 0, drag: o.drag == null ? 0.98 : o.drag, to: o.to || null, shape: o.shape || 'dot', rot: rand(0, 6.3), vr: rand(-0.2, 0.2),
      });
    }
    this.run();
  }
  /** A jagged lightning bolt from a to b, redrawn every frame until `ms` is up. */
  bolt(a, b, ms, j = 18, width = 1) {
    if (!this.canvas()) return;
    this.bolts.push({ a, b, until: performance.now() + ms, j, w: width });
    this.run();
  }
  run() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const frame = (now) => {
      const cv = this.cv;
      if (!cv || !cv.isConnected || this.host.disposed) { this.running = false; this.p = []; this.bolts = []; return; }
      const dt = Math.min(48, now - last) / 16.7;
      last = now;
      const cx = this.ctx;
      cx.clearRect(0, 0, this.w, this.h);
      this.p = this.p.filter((p) => {
        p.life += dt * 16.7;
        if (p.to) {
          const dx = p.to.x - p.x, dy = p.to.y - p.y;
          p.vx += dx * 0.012 * dt; p.vy += dy * 0.012 * dt; p.vx *= 0.9; p.vy *= 0.9;
          if (dx * dx + dy * dy < 80) return false;
        }
        const drag = Math.pow(p.drag, dt);
        p.vx *= drag; p.vy = p.vy * drag + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const k = 1 - p.life / p.max;
        if (k <= 0) return false;
        cx.globalAlpha = Math.min(1, k * 1.4);
        if (p.shape === 'spark') {
          cx.globalCompositeOperation = 'lighter';
          cx.strokeStyle = p.c; cx.lineWidth = Math.max(0.5, p.r * k); cx.lineCap = 'round';
          cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); cx.stroke();
        } else if (p.shape === 'rock' || p.shape === 'leaf' || p.shape === 'shard') {
          // Solid bits: they have weight, so they are not drawn as light.
          cx.globalCompositeOperation = 'source-over';
          cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c; cx.strokeStyle = 'rgba(0,0,0,.45)'; cx.lineWidth = 1.5;
          cx.beginPath();
          if (p.shape === 'rock') { cx.moveTo(-p.r, -p.r * 0.4); cx.lineTo(-p.r * 0.2, -p.r); cx.lineTo(p.r, -p.r * 0.3); cx.lineTo(p.r * 0.6, p.r); cx.lineTo(-p.r * 0.7, p.r * 0.7); }
          else if (p.shape === 'leaf') cx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, 7);
          else { cx.moveTo(0, -p.r * 1.4); cx.lineTo(p.r * 0.5, 0); cx.lineTo(0, p.r * 1.4); cx.lineTo(-p.r * 0.5, 0); }
          cx.closePath(); cx.fill(); cx.stroke(); cx.restore();
        } else if (p.shape === 'smoke') {
          cx.globalCompositeOperation = 'source-over';
          cx.globalAlpha = Math.min(0.55, k * 0.7);
          const r = p.r * (1.6 - k * 0.6);
          const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(0,0,0,0)');
          cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fill();
        } else {
          cx.globalCompositeOperation = 'lighter';
          const r = p.r * (0.4 + k);
          const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, '#fff'); g.addColorStop(0.3, p.c); g.addColorStop(1, 'rgba(0,0,0,0)');
          cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fill();
        }
        return true;
      });
      const t = performance.now();
      this.bolts = this.bolts.filter((b) => {
        if (t > b.until) return false;
        const n = 9, pts = [[b.a.x, b.a.y]];
        for (let i = 1; i < n; i++) pts.push([b.a.x + (b.b.x - b.a.x) * i / n + rand(-b.j, b.j), b.a.y + (b.b.y - b.a.y) * i / n + rand(-b.j / 2, b.j / 2)]);
        pts.push([b.b.x, b.b.y]);
        cx.globalCompositeOperation = 'lighter';
        for (const [w, c, a] of [[14, '#4aa3ff', 0.35], [7, '#bfe3ff', 0.8], [2.5, '#ffffff', 1]]) {
          cx.globalAlpha = a; cx.strokeStyle = c; cx.lineWidth = w * b.w; cx.lineJoin = 'round';
          cx.beginPath(); pts.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.stroke();
        }
        return true;
      });
      cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
      if (this.p.length || this.bolts.length) requestAnimationFrame(frame);
      else { this.running = false; cx.clearRect(0, 0, this.w, this.h); }
    };
    requestAnimationFrame(frame);
  }
}

// --- the stage, as an attack sees it ---------------------------------------------------------------
class Stage {
  constructor(host, sd, mi, id) {
    this.host = host;
    this.id = id;
    this.gen = host.gen;
    this.sd = sd;
    this.mi = mi;
    this.foe = 1 - sd;
    this.dir = sd === ME ? -1 : 1;            // the way the other team is (ME stands on the right)
    if (!host._sparks) host._sparks = new Sparks(host);
    this.sp = host._sparks;
  }
  get alive() { return this.gen === this.host.gen && !this.host.disposed; }
  sleep(ms) { return this.host.sleep(ms); }
  art(sd, mi) { const m = this.host.monEl(sd, mi); return m && m.querySelector('.ba-mon-art'); }
  at(sd, mi) { return this.host.centre(this.art(sd, mi)); }
  get me() { return this.at(this.sd, this.mi); }
  get size() { return this.host.artSize(); }
  /** The other team: front first (it is the nearer one). */
  get foes() { return [this.at(this.foe, 1), this.at(this.foe, 0)]; }
  get W() { const l = this.host.fxLayer(); return l ? l.clientWidth : 390; }
  get H() { const l = this.host.fxLayer(); return l ? l.clientHeight : 700; }
  /** The floor line under a monster. */
  feet(p) { return p.y + this.size * 0.42; }
  emit(n, p, o) { this.sp.emit(n, p.x, p.y, o); }
  bolt(a, b, ms, j, w) { this.sp.bolt(a, b, ms, j, w); }
  el(cls, html = '', at = null) { return this.host.fx(cls, html, at); }

  shake(amp, ms = 420) {
    const el = this.host.root.querySelector('.ba-battle');
    if (!el) return;
    el.animate(Array.from({ length: 9 }, (_, i) => ({ transform: i === 8 ? 'none' : `translate(${rand(-amp, amp)}px, ${rand(-amp, amp)}px)` })), { duration: ms });
  }
  flash(color, ms = 260, peak = 0.6) {
    const f = this.el('ba-aflash');
    if (!f) return Promise.resolve();
    f.style.background = color;
    return done(f.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'ease-out' })).then(() => f.remove());
  }
  /** Darken (or colour) the arena BEHIND the monsters: the tint sits at the back of the field. */
  tint(bg, ms = 300) {
    const field = this.host.root.querySelector('.ba-field');
    if (!field) return;
    let t = field.querySelector('.ba-tint');
    if (!t) { t = document.createElement('div'); t.className = 'ba-tint'; field.prepend(t); }
    t.style.background = bg;
    t.animate([{ opacity: getComputedStyle(t).opacity }, { opacity: 1 }], { duration: ms, fill: 'forwards' });
  }
  untint(ms = 400) {
    const t = this.host.root.querySelector('.ba-tint');
    if (!t) return Promise.resolve();
    return done(t.animate([{ opacity: getComputedStyle(t).opacity }, { opacity: 0 }], { duration: ms, fill: 'forwards' })).then(() => t.remove());
  }
  /** The other team recoils and flickers (each hit of a multi-hit; the damage event adds the last). */
  jolt(color = '#fff') {
    for (const mi of [0, 1]) {
      const a = this.art(this.foe, mi);
      if (!a) continue;
      a.animate([{ transform: 'none', filter: 'none' }, { transform: `translateX(${-this.dir * 10}px) rotate(${-this.dir * 7}deg)`, filter: `brightness(2.6) drop-shadow(0 0 10px ${color})`, offset: 0.2 },
        { transform: 'none', filter: 'none' }], { duration: 380, easing: 'ease-out' });
    }
  }
  /** Move the attacker's picture along a path of points (offsets from home, px). */
  move(frames, ms, easing = 'ease-in-out') {
    const a = this.art(this.sd, this.mi);
    if (!a) return Promise.resolve();
    return done(a.animate(frames.map((f) => ({ transform: `translate(${f[0]}px, ${f[1]}px) rotate(${f[2] || 0}deg) scale(${f[3] || 1})` })), { duration: ms, easing, fill: 'forwards' }));
  }
  home() {
    const a = this.art(this.sd, this.mi);
    if (a) for (const x of a.getAnimations()) x.cancel();
  }
  /** A ring that grows from a point. */
  ring(p, color, size = 64, ms = 480, scale = 2.4) {
    const r = this.el('ba-ring', '', p);
    if (!r) return;
    r.style.setProperty('--c', color);
    r.style.width = r.style.height = size + 'px';
    done(r.animate([{ transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 }, { transform: `translate(-50%, -50%) scale(${scale})`, opacity: 0 }], { duration: ms, easing: 'ease-out' })).then(() => r.remove());
  }
  /** A straight beam from a to b (water jet, prism ray): a div rotated onto the line. */
  beam(a, b, cls, thick, ms) {
    const d = this.el('ba-abeam ' + cls, '<i></i>', a);
    if (!d) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    d.style.width = len + 'px';
    d.style.height = thick + 'px';
    d.style.transform = `translate(0, -50%) rotate(${ang}deg)`;
    d.animate([{ transform: `translate(0, -50%) rotate(${ang}deg) scaleX(0)` }, { transform: `translate(0, -50%) rotate(${ang}deg) scaleX(1)` }], { duration: Math.min(220, ms / 3), easing: 'ease-out', fill: 'backwards' });
    done(d.animate([{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: ms })).then(() => d.remove());
    return d;
  }
  /** An inline SVG laid over the whole effects layer (vines, sigils, waves). */
  svg(inner, cls = '') {
    return this.el('ba-asvg ' + cls, `<svg viewBox="0 0 ${this.W} ${this.H}" width="100%" height="100%" aria-hidden="true">${inner}</svg>`);
  }
}

// --- the twelve attacks ------------------------------------------------------------------------------
// Each: async (s, k, evo) where k = 1 normal, 1.5 evolved. Resolves at the moment of the LAST impact.

const ATTACKS = {
  /** Flare Pounce / Blaze Pounce: crouch, leap with a fire trail, pillars of fire under the other team. */
  async emberkit(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.emit(Math.round(24 * k), { x: me.x, y: s.feet(me) }, { ang: -Math.PI / 2, spread: 0.6, sp: [1, 3.5], life: [400, 700], r: [4, 9], c: FIRE, jx: s.size * 0.35, g: -0.05 });
    await s.move([[0, 0], [0, s.size * 0.1, 0, 0.9]], 280, 'ease-in');
    const dx = front.x - me.x - s.dir * s.size * 0.45, dy = front.y - me.y;
    const trail = setInterval(() => { if (s.alive) { const p = s.at(s.sd, s.mi); s.emit(4, p, { sp: [0.2, 1.2], life: [300, 600], r: [6, 12], c: FIRE, g: -0.04 }); } }, 20);
    await s.move([[0, s.size * 0.1], [dx * 0.5, dy - s.size * 0.9, s.dir * 25], [dx, dy, s.dir * 10]], 420, 'cubic-bezier(.3,.1,.6,1)');
    clearInterval(trail);
    if (!s.alive) return;
    s.shake(14 * k, 520);
    s.flash('#ff9a3a', 300, 0.35);
    for (const t of [front, back]) {
      const p = s.el('ba-pillar' + (evo ? ' is-big' : ''), '<i></i><i></i>');
      if (!p) continue;
      const floor = s.feet(t) + s.size * 0.08, w = s.size * (evo ? 1.25 : 0.95), h = s.size * (evo ? 2.6 : 1.9);
      Object.assign(p.style, { left: (t.x - w / 2) + 'px', top: (floor - h) + 'px', width: w + 'px', height: h + 'px' });
      done(p.animate([{ transform: 'scaleY(0) scaleX(.6)', opacity: 1 }, { transform: 'scaleY(1.08) scaleX(1)', opacity: 1, offset: 0.18 }, { transform: 'scaleY(.95) scaleX(1.05)', opacity: 1, offset: 0.4 },
        { transform: 'scaleY(1.05) scaleX(.95)', opacity: 1, offset: 0.6 }, { transform: 'scaleY(1.2) scaleX(.3)', opacity: 0 }], { duration: 900, easing: 'ease-out' })).then(() => p.remove());
      s.emit(Math.round(50 * k), { x: t.x, y: s.feet(t) }, { ang: -Math.PI / 2, spread: 0.45, sp: [4, 11 * k], life: [500, 1000], r: [5, 12], c: FIRE, jx: s.size * 0.3, g: 0.06, drag: 0.97 });
      if (evo) s.ring({ x: t.x, y: s.feet(t) }, '#ff8a1f', s.size * 0.8, 600, 3);
    }
    s.jolt('#ff8a1f');
    await s.sleep(360);
    s.move([[dx, dy, s.dir * 10], [dx * 0.5, -s.size * 0.5, -s.dir * 15], [0, 0]], 400).then(() => s.home());
    s.emit(Math.round(26 * k), { x: s.W * (s.dir < 0 ? 0.3 : 0.7), y: -10 }, { ang: Math.PI / 2, spread: 0.5, sp: [0.5, 1.6], life: [900, 1500], r: [2, 4], c: FIRE, jx: s.W * 0.3 });
    await s.sleep(260);
  },

  /** Heal Leaf / Bramble Mend: vines burst from the floor and whip the other team; petals on our side. */
  async sproutle(s, k, evo) {
    const me = s.me, foes = s.foes;
    s.move([[0, 0], [0, -s.size * 0.12, 0, 1.08], [0, 0]], 380);
    s.emit(Math.round(14 * k), me, { sp: [1, 3], life: [500, 800], r: [5, 8], c: LEAF, shape: 'leaf', g: -0.02 });
    await s.sleep(260);
    const vines = [];
    for (const t of foes) {
      for (let v = 0; v < (evo ? 3 : 2); v++) {
        const side = v % 2 ? 1 : -1, base = s.feet(t) + 6, x0 = t.x + side * s.size * (0.35 + v * 0.12);
        const d = `M${x0} ${base} C${x0 + side * 30} ${base - s.size * 0.6}, ${t.x - side * s.size * 0.7} ${t.y - s.size * 0.2}, ${t.x + side * s.size * 0.15} ${t.y - s.size * (0.5 + v * 0.05)}`;
        vines.push(d);
      }
    }
    const w = s.size * (evo ? 0.15 : 0.11);
    const thorns = evo ? `stroke-dasharray="2 12"` : '';
    const g = s.svg(vines.map((d) => `<path d="${d}" fill="none" stroke="#1d5a28" stroke-width="${w + 5}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
      <path d="${d}" fill="none" stroke="#5fc46a" stroke-width="${w}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
      ${evo ? `<path d="${d}" fill="none" stroke="#c8f5a0" stroke-width="${w + 9}" stroke-linecap="round" ${thorns} opacity="0" class="th"/>` : ''}`).join(''));
    if (!g) return;
    const paths = [...g.querySelectorAll('path:not(.th)')];
    await Promise.all(paths.map((p, i) => done(p.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 330, delay: (i >> 1) * 40, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }))));
    if (!s.alive) { g.remove(); return; }
    for (const th of g.querySelectorAll('.th')) th.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 500 });
    // the lash: the vines snap tight, twice
    for (let n = 0; n < (evo ? 3 : 2); n++) {
      g.animate([{ transform: 'none' }, { transform: `translateX(${-s.dir * 6}px) scaleY(1.02)` }, { transform: 'none' }], { duration: 160 });
      s.jolt('#7ed957');
      s.shake(6 * k, 200);
      for (const t of foes) s.emit(Math.round(10 * k), t, { sp: [2, 6], life: [400, 700], r: [4, 7], c: LEAF, shape: 'leaf', g: 0.12 });
      await s.sleep(180);
    }
    done(g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' })).then(() => g.remove());
    // petals drift over our own team (the heal that follows)
    for (const mi of [0, 1]) { const p = s.at(s.sd, mi); s.emit(Math.round(10 * k), { x: p.x, y: p.y - s.size * 0.8 }, { ang: Math.PI / 2, spread: 0.6, sp: [0.5, 1.5], life: [800, 1200], r: [4, 6], c: ['#ffb3d1', '#ffe1ee', '#c8f5a0'], shape: 'leaf', jx: s.size * 0.4 }); }
  },

  /** Splash / Riptide: a water jet that knocks them back; evolved, a whole wave crosses the stage. */
  async driplet(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    await s.move([[0, 0], [-s.dir * 10, 4, 0, 0.92]], 220, 'ease-in');
    if (evo) {
      // A tidal wave rolls from our side over theirs.
      const top = Math.min(front.y, back.y) - s.size * 0.45, bot = Math.max(s.feet(front), s.feet(back)) + 16, ww = s.W * 0.9, hh = bot - top;
      const X = (u) => ((s.dir < 0 ? 1 - u : u) * ww).toFixed(1), Y = (u) => (top + u * hh).toFixed(1);
      // A curling wave travelling right (mirrored when it travels left): body, lighter face, foam lip.
      const body = `M0 ${Y(1)} L0 ${Y(0.5)} C${X(0.3)} ${Y(0.25)}, ${X(0.55)} ${Y(0)}, ${X(0.76)} ${Y(0.04)} C${X(0.97)} ${Y(0.1)}, ${X(1)} ${Y(0.36)}, ${X(0.89)} ${Y(0.42)} C${X(0.81)} ${Y(0.46)}, ${X(0.77)} ${Y(0.33)}, ${X(0.85)} ${Y(0.3)} C${X(0.8)} ${Y(0.5)}, ${X(0.95)} ${Y(0.85)}, ${X(1)} ${Y(1)} Z`;
      const face = `M${X(0.1)} ${Y(1)} L${X(0.12)} ${Y(0.62)} C${X(0.35)} ${Y(0.42)}, ${X(0.6)} ${Y(0.3)}, ${X(0.78)} ${Y(0.36)} C${X(0.82)} ${Y(0.6)}, ${X(0.9)} ${Y(0.86)}, ${X(0.94)} ${Y(1)} Z`;
      const lip = `M${X(0.05)} ${Y(0.48)} C${X(0.3)} ${Y(0.24)}, ${X(0.55)} ${Y(0.01)}, ${X(0.76)} ${Y(0.05)} C${X(0.96)} ${Y(0.1)}, ${X(0.99)} ${Y(0.35)}, ${X(0.89)} ${Y(0.41)}`;
      const wave = s.svg(`<g class="wv"><path d="${body}" fill="#1f5fa8" opacity=".9"/><path d="${face}" fill="#4aa3ff" opacity=".7"/>
        <path d="${lip}" fill="none" stroke="#e8f6ff" stroke-width="${(s.size * 0.12).toFixed(1)}" stroke-linecap="round" stroke-dasharray="1 ${(s.size * 0.16).toFixed(1)}"/>
        <path d="${lip}" fill="none" stroke="#cfeeff" stroke-width="4" stroke-linecap="round"/></g>`);
      if (wave) {
        const from = s.dir < 0 ? s.W : -ww, to = s.dir < 0 ? -ww : s.W;
        const a = wave.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: 1100, easing: 'cubic-bezier(.35,.1,.5,1)' });
        const spray = setInterval(() => { if (s.alive) s.emit(6, { x: rand(0, s.W), y: top + 20 }, { ang: -Math.PI / 2, spread: 0.8, sp: [2, 5], life: [400, 700], r: [3, 6], c: WATER, g: 0.15 }); }, 40);
        await s.sleep(560);
        s.jolt('#5fb6ff'); s.shake(16, 600); s.flash('#9fd8ff', 300, 0.35);
        for (const t of [front, back]) s.emit(40, t, { sp: [3, 9], life: [500, 900], r: [4, 8], c: WATER, g: 0.2, ang: -Math.PI / 2, spread: 1.2 });
        await done(a);
        clearInterval(spray);
        wave.remove();
      }
    } else {
      const from = { x: me.x + s.dir * s.size * 0.3, y: me.y - s.size * 0.05 };
      const b = s.beam(from, front, 'is-water', s.size * 0.5, 900);
      if (b) b.animate([{ height: s.size * 0.42 + 'px' }, { height: s.size * 0.6 + 'px' }, { height: s.size * 0.42 + 'px' }], { duration: 160, iterations: 5 });
      const drip = setInterval(() => { if (s.alive) { const u = Math.random(); s.emit(2, { x: from.x + (front.x - from.x) * u, y: from.y + (front.y - from.y) * u }, { sp: [0.5, 2], life: [400, 600], r: [3, 5], c: WATER, g: 0.2 }); } }, 30);
      await s.sleep(220);
      for (let n = 0; n < 3; n++) {
        s.emit(18, front, { ang: s.dir < 0 ? Math.PI * 1.25 : -Math.PI * 0.25, spread: 0.9, sp: [3, 8], life: [400, 800], r: [3, 7], c: WATER, g: 0.22 });
        s.jolt('#5fb6ff'); s.shake(5, 160);
        await s.sleep(170);
      }
      clearInterval(drip);
      s.ring(front, '#9fd8ff', s.size * 0.6, 480, 2.6);
      s.ring(back, '#9fd8ff', s.size * 0.5, 480, 2.2);
      s.emit(26, back, { sp: [2, 6], life: [400, 800], r: [3, 6], c: WATER, g: 0.2 });
      s.shake(9, 360);
    }
    s.home();
  },

  /** Static Nip / Electroclaw: charge, zip across in a blink, lightning from the sky. */
  async zapup(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.tint('rgba(6, 14, 48, .7)');
    const art = s.art(s.sd, s.mi);
    if (art) art.animate(Array.from({ length: 12 }, (_, i) => ({ transform: i === 11 ? 'none' : `translate(${rand(-4, 4)}px, ${rand(-3, 3)}px)`, filter: i % 2 ? 'brightness(1.8)' : 'none' })), { duration: 600 });
    for (let n = 0; n < 5; n++) {
      const a = rand(0, 6.3), r = s.size * 0.55;
      s.bolt({ x: me.x + Math.cos(a) * r, y: me.y + Math.sin(a) * r }, { x: me.x + Math.cos(a + 1) * r * 0.7, y: me.y + Math.sin(a + 1) * r * 0.7 }, 90, 8, 0.7);
      s.emit(8, me, { sp: [2, 5], life: [200, 400], r: [2, 3], c: ZAP, shape: 'spark', drag: 0.9 });
      await s.sleep(110);
    }
    if (!s.alive) return;
    // zip: afterimages, then gone in a blink to beside them
    const dx = front.x - me.x - s.dir * s.size * 0.7, dy = front.y - me.y;
    for (let i = 1; i <= 4; i++) {
      const g = s.el('ba-ghost', monsterSVG(s.id, evo), { x: me.x + dx * i / 5, y: me.y + dy * i / 5 });
      if (!g) continue;
      g.style.width = g.style.height = s.size + 'px';
      if (s.sd === ME) g.classList.add('is-me');
      done(g.animate([{ opacity: 0.6 - i * 0.1 }, { opacity: 0 }], { duration: 360 })).then(() => g.remove());
    }
    s.emit(24, me, { sp: [3, 8], life: [200, 450], r: [2, 3], c: ZAP, shape: 'spark', drag: 0.88 });
    await s.move([[0, 0], [dx, dy]], 90, 'linear');
    const strikes = evo ? 5 : 3;
    for (let n = 0; n < strikes; n++) {
      const t = n % 2 ? back : front, x = t.x + rand(-s.size * 0.15, s.size * 0.15);
      s.bolt({ x: x + rand(-40, 40), y: -10 }, { x, y: t.y }, 260, 22, k);
      s.bolt({ x: x + rand(-60, 60), y: -10 }, { x, y: t.y }, 160, 30, 0.8);
      s.flash('#dff0ff', 160, 0.4);
      s.shake(9 * k, 240);
      s.emit(Math.round(30 * k), { x, y: t.y }, { sp: [3, 9], life: [250, 550], r: [2, 3.5], c: ZAP, shape: 'spark', drag: 0.9 });
      s.jolt('#bfe3ff');
      await s.sleep(evo ? 200 : 250);
    }
    for (let n = 0; n < 4; n++) {
      for (const t of [front, back]) s.bolt({ x: t.x + rand(-s.size * 0.35, s.size * 0.35), y: t.y + rand(-s.size * 0.3, s.size * 0.3) }, { x: t.x + rand(-s.size * 0.35, s.size * 0.35), y: t.y + rand(-s.size * 0.3, s.size * 0.3) }, 70, 6, 0.6);
      await s.sleep(80);
    }
    s.emit(16, s.at(s.sd, s.mi), { sp: [3, 7], life: [200, 400], r: [2, 3], c: ZAP, shape: 'spark', drag: 0.88 });
    s.home();
    s.untint();
  },

  /** Mind Bite / Night Maw: the room goes dark, a giant shadow mouth snaps shut on them. */
  async gloomite(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.tint('radial-gradient(circle at 50% 60%, rgba(40, 10, 80, .55), rgba(8, 2, 20, .92) 70%)', 400);
    for (let n = 0; n < 7; n++) { s.emit(Math.round(8 * k), { x: rand(0, s.W), y: rand(0, s.H * 0.6) }, { sp: [0, 0.5], life: [700, 900], r: [8, 16], c: GLOOM, to: me }); await s.sleep(55); }
    const art = s.art(s.sd, s.mi);
    if (art) art.animate([{ filter: 'none', transform: 'scale(1)' }, { filter: 'brightness(1.4) drop-shadow(0 0 14px #a77bff)', transform: 'scale(1.12)', offset: 0.3 }, { filter: 'brightness(1.4) drop-shadow(0 0 14px #a77bff)', transform: 'scale(1.12)', offset: 0.8 }, { filter: 'none', transform: 'scale(1)' }], { duration: 1500 });
    await s.sleep(200);
    if (!s.alive) return;
    const top = Math.min(front.y, back.y) - s.size * 0.75, bot = Math.max(s.feet(front), s.feet(back)) + 10;
    const cx = (front.x + back.x) / 2, wid = Math.abs(front.x - back.x) + s.size * 1.6 * (evo ? 1.15 : 1);
    const m = s.el('ba-maw' + (evo ? ' is-big' : ''), MAW(evo));
    if (!m) return;
    Object.assign(m.style, { left: (cx - wid / 2) + 'px', top: top + 'px', width: wid + 'px', height: (bot - top) + 'px' });
    const up = m.querySelector('.up'), dn = m.querySelector('.dn');
    m.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    const gap = 16 * k;
    for (let bite = 0; bite < (evo ? 2 : 1); bite++) {
      await Promise.all([done(up.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${gap}%)` }], { duration: 420, fill: 'forwards', easing: 'ease-out' })),
        done(dn.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${gap}%)` }], { duration: 420, fill: 'forwards', easing: 'ease-out' }))]);
      await s.sleep(160);
      if (!s.alive) { m.remove(); return; }
      up.animate([{ transform: `translateY(-${gap}%)` }, { transform: 'translateY(2%)' }], { duration: 100, fill: 'forwards', easing: 'ease-in' });
      await done(dn.animate([{ transform: `translateY(${gap}%)` }, { transform: 'translateY(-2%)' }], { duration: 100, fill: 'forwards', easing: 'ease-in' }));
      s.shake(15 * k, 480); s.flash('#c9a2f0', 260, 0.45); s.jolt('#a77bff');
      s.emit(Math.round(44 * k), { x: cx, y: (top + bot) / 2 }, { sp: [2, 7], life: [400, 800], r: [5, 10], c: GLOOM, drag: 0.93, jx: wid * 0.3 });
      await s.sleep(260);
    }
    done(m.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(8px)', transform: 'scale(1.15)' }], { duration: 600, fill: 'forwards' })).then(() => m.remove());
    // what it bit off flows back to Gloomite (the drain that follows)
    for (let n = 0; n < 5; n++) { for (const t of [front, back]) s.emit(3, t, { sp: [1, 3], life: [900, 1200], r: [7, 11], c: ['#d9c2ff', '#a77bff'], to: me }); await s.sleep(60); }
    await s.sleep(300);
    if (art) art.animate([{ filter: 'none' }, { filter: 'brightness(2) drop-shadow(0 0 16px #a77bff)' }, { filter: 'none' }], { duration: 400 });
    s.untint(450);
  },

  /** Rock Toss / Landslide: it jumps out of sight and comes down on them as a boulder (evolved: a rockfall). */
  async pebbleop(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    await s.move([[0, 0], [0, s.size * 0.12, 0, 0.88]], 220, 'ease-in');
    s.emit(16, { x: me.x, y: s.feet(me) }, { ang: -Math.PI / 2, spread: 1.2, sp: [1, 3], life: [400, 700], r: [8, 14], c: ['#8a6a50', '#a68a6a'], shape: 'smoke' });
    await s.move([[0, s.size * 0.12, 0, 0.88], [0, -(me.y + s.size * 1.5)]], 300, 'ease-in');
    if (!s.alive) return;
    const rocks = evo ? [front, back, { x: (front.x + back.x) / 2, y: (front.y + back.y) / 2 }] : [front];
    for (let n = 0; n < rocks.length; n++) {
      const t = rocks[n], sz = s.size * (evo ? 1.0 : 1.15) * (n === 2 ? 0.8 : 1);
      const r = s.el('ba-boulder', BOULDER, { x: t.x, y: -sz });
      if (!r) continue;
      r.style.width = r.style.height = sz + 'px';
      const land = t.y - sz * 0.1;
      await done(r.animate([{ transform: `translate(-50%, -50%) rotate(0)` }, { transform: `translate(-50%, calc(-50% + ${land + sz}px)) rotate(${s.dir * 200}deg)` }], { duration: 360, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'forwards' }));
      s.shake(16 * k, 520); s.flash('#d8c2a0', 200, 0.3); s.jolt('#d8c2a0');
      const hit = { x: t.x, y: land };
      s.emit(Math.round(22 * k), hit, { ang: -Math.PI / 2, spread: 1.3, sp: [3, 9], life: [500, 900], r: [3, 7], c: ROCK, shape: 'rock', g: 0.3, drag: 0.98 });
      s.emit(18, { x: t.x, y: s.feet(t) }, { sp: [1, 3], life: [600, 1000], r: [14, 22], c: ['#7a5e48', '#9c8064'], shape: 'smoke', jx: s.size * 0.4 });
      done(r.animate([{ transform: `translate(-50%, calc(-50% + ${land + sz}px)) rotate(${s.dir * 200}deg)`, opacity: 1 },
        { transform: `translate(calc(-50% + ${s.dir * 30}px), calc(-50% + ${land + sz - 30}px)) rotate(${s.dir * 260}deg) scale(.6)`, opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'forwards' })).then(() => r.remove());
      if (evo) await s.sleep(120);
    }
    // home: drop back in from the top
    await s.move([[0, -(me.y + s.size * 1.5)], [0, 0, 0, 1]], 320, 'cubic-bezier(.5,0,1,.6)');
    s.home();
    s.shake(5, 200);
    s.emit(10, { x: me.x, y: s.feet(me) }, { sp: [1, 3], life: [400, 700], r: [10, 16], c: ['#8a6a50', '#a68a6a'], shape: 'smoke' });
  },

  /** Scorch Row / Firestorm: it takes off and sweeps over them breathing fire (evolved: two passes). */
  async cinderwing(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    const peak = Math.min(front.y, back.y) - s.size * 0.55 - me.y;
    const over = (front.x + back.x) / 2 - me.x;
    await s.move([[0, 0], [s.dir * 20, peak * 0.6, -s.dir * 10, 1.05]], 300, 'ease-out');
    const A = [s.dir * 20, peak * 0.6], B = [over + s.dir * s.size * 1.2, peak * 0.8];
    let at = A;
    for (let pass = 0; pass < (evo ? 2 : 1); pass++) {
      if (!s.alive) return;
      const to = pass % 2 ? A : B;
      const fire = setInterval(() => {
        if (!s.alive) return;
        const p = s.at(s.sd, s.mi);
        s.emit(Math.round(7 * k), { x: p.x + s.dir * s.size * 0.3, y: p.y + s.size * 0.2 }, { ang: Math.PI / 2 + s.dir * 0.35, spread: 0.3, sp: [5, 9], life: [350, 600], r: [6, 12], c: FIRE, drag: 0.94 });
      }, 24);
      await s.move([at, [(at[0] + to[0]) / 2, peak], to], 900, 'ease-in-out');
      clearInterval(fire);
      at = to;
      // the floor under them catches
      for (const t of [front, back]) s.emit(Math.round(30 * k), { x: t.x, y: s.feet(t) }, { ang: -Math.PI / 2, spread: 0.5, sp: [2, 6 * k], life: [500, 900], r: [6, 12], c: FIRE, jx: s.size * 0.5, g: -0.02 });
      s.jolt('#ff8a1f'); s.shake(10 * k, 420); s.flash('#ff8a3a', 260, 0.3);
    }
    s.move([at, [0, 0]], 380).then(() => s.home());
    await s.sleep(220);
  },

  /** Overgrowth / Wild Thicket: a ring of thorns bursts round it and a leaf storm rolls over the board. */
  async thornpaw(s, k, evo) {
    const me = s.me;
    s.move([[0, 0], [0, -s.size * 0.15, 0, 1.15], [0, 0]], 420);
    const n = evo ? 14 : 10, R = s.size * 0.6;
    const spikes = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 360;
      return `<g transform="translate(${me.x} ${me.y}) rotate(${a})"><path d="M${R * 0.45} -${7 * k} L${R * 1.25 * k} 0 L${R * 0.45} ${7 * k} Z" fill="#3f8f3a" stroke="#173d18" stroke-width="2.5" stroke-linejoin="round"/></g>`;
    }).join('');
    const g = s.svg(`<g class="ring">${spikes}</g>`);
    if (g) {
      const ring = g.querySelector('.ring');
      ring.style.transformOrigin = `${me.x}px ${me.y}px`;
      done(ring.animate([{ transform: 'scale(.2) rotate(0)', opacity: 0 }, { transform: 'scale(1.1) rotate(20deg)', opacity: 1, offset: 0.35 }, { transform: 'scale(1) rotate(30deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1.3) rotate(40deg)', opacity: 0 }],
        { duration: 900, easing: 'ease-out' })).then(() => g.remove());
    }
    s.shake(7 * k, 300);
    await s.sleep(300);
    // the leaf storm: from Thornpaw down over the board (the gems it turns into leaves follow)
    const board = s.host.root.querySelector('.ba-board');
    const bc = board ? s.host.centre(board) : { x: s.W / 2, y: s.H * 0.7 };
    for (let i = 0; i < (evo ? 10 : 7); i++) {
      if (!s.alive) return;
      s.emit(Math.round(7 * k), me, { sp: [1, 3], life: [900, 1300], r: [5, 9], c: LEAF, shape: 'leaf', to: { x: bc.x + rand(-s.W * 0.35, s.W * 0.35), y: bc.y + rand(-60, 60) } });
      await s.sleep(70);
    }
    await s.sleep(250);
  },

  /** Ice Shard / Glacielle's: a volley of ice, a frost cloud, then they freeze (evolved: icicles from above). */
  async frostling(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.tint('rgba(150, 210, 255, .25)', 300);
    s.emit(20, me, { sp: [0.5, 2], life: [500, 800], r: [6, 10], c: ICE, to: { x: me.x, y: me.y } });
    await s.move([[0, 0], [-s.dir * 8, 0, 0, 0.94]], 200);
    const shots = evo ? 0 : 6;
    for (let n = 0; n < shots; n++) {
      const t = n % 3 === 2 ? back : front;
      const d = s.el('ba-shard', '', { x: me.x + s.dir * s.size * 0.3, y: me.y + rand(-12, 12) });
      if (!d) continue;
      const dx = t.x - me.x - s.dir * s.size * 0.3 + rand(-14, 14), dy = t.y - me.y + rand(-14, 14), ang = Math.atan2(dy, dx) * 180 / Math.PI;
      done(d.animate([{ transform: `translate(-50%, -50%) rotate(${ang}deg) scale(.5)` }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${ang}deg) scale(1)` }], { duration: 230, easing: 'ease-in' }))
        .then(() => { d.remove(); if (s.alive) { s.emit(8, { x: me.x + s.dir * s.size * 0.3 + dx, y: me.y + dy }, { sp: [2, 5], life: [300, 500], r: [3, 5], c: ICE, shape: 'shard', g: 0.15 }); s.jolt('#bfe6ff'); } });
      await s.sleep(90);
    }
    if (evo) {
      for (let n = 0; n < 6; n++) {
        const t = n % 2 ? back : front, x = t.x + rand(-s.size * 0.4, s.size * 0.4);
        const d = s.el('ba-icicle', '', { x, y: -40 });
        if (!d) continue;
        const land = t.y - s.size * 0.1;
        done(d.animate([{ transform: 'translate(-50%, -50%)' }, { transform: `translate(-50%, calc(-50% + ${land + 40}px))` }], { duration: 280, easing: 'cubic-bezier(.5,0,1,.6)' })).then(() => {
          d.remove();
          if (!s.alive) return;
          s.emit(14, { x, y: land }, { ang: -Math.PI / 2, spread: 1.2, sp: [2, 6], life: [400, 700], r: [3, 6], c: ICE, shape: 'shard', g: 0.25 });
          s.shake(8, 220); s.jolt('#bfe6ff');
        });
        await s.sleep(110);
      }
    }
    await s.sleep(260);
    s.home();
    // frost wraps them, and the ice closes over them
    for (const t of [front, back]) s.emit(Math.round(20 * k), t, { sp: [0.3, 1.2], life: [800, 1200], r: [12, 20], c: ['#dff3ff', '#bfe6ff'], shape: 'smoke', jx: s.size * 0.3 });
    for (const t of [front, back]) {
      const b = s.el('ba-iceblock', '', t);
      if (!b) continue;
      b.style.width = b.style.height = s.size * 1.05 + 'px';
      done(b.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.05)', opacity: 0.9, offset: 0.2 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.85, offset: 0.8 }, { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0 }],
        { duration: 1300, easing: 'ease-out' })).then(() => b.remove());
    }
    s.flash('#e8f6ff', 300, 0.4);
    s.shake(6 * k, 300);
    s.untint(600);
    await s.sleep(250);
  },

  /** Chain Bolt / Thundrake's: the horn charges, lightning jumps from them to each other, then home to the partner. */
  async stormhorn(s, k, evo) {
    const me = s.me, [front, back] = s.foes, partner = s.at(s.sd, 1 - s.mi);
    s.tint('rgba(6, 14, 48, .6)');
    const horn = { x: me.x + s.dir * s.size * 0.2, y: me.y - s.size * 0.4 };
    for (let n = 0; n < 6; n++) { s.emit(Math.round(8 * k), horn, { sp: [2, 5], life: [200, 400], r: [2, 3], c: ZAP, shape: 'spark', drag: 0.85 }); s.emit(4, { x: horn.x + rand(-60, 60), y: horn.y + rand(-60, 60) }, { sp: [0, 0.5], life: [400, 500], r: [4, 7], c: ZAP, to: horn }); await s.sleep(80); }
    s.move([[0, 0], [s.dir * 12, -4, s.dir * 6, 1.06], [0, 0]], 300).then(() => s.home());
    const chain = [horn, front, back, partner];
    for (let pass = 0; pass < (evo ? 2 : 1); pass++) {
      for (let i = 0; i < chain.length - 1; i++) {
        if (!s.alive) return;
        s.bolt(chain[i], chain[i + 1], 300, 20, k);
        s.flash('#dff0ff', 140, 0.3);
        s.emit(Math.round(22 * k), chain[i + 1], { sp: [3, 8], life: [250, 500], r: [2, 3.5], c: ZAP, shape: 'spark', drag: 0.9 });
        if (i < 2) { s.jolt('#bfe3ff'); s.shake(8 * k, 240); }
        await s.sleep(170);
      }
    }
    s.ring(partner, '#ffe45a', s.size * 0.6, 500, 2);
    s.untint();
    await s.sleep(150);
  },

  /** Hex Curse / Grimhoot's: its eyes light, a glowing hex seal turns over them and slams down. */
  async hexowl(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.tint('rgba(18, 4, 36, .78)', 400);
    const art = s.art(s.sd, s.mi);
    if (art) art.animate([{ filter: 'none' }, { filter: 'brightness(1.5) drop-shadow(0 0 16px #c9a2f0)', offset: 0.3 }, { filter: 'brightness(1.5) drop-shadow(0 0 16px #c9a2f0)', offset: 0.85 }, { filter: 'none' }], { duration: 1700 });
    s.emit(16, { x: me.x, y: me.y - s.size * 0.15 }, { sp: [0.5, 2], life: [600, 900], r: [3, 6], c: GLOOM, g: -0.03 });
    await s.sleep(300);
    if (!s.alive) return;
    const cx = (front.x + back.x) / 2, cy = (front.y + back.y) / 2 - s.size * 0.2, R = (Math.abs(front.x - back.x) / 2 + s.size * 0.7);
    const seals = evo ? [1, -1] : [1];
    const nodes = [];
    for (const dirn of seals) {
      const d = s.svg(SIGIL(cx, cy, R * (dirn < 0 ? 0.7 : 1)));
      if (!d) continue;
      const g = d.querySelector('.sig');
      g.style.transformOrigin = `${cx}px ${cy}px`;
      g.animate([{ transform: 'scale(0) rotate(0)', opacity: 0 }, { transform: `scale(1) rotate(${dirn * 120}deg)`, opacity: 1 }], { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
      nodes.push([d, g, dirn]);
    }
    for (let n = 0; n < 8; n++) { s.emit(2, { x: cx + rand(-R, R), y: cy + rand(-R * 0.4, R * 0.4) }, { ang: -Math.PI / 2, spread: 0.3, sp: [0.5, 1.5], life: [600, 900], r: [4, 7], c: GLOOM }); await s.sleep(70); }
    // the slam: the seal tips flat onto the floor under them
    const floor = Math.max(s.feet(front), s.feet(back)) - 4;
    for (const [d, g, dirn] of nodes) {
      d.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${floor - cy}px) scaleY(.3)`, opacity: 1, offset: 0.4 }, { transform: `translateY(${floor - cy}px) scaleY(.3) scale(1.4)`, opacity: 0 }],
        { duration: 700, easing: 'ease-in', fill: 'forwards' });
      done(g.animate([{ transform: `scale(1) rotate(${dirn * 120}deg)` }, { transform: `scale(1) rotate(${dirn * 300}deg)` }], { duration: 700, fill: 'forwards' })).then(() => d.remove());
    }
    await s.sleep(280);
    s.shake(13 * k, 480); s.flash('#c9a2f0', 260, 0.4); s.jolt('#c9a2f0');
    for (const t of [front, back]) s.emit(Math.round(26 * k), { x: t.x, y: s.feet(t) }, { ang: -Math.PI / 2, spread: 0.5, sp: [2, 6], life: [600, 1000], r: [5, 9], c: GLOOM, jx: s.size * 0.4, g: -0.02 });
    await s.sleep(300);
    s.untint(500);
  },

  /** Prism Ray / Prismaraja's: the light splits into every colour and lands as one beam (evolved: three). */
  async prismote(s, k, evo) {
    const me = s.me, [front, back] = s.foes;
    s.tint('rgba(0, 0, 0, .55)', 300);
    for (let n = 0; n < 8; n++) { s.emit(Math.round(6 * k), { x: me.x + rand(-s.W * 0.4, s.W * 0.4), y: me.y + rand(-s.H * 0.3, s.H * 0.2) }, { sp: [0, 0.5], life: [600, 800], r: [4, 8], c: RAINBOW, to: me }); await s.sleep(60); }
    const art = s.art(s.sd, s.mi);
    if (art) art.animate([{ filter: 'none', transform: 'scale(1)' }, { filter: 'brightness(2.2) drop-shadow(0 0 20px #fff)', transform: 'scale(1.12)' }, { filter: 'none', transform: 'scale(1)' }], { duration: 1300 });
    await s.sleep(250);
    if (!s.alive) return;
    const from = { x: me.x + s.dir * s.size * 0.25, y: me.y - s.size * 0.1 };
    const targets = evo ? [front, back, { x: (front.x + back.x) / 2, y: (front.y + back.y) / 2 }] : [front, back];
    for (const t of targets) {
      const b = s.beam(from, t, 'is-prism', s.size * (evo ? 0.5 : 0.42), 1000);
      if (b) b.animate([{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }], { duration: 500, iterations: 2 });
      s.emit(Math.round(10 * k), t, { sp: [2, 6], life: [400, 700], r: [3, 6], c: RAINBOW, shape: 'spark' });
    }
    for (let n = 0; n < 4; n++) {
      for (const t of targets) s.emit(Math.round(8 * k), t, { sp: [2, 7], life: [300, 600], r: [3, 6], c: RAINBOW, shape: 'spark', drag: 0.9 });
      s.jolt('#ffffff'); s.shake(6 * k, 200);
      await s.sleep(170);
    }
    s.flash('#ffffff', 380, evo ? 0.7 : 0.45);
    s.ring(front, '#ffffff', s.size * 0.7, 520, 2.6);
    s.untint(500);
    await s.sleep(200);
  },
};

const MAW = (evo) => `<svg viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true">
  <g class="up"><path d="M6 96 C6 22 194 22 194 96 Z" fill="#1a0b33" stroke="#a77bff" stroke-width="4"/>
    <path d="M14 96 l12 24 l12 -24 l12 28 l12 -28 l12 30 l12 -30 l12 30 l12 -30 l12 28 l12 -28 l12 24 l12 -24 l12 22 l12 -22 Z" fill="#efe6ff" stroke="#4a2a8a" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="60" cy="58" rx="15" ry="10" fill="${evo ? '#ff6a8a' : '#d9c2ff'}"/><ellipse cx="140" cy="58" rx="15" ry="10" fill="${evo ? '#ff6a8a' : '#d9c2ff'}"/>
    <ellipse cx="60" cy="59" rx="6" ry="8" fill="#2a0a50"/><ellipse cx="140" cy="59" rx="6" ry="8" fill="#2a0a50"/></g>
  <g class="dn"><path d="M6 104 C16 174 184 174 194 104 Z" fill="#1a0b33" stroke="#a77bff" stroke-width="4"/>
    <path d="M20 104 l12 -22 l12 22 l12 -26 l12 26 l12 -28 l12 28 l12 -28 l12 28 l12 -26 l12 26 l12 -22 l12 22 l12 -20 l12 20 Z" fill="#efe6ff" stroke="#4a2a8a" stroke-width="2.5" stroke-linejoin="round"/></g>
</svg>`;

const BOULDER = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M14 40 L34 12 L70 10 L92 38 L86 76 L54 92 L18 80 Z" fill="#8a6a50" stroke="#3a2a1c" stroke-width="5" stroke-linejoin="round"/>
  <path d="M34 12 L44 40 L18 80 M44 40 L70 10 M44 40 L86 76 M44 40 L54 92" stroke="#5a4434" stroke-width="3" fill="none"/><path d="M38 20 L58 18" stroke="#c4a888" stroke-width="5" stroke-linecap="round"/></svg>`;

/** A hex seal: two rings, a six-point star, runes round the rim. */
function SIGIL(cx, cy, R) {
  const pts = (n, r, off) => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`; });
  const runes = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, x = cx + Math.cos(a) * R * 0.88, y = cy + Math.sin(a) * R * 0.88; return `<path d="M${x - 4} ${y - 5} l8 0 l-8 10 l8 0" transform="rotate(${a * 57.3 + 90} ${x} ${y})"/>`; }).join('');
  return `<g class="sig" fill="none" stroke="#c9a2f0" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px #a77bff)">
    <circle cx="${cx}" cy="${cy}" r="${R}" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="${R * 0.76}" stroke-width="2.5"/>
    <polygon points="${pts(3, R * 0.74, -Math.PI / 2).join(' ')}" stroke-width="3"/><polygon points="${pts(3, R * 0.74, Math.PI / 2).join(' ')}" stroke-width="3"/>
    <g stroke-width="2.5" stroke-linecap="round">${runes}</g><circle cx="${cx}" cy="${cy}" r="${R * 0.16}" fill="#7b4fc4" stroke-width="3"/></g>`;
}

/** Play monster `id`'s special from side `sd`, slot `mi`. Resolves at its last impact. */
export async function playAttack(host, sd, mi, id, evo) {
  if (reducedMotion()) return;
  const fn = ATTACKS[id];
  if (!fn) return;
  const s = new Stage(host, sd, mi, id);
  try {
    await fn(s, evo ? 1.5 : 1, !!evo);
  } catch (err) {
    console.error('[battle-arena] attack failed', id, err);
  } finally {
    // Whatever happened, the attacker ends at home and the arena untinted.
    if (s.alive) { s.home(); const t = host.root.querySelector('.ba-tint'); if (t) s.untint(250); }
  }
}

// --- evolving --------------------------------------------------------------------------------------
/** The evolution: energy rushes in, it glows white, a ball of light swallows it and cracks open, the
 *  new form pops out, hops, and its name slams onto the screen. */
export async function evolveScene(host, sd, mi, id, evoName) {
  const rm = reducedMotion();
  const el = BY_ID[id] ? BY_ID[id].el : 'fire';
  const color = el === 'all' ? '#C9A2F0' : ELEMENT_COLOR[el];
  const parts = el === 'all' ? RAINBOW : { fire: FIRE, water: WATER, spark: ZAP, leaf: LEAF, shadow: GLOOM }[el] || FIRE;
  const s = new Stage(host, sd, mi, id);
  const d = host.fx('ba-evo' + (sd === ME ? ' is-me' : ''), `<div class="ba-evo-rays"></div><div class="ba-evo-art"><div class="ba-evo-old">${monsterSVG(id, false)}</div><div class="ba-evo-new">${monsterSVG(id, true)}</div><div class="ba-evo-orb"></div></div><b class="ba-evo-txt"></b>`);
  if (!d) return;
  d.style.setProperty('--c', color);
  const txt = d.querySelector('.ba-evo-txt');
  txt.textContent = evoName;
  const art = d.querySelector('.ba-evo-art'), old = d.querySelector('.ba-evo-old'), nu = d.querySelector('.ba-evo-new'), orb = d.querySelector('.ba-evo-orb');
  nu.style.opacity = '0';
  txt.style.opacity = '0';
  await done(d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, fill: 'forwards' }));
  if (rm) {
    old.style.opacity = '0'; nu.style.opacity = '1'; txt.style.opacity = '1';
    await host.sleep(1100);
  } else {
    const c = host.centre(art);
    // energy rushes in from every side; it shakes harder and burns brighter
    const pull = setInterval(() => { if (s.alive) { const a = rand(0, 6.3), r = Math.max(s.W, s.H) * 0.55; s.emit(3, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, { sp: [0, 1], life: [700, 900], r: [4, 8], c: parts, to: c }); } }, 30);
    for (let i = 0; i < 16; i++) {
      const u = i / 16, amp = 2 + u * 9;
      old.style.transform = `translate(${rand(-amp, amp)}px, ${rand(-amp, amp)}px)`;
      old.style.filter = `brightness(${1 + u * 3}) drop-shadow(0 0 ${6 + u * 20}px ${color})`;
      await host.sleep(80);
      if (!s.alive) { clearInterval(pull); d.remove(); return; }
    }
    old.style.filter = 'brightness(0) invert(1) drop-shadow(0 0 24px #fff)';
    // wrapped in light; cracks of light shoot out
    await done(orb.animate([{ transform: 'translate(-50%, -50%) scale(0)' }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 520, fill: 'forwards', easing: 'ease-in' }));
    clearInterval(pull);
    old.style.opacity = '0';
    for (let i = 0; i < 7; i++) {
      const b = document.createElement('div');
      b.className = 'ba-evo-crack';
      const a = rand(0, 360);
      art.appendChild(b);
      done(b.animate([{ transform: `rotate(${a}deg) scaleX(0)`, opacity: 1 }, { transform: `rotate(${a}deg) scaleX(1)`, opacity: 1, offset: 0.6 }, { transform: `rotate(${a}deg) scaleX(1)`, opacity: 0 }], { duration: 520 })).then(() => b.remove());
      orb.animate([{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: `translate(calc(-50% + ${rand(-4, 4)}px), calc(-50% + ${rand(-4, 4)}px)) scale(1.04)` }, { transform: 'translate(-50%, -50%) scale(1)' }], { duration: 90 });
      await host.sleep(85);
    }
    if (!s.alive) { d.remove(); return; }
    // BURST
    for (const x of orb.getAnimations()) x.cancel();
    orb.style.transform = 'translate(-50%, -50%) scale(0)';
    const fl = host.fx('ba-aflash');
    if (fl) { fl.style.background = '#fff'; done(fl.animate([{ opacity: 1 }, { opacity: 1, offset: 0.1 }, { opacity: 0 }], { duration: 750, easing: 'ease-out' })).then(() => fl.remove()); }
    s.shake(16, 600);
    s.emit(80, c, { sp: [5, 14], life: [600, 1200], r: [4, 9], c: [...parts, '#ffffff'], drag: 0.95, g: 0.08 });
    s.emit(36, c, { sp: [6, 16], life: [400, 800], r: [2, 3], c: ['#fff', '#ffe9a8'], shape: 'spark', drag: 0.92 });
    s.ring(c, color, 120, 650, 4);
    nu.style.opacity = '1';
    await done(nu.animate([{ transform: 'scale(1.5)', filter: 'brightness(3)' }, { transform: 'scale(.92)', filter: 'brightness(1.3)', offset: 0.55 }, { transform: 'scale(1)', filter: 'none' }], { duration: 520, easing: 'ease-out' }));
    // the pose, and the name slams in
    s.emit(26, { x: c.x, y: c.y + 40 }, { ang: -Math.PI / 2, spread: 0.7, sp: [2, 6], life: [500, 900], r: [5, 10], c: parts, jx: 60, g: -0.02 });
    nu.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-12%) scale(1.06) rotate(-4deg)', offset: 0.4 }, { transform: 'translateY(0) scale(1)' }], { duration: 480, easing: 'ease-out' });
    await host.sleep(220);
    txt.style.opacity = '1';
    done(txt.animate([{ transform: 'scale(3.2)', opacity: 0 }, { transform: 'scale(.9)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: 'ease-in' })).then(() => { if (s.alive) s.shake(9, 300); });
    await host.sleep(1500);
  }
  host.paintMon(sd, mi);
  await done(d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' }));
  d.remove();
  const a = s.art(sd, mi);
  if (a && !rm) { s.emit(26, s.at(sd, mi), { sp: [2, 6], life: [400, 700], r: [4, 8], c: parts }); a.animate([{ filter: 'brightness(3)' }, { filter: 'none' }], { duration: 500 }); }
}
