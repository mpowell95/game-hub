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
import { buildMap, drawDecorSprite, paletteFor } from '../../golf/js/render.js';
import { THEME_DEFAULTS } from './starter.js';
import { makeT } from '../../js/i18n.js';
import { STRINGS } from '../../golf/js/strings.js';
import { OBSTACLE_CATALOG } from '../../golf/js/obstacles.js';

const t = makeT(STRINGS);

const TILE_W = 132; const TILE_H = 92;
const CROP_W = 34; const CROP_H = 24;   // yards shown per tile (same 11:8 as the tile)

export const GUARD_TOKENS = [
  ['frontSand', 'Front sand'], ['frontJaws', 'Front jaws'], ['frontWater', 'Front water'], ['frontTrees', 'Front trees'],
  ['leftSand', 'Left sand'], ['rightSand', 'Right sand'], ['backSand', 'Back sand'], ['ringSand', 'Ring sand'],
  ['leftWater', 'Left water'], ['rightWater', 'Right water'], ['backWater', 'Back water'],
  ['leftTrees', 'Left trees'], ['rightTrees', 'Right trees'],
  ['island', 'Island green'],   // 2026-09-23: water all the way round (holegen.js)
];

// --- the obstacle catalogue (2026-09-22, docs/HANDOFF-GOLF-OBJECTS.md section 1) ----------------
//
// The shared table lives in `golf/js/obstacles.js`. Tiles are grouped and ordered by its
// `shape`/`looks` - directly on the custom course (where `built.treeTypes` IS the catalogue) and,
// by NAME lookup, for the older per-course tables (Red Mesa, Pine Valley, Oasis Sands), whose own
// type objects carry no `shape`/`looks` field of their own.
const catalogByName = new Map(OBSTACLE_CATALOG.map((c) => [c.name, c]));

const TREE_SHAPES = new Set(['canopy', 'fir', 'willow', 'cypress', 'dead', 'joshua', 'bush', 'gorse', 'palm', 'cactus',
  'blossom', 'acacia', 'windbent', 'mangrove', 'agave', 'pricklypear', 'barrel', 'ocotillo', 'tumbleweed', 'grass', 'bamboo', 'banana']);

function shapeOf(ty) { return ty.shape || (catalogByName.get(ty.name) || {}).shape || (ty.name === 'saguaro' ? 'cactus' : 'canopy'); }
function looksOf(ty) { return ty.looks || (catalogByName.get(ty.name) || {}).looks || []; }

