// sudoku/js/ui.js - the DOM shell, input, timer and the module contract. The rules live in
// game.js, generation in generator.js/solver.js; nothing here decides anything about the puzzle.
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md, "The module
// contract"). `destroy()` must be leak-free - the hub reuses the same container for the next game.
//
// isInProgress() RETURNS FALSE, DELIBERATELY. Autosave/resume built in (root CLAUDE.md's second
// isInProgress() meaning): the board is saved after every input, so leaving is lossless - the
// Nuts & Bolts / Pipes class, not the Ball Run class.
import '../../js/theme.js';   // side effect: stamps .gh-dark so this screen themes standalone too
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { recordSudoku } from '../../js/game-stats.js';
import { generate, TIER_ORDER } from './generator.js';
import { SudokuGame } from './game.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.sudoku.v1';
const SAVE_KEY = 'gamehub.sudoku.save.v1';
const TIER_LABEL_KEY = { easy: 'tier_easy', medium: 'tier_medium', hard: 'tier_hard', expert: 'tier_expert' };

const esc = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    return { version: 1, tier: TIER_ORDER.includes(v.tier) ? v.tier : 'easy', autoNotesClear: v.autoNotesClear !== false };
  } catch { return { version: 1, tier: 'easy', autoNotesClear: true }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[sudoku] settings', err); }
  return next;
}
function loadSave() {
  try { return SudokuGame.fromSave(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch { return null; }
}
function writeSave(game) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toSave())); } catch (err) { console.error('[sudoku] save', err); }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const ICON_ERASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13 9 22H4v-5l9-9z"/><path d="M13 4l7 7"/></svg>';
const ICON_NOTES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M13 5l6 6"/></svg>';
const ICON_HINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.4c0 1.6-2.1 1.9-2.1 3.6"/><path d="M12 17.5v.01"/></svg>';

class SudokuUI {
  constructor(container) {
    this.container = container;
    this.profile = (() => { try { return loadProfile(); } catch { return null; } })();
    this.settings = loadSettings();
    this.game = null;
    this.screen = 'menu';
    this.selected = -1;
    this.notesMode = false;
    this._winRecorded = false;
    this._runStart = null;
    this._timerInterval = null;
    this._onVisibility = () => {
      if (document.hidden) this._pauseTimer();
      else this._maybeResumeTimer();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    const saved = loadSave();
    this.selectedTier = (saved && saved.tier) || this.settings.tier;

    if (saved) this._enterGame(saved);
    else this.renderMenu();
  }

  // --- timer ---------------------------------------------------------------------------------

  /** A completely fresh board (nothing placed yet) does not start ticking until the first
   *  input; a resumed in-progress board keeps counting immediately. */
  _isFreshBoard(g) {
    for (let i = 0; i < 81; i++) if (g.givens[i] === 0 && g.cells[i] !== 0) return false;
    return g.mistakes === 0 && g.hints === 0;
  }
  _maybeResumeTimer() {
    if (!this.game || this.game.isSolved() || this.screen !== 'play') return;
    if (this._runStart === null && !document.hidden) this._runStart = Date.now();
  }
  _pauseTimer() {
    if (this._runStart !== null) {
      this.game.elapsedMs += Date.now() - this._runStart;
      this._runStart = null;
    }
  }
  _currentElapsed() {
    if (!this.game) return 0;
    return this.game.elapsedMs + (this._runStart !== null ? Date.now() - this._runStart : 0);
  }
  _startTimerLoop() {
    clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => this._updateTimerDisplay(), 500);
  }
  _updateTimerDisplay() {
    if (this.el && this.el.timer) this.el.timer.textContent = fmtTime(this._currentElapsed());
  }

  // --- setup screen ----------------------------------------------------------------------------

