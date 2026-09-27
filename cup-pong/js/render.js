// cup-pong/js/render.js - the table on screen, three.js. Draws from geom.js's numbers, the same
// ones physics.js builds from, so the cup you see is the cup the ball hits.
//
// skeeball/MACHINE-SPEC.md Part 7 applies, and every rule in it is a defect that shipped once:
//   - the WebGLRenderer lives in `this.renderer` (ui.js hands its context back by that name)
//   - the software-GL probe is memoised per page and releases its own context
//   - shadowMap.autoUpdate is off; the pass fires only on frames a caster moved
//   - every material's .map is disposed with it (Material.dispose() does NOT free textures)
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
import { TABLE, CUP, BALL, THROW, CAMERA, RACK_Z0, CUP_D } from './geom.js';

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

const LOOK = {
  bg: '#1a2230',
  floor: '#10151e',
  wood: '#b98552',
  woodDark: '#8a5a32',
  edge: '#6b4526',
  line: '#f4efe6',
  cup: '#d4252b',
  cupDark: '#9e161b',
  cupIn: '#f3f0ea',
  ball: '#fbfaf6',
};

const VANISH_T = 0.32;   // seconds a made cup takes to sink away

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.soft = isSoftGL();
    this.reduced = reducedMotion;
    this.disposed = false;
    this._shadowLive = -1;
    this.cups = new Map();       // id -> { group, t (vanish clock) | null }

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.soft,
      // test-visual's play probe and Report a bug both READ this canvas; it is blank without it.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(this.soft ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = !this.soft;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.bgTex = this._paintBackdrop();
    this.scene.background = this.bgTex;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.camera.position.set(...CAMERA.pos);
    this._build();
  }

  _build() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xfff4e6, 0x2a3140, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 3.2, 0.8);
    key.target.position.set(0, 0, -0.4);
    key.castShadow = !this.soft;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -0.8; sc.right = 0.8; sc.top = 1.6; sc.bottom = -1.6; sc.near = 0.5; sc.far = 6;
    key.shadow.bias = -0.0008;
    S.add(key, key.target);

    // THE TABLE: painted wood top, white border and centre line, darker edge band.
    this.woodTex = this._paintTable();
    const topMat = new THREE.MeshStandardMaterial({ map: this.woodTex, roughness: 0.55 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: LOOK.edge, roughness: 0.7 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width, TABLE.thick, TABLE.len),
      [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat]);
    table.position.y = -TABLE.thick / 2;
    table.receiveShadow = true;
    S.add(table);
    // Legs, only so the far end has something under it.
    const legMat = new THREE.MeshStandardMaterial({ color: '#2b2f38', roughness: 0.8 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), legMat);
      leg.position.set(sx * (TABLE.width / 2 - 0.05), -0.4, sz * (TABLE.len / 2 - 0.08));
      S.add(leg);
    }

    // One cup, built once and cloned per cup (geometries and materials are shared).
    this._cupProto = this._makeCup();

    // THE BALL.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.r, 24, 16),
      new THREE.MeshStandardMaterial({ color: LOOK.ball, roughness: 0.35 }));
    this.ball.castShadow = true;
    S.add(this.ball);
    this.showRestBall();

    // What the camera must always hold: the far rack's outer rims and the table's far corners, and
    // the ball waiting at the release point.
    const bx = 3 * CUP_D / 2 + CUP.topR;
    this._fit = [
      new THREE.Vector3(-bx, CUP.h, RACK_Z0 - CUP.topR), new THREE.Vector3(bx, CUP.h, RACK_Z0 - CUP.topR),
      new THREE.Vector3(-TABLE.width / 2, 0, -TABLE.len / 2), new THREE.Vector3(TABLE.width / 2, 0, -TABLE.len / 2),
      new THREE.Vector3(0, THROW.y0 - BALL.r * 1.6, THROW.z0),
      new THREE.Vector3(0, THROW.y0 + BALL.r, THROW.z0),
      new THREE.Vector3(...CAMERA.apex),
    ];
  }

  /** A dim room behind the table, lit toward the far end so the rack stands out. Screen-space. */
  _paintBackdrop() {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 256;
    const g = cv.getContext('2d');
    const lin = g.createLinearGradient(0, 0, 0, 256);
    lin.addColorStop(0, '#0d121c');
    lin.addColorStop(0.55, '#26304a');
    lin.addColorStop(0.75, '#2c3654');
    lin.addColorStop(1, '#161c2a');
    g.fillStyle = lin;
    g.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _paintTable() {
    const W = 256, L = 1024;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = L;
    const g = cv.getContext('2d');
    g.fillStyle = LOOK.wood;
    g.fillRect(0, 0, W, L);
    // planks along the table, with grain
    const planks = 4;
    for (let i = 0; i < planks; i++) {
      const x0 = (i / planks) * W;
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      g.fillRect(x0, 0, W / planks, L);
      g.strokeStyle = 'rgba(60,30,10,0.35)';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, L); g.stroke();
      // deterministic grain: no Math.random, so two renders of the table match
      for (let k = 0; k < 14; k++) {
        const gx = x0 + ((k * 37 + i * 11) % 60) / 60 * (W / planks);
        g.strokeStyle = 'rgba(90,50,20,0.10)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(gx, 0);
        for (let y = 0; y <= L; y += 64) g.lineTo(gx + Math.sin((y + k * 50) / 140) * 3, y);
        g.stroke();
      }
    }
    // white border and centre line
    g.strokeStyle = LOOK.line;
    g.lineWidth = 7;
    g.strokeRect(5, 5, W - 10, L - 10);
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, L / 2); g.lineTo(W, L / 2); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _makeCup() {
    const { topR, botR, h } = CUP;
    const outer = [];
    const inner = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const y = (i / N) * h;
      const r = botR + (topR - botR) * (i / N);
      outer.push(new THREE.Vector2(r, y));
      inner.push(new THREE.Vector2(r - 0.0014, Math.max(0.004, y)));
    }
    const g = new THREE.Group();
    const mOut = new THREE.MeshStandardMaterial({ color: LOOK.cup, roughness: 0.42, side: THREE.DoubleSide });
    const mIn = new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.6, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.LatheGeometry(outer, 40), mOut);
    wall.castShadow = true;
    const inside = new THREE.Mesh(new THREE.LatheGeometry(inner, 40), mIn);
    // A party cup's two moulded ridges, in a darker red.
    const mRidge = new THREE.MeshStandardMaterial({ color: LOOK.cupDark, roughness: 0.5 });
    for (const f of [0.30, 0.56]) {
      const rr = botR + (topR - botR) * f;
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.0006, 0.0011, 6, 40), mRidge);
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = h * f;
      g.add(ridge);
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(topR, 0.0026, 8, 44),
      new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h;
    const base = new THREE.Mesh(new THREE.CircleGeometry(botR - 0.002, 32),
      new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.7 }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.004;
    g.add(wall, inside, rim, base);
    return g;
  }

  /** Put these cups on the table ([{ id, x, z }]), replacing any that were there. */
  setCups(cups) {
    for (const [, c] of this.cups) this.scene.remove(c.group);
    this.cups.clear();
    for (const k of cups) {
      const group = this._cupProto.clone();
      group.position.set(k.x, 0, k.z);
      this.scene.add(group);
      this.cups.set(k.id, { group, t: null });
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** A made cup sinks away. Under reduced motion it is simply gone. */
  vanish(id) {
    const c = this.cups.get(id);
    if (!c) return;
    if (this.reduced) { this.scene.remove(c.group); this.cups.delete(id); this.renderer.shadowMap.needsUpdate = true; return; }
    c.t = 0;
  }

  /** The ball waiting at the release point. */
  showRestBall() {
    this.ball.visible = true;
    this.ball.position.set(0, THROW.y0, THROW.z0);
    this.ball.quaternion.set(0, 0, 0, 1);
  }
  hideBall() { this.ball.visible = false; }

  _aim() {
    // Pitch the camera so the fit points sit centred top-to-bottom; yaw stays straight down the
    // table. Then the field is the narrowest that still holds all of them, width AND height.
    const cp = this.camera.position;
    let lo = Infinity, hi = -Infinity;
    for (const p of this._fit) {
      const a = Math.atan2(p.y - cp.y, Math.hypot(p.z - cp.z, p.x - cp.x));
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    const pitch = (lo + hi) / 2;
    this.camera.lookAt(cp.x, cp.y + Math.tan(pitch) * 10, cp.z - 10);
  }

  _fovFor(aspect) {
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    let tan = 0.05;
    for (const p of this._fit) {
      const v = p.clone().applyMatrix4(inv);
      const d = Math.max(0.05, -v.z);
      tan = Math.max(tan, Math.abs(v.y) / d, Math.abs(v.x) / d / aspect);
    }
    return Math.max(18, Math.min(80, 2 * Math.atan(tan * 1.06) * 180 / Math.PI));
  }

  resize(w, h) {
    if (this.disposed || !w || !h) return;
    this.renderer.setSize(w, h, true);   // `true` sets the CSS size too: an absolutely positioned
    this.camera.aspect = w / h;          // canvas is a REPLACED element and inset:0 does not stretch it
    this._aim();
    this.camera.fov = this._fovFor(w / h);
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Where a world point lands on the canvas, in CSS px. For the tests and the HUD. */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - (v.y + 1) / 2) * el.clientHeight };
  }

  /** `ball` is the physics body (or null). */
  render(ball, dt = 0.016) {
    if (this.disposed) return;
    let moving = false;
    if (ball) {
      this.ball.visible = true;
      this.ball.position.set(ball.position.x, ball.position.y, ball.position.z);
      this.ball.quaternion.set(ball.quaternion.x, ball.quaternion.y, ball.quaternion.z, ball.quaternion.w);
      moving = true;
    }
    for (const [id, c] of this.cups) {
      if (c.t === null) continue;
      c.t += dt;
      moving = true;
      const f = Math.min(1, c.t / VANISH_T);
      c.group.position.y = -CUP.h * 0.9 * f * f;
      const s = 1 - 0.35 * f;
      c.group.scale.set(s, 1, s);
      if (f >= 1) { this.scene.remove(c.group); this.cups.delete(id); }
    }
    // Shadows only on frames a caster moved (plus the frame after, to clear the last one).
    if (moving || this._shadowLive) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shadowLive = moving;
    }
    this.renderer.render(this.scene, this.camera);
  }

  get animating() {
    for (const [, c] of this.cups) if (c.t !== null) return true;
    return false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const seen = new Set();
    const free = (o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); try { o.geometry.dispose(); } catch {} }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        try { m.map && m.map.dispose(); m.dispose(); } catch {}
      }
    };
    this.scene.traverse(free);
    this._cupProto.traverse(free);   // may not be in the scene if every cup was made
    try { this.woodTex.dispose(); } catch {}
    try { this.bgTex.dispose(); } catch {}
    // The context itself is handed back by ui.js (forceContextLoss on `this.renderer`).
  }
}

export default { Renderer };
