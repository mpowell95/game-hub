/* Baseball mocks - the field band.
 *
 * GROUND TRUTH, PLAN VIEW (feet, before any camera is applied). Home plate at the
 * origin. +x is to the right (toward the first-base side), +y runs away from home
 * through second base toward center field. The two foul lines sit at exactly +/-45
 * degrees off the center axis, so fair territory is exactly 90 degrees, and the
 * diamond is a square standing on one corner (home-to-second is the diagonal, at
 * B * sqrt(2), never at B). All of this is computed here, in plan coordinates, and
 * ONLY THEN projected through the camera below - nothing is positioned by eye.
 *
 * u = unit vector along the first-base line (right foul line).
 * v = unit vector along the third-base line (left foul line).
 * u . v = 0 (they are exactly 90 degrees apart) and both are unit length, so a
 * point's (s, t) "basepath coordinates" (s = distance along u, t = distance along v)
 * turn the diamond into a plain axis-aligned square: home (0,0), first (B,0),
 * third (0,B), second (B,B). That is what stFor()/stToXY() below exploit - every
 * base and every basepath-aligned rectangle (the bases themselves) is authored in
 * (s, t) and converted back to real (x, y) by stToXY, so the 45-degree geometry
 * can never drift from a hand-placed pixel.
 */

const SQRT1_2 = Math.SQRT1_2; // cos(45deg) == sin(45deg)
const U = { x: SQRT1_2, y: SQRT1_2 };   // first-base line direction
const V = { x: -SQRT1_2, y: SQRT1_2 };  // third-base line direction

