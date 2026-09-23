// hole-editor/js/tray.js - THE PHONE'S PICTURE TRAYS (2026-09-23, isometric look stage 2).
//
// Matt, on the phone mockup: a bottom bar of seven picture buttons (Move, Trees, Sand, Water, Green,
// Fairway, More), each opening a tray of tiles, like the Pocket Metropolis toy. And on the mockup's
// emoji: "those trees don't look like colored hearts". So every tile here is a small ISOMETRIC
// PICTURE of the thing itself - a patch of grass on a soil block with the tree, bunker or pond on it
// - drawn by iso.js's own `drawIsoTree` and the game's own colours (`fillsFor`), so a tile looks
// like what lands on the map.
//
// The items are palette.js's (`paletteSections`), so a tile does exactly what the desktop palette's
// tile of the same id does (`onPick` is main.js's one pick handler). Only the grouping and the
// pictures are the phone's own. The desktop editor does not use this file.

import { paletteSections, GUARD_TOKENS } from './palette.js';
import { fillsFor, paletteFor, TREE_FILL } from '../../golf/js/render.js';
import { OBSTACLE_CATALOG } from '../../golf/js/obstacles.js';
import { isoProject, isoGroundMatrix, drawIsoTree, drawIsoWire, mix, Z } from './iso.js';

const catalogByName = new Map(OBSTACLE_CATALOG.map((c) => [c.name, c]));
const typeInfo = (ty) => ({ ...(catalogByName.get(ty.name) || {}), ...ty });
const shapeOf = (ty) => typeInfo(ty).shape || (ty.name === 'saguaro' ? 'cactus' : 'canopy');
const looksOf = (ty) => typeInfo(ty).looks || [];

/** The seven bottom-bar buttons. `icon` is inline SVG (a tile of its own, not an emoji). */
export const TABS = [
  ['move', 'Move', '<svg viewBox="0 0 28 28"><path d="M9 4l12 10-5.5 1 3.4 6.8-3 1.5-3.4-6.9L9 20z" fill="#fffaf3" stroke="#4a4063" stroke-width="1.6" stroke-linejoin="round"/></svg>'],
  ['trees', 'Trees', '<svg viewBox="0 0 28 28"><path d="M14 26l11-5.5L14 15 3 20.5z" fill="#a8d5a2"/><rect x="12.9" y="12" width="2.2" height="9" rx="1" fill="#9a7654"/><circle cx="14" cy="10" r="6.5" fill="#86c07f"/><circle cx="11.8" cy="8" r="2.8" fill="#b2dea9"/></svg>'],
  ['sand', 'Sand', '<svg viewBox="0 0 28 28"><path d="M14 25l12-6-12-6-12 6z" fill="#a8d5a2"/><path d="M2 19v2.5l12 6V25z" fill="#d2ad8a"/><path d="M26 19v2.5l-12 6V25z" fill="#bf9676"/><ellipse cx="14" cy="19" rx="6.5" ry="3" fill="#f3e2b8"/><ellipse cx="13" cy="18.5" rx="3" ry="1.2" fill="#fbf0d4"/></svg>'],
  ['water', 'Water', '<svg viewBox="0 0 28 28"><path d="M14 25l12-6-12-6-12 6z" fill="#a8d5a2"/><path d="M2 19v2.5l12 6V25z" fill="#d2ad8a"/><path d="M26 19v2.5l-12 6V25z" fill="#bf9676"/><ellipse cx="14" cy="19" rx="7" ry="3.4" fill="#7ec8e3"/><path d="M10 19q2-1 4 0t4 0" stroke="#e9f7fb" stroke-width="1" fill="none"/><path d="M14 3c3 4 4.5 6 4.5 8a4.5 4.5 0 0 1-9 0c0-2 1.5-4 4.5-8z" fill="#7ec8e3"/></svg>'],
  ['green', 'Green', '<svg viewBox="0 0 28 28"><path d="M14 25l12-6-12-6-12 6z" fill="#a8d5a2"/><path d="M2 19v2.5l12 6V25z" fill="#d2ad8a"/><path d="M26 19v2.5l-12 6V25z" fill="#bf9676"/><ellipse cx="14" cy="19" rx="8" ry="3.8" fill="#c9ec9a"/><ellipse cx="15" cy="19.5" rx="1.4" ry=".7" fill="#4a4063"/><line x1="15" y1="19.5" x2="15" y2="5" stroke="#4a4063" stroke-width="1.3"/><path d="M15.5 5l7 2.4-7 2.4z" fill="#ff6b6b"/></svg>'],
  ['fairway', 'Fairway', '<svg viewBox="0 0 28 28"><path d="M6 24C6 15 21 15 21 7" stroke="#8cc76a" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M6 24C6 15 21 15 21 7" stroke="#fff" stroke-width="1" stroke-dasharray="2 2" fill="none"/><circle cx="6" cy="24" r="2" fill="#fff" stroke="#4a4063"/><line x1="21" y1="7" x2="21" y2="1.5" stroke="#4a4063" stroke-width="1.3"/><path d="M21.5 1.5l5 1.8-5 1.8z" fill="#ff6b6b"/></svg>'],
  ['more', 'More', '<svg viewBox="0 0 28 28"><g fill="#4a4063"><rect x="5" y="7" width="18" height="2.6" rx="1.3"/><rect x="5" y="12.7" width="18" height="2.6" rx="1.3"/><rect x="5" y="18.4" width="18" height="2.6" rx="1.3"/></g></svg>'],
];

