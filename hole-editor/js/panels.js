// hole-editor/js/panels.js - ribbon + panels (DOM). Step 3 covers the pieces "canvas: map, camera,
// thumbnails, hole switching, reorder" needs to be checkable on screen: the always-visible Legend,
// a read-only Hole panel and Objects list, the Layers toggles, and the bottom strip (totals +
// thumbnails, click to select, drag to reorder). Per-tool context panels (section 6) are step 4.

import { paletteFor, fillsFor } from '../../golf/js/render.js';
import { RED_MESA } from '../../golf/courses/redmesa.js';
import { GREEN_SHAPES, SLOPE_PRESETS } from '../../golf/js/holegen.js';
import { renderMapThumbnail } from './canvas.js';

const ORIG_PAR = RED_MESA.par;
const ORIG_YARDS = Math.round(RED_MESA.holes.reduce((a, h) => a + h.cardYards, 0));

const THEME = 'desert';

// section 4.4: one swatch per surface kind, in this order, always visible.
const LEGEND_ORDER = [
  ['fairway', 'Fairway'],
  ['lightRough', 'Light rough'],
  ['heavyRough', 'Desert floor'],
  ['fringe', 'Fringe'],
  ['green', 'Green'],
  ['tee', 'Tee'],
  ['fairwayBunker', 'Fairway bunker'],
  ['greensideBunker', 'Greenside bunker'],
  ['water', 'Water'],
  ['trees', 'Scrub floor'],
];

export function renderLegend(el) {
  const fills = fillsFor(paletteFor(THEME));
  el.innerHTML = LEGEND_ORDER.map(([kind, label]) => `
    <div class="he-legend-row">
      <span class="he-swatch" style="background:${fills[kind] || '#888'}"></span>
      <span>${label}</span>
    </div>`).join('');
}

// section 4.3: Layers panel, all on by default. Functional now (cheap, tool-independent) so step 3
// can be visually verified with layers toggled.
export const DEFAULT_LAYERS = {
  centreline: true, route: true, objects: true, trees: true, belts: true,
  slope: true, bounds: true, teePin: true, grid: true,
};

export function renderLayers(el, layers, onChange) {
  const ROWS = [
    ['centreline', 'Centreline & handles'],
    ['route', 'Route'],
    ['objects', 'Objects outlines'],
    ['trees', 'Trees'],
    ['belts', 'Belts'],
    ['slope', 'Slope arrows'],
    ['bounds', 'Bounds'],
    ['teePin', 'Tee & pin'],
    ['grid', '50-yd grid'],
  ];
  el.innerHTML = ROWS.map(([key, label]) => `
    <label class="he-layer-row">
      <input type="checkbox" data-layer="${key}" ${layers[key] ? 'checked' : ''} />
      <span>${label}</span>
    </label>`).join('');
  el.querySelectorAll('[data-layer]').forEach((cb) => {
    cb.addEventListener('change', () => { layers[cb.dataset.layer] = cb.checked; onChange(); });
  });
}

function fmtYd(y) { return (Math.round(y * 10) / 10).toFixed(1); }

/** section 7: a "crosses itself" message cites two points; anything else cites at most one. */
export function pointsInMessage(msg) {
  const re = /\[(-?[\d.]+),\s*(-?[\d.]+)\]/g;
  const pts = [];
  let m;
  while ((m = re.exec(msg))) pts.push([+m[1], +m[2]]);
  return pts;
}

/** Never run on its own (section 7 - Matt's rule); `validateResults` is null until the Validate
 *  button has been pressed for this hole. */
function renderValidateResults(validateResults) {
  if (!validateResults) return '';
  if (!validateResults.length) return '<div class="he-objgroup">Validate</div><div class="he-objrow" style="color:#5fd97a;">No problems</div>';
  return `<div class="he-objgroup">Validate</div>${validateResults.map((msg, i) => `<div class="he-objrow" data-validate-row="${i}" style="white-space:normal;color:#ff8f80;">${msg}</div>`).join('')}`;
}
function wireValidateResults(el, onRowClick) {
  el.querySelectorAll('[data-validate-row]').forEach((row) => {
    row.addEventListener('click', () => onRowClick(+row.dataset.validateRow));
  });
}

/** Section 4.3. Slot/id and Length are read-only (Length is `built.cardYards`, R5 - never
 *  hand-edited, only ever a consequence of the path/width); everything else is a live control. */