  renderMenu() {
    this.screen = 'menu';
    this._pauseTimer();
    clearInterval(this._timerInterval);
    const segs = TIER_ORDER.map((tier) => `
      <button type="button" class="sd-seg${tier === this.selectedTier ? ' is-selected' : ''}"
        data-tier="${tier}" role="radio" aria-checked="${tier === this.selectedTier}">
        <span class="sd-seg-label">${diffShapeSVG(tierOf(tier))}<b>${esc(t(TIER_LABEL_KEY[tier]))}</b></span>
      </button>`).join('');
    const saved = loadSave();
    const resumeLabel = saved
      ? `${esc(t('resume'))} · ${esc(t(TIER_LABEL_KEY[saved.tier]) || '')} · ${esc(fmtTime(saved.elapsedMs))}`
      : '';
    this.container.innerHTML = `
      <div class="sd-root sd-menu">
        <div class="sd-hero" aria-hidden="true">${this._heroSVG()}</div>
        <div class="sd-menu-header">
          <h1>${esc(t('title'))}</h1>
          <p>${esc(t('tagline'))}</p>
        </div>
        <div class="gh-card sd-menu-card">
          <div class="gh-field">
            <span class="gh-field__label" id="sd-difflabel">${esc(t('setup_difficulty'))}</span>
            <div class="sd-seg-wrap" role="radiogroup" aria-labelledby="sd-difflabel">${segs}</div>
          </div>
          ${saved ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="resume">${resumeLabel}</button>` : ''}
          <button type="button" class="gh-btn gh-btn--block ${saved ? 'gh-btn--ghost' : 'gh-btn--primary'}" data-action="start">${esc(t('start'))}</button>
        </div>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-action="howto">${esc(t('howto'))}</button>
      </div>`;
    this.root = this.container.querySelector('.sd-root');
    this._positionRoot();
    this.root.querySelectorAll('[data-tier]').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedTier = el.dataset.tier;
        this.settings = saveSettings({ tier: this.selectedTier });
        this.renderMenu();
      });
    });
    const resumeBtn = this.root.querySelector('[data-action="resume"]');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this._enterGame(loadSave()));
    this.root.querySelector('[data-action="start"]').addEventListener('click', () => this._startFresh());
    this.root.querySelector('[data-action="howto"]').addEventListener('click', () => this.renderHowTo());
  }

  _startFresh() {
    clearSave();
    const r = generate(this.selectedTier, undefined);
    const game = new SudokuGame({ tier: this.selectedTier, puzzle: r.puzzle, solution: r.solution });
    this._enterGame(game);
  }

  /** Sudoku's rules (fill every row/col/box with 1-9) are already known - the ONE thing worth a
   *  picture is notes vs. an answer, so that is the whole sheet: the diagram and one caption line,
   *  nothing else (Matt, 2026-09-13: "SO MUCH TEXT. Remove that."). */
  renderHowTo() {
    this.screen = 'howto';
    this._pauseTimer();
    clearInterval(this._timerInterval);
    this.container.innerHTML = `
      <div class="sd-root sd-howto-screen">
        <div class="gh-card">
          <div class="sd-howto-diagram">${this._howToDiagramSVG()}</div>
          <p class="sd-howto-caption">${esc(t('howto_caption'))}</p>
        </div>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="close">${esc(t('howto_close'))}</button>
      </div>`;
    this.root = this.container.querySelector('.sd-root');
    this._positionRoot();
    this.root.querySelector('[data-action="close"]').addEventListener('click', () => {
      if (this.game) this._enterGame(this.game); else this.renderMenu();
    });
  }

  /** Purely decorative mini board for the setup screen header - a few filled cells and one
   *  selection outline, drawn entirely from this screen's own theme variables (never a
   *  hardcoded color) so it repaints correctly in dark mode with no extra work. Static SVG,
   *  no data behind it: aria-hidden, the same discipline as `js/game-art.js`'s hub tile. */
  _heroSVG() {
    return `<svg viewBox="0 0 120 120" class="sd-hero-svg" aria-hidden="true">
      <g stroke="var(--sd-line)" stroke-width="1">
        <path d="M18 30H114 M18 54H114 M18 78H114 M18 102H114"/>
        <path d="M30 18V114 M54 18V114 M78 18V114 M102 18V114"/>
      </g>
      <g stroke="var(--sd-line-strong)" stroke-width="2">
        <rect x="6" y="6" width="108" height="108" fill="none"/>
        <path d="M6 42H114 M6 78H114"/>
        <path d="M42 6V114 M78 6V114"/>
      </g>
      <g fill="var(--sd-muted)" font-family="system-ui, sans-serif" font-size="15" font-weight="700" text-anchor="middle">
        <text x="24" y="29">6</text>
        <text x="72" y="17">3</text>
        <text x="108" y="41">8</text>
        <text x="48" y="89">1</text>
        <text x="96" y="113">5</text>
      </g>
      <rect x="55" y="55" width="10" height="10" fill="none" stroke="var(--sd-select)" stroke-width="3" rx="1.5"/>
    </svg>`;
  }

  /** Two LABELED cells side by side: a filled cell with one large "5" under "ANSWER", and a cell
   *  holding four small pencil-mark digits, each sitting in its own fixed spot of a 3x3 grid
   *  (matching where the real notes grid puts them - `.sd-notesgrid`), under "NOTES". Matt found
   *  the first version (no labels, digits placed by eye) unclear - two boxes of numbers read as
   *  numbers, not as a contrast, without something naming what's different about them. */
  _howToDiagramSVG() {
    return `<svg viewBox="0 0 200 108" role="img" aria-label="${esc(t('howto_diagram_aria'))}">
      <rect x="4" y="4" width="82" height="82" rx="8" fill="none" stroke="var(--sd-line)" stroke-width="2"/>
      <text x="45" y="56" text-anchor="middle" font-size="42" font-weight="700" fill="var(--sd-ink)">5</text>
      <text x="45" y="101" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1"
        fill="var(--sd-muted)">${esc(t('howto_label_answer'))}</text>

