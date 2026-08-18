// skeeball/js/render.js - the machine on screen, drawn by three.js (skeeball/js/vendor/). GUARD:
// the scene is built from the SAME machine description physics.js simulates (machine.js), so
// the geometry on screen is the geometry the ball hits - plus purely cosmetic dressing (paint,
// marquee, cabinet, room) that has no physics body and never will. The ball is a real mesh
// driven by the physics body's position AND quaternion, so it visibly rolls.

import * as THREE from './vendor/three.module.min.js';
import { buildMachine } from './machine.js';

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  constructor(canvas, board) {
    this.board = board;
    this.look = board.look;
    this.G = board.geom;
    this.M = buildMachine(this.G);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.look.wall);
    this.scene.fog = new THREE.Fog(this.look.wall, 4.5, 9);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.05, 12);
    // WHERE THE PLAYER STANDS: behind the ball, looking down the lane at the board. GUARD:
    // position and aim (below) were solved by sweeping against frame.mjs's visibility checks,
    // not chosen by eye - see DECISIONS.md#camera-history before moving either. The FOV rule in
    // resize() is what actually controls how tightly the machine is framed.
    this.camera.position.set(0, 0.50, 1.20);
    {
      const a = this.M.faceToWorld(0, this.G.boardLen * 0.20, 0);
      this.camera.lookAt(a[0], a[1], a[2]);
    }

    // Software GL (SwiftShader - headless test runs, GPU-less desktops) cannot afford shadows,
    // antialiasing or a retina buffer; a real phone GPU takes all three without noticing.
    // Detect before constructing the renderer, don't assume.
    let soft = false;
    try {
      const probe = document.createElement('canvas').getContext('webgl');
      const info = probe && probe.getExtension('WEBGL_debug_renderer_info');
      const name = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
      soft = /swiftshader|software|llvmpipe/i.test(String(name));
    } catch { soft = false; }
    this.softGL = soft;
    // preserveDrawingBuffer: the canvas must be READABLE after a frame (drawImage/toDataURL) -
    // test-visual.mjs's play probe samples it, and Report a bug's screenshot captures it. A
    // WebGL canvas without this reads blank the moment the frame is composited.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !soft, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(soft ? 0.5 : Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
    this.renderer.shadowMap.enabled = !soft;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this._disposables = [];
    this._flashes = new Map();    // hole id -> mesh to pulse
    this._popups = [];
    this._particles = [];
    this._marqueeBulbs = [];
    // The four records painted on the backboard. ui.js owns the values and pushes them in via
    // setScoreboard(); the renderer only draws what it is handed, and never reads storage or the
    // network itself. Labels come in the same way so they stay translated.
    this.scoreboard = { allTime: null, best: 0, today: 0, last: null };
    this.sbLabels = { allTime: 'All Time', best: 'Your Best', today: 'Today', last: 'Last Game' };
    this._backMat = null;
    this._sbArcade = true;   // LED scoreboard; false falls back to the painted-sign version
    this._celebrateT = 0;

    this._lights();
    this._buildMachine();
    this._buildBall();
  }

  // --- construction ----------------------------------------------------------------------------

  _track(x) { this._disposables.push(x); return x; }

  _mat(opts) { return this._track(new THREE.MeshStandardMaterial(opts)); }

  _lights() {
    const hemi = new THREE.HemisphereLight(0xfff2dd, 0x201510, 1.05);
    this.scene.add(hemi);
    // Nearly overhead, only slightly off-axis: a strongly side-lit key threw a hard diagonal
    // shadow band straight across the playfield, which read as dirt on the board.
    const key = new THREE.DirectionalLight(0xffe8c8, 1.15);
    key.position.set(0.25, 2.6, 0.35);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera;
    c.left = -1.1; c.right = 1.1; c.top = 1.2; c.bottom = -3.2; c.near = 0.2; c.far = 6;
    key.target.position.set(0, 0.2, -1.9);
    this.scene.add(key, key.target);
    // A soft fill from the player side so the board face is never in its own shade.
    const fill = new THREE.DirectionalLight(0xffd9b0, 0.75);
    fill.position.set(-0.6, 0.9, 1.6);
    this.scene.add(fill);
  }

  _buildMachine() {
    const L = this.look;
    const G = this.G;
    const M = this.M;
    const wood = this._mat({ color: L.wood, roughness: 0.55, metalness: 0.05 });
    const woodDark = this._mat({ color: L.woodDark, roughness: 0.7 });
    const cabinet = this._mat({ color: L.cabinet, roughness: 0.8 });
    const faceEdge = this._mat({ color: L.faceEdge, roughness: 0.85 });
    const white = this._mat({ color: L.ring, roughness: 0.35 });
    const dark = this._mat({ color: 0x0d0a08, roughness: 0.95 });

    // The physics solids, drawn as they are (visible parts only; smooth cylinders replace the
    // segmented ring/collar boxes at identical radii).
    for (const s of M.solids) {
      // 'hump' and 'rail' are skipped here: both are drawn as ONE smooth solid instead (by
      // _rampSkin() and _sideWalls() respectively) built from the same corner points, because
      // the individual angled/stepped physics boxes read as a visible staircase.
      if (s.part === 'keep' || s.part === 'glass' || s.part === 'ringSeg' || s.part === 'cupSeg'
        || s.part === 'hump' || s.part === 'rail' || s.part === 'splitter') continue;
      if (s.part === 'cage') { this._cage(s); continue; }
      // The backboard is the cabinet's face card and the SCOREBOARD. Its material is kept on
      // `_backMat` so setScoreboard() can repaint it in place.
      let mat;
      if (s.part === 'lane' || s.part === 'hump') mat = wood;
      else if (s.part === 'board') mat = faceEdge;
      else if (s.part === 'trough' || s.part === 'kick') mat = dark;
      else if (s.part === 'backboard') {
        this._backMat = this._mat({ map: this._track(this._paintBackboard()), roughness: 0.6 });
        mat = [cabinet, cabinet, cabinet, cabinet, this._backMat, cabinet];
      } else mat = woodDark;
      const mesh = new THREE.Mesh(this._track(new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2)), mat);
      mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.rot) mesh.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      mesh.receiveShadow = true;
      // GUARD: the side walls do not cast shadows. A shadow across the scoring area reads as
      // dirt on the board - the same reason the key light is nearly overhead (see _lights).
      if (s.part !== 'lane' && s.part !== 'board' && s.part !== 'rail') mesh.castShadow = true;
      this.scene.add(mesh);
    }

    // The painted field: a plane on the face carrying the burnt-orange paint, the zone
    // stencils and every mouth's footprint - the "what is worth what" layer.
    {
      const tex = this._track(this._paintField());
      const plane = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(G.boardW, G.boardLen)),
        this._mat({ map: tex, roughness: 0.8 }),
      );
      const c = M.faceToWorld(0, G.boardLen / 2, 0.0015);
      plane.position.set(c[0], c[1], c[2]);
      plane.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - M.tilt));
      plane.receiveShadow = true;
      this.scene.add(plane);
    }

    // Lane surface detail: a long plane with plank lines and the serve arrow.
    {
      const tex = this._track(this._paintLane());
      const plane = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(G.laneW, G.laneLen + 0.02)),
        this._mat({ map: tex, roughness: 0.5 }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, 0.0012, -G.laneLen / 2);
      plane.receiveShadow = true;
      this.scene.add(plane);
    }

    this._rampSkin();
    this._sideWalls();

    // THE CUPS. A hole in a board, drawn as a hole in a board: a dark mouth flush in the face,
    // with its VALUE painted into the field texture around it (see _paintField), since every cup
    // is `collarH: 0` (boards.js) - the surface you see is the surface the ball rolls on. GUARD:
    // numbers belong on the board, not on a cup wall - see DECISIONS.md#removed-scenery.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const mouth = new THREE.Mesh(
        this._track(new THREE.CircleGeometry(H.r, 44)),
        this._mat({ color: 0x0a0705, roughness: 1 }),
      );
      this._onFace(mouth, H.u, H.v, 0.0035, true);
      this.scene.add(mouth);
      this._flashes.set(id, this._makeFlash(H));
      if (!H.collarH) continue;
      // A future machine wanting a raised rim gets one matching machine.js's own height profile.
      const wall = this._scallopedRim(H.r + G.collarThick / 2, H.collarH,
        H.lipLow ? (typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35) : 1);
      this._onFace(wall, H.u, H.v, 0);
      this.scene.add(wall);
    }

    // THE RINGS, drawn FROM THE PHYSICS SEGMENTS THEMSELVES. GUARD: every ring is one box per
    // `ringSeg` solid, at that solid's own position and rotation - not a style choice, but what
    // makes an invisible-wall bug (drawing not matching collision) structurally impossible. See
    // DECISIONS.md#removed-scenery. The 10's arc stops at the rails here for free, because
    // machine.js emitted no segments past them. Rings WILL hide their own mouths from a low
    // camera - that is intended (boards.js, `ringH`), not a defect to correct.
    {
      const ringMat = this._mat({ color: L.ring, roughness: 0.4 });
      const lipMat = this._mat({ color: L.ringLip, roughness: 0.5 });
      for (const s of M.solids) {
        if (s.part !== 'ringSeg') continue;
        const geo = this._track(new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2));
        // Navy on the lip, white on the walls - the classic board's trim, on the real segment.
        const mesh = new THREE.Mesh(geo, [ringMat, ringMat, lipMat, ringMat, ringMat, ringMat]);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        if (s.faceRot) {
          const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.faceRot.tilt);
          const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.faceRot.phi);
          mesh.quaternion.copy(qx.multiply(qy));
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
    }

    // Cabinet dressing: side panels, the marquee, its bulbs. Cosmetic only.
    this._cabinet();
  }

  /** The smooth surface laid over the ramp's facets. Cosmetic only - the boxes underneath are
   *  still the collision surface, and this samples the same profile they are built from, so it
   *  can never describe a different ramp than the one the ball meets. */
  _rampSkin() {
    const G = this.G;
    const n = G.humpAngles.length;
    const segLen = G.humpLen / n;

    // The profile's corner points, exactly as machine.js walks them.
    const corners = [new THREE.Vector3(-G.laneLen, 0, 0)];
    let y = 0;
    let z = -G.laneLen;
    for (const a of G.humpAngles) {
      y += segLen * Math.tan(a);
      z -= segLen;
      corners.push(new THREE.Vector3(z, y, 0));
    }

    const SAMPLES = 72;
    const curve = new THREE.CatmullRomCurve3(corners, false, 'catmullrom', 0.5);
    const pts = curve.getPoints(SAMPLES);

    // A closed slab: the curved top surface, both sides, and a cap at each end. Four vertices per
    // sample - left/right, top/bottom - so the ramp is one solid object with no seam to catch the
    // light and no facet to read as a step.
    const halfW = G.laneW / 2;
    const base = -0.14;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const v = i / (pts.length - 1);
      pos.push(-halfW, p.y, p.x, halfW, p.y, p.x, -halfW, base, p.x, halfW, base, p.x);
      uv.push(0, v, 1, v, 0, v, 1, v);
      if (i < pts.length - 1) {
        const b = i * 4;
        const n = b + 4;
        idx.push(b, b + 1, n + 1, b, n + 1, n);           // the curved top
        idx.push(b, n, n + 2, b, n + 2, b + 2);           // left flank
        idx.push(b + 1, b + 3, n + 3, b + 1, n + 3, n + 1); // right flank
      }
    }
    const last = (pts.length - 1) * 4;
    idx.push(0, 2, 3, 0, 3, 1);                            // foot of the ramp
    idx.push(last, last + 1, last + 3, last, last + 3, last + 2); // the crest's face

    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const tex = this._track(this._paintLane());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    const mesh = new THREE.Mesh(geo, this._mat({ map: tex, roughness: 0.5, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /** The two side walls, ONE smooth solid each, built from machine.js's railProfile - the exact
   *  hull of the WALL_SEGS physics boxes, whose flat stepped tops would otherwise read as a
   *  pixelated diagonal. The physics is untouched: same pattern as _rampSkin, applied to the
   *  rails. Side walls never cast a shadow (a shadow on the playfield reads as dirt). */
  _sideWalls() {
    const M = this.M;
    const prof = M.railProfile;         // [[z,y] x4]: front-bottom, back-bottom, back-top, front-top
    if (!prof) return;
    const xi = M.railInnerX, t = M.railT;
    const mat = this._mat({ color: this.look.woodDark, roughness: 0.7, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const xa = s * xi, xb = s * (xi + t);
      const near = prof.map(([z, y]) => [xa, y, z]);
      const far = prof.map(([z, y]) => [xb, y, z]);
      const pos = [];
      const push = (v) => pos.push(v[0], v[1], v[2]);
      const tri = (a, b, c) => { push(a); push(b); push(c); };
      tri(near[0], near[1], near[2]); tri(near[0], near[2], near[3]);   // inner face
      tri(far[0], far[2], far[1]); tri(far[0], far[3], far[2]);         // outer face
      for (let i = 0; i < 4; i++) {                                     // the rim (4 quads)
        const j = (i + 1) % 4;
        tri(near[i], far[i], far[j]); tri(near[i], far[j], near[j]);
      }
      const geo = this._track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  /** Place a Y-axis object (cylinder/torus/circle) on the face at (u, v, h). Tori and circles
   *  are flat (their plane ends up ON the face); cylinders stand along the face normal. */
  _onFace(mesh, u, v, h, flat = false) {
    const c = this.M.faceToWorld(u, v, h);
    mesh.position.set(c[0], c[1], c[2]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.M.tilt);
    mesh.quaternion.copy(q);
    if (flat) mesh.rotateX(-Math.PI / 2);
  }

  _makeFlash(H) {
    const glow = new THREE.Mesh(
      this._track(new THREE.RingGeometry(H.r * 0.9, H.r + this.G.collarThick * 2.4, 40)),
      this._track(new THREE.MeshBasicMaterial({ color: 0xffd977, transparent: true, opacity: 0 })),
    );
    this._onFace(glow, H.u, H.v, (H.collarH || 0) + 0.006, true);
    this.scene.add(glow);
    return glow;
  }

  _cage(s) {
    // Draws a physics slab as a sparse wire canopy: thin and pale so it doesn't read as the
    // subject over the board. machine.js no longer builds a 'cage' solid (see its removal
    // note); this stays in case a future machine reintroduces one.
    const mat = this._mat({
      color: 0xbfae95, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.30,
    });
    const len = s.half[2] * 2;
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.0026, 0.0026, len, 5)), mat);
      bar.position.set(s.pos[0] + (i / 3) * (s.half[0] - 0.03), s.pos[1], s.pos[2]);
      bar.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      bar.rotateX(Math.PI / 2);
      this.scene.add(bar);
    }
    for (const off of [-0.32, 0.12]) {
      const cross = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.0024, 0.0024, s.half[0] * 2, 5)), mat);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      const local = new THREE.Vector3(0, 0.012, off * len).applyQuaternion(q);
      cross.position.set(s.pos[0] + local.x, s.pos[1] + local.y, s.pos[2] + local.z);
      cross.quaternion.copy(q);
      cross.rotateZ(Math.PI / 2);
      this.scene.add(cross);
    }
  }

  _cabinet() {
    const L = this.look;
    const G = this.G;
    const M = this.M;
    const side = this._mat({ color: L.cabinet, roughness: 0.8 });
    const topY = M.faceToWorld(0, G.boardLen, 0)[1];

    // GUARD: THE TALL SIDE PANELS ARE GONE and must not be reintroduced. There is no reference
    // photo of a real machine with tall solid panels flanking the lane; from behind the ball
    // they read as the walls of a corridor. `laneRail` is the real low rail a real cabinet has.
    // If the cabinet looks flat without them, the fix is lighting, not geometry - see
    // DECISIONS.md#removed-features-and-why-they-stay-removed.

    // A dark arcade wall behind the machine. With the slabs gone the background is no longer a
    // sliver, it is the whole upper half of the frame, and a flat colour fill reads as a void.
    // Far enough back to sit inside the fog, so it fades rather than presenting a hard edge.
    {
      const backWall = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(14, 7)),
        this._mat({ color: 0x140d14, roughness: 1 }),
      );
      backWall.position.set(0, 1.6, M.lipZ - 3.4);
      backWall.receiveShadow = false;
      this.scene.add(backWall);
    }
    // The marquee over the backboard, with its bulbs.
    const mTex = this._track(this._paintMarquee());
    const marquee = new THREE.Mesh(
      this._track(new THREE.BoxGeometry(G.boardW + 0.22, 0.3, 0.05)),
      [side, side, side, side, this._mat({ map: mTex }), side],
    );
    marquee.position.set(0, topY + G.backboardH + 0.02, M.faceToWorld(0, G.boardLen, 0)[2] - 0.02);
    this.scene.add(marquee);
    const bulbGeo = this._track(new THREE.SphereGeometry(0.014, 10, 8));
    for (let i = 0; i < 7; i++) {
      const bulb = new THREE.Mesh(bulbGeo, this._track(new THREE.MeshStandardMaterial({
        color: this.look.bulb, emissive: this.look.bulb, emissiveIntensity: 0.55, roughness: 0.3,
      })));
      bulb.position.set((i / 3 - 1) * (G.boardW / 2), topY + G.backboardH + 0.19, marquee.position.z + 0.01);
      this.scene.add(bulb);
      this._marqueeBulbs.push(bulb);
    }
    // The dark arcade floor, so the machine sits IN a room instead of floating.
    const floor = new THREE.Mesh(
      this._track(new THREE.PlaneGeometry(8, 10)),
      this._mat({ color: 0x120c12, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -this.G.troughDepth - 0.06, -2);
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // --- the painted textures --------------------------------------------------------------------

  _canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** The board face paint: field colour, zone stencils, mouth footprints, the 10 slot. */
  _paintField() {
    const G = this.G;
    const L = this.look;
    const W = 1024;
    const Hpx = Math.round(W * (G.boardLen / G.boardW));
    const c = this._canvas(W, Hpx);
    const x = c.getContext('2d');
    const px = W / G.boardW;                       // pixels per metre
    const U = (u) => W / 2 + u * px;               // face u -> px
    const V = (v) => Hpx - v * px;                 // face v -> px (v up the slope = up the texture)

    x.fillStyle = L.face;
    x.fillRect(0, 0, W, Hpx);
    // Faint grain so the slope reads as a surface in perspective, not a flat colour.
    x.globalAlpha = 0.05;
    for (let i = 0; i < 40; i++) {
      x.fillStyle = i % 2 ? '#000' : '#fff';
      x.fillRect(0, (i / 40) * Hpx, W, 2);
    }
    x.globalAlpha = 1;

    // The 10 slot across the bottom edge, and its corner 0s - painted zones with BIG values.
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(0, V(0.055), W, Hpx - V(0.055));

    // Everything painted on this face is SQUASHED by perspective: the board is tilted 32 degrees
    // and seen from a low camera, so a metre up the slope covers far fewer screen pixels than a
    // metre across it. Numbers drawn round come out as letterbox slots. Drawing them stretched
    // along v by this factor makes them land on screen looking like numbers.
    const STRETCH = 1.8;
    const stencil = (txt, u, v, size, color = '#f7ecd8', ink = 'rgba(20,10,4,0.85)') => {
      x.save();
      x.translate(U(u), V(v));
      x.scale(1, STRETCH);
      x.font = `800 ${Math.round(size * px)}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.lineWidth = Math.max(3, size * px * 0.14);
      x.strokeStyle = ink;
      x.strokeText(txt, 0, 0);
      x.fillStyle = color;
      x.fillText(txt, 0, 0);
      x.restore();
    };

    // EVERY HOLE: its mouth, and its VALUE, painted on the board. GUARD: rings are NOT painted
    // here - they are real walls drawn from their own collision segments in `_build`, and a
    // second painted copy here would drift out of sync with where the wall actually is. See
    // DECISIONS.md#removed-scenery.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const cx = U(H.u);
      const cy = V(H.v);
      const rp = H.r * px;
      const grad = x.createRadialGradient(cx, cy, rp * 0.9, cx, cy, rp * 1.5);
      grad.addColorStop(0, 'rgba(20,10,4,0.45)');
      grad.addColorStop(1, 'rgba(20,10,4,0)');
      x.fillStyle = grad;
      x.beginPath();
      x.arc(cx, cy, rp * 1.5, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.arc(cx, cy, rp, 0, Math.PI * 2);
      x.fillStyle = L.pocket;
      x.fill();
    }

    // THE VALUES, mirrored either side of each mouth, placed OUTSIDE that hole's own ring. GUARD:
    // the offset is derived from each hole's own `ringD`, never a fixed column - rings are not
    // all one size, so a fixed offset buries some numbers under a ring.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const off = (H.ringD ? H.ringD / 2 : H.r) + 0.052;
      const lab = String(H.value);
      const size = H.value >= 100 ? 0.044 : 0.050;
      for (const side of [-1, 1]) {
        const u = H.u + side * off;
        // The 10's arc reaches the rails, so its numbers would land off the board; the 100s sit
        // near the corners already. Either way, anything past the edge folds back inboard.
        const uu = Math.abs(u) > G.boardW / 2 - 0.05 ? H.u - side * off : u;
        if (Math.abs(uu) > G.boardW / 2 - 0.05) continue;
        stencil(lab, uu, H.v, size, L.ring);
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  _paintLane() {
    const G = this.G;
    const W = 512;
    const Hpx = Math.round(W * ((G.laneLen + 0.02) / G.laneW));
    const c = this._canvas(W, Hpx);
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, Hpx);
    grad.addColorStop(0, this.look.woodDark);
    grad.addColorStop(0.5, this.look.wood);
    grad.addColorStop(1, this.look.wood);
    x.fillStyle = grad;
    x.fillRect(0, 0, W, Hpx);
    x.globalAlpha = 0.16;
    x.fillStyle = '#3a230f';
    for (let i = 1; i < 6; i++) x.fillRect((i / 6) * W - 1, 0, 2, Hpx);
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  /** A raised cup rim, built to machine.js's OWN height profile: low at the down-slope lip,
   *  rising to full height at the up-slope one. The classic board has no raised rims any more
   *  (every hole is flush), so nothing calls this today - it is here so the next machine that
   *  wants walls gets ones that match its physics vertex for vertex, instead of the straight
   *  cylinder plus a cosmetic -0.32 rad tilt that used to slide each cup off its own mouth.
   *
   *  There is deliberately NO number on it. Values are painted on the board (_paintField): a
   *  flat plate inside a curved wall is what bit every number on this board in half. */
  _scallopedRim(radius, height, lowFrac) {
    const N = 40;
    const t = this.G.collarThick;
    const hAt = (phi) => height * (lowFrac + (1 - lowFrac) * (Math.sin(phi) + 1) / 2);
    const pos = [];
    const push = (a, b, c) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    for (let i = 0; i < N; i++) {
      const p0 = (i / N) * Math.PI * 2;
      const p1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = hAt(p0);
      const h1 = hAt(p1);
      for (const [r, flip] of [[radius + t / 2, false], [radius - t / 2, true]]) {
        const a = [Math.cos(p0) * r, 0, Math.sin(p0) * r];
        const b = [Math.cos(p1) * r, 0, Math.sin(p1) * r];
        const c = [Math.cos(p1) * r, h1, Math.sin(p1) * r];
        const d = [Math.cos(p0) * r, h0, Math.sin(p0) * r];
        if (flip) { push(a, c, b); push(a, d, c); } else { push(a, b, c); push(a, c, d); }
      }
      // the rim's top face, closing the wall
      const ro = radius + t / 2;
      const ri = radius - t / 2;
      const a = [Math.cos(p0) * ro, h0, Math.sin(p0) * ro];
      const b = [Math.cos(p1) * ro, h1, Math.sin(p1) * ro];
      const c = [Math.cos(p1) * ri, h1, Math.sin(p1) * ri];
      const d = [Math.cos(p0) * ri, h0, Math.sin(p0) * ri];
      push(a, b, c); push(a, c, d);
    }
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this._mat({ color: 0xfdfaf3, roughness: 0.5, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** THE BACKBOARD IS THE SCOREBOARD: four records, label over value, left to right (All Time
   *  with the record holder's name, Your Best, Today, Last Game). GUARD: THE COLUMNS ARE A
   *  FIXED PIXEL WIDTH AND THE PANEL A FIXED HEIGHT - a score gaining a digit, or a long player
   *  name, cannot move anything else, because there is no layout to shift, only the paint.
   *  See DECISIONS.md#scoreboard. The backboard is the same solid, in the same place, and the
   *  ball still bounces off it exactly as before. */
  _paintBackboard() {
    const W = 2048;
    // GUARD: the texture's aspect ratio must match the real backboard solid's, or everything
    // painted on it is stretched out of proportion.
    const Hpx = Math.round(W * (this.G.backboardH / (this.G.boardW + 0.06)));
    const c = this._canvas(W, Hpx);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, Hpx);
    g.addColorStop(0, this.look.cabinet);
    g.addColorStop(1, this.look.cabinetEdge);
    x.fillStyle = g;
    x.fillRect(0, 0, W, Hpx);
    x.fillStyle = this.look.ringLip;
    x.fillRect(0, 26, W, 10);
    x.fillRect(0, Hpx - 36, W, 10);

    const s = this.scoreboard || {};
    const num = (v) => (v ? String(v) : '-');
    if (this._sbArcade) return this._paintArcadeBoard(c, x, W, Hpx, s, num);
    const cols = [
      { label: this.sbLabels.allTime, value: num(s.allTime && s.allTime.score), sub: (s.allTime && s.allTime.name) || '' },
      { label: this.sbLabels.best, value: num(s.best), sub: '' },
      { label: this.sbLabels.today, value: num(s.today), sub: '' },
      { label: this.sbLabels.last, value: s.last == null ? '-' : String(s.last), sub: '' },
    ];

    // A margin each side: the panel is a box whose face runs slightly wider than the part of it
    // the camera actually shows between the cabinet's side panels, so columns pinned to the
    // texture's edges get their outer characters shaved off. Everything lives inside the middle.
    const PAD = 78;
    const colW = (W - PAD * 2) / cols.length;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    // Shrink-to-fit inside one column, so no value or name can ever reach its neighbour. This is
    // what keeps the fixed-width promise honest when a score gains a digit or a name is long.
    const fit = (txt, weight, size, maxW) => {
      let px = size;
      x.font = `${weight} ${px}px Georgia, serif`;
      while (px > 16 && x.measureText(txt).width > maxW) {
        px -= 2;
        x.font = `${weight} ${px}px Georgia, serif`;
      }
    };
    for (let i = 0; i < cols.length; i++) {
      const cx = PAD + colW * i + colW / 2;
      if (i > 0) {
        x.fillStyle = 'rgba(0,0,0,0.28)';
        x.fillRect(PAD + colW * i - 1, 78, 2, Hpx - 156);
      }
      x.fillStyle = 'rgba(255,217,119,0.62)';
      fit(cols[i].label.toUpperCase(), 600, 34, colW - 16);
      x.fillText(cols[i].label.toUpperCase(), cx, 126);
      x.fillStyle = this.look.marqueeText;
      fit(cols[i].value, 700, 92, colW - 26);
      x.fillText(cols[i].value, cx, 232);
      if (cols[i].sub) {
        x.fillStyle = 'rgba(255,217,119,0.72)';
        fit(cols[i].sub, 600, 36, colW - 20);
        x.fillText(cols[i].sub, cx, 318);
      }
    }
    return new THREE.CanvasTexture(c);
  }

  /** THE ARCADE SCOREBOARD: a black glass panel behind a brass bezel, with the scores in real
   *  seven-segment LEDs. The unlit segments are drawn too, just barely - that ghost of the whole
   *  digit behind the lit one is the single thing that makes an LED display read as an LED
   *  display rather than as printed type. */
  _paintArcadeBoard(c, x, W, Hpx, s, num) {
    const ON = '#ffb02e';
    const LABEL = '#7ec8f0';
    const BEZEL = '#c98a3a';

    // GUARD: THE TOP OF THIS PANEL IS NOT VISIBLE IN GAME. The marquee band and its bulb bar
    // stand in front of the backboard's upper edge, so anything painted near y=0 is clipped by
    // them. Everything starts below TOP_INSET; the glass panel itself is inset to match.
    const TOP_INSET = 210;

    const bez = x.createLinearGradient(0, 0, 0, Hpx);
    bez.addColorStop(0, '#7a4e28');
    bez.addColorStop(1, '#2e1a0d');
    x.fillStyle = bez;
    x.fillRect(0, 0, W, Hpx);
    x.fillStyle = '#070405';
    x.fillRect(28, TOP_INSET, W - 56, Hpx - TOP_INSET - 34);
    x.strokeStyle = BEZEL;
    x.lineWidth = 8;
    x.strokeRect(28, TOP_INSET, W - 56, Hpx - TOP_INSET - 34);
    x.globalAlpha = 0.03;
    x.fillStyle = '#fff';
    for (let yy = TOP_INSET + 10; yy < Hpx - 44; yy += 7) x.fillRect(36, yy, W - 72, 2.4);
    x.globalAlpha = 1;

    const cols = [
      { l: this.sbLabels.allTime, v: num(s.allTime && s.allTime.score) },
      { l: this.sbLabels.best, v: num(s.best) },
      { l: this.sbLabels.today, v: num(s.today) },
      { l: this.sbLabels.last, v: s.last == null ? '-' : String(s.last) },
    ];
    const holder = ((s.allTime && s.allTime.name) || '').trim().toUpperCase();

    const finish = () => {
      const t = new THREE.CanvasTexture(c);
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return t;
    };

    // GUARD: plain bold sans, cyan label over amber value - no seven-segment digits, no glow, no
    // serif. None of those survive being shrunk to the size this panel allows on a phone. Sizes
    // are stated in ON-SCREEN pixels and converted, since the panel is only 181px wide there.
    const PX = W / 181;                       // texture pixels per on-screen pixel
    const sp = (n) => n * PX;
    const say = (txt, cx, cy, size, colour, align, maxW) => {
      x.fillStyle = colour; x.textAlign = align || 'center'; x.textBaseline = 'middle';
      let s2 = sp(size);
      x.font = `700 ${s2}px Verdana, sans-serif`;
      if (maxW) while (s2 > sp(6) && x.measureText(txt).width > maxW) {
        s2 -= sp(0.5); x.font = `700 ${s2}px Verdana, sans-serif`;
      }
      x.fillText(txt, cx, cy);
    };
    const rule = (x0, y0, w0, h0) => {
      x.globalAlpha = 0.3; x.fillStyle = BEZEL; x.fillRect(x0, y0, w0, h0); x.globalAlpha = 1;
    };
    const pad = sp(7);
    // THE PANEL HAS A SAFE AREA AT BOTH ENDS. The marquee stands in front of its top edge, and
    // the board's own top rim - a 6cm slab 2cm nearer the camera - stands in front of its bottom
    // edge. Painting to the texture's edges puts content behind both.
    const BOTTOM_INSET = Hpx * 0.14;
    const usableTop = TOP_INSET + sp(3);
    const usableH = Hpx - usableTop - BOTTOM_INSET;

    // Two by two: each value gets half the width and half the height, so the type reads twice as
    // big as any single row of four could - the layout constraint that killed every earlier
    // attempt (four numbers across a 181px panel gives each one 45px, and no texture resolution
    // fixes that). The Hub Wide Record's cell (top-left) is the only one that also carries a name:
    // the username of the player who holds it, an attribute of that one score and never a fifth
    // category, so its value sits a little higher to leave room for the holder beneath it.
    const cw = (W - pad * 2) / 2;
    const ch = usableH / 2;
    cols.forEach((r, i) => {
      const cx = pad + cw * (i % 2);
      const cy = usableTop + ch * Math.floor(i / 2);
      if (i % 2) rule(cx, cy + sp(3), sp(0.7), ch - sp(6));
      if (i > 1) rule(cx, cy, cw, sp(0.7));
      const solo = i === 0 && holder;
      say(r.l.toUpperCase(), cx + cw / 2, cy + sp(9), 9, LABEL, 'center', cw - sp(8));
      say(r.v, cx + cw / 2, cy + ch * (solo ? 0.48 : 0.62), solo ? 24 : 27, ON, 'center', cw - sp(10));
      if (solo) say(holder, cx + cw / 2, cy + ch - sp(8), 10, ON, 'center', cw - sp(8));
    });
    return finish();
  }

  /**
   * Replace the four records shown on the backboard. Called by ui.js whenever any of them can
   * have changed - on mount, when the network answers with the app-wide best, and after a rack.
   * Repaints the one texture; nothing else in the scene is touched.
   */
  setScoreboard(next) {
    this.scoreboard = { ...this.scoreboard, ...next };
    if (!this._backMat) return;
    const old = this._backMat.map;
    this._backMat.map = this._track(this._paintBackboard());
    this._backMat.needsUpdate = true;
    if (old && old.dispose) old.dispose();
  }

  /** The marquee: the MACHINE's name, on the lit band over the scoreboard. GUARD: this is the
   *  machine's name (`board.name`), not the game's - nothing about "Skeeball" belongs here. */
  _paintMarquee() {
    const W = 1024;
    const H = 192;
    const c = this._canvas(W, H);
    const x = c.getContext('2d');
    x.fillStyle = this.look.marquee;
    x.fillRect(0, 0, W, H);
    x.font = '700 104px Georgia, serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = this.look.marqueeText;
    x.fillText(this.board.name, W / 2, H / 2 + 4);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  _buildBall() {
    const R = this.G.ballR;
    // A speckled two-tone surface so the ROLL is visible - a plain sphere spins invisibly.
    const c = this._canvas(128, 64);
    const x = c.getContext('2d');
    x.fillStyle = '#efe6d4';
    x.fillRect(0, 0, 128, 64);
    x.fillStyle = 'rgba(120,90,50,0.5)';
    x.fillRect(0, 28, 128, 8);
    for (let i = 0; i < 46; i++) {
      x.globalAlpha = 0.18;
      x.beginPath();
      x.arc((i * 53) % 128, (i * 29) % 64, 2.2, 0, Math.PI * 2);
      x.fillStyle = i % 2 ? '#6b4a26' : '#fffdf6';
      x.fill();
    }
    const tex = this._track(new THREE.CanvasTexture(c));
    this.ball = new THREE.Mesh(
      this._track(new THREE.SphereGeometry(R, 30, 22)),
      this._mat({ map: tex, roughness: 0.42, metalness: 0.02 }),
    );
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);
  }

  // --- per-frame -------------------------------------------------------------------------------

  resize(w, h) {
    // updateStyle TRUE: a position:absolute canvas is a replaced element, so inset:0 alone does
    // NOT stretch it - without an explicit CSS size the buffer draws unscaled at the top-left
    // and the frame is a crop. (Cost a whole debugging session; leave this true.)
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;

    const eye = this.camera.position;
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const topY = this.M.faceToWorld(0, this.G.boardLen, 0)[1];
    const topZ = this.M.faceToWorld(0, this.G.boardLen, 0)[2];
    const halfW = this.G.boardW / 2;

    // FRAME THE WHOLE MACHINE. Every point below has to be inside the canvas with room to
    // spare, and the FOV is simply the smallest one that achieves that.
    //
    // GUARD: do not go back to fitting a single point (e.g. just the resting ball) - fit the
    // LIST, and add to the list if a future machine grows a part that must stay visible. See
    // DECISIONS.md#camera-history for what single-point framing broke last time.
    const FIT = [
      [0, topY + this.G.backboardH + 0.21, topZ - 0.02],            // marquee, bulbs included
      [-halfW, topY + this.G.backboardH - 0.01, topZ - 0.02],       // backboard top corners
      [halfW, topY + this.G.backboardH - 0.01, topZ - 0.02],
      this.M.faceToWorld(-halfW, this.G.boardLen, 0),               // board corners, all four
      this.M.faceToWorld(halfW, this.G.boardLen, 0),
      this.M.faceToWorld(-halfW, 0, 0),
      this.M.faceToWorld(halfW, 0, 0),
      [0, this.G.ballR, -0.12],                                     // the ball waiting to be thrown
      [0, 0, -0.02],                                                // the near end of the lane
    ];
    // MARGIN: a point at 0.99 of the way to the edge is technically on screen and still reads as
    // cut off. Fit to 90% of the half-frame so the cabinet has air around it.
    //
    // Deliberately TIGHTER than the 0.92 frame.mjs asserts. Whichever point binds the fit lands
    // exactly ON this number, so fitting and asserting at the same value makes the test a
    // coin-flip on floating-point rounding. The 0.02 gap is the slack that keeps it meaningful.
    const MARGIN = 0.90;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const up2 = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    let needV = 0, needHalfH = 0;
    for (const p of FIT) {
      const d = new THREE.Vector3(p[0], p[1], p[2]).sub(eye);
      const along = d.dot(axis);
      if (along <= 0.01) continue;                                  // behind the eye; cannot be framed
      needV = Math.max(needV, Math.atan(Math.abs(d.dot(up2)) / along / MARGIN));
      needHalfH = Math.max(needHalfH, Math.atan(Math.abs(d.dot(right)) / along / MARGIN));
    }
    // Vertical need and horizontal need, both expressed as a vertical FOV; take the larger.
    const vFov = Math.max(2 * needV, 2 * Math.atan(Math.tan(needHalfH) / this.camera.aspect));

    this.camera.fov = Math.min(72, Math.max(30, (vFov * 180) / Math.PI));
    this.camera.updateProjectionMatrix();
  }

  render(game, dt) {
    const st = game && game.ball;    // the physics throw state; st.ball is the cannon body
    if (st && st.ball) {
      this.ball.visible = true;
      const p = st.ball.position;
      this.ball.position.set(p.x, p.y, p.z);
      const q = st.ball.quaternion;
      this.ball.quaternion.set(q.x, q.y, q.z, q.w);
    } else {
      // Waiting on the lane: show the next ball at the serve spot while the rack is live.
      if (game && !game.over) {
        this.ball.visible = true;
        this.ball.position.set(0, this.G.ballR, -0.12);
      } else this.ball.visible = false;
    }

    const step = REDUCED ? 0 : dt;
    for (const [, glow] of this._flashes) {
      if (glow.material.opacity > 0) glow.material.opacity = Math.max(0, glow.material.opacity - dt * 1.6);
    }
    for (let i = this._popups.length - 1; i >= 0; i--) {
      const s = this._popups[i];
      s.userData.t += dt;
      s.position.y += step * 0.22;
      s.material.opacity = Math.max(0, 1 - s.userData.t / 1.1);
      if (s.userData.t > 1.1) { this.scene.remove(s); s.material.dispose(); this._popups.splice(i, 1); }
    }
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const pt = this._particles[i];
      pt.userData.t += dt;
      pt.userData.vel.y -= dt * 2.2;
      pt.position.addScaledVector(pt.userData.vel, dt);
      pt.material.opacity = Math.max(0, 0.9 - pt.userData.t);
      if (pt.userData.t > 1) { this.scene.remove(pt); this._particles.splice(i, 1); }
    }
    if (this._celebrateT > 0) {
      this._celebrateT -= dt;
      const on = REDUCED ? 1 : (Math.sin(this._celebrateT * 18) > 0 ? 1.6 : 0.25);
      for (const b of this._marqueeBulbs) b.material.emissiveIntensity = on;
      if (this._celebrateT <= 0) for (const b of this._marqueeBulbs) b.material.emissiveIntensity = 0.55;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // --- event visuals (ui.js drains game events into these) -------------------------------------

  flashHole(id) {
    const glow = this._flashes.get(id);
    if (glow) glow.material.opacity = 1;
  }

  /** A rising score popup at a world position. */
  popupAt(pos, text, color, big) {
    const c = this._canvas(256, 128);
    const x = c.getContext('2d');
    x.font = `800 ${big ? 84 : 64}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(0,0,0,0.7)';
    x.strokeText(text, 128, 64);
    x.fillStyle = color;
    x.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(big ? 0.34 : 0.26, big ? 0.17 : 0.13, 1);
    s.position.set(pos.x, pos.y + 0.1, pos.z);
    s.userData.t = 0;
    this.scene.add(s);
    this._popups.push(s);
  }

  burstAt(pos, color, n) {
    if (REDUCED) return;
    const geo = this._track(new THREE.SphereGeometry(0.011, 6, 5));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      m.position.set(pos.x, pos.y + 0.05, pos.z);
      const a = (i / n) * Math.PI * 2;
      m.userData = { t: 0, vel: new THREE.Vector3(Math.cos(a) * 0.8, 1.3 + (i % 3) * 0.3, Math.sin(a) * 0.5) };
      this.scene.add(m);
      this._particles.push(m);
    }
  }

  celebrate() { this._celebrateT = 1.6; }

  // --- teardown --------------------------------------------------------------------------------

  dispose() {
    for (const p of this._popups) { this.scene.remove(p); p.material.dispose(); }
    for (const p of this._particles) this.scene.remove(p);
    this._popups = [];
    this._particles = [];
    for (const d of this._disposables) { if (d && d.dispose) d.dispose(); }
    this._disposables = [];
    this.renderer.dispose();
  }
}

export default { Renderer };