/** Which bottom-bar button a tool belongs to (so the bar shows what is armed). */
export function tabForTool(tool, toolState) {
  if (tool === 'select') return 'move';
  if (tool === 'tree') return 'trees';
  if (tool === 'bunker') return 'sand';
  if (tool === 'water') return 'water';
  if (tool === 'cross') return toolState.crossKind === 'fairwayBunker' ? 'sand' : 'water';
  if (tool === 'green') return 'green';
  if (tool === 'route' || tool === 'width' || tool === 'slope' || tool === 'ruler') return 'fairway';
  return null;
}

// Trees are grouped by what they LOOK like, which is what someone scanning a tray is looking for.
const TREE_GROUPS = [
  ['Leafy', ['canopy', 'willow']],
  ['Evergreen', ['fir', 'cypress']],
  ['Palms', ['palm']],
  ['Desert', ['cactus', 'joshua']],
  ['Shrubs', ['bush', 'gorse']],
  ['Bare', ['dead']],
  ['Rocks & logs', ['rock', 'rocks', 'log']],
];

const FAIRWAY_TOOLS = [
  { id: 'fw-route', label: 'Route', kind: 'ptool', tool: 'route' },
  { id: 'fw-width', label: 'Width', kind: 'ptool', tool: 'width' },
  { id: 'fw-slope', label: 'Slope', kind: 'ptool', tool: 'slope' },
  { id: 'fw-ruler', label: 'Ruler', kind: 'ptool', tool: 'ruler' },
];

let _filterAll = false;   // "This terrain" / "All" in the Trees tray (per page load)

/** The tray's contents for one tab: `{ title, segs, groups: [{ title, items }] }`. Pure. */
export function trayModel(tab, built, theme, toolState) {
  const secs = paletteSections(built, theme);
  const sec = (title) => secs.find((s) => s.title === title) || { items: [] };
  if (tab === 'trees') {
    const types = built.treeTypes || [];
    const stand = toolState.treeMode === 'stand';
    const anyLook = types.some((ty) => looksOf(ty).includes(theme));
    const groups = TREE_GROUPS.map(([title, shapes]) => ({
      title,
      items: types.map((ty, i) => ({ ty, i }))
        .filter(({ ty }) => shapes.includes(shapeOf(ty)))
        .filter(({ ty }) => _filterAll || !anyLook || looksOf(ty).includes(theme))
        .map(({ i }) => {
          const all = sec('Trees & rocks').subs.flatMap((s) => s.items);
          return all.find((it) => it.id === `${stand ? 'stand' : 'tree'}-${i}`);
        }).filter(Boolean),
    })).filter((g) => g.items.length);
    return {
      title: 'Trees & rocks',
      segs: [
        { key: 'treeMode', opts: [['single', 'One tree'], ['stand', 'A row of trees']], val: stand ? 'stand' : 'single' },
        ...(anyLook ? [{ key: 'filter', opts: [['look', 'This terrain'], ['all', 'All']], val: _filterAll ? 'all' : 'look' }] : []),
      ],
      groups,
    };
  }
  if (tab === 'sand') return { title: 'Sand', groups: [{ title: '', items: sec('Sand').items }] };
  if (tab === 'water') return { title: 'Water', groups: [{ title: '', items: sec('Water & waste').items }] };
  if (tab === 'green') {
    return { title: 'Green', groups: [
      { title: '', items: [{ id: 'green-tool', label: 'Shape, fringe & pins', kind: 'ptool', tool: 'green' }] },
      { title: 'Around the green (tap to add or remove)', items: sec('Around the green').items },
    ] };
  }
  if (tab === 'fairway') return { title: 'Fairway', groups: [{ title: '', items: FAIRWAY_TOOLS }] };
  return { title: '', groups: [] };
}

