// snake-v2/js/ui.js - Snake restyled onto the shared UI layer (css/ui.css). A hidden preview.
//
// WHAT THIS IS
// ------------
// A devOnly: true copy of Snake whose CHROME is rebuilt on the shared primitives, so the new
// design can be held side by side against the real Snake on a real phone. Precedent for a
// parallel version living beside the original: poolv2/ next to pool/.
//
// WHAT IT SHARES WITH THE REAL SNAKE, AND WHY
// -------------------------------------------
// - THE ENGINE, imported straight from ../../snake/js/game.js. Not copied. game.js is pure (no
//   DOM, no storage, no timers), so importing it means the two builds cannot possibly diverge on
//   rules, and Snake's 49 engine assertions still cover this one.
// - THE DICTIONARY, spread from ../../snake/js/strings.js in ./strings.js (see its header).
// - THE BOARD AND D-PAD CSS. The root element carries BOTH `.sn-root` and `.sv-root`, so
//   snake/css/snake.css still supplies the LCD canvas and all six D-pad looks (62 rules, proven,
//   fiddly, and not what is being reviewed) while snake-v2.css restyles the chrome on top.
//   This is also the point being demonstrated: the shared layer covers CHROME, and a game's own
//   play surface stays its own identity. Snake's board is deliberately pixel-identical here.
//
// STATS: RECORDS, exactly like the real Snake (2026-08-01, Matt's call - the first pass shipped
// with recording off and a visible "runs are not saved" notice, and the notice was the thing he
// wanted gone). A run that silently fails to count is THE LAW rule 1's own failure shape: to a
// player, history no screen shows IS deleted. So with the notice removed, recording has to be on.
// `_endRun()` calls the identical `recordSnake(length, difficulty, walls)` Snake calls, with the
// same values from the same settings object, guarded by the same record-once `this.recorded` flag
// - not a second write path, the same one.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// - DOES NOT WRITE SNAKE'S SETTINGS KEY. It READS `gamehub.snake.v1` so the setup screen opens on
//   your real preferences, and writes its own `gamehub.snakev2.v1`. Changing the difficulty in a
//   preview must not silently change the difficulty in the game you actually play.
// - IS NOT IN sw.js. Left out of ASSETS while under review, same as css/ui.css and ui-kit/.
//
// isInProgress(): the LITERAL meaning, same as the real Snake (no mid-run resume; a live-action
// run cannot meaningfully pause across a hub navigation). True while a run is live and not over.

import { Game, COLS, ROWS, TICK_MS, DIFFS } from '../../snake/js/game.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordSnake, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);

// v2's OWN settings key. Snake's `gamehub.snake.v1` is read for defaults and never written.
const SETTINGS_KEY = 'gamehub.snakev2.v1';
const SNAKE_SETTINGS_KEY = 'gamehub.snake.v1';

const DPAD_STYLES = [
  { id: 'classic', labelKey: 'dpad_classic' },
  { id: 'compass', labelKey: 'dpad_compass' },
  { id: 'circle', labelKey: 'dpad_circle' },
  { id: 'gamepad', labelKey: 'dpad_gamepad' },
  { id: 'solid', labelKey: 'dpad_solid' },
  { id: 'solidArrows', labelKey: 'dpad_solid_arrows' },
];
const DPAD_STYLE_IDS = DPAD_STYLES.map((s) => s.id);
const DEFAULT_DPAD_STYLE = 'compass';

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  catch (err) { console.error('[snake-v2] settings save failed', err); }
}

/** v2's own saved settings beat the real Snake's saved settings, which beat the profile skill,
 *  which beats the default. The extra step versus Snake's own loadSettings() is deliberate: the
 *  preview should open looking like YOUR Snake the very first time, without ever writing back. */
function loadSettings() {
  const mine = readJSON(SETTINGS_KEY);
  const theirs = readJSON(SNAKE_SETTINGS_KEY);
  const src = mine || theirs;
  const dpadStyle = src && DPAD_STYLE_IDS.includes(src.dpadStyle) ? src.dpadStyle : DEFAULT_DPAD_STYLE;
  const walls = src && src.walls === 'off' ? 'off' : 'on';
  if (src && DIFFS.includes(src.difficulty)) return { difficulty: src.difficulty, dpadStyle, walls };
  let skillDiff = null;
  try {
    const p = loadProfile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : null;
    skillDiff = skill === 1 ? 'easy' : skill === 3 ? 'hard' : skill === 2 ? 'medium' : null;
  } catch { /* no profile is fine */ }
  return { difficulty: skillDiff || 'medium', dpadStyle, walls };
}

