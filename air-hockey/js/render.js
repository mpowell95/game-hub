// air-hockey/js/render.js - draws the table, puck and mallets on one canvas. The table itself
// (surface, air holes, lines, rim, goal slots) is painted ONCE per layout/theme onto an offscreen
// canvas; a frame is one drawImage plus three circles. No allocation per frame.
//
// Colour is never the only marker (Matt is red/green colourblind): your mallet carries a TRIANGLE
// on its knob, the computer's a SQUARE, and the HUD scores wear the same shapes.

import { TABLE, GOAL_X0, GOAL_X1 } from './physics.js';

const { W, H, RIM, CORNER, PUCK_R, MALLET_R } = TABLE;
const EXT_W = W + RIM * 2, EXT_H = H + RIM * 2;

const PALETTE = {
  light: {
    surface: '#eef5fb', hole: 'rgba(40,70,110,0.16)', line: '#e0532f', circle: '#1f5fa8',
    rim: '#1b2a44', rimHi: '#34507d', slot: '#070b14', puck: '#1d2129', puckHi: '#4a5160',
    you: '#1f5fa8', youHi: '#4d86cc', cpu: '#e0532f', cpuHi: '#f07d5e', mark: '#ffffff',
  },
  dark: {
    surface: '#0e1b31', hole: 'rgba(160,200,255,0.10)', line: '#e0532f', circle: '#4d86cc',
    rim: '#22324f', rimHi: '#3a5582', slot: '#000000', puck: '#f2b705', puckHi: '#ffd95a',
    you: '#2f74c8', youHi: '#6ea4e6', cpu: '#e0532f', cpuHi: '#f07d5e', mark: '#ffffff',
  },
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const bg = document.createElement('canvas');
  let scale = 1, dpr = 1, cssW = 0, cssH = 0, pal = PALETTE.light;

  /** Fit the table into availW x availH css px. Returns the css size actually used. */
  function layout(availW, availH, dark) {
    pal = dark ? PALETTE.dark : PALETTE.light;
    scale = Math.min(availW / EXT_W, availH / EXT_H);
    cssW = Math.floor(EXT_W * scale); cssH = Math.floor(EXT_H * scale);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    bg.width = canvas.width; bg.height = canvas.height;
    paintTable();
    return { w: cssW, h: cssH };
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function paintTable() {
    const g = bg.getContext('2d');
    const s = scale * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bg.width, bg.height);
    g.setTransform(s, 0, 0, s, RIM * s, RIM * s);   // origin = top-left of the playing surface

    // Rim.
    g.fillStyle = pal.rim;
    roundRect(g, -RIM, -RIM, W + RIM * 2, H + RIM * 2, CORNER + RIM);
    g.fill();
    g.strokeStyle = pal.rimHi; g.lineWidth = 3;
    roundRect(g, -RIM + 4, -RIM + 4, W + RIM * 2 - 8, H + RIM * 2 - 8, CORNER + RIM - 4);
    g.stroke();

    // Goal slots cut into the rim.
    g.fillStyle = pal.slot;
    g.fillRect(GOAL_X0, -RIM, GOAL_X1 - GOAL_X0, RIM + 1);
    g.fillRect(GOAL_X0, H - 1, GOAL_X1 - GOAL_X0, RIM + 1);

    // Surface.
    g.save();
    roundRect(g, 0, 0, W, H, CORNER);
    g.fillStyle = pal.surface; g.fill();
    g.clip();
    // Air holes.
    g.fillStyle = pal.hole;
    for (let y = 18; y < H; y += 26) {
      for (let x = 18 + ((y / 26) % 2 ? 13 : 0); x < W; x += 26) {
        g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill();
      }
    }
    // Lines: centre line, centre circle, a crease in front of each goal.
    g.strokeStyle = pal.line; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = pal.circle; g.lineWidth = 4;
    g.beginPath(); g.arc(W / 2, H / 2, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 8, 0, Math.PI * 2); g.fillStyle = pal.circle; g.fill();
    g.beginPath(); g.arc(W / 2, 0, 110, 0, Math.PI); g.stroke();
    g.beginPath(); g.arc(W / 2, H, 110, Math.PI, Math.PI * 2); g.stroke();
    g.restore();

    // Goal posts: small bright caps so the mouth reads at a glance.
    g.fillStyle = pal.rimHi;
    for (const [x, y] of [[GOAL_X0, 0], [GOAL_X1, 0], [GOAL_X0, H], [GOAL_X1, H]]) {
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
  }

  function drawMallet(m, body, hi, shape) {
    const R = MALLET_R;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.arc(m.x + 3, m.y + 5, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hi; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(m.x, m.y, R - 7, 0, Math.PI * 2); ctx.stroke();
    // Knob.
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.arc(m.x, m.y, R * 0.45, 0, Math.PI * 2); ctx.fill();
    // Shape marker on the knob.
    ctx.fillStyle = pal.mark;
    const k = R * 0.26;
    ctx.beginPath();
    if (shape === 'tri') {
      ctx.moveTo(m.x, m.y - k); ctx.lineTo(m.x + k * 0.95, m.y + k * 0.7); ctx.lineTo(m.x - k * 0.95, m.y + k * 0.7);
      ctx.closePath();
    } else {
      ctx.rect(m.x - k * 0.8, m.y - k * 0.8, k * 1.6, k * 1.6);
    }
    ctx.fill();
  }

  /** One frame. `flash` 0..1 tints the table (goal flash; the UI skips it under reduced motion). */
  function render(s, flash) {
    const sc = scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(sc, 0, 0, sc, RIM * sc, RIM * sc);

    const p = s.puck;
    if (p.live) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(p.x + 2, p.y + 4, PUCK_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.puck;
      ctx.beginPath(); ctx.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = pal.puckHi; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, PUCK_R - 6, 0, Math.PI * 2); ctx.stroke();
    }
    drawMallet(s.mallets[1], pal.cpu, pal.cpuHi, 'sq');
    drawMallet(s.mallets[0], pal.you, pal.youHi, 'tri');

    if (flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, flash) * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  /** css px (relative to the canvas) -> table units. */
  function toTable(cx, cy) {
    return { x: cx / scale - RIM, y: cy / scale - RIM };
  }

  return { layout, render, toTable, get scale() { return scale; } };
}
