// golf/js/camera.js - camera state machine. See §10.2 of GOLF-HANDOFF.md (rewritten Part 9A).
// B = ball position, a-hat = aim direction (unit, horizontal, 0deg = +z, matching physics.js's
// dir convention), y-hat = (0,1,0). Every state's target is computed once at setX() time except
// 'flight', which tracks the ball continuously every update().
//
// Part 9A: the address/putt/rest poses are HIGH and far back (B - 16a + 9y for a full shot) so
// the landing zone and the hazards around it are readable, and the ball is pinned at 30% up
// from the bottom of the view. That second rule is what decides the camera's PITCH: the doc's
// nominal lookAt (B + 70a) puts the ball at 30% up only at one particular aspect ratio, so the
// pitch is derived from the 30% rule directly (see _lookFor30) and holds at every viewport. The
// FOV is 50 deg HORIZONTAL - three.js's `fov` is vertical, so applyHFov() converts it per aspect
// on every resize; at a phone's portrait aspect that is what makes "B + 70a" and "30% up" agree.

import * as THREE from './vendor/three.module.min.js';
import { heightAt } from './terrain.js';

const MIN_CLEARANCE = 1.0;       // camera never goes below heightAt + 1.0 (Part 9A, was 0.6)
export const H_FOV_DEG = 50;     // horizontal field of view
const BALL_SCREEN_FRAC = 0.30;   // ball sits 30% up from the bottom of the view at address/putt/rest
const AIM_TWEEN_S = 0.25;        // orbit time when the aim direction changes

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function dirVec(deg) {
  const r = deg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
}

/** Set the camera's vertical fov so the HORIZONTAL fov is H_FOV_DEG at its current aspect. */
export function applyHFov(camera) {
  const halfH = (H_FOV_DEG / 2) * Math.PI / 180;
  const halfV = Math.atan(Math.tan(halfH) / camera.aspect);
  camera.fov = halfV * 2 * 180 / Math.PI;
  camera.updateProjectionMatrix();
}

export function createCamera(aspect) {
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1500);
  applyHFov(cam);
  return cam;
}

