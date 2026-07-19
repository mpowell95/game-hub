// render.js — maps sim.js's plain-data state onto pooled Three.js objects every
// animation frame (brief section 3, non-negotiables 2 and 3). No game logic
// lives here: this module only reads Sim/Track data and positions meshes.
// All meshes/geometries/materials/textures are created once at load and reused;
// nothing here allocates per frame.

import * as THREE from '../vendor/three.module.min.js';
import {
  SEGMENT_LENGTH, SEGMENTS_AHEAD, SEGMENTS_BEHIND, BALL_RADIUS, OBSTACLE_SIZE, TILE_SIZE,
  CAMERA_LAG, CAMERA_HEIGHT, CAMERA_BACK, CAMERA_LOOK_AHEAD, CAMERA_LOOK_HEIGHT_FRAC,
  CAMERA_BASE_FOV, CAMERA_MAX_FOV_KICK,
  COLOR_VOID, COLOR_BALL, COLOR_TRACK_TILE, COLOR_TRACK_GROUT, COLOR_OBSTACLE, COLOR_OBSTACLE_EDGE,
  COLOR_TUNNEL_WALL, COLOR_TUNNEL_EDGE, COLOR_CHEVRON, COLOR_SHADOW, CRASH_SHAKE_MS, difficultyConfig,
} from './config.js';

const FLOOR_POOL_SIZE = SEGMENTS_AHEAD + SEGMENTS_BEHIND;
const WALL_POOL_SIZE = (SEGMENTS_AHEAD + SEGMENTS_BEHIND) * 2; // left + right per segment
const OBSTACLE_POOL_SIZE = 24;

// One repeatable TILE_SIZE-unit tile: grout drawn only on the top/left edges
// so REPEAT-wrapping produces a single continuous grid line per tile boundary
// instead of a doubled-up line (verify-item B: the old texture baked a full
// bordered 2x2 pattern into every segment's plane independent of its world
// size, so segment joins showed as duplicated/misaligned seams - a "venetian
// blind" look instead of one continuous tiled ribbon).
function buildTileTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + COLOR_TRACK_TILE.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#' + COLOR_TRACK_GROUT.toString(16).padStart(6, '0');
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

