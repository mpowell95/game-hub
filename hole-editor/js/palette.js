// hole-editor/js/palette.js - THE PALETTE: every object the editor can add, as a PICTURE drawn by
// the game's own renderer (2026-09-22).
//
// Matt: *"i need to see the objects before i select them - like every other game forever is
// like."* And: *"you can't see what they look like until you've added it to the course."* So every
// tile here is a crop of a real map: one SAMPLER hole per theme, built by makeHole with one of
// everything placed at known coordinates, painted once by buildMap and cropped per tile. What the
// tile shows is exactly what the hole will show, at the same pixels.
//
// A tile does one of three things when clicked (`kind`):
//   'tool'  - selects a placement tool with its options preset (a saguaro stand, a fairway bunker,
//             a creek across the hole); the next click on the map places it.
//   'draw'  - starts drawing a shape (a bunker or a lake with your own outline).
//   'guard' - toggles a green-side preset on the CURRENT hole (no map click needed).

import { makeHole } from '../../golf/js/holegen.js';
import { buildMap } from '../../golf/js/render.js';
import { THEME_DEFAULTS } from './starter.js';
import { makeT } from '../../js/i18n.js';
import { STRINGS } from '../../golf/js/strings.js';

const t = makeT(STRINGS);

const TILE_W = 132; const TILE_H = 92;
const CROP_W = 34; const CROP_H = 24;   // yards shown per tile (same 11:8 as the tile)

export const GUARD_TOKENS = [
  ['frontSand', 'Front sand'], ['frontJaws', 'Front jaws'], ['frontWater', 'Front water'], ['frontTrees', 'Front trees'],
  ['leftSand', 'Left sand'], ['rightSand', 'Right sand'], ['backSand', 'Back sand'], ['ringSand', 'Ring sand'],
  ['leftWater', 'Left water'], ['rightWater', 'Right water'], ['backWater', 'Back water'],
  ['leftTrees', 'Left trees'], ['rightTrees', 'Right trees'],
];

// --- the obstacle catalogue (2026-09-22, docs/HANDOFF-GOLF-OBJECTS.md section 1) ----------------
//
// `golf/js/obstacles.js` is Opus's file, built in a parallel worktree. TEMP_CATALOG below is the
// SAME table, verbatim from the handoff spec, so THIS editor can group and order tiles by
// shape/looks today - both for the whole catalogue on the custom course (where `built.treeTypes`
// already IS the catalogue, section 1's last bullet) and, by NAME lookup, for the smaller
// per-course tables (Red Mesa, Pine Valley, Oasis Sands) that predate it and stay untouched, whose
// own type objects carry no `shape`/`looks` field of their own.
//
// TEMP UNTIL obstacles.js LANDS: delete this block and the try/catch below at merge - the dynamic
// import already prefers the real file the instant it exists, so nothing else here changes.
const TEMP_CATALOG = [
  { name: 'pine', shape: 'fir', trunk: 0.6, canopy: 4.5, height: 18, looks: ['parkland'] },
  { name: 'oak', shape: 'canopy', trunk: 1.0, canopy: 8.0, height: 13, looks: ['parkland'] },
  { name: 'sentinel', shape: 'fir', trunk: 1.2, canopy: 5.0, height: 40, looks: ['parkland'] },
  { name: 'maple', shape: 'canopy', trunk: 0.9, canopy: 7.0, height: 14, looks: ['parkland'] },
  { name: 'birch', shape: 'canopy', trunk: 0.5, canopy: 3.5, height: 12, looks: ['parkland'] },
  { name: 'willow', shape: 'willow', trunk: 1.0, canopy: 9.0, height: 12, looks: ['parkland'] },
  { name: 'cypress', shape: 'cypress', trunk: 0.7, canopy: 2.5, height: 22, looks: ['parkland'] },
  { name: 'deadtree', shape: 'dead', trunk: 0.7, canopy: 3.0, height: 10, looks: ['parkland', 'desert'] },
  { name: 'bush', shape: 'bush', trunk: 0.4, canopy: 2.5, height: 2, looks: ['parkland', 'desert'] },
  { name: 'palm', shape: 'palm', trunk: 0.5, canopy: 4.0, height: 16, looks: ['desert'] },
  { name: 'saguaro', shape: 'cactus', trunk: 0.9, canopy: 1.8, height: 15, looks: ['desert'] },
  { name: 'paloverde', shape: 'canopy', trunk: 0.7, canopy: 6.5, height: 8, looks: ['desert'] },
  { name: 'joshua', shape: 'dead', trunk: 0.6, canopy: 3.0, height: 9, looks: ['desert'] },
  { name: 'boulder', shape: 'rock', trunk: 3.2, canopy: 3.2, height: 40, looks: ['desert', 'parkland'] },
  { name: 'smallrock', shape: 'rock', trunk: 1.5, canopy: 1.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'rockpile', shape: 'rocks', trunk: 4.5, canopy: 4.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'log', shape: 'log', trunk: 1.2, canopy: 1.2, height: 1.5, looks: ['parkland'] },
];
let _catalog = TEMP_CATALOG;
try {
  const mod = await import('../../golf/js/obstacles.js');
  if (mod && Array.isArray(mod.OBSTACLE_CATALOG) && mod.OBSTACLE_CATALOG.length) _catalog = mod.OBSTACLE_CATALOG;
} catch { /* not landed in this worktree yet - TEMP_CATALOG stands in, see the comment above */ }
export const OBSTACLE_CATALOG = _catalog;
const catalogByName = new Map(OBSTACLE_CATALOG.map((c) => [c.name, c]));

