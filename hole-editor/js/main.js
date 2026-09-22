// hole-editor/js/main.js - boot, layout, keyboard, tool switching. Step 4 wires the 11 tools
// (section 6): ribbon buttons, keyboard shortcuts (V R W B H T L G S C M), and the edit-ops bridge
// between canvas.js's hit-testing/dragging and model.js's pure mutators (undo pushed once per
// instant action or once per drag/slider release - section 3.5).

import {
  createDocument, buildHole, originalSpecs, buildOriginalHole, HOLE_COUNT,
  createEditorState, pushUndo, undo, redo,
  serialiseDocument, loadDocument, STORAGE_KEY,
  setField,
  insertWaypoint, removeWaypoint, movePathPoint, straightenPath, insertDogleg,
  setWidthPoint, insertWidthPoint, deleteWidthPoint, scaleWidth,
  addBunker, setBunkerField, rerollBunker, deleteBunker,
  addWater, setWaterField, rerollWater, deleteWater,
  addTree, setTreeField, deleteTree, addSentinel, setSentinelField, deleteSentinel,
  addCross, setCrossField, deleteCross, deleteObject,
  addDecor, setDecorField, deleteDecor,
  addLine, setLineField, moveLinePoint, deleteLine,
  setBeltField, setGreenField, rerollGreen, toggleGuard,
  setSlopePreset, bakeSlopeToCells, setSlopeCell, flattenSlope,
  addDrawnShape, setDrawnPoly, translateDrawn, scaleObject, duplicateObject,
  detachGuards, insertSBend,
  setGreenOutline, clearGreenOutline, setFringe, addPin, movePin, deletePin,
  setCourse, invalidateBuilds, setCourseMeta, addHole, deleteHole, mintId, normalise,
} from './model.js';
import { resolveProfile } from './course.js';
import { starterSpec } from './starter.js';
import { designer, rememberDesigner, forgetDesigner, makeAutosaver, listDrafts, fetchDraft } from './drafts.js';
import { EditorCanvas, fairwayEdgesAt, setEditorTheme } from './canvas.js';
import { renderLegend, renderLayers, DEFAULT_LAYERS, renderHolePanel, renderBottomStrip, renderContextPanel, pointsInMessage, openCompareModal } from './panels.js';
import { renderPalette, activeItemFor } from './palette.js';
import { validateHole } from '../../golf/js/holes.js';
import { generateSource, generateJSON, exportFileName } from './export.js';

const MUTATORS = {
  setField,
  insertWaypoint, removeWaypoint, movePathPoint, straightenPath, insertDogleg,
  setWidthPoint, insertWidthPoint, deleteWidthPoint, scaleWidth,
  addBunker, setBunkerField, rerollBunker, deleteBunker,
  addWater, setWaterField, rerollWater, deleteWater,
  addTree, setTreeField, deleteTree, addSentinel, setSentinelField, deleteSentinel,
  addCross, setCrossField, deleteCross, deleteObject,
  addDecor, setDecorField, deleteDecor,
  addLine, setLineField, moveLinePoint, deleteLine,
  setBeltField, setGreenField, rerollGreen, toggleGuard,
  setSlopePreset, bakeSlopeToCells, setSlopeCell, flattenSlope,
  addDrawnShape, setDrawnPoly, translateDrawn, scaleObject, duplicateObject,
  detachGuards, insertSBend,
  setGreenOutline, clearGreenOutline, setFringe, addPin, movePin, deletePin,
};

// THE RIBBON HOLDS ACTIONS, THE PALETTE HOLDS OBJECTS (2026-09-22). A tool with `ribbon: false`
// is picked by clicking a picture in the palette (bunker, water, tree, cross); its key still works.
// 'belts' is gone as a tool: tree lines are a property of the hole and live in the Hole panel.
const TOOLS = [
  ['select', 'V', '↖', 'Select', true],
  ['route', 'R', '⤳', 'Route', true],
  ['width', 'W', '↔', 'Width', true],
  ['green', 'G', '○', 'Green', true],
  ['slope', 'S', '↗', 'Slope', true],
  ['ruler', 'M', '⇲', 'Ruler', true],
  ['bunker', 'B', '●', 'Bunker', false],
  ['water', 'H', '≈', 'Water', false],
  ['tree', 'T', '♣', 'Tree', false],
  ['cross', 'C', '✖', 'Across', false],
  // Decor (2026-09-22): art only, never consulted for anything. Its tiles live in the palette like
  // every other object, and `toolState.decorKind` says which sprite the next click drops.
  ['decor', 'K', '⚑', 'Decor', false],
  // Power line (2026-09-22, docs/HANDOFF-GOLF-POWER-LINES.md): picking this tool STARTS DRAWING a
  // line (setTool below) - click the poles, Enter or double-click finishes (model.js addLine via
  // addDrawnShape's 'lines' route), Esc cancels. Its tile lives in the palette.
  ['line', 'L', '⚡', 'Power line', false],
];

