// shove-off/js/art.js - everything Shove Off DRAWS (2026-11-18): the three looks' pieces (sumo wrestlers,
// bumper cars, pucks; two colours each), the platform each look plays on, arrows, falls. Canvas 2D,
// original vector art, no images. Trig lives HERE (drawing only), never in engine.js.
//
// COLOURBLIND-SAFE (Matt is red/green colourblind): the two sides always differ by a SHAPE marker, never
// colour alone: side 'a' (the challenger) wears a white CIRCLE, side 'b' a white TRIANGLE. Colours come
// from the hub's safe palette (vermilion, blue, yellow, teal) plus black and white for the pucks.

export const LOOKS = ['sumo0', 'sumo1', 'car0', 'car1', 'puck0', 'puck1'];
export const KINDS = ['sumo', 'car', 'puck'];
const COLORS = {
  sumo: [{ main: '#E0532F', dark: '#9c3017' }, { main: '#1F5FA8', dark: '#123c6e' }],
  car: [{ main: '#F2B705', dark: '#a67c00' }, { main: '#178A7A', dark: '#0c5a4f' }],
  puck: [{ main: '#262a33', dark: '#0d0f14', light: '#5b6274' }, { main: '#f1eee6', dark: '#b9b3a3', light: '#ffffff' }],
};
export const kindOf = (look) => (String(look || '').replace(/\d+$/, '') || 'sumo');
export const colorIdx = (look) => (String(look || '').endsWith('1') ? 1 : 0);
/** The look each SIDE is drawn in: a side's own choice, but if both chose the identical look, side 'b'
 *  is drawn in that look's other colour (the shape marker still tells them apart too). */
export function sideLooks(lookA, lookB) {
  const a = LOOKS.includes(lookA) ? lookA : 'sumo0';
  let b = LOOKS.includes(lookB) ? lookB : 'sumo0';
  if (a === b) b = kindOf(b) + (colorIdx(b) ? '0' : '1');
  return { a, b };
}
export function lookColor(look) { return COLORS[kindOf(look)][colorIdx(look)]; }

// --- surroundings and platform, per the VIEWER's look --------------------------------------------
const SCENE = {
  sumo: { bg0: '#2a1712', bg1: '#120806', plat: '#d9b77e', plat2: '#c99f5f', edge: '#f1dcae', rope: '#e8d7a0', ropeDk: '#a88d4f', line: '#ffffff' },
  car: { bg0: '#1f6fa8', bg1: '#0d3f66', plat: '#5d6b7c', plat2: '#4d5a69', edge: '#f2b705', rope: '#1b1f27', ropeDk: '#0b0d12', line: '#e9eef5' },
  puck: { bg0: '#2b2f3a', bg1: '#14161c', plat: '#eef3f8', plat2: '#dde6ef', edge: '#8a98ab', rope: '#3d6fb0', ropeDk: '#244a7c', line: '#E0532F' },
};

