// hoops4/js/render.js - CONNECT 4 HOOPS on screen, three.js.
//
// GUARD: EVERY SOLID IS DRAWN FROM machine.js's OWN LIST, so the wall you see is the wall the
// ball hits and the two cannot drift. Only three parts are drawn as something other than their
// box: the collars (a smooth rim and a net, because 14 boxes read as a cog), and the two
// invisible ones - 'throat' and 'keep' - which are containment inside the cabinet and under the
// tread, not furniture.
//
// MACHINE-SPEC.md Part 7 applies here and every rule in it is a defect that shipped once:
//   - the WebGLRenderer lives in `this.renderer`, because js/ui.js's releaseRenderer() calls
//     r.renderer.forceContextLoss() BY THAT NAME to hand the context back.
//   - the software-GL probe is memoised per page and releases its own context.
//   - shadowMap.autoUpdate is off; the pass fires only on frames a caster moved.
//   - every material's .map is disposed with it (Material.dispose() does NOT free textures).
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
// The screen's face on the cabinet. Imported rather than re-derived so render.js and the
// geometry can never disagree about where the display hangs.
import { SCREEN_V } from './boarddef.js';

// One probe per PAGE, and it hands its context back. A per-Renderer probe leaked one WebGL
// context per construction and is half of what throttled the whole hub on 2026-08-26.
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

const COL = (h) => new THREE.Color(h);

export class Renderer {
  constructor(canvas, board, machine) {
    this.board = board;
    this.M = machine;
    this.G = board.geom;
    this.look = board.look;
    this.soft = isSoftGL();
    this.disposed = false;
    this._shadowBalls = -1;
    this._trash = [];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.soft,
      // test-visual's play probe and Report a bug both READ this canvas; it is blank without it.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(this.soft ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = !this.soft;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = COL(this.look.wall);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 40);

    this._build();
  }

  _mat(part) {
    const L = this.look;
    const m = (c, rough = 0.85, metal = 0) =>
      new THREE.MeshStandardMaterial({ color: COL(c), roughness: rough, metalness: metal });
    switch (part) {
      case 'lane': case 'ramp': case 'rampSkin': return m(L.wood, 0.8);
      case 'board': return m(L.face, 0.9);
      case 'riser': return m(L.faceEdge, 0.9);
      case 'rail': return m(L.cabinet, 0.7);
      case 'backboard': return m(L.marquee, 0.9);
      case 'trough': case 'troughWall': case 'kick': return m(L.cabinetEdge, 0.9);
      case 'fin': case 'finCap': return m(L.ringLip, 0.6, 0.15);
      case 'chamfer': return m(L.cabinet, 0.8);
      default: return m(L.cabinetEdge, 0.9);
    }
  }

