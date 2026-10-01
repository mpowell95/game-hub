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

/**
 * One dart, from its projected tip and tail (darts/js/flight.js). `unit` is the dart's on-screen
 * size at its depth: widths scale with it, while the length along the screen is whatever the
 * projection makes it. A dart seen side-on shows its barrel, shaft and flights; as it turns to point
 * into the board its projected length shrinks below its width and the flights are seen END-ON, as a
 * cross (blended in by `endOn`). `spin` turns the flights about the shaft.
 */
export function drawDart(g, tip, tail, unit, seat, spin = 0, alpha = 1, shadow = false) {
  const col = SEAT_COLOR[seat] || SEAT_COLOR[0], dark = SEAT_DARK[seat] || SEAT_DARK[0];
  const dx = tail.x - tip.x, dy = tail.y - tip.y;
  const len = Math.hypot(dx, dy);
  const u = Math.max(2, unit);
  const endOn = Math.max(0, Math.min(1, (0.85 - len / u) / 0.55));
  g.save();
  g.globalAlpha = alpha;
  g.lineCap = 'round';
  if (shadow) {
    // On the board, light from the top left: a soft dark copy below and to the right of the shaft.
    const sx = u * 0.18, sy = u * 0.32;
    g.strokeStyle = 'rgba(0,0,0,0.30)';
    g.lineWidth = u * 0.05;
    g.beginPath(); g.moveTo(tip.x, tip.y); g.lineTo(tail.x + sx, tail.y + sy + len * 0.2); g.stroke();
    g.lineWidth = u * 0.07;
    const fx = tail.x + sx, fy = tail.y + sy + len * 0.2, a = u * 0.12;
    g.beginPath(); g.moveTo(fx - a, fy - a); g.lineTo(fx + a, fy + a); g.moveTo(fx + a, fy - a); g.lineTo(fx - a, fy + a); g.stroke();
  }
  // Local frame: tip at the origin, the dart running down +y to `len`.
  g.translate(tip.x, tip.y);
  g.rotate(Math.atan2(dy, dx) - Math.PI / 2);
  const L = len;
  // Side-on flights: two crossed pairs, each as wide as the cosine of its angle, so they turn.
  if (endOn < 1) {
    g.save();
    g.globalAlpha = alpha * (1 - endOn);
    const fy0 = L * 0.56, fy1 = L, fw = u * 0.25;
    const pair = (phase, shade) => {
      const w = fw * (0.16 + 0.84 * Math.abs(Math.cos(phase)));
      g.fillStyle = shade;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(0, fy0);
        g.lineTo(sgn * w * 0.55, fy0 + L * 0.12);
        g.lineTo(sgn * w, fy1 - L * 0.06);
        g.lineTo(sgn * w * 0.75, fy1);
        g.lineTo(0, fy1 - L * 0.04);
        g.closePath();
        g.fill();
      }
    };
    const p1 = spin, p2 = spin + Math.PI / 2;
    if (Math.abs(Math.cos(p1)) > Math.abs(Math.cos(p2))) { pair(p2, dark); pair(p1, col); }
    else { pair(p1, dark); pair(p2, col); }
    g.restore();
  }
  // Shaft.
  g.fillStyle = col;
  g.fillRect(-u * 0.022, L * 0.36, u * 0.044, L * 0.42);
  // Barrel: knurled silver.
  const bg = g.createLinearGradient(-u * 0.04, 0, u * 0.04, 0);
  bg.addColorStop(0, '#6e7378'); bg.addColorStop(0.45, '#eef1f4'); bg.addColorStop(1, '#5f6469');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(-u * 0.026, L * 0.12); g.lineTo(u * 0.026, L * 0.12);
  g.lineTo(u * 0.038, L * 0.2); g.lineTo(u * 0.03, L * 0.38); g.lineTo(-u * 0.03, L * 0.38);
  g.lineTo(-u * 0.038, L * 0.2); g.closePath(); g.fill();
  if (L > u * 0.4) {
    g.strokeStyle = 'rgba(40,44,48,0.5)'; g.lineWidth = Math.max(0.5, u * 0.004);
    for (let i = 1; i < 6; i++) { const yy = L * (0.2 + i * 0.03); g.beginPath(); g.moveTo(-u * 0.034, yy); g.lineTo(u * 0.034, yy); g.stroke(); }
  }
  // Point.
  g.fillStyle = '#c9ced3';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(u * 0.012, L * 0.12); g.lineTo(-u * 0.012, L * 0.12); g.closePath(); g.fill();
  // End-on flights: a cross at the tail, turned by the spin.
  if (endOn > 0) {
    g.globalAlpha = alpha * endOn;
    g.translate(0, L);
    g.rotate(spin + Math.PI / 4);
    // Sized off GamePigeon's video: end-on, its flights span about what they do side-on (0.5u).
    const a = u * 0.24;
    g.strokeStyle = dark; g.lineWidth = u * 0.1;
    g.beginPath(); g.moveTo(-a, 0); g.lineTo(a, 0); g.stroke();
    g.strokeStyle = col; g.lineWidth = u * 0.09;
    g.beginPath(); g.moveTo(0, -a); g.lineTo(0, a); g.stroke();
  }
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
    /** One frame. `scene` = { flash: {x,y,a}|null, darts: [{tip, tail, unit, seat, spin, alpha, shadow}] },
     *  tip and tail in CSS px. */
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
      // Every dart is a projected pose from darts/js/flight.js: stuck ones (with their shadow), the
      // one in flight, and the one in the hand, drawn far to near.
      for (const d of scene.darts || []) drawDart(g, d.tip, d.tail, d.unit, d.seat, d.spin || 0, d.alpha == null ? 1 : d.alpha, !!d.shadow);
    },
  };
  return r;
}
