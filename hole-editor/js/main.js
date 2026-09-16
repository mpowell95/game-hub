// hole-editor/js/main.js - boot, layout, keyboard, tool switching. Step 3: the canvas, thumbnails,
// hole switching and reorder are wired end to end; the 11 tools (section 6) are step 4, so their
// ribbon buttons render but are disabled here.

import {
  createDocument, buildHole, originalSpecs, HOLE_COUNT,
  createEditorState, pushUndo, undo, redo,
  serialiseDocument, loadDocument, STORAGE_KEY,
} from './model.js';
import { EditorCanvas } from './canvas.js';
import { renderLegend, renderLayers, DEFAULT_LAYERS, renderHolePanel, renderObjectsList, renderBottomStrip } from './panels.js';

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
    <div class="he-totals" id="he-totals"></div>
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

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, serialiseDocument(doc)); } catch { /* best effort */ }
  }, 300);
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
document.getElementById('he-fit').addEventListener('click', () => {
  editorCanvas.fit();
  zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy);
});
editorCanvas.onHoverChange = (w) => {
  // Section 5.4's exact "width at cursor" (nearest fairway edge crossing) lands with the Width
  // tool in step 4; for now this just proves the camera's world coordinates are right.
  hoverEl.textContent = w ? `x ${w.x.toFixed(1)}, y ${w.y.toFixed(1)}` : 'Width at cursor: -';
};

// --- ribbon --------------------------------------------------------------------------------
const ribbon = document.getElementById('he-ribbon');
ribbon.innerHTML = [
  ...TOOLS.map(([id, key, icon, label]) => `<button class="he-tool" data-tool="${id}" title="${label} (${key})" disabled><span class="he-tool-icon">${icon}</span><span class="he-tool-label">${label}</span></button>`),
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-undo" title="Undo (Ctrl+Z)"><span class="he-tool-icon">↶</span><span class="he-tool-label">Undo</span></button>',
  '<button class="he-tool" id="he-redo" title="Redo (Ctrl+Y)"><span class="he-tool-icon">↷</span><span class="he-tool-label">Redo</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-validate" title="Validate" disabled><span class="he-tool-icon">✓</span><span class="he-tool-label">Validate</span></button>',
  '<button class="he-tool" id="he-compare" title="Compare" disabled><span class="he-tool-icon">⇄</span><span class="he-tool-label">Compare</span></button>',
  '<button class="he-tool" id="he-reset" title="Reset hole" disabled><span class="he-tool-icon">↺</span><span class="he-tool-label">Reset hole</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-export" title="Export (Ctrl+E)" disabled><span class="he-tool-icon">⤓</span><span class="he-tool-label">Export</span></button>',
].join('');

// --- rendering the current hole into every panel ------------------------------------------------
// buildHole() (model.js) already caches per document/id and invalidates on spec or order change
// (section 3.3); nothing further to cache here.
function getBuilt(id) { return buildHole(doc, id); }

function refreshPanels() {
  const built = getBuilt(currentId);
  renderHolePanel(document.getElementById('he-hole'), doc, currentId, built);
  renderObjectsList(document.getElementById('he-objects'), doc, currentId, built);
}

function refreshStrip() {
  renderBottomStrip(
    document.getElementById('he-totals'),
    document.getElementById('he-strip'),
    { doc, originals, currentId, getBuilt, onSelect: selectHole, onReorder: reorder },
  );
}

function selectHole(id) {
  if (id === currentId) return;
  currentId = id;
  editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
  refreshPanels();
  refreshStrip();
}

function reorder(draggedId, dropOnId) {
  pushUndo(editorState);
  const from = doc.order.indexOf(draggedId);
  const to = doc.order.indexOf(dropOnId);
  doc.order.splice(from, 1);
  doc.order.splice(to, 0, draggedId);
  afterChange();
}

function afterChange() {
  editorCanvas.updateBuilt(getBuilt(currentId), doc.holes[currentId].spec);
  refreshPanels();
  refreshStrip();
  scheduleSave();
}

document.getElementById('he-undo').addEventListener('click', () => { if (undo(editorState)) afterChange(); });
document.getElementById('he-redo').addEventListener('click', () => { if (redo(editorState)) afterChange(); });

renderLegend(document.getElementById('he-legend'));
renderLayers(document.getElementById('he-layers'), layers, () => editorCanvas.draw());

// --- keyboard (the subset that already does something in step 3; the rest lands in step 6) ------
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (undo(editorState)) afterChange(); return; }
  if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); if (redo(editorState)) afterChange(); return; }
  if (e.key === 'f' || e.key === 'F') { editorCanvas.fit(); zoomSlider.value = ppyToSlider(editorCanvas.camera.ppy); return; }
  if (e.key === '[') { const i = doc.order.indexOf(currentId); selectHole(doc.order[(i - 1 + HOLE_COUNT) % HOLE_COUNT]); return; }
  if (e.key === ']') { const i = doc.order.indexOf(currentId); selectHole(doc.order[(i + 1) % HOLE_COUNT]); return; }
});

// --- boot ---------------------------------------------------------------------------------
editorCanvas.resize();
editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
refreshPanels();
refreshStrip();
