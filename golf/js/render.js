// golf/js/render.js - three.js scene: terrain mesh, props, ball, flag, trail. See §10.1 of
// GOLF-HANDOFF.md. This module owns scene construction and one render(camera) call per frame;
// it does NOT own the requestAnimationFrame loop, the canvas element, or camera state - those
// belong to the caller (ui.js in Part 4, tools/preview.html here). The caller must: cancel its
// own rAF handle, call dispose() (which frees every geometry/material/texture and the WebGL
// context), then remove the canvas from the DOM - in that order, copied from Skeeball's
// render.js teardown.

import * as THREE from './vendor/three.module.min.js';
import { S, heightAt, buildTrees, makeValueNoise } from './terrain.js';

const BALL_R = 0.02134;
const CUP_R = 0.054;
const TRAIL_MAX = 45;

// Surface colours, by terrain.js's S code. Exported for minimap.js (Part 9A) so the map and the
// 3D ground can never disagree about what a surface looks like. ROUGH darkened to #3f6a2e in
// 9A so the fairway reads as the lighter corridor it is.
export const COL = { 0: '#5e7a45', 1: '#3f6a2e', 2: '#66a83f', 3: '#79b34a', 4: '#8fcf5a', 5: '#e6d3a0', 6: '#3d7fc6', 7: '#66a83f' };

// Sky (Part 9A): always daytime. Dark mode governs the HUD bands only - the course itself never
// goes night-blue, which is what made hole 1 read as "black sky over green paint" on a phone.
const SKY_TOP = '#7fb8ff';
const SKY_HORIZON = '#dceeff';
const SUN_DIR = new THREE.Vector3(-0.4, 1, 0.3).normalize();

