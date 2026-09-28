// air-hockey/js/render.js - draws the table, puck and mallets on one canvas. The table itself
// (surface, air holes, lines, rim, goal slots) is painted ONCE per layout/theme/table choice onto
// an offscreen canvas; a frame is one drawImage, three circles and the effects (a puck TRAIL, hit
// SPARKS, a lit GOAL MOUTH). No allocation per frame: the trail and sparks are fixed typed arrays.
//
// TABLES (2026-09-28): 'classic' (follows the app's light/dark theme), 'arcade', 'neon', 'ice'.
// Purely cosmetic and per phone: two players online can each look at a different table.
//
// Colour is never the only marker (Matt is red/green colourblind): your mallet carries a TRIANGLE
// on its knob, the computer's a SQUARE, and the HUD scores wear the same shapes.

import { TABLE, GOAL_X0, GOAL_X1 } from './physics.js';

const { W, H, RIM, CORNER, PUCK_R, MALLET_R } = TABLE;
const EXT_W = W + RIM * 2, EXT_H = H + RIM * 2;

export const TABLES = ['classic', 'arcade', 'neon', 'ice'];

const PALETTE = {
  arcade: {
    surface: '#ffffff', hole: 'rgba(20,30,60,0.14)', line: '#c8202f', circle: '#1f5fa8',
    rim: '#b3202a', rimHi: '#e2505a', slot: '#1a0306', puck: '#15171c', puckHi: '#555b66',
    you: '#1f5fa8', youHi: '#5a93dc', cpu: '#1c1c1c', cpuHi: '#5a5a5a', mark: '#ffffff',
    spark: '#f2b705', trail: '21,23,28', glow: 0,
  },
  neon: {
    surface: '#07031a', hole: 'rgba(0,245,212,0.10)', line: '#ff2e97', circle: '#00c2ff',
    rim: '#1b0b3a', rimHi: '#9b5de5', slot: '#000000', puck: '#fff200', puckHi: '#ffffff',
    you: '#00c2ff', youHi: '#9be8ff', cpu: '#ff2e97', cpuHi: '#ff9ccf', mark: '#07031a',
    spark: '#fff200', trail: '255,242,0', glow: 1,
  },
  ice: {
    surface: '#f2f9ff', hole: 'rgba(60,110,160,0.12)', line: '#d23a3a', circle: '#2a6fb8',
    rim: '#3a3f47', rimHi: '#6b7380', slot: '#0b0d10', puck: '#101216', puckHi: '#4a4f58',
    you: '#2a6fb8', youHi: '#6aa3e0', cpu: '#d23a3a', cpuHi: '#ee7a7a', mark: '#ffffff',
    spark: '#7fc8ff', trail: '16,18,22', glow: 0,
  },
  light: {
    surface: '#eef5fb', hole: 'rgba(40,70,110,0.16)', line: '#e0532f', circle: '#1f5fa8',
    rim: '#1b2a44', rimHi: '#34507d', slot: '#070b14', puck: '#1d2129', puckHi: '#4a5160',
    you: '#1f5fa8', youHi: '#4d86cc', cpu: '#e0532f', cpuHi: '#f07d5e', mark: '#ffffff',
    spark: '#f2b705', trail: '29,33,41', glow: 0,
  },
  dark: {
    surface: '#0e1b31', hole: 'rgba(160,200,255,0.10)', line: '#e0532f', circle: '#4d86cc',
    rim: '#22324f', rimHi: '#3a5582', slot: '#000000', puck: '#f2b705', puckHi: '#ffd95a',
    you: '#2f74c8', youHi: '#6ea4e6', cpu: '#e0532f', cpuHi: '#f07d5e', mark: '#ffffff',
    spark: '#ffd95a', trail: '242,183,5', glow: 1,
  },
};

