// darts/js/render.js - every pixel on the canvas: the wooden wall, the board, the darts (in the
// hand, in flight and stuck in the board) and the flash on the bed that was hit. No rules here;
// darts/js/engine.js owns those. The wall and the board are painted once per layout into offscreen
// canvases and blitted every frame.

import { ORDER, RING, scoreAt } from './engine.js';

/** Seat colours: red for the first seat, blue for the second (never red against green - Matt is
 *  red/green colourblind; the plaques also carry a shape marker, so colour is never alone). */
export const SEAT_COLOR = ['#d8262c', '#1f5fa8'];
const SEAT_DARK = ['#8f1418', '#123c70'];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** The wall: dark walnut planks with grain, a vignette at the edges. */
function paintWall(w, h, dpr) {
  const c = offscreen(w * dpr, h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const base = g.createLinearGradient(0, 0, w, 0);
  base.addColorStop(0, '#5a2f1a'); base.addColorStop(0.5, '#7a4124'); base.addColorStop(1, '#5a2f1a');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const rnd = mulberry(1979);
  // Grain: long, gently wandering vertical strokes in lighter and darker brown.
  for (let i = 0; i < Math.round(w / 2.2); i++) {
    const x0 = rnd() * w;
    const dark = rnd() < 0.6;
    g.strokeStyle = dark ? `rgba(40,16,6,${0.10 + rnd() * 0.18})` : `rgba(190,110,60,${0.05 + rnd() * 0.10})`;
    g.lineWidth = 0.6 + rnd() * 1.8;
    g.beginPath();
    g.moveTo(x0, -10);
    const amp = 2 + rnd() * 6, ph = rnd() * 6.28, f = 0.004 + rnd() * 0.01;
    for (let y = 0; y <= h + 10; y += 14) g.lineTo(x0 + Math.sin(y * f + ph) * amp, y);
    g.stroke();
  }
  // A few knots.
  for (let i = 0; i < 3; i++) {
    const kx = rnd() * w, ky = rnd() * h, kr = 6 + rnd() * 10;
    const kg = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.4);
    kg.addColorStop(0, 'rgba(35,14,5,0.45)'); kg.addColorStop(1, 'rgba(35,14,5,0)');
    g.fillStyle = kg; g.beginPath(); g.ellipse(kx, ky, kr, kr * 2.4, 0, 0, Math.PI * 2); g.fill();
  }
  const vig = g.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vig; g.fillRect(0, 0, w, h);
  return c;
}

const BLACK = '#1d1b1a', WHITE = '#f1ebdc', RED = '#d42a2a', GREEN = '#1d8a3c', WIRE = 'rgba(200,200,200,0.75)';

