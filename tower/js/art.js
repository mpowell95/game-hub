// tower/js/art.js — Tower Stack's four looks (Matt, 2026-11-12, from docs/mockups/tower/art-upgrades.html:
// "those are great implement"). Pure drawing: the canvas scene (sky, scenery, ground, blocks) and the
// setup screen's SVG picture + thumbnails. No game state.
//
//   city  = A, skyscraper floors with soft window lights, city at night, moon, street
//   ice   = B, glassy ice blocks, aurora, snowy peaks, falling snow
//   space = C, solid neon-edged blocks, nebula, ringed planet, landing pad
//   toy   = D, toy blocks at sunset, clouds, hills (the one light look)
// The look ids are the stored setting (gamehub.tower.v1) and the recorded mode: never rename them (rule 5).

export const LOOKS = ['city', 'ice', 'space', 'toy'];
const TOY = ['#E0532F', '#F2B705', '#1F5FA8', '#178A7A'];

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function hash(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const neonHue = (i) => ((300 - i * 16) % 360 + 360) % 360;

/** Flat colours of block i (Record towers columns, thumbnails, the hero picture). */
export function slabOf(look, i) {
  if (look === 'ice') return { face: hsl(195, 70, 74), top: hsl(190, 90, 92), side: hsl(200, 55, 48) };
  if (look === 'space') { const h = neonHue(i); return { face: hsl(h, 62, 34), top: hsl(h, 100, 64), side: hsl(h, 70, 20) }; }
  if (look === 'toy') { const c = TOY[i % 4]; return { face: c, top: shade(c, 1.25), side: shade(c, 0.7) }; }
  const h = 215 + (i % 2) * 8;
  return { face: '#c9a77a', top: '#ead2a8', side: '#7d5f3e' };   // warm stone against the cool city (2026-11-12)
}

// --- canvas: cached sky and scenery ------------------------------------------------------------
const SCN_H = 320;   // scenery strip height (CSS px), drawn up from the ground line
// iPhones cap the memory ALL canvases may use; past it a new canvas gives no context (2026-11-12, a frozen frame on
// Matt's phone). So: few cached canvases, memory handed back (width 0) when dropped or the game closes, and null
// when the phone refuses one (the caller then paints straight onto the screen).
const cache = new Map();
function drop(c) { try { c.width = 0; c.height = 0; } catch { /* gone */ } }
export function releaseArt() { for (const c of cache.values()) drop(c); cache.clear(); }
function cached(key, w, h, dpr, paint) {
  let c = cache.get(key);
  if (c) return c;
  if (cache.size >= 6) releaseArt();
  c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  if (!g) { drop(c); return null; }
  g.scale(dpr, dpr);
  paint(g, w, h);
  cache.set(key, c);
  return c;
}
function stars(g, W, maxY, n, seed, op = 0.8) {
  const r = rng(seed);
  g.fillStyle = '#fff';
  for (let i = 0; i < n; i++) {
    const s = r() < 0.15 ? 3 : 2, x = r() * W, y = r() * maxY;
    g.globalAlpha = op * (0.4 + r() * 0.6);
    g.fillRect(x, y, s, s);
  }
  g.globalAlpha = 1;
}
function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}
function glow(g, x, y, r, color) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function cloud(g, cx, cy, s) {
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.beginPath();
  g.arc(cx, cy, 24 * s, 0, Math.PI * 2); g.arc(cx + 26 * s, cy - 10 * s, 30 * s, 0, Math.PI * 2);
  g.arc(cx + 56 * s, cy + 2 * s, 22 * s, 0, Math.PI * 2); g.fill();
  g.fillRect(cx, cy, 56 * s, 22 * s);
}

