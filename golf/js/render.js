// golf/js/render.js - three.js scene: terrain mesh, props, ball, flag, trail. See §10.1 of
// GOLF-HANDOFF.md. This module owns scene construction and one render(camera) call per frame;
// it does NOT own the requestAnimationFrame loop, the canvas element, or camera state - those
// belong to the caller (ui.js in Part 4, tools/preview.html here). The caller must: cancel its
// own rAF handle, call dispose() (which frees every geometry/material/texture and the WebGL
// context), then remove the canvas from the DOM - in that order, copied from Skeeball's
// render.js teardown.

import * as THREE from './vendor/three.module.min.js';
import { S, heightAt, buildTrees } from './terrain.js';
import { onThemeChange } from '../../js/theme.js';

const BALL_R = 0.02134;
const CUP_R = 0.054;
const TRAIL_MAX = 45;

const COL = { 0: '#5e7a45', 1: '#4f7a3a', 2: '#66a83f', 3: '#79b34a', 4: '#8fcf5a', 5: '#e6d3a0', 6: '#3d7fc6', 7: '#66a83f' };

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

function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('gh-dark');
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

    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildTrees();
    this._buildBall();
    this._buildTrail();
    this._buildFlag();

    this._offTheme = onThemeChange(() => this._updateSkyColors());
  }

  _track(x) { this._disposables.push(x); return x; }

  _buildSky() {
    const geo = this._track(new THREE.SphereGeometry(900, 24, 16));
    const dark = isDarkMode();
    const mat = this._track(new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(dark ? '#0b1a33' : '#9fd0ff') },
        bottom: { value: new THREE.Color(dark ? '#243b66' : '#e9f3ff') },
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

  _updateSkyColors() {
    const dark = isDarkMode();
    this.sky.material.uniforms.top.value.set(dark ? '#0b1a33' : '#9fd0ff');
    this.sky.material.uniforms.bottom.value.set(dark ? '#243b66' : '#e9f3ff');
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 0.55);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    const d = new THREE.Vector3(-0.4, 1, 0.3).normalize().multiplyScalar(300);
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
    for (let j = 0; j < t.nz; j++) {
      for (let i = 0; i < t.nx; i++) {
        const idx = i + j * t.nx;
        pos.setY(idx, t.height[idx]);
        const s = t.surface[idx];
        tmp.set(COL[s] || COL[1]);
        if (s === S.GREEN) {
          tmp.multiplyScalar((Math.floor(j / 2) % 2 === 0) ? 1.06 : 0.94);
        } else if (s === S.FAIRWAY) {
          tmp.multiplyScalar((Math.floor((i + j) / 4) % 2 === 0) ? 1.03 : 0.97);
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
    const coneGeo = new THREE.ConeGeometry(2.2, 6, 6);
    const coneMat = new THREE.MeshLambertMaterial({ color: '#2f6b32' });
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.6, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#5c4326' });
    const coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, trees.length);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    coneMesh.castShadow = true;
    trunkMesh.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    trees.forEach((tr, idx) => {
      const s = tr.scale;
      m.compose(new THREE.Vector3(tr.x, tr.y + 0.8 * s, tr.z), q, new THREE.Vector3(s, s, s));
      trunkMesh.setMatrixAt(idx, m);
      m.compose(new THREE.Vector3(tr.x, tr.y + 1.6 * s + 3 * s, tr.z), q, new THREE.Vector3(s, s, s));
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

  // Dashed target line + landing ring for the address view. from: {x,z}, aimDeg: degrees
  // (0 = +z), distanceM: predicted carry along that bearing. Pass null to hide both.
  setAimTarget(from, aimDeg, distanceM) {
    this._clearAimTarget();
    if (from == null) return;
    const rad = aimDeg * Math.PI / 180;
    const dirX = Math.sin(rad), dirZ = Math.cos(rad);
    const toX = from.x + dirX * distanceM, toZ = from.z + dirZ * distanceM;
    const y0 = heightAt(this.terrain, from.x, from.z) + 0.05;
    const y1 = heightAt(this.terrain, toX, toZ) + 0.05;

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, y0, from.z), new THREE.Vector3(toX, y1, toZ),
    ]);
    const lineMat = new THREE.LineDashedMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, dashSize: 1, gapSize: 0.6 });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    this.scene.add(line);
    this._aimLine = { obj: line, geo: lineGeo, mat: lineMat };

    const ringGeo = new THREE.RingGeometry(1.5, 1.9, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, side: THREE.DoubleSide });
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
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    this._clearAimTarget();
    for (const d of this._disposables) { if (d && d.dispose) d.dispose(); }
    this._disposables.length = 0;
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
