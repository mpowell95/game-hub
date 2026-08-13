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
    // Low and close: the board must DOMINATE the frame (Matt's standing rule), with the lane
    // entering from the bottom edge and the marquee just clearing the top.
    this.camera.position.set(0, 0.56, 0.16);
    this.camera.lookAt(0, 0.30, -1.95);

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
    const key = new THREE.DirectionalLight(0xffe8c8, 1.6);
    key.position.set(0.8, 2.4, 0.9);
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
      const mat = s.part === 'lane' || s.part === 'hump' ? wood
        : s.part === 'board' ? faceEdge
          : s.part === 'trough' || s.part === 'kick' ? dark
            : s.part === 'backboard' ? cabinet : woodDark;
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

    // The big ring band: one smooth open cylinder at the physics radius, white with a navy lip.
    {
      const ring = G.ring;
      const geo = this._track(new THREE.CylinderGeometry(ring.R, ring.R, G.ringH, 64, 1, true));
      const mesh = new THREE.Mesh(geo, this._track(new THREE.MeshStandardMaterial({
        color: L.ring, roughness: 0.35, side: THREE.DoubleSide,
      })));
      this._onFace(mesh, ring.u, ring.v, G.ringH / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const lip = new THREE.Mesh(
        this._track(new THREE.TorusGeometry(ring.R, G.ringThick * 0.7, 10, 64)),
        this._mat({ color: L.ringLip, roughness: 0.4 }),
      );
      this._onFace(lip, ring.u, ring.v, G.ringH, true);
      this.scene.add(lip);
    }

    // The cups: fat open tubes, white, navy lip, dark mouth sunk into the face. lipLow cups
    // (the 100s) tilt down-slope so the mouth faces the player, like the real tilted tubes.
    for (const id of Object.keys(G.holes)) {
      const H = G.holes[id];
      const rr = H.r + G.collarThick / 2;
      // The mouth: a black disc in the hole, visible from every angle that matters.
      const mouth = new THREE.Mesh(
        this._track(new THREE.CircleGeometry(H.r + G.collarThick, 40)),
        this._mat({ color: 0x050403, roughness: 1 }),
      );
      this._onFace(mouth, H.u, H.v, 0.004, true);
      this.scene.add(mouth);
      this._flashes.set(id, this._makeFlash(H));
      if (!H.collarH) continue;
      const h = H.lipLow ? H.collarH * 0.72 : H.collarH;
      const tube = new THREE.Mesh(
        this._track(new THREE.CylinderGeometry(rr + G.collarThick / 2, rr + G.collarThick / 2, h, 40, 1, true)),
        this._track(new THREE.MeshStandardMaterial({ color: L.ring, roughness: 0.35, side: THREE.DoubleSide })),
      );
      this._onFace(tube, H.u, H.v, h / 2);
      if (H.lipLow) tube.rotateX(-0.32);          // mouth plane faces the incoming ball
      tube.castShadow = true;
      tube.receiveShadow = true;
      this.scene.add(tube);
      const lip = new THREE.Mesh(
        this._track(new THREE.TorusGeometry(rr + G.collarThick / 2, G.collarThick * 0.62, 10, 40)),
        this._mat({ color: L.ringLip, roughness: 0.4 }),
      );
      this._onFace(lip, H.u, H.v, h, true);
      if (H.lipLow) lip.rotateX(-0.32);
      this.scene.add(lip);
      // The value plate ON the tube's front wall, where the real machines paint it - the number
      // must be readable from the player's eye line, and the painted field stencil alone hides
      // behind the tube from a low camera.
      const plate = new THREE.Mesh(
        this._track(new THREE.PlaneGeometry(0.12, 0.062)),
        this._mat({ map: this._track(this._paintValue(H.value)), transparent: true }),
      );
      const pc = this.M.faceToWorld(H.u, H.v - rr - G.collarThick - 0.004, h * 0.42);
      plate.position.set(pc[0], pc[1], pc[2]);
      // Stand it on the face, leaning back with the tube so it faces the player's eye.
      plate.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.M.tilt - Math.PI / 14);
      this.scene.add(plate);
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
    // The physics slab, drawn as the sparse wire canopy it stands in for.
    const mat = this._mat({ color: 0x2a2a30, roughness: 0.5, metalness: 0.6 });
    const len = s.half[2] * 2;
    for (let i = -4; i <= 4; i++) {
      const bar = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.006, 0.006, len, 6)), mat);
      bar.position.set(s.pos[0] + (i / 4) * (s.half[0] - 0.03), s.pos[1], s.pos[2]);
      bar.quaternion.setFromAxisAngle(new THREE.Vector3(...s.rot.axis), s.rot.angle);
      bar.rotateX(Math.PI / 2);
      this.scene.add(bar);
    }
    for (const off of [-0.3, 0.1]) {
      const cross = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.005, 0.005, s.half[0] * 2, 6)), mat);
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
    const stencil = (txt, u, v, size, color = '#f7ecd8') => {
      x.font = `800 ${Math.round(size * px)}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.lineWidth = Math.max(3, size * px * 0.12);
      x.strokeStyle = 'rgba(20,10,4,0.85)';
      x.strokeText(txt, U(u), V(v));
      x.fillStyle = color;
      x.fillText(txt, U(u), V(v));
    };
    stencil('10', 0, 0.028, 0.075);
    stencil('0', -0.33, 0.03, 0.06, '#ffb28a');
    stencil('0', 0.33, 0.03, 0.06, '#ffb28a');

    // Each mouth's footprint ring + its BIG value stencilled just below the mouth, where the
    // real boards paint them. This is the "which area is worth what" layer, made unmissable.
    const zones = [
      { id: 'h20', label: '20', dv: -0.115, size: 0.085 },
      { id: 'c30', label: '30', dv: -0.128, size: 0.085 },
      { id: 'c40', label: '40', dv: -0.126, size: 0.085 },
      { id: 'c50', label: '50', dv: -0.122, size: 0.085 },
      { id: '100L', label: '100', dv: -0.13, size: 0.075 },
      { id: '100R', label: '100', dv: -0.13, size: 0.075 },
    ];
    for (const z of zones) {
      const hole = G.holes[z.id];
      x.beginPath();
      x.arc(U(hole.u), V(hole.v), (hole.r + G.collarThick * 2) * px, 0, Math.PI * 2);
      x.strokeStyle = 'rgba(255,244,224,0.5)';
      x.lineWidth = 3;
      x.stroke();
      const lu = z.id === '100L' ? hole.u + 0.09 : z.id === '100R' ? hole.u - 0.09 : hole.u;
      stencil(z.label, lu, hole.v + z.dv, z.size);
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

  /** A tube's front value plate: big white number on the navy trim colour. */
  _paintValue(value) {
    const c = this._canvas(192, 96);
    const x = c.getContext('2d');
    x.fillStyle = this.look.ringLip;
    const r = 26;
    x.beginPath();
    x.roundRect(4, 4, 184, 88, r);
    x.fill();
    x.font = '800 62px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#f7f2e6';
    x.fillText(String(value), 96, 52);
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
    // Fit the machine's width: the board plus a whisker of margin fills the frame.
    const halfW = this.G.boardW / 2 + 0.05;
    const dist = 2.35;
    const hFov = 2 * Math.atan(halfW / dist);
    const vFov = 2 * Math.atan(Math.tan(hFov / 2) / this.camera.aspect);
    this.camera.fov = Math.max(40, (vFov * 180) / Math.PI);
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
