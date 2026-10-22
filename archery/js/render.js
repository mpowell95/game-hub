// archery/js/render.js - the range on screen, three.js. Everything here is drawn from code (no
// images, no models): a stadium with a crowd, a striped grass lane with white lines, a target on a
// wooden easel, and the arrows. The bow, hand, sleeve and nocked arrow are 3D too, but in their
// own small scene (bow3d.js) drawn over the range each frame, so they stay sharp and lit the same
// wherever the sight goes; only the sight's ring (gauge and crosshair) is an SVG in ui.js.
//
// THREE CAMERAS, as in the recording (docs/ARCHERY-BRIEF.md section 2):
//   'line'   - the shooter's eye on the line, the target small and far off;
//   'flight' - the glide from the line to the close-up while the arrow flies in (one shot, no cut);
//   'close'  - several metres in front of the target, a little to the left, for the hit and replays.
// Plus the SIGHT: while drawing, a narrow camera looks at the aim point and is drawn into a disc
// under the sight's ring (setScope). The point under the sight's crosshair IS the aim.
//
// Same rules as cup-pong/js/render.js (skeeball/MACHINE-SPEC.md Part 7): the renderer lives in
// `this.renderer`, the software-GL probe is memoised and releases its context, every texture is
// disposed with its material.
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
import { BowView } from './bow3d.js';

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
const FLIGHT_T = 0.8;                           // seconds, release to hit (the recording, at 30 fps)
// THE FLIGHT IS A REAL STRAIGHT LINE in the world (Matt, 2026-10-22: framed from the moving camera, it
// "curves towards the camera then back to the target... NOT an arrow flying straight towards a
// target"). It leaves from where the bow held it, on the line from the eye through the sight,
// FLIGHT_D0 m out (Matt, 2026-10-20: it used to jump up and right on release), and goes straight to
// the hit at one steady speed (about 34 m/s), rising FLIGHT_ARC m at mid-flight like a real arrow.
// Whatever the camera shows is then the truth: the camera follows straight behind the arrow (it used
// to drift sideways and tilt while the arrow was a couple of metres ahead, so the straight flight
// swung across the screen), then swings round to the close-up and stops as the arrow hits.
const FLIGHT_D0 = 2.6;
const FLIGHT_ARC = 0.25;
// The chase: CHASE_UP m above the arrow's line, from FLIGHT_D0 to CHASE_BACK behind it (the close-up's
// own distance from the target), settling onto the close-up over the last CHASE_SETTLE of the flight.
const CHASE_UP = 0.3, CHASE_BACK = 4.8, CHASE_SETTLE = 0.18;
const INCOMING_RUN = 3.5;                       // m: how far out a replay arrow is first drawn
const WOBBLE_T = 0.6, WOBBLE_A = 0.07;          // s, rad: an arrow quivering in the target after it hits
const FLASH_T = 0.9;                            // s: the scored ring lit on the face
const BOWL_Z = 10;                              // the centre of the stadium's curve
const BOARD_TALL = 1.06;                        // the board's height over its width (drawing only)
// The board's half-width in face radii, as drawn: the recording's face nearly fills it. Narrower
// than the rules' BOSS (1.3), which only matters for arrows that score 0 either way.
const BOARD_HALF = 1.14;
const LINE_LOOK = new THREE.Vector3(TARGET.x, TARGET.y - 1.45, TARGET.z);
// The close-up: the board about 45% of the screen's width, right of the middle, stands behind it.
const CLOSE_POS = new THREE.Vector3(TARGET.x - 1.2, TARGET.y + 0.4, TARGET.z + 4.8);
const CLOSE_LOOK = new THREE.Vector3(TARGET.x - 0.1, TARGET.y - 0.08, TARGET.z);
/** Where a shot at the face point (x, y) leaves from: on the line from the eye to it, FLIGHT_D0 out. */
function launchAt(x, y) {
  const H = new THREE.Vector3(TARGET.x + x * TARGET.face, TARGET.y + y * TARGET.face, FACE_Z - 0.05);
  return EYE.clone().add(H.clone().sub(EYE).normalize().multiplyScalar(FLIGHT_D0));
}
/** The way an arrow travels into the face at (x, y): the straight flight's direction as it lands,
 *  from the shooting line and a hair downward (the arc). Every arrow, flown or replayed, uses it. */
