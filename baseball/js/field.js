// field.js - THE WORLD. R1, docs/BASEBALL-3D-BUILD.md section 9.
//
// Until v860 this file was two hand-fitted 2-D cameras over two painted pictures: a calibrated
// overhead projection for the cutaway and a measured homography over `plate.webp` for the pitch.
// Matt, with a recording of the reference game (docs/BASEBALL-REFERENCE-B9.md): "Ours should be as
// close to a clone of this game as possible." The first gap on that file's own list is the one
// that decides every other: "Theirs is a real 3D stadium with two cameras and a chase camera. Ours
// is two paintings. A painting cannot follow a ball."
//
// So this file now holds the real thing:
//   1. THE WORLD, in FEET. Home plate's rear point is the origin, +x runs toward first base, +y is
//      up, and -z runs toward the mound and centre field (three.js cameras look down -z, so the
//      pitcher is straight ahead of a camera standing behind the plate). The engine's batted-ball
//      (xFt, yFt) - its own plan view, +y toward centre - maps to world (xFt, 0, -yFt) through
//      `engineToWorld`, which is the ONE place that conversion happens.
//   2. THE STADIUM, generated in code: grass, the infield skin, the mound, the lines and bags, a
//      fence ribbon following the league's own five-point `fenceFt` shape, three tiers of stands
//      and a sky sphere. No image files at all - the grass and crowd textures are drawn on a 256px
//      canvas at runtime (see `grassTexture`/`crowdTexture`).
//   3. THE THREE CAMERAS the reference uses: behind the batter, behind the pitcher, and a chase
//      camera that follows a batted ball. `makeCameras` builds them; `CAMERAS` carries the numbers.
//   4. `projectToCanvas` + `zoneRectFt`, which are what the 2-D canvas still on top of the scene
//      uses to draw the strike-zone box and the landing-marker label in exactly the place the 3-D
//      scene puts them. Nothing else is drawn in 2-D any more.
//
// Deleted with the paintings (R1's own list): `plateBallPos`, `zoneRect`, `plateCover`, `anchorPx`,
// `PLATE_ANCHORS`, `drawPlateView`, `drawPlateBall`, `drawField`, `drawOverheadPicture`,
// `projectOverhead`, the homography constants, the 2-D `drawBall`/`drawLandingMarker`, and
// `preloadPlateImages`/`plateReady` (the first wind-up now waits on the scene's first rendered
// frame instead of on a picture decoding). `baseball/img/` is gone from the repo and from sw.js.
//
// The plan-view helpers below (stToXY/polar/diamondPoints/infieldSkinPolygon/...) are kept
// unchanged from the 2-D era: they were always pure plan geometry in feet, they are exactly what a
// ground mesh needs, and `planGeometry()` still exports the 45-degree/1.41421 facts so the diamond
// can be checked without rendering anything.

import * as THREE from './vendor/three.module.min.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { PARK_GEOMETRY } from './engine/settings.js';
import { fenceFtAt } from './engine/outcomes.js';

// ------------------------------------------------------------------ plan geometry (feet) ----
const SQRT1_2 = Math.SQRT1_2; // cos(45deg) == sin(45deg)
const U = { x: SQRT1_2, y: SQRT1_2 };   // first-base line direction
const V = { x: -SQRT1_2, y: SQRT1_2 };  // third-base line direction

function stToXY(s, t) {
  return { x: s * U.x + t * V.x, y: s * U.y + t * V.y };
}
/** Engine spray-angle convention: 0 deg is straight to centre, -45 the left-field line, +45 the
 *  right-field line (outcomes.js's own FOUL_LINE_DEG). Returns the engine's plan (x, y). */
function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

