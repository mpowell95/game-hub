// eight-ball/js/render.js - pixels only: the table, the balls, the obstacles, the cue and the aim
// guide, drawn on one canvas in table units (engine.js) scaled to fit the room ui.js measured. The
// table is GamePigeon's, copied from Matt's screenshot (2026-10-23; before that the friendly flat
// one from 2026-08, reference/pool/SPEC.md). The balls are a real set (2026-10-22, Matt: "make it
// based off a real pool table... all have numbers and stripes/solids"): every ball carries its
// number in a white circle, 9-15 are striped; a "simple" look paints them by group instead.

import { W, H, R, CUE, EIGHT, POCKETS, HEAD_Y, FOOT_Y, CORNER_G, SIDE_S, TABLE, TB, groupOf } from './engine.js';

/** GamePigeon's colours, sampled from Matt's screenshot (2026-10-23). */
export const TABLE_ART = {
  wood: '#6B3432',
  cap: '#D6CFBD',
  cushionBack: '#3F6E9E',
  cushion: '#4A84BE',
  cushionNose: '#3D6D9E',
  cushionEdge: '#2E5578',
  cloth: '#4B87C3',
  throat: '#34618E',
  pocket: '#000000',
};

/** A tiny repeatable random sequence, so the grain is the same every time the table is drawn. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
}
/** A square tile of `base` colour with per-pixel grain of strength `amt` (0-1) and a few fibres. */
function grainTile(base, amt, fibres = 0) {
  const n = 96, c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  const im = g.createImageData(n, n), rnd = seeded(base.length * 131 + Math.round(amt * 1000));
  const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
  for (let i = 0; i < n * n; i++) {
    const f = 1 + (rnd() - 0.5) * 2 * amt;
    im.data[i * 4] = Math.min(255, r0 * f); im.data[i * 4 + 1] = Math.min(255, g0 * f); im.data[i * 4 + 2] = Math.min(255, b0 * f); im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  for (let i = 0; i < fibres; i++) {
    g.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    g.lineWidth = 0.6;
    const x = rnd() * n, y = rnd() * n, a = rnd() * 6.3, l = 2 + rnd() * 4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}
/** A see-through tile: only the grain, for laying over a gradient. */
function sheenTile(amt) {
  const n = 96, c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d'), im = g.createImageData(n, n), rnd = seeded(99);
  for (let i = 0; i < n * n; i++) { const v = rnd() < 0.5 ? 0 : 255; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = Math.round(rnd() * 255 * amt); }
  g.putImageData(im, 0, 0);
  return c;
}
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
  /** A rounded rectangle path; `rad` one radius or [top-left, top-right, bottom-right, bottom-left]. */
  function roundRectPath(g, x, y, w, h, rad) {
    const [a, b, c2, d] = Array.isArray(rad) ? rad : [rad, rad, rad, rad];
    g.moveTo(x + a, y);
    g.lineTo(x + w - b, y); if (b) g.arcTo(x + w, y, x + w, y + b, b);
    g.lineTo(x + w, y + h - c2); if (c2) g.arcTo(x + w, y + h, x + w - c2, y + h, c2);
    g.lineTo(x + d, y + h); if (d) g.arcTo(x, y + h, x, y + h - d, d);
    g.lineTo(x, y + a); if (a) g.arcTo(x, y, x + a, y, a);
    g.closePath();
  }
  r._tiles = null;
  const tiles = () => r._tiles || (r._tiles = {
    cloth: grainTile(TABLE_ART.cloth, 0.07, 160),
    throat: grainTile(TABLE_ART.throat, 0.07, 60),
    wood: grainTile(TABLE_ART.wood, 0.05),
    cap: grainTile(TABLE_ART.cap, 0.06, 40),
    sheen: sheenTile(0.08),
  });
  const polyOn = (g, pts) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };

  // The static table, drawn once per size into an offscreen canvas (transparent around it: the
  // surround is CSS on the root). GamePigeon's table, copied from Matt's screenshot (2026-10-23):
  // mahogany rails with grain, cream stone caps round the pockets, blue cushions shaded across
  // their width with angled jaws, felt with a fine grain and darker edges, black holes with the
  // darker throat cloth in front of them, white diamonds, a soft shadow under the whole table.
  function tableLayer() {
    if (r._table) return r._table;
    tiles();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    const k = r.dpr * r.s;
    const unit = () => g.setTransform(k, 0, 0, k, r.dpr * r.ox, r.dpr * r.oy);
    const device = () => g.setTransform(1, 0, 0, 1, 0, 0);
    unit();
    const A = TABLE_ART;
    const C = TABLE.cushion, ow = C + TABLE.wood;
    const G = CORNER_G, S = SIDE_S;
    const GB = TABLE.GB != null ? TABLE.GB : G - C;
    const SB = TABLE.SB != null ? TABLE.SB : S - C * TABLE.mitre;
    const rnd = seeded(7);
    const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    // A fill with a pixel-grain tile: the path is built in table units, filled in device pixels.
    const grainFill = (tile) => { g.save(); device(); g.fillStyle = g.createPattern(tile, 'repeat'); g.fill(); g.restore(); };

    // The shadow under the table, then the wood.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.38)'; g.shadowBlur = 18 * r.dpr; g.shadowOffsetY = 6 * r.dpr;
    g.fillStyle = A.wood;
    roundRect(g, -ow, -ow, W + 2 * ow, H + 2 * ow, 3.6);
    g.fill();
    g.restore();
    g.save();
    roundRect(g, -ow, -ow, W + 2 * ow, H + 2 * ow, 3.6);
    g.clip();
    grainFill(r._tiles.wood);
    // Grain: long streaks along each rail.
    for (const [x0, y0, w, h, along] of [[-ow, -ow, W + 2 * ow, ow, 'x'], [-ow, H, W + 2 * ow, ow, 'x'], [-ow, 0, ow, H, 'y'], [W, 0, ow, H, 'y']]) {
      g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
      const n = Math.round((along === 'x' ? h : w) * 7);
      for (let i = 0; i < n; i++) {
        const dark = rnd() < 0.6;
        g.strokeStyle = dark ? `rgba(40,10,10,${0.08 + rnd() * 0.22})` : `rgba(190,110,100,${0.05 + rnd() * 0.12})`;
        g.lineWidth = 0.06 + rnd() * 0.3;
        const off = rnd() * (along === 'x' ? h : w), amp = rnd() * 0.5, f = 0.02 + rnd() * 0.05, ph = rnd() * 6;
        g.beginPath();
        const len = along === 'x' ? w : h;
        for (let s = 0; s <= len; s += 2) {
          const d = off + Math.sin(s * f + ph) * amp;
          const x = along === 'x' ? x0 + s : x0 + d, y = along === 'x' ? y0 + d : y0 + s;
          if (s) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.restore();
    }
    // The rail's bevel: lit on the outside, a crease where it meets the cushion.
    g.strokeStyle = 'rgba(255,215,200,0.22)'; g.lineWidth = 0.5;
    roundRect(g, -ow + 0.35, -ow + 0.35, W + 2 * ow - 0.7, H + 2 * ow - 0.7, 3.3); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.35;
    roundRect(g, -ow, -ow, W + 2 * ow, H + 2 * ow, 3.6); g.stroke();

    // Cream stone caps round the pockets.
    const cap = (x, y, w, h, rad) => {
      g.save();
      g.beginPath(); roundRectPath(g, x, y, w, h, rad); g.clip();
      g.beginPath(); g.rect(x, y, w, h); grainFill(r._tiles.cap);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = rnd() < 0.5 ? `rgba(120,105,80,${0.05 + rnd() * 0.08})` : `rgba(255,252,240,${0.08 + rnd() * 0.12})`;
        g.beginPath(); g.ellipse(x + rnd() * w, y + rnd() * h, 0.4 + rnd() * 1.4, 0.3 + rnd() * 0.9, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      g.strokeStyle = 'rgba(70,55,40,0.35)'; g.lineWidth = 0.25;
      g.beginPath(); roundRectPath(g, x, y, w, h, rad); g.stroke();
    };
    const cs = ow + C;   // a corner cap: from the table's corner to just past the cloth's
    cap(-ow, -ow, cs, cs, [3.6, 0, 0, 0]);
    cap(W - C, -ow, cs, cs, [0, 3.6, 0, 0]);
    cap(-ow, H - C, cs, cs, [0, 0, 0, 3.6]);
    cap(W - C, H - C, cs, cs, [0, 0, 3.6, 0]);
    const sh = 62 * TABLE.wood / 77;   // a side cap: the rail's width, 124 px of 717 tall
    cap(-ow, H / 2 - sh, TABLE.wood, 2 * sh, 0);
    cap(W + C, H / 2 - sh, TABLE.wood, 2 * sh, 0);

    // Diamonds on the rails.
    g.fillStyle = 'rgba(255,255,255,0.9)';
    const dm = (x, y) => path([[x, y - 0.75], [x + 0.5, y], [x, y + 0.75], [x - 0.5, y]]);
    const wy = C + TABLE.wood / 2;
    for (const q of [1, 2, 3]) { dm((W * q) / 4, -wy); g.fill(); dm((W * q) / 4, H + wy); g.fill(); }
    for (const q of [1, 2, 3, 5, 6, 7]) { dm(-wy, (H * q) / 8); g.fill(); dm(W + wy, (H * q) / 8); g.fill(); }

    // The cloth, then the darker cloth in each pocket's mouth.
    g.beginPath(); g.rect(0, 0, W, H); grainFill(r._tiles.cloth);
    const corners = [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]];
    for (const [cx, cy, sx, sy] of corners) {
      path([[cx + sx * G, cy], [cx + sx * GB, cy - sy * C], [cx - sx * C, cy - sy * C], [cx - sx * C, cy + sy * GB], [cx, cy + sy * G], [cx, cy]]);
      grainFill(r._tiles.throat);
    }
    for (const [cx, sx] of [[0, 1], [W, -1]]) {
      path([[cx, H / 2 - S], [cx - sx * C, H / 2 - SB], [cx - sx * C, H / 2 + SB], [cx, H / 2 + S]]);
      grainFill(r._tiles.throat);
    }
    // Felt: darker towards the cushions.
    const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, H * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,20,50,0.28)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // The holes.
    for (const p of POCKETS) {
      g.fillStyle = A.pocket;
      g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.fill();
      const hg = g.createRadialGradient(p.cx, p.cy, p.r * 0.6, p.cx, p.cy, p.r);
      hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(40,40,40,0.55)');
      g.fillStyle = hg; g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.fill();
    }

    // Cushions, shaded across their width, each with its two angled jaws.
    const cushion = (pts, nx0, ny0, nx1, ny1) => {
      path(pts);
      const cg = g.createLinearGradient(nx0, ny0, nx1, ny1);   // from the back to the nose
      cg.addColorStop(0, A.cushionBack); cg.addColorStop(0.45, A.cushion); cg.addColorStop(0.8, A.cushion);
      cg.addColorStop(0.92, A.cushionNose); cg.addColorStop(1, A.cushionEdge);
      g.fillStyle = cg; g.fill();
      g.save(); g.clip(); grainFill(r._tiles.sheen); g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.22;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[3][0], pts[3][1]); g.stroke();
      g.beginPath(); g.moveTo(pts[1][0], pts[1][1]); g.lineTo(pts[2][0], pts[2][1]); g.stroke();
    };
    cushion([[G, 0], [W - G, 0], [W - GB, -C], [GB, -C]], 0, -C, 0, 0);
    cushion([[W - G, H], [G, H], [GB, H + C], [W - GB, H + C]], 0, H + C, 0, H);
    for (const [cx, sx] of [[0, 1], [W, -1]]) {
      cushion([[cx, G], [cx, H / 2 - S], [cx - sx * C, H / 2 - SB], [cx - sx * C, GB]], cx - sx * C, 0, cx, 0);
      cushion([[cx, H / 2 + S], [cx, H - G], [cx - sx * C, H - GB], [cx - sx * C, H / 2 + SB]], cx - sx * C, 0, cx, 0);
    }
    // The cushions' shadow on the felt.
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, 0, 1.4, 0, 0, W, 1.4], [0, H, 0, H - 1.4, 0, H - 1.4, W, 1.4], [0, 0, 1.4, 0, 0, 0, 1.4, H], [W, 0, W - 1.4, 0, W - 1.4, 0, 1.4, H]]) {
      const sg = g.createLinearGradient(x0, y0, x1, y1);
      sg.addColorStop(0, 'rgba(0,15,40,0.32)'); sg.addColorStop(1, 'rgba(0,15,40,0)');
      g.fillStyle = sg; g.fillRect(rx, ry, rw, rh);
    }
    // The head string and the foot spot.
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.3;
    g.beginPath(); g.moveTo(0, HEAD_Y); g.lineTo(W, HEAD_Y); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(W / 2, FOOT_Y, 0.55, 0, Math.PI * 2); g.fill();
    r._table = c;
    return c;
  }

  /** One ball at (x, y) scaled `k` (sinking into a pocket shrinks it). */
  function ball(i, x, y, k = 1) {
    const rad = R * k;
    const P = ballPaint(i, r.look, r.mode);
    // A soft shadow down and to the right, as under GamePigeon's lights.
    const sg = ctx.createRadialGradient(x + 0.5 * k, y + 0.8 * k, rad * 0.4, x + 0.5 * k, y + 0.8 * k, rad * 1.15);
    sg.addColorStop(0, 'rgba(0,10,30,0.45)'); sg.addColorStop(1, 'rgba(0,10,30,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(x + 0.5 * k, y + 0.8 * k, rad * 1.15, 0, Math.PI * 2); ctx.fill();
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
    // Round: lit from the top left, darker towards the far edge, one bright highlight.
    const lg = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, 0, x, y, rad * 1.05);
    lg.addColorStop(0, 'rgba(255,255,255,0.28)'); lg.addColorStop(0.45, 'rgba(255,255,255,0)');
    lg.addColorStop(0.8, 'rgba(0,0,0,0.06)'); lg.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = lg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.ellipse(x - rad * 0.42, y - rad * 0.5, rad * 0.17, rad * 0.11, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.16 * k;
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
  /** A pocket being called, or the one that is. Drawn ONLY on the rail and the cap BEHIND the
   *  pocket, never over the cloth, the cushions or the mouth (Matt, 2026-10-24, on the old ring and
   *  arrow: "this makes it WAY harder to sink the 8 ball. All of it is in the way"). The called one:
   *  a thick yellow ring round the back of the hole and a chevron on the cap pointing at it (shape +
   *  colour); the others while calling: a pulsing dashed white ring, same place. */
  function pocketMark(k, called, t) {
    const p = POCKETS[k];
    const C = TABLE.cushion, ow = C + TABLE.wood;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-ow - 20, -ow - 20, W + 2 * ow + 40, H + 2 * ow + 40);
    ctx.rect(-C, -C, W + 2 * C, H + 2 * C);
    ctx.clip('evenodd');
    // Outward from the pocket: corners along the diagonal, side pockets straight out.
    let vx = p.cx < W / 2 ? -1 : 1, vy = Math.abs(p.cy - H / 2) < 1 ? 0 : p.cy < H / 2 ? -1 : 1;
    const vl = Math.sqrt(vx * vx + vy * vy); vx /= vl; vy /= vl;
    if (called) {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r + 1.1, 0, Math.PI * 2); ctx.stroke();
      const d0 = p.r + 1.5, d1 = d0 + 3.6, px = -vy, py = vx;
      const tx = p.cx + vx * d0, ty = p.cy + vy * d0;
      ctx.fillStyle = ACCENT;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.3;
      poly([[tx, ty], [p.cx + vx * d1 + px * 1.6, p.cy + vy * d1 + py * 1.6], [p.cx + vx * d1 - px * 1.6, p.cy + vy * d1 - py * 1.6]]);
      ctx.stroke();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = `rgba(255,255,255,${(0.5 + 0.45 * pulse).toFixed(3)})`; ctx.lineWidth = 0.9;
      ctx.setLineDash([1.4, 1]);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r + 1 + pulse * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
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
