// snake/js/ui.js — Snake's DOM shell: setup screen, canvas render loop, input (swipe + keys),
// pause, game-over modal, stats. The engine (game.js) owns all rules; this file owns the clock.
//
// FIRST GAME BUILT ON THE SHARED i18n LAYER (js/i18n.js) and the reference implementation for it:
// strings live in ./strings.js ({en, es}), every user-visible string goes through t() AT RENDER
// TIME, and a language switch re-renders the current screen via onLangChange (unsubscribed in
// destroy()). See root CLAUDE.md "Adding a game" item 9.
//
// isInProgress(): the LITERAL meaning (no mid-run resume, same class as Connect Four/Ball Run):
// true while a run is live and not over, so the hub confirms before navigating away.

import { Game, COLS, ROWS, TICK_MS, DIFFS } from './game.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordSnake, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.snake.v1';

// The five on-screen D-pad looks (Matt-supplied reference images, 2026-07-23), recolored to the
// LCD theme's own palette rather than their reference colors. 'classic' is the original 2-row
// cross (up alone on top, left/down/right below); the other four are a true 4-way plus shape,
// which is why they need their own grid-template-areas below (see snake.css).
const DPAD_STYLES = [
  { id: 'classic', labelKey: 'dpad_classic' },
  { id: 'circle', labelKey: 'dpad_circle' },
  { id: 'gamepad', labelKey: 'dpad_gamepad' },
  { id: 'solid', labelKey: 'dpad_solid' },
  { id: 'solidArrows', labelKey: 'dpad_solid_arrows' },
];
const DPAD_STYLE_IDS = DPAD_STYLES.map((s) => s.id);
const DEFAULT_DPAD_STYLE = 'classic';

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  catch (err) { console.error('[snake] settings save failed', err); }
}

/** Last-used settings beat profile (skill 1/2/3 -> easy/medium/hard) beat the default. */
function loadSettings() {
  const saved = readJSON(SETTINGS_KEY);
  const dpadStyle = saved && DPAD_STYLE_IDS.includes(saved.dpadStyle) ? saved.dpadStyle : DEFAULT_DPAD_STYLE;
  if (saved && DIFFS.includes(saved.difficulty)) return { difficulty: saved.difficulty, dpadStyle };
  let skillDiff = null;
  try {
    const p = loadProfile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : null;
    skillDiff = skill === 1 ? 'easy' : skill === 3 ? 'hard' : skill === 2 ? 'medium' : null;
  } catch { /* no profile is fine */ }
  return { difficulty: skillDiff || 'medium', dpadStyle };
}

/** The pad's inner cells: `tag` is 'button' for the real, interactive pad, or 'span' for the
 *  decorative preview swatches on the setup screen (a <button> can't nest another <button>). */
function padCellsHTML(tag, withAria) {
  const attr = (dir) => withAria
    ? `data-dir="${dir}" aria-label="${t(`aria_${dir}`)}"` : 'aria-hidden="true"';
  return `
    <${tag} class="sn-padbtn sn-pad-up" ${attr('up')}><span class="sn-pad-glyph">▲</span></${tag}>
    <${tag} class="sn-padbtn sn-pad-left" ${attr('left')}><span class="sn-pad-glyph">◀</span></${tag}>
    <${tag} class="sn-padbtn sn-pad-down" ${attr('down')}><span class="sn-pad-glyph">▼</span></${tag}>
    <${tag} class="sn-padbtn sn-pad-right" ${attr('right')}><span class="sn-pad-glyph">▶</span></${tag}>
    <span class="sn-pad-mid" aria-hidden="true"></span>`;
}

function bestFor(diff) {
  try {
    const sn = (loadStats().games.snake || {}).sn || {};
    return (sn.bestLenByDiff || {})[diff] | 0;
  } catch { return 0; }
}

let instance = null;

