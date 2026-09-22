// hole-editor/js/canvas.js - the canvas: camera, drawing, thumbnails. Step 3 covers drawing-order
// steps 1/2/3/4/5/8 (section 5.2) and the camera (5.1); object outlines/handles/ruler (steps 6/7/9)
// and hit-testing (5.5) are added in step 4 alongside the tools that need them.
//
// R5: nothing here computes its own fairway polygon, route, bounds or yardage - everything drawn
// is read off the BUILT hole (`buildHole()` in model.js), the same object the game itself plays.

import {
  buildMap, paletteFor, slopeGlyphAngle, slopeChevronGrid, SLOPE_TINT, SLOPE_GLYPH_FRAC,
  SHADOW_LEN, SHADOW_DROP, SHADOW_RX, SHADOW_RY, SHADOW_ALPHA, treeShapes, TREE_FILL,
} from '../../golf/js/render.js';
import { treesOf, greenBox, distYd } from '../../golf/js/holes.js';
import { blob, routeStations } from '../../golf/js/holegen.js';
import { polyCentroid } from './model.js';

/** The axis-aligned box round an outline, plus its eight resize handles (corners and side
 *  midpoints) in world yards - Matt's "small white squares on the sides that i can click and
 *  drag". `axis` says what a handle changes: 'x', 'y' or both. */
export function bboxHandles(poly) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const mx = (minX + maxX) / 2; const my = (minY + maxY) / 2;
  return {
    minX, minY, maxX, maxY,
    handles: [
      { x: minX, y: minY, axis: 'xy' }, { x: maxX, y: minY, axis: 'xy' }, { x: maxX, y: maxY, axis: 'xy' }, { x: minX, y: maxY, axis: 'xy' },
      { x: mx, y: minY, axis: 'y' }, { x: maxX, y: my, axis: 'x' }, { x: mx, y: maxY, axis: 'y' }, { x: minX, y: my, axis: 'x' },
    ],
  };
}

let THEME = 'desert';
/** The look the editor paints in (2026-09-22): the Course Creator's parkland used to be drawn in
 *  desert colours here. Clears the map cache so the next draw rebuilds in the new palette. */
export function setEditorTheme(theme) { THEME = theme || 'desert'; _maps = new WeakMap(); }
export function editorTheme() { return THEME; }
// render.js's own thresholds (SLOPE_FLAT, SLOPE_MIN_PX) are not exported - copied here as plain
// drawing constants, not geometry, so this stays a faithful copy of what the game shows rather
// than a second opinion about it.
const SLOPE_FLAT = 0.06;
const SLOPE_MIN_PX = 3.5;
// TREE_FILL used to be a 3-entry copy of render.js's own (also-unexported) table; both are now
// exported from render.js (2026-09-22, docs/HANDOFF-GOLF-OBJECTS.md section 3) so this editor
// draws the same colours for the whole obstacle catalogue rather than falling back to a generic
// green/rim for anything past the original three desert specimens.

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
  // Past the pin / behind the tee: carry on along the end station's tangent, exactly as
  // holegen.js's `place()` does since 2026-09-16.
  const len = stations[stations.length - 1].s;
  const over = at > 1 ? (at - 1) * len : (at < 0 ? at * len : 0);
  return [p.x + p.tx * over + p.nx * off * side, p.y + p.ty * over + p.ny * off * side];
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
  // At either END of the route the nearest station cannot say how far PAST it the click is, so
  // the overshoot along that station's tangent becomes extra yardage: a click 20 yd beyond the pin
  // is `yd: length + 20` (Matt, 2026-09-16: "It doesn't let me place a bunker behind the green").
  let yd = p.t * length;
  if (best === stations.length - 1 || best === 0) {
    const along = (wx - p.x) * p.tx + (wy - p.y) * p.ty;
    if ((best === stations.length - 1 && along > 0) || (best === 0 && along < 0)) yd += along;
  }
  return { yd, side: signed < 0 ? -1 : 1, off: Math.abs(signed) };
}

/** Every selectable placed thing on a hole - section 4.4's Objects list groups, minus guards
 *  (panel-only tokens, never draggable) and waypoints (the Route tool's own handles, section 6.2).
 *  Built fresh per call; cheap (a handful of items) and always in sync with the current spec. */