function stToXY(s, t) {
  return { x: s * U.x + t * V.x, y: s * U.y + t * V.y };
}
function polar(angleDeg, r) {
  // angleDeg measured from the center axis, positive toward the first-base side.
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

// League geometry (feet). B = basepath, P = pitching distance, fenceCenter from the
// shipped engine FIELD table (baseball/js/engine/settings.js), college league.
const LEAGUE = {
  basePathFt: 90,
  pitcherDistFt: 60.5,
  infieldDirtRadiusFt: 95,
  fenceCenterFt: 400, // FIELD.college.fenceFt.center
};

// Home plate, inches converted to feet: 17in front edge (perpendicular to the axis,
// facing the pitcher), two 8.5in sides running back, two 12in sides converging to a
// point away from the pitcher. Front-to-back depth is 8.5+8.5 = 17in, so the front
// edge sits 17in out from the rear point (the origin), which is also where the two
// foul lines meet.
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

function diamondPoints(B) {
  const home = { x: 0, y: 0 };
  const first = stToXY(B, 0);
  const third = stToXY(0, B);
  const second = stToXY(B, B);
  return { home, first, third, second };
}

// Bases: 18in (1.5ft) squares, edges parallel to u/v (the same 45-degree grid the
// basepaths run on - in (s,t) space every base is a plain axis-aligned square).
// First/third: outer edge on the foul line, so the CENTER sits half a base width
// in from the line. Second: centered exactly on its corner point. Only the center
// is needed - see BASE_PX in drawField for why the squares themselves are drawn
// at a fixed screen size rather than their true (sub-pixel) projected corners.
const BASE_FT = 1.5;

// Mound: 18ft-diameter circle centered 59ft out (rubber sits 18in = 1.5ft behind the
// circle's own center, i.e. rubber = mound center + 1.5, which is exactly P for a
// league where P = 60.5). Fixed size at every league (a "standard" figure), unlike
// the infield-skin arc and the home-plate circle below, which scale with B.
const MOUND_RADIUS = 9;
function moundCenterY(P) { return P - 1.5; }

// Infield grass: a square inset inside the base square, same center, same 45-degree
// rotation, side length B - 6 (a 3ft dirt margin on the infield side of each
// baseline). In (s,t) space the base square is [0,B]x[0,B], so the inset square is
// simply [3, B-3] on each axis - it can't drift off that 45-degree grid because it
// is never expressed in real x/y until stToXY converts it.
function infieldGrassSquare(B) {
  const lo = 3, hi = B - 3;
  return [[lo, lo], [hi, lo], [hi, hi], [lo, hi]].map(([s, t]) => stToXY(s, t));
}

// Home plate dirt circle: radius 13ft at the reference (B=90) league, scaled
// proportionally with B like the infield-skin arc. Drawn as a full circle
// (not clipped to fair territory) - it is what rounds off the point where the two
// foul lines meet, and real groundskeeping cuts it as a full circle too.
const HOME_CIRCLE_REF_R = 13;
function homeCircleRadius(B) { return HOME_CIRCLE_REF_R * (B / 90); }

// Infield dirt: an arc of radius 95ft centered on the MIDDLE of the pitcher's rubber
// (0, P), running from the first-base line to the third-base line - i.e. the two
// points where that circle crosses t=0 (the first-base line) and s=0 (the third-base
// line), joined by the arc that bulges AWAY from home (through the point directly
// opposite home's own bearing from the circle's center).
function infieldDirtArc(P, radius) {
  const C = { x: 0, y: P };
  // Solve for s along u (t=0) with |s*U - C| = radius: expand using U.x=U.y=k.
  const k = SQRT1_2;
  // (k s)^2 + (k s - P)^2 = radius^2  =>  s^2 - (2 P k) s + (P^2 - radius^2) = 0
  const b = -2 * P * k;
  const c = P * P - radius * radius;
  const disc = b * b - 4 * c;
  const s = (-b + Math.sqrt(disc)) / 2; // the far (positive) root
  const pFirst = stToXY(s, 0);
  const pThird = stToXY(0, s);
  const a1 = Math.atan2(pFirst.y - C.y, pFirst.x - C.x);
  const a2 = Math.atan2(pThird.y - C.y, pThird.x - C.x);
  // The "away from home" bearing from C is +90deg in atan2(dy,dx) terms (home sits
  // due -y of the rubber on the center axis, so away-from-home is +y, atan2(+,0)).
  // a1/a2 straddle it (first is left of it in x>0, third mirrors), so the minor arc
  // from a1 to a2 passing near +90deg is exactly the far, outfield-facing edge.
  return { center: C, radius, a1, a2, s };
}

// The infield SKIN itself: the region bounded by the two foul lines (home out to
// where each meets the arc) and the arc between them - a continuous dirt wedge,
// with the grass square and the mound circle cut/punched into it afterward. This
// is the shape a real "skinned infield" actually is: dirt everywhere between the
// lines out to the grass line, not just a thin strip under the basepaths.
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

// Base CENTER points (not corners) - first/third are inset half a base width in
// from the foul line they sit on; second is centered exactly on its corner point.
function baseCenters(B) {
  return {
    first: stToXY(B, BASE_FT / 2),
    third: stToXY(BASE_FT / 2, B),
    second: stToXY(B, B),
  };
}

// The four basepath LANES: dirt strips 6ft wide, centered on the straight line
// joining each pair of bases (3ft either side) - in (s,t) space every lane is a
// plain axis-aligned rectangle, same trick as the bases and the grass square.
// home-first and third-home sit ON the foul lines, so their outer 3ft falls in
// what would otherwise be foul territory (real infields cut it that way too);
// first-second and second-third sit on the diamond's other two edges, so their
// outer 3ft falls in what would otherwise be the outfield-facing skin - already
// dirt there, so it costs nothing to redraw.
function basepathLanes(B) {
  const rectST = (s0, s1, t0, t1) => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => stToXY(s, t));
  return {
    homeFirst: rectST(0, B, -3, 3),
    homeThird: rectST(-3, 3, 0, B),
    firstSecond: rectST(B - 3, B + 3, 0, B),
    secondThird: rectST(0, B, B - 3, B + 3),
  };
}

// Batter's boxes: 4ft wide x 6ft long, one each side, 6in (0.5ft) of dirt to the
// plate's own front-corner edge (x = PLATE_FRONT_W/2).
const BOX_W = 4, BOX_L = 6, BOX_GAP = 0.5;
function batterBoxes() {
  const nearX = PLATE_FRONT_W / 2 + BOX_GAP;
  const yMid = PLATE_SIDE; // roughly centered on the plate's own depth
  const mk = (x0) => [
    { x: x0, y: yMid - BOX_L / 2 }, { x: x0 + BOX_W, y: yMid - BOX_L / 2 },
    { x: x0 + BOX_W, y: yMid + BOX_L / 2 }, { x: x0, y: yMid + BOX_L / 2 },
  ];
  return { right: mk(nearX), left: mk(-nearX - BOX_W) };
}

