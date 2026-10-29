// minesweeper/js/ui.js - the DOM shell, input, timer and the module contract. Every rule about
// mines, flood fill, chording and winning lives in engine.js; nothing here decides anything about
// the board.
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md, "The module
// contract"). `destroy()` must be leak-free - the hub reuses the same container for the next game.
//
// isInProgress() RETURNS FALSE, DELIBERATELY. Autosave/resume built in (root CLAUDE.md's second
// isInProgress() meaning): the board and the clock are saved after every input, so leaving is
// lossless. The Sudoku / Nuts & Bolts class, not the Ball Run class.
import '../../js/theme.js';   // side effect: stamps .gh-dark so this screen themes standalone too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { recordMinesweeper } from '../../js/game-stats.js';
import { loadStats } from '../../js/game-stats.js';
import { awayStamp, measureAway } from '../../js/server-time.js';
import E, { LEVELS, OPEN, FLAGGED, QUESTION } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.minesweeper.v1';
const SAVE_KEY = 'gamehub.minesweeper.save.v1';     // the first build's ONE slot: read once, never written again
const SAVES_KEY = 'gamehub.minesweeper.saves.v1';   // one paused board per level (2026-10-15)
const LEVEL_ORDER = ['easy', 'medium', 'hard', 'expert'];

// How long a press has to be held before it flags instead of digs. 450ms is above the ~300ms a
// deliberate tap takes and below the ~600ms where a hold stops feeling like a shortcut.
const LONG_PRESS_MS = 450;
// A press that wanders further than this is a drag (retargeting), never a tap-and-hold, so the
// long-press timer is cancelled. In CSS pixels, generous because a thumb rolls.
const DRAG_SLOP = 14;

// How long the blast owns the screen before the result modal arrives. Long enough to actually
// WATCH: VISUAL-PROCESS.md's motion rule exists because a cannonball that was on screen for 340ms
// passed every static check and could not be seen. The reveal cascade runs inside this window.
const BLAST_MS = 1150;
// Delay per ring of cells as the other mines reveal outward from the one that was hit, capped so a
// far corner of an Expert board never waits longer than the blast itself.
const CASCADE_STEP_MS = 46;
const CASCADE_MAX_MS = 620;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ms) => {
  const total = Math.max(0, Math.floor((ms | 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const fill = (str, vals) => String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));

/* ---------------------------------------------------------------------------------------------
 * glyphs. Flag is a pennant, mine is a spiked disc, a wrong flag is the pennant struck through:
 * all three read without any colour at all, which is the rule wherever colour is a choice here.
 * ------------------------------------------------------------------------------------------- */
const FLAG_SVG = (c) => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 22V3" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><path d="M6.6 4.2 19 8.4 6.6 12.6Z" fill="${c}"/></svg>`;
const MINE_SVG = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${c}"><rect x="11" y="1.5" width="2" height="21" rx="1"/><rect x="1.5" y="11" width="21" height="2" rx="1"/><rect x="4" y="4" width="2" height="16" rx="1" transform="rotate(-45 5 12)"/><rect x="18" y="4" width="2" height="16" rx="1" transform="rotate(45 19 12)"/><circle cx="12" cy="12" r="6.2"/><circle cx="9.7" cy="9.7" r="1.5" fill="rgba(255,255,255,.85)"/></svg>`;
const WRONG_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M6.6 4.2 19 8.4 6.6 12.6Z" fill="currentColor" opacity=".35"/><path class="ms-wx" d="M3 3 21 21M21 3 3 21" stroke="#e0532f" stroke-width="2.8" stroke-linecap="round"/></svg>`;
const BRAND_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="11" y="1" width="2" height="22" rx="1" fill="currentColor"/><rect x="1" y="11" width="22" height="2" rx="1" fill="currentColor"/><rect x="4" y="4" width="2" height="16" rx="1" transform="rotate(-45 5 12)" fill="currentColor"/><rect x="18" y="4" width="2" height="16" rx="1" transform="rotate(45 19 12)" fill="currentColor"/><circle cx="12" cy="12" r="6.6" fill="currentColor"/><circle cx="9.6" cy="9.6" r="1.7" fill="#ffffff" opacity=".85"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="2"/><path d="M12 6.8V12l3.6 2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const X_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>`;
const TICK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12.6 9.6 18 20 6.4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SHOVEL_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 3.2 20.8 10.5M17.2 6.9 8.4 15.7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8.4 15.7 5.6 12.9 2.6 19.2c-.3.7.4 1.4 1.1 1.1Z" fill="currentColor"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 40 24" width="40" height="24" fill="none" aria-hidden="true"><path d="M4 12h30M27 5l7 7-7 7" stroke="#1769d4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FACE_SVG = (kind) => {
  const eyes = kind === 'dead'
    ? '<path d="M8 8.6 11 11.6M11 8.6 8 11.6M16 8.6 13 11.6M13 8.6 16 11.6" stroke="#16243a" stroke-width="1.7" stroke-linecap="round"/>'
    : kind === 'win'
      ? '<path d="M6.4 9.2h4.4v2.6a2.2 2.2 0 0 1-4.4 0Zm6.8 0h4.4v2.6a2.2 2.2 0 0 1-4.4 0Zm-2.4.9h2.4" stroke="#16243a" stroke-width="1.5" fill="#16243a"/>'
      : '<circle cx="9" cy="10" r="1.5" fill="#16243a"/><circle cx="15" cy="10" r="1.5" fill="#16243a"/>';
  const mouth = kind === 'dead'
    ? '<path d="M8.6 17.2a3.6 3.6 0 0 1 6.8 0" stroke="#16243a" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    : kind === 'win'
      ? '<path d="M8.2 15.4a4.2 4.2 0 0 0 7.6 0" stroke="#16243a" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      : '<path d="M9 16.4h6" stroke="#16243a" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" fill="#f2b705" stroke="#c8960a" stroke-width="1.2"/>${eyes}${mouth}</svg>`;
};

/* ---------------------------------------------------------------------------------------------
 * settings + save. Both try/catch and treat anything malformed as absent: a corrupt save must
 * read as "no save", never as a crash (js/CLAUDE.md's reader rule, same as every other game here).
 * ------------------------------------------------------------------------------------------- */
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    return {
      version: 1,
      level: LEVEL_ORDER.includes(v.level) ? v.level : 'easy',
      // safeFirst is carried, never shown (2026-10-15): its switch did nothing (the first tap is
      // always an opening), so it was removed; the stored value is kept as it was (rule 5).
      safeFirst: v.safeFirst !== false,
      longPress: v.longPress !== false,
      vibrate: v.vibrate === true,
      // "?" marks in Flag mode (2026-10-15): flag -> ? -> blank. On unless turned off.
      marks: v.marks !== false,
      // NO-GUESS boards (2026-10-15): Matt's devices only. Since 2026-10-16 they COUNT like any
      // board (Matt: "Make my games count"), tallied as well in `ms.noGuess` (js/game-stats.js).
      // The switch was removed 2026-10-16 (Matt: "remove the 'No guessing' toggle"); the stored
      // value is still read and carried, and no longer deals anything.
      noGuess: v.noGuess === true,
    };
  } catch { return { version: 1, level: 'easy', safeFirst: true, longPress: true, vibrate: false, marks: true }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[minesweeper] settings', err); }
  return next;
}
/** ONE PAUSED BOARD PER LEVEL (Matt, 2026-10-15: "keep a paused board for each level"):
 *  `gamehub.minesweeper.saves.v1` = { easy?, medium?, hard?, expert? }, each the old save's shape.
 *  The first build kept a single slot in `gamehub.minesweeper.save.v1`; the first time the map is
 *  missing, that board is carried into it at its own level and the old key is left exactly as it is
 *  (rule 5: never deleted, never repurposed; once the map exists it is simply not read again). */