const SKY = {
  city(g, W, H) {
    g.fillStyle = vgrad(g, 0, H, [[0, '#070d2b'], [0.62, '#2a2a6a'], [0.86, '#8a4a7a'], [1, '#e08a5c']]);
    g.fillRect(0, 0, W, H);
    stars(g, W, H * 0.5, 60, 5);
    glow(g, W * 0.74, H * 0.34, 80, 'rgba(255,246,216,.35)');
    g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(W * 0.74, H * 0.34, 34, 0, Math.PI * 2); g.fill();
  },
  ice(g, W, H) {
    g.fillStyle = vgrad(g, 0, H, [[0, '#03121f'], [0.6, '#0b2f45'], [1, '#1f5a6e']]);
    g.fillRect(0, 0, W, H);
    stars(g, W, H * 0.55, 55, 8);
    // Aurora: soft ribbons built from several wide translucent strokes (no canvas filter: Safari).
    g.lineCap = 'round';
    [[H * 0.24, 46, 0.5], [H * 0.33, 28, 0.35]].forEach(([y0, wid, a]) => {
      [2.2, 1.5, 1].forEach((m) => {
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, 'rgba(63,214,168,0)');
        gr.addColorStop(0.4, `rgba(63,214,168,${(a * 0.32).toFixed(3)})`);
        gr.addColorStop(1, `rgba(120,120,255,${(a * 0.12).toFixed(3)})`);
        g.strokeStyle = gr; g.lineWidth = wid * m;
        g.beginPath(); g.moveTo(-30, y0); g.bezierCurveTo(W * 0.3, y0 - 90, W * 0.5, y0 + 90, W + 40, y0 - 40); g.stroke();
      });
    });
  },
  space(g, W, H) {
    g.fillStyle = '#06030f'; g.fillRect(0, 0, W, H);
    glow(g, W * 0.25, H * 0.3, W * 0.95, 'rgba(220,60,200,.5)');
    glow(g, W * 0.8, H * 0.55, W * 0.85, 'rgba(60,110,255,.45)');
    stars(g, W, H, 110, 21, 0.9);
    const px = W * 0.78, py = H * 0.33;
    const pg = g.createRadialGradient(px - 17, py - 17, 4, px, py, 52);
    pg.addColorStop(0, '#ffb36b'); pg.addColorStop(0.6, '#c2507a'); pg.addColorStop(1, '#3a1850');
    g.fillStyle = pg; g.beginPath(); g.arc(px, py, 48, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(px, py); g.rotate(-0.31);
    g.strokeStyle = 'rgba(255,200,150,.7)'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(0, 0, 84, 16, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    g.globalAlpha = 0.8; g.fillStyle = '#9fb8ff'; g.beginPath(); g.arc(W * 0.15, H * 0.49, 10, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  },
  toy(g, W, H) {
    g.fillStyle = vgrad(g, 0, H, [[0, '#5aa9e6'], [0.55, '#a9d3f0'], [0.85, '#ffd7a8'], [1, '#ffb98a']]);
    g.fillRect(0, 0, W, H);
    glow(g, W * 0.22, H * 0.38, 72, 'rgba(255,233,168,.45)');
    g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(W * 0.22, H * 0.38, 44, 0, Math.PI * 2); g.fill();
    cloud(g, W * 0.15, H * 0.29, 1); cloud(g, W * 0.7, H * 0.23, 0.8); cloud(g, W * 0.82, H * 0.48, 0.7);
  },
};
// Scenery: drawn with its foot at y = SCN_H. `base` fills down to the ground when the camera rises.
const SCENERY = {
  city: { base: '#141a3c', paint(g, W) {
    const r = rng(9), B = SCN_H;
    g.globalAlpha = 0.55; g.fillStyle = '#332f66';
    for (let x = -10; x < W; x += 34) { const h = 120 + r() * 160; g.fillRect(x, B - h, 30, h); if (r() < 0.4) g.fillRect(x + 13, B - h - 18, 3, 18); }
    g.globalAlpha = 1;
    for (let x = -20; x < W; x += 58) {
      const h = 70 + r() * 110;
      g.fillStyle = '#141a3c'; g.fillRect(x, B - h, 50, h);
      g.fillStyle = 'rgba(226,190,120,.45)';
      for (let y = B - h + 10; y < B - 10; y += 13) for (let c = 0; c < 4; c++) if (r() < 0.35) g.fillRect(x + 6 + c * 11, y, 6, 7);
    }
  } },
  ice: { base: '#2c5368', paint(g, W) {
    const B = SCN_H;
    // Darker than the ice blocks in front of them (2026-11-12: pale peaks behind pale glass were hard to tell apart).
    g.fillStyle = vgrad(g, B - 260, B, [[0, '#9cbfd1'], [0.35, '#4d7a90'], [1, '#22465a']]);
    g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(-10, B); g.lineTo(W * 0.2, B - 210); g.lineTo(W * 0.32, B - 150); g.lineTo(W * 0.5, B - 260);
    g.lineTo(W * 0.72, B - 120); g.lineTo(W * 0.85, B - 190); g.lineTo(W + 20, B); g.closePath(); g.fill();
    g.globalAlpha = 1; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(W * 0.2, B - 210); g.lineTo(W * 0.2 - 18, B - 175); g.lineTo(W * 0.2 + 8, B - 182); g.lineTo(W * 0.2 + 20, B - 168); g.lineTo(W * 0.2 + 30, B - 180); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(W * 0.5, B - 260); g.lineTo(W * 0.5 - 22, B - 220); g.lineTo(W * 0.5 + 4, B - 228); g.lineTo(W * 0.5 + 22, B - 210); g.lineTo(W * 0.5 + 34, B - 230); g.closePath(); g.fill();
  } },
  space: null,
  toy: { base: '#6aae5a', paint(g, W) {
    const B = SCN_H;
    g.fillStyle = '#8cc47a';
    g.beginPath(); g.moveTo(0, B - 60); g.quadraticCurveTo(W * 0.22, B - 140, W * 0.47, B - 70); g.quadraticCurveTo(W * 0.72, B, W, B - 90); g.lineTo(W, B); g.lineTo(0, B); g.closePath(); g.fill();
    g.fillStyle = '#6aae5a';
    g.beginPath(); g.moveTo(0, B - 20); g.quadraticCurveTo(W * 0.3, B - 80, W * 0.65, B - 25); g.quadraticCurveTo(W * 0.85, B + 5, W, B - 30); g.lineTo(W, B); g.lineTo(0, B); g.closePath(); g.fill();
  } },
};

/** Sky + scenery + ground. `gy` = the screen y of the scenery's foot (it scrolls slower than the tower),
 *  `groundY` = the screen y of the real ground line, `t` = seconds (falling snow). */
export function drawBackdrop(ctx, look, W, H, dpr, gy, groundY, t) {
  if (!SKY[look]) look = 'city';
  const sky = cached(`sky|${look}|${W}|${H}|${dpr}`, W, H, dpr, SKY[look]);
  if (sky) ctx.drawImage(sky, 0, 0, W, H);
  else { ctx.save(); SKY[look](ctx, W, H); ctx.restore(); }
  const sc = SCENERY[look];
  if (sc) {
    const img = cached(`scn|${look}|${W}|${dpr}`, W, SCN_H, dpr, (g, w) => sc.paint(g, w));
    if (img) ctx.drawImage(img, 0, gy - SCN_H, W, SCN_H);
    else { ctx.save(); ctx.translate(0, gy - SCN_H); sc.paint(ctx, W); ctx.restore(); }
    if (groundY > gy) { ctx.fillStyle = sc.base; ctx.fillRect(0, gy - 1, W, groundY - gy + 2); }
  }
  if (look === 'ice') {
    const r = rng(77);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 45; i++) {
      const x0 = r() * W, y0 = r() * H, sp = 18 + r() * 26, rad = 1 + r() * 2.2, a = 0.4 + r() * 0.5;
      const y = (y0 + t * sp) % Math.max(1, groundY);
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x0 + Math.sin(t * 0.8 + i) * 8, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawGround(ctx, look, W, H, groundY);
}

function drawGround(ctx, look, W, H, y) {
  if (y >= H) return;
  if (look === 'ice') {
    ctx.fillStyle = '#d9eef7'; ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(W * 0.25, y - 10, W * 0.5, y); ctx.quadraticCurveTo(W * 0.75, y + 10, W, y);
    ctx.lineTo(W, y + 6); ctx.lineTo(0, y + 6); ctx.closePath(); ctx.fill();
    return;
  }
  if (look === 'space') {
    ctx.fillStyle = vgrad(ctx, y, H, [[0, '#2a2140'], [1, '#0c0818']]); ctx.fillRect(0, y, W, H - y);
    ctx.strokeStyle = 'rgba(54,240,255,.25)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; y + k * 22 < H; k++) { ctx.moveTo(0, y + k * 22); ctx.lineTo(W, y + k * 22); }
    for (let k = -4; k <= 4; k++) { ctx.moveTo(W / 2, y); ctx.lineTo(W / 2 + k * 110 * (W / 402), H); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(54,240,255,.25)'; ctx.fillRect(0, y - 3, W, 9);   // the glow, without shadowBlur
    ctx.fillStyle = '#36f0ff'; ctx.fillRect(0, y, W, 3);
    return;
  }
  if (look === 'toy') {
    ctx.fillStyle = '#c9a26b'; ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = '#7fbf63'; ctx.fillRect(0, y, W, 10);
    return;
  }
  // city: a street with lane marks and two lamps
  ctx.fillStyle = '#1b1f33'; ctx.fillRect(0, y, W, H - y);
  ctx.fillStyle = '#5a6280'; ctx.fillRect(0, y, W, 8);
  ctx.fillStyle = '#e8c35a';
  for (let x = 10; x < W; x += 64) ctx.fillRect(x, y + 52, 34, 5);
  [40, W - 44].forEach((lx) => {
    ctx.fillStyle = '#2b3150'; ctx.fillRect(lx, y - 70, 4, 70);
    glow(ctx, lx + 2, y - 72, 22, 'rgba(255,231,160,.3)');
    ctx.fillStyle = '#ffe7a0'; ctx.beginPath(); ctx.arc(lx + 2, y - 72, 7, 0, Math.PI * 2); ctx.fill();
  });
}

/** The soft shadow under the tower, in world-drawing coordinates (ground at y = 0). */
export function drawShadow(ctx, look, cx, w) {
  const col = { city: 'rgba(0,0,0,.35)', ice: 'rgba(40,110,150,.25)', toy: 'rgba(60,40,10,.25)' }[look];
  if (!col) return;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(cx, 10, w * 0.6, 10, 0, 0, Math.PI * 2); ctx.fill();
}

/** The best line's colours per look: [line, label background, label text]. */
export function bestLineStyle(look) {
  return {
    city: ['rgba(255,215,116,.95)', '#ffd774', '#16243a'],
    ice: ['rgba(255,255,255,.9)', 'rgba(0,0,0,.45)', '#fff'],
    space: ['rgba(54,240,255,.9)', '#36f0ff', '#06030f'],
    toy: ['rgba(22,36,58,.75)', 'rgba(22,36,58,.75)', '#fff'],
  }[look] || ['rgba(255,255,255,.9)', 'rgba(0,0,0,.45)', '#fff'];
}

// Oblique 3D: front face, a top face and a right side face (depth dx, dy).
function box3d(ctx, x, y, w, h, dx, dy, face, top, side) {
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w + dx, y + dy); ctx.lineTo(x + dx, y + dy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = side;
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + dx, y + dy); ctx.lineTo(x + w + dx, y + h + dy); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = face; ctx.fillRect(x, y, w, h);
}
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** One block (level i) at screen rect x, y, w, h (y = its top). `k` = px per world unit. */
export function drawBlock(ctx, look, x, y, w, h, i, k, alpha = 1) {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (w < 1) { x -= (1 - w) / 2; w = 1; }   // a sliver stays visible (2026-11-12 review)
  ctx.save();
  ctx.globalAlpha = alpha;
  const dx = 12 * k, dy = -9 * k;
  if (look === 'ice') {
    const face = ctx.createLinearGradient(0, y, 0, y + h);
    face.addColorStop(0, 'rgba(206,246,255,.98)'); face.addColorStop(1, 'rgba(104,192,230,.97)');   // near solid (2026-11-12)
    box3d(ctx, x, y, w, h, dx * 0.85, dy * 0.9, face, 'rgba(235,252,255,.95)', 'rgba(60,140,185,.85)');
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + h); ctx.lineTo(x + w * 0.22, y + h); ctx.lineTo(x + w * 0.42, y); ctx.lineTo(x + w * 0.32, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h); ctx.lineTo(x + w * 0.54, y + h); ctx.lineTo(x + w * 0.74, y); ctx.lineTo(x + w * 0.7, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  } else if (look === 'space') {
    const hue = neonHue(i), p = Math.min(2 * k, w / 4, h / 4);
    rrect(ctx, x + p, y + p, w - 2 * p, h - 2 * p, 4 * k);
    ctx.fillStyle = hsl(hue, 62, 34); ctx.fill();
    ctx.fillStyle = hsl(hue, 85, 62, 0.35);
    rrect(ctx, x + p, y + p, w - 2 * p, (h - 2 * p) * 0.45, 4 * k); ctx.fill();
    ctx.fillStyle = hsl(hue, 70, 20);
    rrect(ctx, x + p, y + h - 9 * k, w - 2 * p, 7 * k, 3 * k); ctx.fill();
    // The glow: a wide faint stroke under the bright one (shadowBlur cost ~30 ms a frame on a tall tower).
    rrect(ctx, x + p, y + p, w - 2 * p, h - 2 * p, 4 * k);
    ctx.strokeStyle = hsl(hue, 100, 64, 0.28); ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = hsl(hue, 100, 64); ctx.lineWidth = 2.5; ctx.stroke();
  } else if (look === 'toy') {
    const c = TOY[((i % 4) + 4) % 4];
    box3d(ctx, x, y, w, h, dx * 0.85, dy * 0.9, c, shade(c, 1.25), shade(c, 0.7));
    ctx.fillStyle = shade(c, 0.8); ctx.fillRect(x, y + h - 4 * k, w, 4 * k);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x, y, w, 3 * k);
  } else {
    const face = ctx.createLinearGradient(x, 0, x + w, 0);
    // WARM STONE against the cool blue-purple city (2026-11-12, Matt: "The piece is too close to the background. It's
    // tough to tell them apart"; the blue-grey floors matched the buildings). Blue vs yellow-brown also reads for
    // red/green colour blindness. A light edge outlines every floor.
    face.addColorStop(0, '#d2b083'); face.addColorStop(1, '#b8925f');
    box3d(ctx, x, y, w, h, dx, dy, face, '#efd9b0', '#7d5f3e');
    ctx.strokeStyle = 'rgba(255,240,210,.55)'; ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x, y, w, 3 * k);
    // Windows: fixed per floor and column (no flicker); about half lit, a soft warm glow.
    let n = 0;
    for (let wx = x + 7 * k; wx + 9 * k < x + w - 4 * k; wx += 15 * k, n++) {
      ctx.fillStyle = hash(i + 1, n + 1) < 0.45 ? '#ffe3a3' : '#3b3148';
      ctx.fillRect(wx, y + 11 * k, 9 * k, 17 * k);
    }
  }
  ctx.restore();
}

// --- SVG: the setup screen's picture and the look thumbnails ------------------------------------
function svgBox(x, y, w, h, dx, dy, c) {
  return `<polygon points="${x},${y} ${x + w},${y} ${x + w + dx},${y + dy} ${x + dx},${y + dy}" fill="${c.top}"/>`
    + `<polygon points="${x + w},${y} ${x + w + dx},${y + dy} ${x + w + dx},${y + h + dy} ${x + w},${y + h}" fill="${c.side}"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.face}"/>`;
}
export function svgBlock(look, x, y, w, h, i, s) {
  const c = slabOf(look, i);
  if (look === 'space') {
    return `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="${2 * s}" fill="${c.face}" stroke="${c.top}" stroke-width="${Math.max(1, 1.6 * s)}"/>`;
  }
  if (look === 'ice') {
    return svgBox(x, y, w, h, 6 * s, -4.5 * s, { face: 'rgba(170,230,250,.95)', top: '#ebfcff', side: 'rgba(60,140,185,.9)' })
      + `<polygon points="${x + w * 0.15},${y + h} ${x + w * 0.25},${y + h} ${x + w * 0.42},${y} ${x + w * 0.32},${y}" fill="rgba(255,255,255,.4)"/>`;
  }
  let out = svgBox(x, y, w, h, 6 * s, -4.5 * s, c);
  if (look === 'city') {
    let n = 0;
    for (let wx = x + 4 * s; wx + 5 * s < x + w - 2 * s; wx += 8 * s, n++) {
      out += `<rect x="${wx.toFixed(1)}" y="${(y + h * 0.28).toFixed(1)}" width="${(5 * s).toFixed(1)}" height="${(h * 0.44).toFixed(1)}" fill="${hash(i + 1, n + 1) < 0.45 ? '#ffe3a3' : '#3b3148'}"/>`;
    }
  }
  return out;
}
function svgScene(look, W, H, gy) {
  if (look === 'ice') {
    return `<defs><linearGradient id="tws-ice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03121f"/><stop offset="1" stop-color="#1f5a6e"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#tws-ice)"/>
      <path d="M-10 ${H * 0.3} C ${W * 0.3} ${H * 0.12}, ${W * 0.55} ${H * 0.45}, ${W + 10} ${H * 0.22}" stroke="rgba(63,214,168,.35)" stroke-width="${H * 0.09}" fill="none" stroke-linecap="round"/>
      <path d="M-10 ${gy} L${W * 0.2} ${gy - H * 0.4} L${W * 0.36} ${gy - H * 0.25} L${W * 0.55} ${gy - H * 0.48} L${W * 0.78} ${gy - H * 0.22} L${W + 10} ${gy}Z" fill="#4d7a90"/>
      <path d="M${W * 0.55} ${gy - H * 0.48} L${W * 0.5} ${gy - H * 0.38} L${W * 0.58} ${gy - H * 0.4}Z" fill="#fff"/>
      <rect y="${gy}" width="${W}" height="${H - gy}" fill="#d9eef7"/>`;
  }
  if (look === 'space') {
    return `<defs><radialGradient id="tws-neb" cx=".25" cy=".3" r=".7"><stop offset="0" stop-color="rgba(220,60,200,.55)"/><stop offset="1" stop-color="rgba(220,60,200,0)"/></radialGradient>
      <radialGradient id="tws-pl" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#ffb36b"/><stop offset=".6" stop-color="#c2507a"/><stop offset="1" stop-color="#3a1850"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="#06030f"/><rect width="${W}" height="${H}" fill="url(#tws-neb)"/>
      <g fill="#fff">${[[.1, .1], [.3, .25], [.85, .12], [.6, .08], [.15, .5], [.92, .55], [.45, .4]].map(([a, b]) => `<rect x="${W * a}" y="${H * b}" width="2" height="2"/>`).join('')}</g>
      <circle cx="${W * 0.8}" cy="${H * 0.26}" r="${H * 0.09}" fill="url(#tws-pl)"/>
      <ellipse cx="${W * 0.8}" cy="${H * 0.26}" rx="${H * 0.16}" ry="${H * 0.03}" fill="none" stroke="rgba(255,200,150,.7)" stroke-width="${Math.max(1, H * 0.012)}" transform="rotate(-18 ${W * 0.8} ${H * 0.26})"/>
      <rect y="${gy}" width="${W}" height="${H - gy}" fill="#1c1530"/><rect y="${gy}" width="${W}" height="${Math.max(1, H * 0.01)}" fill="#36f0ff"/>`;
  }
  if (look === 'toy') {
    return `<defs><linearGradient id="tws-toy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9e6"/><stop offset=".6" stop-color="#a9d3f0"/><stop offset="1" stop-color="#ffd7a8"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#tws-toy)"/>
      <circle cx="${W * 0.2}" cy="${H * 0.3}" r="${H * 0.1}" fill="#ffe9a8"/>
      <g fill="#fff" opacity=".92"><circle cx="${W * 0.7}" cy="${H * 0.2}" r="${H * 0.06}"/><circle cx="${W * 0.78}" cy="${H * 0.17}" r="${H * 0.075}"/><circle cx="${W * 0.86}" cy="${H * 0.2}" r="${H * 0.055}"/><rect x="${W * 0.7}" y="${H * 0.2}" width="${W * 0.16}" height="${H * 0.05}"/></g>
      <path d="M0 ${gy - H * 0.12} Q ${W * 0.3} ${gy - H * 0.3} ${W * 0.6} ${gy - H * 0.1} T ${W} ${gy - H * 0.14} L${W} ${gy} L0 ${gy}Z" fill="#8cc47a"/>
      <rect y="${gy}" width="${W}" height="${H - gy}" fill="#c9a26b"/><rect y="${gy}" width="${W}" height="${Math.max(1, H * 0.02)}" fill="#7fbf63"/>`;
  }
  const r = rng(9);
  let city = '';
  for (let x = -4; x < W; x += W * 0.14) { const h = H * (0.15 + r() * 0.25); city += `<rect x="${x.toFixed(1)}" y="${(gy - h).toFixed(1)}" width="${(W * 0.12).toFixed(1)}" height="${h.toFixed(1)}"/>`; }
  return `<defs><linearGradient id="tws-city" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d2b"/><stop offset=".65" stop-color="#2a2a6a"/><stop offset="1" stop-color="#8a4a7a"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#tws-city)"/>
    <circle cx="${W * 0.78}" cy="${H * 0.24}" r="${H * 0.13}" fill="rgba(255,246,216,.25)"/><circle cx="${W * 0.78}" cy="${H * 0.24}" r="${H * 0.075}" fill="#fff6d8"/>
    <g fill="#141a3c">${city}</g>
    <rect y="${gy}" width="${W}" height="${H - gy}" fill="#1b1f33"/><rect y="${gy}" width="${W}" height="${Math.max(1, H * 0.015)}" fill="#5a6280"/>`;
}

/** The setup screen's picture: a short tower in the chosen look. */
export function heroSVG(look) {
  if (LOOKS.indexOf(look) < 0) look = 'city';
  const W = 250, H = 250, gy = 218, bh = 20;
  let blocks = '';
  let x = 50, w = 150;
  const offs = [0, 6, -4, 0, 8, 0, -5, 3, 0];
  for (let i = 0; i < 9; i++) {
    x += offs[i] > 0 ? offs[i] : 0; w -= Math.abs(offs[i]);
    blocks += svgBlock(look, x, gy - (i + 1) * bh, w, bh, i, 1);
  }
  blocks += svgBlock(look, x + 34, gy - 10 * bh, w, bh, 9, 1);
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${svgScene(look, W, H, gy)}${blocks}</svg>`;
}

/** A look button's small picture. */
export function lookThumb(look) {
  const W = 100, H = 44, gy = 40, bh = 7;
  const b = [[36, 26], [38, 22], [39, 19]].map(([x, w], i) => svgBlock(look, x, gy - (i + 1) * bh, w, bh, i, 0.45)).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svgScene(look, W, H, gy)}${b}</svg>`;
}

export default { LOOKS, slabOf, drawBackdrop, drawShadow, drawBlock, bestLineStyle, heroSVG, lookThumb, svgBlock, releaseArt };
