// word-weaver/js/board.js - the DAILY PUZZLE's board (2026-11-02, Matt: "Do 1" = a daily puzzle, "its own small
// board like Spelling Bee's"). Spelling Bee's spelling-bee/js/board.js is the model.
//
// wwDaily/<lang>-<YYYY-MM-DD>/<CODE> = { name, emoji, o, at, stars?, hints?, sec? }
//   o      the server's time of the FIRST post (the puzzle's first open, or its completion if the phone was offline
//          until then); written once, never changed (rules).
//   at     the server's time of this post.
//   stars, hints, sec   the finished result: written ONCE, never changed or lowered afterwards (rules). `stars`
//          follows `hints` (0 = 3, 1 = 2, 2+ = 1; rules check it), `sec` = the solve time (ui.js `_dailySec`).
// Written by the player's own device only (rules: `$code` = this device's msgAuth claim). A second phone on the same
// code finds the row and keeps its `o`; once the row is finished it posts nothing.
//
// A REPORT of the local save (gamehub.wordweaver.daily.v1) and the stats store, never the record itself. A failed
// post logs loudly (rule 6) and is retried on the next open. Test automation and dev origins never write
// (`writesAllowed`). No player code reaches the page: rows carry an index into the in-memory list, never a code.
import { getStatsApp } from '../../js/firebase-boot.js';
import { writesAllowed } from '../../js/stats-net.js';
import { ensureAuthClaim, myCode } from '../../js/messages.js';
import { loadProfile } from '../../js/profile-store.js';
import { isHiddenName } from '../../js/hidden-players.js';
import { watchPath } from '../../js/live-read.js';

export const DAY_KEY_RE = /^(en|es)-\d{4}-\d{2}-\d{2}$/;
const DEV_HOST = (() => { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch { return false; } })();

/** Post this player's row on one day's board. `result` = { stars, hints, sec } once finished, else null (started).
 *  Resolves 'done' (a finished row is on the board, this one or an earlier one), 'started', or false (not posted). */
export async function postDaily(key, result) {
  const code = myCode();
  if (!code || !DAY_KEY_RE.test(key)) return false;
  if (!writesAllowed('Word Weaver daily board')) return false;
  const boot = await getStatsApp();
  if (!boot) return false;
  if (!(await ensureAuthClaim(boot))) return false;
  const p = (() => { try { return loadProfile() || {}; } catch { return {}; } })();
  const { db, api } = boot;
  const ref = api.ref(db, `wwDaily/${key}/${code}`);
  try {
    const snap0 = await api.get(ref);
    const cur = snap0 && snap0.exists() ? snap0.val() : null;
    if (cur && Number.isFinite(Number(cur.stars))) return 'done';            // finished (this phone or another): final
    if (cur && !result) return 'started';
    const row = {
      name: String(p.name || '').slice(0, 40), emoji: String(p.emoji || '').slice(0, 16),
      o: cur && Number.isFinite(Number(cur.o)) ? Number(cur.o) : api.serverTimestamp(),
      at: api.serverTimestamp(),
    };
    if (result) Object.assign(row, { stars: result.stars | 0, hints: Math.max(0, result.hints | 0), sec: Math.max(0, Math.round(result.sec) || 0) });
    await api.set(ref, row);
    const snap = await api.get(ref);
    const v = snap && snap.exists() ? snap.val() : null;
    if (!v || (result && !Number.isFinite(Number(v.stars)))) { console.error('[word-weaver] daily board post did not read back', v); return false; }
    return result ? 'done' : 'started';
  } catch (err) {
    console.error('[word-weaver] daily board post FAILED; will retry on the next open', err);
    return false;
  }
}

/** The server's first-post time of this player's row (`o`), or null. Used to time a puzzle begun on another phone. */
export async function readMyStart(key) {
  const code = myCode();
  if (!code || !DAY_KEY_RE.test(key)) return null;
  try {
    const boot = await getStatsApp();
    if (!boot) return null;
    const snap = await boot.api.get(boot.api.ref(boot.db, `wwDaily/${key}/${code}`));
    const v = snap && snap.exists() ? snap.val() : null;
    return v && Number.isFinite(Number(v.o)) ? Number(v.o) : null;
  } catch { return null; }
}

/** Watch one day's board. cb(rows): [{ code, name, emoji, stars, hints, sec, done }], board order. The codes stay in
 *  memory (the caller drops its own row and draws the rest by index). Returns an always-safe unsubscribe.
 *  On a dev server, `window.__wwBoardFake` (an object shaped like the node) stands in for Firebase (tests only). */
export function watchDaily(key, cb) {
  if (DEV_HOST) {
    try { if (window.__wwBoardFake && typeof window.__wwBoardFake === 'object') { cb(rowsOf(window.__wwBoardFake[key])); return () => {}; } } catch { /* the real one */ }
  }
  let stop = null, dead = false;
  if (!DAY_KEY_RE.test(key)) return () => {};
  getStatsApp().then((boot) => {
    if (!boot || dead) return;
    stop = watchPath(boot, `wwDaily/${key}`, (v) => cb(rowsOf(v)));
  }).catch(() => {});
  return () => { dead = true; if (stop) stop(); };
}

/** Pure: the stored node -> rows, test accounts out, finished first, in board order. */
export function rowsOf(v) {
  const rows = [];
  for (const [code, r] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (!r || typeof r !== 'object' || isHiddenName(r.name)) continue;
    const done = Number.isFinite(Number(r.stars)) && Number(r.stars) >= 1;
    rows.push({ code, name: String(r.name || ''), emoji: String(r.emoji || ''), done,
      stars: done ? Math.min(3, Number(r.stars) | 0) : 0, hints: done ? Math.max(0, Number(r.hints) | 0) : 0, sec: done ? Math.max(0, Number(r.sec) | 0) : 0 });
  }
  return rows.sort(byBoard);
}

/** The board's order (Matt's ask): most stars, then fewest hints, then fastest; unfinished last; then name. */
export function byBoard(a, b) {
  return (b.done - a.done) || (b.stars - a.stars) || (a.hints - b.hints) || (a.sec - b.sec) || String(a.name).localeCompare(String(b.name));
}

/** Pure: the rows a phone shows: everyone else's from the board, its OWN row from its own save (`mine`, always shown,
 *  a test name too), sorted, with places (ties share one). `me` = this phone's code. */
export function shownRows(rows, mine, me) {
  const out = (rows || []).filter((r) => !me || r.code !== me).map((r) => ({ ...r, me: false }));
  if (mine) out.push({ ...mine, me: true });
  out.sort(byBoard);
  let place = 0;
  out.forEach((r, i) => {
    const p = out[i - 1];
    if (!p || !(p.done === r.done && p.stars === r.stars && p.hints === r.hints && p.sec === r.sec)) place = i + 1;
    r.place = r.done ? place : 0;
  });
  return out;
}

/** "m:ss" (or "h:mm:ss") for a solve time in seconds. */
export function fmtSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
