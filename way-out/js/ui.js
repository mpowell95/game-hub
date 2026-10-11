// way-out/js/ui.js - the DOM shell, the canvas board, input, animation, autosave and the module
// contract. The puzzle (sizes, generator, the "is the way out clear" rule) lives in engine.js;
// nothing here decides anything about it.
//
// A clone of "Pointers" (Offline Games), from Matt's two screen recordings of 2026-10-11 (way-out/
// CLAUDE.md). Two screens, as there: HOME (difficulty face, slider, Play "Level N", ?) and PLAY
// (level, three hearts, progress bar, the board, a hint bulb).
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md).
// isInProgress() RETURNS FALSE, DELIBERATELY: the level is written to `gamehub.wayout.save.v1`
// after every tap that changes it (arrows gone, arrows bumped, lives), so leaving is lossless.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the standalone page themes too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { recordResult } from '../../js/game-stats.js';
import { TIERS, SAVE_V, buildLevel, occupancy, blockerOf, dirOf, hintArrow } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.wayout.v1';
const SAVE_KEY = 'gamehub.wayout.save.v1';
const STATS_ID = 'wayout';
const LIVES = 3;
const TIER_NUM = { easy: 1, medium: 2, hard: 3, expert: 4 };
const TIER_HUE = { easy: '#2bae3a', medium: '#2f7fd8', hard: '#e0353f', expert: '#5b4fd6' };

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
      levels[k] = Number.isInteger(n) && n >= 1 ? n : 1;
    }
    return { tier: TIERS.includes(v.tier) ? v.tier : 'easy', levels };
  } catch { return { tier: 'easy', levels: { easy: 1, medium: 1, hard: 1, expert: 1 } }; }
}
function saveSettings(patch) {
  const cur = loadSettings();
  const next = { tier: (patch && patch.tier) || cur.tier, levels: { ...cur.levels } };
  if (patch && patch.levels) for (const k of TIERS) next.levels[k] = Math.max(cur.levels[k], patch.levels[k] | 0);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[way-out] settings NOT saved', err); }
  return next;
}

/** A save is trusted only when it is whole and belongs to the level asked for; anything else
 *  reads as "no save" and the level starts fresh (never a crash). */
function readSave(tier, level, nArrows) {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== SAVE_V || s.tier !== tier || s.level !== level) return null;
    const ids = (a) => (Array.isArray(a) ? a.filter((i) => Number.isInteger(i) && i >= 0 && i < nArrows) : []);
    const lives = Number.isInteger(s.lives) && s.lives >= 1 && s.lives <= LIVES ? s.lives : LIVES;
    return { gone: ids(s.gone), red: ids(s.red), lives };
  } catch { return null; }
}
function writeSave(o) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_V, ...o })); } catch (err) { console.error('[way-out] save', err); }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// --- icons and pictures --------------------------------------------------------------------------

const SVGA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_MENU = `<svg ${SVGA}><path d="M15 5l-7 7l7 7"/></svg>`;
const ICON_RESTART = `<svg ${SVGA}><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M4 4v4.5h4.5"/></svg>`;
const ICON_PREV = `<svg ${SVGA}><path d="M6 5v14"/><path d="M19 12H10"/><path d="M13 8l-4 4l4 4"/></svg>`;
const ICON_NEXT = `<svg ${SVGA}><path d="M18 5v14"/><path d="M5 12h9"/><path d="M11 8l4 4l-4 4"/></svg>`;
const ICON_X = `<svg ${SVGA}><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_BULB = `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 28c-3-2.4-4.6-5.6-4.6-9a11.6 11.6 0 0 1 23.2 0c0 3.4-1.6 6.6-4.6 9v4H17z"/><path d="M19 37h10"/><path d="M24 2.5v3M8 9l2.2 2.2M40 9l-2.2 2.2M3.5 19h3M41.5 19h3"/></g></svg>`;
const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21L2.6 11.6A5.6 5.6 0 0 1 12 3.9a5.6 5.6 0 0 1 9.4 7.7z"/></svg>';

/** The difficulty face over the slider (the reference's mascot): one per tier, told apart by
 *  expression and horns as well as colour. */