/* ================================================================ CAMERA ==== *
 * Elevated, from behind and above home plate, tilted down toward the field - a
 * pinhole projection of the plan-view coordinates above, calibrated (not eyeballed)
 * to three framing targets: home plate near the bottom of the band, the pitcher's
 * mound about a third of the way up, and the center-field fence near the top
 * (Design Spec, "The field"). Solved once (see mocks/baseball/README-camera.md's
 * numbers, reproduced inline) against those three (y -> screen-fraction) pairs;
 * every point below - bases, plate, mound, dirt, out zones, ball - goes through
 * the SAME transform, so the 45-degree/1.41421 facts established above survive
 * into the picture rather than being redrawn by hand.
 */
const CAM_BACK = 105.75;   // ft behind home plate
const CAM_HEIGHT = 153.27; // ft up
const CAM_TILT = (35.92 * Math.PI) / 180; // down from horizontal
const CAM_FOCAL = 1.244;
const CT = Math.cos(CAM_TILT), ST = Math.sin(CAM_TILT);

function project(x, y) {
  const zCam = (y + CAM_BACK) * CT + CAM_HEIGHT * ST;
  const yCam = (y + CAM_BACK) * ST - CAM_HEIGHT * CT;
  const u = 0.5 + (CAM_FOCAL * x) / zCam;
  const v = 0.5 - (CAM_FOCAL * yCam) / zCam;
  return { u, v, zCam };
}

function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
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

function toScreen(pt, w, h) {
  const p = project(pt.x, pt.y);
  return { x: p.u * w, y: p.v * h };
}

// A "ground widget" (a small, roughly circular dirt feature - the home-plate
// circle, the mound) is smaller on screen than a naive per-point projection of
// its true edge would give: at 13ft, home plate's circle spans a large enough
// slice of the frame, this close to the camera, that its own near/far edges sit
// at meaningfully different depths and each gets projected at ITS OWN local
// scale - the near edge (closer to the camera than home itself) comes out
// bigger than the feet-to-pixels rate the rest of the field reads at. A single
// isotropic scale - measured the same way anything else in the picture would
// be measured, e.g. home-to-first's own screen length over its own 90ft - is
// what keeps a small feature reading at the same scale as its surroundings.
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

