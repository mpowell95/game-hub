// render.js — maps sim.js's plain-data state onto pooled Three.js objects every
// animation frame (brief section 3, non-negotiables 2 and 3). No game logic
// lives here: this module only reads Sim/Track data and positions meshes.
// All meshes/geometries/materials/textures are created once at load and reused;
// nothing here allocates per frame.

import * as THREE from '../vendor/three.module.min.js';
import {
  SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND, BALL_RADIUS, BALL_DIAMETER, OBSTACLE_SIZE, TILE_SIZE,
  CAMERA_LAG, CAMERA_LAG_HZ, CAMERA_HEIGHT, CAMERA_BACK, CAMERA_LOOK_AHEAD, CAMERA_LOOK_HEIGHT_FRAC,
  CAMERA_BASE_FOV, CAMERA_MAX_FOV_KICK, CRASH_SHAKE_MS, mapConfig,
  CUE_COLORS, DECK_DEPTH, CUE_FADE_NEAR, CUE_FADE_FAR, RUNUP_SEGS,
} from './config.js';

const FLOOR_POOL_SIZE = SEGMENTS_AHEAD + SEGMENTS_BEHIND;
const WALL_POOL_SIZE = (SEGMENTS_AHEAD + SEGMENTS_BEHIND) * 2; // left + right per segment
const OBSTACLE_POOL_SIZE = 24;
// Pickups (Phase 4, Orbital only): sparse compared to obstacles (30m+ mean cadence vs. tight
// obstacle spacing), so a small pool comfortably covers everything ever visible in the render
// window at once. Two separate pools (not one shared one) since each pickup type is its own
// GEOMETRY, not just a color swap - a sphere for orbs, a heart for the rarer life pickup
// (root CLAUDE.md's colorblind rule: shape marker, never hue alone - and a heart reads as
// "life" on sight, no legend needed).
const ORB_POOL_SIZE = 6;
const LIFE_POOL_SIZE = 2;

/** A small extruded heart, built from a parametric 2D outline (two lobes + a point), the same
 *  "no image assets, everything procedural" discipline the canvas textures elsewhere in this
 *  file already follow. `size` is roughly the heart's overall width. */
function buildHeartGeometry(size) {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -s * 0.9);
  shape.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 1.1, s * 0.75, -s * 0.5, s * 0.75);
  shape.bezierCurveTo(-s * 0.15, s * 0.75, 0, s * 0.4, 0, s * 0.15);
  shape.bezierCurveTo(0, s * 0.4, s * 0.15, s * 0.75, s * 0.5, s * 0.75);
  shape.bezierCurveTo(s * 1.1, s * 0.75, s * 1.3, -s * 0.1, 0, -s * 0.9);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: size * 0.35, bevelEnabled: true, bevelThickness: size * 0.06, bevelSize: size * 0.06, bevelSegments: 2,
  });
  geo.center();
  return geo;
}
// Split (Orbital only, BALLRUNMAP2ORBITALSPEC.md section 2): a void-bearing segment renders as
// TWO floor strips instead of one, so every floor slot gets a second, independently-scaled quad
// (floorPool2, hidden whenever that slot's segment has no void - i.e. always, on Classic). Also
// up to 2 thin amber accent lines per slot: either the Widen-phase telegraph (1 line, at lateral
// 0) or the void band's two inner edges (2 lines) - never both on the same segment.
const ACCENT_POOL_SIZE = FLOOR_POOL_SIZE * 2;

// Jump landing-pad warning gates (Orbital only): tall vertical planes standing at a landing pad's
// left/right edges and, when the pad is itself split, its two void inner edges too - 4 slots
// covers the worst case (a split+narrower landing) with room to spare, and only one landing pad
// is ever in the generation window at a time. Unlike the flat floor accent lines (`accentPool`),
// these stay legible at a distance: a plane roughly facing the camera doesn't foreshorten to
// nothing the way a horizontal floor decal does at a shallow chase-cam angle, which is exactly
// what made a hazardous landing pad unreadable until the player was already airborne and out of
// time to react.
const GATE_POOL_SIZE = 4;

// Hazard and jump cues (admin devices only, see _buildCues).
const STRIPE_LEN = 0.9;          // world units per amber/black stripe pair along a void's lip
const HAZARD_BAND = 0.42;        // width of the striped band on each lip of a void
const TUNNEL_CHEVRON_LEN = 2.5;  // world units per tunnel floor chevron
const ARC_DOTS_PER_LANE = 13;    // flight-arc dots per landing lane (one lane, or two on a split pad)
const ARC_DOTS_MAX = 2 * ARC_DOTS_PER_LANE;

// One repeatable TILE_SIZE-unit tile: grout drawn only on the top/left edges
// so REPEAT-wrapping produces a single continuous grid line per tile boundary
// instead of a doubled-up line (verify-item B: the old texture baked a full
// bordered 2x2 pattern into every segment's plane independent of its world
// size, so segment joins showed as duplicated/misaligned seams - a "venetian
// blind" look instead of one continuous tiled ribbon).
function buildTileTexture(colors) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + colors.trackTile.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#' + colors.trackGrout.toString(16).padStart(6, '0');
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(size, 0);
  ctx.moveTo(0, 0); ctx.lineTo(0, size);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildTunnelFloorTexture(colors, withLabel) {
  const w = 256, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + colors.trackTile.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#' + colors.chevron.toString(16).padStart(6, '0');
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const y = h - 40 - i * 150;
    ctx.beginPath();
    ctx.moveTo(20, y + 60);
    ctx.lineTo(w / 2, y);
    ctx.lineTo(w - 20, y + 60);
    ctx.stroke();
  }
  if (withLabel) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPEED UP', 0, 0);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildTunnelWallTexture(colors) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + colors.tunnelWall.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#' + colors.tunnelEdge.toString(16).padStart(6, '0');
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i <= size; i += size / 4) {
    ctx.moveTo(i, 0); ctx.lineTo(i, size);
    ctx.moveTo(0, i); ctx.lineTo(size, i);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const WHITE = new Float32Array([1, 1, 1]);

/** A fixed-capacity batch of quads rebuilt every frame into ONE dynamic BufferGeometry: one draw
 *  call for the whole batch, no allocation per frame (quad() copies numbers into preallocated
 *  arrays; end() only moves the draw range and flags the attributes). Used by the cue layer.
 *  Every corner's colour is faded toward black by its distance ahead (fadeZ0..fadeZ1), so the deck
 *  dissolves before the generation window ends: per vertex, at no per-pixel cost (a THREE.Fog cost
 *  about 12% of a frame in Chromium's software renderer). */
class QuadBatch {
  constructor(cap, withUv) {
    this.cap = cap;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const nrm = new Float32Array(cap * 12);
    for (let i = 0; i < cap * 4; i++) nrm[i * 3 + 1] = 1; // every lit quad here is a deck top: up
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    this.uv = null;
    if (withUv) {
      this.uv = new Float32Array(cap * 8);
      this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    }
    this.col = new Float32Array(cap * 12);
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.fadeZ0 = Infinity; // full colour before this z
    this.fadeZ1 = Infinity; // black from this z
    // Quad corners 0 near-left, 1 near-right, 2 far-right, 3 far-left; wound so a deck top faces up.
    const idx = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 2; idx[i * 6 + 2] = i * 4 + 1;
      idx[i * 6 + 3] = i * 4; idx[i * 6 + 4] = i * 4 + 3; idx[i * 6 + 5] = i * 4 + 2;
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.n = 0;
    this.mesh = null;
  }

  begin() { this.n = 0; }

  /** q: 12 floats (4 corners), t: 8 uvs, c0..c3: linear RGB triplets (Float32Array(3)) per corner,
   *  or null for white (a textured batch). */
  quad(q, t, c0, c1, c2, c3) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set(q, i * 12);
    if (this.uv) this.uv.set(t, i * 8);
    this._corner(i * 12, q[2], c0 || WHITE);
    this._corner(i * 12 + 3, q[5], c1 || WHITE);
    this._corner(i * 12 + 6, q[8], c2 || WHITE);
    this._corner(i * 12 + 9, q[11], c3 || WHITE);
  }

  _corner(o, z, c) {
    const f = z <= this.fadeZ0 ? 1 : z >= this.fadeZ1 ? 0 : (this.fadeZ1 - z) / (this.fadeZ1 - this.fadeZ0);
    this.col[o] = c[0] * f; this.col[o + 1] = c[1] * f; this.col[o + 2] = c[2] * f;
  }

  end() {
    this.geo.setDrawRange(0, this.n * 6);
    if (this.n === 0) return;
    this.geo.attributes.position.needsUpdate = true;
    if (this.uv) this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); }
}

