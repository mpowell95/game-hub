// cup-pong/js/render.js - the table on screen, three.js. Draws from geom.js's numbers, the same
// ones physics.js builds from, so the cup you see is the cup the ball hits.
//
// THE LOOK IS GAMEPIGEON'S, read off Matt's two screen recordings (2026-09-27): a green table with
// a white border and a white centre line down its length, the opponent's cups BLUE with white
// insides, a striped brown wall over dark wood panelling behind the far end, a pale wood floor
// beside the table, strong shadows falling toward the player's left. The camera is FITTED to the
// recording (geom.js CAMERA), not designed.
//
// skeeball/MACHINE-SPEC.md Part 7 applies, and every rule in it is a defect that shipped once:
//   - the WebGLRenderer lives in `this.renderer` (ui.js hands its context back by that name)
//   - the software-GL probe is memoised per page and releases its own context
//   - shadowMap.autoUpdate is off; the pass fires only on frames a caster moved
//   - every material's .map is disposed with it (Material.dispose() does NOT free textures)
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
import { TABLE, CUP, BALL, THROW, CAMERA } from './geom.js';

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
  felt: '#00a650',
  feltEdge: '#0e8a4e',
  line: '#ffffff',
  leg: '#1c1c1e',
  floor: '#e6c592',
  floorDark: '#cfa872',
  stripeA: '#8a6a4a',
  stripeB: '#5e4329',
  panel: '#4a2e18',
  panelDark: '#2f1c0e',
  cups: { blue: '#2346c2', red: '#e02a2a' },
  cupIn: '#f4f4f2',
  ball: '#fbfaf6',
};

// A MADE CUP LIFTS OUT AND IS CARRIED OFF (the recording): up about a cup's height, then away to the
// upper right, fading. Seconds.
const LIFT_T = 0.30;
const AWAY_T = 0.45;
const SLIDE_T = 0.6;             // Gentleman's: the two cups slide into their line
const GLIDE_T = 0.7;             // the camera between the two ends

/** A camera pose from a position and a pitch (degrees down), looking along -z or +z. */
function pose(pos, pitchDeg, facing = -1) {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(...pos);
  const p = pitchDeg * Math.PI / 180;
  cam.lookAt(pos[0], pos[1] - Math.sin(p), pos[2] + facing * Math.cos(p));
  return { pos: cam.position.clone(), quat: cam.quaternion.clone() };
}
const SHOOT = pose(CAMERA.pos, CAMERA.pitch, -1);
// Behind this phone's own cups at the +z end, looking back down the table at the opponent.
const DEFEND = pose(CAMERA.defend.pos, CAMERA.defend.pitch, -1);

