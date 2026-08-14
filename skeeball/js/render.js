// skeeball/js/render.js - the machine on screen, drawn by three.js (skeeball/js/vendor/,
// vendored 2026-08-13 alongside cannon-es on Matt's instruction). The scene is built from the
// SAME machine description physics.js simulates (machine.js), so the geometry on screen is the
// geometry the ball hits - plus purely cosmetic dressing (paint, marquee, cabinet, room) that
// has no physics body and never will.
//
// What this renderer exists to fix, in Matt's words (2026-08-13): the board must read as a
// SLOPED RAMP, not a wall (true perspective camera + directional light + real shadows); the
// point values must be READABLE (fat tubes, big stencilled numbers painted on the field); the
// zones must be DEFINED (each mouth's zone painted right on the board texture). The ball is a
// real mesh driven by the physics body's position AND quaternion, so it visibly rolls.

import * as THREE from './vendor/three.module.min.js';
import { buildMachine } from './machine.js';

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  constructor(canvas, board) {
    this.board = board;
    this.look = board.look;
    this.G = board.geom;
    this.M = buildMachine(board.geom);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.look.wall);
    this.scene.fog = new THREE.Fog(this.look.wall, 4.5, 9);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.05, 12);
    // WHERE THE PLAYER STANDS. Behind the ball, looking down the lane at the board - the view
    // you have with a ball in your hand.
    //
    // It used to sit at z = -0.34, which is PAST the serve spot at z = -0.12: the camera was in
    // front of the ball, so the ball waiting to be thrown projected to y = -3875px on a 773px
    // canvas (measured 2026-08-14) and was simply not on screen. There was no ball anywhere
    // until 250ms into a throw, when one appeared mid-flight at the bottom edge. Most of the
    // lane was behind the viewer too, so the bottom 187px of the screen - the 22% the player is
    // told to swipe on - was a flat brown field with nothing in it.
    //
    // z = +0.52 puts the eye 0.64m behind the ball. The lane now runs away from the player, the
    // ball sits on it from the moment the rack starts, and the board still fills the frame
    // because resize() below fits the FOV to it from wherever this camera is.
    // The height is the compromise the framing turns on. Higher looks down on the board and
    // shows its face square, but pushes the near ball further under the frame and forces a wider
    // FOV to keep it, which shrinks everything. Lower keeps the ball cheaply but flattens the
    // board towards edge-on. 0.42 holds the board readable while the ball sits comfortably in
    // the bottom third.
    this.camera.position.set(0, 0.45, 1.00);
    // Aimed BELOW the board's bottom edge, down into the trough. Pitch was the degree of
    // freedom the spec never had: with the aim locked on the board's centre, the board's top
    // edge and the resting ball can never both reach their frame edges, whatever the height or
    // distance. Solved against the acceptance checks, not chosen.
    {
      const a = this.M.faceToWorld(0, this.G.boardLen * -0.40, 0);
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
      if (s.part === 'keep' || s.part === 'glass' || s.part === 'ringSeg' || s.part === 'cupSeg') continue;
      if (s.part === 'cage') { this._cage(s); continue; }
      // The backboard is the cabinet's face card: it wears the machine's name and trim, which
      // is what turns a brown wall at the end of the lane into an arcade machine.
      const mat = s.part === 'lane' || s.part === 'hump' ? wood
        : s.part === 'board' ? faceEdge
          : s.part === 'trough' || s.part === 'kick' ? dark
            : s.part === 'backboard'
              ? [cabinet, cabinet, cabinet, cabinet, this._mat({ map: this._track(this._paintBackboard()), roughness: 0.6 }), cabinet]
              : woodDark;
      const mesh = new THREE.Mesh(this._track(new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2)), mat);
      mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.rot) mesh.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      mesh.receiveShadow = true;
      if (s.part !== 'lane' && s.part !== 'board') mesh.castShadow = true;
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

    // THE CUPS. A hole in a board, drawn as a hole in a board: a dark mouth flush in the face,
    // with its white rim, its navy trim and its VALUE painted into the field texture around it
    // (see _paintField). Nothing stands up off the face, because after 2026-08-14 nothing does
    // in the physics either - every cup is `collarH: 0` (boards.js), so this is once again
    // literally true: the surface you see is the surface the ball rolls on.
    //
    // WHAT THIS REPLACED, so nobody rebuilds it. Each cup used to be a white cylinder wearing a
    // flat number panel placed at z = radius * 0.995 - i.e. a flat plate set INSIDE a curved
    // wall of that same radius. A plane cannot sit inside a cylinder without intersecting it, so
    // the wall cut a curved bite out of every number: the 50, the 40, the 30, the ring's 20 and
    // both 100s all rendered with their bottom halves missing. On top of that the mouth was laid
    // flat on the face while the tube was tilted -0.32 rad, so each black opening slid out from
    // under its own cup and read as a separate blob beside the next one down. Numbers belong on
    // the board.
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
      // A machine that DOES want a raised rim (a future board) still gets one, and it is drawn
      // with the same scalloped profile machine.js gives the physics - low at the down-slope
      // lip, full height at the up-slope one - rather than a straight cylinder plus a tilt.
      const wall = this._scallopedRim(H.r + G.collarThick / 2, H.collarH,
        H.lipLow ? (typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35) : 1);
      this._onFace(wall, H.u, H.v, 0);
      this.scene.add(wall);
    }

    // Cabinet dressing: side panels, the marquee, its bulbs. Cosmetic only.
    this._cabinet();
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
    // The physics slab, drawn as the sparse wire canopy it stands in for. Deliberately THIN and
    // pale: the cage sits between the camera and the board, and heavy dark bars turned the top
    // half of the screen into a fence (they read as the subject instead of the board).
    // Pale and semi-transparent. From behind the ball the canopy sits directly across the
    // backglass, and as opaque dark bars it read as cracks in the screen rather than as wire.
    // It stays drawn - and stays a physics body - because the invariant that the thing you see
    // is the thing the ball hits cuts both ways: an invisible wall would be the worse lie. It
    // has never actually been touched (cagecheck: 0 contacts in 255 throws, ball ceiling y=0.61
    // against a canopy at y=0.67), which is why it can afford to be this quiet.
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
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(
        this._track(new THREE.BoxGeometry(0.045, topY + G.backboardH + 0.15, -M.lipZ + 0.55)),
        side,
      );
      panel.position.set(s * (G.boardW / 2 + 0.055), (topY + G.backboardH) / 2 - 0.1, (M.lipZ - 0.55) / 2 + 0.12);
      panel.castShadow = true;
      panel.receiveShadow = true;
      this.scene.add(panel);
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

    // The big painted target circle the real board carries, around the whole cup ladder. It was
    // a 7.5cm WALL until 2026-08-14, which fenced the cups off from any rolling ball; as paint
    // it still frames the cluster and blocks nothing.
    x.beginPath();
    x.arc(U(G.ring.u), V(G.ring.v), G.ring.R * px, 0, Math.PI * 2);
    x.strokeStyle = 'rgba(255,246,228,0.5)';
    x.lineWidth = 16;
    x.stroke();
    x.beginPath();
    x.arc(U(G.ring.u), V(G.ring.v), G.ring.R * px, 0, Math.PI * 2);
    x.strokeStyle = L.ringLip;
    x.lineWidth = 4;
    x.stroke();

    // EVERY HOLE: its rim, and its VALUE, painted on the board. The number sits just down-slope
    // of its own mouth, which is where the real machine puts it and - more to the point - where
    // it cannot be occluded by anything, because it is part of the board.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const cx = U(H.u);
      const cy = V(H.v);
      const rp = H.r * px;
      // a soft seat under the rim so the hole reads as sunk into the board
      const grad = x.createRadialGradient(cx, cy, rp * 0.9, cx, cy, rp * 1.55);
      grad.addColorStop(0, 'rgba(20,10,4,0.42)');
      grad.addColorStop(1, 'rgba(20,10,4,0)');
      x.fillStyle = grad;
      x.beginPath();
      x.arc(cx, cy, rp * 1.55, 0, Math.PI * 2);
      x.fill();
      // the white rim with its navy trim line, the classic board's look
      x.beginPath();
      // Outer edge at 1.10x the hole radius, down from 1.28x: at 1.28 the painted rings
      // overlapped each other at 0.22 spacing even though the holes did not, which is what fused
      // the 30/40/50 into a single shape on screen.
      x.arc(cx, cy, rp * 1.03, 0, Math.PI * 2);
      x.strokeStyle = L.ring;
      x.lineWidth = rp * 0.14;
      x.stroke();
      x.beginPath();
      x.arc(cx, cy, rp * 1.10, 0, Math.PI * 2);
      x.strokeStyle = L.ringLip;
      x.lineWidth = Math.max(3, rp * 0.07);
      x.stroke();
      // THE VALUE, on the board, BESIDE its own mouth - one either side for the centreline cups.
      //
      // It used to go up-slope of the hole. That worked while the holes were small: at radius
      // 0.076 and 0.22 spacing there was a band of bare board above each mouth to put a number
      // in. Widening the board to 1.00m took the holes to radius 0.095, whose painted rim
      // reaches 0.1045 - past the 0.102 offset the label sat at - so every centreline number was
      // buried under its own ring and simply did not render. The free band between one rim top
      // (0.1045) and the next mouth bottom (0.125) is 0.02m; no number fits there.
      //
      // The wide board is what pays for the fix: there is now a third of a metre of bare face on
      // each side of the centreline. Mirrored pairs also read as deliberate rather than as a
      // number that drifted off its hole.
      if (H.value >= 100) {
        stencil(String(H.value), H.u, H.v - 0.145, 0.044, L.ring);
      } else {
        stencil(String(H.value), -0.23, H.v, 0.050, L.ring);
        stencil(String(H.value), 0.23, H.v, 0.050, L.ring);
      }
    }

    // The 10 slot's own number, and the corner 0s. The 0s moved inboard from u = +/-0.33 to
    // +/-0.30 on 2026-08-14: at 0.33 on a 0.78-wide board they sat right on the frame edge and
    // both were sliced in half by it (resize()'s fit margin now clears them too).
    stencil('10', 0, 0.022, 0.052);
    stencil('0', -0.30, 0.025, 0.044, '#ffb28a');
    stencil('0', 0.30, 0.025, 0.044, '#ffb28a');

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

  /** The backboard's face: the machine's name on the cabinet colour with a trim band, the way a
   *  real cabinet's upper case is painted. Faces the player at the end of the lane. */
  _paintBackboard() {
    const W = 1024;
    const Hpx = 512;
    const c = this._canvas(W, Hpx);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, Hpx);
    g.addColorStop(0, this.look.cabinet);
    g.addColorStop(1, this.look.cabinetEdge);
    x.fillStyle = g;
    x.fillRect(0, 0, W, Hpx);
    // Trim bands top and bottom.
    x.fillStyle = this.look.ringLip;
    x.fillRect(0, Hpx * 0.1, W, 14);
    x.fillRect(0, Hpx * 0.78, W, 14);
    x.font = '700 118px Georgia, serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    // The machine's NAME belongs to the marquee above, and nowhere else. It used to be painted
    // here as well, at 118px, so from behind the ball the player read "THE CLASSIC" twice down
    // the top quarter of the screen. The upper case carries the ball count and its trim.
    x.fillStyle = 'rgba(255,217,119,0.72)';
    x.font = '600 58px Georgia, serif';
    x.fillText('NINE BALLS', W / 2, Hpx * 0.46);
    return new THREE.CanvasTexture(c);
  }

  _paintMarquee() {
    const c = this._canvas(512, 96);
    const x = c.getContext('2d');
    x.fillStyle = this.look.marquee;
    x.fillRect(0, 0, 512, 96);
    x.font = '700 52px Georgia, serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = this.look.marqueeText;
    x.fillText(this.board.name, 256, 52);
    return new THREE.CanvasTexture(c);
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

    // FRAME THE MACHINE, not the board's width. The old rule set the FOV purely so the board
    // spanned the frame horizontally, which on a tall phone left a vertical field far too narrow
    // to contain the thing at the near end of it - the BALL. Deriving the FOV from the two
    // points that must always be visible fixes that by construction, and keeps working if the
    // camera ever moves again:
    //
    //   the ball waiting on the lane  (bottom of frame - if this is off screen there is no game)
    //   the top of the marquee        (top of frame)
    //
    // Then, only if the board would be cut off sideways, widen until it is not. Vertical need
    // leads; horizontal is the backstop.
    const eye = this.camera.position;
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const angleOff = (pt) => {
      const d = new THREE.Vector3(pt[0], pt[1], pt[2]).sub(eye);
      const along = d.dot(axis);
      if (along <= 0.01) return Math.PI / 2;
      // vertical component only: the up-down half-angle this point needs
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
      return Math.atan(Math.abs(d.dot(up)) / along);
    };
    const topY = this.M.faceToWorld(0, this.G.boardLen, 0)[1];
    const topZ = this.M.faceToWorld(0, this.G.boardLen, 0)[2];
    // FRAME THE BOARD, and nothing above it. Its top edge sits at the top of the canvas.
    //
    // The ball is deliberately NOT part of this fit any more. It sits close to the camera, so
    // including it forced a wide FOV that squashed the board into a strip with a dead band above
    // it - which is exactly what the 2026-08-14 screenshot showed: board 17% of screen height,
    // 22% of the screen given over to a decorative panel. Framing the marquee had the same
    // effect for the same reason. What keeps the ball on screen now is the camera's POSITION,
    // and the seven screen-space acceptance checks are what verify it.
    const need = angleOff([0, this.G.ballR, -0.12]);   // the resting ball, at the bottom edge
    let vFov = 2 * need * 1.235;   // tuned so the resting ball measures 14% of screen width

    const mid = this.M.faceToWorld(0, this.G.boardLen * 0.45, 0);
    const dist = eye.distanceTo(new THREE.Vector3(mid[0], mid[1], mid[2]));
    const halfW = this.G.boardW / 2 + 0.055;                     // clears the corner 0s at +/-0.30
    const needH = 2 * Math.atan(halfW / dist);
    const haveH = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    if (haveH < needH) vFov = 2 * Math.atan(Math.tan(needH / 2) / this.camera.aspect);

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
