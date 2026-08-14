// frame.mjs - IS THE WHOLE MACHINE ON SCREEN?
//
// Bullet 1 of the 2026-08-14 play review, in Matt's words: "The board is massive and it's crazy
// zoomed in." You should be looking at a skeeball cabinet and seeing the whole thing, the way
// you would standing in front of one.
//
// This projects the machine's outermost points through the camera and reports where each lands.
// Every one has to be inside the frame with room to spare. Pure geometry plus three.js's camera
// maths; no WebGL, so it runs in node.
//
// Before the fix: the machine covered 125% of screen height - marquee and backboard entirely
// above the top edge, board's own bottom corners off both sides.
//
// CAUTION: this file MIRRORS render.js's camera setup (constructor position/lookAt + resize()'s
// FOV rule). It is a copy, so it can drift. If you change the camera in render.js, change it
// here too; the mirrored blocks are marked.
import * as THREE from './skeeball/js/vendor/three.module.min.js';
import { buildMachine } from './skeeball/js/machine.js';
import { BOARDS } from './skeeball/js/boards.js';

// A phone, portrait. The tightest case: a tall narrow frame has the least horizontal room.
const W = 402, H = 874;
const FIT_MARGIN = 0.90;   // must match render.js resize()'s MARGIN
const MARGIN = 0.92;       // what this test ASSERTS - deliberately looser, see render.js

const G = BOARDS[0].geom;
const M = buildMachine(G);

const topY = M.faceToWorld(0, G.boardLen, 0)[1];
const topZ = M.faceToWorld(0, G.boardLen, 0)[2];
const halfW = G.boardW / 2;

/** The points that must always be visible. Mirrors resize()'s FIT list. */
const FIT = [
  ['marquee top',        [0, topY + G.backboardH + 0.21, topZ - 0.02]],
  ['backboard top L',    [-halfW, topY + G.backboardH - 0.01, topZ - 0.02]],
  ['backboard top R',    [halfW, topY + G.backboardH - 0.01, topZ - 0.02]],
  ['board top-left',     M.faceToWorld(-halfW, G.boardLen, 0)],
  ['board top-right',    M.faceToWorld(halfW, G.boardLen, 0)],
  ['board bottom-left',  M.faceToWorld(-halfW, 0, 0)],
  ['board bottom-right', M.faceToWorld(halfW, 0, 0)],
  ['ball at rest',       [0, G.ballR, -0.12]],
  ['lane near end',      [0, 0, -0.02]],
];

// --- mirror of render.js's camera (constructor) ----------------------------------------------
const camera = new THREE.PerspectiveCamera(44, W / H, 0.05, 12);
camera.position.set(0, 0.50, 1.20);
{
  const a = M.faceToWorld(0, G.boardLen * 0.20, 0);
  camera.lookAt(a[0], a[1], a[2]);
}
camera.updateMatrixWorld(true);

// --- mirror of render.js's resize() FOV rule -------------------------------------------------
{
  const eye = camera.position;
  const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  let needV = 0, needHalfH = 0;
  for (const [, p] of FIT) {
    const d = new THREE.Vector3(p[0], p[1], p[2]).sub(eye);
    const along = d.dot(axis);
    if (along <= 0.01) continue;
    needV = Math.max(needV, Math.atan(Math.abs(d.dot(up)) / along / FIT_MARGIN));
    needHalfH = Math.max(needHalfH, Math.atan(Math.abs(d.dot(right)) / along / FIT_MARGIN));
  }
  const vFov = Math.max(2 * needV, 2 * Math.atan(Math.tan(needHalfH) / camera.aspect));
  camera.fov = Math.min(72, Math.max(30, (vFov * 180) / Math.PI));
  camera.updateProjectionMatrix();
}

// --- the check --------------------------------------------------------------------------------
console.log(`=== WHOLE MACHINE IN FRAME?  (${W}x${H} portrait, fov ${camera.fov.toFixed(1)}) ===`);
console.log(`camera at y=${camera.position.y} z=${camera.position.z}\n`);

let worstX = 0, worstY = 0, fails = 0;
for (const [name, p] of FIT) {
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
  const px = ((v.x + 1) / 2) * W;
  const py = ((1 - v.y) / 2) * H;
  const inFrame = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  const roomy = Math.abs(v.x) <= MARGIN && Math.abs(v.y) <= MARGIN;
  worstX = Math.max(worstX, Math.abs(v.x));
  worstY = Math.max(worstY, Math.abs(v.y));
  if (!roomy) fails++;
  const tag = roomy ? 'ok' : inFrame ? 'TIGHT (at the bezel)' : '** OFF SCREEN **';
  console.log(
    `  ${name.padEnd(20)} screen ${String(Math.round(px)).padStart(5)},${String(Math.round(py)).padStart(6)}` +
    `   ndc ${v.x.toFixed(2).padStart(6)},${v.y.toFixed(2).padStart(6)}   ${tag}`
  );
}

// How much of the screen's height does the machine actually occupy, marquee down to the lane?
const ndcY = (p) => new THREE.Vector3(p[0], p[1], p[2]).project(camera).y;
const coverage = Math.abs(ndcY(FIT[0][1]) - ndcY(FIT[8][1])) / 2;

console.log(`\n  machine covers ${(coverage * 100).toFixed(0)}% of screen height`);
console.log(`  worst |x| ${worstX.toFixed(2)}   worst |y| ${worstY.toFixed(2)}   (must be <= ${MARGIN})`);
console.log(fails === 0
  ? `\n  PASS - whole machine in frame with room to spare\n`
  : `\n  FAIL - ${fails} point(s) cut off or jammed against the edge\n`);

process.exit(fails === 0 ? 0 : 1);
