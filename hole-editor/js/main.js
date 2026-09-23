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
import { starterSpec, THEME_DEFAULTS } from './starter.js';
import { designer, rememberDesigner, forgetDesigner, makeAutosaver, listDrafts, fetchDraft } from './drafts.js';
import { EditorCanvas, fairwayEdgesAt, setEditorTheme, listObjects } from './canvas.js';
import { renderLegend, renderLayers, DEFAULT_LAYERS, renderHolePanel, renderBottomStrip, renderContextPanel, pointsInMessage, openCompareModal } from './panels.js';
import { renderPalette, activeItemFor } from './palette.js';
import { validateHole } from '../../golf/js/holes.js';
import { makeHole } from '../../golf/js/holegen.js';
import { buildMap } from '../../golf/js/render.js';
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
    <div class="he-sheet-scrim" id="he-m-scrim"></div>
    <div class="he-left">
      <div class="he-sheet-bar"><span>Add to the hole</span><button type="button" class="he-sheet-x" data-sheet-close aria-label="Close">&times;</button></div>
      <div class="he-panel he-panel--fill" data-panel="palette">
        <div class="he-panel__head">Add to the hole</div>
        <div class="he-panel__body he-panel__body--flush" id="he-palette"></div>
      </div>
    </div>
    <div class="he-canvas-wrap">
      <canvas id="he-canvas"></canvas>
      <div class="he-canvas-top">
        <button type="button" class="he-chip" id="he-layers-btn" title="Show or hide map layers" style="margin-left:auto;">Layers</button>
        <button type="button" class="he-chip" id="he-legend-btn" title="Colour key" style="margin-left:0;">Key</button>
        <div class="he-layers he-layers--pop" id="he-layers" hidden></div>
        <div class="he-legend" id="he-legend" hidden></div>
      </div>
      <div class="he-canvas-controls">
        <input type="range" id="he-zoom" min="0" max="100" value="50" />
        <button class="he-tool" id="he-fit" style="flex:none;width:auto;padding:2px 10px;">Fit</button>
      </div>
      <div class="he-hover-readout" id="he-hover">Width at cursor: -</div>
      <div class="he-drawbar" id="he-m-drawbar">
        <button type="button" class="he-mbtn" id="he-m-draw-undo">Undo point</button>
        <button type="button" class="he-mbtn" id="he-m-draw-cancel">Cancel</button>
        <button type="button" class="he-mbtn he-mbtn--add" id="he-m-draw-finish">Finish</button>
      </div>
    </div>
    <div class="he-right">
      <div class="he-sheet-bar"><span>Settings</span><span class="he-sheet-acts"><button type="button" class="he-mbtn he-mbtn--sm" id="he-m-dup" hidden>Duplicate</button><button type="button" class="he-mbtn he-mbtn--sm he-mbtn--danger" id="he-m-del" hidden>Delete</button></span><button type="button" class="he-sheet-x" data-sheet-close aria-label="Close">&times;</button></div>
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
      <button type="button" class="he-strip-toggle" id="he-strip-toggle" title="Hide or show the holes bar">&#9662; Hide holes</button>
    </div>
    <div class="he-strip" id="he-strip"></div>
  </div>
  <div class="he-mbar" id="he-mbar">
    <button type="button" class="he-mbtn he-mbtn--arrow" id="he-m-prev" aria-label="Previous hole">&#8249;</button>
    <select id="he-m-hole" aria-label="Hole"></select>
    <button type="button" class="he-mbtn he-mbtn--arrow" id="he-m-next" aria-label="Next hole">&#8250;</button>
    <button type="button" class="he-mbtn he-mbtn--add" id="he-m-add">+ Add</button>
    <button type="button" class="he-mbtn" id="he-m-edit">Edit</button>
  </div>
