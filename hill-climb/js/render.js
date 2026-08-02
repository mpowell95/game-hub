// hill-climb/js/render.js — every pixel of the world layer: sky, parallax ridges, the dirt
// cross-section with its grass strip and crater texture, coins, fuel cans, the vehicle, the
// ragdoll driver and the floating pickup popups. The HUD is DOM (ui.js/hill-climb.css), not here.
//
// COORDINATE FLIP. Physics and terrain are y-UP (see physics.js); canvas is y-down. Everything in
// this file goes through worldToScreen(), and anything drawn in vehicle-local meters sets up
// `translate -> scale(s, -s) -> rotate(ang)`, after which you can draw in plain y-up meters and
// the flip is handled. Never draw text inside that transform: it comes out mirrored.
//
// The look is the flat-cartoon/vector one the brief asks for: saturated flat fills, thick dark
// outlines, no gradients except the sky, chunky rounded shapes. OUTLINE is the single dark ink
// color everything is stroked with, so the whole scene reads as one illustration.

const OUTLINE = '#231f1c';

// Where the driver sits, what they hold, and how big the steering wheel is — per vehicle, in
// CHASSIS-LOCAL meters (y-up). `grip` is both the hand target for the ragdoll's arm and the center
// of the steering wheel; a `wheelR` of 0 means there is no wheel to draw (the bike's bars belong
// to its frame). Keep `y + 0.63` roughly in line with that vehicle's `body.head.y` in catalog.js:
// that is the physics crash probe, and a driver drawn far from it would lie about why a run ended.
const SEAT = {
  jeep: { x: -0.34, y: 0.36, grip: { x: 0.40, y: 0.44 }, wheelR: 0.16 },
  bike: { x: -0.34, y: 0.30, grip: { x: 0.52, y: 0.64 }, wheelR: 0 },
  truck: { x: -0.40, y: 0.44, grip: { x: 0.24, y: 0.68 }, wheelR: 0.16 },
  rover: { x: -0.44, y: 0.36, grip: { x: 0.16, y: 0.60 }, wheelR: 0.15 },
};

/** Deterministic 0..1 from an integer — the crater texture and grass tufts are keyed off world
 *  position through this, so decoration is nailed to the ground and scrolls with it instead of
 *  crawling as the camera moves. */
