// The editor. It loads the MACHINE'S OWN engine, so Play is the real game and not a preview of it.
// Nothing here writes a game file: you export, and a session applies the export. That keeps a
// gameplay fix from ever landing on top of unsaved editing work.

// These are plain static imports and they stay that way. The build version is stamped onto every
// one of them by the IMPORT MAP that index.html installs before this file is fetched. See the
// comment there: it is the fix for a build whose version chip read v782 while the table on screen
// was hours old.
import { CONFIG, TUNABLES, KIND_NAMES, cloneConfig, gravity } from '../machines/testbox/config.js';
import { World } from '../machines/testbox/physics.js';
import { makeTable, toJSON, fromJSON, newId } from '../machines/testbox/table.js';
import { draw, fitView, toTable, toScreen } from '../machines/testbox/render.js';
import { playable, distToShape, checkGaps, tunnelProbe, restSweep, drainTime } from '../probes/checks.js';

const SAVE = 'pinball2.editor.v1';
const DEG = 180 / Math.PI;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const panel = document.getElementById('panel');
const hud = document.getElementById('hud');
const zones = document.getElementById('touchzones');
const launchBtn = document.getElementById('launch');

const app = {
  table: makeTable(),
  cfg: cloneConfig(),
  mode: 'play',
  sel: new Set(),
  view: null,
  world: null,
  trail: [],
  marks: [],
  mask: null,
  grid: 0.005,
  snap: true,
  undo: [],
  redo: [],
  slowmo: 1,
  running: true,
  lastT: 0,
  errors: 0,
  lastError: '',
  hot: {},
  repaired: 0,
  edited: false,
  staleTable: false,
  tuneAll: false,          // Tune shows the selected part's numbers unless Show all was tapped
};

/** Every number in a table must be finite. A single NaN freezes the app (see `frame`), and the
 *  autosave writes it to the phone, so it survives a reload and a force quit: the only way out was
 *  clearing site data. A part that fails this is dropped and counted, never loaded. */
function tableIsFinite(t) {
  const ok = (v) => {
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string' || typeof v === 'boolean') return true;
    // null is REJECTED, and that is the whole point of this line. JSON has no NaN, so a NaN that
    // reaches the autosave comes back as null, and null in arithmetic is 0: the freeze turns into a
    // rail silently teleported to the edge of the table on the next load. Neither is acceptable.
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.every(ok);
    if (typeof v === 'object') return Object.keys(v).every((k) => ok(v[k]));
    return false;
  };
  return ok(t);
}

function repairTable(t) {
  const good = t.shapes.filter((sh) => tableIsFinite(sh));
  const dropped = t.shapes.length - good.length;
  t.shapes = good;
  if (!tableIsFinite({ w: t.w, h: t.h, launch: t.launch })) {
    t.w = 0.515; t.h = 1.067; t.launch = { x: 0.452, y: 0.14 };
  }
  return dropped;
}

// ------------------------------------------------------------------ persistence

/** What is actually on the table, in the corner, so nobody has to guess whether they are looking at
 *  the current build. One line, and it would have answered the question outright. */
function tableKinds() {
  const n = {};
  for (const sh of app.table.shapes) n[sh.kind] = (n[sh.kind] || 0) + 1;
  return Object.keys(n).sort().map((k) => `${n[k]} ${k}`).join(', ');
}

/** A cheap fingerprint of the table the MACHINE ships, so the editor can tell whether what is
 *  stored on this device was made from the same starting point. */
function shippedSig() {
  try {
    const t = makeTable();
    return `${t.shapes.length}:${t.shapes.map((sh) => sh.kind).join('')}:${Math.round(t.w * 1e4)}`;
  } catch (e) { return '?'; }
}

function save() {
  try {
    if (!tableIsFinite(app.table)) return;      // never write a table that would freeze the app
    localStorage.setItem(SAVE, JSON.stringify({
      table: JSON.parse(toJSON(app.table)),
      cfg: app.cfg,
      shipped: shippedSig(),
      edited: app.edited,
    }));
  } catch (e) { /* a full or blocked store must never stop the tool working */ }
}

function load() {
  try {
    // An escape hatch that needs no explaining over chat: open the editor with ?fresh on the end.
    if (/[?&]fresh\b/.test(location.search)) { localStorage.removeItem(SAVE); return; }
    const raw = localStorage.getItem(SAVE);
    if (!raw) return;
    const d = JSON.parse(raw);
    // THE AUTOSAVE MUST NOT HIDE A NEW BUILD. The editor restores whatever this device last had,
    // which is right for work in progress and badly wrong the day the machine ships new parts:
    // Matt opened a build with bumpers, slingshots and a ramp in it and saw the bare box he had
    // saved a build earlier. "Where are all the updates you just did?"
    //
    // So the save records the fingerprint of the table it started from. If the shipped table has
    // changed since, an UNEDITED save is simply dropped and the new one loaded, and an edited one
    // is kept with a line in the corner saying the shipped table moved on.
    const sig = shippedSig();
    if (d.table) {
      // A SAVE WITH NO FINGERPRINT PREDATES THE FINGERPRINT, so it is old by definition. The first
      // version of this check read `d.shipped && d.shipped !== sig`, which is false when the field
      // is missing - so it kept the old table, which is the ONE case the check was written for.
      // Matt, on the build that was meant to fix it: "All I have is a stale bare bones tool from
      // hours ago."
      const stale = d.shipped !== sig;
      // An unfingerprinted save is also one whose `edited` flag was never tracked, so it cannot be
      // trusted either. The shipped table wins and the old one is kept under its own key rather
      // than deleted, so nothing is actually lost.
      const trustEdited = d.shipped != null && d.edited;
      if (stale && !trustEdited) {
        try { localStorage.setItem(SAVE + '.replaced', JSON.stringify(d)); } catch (e) {}
        app.table = makeTable();                // take the new build
      } else {
        const t = fromJSON(d.table);
        app.repaired = repairTable(t);          // an already poisoned phone heals on this load
        app.table = t;
        app.edited = !!d.edited;
        if (stale) app.staleTable = true;
      }
    }
    if (d.cfg) {
      const c = cloneConfig(d.cfg);
      for (const k of Object.keys(c)) if (!Number.isFinite(c[k]) && typeof CONFIG[k] === 'number') c[k] = CONFIG[k];
      app.cfg = c;
    }
  } catch (e) { /* a corrupt autosave falls back to the shipped table rather than a blank screen */ }
}

function pushUndo() {
  app.undo.push(toJSON(app.table));
  if (app.undo.length > 100) app.undo.shift();
  app.redo.length = 0;
}

function doUndo() {
  if (!app.undo.length) return;
  app.redo.push(toJSON(app.table));
  app.table = fromJSON(app.undo.pop());
  app.sel.clear();
  afterEdit();
}

function doRedo() {
  if (!app.redo.length) return;
  app.undo.push(toJSON(app.table));
  app.table = fromJSON(app.redo.pop());
  app.sel.clear();
  afterEdit();
}

function afterEdit() {
  app.edited = true;
  app.mask = null;
  app.marks = [];
  save();
  renderPanel();
}

// ------------------------------------------------------------------ canvas sizing

