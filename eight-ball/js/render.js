// eight-ball/js/render.js - pixels only: the table, the balls, the obstacles, the cue and the aim
// guide, drawn on one canvas in table units (engine.js) scaled to fit the room ui.js measured. The
// table is the friendly one Matt asked for in 2026-08 (reference/pool/SPEC.md): warm wood, a bright
// cushion, vivid cloth, flat black pockets. The balls are a real set (2026-10-22, Matt: "make it
// based off a real pool table... all have numbers and stripes/solids"): every ball carries its
// number in a white circle, 9-15 are striped; a "simple" look paints them by group instead.

import { W, H, R, CUE, EIGHT, POCKETS, HEAD_Y, FOOT_Y, CORNER_G, SIDE_S, TABLE, TB, groupOf } from './engine.js';

export const TABLE_ART = {
  outline: '#0B0B0B',
  wood: '#8C5A3F',
  woodEdge: '#7A4E36',
  cushion: '#3FBE63',
  cushionLit: '#4ACB6E',
  cloth: '#0F8A3C',
  pocket: '#000000',
  throat: '#0c140f',
};
/** A real set: 1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black; 9-15 the
 *  same colours, striped. The number is what tells balls apart (colourblind rule: never hue alone). */
const CLASSIC = ['#F7EFCB', '#F5C518', '#1F4FB8', '#D8262C', '#6A2C91', '#F07C1E', '#1E8A3E', '#8B1E1E', '#141414'];
/** The simple look: one colour per group (8-ball coral solids / cyan stripes; Cutthroat the hub's
 *  colourblind-safe yellow, blue and vermilion), the number still on every ball. */
const SIMPLE = { a: '#F2604C', b: '#33C6F4', l: '#F2B705', m: '#1F5FA8', h: '#E0532F' };
export const LOOKS = ['classic', 'simple'];

/** How ball `i` is painted: { body, stripe (a white ball with a band), num }. */
export function ballPaint(i, look = 'classic', mode = '8') {
  if (i === CUE) return { body: CLASSIC[0], stripe: false, num: '' };
  if (i === EIGHT && mode !== 'ct') return { body: CLASSIC[8], stripe: false, num: '8' };
  if (look === 'simple' && mode !== '9') {
    const g = groupOf(i, mode);
    return { body: SIMPLE[g] || CLASSIC[8], stripe: mode === '8' && g === 'b', num: String(i) };
  }
  return { body: CLASSIC[i > 8 ? i - 8 : i], stripe: i > 8, num: String(i) };
}

const ACCENT = '#ffce3a';
/** The box that must fit on screen, for the live table (engine.js, TABLE VERSIONS). Table 1: the
 *  cloth plus the cushion band (the wood may run off the sides); vertically the wood fits too.
 *  Table 2 (GamePigeon's): all of it, with room beside it (ui.js _layout). */
