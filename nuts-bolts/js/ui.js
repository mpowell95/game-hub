import { NutsBoltsGame, getTopRun } from './game.js';
import { CAP, PALETTE, isBoltComplete, TIER_ORDER } from './generator.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordNutsBolts } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const STORAGE_KEY = 'gamehub.nutsbolts.v1';
// generator.js's own TIER_LABELS/TIER_DESCRIPTIONS/PALETTE.name stay English (that file is a
// pure, DOM-free engine module, same discipline as game.js/ai.js) — these local maps translate
// the same keys for display instead.
const TIER_LABEL_KEY = { easy: 'tier_easy', medium: 'tier_medium', hard: 'tier_hard', extraHard: 'tier_extra_hard' };
const COLOR_NAME_KEY = Object.fromEntries(PALETTE.map((p) => [p.key, 'color_' + p.key]));
// game.js returns storage-vocabulary reason codes (empty/locked/full/color-mismatch); this maps
// them onto display text.
const REASON_KEY = { empty: 'reason_empty', locked: 'reason_locked', full: 'reason_full', 'color-mismatch': 'reason_color_mismatch' };

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const ICON_RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const ICON_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.4c0 1.6-2.1 1.9-2.1 3.6"/><path d="M12 17.5v.01"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

// One simple, chunky, filled inline glyph per color (WP3b). fill="currentColor"
// throughout so the emboss color (see .nb-nut-symbol CSS) applies uniformly.
const SYMBOLS = {
  yellow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="4.7"/><line x1="12" y1="19.3" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.7" y2="12"/><line x1="19.3" y1="12" x2="22.5" y2="12"/><line x1="4.6" y1="4.6" x2="6.9" y2="6.9"/><line x1="17.1" y1="17.1" x2="19.4" y2="19.4"/><line x1="4.6" y1="19.4" x2="6.9" y2="17.1"/><line x1="17.1" y1="6.9" x2="19.4" y2="4.6"/></g></svg>',
  blue: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C12 2 5 11.2 5 15.3a7 7 0 0 0 14 0C19 11.2 12 2 12 2z"/></svg>',
  orange: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M13 1.5 4 14h6l-1.2 8.5L20 10h-6.3z"/></svg>',
  teal: '<svg viewBox="0 0 24 24"><circle cx="7" cy="18" r="3.4" fill="currentColor"/><rect x="9.2" y="3" width="2" height="14" fill="currentColor"/><path fill="currentColor" d="M11.2 3c3.4 0 5.6 2.1 5.6 5.1-1.1-1.1-3.2-1.2-5.6-.1z"/></svg>',
  purple: '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12.8 2.1a10 10 0 1 0 8.8 15.6A8.2 8.2 0 0 1 12.8 2.1z"/></svg>',
  pink: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 8l4.2 3.6L12 4.3l4.8 7.3L21 8l-2 10.5H5z"/></svg>',
  slate: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.7l2.9 6.7 7.2.6-5.5 4.8 1.7 7.1L12 17l-6.3 3.9 1.7-7.1L1.9 9l7.2-.6z"/></svg>',
  sky: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.8 22 12 12 22.2 2 12z"/></svg>',
  red: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21.2s-7.6-4.7-10.1-9.5C.2 8.6 2 4 6.1 4c2.2 0 3.6 1.3 4.5 2.7C11.5 5.3 12.9 4 15.1 4c4 0 5.9 4.6 4.1 7.7-2.6 4.8-7.2 9.5-7.2 9.5z"/></svg>',
  green: '<svg viewBox="0 0 24 24"><circle cx="8" cy="9.5" r="3.9" fill="currentColor"/><circle cx="16" cy="9.5" r="3.9" fill="currentColor"/><circle cx="12" cy="15" r="3.9" fill="currentColor"/><path fill="currentColor" d="M10.3 15.6h3.4l1.6 5.9H8.7z"/></svg>',
  lime: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.5 3.5C10.8 3.8 4.3 10.1 4 19.8c9.7-.3 16.2-6.6 16.5-16.3z"/><line x1="5.5" y1="18.5" x2="18.5" y2="5.5" stroke="rgba(0,0,0,0.25)" stroke-width="1.4"/></svg>',
  brown: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6.2 6.6a2.6 2.6 0 1 0-3.6 3.7 2.6 2.6 0 1 0 3.6 3.7c.9 0 1.7-.4 2.2-1.1h7.2c.5.7 1.3 1.1 2.2 1.1a2.6 2.6 0 1 0 3.6-3.7 2.6 2.6 0 1 0-3.6-3.7c-.9 0-1.7.4-2.2 1.1H8.4c-.5-.7-1.3-1.1-2.2-1.1z"/></svg>',
};

const CONFETTI_COLORS = PALETTE.map((p) => p.hex);

