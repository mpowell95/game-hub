// points-toast.js - "+X pts" the moment a win is counted (Matt, 2026-11-02: "show +X pts on every wins game's
// game-over / result screen"). js/game-stats.js announces each counted WIN as `gamehub:win` {id, d, mode, g};
// this works out what that win adds on the game's leaderboard (js/lb-points.js) and shows it in a pill over
// the result screen for a few seconds. DISPLAY ONLY: writes nothing, reads only the event's copy.
// Near-guaranteed levels: 1 until this phone's own record reaches the 20 cap, then nothing is shown (the cap
// is per person across devices; this phone can only see its own record, so it may show +1 once more).
import { pointsForWin, pointsKey, gamePoints, parseModeKey } from './lb-points.js';
import { LB_RULES } from './lb-rules.js';
import { tierOf } from './difficulty-tiers.js';
import { isTestGame } from './game-stats.js';
import { isAdminDevice } from './admin-config.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

import { puzzlePoints, HINT_STEPS, HINT_UNKNOWN } from './puzzle-points.js';
import { wwPoints } from './word-weaver-points.js';
import { wlPoints } from './word-ladder-points.js';

const t = makeT(STRINGS);

/** The puzzle boards (2026-11-16, Matt: Minesweeper showed no "+1 pt"; "All games should have that"): Minesweeper,
 *  Sudoku, Murdoku, Word Weaver, Word Ladder, and Nuts & Bolts (its points are still admin devices only). Gridlock and Arrow Maze
 *  show their own gain. `g` = the record before this win's level counters moved, `after` = once it was recorded. */
function puzzleWinPoints({ id, d, g, after, help }) {
  const tier = tierOf(d);
  if (id === 'sudoku' || id === 'murdoku') {
    if (!HINT_STEPS[tier]) return null;
    return { pts: help == null ? HINT_UNKNOWN[tier] : HINT_STEPS[tier][Math.min(3, Math.max(0, help | 0))] };
  }
  if (!after) return null;
  if (id === 'minesweeper' || (id === 'nutsbolts' && isAdminDevice())) return { pts: Math.max(0, puzzlePoints(after, id).pts - puzzlePoints(g, id).pts) };
  if (id === 'wordweaver') return { pts: Math.max(0, wwPoints(after) - wwPoints(g)) };
  // Word Ladder (2026-11-19): a level's first solve, or a better result on it (more stars), adds its band x stars.
  if (id === 'wordladder') return { pts: Math.max(0, wlPoints(after) - wlPoints(g)) };
  return null;
}
const isPointsBoard = (id) => { const r = LB_RULES[id]; return !!r && (r.by === 'wins' || r.by === 'cuppong'); };

/** The points one counted win adds: { pts } or null when the game has no points board. */
export function winPoints(detail) {
  const { id, d, mode, g } = detail || {};
  if (id && !isPointsBoard(id)) return puzzleWinPoints(detail);
  if (!id || !isPointsBoard(id) || d === 'solo') return null;
  const m = mode && mode !== '?' && mode !== '-' ? parseModeKey(mode) : null;
  const tier = tierOf(d);
  const lvl = tier ? pointsKey(id).levels.find((l) => l.tier === tier) : null;
  const ult = id === 'tictactoe' && m && m.v === 'ultimate';
  if (lvl && lvl.capped && !ult) {
    // This phone's own record, before and after this win: 1, or 0 once the 20 cap is reached.
    try {
      const before = JSON.parse(JSON.stringify(g));
      const b = before.byDiff && before.byDiff[d];
      if (b && b.won > 0) { b.won -= 1; if (before.total) before.total.won = Math.max(0, (before.total.won | 0) - 1); }
      const bm = before.byMode && mode && before.byMode[mode] && before.byMode[mode][detail.diff];
      if (bm && bm.won > 0) bm.won -= 1;
      return { pts: Math.max(0, gamePoints(g, id).pts - gamePoints(before, id).pts) };
    } catch { return { pts: 1 }; }
  }
  return { pts: pointsForWin(id, d, m) };
}

// A game may move the pill with `--gh-ptsgain-top` on <html> while it is mounted (Word Ladder, 2026-11-20: at 128px it sat
// on the finished ladder; it sets the top-bar row and removes it in destroy()). Unset = the old place, every other game.
let _css = false;
function ensureCss() {
  if (_css || typeof document === 'undefined') return;
  _css = true;
  const s = document.createElement('style');
  s.textContent = '.gh-ptsgain{position:fixed;left:50%;top:var(--gh-ptsgain-top,calc(var(--gh-st, env(safe-area-inset-top, 0px)) + 128px));transform:translate(-50%,-8px);'
    + 'z-index:2147483000;padding:8px 18px;border-radius:999px;background:#ffce3a;color:#1c2430;font:800 20px/1.2 system-ui,-apple-system,sans-serif;'
    + 'box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}'
    + '.gh-ptsgain.is-on{opacity:1;transform:translate(-50%,0)}'
    + '@media (prefers-reduced-motion: reduce){.gh-ptsgain{transition:none}}';
  document.head.appendChild(s);
}
let _el = null, _timer = 0;
export function showPoints(pts) {
  if (typeof document === 'undefined' || !(pts > 0)) return;
  ensureCss();
  if (!_el) {
    _el = document.createElement('div');
    _el.className = 'gh-ptsgain';
    _el.setAttribute('role', 'status');
    _el.setAttribute('aria-live', 'polite');
    document.body.appendChild(_el);
  }
  _el.textContent = t('lb_pts_gain', { n: pts });
  _el.classList.remove('is-on');
  void _el.offsetWidth;
  _el.classList.add('is-on');
  clearTimeout(_timer);
  _timer = setTimeout(() => { if (_el) _el.classList.remove('is-on'); }, 3200);
}

let _on = false;
/** Start listening (the hub calls this once). Admin-only games' test plays show nothing (they are not on a board). */
export function startPointsToast() {
  if (_on || typeof window === 'undefined') return;
  _on = true;
  window.addEventListener('gamehub:win', (e) => {
    try {
      const det = e && e.detail;
      if (!det || isTestGame(det.id)) return;
      const r = winPoints(det);
      if (r && r.pts > 0) showPoints(r.pts);
    } catch (err) { console.warn('[points-toast]', err); }
  });
}
export default { startPointsToast, winPoints, showPoints };
