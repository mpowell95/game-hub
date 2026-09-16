// hole-editor/js/canvas.js - the canvas: camera, drawing, thumbnails. Step 3 covers drawing-order
// steps 1/2/3/4/5/8 (section 5.2) and the camera (5.1); object outlines/handles/ruler (steps 6/7/9)
// and hit-testing (5.5) are added in step 4 alongside the tools that need them.
//
// R5: nothing here computes its own fairway polygon, route, bounds or yardage - everything drawn
// is read off the BUILT hole (`buildHole()` in model.js), the same object the game itself plays.

import { buildMap, paletteFor, slopeGlyphAngle, SLOPE_TINT, SLOPE_GLYPH_FRAC } from '../../golf/js/render.js';
import { treesOf, greenBox, distYd } from '../../golf/js/holes.js';
import { blob } from '../../golf/js/holegen.js';

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

// --- section 6's local placement geometry -------------------------------------------------------
// There is no exported spline (`holegen.js`'s is internal), so every tool that places or drags
// something builds its own dense stations from `built.route`, densified to ~2 yd, exactly as
// section 6's preamble instructs: "acceptable for placement because yd/off are authored numbers
// and the outline drawn back is exact" - the same local stations are used both to convert a click
// to {yd, side, off} and to draw that thing back, so the two are self-consistent even though this
// is an approximation of the true (internal, unexported) spline.

export function buildStations(route, step = 2) {
  let total = 0;
  const cum = [0];
  for (let i = 1; i < route.length; i++) {
    total += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    cum.push(total);
  }
  const dense = [];
  for (let s = 0; s <= total; s += step) {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    dense.push([
      route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f,
      route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f,
    ]);
  }
  const last = route[route.length - 1];
  if (!dense.length || Math.hypot(dense[dense.length - 1][0] - last[0], dense[dense.length - 1][1] - last[1]) > 0.5) dense.push(last);

  const st = [];
  let run = 0;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[Math.max(0, i - 1)];
    const b = dense[Math.min(dense.length - 1, i + 1)];
    const tx = b[0] - a[0]; const ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    if (i > 0) run += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    st.push({ x: dense[i][0], y: dense[i][1], s: run, nx: ty / m, ny: -tx / m, tx: tx / m, ty: ty / m });
  }
  const length = st.length ? st[st.length - 1].s : 0;
  for (const p of st) p.t = length ? p.s / length : 0;
  return { stations: st, length };
}

/** Mirrors `holegen.js`'s own `place()`: nearest station by fraction, offset along its normal. */
export function placeLocal(stations, at, side, off) {
  const i = Math.min(stations.length - 1, Math.max(0, Math.round(at * (stations.length - 1))));
  const p = stations[i];
  return [p.x + p.nx * off * side, p.y + p.ny * off * side];
}

/** A click's world point -> {yd, side, off}, via the nearest station overall (not by fraction -
 *  the click could be anywhere near the corridor, not already on the centreline). */
export function nearestPlacement(stations, length, wx, wy) {
  let best = 0; let bestD = Infinity;
  for (let i = 0; i < stations.length; i++) {
    const d = Math.hypot(stations[i].x - wx, stations[i].y - wy);
    if (d < bestD) { bestD = d; best = i; }
  }
  const p = stations[best];
  const signed = (wx - p.x) * p.nx + (wy - p.y) * p.ny;
  return { yd: p.t * length, side: signed < 0 ? -1 : 1, off: Math.abs(signed) };
}

/** Every selectable placed thing on a hole - section 4.4's Objects list groups, minus guards
 *  (panel-only tokens, never draggable) and waypoints (the Route tool's own handles, section 6.2).
 *  Built fresh per call; cheap (a handful of items) and always in sync with the current spec. */
