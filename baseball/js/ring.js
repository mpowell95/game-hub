// ring.js : the main action button - a 137px ring with a 101px fill button drawn INSIDE it on the
// same canvas, ported from `mocks/baseball/ring.js` on `claude/baseball-mocks` (fetched
// 2026-09-14) so the picture matches the Design Spec's own numbers. One canvas, not a
// CSS-colored `<button>` overlapping an SVG ring, which is what the phase 3 first cut drew (a flat
// teal circle, oversized against the 101px spec - the "Swing button is teal and far larger than
// 101px" bug report).
//
// R2 (docs/BASEBALL-3D-BUILD.md section 9): THE METER IS GONE, and this file lost two thirds of
// itself with it. The 'throw' mode's sweeping fill, its Nice zone, the hang grace and the drain,
// and the swing mode's charge/charged states were all pictures of mechanics R2 deleted: pitching
// is now tap-then-drag with no meter at all, and batting is a single tap with no charge. What is
// left is the button, in the two states a button has - idle and pressed - carrying the word
// `ui.js` paints over it (PITCH / READY / SWING). `test-baseball-ring.mjs`, which existed to prove
// the drawn Nice zone agreed with `flyPitch`'s `wasNice`, is deleted with the zone it checked; the
// button's own 137px size is still pinned, by `test-baseball-device.mjs`.

export const RING_D = 137;
export const RING_THICK = 10;
export const BTN_D = 101;

const TWO_PI = Math.PI * 2;

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

/**
 * Draw the action button.
 * @param {HTMLCanvasElement} cv
 * @param {'idle'|'down'} state - 'down' is the pressed frame, held only while a finger is on it.
 */
export function drawRingState(cv, state) {
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

  const down = state === 'down';
  if (down) ring(ctx, size, rIn, rOut, 0, TWO_PI, '#ffce3a');

  // the button itself
  const btnR = BTN_D / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, btnR, 0, TWO_PI);
  ctx.fillStyle = down ? '#3c4a61' : '#2a3446';
  ctx.fill();
  ctx.lineWidth = down ? 2 : 1;
  ctx.strokeStyle = down ? '#12181f' : 'rgba(255,255,255,0.25)';
  ctx.stroke();
}

export default { drawRingState, RING_D, RING_THICK, BTN_D };
