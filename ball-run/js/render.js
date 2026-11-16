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
  UX_COLORS, UX_DECK_DEPTH, UX_FOG_NEAR, UX_FOG_FAR, UX_CAM_HEIGHT, UX_CAM_LOOK_FRAC, UX_RUNUP_SEGS,
} from './config.js';

// ---------------------------------------------------------------------------------------------
// MOCKUP PROTOTYPE (2026-11-16, docs/BALL-RUN-UX-REVIEW.md). NOT CLEARED FOR PLAYERS.
// Every Orbital readability cue from the UX review sits behind UX_PROTO and is OFF unless the page
// URL carries ?uxproto=1 or a harness calls setUxProto(true) (tools/ballrun-ux/harness.html).
// With it off, this file renders exactly what main renders. Render-only: no sim/track changes.
// ---------------------------------------------------------------------------------------------
// UX_PROTO is false, or an options object: {} = every cue; { cam: true } also tries the higher camera.
let UX_PROTO = (() => {
  if (typeof location === 'undefined') return false;
  const m = /[?&]uxproto=(1|cam)\b/.exec(location.search);
  return m ? (m[1] === 'cam' ? { cam: true } : {}) : false;
})();
export function setUxProto(on) { UX_PROTO = on ? (typeof on === 'object' ? on : {}) : false; }

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

/** MOCKUP PROTOTYPE helper: a fixed-capacity batch of quads rebuilt every frame into ONE dynamic
 *  BufferGeometry (one draw call per batch). quad(q[12], t[8], c0..c3) copies numbers only. */
class QuadBatch {
  constructor(cap, withUv, withColor) {
    this.cap = cap;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 12);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const nrm = new Float32Array(cap * 12);
    for (let i = 0; i < cap * 4; i++) nrm[i * 3 + 1] = 1;
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (withUv) {
      this.uv = new Float32Array(cap * 8);
      this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    }
    if (withColor) {
      this.col = new Float32Array(cap * 12);
      this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    }
    const idx = new Uint16Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 2; idx[i * 6 + 2] = i * 4 + 1;
      idx[i * 6 + 3] = i * 4; idx[i * 6 + 4] = i * 4 + 3; idx[i * 6 + 5] = i * 4 + 2;
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.n = 0;
    this._c = new THREE.Color();
  }
  begin() { this.n = 0; }
  quad(q, t, c0, c1, c2, c3) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set(q, i * 12);
    if (this.uv) this.uv.set(t, i * 8);
    if (this.col) {
      for (let k = 0; k < 4; k++) {
        this._c.setHex(k === 0 ? c0 : k === 1 ? c1 : k === 2 ? c2 : c3, THREE.SRGBColorSpace);
        this.col[i * 12 + k * 3] = this._c.r; this.col[i * 12 + k * 3 + 1] = this._c.g; this.col[i * 12 + k * 3 + 2] = this._c.b;
      }
    }
  }
  end() {
    this.geo.setDrawRange(0, this.n * 6);
    this.geo.attributes.position.needsUpdate = true;
    if (this.uv) this.geo.attributes.uv.needsUpdate = true;
    if (this.col) this.geo.attributes.color.needsUpdate = true;
  }
}

