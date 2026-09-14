// field.js : the field renderer. TWO cameras, for two different jobs:
//
// 1. The OVERHEAD camera (`project`/`drawField`/`drawBall`/`drawLandingMarker`, unchanged from the
//    2026-09-14 mocks port below) - a wide, elevated view of the whole infield. Used ONLY for the
//    cutaway that plays when a ball is put in play: on contact the field band cuts to this view so
//    the batted ball's flight, the out-zone geometry, and its landing marker are all visible at
//    once, then cuts back to the plate camera for the next pitch. See "WHAT TO DO ABOUT OUT ZONES"
//    below and `baseball/CLAUDE.md`'s "The camera was rebuilt to match the reference" for the
//    decision record (Matt chose this over a soft pull-back or dropping the visual entirely).
//
// 2. The PLATE camera (`projectPlate`/`drawPlateView`/`drawPlateBall`, added 2026-09-14) - a real
//    over-the-shoulder view, low and close, for the actual pitch: batting looks from behind/above
//    the batter out toward the pitcher; pitching is the mirror. This is the view live for every
//    pitch - aiming, the windup, the ball's flight to or from the plate - and is what the whole
//    rebuild below is about. See its own section header for the camera math and why the overhead
//    camera's approach (a calibrated but still relatively distant, top-down-ish view) cannot do
//    this job: a close, low, foreshortened camera and a wide elevated one are not the same camera
//    at a different zoom - the ground plane, the horizon, and the size falloff all behave
//    differently close in than they do from above.
//
// Both cameras take a plain 2D canvas context the caller has already sized (DPR handled by the
// caller) and share this repo's per-league fence shape (`FIELD[league].fenceFt`).
//
// ---------------------------------------------------------------- the overhead camera ----
//
// `project`/`drawField`/`drawBall`/`drawLandingMarker` below are a direct port of
// `mocks/baseball/field.js` on `claude/baseball-mocks` (fetched 2026-09-14, after two earlier
// checks - one at the start of this phase, one during the first real-device bug report - both
// found that branch absent; it exists now). The phase 3 first cut used a hand-derived camera
// (camBack 12ft, height 9ft, tilt 16deg) tuned only by eye against a still frame, and a real
// iPhone screenshot showed it collapsing the whole diamond into a vertical sliver. The mocks'
// camera is calibrated instead - solved against three framing targets (home plate near the bottom
// of the band, the mound about a third up, the fence near the top) rather than picked by eye - and
// its plan-view geometry is built on an exact (s, t) basepath coordinate system (u/v unit vectors
// along the two foul lines) so the diamond's 45-degree geometry can never drift off a hand-placed
// pixel the way the first cut's ad hoc polar sampling could.
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
//
// This camera was the ONLY one in the build until 2026-09-14's camera rebuild (Matt, with two
// Mario Superstar Baseball reference screenshots: *"The play screen's camera is fundamentally
// wrong... this game was always meant to match"* that reference's close, over-the-shoulder view,
// never a top-down one). It is kept, unmodified, as the cutaway camera - see the PLATE camera
// section below for what changed and why.

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

/* ================================================================================================
 * THE PLATE CAMERA (2026-09-14 camera rebuild) - the real over-the-shoulder view, live for every
 * pitch. Matt: *"a low camera positioned behind and slightly above the batter, looking out toward
 * the pitcher. The batter is in the near foreground at the bottom of the frame... This is a
 * first-person-ish over-the-shoulder view, not a map."* Pitching is the mirror: a low camera
 * behind and slightly above the pitcher, looking in toward home plate.
 *
 * ONE camera definition serves both - `plateSpace()` below transforms world coordinates so
 * "batting" and "pitching" are the same camera looking down the same corridor from opposite ends
 * (home plate is this camera's own origin either way; pitching maps the real world so the mound
 * becomes that origin and turns the batter into the far object, mirroring x the way turning 180
 * degrees actually flips left/right).
 *
 * THE MATH: a real pinhole camera, low (chest height) and close (a couple of feet behind the
 * plate/mound), tilted down only slightly, projected with NO artificial two-point remap on either
 * axis (unlike the overhead camera above) - true perspective division throughout, because the
 * whole point of this camera is the size falloff and the foul-line divergence that only true
 * perspective produces. The constants were solved (not eyeballed) against two targets: home plate
 * near the very bottom of the frame (v ~= 0.90) and the mound at middle distance (v ~= 0.48) - see
 * `/tmp/plate_cam2.mjs`'s grid search (not committed; its output is these numbers). A consequence,
 * checked rather than assumed: with a low, near-level camera, a flat ground plane's vertical
 * position asymptotically approaches a horizon line very quickly past the mound (v moves from 0.90
 * at home to 0.48 at the mound to just 0.465 at true infinity) - true to real low-angle-camera
 * optics, not a bug, but it means there is no honest "to-scale" position for a real fence 300-400ft
 * away: it would sit almost exactly on top of the mound in screen space. So the fence/outfield
 * beyond the mound is a STYLIZED backdrop band (flat colors, not a projected polygon), while
 * everything that actually matters for gameplay - the mound, the dirt, the foul lines, the plate,
 * the two players, the ball - is real projected geometry all the way through.
 */
