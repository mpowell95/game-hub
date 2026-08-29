// pinball/js/render-royal.js - the canvas for the ROYAL FLUSH board.
//
// A SEPARATE RENDERER, for the same reason royal.js is a separate class: render.js paints STARHUB's
// specific art - its arch, its named lamps, its three pop bumpers indexed 0-2, its habitrail drawn
// above the playfield with a shadow. None of that exists here.
//
// This one draws the GEOMETRY, in the vector style the source table is designed in: every collider
// as a stroked line, parts picked out by colour, the ball with a highlight. It is deliberately plain
// - the point of this build is to judge how the board PLAYS, and dressing it up would only make a
// bad shot map look convincing. It also keeps the same public surface as Renderer (constructor,
// resize, render) so ui.js can swap between them with one line.
import T from './table-royal.js';
import { BALL_R } from './physics.js';

const C = {
  bg: '#0d1420',
  wall: '#5fd3ff',
  kicker: '#ff4d6d',
  drop: '#c77dff',
  bumper: '#ff9f1c',
  roll: '#00e0e0',
  spin: '#ffffff',
  flip: '#f2f5fa',
  ball: '#e8edf5',
  drain: '#1b2739',
};

export class RoyalRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.time = 0;
    this.pulses = new Map();          // collider id -> remaining glow, seconds
    this.reduced = false;
    try {
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { /* no matchMedia: assume full motion */ }
  }

  resize(w, h) {
    const dpr = Math.min(3, (window.devicePixelRatio || 1));
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    // Fit the whole field with a small margin; the board is 400 x 600 and must never be cropped,
    // because a clipped shooter lane is exactly the bug pinball/CLAUDE.md records STARHUB shipping.
    this.scale = Math.min(w / (T.W + 16), h / (T.H + 16));
    this.ox = (w - T.W * this.scale) / 2;
    this.oy = (h - T.H * this.scale) / 2;
  }

  /** `game` is a RoyalPinball. Events are read by ui.js, so anything visual it wants to flash is
   *  passed here through pulse(). */
  pulse(id) { if (id) this.pulses.set(id, 0.25); }

  render(game, dt) {
    const ctx = this.ctx;
    this.time += dt;
    for (const [k, v] of this.pulses) {
      const n = v - dt;
      if (n <= 0) this.pulses.delete(k); else this.pulses.set(k, n);
    }

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);

    // The drain mouth, so the bottom of the table reads as an opening rather than a missing wall.
    ctx.fillStyle = C.drain;
    ctx.fillRect(0, T.DRAIN_Y, T.W, T.H - T.DRAIN_Y + 8);

    ctx.lineCap = 'round';
    for (const c of game.colliders) {
      if (c.t !== 'seg') continue;
      const isDrop = c.id && c.id.startsWith('drop:');
      ctx.strokeStyle = isDrop ? C.drop : (c.kick ? C.kicker : C.wall);
      ctx.lineWidth = isDrop ? 7 : (c.kick ? 5 : 3.2);
      ctx.globalAlpha = isDrop || c.kick ? 1 : 0.85;
      ctx.beginPath();
      ctx.moveTo(c.ax, c.ay);
      ctx.lineTo(c.bx, c.by);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const c of game.colliders) {
      if (c.t !== 'circle') continue;
      const hot = this.pulses.get(c.id) || 0;
      ctx.strokeStyle = C.bumper;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + 7 + hot * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = C.bumper;
      ctx.globalAlpha = 0.55 + hot * 1.8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const g of T.ROLLOVERS) {
      for (const [x, y] of g.pts) {
        ctx.strokeStyle = C.roll;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, g.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const [x, y, r] of T.SPINNERS) {
      ctx.strokeStyle = C.spin;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const f of game.flippers) {
      ctx.strokeStyle = C.flip;
      ctx.lineWidth = f.r * 2;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(f.px + Math.cos(f.angle) * f.len, f.py + Math.sin(f.angle) * f.len);
      ctx.stroke();
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(f.px, f.py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const b of game.balls) {
      const g2 = ctx.createRadialGradient(b.x - BALL_R * 0.4, b.y - BALL_R * 0.45, BALL_R * 0.1, b.x, b.y, BALL_R);
      g2.addColorStop(0, '#ffffff');
      g2.addColorStop(1, '#8d99ab');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

export default { RoyalRenderer };