/** Identical to Snake's, and read-only. Shows your REAL best so the HUD is a fair comparison. */
function bestFor(diff) {
  try {
    const sn = (loadStats().games.snake || {}).sn || {};
    return (sn.bestLenByDiff || {})[diff] | 0;
  } catch { return 0; }
}

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

let instance = null;

class SnakeV2UI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.game = null;
    this.timer = null;
    this.started = false;
    this.paused = false;
    this.recorded = false;
    this._ensureCss();
    this._onKey = (e) => this._handleKey(e);
    this._onVis = () => { if (document.hidden) this._pause(); };
    this._onTouchMove = (e) => {
      if (this.screen === 'game' && this.game && !this.game.over && this.started && !this.paused) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    // Root-scoped, not document-scoped - see the long note on the same guard in snake/js/ui.js. A
    // non-passive touchmove on `document` costs the WHOLE PAGE its compositor-thread scrolling for
    // as long as this game is mounted; the root catches every drag the guard was written for.
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._offLang = onLangChange(() => this._rerenderForLang());
    this.renderSetup();
  }

  // Three stylesheets, injected idempotently in cascade order: the shared layer, then Snake's own
  // (board + D-pad), then this build's chrome overrides last so they win.
  _ensureCss() {
    const add = (rel) => {
      const href = new URL(rel, import.meta.url).href;
      if ([...document.styleSheets].some((s) => s.href === href)) return;
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    add('../../css/ui.css');
    add('../../snake/css/snake.css');
    add('../css/snake-v2.css');
  }

  // --- setup -----------------------------------------------------------------------------------
  renderSetup() {
    this._stopLoop();
    this.game = null;
    this.screen = 'setup';
    const d = this.settings.difficulty;
    const dp = this.settings.dpadStyle;
    const w = this.settings.walls;

    const segItem = (attr, id, cur, label, shape) => `
      <button type="button" class="gh-seg__item" data-${attr}="${id}"
        aria-pressed="${cur === id}">${shape || ''}${label}</button>`;

    const dpadOption = (style) => `
      <button type="button" class="sn-dpad-option${dp === style.id ? ' is-on' : ''}" data-dpad="${style.id}"
        aria-pressed="${dp === style.id}" aria-label="${t(style.labelKey)}">
        <span class="sn-dpad-swatch">
          <span class="sn-pad sn-pad--${style.id} sn-pad--mini" aria-hidden="true">${padCellsHTML('span', false)}</span>
        </span>
        <span class="sn-dpad-label">${t(style.labelKey)}</span>
      </button>`;

    this.root.innerHTML = `
      <div class="sn-root sv-root">
        <div class="sv-setup">
          <header class="sv-head">
            <h2 class="sv-title">${t('title')}</h2>
            <p class="sv-tag">${t('tagline')}</p>
          </header>

          <div class="gh-card sv-field">
            <span class="gh-field__label">${t('difficulty')}</span>
            <div class="gh-seg sv-seg" role="group" aria-label="${t('difficulty')}">
              ${segItem('diff', 'easy', d, t('diff_easy'), diffShapeSVG(tierOf('easy')))}
              ${segItem('diff', 'medium', d, t('diff_medium'), diffShapeSVG(tierOf('medium')))}
              ${segItem('diff', 'hard', d, t('diff_hard'), diffShapeSVG(tierOf('hard')))}
            </div>
          </div>

          <div class="gh-card sv-field">
            <span class="gh-field__label">${t('walls')}</span>
            <div class="gh-seg sv-seg" role="group" aria-label="${t('walls')}">
              ${segItem('walls', 'on', w, t('walls_on'))}
              ${segItem('walls', 'off', w, t('walls_off'))}
            </div>
          </div>

          <div class="gh-card sv-field">
            <span class="gh-field__label">${t('dpad_style')}</span>
            <p class="gh-card__note">${t('dpad_style_hint')}</p>
            <div class="sn-dpad-options" role="group" aria-label="${t('aria_dpad_style_group')}">
              ${DPAD_STYLES.map(dpadOption).join('')}
            </div>
          </div>

          <div class="sv-actions">
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="play">${t('play')}</button>
            <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="howto">${t('howto')}</button>
          </div>
        </div>
      </div>`;

    this.root.querySelectorAll('.sv-seg').forEach((row) => {
      row.addEventListener('click', (e) => {
        const b = e.target.closest('[data-diff], [data-walls]');
        if (!b || !row.contains(b)) return;
        if (b.dataset.diff) this.settings.difficulty = b.dataset.diff;
        else this.settings.walls = b.dataset.walls;
        saveSettings(this.settings);
        row.querySelectorAll('.gh-seg__item').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
      });
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
    const host = document.createElement('div');
    // NOT `sn-root` here, deliberately. snake.css's `.sn-root { display: block }` and
    // css/ui.css's `.gh-overlay { display: grid }` are the same specificity, and snake.css is
    // injected AFTER ui.css, so `block` won and the dialog pinned itself to the top of the
    // viewport with its close (X) underneath the status bar - unreachable on a phone. This
    // overlay uses no `.sn-` class at all, so the fix is simply not to claim that scope.
    host.className = 'sv-root sv-help-overlay gh-overlay';
    host.innerHTML = `
      <div class="gh-modal" role="dialog" aria-modal="true" aria-label="${t('aria_help')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('aria_close')}">&times;</button>
        <h3 class="gh-modal__title">${t('howto')}</h3>
        <p class="sv-help-goal"><strong>${t('help_goal')}</strong></p>
        <svg class="sv-help-art" viewBox="0 0 200 70" aria-hidden="true">
          <rect x="4" y="4" width="192" height="62" rx="6" fill="none" stroke="currentColor" stroke-width="3"/>
          <rect x="30" y="30" width="12" height="12" fill="currentColor"/>
          <rect x="44" y="30" width="12" height="12" fill="currentColor"/>
          <rect x="58" y="30" width="12" height="12" fill="currentColor"/>
          <path d="M 76 36 h 34" stroke="currentColor" stroke-width="3" fill="none"/>
          <path d="M 110 36 q 14 0 14 14 v 4" stroke="currentColor" stroke-width="3" fill="none"/>
          <path d="M 118 48 l 6 9 l 6 -9" fill="currentColor"/>
          <circle cx="160" cy="52" r="7" fill="none" stroke="currentColor" stroke-width="3"/>
        </svg>
        <p class="gh-card__note">${t('help_controls')}</p>
        <p class="gh-card__note">${t('help_walls')}</p>
      </div>`;
    host.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="close"]') || e.target === host) host.remove();
    });
    document.body.appendChild(host);
  }

  // --- run -------------------------------------------------------------------------------------
  startRun() {
    this.screen = 'game';
    this.game = new Game(this.settings.difficulty, Math.random, this.settings.walls === 'off');
    this.started = false;
    this.paused = false;
    this.best = bestFor(this.settings.difficulty);
    this.root.innerHTML = `
      <div class="sn-root sv-root">
        <div class="sn-game sv-game">
          <div class="sv-hud">
            <span class="gh-chip">${t('score')} <b data-role="score">0</b></span>
            <span class="gh-chip">${t('length')} <b data-role="len">${this.game.length}</b></span>
            <span class="gh-chip">${t('best')} <b data-role="best">${this.best || '—'}</b></span>
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
    this._centerGame();
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
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      this._steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
    wrap.addEventListener('click', () => { if (this.paused) this._resume(); });
    this.pad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-dir]');
      if (!b) return;
      e.preventDefault();
      this._steer(b.dataset.dir);
    });
  }

  // Board sizing is Snake's, unchanged: the two-pass measure exists because the pad's real
  // rendered footprint is the only reliable vertical budget (see snake/CLAUDE.md, UI notes).
  _sizeCanvas() {
    const wrap = this.canvas.parentElement;
    const cw = wrap.clientWidth || 320;
    this._applyBoardSize(Math.max(10, Math.floor(cw / COLS)));
    if (this.pad) {
      const bottomMargin = 16;
      const overflow = this.pad.getBoundingClientRect().bottom - ((window.innerHeight || 640) - bottomMargin);
      if (overflow > 0) {
        const availH = Math.max(200, (this.cell * ROWS) - overflow);
        this._applyBoardSize(Math.max(10, Math.min(this.cell, Math.floor(availH / ROWS))));
      }
    }
  }

  _applyBoardSize(cell) {
    this.cell = cell;
    const w = this.cell * COLS, h = this.cell * ROWS;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._sizePad(w);
  }

  _sizePad(boardWidth) {
    if (!this.pad) return;
    if (this.settings.dpadStyle === 'classic') {
      this.pad.style.width = Math.max(260, Math.min(340, boardWidth)) + 'px';
      this.pad.style.height = '';
    } else {
      const size = Math.max(180, Math.min(260, Math.round(boardWidth * 0.78)));
      this.pad.style.width = size + 'px';
      this.pad.style.height = size + 'px';
    }
  }

  _centerGame() {
    const game = this.root.querySelector('.sn-game');
    if (!game) return;
    game.style.marginTop = '';
    const rect = game.getBoundingClientRect();
    const leftover = (window.innerHeight || 640) - rect.top - rect.height;
    if (leftover > 32) {
      game.style.marginTop = Math.floor(leftover / 2) + 'px';
      if (this.pad && this.pad.getBoundingClientRect().bottom > (window.innerHeight || 640) - 8) {
        game.style.marginTop = '';
      }
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
    // Identical call, values and guard as snake/js/ui.js: this is the same write path, not a
    // second one.
    if (!this.recorded) {
      this.recorded = true;
      try { recordSnake(this.game.length, this.settings.difficulty, this.settings.walls); }
      catch (err) { console.error('[snake-v2] stats record failed - this run is not counted', err); }
    }
    const newBest = this.game.length > this.best;
    const modal = document.createElement('div');
    modal.className = 'gh-overlay sv-modal';
    modal.innerHTML = `
      <div class="gh-modal" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('aria_close')}">&times;</button>
        <h3 class="gh-modal__title">${this.game.won ? t('you_won') : t('game_over')}</h3>
        <p class="sv-modal-line">${t('final_length', { len: this.game.length })}${newBest ? ` · <b>${t('new_best')}</b>` : ''}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary" data-role="again">${t('play_again')}</button>
          <button type="button" class="gh-btn gh-btn--ghost" data-role="setup">${t('change_setup')}</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="again"]')) { modal.remove(); this.startRun(); }
      else if (e.target.closest('[data-role="setup"]')) { modal.remove(); this.renderSetup(); }
      else if (e.target.closest('[data-role="close"]')) modal.remove();
    });
    this.root.querySelector('.sn-boardwrap').appendChild(modal);
  }

  // Byte-identical to Snake's renderer. The board is the one thing this build must NOT restyle:
  // the shared layer covers chrome, and a game's play surface stays its own identity.
  _draw() {
    const c = this.ctx, cell = this.cell;
    c.fillStyle = '#c9dd9a';
    c.fillRect(0, 0, cell * COLS, cell * ROWS);
    c.fillStyle = '#28340f';
    for (const seg of this.game.body) {
      c.fillRect(seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2);
    }
    const head = this.game.body[0];
    c.fillStyle = '#c9dd9a';
    c.fillRect(head.x * cell + Math.floor(cell / 2) - 1, head.y * cell + Math.floor(cell / 2) - 1, 2, 2);
    if (this.game.food) {
      const f = this.game.food;
      c.fillStyle = '#a8462f';
      c.beginPath();
      c.arc(f.x * cell + cell / 2, f.y * cell + cell / 2, cell / 2 - 1.5, 0, Math.PI * 2);
      c.fill();
    }
  }

  _rerenderForLang() {
    if (this.screen === 'setup') { this.renderSetup(); return; }
    if (this.screen === 'game') {
      const chips = this.root.querySelectorAll('.sv-hud .gh-chip');
      if (chips.length === 3) {
        chips[0].firstChild.textContent = t('score') + ' ';
        chips[1].firstChild.textContent = t('length') + ' ';
        chips[2].firstChild.textContent = t('best') + ' ';
      }
      if (this.overlay && !this.overlay.hidden && !this.started) {
        this.overlay.innerHTML = `<span>${t('tap_to_start')}</span>`;
      }
      if (this.pad) {
        this.pad.setAttribute('aria-label', t('aria_board'));
        ['up', 'down', 'left', 'right'].forEach((dir) => {
          const b = this.pad.querySelector(`[data-dir="${dir}"]`);
          if (b) b.setAttribute('aria-label', t(`aria_${dir}`));
        });
      }
    }
  }

  destroy() {
    this._stopLoop();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    this.root.removeEventListener('touchmove', this._onTouchMove);
    if (this._offLang) { this._offLang(); this._offLang = null; }
    document.querySelectorAll('.sv-help-overlay').forEach((n) => n.remove());
    this.root.innerHTML = '';
    this.game = null;
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new SnakeV2UI(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
export function isInProgress() {
  return !!(instance && instance.screen === 'game' && instance.started &&
    instance.game && !instance.game.over);
}
export default { init, destroy, isInProgress };
