// eight-ball/js/render.js - pixels only: the table, the balls, the cue and the aim guide, drawn on
// one canvas in table units (engine.js) scaled to fit the room ui.js measured. The look is the
// friendly one Matt asked for in 2026-08 (reference/pool/SPEC.md): warm wood, a bright cushion,
// vivid cloth, flat black pockets, coral and cyan groups.

import { W, H, R, CUE, EIGHT, POCKETS, HEAD_Y, FOOT_Y, CORNER_G, SIDE_S, groupOf } from './engine.js';

export const TABLE_ART = {
  outline: '#0B0B0B',
  wood: '#8C5A3F',
  woodEdge: '#7A4E36',
  cushion: '#3FBE63',
  cushionLit: '#4ACB6E',
  cloth: '#0F8A3C',
  pocket: '#000000',
};
/** The two groups: coral SOLIDS and cyan STRIPES. Colour AND shape (a white band), never colour
 *  alone (root CLAUDE.md, "Accessibility": Matt is red/green colourblind; coral against cyan is
 *  also the pair that survives it). */
export const BALL_ART = {
  a: { body: '#F2604C', lit: '#FFB0A0' },
  b: { body: '#33C6F4', lit: '#B0EBFF' },
  eight: { body: '#141414', lit: '#6A6A6A' },
  cue: { body: '#F7EFCB', lit: '#FFFFFF' },
};
const ACCENT = '#ffce3a';
const CUSHION = 3.4;                 // the cushion band, drawn outward from the cloth
const WOOD = 6.4;                    // the wood frame outside it
/** The cloth plus the cushion band: the box that must fit on screen (the wood may run off the
 *  sides, as in the reference). Vertically the wood fits too. */
