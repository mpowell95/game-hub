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
 * THE PLATE CAMERA (rebuilt 2026-09-14, BB-3b art pass) - a real painted background
 * (`baseball/img/plate.webp`, ported from `reference/baseball/backdrop-plate.jpg`), not a
 * procedural pinhole projection. The prior round (same day, "camera rebuild") built a real
 * perspective-divide camera from scratch because no approved art existed yet; that math is gone
 * now that it does. See `baseball/CLAUDE.md`'s BB-3b entry for the full record, but the short
 * version: a hand-derived camera can never match a hand-painted picture pixel for pixel, so once
 * the picture exists, the picture IS the camera and everything else positions off six measured
 * points in it (`PLATE_ANCHORS` below), not off a re-derived lens model.
 *
 * ONE FIXED CAMERA, both states - this reverses the prior round's 180-degree pitching mirror
 * (Matt's own earlier call). The handoff's reasoning, carried here rather than re-litigated: the
 * reference art only exists shot from behind the plate (both batters drawn from behind, the
 * pitcher facing the camera), a mirror would need art that does not exist (a front-view batter, a
 * back-view pitcher), and the approved mock is this camera. So the picture never changes between
 * batting and pitching - only WHICH SPRITE stands at each of the two anchored spots does:
 * whichever team is BATTING has its batter at the near box (`batter-home.webp` for you,
 * `batter-away.webp` for the CPU), and whichever team is PITCHING has its pitcher at the mound
 * (always the three `pitcher-*.webp` poses - the art itself carries no team color). This is a
 * fixed spectator's view of the at-bat, not literally the human's own first-person view when
 * pitching - "the two states differ only by which batter sprite stands at the near box and which
 * label the button carries" (the handoff's own framing). NOT YET RATIFIED BY MATT - report this
 * reversal back to him rather than presenting it as settled (see the handoff's own report-back
 * list).
 */

// ---------------------------------------------------------------------- image loading (sync-cacheable) --
// `drawPlateView`/`drawPlateBall` run inside `requestAnimationFrame` loops and must stay
// synchronous, so images are loaded once into a plain cache keyed by filename; a draw call before
// an image has finished loading just falls back to a flat fill (see `drawPlateView`) rather than
// awaiting anything mid-frame.
const IMG_BASE = new URL('../img/', import.meta.url);
const _plateImages = {};
function _loadImg(name) {
  if (name in _plateImages) return;
  _plateImages[name] = null;
  const image = new Image();
  image.onload = () => { _plateImages[name] = image; };
  image.onerror = () => { /* leaves it null; drawPlateView's fallback fill covers this */ };
  image.src = new URL(name, IMG_BASE).href;
}
const PLATE_IMAGE_NAMES = [
  'plate.webp',
  'batter-home-1.webp', 'batter-home-2.webp', 'batter-home-3.webp', 'batter-home-4.webp',
  'batter-home-5.webp', 'batter-home-6.webp', 'batter-home-7.webp', 'batter-home-8.webp',
  'batter-away-1.webp', 'batter-away-2.webp', 'batter-away-3.webp', 'batter-away-4.webp',
  'batter-away-5.webp', 'batter-away-6.webp', 'batter-away-7.webp', 'batter-away-8.webp',
  'pitcher-set.webp', 'pitcher-windup.webp', 'pitcher-release.webp', 'ball-sheet.webp',
];
/** Kick off loading every plate-view image. Idempotent - call as early as convenient (ui.js calls
 *  it once at construction); a draw before this resolves just shows the flat-fill fallback for a
 *  frame or two, never throws. */
export function preloadPlateImages() {
  for (const name of PLATE_IMAGE_NAMES) _loadImg(name);
}
function plateImg(name) {
  if (!(name in _plateImages)) _loadImg(name);
  return _plateImages[name];
}

// ---------------------------------------------------------------------- anchors, measured once --
// Six points, measured directly off `baseball/img/plate.webp` (1200x2062) as fractions of that
// picture's own width/height - NOT of the canvas, which is a different aspect ratio at every phone
// height. `plateCover()` below is what turns a fraction into a screen pixel, so re-measuring only
// ever means editing this table, never touching any drawing code.
// BB-3b review fix: `plate.webp` was re-cropped (see the commit's own note) to include the stands
// and sky - the original crop (0,0)-(704,1210) of the source, before this fix, was tall/narrow
// enough (aspect 1.72) that `plateCover()`'s cover-fit cropped away nearly everything above the
// infield on any real device band (whose own aspect never exceeds about 1.07 tall, 0.56 short -
// see SPEC.md section 0's own root-rectangle table), leaving the sky and stands invisible in
// practice even though the source crop technically included them. Re-cropped to (0,100)-(704,1030)
// (aspect 1.32, closer to the band's own shape) - trims a modest sky sliver off the very top and
// the dead dirt below the batter's boxes off the bottom, keeping the floodlight tower, clouds and
// full stands intact. Every anchor below is re-measured on the NEW crop (a white/cream-pixel scan
// of the shipped plate.webp, not eyeballed) - this table cannot be edited without doing that again.
export const PLATE_ANCHORS = {
  plate: { x: 0.500, y: 0.879 },       // home plate's own center
  mound: { x: 0.500, y: 0.505 },       // the rubber
  release: { x: 0.550, y: 0.462 },     // where a pitcher's throwing hand sits, mound depth
  strikeZoneWidthFrac: 0.18,           // of the picture's own drawW - see the floor below
  // The box spans y=1250 (top/back edge) to y~1522 (bottom/front edge) in the 1200x1585 picture;
  // these sit about 78% of the way down (toward the front edge, where a batter's own feet would
  // actually plant), not at the box's vertical center an earlier measurement used.
  nearBoxLeft: { x: 0.250, y: 0.922 },
  nearBoxRight: { x: 0.750, y: 0.922 },
};
// Section 6 of the spec: "The strike zone has a floor of 0.30W wide so the pad's travel never
// becomes a slider of a few pixels." Applied at render time against the CANVAS width, not the
// picture's own fraction, so a narrow phone still gets a usable zone even though the picture's own
// anchor fraction is smaller than that.
const PLATE_ZONE_FLOOR = 0.30;
// Sizes as fractions of the field BAND height (not the picture), per the handoff's own measurement
// off the mock: the near batter fills about half the band, the mound pitcher about a ninth of it.
const NEAR_BATTER_HEIGHT_FRAC = 0.50;
const MOUND_PITCHER_HEIGHT_FRAC = 0.11;

/** `plate.webp` fitted to a `w`x`h` canvas the way CSS `background-size: cover; background-position:
 *  bottom center` would: scaled up to cover both dimensions (cropping whichever axis overflows),
 *  anchored at the bottom so the plate itself sits a fixed pixel distance from the band's own
 *  bottom edge at every phone height - see spec section 6, "so a cut between them moves nothing
 *  else on the screen." Returns null while the image is still loading. */
function plateCover(w, h) {
  const im = plateImg('plate.webp');
  if (!im) return null;
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  if (!iw || !ih) return null;
  const scale = Math.max(w / iw, h / ih);
  const drawW = iw * scale, drawH = ih * scale;
  return { drawW, drawH, offsetX: (w - drawW) / 2, offsetY: h - drawH, scale };
}
/** A `PLATE_ANCHORS`-shaped `{x,y}` fraction of the picture -> screen px, given a `plateCover()`
 *  transform. Every on-screen position in this camera goes through this one function. */
function anchorPx(frac, cover) {
  return { x: cover.offsetX + frac.x * cover.drawW, y: cover.offsetY + frac.y * cover.drawH };
}

// ---------------------------------------------------------------------- figures --
// BB-3b correction (Matt, after reviewing the bat-over-hands batter): "The bat-on-top-of-hands
// batter is out. Do not fix it; replace it." Two real 8-frame swing sequences
// (`batter-home-1..8.webp`, `batter-away-1..8.webp`, ported from `reference/baseball/batter-{home,
// away}-{1-8}.png`) replace the single static sprite plus a separately-rotated `bat.webp` layer.
// The bat is drawn IN THE HAND in every frame now - there is no bat layer, no bat rotation, no
// hand anchor to measure. `bat.webp`/`batter-home.webp`/`batter-away.webp` are unused everywhere.

// Every frame shares one canvas height (937px source, 800px shipped) and one scale, but the
// artist's own per-frame framing was NOT perfectly ground-locked - a flip-through (built as this
// repo's dev-only "Frames" check, `_openFrameCheck` in ui.js) showed the follow-through frames
// visibly rising off the ground line by as much as 37px at the shipped 800px scale. Measured once
// (lowest non-transparent pixel row per frame, at the shipped 800px height, against each set's own
// frame-1 baseline) and stored here as a FRACTION of the drawn height, so it scales with
// `NEAR_BATTER_HEIGHT_FRAC` automatically. Positive = shift the sprite down; negative = up.
// Re-measure (and re-verify with the Frames check) if these images are ever replaced.
const FRAME_Y_OFFSET_FRAC = {
  home: { 1: 0, 2: -0.01175, 3: -0.015, 4: -0.0075, 5: -0.021375, 6: -0.037375, 7: -0.045875, 8: -0.034125 },
  away: { 1: 0, 2: -0.0085, 3: 0.0405, 4: 0.01175, 5: -0.005375, 6: -0.013875, 7: 0.006375, 8: -0.00425 },
};

/** The near-box batter: one frame (1-8) of the real swing sequence for `side` ('home' or 'away').
 *  `flip` mirrors the whole sprite - BOTH frame sets are drawn RIGHT-handed (Matt's own
 *  correction, overriding this file's earlier "left-handed as drawn" note), so a LEFT-handed
 *  batter is the flip, not a right-handed one. Anchored at its own FEET
 *  (the frame's own measured ground line, via `FRAME_Y_OFFSET_FRAC`, not just the canvas edge), so
 *  `heightPx` alone fixes its scale and every frame's feet land on the same screen row. */
function drawBatterFigure(ctx, side, frame, anchor, heightPx, opts = {}) {
  const f = Math.max(1, Math.min(8, Math.round(frame || 1)));
  const batterImage = plateImg(`batter-${side}-${f}.webp`);
  if (!batterImage) return;
  const iw = batterImage.naturalWidth || batterImage.width, ih = batterImage.naturalHeight || batterImage.height;
  if (!iw || !ih) return;
  const scale = heightPx / ih;
  const dw = iw * scale, dh = ih * scale;
  const yOffset = (FRAME_Y_OFFSET_FRAC[side]?.[f] || 0) * heightPx;
  ctx.save();
  ctx.translate(anchor.x, anchor.y + yOffset);
  if (opts.flip) ctx.scale(-1, 1);
  ctx.drawImage(batterImage, -dw / 2, -dh, dw, dh);
  ctx.restore();
}

/** The mound pitcher, one of the three poses. `pose` is 'set' | 'windup' | 'release' (spec section
 *  9's CPU wind-up; ui.js drives it - for the CPU pitching to a human batter, a fixed lead-in
 *  timed off `FEEL.ui.windupMs`; for a human pitching, in step with the throw ring's own fill).
 *  Anchored at its own feet, same convention as the batter. */
function drawPitcherFigure(ctx, pose, anchor, heightPx) {
  const name = pose === 'windup' ? 'pitcher-windup.webp' : pose === 'release' ? 'pitcher-release.webp' : 'pitcher-set.webp';
  const im = plateImg(name);
  if (!im) return;
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  if (!iw || !ih) return;
  const scale = heightPx / ih;
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(im, anchor.x - dw / 2, anchor.y - dh, dw, dh);
}

/** The full plate-view scene: the picture, the strike zone, and both figures. `mode` is 'batting'
 *  or 'pitching' - selects which sprite plays the BATTER role (see the section header: the picture
 *  and the anchors never change, only which sprite stands where and the ring/button labels do).
 *  `dark` is accepted for call-site compatibility (every other camera-view field in this repo takes
 *  it) but unused - this picture has one identity, same as the overhead camera above.
 *  `opts`: `pitcherPose` ('set'|'windup'|'release'), `batterFrame` (1-8, the real swing sequence -
 *  see ui.js's swing timeline), `batterFlip` (bool, true for a LEFT-handed batter - see the
 *  section header's own note on the correction: both frame sets are drawn RIGHT-handed, so the
 *  DEFAULT is unflipped, standing at the third-base side box (`nearBoxLeft`, screen left from
 *  behind the plate); a left-handed batter is the flipped frame, standing at `nearBoxRight`). */
export function drawPlateView(ctx, w, h, mode, dark, opts = {}) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const cover = plateCover(w, h);
  if (!cover) {
    // Still loading - a flat fill so the band is never a blank/transparent hole for a frame.
    ctx.fillStyle = '#2f4a22';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return;
  }
  const plateImage = plateImg('plate.webp');
  ctx.drawImage(plateImage, cover.offsetX, cover.offsetY, cover.drawW, cover.drawH);

  const plateXY = anchorPx(PLATE_ANCHORS.plate, cover);
  const moundXY = anchorPx(PLATE_ANCHORS.mound, cover);
  // Both frame sets are drawn RIGHT-handed (see the correction note above): unflipped stands at
  // the LEFT box, flipped (a left-handed batter) at the RIGHT box - never one fixed box for both.
  const flip = !!opts.batterFlip;
  const nearXY = anchorPx(flip ? PLATE_ANCHORS.nearBoxRight : PLATE_ANCHORS.nearBoxLeft, cover);

  // Strike zone, above the plate - floored to 0.30 of the CANVAS width (spec section 6) so a
  // narrow phone never turns the pad's travel into a slider of a few pixels.
  const zoneW = Math.max(w * PLATE_ZONE_FLOOR, PLATE_ANCHORS.strikeZoneWidthFrac * cover.drawW);
  const zoneH = zoneW * 0.62;
  const zoneBottom = plateXY.y - zoneW * 0.12;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(plateXY.x - zoneW / 2, zoneBottom - zoneH, zoneW, zoneH);

  // Whichever team is BATTING stands at the near box; whichever team is PITCHING stands at the
  // mound - independent of whether the human is batting or pitching (see the section header).
  const batterSide = mode === 'pitching' ? 'away' : 'home';
  drawBatterFigure(ctx, batterSide, opts.batterFrame || 1, nearXY, h * NEAR_BATTER_HEIGHT_FRAC, { flip });
  drawPitcherFigure(ctx, opts.pitcherPose || 'set', moundXY, h * MOUND_PITCHER_HEIGHT_FRAC);

  ctx.restore();
}