export function listObjects(spec, stations, length) {
  const out = [];
  (spec.bunkers || []).forEach((b, index) => {
    if (b.poly) { out.push({ group: 'bunkers', index, kind: b.kind || 'greensideBunker', center: polyCentroid(b.poly), poly: b.poly, drawn: true }); return; }
    if (b.yd == null) return;
    const [cx, cy] = placeLocal(stations, b.yd / length, b.side == null ? 1 : b.side, b.off || 0);
    const r = b.r || 6; const ry = b.ry || r * 0.72;
    const seed = b.seed || (spec.seed + 80 + index);
    out.push({ group: 'bunkers', index, kind: b.kind || 'greensideBunker', center: [cx, cy], poly: blob(cx, cy, r, ry, seed, 9) });
  });
  (spec.water || []).forEach((w, index) => {
    // `kind` is 'water' or 'swamp' (2026-09-22) - a swamp is still authored in the `water` group
    // (same tool, same blob/draw machinery), only the paint and the lie differ, so it is not a
    // group of its own.
    if (w.poly) { out.push({ group: 'water', index, kind: w.kind || 'water', center: polyCentroid(w.poly), poly: w.poly, drawn: true }); return; }
    if (w.yd == null) return;
    const [cx, cy] = placeLocal(stations, w.yd / length, w.side == null ? 0 : w.side, w.off || 0);
    const rx = w.rx; const ry = w.ry == null ? rx : w.ry;
    const seed = w.seed || (spec.seed + 40 + index);
    out.push({ group: 'water', index, kind: w.kind || 'water', center: [cx, cy], poly: blob(cx, cy, rx, ry, seed, w.n || 12) });
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
  (spec.pins || []).forEach((p, index) => {
    out.push({ group: 'pins', index, kind: 'pin', center: [p[0], p[1]], radius: 2.5 });
  });
  // DECOR (2026-09-22): a `{poly}` entry is the existing drawn-path form (a cart path), already
  // covered by the generic `o.poly` outline/drag code below - nothing new needed for it. A SPRITE
  // (bench/sign/flagpole) is authored here with plain `{x, y, kind, rot}` fields - the same shape
  // `moveObject(spec, 'decor', i, {x, y})` writes - and the BUILT hole's own `decor` entries use
  // `{at:[x,y], kind, rot}` instead (`holegen.js` does that conversion, same as `trees`' `yd/off`
  // becoming `x/y` - see `render.js`'s decor loop). The object this function returns also carries
  // `center`/`radius` per section 4's `{group:'decor', index, x, y, r:2}`, so it works with every
  // other group's generic hit-test/select/drag code unchanged (they all key off `.center`/
  // `.radius`, never `.x`/`.y`/`.r` directly).
  (spec.decor || []).forEach((d, index) => {
    if (d.poly) { out.push({ group: 'decor', index, kind: d.kind || 'path', center: polyCentroid(d.poly), poly: d.poly, drawn: true }); return; }
    if (d.x == null || d.y == null) return;
    out.push({ group: 'decor', index, kind: d.kind || 'bench', center: [d.x, d.y], x: d.x, y: d.y, r: 2, radius: 2, rot: d.rot || 0 });
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
/** ONE painted map per built hole, shared by the thumbnails, the Compare modal and the main
 *  canvas. `buildHole()` hands back the SAME object for an unchanged hole, so a WeakMap on it is
 *  exactly "redraw only the ids whose built hole changed" (spec 4.2). Measured before this cache
 *  existed (2026-09-16): every pointermove of a drag re-ran `buildMap` for all 18 holes (~17 ms
 *  each) inside the strip refresh, so a 20-step drag produced long tasks of 965, 476, 421 and
 *  422 ms - the "very slow/delayed" Matt reported the first time he used it. */
let _maps = new WeakMap();
export function mapFor(built) {
  let m = _maps.get(built);
  if (!m) { m = buildMap(built, THEME); _maps.set(built, m); }
  return m;
}

export function renderMapThumbnail(built, cv) {
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const pal = paletteFor(THEME);
  ctx.fillStyle = pal.heavyRough;
  ctx.fillRect(0, 0, cv.width, cv.height);
  const map = mapFor(built);
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
    this.drawing = null; // {group, kind, replaceIndex, points} while a shape is being drawn
    this.onDrawChange = null;
    // Supplied by main.js: { getSpec, instant(mutateFn), liveBegin, liveUpdate(mutateFn), liveEnd,
    // guardTree }. Instant = one undo-worthy action now; live* = a drag, one undo push at the end.
    this.ops = null;
    this._wireInput();
  }

  _recomputeStations() {
    this.stations = [];
    this.length = 0;
    // THE GAME'S OWN STATIONS (holegen's `routeStations`, 2026-09-16), not a rebuild from the
    // coarse `route`: that rebuild is why an outline could sit beside the bunker it belonged to.
    // `buildStations` is kept for tests and as the fallback for a spec with no path.
    if (this.spec && this.spec.path && this.spec.path.length > 1) {
      const { stations, length } = routeStations(this.spec.path);
      this.stations = stations; this.length = length;
    } else if (this.built && this.built.route && this.built.route.length > 1) {
      const { stations, length } = buildStations(this.built.route, 2);
      this.stations = stations; this.length = length;
    }
  }

  /** Draw mode: drop the last corner (Backspace, or the panel button). */
  undoDrawPoint() {
    if (!this.drawing || !this.drawing.points.length) return;
    this.drawing.points.pop();
    if (this.onDrawChange) this.onDrawChange(this.drawing);
    this.draw();
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
    if (this.tool === 'select' || this.tool === 'bunker' || this.tool === 'water' || this.tool === 'tree' || this.tool === 'cross' || this.tool === 'green' || this.tool === 'decor') {
      const objects = listObjects(this.spec, this.stations, this.length);
      // Pins first: they sit on the green and are tiny, so they must win over anything under them.
      for (const o of objects) if (o.group === 'pins' && Math.hypot(o.center[0] - wx, o.center[1] - wy) <= Math.max(tolYd, o.radius)) return o;
      if (this.tool === 'green') return null;
      for (const o of objects) {
        if (o.group === 'pins') continue;
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
    const isTyping = () => document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping()) spaceDown = true; });
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
    let slopeDrag = null; // Slope tool, Paint mode: {r, c, x0, y0} - the cell pressed and where
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

      // SLOPE PAINT (section 6.9). Was never implemented: the panel offered Paint mode and the
      // mutator existed, but no canvas code called it (found in the 2026-09-16 review). A press
      // inside the green's 8x8 box picks the cell; the drag's direction and length set its
      // downhill vector on release, a plain click zeroes it.
      if (this.tool === 'slope' && this.spec && this.spec.slope && this.spec.slope.cells && this.built) {
        const gb = greenBox(this.built);
        if (w.x >= gb.minX && w.x <= gb.maxX && w.y >= gb.minY && w.y <= gb.maxY) {
          const sl = this.spec.slope;
          const c = Math.min(sl.cols - 1, Math.floor(((w.x - gb.minX) / (gb.maxX - gb.minX)) * sl.cols));
          const rr = Math.min(sl.rows - 1, Math.floor(((w.y - gb.minY) / (gb.maxY - gb.minY)) * sl.rows));
          slopeDrag = { r: rr, c, x0: e.clientX, y0: e.clientY };
          el.setPointerCapture(e.pointerId);
          return;
        }
      }

      // DRAW MODE (Matt: "can i draw shapes?"): every click adds a corner; double-click or Enter
      // closes the shape, Escape abandons it.
      if (this.drawing) {
        const last = this.drawing.points[this.drawing.points.length - 1];
        if (!last || Math.hypot(last[0] - w.x, last[1] - w.y) > 1) this.drawing.points.push([+w.x.toFixed(1), +w.y.toFixed(1)]);
        this.draw();
        return;
      }

      // RESIZE HANDLES on the selected bunker / lake (Select tool): the eight white squares round
      // its box. Checked before the outline so a handle on the edge wins over "drag the object".
      if (this.tool === 'select' && this.selection && (this.selection.group === 'bunkers' || this.selection.group === 'water')) {
        const o = listObjects(this.spec, this.stations, this.length).find((x) => x.group === this.selection.group && x.index === this.selection.index);
        if (o && o.poly) {
          const tol = 12 / this.camera.ppy;
          const bb = bboxHandles(o.poly);
          const hnd = bb.handles.find((h) => Math.hypot(h.x - w.x, h.y - w.y) <= tol);
          if (hnd) {
            objDrag = { kind: 'resize', group: o.group, index: o.index, axis: hnd.axis };
            this.ops.liveBegin();
            el.setPointerCapture(e.pointerId);
            return;
          }
        }
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
      if (hit && hit.group === 'pins') {
        this.setSelection(hit);
        objDrag = { kind: 'pin', index: hit.index };
        this.ops.liveBegin();
        el.setPointerCapture(e.pointerId);
        return;
      }
      // Green tool with "Add pin" armed: the next click inside the green places a pin.
      if (this.tool === 'green' && this.placingPin && this.built) {
        const gb = greenBox(this.built);
        if (w.x >= gb.minX && w.x <= gb.maxX && w.y >= gb.minY && w.y <= gb.maxY) {
          this.placingPin = false;
          el.style.cursor = '';
          this.ops.instant((spec) => this.ops.mutators.addPin(spec, w.x, w.y));
          this.setSelection({ group: 'pins', index: (this.spec.pins || []).length - 1 });
          return;
        }
      }
      if (hit) {
        this.setSelection(hit);
        if (this.tool === 'select') {
          objDrag = { kind: 'object', group: hit.group, index: hit.index, drawn: !!hit.drawn, lastX: w.x, lastY: w.y };
          this.ops.liveBegin();
          el.setPointerCapture(e.pointerId);
        }
        return;
      }

      // Nothing hit: a placement tool places here (and selects what it just placed, so the
      // context panel shows its controls immediately); Select deselects.
      const placeAndSelect = (kind, group) => {
        this.ops.instant((spec) => this._place(spec, kind, w));
        // `(this.spec[group] || [])` (2026-09-22): `decor` had no default empty array anywhere in
        // the document before this batch (no course has ever carried one), and `addDecor` may not
        // exist yet in a parallel build (`_place` already fails soft for that) - so a placement
        // that added nothing must not then crash trying to select "the last thing", here or for
        // any other group whose array turns out to be absent.
        const list = this.spec[group] || [];
        this.setSelection(list.length ? { group, index: list.length - 1 } : null);
      };
      if (this.tool === 'bunker') placeAndSelect('bunker', 'bunkers');
      else if (this.tool === 'water') placeAndSelect('water', 'water');
      else if (this.tool === 'tree') placeAndSelect('tree', this.ops.getTreeMode && this.ops.getTreeMode() === 'stand' ? 'sentinels' : 'trees');
      else if (this.tool === 'cross') placeAndSelect('cross', 'cross');
      else if (this.tool === 'decor') placeAndSelect('decor', 'decor');
      else {
        // A GUARD HAZARD (a bunker, lake or tree the green's `guard` tokens generate) is not an
        // authored object, so it has no entry to select - Matt: *"The greenside bunkers on hole 6
        // for example. I cannot select, move, or delete them."* Clicking one now selects it as a
        // `guard` hit, and the panel offers to DETACH the tokens into ordinary editable objects.
        if (this.tool === 'select' && this.built && (this.spec.guard || []).length) {
          const authored = new Set(listObjects(this.spec, this.stations, this.length).filter((o) => o.poly).map((o) => JSON.stringify(o.poly[0])));
          const hitSurf = [...this.built.surfaces].reverse().find((s) => (s.kind === 'greensideBunker' || s.kind === 'fairwayBunker' || s.kind === 'water')
            && Array.isArray(s.poly) && !authored.has(JSON.stringify(s.poly[0])) && pointInPoly([w.x, w.y], s.poly));
          if (hitSurf) { this.setSelection({ group: 'guard', kind: hitSurf.kind, poly: hitSurf.poly }); return; }
        }
        this.setSelection(null);
        // Matt, 2026-09-16: *"if my cursor is set to Select, i should be able to drag the hole
        // around while zoomed in rather than having to zoom out then back in in a new area."* So
        // on Select, a left-drag that starts on empty ground PANS, the same as middle-drag or
        // Space+drag. Nothing is lost: a click on empty ground still deselects (it already did).
        if (this.tool === 'select') {
          dragging = { x: e.clientX, y: e.clientY };
          el.setPointerCapture(e.pointerId);
          el.style.cursor = 'grabbing';
        }
      }
    });

    el.addEventListener('dblclick', (e) => {
      if (!this.ops) return;
      const r = el.getBoundingClientRect();
      const w = this.toWorld(e.clientX - r.left, e.clientY - r.top);

      if (this.drawing) { this.finishDraw(); return; }

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
      if (this.drawing) { this.draw(); return; }   // the rubber band follows the cursor

      if (objDrag && this.ops) {
        if (objDrag.kind === 'waypoint') {
          this.ops.liveUpdate((spec) => this.ops.mutators.movePathPoint(spec, objDrag.index, +w.x.toFixed(1), +w.y.toFixed(1)));
        } else if (objDrag.kind === 'pin') {
          this.ops.liveUpdate((spec) => this.ops.mutators.movePin(spec, objDrag.index, w.x, w.y));
        } else if (objDrag.kind === 'resize') {
          // Scale about the object's box centre so the opposite edge stays put in feel; the
          // factor is measured against the CURRENT box each move, never compounded.
          const axis = objDrag.axis;
          this.ops.liveUpdate((spec) => {
            const o = listObjects(spec, this.stations, this.length).find((x) => x.group === objDrag.group && x.index === objDrag.index);
            if (!o || !o.poly) return spec;
            const bb = bboxHandles(o.poly);
            const cx = (bb.minX + bb.maxX) / 2; const cy = (bb.minY + bb.maxY) / 2;
            const hw = Math.max(0.5, (bb.maxX - bb.minX) / 2); const hh = Math.max(0.5, (bb.maxY - bb.minY) / 2);
            const fx = axis.includes('x') ? Math.max(0.2, Math.abs(w.x - cx) / hw) : 1;
            const fy = axis.includes('y') ? Math.max(0.2, Math.abs(w.y - cy) / hh) : 1;
            return this.ops.mutators.scaleObject(spec, objDrag.group, objDrag.index, fx, fy);
          });
        } else if (objDrag.kind === 'object' && objDrag.drawn) {
          const dx = w.x - objDrag.lastX; const dy = w.y - objDrag.lastY;
          objDrag.lastX = w.x; objDrag.lastY = w.y;
          this.ops.liveUpdate((spec) => this.ops.mutators.translateDrawn(spec, objDrag.group, objDrag.index, dx, dy));
        } else if (objDrag.kind === 'object' && objDrag.group === 'decor') {
          // A sprite has no yd/side/off (it is a plain world point) - dragging it is a translation,
          // written through the generic `moveObject(spec, 'decor', i, {x, y})`. Fails soft if that
          // group case has not landed yet.
          const wx = +w.x.toFixed(1); const wy = +w.y.toFixed(1);
          this.ops.liveUpdate((spec) => {
            if (typeof this.ops.mutators.moveObject !== 'function') {
              console.warn('[decor] moveObject mutator not available yet');
              return spec;
            }
            try { return this.ops.mutators.moveObject(spec, 'decor', objDrag.index, { x: wx, y: wy }); }
            catch (e) { console.warn('[decor] moveObject has no decor case yet', e); return spec; }
          });
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
          // `fw`'s `w` IS a half-width (holegen.js: "fairway half-width in yards"), so the signed
          // distance is written as-is. BUG, fixed 2026-09-16: this used to store `half * 2`, so a
          // handle dragged by ZERO pixels doubled the fairway (measured: w 16 -> 30 on hole 1).
          const half = Math.max(4.5, Math.min(30, Math.abs(signed)));
          this.ops.liveUpdate((spec) => {
            const key = spec.fwL || spec.fwR ? objDrag.key : 'fw';
            const profile = Array.isArray(spec[key]) ? spec[key] : [{ at: 0, w: 15 }, { at: 1, w: 15 }];
            const next = profile.map((pt, i) => (i === objDrag.index ? { ...pt, w: +half.toFixed(1) } : pt));
            return { ...spec, [key]: next };
          });
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (slopeDrag && this.ops) {
        const dx = e.clientX - slopeDrag.x0; const dy = e.clientY - slopeDrag.y0;
        const px = Math.hypot(dx, dy);
        // Screen y runs down, world y runs up the hole: flip dy. Magnitude saturates at 24 px.
        const vec = px < 4 ? [0, 0] : [+((dx / px) * Math.min(1, px / 24)).toFixed(2), +((-dy / px) * Math.min(1, px / 24)).toFixed(2)];
        const { r, c } = slopeDrag;
        slopeDrag = null;
        this.ops.instant((spec) => this.ops.mutators.setSlopeCell(spec, r, c, vec));
        try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        return;
      }
      dragging = null;
      el.style.cursor = '';
      if (objDrag && this.ops) { this.ops.liveEnd(); objDrag = null; }
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    });
    // A CANCELLED POINTER ENDS THE GESTURE TOO (2026-09-22). Without this a browser that cancels a
    // drag (a gesture handed to the OS, a lost window) left the canvas holding pointer capture, and
    // every later click anywhere on the page went to the map instead of the button under it.
    el.addEventListener('pointercancel', (e) => {
      slopeDrag = null; dragging = null; el.style.cursor = '';
      if (objDrag && this.ops) { this.ops.liveEnd(); objDrag = null; }
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    });
    el.addEventListener('pointerleave', () => { this.hover = null; if (this.onHoverChange) this.onHoverChange(null); });

    window.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (e.key === 'Backspace' && this.drawing) { e.preventDefault(); this.undoDrawPoint(); return; }
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
        if (this.drawing) this.cancelDraw();
        else if (this.selection) this.setSelection(null);
        else if (this.ruler) { this.ruler = null; if (this.onRulerChange) this.onRulerChange(null); this.draw(); }
      } else if (e.key === 'Enter' && this.drawing) {
        e.preventDefault();
        this.finishDraw();
      }
    });
  }

  /** Enter draw mode for a new bunker/lake (`replaceIndex` null) or to redraw the outline of an
   *  existing one. `kind` is the bunker kind for a new bunker. */
  startDraw(group, kind, replaceIndex = null) {
    this.drawing = { group, kind, replaceIndex, points: [] };
    this.el.style.cursor = 'crosshair';
    if (this.onDrawChange) this.onDrawChange(this.drawing);
    this.draw();
  }

  cancelDraw() {
    this.drawing = null;
    this.el.style.cursor = '';
    if (this.onDrawChange) this.onDrawChange(null);
    this.draw();
  }

  finishDraw() {
    const d = this.drawing;
    if (!d) return;
    if (d.points.length < 3) { this.cancelDraw(); return; }
    const { group, kind, replaceIndex, points } = d;
    this.drawing = null;
    this.el.style.cursor = '';
    if (group === 'green') {
      this.ops.instant((spec) => this.ops.mutators.setGreenOutline(spec, points));
      if (this.onDrawChange) this.onDrawChange(null);
      return;
    }
    if (replaceIndex != null) {
      this.ops.instant((spec) => {
        let s2 = this.ops.mutators.setDrawnPoly(spec, group, replaceIndex, points);
        // "Draw a swamp" replacing a placed swamp: `setDrawnPoly` keeps a bunker's `kind`
        // (model.js) but a water-group entry has never carried one before this batch, so the
        // swamp kind is re-stamped the same way `_place` does (see its comment).
        if (group === 'water' && kind === 'swamp') s2 = this.ops.mutators.setWaterField(s2, replaceIndex, { kind: 'swamp' });
        return s2;
      });
      this.setSelection({ group, index: replaceIndex });
    } else {
      this.ops.instant((spec) => {
        let s2 = this.ops.mutators.addDrawnShape(spec, group, points, kind);
        if (group === 'water' && kind === 'swamp') s2 = this.ops.mutators.setWaterField(s2, s2.water.length - 1, { kind: 'swamp' });
        return s2;
      });
      this.setSelection({ group, index: this.spec[group].length - 1 });
    }
    if (this.onDrawChange) this.onDrawChange(null);
  }

  /** Click placement for Bunker/Water/Tree/Cross/Decor (sections 6.4-6.6/6.10, section 4). `w` is
   *  the world point. */
  _place(spec, kind, w) {
    const placement = nearestPlacement(this.stations, this.length, w.x, w.y);
    if (kind === 'bunker') {
      const chosen = this.ops.getBunkerKind ? this.ops.getBunkerKind() : 'auto';
      return this.ops.mutators.addBunker(spec, placement, this.length, chosen === 'auto' ? undefined : chosen);
    }
    if (kind === 'water') {
      // Swamp (2026-09-22) is authored in the SAME `water` group as a pond - only `kind` differs.
      // `addWater(spec, placement, kind)` is Opus's mutator, built to take the kind directly; if a
      // build of this file runs before that lands, `addWater` simply ignores the extra argument
      // and `setWaterField` (already generic, `{...w, ...fields}`, since before this batch)
      // stamps it on afterward, so "Swamp" still works either way.
      const wk = this.ops.getWaterKind ? this.ops.getWaterKind() : 'water';
      let s2 = this.ops.mutators.addWater(spec, placement, wk === 'swamp' ? 'swamp' : undefined);
      const last = s2.water && s2.water[s2.water.length - 1];
      if (wk === 'swamp' && last && last.kind !== 'swamp') s2 = this.ops.mutators.setWaterField(s2, s2.water.length - 1, { kind: 'swamp' });
      return s2;
    }
    if (kind === 'tree') {
      const treeType = this.ops.getTreeMode && this.ops.getTreeMode() === 'stand' ? 'stand' : 'single';
      const type = this.ops.getTreePlantType ? this.ops.getTreePlantType() : 0;
      return treeType === 'stand' ? this.ops.mutators.addSentinel(spec, { ...placement, type }) : this.ops.mutators.addTree(spec, { ...placement, type });
    }
    if (kind === 'cross') {
      return this.ops.mutators.addCross(spec, {
        yd: placement.yd,
        kind: this.ops.getCrossKind ? this.ops.getCrossKind() : 'water',
        depth: this.ops.getCrossDepth ? this.ops.getCrossDepth() : 22,
        over: this.ops.getCrossOver ? this.ops.getCrossOver() : undefined,   // was dropped (2026-09-16 review)
      });
    }
    if (kind === 'decor') {
      // Bench/sign/flagpole (2026-09-22): a plain world point, not a route-relative placement -
      // a sprite is not something that follows a redrawn fairway the way a bunker does. `addDecor`
      // is Opus's mutator (`docs/HANDOFF-GOLF-OBJECTS.md` section 4); it may not exist yet in a
      // parallel build, so this fails soft with a console warning rather than throwing, exactly as
      // the handoff's own instruction says.
      const decorKind = this.ops.getDecorKind ? this.ops.getDecorKind() : 'bench';
      if (typeof this.ops.mutators.addDecor !== 'function') {
        console.warn('[decor] addDecor mutator not available yet');
        return spec;
      }
      return this.ops.mutators.addDecor(spec, decorKind, +w.x.toFixed(1), +w.y.toFixed(1));
    }
    return spec;
  }

  _deleteSelected(spec, sel) {
    // decor is just another group through the SAME generic `deleteObject` (model.js), exactly
    // like every other group here - the try/catch only covers a build of this file running before
    // that group case has landed, so a placed sprite is never stuck undeletable in the meantime.
    try {
      return this.ops.mutators.deleteObject(spec, sel.group, sel.index);
    } catch (e) {
      if (sel.group === 'decor') {
        console.warn('[decor] deleteObject has no decor case yet; removing locally', e);
        return { ...spec, decor: (spec.decor || []).filter((_, i) => i !== sel.index) };
      }
      throw e;
    }
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
    if (!m) { m = mapFor(built); this._mapCache.set(built, m); }
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

    // 2. trees - SHADOWS FIRST, the way the game draws them (2026-09-16). The game offsets a
    // tree's shadow by 0.92 yd per yard of HEIGHT, so a 47 yd tree throws its shade 43 yd across
    // the hole; the editor drew crowns only, and Matt's hole 7 looked nothing like the game's.
    if (L.trees) {
      const handCount = (built.trees || []).length;
      const types = built.treeTypes || [];
      const list = treesOf(built);
      ctx.save();
      ctx.globalAlpha = SHADOW_ALPHA;
      ctx.fillStyle = '#000';
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const type = types[t.type] || {};
        const shape = type.shape || (type.name === 'saguaro' ? 'cactus' : 'canopy');
        if (shape === 'log') continue;   // a log throws no shadow (render.js, section 3)
        if (i >= handCount && L.belts === false) continue;
        const rr = (shape === 'cactus' ? Math.max((type.trunk || 0.9) * 1.5, 1.2) : (type.canopy || 4)) * (t.s || 1) * cam.ppy;
        const th = t.h != null ? t.h : (type.height || 15);
        ctx.beginPath();
        ctx.ellipse(sx(t.x) - th * SHADOW_LEN * cam.ppy, sy(t.y) + th * SHADOW_DROP * cam.ppy, rr * SHADOW_RX, rr * SHADOW_RY, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // The editor draws a SIMPLIFIED silhouette (treeShapes' circle union, no clumps/accents -
      // those are buildMap's three-pass wood painter, section 3) rather than the full painted
      // wood: this loop needs to dim belt-origin trees per-tree (which a baked raster cannot do)
      // and stay legible at the editor's much wider zoom range, not to reproduce every brushstroke.
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const type = types[t.type] || {};
        const shape = type.shape || (type.name === 'saguaro' ? 'cactus' : 'canopy');
        const cactus = shape === 'cactus';
        const isBelt = i >= handCount;
        const [fill, rim] = TREE_FILL[type.name] || ['#3f6b34', '#26431f'];
        const r = (cactus ? Math.max((type.trunk || 0.9) * 1.5, 1.2) : (type.canopy || 4)) * (t.s || 1) * cam.ppy;
        const px = sx(t.x); const py = sy(t.y);
        ctx.globalAlpha = (isBelt && L.belts === false) ? 0 : (isBelt ? 0.6 : 1);
        if (ctx.globalAlpha > 0) {
          ctx.fillStyle = fill;
          for (const [cx, cy, cr] of treeShapes(px, py, Math.max(1, r), shape)) {
            ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
          }
          if (!cactus) {
            ctx.fillStyle = shade(rim, 0.6);
            ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, (type.trunk || 0.8) * cam.ppy), 0, Math.PI * 2); ctx.fill();
          }
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
      // THE EDITOR ALWAYS DRAWS THE READ. The game hides chevrons under SLOPE_MIN_PX because a
      // 3 px smudge on a phone tells the player nothing; here, at the fit zoom, that gate hid
      // every arrow (measured 2.2 px on Red Mesa 1), which is why Matt could not see the Slope
      // tool doing anything. A floor of 7 px keeps them legible at any zoom.
      const size = Math.max(7, cellPx * SLOPE_GLYPH_FRAC);
      {
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
        const cw = (gb.maxX - gb.minX) / sl.cols;
        const chh = (gb.maxY - gb.minY) / sl.rows;
        for (let r = 0; r < sl.rows; r++) {
          for (let c = 0; c < sl.cols; c++) {
            const g = sl.cells[r * sl.cols + c] || [0, 0];
            const mag = Math.hypot(g[0], g[1]);
            if (mag < SLOPE_FLAT) continue;
            const a = slopeGlyphAngle(g);
            // Steeper is denser: the game's own rule (render.js slopeChevronGrid), 1x1 to 3x3.
            const n = slopeChevronGrid(mag);
            const arm = (size * (n === 1 ? 1 : 0.8)) / 2;
            for (let j = 0; j < n; j++) {
              for (let i = 0; i < n; i++) {
                const px = sx(gb.minX + (c + (i + 0.5) / n) * cw);
                const py = sy(gb.minY + (r + (j + 0.5) / n) * chh);
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
          }
        }
        ctx.restore();
      }
    }

    // 3b. Slope tool in Paint mode: the 8x8 cell grid over the green's box, so a press lands in a
    // cell you can see.
    if (this.tool === 'slope' && this.spec && this.spec.slope && this.spec.slope.cells && built.green) {
      const gb = greenBox(built);
      const sl = this.spec.slope;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,206,58,.45)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= sl.cols; i++) { const x = sx(gb.minX + ((gb.maxX - gb.minX) * i) / sl.cols); ctx.beginPath(); ctx.moveTo(x, sy(gb.minY)); ctx.lineTo(x, sy(gb.maxY)); ctx.stroke(); }
      for (let j = 0; j <= sl.rows; j++) { const y = sy(gb.minY + ((gb.maxY - gb.minY) * j) / sl.rows); ctx.beginPath(); ctx.moveTo(sx(gb.minX), y); ctx.lineTo(sx(gb.maxX), y); ctx.stroke(); }
      ctx.restore();
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
        } else if (o.group === 'decor') {
          // A sprite is baked into the blitted map image already (buildMap draws it, section 4),
          // so the editor draws nothing for it unselected - only a ring, the same rule trees use.
          if (selected) {
            ctx.beginPath();
            ctx.arc(sx(o.center[0]), sy(o.center[1]), Math.max(6, (o.radius || 2) * cam.ppy + 5), 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (o.group === 'pins') {
          // A pin: a small flag with its number. Several pins = the game picks one per visit.
          const px = sx(o.center[0]); const py = sy(o.center[1]);
          ctx.save();
          ctx.fillStyle = selected ? '#ffce3a' : '#ffffff';
          ctx.strokeStyle = '#1e1e1e';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillRect(px - 1, py - 18, 2, 18);
          ctx.fillStyle = '#e01b1b';
          ctx.beginPath(); ctx.moveTo(px + 1, py - 18); ctx.lineTo(px + 11, py - 14); ctx.lineTo(px + 1, py - 10); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(o.index + 1), px, py - 21);
          ctx.restore();
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
          // The resize box and its eight white handles (Select tool, bunkers and lakes).
          if (this.tool === 'select' && o.poly && (o.group === 'bunkers' || o.group === 'water')) {
            const bb = bboxHandles(o.poly);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,.85)';
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1;
            ctx.strokeRect(sx(bb.minX), sy(bb.maxY), (bb.maxX - bb.minX) * cam.ppy, (bb.maxY - bb.minY) * cam.ppy);
            ctx.setLineDash([]);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#1e1e1e';
            for (const h of bb.handles) { const px = sx(h.x); const py = sy(h.y); ctx.fillRect(px - 5, py - 5, 10, 10); ctx.strokeRect(px - 5, py - 5, 10, 10); }
            ctx.restore();
          }
        }
      }
    }

    // 6a. a selected GUARD hazard: outline it so the click is acknowledged before it is detached.
    if (this.selection && this.selection.group === 'guard' && this.selection.poly) {
      ctx.save();
      ctx.strokeStyle = '#ffce3a'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.beginPath();
      this.selection.poly.forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }

    // 6b. a shape being drawn: the corners so far, the outline, and the rubber band to the cursor.
    if (this.drawing) {
      const pts = this.drawing.points;
      ctx.save();
      ctx.strokeStyle = '#ffce3a';
      ctx.fillStyle = '#ffce3a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => { const px = sx(p[0]); const py = sy(p[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      if (this.hover && pts.length) ctx.lineTo(sx(this.hover.x), sy(this.hover.y));
      ctx.stroke();
      if (pts.length > 2) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(sx(pts[pts.length - 1][0]), sy(pts[pts.length - 1][1])); ctx.lineTo(sx(pts[0][0]), sy(pts[0][1])); ctx.stroke(); ctx.setLineDash([]); }
      for (const p of pts) { ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${pts.length} corner${pts.length === 1 ? '' : 's'} - double-click or Enter to close, Esc to cancel`, 12, 24);
      ctx.restore();
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
