// pinball/js/render-rainbow.js - the RAINBOW board in three dimensions.
//
// IT SUBCLASSES STARHUB'S RENDERER rather than starting again, and that is the whole design of this
// file. js/render3d.js already carries the parts that are hard and board-independent: the camera
// framing (bisection on projected corners, then a film-back re-centre - trigonometry does not work
// for a tilted camera and a build proved it), the confetti thrown clear of the machine's
// silhouette, the backglass with its resting face, the painted contact shadow under each ball, the
// screen shake, the software-GL probe and dispose(). None of that is about STARHUB.
//
// What IS about STARHUB is `_build` and `render`, and those are the two things overridden here.
//
// THE LOOK IS THE REFERENCE'S, NOT STARHUB'S. Matt's call, and this repo's standing rule that a
// clone reproduces its source: blonde maple deck with real grain, dark wood side rails, red-and-
// cream flippers, red-and-white standup targets, olive rubber discs, white nylon posts, starburst
// pop bumpers with a black spiked crown, translucent green kites, and the three rows of coloured
// rollovers the board is named for. No neon, no violet, none of STARHUB's palette.
//
// ONE THING IS DELIBERATELY NOT REPRODUCED: the raised upper playfield. The reference's top third
// stands proud of the deck on a wooden shelf. The physics here is two-dimensional - one plane, one
// ball height - so a raised slab would swallow the ball whenever it went up there, which is a
// worse fault than a flat shelf. The shelf is drawn as a lighter wood panel with a lip along its
// shoulders instead, and the ball stays visible everywhere.

import * as THREE from './vendor/three.module.min.js';
import { Renderer } from './render3d.js';
import T, {
  W, H, AXIS, DRAIN_Y, ART, FLIP, UPPER, PLUNGER, SCOOP, POPS, ROWS, mx,
} from './table-rainbow.js';

const TAU = Math.PI * 2;
const tz = (y) => -y;
const ty = (a) => a;
const K = 666.67;
const mm = (metres) => metres * K;

/** The reference's palette, read off the render. */
const C = {
  wood: 0xd7a463,
  woodLip: 0xa9743c,
  rail: 0x8a5a2b,
  cream: 0xf3ead0,
  red: 0xc0272d,
  olive: 0x5d6b2f,
  green: 0x3fd23f,
  nylon: 0xe6e8ec,
  chrome: 0xd2d7de,
  steel: 0x9aa1ad,
  crown: 0x1a1a1a,
  lamp: 0xfff3c4,
  purple: 0xd132d1,
  blue: 0x2f6fe0,
  dotRed: 0xdc2a2a,
  yellow: 0xe8e02a,
  pit: 0x2a1a10,
  grey: 0x8f959e,
};