// BB-3b commit 4 (handoff section 9, "Numbers to carry"): "Ball radius, plate view: 4 px at the
// hand to 14 px at the plate" - literal screen pixels, not a fraction of the canvas, matching the
// handoff's own number exactly rather than the earlier rounds' height-relative guess.
const PLATE_BALL_RADIUS_FAR_PX = 4;
const PLATE_BALL_RADIUS_NEAR_PX = 14;

/** The ball, through the plate camera. `yFt` is feet of travel from the plate (0) toward the
 *  mound/release point (60.5) - BOTH callers (`_animatePitchFlight` for batting,
 *  `HumanAgent.decidePitch`'s own flight loop for pitching) already count it that way, since this
 *  is one fixed camera in both modes (see the section header). `xFt` is a lateral offset from the
 *  plate's own centerline. Returns `{x, y, scale}` in screen px so a caller can build a trail from
 *  consecutive calls. */
export function drawPlateBall(ctx, w, h, xFt, yFt, mode, opts = {}) {
  const cover = plateCover(w, h);
  if (!cover) return { x: w / 2, y: h / 2, scale: 1 };
  const plateXY = anchorPx(PLATE_ANCHORS.plate, cover);
  const releaseXY = anchorPx(PLATE_ANCHORS.release, cover);
  const depthFrac = Math.max(0, Math.min(1, yFt / 60.5));
  const x = plateXY.x + (releaseXY.x - plateXY.x) * depthFrac + (xFt / 8.5) * (w * 0.12) * depthFrac;
  const y = plateXY.y + (releaseXY.y - plateXY.y) * depthFrac;
  const scale = 1 - depthFrac * 0.78;
  const r = opts.radiusPx != null ? opts.radiusPx
    : (PLATE_BALL_RADIUS_NEAR_PX - (PLATE_BALL_RADIUS_NEAR_PX - PLATE_BALL_RADIUS_FAR_PX) * depthFrac) * (opts.sizeMult || 1);

  ctx.save();
  ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
  const ballSheet = plateImg('ball-sheet.webp');
  if (ballSheet && (ballSheet.naturalWidth || ballSheet.width)) {
    const frames = 10;
    const frameIdx = Math.floor(((opts.spin || 0) % 1 + 1) % 1 * frames) % frames;
    const fw = (ballSheet.naturalWidth || ballSheet.width) / frames;
    const fh = ballSheet.naturalHeight || ballSheet.height;
    ctx.drawImage(ballSheet, frameIdx * fw, 0, fw, fh, x - r, y - r, r * 2, r * 2);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, 1.2 * scale);
    ctx.strokeStyle = '#1a1a1a';
    ctx.stroke();
  }
  ctx.restore();
  return { x, y, scale };
}

