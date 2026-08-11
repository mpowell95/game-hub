// skeeball/js/ui.js - Skeeball's DOM shell: the machine picker, the canvas alley and its rAF loop,
// the flick input, the marquee, the end card, autosave and stats.
// game.js owns every rule; boards.js owns the machines; render.js owns every pixel; this file owns
// the clock, the input and the screens.
//
// Reworked 2026-08-11 (Matt): no computer opponent. A game is nine balls against three numbers on
// the cabinet head - the app-wide record for that machine, your all-time best, and your best today
// - and the ladder is unlocking machines by hitting a target score. See skeeball/CLAUDE.md.
//
// isInProgress(): the AUTOSAVE/RESUME meaning (root CLAUDE.md, "The module contract"). Skeeball is
// turn-based with no clock, so leaving mid-rack is lossless: every landed throw snapshots and the
// picker offers Resume. Always returns false; do not "fix" it to true mid-game.

import { Game, BALLS_PER_RACK, resolveThrow } from './game.js';
import { BOARDS, DEFAULT_BOARD, boardById, nextBoard } from './boards.js';
import * as R from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordSkeeball, unlockSkeeballBoard, loadStats } from '../../js/game-stats.js';
import { isUnlocked, bestOn, todayBestOn, appWideBest } from '../../js/arcade-scores.js';
import { onViewportResize } from '../../js/viewport.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.skeeball.v1';
const SAVE_KEY = 'gamehub.skeeball.save.v1';

// Flick calibration: full power is a flick up 42% of the canvas height, full aim 30% across.
// Fractions of the canvas, never pixels, so the feel is the same on any phone.
const POWER_SPAN = 0.42;
const AIM_SPAN = 0.30;
const MIN_FLICK = 0.10;

const ROLL_MS = 720;
const BOARD_MS = 260;
const DROP_MS = 200;
const POPUP_MS = 850;

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (err) { console.error('[skeeball] write failed', k, err); }
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** This player's `sk` sub-counter, or an empty one. Never throws. */
function sub() {
  try { return (loadStats().games.skeeball || {}).sk || {}; } catch { return {}; }
}

let instance = null;

