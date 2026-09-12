// The editor. It loads the MACHINE'S OWN engine, so Play is the real game and not a preview of it.
// Nothing here writes a game file: you export, and a session applies the export. That keeps a
// gameplay fix from ever landing on top of unsaved editing work.

// These are plain static imports and they stay that way. The build version is stamped onto every
// one of them by the IMPORT MAP that index.html installs before this file is fetched. See the
// comment there: it is the fix for a build whose version chip read v782 while the table on screen
// was hours old.
import { CONFIG, TUNABLES, KIND_NAMES, cloneConfig, gravity } from '../machines/testbox/config.js';
import { World } from '../machines/testbox/physics.js';
import { makeTable, toJSON, fromJSON, newId, buildRamp, rampPoints, RAMP_DEFAULTS } from '../machines/testbox/table.js';
import { makeBoardwalk } from '../machines/testbox/tables/boardwalk.js';
import { draw, fitView, toTable, toScreen } from '../machines/testbox/render.js';
import { playable, distToShape, checkGaps, tunnelProbeGen, restSweepGen, drainTime, rampProbe } from '../probes/checks.js';

const SAVE = 'pinball2.editor.v1';
const DEG = 180 / Math.PI;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
// The dock has two halves. On a phone they stack in one scroller; on a wide screen they become the
// left and right docks either side of the table. The renderers below just append to `panel`, which
// is pointed at whichever half they are filling, so the same code builds both shapes.
const dockA = document.getElementById('dockA');
const dockB = document.getElementById('dockB');
let panel = dockA;
const objbar = document.getElementById('objbar');
// THE STATUS BAR, which replaced a box that used to be drawn on top of the playfield. It covered
// the top rail and two lanes of every table in every mode, on the one screen whose entire job is
// letting you look at the table. Facts belong in a bar; the canvas belongs to the work.
const statusBar = document.getElementById('status');
// The toast is the ONE thing still allowed over the table, and only for a live instruction about
// what the next tap will do ("tap the table to place this"). An instruction that is not where you
// are looking is an instruction nobody follows. Never used for facts.
const toast = document.getElementById('toast');
const zones = document.getElementById('touchzones');
// The tool rail sits in the dead gutter beside the table: a 0.515 x 1.067 m playfield in a portrait
// canvas is fitted by HEIGHT and leaves ~59% of the width as black margin, so chrome placed there
// costs the table nothing. It is a real grid column rather than something floating over the canvas,
// so no part of the table can ever end up underneath a button.
const railTools = document.getElementById('railtools');
let launchBtn = null;                    // built by the Play rail; see renderPlayRail()

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
  // An armed prefab, waiting for a tap on the table: `{ name, shapes }`. It carries its own WORKING
  // COPY of the shapes rather than a name to look up, because the turn and scale tools act on it
  // before it lands and a stored prefab must not change when you turn the one you are about to drop.
  placing: null,
  // Laying a ramp path: `{ pts: [] }`. A ramp is the one part that cannot be made by dropping a
  // default in the middle and dragging its ends, because its shape IS a path - so the Ramp button
  // starts a mode instead of adding a shape.
  drawing: null,
  tableName: null,        // the LIBRARY save being edited, or null for a table this build ships
  builtin: null,          // which shipped table, when tableName is null: null means Default
  migrated: null,
  tuneAll: false,
  // The id of the in-flight chunked check, so leaving the Check tab can stop it rather than
  // leaving a sweep running under whatever you do next.
  checkRun: null,          // Tune shows the selected part's numbers unless Show all was tapped
  xstep: 2,                // index into XFORM_STEPS: how far one tap of the turn/scale row goes
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

// ------------------------------------------------------------------ the table library
//
// THREE BUILDS IN A ROW PRODUCED THE SAME SYMPTOM - Matt opening the tool and seeing an old table -
// from three different causes, and the last of them was this layer trying to be clever. It was ONE
// autosave slot plus an `edited` flag, and on load it GUESSED whether a new build's table should
// replace what was stored: keep an edited save, drop an unedited one, and print a grey warning line
// when it guessed "keep". That worked as designed and the design was the problem. It is one slot,
// it is a guess, and seeing a new build required noticing a line of grey text and then finding
// "Reset table".
//
// There is no guess here any more, because the two things are separate objects:
//
//   DEFAULT is not stored at all. It is whatever `machines/testbox/table.js` ships in the build you
//   are running, so it is current BY CONSTRUCTION. Editing it is a working copy and is not written
//   anywhere: leave, or take a new build, and those edits are gone, exactly as if you had never
//   saved. Default means "what is actually in this build", full stop.
//
//   THE LIBRARY is every table you have explicitly named and saved, under its own key. A new build
//   never touches it. Ever. Editing a NAMED table does autosave into that name, because that is
//   what picking it up again means.
//
// `edited`, the fingerprint, the grey line and the compare-against-shipped logic are all gone.
// None of them is needed once Default cannot be silently overwritten and every save is explicit.

const LIB = 'pinball2.editor.tables';       // { name: { table, cfg, savedAt } }
const CURRENT = 'pinball2.editor.current';  // the name last selected, or absent for Default
const MIGRATED = 'pinball2.editor.migrated';

// TABLES THIS BUILD SHIPS. Default is one of them; BOARDWALK is the second, and there will be more.
// They behave EXACTLY like Default and for the same reason: never stored, so current by
// construction, and editing one is a working copy written nowhere until Save as gives it a name.
//
// They are NOT seeded into the library on first run, which is the obvious alternative and is the
// stale-table bug rebuilt from scratch: a device that seeded v794's BOARDWALK would still be
// showing you v794's BOARDWALK in December.
//
// Selector values are prefixed so a built-in and a save can never collide. A person is free to have
// their own table called BOARDWALK; it is a different entry and neither shadows the other.
const BUILTIN = 'builtin:';
const BUILTINS = { BOARDWALK: makeBoardwalk };

const builtinOf = (v) => (v && v.startsWith(BUILTIN) && BUILTINS[v.slice(BUILTIN.length)] ? v.slice(BUILTIN.length) : null);