`;

// --- THE PHONE LAYOUT (2026-09-23, docs/HANDOFF-GOLF-COURSE-CREATOR-MOBILE.md) -------------------
// Under 900 px the same screen reflows: the palette and the inspector become bottom SHEETS, the
// holes bar becomes a hole picker (#he-mbar), and the ribbon folds behind a Tools button. Every
// phone-only element is display:none above the breakpoint and every rule lives in editor.css's
// one @media block, so the desktop editor is untouched. isPhone() gates the few behaviours that
// differ (a tile pick closes the Add sheet; a selection opens the Settings sheet).
const PHONE_MQ = window.matchMedia('(max-width: 899px)');
const isPhone = () => PHONE_MQ.matches;
function openSheet(which) {
  const left = root.querySelector('.he-left'); const right = root.querySelector('.he-right');
  left.classList.toggle('is-open', which === 'add');
  right.classList.toggle('is-open', which === 'edit');
  root.classList.toggle('he-root--sheet', which === 'add');   // the Edit sheet leaves the map live above it
  document.getElementById('he-m-add').setAttribute('aria-pressed', String(which === 'add'));
  document.getElementById('he-m-edit').setAttribute('aria-pressed', String(which === 'edit'));
}
const sheetOpen = () => (root.querySelector('.he-left.is-open') ? 'add' : root.querySelector('.he-right.is-open') ? 'edit' : null);
for (const x of root.querySelectorAll('[data-sheet-close]')) x.addEventListener('click', () => openSheet(null));
document.getElementById('he-m-scrim').addEventListener('click', () => openSheet(null));
document.getElementById('he-m-add').addEventListener('click', () => openSheet(sheetOpen() === 'add' ? null : 'add'));
document.getElementById('he-m-edit').addEventListener('click', () => openSheet(sheetOpen() === 'edit' ? null : 'edit'));
PHONE_MQ.addEventListener('change', () => { if (!isPhone()) { openSheet(null); refreshStrip(); } root.querySelector('.he-ribbon').classList.remove('is-open'); });

// --- collapsible panels (section 4: "clicking [a header] collapses to the header") ---------------
// Set by tour.js on the walkthrough's last step: Help becomes a topic menu, the first-visit nudge stops.
const TOUR_DONE = 'golf.holeEditor.tourDone.v1';
const tourDone = () => { try { return localStorage.getItem(TOUR_DONE) === '1'; } catch { return false; } };
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
// Practice starts from nothing every time.
if (profile.tutorial) { try { localStorage.removeItem(profile.storageKey); } catch { /* fine */ } }
const stored = loadDocument(localStorage.getItem(profile.storageKey));
// FIRST VISIT GOES STRAIGHT INTO THE WALKTHROUGH (Matt, 2026-09-23: "the link should auto open the
// help walkthrough the first time someone visits the site? then after that it just goes straight
// to the tool"). Only once per browser (`tourOffered`), only on the Course Creator, and never for
// someone who already has a named course here - they are past the first visit whatever the flag
// says. The walkthrough ends on "Start my course", which comes back to this link.
{
  const OFFERED = 'golf.holeEditor.tourOffered.v1';
  let offered = false; try { offered = localStorage.getItem(OFFERED) === '1'; } catch { offered = true; }
  const named = !!(stored && stored.course && stored.course.named);
  if (profile.custom && !profile.tutorial && !offered && !tourDone() && !named) {
    try { localStorage.setItem(OFFERED, '1'); } catch { /* fine */ }
    location.replace('./?course=tutorial&first=1');
    await new Promise(() => {});   // stop here; the page is leaving
  }
}
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
  getDesigner: () => (profile.tutorial ? null : designer()),   // practice never reaches the cloud
  onStatus: (s) => { cloudStatus = s; paintCloudStatus(); },
});
function cloudStatusText() {
  if (profile.tutorial) return 'Practice: nothing here is saved';
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
  ...(profile.custom ? ['<button class="he-tool" id="he-course-btn" title="Course name and terrain" style="flex:0 0 auto;width:auto;max-width:220px;padding:0 12px;border:2px solid #ffce3a;border-radius:8px;"><span class="he-tool-icon">\u26F3</span><span class="he-tool-label" id="he-course-btn-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;"></span></button>', '<div class="he-sep"></div>'] : []),
  ...TOOLS.filter((t) => t[4]).map(([id, key, icon, label]) => `<button class="he-tool" data-tool="${id}" title="${label} (${key})"><span class="he-tool-icon">${icon}</span><span class="he-tool-label">${label}</span></button>`),
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-undo" title="Undo (Ctrl+Z)"><span class="he-tool-icon">↶</span><span class="he-tool-label">Undo</span></button>',
  '<button class="he-tool" id="he-redo" title="Redo (Ctrl+Y)"><span class="he-tool-icon">↷</span><span class="he-tool-label">Redo</span></button>',
  // Phone only (display:none above 900 px): unfolds the rest of this ribbon as a grid.
  '<button class="he-tool" id="he-m-tools" title="All tools" aria-pressed="false"><span class="he-tool-icon">☰</span><span class="he-tool-label">Tools</span></button>',
  '<button class="he-tool" id="he-duplicate"title="Duplicate the selected object (D)"><span class="he-tool-icon">⧉</span><span class="he-tool-label">Duplicate</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-validate" title="Validate"><span class="he-tool-icon">✓</span><span class="he-tool-label">Validate</span></button>',
  '<button class="he-tool" id="he-compare" title="Compare"><span class="he-tool-icon">⇄</span><span class="he-tool-label">Compare</span></button>',
  '<button class="he-tool" id="he-reset" title="Reset hole"><span class="he-tool-icon">↺</span><span class="he-tool-label">Reset hole</span></button>',
  '<div class="he-sep"></div>',
  '<button class="he-tool" id="he-export" title="Export (Ctrl+E)"><span class="he-tool-icon">⤓</span><span class="he-tool-label">Export</span></button>',
  '<button class="he-tool" id="he-play" title="Play this hole" style="width:auto;padding:0 8px;"><span class="he-tool-icon">▶</span><span class="he-tool-label">Play</span></button>',
  // Copy JSON is a developer's button; the Course Creator has Download backup for the same job, and
  // the room it frees keeps Report bug and Help on screen at 1280 px (2026-09-23).
  '<button class="he-tool" id="he-copy-json" title="Copy JSON" style="width:auto;padding:0 8px;' + (profile.custom ? 'display:none;' : '') + '"><span class="he-tool-icon">{}</span><span class="he-tool-label">Copy JSON</span></button>',
  '<div class="he-sep"></div>',
  // Help (2026-09-22): hole-editor/help.html, plain words for someone who has never seen the tool.
  '<button class="he-tool" id="he-bug" title="Report a bug to Matt" style="width:auto;padding:0 8px;"><span class="he-tool-icon">\u{1F41E}</span><span class="he-tool-label">Report bug</span></button>',
  '<a class="he-tool" id="he-help" href="./?course=tutorial" target="_blank" rel="noopener" title="How to use the Course Creator" style="text-decoration:none;color:inherit;"><span class="he-tool-icon">?</span><span class="he-tool-label">Help</span></a>',
  // Phone only (in the Tools grid): the tools that are fiddly with a finger at any size.
  '<div class="he-m-note">Width handles, slope painting and drawn outlines are easier on a tablet or computer.</div>',
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
// THE PALETTE IS ONLY REBUILT WHEN WHAT IT SHOWS CHANGES (2026-09-23, Matt: "it's laggy"). It was
// rebuilt - ~75 tiles, each a canvas crop - on every refresh, which during a drag is every frame:
// measured ~30 ms of each ~120-230 ms drag frame. What a tile shows depends only on the look, the
// type table, the highlighted item and the green's guards, so that is the key.
let paletteKey = '';
function refreshPalette(force = false) {
  const el = document.getElementById('he-palette');
  if (!el) return;
  const spec = doc.holes[currentId].spec;
  const built = getBuilt(currentId);
  const theme = profile.custom ? ((doc.course && doc.course.theme) || profile.theme) : profile.theme;
  const active = activeItemFor(currentTool, toolState, editorCanvas.drawing);
  const key = [theme, active, (spec.guard || []).join(','), (built.treeTypes || []).map((t) => t.name).join(',')].join('|');
  if (!force && key === paletteKey && el.firstChild) return;
  paletteKey = key;
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
      // Phone: the Add sheet covers the map, so picking a thing to place puts the map back.
      if (isPhone()) openSheet(null);
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
// Phone: Tools unfolds the ribbon; picking anything in it folds it again.
{
  const toolsBtn = document.getElementById('he-m-tools');
  const setOpen = (open) => { ribbon.classList.toggle('is-open', open); toolsBtn.setAttribute('aria-pressed', String(open)); };
  toolsBtn.addEventListener('click', () => { const open = !ribbon.classList.contains('is-open'); if (open) openSheet(null); setOpen(open); });
  ribbon.addEventListener('click', (e) => {
    const b = e.target.closest('.he-tool');
    if (b && b !== toolsBtn && ribbon.classList.contains('is-open')) setOpen(false);
  });
}

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
  // The holes bar is display:none on a phone; painting its thumbnails there cost a map build per
  // edit for nothing (stage 5). It is painted when the screen widens (PHONE_MQ's change listener).
  if (isPhone()) { refreshHolePicker(); return; }
  renderBottomStrip(
    document.getElementById('he-totals-text'),
    document.getElementById('he-strip'),
    { doc, originals, currentId, getBuilt, onSelect: selectHole, onReorder: reorder },
  );
  refreshHolePicker();
}

// Phone: the holes bar is a picker (one option per hole) with previous / next arrows.
function refreshHolePicker() {
  const sel = document.getElementById('he-m-hole');
  if (!sel) return;
  sel.innerHTML = doc.order.map((id, i) => `<option value="${id}"${id === currentId ? ' selected' : ''}>Hole ${i + 1} · par ${doc.holes[id].spec.par}</option>`).join('');
}
document.getElementById('he-m-hole').addEventListener('change', (e) => selectHole(e.target.value));
for (const [bid, step] of [['he-m-prev', -1], ['he-m-next', 1]]) {
  document.getElementById(bid).addEventListener('click', () => {
    const i = doc.order.indexOf(currentId); const n = doc.order.length;
    selectHole(doc.order[(i + step + n) % n]);
  });
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
    // A FINGER DRAGGING ON THE MAP, ON A PHONE (stage 5, measured): rebuilding and repainting the
    // whole hole was ~160 ms a frame at 4x CPU throttle (buildMap ~70% of it). So the drag moves
    // only the object's outline over the unchanged map; liveEnd() rebuilds once when the finger
    // lifts. A mouse, and every slider, keep the full live rebuild.
    if (fingerDrag()) { editorCanvas.previewSpec(doc.holes[currentId].spec); return; }
    editorCanvas.updateBuilt(getBuilt(currentId), doc.holes[currentId].spec);
    // The holes bar is NOT redrawn mid-gesture (its thumbnail of this hole costs a map build a
    // frame); it catches up when the drag ends, which calls afterChange() with no gesture.
    refreshPanels();
  });
}

// --- the edit-ops bridge (section 3.5's undo rule, applied uniformly) ---------------------------
// `instant`: one push, one mutation, right now (a click placement, a checkbox, a reroll button).
// `liveBegin`/`liveUpdate`/`liveEnd`: a drag or a slider - live-previewed with no undo pushes, then
// ONE push of the PRE-drag state at the end, so the whole gesture undoes in one step.
let liveBeforeSpec = null;
const fingerDrag = () => isPhone() && !!editorCanvas.touchDragging;
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
    // No canvas drag reads the built hole (every liveUpdate there is (spec) => ...), so a finger
    // drag skips building it per frame too.
    doc.holes[currentId].spec = mutateFn(doc.holes[currentId].spec, fingerDrag() ? editorCanvas.built : getBuilt(currentId));
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

// --- PHONE: on-screen stand-ins for the keys (stage 3) -------------------------------------------
// Delete, D, Enter, Backspace and Esc do not exist on a phone. The Edit sheet's bar carries
// Duplicate and Delete for the selection; while drawing, a bar over the map carries Undo point,
// Cancel and Finish (with the point count). All of it is display:none above the phone breakpoint.
let wasDrawing = false;
function syncPhoneBars() {
  const sel = editorCanvas.selection;
  document.getElementById('he-m-del').hidden = !editorCanvas.canDeleteSelection();
  document.getElementById('he-m-dup').hidden = !(sel && DUPLICABLE.includes(sel.group));
  const d = editorCanvas.drawing;
  root.classList.toggle('he-root--drawing', !!d);
  if (d) {
    const n = d.points.length; const min = d.group === 'lines' ? 2 : 3;
    const fin = document.getElementById('he-m-draw-finish');
    fin.textContent = `Finish (${n})`; fin.disabled = n < min;
    document.getElementById('he-m-draw-undo').disabled = n === 0;
    if (!wasDrawing && isPhone()) openSheet(null);   // the map must be free to tap corners on
  }
  wasDrawing = !!d;
}
document.getElementById('he-m-del').addEventListener('click', () => { editorCanvas.deleteSelection(); openSheet(null); });
document.getElementById('he-m-dup').addEventListener('click', () => duplicateSelected());
document.getElementById('he-m-draw-undo').addEventListener('click', () => { editorCanvas.undoDrawPoint(); refreshContext(); });
document.getElementById('he-m-draw-cancel').addEventListener('click', () => editorCanvas.cancelDraw());
document.getElementById('he-m-draw-finish').addEventListener('click', () => editorCanvas.finishDraw());

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
  syncPhoneBars();
}
// Phone: the Edit sheet covers the bottom half of the map, so the thing just selected is moved up
// into the half that is still showing (only when the sheet would hide it).
function keepAboveSheet(sel) {
  const c = editorCanvas; const cam = c.camera;
  const o = cam && listObjects(c.spec, c.stations, c.length).find((x) => x.group === sel.group && x.index === sel.index);
  if (!o || !o.center) return;
  const cr = c.el.getBoundingClientRect();
  const top = root.querySelector('.he-right').getBoundingClientRect().top - cr.top;
  const y = c.toScreen(o.center[0], o.center[1]).y;
  if (y > top - 30) c.pan(0, top / 2 - y);
}
editorCanvas.onSelectionChange = () => {
  refreshContext();
  // Phone: selecting something opens its settings (the Selection panel, unfolded, on top).
  // Not mid-drag: a finger dragging an object must keep the map (stage 2).
  if (isPhone() && editorCanvas.selection && !editorCanvas.touchDragging && sheetOpen() !== 'edit') {
    root.querySelector('[data-panel="context"]').classList.remove('collapsed');
    openSheet('edit');
    keepAboveSheet(editorCanvas.selection);
  }
};

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
/** The Course Creator's looks: render.js THEMES + starter.js THEME_DEFAULTS, one row each. */
const LOOKS = [['parkland', 'Parkland'], ['desert', 'Desert'], ['links', 'Links'], ['tropical', 'Tropical'], ['mountain', 'Mountain'], ['swamp', 'Swamp']];
const LOOK_BLURB = {
  parkland: 'Green grass, pine woods', desert: 'Red sand, cactus', links: 'Seaside, gorse, dunes',
  tropical: 'Palms, lagoons', mountain: 'Spruce, glacial lakes', swamp: 'Willows, murky water',
};

/** Changing the terrain of a course already under way repaints EVERY hole and swaps the woods
 *  along each side for the new terrain's trees (placed objects keep their own type). It is not on
 *  the undo stack (snapshots hold holes, not course settings), but it destroys nothing: picking
 *  the old terrain again restores it exactly. So: a plain confirm, saying so. */
function confirmLookChange(theme) {
  if (!(doc.course && doc.course.named) || (doc.course.theme || 'parkland') === theme) return true;
  const label = (LOOKS.find(([v]) => v === theme) || [0, theme])[1];
  return window.confirm(`Change the terrain to ${label}? This changes EVERY hole at once: the colours, and the woods down each side become ${label} trees. Things you placed yourself stay put, and you can switch back to the old terrain any time to put it all back.`);
}

/** Switch the Course Creator's look: data, model defaults, canvas palette, rebuild. */
function applyLook(theme) {
  doc.course = setCourseMeta(doc, { theme }).course;
  setCourse(profile, theme);
  setEditorTheme(theme);
  invalidateBuilds(doc);
  editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
}

/** A small picture of each look. NOT the fairway: every look's fairway is nearly the same
 *  green, so a fairway-centred crop made six near-identical tiles (Matt, 2026-09-23: "why do all of
 *  these look the same?"). This is the edge of the hole instead - a pond, a bunker and the woods
 *  on that look's own ground - which is where the looks actually differ. */
const _lookPics = new Map();
function lookPicture(theme) {
  if (_lookPics.has(theme)) return _lookPics.get(theme);
  const d = THEME_DEFAULTS[theme];
  const sp = d.belts.left.type;
  const hole = makeHole({ ...d, ...starterSpec(1), n: 1,
    water: [{ yd: 200, side: 1, off: 24, rx: 11, ry: 7, seed: 3 }],
    bunkers: [{ yd: 186, side: -1, off: 2, r: 5, kind: 'fairwayBunker' }],
    trees: [{ yd: 214, side: 1, off: 14, type: sp }, { yd: 186, side: 1, off: 36, type: sp }, { yd: 210, side: 1, off: 44, type: sp }] });
  const m = buildMap(hole, theme);
  const W = 64, H = W * 150 / 320, cx = 24, cy = 200;   // yards shown, centred on the pond
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 150;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 320, 150);
  ctx.drawImage(m.canvas, (cx - W / 2 - m.minX) * m.ppy, (m.maxY - (cy + H / 2)) * m.ppy, W * m.ppy, H * m.ppy, 0, 0, 320, 150);
  const url = cv.toDataURL();
  _lookPics.set(theme, url);
  return url;
}

/** THE FIRST THING A DESIGNER DOES (Matt, 2026-09-23: "it's the first thing he should do - name
 *  the course and choose the terrain type"). Opens by itself on a Course Creator document that
 *  has never been through it (`course.named` unset), and from the ribbon's course button after. */
function openSetupModal() {
  if (document.getElementById('he-setup')) return;
  const c = doc.course || {};
  let pick = THEME_DEFAULTS[c.theme] ? c.theme : 'parkland';
  const who = profile.tutorial ? { name: 'practice' } : designer();
  const overlay = document.createElement('div');
  overlay.id = 'he-setup';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:1000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div class="he-setup-box" style="background:#1e211a;border-radius:14px;padding:24px 26px;width:760px;max-width:94vw;max-height:92vh;overflow:auto;color:#eceee4;font:15px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;">
      <div class="he-setup-head" style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font:700 22px system-ui,sans-serif;">Set up your course</div>
        ${!profile.tutorial && !tourDone() ? '<a href="./?course=tutorial" target="_blank" rel="noopener" class="gh-btn gh-btn--sm" style="margin-left:auto;margin-right:10px;background:#ffce3a;color:#1b1d14;text-decoration:none;">New here? Take the guided tour</a>' : ''}
        <button class="gh-btn gh-btn--sm gh-btn--ghost" id="he-setup-x" aria-label="Close">&times;</button>
      </div>
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-weight:600;">1. Course name</span>
        <input type="text" id="he-setup-name" maxlength="40" placeholder="e.g. King's Landing" value="${escHtml(c.name && c.name !== 'My Course' ? c.name : '')}" style="font-size:18px;padding:10px 12px;border-radius:8px;" />
      </label>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-weight:600;">2. Terrain</span>
        <div id="he-setup-looks" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          ${LOOKS.map(([val, label]) => `<button type="button" data-look="${val}" style="all:unset;cursor:pointer;border-radius:10px;overflow:hidden;background:#2a2e24;border:3px solid transparent;">
            <img src="${lookPicture(val)}" alt="" style="display:block;width:100%;height:auto;" />
            <div style="padding:6px 10px;"><div style="font-weight:700;">${label}</div><div style="font-size:13px;color:#b4b9a6;">${LOOK_BLURB[val]}</div></div>
          </button>`).join('')}
        </div>
      </div>
      ${who ? '' : `<div style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-weight:600;">3. Your player code <span style="font-weight:400;color:#b4b9a6;">(on your Game Hub profile page; your course saves under it)</span></span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input type="text" id="he-setup-code" placeholder="5 letters" maxlength="5" style="width:9em;text-transform:uppercase;font-size:16px;padding:8px 10px;border-radius:8px;" />
          <input type="text" id="he-setup-who" placeholder="Your name" maxlength="40" style="width:14em;font-size:16px;padding:8px 10px;border-radius:8px;" />
        </div>
      </div>`}
      <div class="he-setup-foot" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <span style="color:#b4b9a6;font-size:13px;">You can change all of this later with the course button at the top left.</span>
        <button class="gh-btn" id="he-setup-go" style="font-size:17px;padding:10px 22px;">Start designing</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const looksEl = overlay.querySelector('#he-setup-looks');
  const mark = () => { for (const b of looksEl.querySelectorAll('[data-look]')) b.style.borderColor = b.dataset.look === pick ? '#ffce3a' : 'transparent'; };
  mark();
  for (const b of looksEl.querySelectorAll('[data-look]')) b.addEventListener('click', () => { pick = b.dataset.look; mark(); });
  const nameEl = overlay.querySelector('#he-setup-name');
  setTimeout(() => nameEl.focus(), 0);
  const close = () => overlay.remove();
  overlay.querySelector('#he-setup-x').addEventListener('click', close);
  overlay.querySelector('#he-setup-go').addEventListener('click', () => {
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); nameEl.style.outline = '3px solid #e0532f'; nameEl.placeholder = 'Give your course a name first'; return; }
    const codeEl = overlay.querySelector('#he-setup-code');
    if (codeEl && codeEl.value.trim()) {
      if (!rememberDesigner(codeEl.value, overlay.querySelector('#he-setup-who').value)) {
        window.alert('That is not a player code. It is 5 letters/numbers, on your Game Hub profile page.'); return;
      }
      autosaver.touch();
    }
    if (pick !== (doc.course && doc.course.theme) && !confirmLookChange(pick)) return;
    pushUndo(editorState);
    if (pick !== (doc.course && doc.course.theme)) applyLook(pick);
    doc.course = setCourseMeta(doc, { name, named: true }).course;
    close();
    refreshStrip();
    afterChange();
  });
}

function renderCoursePanel() {
  const cb = document.getElementById('he-course-btn-label');
  if (cb) {
    const cc = doc.course || {};
    const look = (LOOKS.find(([v]) => v === cc.theme) || LOOKS[0])[1];
    cb.textContent = `${cc.named ? cc.name : 'Name your course'} \u00B7 ${look}`;
  }
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
      <div class="gh-seg" data-seg="theme" role="group" style="display:grid;grid-template-columns:1fr 1fr;">
        ${LOOKS.map(([val, label]) => `<button type="button" class="gh-seg__item" data-val="${val}" aria-pressed="${(THEME_DEFAULTS[c.theme] ? c.theme : 'parkland') === val}">${label}</button>`).join('')}
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
    el.querySelector('#he-c-name').addEventListener('change', (e) => { const nm = e.target.value.trim(); doc.course = setCourseMeta(doc, { name: nm || 'My Course', ...(nm ? { named: true } : {}) }).course; refreshStrip(); scheduleSave(); renderCoursePanel(); });
    for (const b of el.querySelectorAll('[data-seg="theme"] .gh-seg__item')) {
      b.addEventListener('click', () => {
        const theme = b.dataset.val;
        if ((doc.course && doc.course.theme) === theme) return;
        if (!confirmLookChange(theme)) { renderCoursePanel(); return; }
        applyLook(theme);
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
  box.className = 'he-modal-box he-drafts';
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
  // Key and Layers are two chips that each open their own pop-over; opening one closes the other.
  const pairs = [['he-legend-btn', 'he-legend'], ['he-layers-btn', 'he-layers']].map(([b, x]) => [document.getElementById(b), document.getElementById(x)]);
  for (const [btn, box] of pairs) {
    btn.addEventListener('click', () => {
      const open = box.hidden;
      for (const [b2, x2] of pairs) { x2.hidden = true; b2.setAttribute('aria-pressed', 'false'); }
      box.hidden = !open; btn.setAttribute('aria-pressed', String(open));
    });
  }
}
// THE HOLES BAR CAN BE MINIMISED (Matt, 2026-09-23), remembered per browser.
{
  const btn = document.getElementById('he-strip-toggle');
  const apply = () => {
    root.classList.toggle('he-root--strip-min', !!uiState.stripMin);
    btn.innerHTML = uiState.stripMin ? '&#9652; Show holes' : '&#9662; Hide holes';
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  btn.addEventListener('click', () => { uiState.stripMin = !uiState.stripMin; saveUiState(uiState); apply(); });
  apply();
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

// The course button, and the setup screen opening by itself on a course that has never had a name.
if (profile.custom) {
  document.getElementById('he-course-btn').addEventListener('click', openSetupModal);
  if (!(doc.course && doc.course.named)) openSetupModal();
}
// Help is a guided practice run of this same editor (tour.js), not a page of text.
if (profile.tutorial) import('./tour.js').then((m) => m.startTour(new URLSearchParams(location.search).get('topic')));

// HELP (2026-09-23): the first time, straight into the guided practice run; once it has been
// finished, a menu of its topics (each jumps into the run at that point) plus "replay it all".
document.getElementById('he-help').addEventListener('click', async (e) => {
  if (profile.tutorial || !tourDone()) return;   // the link itself opens the full run
  e.preventDefault();
  const old = document.getElementById('he-help-menu');
  if (old) { old.remove(); return; }
  const r = e.currentTarget.getBoundingClientRect();   // before the await: currentTarget is null after it
  const { TOPICS } = await import('./tour.js');
  const m = document.createElement('div');
  m.id = 'he-help-menu';
  m.style.cssText = `position:fixed;z-index:1500;top:${r.bottom + 6}px;right:${innerWidth - r.right}px;width:320px;background:#1e211a;border:1px solid #4a5040;border-radius:12px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);font:15px system-ui,sans-serif;color:#eceee4;`;
  const link = (href, label, strong) => `<a href="${href}" target="_blank" rel="noopener" style="display:block;padding:8px 10px;border-radius:8px;color:${strong ? '#1b1d14' : '#eceee4'};background:${strong ? '#ffce3a' : 'transparent'};text-decoration:none;font-weight:${strong ? 700 : 500};margin-bottom:4px;">${label}</a>`;
  m.innerHTML = `<div style="font-weight:700;padding:4px 10px 8px;">What do you need help with?</div>
    ${TOPICS.map(([id, label]) => link(`./?course=tutorial&topic=${id}`, label)).join('')}
    ${link('./?course=tutorial', 'Replay the whole walkthrough', true)}`;
  for (const a of m.querySelectorAll('a')) {
    if (a.style.background === 'transparent') { a.addEventListener('mouseenter', () => { a.style.background = '#2f3428'; }); a.addEventListener('mouseleave', () => { a.style.background = 'transparent'; }); }
    a.addEventListener('click', () => m.remove());
  }
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});

