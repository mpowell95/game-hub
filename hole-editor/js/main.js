// hole-editor/js/main.js - boot, layout, keyboard, tool switching. Step 4 wires the 11 tools
// (section 6): ribbon buttons, keyboard shortcuts (V R W B H T L G S C M), and the edit-ops bridge
// between canvas.js's hit-testing/dragging and model.js's pure mutators (undo pushed once per
// instant action or once per drag/slider release - section 3.5).

import {
  createDocument, buildHole, originalSpecs, buildOriginalHole, HOLE_COUNT,
  createEditorState, pushUndo, undo, redo,
  serialiseDocument, loadDocument, STORAGE_KEY,
  setField,
  insertWaypoint, removeWaypoint, straightenPath, insertDogleg,
  setWidthPoint, insertWidthPoint, deleteWidthPoint, scaleWidth,
  addBunker, setBunkerField, rerollBunker, deleteBunker,
  addWater, setWaterField, rerollWater, deleteWater,
  addTree, setTreeField, deleteTree, addSentinel, setSentinelField, deleteSentinel,
  addCross, setCrossField, deleteCross, deleteObject,
  setBeltField, setGreenField, rerollGreen, toggleGuard,
  setSlopePreset, bakeSlopeToCells, setSlopeCell, flattenSlope,
} from './model.js';
import { EditorCanvas, fairwayEdgesAt } from './canvas.js';
import { renderLegend, renderLayers, DEFAULT_LAYERS, renderHolePanel, renderObjectsList, renderBottomStrip, renderContextPanel, pointsInMessage, openCompareModal } from './panels.js';
import { validateHole } from '../../golf/js/holes.js';
import { generateSource, generateJSON } from './export.js';

const MUTATORS = {
  setField,
  insertWaypoint, removeWaypoint, straightenPath, insertDogleg,
  setWidthPoint, insertWidthPoint, deleteWidthPoint, scaleWidth,
  addBunker, setBunkerField, rerollBunker, deleteBunker,
  addWater, setWaterField, rerollWater, deleteWater,
  addTree, setTreeField, deleteTree, addSentinel, setSentinelField, deleteSentinel,
  addCross, setCrossField, deleteCross, deleteObject,
  setBeltField, setGreenField, rerollGreen, toggleGuard,
  setSlopePreset, bakeSlopeToCells, setSlopeCell, flattenSlope,
};

const TOOLS = [
  ['select', 'V', '↖', 'Select'],
  ['route', 'R', '⤳', 'Route'],
  ['width', 'W', '↔', 'Width'],
  ['bunker', 'B', '●', 'Bunker'],
  ['water', 'H', '≈', 'Water'],
  ['tree', 'T', '♣', 'Tree'],
  ['belts', 'L', '‖', 'Belts'],
  ['green', 'G', '○', 'Green'],
  ['slope', 'S', '↗', 'Slope'],
  ['cross', 'C', '✖', 'Cross'],
  ['ruler', 'M', '⇲', 'Ruler'],
];