export class RainbowRenderer extends Renderer {
  // --- materials -------------------------------------------------------------------------------
  // The base class's set is kept (the ball, the shadow, the chrome the backglass frame uses) and
  // this board's own are added on top.
  _materials() {
    const M = super._materials();
    const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color }, o));
    M.wood = std(0xffffff, { roughness: 0.72, metalness: 0.02 });   // takes the grain texture
    M.woodLip = std(C.woodLip, { roughness: 0.66 });
    M.rail = std(C.rail, { roughness: 0.6 });
    M.cream = std(C.cream, { roughness: 0.42 });
    M.redPart = std(C.red, { roughness: 0.4 });
    M.olive = std(C.olive, { roughness: 0.7 });
    M.kite = std(C.green, { roughness: 0.25, transparent: true, opacity: 0.72, emissive: C.green, emissiveIntensity: 0.35 });
    M.nylon = std(C.nylon, { roughness: 0.34, metalness: 0.04 });
    M.crown = std(C.crown, { roughness: 0.55 });
    M.lamp = std(C.lamp, { roughness: 0.3, emissive: C.lamp, emissiveIntensity: 0.8 });
    M.pit = std(C.pit, { roughness: 0.9 });
    M.greyLane = std(C.grey, { roughness: 0.5, metalness: 0.2 });
    M.dotPurple = std(C.purple, { roughness: 0.34, emissive: C.purple, emissiveIntensity: 0.3 });
    M.dotBlue = std(C.blue, { roughness: 0.34, emissive: C.blue, emissiveIntensity: 0.3 });
    M.dotRed = std(C.dotRed, { roughness: 0.34, emissive: C.dotRed, emissiveIntensity: 0.3 });
    M.dotYellow = std(C.yellow, { roughness: 0.34, emissive: C.yellow, emissiveIntensity: 0.3 });
    return M;
  }

  /**
   * The maple deck, painted.
   *
   * Same technique as STARHUB's print and the same two UV facts: ExtrudeGeometry hands the top face
   * uv = the shape's own (x, y), so one repeat of 1/W by 1/H maps the whole sheet on, and `flipY`
   * must be false because table y and canvas y both run downward.
   */
  _woodTexture() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 2048;
    const g = cv.getContext('2d');
    g.scale(cv.width / W, cv.height / H);

    let grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#e0b177');
    grd.addColorStop(0.45, '#d7a463');
    grd.addColorStop(1, '#c8934f');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    // Grain: long near-vertical strokes with a slow wander. Deterministic, so the deck is the same
    // sheet of wood every load and a screenshot can be compared with the last one.
    let seed = 90812026;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    g.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x0 = rnd() * (W + 60) - 30;
      const dark = rnd() < 0.35;
      g.strokeStyle = dark
        ? 'rgba(120,78,34,' + (0.05 + rnd() * 0.09).toFixed(3) + ')'
        : 'rgba(255,226,182,' + (0.04 + rnd() * 0.08).toFixed(3) + ')';
      g.lineWidth = 0.6 + rnd() * 2.6;
      g.beginPath();
      let x = x0;
      g.moveTo(x, -10);
      for (let y = -10; y < H + 10; y += 26) {
        x += (rnd() - 0.5) * 5;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // A few knots, which is what stops it reading as a printed pattern.
    for (let i = 0; i < 7; i++) {
      const kx = rnd() * W, ky = rnd() * H, kr = 4 + rnd() * 9;
      for (let r = kr; r > 0.8; r -= 1.6) {
        g.strokeStyle = 'rgba(122,80,36,' + (0.05 + rnd() * 0.06).toFixed(3) + ')';
        g.lineWidth = 0.9;
        g.beginPath();
        g.ellipse(kx, ky, r, r * 1.7, 0.3, 0, TAU);
        g.stroke();
      }
    }

    // The upper shelf reads as a slightly paler, separate panel - the reference's raised playfield,
    // drawn rather than built. See the file header.
    g.fillStyle = 'rgba(255,236,198,0.16)';
    g.beginPath();
    g.moveTo(6, 12); g.lineTo(342, 12); g.lineTo(342, 196);
    g.lineTo(mx(72), 232); g.lineTo(72, 232); g.lineTo(6, 196);
    g.closePath(); g.fill();

    // The centre oval, full size, as painted art - the largest single thing on the reference table.
    // The hole that actually captures is much smaller and sits at its middle; see table-rainbow.js.
    {
      const s = SCOOP.paint;
      g.save();
      // Centred on the scoop itself. The +14 offset the first build carried put the painted oval
      // low enough to swallow the bottom pop bumper, and the ring that marks the actual hole then
      // sat off-centre in its own artwork.
      g.translate(SCOOP.x, SCOOP.y);
      g.beginPath();
      g.moveTo(0, -s.h / 2);
      g.bezierCurveTo(s.w * 0.30, -s.h * 0.44, s.w * 0.34, -s.h * 0.06, s.w * 0.5, s.h * 0.16);
      g.bezierCurveTo(s.w * 0.60, s.h * 0.42, s.w * 0.30, s.h / 2, 0, s.h / 2);
      g.bezierCurveTo(-s.w * 0.30, s.h / 2, -s.w * 0.60, s.h * 0.42, -s.w * 0.5, s.h * 0.16);
      g.bezierCurveTo(-s.w * 0.34, -s.h * 0.06, -s.w * 0.30, -s.h * 0.44, 0, -s.h / 2);
      g.closePath();
      const og = g.createRadialGradient(0, 0, 6, 0, 0, s.h * 0.5);
      og.addColorStop(0, '#150c06');
      og.addColorStop(1, '#3a2415');
      g.fillStyle = og;
      g.fill();
      g.restore();
    }

    // Faint printed guide arcs behind the three rows, so the rows read as one feature.
    g.strokeStyle = 'rgba(96,60,24,0.16)';
    g.lineWidth = 2;
    for (const n of ['purple', 'blue', 'red']) {
      const row = ROWS[n];
      g.beginPath();
      row.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / W, 1 / H);
    try { tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); } catch { /* default */ }
    this._woodTex = tex;
    return tex;
  }

  /** The deck outline: the reference's rounded body, narrowing to the drain. */
  _deckShape() {
    const s = new THREE.Shape();
    s.moveTo(4, 40);
    s.quadraticCurveTo(4, 8, 40, 8);
    s.lineTo(W - 40, 8);
    s.quadraticCurveTo(W - 4, 8, W - 4, 40);
    s.lineTo(W - 4, 556);
    s.lineTo(W - 118, DRAIN_Y + 30);
    s.lineTo(118, DRAIN_Y + 30);
    s.lineTo(4, 556);
    s.closePath();
    return s;
  }

  // --- the board ---------------------------------------------------------------------------------

  _build(root) {
    const M = this.M;
    M.wood.map = this._woodTexture();
    this.parts3 = this.parts3 || {};

    // Every rollover on this board gets its own pulse channel, keyed by the switch id the rules
    // emit. The base class set up STARHUB's three lanes; this replaces them.
    this.lanePulse = {};
    for (const s of T.SWITCHES) if (s.row) this.lanePulse[s.id] = 0;

    // --- the cabinet and the deck ----------------------------------------------------------------
    const outline = this._deckShape().getPoints(200).map((p) => [p.x, p.y]);
    outline.push(outline[0]);
    this._rail(root, outline, 13, mm(0.09), M.rail, -mm(0.02));
    this._flat(root, this._deckShape(), mm(0.02), M.wood, -mm(0.02));

    // The dark wooden rails across the very top, which is what the reference shows above the
    // standup clusters.
    this._rail(root, [[8, 18], [340, 18]], 14, mm(0.055), M.rail, 0);

    // --- the walls the ball actually touches -------------------------------------------------------
    const WALL_H = mm(0.05);
    this._rail(root, ART.wallTop, 6, WALL_H, M.steel);
    this._rail(root, ART.wallL, 6, WALL_H, M.steel);
    this._rail(root, ART.wallR, 6, WALL_H, M.steel);
    for (const sh of ART.shelves) this._rail(root, sh, 7, mm(0.03), M.woodLip);
    for (const gd of ART.guides) this._rail(root, gd, 5, mm(0.04), M.chrome);
    for (const d of ART.divs) this._rail(root, d, 7, WALL_H, M.chrome);

    // --- the shooter lane ---------------------------------------------------------------------------
    // The reference's grey strip down the right, walled off from the playfield.
    {
      const s = new THREE.Shape();
      s.moveTo(ART.laneX + 4, 92); s.lineTo(340, 92);
      s.lineTo(340, 640); s.lineTo(ART.laneX + 4, 640); s.closePath();
      this._flat(root, s, 1.2, M.greyLane, mm(0.02));
      this._rail(root, [[ART.laneX, 96], [ART.laneX, 636]], 6, WALL_H, M.steel);
      this._rail(root, [[ART.laneX + 2, 60], [300, 40]], 5, mm(0.03), M.chrome);
    }

    // --- the two wooden corner holes ------------------------------------------------------------------
    for (const [x, y] of ART.cornerHoles) {
      this._add(root, new THREE.CylinderGeometry(12, 12, 3, 22), M.woodLip, x, 1.4, tz(y));
      const ring = this._add(root, new THREE.TorusGeometry(12, 2, 8, 24), M.chrome, x, 2.4, tz(y));
      ring.rotation.x = Math.PI / 2;
    }

    // --- the drop target bank ---------------------------------------------------------------------------
    // White faces with a red pattern, in a steel frame, sinking into the deck when they drop.
    this.parts3.drops = [];
    {
      const b = ART.bank;
      const step = b.w / ART.dropCount;
      this._add(root, new THREE.BoxGeometry(b.w + 10, 5, 13), M.steel, b.x, 2.5, tz(b.y));
      for (let i = 0; i < ART.dropCount; i++) {
        const x = b.x - b.w / 2 + step * (i + 0.5);
        const face = this._add(root, new THREE.BoxGeometry(step - 3, 20, 4), M.cream, x, 14, tz(b.y));
        const stripe = this._add(root, new THREE.BoxGeometry(step - 9, 5, 4.6), M.redPart, x, 14, tz(b.y));
        this.parts3.drops.push({ face, stripe });
      }
    }

    // --- standups, rubbers, yellows, posts ------------------------------------------------------------------
    // Red base, white cap: the reference's standup targets, which are the most numerous thing on it.
    this.parts3.standups = ART.standups.map(([x, y]) => {
      const g = new THREE.Group();
      g.position.set(x, 0, tz(y));
      root.add(g);
      this._add(g, new THREE.CylinderGeometry(7, 7.6, 16, 16), M.redPart, 0, 8, 0);
      const cap = this._add(g, new THREE.CylinderGeometry(7.2, 7.2, 5, 16), M.cream, 0, 18, 0);
      return cap;
    });
    for (const [x, y] of ART.rubbers) {
      this._add(root, new THREE.CylinderGeometry(9, 9, 6, 18), M.olive, x, 3, tz(y));
    }
    this.parts3.yellows = ART.yellows.map(([x, y]) => (
      this._add(root, new THREE.CylinderGeometry(6.5, 6.5, 9, 16), M.dotYellow, x, 4.5, tz(y))
    ));
    for (const [x, y] of ART.posts) {
      const g = new THREE.Group();
      g.position.set(x, 0, tz(y));
      root.add(g);
      this._add(g, new THREE.CylinderGeometry(5, 6.5, 26, 14), M.nylon, 0, 13, 0);
      const ring = this._add(g, new THREE.TorusGeometry(7, 2.4, 8, 16), M.nylon, 0, 22, 0);
      ring.rotation.x = Math.PI / 2;
    }

    // --- the starburst pop bumpers ---------------------------------------------------------------------------
    // A white skirt, a black spiked crown, and a lamp under a cream dome. The spikes are what makes
    // this board's bumpers read as ITS bumpers rather than as any three mushrooms.
    this.parts3.pops = POPS.map(([x, y, R]) => {
      const g = new THREE.Group();
      g.position.set(x, 0, tz(y));
      root.add(g);
      this._add(g, new THREE.CylinderGeometry(R + 9, R + 11, 5, 30), M.nylon, 0, 2.5, 0);
      // the black crown: eighteen tapered spikes round the rim
      for (let i = 0; i < 18; i++) {
        const a = i * TAU / 18;
        const sp = this._add(g, new THREE.ConeGeometry(3.4, 13, 4),
          M.crown, Math.cos(a) * (R - 1), 8, Math.sin(a) * (R - 1));
        sp.rotation.y = -a;
        sp.rotation.x = Math.PI / 2 - 0.5;
      }
      const lamp = this._add(g, new THREE.CylinderGeometry(R - 7, R - 7, 6, 28), M.lamp, 0, 7, 0);
      this._add(g, new THREE.CylinderGeometry(5, 5, 22, 12), M.nylon, 0, 17, 0);
      const cap = this._add(g, new THREE.SphereGeometry(R * 0.72, 24, 12, 0, TAU, 0, Math.PI / 2),
        M.cream, 0, 27, 0);
      cap.scale.y = 0.6;
      return { g, cap, lamp };
    });

    // --- the green kites -------------------------------------------------------------------------------------
    // Two one-way gates up top and the two slingshots above the flippers, all drawn as the
    // reference's translucent green wedges.
    const kite = (x, y, rot, len) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, -len / 2); sh.lineTo(13, len / 2); sh.lineTo(-6, len * 0.32); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: mm(0.026), bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.M.kite);
      m.position.set(x, 0, tz(y));
      m.rotation.y = ty(rot);
      root.add(m);
      return m;
    };
    this.parts3.gates = ART.gates.map((p, i) => kite(p[0], p[1], i ? -0.5 : 0.5, 34));
    this.parts3.slings = ART.slings.map((s, i) => {
      const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
      const ang = Math.atan2(by - ay, bx - ax);
      const m = kite((ax + bx) / 2, (ay + by) / 2, ang + Math.PI / 2, Math.hypot(bx - ax, by - ay));
      const band = this._rail(root, [[ax, ay], [bx, by]], 8, mm(0.028), this.M.crown, mm(0.004));
      return { kite: m, band };
    });

    // --- the rainbow rows ------------------------------------------------------------------------------------
    // Rollover lenses, not colliders. Each one is its own mesh so a lit dot can be told from an
    // unlit one, which is the whole feedback loop for the board's headline shot.
    this.parts3.dots = {};
    const dotMat = { purple: M.dotPurple, blue: M.dotBlue, red: M.dotRed };
    for (const name of ['purple', 'blue', 'red']) {
      ROWS[name].forEach((p, i) => {
        const id = (name === 'purple' ? 'p' : name === 'blue' ? 'b' : 'r') + i;
        const m = this._add(root, new THREE.SphereGeometry(9, 20, 12, 0, TAU, 0, Math.PI / 2),
          dotMat[name].clone(), p[0], 1, tz(p[1]));
        m.scale.y = 0.52;
        this.parts3.dots[id] = m;
      });
    }

    // NO HARDWARE IN THE CENTRE OVAL. It is print, drawn into the deck texture above, and that is
    // all the reference has there - see table-rainbow.js's SCOOP comment for what was removed and
    // why the scoop it replaced could not work.

    // --- the flippers -------------------------------------------------------------------------------------------
    // Red bat, cream top face, the reference's own colours. Four of them: two main, two upper.
    const bat = (parent, len, r) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, r);
      sh.lineTo(len - 8, r * 0.6);
      sh.quadraticCurveTo(len, 0, len - 8, -r * 0.6);
      sh.lineTo(0, -r);
      sh.absarc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
      this._flat(parent, sh, mm(0.02), this.M.redPart, 0);
      const top = this._flat(parent, sh, mm(0.007), this.M.cream, mm(0.02));
      top.scale.set(0.95, 1, 0.7);
      this._add(parent, new THREE.CylinderGeometry(4, 4, 22, 12), this.M.chrome, 0, 11, 0);
    };
    this.parts3.flippers = [];
    for (const spec of [
      { x: AXIS - FLIP.dx, y: FLIP.pivotY, len: FLIP.len, r: FLIP.r },
      { x: AXIS + FLIP.dx, y: FLIP.pivotY, len: FLIP.len, r: FLIP.r },
      { x: AXIS - UPPER.dx, y: UPPER.pivotY, len: UPPER.len, r: UPPER.r },
      { x: AXIS + UPPER.dx, y: UPPER.pivotY, len: UPPER.len, r: UPPER.r },
    ]) {
      const g = new THREE.Group();
      g.position.set(spec.x, mm(0.004), tz(spec.y));
      root.add(g);
      bat(g, spec.len, spec.r);
      this.parts3.flippers.push(g);
    }

    // --- the plunger ------------------------------------------------------------------------------------------------
    {
      const g = new THREE.Group();
      g.position.set(PLUNGER.x, 0, tz(PLUNGER.y + 26));
      root.add(g);
      const rod = this._add(g, new THREE.CylinderGeometry(3.5, 3.5, 80, 10), M.chrome, 0, 11, 26);
      rod.rotation.x = Math.PI / 2;
      const tip = this._add(g, new THREE.CylinderGeometry(8, 8, 8, 16), M.redPart, 0, 11, -12);
      tip.rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        this._add(g, new THREE.TorusGeometry(8, 1.7, 6, 16), M.steel, 0, 11, 8 + i * 6);
      }
      this.parts3.plunger = g;
    }

    // --- the apron --------------------------------------------------------------------------------------------------
    for (const side of [-1, 1]) {
      const x0 = AXIS + side * 34, x1 = AXIS + side * 140;
      const sh = new THREE.Shape();
      sh.moveTo(x0, DRAIN_Y + 28);
      sh.lineTo(x1, DRAIN_Y + 28);
      sh.lineTo(x1, DRAIN_Y - 10);
      sh.lineTo(x0, DRAIN_Y + 10);
      sh.closePath();
      this._flat(root, sh, 5, M.woodLip, 0);
      this._rail(root, [[x0, DRAIN_Y + 10], [x1, DRAIN_Y - 10]], 4, mm(0.014), M.chrome, 5);
    }

    this._buildBackglass(root);
    this._buildBalls(root);
  }

  // --- the frame ---------------------------------------------------------------------------------------------------

  render(game, dt) {
    if (!this.ok) return;
    this.time += dt;
    this._age(dt);
    const hud = game.hud();
    const P = this.parts3;

    for (let i = 0; i < P.flippers.length && i < game.flippers.length; i++) {
      P.flippers[i].rotation.y = ty(game.flippers[i].angle);
    }

    P.pops.forEach((p, i) => {
      const k = this.popPulse[i] || 0;
      p.cap.position.y = 27 - k * 5;
      p.lamp.material.emissiveIntensity = 0.8 + k * 1.6;
    });

    P.slings.forEach((s, i) => {
      const k = this.slingPulse[i] || 0;
      s.kite.material.emissiveIntensity = 0.35 + k * 1.5;
      s.band.scale.set(1 + k * 0.06, 1, 1);
    });

    // drop targets sink when they are down
    for (let i = 0; i < P.drops.length; i++) {
      const down = hud.down && hud.down.has(`drop${i}`);
      this.dropAnim[i] += ((down ? 1 : 0) - this.dropAnim[i]) * Math.min(1, dt * 14);
      const y = 14 - this.dropAnim[i] * 22;
      P.drops[i].face.position.y = y;
      P.drops[i].stripe.position.y = y;
    }

    // The rows: a dot that is LIT this pass burns; the rest sit dark. During multiball every dot
    // is a jackpot, so they all pulse together.
    const pulse = 0.55 + Math.sin(this.time * 6) * 0.45;
    for (const s of T.SWITCHES) {
      if (!s.row) continue;
      const m = P.dots[s.id];
      if (!m) continue;
      const lit = hud.multiball || (hud.rowLit && hud.rowLit[s.row] && hud.rowLit[s.row].has(s.id));
      const hit = this.lanePulse[s.id] || 0;
      m.material.emissiveIntensity = (lit ? 0.85 + pulse * 0.7 : 0.28) + hit * 1.2;
      m.position.y = 1 + hit * 2;
    }

    P.yellows.forEach((m) => { m.material.emissiveIntensity = 0.3 + (hud.save > 0 ? pulse * 0.5 : 0); });
    for (const g of P.gates) g.material.emissiveIntensity = 0.35 + (hud.locks > 0 ? pulse * 0.8 : 0);

    // balls
    let n = 0;
    for (const b of game.balls) {
      if (!b.live || n >= P.balls.length) continue;
      const m = P.balls[n++];
      const sh = P.ballShadows[n - 1];
      m.visible = true;
      m.position.set(b.x, 9, tz(b.y));
      sh.visible = true;
      sh.position.set(b.x, 0.9, tz(b.y));
      sh.scale.setScalar(1);
      sh.material.opacity = 1;
    }
    for (let i = n; i < P.balls.length; i++) {
      P.balls[i].visible = false;
      P.ballShadows[i].visible = false;
    }

    if (this.shake > 0.05) {
      const s = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    const sig = hud.score + '|' + hud.ball + '|' + hud.mult + '|' + hud.multiball + '|' + hud.locks;
    if (sig !== this._bbSig) {
      this._bbAge = (this._bbAge || 0) + dt;
      if (this._bbAge > 0.08) { this._bbAge = 0; this._bbSig = sig; this._bbDirty = true; }
    }
    if (this._bbDirty) { this._bbDirty = false; this._drawBackglass(hud); }
    this.renderer.render(this.scene, this.camera);
    this._drawFx(hud);
  }

  // --- effects the base class routes here --------------------------------------------------------------------------

  /** This board has no spinner and no ramp; the two hooks exist because ui.js is board-agnostic. */
  hitSpinner() { /* no spinner on this board */ }
  hitRamp() { /* no ramp on this board */ }
}

export default { RainbowRenderer };