const DEFAULT_LEVELS = { easy: 1, medium: 1, hard: 1, extraHard: 1 };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function pluralMoves(n) {
  return t(n === 1 ? 'move_one' : 'move_other', { n });
}

// Boards range 5 to 17 bolts; three CSS size tiers, switched by one class on
// the board root so every dependent metric (nut size, base plates, rod
// height) scales together via custom properties, not hardcoded per-element.
const SIZE_TIERS = ['nb-size-l', 'nb-size-m', 'nb-size-s'];

function sizeClassFor(boltCount) {
  if (boltCount <= 8) return 'nb-size-l';
  if (boltCount <= 12) return 'nb-size-m';
  return 'nb-size-s';
}

// LAYOUT-1 continuous fallback: 'nb-size-s' (the smallest discrete tier) can
// still overflow a short viewport on the biggest boards (Extra Hard's 15
// bolts, confirmed against the reported screenshot). These mirror
// .nb-board.nb-size-s's own values in nuts-bolts.css - the base this scales
// down from once the discrete tiers run out. Never below MIN_CONTINUOUS_SCALE
// so bolts stay legible/tappable rather than shrinking indefinitely.
const SIZE_S_BASE = { nutH: 25, nutW: 46, rodH: 26, boltW: 58, washerW: 36, washerH: 9, gapRow: 12, gapCol: 14 };
const MIN_CONTINUOUS_SCALE = 0.6;
const CONTINUOUS_SCALE_ATTEMPTS = 6;
// This shrink-to-fit is a phone-viewport concern (nuts-bolts.css's own desktop
// tweak already lives behind the same breakpoint, :825). A short but WIDE
// desktop browser window scrolling is normal and expected - not the bug this
// batch is about - so don't shrink there.
const PHONE_WIDTH_MAX = 699;

// Builds one nut element: outer wrapper, clipped hex face (top-face band +
// 3-facet body + bore), and a centered symbol (or "?" for hidden). Shared by
// the real board render and the fx-layer's flying clones so both stay
// visually identical.
function buildNutEl(nut) {
  const nutEl = document.createElement('div');
  nutEl.className = 'nb-nut';
  const face = document.createElement('div');
  face.className = 'nb-nut-face';
  const top = document.createElement('div');
  top.className = 'nb-nut-top';
  face.appendChild(top);
  nutEl.appendChild(face);
  if (nut.hidden) {
    nutEl.dataset.hidden = 'true';
    const mark = document.createElement('span');
    mark.className = 'nb-hidden-mark';
    mark.textContent = '?';
    nutEl.appendChild(mark);
  } else {
    nutEl.dataset.color = nut.color;
    const symbol = document.createElement('span');
    symbol.className = 'nb-nut-symbol';
    symbol.innerHTML = SYMBOLS[nut.color] || '';
    nutEl.appendChild(symbol);
  }
  return nutEl;
}

function ensureStylesheet() {
  const href = new URL('../css/nuts-bolts.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/nuts-bolts.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function freshState() {
  return { version: 2, currentDifficulty: 'easy', levels: { ...DEFAULT_LEVELS }, board: null, settings: {} };
}

// Persistence schema v2 (see WP2d). Migrates a v1 blob (single endless level,
// no tiers) by mapping its level/board onto the 'easy' tier. Any unknown or
// corrupt data falls back to a fresh v2 default; this never crashes.
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fresh: true, data: freshState() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { fresh: true, data: freshState() };

    if (parsed.version === 1) {
      const migrated = freshState();
      migrated.levels.easy = typeof parsed.level === 'number' && parsed.level > 0 ? parsed.level : 1;
      migrated.currentDifficulty = 'easy';
      if (parsed.board && typeof parsed.board === 'object') {
        migrated.board = { difficulty: 'easy', ...parsed.board };
      }
      return { fresh: false, data: migrated };
    }

    if (parsed.version === 2) {
      const fresh = freshState();
      const levels = { ...fresh.levels, ...(parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {}) };
      const currentDifficulty = TIER_ORDER.includes(parsed.currentDifficulty) ? parsed.currentDifficulty : 'easy';
      const board = parsed.board && typeof parsed.board === 'object' ? parsed.board : null;
      return { fresh: false, data: { version: 2, currentDifficulty, levels, board, settings: {} } };
    }

    return { fresh: true, data: freshState() };
  } catch {
    return { fresh: true, data: freshState() };
  }
}

function saveState(ui) {
  try {
    const board = ui.game && ui.game.moves > 0 && !ui.game.isWon() ? ui.game.toSaved() : null;
    const data = { version: 2, currentDifficulty: ui.currentDifficulty, levels: ui.levels, board, settings: {} };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can fail (quota, private mode); the game continues in-memory.
  }
}