export function renderHolePanel(el, doc, id, built, ops, hoverText, validateResults, onValidateRowClick) {
  const slot = doc.order.indexOf(id) + 1;
  const spec = doc.holes[id].spec;
  const broken = doc.holes[id].broken;
  el.innerHTML = `
    <div class="he-field">
      <span class="he-field__label">Hole</span>
      <span class="he-field__value">Hole ${slot} &middot; ${id}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Nickname</span>
      <input type="text" id="he-h-nick" value="${(spec.nickname || '').replace(/"/g, '&quot;')}" style="width:100%;" />
    </div>
    <div class="he-field">
      <span class="he-field__label">Par</span>
      ${seg('par', [[3, '3'], [4, '4'], [5, '5']], spec.par)}
    </div>
    <div class="he-field">
      <span class="he-field__label">Length</span>
      <span class="he-field__value">${built ? fmtYd(built.cardYards) : '-'} yd</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Width at cursor</span>
      <span class="he-field__value" id="he-h-widthcursor">${hoverText || '-'}</span>
    </div>
    ${slider('he-h-hard', 'Difficulty ramp (hard)', 0, 1, 0.01, spec.hard)}
    <div class="he-field">
      ${checkbox('he-h-pinch-auto', 'Landing-zone pinch: auto', spec.pinchTo == null)}
      ${spec.pinchTo != null ? slider('he-h-pinch', 'Landing-zone pinch', 0.40, 1.00, 0.01, spec.pinchTo) : ''}
    </div>
    ${checkbox('he-h-defend', 'Auto-bunker at landing zone', spec.defend !== false)}
    <div class="he-field">
      ${checkbox('he-h-rough-auto', 'Rough collar: course default', spec.rough == null)}
      ${spec.rough != null ? slider('he-h-rough', 'Rough collar', 3, 20, 1, spec.rough) : ''}
    </div>
    ${broken ? `<div class="he-broken">${broken}</div>` : ''}
    ${renderValidateResults(validateResults)}
  `;
  wireValidateResults(el, onValidateRowClick || (() => {}));
  if (!ops) return;
  el.querySelector('#he-h-nick').addEventListener('change', (e) => ops.instant((s) => ops.mutators.setField(s, 'nickname', e.target.value)));
  wireSeg(el, 'par', (v) => ops.instant((s) => ops.mutators.setField(s, 'par', +v)));
  wireSlider(el, 'he-h-hard', ops, (s, v) => ops.mutators.setField(s, 'hard', v));
  el.querySelector('#he-h-pinch-auto').addEventListener('change', (e) => ops.instant((s) => ops.mutators.setField(s, 'pinchTo', e.target.checked ? undefined : 0.6)));
  const pinch = el.querySelector('#he-h-pinch');
  if (pinch) wireSlider(el, 'he-h-pinch', ops, (s, v) => ops.mutators.setField(s, 'pinchTo', v));
  el.querySelector('#he-h-defend').addEventListener('change', (e) => ops.instant((s) => ops.mutators.setField(s, 'defend', e.target.checked ? undefined : false)));
  el.querySelector('#he-h-rough-auto').addEventListener('change', (e) => ops.instant((s) => ops.mutators.setField(s, 'rough', e.target.checked ? undefined : 10)));
  const rough = el.querySelector('#he-h-rough');
  if (rough) wireSlider(el, 'he-h-rough', ops, (s, v) => ops.mutators.setField(s, 'rough', v));
}

/** Every placed thing on the current hole, grouped (section 4.4). Read-only list for step 3;
 *  click-to-select on the canvas is wired once the Select tool exists (step 4). */
export function renderObjectsList(el, doc, id, built) {
  const spec = doc.holes[id].spec;
  const groups = [];

  const path = spec.path || [];
  groups.push(['Waypoints', path.map((p, i) => `${i}: ${p[0].toFixed(0)}, ${p[1].toFixed(0)}`)]);

  if (Array.isArray(spec.fw)) groups.push(['Width points', spec.fw.map((p) => `at ${p.at} &middot; w ${p.w}`)]);

  if (spec.bunkers && spec.bunkers.length) {
    groups.push(['Bunkers', spec.bunkers.map((b) => `${b.kind || 'greensideBunker'} &middot; ${fmtYd(b.yd != null ? b.yd : 0)} yd`)]);
  }
  if (spec.water && spec.water.length) {
    groups.push(['Water', spec.water.map((w) => `${fmtYd(w.yd != null ? w.yd : 0)} yd`)]);
  }
  if (spec.trees && spec.trees.length) {
    groups.push(['Trees', spec.trees.map((t) => `type ${t.type || 0} &middot; ${t.yd != null ? `${fmtYd(t.yd)} yd` : `${t.x}, ${t.y}`}${t.s != null ? ` &middot; x${t.s}` : ''}${t.h != null ? ` &middot; ${t.h} yd tall` : ''}`)]);
  }
  if (spec.sentinels && spec.sentinels.length) {
    groups.push(['Stands', spec.sentinels.map((s) => `${fmtYd(s.yd != null ? s.yd : 0)} yd`)]);
  }
  if (spec.cross && spec.cross.length) {
    groups.push(['Cross hazards', spec.cross.map((c) => `${c.kind || 'water'} &middot; ${fmtYd(c.yd != null ? c.yd : 0)} yd`)]);
  }
  if (spec.guard && spec.guard.length) {
    groups.push(['Guards', spec.guard.map((g) => g)]);
  }

  el.innerHTML = groups.map(([label, rows]) => `
    <div class="he-objgroup">${label}</div>
    ${rows.length ? rows.map((r) => `<div class="he-objrow">${r}</div>`).join('') : '<div class="he-empty">none</div>'}
  `).join('') || '<div class="he-empty">nothing on this hole</div>';
}