/** The ground around the platform (fills the canvas). `t` = seconds, for the water's movement. */
export function drawSurround(ctx, kind, W, H, t = 0) {
  const s = SCENE[kind] || SCENE.sumo;
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, s.bg0); g.addColorStop(1, s.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (kind === 'car') {
    // water: soft ripples drifting
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 2;
    const step = 34;
    for (let y = -step; y < H + step; y += step) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yy = y + Math.sin((x / 46) + t * 1.4 + y * 0.07) * 4;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else if (kind === 'sumo') {
    // a dark hall: floor boards and a warm glow
    ctx.strokeStyle = 'rgba(255,220,180,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  } else {
    // a games room floor: dark tiles
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    const tile = 40;
    for (let y = 0; y < H; y += tile) for (let x = ((y / tile) % 2) * tile; x < W; x += tile * 2) ctx.fillRect(x, y, tile, tile);
  }
  ctx.restore();
}

/** The platform, a square of half-size `half` px centred at (cx, cy). */
export function drawPlatform(ctx, kind, cx, cy, half) {
  const s = SCENE[kind] || SCENE.sumo;
  const x0 = cx - half, y0 = cy - half, w = half * 2;
  ctx.save();
  // drop shadow onto the surroundings
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x0 + half * 0.03, y0 + half * 0.05, w, w, half * 0.06); ctx.fill();
  // body
  const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + w);
  g.addColorStop(0, s.plat); g.addColorStop(1, s.plat2);
  ctx.fillStyle = g;
  roundRect(ctx, x0, y0, w, w, half * 0.06); ctx.fill();
  if (kind === 'sumo') {
    // the straw-bale ring (tawara) inset, with its knots, and the two white start lines
    ctx.lineWidth = Math.max(3, half * 0.05);
    ctx.strokeStyle = s.ropeDk;
    roundRect(ctx, x0 + half * 0.1, y0 + half * 0.1, w - half * 0.2, w - half * 0.2, half * 0.05); ctx.stroke();
    ctx.lineWidth = Math.max(2, half * 0.03);
    ctx.strokeStyle = s.rope;
    roundRect(ctx, x0 + half * 0.1, y0 + half * 0.1, w - half * 0.2, w - half * 0.2, half * 0.05); ctx.stroke();
    ctx.fillStyle = s.line;
    ctx.fillRect(cx - half * 0.2, cy - half * 0.16, half * 0.4, Math.max(2, half * 0.018));
    ctx.fillRect(cx - half * 0.2, cy + half * 0.14, half * 0.4, Math.max(2, half * 0.018));
    // sand texture
    ctx.fillStyle = 'rgba(120,80,30,0.08)';
    for (let i = 0; i < 60; i++) { const a = (i * 137.5) % 360, r = (i * 37) % 100; ctx.fillRect(cx + Math.cos(a) * half * r / 110, cy + Math.sin(a) * half * r / 110, 2, 2); }
  } else if (kind === 'car') {
    // a rubber arena floor with a checker band, ringed by a striped tyre wall
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const cell = Math.max(10, half / 6);
    for (let x = x0 + cell; x < x0 + w; x += cell) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + w); ctx.stroke(); }
    for (let y = y0 + cell; y < y0 + w; y += cell) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke(); }
    ctx.strokeStyle = s.line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(2, half * 0.02);
    ctx.beginPath(); ctx.arc(cx, cy, half * 0.32, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    // an air table: blue lines, a centre circle, a red centre line, tiny air holes
    ctx.fillStyle = 'rgba(60,80,110,0.18)';
    const hole = Math.max(9, half / 9);
    for (let y = y0 + hole / 2; y < y0 + w; y += hole) for (let x = x0 + hole / 2; x < x0 + w; x += hole) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    ctx.strokeStyle = s.rope;
    ctx.lineWidth = Math.max(2, half * 0.022);
    ctx.beginPath(); ctx.arc(cx, cy, half * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = s.line;
    ctx.beginPath(); ctx.moveTo(x0 + half * 0.06, cy); ctx.lineTo(x0 + w - half * 0.06, cy); ctx.stroke();
  }
  // the edge: a bright lip so the drop is obvious
  ctx.lineWidth = Math.max(3, half * 0.035);
  ctx.strokeStyle = s.edge;
  roundRect(ctx, x0, y0, w, w, half * 0.06); ctx.stroke();
  if (kind === 'car') {
    // tyre wall: dark with yellow stripes
    ctx.setLineDash([Math.max(6, half * 0.08), Math.max(6, half * 0.08)]);
    ctx.strokeStyle = s.rope;
    roundRect(ctx, x0, y0, w, w, half * 0.06); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** The previous (larger) platform melting away: a faint outline. */
export function drawGhostEdge(ctx, kind, cx, cy, half, alpha) {
  if (alpha <= 0) return;
  const s = SCENE[kind] || SCENE.sumo;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = s.plat2;
  ctx.beginPath();
  roundRectPath(ctx, cx - half, cy - half, half * 2, half * 2, half * 0.06);
  ctx.fill();
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); }

// --- pieces ---------------------------------------------------------------------------------------
/**
 * One piece at (x, y) px, radius r px, facing `ang` radians (0 = right), in `look`, wearing side
 * `side`'s marker. `o` = { alpha, scale, ring } (ring: highlight it as selectable).
 */
export function drawPiece(ctx, x, y, r, look, side, ang = 0, o = {}) {
  const kind = kindOf(look);
  const c = lookColor(look);
  const sc = o.scale == null ? 1 : o.scale;
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(r * 0.08, r * 0.14, r * 1.02, r * 0.98, 0, 0, Math.PI * 2); ctx.fill();
  if (o.ring) {
    ctx.strokeStyle = '#ffce3a';
    ctx.lineWidth = Math.max(2.5, r * 0.12);
    ctx.setLineDash([r * 0.3, r * 0.2]);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.rotate(ang);
  if (kind === 'sumo') drawSumo(ctx, r, c);
  else if (kind === 'car') drawCar(ctx, r, c);
  else drawPuck(ctx, r, c);
  ctx.rotate(-ang);
  drawMarker(ctx, side, r, kind);
  ctx.restore();
}

function drawSumo(ctx, r, c) {
  const skin = '#f0c49a', skinDk = '#c98f62';
  // arms, reaching forward
  ctx.fillStyle = skinDk;
  ctx.beginPath(); ctx.ellipse(r * 0.38, -r * 0.72, r * 0.36, r * 0.24, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 0.38, r * 0.72, r * 0.36, r * 0.24, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(r * 0.62, -r * 0.62, r * 0.19, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.62, r * 0.62, r * 0.19, 0, Math.PI * 2); ctx.fill();
  // body
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffe0c0'); g.addColorStop(1, skinDk);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill();
  // mawashi (belt) seen from above, as a band around the hips, and its knot at the back
  ctx.strokeStyle = c.main;
  ctx.lineWidth = r * 0.22;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = r * 0.05;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.89, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = c.main;
  ctx.beginPath(); ctx.ellipse(-r * 0.86, 0, r * 0.2, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  // head: dark hair, the topknot bun pointing back
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath(); ctx.arc(r * 0.18, 0, r * 0.36, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-r * 0.12, 0, r * 0.2, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(r * 0.24, -r * 0.12, r * 0.12, 0, Math.PI * 2); ctx.fill();
}

function drawCar(ctx, r, c) {
  // rubber bumper ring
  ctx.fillStyle = '#20232b';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = r * 0.05;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2); ctx.stroke();
  // body
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, c.main); g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill();
  // bonnet stripe
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(r * 0.2, -r * 0.1, r * 0.55, r * 0.2);
  // seat (back) and the driver
  ctx.fillStyle = '#2b2f3a';
  ctx.beginPath(); ctx.ellipse(-r * 0.32, 0, r * 0.22, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0c49a';
  ctx.beginPath(); ctx.arc(-r * 0.12, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e7ecf4';
  ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 0.2, Math.PI * 0.6, Math.PI * 1.4); ctx.lineTo(-r * 0.15, 0); ctx.fill();
  // steering wheel
  ctx.strokeStyle = '#e7ecf4';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.16, 0, Math.PI * 2); ctx.stroke();
  // the pole to the ceiling net, seen from above as a dot at the back
  ctx.fillStyle = '#9aa3b2';
  ctx.beginPath(); ctx.arc(-r * 0.62, 0, r * 0.08, 0, Math.PI * 2); ctx.fill();
}

function drawPuck(ctx, r, c) {
  ctx.fillStyle = c.dark;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, c.light); g.addColorStop(1, c.main);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.dark;
  ctx.globalAlpha *= 0.6;
  ctx.lineWidth = r * 0.06;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha /= 0.6;
}

/** The side marker: a white circle ('a') or a white triangle ('b') on a dark disc, never colour alone. */
export function drawMarker(ctx, side, r, kind = 'sumo') {
  const m = r * 0.3;
  const cx = kind === 'sumo' ? -r * 0.42 : kind === 'car' ? r * 0.5 : 0;
  ctx.save();
  ctx.fillStyle = 'rgba(15,18,26,0.82)';
  ctx.beginPath(); ctx.arc(cx, 0, m * 1.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  if (side === 'b') {
    ctx.beginPath();
    ctx.moveTo(cx, -m * 0.82);
    ctx.lineTo(cx + m * 0.76, m * 0.56);
    ctx.lineTo(cx - m * 0.76, m * 0.56);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(cx, 0, m * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** An aim arrow from (x, y) by (dx, dy) px. `mine` arrows are bold yellow; replayed ones lighter. */
export function drawArrow(ctx, x, y, dx, dy, r, o = {}) {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len;
  const sx = x + ux * r * 1.05, sy = y + uy * r * 1.05;
  const ex = x + dx, ey = y + dy;
  if (len <= r * 1.05) return;
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(7, r * 0.36);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = o.color || '#ffce3a';
  ctx.lineWidth = Math.max(4, r * 0.22);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex - ux * r * 0.3, ey - uy * r * 0.3); ctx.stroke();
  const hw = Math.max(9, r * 0.42), hl = Math.max(12, r * 0.6);
  ctx.fillStyle = o.color || '#ffce3a';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ex + ux * hl * 0.25, ey + uy * hl * 0.25);
  ctx.lineTo(ex - ux * hl + -uy * hw, ey - uy * hl + ux * hw);
  ctx.lineTo(ex - ux * hl - -uy * hw, ey - uy * hl - ux * hw);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** A splash ring where a piece went in. `k` 0..1 over the splash's life. */
export function drawSplash(ctx, kind, x, y, r, k) {
  if (k <= 0 || k >= 1) return;
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = kind === 'car' ? '#ffffff' : kind === 'sumo' ? '#f1dcae' : '#cfd8e6';
  ctx.lineWidth = Math.max(2, r * 0.12 * (1 - k));
  ctx.beginPath(); ctx.arc(x, y, r * (0.6 + k * 1.2), 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * (0.3 + k * 0.7), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** A look's picker thumbnail: its platform corner and one piece, drawn into `canvas` (CSS size w x h). */
export function drawThumb(canvas, look, w, h, dpr = 1) {
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const kind = kindOf(look);
  drawSurround(ctx, kind, w, h, 0);
  drawPlatform(ctx, kind, w / 2, h / 2, Math.min(w, h) * 0.42);
  drawPiece(ctx, w / 2, h / 2, Math.min(w, h) * 0.26, look, 'a', -Math.PI / 2);
}

/** A small piece icon for the score bar (pieces left), into `canvas` at CSS size `s`. */
export function drawIcon(canvas, look, side, s, dpr = 1, out = false) {
  canvas.width = Math.round(s * dpr); canvas.height = Math.round(s * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, s, s);
  drawPiece(ctx, s / 2, s / 2, s * 0.4, look, side, -Math.PI / 2, { alpha: out ? 0.22 : 1 });
}