class NutsBoltsUI {
  constructor(container) {
    ensureStylesheet();
    this.container = container;
    this.profile = loadProfile();

    const saved = loadSaved();
    this.levels = saved.data.levels;
    this.currentDifficulty = saved.data.currentDifficulty;
    this.showHelpOnStart = saved.fresh;
    this._winRecorded = false;

    this.toastTimer = null;
    this.longPressTimer = null;
    this.longPressStart = null;
    this.longPressBoltIndex = null;
    this.suppressNextClick = false;

    this.onDocPointerUp = this.onDocPointerUp.bind(this);
    this.onDocPointerMove = this.onDocPointerMove.bind(this);

    // LAYOUT-1: the board's size tier (nb-size-l/m/s) was chosen purely by bolt
    // count, with no regard for whether it actually fits the viewport - a phone
    // a little shorter than the reference device still overflowed and forced a
    // page scroll. `_sizeOverride` forces a smaller tier than the natural one
    // when `fitToViewport` (below) measures an overflow; reset per level so a
    // roomier level (or a resize back to a taller viewport) isn't stuck small.
    this._sizeOverride = null;
    this._resizeTimer = null;
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    // The difficulty menu is the entry point when there is nothing to resume.
    // A persisted in-progress board (if any) is kept aside and, per batch-9's
    // "every game defaults to resumable" (HANDOFF-FB-RESUME.md), auto-resumed
    // straight into the game screen below - the menu/tier-tap detour is now
    // only for starting fresh or switching tiers.
    this.game = null;
    this.savedBoard = saved.data.board || null;
    this.screen = 'menu';
    // Two-step select-then-start menu (2026-07-24, batch 8): a segmented row picks the
    // tier, a separate "Start" button commits. Defaults to the last-played tier so
    // returning to the menu doesn't lose the player's place; selecting a different tier
    // never touches this.currentDifficulty (or the resume-board logic below) until Start
    // is actually pressed, in startTier().
    this.selectedTier = this.currentDifficulty;

    // Auto-resume (batch 9): a saved board exists, so skip the menu and go
    // straight back into it via the SAME startTier()/resumingFromDisk path
    // used when the player taps the matching tier manually - no second
    // resume mechanism, no "resume?" dialog. No saved board -> normal menu,
    // last-played tier preselected (unchanged).
    if (this.savedBoard) {
      this.startTier(this.savedBoard.difficulty);
    } else {
      this.render();
    }
  }

  persist() {
    saveState(this);
  }

  render() {
    if (this.screen === 'game') this.renderGame();
    else this.renderMenu();
  }

  // --- Difficulty menu ---

  renderMenu() {
    this.container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'nb-root nb-menu';
    const segs = TIER_ORDER.map((tier) => `
      <button type="button" class="nb-segbtn${tier === this.selectedTier ? ' is-selected' : ''}"
        data-tier="${tier}" role="radio" aria-checked="${tier === this.selectedTier}">
        <span class="nb-segbtn-label">${diffShapeSVG(tierOf(tier))}${esc(t(TIER_LABEL_KEY[tier]))}</span>
        <span class="nb-segbtn-level">${t('level_n', { n: this.levels[tier] })}</span>
      </button>
    `).join('');
    root.innerHTML = `
      <div class="nb-menu-header">
        <h1>${t('title')}</h1>
        <p>${t('tagline')}</p>
      </div>
      <div class="nb-field">
        <span class="nb-fieldlabel" id="nb-difflabel">${t('tagline')}</span>
        <div class="nb-seg" role="radiogroup" aria-labelledby="nb-difflabel">${segs}</div>
      </div>
      <button type="button" class="nb-btn nb-btn-primary nb-start-btn" data-action="start">${t('start')}</button>
    `;
    this.container.appendChild(root);
    this.root = root;
    root.addEventListener('click', (e) => {
      const seg = e.target.closest('[data-tier]');
      if (seg) {
        this.selectedTier = seg.dataset.tier;
        root.querySelectorAll('.nb-segbtn').forEach((b) => {
          const on = b.dataset.tier === this.selectedTier;
          b.classList.toggle('is-selected', on);
          b.setAttribute('aria-checked', String(on));
        });
        return;
      }
      const actionEl = e.target.closest('[data-action="start"]');
      if (actionEl) this.startTier(this.selectedTier);
    });
  }

  startTier(tier) {
    // "Start/continue that tier": only one board slot exists in storage (see
    // the v2 schema). Resume it if it already belongs to this same tier,
    // either still in memory (the player just backed out to the menu) or
    // persisted from a previous session; otherwise generate a fresh level.
    const resumingInMemory = this.game && this.currentDifficulty === tier;
    const resumingFromDisk = !resumingInMemory && this.savedBoard && this.savedBoard.difficulty === tier;
    this.currentDifficulty = tier;
    if (resumingFromDisk) {
      this.game = new NutsBoltsGame(tier, this.levels[tier], this.savedBoard);
      this._winRecorded = false;
    } else if (!resumingInMemory) {
      this.game = new NutsBoltsGame(tier, this.levels[tier], null);
      this._winRecorded = false;
    }
    this.savedBoard = null; // consumed either way; a fresh level replaces it either way
    this.screen = 'game';
    this.persist();
    this.renderGame();
    if (this.showHelpOnStart) {
      this.showHelpOnStart = false;
      this.openHelp();
    }
  }