/** The bottom strip: totals (live, Δ while it differs from the originals) and the 18 thumbnails -
 *  section 4.2. `getBuilt(id)` and `originals` (id -> frozen normalised spec) let the strip mark a
 *  hole dirty/broken without recomputing anything the model does not already know. */
export function renderBottomStrip(totalsEl, stripEl, { doc, originals, currentId, getBuilt, onSelect, onReorder }) {
  const built = doc.order.map((id) => getBuilt(id));
  const par = built.reduce((a, h) => a + (h.par || 0), 0);
  const yards = Math.round(built.reduce((a, h) => a + (h.cardYards || 0), 0));

  // golf/CLAUDE.md: "yardages are computed, never quoted" - RED_MESA.par/cardYards ARE the
  // originals' own totals (the round-trip contract guarantees a fresh document builds identically
  // to them), so there is nothing to re-derive here.
  const dirty = par !== ORIG_PAR || yards !== ORIG_YARDS;

  totalsEl.classList.toggle('dirty', dirty);
  totalsEl.textContent = dirty ? `Par ${par} (${par - ORIG_PAR >= 0 ? '+' : ''}${par - ORIG_PAR}) · ${yards.toLocaleString()} yds`
    : `Par ${par} · ${yards.toLocaleString()} yds`;

  stripEl.innerHTML = doc.order.map((id, i) => `
    <div class="he-thumb ${id === currentId ? 'selected' : ''}" data-id="${id}" draggable="true">
      <canvas data-hole="${id}"></canvas>
      <div class="he-thumb-cap">${i + 1} &middot; par ${doc.holes[id].spec.par} &middot; ${Math.round(getBuilt(id).cardYards)}</div>
    </div>`).join('');

  for (const id of doc.order) {
    const wrap = stripEl.querySelector(`.he-thumb[data-id="${id}"]`);
    const spec = doc.holes[id].spec;
    const isDirty = originals[id] && JSON.stringify(spec) !== JSON.stringify(originals[id]);
    if (isDirty) wrap.insertAdjacentHTML('afterbegin', '<span class="he-dirty-dot"></span>');
    if (doc.holes[id].broken) wrap.insertAdjacentHTML('beforeend', '<span class="he-broken-mark">!</span>');

    const cv = wrap.querySelector('canvas');
    const dpr = 2;
    cv.width = 150 * dpr; cv.height = 140 * dpr;
    renderMapThumbnail(getBuilt(id), cv);

    wrap.addEventListener('click', () => onSelect(id));
    wrap.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; });
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drag-over'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== id) onReorder(draggedId, id);
    });
  }
}

// --- context panel: section 6, per-tool controls -------------------------------------------------
// One function per tool; `renderContextPanel` dispatches. `ctx`:
//   { tool, spec, built, selection, ops, toolState, setToolState, refresh }
// `ops.instant(mutateFn)` / `ops.liveBegin()` / `ops.liveUpdate(mutateFn)` / `ops.liveEnd()` come
// from main.js (undo bookkeeping); `refresh()` re-renders this panel (after a reroll, a toggle,
// or a selection change elsewhere).

function slider(id, label, min, max, step, value) {
  return `<div class="he-field">
    <span class="he-field__label">${label}</span>
    <div class="he-slider-row">
      <input type="range" id="${id}-r" min="${min}" max="${max}" step="${step}" value="${value}" />
      <input type="number" id="${id}-n" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>
  </div>`;
}

/** Wires a slider pair so it live-previews on drag and pushes undo once, on release/commit -
 *  section 3.5: "a slider pushes on change, not input." */