const D2R = Math.PI / 180;
const PLATE_CAM_BACK_FT = 2;     // how far behind the near player's own spot the camera sits
const PLATE_CAM_HEIGHT_FT = 3.5; // chest/shoulder height, low - not a broadcast crane
const PLATE_CAM_TILT_DEG = 7;    // slight downward tilt so the ground recedes correctly
const PLATE_CAM_FOCAL = 0.3;     // solved alongside the constants above for the home/mound framing
const PLATE_CAM_X_SCALE = 2.6;   // lateral aggressiveness - a close camera's foul lines should
                                  // reach the frame edges within a few feet of the plate, not
                                  // gently bow outward across the whole depth of the shot
const PCT = Math.cos(PLATE_CAM_TILT_DEG * D2R);
const PST = Math.sin(PLATE_CAM_TILT_DEG * D2R);

/** Batting looks from behind home plate toward the mound; pitching is the same camera turned
 *  180deg, so the mound becomes its own "home" and x mirrors (turning around flips left/right). */
function plateSpace(xFt, yFt, mode) {
  return mode === 'pitching' ? { fx: -xFt, fy: P - yFt } : { fx: xFt, fy: yFt };
}
function plateRatios(xFt, yFt, mode) {
  const { fx, fy } = plateSpace(xFt, yFt, mode);
  const fwd = fy + PLATE_CAM_BACK_FT;
  const zCam = fwd * PCT + PLATE_CAM_HEIGHT_FT * PST;
  const yCam = fwd * PST - PLATE_CAM_HEIGHT_FT * PCT;
  return { fx, zCam, yCam };
}
// Reference depth (the near player's own standing spot) - scale 1 there, in EITHER mode, by the
// symmetry plateSpace() sets up (both modes reduce to the same fwd/zCam at their own origin).
const PLATE_HOME_Z = plateRatios(0, 0, 'batting').zCam;
// The true horizon (fwd -> infinity): where the stylized backdrop band starts.
const PLATE_HORIZON_V = 0.5 - PLATE_CAM_FOCAL * (PST / PCT);

/** Project a point in feet through the PLATE camera. `mode` is 'batting' or 'pitching' - see the
 *  section header. Returns `{x, y, scale}` in the same shape as the overhead camera's `project`. */
export function projectPlate(xFt, yFt, w, h, mode) {
  const { fx, zCam, yCam } = plateRatios(xFt, yFt, mode);
  const v = 0.5 - (PLATE_CAM_FOCAL * yCam) / zCam;
  const u = 0.5 + (PLATE_CAM_FOCAL * PLATE_CAM_X_SCALE * fx) / zCam;
  return { x: u * w, y: v * h, scale: Math.max(0.01, PLATE_HOME_Z / zCam) };
}

function plateScreen(xFt, yFt, w, h, mode) {
  const p = projectPlate(xFt, yFt, w, h, mode);
  return { x: p.x, y: p.y };
}
function platePath(ctx, pts, w, h, mode) {
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const s = plateScreen(pt.x, pt.y, w, h, mode);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}
/** A small ground-level circle (the plate dirt, the mound), sampled around its true world edge and
 *  projected point by point - NOT drawn as a screen-space ellipse. This is what makes it read as a
 *  patch of ground seen from low and close (wide and short) rather than a shape hovering in space. */
