// ring.js : the Swing/Throw ring - a direct port of `mocks/baseball/ring.js` on
// `claude/baseball-mocks` (fetched 2026-09-14), the geometry lifted straight from the Design Spec
// so the picture matches the numbers: a 137px ring, 10px thick, with a 101px fill button drawn
// INSIDE it on the same canvas - not a separate CSS-colored `<button>` overlapping an SVG ring, which
// is what the phase 3 first cut drew (a flat teal circle, oversized against the 101px spec and with
// no state of its own - the "Swing button is teal and far larger than 101px" bug report). One
// canvas, one state machine, matching `button-states.html`'s own reference states exactly.
//
// STAGE 8 (docs/BASEBALL-3D-BUILD.md section 8, row 1): the fill used to sweep a FULL 360deg lap
// (`angFor(p) = START + p*TWO_PI`), so progress 1.0 (== `meterTime`, the instant `pitch.js` starts
// scoring a hold Nice) landed back at START, not at the geometric top where the Nice zone was
// drawn. Measured: the old `NICE_CENTER` was `(TOP-START)/TWO_PI = 0.667` of that full-lap sweep -
// a release the engine called Nice (hold in `[meterTime*(1-niceWidth), meterTime]`, i.e. progress
// in `[1-niceWidth, 1]`) drew its marker about 80deg PAST the lit zone, never inside it. Fixed: the
// fill now sweeps 240deg, START to TOP, so progress 1.0 IS the top and the Nice zone (the shipped
// `niceWidth`, imported from settings below - never a second literal) sits against it, ending
// exactly there. `test-baseball-ring.mjs` pins this against the real `flyPitch` for a sweep of
// hold times; it was born red against the geometry this replaces (`git show HEAD~1:...` at ship
// time - see that test's own header).
import { FEEL, HANG_GRACE_FRAC } from './engine/settings.js';

export const RING_D = 137;
export const RING_THICK = 10;
export const BTN_D = 101;

const TOP = -Math.PI / 2;                 // 12 o'clock, canvas angle
const START = TOP + (120 * Math.PI / 180); // ~4 o'clock, where the fill begins
const TWO_PI = Math.PI * 2;
// STAGE 8 row 1: 240deg, START to TOP the LONG way round (through 6 and 9 o'clock, matching the
// mocks' own "clockwise fill" reference) - derived from the two anchor angles, never a literal
// 240deg, so a future change to either one keeps this in step automatically.
const SWEEP = TOP + TWO_PI - START;

/** Progress (0 at START, 1 at the top; can run past 1 - the hang grace and the drain both do) ->
 *  canvas angle. Exported, pure, so `test-baseball-ring.mjs` can check `angleFor(1.0)` lands at
 *  the geometric top (`TOP = -Math.PI/2`) directly, with no canvas involved. */
export function angleFor(progress) {
  return START + progress * SWEEP;
}

// The Nice zone: the LAST `niceWidth` of the sweep, ending exactly at the top (progress 1.0) -
// read from `SETTINGS.FEEL.engine.niceWidth`, the SAME number `pitch.js`'s own `flyPitch` scores a
// hold Nice against (`niceStartMs = meterTimeMs * (1 - F.niceWidth)`), never a second literal.
const NICE_WIDTH = FEEL.engine.niceWidth;
export const NICE_START = 1 - NICE_WIDTH;
export const NICE_END = 1;
export const NICE_CENTER = (NICE_START + NICE_END) / 2;
export const NICE_HALF = (NICE_END - NICE_START) / 2;
// How far past the top (progress 1.0) the fill keeps sweeping, in the hung warning colour, before
// the drain (past that) takes over - the same fraction `pitch.js` scores a hang past
// (`meterTime * (1 + HANG_GRACE_FRAC)`), imported rather than a second literal.
const GRACE_END = 1 + HANG_GRACE_FRAC;
// How much further past GRACE_END the drain fades to nothing - a pitch held indefinitely (nobody
// taps a second time) settles at "empty" instead of holding a stale bright picture forever.
const DRAIN_SPAN = 0.6;

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
 * value: 0..1 progress / fill fraction, meaning depends on state (can run past 1 for 'hung'/
 *   'released' - the hang grace and the release marker both do)
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
    // STAGE 8 row 1: `angleFor` (renamed from the module-private `angFor`) already carries the
    // 240deg sweep, so the swing ring's own charge/charged fill inherits it automatically - both
    // rings read the same geometry, "charged" reaching the top exactly as "released at the top of
    // the meter" does on the throw ring.
    if (state === 'idle') {
      // nothing extra: bare track
    } else if (state === 'charging') {
      ring(ctx, size, rIn, rOut, START, angleFor(v), '#c9d4e0');
    } else if (state === 'charged') {
      ring(ctx, size, rIn, rOut, START, angleFor(1), '#ffce3a');
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
  const niceA0 = angleFor(NICE_START);
  const niceA1 = angleFor(NICE_END);

  if (state === 'idle') {
    // bare track only - STAGE 8 row 2: nothing ticks until the player's own first tap.
  } else if (state === 'filling') {
    ring(ctx, size, rIn, rOut, START, angleFor(Math.min(v, NICE_START)), '#c9d4e0');
  } else if (state === 'nice' || state === 'released' || state === 'hung') {
    // The base sweep up to the nice zone, then the nice zone itself lit.
    ring(ctx, size, rIn, rOut, START, niceA0, '#c9d4e0');
    ring(ctx, size, rIn, rOut, niceA0, niceA1, 'rgba(255,255,255,0.55)');
    const vv = v == null ? NICE_END : v;
    if (vv > NICE_END) {
      // STAGE 8 row 1: past the top, the SAME clockwise fill continues in the hung warning colour
      // for the hang-grace window, rather than jumping straight to a drain - a release just past
      // the top still reads as "a little further along", not as an instant reset.
      const graceEnd = Math.min(vv, GRACE_END);
      const drainFrac = vv > GRACE_END ? Math.min(1, (vv - GRACE_END) / DRAIN_SPAN) : 0;
      const alpha = 0.55 * (1 - drainFrac);
      if (alpha > 0.02) ring(ctx, size, rIn, rOut, niceA1, angleFor(graceEnd), `rgba(160,170,180,${alpha.toFixed(3)})`);
    } else if (vv > NICE_START) {
      // Fill continuing INTO the nice zone as progress approaches the top - starts at niceA0 (where
      // the base fill above already left off), never at niceA1 (the zone's own far/top edge), or
      // this would sweep the wrong way round for any vv short of the top.
      ring(ctx, size, rIn, rOut, niceA0, angleFor(vv), '#c9d4e0');
    }
  }

  // Nice zone ticks + diamond: shown any time the throw ring is on screen, idle included (STAGE 8
  // row 2 - "that pitch meter thing starts with no warning" - the target has to be visible before
  // the first tap, not only once the fill has started).
  tick(ctx, size, rIn - 2, rOut + 2, niceA0, '#fff', 2);
  tick(ctx, size, rIn - 2, rOut + 2, niceA1, '#fff', 2);
  const midA = angleFor(NICE_CENTER);
  const dx = cx + Math.cos(midA) * (rIn + RING_THICK / 2);
  const dy = cy + Math.sin(midA) * (rIn + RING_THICK / 2);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();

  // release marker - drawn for any value, including past the top (the hang grace and the drain
  // both let a release land there; ui.js clamps how far).
  if (state === 'released' && value != null) {
    tick(ctx, size, rIn - 3, rOut + 3, angleFor(value), '#fff', 3);
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