/** The board, R = scoring radius in CSS px. The canvas is square, side 2 * frame * R + margin. */
function paintBoard(R, dpr) {
  const F = RING.frame * R;
  const pad = Math.ceil(R * 0.08);
  const side = 2 * (F + pad);
  const c = offscreen(side * dpr, side * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(side / 2, side / 2);
  // Drop shadow on the wall, then the black frame with a soft edge highlight.
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = R * 0.08; g.shadowOffsetY = R * 0.03;
  g.fillStyle = '#111'; g.beginPath(); g.arc(0, 0, F, 0, Math.PI * 2); g.fill();
  g.restore();
  const fr = g.createRadialGradient(0, -F * 0.3, F * 0.6, 0, 0, F);
  fr.addColorStop(0, '#2a2a2a'); fr.addColorStop(1, '#141414');
  g.fillStyle = fr; g.beginPath(); g.arc(0, 0, F, 0, Math.PI * 2); g.fill();

  const wedge = (r0, r1, i, fill) => {
    const a0 = ((i * 18) - 9 - 90) * Math.PI / 180, a1 = a0 + 18 * Math.PI / 180;
    g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath();
    g.fillStyle = fill; g.fill();
  };
  for (let i = 0; i < 20; i++) {
    const dark = i % 2 === 0;       // 20 is a black wedge with a red ring, the standard board
    wedge(RING.bullOut * R, RING.trebIn * R, i, dark ? BLACK : WHITE);
    wedge(RING.trebIn * R, RING.trebOut * R, i, dark ? RED : GREEN);
    wedge(RING.trebOut * R, RING.dblIn * R, i, dark ? BLACK : WHITE);
    wedge(RING.dblIn * R, RING.dblOut * R, i, dark ? RED : GREEN);
  }
  g.fillStyle = GREEN; g.beginPath(); g.arc(0, 0, RING.bullOut * R, 0, Math.PI * 2); g.fill();
  g.fillStyle = RED; g.beginPath(); g.arc(0, 0, RING.bullIn * R, 0, Math.PI * 2); g.fill();
  // The wire (spider).
  g.strokeStyle = WIRE; g.lineWidth = Math.max(0.6, R * 0.006);
  for (const r of [RING.bullIn, RING.bullOut, RING.trebIn, RING.trebOut, RING.dblIn, RING.dblOut]) {
    g.beginPath(); g.arc(0, 0, r * R, 0, Math.PI * 2); g.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = ((i * 18) - 9 - 90) * Math.PI / 180;
    g.beginPath();
    g.moveTo(Math.cos(a) * RING.bullOut * R, Math.sin(a) * RING.bullOut * R);
    g.lineTo(Math.cos(a) * RING.dblOut * R, Math.sin(a) * RING.dblOut * R);
    g.stroke();
  }
  // Numbers on the frame.
  g.fillStyle = '#ffffff';
  g.font = `800 ${Math.round(R * 0.15)}px "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const nr = (RING.dblOut + RING.frame) / 2 * R;
  for (let i = 0; i < 20; i++) {
    const a = (i * 18) * Math.PI / 180;
    g.fillText(String(ORDER[i]), Math.sin(a) * nr, -Math.cos(a) * nr + R * 0.006);
  }
  return { canvas: c, side };
}

/** The path of one bed (the region a hit scored in), for the hit flash. */
function bedPath(g, x, y, R) {
  const hit = scoreAt(x, y);
  g.beginPath();
  if (hit.ring === 'bull') { g.arc(0, 0, RING.bullIn * R, 0, Math.PI * 2); return true; }
  if (hit.ring === 'obull') { g.arc(0, 0, RING.bullOut * R, 0, Math.PI * 2); g.arc(0, 0, RING.bullIn * R, 0, Math.PI * 2, true); return true; }
  if (!hit.pts) return false;
  const i = ORDER.indexOf(hit.num);
  const r = Math.hypot(x, y);
  let r0, r1;
  if (hit.ring === 'treble') { r0 = RING.trebIn; r1 = RING.trebOut; }
  else if (hit.ring === 'double') { r0 = RING.dblIn; r1 = RING.dblOut; }
  else if (r < RING.trebIn) { r0 = RING.bullOut; r1 = RING.trebIn; }
  else { r0 = RING.trebOut; r1 = RING.dblIn; }
  const a0 = ((i * 18) - 9 - 90) * Math.PI / 180, a1 = a0 + 18 * Math.PI / 180;
  g.arc(0, 0, r1 * R, a0, a1); g.arc(0, 0, r0 * R, a1, a0, true); g.closePath();
  return true;
}

/** A dart pointing up, its tip at (x, y), `len` px long. `spin` turns the flights about the shaft
 *  (radians); `alpha` fades it. Drawn from behind and below, the GamePigeon hand view. */
export function drawDart(g, x, y, len, seat, spin = 0, alpha = 1) {
  const col = SEAT_COLOR[seat] || SEAT_COLOR[0], dark = SEAT_DARK[seat] || SEAT_DARK[0];
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  const L = len;
  // Flights: two crossed pairs. Each pair's visible width is the cosine of its angle, so the
  // flights appear to turn as the dart spins in the hand.
  const fy0 = L * 0.56, fy1 = L * 1.0, fw = L * 0.25;
  const pair = (phase, shade) => {
    // Never fully edge-on: a sliver of the far pair always shows, so the flights read as a cross.
    const w = fw * (0.16 + 0.84 * Math.abs(Math.cos(phase)));
    g.fillStyle = shade;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, fy0);
      g.lineTo(s * w * 0.55, fy0 + L * 0.12);
      g.lineTo(s * w, fy1 - L * 0.06);
      g.lineTo(s * w * 0.75, fy1);
      g.lineTo(0, fy1 - L * 0.04);
      g.closePath();
      g.fill();
    }
  };
  const p1 = spin, p2 = spin + Math.PI / 2;
  // The pair nearer edge-on is behind: draw the wider (front-facing) pair last.
  if (Math.abs(Math.cos(p1)) > Math.abs(Math.cos(p2))) { pair(p2, dark); pair(p1, col); }
  else { pair(p1, dark); pair(p2, col); }
  // Shaft.
  g.fillStyle = col;
  g.fillRect(-L * 0.022, L * 0.36, L * 0.044, L * 0.42);
  // Barrel: knurled silver.
  const bg = g.createLinearGradient(-L * 0.04, 0, L * 0.04, 0);
  bg.addColorStop(0, '#6e7378'); bg.addColorStop(0.45, '#eef1f4'); bg.addColorStop(1, '#5f6469');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(-L * 0.026, L * 0.12); g.lineTo(L * 0.026, L * 0.12);
  g.lineTo(L * 0.038, L * 0.2); g.lineTo(L * 0.03, L * 0.38); g.lineTo(-L * 0.03, L * 0.38);
  g.lineTo(-L * 0.038, L * 0.2); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(40,44,48,0.5)'; g.lineWidth = Math.max(0.5, L * 0.004);
  for (let i = 1; i < 6; i++) { const yy = L * (0.2 + i * 0.03); g.beginPath(); g.moveTo(-L * 0.034, yy); g.lineTo(L * 0.034, yy); g.stroke(); }
  // Point.
  g.fillStyle = '#c9ced3';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.012, L * 0.12); g.lineTo(-L * 0.012, L * 0.12); g.closePath(); g.fill();
  g.restore();
}

/** A dart stuck in the board, seen from in front: the flights end-on as an X above the point, and
 *  its shadow on the board below and to the right. `s` is the dart's on-board size in px. */
export function drawStuck(g, x, y, s, seat, alpha = 1) {
  const col = SEAT_COLOR[seat] || SEAT_COLOR[0], dark = SEAT_DARK[seat] || SEAT_DARK[0];
  g.save();
  g.globalAlpha = alpha;
  g.lineCap = 'round';
  // Shadow.
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = s * 0.16;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * 0.45, y + s * 0.9); g.stroke();
  g.beginPath();
  g.moveTo(x + s * 0.2, y + s * 0.62); g.lineTo(x + s * 0.7, y + s * 1.12);
  g.moveTo(x + s * 0.7, y + s * 0.62); g.lineTo(x + s * 0.2, y + s * 1.12);
  g.stroke();
  // Shaft, a short stub angled up toward the viewer.
  g.strokeStyle = '#b8bec4'; g.lineWidth = s * 0.14;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.32); g.stroke();
  // Flights.
  const cy = y - s * 0.5;
  g.strokeStyle = dark; g.lineWidth = s * 0.26;
  g.beginPath(); g.moveTo(x - s * 0.32, cy - s * 0.32); g.lineTo(x + s * 0.32, cy + s * 0.32); g.stroke();
  g.strokeStyle = col; g.lineWidth = s * 0.24;
  g.beginPath(); g.moveTo(x + s * 0.32, cy - s * 0.32); g.lineTo(x - s * 0.32, cy + s * 0.32); g.stroke();
  g.restore();
}

/** The renderer: holds the cached wall and board for the current size. */
export function createRenderer(canvas) {
  const g = canvas.getContext('2d');
  const r = {
    w: 0, h: 0, dpr: 1, R: 100, cx: 0, cy: 0, wall: null, board: null,
    /** Size to `w x h` CSS px with the board's middle at (cx, cy) and scoring radius R. */
    layout(w, h, cx, cy, R) {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (w !== r.w || h !== r.h || dpr !== r.dpr) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        r.wall = paintWall(w, h, dpr);
      }
      if (R !== r.R || dpr !== r.dpr || !r.board) r.board = paintBoard(R, dpr);
      Object.assign(r, { w, h, dpr, cx, cy, R });
    },
    /** Board units -> CSS px. */
    toPx(x, y) { return { x: r.cx + x * r.R, y: r.cy + y * r.R }; },
    /** CSS px -> board units. */
    toBoard(px, py) { return { x: (px - r.cx) / r.R, y: (py - r.cy) / r.R }; },
    /** One frame. `scene` = { stuck: [{x,y,seat,alpha}], flash: {x,y,a}|null, hand: {x,y,len,seat,spin,alpha}|null,
     *  flying: {x,y,len,seat,spin,stuckBlend}|null }, positions in CSS px. */
    draw(scene) {
      const { dpr } = r;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (r.wall) g.drawImage(r.wall, 0, 0, r.w, r.h);
      if (r.board) g.drawImage(r.board.canvas, r.cx - r.board.side / 2, r.cy - r.board.side / 2, r.board.side, r.board.side);
      if (scene.flash && scene.flash.a > 0) {
        g.save();
        g.translate(r.cx, r.cy);
        if (bedPath(g, scene.flash.x, scene.flash.y, r.R)) {
          g.fillStyle = `rgba(255,255,255,${0.62 * scene.flash.a})`;
          g.fill();
        }
        g.restore();
      }
      const s = r.R * 0.11;
      for (const d of scene.stuck || []) {
        const p = r.toPx(d.x, d.y);
        drawStuck(g, p.x, p.y, s, d.seat, d.alpha == null ? 1 : d.alpha);
      }
      const f = scene.flying;
      if (f) {
        if (f.stuckBlend > 0) drawStuck(g, f.x, f.y, s, f.seat, f.stuckBlend);
        if (f.stuckBlend < 1) drawDart(g, f.x, f.y, f.len, f.seat, f.spin, 1 - f.stuckBlend);
      }
      const hd = scene.hand;
      if (hd) drawDart(g, hd.x, hd.y, hd.len, hd.seat, hd.spin, hd.alpha == null ? 1 : hd.alpha);
    },
  };
  return r;
}