export class Renderer {
  /** `mapKey` selects the map's color set (config.js's `MAPS`) for every texture/material this
   *  renderer builds. Textures/materials are built once, here, in the constructor — a map
   *  change is picked up by tearing down and constructing a fresh Renderer at setup time (ui.js
   *  already does this on every run start/restart), never by mutating an existing one per frame. */
  constructor(canvas, mapKey) {
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
    // MOCKUP PROTOTYPE: Orbital only (the map with holes, gaps and heights).
    const mc = mapConfig(mapKey);
    this.ux = UX_PROTO && (mc.jump || mc.split) ? { ...UX_PROTO, jumpCfg: mc.jump || null } : null;
    if (this.ux) this._buildUxProto();
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
  // MOCKUP PROTOTYPE (2026-11-16, docs/BALL-RUN-UX-REVIEW.md). NOT CLEARED FOR PLAYERS.
  // Orbital's deck drawn as ONE solid slab per frame (top, side skirts, front faces), with:
  //   F1 trapezoid segments that follow w0->w1, void0->void1 and y0->y1 (no stair steps, no
  //      see-through risers on the slope back up after a drop: the "drops look like holes" cause);
  //   F2 deadly void = amber/black stripes on its lip and walls, and down the middle before it opens;
  //   F3 jump = cyan chevrons on the run-up, a cyan lip, a dotted flight arc to each landing lane,
  //      a cyan-rimmed landing pad with a front face and pillars (replaces the amber gate posts);
  //   F4 fog: the deck fades out before the generation window ends, so the far end never looks
  //      like a cliff;
  //   F5 a fall from a lowered pad starts at the pad's height (render() above).
  // Fixed-capacity buffers + setDrawRange (4 draw calls + 1 instanced). The per-segment closures in
  // _layoutUx allocate; a real build would hoist them.
  // =============================================================================================
  _buildUxProto() {
    const C = UX_COLORS;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const canvasTex = (w, h, draw, repeat) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c);
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    const u = this._ux = { ends: [{}, {}], p: [0, 0, 0], q: new Float32Array(12), t: new Float32Array(8), arcLat: 0 };
    u.tileTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = hex(C.deckTile); g.fillRect(0, 0, w, w);
      g.strokeStyle = hex(C.deckGrout); g.lineWidth = 8;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.moveTo(0, 0); g.lineTo(0, w); g.stroke();
    }, true);
    u.stripeTex = canvasTex(128, 128, (g, w) => {
      g.fillStyle = hex(C.hazardB); g.fillRect(0, 0, w, w);
      g.fillStyle = hex(C.hazardA);
      for (let k = -2; k < 3; k++) {
        g.beginPath();
        g.moveTo(k * w / 2, 0); g.lineTo(k * w / 2 + w / 4, 0); g.lineTo(k * w / 2 + w / 4 + w, w); g.lineTo(k * w / 2 + w, w);
        g.closePath(); g.fill();
      }
    }, true);
    u.chevTex = canvasTex(256, 256, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.strokeStyle = hex(C.jump); g.lineWidth = 34; g.lineCap = 'butt'; g.lineJoin = 'miter';
      g.beginPath(); g.moveTo(30, 200); g.lineTo(w / 2, 70); g.lineTo(w - 30, 200); g.stroke();
    }, true);

    u.top = new QuadBatch(220, true, false);
    u.topMat = new THREE.MeshStandardMaterial({ map: u.tileTex, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
    u.fx = new QuadBatch(700, false, true);
    u.fxMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    u.haz = new QuadBatch(400, true, false);
    u.hazMat = new THREE.MeshBasicMaterial({ map: u.stripeTex, side: THREE.DoubleSide });
    u.chev = new QuadBatch(40, true, false);
    u.chevMat = new THREE.MeshBasicMaterial({ map: u.chevTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const [b, m] of [[u.top, u.topMat], [u.fx, u.fxMat], [u.haz, u.hazMat], [u.chev, u.chevMat]]) {
      b.mesh = new THREE.Mesh(b.geo, m);
      b.mesh.frustumCulled = false;
      this.scene.add(b.mesh);
    }
    u.chev.mesh.renderOrder = 2;

    u.dotGeo = new THREE.SphereGeometry(0.17, 10, 8);
    u.dotMat = new THREE.MeshBasicMaterial({ color: C.jump });
    u.dots = new THREE.InstancedMesh(u.dotGeo, u.dotMat, 40);
    u.dots.frustumCulled = false;
    u.dots.count = 0;
    this.scene.add(u.dots);
    u.m4 = new THREE.Matrix4();

    this.scene.fog = new THREE.Fog(this.colors.void, UX_FOG_NEAR, UX_FOG_FAR);
    for (const g of this.gatePool) g.visible = false;
  }

  _layoutUx(sim) {
    const u = this._ux, C = UX_COLORS, D = UX_DECK_DEPTH;
    const track = sim.track, ballZ = sim.z;
    const zFront = ballZ + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = ballZ - SEGMENTS_BEHIND * SEGMENT_LENGTH;
    const segs = track.segments;
    u.top.begin(); u.fx.begin(); u.haz.begin(); u.chev.begin();
    for (const g of this.gatePool) g.visible = false;

    const landHold = this.ux.jumpCfg ? this.ux.jumpCfg.landingHoldSegs : 4;
    let landLeft = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.z1 < zBack) continue;
      if (seg.z0 > zFront) break;
      if (seg.jumpLanding) landLeft = landHold;
      const onPad = landLeft > 0;
      if (landLeft > 0) landLeft--;
      if (seg.isGap || seg.isTunnel) continue;

      const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);
      const wc = seg.wCenter || 0, vcRel = seg.voidCenter || 0;
      const hasVoid = (seg.void0 || 0) > 0.001 || (seg.void1 || 0) > 0.001;
      const prev = segs[i - 1];
      const afterGap = !!(prev && prev.isGap);
      // Next gap within the run-up window?
      let runUp = false, lastBeforeGap = false;
      for (let k = 1; k <= UX_RUNUP_SEGS; k++) {
        const n = segs[i + k];
        if (!n) break;
        if (n.isGap) { runUp = true; lastBeforeGap = k === 1; break; }
      }

      // Lateral strips at each end: [lo, hi] pairs (1 or 2 strips).
      const ends = u.ends;
      for (let e = 0; e < 2; e++) {
        const w = e ? seg.w1 : seg.w0, v = e ? (seg.void1 || 0) : (seg.void0 || 0);
        const r = ends[e];
        r.cx = e ? seg.cx1 : seg.cx0; r.z = e ? seg.z1 : seg.z0; r.y = e ? (seg.y1 || 0) : (seg.y0 || 0);
        r.lo = wc - w / 2; r.hi = wc + w / 2;
        r.vlo = wc + vcRel - v; r.vhi = wc + vcRel + v;
      }
      const a = ends[0], b = ends[1];
      const P = (r, lat, dy) => { u.p[0] = r.cx + lat * nx; u.p[1] = r.y + dy; u.p[2] = r.z + lat * nz; return u.p; };
      const strip = (batch, l0, h0, l1, h1, dy, uvMode, c0, c1) => {
        // near-left, near-right, far-right, far-left
        const q = u.q;
        P(a, l0, dy); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
        P(a, h0, dy); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2];
        P(b, h1, dy); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
        P(b, l1, dy); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2];
        const t = u.t;
        if (uvMode === 0) { // world tiles
          t[0] = l0 / TILE_SIZE; t[1] = a.z / TILE_SIZE; t[2] = h0 / TILE_SIZE; t[3] = a.z / TILE_SIZE;
          t[4] = h1 / TILE_SIZE; t[5] = b.z / TILE_SIZE; t[6] = l1 / TILE_SIZE; t[7] = b.z / TILE_SIZE;
        } else if (uvMode === 1) { // stripes along z
          t[0] = 0; t[1] = a.z / 0.9; t[2] = 0.5; t[3] = a.z / 0.9; t[4] = 0.5; t[5] = b.z / 0.9; t[6] = 0; t[7] = b.z / 0.9;
        } else { // chevrons: one across the width, one per 2 units of z
          t[0] = 0; t[1] = a.z / 2; t[2] = 1; t[3] = a.z / 2; t[4] = 1; t[5] = b.z / 2; t[6] = 0; t[7] = b.z / 2;
        }
        batch.quad(q, t, c0, c1, c1, c0);
      };
      // Vertical face along z at lateral lat0 (near) / lat1 (far), from dyTop down to dyBot.
      const wall = (batch, lat0, lat1, dyTop, dyBot, cTop, cBot, stripes) => {
        const q = u.q;
        P(a, lat0, dyTop); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
        P(b, lat1, dyTop); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2];
        P(b, lat1, dyBot); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
        P(a, lat0, dyBot); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2];
        const t = u.t;
        if (stripes) { t[0] = a.z / 0.9; t[1] = 1; t[2] = b.z / 0.9; t[3] = 1; t[4] = b.z / 0.9 - 0.5; t[5] = 0; t[6] = a.z / 0.9 - 0.5; t[7] = 0; }
        batch.quad(q, t, cTop, cTop, cBot, cBot);
      };
      // Face across the track at the near end (z0), lateral lo..hi, from dyTop down to dyBot.
      const front = (lo, hi, dyTop, dyBot, cTop, cBot) => {
        const q = u.q;
        P(a, lo, dyTop); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
        P(a, hi, dyTop); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2];
        P(a, hi, dyBot); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
        P(a, lo, dyBot); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2];
        u.fx.quad(q, u.t, cTop, cTop, cBot, cBot);
      };
      const voidCol = this.colors.void;
      const rimCol = onPad ? C.jump : C.rim;
      const rimW = onPad ? 0.22 : 0.12;

      if (hasVoid) {
        // Two deck strips around the void.
        strip(u.top, a.lo, a.vlo, b.lo, b.vlo, 0, 0, 0, 0);
        strip(u.top, a.vhi, a.hi, b.vhi, b.hi, 0, 0, 0, 0);
        // F2: striped lip on both void edges + striped void walls.
        const band = 0.42;
        strip(u.haz, Math.max(a.lo, a.vlo - band), a.vlo, Math.max(b.lo, b.vlo - band), b.vlo, 0.015, 1, 0, 0);
        strip(u.haz, a.vhi, Math.min(a.hi, a.vhi + band), b.vhi, Math.min(b.hi, b.vhi + band), 0.015, 1, 0, 0);
        wall(u.haz, a.vlo, b.vlo, 0, -D * 0.8, 0, 0, true);
        wall(u.haz, a.vhi, b.vhi, 0, -D * 0.8, 0, 0, true);
      } else {
        strip(u.top, a.lo, a.hi, b.lo, b.hi, 0, 0, 0, 0);
        if (seg.telegraph) {
          // F2: the middle that is about to open is striped from the moment the deck starts widening.
          strip(u.haz, wc - 0.3, wc + 0.3, wc - 0.3, wc + 0.3, 0.015, 1, 0, 0);
        }
      }
      // Outer rims (pale steel; cyan on a landing pad) and outer skirts.
      strip(u.fx, a.lo, a.lo + rimW, b.lo, b.lo + rimW, 0.02, 0, rimCol, rimCol);
      strip(u.fx, a.hi - rimW, a.hi, b.hi - rimW, b.hi, 0.02, 0, rimCol, rimCol);
      wall(u.fx, a.lo, b.lo, 0, -D, C.skirtTop, voidCol, false);
      wall(u.fx, a.hi, b.hi, 0, -D, C.skirtTop, voidCol, false);

      // F3: landing pad (first segment after a gap): front face, cyan front lip, pillars.
      if (afterGap) {
        if (hasVoid) {
          front(a.lo, a.vlo, 0, -D, C.skirtTop, voidCol);
          front(a.vhi, a.hi, 0, -D, C.skirtTop, voidCol);
        } else {
          front(a.lo, a.hi, 0, -D, C.skirtTop, voidCol);
        }
        // lip: a flat cyan band on the pad's near edge
        const lipZ = 0.3;
        const q = u.q;
        const lip = (lo, hi) => {
          P(a, lo, 0.025); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
          P(a, hi, 0.025); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2] ;
          P(a, hi, 0.025); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2] + lipZ;
          P(a, lo, 0.025); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2] + lipZ;
          u.fx.quad(q, u.t, C.jump, C.jump, C.jump, C.jump);
        };
        if (hasVoid) { lip(a.lo, a.vlo); lip(a.vhi, a.hi); } else lip(a.lo, a.hi);
        // pillars under the pad corners (and the split pad's void edges)
        const pillar = (lat) => {
          const pw = 0.32;
          P(a, lat - pw / 2, -D); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2] + 0.4;
          P(a, lat + pw / 2, -D); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2] + 0.4;
          P(a, lat + pw / 2, -D - 9); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2] + 0.4;
          P(a, lat - pw / 2, -D - 9); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2] + 0.4;
          u.fx.quad(q, u.t, C.pillar, C.pillar, voidCol, voidCol);
        };
        pillar(a.lo + 0.3); pillar(a.hi - 0.3);
        if (hasVoid) { pillar(a.vlo - 0.3); pillar(a.vhi + 0.3); }
      }

      // F3: run-up chevrons + the launch lip on the last segment before the gap.
      if (runUp && !hasVoid) {
        const inset = 0.45;
        strip(u.chev, a.lo + inset, a.hi - inset, b.lo + inset, b.hi - inset, 0.02, 2, 0, 0);
        if (lastBeforeGap) {
          const q = u.q;
          P(b, b.lo, 0.03); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2] - 0.32;
          P(b, b.hi, 0.03); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2] - 0.32;
          P(b, b.hi, 0.03); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
          P(b, b.lo, 0.03); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2];
          u.fx.quad(q, u.t, C.jump, C.jump, C.jump, C.jump);
          // Height sign on posts beside the lip, outside the deck: down triangle = drop, up = rise.
          const gapSeg = segs[i + 1];
          const ly = gapSeg && gapSeg.jumpMeta ? gapSeg.jumpMeta.landingY : 0;
          if (Math.abs(ly) > 0.01) {
            const sign = (lat) => {
              const pw = 0.12, tw = 1.0, th = 0.85, postH = 1.5;
              P(b, lat - pw / 2, 0); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
              P(b, lat + pw / 2, 0); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2];
              P(b, lat + pw / 2, postH); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
              P(b, lat - pw / 2, postH); q[9] = u.p[0]; q[10] = u.p[1]; q[11] = u.p[2];
              u.fx.quad(q, u.t, C.pillar, C.pillar, C.jump, C.jump);
              const down = ly < 0;
              const yb = postH, yt = postH + th;
              // triangle as a quad with two shared corners
              P(b, lat - tw / 2, down ? yt : yb); q[0] = u.p[0]; q[1] = u.p[1]; q[2] = u.p[2];
              P(b, lat + tw / 2, down ? yt : yb); q[3] = u.p[0]; q[4] = u.p[1]; q[5] = u.p[2];
              P(b, lat, down ? yb : yt); q[6] = u.p[0]; q[7] = u.p[1]; q[8] = u.p[2];
              q[9] = q[6]; q[10] = q[7]; q[11] = q[8];
              u.fx.quad(q, u.t, C.jump, C.jump, C.jump, C.jump);
            };
            sign(b.lo - 0.7); sign(b.hi + 0.7);
          }
        }
      }
    }
    u.top.end(); u.fx.end(); u.haz.end(); u.chev.end();
    this._layoutUxArc(sim);
  }

  /** F3: a dotted flight arc from the ball to each landing lane, the SAME formula sim.launchJump uses
   *  (impulse from the ball's current speed), shown from the moment the gap is in view until landing. */
  _layoutUxArc(sim) {
    const u = this._ux, dots = u.dots;
    let n = 0;
    const jc = this.ux.jumpCfg;
    if (jc && (sim.state === 'playing' || sim.state === 'airborne')) {
      const segs = sim.track.segments;
      let gap = null, land = null;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.jumpMeta && s.z0 + s.jumpMeta.gapLength > sim.z) { gap = s; for (let k = i; k < segs.length; k++) if (segs[k].jumpLanding) { land = segs[k]; break; } break; }
      }
      if (gap && land && gap.z0 - sim.z < SEGMENTS_AHEAD * SEGMENT_LENGTH * 0.8) {
        if (sim.state === 'playing') u.arcLat = sim.lateralOffset;
        const L = gap.jumpMeta.gapLength, Y = gap.jumpMeta.landingY;
        const T = L / Math.max(1, sim.speed);
        const vy0 = Y / T + 0.5 * jc.gravity * T;
        const wc = land.wCenter || 0, v = land.void0 || 0, hw = land.w0 / 2;
        const lanes = v > 0.001 ? [wc - (hw + v) / 2, wc + (hw + v) / 2] : [wc];
        const N = 13;
        for (const target of lanes) {
          for (let k = 1; k < N; k++) {
            const s = k / N;
            const z = gap.z0 + s * L;
            if (z < sim.z + 0.9) continue;
            const t = s * T;
            const y = vy0 * t - 0.5 * jc.gravity * t * t + BALL_RADIUS;
            const lat = u.arcLat + (target - u.arcLat) * s;
            const p = sim.track.worldPointAt(z, lat);
            u.m4.makeTranslation(p.x, y, p.z);
            if (n < 40) dots.setMatrixAt(n++, u.m4);
          }
        }
      }
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
  }

  _disposeUx() {
    const u = this._ux;
    for (const b of [u.top, u.fx, u.haz, u.chev]) b.geo.dispose();
    u.topMat.dispose(); u.fxMat.dispose(); u.hazMat.dispose(); u.chevMat.dispose();
    u.tileTex.dispose(); u.stripeTex.dispose(); u.chevTex.dispose();
    u.dotGeo.dispose(); u.dotMat.dispose(); u.dots.dispose();
    this.scene.fog = null;
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
    // MOCKUP PROTOTYPE fix: a fall starts from the height the ball was at (a lowered landing pad), not from 0.
    const fallBase = this.ux ? sim.y : 0;
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
    if (this.ux) this._layoutUx(sim);

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

      // MOCKUP PROTOTYPE: every non-tunnel deck segment is drawn by _layoutUx as one solid slab.
      if (this.ux && !seg.isTunnel) {
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

        mesh.visible = true;
        mesh.position.set(midCx + wCenter * nx, midY, midZ + wCenter * nz);
        mesh.rotation.y = yaw;
        mesh.scale.set(width, dz, 1);
        if (seg.isTunnel) {
          mesh.material = seg.showSpeedLabel && !this.ux ? this.tunnelFloorLabelMat : this.tunnelFloorMat; // MOCKUP PROTOTYPE: no words on the floor
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
      // MOCKUP PROTOTYPE: a full turn shows the heart edge-on half the time; a wobble keeps it a heart.
      mesh.rotation.set(0.15, this.ux ? Math.sin(elapsed * 2.2) * 0.55 : spin, 0);
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
    // MOCKUP PROTOTYPE (cam option only): a higher, steeper camera shows more deck and less empty sky.
    const camH = this.ux && this.ux.cam ? UX_CAM_HEIGHT : CAMERA_HEIGHT;
    const lookFrac = this.ux && this.ux.cam ? UX_CAM_LOOK_FRAC : CAMERA_LOOK_HEIGHT_FRAC;
    this.camera.position.set(camPoint.x + shakeX, camH + this._camLagY + shakeY, camPoint.z);
    this.camera.lookAt(lookPoint.x, camH * lookFrac + this._camLagY, lookPoint.z);

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
    this.renderer.dispose();
    // Non-negotiable 7 continued: dispose() alone leaves the WebGL context to be reclaimed by
    // GC, not immediately - repeated hub<->game remounts can pile up toward the browser's
    // context cap before that happens (see ARCH-REVIEW.md S4-6). forceContextLoss() releases it
    // synchronously on teardown. Only when actually leaving the game (loseContext) - see the
    // dispose() doc comment for why an in-place restart must skip this.
    if (loseContext && typeof this.renderer.forceContextLoss === 'function') this.renderer.forceContextLoss();
    if (this.ux) this._disposeUx();
    this.scene.clear();
  }
}