function resize() {
  const r = canvas.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;      // mid layout, and a zero box makes a useless view
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const keep = app.view;
  app.view = fitView(app.table, r.width, r.height);
  if (keep) { app.view.zoom = keep.zoom; app.view.px = keep.px; app.view.py = keep.py; }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

// The canvas is laid out by flex, so switching tabs changes its height without any window resize:
// Play's panel is shorter than Edit's. Listening only to `resize` left the backing store and the
// view transform describing the PREVIOUS height, which stretched the picture and put every tap out
// by exactly that difference. Matt, on the first build: "it's like it thinks I'm selecting
// something an inch above where my finger actually is."
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => resize()).observe(canvas);
}

// ------------------------------------------------------------------ play

function newBall() {
  app.world = new World(app.table, app.cfg);
  app.world.addBall(app.table.launch, { x: 0, y: 0.1 });
  app.trail = [];
}

function ensureWorld() {
  if (!app.world || !app.world.balls.some((b) => b.alive)) newBall();
}

function stepPlay(dt) {
  if (!app.world) return;
  const n = Math.min(8, Math.max(1, Math.round((dt * app.slowmo) / app.cfg.DT)));
  for (let i = 0; i < n; i++) app.world.step(app.cfg.DT);
  const b = app.world.balls.find((x) => x.alive);
  if (b) {
    app.trail.push({ x: b.p.x, y: b.p.y });
    if (app.trail.length > 90) app.trail.shift();
  }
}

function setFlipper(side, on) {
  if (app.world) app.world.setFlipper(side, on);
}

// ------------------------------------------------------------------ hit testing

/** Tolerance is a FINGER, so it is measured in screen pixels and converted, not fixed in metres.
 *  At the default fit a millimetre is under a pixel, so the old 12 mm reach was 8 px. */
/** How far a point is from a ramp's centre line. `distToShape` deliberately answers Infinity for a
 *  ribbon, because a ramp is above the playfield and nothing rolling along the floor can hit it.
 *  Tapping one in the editor is a different question, so it gets its own answer here. */
function distToRibbon(sh, p) {
  let best = Infinity;
  for (let i = 0; i + 1 < sh.pts.length; i++) {
    const a = sh.pts[i];
    const b = sh.pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const u = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u)) - sh.w / 2);
  }
  return best;
}

function shapeAt(p) {
  const reach = 22 / (app.view.s * app.view.zoom);
  let best = null;
  let bestD = Infinity;
  for (const sh of app.table.shapes) {
    const d = sh.kind === 'ribbon' ? distToRibbon(sh, p) : distToShape(sh, p);
    const pick = sh.kind === 'drain' ? (d <= 0.002 ? 0.002 : Infinity) : d;
    if (pick < reach && pick < bestD) { bestD = pick; best = sh; }
  }
  return best;
}

function handlesFor(sh) {
  const out = [];
  if (sh.kind === 'seg') {
    out.push({ key: 'a', at: sh.a });
    out.push({ key: 'b', at: sh.b });
  } else if (sh.kind === 'arc') {
    out.push({ key: 'c', at: sh.c });
    out.push({ key: 'r', at: { x: sh.c.x + sh.radius * Math.cos(sh.a0), y: sh.c.y + sh.radius * Math.sin(sh.a0) } });
    out.push({ key: 'r1', at: { x: sh.c.x + sh.radius * Math.cos(sh.a1), y: sh.c.y + sh.radius * Math.sin(sh.a1) } });
  } else if (sh.kind === 'circle' || sh.kind === 'bumper') {
    out.push({ key: 'c', at: sh.c });
  } else if (sh.kind === 'sling') {
    out.push({ key: 'a', at: sh.a });
    out.push({ key: 'b', at: sh.b });
  } else if (sh.kind === 'flipper') {
    out.push({ key: 'pivot', at: sh.pivot });
    out.push({ key: 'tip', at: { x: sh.pivot.x + sh.len * Math.cos(sh.restAng), y: sh.pivot.y + sh.len * Math.sin(sh.restAng) } });
  } else if (sh.kind === 'ribbon') {
    out.push({ key: 'm0', at: sh.pts[0] });
    out.push({ key: 'm1', at: sh.pts[sh.pts.length - 1] });
  } else if (sh.kind === 'drain') {
    out.push({ key: 'tl', at: { x: sh.x, y: sh.y } });
    out.push({ key: 'br', at: { x: sh.x + sh.w, y: sh.y + sh.h } });
  }
  return out;
}

function snap(p) {
  if (!app.snap) return p;
  const g = app.grid;
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}

function moveShape(sh, dx, dy) {
  if (sh.kind === 'seg' || sh.kind === 'sling') { sh.a.x += dx; sh.a.y += dy; sh.b.x += dx; sh.b.y += dy; }
  else if (sh.kind === 'arc' || sh.kind === 'circle' || sh.kind === 'bumper') { sh.c.x += dx; sh.c.y += dy; }
  else if (sh.kind === 'flipper') { sh.pivot.x += dx; sh.pivot.y += dy; }
  else if (sh.kind === 'ribbon') { for (const q of sh.pts) { q.x += dx; q.y += dy; } }
  else if (sh.kind === 'drain') { sh.x += dx; sh.y += dy; }
}

// ------------------------------------------------------------------ pointer

const drag = { mode: null, id: null, key: null, last: null, start: null, box: null, moved: false, at: null, fine: false, holdT: 0 };
const touches = new Map();
const edits = new Map();                // pointers down in Edit/Tune, for pinch

// HOW FAR DOES THE HANDLE MOVE PER MILLIMETRE OF FINGER. Matt: "if I hold it down I can precisely
// move stuff." A drag that has been held still first is a FINE drag: the finger moves a centimetre
// and the handle moves two and a half millimetres, which is how you shorten a slingshot by one grid
// step on a phone without zooming in first.
const FINE_HOLD_MS = 400;
const FINE_RATIO = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 12;
const LOUPE_MAG = 4;                    // the magnifier's own zoom, on top of the view's
const LOUPE_R = 62;                     // screen px

function localPt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Zoom about a screen point, so the thing under the fingers stays under the fingers. Zooming about
 *  the origin instead is what makes a pinch feel like the table is running away. */
function zoomAbout(sx, sy, factor) {
  const v = app.view;
  const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor));
  if (nz === v.zoom) return;
  const X = (sx - v.ox) / v.zoom - v.px;
  const Y = (sy - v.oy) / v.zoom - v.py;
  v.px = ((X + v.px) * v.zoom) / nz - X;
  v.py = ((Y + v.py) * v.zoom) / nz - Y;
  v.zoom = nz;
}

function panBy(dx, dy) {
  app.view.px += dx / app.view.zoom;
  app.view.py += dy / app.view.zoom;
}

function fitAll() {
  app.view.zoom = 1;
  app.view.px = 0;
  app.view.py = 0;
}

/** A second finger means PINCH, never a second edit. Anything the first finger had already dragged
 *  is put back: a two-finger zoom must not leave a part moved by however far the first finger
 *  travelled on its way to being joined. */
function cancelDragForPinch() {
  if (drag.mode === 'handle' || drag.mode === 'move') {
    const snap = app.undo.pop();          // pushUndo ran when the drag started
    if (snap) { app.table = fromJSON(snap); save(); }
  }
  drag.mode = null;
  drag.box = null;
  drag.at = null;
  drag.fine = false;
}