function wireSlider(el, id, ops, mutate) {
  const r = el.querySelector(`#${id}-r`); const n = el.querySelector(`#${id}-n`);
  if (!r) return;
  let began = false;
  const apply = (v) => { r.value = v; n.value = v; if (!began) { ops.liveBegin(); began = true; } ops.liveUpdate((spec) => mutate(spec, +v)); };
  const commit = (v) => { apply(v); ops.liveEnd(); began = false; };
  r.addEventListener('input', () => apply(r.value));
  r.addEventListener('change', () => commit(r.value));
  n.addEventListener('change', () => commit(n.value));
}

function seg(name, options, value) {
  return `<div class="gh-seg" data-seg="${name}" role="group">
    ${options.map(([v, label]) => `<button type="button" class="gh-seg__item" data-val="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}
  </div>`;
}

function wireSeg(el, name, onPick) {
  el.querySelectorAll(`.gh-seg[data-seg="${name}"] .gh-seg__item`).forEach((btn) => {
    btn.addEventListener('click', () => onPick(btn.dataset.val));
  });
}

function checkbox(id, label, checked) {
  return `<label class="he-layer-row"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /><span>${label}</span></label>`;
}

function renderRoute(el, ctx) {
  const { spec, built, ops } = ctx;
  el.innerHTML = `
    <div class="he-field"><span class="he-field__label">Waypoints</span>
      <span class="he-field__value">${spec.path.length} (tee, ${spec.path.length - 2} middle, pin)</span></div>
    <button class="gh-btn gh-btn--block" id="he-dogleg-l" style="margin-bottom:6px;">Dogleg left</button>
    <button class="gh-btn gh-btn--block" id="he-dogleg-r" style="margin-bottom:6px;">Dogleg right</button>
    <button class="gh-btn gh-btn--block gh-btn--ghost" id="he-straighten">Straighten</button>
    <div class="he-empty" style="margin-top:8px;">Drag a waypoint to move it; drag the pin to lengthen/shorten. Double-click the centreline to insert one. Delete removes a selected middle waypoint.</div>
  `;
  el.querySelector('#he-dogleg-l').addEventListener('click', () => ops.instant((s) => ops.mutators.insertDogleg(s, -1, built.cardYards)));
  el.querySelector('#he-dogleg-r').addEventListener('click', () => ops.instant((s) => ops.mutators.insertDogleg(s, 1, built.cardYards)));
  el.querySelector('#he-straighten').addEventListener('click', () => ops.instant((s) => ops.mutators.straightenPath(s)));
}

function renderWidth(el, ctx) {
  const { spec, ops, refresh } = ctx;
  const sidesDiffer = !!(spec.fwL || spec.fwR);
  const rows = (profile, side) => profile.map((p, i) => `
    <div class="he-objrow" style="cursor:default;display:flex;justify-content:space-between;">
      <span>at ${p.at} &middot; w ${p.w}</span>
      <span>
        <button class="gh-btn gh-btn--sm" data-del="${side}:${i}" ${profile.length <= 2 || p.at === 0 || p.at === 1 ? 'disabled' : ''}>&times;</button>
      </span>
    </div>`).join('');
  el.innerHTML = `
    ${slider('he-w-scale', 'Base width, whole hole (&times;)', 0.5, 2, 0.05, 1)}
    ${sidesDiffer ? '<div class="he-empty">Sides differ (fwL/fwR)</div>' : ''}
    <div class="he-objgroup">${sidesDiffer ? 'Left' : 'Width points'}</div>
    ${rows(spec.fwL || spec.fw, -1)}
    ${sidesDiffer ? `<div class="he-objgroup">Right</div>${rows(spec.fwR || spec.fw, 1)}` : ''}
    <div class="he-empty" style="margin-top:6px;">Drag a handle on the fairway edge to change that point's width. Double-click an edge to add a point.</div>
  `;
  wireSlider(el, 'he-w-scale', ops, (s, factor) => ops.mutators.scaleWidth(s, factor));
  el.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => {
    const [side, i] = btn.dataset.del.split(':');
    ops.instant((s) => ops.mutators.deleteWidthPoint(s, side === '-1' ? -1 : 1, +i));
    refresh();
  }));
}

function objTargetFor(spec, selection, groups) {
  if (selection && groups.includes(selection.group)) return selection;
  return null;
}

function renderBunker(el, ctx) {
  const { spec, selection, ops, refresh } = ctx;
  const target = objTargetFor(spec, selection, ['bunkers']);
  if (!target) { el.innerHTML = '<div class="he-empty">Click the hole to place a bunker.</div>'; return; }
  const b = spec.bunkers[target.index];
  el.innerHTML = `
    ${seg('kind', [['fairwayBunker', 'Fairway'], ['greensideBunker', 'Greenside']], b.kind || 'greensideBunker')}
    ${slider('he-b-r', 'r', 3, 18, 0.5, b.r || 6)}
    ${slider('he-b-ry', 'ry', 3, 14, 0.5, b.ry || (b.r || 6) * 0.72)}
    <button class="gh-btn gh-btn--block" id="he-b-reroll">Reroll shape</button>
  `;
  wireSeg(el, 'kind', (val) => { ops.instant((s) => ops.mutators.setBunkerField(s, target.index, { kind: val })); refresh(); });
  wireSlider(el, 'he-b-r', ops, (s, v) => ops.mutators.setBunkerField(s, target.index, { r: v }));
  wireSlider(el, 'he-b-ry', ops, (s, v) => ops.mutators.setBunkerField(s, target.index, { ry: v }));
  el.querySelector('#he-b-reroll').addEventListener('click', () => { ops.instant((s) => ops.mutators.rerollBunker(s, target.index)); refresh(); });
}

function renderWater(el, ctx) {
  const { spec, selection, ops, refresh } = ctx;
  const target = objTargetFor(spec, selection, ['water']);
  if (!target) { el.innerHTML = '<div class="he-empty">Click the hole to place water.</div>'; return; }
  const w = spec.water[target.index];
  el.innerHTML = `
    ${slider('he-w-rx', 'rx', 4, 30, 0.5, w.rx)}
    ${slider('he-w-ry', 'ry', 4, 30, 0.5, w.ry == null ? w.rx : w.ry)}
    <button class="gh-btn gh-btn--block" id="he-w-reroll">Reroll shape</button>
  `;
  wireSlider(el, 'he-w-rx', ops, (s, v) => ops.mutators.setWaterField(s, target.index, { rx: v }));
  wireSlider(el, 'he-w-ry', ops, (s, v) => ops.mutators.setWaterField(s, target.index, { ry: v }));
  el.querySelector('#he-w-reroll').addEventListener('click', () => { ops.instant((s) => ops.mutators.rerollWater(s, target.index)); refresh(); });
}

function treeTypeOptions(built) {
  return (built.treeTypes || []).map((t, i) => [String(i), t.name]);
}

function renderTree(el, ctx) {
  const { spec, built, selection, ops, toolState, setToolState, refresh } = ctx;
  const target = objTargetFor(spec, selection, ['trees', 'sentinels']);
  const editingStand = target && target.group === 'sentinels';
  // The Single/Stand toggle always drives the NEXT placement (section 6.6) - it is never bound to
  // a selection, because a placed tree cannot be "converted" into a stand in place.
  const type = target ? (editingStand ? spec.sentinels[target.index].type : spec.trees[target.index].type) : toolState.treePlantType;

  el.innerHTML = `
    ${seg('mode', [['single', 'Single tree'], ['stand', 'Stand']], toolState.treeMode)}
    ${seg('type', treeTypeOptions(built), type)}
    ${editingStand ? slider('he-t-n', 'n', 2, 9, 1, spec.sentinels[target.index].n) : ''}
    ${editingStand ? slider('he-t-spread', 'spread', 3, 15, 0.5, spec.sentinels[target.index].spread) : ''}
    ${target ? slider('he-t-size', 'Size (x the type)', 0.4, 3, 0.05, (editingStand ? spec.sentinels : spec.trees)[target.index].s ?? 1) : ''}
    ${target ? slider('he-t-height', 'Height (yd)', 1, 60, 0.5, (editingStand ? spec.sentinels : spec.trees)[target.index].h ?? ((built.treeTypes || [])[type] || {}).height ?? 15) : ''}
    ${!target ? '<div class="he-empty" style="margin-top:6px;">Click the hole to place it.</div>' : `<div class="he-empty" style="margin-top:6px;">Editing the selected ${editingStand ? 'stand' : 'tree'}.</div>`}
  `;
  wireSeg(el, 'mode', (val) => setToolState({ treeMode: val }));
  if (!target) {
    wireSeg(el, 'type', (val) => setToolState({ treePlantType: +val }));
    return;
  }
  wireSeg(el, 'type', (val) => {
    ops.instant((s) => (editingStand ? ops.mutators.setSentinelField(s, target.index, { type: +val }) : ops.mutators.setTreeField(s, target.index, { type: +val })));
    refresh();
  });
  if (editingStand) {
    wireSlider(el, 'he-t-n', ops, (s, v) => ops.mutators.setSentinelField(s, target.index, { n: Math.round(v) }));
    wireSlider(el, 'he-t-spread', ops, (s, v) => ops.mutators.setSentinelField(s, target.index, { spread: v }));
  }
  // Size and height (Matt, 2026-09-16: "Can i edit the size and height of trees?"). `s` multiplies
  // the type's trunk and canopy; `h` replaces the type's height. Both are read by the game's
  // treeHit and renderer (golf/CLAUDE.md, "Trees are TWO separate things"), so the tree drawn here
  // is the tree that stops the ball. Written as-is; nothing is derived twice.
  const setTree = (s, fields) => (editingStand ? ops.mutators.setSentinelField(s, target.index, fields) : ops.mutators.setTreeField(s, target.index, fields));
  wireSlider(el, 'he-t-size', ops, (s, v) => setTree(s, { s: +v.toFixed(2) }));
  wireSlider(el, 'he-t-height', ops, (s, v) => setTree(s, { h: +v.toFixed(1) }));
}

function renderBelts(el, ctx) {
  const { spec, ops, refresh } = ctx;
  const sideBlock = (side, label) => {
    const b = spec.belts && spec.belts[side];
    const on = b !== false && spec.belts !== false;
    return `
      <div class="he-objgroup">${label}</div>
      ${checkbox(`he-belt-${side}-on`, 'On', on)}
      ${on ? slider(`he-belt-${side}-depth`, 'depth', 8, 40, 1, (b && b.depth != null) ? b.depth : 20) : ''}
      ${on ? slider(`he-belt-${side}-spacing`, 'spacing', 6, 20, 1, (b && b.spacing != null) ? b.spacing : 14) : ''}
    `;
  };
  el.innerHTML = sideBlock('left', 'Left') + sideBlock('right', 'Right');
  for (const side of ['left', 'right']) {
    el.querySelector(`#he-belt-${side}-on`).addEventListener('change', (e) => {
      ops.instant((s) => ops.mutators.setBeltField(s, side, {}));
      // setBeltField only sets fields when ON; off is a separate write (mirrors setBeltSide's rule).
      if (!e.target.checked) ops.instant((s) => setBeltOff(s, side));
      refresh();
    });
    // BUG, found 2026-09-16 by driving the panel (Matt: "I can't get them to work"): this used to
    // look for `#he-belt-left-depth`, an id that never exists - `slider()` renders `-r` and `-n` -
    // so the two sliders were never wired and depth/spacing could not be changed at all. Turning a
    // side off worked, which is what made it look like the tool did nothing. `wireSlider` already
    // returns when the slider is absent (a side that is off), so no guard is needed.
    wireSlider(el, `he-belt-${side}-depth`, ops, (s, v) => ops.mutators.setBeltField(s, side, { depth: v }));
    wireSlider(el, `he-belt-${side}-spacing`, ops, (s, v) => ops.mutators.setBeltField(s, side, { spacing: v }));
  }
}
function setBeltOff(spec, side) {
  const belts = spec.belts && spec.belts !== false ? { ...spec.belts } : { left: undefined, right: undefined };
  belts[side] = false;
  return { ...spec, belts };
}