export const VIEW = { x0: -CUSHION - 1, y0: -CUSHION - WOOD, w: W + 2 * CUSHION + 2, h: H + 2 * (CUSHION + WOOD) };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const r = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0, box: null };

  /** The canvas covers (cssW x cssH); the table is drawn inside `box` {x, y, w, h} (CSS px). */
  r.layout = (cssW, cssH, box) => {
    r.dpr = Math.min(3, window.devicePixelRatio || 1);
    r.w = cssW; r.h = cssH;
    canvas.width = Math.round(cssW * r.dpr);
    canvas.height = Math.round(cssH * r.dpr);
    r.s = Math.min(box.w / VIEW.w, box.h / VIEW.h);
    r.ox = box.x + (box.w - VIEW.w * r.s) / 2 - VIEW.x0 * r.s;
    r.oy = box.y + (box.h - VIEW.h * r.s) / 2 - VIEW.y0 * r.s;
    r.box = box;
    r._table = null;
  };
  r.toTable = (px, py) => ({ x: (px - r.ox) / r.s, y: (py - r.oy) / r.s });
  r.toPx = (x, y) => ({ x: r.ox + x * r.s, y: r.oy + y * r.s });
  /** The table's on-screen rectangle (CSS px), wood included. */
  r.tableRect = () => ({ x: r.ox - (CUSHION + WOOD) * r.s, y: r.oy - (CUSHION + WOOD) * r.s, w: (W + 2 * (CUSHION + WOOD)) * r.s, h: (H + 2 * (CUSHION + WOOD)) * r.s });

  function roundRect(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  // The static table, drawn once per size into an offscreen canvas (transparent around it: the
  // turn colour behind is CSS on the root).
  function tableLayer() {
    if (r._table) return r._table;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    const A = TABLE_ART;
    const ow = CUSHION + WOOD;
    // Outline, wood, cushion, cloth: each inset inside the last.
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
    const dm = (x, y) => { g.beginPath(); g.moveTo(x, y - 0.9); g.lineTo(x + 0.7, y); g.lineTo(x, y + 0.9); g.lineTo(x - 0.7, y); g.closePath(); g.fill(); };
    const wy = CUSHION + WOOD / 2;
    for (const k of [1, 2, 3]) { dm((W * k) / 4, -wy); dm((W * k) / 4, H + wy); }
    for (const k of [1, 2, 3, 5, 6, 7]) { dm(-wy, (H * k) / 8); dm(W + wy, (H * k) / 8); }
    // Cushion band, mitred away from each pocket.
    g.fillStyle = A.cushion;
    const C = CUSHION, G = CORNER_G, S = SIDE_S;
    const band = (pts) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
    band([[G, 0], [W - G, 0], [W - G + C, -C], [G - C, -C]]);
    band([[G, H], [W - G, H], [W - G + C, H + C], [G - C, H + C]]);
    band([[0, G], [0, H / 2 - S], [-C, H / 2 - S + C * 0.6], [-C, G - C]]);
    band([[0, H / 2 + S], [0, H - G], [-C, H - G + C], [-C, H / 2 + S - C * 0.6]]);
    band([[W, G], [W, H / 2 - S], [W + C, H / 2 - S + C * 0.6], [W + C, G - C]]);
    band([[W, H / 2 + S], [W, H - G], [W + C, H - G + C], [W + C, H / 2 + S - C * 0.6]]);
    // Bevel highlight along the cushion's inner edge.
    g.strokeStyle = A.cushionLit; g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(G, -0.3); g.lineTo(W - G, -0.3); g.moveTo(G, H + 0.3); g.lineTo(W - G, H + 0.3);
    g.moveTo(-0.3, G); g.lineTo(-0.3, H / 2 - S); g.moveTo(-0.3, H / 2 + S); g.lineTo(-0.3, H - G);
    g.moveTo(W + 0.3, G); g.lineTo(W + 0.3, H / 2 - S); g.moveTo(W + 0.3, H / 2 + S); g.lineTo(W + 0.3, H - G);
    g.stroke();
    // Cloth: flat colour, no texture.
    g.fillStyle = A.cloth;
    g.fillRect(0, 0, W, H);
    // The head string and the foot spot, faint.
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 0.4;
    g.beginPath(); g.moveTo(0, HEAD_Y); g.lineTo(W, HEAD_Y); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.arc(W / 2, FOOT_Y, 0.6, 0, Math.PI * 2); g.fill();
    // Pockets: flat black, drawn over the cushion's notch.
    g.fillStyle = A.pocket;
    for (const p of POCKETS) { g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.fill(); }
    r._table = c;
    return c;
  }

  /** One ball at (x, y) scaled `k` (sinking into a pocket shrinks it). */
  function ball(i, x, y, k = 1) {
    const rad = R * k;
    const g = groupOf(i);
    const art = i === CUE ? BALL_ART.cue : i === EIGHT ? BALL_ART.eight : BALL_ART[g];
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.arc(x + 0.45 * k, y + 0.6 * k, rad, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = g === 'b' ? '#FFFFFF' : art.body;
    ctx.fill();
    ctx.clip();
    if (g === 'b') {
      // Stripes: a white ball with a broad coloured band (the SHAPE that says "the other group").
      ctx.fillStyle = art.body;
      ctx.fillRect(x - rad, y - rad * 0.55, rad * 2, rad * 1.1);
    }
    if (i === EIGHT) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, rad * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = `900 ${(rad * 0.78).toFixed(2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('8', x, y + rad * 0.04);
    }
    // One soft highlight top-left.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(x - rad * 0.36, y - rad * 0.4, rad * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.22 * k;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
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
    // Shaft (maple), then the butt (dark wood), then the tip (blue chalk).
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

  /** The aim: power ring, and as the level allows (ui.js AIDS) a line to the first ball with a ghost
   *  ball there, that ball's path and the cue ball's glance (`a.contact`, engine aimContact), or a
   *  short line out of the cue ball only (`a.short`). */
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
      if (k.hit >= 0 && a.paths) {
        const q = b[k.hit];
        const len = a.paths === 'long' ? 18 + 40 * (k.ox * ux + k.oy * uy) : 9;
        const e = a.objEnd || { x: q.x + k.ox * len, y: q.y + k.oy * len };
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 0.55;
        ctx.beginPath(); ctx.moveTo(q.x + k.ox * R, q.y + k.oy * R); ctx.lineTo(e.x, e.y); ctx.stroke();
        if (a.paths === 'long' && k.cx != null) {
          const cl = 6 + 16 * k.cut;
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.35;
          ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(k.x + k.cx * cl, k.y + k.cy * cl); ctx.stroke();
        }
      }
    } else if (a.short) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.4;
      ctx.setLineDash([1.2, 1.2]);
      ctx.beginPath(); ctx.moveTo(c.x + ux * R, c.y + uy * R); ctx.lineTo(c.x + ux * (R + 12), c.y + uy * (R + 12)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Pull string back to the finger.
    if (a.fx != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(a.fx, a.fy); ctx.stroke();
    }
    stick(c, a);
    // Power ring: a full ring is a full-strength shot.
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(c.x, c.y, R + 1.8, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(c.x, c.y, R + 1.8, -Math.PI / 2, -Math.PI / 2 + a.power * Math.PI * 2); ctx.stroke();
  }

  /** Ball in hand: a breathing dashed ring and four arrows round the cue ball. `bad`: this spot is
   *  not allowed (another ball, or out of the kitchen), drawn in a hatched ring. */
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

  /** state: { b, aim, halo (0-1: the cue ball is yours to shoot), inHand ('kitchen'|'any'|null),
   *  bad (the cue ball's spot is not allowed), t (seconds, for pulses), sinking [{i, x, y, px, py, k}],
   *  bursts [{k (pocket), g ('a'|'b'|'eight'|'cue'), f (0-1)}] } */
  r.draw = (st) => {
    if (!r.w) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tableLayer(), 0, 0);
    const b = st.b;
    if (!b) return;
    ctx.setTransform(r.dpr * r.s, 0, 0, r.dpr * r.s, r.dpr * r.ox, r.dpr * r.oy);
    if (st.inHand === 'kitchen') {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, HEAD_Y, W, H - HEAD_Y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.4; ctx.setLineDash([1.6, 1.2]);
      ctx.beginPath(); ctx.moveTo(0, HEAD_Y); ctx.lineTo(W, HEAD_Y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const bu of st.bursts || []) {
      const p = POCKETS[bu.k];
      const art = bu.g === 'eight' ? BALL_ART.eight : bu.g === 'cue' ? BALL_ART.cue : BALL_ART[bu.g] || BALL_ART.cue;
      ctx.strokeStyle = bu.g === 'eight' ? '#ffffff' : art.body;
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
    for (let i = 1; i < b.length; i++) if (b[i].on) ball(i, b[i].x, b[i].y);
    if (c.on) ball(CUE, c.x, c.y);
    if (st.inHand && c.on) inHand(c, st.t || 0, st.bad);
    if (st.aim && c.on) aim(st.aim, b);
  };

  return r;
}

/** A small ball picture for the scoreboard and the how-to card (SVG): group 'a' (solid), 'b'
 *  (striped), 'eight', or 'cue'. */
export function ballSVG(g, size = 18) {
  const art = g === 'eight' ? BALL_ART.eight : g === 'cue' ? BALL_ART.cue : BALL_ART[g];
  const id = 'epb' + g;
  const body = g === 'b'
    ? `<clipPath id="${id}"><circle cx="10" cy="10" r="8.6"/></clipPath><circle cx="10" cy="10" r="8.6" fill="#fff"/><rect x="0" y="5.3" width="20" height="9.4" fill="${art.body}" clip-path="url(#${id})"/>`
    : `<circle cx="10" cy="10" r="8.6" fill="${art.body}"/>`;
  const eight = g === 'eight' ? '<circle cx="10" cy="10" r="4.2" fill="#fff"/><text x="10" y="12.6" text-anchor="middle" font-size="7" font-weight="900" font-family="system-ui,sans-serif" fill="#141414">8</text>' : '';
  return `<svg class="ep-ball-ico" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${body}${eight}<circle cx="6.9" cy="6.5" r="2.4" fill="rgba(255,255,255,0.55)"/><circle cx="10" cy="10" r="8.6" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1"/></svg>`;
}
