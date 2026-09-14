// field.js : the field renderer (BB-3 commit 2). Canvas 2D, no fielders drawn (doc §10, [Locked]:
// "out zones sit where fielders would stand") - grass, dirt, foul lines, bases, and the out-zone
// geometry `zonesFor()` already computes, at the league's own real distances (`FIELD[league]`).
//
// CAMERA: a real pinhole projection from behind home plate toward center field (see the constants
// below) - not an ad hoc curve. There was no approved mockup to lift this from this phase (the
// claude/baseball-mocks branch named in this phase's own handoff does not exist on the remote,
// confirmed twice); this is still a first cut and Matt should judge the angle once the ball is
// moving on it, but a real screenshot on 2026-09-14 showed the FIRST cut (a hand-tuned curve)
// collapsing the whole diamond into a vertical sliver - this replaces it with true perspective
// math so distances and widths are at least geometrically honest.

import { zonesFor } from './engine/zones.js';

// CAMERA: a real pinhole projection (not an ad hoc curve) - a camera sitting behind home plate,
// elevated, tilted down toward center field. World feet: home plate at the origin, +y toward
// center field, +x toward right field, ground at z=0. Chosen by computing the actual camX/camZ
// and camY/camZ ratios at home plate, first base and the fence for a range of (camBack, camHeight,
// tiltDeg) triples and picking the one where first base lands at a believable ~80% of the frame's
// half-width and the fence stays inside it - see /tmp/cam_calc.mjs's derivation (not committed;
// the numbers below are its output). This is what replaces phase 3's first-cut ad hoc curve, which
// a real device screenshot showed collapsing the whole diamond into a vertical sliver.
const CAM_BACK_FT = 12;   // camera sits this far behind home plate
const CAM_HEIGHT_FT = 9;  // camera height above the ground
const CAM_TILT_DEG = 16;  // how far down from horizontal the camera looks
const CAM_FAR_FT = 420;   // the far anchor for the vertical mapping (roughly a deep fence)
const CAM_X_SCALE = 0.72; // fraction of the half-width that camX/camZ = 1.0 maps to
const D2R = Math.PI / 180;

function cameraRatios(xFt, yFt) {
  const tilt = CAM_TILT_DEG * D2R;
  const vy = yFt + CAM_BACK_FT;
  const vz = -CAM_HEIGHT_FT;
  const camX = xFt;
  const camY = vy * Math.sin(tilt) + vz * Math.cos(tilt);
  const camZ = vy * Math.cos(tilt) - vz * Math.sin(tilt);
  return { xz: camX / camZ, yz: camY / camZ, camZ };
}

// The two vertical anchors (home plate and CAM_FAR_FT downrange), computed once - the mapping
// from camY/camZ to canvas Y is linear between these two ratios, which is what keeps depth
// perspective-correct rather than an arbitrary hand-tuned curve.
const YZ_HOME = cameraRatios(0, 0).yz;
const YZ_FAR = cameraRatios(0, CAM_FAR_FT).yz;

/** Project a point in feet (home plate at the origin, center field along +y, foul lines at
 *  +/-45deg) onto a canvas of size `w`x`h`. Home plate sits near the bottom, center field near
 *  the top; `pad` reserves a margin at both edges. `scale` is a size multiplier for anything drawn
 *  at that point (ball, bases, markers) - derived from the same camZ every other perspective cue
 *  uses, so nothing on the field disagrees about how far away something is. */
export function project(xFt, yFt, w, h, pad = 0.08) {
  const { xz, yz, camZ } = cameraRatios(xFt, yFt);
  const topY = h * pad;
  const botY = h * (1 - pad * 0.9);
  const t = (yz - YZ_HOME) / (YZ_FAR - YZ_HOME);
  const screenY = botY - t * (botY - topY);
  const screenX = w / 2 + xz * (w / 2) * CAM_X_SCALE;
  // Reference depth is home plate's own camZ; things at that depth draw at scale 1.
  const homeZ = cameraRatios(0, 0).camZ;
  const scale = Math.max(0.12, homeZ / camZ);
  return { x: screenX, y: screenY, scale };
}

function polarToXY(sprayDeg, ft) {
  const rad = (sprayDeg * Math.PI) / 180;
  return { x: Math.sin(rad) * ft, y: Math.cos(rad) * ft };
}

/** Draw the whole static field (grass, dirt, lines, bases, out-zone hatching) for one league.
 *  `ctx` a 2D canvas context already sized to `w`x`h` device pixels (caller handles DPR). */