const GUARD_TOKENS = [
  ['frontSand', 'Front sand'], ['frontJaws', 'Front jaws'], ['frontWater', 'Front water'], ['frontTrees', 'Front trees'],
  ['leftSand', 'Left sand'], ['rightSand', 'Right sand'], ['backSand', 'Back sand'], ['ringSand', 'Ring sand'],
  ['leftWater', 'Left water'], ['rightWater', 'Right water'], ['backWater', 'Back water'],
  ['leftTrees', 'Left trees'], ['rightTrees', 'Right trees'],
];

function renderGreen(el, ctx) {
  const { spec, built, ops, refresh } = ctx;
  const guard = spec.guard || [];
  el.innerHTML = `
    ${seg('shape', Object.keys(GREEN_SHAPES).map((k) => [k, k]), spec.greenShape || 'round')}
    ${slider('he-g-angle', 'greenAngle', 0, 359, 1, spec.greenAngle || 0)}
    ${slider('he-g-r', 'greenR', 8, 22, 0.5, spec.greenR || Math.round(built.green ? Math.max(...built.green.poly.map((p) => Math.hypot(p[0] - built.pin[0], p[1] - built.pin[1]))) : 14))}
    ${checkbox('he-g-same', 'same (greenRy = greenR)', spec.greenRy == null)}
    ${spec.greenRy != null ? slider('he-g-ry', 'greenRy', 8, 22, 0.5, spec.greenRy) : ''}
    <button class="gh-btn gh-btn--block" id="he-g-reroll" style="margin:6px 0;">Reroll</button>
    <div class="he-objgroup">Guards</div>
    <div style="columns:2;">${GUARD_TOKENS.map(([tok, label]) => checkbox(`he-guard-${tok}`, label, guard.includes(tok))).join('')}</div>
    ${slider('he-g-tree', 'Guard tree type', 0, (built.treeTypes || [{}]).length - 1, 1, spec.guardTree || 0)}
  `;
  wireSeg(el, 'shape', (val) => { ops.instant((s) => ops.mutators.setGreenField(s, { greenShape: val })); refresh(); });
  wireSlider(el, 'he-g-angle', ops, (s, v) => ops.mutators.setGreenField(s, { greenAngle: Math.round(v) }));
  wireSlider(el, 'he-g-r', ops, (s, v) => ops.mutators.setGreenField(s, { greenR: v }));
  el.querySelector('#he-g-same').addEventListener('change', (e) => {
    ops.instant((s) => ops.mutators.setGreenField(s, { greenRy: e.target.checked ? undefined : s.greenR }));
    refresh();
  });
  const ry = el.querySelector('#he-g-ry');
  if (ry) wireSlider(el, 'he-g-ry', ops, (s, v) => ops.mutators.setGreenField(s, { greenRy: v }));
  el.querySelector('#he-g-reroll').addEventListener('click', () => { ops.instant((s) => ops.mutators.rerollGreen(s)); refresh(); });
  for (const [tok] of GUARD_TOKENS) {
    el.querySelector(`#he-guard-${tok}`).addEventListener('change', (e) => ops.instant((s) => ops.mutators.toggleGuard(s, tok, e.target.checked)));
  }
  wireSlider(el, 'he-g-tree', ops, (s, v) => ops.mutators.setGreenField(s, { guardTree: Math.round(v) }));
}