const root = document.getElementById('he-root');
root.className = 'he-root';
root.innerHTML = `
  <div class="he-ribbon" id="he-ribbon"></div>
  <div class="he-body">
    <div class="he-left">
      <div class="he-panel he-panel--fill" data-panel="palette">
        <div class="he-panel__head">Add to the hole</div>
        <div class="he-panel__body he-panel__body--flush" id="he-palette"></div>
      </div>
    </div>
    <div class="he-canvas-wrap">
      <canvas id="he-canvas"></canvas>
      <div class="he-canvas-top">
        <div class="he-layers" id="he-layers"></div>
        <button type="button" class="he-chip" id="he-legend-btn" title="Colour key">Key</button>
        <div class="he-legend" id="he-legend" hidden></div>
      </div>
      <div class="he-canvas-controls">
        <input type="range" id="he-zoom" min="0" max="100" value="50" />
        <button class="he-tool" id="he-fit" style="flex:none;width:auto;padding:2px 10px;">Fit</button>
      </div>
      <div class="he-hover-readout" id="he-hover">Width at cursor: -</div>
    </div>
    <div class="he-right">
      <div class="he-panel" data-panel="context">
        <div class="he-panel__head">Selection</div>
        <div class="he-panel__body" id="he-context"></div>
      </div>
      <div class="he-panel" data-panel="hole">
        <div class="he-panel__head">Hole</div>
        <div class="he-panel__body" id="he-hole"></div>
      </div>
      <div class="he-panel collapsed" data-panel="course">
        <div class="he-panel__head">Course &amp; saving</div>
        <div class="he-panel__body" id="he-course"></div>
      </div>
    </div>
  </div>
  <div class="he-bottom">
    <div class="he-totals">
      <span id="he-totals-text"></span>
      <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-discard-all">Discard ALL edits</button>
    </div>
    <div class="he-strip" id="he-strip"></div>
  </div>
`;

// --- collapsible panels (section 4: "clicking [a header] collapses to the header") ---------------
const UI_KEY = 'golf.holeEditor.ui.v1';
function loadUiState() { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } }
function saveUiState(s) { try { localStorage.setItem(UI_KEY, JSON.stringify(s)); } catch { /* best effort */ } }
const uiState = loadUiState();
for (const panel of root.querySelectorAll('.he-panel')) {
  const key = panel.dataset.panel;
  if (uiState[key] === true) panel.classList.add('collapsed');
  else if (uiState[key] === false) panel.classList.remove('collapsed');
  panel.querySelector('.he-panel__head').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    uiState[key] = panel.classList.contains('collapsed');
    saveUiState(uiState);
  });
}

// --- document + editor state -----------------------------------------------------------------
// WHICH COURSE (2026-09-22): Red Mesa by default, the blank Course Creator on `?course=new`.
const profile = resolveProfile();
document.title = profile.title;
const stored = loadDocument(localStorage.getItem(profile.storageKey));
setCourse(profile, stored && stored.course && stored.course.theme);
setEditorTheme(profile.custom ? ((stored && stored.course && stored.course.theme) || profile.theme) : profile.theme);
const originals = originalSpecs();
let doc = (stored && stored.courseId === profile.id) ? stored : null;
if (!doc) doc = createDocument();
const editorState = createEditorState(doc);
let currentId = doc.order[0];
let currentTool = 'select';
// Placement-time defaults for tools that need a choice BEFORE a click places anything (Tree's
// single/stand + type, Cross's kind/depth/over) - never persisted, purely a UI convenience.
let toolState = { treeMode: 'single', treePlantType: 0, crossKind: 'water', crossDepth: 22, crossOver: 8, slopeMode: 'preset',
  waterKind: 'water', decorKind: 'bench' };

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, serialiseDocument(doc)); } catch { /* best effort */ }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
  autosaver.touch();
}