export function listObjects(spec, stations, length) {
  const out = [];
  (spec.bunkers || []).forEach((b, index) => {
    if (b.yd == null) return; // a poly-only bunker (none in Red Mesa's authored specs) isn't editable here
    const [cx, cy] = placeLocal(stations, b.yd / length, b.side == null ? 1 : b.side, b.off || 0);
    const r = b.r || 6; const ry = b.ry || r * 0.72;
    const seed = b.seed || (spec.seed + 80 + index);
    out.push({ group: 'bunkers', index, kind: b.kind || 'greensideBunker', center: [cx, cy], poly: blob(cx, cy, r, ry, seed, 9) });
  });
  (spec.water || []).forEach((w, index) => {
    if (w.yd == null) return;
    const [cx, cy] = placeLocal(stations, w.yd / length, w.side == null ? 0 : w.side, w.off || 0);
    const rx = w.rx; const ry = w.ry == null ? rx : w.ry;
    const seed = w.seed || (spec.seed + 40 + index);
    out.push({ group: 'water', index, kind: 'water', center: [cx, cy], poly: blob(cx, cy, rx, ry, seed, w.n || 12) });
  });
  (spec.trees || []).forEach((t, index) => {
    let cx; let cy;
    if (t.yd != null) [cx, cy] = placeLocal(stations, t.yd / length, t.side == null ? 0 : t.side, t.off || 0);
    else { cx = t.x; cy = t.y; }
    out.push({ group: 'trees', index, kind: 'tree', center: [cx, cy], radius: 4 });
  });
  (spec.sentinels || []).forEach((s, index) => {
    const [cx, cy] = placeLocal(stations, s.yd / length, s.side == null ? 1 : s.side, s.off || 0);
    out.push({ group: 'sentinels', index, kind: 'sentinel', center: [cx, cy], radius: (s.spread == null ? 7 : s.spread) });
  });
  (spec.cross || []).forEach((c, index) => {
    const st = stations[Math.min(stations.length - 1, Math.max(0, Math.round((c.yd / length) * (stations.length - 1))))];
    out.push({ group: 'cross', index, kind: c.kind || 'water', center: [st.x, st.y], station: st });
  });
  return out;
}

/** Point-in-polygon (ray cast), used for hit-testing an object outline. */
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Section 5.4/6.3: cast both ways from a station along its normal and find the first crossing of
 *  the built fairway polygon's own edges - the DRAWN width, pinch/wobble/floor included. Returns
 *  {left, right} in yards (distance from the station point), or null on the side with nothing to
 *  cross. Ray-casts every fairway surface's edges rather than trusting a formula (R5). */