function readSaves() {
  let map = null;
  try { map = JSON.parse(localStorage.getItem(SAVES_KEY) || 'null'); } catch { map = null; }
  if (map && typeof map === 'object' && !Array.isArray(map)) return map;
  map = {};
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    const st = raw && typeof raw === 'object' ? E.deserialize(raw.state) : null;
    if (st && st.generated && !st.dead && !st.won) map[st.level] = raw;
  } catch { /* nothing to carry */ }
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(map)); } catch (err) { console.error('[minesweeper] saves', err); }
  return map;
}
function loadSave(level) {
  try {
    const raw = readSaves()[level];
    if (!raw || typeof raw !== 'object') return null;
    const state = E.deserialize(raw.state);
    if (!state || state.level !== level) return null;
    if (state.dead || state.won) return null;   // a finished board is not a resume
    if (!state.generated) return null;          // an untouched board is not worth resuming
    const away = raw.away && typeof raw.away === 'object' && Number.isFinite(raw.away.w) ? raw.away : null;
    return { state, mode: raw.mode === 'flag' ? 'flag' : 'dig', away };
  } catch { return null; }
}
/** `away` (2026-10-29): the moment the app went to the background with this board on screen
 *  (js/server-time.js awayStamp, plus `el`, the clock then). A board resumed from it is charged the
 *  time away, so a page killed in the background is no free study time. */
function writeSave(state, mode, away) {
  try {
    const map = readSaves();
    map[state.level] = { v: 1, state: E.serialize(state), mode, ...(away ? { away } : {}) };
    localStorage.setItem(SAVES_KEY, JSON.stringify(map));
  } catch (err) { console.error('[minesweeper] save', err); }
}
/** Two tabs on one storage (2026-10-29): the same paused board could be open in both, so a mine dug
 *  in one (the board then shows every mine) could be cleared in the other. A board is only played,
 *  and only saved, while its level's slot still holds it unfinished: same mines, same level. */
function sameBoard(a, b) {
  if (!a || !b || a.level !== b.level || !a.mine || !b.mine || a.mine.length !== b.mine.length) return false;
  for (let i = 0; i < a.mine.length; i++) if (!!a.mine[i] !== !!b.mine[i]) return false;
  return true;
}
function slotHolds(g) {
  try {
    const raw = readSaves()[g.level];
    const st = raw && typeof raw === 'object' ? E.deserialize(raw.state) : null;
    return st && st.generated && !st.dead && !st.won && sameBoard(st, g) ? st : null;
  } catch { return null; }
}
function clearSave(level) {
  try {
    const map = readSaves();
    if (!(level in map)) return;
    delete map[level];
    localStorage.setItem(SAVES_KEY, JSON.stringify(map));
  } catch { /* a save we cannot clear is harmless: loadSave() rejects a finished board anyway */ }
}

/** Best times per level, read straight out of the shared stats store so the setup screen and My
 *  Stats can never disagree. Returns `{}` on any failure: a missing best is shown as "--:--",
 *  which is the truth, and is never mistaken for a time of zero. */
function bestTimes() {
  try {
    const st = loadStats();
    const ms = ((st.games || {}).minesweeper || {}).ms || {};
    return ms.bestTimeMs && typeof ms.bestTimeMs === 'object' ? ms.bestTimeMs : {};
  } catch { return {}; }
}
/** Best % cleared per level (2026-10-15), shown where a level has no best time yet. */
function bestCleared() {
  try {
    const ms = ((loadStats().games || {}).minesweeper || {}).ms || {};
    return ms.bestClearedPct && typeof ms.bestClearedPct === 'object' ? ms.bestClearedPct : {};
  } catch { return {}; }
}
function winsSoFar() {
  try { return ((loadStats().games || {}).minesweeper || {}).total.won | 0; } catch { return 0; }
}

class MinesweeperUI {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.screen = 'menu';
    this.mode = 'dig';
    this.game = null;
    this.cellEls = null;
    this.elapsedMs = 0;
    this._tickHandle = 0;
    this._lastTickAt = 0;
    this._press = null;
    this._longPressTimer = 0;
    this._result = null;
    // Every timer this screen starts is tracked, because destroy() must be leak-free: the hub
    // reuses the same container for the next game, and a blast timer firing into a torn-down
    // screen would paint into nothing.
    this._timers = [];

    this.root = document.createElement('div');
    this.root.className = 'ms-root';
    container.appendChild(this.root);

    this._away = null;
    this._onVisibility = () => {
      // TIME AWAY COUNTS (2026-10-29). The board stays visible in the app switcher and in a
      // screenshot, so a paused clock was free study time. Hidden with a started board on screen:
      // the clock is banked and the moment stamped (also into the save, for a page killed in the
      // background); back: the time away is charged, topped up by the server's clock once known
      // (js/server-time.js measureAway). Leaving to the menu or How to play still pauses: the board
      // is not on screen there.
      const g = this.game;
      if (document.hidden) {
        this._stopTimer();
        if (this.screen === 'play' && g && g.generated && !g.dead && !g.won) {
          this._away = { ...awayStamp(), el: this.elapsedMs | 0 };
          this._persist();
        }
        return;
      }
      if (this._away) {
        const a = this._away;
        this._away = null;
        this._chargeAway(a);
      }
      if (this.screen === 'play' && g && !g.dead && !g.won && g.generated) this._startTimer();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._positionRoot();
    this.renderMenu();
    // The hub switches its header to the immersive button around the same moment it mounts us;
    // measure again once that has painted.
    requestAnimationFrame(() => { if (this.root) { this._positionRoot(); this._fit(); } });
  }

  /* ---- layout ------------------------------------------------------------------------------ */