function renderSlope(el, ctx) {
  const { spec, ops, refresh, toolState, setToolState } = ctx;
  const isPaint = typeof spec.slope === 'object' && spec.slope && spec.slope.cells;
  const mode = isPaint ? 'paint' : (toolState.slopeMode || 'preset');
  el.innerHTML = `
    ${seg('slopemode', [['preset', 'Preset'], ['paint', 'Paint']], mode)}
    ${mode === 'preset' ? `
      <div class="he-field"><span class="he-field__label">Preset</span>
        <select id="he-slope-preset">${Object.keys(SLOPE_PRESETS).map((k) => `<option value="${k}" ${spec.slope === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      </div>
      ${slider('he-slope-k', 'Strength', 0.3, 2.0, 0.05, spec.slopeK == null ? 1 : spec.slopeK)}
    ` : `
      <div class="he-empty">Drag inside an 8&times;8 cell over the green to set its downhill direction; click without dragging to zero it.</div>
      <button class="gh-btn gh-btn--block" id="he-slope-flatten" style="margin-top:6px;">Flatten</button>
    `}
  `;
  wireSeg(el, 'slopemode', (val) => {
    if (val === 'paint' && !isPaint) {
      if (!window.confirm('Painting replaces the preset. Continue?')) { refresh(); return; }
      ops.instant((s) => ops.mutators.bakeSlopeToCells(s));
    }
    setToolState({ slopeMode: val });
    refresh();
  });
  if (mode === 'preset') {
    el.querySelector('#he-slope-preset').addEventListener('change', (e) => { ops.instant((s) => ops.mutators.setSlopePreset(s, e.target.value, s.slopeK)); refresh(); });
    wireSlider(el, 'he-slope-k', ops, (s, v) => ops.mutators.setSlopePreset(s, s.slope, v));
  } else {
    el.querySelector('#he-slope-flatten').addEventListener('click', () => { ops.instant((s) => ops.mutators.flattenSlope(s)); refresh(); });
  }
}

function renderCross(el, ctx) {
  const { spec, selection, ops, toolState, setToolState, refresh } = ctx;
  const target = objTargetFor(spec, selection, ['cross']);
  const kind = target ? (spec.cross[target.index].kind || 'water') : toolState.crossKind;
  const depth = target ? (spec.cross[target.index].depth == null ? 22 : spec.cross[target.index].depth) : toolState.crossDepth;
  const over = target ? (spec.cross[target.index].over == null ? 8 : spec.cross[target.index].over) : (toolState.crossOver == null ? 8 : toolState.crossOver);
  el.innerHTML = `
    ${seg('crosskind', [['water', 'Water'], ['waste', 'Waste'], ['fairwayBunker', 'Sand']], kind)}
    ${slider('he-c-depth', 'depth', 10, 40, 1, depth)}
    ${slider('he-c-over', 'over', 0, 20, 1, over)}
    ${!target ? '<div class="he-empty" style="margin-top:6px;">Click the hole to place it; drag along the hole to move it.</div>' : ''}
  `;
  wireSeg(el, 'crosskind', (val) => {
    if (target) { ops.instant((s) => ops.mutators.setCrossField(s, target.index, { kind: val })); refresh(); }
    else setToolState({ crossKind: val });
  });
  if (target) {
    wireSlider(el, 'he-c-depth', ops, (s, v) => ops.mutators.setCrossField(s, target.index, { depth: v }));
    wireSlider(el, 'he-c-over', ops, (s, v) => ops.mutators.setCrossField(s, target.index, { over: v }));
  } else {
    const sync = (key, id) => {
      const r = el.querySelector(`#${id}-r`); const n = el.querySelector(`#${id}-n`);
      const set = (v) => { r.value = v; n.value = v; setToolState({ [key]: +v }); };
      r.addEventListener('input', () => set(r.value));
      n.addEventListener('change', () => set(n.value));
    };
    sync('crossDepth', 'he-c-depth');
    sync('crossOver', 'he-c-over');
  }
}