const TREE_SHAPES = new Set(['canopy', 'fir', 'willow', 'cypress', 'dead', 'bush', 'palm', 'cactus']);

function shapeOf(ty) { return ty.shape || (catalogByName.get(ty.name) || {}).shape || (ty.name === 'saguaro' ? 'cactus' : 'canopy'); }
function looksOf(ty) { return ty.looks || (catalogByName.get(ty.name) || {}).looks || []; }

/** A tile's label: `t('obst_' + name)` (golf/js/strings.js, Opus's addition alongside the
 *  catalogue) falling back to a capitalised name when that key hasn't landed yet - `makeT`
 *  returns the KEY ITSELF on a miss, which is how the fallback is detected. */
function nice(name) {
  const key = 'obst_' + name;
  const v = t(key);
  if (v && v !== key) return v;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The sections and their items for a built hole's obstacle table. Pure.
 *
 *  `look` orders "Trees" / "Rocks & logs" / "Stands" so the current theme's own species come
 *  first (section 5: "ordered by looks"); it is a STABLE reorder, so within "matches the look" and
 *  "does not" each keeps the catalogue's own append-only order. Thirty-four tiles (17 singles +
 *  17 stands) is a lot for one course table on the custom course - hence three sub-heads, so a
 *  designer scrolls past what they do not want. */
