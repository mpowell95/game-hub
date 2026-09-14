// field.js : the field renderer (BB-3 commit 2, redrawn 2026-09-14 against the approved mocks).
// Canvas 2D, no fielders drawn (doc §10, [Locked]: "out zones sit where fielders would stand") -
// grass, dirt, foul lines, bases, and the out-zone geometry `zonesFor()` already computes, at the
// league's own real distances (`FIELD[league]`).
//
// This is a direct port of `mocks/baseball/field.js` on `claude/baseball-mocks` (fetched
// 2026-09-14, after two earlier checks - one at the start of this phase, one during the first
// real-device bug report - both found that branch absent; it exists now). The phase 3 first cut
// used a hand-derived camera (camBack 12ft, height 9ft, tilt 16deg) tuned only by eye against a
// still frame, and a real iPhone screenshot showed it collapsing the whole diamond into a vertical
// sliver. The mocks' camera is calibrated instead - solved against three framing targets (home
// plate near the bottom of the band, the mound about a third up, the fence near the top) rather
// than picked by eye - and its plan-view geometry is built on an exact (s, t) basepath coordinate
// system (u/v unit vectors along the two foul lines) so the diamond's 45-degree geometry can never
// drift off a hand-placed pixel the way the first cut's ad hoc polar sampling could.
//
// Ported rather than imported verbatim because this module's callers (`baseball/js/ui.js`) need a
// `project(xFt, yFt, w, h)` -> `{x, y, scale}` function usable for the ball and landing markers
// independent of a full `drawField` call, and a `drawField(ctx, w, h, league, fenceFt, dark)`
// signature that takes an already-sized context and this repo's own per-league fence shape
// (`FIELD[league].fenceFt`, a 5-point named-distance shape) rather than the mocks' single
// `fenceCenterFt` - the mocks only ever drew the college league. `dark` is accepted for call-site
// compatibility but unused: like every other camera-view sports field in this repo, the diamond
// itself has one identity (stadium lights, not a light/dark toggle) - see common.css's fixed
// `.bb-root` palette, which the mocks establish the same way.

import { zonesFor } from './engine/zones.js';
import { PARK_GEOMETRY } from './engine/settings.js';

const SQRT1_2 = Math.SQRT1_2; // cos(45deg) == sin(45deg)
const U = { x: SQRT1_2, y: SQRT1_2 };   // first-base line direction
const V = { x: -SQRT1_2, y: SQRT1_2 };  // third-base line direction

function stToXY(s, t) {
  return { x: s * U.x + t * V.x, y: s * U.y + t * V.y };
}
function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

const B = PARK_GEOMETRY.basePathFt;       // 90
const P = PARK_GEOMETRY.pitcherDistFt;    // 60.5
const DIRT_RADIUS_REF = PARK_GEOMETRY.infieldDirtRadiusFt; // 95, at B=90

const PLATE_FRONT_W = 17 / 12;
const PLATE_SIDE = 8.5 / 12;
function platePolygon() {
  const hw = PLATE_FRONT_W / 2;
  return [
    { x: -hw, y: PLATE_FRONT_W },
    { x: hw, y: PLATE_FRONT_W },
    { x: hw, y: PLATE_SIDE },
    { x: 0, y: 0 },
    { x: -hw, y: PLATE_SIDE },
  ];
}

function diamondPoints() {
  const home = { x: 0, y: 0 };
  const first = stToXY(B, 0);
  const third = stToXY(0, B);
  const second = stToXY(B, B);
  return { home, first, third, second };
}

const BASE_FT = 1.5;
const MOUND_RADIUS = 9;
function moundCenterY() { return P - 1.5; }

function infieldGrassSquare() {
  const lo = 3, hi = B - 3;
  return [[lo, lo], [hi, lo], [hi, hi], [lo, hi]].map(([s, t]) => stToXY(s, t));
}

const HOME_CIRCLE_REF_R = 13;
function homeCircleRadius() { return HOME_CIRCLE_REF_R * (B / 90); }

function infieldDirtArc(radius) {
  const C = { x: 0, y: P };
  const k = SQRT1_2;
  const b = -2 * P * k;
  const c = P * P - radius * radius;
  const disc = b * b - 4 * c;
  const s = (-b + Math.sqrt(disc)) / 2;
  const pFirst = stToXY(s, 0);
  const pThird = stToXY(0, s);
  const a1 = Math.atan2(pFirst.y - C.y, pFirst.x - C.x);
  const a2 = Math.atan2(pThird.y - C.y, pThird.x - C.x);
  return { center: C, radius, a1, a2, s };
}

