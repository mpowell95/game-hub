// word-weaver/js/daily.js - THE DAILY PUZZLE's day and save (2026-11-02, Matt: "Do 1" = a daily puzzle: "one shared
// level a day, the same for everyone"). No DOM. The screens are in ui.js, the board in board.js.
//
// THE DAY is Spelling Bee's (spelling-bee/js/engine.js dayNumber): the LOCAL date (each phone's own midnight) of
// the SERVER's clock where known (js/server-time.js bestNow: the measured gap, else the phone's clock), so setting a
// phone a day ahead does not open tomorrow's puzzle once it has been online. Day 0 = the data's `epoch`. Only TODAY is
// playable: no calendar, no past days (kept simple; Spelling Bee's past days needed a "for fun" store of their own).
// A puzzle opened before midnight can still be finished after it, under the day it was opened.
//
// THE SAVE `gamehub.wordweaver.daily.v1` = { v: 1, d: { '<en|es>-<YYYY-MM-DD>': attempt } }, never the ladder saves.
// attempt = the ladder's shape { v, found, extra, hints, free, revealed, sym, recorded } plus
//   t0     bestNow() at the FIRST open (ms); t0s = true when that was the server's clock
//   ms     the solve clock so far: time on screen (performance.now) + every time away charged (measureAway)
//   away   an awayStamp() while the puzzle is not on screen (hidden, left, closed), charged at the next open
//   done   1 once every grid word was found; recorded = the recorder took it; posted = the board has the result
// Written after every word, hint, pause and resume; an attempt is never deleted (old days stay, rule 5).
import { bestNow, serverNow, awayStamp, measureAway } from '../../js/server-time.js';

export const DAILY_KEY = 'gamehub.wordweaver.daily.v1';

/** 'YYYY-MM-DD' for a Date, LOCAL time. */
export function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Whole days from `epoch` ('YYYY-MM-DD') to the local date of `d`. */
export function dayNumber(epoch, d) {
  const [y, m, dd] = String(epoch).split('-').map(Number);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(y, m - 1, dd)) / 86400000);
}
/** The local Date of day n (noon, so DST never moves it). */
export function dateOfDay(epoch, n) {
  const [y, m, dd] = String(epoch).split('-').map(Number);
  return new Date(y, m - 1, dd + n, 12);
}
/** Today, by the server's clock where known: { date, key(lang) }. */
export function today(now = bestNow()) {
  const date = new Date(now);
  return { date, key: (lang) => `${lang === 'es' ? 'es' : 'en'}-${dayKey(date)}` };
}

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
    if (v && typeof v === 'object' && v.d && typeof v.d === 'object' && !Array.isArray(v.d)) return v;
  } catch { /* none yet */ }
  return { v: 1, d: {} };
}
/** One day's attempt, or null. */
export function dailyAttempt(key) {
  const a = readAll().d[key];
  return a && typeof a === 'object' && !Array.isArray(a) ? a : null;
}
/** Every saved day: [[key, attempt], ...]. */
export function dailyAttempts() {
  return Object.entries(readAll().d).filter(([, a]) => a && typeof a === 'object' && !Array.isArray(a));
}
/** Write one day's attempt (merged over what is stored), verified by a fresh re-read (rule 6). */
export function writeDailyAttempt(key, patch) {
  const all = readAll();
  all.d[key] = { ...(all.d[key] || {}), ...patch, v: 1 };
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(all));
    const back = dailyAttempt(key);
    if (!back) throw new Error('did not read back');
    return true;
  } catch (err) { console.error('[word-weaver] daily progress NOT saved', err); return false; }
}

// --- the solve clock ----------------------------------------------------------------------------------------
// WHAT IS MEASURED: from the FIRST open of that day's puzzle (on any phone of this code: the board row's server
// time `o` when it is earlier) to the moment its last word is found, on the server's clock. Time away counts: the
// clock never stops for leaving, closing the app or the phone sleeping. Kept two ways and the LARGER is used:
//   wall  = finish - t0, both on the server's clock (when both were known);
//   ms    = time on screen (performance.now) + every stretch away charged by js/server-time.js measureAway (the
//           phone's clock, then topped up from the server's), so a phone clock set back while away gains nothing.

/** A fresh attempt's clock fields. */
export function clockStart(now = bestNow()) {
  return { t0: now, t0s: serverNow() != null, ms: 0, away: null };
}
/** The clock on hold: add the time on screen since `since` (performance.now) and stamp the moment it left. */
export function clockPause(a, since, perf = perfNow()) {
  const on = Number.isFinite(since) ? Math.max(0, perf - since) : 0;
  return { ms: Math.max(0, Number(a && a.ms) || 0) + on, away: awayStamp() };
}
/** The clock back on: the time away charged now (and `onServer(extra ms)` later, the server's top-up). */
export function clockResume(a, onServer) {
  if (!a || !a.away) return { ms: Math.max(0, Number(a && a.ms) || 0), away: null };
  const charged = measureAway(a.away, (srvAway) => { const more = srvAway - charged; if (more > 0 && onServer) onServer(more); });
  return { ms: Math.max(0, Number(a.ms) || 0) + charged, away: null };
}
/** The solve time in ms at the finish: the larger of the server-clock wall time and the running clock. */
export function clockSolve(a, { now = bestNow(), serverKnown = serverNow() != null, start = null } = {}) {
  const ms = Math.max(0, Number(a && a.ms) || 0);
  let wall = 0;
  if (a && a.t0s && serverKnown && Number.isFinite(Number(a.t0))) wall = now - Number(a.t0);
  if (Number.isFinite(start) && serverKnown) wall = Math.max(wall, now - start);
  return Math.round(Math.max(ms, wall, 0));
}
export function perfNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
