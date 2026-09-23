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
// R7 (docs/BASEBALL-3D-BUILD.md section 9, "R7"): a pixel-size floor for the ball on the PITCHER
// camera only. Measured (node, `zoneRectFt`/`projectToCanvas` against `CAMERAS.pitcher`, the real
// pitch path): the true sphere draws ~13 px at release (the camera sits close to the rubber) but
// shrinks to ~2.3 px at the crossing, 72 ft away - the exact defect Matt's recording showed ("no
// frame... shows it"). Floored to 8 px: comfortably legible on a 393 px phone, still well under
// what the same ball draws on the BATTER camera at its own crossing (~12.8 px, measured the same
// way) so the pitcher camera's ball never reads as bigger than the batter's own close-up view.
export const BALL_MIN_PX = 8;
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
// pitcherCam: the pitching view. R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 2): Matt's
//   recording measured the true zone box at 9 px wide - `PITCHING_ZONE_MIN_W_FRAC` in ui.js used
//   to paper over it by drawing the box 4x its true size over TRUE-size figures, "a huge box over
//   tiny men". A long lens fixes the actual complaint (box legible without lying about scale):
//   pulled back to 55.6 ft behind the rubber (was 11.5) and narrowed to fov 10.35 (was 50), on the
//   SAME mound-to-plate line, a touch higher (y 7.0, was 6.4). Measured (node, this file's own
//   `projectToCanvas` against the real field band AFTER R8 removes the 48px HUD row - 393x477,
//   not the old 393x429): pitcher 59.5% of the band's height (own head-to-shoe span), the TRUE
//   (unscaled) zone box 8.5% of the band's height and 31.9 px wide, the batter 47.8% of the
//   PITCHER's height and the catcher 44.9%. `PITCHING_ZONE_MIN_W_FRAC`'s floor is deleted with
//   this - the box is now drawn at this true scale, never stretched. The three numbers the spec
//   named (pitcher ~50%, batter/catcher ~30-50% of him, box 8-13% of the band) cannot all be hit
//   at once: box height is a FIXED 0.3 of batter height in the world (1.8 ft / 6 ft), so
//   `boxFrac = 0.3 x (batter/pitcher ratio) x pitcherFrac` is an identity, and box>=8% at
//   ratio<=50% forces pitcherFrac>=53%; 59.5% was chosen to keep both the box (>=8%, here 8.5%)
//   and the ratio (<=50%, here 47.8%) inside their own probed ranges with real margin, not sitting
//   on either edge. `_zoneMap('pitching')` in ui.js now returns `k=1` unconditionally - see its
//   own header.
//   THE PITCHER IS NOT DRAWN FROM THE BATTER CAMERA and vice versa is untouched by this - only the
//   pitcher camera's own numbers changed; `CAMERAS.batter` and its own fov are exactly R1's.
//   R13 (docs/BASEBALL-3D-BUILD.md section 9, "R13", item 1): Matt, on v882: "Can you change the
//   angle a little bit so it's a little easier to see the strike zone you're throwing into?" The
//   R8 framing above put the box at 8.5% of the band with the pitcher filling 59.5% - legible in
//   the sense that it was drawn true-scale, but still small next to a pitcher who dominates the
//   frame. Measured (node, this file's own `projectToCanvas`, the same method R8 used): at R8's
//   own DISTANCE (55.6 ft back), holding the pitcher at 50% of the band by solving `fov` for it,
//   the box tops out at 7.16% - moving the camera BACK (not just up) is the only lever that grows
//   the box relative to the pitcher, because the two are nearly a fixed-ratio "dolly zoom": as the
//   camera retreats and the lens narrows to compensate, near (pitcher) and far (batter/zone,
//   nearly 76 ft further along the same line) converge toward their true WORLD size ratio
//   (6 ft / 1.8 ft = 3.33, i.e. boxFrac -> pitcherFrac / 3.33 as distance -> infinity) instead of
//   the R8 distance's own, more extreme 0.143 ratio. Solved (bisection on `fov` at several
//   distances, holding pitcherFrac at 0.50): 180 ft back gives a box of 11.2%, well inside the
//   spec's own 10-13% - but R13 ALSO has to hold at Little League, whose own fence sits at just
//   210 ft dead centre (`FIELD.little.fenceFt.center`), and a camera any further back than that
//   sits AT OR PAST the outfield wall (and the grass berm just past it - item 2, below), rendering
//   as the camera clipping through that geometry. First tried at 150 ft back (210.5 ft total from
//   home) - visibly broken (`scratchpad/r13/little-pitcher-BROKEN-150ft.png`): the lens sits
//   almost exactly on Little League's own fence line, and the frame fills with the inside of the
//   berm/fence mesh instead of the pitcher. Re-solved with that ceiling respected: 130 ft back
//   (190.5 ft total) clears Little League's fence by 19.5 ft (real margin, not a hairline) while
//   still landing the box at 10.2% - inside the band, closer to its floor than 180 ft's own 11.2%
//   would have been, which is the real trade this stage made (legible box vs. a camera that has to
//   physically fit inside the SMALLEST league's own outfield). `CAMERAS.pitcher` moved to
//   `pos: [-2.4, 8.26, -190.5]` (was `[-2.4, 7.0, -116.0]`), `look: [0, 2.53, ZONE.z]` (was
//   `[0, 3.0, ZONE.z]`), `fov: 5.28` (was 10.35) - a longer lens still, on the same mound-to-plate
//   line. Measured after: pitcher 50.0% of the band (down from 59.5%, "the pitcher may drop to
//   about half"), the true box 10.2% tall / 9.7% wide (38.3 x 48.7px, up from 8.5%/8.1%), and the
//   pitcher's own head projects to y=140.4px against the box's own top at y=215.0px - 74.6px of
//   clear grass between them, so the head sits ABOVE the box with real margin, never over it. Side
//   effect, measured and accepted: `batterRatio` (batter/pitcher) rose to 68.1% (was 47.8%, R8's
//   own 30-50% band) - the SAME dolly-zoom compression that grows the box also brings the batter
//   closer to the pitcher's own size, since both are now a smaller fraction of the much longer
//   total camera distance; `pitcher-frame`'s own batter-ratio check raised its ceiling to 80% to
//   match (see the probe, test-baseball-device.mjs). The ball is INCIDENTALLY easier to see too,
//   not worse: `BALL_MIN_PX`'s own floor (8px) is barely needed any more - measured 14.1px at
//   release and 9.7px at the crossing (was ~13px/~2.3px true, with the floor doing the work at
//   the crossing before). Every other camera and every other constant in this file is untouched by
//   this - only `CAMERAS.pitcher`'s own five numbers moved.
//   R13 SHIP-REVIEW FIX (same day): the coordinator, on the stills above - the zone box sat over
//   the pitcher's own legs, the control cursor landing on his thighs, because `pos.x` was still
//   -2.4 (on the mound-to-plate line) and at this lens a small `x` barely moves a target 190ft
//   away. Measured (node, this file's own `projectToCanvas`): at x=-2.4 the box's own left edge
//   sits only 11.4px from the pitcher's nearest silhouette point (a 238px-tall figure - the box is
//   effectively touching him); moving the camera SIDEWAYS (never changing `look`, still the plate)
//   swings the pitcher's own screen position hard while the box barely moves (it is anchored to
//   the plate, 130ft further from the lens), because at this narrow a fov screen position is far
//   more sensitive to a lateral camera shift than to the shift's effect on a distant, fixed-look
//   target. `pos.x` moved to -9.5 (the spec's own 9-12ft band): the box stays over the catcher
//   (catcher's own x projects 9.2px from the box's own centre, both before and after - the catcher
//   sits close to the SAME depth the box does, so a lateral camera shift barely separates them),
//   while the pitcher's own silhouette moves 96.9px, opening a 101.3px gap between his nearest
//   point and the box's own left edge - 1.7x his own measured on-screen width (59.5px, estimated
//   at 0.25 of his on-screen height, a person's own rough shoulder/hip fraction), comfortably past
//   the spec's own "at least half a pitcher's width." Every other number this stage measured moved
//   by under 0.2 percentage points (box 10.20% was 10.20%, pitcher 49.9% was 50.0%, batter ratio
//   68.3% was 68.1%) - negligible, so `pitcher-frame`'s own bands did not need re-tuning.
//   `pop-anchor`/`ball-visible-pitcher`/`chase-start` read the batter/chase cameras or a fixed
//   world point and do not depend on `CAMERAS.pitcher.pos.x` at all; verified green, unchanged.
// chaseCam: the ball in play. Sits at a fixed offset from the ball and looks at it, easing toward
//   that offset by CHASE_LERP each rendered frame so the cut into the chase is a move, not a snap.
export const CAMERAS = {
  fov: 50, // batter and chase share this; pitcher carries its own fov (below), a long lens.
  near: 0.5,
  far: 4000,
  // R12 (docs/BASEBALL-3D-BUILD.md, "R12", item 2): Matt, on v871: "I can't see the batter's feet."
  // Measured (node, `projectToCanvas` against this same camera): the true reason was margin, not a
  // gross miss - the shoe sole (world y=0) projected to 98.5% of the BATTING band's own height
  // (544.8 of 553px), a hair inside the frame but with only ~1.5% (8px) of clearance, so a real
  // device's own rounding, a taller phone's chrome, or a slightly different stance frame put it out
  // more often than not. Re-aimed by LOOK ALONE (the spec's own preferred lever): `look.y` moved
  // from 2.3 to -1.0, nothing else. Since vertical FOV (not `look`) sets how much of the world's own
  // vertical extent a camera shows, this fraction holds at every phone height and in both hosts, not
  // just the one measured. Measured after: feet 89.2% down (493.2 of 553px, 10.8%/60px of margin),
  // cap 41.0% down (226.8px) - the batter's own on-screen HEIGHT barely moved (48.0% of the band,
  // was 49.5%), so this reads as the same shot shifted up, not a re-zoom. The true zone box shifted
  // up with it (was 405.1-484.1px, now 359.6-435.7px) and moved a hair in size too (64.4x76.2px, was
  // 65.2x79.0) - the live `zone-scale` probe (device suite) still passes with real margin against
  // its own 3px drift budget (0.8/2.8px), so no probe baseline needed changing. The mound/pitcher
  // (background figures only on this camera, not tested by any probe - `pitcher-frame` reads
  // `CAMERAS.pitcher`, untouched here) moved up too, matching the reference's own composition
  // (`scratchpad/ref/reference-key-frames.jpg` row 2: plenty of grass/mound above a batter whose own
  // feet and box lines are fully in frame). Re-verified in the real, mounted game (not just this
  // node projection) at 393x852: `scratchpad/r12/after-cam-wrap.png` against
  // `scratchpad/r12/before-batting-wrap.png`.
  batter: { pos: [0.6, 7.8, 13.1], look: [0, -1.0, -30] },
  pitcher: { pos: [-9.5, 8.26, -190.5], look: [0, 2.53, ZONE.z], fov: 5.28 },
  // The chase offset was measured against what it has to SHOW, not chosen: at section 9's own
  // (0, 12, 28) the ball is 30 ft from the lens and draws 5 px across, which is the same "you
  // can't see where the ball goes" stage 8 was written to fix. At (0, 10, 22) it is 24 ft out and
  // draws about 14 px, with the fence and the stands still in frame behind it.
  chase: { offset: [0, 10, 22] },
};
export const CHASE_LERP = 0.15;
// R7 (docs/BASEBALL-3D-BUILD.md section 9, "R7"): the chase's own MINIMUM START, used only for the
// very first snap of a play (`Actors.chaseAt(pos, immediate: true)`), never the steady per-frame
// offset above. Matt's recording: "on a short ball the first chase frames are the catcher's head
// filling the foreground."
//
// Measured (node, the real contact-hold-to-cut geometry: a grounder's ball position at
// `preFrac = CONTACT_HOLD_MS / (CONTACT_HOLD_MS + FLIGHT_MS)` of its flight, swept over every
// distanceFt from MIN_IN_PLAY_FT to 100 ft and every spray angle): at the STEADY offset, the
// catcher's own projected head height already exceeds the frame at some distance in that range
// (a near-lens pass, not a gentle close-up) - and it still does at every larger offset tried, since
// the camera's world z is `ball.z + offset.z` and the ball's own z sweeps continuously through the
// catcher's fixed z=7.8 for SOME distanceFt no matter what constant is added. No fixed offset can
// avoid that pass; it only moves which distanceFt it happens at. So this floor is NOT a collision
// guarantee by itself - what actually closes the defect is `Actors._applyCameraVisibility` hiding
// the catcher and umpire from the chase camera entirely (the same mechanism the batter camera
// already uses for the umpire, below). This floor is the second, modest half: a slightly wider
// start than the steady (10, 22) so a short play's first frame reads a touch more pulled-back,
// chosen small on purpose - measured worst-case ball size over the same 40-100 ft sweep drops from
// 6.85 px (steady) to only 6.27 px here, nowhere near the ~5 px CAMERAS.chase's own comment already
// rejected as illegible. `_stepChase`'s own per-frame CHASE_LERP eases the camera from this start
// back toward the steady offset over the next several frames, same as any other cut.
export const CHASE_MIN_HEIGHT_FT = 11;
export const CHASE_MIN_BACK_FT = 24;