/** A tile's label: `t('obst_' + name)` (golf/js/strings.js). An older course's own type with no
 *  catalogue entry (Oasis Sands' 'tall palm') falls back to its capitalised name - `makeT`
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
    // TALL GRASS (2026-09-23): long uncut grass you play out of - no penalty, weak shots, the ball
    // stops where it lands (clubs.js LIES.tallGrass). Rides the water tool and the cross tool as
    // `kind: 'tallGrass'`, exactly as a swamp does.
    { title: 'Tall grass', items: [
      { id: 'grass-patch', label: 'Tall grass', kind: 'tool', tool: 'water', state: { waterKind: 'tallGrass' } },
      { id: 'grass-draw', label: 'Draw tall grass', kind: 'draw', group: 'water', drawKind: 'tallGrass' },
      { id: 'cross-tallGrass', label: 'Tall grass across', kind: 'tool', tool: 'cross', state: { crossKind: 'tallGrass' } },
    ] },
    { title: 'Around the green', items: GUARD_TOKENS.map(([tok, label]) => ({ id: `guard-${tok}`, label, kind: 'guard', token: tok })) },
    // Structures (2026-09-22, docs/HANDOFF-GOLF-POWER-LINES.md section 4): a power line is its
    // own RIBBON TOOL (`'line'`, main.js), not a `kind: 'draw'` tile - picking it starts the same
    // click-points-then-Enter flow a drawn shape uses, but it is a polyline, not a closed outline.
    // The matching "Power pole" single-tree tile comes for free out of "Trees & rocks" above, now
    // that the catalogue carries a 'pole' entry.
    { title: 'Structures', items: [
      { id: 'power-line', label: 'Power line', kind: 'tool', tool: 'line' },
      // HEDGES and OUT OF BOUNDS (2026-09-24). A hedge is a drawn LINE of kind 'hedge' (the power
      // line's own flow); out of bounds is a drawn water-layer shape of kind 'oob' (the lake's).
      { id: 'hedge-draw', label: 'Hedge', kind: 'draw', group: 'lines', drawKind: 'hedge' },
      { id: 'oob-draw', label: 'Out of bounds', kind: 'draw', group: 'water', drawKind: 'oob' },
    ] },
    // Decor (2026-09-22): cosmetic only, never consulted for play (golf/CLAUDE.md, "`decor` never
    // affects play"). A sprite is a `tool` tile like a tree; the cart path is the existing drawn
    // form, group 'decor', unchanged since 2026-09-16.
    { title: 'Decor', items: [
      { id: 'decor-bench', label: 'Bench', kind: 'tool', tool: 'decor', state: { decorKind: 'bench' } },
      { id: 'decor-sign', label: 'Sign', kind: 'tool', tool: 'decor', state: { decorKind: 'sign' } },
      { id: 'decor-flagpole', label: 'Flagpole', kind: 'tool', tool: 'decor', state: { decorKind: 'flagpole' } },
      { id: 'decor-path', label: 'Draw a cart path', kind: 'draw', group: 'decor' },
      { id: 'decor-flowerbed', label: 'Wildflowers', kind: 'tool', tool: 'decor', state: { decorKind: 'flowerbed' } },
      { id: 'decor-flowerbed-draw', label: 'Draw wildflowers', kind: 'draw', group: 'decor', drawKind: 'flowerbed' },
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
  // A single's tile is a PICTURE of the thing, not a map at true scale: at true scale a saguaro
  // (1.8 yd canopy), a log or a small rock was a few pixels across on a 34-yd tile and did not read
  // at all. So every single is drawn at one common size (`s`, the same per-tree size field the
  // editor's own size control writes) and the STAND tiles keep true relative scale, lightly
  // lifted for the smallest things, so the size difference between an oak and a bush still shows.
  const SINGLE_R = 7; const STAND_MIN_R = 3;
  d.treeTypes.forEach((ty, i) => {
    const c = Math.max(0.5, ty.canopy || 1);
    trees.push({ x: -28, y, type: i, s: +(SINGLE_R / c).toFixed(2) }); at[`tree-${i}`] = [-28, y];
    sentinels.push({ yd: y - 5, side: 1, off: 28, n: 4, spread: 5, type: i, ...(c < STAND_MIN_R ? { s: +(STAND_MIN_R / c).toFixed(2) } : {}) }); at[`stand-${i}`] = [28, y];
    y += 44;
  });
  const bunkers = [
    { yd: y - 5, side: -1, off: 26, r: 8, kind: 'fairwayBunker' },
    { yd: y - 5, side: 1, off: 26, r: 6, ry: 4.5, kind: 'greensideBunker' },
  ];
  at['bunker-fairway'] = [-26, y]; at['bunker-greenside'] = [26, y]; at['bunker-draw'] = [26, y];
  y += 50;
  // The pond ("Pond"/"Draw a lake") and a swamp beside it (`kind: 'swamp'`, holegen.js).
  const water = [
    { yd: y - 5, side: -1, off: 26, rx: 13, ry: 8.5, seed: 77 },
    { yd: y - 5, side: 1, off: 26, rx: 11, ry: 8, seed: 78, kind: 'swamp' },
    { yd: y + 45, side: -1, off: 26, rx: 11, ry: 8, seed: 79, kind: 'tallGrass' },
    { yd: y + 45, side: 1, off: 26, rx: 12, ry: 9, seed: 80, kind: 'oob' },
  ];
  at['oob-draw'] = [26, y + 50];
  at['water-pond'] = [-26, y]; at['water-draw'] = [-26, y];
  at['water-swamp'] = [26, y]; at['water-swamp-draw'] = [26, y];
  at['grass-patch'] = [-26, y + 50]; at['grass-draw'] = [-26, y + 50];
  y += 50;
  y += 50;
  const cross = [];
  for (const kind of ['water', 'waste', 'fairwayBunker', 'swamp', 'tallGrass']) {
    cross.push({ yd: y - 5, kind, depth: 14 });
    at[`cross-${kind === 'fairwayBunker' ? 'sand' : kind}`] = [0, y];
    y += 44;
  }
  // Power line (2026-09-22, docs/HANDOFF-GOLF-POWER-LINES.md section 4). A real `hole.lines`
  // entry is stamped onto the BUILT hole below (`makeHole` does not build `lines` - that is the
  // recipe field `holegen.js` gets, and a sampler hole is hand-built, not a recipe). If the
  // catalogue already carries a 'pole' entry (the engine half of this batch, `obstacles.js`) the
  // three poles are ordinary tree objects like every other tile's specimen; `paintTile` below
  // draws a stand-in only when it does not.
  const poleIdx = d.treeTypes.findIndex((ty) => ty.name === 'pole');
  const lineY = y;
  const linePts = [[-14, lineY], [0, lineY], [14, lineY]];
  if (poleIdx >= 0) for (const [px, py] of linePts) trees.push({ x: px, y: py, type: poleIdx });
  at['power-line'] = [0, lineY];
  y += 44;
  const hedgeY = y;   // a hedge (2026-09-24), stamped on the built hole below like the wire
  at['hedge-draw'] = [0, hedgeY];
  y += 44;
  const len = y + 60;
  const hole = makeHole({
    ...d, n: 1, par: 5, nickname: 'sampler', path: [[0, 5], [0, len]],
    fw: [{ at: 0, w: 15 }, { at: 1, w: 15 }], hard: 0.3, seed: 11, greenSeed: 12, defend: false, belts: false, slope: 'gentle',
    trees, sentinels, bunkers, water, cross,
  });
  // The real BUILT shape (holegen.js, once the engine half lands) is `{pts, lo, hi}`, not `{pts,
  // h}` - lo/hi is the band `shot.js`'s wireHit reads, and render.js's drawWire draws the wire at
  // its centre, `lo + 1`. h=10 here matches that formula (lo=9, hi=10.6) so the sampler tile shows
  // exactly what a real `h: 10` line would look like once holegen.js builds it for real.
  hole.lines = [{ pts: linePts, lo: 9, hi: 10.6 }];
  hole.hedges = [{ pts: [[-15, hedgeY - 4], [0, hedgeY + 2], [15, hedgeY - 2]], h: 2 }];
  // The three sprites are NOT painted into the map: at MAP_PPY a 3-yd bench is eight pixels. The
  // tile paints ground only and `paintTile` draws the sprite over it at tile resolution.
  const decorY = y;
  at['decor-bench'] = [-24, decorY - 10]; at['decor-sign'] = [0, decorY - 10]; at['decor-flagpole'] = [24, decorY - 10];
  at['decor-path'] = [0, decorY - 10];
  at['decor-flowerbed'] = [0, decorY - 10]; at['decor-flowerbed-draw'] = [0, decorY - 10];
  s = { map: buildMap(hole, theme), at, poleIdx };
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
  const decorKind = (item.tool === 'decor' && item.state && item.state.decorKind) || (item.id === 'decor-flowerbed-draw' ? 'flowerbed' : null);
  if (decorKind) {
    const ppy = (canvas.width / CROP_W) * (decorKind === 'flowerbed' ? 1.3 : 4);
    drawDecorSprite(canvas.getContext('2d'), decorKind, canvas.width / 2 - (decorKind === 'flowerbed' ? 0 : ppy * 0.4), canvas.height / 2, ppy, 0, paletteFor(theme));
  }
  if (item.kind === 'draw' || item.tool === 'line') {
    // A pencil over the picture: this one you outline (or, for the power line, string pole to
    // pole) yourself.
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]);
    ctx.strokeRect(24, 18, canvas.width - 48, canvas.height - 36);
    ctx.setLineDash([]);
    ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('✎', canvas.width - 14, canvas.height - 10);
  }
}

// WHICH PALETTE GROUPS ARE FOLDED (Matt, 2026-09-23: "let me collapse trees then rocks & logs,
// stands etc. so you can find things quicker"). Keyed by title, remembered per browser.
const FOLD_KEY = 'golf.holeEditor.palFolds.v1';
let _folds = {};
try { _folds = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch { _folds = {}; }

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
  const shut = (k) => (_folds[k] ? ' is-shut' : '');
  el.innerHTML = sections.map((sec) => `
    <div class="he-pal-section">
      <div class="he-pal-title he-pal-fold${shut(sec.title)}" data-fold="${sec.title}">${sec.title}</div>
      <div class="he-pal-body">
      ${sec.subs
    ? sec.subs.map((sub) => (sub.items.length ? `
      <div class="he-subhead he-pal-fold${shut(sec.title + '/' + sub.subtitle)}" data-fold="${sec.title}/${sub.subtitle}" style="margin:8px 0 4px;padding-top:0;border-top:none;">${sub.subtitle}</div>
      <div class="he-pal-body"><div class="he-pal-grid">${sub.items.map(tileHTML).join('')}</div></div>` : '')).join('')
    : `<div class="he-pal-grid">${sec.items.map(tileHTML).join('')}</div>`}
      </div>
    </div>`).join('');
  for (const h of el.querySelectorAll('[data-fold]')) {
    h.addEventListener('click', () => {
      const k = h.dataset.fold; _folds[k] = !_folds[k];
      h.classList.toggle('is-shut', !!_folds[k]);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(_folds)); } catch { /* per-browser convenience */ }
    });
  }
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
    if (drawing.group === 'water') return drawing.kind === 'swamp' ? 'water-swamp-draw' : (drawing.kind === 'tallGrass' ? 'grass-draw' : (drawing.kind === 'oob' ? 'oob-draw' : 'water-draw'));
    if (drawing.group === 'decor') return drawing.kind === 'flowerbed' ? 'decor-flowerbed-draw' : 'decor-path';
    if (drawing.group === 'lines') return drawing.kind === 'hedge' ? 'hedge-draw' : 'power-line';
    return 'bunker-draw';
  }
  if (tool === 'tree') return `${toolState.treeMode === 'stand' ? 'stand' : 'tree'}-${toolState.treePlantType || 0}`;
  if (tool === 'bunker') return toolState.bunkerKind === 'fairwayBunker' ? 'bunker-fairway' : 'bunker-greenside';
  if (tool === 'water') return toolState.waterKind === 'swamp' ? 'water-swamp' : (toolState.waterKind === 'tallGrass' ? 'grass-patch' : (toolState.waterKind === 'oob' ? 'oob-draw' : 'water-pond'));
  if (tool === 'cross') return `cross-${toolState.crossKind === 'fairwayBunker' ? 'sand' : (toolState.crossKind || 'water')}`;
  if (tool === 'decor') return `decor-${toolState.decorKind || 'bench'}`;
  if (tool === 'line') return 'power-line';
  return null;
}