// --- cloud drafts (drafts.js): the review copy, autosaved under the designer's player code ------
let cloudStatus = { state: 'idle' };
const autosaver = makeAutosaver({
  getDoc: () => doc,
  getJson: () => serialiseDocument(doc),
  getDesigner: designer,
  onStatus: (s) => { cloudStatus = s; paintCloudStatus(); },
});
function cloudStatusText() {
  const s = cloudStatus;
  if (s.state === 'saving') return 'Saving to cloud...';
  if (s.state === 'saved') return `Saved to cloud ${new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (s.state === 'error') return s.error === 'offline' ? 'Offline: saved on this device only' : `Cloud save failed (${s.error}); saved on this device`;
  if (s.state === 'nocode') return 'Enter your player code below to save to the cloud';
  return 'Saved on this device';
}
function paintCloudStatus() {
  const el = document.getElementById('he-cloud-status');
  if (el) el.textContent = cloudStatusText();
}

const layers = { ...DEFAULT_LAYERS };

// --- canvas ------------------------------------------------------------------------------------
const canvasEl = document.getElementById('he-canvas');
const editorCanvas = new EditorCanvas(canvasEl, layers);
new ResizeObserver(() => editorCanvas.resize()).observe(canvasEl.parentElement);

const zoomSlider = document.getElementById('he-zoom');
const hoverEl = document.getElementById('he-hover');
const PPY_MIN = 0.5; const PPY_MAX = 12;
function ppyToSlider(ppy) {
  const t = (Math.log(ppy) - Math.log(PPY_MIN)) / (Math.log(PPY_MAX) - Math.log(PPY_MIN));
  return Math.round(t * 100);
}
function sliderToPpy(v) {
  const t = v / 100;
  return Math.exp(Math.log(PPY_MIN) + t * (Math.log(PPY_MAX) - Math.log(PPY_MIN)));
}
zoomSlider.addEventListener('input', () => editorCanvas.setZoom(sliderToPpy(+zoomSlider.value)));
editorCanvas.onZoomChange = (ppy) => { zoomSlider.value = ppyToSlider(ppy); };
// The slider mirrors the camera, so it has to be told whenever the camera changes without it:
// boot, a hole switch (each hole remembers its own zoom), Fit, and the +/- keys. It used to sit
// at its HTML default of 50 until the first wheel event (2026-09-16 review).
function syncZoomSlider() { if (editorCanvas.camera) zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy); }
document.getElementById('he-fit').addEventListener('click', () => {
  editorCanvas.fit();
  zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy);
});
let lastWidthAtCursor = '-';
function widthAtCursorText(w) {
  if (!w) return '-';
  // section 5.4: nearest station of the built route, cast both ways to the fairway's own edges.
  const st = editorCanvas.stations;
  if (!st.length) return '-';
  let best = st[0]; let bestD = Infinity;
  for (const p of st) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bestD) { bestD = d; best = p; } }
  const edges = fairwayEdgesAt(editorCanvas.built, best.x, best.y, best.nx, best.ny);
  if (edges.left == null || edges.right == null) return '-';
  return `${(edges.left + edges.right).toFixed(1)} yd (fairway)`;
}
editorCanvas.onHoverChange = (w) => {
  lastWidthAtCursor = widthAtCursorText(w);
  // Matt (2026-09-16): "add a 'distance from tee' value ... I want this to update as i move my
  // cursor around too." Straight-line yards from the tee to the cursor, the way a golfer reads it.
  const fromTee = w && editorCanvas.built ? `${Math.hypot(w.x - editorCanvas.built.tee[0], w.y - editorCanvas.built.tee[1]).toFixed(1)} yd` : '-';
  hoverEl.textContent = `From tee: ${fromTee}\nWidth at cursor: ${lastWidthAtCursor}`;
  const holeField = document.getElementById('he-h-widthcursor');
  if (holeField) holeField.textContent = lastWidthAtCursor;
};

// --- ribbon --------------------------------------------------------------------------------
const ribbon = document.getElementById('he-ribbon');
ribbon.innerHTML = [
  ...TOOLS.filter((t) => t[4]).map(([id, key, icon, label]) => `<button class="he-tool" data-tool="${id}" title="${label} (${key})"><span class="he-tool-icon">${icon}</span><span class="he-tool-label">${label}</span></button>`),
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-undo" title="Undo (Ctrl+Z)"><span class="he-tool-icon">↶</span><span class="he-tool-label">Undo</span></button>',
  '<button class="he-tool" id="he-redo" title="Redo (Ctrl+Y)"><span class="he-tool-icon">↷</span><span class="he-tool-label">Redo</span></button>',
  '<button class="he-tool" id="he-duplicate" title="Duplicate the selected object (D)"><span class="he-tool-icon">⧉</span><span class="he-tool-label">Duplicate</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-validate" title="Validate"><span class="he-tool-icon">✓</span><span class="he-tool-label">Validate</span></button>',
  '<button class="he-tool" id="he-compare" title="Compare"><span class="he-tool-icon">⇄</span><span class="he-tool-label">Compare</span></button>',
  '<button class="he-tool" id="he-reset" title="Reset hole"><span class="he-tool-icon">↺</span><span class="he-tool-label">Reset hole</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-export" title="Export (Ctrl+E)"><span class="he-tool-icon">⤓</span><span class="he-tool-label">Export</span></button>',
  '<button class="he-tool" id="he-play" title="Play this hole" style="width:auto;padding:0 8px;"><span class="he-tool-icon">▶</span><span class="he-tool-label">Play</span></button>',
  '<button class="he-tool" id="he-copy-json" title="Copy JSON" style="width:auto;padding:0 8px;"><span class="he-tool-icon">{}</span><span class="he-tool-label">Copy JSON</span></button>',
].join('');

const TOOL_KEYS = Object.fromEntries(TOOLS.map(([id, key]) => [key.toLowerCase(), id]));

function setTool(id) {
  // Leaving the Power line tool mid-line abandons that line, exactly as Esc would.
  if (currentTool === 'line' && id !== 'line' && editorCanvas.drawing && editorCanvas.drawing.group === 'lines') editorCanvas.cancelDraw();
  currentTool = id;
  for (const btn of ribbon.querySelectorAll('[data-tool]')) btn.setAttribute('aria-pressed', String(btn.dataset.tool === id));
  editorCanvas.setTool(id);
  // THE POWER LINE TOOL IS THE DRAWING FLOW. Selecting it (its palette tile, or the L key) starts a
  // line; the canvas's own click-points / Enter / Esc handling does the rest.
  if (id === 'line' && !(editorCanvas.drawing && editorCanvas.drawing.group === 'lines')) editOps.startDraw('lines', null);
  refreshContext();
  refreshPalette();
}

// --- the palette (palette.js): pictures of everything that can be added --------------------------
function refreshPalette() {
  const el = document.getElementById('he-palette');
  if (!el) return;
  const spec = doc.holes[currentId].spec;
  renderPalette(el, {
    built: getBuilt(currentId),
    theme: profile.custom ? ((doc.course && doc.course.theme) || profile.theme) : profile.theme,
    active: activeItemFor(currentTool, toolState, editorCanvas.drawing),
    guardsOn: spec.guard || [],
    onPick: (item) => {
      if (item.kind === 'guard') {
        editOps.instant((s) => editOps.mutators.toggleGuard(s, item.token, !(s.guard || []).includes(item.token)));
        return;
      }
      if (item.kind === 'draw') {
        editOps.startDraw(item.group, item.drawKind || null);
        refreshPalette();
        return;
      }
      toolState = { ...toolState, ...item.state };
      setTool(item.tool);
    },
  });
}
for (const btn of ribbon.querySelectorAll('[data-tool]')) btn.addEventListener('click', () => setTool(btn.dataset.tool));

// --- rendering the current hole into every panel ------------------------------------------------
// buildHole() (model.js) already caches per document/id and invalidates on spec or order change
// (section 3.3); nothing further to cache here.
function getBuilt(id) { return buildHole(doc, id); }

// section 7: never runs on its own. null until the Validate button is pressed for this hole;
// switching holes (but not editing this one further) clears it, since a stale list would point at
// another hole's problems.
let validateResults = null;

function onValidateRowClick(i) {
  const msg = validateResults[i];
  if (!msg) return;
  const pts = pointsInMessage(msg);
  if (!pts.length) return;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  editorCanvas.panTo(cx, cy, pts);
}

function refreshPanels() {
  const built = getBuilt(currentId);
  renderCoursePanel();
  renderHolePanel(document.getElementById('he-hole'), doc, currentId, built, editOps, lastWidthAtCursor, validateResults, onValidateRowClick);
  refreshPalette();
}

function refreshStrip() {
  renderBottomStrip(
    document.getElementById('he-totals-text'),
    document.getElementById('he-strip'),
    { doc, originals, currentId, getBuilt, onSelect: selectHole, onReorder: reorder },
  );
}

function selectHole(id) {
  if (id === currentId) return;
  currentId = id;
  validateResults = null;
  editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
  syncZoomSlider();
  refreshPanels();
  refreshStrip();
  refreshContext();
}

function reorder(draggedId, dropOnId) {
  pushUndo(editorState);
  const from = doc.order.indexOf(draggedId);
  const to = doc.order.indexOf(dropOnId);
  doc.order.splice(from, 1);
  doc.order.splice(to, 0, draggedId);
  afterChange();
}

// THE CANVAS REDRAWS ON EVERY EVENT; THE PANELS AND THE STRIP REDRAW ONCE PER FRAME. A drag fires
// pointermove far faster than the screen can paint, and every one of them used to rebuild the
// Hole panel, the Objects list, the 18-thumbnail strip AND the context panel synchronously -
// measured as long tasks of 400-965 ms during a 20-step drag (2026-09-16, "very slow/delayed").
// During a live gesture the context panel is also left alone: the control being dragged already
// shows its own value, and re-rendering the panel underneath a slider mid-drag is how a drag gets
// dropped. It catches up at liveEnd(), which calls this with no gesture in flight.
// The rebuild itself (makeHole + buildMap + the tree expansion, ~30 ms a hole) is coalesced the
// same way: the spec is updated on every event, the picture once per frame. A mouse reports
// position 60-125 times a second; painting more often than the screen refreshes only queues work.
// A selection that no longer exists (its object was deleted, or an undo removed it, or a redo put
// the list back shorter) must be dropped BEFORE the context panel renders, or the panel reads
// `spec.bunkers[i]` of nothing and throws. Found in the 2026-09-16 review: place a bunker (which
// selects it), press Ctrl+Z, page error. The Delete key already cleared its own selection; this
// covers every other route to the same state.
function pruneSelection() {
  const sel = editorCanvas.selection;
  if (!sel) return;
  const spec = doc.holes[currentId].spec;
  let gone = false;
  if (sel.group === 'waypoint') gone = sel.index >= spec.path.length;
  else if (sel.group === 'widthHandle') gone = false;
  else if (sel.group === 'guard') gone = !(spec.guard || []).length;
  else gone = !Array.isArray(spec[sel.group]) || sel.index >= spec[sel.group].length;
  if (gone) { editorCanvas.selection = null; }
}

let refreshQueued = false;
function afterChange({ keepContext = false } = {}) {
  scheduleSave();
  // An undo can take the current hole away (Course Creator: undo of "add hole").
  if (!doc.holes[currentId]) {
    currentId = doc.order[0];
    editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
    syncZoomSlider();
  }
  const inGesture = liveBeforeSpec != null;
  if (!inGesture) {
    // An edit makes the last Validate list stale (it described the hole before the edit).
    validateResults = null;
    pruneSelection();
    editorCanvas.updateBuilt(getBuilt(currentId), doc.holes[currentId].spec);
    refreshPanels(); refreshStrip();
    // After a slider release the panel already shows the committed value; re-rendering it would
    // blur the slider and swallow the next arrow key.
    if (!keepContext) refreshContext();
    return;
  }
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    editorCanvas.updateBuilt(getBuilt(currentId), doc.holes[currentId].spec);
    refreshPanels();
    refreshStrip();
  });
}

// --- the edit-ops bridge (section 3.5's undo rule, applied uniformly) ---------------------------
// `instant`: one push, one mutation, right now (a click placement, a checkbox, a reroll button).
// `liveBegin`/`liveUpdate`/`liveEnd`: a drag or a slider - live-previewed with no undo pushes, then
// ONE push of the PRE-drag state at the end, so the whole gesture undoes in one step.
let liveBeforeSpec = null;
const editOps = {
  mutators: MUTATORS,
  getTreeMode: () => toolState.treeMode,
  getTreePlantType: () => toolState.treePlantType,
  getCrossKind: () => toolState.crossKind,
  getCrossDepth: () => toolState.crossDepth,
  instant(mutateFn) {
    pushUndo(editorState);
    doc.holes[currentId].spec = mutateFn(doc.holes[currentId].spec, getBuilt(currentId));
    afterChange();
  },
  liveBegin() { liveBeforeSpec = doc.holes[currentId].spec; },
  liveUpdate(mutateFn) {
    doc.holes[currentId].spec = mutateFn(doc.holes[currentId].spec, getBuilt(currentId));
    afterChange();
  },
  liveEnd() {
    if (liveBeforeSpec == null) return;
    const finalSpec = doc.holes[currentId].spec;
    doc.holes[currentId].spec = liveBeforeSpec;
    pushUndo(editorState);
    doc.holes[currentId].spec = finalSpec;
    liveBeforeSpec = null;
    afterChange({ keepContext: true });
  },
  getCrossOver: () => toolState.crossOver,
  getBunkerKind: () => toolState.bunkerKind || 'auto',
  // 'water' or 'swamp' - the same list, two surfaces (docs/HANDOFF-GOLF-OBJECTS.md section 2).
  getWaterKind: () => toolState.waterKind || 'water',
  // 'bench' | 'sign' | 'flagpole' - which sprite the Decor tool drops next.
  getDecorKind: () => toolState.decorKind || 'bench',
  /** Draw a new bunker/lake outline, or redraw an existing one (Matt: "can i draw shapes?"). */
  startDraw(group, kind, replaceIndex = null) { editorCanvas.startDraw(group, kind, replaceIndex); },
  undoDrawPoint() { editorCanvas.undoDrawPoint(); },
  cancelDraw() { editorCanvas.cancelDraw(); },
  /** Turn the green's guard tokens into editable bunkers / lakes / trees (model.js detachGuards). */
  detachGuards() {
    const slot = doc.order.indexOf(currentId) + 1;
    editorCanvas.selection = null;
    editOps.instant((s) => detachGuards(s, slot));
  },
  slot: () => doc.order.indexOf(currentId) + 1,
  /** Green panel "Add pin": the next click inside the green places one. */
  armPin() { editorCanvas.placingPin = true; editorCanvas.el.style.cursor = 'crosshair'; },
};
editorCanvas.ops = editOps;

// Duplicate (ribbon + D): the selected bunker / lake / tree / stand / cross, 12 yd further up the
// hole, and the copy becomes the selection so it can be dragged straight away.
const DUPLICABLE = ['bunkers', 'water', 'trees', 'sentinels', 'cross', 'decor', 'lines'];
function duplicateSelected() {
  const sel = editorCanvas.selection;
  if (!sel || !DUPLICABLE.includes(sel.group)) return;
  editOps.instant((s) => duplicateObject(s, sel.group, sel.index));
  editorCanvas.setSelection({ group: sel.group, index: doc.holes[currentId].spec[sel.group].length - 1 });
}
document.getElementById('he-duplicate').addEventListener('click', duplicateSelected);
editorCanvas.onDrawChange = () => refreshContext();

const contextHeadEl = document.querySelector('[data-panel="context"] .he-panel__head');
function refreshContext() {
  const sel = editorCanvas.selection;
  const toolName = TOOLS.find(([id]) => id === currentTool)?.[3] || 'Tool';
  contextHeadEl.textContent = editorCanvas.drawing ? 'Drawing' : (sel && currentTool === 'select') ? 'Selected' : toolName;
  renderContextPanel(document.getElementById('he-context'), {
    tool: currentTool,
    spec: doc.holes[currentId].spec,
    built: getBuilt(currentId),
    selection: editorCanvas.selection,
    drawing: editorCanvas.drawing,
    ops: editOps,
    toolState,
    setToolState(patch) { toolState = { ...toolState, ...patch }; refreshContext(); },
    refresh: refreshContext,
  });
}
editorCanvas.onSelectionChange = () => refreshContext();

// Undo/redo restore the WHOLE document, including `order` - the current hole may have moved, and
// any selection may point at an object that is gone (pruneSelection, in afterChange, handles it).
document.getElementById('he-undo').addEventListener('click', () => { if (undo(editorState)) afterChange(); });
document.getElementById('he-redo').addEventListener('click', () => { if (redo(editorState)) afterChange(); });

// --- Validate / Compare / Reset (section 7) -----------------------------------------------
document.getElementById('he-validate').addEventListener('click', () => {
  const entry = doc.holes[currentId];
  validateResults = entry.broken ? [entry.broken] : validateHole(getBuilt(currentId));
  refreshPanels();
});

document.getElementById('he-compare').addEventListener('click', () => {
  openCompareModal({
    originalBuilt: originals[currentId] ? buildOriginalHole(currentId, originals) : getBuilt(currentId),
    currentBuilt: getBuilt(currentId),
    slot: doc.order.indexOf(currentId) + 1,
    id: currentId,
  });
});

document.getElementById('he-export').addEventListener('click', () => {
  const src = generateSource(doc);
  const blob = new Blob([src], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportFileName(doc);
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('he-copy-json').addEventListener('click', () => {
  navigator.clipboard?.writeText(generateJSON(doc));
});

// section 9 (phase 2): opens the game itself, reading this exact document from localStorage.
// Saving is normally debounced 300ms, so a click right after an edit could otherwise open the
// game on the PREVIOUS save - flush immediately first so Play always reflects what is on screen.
document.getElementById('he-play').addEventListener('click', () => {
  saveNow();
  window.open(profile.custom ? '../golf/?editor=custom' : '../golf/?editor=1', '_blank');
});

// section 3.6: "Discard ALL edits" - confirm, then the fresh (unedited) document, whole course.
document.getElementById('he-discard-all').addEventListener('click', () => {
  if (!window.confirm(profile.custom
    ? 'Discard ALL edits on every hole and start over from the blank course? This cannot be undone.'
    : 'Discard ALL edits on every hole and start over from the original Red Mesa? This cannot be undone.')) return;
  replaceDocument(createDocument());
});

/** Swap in a whole new document (discard, a loaded draft, an imported file): state, camera,
 *  every panel, and the model's defaults for its theme. */
function replaceDocument(next) {
  doc = next;
  setCourse(profile, doc.course && doc.course.theme);
  setEditorTheme(profile.custom ? ((doc.course && doc.course.theme) || profile.theme) : profile.theme);
  invalidateBuilds(doc);
  editorState.doc = doc;
  editorState.undo = [];
  editorState.redo = [];
  currentId = doc.order[0];
  validateResults = null;
  editorCanvas.cameras.clear();
  editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
  syncZoomSlider();
  refreshPanels();
  refreshStrip();
  refreshContext();
  scheduleSave();
}

// --- the Course panel (2026-09-22) ---------------------------------------------------------------
// Course Creator: name, theme, hole count. Both editors: who is designing (player code), the
// cloud status, other people's drafts to review, an import and a backup download.
function renderCoursePanel() {
  const el = document.getElementById('he-course');
  if (!el) return;
  const who = designer();
  const c = doc.course || {};
  el.innerHTML = `
    ${profile.custom ? `
    <div class="he-field">
      <span class="he-field__label">Course name</span>
      <input type="text" id="he-c-name" value="${escHtml(c.name || '')}" maxlength="40" style="width:100%;" />
    </div>
    <div class="he-field">
      <span class="he-field__label">Look</span>
      <div class="gh-seg" data-seg="theme" role="group">
        <button type="button" class="gh-seg__item" data-val="parkland" aria-pressed="${c.theme !== 'desert'}">Parkland</button>
        <button type="button" class="gh-seg__item" data-val="desert" aria-pressed="${c.theme === 'desert'}">Desert</button>
      </div>
    </div>
    <div class="he-field">
      <span class="he-field__label">Holes: ${doc.order.length}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="gh-btn gh-btn--sm" id="he-c-add">+ Add hole</button>
        <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-c-del">Delete this hole</button>
      </div>
    </div>` : ''}
    <div class="he-field">
      <span class="he-field__label">Designer</span>
      ${who
        ? `<span class="he-field__value">${escHtml(who.name)} &middot; ${who.code}</span>${who.fromProfile ? '' : ' <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-c-forget">Change</button>'}`
        : `<div style="display:flex;gap:6px;flex-wrap:wrap;">
            <input type="text" id="he-c-code" placeholder="Player code (5 letters)" maxlength="5" style="width:11em;text-transform:uppercase;" />
            <input type="text" id="he-c-who" placeholder="Your name" maxlength="40" style="width:11em;" />
            <button class="gh-btn gh-btn--sm" id="he-c-login">Use this code</button>
          </div>
          <span class="he-empty">Your code is on your Game Hub profile page.</span>`}
    </div>
    <div class="he-field"><span class="he-field__value" id="he-cloud-status">${escHtml(cloudStatusText())}</span></div>
    <div class="he-field" style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="gh-btn gh-btn--sm" id="he-c-drafts">Open a draft...</button>
      <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-c-import">Import file...</button>
      <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-c-backup">Download backup</button>
      <input type="file" id="he-c-file" accept=".json,.txt,application/json" style="display:none;" />
    </div>`;
  if (profile.custom) {
    el.querySelector('#he-c-name').addEventListener('change', (e) => { doc.course = setCourseMeta(doc, { name: e.target.value.trim() || 'My Course' }).course; refreshStrip(); scheduleSave(); });
    for (const b of el.querySelectorAll('[data-seg="theme"] .gh-seg__item')) {
      b.addEventListener('click', () => {
        const theme = b.dataset.val;
        if ((doc.course && doc.course.theme) === theme) return;
        doc.course = setCourseMeta(doc, { theme }).course;
        setCourse(profile, theme);
        setEditorTheme(theme);
        invalidateBuilds(doc);
        editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
        afterChange();
      });
    }
    el.querySelector('#he-c-add').addEventListener('click', () => {
      pushUndo(editorState);
      const next = addHole(doc);
      doc.order = next.order; doc.holes = next.holes;
      afterChange();
      selectHole(doc.order[doc.order.length - 1]);
    });
    el.querySelector('#he-c-del').addEventListener('click', () => {
      if (doc.order.length <= 3) { window.alert('A course keeps at least three holes.'); return; }
      if (!window.confirm(`Delete hole ${doc.order.indexOf(currentId) + 1} (${currentId})? Undo brings it back.`)) return;
      pushUndo(editorState);
      const next = deleteHole(doc, currentId);
      doc.order = next.order; doc.holes = next.holes;
      afterChange();
    });
  }
  const login = el.querySelector('#he-c-login');
  if (login) login.addEventListener('click', () => {
    const code = rememberDesigner(el.querySelector('#he-c-code').value, el.querySelector('#he-c-who').value);
    if (!code) { window.alert('That is not a player code. It is 5 letters/numbers, on your Game Hub profile page.'); return; }
    renderCoursePanel();
    autosaver.touch();
  });
  const forget = el.querySelector('#he-c-forget');
  if (forget) forget.addEventListener('click', () => { forgetDesigner(); cloudStatus = { state: 'idle' }; renderCoursePanel(); });
  el.querySelector('#he-c-drafts').addEventListener('click', openDraftsModal);
  el.querySelector('#he-c-import').addEventListener('click', () => el.querySelector('#he-c-file').click());
  el.querySelector('#he-c-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    importDocumentText(await f.text(), f.name);
    e.target.value = '';
  });
  el.querySelector('#he-c-backup').addEventListener('click', () => {
    const blob = new Blob([serialiseDocument(doc)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${profile.custom ? ((doc.course && doc.course.name) || 'course').replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'redmesa'}-draft.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

/** A document from text (a backup file, a draft, Copy JSON output). Refuses anything that is not
 *  this editor's course, with the reason on screen. */
function importDocumentText(text, label) {
  const next = loadDocument(text);
  if (!next) { window.alert(`${label || 'That file'} is not a hole editor document (a "Download backup" file or a draft).`); return false; }
  if (next.courseId !== profile.id) {
    window.alert(next.courseId === 'custom'
      ? 'That is a Course Creator document. Open the editor with ?course=new to load it.'
      : 'That is a Red Mesa document. Open the plain editor link to load it.');
    return false;
  }
  if (!window.confirm(`Replace everything in this editor with ${label || 'this document'}? Your current work here is overwritten (the cloud copy is not, until you edit).`)) return false;
  replaceDocument(next);
  return true;
}

/** Every draft in the cloud for THIS editor's course, newest first, with a Load button each. */
async function openDraftsModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:1000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border-radius:10px;padding:20px;min-width:520px;max-width:760px;max-height:80vh;overflow:auto;display:flex;flex-direction:column;gap:12px;color:#e8e8e8;font:14px sans-serif;';
  box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font:600 15px sans-serif;">Drafts in the cloud</div><button class="gh-btn gh-btn--sm" id="he-drafts-close">Close</button></div><div id="he-drafts-list">Loading...</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  box.querySelector('#he-drafts-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const list = box.querySelector('#he-drafts-list');
  let drafts = null;
  try { drafts = await listDrafts(); } catch (err) { console.warn('[drafts] list failed', err); }
  if (!drafts) { list.textContent = 'Could not reach the cloud.'; return; }
  const mine = drafts.filter((d) => d.courseId === profile.id);
  const other = drafts.length - mine.length;
  if (!mine.length) { list.innerHTML = `<span class="he-empty">No ${profile.custom ? 'Course Creator' : 'Red Mesa'} drafts yet.${other ? ` (${other} in the other editor.)` : ''}</span>`; return; }
  list.innerHTML = `<table style="border-collapse:collapse;width:100%;">${mine.map((d, i) => `<tr style="border-top:1px solid rgba(255,255,255,.12);">
      <td style="padding:8px 6px;"><b>${escHtml(d.name)}</b><br><span class="he-empty">${d.holes} holes${d.theme ? ` &middot; ${escHtml(d.theme)}` : ''}</span></td>
      <td style="padding:8px 6px;">${escHtml(d.by.name || d.code)}<br><span class="he-empty">${escHtml(d.code)}</span></td>
      <td style="padding:8px 6px;white-space:nowrap;">${d.updatedAt ? new Date(d.updatedAt).toLocaleString() : ''}</td>
      <td style="padding:8px 6px;"><button class="gh-btn gh-btn--sm" data-load="${i}">Load</button></td>
    </tr>`).join('')}</table>${other ? `<div class="he-empty" style="margin-top:8px;">${other} more in the other editor.</div>` : ''}`;
  for (const b of list.querySelectorAll('[data-load]')) {
    b.addEventListener('click', async () => {
      const d = mine[+b.dataset.load];
      b.disabled = true; b.textContent = 'Loading...';
      const json = await fetchDraft(d.code, d.courseId);
      if (!json) { b.textContent = 'Not found'; return; }
      if (importDocumentText(json, `${d.by.name || d.code}'s "${d.name}"`)) close(); else { b.disabled = false; b.textContent = 'Load'; }
    });
  }
}

