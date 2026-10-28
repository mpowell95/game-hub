// bee-board.js - the phone's copy of Spelling Bee's long-term board (2026-10-28).
//
// The server builds it (functions/bee.js, js/bee-fairplay.js buildBeeBoard) into boards/v1/bee, one
// small JSON string, so no phone reads every day's rows. This watches it, keeps the last one in
// memory and in localStorage (`gamehub.beeBoard.v1`, a cache for an instant first paint, never the
// record: the server copy always wins), and hands out per-person totals (beeTotals).
//
// Readers: the Leaderboard's Spelling Bee board, By Game and the You tab (js/leaderboard-ui.js), and
// My Stats' Spelling Bee page (js/game-stats-ui.js). Read only.
import { getStatsApp } from './firebase-boot.js';
import { watchPath } from './live-read.js';
import { beeTotals } from './bee-fairplay.js';

const CACHE_KEY = 'gamehub.beeBoard.v1';
let _board = null;
const _subs = new Set();
let _stop = null;

function parse(v) {
  if (typeof v !== 'string' || !v) return null;
  try { const b = JSON.parse(v); return b && Array.isArray(b.days) ? b : null; } catch { return null; }
}

/** The last board seen (memory, else the local cache), or null. Never throws. */
export function beeBoard() {
  if (_board) return _board;
  try { _board = parse(localStorage.getItem(CACHE_KEY)); } catch { _board = null; }
  return _board;
}

/** Watch the board; cb(board) on each change. Returns an always-safe unsubscribe. */
export function watchBeeBoard(cb) {
  _subs.add(cb);
  if (!_stop) {
    let dead = false, off = null;
    _stop = () => { dead = true; if (off) off(); _stop = null; };
    getStatsApp().then((boot) => {
      if (!boot || dead) return;
      off = watchPath(boot, 'boards/v1/bee', (v) => {
        const b = parse(v);
        if (!b) return;
        _board = b;
        try { localStorage.setItem(CACHE_KEY, v); } catch { /* memory only */ }
        for (const f of _subs) { try { f(b); } catch (err) { console.error('[bee-board] subscriber', err); } }
      });
    }).catch(() => {});
  }
  return () => { _subs.delete(cb); if (!_subs.size && _stop) _stop(); };
}

/** One person's totals for a toggle (lang 'all'|'en'|'es', by 'points'|'words'), or null. */
export function beeRowOf(code, opts) {
  const b = beeBoard();
  if (!b || !code) return null;
  return beeTotals(b, opts).find((r) => r.code === code) || null;
}

export { beeTotals };