export function fairwayEdgesAt(built, px, py, nx, ny) {
  const fw = (built.surfaces || []).find((s) => s.kind === 'fairway');
  if (!fw) return { left: null, right: null };
  const poly = fw.poly;
  let left = null; let right = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]; const [bx, by] = poly[i];
    const ex = bx - ax; const ey = by - ay;
    // Line P(t) = (px,py) + t*(nx,ny) against segment Q(u) = (ax,ay) + u*(ex,ey), u in [0,1].
    const D = ex * ny - ey * nx;
    if (Math.abs(D) < 1e-9) continue;
    const t = (ex * (ay - py) - ey * (ax - px)) / D;
    const u = (nx * (ay - py) - ny * (ax - px)) / D;
    if (u < 0 || u > 1) continue;
    if (t >= 0 && (right == null || t < right)) right = t;
    if (t <= 0 && (left == null || -t < left)) left = -t;
  }
  return { left, right };
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
    this.stations = []; this.length = 0; // local placement geometry (section 6 preamble)
    this._mapCache = new WeakMap(); // built -> {canvas,...} from buildMap, keyed on the built hole
    this.hover = null; // {x,y} world point under the cursor, or null
    this.onHoverChange = null;
    this.onSelectionChange = null;
    this.onRulerChange = null;
    this.onValidateHighlightClear = null;
    this.tool = 'select';
    this.selection = null; // {group,index} | {group:'waypoint', index} | null
    this.ruler = null; // [[x,y]] | [[x,y],[x,y]] | null
    this.validateRing = null; // an array of world points to ring in red until the next click (section 7)
    // Supplied by main.js: { getSpec, instant(mutateFn), liveBegin, liveUpdate(mutateFn), liveEnd,
    // guardTree }. Instant = one undo-worthy action now; live* = a drag, one undo push at the end.
    this.ops = null;
    this._wireInput();
  }

  _recomputeStations() {
    this.stations = [];
    this.length = 0;
    if (this.built && this.built.route && this.built.route.length > 1) {
      const { stations, length } = buildStations(this.built.route, 2);
      this.stations = stations; this.length = length;
    }
  }

  setSelection(sel) {
    this.selection = sel;
    if (this.onSelectionChange) this.onSelectionChange(sel);
    this.draw();
  }

  setTool(tool) {
    this.tool = tool;
    this.selection = null;
    this.ruler = null;
    if (this.onSelectionChange) this.onSelectionChange(null);
    this.draw();
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
    this.selection = null;
    this.ruler = null;
    this.validateRing = null;
    this._recomputeStations();
    if (!this.cameras.has(id)) this.fit();
    if (this.onSelectionChange) this.onSelectionChange(null);
    this.draw();
  }

  updateBuilt(built, spec) {
    this.built = built;
    this.spec = spec;
    this._recomputeStations();
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

  /** Centre the camera on a world point, keeping zoom - section 7's "pans to the offending
   *  point". `points` (one or two world points) are ringed in red until the next click. */
  panTo(x, y, points) {
    const cam = this.camera;
    if (!cam) return;
    this.cameras.set(this.holeId, { ...cam, cx: x, cy: y });
    this.validateRing = points || [[x, y]];
    this.draw();
  }

  /** Section 5.5: handles first, then object outlines, then nothing. `pxTol` converts a fixed
   *  12px handle box into world yards at the current zoom. */
  hitTest(wx, wy) {
    const cam = this.camera;
    if (!cam) return null;
    const tolYd = 12 / cam.ppy;
    if (this.tool === 'route' && this.spec) {
      for (let i = 0; i < this.spec.path.length; i++) {
        const p = this.spec.path[i];
        if (Math.hypot(p[0] - wx, p[1] - wy) <= tolYd) return { group: 'waypoint', index: i };
      }
    }
    if (this.tool === 'width' && this.spec) {
      const handle = this._widthHandleAt(wx, wy, tolYd);
      if (handle) return handle;
    }
    if (this.tool === 'select' || this.tool === 'bunker' || this.tool === 'water' || this.tool === 'tree' || this.tool === 'cross') {
      const objects = listObjects(this.spec, this.stations, this.length);
      for (const o of objects) {
        if (o.poly && pointInPoly([wx, wy], o.poly)) return o;
        if (!o.poly && Math.hypot(o.center[0] - wx, o.center[1] - wy) <= Math.max(tolYd, o.radius || 3)) return o;
      }
    }
    return null;
  }

  /** Width tool's own handles: one per `fw`/`fwL`/`fwR` control point, on the fairway's DRAWN edge
   *  at that point's `at` (section 6.3) - found by ray-casting, not by formula (R5). */
  _widthHandles() {
    if (!this.built || !this.stations.length) return [];
    const out = [];
    const addSide = (profile, side, key) => {
      if (!Array.isArray(profile)) return;
      profile.forEach((p, index) => {
        const st = this.stations[Math.min(this.stations.length - 1, Math.max(0, Math.round(p.at * (this.stations.length - 1))))];
        const edges = fairwayEdgesAt(this.built, st.x, st.y, st.nx, st.ny);
        const d = side < 0 ? edges.left : edges.right;
        if (d == null) return;
        out.push({ key, side, index, at: p.at, w: p.w, point: [st.x + st.nx * d * side, st.y + st.ny * d * side] });
      });
    };
    if (this.spec.fwL || this.spec.fwR) {
      addSide(this.spec.fwL || this.spec.fw, -1, 'fwL');
      addSide(this.spec.fwR || this.spec.fw, 1, 'fwR');
    } else {
      addSide(this.spec.fw, -1, 'fw');
      addSide(this.spec.fw, 1, 'fw');
    }
    return out;
  }

  _widthHandleAt(wx, wy, tolYd) {
    for (const h of this._widthHandles()) {
      if (Math.hypot(h.point[0] - wx, h.point[1] - wy) <= tolYd) return { group: 'widthHandle', ...h };
    }
    return null;
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

    let dragging = null; // camera pan
    let objDrag = null;  // {kind:'object'|'waypoint'|'widthHandle', ...}
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && spaceDown)) {
        dragging = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0 || !this.ops) return;
      const r = el.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.validateRing = null;

      if (this.tool === 'ruler') {
        if (!this.ruler || this.ruler.length >= 2) this.ruler = [[w.x, w.y]];
        else this.ruler.push([w.x, w.y]);
        if (this.onRulerChange) this.onRulerChange(this.ruler);
        this.draw();
        return;
      }

      const hit = this.hitTest(w.x, w.y);
      if (hit && hit.group === 'waypoint') {
        this.setSelection(hit);
        if (hit.index !== 0) { objDrag = { kind: 'waypoint', index: hit.index }; this.ops.liveBegin(); el.setPointerCapture(e.pointerId); }
        return;
      }
      if (hit && hit.group === 'widthHandle') {
        this.setSelection(hit);
        const st = this.stations[Math.min(this.stations.length - 1, Math.max(0, Math.round(hit.at * (this.stations.length - 1))))];
        objDrag = { kind: 'widthHandle', side: hit.side, index: hit.index, key: hit.key, station: st };
        this.ops.liveBegin();
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (hit) {
        this.setSelection(hit);
        if (this.tool === 'select') {
          objDrag = { kind: 'object', group: hit.group, index: hit.index };
          this.ops.liveBegin();
          el.setPointerCapture(e.pointerId);
        }
        return;
      }

      // Nothing hit: a placement tool places here (and selects what it just placed, so the
      // context panel shows its controls immediately); Select deselects.
      const placeAndSelect = (kind, group) => {
        this.ops.instant((spec) => this._place(spec, kind, w));
        this.setSelection({ group, index: this.spec[group].length - 1 });
      };
      if (this.tool === 'bunker') placeAndSelect('bunker', 'bunkers');
      else if (this.tool === 'water') placeAndSelect('water', 'water');
      else if (this.tool === 'tree') placeAndSelect('tree', this.ops.getTreeMode && this.ops.getTreeMode() === 'stand' ? 'sentinels' : 'trees');
      else if (this.tool === 'cross') placeAndSelect('cross', 'cross');
      else this.setSelection(null);
    });

    el.addEventListener('dblclick', (e) => {
      if (!this.ops) return;
      const r = el.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);

      if (this.tool === 'route') {
        this.ops.instant((spec) => {
          // Insert after the nearest existing waypoint that precedes this point along the route.
          let insertAt = spec.path.length - 1;
          for (let i = 1; i < spec.path.length; i++) {
            const pd = Math.hypot(spec.path[i - 1][0] - w.x, spec.path[i - 1][1] - w.y);
            if (pd < 40) insertAt = i;
          }
          return { ...spec, path: [...spec.path.slice(0, insertAt), [+w.x.toFixed(1), +w.y.toFixed(1)], ...spec.path.slice(insertAt)] };
        });
        return;
      }

      if (this.tool === 'width' && this.stations.length) {
        // Which edge (left/right) and at what `at` fraction - the nearest station to the click.
        let best = this.stations[0]; let bestD = Infinity;
        for (const st of this.stations) { const d = Math.hypot(st.x - w.x, st.y - w.y); if (d < bestD) { bestD = d; best = st; } }
        const signed = (w.x - best.x) * best.nx + (w.y - best.y) * best.ny;
        const side = signed < 0 ? -1 : 1;
        this.ops.instant((spec) => this.ops.mutators.insertWidthPoint(spec, side, best.t));
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

      if (objDrag && this.ops) {
        if (objDrag.kind === 'waypoint') {
          this.ops.liveUpdate((spec) => ({ ...spec, path: spec.path.map((p, i) => (i === objDrag.index ? [+w.x.toFixed(1), +w.y.toFixed(1)] : p)) }));
        } else if (objDrag.kind === 'object') {
          const placement = nearestPlacement(this.stations, this.length, w.x, w.y);
          this.ops.liveUpdate((spec) => {
            const list = spec[objDrag.group].map((o, i) => {
              if (i !== objDrag.index) return o;
              if (objDrag.group === 'cross') return { ...o, yd: +placement.yd.toFixed(1) };
              return { ...o, yd: +placement.yd.toFixed(1), side: placement.side, off: +placement.off.toFixed(1) };
            });
            return { ...spec, [objDrag.group]: list };
          });
        } else if (objDrag.kind === 'widthHandle') {
          // The new HALF-width is simply the signed distance from the centreline STATION to the
          // cursor, along that station's own normal - `side` only decides which profile a drag on
          // the left vs. right edge writes to (section 6.3: "either side's handle edits the same
          // symmetric `fw` point" unless the spec already has its own `fwL`/`fwR`).
          const st = objDrag.station;
          const signed = (w.x - st.x) * st.nx + (w.y - st.y) * st.ny;
          const half = Math.max(2.5, Math.min(15, Math.abs(signed)));
          this.ops.liveUpdate((spec) => {
            const key = spec.fwL || spec.fwR ? objDrag.key : 'fw';
            const profile = Array.isArray(spec[key]) ? spec[key] : [{ at: 0, w: 15 }, { at: 1, w: 15 }];
            const next = profile.map((pt, i) => (i === objDrag.index ? { ...pt, w: +(half * 2).toFixed(1) } : pt));
            return { ...spec, [key]: next };
          });
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      dragging = null;
      if (objDrag && this.ops) { this.ops.liveEnd(); objDrag = null; }
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    });
    el.addEventListener('pointerleave', () => { this.hover = null; if (this.onHoverChange) this.onHoverChange(null); });

    window.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection && this.ops) {
        e.preventDefault();
        const sel = this.selection;
        if (sel.group === 'waypoint') {
          if (sel.index > 0 && sel.index < this.spec.path.length - 1) {
            this.setSelection(null);
            this.ops.instant((spec) => ({ ...spec, path: spec.path.filter((_, i) => i !== sel.index) }));
          }
        } else if (sel.group !== 'widthHandle') {
          this.setSelection(null);
          this.ops.instant((spec) => this._deleteSelected(spec, sel));
        }
      } else if (e.key === 'Escape') {
        if (this.selection) this.setSelection(null);
        else if (this.ruler) { this.ruler = null; if (this.onRulerChange) this.onRulerChange(null); this.draw(); }
      }
    });
  }

  /** Click placement for Bunker/Water/Tree/Cross (sections 6.4-6.6/6.10). `w` is the world point. */
  _place(spec, kind, w) {
    const placement = nearestPlacement(this.stations, this.length, w.x, w.y);
    if (kind === 'bunker') return this.ops.mutators.addBunker(spec, placement, this.length);
    if (kind === 'water') return this.ops.mutators.addWater(spec, placement);
    if (kind === 'tree') {
      const treeType = this.ops.getTreeMode && this.ops.getTreeMode() === 'stand' ? 'stand' : 'single';
      const type = this.ops.getTreePlantType ? this.ops.getTreePlantType() : 0;
      return treeType === 'stand' ? this.ops.mutators.addSentinel(spec, { ...placement, type }) : this.ops.mutators.addTree(spec, { ...placement, type });
    }
    if (kind === 'cross') return this.ops.mutators.addCross(spec, { yd: placement.yd, kind: this.ops.getCrossKind ? this.ops.getCrossKind() : 'water', depth: this.ops.getCrossDepth ? this.ops.getCrossDepth() : 22 });
    return spec;
  }

  _deleteSelected(spec, sel) {
    return this.ops.mutators.deleteObject(spec, sel.group, sel.index);
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

    // 6. object outlines - each placed thing's OWN generated polygon (section 5.3), stroked white,
    // the selected one in the accent colour with its handle.
    if (L.objects && this.spec) {
      const objects = listObjects(this.spec, this.stations, this.length);
      for (const o of objects) {
        const selected = this.selection && this.selection.group === o.group && this.selection.index === o.index;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeStyle = selected ? '#ffce3a' : 'rgba(255,255,255,.7)';
        if (o.poly) {
          ctx.beginPath();
          o.poly.forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
          ctx.closePath();
          ctx.stroke();
        } else if (o.group === 'sentinels') {
          ctx.beginPath();
          ctx.arc(sx(o.center[0]), sy(o.center[1]), Math.max(3, o.radius * cam.ppy), 0, Math.PI * 2);
          ctx.stroke();
        } else if (o.group === 'trees') {
          // A single tree's own draw circle (layer 2) IS its outline; only ring it when selected.
          if (selected) {
            ctx.beginPath();
            ctx.arc(sx(o.center[0]), sy(o.center[1]), Math.max(4, (o.radius || 4) * cam.ppy + 3), 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (o.group === 'cross') {
          // No exact wavy-band outline (built by holegen's own wave maths, not blob()) - a straight
          // band across the corridor at this yardage is enough to see and grab it.
          const st = o.station;
          const half = Math.max(30, (built.bounds.maxX - built.bounds.minX) / 2);
          const depth = (this.spec.cross[o.index].depth == null ? 22 : this.spec.cross[o.index].depth) / 2;
          const p1 = [st.x - st.nx * half - st.tx * depth, st.y - st.ny * half - st.ty * depth];
          const p2 = [st.x + st.nx * half - st.tx * depth, st.y + st.ny * half - st.ty * depth];
          const p3 = [st.x + st.nx * half + st.tx * depth, st.y + st.ny * half + st.ty * depth];
          const p4 = [st.x - st.nx * half + st.tx * depth, st.y - st.ny * half + st.ty * depth];
          ctx.beginPath();
          [p1, p2, p3, p4].forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
          ctx.closePath();
          ctx.stroke();
        }
        if (selected) {
          ctx.fillStyle = '#ffce3a';
          ctx.beginPath();
          ctx.arc(sx(o.center[0]), sy(o.center[1]), 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 7. width handles (Width tool only) - section 6.3.
    if (this.tool === 'width' && this.spec) {
      ctx.fillStyle = '#ffffff';
      for (const h of this._widthHandles()) {
        const selected = this.selection && this.selection.group === 'widthHandle' && this.selection.key === h.key && this.selection.index === h.index && this.selection.side === h.side;
        ctx.fillStyle = selected ? '#ffce3a' : '#ffffff';
        const px = sx(h.point[0]); const py = sy(h.point[1]);
        ctx.fillRect(px - 5, py - 5, 10, 10);
      }
    }

    // 9. ruler + validate ring
    if (this.ruler && this.ruler.length) {
      ctx.save();
      ctx.strokeStyle = '#ffce3a';
      ctx.fillStyle = '#ffce3a';
      ctx.lineWidth = 1.5;
      for (const p of this.ruler) { ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3, 0, Math.PI * 2); ctx.fill(); }
      if (this.ruler.length === 2) {
        const [a, b2] = this.ruler;
        ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b2[0]), sy(b2[1])); ctx.stroke();
        const mx = (sx(a[0]) + sx(b2[0])) / 2; const my = (sy(a[1]) + sy(b2[1])) / 2;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${distYd(a, b2).toFixed(1)} yd`, mx, my - 8);
      }
      ctx.restore();
    }
    if (this.validateRing && this.validateRing.length) {
      ctx.save();
      ctx.strokeStyle = '#ff4433';
      ctx.lineWidth = 2.5;
      for (const p of this.validateRing) {
        ctx.beginPath();
        ctx.arc(sx(p[0]), sy(p[1]), 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      // A "crosses itself" report cites two edges - draw the offending segment between them too.
      if (this.validateRing.length === 2) {
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx(this.validateRing[0][0]), sy(this.validateRing[0][1]));
        ctx.lineTo(sx(this.validateRing[1][0]), sy(this.validateRing[1][1]));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
