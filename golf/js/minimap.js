// golf/js/minimap.js - the overhead map inset (Part 9A, §10.4 of GOLF-HANDOFF.md). Pure 2D
// canvas drawing: the hole's surface grid rotated so the tee-to-pin line is vertical (pin at
// the top), cropped to the hole's bounds, plus ball / pin / aim line / landing ring overlays.
// Redraws only when one of its inputs changes; the base map is rasterised once per hole.
//
// The same transform runs both ways: worldToMap() for drawing and mapToWorld() for a tap, so a
// tap on the map lands on exactly the world point drawn under the finger.

import { S, surfaceAt } from './terrain.js';
import { COL } from './render.js';

export const MAP_W = 116;
export const MAP_H = 156;
const PAD = 4;              // px inside the panel the hole is fitted into
const BG = 'rgba(0,0,0,0.55)';

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas  sized MAP_W x MAP_H CSS px (this scales for DPR itself)
   * @param {object} terrain            terrain.js build()
   */
  constructor(canvas, terrain) {
    this.canvas = canvas;
    this.terrain = terrain;
    this.dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
    canvas.width = Math.round(MAP_W * this.dpr);
    canvas.height = Math.round(MAP_H * this.dpr);
    this.ctx = canvas.getContext('2d');
    this._last = null;
    this._buildTransform();
    this._buildBase();
  }

  // Rotation puts the tee->pin bearing straight up. Then fit the rotated terrain bounds into
  // the panel, preserving aspect, centred.
  _buildTransform() {
    const t = this.terrain;
    const def = t.def;
    const bx = def.pin[0] - def.tee[0], bz = def.pin[1] - def.tee[1];
    const theta = Math.atan2(bx, bz);           // bearing of tee->pin (0 = +z)
    // rotate world so bearing theta maps to "up" (map -y): u = x*cos - z*sin, v = x*sin + z*cos
    // ... i.e. rotate by -theta about y; after that the pin lies along +v, which we draw upward.
    this.cos = Math.cos(theta); this.sin = Math.sin(theta);
    const corners = [
      [t.x0, t.z0], [t.x0 + t.nx - 1, t.z0], [t.x0, t.z0 + t.nz - 1], [t.x0 + t.nx - 1, t.z0 + t.nz - 1],
    ];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of corners) {
      const { u, v } = this._rot(x, z);
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const spanU = maxU - minU || 1, spanV = maxV - minV || 1;
    const scale = Math.min((MAP_W - 2 * PAD) / spanU, (MAP_H - 2 * PAD) / spanV);
    this.scale = scale;
    this.offU = MAP_W / 2 - ((minU + maxU) / 2) * scale;
    this.offV = MAP_H / 2 + ((minV + maxV) / 2) * scale;   // v grows UP the screen
  }

  // Rotate by -theta so the tee->pin direction lands on +v (drawn UP), and MIRROR u: a three.js
  // camera looking along +z has world +x on its LEFT (right = forward x up = (-1,0,0)), so for
  // "left on the map" to mean "left in the 3D view" - which is what makes a map tap feel right -
  // world +x must be drawn to the map's left. Same mirror in _unrot, so taps invert exactly.
  _rot(x, z) {
    return { u: -(x * this.cos - z * this.sin), v: x * this.sin + z * this.cos };
  }
  _unrot(u, v) {
    const uu = -u;
    return { x: uu * this.cos + v * this.sin, z: -uu * this.sin + v * this.cos };
  }

  /** world (x,z) -> map CSS px (mx, my). */
  worldToMap(x, z) {
    const { u, v } = this._rot(x, z);
    return { mx: this.offU + u * this.scale, my: this.offV - v * this.scale };
  }
  /** map CSS px -> world (x,z). */
  mapToWorld(mx, my) {
    const u = (mx - this.offU) / this.scale, v = (this.offV - my) / this.scale;
    return this._unrot(u, v);
  }

  // One pixel per cell, scaled to fit: iterate DESTINATION pixels and sample the surface grid
  // through the inverse transform, so the rotated raster has no holes. OB is left as the panel
  // background. Cached as an ImageData for the life of this map.
  _buildBase() {
    const dpr = this.dpr;
    const w = this.canvas.width, h = this.canvas.height;
    const img = this.ctx.createImageData(w, h);
    const d = img.data;
    const colOf = {};
    for (const k of Object.keys(COL)) {
      const c = COL[k];
      colOf[k] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    }
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const { x, z } = this.mapToWorld(px / dpr, py / dpr);
        const s = surfaceAt(this.terrain, x, z);
        const o = (py * w + px) * 4;
        if (s === S.OB) { d[o + 3] = 0; continue; }
        const c = colOf[s] || colOf[1];
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    this._base = img;
  }

  /**
   * Redraw if anything changed. ball: {x,z}; aimDeg: degrees (0 = +z); carryM: predicted carry
   * along the aim, metres; pin: [x,z]. Cheap to call every frame.
   */
  update(ball, aimDeg, carryM, pin) {
    const key = `${ball.x.toFixed(2)},${ball.z.toFixed(2)},${aimDeg.toFixed(2)},${carryM.toFixed(1)},${pin[0]},${pin[1]}`;
    if (key === this._last) return;
    this._last = key;
    this._draw(ball, aimDeg, carryM, pin);
  }

  _draw(ball, aimDeg, carryM, pin) {
    const ctx = this.ctx, dpr = this.dpr;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // The base has OB as transparent pixels; putImageData does not composite, so paint the panel
    // background BEHIND it afterwards - that is what makes OB read as the panel.
    ctx.putImageData(this._base, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // aim line: ball -> landing ring
    const rad = aimDeg * Math.PI / 180;
    const lx = ball.x + Math.sin(rad) * carryM, lz = ball.z + Math.cos(rad) * carryM;
    const b = this.worldToMap(ball.x, ball.z);
    const l = this.worldToMap(lx, lz);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(b.mx, b.my); ctx.lineTo(l.mx, l.my); ctx.stroke();

    // landing ring: 4 px circle, #ffce3a
    ctx.strokeStyle = '#ffce3a';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(l.mx, l.my, 2, 0, Math.PI * 2); ctx.stroke();

    // pin: 5 px flag mark
    const p = this.worldToMap(pin[0], pin[1]);
    ctx.fillStyle = '#ffce3a';
    ctx.fillRect(p.mx - 0.5, p.my - 5, 1, 5);
    ctx.beginPath(); ctx.moveTo(p.mx + 0.5, p.my - 5); ctx.lineTo(p.mx + 4, p.my - 3.5); ctx.lineTo(p.mx + 0.5, p.my - 2); ctx.closePath(); ctx.fill();

    // ball: white 4 px dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(b.mx, b.my, 2, 0, Math.PI * 2); ctx.fill();
  }

  /** Bearing (degrees, 0 = +z) from `ball` to the world point under map CSS px (mx, my). */
  bearingFromTap(ball, mx, my) {
    const { x, z } = this.mapToWorld(mx, my);
    return Math.atan2(x - ball.x, z - ball.z) * 180 / Math.PI;
  }
}