  // Pins the root to the mount point's real on-screen slot. A CSS-only `inset: 0` fills whichever
  // box happens to be the containing block, and in the hub that is the wrong box (.hub-game has no
  // defined height), which puts this screen over the hub's own sticky header. Only JS can measure
  // the actual offset. Copied from sudoku/js/ui.js, which hit this exact bug.
  //
  // The BOTTOM is pinned with `bottom: 0`, never a height computed from the viewport. It used to be
  // `height = visualViewport.height - top`, measured once at mount: on an iPhone that measurement
  // could land mid-transition with a short viewport, and the setup screen was cut off below "Your
  // best time" for the rest of the visit (Matt, 2026-10-11, screenshot). `bottom: 0` follows the
  // real screen edge with nothing to re-measure. It is also re-run on every screen render.
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    this.root.style.bottom = '0px';
    this.root.style.height = 'auto';
    // IMMERSIVE in the hub (2026-10-15, Matt wanted a real title, not the hub's plain header): the
    // hub's header collapses to its floating "Hub" button and this game's own title row sits
    // BESIDE it. Measured, as murdoku/js/ui.js does: the button's size and the top inset differ by
    // device and language. Standalone there is no button and the row simply starts at the top.
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      this.root.classList.add('is-immersive');
      this.root.style.top = '0px';
      this.root.style.setProperty('--ms-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--ms-inset', Math.max(0, Math.round(b.right - r.left + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.max(0, Math.round(r.top)) + 'px';
  }

  /** The title row every screen opens with: the wordmark, centred on the screen, with an optional
   *  button on the right. In the hub the left of the row is the hub's own floating Hub button. */
  _topbar(right = '') {
    return `<div class="ms-top"><span></span><div class="ms-brand">${BRAND_SVG}<span>${esc(t('title'))}</span></div><div class="ms-topr">${right}</div></div>`;
  }

  // Cell size is MEASURED, never a vh formula: the wrap is the flex child that owns whatever is
  // left after the HUD and the bar, so its own client box is the honest answer in both hosts
  // (standalone and mounted in the hub's chrome). docs/BUILDING-A-GAME.md Part 3.
  _fit() {
    if (this.screen !== 'play' || !this.boardEl) return;
    const wrap = this.boardEl.parentElement;
    if (!wrap) return;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (availW <= 0 || availH <= 0) {
      // A zero-size measurement means layout has not settled (the .hub-game height trap). Retry on
      // the next frame rather than baking a nonsense cell size in.
      requestAnimationFrame(() => this._fit());
      return;
    }
    const g = this.game;
    const gap = 2;
    const byW = Math.floor((availW - (g.w - 1) * gap) / g.w);
    const byH = Math.floor((availH - (g.h - 1) * gap) / g.h);
    const size = Math.max(16, Math.min(byW, byH));
    this.cellSize = size;
    this.boardEl.style.setProperty('--ms-cell-size', size + 'px');
    this.boardEl.style.gridTemplateColumns = `repeat(${g.w}, ${size}px)`;
  }

  /* ---- setup screen ------------------------------------------------------------------------ */

  renderMenu() {
    this.screen = 'menu';
    this._stopTimer();
    this._clearTimers();
    const s = this.settings;
    const bests = bestTimes();
    const closest = bestCleared();
    const saved = loadSave(s.level);
    const diffs = LEVEL_ORDER.map((id) => {
      const L = LEVELS[id];
      // A level with a paused board shows a pause mark and its clock instead of its size.
      const paused = loadSave(id);
      const meta = paused
        ? `<span class="ms-dmeta is-paused">${PAUSE_SVG}${esc(fmtTime(paused.state.elapsedMs | 0))}</span>`
        : `<span class="ms-dmeta">${esc(fill(t('board_fmt'), { w: L.w, h: L.h, n: L.mines }))}</span>`;
      return `<button type="button" class="ms-diff" data-level="${id}" aria-pressed="${s.level === id}">
        <span class="ms-dshape">${diffShapeSVG(L.tier)}</span>
        <span class="ms-dname">${esc(t(id))}</span>
        ${meta}
        <span class="ms-dtick">${TICK_SVG}</span>
      </button>`;
    }).join('');
    const bestCells = LEVEL_ORDER.map((id) => {
      const v = bests[id] | 0;
      const pct = closest[id] | 0;
      return `<div><b>${v > 0 ? fmtTime(v) : pct > 0 ? pct + '%' : esc(t('no_time'))}</b><span>${esc(t(id))}</span></div>`;
    }).join('');
    // A SETTING THAT CANNOT WORK IS NOT OFFERED. iOS Safari has no navigator.vibrate at all, so on
    // every iPhone here this row was a switch that flipped and then did nothing for ever, which is
    // worse than its absence. The STORED value is left exactly as it is (rule 5 - keys are never
    // deleted or repurposed), so a device that supports it keeps whatever the player chose.
    const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    const opt = (key, labelKey, subKey) => `<button type="button" class="ms-opt" data-opt="${key}" aria-pressed="${!!s[key]}">
      <span><span class="ms-olab">${esc(t(labelKey))}</span>${subKey ? `<span class="ms-osub">${esc(t(subKey))}</span>` : ''}</span>
      <span class="ms-sw"><i></i></span>
    </button>`;

    // The selected level has a paused board: New game (left) and Resume (right), Matt's order
    // (2026-10-15). New game replaces THAT level's board only; every other level keeps its own.
    // No paused board here: one Play button.
    const ctaHTML = saved
      ? `<div class="ms-cta ms-ctarow">
          <button type="button" class="gh-btn gh-btn--block" data-act="newsel">${esc(t('new_game'))}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play">${esc(t('resume'))}</button>
        </div>`
      : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block ms-cta" data-act="play">${esc(t('play'))}</button>`;
    this._positionRoot();
    this.root.innerHTML = `<div class="ms-screen ms-setup">
      ${this._topbar()}
      <div class="ms-card"><h3>${esc(t('difficulty'))}</h3><div class="ms-diffs">${diffs}</div></div>
      <div class="ms-card"><h3>${esc(t('your_best'))}</h3><div class="ms-bests">${bestCells}</div></div>
      <div class="ms-card"><h3>${esc(t('options'))}</h3><div class="ms-opts">
        ${opt('marks', 'marks_opt', '')}
        ${opt('longPress', 'long_press', '')}
        ${canVibrate ? opt('vibrate', 'vibrate', '') : ''}
      </div></div>
      ${ctaHTML}
      <div class="ms-linkrow">
        <button type="button" class="gh-btn" data-act="howto">${esc(t('how_to_play'))}</button>
        <button type="button" class="gh-btn" data-act="board">${esc(t('leaderboard'))}</button>
      </div>
    </div>`;

    this.root.onclick = (ev) => {
      const lv = ev.target.closest('[data-level]');
      if (lv) {
        // Settings persist on SELECTION, not only at game start (docs/BUILDING-A-GAME.md, setup
        // screen defaults). A game whose only save call sits in its start path has that bug.
        this.settings = saveSettings({ level: lv.dataset.level });
        this.renderMenu();
        return;
      }
      const op = ev.target.closest('[data-opt]');
      if (op) {
        const k = op.dataset.opt;
        this.settings = saveSettings({ [k]: !this.settings[k] });
        // Switching vibration ON buzzes once, so the control proves itself instead of being a
        // promise you only find out about mid-game.
        if (k === 'vibrate' && this.settings.vibrate) this._buzz();
        this.renderMenu();
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'play') this.startOrResume();
      else if (act.dataset.act === 'newsel') {
        // Over a paused board: two taps, the button saying it counts as a loss (2026-10-29).
        if (this._quitBoard(this.settings.level) && act.dataset.armed !== '1') { act.dataset.armed = '1'; act.textContent = t('quit_loss'); return; }
        this.newGame(this.settings.level);
      }
      else if (act.dataset.act === 'howto') this.renderHowTo();
      else if (act.dataset.act === 'board') this._openLeaderboard();
    };
  }



  /* ---- how to play -------------------------------------------------------------------------- */

  // Explains the two genuinely non-obvious mechanics and nothing else: chording, and the
  // commit-on-release targeting. Everybody already knows what a mine is
  // (docs/BUILDING-A-GAME.md Part 2, "Explain only the one genuinely non-obvious mechanic").
  renderHowTo() {
    // Opened from a board (the ? at the top right), its close goes back to that board.
    this._helpFrom = (this.screen === 'play' && this.game) ? 'play' : 'menu';
    if (this._helpFrom === 'play') { this._stopTimer(); this._persist(); }
    this.screen = 'howto';
    this._stopTimer();
    this._clearTimers();
    const mini = (cls, inner) => `<div class="ms-c ms-minic ${cls}">${inner}</div>`;
    const grid3 = (cells, px) => `<div class="ms-board" style="grid-template-columns:repeat(3,${px}px);--ms-cell-size:${px}px">${cells}</div>`;
    const before = grid3([
      mini('is-open n1', '1'), mini('', ''), mini('', ''),
      mini('is-open n2', '2'), mini('is-open n3 is-target', '3'), mini('', FLAG_SVG('#e0532f')),
      mini('', FLAG_SVG('#e0532f')), mini('', FLAG_SVG('#e0532f')), mini('', ''),
    ].join(''), 30);
    const after = grid3([
      mini('is-open n1', '1'), mini('is-open', ''), mini('is-open n1', '1'),
      mini('is-open n2', '2'), mini('is-open n3', '3'), mini('', FLAG_SVG('#e0532f')),
      mini('', FLAG_SVG('#e0532f')), mini('', FLAG_SVG('#e0532f')), mini('is-open n2', '2'),
    ].join(''), 30);

    // THE BACK BUTTON IS AT THE TOP, and that is the fix, not a preference. It used to sit under
    // the content, so the moment the content was a line too tall the button was the thing clipped
    // off the bottom - and the only way out of this screen was to leave the game entirely.
    // Anchored in a fixed-height header it cannot be pushed anywhere by anything below it.
    this._positionRoot();
    this.root.innerHTML = `<div class="ms-screen ms-help">
      <div class="ms-top"><span></span><h2 class="ms-htitle">${esc(t('how_to_play'))}</h2><div class="ms-topr"><button type="button" class="gh-btn gh-btn--icon ms-hback" data-act="back" aria-label="${esc(t('close'))}">${X_SVG}</button></div></div>
      <p class="ms-lead">${esc(t('help_lead'))}</p>
      <div class="ms-dia">
        <div class="ms-diarow">${before}${ARROW_SVG}${after}</div>
        <p class="ms-cap">${esc(t('help_chord_cap'))}</p>
      </div>
      <div class="ms-dia">
        <div class="ms-diarow">
          <div class="ms-loupedemo">
            <div class="ms-board" style="grid-template-columns:repeat(3,26px);--ms-cell-size:26px">
              ${mini('', '')}${mini('is-target', '')}${mini('', '')}
            </div>
            <div class="ms-loupe ms-loupe--demo"><div class="ms-zc"></div></div>
          </div>
          <p class="ms-cap">${esc(t('help_loupe_cap'))}</p>
        </div>
      </div>
    </div>`;
    this.root.onclick = (ev) => {
      if (!ev.target.closest('[data-act="back"]')) return;
      if (this._helpFrom === 'play' && this.game) this.renderGame(); else this.renderMenu();
    };
  }

  /* ---- play --------------------------------------------------------------------------------- */

  /** Charge the time a board spent on screen in the background (see _onVisibility). */
  _chargeAway(a) {
    const g = this.game;
    if (!g || g.dead || g.won) return;
    const base = Math.max(this.elapsedMs | 0, a.el | 0);
    const now = measureAway(a, (srv) => {
      const more = srv - now;
      if (more > 0 && this.game === g && !g.dead && !g.won) { this.elapsedMs += more; this._persist(); this._syncHud(); }
    });
    this.elapsedMs = base + now;
    this._persist();
  }

  startOrResume() {
    const saved = loadSave(this.settings.level);
    if (saved) {
      this.game = saved.state; this.mode = saved.mode; this.elapsedMs = saved.state.elapsedMs | 0;
      this.game._saved = true;
      if (saved.away) this._chargeAway(saved.away);
    }
    else { this.game = E.createGame(this.settings.level, { noGuess: this._noGuessOn(this.settings.level) }); this.mode = 'dig'; this.elapsedMs = 0; }
    this._result = null;
    this.renderGame();
  }

  /** EASY IS ALWAYS NO-GUESS, for everyone (Matt, 2026-10-16: "Easy MUST be NO GUESS EVER", after
   *  an Easy board ended in a forced 50/50). Medium, Hard and Expert are always ordinary boards:
   *  Matt's admin-only switch for them was removed 2026-10-16 ("remove the 'No guessing' toggle"). */
  _noGuessOn(level) { return level === 'easy'; }

  newGame(level) {
    this._clearTimers();
    const lv = level || (this.game && this.game.level) || this.settings.level;
    this._recordQuitLoss(lv);   // a started board thrown away is a loss (2026-10-29)
    clearSave(lv);
    this.game = E.createGame(lv, { noGuess: this._noGuessOn(lv) });
    this.mode = 'dig';
    this.elapsedMs = 0;
    this._result = null;
    this.renderGame();
  }

  renderGame() {
    this.screen = 'play';
    const g = this.game;
    this._positionRoot();
    const L = LEVELS[g.level] || LEVELS.easy;
    this.root.innerHTML = `<div class="ms-screen ms-play">
      ${this._topbar(`<button type="button" class="gh-btn gh-btn--icon ms-helpbtn" data-act="howto" aria-label="${esc(t('help_aria'))}">?</button>`)}
      <div class="ms-hdr">
        <button type="button" class="ms-level" data-act="tomenu" aria-label="${esc(t('change_difficulty'))}">${diffShapeSVG(L.tier)}<span>${esc(t(g.level))}</span>${g.noGuess && g.level !== 'easy' ? '<i class="ms-ng">NG</i>' : ''}</button>
        <div class="ms-readout" data-role="mines" aria-live="off">${FLAG_SVG('#e0532f')}<span data-role="mines-n">000</span></div>
        <button type="button" class="ms-face" data-act="new" aria-label="${esc(t('new_game'))}">${FACE_SVG('ok')}</button>
        <div class="ms-readout" data-role="clock">${CLOCK_SVG}<span data-role="clock-n">00:00</span></div>
      </div>
      <div class="ms-boardwrap">
        <div class="ms-board" role="grid" aria-label="${esc(t('title'))}"></div>
        <div class="ms-loupe" hidden><div class="ms-zc"></div><span class="ms-lbadge" aria-hidden="true">${FLAG_SVG('#ffffff')}</span></div>
      </div>
      <div class="ms-bar">
        <div class="gh-seg" role="group">
          <button type="button" class="gh-seg__item" data-mode="dig" aria-pressed="${this.mode === 'dig'}">${SHOVEL_SVG}<span>${esc(t('dig'))}</span></button>
          <button type="button" class="gh-seg__item" data-mode="flag" aria-pressed="${this.mode === 'flag'}">${FLAG_SVG('currentColor')}<span>${esc(t('flag'))}</span></button>
        </div>
      </div>
    </div>`;

    // Test seam, same shape as sudoku's `window.__sdTest`: it exposes the board so a probe can
    // find a safe cell to tap, rather than guessing and hitting a mine. Read-only; nothing in the
    // game reads it back.
    try {
      window.__msTest = {
        state: () => ({
          w: g.w, h: g.h, mines: g.mines,
          mine: g.mine.slice(), cell: g.cell.slice(), num: g.num.slice(),
          generated: g.generated, dead: g.dead, won: g.won,
          elapsedMs: this.elapsedMs, mode: this.mode,
        }),
        ui: this,
      };
    } catch { /* no window */ }

    this.boardEl = this.root.querySelector('.ms-board');
    this.loupeEl = this.root.querySelector('.ms-loupe');
    this.minesEl = this.root.querySelector('[data-role="mines-n"]');
    this.clockEl = this.root.querySelector('[data-role="clock-n"]');
    this.faceEl = this.root.querySelector('.ms-face');

    this._buildBoard();
    this._syncMode();
    this._fit();
    // Two extra passes: the first measurement can land before flex has settled, which is the
    // .hub-game height trap in its mildest form.
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    this._paintAll();
    this._bindBoard();

    // Dig / Flag switch on the TOUCH, not on click (Matt, 2026-10-16: "Somehow I still miss them").
    // A click is dropped when the finger slides a few pixels before lifting, which a fast thumb
    // does; and the empty strip between the board and the bar was dead. So everything below the
    // board (16px clear of its last row) is one Dig | Flag zone, split where the two buttons split.
    // Changing mode is all it ever does, never a dig. The click below stays for the keyboard.
    this.root.onpointerdown = (ev) => {
      const bar = this.root && this.root.querySelector('.ms-bar');
      if (!bar || !this.boardEl || ev.button > 0) return;
      if (ev.target.closest('.ms-ov, .ms-board, [data-act]')) return;
      if (ev.clientY < this.boardEl.getBoundingClientRect().bottom + 16) return;
      const seg = bar.querySelector('.gh-seg').getBoundingClientRect();
      this._setMode(ev.clientX < seg.left + seg.width / 2 ? 'dig' : 'flag');
    };

    this.root.onclick = (ev) => {
      const md = ev.target.closest('[data-mode]');
      if (md) { this._setMode(md.dataset.mode); return; }
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'tomenu') this._backToMenu();
      else if (act.dataset.act === 'new') this._askNewGame();
      else if (act.dataset.act === 'newyes') this.newGame();
      else if (act.dataset.act === 'howto') this.renderHowTo();
      else if (act.dataset.act === 'close') this._dismissResult();
      else if (act.dataset.act === 'again') this.newGame();
      else if (act.dataset.act === 'menu') this.renderMenu();
      else if (act.dataset.act === 'board') this._openLeaderboard();
    };

    if (g.dead || g.won) this._showResult(false);
    else if (g.generated) this._startTimer();
  }

  /** Back to the setup screen, keeping the board.
   *
   *  No confirm, deliberately: the save is written on the way out and the clock is banked with it,
   *  so the setup screen comes up offering Resume and the board is exactly where it was. That is
   *  the same property `isInProgress()` returns false for - leaving this game costs nothing. */
  _backToMenu() {
    this._stopTimer();
    this._persist();
    this.renderMenu();
  }

  _buildBoard() {
    const g = this.game;
    this.cellEls = new Array(g.w * g.h);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < g.w * g.h; i++) {
      // A div with role, NOT a real <button>: Safari before 16.4 will not reliably let a <button>
      // be a flex container, and this is the component drawn up to 252 times per screen
      // (dominoes/CLAUDE.md states this as the general rule, not a Dominoes workaround).
      const c = document.createElement('div');
      c.className = 'ms-c';
      c.dataset.i = String(i);
      c.setAttribute('role', 'gridcell');
      frag.appendChild(c);
      this.cellEls[i] = c;
    }
    this.boardEl.innerHTML = '';
    this.boardEl.appendChild(frag);
  }

