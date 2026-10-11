// flick-soccer/js/render.js - pixels only: the pitch, the goals, the discs, the ball and the aim
// guide, drawn on one canvas in pitch units (engine.js) scaled to fit the room ui.js measured.

import { W, H, GX0, GX1, GOAL_D, DISC_R, BALL_R, BALL, teamOf } from './engine.js';

/** Seat colours from the hub's colourblind-safe palette, each with its own SHAPE on the disc
 *  (root CLAUDE.md, "Accessibility"): blue triangle, vermilion square. */
export const TEAM = [
  { fill: '#1F5FA8', rim: '#103a6b', shape: 'tri' },
  { fill: '#E0532F', rim: '#8a2a12', shape: 'sq' },
];
const ACCENT = '#ffce3a';
/** The pitch plus a margin and both goals: the box that must fit on screen. */
export const VIEW = { x0: -3, y0: -GOAL_D - 3, w: W + 6, h: H + 2 * GOAL_D + 6 };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // `flip`: the pitch turned round (online, for the player on side b, who always sits at the BOTTOM).
  // A half-turn, not a mirror, so left and right stay true; the pitch itself is symmetric, so only
  // the pieces and the input need to know.
  const r = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0, flip: false };

  /** The canvas covers (cssW x cssH); the pitch is drawn inside `box` {x, y, w, h} (CSS px). */
  r.layout = (cssW, cssH, box) => {
    r.dpr = Math.min(3, window.devicePixelRatio || 1);
    r.w = cssW; r.h = cssH;
    canvas.width = Math.round(cssW * r.dpr);
    canvas.height = Math.round(cssH * r.dpr);
    r.s = Math.min(box.w / VIEW.w, box.h / VIEW.h);
    r.ox = box.x + (box.w - VIEW.w * r.s) / 2 - VIEW.x0 * r.s;
    r.oy = box.y + (box.h - VIEW.h * r.s) / 2 - VIEW.y0 * r.s;
    r._pitch = null;
  };
  /** CSS px -> pitch units, and back. */
  r.toPitch = (px, py) => {
    const x = (px - r.ox) / r.s, y = (py - r.oy) / r.s;
    return r.flip ? { x: W - x, y: H - y } : { x, y };
  };
  r.toPx = (x, y) => (r.flip ? { x: r.ox + (W - x) * r.s, y: r.oy + (H - y) * r.s } : { x: r.ox + x * r.s, y: r.oy + y * r.s });
  /** The pitch's on-screen rectangle (CSS px), goals excluded. */
  r.pitchRect = () => ({ x: r.ox, y: r.oy, w: W * r.s, h: H * r.s });

  // The static pitch is drawn once per size into an offscreen canvas.
  function pitchLayer() {
    if (r._pitch) return r._pitch;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    // Stadium surround.
    const bg = g.createLinearGradient(0, 0, 0, r.h);
    bg.addColorStop(0, '#0d2a1a'); bg.addColorStop(1, '#0a2014');
    g.fillStyle = bg; g.fillRect(0, 0, r.w, r.h);
    g.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    // Grass, mown in bands.
    const bands = 10;
    for (let k = 0; k < bands; k++) {
      g.fillStyle = k % 2 ? '#2f8a3e' : '#2a7d37';
      g.fillRect(-3, (H / bands) * k, W + 6, H / bands + 0.05);
    }
    g.fillStyle = '#2a7d37';
    g.fillRect(-3, -3, W + 6, 3); g.fillRect(-3, H, W + 6, 3);
    // Lines.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 0.7;
    g.strokeRect(0, 0, W, H);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(W / 2, H / 2, 0.9, 0, Math.PI * 2); g.fill();
    for (const top of [true, false]) {
      const y = top ? 0 : H, d = top ? 1 : -1;
      g.strokeRect(W / 2 - 30, top ? 0 : H - 22, 60, 22);
      g.strokeRect(W / 2 - 16, top ? 0 : H - 8, 32, 8);
      g.beginPath(); g.arc(W / 2, y + d * 15, 0.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(W / 2, y + d * 15, 11, top ? 0.2 * Math.PI : 1.2 * Math.PI, top ? 0.8 * Math.PI : 1.8 * Math.PI); g.stroke();
      // Net: the goal box, cross-hatched.
      const gy = top ? -GOAL_D : H;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(GX0, gy, GX1 - GX0, GOAL_D);
      g.save();
      g.beginPath(); g.rect(GX0, gy, GX1 - GX0, GOAL_D); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 0.3;
      for (let x = GX0 - GOAL_D; x < GX1 + GOAL_D; x += 2.4) {
        g.beginPath(); g.moveTo(x, gy); g.lineTo(x + GOAL_D, gy + GOAL_D); g.stroke();
        g.beginPath(); g.moveTo(x + GOAL_D, gy); g.lineTo(x, gy + GOAL_D); g.stroke();
      }
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      // Frame and posts.
      g.strokeStyle = '#f4f4f4'; g.lineWidth = 1.2; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(GX0, y); g.lineTo(GX0, top ? -GOAL_D : H + GOAL_D); g.lineTo(GX1, top ? -GOAL_D : H + GOAL_D); g.lineTo(GX1, y);
      g.stroke();
      g.fillStyle = '#ffffff';
      for (const x of [GX0, GX1]) { g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI * 2); g.fill(); }
    }
    r._pitch = c;
    return c;
  }

  function shape(kind, x, y, s) {
    ctx.beginPath();
    if (kind === 'tri' && r.flip) {
      // Drawn upside down so that, turned round with the pitch, it reads the right way up.
      ctx.moveTo(x, y + s * 1.05); ctx.lineTo(x + s * 0.95, y - s * 0.62); ctx.lineTo(x - s * 0.95, y - s * 0.62); ctx.closePath();
    } else if (kind === 'tri') {
      ctx.moveTo(x, y - s * 1.05); ctx.lineTo(x + s * 0.95, y + s * 0.62); ctx.lineTo(x - s * 0.95, y + s * 0.62); ctx.closePath();
    } else {
      ctx.rect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44);
    }
    ctx.fill();
  }

  function disc(o, team, glow) {
    const T = TEAM[team];
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    const sd = r.flip ? -1 : 1;
    ctx.beginPath(); ctx.ellipse(o.x + 0.8 * sd, o.y + 1.1 * sd, DISC_R, DISC_R * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    if (glow > 0) {
      ctx.strokeStyle = ACCENT;
      ctx.globalAlpha = glow;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2.2, 1.4]);
      ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = T.rim;
    ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R, 0, Math.PI * 2); ctx.fill();
    const grd = ctx.createRadialGradient(o.x - 1.8 * sd, o.y - 2.2 * sd, 0.5, o.x, o.y, DISC_R * 0.9);
    grd.addColorStop(0, lighten(T.fill)); grd.addColorStop(1, T.fill);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R * 0.84, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R * 0.66, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    shape(T.shape, o.x, o.y + (T.shape === 'tri' ? (r.flip ? -0.4 : 0.4) : 0), 2.1);
  }

  function ball(o, spin) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    const sd = r.flip ? -1 : 1;
    ctx.beginPath(); ctx.arc(o.x + 0.6 * sd, o.y + 0.9 * sd, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(o.x, o.y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#fbfbfb'; ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#1d1d1d';
    // A pentagon in the middle and five around the edge, turned as the ball rolls.
    pent(o.x, o.y, BALL_R * 0.36, spin);
    for (let k = 0; k < 5; k++) {
      const a = spin + (k * 2 * Math.PI) / 5 + Math.PI / 5;
      pent(o.x + Math.cos(a) * BALL_R * 0.95, o.y + Math.sin(a) * BALL_R * 0.95, BALL_R * 0.3, a);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.3;
    ctx.beginPath(); ctx.arc(o.x, o.y, BALL_R, 0, Math.PI * 2); ctx.stroke();
  }
  function pent(x, y, s, a) {
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const t = a + (k * 2 * Math.PI) / 5 - Math.PI / 2;
      const px = x + Math.cos(t) * s, py = y + Math.sin(t) * s;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  /** The aim: a pull string back to the finger, a power ring, an arrow, and the guide line to the
   *  first thing the disc will touch (with the ball's way out if that is the ball). */
  function aim(a, b) {
    const o = b[a.i];
    const len = DISC_R + 3 + a.power * 22;
    const ux = a.dx, uy = a.dy;
    // Guide.
    if (a.contact) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1.4, 1.6]);
      ctx.beginPath(); ctx.moveTo(o.x + ux * DISC_R, o.y + uy * DISC_R); ctx.lineTo(a.contact.x, a.contact.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(a.contact.x, a.contact.y, DISC_R, 0, Math.PI * 2); ctx.stroke();
      if (a.contact.hit === BALL) {
        const q = b[BALL];
        let nx = q.x - a.contact.x, ny = q.y - a.contact.y;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(q.x + nx * BALL_R, q.y + ny * BALL_R); ctx.lineTo(q.x + nx * (BALL_R + 16), q.y + ny * (BALL_R + 16)); ctx.stroke();
      }
    }
    // Pull string.
    if (a.fx != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(a.fx, a.fy); ctx.stroke();
    }
    // Power ring: a full ring is a full-strength flick.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(o.x, o.y, DISC_R + 3, -Math.PI / 2, -Math.PI / 2 + a.power * Math.PI * 2); ctx.stroke();
    // Arrow.
    const bx = o.x + ux * (DISC_R + 1), by = o.y + uy * (DISC_R + 1);
    const tx = o.x + ux * (len + 4), ty = o.y + uy * (len + 4);
    const px = -uy, py = ux;
    const w0 = 1.1, w1 = 2.2 + a.power * 1.3;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(bx + px * w0, by + py * w0);
    ctx.lineTo(tx - ux * 4 + px * w0 * 1.2, ty - uy * 4 + py * w0 * 1.2);
    ctx.lineTo(tx - ux * 4 + px * w1, ty - uy * 4 + py * w1);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - ux * 4 - px * w1, ty - uy * 4 - py * w1);
    ctx.lineTo(tx - ux * 4 - px * w0 * 1.2, ty - uy * 4 - py * w0 * 1.2);
    ctx.lineTo(bx - px * w0, by - py * w0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  /** state: { b (bodies) or null, glowTeam (-1 none), glow 0-1, aim (or null), spin, dim } */
  r.draw = (st) => {
    if (!r.w) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(pitchLayer(), 0, 0);
    const b = st.b;
    if (!b) return;
    if (r.flip) ctx.setTransform(-r.dpr * r.s, 0, 0, -r.dpr * r.s, r.dpr * (r.ox + W * r.s), r.dpr * (r.oy + H * r.s));
    else ctx.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    for (let i = 1; i < b.length; i++) {
      const team = teamOf(i);
      disc(b[i], team, team === st.glowTeam && (!st.aim || st.aim.i === i) ? (st.aim && st.aim.i === i ? 1 : st.glow) : 0);
    }
    ball(b[BALL], st.spin || 0);
    if (st.aim) aim(st.aim, b);
  };

  return r;
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.min(255, Math.round(v + (255 - v) * 0.35));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