export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain || null;
    this._mode = null; // 'tween' | 'flight' | null (idle)
    this._skippable = false;
    this._t = 0;
    this._duration = 0;
    this._fromPos = new THREE.Vector3();
    this._toPos = new THREE.Vector3();
    this._fromLook = new THREE.Vector3();
    this._toLook = new THREE.Vector3();
    this._curLook = new THREE.Vector3(0, 0, -1);
    this._flightAimDeg = 0;
  }

  setTerrain(t) { this.terrain = t; }

  get idle() { return this._mode === null; }

  _startTween(fromPos, fromLook, toPos, toLook, duration, skippable) {
    this._mode = 'tween';
    this._skippable = !!skippable;
    this._t = 0;
    this._duration = duration;
    this._fromPos.copy(fromPos);
    this._toPos.copy(toPos);
    this._fromLook.copy(fromLook);
    this._toLook.copy(toLook);
  }

  // hole.intro.from/to are world coords, [x,y,z]; lookAt tweens pin -> tee. Tap-skippable.
  setIntro(hole) {
    const from = new THREE.Vector3(hole.intro.from[0], hole.intro.from[1], hole.intro.from[2]);
    const to = new THREE.Vector3(hole.intro.to[0], hole.intro.to[1], hole.intro.to[2]);
    const pinLook = new THREE.Vector3(hole.pin[0], this._groundY(hole.pin[0], hole.pin[1]), hole.pin[1]);
    const teeLook = new THREE.Vector3(hole.tee[0], this._groundY(hole.tee[0], hole.tee[1]), hole.tee[1]);
    this._startTween(from, pinLook, to, teeLook, 1.6, true);
  }

  // The look point that puts the ball BALL_SCREEN_FRAC up from the bottom of the view, looking
  // horizontally along `a` from `pos`. The ball's depression below the camera's horizontal is
  // fixed by the pose; the view centre must sit (that depression - the angle that maps to 30%
  // up) below horizontal.
  _lookFor30(pos, B, a) {
    const halfV = (this.camera.fov / 2) * Math.PI / 180;
    const ndcY = -(1 - 2 * BALL_SCREEN_FRAC);                       // -0.4: 30% up from the bottom
    const ballBelowCentre = Math.atan(-ndcY * Math.tan(halfV));     // angle below the view centre
    const dx = B.x - pos.x, dz = B.z - pos.z, dy = B.y - pos.y;
    const horiz = Math.hypot(dx, dz) || 1e-6;
    const ballDepression = Math.atan2(-dy, horiz);                 // angle of the ball below horizontal
    const pitch = ballDepression - ballBelowCentre;                 // view-centre pitch below horizontal
    const L = 70;
    return pos.clone().add(new THREE.Vector3(a.x * Math.cos(pitch) * L, -Math.sin(pitch) * L, a.z * Math.cos(pitch) * L));
  }

  _poseAddress(ball, aimDeg) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const a = dirVec(aimDeg);
    const pos = B.clone().addScaledVector(a, -16).add(new THREE.Vector3(0, 9, 0));
    return { pos, look: this._lookFor30(pos, B, a) };
  }

  _posePutt(ball, aimDeg) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const a = dirVec(aimDeg);
    const pos = B.clone().addScaledVector(a, -5).add(new THREE.Vector3(0, 3, 0));
    return { pos, look: this._lookFor30(pos, B, a) };
  }

  // ball: {x,y,z}. aimDeg: the shot's current aim direction. pos = B - 16a + 9y; pitch from the
  // 30%-up rule (nominally look = B + 70a).
  setAddress(ball, aimDeg) {
    const p = this._poseAddress(ball, aimDeg);
    this._startTween(this.camera.position, this._curLook, p.pos, p.look, 0.6, false);
  }

  // pos = B - 5a + 3y; pitch from the 30%-up rule (nominally look = B + 12a).
  setPutt(ball, aimDeg) {
    const p = this._posePutt(ball, aimDeg);
    this._startTween(this.camera.position, this._curLook, p.pos, p.look, 0.6, false);
  }

  // The aim direction changed (drag or map tap): orbit to the new a-hat over AIM_TWEEN_S with
  // the same ease, ball still pinned at 30% up.
  aimTo(ball, aimDeg, isPutt) {
    const p = isPutt ? this._posePutt(ball, aimDeg) : this._poseAddress(ball, aimDeg);
    this._startTween(this.camera.position, this._curLook, p.pos, p.look, AIM_TWEEN_S, false);
  }

  // Continuous: every update() call, lerp(cam, B - 10a + 5y, 0.06); lookAt B + 0.6y. aimDeg is
  // the shot's fixed launch direction (dirDeg), not recomputed as the ball curves.
  setFlight(aimDeg) {
    this._mode = 'flight';
    this._skippable = false;
    this._flightAimDeg = aimDeg;
  }

  // ball: the ball's final rest position. pin: [x,z]. p-hat = direction ball -> pin.
  // pos = B - 16p + 9y, pitch from the 30%-up rule (nominally look = B + 70p).
  setRest(ball, pin) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const dx = pin[0] - ball.x, dz = pin[1] - ball.z;
    const len = Math.hypot(dx, dz) || 1;
    const p = new THREE.Vector3(dx / len, 0, dz / len);
    const pos = B.clone().addScaledVector(p, -16).add(new THREE.Vector3(0, 9, 0));
    this._startTween(this.camera.position, this._curLook, pos, this._lookFor30(pos, B, p), 0.8, false);
  }

  // Jumps the current tween to its end instantly. No-op outside a skippable tween (only intro
  // is skippable per §10.2).
  skip() {
    if (this._mode === 'tween' && this._skippable) {
      this._applyTween(1);
      this._mode = null;
    }
  }

  _applyTween(t) {
    const e = easeOutCubic(t);
    this.camera.position.copy(this._fromPos.clone().lerp(this._toPos, e));
    this._curLook.copy(this._fromLook.clone().lerp(this._toLook, e));
    this.camera.lookAt(this._curLook);
  }

  _groundY(x, z) {
    return this.terrain ? heightAt(this.terrain, x, z) : 0;
  }

  // dt in seconds. ballPos required (and used) only while in 'flight' mode.
  update(dt, ballPos) {
    if (this._mode === 'tween') {
      this._t += dt;
      const t = Math.min(1, this._duration > 0 ? this._t / this._duration : 1);
      this._applyTween(t);
      if (t >= 1) this._mode = null;
    } else if (this._mode === 'flight' && ballPos) {
      const B = new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
      const a = dirVec(this._flightAimDeg);
      const target = B.clone().addScaledVector(a, -10).add(new THREE.Vector3(0, 5, 0));
      this.camera.position.lerp(target, 0.06);
      this._curLook.copy(B).add(new THREE.Vector3(0, 0.6, 0));
      this.camera.lookAt(this._curLook);
    }
    this._clampHeight();
  }

  _clampHeight() {
    if (!this.terrain) return;
    const floor = heightAt(this.terrain, this.camera.position.x, this.camera.position.z) + MIN_CLEARANCE;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
  }
}