function inDir(x, y) {
  const H = new THREE.Vector3(TARGET.x + x * TARGET.face, TARGET.y + y * TARGET.face, FACE_Z - 0.05);
  return H.sub(launchAt(x, y)).add(new THREE.Vector3(0, -4 * FLIGHT_ARC, 0)).normalize();
}
export { FLIGHT_T };

const LOOK = {
  grassA: '#46ba38', grassB: '#5cd04a', line: '#ffffff', wall: '#1d5fb8', wallTop: '#3b86e0',
  seat: '#2a5294', wood: '#9a6a3a', woodDark: '#6d4724', boss: '#fbfbf8',
  ring: ['#fbfbf8', '#fbfbf8', '#202020', '#202020', '#2ea7e8', '#2ea7e8', '#e8342b', '#e8342b', '#ffd21f', '#ffd21f'],
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
    // The bow, hand, arm and arrow in your hands: their own small lit scene, drawn over the range.
    this.env = this._envMap();
    this.bow = new BowView(THREE, { g: (x) => this._g(x), m: (x) => this._m(x), t: (x) => { this._tex.push(x); return x; } }, { env: this.env, color: ARROW_COLORS.me });
    this._bowPose = null;
  }

  /** A soft environment for the shiny parts to reflect: sky above, grass below, a sun. */
  _envMap() {
    const env = new THREE.Scene();
    const tex = this._canvasTex(16, 256, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#3f86e0'); gr.addColorStop(0.45, '#d8ecfb'); gr.addColorStop(0.52, '#9fbf8a'); gr.addColorStop(1, '#3f8a34');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
    env.add(new THREE.Mesh(this._g(new THREE.SphereGeometry(10, 32, 16)), this._m(new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide }))));
    const sunM = new THREE.Mesh(this._g(new THREE.SphereGeometry(1.2, 16, 8)), this._m(new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5) })));
    sunM.position.set(-4, 7, 4);
    env.add(sunM);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = pm.fromScene(env, 0.03);
    pm.dispose();
    this._envRT = rt;
    return rt.texture;
  }

  /** The bow in your hands: { x, y, r, rot, p, fly } (see bow3d.js setPose), or null to hide it. */
  setBow(pose, color) {
    this._bowPose = pose;
    if (!pose) return;
    if (color && color !== this._bowColor) { this._bowColor = color; this.bow.setColor(color); }
    this.bow.setPose(pose);
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
    // The sky: a dome with clouds (the recording shows blue sky above the roof, never a flat colour).
    S.background = new THREE.Color('#8cc4f2');
    const sky = this._canvasTex(2048, 1024, (c, w, h) => paintSky(c, w, h));
    const dome = new THREE.Mesh(this._g(new THREE.SphereGeometry(300, 48, 24)), this._m(new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false })));
    dome.renderOrder = -1;
    S.add(dome);
    S.fog = new THREE.Fog('#cfe6f8', 90, 260);
    S.add(new THREE.HemisphereLight(0xffffff, 0x5f8a45, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    // The sun's shadow covers only the target and its easel (the one thing near enough to show it).
    sun.position.set(TARGET.x - 30, 60, TARGET.z + 25);
    sun.target.position.set(TARGET.x, 0, TARGET.z);
    if (!this.soft) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 40, far: 110 });
      sun.shadow.bias = -0.0008;
    }
    S.add(sun, sun.target);

    // Grass: wide mowing bands across the lane, a finer check on top.
    const grass = this._canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = LOOK.grassA; c.fillRect(0, 0, w, h);
      c.fillStyle = LOOK.grassB; c.fillRect(0, 0, w, h / 2);
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // Blades: short strokes, light and dark, so the mown bands read crisp, not blurred.
      for (let i = 0; i < 16000; i++) {
        const x = rnd() * w, y = rnd() * h, light = rnd() < 0.5;
        c.fillStyle = light ? `rgba(${110 + rnd() * 60},${200 + rnd() * 40},${70 + rnd() * 40},0.35)` : `rgba(${20 + rnd() * 30},${100 + rnd() * 50},${20 + rnd() * 20},0.4)`;
        c.fillRect(x, y, 1.2, 2.5 + rnd() * 2.5);
      }
    }, [24, 50]);
    grass.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(this._g(new THREE.PlaneGeometry(240, 300)), this._m(new THREE.MeshLambertMaterial({ map: grass })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -100);
    ground.receiveShadow = true;
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

    // The far end of a bowl: everything below is a slice of a circle round (0, BOWL_Z), so the
    // barrier, the stands and the roof curve away at the sides as in the recording.
    const arc = (r0, r1, y0, y1, mat, seg = 72) => {
      const m = new THREE.Mesh(this._g(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, true, Math.PI - 0.9, 1.8)), mat);
      m.position.set(0, (y0 + y1) / 2, BOWL_Z);
      S.add(m);
      return m;
    };
    // The blue barrier behind the target.
    arc(46, 46, 0, 1.3, this._m(new THREE.MeshLambertMaterial({ color: LOOK.wall, side: THREE.BackSide })));
    arc(46.2, 46.2, 1.26, 1.38, this._m(new THREE.MeshLambertMaterial({ color: LOOK.wallTop, side: THREE.BackSide })));
    const board = new THREE.Mesh(this._g(new THREE.BoxGeometry(6, 2.4, 0.5)), this._m(new THREE.MeshLambertMaterial({ color: '#2a6fc4' })));
    board.position.set(9, 1.2, BOWL_Z - Math.sqrt(46 * 46 - 81) + 0.6);
    board.rotation.y = -Math.asin(9 / 46);
    S.add(board);

    // The stands: one deep tier of blue and yellow seats from the barrier up to a pale rim, then
    // the roof (heights measured off the recording: the rim at about 0.35 of the screen).
    const crowd = this._canvasTex(512, 256, (c, w, h) => paintCrowd(c, w, h), [7.5, 2]);
    arc(46.5, 58, 1.4, 5.6, this._m(new THREE.MeshLambertMaterial({ map: crowd, side: THREE.BackSide })), 96);
    arc(58, 59.2, 5.6, 6.2, this._m(new THREE.MeshLambertMaterial({ color: '#d5dce2', side: THREE.BackSide })));
    arc(59.2, 60.2, 6.2, 6.6, this._m(new THREE.MeshLambertMaterial({ color: '#2a3242', side: THREE.BackSide })));
    this._buildRoof();

    this._buildTarget();
  }

  /** The roof: a canopy of pale panels seen from below, rising from the top of the stands to
   *  its inner edge (about 12.6 m up, 40 m out), each bay between two white steel ribs arching up
   *  at its front edge, a white tube along that edge, and sky above it (the recording). */
  _buildRoof() {
    const S = this.scene;
    const A0 = Math.PI - 0.9, A1 = Math.PI + 0.9, BAYS = 40;
    const at = (th, sv) => {
      // sv 0 = the back (on the stands), 1 = the inner edge; arches between ribs at the front.
      const frac = ((th - A0) / (A1 - A0)) * BAYS % 1;
      const r = 60 - 10 * sv;
      const y = 6.6 + 3.1 * sv + 0 * frac;
      return new THREE.Vector3(Math.sin(th) * r, y, BOWL_Z + Math.cos(th) * r);
    };
    // The canopy: a grid of quads, lit, so its underside reads in shade as in the recording.
    const NT = BAYS * 6, NS = 6, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NT; i++) {
      const th = A0 + ((A1 - A0) * i) / NT;
      for (let j = 0; j <= NS; j++) {
        const p = at(th, j / NS);
        pos.push(p.x, p.y, p.z);
        uv.push((i / NT) * BAYS, j / NS);
      }
    }
    for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) {
      const k = i * (NS + 1) + j;
      idx.push(k, k + NS + 1, k + 1, k + 1, k + NS + 1, k + NS + 2);
    }
    const geo = this._g(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Pale translucent panels, a touch green, brighter toward the front edge, with rows of small
    // white skylights (the recording).
    const panels = this._canvasTex(128, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#9fb0aa'); g.addColorStop(0.5, '#c9d6d0'); g.addColorStop(1, '#e8efec');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (let j = 20; j < h; j += 64) {
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillRect(w * 0.3, j, w * 0.4, 10);
        c.fillStyle = 'rgba(80,95,95,0.35)';
        c.fillRect(w * 0.3, j + 10, w * 0.4, 2);
      }
      c.strokeStyle = 'rgba(70,80,85,0.35)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, h); c.lineTo(w / 2, 0); c.lineTo(w, h); c.stroke();
    });
    panels.wrapS = THREE.RepeatWrapping;
    const canopy = new THREE.Mesh(geo, this._m(new THREE.MeshBasicMaterial({ map: panels, side: THREE.DoubleSide })));
    S.add(canopy);
    // The ribs: white steel under each bay line, and the tube along the arched front edge.
    const steel = this._m(new THREE.MeshLambertMaterial({ color: '#3f464f' }));
    const pale = this._m(new THREE.MeshLambertMaterial({ color: '#eef2f5', emissive: '#c8d0d6', emissiveIntensity: 0.4 }));
    const rib = this._g(new THREE.CylinderGeometry(0.12, 0.16, 1, 6));
    const up = new THREE.Vector3(0, 1, 0);
    const ribs = new THREE.InstancedMesh(rib, steel, BAYS + 1);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i <= BAYS; i++) {
      const th = A0 + ((A1 - A0) * i) / BAYS;
      // Each rib leans a little (the recording's roof reads as parallel slanted lines).
      const p0 = at(th, 0).add(new THREE.Vector3(0, -0.25, 0)), p1 = at(th + 0.06, 1).add(new THREE.Vector3(0, -0.25, 0));
      const d = p1.clone().sub(p0);
      q.setFromUnitVectors(up, d.clone().normalize());
      mtx.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, d.length(), 1));
      ribs.setMatrixAt(i, mtx);
    }
    S.add(ribs);
    const edge = [];
    for (let i = 0; i <= BAYS * 8; i++) edge.push(at(A0 + ((A1 - A0) * i) / (BAYS * 8), 1));
    const tube = new THREE.Mesh(this._g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), BAYS * 8, 0.12, 6)), this._m(new THREE.MeshLambertMaterial({ color: '#6a717b' })));
    S.add(tube);
    // A second, lower purlin across the bays, and the dark back of the stand under the roof.
    const mid = [];
    for (let i = 0; i <= 64; i++) mid.push(at(A0 + ((A1 - A0) * i) / 64, 0.5).add(new THREE.Vector3(0, -0.3, 0)));
    S.add(new THREE.Mesh(this._g(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mid), 64, 0.1, 5)), pale));
  }

  _buildTarget() {
    const S = this.scene;
    const T = TARGET;
    const g = new THREE.Group();
    // The boss: a white square board with a dark edge.
    const bossSide = T.face * BOARD_HALF * 2;
    const bossH = bossSide * BOARD_TALL;              // a little taller than wide (the recording)
    const boss = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide, bossH, 0.16)), this._m(new THREE.MeshBasicMaterial({ color: LOOK.boss })));
    boss.position.set(T.x, T.y, T.z);
    g.add(boss);
    const edge = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide + 0.05, bossH + 0.05, 0.12)), this._m(new THREE.MeshLambertMaterial({ color: '#5a3c22' })));
    edge.position.set(T.x, T.y, T.z - 0.03);
    g.add(edge);
    // The face: ten rings, painted.
    const face = this._canvasTex(1024, 1024, (c, w) => {
      const cx = w / 2, R = w / 2 - 2;
      c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, w, w);
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
    const faceMesh = new THREE.Mesh(this._g(new THREE.CircleGeometry(T.face, 96)), this._m(new THREE.MeshBasicMaterial({ map: face })));
    faceMesh.position.set(T.x, T.y, FACE_Z);
    g.add(faceMesh);
    // The wooden easel: two front legs, two back legs, a ledge under the board.
    const wood = this._m(new THREE.MeshLambertMaterial({ color: LOOK.wood }));
    const woodDark = this._m(new THREE.MeshLambertMaterial({ color: LOOK.woodDark }));
    const leg = (x, zTop, zBot, mat) => {
      const top = new THREE.Vector3(T.x + x, T.y + bossH * 0.42, T.z + zTop);
      const bot = new THREE.Vector3(T.x + x * 1.05, 0, T.z + zBot);
      const len = top.distanceTo(bot);
      const m = new THREE.Mesh(this._g(new THREE.BoxGeometry(0.09, len, 0.09)), mat);
      m.position.copy(top).add(bot).multiplyScalar(0.5);
      m.lookAt(top);
      m.rotateX(Math.PI / 2);
      g.add(m);
    };
    leg(-bossSide * 0.47, 0.12, 0.42, wood); leg(bossSide * 0.47, 0.12, 0.42, wood);
    leg(-bossSide * 0.3, -0.12, -0.9, woodDark); leg(bossSide * 0.3, -0.12, -0.9, woodDark);
    const ledge = new THREE.Mesh(this._g(new THREE.BoxGeometry(bossSide * 0.95, 0.07, 0.24)), wood);
    ledge.position.set(T.x, T.y - bossH / 2 - 0.04, T.z + 0.1);
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
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    shadow.castShadow = false;
    g.add(shadow);
    S.add(g);
  }

  // --- arrows ------------------------------------------------------------------------------------
  /** An arrow pointing along -z with its tip at the origin: a thin shaft (coloured in front, black
   *  behind), a steel point, three swept vanes (one coloured) and a nock. Matt, 2026-10-20: the old
   *  one, 6 cm thick with big square vanes, looked "like nerf gun bullets". Still a little thicker
   *  than a real arrow so it reads from the close-up. Parts are made once and shared. */
  _arrow(color) {
    const P = this._arrowParts || (this._arrowParts = this._makeArrowParts());
    let M = P.mats.get(color);
    if (!M) {
      M = this._m(new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
      P.mats.set(color, M);
    }
    const g = new THREE.Group();
    const add = (geo, mat, z, rx = Math.PI / 2) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = rx; m.position.z = z; g.add(m); return m; };
    const L = P.L;
    add(P.point, P.steel, 0.025, -Math.PI / 2);
    add(P.collar, P.steel, 0.075);
    add(P.front, M, 0.26);
    add(P.rear, P.black, (0.45 + L) / 2);
    add(P.nock, M, L + 0.012);
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(P.vane, i === 0 ? M : P.white);
      v.rotation.y = -Math.PI / 2;
      v.position.set(0, P.r, L - 0.17);
      const holder = new THREE.Group();
      holder.add(v);
      holder.rotation.z = (i * 2 * Math.PI) / 3;
      g.add(holder);
    }
    return g;
  }
  _makeArrowParts() {
    const L = 0.85, r = 0.011, cyl = (rad, len, n = 8) => this._g(new THREE.CylinderGeometry(rad, rad, len, n));
    const vane = new THREE.Shape();
    vane.moveTo(0, 0); vane.lineTo(0.13, 0); vane.lineTo(0.12, 0.03); vane.quadraticCurveTo(0.05, 0.042, 0, 0.004); vane.lineTo(0, 0);
    return {
      L, r, mats: new Map(),
      point: this._g(new THREE.ConeGeometry(r * 1.35, 0.07, 8)),
      collar: cyl(r * 1.15, 0.012),
      front: cyl(r, 0.38),
      rear: cyl(r, L - 0.45),
      nock: cyl(r * 1.25, 0.025),
      vane: this._g(new THREE.ShapeGeometry(vane)),
      steel: this._m(new THREE.MeshLambertMaterial({ color: '#cfd5dc', emissive: '#5a6068', emissiveIntensity: 0.4 })),
      black: this._m(new THREE.MeshLambertMaterial({ color: '#17191d' })),
      white: this._m(new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3, side: THREE.DoubleSide })),
    };
  }

  /** A face point (face radii, y up) as a world point on the face. */
  facePoint(x, y, z = FACE_Z) { return new THREE.Vector3(TARGET.x + x * TARGET.face, TARGET.y + y * TARGET.face, z); }

  /** The arrows in the target: [{ x, y, color, dir?, hit? }]. One beyond the boss is not drawn.
   *  `hit` (performance.now() when it struck) makes it quiver for WOBBLE_T, across rebuilds. */
  setStuck(list) {
    this.stuck.clear();
    for (const a of list || []) {
      if (Math.abs(a.x) > BOARD_HALF || Math.abs(a.y) > BOARD_HALF * BOARD_TALL) continue;
      const m = this._arrow(a.color);
      const tip = this.facePoint(a.x, a.y, FACE_Z - 0.05);
      const dir = a.dir ? a.dir.clone().normalize() : inDir(a.x, a.y);
      m.position.copy(tip);
      m.lookAt(tip.clone().sub(dir));             // +z (the shaft) points back the way it came
      if (a.hit && !this.reduced) m.userData.wob = { hit: a.hit, q: m.quaternion.clone() };
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
    if (this.bow) this.bow.layout(w, h);
    if (this.view === 'line' || this.view === 'close') this.setView(this.view);
  }

  setView(view) {
    this.view = view;
    if (view === 'line') {
      this.cam.position.copy(EYE);
      // The target sits a little above the middle of the screen, as in the recording.
      this.cam.lookAt(LINE_LOOK);
    } else if (view === 'close') {
      this.cam.position.copy(CLOSE_POS);
      this.cam.lookAt(CLOSE_LOOK);
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
  // The camera glides down the lane from the shooting line to the close-up of the target (no cut)
  // while the arrow flies its straight line ahead of it, a white trail behind.
  /** Start a shot landing at `hit` (face radii), aimed at `aim`. `color`: the arrow's. Nothing
   *  moves until setFlight. */
  startFlight(aim, hit, color) {
    this.loose.clear();
    const H = this.facePoint(hit.x, hit.y, FACE_Z - 0.05);
    // From the sight: on the line from the eye through where the sight was.
    const S = launchAt(aim.x, aim.y);
    const arrow = this._arrow(color);
    arrow.visible = false;
    const trail = this._trail();
    this.loose.add(arrow, trail.mesh);
    this.flight = { S, H, arrow, trail, u: 0 };
  }
  /** The flight camera at u, into `cam`. It starts as the line camera and follows behind the arrow,
   *  looking at it, so the arrow is seen flying straight at the target: it drops back from FLIGHT_D0
   *  to the close-up's distance and drifts out to the close-up's side as it goes, then settles on the
   *  close-up (position and view) over the last CHASE_SETTLE as the arrow lands. It never catches the
   *  arrow up (it used to swing in beside it, so the arrow loomed and left the screen). */
  _camAt(u, cam) {
    const f = this.flight;
    if (!f) { cam.position.copy(EYE); cam.lookAt(LINE_LOOK); cam.updateMatrixWorld(); return; }
    const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const tip = this._tipAt(u), dir = this._dirAt(u);
    const back = FLIGHT_D0 + (CHASE_BACK - FLIGHT_D0) * u * u;
    const pos = tip.clone().sub(dir.multiplyScalar(back));
    pos.y += CHASE_UP * sm(u * 3);
    pos.x += (CLOSE_POS.x - TARGET.x) * sm(u);
    const w = sm((u - (1 - CHASE_SETTLE)) / CHASE_SETTLE);
    cam.position.copy(pos.lerp(CLOSE_POS, w));
    const look = LINE_LOOK.clone().lerp(tip, sm(u / 0.15)).lerp(CLOSE_LOOK, w);
    cam.lookAt(look);
    cam.updateMatrixWorld();
  }
  /** The arrow's tip at u: straight from S to H at a steady speed, FLIGHT_ARC up at mid-flight. */
  _tipAt(u) {
    const f = this.flight;
    const p = f.S.clone().lerp(f.H, u);
    p.y += 4 * FLIGHT_ARC * u * (1 - u);
    return p;
  }
  /** The way the arrow points at u: along its path. */
  _dirAt(u) {
    const f = this.flight;
    const d = f.H.clone().sub(f.S);
    d.y += 4 * FLIGHT_ARC * (1 - 2 * u);
    return d.normalize();
  }
  /** A white ribbon that follows the path behind the arrow, fading to nothing. */
  _trail() {
    const N = 18;
    const geo = this._g(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const col = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const a = 0.7 * (1 - i / (N - 1));
      col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    geo.setIndex(idx);
    this._trailMat = this._trailMat || this._m(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const mesh = new THREE.Mesh(geo, this._trailMat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, geo, N };
  }
  /** The trail `t`: from the arrow's tail straight back along the way it points, tapering. */
  _setTrail(t, p, dir, u) {
    const pos = t.geo.attributes.position;
    const len = 2.2 * Math.min(1, u * 3) * (1 - 0.4 * u);
    const camP = this.cam.position;
    const tail = p.clone().sub(dir.clone().multiplyScalar(this._arrowParts ? this._arrowParts.L : 0.85));
    for (let i = 0; i < t.N; i++) {
      const k = i / (t.N - 1);
      const q = tail.clone().sub(dir.clone().multiplyScalar(len * k));
      const toCam = camP.clone().sub(q);
      const side = dir.clone().cross(toCam).normalize();
      const wdt = toCam.length() * (0.006 * (1 - k) + 0.0005);   // about the same width on screen near or far
      pos.setXYZ(i * 2, q.x + side.x * wdt, q.y + side.y * wdt, q.z + side.z * wdt);
      pos.setXYZ(i * 2 + 1, q.x - side.x * wdt, q.y - side.y * wdt, q.z - side.z * wdt);
    }
    pos.needsUpdate = true;
    t.mesh.visible = u < 0.995;
  }
  /** The flight at u (0..1): the camera on its glide, the arrow on its way in. */
  setFlight(u) {
    const f = this.flight;
    if (!f) return;
    u = Math.max(0, Math.min(1, u));
    f.u = u;
    this.view = 'flight';
    this._camAt(u, this.cam);
    const p = this._tipAt(u);
    const dir = this._dirAt(u);
    f.arrow.visible = true;
    f.arrow.position.copy(p);
    f.arrow.lookAt(p.clone().sub(dir));
    f.dir = dir;
    this._setTrail(f.trail, p, dir, u);
  }
  /** The direction the flight arrived from (for its stuck arrow). */
  flightDir() { return this.flight && this.flight.dir ? this.flight.dir.clone() : null; }
  endFlight() { this.loose.clear(); this.flight = null; }

  /** A replay arrow coming in to the close-up at `hit` (face radii), u 0..1. */
  setIncoming(hit, color, u) {
    if (!this._incoming || this._incoming.color !== color) {
      this.loose.clear();
      const trail = this._trail();
      this._incoming = { arrow: this._arrow(color), color, trail };
      this.loose.add(this._incoming.arrow, trail.mesh);
    }
    const H = this.facePoint(hit.x, hit.y, FACE_Z - 0.05);
    const dir = inDir(hit.x, hit.y);
    const from = H.clone().sub(dir.clone().multiplyScalar(INCOMING_RUN));
    const k = Math.max(0, Math.min(1, u));
    const p = from.clone().lerp(H, k);
    const a = this._incoming.arrow;
    a.position.copy(p);
    a.lookAt(p.clone().sub(dir));
    this._setTrail(this._incoming.trail, p, dir, 0.3 + 0.7 * k);
    this._incomingDir = dir;
  }
  incomingDir() { return this._incomingDir ? this._incomingDir.clone() : null; }
  clearIncoming() { this.loose.clear(); this._incoming = null; }

  /** The ring `score` is in lights up yellow ON the face (under the arrows, at the face's angle), then
   *  fades. Matt, 2026-10-20: the old one, a screen overlay, popped out on top of everything. */
  flashRing(score) {
    this.clearFlash();
    if (!(score > 0) || score > 10) return;
    const R = TARGET.face, w = 0.028 * R, out = ((11 - score) / 10) * R, inn = ((10 - score) / 10) * R;
    // Yellow, edged with a soft dark line so it shows on the gold rings too.
    const mk = (color, o) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mats = [mk('#000000', 0.45), mk('#ffd21f', 1)];
    const g = new THREE.Group();
    const band = (r0, r1, halo) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r0), r1, 96), mats[halo ? 0 : 1]);
      m.renderOrder = halo ? 1 : 2;
      g.add(m);
    };
    for (const [r, k] of inn > 0 ? [[out, -1], [inn, 1]] : [[out, -1]]) {
      const c = r + k * w * 0.5;                    // just inside the band
      band(c - w * 0.95, c + w * 0.95, true);
      band(c - w * 0.5, c + w * 0.5, false);
    }
    g.position.set(TARGET.x, TARGET.y, FACE_Z + 0.003);
    this.scene.add(g);
    this._flash = { g, mats, t0: performance.now() };
  }
  clearFlash() {
    const f = this._flash;
    if (!f) return;
    this.scene.remove(f.g);
    for (const m of f.g.children) m.geometry.dispose();
    for (const m of f.mats) m.dispose();
    this._flash = null;
  }
  /** Time-driven touches: the newest arrow's quiver and the ring's fade. */
  _animate(now) {
    for (const m of this.stuck.children) {
      const w = m.userData.wob;
      if (!w) continue;
      const t = (now - w.hit) / 1000;
      if (t < 0 || t > WOBBLE_T) { m.quaternion.copy(w.q); delete m.userData.wob; continue; }
      const a = WOBBLE_A * Math.exp(-t / 0.15) * Math.sin(t * 2 * Math.PI * 11);
      this._wq = this._wq || new THREE.Quaternion();
      this._wx = this._wx || new THREE.Vector3(1, 0, 0);
      m.quaternion.copy(w.q).multiply(this._wq.setFromAxisAngle(this._wx, a));   // about its point, in the face
    }
    const f = this._flash;
    if (f) {
      const t = (now - f.t0) / 1000;
      if (t >= FLASH_T || this.view !== 'close') this.clearFlash();
      else {
        const o = t < 0.45 ? 1 : 1 - (t - 0.45) / (FLASH_T - 0.45);
        f.mats[0].opacity = 0.45 * o; f.mats[1].opacity = o;
      }
    }
  }

  // --- a frame -------------------------------------------------------------------------------------
  render() {
    if (!this.w || !this.h) return;
    this._animate(performance.now());
    const r = this.renderer;
    const s = this._scope;
    if (s && this.view === 'line') {
      this.zoomCam.position.copy(this.cam.position);
      const P = this.facePoint(s.ax, s.ay);
      const dist = this.cam.position.distanceTo(P);
      // The face fills about two fifths of the sight, the board round it showing (the recording).
      this.zoomCam.fov = (2 * Math.atan((TARGET.face / 0.5) / dist) * 180) / Math.PI;
      this.zoomCam.aspect = 1;
      this.zoomCam.updateProjectionMatrix();
      this.zoomCam.lookAt(P);
      r.setRenderTarget(this.rt);
      r.render(this.scene, this.zoomCam);
      r.setRenderTarget(null);
    }
    r.autoClear = true;
    r.render(this.scene, this.cam);
    if (this._bowPose || (s && this.view === 'line')) {
      r.autoClear = false;
      if (this._bowPose) { r.clearDepth(); r.render(this.bow.scene, this.bow.cam); }
      if (s && this.view === 'line') { r.clearDepth(); r.render(this.hud, this.hudCam); }
      r.autoClear = true;
    }
  }

  dispose() {
    try {
      this.clearFlash();
      for (const t of this._tex) t.dispose();
      for (const g of this._geo) g.dispose();
      for (const m of this._mat) m.dispose();
      this.rt.dispose();
      if (this._envRT) this._envRT.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    } catch { /* already gone */ }
  }
}