const B = PARK_GEOMETRY.basePathFt;       // 90
const P = PARK_GEOMETRY.pitcherDistFt;    // 60.5
const DIRT_RADIUS_REF = PARK_GEOMETRY.infieldDirtRadiusFt; // 95

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
  return { home: { x: 0, y: 0 }, first: stToXY(B, 0), third: stToXY(0, B), second: stToXY(B, B) };
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
  return { center: C, radius, a1: Math.atan2(pFirst.y - C.y, pFirst.x - C.x), a2: Math.atan2(pThird.y - C.y, pThird.x - C.x), s };
}
function infieldSkinPolygon(dirt) {
  const pts = [{ x: 0, y: 0 }, stToXY(dirt.s, 0)];
  const N = 24;
  for (let i = 1; i < N; i++) {
    const a = dirt.a1 + (dirt.a2 - dirt.a1) * (i / N);
    pts.push({ x: dirt.center.x + Math.cos(a) * dirt.radius, y: dirt.center.y + Math.sin(a) * dirt.radius });
  }
  pts.push(stToXY(0, dirt.s));
  return pts;
}
function baseCenters() {
  return { first: stToXY(B, BASE_FT / 2), third: stToXY(BASE_FT / 2, B), second: stToXY(B, B) };
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

/** The engine's plan (xFt, yFt) - +y toward centre field - as a world position in feet. The ONE
 *  place this conversion lives (R1, docs/BASEBALL-3D-BUILD.md section 9). */
export function engineToWorld(xFt, yFt, heightFt = 0) {
  return { x: xFt, y: heightFt, z: -yFt };
}

// ------------------------------------------------------------------ the world's fixed facts ----
// Every number below is in FEET and every one of them is a real baseball measurement except where
// the comment says otherwise. R1's own spec fixes them; they are exported because R2 (controls)
// and R3 (fielders and runners) both position off exactly these and must not re-derive them.
export const FIGURE_HEIGHT_FT = 6.0;      // every figure, R1 spec. The model's own units are measured at load.
export const BALL_RADIUS_FT = 0.36;       // ~5x a real baseball, on purpose: the reference draws the ball large
// The strike zone, as a vertical rectangle. 17 inches wide (a real plate), the engine's own
// x in [-1, 1] mapping to its two edges, 1.6 to 3.4 ft off the ground. `z` is where the ball is
// judged: 0.7 ft on the CATCHER's side of the plate's rear point, which is where a batter standing
// at BATTER_BOX.z actually meets it. That is the R1 spec's number and it is a gameplay choice, not
// a rulebook one: the ball has to cross where the swing is, or the zone box and the contact instant
// disagree on screen (the v843 defect this whole flight rule exists to prevent).
export const ZONE = { z: 0.7, halfW: 0.708, bottom: 1.6, top: 3.4 };
// The batter's feet. A right-handed batter stands at -x (the third-base side); a left-handed one
// mirrors. `z` is 0.4 ft toward the catcher from the plate's rear point, so his stance straddles
// the zone plane rather than standing behind it.
export const BATTER_BOX = { x: 2.6, z: 0.4 };
// How far across the box the batting pad moves him, each way. R1 replaces the old screen-space
// BATTER_AIM_TRAVEL_FRAC (0.06 of a picture's drawn width) with a real distance: 1.2 ft is about
// the width of a stance, so the full pad travel moves him from crowding the plate to off the
// outside corner and never puts a foot outside the painted box (BOX_W is 4 ft).
export const BATTER_AIM_TRAVEL_FT = 1.2;
export const RUBBER = { x: 0, y: 0.83, z: -P };   // mound crown 10 inches above the grass
export const MOUND = { radius: MOUND_RADIUS, height: RUBBER.y, z: -moundCenterY() };
// The catcher and the umpire. Section 9 puts them at z = 5.5 and z = 8; the catcher moved back a
// foot, to 6.5, for a measured reason: the batting camera's strike-zone box and his crouched head
// (top of head measured at 4.35 ft in the shipped Crouch pose) OVERLAPPED at 5.5, and the fix has
// to be his distance rather than the camera's height, because every camera height that separates
// them also pushes the batter's own shoes off the bottom of the band. At 6.5 the gap is 9 px and
// the batter still has his feet. Both distances are inside what a real catcher and umpire use.
export const CATCHER = { x: 0, z: 7.8 };
export const UMPIRE = { x: 0.8, z: 10.2 };
export const FENCE = { height: 8, railHeight: 0.6 };
// The landing marker's own disc: 14 inches of radius, the stage 8 colours kept exactly (green for
// a hit, gold for a home run, red for an out) so nothing a player already reads changed meaning.
export const MARKER = { radiusFt: 14 / 12, hit: 0x2e7d4f, hr: 0xffce3a, out: 0xc0392b };

// ------------------------------------------------------------------ R3: fielders and runners ----
// docs/BASEBALL-3D-BUILD.md section 9, "R3". The nine fielders' own spots, world feet (`y` is
// always 0 here - `place()` takes `heightFt` separately, the same convention `CATCHER`/`UMPIRE`
// already use). The four infielders and the pitcher/catcher never move; the three outfielders are
// further scaled by the league's own fence distance and rotated about home by the defense's
// current shift - `outfielderWorld` below does both, so a shifted fielder still stands the SAME
// distance from home this spec position puts him.
export const FIELDER_POS = {
  f1b: { x: 63, z: -63 }, f2b: { x: 30, z: -100 }, fss: { x: -30, z: -100 }, f3b: { x: -63, z: -63 },
  flf: { x: -150, z: -215 }, fcf: { x: 0, z: -265 }, frf: { x: 150, z: -215 },
};
const OUTFIELD_ROLES = ['flf', 'fcf', 'frf'];
export const OUTFIELD_FENCE_REF_FT = 405; // section 9's own scale reference (minors' own center fence)
// Every fielder stands facing the plate - the same 0 the pitcher's own facing already is (his own
// comment: "facingRad=0 already does that", a bind-pose sweep confirmed the model's own front is
// +z at facingRad 0, and every fielder stands at negative z, so facing the plate IS facing +z).
export const FIELDER_FACING_RAD = 0;

/** One fielder's real world spot, for this league's fence (`fenceFt`, the same shape `buildStadium`
 *  draws the wall from) and this at-bat's shift (`game.js`'s own `_shiftDegFor`, carried on the
 *  'atBatStart' event as `shiftDeg`). Infielders pass straight through unscaled and unrotated - only
 *  `OUTFIELD_ROLES` are touched at all. The rotation reuses the exact angle convention `polar()`
 *  above and `zones.js`'s own `shiftDeg` already share (the engine's plan angle: 0 = dead centre,
 *  negative = left field), converting the fielder's fixed world spot to that plan angle/radius,
 *  scaling the radius, rotating the angle, then converting back - so "rotate the outfielders' plan
 *  positions about home by the shift angle" (section 9's own words) is exactly what happens. */
export function fielderWorld(role, fenceFt, shiftDeg = 0) {
  const p = FIELDER_POS[role];
  if (!p) return null;
  if (!OUTFIELD_ROLES.includes(role)) return { x: p.x, y: 0, z: p.z };
  const scale = ((fenceFt && fenceFt.center) || OUTFIELD_FENCE_REF_FT) / OUTFIELD_FENCE_REF_FT;
  const planX = p.x, planY = -p.z;                 // world (x, z) -> the engine's own plan (x, y)
  const r = Math.hypot(planX, planY) * scale;
  const deg = (Math.atan2(planX, planY) * 180) / Math.PI + shiftDeg;
  const rotated = polar(deg, r);
  return { x: rotated.x, y: 0, z: -rotated.y };
}

/** Where a RUNNER stands or runs to, world feet - the same bag centers `buildStadium` draws the
 *  white squares at (`baseCenters()`), converted through `engineToWorld`; `home` is the batter's
 *  own home plate rear point, the origin. */
export function basePositions() {
  const b = baseCenters();
  return {
    home: { x: 0, y: 0, z: 0 },
    first: engineToWorld(b.first.x, b.first.y),
    second: engineToWorld(b.second.x, b.second.y),
    third: engineToWorld(b.third.x, b.third.y),
  };
}
/** The ordered waypoints a runner's own BASE INDEX maps into, world feet: index -1 (not on base
 *  yet - the batter's own start) is `home`, 0/1/2 are first/second/third, and 3 (one past third)
 *  is `home` again - scored. `runnerPath()[i + 1]` is base index `i`'s own waypoint for `i` from
 *  -1 to 3, so a runner's whole run is just a slice of this one array between his `from` and `to`
 *  indices (`ui.js`'s `_animateRunners`). */
export function runnerPath() {
  const b = basePositions();
  return [b.home, b.first, b.second, b.third, b.home];
}

/** The strike zone as a rectangle in world feet, in the plane `ZONE.z`. Shared by the overlay that
 *  strokes it and by the pitch flight that ENDS at its centre, so the two cannot disagree - the
 *  same single-source rule the old screen-space `zoneRect` held, now in the world. */
export function zoneRectFt() {
  return {
    z: ZONE.z, left: -ZONE.halfW, right: ZONE.halfW, bottom: ZONE.bottom, top: ZONE.top,
    cx: 0, cy: (ZONE.bottom + ZONE.top) / 2, w: ZONE.halfW * 2, h: ZONE.top - ZONE.bottom,
  };
}
/** The zone's four corners, world feet, clockwise from bottom-left. */
export function zoneCornersFt() {
  const z = zoneRectFt();
  return [
    { x: z.left, y: z.bottom, z: z.z }, { x: z.left, y: z.top, z: z.z },
    { x: z.right, y: z.top, z: z.z }, { x: z.right, y: z.bottom, z: z.z },
  ];
}

// ------------------------------------------------------------------ projection ----
const _pv = new THREE.Vector3();
/** A world point (feet) through a camera onto a `w` x `h` CSS-pixel canvas. `behind` is true when
 *  the point is behind the camera, where the projected x/y are meaningless and a caller must skip
 *  drawing rather than paint a mirrored ghost. This is the ONLY way anything is drawn in 2-D now
 *  (R1, docs/BASEBALL-3D-BUILD.md section 9: "the 2-D field canvas keeps only the strike-zone-box
 *  and cursor overlays, drawn by projecting world points through the active camera"). */
export function projectToCanvas(camera, v, w, h) {
  _pv.set(v.x, v.y, v.z);
  camera.updateMatrixWorld();
  const camZ = _pv.clone().applyMatrix4(camera.matrixWorldInverse).z;
  _pv.project(camera);
  return { x: (_pv.x * 0.5 + 0.5) * w, y: (-_pv.y * 0.5 + 0.5) * h, behind: camZ > -camera.near };
}

// ------------------------------------------------------------------ the three cameras ----
// Perspective, fov 50, aspect = the field canvas's own portrait aspect (R1 spec). The numbers were
// chosen by rendering and measuring, not by eye - `node test-baseball-device.mjs`'s own zone-world
// probe and the stills under R1's deliverable (a) are what they were checked against.
//
// batterCam: the batting view. Behind and above the plate, a touch to the first-base side, looking
//   out past the mound. Chosen by a numeric sweep (scratchpad) over camera x/y/z and the look
//   height against four targets, then looked at: a 6 ft batter fills 46% of the band's height, the
//   pitcher 9% with his feet just under the middle of the frame, the zone box 50 px wide sitting at
//   46% across and 80% down, and the crouched catcher's head stays BELOW the zone box instead of
//   covering it. NOTE, and it disagrees with section 9's own prose: a camera that puts the STRIKE
//   ZONE near the middle of the frame necessarily puts a right-handed batter LEFT of centre (24%),
//   because he stands at x = -2.6 and the zone is at x = 0; "right of centre" is only true of a
//   left-handed batter, who mirrors to +2.6 and lands at 68%. The zone is what a player aims at, so
//   the zone is what is centred.
//   THE UMPIRE IS NOT DRAWN FROM THIS CAMERA (see Actors._applyCameraVisibility). He stands at
//   z = 8 and this camera at z = 13.1, so he is 5 ft in front of the lens and would fill the whole
//   frame; at fov 50 there is no camera position that both frames the batter at ~46% and leaves him
//   small, since on-screen size is the ratio of distances and he is a quarter of the way to the
//   batter. The batting camera stands where the umpire's own head is, which is the honest reading:
//   a camera cannot film the inside of its own operator. He is fully drawn from the other two.
// pitcherCam: the pitching view. Behind and above the rubber on the third-base side, looking at the
//   zone. The pitcher fills 54% of the frame, left of centre (x 30%), with his back to the camera;
//   the zone is dead centre, the batter and catcher and umpire all in view behind it. Section 9
//   also asks for "catcher and batter about 30%", which cannot be true at the same time as "the
//   pitcher about 55%": on-screen sizes are in the ratio of distances and the two are 60 ft apart,
//   so 55/30 would need the camera 72 ft BEHIND the mound with an 8.7 degree lens. The pitcher's
//   size is the one that was kept; the batter measures 9%.
// chaseCam: the ball in play. Sits at a fixed offset from the ball and looks at it, easing toward
//   that offset by CHASE_LERP each rendered frame so the cut into the chase is a move, not a snap.
export const CAMERAS = {
  fov: 50,
  near: 0.5,
  far: 4000,
  batter: { pos: [0.6, 7.8, 13.1], look: [0, 2.3, -30] },
  pitcher: { pos: [-2.4, 6.4, -72.0], look: [0, 3.0, ZONE.z] },
  // The chase offset was measured against what it has to SHOW, not chosen: at section 9's own
  // (0, 12, 28) the ball is 30 ft from the lens and draws 5 px across, which is the same "you
  // can't see where the ball goes" stage 8 was written to fix. At (0, 10, 22) it is 24 ft out and
  // draws about 14 px, with the fence and the stands still in frame behind it.
  chase: { offset: [0, 10, 22] },
};
export const CHASE_LERP = 0.15;

/** The three cameras, already aimed. `setAspect(a)` re-applies the portrait aspect on every
 *  resize; the chase camera is positioned by `Actors` every frame and only needs its aspect here. */
export function makeCameras(aspect) {
  const mk = (def) => {
    const c = new THREE.PerspectiveCamera(CAMERAS.fov, aspect, CAMERAS.near, CAMERAS.far);
    if (def) { c.position.set(def.pos[0], def.pos[1], def.pos[2]); c.lookAt(def.look[0], def.look[1], def.look[2]); }
    return c;
  };
  const batter = mk(CAMERAS.batter);
  const pitcher = mk(CAMERAS.pitcher);
  const chase = mk(null);
  chase.position.set(CAMERAS.chase.offset[0], CAMERAS.chase.offset[1], CAMERAS.chase.offset[2]);
  chase.lookAt(0, 0, 0);
  const setAspect = (a) => {
    for (const c of [batter, pitcher, chase]) { c.aspect = a; c.updateProjectionMatrix(); }
  };
  setAspect(aspect);
  return { batter, pitcher, chase, setAspect };
}

// ------------------------------------------------------------------ procedural textures ----
// No image files (R1's hard rule). Both textures are drawn once on a 256 px canvas and repeated.
const PALETTE = {
  grassA: '#3f8f3a', grassB: '#4aa244', dirt: '#b8743f', dirtDark: '#a5652f',
  line: '#f2f4f8', fence: '#1f4d5e', rail: '#e8c34a',
  standsFace: '#2b3038', standsDeck: '#22262c',
  skyZenith: '#7fb7e6', skyHorizon: '#d9ecf8',
};
/** Two greens in 12 ft mowing stripes. The stripes run parallel to the bisector of the foul lines
 *  (straight out to centre field), so the texture repeats across x and is constant along z. */
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = PALETTE.grassA; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = PALETTE.grassB; ctx.fillRect(0, 0, 128, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** A crowd: random dots in six colours on dark grey. Deliberately not a people-shaped sprite -
 *  at the distance a stand is ever seen here (200 ft and up) a crowd IS a field of coloured dots,
 *  and anything more detailed is pixels nobody can resolve. */
function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = PALETTE.standsFace; ctx.fillRect(0, 0, 256, 256);
  const dots = ['#d8d3c8', '#8fa4bd', '#c47a6a', '#6f7b8a', '#e3c59a', '#4d5866'];
  // A fixed, repeatable scatter (not Math.random): the same texture every load means a screenshot
  // taken today and one taken next week differ only where the game differs.
  let seed = 20260920;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = dots[Math.floor(rnd() * dots.length)];
    ctx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** The sky: a vertical gradient, light at the horizon to blue at the zenith, painted down a 2x256
 *  canvas and mapped onto the inside of one sphere. No clouds (R1 spec). */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, PALETTE.skyZenith);
  g.addColorStop(0.55, PALETTE.skyHorizon);
  g.addColorStop(1, PALETTE.skyHorizon);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ geometry builders ----
/** A flat plan-view polygon (engine (x, y) feet) as a ground mesh geometry at height `y` feet.
 *  `holes` are plan polygons cut out of it - the infield grass inside the base paths is one. */
function groundShape(poly, y, holes = []) {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  const g = new THREE.ShapeGeometry(shape);
  // A ShapeGeometry is built in its own XY plane, facing +z. rotateX(-90 degrees) lays it flat AND
  // sends the engine's +y (toward centre field) to world -z in the same step, with its normal
  // ending up pointing straight up. The sign matters and was got wrong once: rotateX(+90) puts the
  // whole infield BEHIND home plate, which renders as a field with no dirt anywhere near the
  // batter and a mound sitting on bare grass.
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
/** A vertical ribbon: one quad per sample step, following `pts` (world x/z) from `y0` to `y1`. */
function ribbonGeometry(pts, y0, y1, uRepeat = 1) {
  const n = pts.length;
  const pos = new Float32Array((n - 1) * 6 * 3);
  const uv = new Float32Array((n - 1) * 6 * 2);
  const nrm = new Float32Array((n - 1) * 6 * 3);
  let pi = 0, ui = 0, ni = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const u0 = (i / (n - 1)) * uRepeat, u1 = ((i + 1) / (n - 1)) * uRepeat;
    const quad = [[a, y0, u0, 0], [b, y0, u1, 0], [b, y1, u1, 1], [a, y0, u0, 0], [b, y1, u1, 1], [a, y1, u0, 1]];
    for (const [p, y, u, v] of quad) {
      pos[pi++] = p.x; pos[pi++] = y; pos[pi++] = p.z;
      uv[ui++] = u; uv[ui++] = v;
      // Faces point back toward home plate (the only place any camera ever stands).
      const len = Math.hypot(p.x, p.z) || 1;
      nrm[ni++] = -p.x / len; nrm[ni++] = 0; nrm[ni++] = -p.z / len;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
/** A horizontal ribbon (a deck): `inner` to `outer` at height `y`, same sampling as the faces. */
function deckGeometry(inner, outer, y) {
  const n = inner.length;
  const pos = new Float32Array((n - 1) * 6 * 3);
  const nrm = new Float32Array((n - 1) * 6 * 3);
  const uv = new Float32Array((n - 1) * 6 * 2);
  let pi = 0, ni = 0, ui = 0;
  for (let i = 0; i < n - 1; i++) {
    const quad = [inner[i], outer[i], outer[i + 1], inner[i], outer[i + 1], inner[i + 1]];
    for (const p of quad) {
      pos[pi++] = p.x; pos[pi++] = y; pos[pi++] = p.z;
      nrm[ni++] = 0; nrm[ni++] = 1; nrm[ni++] = 0;
      uv[ui++] = 0; uv[ui++] = 0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** The fence line, world feet, sampled every `stepDeg` from the left-field line to the right-field
 *  line straight off the engine's own `fenceFtAt` - so the wall a home run clears and the wall the
 *  engine scored it against are the same curve by construction, not by a copied table. */
export function fencePoints(fenceFt, stepDeg = 2) {
  // Sampled SEGMENT BY SEGMENT, so the five named angles (-45, -22.5, 0, +22.5, +45) are always
  // sample points. `fenceFtAt` interpolates linearly in ANGLE between them, so the named distance
  // exists at exactly one angle and nowhere else: a naive even sweep from -45 in 2 degree steps
  // never lands on 0, and the wall it built came out 1.6 ft short of `fenceFt.center` at Minors -
  // a sampling error that the fence-shape probe correctly refused to accept as geometry.
  const perSeg = Math.max(1, Math.round(22.5 / stepDeg));
  const pts = [];
  for (let seg = 0; seg < 4; seg++) {
    const a0 = -45 + seg * 22.5;
    for (let i = 0; i < perSeg; i++) {
      const deg = a0 + (22.5 * i) / perSeg;
      const p = polar(deg, fenceFtAt(deg, fenceFt));
      pts.push({ x: p.x, z: -p.y });
    }
  }
  const last = polar(45, fenceFtAt(45, fenceFt));
  pts.push({ x: last.x, z: -last.y });
  return pts;
}
/** Where the STANDS sit, world feet: the fence's own distance plus a walkway out to the poles, then
 *  drawn in past each pole so the bowl wraps 30 degrees behind them (R1 spec) instead of ending in
 *  mid-air. The 0.45 at the far edge is a shape choice: it is what makes the bowl read as closing
 *  around the plate rather than as two straight walls. */
function standsPoints(fenceFt, extraFt, stepDeg = 2.5) {
  const pts = [];
  for (let deg = -75; deg <= 75 + 1e-9; deg += stepDeg) {
    const inside = Math.min(45, Math.abs(deg));
    let ft = fenceFtAt(Math.sign(deg) * inside, fenceFt) + extraFt;
    if (Math.abs(deg) > 45) {
      const u = (Math.abs(deg) - 45) / 30;
      ft *= 1 - 0.55 * u;
    }
    const p = polar(deg, ft);
    pts.push({ x: p.x, z: -p.y });
  }
  return pts;
}

/** Build the whole stadium into `scene` for one league. Returns a handle with `dispose()` (every
 *  geometry, material and texture this made), `group`, and `fencePts` so a test can sample the wall
 *  that actually shipped rather than recompute it.
 *
 *  Draw calls are the budget that matters on a phone, so anything sharing a material is merged into
 *  ONE mesh (all the white lines and bags together; the three stand faces together; the three decks
 *  together). Measured: 16 draw calls for the stadium.
 *
 *  Note on leagues: only the FENCE varies. `FIELD[league].fieldScale` scales the named-park
 *  distances inside the engine (settings.js's own comment), never the diamond - the base paths and
 *  the rubber are regulation at every league there, so they are regulation here too. */
export function buildStadium(scene, { fenceFt }) {
  const group = new THREE.Group();
  const geos = [];
  const mats = [];
  const texs = [];
  const track = (g, m) => { if (g) geos.push(g); if (m) mats.push(m); };

  // --- sky: one sphere, inside out, 32x16 (1024 triangles, R1's own budget line).
  const skyTex = skyTexture(); texs.push(skyTex);
  const skyGeo = new THREE.SphereGeometry(1800, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  // Drawn LAST among the opaques, not first. It is a full-screen sphere, so drawing it first shades
  // every pixel of the canvas and then has the whole stadium painted over the top - pure overdraw,
  // and on a software rasteriser overdraw is the entire bill. Drawn last, with depth testing on and
  // depth writing off, the depth buffer is already full and the sky only shades where sky shows.
  sky.renderOrder = 1000;
  group.add(sky); track(skyGeo, skyMat);

  // --- grass: one 900x900 plane with the mowing stripes repeated every 12 ft.
  const grassTex = grassTexture(); texs.push(grassTex);
  grassTex.repeat.set(900 / 24, 900 / 24);   // one full texture = two 12 ft stripes
  const grassGeo = new THREE.PlaneGeometry(900, 900);
  grassGeo.rotateX(-Math.PI / 2);
  grassGeo.translate(0, 0, -200);            // centred on the outfield, not on the plate
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
  group.add(new THREE.Mesh(grassGeo, grassMat)); track(grassGeo, grassMat);

  // --- dirt: the infield skin (base paths plus the arc), the home circle, and the mound cone.
  const dirtMat = new THREE.MeshLambertMaterial({ color: PALETTE.dirt });
  mats.push(dirtMat);
  const dirt = infieldDirtArc(DIRT_RADIUS_REF * (B / 90));
  const skinGeo = groundShape(infieldSkinPolygon(dirt), 0.02, [infieldGrassSquare()]);
  const homeCircle = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    homeCircle.push({ x: Math.cos(a) * homeCircleRadius(), y: Math.sin(a) * homeCircleRadius() });
  }
  const homeGeo = groundShape(homeCircle, 0.025);
  const moundGeo = new THREE.CylinderGeometry(MOUND.radius * 0.55, MOUND.radius, MOUND.height, 24, 1);
  moundGeo.translate(0, MOUND.height / 2, MOUND.z);
  const dirtGeo = mergeGeometries([skinGeo, homeGeo, moundGeo], false);
  group.add(new THREE.Mesh(dirtGeo, dirtMat));
  track(dirtGeo, null); skinGeo.dispose(); homeGeo.dispose(); moundGeo.dispose();

  // --- white geometry, 0.02 ft above whatever it sits on: the two foul lines, the plate, the three
  // bags, the rubber, the batter's boxes. All one material, so all one mesh.
  const lineMat = new THREE.MeshLambertMaterial({ color: PALETTE.line });
  mats.push(lineMat);
  const whiteParts = [];
  const foulLine = (sign) => {
    const w = 0.35, len = 340;
    const d = polar(sign * 45, 1);
    const n = { x: d.y, y: -d.x };   // perpendicular, in the engine's plan
    const quad = [
      { x: n.x * w / 2, y: n.y * w / 2 },
      { x: d.x * len + n.x * w / 2, y: d.y * len + n.y * w / 2 },
      { x: d.x * len - n.x * w / 2, y: d.y * len - n.y * w / 2 },
      { x: -n.x * w / 2, y: -n.y * w / 2 },
    ];
    return groundShape(quad, 0.04);
  };
  whiteParts.push(foulLine(1), foulLine(-1));
  whiteParts.push(groundShape(platePolygon(), 0.05));
  const bags = baseCenters();
  for (const b of [bags.first, bags.second, bags.third]) {
    const half = BASE_FT / 2;
    whiteParts.push(groundShape([
      { x: b.x - half, y: b.y - half }, { x: b.x + half, y: b.y - half },
      { x: b.x + half, y: b.y + half }, { x: b.x - half, y: b.y + half },
    ], 0.06));
  }
  whiteParts.push(groundShape([
    { x: -1, y: moundCenterY() + 1.4 }, { x: 1, y: moundCenterY() + 1.4 },
    { x: 1, y: moundCenterY() + 1.9 }, { x: -1, y: moundCenterY() + 1.9 },
  ], MOUND.height + 0.02));
  const boxes = batterBoxes();
  const boxOutline = (poly) => {
    const parts = [];
    const t = 0.25;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * t / 2, ny = dx / len * t / 2;
      parts.push(groundShape([
        { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
      ], 0.03));
    }
    return parts;
  };
  whiteParts.push(...boxOutline(boxes.right), ...boxOutline(boxes.left));
  const whiteGeo = mergeGeometries(whiteParts, false);
  group.add(new THREE.Mesh(whiteGeo, lineMat));
  track(whiteGeo, null);
  for (const g of whiteParts) g.dispose();

  // --- the fence: ONE ribbon following the league's own shape, with a rail along the top.
  const fencePts = fencePoints(fenceFt, 2);
  const wallGeo = ribbonGeometry(fencePts, 0, FENCE.height);
  const wallMat = new THREE.MeshLambertMaterial({ color: PALETTE.fence, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(wallGeo, wallMat)); track(wallGeo, wallMat);
  const railGeo = ribbonGeometry(fencePts, FENCE.height, FENCE.height + FENCE.railHeight);
  const railMat = new THREE.MeshLambertMaterial({ color: PALETTE.rail, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(railGeo, railMat)); track(railGeo, railMat);

  // --- the stands: three stepped tiers, each 12 ft deep, rising to 40 ft. Flat boxes, as budgeted:
  // one vertical face and one horizontal deck per tier, all faces merged and all decks merged.
  const crowdTex = crowdTexture(); texs.push(crowdTex);
  crowdTex.repeat.set(60, 1.4);
  const faceParts = [], deckParts = [];
  const tierBase = [FENCE.height, 16, 28];
  const tierTop = [16, 28, 40];
  for (let k = 0; k < 3; k++) {
    const inner = standsPoints(fenceFt, 14 + k * 12);
    const outer = standsPoints(fenceFt, 14 + (k + 1) * 12);
    faceParts.push(ribbonGeometry(inner, tierBase[k], tierTop[k], 1));
    deckParts.push(deckGeometry(inner, outer, tierTop[k]));
  }
  const faceGeo = mergeGeometries(faceParts, false);
  const faceMat = new THREE.MeshLambertMaterial({ map: crowdTex, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(faceGeo, faceMat)); track(faceGeo, faceMat);
  const deckGeo = mergeGeometries(deckParts, false);
  const deckMat = new THREE.MeshLambertMaterial({ color: PALETTE.standsDeck, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(deckGeo, deckMat)); track(deckGeo, deckMat);
  for (const g of [...faceParts, ...deckParts]) g.dispose();

  scene.add(group);
  return {
    group,
    fencePts,
    dispose() {
      scene.remove(group);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

// Exported for the geometry self-check (measured in the plan view, before any projection) - the
// 45-degree/1.41421 facts about the diamond, unchanged from the 2-D era.
export function planGeometry() {
  const { home, first, second, third } = diamondPoints();
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleOf = (pnt) => (Math.atan2(pnt.x, pnt.y) * 180) / Math.PI;
  return {
    home, first, second, third,
    homeToFirst: dist(home, first), homeToSecond: dist(home, second),
    ratio: dist(home, second) / dist(home, first),
    firstLineAngle: angleOf(first), thirdLineAngle: angleOf(third),
    foulAngleSpread: angleOf(first) - angleOf(third),
  };
}

export default {
  engineToWorld, zoneRectFt, zoneCornersFt, projectToCanvas, makeCameras, buildStadium,
  fencePoints, planGeometry, CAMERAS, ZONE, BATTER_BOX, RUBBER, MOUND, CATCHER, UMPIRE, FENCE,
  MARKER, FIGURE_HEIGHT_FT, BALL_RADIUS_FT, BATTER_AIM_TRAVEL_FT, CHASE_LERP,
  FIELDER_POS, FIELDER_FACING_RAD, OUTFIELD_FENCE_REF_FT, fielderWorld, basePositions, runnerPath,
};