/** The three cameras, already aimed. `setAspect(a)` re-applies the portrait aspect on every
 *  resize; the chase camera is positioned by `Actors` every frame and only needs its aspect here. */
export function makeCameras(aspect) {
  // R8: `def.fov` overrides the shared `CAMERAS.fov` when a camera carries its own (the pitcher's
  // long lens) - batter and chase have none and keep the shared value.
  const mk = (def) => {
    const c = new THREE.PerspectiveCamera((def && def.fov) || CAMERAS.fov, aspect, CAMERAS.near, CAMERAS.far);
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
// No image files (R1's hard rule). Every texture is drawn once on a canvas no larger than 256px on
// its long side and repeated (R9, docs/BASEBALL-3D-BUILD.md section 9, "R9", item 4, adds
// `wallTexture` to the R1 pair below, and gives `skyTexture` real width for the first time).
const PALETTE = {
  grassA: '#3f8f3a', grassB: '#4aa244', dirt: '#b8743f', dirtDark: '#a5652f',
  line: '#f2f4f8', fenceSeam: '#154f2a', rail: '#e8c34a',
  // Doc item 11: a tall park wall (a deep green face) and the ivy tint multiplied over the padded wall.
  tallWall: '#2e5a3a', ivy: '#7fbf5a',
  // R9 (docs/BASEBALL-3D-BUILD.md section 9, "R9", item 4): the crowd was a DARK ground
  // (`#2b3038`) lit only by ambient+one overhead sun - a vertical wall's own normal points
  // horizontally (toward home, `ribbonGeometry`'s own comment), so a light coming mostly from
  // ABOVE barely touches it, and the texture read as near-black regardless of its own colours.
  // `standsFace` moves to a LIGHT ground (the spec's own "dense multicolour specks on a light
  // ground") AND the face material moves to unlit (`buildStadium`, below) - the same fix the sky
  // already uses, for the same reason: background scenery that must read correctly regardless of
  // which way the sun happens to be facing.
  standsFace: '#c7c2b6', standsAisle: '#a39c8c', standsDeck: '#22262c',
  skyZenith: '#5b98d6', skyHorizon: '#dcedf9', cloud: '#ffffff',
  wallPad: '#1d6b3a', towerPole: '#5a5f66', towerHead: '#f2e6a8',
  scoreboardBody: '#20242c', scoreboardScreen: '#1f8f5c',
  // R9 fix (2026-09-21): the backstop's own three bands, matching the reference
  // (scratchpad/ref/reference-key-frames.jpg, top row) instead of the outfield stands' crowd
  // carried straight up from the ground - see `buildStadium`'s own backstop comment.
  backstopPad: '#24406a', backstopRail: '#f2f4f8',
  brickBase: '#9c5a42', brickMortar: '#c9b8a0',
  backstopCrowdGround: '#a9a49a',
  // R13 (docs/BASEBALL-3D-BUILD.md section 9, "R13", item 2): the per-league dressing. Aluminium
  // bleachers (Little League/High School), the chain-link backstop wall behind them, a small
  // parent-figure palette (spread out, never a wall of specks - the spec's own words), the berm
  // past a Little League fence, and the press box's own two tones.
  bleacherAlum: '#9aa0a6', bleacherAlumDark: '#7d838a',
  chainLink: '#c9cdd2', chainLinkOff: '#e8eaed',
  parents: ['#c0392b', '#2f6fb0', '#e0a72c', '#3f9e6b', '#8a4fae', '#e07b39'],
  bermGrassA: '#3a7a36', bermGrassB: '#458040',
  pressBoxBody: '#3a3f47', pressBoxWindow: '#a9c6e0',
};
// R9 item 4: the outfield wall's own ad panels - plain colour blocks with a simple shape, no text
// (spec's own words). Four panels, cycled along the wall's length.
const AD_PANELS = [
  { color: '#d94f3d', shape: 'circle' },
  { color: '#2f6fb0', shape: 'triangle' },
  { color: '#e0a72c', shape: 'diamond' },
  { color: '#3f9e6b', shape: 'square' },
];
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
/** A crowd: dense multicolour specks on a LIGHT ground, with AISLE GAPS breaking it into sections -
 *  R9 (docs/BASEBALL-3D-BUILD.md section 9, "R9", item 4). Deliberately not a people-shaped sprite -
 *  at the distance a stand is ever seen here (200 ft and up) a crowd IS a field of coloured dots,
 *  and anything more detailed is pixels nobody can resolve. Rewritten from the R1 version, which
 *  painted the SAME dots on a dark ground (`buildStadium`'s own PALETTE comment has the measured
 *  "renders near-black" cause: an unlit-looking texture on a material that WAS lit, from a sun that
 *  barely grazes a vertical face). */
// `ground` defaults to the outfield stands' own light colour; the backstop (R9 fix, 2026-09-21)
// passes its own slightly darker `PALETTE.backstopCrowdGround` so the two crowds read as the same
// KIND of texture (same dots, same aisle rule) without being identical panels pasted twice.
// R13 (item 2): `density` defaults to R9's own 3400 dots; College's single tier passes a higher
// count ("a fuller crowd texture on one tier", the spec's own words) since one tier alone would
// otherwise read thinner than the three- or two-tier bowls it sits beside on the ladder.
function crowdTexture(ground = PALETTE.standsFace, density = 3400) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ground; ctx.fillRect(0, 0, 256, 256);
  // Six aisles, evenly spaced, each a touch darker than the seating so the crowd reads as SECTIONS
  // rather than one continuous field of dots - the spec's own "with aisle gaps".
  ctx.fillStyle = PALETTE.standsAisle;
  const AISLES = 6, aisleW = 7;
  const aisleX = [];
  for (let i = 0; i < AISLES; i++) {
    const x0 = Math.round(((i + 0.5) / AISLES) * 256 - aisleW / 2);
    aisleX.push(x0);
    ctx.fillRect(x0, 0, aisleW, 256);
  }
  const dots = ['#d94f3d', '#2f6fb0', '#e0a72c', '#3f9e6b', '#8a4fae', '#3a3f47', '#ffffff'];
  // A fixed, repeatable scatter (not Math.random): the same texture every load means a screenshot
  // taken today and one taken next week differ only where the game differs.
  let seed = 20260920;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < density; i++) {
    const x = Math.floor(rnd() * 256), y = Math.floor(rnd() * 256);
    // Skip a dot that would land ON an aisle - the gap has to stay visibly clear, not just darker.
    if (aisleX.some((ax) => x >= ax - 1 && x < ax + aisleW + 1)) continue;
    ctx.fillStyle = dots[Math.floor(rnd() * dots.length)];
    ctx.fillRect(x, y, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** The outfield wall: a padded surface (R9 item 4 - "a padded green wall") with vertical pad
 *  seams and a band of AD PANELS - plain colour blocks with a simple shape, no text, cycling
 *  `AD_PANELS`. The yellow top-of-wall LINE is the existing rail mesh (`buildStadium`'s own
 *  `railGeo`/`railMat`, unchanged) - this texture is the wall FACE only. */
function wallTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = PALETTE.wallPad; ctx.fillRect(0, 0, 256, 96);
  const panelW = 256 / AD_PANELS.length;
  const bandY0 = 26, bandY1 = 74;
  ctx.strokeStyle = PALETTE.fenceSeam; ctx.lineWidth = 3;
  for (let i = 0; i <= AD_PANELS.length; i++) {
    const x = Math.round(i * panelW);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 96); ctx.stroke();   // a pad seam at every panel edge
  }
  for (let i = 0; i < AD_PANELS.length; i++) {
    const x0 = i * panelW;
    ctx.fillStyle = AD_PANELS[i].color;
    ctx.fillRect(x0 + 5, bandY0, panelW - 10, bandY1 - bandY0);
    const cx = x0 + panelW / 2, cy = (bandY0 + bandY1) / 2, r = (bandY1 - bandY0) * 0.32;
    ctx.fillStyle = '#f5f5f2';
    ctx.beginPath();
    if (AD_PANELS[i].shape === 'circle') {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (AD_PANELS[i].shape === 'triangle') {
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.9, cy + r * 0.75); ctx.lineTo(cx - r * 0.9, cy + r * 0.75); ctx.closePath();
    } else if (AD_PANELS[i].shape === 'diamond') {
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
    } else {
      ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
    }
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** The backstop's brick band (R9 fix, 2026-09-21 - the reference's own backstop, top row of
 *  `scratchpad/ref/reference-key-frames.jpg`, is padding low and brick above it, never the
 *  outfield stands' own crowd tier carried straight up from the ground). A running-bond pattern -
 *  mortar-colour ground, brick rectangles inset a couple of px, alternating half-brick offset every
 *  other row - 8 rows x 4 columns per tile, `buildStadium`'s own `BACKSTOP_BRICK_REPEAT_*` picks
 *  how many tiles cover the wall so one brick draws 3 to 6px at the pitcher camera's own lens
 *  (measured: about 18px per world foot at the backstop's 30ft distance, so a brick close to real
 *  scale - about 0.2ft tall - already lands in that range; see the constant's own comment). */
function brickTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = PALETTE.brickMortar; ctx.fillRect(0, 0, 128, 128);
  const rows = 8, cols = 4;
  const rowH = 128 / rows, colW = 128 / cols;
  const mortar = 2;
  let seed = 20260921;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // A warm red-brown base with a touch of per-brick shade variation, so the band reads as real
  // brick rather than a flat repeating tile once it is small on screen.
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW / 2);
    for (let cI = -1; cI <= cols; cI++) {
      const x = cI * colW + offset;
      const shade = 0.85 + rnd() * 0.3;
      const base = parseInt(PALETTE.brickBase.slice(1), 16);
      const rr = Math.min(255, Math.round(((base >> 16) & 255) * shade));
      const gg = Math.min(255, Math.round(((base >> 8) & 255) * shade));
      const bb = Math.min(255, Math.round((base & 255) * shade));
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(x + mortar / 2, r * rowH + mortar / 2, colW - mortar, rowH - mortar);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** R13 item 2: Little League's own backstop - "a low chain-link backstop... a semi-transparent
 *  grid texture on a low wall" (the spec's own words), instead of the padded/brick/crowd wall the
 *  other four leagues keep. A 64px canvas, mostly TRANSPARENT (no fill at all - `clearRect` is the
 *  canvas default, so the base is alpha 0), with a grid of thin light-grey lines - a chain-link
 *  fence reads as almost nothing but its own grid at a distance, never a solid panel.
 *  `tex.transparent = true` on the material is what a caller must set; this only draws the grid.
 *  R13 SHIP-REVIEW FIX (same day): Matt/the coordinator, on the shipped grid: "make the chain-link
 *  texture finer and more transparent so it does not read as a grey wall." Alpha 0.55 -> 0.35 and
 *  lineWidth 1.5 -> 1.0 (a thinner, fainter line reads as mesh rather than panel); STEP 8 -> 6 (more
 *  grid cells per tile, a finer weave). The call site (`buildStadium`) now also sets a vertical
 *  `repeat.y` on this texture - see `BACKSTOP_CHAINLINK_H`'s own comment for why: this function's
 *  UVs are baked to a fixed 30x horizontal repeat by `ribbonGeometry`'s own `uRepeat` argument, but
 *  vertical repeat is left at the material's default (1x, the whole canvas stretched over whatever
 *  height the wall is built to) unless the caller corrects it - shrinking `BACKSTOP_CHAINLINK_H`
 *  without also raising `repeat.y` would stretch every cell taller as the wall got shorter. */
function chainLinkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = PALETTE.chainLink;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.0;
  const STEP = 6;
  for (let i = -64; i <= 128; i += STEP) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** The sky: a vertical gradient, light at the horizon to blue at the zenith, plus a FEW SOFT CLOUDS
 *  (R9, docs/BASEBALL-3D-BUILD.md section 9, "R9", item 4 - R1's own spec had said "no clouds";
 *  Matt's later call is "the stadium backdrop... is bland" and this is the one piece of it that is
 *  ever actually looked AT rather than past). R1's version was a 2px-wide column stretched around
 *  the whole sphere - uniform at every longitude by construction, so cloud shapes need real
 *  horizontal variation, which is why this is now a real 256-wide canvas instead of a 2px gradient
 *  strip. Five clouds, each a few overlapping soft-edged blobs (radial gradients fading to
 *  transparent, so they blend into the gradient rather than sitting on top of it as flat discs), a
 *  fixed seed (the same "today's screenshot matches next week's" rule `crowdTexture` already
 *  follows) so the sky is reproducible. */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, PALETTE.skyZenith);
  g.addColorStop(0.55, PALETTE.skyHorizon);
  g.addColorStop(1, PALETTE.skyHorizon);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  let seed = 20260921;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const blob = (cx, cy, r, alpha) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(255,255,255,${alpha})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  };
  const CLOUDS = 5;
  for (let i = 0; i < CLOUDS; i++) {
    const cx = ((i + 0.5) / CLOUDS) * 256 + (rnd() - 0.5) * 30;
    const cy = 28 + rnd() * 34;   // the upper third, above the horizon band
    const puffs = 3 + Math.floor(rnd() * 2);
    for (let p = 0; p < puffs; p++) {
      blob(cx + (rnd() - 0.5) * 30, cy + (rnd() - 0.5) * 8, 10 + rnd() * 10, 0.68 + rnd() * 0.22);
    }
  }
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
/** R13 item 2: a SLOPED deck, `inner` points at `y0` rising to `outer` points at `y1` - Little
 *  League's own grass berm past the fence (a raised mound instead of a tiered stand), the one
 *  piece of stadium geometry in this file that is not flat. Same sampling/winding as
 *  `deckGeometry`, which this is otherwise identical to. */
function rampGeometry(inner, outer, y0, y1) {
  const n = inner.length;
  const pos = new Float32Array((n - 1) * 6 * 3);
  const nrm = new Float32Array((n - 1) * 6 * 3);
  const uv = new Float32Array((n - 1) * 6 * 2);
  let pi = 0, ni = 0, ui = 0;
  // The ramp's own up-slope normal: it rises `y1 - y0` over roughly the inner/outer gap, computed
  // once from the FIRST sample (the berm is a near-constant-width ring, so one normal serves the
  // whole geometry without a per-quad recompute) and reused for every vertex.
  const gapFt = Math.hypot(outer[0].x - inner[0].x, outer[0].z - inner[0].z) || 1;
  const riseFt = y1 - y0;
  const runLen = Math.hypot(gapFt, riseFt) || 1;
  for (let i = 0; i < n - 1; i++) {
    const a = inner[i], b = inner[i + 1], c = outer[i], d = outer[i + 1];
    const quad = [
      [a, y0, 0, 0], [c, y1, 1, 0], [d, y1, 1, 1],
      [a, y0, 0, 0], [d, y1, 1, 1], [b, y0, 0, 1],
    ];
    for (const [p, y, u, v] of quad) {
      pos[pi++] = p.x; pos[pi++] = y; pos[pi++] = p.z;
      uv[ui++] = u * 4; uv[ui++] = v;
      // The slope's own INWARD-and-up normal (a ramp that rises as radius grows faces back toward
      // home and up, the same way a real hillside's visible face angles toward whoever is standing
      // below it - the outward-and-down tangent along the slope, (run, rise) in the (radial, y)
      // plane, rotated +90deg gives (-rise, run), an inward horizontal component). Found by
      // rendering: the first version used the OUTWARD sign here, which pointed the surface's
      // normal away from the sun for the whole visible face, so `MeshLambertMaterial` shaded it
      // pure black (`scratchpad/r13/berm-diagnostic-BROKEN-normal.png`) - a real defect, not a
      // camera-angle limitation, since nothing about this bug depends on which camera looks at it.
      const len = Math.hypot(p.x, p.z) || 1;
      nrm[ni++] = -(p.x / len) * (riseFt / runLen); nrm[ni++] = gapFt / runLen; nrm[ni++] = -(p.z / len) * (riseFt / runLen);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
/** R13 item 2: one small aluminium bleacher SET, in LOCAL space - `rows` stepped risers, each a
 *  flat box `widthFt` wide, front edge (the row closest to the field) at local z=0 and rows
 *  receding in +z as they rise, exactly the real shape a small grandstand has. The caller
 *  translates/rotates each PLACED instance (`placeBleacher`, `buildStadium`) so local +z (the
 *  direction the rows recede toward) points AWAY from home - the same "build local, place with a
 *  translate+rotate" pattern the light towers already use, generalised to something that needs a
 *  rotation as well as a translation. `seatPoints` returns each row's own seat position (a hair
 *  forward and below the row's own back riser top, where a figure's feet actually rest) for the
 *  parent figures to be scattered along. */
function bleacherUnitParts(widthFt, rows, rowDepthFt, rowHFt) {
  const parts = [];
  const seatPoints = [];
  for (let i = 0; i < rows; i++) {
    const g = new THREE.BoxGeometry(widthFt, rowHFt, rowDepthFt);
    g.translate(0, rowHFt * (i + 0.5), rowDepthFt * (i + 0.5));
    parts.push(g);
    seatPoints.push({ y: rowHFt * (i + 1), z: rowDepthFt * (i + 0.65), row: i });
  }
  return { parts, seatPoints, widthFt };
}
/** R13 item 2: place one bleacher-unit's geometry (and its seat points) at a WORLD position,
 *  rotated so it faces home (local +z, "rows recede away from the field", maps to the OUTWARD
 *  radial direction from home through `pos`) - `Math.atan2(pos.x, pos.z)` is the same
 *  facingRad convention `_place()`'s callers already use for a figure standing at this same kind
 *  of position, just applied to a rotateY on raw geometry instead of a bone hierarchy. */
function placeBleacher(unit, pos, seedBase, densityHint) {
  const theta = Math.atan2(pos.x, pos.z);
  const sin = Math.sin(theta), cos = Math.cos(theta);
  const rot = (p) => ({ x: p.x * cos + p.z * sin, z: -p.x * sin + p.z * cos });
  const parts = unit.parts.map((g) => {
    const c = g.clone();
    c.rotateY(theta);
    c.translate(pos.x, 0, pos.z);
    return c;
  });
  const seats = unit.seatPoints.map((s) => {
    const local = rot({ x: 0, z: s.z });
    return { x: pos.x + local.x, y: s.y, z: pos.z + local.z, row: s.row };
  });
  return { parts, seats, widthFt: unit.widthFt, theta };
}
/** R13 item 2: scatter PARENT FIGURES on a bleacher's own seat rows - simple blocky "coloured
 *  billboard" people (a single box per figure, the spec's own "simple figures or coloured
 *  billboards"), never a wall of specks: `count` figures per bleacher set, SPREAD OUT along the
 *  width and across every row from a seeded RNG (the same "today's screenshot matches next week's"
 *  rule every other procedural texture in this file follows), grouped by colour into a handful of
 *  merged meshes so `count` figures across several bleachers still costs only
 *  `PALETTE.parents.length` draw calls, not one per person. */
function scatterParents(bleacherPlacements, count, seed0) {
  let seed = seed0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const byColor = PALETTE.parents.map(() => []);
  // R13 SHIP-REVIEW FIX (same day): FIG_H raised 1.5 -> 2.5 alongside BLEACHER_ROW_H_FT's own
  // increase (see that constant's comment) - a 1.5ft "bust" barely cleared the fence at all; 2.5ft
  // (a seated fan's own torso-and-head silhouette above the bench, not a full standing height,
  // since the lower body is what a bleacher row already hides) puts a real, visible slice of colour
  // above the fence line at the pitcher camera's own lens instead of a sliver.
  const FIG_W = 0.9, FIG_H = 2.5, FIG_D = 0.6;
  for (let i = 0; i < count; i++) {
    const b = bleacherPlacements[Math.floor(rnd() * bleacherPlacements.length)];
    const seat = b.seats[Math.floor(rnd() * b.seats.length)];
    const alongFrac = 0.12 + rnd() * 0.76;   // never right at either end - "spread out", not edge-packed
    const along = (alongFrac - 0.5) * b.widthFt;
    const sin = Math.sin(b.theta), cos = Math.cos(b.theta);
    // `along` runs parallel to the bleacher's own local x (its width), rotated the same way the
    // seat z offset already was in `placeBleacher`.
    const x = seat.x + along * cos, z = seat.z - along * sin;
    const colorI = Math.floor(rnd() * PALETTE.parents.length);
    const g = new THREE.BoxGeometry(FIG_W, FIG_H, FIG_D);
    g.translate(x, seat.y + FIG_H / 2, z);
    byColor[colorI].push(g);
  }
  return byColor;
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
/** R7 (docs/BASEBALL-3D-BUILD.md section 9, "R7"): the short backstop section BEHIND home plate.
 *  `standsPoints` above runs -75 to +75 degrees and stops there (R1 spec), leaving the whole rear
 *  180-ish degrees open - which is exactly what the PITCHER camera looks straight into (Matt's own
 *  recording: "grass to the horizon behind the batter"; the R1 record already flagged this as
 *  deferred). `deg` uses the same `polar()` convention as every other angle in this file (0 =
 *  straight to centre field), so directly behind the plate is 180; sweeping 180 +/- halfSpanDeg
 *  draws a short convex arc centred there, at a fixed radius from home (no fence to measure off,
 *  unlike `standsPoints`). */
function backstopPoints(distFt, halfSpanDeg, stepDeg = 3) {
  const pts = [];
  for (let deg = 180 - halfSpanDeg; deg <= 180 + halfSpanDeg + 1e-9; deg += stepDeg) {
    const p = polar(deg, distFt);
    pts.push({ x: p.x, z: -p.y });
  }
  return pts;
}
// R7: measured (node, ray-casting the PITCHER camera's own left/right frustum edges through the
// z = 30 ft plane, `CAMERAS.pitcher`'s real position/lookAt) - the frame spans about -55 to +54
// degrees from home at that depth, so 60 is that span plus a few degrees of margin either side.
// 30 ft is "about 20 ft behind the umpire" (UMPIRE.z = 10.2), rounded.
const BACKSTOP_DIST_FT = 30;
const BACKSTOP_HALF_SPAN_DEG = 60;
// R9 fix (2026-09-21, after R9 shipped): Matt, on `after-pitcher-cam.png`: the backstop (built as
// two more tiers of the SAME crowd texture the outfield stands use) fills the whole frame behind
// the plate at this lens and reads as TV static, not a crowd - the reference's own backstop
// (scratchpad/ref/reference-key-frames.jpg, top row) is a padded wall low, a brick band above it,
// and a crowd tier only above THAT. Rebuilt as one flat wall, three vertical bands, at the same
// BACKSTOP_DIST_FT/BACKSTOP_HALF_SPAN_DEG R7 already measured against the pitcher camera's frame:
// R13 SHIP-REVIEW FIX (same day, after the item-1 camera pull-back): Matt/the coordinator, on
// `highschool-pitcher.png` and up: "the whole pitching frame behind the plate is now a flat
// dark-blue wall" - the item-1 camera (130ft behind the rubber, fov 5.28) is a MUCH longer lens
// than the one these three bands were tuned against (55.6ft/fov 10.35), and at that lens the
// pitching band's own visible vertical extent at the backstop's distance is far smaller than the
// old 12+16+12=40ft wall. Measured (node, `projectToCanvas` against the SHIPPED `CAMERAS.pitcher`,
// x=0, z=-BACKSTOP_DIST_FT): the frame's own top edge, at this distance, sits at world y=10.86ft -
// above that is off-screen sky, not backstop, whatever height the wall is actually built to. The
// old BACKSTOP_PAD_H (12ft) alone already exceeded that ceiling, so the WHOLE visible backstop was
// pad - one flat colour, no texture at all, exactly the report. Re-proportioned so the visible
// slice (0 to ~10.86ft) actually shows all three bands, not just the first: BACKSTOP_PAD_H 4ft (the
// coordinator's own number), BACKSTOP_BRICK_H 4ft (a DELIBERATE DEVIATION from the coordinator's
// literal "about 8ft" - at 8ft the crowd tier would start at pad+brick=12ft, ABOVE the measured
// 10.86ft ceiling, so it would never be visible at any pitcher-camera framing regardless of how
// tall it is drawn; 4ft leaves the crowd tier starting at 8ft, with a real ~2.86ft/91px slice of
// it inside the frame - satisfies the coordinator's own acceptance test, "the stands/crowd tier
// visible in the top third," which 8ft cannot). BACKSTOP_CROWD_H (10ft) is generous past the
// visible ceiling on purpose - cheap extra geometry, no visible cost, and margin for a future
// camera nudge.
const BACKSTOP_PAD_H = 4;           // ground to 4ft: the solid padded wall
const BACKSTOP_RAIL_H = 0.4;        // a thin white rail on top of the pad, same convention as FENCE.railHeight
const BACKSTOP_BRICK_H = 4;         // 4 to 8ft: the brick band (see the deviation note above)
const BACKSTOP_CROWD_H = 10;        // 8 to 18ft: the crowd (most of it past the frame's own 10.86ft ceiling, harmless)
// Measured (node, `projectToCanvas` against the SHIPPED `CAMERAS.pitcher`, the same method the
// deviation note above used): about 32.1px per world foot at BACKSTOP_DIST_FT (was ~18.0px/ft at
// the pre-ship-review camera - a longer lens, more px per foot). A brick close to its real size
// (about 0.2ft tall, 0.6ft long, unchanged) still draws inside the spec's own "3 to 6px" for the
// tall axis (0.2 x 32.1 = 6.4px, right at the edge - the physical brick size was left alone rather
// than shrunk further, since 6.4px still reads as brick, not noise); the brick canvas is 8 rows x
// 4 cols per tile (`brickTexture`), so repeat.y = BACKSTOP_BRICK_H / (8 x 0.2) = 4 / 1.6 = 2.5
// (was 10, at the old BRICK_H=16), and repeat.x = (the wall's own arc length, unchanged by any of
// this - 2*pi*BACKSTOP_DIST_FT*(2*BACKSTOP_HALF_SPAN_DEG/360) = ~62.8ft) / (4 x 0.6) = ~26,
// unaffected by the height change (repeat.x depends only on the arc length and the brick's own
// physical width, never on BACKSTOP_BRICK_H).
const BACKSTOP_BRICK_REPEAT_X = 26;
const BACKSTOP_BRICK_REPEAT_Y = 2.5;
// The crowd tier's own repeat, re-solved for the new 32.1px/ft (was ~18.0): a ~3px speck needs
// repeat.x = (arc_length x pxPerFt) / 256 (the crowd canvas's own width, each dot 3px of it) =
// (62.8 x 32.1) / 256 = ~7.9 (was 4.5 at the old camera's lower px/ft - a longer lens needs MORE
// tiles to keep the same on-screen speck size, not fewer). repeat.y solves the same way against
// the new, much shorter BACKSTOP_CROWD_H (10, was 12): (10 x 32.1) / 256 = ~1.25 (was 1).
const BACKSTOP_CROWD_REPEAT_X = 7.9;
const BACKSTOP_CROWD_REPEAT_Y = 1.25;

// R13 (docs/BASEBALL-3D-BUILD.md section 9, "R13", item 2): Matt, on v882: "For little league it
// should look like bleachers and stuff with spread out parents in them, then for every league the
// audience and bleacher/seats should increase." One row per league, everything else in
// `buildStadium` below reads ONLY this table to decide what to build - so the five dressings stay
// a single, auditable ladder instead of five copy-pasted branches.
//   tiers: how many of the outfield bowl's own stepped tiers to build (0-3; Majors is R9's
//     unchanged 3, Minors 2, College 1, Little League/High School 0 - a concrete bowl reads wrong
//     at a Little League field, so those two get bleachers instead, below).
//   backstop: 'chainlink' (Little League only - a low, mostly-see-through wall) or 'padded' (every
//     other league, R7/R9's own three-band wall, unchanged).
//   towers: four light towers (R9), from College up - a Little League/High School diamond plays by
//     daylight in the real sport, and the spec's own words are explicit ("no light towers") for
//     Little League; High School keeps the same absence rather than inventing a number for it.
//   scoreboardScale: the centre-field board's own size multiplier - Little League's is "a small
//     scoreboard" (the spec's own words), everyone else keeps R9's shipped size.
//   bleachers: `{deg, r}` placements (`polar()`'s own convention, r in feet from home) for small
//     aluminium bleacher SETS - behind the plate and down each line - built instead of a tiered
//     bowl. Empty once a league has real tiers.
//   bleacherWidthFt/bleacherRows: one shared shape per league (High School's own "longer
//     bleachers" is a wider, taller set, not a different placement rule).
//   parentsPerBleacher: scattered across EVERY bleacher set that league has, so the printed total
//     (3 sets) is the spec's own "little about 12, highschool about 40" almost exactly (12 and 39).
//   berm: Little League only - a grass rise past the fence instead of any stand at all.
//   pressBox: High School only - a small booth behind the backstop.
const LEAGUE_STADIUM = {
  little: {
    tiers: 0, backstop: 'chainlink', towers: false, scoreboardScale: 0.55,
    bleachers: [{ deg: 180, r: 34 }, { deg: 50, r: 130 }, { deg: -50, r: 130 }],
    bleacherWidthFt: 16, bleacherRows: 4, parentsPerBleacher: 4,
    berm: true, pressBox: false,
  },
  highschool: {
    tiers: 0, backstop: 'padded', towers: false, scoreboardScale: 0.85,
    bleachers: [{ deg: 180, r: 38 }, { deg: 54, r: 168 }, { deg: -54, r: 168 }],
    bleacherWidthFt: 26, bleacherRows: 6, parentsPerBleacher: 13,
    berm: false, pressBox: true,
  },
  college: {
    tiers: 1, backstop: 'padded', towers: true, scoreboardScale: 1,
    bleachers: [], bleacherWidthFt: 0, bleacherRows: 0, parentsPerBleacher: 0,
    berm: false, pressBox: false, crowdDensity: 4600,   // "a fuller crowd texture" - R9's own 3400 x 1.35
  },
  minors: {
    tiers: 2, backstop: 'padded', towers: true, scoreboardScale: 1,
    bleachers: [], bleacherWidthFt: 0, bleacherRows: 0, parentsPerBleacher: 0,
    berm: false, pressBox: false,
  },
  majors: {
    tiers: 3, backstop: 'padded', towers: true, scoreboardScale: 1,
    bleachers: [], bleacherWidthFt: 0, bleacherRows: 0, parentsPerBleacher: 0,
    berm: false, pressBox: false,
  },
};
// R13 SHIP-REVIEW FIX (same day): the original item-2 draft's BLEACHER_ROW_H_FT (1.15) put the
// TOP riser at 4 x 1.15 = 4.6ft and the tallest seated parent (FIG_H 1.5, below) at only 6.1ft -
// barely clearing the chain-link fence's own new 6ft height at all, so from the pitcher camera's
// own extreme telephoto lens (the same measured 10.86ft visible ceiling the padded-backstop bands
// were re-proportioned against, above) almost none of a parent figure ever cleared the fence line -
// "bleachers and parents visible above it" was only a sliver at the shipped size. Raised so a
// parent's own head clears the fence with real margin, verified by rendering (`little-pitcher.png`):
// riser top 4 x 1.4 = 5.6ft (just under the fence, where a real small bleacher sits), parent heads
// (below) at 5.6 + 2.5 = 8.1ft - solidly inside the visible ceiling, not a bare sliver.
const BLEACHER_ROW_DEPTH_FT = 2.4, BLEACHER_ROW_H_FT = 1.4;
// R13: the berm's own extent past the fence, and the press box's own box, both fixed shapes
// (neither scales with `fenceFt` - a Little League/High School dressing never sees a fence far
// enough out for that to matter, the same reasoning R9's towers/scoreboard already rely on).
const BERM_EXTRA_FT = 18, BERM_RISE_FT = 7;
const PRESS_BOX_W = 18, PRESS_BOX_H = 6, PRESS_BOX_D = 8, PRESS_BOX_DIST_FT = 34, PRESS_BOX_Y = BACKSTOP_PAD_H + BACKSTOP_BRICK_H + 2;

/** Build the whole stadium into `scene` for one league. Returns a handle with `dispose()` (every
 *  geometry, material and texture this made), `group`, and `fencePts` so a test can sample the wall
 *  that actually shipped rather than recompute it.
 *
 *  Draw calls are the budget that matters on a phone, so anything sharing a material is merged into
 *  ONE mesh (all the white lines and bags together; the three stand faces together; the three decks
 *  together). R9 (docs/BASEBALL-3D-BUILD.md section 9, "R9", item 4) adds four light towers (one
 *  merged mesh for the four poles, one for the four light banks) and the centre-field scoreboard
 *  (one mesh for the body, one for its screen) - four more meshes, and since each is one material
 *  for ALL four towers, still four more draw calls, not sixteen. Measured (a scratch Chromium
 *  script, `actors.renderStats()` with only the batter and pitcher placed, Little League fence):
 *  batter camera 18 draw calls / 7793 triangles before R9, 22 / 7993 after; pitcher camera 21/9469
 *  before, 25/9669 after; chase camera 10/5569 before, 14/5769 after - +4 draw calls on every
 *  camera, unaffected by which league's fence shape is passed in (none of R9's additions scale
 *  with `fenceFt`).
 *
 *  R9 SHIP-REVIEW FIX (2026-09-21): the backstop moved OUT of the shared `faceGeo`/`deckGeo` merge
 *  into its own four meshes (padded wall, rail, brick, crowd - see `buildStadium`'s own backstop
 *  comment). Re-measured, college fence: batter camera 25 calls / 7913 triangles, pitcher camera
 *  27 / 9645, chase camera 14 / 5449 - a few more draw calls than the number above (the backstop
 *  is no longer "free" inside the outfield stands' own merge), still well inside a phone's budget.
 *
 *  Note on leagues: only the FENCE varies through R9. `FIELD[league].fieldScale` scales the
 *  named-park distances inside the engine (settings.js's own comment), never the diamond - the
 *  base paths and the rubber are regulation at every league there, so they are regulation here too.
 *
 *  R13 (docs/BASEBALL-3D-BUILD.md section 9, "R13", item 2): the BACKDROP now varies by league too
 *  - `LEAGUE_STADIUM` (above) is the one table everything below reads. `league` defaults to
 *  `'majors'` so an old caller (or a test that never passes it) gets R9's own bowl unchanged, byte
 *  for byte. Draw calls per league, measured (batter/pitcher/chase cameras, each league's own real
 *  fence shape): see the R13 entry in `baseball/CLAUDE.md` for the numbers - every league stays
 *  comfortably inside the same phone budget the R9 bowl alone already was. */
export function buildStadium(scene, { fenceFt, league = 'majors' }) {
  const cfg = LEAGUE_STADIUM[league] || LEAGUE_STADIUM.majors;
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

  // --- the fence: ONE ribbon following the league's own shape, padded and carrying a row of ad
  // panels (R9 item 4 - `wallTexture()`'s own header), with a rail along the top (the spec's own
  // "yellow line", unchanged from R1).
  const fencePts = fencePoints(fenceFt, 2);
  const wallGeo = ribbonGeometry(fencePts, 0, FENCE.height);
  const wallTex = wallTexture(); texs.push(wallTex);
  // Repeated along the wall's own length, not stretched to it - `repeat.x` picks how many times
  // AD_PANELS' own four-panel pattern tiles across the fence's arc, the same convention crowdTex/
  // grassTex already use (a fixed tile count via `tex.repeat`, not the geometry's own uRepeat).
  wallTex.repeat.set(7, 1);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(wallGeo, wallMat)); track(wallGeo, wallMat);
  const railGeo = ribbonGeometry(fencePts, FENCE.height, FENCE.height + FENCE.railHeight);
  const railMat = new THREE.MeshLambertMaterial({ color: PALETTE.rail, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(railGeo, railMat)); track(railGeo, railMat);

  // Doc item 11 (Matt, 2026-09-23): a Majors park's own features. `ivy` is looks only - the padded
  // wall tinted green. `walls` are the TALL sections (`PARKS[id].walls`, the same entries
  // `outcomes.js` scores a double off): a plain green face from the rail up to the wall's height,
  // with its own rail on top, sampled every degree along the same fence curve.
  if (fenceFt.ivy) wallMat.color.set(PALETTE.ivy);
  if (Array.isArray(fenceFt.walls) && fenceFt.walls.length) {
    const tallMat = new THREE.MeshLambertMaterial({ color: PALETTE.tallWall, side: THREE.DoubleSide });
    mats.push(tallMat);
    for (const w of fenceFt.walls) {
      const pts = [];
      for (let deg = w.fromDeg; deg <= w.toDeg + 1e-6; deg += 1) {
        const p = polar(deg, fenceFtAt(deg, fenceFt));
        pts.push({ x: p.x, z: -p.y });
      }
      if (pts.length < 2) continue;
      const faceGeo = ribbonGeometry(pts, FENCE.height + FENCE.railHeight, w.heightFt);
      group.add(new THREE.Mesh(faceGeo, tallMat)); track(faceGeo, null);
      const topGeo = ribbonGeometry(pts, w.heightFt, w.heightFt + FENCE.railHeight);
      group.add(new THREE.Mesh(topGeo, railMat)); track(topGeo, null);
    }
  }

  // --- the stands: R13 - `cfg.tiers` stepped tiers (0-3, `LEAGUE_STADIUM`'s own table), each 12 ft
  // deep, rising to 40 ft. Flat boxes, as budgeted: one vertical face and one horizontal deck per
  // tier, all faces merged and all decks merged. Little League/High School build NONE of this at
  // all (`cfg.tiers === 0`) - their own dressing is the bleachers/berm/press-box block below.
  if (cfg.tiers > 0) {
    const crowdTex = crowdTexture(PALETTE.standsFace, cfg.crowdDensity || 3400); texs.push(crowdTex);
    // R9 item 4: repeat lowered from the R1/R7 value (60, 1.4) - at that spatial frequency the crowd
    // aliased into flat grey-brown static up close (the backstop, ~20-30ft from the pitcher camera,
    // and the chase camera on a deep fly), which read as "renders near-black" for the same reason the
    // lighting did: neither the colour nor the texture was ever actually resolved at those distances.
    // Anisotropic filtering (the renderer's own max, the standard fix for a texture viewed at a
    // shallow angle) is the other half - a flat repeat count change alone still aliased at the
    // backstop's own steep viewing angle.
    crowdTex.repeat.set(22, 1.1);
    crowdTex.anisotropy = 8;
    const faceParts = [], deckParts = [];
    const tierBase = [FENCE.height, 16, 28];
    const tierTop = [16, 28, 40];
    for (let k = 0; k < cfg.tiers; k++) {
      const inner = standsPoints(fenceFt, 14 + k * 12);
      const outer = standsPoints(fenceFt, 14 + (k + 1) * 12);
      faceParts.push(ribbonGeometry(inner, tierBase[k], tierTop[k], 1));
      deckParts.push(deckGeometry(inner, outer, tierTop[k]));
    }
    const faceGeo = mergeGeometries(faceParts, false);
    // R9 item 4: UNLIT (MeshBasicMaterial, was MeshLambertMaterial) - the measured cause of "renders
    // near-black" (this function's own PALETTE.standsFace comment): a vertical face's normal points
    // horizontally, so the mostly-overhead sun barely lights it regardless of the texture's own
    // colours. The sky already draws unlit for the identical reason (background scenery that must
    // read correctly no matter which way the light happens to be facing); the crowd now matches it.
    const faceMat = new THREE.MeshBasicMaterial({ map: crowdTex, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(faceGeo, faceMat)); track(faceGeo, faceMat);
    const deckGeo = mergeGeometries(deckParts, false);
    const deckMat = new THREE.MeshLambertMaterial({ color: PALETTE.standsDeck, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(deckGeo, deckMat)); track(deckGeo, deckMat);
    for (const g of [...faceParts, ...deckParts]) g.dispose();
  }

  // --- R13 item 2: Little League's own backstop is a LOW, mostly-see-through chain-link wall
  // instead of the padded/brick/crowd wall every other league keeps (below). One ribbon,
  // `BACKSTOP_CHAINLINK_H` tall, the semi-transparent grid texture (`chainLinkTexture`) on BOTH
  // sides so it reads the same from the pitcher camera as from anywhere else a future camera might
  // look from. R13 SHIP-REVIEW FIX (same day): Matt/the coordinator's own literal number - "a 6 ft
  // chain-link" - replaces the original item-2 draft's 10ft (a real Little League backstop height,
  // but taller than the coordinator's own explicit ask once the camera's real framing was measured
  // against it - the bleachers/parents behind it need real sky between the fence top and their own
  // feet to read as "above it," not "on top of it"). `repeat.y` is set here (not inside
  // `chainLinkTexture` itself, which has no height to read) to keep the grid's own cells close to
  // SQUARE as the wall gets shorter: `ribbonGeometry`'s own `uRepeat` (30, unchanged) bakes one
  // horizontal tile every 62.8/30 = ~2.09ft of arc; matching that physical size vertically at the
  // new 6ft height needs repeat.y = 6 / 2.09 = ~2.87 - left at the material's own default (1x)
  // would stretch every diamond of the mesh three times taller than it is wide.
  const backstopPts = backstopPoints(BACKSTOP_DIST_FT, BACKSTOP_HALF_SPAN_DEG);
  if (cfg.backstop === 'chainlink') {
    const BACKSTOP_CHAINLINK_H = 6;
    const clGeo = ribbonGeometry(backstopPts, 0, BACKSTOP_CHAINLINK_H, 30);
    const clTex = chainLinkTexture(); texs.push(clTex);
    clTex.repeat.set(1, 2.87);
    // Rendering this at distance found a FOURTH problem the alpha/lineWidth/STEP changes above
    // don't touch: WebGL's own mipmap minification averages a fine grid of thin lines, viewed from
    // far enough away that many texels land under one screen pixel, into a near-solid GRAY HAZE -
    // the exact "reads as a grey wall" symptom, just from a different cause than the shipped
    // texture's own alpha/coarseness. A grid pattern is the one shape mipmapping handles worst (a
    // brick or crowd texture's own solid-fill blocks survive averaging as a colour; a grid of
    // mostly-transparent lines averages toward a flat, medium-alpha grey no matter how the lines
    // themselves are drawn). Disabling mipmaps for this one texture - sampled at full resolution
    // every frame, never blurred toward its own average - is what actually lets the grid read as a
    // fence with real gaps instead of a haze; `THREE.LinearFilter` on `minFilter` is the standard
    // fix for exactly this failure mode.
    clTex.generateMipmaps = false;
    clTex.minFilter = THREE.LinearFilter;
    const clMat = new THREE.MeshBasicMaterial({ map: clTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    group.add(new THREE.Mesh(clGeo, clMat)); track(clGeo, clMat);
    // A thin dark top rail (a real chain-link fence's own top pipe) - unlit, the same convention
    // every other rail-on-a-wall in this file already uses.
    const clRailGeo = ribbonGeometry(backstopPts, BACKSTOP_CHAINLINK_H, BACKSTOP_CHAINLINK_H + 0.25);
    const clRailMat = new THREE.MeshLambertMaterial({ color: PALETTE.bleacherAlumDark, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(clRailGeo, clRailMat)); track(clRailGeo, clRailMat);
  } else {
    // --- R9 fix (2026-09-21): the backstop, rebuilt to read like the reference instead of the
    // outfield stands' own crowd tier carried straight up from the ground (this function's own
    // BACKSTOP_PAD_H/BACKSTOP_BRICK_H/BACKSTOP_CROWD_H comment has the measurement). One flat wall
    // at BACKSTOP_DIST_FT (R7's own distance, unchanged), three vertical bands - not R7's two radial
    // tiers, since the reference's own backstop reads as a near-flat wall, not a stepped bowl. Same
    // camera-visibility fact R7 already established: the batter camera (z = 13.1, looking toward -z)
    // never reaches z = 30, so nothing here needs a per-camera visibility toggle.

    // Band 1: the padded wall, ground to BACKSTOP_PAD_H - a solid muted dark blue, no texture (the
    // spec's own "a solid padded wall"), with a thin white rail on top (the same ribbon-on-a-wall
    // convention the outfield fence's own rail already uses). R13: UNLIT (`MeshBasicMaterial`, was
    // `MeshLambertMaterial`) - the pitcher camera's own pull-back (item 1) means this band alone
    // now fills most of the visible backstop (the brick/crowd bands above it sit further out of
    // frame than before), and under Lambert shading it measured (10,24,38) against its own raw
    // (36,64,106) - the same "vertical face, mostly-overhead sun" darkening the crowd/sky already
    // needed fixing for, just newly PROMINENT rather than newly broken.
    const padGeo = ribbonGeometry(backstopPts, 0, BACKSTOP_PAD_H);
    const padMat = new THREE.MeshBasicMaterial({ color: PALETTE.backstopPad, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(padGeo, padMat)); track(padGeo, padMat);
    const backstopRailGeo = ribbonGeometry(backstopPts, BACKSTOP_PAD_H, BACKSTOP_PAD_H + BACKSTOP_RAIL_H);
    const backstopRailMat = new THREE.MeshLambertMaterial({ color: PALETTE.backstopRail, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(backstopRailGeo, backstopRailMat)); track(backstopRailGeo, backstopRailMat);

    // Band 2: brick, BACKSTOP_PAD_H to BACKSTOP_PAD_H + BACKSTOP_BRICK_H - the spec's own "a brick
    // band... tiled so a brick is 3 to 6px at the pitcher camera's lens" (BACKSTOP_BRICK_REPEAT_*'s
    // own comment has the measurement this repeat is set from).
    const brickGeo = ribbonGeometry(backstopPts, BACKSTOP_PAD_H, BACKSTOP_PAD_H + BACKSTOP_BRICK_H);
    const brickTex = brickTexture(); texs.push(brickTex);
    brickTex.repeat.set(BACKSTOP_BRICK_REPEAT_X, BACKSTOP_BRICK_REPEAT_Y);
    brickTex.anisotropy = 8;
    const brickMat = new THREE.MeshLambertMaterial({ map: brickTex, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(brickGeo, brickMat)); track(brickGeo, brickMat);

    // Band 3: the crowd, ONLY above the brick - a darker ground (`PALETTE.backstopCrowdGround`) and
    // a MUCH LOWER repeat than the outfield bowl's own (this file's own BACKSTOP_CROWD_REPEAT_*
    // comment has the measurement), since the backstop sits far closer to the pitcher camera than
    // the outfield stands ever do. Unlit, same reason the outfield crowd is unlit (a vertical face's
    // normal points horizontally, so the mostly-overhead sun barely lights it).
    const backstopCrowdTop = BACKSTOP_PAD_H + BACKSTOP_BRICK_H + BACKSTOP_CROWD_H;
    const backstopCrowdGeo = ribbonGeometry(backstopPts, BACKSTOP_PAD_H + BACKSTOP_BRICK_H, backstopCrowdTop);
    const backstopCrowdTex = crowdTexture(PALETTE.backstopCrowdGround); texs.push(backstopCrowdTex);
    backstopCrowdTex.repeat.set(BACKSTOP_CROWD_REPEAT_X, BACKSTOP_CROWD_REPEAT_Y);
    backstopCrowdTex.anisotropy = 8;
    const backstopCrowdMat = new THREE.MeshBasicMaterial({ map: backstopCrowdTex, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(backstopCrowdGeo, backstopCrowdMat)); track(backstopCrowdGeo, backstopCrowdMat);
  }

  // --- R9 item 4, R13-gated: four light towers, ringing the outfield (the spec's own "four light
  // towers") - College and up only (`cfg.towers`); Little League/High School play with none, the
  // spec's own explicit call for Little League, kept for High School too rather than inventing a
  // number for it. Two merged meshes total (every pole in one, every light bank in the other) - the
  // same merge-by-material budget discipline the stands already follow, so four towers cost two
  // draw calls, not eight. Positioned by the SAME `polar()`/fenceFtAt convention every other angle
  // in this file uses, a fixed distance past the fence so they read as standing just outside the wall.
  if (cfg.towers) {
    const TOWER_DEG = [-38, -13, 13, 38];
    const TOWER_EXTRA_FT = 18;   // past the fence, at this angle
    const TOWER_POLE_H = 70, TOWER_HEAD_H = 10, TOWER_HEAD_W = 16;
    const poleParts = [], headParts = [];
    for (const deg of TOWER_DEG) {
      const ft = fenceFtAt(deg, fenceFt) + TOWER_EXTRA_FT;
      const p = polar(deg, ft);
      const pole = new THREE.CylinderGeometry(0.7, 0.9, TOWER_POLE_H, 8);
      pole.translate(p.x, TOWER_POLE_H / 2, -p.y);
      poleParts.push(pole);
      const head = new THREE.BoxGeometry(TOWER_HEAD_W, TOWER_HEAD_H, 2.4);
      // Angled down a little toward the infield, the way a real light bank tilts to aim at the field
      // rather than the sky - a flat box reads as a panel either way, but the tilt is what a real
      // tower's silhouette has that a vertical one does not.
      head.rotateX(-0.35);
      head.translate(p.x, TOWER_POLE_H + TOWER_HEAD_H * 0.4, -p.y);
      headParts.push(head);
    }
    const poleGeo = mergeGeometries(poleParts, false);
    const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.towerPole });
    group.add(new THREE.Mesh(poleGeo, poleMat)); track(poleGeo, poleMat);
    const headGeo = mergeGeometries(headParts, false);
    // Unlit, on purpose - a light fixture reading as LIT (a pale, glowing panel) rather than shaded
    // like an ordinary grey box is what makes it recognisable as a bank of lights from a distance.
    const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.towerHead });
    group.add(new THREE.Mesh(headGeo, headMat)); track(headGeo, headMat);
    for (const g of [...poleParts, ...headParts]) g.dispose();
  }

  // --- R9 item 4, R13-scaled: the centre-field scoreboard block - a dark body with a lit "screen"
  // panel set into its face, standing just past the centre-field fence (the spec's own "a
  // centre-field scoreboard block"). Two meshes (body, screen); the screen shares the tower head's
  // own unlit treatment for the same reason. `cfg.scoreboardScale` shrinks Little League's own
  // board (the spec's own "a small scoreboard") without a second, hand-duplicated shape.
  {
    const deg = 0;
    const ft = fenceFtAt(deg, fenceFt) + 22;
    const p = polar(deg, ft);
    const sc = cfg.scoreboardScale;
    const bodyW = 44 * sc, bodyH = 20 * sc, bodyD = 3 * sc;
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    bodyGeo.translate(p.x, bodyH / 2 + 2, -p.y);
    const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.scoreboardBody });
    group.add(new THREE.Mesh(bodyGeo, bodyMat)); track(bodyGeo, bodyMat);
    const screenGeo = new THREE.BoxGeometry(bodyW * 0.82, bodyH * 0.6, 0.3);
    // A hair in front of the body, toward home (the fence runs away from home along +radius, so
    // "toward home" from the board's own position is back along the SAME polar direction).
    const inward = polar(deg, ft - bodyD * 0.55 - 0.2);
    screenGeo.translate(inward.x, bodyH * 0.56 + 2, -inward.y);
    const screenMat = new THREE.MeshBasicMaterial({ color: PALETTE.scoreboardScreen });
    group.add(new THREE.Mesh(screenGeo, screenMat)); track(screenGeo, screenMat);
  }

  // --- R13 item 2: small aluminium bleacher SETS with spread-out parents (Little League/High
  // School only, `cfg.bleachers`) - behind the plate and down each line, built from
  // `bleacherUnitParts`/`placeBleacher`/`scatterParents` (this file's own helpers, above). One
  // merged mesh for every bleacher set's risers (they all share one shape and one material), and
  // one merged mesh PER PARENT COLOUR (`PALETTE.parents.length` of them) rather than one per person
  // - `scatterParents`'s own header has the reasoning.
  if (cfg.bleachers.length) {
    const unit = bleacherUnitParts(cfg.bleacherWidthFt, cfg.bleacherRows, BLEACHER_ROW_DEPTH_FT, BLEACHER_ROW_H_FT);
    const placements = cfg.bleachers.map((b) => {
      const p = polar(b.deg, b.r);
      return placeBleacher(unit, { x: p.x, z: -p.y }, 0, 0);
    });
    const riserParts = placements.flatMap((pl) => pl.parts);
    const riserGeo = mergeGeometries(riserParts, false);
    const riserMat = new THREE.MeshLambertMaterial({ color: PALETTE.bleacherAlum, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(riserGeo, riserMat)); track(riserGeo, riserMat);
    for (const g of riserParts) g.dispose();

    const totalParents = cfg.parentsPerBleacher * cfg.bleachers.length;
    const byColor = scatterParents(placements, totalParents, 20260922 + cfg.bleacherRows);
    for (let i = 0; i < byColor.length; i++) {
      const parts = byColor[i];
      if (!parts.length) continue;
      const geo = mergeGeometries(parts, false);
      const mat = new THREE.MeshLambertMaterial({ color: PALETTE.parents[i] });
      group.add(new THREE.Mesh(geo, mat)); track(geo, mat);
      for (const g of parts) g.dispose();
    }
  }

  // --- R13 item 2: Little League's own grass berm past the fence (`cfg.berm`) - a raised mound
  // instead of any stand, textured the same as the infield/outfield grass (a slightly darker green
  // so it still reads as its own, further-away surface) but on ONE sloped ramp
  // (`rampGeometry`), not a flat deck - the one non-flat piece of stadium geometry in this file.
  // Two real defects, both found by rendering and neither visible from the numbers alone:
  //   1. The ramp's NEAR edge starts at `FENCE.height + FENCE.railHeight` (the wall's own rail
  //      top), not the ground - starting it lower left most of the slope hidden BEHIND the wall
  //      itself from every camera (`scratchpad/r13/little-batter-BEFORE-berm-fix.png`), so nothing
  //      of that hidden run did any visual work; this way the WHOLE rise (`BERM_RISE_FT`) crests
  //      visibly above the wall.
  //   2. UNLIT (`MeshBasicMaterial`, was `MeshLambertMaterial`) - the same fix R9's own crowd faces
  //      already needed, for the identical reason (that PALETTE.standsFace comment, above): a
  //      near-vertical slope this size gets almost no light from the mostly-overhead sun, and
  //      `bermGrassA` (#3a7a36, already a dark green) under Lambert shading with that little light
  //      rendered as a solid BLACK band (`scratchpad/r13/berm-diagnostic-BROKEN-normal.png` - fixing
  //      the ramp's own vertex normal direction, below, was a real, separate defect but did not fix
  //      this: three.js's `DoubleSide` shading derives the effective normal from triangle winding
  //      at the fragment stage, not from a mismatched vertex normal, so no normal sign could have
  //      fixed a lighting-brightness problem). Background scenery that has to read correctly
  //      regardless of which way the sun happens to face is unlit everywhere else in this file
  //      (sky, both crowd tiers); the berm is the same kind of surface and now follows the same rule.
  // A THIRD defect, also found only by rendering: a `map` (`grassTexture()`) AND a `color` tint
  // together multiply (three.js's own convention), so `bermGrassA` (already a mid-brightness
  // green) times the grass texture's own mid-brightness greens compounded into something close to
  // BLACK all over again (measured: rendered pixel (8,70,6), against `bermGrassA` x `grassA`'s own
  // predicted (14,68,12) - the match that found it). The mowing-stripe texture does no visual work
  // at this size and distance anyway, so the fix is to drop it: a flat `bermGrassA` colour, no map.
  if (cfg.berm) {
    const bermInner = standsPoints(fenceFt, 1);
    const bermOuter = standsPoints(fenceFt, 1 + BERM_EXTRA_FT);
    const bermGeo = rampGeometry(bermInner, bermOuter, FENCE.height + FENCE.railHeight, FENCE.height + FENCE.railHeight + BERM_RISE_FT);
    const bermMat = new THREE.MeshBasicMaterial({ color: PALETTE.bermGrassA, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(bermGeo, bermMat)); track(bermGeo, bermMat);
  }

  // --- R13 item 2: High School's own press box (`cfg.pressBox`) - a small elevated booth behind
  // the backstop, a dark body with a lighter "window" band across its front (unlit, the same
  // "reads correctly regardless of the sun" convention every other panel in this file already
  // follows for a strip that has to read as glass rather than shaded plastic).
  if (cfg.pressBox) {
    const p = polar(180, PRESS_BOX_DIST_FT);
    const pos = { x: p.x, z: -p.y };
    const bodyGeo = new THREE.BoxGeometry(PRESS_BOX_W, PRESS_BOX_H, PRESS_BOX_D);
    bodyGeo.translate(pos.x, PRESS_BOX_Y + PRESS_BOX_H / 2, pos.z);
    const bodyMat = new THREE.MeshLambertMaterial({ color: PALETTE.pressBoxBody });
    group.add(new THREE.Mesh(bodyGeo, bodyMat)); track(bodyGeo, bodyMat);
    const winGeo = new THREE.BoxGeometry(PRESS_BOX_W * 0.86, PRESS_BOX_H * 0.4, 0.2);
    winGeo.translate(pos.x, PRESS_BOX_Y + PRESS_BOX_H * 0.66, pos.z - PRESS_BOX_D / 2 - 0.05);
    const winMat = new THREE.MeshBasicMaterial({ color: PALETTE.pressBoxWindow });
    group.add(new THREE.Mesh(winGeo, winMat)); track(winGeo, winMat);
  }

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
