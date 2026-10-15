// archery/js/bow3d.js - the bow, the left hand, the sleeve and the nocked arrow as real 3D models,
// lit, drawn in their own small scene over the range (a first-person "view model"). Everything is
// built from code here; no model files.
//
// The bow is modelled in a frame where the sight's centre is the origin and the sight's inner
// radius is 0.46 (one unit is about 5 cm). ui.js says where on the screen the sight's centre goes
// and how big its inner radius is in pixels (setPose); this file works out how far from the eye
// the bow must be for that, so the ring ui.js draws (the gauge and crosshair, an SVG) and the
// magnified view render.js draws inside it always sit exactly in the sight.
//
// The arm is not part of the bow: the sleeve runs from the wrist (which moves with the bow) to a
// shoulder that stays put just below and left of the eye, so it is long and straight with the
// bow down and short and bunched when drawn, as in the recording.

export const SIGHT_R = 0.46;            // the sight's inner radius, in bow units
const FOV = 50;                          // the view model's camera
const SHOULDER = [-4.4, -4.4, -2.4];     // view space, bow units
const BODY_S = 0.85;                     // the bow against its sight (the sight ring was measured after the bow)
const HAND = [1.3, -3.62, 0.02];         // bow space: the hand's centre, on the grip under the shelf
const HAND_S = 1.45;
const WRIST = [HAND[0] - 1.15 * HAND_S, HAND[1] - 0.85 * HAND_S, 0.38];   // bow space: where the hand meets the forearm
const REST = [0.82, -2.28, 0.3];         // bow space: where the arrow lies on the shelf
// The arrow's back end (view space), at the drawing hand by the face; with the bow down it is
// lower and further right. The arrow points from here through the rest.
const NOCK = { idle: [5.2, -5.0, -3.0], drawn: [1.7, -3.4, -1.6] };

export class BowView {
  constructor(THREE, track, { env = null, color = '#1f6fe5' } = {}) {
    this.T = THREE;
    const g = (x) => track.g(x), m = (x) => track.m(x);
    this.scene = new THREE.Scene();
    if (env) this.scene.environment = env;
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
    this.scene.add(this.cam);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5c8a4a, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-0.5, 1.0, 0.7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 0.7);
    rim.position.set(0.9, 0.3, -0.6);
    this.scene.add(rim);