function buildTunnelFloorTexture(withLabel) {
  const w = 256, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + COLOR_TRACK_TILE.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#' + COLOR_CHEVRON.toString(16).padStart(6, '0');
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

function buildTunnelWallTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + COLOR_TUNNEL_WALL.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#' + COLOR_TUNNEL_EDGE.toString(16).padStart(6, '0');
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
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(COLOR_VOID, 1);
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
    this._shakeUntil = 0;
    this._shakeSeed = Math.random() * 1000;

    this._buildTextures();
    this._buildBall();
    this._buildFloorPool();
    this._buildWallPool();
    this._buildObstaclePool();
  }

  _buildTextures() {
    this.tileTex = buildTileTexture();
    this.tunnelFloorTex = buildTunnelFloorTexture(false);
    this.tunnelFloorLabelTex = buildTunnelFloorTexture(true);
    this.tunnelWallTex = buildTunnelWallTexture();
  }

  _buildBall() {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: COLOR_BALL, roughness: 0.3, metalness: 0.15 });
    this.ball = new THREE.Mesh(geo, mat);
    this.ball.position.set(0, BALL_RADIUS, 0);
    this.scene.add(this.ball);
    this._ballGeo = geo; this._ballMat = mat;

    const shadowGeo = new THREE.CircleGeometry(BALL_RADIUS * 0.9, 20);
    const shadowMat = new THREE.MeshBasicMaterial({ color: COLOR_SHADOW, transparent: true, opacity: 0.35 });
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
    }
  }

  _buildWallPool() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._wallGeo = geo;
    this.wallMat = new THREE.MeshStandardMaterial({
      map: this.tunnelWallTex, color: COLOR_TUNNEL_EDGE, emissive: COLOR_TUNNEL_EDGE, emissiveIntensity: 0.25,
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
      color: COLOR_OBSTACLE, emissive: COLOR_OBSTACLE, emissiveIntensity: 0.5, roughness: 0.4,
    });
    this.obstacleEdgeMat = new THREE.LineBasicMaterial({ color: COLOR_OBSTACLE_EDGE });
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
    const ballY = sim.state === 'falling' ? Math.max(-14, sim.fallY) + BALL_RADIUS : BALL_RADIUS;

    this.ball.position.set(ballWorldX, ballY, ballWorldZ);
    this.ball.rotation.x = sim.rollAngle;
    // Slight roll bank into turns, purely cosmetic.
    this.ball.rotation.z = Math.max(-0.4, Math.min(0.4, -sim.lateralVelocity * 0.06));

    this.ballShadow.visible = sim.state !== 'falling';
    this.ballShadow.position.set(ballWorldX, 0.02, ballWorldZ);

    // Segment windowing uses sim.z (the track-distance parameter), not ballWorldZ (the ball's true
    // world Z, which includes a small lateral-offset contribution from worldPointAt above).
    this._layoutFloor(track, sim.z);
    this._layoutObstacles(track, sim.z);

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
      const left = this.wallPool[wallIdx];
      const right = this.wallPool[wallIdx + 1];
      const seg = visible[i];
      if (!seg) {
        mesh.visible = false;
        if (left) left.visible = false;
        if (right) right.visible = false;
        wallIdx += 2;
        continue;
      }
      const midCx = (seg.cx0 + seg.cx1) / 2;
      const midZ = (seg.z0 + seg.z1) / 2;
      const width = (seg.w0 + seg.w1) / 2;
      const dz = seg.z1 - seg.z0;
      const yaw = Math.atan2(seg.cx1 - seg.cx0, dz);

      mesh.visible = true;
      mesh.position.set(midCx, 0, midZ);
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

      if (seg.isTunnel && left && right) {
        const wallH = 3.2;
        left.visible = true; right.visible = true;
        left.scale.set(dz, wallH, 1);
        right.scale.set(dz, wallH, 1);
        const halfW = width / 2;
        // Inward-facing side walls, offset perpendicular to the segment's local direction.
        const nx = Math.cos(yaw), nz = -Math.sin(yaw);
        left.position.set(midCx - nx * halfW, wallH / 2, midZ - nz * halfW);
        right.position.set(midCx + nx * halfW, wallH / 2, midZ + nz * halfW);
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
      // Same local-right-vector fix as the ball (item 1): a cube's `lateral` is relative to the
      // centerline, so it must be applied along the segment's own tangent-perpendicular, not raw
      // world X, or cubes drift off the visually rotated floor quad during a curve exactly like
      // the ball did.
      const yaw = Math.atan2(seg.cx1 - seg.cx0, seg.z1 - seg.z0);
      const nx = Math.cos(yaw), nz = -Math.sin(yaw);
      for (const c of seg.obstacles) cubes.push({ x: midCx + c.lateral * nx, z: midZ + c.lateral * nz, yaw });
      if (cubes.length >= OBSTACLE_POOL_SIZE) break;
    }
    for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
      const mesh = this.obstaclePool[i];
      const c = cubes[i];
      if (!c) { mesh.visible = false; continue; }
      mesh.visible = true;
      mesh.scale.set(OBSTACLE_SIZE, OBSTACLE_SIZE, OBSTACLE_SIZE);
      mesh.position.set(c.x, OBSTACLE_SIZE / 2, c.z);
      mesh.rotation.y = c.yaw;
    }
  }

  /**
   * Camera locked to the track's local frame (item 1 fix): both position and look-at target are
   * computed from track.worldPointAt at track-distances behind/ahead of the ball, using the SAME
   * damped lateral offset the ball itself would have there. Through a curve this rotates the
   * camera's yaw with the track's tangent (via lookAt on two points that both sit on the curving
   * centerline) instead of holding a fixed world-Z heading, so the world turns around a visually
   * planted ball; only CAMERA_LAG's small easing produces on-screen lateral motion.
   */
  _layoutCamera(sim, reducedMotion) {
    const track = sim.track;
    this._camLagLateral += (sim.lateralOffset - this._camLagLateral) * CAMERA_LAG;

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
    this.camera.position.set(camPoint.x + shakeX, CAMERA_HEIGHT + shakeY, camPoint.z);
    this.camera.lookAt(lookPoint.x, CAMERA_HEIGHT * CAMERA_LOOK_HEIGHT_FRAC, lookPoint.z);

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
  }

  dispose() {
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
    this._wallGeo.dispose(); this.wallMat.dispose();
    this._obstacleGeo.dispose(); this._obstacleEdgesGeo.dispose();
    this.obstacleMat.dispose(); this.obstacleEdgeMat.dispose();
    this.tileTex.dispose(); this.tunnelFloorTex.dispose(); this.tunnelFloorLabelTex.dispose(); this.tunnelWallTex.dispose();
    this.renderer.dispose();
    this.scene.clear();
  }
}
