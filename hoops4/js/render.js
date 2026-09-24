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
import { SCREEN_V, SCREEN_W } from './boarddef.js';

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
/** The colour a player's ball actually reads as: 40% of its light stop, 60% of `fill` - the same
 *  blend the board's discs are painted with. One function, so the ball and setPlayerTint's
 *  background and rails can never drift apart. */
function ballTone(fill, dark) {
  const hi = dark ? '#ff7a6e' : '#ffe488';
  const pa = [1, 3, 5].map((i) => parseInt(hi.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(String(fill).slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v * 0.4 + pb[i] * 0.6).toString(16).padStart(2, '0')).join('');
}

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
      // THE FINS ARE THE HOOPS' MOUNTING HARDWARE. They are load-bearing physics (they are what
      // stops a ball balancing across two rims - measured 0 of 18 saddle drops stay), and what
      // they must not do is compete with the baskets. Painted orange they read as traffic
      // bollards; painted pale grey, next to a pale rim and a pale net, they read as FENCE POSTS
      // and the whole row became a fence - which is what Matt saw. Near-black spiked against the
      // lit backboards instead. The riser's own blue is what actually makes them disappear: they
      // stand in front of that wall, so painting them its colour is the only thing that stops
      // them being seven silhouettes between the baskets.
      case 'fin': case 'finCap': return m(L.faceEdge, 0.7, 0.05);
      case 'chamfer': return m(L.cabinet, 0.8);
      default: return m(L.cabinetEdge, 0.9);
    }
  }

  /** Merge many tube segments (start/end/radius triples) into ONE buffer geometry, so a whole
   *  netted basket costs one draw call instead of one mesh per strand. Ported verbatim from
   *  skeeball/js/machines/basketball/render.js's own `_mergedTubes` - its guard is the reason it
   *  exists: "the old ring-per-tube version was already ~180 draw calls for nine baskets before
   *  a single strand existed." Seven hoops here, same rule. */
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  /** One hoop's basket: the wire rim (on the PHYSICS collar radius - `machine.js`'s own `rr`, so
   *  the wire drawn is the wire the ball rattles), a small bottom ring, tapered ribs, and a
   *  netted taper of crossing strands. Same recipe as HOT SHOT's `_wireBasket`, adapted to this
   *  cabinet's own local frame: the group this returns into is already positioned AT the rim
   *  (see the build loop above - `H.collarH` is baked into the group's own position), so here
   *  local y=0 IS the rim and the net simply tapers down to y=-depth.
   *
   *  PAINT ONLY: no geometry here changes `H.r`, `H.collarH` or any collider - MACHINE-SPEC's
   *  "never change the width of a basket" rule is untouched; every number below is read from the
   *  hole's own physics profile, never invented.
   *
   *  Two draw calls (`_mergedTubes` per colour), same as the torus-plus-line-cone build this
   *  replaces - seven hoops stay at fourteen draw calls of hoop dressing either way. */
  _wireBasket(H) {
    const G = this.G, L = this.look;
    // The physics collar's own radius (machine.js: `rr = H.r + G.collarThick / 2`), not the bare
    // hole radius - so the rim you see is the rim the ball rattles.
    const R = H.r + G.collarThick / 2;
    // THE NET NEVER CLOSES TIGHTER THAN THE BALL (HOT SHOT's own fix, 2026-09-05): a taper drawn
    // as a fixed proportion of the rim can narrow below the ball's own radius and end up drawing
    // a scored ball passing THROUGH the wires.
    const Rbot = Math.min(R, Math.max(R * 0.58, G.ballR * 1.02));
    // HOT SHOT builds its basket with the rim at +collarH above the face; this group is already
    // positioned AT the rim, so every one of its heights is shifted down by collarH. yBot is its
    // 0.005 above the face.
    const yBot = -(H.collarH - 0.005);
    const P = (r, y, phi) => new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);

    // THE ORANGE WIRE: rim, small bottom ring, ten tapered ribs - HOT SHOT's `_wireBasket`, at its
    // own proportions and its own tube radii.
    //
    // The pass before this made ONLY the rim orange, reasoning that ten orange verticals under an
    // orange ring read as a cage. That was true of THAT build and the cause was elsewhere: its net
    // had one band where HOT SHOT's has three, so the orange had nothing to sit behind. With the
    // real net the orange reads as the basket's frame, which is what it is. Matt: "They're still
    // not the same" - so this is now HOT SHOT's recipe rather than an adaptation of it.
    const rimMat = new THREE.MeshStandardMaterial({
      color: COL(L.ring), roughness: 0.4, metalness: 0.25,
      emissive: COL(L.ring), emissiveIntensity: 0.4,
    });
    const orange = [];
    const NR = this.soft ? 16 : 32;
    for (let i = 0; i < NR; i++) {
      const p0 = (i / NR) * Math.PI * 2;
      const p1 = ((i + 1) / NR) * Math.PI * 2;
      orange.push([P(R, 0, p0), P(R, 0, p1), 0.0062]);               // the rim, ON the physics profile
      orange.push([P(Rbot, yBot, p0), P(Rbot, yBot, p1), 0.0034]);   // the small bottom ring
    }
    const RIBS = this.soft ? 6 : 10;
    for (let i = 0; i < RIBS; i++) {                                 // tapered ribs between them
      const a = (i / RIBS) * Math.PI * 2;
      orange.push([P(R, 0, a), P(Rbot, yBot, a), 0.0030]);
    }
    const rim = new THREE.Mesh(this._mergedTubes(orange, 0.003), rimMat);
    rim.castShadow = !this.soft;

    // THE WHITE NET: crossing bands of strands from the rim down to the base, plus a ring where
    // they meet. HOT SHOT's own rule for how many bands - a DEEP basket needs three or its
    // strands read as long bare wires. This machine's collarH is 1.6x its rim radius, so it gets
    // three; the build before this used a threshold that gave it ONE, and one band of strands
    // over an orange frame is the "wire fence" Matt kept seeing.
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xf7f2e4, roughness: 0.9, emissive: 0xf7f2e4, emissiveIntensity: 0.5,
    });
    const d = H.collarH;
    const rings = d > R * 0.9
      ? [
        { r: R, y: -0.004 },
        { r: R * 0.87, y: -d * 0.33 },
        { r: R * 0.71, y: -d * 0.66 },
        { r: Rbot * 1.04, y: yBot + 0.004 },
      ]
      : [
        { r: R, y: -0.004 },
        { r: R * 0.78, y: -d * 0.54 },
        { r: Rbot * 1.04, y: yBot + 0.004 },
      ];
    const netSegs = [];
    const S = this.soft ? 6 : 9;
    for (let b = 0; b < rings.length - 1; b++) {
      const hi = rings[b], lo = rings[b + 1];
      for (let i = 0; i < S; i++) {
        const a = (i / S) * Math.PI * 2 + b * 0.35;
        for (const dir of [1, -1]) {
          const a2 = a + dir * ((Math.PI * 2) / S) * 0.6;
          netSegs.push([P(hi.r, hi.y, a), P(lo.r, lo.y, a2)]);
        }
      }
    }
    for (let b = 1; b < rings.length - 1; b++) {                     // a ring at every crossing
      const RS = this.soft ? 16 : 28;
      for (let i = 0; i < RS; i++) {
        const p0 = (i / RS) * Math.PI * 2;
        const p1 = ((i + 1) / RS) * Math.PI * 2;
        netSegs.push([P(rings[b].r, rings[b].y, p0), P(rings[b].r, rings[b].y, p1)]);
      }
    }
    const net = new THREE.Mesh(this._mergedTubes(netSegs, 0.0027), netMat);
    net.castShadow = !this.soft;

    this._trash.push(rim.geometry, rimMat, net.geometry, netMat);
    return { rim, rimMat, net };
  }

  /**
   * A BACKBOARD BEHIND EVERY HOOP. Matt, on a phone screenshot of the shipped build: *"These
   * don't look like real baskets to me."*
   *
   * The machine already had seven white boards - but they were a strip of paint half a metre
   * ABOVE the hoop row, on the cabinet's header, with nothing connecting a board to the rim under
   * it. On its own a ring with a net is a ring with a net; what makes the eye read "basketball
   * hoop" is the BOARD IMMEDIATELY BEHIND IT, and this row never had one.
   *
   * They hang on the back riser, which stands 0.109 m behind the hoop row, and each one is
   * bottomed just under its own rim so the rim reads as bolted to it. Width is the column pitch
   * minus a gap: HOT SHOT learned the same thing the hard way (`skeeball/CLAUDE.md`, "I do not
   * want the backboards to overlap each other"), and a row of touching boards would read as one
   * long panel again, which is the thing being fixed.
   *
   * ONE DRAW CALL for all seven - an InstancedMesh over one plane and one canvas, not seven
   * meshes. Paint only: nothing here is a collider, and no hole's `r` or `collarH` is touched.
   */
  _hoopBackboards(M, G, L) {
    const holes = Object.keys(G.holes).sort((a, b) => G.holes[a].u - G.holes[b].u);
    if (holes.length < 2) return;
    const back = M.frames[M.frames.length - 1];
    const pitch = Math.abs(G.holes[holes[1]].u - G.holes[holes[0]].u);
    const bw = Math.max(0.05, pitch - 0.014);
    const bh = bw / 1.45;                       // a real backboard is wider than it is tall

    // HOT SHOT'S CARD, not a rectangle: a cream ARCH with a white box outlined in orange. Matt,
    // on the flat white board this drew first: "They're still not the same." The arch is the shape
    // skeeball's `_hoopBackboard` settled on after two rounds with him, and the reason it is an
    // ellipse rather than a semicircle is written up in `skeeball/CLAUDE.md`: a semicircle's
    // height IS half its width, so height can only be bought with width, and width is capped by
    // the no-overlap rule. Skeeball prints a basket's VALUE in the box; this machine has none, so
    // the box is left as what it is on a real board, the shooter's square.
    const cv = document.createElement('canvas');
    cv.width = 360; cv.height = Math.round(360 * bh / bw);
    const x = cv.getContext('2d');
    const cw = cv.width, ch = cv.height;
    x.fillStyle = '#f4f1e7';
    x.beginPath();
    x.ellipse(cw / 2, ch, cw / 2, ch, 0, Math.PI, 0);
    x.fill();
    x.lineWidth = Math.max(4, ch * 0.055);
    x.strokeStyle = '#3a3630';
    x.beginPath();
    x.ellipse(cw / 2, ch, cw / 2 - x.lineWidth / 2, ch - x.lineWidth / 2, 0, Math.PI, 0);
    x.stroke();
    const bxw = cw * 0.50, bxh = ch * 0.44;
    const bx = (cw - bxw) / 2, by = ch * 0.58 - bxh / 2;
    x.fillStyle = '#ffffff';
    x.fillRect(bx, by, bxw, bxh);
    x.lineWidth = Math.max(4, ch * 0.06);
    x.strokeStyle = L.ring;
    x.strokeRect(bx, by, bxw, bxh);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.PlaneGeometry(bw, bh);
    // TRANSPARENT, because an arch leaves the canvas's corners empty: without this they render
    // as two black triangles either side of every board.
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.75, transparent: true, alphaTest: 0.4,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, holes.length);
    const dummy = new THREE.Object3D();
    holes.forEach((id, i) => {
      const H = G.holes[id];
      const foot = M.faceToWorld(H.u, back.v0, 0.007);      // the riser's own plane, 7mm proud
      const rimY = M.faceToWorld(H.u, H.v, H.collarH)[1];
      // Bottomed AT the rim, which is how HOT SHOT hangs its own cards: the whole board stands
      // above the ring and the net hangs clear below it. Sunk lower the rim crosses the card's
      // face a third of the way up and the two read as one lump.
      const y0 = Math.max(foot[1], rimY - bh * 0.04);
      dummy.position.set(foot[0], y0 + bh / 2, foot[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this._trash.push(geo, mat, tex);
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
      if (s.part === 'keep' || s.part === 'throat' || s.part === 'cupSeg' || s.part === 'rimCap') continue;
      if (!byPart.has(s.part)) byPart.set(s.part, []);
      byPart.get(s.part).push(s);
    }
    const tmp = new THREE.Object3D();
    for (const [part, list] of byPart) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = this._mat(part);
      (this._partMats || (this._partMats = new Map())).set(part, mat);
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

      // A REAL WIRE BASKET, not a bare torus + a cone of lines (Matt: "the baskets are not as
      // good as hot shot"). Ported from skeeball/js/machines/basketball/render.js's own
      // `_wireBasket`/`_mergedTubes`: the rim on the physics collar radius, a small bottom ring,
      // tapered ribs, and a netted taper of crossing strands - the thing that makes a hoop read
      // as a basket. See `_wireBasket` below for why it stays two draw calls per hoop.
      const { rim, rimMat, net } = this._wireBasket(H);
      g.add(rim);
      g.add(net);

      this.scene.add(g);
      this.rims[id] = { group: g, rim, mat: rimMat };
    }

    this._hoopBackboards(M, G, L);

    // --- THE SCREEN: the Connect 4 board, on the back wall -------------------------------------
    // The real cabinet shows the grid on an LCD above the hoops, which is also what makes this
    // buildable: 42 discs are PAINT, not 42 rigid bodies, and the physics only ever has to answer
    // "which hoop did it go through".
    // THE DISPLAY IS THE RAKED FACE ITSELF, full width, columns under the hoops.
    // Its geometry is not invented here: SCREEN_V/SCREEN_W come from boarddef, and every column's
    // canvas x is derived from that hoop's own `u`, so "column N is under hoop N" holds by
    // construction rather than by two layouts happening to agree.
    const [v0, v1] = SCREEN_V;
    const lo = M.faceToWorld(0, v0, 0.010);
    const hi = M.faceToWorld(0, v1, 0.010);
    const panelLen = Math.hypot(hi[1] - lo[1], hi[2] - lo[2]);
    const panelW = SCREEN_W;
    const PX = 1200;                                   // canvas pixels across the panel
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.width = PX;
    this.gridCanvas.height = Math.round(PX * (panelLen / panelW));
    this.gridBezel = Math.round(PX * 0.012);
    // COLUMN pitch is the hoops' own and is not negotiable - it is what makes a column sit under
    // a hoop. ROW pitch is whatever six rows of the panel's own HEIGHT come to, and on this
    // cabinet that is smaller than the column pitch: the display is a widescreen panel (9.10X by
    // 4.80X), so the board is wide, round cells with more air between columns than between rows.
    // Deriving the row pitch from the column pitch instead is what overflowed the canvas by 46%
    // the moment the panel stopped being square-ish.
    this.gridPitch = (PX / panelW) * (G.holes.c2.u - G.holes.c1.u);
    this.gridRowPitch = (this.gridCanvas.height - this.gridBezel * 2) / 6;
    this.gridTop = this.gridBezel;
    this.colX = Object.keys(G.holes)
      .sort((a, b) => G.holes[a].u - G.holes[b].u)
      .map((id) => PX / 2 + (G.holes[id].u / panelW) * PX);

    this.gridTex = new THREE.CanvasTexture(this.gridCanvas);
    this.gridTex.colorSpace = THREE.SRGBColorSpace;
    const scrGeo = new THREE.PlaneGeometry(panelW, panelLen);
    const scrMat = new THREE.MeshBasicMaterial({ map: this.gridTex });   // unlit: it is a screen
    this.screen = new THREE.Mesh(scrGeo, scrMat);
    this.screen.position.set(0, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    // Lie the panel in the raked face's own plane.
    this.screen.rotation.x = -(Math.PI / 2 - M.frames[0].tilt);
    this.scene.add(this.screen);
    this._trash.push(scrGeo, scrMat);
    // What the headless display probe reads (reference/hoops/check-display.mjs). Data only, and
    // the probe derives everything else from `this.screen`'s own transform, so a panel that moves
    // cannot leave the probe measuring where it used to be.
    this.panel = { w: panelW, len: panelLen, px: PX };
    this.setGrid(null, null);

    // --- the cabinet's own furniture ----------------------------------------------------------
    // Everything below is PAINT - no collider, nothing a ball can reach. It exists because the
    // first build was a bare dark box: the reference cabinet has a marquee, a backboard panel
    // behind the hoops and red/yellow player sides, and without them it does not read as the
    // machine at all.
    this._dressing(M, G, L);

    // --- the ball ------------------------------------------------------------------------------
    const bGeo = new THREE.SphereGeometry(G.ballR, this.soft ? 12 : 22, this.soft ? 10 : 16);
    // THE THROWN BALL IS A BASKETBALL IN THE PLAYER'S OWN COLOUR, painted from the SAME hexes the
    // board's discs use (`L.red` / `L.yellow`). Matt, 2026-09-22: "the ball you throw is not the
    // same yellow as the balls in the connect 4 board... why is the ball you throw not a
    // basketball?" It was a plain lit sphere (`color` only, roughness 0.75), so the scene lights
    // multiplied the hex down while the board is an UNLIT screen showing the hex as is: two
    // different yellows from one number. Now the texture is sRGB (see skeeball's `_buildBall` for
    // what happens without that line). (Superseded 2026-09-23: unlit, see below.)
    // board's colour under any light and the key light only adds the round shading on top.
    // (2026-09-23) AND IT IS UNLIT, like the board. Matt, after the first version: "the red
    // basketball isn't the same color when thrown as when it's in the board." Measured in his
    // recording: thrown red RGB 221,70,64 against the disc's 241,87,79. A lit ball can never match
    // an unlit screen - the scene's lights move its colour with every frame - so the ball is now a
    // MeshBasicMaterial exactly like the screen, painted from the disc's OWN gradient (see
    // `_basketballTex`), and its seams still show the roll.
    this._ballTex = { red: this._basketballTex(L.red, true), yellow: this._basketballTex(L.yellow, false) };
    this.ballMat = new THREE.MeshBasicMaterial({ map: this._ballTex.red });
    this.ballMesh = new THREE.Mesh(bGeo, this.ballMat);
    this.ballMesh.castShadow = !this.soft;
    this.ballMesh.visible = false;
    this.scene.add(this.ballMesh);
    this._trash.push(bGeo, this.ballMat, this._ballTex.red, this._ballTex.yellow);

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
    // The display and the hoop row are one object now - the display IS the face of the machine -
    // so the camera frames the pair, sitting above and behind the ball so the raked panel is
    // presented to the viewer rather than seen edge-on.
    // THE CAMERA STANDS BACK AND LOOKS ALMOST LEVEL, and both halves of that are the fit below.
    // It used to sit 0.46 m above the hoop row and 0.62 m behind the ball, which is a steep look
    // DOWN at a machine whose whole face is vertical - and because the resting ball is then
    // 1.35 m below the camera at 0.62 m, a field wide enough to keep it in shot is 86 degrees,
    // which shrank the cabinet to a third of the frame. Standing further back and lower makes
    // the ball cheap to include and the machine big.
    // WHERE IT STANDS IS ARITHMETIC, and the binding constraint is the ball, not the machine.
    // The camera has to keep the resting ball in shot (skeeball's rule, measured: a camera in
    // front of the ball leaves it off screen for the first 250 ms of every throw), and the ball
    // sits low and very near. Close in, that is ruinously expensive - at 0.62 m behind the ball
    // and 1.35 m above it the field has to open to 86 degrees and the cabinet shrinks to a third
    // of the frame. Standing BACK costs the ball almost nothing (the angle down to it collapses)
    // while the machine loses only what distance takes, so the display ends up bigger, not
    // smaller: 90 px tall from 1.15 m back, 167 px from 3.00 m.
    //
    // 3.00 m is where the two costs cross. Past it the frame is capped by the cabinet's WIDTH -
    // 1.52 m of board on a 0.49 aspect phone is a 3.09 m tall frame however far back you stand,
    // so a 0.70 m display can never be more than 22.6% of a portrait screen. That ceiling is
    // geometry, not tuning; `reference/hoops/check-display.mjs` measures the width share instead.
    this._aimAt = new THREE.Vector3(0, 0.79, -1.70);
    this.camera.position.set(0, 1.00, 3.00);
    this.camera.lookAt(this._aimAt);

    // THE FIELD OF VIEW IS DERIVED FROM THE THINGS THAT MUST BE IN SHOT, not set to a constant.
    // A constant 62 degrees was right for the raked cabinet and left 23% of the frame as empty
    // black sky the moment the machine got deeper - and a constant is wrong in the other
    // direction too, since the one that frames a tall phone crops the cabinet's width on a short
    // one. `_fitPoints` is the list: the ball where it waits to be thrown (skeeball's rule - the
    // camera stands BEHIND the ball and the ball is never off screen), the two bottom corners of
    // the display, the two top corners of the board, and the top of the marquee.
    const fp = [
      new THREE.Vector3(0, G.ballR, -0.12),
      ...[-1, 1].map((sx) => new THREE.Vector3(sx * G.boardW / 2, lo[1], lo[2])),
      ...[-1, 1].map((sx) => new THREE.Vector3(sx * G.boardW / 2, hi[1], hi[2])),
    ];
    if (this._marqueeTop) {
      for (const sx of [-1, 1]) {
        fp.push(new THREE.Vector3(sx * G.boardW * 0.51, this._marqueeTop[1], this._marqueeTop[2]));
      }
    }
    this._fitPoints = fp;
  }

  /** Marquee, backboard panel and the two player sides. Paint only. */
  _dressing(M, G, L) {
    const texFrom = (w, h, draw) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      draw(cv.getContext('2d'), cv);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      this._trash.push(t);
      return t;
    };
    const panel = (tex, w, h, pos, rotX) => {
      const g = new THREE.PlaneGeometry(w, h);
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (rotX) mesh.rotation.x = rotX;
      this.scene.add(mesh);
      this._trash.push(g, m);
      return mesh;
    };

    const back = M.frames[M.frames.length - 1];
    const topW = M.faceToWorld(0, back.v1, 0);
    const bw = G.boardW;

    // THE HEADER, under the marquee. It used to hold seven white boards, which is where this
    // cabinet's "backboards" lived - half a metre above the hoops, connected to nothing. The real
    // boards are bolted behind the rims now (`_hoopBackboards`), so this is what it always
    // actually was: a cabinet fascia. Kept dark and shallow so nothing competes with the hoop row -
    // just enough craft (a bright top edge, a quiet centre seam, corner bolts) to read as the same
    // machine as the marquee above it, never louder than it.
    const bbH = bw * 0.10;
    panel(texFrom(1200, 180, (x, cv) => {
      const g = x.createLinearGradient(0, 0, 0, cv.height);
      g.addColorStop(0, '#2a3546'); g.addColorStop(1, '#141a24');
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, 0, cv.width, 4);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 4, cv.width, 2);
      // a quiet centre seam, as if the fascia is two panels bolted together under the marquee
      x.fillStyle = 'rgba(0,0,0,0.28)';
      x.fillRect(cv.width / 2 - 1, 10, 2, cv.height - 16);
      // four corner bolts - cheap and reads as "hardware" at play size
      x.fillStyle = 'rgba(255,255,255,0.14)';
      for (const bx of [cv.width * 0.06, cv.width * 0.94]) {
        x.beginPath(); x.arc(bx, cv.height * 0.5, 5, 0, Math.PI * 2); x.fill();
      }
    }), bw * 0.94, bbH, [0, topW[1] + bbH / 2 - 0.02, topW[2] + 0.014]);

    // THE MARQUEE, over the top of the cabinet. Matt: "please improve the game banner/header on
    // connect 4... Connect 4 hoops is laaame in comparison [to Brick City's]." The old sign was a
    // flat three-stop orange gradient with a plain dark box and two lines of default text - no
    // frame, no texture, no depth, nothing that says WHICH machine it is. This one is built the
    // way a real lit sign is built - a layered frame, a textured panel, dimensional lettering,
    // bulb bars - but drawn from THIS cabinet's own motifs and palette (`boarddef.js`'s `look`),
    // never Brick City's brick coursing or its typography:
    //   - the panel is the board's own lit blue (`L.face`/`L.faceEdge`), the same blue as the
    //     Connect 4 screen below it, textured with a diagonal field of dark holes - this
    //     machine's grid, not a brick course;
    //   - a basketball sits at the left, a dropped red-over-yellow chip pair at the right - the
    //     two games this cabinet welds together, one per side;
    //   - "CONNECT 4" and "HOOPS" are each drawn three times (a dark offset copy for depth, two
    //     glow passes at shrinking blur, then a crisp face on top with a thin dark keyline so it
    //     stays readable small) in the cabinet's own red/orange, never Brick City's palette.
    // 0.20 rather than the original 0.12. Matt, twice: "the banner can be bigger. It's short. it
    // can be taller." A marquee is the tallest thing on an arcade cabinet and this one was a
    // strip. The camera follows on its own - `_marqueeTop` below is computed from `mqH` and is
    // one of `_fitPoints` - so the only real cost is the frame the machine is fitted into, which
    // `check-display.mjs` measures as the display's share of the frame width.
    const mqH = bw * 0.20;
    // ASPECT MATCHED TO THE PANEL (bw*1.02 / mqH = 5.1:1), so the drawing is not stretched. This
    // has to move whenever mqH does, or every letter and every bulb is squashed.
    const MQW = 2040, MQH = Math.round(MQW * (mqH / (bw * 1.02)));
    const roundRectPath = (x, rx, ry, rw, rh, rr) => {
      x.beginPath();
      x.moveTo(rx + rr, ry);
      x.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
      x.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
      x.arcTo(rx, ry + rh, rx, ry, rr);
      x.arcTo(rx, ry, rx + rw, ry, rr);
      x.closePath();
    };
    // Dimensional lettering: dark depth copy, two glow passes, crisp face, thin keyline.
    //
    // `trackTo` LETTER-SPACES the word to span a given width, and it is what makes the second
    // line work. "HOOPS" is five characters under a nine-character word, so at any size that
    // keeps it subordinate it renders as a short smudge in the middle of a very wide sign -
    // measured at play size, 45px of a 393px screen against CONNECT 4's 145. Tracked out to the
    // same width it reads as the second line of ONE sign instead. Drawn character by character
    // because `ctx.letterSpacing` is not available everywhere this ships.
    const signWord = (x, text, cx, cy, size, face, shadow, glow, trackTo) => {
      x.textBaseline = 'middle';
      x.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
      const chars = [...text];
      let track = 0, startX = cx;
      if (trackTo) {
        const natural = x.measureText(text).width;
        track = chars.length > 1 ? (trackTo - natural) / (chars.length - 1) : 0;
        startX = cx - (natural + track * (chars.length - 1)) / 2;
      }
      // One pass = one complete drawing of the word, so the glow of a letter cannot land on top
      // of the face of the letter before it.
      const pass = (dx, dy, style, blur) => {
        x.save();
        if (blur) { x.shadowColor = glow; x.shadowBlur = blur; x.globalAlpha = 0.55; }
        x.fillStyle = style;
        if (!trackTo) { x.textAlign = 'center'; x.fillText(text, cx + dx, cy + dy); }
        else {
          x.textAlign = 'left';
          let px2 = startX;
          for (const ch of chars) { x.fillText(ch, px2 + dx, cy + dy); px2 += x.measureText(ch).width + track; }
        }
        x.restore();
      };
      pass(size * 0.045, size * 0.07, shadow, 0);          // the depth copy underneath
      pass(0, 0, glow, size * 0.34);                        // the wide glow
      pass(0, 0, glow, size * 0.16);                        // the tight glow
      pass(0, 0, face, 0);                                  // the crisp face
      x.save();                                             // a thin dark keyline keeps it legible small
      x.lineWidth = Math.max(2, size * 0.018);
      x.strokeStyle = shadow;
      if (!trackTo) { x.textAlign = 'center'; x.strokeText(text, cx, cy); }
      else {
        x.textAlign = 'left';
        let px2 = startX;
        for (const ch of chars) { x.strokeText(ch, px2, cy); px2 += x.measureText(ch).width + track; }
      }
      x.restore();
    };
    // A basketball, drawn in the ring's own orange - the hoop half of the machine.
    const basketball = (x, cx, cy, r) => {
      x.save();
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = L.ring; x.fill();
      x.clip();
      x.strokeStyle = L.ringLip; x.lineWidth = Math.max(2, r * 0.09);
      x.beginPath(); x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); x.stroke();
      x.beginPath(); x.moveTo(cx - r, cy); x.lineTo(cx + r, cy); x.stroke();
      x.beginPath(); x.moveTo(cx, cy - r); x.quadraticCurveTo(cx - r * 0.72, cy, cx, cy + r); x.stroke();
      x.beginPath(); x.moveTo(cx, cy - r); x.quadraticCurveTo(cx + r * 0.72, cy, cx, cy + r); x.stroke();
      x.restore();
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 2; x.stroke();
    };
    // A dropped Connect 4 pair, red over yellow - the board half of the machine, THE PLAYERS'
    // OWN COLOURS (`L.red`/`L.yellow`), never a red/green pair (Matt is red/green colourblind).
    const chipPair = (x, cx, cy, r) => {
      // NEARLY TOUCHING. At a 1.15 separation the pair spans the basketball's height with two
      // discs too small to read as discs; closing the gap spends the same height on bigger chips,
      // which is what makes the right side answer the left.
      for (const [dy, col] of [[-r * 1.05, L.red], [r * 1.05, L.yellow]]) {
        x.beginPath(); x.arc(cx, cy + dy, r, 0, Math.PI * 2);
        x.fillStyle = col; x.fill();
        x.lineWidth = Math.max(2, r * 0.14);
        x.strokeStyle = 'rgba(0,0,0,0.4)'; x.stroke();
        x.beginPath(); x.arc(cx - r * 0.3, cy + dy - r * 0.3, r * 0.32, 0, Math.PI * 2);
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fill();
      }
    };
    panel(texFrom(MQW, MQH, (x, cv) => {
      const bezel = 10, border = 15, gap = 6;
      const inset = bezel + border + gap;
      const px = inset, py = inset, pw = cv.width - inset * 2, ph = cv.height - inset * 2;

      // Layer 1: the dark outer bezel - the sign's own cabinet, one shade darker than the fascia
      // below it so the two read as parts of the same machine.
      x.fillStyle = L.cabinetEdge; x.fillRect(0, 0, cv.width, cv.height);

      // Layer 2: the bright frame - a lit tube around the sign, in the machine's own bulb colour.
      roundRectPath(x, bezel + border / 2, bezel + border / 2, cv.width - (bezel + border / 2) * 2, cv.height - (bezel + border / 2) * 2, 20);
      x.save();
      x.shadowColor = L.glow; x.shadowBlur = 16;
      x.lineWidth = border; x.strokeStyle = L.bulb; x.stroke();
      x.restore();

      // Layer 3: the panel itself, in the board's OWN lit blue - this sign belongs to the machine
      // whose screen is that colour, not a generic orange rectangle.
      roundRectPath(x, px, py, pw, ph, 12);
      x.save(); x.clip();
      const bg = x.createLinearGradient(0, py, 0, py + ph);
      bg.addColorStop(0, L.face); bg.addColorStop(1, L.faceEdge);
      x.fillStyle = bg; x.fillRect(px, py, pw, ph);

      // The panel's own texture: a diagonal field of dark holes, THIS machine's coursing - the
      // Connect 4 grid, punched rather than printed, offset row to row the way a real board's
      // holes sit above the seven columns beneath it.
      const holeR = ph * 0.052, stepX = holeR * 3.1, stepY = holeR * 3.6;
      let rowI = 0;
      for (let hy = py - stepY; hy < py + ph + stepY; hy += stepY, rowI++) {
        const off = (rowI % 2) ? stepX / 2 : 0;
        for (let hx = px - stepX + off; hx < px + pw + stepX; hx += stepX) {
          x.beginPath(); x.arc(hx, hy, holeR, 0, Math.PI * 2);
          x.fillStyle = 'rgba(8,18,31,0.30)'; x.fill();
          x.beginPath(); x.arc(hx - holeR * 0.32, hy - holeR * 0.32, holeR * 0.34, 0, Math.PI * 2);
          x.fillStyle = 'rgba(255,255,255,0.08)'; x.fill();
        }
      }
      x.restore();

      // Layer 4: bulb bars along the top and bottom edges INSIDE the frame - chase lights, half
      // lit bright and half glowing dim, so the sign reads as ELECTRIC rather than printed.
      const bulbR = ph * 0.028, bulbN = 22;
      for (const by of [py + bulbR * 1.6, py + ph - bulbR * 1.6]) {
        for (let i = 0; i < bulbN; i++) {
          const bx = px + pw * (i + 0.5) / bulbN;
          const lit = i % 2 === 0;
          x.beginPath(); x.arc(bx, by, bulbR, 0, Math.PI * 2);
          x.fillStyle = lit ? L.bulb : L.glow;
          x.globalAlpha = lit ? 1 : 0.55;
          if (lit) { x.shadowColor = L.bulb; x.shadowBlur = bulbR * 2.2; }
          x.fill();
          x.shadowBlur = 0; x.globalAlpha = 1;
        }
      }

      // Layer 5: the two flanking motifs - a basketball on the hoops' side, a dropped Connect 4
      // pair on the board's side - so the sign names both halves of the machine without needing a
      // third word.
      // SIZED TO BE SEEN AT PLAY SIZE. At ph*0.15 they measured as two specks on a 393px phone -
      // the whole sign is only ~340px wide there, so an icon at a seventh of its height is about
      // 9px across and reads as dirt. A third of the panel's height is the smallest that says
      // "basketball" and "two dropped chips" rather than "dot".
      const midY = py + ph * 0.54, iconR = ph * 0.30;
      basketball(x, px + pw * 0.075, midY, iconR);
      chipPair(x, px + pw * 0.925, midY, iconR * 0.54);

      // Layer 6: the wordmark. HOOPS IS THE NAME, big and centred; "CONNECT 4" is a small stacked
      // tag to its LEFT (2026-09-22). Matt: "change the name of the game to have HOOPS be big and
      // Connect 4 smaller and to the side." HOOPS stays the bulb yellow - orange on this blue was
      // the lowest-contrast pair on the cabinet and read as a smear at play size - and the tag is
      // white, the neutral word. The block is sized by MEASURING the words and shrinks as one unit
      // if it would reach either flanking icon, so no language or font can push it into them.
      const leftEdge = px + pw * 0.075 + iconR * 1.25;
      const rightEdge = px + pw * 0.925 - iconR * 1.0;
      let big = ph * 0.66;
      const tagTop = 0.29, tagNum = 0.52, gapK = 0.16;   // sizes as fractions of `big`
      const widthAt = (sz) => {
        x.font = `900 ${sz}px ui-sans-serif, system-ui, sans-serif`;
        const hoopsW = x.measureText('HOOPS').width;
        x.font = `900 ${sz * tagTop}px ui-sans-serif, system-ui, sans-serif`;
        const tagW = x.measureText('CONNECT').width;
        return { hoopsW, tagW, total: tagW + sz * gapK + hoopsW };
      };
      let w = widthAt(big);
      const room = rightEdge - leftEdge;
      if (w.total > room) { big *= room / w.total; w = widthAt(big); }
      const startX = leftEdge + (room - w.total) / 2;
      const tagCx = startX + w.tagW / 2;
      const hoopsCx = startX + w.tagW + big * gapK + w.hoopsW / 2;
      const midW = py + ph * 0.54;
      signWord(x, 'CONNECT', tagCx, midW - big * 0.20, big * tagTop, '#ffffff', '#0c0d10', L.bulb);
      signWord(x, '4', tagCx, midW + big * 0.17, big * tagNum, '#ffffff', '#0c0d10', L.bulb);
      signWord(x, 'HOOPS', hoopsCx, midW + big * 0.03, big, L.bulb, '#0c0d10', L.glow);
    }), bw * 1.02, mqH, [0, topW[1] + bbH + mqH / 2 + 0.01, topW[2] + 0.02]);
    // The highest lit thing on the machine, which is one of the two points the camera frames on.
    this._marqueeTop = [0, topW[1] + bbH + mqH, topW[2] + 0.02];

    // THE CABINET'S FRONT is deliberately NOT painted, and that was measured rather than
    // assumed: the ramp crest stands at 0.464 m and the board's lip at 0.52 m, so from the play
    // camera the sightline over the crest crosses the cabinet's front face at 0.386 m - only the
    // top 10 cm of a 0.66 m panel is ever visible, and the rest of that dark band is the BACK OF
    // THE RAMP, which is lane furniture and not the cabinet at all.

    // THE PLAYER SIDES: red left, yellow right, the way the cabinet is split - and they are on
    // the FRONT, flanking the screen, because that is the only place a head-on camera can see
    // them. Two earlier versions were invisible from the play camera and it is the same reason
    // both times: a slab at the cabinet's SIDE shows the viewer nothing but its edge, and one
    // set behind the board's own rails shows nothing at all. The display is 9.10X across a
    // 10.44X board, so the strip either side of it is 98 mm wide - narrow, lit, and in shot.
    const strip = (G.boardW - this.panel.w) / 2;
    if (strip > 0.01) {
      const sGeo = new THREE.PlaneGeometry(strip, this.panel.len);
      for (const [sx, col] of [[-1, L.cabRed], [1, L.cabYellow]]) {
        const m = new THREE.MeshStandardMaterial({ color: COL(col), roughness: 0.8 });
        (this._sideMats || (this._sideMats = [])).push({ m, col });   // setPlayerTint repaints these
        const mesh = new THREE.Mesh(sGeo, m);
        mesh.position.set(sx * (this.panel.w + strip) / 2, this.screen.position.y, this.screen.position.z + 0.003);
        this.scene.add(mesh);
        this._trash.push(m);
      }
      this._trash.push(sGeo);
    }
  }

  /**
   * Paint the Connect 4 grid. `cells[c][r]`, r=0 at the bottom.
   *
   * COLUMN POSITIONS COME FROM THE HOOPS THEMSELVES (`this.colX`, built in _build from
   * geom.holes[].u), never from an independent 7-across layout. That is the whole point: in the
   * real cabinet column N sits directly under hoop N, and being able to see which column a shot
   * will drop into IS the game. The first build laid the grid out on its own and ended up with a
   * narrow panel floating in the middle of a wide machine, lined up with nothing.
   */
  /**
   * THE DISC FALLS DOWN THE COLUMN. Matt: "Can you show the ball fall down the columns rather than
   * go into the basket and just appear at the bottom of that column?"
   *
   * It drops from just above the board to its resting cell under something like gravity, then
   * bounces once. Driven by the game's own loop (`stepDrop` from ui.js's tick) rather than its own
   * rAF, so it cannot outlive the screen or run twice.
   *
   * **It starts on the CAPTURE event, not when the throw resolves.** Resolving is a further 0.35 s
   * on average (0.92 s at worst) while the ball falls the 0.26 m through the throat that commits
   * the score - and Matt saw exactly that as a gap: "There's a tiny lag between when the ball goes
   * into the basket and when it's shown falling. There shouldn't be. It should look like it's the
   * same ball that goes in the basket falling down the column." So the cell is PREDICTED at
   * capture (safe: this machine has no rimout, and a capture is a move 100% of the time) and
   * `commitDrop` hands over the authoritative grid when the move lands, without restarting.
   *
   * `onDone` is how the game-over card waits for it: without that, a winning disc's card covers
   * the very drop that won.
   */
  startDrop(cells, win, col, row, who, onDone) {
    const R = 6;
    this._drop = {
      cells, win, c: col, r: row, who, t: 0,
      // A lower cell falls further, so it takes longer. Bottom row ~0.45s, top row ~0.22s.
      dur: 0.22 + 0.045 * (R - 1 - row),
      onDone: typeof onDone === 'function' ? onDone : null,
    };
    this.setGrid(cells, win, this._drop);
  }

  /**
   * The move is now real. The drop was STARTED on the capture event, from a predicted cell, so
   * this hands it the authoritative grid without restarting the animation - the disc the player
   * is watching fall is the one that lands.
   */
  commitDrop(cells, win) {
    if (!this._drop) { this.setGrid(cells, win); return; }
    this._drop.cells = cells;
    this._drop.win = win;
  }

  /** The prediction was wrong (a full column, a rules refusal). Drop the disc and repaint. */
  cancelDrop(cells, win) { this._drop = null; this.setGrid(cells, win); }

  /** What cell the in-flight drop is for, or null. ui.js checks it against the real move. */
  dropTarget() {
    const d = this._drop;
    return d ? { c: d.c, r: d.r, who: d.who } : null;
  }

  /** Advance the fall. Called every frame by ui.js's tick; a no-op when nothing is falling. */
  stepDrop(dt) {
    const d = this._drop;
    if (!d) return;
    d.t += dt;
    if (d.t < d.dur) { this.setGrid(d.cells, d.win, d); return; }
    this._drop = null;
    this.setGrid(d.cells, d.win);          // the disc is now just another counter
    if (d.onDone) d.onDone();
  }

  /** Where a falling disc is right now, in canvas pixels: a gravity fall, then one small bounce. */
  _dropY(d, top, rowPitch, R) {
    const startY = top - rowPitch * 0.55;              // just above the lit field
    const endY = top + rowPitch * (R - 1 - d.r + 0.5);
    const p = Math.min(1, d.t / d.dur);
    const FALL = 0.80;                                  // the rest of the time is the bounce
    if (p < FALL) {
      const q = p / FALL;
      return startY + (endY - startY) * q * q;          // accelerating, like a dropped disc
    }
    // One decaying hop off the bottom, never more than a fifth of a cell high.
    const q = (p - FALL) / (1 - FALL);
    return endY - Math.sin(q * Math.PI) * rowPitch * 0.20 * (1 - q);
  }

  setGrid(cells, win, drop) {
    const cv = this.gridCanvas, x = cv.getContext('2d');
    const L = this.look, C = 7, R = 6;
    const pitch = this.gridPitch, rowPitch = this.gridRowPitch;
    const rad = Math.min(pitch, rowPitch) * 0.42;      // rows are the tight axis on a wide panel
    const top = this.gridTop, bez = this.gridBezel;

    x.fillStyle = '#05070c';
    x.fillRect(0, 0, cv.width, cv.height);
    // The lit blue field. Bright on purpose - the real one is a backlit LED panel, and the first
    // build's dull navy read as painted plastic.
    x.fillStyle = '#1668cf';
    x.fillRect(bez, bez, cv.width - bez * 2, cv.height - bez * 2);

    for (let c = 0; c < C; c++) {
      for (let r = 0; r < R; r++) {
        const cx = this.colX[c];
        const cy = top + rowPitch * (R - 1 - r + 0.5);
        let who = cells && cells[c] ? cells[c][r] : null;
        // While the disc is falling its destination is still an empty hole - it is drawn below,
        // in the air, instead.
        if (drop && c === drop.c && r === drop.r) who = null;
        if (who === null || who === undefined) {
          // AN EMPTY SLOT IS A DARK HOLE. It was cream, and a cream disc on a blue field reads as
          // a board already full of white counters - the grid looked like a waffle rather than
          // like Connect 4. On the real thing an unfilled cell is the hole you see through.
          const g2 = x.createRadialGradient(cx, cy - rad * 0.25, rad * 0.15, cx, cy, rad);
          g2.addColorStop(0, '#060c16'); g2.addColorStop(1, '#122036');
          x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2);
          x.fillStyle = g2; x.fill();
          x.lineWidth = Math.max(1.5, rad * 0.10); x.strokeStyle = '#0b3d80'; x.stroke();
        } else {
          this._ball2d(x, cx, cy, rad, who === 0 ? L.red : L.yellow, who === 0);
        }
        if (!drop && win && win.some((w) => w[0] === c && w[1] === r)) {
          x.beginPath(); x.arc(cx, cy, rad + 4, 0, Math.PI * 2);
          x.lineWidth = 6; x.strokeStyle = '#2e9d4a'; x.stroke();
        }
      }
    }
    if (drop) {
      // THE DISC FALLS BEHIND THE BOARD'S FACE, SEEN ONLY THROUGH THE HOLES (2026-09-23). Matt,
      // on two slow-motion recordings: "the ball still falls in front of the connect 4 board
      // instead of IN the board." It was painted ON TOP of the blue face, so it slid down over the
      // plastic between the holes. On a real Connect 4 the disc drops down a slot behind the
      // face and you glimpse it hole by hole - so it is clipped to that column's holes, and each
      // hole's own rim is redrawn over it so it reads as inside the hole, not on it.
      const c = drop.c, cx = this.colX[c];
      x.save();
      x.beginPath();
      for (let r = 0; r < R; r++) {
        const cy = top + rowPitch * (R - 1 - r + 0.5);
        x.moveTo(cx + rad, cy);
        x.arc(cx, cy, rad, 0, Math.PI * 2);
      }
      x.clip();
      this._ball2d(x, cx, this._dropY(drop, top, rowPitch, R), rad,
        drop.who === 0 ? L.red : L.yellow, drop.who === 0);
      x.restore();
      x.lineWidth = Math.max(1.5, rad * 0.10); x.strokeStyle = '#0b3d80';
      for (let r = 0; r < R; r++) {
        const cy = top + rowPitch * (R - 1 - r + 0.5);
        x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.stroke();
      }
    }
    this.gridTex.needsUpdate = true;
  }

  /** A piece is a BASKETBALL, not a flat disc - seams and all, like the real cabinet's. */
  _ball2d(x, cx, cy, r, fill, dark) {
    const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, dark ? '#ff7a6e' : '#ffe488');
    g.addColorStop(1, fill);
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fillStyle = g; x.fill();
    x.strokeStyle = dark ? '#8f1f18' : '#a97c00';
    x.lineWidth = Math.max(1.5, r * 0.09);
    x.stroke();
    x.save();
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
    x.strokeStyle = dark ? 'rgba(120,20,14,0.85)' : 'rgba(150,105,0,0.8)';
    x.lineWidth = Math.max(1.2, r * 0.075);
    x.beginPath(); x.moveTo(cx - r, cy); x.lineTo(cx + r, cy);
    x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); x.stroke();
    x.beginPath();
    x.ellipse(cx - r * 0.98, cy, r * 0.62, r, 0, -Math.PI / 2, Math.PI / 2);
    x.ellipse(cx + r * 0.98, cy, r * 0.62, r, 0, Math.PI / 2, -Math.PI / 2);
    x.stroke();
    x.restore();
  }

  /** Light the rim of the hoop a ball just went through. */
  flashRim(id) {
    const r = this.rims[id];
    if (!r) return;
    r.mat.emissiveIntensity = 1.4;
    r._flash = 0.5;
  }

  /**
   * WHICH SIDE YOU ARE, painted on the machine itself (2026-09-24). Matt: "me and the king of
   * games just had multiple games going at once and i was red in some and yellow in others. It
   * was very confusing... change the ramp color or background color or something?" In a
   * multiplayer match the room behind the machine and the side rails take YOUR colour for the
   * whole match - it never follows the turn, so a glance says which colour is yours. `null` puts
   * the plain cabinet back (solo and two-on-one-phone, where there is no single "you"). The words
   * on the HUD still say it too; colour is never the only signal (Matt is red/green colourblind).
   */
  setPlayerTint(hex) {
    // THE BALL'S OWN COLOUR, EXACTLY (2026-09-24). Matt: "the yellow must be the same yellow as
    // the ball. and the red the same red as the ball." The first two builds mixed the colour into
    // the dark wall (42%, then 85% for yellow), so it was never the ball's colour. Now it is
    // `ballTone()` - the same blend the ball's wrap is painted with - unlit on the background
    // and EMISSIVE on the rails, so the lights cannot shade it into another colour either.
    const rail = this._partMats && this._partMats.get('rail');
    if (!hex) {
      this.scene.background = COL(this.look.wall);
      if (rail) { rail.color = COL(this.look.cabinet); rail.emissive = COL('#000000'); }
      for (const { m, col } of this._sideMats || []) { m.color = COL(col); m.emissive = COL('#000000'); }
      return;
    }
    const dark = String(hex).toLowerCase() !== String(this.look.yellow).toLowerCase();
    const tone = COL(ballTone(hex, dark));
    this.scene.background = tone.clone();
    if (rail) { rail.color = COL('#000000'); rail.emissive = tone.clone(); rail.emissiveIntensity = 1; }
    // The red-left / yellow-right strips beside the display too: in a match where you are red, a
    // yellow strip is one more thing saying the wrong colour.
    for (const { m } of this._sideMats || []) { m.color = COL('#000000'); m.emissive = tone.clone(); m.emissiveIntensity = 1; }
  }

  /** Which player's basketball is in the air. Matched on the hex so callers keep passing
   *  `BOARD.look.red` / `.yellow`, exactly the colours the board's discs are painted in. */
  setBallColor(hex) {
    if (!this.ballMat || !this._ballTex) return;
    const tex = String(hex).toLowerCase() === String(this.look.yellow).toLowerCase()
      ? this._ballTex.yellow : this._ballTex.red;
    this.ballMat.map = tex; this.ballMat.needsUpdate = true;
  }

  /** A basketball wrap (equirect: the horizontal band is the equator seam, the vertical bands are
   *  meridians, the pebbling keeps the roll visible - skeeball's `_buildBall`) in one player's
   *  colour, with the seam colour the board's `_ball2d` pieces use for the same player. */
  _basketballTex(fill, dark) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const x = cv.getContext('2d');
    // THE DISC'S OWN COLOUR, not the bare hex: `_ball2d` paints a disc as a gradient from a light
    // stop to `fill`, and what the eye reads as "the red disc" is that blend. So the wrap is the
    // same blend (40% light stop, 60% fill), measured against the disc in a rendered frame.
    x.fillStyle = ballTone(fill, dark); x.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 140; i++) {
      x.globalAlpha = 0.16;
      x.beginPath(); x.arc((i * 41) % 256, (i * 23) % 128, 2.2, 0, Math.PI * 2);
      x.fillStyle = i % 2 ? (dark ? '#8f1f18' : '#a97c00') : '#ffffff';
      x.fill();
    }
    x.globalAlpha = 1;
    x.fillStyle = dark ? '#6e140e' : '#7a5800';
    x.fillRect(0, 61, 256, 6);                                        // equator
    for (const sx of [0, 64, 128, 192]) x.fillRect(sx, 0, 5, 128);    // meridians
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** The narrowest field that still holds every `_fitPoints` point, width AND height. */
  _fovFor(aspect) {
    if (!this._fitPoints) return aspect < 0.62 ? 62 : 52;
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    let tan = 0.10;
    for (const p of this._fitPoints) {
      const v = p.clone().applyMatrix4(inv);
      const d = Math.max(0.05, -v.z);                 // in front of the camera, in camera space
      tan = Math.max(tan, Math.abs(v.y) / d, Math.abs(v.x) / d / aspect);
    }
    const fov = 2 * Math.atan(tan * 1.05) * 180 / Math.PI;   // 5% of air around the machine
    return Math.max(26, Math.min(86, fov));
  }

  resize(w, h) {
    if (this.disposed || !w || !h) return;
    this.renderer.setSize(w, h, true);   // `true` sets the CSS size too - an absolutely
    this.camera.aspect = w / h;          // positioned canvas is a REPLACED element and inset:0
    if (this._aimAt) this.camera.lookAt(this._aimAt);
    this.camera.fov = this._fovFor(w / h);
    this.camera.updateProjectionMatrix();// does NOT stretch it; without this the frame is a crop.
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Where the bottom edge of the Connect 4 screen lands on the canvas, in CSS px from its top.
   *  ui.js hangs the shot messages just under it, where the player is already looking. */
  boardBottomPx() {
    if (this.disposed || !this.screen) return null;
    this.camera.updateMatrixWorld(true);
    this.screen.updateMatrixWorld(true);
    const v = new THREE.Vector3(0, -this.panel.len / 2, 0);
    this.screen.localToWorld(v);
    v.project(this.camera);
    const h = this.renderer.domElement.clientHeight;
    return h ? (1 - (v.y + 1) / 2) * h : null;
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
