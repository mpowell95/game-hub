// js/new-dock-log.js - WHO HAS SEEN THE "NEW GAME" BUBBLE (2026-11-13, Matt: "WHY would you make it so we
// can't determine if someone has seen it? I ask you for this level of detail EVERY single time").
//
// Each phone keeps, per game id, the first and last time the bubble was really on its screen, how many times,
// and when it was tapped, put away (X) or the game was opened while new. js/stats-net.js mirrors it as
// `players/<id>/newDock` with every sync (a REPORT, like `announce`): the admin page (Sent) and
// tools/read-new-dock.mjs read it. Nothing reads it back on a phone, so a lost copy can never make the bubble
// show or vanish. Dependency-free (stats-net imports it).
//
// Shape (localStorage `gamehub.newDockLog.v1`, and the report):
//   { shown: {id: firstMs}, last: {id: lastMs}, n: {id: count}, tapped: {id: ms}, closed: {id: ms}, opened: {id: ms} }
//   (+ `done` in the report: hub.js's seen-list, gamehub.newDock.v3)

const KEY = 'gamehub.newDockLog.v1';
const KINDS = ['shown', 'last', 'n', 'tapped', 'closed', 'opened'];

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    const out = {};
    for (const k of KINDS) out[k] = v && v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) ? v[k] : {};
    return out;
  } catch { return Object.fromEntries(KINDS.map((k) => [k, {}])); }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); }
  catch (err) { console.error('[new-dock-log] not saved', err); }
}

/** The bubble was on screen showing these game ids. `last`/`n` move at most once a minute per game (a repaint
 *  is not a new look), so the report does not change, and upload, on every repaint. */
export function noteShown(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  const v = read();
  const now = Date.now();
  let changed = false;
  for (const id of list) {
    if (!v.shown[id]) { v.shown[id] = now; changed = true; }
    if (!v.last[id] || now - v.last[id] >= 60000) { v.last[id] = now; v.n[id] = (v.n[id] | 0) + 1; changed = true; }
  }
  if (changed) write(v);
}
/** 'tapped' | 'closed' | 'opened', first time only. */
export function noteAction(kind, ids) {
  if (!['tapped', 'closed', 'opened'].includes(kind)) return;
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  const v = read();
  let changed = false;
  for (const id of list) if (!v[kind][id]) { v[kind][id] = Date.now(); changed = true; }
  if (changed) write(v);
}
/** The report for players/<id>/newDock, or null when there is nothing yet (the node stays absent). */
export function newDockReport() {
  const v = read();
  // + `done`: js/hub.js's own seen-list (gamehub.newDock.v3: tapped, X or opened), which also covers what happened
  // between v1546 and this report existing (2026-11-13).
  let done = {};
  try { const d = JSON.parse(localStorage.getItem('gamehub.newDock.v3') || 'null'); if (d && d.seen && typeof d.seen === 'object') done = d.seen; } catch { done = {}; }
  const out = { ...v, done };
  return [...KINDS, 'done'].some((k) => Object.keys(out[k]).length) ? out : null;
}

/** Per PERSON over their devices' reports: { shown, last, n, tapped, closed, opened } for one game id
 *  (earliest first-shown, latest last-shown, counts added, earliest of each action). Pure; the admin page and
 *  tools/read-new-dock.mjs use it. */
export function mergeNewDock(reports, id) {
  const out = { shown: 0, last: 0, n: 0, tapped: 0, closed: 0, opened: 0, done: 0 };
  const min = (a, b) => (a && b ? Math.min(a, b) : a || b || 0);
  for (const r of reports || []) {
    if (!r || typeof r !== 'object') continue;
    const g = (k) => +((r[k] || {})[id]) || 0;
    out.shown = min(out.shown, g('shown'));
    out.last = Math.max(out.last, g('last'));
    out.n += g('n') | 0;
    for (const k of ['tapped', 'closed', 'opened', 'done']) out[k] = min(out[k], g(k));
  }
  return out;
}

export default { noteShown, noteAction, newDockReport, mergeNewDock };