export function setTreeFilterAll(v) { _filterAll = !!v; }

// --- the pictures ------------------------------------------------------------------------------

const TW = 80; const TH = 66;   // css px per tile picture; painted at 2x

/** A little soil block with a grass top, and a ground-plane painter for things lying on it. */
function scene(canvas, theme) {
  canvas.width = TW * 2; canvas.height = TH * 2;
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  const S = 10;                                   // the block is 20 x 20 yd
  const k = (W * 0.42) / (2 * S);
  const cam = { ppy: k, cx: 0, cy: 0 };
  const off = H * 0.2;                            // push the block down, leave sky for tall things
  const P = (x, y, z = 0) => { const p = isoProject(cam, W, H, x, y, z); return [p[0], p[1] + off]; };
  const G = isoGroundMatrix(cam, W, H);
  const pal = paletteFor(theme);
  const FILL = fillsFor(pal);
  // Anything lying on the grass is clipped to the block, so a creek or a fairway ends at its edge.
  const ground = () => { ctx.save(); ctx.setTransform(G[0], G[1], G[2], G[3], G[4], G[5] + off); ctx.beginPath(); ctx.rect(-S, -S, 2 * S, 2 * S); ctx.clip(); };
  const flat = () => ctx.restore();
  const D = 3.2;
  const face = (a, b, c, d, col) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  face(P(-S, -S), P(S, -S), P(S, -S, -D), P(-S, -S, -D), '#d9b690');
  face(P(S, -S), P(S, S), P(S, S, -D), P(S, -S, -D), '#c49c78');
  const g0 = P(-S, -S); const g1 = P(S, -S); const g2 = P(S, S); const g3 = P(-S, S);
  face(g0, g1, g2, g3, mix(FILL.lightRough || '#8bb35a', '#fffaf3', 0.18));
  return { ctx, P, k, ground, flat, FILL, pal, theme };
}

function blobOnGround(sc, cx, cy, rx, ry, fill, edge) {
  const { ctx } = sc;
  sc.ground();
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0.35, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (edge) { ctx.lineWidth = 0.6; ctx.strokeStyle = edge; ctx.stroke(); }
  sc.flat();
}

function stripOnGround(sc, pts, w, col) {
  const { ctx } = sc;
  sc.ground();
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col; ctx.stroke();
  sc.flat();
}

function treeAt(sc, x, y, ty, scale = 1) {
  const info = typeInfo(ty);
  const shape = shapeOf(ty);
  const [bx, by] = sc.P(x, y);
  const H = info.height || 15; const R = info.canopy || 4;
  // One common size, like the desktop palette's singles: fit the tallest things to the tile.
  const low = shape === 'rock' || shape === 'rocks' || shape === 'bush' || shape === 'gorse' || shape === 'log';
  const kk = (low ? 22 / R : Math.min(70 / Math.max(4, H * Z), 34 / R)) * scale;
  const [fill] = TREE_FILL[ty.name] || ['#3f6b34'];
  sc.ctx.fillStyle = 'rgba(40,40,60,.16)';
  sc.ctx.beginPath(); sc.ctx.ellipse(bx - 2, by + 1, Math.max(4, R * kk * 0.9), Math.max(2, R * kk * 0.4), 0, 0, Math.PI * 2); sc.ctx.fill();
  drawIsoTree(sc.ctx, bx, by, { shape, k: kk, fill, muted: false, R, H: shape === 'rock' || shape === 'rocks' ? R : H, trunk: info.trunk || 0.8, seed: 0.3, poleH: 10 });
}

function pencil(sc) {
  const { ctx } = sc;
  const W = ctx.canvas.width;
  ctx.fillStyle = '#fffaf3'; ctx.beginPath(); ctx.arc(W - 22, 22, 17, 0, Math.PI * 2); ctx.fill();
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#4a4063'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('✎', W - 22, 23);
}

function greenPatch(sc) {
  blobOnGround(sc, 0, 0, 6.5, 5, sc.FILL.fringe || '#9fcf6a');
  blobOnGround(sc, 0, 0, 5.2, 3.9, sc.FILL.green || '#b9e27f');
  const [px, py] = sc.P(0.5, 0.5);
  const { ctx } = sc;
  ctx.fillStyle = 'rgba(40,40,40,.6)'; ctx.beginPath(); ctx.ellipse(px, py, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fffaf3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 40); ctx.stroke();
  ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.moveTo(px + 1, py - 40); ctx.lineTo(px + 17, py - 34); ctx.lineTo(px + 1, py - 28); ctx.closePath(); ctx.fill();
}

