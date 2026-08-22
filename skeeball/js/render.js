// skeeball/js/render.js - the machine on screen, drawn by three.js (skeeball/js/vendor/). GUARD:
// the scene is built from the SAME machine description physics.js simulates (machine.js), so
// the geometry on screen is the geometry the ball hits - plus purely cosmetic dressing (paint,
// marquee, cabinet, room) that has no physics body and never will. The ball is a real mesh
// driven by the physics body's position AND quaternion, so it visibly rolls.

import * as THREE from './vendor/three.module.min.js';
import { buildMachine } from './machine.js';
import { BALLS_PER_GAME } from './boards.js';

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A NUMBER'S SIZE ON A WALL, as a share of that wall's height, and the widest arc it may wrap
// before it stops reading. Shared by all three number routines so they cannot drift apart.
const NUM_CAP = 0.46;
const MAX_WRAP = 65 * Math.PI / 180;
// A digit's width at NUM_CAP, as a multiple of the wall height: 0.6 em advance, 0.72 em cap
// height, plus the 1.30 side margin the painters use. Only ever used to decide which side of
// MAX_WRAP a number falls on, so an estimate is enough.
const DIGIT_W = 0.6 / 0.72 * 1.30;

/** WHICH NUMBERS CANNOT GO ON A RING WALL - derived from the board, so a NEW MACHINE CONFIGURES
 *  ITSELF and nobody has to remember this.
 *
 *  Every centre-column number except the top one would otherwise be painted on the OUTER wall of
 *  the ring above its hole. That wall is convex: it curves away from the player at its edges, so
 *  past about 65 degrees of wrap a digit turns edge-on and vanishes behind the ring's own
 *  silhouette. On THE CLASSIC that is exactly what happened to the 30 and the 40, which sit on
 *  the two tightest rings on the board (11-12cm across) - they shipped clipped on 2026-08-19.
 *
 *  Those numbers get a concave arc instead (see _numberPlates). The top hole never needs one: its
 *  own ring is the last in the stack, so that ring's far wall is free and the number goes there,
 *  which is what the 50 does.
 *
 *  BUILDING A NEW BOARD: nothing to set. Widen a ring and its number moves back onto the wall by
 *  itself; tighten one and it gets an arc. If a number looks wrong, this threshold is the knob.
 */
function platedHoles(G) {
  const column = Object.keys(G.holes)
    .filter((id) => G.holes[id].ringD && Math.abs(G.holes[id].u) < 1e-6)
    .sort((a, b) => G.holes[a].v - G.holes[b].v);
  const out = new Set();
  for (let i = 0; i < column.length - 1; i++) {
    const digits = String(G.holes[column[i]].value).length;
    const target = G.holes[column[i + 1]];
    const Rwall = target.ringD / 2 + G.ringThick / 2;
    const ink = digits * DIGIT_W * G.ringH * NUM_CAP;
    if (ink / Rwall > MAX_WRAP) out.add(column[i]);
  }
  return out;
}

