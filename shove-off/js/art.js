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
  sumo: [{ main: '#E0532F', dark: '#8f2a12', light: '#f08a6c' }, { main: '#1F5FA8', dark: '#0f3260', light: '#5f93d4' }],
  car: [{ main: '#F2B705', dark: '#a67c00', light: '#ffd84d' }, { main: '#178A7A', dark: '#0c5a4f', light: '#3fbfac' }],
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
  sumo: { bg0: '#2a1712', bg1: '#120806', plat: '#c79a5e', plat2: '#ad8047', edge: '#e6d39a', rope: '#e3cf8f', ropeDk: '#7d6430', line: '#ffffff' },
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

/** The platform centred at (cx, cy): rv 2's CIRCLE of radius `half` px (`shape` 'circle'), or rv 1's square of
 *  half-size `half` px (matches made before 2026-11-18 keep their square). */
export function drawPlatform(ctx, kind, cx, cy, half, shape = 'square') {
  if (shape === 'circle') { drawRing(ctx, kind, cx, cy, half); return; }
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
    // a DOHYO: the square clay mound, the swept sand band (janome) round the straw circle, the circle of
    // straw bales (tawara) with its gaps, and the two white shikiri lines where the wrestlers crouch
    const rr = half * 0.84;
    ctx.fillStyle = 'rgba(255,240,210,0.22)';
    ctx.beginPath(); ctx.arc(cx, cy, rr + half * 0.08, 0, Math.PI * 2); ctx.fill();
    const bale = Math.max(4, half * 0.075);
    ctx.lineCap = 'butt';
    ctx.lineWidth = bale + 2; ctx.strokeStyle = s.ropeDk;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = bale; ctx.strokeStyle = s.rope;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    // the bales' ties, and the four gaps (tokudawara) at the sides
    ctx.strokeStyle = s.ropeDk; ctx.lineWidth = Math.max(1, half * 0.012);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const c1 = Math.cos(a), s1 = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(cx + c1 * (rr - bale / 2), cy + s1 * (rr - bale / 2)); ctx.lineTo(cx + c1 * (rr + bale / 2), cy + s1 * (rr + bale / 2)); ctx.stroke();
    }
    ctx.lineWidth = bale + 3; ctx.strokeStyle = s.plat;
    for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2; ctx.beginPath(); ctx.arc(cx, cy, rr, a - 0.05, a + 0.05); ctx.stroke(); }
    // the clay inside the ring, a touch lighter
    ctx.fillStyle = 'rgba(255,235,200,0.16)';
    ctx.beginPath(); ctx.arc(cx, cy, rr - bale / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.line;
    const lw = Math.max(2, half * 0.03), lh = half * 0.2;
    ctx.fillRect(cx - half * 0.16 - lw / 2, cy - lh / 2, lw, lh);
    ctx.fillRect(cx + half * 0.16 - lw / 2, cy - lh / 2, lw, lh);
    // clay texture
    ctx.fillStyle = 'rgba(110,70,30,0.10)';
    for (let i = 0; i < 70; i++) { const a = i * 2.39996, d = Math.sqrt((i + 0.5) / 70) * 0.95; ctx.fillRect(cx + Math.cos(a) * half * d, cy + Math.sin(a) * half * d, 2, 2); }
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
export function drawGhostEdge(ctx, kind, cx, cy, half, alpha, shape = 'square') {
  if (alpha <= 0) return;
  const s = SCENE[kind] || SCENE.sumo;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = s.plat2;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, half, 0, Math.PI * 2);
  else roundRectPath(ctx, cx - half, cy - half, half * 2, half * 2, half * 0.06);
  ctx.fill();
  if (shape === 'circle') { ctx.lineWidth = Math.max(3, half * 0.03); ctx.strokeStyle = s.edge; ctx.stroke(); }
  ctx.restore();
}

/**
 * rv 2: the round platform, radius `rad` px; the circle IS the edge (a piece more than half over it falls).
 * Sumo: a dohyo, its square clay mound bleeding past the ring (it can run off the screen's sides), the straw
 * bales ending exactly at the edge. Bumper cars: a round rubber arena with its striped tyre wall on the edge,
 * on water. Pucks: a round air table with its rim on the edge, on a dark floor.
 */
