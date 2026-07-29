// render.js — maps sim.js's plain-data state onto pooled Three.js objects every
// animation frame (brief section 3, non-negotiables 2 and 3). No game logic
// lives here: this module only reads Sim/Track data and positions meshes.
// All meshes/geometries/materials/textures are created once at load and reused;
// nothing here allocates per frame.

import * as THREE from '../vendor/three.module.min.js';
import {
  SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND, BALL_RADIUS, BALL_DIAMETER, OBSTACLE_SIZE, TILE_SIZE,
  CAMERA_LAG, CAMERA_HEIGHT, CAMERA_BACK, CAMERA_LOOK_AHEAD, CAMERA_LOOK_HEIGHT_FRAC,
  CAMERA_BASE_FOV, CAMERA_MAX_FOV_KICK, CRASH_SHAKE_MS, mapConfig,
} from './config.js';

const FLOOR_POOL_SIZE = SEGMENTS_AHEAD + SEGMENTS_BEHIND;
const WALL_POOL_SIZE = (SEGMENTS_AHEAD + SEGMENTS_BEHIND) * 2; // left + right per segment
const OBSTACLE_POOL_SIZE = 24;
// Pickups (Phase 4, Orbital only): sparse compared to obstacles (30m+ mean cadence vs. tight
// obstacle spacing), so a small pool comfortably covers everything ever visible in the render
// window at once. Two separate pools (not one shared one) since each pickup type is its own
// GEOMETRY, not just a color swap - a sphere for orbs, an octahedron for the rarer life pickup
// (root CLAUDE.md's colorblind rule: shape marker, never hue alone).
const ORB_POOL_SIZE = 6;
const LIFE_POOL_SIZE = 2;
// Split (Orbital only, BALLRUNMAP2ORBITALSPEC.md section 2): a void-bearing segment renders as
// TWO floor strips instead of one, so every floor slot gets a second, independently-scaled quad
// (floorPool2, hidden whenever that slot's segment has no void - i.e. always, on Classic). Also
// up to 2 thin amber accent lines per slot: either the Widen-phase telegraph (1 line, at lateral
// 0) or the void band's two inner edges (2 lines) - never both on the same segment.
const ACCENT_POOL_SIZE = FLOOR_POOL_SIZE * 2;

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
    this._buildPickupPools();
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

  /** Pickups (Phase 4, Orbital only): a small sphere for orbs, a small octahedron for the rarer
   *  life pickup - distinct GEOMETRY, not just color, per root CLAUDE.md's colorblind rule
   *  ("pair each hue with a shape marker, never hue alone"). Both emissive so they read clearly
   *  against the dark deck without needing their own light. Built once regardless of map (same
   *  reason every other pool here is) - `this.colors.orb`/`.life` exist on every map's palette
   *  even though only Orbital's `map.jump`-sibling `map.pickups` config ever actually spawns one. */
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

    const lifeGeo = new THREE.OctahedronGeometry(BALL_RADIUS * 0.7);
    this._lifeGeo = lifeGeo;
    this.lifeMat = new THREE.MeshStandardMaterial({ color: this.colors.life, emissive: this.colors.life, emissiveIntensity: 0.6, roughness: 0.35 });
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
    const ballY = sim.state === 'falling' ? Math.max(-14, sim.fallY) + BALL_RADIUS : sim.y + BALL_RADIUS;

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

    this._layoutCamera(sim, reducedMotion);

    this.renderer.render(this.scene, this.camera);
  }

  _layoutFloor(track, ballZ) {
    const zFront = ballZ + SEGMENTS_AHEAD * SEGMENT_LENGTH;
    const zBack = ballZ - SEGMENTS_BEHIND * SEGMENT_LENGTH;
    const visible = track.segments.filter((s) => s.z1 >= zBack && s.z0 <= zFront);

    let wallIdx = 0;
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
      mesh.rotation.set(spin * 0.6, spin, 0);
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
    this._camLagLateral += (sim.lateralOffset - this._camLagLateral) * CAMERA_LAG;
    this._camLagY += (sim.y - this._camLagY) * CAMERA_LAG;

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
    this.scene.clear();
  }
}
