// ring.js : the Swing/Throw ring - a direct port of `mocks/baseball/ring.js` on
// `claude/baseball-mocks` (fetched 2026-09-14), the geometry lifted straight from the Design Spec
// so the picture matches the numbers: a 137px ring, 10px thick, with a 101px fill button drawn
// INSIDE it on the same canvas - not a separate CSS-colored `<button>` overlapping an SVG ring, which
// is what the phase 3 first cut drew (a flat teal circle, oversized against the 101px spec and with
// no state of its own - the "Swing button is teal and far larger than 101px" bug report). One
// canvas, one state machine, matching `button-states.html`'s own reference states exactly.

export const RING_D = 137;
export const RING_THICK = 10;
export const BTN_D = 101;

const TOP = -Math.PI / 2;                 // 12 o'clock, canvas angle
const START = TOP + (120 * Math.PI / 180); // ~4 o'clock, where the fill begins
const TWO_PI = Math.PI * 2;

function angFor(progress) {
  return START + progress * TWO_PI;
}

// Where the Nice zone sits, as a fraction of the fill sweep starting at START.
export const NICE_CENTER = (((TOP - START) % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI;
export const NICE_HALF = 0.06; // 0.12 width / 2

function setupCanvas(cv, sizeCss) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(sizeCss * dpr);
  cv.height = Math.round(sizeCss * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function ring(ctx, size, r0, r1, a0, a1, color) {
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, (r0 + r1) / 2, a0, a1, false);
  ctx.lineWidth = r1 - r0;
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';
  ctx.stroke();
}

function tick(ctx, size, r0, r1, angle, color, w) {
  const cx = size / 2, cy = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
  ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
  ctx.lineWidth = w || 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * Draw one ring state.
 * mode: 'swing' | 'throw'
 * state: swing: 'idle'|'charging'|'charged'
 *        throw: 'idle'|'filling'|'nice'|'released'|'hung'
 * value: 0..1 progress / fill fraction, meaning depends on state
 */
export function drawRingState(cv, mode, state, value) {
  const size = RING_D;
  const ctx = setupCanvas(cv, size);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const rOut = size / 2 - 1;
  const rIn = rOut - RING_THICK;

  // base track, always visible
  ring(ctx, size, rIn, rOut, 0, TWO_PI, 'rgba(255,255,255,0.10)');
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, 0, TWO_PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const v = value == null ? 0 : value;

  if (mode === 'swing') {
    if (state === 'idle') {
      // nothing extra: bare track
    } else if (state === 'charging') {
      ring(ctx, size, rIn, rOut, START, angFor(v), '#c9d4e0');
    } else if (state === 'charged') {
      ring(ctx, size, rIn, rOut, START, angFor(1), '#ffce3a');
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, 0, TWO_PI);
      ctx.strokeStyle = '#12181f';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // button
    const btnR = BTN_D / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, btnR, 0, TWO_PI);
    ctx.fillStyle = state === 'charged' ? '#ffce3a' : '#2a3446';
    ctx.fill();
    if (state === 'charged') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#12181f';
      ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.stroke();
    }
    return;
  }

  // mode === 'throw'
  const niceA0 = angFor(NICE_CENTER - NICE_HALF);
  const niceA1 = angFor(NICE_CENTER + NICE_HALF);

  if (state === 'idle') {
    // bare track only
  } else if (state === 'filling') {
    ring(ctx, size, rIn, rOut, START, angFor(Math.min(v, NICE_CENTER - NICE_HALF)), '#c9d4e0');
  } else if (state === 'nice' || state === 'released' || state === 'hung') {
    // full path up to the nice zone in neutral, the nice zone lightly lit
    ring(ctx, size, rIn, rOut, START, niceA0, '#c9d4e0');
    ring(ctx, size, rIn, rOut, niceA0, niceA1, 'rgba(255,255,255,0.55)');
    if (state === 'hung') {
      // fill DRAINS from the top back toward the start
      const drainA1 = angFor(1 - v * (1 - NICE_CENTER));
      ring(ctx, size, rIn, rOut, niceA1, drainA1 < niceA1 ? niceA1 : drainA1, 'rgba(160,170,180,0.35)');
    } else {
      ring(ctx, size, rIn, rOut, niceA1, angFor(v == null ? NICE_CENTER + NICE_HALF : v), '#c9d4e0');
    }
  }

  // Nice zone ticks + diamond, always shown once filling has begun
  if (state !== 'idle') {
    tick(ctx, size, rIn - 2, rOut + 2, niceA0, '#fff', 2);
    tick(ctx, size, rIn - 2, rOut + 2, niceA1, '#fff', 2);
    const midA = angFor(NICE_CENTER);
    const dx = cx + Math.cos(midA) * (rIn + RING_THICK / 2);
    const dy = cy + Math.sin(midA) * (rIn + RING_THICK / 2);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }

  // release marker
  if (state === 'released' && value != null) {
    tick(ctx, size, rIn - 3, rOut + 3, angFor(value), '#fff', 3);
  }

  // hub button
  const btnR = BTN_D / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, btnR, 0, TWO_PI);
  ctx.fillStyle = '#2a3446';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
}
