// skeeball/js/machines/brickcity/render.js - HOT SHOT: BRICK CITY on screen. This file serves
// ONE machine (board id `brickcity`) and nothing else loads it - see skeeball/js/engines.js.
// It began as a verbatim copy of machines/basketball/ on 2026-08-24 and diverges freely from here;
// an edit made for BRICK CITY must never be carried back into HOT SHOT's copy "to keep them in
// sync." The drift is the point. Full spec: skeeball/MACHINE-BRICKCITY.md.
//
// skeeball/js/render.js - the machine on screen, drawn by three.js (skeeball/js/vendor/). GUARD:
// the scene is built from the SAME machine description physics.js simulates (machine.js), so
// the geometry on screen is the geometry the ball hits - plus purely cosmetic dressing (paint,
// marquee, cabinet, room) that has no physics body and never will. The ball is a real mesh
// driven by the physics body's position AND quaternion, so it visibly rolls.

import * as THREE from '../../vendor/three.module.min.js';
import { buildMachine } from './machine.js';
import { BALLS_PER_GAME } from '../../boards.js';

// How long a wall contact mark lives (wallMarkAt). Long enough to SEE on a phone at arm's
// length, short enough that the next throw is not competing with the last one's marks.
const WALL_MARK_LIFE = 0.55;
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