const pinch = { on: false, d: 0, mid: null };

function pinchState() {
  const pts = [...edits.values()];
  if (pts.length < 2) return null;
  const [a, b] = pts;
  return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

canvas.addEventListener('pointerdown', (e) => {
  // Capture is a CONVENIENCE: it keeps a drag alive when the finger leaves the canvas. It throws
  // ("no active pointer with the given id") often enough to matter, and an exception on the first
  // line of this handler means the tap does nothing at all, which reads exactly like the dead
  // hit-testing bug this tool already had once. It is never worth the whole gesture.
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* drag still works, just not off-canvas */ }
  const s = localPt(e);
  if (app.mode === 'play') {
    touches.set(e.pointerId, s.x);
    setFlipper(s.x < canvas.getBoundingClientRect().width / 2 ? 'L' : 'R', true);
    return;
  }
  edits.set(e.pointerId, s);
  const two = pinchState();
  if (two) {
    cancelDragForPinch();
    pinch.on = true;
    pinch.d = two.d;
    pinch.mid = two.mid;
    renderPanel();
    return;
  }
  const p = toTable(app.view, s);
  drag.moved = false;
  drag.last = p;
  drag.start = p;
  drag.at = s;
  drag.fine = false;
  drag.holdT = performance.now();
  drag.raw = p;                         // where the finger is
  drag.virt = p;                        // where the HANDLE is, which a fine drag separates from it

  // TUNE SELECTS, IT NEVER MOVES. Tapping a part here is how you ask for its sliders, and a tap on
  // a phone always drags a few pixels, so sharing Edit's handler would quietly nudge the geometry
  // every time - an edit nobody asked for, on a tab where nobody is watching the table for changes.
  if (app.mode === 'tune') {
    const pick = shapeAt(p);
    drag.mode = null;                             // no handle, no move, no lasso on this tab
    app.sel.clear();
    if (pick) app.sel.add(pick.id);
    app.tuneAll = false;                          // a new selection means "show me this one"
    renderPanel();
    return;
  }

  for (const id of app.sel) {
    const sh = app.table.shapes.find((x) => x.id === id);
    if (!sh) continue;
    for (const h of handlesFor(sh)) {
      const hs = toScreen(app.view, h.at);
      if (Math.hypot(hs.x - s.x, hs.y - s.y) < 18) {
        pushUndo();
        drag.mode = 'handle'; drag.id = id; drag.key = h.key;
        return;
      }
    }
  }

  const hit = shapeAt(p);
  if (hit) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (app.sel.has(hit.id)) app.sel.delete(hit.id); else app.sel.add(hit.id);
    } else if (!app.sel.has(hit.id)) {
      app.sel.clear();
      app.sel.add(hit.id);
    }
    pushUndo();
    drag.mode = 'move';
    renderPanel();
  } else {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) app.sel.clear();
    drag.mode = 'lasso';
    drag.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    renderPanel();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (app.mode === 'play') return;
  const s = localPt(e);
  if (edits.has(e.pointerId)) edits.set(e.pointerId, s);

  // PINCH TO ZOOM, TWO FINGERS TO PAN. There was no way to zoom on a phone at all: the wheel
  // handler is a desktop control, and at the default fit a millimetre of table is under a pixel, so
  // a slingshot's end handle was smaller than the finger reaching for it.
  if (pinch.on) {
    const two = pinchState();
    if (two) {
      if (pinch.d > 1) zoomAbout(two.mid.x, two.mid.y, two.d / pinch.d);
      panBy(two.mid.x - pinch.mid.x, two.mid.y - pinch.mid.y);
      pinch.d = two.d;
      pinch.mid = two.mid;
    }
    return;
  }
  if (!drag.mode) return;
  drag.at = s;

  // HOLD STILL, THEN DRAG, AND THE HANDLE MOVES A QUARTER AS FAR AS THE FINGER. Engaged on the
  // first movement rather than on a timer, so nothing changes under a finger that is not moving.
  if (!drag.moved && performance.now() - drag.holdT > FINE_HOLD_MS) drag.fine = true;

  const raw = toTable(app.view, s);
  const ratio = drag.fine ? FINE_RATIO : 1;
  drag.virt = {
    x: drag.virt.x + (raw.x - drag.raw.x) * ratio,
    y: drag.virt.y + (raw.y - drag.raw.y) * ratio,
  };
  drag.raw = raw;
  const p = drag.virt;
  drag.moved = true;
  if (drag.mode === 'lasso') { drag.box.x1 = raw.x; drag.box.y1 = raw.y; return; }

  if (drag.mode === 'handle') {
    const sh = app.table.shapes.find((x) => x.id === drag.id);
    if (!sh) return;
    const q = snap(p);
    if (sh.kind === 'seg' || sh.kind === 'sling') { sh[drag.key] = q; }
    else if (sh.kind === 'arc') {
      if (drag.key === 'c') sh.c = q;
      else {
        const ang = Math.atan2(p.y - sh.c.y, p.x - sh.c.x);
        if (drag.key === 'r') { sh.radius = Math.max(0.01, Math.hypot(p.x - sh.c.x, p.y - sh.c.y)); sh.a0 = ang; }
        else sh.a1 = ang;
      }
    } else if (sh.kind === 'circle' || sh.kind === 'bumper') { sh.c = q; }
    else if (sh.kind === 'flipper') {
      if (drag.key === 'pivot') sh.pivot = q;
      else {
        sh.len = Math.max(0.02, Math.hypot(p.x - sh.pivot.x, p.y - sh.pivot.y));
        const a = Math.atan2(p.y - sh.pivot.y, p.x - sh.pivot.x);
        const swing = sh.endAng - sh.restAng;
        sh.restAng = a;
        sh.endAng = a + swing;
      }
    } else if (sh.kind === 'ribbon') {
      const anchor = drag.key === 'm0' ? sh.pts[0] : sh.pts[sh.pts.length - 1];
      const dx2 = q.x - anchor.x;
      const dy2 = q.y - anchor.y;
      for (const pt of sh.pts) { pt.x += dx2; pt.y += dy2; }
    } else if (sh.kind === 'drain') {
      if (drag.key === 'tl') { sh.w += sh.x - q.x; sh.h += sh.y - q.y; sh.x = q.x; sh.y = q.y; }
      else { sh.w = Math.max(0.01, q.x - sh.x); sh.h = Math.max(0.01, q.y - sh.y); }
    }
    return;
  }

  if (drag.mode === 'move') {
    let dx = p.x - drag.last.x;
    let dy = p.y - drag.last.y;
    if (app.snap) {
      const t = snap({ x: p.x, y: p.y });
      const l = snap({ x: drag.last.x, y: drag.last.y });
      dx = t.x - l.x; dy = t.y - l.y;
      if (dx === 0 && dy === 0) return;
      drag.last = { x: l.x + dx, y: l.y + dy };
    } else {
      drag.last = p;
    }
    for (const id of app.sel) {
      const sh = app.table.shapes.find((x) => x.id === id);
      if (sh) moveShape(sh, dx, dy);
    }
  }
});