/** The dev-only "Frames" flip-through check (ui.js's `_openFrameCheck`, gated the same way the
 *  Tune panel is). Draws one frame of a swing sequence on a flat ground line so a foot-drift
 *  regression in a future art replacement is visible immediately, without reasoning about
 *  `FRAME_Y_OFFSET_FRAC` by eye. `useOffset` toggles the correction off so the raw, uncorrected
 *  drift can be compared against it directly - this is what proved the correction was needed
 *  (visible floating on frames 5-8 without it) before the swing timeline was wired at all.
 *  `flip` mirrors the frame and moves it to the OPPOSITE side of the ground line (left for
 *  unflipped, right for flipped - matching `drawPlateView`'s own nearBoxLeft/nearBoxRight choice)
 *  so the hand-flip/anchor correction can be checked here too, not just reasoned about. */
export function drawFrameCheck(ctx, w, h, side, frame, useOffset, flip) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, w, h);
  const groundY = h * 0.85;
  ctx.strokeStyle = '#e0532f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
  // A center tick, so left-of-center vs right-of-center is checkable without a ruler.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const heightPx = h * 0.7;
  const f = Math.max(1, Math.min(8, Math.round(frame || 1)));
  const anchorX = flip ? w * 0.75 : w * 0.25;
  if (useOffset) {
    drawBatterFigure(ctx, side, f, { x: anchorX, y: groundY }, heightPx, { flip: !!flip });
  } else {
    // Bypass FRAME_Y_OFFSET_FRAC entirely - draw the raw frame bottom-anchored at the ground line.
    const im = plateImg(`batter-${side}-${f}.webp`);
    if (im && (im.naturalWidth || im.width)) {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const scale = heightPx / ih;
      const dw = iw * scale, dh = ih * scale;
      ctx.save();
      ctx.translate(anchorX, groundY);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(im, -dw / 2, -dh, dw, dh);
      ctx.restore();
    }
  }
  ctx.restore();
}

export default {
  project, drawField, drawBall, drawLandingMarker, planGeometry,
  preloadPlateImages, PLATE_ANCHORS, drawPlateView, drawPlateBall, drawFrameCheck,
};
