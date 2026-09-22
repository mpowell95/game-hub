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

const TILE_W = 132; const TILE_H = 92;
const CROP_W = 34; const CROP_H = 24;   // yards shown per tile (same 11:8 as the tile)

export const GUARD_TOKENS = [
  ['frontSand', 'Front sand'], ['frontJaws', 'Front jaws'], ['frontWater', 'Front water'], ['frontTrees', 'Front trees'],
  ['leftSand', 'Left sand'], ['rightSand', 'Right sand'], ['backSand', 'Back sand'], ['ringSand', 'Ring sand'],
  ['leftWater', 'Left water'], ['rightWater', 'Right water'], ['backWater', 'Back water'],
  ['leftTrees', 'Left trees'], ['rightTrees', 'Right trees'],
];

const NICE = { saguaro: 'Saguaro', paloverde: 'Palo verde', boulder: 'Boulder', pine: 'Pine', oak: 'Oak', sentinel: 'Sentinel pine' };
const nice = (name) => NICE[name] || (name.charAt(0).toUpperCase() + name.slice(1));

/** The sections and their items for a built hole's obstacle table. Pure. */
export function paletteSections(built) {
  const types = built.treeTypes || [];
  const trees = [];
  types.forEach((ty, i) => {
    trees.push({ id: `tree-${i}`, label: nice(ty.name), kind: 'tool', tool: 'tree', state: { treeMode: 'single', treePlantType: i } });
  });
  types.forEach((ty, i) => {
    trees.push({ id: `stand-${i}`, label: `${nice(ty.name)} stand`, kind: 'tool', tool: 'tree', state: { treeMode: 'stand', treePlantType: i } });
  });
  return [
    { title: 'Trees & rocks', items: trees },
    { title: 'Sand', items: [
      { id: 'bunker-fairway', label: 'Fairway bunker', kind: 'tool', tool: 'bunker', state: { bunkerKind: 'fairwayBunker' } },
      { id: 'bunker-greenside', label: 'Greenside bunker', kind: 'tool', tool: 'bunker', state: { bunkerKind: 'greensideBunker' } },
      { id: 'bunker-draw', label: 'Draw a bunker', kind: 'draw', group: 'bunkers', drawKind: 'greensideBunker' },
      { id: 'cross-sand', label: 'Sand across', kind: 'tool', tool: 'cross', state: { crossKind: 'fairwayBunker' } },
    ] },
    { title: 'Water & waste', items: [
      { id: 'water-pond', label: 'Pond', kind: 'tool', tool: 'water', state: {} },
      { id: 'water-draw', label: 'Draw a lake', kind: 'draw', group: 'water' },
      { id: 'cross-water', label: 'Creek across', kind: 'tool', tool: 'cross', state: { crossKind: 'water' } },
      { id: 'cross-waste', label: 'Waste across', kind: 'tool', tool: 'cross', state: { crossKind: 'waste' } },
    ] },
    { title: 'Around the green', items: GUARD_TOKENS.map(([tok, label]) => ({ id: `guard-${tok}`, label, kind: 'guard', token: tok })) },
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
  y += 44;
  const water = [{ yd: y - 5, side: -1, off: 26, rx: 13, ry: 8.5, seed: 77 }];
  at['water-pond'] = [-26, y]; at['water-draw'] = [-26, y];
  y += 44;
  const cross = [];
  for (const kind of ['water', 'waste', 'fairwayBunker']) {
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
  const sections = paletteSections(built);
  const types = built.treeTypes || [];
  el.innerHTML = sections.map((sec) => `
    <div class="he-pal-section">
      <div class="he-pal-title">${sec.title}</div>
      <div class="he-pal-grid">
        ${sec.items.map((it) => {
          const on = it.kind === 'guard' ? guardsOn.includes(it.token) : it.id === active;
          return `<button type="button" class="he-tile${on ? ' is-on' : ''}" data-item="${it.id}" title="${it.label}">
            <canvas class="he-tile__pic" width="${TILE_W * 2}" height="${TILE_H * 2}"></canvas>
            <span class="he-tile__label">${it.label}${it.kind === 'guard' ? (on ? ' ✓' : '') : ''}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`).join('');
  const byId = new Map(sections.flatMap((s) => s.items).map((it) => [it.id, it]));
  for (const btn of el.querySelectorAll('.he-tile')) {
    const item = byId.get(btn.dataset.item);
    try { paintTile(btn.querySelector('canvas'), item, theme, types); } catch (e) { console.warn('[palette] tile failed', item.id, e); }
    btn.addEventListener('click', () => onPick(item));
  }
}

/** Which tile the current tool + options correspond to, so the palette can highlight it. */
export function activeItemFor(tool, toolState, drawing) {
  if (drawing) return drawing.group === 'water' ? 'water-draw' : 'bunker-draw';
  if (tool === 'tree') return `${toolState.treeMode === 'stand' ? 'stand' : 'tree'}-${toolState.treePlantType || 0}`;
  if (tool === 'bunker') return toolState.bunkerKind === 'fairwayBunker' ? 'bunker-fairway' : 'bunker-greenside';
  if (tool === 'water') return 'water-pond';
  if (tool === 'cross') return `cross-${toolState.crossKind === 'fairwayBunker' ? 'sand' : (toolState.crossKind || 'water')}`;
  return null;
}