export function paletteSections(built, look) {
  const types = built.treeTypes || [];
  const withOrder = types.map((ty, i) => ({ ty, i, first: look && looksOf(ty).includes(look) ? 0 : 1 }));
  withOrder.sort((a, b) => a.first - b.first);
  const treeItems = []; const rockItems = []; const standItems = [];
  for (const { ty, i } of withOrder) {
    const label = nice(ty.name);
    const bucket = TREE_SHAPES.has(shapeOf(ty)) ? treeItems : rockItems;
    bucket.push({ id: `tree-${i}`, label, kind: 'tool', tool: 'tree', state: { treeMode: 'single', treePlantType: i } });
    standItems.push({ id: `stand-${i}`, label: `${label} stand`, kind: 'tool', tool: 'tree', state: { treeMode: 'stand', treePlantType: i } });
  }
  return [
    { title: 'Trees & rocks', subs: [
      { subtitle: 'Trees', items: treeItems },
      { subtitle: 'Rocks & logs', items: rockItems },
      { subtitle: 'Stands', items: standItems },
    ] },
    { title: 'Sand', items: [
      { id: 'bunker-fairway', label: 'Fairway bunker', kind: 'tool', tool: 'bunker', state: { bunkerKind: 'fairwayBunker' } },
      { id: 'bunker-greenside', label: 'Greenside bunker', kind: 'tool', tool: 'bunker', state: { bunkerKind: 'greensideBunker' } },
      { id: 'bunker-draw', label: 'Draw a bunker', kind: 'draw', group: 'bunkers', drawKind: 'greensideBunker' },
      { id: 'cross-sand', label: 'Sand across', kind: 'tool', tool: 'cross', state: { crossKind: 'fairwayBunker' } },
    ] },
    { title: 'Water & waste', items: [
      { id: 'water-pond', label: 'Pond', kind: 'tool', tool: 'water', state: { waterKind: 'water' } },
      { id: 'water-draw', label: 'Draw a lake', kind: 'draw', group: 'water' },
      // Swamp (2026-09-22): "it is not water - no penalty stroke, no drop prompt, the ball just
      // stops dead where it lands and comes out at half power" - same tool as water, only `kind`
      // differs (see canvas.js's `_place`/`renderWater`).
      { id: 'water-swamp', label: 'Swamp', kind: 'tool', tool: 'water', state: { waterKind: 'swamp' } },
      { id: 'water-swamp-draw', label: 'Draw a swamp', kind: 'draw', group: 'water', drawKind: 'swamp' },
      { id: 'cross-water', label: 'Creek across', kind: 'tool', tool: 'cross', state: { crossKind: 'water' } },
      { id: 'cross-waste', label: 'Waste across', kind: 'tool', tool: 'cross', state: { crossKind: 'waste' } },
      { id: 'cross-swamp', label: 'Swamp across', kind: 'tool', tool: 'cross', state: { crossKind: 'swamp' } },
    ] },
    { title: 'Around the green', items: GUARD_TOKENS.map(([tok, label]) => ({ id: `guard-${tok}`, label, kind: 'guard', token: tok })) },
    // Decor (2026-09-22): cosmetic only, never consulted for play (golf/CLAUDE.md, "`decor` never
    // affects play"). A sprite is a `tool` tile like a tree; the cart path is the existing drawn
    // form, group 'decor', unchanged since 2026-09-16.
    { title: 'Decor', items: [
      { id: 'decor-bench', label: 'Bench', kind: 'tool', tool: 'decor', state: { decorKind: 'bench' } },
      { id: 'decor-sign', label: 'Sign', kind: 'tool', tool: 'decor', state: { decorKind: 'sign' } },
      { id: 'decor-flagpole', label: 'Flagpole', kind: 'tool', tool: 'decor', state: { decorKind: 'flagpole' } },
      { id: 'decor-path', label: 'Draw a cart path', kind: 'draw', group: 'decor' },
    ] },
  ];
}

// --- the sampler ------------------------------------------------------------------------------

const _samplers = new Map();   // theme|types -> { map, at: { itemId: [x, y] } }
const _guards = new Map();     // theme|types|token -> map + pin

function defaultsFor(theme, types) {
  const base = THEME_DEFAULTS[theme] || THEME_DEFAULTS.parkland;
  return { ...base, treeTypes: types && types.length ? types : base.treeTypes };
}