function drawRing(ctx, kind, cx, cy, rad) {
  const s = SCENE[kind] || SCENE.sumo;
  const full = () => { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); };
  ctx.save();
  if (kind === 'sumo') {
    const half = rad * 1.16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, cx - half + rad * 0.03, cy - half + rad * 0.05, half * 2, half * 2, rad * 0.05); ctx.fill();
    const g = ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half);
    g.addColorStop(0, s.plat2); g.addColorStop(1, '#94693a');
    ctx.fillStyle = g;
    roundRect(ctx, cx - half, cy - half, half * 2, half * 2, rad * 0.05); ctx.fill();
    // clay texture on the mound
    ctx.fillStyle = 'rgba(80,50,20,0.12)';
    for (let i = 0; i < 90; i++) { const a = i * 2.39996, d = Math.sqrt((i + 0.5) / 90) * 1.15; ctx.fillRect(cx + Math.cos(a) * rad * d, cy + Math.sin(a) * rad * d, 2, 2); }
    // the ring's floor: the lighter swept clay inside the bales
    const bale = Math.max(5, rad * 0.06);
    const fl = ctx.createRadialGradient(cx - rad * 0.2, cy - rad * 0.25, rad * 0.1, cx, cy, rad);
    fl.addColorStop(0, '#e2bd83'); fl.addColorStop(1, s.plat);
    ctx.fillStyle = fl;
    full(); ctx.fill();
    // the straw bales: their OUTER side is the edge
    const rr = rad - bale / 2;
    ctx.lineCap = 'butt';
    ctx.lineWidth = bale + 2; ctx.strokeStyle = s.ropeDk;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = bale; ctx.strokeStyle = s.rope;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = s.ropeDk; ctx.lineWidth = Math.max(1, rad * 0.01);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, c1 = Math.cos(a), s1 = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(cx + c1 * (rr - bale / 2), cy + s1 * (rr - bale / 2)); ctx.lineTo(cx + c1 * (rr + bale / 2), cy + s1 * (rr + bale / 2)); ctx.stroke();
    }
    // the two white shikiri lines
    ctx.fillStyle = s.line;
    const lw = Math.max(2, rad * 0.025), lh = rad * 0.17;
    ctx.fillRect(cx - rad * 0.14 - lw / 2, cy - lh / 2, lw, lh);
    ctx.fillRect(cx + rad * 0.14 - lw / 2, cy - lh / 2, lw, lh);
    // a bright lip on the outside of the bales: where the edge is
    ctx.lineWidth = Math.max(2, rad * 0.012); ctx.strokeStyle = s.edge;
    full(); ctx.stroke();
  } else if (kind === 'car') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(cx + rad * 0.03, cy + rad * 0.05, rad, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
    g.addColorStop(0, s.plat); g.addColorStop(1, s.plat2);
    ctx.fillStyle = g;
    full(); ctx.fill();
    ctx.save(); full(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    const cell = Math.max(10, rad / 6);
    for (let x = cx - rad + cell; x < cx + rad; x += cell) { ctx.beginPath(); ctx.moveTo(x, cy - rad); ctx.lineTo(x, cy + rad); ctx.stroke(); }
    for (let y = cy - rad + cell; y < cy + rad; y += cell) { ctx.beginPath(); ctx.moveTo(cx - rad, y); ctx.lineTo(cx + rad, y); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = s.line; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(2, rad * 0.02);
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // the tyre wall: its outer side is the edge
    const tw = Math.max(5, rad * 0.05);
    ctx.lineWidth = tw; ctx.strokeStyle = s.edge;
    ctx.beginPath(); ctx.arc(cx, cy, rad - tw / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([Math.max(6, rad * 0.07), Math.max(6, rad * 0.07)]);
    ctx.strokeStyle = s.rope;
    ctx.beginPath(); ctx.arc(cx, cy, rad - tw / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.arc(cx + rad * 0.03, cy + rad * 0.05, rad, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
    g.addColorStop(0, s.plat); g.addColorStop(1, s.plat2);
    ctx.fillStyle = g;
    full(); ctx.fill();
    ctx.save(); full(); ctx.clip();
    ctx.fillStyle = 'rgba(60,80,110,0.18)';
    const hole = Math.max(9, rad / 9);
    for (let y = cy - rad + hole / 2; y < cy + rad; y += hole) for (let x = cx - rad + hole / 2; x < cx + rad; x += hole) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    ctx.restore();
    ctx.strokeStyle = s.rope; ctx.lineWidth = Math.max(2, rad * 0.02);
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.28, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = s.line;
    ctx.beginPath(); ctx.moveTo(cx - rad * 0.94, cy); ctx.lineTo(cx + rad * 0.94, cy); ctx.stroke();
    // the rim: its outer side is the edge
    const rw = Math.max(4, rad * 0.035);
    ctx.lineWidth = rw; ctx.strokeStyle = s.edge;
    ctx.beginPath(); ctx.arc(cx, cy, rad - rw / 2, 0, Math.PI * 2); ctx.stroke();
  }
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
  if (kind === 'sumo') {
    // a round mat in the SIDE's colour behind the wrestler (Matt, 2026-11-18: the two sides looked alike, only the
    // belts differed), then the wrestler upright, seen from the front, a little smaller so the mat shows all round;
    // the marker is the belt's buckle
    drawBase(ctx, r, c);
    const ws = 0.86;
    ctx.scale(ws, ws);
    drawSumo(ctx, r, c);
    ctx.translate(0, r * 0.45);
  } else {
    ctx.rotate(ang);
    if (kind === 'car') drawCar(ctx, r, c); else drawPuck(ctx, r, c);
    ctx.rotate(-ang);
    // the side marker sits ON the piece (car: the driver's helmet; puck: the middle), drawn upright
    const mo = kind === 'car' ? -r * 0.28 : 0;
    ctx.translate(Math.cos(ang) * mo, Math.sin(ang) * mo);
  }
  drawMarker(ctx, side, r, kind);
  ctx.restore();
}

// Cars and pucks are drawn FACING +x (ctx already rotated to the aim); the sumo stands upright. Sizes are
// fractions of r so a 30-40 px piece on a phone keeps the parts that say what it is: the sumo's topknot, face,
// belly and coloured belt; the car's fat black rubber ring, bonnet and driver; the puck's raised rim and grooves.
function disc(ctx, x, y, rr) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); }
// The side's colour as a solid round base (sumo's mat): main colour, a dark rim, and a thin light ring outside
// so it stands off any floor. Both sides also wear their circle / triangle marker (never colour alone).
function drawBase(ctx, r, c) {
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, c.light || c.main); g.addColorStop(0.55, c.main); g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  disc(ctx, 0, 0, r); ctx.fill();
  ctx.strokeStyle = c.dark; ctx.lineWidth = Math.max(1.5, r * 0.1);
  disc(ctx, 0, 0, r * 0.95); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, r * 0.05);
  disc(ctx, 0, 0, r * 1.02); ctx.stroke();
}
// The SUMO is drawn from the FRONT and always upright (Matt, 2026-11-18: the top-down disc "look[s] like nothing"):
// topknot, face, a big round belly, the mawashi belt in the side's colour with its front flap and cords, thick
// legs, both arms out shoving. The aim arrow shows where it is going.
function drawSumo(ctx, r, c) {
  const skin = '#f2c29b', skinLt = '#ffe3c9', skinDk = '#c98b5c', line = '#4a2a18', hair = '#15110e';
  const lw = Math.max(1, r * 0.05);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // legs: short, thick, planted wide, feet out
  ctx.fillStyle = skin; ctx.strokeStyle = line; ctx.lineWidth = lw;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(sx * r * 0.4, r * 0.66, r * 0.21, r * 0.26, sx * -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(sx * r * 0.5, r * 0.9, r * 0.2, r * 0.09, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // arms out to the sides, open hands shoving (tsuppari)
  for (const sx of [-1, 1]) {
    ctx.strokeStyle = line; ctx.lineWidth = r * 0.34;
    ctx.beginPath(); ctx.moveTo(sx * r * 0.5, -r * 0.08); ctx.lineTo(sx * r * 0.8, -r * 0.3); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = r * 0.25;
    ctx.beginPath(); ctx.moveTo(sx * r * 0.5, -r * 0.08); ctx.lineTo(sx * r * 0.8, -r * 0.3); ctx.stroke();
    ctx.fillStyle = skinLt; ctx.strokeStyle = line; ctx.lineWidth = lw;
    disc(ctx, sx * r * 0.85, -r * 0.36, r * 0.15); ctx.fill(); ctx.stroke();
  }
  // the big round belly
  const g = ctx.createRadialGradient(-r * 0.15, -r * 0.05, r * 0.05, 0, r * 0.12, r * 0.75);
  g.addColorStop(0, skinLt); g.addColorStop(0.6, skin); g.addColorStop(1, skinDk);
  ctx.fillStyle = g; ctx.strokeStyle = line; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.ellipse(0, r * 0.14, r * 0.66, r * 0.58, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // chest line and navel
  ctx.strokeStyle = 'rgba(90,50,25,0.45)'; ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.06, r * 0.16, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.06, r * 0.16, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  // the mawashi: a thick belt round the hips, its front flap, the sagari cords hanging
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, r * 0.14, r * 0.66, r * 0.58, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = c.main;
  ctx.fillRect(-r, r * 0.24, r * 2, r * 0.42);
  ctx.fillStyle = c.dark;
  ctx.fillRect(-r, r * 0.24, r * 2, r * 0.05);
  ctx.restore();
  ctx.fillStyle = c.main; ctx.strokeStyle = c.dark; ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath(); ctx.moveTo(-r * 0.15, r * 0.6); ctx.lineTo(r * 0.15, r * 0.6); ctx.lineTo(r * 0.11, r * 0.9); ctx.lineTo(-r * 0.11, r * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.045);
  for (const sx of [-0.42, -0.3, 0.3, 0.42]) { ctx.beginPath(); ctx.moveTo(sx * r, r * 0.6); ctx.lineTo(sx * r * 0.95, r * 0.8); ctx.stroke(); }
  // the head: hair slicked back, the topknot (chonmage) on top, a fierce face
  const hy = -r * 0.5, hr = r * 0.31;
  ctx.fillStyle = skin; ctx.strokeStyle = line; ctx.lineWidth = lw;
  for (const sx of [-1, 1]) { disc(ctx, sx * hr * 0.98, hy + r * 0.04, r * 0.07); ctx.fill(); ctx.stroke(); }
  disc(ctx, 0, hy, hr); ctx.fill(); ctx.stroke();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(0, hy, hr, Math.PI * 1.04, Math.PI * 1.96); ctx.quadraticCurveTo(0, hy - hr * 0.35, -hr, hy - hr * 0.08); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, hy - hr * 1.1, r * 0.22, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  disc(ctx, 0, hy - hr * 0.92, r * 0.07); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.beginPath(); ctx.ellipse(0, hy - hr * 1.13, r * 0.14, r * 0.045, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  ctx.fillStyle = hair;
  disc(ctx, -r * 0.11, hy + r * 0.03, r * 0.045); ctx.fill();
  disc(ctx, r * 0.11, hy + r * 0.03, r * 0.045); ctx.fill();
  ctx.strokeStyle = hair; ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.beginPath(); ctx.moveTo(-r * 0.19, hy - r * 0.07); ctx.lineTo(-r * 0.05, hy - r * 0.03); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(r * 0.19, hy - r * 0.07); ctx.lineTo(r * 0.05, hy - r * 0.03); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r * 0.07, hy + r * 0.16); ctx.lineTo(r * 0.07, hy + r * 0.16); ctx.stroke();
  ctx.fillStyle = 'rgba(224,83,47,0.28)';
  disc(ctx, -r * 0.19, hy + r * 0.12, r * 0.05); ctx.fill();
  disc(ctx, r * 0.19, hy + r * 0.12, r * 0.05); ctx.fill();
}

function drawCar(ctx, r, c) {
  // the fat rubber bumper ring all the way round IN THE SIDE'S COLOUR (2026-11-18: a black ring on both sides
  // made them look alike), a black inner lip, a shine on top
  ctx.fillStyle = c.dark;
  disc(ctx, 0, 0, r); ctx.fill();
  ctx.strokeStyle = c.main; ctx.lineWidth = r * 0.13;
  disc(ctx, 0, 0, r * 0.9); ctx.stroke();
  ctx.strokeStyle = '#16181e'; ctx.lineWidth = r * 0.07;
  disc(ctx, 0, 0, r * 0.79); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, r * 0.05);
  disc(ctx, 0, 0, r * 1.02); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.9, Math.PI * 1.1, Math.PI * 1.55); ctx.stroke();
  // the car body: a rounded tub, longer than wide, bonnet at the front
  const g = ctx.createLinearGradient(0, -r * 0.7, 0, r * 0.7);
  g.addColorStop(0, c.main); g.addColorStop(0.55, c.main); g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  ctx.beginPath(); roundRectPath(ctx, -r * 0.7, -r * 0.6, r * 1.42, r * 1.2, r * 0.42); ctx.fill();
  ctx.strokeStyle = c.dark; ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath(); roundRectPath(ctx, -r * 0.7, -r * 0.6, r * 1.42, r * 1.2, r * 0.42); ctx.stroke();
  // two racing stripes on the bonnet, headlights
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(r * 0.24, -r * 0.13, r * 0.36, r * 0.07); ctx.fillRect(r * 0.24, r * 0.06, r * 0.36, r * 0.07);
  ctx.fillStyle = '#fff6c8'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(1, r * 0.03);
  for (const sy of [-1, 1]) { disc(ctx, r * 0.6, sy * r * 0.36, r * 0.09); ctx.fill(); ctx.stroke(); }
  // the open cockpit behind the bonnet: seat, hands on the wheel; the driver's helmet is the side marker (drawPiece)
  ctx.fillStyle = '#23262e';
  ctx.beginPath(); roundRectPath(ctx, -r * 0.6, -r * 0.42, r * 0.66, r * 0.84, r * 0.2); ctx.fill();
  ctx.strokeStyle = '#d8dde6'; ctx.lineWidth = r * 0.08; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(r * 0.12, -r * 0.22); ctx.lineTo(r * 0.12, r * 0.22); ctx.stroke();
  ctx.fillStyle = '#f2c29b';
  disc(ctx, r * 0.04, -r * 0.24, r * 0.075); ctx.fill(); disc(ctx, r * 0.04, r * 0.24, r * 0.075); ctx.fill();
  // the pole to the ceiling net, at the back
  ctx.fillStyle = '#b8c0cc'; ctx.strokeStyle = '#4b5260'; ctx.lineWidth = Math.max(1, r * 0.03);
  disc(ctx, -r * 0.66, 0, r * 0.09); ctx.fill(); ctx.stroke();
}

function drawPuck(ctx, r, c) {
  // an air-hockey puck: a raised rim, a flat top, two pressed grooves, a hard shine; an outline in the OTHER
  // puck's tone so the white puck stands off the white table and the black one off the dark floor
  ctx.fillStyle = c.dark;
  disc(ctx, 0, 0, r); ctx.fill();
  ctx.strokeStyle = c.light === '#ffffff' ? '#262a33' : '#f1eee6'; ctx.lineWidth = Math.max(1.2, r * 0.07);
  disc(ctx, 0, 0, r * 1.0); ctx.stroke();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r * 0.95);
  g.addColorStop(0, c.light); g.addColorStop(1, c.main);
  ctx.fillStyle = g;
  disc(ctx, 0, 0, r * 0.86); ctx.fill();
  ctx.strokeStyle = c.dark; ctx.lineWidth = Math.max(1, r * 0.07);
  disc(ctx, 0, 0, r * 0.86); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.045);
  disc(ctx, 0, 0, r * 0.66); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1, r * 0.07); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.76, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
}

/** The side marker: a white circle ('a') or a white triangle ('b') on a dark disc, never colour alone. */
export function drawMarker(ctx, side, r, kind = 'sumo') {
  const m = r * (kind === 'puck' ? 0.32 : kind === 'sumo' ? 0.3 : 0.27);
  const cx = 0;
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
  drawPlatform(ctx, kind, w / 2, h / 2, Math.min(w, h) * 0.46, 'circle');
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
