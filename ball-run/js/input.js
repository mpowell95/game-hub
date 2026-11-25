// input.js — relative drag steering (brief section 4). Samples raw pointer/mouse
// movement into a normalized-delta accumulator; the fixed-step sim consumes and
// resets it once per tick (consumeDragAxis), so input never mutates game state
// directly from the event handler.

import { DRAG_GAIN_SLOW, DRAG_GAIN_FAST, DRAG_V_SLOW, DRAG_V_FAST } from './config.js';

const ARROW_AXIS = { ArrowLeft: -1, ArrowRight: 1 };

/** Pointer acceleration (config.js, "Steering rebuilt"): the gain for a thumb moving at `v` screen widths per second. */
export function dragGain(v) {
  if (!(v > DRAG_V_SLOW)) return DRAG_GAIN_SLOW;
  if (v >= DRAG_V_FAST) return DRAG_GAIN_FAST;
  const f = (v - DRAG_V_SLOW) / (DRAG_V_FAST - DRAG_V_SLOW);
  return DRAG_GAIN_SLOW + (DRAG_GAIN_FAST - DRAG_GAIN_SLOW) * f * f * (3 - 2 * f); // smoothstep: no sudden jump
}

export class InputController {
  constructor(el) {
    this.el = el;
    this.dragging = false;
    this.lastX = 0;
    this.lastT = 0;
    this._v = 0;             // smoothed thumb speed, screen widths per second
    this._axisAccum = 0; // normalized (delta-x / element width) x the acceleration gain, reset on consume
    this._keyLeft = false;
    this._keyRight = false;

    this._onPointerDown = (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastT = e.timeStamp;
      this._v = 0;
      try { this.el.setPointerCapture(e.pointerId); } catch { /* not all pointer types support capture */ }
    };
    this._onPointerMove = (e) => {
      if (!this.dragging) return;
      const w = this.el.clientWidth || 1;
      const dx = (e.clientX - this.lastX) / w;
      const dt = Math.max(1, e.timeStamp - this.lastT) / 1000;
      // thumb speed, lightly smoothed so one jittery event cannot jump the gain
      this._v = this._v * 0.5 + (Math.abs(dx) / dt) * 0.5;
      this._axisAccum += dx * dragGain(this._v);
      this.lastX = e.clientX;
      this.lastT = e.timeStamp;
    };
    this._onPointerUp = () => { this.dragging = false; };
    this._onKeyDown = (e) => {
      if (e.key === 'ArrowLeft') this._keyLeft = true;
      else if (e.key === 'ArrowRight') this._keyRight = true;
    };
    this._onKeyUp = (e) => {
      if (e.key === 'ArrowLeft') this._keyLeft = false;
      else if (e.key === 'ArrowRight') this._keyRight = false;
    };
    this._onBlur = () => { this.dragging = false; this._keyLeft = false; this._keyRight = false; };

    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('pointerleave', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** Normalized horizontal drag delta accumulated since the last call; resets to 0. */
  consumeDragAxis() {
    const v = this._axisAccum;
    this._axisAccum = 0;
    return v;
  }

  /** -1 / 0 / 1 from held arrow keys (free bonus, per brief section 4). */
  keyAxis() {
    if (this._keyLeft && !this._keyRight) return -1;
    if (this._keyRight && !this._keyLeft) return 1;
    return 0;
  }

  reset() {
    this.dragging = false;
    this._axisAccum = 0;
    this._keyLeft = false;
    this._keyRight = false;
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this._onPointerDown);
    this.el.removeEventListener('pointermove', this._onPointerMove);
    this.el.removeEventListener('pointerup', this._onPointerUp);
    this.el.removeEventListener('pointercancel', this._onPointerUp);
    this.el.removeEventListener('pointerleave', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}

export { ARROW_AXIS };
