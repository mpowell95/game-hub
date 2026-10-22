import { drawRingState, NICE_CENTER, NICE_HALF } from './ring.js';

function setup(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// 1. Swing: a tap arrow on the left vs a hold bar with the ring filling on the right.
export function drawSwingDiagram(cv) {
  const { ctx, w, h } = setup(cv);
  ctx.clearRect(0, 0, w, h);
  const midX = w * 0.32;

  // TAP: a short downward arrow with one flash tick either side (a quick tap).
  ctx.save();
  ctx.translate(midX * 0.55, h * 0.5);
  ctx.strokeStyle = '#e9eef6';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(0, 10);
  ctx.moveTo(-6, 4);
  ctx.lineTo(0, 10);
  ctx.lineTo(6, 4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(233,238,246,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-14, -6); ctx.lineTo(-10, -2);
  ctx.moveTo(14, -6); ctx.lineTo(10, -2);
  ctx.stroke();
  ctx.restore();

  // divider
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(midX + 6, h * 0.15);
  ctx.lineTo(midX + 6, h * 0.85);
  ctx.stroke();

  // HOLD: a small ring, charging, to the right.
  const ringSize = h * 0.78;
  const ringCv = document.createElement('canvas');
  ringCv.width = ringSize; ringCv.height = ringSize;
  drawRingState(ringCv, 'swing', 'charging', 0.55);
  ctx.drawImage(ringCv, midX + 16, (h - ringSize) / 2, ringSize, ringSize);
}

// 2. Ring: the Nice zone at the top with its white ticks and a release tick inside it.
export function drawRingDiagram(cv) {
  const { ctx, w, h } = setup(cv);
  ctx.clearRect(0, 0, w, h);
  const size = h * 0.94;
  const ringCv = document.createElement('canvas');
  ringCv.width = size; ringCv.height = size;
  drawRingState(ringCv, 'throw', 'released', NICE_CENTER + NICE_HALF * 0.4);
  ctx.drawImage(ringCv, (w - size) / 2, (h - size) / 2, size, size);
}

// 4. Hang: the same ring, past the Nice zone with the fill draining - holding
// too long costs the pitch its power.
export function drawHangDiagram(cv) {
  const { ctx, w, h } = setup(cv);
  ctx.clearRect(0, 0, w, h);
  const size = h * 0.94;
  const ringCv = document.createElement('canvas');
  ringCv.width = size; ringCv.height = size;
  drawRingState(ringCv, 'throw', 'hung', 0.55);
  ctx.drawImage(ringCv, (w - size) / 2, (h - size) / 2, size, size);
}

// 3. Steering: the pad with a drag arrow toward the break side, and the ball
// bending the same way outside it.
export function drawSteeringDiagram(cv) {
  const { ctx, w, h } = setup(cv);
  ctx.clearRect(0, 0, w, h);

  // the pad
  const padX = w * 0.08, padY = h * 0.14, padS = h * 0.72;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  const r = 8;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(padX, padY, padS, padS, r) : ctx.rect(padX, padY, padS, padS);
  ctx.fill();
  ctx.stroke();

  // drag arrow toward the break side (down-right), profile-color
  const cx = padX + padS * 0.42, cy = padY + padS * 0.5;
  const ex = padX + padS * 0.8, ey = padY + padS * 0.78;
  ctx.strokeStyle = '#178A7A';
  ctx.fillStyle = '#178A7A';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const ang = Math.atan2(ey - cy, ex - cx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 7 * Math.cos(ang - 0.5), ey - 7 * Math.sin(ang - 0.5));
  ctx.lineTo(ex - 7 * Math.cos(ang + 0.5), ey - 7 * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();

  // the ball's path, bending the SAME way (a curve bowing toward the break side),
  // drawn to the right of the pad as a dashed track with a ball at the end.
  const trackX0 = w * 0.62, trackY0 = h * 0.18;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(trackX0, trackY0);
  ctx.quadraticCurveTo(trackX0 + 6, h * 0.5, trackX0 + 20, h * 0.86);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(trackX0 + 20, h * 0.86, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
