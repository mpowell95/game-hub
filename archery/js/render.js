// archery/js/render.js - the range on screen, three.js. Everything here is drawn from code (no
// images, no models): a stadium with a crowd, a striped grass lane with white lines, a target on a
// wooden easel, and the arrows. The bow and the arm are NOT here: they are an SVG in ui.js, laid
// over this canvas, because they move with the finger and a DOM transform is the cheapest way to
// keep the sight's ring exactly over the magnified view drawn here.
//
// THREE CAMERAS, as in the recording (docs/ARCHERY-BRIEF.md section 2):
//   'line'  - the shooter's eye on the line, the target small and far off;
//   'chase' - behind the arrow in flight, stopping a few metres short of the target;
//   'close' - a few metres in front of the target, a little to the left, for the hit and the replay.
// Plus the SIGHT: while drawing, a narrow camera looks at the aim point and is drawn into a disc
// under the sight's ring (setScope). The point under the sight's crosshair IS the aim.
//
// Same rules as cup-pong/js/render.js (skeeball/MACHINE-SPEC.md Part 7): the renderer lives in
// `this.renderer`, the software-GL probe is memoised and releases its context, every texture is
// disposed with its material.
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
import { BOSS } from './engine.js';

let _softGL = null;
function isSoftGL() {
  if (_softGL !== null) return _softGL;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) { _softGL = true; return _softGL; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    _softGL = /swiftshader|llvmpipe|software/i.test(name);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { _softGL = true; }
  return _softGL;
}

/** The target: its middle, the face's radius (m), and where the line camera stands. */
export const TARGET = { x: 0, y: 1.3, z: -30, face: 0.61 };
const EYE = new THREE.Vector3(0, 1.62, 0);
const FACE_Z = TARGET.z + 0.09;                 // the front of the boss
export const ARROW_COLORS = { me: '#1f6fe5', them: '#e0362b', plain: '#f0c419' };
const FLIGHT_T = 0.75;                          // seconds, measured off the recording
export { FLIGHT_T };