class SnakeUI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.game = null;
    this.timer = null;
    this.started = false;        // first steering input starts the clock (classic "ready" state)
    this.paused = false;
    this.recorded = false;
    this._ensureCss();
    this._onKey = (e) => this._handleKey(e);
    this._onVis = () => { if (document.hidden) this._pause(); };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    this._offLang = onLangChange(() => this._rerenderForLang());
    this.renderSetup();
  }

  _ensureCss() {
    const href = new URL('../css/snake.css', import.meta.url).href;
    if (![...document.styleSheets].some((s) => s.href === href) &&
        !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- setup -----------------------------------------------------------------------------------
  renderSetup() {
    this._stopLoop();
    this.game = null;
    this.screen = 'setup';
    const d = this.settings.difficulty;
    const dp = this.settings.dpadStyle;
    const diffBtn = (id, label) => `
      <button type="button" class="sn-seg${d === id ? ' is-on' : ''}" data-diff="${id}"
        aria-pressed="${d === id}">${label}</button>`;
    const dpadOption = (style) => `
      <button type="button" class="sn-dpad-option${dp === style.id ? ' is-on' : ''}" data-dpad="${style.id}"
        aria-pressed="${dp === style.id}" aria-label="${t(style.labelKey)}">
        <span class="sn-dpad-swatch">
          <span class="sn-pad sn-pad--${style.id} sn-pad--mini" aria-hidden="true">${padCellsHTML('span', false)}</span>
        </span>
        <span class="sn-dpad-label">${t(style.labelKey)}</span>
      </button>`;
    this.root.innerHTML = `
      <div class="sn-root">
        <div class="sn-setup">
          <h2 class="sn-title">${t('title')}</h2>
          <p class="sn-tag">${t('tagline')}</p>
          <div class="sn-field">
            <span class="sn-label">${t('difficulty')}</span>
            <div class="sn-segrow" role="group" aria-label="${t('difficulty')}">
              ${diffBtn('easy', t('diff_easy'))}${diffBtn('medium', t('diff_medium'))}${diffBtn('hard', t('diff_hard'))}
            </div>
          </div>
          <div class="sn-field">
            <span class="sn-label">${t('dpad_style')}</span>
            <p class="sn-dpad-hint">${t('dpad_style_hint')}</p>
            <div class="sn-dpad-options" role="group" aria-label="${t('aria_dpad_style_group')}">
              ${DPAD_STYLES.map(dpadOption).join('')}
            </div>
          </div>
          <button type="button" class="sn-play" data-role="play">${t('play')}</button>
          <button type="button" class="sn-howto" data-role="howto">${t('howto')}</button>
        </div>
      </div>`;
    this.root.querySelector('.sn-segrow').addEventListener('click', (e) => {
      const b = e.target.closest('[data-diff]');
      if (!b) return;
      this.settings.difficulty = b.dataset.diff;
      saveSettings(this.settings);
      this.root.querySelectorAll('.sn-seg').forEach((x) =>
        { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    });
    this.root.querySelector('.sn-dpad-options').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dpad]');
      if (!b) return;
      this.settings.dpadStyle = b.dataset.dpad;
      saveSettings(this.settings);
      this.root.querySelectorAll('.sn-dpad-option').forEach((x) =>
        { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    });
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => this.startRun());
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this.openHelp());
  }

  openHelp() {
    // The repo's how-to-play pattern (tic-tac-toe/CLAUDE.md): goal, the one non-obvious mechanic
    // (here: controls + solid walls), a concrete "X = Y" example. Everyone knows Snake; no more.
    const host = document.createElement('div');
    host.className = 'sn-root sn-help-overlay';
    host.innerHTML = `
      <div class="sn-scrim" data-role="close"></div>
      <div class="sn-help" role="dialog" aria-modal="true" aria-label="${t('aria_help')}">
        <button type="button" class="sn-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <p class="sn-help-goal"><strong>${t('help_goal')}</strong></p>
        <svg class="sn-help-art" viewBox="0 0 200 70" aria-hidden="true">
          <rect x="4" y="4" width="192" height="62" rx="6" fill="none" stroke="currentColor" stroke-width="3"/>
          <rect x="30" y="30" width="12" height="12" fill="currentColor"/>
          <rect x="44" y="30" width="12" height="12" fill="currentColor"/>
          <rect x="58" y="30" width="12" height="12" fill="currentColor"/>
          <path d="M 76 36 h 34" stroke="currentColor" stroke-width="3" fill="none"/>
          <path d="M 110 36 q 14 0 14 14 v 4" stroke="currentColor" stroke-width="3" fill="none"/>
          <path d="M 118 48 l 6 9 l 6 -9" fill="currentColor"/>
          <circle cx="160" cy="52" r="7" fill="none" stroke="currentColor" stroke-width="3"/>
        </svg>
        <p class="sn-help-line">${t('help_controls')}</p>
        <p class="sn-help-line">${t('help_walls')}</p>
        <p class="sn-help-ex">${t('help_example')}</p>
      </div>`;
    host.addEventListener('click', (e) => { if (e.target.closest('[data-role="close"]')) host.remove(); });
    document.body.appendChild(host);
  }

  // --- run -------------------------------------------------------------------------------------
  startRun() {
    this.screen = 'game';
    this.game = new Game(this.settings.difficulty);
    this.started = false;
    this.paused = false;
    this.recorded = false;
    this.best = bestFor(this.settings.difficulty);
    this.root.innerHTML = `
      <div class="sn-root">
        <div class="sn-game">
          <div class="sn-hud">
            <span class="sn-hud-cell">${t('score')} <b data-role="score">0</b></span>
            <span class="sn-hud-cell">${t('length')} <b data-role="len">${this.game.length}</b></span>
            <span class="sn-hud-cell">${t('best')} <b data-role="best">${this.best || '—'}</b></span>
          </div>
          <div class="sn-boardwrap" data-role="boardwrap">
            <canvas class="sn-canvas" data-role="canvas" aria-label="${t('aria_board')}"></canvas>
            <div class="sn-overlay" data-role="overlay"><span>${t('tap_to_start')}</span></div>
          </div>
          <div class="sn-pad sn-pad--${this.settings.dpadStyle}" data-role="pad" aria-label="${t('aria_board')}">
            ${padCellsHTML('button', true)}
          </div>
        </div>
      </div>`;
    this.canvas = this.root.querySelector('[data-role="canvas"]');
    this.overlay = this.root.querySelector('[data-role="overlay"]');
    this.pad = this.root.querySelector('[data-role="pad"]');
    this._sizeCanvas();
    this._draw();
    const wrap = this.root.querySelector('[data-role="boardwrap"]');
    let touch = null;
    wrap.addEventListener('touchstart', (e) => {
      const p = e.changedTouches[0];
      touch = { x: p.clientX, y: p.clientY };
      if (this.paused) this._resume();
    }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
      if (!touch) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - touch.x, dy = p.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;        // a tap, not a swipe
      this._steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
    wrap.addEventListener('click', () => { if (this.paused) this._resume(); });
    this.root.querySelector('[data-role="pad"]').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-dir]');
      if (!b) return;
      e.preventDefault();                    // keep focus/scroll side effects off the board
      this._steer(b.dataset.dir);
    });
  }

  _sizeCanvas() {
    const wrap = this.canvas.parentElement;
    const cw = wrap.clientWidth || 320;
    // Height budget: the pad + HUD + margins below the board need ~230px at most (the four
    // true-cross D-pad styles are a row taller than 'classic'); never let the board push the
    // pad off a short viewport. Width stays the cap on ordinary phones.
    const availH = Math.max(200, (window.innerHeight || 640) - wrap.getBoundingClientRect().top - 230);
    this.cell = Math.max(10, Math.min(Math.floor(cw / COLS), Math.floor(availH / ROWS)));
    const w = this.cell * COLS, h = this.cell * ROWS;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._sizePad(w);
  }

  /** Ties the pad's footprint to the board it actually rendered at, instead of a fixed px
   *  value: a static size looked right on an ordinary phone but left the pad tiny and
   *  stranded under an oversized board on a wide/tall window, since it never scaled with it.
   *  'classic' stays a rectangle (width tracks the board, capped); the four true-cross styles
   *  must stay perfectly square, so both width and height are set together. */
  _sizePad(boardWidth) {
    if (!this.pad) return;
    if (this.settings.dpadStyle === 'classic') {
      this.pad.style.width = Math.max(200, Math.min(280, boardWidth)) + 'px';
      this.pad.style.height = '';
    } else {
      const size = Math.max(140, Math.min(200, Math.round(boardWidth * 0.62)));
      this.pad.style.width = size + 'px';
      this.pad.style.height = size + 'px';
    }
  }

  _steer(dir) {
    if (!this.game || this.game.over) return;
    if (this.paused) { this._resume(); return; }
    this.game.setDirection(dir);
    if (!this.started) {
      this.started = true;
      this.overlay.hidden = true;
      this._startLoop();
    }
  }

  _handleKey(e) {
    if (this.screen !== 'game') return;
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    this._steer(dir);
  }

  _startLoop() {
    this._stopLoop();
    this.timer = setInterval(() => this._tick(), TICK_MS[this.settings.difficulty]);
  }
  _stopLoop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  _pause() {
    if (this.screen !== 'game' || !this.started || this.paused || (this.game && this.game.over)) return;
    this.paused = true;
    this._stopLoop();
    if (this.overlay) {
      this.overlay.innerHTML = `<span>${t('paused')}</span><span class="sn-sub">${t('tap_to_resume')}</span>`;
      this.overlay.hidden = false;
    }
  }
  _resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.overlay) this.overlay.hidden = true;
    this._startLoop();
  }

  _tick() {
    const r = this.game.step();
    this._draw();
    if (r.moved || r.over) {
      this.root.querySelector('[data-role="score"]').textContent = this.game.score;
      this.root.querySelector('[data-role="len"]').textContent = this.game.length;
    }
    if (r.over) this._endRun();
  }

  _endRun() {
    this._stopLoop();
    // Record ONCE per run, before showing the modal, so a fast "play again" can't skip it.
    if (!this.recorded) {
      this.recorded = true;
      try { recordSnake(this.game.length, this.settings.difficulty); }
      catch (err) { console.error('[snake] stats record failed — this run is not counted', err); }
    }
    const newBest = this.game.length > this.best;
    const modal = document.createElement('div');
    modal.className = 'sn-modal';
    modal.innerHTML = `
      <div class="sn-modal-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="sn-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <h3 class="sn-modal-h">${this.game.won ? t('you_won') : t('game_over')}</h3>
        <p class="sn-modal-line">${t('final_length', { len: this.game.length })}${newBest ? ` · <b>${t('new_best')}</b>` : ''}</p>
        <div class="sn-modal-actions">
          <button type="button" class="sn-play" data-role="again">${t('play_again')}</button>
          <button type="button" class="sn-howto" data-role="setup">${t('change_setup')}</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="again"]')) { modal.remove(); this.startRun(); }
      else if (e.target.closest('[data-role="setup"]')) { modal.remove(); this.renderSetup(); }
      else if (e.target.closest('[data-role="close"]')) modal.remove();   // X: dismiss, no forced rematch
    });
    this.root.querySelector('.sn-boardwrap').appendChild(modal);
  }

  // --- render ----------------------------------------------------------------------------------
  _draw() {
    const c = this.ctx, cell = this.cell;
    // Classic LCD look: pale green screen, dark "pixel" segments. The snake is SQUARE cells and
    // the food is a hollow CIRCLE — different shapes, so the two never rely on hue alone
    // (colorblind-safe rule, root CLAUDE.md).
    c.fillStyle = '#c9dd9a';
    c.fillRect(0, 0, cell * COLS, cell * ROWS);
    c.fillStyle = '#28340f';
    for (const seg of this.game.body) {
      c.fillRect(seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2);
    }
    const head = this.game.body[0];
    c.fillStyle = '#c9dd9a';   // a pinprick "eye" so the head reads at a glance
    c.fillRect(head.x * cell + Math.floor(cell / 2) - 1, head.y * cell + Math.floor(cell / 2) - 1, 2, 2);
    if (this.game.food) {
      const f = this.game.food;
      c.strokeStyle = '#28340f';
      c.lineWidth = Math.max(2, Math.floor(cell / 5));
      c.beginPath();
      c.arc(f.x * cell + cell / 2, f.y * cell + cell / 2, cell / 2 - 2.5, 0, Math.PI * 2);
      c.stroke();
    }
  }

  _rerenderForLang() {
    // Setup rebuilds wholesale; a live run just relabels its DOM chrome (the canvas has no text).
    if (this.screen === 'setup') { this.renderSetup(); return; }
    if (this.screen === 'game') {
      const cells = this.root.querySelectorAll('.sn-hud-cell');
      if (cells.length === 3) {
        cells[0].firstChild.textContent = t('score') + ' ';
        cells[1].firstChild.textContent = t('length') + ' ';
        cells[2].firstChild.textContent = t('best') + ' ';
      }
      if (this.overlay && !this.overlay.hidden && !this.started) {
        this.overlay.innerHTML = `<span>${t('tap_to_start')}</span>`;
      }
      const pad = this.root.querySelector('[data-role="pad"]');
      if (pad) {
        pad.setAttribute('aria-label', t('aria_board'));
        ['up', 'down', 'left', 'right'].forEach((dir) => {
          const b = pad.querySelector(`[data-dir="${dir}"]`);
          if (b) b.setAttribute('aria-label', t(`aria_${dir}`));
        });
      }
    }
  }

  destroy() {
    this._stopLoop();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._offLang) this._offLang();
    document.querySelectorAll('.sn-help-overlay').forEach((n) => n.remove());
    this.root.innerHTML = '';
    this.game = null;
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new SnakeUI(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
export function isInProgress() {
  return !!(instance && instance.screen === 'game' && instance.started &&
    instance.game && !instance.game.over);
}
export default { init, destroy, isInProgress };
