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
import E, { LEVELS, OPEN, FLAGGED } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.minesweeper.v1';
const SAVE_KEY = 'gamehub.minesweeper.save.v1';
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
const WRONG_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M6.6 4.2 19 8.4 6.6 12.6Z" fill="currentColor" opacity=".35"/><path d="M3 3 21 21M21 3 3 21" stroke="#e0532f" stroke-width="2.8" stroke-linecap="round"/></svg>`;
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
      safeFirst: v.safeFirst !== false,
      longPress: v.longPress !== false,
      vibrate: v.vibrate === true,
    };
  } catch { return { version: 1, level: 'easy', safeFirst: true, longPress: true, vibrate: false }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[minesweeper] settings', err); }
  return next;
}
function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const state = E.deserialize(raw.state);
    if (!state || state.dead || state.won) return null;   // a finished board is not a resume
    if (!state.generated) return null;                    // an untouched board is not worth resuming
    return { state, mode: raw.mode === 'flag' ? 'flag' : 'dig' };
  } catch { return null; }
}
function writeSave(state, mode) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: E.serialize(state), mode })); }
  catch (err) { console.error('[minesweeper] save', err); }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* a save we cannot clear is harmless: loadSave() rejects a finished board anyway */ }
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

    this._onVisibility = () => {
      // The clock must not run while this tab is in the background: a best time earned with the
      // phone in a pocket is not a best time. Resuming re-anchors, it never back-fills.
      if (document.hidden) this._stopTimer();
      else if (this.screen === 'play' && this.game && !this.game.dead && !this.game.won) this._startTimer();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    this._positionRoot();
    this.renderMenu();
  }

  /* ---- layout ------------------------------------------------------------------------------ */

  // Pins the root to the mount point's real on-screen slot. A CSS-only `inset: 0` fills whichever
  // box happens to be the containing block, and in the hub that is the wrong box (.hub-game has no
  // defined height), which puts this screen over the hub's own sticky header. Only JS can measure
  // the actual offset. Copied from sudoku/js/ui.js, which hit this exact bug.
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    this.root.style.top = Math.round(r.top) + 'px';
    this.root.style.height = Math.max(200, Math.round(vh - r.top)) + 'px';
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
    const saved = loadSave();
    const diffs = LEVEL_ORDER.map((id) => {
      const L = LEVELS[id];
      const meta = fill(t('board_fmt'), { w: L.w, h: L.h, n: L.mines });
      return `<button type="button" class="ms-diff" data-level="${id}" aria-pressed="${s.level === id}">
        <span class="ms-dshape">${diffShapeSVG(L.tier)}</span>
        <span class="ms-dname">${esc(t(id))}</span>
        <span class="ms-dmeta">${esc(meta)}</span>
        <span class="ms-dtick">${TICK_SVG}</span>
      </button>`;
    }).join('');
    const bestCells = LEVEL_ORDER.map((id) => {
      const v = bests[id] | 0;
      return `<div><b>${v > 0 ? fmtTime(v) : esc(t('no_time'))}</b><span>${esc(t(id))}</span></div>`;
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

    this.root.innerHTML = `<div class="ms-screen ms-setup">
      <h2 class="ms-title">${esc(t('title'))}</h2>
      <div class="ms-card"><h3>${esc(t('difficulty'))}</h3><div class="ms-diffs">${diffs}</div></div>
      <div class="ms-card"><h3>${esc(t('your_best'))}</h3><div class="ms-bests">${bestCells}</div></div>
      <div class="ms-card"><h3>${esc(t('options'))}</h3><div class="ms-opts">
        ${opt('safeFirst', 'safe_first', 'safe_first_sub')}
        ${opt('longPress', 'long_press', 'long_press_sub')}
        ${canVibrate ? opt('vibrate', 'vibrate', '') : ''}
      </div></div>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block ms-cta" data-act="play">${esc(t(saved ? 'resume' : 'play'))}</button>
      <div class="ms-linkrow">
        <button type="button" class="gh-btn" data-act="howto">${esc(t('how_to_play'))}</button>
        <button type="button" class="gh-btn" data-act="stats">${esc(t('my_stats'))}</button>
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
      else if (act.dataset.act === 'howto') this.renderHowTo();
      else if (act.dataset.act === 'stats') this._openStats();
    };
  }

  async _openStats() {
    // Lazy: My Stats pulls in the whole stats UI and nobody opening Minesweeper has asked for it
    // yet. A failure here must never take the game down with it. Same shape as pipes/js/ui.js.
    try {
      const m = await import('../../js/game-stats-ui.js');
      m.openStatsOverlay();
    } catch (err) { console.error('[minesweeper] stats', err); }
  }

  /* ---- how to play -------------------------------------------------------------------------- */

  // Explains the two genuinely non-obvious mechanics and nothing else: chording, and the
  // commit-on-release targeting. Everybody already knows what a mine is
  // (docs/BUILDING-A-GAME.md Part 2, "Explain only the one genuinely non-obvious mechanic").
  renderHowTo() {
    this.screen = 'howto';
    this._stopTimer();
    this._clearTimers();
    const mini = (cls, inner) => `<div class="ms-c ms-minic ${cls}">${inner}</div>`;
    const grid3 = (cells) => `<div class="ms-board" style="grid-template-columns:repeat(3,34px);--ms-cell-size:34px">${cells}</div>`;
    const before = grid3([
      mini('is-open n1', '1'), mini('', ''), mini('', ''),
      mini('is-open n2', '2'), mini('is-open n3 is-target', '3'), mini('', FLAG_SVG('#e0532f')),
      mini('', FLAG_SVG('#e0532f')), mini('', FLAG_SVG('#e0532f')), mini('', ''),
    ].join(''));
    const after = grid3([
      mini('is-open n1', '1'), mini('is-open', ''), mini('is-open n1', '1'),
      mini('is-open n2', '2'), mini('is-open n3', '3'), mini('', FLAG_SVG('#e0532f')),
      mini('', FLAG_SVG('#e0532f')), mini('', FLAG_SVG('#e0532f')), mini('is-open n2', '2'),
    ].join(''));

    this.root.innerHTML = `<div class="ms-screen ms-help">
      <p class="ms-lead">${esc(t('help_lead'))}</p>
      <div class="ms-dia">
        <div class="ms-diarow">${before}${ARROW_SVG}${after}</div>
        <p class="ms-cap">${esc(t('help_chord_cap'))}</p>
        <div class="ms-eg">${esc(t('help_chord_eg'))}</div>
      </div>
      <div class="ms-dia">
        <div class="ms-diarow">
          <div style="position:relative;width:118px;height:136px;flex:0 0 auto">
            <div class="ms-board" style="grid-template-columns:repeat(3,28px);--ms-cell-size:28px;position:absolute;left:16px;top:70px">
              ${mini('', '')}${mini('', '')}${mini('', '')}${mini('is-target', '')}
            </div>
            <div class="ms-loupe" style="width:60px;height:60px;left:29px;top:0"><div class="ms-zc" style="width:40px;height:40px;font-size:20px"></div></div>
          </div>
          <p class="ms-cap" style="margin:0;flex:1">${esc(t('help_loupe_cap'))}</p>
        </div>
        <div class="ms-eg">${esc(t('help_loupe_eg'))}</div>
      </div>
      <p class="ms-edge">${esc(t('help_edge_flag'))}</p>
      <p class="ms-edge">${esc(t('help_edge_safe'))}</p>
      <p class="ms-edge">${esc(t('help_edge_clock'))}</p>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block ms-cta" data-act="back">${esc(t('back'))}</button>
    </div>`;
    this.root.onclick = (ev) => { if (ev.target.closest('[data-act="back"]')) this.renderMenu(); };
  }

  /* ---- play --------------------------------------------------------------------------------- */

  startOrResume() {
    const saved = loadSave();
    if (saved) { this.game = saved.state; this.mode = saved.mode; this.elapsedMs = saved.state.elapsedMs | 0; }
    else { this.game = E.createGame(this.settings.level); this.mode = 'dig'; this.elapsedMs = 0; }
    this._result = null;
    this.renderGame();
  }

  newGame(level) {
    this._clearTimers();
    clearSave();
    this.game = E.createGame(level || this.settings.level);
    this.mode = 'dig';
    this.elapsedMs = 0;
    this._result = null;
    this.renderGame();
  }

  renderGame() {
    this.screen = 'play';
    const g = this.game;
    this.root.innerHTML = `<div class="ms-screen ms-play">
      <div class="ms-hdr">
        <div class="ms-readout" data-role="mines" aria-live="off">${FLAG_SVG('#e0532f')}<span data-role="mines-n">000</span></div>
        <button type="button" class="ms-face" data-act="new" aria-label="${esc(t('new_game'))}">${FACE_SVG('ok')}</button>
        <div class="ms-readout" data-role="clock">${CLOCK_SVG}<span data-role="clock-n">00:00</span></div>
      </div>
      <div class="ms-boardwrap">
        <div class="ms-board" role="grid" aria-label="${esc(t('title'))}"></div>
        <div class="ms-loupe" hidden><div class="ms-zc"></div></div>
      </div>
      <div class="ms-bar">
        <div class="gh-seg" role="group">
          <button type="button" class="gh-seg__item" data-mode="dig" aria-pressed="${this.mode === 'dig'}">${SHOVEL_SVG}<span>${esc(t('dig'))}</span></button>
          <button type="button" class="gh-seg__item" data-mode="flag" aria-pressed="${this.mode === 'flag'}">${FLAG_SVG('currentColor')}<span>${esc(t('flag'))}</span></button>
        </div>
        <button type="button" class="gh-btn gh-btn--icon ms-helpbtn" data-act="howto" aria-label="${esc(t('help_aria'))}">?</button>
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
    this._fit();
    // Two extra passes: the first measurement can land before flex has settled, which is the
    // .hub-game height trap in its mildest form.
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    this._paintAll();
    this._bindBoard();

    this.root.onclick = (ev) => {
      const md = ev.target.closest('[data-mode]');
      if (md) { this.mode = md.dataset.mode; this._syncMode(); this._persist(); return; }
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'new') this.newGame();
      else if (act.dataset.act === 'howto') this.renderHowTo();
      else if (act.dataset.act === 'close') this._dismissResult();
      else if (act.dataset.act === 'again') this.newGame();
      else if (act.dataset.act === 'menu') this.renderMenu();
      else if (act.dataset.act === 'board') this._openLeaderboard();
    };

    if (g.dead || g.won) this._showResult(false);
    else if (g.generated) this._startTimer();
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
      inner = (g.dead && !g.mine[i]) ? WRONG_SVG : FLAG_SVG(g.won ? '#178a7a' : '#e0532f');
      aria = fill(t('cell_aria_flag'), { r: y + 1, c: x + 1 });
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

  _syncMode() {
    this.root.querySelectorAll('[data-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode));
    });
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

  _doFlag(i) {
    const res = E.toggleFlag(this.game, i % this.game.w, (i / this.game.w) | 0);
    for (const k of res.changed) this._paintCell(k);
    this._syncHud();
    this._persist();
  }

  _doDig(i) {
    const g = this.game;
    const x = i % g.w, y = (i / g.w) | 0;
    const wasGenerated = g.generated;
    // A tap on an already-open number is a CHORD, the shortcut this game is actually played with.
    const res = (g.cell[i] === OPEN && g.num[i] > 0) ? E.chord(g, x, y) : E.openCell(g, x, y);
    if (!wasGenerated && g.generated) this._startTimer();   // the clock starts on the first dig
    if (res.changed.length) for (const k of res.changed) this._paintCell(k);
    if (g.dead) { E.revealAll(g); this._finish(false); return; }
    if (g.won) { this._paintAll(); this._finish(true); return; }
    this._syncHud();
    this._persist();
  }

  _persist() {
    if (!this.game) return;
    this.game.elapsedMs = this.elapsedMs;
    if (this.game.dead || this.game.won || !this.game.generated) clearSave();
    else writeSave(this.game, this.mode);
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

  _finish(won) {
    this._stopTimer();
    clearSave();
    const g = this.game;
    const level = g.level;
    const prevBest = bestTimes()[level] | 0;
    const timeMs = this.elapsedMs;
    const cleared = E.clearedPct(g);
    const flagsRight = E.correctFlags(g);
    // Record BEFORE reading the wins total back, so the number on the screen includes this game.
    try {
      recordMinesweeper(level, won, { timeMs, cleared, flagsRight, mines: g.mines });
    } catch (err) { console.error('[minesweeper] record', err); }
    const isBest = won && timeMs > 0 && (prevBest <= 0 || timeMs < prevBest);
    this._result = { won, timeMs, cleared, flagsRight, level, prevBest, isBest, wins: winsSoFar() };

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
      flagsRight: E.correctFlags(this.game), level: this.game.level, prevBest: 0, isBest: false, wins: winsSoFar(),
    });
    const L = LEVELS[r.level] || LEVELS.medium;
    const sub = fill(t('result_sub_fmt'), { level: t(r.level), n: L.mines });
    const stats = r.won
      ? [[fmtTime(r.timeMs), t('stat_time')],
         [r.prevBest > 0 ? fmtTime(r.prevBest) : t('no_time'), t('stat_old_best')],
         [String(r.wins), t('stat_wins')]]
      : [[fmtTime(r.timeMs), t('stat_time')],
         [r.cleared + '%', t('stat_cleared')],
         [String(r.flagsRight), t('stat_flags')]];
    const ov = document.createElement('div');
    ov.className = 'ms-ov';
    ov.innerHTML = `<div class="ms-modal" role="dialog" aria-modal="true" aria-label="${esc(r.won ? t('cleared') : t('boom'))}">
      <button type="button" class="ms-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <div class="ms-big">${esc(r.won ? t('cleared') : t('boom'))}</div>
      <div class="ms-sub">${esc(sub)}</div>
      ${r.isBest ? `<div class="ms-pb">${TICK_SVG}${esc(t('new_best'))}</div>` : ''}
      <div class="ms-stats">${stats.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
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
  }

  async _openLeaderboard() {
    try {
      const m = await import('../../js/leaderboard-ui.js');
      await m.openLeaderboard();
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
    if (this.root) { this.root.onclick = null; this.root.remove(); }
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