export class Renderer {
  /** `mapKey` selects the map's color set (config.js's `MAPS`) for every texture/material this
   *  renderer builds. Textures/materials are built once, here, in the constructor — a map
   *  change is picked up by tearing down and constructing a fresh Renderer at setup time (ui.js
   *  already does this on every run start/restart), never by mutating an existing one per frame. */
  constructor(canvas, mapKey, opts = {}) {
    this.canvas = canvas;
    this.colors = mapConfig(mapKey).colors;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(this.colors.void, 1);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, 1, 0.1, 200);
    this.camera.position.set(0, CAMERA_HEIGHT, -CAMERA_BACK);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 8, -4);
    this.scene.add(dir);

    // Damped lateral offset the camera tracks (item 1 fix): a lerp toward the ball's TRACK-LOCAL
    // lateralOffset, not a lerp toward raw world X. The camera's world position is then derived
    // from this via the track's own local frame (see _layoutCamera), so it rides the centerline
    // through curves instead of chasing a world-X target that drifts independently of the floor.
    this._camLagLateral = 0;
    this._camLagY = 0; // damped world-height offset (Jump, section 3) - same lerp shape as lateral above
    this._shakeUntil = 0;
    this._shakeSeed = Math.random() * 1000;

    this._buildTextures();
    this._buildBall();
    this._buildFloorPool();
    this._buildWallPool();
    this._buildObstaclePool();
    this._buildAccentPool();
    this._buildGatePool();
    this._buildPickupPools();

    // Hazard and jump cues: ADMIN DEVICES ONLY until Matt says "release it". ui.js reads
    // isAdminDevice() once per run and passes it here; false = exactly the old renderer.
    const mc = mapConfig(mapKey);
    this.cues = !!opts.cues;
    this.deck = this.cues && !!(mc.jump || mc.split); // Orbital: the solid deck, holes, jumps
    this._jumpCfg = mc.jump || null;
    this._cue = null;
    if (this.cues) this._buildCues();
  }

  _buildTextures() {
    const colors = this.colors;
    this.tileTex = buildTileTexture(colors);
    this.tunnelFloorTex = buildTunnelFloorTexture(colors, false);
    this.tunnelFloorLabelTex = buildTunnelFloorTexture(colors, true);
    this.tunnelWallTex = buildTunnelWallTexture(colors);
  }

  _buildBall() {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: this.colors.ball, roughness: 0.3, metalness: 0.15 });
    this.ball = new THREE.Mesh(geo, mat);
    this.ball.position.set(0, BALL_RADIUS, 0);
    this.scene.add(this.ball);
    this._ballGeo = geo; this._ballMat = mat;

    const shadowGeo = new THREE.CircleGeometry(BALL_RADIUS * 0.9, 20);
    const shadowMat = new THREE.MeshBasicMaterial({ color: this.colors.shadow, transparent: true, opacity: 0.35 });
    this.ballShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.set(0, 0.02, 0);
    this.scene.add(this.ballShadow);
    this._shadowGeo = shadowGeo; this._shadowMat = shadowMat;
  }

  _buildFloorPool() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._floorGeo = geo;
    this.floorMat = new THREE.MeshStandardMaterial({ map: this.tileTex, roughness: 0.85, metalness: 0.05 });
    this.tunnelFloorMat = new THREE.MeshStandardMaterial({ map: this.tunnelFloorTex, roughness: 0.7, metalness: 0.05 });
    this.tunnelFloorLabelMat = new THREE.MeshStandardMaterial({ map: this.tunnelFloorLabelTex, roughness: 0.7, metalness: 0.05 });
    // Each plain-floor slot gets its own cloned texture (same canvas image,
    // independent repeat/offset) so the grid can be scaled to the segment's
    // real world size and phase-aligned to world Z. Built once here, not
    // per frame; _layoutFloor only mutates the existing repeat/offset Vector2s.
    this.floorTexPool = [];
    this.floorMatPool = [];
    this.floorPool = [];
    // Second pool, paired index-for-index with the one above: the RIGHT strip of a void-bearing
    // segment (floorPool[i] becomes the LEFT strip in that case). Hidden whenever slot i's segment
    // has no void - which is every segment on Classic and most of Orbital's too, so this never
    // shows up as extra draw calls outside an actual Split event.
    this.floorTexPool2 = [];
    this.floorMatPool2 = [];
    this.floorPool2 = [];
    for (let i = 0; i < FLOOR_POOL_SIZE; i++) {
      const tex = this.tileTex.clone();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      const mat = this.floorMat.clone();
      mat.map = tex;
      this.floorTexPool.push(tex);
      this.floorMatPool.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.floorPool.push(mesh);

      const tex2 = this.tileTex.clone();
      tex2.wrapS = tex2.wrapT = THREE.RepeatWrapping;
      tex2.needsUpdate = true;
      const mat2 = this.floorMat.clone();
      mat2.map = tex2;
      this.floorTexPool2.push(tex2);
      this.floorMatPool2.push(mat2);
      const mesh2 = new THREE.Mesh(geo, mat2);
      mesh2.rotation.x = -Math.PI / 2;
      mesh2.visible = false;
      this.scene.add(mesh2);
      this.floorPool2.push(mesh2);
    }
  }

  /** Thin amber emissive strips (Split only, section 2): the Widen-phase telegraph divider at
   *  lateral 0, and the void band's two inner edges once it's open ("Same amber stripe on both
   *  inner edges of the void band", section 5). One flat, unlit-by-scene-lights material shared by
   *  the whole pool - these are pure attention markers, not surfaces that need shading. */
  _buildAccentPool() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._accentGeo = geo;
    this.accentMat = new THREE.MeshBasicMaterial({ color: this.colors.obstacleEdge });
    this.accentPool = [];
    for (let i = 0; i < ACCENT_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, this.accentMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.accentPool.push(mesh);
    }
  }

  /** Jump landing-pad warning gates (see GATE_POOL_SIZE's own comment). Plain vertical planes,
   *  DoubleSide (approached from either side of a curve), a bright warning color distinct from
   *  the amber accent lines so a gate reads as "look here" from far away, not just "edge of
   *  something". Built once regardless of map, same as every other pool here. */
  _buildGatePool() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._gateGeo = geo;
    this.gateMat = new THREE.MeshBasicMaterial({ color: this.colors.obstacleEdge, side: THREE.DoubleSide });
    this.gatePool = [];
    for (let i = 0; i < GATE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, this.gateMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.gatePool.push(mesh);
    }
  }

  /** Pickups (Phase 4, Orbital only): a small sphere for orbs, a small heart for the rarer life
   *  pickup - distinct GEOMETRY, not just color, per root CLAUDE.md's colorblind rule ("pair each
   *  hue with a shape marker, never hue alone"). Both emissive so they read clearly against the
   *  dark deck without needing their own light; the heart's material is DoubleSide since its
   *  extruded front/back faces should both read correctly regardless of which way a given render
   *  happens to wind (cheap insurance, this pool is only 2 meshes). Built once regardless of map
   *  (same reason every other pool here is) - `this.colors.orb`/`.life` exist on every map's
   *  palette even though only Orbital's `map.jump`-sibling `map.pickups` config ever spawns one. */
  _buildPickupPools() {
    const orbGeo = new THREE.SphereGeometry(BALL_RADIUS * 0.55, 16, 12);
    this._orbGeo = orbGeo;
    this.orbMat = new THREE.MeshStandardMaterial({ color: this.colors.orb, emissive: this.colors.orb, emissiveIntensity: 0.6, roughness: 0.35 });
    this.orbPool = [];
    for (let i = 0; i < ORB_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(orbGeo, this.orbMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.orbPool.push(mesh);
    }

    const lifeGeo = buildHeartGeometry(BALL_RADIUS * 1.5);
    this._lifeGeo = lifeGeo;
    this.lifeMat = new THREE.MeshStandardMaterial({
      color: this.colors.life, emissive: this.colors.life, emissiveIntensity: 0.55, roughness: 0.3, side: THREE.DoubleSide,
    });
    this.lifePool = [];
    for (let i = 0; i < LIFE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(lifeGeo, this.lifeMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.lifePool.push(mesh);
    }
  }

  _buildWallPool() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._wallGeo = geo;
    this.wallMat = new THREE.MeshStandardMaterial({
      map: this.tunnelWallTex, color: this.colors.tunnelEdge, emissive: this.colors.tunnelEdge, emissiveIntensity: 0.25,
      roughness: 0.5, side: THREE.DoubleSide,
    });
    this.wallPool = [];
    for (let i = 0; i < WALL_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.wallPool.push(mesh);
    }
  }

  _buildObstaclePool() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edgesGeo = new THREE.EdgesGeometry(geo);
    this._obstacleGeo = geo; this._obstacleEdgesGeo = edgesGeo;
    this.obstacleMat = new THREE.MeshStandardMaterial({
      color: this.colors.obstacle, emissive: this.colors.obstacle, emissiveIntensity: 0.5, roughness: 0.4,
    });
    this.obstacleEdgeMat = new THREE.LineBasicMaterial({ color: this.colors.obstacleEdge });
    this.obstaclePool = [];
    for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, this.obstacleMat);
      const edges = new THREE.LineSegments(edgesGeo, this.obstacleEdgeMat);
      mesh.add(edges);
      mesh.visible = false;
      this.scene.add(mesh);
      this.obstaclePool.push(mesh);
    }
  }

  // =============================================================================================
  // HAZARD AND JUMP CUES, ADMIN DEVICES ONLY until Matt says "release it" (2026-11-17, Matt on the
  // mockup: "looks great - build it"; docs/BALL-RUN-UX-REVIEW.md, ball-run/CLAUDE.md "Cues").
  // Built only when ui.js passes `cues: true`; with it off nothing below is created or run and every
  // pixel is the old renderer's. Everything is created once here, pooled, and released in
  // _disposeCues(); the per-frame path writes numbers into preallocated arrays only.
  //
  // `this.deck` (Orbital) draws the deck itself as one solid slab per frame:
  //   - each segment is a trapezoid following w0->w1, void0->void1, y0->y1 and wCenter, so the slope
  //     back up after a drop is a ramp, not floating plates with see-through risers (the "drops look
  //     like holes" cause), and width changes have straight edges;
  //   - a deadly void has amber/black stripes on its lips and walls, and a striped centre strip from the
  //     first widening segment;
  //   - a jump has cyan chevrons on its run-up, a cyan lip, a dotted flight arc to each landing lane, a
  //     landing pad with a front face, a cyan rim and pillars, and down/up triangle posts for a drop/rise
  //     (these replace the amber gate posts);
  //   - outer edges get a pale rim and a slab face; the deck fades out before the generation window ends.
  // Both maps (cues on): tunnel floors with world-space chevrons (no squash, no "SPEED UP" text).
  // =============================================================================================
  _buildCues() {
    const C = CUE_COLORS;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const canvasTex = (w, h, draw) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const lin = (n) => { const c = new THREE.Color(); c.setHex(n, THREE.SRGBColorSpace); return new Float32Array([c.r, c.g, c.b]); };
    const u = this._cue = {
      q: new Float32Array(12), t: new Float32Array(8), m4: new THREE.Matrix4(),
      // the current segment's two ends (a = z0, b = z1) and its local right vector
      aCx: 0, aZ: 0, aY: 0, bCx: 0, bZ: 0, bY: 0, nx: 1, nz: 0,
      arcLat: 0,
      col: {
        rim: lin(C.rim), jump: lin(C.jump), skirt: lin(C.skirtTop), pillar: lin(C.pillar), void: lin(this.colors.void),
      },
      batches: [],
    };
    const add = (batch, mat, order) => {
      batch.mesh = new THREE.Mesh(batch.geo, mat);
      batch.mesh.frustumCulled = false; // positions are rewritten every frame
      if (order) batch.mesh.renderOrder = order;
      this.scene.add(batch.mesh);
      u.batches.push(batch);
      return batch;
    };

    // Tunnel floor (both maps): one chevron per TUNNEL_CHEVRON_LEN units, texture in world space.
    u.tunTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = hex(this.colors.trackTile); g.fillRect(0, 0, w, w);
      g.strokeStyle = hex(this.colors.chevron); g.lineWidth = 26; g.lineCap = 'round';
      g.beginPath(); g.moveTo(24, 190); g.lineTo(w / 2, 70); g.lineTo(w - 24, 190); g.stroke();
    });
    u.tunMat = new THREE.MeshStandardMaterial({ map: u.tunTex, vertexColors: true, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
    u.tun = add(new QuadBatch(SEGMENTS_AHEAD + SEGMENTS_BEHIND, true), u.tunMat);

    // The deck's top (both maps): one trapezoid per segment, tiled in world space. Classic keeps its
    // own colours (only its stair-stepped edges change); Orbital gets the lighter cue deck.
    u.tileTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = hex(this.deck ? C.deckTile : this.colors.trackTile); g.fillRect(0, 0, w, w);
      g.strokeStyle = hex(this.deck ? C.deckGrout : this.colors.trackGrout); g.lineWidth = this.deck ? 8 : 6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.moveTo(0, 0); g.lineTo(0, w); g.stroke();
    });
    u.topMat = new THREE.MeshStandardMaterial({ map: u.tileTex, vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
    u.top = add(new QuadBatch((SEGMENTS_AHEAD + SEGMENTS_BEHIND) * 2, true), u.topMat);

    if (this.deck) {
      u.stripeTex = canvasTex(128, 128, (g, w) => {
        g.fillStyle = hex(C.hazardB); g.fillRect(0, 0, w, w);
        g.fillStyle = hex(C.hazardA);
        for (let k = -2; k < 3; k++) {
          g.beginPath();
          g.moveTo(k * w / 2, 0); g.lineTo(k * w / 2 + w / 4, 0); g.lineTo(k * w / 2 + w / 4 + w, w); g.lineTo(k * w / 2 + w, w);
          g.closePath(); g.fill();
        }
      });
      u.chevTex = canvasTex(256, 256, (g, w) => {
        g.clearRect(0, 0, w, w);
        g.strokeStyle = hex(C.jump); g.lineWidth = 34; g.lineJoin = 'miter';
        g.beginPath(); g.moveTo(30, 200); g.lineTo(w / 2, 70); g.lineTo(w - 30, 200); g.stroke();
      });
      u.fxMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      u.hazMat = new THREE.MeshBasicMaterial({ map: u.stripeTex, vertexColors: true, side: THREE.DoubleSide });
      u.chevMat = new THREE.MeshBasicMaterial({ map: u.chevTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const segs = SEGMENTS_AHEAD + SEGMENTS_BEHIND;
      u.fx = add(new QuadBatch(segs * 12, false), u.fxMat);
      u.haz = add(new QuadBatch(segs * 5, true), u.hazMat);
      u.chev = add(new QuadBatch(RUNUP_SEGS * 2, true), u.chevMat, 2);

      u.dotGeo = new THREE.SphereGeometry(0.17, 8, 6);
      u.dotMat = new THREE.MeshBasicMaterial({ color: C.jump });
      u.dots = new THREE.InstancedMesh(u.dotGeo, u.dotMat, ARC_DOTS_MAX);
      u.dots.frustumCulled = false;
      u.dots.count = 0;
      this.scene.add(u.dots);
    }
  }

  /** Sets the current segment's two ends and local right vector (no allocation). */
  _cueSeg(seg) {
    const u = this._cue;
    const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
    u.nx = Math.cos(yaw); u.nz = -Math.sin(yaw);
    u.aCx = seg.cx0; u.aZ = seg.z0; u.aY = seg.y0 || 0;
    u.bCx = seg.cx1; u.bZ = seg.z1; u.bY = seg.y1 || 0;
  }

  /** Writes the point at end e (0 = z0, 1 = z1), lateral `lat`, height offset dy, into q[k..k+2]. */
  _cuePt(e, lat, dy, k, dz = 0) {
    const u = this._cue, q = u.q;
    q[k] = (e ? u.bCx : u.aCx) + lat * u.nx;
    q[k + 1] = (e ? u.bY : u.aY) + dy;
    q[k + 2] = (e ? u.bZ : u.aZ) + lat * u.nz + dz;
  }

  /** A flat strip on the deck from lateral l0..h0 (near end) to l1..h1 (far end). uvMode 0 world
   *  tiles, 1 stripes along z, 2 one chevron across the width per 2 units, 3 tunnel chevrons. */
  _cueStrip(batch, l0, h0, l1, h1, dy, uvMode, c0, c1) {
    const u = this._cue, t = u.t;
    this._cuePt(0, l0, dy, 0); this._cuePt(0, h0, dy, 3); this._cuePt(1, h1, dy, 6); this._cuePt(1, l1, dy, 9);
    const az = u.aZ, bz = u.bZ;
    if (uvMode === 0) {
      t[0] = l0 / TILE_SIZE; t[1] = az / TILE_SIZE; t[2] = h0 / TILE_SIZE; t[3] = az / TILE_SIZE;
      t[4] = h1 / TILE_SIZE; t[5] = bz / TILE_SIZE; t[6] = l1 / TILE_SIZE; t[7] = bz / TILE_SIZE;
    } else if (uvMode === 1) {
      t[0] = 0; t[1] = az / STRIPE_LEN; t[2] = 0.5; t[3] = az / STRIPE_LEN; t[4] = 0.5; t[5] = bz / STRIPE_LEN; t[6] = 0; t[7] = bz / STRIPE_LEN;
    } else {
      const len = uvMode === 2 ? 2 : TUNNEL_CHEVRON_LEN;
      t[0] = 0; t[1] = az / len; t[2] = 1; t[3] = az / len; t[4] = 1; t[5] = bz / len; t[6] = 0; t[7] = bz / len;
    }
    batch.quad(u.q, t, c0, c0, c1, c1);
  }

  /** A vertical face along the segment at lateral lat0 (near) / lat1 (far), dyTop down to dyBot. */
  _cueWall(batch, lat0, lat1, dyTop, dyBot, cTop, cBot, stripes) {
    const u = this._cue, t = u.t;
    this._cuePt(0, lat0, dyTop, 0); this._cuePt(1, lat1, dyTop, 3); this._cuePt(1, lat1, dyBot, 6); this._cuePt(0, lat0, dyBot, 9);
    if (stripes) {
      t[0] = u.aZ / STRIPE_LEN; t[1] = 1; t[2] = u.bZ / STRIPE_LEN; t[3] = 1;
      t[4] = u.bZ / STRIPE_LEN - 0.5; t[5] = 0; t[6] = u.aZ / STRIPE_LEN - 0.5; t[7] = 0;
    }
    batch.quad(u.q, t, cTop, cTop, cBot, cBot);
  }

  /** A face across the track at end e from lateral lo..hi, dyTop down to dyBot, pushed dz along z. */
  _cueAcross(e, lo, hi, dyTop, dyBot, dz, cTop, cBot) {
    const u = this._cue;
    this._cuePt(e, lo, dyTop, 0, dz); this._cuePt(e, hi, dyTop, 3, dz); this._cuePt(e, hi, dyBot, 6, dz); this._cuePt(e, lo, dyBot, 9, dz);
    u.fx.quad(u.q, u.t, cTop, cTop, cBot, cBot);
  }

  /** A flat band lying on the deck at end e, lateral lo..hi, from dz0 to dz1 along z. */
  _cueBand(e, lo, hi, dy, dz0, dz1, c) {
    const u = this._cue;
    this._cuePt(e, lo, dy, 0, dz0); this._cuePt(e, hi, dy, 3, dz0); this._cuePt(e, hi, dy, 6, dz1); this._cuePt(e, lo, dy, 9, dz1);
    u.fx.quad(u.q, u.t, c, c, c, c);
  }

  /** A height sign beside the launch lip (end b): a post, then a triangle pointing down (drop) or up (rise). */
  _cueSign(lat, down) {
    const u = this._cue, q = u.q, C = u.col;
    const pw = 0.12, tw = 1.0, th = 0.85, postH = 1.5;
    this._cuePt(1, lat - pw / 2, 0, 0); this._cuePt(1, lat + pw / 2, 0, 3); this._cuePt(1, lat + pw / 2, postH, 6); this._cuePt(1, lat - pw / 2, postH, 9);
    u.fx.quad(q, u.t, C.pillar, C.pillar, C.jump, C.jump);
    const yb = postH, yt = postH + th;
    this._cuePt(1, lat - tw / 2, down ? yt : yb, 0); this._cuePt(1, lat + tw / 2, down ? yt : yb, 3); this._cuePt(1, lat, down ? yb : yt, 6);
    q[9] = q[6]; q[10] = q[7]; q[11] = q[8]; // a triangle: a quad with two shared corners
    u.fx.quad(q, u.t, C.jump, C.jump, C.jump, C.jump);
  }

  _layoutCues(sim) {
    const u = this._cue, C = u.col, D = DECK_DEPTH;
    const segs = sim.track.segments;
    const zFront = sim.z + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = sim.z - SEGMENTS_BEHIND * SEGMENT_LENGTH;
    // Orbital: the deck fades out before the window's hard end (Classic keeps its look).
    const f0 = this.deck ? sim.z + CUE_FADE_NEAR : Infinity, f1 = this.deck ? sim.z + CUE_FADE_FAR : Infinity;
    for (let k = 0; k < u.batches.length; k++) { const b = u.batches[k]; b.fadeZ0 = f0; b.fadeZ1 = f1; b.begin(); }
    const landHold = this._jumpCfg ? this._jumpCfg.landingHoldSegs : 0;
    let landLeft = 0;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.z0 > zFront) break;
      if (seg.jumpLanding) landLeft = landHold;
      const onPad = landLeft > 0;
      if (landLeft > 0) landLeft--;
      if (seg.z1 < zBack || seg.isGap) continue;
      this._cueSeg(seg);
      const wc = seg.wCenter || 0;
      const aLo = wc - seg.w0 / 2, aHi = wc + seg.w0 / 2, bLo = wc - seg.w1 / 2, bHi = wc + seg.w1 / 2;

      if (seg.isTunnel) {
        this._cueStrip(u.tun, aLo, aHi, bLo, bHi, 0, 3, null, null);
        continue;
      }
      if (!this.deck) {
        this._cueStrip(u.top, aLo, aHi, bLo, bHi, 0, 0, null, null); // Classic: no voids, gaps or heights
        continue;
      }

      const vc = wc + (seg.voidCenter || 0);
      const av = seg.void0 || 0, bv = seg.void1 || 0;
      const hasVoid = av > 0.001 || bv > 0.001;
      const aVlo = vc - av, aVhi = vc + av, bVlo = vc - bv, bVhi = vc + bv;

      if (hasVoid) {
        this._cueStrip(u.top, aLo, aVlo, bLo, bVlo, 0, 0, null, null);
        this._cueStrip(u.top, aVhi, aHi, bVhi, bHi, 0, 0, null, null);
        // the deadly void: striped lips and walls
        this._cueStrip(u.haz, Math.max(aLo, aVlo - HAZARD_BAND), aVlo, Math.max(bLo, bVlo - HAZARD_BAND), bVlo, 0.015, 1, null, null);
        this._cueStrip(u.haz, aVhi, Math.min(aHi, aVhi + HAZARD_BAND), bVhi, Math.min(bHi, bVhi + HAZARD_BAND), 0.015, 1, null, null);
        this._cueWall(u.haz, aVlo, bVlo, 0, -D * 0.8, null, null, true);
        this._cueWall(u.haz, aVhi, bVhi, 0, -D * 0.8, null, null, true);
      } else {
        this._cueStrip(u.top, aLo, aHi, bLo, bHi, 0, 0, null, null);
        // the middle that is about to open, striped from the first widening segment
        if (seg.telegraph) this._cueStrip(u.haz, wc - 0.3, wc + 0.3, wc - 0.3, wc + 0.3, 0.015, 1, null, null);
      }

      // outer rims (cyan on a landing pad) and the slab's outer faces
      const rimC = onPad ? C.jump : C.rim;
      const rimW = onPad ? 0.22 : 0.12;
      this._cueStrip(u.fx, aLo, aLo + rimW, bLo, bLo + rimW, 0.02, 0, rimC, rimC);
      this._cueStrip(u.fx, aHi - rimW, aHi, bHi - rimW, bHi, 0.02, 0, rimC, rimC);
      this._cueWall(u.fx, aLo, bLo, 0, -D, C.skirt, C.void, false);
      this._cueWall(u.fx, aHi, bHi, 0, -D, C.skirt, C.void, false);

      // landing pad (first segment after a gap): front face, cyan front lip, pillars
      const prev = segs[i - 1];
      if (prev && prev.isGap) {
        if (hasVoid) {
          this._cueAcross(0, aLo, aVlo, 0, -D, 0, C.skirt, C.void);
          this._cueAcross(0, aVhi, aHi, 0, -D, 0, C.skirt, C.void);
          this._cueBand(0, aLo, aVlo, 0.025, 0, 0.3, C.jump);
          this._cueBand(0, aVhi, aHi, 0.025, 0, 0.3, C.jump);
        } else {
          this._cueAcross(0, aLo, aHi, 0, -D, 0, C.skirt, C.void);
          this._cueBand(0, aLo, aHi, 0.025, 0, 0.3, C.jump);
        }
        this._cuePillar(aLo + 0.3); this._cuePillar(aHi - 0.3);
        if (hasVoid) { this._cuePillar(aVlo - 0.3); this._cuePillar(aVhi + 0.3); }
      }

      // jump run-up: chevrons, and on the last segment before the gap the lip + height signs
      if (!hasVoid) {
        let gapAhead = 0;
        for (let k = 1; k <= RUNUP_SEGS; k++) {
          const n = segs[i + k];
          if (!n) break;
          if (n.isGap) { gapAhead = k; break; }
        }
        if (gapAhead) {
          this._cueStrip(u.chev, aLo + 0.45, aHi - 0.45, bLo + 0.45, bHi - 0.45, 0.02, 2, null, null);
          if (gapAhead === 1) {
            this._cueBand(1, bLo, bHi, 0.03, -0.32, 0, C.jump);
            const meta = segs[i + 1].jumpMeta;
            const ly = meta ? meta.landingY : 0;
            if (Math.abs(ly) > 0.01) { this._cueSign(bLo - 0.7, ly < 0); this._cueSign(bHi + 0.7, ly < 0); }
          }
        }
      }
    }
    for (let k = 0; k < u.batches.length; k++) u.batches[k].end();
    if (this.deck) this._layoutArc(sim);
  }

  /** A pillar under the landing pad's near edge at lateral `lat`, from the slab's bottom into the void. */
  _cuePillar(lat) {
    const u = this._cue, C = u.col, pw = 0.32, D = DECK_DEPTH;
    this._cuePt(0, lat - pw / 2, -D, 0, 0.4); this._cuePt(0, lat + pw / 2, -D, 3, 0.4);
    this._cuePt(0, lat + pw / 2, -D - 9, 6, 0.4); this._cuePt(0, lat - pw / 2, -D - 9, 9, 0.4);
    u.fx.quad(u.q, u.t, C.pillar, C.pillar, C.void, C.void);
  }

  /** The dotted flight arc: the SAME formula as Sim.launchJump (impulse from the ball's current
   *  speed), from the ball's lateral to each landing lane's centre, shown from the moment the next
   *  gap is in view until the ball lands. */
  _layoutArc(sim) {
    const u = this._cue, dots = u.dots, jc = this._jumpCfg;
    let n = 0;
    if (jc && (sim.state === 'playing' || sim.state === 'airborne')) {
      const segs = sim.track.segments;
      let gap = null, land = null;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.jumpMeta && s.z0 + s.jumpMeta.gapLength > sim.z) {
          for (let k = i; k < segs.length; k++) if (segs[k].jumpLanding) { land = segs[k]; break; }
          gap = s;
          break;
        }
      }
      if (gap && land && gap.z0 - sim.z < SEGMENTS_AHEAD * SEGMENT_LENGTH * 0.8) {
        if (sim.state === 'playing') u.arcLat = sim.lateralOffset;
        const L = gap.jumpMeta.gapLength, Y = gap.jumpMeta.landingY;
        const T = L / Math.max(1, sim.speed);
        const vy0 = Y / T + 0.5 * jc.gravity * T;
        const wc = land.wCenter || 0, v = land.void0 || 0, hw = land.w0 / 2;
        const lanes = v > 0.001 ? 2 : 1;
        for (let lane = 0; lane < lanes; lane++) {
          const target = lanes === 1 ? wc : wc + (lane ? 1 : -1) * (hw + v) / 2;
          for (let k = 1; k < ARC_DOTS_PER_LANE; k++) {
            const s = k / ARC_DOTS_PER_LANE;
            const z = gap.z0 + s * L;
            if (z < sim.z + 0.9) continue;
            const t = s * T;
            const y = vy0 * t - 0.5 * jc.gravity * t * t + BALL_RADIUS;
            const lat = u.arcLat + (target - u.arcLat) * s;
            const seg = sim.track.segmentAt(z);
            const f = Math.min(1, Math.max(0, (z - seg.z0) / (seg.z1 - seg.z0)));
            const cx = seg.cx0 + (seg.cx1 - seg.cx0) * f;
            const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
            u.m4.makeTranslation(cx + lat * Math.cos(yaw), y, z - lat * Math.sin(yaw));
            if (n < ARC_DOTS_MAX) dots.setMatrixAt(n++, u.m4);
          }
        }
      }
    }
    dots.count = n;
    if (n) dots.instanceMatrix.needsUpdate = true;
  }

  _disposeCues() {
    const u = this._cue;
    for (const b of u.batches) { b.dispose(); this.scene.remove(b.mesh); }
    for (const k of ['tunMat', 'topMat', 'fxMat', 'hazMat', 'chevMat', 'tunTex', 'tileTex', 'stripeTex', 'chevTex', 'dotGeo', 'dotMat']) {
      if (u[k]) u[k].dispose();
    }
    if (u.dots) { u.dots.dispose(); this.scene.remove(u.dots); }
    this._cue = null;
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** One frame: read sim (plain data) and place pooled meshes accordingly. */
  render(sim, reducedMotion) {
    const track = sim.track;
    // World position of the ball: track-distance sim.z offset laterally by sim.lateralOffset along
    // the track's own local right vector at that point (item 1 fix), not a raw world-X add. On a
    // curve this keeps the ball sitting on the floor quad's actual (rotated) surface instead of
    // sliding off it as the track's local frame rotates underneath a world-axis-only offset.
    const ballPoint = track.worldPointAt(sim.z, sim.lateralOffset);
    const ballWorldX = ballPoint.x;
    const ballWorldZ = ballPoint.z;
    // Jump (section 3): `sim.y` is the ball's own tracked height - `track.frameAt`'s interpolated
    // ground height while grounded (always 0 outside a Jump's own segments), the real
    // physics-integrated flight arc while AIRBORNE. NOT `ballPoint.y` (worldPointAt's track-only
    // interpolation) - see track.js's worldPointAt doc comment for why those two deliberately
    // diverge mid-flight.
    // A fall starts from the height the ball was at (cues on: a lowered landing pad no longer snaps the
    // ball up to 0 first; sim.y holds the height at the moment the fall began).
    const fallBase = this.cues ? sim.y : 0;
    const ballY = sim.state === 'falling' ? fallBase + Math.max(-14, sim.fallY) + BALL_RADIUS : sim.y + BALL_RADIUS;

    this.ball.position.set(ballWorldX, ballY, ballWorldZ);
    this.ball.rotation.x = sim.rollAngle;
    // Slight roll bank into turns, purely cosmetic.
    this.ball.rotation.z = Math.max(-0.4, Math.min(0.4, -sim.lateralVelocity * 0.06));
    // Invincibility pulse (Phase 4): a spent life's grace window reads on the ball itself, no HUD
    // text needed - a gentle size pulse, cheap (just a scale mutation on the existing shared ball
    // mesh, no new material/geometry) and unmistakable without being distracting mid-recovery.
    const invincible = sim.state === 'playing' && sim.elapsed < sim.invincibleUntil;
    this.ball.scale.setScalar(invincible ? 1 + 0.12 * Math.sin(sim.elapsed * 18) : 1);

    // Shadow: "keep the shadow on the deck below the ball and scale it down as height increases"
    // (section 3) - the depth cue that makes a Jump landing readable. `groundY` is the track's own
    // interpolated height at the ball's current z (0 outside a Jump), so the shadow sits at
    // whatever's "below" even mid-flight (the straight-line launch-to-landing reference, since
    // there's no literal floor mesh to project onto during the gap); its scale shrinks with how
    // far `sim.y` has risen above that reference, floored so it never fully vanishes.
    const groundY = track.frameAt(sim.z).y;
    const heightAboveGround = Math.max(0, sim.y - groundY);
    this.ballShadow.scale.setScalar(sim.state === 'airborne' ? Math.max(0.25, 1 - heightAboveGround / 4) : 1);
    this.ballShadow.visible = sim.state !== 'falling';
    this.ballShadow.position.set(ballWorldX, groundY + 0.02, ballWorldZ);

    // Segment windowing uses sim.z (the track-distance parameter), not ballWorldZ (the ball's true
    // world Z, which includes a small lateral-offset contribution from worldPointAt above).
    this._layoutFloor(track, sim.z);
    this._layoutObstacles(track, sim.z);
    this._layoutPickups(track, sim.z, sim.elapsed);
    if (this.cues) this._layoutCues(sim);

    this._layoutCamera(sim, reducedMotion);

    this.renderer.render(this.scene, this.camera);
  }

  _layoutFloor(track, ballZ) {
    const zFront = ballZ + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = ballZ - SEGMENTS_BEHIND * SEGMENT_LENGTH;
    const visible = track.segments.filter((s) => s.z1 >= zBack && s.z0 <= zFront);

    let wallIdx = 0;
    let gateIdx = 0; // Jump landing gates: at most one landing pad is ever in the window at once,
                      // reset/hidden below before the loop so a landing pad that's scrolled out of
                      // range doesn't leave a stale gate visible.
    for (const g of this.gatePool) g.visible = false;
    for (let i = 0; i < FLOOR_POOL_SIZE; i++) {
      const mesh = this.floorPool[i];
      const mesh2 = this.floorPool2[i];
      const accentA = this.accentPool[i * 2];
      const accentB = this.accentPool[i * 2 + 1];
      const left = this.wallPool[wallIdx];
      const right = this.wallPool[wallIdx + 1];
      const seg = visible[i];
      if (!seg) {
        mesh.visible = false;
        mesh2.visible = false;
        accentA.visible = false;
        accentB.visible = false;
        if (left) left.visible = false;
        if (right) right.visible = false;
        wallIdx += 2;
        continue;
      }

      // Jump's gap (section 3): "the floor is genuinely gone." No floor, no walls, no accents -
      // the void/background IS the visual. sim.js's AIRBORNE state is what actually keeps the ball
      // from falling through here; this is purely "don't draw anything."
      if (seg.isGap) {
        mesh.visible = false;
        mesh2.visible = false;
        accentA.visible = false;
        accentB.visible = false;
        if (left) left.visible = false;
        if (right) right.visible = false;
        wallIdx += 2;
        continue;
      }

      // Cues on: every floor is drawn by _layoutCues instead (the tunnel's walls still come from the
      // pool below).
      const cueFloor = this.cues;
      if (cueFloor && !seg.isTunnel) {
        mesh.visible = false; mesh2.visible = false; accentA.visible = false; accentB.visible = false;
        if (left) left.visible = false;
        if (right) right.visible = false;
        wallIdx += 2;
        continue;
      }

      const midCx = (seg.cx0 + seg.cx1) / 2;
      const midZ = (seg.z0 + seg.z1) / 2;
      const midY = ((seg.y0 || 0) + (seg.y1 || 0)) / 2; // Jump only (section 3); 0 elsewhere
      const width = (seg.w0 + seg.w1) / 2;
      const dz = seg.z1 - seg.z0;
      const yaw = Math.atan2(seg.cx1 - seg.cx0, dz);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw); // segment-local right vector (item 1's fix, reused for void strips/accents below)

      // Split (section 2): a void-bearing segment renders as two floor strips instead of one, with
      // an amber accent line on each strip's inner edge ("Same amber stripe on both inner edges of
      // the void band", section 5). `voidHW` averages void0/void1 the same way `width` above
      // averages w0/w1 for this segment's midpoint quad. (Also true of a Jump landing pad rolled
      // "itself split" - the same rendering applies at whatever height that pad sits at.)
      const voidHW = ((seg.void0 || 0) + (seg.void1 || 0)) / 2;
      const halfWidth = width / 2;
      // Jump's offset-landing variety only (section 3): where this segment's own width/void is
      // centered, relative to cx (0 everywhere else - see track.js's wCenter doc comment for why
      // this is a distinct axis from cx itself).
      const wCenter = seg.wCenter || 0;

      if (voidHW > 0.001) {
        const voidC = wCenter + (seg.voidCenter || 0);
        const leftLo = wCenter - halfWidth, leftHi = voidC - voidHW;
        const rightLo = voidC + voidHW, rightHi = wCenter + halfWidth;
        const leftWidth = Math.max(0, leftHi - leftLo);
        const rightWidth = Math.max(0, rightHi - rightLo);
        const leftOffset = (leftLo + leftHi) / 2;
        const rightOffset = (rightLo + rightHi) / 2;

        mesh.visible = leftWidth > 0;
        mesh.position.set(midCx + leftOffset * nx, midY, midZ + leftOffset * nz);
        mesh.rotation.y = yaw;
        mesh.scale.set(leftWidth, dz, 1);
        mesh.material = this.floorMatPool[i];
        const tex = this.floorTexPool[i];
        tex.repeat.set(leftWidth / TILE_SIZE, dz / TILE_SIZE);
        tex.offset.set(0, -(seg.z0 / TILE_SIZE) % 1);

        mesh2.visible = rightWidth > 0;
        mesh2.position.set(midCx + rightOffset * nx, midY, midZ + rightOffset * nz);
        mesh2.rotation.y = yaw;
        mesh2.scale.set(rightWidth, dz, 1);
        mesh2.material = this.floorMatPool2[i];
        const tex2 = this.floorTexPool2[i];
        tex2.repeat.set(rightWidth / TILE_SIZE, dz / TILE_SIZE);
        tex2.offset.set(0, -(seg.z0 / TILE_SIZE) % 1);

        const accentH = 0.16;
        accentA.visible = true;
        accentA.position.set(midCx + leftHi * nx, midY + 0.03, midZ + leftHi * nz);
        accentA.rotation.y = yaw;
        accentA.scale.set(accentH, dz, 1);
        accentB.visible = true;
        accentB.position.set(midCx + rightLo * nx, midY + 0.03, midZ + rightLo * nz);
        accentB.rotation.y = yaw;
        accentB.scale.set(accentH, dz, 1);
      } else {
        mesh2.visible = false;

        mesh.visible = !cueFloor;
        mesh.position.set(midCx + wCenter * nx, midY, midZ + wCenter * nz);
        mesh.rotation.y = yaw;
        mesh.scale.set(width, dz, 1);
        if (seg.isTunnel) {
          mesh.material = seg.showSpeedLabel ? this.tunnelFloorLabelMat : this.tunnelFloorMat;
        } else {
          mesh.material = this.floorMatPool[i];
          // Tile the grid at its real world size (TILE_SIZE per repeat) and
          // phase-align the offset to the segment's world Z so the pattern
          // reads as one continuous ribbon instead of a seam at every segment.
          const tex = this.floorTexPool[i];
          tex.repeat.set(width / TILE_SIZE, dz / TILE_SIZE);
          tex.offset.set(0, -(seg.z0 / TILE_SIZE) % 1);
        }

        if (seg.telegraph) {
          // Split's Widen-phase divider (section 2): lateral 0 is always the segment's own
          // midpoint regardless of width, since width is symmetric around cx - no separate
          // "is this centered" math needed, unlike the void strips above. (wCenter is always 0
          // during Split's Widen phase - this map has no event that combines the two - but the
          // offset is applied here anyway for consistency with everywhere else this file reads
          // wCenter.)
          const accentH = 0.16;
          accentA.visible = true;
          accentA.position.set(midCx + wCenter * nx, midY + 0.03, midZ + wCenter * nz);
          accentA.rotation.y = yaw;
          accentA.scale.set(accentH, dz, 1);
        } else {
          accentA.visible = false;
        }
        accentB.visible = false;
      }

      // Jump landing-pad warning gate (see GATE_POOL_SIZE's own comment): planted on the pad's
      // first segment only, at the pad's own edges - and, when the pad is itself split, at the
      // void's two inner edges too - so a hazardous landing is legible from the approach, not
      // just once the player is already airborne. `voidHW`/`wCenter`/`halfWidth` are the exact
      // values this same segment's floor strips above were just built from, so the gate lines up
      // with the floor precisely rather than being a separate, potentially-drifting estimate.
      if (seg.jumpLanding) {
        const gateH = 2.4;
        const placeGate = (lateral) => {
          if (gateIdx >= this.gatePool.length) return;
          const g = this.gatePool[gateIdx++];
          g.visible = true;
          g.position.set(midCx + lateral * nx, midY + gateH / 2, midZ + lateral * nz);
          g.rotation.y = yaw;
          g.scale.set(gateH * 0.12, gateH, 1);
        };
        if (voidHW > 0.001) {
          const voidC = wCenter + (seg.voidCenter || 0);
          placeGate(wCenter - halfWidth);
          placeGate(voidC - voidHW);
          placeGate(voidC + voidHW);
          placeGate(wCenter + halfWidth);
        } else {
          placeGate(wCenter - halfWidth);
          placeGate(wCenter + halfWidth);
        }
      }

      if (seg.isTunnel && left && right) {
        const wallH = 3.2;
        left.visible = true; right.visible = true;
        left.scale.set(dz, wallH, 1);
        right.scale.set(dz, wallH, 1);
        const halfW = width / 2;
        // Inward-facing side walls, offset perpendicular to the segment's local direction.
        left.position.set(midCx - nx * halfW, midY + wallH / 2, midZ - nz * halfW);
        right.position.set(midCx + nx * halfW, midY + wallH / 2, midZ + nz * halfW);
        left.rotation.set(0, yaw + Math.PI / 2, 0);
        right.rotation.set(0, yaw - Math.PI / 2, 0);
      } else {
        if (left) left.visible = false;
        if (right) right.visible = false;
      }
      wallIdx += 2;
    }
  }

  _layoutObstacles(track, ballZ) {
    const zFront = ballZ + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = ballZ - 4;
    const cubes = [];
    for (const seg of track.segments) {
      if (seg.z1 < zBack || seg.z0 > zFront || !seg.obstacles) continue;
      const midCx = (seg.cx0 + seg.cx1) / 2;
      const midZ = (seg.z0 + seg.z1) / 2;
      const midY = ((seg.y0 || 0) + (seg.y1 || 0)) / 2; // Jump only (section 3); 0 elsewhere - no
                                                          // obstacle ever generates on a jump's own
                                                          // segments today, kept for consistency
      // Same local-right-vector fix as the ball (item 1): a cube's `lateral` is relative to the
      // centerline, so it must be applied along the segment's own tangent-perpendicular, not raw
      // world X, or cubes drift off the visually rotated floor quad during a curve exactly like
      // the ball did.
      const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);
      for (const c of seg.obstacles) cubes.push({ x: midCx + c.lateral * nx, y: midY, z: midZ + c.lateral * nz, yaw });
      if (cubes.length >= OBSTACLE_POOL_SIZE) break;
    }
    for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
      const mesh = this.obstaclePool[i];
      const c = cubes[i];
      if (!c) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.scale.set(OBSTACLE_SIZE, OBSTACLE_SIZE, OBSTACLE_SIZE);
      mesh.position.set(c.x, c.y + OBSTACLE_SIZE / 2, c.z);
      mesh.rotation.y = c.yaw;
    }
  }

  /** Pickups (Phase 4, Orbital only): a gentle bob (sine on Y) and a slow spin, cheap depth/
   *  attention cues with no text needed - `elapsed` is `sim.elapsed`, the same clock everything
   *  else here already reads (never a fresh `Date.now()`, which would desync from the fixed-
   *  timestep sim on a paused/backgrounded tab). Never on a `seg.isGap` segment (pickups are
   *  never placed there - track.js's `_findPickupSlot` excludes it - but guarded here too since
   *  nothing should ever try to render inside an invisible gap). */
  _layoutPickups(track, ballZ, elapsed) {
    const zFront = ballZ + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = ballZ - 4;
    const orbs = [], lives = [];
    for (const seg of track.segments) {
      if (seg.z1 < zBack || seg.z0 > zFront || !seg.pickup || seg.isGap) continue;
      const midCx = (seg.cx0 + seg.cx1) / 2;
      const midZ = (seg.z0 + seg.z1) / 2;
      const midY = ((seg.y0 || 0) + (seg.y1 || 0)) / 2;
      const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);
      const lateral = (seg.wCenter || 0) + seg.pickup.lateral;
      const p = { x: midCx + lateral * nx, y: midY, z: midZ + lateral * nz };
      (seg.pickup.type === 'life' ? lives : orbs).push(p);
      if (orbs.length >= ORB_POOL_SIZE && lives.length >= LIFE_POOL_SIZE) break;
    }
    const bob = Math.sin(elapsed * 3) * 0.12;
    const spin = elapsed * 1.6;
    for (let i = 0; i < ORB_POOL_SIZE; i++) {
      const mesh = this.orbPool[i];
      const p = orbs[i];
      if (!p) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(p.x, p.y + BALL_RADIUS + bob, p.z);
      mesh.rotation.y = spin;
    }
    for (let i = 0; i < LIFE_POOL_SIZE; i++) {
      const mesh = this.lifePool[i];
      const p = lives[i];
      if (!p) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.position.set(p.x, p.y + BALL_RADIUS + bob, p.z);
      // A gentle medallion spin around Y with a slight fixed forward tilt - unlike the old
      // octahedron, a heart tumbling on X too would read as an unrecognizable blob partway
      // through the rotation, so only Y turns continuously here.
      // Cues on: a wobble instead of a full turn, which showed the heart edge-on half the time.
      mesh.rotation.set(0.15, this.cues ? Math.sin(elapsed * 2.2) * 0.55 : spin, 0);
    }
  }

  /**
   * Camera locked to the track's local frame (item 1 fix): both position and look-at target are
   * computed from track.worldPointAt at track-distances behind/ahead of the ball, using the SAME
   * damped lateral offset the ball itself would have there. Through a curve this rotates the
   * camera's yaw with the track's tangent (via lookAt on two points that both sit on the curving
   * centerline) instead of holding a fixed world-Z heading, so the world turns around a visually
   * planted ball; only CAMERA_LAG's small easing produces on-screen lateral motion.
   *
   * Third-playthrough item 1 (camera roll through curves): camera.up is NEVER set anywhere in
   * this file, so it stays Three.js's default world-up (0, 1, 0). lookAt() with that up produces
   * yaw+pitch only, never roll, by construction - verified headlessly against real generated
   * curve data (sharpest hard-difficulty curve): the camera's local right axis stays horizontal
   * (right.y ~ 0 to float precision) through the whole track. Do not derive `up` from the track's
   * local frame (localFrameAt's nx/nz, or any future Frenet/binormal vector) - that is what would
   * introduce the bank Matt saw; up must stay world-up always, only heading (yaw) may follow the
   * tangent.
   *
   * Jump (section 3): "Camera Y follows the ball's height with damping, using the same easing
   * style as _camLagLateral." `_camLagY` is exactly that - a second lerp, same CAMERA_LAG
   * constant, toward `sim.y` instead of `sim.lateralOffset`. Both the camera's position AND its
   * look-at target rise/fall by it together, so the camera keeps a natural framing on the ball
   * through a jump instead of the ball drifting toward the top or bottom of frame. Still never
   * touches `camera.up` (see above) - height damping is a pure Y-position/look-at shift, not a
   * pitch or roll, so it cannot introduce the rejected bank even during a jump.
   */
  _layoutCamera(sim, reducedMotion) {
    const track = sim.track;
    // BY TIME, NOT BY FRAME (2026-11-16, Matt: "I'll move it quickly to the left ... as the camera adjusts
    // to follow the ball, the ball moves slowly to the right"). CAMERA_LAG was applied once per screen
    // frame, so the follow was 2-4x slower whenever a phone drew 60 or 30 frames a second instead of 120
    // (Safari's Low Power Mode, a busy moment after an update): the camera trailed and the ball seemed to
    // slide back. It is now CAMERA_LAG per 1/120 s (CAMERA_LAG_HZ), i.e. exactly the old feel on a 120 Hz
    // iPhone, at every frame rate. A frame over 0.1 s counts as 0.1 s.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = this._camLast == null ? 1 / CAMERA_LAG_HZ : Math.min(0.1, Math.max(0, (now - this._camLast) / 1000));
    this._camLast = now;
    const k = 1 - Math.pow(1 - CAMERA_LAG, dt * CAMERA_LAG_HZ);
    this._camLagLateral += (sim.lateralOffset - this._camLagLateral) * k;
    this._camLagY += (sim.y - this._camLagY) * k;

    const camZ = sim.z - CAMERA_BACK; // matches the pre-fix camera's fixed CAMERA_BACK offset behind the ball
    const lookZ = sim.z + CAMERA_LOOK_AHEAD;
    const camPoint = track.worldPointAt(camZ, this._camLagLateral);
    const lookPoint = track.worldPointAt(lookZ, this._camLagLateral);

    let shakeX = 0, shakeY = 0;
    if (!reducedMotion && sim.state === 'crashing') {
      const t = sim.crashTimer / CRASH_SHAKE_MS;
      if (t < 1) {
        const decay = 1 - t;
        shakeX = Math.sin(sim.crashTimer * 0.9 + this._shakeSeed) * 0.12 * decay;
        shakeY = Math.cos(sim.crashTimer * 1.3 + this._shakeSeed) * 0.08 * decay;
      }
    }
    this.camera.position.set(camPoint.x + shakeX, CAMERA_HEIGHT + this._camLagY + shakeY, camPoint.z);
    this.camera.lookAt(lookPoint.x, CAMERA_HEIGHT * CAMERA_LOOK_HEIGHT_FRAC + this._camLagY, lookPoint.z);

    const speedFrac = Math.max(0, Math.min(1, (sim.speed - sim.cfg.baseSpeed) / (sim.cfg.maxSpeed - sim.cfg.baseSpeed)));
    const fovKick = reducedMotion ? 0 : CAMERA_MAX_FOV_KICK * speedFrac;
    const targetFov = CAMERA_BASE_FOV + fovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.08;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Reset camera lag / shake state for a fresh run (called on restart). `lateral` is the track-local lateral offset, not a world X. */
  resetCamera(lateral) {
    this._camLagLateral = lateral;
    this._camLagY = 0;
    this._camLast = null;
  }

  /** `loseContext` defaults to true (leaving the hub entirely: release the GPU context so
   *  repeated hub<->game remounts don't pile up toward the browser's context cap). Pass
   *  false when the same canvas will immediately get a new Renderer (in-game "Play Again"
   *  restart) - forcing context loss there leaves the canvas permanently lost, since a
   *  lost context is not synchronously replaced by a fresh one on the next getContext(). */
  dispose(loseContext = true) {
    // Non-negotiable 7: fully release GPU resources on exit to the hub.
    const disposeMesh = (m) => {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
      else if (m.material) m.material.dispose();
    };
    [this.ball, this.ballShadow, ...this.floorPool, ...this.wallPool, ...this.obstaclePool].forEach((m) => {
      if (m.children) m.children.forEach(disposeMesh);
    });
    this._ballGeo.dispose(); this._ballMat.dispose();
    this._shadowGeo.dispose(); this._shadowMat.dispose();
    this._floorGeo.dispose();
    this.floorMat.dispose(); this.tunnelFloorMat.dispose(); this.tunnelFloorLabelMat.dispose();
    this.floorMatPool.forEach((m) => m.dispose());
    this.floorTexPool.forEach((t) => t.dispose());
    // Split's second floor-strip pool (floorPool2 meshes share `_floorGeo` above, already
    // disposed once - only their per-slot cloned materials/textures are their own).
    this.floorMatPool2.forEach((m) => m.dispose());
    this.floorTexPool2.forEach((t) => t.dispose());
    this._accentGeo.dispose(); this.accentMat.dispose();
    this._gateGeo.dispose(); this.gateMat.dispose();
    this._orbGeo.dispose(); this.orbMat.dispose();
    this._lifeGeo.dispose(); this.lifeMat.dispose();
    this._wallGeo.dispose(); this.wallMat.dispose();
    this._obstacleGeo.dispose(); this._obstacleEdgesGeo.dispose();
    this.obstacleMat.dispose(); this.obstacleEdgeMat.dispose();
    this.tileTex.dispose(); this.tunnelFloorTex.dispose(); this.tunnelFloorLabelTex.dispose(); this.tunnelWallTex.dispose();
    if (this._cue) this._disposeCues();
    this.renderer.dispose();
    // Non-negotiable 7 continued: dispose() alone leaves the WebGL context to be reclaimed by
    // GC, not immediately - repeated hub<->game remounts can pile up toward the browser's
    // context cap before that happens (see ARCH-REVIEW.md S4-6). forceContextLoss() releases it
    // synchronously on teardown. Only when actually leaving the game (loseContext) - see the
    // dispose() doc comment for why an in-place restart must skip this.
    if (loseContext && typeof this.renderer.forceContextLoss === 'function') this.renderer.forceContextLoss();
    this.scene.clear();
  }
}