class SkeeballUI {
  constructor(container) {
    this.root = container;
    const saved = readJSON(SETTINGS_KEY) || {};
    this.boardId = BOARDS.some((b) => b.id === saved.board) ? saved.board : DEFAULT_BOARD;
    this.game = null;
    this.screen = 'pick';
    this.raf = 0;
    this.flight = null;
    this.popup = null;
    this.pending = null;
    this.drag = null;
    this.recorded = false;
    // The app-wide record per board. Populated only when the leaderboard data is reachable; until
    // then the marquee shows a dash rather than a wrong number (see _loadAppWide).
    this.appWide = {};
    this._ensureCss();

    this._onVis = () => { if (document.hidden) this._save(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._offLang = onLangChange(() => this._rerenderForLang());
    this._offResize = onViewportResize(() => this._fit());

    this._loadAppWide();
    this.renderPicker();
  }

  _ensureCss() {
    const href = new URL('../css/skeeball.css', import.meta.url).href;
    if (![...document.styleSheets].some((s) => s.href === href) &&
        !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  /** Read the app-wide records off the same synced player data the leaderboard uses. Read-only,
   *  best-effort, and deliberately late-bound: the game is fully playable with no network, the
   *  marquee just shows a dash where the record would be. Dynamic import so a device that cannot
   *  reach Firebase never pays for the module at mount. */
  async _loadAppWide() {
    try {
      const [{ watchPlayers }, { aggregatePlayers }] = await Promise.all([
        import('../../js/stats-net.js'),
        import('../../js/players-agg.js'),
      ]);
      // watchPlayers is async and RESOLVES to the unsubscribe - awaiting it is what makes
      // destroy() able to actually detach the listener.
      this._offPlayers = await watchPlayers((all) => {
        try {
          const rows = aggregatePlayers(all || {});
          const next = {};
          for (const b of BOARDS) next[b.id] = appWideBest(rows, 'skeeball', 'sk', b.id);
          this.appWide = next;
          if (this.screen === 'pick') this.renderPicker();
        } catch (err) { console.warn('[skeeball] app-wide records unavailable', err); }
      });
    } catch (err) {
      console.warn('[skeeball] offline: app-wide records not shown', err);
    }
  }

  // --- machine picker -----------------------------------------------------------------------

  renderPicker() {
    this._stopLoop();
    this.screen = 'pick';
    this.game = null;
    const sk = sub();
    const resumable = Game.restore(readJSON(SAVE_KEY));
    const cards = BOARDS.map((b) => {
      const open = isUnlocked(sk, b.id, DEFAULT_BOARD);
      const best = bestOn(sk, b.id);
      const today = todayBestOn(sk, b.id);
      const world = this.appWide[b.id];
      const prev = BOARDS[BOARDS.indexOf(b) - 1];
      return `
        <button type="button" class="sk-card${open ? '' : ' is-locked'}" data-board="${b.id}"
          ${open ? '' : 'aria-disabled="true"'}>
          <span class="sk-card-art" style="--sk-a:${b.palette.field};--sk-b:${b.palette.fieldLit}">
            ${open ? '' : '<span class="sk-lock" aria-hidden="true">🔒</span>'}
          </span>
          <span class="sk-card-body">
            <span class="sk-card-name">${t(b.nameKey)}</span>
            ${open ? `
              <span class="sk-card-line">${t('your_best')} <b>${best || '—'}</b></span>
              <span class="sk-card-line">${t('today')} <b>${today || '—'}</b></span>
              <span class="sk-card-line sk-card-world">${t('world_best')} <b>${world && world.score ? world.score : '—'}</b>${world && world.name ? ` <i>${world.name}</i>` : ''}</span>
            ` : `
              <span class="sk-card-line sk-card-need">${t('unlock_hint', { n: b.unlockScore, board: prev ? t(prev.nameKey) : '' })}</span>
            `}
          </span>
        </button>`;
    }).join('');

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-pick">
          <h2 class="sk-title">${t('title')}</h2>
          <p class="sk-tag">${t('tagline')}</p>
          ${resumable && !resumable.over ? `<button type="button" class="sk-play" data-role="resume">${t('resume')}</button>` : ''}
          <div class="sk-cards">${cards}</div>
          <p class="sk-soon">${t('more_maps')}</p>
          <button type="button" class="sk-howto" data-role="howto">${t('howto')}</button>
        </div>
      </div>`;

    this.root.querySelector('.sk-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-board]');
      if (!b || b.classList.contains('is-locked')) return;
      this.boardId = b.dataset.board;
      writeJSON(SETTINGS_KEY, { board: this.boardId });
      this.startGame();
    });
    const res = this.root.querySelector('[data-role="resume"]');
    if (res) res.addEventListener('click', () => this.startGame(Game.restore(readJSON(SAVE_KEY))));
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this.openHelp());
  }

  openHelp() {
    const host = document.createElement('div');
    host.className = 'sk-root sk-help-overlay';
    host.innerHTML = `
      <div class="sk-scrim" data-role="close"></div>
      <div class="sk-help" role="dialog" aria-modal="true" aria-label="${t('aria_help')}">
        <button type="button" class="sk-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <p class="sk-help-goal"><strong>${t('help_goal')}</strong></p>
        <svg class="sk-help-art" viewBox="0 0 200 96" aria-hidden="true">
          <path d="M28 92 L74 26 h52 l46 66 z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
          <ellipse cx="100" cy="52" rx="46" ry="20" fill="none" stroke="currentColor" stroke-width="4"/>
          <ellipse cx="100" cy="30" rx="13" ry="5" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="100" cy="43" rx="16" ry="6" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="56" cy="27" rx="9" ry="4" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="144" cy="27" rx="9" ry="4" fill="none" stroke="currentColor" stroke-width="3"/>
          <path d="M100 88 v-16" stroke="currentColor" stroke-width="3" stroke-dasharray="5 4"/>
          <path d="M94 78 l6 -8 l6 8" fill="currentColor"/>
        </svg>
        <p class="sk-help-line">${t('help_flick')}</p>
        <p class="sk-help-line">${t('help_rings')}</p>
        <p class="sk-help-line">${t('help_cups')}</p>
        <p class="sk-help-line">${t('help_mult')}</p>
        <p class="sk-help-line">${t('help_unlock')}</p>
      </div>`;
    host.addEventListener('click', (e) => { if (e.target.closest('[data-role="close"]')) host.remove(); });
    document.body.appendChild(host);
  }

  // --- play ------------------------------------------------------------------------------------

  startGame(restored) {
    this.screen = 'game';
    this.game = restored || new Game({ board: this.boardId });
    this.boardId = this.game.board.id;
    this.recorded = false;
    this.flight = null; this.popup = null; this.pending = null; this.drag = null;

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-game" data-role="game">
          <canvas class="sk-canvas" data-role="canvas" aria-label="${t('aria_lane')}"></canvas>
          <p class="sk-hint" data-role="hint">${t('drag_to_throw')}</p>
          <p class="sk-balls" data-role="balls"></p>
        </div>
      </div>`;
    this.gameEl = this.root.querySelector('[data-role="game"]');
    this.canvas = this.root.querySelector('[data-role="canvas"]');
    this.hintEl = this.root.querySelector('[data-role="hint"]');
    this.ctx = this.canvas.getContext('2d');

    this._bindInput();
    this._fit();
    this._paintHud();
    this._startLoop();
    if (this.game.over) this._finish();
  }

  /** Pin the game box to the space actually available, measured rather than assumed.
   *  Collapsed to 0 FIRST so our own overflow cannot corrupt the measurement, and the residual
   *  overflow is then subtracted because the hub's 40px of `.hub-main` padding sits BELOW us and is
   *  invisible to a top-only measurement (VISUAL-PROCESS.md 3c; this game overflowed by exactly
   *  that once). The root never asks for 100dvh for the same reason. */
  _fit() {
    if (!this.gameEl || !this.canvas) return;
    this.gameEl.style.height = '0px';
    const top = this.gameEl.getBoundingClientRect().top;
    let avail = Math.max(280, Math.floor((window.innerHeight || 640) - top - 6));
    this.gameEl.style.height = `${avail}px`;
    const over = document.documentElement.scrollHeight - (window.innerHeight || 640);
    if (over > 0) { avail = Math.max(280, avail - over); this.gameEl.style.height = `${avail}px`; }

    const w = this.gameEl.clientWidth || 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(avail * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${avail}px`;
    this.layout = R.layoutFor(w, avail);
    this.dpr = dpr;
    this._buildMachine();
  }

  /** The machine never changes between throws, so it is painted once per resize into an offscreen
   *  canvas and blitted each frame. Only the ball, badge, popup, queue and marquee numbers move. */
  _buildMachine() {
    const { scale, ox, oy } = this.layout;
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.game ? this.game.board.palette.wall : '#111';
    g.fillRect(0, 0, this.layout.w, this.layout.h);
    g.save(); g.translate(ox, oy); g.scale(scale, scale);
    R.drawMachine(g, this.game.board);
    g.restore();
    this.machine = c;
  }

  _bindInput() {
    const cv = this.canvas;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this._onDown = (e) => {
      if (!this.game || this.game.over || this.flight || this.popup) return;
      const p = pos(e);
      this.drag = { x0: p.x, y0: p.y, power: 0, aim: 0 };
      cv.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!this.drag) return;
      const p = pos(e);
      this.drag.power = clamp((this.drag.y0 - p.y) / (POWER_SPAN * (this.layout.h || 1)), 0, 1);
      this.drag.aim = clamp((p.x - this.drag.x0) / (AIM_SPAN * (this.layout.w || 1)), -1, 1);
    };
    this._onUp = () => {
      if (!this.drag) return;
      const { power, aim } = this.drag;
      this.drag = null;
      if (power < MIN_FLICK) return;
      this._throw(power, aim);
    };
    cv.addEventListener('pointerdown', this._onDown);
    cv.addEventListener('pointermove', this._onMove);
    cv.addEventListener('pointerup', this._onUp);
    cv.addEventListener('pointercancel', this._onUp);
    // Non-passive, bound to the GAME'S ROOT not document: a document-level touchmove turns off
    // compositor scrolling page-wide for as long as this game is mounted (js/CLAUDE.md).
    this._onTouchMove = (e) => { if (this.drag) e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
  }

  /** The engine resolves the score FIRST and the animation is derived from the same numbers, so
   *  what the ball is drawn doing and what the marquee says can never disagree. */
  _throw(power, aim) {
    if (!this.game || this.game.over) return;
    const preview = resolveThrow(power, aim, this.game.board);
    const out = this.game.throwBall(power, aim);
    if (!out) return;
    const short = out.kind === 'short';
    this.flight = {
      aim, out, short,
      vEnd: short ? clamp(preview.energy / 0.28, 0.15, 1) * 0.88 : 1,
      t0: performance.now(),
      rollMs: ROLL_MS - power * 260,
      backMs: short ? 520 : 0,
      boardMs: short ? 0 : BOARD_MS,
      dropMs: short ? 0 : DROP_MS,
    };
    // Hold the points back until the ball LANDS - the engine has them already, but revealing them
    // on release tells the player the answer while the ball is still rolling.
    this.pending = out.scored;
    this.hintEl.hidden = true;
    this._paintHud();
  }

  _ballNow(now) {
    const f = this.flight;
    if (!f) return null;
    const el = now - f.t0;
    const foldU = (v) => {
      let u = f.aim * 1.35 * v;
      while (Math.abs(u) > 1) u = Math.sign(u) * (2 - Math.abs(u));
      return u;
    };
    if (el < f.rollMs) {
      const k = el / f.rollMs;
      const v = f.vEnd * (k * (2 - k) * 0.55 + k * 0.45);
      return { ...R.lanePoint(v, foldU(v)) };
    }
    if (f.short) {
      const k = clamp((el - f.rollMs) / f.backMs, 0, 1);
      const v = f.vEnd * (1 - k) - 0.12 * k;
      return { ...R.lanePoint(Math.max(-0.12, v), foldU(Math.max(0, v))), fading: k > 0.8 ? (k - 0.8) / 0.2 : 0 };
    }
    const from = R.lanePoint(1, foldU(1));
    const to = f.out.target
      ? R.targetPoint(this.game.board, f.out.target)
      : R.boardPoint(f.out.x, Math.min(0.95, f.out.y));
    if (el < f.rollMs + f.boardMs) {
      const k = (el - f.rollMs) / f.boardMs;
      return {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 22,
        r: from.r * (1 - k * 0.42),
      };
    }
    const k = clamp((el - f.rollMs - f.boardMs) / f.dropMs, 0, 1);
    return { x: to.x, y: to.y + k * 8, r: from.r * 0.58 * (1 - k) };
  }

  _flightDone(now) {
    const f = this.flight;
    return !!f && (now - f.t0) >= f.rollMs + f.backMs + f.boardMs + f.dropMs;
  }

  _landed() {
    const out = this.flight.out;
    this.flight = null;
    this.pending = null;
    this.popup = {
      t0: performance.now(),
      target: out.target,
      text: out.kind === 'short' ? t('short')
        : out.kind === 'over' ? t('over')
          : out.kind === 'miss' ? t('miss')
            : `${out.scored}${out.multiplied ? '!' : ''}`,
    };
    this._paintHud();
    this._save();
  }

  _afterPopup() {
    this.popup = null;
    if (this.game.over) { this._finish(); return; }
    this.hintEl.hidden = false;
    this._paintHud();
  }

  _paintHud() {
    if (!this.game || this.screen !== 'game') return;
    const el = this.root.querySelector('[data-role="balls"]');
    if (el) el.textContent = this.game.over ? '' : t('balls_left', { n: this.game.ballsLeft });
  }

  /** The three numbers on the cabinet head, plus the live score. */
  _marqueeRows() {
    const sk = sub();
    const id = this.game.board.id;
    const world = this.appWide[id];
    const shown = this.game.score - (this.pending || 0);
    return [
      { label: t('m_world'), value: world && world.score ? world.score : '—', tone: 'dim' },
      { label: t('m_score'), value: shown, tone: 'lit' },
      { label: t('m_best'), value: Math.max(bestOn(sk, id), todayBestOn(sk, id)) || '—', tone: 'dim' },
    ];
  }

  _startLoop() {
    this._stopLoop();
    const frame = () => { this.raf = requestAnimationFrame(frame); this._draw(); };
    this.raf = requestAnimationFrame(frame);
  }
  _stopLoop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  _draw() {
    if (!this.ctx || !this.machine || !this.game) return;
    const now = performance.now();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.machine, 0, 0);
    const { scale, ox, oy } = this.layout;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.save(); c.translate(ox, oy); c.scale(scale, scale);

    R.drawMarquee(c, this.game.board, this._marqueeRows());
    R.drawQueue(c, this.game.over ? 0 : this.game.ballsLeft - (this.flight ? 1 : 0));
    if (!this.game.over && this.game.multTarget && !this.popup) {
      R.drawMultiplier(c, this.game.board, this.game.multTarget, 0.5 + 0.5 * Math.sin(now / 320));
    }
    if (this.flight) {
      const b = this._ballNow(now);
      if (b) {
        if (b.fading) c.globalAlpha = 1 - b.fading;
        R.drawBall(c, b.x, b.y, b.r);
        c.globalAlpha = 1;
      }
      if (this._flightDone(now)) this._landed();
    }
    if (this.popup) {
      const k = (now - this.popup.t0) / POPUP_MS;
      if (k >= 1) this._afterPopup();
      else R.drawPopup(c, this.game.board, this.popup.target, this.popup.text, k);
    }
    if (this.drag && this.drag.power > 0.02) R.drawAimGuide(c, this.drag.power, this.drag.aim);
    c.restore();
  }

  _save() {
    if (!this.game) return;
    if (this.game.over) { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } return; }
    writeJSON(SAVE_KEY, this.game.snapshot());
  }

  _finish() {
    this._stopLoop();
    this.hintEl.hidden = true;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* a stale save only costs a stale Resume */ }

    const g = this.game;
    const sk = sub();
    const prevBest = bestOn(sk, g.board.id);
    const unlocked = g.unlocks();

    // Record ONCE, before the card shows, so a fast "play again" can never skip it.
    if (!this.recorded) {
      this.recorded = true;
      try {
        recordSkeeball(g.board.id, {
          score: g.score, balls: g.tally.balls, hundreds: g.tally.hundreds,
          fifties: g.tally.fifties, bestThrow: g.tally.bestThrow, at: Date.now(),
        });
        if (unlocked) unlockSkeeballBoard(unlocked.id);
      } catch (err) { console.error('[skeeball] stats record failed - this game is not counted', err); }
    }

    const newBest = g.score > prevBest;
    const nxt = nextBoard(g.board.id);
    const modal = document.createElement('div');
    modal.className = 'sk-modal';
    modal.innerHTML = `
      <div class="sk-modal-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="sk-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <h3 class="sk-modal-h">${t('game_over')}</h3>
        <p class="sk-modal-score">${g.score}</p>
        ${newBest ? `<p class="sk-modal-line"><b>${t('new_best')}</b></p>` : ''}
        ${unlocked ? `<p class="sk-unlocked">${t('unlocked', { board: t(unlocked.nameKey) })}</p>`
          : nxt ? `<p class="sk-modal-line">${t('unlock_progress', { n: nxt.unlockScore, board: t(nxt.nameKey) })}</p>` : ''}
        <div class="sk-modal-actions">
          <button type="button" class="sk-play" data-role="again">${t('play_again')}</button>
          <button type="button" class="sk-howto" data-role="pick">${t('change_machine')}</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="again"]')) { modal.remove(); this.startGame(); }
      else if (e.target.closest('[data-role="pick"]')) { modal.remove(); this.renderPicker(); }
      else if (e.target.closest('[data-role="close"]')) modal.remove();   // X: no forced rematch
    });
    this.gameEl.appendChild(modal);
  }

  _rerenderForLang() {
    if (this.screen === 'pick') { this.renderPicker(); return; }
    const hint = this.root.querySelector('[data-role="hint"]');
    if (hint) hint.textContent = t('drag_to_throw');
    const cv = this.root.querySelector('[data-role="canvas"]');
    if (cv) cv.setAttribute('aria-label', t('aria_lane'));
    this._paintHud();
  }

  destroy() {
    this._stopLoop();
    this._save();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._onDown);
      this.canvas.removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerup', this._onUp);
      this.canvas.removeEventListener('pointercancel', this._onUp);
    }
    if (this._onTouchMove) this.root.removeEventListener('touchmove', this._onTouchMove);
    if (this._offLang) this._offLang();
    if (this._offResize) this._offResize();
    if (this._offPlayers) { try { this._offPlayers(); } catch { /* already gone */ } }
    document.querySelectorAll('.sk-help-overlay').forEach((n) => n.remove());
    this.root.innerHTML = '';
    this.game = null;
    this.machine = null;
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
}
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
/** Autosave/resume meaning: solo play is lossless to leave, so always false. */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
