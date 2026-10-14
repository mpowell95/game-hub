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
const WRIST = [-0.3, -3.92, 0.45];        // bow space: where the hand meets the forearm
const REST = [0.95, -1.62, 0.32];         // bow space: where the arrow lies on the shelf
// The arrow's back end (view space), at the drawing hand by the face; with the bow down it is
// lower and further right. The arrow points from here through the rest.
const NOCK = { idle: [5.2, -5.0, -3.0], drawn: [1.8, -2.8, -1.6] };

export class BowView {
  constructor(THREE, track, { env = null, color = '#1f6fe5' } = {}) {
    this.T = THREE;
    const g = (x) => track.g(x), m = (x) => track.m(x);
    this.scene = new THREE.Scene();
    if (env) this.scene.environment = env;
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
    this.scene.add(this.cam);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5c8a4a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.5, 1.0, 0.7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 0.7);
    rim.position.set(0.9, 0.3, -0.6);
    this.scene.add(rim);

    const M = {
      blue: m(new THREE.MeshStandardMaterial({ color: '#2f7ff2', metalness: 0.55, roughness: 0.28, envMapIntensity: 1.2 })),
      blueDark: m(new THREE.MeshStandardMaterial({ color: '#1d5cc4', metalness: 0.55, roughness: 0.32 })),
      black: m(new THREE.MeshStandardMaterial({ color: '#1a1d22', metalness: 0.35, roughness: 0.42 })),
      rubber: m(new THREE.MeshStandardMaterial({ color: '#16181b', metalness: 0.05, roughness: 0.78 })),
      grey: m(new THREE.MeshStandardMaterial({ color: '#59616d', metalness: 0.6, roughness: 0.35 })),
      white: m(new THREE.MeshStandardMaterial({ color: '#f2f5f8', metalness: 0.1, roughness: 0.4 })),
      skin: m(new THREE.MeshStandardMaterial({ color: '#e8b088', metalness: 0, roughness: 0.55, envMapIntensity: 0.7 })),
      sleeve: m(new THREE.MeshStandardMaterial({ color: '#86abdc', metalness: 0, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.6 })),
      shaft: m(new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.35 })),
      metal: m(new THREE.MeshStandardMaterial({ color: '#e3e8ee', metalness: 0.95, roughness: 0.18 })),
    };
    this.M = M;

    // --- the bow ---------------------------------------------------------------------------------
    const rig = new THREE.Group();
    this.rig = rig;
    this.scene.add(rig);
    const ext = (pts, depth, mat, z = 0, bevel = 0.06) => {
      const s = new THREE.Shape();
      pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      s.closePath();
      const geo = g(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 }));
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
    // The top: a big black block with a window in it, and a blue edge, going up off the screen.
    ext([[0.42, 11], [2.24, 11], [2.2, 3.05], [2.04, 2.74], [0.6, 2.74], [0.44, 3.0]], 0.9, M.black);
    ext([[0.4, 11], [0.6, 11], [0.6, 3.0], [0.42, 3.0]], 0.94, M.blue);
    box(0.78, 2.1, 0.1, 1.33, 4.3, 0.52, M.grey);
    box(0.38, 1.7, 0.12, 1.33, 4.3, 0.56, M.rubber);
    box(0.7, 0.1, 0.12, 1.33, 3.2, 0.52, M.white);
    // The fork: two blue arms down to the column, the sky showing between them.
    ext([[0.44, 2.84], [0.98, 2.84], [1.56, 1.04], [1.12, 0.9]], 0.8, M.blue);
    ext([[1.7, 2.84], [2.24, 2.84], [2.08, 0.9], [1.6, 1.04]], 0.8, M.blue);
    // The column, blue with a black strip down its far edge and three white marks.
    ext([[1.08, 1.12], [2.1, 1.12], [2.02, -1.9], [1.1, -1.9]], 0.95, M.blue);
    ext([[1.9, 1.12], [2.1, 1.12], [2.02, -1.9], [1.86, -1.9]], 1.0, M.black);
    for (let i = 0; i < 3; i++) box(0.14, 0.17, 0.04, 1.62, 0.6 - i * 0.3, 0.54, M.white);
    // The sight on a thick black bar from the riser, a small foot under the ring.
    box(0.86, 0.22, 0.24, 0.82, -0.35, 0.05, M.black);
    box(0.22, 0.42, 0.34, 0.47, -0.36, 0.05, M.black);
    box(0.26, 0.14, 0.22, 0.0, -0.58, 0.02, M.black);
    const housing = new THREE.Mesh(g(new THREE.TorusGeometry(0.535, 0.085, 14, 48)), M.black);
    rig.add(housing);
    const tube = new THREE.Mesh(g(new THREE.CylinderGeometry(0.6, 0.6, 0.32, 48, 1, true)), M.black);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -0.17;
    rig.add(tube);
    // The shelf: a blue block sticking out left with a black lip.
    box(1.7, 0.32, 1.05, 1.22, -1.92, 0.12, M.blue);
    box(1.66, 0.22, 1.08, 1.24, -2.18, 0.12, M.black);
    // The grip: thick black rubber, rounded.
    const grip = new THREE.Mesh(g(new THREE.CapsuleGeometry(0.4, 3.6, 8, 18)), M.rubber);
    grip.position.set(0.94, -4.1, 0.02);
    grip.scale.set(1, 1, 1.25);
    rig.add(grip);
    // Below the grip: blue again, a black band and a bolt, down off the screen.
    ext([[0.5, -5.9], [1.5, -5.9], [1.62, -16], [0.5, -16]], 0.85, M.blue);
    ext([[1.36, -5.9], [1.5, -5.9], [1.62, -16], [1.48, -16]], 0.9, M.black);
    box(1.14, 0.34, 0.95, 1.02, -7.6, 0, M.black);
    const bolt = new THREE.Mesh(g(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16)), M.grey);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(0.98, -6.7, 0.5);
    rig.add(bolt);

    // --- the left hand: a fist round the grip, seen from the back ------------------------------
    const hand = new THREE.Group();
    hand.position.set(0.94, -3.35, 0.02);
    hand.scale.setScalar(1.18);
    rig.add(hand);
    // Four fingers wrap the grip (part rings round its axis), the back of the hand on the near
    // side with its knuckles toward the eye, the thumb over the top under the shelf.
    const fingerGeo = g(new THREE.TorusGeometry(0.5, 0.19, 10, 20, Math.PI * 0.9));
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fingerGeo, M.skin);
      f.rotation.x = Math.PI / 2;
      f.rotation.z = Math.PI * 0.95;
      f.position.set(0.02, 0.62 - i * 0.31, 0);
      f.scale.set(1 - i * 0.05, 1 - i * 0.05, 1);
      hand.add(f);
      const knuckle = new THREE.Mesh(g(new THREE.SphereGeometry(0.23, 14, 10)), M.skin);
      knuckle.position.set(-0.45 + i * 0.03, 0.62 - i * 0.31, 0.36);
      hand.add(knuckle);
    }
    const back = new THREE.Mesh(g(new THREE.SphereGeometry(0.62, 20, 14)), M.skin);
    back.scale.set(0.85, 1.12, 0.85);
    back.position.set(-0.72, 0.12, 0.4);
    hand.add(back);
    const thumb = new THREE.Mesh(g(new THREE.CapsuleGeometry(0.19, 0.5, 6, 12)), M.skin);
    thumb.rotation.z = Math.PI / 2 - 0.12;
    thumb.rotation.y = -1.0;
    thumb.position.set(-0.15, 0.92, 0.38);
    hand.add(thumb);
    const wrist = new THREE.Mesh(g(new THREE.CylinderGeometry(0.42, 0.48, 1.2, 16)), M.skin);
    wrist.position.set(-0.95, -0.45, 0.4);
    wrist.rotation.z = 0.75;
    hand.add(wrist);

    // --- the arrow on the shelf --------------------------------------------------------------------
    // Built along -z from its point at the origin; setPose points it.
    const arrow = new THREE.Group();
    this.arrow = arrow;
    this.scene.add(arrow);
    const L = 16, r = 0.11;
    const shaft = new THREE.Mesh(g(new THREE.CylinderGeometry(r, r, L * 0.42, 14)), M.shaft);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = L * 0.21 + 0.32;
    arrow.add(shaft);
    const rear = new THREE.Mesh(g(new THREE.CylinderGeometry(r * 1.02, r * 1.02, L * 0.58, 14)), M.black);
    rear.rotation.x = Math.PI / 2;
    rear.position.z = L * 0.42 + 0.32 + L * 0.29;
    arrow.add(rear);
    const point = new THREE.Mesh(g(new THREE.ConeGeometry(r * 1.25, 0.34, 14)), M.metal);
    point.rotation.x = -Math.PI / 2;
    point.position.z = 0.17;
    arrow.add(point);
    const collar = new THREE.Mesh(g(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.16, 14)), M.metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.4;
    arrow.add(collar);

    // --- the sleeve and forearm (view space; setPose stretches them wrist to shoulder) ---------
    this.sleeve = new THREE.Mesh(g(sleeveGeometry(THREE)), M.sleeve);
    this.scene.add(this.sleeve);
    this.forearm = new THREE.Mesh(g(new THREE.CylinderGeometry(0.26, 0.3, 1, 18, 1, true)), M.skin);
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
    rig.rotation.set(0.05, 0.32, (-rot * Math.PI) / 180, 'ZYX');
    rig.updateMatrixWorld(true);
    // The arrow: from the nock by the face, through the rest, its point a little past the shelf.
    const nk = NOCK.idle.map((v, i) => v + (NOCK.drawn[i] - v) * p);
    a.set(nk[0], nk[1], nk[2]);
    b.set(...REST);
    rig.localToWorld(b);
    c.copy(b).sub(a).normalize();                  // nock -> rest: the way it points
    d.copy(b).addScaledVector(c, 2.4 + fly * 60);   // the point
    this.arrow.position.copy(d);
    this.arrow.lookAt(d.clone().sub(c));             // +z back toward the nock
    this.arrow.visible = fly < 0.9;
    // The arm: wrist to shoulder, the sleeve starting a little up the forearm.
    a.set(...WRIST);
    rig.localToWorld(a);
    b.set(...SHOULDER);
    const len = a.distanceTo(b);
    const fore = 4.2 - 3.9 * p;                     // forearm showing before the cuff
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
    const cr = 0.58 * puff;
    this.cuff.scale.set(cr, cr, 1);
  }
}

/** The sleeve: a tube along +z from 0 (the cuff) to 1 (past the shoulder), thicker toward the
 *  shoulder and puffy in the middle, with creases. Radii in bow units; setPose stretches z. */
function sleeveGeometry(THREE) {
  const segT = 40, segA = 32;
  const pos = [], idx = [];
  for (let i = 0; i <= segT; i++) {
    const t = i / segT;
    const base = 0.56 + 0.9 * t + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.6));
    for (let j = 0; j <= segA; j++) {
      const th = (j / segA) * Math.PI * 2;
      const crease = 1 + 0.09 * Math.sin(t * 30 + th * 2) * Math.max(0, 1 - t * 1.3) + 0.05 * Math.sin(t * 17 - th * 3) + 0.03 * Math.sin(t * 47 + th);
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