    const M = {
      blue: m(new THREE.MeshStandardMaterial({ color: '#2c7cf0', metalness: 0.7, roughness: 0.2, envMapIntensity: 1.9 })),
      blueDark: m(new THREE.MeshStandardMaterial({ color: '#1d5cc4', metalness: 0.55, roughness: 0.32 })),
      black: m(new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.6, roughness: 0.32 })),
      rubber: m(new THREE.MeshStandardMaterial({ color: '#202328', metalness: 0.3, roughness: 0.5 })),
      grey: m(new THREE.MeshStandardMaterial({ color: '#59616d', metalness: 0.6, roughness: 0.35 })),
      white: m(new THREE.MeshStandardMaterial({ color: '#f2f5f8', metalness: 0.1, roughness: 0.4 })),
      skin: m(new THREE.MeshStandardMaterial({ color: '#f1c7a6', metalness: 0, roughness: 0.62, envMapIntensity: 0.6 })),
      sleeve: m(new THREE.MeshStandardMaterial({ color: '#79a3dc', metalness: 0, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.6, flatShading: true })),
      shaft: m(new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.35 })),
      metal: m(new THREE.MeshStandardMaterial({ color: '#e3e8ee', metalness: 0.95, roughness: 0.18 })),
      blade: m(new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#c9d0d8', emissiveIntensity: 0.45, metalness: 0.2, roughness: 0.35, side: THREE.DoubleSide })),
      blueHi: m(new THREE.MeshStandardMaterial({ color: '#6db4ff', metalness: 0.5, roughness: 0.2, envMapIntensity: 1.6 })),
      glass: m(new THREE.MeshStandardMaterial({ color: '#3d4f62', metalness: 0.4, roughness: 0.15, emissive: '#1c2b3a' })),
      pale: m(new THREE.MeshStandardMaterial({ color: '#e9dcd3', metalness: 0.1, roughness: 0.5 })),
      slot: m(new THREE.MeshStandardMaterial({ color: '#1f6fe0', emissive: '#1a5fd6', emissiveIntensity: 0.6, roughness: 0.4 })),
      checks: m(new THREE.MeshStandardMaterial({ map: checks(THREE, track), metalness: 0.4, roughness: 0.35 })),
    };
    this.M = M;

    // --- the bow ---------------------------------------------------------------------------------
    const rig = new THREE.Group();
    this.rig = rig;
    this.scene.add(rig);
    const ext = (pts, depth, mat, z = 0, bevel = 0.09) => {
      const s = new THREE.Shape();
      pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      s.closePath();
      const geo = g(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 8 }));
      geo.translate(0, 0, -depth / 2 + z);
      const mesh = new THREE.Mesh(geo, mat);
      rig.add(mesh);
      return mesh;
    };
    const box = (w, h, d, x, y, z, mat, parent = rig) => {
      const mesh = new THREE.Mesh(g(new THREE.BoxGeometry(w, h, d)), mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // Laid out from a grid over the recording's frames, in units of this frame (the sight's
    // outer ring is 0.635 across its radius): everything below is where the recording has it
    // relative to the sight.
    // The top: the blue limb going up off the screen, a dark slot down its middle, held in a
    // black pocket block (pale caps, a lit blue slot, a knob) inside a black cage whose two arms
    // spread out and come back in, sky showing between them (the recording).
    ext([[0.9, 16], [2.3, 16], [2.3, 4.4], [0.9, 4.4]], 0.34, M.blue, -0.05);
    const oval = new THREE.Shape();
    oval.absarc(1.6, 9.4, 0.42, 0, Math.PI, false);
    oval.absarc(1.6, 5.4, 0.42, Math.PI, Math.PI * 2, false);
    oval.closePath();
    const ovalMesh = new THREE.Mesh(g(new THREE.ShapeGeometry(oval, 12)), M.rubber);
    ovalMesh.position.z = 0.19;
    rig.add(ovalMesh);
    ext([[0.5, 4.6], [2.45, 4.6], [2.45, 2.95], [2.27, 2.75], [0.68, 2.75], [0.5, 2.95]], 0.8, M.black);
    box(0.95, 0.14, 0.1, 1.6, 4.4, 0.42, M.pale);
    box(0.95, 0.3, 0.08, 1.6, 3.85, 0.4, M.slot);
    box(0.7, 0.1, 0.1, 1.6, 3.85, 0.45, M.rubber);
    const knob = new THREE.Mesh(g(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 20)), M.grey);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(1.6, 3.35, 0.4);
    rig.add(knob);
    box(0.95, 0.13, 0.1, 1.6, 2.95, 0.42, M.pale);
    box(2.0, 0.3, 0.06, 1.6, 2.6, 0.36, M.checks);
    const strut = (x0, y0, x1, y1, wdt = 0.24) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m2 = new THREE.Mesh(g(new THREE.BoxGeometry(wdt, len + wdt * 0.6, 0.5)), M.black);
      m2.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      m2.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
      rig.add(m2);
    };
    for (const sgn of [-1, 1]) {
      const X = (dx) => 1.6 + sgn * dx;
      strut(X(0.85), 3.6, X(1.45), 4.8);
      strut(X(1.45), 4.8, X(1.45), 5.7);
      strut(X(1.45), 5.7, X(1.05), 7.0);
      strut(X(1.05), 7.0, X(1.05), 16);
    }
    // The fork: two blue arms down to the column, the sky showing between them.
    // A Y: the left arm slants in from the pocket's left corner, the right one runs straight down.
    ext([[0.8, 2.75], [1.3, 2.75], [2.1, 1.3], [1.78, 1.3]], 0.66, M.blue);
    ext([[0.8, 2.75], [0.95, 2.75], [1.86, 1.3], [1.78, 1.3]], 0.7, M.blueHi);
    ext([[2.0, 2.75], [2.33, 2.75], [2.33, 1.3], [2.0, 1.3]], 0.66, M.blue);
    // The column, blue with a black strip down its far edge, a dark slot and three white marks.
    ext([[1.78, 1.32], [2.33, 1.32], [2.33, -2.35], [1.78, -2.35]], 0.7, M.blue);
    ext([[1.78, 1.32], [1.88, 1.32], [1.88, -2.35], [1.78, -2.35]], 0.74, M.blueHi);
    ext([[2.2, 1.32], [2.35, 1.32], [2.35, -2.35], [2.18, -2.35]], 0.74, M.black);
    const slot = new THREE.Shape();
    slot.absarc(2.0, -0.95, 0.11, 0, Math.PI, false);
    slot.absarc(2.0, -1.75, 0.11, Math.PI, Math.PI * 2, false);
    slot.closePath();
    const slotMesh = new THREE.Mesh(g(new THREE.ShapeGeometry(slot, 10)), M.rubber);
    slotMesh.position.z = 0.42;
    rig.add(slotMesh);
    for (let i = 0; i < 3; i++) box(0.08, 0.13, 0.04, 2.08, 0.75 - i * 0.24, 0.42, M.white);
    // The sight: a thick black bar from the riser hooking down to the ring, a small foot under it.
    // The bar runs in from the column below the ring's middle and hooks up into its lower right.
    box(1.3, 0.24, 0.26, 1.15, -0.72, 0.05, M.black);
    const post = box(0.22, 0.42, 0.26, 0.5, -0.56, 0.05, M.black);
    post.rotation.z = 0.6;
    box(0.2, 0.3, 0.3, 1.72, -0.72, 0.05, M.rubber);
    box(0.3, 0.14, 0.24, 0.0, -0.68, 0.02, M.black);
    box(0.1, 0.12, 0.26, -0.1, -0.78, 0.02, M.black);
    box(0.1, 0.12, 0.26, 0.1, -0.78, 0.02, M.black);
    const housing = new THREE.Mesh(g(new THREE.TorusGeometry(0.56, 0.08, 14, 48)), M.black);
    rig.add(housing);
    const tube = new THREE.Mesh(g(new THREE.CylinderGeometry(0.62, 0.62, 0.32, 48, 1, true)), M.black);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -0.17;
    rig.add(tube);
    // The shelf: a blue slab sticking out left, dark underneath, a little metal rest on top.
    box(1.5, 0.3, 0.95, 1.16, -2.5, 0.1, M.blue);
    box(1.45, 0.42, 0.98, 1.18, -2.86, 0.1, M.black);
    box(0.06, 0.26, 0.3, REST[0] + 0.12, REST[1] + 0.02, REST[2] - 0.05, M.metal);
    box(0.32, 0.05, 0.3, REST[0] - 0.02, REST[1] - 0.1, REST[2] - 0.05, M.metal);
    // The grip: a tall black block under the shelf, rounded edges, its foot cut at a slant.
    const gp = new THREE.Shape();
    gp.moveTo(-0.45, -3.05); gp.lineTo(0.45, -3.05); gp.lineTo(0.45, -6.0); gp.lineTo(0.08, -6.5); gp.lineTo(-0.45, -6.5); gp.closePath();
    const gripGeo = g(new THREE.ExtrudeGeometry(gp, { depth: 0.85, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 4 }));
    gripGeo.translate(0, 0, -0.425);
    gripGeo.rotateY(-Math.PI / 2);
    const grip = new THREE.Mesh(gripGeo, M.rubber);
    grip.position.set(1.27, 0, 0.02);
    rig.add(grip);
    // Below the grip: blue again, wider, a bolt, a black band, down off the screen.
    ext([[0.7, -6.3], [1.85, -6.3], [1.95, -18], [0.7, -18]], 0.7, M.blue);
    ext([[1.7, -6.3], [1.85, -6.3], [1.95, -18], [1.82, -18]], 0.74, M.black);
    box(1.2, 0.34, 0.8, 1.3, -8.8, 0, M.black);
    const bolt = new THREE.Mesh(g(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 20)), M.grey);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(1.27, -7.25, 0.42);
    rig.add(bolt);
    const boltIn = new THREE.Mesh(g(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12)), M.rubber);
    boltIn.rotation.x = Math.PI / 2;
    boltIn.position.set(1.27, -7.25, 0.44);
    rig.add(boltIn);

    // --- the left hand, seen from the back: a closed hand round the grip under the shelf, the
    // fingers wrapped out of sight round its far side, the thumb along the top ---------------
    const hand = new THREE.Group();
    hand.position.set(HAND[0], HAND[1], HAND[2]);
    hand.scale.setScalar(HAND_S);
    rig.add(hand);
    // Smooth capsules, no knuckle detail, as in the recording: the back of the hand rising from
    // the wrist to the grip, the fingers across the front of the grip, the thumb along the top.
    // A capsule between two points (z can differ: fingers curl away behind the grip).
    const cap = (r, a, b, flat = 0.8) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const len = A.distanceTo(B);
      const c = new THREE.Mesh(g(new THREE.CapsuleGeometry(r, len, 8, 16)), M.skin);
      c.position.copy(A).add(B).multiplyScalar(0.5);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      c.scale.set(1, 1, flat);
      hand.add(c);
      return c;
    };
    cap(0.3, [-1.15, -0.85, 0.32], [-0.55, -0.4, 0.36], 0.75);           // the wrist into the hand
    // The back of the hand: a smooth, flattish slab facing the eye, knuckle edge toward the grip.
    const bs = new THREE.Shape();
    const bw = 0.42, bh = 0.36, br = 0.18;
    bs.moveTo(-bw + br, -bh); bs.lineTo(bw - br, -bh); bs.quadraticCurveTo(bw, -bh, bw, -bh + br);
    bs.lineTo(bw, bh - br); bs.quadraticCurveTo(bw, bh, bw - br, bh); bs.lineTo(-bw + br, bh);
    bs.quadraticCurveTo(-bw, bh, -bw, bh - br); bs.lineTo(-bw, -bh + br); bs.quadraticCurveTo(-bw, -bh, -bw + br, -bh);
    const backGeo = g(new THREE.ExtrudeGeometry(bs, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 6, curveSegments: 10 }));
    backGeo.translate(0, 0, -0.08);
    const back = new THREE.Mesh(backGeo, M.skin);
    back.rotation.set(-0.15, -0.55, 0.4);
    back.position.set(-0.32, -0.3, 0.36);
    hand.add(back);
    cap(0.25, [-0.3, -0.02, 0.3], [0.12, -0.1, 0.02], 0.85);            // fingers, round the front of the grip
    cap(0.24, [-0.34, -0.34, 0.3], [0.08, -0.44, 0.0], 0.85);
    cap(0.21, [-0.38, -0.62, 0.26], [0.02, -0.72, 0.0], 0.85);
    cap(0.14, [-0.12, 0.26, 0.4], [0.24, 0.32, 0.12], 1);                // the thumb, along the top

    // Everything but the sight's housing, so its parts can be found in one frame.
    const body = new THREE.Group();
    this.body = body;
    for (const ch of [...rig.children]) if (ch !== housing && ch !== tube) body.add(ch);
    mergeByMaterial(THREE, body, g);                // ~50 parts drawn as one mesh per material
    body.scale.setScalar(BODY_S);
    rig.add(body);

    // --- the arrow on the shelf --------------------------------------------------------------------
    // Built along -z from its point at the origin; setPose points it. A white broadhead, a black
    // band behind it, the blue shaft, the black rear half.
    const arrow = new THREE.Group();
    this.arrow = arrow;
    this.scene.add(arrow);
    const L = 16, r = 0.11;
    const seg = (z0, z1, rad, mat) => {
      const c = new THREE.Mesh(g(new THREE.CylinderGeometry(rad, rad, z1 - z0, 14)), mat);
      c.rotation.x = Math.PI / 2;
      c.position.z = (z0 + z1) / 2;
      arrow.add(c);
    };
    seg(0.9, 1.8, r * 1.15, M.black);
    seg(1.8, L * 0.42, r, M.shaft);
    seg(L * 0.42, L, r * 1.04, M.black);
    const point = new THREE.Mesh(g(new THREE.ConeGeometry(r * 1.6, 0.9, 14)), M.blade);
    point.rotation.x = -Math.PI / 2;
    point.position.z = 0.45;
    arrow.add(point);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0.02); bladeShape.lineTo(0.6, 0.12); bladeShape.lineTo(0.9, 0.5); bladeShape.lineTo(0.9, 0.02); bladeShape.closePath();
    const bladeGeo = g(new THREE.ShapeGeometry(bladeShape));
    for (let i = 0; i < 3; i++) {
      const bl = new THREE.Mesh(bladeGeo, M.blade);
      const h = new THREE.Group();
      bl.rotation.y = -Math.PI / 2;
      h.add(bl);
      h.rotation.z = (i * 2 * Math.PI) / 3 + 0.4;
      arrow.add(h);
    }
    const collar = new THREE.Mesh(g(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.08, 14)), M.metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.44;
    arrow.add(collar);

    // --- the sleeve and forearm (view space; setPose stretches them wrist to shoulder) ---------
    this.sleeve = new THREE.Mesh(g(sleeveGeometry(THREE)), M.sleeve);
    this.scene.add(this.sleeve);
    this.forearm = new THREE.Mesh(g(new THREE.CylinderGeometry(0.42, 0.52, 1, 18, 1, true)), M.skin);
    this.forearm.geometry.rotateX(Math.PI / 2);
    this.forearm.geometry.translate(0, 0, 0.5);
    this.scene.add(this.forearm);
    const cuff = new THREE.Mesh(g(new THREE.TorusGeometry(1, 0.1, 8, 28)), M.sleeve);
    this.cuff = cuff;
    this.scene.add(cuff);
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  setColor(c) { this.M.shaft.color.set(c); }

  layout(w, h) {
    this.w = w; this.h = h;
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.f = (h / 2) / Math.tan((FOV * Math.PI) / 360);
  }

  /** Place everything. x, y: the sight's centre on the screen (CSS px); r: its inner radius
   *  (px); rot: degrees, clockwise; p: 0 (bow down) .. 1 (drawn); fly: 0..1 the arrow leaving. */
  setPose({ x, y, r, rot = 0, p = 1, fly = 0 }) {
    const T = this.T, [a, b, c, d] = this._v;
    const depth = (SIGHT_R * this.f) / Math.max(1, r);
    const rig = this.rig;
    rig.position.set(((x - this.w / 2) / this.f) * depth, (-(y - this.h / 2) / this.f) * depth, -depth);
    rig.rotation.set(0.05, 0.22 + 0.3 * (1 - p), (-rot * Math.PI) / 180, 'ZYX');
    rig.updateMatrixWorld(true);
    // The arrow: from the nock by the face, through the rest, its point a little past the shelf.
    const nk = NOCK.idle.map((v, i) => v + (NOCK.drawn[i] - v) * p);
    a.set(nk[0], nk[1], nk[2]);
    b.set(...REST);
    this.body.localToWorld(b);
    c.copy(b).sub(a).normalize();                  // nock -> rest: the way it points
    d.copy(b).addScaledVector(c, 4.0 + fly * 60);   // the point
    this.arrow.position.copy(d);
    this.arrow.lookAt(d.clone().sub(c));             // +z back toward the nock
    this.arrow.visible = fly < 0.9;
    // The arm: wrist to shoulder, the sleeve starting a little up the forearm.
    a.set(...WRIST);
    this.body.localToWorld(a);
    b.set(...SHOULDER);
    const len = a.distanceTo(b);
    const fore = 5.2 - 2.4 * p;                     // forearm showing before the cuff
    c.copy(b).sub(a).normalize();
    d.copy(a).addScaledVector(c, fore);
    this.forearm.position.copy(a);
    this.forearm.lookAt(b);
    this.forearm.scale.set(1, 1, fore + 0.3);
    const puff = 0.85 + 0.35 * p;
    this.sleeve.position.copy(d);
    this.sleeve.lookAt(b);
    this.sleeve.scale.set(puff, puff, Math.max(0.5, len - fore - 0.3));
    this.cuff.position.copy(d).addScaledVector(c, 0.12);
    this.cuff.lookAt(b);
    const cr = 0.5 * puff;
    this.cuff.scale.set(cr, cr, 1);
  }
}