function renderSelect(el, ctx) {
  const { selection } = ctx;
  if (!selection) { el.innerHTML = '<div class="he-empty">Click an object to select it.</div>'; return; }
  if (selection.group === 'waypoint') { el.innerHTML = '<div class="he-empty">Waypoint selected. Drag to move (switch to Route for Dogleg/Straighten).</div>'; return; }
  const byGroup = { bunkers: renderBunker, water: renderWater, trees: renderTree, sentinels: renderTree, cross: renderCross };
  const fn = byGroup[selection.group];
  if (fn) fn(el, ctx); else el.innerHTML = '<div class="he-empty">Selected.</div>';
}

function renderRuler(el) {
  el.innerHTML = '<div class="he-empty">Click twice on the hole for a distance. Esc clears.</div>';
}

export function renderContextPanel(el, ctx) {
  const byTool = {
    select: renderSelect, route: renderRoute, width: renderWidth, bunker: renderBunker,
    water: renderWater, tree: renderTree, belts: renderBelts, green: renderGreen,
    slope: renderSlope, cross: renderCross, ruler: renderRuler,
  };
  const fn = byTool[ctx.tool];
  if (fn) fn(el, ctx); else el.innerHTML = '<span class="he-empty">Tools land in step 4.</span>';
}

// --- Compare (section 7) --------------------------------------------------------------------
// Visual only: two canvases side by side, original vs current, both letterboxed to the SAME
// scale so a size difference is honest rather than an artifact of independent fitting.