/** Paint `item`'s picture. `types` is the built hole's tree table. */
export function paintTrayTile(canvas, item, theme, types) {
  const sc = scene(canvas, theme);
  const { FILL } = sc;
  const sand = FILL.fairwayBunker || '#e9d7a6';
  const water = FILL.water || '#4aa3d8';
  const id = item.id;
  const treeM = /^(tree|stand)-(\d+)$/.exec(id);
  if (treeM) {
    const ty = types[+treeM[2]];
    if (!ty) return;
    if (treeM[1] === 'tree') treeAt(sc, 0, 0, ty);
    else for (const [x, y] of [[-5, 4], [0, 0], [5, -4]]) treeAt(sc, x, y, ty, 0.7);
    return;
  }
  if (id === 'bunker-fairway' || id === 'bunker-draw') {
    stripOnGround(sc, [[-10, -3], [10, 3]], 9, FILL.fairway || '#8cc76a');
    blobOnGround(sc, 1, -1, 5, 3, sand, 'rgba(120,90,50,.35)');
    if (id === 'bunker-draw') pencil(sc);
    return;
  }
  if (id === 'bunker-greenside') { greenPatch(sc); blobOnGround(sc, -6, -5, 3.5, 2.4, sand, 'rgba(120,90,50,.35)'); return; }
  if (id.startsWith('cross-')) {
    const col = id === 'cross-sand' ? sand : id === 'cross-water' ? water : id === 'cross-swamp' ? (FILL.swamp || '#3d5a3a') : '#d8c49a';
    stripOnGround(sc, [[-10, 0], [10, 0]], 12, FILL.fairway || '#8cc76a');
    stripOnGround(sc, [[0, -10], [1, -3], [-1, 3], [0, 10]], 5, col);
    return;
  }
  if (id.startsWith('water-')) {
    const swamp = id.includes('swamp');
    blobOnGround(sc, 0, 0, 7, 5, swamp ? (sc.pal.swampEdge || '#5c7a4a') : (sc.pal.bank || '#6b3330'));
    blobOnGround(sc, 0, 0, 6.2, 4.3, swamp ? (FILL.swamp || '#3d5a3a') : water);
    if (!swamp) {
      const { ctx } = sc; const [x, y] = sc.P(-1, 1);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.quadraticCurveTo(x - 5, y - 4, x, y); ctx.quadraticCurveTo(x + 5, y + 4, x + 10, y); ctx.stroke();
    }
    if (id.endsWith('-draw')) pencil(sc);
    return;
  }
  if (id.startsWith('guard-')) {
    greenPatch(sc);
    const tok = item.token || '';
    const put = (x, y) => {
      if (/Sand|Jaws/.test(tok)) blobOnGround(sc, x, y, 2.6, 1.8, sand, 'rgba(120,90,50,.35)');
      else if (/Water/.test(tok)) blobOnGround(sc, x, y, 3, 2, water);
      else if (/Trees/.test(tok)) treeAt(sc, x, y, { name: 'oak', shape: 'canopy', canopy: 5, height: 11, trunk: 0.8 }, 0.55);
    };
    if (tok === 'ringSand') { for (const [x, y] of [[-7, -2], [7, 2], [-2, 7], [2, -7]]) put(x, y); return; }
    if (tok === 'frontJaws') { put(-5, -7); put(5, -7); return; }
    if (tok.startsWith('front')) put(0, -8.5);
    else if (tok.startsWith('back')) put(0, 8.5);
    else if (tok.startsWith('left')) put(-8.5, 0);
    else if (tok.startsWith('right')) put(8.5, 0);
    return;
  }
  if (id === 'green-tool') { greenPatch(sc); return; }
  if (id === 'fw-route' || id === 'fw-width') {
    const pts = [[-9, -9], [-3, -1], [3, 1], [9, 9]];
    stripOnGround(sc, pts, 7, FILL.fairway || '#8cc76a');
    const { ctx } = sc;
    if (id === 'fw-route') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); pts.forEach((p, i) => { const q = sc.P(p[0], p[1]); if (i) ctx.lineTo(...q); else ctx.moveTo(...q); }); ctx.stroke(); ctx.setLineDash([]);
      for (const p of pts.slice(1, 3)) { const [x, y] = sc.P(p[0], p[1]); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4a4063'; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
    } else {
      const a = sc.P(-3.5, 3.5); const b = sc.P(3.5, -3.5);
      ctx.strokeStyle = '#4a4063'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      for (const [p, q] of [[a, b], [b, a]]) { const ang = Math.atan2(p[1] - q[1], p[0] - q[0]); ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(p[0] - 9 * Math.cos(ang - 0.5), p[1] - 9 * Math.sin(ang - 0.5)); ctx.moveTo(...p); ctx.lineTo(p[0] - 9 * Math.cos(ang + 0.5), p[1] - 9 * Math.sin(ang + 0.5)); ctx.stroke(); }
    }
    return;
  }
  if (id === 'fw-slope') {
    blobOnGround(sc, 0, 0, 7, 5.5, FILL.green || '#b9e27f');
    const { ctx } = sc;
    ctx.strokeStyle = mix(FILL.green || '#b9e27f', '#000000', 0.35); ctx.lineWidth = 2.5;
    for (const [x, y] of [[-3, 2], [2, 2], [-1, -3], [4, -3]]) {
      const [px, py] = sc.P(x, y);
      ctx.beginPath(); ctx.moveTo(px - 6, py - 4); ctx.lineTo(px, py + 1); ctx.lineTo(px + 6, py - 4); ctx.stroke();
    }
    return;
  }
  if (id === 'fw-ruler') {
    const { ctx } = sc; const a = sc.P(-7, -5); const b = sc.P(7, 5);
    ctx.strokeStyle = '#ffce3a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    ctx.fillStyle = '#ffce3a'; for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#4a4063'; ctx.textAlign = 'center';
    ctx.fillText('yd', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10);
    return;
  }
  if (id === 'power-line') {
    const pts = [[-8, 6], [0, 0], [8, -6]];
    for (const p of pts) { const [x, y] = sc.P(p[0], p[1]); drawIsoTree(sc.ctx, x, y, { shape: 'pole', k: sc.k, fill: '#9a9a92', R: 0.3, H: 10, trunk: 0.3, seed: 0, poleH: 8 }); }
    drawIsoWire(sc.ctx, (x, y, z = 0) => sc.P(x, y, z), pts, 8, sc.k);
    return;
  }
  if (id === 'decor-path') { stripOnGround(sc, [[-10, -4], [-2, 2], [4, -1], [10, 5]], 2.5, '#d8d2c4'); pencil(sc); }
}

