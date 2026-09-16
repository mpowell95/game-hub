// hole-editor/js/canvas.js - the canvas: camera, drawing, thumbnails. Step 3 covers drawing-order
// steps 1/2/3/4/5/8 (section 5.2) and the camera (5.1); object outlines/handles/ruler (steps 6/7/9)
// and hit-testing (5.5) are added in step 4 alongside the tools that need them.
//
// R5: nothing here computes its own fairway polygon, route, bounds or yardage - everything drawn
// is read off the BUILT hole (`buildHole()` in model.js), the same object the game itself plays.

import { buildMap, paletteFor, slopeGlyphAngle, SLOPE_TINT, SLOPE_GLYPH_FRAC } from '../../golf/js/render.js';
import { treesOf, greenBox } from '../../golf/js/holes.js';

const THEME = 'desert';
// render.js's own thresholds (SLOPE_FLAT, SLOPE_MIN_PX) are not exported - copied here as plain
// drawing constants, not geometry, so this stays a faithful copy of what the game shows rather
// than a second opinion about it.
const SLOPE_FLAT = 0.06;
const SLOPE_MIN_PX = 3.5;
// The three desert TREE_FILL values, copied from render.js (also not exported) - section 5.2 step 2.
const TREE_FILL = {
  saguaro: ['#3f7a3a', '#22421f'],
  paloverde: ['#7f9a3f', '#4c6224'],
  boulder: ['#8b7f72', '#4d453d'],
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Fit camera: whole `bounds` visible with a 24px margin (section 5.1). */
export function fitCamera(built, W, H) {
  const b = built.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const margin = 24;
  const ppy = Math.max(0.5, Math.min(12, Math.min((W - margin * 2) / w, (H - margin * 2) / h)));
  return { ppy, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
}

/** One `<canvas>` per hole thumbnail (section 4.2): buildMap's canvas, letterboxed, never
 *  cropped - the same rule `_paintHoleStrip`/`sheet-course.mjs` use. `cv` must already have its
 *  pixel width/height set (css-size * dpr) by the caller. */
export function renderMapThumbnail(built, cv) {
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const pal = paletteFor(THEME);
  ctx.fillStyle = pal.heavyRough;
  ctx.fillRect(0, 0, cv.width, cv.height);
  const map = buildMap(built, THEME);
  const sc = Math.min(cv.width / map.w, cv.height / map.h);
  const w = map.w * sc;
  const h = map.h * sc;
  ctx.drawImage(map.canvas, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
}

/** The main editing canvas: camera, the drawing order, and (later) hit-testing/drag. One instance
 *  per page; `setHole` switches which built hole it draws. */
export class EditorCanvas {
  constructor(canvasEl, layers) {
    this.el = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.layers = layers; // shared, mutable layer-visibility object (see main.js)
    this.cameras = new Map(); // id -> {ppy, cx, cy}, session-only (section 5.1)
    this.built = null;
    this.spec = null;
    this.holeId = null;
    this._mapCache = new WeakMap(); // built -> {canvas,...} from buildMap, keyed on the built hole
    this.hover = null; // {x,y} world point under the cursor, or null
    this.onHoverChange = null;
    this._wireInput();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = Math.max(1, Math.round(r.width * dpr));
    this.el.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.draw();
  }

  /** Switch to a different hole. Restores its remembered camera, or fits. `spec` is the
   *  document's own spec for this hole - only its `path` is read here, for the centreline
   *  (section 5.2 step 5); everything else drawn comes off `built`. */
  setHole(id, built, spec) {
    this.holeId = id;
    this.built = built;
    this.spec = spec;
    if (!this.cameras.has(id)) this.fit();
    this.draw();
  }

  updateBuilt(built, spec) {
    this.built = built;
    this.spec = spec;
    this.draw();
  }

  fit() {
    if (!this.built) return;
    const r = this.el.getBoundingClientRect();
    this.cameras.set(this.holeId, fitCamera(this.built, r.width || 800, r.height || 600));
    this.draw();
  }

  get camera() { return this.cameras.get(this.holeId); }

  zoomBy(factor, aboutSx, aboutSy) {
    const cam = this.camera;
    if (!cam) return;
    const r = this.el.getBoundingClientRect();
    const W = r.width; const H = r.height;
    const sx = aboutSx == null ? W / 2 : aboutSx;
    const sy = aboutSy == null ? H / 2 : aboutSy;
    // world point under the cursor before the zoom
    const wx = cam.cx + (sx - W / 2) / cam.ppy;
    const wy = cam.cy - (sy - H / 2) / cam.ppy;
    const ppy = Math.max(0.5, Math.min(12, cam.ppy * factor));
    // re-solve cx/cy so that world point stays under the cursor after the zoom
    const cx = wx - (sx - W / 2) / ppy;
    const cy = wy + (sy - H / 2) / ppy;
    this.cameras.set(this.holeId, { ppy, cx, cy });
    this.draw();
  }

  setZoom(ppy) {
    const cam = this.camera;
    if (!cam) return;
    this.cameras.set(this.holeId, { ...cam, ppy: Math.max(0.5, Math.min(12, ppy)) });
    this.draw();
  }

  pan(dxPx, dyPx) {
    const cam = this.camera;
    if (!cam) return;
    this.cameras.set(this.holeId, { ...cam, cx: cam.cx - dxPx / cam.ppy, cy: cam.cy + dyPx / cam.ppy });
    this.draw();
  }

  _wireInput() {
    const el = this.el;
    let spaceDown = false;
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
      if (this.onZoomChange) this.onZoomChange(this.camera.ppy);
    }, { passive: false });

    let dragging = null; // {startX, startY, midOrSpace}
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        dragging = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (dragging) {
        this.pan(e.clientX - dragging.x, e.clientY - dragging.y);
        dragging = { x: e.clientX, y: e.clientY };
        return;
      }
      const r = el.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.hover = w;
      if (this.onHoverChange) this.onHoverChange(w);
    });
    el.addEventListener('pointerup', (e) => { dragging = null; try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ } });
    el.addEventListener('pointerleave', () => { this.hover = null; if (this.onHoverChange) this.onHoverChange(null); });
  }

  /** Screen (css px, canvas-relative) -> world. */
  toWorld(sxPx, syPx) {
    const cam = this.camera;
    if (!cam) return { x: 0, y: 0 };
    const r = this.el.getBoundingClientRect();
    return {
      x: cam.cx + (sxPx - r.width / 2) / cam.ppy,
      y: cam.cy - (syPx - r.height / 2) / cam.ppy,
    };
  }

  _mapFor(built) {
    let m = this._mapCache.get(built);
    if (!m) { m = buildMap(built, THEME); this._mapCache.set(built, m); }
    return m;
  }

  draw() {
    const { ctx, el } = this;
    const dpr = this.dpr || 1;
    const W = el.width; const H = el.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f07';
    ctx.fillRect(0, 0, W, H);
    const built = this.built;
    const cam = this.camera;
    if (!built || !cam) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const Wc = W / dpr; const Hc = H / dpr;

    const sx = (x) => (x - cam.cx) * cam.ppy + Wc / 2;
    const sy = (y) => Hc / 2 - (y - cam.cy) * cam.ppy;

    const L = this.layers;

    // 1. the built map (buildMap's own canvas), drawn from bounds.
    const map = this._mapFor(built);
    const b = built.bounds;
    const x0 = sx(b.minX); const y0 = sy(b.maxY);
    const w = (b.maxX - b.minX) * cam.ppy;
    const h = (b.maxY - b.minY) * cam.ppy;
    ctx.imageSmoothingEnabled = cam.ppy <= 3;
    ctx.drawImage(map.canvas, x0, y0, w, h);
    ctx.imageSmoothingEnabled = true;

    // 8a. bounds, dotted (drawn early so everything else sits over it)
    if (L.bounds) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, w, h);
      ctx.restore();
    }

    // 8b. 50-yd grid
    if (L.grid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      const step = 50;
      for (let gx = Math.ceil(b.minX / step) * step; gx <= b.maxX; gx += step) {
        ctx.beginPath(); ctx.moveTo(sx(gx), sy(b.minY)); ctx.lineTo(sx(gx), sy(b.maxY)); ctx.stroke();
      }
      for (let gy = Math.ceil(b.minY / step) * step; gy <= b.maxY; gy += step) {
        ctx.beginPath(); ctx.moveTo(sx(b.minX), sy(gy)); ctx.lineTo(sx(b.maxX), sy(gy)); ctx.stroke();
      }
      ctx.restore();
    }

    // 2. trees
    if (L.trees) {
      const handCount = (built.trees || []).length;
      const types = built.treeTypes || [];
      const list = treesOf(built);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const type = types[t.type] || {};
        const isBelt = i >= handCount;
        const [fill, rim] = TREE_FILL[type.name] || ['#3f6b34', '#26431f'];
        const r = (type.canopy || 4) * (t.s || 1) * cam.ppy;
        const px = sx(t.x); const py = sy(t.y);
        ctx.globalAlpha = (isBelt && L.belts === false) ? 0 : (isBelt ? 0.6 : 1);
        if (ctx.globalAlpha > 0) {
          ctx.fillStyle = fill;
          ctx.beginPath(); ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = shade(rim, 0.6);
          ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, (type.trunk || 0.8) * cam.ppy), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // 3. slope chevrons on the green
    if (L.slope && built.green && built.green.slope && built.green.slope.cells) {
      const pal = paletteFor(THEME);
      const sl = built.green.slope;
      const gb = greenBox(built);
      const cellYd = Math.min((gb.maxX - gb.minX) / sl.cols, (gb.maxY - gb.minY) / sl.rows);
      const cellPx = cellYd * cam.ppy;
      const size = cellPx * SLOPE_GLYPH_FRAC;
      if (size >= SLOPE_MIN_PX) {
        ctx.save();
        ctx.beginPath();
        const poly = built.green.poly;
        ctx.moveTo(sx(poly[0][0]), sy(poly[0][1]));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(sx(poly[i][0]), sy(poly[i][1]));
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = shade(pal.green, SLOPE_TINT);
        ctx.lineWidth = Math.max(1.5, size * 0.28);
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        const arm = size / 2;
        for (let r = 0; r < sl.rows; r++) {
          for (let c = 0; c < sl.cols; c++) {
            const g = sl.cells[r * sl.cols + c] || [0, 0];
            const mag = Math.hypot(g[0], g[1]);
            if (mag < SLOPE_FLAT) continue;
            const cxw = gb.minX + ((c + 0.5) * (gb.maxX - gb.minX)) / sl.cols;
            const cyw = gb.minY + ((r + 0.5) * (gb.maxY - gb.minY)) / sl.rows;
            const px = sx(cxw); const py = sy(cyw);
            const a = slopeGlyphAngle(g);
            const tipX = px + Math.cos(a) * arm * 0.55;
            const tipY = py + Math.sin(a) * arm * 0.55;
            ctx.beginPath();
            for (const d of [2.356, -2.356]) {
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(tipX + Math.cos(a + d) * arm, tipY + Math.sin(a + d) * arm);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // 4. route, dashed
    if (L.route && built.route) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      built.route.forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      ctx.restore();
    }

    // 5. centreline + waypoints + tee/pin
    if (L.centreline) {
      const path = (this.spec && this.spec.path) || [built.tee, built.pin];
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      path.forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let i = 1; i < path.length - 1; i++) {
        const px = sx(path[i][0]); const py = sy(path[i][1]);
        ctx.fillRect(px - 5, py - 5, 10, 10);
      }
      ctx.restore();
    }

    // tee (triangle, never draggable) and pin (circle)
    if (L.teePin) {
      const teePx = sx(built.tee[0]); const teePy = sy(built.tee[1]);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(teePx, teePy - 7);
      ctx.lineTo(teePx - 6, teePy + 5);
      ctx.lineTo(teePx + 6, teePy + 5);
      ctx.closePath();
      ctx.fill();

      const pinPx = sx(built.pin[0]); const pinPy = sy(built.pin[1]);
      ctx.beginPath();
      ctx.arc(pinPx, pinPy, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('tee', teePx, teePy + 20);
      ctx.fillText('pin', pinPx, pinPy - 12);
    }
  }
}