export function openCompareModal({ originalBuilt, currentBuilt, slot, id }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:1000;display:flex;align-items:center;justify-content:center;';
  const W = 360; const H = 720;
  const scale = Math.min(
    W / Math.max(originalBuilt.bounds.maxX - originalBuilt.bounds.minX, currentBuilt.bounds.maxX - currentBuilt.bounds.minX),
    H / Math.max(originalBuilt.bounds.maxY - originalBuilt.bounds.minY, currentBuilt.bounds.maxY - currentBuilt.bounds.minY),
  );
  const card = (built, label) => {
    const b = built.bounds;
    const w = Math.max(1, Math.round((b.maxX - b.minX) * scale));
    const h = Math.max(1, Math.round((b.maxY - b.minY) * scale));
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
      <div style="color:#e8e8e8;font:600 13px sans-serif;">${label} &middot; par ${built.par} &middot; ${Math.round(built.cardYards)} yd</div>
      <div style="width:${W}px;height:${H}px;background:#0b0f07;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.15);">
        <canvas width="${w}" height="${h}" data-role="${label}"></canvas>
      </div>
    </div>`;
  };
  overlay.innerHTML = `
    <div style="background:#1e1e1e;border-radius:10px;padding:20px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="color:#e8e8e8;font:600 15px sans-serif;">Compare &middot; ${id} (slot ${slot})</div>
        <button class="gh-btn gh-btn--sm" id="he-compare-close">Close</button>
      </div>
      <div style="display:flex;gap:20px;">
        ${card(originalBuilt, 'Original')}
        ${card(currentBuilt, 'Current')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const origCv = overlay.querySelector('canvas[data-role="Original"]');
  const curCv = overlay.querySelector('canvas[data-role="Current"]');
  renderMapThumbnail(originalBuilt, origCv);
  renderMapThumbnail(currentBuilt, curCv);
  const close = () => overlay.remove();
  overlay.querySelector('#he-compare-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onEsc); } });
}