export function drawField(ctx, w, h, league, fenceFt, dark) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const grass = dark ? '#1c3a24' : '#2f6b3a';
  const grass2 = dark ? '#1a3620' : '#2b6335';
  const dirt = dark ? '#5a4430' : '#b6895a';
  const dirtEdge = dark ? '#40311f' : '#8a6440';
  const line = dark ? '#e7edf5' : '#ffffff';
  const wallColor = dark ? '#8a94a3' : '#4a4a4a';

  // Grass field: a diamond-ish square rotated 45deg, its near corner at home plate.
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, w, h);
  // A subtle mow-stripe texture, alternating bands by depth - cosmetic only.
  ctx.fillStyle = grass2;
  for (let i = 0; i < 8; i++) {
    const y0 = project(0, (i / 8) * CAM_FAR_FT, w, h).y;
    const y1 = project(0, ((i + 0.5) / 8) * CAM_FAR_FT, w, h).y;
    ctx.fillRect(0, y1, w, Math.max(1, y0 - y1));
  }

  // Foul lines, stopping at the fence (drawn to the fence point along each line).
  const foulL = project(...Object.values(polarToXY(-45, fenceFt.left)), w, h);
  const foulR = project(...Object.values(polarToXY(45, fenceFt.right)), w, h);
  const home = project(0, 0, w, h);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(foulL.x, foulL.y);
  ctx.moveTo(home.x, home.y);
  ctx.lineTo(foulR.x, foulR.y);
  ctx.stroke();

  // Fence arc, sampled across the fair-territory span.
  ctx.beginPath();
  for (let deg = -45; deg <= 45; deg += 3) {
    const t = (deg + 45) / 90;
    const segT = t * 4;
    const i = Math.min(3, Math.floor(segT));
    const pts = [fenceFt.left, fenceFt.leftCenter, fenceFt.center, fenceFt.rightCenter, fenceFt.right];
    const ft = pts[i] + (pts[i + 1] - pts[i]) * (segT - i);
    const { x, y } = polarToXY(deg, ft);
    const p = project(x, y, w, h);
    if (deg === -45) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = wallColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Infield dirt: a diamond covering the basepaths, plus a skin arc reaching toward the mound.
  const baseFt = 90 / Math.SQRT2; // basepath diagonal half-length in fair-territory (x,y) feet
  const dirtPts = [
    polarToXY(0, 0),
    polarToXY(-45, 95),
    polarToXY(0, 130),
    polarToXY(45, 95),
  ].map((p) => project(p.x, p.y, w, h));
  ctx.beginPath();
  ctx.moveTo(dirtPts[0].x, dirtPts[0].y);
  for (const p of dirtPts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = dirt;
  ctx.fill();
  ctx.strokeStyle = dirtEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Home plate circle.
  ctx.beginPath();
  ctx.arc(home.x, home.y, 10 * home.scale, 0, Math.PI * 2);
  ctx.fillStyle = grass;
  ctx.fill();
  ctx.strokeStyle = dirtEdge;
  ctx.stroke();

  // Mound circle.
  const mound = project(0, 60.5, w, h);
  ctx.beginPath();
  ctx.arc(mound.x, mound.y, 16 * mound.scale, 0, Math.PI * 2);
  ctx.fillStyle = dirt;
  ctx.fill();
  ctx.strokeStyle = dirtEdge;
  ctx.stroke();

  // Three bases (white squares), at 90ft basepath corners.
  const baseAt = (deg) => project(...Object.values(polarToXY(deg, baseFt * Math.SQRT2)), w, h);
  const b1 = baseAt(45), b2 = project(0, 90 * Math.SQRT2, w, h), b3 = baseAt(-45);
  for (const b of [b1, b2, b3]) {
    const s = Math.max(10, 16 * b.scale);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = line;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = dirtEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }

  // Out-zone hatching (doc §10: "no fielders drawn, out zones sit where fielders would stand") -
  // outfield only. The infield sectors sit so close to home in this camera that hatch lines there
  // read as visual noise across the plate rather than as a legible zone; the out-zone geometry is
  // still real (used for gameplay and for the outfield hatch), just not drawn that close in.
  const zones = zonesFor(league, 0);
  const hatch = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)';
  ctx.strokeStyle = hatch;
  ctx.lineWidth = 1;
  const drawSector = (s) => {
    const steps = 5;
    for (let i = 1; i < steps; i++) {
      const deg = s.fromDeg + ((s.toDeg - s.fromDeg) * i) / steps;
      const inner = polarToXY(deg, s.fromFt);
      const outer = polarToXY(deg, s.toFt);
      const pI = project(inner.x, inner.y, w, h);
      const pO = project(outer.x, outer.y, w, h);
      ctx.beginPath();
      ctx.moveTo(pI.x, pI.y);
      ctx.lineTo(pO.x, pO.y);
      ctx.stroke();
    }
    // The two edges of the sector, so its span reads even where the interior lines are sparse.
    for (const deg of [s.fromDeg, s.toDeg]) {
      const inner = project(...Object.values(polarToXY(deg, s.fromFt)), w, h);
      const outer = project(...Object.values(polarToXY(deg, s.toFt)), w, h);
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
    }
  };
  for (const s of zones.outfield) drawSector(s);

  ctx.restore();
}

/** The ball: a white circle with a dark outline whose radius reflects how close it is to the
 *  viewer (bigger = closer). `t` is 0 at the pitcher's release, 1 at the plate for a pitch; for a
 *  batted ball, pass the ball's own current feet position directly via `atFt`. */
export function drawBall(ctx, w, h, xFt, yFt, opts = {}) {
  const p = project(xFt, yFt, w, h);
  const r = Math.max(2.5, (opts.baseRadius || 6) * p.scale);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  ctx.restore();
  return p;
}

/** A landing marker for a batted ball's result - drawn once the outcome is known. */
export function drawLandingMarker(ctx, w, h, xFt, yFt, kind, label, dark) {
  const p = project(xFt, yFt, w, h);
  ctx.save();
  const ink = dark ? '#e7edf5' : '#1a1a1a';
  if (kind === 'out') {
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 3;
    const s = 9;
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
    ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
    ctx.stroke();
  } else if (kind === 'hr') {
    ctx.fillStyle = '#ffce3a';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HR', p.x, p.y - 10);
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#2E7D4F';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || '', p.x, p.y);
  }
  ctx.restore();
}

export default { project, drawField, drawBall, drawLandingMarker };