const LOOK = {
  grassA: '#3fa83a', grassB: '#4bb945', line: '#ffffff', wall: '#1d5fb8', wallTop: '#3b86e0',
  seat: '#1c3f78', wood: '#9a6a3a', woodDark: '#6d4724', boss: '#f4f2ec',
  ring: ['#f6f6f4', '#f6f6f4', '#202020', '#202020', '#2ea7e8', '#2ea7e8', '#e8342b', '#e8342b', '#ffd21f', '#ffd21f'],
};

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.soft = isSoftGL() && !(typeof window !== 'undefined' && window.__arHardGL);
    this.reduced = reducedMotion;
    this._tex = []; this._geo = []; this._mat = [];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.soft, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(this.soft ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(56, 1, 0.05, 400);
    this.zoomCam = new THREE.PerspectiveCamera(4.2, 1, 1, 400);
    this.rt = new THREE.WebGLRenderTarget(384, 384);
    this.hud = new THREE.Scene();
    this.hudCam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    this.scopeDisc = new THREE.Mesh(this._g(new THREE.CircleGeometry(1, 64)), this._m(new THREE.MeshBasicMaterial({ map: this.rt.texture })));
    this.scopeDisc.visible = false;
    this.hud.add(this.scopeDisc);
    this.stuck = new THREE.Group();
    this.loose = new THREE.Group();             // the arrow in flight, a replay arrow coming in
    this.w = 0; this.h = 0;
    this.view = 'line';
    this._build();
    this.scene.add(this.stuck, this.loose);
    this.setView('line');
  }

  // --- bookkeeping: everything made here is freed in dispose() --------------------------------
  _g(g) { this._geo.push(g); return g; }
  _m(m) { this._mat.push(m); return m; }
  _canvasTex(w, h, paint, repeat) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(...repeat); }
    this._tex.push(tex);
    return tex;
  }

  // --- the range ---------------------------------------------------------------------------------
  _build() {
    const S = this.scene;
    S.background = this._canvasTex(4, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#3f8fe0'); g.addColorStop(0.55, '#8cc4f2'); g.addColorStop(1, '#dff0fc');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    S.fog = new THREE.Fog('#cfe6f8', 90, 260);
    S.add(new THREE.HemisphereLight(0xffffff, 0x5f8a45, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-30, 60, 25);
    S.add(sun);

    // Grass: wide mowing bands across the lane, a finer check on top.
    const grass = this._canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = LOOK.grassA; c.fillRect(0, 0, w, h);
      c.fillStyle = LOOK.grassB; c.fillRect(0, 0, w, h / 2);
      for (let i = 0; i < 2600; i++) {
        c.fillStyle = `rgba(${20 + Math.random() * 40},${90 + Math.random() * 70},${20 + Math.random() * 30},0.35)`;
        c.fillRect(Math.random() * w, Math.random() * h, 1.5, 3);
      }
    }, [24, 50]);
    const ground = new THREE.Mesh(this._g(new THREE.PlaneGeometry(240, 300)), this._m(new THREE.MeshLambertMaterial({ map: grass })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -100);
    S.add(ground);

    // White lane lines, converging on the target.
    const lineMat = this._m(new THREE.MeshBasicMaterial({ color: LOOK.line }));
    const addLine = (x0, z0, x1, z1, wide = 0.09) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(this._g(new THREE.PlaneGeometry(wide, len)), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(x1 - x0, -(z1 - z0));
      m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
      S.add(m);
    };
    addLine(0, 2, 0, TARGET.z + 0.5);
    for (const x of [2.4, 4.8, 7.2]) { addLine(x, 2, x, TARGET.z - 1); addLine(-x, 2, -x, TARGET.z - 1); }
    addLine(-9, -1.1, 9, -1.1, 0.12);                      // the shooting line
    addLine(-1.6, 3, 0, -0.2, 0.08); addLine(1.6, 3, 0, -0.2, 0.08);   // the V at your feet

    // The blue barrier behind the target, and the stands behind that.
    const wall = new THREE.Mesh(this._g(new THREE.BoxGeometry(200, 1.3, 0.4)), this._m(new THREE.MeshLambertMaterial({ color: LOOK.wall })));
    wall.position.set(0, 0.65, -36);
    S.add(wall);
    const wallTop = new THREE.Mesh(this._g(new THREE.BoxGeometry(200, 0.12, 0.42)), this._m(new THREE.MeshLambertMaterial({ color: LOOK.wallTop })));
    wallTop.position.set(0, 1.32, -36);
    S.add(wallTop);
    const board = new THREE.Mesh(this._g(new THREE.BoxGeometry(6, 2.4, 0.5)), this._m(new THREE.MeshLambertMaterial({ color: '#2a6fc4' })));
    board.position.set(9, 1.2, -35.5);
    S.add(board);

    // The stands: a slope of seats and people from the barrier up and back, then sky, then the
    // roof's glass canopy across the top of the picture (the recording's framing).
    const crowd = this._canvasTex(512, 256, (c, w, h) => paintCrowd(c, w, h), [22, 6]);
    const y0 = 1.4, z0 = -36.5, y1 = 16, z1 = -62;
    const len = Math.hypot(y1 - y0, z1 - z0);
    const stand = new THREE.Mesh(this._g(new THREE.PlaneGeometry(220, len)), this._m(new THREE.MeshLambertMaterial({ map: crowd })));
    stand.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
    stand.rotation.x = -Math.atan2(z0 - z1, y1 - y0);
    S.add(stand);
    // Stairways down the stands.
    const aisleMat = this._m(new THREE.MeshLambertMaterial({ color: '#7d8796', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    for (const x of [-46, -22, 2, 26, 50]) {
      const a = new THREE.Mesh(this._g(new THREE.PlaneGeometry(0.7, len)), aisleMat);
      a.position.set(x, stand.position.y, stand.position.z);
      a.rotation.copy(stand.rotation);
      S.add(a);
    }
    // The back wall of the stand, where the seats stop.
    const back = new THREE.Mesh(this._g(new THREE.BoxGeometry(220, 2.4, 0.6)), this._m(new THREE.MeshLambertMaterial({ color: '#e8edf2' })));
    back.position.set(0, y1 + 1.1, z1 - 0.3);
    S.add(back);
    // The roof: a white lattice of glass, unlit so it reads bright from below.
    const lattice = this._canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#dfe9f2'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(150, 190, 225, 0.55)';
      for (let i = 0; i < w; i += 64) for (let j = 0; j < h; j += 32) c.fillRect(i + 5, j + 4, 54, 24);
      c.strokeStyle = '#ffffff'; c.lineWidth = 5;
      for (let i = 0; i <= w; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); }
      c.lineWidth = 2.5; c.strokeStyle = '#f4f7fa';
      for (let i = -h; i <= w + h; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h * 0.6, h); c.stroke(); }
    }, [30, 5]);
    const roofGeo = this._g(new THREE.PlaneGeometry(260, 50));
    const roof = new THREE.Mesh(roofGeo, this._m(new THREE.MeshBasicMaterial({ map: lattice, side: THREE.DoubleSide, fog: false })));
    // From 21 m up at 30 m out to 25 m up at 75 m out: the top tenth of the line camera's picture.
    roof.position.set(0, 23, -52.5);
    roof.rotation.x = Math.PI / 2 + Math.atan2(4, 45);
    S.add(roof);
    const beamMat = this._m(new THREE.MeshBasicMaterial({ color: '#f5f7fa', fog: false }));
    for (const x of [-60, -30, 0, 30, 60]) {
      const beam = new THREE.Mesh(this._g(new THREE.BoxGeometry(0.8, 0.8, 50)), beamMat);
      beam.position.set(x, 22.6, -52.5);
      beam.rotation.x = Math.atan2(4, 45);
      S.add(beam);
    }

    this._buildTarget();
  }

  _buildTarget() {
    const S = this.scene;
    const T = TARGET;
    const g = new THREE.Group();
    // The boss: a white square board with a dark edge.
    const bossSide = T.face * BOSS * 2 * 1.04;
    const boss = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide, bossSide, 0.16)), this._m(new THREE.MeshLambertMaterial({ color: LOOK.boss })));
    boss.position.set(T.x, T.y, T.z);
    g.add(boss);
    const edge = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide + 0.05, bossSide + 0.05, 0.12)), this._m(new THREE.MeshLambertMaterial({ color: '#3a3a3a' })));
    edge.position.set(T.x, T.y, T.z - 0.03);
    g.add(edge);
    // The face: ten rings, painted.
    const face = this._canvasTex(1024, 1024, (c, w) => {
      const cx = w / 2, R = w / 2 - 2;
      c.fillStyle = '#f4f2ec'; c.fillRect(0, 0, w, w);
      for (let i = 0; i < 10; i++) {
        const r = R * (1 - i / 10);
        c.beginPath(); c.arc(cx, cx, r, 0, Math.PI * 2); c.fillStyle = LOOK.ring[i]; c.fill();
        c.lineWidth = 3; c.strokeStyle = i === 2 || i === 3 ? '#cfcfcf' : '#1a1a1a'; c.stroke();
      }
      c.beginPath(); c.arc(cx, cx, R * 0.05, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = '#1a1a1a'; c.stroke();
      c.strokeStyle = '#1a1a1a'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 10, cx); c.lineTo(cx + 10, cx); c.moveTo(cx, cx - 10); c.lineTo(cx, cx + 10); c.stroke();
      c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#1a1a1a';
      for (let i = 1; i <= 8; i++) {
        const r = R * (1 - (i - 0.5) / 10);
        const ink = i >= 3 && i <= 4 ? '#ffffff' : '#1a1a1a';
        c.fillStyle = ink;
        c.fillText(String(i), cx + r, cx + 8);
      }
    });
    const faceMesh = new THREE.Mesh(this._g(new THREE.CircleGeometry(T.face, 96)), this._m(new THREE.MeshLambertMaterial({ map: face })));
    faceMesh.position.set(T.x, T.y, FACE_Z);
    g.add(faceMesh);
    // The wooden easel: two front legs, two back legs, a ledge under the board.
    const wood = this._m(new THREE.MeshLambertMaterial({ color: LOOK.wood }));
    const woodDark = this._m(new THREE.MeshLambertMaterial({ color: LOOK.woodDark }));
    const leg = (x, zTop, zBot, mat) => {
      const top = new THREE.Vector3(T.x + x, T.y + bossSide * 0.42, T.z + zTop);
      const bot = new THREE.Vector3(T.x + x * 1.05, 0, T.z + zBot);
      const len = top.distanceTo(bot);
      const m = new THREE.Mesh(this._g(new THREE.BoxGeometry(0.09, len, 0.09)), mat);
      m.position.copy(top).add(bot).multiplyScalar(0.5);
      m.lookAt(top);
      m.rotateX(Math.PI / 2);
      g.add(m);
    };
    leg(-bossSide * 0.36, 0.12, 0.42, wood); leg(bossSide * 0.36, 0.12, 0.42, wood);
    leg(-bossSide * 0.3, -0.12, -0.9, woodDark); leg(bossSide * 0.3, -0.12, -0.9, woodDark);
    const ledge = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide * 0.95, 0.07, 0.24)), wood);
    ledge.position.set(T.x, T.y - bossSide / 2 - 0.04, T.z + 0.1);
    g.add(ledge);
    // A soft shadow on the grass.
    const shadowTex = this._canvasTex(128, 128, (c, w) => {
      const gr = c.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, w);
    });
    const shadow = new THREE.Mesh(this._g(new THREE.PlaneGeometry(2.6, 1.6)), this._m(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(T.x + 0.3, 0.02, T.z - 0.2);
    g.add(shadow);
    S.add(g);
  }

  // --- arrows ------------------------------------------------------------------------------------
  /** An arrow pointing along -z with its tip at the origin. */
  _arrow(color) {
    const g = new THREE.Group();
    const L = 0.82, r = 0.011;
    const shaftMat = this._m(new THREE.MeshLambertMaterial({ color }));
    const shaft = new THREE.Mesh(this._g(new THREE.CylinderGeometry(r, r, L, 10)), shaftMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = L / 2;
    g.add(shaft);
    const tip = new THREE.Mesh(this._g(new THREE.ConeGeometry(r * 1.6, 0.06, 10)), this._m(new THREE.MeshLambertMaterial({ color: '#d8dde3' })));
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.01;
    g.add(tip);
    const nock = new THREE.Mesh(this._g(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.05, 8)), this._m(new THREE.MeshLambertMaterial({ color: '#1b1b1b' })));
    nock.rotation.x = Math.PI / 2;
    nock.position.z = L + 0.02;
    g.add(nock);
    const vaneShape = new THREE.Shape();
    vaneShape.moveTo(0, 0); vaneShape.lineTo(0.13, 0); vaneShape.lineTo(0.13, 0.045); vaneShape.quadraticCurveTo(0.05, 0.04, 0, 0.012); vaneShape.lineTo(0, 0);
    const vaneGeo = this._g(new THREE.ShapeGeometry(vaneShape));
    const vaneMats = [this._m(new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide })), this._m(new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }))];
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(vaneGeo, vaneMats[i === 0 ? 1 : 0]);
      const holder = new THREE.Group();
      v.rotation.y = -Math.PI / 2;
      v.position.set(0, r, L - 0.16);
      holder.add(v);
      holder.rotation.z = (i * 2 * Math.PI) / 3;
      g.add(holder);
    }
    return g;
  }

  /** A face point (face radii, y up) as a world point on the face. */
  facePoint(x, y, z = FACE_Z) { return new THREE.Vector3(TARGET.x + x * TARGET.face, TARGET.y + y * TARGET.face, z); }

  /** The arrows in the target: [{ x, y, color, dir? }]. One beyond the boss is not drawn. */
  setStuck(list) {
    this.stuck.clear();
    for (const a of list || []) {
      if (Math.max(Math.abs(a.x), Math.abs(a.y)) > BOSS) continue;
      const m = this._arrow(a.color);
      const tip = this.facePoint(a.x, a.y, FACE_Z - 0.05);
      const dir = a.dir ? a.dir.clone().normalize() : new THREE.Vector3(-0.05 + (a.x * 0.02), -0.04, -1).normalize();
      m.position.copy(tip);
      m.lookAt(tip.clone().sub(dir));             // +z (the shaft) points back the way it came
      this.stuck.add(m);
    }
  }

  // --- views -------------------------------------------------------------------------------------
  layout(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    // Portrait: a taller field of view so the lane and the stands both show.
    this.cam.fov = w / h < 0.7 ? 56 : 44;
    this.cam.updateProjectionMatrix();
    this.hudCam.left = 0; this.hudCam.right = w; this.hudCam.top = 0; this.hudCam.bottom = -h;
    this.hudCam.updateProjectionMatrix();
    if (this.view === 'line') this.setView('line');
  }

  setView(view) {
    this.view = view;
    const T = TARGET;
    if (view === 'line') {
      this.cam.position.copy(EYE);
      // The target sits a little above the middle of the screen, as in the recording.
      this.cam.lookAt(T.x, T.y - 2.2, T.z);
    } else if (view === 'close') {
      this.cam.position.set(T.x - 0.95, T.y + 0.05, T.z + 3.7);
      this.cam.lookAt(T.x + 0.14, T.y - 0.12, T.z);
    }
  }

  /** A world point on screen (CSS px), from the current camera. */
  toScreen(v) {
    const p = v.clone().project(this.cam);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 };
  }
  faceToScreen(x, y) { return this.toScreen(this.facePoint(x, y)); }
  /** How many CSS px one face radius is from the shooting line. */
  pxPerR() {
    const a = this.faceToScreen(0, 0), b = this.faceToScreen(1, 0);
    return Math.max(1, b.x - a.x);
  }

  /** The sight's magnified view: a disc at (x, y) of radius r (CSS px) showing the face point
   *  (ax, ay). null hides it. */
  setScope(s) {
    if (!s) { this.scopeDisc.visible = false; this._scope = null; return; }
    this._scope = s;
    this.scopeDisc.visible = true;
    this.scopeDisc.position.set(s.x, -s.y, 0);
    this.scopeDisc.scale.set(s.r, s.r, 1);
  }

  // --- the arrow in flight ----------------------------------------------------------------------
  /** Start a shot: from the bow (just under the eye) at the aim point, landing at `hit` (face
   *  radii). `color`: the arrow's. */
  startFlight(aim, hit, color) {
    this.loose.clear();
    const S0 = EYE.clone().add(new THREE.Vector3(0.06, -0.14, -0.9));
    const A = this.facePoint(aim.x, aim.y);
    const H = this.facePoint(hit.x, hit.y, FACE_Z - 0.05);
    const arrow = this._arrow(color);
    this.loose.add(arrow);
    this.flight = { S0, A, H, arrow, u: 0 };
    this.setFlight(0);
  }
  _pathAt(u) {
    const f = this.flight;
    const p = f.S0.clone().add(f.A.clone().sub(f.S0).multiplyScalar(u)).add(f.H.clone().sub(f.A).multiplyScalar(u * u));
    p.y += 0.45 * Math.sin(Math.PI * u);
    return p;
  }
  /** The flight at u (0..1): the arrow along its path, the camera chasing it. */
  setFlight(u) {
    const f = this.flight;
    if (!f) return;
    u = Math.max(0, Math.min(1, u));
    f.u = u;
    const p = this._pathAt(u);
    const q = this._pathAt(Math.min(1, u + 0.01));
    const dir = q.clone().sub(p);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, -1);
    dir.normalize();
    f.arrow.position.copy(p);
    f.arrow.lookAt(p.clone().sub(dir));
    f.dir = dir;
    // The camera rides behind the whole arrow (it is 0.82 m long) and a touch above, and stops
    // 4.5 m short of the target.
    const cam = p.clone().sub(dir.clone().multiplyScalar(1.45)).add(new THREE.Vector3(0.05, 0.14, 0));
    cam.z = Math.max(cam.z, TARGET.z + 4.5);
    this.view = 'chase';
    this.cam.position.copy(cam);
    this.cam.lookAt(p.clone().add(dir.clone().multiplyScalar(2.5)));
  }
  /** The direction the flight arrived from (for its stuck arrow). */
  flightDir() { return this.flight && this.flight.dir ? this.flight.dir.clone() : null; }
  endFlight() { this.loose.clear(); this.flight = null; }

  /** A replay arrow coming in to the close-up at `hit` (face radii), u 0..1. */
  setIncoming(hit, color, u) {
    if (!this._incoming || this._incoming.color !== color) {
      this.loose.clear();
      this._incoming = { arrow: this._arrow(color), color };
      this.loose.add(this._incoming.arrow);
    }
    const H = this.facePoint(hit.x, hit.y, FACE_Z - 0.05);
    const from = H.clone().add(new THREE.Vector3(0.4, 0.22, 3.4));
    const p = from.clone().lerp(H, Math.max(0, Math.min(1, u)));
    const dir = H.clone().sub(from).normalize();
    const a = this._incoming.arrow;
    a.position.copy(p);
    a.lookAt(p.clone().sub(dir));
    this._incomingDir = dir;
  }
  incomingDir() { return this._incomingDir ? this._incomingDir.clone() : null; }
  clearIncoming() { this.loose.clear(); this._incoming = null; }

  // --- a frame -------------------------------------------------------------------------------------
  render() {
    if (!this.w || !this.h) return;
    const r = this.renderer;
    const s = this._scope;
    if (s && this.view === 'line') {
      this.zoomCam.position.copy(this.cam.position);
      const P = this.facePoint(s.ax, s.ay);
      const dist = this.cam.position.distanceTo(P);
      // The face fills a little over half of the sight, as in the recording.
      this.zoomCam.fov = (2 * Math.atan((TARGET.face / 0.56) / dist) * 180) / Math.PI;
      this.zoomCam.aspect = 1;
      this.zoomCam.updateProjectionMatrix();
      this.zoomCam.lookAt(P);
      r.setRenderTarget(this.rt);
      r.render(this.scene, this.zoomCam);
      r.setRenderTarget(null);
    }
    r.autoClear = true;
    r.render(this.scene, this.cam);
    if (s && this.view === 'line') {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.hud, this.hudCam);
      r.autoClear = true;
    }
  }

  dispose() {
    try {
      for (const t of this._tex) t.dispose();
      for (const g of this._geo) g.dispose();
      for (const m of this._mat) m.dispose();
      this.rt.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    } catch { /* already gone */ }
  }
}