  // --- Game screen ---

  renderGame() {
    this._sizeOverride = null;
    this.container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'nb-root';
    root.innerHTML = `
      <div class="nb-topbar">
        <button type="button" class="nb-headerbtn" data-action="back-to-menu" aria-label="${t('back_to_menu_aria')}">${ICON_BACK}</button>
        <div class="nb-title">
          <span class="nb-eyebrow" data-role="tier-label"></span>
          <span class="nb-level-num" data-role="level"></span>
        </div>
        <button type="button" class="nb-headerbtn" data-action="restart" aria-label="${t('restart_aria')}">${ICON_RESTART}</button>
      </div>
      <div class="nb-moves" data-role="moves"></div>
      <div class="nb-board" data-role="board"></div>
      <div class="nb-fx-layer" data-role="fx-layer"></div>
      <div class="nb-bottombar">
        <div class="nb-bottombtn-wrap">
          <button type="button" class="nb-bottombtn" data-action="undo" aria-label="${t('undo_aria')}">${ICON_UNDO}</button>
          <span class="nb-bottombtn-label">${t('undo_label')}</span>
        </div>
        <div class="nb-bottombtn-wrap">
          <button type="button" class="nb-bottombtn" data-action="help" aria-label="${t('help_aria')}">${ICON_HELP}</button>
          <span class="nb-bottombtn-label">${t('help_label')}</span>
        </div>
      </div>
      <div class="nb-toast" role="status" aria-live="polite" data-role="toast">
        <span class="nb-toast-chip" data-role="toast-chip"></span>
        <span data-role="toast-text"></span>
      </div>
      <div class="nb-assist" role="status" aria-live="polite" data-role="assist" hidden></div>
      <div class="nb-overlay" data-role="restart-overlay" hidden>
        <div class="nb-confirm" data-role="restart-confirm">
          <p>${t('restart_confirm_msg')}</p>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn" data-action="restart-cancel">${t('cancel')}</button>
            <button type="button" class="nb-btn nb-btn-primary" data-action="restart-confirm">${t('restart')}</button>
          </div>
        </div>
      </div>
      <div class="nb-overlay" data-role="win-overlay" hidden>
        <div class="nb-panel">
          <button type="button" class="nb-panel-close" data-action="close-win" aria-label="${t('close_aria')}">&times;</button>
          <div class="nb-win-flash" data-role="win-flash"></div>
          <div class="nb-confetti-layer" data-role="confetti"></div>
          <h2 data-role="win-title"></h2>
          <p data-role="win-detail"></p>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn nb-btn-primary" data-action="next-level">${t('next_level')}</button>
          </div>
        </div>
      </div>
      <div class="nb-overlay" data-role="help-overlay" hidden>
        <div class="nb-panel">
          <button type="button" class="nb-panel-close" data-action="close-help" aria-label="${t('close_aria')}">&times;</button>
          <h2>${t('howto')}</h2>
          <div class="nb-help-body">
            <ul>
              <li>${t('help_li_1')}</li>
              <li>${t('help_li_2')}</li>
              <li>${t('help_li_3')}</li>
              <li>${t('help_li_4')}</li>
              <li>${t('help_li_5')}</li>
              <li>${t('help_li_6')}</li>
              <li>${t('help_li_7')}</li>
            </ul>
          </div>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn nb-btn-primary" data-action="close-help">${t('ok')}</button>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(root);
    this.root = root;
    this.boardEl = root.querySelector('[data-role="board"]');
    this.fxLayer = root.querySelector('[data-role="fx-layer"]');
    this.confettiLayer = root.querySelector('[data-role="confetti"]');
    this.winFlash = root.querySelector('[data-role="win-flash"]');
    this.toastEl = root.querySelector('[data-role="toast"]');
    this.toastChip = root.querySelector('[data-role="toast-chip"]');
    this.toastTextEl = root.querySelector('[data-role="toast-text"]');
    this.assistEl = root.querySelector('[data-role="assist"]');
    this.winOverlay = root.querySelector('[data-role="win-overlay"]');
    this.helpOverlay = root.querySelector('[data-role="help-overlay"]');
    this.restartOverlay = root.querySelector('[data-role="restart-overlay"]');

    root.addEventListener('click', this.onClick.bind(this));

    this.renderBoard();
    this.updateTopbar();
    this.boardEl.classList.add('nb-fade-in');
    this.fitToViewport();
  }

  // LAYOUT-1: shrink the board's size tier (never below 'nb-size-s') until the
  // page no longer needs to scroll, or there's nothing smaller left to try.
  // document.documentElement.scrollHeight vs window.innerHeight is the same
  // black-box measurement CLAUDE.md documents for Escoba's viewport budget -
  // it works regardless of which element (hub chrome vs this game) is at fault.
  fitToViewport() {
    if (this.screen !== 'game' || !this.boardEl || !this.game) return;
    if (window.innerWidth > PHONE_WIDTH_MAX) { this.clearContinuousScale(); return; }
    this.clearContinuousScale();
    let tierIndex = SIZE_TIERS.indexOf(this._sizeOverride || sizeClassFor(this.game.stacks.length));
    while (document.documentElement.scrollHeight > window.innerHeight && tierIndex < SIZE_TIERS.length - 1) {
      tierIndex += 1;
      this._sizeOverride = SIZE_TIERS[tierIndex];
      this.renderBoard();
    }
    // The smallest discrete tier can still overflow on the biggest boards (see
    // SIZE_S_BASE above) - shrink continuously from there rather than stopping.
    if (SIZE_TIERS[tierIndex] !== 'nb-size-s') return;
    let scale = 1;
    for (let i = 0; i < CONTINUOUS_SCALE_ATTEMPTS; i++) {
      const overflow = document.documentElement.scrollHeight - window.innerHeight;
      if (overflow <= 0 || scale <= MIN_CONTINUOUS_SCALE) break;
      const boardHeight = this.boardEl.getBoundingClientRect().height;
      if (boardHeight <= 0) break;
      const neededBoardHeight = Math.max(boardHeight - overflow, boardHeight * MIN_CONTINUOUS_SCALE);
      scale = Math.max(MIN_CONTINUOUS_SCALE, scale * (neededBoardHeight / boardHeight));
      this.applyContinuousScale(scale);
    }
  }

  applyContinuousScale(scale) {
    const s = this.boardEl.style;
    s.setProperty('--nb-nut-h', `${SIZE_S_BASE.nutH * scale}px`);
    s.setProperty('--nb-nut-w', `${SIZE_S_BASE.nutW * scale}px`);
    s.setProperty('--nb-rod-h', `${SIZE_S_BASE.rodH * scale}px`);
    s.setProperty('--nb-bolt-w', `${SIZE_S_BASE.boltW * scale}px`);
    s.setProperty('--nb-washer-w', `${SIZE_S_BASE.washerW * scale}px`);
    s.setProperty('--nb-washer-h', `${SIZE_S_BASE.washerH * scale}px`);
    s.setProperty('--nb-gap-row', `${SIZE_S_BASE.gapRow * scale}px`);
    s.setProperty('--nb-gap-col', `${SIZE_S_BASE.gapCol * scale}px`);
  }

  clearContinuousScale() {
    if (!this.boardEl) return;
    const s = this.boardEl.style;
    ['--nb-nut-h', '--nb-nut-w', '--nb-rod-h', '--nb-bolt-w', '--nb-washer-w', '--nb-washer-h', '--nb-gap-row', '--nb-gap-col']
      .forEach((prop) => s.removeProperty(prop));
  }

  onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      if (this.screen !== 'game' || !this.boardEl || !this.game) return;
      // A resize can make more room too (rotating back to portrait, a taller
      // browser chrome collapsing) - re-derive from the natural tier each time
      // rather than only ever shrinking further.
      this._sizeOverride = null;
      this.renderBoard();
      this.fitToViewport();
    }, 120);
  }

  updateTopbar(pulseMoves) {
    this.root.querySelector('[data-role="tier-label"]').textContent = t(TIER_LABEL_KEY[this.currentDifficulty]) || '';
    this.root.querySelector('[data-role="level"]').textContent = t('level_n', { n: this.game.level });
    const movesEl = this.root.querySelector('[data-role="moves"]');
    movesEl.textContent = pluralMoves(this.game.moves);
    if (pulseMoves) {
      movesEl.classList.remove('nb-pulse');
      // eslint-disable-next-line no-unused-expressions
      movesEl.offsetWidth; // restart the animation
      movesEl.classList.add('nb-pulse');
      setTimeout(() => movesEl.classList.remove('nb-pulse'), 180);
    }
    this.root.querySelector('[data-action="undo"]').disabled = !this.game.canUndo();
  }

  renderBoard() {
    this.boardEl.innerHTML = '';
    this.boardEl.className = 'nb-board ' + (this._sizeOverride || sizeClassFor(this.game.stacks.length));
    this.game.stacks.forEach((stack, index) => {
      const locked = isBoltComplete(stack);
      const bolt = document.createElement('div');
      bolt.className = 'nb-bolt' + (locked ? ' nb-locked' : '') + (this.game.selected === index ? ' nb-selected' : '');
      bolt.dataset.index = String(index);
      bolt.setAttribute('role', 'button');
      bolt.setAttribute('tabindex', '0');
      bolt.setAttribute('aria-label', t('bolt_aria', { n: index + 1 }));
      bolt.innerHTML = '<div class="nb-bolt-rod"></div><div class="nb-bolt-dome"></div><div class="nb-bolt-stack"></div><div class="nb-bolt-badge">&#10003;</div>';
      const stackEl = bolt.querySelector('.nb-bolt-stack');

      const run = this.game.selected === index ? getTopRun(stack) : { length: 0 };
      stack.forEach((nut, i) => {
        const nutEl = buildNutEl(nut);
        const lifted = this.game.selected === index && i >= stack.length - run.length;
        if (lifted) nutEl.classList.add('nb-lifted');
        if (i === stack.length - 1) nutEl.classList.add('nb-top-nut');
        stackEl.appendChild(nutEl);
      });

      for (let i = stack.length; i < CAP; i++) {
        const ghost = document.createElement('div');
        ghost.className = 'nb-slot-ghost';
        stackEl.appendChild(ghost);
      }

      bolt.addEventListener('pointerdown', (e) => this.onBoltPointerDown(e, index));
      this.boardEl.appendChild(bolt);
    });
  }

  onClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      this.handleAction(actionEl.dataset.action);
      return;
    }
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    const bolt = e.target.closest('.nb-bolt');
    if (bolt) this.handleBoltTap(Number(bolt.dataset.index));
  }

  handleAction(action) {
    switch (action) {
      case 'back-to-menu':
        this.screen = 'menu';
        this.renderMenu();
        break;
      case 'undo':
        if (this.game.undo()) {
          this.persist();
          this.renderBoard();
          this.updateTopbar();
        }
        break;
      case 'restart':
        this.restartOverlay.hidden = false;
        break;
      case 'restart-cancel':
        this.restartOverlay.hidden = true;
        break;
      case 'restart-confirm':
        this.game.restart();
        this._winRecorded = false;
        this.restartOverlay.hidden = true;
        this.persist();
        this.renderBoard();
        this.updateTopbar();
        break;
      case 'help':
        this.openHelp();
        break;
      case 'close-help':
        this.helpOverlay.hidden = true;
        break;
      case 'close-win':
        // Non-destructive dismiss: reveal the finished board, same as every
        // other game's end-of-game X. Solving progress/level is unaffected;
        // "Next level" is the only way to actually advance.
        this.winOverlay.hidden = true;
        break;
      case 'next-level':
        this.winOverlay.hidden = true;
        this.levels[this.currentDifficulty] += 1;
        this.game = new NutsBoltsGame(this.currentDifficulty, this.levels[this.currentDifficulty], null);
        this._winRecorded = false;
        this.persist();
        this.renderBoard();
        this.updateTopbar();
        break;
      default:
        break;
    }
  }

  openHelp() {
    this.helpOverlay.hidden = false;
  }

  handleBoltTap(index) {
    // Capture the pre-move DOM rects before `select()` mutates state, so the
    // move can be replayed as a visible travel animation after re-render.
    const pendingFrom = this.game.selected;
    const preRects = pendingFrom !== null && pendingFrom !== index ? this.captureTopRunRects(pendingFrom) : null;
    const attemptColor = pendingFrom !== null ? getTopRun(this.game.stacks[pendingFrom]).color : null;

    const result = this.game.select(index);
    if (result.reason) {
      const chipColor = result.reason === 'color-mismatch' ? attemptColor : null;
      this.showToast(t(REASON_KEY[result.reason]) || result.reason, chipColor);
      // Shake the bolt just tapped: for a select-time rejection that's the
      // attempted source, for an illegal move attempt it's the destination,
      // so feedback always points at whichever bolt the player just touched.
      this.shakeBolt(index);
    }
    if (result.changed) {
      this.renderBoard();
      this.updateTopbar(result.isMove);
      if (result.isMove) {
        this.persist();
        if (preRects && preRects.length) this.animateMove(preRects, result.to, result.count);
        const destStack = this.game.stacks[result.to];
        if (isBoltComplete(destStack)) this.flashCompleted(result.to);
      }
      if (result.won) this.showWin();
    }
  }

  // The topmost run currently visible on `boltIndex`, captured as DOM rects
  // (relative to the root) before the move mutates the model.
  captureTopRunRects(boltIndex) {
    const stack = this.game.stacks[boltIndex];
    const run = getTopRun(stack);
    if (!run.length) return [];
    const boltEl = this.boardEl.querySelector(`[data-index="${boltIndex}"]`);
    if (!boltEl) return [];
    const nutEls = [...boltEl.querySelectorAll('.nb-nut')].slice(-run.length);
    const rootRect = this.root.getBoundingClientRect();
    return nutEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - rootRect.left,
        top: r.top - rootRect.top,
        width: r.width,
        height: r.height,
        color: el.dataset.color,
        hidden: el.dataset.hidden === 'true',
      };
    });
  }

  // Only the last `count` captured nuts actually moved (a partial group takes
  // the topmost portion of the run, see game.js). The whole group flies as a
  // single clone unit (one wrapper, not one clone per nut) from its old
  // position to where the destination bolt just rendered it: a 300ms
  // lift/arc-travel/drop+squash, purely visual over already-committed state.
  // Destination nuts stay hidden (visibility, not display) until the clone
  // lands so no double image ever shows; this is fire-and-forget, so spam-tap,
  // undo-mid-animation, and reload-mid-animation never wait on it.
  animateMove(preRects, toIndex, count) {
    const moved = preRects.slice(-count);
    if (!moved.length) return;
    const boltEl = this.boardEl.querySelector(`[data-index="${toIndex}"]`);
    if (!boltEl) return;
    const newEls = [...boltEl.querySelectorAll('.nb-nut')].slice(-count);
    if (newEls.length !== moved.length) return;
    const rootRect = this.root.getBoundingClientRect();

    const oldLeft = moved[0].left;
    const oldTop = Math.min(...moved.map((r) => r.top));
    const oldBottom = Math.max(...moved.map((r) => r.top + r.height));
    const width = moved[0].width;
    const height = oldBottom - oldTop;

    const newRects = newEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - rootRect.left, top: r.top - rootRect.top };
    });
    const newLeft = newRects[0].left;
    const newTop = Math.min(...newRects.map((r) => r.top));
    const dx = newLeft - oldLeft;
    const dy = newTop - oldTop;

    newEls.forEach((el) => el.classList.add('nb-fx-hidden'));

    const group = document.createElement('div');
    group.className = 'nb-fx-group';
    group.style.left = `${oldLeft}px`;
    group.style.top = `${oldTop}px`;
    group.style.width = `${width}px`;
    group.style.height = `${height}px`;
    moved.forEach((r) => {
      const nutEl = buildNutEl({ color: r.color, hidden: r.hidden });
      nutEl.style.position = 'absolute';
      nutEl.style.left = '0px';
      nutEl.style.top = `${r.top - oldTop}px`;
      nutEl.style.width = `${r.width}px`;
      nutEl.style.height = `${r.height}px`;
      group.appendChild(nutEl);
    });
    this.fxLayer.appendChild(group);

    // 60ms lift + 120ms arc travel + 80ms drop + 40ms squash = 300ms total.
    const anim = group.animate([
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0, easing: 'ease-out' },
      { transform: 'translate(0px, -12px) scale(1, 1)', offset: 0.2, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 12 - 14}px) scale(1, 1)`, offset: 0.4, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: `translate(${dx}px, ${dy - 12}px) scale(1, 1)`, offset: 0.6, easing: 'cubic-bezier(.34,1.4,.64,1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(1, 1)`, offset: 0.867, easing: 'ease-out' },
      { transform: `translate(${dx}px, ${dy}px) scale(1.06, 0.88)`, offset: 0.933, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${dy}px) scale(1, 1)`, offset: 1 },
    ], { duration: 300, fill: 'forwards' });

    anim.finished.then(() => {
      group.remove();
      newEls.forEach((el) => el.classList.remove('nb-fx-hidden'));
    }).catch(() => {
      group.remove();
      newEls.forEach((el) => el.classList.remove('nb-fx-hidden'));
    });
  }

  flashCompleted(boltIndex) {
    const boltEl = this.boardEl.querySelector(`[data-index="${boltIndex}"]`);
    if (!boltEl) return;
    boltEl.classList.add('nb-just-completed');
    setTimeout(() => boltEl.classList.remove('nb-just-completed'), 320);
  }

  shakeBolt(index) {
    const bolt = this.boardEl.querySelector(`[data-index="${index}"]`);
    if (!bolt) return;
    bolt.classList.remove('nb-shake');
    // eslint-disable-next-line no-unused-expressions
    bolt.offsetWidth; // restart the animation
    bolt.classList.add('nb-shake');
  }

  showToast(text, colorKey) {
    this.toastTextEl.textContent = text;
    this.toastChip.style.background = colorKey ? `var(--nb-${colorKey})` : 'var(--nb-muted)';
    this.toastEl.classList.add('nb-toast-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('nb-toast-visible');
    }, 1600);
  }

  showWin() {
    // Record the solve exactly once per level instance. `_winRecorded` resets wherever a new
    // board is started (constructor / restart / next-level), so undoing past the winning move
    // and re-solving the same board cannot double-count. Never break the game over stats.
    if (!this._winRecorded) {
      this._winRecorded = true;
      try { recordNutsBolts(this.game.level, this.game.moves, this.currentDifficulty); } catch { /* ignore */ }
    }
    const name = this.profile && this.profile.name;
    const title = t('win_title', { n: this.game.level });
    const detail = name ? t('win_detail_named', { name: esc(name), moves: pluralMoves(this.game.moves) }) : t('win_detail', { moves: pluralMoves(this.game.moves) });
    this.root.querySelector('[data-role="win-title"]').textContent = title;
    this.root.querySelector('[data-role="win-detail"]').innerHTML = detail;
    this.winOverlay.hidden = false;
    this.launchConfetti();
    if (this.winFlash) {
      this.winFlash.classList.remove('nb-flash-active');
      // eslint-disable-next-line no-unused-expressions
      this.winFlash.offsetWidth; // restart the animation
      this.winFlash.classList.add('nb-flash-active');
    }
  }

  // A single restrained burst, not a persistent effect: capped piece count,
  // fires once per win, cleans itself up after the fall animation ends.
  // transform/opacity only, no per-frame box-shadow/filter, to stay inside
  // the frame budget.
  launchConfetti() {
    if (!this.confettiLayer) return;
    this.confettiLayer.innerHTML = '';
    const pieceCount = 28;
    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement('div');
      piece.className = 'nb-confetti-piece';
      piece.style.left = `${(i / pieceCount) * 100 + (Math.random() * 6 - 3)}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = `${Math.random() * 120}ms`;
      piece.style.setProperty('--nb-confetti-rot', `${Math.round(Math.random() * 720)}deg`);
      piece.style.setProperty('--nb-confetti-scale', (0.6 + Math.random() * 0.6).toFixed(2));
      piece.style.setProperty('--nb-confetti-dx', `${Math.round(Math.random() * 120 - 60)}px`);
      this.confettiLayer.appendChild(piece);
    }
  }

  // --- Long-press color assist ---

  onBoltPointerDown(e, index) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.longPressStart = { x: e.clientX, y: e.clientY };
    this.longPressBoltIndex = index;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.showAssist(index, e.clientX, e.clientY);
      this.suppressNextClick = true;
      this.longPressTimer = null;
    }, LONG_PRESS_MS);
    document.addEventListener('pointerup', this.onDocPointerUp, { once: true });
    document.addEventListener('pointermove', this.onDocPointerMove);
  }

  onDocPointerMove(e) {
    if (!this.longPressStart) return;
    const dx = e.clientX - this.longPressStart.x;
    const dy = e.clientY - this.longPressStart.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  onDocPointerUp() {
    document.removeEventListener('pointermove', this.onDocPointerMove);
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStart = null;
    this.hideAssist();
  }

  showAssist(index, clientX, clientY) {
    const stack = this.game.stacks[index];
    const groups = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const nut = stack[i];
      const label = nut.hidden ? t('assist_hidden') : t(COLOR_NAME_KEY[nut.color]);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.count += 1;
      else groups.push({ label, count: 1, color: nut.hidden ? null : nut.color, hidden: nut.hidden });
    }
    this.assistEl.innerHTML = '';
    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'nb-assist-label';
      empty.textContent = t('empty_bolt');
      this.assistEl.appendChild(empty);
    } else {
      groups.forEach((g, i) => {
        const row = document.createElement('div');
        row.className = 'nb-assist-row';
        const prefix = document.createElement('span');
        prefix.textContent = i === 0 ? t('assist_top') : (i === groups.length - 1 && groups.length > 1 ? t('assist_base') : '');
        const detail = document.createElement('span');
        detail.className = 'nb-assist-detail';
        const swatch = buildNutEl({ color: g.color, hidden: g.hidden });
        swatch.classList.add('nb-assist-swatch');
        const text = document.createElement('span');
        text.textContent = t('assist_count', { label: g.label, count: g.count });
        detail.append(swatch, text);
        row.append(prefix, detail);
        this.assistEl.appendChild(row);
      });
    }
    const rootRect = this.root.getBoundingClientRect();
    this.assistEl.style.left = `${clientX - rootRect.left}px`;
    this.assistEl.style.top = `${clientY - rootRect.top - 20}px`;
    this.assistEl.hidden = false;
  }

  hideAssist() {
    this.assistEl.hidden = true;
  }

  destroy() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.longPressTimer);
    clearTimeout(this._resizeTimer);
    document.removeEventListener('pointerup', this.onDocPointerUp);
    document.removeEventListener('pointermove', this.onDocPointerMove);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.container.innerHTML = '';
  }

  // Autosave/resume built in (root CLAUDE.md's second isInProgress() meaning):
  // returns false even mid-game, because leaving is lossless - the board
  // persists after every move (persist()) and batch 9 now auto-resumes it on
  // mount (see the constructor), so there is nothing to abandon by navigating
  // back to the hub.
  isInProgress() {
    return false;
  }
}

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new NutsBoltsUI(container);
  return instance;
}

export function destroy() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export function isInProgress() {
  return instance ? instance.isInProgress() : false;
}

export default { init, destroy, isInProgress };
