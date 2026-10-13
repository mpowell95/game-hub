// way-out/js/ui.js - the DOM shell, the canvas board, input, animation, autosave and the module
// contract. The puzzle (sizes, generator, the "is the way out clear" rule) lives in engine.js;
// nothing here decides anything about it.
//
// ARROW MAZE (folder and ids still `way-out` / `wayout`: it shipped as "Way Out", way-out/CLAUDE.md).
// A clone of "Pointers" (Offline Games), from Matt's two screen recordings of 2026-10-11. Two
// screens: SETUP, in the hub's own card style (difficulty, Play level N, How to play), and PLAY, the
// reference's dark board (level, hearts with the hint beside them, progress bar, the board).
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md).
// isInProgress() RETURNS FALSE, DELIBERATELY: the level is written to `gamehub.wayout.save.v1`
// after every tap that changes it (arrows gone, arrows bumped, lives), so leaving is lossless.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the standalone page themes too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { recordWayOut } from '../../js/game-stats.js';
import { woMistakeMs, woHintMs, woFinishScore, woClock } from '../../js/wayout-score.js';
import { TIERS, SAVE_V, GEN_LATEST, buildLevel, occupancy, blockerOf, dirOf, hintArrow, peel } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.wayout.v1';
// ONE save PER TIER (2026-10-11 QA: with one shared slot, playing Easy wiped an unfinished
// Medium level). `gamehub.wayout.saves.v1` = { easy: save|null, ..., migrated: 1 }. The first
// key, `gamehub.wayout.save.v1` (a single save), is read ONCE into its tier's slot and then left
// exactly as it is, never written again and never deleted (THE LAW rule 5).
const OLD_SAVE_KEY = 'gamehub.wayout.save.v1';
const SAVES_KEY = 'gamehub.wayout.saves.v1';
// THE CLOCK (2026-10-13, Matt: "add a timer"), ONE PER TIER, kept apart from the save on purpose:
// the save is cleared by Restart and by Out of lives, and the time must NOT be. A level's clock runs
// from its first open until it is cleared, through every Restart and Try again, so replaying a
// board you have already seen costs the time it took to see it. { <tier>: { level, gen, ms, pen,
// mistakes, hints, partial } }; `partial` = the level was started before the timer existed, so it
// has no honest time and counts as solved only.
const CLOCKS_KEY = 'gamehub.wayout.clocks.v1';
const MAX_LEVEL = 1000000;   // a sane ceiling: corrupt settings once showed "Level 1e+21"
const LIVES = 3;
const TIER_NUM = { easy: 1, medium: 2, hard: 3, expert: 4 };

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// --- persistence ---------------------------------------------------------------------------------

/** `levels[tier]` is the NEXT level to play on that tier. It only ever goes up (Math.max): a
 *  level reached is progress, and progress is never taken back. */
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    const levels = {};
    for (const k of TIERS) {
      const n = v.levels && Number(v.levels[k]);
      levels[k] = Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL ? n : 1;
    }
    return { tier: TIERS.includes(v.tier) ? v.tier : 'easy', levels };
  } catch { return { tier: 'easy', levels: { easy: 1, medium: 1, hard: 1, expert: 1 } }; }
}
function saveSettings(patch) {
  const cur = loadSettings();
  const next = { tier: (patch && patch.tier) || cur.tier, levels: { ...cur.levels } };
  if (patch && patch.levels) {
    for (const k of TIERS) {
      const n = Math.floor(Number(patch.levels[k]) || 0);
      next.levels[k] = Math.min(MAX_LEVEL, Math.max(cur.levels[k], n));
    }
  }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[way-out] settings NOT saved', err); }
  return next;
}

function loadSaves() {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(SAVES_KEY) || '{}') || {}; } catch { map = {}; }
  if (typeof map !== 'object' || Array.isArray(map)) map = {};
  if (!map.migrated) {
    // Carry the single save of the first build forward into its tier's slot, once.
    try {
      const old = JSON.parse(localStorage.getItem(OLD_SAVE_KEY) || 'null');
      if (old && TIERS.includes(old.tier) && !map[old.tier]) map[old.tier] = old;
    } catch { /* a malformed old save is simply not carried */ }
    map.migrated = 1;
    try { localStorage.setItem(SAVES_KEY, JSON.stringify(map)); } catch (err) { console.error('[way-out] save', err); }
  }
  return map;
}

/** A save is trusted only when it is whole and belongs to the level asked for; anything else
 *  reads as "no save" and the level starts fresh (never a crash). */
function readSave(tier, level, nArrows) {
  try {
    const s = loadSaves()[tier];
    if (!s || s.v !== SAVE_V || s.tier !== tier || s.level !== level) return null;
    const ids = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0 && i < nArrows) : []);
    const lives = Number.isInteger(s.lives) && s.lives >= 1 && s.lives <= LIVES ? s.lives : LIVES;
    // `gen`: which board generator this level was played on (none = generator 1, before 2026-10-12).
    const gen = Number.isInteger(s.gen) && s.gen >= 1 && s.gen <= GEN_LATEST ? s.gen : 1;
    return { gone: ids(s.gone), red: ids(s.red), lives, gen };
  } catch { return null; }
}
/** "Continue level N" only when the save holds real progress (QA: an empty or malformed save
 *  used to offer Continue on a fresh board). */