const root = document.getElementById('he-root');
root.className = 'he-root';
root.innerHTML = `
  <div class="he-ribbon" id="he-ribbon"></div>
  <div class="he-body">
    <div class="he-left">
      <div class="he-panel" data-panel="legend">
        <div class="he-panel__head">Legend</div>
        <div class="he-panel__body" id="he-legend"></div>
      </div>
      <div class="he-panel" data-panel="objects">
        <div class="he-panel__head">Objects</div>
        <div class="he-panel__body" id="he-objects"></div>
      </div>
    </div>
    <div class="he-canvas-wrap">
      <canvas id="he-canvas"></canvas>
      <div class="he-canvas-controls">
        <input type="range" id="he-zoom" min="0" max="100" value="50" />
        <button class="he-tool" id="he-fit" style="flex:none;width:auto;padding:2px 10px;">Fit</button>
      </div>
      <div class="he-hover-readout" id="he-hover">Width at cursor: -</div>
    </div>
    <div class="he-right">
      <div class="he-panel" data-panel="context">
        <div class="he-panel__head">Tool</div>
        <div class="he-panel__body" id="he-context"><span class="he-empty">Tools land in step 4.</span></div>
      </div>
      <div class="he-panel" data-panel="hole">
        <div class="he-panel__head">Hole</div>
        <div class="he-panel__body" id="he-hole"></div>
      </div>
      <div class="he-panel" data-panel="layers">
        <div class="he-panel__head">Layers</div>
        <div class="he-panel__body" id="he-layers"></div>
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
  if (uiState[key]) panel.classList.add('collapsed');
  panel.querySelector('.he-panel__head').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    uiState[key] = panel.classList.contains('collapsed');
    saveUiState(uiState);
  });
}

// --- document + editor state -----------------------------------------------------------------
const originals = originalSpecs();
let doc = loadDocument(localStorage.getItem(STORAGE_KEY));
if (!doc) doc = createDocument();
const editorState = createEditorState(doc);
let currentId = doc.order[0];
let currentTool = 'select';
// Placement-time defaults for tools that need a choice BEFORE a click places anything (Tree's
// single/stand + type, Cross's kind/depth/over) - never persisted, purely a UI convenience.
let toolState = { treeMode: 'single', treePlantType: 0, crossKind: 'water', crossDepth: 22, crossOver: 8, slopeMode: 'preset' };

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, serialiseDocument(doc)); } catch { /* best effort */ }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
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
  hoverEl.textContent = `Width at cursor: ${lastWidthAtCursor}`;
  const holeField = document.getElementById('he-h-widthcursor');
  if (holeField) holeField.textContent = lastWidthAtCursor;
};

// --- ribbon --------------------------------------------------------------------------------
const ribbon = document.getElementById('he-ribbon');
ribbon.innerHTML = [
  ...TOOLS.map(([id, key, icon, label]) => `<button class="he-tool" data-tool="${id}" title="${label} (${key})"><span class="he-tool-icon">${icon}</span><span class="he-tool-label">${label}</span></button>`),
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-undo" title="Undo (Ctrl+Z)"><span class="he-tool-icon">↶</span><span class="he-tool-label">Undo</span></button>',
  '<button class="he-tool" id="he-redo" title="Redo (Ctrl+Y)"><span class="he-tool-icon">↷</span><span class="he-tool-label">Redo</span></button>',
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
  currentTool = id;
  for (const btn of ribbon.querySelectorAll('[data-tool]')) btn.setAttribute('aria-pressed', String(btn.dataset.tool === id));
  editorCanvas.setTool(id);
  refreshContext();
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
  renderHolePanel(document.getElementById('he-hole'), doc, currentId, built, editOps, lastWidthAtCursor, validateResults, onValidateRowClick);
  renderObjectsList(document.getElementById('he-objects'), doc, currentId, built);
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
  else gone = !Array.isArray(spec[sel.group]) || sel.index >= spec[sel.group].length;
  if (gone) { editorCanvas.selection = null; }
}

let refreshQueued = false;
function afterChange({ keepContext = false } = {}) {
  scheduleSave();
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
};
editorCanvas.ops = editOps;

const contextHeadEl = document.querySelector('[data-panel="context"] .he-panel__head');
function refreshContext() {
  contextHeadEl.textContent = TOOLS.find(([id]) => id === currentTool)?.[3] || 'Tool';
  renderContextPanel(document.getElementById('he-context'), {
    tool: currentTool,
    spec: doc.holes[currentId].spec,
    built: getBuilt(currentId),
    selection: editorCanvas.selection,
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
    originalBuilt: buildOriginalHole(currentId, originals),
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
  a.download = 'redmesa.js';
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
  window.open('../golf/?editor=1', '_blank');
});

// section 3.6: "Discard ALL edits" - confirm, then the fresh (unedited) document, whole course.
document.getElementById('he-discard-all').addEventListener('click', () => {
  if (!window.confirm('Discard ALL edits on every hole and start over from the original Red Mesa? This cannot be undone.')) return;
  doc = createDocument();
  editorState.doc = doc;
  editorState.undo = [];
  editorState.redo = [];
  currentId = doc.order[0];
  validateResults = null;
  editorCanvas.cameras.clear();
  editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
  refreshPanels();
  refreshStrip();
  refreshContext();
  scheduleSave();
});

document.getElementById('he-reset').addEventListener('click', () => {
  if (!window.confirm(`Reset ${currentId} to its original design? This cannot be undone by anything but Undo.`)) return;
  pushUndo(editorState);
  doc.holes[currentId].spec = JSON.parse(JSON.stringify(originals[currentId]));
  validateResults = null;
  afterChange();
});

renderLegend(document.getElementById('he-legend'));
renderLayers(document.getElementById('he-layers'), layers, () => editorCanvas.draw());

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
  if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) { setTool(TOOL_KEYS[e.key.toLowerCase()]); }
});

// A debug seam, not a feature: lets a Playwright check (or Matt, in devtools) read live state
// without a second copy of it. Nothing reads this at runtime.
window.__he = { get doc() { return doc; }, get currentId() { return currentId; }, editorCanvas, getBuilt };

// --- boot ---------------------------------------------------------------------------------
window.addEventListener('beforeunload', saveNow);
editorCanvas.resize();
editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
syncZoomSlider();
refreshPanels();
refreshStrip();
setTool(currentTool);