function readLib() {
  try {
    const d = JSON.parse(localStorage.getItem(LIB) || '{}');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch (e) { return {}; }
}

function writeLib(d) {
  try { localStorage.setItem(LIB, JSON.stringify(d)); return true; } catch (e) { return false; }
}

function libNames() {
  return Object.keys(readLib()).sort((x, y) => x.localeCompare(y));
}

/** Save the working table under a name. Named saves are the only thing ever written. */
function saveAs(name) {
  if (!name) return false;
  if (!tableIsFinite(app.table)) return false;    // never store a table that would freeze the app
  const d = readLib();
  d[name] = { table: JSON.parse(toJSON(app.table)), cfg: app.cfg, savedAt: Date.now() };
  if (!writeLib(d)) return false;
  app.tableName = name;
  try { localStorage.setItem(CURRENT, name); } catch (e) {}
  return true;
}

/** Autosave, which now means one thing only: keep a NAMED table up to date. On Default it is a
 *  deliberate no-op, and that is the whole fix. */
function save() {
  if (!app.tableName) return;
  saveAs(app.tableName);
}

function deleteTable(name) {
  const d = readLib();
  if (!(name in d)) return false;
  delete d[name];
  writeLib(d);
  if (app.tableName === name) selectTable(null);
  else renderPanel();
  return true;
}

/** Load a table by name, or Default when `name` is null. This is the ONLY way the working table is
 *  replaced, and it is always something a person asked for. */
function selectTable(name) {
  const d = readLib();
  const bi = builtinOf(name);
  if (bi) {
    app.table = BUILTINS[bi]();                   // a table this build ships, never stored
    app.cfg = cloneConfig();
    app.tableName = null;                         // so `save()` writes nothing: this is a copy
    app.builtin = bi;
  } else if (name && d[name] && d[name].table) {
    const t = fromJSON(d[name].table);
    app.repaired = repairTable(t);                // an already poisoned save heals on this load
    app.table = t;
    app.cfg = cleanCfg(d[name].cfg);
    app.tableName = name;
    app.builtin = null;
  } else {
    app.table = makeTable();                      // the build's own table, never stored
    app.cfg = cloneConfig();
    app.tableName = null;
    app.builtin = null;
    name = null;
  }
  try {
    // A built-in is remembered by its prefixed value, so reopening the tool puts you back on the
    // table you were looking at. It still reloads from CODE, so it is still this build's copy.
    const keep = bi ? BUILTIN + bi : name;
    if (keep) localStorage.setItem(CURRENT, keep); else localStorage.removeItem(CURRENT);
  } catch (e) {}
  app.sel.clear();
  app.undo.length = 0;
  app.redo.length = 0;
  app.marks = [];
  app.mask = null;
  app.world = null;
  resize();
  renderPanel();
}

function cleanCfg(raw) {
  const c = cloneConfig(raw || {});
  for (const k of Object.keys(c)) if (!Number.isFinite(c[k]) && typeof CONFIG[k] === 'number') c[k] = CONFIG[k];
  return c;
}

/** The one-slot autosave every device already has becomes a named save called "My table", once.
 *  The old key is left exactly where it is rather than deleted: it costs nothing and nobody has to
 *  trust this migration got it right. */
function migrateLegacy() {
  try {
    if (localStorage.getItem(MIGRATED)) return null;
    localStorage.setItem(MIGRATED, '1');
    const raw = localStorage.getItem(SAVE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.table || !Array.isArray(d.table.shapes) || !d.table.shapes.length) return null;
    const lib = readLib();
    let name = 'My table';
    for (let i = 2; name in lib; i++) name = `My table ${i}`;
    lib[name] = { table: d.table, cfg: d.cfg || {}, savedAt: Date.now() };
    writeLib(lib);
    return name;
  } catch (e) { return null; }
}

function load() {
  app.migrated = migrateLegacy();
  // ?fresh means Default, which is now simply the ordinary starting point rather than an escape
  // hatch. It is kept because it has been given out over chat.
  if (/[?&]fresh\b/.test(location.search)) { selectTable(null); return; }
  let want = null;
  try { want = localStorage.getItem(CURRENT); } catch (e) {}
  selectTable(builtinOf(want) || (want && readLib()[want]) ? want : null);
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

// THE PLUNGER. `launch` alone is enough for a table whose launch point sits in open play - drop a
// ball there and gravity does the rest, which is what TEST BOX has always done.
//
// It is NOT enough for a table with a SHOOTER LANE. Matt filmed BOARDWALK: tap Launch, the ball
// trickles down the right lane at half a metre a second, drains, over and over, never once reaching
// the playfield. Nothing was broken - there was simply no plunger, and a ball dropped at the top of
// a lane that runs to the drain has exactly one place to go.
//
// So a table may carry `launchV`, a velocity. Absent means the old drop, so no existing table
// changes. A real plunger with a pull-back meter is its own object and is still on the list; this
// is the one number that makes a shooter lane work in the meantime.
const DROP_V = { x: 0, y: 0.1 };        // no plunger: just enough to get a ball off the mark

function newBall() {
  app.world = new World(app.table, app.cfg);
  const v = app.table.launchV || DROP_V;
  app.world.addBall(app.table.launch, { x: v.x, y: v.y });
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
    // A ramp laid with the Ramp tool is handled by its CONTROL POINTS: dragging one reshapes the
    // curve. Move the whole ramp by dragging its body instead. A ramp with no stored control points
    // (anything built before the tool existed) keeps the old pair of end handles, which move the
    // whole thing - it has no control points to offer and inventing some would be a guess.
    if (sh.ctrl && sh.ctrl.length >= 2) {
      sh.ctrl.forEach((c, i) => out.push({ key: 'c' + i, at: c }));
    } else {
      out.push({ key: 'm0', at: sh.pts[0] });
      out.push({ key: 'm1', at: sh.pts[sh.pts.length - 1] });
    }
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
  // A ramp's CONTROL POINTS move with its path or the two fall out of step, and the next drag of a
  // control handle would snap the whole ramp back to where the control points still thought it was.
  else if (sh.kind === 'ribbon') {
    for (const q of sh.pts) { q.x += dx; q.y += dy; }
    if (sh.ctrl) for (const q of sh.ctrl) { q.x += dx; q.y += dy; }
  }
  else if (sh.kind === 'drain') { sh.x += dx; sh.y += dy; }
}

// ------------------------------------------------------------------ turn and scale
//
// Handles reshape ONE part. This reshapes a SELECTION, which is the thing the prefab library made
// necessary: a bumper nest saved flat is wanted at an angle, and rebuilding it at that angle by
// dragging five handles is exactly the typing the library exists to avoid.
//
// BOTH TURN AND SCALE ABOUT THE SELECTION'S OWN CENTROID, the same anchor a prefab is stored
// against. That is not an arbitrary pick: a prefab lands centred on the tap, so turning it about
// its centroid keeps it where the tap put it, and turning about anything else would walk it away
// from the finger every time.
//
// ANGLES ARE NOT SNAPPED and neither are the positions a turn produces. Snapping a turned part to
// the 5 mm grid moves its two ends by different amounts, which does not rotate a rail, it BENDS it.

const XFORM_STEPS = [{ deg: 1, pct: 1 }, { deg: 5, pct: 5 }, { deg: 15, pct: 10 }, { deg: 45, pct: 25 }];
const MIN_DIM = 0.0005;                 // 0.5 mm - a part smaller than this is a part you cannot find

function anchorOf(shapes) {
  let x = 0;
  let y = 0;
  for (const sh of shapes) { const c = centreOf(sh); x += c.x; y += c.y; }
  return { x: x / shapes.length, y: y / shapes.length };
}

// The stored angles (`a0`/`a1` on an arc, `restAng`/`endAng` on a flipper) are atan2 in the SAME
// frame as the coordinates, where y runs down the table. So a rotation that adds `ang` to a point's
// atan2 adds exactly `ang` to those fields too, and one sign convention covers both.
function rotateShape(sh, a, ang) {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const rot = (q) => {
    const dx = q.x - a.x;
    const dy = q.y - a.y;
    q.x = a.x + dx * cos - dy * sin;
    q.y = a.y + dx * sin + dy * cos;
  };
  if (sh.kind === 'seg' || sh.kind === 'sling') { rot(sh.a); rot(sh.b); }
  else if (sh.kind === 'circle' || sh.kind === 'bumper') rot(sh.c);
  else if (sh.kind === 'arc') { rot(sh.c); sh.a0 += ang; sh.a1 += ang; }
  else if (sh.kind === 'flipper') { rot(sh.pivot); sh.restAng += ang; sh.endAng += ang; }
  else if (sh.kind === 'ribbon') { for (const q of sh.pts) rot(q); if (sh.ctrl) for (const q of sh.ctrl) rot(q); }
  else if (sh.kind === 'drain') {
    // A drain is an axis-aligned rectangle and the data model has nowhere to put an angle, so its
    // CENTRE turns with the group and the box stays square to the table. Inventing a rotated drain
    // would mean a sixth kind for physics.js, checks.js and every probe to learn.
    const c = { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 };
    rot(c);
    sh.x = c.x - sh.w / 2;
    sh.y = c.y - sh.h / 2;
  }
}

// UNIFORM: distances from the anchor AND every thickness scale by the same k. Scaling positions
// without thicknesses looks right for one step and is wrong by the third, because the gaps between
// the parts move and the parts themselves do not, so a cluster checked clear at 100% is a wedge at
// 60%. A ramp's `z` is height off the playfield, a different axis, and is left alone.
function scaleShape(sh, a, k) {
  const sc = (q) => { q.x = a.x + (q.x - a.x) * k; q.y = a.y + (q.y - a.y) * k; };
  if (sh.kind === 'seg' || sh.kind === 'sling') { sc(sh.a); sc(sh.b); sh.r *= k; }
  else if (sh.kind === 'circle' || sh.kind === 'bumper') { sc(sh.c); sh.r *= k; }
  else if (sh.kind === 'arc') { sc(sh.c); sh.radius *= k; sh.r *= k; }
  else if (sh.kind === 'flipper') { sc(sh.pivot); sh.len *= k; sh.r0 *= k; sh.r1 *= k; }
  else if (sh.kind === 'ribbon') { for (const q of sh.pts) sc(q); if (sh.ctrl) for (const q of sh.ctrl) sc(q); sh.w *= k; sh.r *= k; }
  else if (sh.kind === 'drain') {
    const c = { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 };
    sc(c);
    sh.w *= k;
    sh.h *= k;
    sh.x = c.x - sh.w / 2;
    sh.y = c.y - sh.h / 2;
  }
}

/** The smallest thickness or span in a selection, so a scale that would shrink a part to nothing is
 *  refused whole rather than clamped per part (clamping one part breaks the group's proportions). */
function minDimOf(shapes) {
  let m = Infinity;
  for (const sh of shapes) {
    for (const v of [sh.r, sh.radius, sh.len, sh.r0, sh.r1, sh.w, sh.h]) {
      if (typeof v === 'number' && v > 0) m = Math.min(m, v);
    }
  }
  return m;
}

/** What a turn or scale acts on: an armed prefab if there is one, otherwise the selection. An armed
 *  prefab is turned BEFORE it is dropped, which is the case the brief asked for. */
function xformTarget() {
  if (app.placing) return app.placing.shapes;
  return app.table.shapes.filter((sh) => app.sel.has(sh.id));
}

function applyXform(fn) {
  const target = xformTarget();
  if (!target.length) return false;
  // Transform a COPY and check it before committing anything. A NaN reaches the renderer as a frame
  // that throws, and this app schedules its next frame in a `finally` precisely because that once
  // froze it dead. Half a transformed selection would be worse than none, too.
  const next = JSON.parse(JSON.stringify(target));
  const a = anchorOf(next);
  for (const sh of next) fn(sh, a);
  if (!tableIsFinite(next)) return false;
  // An armed prefab is not on the table yet, so there is nothing for undo to restore and nothing to
  // autosave: it is a working copy, discarded on Escape.
  const live = !app.placing;
  if (live) pushUndo();
  for (let i = 0; i < target.length; i++) Object.assign(target[i], next[i]);
  if (live) afterEdit();
  renderPanel();
  return true;
}

function turnSel(deg) {
  return applyXform((sh, a) => rotateShape(sh, a, (deg * Math.PI) / 180));
}

function scaleSel(k) {
  const target = xformTarget();
  if (!target.length) return false;
  if (minDimOf(target) * k < MIN_DIM) return false;
  return applyXform((sh, a) => scaleShape(sh, a, k));
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

/** Put a table point in the middle of the canvas. The reverse direction of tapping the table: you
 *  pick a part from a list and the view goes to it. */
function panTo(p, minZoom) {
  const v = app.view;
  if (!v) return;
  const r = canvas.getBoundingClientRect();
  if (minZoom && v.zoom < minZoom) v.zoom = minZoom;
  v.px = (r.width / 2 - v.ox) / v.zoom - p.x * v.s;
  v.py = (r.height / 2 - v.oy) / v.zoom - p.y * v.s;
  syncZoom();
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

  // LAYING A RAMP PATH. Like an armed prefab, this goes before handles, select and lasso: while a
  // path is open, a tap on the table means one thing.
  if (app.mode === 'edit' && app.drawing) {
    const q = snap(p);
    app.drawing.pts.push({ x: q.x, y: q.y });
    drag.mode = null;
    renderPanel();
    return;
  }

  // A PREFAB IS ARMED AND WAITING FOR THIS TAP. It goes before the handle, select and lasso logic
  // on purpose: while placing, the tap means one thing and one thing only.
  if (app.mode === 'edit' && app.placing) {
    const armed = app.placing;
    app.placing = null;
    drag.mode = null;
    placePrefab(armed, snap(p));
    return;
  }

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
      if (drag.key[0] === 'c' && sh.ctrl) {
        const i = parseInt(drag.key.slice(1), 10);
        if (sh.ctrl[i]) { sh.ctrl[i].x = q.x; sh.ctrl[i].y = q.y; rebuildRamp(sh); }
      } else {
        const anchor = drag.key === 'm0' ? sh.pts[0] : sh.pts[sh.pts.length - 1];
        const dx2 = q.x - anchor.x;
        const dy2 = q.y - anchor.y;
        for (const pt of sh.pts) { pt.x += dx2; pt.y += dy2; }
        if (sh.ctrl) for (const c of sh.ctrl) { c.x += dx2; c.y += dy2; }
      }
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

// A long press on a canvas also raises the OS context menu ("Copy image", "Save image"), and a
// fine drag begins with a long press by definition. CSS alone does not stop this one.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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
  // An armed prefab is a mode, and every mode needs a way out that is not "find the button again".
  if (e.key === 'Escape' && app.drawing) { cancelRamp(); return; }
  if (e.key === 'Enter' && app.drawing) { finishRamp(); return; }
  if (e.key === 'Escape' && app.placing) { app.placing = null; renderPanel(); return; }
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
  // A RAMP IS A PATH, so the button starts a mode rather than dropping a default. There is no
  // sensible default ramp: one in the middle of the table pointing nowhere is a shape you would
  // delete rather than edit, and its ends have to land where a ball can reach them.
  if (kind === 'ribbon') { startRamp(); return; }
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

// ------------------------------------------------------------------ the ramp tool
//
// Every other part is two or three numbers you can drag. A ramp is a PATH, and three rules have to
// hold along it that freehand dragging breaks instantly: both ends at zero height, no kink over 20
// degrees, and no level run (a ball that stops on one stops for ever). So you lay CONTROL POINTS and
// the curve, the spacing and the height profile are generated - by `buildRamp` in `table.js`, the
// same function the shipped table calls, never a copy of it here.
//
// The control points are STORED on the shape, which is what makes a ramp re-editable. Re-fitting
// them out of the hundred-odd generated points would be guesswork, and a ramp you cannot reshape is
// a ramp you delete and lay again.

const RAMP_MIN_PTS = 3;      // two points is a straight line, which is a wall, not a ramp

function startRamp() {
  app.placing = null;
  app.drawing = { pts: [] };
  app.sel.clear();
  renderPanel();
}

function cancelRamp() {
  app.drawing = null;
  renderPanel();
}

function finishRamp() {
  const d = app.drawing;
  if (!d || d.pts.length < RAMP_MIN_PTS) return false;
  const sh = buildRamp(newId('r'), d.pts);
  if (!sh.pts.length || !tableIsFinite(sh)) { cancelRamp(); return false; }
  pushUndo();
  app.table.shapes.push(sh);
  app.drawing = null;
  app.sel = new Set([sh.id]);
  afterEdit();
  return true;
}

/** Rebuild a ramp's path from its control points, keeping whatever width and height it already has.
 *  Called after a control handle moves and after the width or height fields change, so the geometry
 *  the ball hits is always the generator's output and never something edited by hand. */
function rebuildRamp(sh) {
  if (!sh.ctrl || sh.ctrl.length < RAMP_MIN_PTS) return;
  const zmax = Math.max(...sh.pts.map((q) => q.z || 0), 0) || RAMP_DEFAULTS.zmax;
  const pts = rampPoints(sh.ctrl, { zmax, w: sh.w, r: sh.r });
  if (pts.length >= 2) sh.pts = pts;
}

// ------------------------------------------------------------------ the prefab library
//
// A pop bumper nest is five parts placed against each other, and a lower third is eight. Building
// one is fiddly and building the SAME one twice is worse, so a selection can be saved under a name
// and dropped anywhere.
//
// Stored RELATIVE to an anchor, which is the centroid of the selection's own centres: placing one
// centres it on the tap rather than dropping it by a corner nobody was thinking about. The maths is
// `moveShape`, the same function a drag uses, so a prefab cannot move differently from a drag.
//
// A placed prefab is NOT a group. Each part gets its own fresh id and is selected, editable,
// movable and deletable from the moment it lands: the library is a way of not typing, not a new
// kind of object for the engine to know about.

const PREFABS = 'pinball2.editor.prefabs';   // { name: { shapes, savedAt } } - never per table

function readPrefabs() {
  try {
    const d = JSON.parse(localStorage.getItem(PREFABS) || '{}');
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch (e) { return {}; }
}

function writePrefabs(d) {
  try { localStorage.setItem(PREFABS, JSON.stringify(d)); return true; } catch (e) { return false; }
}

function prefabNames() {
  return Object.keys(readPrefabs()).sort((x, y) => x.localeCompare(y));
}

function savePrefab(name) {
  const picked = app.table.shapes.filter((sh) => app.sel.has(sh.id));
  if (!name || !picked.length) return false;
  let ax = 0;
  let ay = 0;
  for (const sh of picked) { const c = centreOf(sh); ax += c.x; ay += c.y; }
  ax /= picked.length;
  ay /= picked.length;
  const shapes = picked.map((sh) => {
    const c = JSON.parse(JSON.stringify(sh));
    moveShape(c, -ax, -ay);
    return c;
  });
  if (!tableIsFinite(shapes)) return false;   // never store parts that would freeze the app
  const d = readPrefabs();
  d[name] = { shapes, savedAt: Date.now() };
  return writePrefabs(d);
}

function deletePrefab(name) {
  const d = readPrefabs();
  if (!(name in d)) return false;
  delete d[name];
  writePrefabs(d);
  if (app.placing && app.placing.name === name) app.placing = null;
  renderPanel();
  return true;
}

/** Arm a prefab: take a working copy out of storage so the turn and scale tools can act on it
 *  before it lands without touching what is saved. */
function armPrefab(name) {
  const p = readPrefabs()[name];
  if (!p || !Array.isArray(p.shapes) || !p.shapes.length) return false;
  app.placing = { name, shapes: JSON.parse(JSON.stringify(p.shapes)) };
  return true;
}

function placePrefab(armed, at) {
  if (!armed || !Array.isArray(armed.shapes) || !armed.shapes.length) return 0;
  pushUndo();
  const made = [];
  for (const s of armed.shapes) {
    const c = JSON.parse(JSON.stringify(s));
    c.id = newId(String(c.kind || 'x')[0]);
    moveShape(c, at.x, at.y);
    if (!tableIsFinite(c)) continue;
    app.table.shapes.push(c);
    made.push(c.id);
  }
  app.sel = new Set(made);
  afterEdit();
  return made.length;
}

// ------------------------------------------------------------------ panels

/** A table name is typed by a person and then put into HTML. Escape it. */
function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
  dockA.innerHTML = '';
  dockB.innerHTML = '';
  // An armed prefab counts as a selection for this: what you want to reach next is the turn and
  // scale rows in the Inspector, not the palette you armed it from.
  document.getElementById('panel').classList.toggle('sel', app.mode === 'edit' && (app.sel.size > 0 || !!app.placing));
  syncTableSel();
  panel = dockA;
  renderRail();
  syncObjBar();
  syncZoom();
  if (app.mode === 'play') return renderPlayPanel();
  if (app.mode === 'edit') return renderEditPanel();
  if (app.mode === 'tune') return renderTunePanel();
  return renderCheckPanel();
}

// A group a person opened stays open. Every selection change re-renders the dock, so without this
// the Parts list closes itself the instant you use it, which is the one moment it has to stay.
const groupOpen = new Map();

/** A labelled, collapsible group. `open` is the default; a choice already made overrides it; and
 *  `selected` (the group belonging to whatever is selected) always wins, because the whole point of
 *  tapping a part is that its numbers appear. */
function group(title, open, selected) {
  const want = selected || (groupOpen.has(title) ? groupOpen.get(title) : open);
  const d = el(`<details class="grp${selected ? ' sel' : ''}"${want ? ' open' : ''}><summary>${title}</summary><div class="grp-body"></div></details>`);
  d.addEventListener('toggle', () => groupOpen.set(title, d.open));
  panel.append(d);
  return d.querySelector('.grp-body');
}

/** Build into a group's body and put `panel` back afterwards, so a renderer can nest without
 *  having to remember to restore anything. */
function inGroup(title, open, selected, build) {
  const keep = panel;
  panel = group(title, open, selected);
  build();
  panel = keep;
}

// ------------------------------------------------------------------ the persistent bars
//
// Zoom and the object controls used to live inside the Edit panel, which meant undo was unreachable
// the moment you switched to Tune to see what a slider had done, and the only zoom on a phone was a
// pinch you had to know about. Both are chrome now: always present, in every mode.

// THE TABLE SELECTOR, in the top bar, because "which table am I looking at" is a question the tool
// has to answer without being asked. Default is always first and always the current build.
const tableSel = document.getElementById('tablesel');

function syncTableSel() {
  if (!tableSel) return;
  const names = libNames();
  tableSel.innerHTML = '';
  const d = document.createElement('option');
  d.value = '';
  d.textContent = 'Default (this build)';
  tableSel.append(d);
  for (const n of Object.keys(BUILTINS)) {
    const o = document.createElement('option');
    o.value = BUILTIN + n;
    o.textContent = `${n} (this build)`;
    tableSel.append(o);
  }
  for (const n of names) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    tableSel.append(o);
  }
  tableSel.value = app.builtin ? BUILTIN + app.builtin : (app.tableName || '');
}

if (tableSel) {
  tableSel.onchange = () => {
    const name = tableSel.value || null;
    app.migrated = null;                          // the one-time note is answered by switching
    selectTable(name);
  };
}

const zoomVal = document.getElementById('zoomval');

function syncZoom() {
  if (zoomVal && app.view) zoomVal.textContent = `${Math.round(app.view.zoom * 100)}%`;
}

function zoomStep(k) {
  const r = canvas.getBoundingClientRect();
  zoomAbout(r.width / 2, r.height / 2, k);
  syncZoom();
}

document.getElementById('zoom-out').onclick = () => zoomStep(1 / 1.4);
document.getElementById('zoom-in').onclick = () => zoomStep(1.4);
document.getElementById('zoom-fit').onclick = () => { fitAll(); syncZoom(); };

const obUndo = document.getElementById('ob-undo');
const obRedo = document.getElementById('ob-redo');
const obSnap = document.getElementById('ob-snap');
const obDup = document.getElementById('ob-dup');
const obDel = document.getElementById('ob-del');

obUndo.onclick = doUndo;
obRedo.onclick = doRedo;
obDup.onclick = duplicateSel;
obDel.onclick = deleteSel;
obSnap.onclick = () => { app.snap = !app.snap; renderPanel(); };

const obMain = document.getElementById('obmain');
const obDraw = document.getElementById('obdraw');
const obDrawUndo = document.getElementById('ob-draw-undo');
const obDrawDone = document.getElementById('ob-draw-done');
const obDrawCancel = document.getElementById('ob-draw-cancel');

obDrawUndo.onclick = () => { if (app.drawing) { app.drawing.pts.pop(); renderPanel(); } };
obDrawDone.onclick = () => finishRamp();
obDrawCancel.onclick = () => cancelRamp();

const obXform = document.getElementById('obxform');
const obRotL = document.getElementById('ob-rot-l');
const obRotR = document.getElementById('ob-rot-r');
const obStep = document.getElementById('ob-step');
const obSmaller = document.getElementById('ob-smaller');
const obBigger = document.getElementById('ob-bigger');

const xstep = () => XFORM_STEPS[app.xstep] || XFORM_STEPS[2];

// Anticlockwise ON SCREEN is a NEGATIVE angle here, because y runs down the table: adding to atan2
// turns +x toward +y, which is rightward toward the drain, which is clockwise to look at.
obRotL.onclick = () => turnSel(-xstep().deg);
obRotR.onclick = () => turnSel(xstep().deg);
obSmaller.onclick = () => scaleSel(1 / (1 + xstep().pct / 100));
obBigger.onclick = () => scaleSel(1 + xstep().pct / 100);
// ONE chip for both, not two. Coarse and fine is a state of mind, not a per-axis setting, and a
// phone's bar has room for five buttons.
obStep.onclick = () => { app.xstep = (app.xstep + 1) % XFORM_STEPS.length; syncObjBar(); };

/** The object bar reflects what is actually possible right now. Play mode has nothing to undo and
 *  nothing selected, so the whole bar goes quiet rather than offering dead buttons. */
function syncObjBar() {
  const editing = app.mode !== 'play';
  obSnap.textContent = `Snap ${app.snap ? 'on' : 'off'}`;
  obUndo.disabled = !editing || !app.undo.length;
  obRedo.disabled = !editing || !app.redo.length;
  obSnap.disabled = !editing;
  obDup.disabled = !editing || !app.sel.size;
  obDel.disabled = !editing || !app.sel.size;
  // The turn/scale row appears only when there is something to turn, so the bar is one row the rest
  // of the time rather than two with half of them dead. An armed prefab counts: turning it before it
  // lands is the case the prefab library created.
  const s = xstep();
  obStep.textContent = `${s.deg}° · ${s.pct}%`;
  const n = app.drawing ? app.drawing.pts.length : 0;
  const drawing = !!(editing && app.drawing);
  obDraw.hidden = !drawing;
  obDrawUndo.disabled = n === 0;
  obDrawDone.disabled = n < RAMP_MIN_PTS;
  obDrawDone.textContent = n < RAMP_MIN_PTS ? `Done (${n} of ${RAMP_MIN_PTS})` : `Done (${n} points)`;
  // ONE ROW, ALWAYS, AT A FIXED HEIGHT. The bar used to be a COLUMN that grew a second row the
  // moment something was selected or a ramp path was open - which changed the canvas's height
  // mid-edit with no window resize event, the exact class of bug the fixed-height layout exists to
  // prevent. It went unnoticed because the regression test compares modes with nothing selected.
  // Now the contextual controls REPLACE or EXTEND the row inside one scrolling track instead of
  // stacking on top of it, and the canvas cannot move while you work.
  obMain.hidden = drawing;
  // While a path is open the turn and scale controls would act on a selection that is not the
  // thing you are working on, so they stand down until the ramp lands.
  obXform.hidden = !(editing && !drawing && (app.sel.size || app.placing));
  objbar.style.opacity = editing ? '' : '.4';
  objbar.scrollLeft = 0;
}

// ------------------------------------------------------------------ the parts palette
// An icon per kind, drawn from the same vocabulary the renderer uses, so a part is recognised
// rather than read.
const PART_ICONS = {
  seg: '<svg viewBox="0 0 26 18"><line x1="3" y1="14" x2="23" y2="4" stroke="#9fb6d8" stroke-width="4" stroke-linecap="round"/></svg>',
  arc: '<svg viewBox="0 0 26 18"><path d="M3 16 A 13 13 0 0 1 23 16" fill="none" stroke="#9fb6d8" stroke-width="4" stroke-linecap="round"/></svg>',
  circle: '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="5" fill="#9fb6d8"/></svg>',
  bumper: '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="7.5" fill="#2f7fd0"/><circle cx="13" cy="9" r="3" fill="#0b1220"/></svg>',
  sling: '<svg viewBox="0 0 26 18"><line x1="4" y1="15" x2="22" y2="4" stroke="#e0532f" stroke-width="4.5" stroke-linecap="round"/></svg>',
  flipper: '<svg viewBox="0 0 26 18"><path d="M4 6 L21 11 L21 14 L4 11 Z" fill="#ffce3a"/><circle cx="5" cy="8" r="2.4" fill="#5a4408"/></svg>',
  drain: '<svg viewBox="0 0 26 18"><line x1="2" y1="9" x2="24" y2="9" stroke="#ff5a5a" stroke-width="3" stroke-dasharray="4 3" stroke-linecap="round"/></svg>',
  ribbon: '<svg viewBox="0 0 26 18"><path d="M4 16 A 11 11 0 0 1 22 16" fill="none" stroke="#3d6ea8" stroke-width="6" stroke-linecap="round"/><path d="M4 16 A 11 11 0 0 1 22 16" fill="none" stroke="#9fb6d8" stroke-width="1.4"/></svg>',
};

// ------------------------------------------------------------------ the tool rail
//
// THE RAIL IS THE MODE'S TOOLS; THE SHEET IS THE MODE'S DETAILS. A tool is something you reach for
// again and again while looking at the table (a part to add, the transport, zoom), and burying
// those in a scrolling panel under the table is what made this feel like a form rather than an
// editor. Zoom is pinned to the bottom of the rail by CSS in every mode, so the rail is never
// empty and the one control that belongs to all four modes is always in the same place.

const RAIL_ICONS = {
  ball:  '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10.6" cy="6.6" r="1.9" fill="currentColor"/></svg>',
  slow:  '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 5.2V9l2.6 1.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 26 18"><rect x="9" y="3.5" width="2.9" height="11" rx="1" fill="currentColor"/><rect x="14.1" y="3.5" width="2.9" height="11" rx="1" fill="currentColor"/></svg>',
  play:  '<svg viewBox="0 0 26 18"><path d="M10 3.6 19 9l-9 5.4Z" fill="currentColor"/></svg>',
  step:  '<svg viewBox="0 0 26 18"><path d="M8 3.6 16 9l-8 5.4Z" fill="currentColor"/><rect x="17.4" y="3.6" width="2.4" height="10.8" rx="1" fill="currentColor"/></svg>',
};

/** One rail button: an icon, and a label that is read out and searched for but not drawn. The
 *  rail is 58px wide and "Slow motion" does not fit at the UX floor's 11px minimum, so the choice
 *  is a clipped label or a shrunken one - and shrinking below 11px is the thing the floor forbids. */
function railBtn(icon, label, onClick, title, short) {
  // A VISIBLE WORD AND A FULL ONE. An icon-only rail is fine on a desktop, where a tooltip is one
  // hover away; on a phone there is no hover and a tooltip is a control with no label at all. So
  // every button shows a short word under its icon (the rail is 58px and 11px is the UX floor's
  // minimum, which together allow about six characters) and carries the full name for a screen
  // reader - which is also the name the browser test looks for, deliberately: what a person reads
  // and what the contract checks should never be two different strings.
  // ALWAYS render the visible word, even when it is the same string as the full label. The first
  // version skipped it when they matched, which silently left Pause as a bare icon with no word
  // under it while its three neighbours had one.
  const vis = `<span aria-hidden="true">${esc(short || label)}</span>`;
  const b = el(`<button class="railbtn" title="${esc(title || label)}">${icon}${vis}<span class="sr">${esc(label)}</span></button>`);
  b.onclick = onClick;
  return b;
}

// The rail's contents depend on the MODE and on nothing else, and `renderPanel()` runs on every
// pointermove of a drag (through `afterEdit`). Rebuilding eight palette buttons per move is DOM
// churn on the one path that has to stay smooth - and in Play it would throw away the Pause and
// Slow buttons' own state every time. So the rail is rebuilt when the mode changes and not
// otherwise.
let railMode = null;

function renderRail() {
  if (railMode === app.mode) return;
  railMode = app.mode;
  railTools.innerHTML = '';
  launchBtn = null;
  if (app.mode === 'play') return renderPlayRail();
  if (app.mode === 'edit') return renderPalette();
}

function renderPlayRail() {
  // `launch` keeps its id: it was the floating button on the canvas, and it is the same control,
  // moved somewhere it is not sitting on the playfield's bottom right corner (which on BOARDWALK
  // is directly over the right outlane).
  launchBtn = railBtn(RAIL_ICONS.ball, 'New ball', newBall, 'drop a new ball (Space)', 'Ball');
  launchBtn.id = 'launch';
  launchBtn.classList.add('primary');
  const slow = railBtn(RAIL_ICONS.slow, 'Slow motion', () => {
    app.slowmo = app.slowmo === 1 ? 0.25 : 1;
    slow.classList.toggle('on', app.slowmo !== 1);
    slow.querySelector('[aria-hidden]').textContent = app.slowmo === 1 ? 'Slow' : 'Full';
    slow.querySelector('.sr').textContent = app.slowmo === 1 ? 'Slow motion' : 'Full speed';
  }, 'quarter speed', 'Slow');
  const pause = railBtn(RAIL_ICONS.pause, 'Pause', () => {
    app.running = !app.running;
    pause.innerHTML = (app.running ? RAIL_ICONS.pause : RAIL_ICONS.play)
      + `<span aria-hidden="true">${app.running ? 'Pause' : 'Resume'}</span><span class="sr">${app.running ? 'Pause' : 'Resume'}</span>`;
  }, 'pause the simulation', 'Pause');
  const stepb = railBtn(RAIL_ICONS.step, 'Step frame', () => {
    app.running = false;
    pause.innerHTML = RAIL_ICONS.play + '<span aria-hidden="true">Resume</span><span class="sr">Resume</span>';
    stepPlay(1 / 60);
  }, 'advance one frame', 'Step');
  railTools.append(launchBtn, slow, pause, stepb);
}

function renderPalette() {
  const grid = el('<div class="palette"></div>');
  for (const [k, name] of [['seg', 'Wall'], ['arc', 'Arc'], ['circle', 'Post'], ['bumper', 'Bumper'], ['sling', 'Sling'], ['flipper', 'Flipper'], ['ribbon', 'Ramp'], ['drain', 'Drain']]) {
    const b = el(`<button title="add a ${name.toLowerCase()}">${PART_ICONS[k] || ''}<span>${name}</span></button>`);
    b.onclick = () => addShape(k);
    grid.append(b);
  }
  railTools.append(grid);
}

function renderPlayPanel() {
  panel.append(el('<h2>Controls</h2>'));
  panel.append(el('<div class="note">Hold the left or right half of the table to flip, or <b>Z</b> and <b>M</b> on a keyboard. <b>Space</b> drops a new ball.<br>The rail on the left has the transport: new ball, slow motion, pause and step.</div>'));
}

function renderEditPanel() {

  // THE PREFAB GROUP. Open exactly when it is useful: when there is a selection to save, or
  // something saved to place.
  const pf = prefabNames();
  inGroup('Prefabs', !!(app.sel.size || pf.length), !!app.placing, () => {
    const r = el('<div class="row"></div>');
    const add = el('<button>Save selection...</button>');
    add.disabled = !app.sel.size;
    add.onclick = () => {
      const name = (prompt(`Save these ${app.sel.size} part(s) as a prefab called:`, '') || '').trim();
      if (!name) return;
      if (name in readPrefabs() && !confirm(`Overwrite the prefab "${name}"?`)) return;
      if (!savePrefab(name)) { alert('Could not save: this device is out of storage, or a selected part has a broken number in it.'); return; }
      renderPanel();
    };
    r.append(add);
    panel.append(r);

    if (!pf.length) {
      panel.append(el('<div class="note">Select some parts and save them here. A saved prefab can be dropped anywhere, on any table, and lands as ordinary parts you can edit one by one.</div>'));
      return;
    }
    for (const name of pf) {
      const row = el('<div class="row"></div>');
      row.append(el(`<label style="flex:1">${esc(name)}</label>`));
      const armed = !!app.placing && app.placing.name === name;
      const place = el(`<button${armed ? ' class="primary"' : ''}>${armed ? 'Cancel' : 'Place'}</button>`);
      place.onclick = () => {
        if (armed) app.placing = null; else armPrefab(name);
        renderPanel();
      };
      const del = el('<button class="danger">X</button>');
      del.title = `delete the prefab ${name}`;
      del.onclick = () => {
        if (!confirm(`Delete the prefab "${name}"? No table is changed.`)) return;
        deletePrefab(name);
      };
      row.append(place, del);
      panel.append(row);
    }
    if (app.placing) {
      panel.append(el(`<div class="note">Tap the table to drop <b>${esc(app.placing.name)}</b>. It is drawn in the middle of the table so you can turn it with the bar below before you place it.</div>`));
    }
  });

  // THE TABLE GROUP. Open by default: which table you are looking at, and how to keep one, is the
  // first question this tool has to answer out loud rather than by implication.
  inGroup('Table', true, false, () => {
    if (app.migrated) {
      panel.append(el(`<div class="note">Your previous edits are kept as <b>${esc(app.migrated)}</b> in the table list. This is the table the current build ships.</div>`));
    }
    const shipped = app.builtin || 'Default';
    panel.append(el(`<div class="note">${app.tableName
      ? `Editing <b>${esc(app.tableName)}</b>. Changes are saved to it as you work.`
      : `Editing <b>${esc(shipped)}</b>, a table this build ships. Changes here are a working copy and are NOT kept: use Save as to name one.`}</div>`));

    const r1 = el('<div class="row"></div>');
    const sa = el('<button class="primary">Save as...</button>');
    sa.onclick = () => {
      const suggested = app.tableName || app.table.name || 'My table';
      const name = (prompt('Save this table as:', suggested) || '').trim();
      if (!name) return;
      const lib = readLib();
      if (name in lib && !confirm(`Overwrite "${name}"?`)) return;
      if (!saveAs(name)) { alert('Could not save: this device is out of storage, or the table has a broken number in it.'); return; }
      renderPanel();
    };
    const dl = el('<button class="danger">Delete...</button>');
    dl.disabled = !app.tableName;
    dl.onclick = () => {
      if (!app.tableName) return;
      if (!confirm(`Delete the saved table "${app.tableName}"? The build's Default is never affected.`)) return;
      deleteTable(app.tableName);
    };
    r1.append(sa, dl);
    panel.append(r1);

    const r2 = el('<div class="row"></div>');
    const revert = el('<button>Revert</button>');
    revert.onclick = () => {
      const what = app.tableName ? `"${app.tableName}" as last saved` : `the build's ${shipped}`;
      if (!confirm(`Throw away the changes since you last loaded, and reload ${what}?`)) return;
      selectTable(app.builtin ? BUILTIN + app.builtin : app.tableName);
    };
    const exp = el('<button>Export JSON</button>');
    exp.onclick = () => {
      const blob = new Blob([toJSON(app.table)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(app.tableName || app.table.name).toLowerCase().replace(/\s+/g, '-')}.json`;
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
    r2.append(revert, exp, imp);
    panel.append(r2);
  });

  inGroup('How to', false, false, () => {
    panel.append(el('<div class="note">Tap a part to select it. Drag empty space to lasso. Shift adds to the selection. Arrow keys nudge, shift-arrow nudges further.</div>'));
    panel.append(el('<div class="note">Pinch to zoom, two fingers to pan, or use the zoom buttons in the top bar. Press and hold a part or a handle for half a second before dragging and it moves a quarter as far as your finger, with a magnifier in the corner.</div>'));
  });

  // The inspector is the other half of the dock: its own column on a wide screen, and underneath on
  // a phone. It is the thing you look at while dragging, so it never shares space with the palette.
  panel = dockB;
  panel.append(el('<h2>Inspector</h2>'));
  renderInspector();
  renderPlacements();
}

// THE PLACEMENTS LIST: the reverse direction of tapping the table. Once a table has forty small
// parts on it, finding the one you want by eye is worse than reading its name off a list, and a
// part hidden under a ramp cannot be tapped at all.
function renderPlacements() {
  const shapes = app.table.shapes.slice().sort((a, b) => {
    const k = (KIND_NAMES[a.kind] || a.kind).localeCompare(KIND_NAMES[b.kind] || b.kind);
    return k || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
  inGroup(`Parts (${shapes.length})`, false, false, () => {
    panel.append(el('<div class="note">Tap one to select it and bring the view to it.</div>'));
    for (const sh of shapes) {
      const on = app.sel.has(sh.id);
      const b = el(`<button class="plrow${on ? ' on' : ''}">${PART_ICONS[sh.kind] || ''}<span>${KIND_NAMES[sh.kind] || sh.kind}</span><em>${esc(sh.id)}</em></button>`);
      b.onclick = () => {
        app.sel = new Set([sh.id]);
        const c = centreOf(sh);
        if (Number.isFinite(c.x) && Number.isFinite(c.y)) panTo(c, 2);
        renderPanel();
      };
      panel.append(b);
    }
  });
}

/** Exact turn and scale, for the amounts the bar's fixed steps cannot reach without counting taps.
 *  It acts on the same target as the bar (the selection, or an armed prefab) about the same anchor,
 *  so the two controls cannot disagree about what "turn this" means. */
function renderXformRows() {
  panel.append(el('<div class="note">Turns and scales about the middle of the selection. The bar below does the same in steps.</div>'));

  const rot = el('<div class="row"><label>Turn by (deg)</label><input type="number" step="1" value="15"></div>');
  const ri = rot.querySelector('input');
  const rl = el('<button title="turn anticlockwise">&#8634;</button>');
  const rr = el('<button title="turn clockwise">&#8635;</button>');
  const deg = () => { const v = parseFloat(ri.value); return Number.isFinite(v) ? v : 0; };
  rl.onclick = () => turnSel(-deg());
  rr.onclick = () => turnSel(deg());
  rot.append(rl, rr);
  panel.append(rot);

  const sca = el('<div class="row"><label>Scale to (%)</label><input type="number" step="1" value="100"></div>');
  const si = sca.querySelector('input');
  const go = el('<button>Apply</button>');
  go.onclick = () => {
    const v = parseFloat(si.value);
    if (!Number.isFinite(v) || v <= 0) return;
    // A percentage of what is on the table RIGHT NOW, then back to 100: two taps of "80%" is 64%,
    // which is what a person who taps it twice means.
    if (scaleSel(v / 100)) si.value = '100';
  };
  sca.append(go);
  panel.append(sca);
}

function renderInspector() {
  if (app.sel.size === 0 && !app.placing) {
    panel.append(el('<div class="note">Nothing selected. Tap a part on the table.</div>'));
    return;
  }
  if (app.placing) {
    panel.append(el(`<h2>${esc(app.placing.name)}</h2>`));
    panel.append(el('<div class="note">Armed, drawn in the middle of the table. Turn or scale it here, then tap the table to drop it.</div>'));
    renderXformRows();
    return;
  }
  if (app.sel.size > 1) {
    panel.append(el(`<div class="note">${app.sel.size} parts selected. Drag to move them together.</div>`));
    renderXformRows();
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
    panel.append(numRow('Lane width', mm(sh.w), 1, (v) => { sh.w = v / 1000; if (sh.ctrl) rebuildRamp(sh); }));
    panel.append(numRow('Height', mm(zmax), 1, (v) => {
      if (sh.ctrl) {
        // Regenerate rather than scale, so the profile is always the generator's and the crest stays
        // where the rules need it. Scaling every z by the same factor happens to preserve the shape,
        // but it is a second way of producing the geometry and the two would drift.
        const pts = rampPoints(sh.ctrl, { zmax: v / 1000, w: sh.w, r: sh.r });
        if (pts.length >= 2) sh.pts = pts;
        return;
      }
      const k = zmax > 1e-6 ? (v / 1000) / zmax : 0;
      for (const q of sh.pts) q.z = (q.z || 0) * k;
    }));
    panel.append(el(`<div class="note">${sh.pts.length} points, ${(sh.w * 1000).toFixed(0)}mm wide, rising to ${(zmax * 1000).toFixed(0)}mm.`
      + `${sh.ctrl ? ` Drag any of its ${sh.ctrl.length} dots to reshape the curve, or drag the ramp itself to move it.` : ' Drag either end dot to move the whole ramp. It was built before the Ramp tool existed, so it has no control points to reshape.'}`
      + ` Run <b>Ramps</b> on the Check tab after changing it.</div>`));
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
  // Collapsed for ONE part, because most of what it does a single part already has its own rows for
  // (a rail has Angle, an arc has From and To). What it adds here is scaling, which nothing else
  // offers, and turning a part about its own middle rather than about one of its ends.
  inGroup('Turn and scale', false, false, renderXformRows);
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
      if (!rows.length) continue;
      // The selected part's own group is OPEN and marked, which is the whole point of tapping it.
      inGroup(KIND_NAMES[k] || k, true, true, () => {
        for (const t of rows) { done.add(t.key); panel.append(tuneRow(t)); any++; }
      });
    }
    if (!any) panel.append(el(`<div class="note">A ${names.join(' or ')} has no numbers of its own. The table-wide ones below still govern it.</div>`));
    inGroup('The whole table', true, false, () => {
      for (const t of wide) panel.append(tuneRow(t));
    });
  } else {
    panel.append(el('<div class="note">Tap a part on the table to open just its numbers. Drag a slider while a ball is in play.</div>'));
    inGroup('The whole table', true, false, () => {
      for (const t of wide) panel.append(tuneRow(t));
    });
    for (const k of Object.keys(KIND_NAMES)) {
      const rows = rowsFor(k);
      if (!rows.length) continue;
      inGroup(KIND_NAMES[k], false, false, () => {
        for (const t of rows) { done.add(t.key); panel.append(tuneRow(t)); }
      });
    }
  }

  // Dock B: the things that act on the whole config, kept away from the sliders so a thumb reaching
  // for Ramp drag cannot land on Back to defaults.
  panel = dockB;
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
  panel.append(el(`<div class="note">Copy config writes the block for config.js. Gravity down the playfield is ${gravity(app.cfg).toFixed(3)} m/s2, which is g times sin(tilt).</div>`));
}

function renderCheckPanel() {
  // The copy used to say "Three questions" above what has been five buttons since the ramp probe
  // moved in here. A tool that miscounts its own controls is a tool nobody trusts about a table.
  panel.append(el('<div class="note">Answered on the table as it stands right now, and drawn ON it as red marks rather than summarised as a percentage. The two sweeps run on a coarser grid here than <code>probes/run.mjs</code> does, so the terminal is still the last word before a deploy.</div>'));
  const r = el('<div class="row"></div>');
  const bTraps = el('<button class="primary">Find traps</button>');
  const bTunnel = el('<button>Tunnel test</button>');
  const bGaps = el('<button>Gap rule</button>');
  // RAMPS. This probe was node-only until the Ramp tool shipped, which was fine while the only ramps
  // in existence were written in code and checked once. The moment a person can lay one by hand, a
  // check that lives in a terminal is a check that never runs: you would build a broken ramp and
  // find out by playing.
  const bRamps = el('<button>Ramps</button>');
  const bMask = el('<button>Show reachable</button>');
  const bClear = el('<button>Clear marks</button>');
  r.append(bTraps, bTunnel, bGaps, bRamps, bMask, bClear);
  panel.append(r);

  // The report goes in the OTHER half of the dock. It used to sit under the buttons in one column,
  // so a long result pushed the buttons off the bottom of the screen and you could not re-run the
  // check you were reading.
  panel = dockB;
  panel.append(el('<h2>Results</h2>'));
  const prog = el('<div id="progwrap"><div id="progbar"><i></i></div><button id="prog-cancel">Stop</button></div>');
  panel.append(prog);
  const out = el('<pre id="report"></pre>');
  panel.append(out);
  const bar = prog.querySelector('i');
  prog.querySelector('#prog-cancel').onclick = () => cancelCheck();

  /** Run a check generator ACROSS FRAMES instead of in one blocking call.
   *
   *  Matt's complaint that started this redesign is a UI one, but this is the half of it that is a
   *  bug: the old handlers ran the whole sweep inside a `setTimeout`, so the page painted
   *  "dropping balls..." and then died for 3.5 s on TEST BOX and 5.8 s on BOARDWALK - measured, on
   *  a desktop; a phone is several times that. No progress, no way to stop, and nothing to tell it
   *  apart from a crash. A tool that freezes when you use its main feature is a tool you stop
   *  using.
   *
   *  The budget is per FRAME, not per iteration count: a drop on a 44-part table costs many times
   *  what one on the bare box costs, so a fixed chunk size is fast on one table and a freeze on the
   *  next. 12 ms leaves the frame its paint. */
  function runChunked(label, gen, finish) {
    cancelCheck();
    out.textContent = `${label}...`;
    prog.classList.add('on');
    const BUDGET_MS = 20;
    const tick = () => {
      const t0 = performance.now();
      let r;
      do {
        r = gen.next();
        if (r.done) {
          prog.classList.remove('on');
          app.checkRun = null;
          finish(r.value);
          return;
        }
      } while (performance.now() - t0 < BUDGET_MS);
      const v = r.value || {};
      if (v.total) {
        bar.style.width = `${Math.min(100, (v.done / v.total) * 100).toFixed(1)}%`;
        out.textContent = `${label}... ${v.done} of ${v.total}${v.phase === 'nudge' ? ' (checking knife edges)' : ''}`;
      }
      app.checkRun = requestAnimationFrame(tick);
    };
    app.checkRun = requestAnimationFrame(tick);
  }

  function cancelCheck() {
    if (app.checkRun == null) return;
    cancelAnimationFrame(app.checkRun);
    app.checkRun = null;
    prog.classList.remove('on');
    out.textContent = 'Stopped. Nothing was changed on the table.';
  }

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
  bRamps.onclick = () => {
    const ramps = app.table.shapes.filter((x) => x.kind === 'ribbon');
    if (!ramps.length) { out.textContent = 'No ramps on this table.'; app.marks = []; return; }
    out.textContent = 'rolling...';
    setTimeout(() => {
      const r2 = rampProbe(app.table, app.cfg);
      app.marks = (r2.fails || []).filter((f) => f.at).map((f) => ({ at: f.at, kind: 'ramp' }));
      const lines = (r2.fails || []).map((f) => `  ${f.ramp}: ${f.why}`);
      out.textContent = lines.length
        ? `${lines.length} problem(s) on ${ramps.length} ramp(s):\n${lines.join('\n')}`
        : `${ramps.length} ramp(s), ${(r2.runs || []).length} shots at the mouth. Both ends at zero height,\nno kink over 20 degrees, no level run, and every one both makes it round and rolls back out.`;
    }, 20);
  };
  bTunnel.onclick = () => {
    runChunked('Firing', tunnelProbeGen(app.table, app.cfg, { angles: 16 }), (r2) => {
      app.marks = r2.fails.map((f) => ({ at: f.end, kind: 'tunnel' }));
      out.textContent = r2.fails.length
        ? `${r2.fails.length} of ${r2.shots} shots at ${app.cfg.MAX_SPEED} m/s went through something.\n`
          + `Run \`node pinball2/probes/run.mjs tunnel\` for the full 24-angle sweep.`
        : `${r2.shots} shots at ${app.cfg.MAX_SPEED} m/s from 16 angles. None got through.\n`
          + `The terminal sweep fires 24 angles; run it before a deploy.`;
    });
  };
  bTraps.onclick = () => {
    runChunked('Dropping balls', restSweepGen(app.table, app.cfg, { step: 0.016, seconds: 5 }), (r2) => {
      app.marks = r2.stuck.map((s) => ({ at: s.at, kind: 'trap' }));
      const spots = [];
      for (const s of r2.stuck) {
        if (!spots.some((q) => Math.hypot(q.at.x - s.at.x, q.at.y - s.at.y) < 0.008)) spots.push(s);
      }
      out.textContent = r2.stuck.length
        ? `${r2.stuck.length} of ${r2.drops} drops never reached the drain, in ${spots.length} place(s):\n`
          + spots.map((s) => `  (${(s.at.x * 1000).toFixed(0)}, ${(s.at.y * 1000).toFixed(0)}) mm on ${s.on || 'nothing'}`).join('\n')
        : `${r2.drops} drops, every one reached the drain. No traps.\n`
          + `This grid is 16 mm; \`probes/run.mjs rests\` uses 12 mm and drops about twice as many.`;
    });
  };
}

// ------------------------------------------------------------------ the sheet
//
// THE DOCK'S HEIGHT IS DRAGGABLE, WITH THREE DETENTS, AND IT IS THE SAME HEIGHT IN ALL FOUR MODES.
//
// This is the other half of the layout fix. The table is 0.515 x 1.067 m and a phone is portrait,
// so the canvas fits by HEIGHT: the only way to draw a bigger table is a taller stage. At the
// closed detent the work area is the whole screen minus the bands, and the table is drawn 333 x 690
// on a 393 x 852 phone, against 230 x 477 before - the difference between squinting at a 12-pixel
// ball and being able to see what you are building.
//
// ONE height for every mode, deliberately. A per-mode height would resize the canvas on a tab
// switch with no window resize event, which is exactly the bug this layout was rebuilt to end, and
// `test-editor.mjs` measures the canvas box in all four modes to keep it that way.

const SHEET = 'pinball2.editor.sheet';
const SHEET_MIN = 0;                       // closed: the grab handle alone
const SHEET_PEEK = 172;
const sheetEl = document.getElementById('sheet');
const grabEl = document.getElementById('grab');

const sheetMax = () => Math.round(Math.min(520, window.innerHeight * 0.56));
/** The three detents, computed rather than stored, because the tall one depends on the screen. */
const sheetDetents = () => [SHEET_MIN, SHEET_PEEK, sheetMax()];

function setSheet(px, remember) {
  const h = Math.max(SHEET_MIN, Math.min(sheetMax(), Math.round(px)));
  document.documentElement.style.setProperty('--sheet-h', `${h}px`);
  if (remember !== false) { try { localStorage.setItem(SHEET, String(h)); } catch (e) { /* private mode */ } }
  return h;
}

function sheetH() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'));
  return Number.isFinite(v) ? v : SHEET_PEEK;
}

/** Tap the handle: OPEN or SHUT, nothing else. A drag is for a size in between.
 *
 *  The first version cycled through the three detents, and one tap on a peeking sheet made it the
 *  TALLEST - which shrank the table from 242px wide to 95px, the exact opposite of what somebody
 *  reaching for the handle wants. A tap has to do the obvious thing every time, and the obvious
 *  thing is "get this out of my way" / "give it back". The height it gives back is the one you last
 *  had open, so a sheet dragged to a size you liked is the size it returns to. */
let lastOpenH = SHEET_PEEK;

function cycleSheet() {
  const now = sheetH();
  if (now > 8) { lastOpenH = now; setSheet(SHEET_MIN); }
  else setSheet(lastOpenH > 8 ? lastOpenH : SHEET_PEEK);
}

{
  let from = null;
  let startH = 0;
  let moved = false;
  grabEl.addEventListener('pointerdown', (e) => {
    from = e.clientY; startH = sheetH(); moved = false;
    grabEl.classList.add('on');
    try { grabEl.setPointerCapture(e.pointerId); } catch (err) { /* throws readily; never worth the gesture */ }
  });
  grabEl.addEventListener('pointermove', (e) => {
    if (from == null) return;
    const dy = from - e.clientY;              // drag UP makes the sheet taller
    if (Math.abs(dy) > 4) moved = true;
    if (moved) setSheet(startH + dy);
  });
  const end = () => {
    if (from == null) return;
    from = null;
    grabEl.classList.remove('on');
    if (!moved) cycleSheet();
    else {
      // Snap to the nearest detent on release, so the sheet always ends somewhere deliberate.
      const h = sheetH();
      const d = sheetDetents();
      setSheet(d.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a)));
    }
  };
  grabEl.addEventListener('pointerup', end);
  grabEl.addEventListener('pointercancel', end);
}

try {
  const stored = parseFloat(localStorage.getItem(SHEET));
  setSheet(Number.isFinite(stored) ? stored : SHEET_PEEK, false);
} catch (e) { setSheet(SHEET_PEEK, false); }
// A rotation changes what the tall detent means, so a sheet left at the old maximum has to come
// back inside the new one rather than eating the whole screen.
window.addEventListener('resize', () => setSheet(sheetH(), false));

// ------------------------------------------------------------------ modes

function setMode(m) {
  app.mode = m;
  for (const k of ['play', 'edit', 'tune', 'check']) {
    document.getElementById(`tab-${k}`).setAttribute('aria-pressed', String(k === m));
  }
  zones.classList.toggle('on', false);
  if (m === 'play') { ensureWorld(); app.running = true; }
  if (m !== 'edit') { app.placing = null; app.drawing = null; }   // both live only while Edit is open
  // A sweep is scheduled on animation frames, so it would otherwise keep running - and keep
  // writing its own progress into a panel that no longer exists - after you left the tab.
  if (app.checkRun != null) { cancelAnimationFrame(app.checkRun); app.checkRun = null; }
  if (m === 'tune') app.tuneAll = false;          // arriving on Tune asks about whatever is selected
  app.marks = [];
  renderPanel();
}
for (const k of ['play', 'edit', 'tune', 'check']) {
  document.getElementById(`tab-${k}`).onclick = () => setMode(k);
}

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
  if (app.mode === 'edit') { drawGhost(); drawRampPath(); drawLoupe(); }

  drawStatus();
}