      <rect x="114" y="4" width="82" height="82" rx="8" fill="none" stroke="var(--sd-line)" stroke-width="2"/>
      <text x="155" y="23" text-anchor="middle" font-size="13" fill="var(--sd-muted)">2</text>
      <text x="128" y="50" text-anchor="middle" font-size="13" fill="var(--sd-muted)">4</text>
      <text x="182" y="50" text-anchor="middle" font-size="13" fill="var(--sd-muted)">6</text>
      <text x="182" y="77" text-anchor="middle" font-size="13" fill="var(--sd-muted)">9</text>
      <text x="155" y="101" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1"
        fill="var(--sd-muted)">${esc(t('howto_label_notes'))}</text>
    </svg>`;
  }

  // --- game screen -----------------------------------------------------------------------------

  _enterGame(game) {
    this.game = game;
    this.selected = -1;
    this.notesMode = false;
    this._winRecorded = false;
    this._runStart = this._isFreshBoard(game) ? null : Date.now();
    this.renderGame();
  }

  renderGame() {
    this.screen = 'play';
    const g = this.game;
    this.container.innerHTML = `
      <div class="sd-root sd-play">
        <div class="sd-hud">
          <button type="button" class="sd-iconbtn" data-action="back" aria-label="${esc(t('back_aria'))}">${ICON_BACK}</button>
          <span class="sd-hud-mid">
            <span class="sd-hud-tier">${diffShapeSVG(tierOf(g.tier))}${esc(t(TIER_LABEL_KEY[g.tier]) || '')}</span>
            <span class="sd-hud-timer" data-role="timer" aria-label="${esc(t('timer_aria'))}">0:00</span>
          </span>
          <span class="sd-hud-mistakes" aria-label="${esc(t('mistakes_aria'))}">
            <span data-role="mistakes">0</span> <span class="sd-hud-mistakes-label">${esc(t('mistakes_label'))}</span>
          </span>
        </div>
        <div class="sd-boardwrap"><div class="sd-board" data-role="board" role="grid"></div></div>
        <div class="sd-controls" data-role="controls">
          <button type="button" class="sd-ctlbtn" data-action="undo" aria-label="${esc(t('undo_aria'))}">${ICON_UNDO}<span>${esc(t('undo'))}</span></button>
          <button type="button" class="sd-ctlbtn" data-action="erase" aria-label="${esc(t('erase_aria'))}">${ICON_ERASE}<span>${esc(t('erase'))}</span></button>
          <button type="button" class="sd-ctlbtn" data-action="notes" aria-label="${esc(t('notes_aria'))}" aria-pressed="false">${ICON_NOTES}<span data-role="noteslabel">${esc(t('notes'))}</span></button>
          <button type="button" class="sd-ctlbtn" data-action="hint" aria-label="${esc(t('hint_aria'))}">${ICON_HINT}<span>${esc(t('hint'))}</span></button>
        </div>
        <div class="sd-pad" data-role="pad">
          ${Array.from({ length: 9 }, (_, k) => k + 1).map((d) => `<button type="button" class="sd-padbtn" data-digit="${d}">${d}</button>`).join('')}
        </div>
        <div class="sd-overlay" data-role="new-overlay" hidden>
          <div class="sd-confirm">
            <p>${esc(t('new_puzzle_confirm'))}</p>
            <div class="gh-modal__actions">
              <button type="button" class="gh-btn" data-action="new-cancel">${esc(t('cancel'))}</button>
              <button type="button" class="gh-btn gh-btn--primary" data-action="new-confirm">${esc(t('new_puzzle'))}</button>
            </div>
          </div>
        </div>
        <div class="gh-overlay" data-role="win-overlay" hidden>
          <div class="gh-modal">
            <button type="button" class="gh-modal__close" data-action="close-win" aria-label="${esc(t('close_aria'))}">&times;</button>
            <h2 class="gh-modal__title">${esc(t('win_title'))}</h2>
            <p data-role="win-detail"></p>
            <div class="gh-modal__actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="next-puzzle">${esc(t('next_puzzle'))}</button>
              <button type="button" class="gh-btn gh-btn--block" data-action="change-difficulty">${esc(t('change_difficulty'))}</button>
            </div>
          </div>
        </div>
      </div>`;

    this.root = this.container.querySelector('.sd-root');
    this._positionRoot();
    this.el = {
      board: this.root.querySelector('[data-role="board"]'),
      timer: this.root.querySelector('[data-role="timer"]'),
      mistakes: this.root.querySelector('[data-role="mistakes"]'),
      controls: this.root.querySelector('[data-role="controls"]'),
      pad: this.root.querySelector('[data-role="pad"]'),
      newOverlay: this.root.querySelector('[data-role="new-overlay"]'),
      winOverlay: this.root.querySelector('[data-role="win-overlay"]'),
      winDetail: this.root.querySelector('[data-role="win-detail"]'),
      notesLabel: this.root.querySelector('[data-role="noteslabel"]'),
    };

    this._buildBoard();
    this._onRootClick = (ev) => this._handleClick(ev);
    this.root.addEventListener('click', this._onRootClick);
    this._onRootKey = (ev) => this._handleKey(ev);
    this.root.addEventListener('keydown', this._onRootKey);

    try { window.__sdTest = { state: () => this._testState(), selected: () => this.selected, ui: this, game: this.game }; } catch { /* no window */ }

    this._paintAll();
    this._fit();
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    this._startTimerLoop();
    if (g.isSolved()) this._showWin(false);
  }

  _testState() {
    const g = this.game;
    return { cells: Array.from(g.cells), givens: Array.from(g.givens), solved: g.isSolved(), selected: this.selected };
  }

  _buildBoard() {
    const g = this.game;
    this.cellEls = new Array(81);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = 'sd-cell';
      cell.dataset.i = String(i);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('tabindex', i === 0 ? '0' : '-1');
      if (g.isGiven(i)) cell.classList.add('sd-given');
      // Thicker borders every 3 cells, drawn on the cell so the CSS never needs a second grid
      // layer - a col/row of 3,6 gets a right/bottom box border.
      const r = (i / 9) | 0, c = i % 9;
      if (c % 3 === 0) cell.classList.add('sd-boxleft');
      if (r % 3 === 0) cell.classList.add('sd-boxtop');
      if (c === 8) cell.classList.add('sd-boxright');
      if (r === 8) cell.classList.add('sd-boxbottom');
      frag.appendChild(cell);
      this.cellEls[i] = cell;
    }
    this.el.board.innerHTML = '';
    this.el.board.appendChild(frag);
  }

  _handleClick(ev) {
    const cell = ev.target.closest('.sd-cell');
    if (cell) { this._select(Number(cell.dataset.i)); return; }
    const digitBtn = ev.target.closest('[data-digit]');
    if (digitBtn) { this._inputDigit(Number(digitBtn.dataset.digit)); return; }
    const actionEl = ev.target.closest('[data-action]');
    if (actionEl) this._handleAction(actionEl.dataset.action);
  }

  _handleKey(ev) {
    if (this.selected < 0) return;
    if (ev.key >= '1' && ev.key <= '9') { this._inputDigit(Number(ev.key)); ev.preventDefault(); return; }
    if (ev.key === 'Backspace' || ev.key === 'Delete') { this._doErase(); ev.preventDefault(); return; }
    const dirs = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (dirs[ev.key] !== undefined) {
      const next = this.selected + dirs[ev.key];
      if (next >= 0 && next < 81) { this._select(next); ev.preventDefault(); }
    }
  }

  _handleAction(action) {
    switch (action) {
      case 'back':
        if (this.game && !this.game.isSolved()) { writeSave(this.game); }
        this._pauseTimer();
        this.renderMenu();
        break;
      case 'undo':
        if (this.game.undo()) { writeSave(this.game); this._paintAll(); }
        break;
      case 'erase':
        this._doErase();
        break;
      case 'notes':
        this.notesMode = !this.notesMode;
        this._paintNotesToggle();
        break;
      case 'hint':
        this._doHint();
        break;
      case 'close-win':
        this.el.winOverlay.hidden = true;
        break;
      case 'next-puzzle':
        this.el.winOverlay.hidden = true;
        this._startFresh();
        break;
      case 'change-difficulty':
        this.el.winOverlay.hidden = true;
        this.renderMenu();
        break;
      case 'new-cancel':
        this.el.newOverlay.hidden = true;
        break;
      case 'new-confirm':
        this.el.newOverlay.hidden = true;
        this._startFresh();
        break;
      default:
        break;
    }
  }

  _select(i) {
    if (this.selected >= 0 && this.cellEls[this.selected]) this.cellEls[this.selected].tabIndex = -1;
    this.selected = i;
    if (this.cellEls[i]) this.cellEls[i].tabIndex = 0;
    try { this.cellEls[i] && this.cellEls[i].focus({ preventScroll: true }); } catch { /* ignore */ }
    this._paintHighlights();
  }

  _inputDigit(d) {
    if (this.selected < 0 || !this.game || this.game.isSolved()) return;
    const g = this.game;
    if (g.isGiven(this.selected)) return;
    this._maybeResumeTimer();
    if (this.notesMode) {
      if (g.toggleNote(this.selected, d)) { writeSave(g); this._paintCell(this.selected); }
      return;
    }
    const result = g.place(this.selected, d);
    if (!result.changed) return;
    writeSave(g);
    this._paintAll();
    if (result.solved) this._showWin(true);
  }

  _doErase() {
    if (this.selected < 0 || !this.game || this.game.isSolved()) return;
    if (this.game.erase(this.selected)) { writeSave(this.game); this._paintAll(); }
  }

  _doHint() {
    if (!this.game || this.game.isSolved()) return;
    this._maybeResumeTimer();
    const i = this.game.hint(this.selected);
    if (i < 0) return;
    writeSave(this.game);
    this._select(i);
    this._paintAll();
    if (this.game.isSolved()) this._showWin(true);
  }

  _paintNotesToggle() {
    const btn = this.root.querySelector('[data-action="notes"]');
    if (btn) btn.setAttribute('aria-pressed', String(this.notesMode));
    this.root.classList.toggle('sd-notes-on', this.notesMode);
    if (this.el.notesLabel) this.el.notesLabel.textContent = this.notesMode ? t('notes_on') : t('notes');
  }

  /** Repaint every cell's digit/notes/given-weight, then the selection-dependent highlights and
   *  the HUD (timer, mistakes). Called after any state-changing action. */
  _paintAll() {
    const g = this.game;
    for (let i = 0; i < 81; i++) this._paintCell(i);
    this._paintHighlights();
    if (this.el.mistakes) this.el.mistakes.textContent = String(g.mistakes);
    this._updateTimerDisplay();
  }

  _paintCell(i) {
    const g = this.game;
    const el = this.cellEls[i];
    if (!el) return;
    const v = g.cells[i];
    el.classList.toggle('sd-given', g.isGiven(i));
    if (v) {
      el.innerHTML = `<span class="sd-digit">${v}</span>`;
      el.removeAttribute('aria-label');
      if (g.isGiven(i)) el.setAttribute('aria-label', t('given_aria') + ' ' + v);
    } else {
      const notes = g.notesAt(i);
      if (notes.length) {
        el.innerHTML = `<div class="sd-notesgrid">${Array.from({ length: 9 }, (_, k) => k + 1)
          .map((d) => `<span class="sd-note${notes.includes(d) ? ' is-on' : ''}">${notes.includes(d) ? d : ''}</span>`).join('')}</div>`;
      } else {
        el.innerHTML = '';
      }
      el.removeAttribute('aria-label');
    }
  }

  /** Colorblind-safe: selection is a thick outline, same-digit is an underline/ring on the digit
   *  (not just a fill), and a conflict gets both a strikethrough AND an aria-label. Hue (if any)
   *  is never the only signal. */
  _paintHighlights() {
    const g = this.game;
    const sel = this.selected;
    const selRow = sel >= 0 ? (sel / 9) | 0 : -1;
    const selCol = sel >= 0 ? sel % 9 : -1;
    const selBox = sel >= 0 ? (((selRow / 3) | 0) * 3 + ((selCol / 3) | 0)) : -1;
    const selDigit = sel >= 0 ? g.cells[sel] : 0;
    const conflicts = g.conflictSet();
    for (let i = 0; i < 81; i++) {
      const el = this.cellEls[i];
      if (!el) continue;
      const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
      const inPeerUnit = sel >= 0 && (r === selRow || c === selCol || b === selBox);
      el.classList.toggle('sd-selected', i === sel);
      el.classList.toggle('sd-peer', inPeerUnit && i !== sel);
      el.classList.toggle('sd-same', selDigit > 0 && g.cells[i] === selDigit && i !== sel);
      const isConflict = conflicts.has(i);
      el.classList.toggle('sd-conflict', isConflict);
      if (isConflict) el.setAttribute('aria-label', t('conflict_aria'));
    }
  }

  _showWin(recordResult) {
    if (recordResult && !this._winRecorded) {
      this._winRecorded = true;
      this._pauseTimer();
      const g = this.game;
      try { recordSudoku(g.tier, { timeMs: g.elapsedMs, mistakes: g.mistakes, hints: g.hints }); } catch (err) { console.error('[sudoku] recordSudoku', err); }
      clearSave();
    }
    clearInterval(this._timerInterval);
    const g = this.game;
    const name = this.profile && this.profile.name;
    const detailKey = name ? 'win_detail_named' : 'win_detail';
    this.el.winDetail.textContent = t(detailKey, { name: name || '', time: fmtTime(g.elapsedMs), mistakes: g.mistakes, hints: g.hints });
    this.el.winOverlay.hidden = false;
  }

  // --- layout: one screen, no scrolling -------------------------------------------------------

  /** Pins `.sd-root` to the REAL on-screen box of `this.container` - `#sudoku` standalone,
   *  `.hub-game` when mounted - by measurement, not CSS. `container.getBoundingClientRect()`
   *  already reflects the hub's sticky header pushing the mount point down; a plain
   *  `position: absolute; inset: 0` cannot see that (`.hub-game` has no defined CSS height for it
   *  to fill), so it fell back to the viewport and hid this screen's own HUD under the header. Run
   *  on every render and on `onViewportResize` (rotation, URL bar show/hide, keyboard). */
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

