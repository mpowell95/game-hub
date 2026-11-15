// js/tips-log.js - WHO HAS SEEN EACH IN-GAME TIP, AND WHEN (2026-11-15). Root CLAUDE.md: "Any new popup, bubble or
// notice must report who saw it from day one." First used by Battle Arena's first-match tutorial (Matt: Ana "didn't
// really know what was going on").
//
// Each phone keeps, per game and tip id, when the tip first showed, how many times, and when it was dismissed (OK).
// js/stats-net.js mirrors it as `players/<id>/tips` with every sync (a REPORT, like `newDock`): read by
// tools/read-tips.mjs. Nothing reads it back on a phone, so a lost copy can never make a tip show or vanish (each
// game keeps its own "seen" list for that). Dependency-free (stats-net imports it).
//
// Shape (localStorage `gamehub.tipsLog.v1`, and the report): { <game>: { <tip>: { s: firstShownMs, n: count, d: doneMs } } }

const KEY = 'gamehub.tipsLog.v1';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); }
  catch (err) { console.error('[tips-log] not saved', err); }
}
const clean = (s) => String(s || '').replace(/[.#$/[\]]/g, '_').slice(0, 40);

/** A tip was put on screen. */
export function noteTipShown(game, tip) {
  const g = clean(game), t = clean(tip);
  if (!g || !t) return;
  const v = read();
  const row = ((v[g] = v[g] || {})[t] = v[g][t] || {});
  if (!row.s) row.s = Date.now();
  row.n = (row.n | 0) + 1;
  write(v);
}

/** The player dismissed it (OK, or it was replaced by their move). */
export function noteTipDone(game, tip) {
  const g = clean(game), t = clean(tip);
  if (!g || !t) return;
  const v = read();
  const row = ((v[g] = v[g] || {})[t] = v[g][t] || {});
  if (!row.d) row.d = Date.now();
  write(v);
}

/** The report stats-net mirrors (null while there is nothing to report). */
export function tipsReport() {
  const v = read();
  return Object.keys(v).length ? v : null;
}

/** Several devices' reports for one game, merged per tip: the earliest first show and done, the counts added. */
export function mergeTips(reps, game) {
  const out = {};
  for (const r of reps || []) {
    const g = r && r[game];
    if (!g || typeof g !== 'object') continue;
    for (const [t, row] of Object.entries(g)) {
      const o = (out[t] = out[t] || { s: 0, n: 0, d: 0 });
      if (row.s && (!o.s || row.s < o.s)) o.s = row.s;
      if (row.d && (!o.d || row.d < o.d)) o.d = row.d;
      o.n += row.n | 0;
    }
  }
  return out;
}