function infieldSkinPolygon(dirt) {
  const pFirst = stToXY(dirt.s, 0);
  const pThird = stToXY(0, dirt.s);
  const pts = [{ x: 0, y: 0 }, pFirst];
  const N = 24;
  for (let i = 1; i < N; i++) {
    const a = dirt.a1 + (dirt.a2 - dirt.a1) * (i / N);
    pts.push({ x: dirt.center.x + Math.cos(a) * dirt.radius, y: dirt.center.y + Math.sin(a) * dirt.radius });
  }
  pts.push(pThird);
  return pts;
}

function baseCenters() {
  return {
    first: stToXY(B, BASE_FT / 2),
    third: stToXY(BASE_FT / 2, B),
    second: stToXY(B, B),
  };
}

function basepathLanes() {
  const rectST = (s0, s1, t0, t1) => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => stToXY(s, t));
  return {
    homeFirst: rectST(0, B, -3, 3),
    homeThird: rectST(-3, 3, 0, B),
    firstSecond: rectST(B - 3, B + 3, 0, B),
    secondThird: rectST(0, B, B - 3, B + 3),
  };
}

const BOX_W = 4, BOX_L = 6, BOX_GAP = 0.5;
function batterBoxes() {
  const nearX = PLATE_FRONT_W / 2 + BOX_GAP;
  const yMid = PLATE_SIDE;
  const mk = (x0) => [
    { x: x0, y: yMid - BOX_L / 2 }, { x: x0 + BOX_W, y: yMid - BOX_L / 2 },
    { x: x0 + BOX_W, y: yMid + BOX_L / 2 }, { x: x0, y: yMid + BOX_L / 2 },
  ];
  return { right: mk(nearX), left: mk(-nearX - BOX_W) };
}

/* ================================================================ CAMERA ==== *
 * Elevated, from behind and above home plate, tilted down toward the field - solved once against
 * three framing targets (home plate near the bottom of the band, the mound about a third up, the
 * fence near the top - `mocks/baseball/field.js`'s own header) rather than eyeballed. Every point
 * below goes through the same transform. */
const CAM_BACK = 105.75;
const CAM_HEIGHT = 153.27;
const CAM_TILT = (35.92 * Math.PI) / 180;
const CAM_FOCAL = 1.244;
const CT = Math.cos(CAM_TILT), ST = Math.sin(CAM_TILT);

function projectUV(x, y) {
  const zCam = (y + CAM_BACK) * CT + CAM_HEIGHT * ST;
  const yCam = (y + CAM_BACK) * ST - CAM_HEIGHT * CT;
  const u = 0.5 + (CAM_FOCAL * x) / zCam;
  const v = 0.5 - (CAM_FOCAL * yCam) / zCam;
  return { u, v, zCam };
}

// Home plate's own camera distance is the scale reference (scale 1 at the plate); anything nearer
// the camera than that (nothing on this field is) would come out bigger, anything farther, smaller
// - matches how `drawBall`/`drawLandingMarker`'s callers already read `scale`.
const HOME_Z = projectUV(0, 0).zCam;

/** Project a point in feet (home plate at the origin, +y toward center field, foul lines at
 *  +/-45deg) onto a canvas of size `w`x`h`. */
export function project(xFt, yFt, w, h) {
  const { u, v, zCam } = projectUV(xFt, yFt);
  return { x: u * w, y: v * h, scale: Math.max(0.08, HOME_Z / zCam) };
}

function toScreen(pt, w, h) { return project(pt.x, pt.y, w, h); }

function pathFor(ctx, pts, w, h) {
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const s = toScreen(pt, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

// A "ground widget" (a small, roughly circular dirt feature) is smaller on screen than a naive
// per-point projection of its true edge would give this close to the camera - see
// mocks/baseball/field.js's own comment. A single isotropic scale, measured the same way anything
// else in the picture is measured (home-to-first's own screen length over its own 90ft), keeps a
// small feature reading at the same scale as its surroundings.
function groundScale(refA, refB, refFt, w, h) {
  const a = toScreen(refA, w, h), b = toScreen(refB, w, h);
  return Math.hypot(b.x - a.x, b.y - a.y) / refFt;
}
function drawGroundCircle(ctx, center, radiusFt, scalePxPerFt, w, h) {
  const c = toScreen(center, w, h);
  const r = radiusFt * scalePxPerFt;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
}

// Where a foul line should stop: the true fence intersection sits far outside the frame at this
// camera's calibrated field of view, so a foul line drawn to that true point would exit through
// the side of the canvas well past where the fence arc has already left through the top. The fence
// arc IS the fence as far as this picture can show it, so a foul line stops wherever that arc's own
// drawn curve leaves the canvas.
function fenceExitPoint(fenceR, side, w, h) {
  const N = 400;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const angle = side * 45 * (i / N);
    const pt = polar(angle, fenceR);
    const s = toScreen(pt, w, h);
    if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) {
      if (!prev) return s;
      const target = s.x < 0 ? 0 : s.x > w ? w : (s.y < 0 ? 0 : h);
      const usesX = s.x < 0 || s.x > w;
      const t = usesX ? (target - prev.x) / (s.x - prev.x) : (target - prev.y) / (s.y - prev.y);
      return { x: prev.x + (s.x - prev.x) * t, y: prev.y + (s.y - prev.y) * t };
    }
    prev = s;
  }
  return prev;
}