function h1(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stage = stage;
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.scale = 40;            // px per world meter
    this.camX = 0; this.camY = 0;
    this.camInit = false;
    // Driver ragdoll: a single damped torsion spring chasing the chassis' angular velocity. Purely
    // cosmetic (physics.js never sees it), which is exactly why it can be this cheap and this
    // floppy — the driver flops over bumps and whips on landings without touching the sim.
    this.lean = 0; this.leanV = 0;
    this.popups = [];
    this.shake = 0;
  }

  setStage(stage) { this.stage = stage; }

  /**
   * Size the backing store to the element box at device pixel ratio. Call on mount and resize.
   * Returns false when the canvas has NO REAL LAYOUT YET, without touching the bitmap.
   *
   * That guard is the fix for a real bug (2026-08-02, Matt's phone): the garage preview rendered
   * as a solid red panel. `renderGarage()` draws the preview in the same task that sets innerHTML,
   * and on a cold load the stylesheet (injected as a <link> by ensureCSS) had not applied yet, so
   * the canvas measured about 1x1 CSS px. The old code happily sized the bitmap to 3x3, drew a
   * 3-pixel crop of the middle of the car into it, and never redrew — CSS then stretched those
   * three red pixels across the whole panel. Refusing a degenerate box (and letting the caller
   * retry, see ui.js's rAF + ResizeObserver) means a wrong-sized bitmap can never be committed.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 8 || h < 8) return false;
    if (w === this.w && h === this.h && dpr === this.dpr) return true;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // ~13 m of road across the short axis, so the 2.5 m car reads at a real size. Deliberately
    // driven mostly by WIDTH: a tall portrait phone has sky to spare (jumps need it) and sizing
    // off height there shrank the car to a speck. Clamped at both ends so it neither vanishes on
    // a desktop monitor nor fills a small window.
    this.scale = Math.max(24, Math.min(68, Math.min(w / 13.5, h / 7.5)));
    return true;
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.camX) * this.scale + this.w * 0.32,
      y: this.h * 0.46 - (y - this.camY) * this.scale,
    };
  }

  /** Follow the car: locked horizontally (the brief's "camera fixed on the car"), with a soft
   *  vertical follow so climbs and drops stay in frame without the horizon lurching. */
  follow(car, dt) {
    const targetX = car.x + Math.max(-1.5, Math.min(3.5, car.vx * 0.22));
    const targetY = car.y + 0.8;
    if (!this.camInit) { this.camX = targetX; this.camY = targetY; this.camInit = true; return; }
    const kx = 1 - Math.pow(0.001, dt), ky = 1 - Math.pow(0.02, dt);
    this.camX += (targetX - this.camX) * kx;
    this.camY += (targetY - this.camY) * ky;
  }

  /** Feed the frame's run events in; they become floating "+25" labels above the world. */
  pushEvents(events) {
    for (const e of events) {
      this.popups.push({ x: e.x, y: e.y, life: 1.15, kind: e.kind, value: e.value, n: e.n | 0 });
      if (e.kind === 'flip') this.shake = Math.min(1, this.shake + 0.35);
    }
    events.length = 0;
  }

  // --- world layers ------------------------------------------------------------------------------

  drawSky() {
    const { ctx, w, h } = this;
    const st = this.stage;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, st.sky);
    g.addColorStop(1, st.id === 'moon' ? '#2b3358' : '#dff2fb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (st.id === 'moon') {
      // stars, pinned to the (very slow) parallax layer so they drift rather than crawl
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const off = this.camX * 0.06;
      for (let i = 0; i < 46; i++) {
        const sx = ((i * 137.5 - off) % (w + 40) + w + 40) % (w + 40) - 20;
        const sy = h1(i * 7 + 1) * h * 0.55;
        const r = 0.7 + h1(i * 13 + 3) * 1.4;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** Two parallax ridge bands behind the playfield. Sine-built like the terrain itself so they
   *  read as the same landscape seen further off. */
  drawRidges() {
    const { ctx, w, h } = this;
    const st = this.stage;
    const bands = [
      { par: 0.16, amp: 34, base: h * 0.60, freq: 0.0055, color: st.far, alpha: 0.55 },
      { par: 0.30, amp: 22, base: h * 0.68, freq: 0.0100, color: st.far, alpha: 0.8 },
    ];
    for (const b of bands) {
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let px = 0; px <= w; px += 8) {
        const wx = (px + this.camX * this.scale * b.par);
        const y = b.base - Math.sin(wx * b.freq) * b.amp - Math.sin(wx * b.freq * 2.7 + 1.3) * b.amp * 0.45;
        ctx.lineTo(px, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The dirt cross-section: filled body, crater texture, grass cap strip, grass blades. */
  drawTerrain(terrain) {
    const { ctx, w, h, scale } = this;
    const st = this.stage;
    const leftW = this.camX - (this.w * 0.32) / scale - 1;
    const rightW = leftW + w / scale + 2;
    const stepW = 6 / scale;                          // ~6 px per sample

    // body
    ctx.beginPath();
    let first = true;
    for (let x = leftW; x <= rightW; x += stepW) {
      const p = this.worldToScreen(x, terrain.y(x));
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    const end = this.worldToScreen(rightW, terrain.y(rightW));
    ctx.lineTo(end.x, h + 10);
    ctx.lineTo(this.worldToScreen(leftW, 0).x, h + 10);
    ctx.closePath();
    ctx.fillStyle = st.dirt;
    ctx.fill();

    // crater texture: stamped ellipses inside the dirt, world-anchored, never crossing the
    // surface line (they are clipped by the same path they decorate)
    ctx.save();
    ctx.clip();
    ctx.fillStyle = st.dirtDark;
    ctx.globalAlpha = 0.55;
    const gx0 = Math.floor(leftW / 1.9), gx1 = Math.ceil(rightW / 1.9);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let row = 0; row < 7; row++) {
        const r = h1(gx * 73 + row * 911);
        if (r > 0.72) continue;
        const wx = gx * 1.9 + (h1(gx * 31 + row * 17) - 0.5) * 1.5;
        const depth = 0.9 + row * 1.25 + h1(gx * 51 + row * 7) * 0.7;
        const p = this.worldToScreen(wx, terrain.y(wx) - depth);
        const rad = (0.16 + r * 0.30) * scale;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rad, rad * 0.66, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // grass / snow / sand cap along the surface
    ctx.beginPath();
    first = true;
    for (let x = leftW; x <= rightW; x += stepW) {
      const p = this.worldToScreen(x, terrain.y(x));
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    ctx.lineWidth = Math.max(5, scale * 0.30);
    ctx.strokeStyle = st.grass;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineWidth = Math.max(2, scale * 0.07);
    ctx.strokeStyle = st.grassDark;
    ctx.stroke();

    // tufts poking up out of the cap
    ctx.strokeStyle = st.tuft;
    ctx.lineWidth = Math.max(1.6, scale * 0.055);
    const tx0 = Math.floor(leftW / 1.1), tx1 = Math.ceil(rightW / 1.1);
    for (let i = tx0; i <= tx1; i++) {
      const r = h1(i * 199 + 7);
      if (r > 0.55) continue;
      const wx = i * 1.1 + (h1(i * 13) - 0.5) * 0.7;
      const gy = terrain.y(wx);
      const base = this.worldToScreen(wx, gy);
      const hgt = (0.16 + r * 0.34) * scale;
      for (let b = -1; b <= 1; b++) {
        ctx.beginPath();
        ctx.moveTo(base.x + b * scale * 0.06, base.y - scale * 0.05);
        ctx.quadraticCurveTo(base.x + b * scale * 0.14, base.y - hgt * 0.6, base.x + b * scale * 0.20, base.y - hgt);
        ctx.stroke();
      }
    }
  }

  drawItems(terrain, tNow) {
    const { ctx, scale } = this;
    const leftW = this.camX - (this.w * 0.32) / scale - 2;
    const rightW = leftW + this.w / scale + 4;
    for (const it of terrain.itemsIn(leftW, rightW)) {
      if (it.taken) continue;
      const bob = Math.sin(tNow * 2.2 + it.x * 0.6) * 0.09;
      const p = this.worldToScreen(it.x, it.y + bob);
      if (it.kind === 'coin') this.drawCoin(p.x, p.y, it.value);
      else this.drawCan(p.x, p.y);
    }
  }

  drawCoin(sx, sy, value) {
    const { ctx, scale } = this;
    const r = scale * 0.40;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 0.8, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e0a007'; ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.18); ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
    ctx.fillStyle = '#F2B705'; ctx.fill();
    ctx.fillStyle = OUTLINE;
    ctx.font = `700 ${Math.round(r * 0.86)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 0, r * 0.06);
    ctx.restore();
  }

  drawCan(sx, sy) {
    const { ctx, scale } = this;
    const s = scale * 0.5;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, s * 1.15, s * 0.8, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.16); ctx.strokeStyle = OUTLINE; ctx.lineJoin = 'round';
    ctx.fillStyle = '#E0532F';
    roundRect(ctx, -s * 0.62, -s * 0.85, s * 1.24, s * 1.75, s * 0.22);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b53a1c';
    roundRect(ctx, -s * 0.20, -s * 1.10, s * 0.42, s * 0.32, s * 0.10);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    ctx.beginPath(); ctx.moveTo(-s * 0.34, -s * 0.5); ctx.lineTo(-s * 0.34, s * 0.6); ctx.stroke();
    ctx.restore();
  }

  // --- the vehicle -------------------------------------------------------------------------------

  /** One wheel, drawn at its own world position (physics.js keeps `cx`/`cy` per wheel, which is
   *  where suspension travel actually shows up) and spun by its own rolling angle. */
  drawWheel(w, radius) {
    const { ctx, scale } = this;
    const p = this.worldToScreen(w.cx, w.cy);
    const r = radius * scale;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-w.spin);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2b30'; ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12); ctx.strokeStyle = OUTLINE; ctx.stroke();
    // treads
    ctx.strokeStyle = '#4a4a52';
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.80, Math.sin(a) * r * 0.80);
      ctx.lineTo(Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = this.paint.rim; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.10); ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(1, r * 0.08);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.40, Math.sin(a) * r * 0.40);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The chassis + driver, drawn in vehicle-local meters (y-up) inside the flip transform. */
  drawCar(car, veh, dt, throttle) {
    const { ctx, scale } = this;
    this.paint = veh.paint;
    const spec = car.spec;

    // suspension arms first, so the body sits over them
    ctx.save();
    ctx.lineWidth = Math.max(3, scale * 0.10);
    ctx.strokeStyle = OUTLINE;
    ctx.lineCap = 'round';
    for (let i = 0; i < car.wheels.length; i++) {
      const w = car.wheels[i];
      const a = car.toWorld(w.local);
      const pa = this.worldToScreen(a.x, a.y);
      const pw = this.worldToScreen(w.cx, w.cy);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pw.x, pw.y); ctx.stroke();
    }
    ctx.restore();

    for (let i = 0; i < car.wheels.length; i++) this.drawWheel(car.wheels[i], spec.radius);

    const p = this.worldToScreen(car.x, car.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(scale, -scale);
    ctx.rotate(car.ang);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const lw = 0.075;                       // outline width, in meters
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;

    if (veh.id === 'bike') this.bodyBike(veh);
    else if (veh.id === 'truck') this.bodyTruck(veh);
    else if (veh.id === 'rover') this.bodyRover(veh);
    else this.bodyJeep(veh);

    this.drawDriver(veh, dt, throttle);
    ctx.restore();
  }

  bodyJeep(veh) {
    const ctx = this.ctx, c = veh.paint;
    ctx.fillStyle = c.body;
    // hull
    ctx.beginPath();
    ctx.moveTo(-1.30, -0.16);
    ctx.lineTo(-1.34, 0.30);
    ctx.lineTo(-0.42, 0.30);
    ctx.lineTo(-0.34, 0.62);
    ctx.lineTo(0.46, 0.62);
    ctx.lineTo(0.60, 0.30);
    ctx.lineTo(1.36, 0.26);
    ctx.lineTo(1.38, -0.18);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // bonnet shade + grille
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(0.62, 0.28); ctx.lineTo(1.34, 0.24); ctx.lineTo(1.36, 0.04); ctx.lineTo(0.62, 0.06);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#F2B705';
    ctx.beginPath(); ctx.arc(1.30, -0.02, 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // seat back
    ctx.fillStyle = c.seat;
    ctx.beginPath();
    ctx.moveTo(-0.52, 0.28); ctx.lineTo(-0.52, 0.86); ctx.lineTo(-0.30, 0.86); ctx.lineTo(-0.30, 0.28);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // exhaust
    ctx.fillStyle = '#8b8f96';
    ctx.beginPath();
    ctx.moveTo(-1.34, 0.02); ctx.lineTo(-1.62, 0.02); ctx.lineTo(-1.62, 0.14); ctx.lineTo(-1.34, 0.14);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // whip antenna, trailing with speed
    const bend = Math.max(-0.55, Math.min(0.55, -this.antenna));
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-1.18, 0.32);
    ctx.quadraticCurveTo(-1.30 + bend * 0.6, 0.95, -1.10 + bend, 1.45);
    ctx.stroke();
    ctx.fillStyle = '#E0532F';
    ctx.beginPath(); ctx.arc(-1.10 + bend, 1.45, 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 0.075;
  }

  /** A real side-view dirt bike: swingarm and fork reaching the actual wheel centers, an engine
   *  block the frame hangs off, tank/seat/fender, number plate and raised bars. The first version
   *  was a flat delta with the wheels floating off the ends of it, which read as a paper plane. */
  bodyBike(veh) {
    const ctx = this.ctx, c = veh.paint;
    // swingarm and fork first, so the frame sits over them. Both reach roughly the wheel centers
    // at full droop (the anchors are at y -0.16, the suspension is 0.40 long).
    ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round';
    ctx.lineWidth = 0.11;
    ctx.beginPath(); ctx.moveTo(0.06, -0.16); ctx.lineTo(-0.70, -0.50); ctx.stroke();
    ctx.lineWidth = 0.13;
    ctx.beginPath(); ctx.moveTo(0.44, 0.42); ctx.lineTo(0.74, -0.48); ctx.stroke();
    // engine block
    ctx.fillStyle = '#3b4048';
    ctx.lineWidth = 0.06;
    roundRect(ctx, -0.18, -0.30, 0.52, 0.44, 0.08); ctx.fill(); ctx.stroke();
    // frame spine + tank, one shape
    ctx.fillStyle = c.body;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(-0.60, 0.32); ctx.lineTo(0.12, 0.36); ctx.lineTo(0.46, 0.44);
    ctx.lineTo(0.44, 0.16); ctx.lineTo(0.10, 0.04); ctx.lineTo(-0.38, 0.14);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // seat
    ctx.fillStyle = c.seat;
    roundRect(ctx, -0.66, 0.28, 0.52, 0.14, 0.06); ctx.fill(); ctx.stroke();
    // rear fender
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(-0.44, 0.30); ctx.lineTo(-0.94, 0.14); ctx.lineTo(-0.88, 0.01); ctx.lineTo(-0.42, 0.17);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // front number plate
    ctx.fillStyle = '#efe9dc';
    roundRect(ctx, 0.44, 0.14, 0.26, 0.30, 0.07); ctx.fill(); ctx.stroke();
    // bars
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.075;
    ctx.beginPath(); ctx.moveTo(0.46, 0.44); ctx.lineTo(0.52, 0.64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.34, 0.60); ctx.lineTo(0.70, 0.67); ctx.stroke();
  }

  bodyTruck(veh) {
    const ctx = this.ctx, c = veh.paint;
    ctx.fillStyle = c.body;
    // A monster truck is mostly BODY sitting high over its axles, so the hull is deliberately deep
    // (~0.8 m against a 2.9 m length). An earlier, shallower version read as a flat plank on wheels
    // at gameplay zoom.
    ctx.beginPath();
    ctx.moveTo(-1.42, -0.36); ctx.lineTo(-1.46, 0.44); ctx.lineTo(-0.50, 0.44);
    ctx.lineTo(-0.44, 0.96); ctx.lineTo(0.58, 0.96); ctx.lineTo(0.72, 0.44);
    ctx.lineTo(1.50, 0.40); ctx.lineTo(1.52, -0.34);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // rocker skirt: one dark band along the bottom, the cheapest way to read depth on a flat fill
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(-1.43, -0.36); ctx.lineTo(1.52, -0.34); ctx.lineTo(1.51, -0.12); ctx.lineTo(-1.42, -0.14);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // bonnet: flush with the hull's own top edge (a floating slab reads as a detached box at
    // tile-sized zoom), plus a windscreen post tying the cabin to it
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(0.72, 0.44); ctx.lineTo(1.50, 0.40); ctx.lineTo(1.51, 0.02); ctx.lineTo(0.72, 0.06);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#bfe6f2';
    ctx.beginPath();
    ctx.moveTo(0.20, 0.92); ctx.lineTo(0.56, 0.92); ctx.lineTo(0.70, 0.48); ctx.lineTo(0.20, 0.48);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // roof light bar
    ctx.fillStyle = '#2b2b30';
    roundRect(ctx, -0.34, 0.96, 0.84, 0.16, 0.06); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#F2B705';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-0.16 + i * 0.26, 1.04, 0.055, 0, Math.PI * 2); ctx.fill(); }
    // roll cage
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(-0.44, 0.46); ctx.lineTo(-0.30, 0.96); ctx.stroke();
    ctx.lineWidth = 0.075;
    ctx.fillStyle = c.seat;
    roundRect(ctx, -0.56, 0.44, 0.22, 0.56, 0.07); ctx.fill(); ctx.stroke();
  }

  /** A caged lunar buggy: a deep tub (not a plank), an open roll cage the driver actually sits
   *  inside, a front console, a solar deck and the dish on a rear mast. */
  bodyRover(veh) {
    const ctx = this.ctx, c = veh.paint;
    ctx.fillStyle = c.body;
    roundRect(ctx, -1.30, -0.30, 2.60, 0.68, 0.14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.trim;
    roundRect(ctx, -1.28, -0.30, 2.56, 0.24, 0.10); ctx.fill(); ctx.stroke();
    // roll cage
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.085; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.88, 0.36); ctx.lineTo(-0.70, 1.06); ctx.lineTo(0.34, 1.06); ctx.lineTo(0.58, 0.38);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.70, 1.06); ctx.lineTo(0.12, 0.40); ctx.stroke();
    // seat
    ctx.fillStyle = c.seat; ctx.lineWidth = 0.07;
    roundRect(ctx, -0.86, 0.38, 0.26, 0.60, 0.08); ctx.fill(); ctx.stroke();
    roundRect(ctx, -0.86, 0.38, 0.54, 0.15, 0.06); ctx.fill(); ctx.stroke();
    // console + solar deck
    ctx.fillStyle = c.trim;
    roundRect(ctx, 0.52, 0.38, 0.72, 0.26, 0.08); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b3a63';
    roundRect(ctx, 0.58, 0.66, 0.64, 0.11, 0.04); ctx.fill(); ctx.stroke();
    // dish on a rear mast
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(-1.10, 0.38); ctx.lineTo(-1.20, 0.92); ctx.stroke();
    ctx.fillStyle = '#e6e9ef';
    ctx.beginPath();
    ctx.ellipse(-1.26, 1.02, 0.26, 0.13, 0.55, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.075;
  }

  /** The ragdoll driver: red shirt, flat cap, mustache, hands on the wheel. The torso pivots at
   *  the hip by `lean`, which is the damped spring updated in draw(); the head hangs off the
   *  torso with a fraction of the same lean, so hard landings make him fold and whip back. */
  drawDriver(veh, dt, throttle) {
    const ctx = this.ctx;
    const s = SEAT[veh.id] || SEAT.jeep;
    const seatX = s.x, seatY = s.y;
    // where the hands go, in torso-local meters (the bike's bars are high and forward, a car's
    // wheel is low and forward) — without this the arm pointed at empty air on the bike
    const gx = s.grip.x - seatX, gy = s.grip.y - seatY;
    ctx.save();
    ctx.translate(seatX, seatY);
    ctx.rotate(this.lean);
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = OUTLINE;
    // torso
    ctx.fillStyle = '#E0532F';
    roundRect(ctx, -0.16, 0, 0.34, 0.46, 0.12); ctx.fill(); ctx.stroke();
    // arm reaching for the bars or the wheel
    ctx.strokeStyle = '#E0532F'; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0.08, 0.34); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(0.08, 0.34); ctx.lineTo(gx, gy); ctx.stroke();
    // head, hanging off the torso with extra lag
    ctx.save();
    ctx.translate(0.01, 0.46);
    ctx.rotate(this.lean * 0.7);
    ctx.lineWidth = 0.06;
    ctx.fillStyle = '#f0c08a';
    ctx.beginPath(); ctx.arc(0, 0.17, 0.20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // mustache
    ctx.fillStyle = OUTLINE;
    roundRect(ctx, 0.02, 0.09, 0.17, 0.05, 0.025); ctx.fill();
    // eye
    ctx.beginPath(); ctx.arc(0.10, 0.20, 0.032, 0, Math.PI * 2); ctx.fill();
    // flat cap
    ctx.fillStyle = '#c1301f';
    ctx.beginPath();
    ctx.moveTo(-0.21, 0.28);
    ctx.quadraticCurveTo(0, 0.52, 0.20, 0.28);
    ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.055; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#c1301f';
    roundRect(ctx, 0.06, 0.25, 0.26, 0.07, 0.03); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // steering wheel, drawn in CHASSIS-local space (it belongs to the car, not the ragdoll, so it
    // must not lean with the driver). The bike has none: its bars are part of bodyBike.
    if (s.wheelR) {
      ctx.save();
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.065;
      ctx.beginPath(); ctx.arc(s.grip.x, s.grip.y, s.wheelR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /** Exhaust puffs when the gas is down and a wheel is on the ground. */
  drawSmoke(car, throttle, tNow) {
    if (throttle <= 0.1) return;
    const { ctx } = this;
    const back = car.toWorld({ x: -1.5, y: 0.10 });
    ctx.fillStyle = 'rgba(220,220,220,0.5)';
    for (let i = 0; i < 3; i++) {
      const ph = (tNow * 1.6 + i * 0.33) % 1;
      const p = this.worldToScreen(back.x - ph * 1.2, back.y + ph * 0.75);
      ctx.globalAlpha = 0.45 * (1 - ph);
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.scale * (0.10 + ph * 0.26), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawPopups(dt) {
    const { ctx, scale } = this;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      p.life -= dt;
      p.y += dt * 1.5;
      const a = Math.max(0, Math.min(1, p.life / 0.7));
      const s = this.worldToScreen(p.x, p.y);
      const label = p.kind === 'flip'
        ? `FLIP +${p.value}`
        : p.kind === 'fuel' ? '+ FUEL' : `+${p.value}`;
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(scale * 0.46)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(3, scale * 0.11);
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(label, s.x, s.y);
      ctx.fillStyle = p.kind === 'fuel' ? '#ff8f6a' : p.kind === 'flip' ? '#8ee7ff' : '#F2B705';
      ctx.fillText(label, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  /** One frame. `dt` is real (not sim) seconds since the last frame. Skips entirely while the
   *  canvas has no real layout (see resize()); the next frame picks it up. */
  draw(run, veh, throttle, dt, tNow) {
    const { ctx } = this;
    if (!this.resize()) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const car = run.car;

    // ragdoll spring: chases the chassis' angular velocity, plus a throttle-driven lean back
    const target = Math.max(-0.7, Math.min(0.7, -car.av * 0.09 + throttle * 0.10));
    const k = 90, c = 13;
    this.leanV += ((target - this.lean) * k - this.leanV * c) * Math.min(dt, 0.05);
    this.lean += this.leanV * Math.min(dt, 0.05);
    this.lean = Math.max(-1.1, Math.min(1.1, this.lean));
    // trailing antenna: leans back with acceleration and speed
    this.antenna = Math.max(-0.6, Math.min(0.6, car.vx * 0.035));

    this.follow(car, Math.min(dt, 0.05));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0) {
      const s = this.shake * 6;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this.drawSky();
    this.drawRidges();
    this.drawTerrain(run.terrain);
    this.drawItems(run.terrain, tNow);
    this.drawSmoke(car, throttle, tNow);
    this.drawCar(car, veh, dt, throttle);
    this.drawPopups(Math.min(dt, 0.05));
  }

  /** Static one-off used by the garage preview: a level patch of ground and the parked car.
   *  Returns false if the canvas is not laid out yet, so the caller can try again (ui.js). */
  drawPreview(veh, spec) {
    const { ctx } = this;
    if (!this.resize()) return false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paint = veh.paint;
    this.camInit = true; this.camX = 0; this.camY = 0.4;
    this.scale = Math.max(16, Math.min(52, Math.min(this.w / 5.2, this.h / 3.4)));
    const st = this.stage;
    ctx.fillStyle = st.sky; ctx.fillRect(0, 0, this.w, this.h);
    const horizon = this.worldToScreen(0, -0.55).y;
    ctx.fillStyle = st.dirt; ctx.fillRect(0, horizon, this.w, this.h - horizon);
    ctx.strokeStyle = st.grass; ctx.lineWidth = Math.max(4, this.scale * 0.26);
    ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(this.w, horizon); ctx.stroke();

    // a parked stand-in for the live car: same drawing code, wheels at rest
    const fake = {
      x: 0, y: 0, ang: 0, av: 0, vx: 0, spec,
      wheels: spec.wheels.map((w) => ({
        local: { x: w.x, y: w.y }, spin: 0,
        cx: w.x, cy: w.y - spec.restLen,
      })),
      toWorld(p) { return { x: p.x, y: p.y }; },
    };
    this.lean = 0; this.antenna = 0;
    this.drawCar(fake, veh, 0, 0);
    return true;
  }
}

export default { Renderer };
