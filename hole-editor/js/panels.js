// hole-editor/js/panels.js - ribbon + panels (DOM). Step 3 covers the pieces "canvas: map, camera,
// thumbnails, hole switching, reorder" needs to be checkable on screen: the always-visible Legend,
// a read-only Hole panel and Objects list, the Layers toggles, and the bottom strip (totals +
// thumbnails, click to select, drag to reorder). Per-tool context panels (section 6) are step 4.

import { paletteFor, fillsFor } from '../../golf/js/render.js';
import { RED_MESA } from '../../golf/courses/redmesa.js';
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

/** Read-only for now (section 6's editing controls are step 4); slot/id, nickname, par, length,
 *  difficulty ramp and pinch are all DISPLAYED per section 4.3. */
export function renderHolePanel(el, doc, id, built) {
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
      <span class="he-field__value">${spec.nickname || ''}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Par</span>
      <span class="he-field__value">${spec.par}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Length</span>
      <span class="he-field__value">${built ? fmtYd(built.cardYards) : '-'} yd</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Difficulty ramp (hard)</span>
      <span class="he-field__value">${spec.hard.toFixed(2)}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Landing-zone pinch</span>
      <span class="he-field__value">${spec.pinchTo == null ? 'auto' : spec.pinchTo.toFixed(2)}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Auto-bunker at landing zone</span>
      <span class="he-field__value">${spec.defend === false ? 'off' : 'on'}</span>
    </div>
    <div class="he-field">
      <span class="he-field__label">Rough collar</span>
      <span class="he-field__value">${spec.rough == null ? '(course default)' : spec.rough}</span>
    </div>
    ${broken ? `<div class="he-broken">${broken}</div>` : ''}
  `;
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
    groups.push(['Trees', spec.trees.map((t) => `type ${t.type || 0} &middot; ${t.yd != null ? `${fmtYd(t.yd)} yd` : `${t.x}, ${t.y}`}`)]);
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
    cv.width = 120 * dpr; cv.height = 120 * dpr;
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