// The floor sits close under the table top, as in the recording, so pale wood shows beside the far
// end. (A true 0.76 m table height hid it: from this camera the gap is all wall.)
const FLOOR_Y = -0.32;
const PANEL_H = 0.45;            // the dark panelling up the wall from the floor

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.soft = isSoftGL();
    this.reduced = reducedMotion;
    this.disposed = false;
    this._shadowLive = true;
    this.cups = new Map();       // 'side:id' -> { side, group, t (vanish clock) | null, slide }
    this._tex = [];

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
    this.scene.background = new THREE.Color(LOOK.panelDark);
    this.camera = new THREE.PerspectiveCamera(CAMERA.vfov, 1, 0.05, 30);
    this.setView('shoot');
    this._build();
  }

  _canvasTex(w, h, paint, repeat) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(...repeat); }
    this._tex.push(tex);
    return tex;
  }

  _build() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.95));
    // Light from high, behind the far end and to the right: shadows fall toward the player's left,
    // the way they do in the recording.
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.4, 3.4, -2.4);
    key.target.position.set(0, 0, -0.3);
    key.castShadow = !this.soft;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -1.0; sc.right = 1.0; sc.top = 1.8; sc.bottom = -1.8; sc.near = 0.5; sc.far = 8;
    key.shadow.bias = -0.0006;
    S.add(key, key.target);

    // THE ROOM. A pale plank floor, a striped wall over dark panelling behind the far end.
    const floorTex = this._canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = LOOK.floor; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? 'rgba(160,110,50,0.10)' : 'rgba(255,255,255,0.06)';
        g.fillRect(i * w / 8, 0, w / 8, h);
        g.fillStyle = 'rgba(120,80,40,0.25)';
        g.fillRect(i * w / 8, 0, 1.5, h);
        g.fillRect(i * w / 8, ((i * 97) % h), w / 8, 1.5);
      }
    }, [6, 6]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, 0);
    floor.receiveShadow = true;
    S.add(floor);

    const wallZ = -TABLE.len / 2 - 0.22;
    const wallTex = this._canvasTex(256, 512, (g, w, h) => {
      const split = h * (1 - PANEL_H / 2.4);           // stripes above, panelling below
      const n = 8;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? LOOK.stripeB : LOOK.stripeA;
        g.fillRect((i / n) * w, 0, w / n, split);
      }
      g.fillStyle = LOOK.panelDark; g.fillRect(0, split, w, h - split);
      g.fillStyle = LOOK.panel; g.fillRect(0, split, w, 10);         // rail
      for (let i = 0; i < 3; i++) {                                    // raised panels
        const x = 8 + i * (w - 16) / 3;
        g.fillStyle = LOOK.panel;
        g.fillRect(x + 4, split + 24, (w - 16) / 3 - 8, h - split - 40);
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3;
        g.strokeRect(x + 10, split + 30, (w - 16) / 3 - 20, h - split - 52);
      }
    }, [3, 1]);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4),
      // A painted backdrop, UNLIT: the key light stands behind this wall (that is what throws the
      // shadows toward the player), so a lit wall would only ever be its dark back-lit self.
      new THREE.MeshBasicMaterial({ map: wallTex }));
    wall.position.set(0, FLOOR_Y + 1.2, wallZ);
    S.add(wall);

    // THE TABLE: green felt top with a white border and a white centre line down its length.
    const topTex = this._canvasTex(256, 1024, (g, w, h) => {
      g.fillStyle = LOOK.felt; g.fillRect(0, 0, w, h);
      g.fillStyle = LOOK.line;
      const b = 7;
      g.fillRect(0, 0, w, b); g.fillRect(0, h - b, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
      g.fillRect(w / 2 - 2, 0, 4, h);
    });
    // Matte (Lambert): felt has no sheen, and a specular one washed the green out toward grey.
    const topMat = new THREE.MeshLambertMaterial({ map: topTex });
    const sideMat = new THREE.MeshStandardMaterial({ color: LOOK.line, roughness: 0.6 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width, TABLE.thick, TABLE.len),
      [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    table.position.y = -TABLE.thick / 2;
    table.receiveShadow = true;
    table.castShadow = true;
    S.add(table);
    const legMat = new THREE.MeshStandardMaterial({ color: LOOK.leg, roughness: 0.6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const legH = -FLOOR_Y - TABLE.thick;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, legH, 0.035), legMat);
      leg.position.set(sx * (TABLE.width / 2 - 0.04), FLOOR_Y + legH / 2, sz * (TABLE.len / 2 - 0.06));
      leg.castShadow = true;
      S.add(leg);
    }
    for (const sz of [-1, 1]) {                        // the cross bar between each pair of legs
      const bar = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width - 0.08, 0.03, 0.03), legMat);
      bar.position.set(0, FLOOR_Y + 0.08, sz * (TABLE.len / 2 - 0.06));
      S.add(bar);
    }

    // One cup per side's colour, built once and cloned per cup (geometry and materials shared).
    this._cupProto = { a: this._makeCup(LOOK.cups.red), b: this._makeCup(LOOK.cups.blue) };

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.r, 24, 16),
      new THREE.MeshStandardMaterial({ color: LOOK.ball, roughness: 0.35, emissive: 0x555555 }));
    this.ball.castShadow = true;
    S.add(this.ball);
    // THE SPARE BALL, greyed at the left edge: the throw still to come this turn (the recording).
    this.spare = new THREE.Mesh(this.ball.geometry,
      new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.5 }));
    this.spare.position.set(-0.27, BALL.r, 0.06);
    this.spare.castShadow = true;
    this.spare.visible = false;
    S.add(this.spare);
    this.showRestBall();
  }

  _makeCup(color) {
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
    const mOut = new THREE.MeshStandardMaterial({ color, roughness: 0.45, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.18 });
    // The inside reads WHITE in the recording, not the grey an unlit back face gives: a little glow.
    const mIn = new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.55, side: THREE.BackSide, emissive: 0xc4c4c4 });
    const wall = new THREE.Mesh(new THREE.LatheGeometry(outer, 40), mOut);
    wall.castShadow = true;
    const inside = new THREE.Mesh(new THREE.LatheGeometry(inner, 40), mIn);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(topR, 0.0028, 8, 44),
      new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h;
    const base = new THREE.Mesh(new THREE.CircleGeometry(botR - 0.002, 32),
      new THREE.MeshStandardMaterial({ color: LOOK.cupIn, roughness: 0.6, emissive: 0xc4c4c4 }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.004;
    g.add(wall, inside, rim, base);
    return g;
  }

  /** SHOOTER FRAME -> WORLD. Every rack and every throw is described as the shooter sees it (the
   *  target at -z). Side 'b' (the opponent) is shot at by this phone's player, whose frame IS the
   *  world. Side 'a' (this phone's cups) is shot at from the far end, so its frame is the world
   *  turned half round: x and z both flip (a rotation, not a mirror - left stays left for them). */
  toWorld(side, x, z) { return side === 'a' ? { x: -x, z: -z } : { x, z }; }

  /** Put one side's cups on the table ([{ id, x, z }] in the shooter frame), replacing that side's. */
  setRack(side, cups) {
    for (const [key, c] of this.cups) if (c.side === side) { this.scene.remove(c.group); this.cups.delete(key); }
    for (const k of cups) {
      const w = this.toWorld(side, k.x, k.z);
      const group = this._cupProto[side].clone();
      group.position.set(w.x, 0, w.z);
      this.scene.add(group);
      this.cups.set(side + ':' + k.id, { side, group, t: null, x: w.x, z: w.z, slide: null });
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Back-compatible single-rack call (practice): the opponent's side. */
  setCups(cups) { this.setRack('b', cups); }

  /** GENTLEMAN'S: slide the named cups to new spots ([{ id, x, z }], shooter frame) - a visible
   *  slide so nobody thinks they teleported (brief 4b). Instant under reduced motion. */
  slideRack(side, cups) {
    for (const k of cups) {
      const c = this.cups.get(side + ':' + k.id);
      if (!c) continue;
      const w = this.toWorld(side, k.x, k.z);
      if (this.reduced) { c.x = w.x; c.z = w.z; c.group.position.set(w.x, 0, w.z); continue; }
      c.slide = { fx: c.x, fz: c.z, tx: w.x, tz: w.z, t: 0 };
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  get sliding() { for (const [, c] of this.cups) if (c.slide) return true; return false; }

  /** A made cup lifts out and is carried off. Under reduced motion it is simply gone. */
  vanish(side, id) {
    if (id === undefined) { id = side; side = 'b'; }
    const key = side + ':' + id;
    const c = this.cups.get(key);
    if (!c) return;
    if (this.reduced) { this.scene.remove(c.group); this.cups.delete(key); this.renderer.shadowMap.needsUpdate = true; return; }
    c.t = 0;
    // Each cup owns its materials from here, so fading it cannot fade every other cup.
    c.group.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o._own = true; } });
  }

  /** The ball waiting on the table at the serve spot, and whether a spare waits beside it. */
  showRestBall(spare = false) {
    this.ball.visible = true;
    this.ball.position.set(0, THROW.y0, THROW.z0);
    this.ball.quaternion.set(0, 0, 0, 1);
    this.spare.visible = !!spare;
    this.renderer.shadowMap.needsUpdate = true;
  }
  hideBall() { this.ball.visible = false; this.spare.visible = false; }

  /**
   * THE TWO VIEWS. 'shoot' is the camera fitted to the recording. 'defend' is the other end of the
   * table, behind this phone's own red cups, for the opponent's throws - the recording shows the
   * opponent's balls coming at you over your own cups, with the table's end and the floor below.
   * The move between them is a short glide (instant under reduced motion).
   */
  setView(view) {
    const pose = view === 'defend' ? DEFEND : SHOOT;
    this._view = view;
    if (this.reduced || !this._pose) {
      this._pose = { pos: pose.pos.clone(), quat: pose.quat.clone() };
      this._glide = null;
      this._applyPose();
      return;
    }
    this._glide = { from: { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() }, to: pose, t: 0 };
  }
  get gliding() { return !!this._glide; }

  _applyPose() {
    this.camera.position.copy(this._pose.pos);
    this.camera.quaternion.copy(this._pose.quat);
    this.camera.updateMatrixWorld(true);
  }

  resize(w, h) {
    if (this.disposed || !w || !h) return;
    this.renderer.setSize(w, h, true);   // `true` sets the CSS size too: an absolutely positioned
    const aspect = w / h;                // canvas is a REPLACED element and inset:0 does not stretch it
    this.camera.aspect = aspect;
    // Hold the recording's WIDTH on a taller phone (so the table is as wide as GamePigeon's), and
    // its HEIGHT on anything wider (so the ball and the rack both stay in frame).
    const T = Math.tan(CAMERA.vfov * Math.PI / 360);
    const tan = Math.max(T, T * CAMERA.aspect / aspect);
    this.camera.fov = 2 * Math.atan(tan) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Where a world point lands on the canvas, in CSS px. */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - (v.y + 1) / 2) * el.clientHeight };
  }

  /** The point on the horizontal plane y = planeY under canvas pixel (px, py), or null. */
  unproject(px, py, planeY = 0) {
    const el = this.renderer.domElement;
    if (!el.clientWidth || !el.clientHeight) return null;
    const ndc = new THREE.Vector3(px / el.clientWidth * 2 - 1, 1 - py / el.clientHeight * 2, 0.5);
    ndc.unproject(this.camera);
    const o = this.camera.position;
    const d = ndc.sub(o);
    if (Math.abs(d.y) < 1e-9) return null;
    const k = (planeY - o.y) / d.y;
    if (k <= 0) return null;
    return { x: o.x + d.x * k, z: o.z + d.z * k };
  }

  /** `ball` is the physics body (or null); `shooter` is whose throw it is ('b' = the opponent, whose
   *  frame is turned half round - see toWorld). */
  render(ball, dt = 0.016, shooter = 'a') {
    if (this.disposed) return;
    let moving = false;
    if (ball) {
      const w = shooter === 'b' ? { x: -ball.position.x, z: -ball.position.z } : { x: ball.position.x, z: ball.position.z };
      this.ball.visible = true;
      this.ball.position.set(w.x, ball.position.y, w.z);
      this.ball.quaternion.set(ball.quaternion.x, ball.quaternion.y, ball.quaternion.z, ball.quaternion.w);
      moving = true;
    }
    if (this._glide) {
      const G = this._glide;
      G.t += dt;
      const f = Math.min(1, G.t / GLIDE_T);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      this._pose = {
        pos: G.from.pos.clone().lerp(G.to.pos, e),
        quat: G.from.quat.clone().slerp(G.to.quat, e),
      };
      this._applyPose();
      if (f >= 1) this._glide = null;
      moving = true;
    }
    for (const [key, c] of this.cups) {
      if (c.slide) {
        const S = c.slide;
        S.t += dt;
        const f = Math.min(1, S.t / SLIDE_T);
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        c.x = S.fx + (S.tx - S.fx) * e;
        c.z = S.fz + (S.tz - S.fz) * e;
        c.group.position.set(c.x, 0, c.z);
        if (f >= 1) c.slide = null;
        moving = true;
      }
      if (c.t === null) continue;
      c.t += dt;
      moving = true;
      const g = c.group;
      // Carried off toward the thrower's right and away from them, whichever end that is.
      const away = c.side === 'a' ? -1 : 1;
      if (c.t < LIFT_T) {
        const f = c.t / LIFT_T;
        g.position.set(c.x, CUP.h * 1.1 * (1 - (1 - f) * (1 - f)), c.z);
      } else {
        const f = Math.min(1, (c.t - LIFT_T) / AWAY_T);
        const e = f * f;
        g.position.set(c.x + 0.9 * e * away, CUP.h * 1.1 + 0.5 * e, c.z - 0.3 * e * away);
        g.traverse((o) => { if (o._own) o.material.opacity = 1 - f; });
        if (f >= 1) {
          this.scene.remove(g);
          g.traverse((o) => { if (o._own) o.material.dispose(); });
          this.cups.delete(key);
        }
      }
    }
    // Shadows only on frames a caster moved (plus the frame after, to clear the last one).
    if (moving || this._shadowLive) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shadowLive = moving;
    }
    this.renderer.render(this.scene, this.camera);
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
    for (const k of ['a', 'b']) this._cupProto[k].traverse(free);   // may be out of the scene
    try { this.spare.material.dispose(); } catch {}
    for (const t of this._tex) { try { t.dispose(); } catch {} }
    // The context itself is handed back by ui.js (forceContextLoss on `this.renderer`).
  }
}

export default { Renderer };