  _build() {
    const G = this.G, M = this.M, L = this.look;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(0.8, 2.4, 1.2);
    if (!this.soft) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      const c = key.shadow.camera;
      c.left = -1.6; c.right = 1.6; c.top = 1.6; c.bottom = -2.6; c.near = 0.1; c.far = 8;
    }
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffd9a0, 0.3);
    fill.position.set(-1.2, 1.4, 0.6);
    this.scene.add(fill);

    // --- every solid, as its own box -----------------------------------------------------------
    // Merged per part into one geometry: a box per solid was ~280 draw calls before any dressing.
    const byPart = new Map();
    for (const s of M.solids) {
      if (s.part === 'keep' || s.part === 'throat' || s.part === 'cupSeg') continue;
      if (!byPart.has(s.part)) byPart.set(s.part, []);
      byPart.get(s.part).push(s);
    }
    const tmp = new THREE.Object3D();
    for (const [part, list] of byPart) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = this._mat(part);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = !this.soft && part !== 'lane';
      mesh.receiveShadow = !this.soft;
      list.forEach((s, i) => {
        tmp.position.set(s.pos[0], s.pos[1], s.pos[2]);
        tmp.quaternion.identity();
        if (s.rot) tmp.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
        else if (s.faceRot) {
          const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.faceRot.tilt);
          const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.faceRot.phi);
          tmp.quaternion.copy(qx.multiply(qy));
          // The same 45 the physics body gets, in the same order, or a drawn fin ridge sits at a
          // different angle to the one the ball rides off.
          if (s.spin45) {
            tmp.quaternion.multiply(
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4));
          }
        }
        tmp.scale.set(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this._trash.push(geo, mat);
    }

    // --- the hoops: a rim and a net per hole ---------------------------------------------------
    this.rims = {};
    for (const [id, H] of Object.entries(G.holes)) {
      const fr = M.frameAt(H.v);
      const p = M.faceToWorld(H.u, H.v, H.collarH);
      const g = new THREE.Group();
      g.position.set(p[0], p[1], p[2]);
      // THE MOUTH LIES IN THE SHELF'S PLANE, so the group's local +Y must be the face NORMAL.
      // faceToWorld's h direction is (0, cos tilt, sin tilt), and rotating (0,1,0) about X by
      // `tilt` gives exactly that - so the rotation IS the tilt.
      //
      // It was `fr.tilt - Math.PI/2`, which is 90 degrees too far: that maps local +Y to nearly
      // -Z, so every rim stood UP as a vertical ring facing the player with its net trailing
      // backwards into the cabinet. Matt: "You put the baskets backwards".
      g.rotation.x = fr.tilt;

      const rimGeo = new THREE.TorusGeometry(H.r, 0.008, 8, 28);
      const rimMat = new THREE.MeshStandardMaterial({
        color: COL(L.ring), roughness: 0.45, metalness: 0.35,
        emissive: COL(L.ring), emissiveIntensity: 0.18,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      this._trash.push(rimGeo, rimMat);

      // the net: a cone of line segments, one merged buffer (never a mesh per strand)
      const pts = [];
      const N = 12, depth = H.collarH * 1.7;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const a2 = ((i + 1) / N) * Math.PI * 2;
        const rTop = H.r, rBot = H.r * 0.55;
        pts.push(rTop * Math.cos(a), 0, rTop * Math.sin(a));
        pts.push(rBot * Math.cos(a), -depth, rBot * Math.sin(a));
        pts.push(rBot * Math.cos(a), -depth, rBot * Math.sin(a));
        pts.push(rBot * Math.cos(a2), -depth, rBot * Math.sin(a2));
      }
      const netGeo = new THREE.BufferGeometry();
      netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const netMat = new THREE.LineBasicMaterial({ color: COL(L.net), transparent: true, opacity: 0.8 });
      g.add(new THREE.LineSegments(netGeo, netMat));
      this._trash.push(netGeo, netMat);

      this.scene.add(g);
      this.rims[id] = { group: g, rim, mat: rimMat };
    }

    // --- THE SCREEN: the Connect 4 board, on the back wall -------------------------------------
    // The real cabinet shows the grid on an LCD above the hoops, which is also what makes this
    // buildable: 42 discs are PAINT, not 42 rigid bodies, and the physics only ever has to answer
    // "which hoop did it go through".
    // IT HANGS ON THE RISER DIRECTLY BELOW THE HOOPS, face-on to the player - which is where the
    // real cabinet's display is, and where this game's own mockup put it. The first build hung it
    // on the back wall ABOVE a three-tread staircase, two steps higher than the hoops.
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.width = 1100;
    this.gridCanvas.height = 460;
    this.gridTex = new THREE.CanvasTexture(this.gridCanvas);
    this.gridTex.colorSpace = THREE.SRGBColorSpace;
    const [v0, v1] = SCREEN_V;
    const lo = M.faceToWorld(0, v0, 0.012);
    const hi = M.faceToWorld(0, v1, 0.012);
    const sh = Math.abs(hi[1] - lo[1]);
    const sw = sh * (1100 / 460);
    const scrGeo = new THREE.PlaneGeometry(sw, sh);
    const scrMat = new THREE.MeshBasicMaterial({ map: this.gridTex });
    this.screen = new THREE.Mesh(scrGeo, scrMat);
    // The riser's own outward normal is +Z (its tilt is PI/2), and a PlaneGeometry already faces
    // +Z, so it needs no rotation - it sits flat on the riser looking at the player.
    this.screen.position.set(0, (lo[1] + hi[1]) / 2, Math.max(lo[2], hi[2]) + 0.012);
    this.scene.add(this.screen);
    this._trash.push(scrGeo, scrMat);
    this.setGrid(null, null);

    // --- the ball ------------------------------------------------------------------------------
    const bGeo = new THREE.SphereGeometry(G.ballR, this.soft ? 12 : 22, this.soft ? 10 : 16);
    this.ballMat = new THREE.MeshStandardMaterial({ color: COL(L.red), roughness: 0.75 });
    this.ballMesh = new THREE.Mesh(bGeo, this.ballMat);
    this.ballMesh.castShadow = !this.soft;
    this.ballMesh.visible = false;
    this.scene.add(this.ballMesh);
    this._trash.push(bGeo, this.ballMat);

    // THE CAMERA IS FRAMED ON THE TWO THINGS THAT MUST ALWAYS BE VISIBLE - the hoop row and the
    // screen above it - rather than on the board's width. Skeeball learned this: fitting the
    // width alone gives a vertical field too narrow to hold the near end of the machine on a tall
    // phone. The lane still has to read as a lane (it is what the player swipes on) but it must
    // not own half the frame, which the first cut did.
    const hoopW = M.faceToWorld(0, Object.values(G.holes)[0].v, 0);
    // Aimed nearer the HOOPS than the screen: aiming at the midpoint tilted the camera up and
    // left a third of the frame as dead ceiling while the lane the player swipes on fell off the
    // bottom edge. The lane has to stay in shot - it is the control surface.
    // Framed on the two things that must always be visible TOGETHER: the hoop row and the screen
    // below it. They are the machine. Aiming at the hoops alone put the screen off the bottom.
    const mid = (this.screen.position.y + hoopW[1]) / 2;
    this._aimAt = new THREE.Vector3(0, mid, hoopW[2] + 0.12);
    this.camera.position.set(0, hoopW[1] + 0.22, 0.62);
    this.camera.lookAt(this._aimAt);
  }

  /** Paint the Connect 4 grid onto the backboard screen. `cells[c][r]`, r=0 at the bottom. */
  setGrid(cells, win) {
    const cv = this.gridCanvas, x = cv.getContext('2d');
    const L = this.look, C = 7, R = 6;
    x.fillStyle = '#0a0c10'; x.fillRect(0, 0, cv.width, cv.height);     // the bezel
    // The grid keeps its own 7:6 aspect and is centred in a wider panel, the way a real cabinet's
    // display sits inside its surround - rather than being stretched to the panel.
    const pad = 16;
    const ch = (cv.height - pad * 2) / R;
    const cw = ch;
    const gw = cw * C, gh = ch * R;
    const ox = (cv.width - gw) / 2, oy = (cv.height - gh) / 2;
    x.fillStyle = L.face;
    x.fillRect(ox - 10, oy - 10, gw + 20, gh + 20);
    const rad = Math.min(cw, ch) * 0.40;
    for (let c = 0; c < C; c++) {
      for (let r = 0; r < R; r++) {
        const cxp = ox + cw * (c + 0.5);
        const cyp = oy + ch * (R - 1 - r + 0.5);
        const who = cells && cells[c] ? cells[c][r] : null;
        x.beginPath(); x.arc(cxp, cyp, rad, 0, Math.PI * 2);
        x.fillStyle = who === 0 ? L.red : who === 1 ? L.yellow : '#0d2c52';
        x.fill();
        const isWin = win && win.some((w) => w[0] === c && w[1] === r);
        x.lineWidth = isWin ? 7 : 3;
        x.strokeStyle = isWin ? '#2e9d4a' : '#3a74b5';
        x.stroke();
      }
    }
    this.gridTex.needsUpdate = true;
  }

  /** Light the rim of the hoop a ball just went through. */
  flashRim(id) {
    const r = this.rims[id];
    if (!r) return;
    r.mat.emissiveIntensity = 1.4;
    r._flash = 0.5;
  }

  setBallColor(hex) { if (this.ballMat) this.ballMat.color.set(hex); }

  resize(w, h) {
    if (this.disposed || !w || !h) return;
    this.renderer.setSize(w, h, true);   // `true` sets the CSS size too - an absolutely
    this.camera.aspect = w / h;          // positioned canvas is a REPLACED element and inset:0
    // Widen the field on a narrow screen so the cabinet's full width still fits: this board is
    // 10.44X across, the widest in the repo, and a phone-shaped frustum clips it otherwise.
    this.camera.fov = w / h < 0.62 ? 62 : 52;
    this.camera.updateProjectionMatrix();// does NOT stretch it; without this the frame is a crop.
    if (this._aimAt) this.camera.lookAt(this._aimAt);
    this.renderer.shadowMap.needsUpdate = true;
  }

  render(balls, dt = 0.016) {
    if (this.disposed) return;
    const live = balls && balls.length ? balls : [];
    if (live.length) {
      const b = live[0];
      this.ballMesh.visible = true;
      this.ballMesh.position.set(b.position.x, b.position.y, b.position.z);
      this.ballMesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    } else {
      this.ballMesh.visible = false;
    }
    for (const id of Object.keys(this.rims)) {
      const r = this.rims[id];
      if (r._flash > 0) {
        r._flash = Math.max(0, r._flash - dt);
        r.mat.emissiveIntensity = 0.18 + 1.2 * (r._flash / 0.5);
      }
    }
    // Shadows only on frames a caster actually moved: the machine is a still life while the
    // player lines up, and the pass redraws every caster a second time.
    if (live.length || live.length !== this._shadowBalls) {
      this.renderer.shadowMap.needsUpdate = true;
      this._shadowBalls = live.length;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this._trash) { try { o.dispose && o.dispose(); } catch {} }
    // Material.dispose() does NOT dispose its textures - that leak was ~1 MB a rack on BRICK CITY.
    try { this.gridTex.dispose(); } catch {}
    this.scene.traverse((o) => {
      if (o.geometry) { try { o.geometry.dispose(); } catch {} }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) { try { m.map && m.map.dispose(); m.dispose(); } catch {} }
    });
    // NOTE: the context itself is handed back by js/ui.js's releaseRenderer(), which reaches in
    // by the name `renderer`. dispose() alone leaves the context alive.
  }
}

export default { Renderer };
