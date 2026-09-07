// pinball/js/render3d.js - the playfield in three dimensions, which is what the attached model
// actually is.
//
// WHY THIS FILE EXISTS. The 2026-09-06 conversion took Matt's three.js playfield model and drew it
// as flat top-down art. Matt: "Claude Design created a beautiful, 3D pinball gameplay board. Why
// did you flatten it to shit and make it look terrible?" He was right and there was no good reason:
// the game is a 2D canvas with a 2D solver, so I decided flat art was the pragmatic route and wrote
// that down as an assumption instead of asking. The model IS the deliverable, so this renders it.
//
// THE PHYSICS STAYS TWO-DIMENSIONAL, AND THAT IS CORRECT, NOT A COMPROMISE. A pinball is a ball on
// a tilted plane; every commercial pinball simulation solves it in 2D and renders in 3D. game.js
// and physics.js are untouched by this file. What changes is only what you look at.
//
// COORDINATES. table.js works in table units with y DOWN. three.js is y-UP. So:
//
//     world.x = table.x        world.y = height above the deck        world.z = -table.y
//
// THE MINUS IS NOT A TASTE DECISION AND IT IS THE ONE THING TO GET RIGHT IN THIS FILE. Every
// flat part is an ExtrudeGeometry authored in table coordinates and then rotated -90 degrees
// about X, which is what stands it up on the deck - and that rotation maps the shape's +y onto
// world -z. So the deck, the rails and the art already live at negative z, and every mesh placed
// BY HAND has to agree with them. The first build did not: the extrusions went one way, the
// bumpers and the ball went the other, and the table rendered inside out with its floor behind
// the camera. `tz()` is the single place that conversion happens now.
//
// The deck's top surface is world y = 0 and every part's height is the model's own, converted at
// table.js's K (666.67 units per model metre). A post is 46 mm in the model, so 31 units tall here.
//
// EVERY MATERIAL IS THE MODEL'S. Nine of them, verbatim, including the emissive intensities - which
// is the half the flat renderer threw away and the reason its amber lamps came out brown and its
// cyan inserts came out navy. If a colour looks wrong, the conversion is wrong.
//
// THE EFFECTS LAYER IS STILL 2D, on its own canvas over the top. Particles, score popups and the
// full-screen flashers are screen-space things; billboarding them into the scene would cost a lot
// and buy nothing. `_project()` puts a table coordinate where the 3D camera would put it, so a
// popup still appears over the part that scored.

import * as THREE from './vendor/three.module.min.js';
import {
  W, H, ARCH, AXIS, FLIP, PLUNGER, RAMP_PATH, DRAIN_Y, ART, DROP_COUNT, K,
} from './table.js';
import { rampPoint } from './game.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** table y -> world z. See the header: the extruded parts land at -y, so everything must. */
const tz = (y) => -y;

/** A table-space angle (y down) as a three.js rotation about world Y. Falls out of tz(): a table
 *  direction (cos t, sin t) is world (cos t, -sin t), and a Y rotation of t is exactly that. */
const ty = (angle) => angle;

/** The model's nine materials, plus the ball and the background. */
const C = {
  void: 0x0e0b17,
  art: 0x2a1e49,
  artLit: 0x3c2b6d,
  chrome: 0xdae0ea,
  steel: 0xa8afbd,
  magenta: 0xff3392,
  cyan: 0x33dcff,
  amber: 0xffb43c,
  violet: 0x7d47dc,
  rubber: 0x1a1a22,
  cap: 0xf0f3fa,
  ball: 0xe8ecf2,
};

/** Model metres -> table units. A model height of 0.046 is 31 units here. */
const mm = (metres) => metres * K;

/** Is this a SOFTWARE GL context (SwiftShader, llvmpipe)? Same probe Skeeball uses, and for the
 *  same two reasons: a software rasteriser cannot afford antialiasing, a full pixel ratio or a
 *  shadow pass, and the headless browsers the visual suite runs in are all software. Memoised, so
 *  the probe happens once per page rather than once per Renderer, and the context is handed back
 *  immediately. Never throws - an unanswerable probe means "not software". */
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