function plateGroundCircle(cx, cy, radiusFt, w, h, mode, fromDeg = 0, toDeg = 360) {
  const pts = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / N;
    const a = deg * D2R;
    pts.push({ x: cx + Math.sin(a) * radiusFt, y: cy + Math.cos(a) * radiusFt });
  }
  return pts;
}

/** A flat 2D player silhouette (no assets in this repo for a modeled figure) - a cap, a head, and
 *  a torso/legs capsule, drawn at `xFt,yFt` and scaled by that point's own camera scale so it sits
 *  correctly in the perspective (huge in the near foreground, tiny in the distance) without a
 *  separate size system of its own. `facing` is 1 (facing away from camera, toward the far end -
 *  the near player, seen from behind/the side) or -1 (facing the camera - the far player, seen
 *  face-on). Deliberately static - no windup/swing pose states this pass (see field.js's own
 *  header and baseball/CLAUDE.md - pacing/windup/swing feedback are explicitly out of scope). */
// A figure standing exactly at the camera's own reference depth (scale 1.0) is drawn at this
// fraction of the frame's own height - not a real-world foot conversion (this ground-only camera
// model has no true vertical/elevation axis, only the ground-plane depth `scale` already computed
// for everything else), a directly-tuned fraction chosen to match the reference's own framing: the
// near player fills roughly half the frame, the far one reads as a small, clearly separate figure.
const PLATE_FIGURE_REF_FRAC = 0.6;
function drawPlateFigure(ctx, w, h, xFt, yFt, mode, color) {
  const p = projectPlate(xFt, yFt, w, h, mode);
  const scale = p.scale;
  const bodyH = Math.max(3, h * PLATE_FIGURE_REF_FRAC * scale);
  const bodyW = bodyH * 0.42;
  const legH = bodyH * 0.42;
  const torsoH = bodyH * 0.4;
  const headR = bodyH * 0.16;
  ctx.save();
  ctx.translate(p.x, p.y);
  // legs
  ctx.fillStyle = 'rgba(20,20,25,0.85)';
  ctx.fillRect(-bodyW * 0.28, -legH, bodyW * 0.24, legH);
  ctx.fillRect(bodyW * 0.04, -legH, bodyW * 0.24, legH);
  // torso
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-bodyW / 2, -legH - torsoH, bodyW, torsoH, bodyW * 0.3)
    : ctx.rect(-bodyW / 2, -legH - torsoH, bodyW, torsoH);
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.arc(0, -legH - torsoH - headR, headR, 0, Math.PI * 2);
  ctx.fillStyle = '#e8c39e';
  ctx.fill();
  // cap
  ctx.beginPath();
  ctx.arc(0, -legH - torsoH - headR, headR * 1.05, Math.PI, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** The full static plate-view scene: sky/backdrop, grass, the two dirt patches (plate + mound),
 *  the rubber, foul lines, home plate, and both players. Everything but the sky/fence backdrop is
 *  real projected ground-plane geometry - see the section header for why the backdrop alone is
 *  stylized. `dark` is accepted for call-site compatibility (see the overhead camera's own note)
 *  but this camera's night-stadium palette is close to what a dark-mode reader would want anyway,
 *  so it is used lightly (a cooler sky) rather than ignored outright. League is not a parameter -
 *  the backdrop is stylized regardless of league (see the section header), and every other shape
 *  here (the mound, the plate, the foul lines) is at fixed real-world distances that don't vary by
 *  league the way the outfield fence does. */
export function drawPlateView(ctx, w, h, mode, dark) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  const horizonY = h * PLATE_HORIZON_V;
  const backdropTopY = Math.max(0, horizonY - h * 0.14);

  // Sky / stadium backdrop (stylized - see header).
  ctx.fillStyle = dark ? '#16202f' : '#8fc3ec';
  ctx.fillRect(0, 0, w, backdropTopY);
  ctx.fillStyle = dark ? '#22303f' : '#4a6b52';
  ctx.fillRect(0, backdropTopY, w, Math.max(0, horizonY - backdropTopY) + 2);

  // Grass, full ground plane.
  ctx.fillStyle = '#3f6b34';
  ctx.fillRect(0, horizonY, w, h - horizonY);

  // Mound dirt patch - the HOME-FACING HALF ONLY (angles 90-270 around the mound's own center,
  // per plateGroundCircle's own convention), not a full circle. In batting mode the mound is far
  // (safe either way), but in pitching mode this same world point IS the camera's own near
  // reference - a full circle would sample points on the far side of the mound, behind the pitcher
  // (and briefly behind the camera itself), which is exactly what produced a self-crossing
  // hourglass smear the first time this was tried (found on a real render, not assumed). The back
  // half is naturally hidden behind the pitcher's own body from this angle anyway, so cutting it is
  // also just correct, not merely a workaround.
  platePath(ctx, plateGroundCircle(0, P, 9, w, h, mode, 90, 270), w, h, mode);
  ctx.fillStyle = '#a9713f';
  ctx.fill();
  // The rubber is a near-field detail under the pitcher's own feet - only drawn in batting mode,
  // where it is small and far (safe). In pitching mode it would sit almost exactly at the camera's
  // own position (the same near-singularity the mound circle above has to dodge) and would in any
  // case be occluded by the pitcher's own body from this angle, so it is simply not drawn there.
  if (mode === 'batting') {
    platePath(ctx, [{ x: -1, y: P - 0.25 }, { x: 1, y: P - 0.25 }, { x: 1, y: P + 0.25 }, { x: -1, y: P + 0.25 }], w, h, mode);
    ctx.fillStyle = '#f4f6fb';
    ctx.fill();
  }

  // Home-plate dirt fan - a hand-placed forward-biased trapezoid (never a true circle sampled
  // behind the camera, which the 2ft camBack makes a real risk this close in) covering the
  // batter's box and the ground immediately in front of the plate.
  platePath(ctx, [{ x: -9, y: 0.3 }, { x: 9, y: 0.3 }, { x: 6, y: 16 }, { x: -6, y: 16 }], w, h, mode);
  ctx.fillStyle = '#a9713f';
  ctx.fill();

  // Foul lines: home plate outward toward the mound and beyond - true perspective divergence,
  // no hand-tuned curve.
  const linePts = [];
  for (let yf = 0; yf <= 70; yf += 2) linePts.push({ x: yf, y: yf });
  ctx.beginPath();
  linePts.forEach((pt, i) => { const s = plateScreen(pt.x, pt.y, w, h, mode); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  linePts.forEach((pt, i) => { const s = plateScreen(-pt.x, pt.y, w, h, mode); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
  ctx.stroke();

  // Home plate pentagon.
  platePath(ctx, platePolygon(), w, h, mode);
  ctx.fillStyle = '#f4f6fb';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // The two players. The NEAR one (whichever the camera is behind) is huge foreground, off to one
  // side of the plate/mound the way an over-the-shoulder shot naturally frames its own subject; the
  // FAR one stands where their role puts them.
  const cbTeal = '#178A7A', cbBlue = '#1F5FA8';
  if (mode === 'batting') {
    drawPlateFigure(ctx, w, h, 0, P, 'batting', cbBlue);      // pitcher, far, on the mound
    drawPlateFigure(ctx, w, h, 1.2, 2.0, 'batting', cbTeal);  // batter, near, in the box
  } else {
    drawPlateFigure(ctx, w, h, 0, 0, 'pitching', cbTeal);     // batter, far, at the plate
    drawPlateFigure(ctx, w, h, -1.0, P - 2, 'pitching', cbBlue); // pitcher, near, on the mound
  }

  ctx.restore();
}

// Same reasoning as PLATE_FIGURE_REF_FRAC: a ball at the camera's own reference depth (scale 1.0)
// reads at this fraction of the frame's height across its diameter - tuned so it reads as "about
// to reach the batter/camera" near the plate and as a small dot leaving the pitcher's hand.
const PLATE_BALL_REF_FRAC = 0.045;
/** The ball, through the plate camera - grows as it approaches (batting) or shrinks as it
 *  recedes (pitching), driven entirely by `projectPlate`'s own scale, never a separate curve. */
export function drawPlateBall(ctx, w, h, xFt, yFt, mode, opts = {}) {
  const p = projectPlate(xFt, yFt, w, h, mode);
  const r = Math.max(1.5, h * PLATE_BALL_REF_FRAC * (opts.sizeMult || 1) * p.scale);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, 1.2 * p.scale);
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  ctx.restore();
  return p;
}

export default {
  project, drawField, drawBall, drawLandingMarker, planGeometry,
  projectPlate, drawPlateView, drawPlateBall,
};