function hasProgress(tier, level) {
  const s = readSave(tier, level, 1e6);
  return !!s && (s.gone.length > 0 || s.red.length > 0 || s.lives < LIVES);
}
function writeSave(o) {
  const map = loadSaves();
  map[o.tier] = { v: SAVE_V, ...o };
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(map)); } catch (err) { console.error('[way-out] save', err); }
}
function loadClock(tier) {
  try {
    const c = (JSON.parse(localStorage.getItem(CLOCKS_KEY) || '{}') || {})[tier];
    if (!c || typeof c !== 'object') return null;
    const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
    return { level: c.level, gen: c.gen, ms: n(c.ms), pen: n(c.pen), mistakes: n(c.mistakes) | 0, hints: n(c.hints) | 0, partial: !!c.partial };
  } catch { return null; }
}
function writeClock(tier, c) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(CLOCKS_KEY) || '{}') || {}; } catch { map = {}; }
  if (typeof map !== 'object' || Array.isArray(map)) map = {};
  map[tier] = c;
  try { localStorage.setItem(CLOCKS_KEY, JSON.stringify(map)); } catch (err) { console.error('[way-out] clock NOT saved', err); }
}
function clearSave(tier) {
  const map = loadSaves();
  map[tier] = null;
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(map)); } catch (err) { console.error('[way-out] save', err); }
}

// --- icons and pictures --------------------------------------------------------------------------

const SVGA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_MENU = `<svg ${SVGA}><path d="M15 5l-7 7l7 7"/></svg>`;
const ICON_RESTART = `<svg ${SVGA}><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M4 4v4.5h4.5"/></svg>`;
const ICON_BULB = `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 28c-3-2.4-4.6-5.6-4.6-9a11.6 11.6 0 0 1 23.2 0c0 3.4-1.6 6.6-4.6 9v4H17z"/><path d="M19 37h10"/><path d="M24 2.5v3M8 9l2.2 2.2M40 9l-2.2 2.2M3.5 19h3M41.5 19h3"/></g></svg>`;
const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21L2.6 11.6A5.6 5.6 0 0 1 12 3.9a5.6 5.6 0 0 1 9.4 7.7z"/></svg>';

/** The setup screen's header tile: a corner of the game's own board, in the game's own colours
 *  (the Sudoku / Minesweeper pattern of a small tinted picture over the title). */
const HERO_SVG = `<svg viewBox="0 0 88 88" aria-hidden="true"><rect width="88" height="88" rx="14" fill="#1f1f2d"/>`
  + `<g fill="none" stroke="#b3b4e0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">`
  + `<path d="M16 72V18H40V30"/><path d="M28 60V40"/><path d="M52 72V56H70V40"/><path d="M40 72H30"/><path d="M58 18H74"/></g>`
  + `<g fill="#b3b4e0"><path d="M40 37l-4.5-7h9z"/><path d="M28 34l-4.5 7h9z"/><path d="M70 33l-4.5 7h9z"/><path d="M24 72l7-4.5v9z"/><path d="M80 18l-7-4.5v9z"/></g>`
  + `<path d="M28 48H62" fill="none" stroke="#3fd6bd" stroke-width="3.2" stroke-linecap="round"/><path d="M70 48l-8-5v10z" fill="#3fd6bd"/></svg>`;

/** A small board for How to play, drawn in SVG from the same geometry as the game. `arrows`:
 *  [{ cells, kind: 'idle' | 'go' | 'red' | 'block' }]. Meaning is carried by shape too (a dashed
 *  way out, a cross on a square for a bump, a ring for a tap), never colour alone. */
function miniBoard(W, H, arrows, extra = '') {
  const P = 30, pad = 15;
  const at = (c) => [pad + (c % W) * P, pad + ((c / W) | 0) * P];
  let dots = '';
  for (let i = 0; i < W * H; i++) { const [x, y] = at(i); dots += `<circle cx="${x}" cy="${y}" r="1.8" class="wo-mini-dot"/>`; }
  let lines = '';
  for (const a of arrows) {
    const pts = a.cells.map(at);
    const [dx, dy] = dirOf(a.cells, W);
    const [hx, hy] = pts[pts.length - 1];
    const d = 'M' + pts.map((p) => p.join(' ')).join('L');
    const head = `M${hx + dx * 3} ${hy + dy * 3}L${hx - dx * 8 - dy * 6} ${hy - dy * 8 + dx * 6}L${hx - dx * 8 + dy * 6} ${hy - dy * 8 - dx * 6}Z`;
    lines += `<g class="wo-mini-${a.kind}"><path d="${d}" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${head}" stroke="none"/></g>`;
  }
  return `<svg class="wo-mini" viewBox="0 0 ${W * P} ${H * P}" aria-hidden="true">${dots}${lines}${extra}</svg>`;
}
const tapRing = (x, y) => `<circle cx="${x}" cy="${y}" r="11" class="wo-mini-tap"/>`;
const bumpMark = (x, y) => `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3" class="wo-mini-bump"/><path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`;
const orderTag = (x, y, n) => `<circle cx="${x}" cy="${y}" r="9" class="wo-mini-num"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="wo-mini-numtxt">${n}</text>`;

function helpPages() {
  // 6 x 4 points. Page 1: a clear arrow is tapped and leaves (dashed way out).
  const W = 6;
  const p1 = miniBoard(W, 4, [
    { cells: [13, 14, 15, 16], kind: 'go' },
    { cells: [0, 6, 7], kind: 'idle' },
    { cells: [5, 4, 10], kind: 'idle' },
    { cells: [19, 20, 21, 22], kind: 'idle' },
  ], `<path d="M${15 + 4 * 30} ${15 + 2 * 30}H${6 * 30}" class="wo-mini-way"/>${tapRing(15 + 2 * 30, 15 + 2 * 30)}`);
  // Page 2: the tapped arrow's way out runs into another arrow: a bump, a life lost.
  const p2 = miniBoard(W, 4, [
    { cells: [12, 13, 14], kind: 'red' },
    { cells: [4, 10, 16, 22], kind: 'block' },
    { cells: [0, 1, 2], kind: 'idle' },
    { cells: [19, 18], kind: 'idle' },
  ], `${bumpMark(15 + 3.5 * 30, 15 + 2 * 30)}`);
  // Page 3: the order. 1 is clear; it was blocking 2; 2 was blocking 3.
  const p3 = miniBoard(W, 4, [
    { cells: [4, 10, 16, 22], kind: 'idle' },
    { cells: [12, 13, 14], kind: 'idle' },
    { cells: [0, 1, 7], kind: 'idle' },
  ], `${orderTag(15 + 4 * 30 + 15, 15 + 3 * 30 - 6, 1)}${orderTag(15, 15 + 2 * 30 - 15, 2)}${orderTag(15, 15 + 15, 3)}`);
  return [{ svg: p1, key: 'how_1' }, { svg: p2, key: 'how_2' }, { svg: p3, key: 'how_3' }];
}