function faceSVG(tier) {
  const c = TIER_HUE[tier];
  const horns = tier === 'hard' || tier === 'expert'
    ? `<path d="M24 30L14 8L38 22Z M76 30L86 8L62 22Z" fill="${c}"/>` : '';
  const brows = tier === 'hard' || tier === 'expert'
    ? '<path d="M28 38L45 45M72 38L55 45" stroke="#0b0b0e" stroke-width="5" stroke-linecap="round"/>' : '';
  const mouth = {
    easy: '<path d="M38 70q12 10 26 0" stroke="#0b0b0e" stroke-width="5" fill="none" stroke-linecap="round"/>',
    medium: '<path d="M38 70h24" stroke="#0b0b0e" stroke-width="5" stroke-linecap="round"/>',
    hard: '<path d="M38 72q12 -8 24 0" stroke="#0b0b0e" stroke-width="5" fill="none" stroke-linecap="round"/>',
    expert: '<path d="M36 74l7-5l7 5l7-5l7 5" stroke="#0b0b0e" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  }[tier];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${horns}<circle cx="50" cy="54" r="34" fill="${c}"/>`
    + `<circle cx="38" cy="50" r="8" fill="#0b0b0e"/><circle cx="62" cy="50" r="8" fill="#0b0b0e"/>`
    + `<circle cx="40" cy="47.5" r="2.6" fill="#fff"/><circle cx="64" cy="47.5" r="2.6" fill="#fff"/>${brows}${mouth}</svg>`;
}

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
    this._onInput = (ev) => this._handleInput(ev);
    this._onKey = (ev) => { if (ev.key === 'Escape' && !this.root.querySelector('.wo-modal').hidden) this._closeModal(); };
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('input', this._onInput);
    document.addEventListener('keydown', this._onKey);
    this.offResize = onViewportResize(() => { this._positionRoot(); this._layout(); });
    this.offLang = onLangChange(() => this.render());
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    document.removeEventListener('keydown', this._onKey);
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('input', this._onInput);
    }
    if (this.canvas && this._onDown) this.canvas.removeEventListener('pointerdown', this._onDown);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.offResize) this.offResize();
    if (this.offLang) this.offLang();
    try { delete window.__woTest; } catch { /* no window */ }
    this.container.innerHTML = '';
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
    const modal = '<div class="wo-modal" hidden></div>';
    this.root.innerHTML = (this.screen === 'play' ? this._playHTML() : this._homeHTML()) + modal;
    this._positionRoot();
    if (this.screen === 'play') this._bindBoard();
  }

  _homeHTML() {
    const tier = this.settings.tier;
    const idx = TIERS.indexOf(tier);
    const level = this.settings.levels[tier];
    return `
      <div class="wo-home" style="--wo-tier:${TIER_HUE[tier]};--wo-fill:${(idx / 3) * 100}%">
        <div class="wo-hero">
          <h1 class="wo-title">${t('title')}</h1>
          <p class="wo-intro">${t('intro')}</p>
        </div>
        <div class="wo-face">${faceSVG(tier)}</div>
        <div class="wo-tiername">${diffShapeSVG(TIER_NUM[tier])}<span>${t('tier_' + tier)}</span></div>
        <input class="wo-slider" type="range" min="0" max="3" step="1" value="${idx}" aria-label="${t('diff_aria')}" aria-valuetext="${t('tier_' + tier)}">
        <div class="wo-playrow">
          <button type="button" class="wo-playbtn" data-act="play"><b>${t('play')}</b><span>${t('level_n', { n: level })}</span></button>
          <button type="button" class="wo-helpbtn" data-act="help" aria-label="${t('help_aria')}">?</button>
        </div>
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
        <div class="wo-hearts" role="img"></div>
        <div class="wo-progress" role="progressbar" aria-valuemin="0"><i></i></div>
        <div class="wo-stage"><canvas class="wo-canvas" role="img"></canvas></div>
        <div class="wo-foot">
          <button type="button" class="wo-hint" data-act="hint" aria-label="${t('hint_aria')}">${ICON_BULB}</button>
        </div>
        <div class="wo-banner" aria-live="polite"><span></span></div>
      </div>`;
  }

  // --- home -------------------------------------------------------------------------------------

  _handleInput(ev) {
    if (!ev.target.classList.contains('wo-slider')) return;
    const tier = TIERS[Math.max(0, Math.min(3, ev.target.value | 0))];
    if (tier === this.settings.tier) return;
    this.settings = saveSettings({ tier });   // saved on selection
    const home = this.root.querySelector('.wo-home');
    home.style.setProperty('--wo-tier', TIER_HUE[tier]);
    home.style.setProperty('--wo-fill', (TIERS.indexOf(tier) / 3) * 100 + '%');
    home.querySelector('.wo-face').innerHTML = faceSVG(tier);
    home.querySelector('.wo-tiername').innerHTML = `${diffShapeSVG(TIER_NUM[tier])}<span>${t('tier_' + tier)}</span>`;
    home.querySelector('.wo-playbtn span').textContent = t('level_n', { n: this.settings.levels[tier] });
    ev.target.setAttribute('aria-valuetext', t('tier_' + tier));
  }

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !this.root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'play') this._startLevel(this.settings.tier, this.settings.levels[this.settings.tier]);
    else if (act === 'help') { this.helpPage = 0; this._openHelp(); }
    else if (act === 'menu') { this.screen = 'home'; this.settings = loadSettings(); this.render(); }
    else if (act === 'restart') this._restart();
    else if (act === 'hint') this._hint();
    else if (act === 'how-prev') { this.helpPage = Math.max(0, this.helpPage - 1); this._openHelp(); }
    else if (act === 'how-next') { this.helpPage = Math.min(2, this.helpPage + 1); this._openHelp(); }
    else if (act === 'close') this._closeModal();
    else if (act === 'retry') { this._closeModal(); this._restart(); }
    else if (act === 'fail-close') { this._closeModal(); this._restart(true); this.screen = 'home'; this.render(); }
  }

  _openHelp() {
    const pages = helpPages();
    const p = pages[this.helpPage];
    const dots = pages.map((_, i) => `<i class="${i === this.helpPage ? 'is-on' : ''}"></i>`).join('');
    const m = this.root.querySelector('.wo-modal');
    m.innerHTML = `
      <div class="wo-card" role="dialog" aria-modal="true" aria-label="${t('how_title')}">
        <h2 class="wo-card-h">${t('how_title')}</h2>
        <div class="wo-how-pic"><div class="wo-how-hearts">${HEART.repeat(3)}</div>${p.svg}</div>
        <p class="wo-how-txt">${t(p.key)}</p>
        <div class="wo-dots" aria-hidden="true">${dots}</div>
        <div class="wo-card-row">
          <button type="button" class="wo-sqbtn" data-act="how-prev" aria-label="${t('how_prev_aria')}" ${this.helpPage === 0 ? 'disabled' : ''}>${ICON_PREV}</button>
          <button type="button" class="wo-okbtn" data-act="close">${t('ok')}</button>
          <button type="button" class="wo-sqbtn" data-act="how-next" aria-label="${t('how_next_aria')}" ${this.helpPage === 2 ? 'disabled' : ''}>${ICON_NEXT}</button>
        </div>
      </div>`;
    m.hidden = false;
    const ok = m.querySelector('.wo-okbtn');
    if (ok) ok.focus({ preventScroll: true });
  }

  _closeModal() {
    const m = this.root.querySelector('.wo-modal');
    m.hidden = true;
    m.innerHTML = '';
  }

  // --- a level ----------------------------------------------------------------------------------

  _startLevel(tier, level) {
    this.tier = tier;
    this.level = level;
    this.lvl = buildLevel(tier, level);
    const n = this.lvl.arrows.length;
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
    this.won = false;
    this.failed = false;
    this.wave = null;
    this.screen = 'play';
    this.render();
  }

  _restart(silent) {
    if (!this.lvl) return;
    clearSave();
    if (silent) return;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this._startLevel(this.tier, this.level);
  }

  _save() {
    if (this.won) return;
    const ids = (arr) => arr.reduce((a, v, i) => (v ? (a.push(i), a) : a), []);
    writeSave({ tier: this.tier, level: this.level, gone: ids(this.gone), red: ids(this.red), lives: this.lives });
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
    // Test seam for test-visual.mjs's PLAY probe (the sudoku pattern): read-only state, and where
    // on screen an arrow is, so the probe can tap it through the real input path.
    try {
      window.__woTest = {
        state: () => ({ left: this._left(), lives: this.lives, level: this.level, tier: this.tier }),
        clearId: () => hintArrow(this.lvl, this.gone.map((g, i) => g || this.busy[i]), null),
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
    this.pts = this.lvl.arrows.map((cells) => cells.map((c) => this._xy(c)));
    this._draw();
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
    const busyGone = this.gone.map((g, i) => g || this.busy[i]);
    const id = hintArrow(this.lvl, busyGone, this.red);
    if (id < 0) return;
    this.hintId = id;
    this.hintT0 = performance.now();
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
    if (this.won && !this.anims.length && !this.wave) this._celebrate(now);
    this._draw(now);
    const hintOn = this.hintId >= 0 && now - this.hintT0 < 2600;
    if (!hintOn && this.hintId >= 0 && now - this.hintT0 >= 2600) this.hintId = -1;
    const waving = this.wave && now - this.wave.t0 < 1400;
    if (this.anims.length || this.parts.length || hintOn || waving) this._kick();
  }

  _bumped(id) {
    this.red[id] = true;
    this.lives = Math.max(0, this.lives - 1);
    this._paintHud(true);
    this._save();
    if (this.lives === 0) {
      this.failed = true;
      clearSave();
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
    // Record once, then move the player on (the level number only ever goes up).
    try {
      recordResult(STATS_ID, this.tier, true);
    } catch (err) {
      console.error('[way-out] recordResult failed - the level was NOT recorded', err);
    }
    clearSave();
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
      <div class="wo-card wo-fail" role="dialog" aria-modal="true" aria-label="${t('fail_title')}">
        <button type="button" class="wo-xbtn" data-act="fail-close" aria-label="${t('close_aria')}">${ICON_X}</button>
        <h2 class="wo-card-h">${t('fail_title')}</h2>
        <div class="wo-fail-hearts">${HEART.repeat(3)}</div>
        <p class="wo-how-txt">${t('fail_body')}</p>
        <div class="wo-card-row"><button type="button" class="wo-okbtn" data-act="retry">${t('try_again')}</button></div>
      </div>`;
    m.hidden = false;
    m.querySelector('.wo-okbtn').focus({ preventScroll: true });
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