/** The crowd: rows of seated people, each a head on a coloured shirt, on dark blue seats. */
function paintCrowd(c, w, h) {
  // Blue seats with yellow blocks, a quarter of them empty, people mostly in dark, white, blue and
  // yellow (the recording's crowd reads as a blue-and-yellow speckle).
  c.fillStyle = LOOK.seat; c.fillRect(0, 0, w, h);
  const shirts = ['#1d2b4a', '#ffffff', '#2f7ae5', '#f7d23c', '#3a3a3a', '#c8d4e6', '#e94b3c', '#5a7fc0', '#f7d23c', '#1d2b4a'];
  const skin = ['#f1c9a5', '#d9a07a', '#a86d47', '#7a4a2d', '#f6dcc3'];
  const rows = 10, rowH = h / rows;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const yellow = (x, r) => ((x / 64) | 0) % 3 === 1 && r % 5 < 3;
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, y + rowH - 3, w, 3);
    for (let x = 2 + (r % 2) * 4; x < w; x += 8 + rnd() * 2) {
      if (rnd() < 0.25) {                                // an empty seat, its colour showing
        c.fillStyle = yellow(x, r) ? '#e8c23a' : '#3566c4';
        c.fillRect(x, y + rowH * 0.45, 6, rowH * 0.45);
        continue;
      }
      c.fillStyle = shirts[(rnd() * shirts.length) | 0];
      c.fillRect(x, y + rowH * 0.5, 6, rowH * 0.42);
      c.fillStyle = skin[(rnd() * skin.length) | 0];
      c.beginPath(); c.arc(x + 3, y + rowH * 0.36, 2.8, 0, Math.PI * 2); c.fill();
    }
  }
}

/** The sky dome's picture (an equirectangular strip): deep blue overhead, pale at the horizon,
 *  soft white clouds in the band the cameras see. */
function paintSky(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2c74d6'); g.addColorStop(0.3, '#3f8be0'); g.addColorStop(0.44, '#6fb0ec'); g.addColorStop(0.5, '#cfe7fa'); g.addColorStop(1, '#e6f3fd');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 150; i++) {
    const cx = rnd() * w, cy = h * (0.3 + rnd() * 0.16), sw = 24 + rnd() * 70;
    for (let j = 0; j < 9; j++) {
      const x = cx + (rnd() - 0.5) * sw * 1.6, y = cy + (rnd() - 0.6) * sw * 0.35, r = sw * (0.25 + rnd() * 0.3);
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr;
      c.beginPath(); c.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); c.fill();
    }
  }
}