let _hatch;
function hatchPattern(ctx) {
  if (_hatch) return _hatch;
  const s = document.createElement('canvas');
  s.width = 8; s.height = 8;
  const sc = s.getContext('2d');
  sc.strokeStyle = 'rgba(255,255,255,0.14)';
  sc.lineWidth = 2;
  sc.beginPath();
  sc.moveTo(-2, 8); sc.lineTo(8, -2);
  sc.moveTo(0, 10); sc.lineTo(10, 0);
  sc.stroke();
  _hatch = ctx.createPattern(s, 'repeat');
  return _hatch;
}

function drawSector(ctx, w, h, sector, pattern) {
  const N = 10;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(polar(sector.fromDeg + (sector.toDeg - sector.fromDeg) * (i / N), sector.toFt));
  for (let i = N; i >= 0; i--) pts.push(polar(sector.fromDeg + (sector.toDeg - sector.fromDeg) * (i / N), sector.fromFt));
  pathFor(ctx, pts, w, h);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(6,10,6,0.28)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Draw the whole static field (grass, dirt, lines, bases, out-zone hatching) for one league.
 *  `ctx` a 2D canvas context already sized to `w`x`h` device pixels (caller handles DPR). `dark`
 *  is accepted for call-site compatibility but unused - see the module header. */
export function drawField(ctx, w, h, league, fenceFt, dark) {
  const { home, first, third } = diamondPoints();
  const baseC = baseCenters();
  const mCY = moundCenterY();
  const dirt = infieldDirtArc(DIRT_RADIUS_REF * (B / 90));
  const boxes = batterBoxes();
  // This repo's fence is a 5-point named-distance shape, not the mocks' single radius; the center
  // distance is what the mocks calibrated the camera's framing against, so it is the arc radius
  // used for the fence-exit calculation (where the foul lines stop) and for the fair-territory
  // tint's own wedge. The visible arc itself is still sampled across the full named shape below.
  const fenceR = fenceFt.center;
  const GRASS = '#3f6b34', DIRT = '#a9713f';

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  const wedge = [];
  const N = 24;
  wedge.push(home);
  for (let i = 0; i <= N; i++) wedge.push(polar(-45 + 90 * (i / N), fenceR));
  pathFor(ctx, wedge, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill('evenodd');
  ctx.restore();

  pathFor(ctx, infieldSkinPolygon(dirt), w, h);
  ctx.fillStyle = DIRT;
  ctx.fill();

  pathFor(ctx, infieldGrassSquare(), w, h);
  ctx.fillStyle = GRASS;
  ctx.fill();

  const lanes = basepathLanes();
  ctx.fillStyle = DIRT;
  for (const key of ['homeFirst', 'homeThird', 'firstSecond', 'secondThird']) {
    pathFor(ctx, lanes[key], w, h);
    ctx.fill();
  }

  const scale = groundScale(home, first, B, w, h);
  ctx.fillStyle = DIRT;
  drawGroundCircle(ctx, home, homeCircleRadius(), scale, w, h);
  ctx.fill();
  drawGroundCircle(ctx, { x: 0, y: mCY }, MOUND_RADIUS, scale, w, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  drawGroundCircle(ctx, { x: 0, y: mCY }, MOUND_RADIUS, scale, w, h);
  ctx.stroke();

  // Fence arc: sampled across the real 5-point named shape (left/leftCenter/center/rightCenter/
  // right), interpolated piecewise - unlike the mocks (which only ever drew one league's single
  // radius), every league here has its own shape.
  const fencePts = [];
  const shapePts = [fenceFt.left, fenceFt.leftCenter, fenceFt.center, fenceFt.rightCenter, fenceFt.right];
  for (let i = 0; i <= N; i++) {
    const deg = -45 + 90 * (i / N);
    const t = (deg + 45) / 90;
    const segT = t * 4;
    const seg = Math.min(3, Math.floor(segT));
    const ft = shapePts[seg] + (shapePts[seg + 1] - shapePts[seg]) * (segT - seg);
    fencePts.push(polar(deg, ft));
  }
  ctx.beginPath();
  fencePts.forEach((pt, i) => {
    const s = toScreen(pt, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.strokeStyle = '#1a2a17';
  ctx.lineWidth = 6;
  ctx.stroke();

  // out zones (doc §10: no fielders drawn - out zones sit where fielders would stand)
  const zones = zonesFor(league, 0);
  const pattern = hatchPattern(ctx);
  for (const s of zones.outfield) {
    drawSector(ctx, w, h, { fromDeg: s.fromDeg, toDeg: s.toDeg, fromFt: s.fromFt, toFt: s.toFt }, pattern);
  }

  // foul lines: home -> wherever the fence arc itself leaves the frame.
  const exitL = fenceExitPoint(fenceR, -1, w, h);
  const exitR = fenceExitPoint(fenceR, 1, w, h);
  const sHome = toScreen(home, w, h);
  ctx.beginPath();
  ctx.moveTo(exitL.x, exitL.y);
  ctx.lineTo(sHome.x, sHome.y);
  ctx.lineTo(exitR.x, exitR.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // rubber: 24in x 6in, centered at (0, P)
  const rubW = 2, rubD = 0.5;
  pathFor(ctx, [
    { x: -rubW / 2, y: P - rubD / 2 }, { x: rubW / 2, y: P - rubD / 2 },
    { x: rubW / 2, y: P + rubD / 2 }, { x: -rubW / 2, y: P + rubD / 2 },
  ], w, h);
  ctx.fillStyle = '#f4f6fb';
  ctx.fill();

  // strike zone, above the plate
  const zoneHalfW = Math.abs(toScreen({ x: PLATE_FRONT_W / 2 + 0.3, y: 1 }, w, h).x - toScreen({ x: -(PLATE_FRONT_W / 2 + 0.3), y: 1 }, w, h).x) / 2;
  const zoneTop = toScreen({ x: 0, y: 4.2 }, w, h).y;
  const zoneBottom = toScreen({ x: 0, y: 1 }, w, h).y;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(sHome.x - zoneHalfW, zoneTop, zoneHalfW * 2, zoneBottom - zoneTop);

  // batter's boxes
  ctx.strokeStyle = 'rgba(230,230,230,0.7)';
  ctx.lineWidth = 1.5;
  pathFor(ctx, boxes.right, w, h); ctx.stroke();
  pathFor(ctx, boxes.left, w, h); ctx.stroke();

  // bases: 18in squares, white, drawn at a fixed on-screen size (true-to-scale corners project to
  // well under a pixel at this camera distance - see the module header's ground-widget note).
  const BASE_PX = 8;
  ctx.fillStyle = '#f4f6fb';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  for (const key of ['first', 'third', 'second']) {
    const s = toScreen(baseC[key], w, h);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-BASE_PX / 2, -BASE_PX / 2, BASE_PX, BASE_PX);
    ctx.strokeRect(-BASE_PX / 2, -BASE_PX / 2, BASE_PX, BASE_PX);
    ctx.restore();
  }

  // home plate pentagon
  pathFor(ctx, platePolygon(), w, h);
  ctx.fillStyle = '#f4f6fb';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/** The ball: a white circle with a dark outline whose radius reflects how close it is to the
 *  viewer (bigger = closer). */
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

// Exported for the geometry self-check (measured in the plan view, before projection) - mirrors
// mocks/baseball/field.js's own planGeometry, kept here so baseball/js/test.js can assert the
// 45-degree/1.41421 facts directly rather than trusting the camera math not to have disturbed them.
export function planGeometry() {
  const { home, first, second, third } = diamondPoints();
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleOf = (pnt) => (Math.atan2(pnt.x, pnt.y) * 180) / Math.PI;
  return {
    home, first, second, third,
    homeToFirst: dist(home, first),
    homeToSecond: dist(home, second),
    ratio: dist(home, second) / dist(home, first),
    firstLineAngle: angleOf(first),
    thirdLineAngle: angleOf(third),
    foulAngleSpread: angleOf(first) - angleOf(third),
  };
}

export default { project, drawField, drawBall, drawLandingMarker, planGeometry };