function endDrag(e) {
  if (app.mode === 'play') {
    touches.delete(e.pointerId);
    const w = canvas.getBoundingClientRect().width;
    let l = false;
    let r = false;
    for (const x of touches.values()) { if (x < w / 2) l = true; else r = true; }
    setFlipper('L', l);
    setFlipper('R', r);
    return;
  }
  if (drag.mode === 'lasso' && drag.box) {
    const b = drag.box;
    const x0 = Math.min(b.x0, b.x1);
    const x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1);
    const y1 = Math.max(b.y0, b.y1);
    if (Math.abs(x1 - x0) > 0.004 || Math.abs(y1 - y0) > 0.004) {
      for (const sh of app.table.shapes) {
        const c = centreOf(sh);
        if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) app.sel.add(sh.id);
      }
    }
  }
  if (drag.mode && drag.moved) afterEdit();
  drag.mode = null; drag.box = null; drag.at = null; drag.fine = false;
  renderPanel();
}
canvas.addEventListener('pointerup', (e) => {
  if (app.mode !== 'play') {
    edits.delete(e.pointerId);
    // The pinch ends when the SECOND finger lifts, not when the count drops to one: carrying on as
    // a one-finger drag from wherever that finger happens to be would drag a part across the table.
    if (pinch.on) { if (edits.size < 2) { pinch.on = false; renderPanel(); } return; }
  }
  endDrag(e);
});
canvas.addEventListener('pointercancel', (e) => {
  if (app.mode !== 'play') {
    edits.delete(e.pointerId);
    if (pinch.on) { if (edits.size < 2) { pinch.on = false; renderPanel(); } return; }
  }
  endDrag(e);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const s = localPt(e);
  zoomAbout(s.x, s.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

function centreOf(sh) {
  if (sh.kind === 'seg' || sh.kind === 'sling') return { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2 };
  if (sh.kind === 'arc' || sh.kind === 'circle' || sh.kind === 'bumper') return sh.c;
  if (sh.kind === 'flipper') return sh.pivot;
  if (sh.kind === 'ribbon') return sh.pts[Math.floor(sh.pts.length / 2)];
  return { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 };
}

// ------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  const typing = e.target && /input|select|textarea/i.test(e.target.tagName);
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && app.mode === 'edit') {
    e.preventDefault();
    for (const sh of app.table.shapes) app.sel.add(sh.id);
    renderPanel();
    return;
  }
  if (app.mode === 'play') {
    if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowLeft') setFlipper('L', true);
    if (e.key === 'm' || e.key === 'M' || e.key === 'ArrowRight') setFlipper('R', true);
    if (e.key === ' ') { e.preventDefault(); newBall(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  if (e.key === 'd' && app.sel.size) duplicateSel();
  const nudge = e.shiftKey ? app.grid * 5 : app.grid;
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (map[e.key] && app.sel.size) {
    e.preventDefault();
    pushUndo();
    for (const id of app.sel) {
      const sh = app.table.shapes.find((x) => x.id === id);
      if (sh) moveShape(sh, map[e.key][0] * nudge, map[e.key][1] * nudge);
    }
    afterEdit();
  }
});

window.addEventListener('keyup', (e) => {
  if (app.mode !== 'play') return;
  if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowLeft') setFlipper('L', false);
  if (e.key === 'm' || e.key === 'M' || e.key === 'ArrowRight') setFlipper('R', false);
});

// ------------------------------------------------------------------ edit actions

function deleteSel() {
  if (!app.sel.size) return;
  pushUndo();
  app.table.shapes = app.table.shapes.filter((s) => !app.sel.has(s.id));
  app.sel.clear();
  afterEdit();
}

function duplicateSel() {
  if (!app.sel.size) return;
  pushUndo();
  const made = [];
  for (const id of app.sel) {
    const sh = app.table.shapes.find((x) => x.id === id);
    if (!sh) continue;
    const copy = JSON.parse(JSON.stringify(sh));
    copy.id = newId(sh.kind[0]);
    moveShape(copy, app.grid * 4, app.grid * 4);
    app.table.shapes.push(copy);
    made.push(copy.id);
  }
  app.sel = new Set(made);
  afterEdit();
}

function addShape(kind) {
  pushUndo();
  const cx = app.table.w / 2;
  const cy = app.table.h / 2;
  let sh;
  if (kind === 'seg') sh = { id: newId('w'), kind: 'seg', a: { x: cx - 0.06, y: cy }, b: { x: cx + 0.06, y: cy }, r: 0.008 };
  else if (kind === 'arc') sh = { id: newId('a'), kind: 'arc', c: { x: cx, y: cy }, radius: 0.06, a0: Math.PI, a1: Math.PI * 1.5, r: 0.008 };
  else if (kind === 'circle') sh = { id: newId('p'), kind: 'circle', c: { x: cx, y: cy }, r: 0.012 };
  else if (kind === 'bumper') sh = { id: newId('b'), kind: 'bumper', c: { x: cx, y: cy }, r: 0.026 };
  else if (kind === 'sling') sh = { id: newId('s'), kind: 'sling', a: { x: cx - 0.06, y: cy - 0.05 }, b: { x: cx + 0.06, y: cy + 0.05 }, r: 0.008 };
  else if (kind === 'flipper') sh = { id: newId('f'), kind: 'flipper', side: 'L', pivot: { x: cx, y: cy }, len: 0.07, r0: 0.012, r1: 0.007, restAng: 25 / DEG, endAng: -27 / DEG };
  else sh = { id: newId('d'), kind: 'drain', x: cx - 0.06, y: cy, w: 0.12, h: 0.05 };
  app.table.shapes.push(sh);
  app.sel = new Set([sh.id]);
  afterEdit();
}

// ------------------------------------------------------------------ panels

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

/** LENGTH AND ANGLE, for the one edit four coordinates cannot express. Matt, on a slingshot: "I
 *  want to extend or shorten it." With only A and B, shortening a line that is not square to the
 *  table means recomputing both ends by hand and getting its angle slightly wrong every time.
 *  Length holds A and slides B along the line; Angle holds A and swings B round it. */
function lengthAndAngle(sh, mm) {
  const dx = sh.b.x - sh.a.x;
  const dy = sh.b.y - sh.a.y;
  const L = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  panel.append(numRow('Length (mm)', mm(L), 1, (v) => {
    const n = Math.max(0.001, v / 1000);
    sh.b = { x: sh.a.x + Math.cos(ang) * n, y: sh.a.y + Math.sin(ang) * n };
  }));
  panel.append(numRow('Angle (deg)', Math.round(ang * DEG * 10) / 10, 1, (v) => {
    const t = v / DEG;
    sh.b = { x: sh.a.x + Math.cos(t) * L, y: sh.a.y + Math.sin(t) * L };
  }));
}

function numRow(label, value, step, onChange) {
  const r = el(`<div class="row"><label>${label}</label><input type="number" step="${step}" value="${value}"></div>`);
  const input = r.querySelector('input');
  input.addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) { e.target.value = value; return; }   // an empty box is not a number
    pushUndo();
    onChange(v);
    afterEdit();
  });
  return r;
}

function renderPanel() {
  panel.innerHTML = '';
  panel.classList.remove('hidden');
  if (app.mode === 'play') return renderPlayPanel();
  if (app.mode === 'edit') return renderEditPanel();
  if (app.mode === 'tune') return renderTunePanel();
  return renderCheckPanel();
}

