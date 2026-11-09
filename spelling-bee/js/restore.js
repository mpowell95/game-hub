// spelling-bee/js/restore.js - put back words a phone lost (2026-11-09, Matt: re-adding the Home Screen
// app wiped the day's words: "Please add them back").
//
// Every accepted word is already in the server's guess log (beeLog/<puzzle>/<CODE>, js/log.js, since
// 2026-10-27) and each day's count in beeDaily/<puzzle>/<CODE>. When the board says this code found more
// words on a puzzle than this phone's save holds, the missing accepted words (r 'ok' / 'bonus', never a
// for-fun 'fguess') are appended to the save with their times. ADDITIVE only: nothing in the save is
// removed or reordered (THE LAW rule 2).
//
// NEVER COUNTED TWICE: a restored day was already counted by the phone that found the words, so it is
// marked in `days` (countDays then skips it), and a day the board shows at Genius or better is marked
// `recorded` + `seenGenius` (no second Genius win, no second popup).
//
// Cost: today's board row (a few bytes) on each open; every day's row once per phone per language
// (stamp gamehub.spellingbee.restored.v1). A log is read only for a day that is actually short.
import { getStatsApp } from '../../js/firebase-boot.js';
import { myCode } from '../../js/messages.js';
import { GENIUS, dayKey, dateOfDay, puzzleAt, puzzleOf } from './engine.js';
import { boardKey } from './board.js';

const STAMP = 'gamehub.spellingbee.restored.v1';
const POSTED_KEY = 'gamehub.spellingbee.posted.v1';
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function stamped(lang) {
  try { return !!(JSON.parse(localStorage.getItem(STAMP) || '{}') || {})[lang]; } catch { return false; }
}
function stamp(lang) {
  try { const v = JSON.parse(localStorage.getItem(STAMP) || '{}') || {}; v[lang] = Date.now(); localStorage.setItem(STAMP, JSON.stringify(v)); }
  catch { /* the full check simply runs again next open */ }
}

/** The days to check: today always; every day (and each retired puzzle) once per phone per language. */
function puzzlesToCheck(data, todayN) {
  const out = [];
  const full = !stamped(data.lang);
  for (let n = full ? 0 : todayN; n <= todayN; n++) {
    out.push({ n, puzzle: puzzleAt(data, n) });
    const old = data.retired && data.retired[n];
    if (full && old) out.push({ n, puzzle: puzzleOf(old, data.lang) });
  }
  return { list: out, full };
}

/**
 * Merge the server's words into `save` (the object loadSave() returned). Resolves the number of words
 * added. `alive()` is asked before writing anything: once the caller has moved on, nothing is changed.
 * `write(save)` is the game's own verified writer.
 */
export async function restoreFromServer(data, save, todayN, { alive = () => true, write, code = myCode(), read = null } = {}) {
  if (!code || !data || !isObj(save) || !isObj(save.games)) return 0;
  if (!read) {   // `read` is passed only by tools/test-bee-restore.mjs
    const boot = await getStatsApp();
    if (!boot) return 0;
    const { db, api } = boot;
    read = (p) => api.get(api.ref(db, p)).then((s) => (s && s.exists() ? s.val() : null)).catch(() => undefined);
  }
  const { list, full } = puzzlesToCheck(data, todayN);
  const rows = await Promise.all(list.map(({ puzzle }) => read(`beeDaily/${boardKey(puzzle.key)}/${code}`)));
  let added = 0, failed = rows.some((r) => r === undefined);
  const posted = {};
  for (let i = 0; i < list.length; i++) {
    const { n, puzzle } = list[i];
    const row = rows[i];
    if (!isObj(row) || !(row.words > 0)) continue;
    const have = isObj(save.games[puzzle.key]) && Array.isArray(save.games[puzzle.key].found) ? save.games[puzzle.key].found.length : 0;
    if (row.words <= have) continue;
    const log = await read(`beeLog/${boardKey(puzzle.key)}/${code}`);
    if (log === undefined) { failed = true; continue; }
    if (!isObj(log)) continue;
    const words = [];
    const times = {};
    for (const e of Object.values(log).filter(isObj).sort((a, b) => (+a.t || 0) - (+b.t || 0))) {
      if (e.e !== 'guess' || (e.r !== 'ok' && e.r !== 'bonus') || typeof e.w !== 'string' || !e.w) continue;
      if (!(e.w in times)) { words.push(e.w); times[e.w] = +e.t || undefined; }
    }
    if (!alive()) return 0;
    const day = dayKey(dateOfDay(data.epoch, n));
    let r = save.games[puzzle.key];
    if (!isObj(r)) r = save.games[puzzle.key] = {};
    if (!Array.isArray(r.found)) r.found = [];
    if (!r.day) r.day = day;
    if (!isObj(r.times)) r.times = {};
    const missing = words.filter((w) => !r.found.includes(w));
    if (!missing.length) continue;
    for (const w of missing) {
      r.found.push(w);
      if (!Number.isFinite(r.times[w]) && Number.isFinite(times[w])) r.times[w] = times[w];
    }
    added += missing.length;
    // Already counted by the phone that found them: never a second play or Genius win.
    save.days[`${String(puzzle.key).startsWith('es:') ? 'es' : 'en'}:${r.day}`] = 1;
    if (Math.max(+row.rank || 0, +row.dr || 0) >= GENIUS) {
      r.recorded = true;
      r.seenGenius = true;
      if (!r.geniusAt && Number.isFinite(+row.tg)) r.geniusAt = +row.tg;
    }
    posted[boardKey(puzzle.key)] = row.words;
  }
  if (!alive()) return 0;
  if (added) {
    if (!write(save)) return 0;
    try {
      const m = JSON.parse(localStorage.getItem(POSTED_KEY) || '{}') || {};
      for (const [k, v] of Object.entries(posted)) m[k] = Math.max(+m[k] || 0, v);
      localStorage.setItem(POSTED_KEY, JSON.stringify(m));
    } catch { /* a needless re-post at worst, refused by the rules */ }
    console.info(`[spelling-bee] restored ${added} word(s) from the server`);
  }
  if (full && !failed) stamp(data.lang);
  return added;
}
