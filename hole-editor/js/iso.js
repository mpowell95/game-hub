// hole-editor/js/iso.js - the ISOMETRIC view (2026-09-23).
//
// Matt, pointing at a pastel isometric city-builder toy: "This is exactly how our golf hole creator
// should look and work like." He chose the new look over the SAME hole format: every hole is still
// a centreline with widths, built by the game's own makeHole/buildMap (R5) - only the camera and
// the paint changed. So this file owns exactly three things:
//
//   1. the projection (world yards <-> screen px), pure maths, one formula in one place;
//   2. the scenery around the hole (sky, the floating island's soil sides);
//   3. things that STAND UP (trees, cacti, rocks, poles and their wires), drawn upright here
//      because the game's map raster paints them flat from above. canvas.js hands buildMap a copy
//      of the hole with no trees and no wires (`bareHole`), lays that raster on the ground, and
//      stands the trees on it.
//
// THE PROJECTION. World x runs right across the hole, world y runs UP the hole (tee to pin). Screen:
//   px = W/2 + (u + v) * k        u = x - cam.cx, v = y - cam.cy, k = cam.ppy
//   py = H/2 + (u - v) * k / 2 - z * k * Z
// so the tee sits bottom-left and the pin top-right, a 2:1 diamond like the reference's board, and
// `cam` keeps its old shape ({ppy, cx, cy}): the zoom slider, the per-hole camera memory and the
// tests all still read the same three numbers.

/** Vertical scale: screen px per yard of HEIGHT, as a share of `k`. Below 1 so an 18-yd pine does
 *  not tower over a fairway that is only ~40 yd wide on screen. */
export const Z = 0.8;

export function isoProject(cam, W, H, x, y, z = 0) {
  const k = cam.ppy;
  const u = x - cam.cx;
  const v = y - cam.cy;
  return [W / 2 + (u + v) * k, H / 2 + (u - v) * k / 2 - z * k * Z];
}

/** Screen (css px) -> the world point on the GROUND under it. */
export function isoUnproject(cam, W, H, sx, sy) {
  const k = cam.ppy;
  const a = (sx - W / 2) / k;
  const b = (sy - H / 2) / (k / 2);
  return { x: cam.cx + (a + b) / 2, y: cam.cy + (a - b) / 2 };
}

/** The ground plane as a canvas affine [a, b, c, d, e, f] (world yards -> css px): hand it to
 *  setTransform and anything drawn in world coordinates lies flat on the ground, squashed exactly
 *  like the map under it. */
export function isoGroundMatrix(cam, W, H) {
  const k = cam.ppy;
  return [k, k / 2, k, -k / 2, W / 2 - k * (cam.cx + cam.cy), H / 2 - (k / 2) * (cam.cx - cam.cy)];
}

/** A screen-space drag (css px) -> the world yards it covers on the ground. */
export function isoScreenDelta(ppy, dxPx, dyPx) {
  const a = dxPx / ppy;
  const b = dyPx / (ppy / 2);
  return { dx: (a + b) / 2, dy: (a - b) / 2 };
}

/** The game throws a tree's shadow 0.92 yd per yard of height, because from straight above that is
 *  the only way height shows at all. Standing up, height shows itself, and a shadow 16 yd from its
 *  trunk just floats; this share of the game's offset keeps it attached, like the reference's. */
export const SHADOW_SHARE = 0.3;

/** Tallest thing we leave room for above the island at the fit zoom, in yards. */
const HEADROOM_YD = 22;

/** Island depth in yards: a share of the diamond's size, so it reads the same on every hole. */
export function islandDepthYd(bounds) {
  return ((bounds.maxX - bounds.minX) + (bounds.maxY - bounds.minY)) * 0.03;
}