/** IS THIS SOFTWARE GL? Asked ONCE per page, and the probe context is HANDED BACK (2026-08-26).
 *
 *  This used to run inside the Renderer constructor and leak a whole WebGL context every time:
 *  `getContext('webgl')` on a throwaway canvas takes one out of the browser's small global budget
 *  (16 in Chromium, fewer on iOS) and nothing ever gave it back. Every machine picture on the
 *  gallery took one, every how-to demo took one, every rack took one - counted in a browser, half
 *  of a leak that had the console repeating "Too many active WebGL contexts. Oldest context will
 *  be lost." from the fourth rack on. See `releaseRenderer` in skeeball/js/ui.js for the other
 *  half and for what an evicted context looks like on a phone.
 *
 *  Two fixes in one: the answer is memoised, so the probe happens once per page rather than once
 *  per Renderer, and `WEBGL_lose_context` releases it immediately either way. Never throws - an
 *  unanswerable probe means "not software", which is the behaviour this has always had. */
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
    const soft = isSoftGL();
    this.softGL = soft;
    // preserveDrawingBuffer: the canvas must be READABLE after a frame (drawImage/toDataURL) -
    // test-visual.mjs's play probe samples it, and Report a bug's screenshot captures it. A
    // WebGL canvas without this reads blank the moment the frame is composited.
    // MSAA STAYS ON, and a note so it is not "optimised" away again (2026-08-26). Turning
    // antialias off at dpr >= 2 looks like free money and is not: at dpr 2 the drawing buffer maps
    // 1:1 onto the phone's physical pixels, so there is no downsample doing the job instead, and
    // the machine is all high-contrast diagonals (the rails, the marquee, the rims). Mobile GPUs
    // are tile-based and resolve MSAA in tile memory, which is where it is cheapest. Measured by
    // rendering this machine both ways at 393x852 dpr2 and differencing the two frames: 1.5% of
    // the screen changes by a visible amount, and it is all outline - the rails, the marquee edge
    // and the nine rims. That is the machine's drawing. Not worth trading for it.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !soft, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(soft ? 0.5 : Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)));
    this.renderer.shadowMap.enabled = !soft;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // THE SHADOW PASS RUNS ON DEMAND, NOT EVERY FRAME (2026-08-26). three.js re-renders the whole
    // 1024x1024 shadow map on every frame by default, which draws every caster in the scene a
    // SECOND time - and this machine is a still life whenever nothing is moving. Measured on the
    // shipped scene: 172 draw calls / 37,206 triangles per frame with the pass on, 138 / 26,026
    // with it off. render() sets needsUpdate for exactly the frames something that casts a shadow
    // has moved (see the bottom of render()). Between throws, behind a popup and on the whole
    // game-over screen, the pass is skipped.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;   // paint it once for the opening still frame

    this._disposables = [];
    this._flashes = new Map();    // hole id -> mesh to pulse
    this._popups = [];
    this._wallMarks = [];         // transient rings where the ball struck a wall (wallMarkAt)
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
    this._shadowUsed = -1;        // how many balls the last frame drew; see the bottom of render()

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
    // HOT SHOT's yellow ball-return apron: the big painted panel under the lowest shelf on
    // the real cabinet. Paint only - the kick panel's solid, its position and its bounce are
    // machine.js's and are untouched.
    const kick = this.board.dressing === 'basketball'
      ? this._mat({ color: 0xf3c21c, roughness: 0.5 }) : dark;

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
      //
      // The physics wall is TALLER than the scoreboard: machine.js extends it past the marquee
      // (MARQUEE_RISE) so no ball can thread behind the sign. Drawing that whole box with the
      // scoreboard texture stretched the scoreboard over the extension and buried the sign
      // inside the wall - Matt, 2026-08-23: the change "brought the sign down really low
      // instead of making the wall go higher". So the scoreboard face keeps its original
      // backboardH height, and the extension above it is drawn as plain cabinet: the solid
      // back the sign is mounted on. The sign itself (_cabinet) rides just above the
      // scoreboard, exactly where it always was.
      if (s.part === 'backboard') {
        this._backMat = this._mat({ map: this._track(this._paintBackboard()), roughness: 0.6 });
        const botY = s.pos[1] - s.half[1];
        const sb = new THREE.Mesh(
          this._track(new THREE.BoxGeometry(s.half[0] * 2, G.backboardH, s.half[2] * 2)),
          [cabinet, cabinet, cabinet, cabinet, this._backMat, cabinet],
        );
        sb.position.set(s.pos[0], botY + G.backboardH / 2, s.pos[2]);
        sb.receiveShadow = true;
        sb.castShadow = true;
        this.scene.add(sb);
        const riseH = s.half[1] * 2 - G.backboardH;
        if (riseH > 0.001) {
          const rise = new THREE.Mesh(
            this._track(new THREE.BoxGeometry(s.half[0] * 2, riseH, s.half[2] * 2)), cabinet);
          rise.position.set(s.pos[0], botY + G.backboardH + riseH / 2, s.pos[2]);
          rise.receiveShadow = true;
          rise.castShadow = true;
          this.scene.add(rise);
        }
        continue;
      }
      let mat;
      if (s.part === 'lane' || s.part === 'hump') mat = wood;
      else if (s.part === 'board') mat = faceEdge;
      else if (s.part === 'kick') mat = kick;
      else if (s.part === 'trough') mat = dark;
      else mat = woodDark;
      const mesh = new THREE.Mesh(this._track(new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2)), mat);
      mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.rot) mesh.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      mesh.receiveShadow = true;
      // GUARD: the side walls do not cast shadows. A shadow across the scoring area reads as
      // dirt on the board - the same reason the key light is nearly overhead (see _lights).
      if (s.part !== 'lane' && s.part !== 'board' && s.part !== 'rail') mesh.castShadow = true;
      this.scene.add(mesh);
    }

    // The painted field: the "what is worth what" layer. One plane per SURFACE SEGMENT (a
    // single one on a flat board; per tread and riser on a staircase), each mapping its own
    // v-slice of the one unrolled field texture, so the paint and the physics surface can never
    // disagree about where anything is.
    {
      const tex = this._track(this._paintField());
      for (const fr of (M.frames || [{ v0: 0, v1: G.boardLen, tilt: M.tilt }])) {
        const len = fr.v1 - fr.v0;
        const slice = tex.clone();
        this._track(slice);
        // v maps to the texture's Y bottom-up (V(v) = Hpx - v*px in _paintField).
        slice.repeat.set(1, len / G.boardLen);
        slice.offset.set(0, fr.v0 / G.boardLen);
        slice.needsUpdate = true;
        const plane = new THREE.Mesh(
          this._track(new THREE.PlaneGeometry(G.boardW, len)),
          this._mat({ map: slice, roughness: 0.8 }),
        );
        const c = M.faceToWorld(0, (fr.v0 + fr.v1) / 2, 0.0015);
        plane.position.set(c[0], c[1], c[2]);
        plane.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - fr.tilt));
        plane.receiveShadow = true;
        this.scene.add(plane);
      }
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

    // THE CUPS. A hole in a board, drawn as a hole in a board: a dark mouth flush in the face.
    // On THE CLASSIC every hole is `collarH: 0` (boards.js) and its VALUE is on a ring wall
    // (_ringNumbers) - numbers do not belong on the board face; see DECISIONS.md#removed-scenery.
    // On a CUP BOARD (POPONGO) a hole wears a raised collar in ITS CUP's color (boards.js's
    // arrangement layer), matching machine.js's physics profile vertex for vertex, and carries
    // the cup's printed value on an arc inside its own far wall (_cupPlate) - where the real
    // product prints it.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const cup = this.board.cups && this.board.arrangement
        ? this.board.cups[this.board.arrangement[id]] : null;
      const mouth = new THREE.Mesh(
        this._track(new THREE.CircleGeometry(H.r, 44)),
        this._mat({ color: 0x0a0705, roughness: 1 }),
      );
      this._onFace(mouth, H.u, H.v, 0.0035, true);
      this.scene.add(mouth);
      this._flashes.set(id, this._makeFlash(H));
      if (!H.collarH) continue;
      // HOT SHOT (`board.dressing === 'basketball'`): the collar is DRAWN as an orange wire
      // basket with a white mini backboard carrying the value - the real cabinet's furniture.
      // Cosmetic only: the wall the ball hits is still machine.js's collar boxes, and the wire
      // rim is drawn AT the physics rim height, so the rim you see is the rim the ball rattles.
      if (this.board.dressing === 'basketball') {
        this._wireBasket(H, cup && cup.color);
        if (cup && cup.label) this._hoopBackboard(H, cup, RING_GLOW);
        continue;
      }
      const wall = this._scallopedRim(H.r + G.collarThick / 2, H.collarH,
        H.lipLow ? (typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35) : 1,
        cup && cup.color);
      this._onFace(wall, H.u, H.v, 0);
      this.scene.add(wall);
      if (cup && cup.label) this._cupPlate(H, cup, RING_GLOW);
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
    // The LOCAL surface tilt: on a stepped machine each segment has its own (machine.js tiltAt).
    const tilt = this.M.tiltAt ? this.M.tiltAt(v) : this.M.tilt;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
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

    // HOT SHOT's RED NEON: a tube up the front edge of each side wall and back along its
    // top, framing the play window exactly as the strips do on the real cabinet. Traced from
    // machine.js's own railProfile, so the neon follows the wall wherever the wall goes. Purely
    // cosmetic - no physics body, no shadow, and no light source: the glow is the emissive plus
    // one additive halo sleeve, which costs nothing next to a real light.
    if (this.board.dressing === 'basketball' && M.railProfile) {
      const P = M.railProfile;              // front-bottom, back-bottom, back-top, front-top
      const xi = M.railInnerX;
      const tube = this._mat({
        color: 0xff4030, roughness: 0.35, emissive: 0xff1414, emissiveIntensity: 1.7,
      });
      const halo = this._track(new THREE.MeshBasicMaterial({
        color: 0xff2a1a, transparent: true, opacity: 0.14, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      for (const side of [-1, 1]) {
        for (const [a, b] of [[P[0], P[3]], [P[3], P[2]]]) {
          const p1 = new THREE.Vector3(side * (xi - 0.014), a[1], a[0]);
          const p2 = new THREE.Vector3(side * (xi - 0.014), b[1], b[0]);
          const d = new THREE.Vector3().subVectors(p2, p1);
          const q = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
          const mid = p1.clone().add(p2).multiplyScalar(0.5);
          for (const [r, mat] of [[0.010, tube], [0.026, halo]]) {
            const t = new THREE.Mesh(
              this._track(new THREE.CylinderGeometry(r, r, d.length(), 10, 1, true)), mat);
            t.position.copy(mid);
            t.quaternion.copy(q);
            this.scene.add(t);
          }
        }
      }
    }
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
        this._mat({ color: this.board.dressing === 'basketball' ? 0xe8641f : 0xefe6d4, roughness: 0.45 }));
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

    // HOT SHOT's staircase paint (Matt's real-machine footage): each TREAD is the cream
    // shelf the baskets stand on, each RISER is a blue panel scattered with yellow stars - the
    // real cabinet's tiers, painted onto the exact segments the ball plays on.
    if (this.board.dressing === 'basketball' && this.M.frames) {
      const star = (sx, sy, r, rot) => {
        x.save();
        x.translate(sx, sy);
        x.rotate(rot);
        x.beginPath();
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? r * 0.42 : r;
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          x[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        x.closePath();
        x.fill();
        x.restore();
      };
      let si = 0;
      for (const fr of this.M.frames) {
        const top = V(fr.v1);
        const bot = V(fr.v0);
        if (fr.tilt < 1.0) {
          // A TREAD: a light oak shelf. The real cabinet's steps are varnished wood, not the
          // cream they used to be painted here - grain running across the shelf, a shadow where
          // the riser lands on it, and a lit front lip so the step's edge reads in perspective.
          x.fillStyle = '#b98a4e';
          x.fillRect(0, top, W, bot - top);
          x.globalAlpha = 0.14;
          for (let k = 0; k < 26; k++) {
            x.fillStyle = k % 2 ? '#6d451c' : '#e0bd85';
            const gy = top + ((k * 0.371 + 0.05) % 1) * (bot - top);
            x.fillRect(0, gy, W, 1 + (k % 3));
          }
          x.globalAlpha = 1;
          x.fillStyle = 'rgba(0,0,0,0.30)';
          x.fillRect(0, top, W, 7);
          x.fillStyle = 'rgba(255,242,214,0.32)';
          x.fillRect(0, bot - 5, W, 5);
        } else {
          // A RISER: the blue star panel each row of baskets hangs on, lit from above (the
          // fixed pseudo-scatter is i-hashed, no rng).
          const g = x.createLinearGradient(0, top, 0, bot);
          g.addColorStop(0, '#3d8bf5');
          g.addColorStop(1, L.face);
          x.fillStyle = g;
          x.fillRect(0, top, W, bot - top);
          x.fillStyle = '#ffdf52';
          for (let k = 0; k < 11; k++, si++) {
            const su = ((si * 0.383 + 0.13) % 1) * G.boardW - G.boardW / 2;
            const sv = fr.v0 + 0.04 + ((si * 0.617 + 0.07) % 1) * (fr.v1 - fr.v0 - 0.08);
            star(U(su), V(sv), 12 + (si % 4) * 5, (si * 0.7) % (Math.PI * 2));
          }
        }
      }
    }

    // The 10 slot across the bottom edge, and its corner 0s - a painted zone, and only that:
    // the values that used to go with it are on the rings now (see _ringNumbers). A cup board
    // has no bottom slot - its lowest cup is just the nearest cup - so the band is the
    // classic-style boards' alone.
    if (!this.board.cups) {
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.fillRect(0, V(0.055), W, Hpx - V(0.055));
    }

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
    tex.colorSpace = THREE.SRGBColorSpace;
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
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** A raised cup rim, built to machine.js's OWN height profile: low at the down-slope lip,
   *  rising to full height at the up-slope one. The classic board has no raised rims any more
   *  (every hole is flush), so nothing calls this today - it is here so the next machine that
   *  wants walls gets ones that match its physics vertex for vertex, instead of the straight
   *  cylinder plus a cosmetic -0.32 rad tilt that used to slide each cup off its own mouth.
   *
   *  There is deliberately NO number on the rim itself: a FLAT plate inside a curved wall is
   *  what bit every number on this board in half once. A cup board's value rides _cupPlate
   *  instead - a CURVED arc, concentric with the cup, which is the shape a cylinder can hold. */
  _scallopedRim(radius, height, lowFrac, color) {
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
    // A cup board hands in its cup's color; the default is the classic's plastic cream. The
    // emissive floor is the ring walls' lesson (see the ringMat GUARD): a wall standing
    // perpendicular to the face gets no key light, so albedo alone renders it as mud.
    const col = new THREE.Color(color || 0xfdfaf3);
    const mesh = new THREE.Mesh(geo, this._mat({
      color: col, roughness: 0.5, side: THREE.DoubleSide,
      emissive: col, emissiveIntensity: color ? 0.35 : 0,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** A CUP'S PRINTED VALUE: an arc hugging the OUTSIDE of the collar's down-slope wall - the
   *  face the play camera actually sees (the colored band on every cup from behind the ball),
   *  and where the real Popongo prints its numbers. Same construction as _numberPlates (which
   *  serves the classic's tight RINGS), but a cup is CONCENTRIC with its hole, so the arc
   *  centres on the hole itself and stands the collar's height. GUARD: not inside the mouth -
   *  the first draft put it just inside the far wall, which buried it inside the collar solid
   *  AND faced it away from a camera that looks at these cups edge-on. Cosmetic only - no
   *  physics body; the collar the ball hits is _scallopedRim's machine.js twin. */
  _cupPlate(H, cup, glow) {
    const G = this.G;
    const R = H.r + G.collarThick + 0.004;          // just proud of the collar's outer face
    const PLATE_H = H.collarH;
    const HALF_ARC = 58 * Math.PI / 180;
    const CAP = 0.78;                               // the digit fills the band, like the real
    const RISE = 0.50;                              // cups - this wall is half a ring's height
                                                    // and read from further away
    const PPM = 2200;
    const lab = String(cup.label);

    const probe = this._canvas(8, 8).getContext('2d');
    const maxH = PLATE_H * CAP * PPM;
    const maxW = 2 * HALF_ARC * R * PPM * 0.72;
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
    x.fillStyle = cup.color;
    x.fillRect(0, 0, cw, ch);
    x.fillStyle = cup.ink || '#ffffff';
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
    // Read from OUTSIDE (the ring numbers' outer-wall case): u runs with the angle, no flip.
    tex.wrapS = THREE.ClampToEdgeWrapping;

    // _onFace puts local +X on the face's u and local -Z on its v, so theta = 0 faces DOWN-SLOPE
    // - straight at the player behind the ball.
    const geo = this._track(new THREE.CylinderGeometry(
      R, R, PLATE_H, 40, 1, true, -HALF_ARC, 2 * HALF_ARC,
    ));
    const mesh = new THREE.Mesh(geo, this._mat({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow,
      roughness: 0.4, side: THREE.DoubleSide,
    }));
    this._onFace(mesh, H.u, H.v, PLATE_H / 2);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
  }

  /** HOT SHOT's hoop: the physics collar drawn as an orange WIRE basket, matched to Matt's
   *  real-machine footage - a rim wire that FOLLOWS machine.js's blended lipLow profile (tall
   *  up-slope back, low player-facing front - the rim seen is the rim hit), a tapered wire body
   *  down to a small bottom ring, and struts between. Cosmetic beyond the rim: the solid the
   *  ball hits is machine.js's collar boxes at the rim's radius; the taper sits inside them,
   *  like a real basket's mesh inside its mounting ring. */
  _mergedTubes(segs, defR, sides = 5) {
    const tmpl = new THREE.CylinderGeometry(1, 1, 1, sides, 1, true);
    const bp = tmpl.attributes.position.array;
    const bn = tmpl.attributes.normal.array;
    const bi = tmpl.index.array;
    const pos = [];
    const nor = [];
    const idx = [];
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    for (const seg of segs) {
      const a = seg[0];
      const b = seg[1];
      const r = seg[2] || defR;
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      if (len < 1e-6) continue;
      q.setFromUnitVectors(up, d.clone().divideScalar(len));
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
      nm.getNormalMatrix(m);
      const off = pos.length / 3;
      for (let i = 0; i < bp.length; i += 3) {
        v.set(bp[i], bp[i + 1], bp[i + 2]).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        v.set(bn[i], bn[i + 1], bn[i + 2]).applyMatrix3(nm).normalize();
        nor.push(v.x, v.y, v.z);
      }
      for (let i = 0; i < bi.length; i++) idx.push(bi[i] + off);
    }
    tmpl.dispose();
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  _wireBasket(H, color) {
    const G = this.G;
    const R = H.r + G.collarThick / 2;
    const col = new THREE.Color(color || 0xe8541f);
    // The emissive floor is the collar walls' lesson (_scallopedRim): a wall perpendicular to
    // the face gets no key light, and a thin wire even less.
    const mat = this._mat({ color: col, roughness: 0.4, metalness: 0.25, emissive: col, emissiveIntensity: 0.4 });
    const g = new THREE.Group();
    const lowFrac = typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35;
    const hAt = (phi) => (H.lipLow
      ? H.collarH * (lowFrac + (1 - lowFrac) * (Math.sin(phi) + 1) / 2)
      : H.collarH);
    const Rbot = R * 0.58;                           // the reference basket's taper
    const yBot = 0.005;
    const P = (r, y, phi) => new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);

    // THE ORANGE WIRE, in ONE geometry. GUARD: every basket used to be ~20 separate tube meshes,
    // so nine of them already put ~180 draw calls on the board before a single net strand
    // existed. The shape is unchanged; the strands are merged into one buffer per colour, so a
    // full netted basket costs two draw calls instead of fifty.
    const orange = [];
    const NR = 32;
    for (let i = 0; i < NR; i++) {
      const p0 = (i / NR) * Math.PI * 2;
      const p1 = ((i + 1) / NR) * Math.PI * 2;
      orange.push([P(R, hAt(p0), p0), P(R, hAt(p1), p1), 0.0062]);   // the rim, ON the physics profile
      orange.push([P(Rbot, yBot, p0), P(Rbot, yBot, p1), 0.0034]);   // the small bottom ring
    }
    for (let i = 0; i < 10; i++) {                                   // tapered ribs between them
      const a = (i / 10) * Math.PI * 2;
      orange.push([P(R, hAt(a), a), P(Rbot, yBot, a), 0.0030]);
    }
    const wire = new THREE.Mesh(this._mergedTubes(orange, 0.003), mat);
    wire.castShadow = true;
    g.add(wire);

    // THE WHITE NET: two crossing bands of strands from the rim down to the base, plus the ring
    // where they meet - the thing that makes a hoop read as a basket rather than a wire ring.
    const netMat = this._mat({
      color: 0xf7f2e4, roughness: 0.9, emissive: 0xf7f2e4, emissiveIntensity: 0.5,
    });
    // A DEEP basket needs a third band or its strands read as long bare wires; a shallow one
    // looks knitted with two. Every band is a fraction of the basket's OWN depth, so the net
    // follows collarH wherever the geometry takes it.
    const rings = H.collarH > R * 0.9
      ? [
        { r: R, y: (phi) => hAt(phi) - 0.004 },
        { r: R * 0.87, y: (phi) => hAt(phi) * 0.67 },
        { r: R * 0.71, y: (phi) => hAt(phi) * 0.34 },
        { r: Rbot * 1.04, y: () => yBot + 0.004 },
      ]
      : [
        { r: R, y: (phi) => hAt(phi) - 0.004 },
        { r: R * 0.78, y: (phi) => hAt(phi) * 0.46 },
        { r: Rbot * 1.04, y: () => yBot + 0.004 },
      ];
    const net = [];
    const S = 9;
    for (let b = 0; b < rings.length - 1; b++) {
      const hi = rings[b];
      const lo = rings[b + 1];
      for (let i = 0; i < S; i++) {
        const a = (i / S) * Math.PI * 2 + b * 0.35;
        for (const dir of [1, -1]) {
          const a2 = a + dir * ((Math.PI * 2) / S) * 0.6;
          net.push([P(hi.r, hi.y(a), a), P(lo.r, lo.y(a2), a2)]);
        }
      }
    }
    for (let b = 1; b < rings.length - 1; b++) {                     // a ring at every crossing
      for (let i = 0; i < 28; i++) {
        const p0 = (i / 28) * Math.PI * 2;
        const p1 = ((i + 1) / 28) * Math.PI * 2;
        net.push([P(rings[b].r, rings[b].y(p0), p0), P(rings[b].r, rings[b].y(p1), p1)]);
      }
    }
    g.add(new THREE.Mesh(this._mergedTubes(net, 0.0027), netMat));

    this._onFace(g, H.u, H.v, 0);
    this.scene.add(g);
  }


  /** The row of baskets sharing one tread, and so one riser: the DEEPEST mount on it and the
   *  spacing between neighbouring columns. Both are properties of the ROW rather than of any one
   *  basket, which is why _hoopBackboard sizes its card from here - one card size and one card
   *  height per shelf, however much the baskets under them differ. `rim` is the widest basket on
   *  the row, which is what the card's width is drawn in proportion to. */
  _backboardRow(ti) {
    const fr = (this.M.frames || [])[ti];
    const holes = Object.values(this.G.holes || {})
      .filter((h) => !fr || (h.v >= fr.v0 && h.v <= fr.v1));
    let mount = 0, rim = 0;
    const us = [];
    for (const h of holes) {
      mount = Math.max(mount, h.collarH || 0);
      // the WIDEST rim on the row, outer face included - the card is drawn in proportion to it
      rim = Math.max(rim, 2 * (h.r + (this.G.collarThick || 0) / 2));
      us.push(h.u);
    }
    us.sort((a, b) => a - b);
    let pitch = Infinity;
    for (let i = 1; i < us.length; i++) pitch = Math.min(pitch, us[i] - us[i - 1]);
    // A lone basket on a shelf has no neighbour to crowd, so nothing caps its width but the board.
    if (!(pitch > 0) || !isFinite(pitch)) pitch = this.G.boardW || 1;
    return { mount, pitch, rim };
  }

  /** HOT SHOT's value: a white mini BACKBOARD card mounted on the RISER behind its basket -
   *  exactly where the real cabinet prints them (Matt's footage: a fan-topped white card with
   *  the number in a red-bordered box, above every basket). The riser is a real flat wall, so
   *  this is a flat plane sitting 8mm proud of solid geometry - nothing phantom, nothing
   *  curved. */
  _hoopBackboard(H, cup, glow) {
    const G = this.G;
    const lab = String(cup.label);
    // the riser behind this hoop's tread: the next frame after the one holding H.v
    const frames = this.M.frames || [];
    const ti = frames.findIndex((fr) => H.v >= fr.v0 && H.v <= fr.v1);
    const riser = frames[ti + 1];
    if (!riser || riser.tilt < 1.0) return;          // no riser behind (flat board) - no card

    // AN ARCH, ONE SIZE PER ROW - and only two rules decide it (Matt, 2026-08-24): a card may
    // never overlap its neighbour, and it may never stand taller than the wall it is bolted to.
    // So the ROW owns the size, not the basket: every card on a shelf is cut to the same arch and
    // hung at the same height, whatever the diameters of the baskets under it.
    //
    // WHY AN ARCH AND NOT A SEMICIRCLE, so nobody "simplifies" it back. The old card was a
    // semicircle, so its height WAS half its width - one radius doing both jobs. Height could
    // then only be bought with width, and width is precisely what the no-overlap rule caps, so
    // every card sat well short of its wall with a band of bare riser above it. Matt, on the
    // shipped build: "notice the gap between the top of these backboards and the beginning of the
    // next shelf. This doesn't look right." Splitting the two lets each dimension answer to its
    // own rule - WIDTH to the column pitch, HEIGHT to the riser - and the gap closes.
    const row = this._backboardRow(ti);
    const MOUNT = row.mount;
    // A REVEAL, not a flush fit - Matt: "the backboards do not have to be exactly to the top of
    // the wall they're on. you could leave like a 0.5 in gap if that makes the backboards fit
    // better." TOP_REVEAL leaves bare riser above the card, SIDE_GAP leaves it between two
    // neighbours; both are the safety margin that makes "never taller" and "never overlapping"
    // true by construction instead of by luck.
    const TOP_REVEAL = 0.012;                        // 0.33 in of riser above the card
    const SIDE_GAP = 0.018;                          // 0.50 in of riser between two cards
    const CARD_H = (riser.v1 - riser.v0) - MOUNT - TOP_REVEAL;
    // WIDTH IS NOT JUST "AS WIDE AS IT MAY BE". Stretching every card to the no-overlap cap was
    // tried and looked worse than the gap it fixed: the cards went wide and squat, crowded each
    // other, and the value box - which is a fraction of the card's HEIGHT - shrank until the
    // number was hard to read. So width is proportional to the baskets it sits over (1.5x the
    // widest rim on the row), widened only as far as it must be to keep the arch from turning
    // into a tall thin slot, and only then clamped by the pitch so neighbours cannot touch.
    const ARCH_MAX = 1.25;                           // height : half-width, past which it reads narrow
    const CARD_HW = Math.min(Math.max(row.rim * 0.75, CARD_H / ARCH_MAX),
                             (row.pitch - SIDE_GAP) / 2);
    if (!(CARD_H > 0) || !(CARD_HW > 0)) return;     // no room on this riser - draw nothing

    // The canvas carries the card's REAL aspect, so the painted outline lands exactly on the cut
    // edge no matter how tall the arch is on this row.
    const cw = 480;
    const ch = Math.max(8, Math.round(cw * CARD_H / (2 * CARD_HW)));
    const c = this._canvas(cw, ch);
    const x = c.getContext('2d');
    x.fillStyle = '#f4f1e7';
    x.fillRect(0, 0, cw, ch);
    // The dome's own outline, traced on the arc the geometry is cut to. Canvas y grows DOWN and
    // the texture's v = 0 is the shape's flat edge, so the flat edge is the canvas's bottom row
    // and the apex is its top.
    x.lineWidth = Math.max(4, ch * 0.045);
    x.strokeStyle = '#3a3630';
    x.beginPath();
    x.ellipse(cw / 2, ch, cw / 2 - x.lineWidth / 2, ch - x.lineWidth / 2, 0, Math.PI, 0);
    x.stroke();
    x.beginPath();
    x.moveTo(0, ch - x.lineWidth / 2);
    x.lineTo(cw, ch - x.lineWidth / 2);
    x.stroke();
    // the orange-bordered value box, sitting 42% of the radius up from the flat edge
    const bw = cw * 0.50;
    const bh = ch * 0.44;
    const bx = (cw - bw) / 2;
    const by = ch * 0.58 - bh / 2;
    x.fillStyle = '#ffffff';
    x.fillRect(bx, by, bw, bh);
    x.lineWidth = Math.max(4, ch * 0.05);
    x.strokeStyle = '#e87b2a';
    x.strokeRect(bx, by, bw, bh);
    let fontPx = bh * 0.78;
    x.font = `800 ${fontPx}px system-ui, sans-serif`;
    fontPx *= Math.min(1, (bw * 0.80) / x.measureText(lab).width);
    x.font = `800 ${fontPx}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#1c1c1c';
    x.fillText(lab, cw / 2, by + bh / 2 + fontPx * 0.04);

    const tex = this._track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    // A REAL SLAB, not a decal: the board stands proud of the riser so its edge catches light.
    // ExtrudeGeometry writes group 0 for the two caps and group 1 for the rim, so the painted
    // face and the plain edge take different materials - and the UVs are re-derived from the
    // shape's own bounds, because the default generator hands back raw model coordinates.
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, CARD_HW, CARD_H, 0, Math.PI, false);
    shape.closePath();
    const geo = this._track(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }));
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + CARD_HW) / (2 * CARD_HW), pos.getY(i) / CARD_H);
    }
    uv.needsUpdate = true;

    const face = this._mat({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.5,
    });
    const edge = this._mat({ color: 0xd8d2c2, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, [face, edge]);
    const p = this.M.faceToWorld(H.u, riser.v0 + MOUNT, 0.006);
    mesh.position.set(p[0], p[1], p[2]);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - riser.tilt));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
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

  /** THE SIGN, painted to the design Matt handed over (the `.sign` block of the Brick City
   *  Marquee artifact) rather than to anything invented here. GUARD: this is the MACHINE's
   *  marquee - nothing about "Skeeball" belongs on it, and the two names ARE the whole sign (no
   *  tagline, no extra copy). Every value below is the artifact's own; skeeball/MACHINE-BRICKCITY.md
   *  carries the CSS-to-canvas mapping.
   *
   *    .sign      background linear-gradient(180deg, #A33427 0%, #6E2018 100%)
   *               border 6px solid #FFC53D, radius 3px
   *               box-shadow 0 0 0 5px #0D0E12 - the dark edge ring OUTSIDE the bulb border
   *    ::before   coursing: horizontals rgba(0,0,0,.34) every 26px,
   *               verticals rgba(0,0,0,.28) every 58px, the whole layer at opacity .5
   *    ::after    the same verticals offset (29px, 13px) and masked to ALTERNATE 26px courses,
   *               which is what offsets every other course by half a brick
   *    .bulb      11px round #FFC53D, glow 0 0 10px 2px rgba(255,197,61,.75),
   *               inset 0 -2px 3px rgba(160,105,0,.5) - lit glass, shaded UNDERNEATH
   *    .bulbs     12 per bar, space-between, one bar above the lettering and one below
   *    .hot       #FFC53D, shadows 0 0 2px rgba(255,197,61,.9), 0 0 18px rgba(255,107,44,.85),
   *               0 0 48px rgba(255,107,44,.45), 0 5px 0 #6E2018
   *    .plate     #14161B, border 3px solid #EDE6DA, radius 2px, box-shadow 0 6px 0 rgba(0,0,0,.45)
   *    .city      #EDE6DA with the ball-through-a-rim glyph at its left
   *
   *  THE ONE THING THAT IS NOT THE ARTIFACT'S is the aspect ratio: the mock's sign is about 2.3:1
   *  and this cabinet's marquee panel is 4.06:1, so the sign is drawn WIDER. Nothing is redesigned
   *  by that - the ring, the border, the bulb bars, the lettering and the plate are all the
   *  artifact's; the brick simply runs further to each side.
   *
   *  EVERY LETTER IS A PATH, not a font. The design sets both names in Bungee, and a webfont is
   *  not something this game may fetch (no build step, works offline, and a font that has not
   *  loaded yet paints the sign in whatever the browser falls back to). `_signWord` / `_signGlyph`
   *  draw a heavy condensed alphabet out of lines and curves; only the ten letters these two
   *  names need exist.
   *
   *  NO CHASE ANIMATION. The artifact's own notes call its chase "a suggestion, not a requirement".
   *  These bulbs are painted INTO the texture, so a chase would mean repainting a 1024x252 canvas
   *  and re-uploading it every frame. The seven REAL bulb meshes above this panel already flash on
   *  celebrate(), which is where movement belongs; REDUCED (top of this file) is the
   *  prefers-reduced-motion gate it would need.
   */
  _paintMarquee() {
    const W = 1024;
    const H = 252;                      // 4.06:1, the panel mesh's own ratio
    const c = this._canvas(W, H);
    const x = c.getContext('2d');
    const L = this.look;

    const RING = 6;                     // .sign's box-shadow 0 0 0 5px #0D0E12
    const BORDER = 9;                   // .sign's 6px solid var(--bulb)
    const IN = RING + BORDER;
    const bx = IN, by = IN, bw = W - IN * 2, bh = H - IN * 2;

    // 1. Dark edge ring, then the bulb-yellow border, then the brick panel inside it.
    x.fillStyle = '#0d0e12';
    x.fillRect(0, 0, W, H);
    x.fillStyle = L.bulb;
    this._roundRect(x, RING, RING, W - RING * 2, H - RING * 2, 3);
    x.fill();

    const g = x.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, L.marquee);
    g.addColorStop(1, '#6e2018');
    x.save();
    this._roundRect(x, bx, by, bw, bh, 2);
    x.clip();
    x.fillStyle = g;
    x.fillRect(bx, by, bw, bh);

    // 2. The coursing, at the artifact's numbers and its .5 layer opacity.
    const COURSE = 26;
    const BRICK = 58;
    x.globalAlpha = 0.5;
    x.lineWidth = 1;
    for (let row = 0, y = by; y <= by + bh; row++, y += COURSE) {
      x.strokeStyle = 'rgba(0,0,0,0.34)';
      x.beginPath();
      x.moveTo(bx, y + 0.5);
      x.lineTo(bx + bw, y + 0.5);
      x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.28)';
      const off = row % 2 ? BRICK / 2 : 0;          // the ::after's half-brick shift
      for (let vx = bx + off; vx <= bx + bw; vx += BRICK) {
        x.beginPath();
        x.moveTo(vx + 0.5, y);
        x.lineTo(vx + 0.5, Math.min(by + bh, y + COURSE));
        x.stroke();
      }
    }
    x.globalAlpha = 1;
    x.restore();

    // 3. The two bulb bars.
    this._signBulbs(x, bx + 8, bx + bw - 8, by + 13, L.bulb);
    this._signBulbs(x, bx + 8, bx + bw - 8, by + bh - 13, L.bulb);

    // 4. HOT SHOT, with the ember stack the artifact puts behind it.
    const capH = 78;
    const stem = Math.round(capH * 0.21);
    const hotY = 42;
    const hotX = (W - this._signWidth('HOT SHOT', capH)) / 2;
    x.lineCap = 'butt';
    x.lineJoin = 'miter';
    x.save();
    x.translate(0, 4);                                            // 0 5px 0 var(--brick-deep)
    this._signWord(x, 'HOT SHOT', hotX, hotY, capH, stem, '#6e2018', 0, null);
    x.restore();
    this._signWord(x, 'HOT SHOT', hotX, hotY, capH, stem, L.marqueeText, 48, 'rgba(255,107,44,0.45)');
    this._signWord(x, 'HOT SHOT', hotX, hotY, capH, stem, L.marqueeText, 18, 'rgba(255,107,44,0.85)');
    this._signWord(x, 'HOT SHOT', hotX, hotY, capH, stem, L.marqueeText, 2, 'rgba(255,197,61,0.9)');
    this._signWord(x, 'HOT SHOT', hotX, hotY, capH, stem, L.marqueeText, 0, null);

    // 5. The BRICK CITY plate. Chalk on asphalt because brick red under a yellow bulb bar is a
    //    low-contrast pair, and this name needs somewhere the glow above is not competing with
    //    (the artifact's own note).
    const cityCap = 40;
    const cityStem = Math.round(cityCap * 0.21);
    const cityW = this._signWidth('BRICK CITY', cityCap);
    const glyphW = 58;
    const padX = 24;
    const gap = 18;
    const plateW = padX * 2 + glyphW + gap + cityW;
    const plateH = 74;
    const plateX = Math.round((W - plateW) / 2);
    const plateY = 132;

    x.fillStyle = 'rgba(0,0,0,0.45)';                             // 0 6px 0 rgba(0,0,0,.45)
    this._roundRect(x, plateX, plateY + 6, plateW, plateH, 2);
    x.fill();
    x.fillStyle = '#14161b';
    this._roundRect(x, plateX, plateY, plateW, plateH, 2);
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = L.net;
    this._roundRect(x, plateX + 1.5, plateY + 1.5, plateW - 3, plateH - 3, 2);
    x.stroke();

    this._signRimGlyph(x, plateX + padX, plateY + (plateH - glyphW) / 2, glyphW, L.glow, L.net);
    this._signWord(x, 'BRICK CITY', plateX + padX + glyphW + gap,
      plateY + (plateH - cityCap) / 2, cityCap, cityStem, L.net, 0, null);

    const tex = new THREE.CanvasTexture(c);
    // Declared for the same measured reason _paintField and _paintLane declare it: without it the
    // sRGB hex on this canvas reaches the shader as LINEAR albedo, which lifts and desaturates
    // everything - the brick goes pink and the chalk plate goes grey.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  /** One bar of 12 bulbs, space-between from x0 to x1, centred on cy. */
  _signBulbs(x, x0, x1, cy, color) {
    const N = 12;
    const r = 5.5;                                                // .bulb is 11px across
    for (let i = 0; i < N; i++) {
      const cx = x0 + r + ((x1 - x0 - r * 2) * i) / (N - 1);
      x.save();
      x.shadowColor = 'rgba(255,197,61,0.75)';                    // 0 0 10px 2px
      x.shadowBlur = 10;
      x.fillStyle = color;
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.fill();
      x.fill();                                                   // twice, for the 2px spread
      x.restore();
      // inset 0 -2px 3px rgba(160,105,0,.5): the shading sits UNDER the glass, not on top of it.
      x.save();
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.clip();
      x.fillStyle = 'rgba(160,105,0,0.5)';
      x.beginPath();
      x.arc(cx, cy + r * 0.75, r * 0.85, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
  }

  /** A rounded rectangle path (no dependency on the browser's own roundRect - Safari got it
   *  late, and this file has to draw the same sign everywhere). */
  _roundRect(x, rx, ry, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(rx + rr, ry);
    x.lineTo(rx + w - rr, ry);
    x.arcTo(rx + w, ry, rx + w, ry + rr, rr);
    x.lineTo(rx + w, ry + h - rr);
    x.arcTo(rx + w, ry + h, rx + w - rr, ry + h, rr);
    x.lineTo(rx + rr, ry + h);
    x.arcTo(rx, ry + h, rx, ry + h - rr, rr);
    x.lineTo(rx, ry + rr);
    x.arcTo(rx, ry, rx + rr, ry, rr);
    x.closePath();
  }

  /** The basketball dropping through a rim, from the design's own glyph: an orange ball with its
   *  seams, a chalk rim under it, and the net hanging off the rim. Drawn in a `size` box. */
  _signRimGlyph(x, gx, gy, size, ball, chalk) {
    const s = size / 30;                  // the design draws this in a 30x30 box
    const P = (a, b) => [gx + a * s, gy + b * s];
    x.save();
    x.lineCap = 'round';
    // the ball
    x.fillStyle = ball;
    x.beginPath();
    x.arc(...P(15, 10), 6.4 * s, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = 1.4 * s;
    x.strokeStyle = '#0d0e12';
    x.stroke();
    // its seams
    x.lineWidth = 1.1 * s;
    x.beginPath();
    x.moveTo(...P(8.6, 10)); x.lineTo(...P(21.4, 10));
    x.moveTo(...P(15, 3.6)); x.lineTo(...P(15, 16.4));
    x.stroke();
    x.beginPath();
    x.moveTo(...P(10.5, 5.5));
    x.bezierCurveTo(...P(12.2, 7.2), ...P(12.2, 11.8), ...P(10.5, 14.5));
    x.moveTo(...P(19.5, 5.5));
    x.bezierCurveTo(...P(17.8, 7.2), ...P(17.8, 11.8), ...P(19.5, 14.5));
    x.stroke();
    // the rim
    x.strokeStyle = chalk;
    x.lineWidth = 2 * s;
    x.beginPath();
    x.ellipse(...P(15, 19.4), 9.6 * s, 2.6 * s, 0, 0, Math.PI * 2);
    x.stroke();
    // the net
    x.lineWidth = 1 * s;
    x.globalAlpha = 0.85;
    x.beginPath();
    x.moveTo(...P(6.6, 20.2)); x.lineTo(...P(9, 26));
    x.moveTo(...P(23.4, 20.2)); x.lineTo(...P(21, 26));
    x.moveTo(...P(11, 21.2)); x.lineTo(...P(11.8, 26.8));
    x.moveTo(...P(19, 21.2)); x.lineTo(...P(18.2, 26.8));
    x.moveTo(...P(15, 21.6)); x.lineTo(...P(15, 27.4));
    x.stroke();
    x.restore();
  }

  // The condensed signage alphabet: one advance and one stem weight for every letter, flat
  // terminals, drawn as strokes. `GLYPH_W` is a letter's width as a share of its cap height and
  // `GLYPH_GAP` the tracking between two letters - the two numbers that make it read condensed.
  _signWidth(word, capH) {
    const w = capH * 0.64;
    const gap = capH * 0.12;
    let total = 0;
    for (let i = 0; i < word.length; i++) {
      total += word[i] === ' ' ? capH * 0.34 : w;
      if (i < word.length - 1) total += gap;
    }
    return total;
  }

  /** Draw one word. `blur`/`glowColor` paint a halo pass instead of the letters themselves. */
  _signWord(x, word, wx, wy, capH, stem, color, blur, glowColor) {
    const w = capH * 0.64;
    const gap = capH * 0.12;
    x.save();
    x.strokeStyle = color;
    x.lineWidth = stem;
    x.lineCap = 'butt';
    x.lineJoin = 'miter';
    if (blur && glowColor) {
      x.shadowColor = glowColor;
      x.shadowBlur = blur;
    }
    let cx = wx;
    for (const ch of word) {
      if (ch === ' ') { cx += capH * 0.34 + gap; continue; }
      this._signGlyph(x, ch, cx, wy, w, capH, stem);
      cx += w + gap;
    }
    x.restore();
  }

  /** One letter, stroked inside its box. Only the letters HOT SHOT and BRICK CITY need. */
  _signGlyph(x, ch, gx, gy, w, h, t) {
    const l = gx + t / 2;
    const r = gx + w - t / 2;
    const top = gy + t / 2;
    const bot = gy + h - t / 2;
    const mx = gx + w / 2;
    const my = gy + h / 2;
    const rad = Math.min(w, h) * 0.18;
    const line = (x1, y1, x2, y2) => { x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); };
    // A BOWL: the D-shaped right half of a B or an R, from the stem at y1 round to the stem at
    // y2. A short flat run off the stem, then one curve out to the right edge and back - the
    // control points sit PAST `r` so the curve actually reaches it, which is what keeps the bowl
    // as full as the box instead of a timid bulge, while the stroke's outer edge still lands on
    // the box (r is already inset by half the stem).
    const bowl = (y1, y2) => {
      const flat = gx + w * 0.28;
      const reach = (r - flat) * 0.36;
      x.beginPath();
      x.moveTo(l, y1);
      x.lineTo(flat, y1);
      x.bezierCurveTo(r + reach, y1, r + reach, y2, flat, y2);
      x.lineTo(l, y2);
      x.stroke();
    };
    switch (ch) {
      case 'H':
        line(l, top, l, bot); line(r, top, r, bot); line(l, my, r, my);
        break;
      case 'I':
        line(mx, top, mx, bot);
        break;
      case 'T':
        line(l, top, r, top); line(mx, top, mx, bot);
        break;
      case 'O':
        this._roundRect(x, l, top, r - l, bot - top, rad);
        x.stroke();
        break;
      case 'C': {
        const cr = rad;
        x.beginPath();
        x.moveTo(r, top);
        x.lineTo(l + cr, top);
        x.arcTo(l, top, l, top + cr, cr);
        x.lineTo(l, bot - cr);
        x.arcTo(l, bot, l + cr, bot, cr);
        x.lineTo(r, bot);
        x.stroke();
        break;
      }
      case 'S': {
        // Two S-curves rather than a boxed path: the first draft was built from arcTo corners and
        // read as a 5, because a squared-off top terminal on a condensed face is what a 5 has.
        const up = top + (my - top) * 0.55;
        const dn = my + (bot - my) * 0.45;
        x.beginPath();
        x.moveTo(r, top + t * 0.55);
        x.bezierCurveTo(r, top, l, top, l, up);
        x.bezierCurveTo(l, my, r, my, r, dn);
        x.bezierCurveTo(r, bot, l, bot, l, bot - t * 0.55);
        x.stroke();
        break;
      }
      case 'B':
        line(l, top, l, bot);
        bowl(top, my);
        bowl(my, bot);
        break;
      case 'R':
        line(l, top, l, bot);
        bowl(top, my);
        // The leg starts under the bowl's own shoulder, not at the stem, so it reads as a leg
        // rather than a stray diagonal.
        line(gx + w * 0.34, my, r, bot);
        break;
      case 'K':
        line(l, top, l, bot);
        line(r, top, l + t * 0.35, my);
        line(l + t * 0.35, my, r, bot);
        break;
      case 'Y':
        line(l, top, mx, my);
        line(r, top, mx, my);
        line(mx, my, mx, bot);
        break;
      default:
        // Nothing else is on this sign. A letter with no glyph draws nothing rather than a box -
        // a missing letter is a bug to fix in the name, not something to paint a tofu for.
        break;
    }
  }

  _buildBall() {
    const R = this.G.ballR;
    // A speckled two-tone surface so the ROLL is visible - a plain sphere spins invisibly.
    const c = this._canvas(128, 64);
    const x = c.getContext('2d');
    if (this.board.dressing === 'basketball') {
      // A BASKETBALL: pebbled orange with black seams. Equirect wrap: the horizontal band is
      // the equator seam, the vertical bands are meridians. The pebble speckle keeps the roll
      // visible, same job as the classic ball's flecks.
      x.fillStyle = '#e8641f';
      x.fillRect(0, 0, 128, 64);
      for (let i = 0; i < 60; i++) {
        x.globalAlpha = 0.14;
        x.beginPath();
        x.arc((i * 41) % 128, (i * 23) % 64, 1.6, 0, Math.PI * 2);
        x.fillStyle = i % 2 ? '#a3400f' : '#ff8a45';
        x.fill();
      }
      x.globalAlpha = 1;
      x.fillStyle = '#241505';
      x.fillRect(0, 30, 128, 3);                        // equator
      for (const sx of [0, 32, 64, 96]) x.fillRect(sx, 0, 3, 64);   // meridians
    } else {
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
      x.globalAlpha = 1;
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
      // .map FIRST: Material.dispose() does NOT dispose its textures, so every scoring ball used
      // to leave its 256x128 popup texture on the GPU for the life of the page - about a megabyte
      // a rack, never freed, which is why a long session got choppier than a fresh one (2026-08-26).
      if (s.userData.t > 1.1) { this.scene.remove(s); if (s.material.map) s.material.map.dispose(); s.material.dispose(); this._popups.splice(i, 1); }
    }
    // THE WALL MARKS: expand a little and fade. A mark is TWO rings (see wallMarkAt) held in one
    // group, so the group carries the clock and the two materials are faded together.
    for (let i = this._wallMarks.length - 1; i >= 0; i--) {
      const g = this._wallMarks[i];
      g.userData.t += dt;
      const k = g.userData.t / WALL_MARK_LIFE;
      if (!REDUCED) { const sc = g.userData.r * (1 + k * 0.55); g.scale.set(sc, sc, sc); }
      for (const m of g.children) m.material.opacity = Math.max(0, m.userData.o0 * (1 - k));
      if (k >= 1) {
        this.scene.remove(g);
        for (const m of g.children) m.material.dispose();
        this._wallMarks.splice(i, 1);
      }
    }
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const pt = this._particles[i];
      pt.userData.t += dt;
      pt.userData.vel.y -= dt * 2.2;
      pt.position.addScaledVector(pt.userData.vel, dt);
      pt.material.opacity = Math.max(0, 0.9 - pt.userData.t);
      if (pt.userData.t > 1) { this.scene.remove(pt); pt.material.dispose(); this._particles.splice(i, 1); }
    }
    if (this._celebrateT > 0) {
      this._celebrateT -= dt;
      const on = REDUCED ? 1 : (Math.sin(this._celebrateT * 18) > 0 ? 1.6 : 0.25);
      for (const b of this._marqueeBulbs) b.material.emissiveIntensity = on;
      if (this._celebrateT <= 0) for (const b of this._marqueeBulbs) b.material.emissiveIntensity = 0.55;
    }
    // THE SHADOW PASS, ONLY WHEN SOMETHING THAT CASTS ONE HAS MOVED: a ball actually IN PLAY, a
    // live popup or particle, or a celebrating marquee.
    //
    // `live.length`, NOT `used`: `used` counts the ball parked on the serve spot as well, and that
    // one does not move - gating on it left the pass running on every frame of the wait between
    // throws, which is most of a rack and exactly the still life this gate exists for. `used`
    // CHANGING still counts, because the frame a ball stops being drawn has to repaint the map or
    // its shadow is left lying on the lane under nothing.
    this.renderer.shadowMap.needsUpdate = live.length > 0 || used !== this._shadowUsed
      || this._popups.length > 0 || this._particles.length > 0 || this._celebrateT > 0
      || this._wallMarks.length > 0;
    this._shadowUsed = used;
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

  /** WHERE THE BALL STRUCK A WALL - a ring on the surface it hit, at the point it hit it.
   *
   *  Matt, 2026-09-03: "It's impossible to tell where on the back wall a ball that's overthrown
   *  bounces off. Sometimes I'll throw it and it doesn't look like it even touched the back wall,
   *  but based off how it lands I know it must have." The engine always knew - physics.js's
   *  'wall' event carries the part, the point and the impact speed - and nothing drew it, so a
   *  bounce read as the ball changing direction in front of a flat wall for no reason.
   *
   *  TWO RINGS, dark behind bright, for the same reason popupAt strokes its text before filling
   *  it: this wall is not one colour. The lower half is the scoreboard (cream panels, gold
   *  numbers) and the upper half is near-black cabinet, and a single-colour ring is invisible on
   *  one or the other. The pair reads on both.
   *
   *  SIZE IS THE IMPACT SPEED, so a graze and a hammer do not look alike - the second half of
   *  what Matt was asking for. The ball is 10.9 cm across; a mark runs 8 to 16 cm, so it reads at
   *  the ball's own scale rather than as a decal on the scenery.
   *
   *  GUARD: geometry is SHARED and tracked once (a ring per impact would leak one per bounce, the
   *  mistake popupAt's textures made - see the .map note in render()); the two materials are
   *  per-mark and disposed when it expires. */
  wallMarkAt(pos, part, speed) {
    if (!this._markGeo) {
      // A unit ring: scaled per mark, so nothing is allocated per impact.
      this._markGeo = this._track(new THREE.RingGeometry(0.62, 1.0, 28));
      this._markGeoOuter = this._track(new THREE.RingGeometry(0.52, 1.12, 28));
    }
    const g = new THREE.Group();
    // DOUBLE-SIDED, and that is not belt and braces: a ring faces +z by its own geometry, so
    // the one turned onto a side rail ends up facing OUTBOARD, away from a camera standing on the
    // machine centreline - single-sided, every rail mark was culled and simply never appeared.
    const halo = new THREE.Mesh(this._markGeoOuter,
      new THREE.MeshBasicMaterial({ color: 0x14161b, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    halo.userData.o0 = 0.55;
    const ring = new THREE.Mesh(this._markGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd977, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    ring.userData.o0 = 0.95;
    g.add(halo, ring);
    // ON THE SURFACE, NOT WHERE THE BALL WAS. The event carries the ball's CENTRE, which at
    // the moment of contact stands a whole ball radius (5.45 cm) off the wall - drawn there the
    // mark floats in mid-air in front of the machine, and on a side rail it is turned edge-on to
    // the camera and all but invisible. So only the two coordinates ALONG the wall come from the
    // ball; the third is the wall's own plane, taken from machine.js so it cannot drift from the
    // surface the ball actually hit. OFF stands it 14 mm proud so it cannot z-fight.
    const OFF = 0.014;
    if (part === 'rail') {
      // A side rail's face is x-constant, at railInnerX.
      g.position.set(Math.sign(pos.x || 1) * (this.M.railInnerX - OFF), pos.y, pos.z);
    } else {
      const bb = this.M.solids.find((sd) => sd.part === 'backboard');
      const faceZ = bb ? bb.pos[2] + bb.half[2] : pos.z;
      g.position.set(pos.x, pos.y, faceZ + OFF);
    }
    // AND IT FACES THE PLAYER, on every surface. Laid FLAT on a side rail the ring is seen almost
    // edge-on from where the player stands and reads as a thin sliver - measured by looking at it,
    // which is the only way this kind of thing is ever measured. A mark is an annotation, not a
    // sticker on the scenery: it sits WHERE the ball hit and turns to be read. The camera does not
    // move during a rack, so aiming it once at creation is enough.
    g.lookAt(this.camera.position);
    g.userData = { t: 0, r: 0.058 + 0.058 * Math.min(1, (speed || 0) / 2.0) };
    g.scale.setScalar(g.userData.r);
    this.scene.add(g);
    this._wallMarks.push(g);
    // Nine balls of rail-grinding must never outlive their welcome on screen.
    if (this._wallMarks.length > 14) {
      const old = this._wallMarks.shift();
      this.scene.remove(old);
      for (const m of old.children) m.material.dispose();
    }
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
    for (const p of this._popups) { this.scene.remove(p); if (p.material.map) p.material.map.dispose(); p.material.dispose(); }
    for (const p of this._particles) { this.scene.remove(p); p.material.dispose(); }
    for (const g of this._wallMarks) { this.scene.remove(g); for (const m of g.children) m.material.dispose(); }
    this._popups = [];
    this._particles = [];
    this._wallMarks = [];
    for (const d of this._disposables) { if (d && d.dispose) d.dispose(); }
    this._disposables = [];
    this.renderer.dispose();
  }
}

export default { Renderer };