  _fit() {
    if (this.screen !== 'play' || !this.el || !this.el.board) return;
    const root = this.root;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    const wrap = this.el.board.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const below = (this.el.controls ? this.el.controls.getBoundingClientRect().height : 60)
      + (this.el.pad ? this.el.pad.getBoundingClientRect().height : 60) + 24;
    const availH = Math.max(200, vh - wrapRect.top - below);
    const availW = wrapRect.width;
    // 297px / 9 = 33px per cell, the smallest a cell can be and still hold a 3x3 note grid of
    // 11px digits (the UX floor, docs/BUILDING-A-GAME.md Part 0) without clipping.
    const size = Math.max(297, Math.floor(Math.min(availW, availH)));
    this.el.board.style.width = size + 'px';
    this.el.board.style.height = size + 'px';
  }

  destroy() {
    this._pauseTimer();
    clearInterval(this._timerInterval);
    if (this.game && this.screen === 'play' && !this.game.isSolved()) writeSave(this.game);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.root) {
      if (this._onRootClick) this.root.removeEventListener('click', this._onRootClick);
      if (this._onRootKey) this.root.removeEventListener('keydown', this._onRootKey);
    }
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this._offLang) { this._offLang(); this._offLang = null; }
    this.container.innerHTML = '';
    this.game = null;
    this.cellEls = [];
  }

  /** Autosave/resume built in (root CLAUDE.md's second isInProgress() meaning): the board is
   *  written after every input, so leaving mid-puzzle is lossless. */
  isInProgress() { return false; }
}

// --- the module contract ---------------------------------------------------------------------

let instance = null;

function ensureStylesheet() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-sudoku-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/sudoku.css', import.meta.url).href;
  link.setAttribute('data-sudoku-css', '1');
  document.head.appendChild(link);
}

export function init(container) {
  ensureStylesheet();
  if (instance) instance.destroy();
  instance = new SudokuUI(container);
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