/** Fit: the whole island (diamond, soil sides and the trees' headroom) inside W x H. */
export function isoFit(bounds, W, H) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const A = w + h;                         // the diamond's extent along both screen axes, in yd
  const margin = 24;
  const depth = islandDepthYd(bounds) * Z;
  const ppy = Math.max(0.5, Math.min(12, Math.min((W - margin * 2) / A, (H - margin * 2) / (A / 2 + HEADROOM_YD * Z + depth))));
  const cam = { ppy, cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2 };
  // Centre the whole block, not just the ground: the trees stick up, the soil hangs down.
  const shiftPx = ((HEADROOM_YD * Z - depth) * ppy) / 2;
  const d = isoScreenDelta(ppy, 0, shiftPx);
  cam.cx -= d.dx; cam.cy -= d.dy;
  return cam;
}

// --- colour ------------------------------------------------------------------------------------

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a, b, t) {
  const A = rgb(a); const B = rgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
function toHex(css) {
  if (css[0] === '#') return css;
  const m = css.match(/\d+/g).map(Number);
  return '#' + m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hash(a, b) {
  let h = Math.imul(Math.round(a * 97) + 1, 374761393) ^ Math.imul(Math.round(b * 89) + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- scenery -----------------------------------------------------------------------------------

const CLOUDS = [[0.12, 0.14, 1.1], [0.78, 0.1, 0.9], [0.52, 0.26, 0.7], [0.92, 0.4, 0.8], [0.06, 0.52, 0.65]];

/** Pastel sky, a soft sun and a few still clouds, in css px. */
export function drawSky(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#9fd3ee');
  g.addColorStop(0.72, '#e4f5fb');
  g.addColorStop(1, '#eef4ef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const sx = W * 0.2; const sy = H * 0.16;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 110);
  sg.addColorStop(0, 'rgba(255,248,226,.95)');
  sg.addColorStop(0.2, 'rgba(255,232,170,.5)');
  sg.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(sx, sy, 110, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  const s0 = Math.min(1.2, W / 900 + 0.4);
  for (const [fx, fy, fs] of CLOUDS) {
    const x = fx * W; const y = fy * H; const s = fs * s0;
    ctx.beginPath();
    ctx.ellipse(x, y, 60 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 30 * s, y + 2 * s, 32 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 20 * s, y - 12 * s, 34 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 16 * s, y - 10 * s, 24 * s, 17 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const SOIL = { top: '#e2c3a3', mid: '#d2ad8a', deep: '#bf9676' };

/** The floating island under the hole: its drop shadow, the two soil faces that show (the bottom
 *  edge, y = minY, and the right edge, x = maxX), strata, pebbles and a grass lip. `P` is the
 *  projection, `lip` the ground colour at the edge. */
export function drawIsland(ctx, P, b, k, lip) {
  const D = islandDepthYd(b);
  const A = P(b.minX, b.minY); const B = P(b.maxX, b.minY); const C = P(b.maxX, b.maxY);
  const Ad = P(b.minX, b.minY, -D); const Bd = P(b.maxX, b.minY, -D); const Cd = P(b.maxX, b.maxY, -D);
  const depthPx = D * k * Z;
  // drop shadow
  const cx = (A[0] + C[0]) / 2; const cy = B[1] + depthPx + 28;
  const rx = (C[0] - A[0]) * 0.46;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, 0.1);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  sg.addColorStop(0, 'rgba(60,50,90,.22)');
  sg.addColorStop(0.6, 'rgba(60,50,90,.08)');
  sg.addColorStop(1, 'rgba(60,50,90,0)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  const face = (p, q, qd, pd, f) => {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(qd[0], qd[1]); ctx.lineTo(pd[0], pd[1]); ctx.closePath();
    const g = ctx.createLinearGradient(0, Math.min(p[1], q[1]), 0, Math.max(pd[1], qd[1]));
    g.addColorStop(0, mix(SOIL.top, '#000000', 1 - f));
    g.addColorStop(0.35, mix(SOIL.mid, '#000000', 1 - f * 0.97));
    g.addColorStop(1, mix(SOIL.deep, '#000000', 1 - f * 0.9));
    ctx.fillStyle = g; ctx.fill();
  };
  face(A, B, Bd, Ad, 0.95);   // front-left face (lit)
  face(B, C, Cd, Bd, 0.8);    // front-right face (shade)
  // strata
  ctx.strokeStyle = 'rgba(150,110,80,.45)';
  ctx.lineWidth = 1.2;
  for (const f of [0.4, 0.7]) {
    ctx.beginPath();
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const x = b.minX + ((b.maxX - b.minX) * s) / steps;
      const p = P(x, b.minY, -D * f + Math.sin(s * 1.7 + f * 9) * D * 0.05);
      if (s) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    for (let s = 1; s <= steps; s++) {
      const y = b.minY + ((b.maxY - b.minY) * s) / steps;
      const p = P(b.maxX, y, -D * f + Math.sin(s * 2.1 - f * 7) * D * 0.05);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }
  // pebbles
  ctx.fillStyle = 'rgba(236,214,188,.85)';
  for (let s = 0; s < 26; s++) {
    const u = hash(s, 3); const zz = -D * (0.2 + hash(s, 5) * 0.7);
    const p = s % 2 ? P(b.minX + u * (b.maxX - b.minX), b.minY, zz) : P(b.maxX, b.minY + u * (b.maxY - b.minY), zz);
    ctx.beginPath(); ctx.ellipse(p[0], p[1], 2.2, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  // grass lip
  const lipPx = Math.max(2, Math.min(5, depthPx * 0.12));
  ctx.beginPath();
  ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]);
  ctx.lineTo(C[0], C[1] + lipPx); ctx.lineTo(B[0], B[1] + lipPx); ctx.lineTo(A[0], A[1] + lipPx);
  ctx.closePath();
  ctx.fillStyle = mix(toHex(lip), '#000000', 0.18);
  ctx.fill();
}

// --- standing things ---------------------------------------------------------------------------

/** One tree/rock/pole standing at screen point (bx, by). `o`: shape, R (crown radius, yd), H (height,
 *  yd), trunk (yd), k (cam.ppy), fill (the game's TREE_FILL colour), muted (a belt tree), seed. */
export function drawIsoTree(ctx, bx, by, o) {
  const { k } = o;
  const zs = k * Z;
  const Hp = Math.max(3, o.H * zs);
  let Rp = Math.max(1.6, o.R * k * 0.9);
  // The game's tree colours are deep, for a top-down map; standing up in a pastel scene they read
  // as black. Lift every one toward a soft leaf green; a belt tree a little less than a placed one,
  // so what you placed still stands out from the tree lines around it.
  const base = mix(o.fill, '#9ed48a', o.muted ? 0.32 : 0.45);
  const light = mix(toHex(base), '#ffffff', 0.4);
  const dark = mix(toHex(base), '#000000', 0.28);
  const trunkCol = '#9a7654';
  const shape = o.shape;
  const crown = (cx, cy, r) => {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
    g.addColorStop(0, light);
    g.addColorStop(0.55, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.5, cy + r * 0.4, r * 0.65, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.55, cy + r * 0.35, r * 0.65, 0, Math.PI * 2);
    ctx.fill();
  };
  const trunk = (h, w) => {
    ctx.fillStyle = trunkCol;
    const tw = Math.max(1.2, w);
    ctx.fillRect(bx - tw / 2, by - h, tw, h);
  };
  if (shape === 'fir' || shape === 'cypress') {
    if (shape === 'cypress') Rp = Math.min(Rp, Hp * 0.18);
    else Rp = Math.min(Rp, Hp * 0.42);
    trunk(Hp * 0.2, o.trunk * k * 0.6);
    const tiers = shape === 'cypress' ? 1 : 3;
    for (let i = 0; i < tiers; i++) {
      const y0 = by - Hp * (0.15 + i * 0.22);
      const y1 = shape === 'cypress' ? by - Hp : by - Hp * (0.55 + i * 0.15);
      const r = Rp * (1 - i * 0.22);
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.moveTo(bx, y1); ctx.lineTo(bx - r, y0); ctx.quadraticCurveTo(bx, y0 + r * 0.35, bx + r, y0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.moveTo(bx, y1); ctx.lineTo(bx - r, y0); ctx.quadraticCurveTo(bx - r * 0.4, y0 + r * 0.25, bx, y0 + r * 0.2); ctx.closePath(); ctx.fill();
    }
    return Hp;
  }
  if (shape === 'cactus') {
    const w = Math.max(2, o.trunk * k * 1.3);
    const col = (x, y, h) => {
      ctx.fillStyle = base;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h, w, h, w / 2); else ctx.rect(x - w / 2, y - h, w, h);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(x - w / 2 + w * 0.15, y - h + w * 0.4, w * 0.25, Math.max(0, h - w * 0.6));
    };
    col(bx, by, Hp);
    const flip = o.seed < 0.5 ? 1 : -1;
    const ax = bx + flip * w * 1.3; const ay = by - Hp * 0.45;
    ctx.fillStyle = base; ctx.fillRect(Math.min(bx, ax), ay - w * 0.4, Math.abs(ax - bx), w * 0.8);
    col(ax, ay, Hp * 0.28);
    const bx2 = bx - flip * w * 1.2; const by2 = by - Hp * 0.6;
    ctx.fillStyle = base; ctx.fillRect(Math.min(bx, bx2), by2 - w * 0.4, Math.abs(bx2 - bx), w * 0.8);
    col(bx2, by2, Hp * 0.2);
    return Hp;
  }
  if (shape === 'palm') {
    const lean = (o.seed - 0.5) * Hp * 0.4;
    const tx = bx + lean; const ty = by - Hp;
    ctx.strokeStyle = trunkCol; ctx.lineWidth = Math.max(1.5, o.trunk * k * 1.2); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx, by - Hp * 0.6, tx, ty); ctx.stroke();
    const n = 7; const len = Math.max(4, Rp * 1.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + o.seed * 3;
      ctx.fillStyle = i % 2 ? base : light;
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(a);
      ctx.beginPath(); ctx.ellipse(len * 0.5, Math.abs(Math.sin(a)) * len * 0.15, len * 0.55, len * 0.16, 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    return Hp;
  }
  if (shape === 'dead' || shape === 'joshua') {
    ctx.strokeStyle = base; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.4, o.trunk * k * 1.1);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - Hp * 0.75); ctx.stroke();
    ctx.lineWidth = Math.max(1, o.trunk * k * 0.7);
    const tips = [[-0.5, -1.0], [0.55, -0.92], [-0.15, -1.08], [0.3, -0.7]];
    for (const [dx, dy] of tips) {
      const x = bx + dx * Rp * 1.3; const y = by + dy * Hp;
      ctx.beginPath(); ctx.moveTo(bx, by - Hp * 0.55); ctx.lineTo(x, y); ctx.stroke();
      if (shape === 'joshua') { ctx.fillStyle = '#8a9a3a'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, Rp * 0.3), 0, Math.PI * 2); ctx.fill(); }
    }
    return Hp;
  }
  if (shape === 'bush' || shape === 'gorse') {
    const r = Math.max(2, Rp * 0.7);
    crown(bx, by - r * 0.7, r);
    if (shape === 'gorse') {
      ctx.fillStyle = '#f2d24a';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(bx + (hash(o.seed * 50, i) - 0.5) * r * 1.8, by - r * 0.7 + (hash(i, o.seed * 30) - 0.5) * r * 1.2, Math.max(0.8, r * 0.12), 0, Math.PI * 2); ctx.fill(); }
    }
    return r * 1.5;
  }
  if (shape === 'rock' || shape === 'rocks') {
    const one = (x, y, r) => {
      const h = r * 0.8;
      ctx.fillStyle = mix(toHex(base), '#000000', 0.18);
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.7, y - h * 0.8); ctx.lineTo(x, y - h); ctx.lineTo(x + r * 0.8, y - h * 0.7); ctx.lineTo(x + r, y); ctx.quadraticCurveTo(x, y + r * 0.35, x - r, y); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.moveTo(x - r * 0.7, y - h * 0.8); ctx.lineTo(x, y - h); ctx.lineTo(x + r * 0.8, y - h * 0.7); ctx.lineTo(x + r * 0.1, y - h * 0.45); ctx.closePath(); ctx.fill();
    };
    if (shape === 'rocks') { const r = Rp * 0.5; one(bx - r * 0.8, by + r * 0.1, r); one(bx + r * 0.9, by + r * 0.2, r * 0.8); one(bx, by - r * 0.3, r * 0.9); return r * 1.5; }
    one(bx, by, Rp); return Rp * 0.8;
  }
  if (shape === 'log') {
    const r = Math.max(1.5, o.trunk * k * 0.6); const len = Math.max(6, o.R * k * 2.4);
    ctx.strokeStyle = trunkCol; ctx.lineWidth = r * 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx - len / 2, by - r + len * 0.12); ctx.lineTo(bx + len / 2, by - r - len * 0.12); ctx.stroke();
    ctx.fillStyle = '#d9b88a'; ctx.beginPath(); ctx.ellipse(bx + len / 2, by - r - len * 0.12, r * 0.6, r, 0, 0, Math.PI * 2); ctx.fill();
    return r * 2;
  }
  if (shape === 'pole') {
    const h = Math.max(8, (o.poleH || 10) * zs);
    ctx.strokeStyle = '#8b7a66'; ctx.lineWidth = Math.max(1.2, k * 0.5); ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - h); ctx.stroke();
    ctx.lineWidth = Math.max(1, k * 0.35);
    ctx.beginPath(); ctx.moveTo(bx - Math.max(3, k * 1.6), by - h + 2); ctx.lineTo(bx + Math.max(3, k * 1.6), by - h + 2); ctx.stroke();
    return h;
  }
  // canopy (oak, maple, birch, paloverde) and willow
  Rp = Math.min(Rp, Hp * 0.6);
  const cz = Math.max(Rp * 0.9, Hp - Rp * 0.85);
  trunk(cz, o.trunk * k * 0.7);
  crown(bx, by - cz, Rp);
  if (shape === 'willow') {
    ctx.strokeStyle = base; ctx.lineWidth = Math.max(1, Rp * 0.12);
    for (let i = -2; i <= 2; i++) { const x = bx + i * Rp * 0.4; ctx.beginPath(); ctx.moveTo(x, by - cz + Rp * 0.3); ctx.quadraticCurveTo(x + Rp * 0.1, by - cz + Rp * 0.9, x, by - cz + Rp * 1.3); ctx.stroke(); }
  }
  return cz + Rp;
}

/** A power line's wire, strung between pole tops with a little sag, plus its faint line on the
 *  ground so it can be read against the fairway. */
export function drawIsoWire(ctx, P, pts, h, k) {
  ctx.save();
  ctx.strokeStyle = 'rgba(40,40,40,.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
  ctx.stroke();
  ctx.strokeStyle = '#4b4b50';
  ctx.lineWidth = Math.max(0.8, k * 0.25);
  for (let i = 1; i < pts.length; i++) {
    const a = P(pts[i - 1][0], pts[i - 1][1], h); const b = P(pts[i][0], pts[i][1], h);
    const m = P((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2, h - 1.5);
    for (const off of [0, 3]) {
      ctx.beginPath(); ctx.moveTo(a[0], a[1] + off); ctx.quadraticCurveTo(m[0], m[1] + off, b[0], b[1] + off); ctx.stroke();
    }
  }
  ctx.restore();
}