// ui.js drains game.js's event stream and names four colours by an older, generic set of keys.
// They map onto the model's materials rather than being values of their own.
const PALETTE = {
  void: '#0e0b17', art: '#2a1e49', artLit: '#3c2b6d', chrome: '#dae0ea', steel: '#a8afbd',
  magenta: '#ff3392', cyan: '#33dcff', amber: '#ffb43c', violet: '#7d47dc', rubber: '#1a1a22',
  cap: '#f0f3fa', ball: '#e8ecf2',
  gold: '#ffb43c', green: '#33dcff', red: '#ff3392', metal: '#dae0ea',
};

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas    the WebGL canvas
   * @param {HTMLCanvasElement} [fxCanvas] the 2D overlay for particles and popups
   */
  constructor(canvas, fxCanvas) {
    this.canvas = canvas;
    this.fx = fxCanvas || null;
    this.fxCtx = this.fx ? this.fx.getContext('2d') : null;
    this.dpr = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.reduced = false;
    try {
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { /* no matchMedia: assume full motion */ }

    // effects (screen space, drawn on the overlay)
    this.parts = [];
    // popups live on the BACKGLASS now, never over the playfield - see popup()
    this.shake = 0;
    this.flashAmt = 0;
    this.flashColor = PALETTE.cyan;
    this.popPulse = [0, 0, 0];
    this.slingPulse = [0, 0];
    this.dropAnim = new Array(DROP_COUNT).fill(0);
    this.standPulse = [0, 0];
    this.scoopPulse = 0;
    this.spinAngle = 0;
    this.spinSpeed = 0;
    this.lanePulse = { laneH: 0, laneU: 0, laneB: 0 };
    this.rampGlow = 0;
    this.time = 0;

    this.ok = this._boot();
  }

  // --- scene -------------------------------------------------------------------------------------

  _boot() {
    const soft = isSoftGL();
    this.softGL = soft;
    let renderer;
    try {
      // preserveDrawingBuffer: the canvas has to be READABLE after a frame. Without it a WebGL
      // canvas reads back blank, and test-visual.mjs's PLAY probe - which samples the canvas three
      // times to prove the table is actually animating - fails with "nothing is moving" on a game
      // that is running perfectly. Skeeball's renderers carry the same flag for the same reason.
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: !soft, alpha: false, preserveDrawingBuffer: true,
      });
    } catch (err) {
      console.error('[pinball] WebGL is unavailable', err);
      return false;
    }
    renderer.setClearColor(C.void, 1);
    renderer.shadowMap.enabled = !soft;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // THE SHADOW PASS RUNS ON DEMAND, NOT EVERY FRAME. three.js re-renders the whole shadow map
    // every frame by default, which draws every caster in the scene a second time - and almost
    // nothing here moves. Only the flippers, the ball and the drop targets do, so the map is
    // refreshed when one of those changes and left alone otherwise. Ported from Skeeball, where
    // it was the fix for "make the classic machine less choppy".
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    // The model's own studio: a soft sky/ground wash, one shadow-casting key, and a dim fill from
    // behind so nothing silhouettes to black.
    // 0.62, not the stage's 1.0: this scene is looked at from one side only and lit against a
    // near-black background, and at full strength the hemisphere washed the deck from the model's
    // deep violet out to a flat lavender.
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x241a3d, 0.62));
    const key = new THREE.DirectionalLight(0xfff3e2, 1.45);
    key.position.set(-W * 0.75, 620, tz(-120));
    key.target.position.set(-AXIS, 0, tz(330));
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0015;
    const sc = key.shadow.camera;
    sc.left = -320; sc.right = 320; sc.top = 460; sc.bottom = -460; sc.near = 60; sc.far = 1500;
    sc.updateProjectionMatrix();
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.42);
    fill.position.set(W * 0.6, 340, tz(900));
    scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(42, 1, 20, 3000);

    this.M = this._materials();
    this.parts3 = {};
    this.model = new THREE.Group();
    this._build(this.model);
    // MIRRORED IN X, AND THAT IS A CONSEQUENCE OF tz(), NOT A CHOICE. Putting up-field at
    // NEGATIVE z means the camera has to sit at very negative z and look back along +z - and a
    // camera looking along +z has world +x on its LEFT. One axis flip makes the whole table a
    // mirror image: the first build put the plunger on the left and the spinner on the right,
    // which reads as almost right and is completely wrong. Flipping x as well restores the
    // handedness. three.js handles the negative determinant itself (it flips the winding order
    // per object), so lighting and shadows stay correct.
    this.model.scale.x = -1;
    scene.add(this.model);
    return true;
  }

  _materials() {
    const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color }, o));
    return {
      art: std(C.art, { roughness: 0.62, metalness: 0.0 }),
      artLit: std(C.artLit, { roughness: 0.62, metalness: 0.0 }),
      chrome: std(C.chrome, { roughness: 0.15, metalness: 0.38 }),
      steel: std(C.steel, { roughness: 0.3, metalness: 0.34 }),
      // The emissive intensities ARE the model's. This is the half the flat renderer dropped, and
      // it is why its amber lamps rendered brown and its cyan inserts navy.
      magenta: std(C.magenta, { roughness: 0.3, emissive: C.magenta, emissiveIntensity: 0.5 }),
      cyan: std(C.cyan, { roughness: 0.3, emissive: C.cyan, emissiveIntensity: 0.5 }),
      amber: std(C.amber, { roughness: 0.35, emissive: C.amber, emissiveIntensity: 0.45 }),
      violet: std(C.violet, { roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.82 }),
      rubber: std(C.rubber, { roughness: 0.72 }),
      cap: std(C.cap, { roughness: 0.22 }),
      ball: std(C.ball, { roughness: 0.08, metalness: 0.4 }),
    };
  }

  /** Add a mesh, with shadows on. */
  _add(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** The deck outline: straight sides, the arch across the top, a soft bottom edge. */
  _deckShape(inset = 0) {
    const left = 4 + inset, right = W - 4 - inset, bot = DRAIN_Y + 40;
    const s = new THREE.Shape();
    s.moveTo(left, ARCH.cy);
    s.absarc(ARCH.cx, ARCH.cy, ARCH.rOut - inset, Math.PI, 0, true);
    s.lineTo(right, bot - 14);
    s.quadraticCurveTo(right, bot, right - 22, bot);
    s.lineTo(left + 22, bot);
    s.quadraticCurveTo(left, bot, left, bot - 14);
    s.closePath();
    return s;
  }

  /** Lay a flat XY shape on the deck, extruded upward by `h`, its base at `base`. */
  _flat(parent, shape, h, mat, base = 0) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    // The shape is authored in table coordinates (x across, y down-field). Rotating -90 degrees
    // about X puts table-y onto world-z and the extrusion onto world-y, which is the whole mapping.
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    // ExtrudeGeometry runs 0..depth along +z, and the rotateX above turns that into 0..h along
    // +y - so the mesh's own origin is already its BOTTOM face. Setting position.y to base + h
    // (the obvious-looking thing) lifts every part by its own height: the first build put the
    // deck's top surface at y = 14.7 and buried the rosette, the lamps, the drop targets and the
    // stand-ups inside the slab, which is why the middle of the table rendered empty.
    m.position.y = base;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** A ball guide: a band of width `w` along a polyline, standing `h` tall. The model's `wall()`. */
  _rail(parent, pts, w, h, mat, base = 0) {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      const nx = (-ty / len) * w / 2, ny = (tx / len) * w / 2;
      left.push([p[0] + nx, p[1] + ny]);
      right.push([p[0] - nx, p[1] - ny]);
    }
    const s = new THREE.Shape();
    s.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) s.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) s.lineTo(right[i][0], right[i][1]);
    s.closePath();
    return this._flat(parent, s, h, mat, base);
  }

  /** Points along an arc, for the arch rails. */
  _arcPts(cx, cy, r, a0, a1, n = 60) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }

  /** A chrome post with a black rubber ring near its top: the model's `post()`. */
  _post(parent, x, y, r = 6, h = mm(0.046)) {
    const g = new THREE.Group();
    g.position.set(x, 0, tz(y));
    parent.add(g);
    const c = this._add(g, new THREE.CylinderGeometry(r, r * 1.15, h, 14), this.M.chrome, 0, h / 2, 0);
    c.castShadow = true;
    const ring = this._add(g, new THREE.TorusGeometry(r + 2.6, 2.8, 8, 18), this.M.rubber, 0, h - 8, 0);
    ring.rotation.x = Math.PI / 2;
    return g;
  }

  _build(root) {
    const M = this.M;

    // --- cabinet ---------------------------------------------------------------------------------
    // The model's `cabinet-rail`: a chrome wall the deck sits recessed inside. The flat renderer
    // drew it as a single outline stroke, which is why the table read as a sticker rather than a
    // machine.
    //
    // It is a BAND ALONG THE OUTLINE, not a shape with a hole in it. Extruding an outline with an
    // inner Path is the obvious way to write it and it is a trap: the hole has to wind opposite to
    // the outer contour or the triangulator fills the whole thing, and the first build duly put a
    // white disc the size of the playfield in front of the camera. A band cannot fail that way.
    // The band sits immediately OUTSIDE the deck edge, 11 wide, exactly as the model's
    // `outline(-0.016)` does. It must not overlap the arch rail: since the two concentric
    // horseshoes were collapsed into one (see table.js), the deck edge IS the orbit lane's outer
    // wall, so the cabinet band and `archOut` are the same piece of metal and drawing both put
    // two chrome rings on top of each other across the middle of the playfield.
    const outline = this._deckShape(-5.5).getPoints(220).map((p) => [p.x, p.y]);
    outline.push(outline[0]);
    this._rail(root, outline, 11, mm(0.088), M.chrome, -mm(0.022));
    // deck slab
    this._flat(root, this._deckShape(0), mm(0.022), M.art, -mm(0.022));

    // --- printed art ------------------------------------------------------------------------------
    // The model's `art-halo-upper`, as a half RING rather than a Shape with a hole - same trap as
    // the cabinet above, and the same reason not to risk it.
    {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(ARCH.rIn - 34, ARCH.rOut - 8, 64, 1, 0, Math.PI),
        M.artLit,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(ARCH.cx, 0.5, tz(ARCH.cy));
      ring.receiveShadow = true;
      root.add(ring);
    }
    const fan = new THREE.Shape();
    fan.moveTo(AXIS, DRAIN_Y - 34);
    fan.lineTo(AXIS + 82, 470);
    fan.lineTo(AXIS - 82, 470);
    fan.closePath();
    this._flat(root, fan, 0.6, M.artLit, 0);

    // --- ball guides ------------------------------------------------------------------------------
    const RAIL_H = mm(0.05);
    for (const r of ART.rails) {
      this._rail(root, r.pts, r.w, RAIL_H, r.mat === 'steel' ? M.steel : M.chrome);
    }
    for (const d of ART.divs) this._rail(root, d, 10, RAIL_H, M.chrome);
    this._rail(root, ART.gate, 7, mm(0.03), M.steel);
    this._rail(root, ART.orbitReturn, 7, mm(0.03), M.steel);
    // The arch's INNER wall only. Its outer wall is the cabinet band above.
    this._rail(root, this._arcPts(ARCH.cx, ARCH.cy, ARCH.rIn, Math.PI, TAU - 12 * Math.PI / 180), 8, RAIL_H, M.steel);
    // rollover lane dividers
    for (const x of ART.laneX) {
      const top = ARCH.cy - Math.sqrt(ARCH.rIn * ARCH.rIn - (x - ARCH.cx) * (x - ARCH.cx)) + 3;
      this._rail(root, [[x, 108], [x, top]], 8, mm(0.044), M.steel);
    }

    // --- posts -------------------------------------------------------------------------------------
    for (const [x, z] of ART.posts) this._post(root, x, z);
    for (const [x, z] of ART.slingPosts) this._post(root, x, z, 7);

    // --- pop bumpers -------------------------------------------------------------------------------
    // The model's mushroom: chrome skirt, a glowing ring, a rod, a domed white cap, a chrome collar.
    this.parts3.pops = ART.pops.map(([x, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, tz(z));
      root.add(g);
      const R = ART.popR;
      this._add(g, new THREE.CylinderGeometry(R + 8, R + 10, 4, 30), M.chrome, 0, 2, 0);
      const ring = this._add(g, new THREE.CylinderGeometry(R, R, 8, 30), i === 1 ? M.cyan : M.magenta, 0, 8, 0);
      this._add(g, new THREE.CylinderGeometry(6, 6, 27, 12), M.chrome, 0, 19, 0);
      const cap = this._add(g, new THREE.SphereGeometry(R * 0.95, 26, 12, 0, TAU, 0, Math.PI / 2), M.cap, 0, 31, 0);
      cap.scale.y = 0.62;
      const collar = this._add(g, new THREE.TorusGeometry(R * 0.95, 2.4, 8, 26), M.chrome, 0, 32, 0);
      collar.rotation.x = Math.PI / 2;
      return { g, ring, cap };
    });

    // --- slingshots ---------------------------------------------------------------------------------
    this.parts3.slings = ART.slings.map((s, i) => {
      const [ax, az] = s[0], [bx, bz] = s[1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;   // still in TABLE space; the plate is a Shape
      const side = i === 0 ? -1 : 1;
      const plate = new THREE.Shape();
      plate.moveTo(ax, az);
      plate.lineTo(bx, bz);
      plate.lineTo(bx + nx * 34 * side, bz + nz * 34 * side);
      plate.closePath();
      this._flat(root, plate, mm(0.008), M.violet, 0);
      const band = this._rail(root, [[ax, az], [bx, bz]], 11, mm(0.03), M.rubber, mm(0.008));
      const lamp = this._add(root,
        new THREE.CylinderGeometry(7, 7, 2.5, 16), M.amber,
        (ax + bx) / 2 + nx * 20 * side, 1.4, tz((az + bz) / 2 + nz * 20 * side));
      return { band, lamp };
    });

    // --- drop targets ---------------------------------------------------------------------------------
    // Upright boxes in steel frames, standing off the deck and facing the player. They drop by
    // sinking into the deck, which is what a drop target physically does.
    const bank = ART.bank;
    this.parts3.drops = [];
    for (let i = 0; i < bank.count; i++) {
      const s = i * bank.step + bank.len / 2;
      const x = bank.a[0] + bank.u[0] * s, z = bank.a[1] + bank.u[1] * s;
      const ang = Math.atan2(bank.u[1], bank.u[0]);
      const g = new THREE.Group();
      g.position.set(x, 0, tz(z));
      g.rotation.y = ty(ang);
      root.add(g);
      this._add(g, new THREE.BoxGeometry(bank.len + 6, 5, 11), M.steel, 0, 2.5, 0);
      const face = this._add(g, new THREE.BoxGeometry(bank.len, 20, 4), i === 1 ? M.amber : M.cap, 0, 14, 0);
      this.parts3.drops.push(face);
    }

    // --- stand-up targets -----------------------------------------------------------------------------
    this.parts3.stands = ART.stands.map((s) => {
      const [ax, az] = s[0], [bx, bz] = s[1];
      const g = new THREE.Group();
      g.position.set((ax + bx) / 2, 0, tz((az + bz) / 2));
      g.rotation.y = ty(Math.atan2(bz - az, bx - ax));
      root.add(g);
      return this._add(g, new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 18, 5), M.magenta, 0, 9, 0);
    });

    // --- spinner ---------------------------------------------------------------------------------------
    {
      const sp = ART.spinner;
      const g = new THREE.Group();
      g.position.set(sp.x, 0, tz(sp.y));
      root.add(g);
      this._add(g, new THREE.CylinderGeometry(3, 3, 29, 10), M.chrome, -sp.w / 2, 14.5, 0);
      this._add(g, new THREE.CylinderGeometry(3, 3, 29, 10), M.chrome, sp.w / 2, 14.5, 0);
      const blade = this._add(g, new THREE.BoxGeometry(sp.w, 19, 1.6), M.amber, 0, 17, 0);
      this.parts3.spinner = blade;
    }

    // --- scoop ------------------------------------------------------------------------------------------
    {
      const sc = ART.scoop;
      const hole = this._add(root, new THREE.CylinderGeometry(sc.rad - 4, sc.rad - 4, 22, 26), M.rubber, sc.x, -11, tz(sc.y));
      hole.receiveShadow = true;
      const ring = this._add(root, new THREE.TorusGeometry(sc.rad, 3.4, 9, 30, sc.half * 2 > 0 ? TAU : TAU), M.chrome, sc.x, 3, tz(sc.y));
      ring.rotation.x = Math.PI / 2;
      this.parts3.scoopRing = ring;
    }

    // --- rosette ----------------------------------------------------------------------------------------
    {
      const r = ART.rosette;
      this._add(root, new THREE.CylinderGeometry(r.r - 16, r.r - 16, 2, 30), M.art, r.x, 0.4, tz(r.y));
      const ring = this._add(root, new THREE.TorusGeometry(r.r, 2.6, 8, 44), M.chrome, r.x, 1.6, tz(r.y));
      ring.rotation.x = Math.PI / 2;
      this.parts3.rosette = [];
      for (let i = 0; i < r.lamps; i++) {
        const a = i * TAU / r.lamps;
        this.parts3.rosette.push(this._add(root, new THREE.CylinderGeometry(5.5, 5.5, 2.4, 12),
          i % 2 ? M.cyan : M.magenta, r.x + Math.cos(a) * r.r, 0.9, tz(r.y + Math.sin(a) * r.r)));
      }
      this.parts3.rosetteHub = this._add(root, new THREE.CylinderGeometry(11, 11, 2.6, 18), M.amber, r.x, 1, tz(r.y));
    }

    // --- the ramp ------------------------------------------------------------------------------------------
    // The model's violet U-channel, and the one part that most needed to stop being flat: it climbs
    // off the deck, banks over the whole upper playfield and comes down the right, on support legs.
    {
      const pts = RAMP_PATH.map((p, i) => {
        const t = i / (RAMP_PATH.length - 1);
        // up to the crown, then down: the model's own profile, peaking at 0.116 m.
        const h = mm(0.116) * Math.sin(Math.min(1, t * 1.08) * Math.PI * 0.92) + mm(0.012);
        return new THREE.Vector3(p[0], h, tz(p[1]));
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const half = 15, wallH = mm(0.02), floor = 3;
      const ch = new THREE.Shape();
      ch.moveTo(-half, 0); ch.lineTo(half, 0); ch.lineTo(half, wallH);
      ch.lineTo(half - 3, wallH); ch.lineTo(half - 3, floor);
      ch.lineTo(-half + 3, floor); ch.lineTo(-half + 3, wallH);
      ch.lineTo(-half, wallH); ch.closePath();
      const geo = new THREE.ExtrudeGeometry(ch, { extrudePath: curve, steps: 190, bevelEnabled: false });
      this.parts3.ramp = this._add(root, geo, this.M.violet, 0, 0, 0);
      this.parts3.rampCurve = curve;
      for (let i = 1; i < pts.length - 1; i += 2) {
        const p = pts[i];
        this._add(root, new THREE.CylinderGeometry(3, 3, p.y, 8), M.steel, p.x, p.y / 2, p.z);
      }
    }

    // --- wireform return rail ---------------------------------------------------------------------------
    // The model's `return-rail`: two chrome tubes on legs, down the left. It was DROPPED from the
    // flat renderer on purpose - seen from directly above it was two hairlines crossing the ramp
    // and the rosette, and a screenshot showed exactly that, a stray diagonal that read as a
    // rendering fault. In three dimensions it is at a height, it casts a shadow, and it reads as
    // the piece of bent wire it is. Decorative: RAMP_PATH is the wire the ball actually rides.
    {
      const pts = ART.wireform.map((p, i) => new THREE.Vector3(
        p[0], mm(0.086) - i * mm(0.012), tz(p[1]),
      ));
      const centre = new THREE.CatmullRomCurve3(pts);
      for (const off of [-9, 9]) {
        const rail = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const p = centre.getPointAt(t);
          const tan = centre.getTangentAt(t);
          const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(off);
          rail.push(p.clone().add(n));
        }
        this._add(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 44, 2.4, 6, false),
          M.chrome, 0, 0, 0);
      }
      for (let i = 1; i < pts.length; i += 2) {
        const p = pts[i];
        this._add(root, new THREE.CylinderGeometry(2.4, 2.4, p.y, 8), M.steel, p.x, p.y / 2, p.z);
      }
    }

    // --- flippers ---------------------------------------------------------------------------------------
    // A tapered bat with a cyan inlay on its top face, on a steel pivot pin.
    this.parts3.flippers = [0, 1].map((i) => {
      const g = new THREE.Group();
      g.position.set(AXIS + (i ? FLIP.dx : -FLIP.dx), mm(0.004), tz(FLIP.pivotY));
      root.add(g);
      const sh = new THREE.Shape();
      sh.moveTo(0, FLIP.r);
      sh.lineTo(FLIP.len - 8, FLIP.r * 0.62);
      sh.quadraticCurveTo(FLIP.len, 0, FLIP.len - 8, -FLIP.r * 0.62);
      sh.lineTo(0, -FLIP.r);
      sh.absarc(0, 0, FLIP.r, -Math.PI / 2, Math.PI / 2, true);
      const body = this._flat(g, sh, mm(0.019), M.chrome, 0);
      const bat = this._flat(g, sh, mm(0.006), M.cyan, mm(0.019));
      bat.scale.set(0.94, 1, 0.74);
      this._add(g, new THREE.CylinderGeometry(4, 4, 22, 12), M.steel, 0, 11, 0);
      return g;
    });

    // --- plunger ------------------------------------------------------------------------------------------
    {
      const g = new THREE.Group();
      g.position.set(PLUNGER.x, 0, tz(PLUNGER.y + 26));
      root.add(g);
      const rod = this._add(g, new THREE.CylinderGeometry(3.5, 3.5, 80, 10), M.chrome, 0, 11, 26);
      rod.rotation.x = Math.PI / 2;
      const tip = this._add(g, new THREE.CylinderGeometry(8, 8, 8, 16), M.magenta, 0, 11, -12);
      tip.rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const coil = this._add(g, new THREE.TorusGeometry(8, 1.7, 6, 16), M.steel, 0, 11, 8 + i * 6);
      }
      this.parts3.plunger = g;
    }

    // --- apron ----------------------------------------------------------------------------------------------
    for (const side of [-1, 1]) {
      const x0 = AXIS + side * 40, x1 = AXIS + side * 150;
      const sh = new THREE.Shape();
      sh.moveTo(x0, DRAIN_Y + 34);
      sh.lineTo(x1, DRAIN_Y + 34);
      sh.lineTo(x1, DRAIN_Y - 8);
      sh.lineTo(x0, DRAIN_Y + 12);
      sh.closePath();
      this._flat(root, sh, 5, this.M.steel, 0);
    }

    // --- lamps ------------------------------------------------------------------------------------------------
    // The model's inserts, back in full: the upper arc, both banks beside the rosette, the drain row,
    // both outlane runs and the rollover lenses. The flat renderer dropped twenty of them.
    const lens = (x, y, mat, r = 5) => this._add(root, new THREE.CylinderGeometry(r, r, 2.2, 12), mat, x, 0.8, tz(y));
    this.parts3.lamps = [];
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (0.14 + 0.72 * i / 10);
      lens(ARCH.cx - Math.cos(a) * 205, ARCH.cy - Math.sin(a) * 152, i % 3 ? this.M.cyan : this.M.magenta, 4.5);
    }
    for (const [x, z] of ART.lanes) this.parts3.lamps.push(lens(x, z, this.M.cyan, 7));
    for (let i = 0; i < 4; i++) {
      lens(18, 468 + i * 30, this.M.amber, 4.5);
      lens(W - 52, 468 + i * 30, this.M.amber, 4.5);
    }
    for (let i = 0; i < 3; i++) {
      lens(ART.rosette.x - 84 + i * 22, 470, this.M.amber, 4.5);
      lens(ART.rosette.x + 40 + i * 22, 470, this.M.amber, 4.5);
      lens(AXIS - 30 + i * 30, DRAIN_Y - 26, this.M.magenta, 4.5);
    }

    // the arrow inserts game.js lights: a low triangular prism per shot
    this.parts3.inserts = ART.inserts.map(([x, z, keyName, rot]) => {
      const t = new THREE.Shape();
      t.moveTo(0, -13); t.lineTo(9, 5); t.lineTo(-9, 5); t.closePath();
      const g = new THREE.ExtrudeGeometry(t, { depth: 2.4, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const mat = (keyName === 'ramp' ? this.M.violet
        : keyName.startsWith('save') ? this.M.amber : this.M.cyan).clone();
      mat.transparent = true;
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 2.4, tz(z));
      m.rotation.y = ty(rot);
      m.receiveShadow = true;
      root.add(m);
      return { m, mat, key: keyName };
    });

    // --- the backbox ------------------------------------------------------------------------------------------
    // A real machine puts its score and its shouting on a BACKGLASS standing at the far end, not
    // painted on the playfield. Matt, on the shipped build: *"the points and word popups should be
    // shown on a back wall/scorepoint/point counter thing. There's too much that happens on top of
    // the machine."* So every award value and every word now lands here instead of floating over
    // the table, which is both what a pinball machine does and the only way to stop them covering
    // the ball.
    //
    // It is a CanvasTexture, redrawn only when the text changes - not every frame.
    {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 288;
      this._bbCv = cv;
      this._bbCtx = cv.getContext('2d');
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      // The glass has to be TURNED ROUND to face the camera (see below), and the model group is
      // already mirrored in x - the two compound rather than cancel, and the first build put
      // "BUHRATS" on the backglass. Mirroring the texture as well is the third flip that makes it
      // read forwards.
      tex.center.set(0.5, 0.5);
      tex.repeat.x = -1;
      this._bbTex = tex;
      const g = new THREE.Group();
      g.position.set(AXIS, 0, tz(-30));
      // Leaned toward the player, like a real backbox. Positive x-rotation tips the top away
      // from the camera under this scene's -z viewing direction, so this is the negative one.
      g.rotation.x = 0.24;
      root.add(g);
      const w = 250, h = 132;
      // The cabinet the glass sits in, BEHIND the glass - and under this scene's conventions
      // "behind" is the LARGER z, because the camera looks along +z from very negative z.
      this._add(g, new THREE.BoxGeometry(w + 18, h + 16, 11), M.chrome, 0, h / 2 + 4, 5);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
      );
      // A PlaneGeometry faces +z, which here is AWAY from the camera - so it has to be turned
      // round, and turning it round also undoes the model group's x-mirror, which is what keeps
      // the text on it readable rather than back to front.
      face.rotation.y = Math.PI;
      face.position.set(0, h / 2 + 4, -2);
      g.add(face);
      this._bbGroup = g;
      this._bbLines = [];
      this._bbDirty = true;
    }

    // --- balls ----------------------------------------------------------------------------------------------------
    this.parts3.balls = [];
    for (let i = 0; i < 4; i++) {
      const b = this._add(root, new THREE.SphereGeometry(9, 22, 14), this.M.ball, 0, 9, 0);
      b.visible = false;
      this.parts3.balls.push(b);
    }
  }

  // --- fitting -------------------------------------------------------------------------------------

  /**
   * Frame the whole table for whatever box the stage ended up with.
   *
   * The camera is DERIVED, not hand-placed: it sits at a fixed tilt behind the flipper end and is
   * pushed back until the table's depth and width both fit the frustum. That way one number (TILT)
   * controls how much depth you can see, and no phone shape can crop the playfield.
   */
  resize(cssW, cssH) {
    if (!this.ok) return;
    const dpr = this.softGL ? 0.6 : Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.renderer.setPixelRatio(dpr);
    // updateStyle TRUE. With it false three.js sizes only the drawing buffer and leaves the
    // element to lay itself out at its own attribute size - so the canvas came out at pixelRatio x
    // the stage (twice too big, saved only by the stage centring it) and then, once the software-GL
    // path dropped the ratio to 0.6, at a little box in the middle of a black field.
    this.renderer.setSize(cssW, cssH, true);
    if (this.fx) {
      this.fx.width = Math.max(1, Math.round(cssW * dpr));
      this.fx.height = Math.max(1, Math.round(cssH * dpr));
      this.fx.style.width = `${cssW}px`;
      this.fx.style.height = `${cssH}px`;
    }

    const cam = this.camera;
    cam.aspect = cssW / cssH;
    // 20 degrees, and the number is set by the SHAPE OF A PHONE, not by taste. The table is 348 x
    // 694, so at a tilt of t it projects 348 wide by 694*cos(t) tall; a 393x852 screen with the HUD
    // taken off is about 1:1.85. At 30 degrees the projection came out 1:1.73 - wider than the
    // screen - so it fitted by width and left a third of the frame empty above it. 20 degrees gives
    // 1:1.87, which fills. Any steeper and the table shrinks; any flatter and the far end crowds.
    const TILT = 20 * Math.PI / 180;
    const cx = -AXIS, cz = tz(H * 0.5);

    // THE FRAMING IS SOLVED, NOT CALCULATED. Working the distance out from the table's centre
    // with trigonometry is what the first build did, and it does not work for a TILTED camera:
    // the near end of the table is far closer than the centre, so it projects much larger than
    // the formula allows for and spills off the screen while the far end is still cropped. So
    // this pushes the camera back until every corner of the table's bounding box actually lands
    // inside the frustum. Eight iterations of bisection converge to well under a pixel, it runs
    // only on resize, and it cannot be fooled by any phone shape.
    // The corners of what actually has to be on screen: the cabinet's footprint at deck level,
    // plus the crown of the ramp, which is the only thing tall enough to leave the outline.
    const corners = [];
    for (const x of [2, -(W + 2)]) {
      for (const y of [-4, H + 40]) corners.push(new THREE.Vector3(x, 0, tz(y)));
    }
    corners.push(new THREE.Vector3(-AXIS, mm(0.13), tz(180)));
    // the backglass, which stands beyond the crown and must not be cropped
    // The backglass's top corners, computed through the group's own lean rather than guessed:
    // it stands beyond the crown and must not be cropped, and the HUD band above the canvas gives
    // it nowhere to hide.
    {
      const gy = 4 + 132, gz = -2, lean = 0.24, gzWorld = tz(-30);
      const wy = gy * Math.cos(lean) - gz * Math.sin(lean);
      const wz = gy * Math.sin(lean) + gz * Math.cos(lean) + gzWorld;
      for (const x of [-AXIS - 140, -AXIS + 140]) corners.push(new THREE.Vector3(x, wy, wz));
    }
    this._viewOff = this._viewOff || 0;
    const fits = (dist) => {
      cam.position.set(cx, Math.cos(TILT) * dist, cz - Math.sin(TILT) * dist);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld(true);
      if (this._viewOff) cam.setViewOffset(cssW, cssH, 0, this._viewOff, cssW, cssH);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
      for (const c of corners) {
        const v = c.clone().project(cam);
        if (Math.abs(v.x) > 0.995 || Math.abs(v.y) > 0.995) return false;
      }
      return true;
    };
    let lo = 200, hi = 4000;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    fits(hi);

    // Then RE-CENTRE, through the FILM BACK rather than by moving the camera. A tilted camera
    // projects the table as a trapezium - wide at the near end, narrow at the far one - so the
    // fit above is usually limited by the near corners and leaves a band of empty background at
    // one end. Moving the camera to fix that changes the perspective and therefore what fits,
    // which turns a one-shot correction into a chase; `setViewOffset` slides the frustum window
    // instead, so the framing is untouched and the picture simply sits in the middle.
    // Measure the offset, apply it, THEN FIT AGAIN. Shifting the frustum window moves the whole
    // picture, so a fit that was exactly tight before the shift is over the edge after it - which
    // is how the backglass ended up sliced off by the HUD band. Two passes is enough: the offset
    // barely moves once the distance settles.
    for (let pass = 0; pass < 2; pass++) {
      let lowY = 1, highY = -1;
      for (const c of corners) {
        const v = c.clone().project(cam);
        lowY = Math.min(lowY, v.y); highY = Math.max(highY, v.y);
      }
      const off = (lowY + highY) / 2;               // NDC: +1 is the top of the screen
      this._viewOff = -off * cssH / 2;
      lo = 200; hi = 4000;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      fits(hi);
    }

    // The machine's screen-space box. spawnHit() throws its confetti from the EDGE of this,
    // outward - see there for why.
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const c of corners) {
      const v = c.clone().project(cam);
      const sx = (v.x * 0.5 + 0.5) * cssW, sy = (-v.y * 0.5 + 0.5) * cssH;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    this.box = { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /** Table coordinate -> CSS pixel, through the real camera, for the 2D effects overlay. */
  _project(x, z, h = 10) {
    const v = new THREE.Vector3(-x, h, tz(z)).project(this.camera);
    return [(v.x * 0.5 + 0.5) * this.cssW, (-v.y * 0.5 + 0.5) * this.cssH];
  }

  // --- effects API (called by ui.js from the game's event stream) ---------------------------------

  /**
   * A burst of confetti for a hit - THROWN CLEAR OF THE MACHINE, into the black surround.
   *
   * Matt, on the shipped build: *"Too much confetti on the screen causes the ball to get lost.
   * All confetti must be off the machine and shown in the black outside."* He is right, and the
   * reason is that the ball is a small grey sphere and every particle over the playfield is
   * another small bright thing competing with it. So the burst no longer starts where the hit
   * was: it starts where a line from the middle of the machine through the hit LEAVES the
   * machine's silhouette, and travels outward from there. You still see which side of the table
   * scored, and nothing is ever drawn over the ball.
   *
   * `this.box` is the machine's screen-space bounding box, measured in resize() from the same
   * corners the camera framing uses - so it cannot drift out of step with what is on screen.
   */
  spawnHit(x, y, n, color, speed = 200) {
    if (this.reduced) n = Math.min(n, 3);
    const box = this.box;
    if (!box) return;
    const [px, py] = this._project(x, y, 12);
    let dx = px - box.cx, dy = py - box.cy;
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) { dx = 0; dy = 1; }
    // How far along that direction the box edge is: the smaller of the two axis crossings.
    const hw = (box.x1 - box.x0) / 2, hh = (box.y1 - box.y0) / 2;
    const t = Math.min(
      dx === 0 ? Infinity : hw / Math.abs(dx),
      dy === 0 ? Infinity : hh / Math.abs(dy),
    );
    const ex = box.cx + dx * t, ey = box.cy + dy * t;
    const len = Math.hypot(dx, dy) || 1;
    const ox = dx / len, oy = dy / len;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 1.5;
      const c = Math.cos(spread), s = Math.sin(spread);
      const v = speed * (0.5 + Math.random() * 0.9) * 0.5;
      this.parts.push({
        sx: ex + (Math.random() - 0.5) * 26, sy: ey + (Math.random() - 0.5) * 26,
        vx: (ox * c - oy * s) * v, vy: (ox * s + oy * c) * v,
        age: 0, life: 0.5 + Math.random() * 0.5, color, r: 1.8 + Math.random() * 2.4,
      });
    }
    if (this.parts.length > 240) this.parts.splice(0, this.parts.length - 240);
  }

  /** An award or a word. It goes on the BACKGLASS, never over the playfield - see the backbox
   *  block in _build() for why. Newest at the top; three lines, each fading on its own clock. */
  popup(x, y, text, color = '#fff', big = false) {
    if (!this._bbLines) return;
    this._bbLines.unshift({ text: String(text), color, big, age: 0, life: big ? 2.6 : 1.9 });
    if (this._bbLines.length > 3) this._bbLines.length = 3;
    this._bbDirty = true;
  }

  flash(amount = 0.5, color = PALETTE.cyan) {
    if (this.reduced) return;
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashColor = color;
  }

  kick(mag = 4) { if (!this.reduced) this.shake = Math.max(this.shake, mag); }

  hitBumper(i) { this.popPulse[i] = 1; }
  hitSling(i) { this.slingPulse[i] = 1; }
  hitStand(i) { this.standPulse[i] = 1; }
  hitScoop() { this.scoopPulse = 1; }
  hitLane(id) { this.lanePulse[id] = 1; }
  hitSpinner(rips) { this.spinSpeed = Math.max(this.spinSpeed, 6 + rips * 2.4); }
  hitRamp() { this.rampGlow = 1; }

  // --- the frame ------------------------------------------------------------------------------------

  render(game, dt) {
    if (!this.ok) return;
    this.time += dt;
    this._age(dt);
    const hud = game.hud();
    const P = this.parts3;

    // flippers
    for (let i = 0; i < 2; i++) {
      const f = game.flippers[i];
      // table angle (y down) -> world rotation about Y
      P.flippers[i].rotation.y = ty(f.angle);
    }

    // pop bumper caps bob on a hit
    P.pops.forEach((p, i) => {
      const k = this.popPulse[i];
      p.cap.position.y = 31 - k * 5;
      p.ring.material.emissiveIntensity = 0.5 + k * 1.4;
    });

    // slingshot rubber snaps
    P.slings.forEach((s, i) => {
      const k = this.slingPulse[i];
      s.lamp.material.emissiveIntensity = 0.45 + k * 1.6;
      s.band.scale.set(1 + k * 0.06, 1, 1);
    });

    // drop targets sink when they are down
    for (let i = 0; i < P.drops.length; i++) {
      const down = game.drops && game.drops[i];
      this.dropAnim[i] += ((down ? 1 : 0) - this.dropAnim[i]) * Math.min(1, dt * 14);
      P.drops[i].position.y = 14 - this.dropAnim[i] * 22;
    }

    // stand-ups flash
    P.stands.forEach((m, i) => { m.material.emissiveIntensity = 0.5 + this.standPulse[i] * 1.5; });

    // the spinner really spins
    P.spinner.rotation.x = this.spinAngle;

    // scoop and the lit inserts
    const lit = {
      ramp: hud.lockLit || !!(game.mission && game.mission.id === 'ramp'),
      scoop: hud.bankLit || hud.lockLit || hud.superLit,
      bank: !hud.bankLit,
      orbit: !!(game.mission && game.mission.id === 'spin'),
      inlaneL: this.lanePulse.laneH > 0,
      inlaneR: this.lanePulse.laneB > 0,
      saveL: hud.save > 0,
      saveR: hud.save > 0,
    };
    const pulse = 0.55 + Math.sin(this.time * 6) * 0.45;
    for (const ins of P.inserts) {
      ins.mat.opacity = lit[ins.key] ? 0.45 + pulse * 0.55 : 0.16;
      ins.mat.emissiveIntensity = lit[ins.key] ? 0.6 + pulse * 0.8 : 0.1;
    }
    P.rosetteHub.material.emissiveIntensity = 0.45 + (hud.multiball ? pulse * 1.2 : 0);
    this.parts3.ramp.material.opacity = 0.82 + this.rampGlow * 0.18;

    // balls
    let n = 0;
    for (const b of game.balls) {
      if (!b.live || n >= P.balls.length) continue;
      const m = P.balls[n++];
      m.visible = true;
      if (b.held && b.ramp != null) {
        // riding the habitrail: follow the ramp curve so the ball is visibly up on the wire
        const p = this.parts3.rampCurve.getPointAt(clamp(b.ramp, 0, 1));
        m.position.set(p.x, p.y + 11, p.z);   // the curve is already in world space
      } else {
        m.position.set(b.x, 9, tz(b.y));
      }
    }
    for (let i = n; i < P.balls.length; i++) P.balls[i].visible = false;

    // The shadow map only has to be redrawn when something that casts one has actually moved:
    // the paddles, the ball, or a drop target on its way down.
    const moved = game.balls.length !== this._lastBalls
      || game.flippers[0].omega !== 0 || game.flippers[1].omega !== 0
      || this.dropAnim.some((v) => v > 0.01 && v < 0.99);
    this._lastBalls = game.balls.length;
    if (moved || this._shadowTick === undefined || (this._shadowTick += dt) > 0.25) {
      this._shadowTick = 0;
      this.renderer.shadowMap.needsUpdate = true;
    }

    // shake, applied to the camera rather than the scene
    if (this.shake > 0.05) {
      const s = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    if (this._bbDirty) { this._bbDirty = false; this._drawBackglass(hud); }
    this.renderer.render(this.scene, this.camera);
    this._drawFx(hud);
  }

  _age(dt) {
    this.shake *= Math.pow(0.0016, dt);
    this.flashAmt *= Math.pow(0.0009, dt);
    for (let i = 0; i < this.popPulse.length; i++) this.popPulse[i] = Math.max(0, this.popPulse[i] - dt * 4.5);
    for (let i = 0; i < 2; i++) {
      this.slingPulse[i] = Math.max(0, this.slingPulse[i] - dt * 6);
      this.standPulse[i] = Math.max(0, this.standPulse[i] - dt * 4);
    }
    this.scoopPulse = Math.max(0, this.scoopPulse - dt * 2.2);
    this.rampGlow = Math.max(0, this.rampGlow - dt * 1.1);
    for (const k of Object.keys(this.lanePulse)) this.lanePulse[k] = Math.max(0, this.lanePulse[k] - dt * 3);
    this.spinSpeed *= Math.pow(0.12, dt);
    this.spinAngle += this.spinSpeed * dt;

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      // Screen-space pixels per second, not table units: these live in the black surround now.
      p.vy += 260 * dt;
      p.vx *= Math.pow(0.35, dt);
      p.sx += p.vx * dt; p.sy += p.vy * dt;
    }
    if (this._bbLines) {
      for (let i = this._bbLines.length - 1; i >= 0; i--) {
        const p = this._bbLines[i];
        p.age += dt;
        if (p.age >= p.life) { this._bbLines.splice(i, 1); this._bbDirty = true; }
      }
      // A fading line changes what is on the glass, so redraw while any line is alive - but at
      // about 12 Hz, not every frame: this is a 512x288 canvas plus a texture upload.
      if (this._bbLines.length) {
        this._bbFade = (this._bbFade || 0) + dt;
        if (this._bbFade > 0.08) { this._bbFade = 0; this._bbDirty = true; }
      }
    }
  }

  /** Repaint the backglass: the score, then the last three awards. */
  _drawBackglass(hud) {
    const g = this._bbCtx;
    if (!g) return;
    const W2 = this._bbCv.width, H2 = this._bbCv.height;
    g.clearRect(0, 0, W2, H2);
    g.fillStyle = '#0b0718';
    g.fillRect(0, 0, W2, H2);
    // dot-matrix wash, the same idea as the HUD band in ui.js
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 6; y < H2; y += 8) for (let x = 6; x < W2; x += 8) g.fillRect(x, y, 2, 2);
    g.strokeStyle = 'rgba(51,220,255,0.35)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, W2 - 12, H2 - 12);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 30px system-ui, -apple-system, sans-serif';
    g.fillStyle = 'rgba(218,224,234,0.55)';
    g.fillText(hud && hud.multiball ? 'MULTIBALL' : 'STARHUB', W2 / 2, 40);

    const lines = this._bbLines || [];
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i];
      const k = Math.max(0, 1 - p.age / p.life);
      g.globalAlpha = 0.25 + k * 0.75;
      g.fillStyle = p.color;
      g.font = `800 ${p.big && i === 0 ? 58 : i === 0 ? 46 : 30}px system-ui, -apple-system, sans-serif`;
      g.fillText(p.text, W2 / 2, 105 + i * 62);
    }
    g.globalAlpha = 1;
    this._bbTex.needsUpdate = true;
  }

  /** Particles and the flashers, in screen space over the 3D. */
  _drawFx(hud) {
    const ctx = this.fxCtx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.r * (0.5 + k * 0.7), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;


    if (this.flashAmt > 0.01) {
      ctx.globalAlpha = this.flashAmt * 0.4;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
    }
    if (hud && hud.tilt) {
      ctx.globalAlpha = 0.24 + Math.sin(this.time * 9) * 0.08;
      ctx.fillStyle = PALETTE.magenta;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
    }
  }

  /** Release the GPU resources. ui.js's destroy() calls this; without it every mount leaks a
   *  WebGL context and a browser only allows a handful before it starts dropping the oldest. */
  dispose() {
    if (!this.ok) return;
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}

export { PALETTE };
export default { Renderer, PALETTE };
