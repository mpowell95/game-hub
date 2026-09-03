// golf/js/camera.js - camera state machine. See §10.2 of GOLF-HANDOFF.md.
// B = ball position, a-hat = aim direction (unit, horizontal, 0deg = +z, matching physics.js's
// dir convention), y-hat = (0,1,0). Every state's target is computed once at setX() time except
// 'flight', which tracks the ball continuously every update().

import * as THREE from './vendor/three.module.min.js';
import { heightAt } from './terrain.js';

const MIN_CLEARANCE = 0.6;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function dirVec(deg) {
  const r = deg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
}

export function createCamera(aspect) {
  return new THREE.PerspectiveCamera(55, aspect, 0.1, 1500);
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

  // ball: {x,y,z}. aimDeg: the shot's current aim direction (targetBearingDeg + aimDeg, ui.js's
  // job to compute). pos = B - 6a + 2.5y, look = B + 40a.
  setAddress(ball, aimDeg) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const a = dirVec(aimDeg);
    const pos = B.clone().addScaledVector(a, -6).add(new THREE.Vector3(0, 2.5, 0));
    const look = B.clone().addScaledVector(a, 40);
    this._startTween(this.camera.position, this._curLook, pos, look, 0.6, false);
  }

  // pos = B - 2a + 1.0y, look = B + 8a.
  setPutt(ball, aimDeg) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const a = dirVec(aimDeg);
    const pos = B.clone().addScaledVector(a, -2).add(new THREE.Vector3(0, 1.0, 0));
    const look = B.clone().addScaledVector(a, 8);
    this._startTween(this.camera.position, this._curLook, pos, look, 0.6, false);
  }

  // Continuous: every update() call, lerp(cam, B - 8a + 3y, 0.08); lookAt B + 0.6y. aimDeg is
  // the shot's fixed launch direction (dirDeg), not recomputed as the ball curves.
  setFlight(aimDeg) {
    this._mode = 'flight';
    this._skippable = false;
    this._flightAimDeg = aimDeg;
  }

  // ball: the ball's final rest position. pin: [x,z]. p-hat = direction ball -> pin.
  // pos = B - 6p + 2.5y, look = B + 40p.
  setRest(ball, pin) {
    const B = new THREE.Vector3(ball.x, ball.y, ball.z);
    const dx = pin[0] - ball.x, dz = pin[1] - ball.z;
    const len = Math.hypot(dx, dz) || 1;
    const p = new THREE.Vector3(dx / len, 0, dz / len);
    const pos = B.clone().addScaledVector(p, -6).add(new THREE.Vector3(0, 2.5, 0));
    const look = B.clone().addScaledVector(p, 40);
    this._startTween(this.camera.position, this._curLook, pos, look, 0.8, false);
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
      const target = B.clone().addScaledVector(a, -8).add(new THREE.Vector3(0, 3, 0));
      this.camera.position.lerp(target, 0.08);
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