function sampler(theme, types) {
  const key = `${theme}|${JSON.stringify(types)}`;
  let s = _samplers.get(key);
  if (s) return s;
  const d = defaultsFor(theme, types);
  const at = {};
  const trees = []; const sentinels = [];
  let y = 60;
  // Every row is kept >= 40 yd from the next (section 5: "keep every item >= 40 yds from the next
  // so crops never overlap") - the tree/stand rows step 44 yd apart already; every OTHER row below
  // is on its own 50 yd step for the same reason.
  d.treeTypes.forEach((ty, i) => {
    trees.push({ x: -28, y, type: i }); at[`tree-${i}`] = [-28, y];
    sentinels.push({ yd: y - 5, side: 1, off: 28, n: 4, spread: 5, type: i }); at[`stand-${i}`] = [28, y];
    y += 44;
  });
  const bunkers = [
    { yd: y - 5, side: -1, off: 26, r: 8, kind: 'fairwayBunker' },
    { yd: y - 5, side: 1, off: 26, r: 6, ry: 4.5, kind: 'greensideBunker' },
  ];
  at['bunker-fairway'] = [-26, y]; at['bunker-greenside'] = [26, y]; at['bunker-draw'] = [26, y];
  y += 50;
  // TWO water entries: the first is the plain pond ("Pond"/"Draw a lake"), the second is relabelled
  // to 'swamp' on the BUILT hole below, a NAME NOT a source. This worktree's holegen.js does not
  // yet understand a water recipe's `kind` (Opus's docs/HANDOFF-GOLF-OBJECTS.md section 2 item) -
  // relabelling the built surface directly needs no coordinated merge, and render.js's swamp paint
  // (already built) makes the tile honest either way.
  const water = [
    { yd: y - 5, side: -1, off: 26, rx: 13, ry: 8.5, seed: 77 },
    { yd: y - 5, side: 1, off: 26, rx: 11, ry: 8, seed: 78 },
  ];
  at['water-pond'] = [-26, y]; at['water-draw'] = [-26, y];
  at['water-swamp'] = [26, y]; at['water-swamp-draw'] = [26, y];
  y += 50;
  const cross = [];
  for (const kind of ['water', 'waste', 'fairwayBunker', 'swamp']) {
    cross.push({ yd: y - 5, kind, depth: 14 });
    at[`cross-${kind === 'fairwayBunker' ? 'sand' : kind}`] = [0, y];
    y += 44;
  }
  const len = y + 60;
  const hole = makeHole({
    ...d, n: 1, par: 5, nickname: 'sampler', path: [[0, 5], [0, len]],
    fw: [{ at: 0, w: 15 }, { at: 1, w: 15 }], hard: 0.3, seed: 11, greenSeed: 12, defend: false, belts: false, slope: 'gentle',
    trees, sentinels, bunkers, water, cross,
  });
  // Relabel the second water surface (built from `water[1]` above) as swamp - see the comment
  // above `water` for why this happens here rather than in the recipe.
  const waterSurfaces = hole.surfaces.filter((sf) => sf.kind === 'water');
  if (waterSurfaces.length >= 2) waterSurfaces[1].kind = 'swamp';
  // DECOR, post-build (2026-09-22): a sprite entry (`{at, kind, rot}`) has no `.poly`, and this
  // worktree's `makeHole` (holegen.js, Opus's file) bounds-measures every `spec.decor` entry by
  // its `.poly` alone - pushing one through the RECIPE would throw here. Appending straight onto
  // the BUILT hole's own `decor` array, after `makeHole` has already returned, needs no change to
  // that file and paints identically (render.js reads `hole.decor` either way).
  hole.decor = [...(hole.decor || [])];
  const decorY = y;
  hole.decor.push({ at: [-24, decorY - 10], kind: 'bench', rot: 0 });
  hole.decor.push({ at: [0, decorY - 10], kind: 'sign', rot: 0 });
  hole.decor.push({ at: [24, decorY - 10], kind: 'flagpole', rot: 0 });
  at['decor-bench'] = [-24, decorY - 10]; at['decor-sign'] = [0, decorY - 10]; at['decor-flagpole'] = [24, decorY - 10];
  at['decor-path'] = [0, decorY - 10];
  s = { map: buildMap(hole, theme), at };
  _samplers.set(key, s);
  return s;
}

function guardSample(theme, types, token) {
  const key = `${theme}|${JSON.stringify(types)}|${token}`;
  let g = _guards.get(key);
  if (g) return g;
  const d = defaultsFor(theme, types);
  const hole = makeHole({
    ...d, n: 1, par: 3, nickname: 'guard', path: [[0, 5], [0, 150]], fw: [{ at: 0, w: 12 }, { at: 1, w: 12 }],
    hard: 0.3, seed: 21, greenSeed: 22, defend: false, belts: false, guard: [token], guardTree: 0, slope: 'gentle',
  });
  g = { map: buildMap(hole, theme), pin: hole.pin };
  _guards.set(key, g);
  return g;
}

function crop(map, cx, cy, wYd, hYd, dest) {
  const ctx = dest.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const sx = (cx - wYd / 2 - map.minX) * map.ppy;
  const sy = (map.maxY - (cy + hYd / 2)) * map.ppy;
  ctx.fillStyle = '#0b0f07';
  ctx.fillRect(0, 0, dest.width, dest.height);
  ctx.drawImage(map.canvas, sx, sy, wYd * map.ppy, hYd * map.ppy, 0, 0, dest.width, dest.height);
}