export function viewOf() {
  const C = TABLE.cushion, ow = C + TABLE.wood;
  return TABLE.woodOff
    ? { x0: -C - 1, y0: -ow, w: W + 2 * C + 2, h: H + 2 * ow }
    : { x0: -ow, y0: -ow, w: W + 2 * ow, h: H + 2 * ow };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const r = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0, box: null, look: 'classic', mode: '8' };

  /** The canvas covers (cssW x cssH); the table is drawn inside `box` {x, y, w, h} (CSS px). */
  r.layout = (cssW, cssH, box) => {
    r.dpr = Math.min(3, window.devicePixelRatio || 1);
    r.w = cssW; r.h = cssH;
    canvas.width = Math.round(cssW * r.dpr);
    canvas.height = Math.round(cssH * r.dpr);
    r.box = box;
    r.fit();
  };
  /** Place the live table in the box (again when the table version changes: `r.tb`). `box.top`:
   *  hug the box's top instead of centring. */
  r.fit = () => {
    const box = r.box, V = viewOf();
    r.s = Math.min(box.w / V.w, box.h / V.h);
    r.ox = box.x + (box.w - V.w * r.s) / 2 - V.x0 * r.s;
    r.oy = box.y + (box.top ? 0 : (box.h - V.h * r.s) / 2) - V.y0 * r.s;
    r.tb = TB;
    r._table = null;
  };
  r.toTable = (px, py) => ({ x: (px - r.ox) / r.s, y: (py - r.oy) / r.s });
  r.toPx = (x, y) => ({ x: r.ox + x * r.s, y: r.oy + y * r.s });
  /** The table's on-screen rectangle (CSS px), wood included. */
  r.tableRect = () => { const ow = TABLE.cushion + TABLE.wood; return { x: r.ox - ow * r.s, y: r.oy - ow * r.s, w: (W + 2 * ow) * r.s, h: (H + 2 * ow) * r.s }; };

  function roundRect(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }
  const polyOn = (g, pts) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };

  // The static table, drawn once per size into an offscreen canvas (transparent around it: the
  // turn colour behind is CSS on the root).
  function tableLayer() {
    if (r._table) return r._table;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    const A = TABLE_ART;
    const CUSHION = TABLE.cushion, WOOD = TABLE.wood, MI = TABLE.mitre;
    const ow = CUSHION + WOOD;
    g.fillStyle = A.outline;
    roundRect(g, -ow - 1.1, -ow - 1.1, W + 2 * ow + 2.2, H + 2 * ow + 2.2, 5.6);
    g.fill();
    g.fillStyle = A.woodEdge;
    roundRect(g, -ow, -ow, W + 2 * ow, H + 2 * ow, 4.6);
    g.fill();
    g.fillStyle = A.wood;
    roundRect(g, -ow + 0.9, -ow + 0.9, W + 2 * ow - 1.8, H + 2 * ow - 1.8, 4);
    g.fill();
    // Diamonds on the wood (the sights along each rail).
    g.fillStyle = 'rgba(255, 236, 200, 0.75)';
    const dm = (x, y) => polyOn(g, [[x, y - 0.9], [x + 0.7, y], [x, y + 0.9], [x - 0.7, y]]);
    const wy = CUSHION + WOOD / 2;
    for (const k of [1, 2, 3]) { dm((W * k) / 4, -wy); dm((W * k) / 4, H + wy); }
    for (const k of [1, 2, 3, 5, 6, 7]) { dm(-wy, (H * k) / 8); dm(W + wy, (H * k) / 8); }
    const C = CUSHION, G = CORNER_G, S = SIDE_S;
    // The pocket throats: everything past the line between a pocket's jaws is IN, so it is dark.
    g.fillStyle = A.throat;
    polyOn(g, [[0, G], [G, 0], [G - C, -C], [-C, -C], [-C, G - C]]);
    polyOn(g, [[W, G], [W - G, 0], [W - G + C, -C], [W + C, -C], [W + C, G - C]]);
    polyOn(g, [[0, H - G], [G, H], [G - C, H + C], [-C, H + C], [-C, H - G + C]]);
    polyOn(g, [[W, H - G], [W - G, H], [W - G + C, H + C], [W + C, H + C], [W + C, H - G + C]]);
    g.fillRect(-C - 0.1, H / 2 - S, C + 0.1, 2 * S);
    g.fillRect(W, H / 2 - S, C + 0.1, 2 * S);
    // Cushion band, mitred away from each pocket.
    g.fillStyle = A.cushion;
    polyOn(g, [[G, 0], [W - G, 0], [W - G + C, -C], [G - C, -C]]);
    polyOn(g, [[G, H], [W - G, H], [W - G + C, H + C], [G - C, H + C]]);
    polyOn(g, [[0, G], [0, H / 2 - S], [-C, H / 2 - S + C * MI], [-C, G - C]]);
    polyOn(g, [[0, H / 2 + S], [0, H - G], [-C, H - G + C], [-C, H / 2 + S - C * MI]]);
    polyOn(g, [[W, G], [W, H / 2 - S], [W + C, H / 2 - S + C * MI], [W + C, G - C]]);
    polyOn(g, [[W, H / 2 + S], [W, H - G], [W + C, H - G + C], [W + C, H / 2 + S - C * MI]]);
    g.strokeStyle = A.cushionLit; g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(G, -0.3); g.lineTo(W - G, -0.3); g.moveTo(G, H + 0.3); g.lineTo(W - G, H + 0.3);
    g.moveTo(-0.3, G); g.lineTo(-0.3, H / 2 - S); g.moveTo(-0.3, H / 2 + S); g.lineTo(-0.3, H - G);
    g.moveTo(W + 0.3, G); g.lineTo(W + 0.3, H / 2 - S); g.moveTo(W + 0.3, H / 2 + S); g.lineTo(W + 0.3, H - G);
    g.stroke();
    // Cloth: flat colour, no texture. Clipped off the corner throats.
    g.fillStyle = A.cloth;
    if (TB === 2) g.fillRect(0, 0, W, H);   // the holes cover the corners
    else polyOn(g, [[G, 0], [W - G, 0], [W, G], [W, H - G], [W - G, H], [G, H], [0, H - G], [0, G]]);
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 0.4;
    g.beginPath(); g.moveTo(0, HEAD_Y); g.lineTo(W, HEAD_Y); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.arc(W / 2, FOOT_Y, 0.6, 0, Math.PI * 2); g.fill();
    // Pockets: flat black, all one size.
    g.fillStyle = A.pocket;
    for (const p of POCKETS) { g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.fill(); }
    r._table = c;
    return c;
  }

  /** One ball at (x, y) scaled `k` (sinking into a pocket shrinks it). */
  function ball(i, x, y, k = 1) {
    const rad = R * k;
    const P = ballPaint(i, r.look, r.mode);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.arc(x + 0.45 * k, y + 0.6 * k, rad, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = P.stripe ? '#FFFFFF' : P.body;
    ctx.fill();
    ctx.clip();
    if (P.stripe) { ctx.fillStyle = P.body; ctx.fillRect(x - rad, y - rad * 0.6, rad * 2, rad * 1.2); }
    if (P.num) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, rad * 0.56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = `800 ${(rad * (P.num.length > 1 ? 0.62 : 0.74)).toFixed(2)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(P.num, x, y + rad * 0.05);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(x - rad * 0.42, y - rad * 0.46, rad * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.22 * k;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
  }

  /** The bar obstacles: a spill (under the balls), a bottle, a can and a cigarette butt. */
  function obstacle(o) {
    if (o.k === 'spill') {
      ctx.fillStyle = 'rgba(236, 184, 64, 0.82)';
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2, rr = o.r * (0.86 + 0.14 * Math.sin(k * 2.7));
        const px = o.x + Math.cos(a) * rr, py = o.y + Math.sin(a) * rr * 0.9;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 236, 170, 0.8)'; ctx.lineWidth = 0.35; ctx.stroke();
      ctx.fillStyle = 'rgba(255, 250, 230, 0.6)';
      ctx.beginPath(); ctx.ellipse(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.25, o.r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    if (o.k === 'butt') {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = o.r * 2;
      ctx.beginPath(); ctx.moveTo(o.ax + 0.4, o.ay + 0.6); ctx.lineTo(o.bx + 0.4, o.by + 0.6); ctx.stroke();
      const fx = o.ax + (o.bx - o.ax) * 0.4, fy = o.ay + (o.by - o.ay) * 0.4;
      ctx.strokeStyle = '#E39A4B'; ctx.beginPath(); ctx.moveTo(o.ax, o.ay); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.strokeStyle = '#F4F0E8'; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(o.bx, o.by); ctx.stroke();
      ctx.fillStyle = '#5b5b5b'; ctx.beginPath(); ctx.arc(o.bx, o.by, o.r * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'butt';
      return;
    }
    if (o.k === 'bottle') {
      // A brown beer bottle lying on its side: the body from a, the neck narrowing to b, a gold cap.
      const ux = (o.bx - o.ax) / (2 * o.h), uy = (o.by - o.ay) / (2 * o.h), px = -uy, py = ux;
      const sh = (x, y) => [x + 0.6, y + 0.9];
      const outline = (dx0, dy0) => {
        const P = (t, w) => [o.ax + ux * t + px * w + dx0, o.ay + uy * t + py * w + dy0];
        const L = 2 * o.h, rr = o.r;
        return [P(0, rr), P(L * 0.62, rr), P(L * 0.8, rr * 0.45), P(L + 0.6, rr * 0.4), P(L + 0.6, -rr * 0.4), P(L * 0.8, -rr * 0.45), P(L * 0.62, -rr), P(0, -rr)];
      };
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      poly(outline(...sh(0, 0)));
      ctx.fillStyle = '#7A4A1C';
      poly(outline(0, 0));
      ctx.fillStyle = 'rgba(255, 220, 160, 0.45)';
      const hl = (t, w) => [o.ax + ux * t + px * w, o.ay + uy * t + py * w];
      poly([hl(1, o.r * 0.55), hl(2 * o.h * 0.58, o.r * 0.55), hl(2 * o.h * 0.58, o.r * 0.2), hl(1, o.r * 0.2)]);
      ctx.fillStyle = '#F2E6C9';
      poly([hl(2.2, o.r * 0.9), hl(5.2, o.r * 0.9), hl(5.2, -o.r * 0.9), hl(2.2, -o.r * 0.9)]);
      ctx.fillStyle = '#D4A82B';
      ctx.beginPath(); ctx.arc(o.bx + ux * 0.7, o.by + uy * 0.7, o.r * 0.45, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // A can, standing: the silver rim, the red top, the ring pull.
    ctx.beginPath(); ctx.arc(o.x + 0.6, o.y + 0.9, o.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#B9C2CC';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8A94A0'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#C8102E'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ECEFF2'; ctx.beginPath(); ctx.ellipse(o.x + o.r * 0.1, o.y - o.r * 0.38, o.r * 0.3, o.r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  }

  /** The cue stick behind the cue ball, pulled back with the power. */
  function stick(c, a) {
    const ux = a.dx, uy = a.dy;
    const back = R + 1.2 + a.power * 13;
    const tipX = c.x - ux * back, tipY = c.y - uy * back;
    const L = 78;
    const buttX = tipX - ux * L, buttY = tipY - uy * L;
    const px = -uy, py = ux;
    const w0 = 0.55, w1 = 1.45;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    poly([[tipX + px * w0 + 0.6, tipY + py * w0 + 0.8], [buttX + px * w1 + 0.6, buttY + py * w1 + 0.8], [buttX - px * w1 + 0.6, buttY - py * w1 + 0.8], [tipX - px * w0 + 0.6, tipY - py * w0 + 0.8]]);
    const seg = (f0, f1, color) => {
      const ax = tipX - ux * L * f0, ay = tipY - uy * L * f0, bx = tipX - ux * L * f1, by = tipY - uy * L * f1;
      const wa = w0 + (w1 - w0) * f0, wb = w0 + (w1 - w0) * f1;
      ctx.fillStyle = color;
      poly([[ax + px * wa, ay + py * wa], [bx + px * wb, by + py * wb], [bx - px * wb, by - py * wb], [ax - px * wa, ay - py * wa]]);
    };
    seg(0, 0.6, '#F1D9A6');
    seg(0.6, 0.64, '#ffffff');
    seg(0.64, 1, '#5A3420');
    seg(0, 0.025, '#3D6FB6');
  }
  function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }

  /** The aim, as the level allows (ui.js AIDS): Easy, the line to the first thing the cue ball meets,
   *  a ghost ball there and a short line for where that ball goes, fading out (a hint, not the whole
   *  shot); Medium, the line and the ghost ball; Hard, nothing but the cue and the power ring. */
  function aim(a, b) {
    const c = b[CUE];
    const ux = a.dx, uy = a.dy;
    const k = a.contact;
    if (k) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.4;
      ctx.setLineDash([1.2, 1.2]);
      ctx.beginPath(); ctx.moveTo(c.x + ux * R, c.y + uy * R); ctx.lineTo(k.x - ux * R, k.y - uy * R); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(k.x, k.y, R, 0, Math.PI * 2); ctx.stroke();
      if (k.hit >= 0 && a.objEnd) {
        const q = b[k.hit];
        const sx = q.x + k.ox * R, sy = q.y + k.oy * R;
        const gr = ctx.createLinearGradient(sx, sy, a.objEnd.x, a.objEnd.y);
        gr.addColorStop(0, 'rgba(255, 206, 58, 0.95)');
        gr.addColorStop(1, 'rgba(255, 206, 58, 0)');
        ctx.strokeStyle = gr; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(a.objEnd.x, a.objEnd.y); ctx.stroke();
      }
    }
    if (a.fx != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(a.fx, a.fy); ctx.stroke();
    }
    stick(c, a);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(c.x, c.y, R + 1.8, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(c.x, c.y, R + 1.8, -Math.PI / 2, -Math.PI / 2 + a.power * Math.PI * 2); ctx.stroke();
  }

  /** Ball in hand: a breathing dashed ring and four arrows round the cue ball. `bad`: this spot is
   *  not allowed (another ball, an obstacle, out of the kitchen), drawn as a dotted white ring. */
  function inHand(c, t, bad) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.strokeStyle = bad ? '#ffffff' : ACCENT;
    ctx.lineWidth = 0.55;
    ctx.setLineDash(bad ? [0.6, 0.6] : [1.6, 1.1]);
    ctx.beginPath(); ctx.arc(c.x, c.y, R + 2.4 + pulse * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = bad ? '#ffffff' : ACCENT;
    const d = R + 4.6 + pulse * 0.8;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + ux * d, y = c.y + uy * d, px = -uy, py = ux;
      poly([[x + ux * 1.3, y + uy * 1.3], [x + px * 1.1, y + py * 1.1], [x - px * 1.1, y - py * 1.1]]);
    }
  }

  /** A pocket to call (pulsing white ring) or the one called (thick accent ring and an arrow). */
  function pocketMark(k, called, t) {
    const p = POCKETS[k];
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    if (called) {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r + 1.4, 0, Math.PI * 2); ctx.stroke();
      // An arrow pointing into it from the cloth.
      let vx = W / 2 - p.cx, vy = H / 2 - p.cy;
      const vl = Math.sqrt(vx * vx + vy * vy); vx /= vl; vy /= vl;
      const tx = p.cx + vx * (p.r + 3.2), ty = p.cy + vy * (p.r + 3.2), px = -vy, py = vx;
      ctx.fillStyle = ACCENT;
      poly([[tx, ty], [tx + vx * 3.4 + px * 2, ty + vy * 3.4 + py * 2], [tx + vx * 3.4 - px * 2, ty + vy * 3.4 - py * 2]]);
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${(0.45 + 0.45 * pulse).toFixed(3)})`; ctx.lineWidth = 0.7;
      ctx.setLineDash([1.4, 1]);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r + 1 + pulse * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** state: { b, obs, look, mode, aim, halo (0-1), inHand, bad, t, sinking, bursts,
   *  targets (ball indices ringed as the shooter's), calling (pockets pulse), called (pocket) } */
  r.draw = (st) => {
    if (!r.w) return;
    if (r.tb !== TB) r.fit();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tableLayer(), 0, 0);
    const b = st.b;
    if (!b) return;
    r.look = st.look || 'classic';
    r.mode = st.mode || '8';
    ctx.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    for (const o of st.obs || []) if (o.k === 'spill') obstacle(o);
    if (st.inHand === 'kitchen') {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, HEAD_Y, W, H - HEAD_Y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.4; ctx.setLineDash([1.6, 1.2]);
      ctx.beginPath(); ctx.moveTo(0, HEAD_Y); ctx.lineTo(W, HEAD_Y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (st.calling) for (let k = 0; k < POCKETS.length; k++) if (k !== st.called) pocketMark(k, false, st.t || 0);
    if (st.called != null && st.called >= 0) pocketMark(st.called, true, st.t || 0);
    for (const bu of st.bursts || []) {
      const p = POCKETS[bu.k];
      ctx.strokeStyle = bu.color || '#ffffff';
      ctx.globalAlpha = Math.max(0, 1 - bu.f);
      ctx.lineWidth = 1.2 * (1 - bu.f) + 0.2;
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r + bu.f * 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const sk of st.sinking || []) ball(sk.i, sk.x + (sk.px - sk.x) * (1 - sk.k), sk.y + (sk.py - sk.y) * (1 - sk.k), Math.max(0.2, sk.k));
    const c = b[CUE];
    if (st.halo > 0 && c.on) {
      ctx.fillStyle = `rgba(125, 194, 66, ${(0.45 * st.halo).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    for (const o of st.obs || []) if (o.k !== 'spill') obstacle(o);
    if (st.targets) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.4; ctx.setLineDash([1, 0.8]);
      for (const i of st.targets) if (b[i] && b[i].on) { ctx.beginPath(); ctx.arc(b[i].x, b[i].y, R + 1, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    for (let i = 1; i < b.length; i++) if (b[i].on) ball(i, b[i].x, b[i].y);
    if (c.on) ball(CUE, c.x, c.y);
    if (st.inHand && c.on) inHand(c, st.t || 0, st.bad);
    if (st.aim && c.on) aim(st.aim, b);
  };

  return r;
}

/** A small ball picture for the scoreboard tray and the setup card (SVG). `down`: potted (faded,
 *  with a tick). */
export function ballSVG(i, look = 'classic', mode = '8', size = 16, down = false) {
  const P = ballPaint(i, look, mode);
  const id = `epb${i}${look[0]}${mode}`;
  const body = P.stripe
    ? `<clipPath id="${id}"><circle cx="10" cy="10" r="8.6"/></clipPath><circle cx="10" cy="10" r="8.6" fill="#fff"/><rect x="0" y="4.8" width="20" height="10.4" fill="${P.body}" clip-path="url(#${id})"/>`
    : `<circle cx="10" cy="10" r="8.6" fill="${P.body}"/>`;
  const num = P.num ? `<circle cx="10" cy="10" r="5" fill="#fff"/><text x="10" y="13" text-anchor="middle" font-size="${P.num.length > 1 ? 6.4 : 7.6}" font-weight="800" font-family="system-ui,sans-serif" fill="#141414">${P.num}</text>` : '';
  const tick = down ? '<path d="M5 10.5 L8.6 14 L15.4 6.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' : '';
  return `<svg class="ep-ball-ico${down ? ' is-down' : ''}" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><g opacity="${down ? 0.32 : 1}">${body}${num}<circle cx="10" cy="10" r="8.6" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1"/></g>${tick}</svg>`;
}