// ------------------------------------------------------------------ the status bar
//
// Facts, in a bar, in one fixed-height line. This replaced a three-line box drawn ON the playfield
// that covered the top rail and two lanes of every table in every mode - on the one screen whose
// entire job is letting you look at the table.
//
// It is built from SEGMENTS (a small grey key, a bright value) rather than a run of text, because a
// status bar is scanned rather than read: you are looking for the one number that changed, and a
// label in front of every number is what makes that possible without reading the rest.

const stSeg = (k, v, warn) => `<span class="seg"><span class="k">${esc(k)}</span><span class="v${warn ? ' warn' : ''}">${esc(v)}</span></span>`;

let lastStatus = '';

function drawStatus() {
  const segs = [];
  if (app.mode === 'play') {
    const b = app.world && app.world.balls.find((x) => x.alive);
    segs.push(stSeg('speed', b ? `${Math.hypot(b.v.x, b.v.y).toFixed(2)} m/s` : 'drained'));
    if (!app.running) segs.push(stSeg('', 'paused'));
    if (app.slowmo !== 1) segs.push(stSeg('', `${Math.round(app.slowmo * 100)}% speed`));
    // These four are diagnostics that should read zero for ever. They are shown only when they do
    // not, so the bar stays quiet and a number appearing in it MEANS something.
    if (app.world && app.world.jams) segs.push(stSeg('jams', String(app.world.jams), true));
    if (app.world && app.world.rescues) segs.push(stSeg('rescues', String(app.world.rescues), true));
    if (app.world && app.world.escapes) segs.push(stSeg('LEFT TABLE', String(app.world.escapes), true));
    if (app.world && app.world.broken) segs.push(stSeg('broken', String(app.world.broken), true));
  } else {
    segs.push(stSeg('parts', String(app.table.shapes.length)));
    segs.push(stSeg('sel', String(app.sel.size)));
    if (app.mode === 'edit') segs.push(stSeg('grid', app.snap ? `${(app.grid * 1000).toFixed(0)} mm` : 'off'));
  }
  segs.push(stSeg('zoom', `${Math.round((app.view ? app.view.zoom : 1) * 100)}%`));
  if (app.errors) segs.push(stSeg('draw errors', `${app.errors} · ${app.lastError}`, true));
  if (app.repaired) segs.push(stSeg('repaired', `${app.repaired} broken part(s) on load`, true));
  // The table's own name and contents go LAST and take whatever width is left, ellipsised: it is
  // the one thing here that answers "am I looking at what I think I am", and it is also the one
  // thing that can be arbitrarily long.
  segs.push(`<span class="seg grow">${esc(app.table.name)} — ${esc(tableKinds())}</span>`);
  const html = segs.join('');
  // The loop runs at 60fps and innerHTML is not free. Only touch the DOM when the text changed.
  if (html !== lastStatus) { statusBar.innerHTML = html; lastStatus = html; }

  // THE TOAST: a live instruction about what the next tap does, and nothing else.
  let msg = '';
  if (app.placing) msg = `Tap the table to place "${app.placing.name}"`;
  else if (app.drawing) {
    const n = app.drawing.pts.length;
    msg = `Tap to lay the ramp path — ${n} point${n === 1 ? '' : 's'}`
      + (n < RAMP_MIN_PTS ? `, ${RAMP_MIN_PTS - n} more needed` : ', then Done');
  }
  if (msg !== toast.textContent) toast.textContent = msg;
  toast.classList.toggle('on', !!msg);
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

// AN ARMED PREFAB IS DRAWN BEFORE IT LANDS, in the middle of whatever you can see. Turning one
// before you place it is otherwise blind: a phone has no hover, so a preview that follows the
// pointer shows nothing at all to the person who most needs it, and the alternative (drop it, look
// at it, turn it, move it back) is the rebuilding the prefab library exists to avoid.
//
// It is an OUTLINE in the selection accent, dashed, so it cannot be mistaken for a part that is
// really there. Centrelines only: this answers "which way is it pointing", not "how thick is it".
function drawGhost() {
  if (!app.placing || !app.view) return;
  const r = canvas.getBoundingClientRect();
  const at = toTable(app.view, { x: r.width / 2, y: r.height / 2 });
  ctx.save();
  ctx.strokeStyle = '#ffce3a';
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  for (const s of app.placing.shapes) {
    const sh = JSON.parse(JSON.stringify(s));
    moveShape(sh, at.x, at.y);
    ghostPath(sh);
    ctx.stroke();
  }
  ctx.restore();
}

// THE PATH YOU ARE LAYING, drawn as the real generated curve rather than as the dots you tapped.
// Tapping four points and being shown four points tells you nothing about the ramp you are actually
// making: the curve bulges where you did not put a point, and that bulge is what a ball rides.
function drawRampPath() {
  const d = app.drawing;
  if (!d || !app.view) return;
  const v = app.view;
  ctx.save();
  if (d.pts.length >= RAMP_MIN_PTS) {
    const pts = rampPoints(d.pts, {});
    if (pts.length >= 2) {
      // THE ACCENT, not the ramp blue. The first version drew the preview in the same colours a
      // finished ramp uses, and laying one beside an existing ramp made the two indistinguishable -
      // you could not tell what you were drawing from what was already there.
      ctx.strokeStyle = 'rgba(255,206,58,0.30)';
      ctx.lineWidth = Math.max(2, RAMP_DEFAULTS.w * v.s * v.zoom);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((q, i) => { const t = toScreen(v, q); if (i) ctx.lineTo(t.x, t.y); else ctx.moveTo(t.x, t.y); });
      ctx.stroke();
      ctx.strokeStyle = '#ffce3a';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (d.pts.length === 2) {
    const a = toScreen(v, d.pts[0]);
    const b = toScreen(v, d.pts[1]);
    ctx.strokeStyle = '#ffce3a';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  // The taps themselves, numbered by size: the first is the mouth a ball enters.
  d.pts.forEach((q, i) => {
    const t = toScreen(v, q);
    ctx.beginPath();
    ctx.arc(t.x, t.y, i === 0 ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffce3a';
    ctx.fill();
    ctx.strokeStyle = '#21180a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  ctx.restore();
}

function ghostPath(sh) {
  const v = app.view;
  const P = (p) => toScreen(v, p);
  const sc = v.s * v.zoom;
  const R = (m) => Math.max(2, m * sc);
  ctx.beginPath();
  if (sh.kind === 'seg' || sh.kind === 'sling') {
    const a = P(sh.a);
    const b = P(sh.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (sh.kind === 'circle' || sh.kind === 'bumper') {
    const c = P(sh.c);
    ctx.arc(c.x, c.y, R(sh.r), 0, Math.PI * 2);
  } else if (sh.kind === 'arc') {
    // Both frames run y down, so the stored atan2 angles are the canvas's angles unchanged.
    const c = P(sh.c);
    let span = (sh.a1 - sh.a0) % (Math.PI * 2);
    if (span < 0) span += Math.PI * 2;
    ctx.arc(c.x, c.y, R(sh.radius), sh.a0, sh.a0 + span);
  } else if (sh.kind === 'flipper') {
    const p = P(sh.pivot);
    const t = P({ x: sh.pivot.x + Math.cos(sh.restAng) * sh.len, y: sh.pivot.y + Math.sin(sh.restAng) * sh.len });
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(t.x, t.y);
  } else if (sh.kind === 'ribbon') {
    sh.pts.forEach((q, i) => { const s = P(q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  } else if (sh.kind === 'drain') {
    const a = P({ x: sh.x, y: sh.y });
    ctx.rect(a.x, a.y, sh.w * sc, sh.h * sc);
  }
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