/** Paint one item's picture onto `canvas` (TILE_W x TILE_H device pixels, 2x). */
export function paintTile(canvas, item, theme, types) {
  canvas.width = TILE_W * 2; canvas.height = TILE_H * 2;
  if (item.kind === 'guard') {
    const g = guardSample(theme, types, item.token);
    crop(g.map, g.pin[0], g.pin[1] - 4, CROP_W * 1.9, CROP_H * 1.9, canvas);
    return;
  }
  const s = sampler(theme, types);
  const [x, y] = s.at[item.id] || [0, 60];
  crop(s.map, x, y, CROP_W, CROP_H, canvas);
  if (item.kind === 'draw') {
    // A pencil over the picture: this one you outline yourself.
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]);
    ctx.strokeRect(24, 18, canvas.width - 48, canvas.height - 36);
    ctx.setLineDash([]);
    ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('✎', canvas.width - 14, canvas.height - 10);
  }
}

/** Render the palette. `active` is the item id that matches the current tool + options, if any;
 *  `guardsOn` the current hole's guard tokens. `onPick(item)` handles a click. */
export function renderPalette(el, { built, theme, active, guardsOn, onPick }) {
  const sections = paletteSections(built, theme);
  const types = built.treeTypes || [];
  const tileHTML = (it) => {
    const on = it.kind === 'guard' ? guardsOn.includes(it.token) : it.id === active;
    return `<button type="button" class="he-tile${on ? ' is-on' : ''}" data-item="${it.id}" title="${it.label}">
      <canvas class="he-tile__pic" width="${TILE_W * 2}" height="${TILE_H * 2}"></canvas>
      <span class="he-tile__label">${it.label}${it.kind === 'guard' ? (on ? ' ✓' : '') : ''}</span>
    </button>`;
  };
  el.innerHTML = sections.map((sec) => `
    <div class="he-pal-section">
      <div class="he-pal-title">${sec.title}</div>
      ${sec.subs
    ? sec.subs.map((sub) => (sub.items.length ? `
      <div class="he-subhead" style="margin:8px 0 4px;padding-top:0;border-top:none;">${sub.subtitle}</div>
      <div class="he-pal-grid">${sub.items.map(tileHTML).join('')}</div>` : '')).join('')
    : `<div class="he-pal-grid">${sec.items.map(tileHTML).join('')}</div>`}
    </div>`).join('');
  const allItems = sections.flatMap((s) => (s.subs ? s.subs.flatMap((sub) => sub.items) : s.items));
  const byId = new Map(allItems.map((it) => [it.id, it]));
  for (const btn of el.querySelectorAll('.he-tile')) {
    const item = byId.get(btn.dataset.item);
    try { paintTile(btn.querySelector('canvas'), item, theme, types); } catch (e) { console.warn('[palette] tile failed', item.id, e); }
    btn.addEventListener('click', () => onPick(item));
  }
}

/** Which tile the current tool + options correspond to, so the palette can highlight it. */
export function activeItemFor(tool, toolState, drawing) {
  if (drawing) {
    if (drawing.group === 'water') return drawing.kind === 'swamp' ? 'water-swamp-draw' : 'water-draw';
    if (drawing.group === 'decor') return 'decor-path';
    return 'bunker-draw';
  }
  if (tool === 'tree') return `${toolState.treeMode === 'stand' ? 'stand' : 'tree'}-${toolState.treePlantType || 0}`;
  if (tool === 'bunker') return toolState.bunkerKind === 'fairwayBunker' ? 'bunker-fairway' : 'bunker-greenside';
  if (tool === 'water') return toolState.waterKind === 'swamp' ? 'water-swamp' : 'water-pond';
  if (tool === 'cross') return `cross-${toolState.crossKind === 'fairwayBunker' ? 'sand' : (toolState.crossKind || 'water')}`;
  if (tool === 'decor') return `decor-${toolState.decorKind || 'bench'}`;
  return null;
}