  _paintCell(i) {
    const g = this.game;
    const el = this.cellEls[i];
    if (!el) return;
    const x = i % g.w, y = (i / g.w) | 0;
    const st = g.cell[i];
    let cls = 'ms-c';
    let inner = '';
    let aria;
    if (st === OPEN) {
      cls += ' is-open';
      if (g.mine[i]) {
        // Only reachable after a loss (revealAll), or on the one cell that ended it.
        cls += (i === g.boom) ? ' is-boom' : '';
        inner = MINE_SVG(i === g.boom ? '#ffffff' : 'currentColor');
        aria = fill(t('cell_aria_open'), { r: y + 1, c: x + 1, n: '*' });
      } else if (g.num[i] > 0) {
        cls += ' n' + g.num[i];
        inner = String(g.num[i]);
        aria = fill(t('cell_aria_open'), { r: y + 1, c: x + 1, n: g.num[i] });
      } else {
        aria = fill(t('cell_aria_empty'), { r: y + 1, c: x + 1 });
      }
    } else if (g.won && g.mine[i]) {
      // A cleared board shows every mine as a flag, in the safe colour, whether or not the player
      // bothered to place it: at that point they are all accounted for, and leaving some blank
      // reads as unfinished work. The counter agrees (see _syncHud).
      inner = FLAG_SVG('#178a7a');
      aria = fill(t('cell_aria_flag'), { r: y + 1, c: x + 1 });
    } else if (st === FLAGGED) {
      // After a loss a flag on a safe cell is shown struck through: the flag was wrong, and
      // saying so is the whole point of the reveal.
      // (2026-10-14, Matt) It also GLOWS: `.is-wrong` rings it in the #ffce3a accent and pulses
      // it, and lifts it above the result popup's dim, so a mis-marked square cannot be missed.
      const wrong = g.dead && !g.mine[i];
      if (wrong) cls += ' is-wrong';
      inner = wrong ? WRONG_SVG : FLAG_SVG(g.won ? '#178a7a' : '#e0532f');
      aria = fill(t(wrong ? 'cell_aria_wrong' : 'cell_aria_flag'), { r: y + 1, c: x + 1 });
    } else if (st === QUESTION) {
      cls += ' is-q';
      inner = '?';
      aria = fill(t('cell_aria_q'), { r: y + 1, c: x + 1 });
    } else {
      aria = fill(t('cell_aria_hidden'), { r: y + 1, c: x + 1 });
    }
    el.className = cls;
    el.innerHTML = inner;
    el.setAttribute('aria-label', aria);
  }