// --- the game ------------------------------------------------------------------------------------

class WayOut {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.screen = 'home';
    this.raf = 0;
    this.anims = [];        // leaving / bumping arrows
    this.parts = [];        // particles and confetti (garnish)
    this.timers = [];
    this.helpPage = 0;
  }

  mount() {
    this.container.innerHTML = '<div class="wo-root"></div>';
    this.root = this.container.querySelector('.wo-root');
    this._onClick = (ev) => this._handleClick(ev);
    this._onKey = (ev) => this._handleKey(ev);
    this.root.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    // The clock stops while the app is in the background (phone locked, another app in front).
    this._onVis = () => { if (document.hidden) this._clockPause(); else this._clockRun(); };
    document.addEventListener('visibilitychange', this._onVis);
    this.offResize = onViewportResize(() => { this._positionRoot(); this._layout(); });
    this.offLang = onLangChange(() => this.render());
    this.render();
  }

  destroy() {
    this._clockPause();
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    document.removeEventListener('keydown', this._onKey);
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
    }
    if (this.canvas && this._onDown) this.canvas.removeEventListener('pointerdown', this._onDown);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.offResize) this.offResize();
    if (this.offLang) this.offLang();
    try { delete window.__woTest; } catch { /* no window */ }
    this.container.innerHTML = '';
  }

  /** Keyboard (QA 2026-10-11): Escape and a Tab trap in popups, arrow keys on the difficulty
   *  radios, and the board itself - arrow keys pick an arrow, Enter or Space sends it. */
  _handleKey(ev) {
    if (!this.root) return;
    const m = this.root.querySelector('.wo-modal');
    if (m && !m.hidden) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        // On Out of lives, Escape is its X: hiding the popup alone left a board nobody could play.
        if (m.querySelector('[data-act="fail-close"]')) this._toSetup(true); else this._closeModal();
      } else if (ev.key === 'Tab') {
        const f = [...m.querySelectorAll('button:not([disabled])')];
        if (!f.length) return;
        const at = f.indexOf(document.activeElement);
        const next = ev.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : (at < 0 || at === f.length - 1 ? 0 : at + 1);
        ev.preventDefault();
        f[next].focus();
      }
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    const seg = ev.target && ev.target.closest && ev.target.closest('.wo-seg');
    if (seg && step && this.root.contains(seg)) {
      ev.preventDefault();
      const k = TIERS[(TIERS.indexOf(this.settings.tier) + step + TIERS.length) % TIERS.length];
      this.settings = saveSettings({ tier: k });
      this.render();
      const now = this.root.querySelector(`.wo-seg[data-tier="${k}"]`);
      if (now) now.focus();
      return;
    }
    if (this.screen === 'play' && this.canvas && document.activeElement === this.canvas) {
      if (step) { ev.preventDefault(); this._kbMove(step); }
      else if ((ev.key === 'Enter' || ev.key === ' ') && this.kbSel >= 0) {
        ev.preventDefault();
        if (!this.won && !this.failed && !this.gone[this.kbSel] && !this.busy[this.kbSel]) {
          const id = this.kbSel;
          this._send(id);
          this._kbMove(1);
          if (this.kbSel === id) this.kbSel = -1;
        }
      }
    }
  }

  /** Move the keyboard selection to the next / previous arrow still on the board. */
  _kbMove(step) {
    const n = this.lvl.arrows.length;
    let id = this.kbSel >= 0 ? this.kbSel : (step > 0 ? -1 : n);
    for (let k = 0; k < n; k++) {
      id = (id + step + n) % n;
      if (!this.gone[id] && !this.busy[id]) { this.kbSel = id; break; }
    }
    if (this.canvas) this.canvas.setAttribute('aria-label', t('board_kb_aria', { n: this._left(), i: this.kbSel + 1 }));
    this._kick();
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers = this.timers.filter((x) => x !== id); fn(); }, ms);
    this.timers.push(id);
  }

  /** Same technique as murdoku/js/ui.js: a fixed root measured against the mount point, and in the
   *  hub's immersive mode the top bar shares a row with the hub's floating back button. */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      // Immersive: edge to edge, like the reference (the hub's content column has side gutters).
      this.root.classList.add('is-immersive');
      this.root.style.left = '0px';
      this.root.style.width = (document.documentElement.clientWidth || window.innerWidth || 0) + 'px';
      this.root.style.top = '0px';
      this.root.style.height = Math.max(200, Math.round(vh)) + 'px';
      this.root.style.setProperty('--wo-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--wo-inset', Math.max(0, Math.round(b.right + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.round(r.top) + 'px';
    this.root.style.height = Math.max(200, Math.round(vh - r.top)) + 'px';
  }

  // --- rendering --------------------------------------------------------------------------------

  render() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.canvas && this._onDown) this.canvas.removeEventListener('pointerdown', this._onDown);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    this.canvas = null;
    const modal = '<div class="gh-overlay wo-modal" hidden></div>';
    this.root.innerHTML = (this.screen === 'play' ? this._playHTML() : this._homeHTML()) + modal;
    this.root.classList.toggle('is-home', this.screen !== 'play');
    this._positionRoot();
    if (this.screen === 'play') {
      this._bindBoard();
      if (this.failed && !this.timers.length) this._showFail();
    } else {
      try { delete window.__woTest; } catch { /* no window */ }
    }
  }

  /** The setup screen, in the hub's own style (the Sudoku / Minesweeper layout and css/ui.css's
   *  .gh-* primitives): picture, title, a Difficulty card whose four buttons each show the level
   *  that tier is on, then Play and How to play. */
  _homeHTML() {
    const tier = this.settings.tier;
    const level = this.settings.levels[tier];
    const resume = hasProgress(tier, level);
    const segs = TIERS.map((k) => `
      <button type="button" class="wo-seg${k === tier ? ' is-selected' : ''}" data-act="tier" data-tier="${k}" role="radio" aria-checked="${k === tier}">
        <span class="wo-seg-top">${diffShapeSVG(TIER_NUM[k])}<b>${t('tier_' + k)}</b></span>
        <span class="wo-seg-sub">${t('level_n', { n: this.settings.levels[k] })}</span>
      </button>`).join('');
    return `
      <div class="wo-home">
        <div class="wo-hero" aria-hidden="true">${HERO_SVG}</div>
        <div class="wo-head">
          <h1>${t('title')}</h1>
          <p>${t('tagline')}</p>
        </div>
        <div class="gh-card wo-menu-card">
          <div class="gh-field">
            <span class="gh-field__label" id="wo-difflabel">${t('diff_label')}</span>
            <div class="wo-segs" role="radiogroup" aria-labelledby="wo-difflabel">${segs}</div>
          </div>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play">${t(resume ? 'continue_level' : 'play_level', { n: level })}</button>
        </div>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="help">${t('how_title')}</button>
      </div>`;
  }

  _playHTML() {
    const tier = this.tier;
    return `
      <div class="wo-game">
        <div class="wo-hud">
          <button type="button" class="wo-iconbtn" data-act="menu" aria-label="${t('menu_aria')}">${ICON_MENU}</button>
          <div class="wo-hud-mid">
            <span class="wo-tierpill">${diffShapeSVG(TIER_NUM[tier])}${t('tier_' + tier)}</span>
            <span class="wo-level">${t('level_n', { n: this.level })}</span>
          </div>
          <button type="button" class="wo-iconbtn wo-restart" data-act="restart" aria-label="${t('restart_aria')}">${ICON_RESTART}</button>
        </div>
        <div class="wo-lifebar">
          <span class="wo-timer" role="timer" aria-label="${t('timer_aria')}">0:00</span>
          <span class="wo-pen" aria-hidden="true"></span>
          <div class="wo-hearts" role="img"></div>
          <button type="button" class="wo-hint" data-act="hint" aria-label="${t('hint_aria')}">${ICON_BULB}</button>
        </div>
        <div class="wo-progress" role="progressbar" aria-valuemin="0"><i></i></div>
        <div class="wo-stage"><canvas class="wo-canvas" tabindex="0" role="application"></canvas></div>
        <div class="wo-banner" aria-live="polite"><span></span></div>
      </div>`;
  }

  // --- home -------------------------------------------------------------------------------------

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !this.root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'tier') {
      if (btn.dataset.tier !== this.settings.tier) { this.settings = saveSettings({ tier: btn.dataset.tier }); this.render(); }   // saved on selection
    } else if (act === 'play') this._startLevel(this.settings.tier, this.settings.levels[this.settings.tier]);
    else if (act === 'help') { this.helpPage = 0; this._openHelp(); }
    else if (act === 'menu') this._toSetup(false);
    else if (act === 'restart') this._restart();
    else if (act === 'hint') this._hint();
    else if (act === 'how-prev') { this.helpPage = Math.max(0, this.helpPage - 1); this._openHelp(); }
    else if (act === 'how-next') { this.helpPage = Math.min(2, this.helpPage + 1); this._openHelp(); }
    else if (act === 'close') this._closeModal();
    else if (act === 'retry') { this._closeModal(); this._restart(); }
    else if (act === 'fail-close') this._toSetup(true);
  }

  /** Back to the setup screen from a level. Cancels the level's timers and frames first: a pending
   *  "next level" (win) or "Out of lives" (loss) must never fire over the setup screen. `dropSave`
   *  after a loss, so the level starts fresh next time. */
  _stopLevel() {
    this._clockPause();
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anims = [];
    this.parts = [];
  }
  _toSetup(dropSave) {
    this._stopLevel();
    if (dropSave && this.tier) clearSave(this.tier);
    this.screen = 'home';
    this.settings = loadSettings();
    this.render();
  }

  _openHelp() {
    const pages = helpPages();
    const p = pages[this.helpPage];
    const last = this.helpPage === pages.length - 1;
    const dots = pages.map((_, i) => `<i class="${i === this.helpPage ? 'is-on' : ''}"></i>`).join('');
    const m = this.root.querySelector('.wo-modal');
    m.innerHTML = `
      <div class="gh-modal wo-dialog" role="dialog" aria-modal="true" aria-labelledby="wo-how-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-how-h">${t('how_title')}</h2>
        <div class="wo-how-pic"><div class="wo-how-hearts">${HEART.repeat(3)}</div>${p.svg}</div>
        <p class="wo-how-txt">${t(p.key)}</p>
        <div class="wo-dots" aria-hidden="true">${dots}</div>
        <div class="wo-how-nav">
          <button type="button" class="gh-btn" data-act="how-prev" ${this.helpPage === 0 ? 'disabled' : ''}>${t('how_prev')}</button>
          <button type="button" class="gh-btn gh-btn--primary" data-act="${last ? 'close' : 'how-next'}">${t(last ? 'got_it' : 'how_next')}</button>
        </div>
      </div>`;
    if (m.hidden) this._opener = document.activeElement;
    m.hidden = false;
    const go = m.querySelector('.gh-btn--primary');
    if (go) go.focus({ preventScroll: true });
  }

  _closeModal() {
    const m = this.root.querySelector('.wo-modal');
    m.hidden = true;
    m.innerHTML = '';
    const back = this._opener;
    this._opener = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  // --- a level ----------------------------------------------------------------------------------

  _startLevel(tier, level) {
    this.tier = tier;
    this.level = level;
    // A level already in progress is rebuilt on the generator it was played on (engine.js,
    // "harder boards"), so its saved arrows still mean the same arrows.
    const pre = readSave(tier, level, 1e6);
    this.gen = pre ? pre.gen : GEN_LATEST;
    this.lvl = buildLevel(tier, level, this.gen);
    const n = this.lvl.arrows.length;
    this.rounds = (peel(this.lvl.cols, this.lvl.rows, this.lvl.arrows) || {}).layers || 1;
    const saved = readSave(tier, level, n);
    this.gone = new Array(n).fill(false);
    this.red = new Array(n).fill(false);
    this.lives = LIVES;
    if (saved) {
      for (const i of saved.gone) this.gone[i] = true;
      for (const i of saved.red) this.red[i] = true;
      this.lives = saved.lives;
    }
    this.busy = new Array(n).fill(false);   // mid-animation: not tappable
    this.occ = occupancy(this.lvl, this.gone);
    this.anims = [];
    this.parts = [];
    this.hintId = -1;
    this.kbSel = -1;
    this.won = false;
    this.failed = false;
    this.wave = null;
    this.geomWas = null;
    // The clock carries on through Restart and Try again on the same level; a new level starts at 0.
    // A level with progress but no clock was started before the timer existed: no honest time.
    const c = loadClock(tier);
    this.clock = c && c.level === level && c.gen === this.gen ? c
      : { level, gen: this.gen, ms: 0, pen: 0, mistakes: 0, hints: 0, partial: !!(saved && (saved.gone.length || saved.red.length || saved.lives < LIVES)) };
    writeClock(tier, this.clock);
    this.screen = 'play';
    this.render();
    this._clockRun();
    // Every arrow already gone: the player left (or the app was closed) while the LAST arrow was
    // still sliding out, so the win was never counted. Count it now instead of showing an empty
    // board with nothing left to tap.
    if (!this._left()) { this.won = true; this._kick(); }
  }

  _restart() {
    if (!this.lvl || this.won) return;
    clearSave(this.tier);
    this._stopLevel();
    this._startLevel(this.tier, this.level);
  }

  _save() {
    if (this.won || this.failed) return;
    const ids = (arr) => arr.reduce((a, v, i) => (v ? (a.push(i), a) : a), []);
    writeSave({ tier: this.tier, level: this.level, gen: this.gen, gone: ids(this.gone), red: ids(this.red), lives: this.lives });
    this._clockStore();
  }

  // --- the clock ------------------------------------------------------------------------------------
  // Runs only while a level is on screen, unfinished, and the app is in front. Shown with penalties
  // already added, so the number on screen is the number that is scored.

  _clockMs() {
    if (!this.clock) return 0;
    return this.clock.ms + (this.clockT0 ? performance.now() - this.clockT0 : 0);
  }
  _clockRun() {
    if (!this.clock || this.clockT0 || this.screen !== 'play' || this.won || this.failed) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.clockT0 = performance.now();
    if (!this.tick) this.tick = setInterval(() => this._paintClock(), 250);
    this._paintClock();
  }
  _clockPause() {
    if (this.tick) { clearInterval(this.tick); this.tick = 0; }
    if (!this.clock || !this.clockT0) return;
    this.clock.ms = this._clockMs();
    this.clockT0 = 0;
    this._clockStore();
  }
  _clockStore() {
    if (!this.clock || !this.tier) return;
    writeClock(this.tier, { ...this.clock, ms: Math.round(this._clockMs()) });
  }
  _paintClock() {
    const el = this.root && this.root.querySelector('.wo-timer');
    if (el && this.clock) el.textContent = woClock(this._clockMs() + this.clock.pen);
  }
  /** Add a time penalty and show it beside the clock ("+20s"). */
  _penalty(ms) {
    if (!this.clock || ms <= 0) return;
    this.clock.pen += ms;
    this._clockStore();
    this._paintClock();
    this._flashPen(`+${Math.round(ms / 1000)}s`, false);
  }
  _flashPen(text, keep) {
    const el = this.root && this.root.querySelector('.wo-pen');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-on', 'is-score');
    void el.offsetWidth;   // restart the animation
    el.classList.add(keep ? 'is-score' : 'is-on');
  }

  _left() { return this.gone.reduce((n, g) => n + (g ? 0 : 1), 0); }

  _paintHud(popHeart) {
    const hearts = this.root.querySelector('.wo-hearts');
    if (hearts) {
      let h = '';
      for (let i = 0; i < LIVES; i++) {
        const full = i < this.lives;
        h += `<span class="wo-heart${full ? '' : ' is-lost'}${popHeart && i === this.lives ? ' is-pop' : ''}">${HEART}</span>`;
      }
      hearts.innerHTML = h;
      hearts.setAttribute('aria-label', t('lives_aria', { n: this.lives }));
    }
    const total = this.lvl.arrows.length, done = total - this._left();
    const bar = this.root.querySelector('.wo-progress');
    if (bar) {
      bar.style.setProperty('--wo-done', String(total ? done / total : 0));
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-label', t('progress_aria', { n: done, total }));
    }
    const restart = this.root.querySelector('.wo-restart');
    if (restart) restart.classList.toggle('is-idle', done === 0 && this.lives === LIVES && !this.red.some(Boolean));
    if (this.canvas) this.canvas.setAttribute('aria-label', t('board_aria', { n: total - done }));
    this._paintClock();
  }

  // --- the board ----------------------------------------------------------------------------------

  _bindBoard() {
    this.canvas = this.root.querySelector('.wo-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._onDown = (ev) => this._tap(ev);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this._paintHud(false);
    // A ResizeObserver as well as onViewportResize: the stage also changes size when the
    // stylesheet lands after the first paint, or a flex settle moves it (docs/BUILDING-A-GAME.md,
    // "The .hub-game height trap"). Without it the first frame could keep a zero-size board.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this._layout());
      this.ro.observe(this.root.querySelector('.wo-stage'));
    }
    this._layout();
    if (this.anims.length || this.parts.length || this.won || this.hintId >= 0) this._kick();
    // Test seam for test-visual.mjs's PLAY probe (the sudoku pattern): read-only state, and where
    // on screen an arrow is, so the probe can tap it through the real input path.
    try {
      window.__woTest = {
        state: () => ({ left: this._left(), lives: this.lives, level: this.level, tier: this.tier }),
        clearId: () => hintArrow(this.lvl, this.gone, null, this.busy),
        blockedId: () => this.lvl.arrows.findIndex((c, id) => !this.gone[id] && blockerOf(c, this.occ, this.lvl.cols, this.lvl.rows, id)),
        pointOf: (id) => {
          const p = this.pts[id], r = this.canvas.getBoundingClientRect();
          return { x: r.left + (p[0].x + p[1].x) / 2, y: r.top + (p[0].y + p[1].y) / 2 };
        },
      };
    } catch { /* no window */ }
  }

  /** Size the canvas to its stage and work out the point pitch. Measured, every time. */
  _layout() {
    if (this.screen !== 'play' || !this.canvas) return;
    const stage = this.root.querySelector('.wo-stage');
    if (!stage || !this.root.isConnected) return;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;   // the ResizeObserver calls again once it has a size
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { cols: W, rows: H } = this.lvl;
    // The reference leaves a margin either side on small boards (the 40px cap) and runs edge to
    // edge on big ones.
    const pitch = Math.min((r.width - 10) / W, (r.height - 10) / H, 40);
    this.pitch = pitch;
    this.ox = (r.width - W * pitch) / 2 + pitch / 2;
    this.oy = (r.height - H * pitch) / 2 + pitch / 2;
    this.lw = Math.max(1.3, Math.min(3.4, pitch * 0.078));
    this.headL = Math.max(4.5, Math.min(11, pitch * 0.27));
    // Only a real change of geometry counts (a ResizeObserver also calls once on observe).
    const geom = `${pitch}|${this.ox}|${this.oy}`, moved = this.geomWas && this.geomWas !== geom;
    this.geomWas = geom;
    this.pts = this.lvl.arrows.map((cells) => cells.map((c) => this._xy(c)));
    if (moved && this.anims.length) {
      for (const a of this.anims) {
        if (a.kind === 'bump' && !a.hit) { a.hit = true; this._bumped(a.id); }
        this.busy[a.id] = false;
      }
      this.anims = [];
      this.parts = [];
      this._kick();
    }
    this._fitHud();
    this._draw();
  }

  /** The level title is centred on the screen unless that would put it against the buttons beside
   *  it (a narrow phone, with the hub's back button taking the left of the row). Measured. */
  _fitHud() {
    const mid = this.root.querySelector('.wo-hud-mid');
    const left = this.root.querySelector('.wo-hud [data-act="menu"]');
    const right = this.root.querySelector('.wo-hud .wo-restart');
    if (!mid || !left || !right) return;
    this.root.classList.remove('is-tight');
    const m = mid.getBoundingClientRect();
    const tight = m.left < left.getBoundingClientRect().right + 6 || m.right > right.getBoundingClientRect().left - 6;
    this.root.classList.toggle('is-tight', tight);
  }

  _xy(c) {
    const W = this.lvl.cols;
    return { x: this.ox + (c % W) * this.pitch, y: this.oy + ((c / W) | 0) * this.pitch };
  }

  /** The arrow nearest the finger, if it is near enough. Tap targets on Hard and Expert are
   *  necessarily smaller than 44px (the reference's are too: 20+ points across a phone); nearest
   *  arrow wins, so a tap anywhere close still lands, the dots-boxes approach (way-out/CLAUDE.md). */
  _tap(ev) {
    if (this.won || this.failed || this.screen !== 'play') return;
    if (ev.button !== undefined && ev.button !== 0) return;   // primary button / touch / pen only
    ev.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    let best = -1, bestD = Infinity;
    this.lvl.arrows.forEach((cells, id) => {
      if (this.gone[id] || this.busy[id]) return;
      const p = this.pts[id];
      for (let k = 1; k < p.length; k++) {
        const d = segDist(px, py, p[k - 1], p[k]);
        if (d < bestD) { bestD = d; best = id; }
      }
    });
    if (best < 0 || bestD > Math.max(this.pitch * 0.7, 22)) return;
    this._send(best);
  }

  _send(id) {
    const { cols: W, rows: H } = this.lvl;
    const cells = this.lvl.arrows[id];
    if (this.hintId === id) this.hintId = -1;
    const block = blockerOf(cells, this.occ, W, H, id);
    const p = this.pts[id];
    const len = pathLen(p);
    const [dx, dy] = dirOf(cells, W);
    const head = p[p.length - 1];
    this.busy[id] = true;
    if (!block) {
      // Out it goes: off the board at once (so the next tap already sees the way clear), then the
      // animation carries it off the screen.
      this.gone[id] = true;
      for (const c of cells) if (this.occ[c] === id) this.occ[c] = -1;
      const toEdge = dx > 0 ? this.cw - head.x : dx < 0 ? head.x : dy > 0 ? this.ch - head.y : head.y;
      const far = toEdge + len + 30;
      const path = p.concat([{ x: head.x + dx * far, y: head.y + dy * far }]);
      const dur = Math.max(320, Math.min(720, 260 + (far / this.pitch) * 14));
      this.anims.push({ id, kind: 'go', path, len, total: far, t0: performance.now(), dur });
      this._save();
      this._paintHud(false);
      if (!this._left()) this.won = true;
    } else {
      // Bump: forward until the head touches the blocker, back again; red, and a life gone.
      const reach = Math.max(this.pitch * 0.25, block.steps * this.pitch - this.lw * 2 - 1);
      const path = p.concat([{ x: head.x + dx * reach, y: head.y + dy * reach }]);
      this.anims.push({ id, kind: 'bump', path, len, total: reach, t0: performance.now(), dur: 420, hit: false });
    }
    this._kick();
  }

  _hint() {
    if (this.won || this.failed || !this.lvl) return;
    // A hint still pulsing is the same hint: tapping again does not charge again.
    if (this.hintId >= 0 && performance.now() - this.hintT0 < 2600) return;
    const id = hintArrow(this.lvl, this.gone, this.red, this.busy);
    if (id < 0) return;
    this.hintId = id;
    this.hintT0 = performance.now();
    if (this.clock) this.clock.hints += 1;
    this._penalty(woHintMs(this.tier));
    this._kick();
  }

  _kick() {
    if (!this.raf) this.raf = requestAnimationFrame((now) => this._frame(now));
  }

  _frame(now) {
    this.raf = 0;
    const live = [];
    for (const a of this.anims) {
      const u = Math.min(1, (now - a.t0) / a.dur);
      if (a.kind === 'bump') {
        const fwd = 0.4;
        if (u >= fwd && !a.hit) { a.hit = true; this._bumped(a.id); }
        a.s = u < fwd ? a.total * easeOut(u / fwd) : a.total * (1 - easeInOut((u - fwd) / (1 - fwd)));
      } else {
        a.s = a.total * (u * u * 0.55 + u * 0.45);   // gathers speed as it leaves
        if (!reduceMotion() && Math.random() < 0.9) this._spark(a);
      }
      if (u < 1) live.push(a); else this.busy[a.id] = false;
    }
    this.anims = live;
    this.parts = this.parts.filter((q) => now - q.t0 < q.life);
    if (this.won && !this.failed && !this.anims.length && !this.wave) this._celebrate(now);
    this._draw(now);
    const hintOn = this.hintId >= 0 && now - this.hintT0 < 2600;
    if (!hintOn && this.hintId >= 0 && now - this.hintT0 >= 2600) this.hintId = -1;
    const waving = this.wave && now - this.wave.t0 < 1400;
    if (this.anims.length || this.parts.length || hintOn || waving) this._kick();
  }

  _bumped(id) {
    if (this.failed) return;   // a second bump in flight after the last heart: nothing more to lose
    this.red[id] = true;
    this.lives = Math.max(0, this.lives - 1);
    if (this.clock) this.clock.mistakes += 1;
    // The first heart lost costs the tier's base time, the second double (Matt, 2026-10-13). The
    // third ends the attempt; the clock keeps running into the retry, which is its own cost.
    if (this.lives > 0) this._penalty(woMistakeMs(this.tier, LIVES - this.lives));
    this._paintHud(true);
    this._save();
    if (this.lives === 0) {
      this.failed = true;
      this._clockPause();
      clearSave(this.tier);
      this._later(() => this._showFail(), 650);
    }
  }

  _spark(a) {
    const pos = pointAt(a.path, a.s + a.len);
    const hues = ['#2fd3c0', '#2f7fd8', '#33c46e', '#5b4fd6', '#5fe0ff'];
    this.parts.push({
      x: pos.x + (Math.random() - 0.5) * this.pitch * 0.5, y: pos.y + (Math.random() - 0.5) * this.pitch * 0.5,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, r: 1 + Math.random() * Math.max(1.5, this.pitch * 0.09),
      c: hues[(Math.random() * hues.length) | 0], t0: performance.now(), life: 450 + Math.random() * 300,
    });
  }

  _celebrate(now) {
    this.wave = { t0: now };
    const motion = !reduceMotion();
    if (motion) {
      const hues = ['#f5c330', '#e0353f', '#2f7fd8', '#33c46e', '#ff8a2a', '#5fe0ff', '#ffffff'];
      for (let i = 0; i < 70; i++) {
        const ang = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 380;
        this.parts.push({
          x: this.cw / 2, y: this.ch / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 120, g: 520,
          r: 2.5 + Math.random() * 4, c: hues[i % hues.length], t0: now + Math.random() * 120, life: 1300 + Math.random() * 600, conf: true,
          rot: Math.random() * 6,
        });
      }
    }
    // Record once, then move the player on (the level number only ever goes up). The clock stops
    // at the last arrow; the time and the board's size go to the score (js/wayout-score.js).
    this._clockPause();
    const c = this.clock || { ms: 0, pen: 0, mistakes: 0, hints: 0, partial: true };
    const fin = { timeMs: c.ms, penaltyMs: c.pen, arrows: this.lvl.arrows.length, rounds: this.rounds, mistakes: c.mistakes, hints: c.hints, timed: !c.partial };
    try {
      recordWayOut(this.tier, fin);
    } catch (err) {
      console.error('[way-out] recordWayOut failed - the level was NOT recorded', err);
    }
    this._paintClock();
    if (fin.timed) this._flashPen(t('score_n', { n: Math.round(woFinishScore({ t: c.ms + c.pen, a: fin.arrows, r: fin.rounds })) }), true);
    writeClock(this.tier, null);
    this.clock = null;
    clearSave(this.tier);
    this.settings = saveSettings({ levels: { [this.tier]: this.level + 1 } });
    this._later(() => this._banner(), motion ? 650 : 100);
    this._later(() => this._startLevel(this.tier, this.level + 1), motion ? 2300 : 1500);
  }

  _banner() {
    const b = this.root.querySelector('.wo-banner');
    if (!b) return;
    b.querySelector('span').textContent = t('win_' + (1 + ((Math.random() * 5) | 0)));
    b.classList.add('is-on');
  }

  _showFail() {
    const m = this.root.querySelector('.wo-modal');
    if (!m) return;
    m.innerHTML = `
      <div class="gh-modal wo-dialog" role="dialog" aria-modal="true" aria-labelledby="wo-fail-h">
        <button type="button" class="gh-modal__close" data-act="fail-close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="wo-fail-h">${t('fail_title')}</h2>
        <div class="wo-fail-hearts" aria-hidden="true">${HEART.repeat(3)}</div>
        <p class="wo-fail-txt">${t('fail_body')}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="retry">${t('try_again')}</button>
          <button type="button" class="gh-btn gh-btn--block" data-act="fail-close">${t('change_diff')}</button>
        </div>
      </div>`;
    m.hidden = false;
    m.querySelector('.gh-btn--primary').focus({ preventScroll: true });
  }

  // --- drawing ------------------------------------------------------------------------------------

  _draw(now = performance.now()) {
    const ctx = this.ctx;
    if (!ctx || !this.pts) return;
    const css = getComputedStyle(this.root);
    const col = (n, d) => (css.getPropertyValue(n) || '').trim() || d;
    const cDot = col('--wo-dot', '#3a3b55'), cArrow = col('--wo-arrow', '#b3b4e0'), cRed = col('--wo-red', '#d8343f');
    const cGo = col('--wo-go', '#3fd6bd'), cWin = col('--wo-win', '#2bd27a'), cHint = '#ffce3a';
    ctx.clearRect(0, 0, this.cw, this.ch);
    const { cols: W, rows: H } = this.lvl;

    // The dots. On a win they turn green in a wave from the middle (the reference does this).
    const dotR = Math.max(1.1, Math.min(3.2, this.pitch * 0.055));
    const wave = this.wave && !reduceMotion() ? (now - this.wave.t0) / 700 : (this.wave ? 9 : -1);
    for (let i = 0; i < W * H; i++) {
      const p = this._xy(i);
      let r = dotR, c = cDot;
      if (wave >= 0) {
        const d = Math.hypot((i % W) - (W - 1) / 2, ((i / W) | 0) - (H - 1) / 2) / Math.max(W, H);
        if (wave > d * 1.6) { c = cWin; r = dotR * 2.2; }
      }
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const moving = new Map(this.anims.map((a) => [a.id, a]));
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    this.lvl.arrows.forEach((cells, id) => {
      const a = moving.get(id);
      if (this.gone[id] && !a) return;
      const p = a ? a.path : this.pts[id];
      const len = a ? a.len : pathLen(p);
      const s0 = a ? a.s : 0;
      let color = this.red[id] ? cRed : cArrow;
      if (a && a.kind === 'go') color = cGo;
      const hinted = id === this.hintId;
      if (id === this.kbSel && !a && document.activeElement === this.canvas) {
        drawArrow(ctx, p, s0, s0 + len, cHint, this.lw * 3.4, this.headL * 1.4);
      }
      if (hinted) {
        ctx.save();
        ctx.shadowColor = cHint;
        ctx.shadowBlur = 6 + pulse * 10;
        drawArrow(ctx, p, s0, s0 + len, cHint, this.lw * 1.9, this.headL * 1.25);
        ctx.restore();
      } else {
        drawArrow(ctx, p, s0, s0 + len, color, this.lw, this.headL);
      }
    });

    for (const q of this.parts) {
      const age = (now - q.t0) / 1000;
      if (age < 0) continue;
      const k = 1 - age / (q.life / 1000);
      const x = q.x + q.vx * age, y = q.y + q.vy * age + (q.g ? 0.5 * q.g * age * age : 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
      ctx.fillStyle = q.c;
      if (q.conf) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(q.rot + age * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, q.r * 1.6, q.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(x, y, q.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// --- geometry -----------------------------------------------------------------------------------

function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  const u = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / L2));
  return Math.hypot(px - (a.x + u * vx), py - (a.y + u * vy));
}
function pathLen(p) {
  let L = 0;
  for (let k = 1; k < p.length; k++) L += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
  return L;
}
/** The point at arc length `s` along polyline `p` (clamped to its ends), with its direction. */
function pointAt(p, s) {
  let acc = 0;
  for (let k = 1; k < p.length; k++) {
    const L = Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
    if (acc + L >= s || k === p.length - 1) {
      const u = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return { x: p[k - 1].x + (p[k].x - p[k - 1].x) * u, y: p[k - 1].y + (p[k].y - p[k - 1].y) * u,
        dx: L ? (p[k].x - p[k - 1].x) / L : 0, dy: L ? (p[k].y - p[k - 1].y) / L : 0 };
    }
    acc += L;
  }
  return { x: p[0].x, y: p[0].y, dx: 0, dy: 0 };
}
/** Draw the part of polyline `p` between arc lengths s0 and s1, with a filled arrowhead at s1.
 *  The shaft stops short of the tip so its round cap never pokes through the point. */
function drawArrow(ctx, p, s0, s1, color, lw, headL) {
  const tip = pointAt(p, s1);
  const stop = s1 - headL * 0.6;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  let started = false, acc = 0;
  for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const lo = Math.max(s0, acc), hi = Math.min(stop, acc + L);
    if (hi > lo && L) {
      const u0 = (lo - acc) / L, u1 = (hi - acc) / L;
      const x0 = a.x + (b.x - a.x) * u0, y0 = a.y + (b.y - a.y) * u0;
      if (!started) { ctx.moveTo(x0, y0); started = true; }
      ctx.lineTo(a.x + (b.x - a.x) * u1, a.y + (b.y - a.y) * u1);
    }
    acc += L;
  }
  if (started) ctx.stroke();
  const w = headL * 0.62;
  ctx.beginPath();
  ctx.moveTo(tip.x + tip.dx * lw * 0.6, tip.y + tip.dy * lw * 0.6);
  ctx.lineTo(tip.x - tip.dx * headL - tip.dy * w, tip.y - tip.dy * headL + tip.dx * w);
  ctx.lineTo(tip.x - tip.dx * headL + tip.dy * w, tip.y - tip.dy * headL - tip.dx * w);
  ctx.closePath();
  ctx.fill();
}
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// --- module contract ------------------------------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  const href = new URL('../css/way-out.css', import.meta.url).href;
  if (!document.querySelector(`link[data-wo-css]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.woCss = '1';
    document.head.appendChild(link);
  }
  instance = new WayOut(container);
  instance.mount();
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** Always false: every change autosaves (see the header). */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