/** Render one tray into `el`. `ctx`: { built, theme, toolState, active, guardsOn, onPick(item),
 *  onSeg(key, val) }. */
export function renderTray(el, tab, c) {
  const model = trayModel(tab, c.built, c.theme, c.toolState);
  const types = c.built.treeTypes || [];
  const all = [];
  const seg = (s) => `<div class="he-tseg" data-seg="${s.key}">${s.opts.map(([v, l]) => `<button type="button" data-v="${v}"${v === s.val ? ' class="is-on"' : ''}>${l}</button>`).join('')}</div>`;
  const tile = (it) => {
    all.push(it);
    const on = it.kind === 'guard' ? c.guardsOn.includes(it.token) : (it.kind === 'ptool' ? c.tool === it.tool : it.id === c.active);
    return `<button type="button" class="he-ttile${on ? ' is-on' : ''}" data-item="${it.id}"${it.kind === 'ptool' ? ` data-tool-pick="${it.tool}"` : ''}><canvas></canvas><span>${it.label}</span></button>`;
  };
  el.innerHTML = `<div class="he-tray-head"><span>${model.title}</span><button type="button" class="he-tray-x" aria-label="Close">&times;</button></div>
    <div class="he-tray-body">${(model.segs || []).map(seg).join('')}${model.groups.map((g) => `${g.title ? `<div class="he-tray-sub">${g.title}</div>` : ''}<div class="he-tray-grid">${g.items.map(tile).join('')}</div>`).join('')}</div>`;
  const byId = new Map(all.map((it) => [it.id, it]));
  for (const b of el.querySelectorAll('.he-ttile')) {
    const it = byId.get(b.dataset.item);
    try { paintTrayTile(b.querySelector('canvas'), it, c.theme, types); } catch (e) { console.warn('[tray] tile failed', it.id, e); }
    b.addEventListener('click', () => c.onPick(it));
  }
  for (const s of el.querySelectorAll('[data-seg]')) {
    for (const b of s.querySelectorAll('button')) b.addEventListener('click', () => c.onSeg(s.dataset.seg, b.dataset.v));
  }
  el.querySelector('.he-tray-x').addEventListener('click', () => c.onClose());
}

export { GUARD_TOKENS };