// Same pattern as skeeball/js/machines/*/render.js: memoised once per page, never per Renderer,
// so probing does not itself leak a WebGL context.
let SOFT_GL = null;
function isSoftGL() {
  if (SOFT_GL !== null) return SOFT_GL;
  let soft = false;
  let probe = null;
  try {
    probe = document.createElement('canvas').getContext('webgl');
    const info = probe && probe.getExtension('WEBGL_debug_renderer_info');
    const name = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    soft = /swiftshader|software|llvmpipe/i.test(String(name));
  } catch { soft = false; }
  try {
    const lose = probe && probe.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { /* nothing to give back */ }
  SOFT_GL = soft;
  return soft;
}

export class Renderer {
  constructor(canvas, terrain) {
    this.terrain = terrain;
    this.scene = new THREE.Scene();
    this._disposables = [];
    this._lastBallPos = null;
    this._lastCamPos = null;
    this._aimLine = null;
    this._landingRing = null;

    const soft = isSoftGL();
    this.softGL = soft;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadow pass on demand, not every frame - the machine (course) is a still life for most of
    // a shot while the player lines up. render() below sets needsUpdate only when the ball or
    // camera moved.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    // Part 9A: distance reads through fog to the horizon colour; the sky sphere's own shader has
    // no fog chunk, so it is untouched.
    this.scene.fog = new THREE.Fog(0xdceeff, 180, 700);

    this._buildSky();
    this._buildSun();
    this._buildLights();
    this._buildTerrain();
    this._buildTrees();
    this._buildBall();
    this._buildTrail();
    this._buildFlag();
  }

  _track(x) { this._disposables.push(x); return x; }

  _buildSky() {
    const geo = this._track(new THREE.SphereGeometry(900, 24, 16));
    const mat = this._track(new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        bottom: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 bottom;
        varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, h), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    }));
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  // A soft sun disc: white radial-gradient sprite, radius 6 m at 400 m along the light
  // direction, additive so it glows into the sky rather than sitting on it. Sprites are always
  // camera-facing, so the disc reads round from every pose.
  _buildSun() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = this._track(new THREE.CanvasTexture(c));
    const mat = this._track(new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false,
    }));
    const sun = new THREE.Sprite(mat);
    sun.position.copy(SUN_DIR).multiplyScalar(400);
    sun.scale.set(12, 12, 1);   // 6 m radius
    sun.renderOrder = -1;
    this.scene.add(sun);
    this.sunDisc = sun;
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 0.7);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    const d = SUN_DIR.clone().multiplyScalar(300);
    dir.position.copy(d);
    dir.target.position.set(0, 0, 0);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const c = dir.shadow.camera;
    c.left = -260; c.right = 260; c.top = 260; c.bottom = -260; c.near = 1; c.far = 800;
    c.updateProjectionMatrix();
    this.scene.add(dir, dir.target);
    this.sun = dir;
  }

  // PlaneGeometry(nx-1, nz-1, nx-1, nz-1) rotated -PI/2 about x gives vertex index i+j*nx
  // (verified directly: local x is untouched by an x-rotation, and local y - which runs from
  // +height/2 at row 0 down to -height/2 at the last row - maps to world z = -local_y, so row
  // index increases monotonically with world z). Mesh position offsets the grid's local origin
  // (its own center) back to (x0, z0). Matches terrain.js's height[i + j*nx] convention exactly.
  _buildTerrain() {
    const t = this.terrain;
    const geo = new THREE.PlaneGeometry(t.nx - 1, t.nz - 1, t.nx - 1, t.nz - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const waterIdx = [];
    const tmp = new THREE.Color();
    // Part 9A: a low-frequency brightness noise (+-4%, 9 m wavelength, seeded) on rough and
    // fairway so the ground stops reading as flat paint. Seed offset 13 keeps it independent of
    // the height noise (seed, seed+1) and the tree draws (seed+7, seed+11).
    const groundNoise = makeValueNoise(t.def.seed + 13, 9);
    for (let j = 0; j < t.nz; j++) {
      for (let i = 0; i < t.nx; i++) {
        const idx = i + j * t.nx;
        pos.setY(idx, t.height[idx]);
        const s = t.surface[idx];
        tmp.set(COL[s] || COL[1]);
        if (s === S.GREEN) {
          tmp.multiplyScalar((Math.floor(j / 2) % 2 === 0) ? 1.06 : 0.94);
        } else if (s === S.FAIRWAY) {
          tmp.multiplyScalar((Math.floor((i + j) / 4) % 2 === 0) ? 1.06 : 0.94);
          tmp.multiplyScalar(1 + 0.04 * groundNoise(t.x0 + i, t.z0 + j));
        } else if (s === S.ROUGH) {
          tmp.multiplyScalar(1 + 0.04 * groundNoise(t.x0 + i, t.z0 + j));
        }
        colors[idx * 3] = tmp.r; colors[idx * 3 + 1] = tmp.g; colors[idx * 3 + 2] = tmp.b;
        if (s === S.WATER) waterIdx.push(idx);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(t.x0 + (t.nx - 1) / 2, 0, t.z0 + (t.nz - 1) / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._track(geo); this._track(mat);
    this.terrainMesh = mesh;

    this._buildWater(waterIdx);
  }

  // One flat blue plane per water CELL (not per polygon - the hole's water[] entries are
  // arbitrary polygons, but the grid already rasterized them into cells, so building from the
  // grid is exact and needs no re-triangulation), merged into one draw call.
  _buildWater(waterIdx) {
    if (!waterIdx.length) return;
    const t = this.terrain;
    const positions = [];
    const indices = [];
    let vi = 0;
    const h = 0.5;
    for (const idx of waterIdx) {
      const i = idx % t.nx, j = Math.floor(idx / t.nx);
      const wx = t.x0 + i, wz = t.z0 + j, wy = t.height[idx] + 1.0;
      positions.push(wx - h, wy, wz - h, wx + h, wy, wz - h, wx + h, wy, wz + h, wx - h, wy, wz + h);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x3d7fc6, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this._track(geo); this._track(mat);
    this.waterMesh = mesh;
  }

  _buildTrees() {
    const trees = buildTrees(this.terrain);
    if (!trees.length) return;
    // Part 9A: bigger trees (cone r 3.2 x h 9 on a 0.35 x 2.2 trunk, scale 0.9-1.4) so the
    // fairway belt terrain.js now plants reads as a tree line from the tee, not shrubs.
    const coneGeo = new THREE.ConeGeometry(3.2, 9, 6);
    const coneMat = new THREE.MeshLambertMaterial({ color: '#2f6b32' });
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.2, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#5c4326' });
    const coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, trees.length);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    coneMesh.castShadow = true;
    trunkMesh.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    trees.forEach((tr, idx) => {
      const s = tr.scale;
      m.compose(new THREE.Vector3(tr.x, tr.y + 1.1 * s, tr.z), q, new THREE.Vector3(s, s, s));
      trunkMesh.setMatrixAt(idx, m);
      m.compose(new THREE.Vector3(tr.x, tr.y + 2.2 * s + 4.5 * s, tr.z), q, new THREE.Vector3(s, s, s));
      coneMesh.setMatrixAt(idx, m);
    });
    this.scene.add(trunkMesh, coneMesh);
    this._track(coneGeo); this._track(coneMat); this._track(trunkGeo); this._track(trunkMat);
  }

  _buildBall() {
    const geo = new THREE.SphereGeometry(BALL_R * 3, 12, 12); // 3x true size so it's visible
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    this.ball = new THREE.Mesh(geo, mat);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this._track(geo); this._track(mat);
  }

  setBallPosition(x, y, z) { this.ball.position.set(x, y, z); }

  _buildTrail() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    this.trail = new THREE.Line(geo, mat);
    this.scene.add(this.trail);
    this._track(geo); this._track(mat);
  }

  // points: samples in flight order (oldest first); only the last TRAIL_MAX are drawn, fading
  // from grey (oldest) to white (newest) since LineBasicMaterial's vertexColors affects RGB
  // only, not per-vertex alpha - color fade is the "opacity fades along the line" the handoff
  // asks for.
  setTrail(points) {
    const geo = this.trail.geometry;
    const posAttr = geo.attributes.position;
    const colAttr = geo.attributes.color;
    const n = Math.min(points.length, TRAIL_MAX);
    const start = points.length - n;
    for (let k = 0; k < n; k++) {
      const p = points[start + k];
      posAttr.setXYZ(k, p.x, p.y, p.z);
      const f = n > 1 ? k / (n - 1) : 1;
      const c = 0.35 + 0.65 * f;
      colAttr.setXYZ(k, c, c, c);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.setDrawRange(0, n);
  }

  _buildFlag() {
    const pin = this.terrain.def.pin;
    const y = heightAt(this.terrain, pin[0], pin[1]);

    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.1);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(pin[0], y + 1.05, pin[1]);
    pole.castShadow = true;
    this.scene.add(pole);
    this._track(poleGeo); this._track(poleMat);

    const flagGeo = new THREE.PlaneGeometry(0.6, 0.4);
    const flagMat = new THREE.MeshStandardMaterial({ color: '#ffce3a', side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(pin[0] + 0.3, y + 1.9, pin[1]);
    this.scene.add(flag);
    this._track(flagGeo); this._track(flagMat);

    const cupGeo = new THREE.CircleGeometry(CUP_R);
    cupGeo.rotateX(-Math.PI / 2);
    const cupMat = new THREE.MeshBasicMaterial({ color: '#111111' });
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.position.set(pin[0], y + 0.002, pin[1]);
    this.scene.add(cup);
    this._track(cupGeo); this._track(cupMat);
  }

  // Aim line + landing ring for the address view (Part 9A). from: {x,z}, aimDeg: degrees
  // (0 = +z), distanceM: predicted carry along that bearing (the ring sits there); the line runs
  // 200 m regardless. Pass null to hide both.
  //
  // The line is a RIBBON quad strip hugging the terrain, not a THREE.Line: WebGL ignores
  // lineWidth on every mobile GPU, so a Line is always one hairline pixel. A ribbon has real
  // width in the world (0.14 m, ~2 px where it matters, near the ball) and thins with distance,
  // which is what the eye expects of a line on the ground.
  setAimTarget(from, aimDeg, distanceM) {
    this._clearAimTarget();
    if (from == null) return;
    const rad = aimDeg * Math.PI / 180;
    const dirX = Math.sin(rad), dirZ = Math.cos(rad);
    const LINE_M = 200, STEP = 2, HALF_W = 0.07, LIFT = 0.06;
    const nx = -dirZ, nz = dirX;   // lateral unit
    const positions = [];
    const indices = [];
    const n = Math.floor(LINE_M / STEP) + 1;
    for (let k = 0; k < n; k++) {
      const d = k * STEP;
      const px = from.x + dirX * d, pz = from.z + dirZ * d;
      const py = heightAt(this.terrain, px, pz) + LIFT;
      positions.push(px + nx * HALF_W, py, pz + nz * HALF_W, px - nx * HALF_W, py, pz - nz * HALF_W);
      if (k > 0) {
        const b = k * 2;
        indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    lineGeo.setIndex(indices);
    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const line = new THREE.Mesh(lineGeo, lineMat);
    this.scene.add(line);
    this._aimLine = { obj: line, geo: lineGeo, mat: lineMat };

    const toX = from.x + dirX * distanceM, toZ = from.z + dirZ * distanceM;
    const y1 = heightAt(this.terrain, toX, toZ) + 0.05;
    const ringGeo = new THREE.RingGeometry(2.0, 2.6, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffce3a', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(toX, y1 + 0.01, toZ);
    this.scene.add(ring);
    this._landingRing = { obj: ring, geo: ringGeo, mat: ringMat };
  }

  _clearAimTarget() {
    if (this._aimLine) {
      this.scene.remove(this._aimLine.obj);
      this._aimLine.geo.dispose(); this._aimLine.mat.dispose();
      this._aimLine = null;
    }
    if (this._landingRing) {
      this.scene.remove(this._landingRing.obj);
      this._landingRing.geo.dispose(); this._landingRing.mat.dispose();
      this._landingRing = null;
    }
  }

  resize(w, h, camera) {
    this.renderer.setSize(w, h, true);
    if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  // Draws one frame. Shadow pass only re-runs when the ball or camera moved > 0.01m since the
  // last call, per §10.1.
  render(camera) {
    const bp = this.ball.position;
    const cp = camera.position;
    let moved = false;
    if (!this._lastBallPos || bp.distanceTo(this._lastBallPos) > 0.01) moved = true;
    if (!this._lastCamPos || cp.distanceTo(this._lastCamPos) > 0.01) moved = true;
    if (moved) this.renderer.shadowMap.needsUpdate = true;
    this._lastBallPos = bp.clone();
    this._lastCamPos = cp.clone();
    this.renderer.render(this.scene, camera);
  }

  // Frees every geometry/material/texture this Renderer created, then hands back the WebGL
  // context. Does NOT cancel a rAF handle or remove the canvas - the caller owns both.
  dispose() {
    this._clearAimTarget();
    for (const d of this._disposables) { if (d && d.dispose) d.dispose(); }
    this._disposables.length = 0;
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