// REPORT A BUG (2026-09-23): the hub's own form (js/bug-report-ui.js) - same inbox Matt already
// reads, same screenshots, same offline outbox - with "Course Creator" preselected and a line saying
// exactly where the designer was. A practice-run report says so, so it is not mistaken for his course.
document.getElementById('he-bug').addEventListener('click', async () => {
  try {
    const m = await import('../../js/bug-report-ui.js');
    const c = doc.course || {};
    const where = profile.tutorial ? 'Course Creator (Help practice run)' : profile.custom ? 'Course Creator' : 'Red Mesa hole editor';
    const who = designer();
    const context = [where, who ? `designer ${who.name || ''} ${who.code || ''}`.trim() : null, profile.custom ? `course "${c.name || ''}" (${c.theme || 'parkland'})` : null,
      `hole ${doc.order.indexOf(currentId) + 1} of ${doc.order.length} (${currentId})`, `tool ${currentTool}`,
      editorCanvas.selection ? `selected ${editorCanvas.selection.group}` : null].filter(Boolean).join(' · ');
    await m.openBugReport({ where: { value: 'golf-course-creator', label: where }, context });
  } catch (err) { console.error('[hole-editor] bug report form failed to load', err); window.alert('The bug report form could not load. Check the connection and try again.'); }
});