function renderPlayPanel() {
  const r = el('<div class="row"></div>');
  const nb = el('<button class="primary">New ball</button>');
  nb.onclick = newBall;
  const slow = el('<button>Slow motion</button>');
  slow.onclick = () => { app.slowmo = app.slowmo === 1 ? 0.25 : 1; slow.textContent = app.slowmo === 1 ? 'Slow motion' : 'Full speed'; };
  const pause = el('<button>Pause</button>');
  pause.onclick = () => { app.running = !app.running; pause.textContent = app.running ? 'Pause' : 'Resume'; };
  const stepb = el('<button>Step frame</button>');
  stepb.onclick = () => { app.running = false; pause.textContent = 'Resume'; stepPlay(1 / 60); };
  r.append(nb, slow, pause, stepb);
  panel.append(r);
  panel.append(el('<div class="note">Hold the left or right half of the table to flip, or Z and M on a keyboard. Space drops a new ball.</div>'));
}

function renderEditPanel() {
  const add = el('<div class="row"></div>');
  for (const [k, name] of [['seg', '+ Wall'], ['arc', '+ Arc'], ['circle', '+ Post'], ['bumper', '+ Bumper'], ['sling', '+ Sling'], ['flipper', '+ Flipper'], ['drain', '+ Drain']]) {
    const b = el(`<button>${name}</button>`);
    b.onclick = () => addShape(k);
    add.append(b);
  }
  panel.append(add);

  // ENLARGE. There was no way to zoom on a phone at all, and at the default fit a millimetre of
  // table is under a pixel: a slingshot's end handle is smaller than the finger reaching for it.
  // Pinch does the same thing; these are here because a control you can see beats one you have to
  // know about, and because a phone held one-handed has one thumb.
  const zoomRow = el('<div class="row"></div>');
  const zLabel = el(`<label>Zoom ${Math.round(app.view ? app.view.zoom * 100 : 100)}%</label>`);
  const bump = (k) => {
    const r = canvas.getBoundingClientRect();
    zoomAbout(r.width / 2, r.height / 2, k);
    zLabel.textContent = `Zoom ${Math.round(app.view.zoom * 100)}%`;
  };
  const zOut = el('<button>&minus;</button>'); zOut.onclick = () => bump(1 / 1.4);
  const zIn = el('<button>+</button>'); zIn.onclick = () => bump(1.4);
  const zFit = el('<button>Fit</button>');
  zFit.onclick = () => { fitAll(); zLabel.textContent = 'Zoom 100%'; };
  zoomRow.append(zLabel, zOut, zIn, zFit);
  panel.append(zoomRow);
  panel.append(el('<div class="note">Pinch to zoom, two fingers to pan. Press and hold a part or a handle for half a second before dragging and it moves a quarter as far as your finger, with a magnifier in the corner.</div>'));

  const ops = el('<div class="row"></div>');
  const dup = el('<button>Duplicate</button>'); dup.onclick = duplicateSel; dup.disabled = !app.sel.size;
  const del = el('<button class="danger">Delete</button>'); del.onclick = deleteSel; del.disabled = !app.sel.size;
  const un = el('<button>Undo</button>'); un.onclick = doUndo; un.disabled = !app.undo.length;
  const re = el('<button>Redo</button>'); re.onclick = doRedo; re.disabled = !app.redo.length;
  const sn = el(`<button>Snap ${app.snap ? 'on' : 'off'}</button>`);
  sn.onclick = () => { app.snap = !app.snap; renderPanel(); };
  ops.append(dup, del, un, re, sn);
  panel.append(ops);

  const io = el('<div class="row"></div>');
  const exp = el('<button>Export JSON</button>');
  exp.onclick = () => {
    const blob = new Blob([toJSON(app.table)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${app.table.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const imp = el('<button>Import</button>');
  imp.onclick = () => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'application/json,.json';
    i.onchange = () => {
      const f = i.files && i.files[0];
      if (!f) return;
      f.text().then((t) => {
        pushUndo();
        const nt = fromJSON(t);
        const dropped = repairTable(nt);
        if (dropped) alert(`${dropped} part(s) in that file had numbers that are not numbers, and were left out.`);
        app.table = nt;
        app.sel.clear();
        resize();
        afterEdit();
      });
    };
    i.click();
  };
  const reset = el('<button class="danger">Reset table</button>');
  reset.onclick = () => {
    if (!confirm('Throw away every edit and reload the table as it ships?')) return;
    pushUndo();
    app.table = makeTable();
    app.sel.clear();
    app.edited = false;
    app.staleTable = false;
    resize();
    afterEdit();
    app.edited = false;                         // reset means "back to the shipped table", not an edit
    save();
  };
  io.append(exp, imp, reset);
  panel.append(io);

  if (app.sel.size === 0) {
    panel.append(el('<div class="note">Tap a part to select it. Drag empty space to lasso. Shift adds to the selection. Arrow keys nudge, shift-arrow nudges further.</div>'));
    return;
  }
  if (app.sel.size > 1) {
    panel.append(el(`<div class="note">${app.sel.size} parts selected. Drag to move them together.</div>`));
    return;
  }
  const sh = app.table.shapes.find((x) => app.sel.has(x.id));
  if (!sh) return;
  panel.append(el(`<h2>${sh.kind} ${sh.id}</h2>`));
  const mm = (v) => Math.round(v * 10000) / 10;   // metres shown as millimetres, one decimal

  if (sh.kind === 'bumper') {
    panel.append(numRow('Centre x', mm(sh.c.x), 1, (v) => { sh.c.x = v / 1000; }));
    panel.append(numRow('Centre y', mm(sh.c.y), 1, (v) => { sh.c.y = v / 1000; }));
    panel.append(numRow('Radius', mm(sh.r), 1, (v) => { sh.r = v / 1000; }));
    panel.append(numRow('Bounce (m/s)', sh.bounce != null ? sh.bounce : app.cfg.BUMPER_BOUNCE, 0.1, (v) => { sh.bounce = v; }));
    panel.append(el('<div class="note">Bounce is the speed the ball LEAVES at, not a bounciness. A slow roll into a bumper comes out just as fast, which is what a real one does.</div>'));
  } else if (sh.kind === 'sling') {
    panel.append(numRow('A x (mm)', mm(sh.a.x), 1, (v) => { sh.a.x = v / 1000; }));
    panel.append(numRow('A y (mm)', mm(sh.a.y), 1, (v) => { sh.a.y = v / 1000; }));
    panel.append(numRow('B x (mm)', mm(sh.b.x), 1, (v) => { sh.b.x = v / 1000; }));
    panel.append(numRow('B y (mm)', mm(sh.b.y), 1, (v) => { sh.b.y = v / 1000; }));
    lengthAndAngle(sh, mm);
    panel.append(numRow('Thickness', mm(sh.r * 2), 0.5, (v) => { sh.r = v / 2000; }));
    panel.append(numRow('Bounce (m/s)', sh.bounce != null ? sh.bounce : app.cfg.SLING_BOUNCE, 0.1, (v) => { sh.bounce = v; }));
  } else if (sh.kind === 'ribbon') {
    const zmax = Math.max(...sh.pts.map((q) => q.z || 0));
    panel.append(numRow('Lane width', mm(sh.w), 1, (v) => { sh.w = v / 1000; }));
    panel.append(numRow('Height', mm(zmax), 1, (v) => {
      const k = zmax > 1e-6 ? (v / 1000) / zmax : 0;
      for (const q of sh.pts) q.z = (q.z || 0) * k;
    }));
    panel.append(el(`<div class="note">${sh.pts.length} points, ${(sh.w * 1000).toFixed(0)}mm wide, rising to ${(zmax * 1000).toFixed(0)}mm. Drag either end dot to move the whole ramp. Both ends must stay at zero height, and the Check panel will tell you if they do not.</div>`));
  } else if (sh.kind === 'seg') {
    panel.append(numRow('A x (mm)', mm(sh.a.x), 1, (v) => { sh.a.x = v / 1000; }));
    panel.append(numRow('A y (mm)', mm(sh.a.y), 1, (v) => { sh.a.y = v / 1000; }));
    panel.append(numRow('B x (mm)', mm(sh.b.x), 1, (v) => { sh.b.x = v / 1000; }));
    panel.append(numRow('B y (mm)', mm(sh.b.y), 1, (v) => { sh.b.y = v / 1000; }));
    lengthAndAngle(sh, mm);
    panel.append(numRow('Thickness', mm(sh.r * 2), 0.5, (v) => { sh.r = v / 2000; }));
    panel.append(numRow('Bounce', sh.e != null ? sh.e : app.cfg.BALL_E, 0.01, (v) => { sh.e = v; }));
  } else if (sh.kind === 'arc') {
    panel.append(numRow('Centre x', mm(sh.c.x), 1, (v) => { sh.c.x = v / 1000; }));
    panel.append(numRow('Centre y', mm(sh.c.y), 1, (v) => { sh.c.y = v / 1000; }));
    panel.append(numRow('Radius', mm(sh.radius), 1, (v) => { sh.radius = v / 1000; }));
    panel.append(numRow('From (deg)', Math.round(sh.a0 * DEG), 1, (v) => { sh.a0 = v / DEG; }));
    panel.append(numRow('To (deg)', Math.round(sh.a1 * DEG), 1, (v) => { sh.a1 = v / DEG; }));
    panel.append(numRow('Thickness', mm(sh.r * 2), 0.5, (v) => { sh.r = v / 2000; }));
  } else if (sh.kind === 'circle') {
    panel.append(numRow('Centre x', mm(sh.c.x), 1, (v) => { sh.c.x = v / 1000; }));
    panel.append(numRow('Centre y', mm(sh.c.y), 1, (v) => { sh.c.y = v / 1000; }));
    panel.append(numRow('Radius', mm(sh.r), 0.5, (v) => { sh.r = v / 1000; }));
  } else if (sh.kind === 'flipper') {
    const side = el(`<div class="row"><label>Side</label><select><option value="L">Left</option><option value="R">Right</option></select></div>`);
    side.querySelector('select').value = sh.side;
    side.querySelector('select').onchange = (e) => { pushUndo(); sh.side = e.target.value; afterEdit(); };
    panel.append(side);
    panel.append(numRow('Pivot x', mm(sh.pivot.x), 1, (v) => { sh.pivot.x = v / 1000; }));
    panel.append(numRow('Pivot y', mm(sh.pivot.y), 1, (v) => { sh.pivot.y = v / 1000; }));
    panel.append(numRow('Length', mm(sh.len), 1, (v) => { sh.len = v / 1000; }));
    panel.append(numRow('Pivot end r', mm(sh.r0), 0.5, (v) => { sh.r0 = v / 1000; }));
    panel.append(numRow('Tip r', mm(sh.r1), 0.5, (v) => { sh.r1 = v / 1000; }));
    panel.append(numRow('Rest (deg)', Math.round(sh.restAng * DEG), 1, (v) => { sh.restAng = v / DEG; }));
    panel.append(numRow('Flipped (deg)', Math.round(sh.endAng * DEG), 1, (v) => { sh.endAng = v / DEG; }));
  } else if (sh.kind === 'drain') {
    panel.append(numRow('x', mm(sh.x), 1, (v) => { sh.x = v / 1000; }));
    panel.append(numRow('y', mm(sh.y), 1, (v) => { sh.y = v / 1000; }));
    panel.append(numRow('Width', mm(sh.w), 1, (v) => { sh.w = v / 1000; }));
    panel.append(numRow('Height', mm(sh.h), 1, (v) => { sh.h = v / 1000; }));
  }
}

/** The kinds of part currently selected, so the Tune tab can show the numbers that govern them.
 *  Returns an empty array when nothing is selected, which means "show the lot". */
function selectedKinds() {
  const out = [];
  for (const id of app.sel) {
    const sh = app.table.shapes.find((x) => x.id === id);
    if (sh && !out.includes(sh.kind)) out.push(sh.kind);
  }
  return out;
}

function tuneRow(t) {
  const row = el(`<div class="row"><label>${t.label}</label><input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${app.cfg[t.key]}"><span class="val">${app.cfg[t.key]}${t.unit ? ' ' + t.unit : ''}</span></div>`);
  const input = row.querySelector('input');
  const out = row.querySelector('.val');
  input.addEventListener('input', () => {
    app.cfg[t.key] = parseFloat(input.value);
    out.textContent = `${app.cfg[t.key]}${t.unit ? ' ' + t.unit : ''}`;
    save();
  });
  return row;
}

// TAP A PART AND TUNE THAT PART. Twenty two sliders in one list is a list you scroll rather than
// read, and the three that matter for the thing you are looking at are somewhere in the middle of
// it. Each TUNABLES row names the shape kinds it governs, so a selection filters the panel down to
// them. Nothing is hidden permanently: Show all is one tap, and the table-wide numbers (tilt, speed
// cap, rolling drag) are always at the bottom because they govern the part too.
function renderTunePanel() {
  const kinds = app.tuneAll ? [] : selectedKinds();
  // Walls, arcs and posts share Bounce off walls and Grip on walls, so a row is rendered under the
  // FIRST group that claims it. A slider that appears twice is two sliders as far as the eye is
  // concerned, and dragging one would leave the other reading the old number.
  const done = new Set();
  const rowsFor = (k) => TUNABLES.filter((t) => t.kinds && t.kinds.includes(k) && app.cfg[t.key] != null && !done.has(t.key));
  const wide = TUNABLES.filter((t) => !t.kinds && app.cfg[t.key] != null);

  if (kinds.length) {
    const names = kinds.map((k) => KIND_NAMES[k] || k);
    const head = el('<div class="row"></div>');
    head.append(el(`<label style="flex:1">${names.join(' + ')}</label>`));
    const all = el('<button>Show all</button>');
    all.onclick = () => { app.tuneAll = true; renderPanel(); };
    head.append(all);
    panel.append(head);
    let any = 0;
    for (const k of kinds) {
      const rows = rowsFor(k);
      if (kinds.length > 1 && rows.length) panel.append(el(`<div class="note">${KIND_NAMES[k] || k}</div>`));
      for (const t of rows) { done.add(t.key); panel.append(tuneRow(t)); any++; }
    }
    if (!any) panel.append(el(`<div class="note">A ${names.join(' or ')} has no numbers of its own. The table-wide ones below still govern it.</div>`));
    panel.append(el('<div class="note">The whole table</div>'));
    for (const t of wide) panel.append(tuneRow(t));
  } else {
    panel.append(el('<div class="note">Tap a part on the table to tune just that part. Drag a slider while a ball is in play. Copy config writes the block for config.js.</div>'));
    for (const t of wide) panel.append(tuneRow(t));
    for (const k of Object.keys(KIND_NAMES)) {
      const rows = rowsFor(k);
      if (!rows.length) continue;
      panel.append(el(`<div class="note">${KIND_NAMES[k]}</div>`));
      for (const t of rows) { done.add(t.key); panel.append(tuneRow(t)); }
    }
  }

  const r = el('<div class="row"></div>');
  const copy = el('<button>Copy config</button>');
  copy.onclick = () => {
    const lines = Object.keys(app.cfg).map((k) => `  ${k}: ${app.cfg[k]},`).join('\n');
    const text = `export const CONFIG = {\n${lines}\n};`;
    navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy config'; }, 1200); },
      () => { copy.textContent = 'Copy failed'; });
  };
  const back = el('<button class="danger">Back to defaults</button>');
  back.onclick = () => { app.cfg = cloneConfig(); save(); renderPanel(); };
  r.append(copy, back);
  panel.append(r);
  panel.append(el(`<div class="note">Gravity down the playfield is ${gravity(app.cfg).toFixed(3)} m/s2, which is g times sin(tilt).</div>`));
}

function renderCheckPanel() {
  panel.append(el('<div class="note">Three questions, answered on the table as it stands right now. Results are drawn ON the table as red marks, not summarised as a percentage.</div>'));
  const r = el('<div class="row"></div>');
  const bTraps = el('<button class="primary">Find traps</button>');
  const bTunnel = el('<button>Tunnel test</button>');
  const bGaps = el('<button>Gap rule</button>');
  const bMask = el('<button>Show reachable</button>');
  const bClear = el('<button>Clear marks</button>');
  r.append(bTraps, bTunnel, bGaps, bMask, bClear);
  panel.append(r);
  const out = el('<pre id="report"></pre>');
  panel.append(out);

  const fall = drainTime(app.table, app.cfg);
  const err = fall.seconds == null ? 1 : Math.abs(fall.seconds - fall.analytic) / fall.analytic;
  out.textContent = `gravity    ${gravity(app.cfg).toFixed(3)} m/s2\n`
    + `free fall  ${fall.seconds == null ? 'never drained' : fall.seconds.toFixed(3) + ' s'} against ${fall.analytic.toFixed(3)} s analytic (${(err * 100).toFixed(1)}% off)\n`
    + `ball life  ${fall.alive == null ? 'over 60 s' : fall.alive.toFixed(1) + ' s'} released into the top left corner`;

  bClear.onclick = () => { app.marks = []; app.mask = null; };
  bMask.onclick = () => {
    const play = playable(app.table, app.cfg);
    app.mask = { step: play.step, cells: play.cells() };
  };
  bGaps.onclick = () => {
    const flags = checkGaps(app.table, app.cfg);
    const real = flags.filter((f) => f.kind === 'gap');
    app.marks = real.map((f) => ({ at: f.at, kind: 'gap' }));
    out.textContent = real.length
      ? `${real.length} gap(s) near one ball wide, which is where a ball wedges:\n`
        + real.map((f) => `  ${f.a} to ${f.b}: ${(f.gap * 1000).toFixed(1)} mm (ball is ${(app.cfg.BALL_R * 2000).toFixed(1)} mm)`).join('\n')
      : `No ambiguous gaps. ${flags.length} deliberate overlap(s), which is how you SHUT a gap.`;
  };
  bTunnel.onclick = () => {
    out.textContent = 'firing...';
    setTimeout(() => {
      const r2 = tunnelProbe(app.table, app.cfg, { angles: 16 });
      app.marks = r2.fails.map((f) => ({ at: f.end, kind: 'tunnel' }));
      out.textContent = r2.fails.length
        ? `${r2.fails.length} of ${r2.shots} shots at ${app.cfg.MAX_SPEED} m/s went through something.`
        : `${r2.shots} shots at ${app.cfg.MAX_SPEED} m/s from every angle. None got through.`;
    }, 30);
  };
  bTraps.onclick = () => {
    out.textContent = 'dropping balls...';
    setTimeout(() => {
      const r2 = restSweep(app.table, app.cfg, { step: 0.016, seconds: 5 });
      app.marks = r2.stuck.map((s) => ({ at: s.at, kind: 'trap' }));
      const spots = [];
      for (const s of r2.stuck) {
        if (!spots.some((q) => Math.hypot(q.at.x - s.at.x, q.at.y - s.at.y) < 0.008)) spots.push(s);
      }
      out.textContent = r2.stuck.length
        ? `${r2.stuck.length} of ${r2.drops} drops never reached the drain, in ${spots.length} place(s):\n`
          + spots.map((s) => `  (${(s.at.x * 1000).toFixed(0)}, ${(s.at.y * 1000).toFixed(0)}) mm on ${s.on || 'nothing'}`).join('\n')
        : `${r2.drops} drops, every one reached the drain. No traps.`;
    }, 30);
  };
}

// ------------------------------------------------------------------ modes

function setMode(m) {
  app.mode = m;
  for (const k of ['play', 'edit', 'tune', 'check']) {
    document.getElementById(`tab-${k}`).setAttribute('aria-pressed', String(k === m));
  }
  zones.classList.toggle('on', false);
  launchBtn.style.display = m === 'play' ? '' : 'none';
  if (m === 'play') { ensureWorld(); app.running = true; }
  if (m === 'tune') app.tuneAll = false;          // arriving on Tune asks about whatever is selected
  app.marks = [];
  renderPanel();
}
for (const k of ['play', 'edit', 'tune', 'check']) {
  document.getElementById(`tab-${k}`).onclick = () => setMode(k);
}
launchBtn.onclick = newBall;

// ------------------------------------------------------------------ loop

/** The loop is scheduled in a `finally`, so nothing that happens inside it can stop the app.
 *
 *  This is the bug Matt filmed. A NaN reached `createRadialGradient`, which THROWS rather than
 *  drawing nothing, the exception came out of `frame()`, and `requestAnimationFrame` was never
 *  called again. The page then sat on its last painted frame for ever: a ball resting in mid air at
 *  0.00 m/s, touching nothing, with the buttons still working because they are event handlers. It
 *  read as a physics bug and was not one. Whatever else is wrong, the app must keep running and say
 *  what happened. */
function frame(t) {
  try {
    frameBody(t);
  } catch (e) {
    app.errors++;
    app.lastError = String((e && e.message) || e);
  } finally {
    requestAnimationFrame(frame);
  }
}

function frameBody(t) {
  const dt = app.lastT ? Math.min(0.05, (t - app.lastT) / 1000) : 0;
  app.lastT = t;
  if (app.mode === 'play' && app.running && dt > 0) stepPlay(dt);

  const angles = {};
  if (app.world) for (const f of app.world.flippers) angles[f.def.id] = f.ang;
  if (app.world) {
    for (const ev of app.world.events) if (ev.type === 'bounce') app.hot[ev.id] = performance.now();
    app.world.events.length = 0;
  }
  const hot = {};
  for (const k of Object.keys(app.hot)) {
    if (performance.now() - app.hot[k] < 110) hot[k] = true; else delete app.hot[k];
  }

  draw(ctx, app.table, app.view, {
    balls: app.world ? app.world.balls : [],
    ballR: app.cfg.BALL_R,
    trail: app.mode === 'play' ? app.trail : null,
    flipperAngles: angles,
    grid: app.mode === 'edit' && app.snap ? app.grid * 4 : 0,
    marks: app.marks,
    mask: app.mask,
    hot,
  });

  if (app.mode === 'edit' || app.mode === 'tune') drawSelection();
  if (app.mode === 'edit') drawLoupe();

  const b = app.world && app.world.balls.find((x) => x.alive);
  hud.textContent = app.mode === 'play'
    ? `${b ? (Math.hypot(b.v.x, b.v.y)).toFixed(2) + ' m/s' : 'drained'}`
      + `${app.world && app.world.jams ? '   jams ' + app.world.jams : ''}`
      + `${app.world && app.world.escapes ? '   LEFT THE TABLE ' + app.world.escapes : ''}`
    : `${app.table.shapes.length} parts   ${app.sel.size} selected   grid ${(app.grid * 1000).toFixed(0)} mm`
      + `${app.view && Math.abs(app.view.zoom - 1) > 0.01 ? '   zoom ' + Math.round(app.view.zoom * 100) + '%' : ''}`;
  hud.textContent += `\n${app.table.name}: ${tableKinds()}`;
  if (app.errors) hud.textContent += `\n${app.errors} draw error(s): ${app.lastError}`;
  if (app.repaired) hud.textContent += `\nrepaired ${app.repaired} broken part(s) on load`;
  if (app.staleTable) hud.textContent += '\nthis is YOUR edited table. The shipped one has new parts: Edit then Reset table';
}

// THE MAGNIFIER. Matt: "I want to extend or shorten it, I need an enlarge option... a smaller
// enlarged window comes up or something."
//
// A finger is about 9 mm across and covers the exact thing it is placing, which is why dragging an
// end handle on a phone is guesswork: you find out where you put it when you lift off. So while a
// handle or a part is being dragged, a circle in the far corner shows that spot at four times the
// view's zoom, drawn with the real renderer so it is the same picture and not a sketch of one.
//
// It follows the HANDLE, not the finger, and in a fine drag those are different places on purpose.
// It sits in whichever top corner the finger is not in, because a magnifier under the hand is the
// original problem with an extra step.
function drawLoupe() {
  if (!drag.mode || drag.mode === 'lasso' || !drag.at || !drag.virt) return;
  const v = app.view;
  const target = drag.mode === 'handle' ? handleAt() : drag.virt;
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;

  const w = canvas.getBoundingClientRect().width;
  const cx = drag.at.x < w / 2 ? w - LOUPE_R - 14 : LOUPE_R + 14;
  const cy = LOUPE_R + 14;

  const z2 = v.zoom * LOUPE_MAG;
  const lv = {
    s: v.s,
    zoom: z2,
    px: v.px,
    py: v.py,
    ox: cx - (target.x * v.s + v.px) * z2,
    oy: cy - (target.y * v.s + v.py) * z2,
  };

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0a1220';
  ctx.fillRect(cx - LOUPE_R, cy - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2);
  draw(ctx, app.table, lv, { balls: [], ballR: app.cfg.BALL_R, grid: app.snap ? app.grid * 4 : 0 });
  drawSelection(lv);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_R, 0, Math.PI * 2);
  ctx.strokeStyle = drag.fine ? '#ffce3a' : 'rgba(180,220,255,0.75)';
  ctx.lineWidth = drag.fine ? 3 : 2;
  ctx.stroke();
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = drag.fine ? '#ffce3a' : 'rgba(200,225,255,0.9)';
  ctx.fillText(drag.fine ? 'FINE' : `${LOUPE_MAG}x`, cx, cy + LOUPE_R - 6);
  ctx.restore();
}

/** Where the handle being dragged actually IS now, read back off the shape rather than assumed from
 *  the pointer: an arc's radius handle and a flipper's tip are derived, not set. */
function handleAt() {
  const sh = app.table.shapes.find((x) => x.id === drag.id);
  if (!sh) return null;
  for (const h of handlesFor(sh)) if (h.key === drag.key) return h.at;
  return null;
}

function drawSelection(view) {
  const vw = view || app.view;
  ctx.save();
  for (const id of app.sel) {
    const sh = app.table.shapes.find((x) => x.id === id);
    if (!sh) continue;
    ctx.strokeStyle = '#ffce3a';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    const c = toScreen(vw, centreOf(sh));
    ctx.beginPath();
    ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const h of handlesFor(sh)) {
      const s = toScreen(vw, h.at);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffce3a';
      ctx.fill();
      ctx.strokeStyle = '#21180a';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  if (drag.mode === 'lasso' && drag.box) {
    const a = toScreen(vw, { x: drag.box.x0, y: drag.box.y0 });
    const b = toScreen(vw, { x: drag.box.x1, y: drag.box.y1 });
    ctx.strokeStyle = '#7fd8ff';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ which build is this?
//
// Matt, 2026-09-11: "It's perfect when I open it within the Claude app. But when I open it in the
// chrome app it's the old one with the holes." The Claude app has no service worker; Chrome had one
// and served this tool's code from its cache. sw.js now keeps pinball2 network-first, but a worker
// ALREADY INSTALLED on a phone is the old one until it updates, so the tool says out loud which
// build it is running rather than leaving "is this fixed yet" to be guessed from how it plays.

async function showBuild() {
  const el = document.getElementById('build');
  if (!el) return;
  let deployed = null;
  try {
    const r = await fetch('../../version.json', { cache: 'no-store' });
    deployed = (await r.json()).cache;
  } catch (e) { /* offline: nothing to compare against, so say nothing */ }

  let running = null;
  const sw = navigator.serviceWorker;
  if (sw && sw.controller) {
    running = await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => resolve(ev.data && ev.data.version);
      setTimeout(() => resolve(null), 1500);
      try { sw.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch (e) { resolve(null); }
    });
  }

  if (!deployed) { el.textContent = 'offline'; return; }
  const short = (v) => String(v).replace('game-hub-', '');
  if (!running || running === deployed) {
    el.textContent = short(deployed);
    el.classList.remove('stale');
    el.onclick = () => location.reload();
    return;
  }
  el.textContent = `${short(running)} \u2192 ${short(deployed)}`;
  el.classList.add('stale');
  el.title = 'This device is running an older build. Tap to update and reload.';
  el.onclick = async () => {
    el.textContent = 'updating';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch (e) { /* fall through to the reload, which is the useful half anyway */ }
    setTimeout(() => location.reload(true), 1200);
  };
}

if (navigator.serviceWorker) {
  navigator.serviceWorker.getRegistration().then((reg) => { if (reg) reg.update(); }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => showBuild());
}

// ------------------------------------------------------------------ go

load();
resize();
newBall();
setMode('play');
requestAnimationFrame(frame);
showBuild();

window.__pb2 = app;   // the browser probes drive the real tool through this, never a copy of it