/** The crowd: rows of seated people, each a head on a coloured shirt, on dark blue seats. */
function paintCrowd(c, w, h) {
  c.fillStyle = LOOK.seat; c.fillRect(0, 0, w, h);
  const shirts = ['#e94b3c', '#f7d23c', '#ffffff', '#2f7ae5', '#43b05c', '#f08a2c', '#7a4fd6', '#262626', '#e85ca0', '#5ad1e6', '#ffffff', '#2f7ae5'];
  const skin = ['#f1c9a5', '#d9a07a', '#a86d47', '#7a4a2d', '#f6dcc3'];
  const rows = 10, rowH = h / rows;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, y + rowH - 3, w, 3);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, y + rowH * 0.62, w, 2);
    for (let x = 2 + (r % 2) * 4; x < w; x += 8 + rnd() * 2) {
      if (rnd() < 0.08) continue;                       // an empty seat
      c.fillStyle = shirts[(rnd() * shirts.length) | 0];
      c.fillRect(x, y + rowH * 0.5, 6, rowH * 0.42);
      c.fillStyle = skin[(rnd() * skin.length) | 0];
      c.beginPath(); c.arc(x + 3, y + rowH * 0.36, 2.8, 0, Math.PI * 2); c.fill();
      if (rnd() < 0.12) { c.fillStyle = shirts[(rnd() * shirts.length) | 0]; c.fillRect(x + 0.5, y + rowH * 0.14, 5, 2.5); }
    }
  }
}