document.getElementById('he-reset').addEventListener('click', () => {
  if (!window.confirm(`Reset ${currentId} to its original design? This cannot be undone by anything but Undo.`)) return;
  pushUndo(editorState);
  const slot = doc.order.indexOf(currentId) + 1;
  doc.holes[currentId].spec = originals[currentId] ? JSON.parse(JSON.stringify(originals[currentId])) : normalise(starterSpec(slot), slot);
  validateResults = null;
  afterChange();
});

renderLegend(document.getElementById('he-legend'));
renderLayers(document.getElementById('he-layers'), layers, () => editorCanvas.draw());
{
  const btn = document.getElementById('he-legend-btn'); const box = document.getElementById('he-legend');
  btn.addEventListener('click', () => { box.hidden = !box.hidden; btn.setAttribute('aria-pressed', String(!box.hidden)); });
}

// --- keyboard (section 4.1) ----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (undo(editorState)) afterChange(); return; }
  if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); if (redo(editorState)) afterChange(); return; }
  if (e.key === 'f' || e.key === 'F') { editorCanvas.fit(); zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy); return; }
  if (e.key === '+' || e.key === '=') { editorCanvas.zoomBy(1.1); zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy); return; }
  if (e.key === '-' || e.key === '_') { editorCanvas.zoomBy(1 / 1.1); zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy); return; }
  if (e.key === '[') { const i = doc.order.indexOf(currentId); selectHole(doc.order[(i - 1 + HOLE_COUNT) % HOLE_COUNT]); return; }
  if (e.key === ']') { const i = doc.order.indexOf(currentId); selectHole(doc.order[(i + 1) % HOLE_COUNT]); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); document.getElementById('he-export').click(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'd') { duplicateSelected(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) { setTool(TOOL_KEYS[e.key.toLowerCase()]); }
});

// A debug seam, not a feature: lets a Playwright check (or Matt, in devtools) read live state
// without a second copy of it. Nothing reads this at runtime.
window.__he = { get doc() { return doc; }, get currentId() { return currentId; }, get validateResults() { return validateResults; }, editorCanvas, getBuilt };

// --- boot ---------------------------------------------------------------------------------
window.addEventListener('beforeunload', saveNow);
editorCanvas.resize();
editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
syncZoomSlider();
refreshPanels();
refreshStrip();
setTool(currentTool);