// How much of a ring's white is SELF-LIT rather than lit by the scene. See the GUARD in the ring
// block of _buildMachine: without this the walls render warm grey, because they stand edge-on to
// a nearly-overhead key light. Raising it flattens the rings; lowering it greys them.
const RING_GLOW = 0.60;

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
    this._neighbours();
    this._ballTray();
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
      if (s.part === 'keep' || s.part === 'ringSeg' || s.part === 'cupSeg'
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
      // GUARD: THE RINGS MUST READ WHITE, AND AN ALBEDO ALONE WILL NOT DO IT. Every ring wall
      // stands perpendicular to a board tilted 45 degrees, so its normal lies IN the board plane
      // and the nearly-overhead key light (see _lights) does no more than graze it. The wall at
      // the bottom of each ring - the one facing the player, the one you look straight at - gets
      // no key at all, and a white albedo there renders about #9b8978: the warm grey of item 14.
      // The emissive floor is what makes every face read white from every angle. Fix it HERE, on
      // this one material: moving or adding a light to chase it relights the whole machine, and
      // the key's position is itself the fix for an older bug.
      const ringMat = this._mat({
        color: L.ring, roughness: 0.4, emissive: L.ring, emissiveIntensity: RING_GLOW,
      });
      const lipMat = this._mat({ color: L.ringLip, roughness: 0.5 });
      const numbers = this._ringNumbers(RING_GLOW);
      this._numberPlates(RING_GLOW);
      const EMPTY = {};
      for (const s of M.solids) {
        if (s.part !== 'ringSeg') continue;
        const geo = this._track(new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2));
        // Navy on the lip, white on the walls - the classic board's trim, on the real segment.
        // `faceRot` aims the box's +Z face radially OUTWARD on every segment and -Z inward, so
        // slot 4 is the wall seen from outside the ring and slot 5 the one seen through its mouth.
        // Slots 0 and 1 are the box's own side faces, the ones that show as slivers at the seams.
        const n = numbers.get(s) || EMPTY;
        const mesh = new THREE.Mesh(geo, [
          n.xHi || ringMat, n.xLo || ringMat, lipMat, ringMat, n.outer || ringMat, n.inner || ringMat,
        ]);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        if (s.faceRot) {
          const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.faceRot.tilt);
          const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.faceRot.phi);
          mesh.quaternion.copy(qx.multiply(qy));
        }
        mesh.castShadow = true;
        // GUARD: a ring does NOT receive shadows. It is 20-57 separate boxes standing flush
        // against one another and only 15mm thick - well under the shadow map's texel footprint -
        // so they acne each other into a speckled grey band, the other half of item 14. They
        // still CAST, which is what gives the rings their form against the face.
        mesh.receiveShadow = false;
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

  /** THE MACHINES EITHER SIDE. Real skeeball is a ROW of cabinets; on its own ours reads as a
   *  model floating in a void.
   *
   *  GUARD 1 - THEY ARE SET BACK, and that is not a style choice. Measured against the play
   *  camera: a neighbour level with us puts its marquee at screen y = 0.2%, i.e. off the top edge,
   *  so all that survives in frame is a slab of dark cabinet - which is exactly how the first
   *  attempt at this ended up looking like a corridor wall rather than a machine. Set back 1.6m
   *  its marquee lands at y = 15% and about 28% of its board width is on screen. Move it and
   *  re-measure, or it goes back to being a wall.
   *
   *  GUARD 2 - THEY ARE MACHINES, NOT MASSES. What makes a shape read as skeeball at the frame
   *  edge is the lit marquee, the orange board and the white rings, in that order - not the
   *  silhouette. Dark slabs in roughly the right shape do not read as anything. So each neighbour
   *  gets the real board paint (the same texture object as ours), real ring cylinders, and a lit
   *  band, dimmed by material colour rather than by leaving detail out.
   *
   *  GUARD 3 - dressing only. No physics body, no shadows, no cup mouths, no scoring parts. The
   *  ball never reaches them and never will.
   */
  _neighbours() {
    const G = this.G;
    const fieldTex = this._track(this._paintField());
    const laneTex = this._track(this._paintLane());
    // A ROW: both at the same offset and the same depth, so they are two of the same cabinet
    // rather than two different ones. GUARD: they were briefly staggered to stop their marquee
    // bands ruling one lit line across the frame; that worked but made the pair look mismatched,
    // which reads as a bug rather than as character when there are only two. The line is held off
    // by keeping the band dim instead (see its emissiveIntensity) - if it ever comes back, dim the
    // band or narrow it, do not stagger the machines.
    for (const side of [-1, 1]) this._neighbourMachine(side * 1.15, -1.6, fieldTex, laneTex);
  }

  /** One background machine, at (dx) across and (dz) further from the player. */
  _neighbourMachine(dx, dz, fieldTex, laneTex) {
    const G = this.G;
    const M = this.M;
    const DIM = 0x6b6b6b;                     // multiplies the shared paint down; see GUARD 2
    const at = (u, v, h) => { const c = M.faceToWorld(u, v, h); return [c[0] + dx, c[1], c[2] + dz]; };
    const add = (mesh) => { mesh.castShadow = false; mesh.receiveShadow = false; this.scene.add(mesh); return mesh; };
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), M.tilt);

    // the board face, in the machine's own paint
    {
      const plane = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(G.boardW, G.boardLen)),
        this._mat({ map: fieldTex, color: DIM, roughness: 0.9 }),
      );
      plane.position.set(...at(0, G.boardLen / 2, 0.0015));
      plane.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - M.tilt));
      add(plane);
    }
    // the lane running back toward the player
    {
      const plane = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(G.laneW, G.laneLen)),
        this._mat({ map: laneTex, color: DIM, roughness: 0.95 }),
      );
      plane.position.set(dx, 0.001, -G.laneLen / 2 + dz);
      plane.rotation.x = -Math.PI / 2;
      add(plane);
    }
    // the rings: what actually says "skeeball" from the frame edge
    {
      const white = this._mat({ color: 0xb9b4ac, roughness: 0.6 });
      for (const id of Object.keys(G.holes)) {
        const H = G.holes[id];
        if (!H.ringD) continue;
        const R = H.ringD / 2 + G.ringThick / 2;
        const cv = H.v - H.r + H.ringD / 2;
        const ring = new THREE.Mesh(
          this._track(new THREE.CylinderGeometry(R, R, G.ringH, 20, 1, true)), white,
        );
        ring.position.set(...at(H.u, cv, G.ringH / 2));
        ring.quaternion.copy(tiltQ);
        ring.material.side = THREE.DoubleSide;
        add(ring);
      }
    }
    // cabinet: two side walls down the length, the backboard, and the lit band over it
    {
      const wood = this._mat({ color: 0x4a2c17, roughness: 0.95 });
      const dark = this._mat({ color: 0x1f1209, roughness: 1 });
      const lip = at(0, 0, 0);
      const top = at(0, G.boardLen, 0);
      const floorY = -G.troughDepth - 0.06;
      const nearZ = 0.1 + dz;
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(
          this._track(new THREE.BoxGeometry(0.07, Math.abs(floorY) + 0.16, nearZ - top[2])),
          wood,
        );
        wall.position.set(dx + sx * (G.boardW / 2 + 0.02), (floorY + 0.16) / 2, (nearZ + top[2]) / 2);
        add(wall);
      }
      const back = new THREE.Mesh(
        this._track(new THREE.BoxGeometry(G.boardW * 1.04, G.backboardH, 0.08)), dark,
      );
      back.position.set(dx, top[1] + G.backboardH / 2, top[2] - 0.03);
      add(back);
      const band = new THREE.Mesh(
        this._track(new THREE.BoxGeometry(G.boardW * 1.16, 0.3, 0.09)),
        this._mat({ color: this.look.marquee, emissive: this.look.marqueeText,
          // GUARD: barely lit. Both neighbours' bands sit at the same height and read as ONE
          // horizontal line across the frame, so anything brighter than this stops being a row of
          // marquees and becomes a lit stripe on a wall behind the machine.
          emissiveIntensity: 0.075, roughness: 0.9 }),
      );
      band.position.set(dx, top[1] + G.backboardH + 0.16, top[2] - 0.02);
      add(band);
    }
  }

  /** THE BALL RETURN: the channel down the right-hand side where the balls you have not thrown
   *  yet are waiting. GUARD: dressing again - the balls in it are props with no physics body, and
   *  the one you actually throw is `this.ball`, served at the lane's near end as it always was.
   *  What this buys is that the next ball now comes from SOMEWHERE. It was already instant (the
   *  swipe re-arms the moment a ball settles, ~0.17s after it drops in) but it appeared out of
   *  nothing, which read as a wait that was never there.
   *
   *  Placed against the outside of the right rail and running UP the lane, because that is where
   *  it is visible: measured on a portrait stage, a tray beside the near end of the lane is off
   *  the right edge of the screen entirely - the rails reach the frame edge down there. */
  _ballTray() {
    const G = this.G;
    const railX = G.laneW / 2;
    const x0 = railX + 0.02;                       // inner face, just clear of the rail
    const w = 0.17;
    const cx = x0 + w / 2;
    const zNear = -0.55;
    const zFar = -1.52;
    const cz = (zNear + zFar) / 2;
    const half = (zNear - zFar) / 2;
    const floorY = -0.012;
    const wood = this._mat({ color: this.look.woodDark, roughness: 0.75 });
    const edge = this._mat({ color: this.look.cabinetEdge, roughness: 0.85 });

    const box = (px, py, pz, hx, hy, hz, mat) => {
      const m = new THREE.Mesh(this._track(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)), mat);
      m.position.set(px, py, pz);
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    box(cx, floorY - 0.012, cz, w / 2, 0.012, half, wood);                 // the channel floor
    box(x0, floorY + 0.03, cz, 0.008, 0.042, half, edge);                  // lane-side wall
    box(x0 + w, floorY + 0.03, cz, 0.008, 0.042, half, edge);              // outer wall
    box(cx, floorY + 0.03, zNear, w / 2, 0.042, 0.008, edge);              // the near end stop

    // The waiting balls. One per ball still to be thrown AFTER the one on the lane, so the tray
    // empties as the rack runs down - render() sets how many are showing.
    this._trayBalls = [];
    const step = G.ballR * 2.12;
    for (let i = 0; i < BALLS_PER_GAME - 1; i++) {
      const b = new THREE.Mesh(this.ballGeo || (this.ballGeo = this._track(new THREE.SphereGeometry(G.ballR, 20, 14))),
        this._mat({ color: 0xefe6d4, roughness: 0.45 }));
      b.position.set(cx, floorY + G.ballR, zNear - 0.07 - i * step);
      b.castShadow = true;
      this.scene.add(b);
      this._trayBalls.push(b);
    }
  }

  // --- the painted textures --------------------------------------------------------------------

  _canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** THE NUMBERS THAT CANNOT GO ON A RING. Every ring in the centre column is TANGENT to the next
   *  one, so their walls stand back to back with no gap: the far wall of the 40's ring is pressed
   *  flat against the near wall of the 50's, and the 30's against the 40's. That far wall is the
   *  concave, player-facing surface a number wants (it is the one the 50 uses), and for everything
   *  below the top of the stack it is buried - not merely shadowed, but touching. Confirmed by
   *  colouring each ring's inner face in and by raising the camera: two touching surfaces stay
   *  touching from every angle, and no tilt or camera move recovers them (2026-08-20).
   *
   *  So those numbers get their own surface: a short open arc standing on the board just above the
   *  mouth, concave toward the player, clear of every ring. Purely cosmetic - no physics body, in
   *  the same class as the marquee and the cabinet (see the file header). Sized and placed so it
   *  cannot touch its own ring: the arc's ends stay inside the ring's near and far walls, and its
   *  top stays below the next ring up.
   *
   *  GUARD: the 10 and 20 are NOT plated. They sit on rings wide enough (36cm and 53cm) that a
   *  number on the outer wall barely curves at all, and they already read clean. The 50 is not
   *  plated either - it is the top of the stack, so its own ring's far wall is free.
   */
  _numberPlates(glow) {
    const G = this.G;
    const L = this.look;
    // The arc is CONCENTRIC WITH ITS OWN RING and the same height as it, just set INSET metres
    // in from the ring's far wall - far enough to clear the wall of the ring above, close enough
    // that it reads as that ring's own inner face rather than a ring of its own.
    const INSET = 0.030;
    const HALF_ARC = 62 * Math.PI / 180;
    const CAP = NUM_CAP;                      // matches the 50's, so every number is one size
    const RISE = 0.72;                        // and sits at the same height on the wall
    const PPM = 2200;

    for (const id of platedHoles(G)) {
      const H = G.holes[id];
      // machine.js's own ring placement: centre sits (R - r) up-slope of the hole.
      const cv = H.v - H.r + H.ringD / 2;
      const R = H.ringD / 2 + G.ringThick / 2 - INSET;
      const PLATE_H = G.ringH;
      const lab = String(H.value);

      // Fit the number to the wall's height, then to its width.
      const probe = this._canvas(8, 8).getContext('2d');
      const maxH = PLATE_H * CAP * PPM;
      const maxW = 2 * HALF_ARC * R * PPM * 0.72;      // leave a margin at both ends
      let fontPx = maxH / 0.72;
      for (let i = 0; i < 5; i++) {
        probe.font = `800 ${fontPx}px system-ui, sans-serif`;
        const m = probe.measureText(lab);
        const inkH = (m.actualBoundingBoxAscent || fontPx * 0.72) + (m.actualBoundingBoxDescent || 0);
        const k = Math.min(maxH / inkH, maxW / m.width);
        if (Math.abs(k - 1) < 0.01) break;
        fontPx *= k;
      }

      const cw = Math.max(8, Math.round(2 * HALF_ARC * R * PPM));
      const ch = Math.max(8, Math.round(PLATE_H * PPM));
      const c = this._canvas(cw, ch);
      const x = c.getContext('2d');
      x.fillStyle = L.ring;
      x.fillRect(0, 0, cw, ch);
      x.fillStyle = L.value;
      x.font = `800 ${fontPx}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      const m = x.measureText(lab);
      const up = m.actualBoundingBoxAscent || fontPx * 0.72;
      const down = m.actualBoundingBoxDescent || 0;
      x.fillText(lab, cw / 2, ch * (1 - RISE) + (up - down) / 2);

      const tex = this._track(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // We look at this arc from INSIDE, so its u runs the other way about; without the flip the
      // number comes out mirrored.
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
      tex.offset.x = 1;

      // _onFace puts local +X on the face's u and local -Z on its v, so the arc's TOP - the part
      // up-slope of the mouth - is at theta = PI.
      const geo = this._track(new THREE.CylinderGeometry(
        R, R, PLATE_H, 48, 1, true, Math.PI - HALF_ARC, 2 * HALF_ARC,
      ));
      const mesh = new THREE.Mesh(geo, this._mat({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow,
        roughness: 0.4, side: THREE.DoubleSide,
      }));
      this._onFace(mesh, H.u, cv, PLATE_H / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
    }
  }

  /** THE NUMBERS, PRINTED ON THE RINGS. Each hole's value goes on the first ring wall the player
   *  sees ABOVE that hole. The rings are TANGENT, so that wall is the bottom of the NEXT ring up;
   *  the topmost hole has no ring above it, so its value goes on the INSIDE of its own ring's far
   *  wall - the big clear white face at the head of the board. Reading up the middle you then get
   *  10, 20, 30, 40, 50, each sitting directly above the cup it pays, and the lowest ring (the
   *  10's big arc) carries nothing at all.
   *
   *  GUARD: this is NOT each ring labelled with its own hole. That is what it first shipped as on
   *  2026-08-19 and it reads exactly one ring low, because a ring's bottom wall sits BELOW the
   *  hole it belongs to. The 100s are not in that column - nothing sits above them - so they keep
   *  their number on their own ring, which is where it looks right.
   *
   *  GUARD: this adds NO geometry. A number is a texture on the ring segments that already exist,
   *  so it cannot drift from the wall it is printed on, and a ring that moves carries its number
   *  with it. Returns a Map of ringSeg solid -> { outer, inner, xHi, xLo }, any of them missing.
   */
  _ringNumbers(glow) {
    const G = this.G;
    const L = this.look;
    const out = new Map();
    const byRing = new Map();
    for (const s of this.M.solids) {
      if (s.part !== 'ringSeg') continue;
      if (!byRing.has(s.ring)) byRing.set(s.ring, []);
      byRing.get(s.ring).push(s);
    }

    // WHAT GOES ON WHICH RING: the centre column bottom hole first, each value onto the ring above
    // it, and the top hole's value onto the far side of its own ring. Derived from the holes, not
    // a hand-written list, so a machine with a different stack still labels itself correctly.
    const jobs = [];
    const column = Object.keys(G.holes)
      .filter((id) => G.holes[id].ringD && Math.abs(G.holes[id].u) < 1e-6)
      .sort((a, b) => G.holes[a].v - G.holes[b].v);
    const plated = platedHoles(G);
    column.forEach((id, i) => {
      if (plated.has(id)) return;         // this one is on a free-standing plate, see _numberPlates
      const top = i === column.length - 1;
      jobs.push({ ring: top ? id : column[i + 1], label: String(G.holes[id].value), top });
    });
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      if (!H.ringD || Math.abs(H.u) < 1e-6) continue;
      jobs.push({ ring: id, label: String(H.value), top: false });
    }

    // The two knobs worth touching. PERDIGIT is how far round the ring one digit may wrap before
    // it turns too far from the player to read, and it is per digit on purpose: it is what lets a
    // 100 curl further round its small ring than a 40 does round a bigger one, the way the real
    // machine's do. CAP is the ceiling on height - our wall is much taller relative to its ring
    // than a real one, so most numbers are limited by the arc, not by this.
    const PERDIGIT = 40 * Math.PI / 180;
    const CAP = NUM_CAP;                      // number height, as a share of the wall's height
    // How far UP the wall the number sits, as a share of the wall's height off the board. GUARD:
    // this is not a centred number nudged for looks. Because the rings are tangent, the wall that
    // carries a number has the ring below it standing at full height directly in front - and
    // measured from the play camera, that buries the bottom ~40% of it. Keep the ink in the clear
    // top half, and keep CAP small enough that it still fits there.
    const RISE = 0.71;
    const PPM = 2200;                         // texture pixels per metre of ring

    for (const job of jobs) {
      const segs = byRing.get(job.ring);
      const H = G.holes[job.ring];
      if (!segs || !H || !H.ringD) continue;
      // The wall's centreline radius - machine.js's own definition, from the same two numbers.
      const Rwall = H.ringD / 2 + G.ringThick / 2;
      const lab = job.label;
      // Which wall of this ring the player is looking at: the bottom of it from OUTSIDE, or - for
      // the top hole's own ring - the far side of it from INSIDE, through the ring's mouth.
      const centre = job.top ? Math.PI / 2 : -Math.PI / 2;
      const maxH = G.ringH * CAP * PPM;
      const maxW = PERDIGIT * lab.length * Rwall * PPM;

      // Fit the number to the wall's height, then to the arc. On a tight ring the arc runs out
      // first and the number shrinks - which is exactly what the real machine's 100s do.
      const probe = this._canvas(8, 8).getContext('2d');
      let fontPx = maxH / 0.72;
      let inkW = 0;
      for (let i = 0; i < 5; i++) {
        probe.font = `800 ${fontPx}px system-ui, sans-serif`;
        const m = probe.measureText(lab);
        const inkH = (m.actualBoundingBoxAscent || fontPx * 0.72)
          + (m.actualBoundingBoxDescent || 0);
        inkW = m.width * 1.30;                // + a margin, so the ink never runs to the seam
        const k = Math.min(maxH / inkH, maxW / inkW);
        if (Math.abs(k - 1) < 0.01) break;
        fontPx *= k;
        inkW *= k;
      }

      // The segments the number lands on, and the arc they span - SNAPPED to whole segments, so
      // every slice of the texture is one full segment face and nothing is clamped at the ends.
      const half = inkW / PPM / (2 * Rwall);
      const win = segs
        .map((o) => {
          // machine.js stores `faceRot.phi = phi + PI/2`; recover the segment's own angle.
          const a = o.faceRot.phi - Math.PI / 2;
          return { s: o, p: Math.atan2(Math.sin(a), Math.cos(a)), ha: Math.atan(o.half[0] / Rwall) };
        })
        .filter((o) => Math.abs(o.p - centre) < half + o.ha)
        .sort((a, b) => a.p - b.p);
      if (!win.length) continue;
      const a0 = win[0].p - win[0].ha;
      const a1 = win[win.length - 1].p + win[win.length - 1].ha;
      const span = a1 - a0;
      if (!(span > 0)) continue;
      // Texture u, from the PLAYER's left to their right. On the outside of a ring that runs with
      // the segment angle; on the inside we are looking at the wall the other way about, so it
      // runs against it - a number printed with the outside rule would come out mirrored.
      const T = job.top ? (a) => (a1 - a) / span : (a) => (a - a0) / span;

      // ONE canvas per number, as wide as that snapped arc and as tall as the wall, so the number
      // is printed at its true size on the wall and each segment simply shows its own slice.
      const cw = Math.max(8, Math.round(span * Rwall * PPM));
      const ch = Math.max(8, Math.round(G.ringH * PPM));
      const c = this._canvas(cw, ch);
      const x = c.getContext('2d');
      x.fillStyle = L.ring;                   // the same white as the wall either side of it
      x.fillRect(0, 0, cw, ch);
      x.fillStyle = L.value;
      x.font = `800 ${fontPx}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      const m = x.measureText(lab);
      const up = m.actualBoundingBoxAscent || fontPx * 0.72;
      const down = m.actualBoundingBoxDescent || 0;
      // Centre the INK, not the em box: digits have no descender, so a 'middle' baseline prints
      // them high of where it looks centred. Across the wall the number goes at the ring's TRUE
      // centre angle, not at the middle of the canvas - the window was snapped out to whole
      // segments, so its middle can sit up to half a segment off to one side. Up the wall, canvas
      // y = 0 is the TOP, so RISE (measured up from the board) counts down from there.
      x.fillText(lab, T(centre) * cw, ch * (1 - RISE) + (up - down) / 2);

      // GUARD: not tracked for disposal - it is only a template and is never uploaded. Its clones
      // are, and they all share this one canvas as their source.
      const base = new THREE.CanvasTexture(c);
      base.colorSpace = THREE.SRGBColorSpace;
      base.anisotropy = 4;
      for (const o of win) {
        const lo = T(o.p - o.ha);
        const hi = T(o.p + o.ha);
        const rec = out.get(o.s) || {};
        const slice = this._decal(base, Math.min(lo, hi), Math.abs(hi - lo), glow);
        if (job.top) rec.inner = slice; else rec.outer = slice;
        // GUARD: THE SEAMS. A ring is circumscribed boxes, so neighbouring corners overlap and a
        // sliver of the box's own SIDE face shows through at every join - and being plain white it
        // cut a bright line straight down the middle of a digit (confirmed by colouring the side
        // faces in: there is a sliver at every single seam). Give each side face the one texture
        // COLUMN that belongs at that exact angle - a zero-width slice, so every pixel of the
        // sliver is the colour the wall has there - and the digit runs unbroken across the join.
        rec.xHi = this._decal(base, T(o.p + o.ha), 0, glow);
        rec.xLo = this._decal(base, T(o.p - o.ha), 0, glow);
        out.set(o.s, rec);
      }
    }
    return out;
  }

  /** One slice of a ring-number texture, as a material. A `rep` of 0 gives a single column, which
   *  is what the seam slivers want. `emissive` is plain white here, NOT L.ring, so that
   *  white x glow x texel comes to the same value as the bare wall's L.ring x glow: the printed
   *  band and the wall either side of it have to be one continuous surface. The emissiveMap is
   *  what keeps the ink dark - a flat emissive would raise the digits to the grey of the glow. */
  _decal(base, off, rep, glow) {
    const tex = this._track(base.clone());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(rep, 1);
    tex.offset.set(off, 0);
    tex.needsUpdate = true;
    return this._mat({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.4,
    });
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

    // The 10 slot across the bottom edge, and its corner 0s - a painted zone, and only that:
    // the values that used to go with it are on the rings now (see _ringNumbers).
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(0, V(0.055), W, Hpx - V(0.055));

    // EVERY HOLE: its mouth. GUARD: rings are NOT painted here - they are real walls drawn from
    // their own collision segments in `_build`, and a second painted copy here would drift out
    // of sync with where the wall actually is. See DECISIONS.md#removed-scenery.
    // GUARD: NO VALUES ARE PAINTED ON THIS FACE. Every reference photo (skeeball/References/)
    // carries each number ON ITS OWN RING and nothing on the board between them. The face used to
    // stencil a mirrored pair of numbers per hole, which read as scores scattered at random. They
    // live in `_ringNumbers` now - do not paint them back onto the field.
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
    // ONE MESH PER BALL THAT CAN BE IN THE AIR AT ONCE, plus the one waiting on the lane. They
    // all share a geometry and a material, so the pool costs almost nothing and it means a second
    // throw never has to wait for the first to finish before it has something to draw.
    const geo = this._track(new THREE.SphereGeometry(R, 30, 22));
    const mat = this._mat({ map: tex, roughness: 0.42, metalness: 0.02 });
    this._balls = [];
    for (let i = 0; i <= BALLS_PER_GAME; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.visible = false;
      this.scene.add(m);
      this._balls.push(m);
    }
    this.ball = this._balls[0];
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

  /** Zoomed framing for the setup/how-to thumbnail: fit the BOARD FACE + marquee and crop the
   *  lane, so the preview is the machine's business end rather than the whole cabinet. Same math
   *  as resize() with a lane-free FIT list and a tighter margin (batch G, 2026-08-18). The play
   *  camera (resize) is untouched - this is only ever called on a throwaway preview Renderer. */
  framePreview(w, h) {
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    const G = this.G, M = this.M;
    const topY = M.faceToWorld(0, G.boardLen, 0)[1];
    const topZ = M.faceToWorld(0, G.boardLen, 0)[2];
    const halfW = G.boardW / 2;
    const marquee = [0, topY + G.backboardH + 0.21, topZ - 0.02];
    const boardBot = M.faceToWorld(0, 0, 0);
    // RE-AIM at the midpoint of the marquee and the board's bottom edge. The play camera aims low
    // on the board (faceToWorld v*0.20), so a symmetric fit spills the whole lane into the shot -
    // measured: board-bottom projected to y -0.98 but the lane still filled the lower frame.
    // Centring the frame on the board face instead drops the FOV to ~31 deg and pushes the lane
    // off-screen (measured lane y -2.6), which is the actual "zoom to the board" Matt asked for.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(
      (marquee[0] + boardBot[0]) / 2,
      (marquee[1] + boardBot[1]) / 2,
      (marquee[2] + boardBot[2]) / 2,
    );
    const eye = this.camera.position;
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const up2 = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const FIT = [
      marquee,
      [-halfW, topY + G.backboardH - 0.01, topZ - 0.02],  // backboard top corners
      [halfW, topY + G.backboardH - 0.01, topZ - 0.02],
      M.faceToWorld(-halfW, G.boardLen, 0),               // board top corners
      M.faceToWorld(halfW, G.boardLen, 0),
      M.faceToWorld(-halfW, 0, 0),                        // board bottom corners (frame ends here)
      M.faceToWorld(halfW, 0, 0),
    ];
    const MARGIN = 0.98;
    let needV = 0, needHalfH = 0;
    for (const p of FIT) {
      const d = new THREE.Vector3(p[0], p[1], p[2]).sub(eye);
      const along = d.dot(axis);
      if (along <= 0.01) continue;
      needV = Math.max(needV, Math.atan(Math.abs(d.dot(up2)) / along / MARGIN));
      needHalfH = Math.max(needHalfH, Math.atan(Math.abs(d.dot(right)) / along / MARGIN));
    }
    const vFov = Math.max(2 * needV, 2 * Math.atan(Math.tan(needHalfH) / this.camera.aspect));
    this.camera.fov = Math.min(72, Math.max(15, (vFov * 180) / Math.PI));
    this.camera.updateProjectionMatrix();
  }

  render(game, dt) {
    // Every throw still in the air gets a mesh; whatever is left over is hidden.
    const live = (game && game.balls) || (game && game.ball ? [game.ball] : []);
    let used = 0;
    for (const st of live) {
      if (!st || !st.ball || used >= this._balls.length) continue;
      const m = this._balls[used++];
      m.visible = true;
      const p = st.ball.position;
      m.position.set(p.x, p.y, p.z);
      const q = st.ball.quaternion;
      m.quaternion.set(q.x, q.y, q.z, q.w);
    }
    // The next ball sits at the serve spot only when it can actually be thrown, so it appearing
    // IS the cue that the lane is yours again.
    const ready = game && !game.over && (!game.canThrow || game.canThrow());
    if (ready && used < this._balls.length) {
      const m = this._balls[used++];
      m.visible = true;
      m.quaternion.set(0, 0, 0, 1);
      m.position.set(0, this.G.ballR, -0.12);
    }
    for (let i = used; i < this._balls.length; i++) this._balls[i].visible = false;

    // The tray holds every ball still to come AFTER the one on the lane, so it visibly empties.
    if (this._trayBalls) {
      const sent = game && typeof game.thrown === 'number' ? game.thrown : (game ? game.ballsUsed : 0);
      const left = game && !game.over
        ? Math.max(0, BALLS_PER_GAME - sent - (ready ? 1 : 0))
        : this._trayBalls.length;
      for (let i = 0; i < this._trayBalls.length; i++) this._trayBalls[i].visible = i < left;
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