/** Replace every mesh under `group` with one mesh per material, in the group's own frame (they
 *  never move relative to each other), so the bow costs a handful of draw calls, not fifty. */
function mergeByMaterial(THREE, group, g) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map();
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  }
  for (const ch of [...group.children]) group.remove(ch);
  for (const [mat, geos] of byMat) {
    const withUv = !!mat.map;
    let n = 0;
    for (const x of geos) n += x.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = withUv ? new Float32Array(n * 2) : null;
    let k = 0;
    for (const x of geos) {
      const c = x.attributes.position.count;
      pos.set(x.attributes.position.array, k * 3);
      if (x.attributes.normal) nor.set(x.attributes.normal.array, k * 3);
      if (uv && x.attributes.uv) uv.set(x.attributes.uv.array, k * 2);
      k += c;
      x.dispose();
    }
    const out = g(new THREE.BufferGeometry());
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    group.add(new THREE.Mesh(out, mat));
  }
}

/** A band of small blue and black checks (where the fork leaves the top block). */
function checks(THREE, track) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 24;
  const c = cv.getContext('2d');
  c.fillStyle = '#123a86'; c.fillRect(0, 0, 128, 24);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) if ((x + y) % 2 === 0) { c.fillStyle = '#3f8ff5'; c.fillRect(x * 8, y * 8, 8, 8); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (track.t) track.t(tex);
  return tex;
}

/** The sleeve: a tube along +z from 0 (the cuff) to 1 (past the shoulder), thicker toward the
 *  shoulder and puffy in the middle, with creases. Radii in bow units; setPose stretches z. */
function sleeveGeometry(THREE) {
  const segT = 12, segA = 11;
  const pos = [], idx = [];
  for (let i = 0; i <= segT; i++) {
    const t = i / segT;
    const base = 0.48 + 0.9 * t + 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.6));
    for (let j = 0; j <= segA; j++) {
      const th = (j / segA) * Math.PI * 2;
      const crease = 1 + 0.07 * Math.sin(t * 23 + th * 2) * Math.max(0, 1 - t * 1.3) + 0.05 * Math.sin(t * 13 - th * 3) + 0.03 * Math.sin(t * 31 + th);
      const rad = base * crease;
      pos.push(Math.cos(th) * rad, Math.sin(th) * rad, t);
    }
  }
  for (let i = 0; i < segT; i++) {
    for (let j = 0; j < segA; j++) {
      const k = i * (segA + 1) + j;
      idx.push(k, k + segA + 1, k + 1, k + 1, k + segA + 1, k + segA + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