// Where a foul line should stop. The true fence intersection (radius fenceFt at
// +/-45deg) sits far outside the frame at this camera's calibrated field of view
// (it is not a rendering bug - a locked camera this close to home plate simply
// cannot frame the full 90 degrees of fair territory out to a real fence), so a
// foul line drawn to that true point exits through the SIDE of the canvas, well
// past where the fence arc itself has already left the frame through the TOP -
// which is the "runs past the fence, to the corners" defect. The fence arc IS
// the fence as far as this picture can show it, so a foul line stops wherever
// that arc's own drawn curve leaves the canvas, on the matching side.
function fenceExitPoint(fenceR, side, w, h) {
  const N = 400;
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const angle = side * 45 * (i / N);
    const pt = polar(angle, fenceR);
    const s = toScreen(pt, w, h);
    if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) {
      if (!prev) return s; // already off-frame at angle 0 - shouldn't happen here
      // linear interpolate between prev (in-frame) and s (out-of-frame) to the
      // exact edge crossed
      const target = s.x < 0 ? 0 : s.x > w ? w : (s.y < 0 ? 0 : h);
      const usesX = s.x < 0 || s.x > w;
      const t = usesX ? (target - prev.x) / (s.x - prev.x) : (target - prev.y) / (s.y - prev.y);
      return { x: prev.x + (s.x - prev.x) * t, y: prev.y + (s.y - prev.y) * t };
    }
    prev = s;
  }
  return prev; // never left the frame (a short enough fence) - the true endpoint
}
function pathFor(ctx, pts, w, h) {
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const s = toScreen(pt, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

// Seven out-zone wedges (4 infield, 3 outfield), authored as (angleDeg, rFt) rings
// off home plate, in real fair-territory geometry, then projected like everything
// else. Purely illustrative distances (the design doc leaves exact zone sizes open).
const INFIELD_SECTORS = [
  { a0: -42, a1: -22, r0: 28, r1: 62 },  // 3B
  { a0: -12, a1: 12, r0: 30, r1: 66 },   // SS/2B split, shown as one shallow zone
  { a0: 22, a1: 42, r0: 28, r1: 62 },    // 1B
  { a0: -8, a1: 8, r0: 70, r1: 82 },     // shallow 2B, behind the bag
];
const OUTFIELD_SECTORS = [
  { a0: -40, a1: -14, r0: 140, r1: 210 }, // LF
  { a0: -12, a1: 12, r0: 150, r1: 230 },  // CF
  { a0: 14, a1: 40, r0: 140, r1: 210 },   // RF
];

function drawSector(ctx, w, h, sector, pattern) {
  const N = 10;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(polar(sector.a0 + (sector.a1 - sector.a0) * (i / N), sector.r1));
  for (let i = N; i >= 0; i--) pts.push(polar(sector.a0 + (sector.a1 - sector.a0) * (i / N), sector.r0));
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

export function drawField(cv, opts) {
  const { ctx, w, h } = setupCanvas(cv);
  const B = LEAGUE.basePathFt, P = LEAGUE.pitcherDistFt;
  const { home, first, third, second } = diamondPoints(B);
  const baseC = baseCenters(B);
  const mCY = moundCenterY(P);
  const dirt = infieldDirtArc(P, LEAGUE.infieldDirtRadiusFt * (B / 90));
  const boxes = batterBoxes();
  const fenceR = LEAGUE.fenceCenterFt;
  const GRASS = '#3f6b34', DIRT = '#a9713f';

  ctx.clearRect(0, 0, w, h);
  // 1. base fill: grass everywhere (this alone covers the outfield - "everything
  // between the infield arc and the fence, inside the foul lines" - and the fair
  // infield GRASS square below, with no extra polygon needed for either).
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, w, h);

  // foul territory tint outside the +/-45deg wedge, out to the fence radius
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

  // 2. infield SKIN (dirt): the whole wedge bounded by the two foul lines and the
  // 95ft (scaled) arc off the rubber - a continuous dirt area, matching a real
  // skinned infield, not a thin strip under the basepaths.
  pathFor(ctx, infieldSkinPolygon(dirt), w, h);
  ctx.fillStyle = DIRT;
  ctx.fill();

  // 3. infield GRASS square cut into the skin - same 45-degree grid, side B-6.
  pathFor(ctx, infieldGrassSquare(B), w, h);
  ctx.fillStyle = GRASS;
  ctx.fill();

  // 4. the four basepath LANES, cut back through the grass square (and, for the
  // two lanes that ride the foul lines, through the foul-territory tint too).
  const lanes = basepathLanes(B);
  ctx.fillStyle = DIRT;
  for (const key of ['homeFirst', 'homeThird', 'firstSecond', 'secondThird']) {
    pathFor(ctx, lanes[key], w, h);
    ctx.fill();
  }

  // 5. home-plate and mound dirt circles. Drawn at a single ISOTROPIC feet-to-
  // pixels scale (see groundScale/drawGroundCircle above) rather than projecting
  // each boundary point through the full camera - a small feature sampled that
  // way inherits a blown-up size from sitting nearer the camera than the field
  // points it is being compared against. The scale is measured, not chosen: the
  // same home-to-first distance the plan-geometry check itself uses.
  const scale = groundScale(home, first, B, w, h);
  ctx.fillStyle = DIRT;
  drawGroundCircle(ctx, home, homeCircleRadius(B), scale, w, h);
  ctx.fill();
  drawGroundCircle(ctx, { x: 0, y: mCY }, MOUND_RADIUS, scale, w, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  drawGroundCircle(ctx, { x: 0, y: mCY }, MOUND_RADIUS, scale, w, h);
  ctx.stroke();

  // fence arc (illustrative: a circular arc around home at the center-field radius)
  const fencePts = [];
  for (let i = 0; i <= N; i++) fencePts.push(polar(-45 + 90 * (i / N), fenceR));
  ctx.beginPath();
  fencePts.forEach((pt, i) => {
    const s = toScreen(pt, w, h);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.strokeStyle = '#1a2a17';
  ctx.lineWidth = 6;
  ctx.stroke();

  // out zones
  const pattern = hatchPattern(ctx);
  for (const s of INFIELD_SECTORS) drawSector(ctx, w, h, s, pattern);
  for (const s of OUTFIELD_SECTORS) drawSector(ctx, w, h, s, pattern);

  // foul lines: home -> wherever the fence arc itself leaves the frame (its true
  // intersection with the fence is off-canvas at this camera - see
  // fenceExitPoint's own header).
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
  const zHome = toScreen(home, w, h);
  const zFar = toScreen({ x: 0, y: 3 }, w, h);
  const zoneHalfW = Math.abs(toScreen({ x: PLATE_FRONT_W / 2 + 0.3, y: 1 }, w, h).x - toScreen({ x: -(PLATE_FRONT_W / 2 + 0.3), y: 1 }, w, h).x) / 2;
  const zoneTop = toScreen({ x: 0, y: 4.2 }, w, h).y;
  const zoneBottom = toScreen({ x: 0, y: 1 }, w, h).y;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(zHome.x - zoneHalfW, zoneTop, zoneHalfW * 2, zoneBottom - zoneTop);

  // batter's boxes
  ctx.strokeStyle = 'rgba(230,230,230,0.7)';
  ctx.lineWidth = 1.5;
  pathFor(ctx, boxes.right, w, h); ctx.stroke();
  pathFor(ctx, boxes.left, w, h); ctx.stroke();

  // bases: 18in squares, white. True-to-scale corners project to well under a
  // pixel at this camera distance (golf's cup has the same problem, and is drawn
  // at a floored on-screen size for the same reason - CLAUDE.md's own "the cup is
  // now drawn ... imported ... so the hole you see and the hole that captures are
  // the same number" rule is about capture radius, not about a marker readable at
  // a glance, so a fixed screen size here is the right departure). The CENTER each
  // one is drawn at is still the exact plan-view point computed above.
  const BASE_PX = 8;
  ctx.fillStyle = '#f4f6fb';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  for (const key of ['first', 'third', 'second']) {
    const s = toScreen(baseC[key], w, h);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.PI / 4); // bases are drawn edge-on to the basepath grid
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

  const cbTeal = '#178A7A', cbBlue = '#1F5FA8';

  if (opts && opts.state === 'pitching') {
    const t = opts.pitchT != null ? opts.pitchT : 0.55;
    const yPos = mCY + (0 - mCY) * t; // mound -> home
    const s = toScreen({ x: 0, y: yPos }, w, h);
    const br = 2.5 + t * 4.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, br, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    const landing = { x: 40, y: 165 };
    const s = toScreen(landing, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText('1B', s.x, s.y - 10);
    ctx.fillText('1B', s.x, s.y - 10);
  }

  // runner on first: profile-color diamond marker, ink border
  if (opts && opts.runnerFirst) {
    const s = toScreen(baseC.first, w, h);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = cbTeal;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.strokeStyle = '#12181f';
    ctx.lineWidth = 2;
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
  }

  // batter's box in use
  const useBox = opts && opts.state === 'pitching' ? boxes.left : boxes.right;
  ctx.strokeStyle = opts && opts.state === 'pitching' ? cbBlue : cbTeal;
  ctx.lineWidth = 2;
  pathFor(ctx, useBox, w, h);
  ctx.stroke();

  return { home, first, second, third, project };
}

// Exported for the geometry self-check (measured in the plan view, before projection).
export function planGeometry(B) {
  const { home, first, second, third } = diamondPoints(B);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleOf = (p) => (Math.atan2(p.x, p.y) * 180) / Math.PI; // from center axis
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