// FIRST VISIT: POINT AT HELP (Matt: "when he opens the tool, it needs to guide him to click help
// first"). Until the walkthrough has been finished once (or this is dismissed), a yellow note hangs
// under the Help button; the setup screen carries the same offer.
function showHelpNudge() {
  if (profile.tutorial || !profile.custom || tourDone()) return;
  try { if (localStorage.getItem('golf.holeEditor.helpNudgeOff.v1') === '1') return; } catch { /* show it */ }
  if (document.getElementById('he-help-nudge')) return;
  const b = document.getElementById('he-help').getBoundingClientRect();
  const n = document.createElement('div');
  n.id = 'he-help-nudge';
  n.style.cssText = `position:fixed;z-index:900;top:${b.bottom + 12}px;right:${Math.max(8, innerWidth - b.right - 8)}px;width:260px;background:#ffce3a;color:#1b1d14;border-radius:12px;padding:12px 14px;font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);`;
  n.innerHTML = `<div style="position:absolute;top:-10px;right:${Math.max(14, b.width / 2 - 10)}px;border:10px solid transparent;border-top:none;border-bottom-color:#ffce3a;"></div>
    New here? Click <b>Help</b> for a quick guided tour first.
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
      <button type="button" id="he-help-nudge-x" style="all:unset;cursor:pointer;text-decoration:underline;font-weight:500;font-size:13px;">No thanks</button>
    </div>`;
  document.body.appendChild(n);
  n.querySelector('#he-help-nudge-x').addEventListener('click', () => { try { localStorage.setItem('golf.holeEditor.helpNudgeOff.v1', '1'); } catch { /* fine */ } n.remove(); });
  document.getElementById('he-help').addEventListener('click', () => n.remove(), { once: true });
}
showHelpNudge();

// A debug seam, not a feature: lets a Playwright check (or Matt, in devtools) read live state
// without a second copy of it. Nothing reads this at runtime.
window.__he = { get doc() { return doc; }, get currentId() { return currentId; }, get validateResults() { return validateResults; }, editorCanvas, getBuilt, isPhone, openSheet, sheetOpen };

// --- boot ---------------------------------------------------------------------------------
window.addEventListener('beforeunload', saveNow);
editorCanvas.resize();
editorCanvas.setHole(currentId, getBuilt(currentId), doc.holes[currentId].spec);
syncZoomSlider();
refreshPanels();
refreshStrip();
setTool(currentTool);