const TRAIL = 16;       // puck positions remembered for the trail (one per frame)
const TRAIL_MIN = 150;  // below this speed (table units/s) there is no trail at all
const TRAIL_FULL = 1900; // at and above this, the full-length, full-strength trail
const SPARKS = 32;      // spark pool

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const bg = document.createElement('canvas');
  let scale = 1, dpr = 1, cssW = 0, cssH = 0, pal = PALETTE.light;
  const tx = new Float32Array(TRAIL), ty = new Float32Array(TRAIL);
  let tn = 0, ti = 0;
  const sx = new Float32Array(SPARKS), sy = new Float32Array(SPARKS);
  const svx = new Float32Array(SPARKS), svy = new Float32Array(SPARKS), sl = new Float32Array(SPARKS);
  let sNext = 0;

  /** Fit the table into availW x availH css px. Returns the css size actually used. `table` is one
   *  of TABLES; 'classic' follows the app theme. */
  function layout(availW, availH, dark, table) {
    pal = table && table !== 'classic' && PALETTE[table] ? PALETTE[table] : dark ? PALETTE.dark : PALETTE.light;
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

  /** A burst of sparks where a mallet met the puck; `power` 0..1 sets how many and how fast. */
  function sparks(x, y, power) {
    const n = 4 + Math.round(power * 8);
    for (let i = 0; i < n; i++) {
      const k = sNext; sNext = (sNext + 1) % SPARKS;
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 420 * (0.4 + power);
      sx[k] = x; sy[k] = y; svx[k] = Math.cos(a) * v; svy[k] = Math.sin(a) * v; sl[k] = 0.25 + Math.random() * 0.2;
    }
  }
  function clearFx() { tn = 0; for (let i = 0; i < SPARKS; i++) sl[i] = 0; }

  /** One frame. `fx` = { dt, flash 0..1, goal -1|0|1 (0 = the far goal lit, 1 = yours), goalT
   *  0..1, reduce }. Reduced motion drops the trail, the sparks and the flash (garnish), never the
   *  puck (docs/BUILDING-A-GAME.md, Part 0). */
  function render(s, fx) {
    const sc = scale * dpr;
    const dt = (fx && fx.dt) || 0, reduce = !!(fx && fx.reduce);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(sc, 0, 0, sc, RIM * sc, RIM * sc);

    // The goal mouth that was just scored in, lit and fading.
    if (fx && fx.goal >= 0 && fx.goalT > 0 && !reduce) {
      const gy = fx.goal === 0 ? -RIM : H - 1;
      ctx.globalAlpha = Math.min(1, fx.goalT) * 0.9;
      ctx.fillStyle = pal.spark;
      ctx.fillRect(GOAL_X0, gy, GOAL_X1 - GOAL_X0, RIM + 1);
      ctx.globalAlpha = Math.min(1, fx.goalT) * 0.25;
      ctx.beginPath(); ctx.arc(W / 2, fx.goal === 0 ? 0 : H, 150 * (1.4 - fx.goalT * 0.4), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    const p = s.puck;
    // Trail: where the puck has been. Its LENGTH and its STRENGTH both follow the speed (Matt,
    // 2026-09-28: "a barely moving puck should have a short, faint trail, if any"). The first
    // version kept a fixed 12 positions and only faded in above 650 u/s, so every moving puck
    // wore much the same trail. Now: nothing below TRAIL_MIN; above it the number of past
    // positions drawn grows from 2 to TRAIL with speed (and each is further back, since a fast
    // puck travels further per frame), and the opacity grows too. Drawn as one tapered stroke,
    // segment by segment, so a fast puck's widely spaced samples still read as a streak.
    if (p.live && !reduce) {
      tx[ti] = p.x; ty[ti] = p.y; ti = (ti + 1) % TRAIL; if (tn < TRAIL) tn++;
      const sp = Math.hypot(p.vx, p.vy);
      const f = Math.max(0, Math.min(1, (sp - TRAIL_MIN) / (TRAIL_FULL - TRAIL_MIN)));
      if (f > 0) {
        const n = Math.min(tn, Math.round(2 + (TRAIL - 2) * f));
        const peak = 0.06 + 0.32 * f;
        // Butt ends: round ends overlap at every joint and double the opacity there (beads).
        ctx.lineCap = 'butt';
        for (let k = 1; k < n; k++) {
          const i0 = (ti - k + TRAIL * 2) % TRAIL, i1 = (ti - 1 - k + TRAIL * 2) % TRAIL;
          const fade = 1 - k / n;
          ctx.strokeStyle = `rgba(${pal.trail},${(peak * fade).toFixed(3)})`;
          ctx.lineWidth = PUCK_R * 2 * (0.3 + 0.6 * fade);
          ctx.beginPath(); ctx.moveTo(tx[i0], ty[i0]); ctx.lineTo(tx[i1], ty[i1]); ctx.stroke();
        }
        ctx.lineCap = 'round';
      }
    } else tn = 0;
    if (p.live) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(p.x + 2, p.y + 4, PUCK_R, 0, Math.PI * 2); ctx.fill();
      if (pal.glow) { ctx.shadowColor = pal.puck; ctx.shadowBlur = 18; }
      ctx.fillStyle = pal.puck;
      ctx.beginPath(); ctx.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.puckHi; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, PUCK_R - 6, 0, Math.PI * 2); ctx.stroke();
    }
    drawMallet(s.mallets[1], pal.cpu, pal.cpuHi, 'sq');
    drawMallet(s.mallets[0], pal.you, pal.youHi, 'tri');

    // Sparks.
    if (!reduce) {
      ctx.fillStyle = pal.spark;
      for (let i = 0; i < SPARKS; i++) {
        if (sl[i] <= 0) continue;
        sl[i] -= dt; sx[i] += svx[i] * dt; sy[i] += svy[i] * dt; svx[i] *= 0.9; svy[i] *= 0.9;
        if (sl[i] <= 0) continue;
        ctx.globalAlpha = Math.min(1, sl[i] * 4);
        ctx.fillRect(sx[i] - 2.5, sy[i] - 2.5, 5, 5);
      }
      ctx.globalAlpha = 1;
    }

    const flash = (fx && fx.flash) || 0;
    if (flash > 0 && !reduce) {
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

  return { layout, render, sparks, clearFx, toTable, get scale() { return scale; } };
}