  _paintAll() {
    for (let i = 0; i < this.cellEls.length; i++) this._paintCell(i);
    this._syncHud();
  }

  _syncHud() {
    const g = this.game;
    // A cleared board has every mine accounted for, so the counter reads zero rather than
    // however many flags the player happened to place.
    const left = g.won ? 0 : E.minesLeft(g);
    if (this.minesEl) {
      const n = Math.abs(left);
      this.minesEl.textContent = (left < 0 ? '-' : '') + String(n).padStart(left < 0 ? 2 : 3, '0');
      this.minesEl.parentElement.setAttribute('aria-label', fill(t('mines_left_aria'), { n: left }));
    }
    if (this.clockEl) {
      this.clockEl.textContent = fmtTime(this.elapsedMs);
      this.clockEl.parentElement.setAttribute('aria-label', fill(t('time_aria'), { t: fmtTime(this.elapsedMs) }));
    }
    if (this.faceEl) this.faceEl.innerHTML = FACE_SVG(g.dead ? 'dead' : g.won ? 'win' : 'ok');
  }

  // Flag mode is made impossible to miss (Matt, 2026-10-11: Ana dug a mine twice thinking she was
  // flagging): the board gets a vermilion frame, the Flag button turns vermilion instead of the
  // Dig button's blue, and the loupe under the finger carries a flag badge. Shape and label go
  // with every colour, never colour alone.
  _setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._syncMode();
    this._persist();
  }

  _syncMode() {
    this.root.querySelectorAll('[data-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    });
    const play = this.root.querySelector('.ms-play');
    if (play) play.classList.toggle('is-flagmode', this.mode === 'flag');
  }

  /* ---- input --------------------------------------------------------------------------------
   * Pointer events, bound to the BOARD, never to document or window: a non-passive document-level
   * touch listener turns off compositor scrolling for the whole page for as long as this game is
   * mounted (root CLAUDE.md, scroll and touch rules). Pointer capture is what lets a drag that
   * leaves the board still deliver its move and up events here.
   * ------------------------------------------------------------------------------------------ */

  _bindBoard() {
    this._onDown = (e) => this._pressStart(e);
    this._onMove = (e) => this._pressMove(e);
    this._onUp = (e) => this._pressEnd(e, true);
    this._onCancel = (e) => this._pressEnd(e, false);
    this.boardEl.addEventListener('pointerdown', this._onDown);
    this.boardEl.addEventListener('pointermove', this._onMove);
    this.boardEl.addEventListener('pointerup', this._onUp);
    this.boardEl.addEventListener('pointercancel', this._onCancel);
    // A context menu on a long press would fight the flag gesture for the same hold.
    this._onCtx = (e) => e.preventDefault();
    this.boardEl.addEventListener('contextmenu', this._onCtx);
  }

  _unbindBoard() {
    if (!this.boardEl) return;
    this.boardEl.removeEventListener('pointerdown', this._onDown);
    this.boardEl.removeEventListener('pointermove', this._onMove);
    this.boardEl.removeEventListener('pointerup', this._onUp);
    this.boardEl.removeEventListener('pointercancel', this._onCancel);
    this.boardEl.removeEventListener('contextmenu', this._onCtx);
  }

  _cellAt(clientX, clientY) {
    const g = this.game;
    const r = this.boardEl.getBoundingClientRect();
    const pitch = this.cellSize + 2;
    const x = Math.floor((clientX - r.left) / pitch);
    const y = Math.floor((clientY - r.top) / pitch);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
    return y * g.w + x;
  }

  _pressStart(e) {
    if (this._result || this.game.dead || this.game.won) return;
    if (this._press) return;                       // one finger decides; a second is ignored
    const i = this._cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    try { this.boardEl.setPointerCapture(e.pointerId); } catch { /* capture is an optimisation, not a requirement */ }
    this._press = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, longFired: false };
    this._setTarget(i);
    this._showLoupe(i);
    if (this.settings.longPress) {
      this._longPressTimer = setTimeout(() => {
        if (!this._press) return;
        this._press.longFired = true;
        this._doFlag(this._press.i);
        this._buzz();
        this._showLoupe(this._press.i);
      }, LONG_PRESS_MS);
    }
  }

  _pressMove(e) {
    if (!this._press || e.pointerId !== this._press.id) return;
    e.preventDefault();
    const i = this._cellAt(e.clientX, e.clientY);
    const moved = Math.hypot(e.clientX - this._press.x0, e.clientY - this._press.y0);
    if (moved > DRAG_SLOP && this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = 0; }
    if (i !== this._press.i) {
      this._press.i = i;
      // Retargeting cancels a pending hold: the hold belonged to the cell it started on.
      if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = 0; }
      this._setTarget(i);
      this._showLoupe(i);
    }
  }

  _pressEnd(e, commit) {
    if (!this._press || e.pointerId !== this._press.id) return;
    const { i, longFired } = this._press;
    this._press = null;
    if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = 0; }
    this._setTarget(-1);
    this._hideLoupe();
    try { this.boardEl.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!commit || longFired || i < 0) { this._persist(); return; }
    // THE COMMIT HAPPENS HERE, on release, not on touch: that is what makes a 24px cell usable,
    // because a slide can still correct the target while the loupe shows where it actually is.
    if (this.mode === 'flag') this._doFlag(i);
    else this._doDig(i);
  }

  _setTarget(i) {
    if (this._targetEl) this._targetEl.classList.remove('is-target');
    this._targetEl = (i >= 0 && this.cellEls) ? this.cellEls[i] : null;
    if (this._targetEl) this._targetEl.classList.add('is-target');
  }

  _showLoupe(i) {
    if (i < 0 || !this.loupeEl) { this._hideLoupe(); return; }
    const g = this.game;
    const zc = this.loupeEl.firstElementChild;
    const src = this.cellEls[i];
    zc.className = 'ms-zc' + (g.cell[i] === OPEN ? ' is-open' : '');
    zc.innerHTML = src.innerHTML;
    zc.style.color = getComputedStyle(src).color;
    const pitch = this.cellSize + 2;
    const x = (i % g.w) * pitch + this.cellSize / 2;
    const y = ((i / g.w) | 0) * pitch + this.cellSize / 2;
    const SIZE = 96, GAP = 14;
    // Above the finger by default; below it for the top rows, where "above" would be off-screen.
    const below = (y - this.cellSize / 2 - GAP - SIZE) < 0;
    this.loupeEl.classList.toggle('is-below', below);
    const bw = this.boardEl.clientWidth;
    const left = Math.max(0, Math.min(bw - SIZE, x - SIZE / 2));
    const top = below ? (y + this.cellSize / 2 + GAP) : (y - this.cellSize / 2 - GAP - SIZE);
    this.loupeEl.style.left = Math.round(left) + 'px';
    this.loupeEl.style.top = Math.round(top) + 'px';
    this.loupeEl.hidden = false;
  }

  _hideLoupe() { if (this.loupeEl) this.loupeEl.hidden = true; }

  _buzz() {
    if (!this.settings.vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* unsupported is fine */ }
  }

  /** Start a timer that destroy() is guaranteed to clear. */
  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== id);
      fn();
    }, ms);
    this._timers.push(id);
    return id;
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
  }

  /** Does this device ask for less motion? Read at the moment it matters, never cached: a player
   *  can change it in the OS while the tab is open. */
  _reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch { return false; }
  }

  /**
   * THE EXPLOSION. Pure decoration, built at the moment of the hit and torn out again when it is
   * done - it is aria-hidden and carries nothing the revealed board does not already say, which is
   * what makes it safe to skip entirely under reduced motion.
   *
   * Everything it animates is transform/opacity/filter (Part 0). The fragments' vectors live in
   * custom properties so one keyframe drives all of them rather than generating a keyframe per
   * particle, and the layer sits inside the board wrap so it is clipped to the play area instead
   * of painting over the HUD.
   */
  _explode(index) {
    if (!this.boardEl || index < 0) return;
    const g = this.game;
    const wrap = this.boardEl.parentElement;
    if (!wrap) return;

    const pitch = this.cellSize + 2;
    const bx = this.boardEl.offsetLeft + (index % g.w) * pitch + this.cellSize / 2;
    const by = this.boardEl.offsetTop + ((index / g.w) | 0) * pitch + this.cellSize / 2;

    const layer = document.createElement('div');
    layer.className = 'ms-blast';
    layer.setAttribute('aria-hidden', 'true');

    const at = (el) => { el.style.left = bx + 'px'; el.style.top = by + 'px'; return el; };
    const core = document.createElement('div');
    core.className = 'ms-core';
    layer.appendChild(at(core));
    for (const extra of ['', ' ms-shock--2']) {
      const ring = document.createElement('div');
      ring.className = 'ms-shock' + extra;
      layer.appendChild(at(ring));
    }

    // Debris. Scaled to the board so a small Easy board is not buried and an Expert one still
    // reaches its edges.
    const reach = Math.max(120, Math.min(wrap.clientWidth, wrap.clientHeight) * 0.62);
    const COLORS = ['#f2b705', '#e0532f', '#ffe9a8', '#16243a', '#ff8a63'];
    const COUNT = 26;
    for (let i = 0; i < COUNT; i++) {
      const frag = document.createElement('div');
      frag.className = 'ms-frag';
      // Evenly spread around the circle, then jittered, so there are no bald patches and no grid.
      const ang = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = reach * (0.35 + Math.random() * 0.65);
      const size = 5 + Math.random() * 9;
      frag.style.setProperty('--ms-dx', Math.round(Math.cos(ang) * dist) + 'px');
      frag.style.setProperty('--ms-dy', Math.round(Math.sin(ang) * dist) + 'px');
      frag.style.setProperty('--ms-rot', Math.round((Math.random() - 0.5) * 900) + 'deg');
      frag.style.setProperty('--ms-fs', size.toFixed(1) + 'px');
      frag.style.setProperty('--ms-fr', (Math.random() < 0.45 ? '50%' : '2px'));
      frag.style.setProperty('--ms-fc', COLORS[i % COLORS.length]);
      frag.style.setProperty('--ms-fd', Math.round(760 + Math.random() * 420) + 'ms');
      frag.style.setProperty('--ms-fdelay', Math.round(Math.random() * 90) + 'ms');
      layer.appendChild(at(frag));
    }

    wrap.appendChild(layer);
    this.boardEl.classList.add('is-blasting');
    this._buzz();
    this._later(() => {
      if (layer.parentElement) layer.remove();
      if (this.boardEl) this.boardEl.classList.remove('is-blasting');
    }, BLAST_MS);
  }

  /** Reveal the remaining mines outward from the one that was hit, a ring at a time, so the board
   *  tells the story of the blast rather than flipping over all at once. */
  _cascadeReveal(boom) {
    const g = this.game;
    const bx = boom % g.w, by = (boom / g.w) | 0;
    for (let i = 0; i < g.cell.length; i++) {
      if (i === boom) { this._paintCell(i); continue; }
      const dx = (i % g.w) - bx, dy = ((i / g.w) | 0) - by;
      const ring = Math.round(Math.hypot(dx, dy));
      const delay = Math.min(ring * CASCADE_STEP_MS, CASCADE_MAX_MS);
      const shows = g.mine[i] || (g.cell[i] === FLAGGED && !g.mine[i]);
      if (!shows) { this._paintCell(i); continue; }
      this._later(() => {
        if (!this.cellEls) return;
        this._paintCell(i);
        const el = this.cellEls[i];
        if (!el) return;
        el.classList.add('is-revealing');
        this._later(() => el.classList.remove('is-revealing'), 300);
      }, delay);
    }
    this._syncHud();
  }

  /** False (and back to the menu) when another tab finished or replaced this board. */
  _ownsBoard() {
    const g = this.game;
    if (!g || !g.generated || !g._saved) return true;
    const st = slotHolds(g);
    if (st) { this.elapsedMs = Math.max(this.elapsedMs, st.elapsedMs | 0); return true; }
    this._stopTimer();
    this.game = null;
    this.renderMenu();
    return false;
  }

  _doFlag(i) {
    if (!this._ownsBoard()) return;
    const res = E.cycleMark(this.game, i % this.game.w, (i / this.game.w) | 0, this.settings.marks);
    for (const k of res.changed) this._paintCell(k);
    this._syncHud();
    this._persist();
  }

  _doDig(i) {
    if (!this._ownsBoard()) return;
    const g = this.game;
    const x = i % g.w, y = (i / g.w) | 0;
    const wasGenerated = g.generated;
    // A tap on an already-open number is a CHORD, the shortcut this game is actually played with.
    const isChord = g.cell[i] === OPEN && g.num[i] > 0;
    const res = isChord ? E.chord(g, x, y) : E.openCell(g, x, y);
    if (!wasGenerated && g.generated) this._startTimer();   // the clock starts on the first dig
    if (res.changed.length) for (const k of res.changed) this._paintCell(k);
    if (g.dead) { E.revealAll(g); this._finish(false, isChord ? 'chord' : 'dig'); return; }
    if (g.won) { this._paintAll(); this._finish(true); return; }
    this._syncHud();
    this._persist();
  }

  _persist() {
    const g = this.game;
    if (!g) return;
    g.elapsedMs = this.elapsedMs;
    if (!g.generated) return;   // an untouched board is not saved (and never clears another board)
    // Only while the slot is still this board's (2026-10-29): a stale tab never writes over a board
    // another tab finished or replaced.
    if (g._saved && !slotHolds(g)) return;
    if (g.dead || g.won) { clearSave(g.level); return; }
    writeSave(g, this.mode, this._away);
    g._saved = true;
  }

  /* ---- clock --------------------------------------------------------------------------------
   * Wall-clock deltas rather than a tick count, so a throttled background tab cannot inflate or
   * deflate a time. It is stopped on every path out of play, and the save carries elapsedMs so a
   * resumed board picks up where it was rather than restarting at zero.
   * ------------------------------------------------------------------------------------------ */

  _startTimer() {
    if (this._tickHandle) return;
    this._lastTickAt = Date.now();
    this._tickHandle = setInterval(() => {
      const now = Date.now();
      this.elapsedMs += Math.max(0, now - this._lastTickAt);
      this._lastTickAt = now;
      if (this.clockEl) {
        this.clockEl.textContent = fmtTime(this.elapsedMs);
        this.clockEl.parentElement.setAttribute('aria-label', fill(t('time_aria'), { t: fmtTime(this.elapsedMs) }));
      }
    }, 250);
  }

  _stopTimer() {
    if (!this._tickHandle) return;
    // Bank the part-second before stopping, or every pause would quietly shave up to 250ms.
    this.elapsedMs += Math.max(0, Date.now() - this._lastTickAt);
    clearInterval(this._tickHandle);
    this._tickHandle = 0;
    if (this.game) this.game.elapsedMs = this.elapsedMs;
  }

  /* ---- finishing ----------------------------------------------------------------------------- */

  _finish(won, how) {
    this._stopTimer();
    clearSave(this.game.level);
    const g = this.game;
    const level = g.level;
    const prevBest = bestTimes()[level] | 0;
    const timeMs = this.elapsedMs;
    const cleared = E.clearedPct(g);
    const flagsRight = E.correctFlags(g);
    const flagsWrong = E.wrongFlags(g);
    // Record BEFORE reading the wins total back, so the number on the screen includes this game.
    try {
      // A loss records WHY (engine lossCause). A no-guess board counts like any other and is tallied
      // in ms.noGuess too (2026-10-16; before that it went to ms.practice and counted for nothing).
      let cause;
      if (!won) { try { cause = E.lossCause(g, how); } catch (err) { cause = 'unknown'; console.error('[minesweeper] lossCause', err); } }
      recordMinesweeper(level, won, { timeMs, cleared, flagsRight, mines: g.mines, cause, noGuess: !!g.noGuess });
    } catch (err) { console.error('[minesweeper] record', err); }
    const isBest = won && timeMs > 0 && (prevBest <= 0 || timeMs < prevBest);
    this._result = { won, timeMs, cleared, flagsRight, flagsWrong, level, prevBest, isBest, wins: winsSoFar() };

    // A LOSS EARNS THE BLAST. Note the ordering: the result is RECORDED above, synchronously, before
    // a single pixel moves. Nothing about the animation can cost a player their play, even if they
    // leave mid-explosion (the same reasoning as js/CLAUDE.md's "record at the moment of DECISION").
    if (!won && !this._reducedMotion()) {
      this._explode(g.boom);
      this._cascadeReveal(g.boom);
      this._later(() => this._showResult(true), BLAST_MS);
      return;
    }
    this._paintAll();
    this._showResult(true);
  }

  _showResult(fresh) {
    const r = this._result || (this._result = {
      won: !!this.game.won, timeMs: this.elapsedMs, cleared: E.clearedPct(this.game),
      flagsRight: E.correctFlags(this.game), flagsWrong: E.wrongFlags(this.game), level: this.game.level, prevBest: 0, isBest: false, wins: winsSoFar(),
    });
    const L = LEVELS[r.level] || LEVELS.medium;
    const sub = fill(t('result_sub_fmt'), { level: t(r.level), n: L.mines });
    const stats = r.won
      ? [[fmtTime(r.timeMs), t('stat_time')],
         [r.prevBest > 0 ? fmtTime(r.prevBest) : t('no_time'), t('stat_old_best')],
         [String(r.wins), t('stat_wins')]]
      : [[fmtTime(r.timeMs), t('stat_time')],
         [r.cleared + '%', t('stat_cleared')],
         [String(r.flagsRight), t('stat_flags')],
         // Flags wrong: the struck-through squares glowing on the board behind this card.
         [String(r.flagsWrong | 0), t('stat_flags_wrong'), 'is-wrong', WRONG_SVG]];
    const ov = document.createElement('div');
    ov.className = 'ms-ov';
    ov.innerHTML = `<div class="ms-modal" role="dialog" aria-modal="true" aria-label="${esc(r.won ? t('cleared') : t('boom'))}">
      <button type="button" class="ms-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <div class="ms-big">${esc(r.won ? t('cleared') : t('boom'))}</div>
      <div class="ms-sub">${esc(sub)}</div>
      ${r.isBest ? `<div class="ms-pb">${TICK_SVG}${esc(t('new_best'))}</div>` : ''}
      <div class="ms-stats${stats.length > 3 ? ' is-four' : ''}">${stats.map(([b, s, cls, icon]) => `<div${cls ? ` class="${cls}"` : ''}><b>${icon || ''}${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
      <div class="ms-mbtns">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again">${esc(t('play_again'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="${r.won ? 'board' : 'menu'}">${esc(r.won ? t('leaderboard') : t('change_difficulty'))}</button>
      </div>
    </div>`;
    this.root.querySelector('.ms-play').appendChild(ov);
    void fresh;
  }

  _dismissResult() {
    const ov = this.root.querySelector('.ms-ov');
    if (ov) ov.remove();
    const g = this.game;
    if (this.screen === 'play' && g && g.generated && !g.dead && !g.won) this._startTimer();
  }

  /** QUITTING IS A LOSS (2026-10-29, docs/INTEGRITY-CHECKS-SPEC.md "Holes closed 2026-10-29: quitting
   *  and easier settings"): a board that has had its first tap and is not finished, thrown away for a
   *  new one (the face's New board, or New game on setup over that level's paused board), records as
   *  a loss, as if it had been lost there. Pausing it (the level button, leaving the hub) is not
   *  quitting: the board waits in its level's slot. Returns the board a new game would throw away. */
  _quitBoard(level) {
    const g = this.game;
    if (g && g.level === level && g.generated && !g.dead && !g.won && !g._quit) return { g, timeMs: this.elapsedMs | 0 };
    if (g && g.level === level && this.screen === 'play') return null;
    const saved = loadSave(level);
    return saved && !saved.state._quit ? { g: saved.state, timeMs: saved.state.elapsedMs | 0 } : null;
  }

  _recordQuitLoss(level) {
    const q = this._quitBoard(level);
    if (!q) return;
    q.g._quit = true;   // once: this board can never record again
    clearSave(level);
    try {
      recordMinesweeper(level, false, { timeMs: q.timeMs, cleared: E.clearedPct(q.g), flagsRight: E.correctFlags(q.g), mines: q.g.mines, noGuess: !!q.g.noGuess });
    } catch (err) { console.error('[minesweeper] quit loss', err); }
  }

  /** The face is the classic "new game" button, and it used to throw a board away with no
   *  question (Matt, 2026-10-11: "I was doing well on a medium round and lost everything"). A
   *  board that has been started now asks first; an untouched or finished board still restarts at
   *  once, because there is nothing to lose.
   *
   *  THE CLOCK KEEPS RUNNING WHILE IT ASKS (2026-10-29). The board stays visible under the dim, so a
   *  paused clock was free study time: look, tap Keep playing, then play fast. The ask costs the
   *  seconds it takes, like any other pause to think. (Leaving to the menu or How to play hides the
   *  board entirely, so those still bank and stop the clock.) */
  _askNewGame() {
    const g = this.game;
    if (!g || !g.generated || g.dead || g.won) { this.newGame(); return; }
    if (this.root.querySelector('.ms-ov')) return;
    this._persist();
    const ov = document.createElement('div');
    ov.className = 'ms-ov';
    ov.innerHTML = `<div class="ms-modal" role="dialog" aria-modal="true" aria-label="${esc(t('new_ask'))}">
      <button type="button" class="ms-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <div class="ms-big">${esc(t('new_ask'))}</div>
      <div class="ms-sub">${esc(t('new_ask_sub'))}</div>
      <div class="ms-mbtns">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="close">${esc(t('keep_playing'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="newyes">${esc(t('new_board'))}</button>
      </div>
    </div>`;
    this.root.querySelector('.ms-play').appendChild(ov);
  }

  async _openLeaderboard() {
    try {
      const m = await import('../../js/leaderboard-ui.js');
      // Straight onto Minesweeper's board; its back chevron returns here (2026-10-15).
      await m.openLeaderboard({ game: 'minesweeper' });
    } catch (err) { console.error('[minesweeper] leaderboard', err); }
  }

  /* ---- teardown ------------------------------------------------------------------------------ */

  isInProgress() {
    // FALSE even mid-board: every input writes the save and the clock is banked with it, so
    // leaving is lossless and the hub has nothing to warn about.
    return false;
  }

  destroy() {
    this._stopTimer();
    this._clearTimers();
    if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = 0; }
    this._persist();
    this._unbindBoard();
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this._offLang) { this._offLang(); this._offLang = null; }
    if (this.root) { this.root.onclick = null; this.root.onpointerdown = null; this.root.remove(); }
    this.root = null;
    this.boardEl = null;
    this.loupeEl = null;
    this.cellEls = null;
    this.game = null;
  }
}

/* --- the module contract ---------------------------------------------------------------------- */

let instance = null;

function ensureStylesheet() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-minesweeper-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/minesweeper.css', import.meta.url).href;
  link.setAttribute('data-minesweeper-css', '1');
  document.head.appendChild(link);
}

export function init(container) {
  ensureStylesheet();
  if (instance) instance.destroy();
  instance = new MinesweeperUI(container);
  instance._offViewport = onViewportResize(() => { instance._positionRoot(); instance._fit(); });
  instance._offLang = onLangChange(() => {
    if (instance.screen === 'menu') instance.renderMenu();
    else if (instance.screen === 'howto') instance.renderHowTo();
    else if (instance.screen === 'play') instance.renderGame();
  });
  return instance;
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() { return instance ? instance.isInProgress() : false; }

export default { init, destroy, isInProgress };
