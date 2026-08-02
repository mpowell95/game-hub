// ui.js — Pool UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen: Filler's flat/segmented pattern (root CLAUDE.md marks it acceptable
// for a small game, vs. Escoba's fuller accordion) — Pool has only two real
// choices (mode, difficulty). CSS scoping follows Mancala's discipline (every rule
// descendant-scoped under .pl-root). Settings key follows the current convention,
// gamehub.pool.v1.
//
// SEAT MODEL, built in from the start (root CLAUDE.md's explicit ask): every
// "whose turn / did I win / which side is mine" read goes through _localSeat().
// Solo vs. computer is the degenerate case — the human is always seat 0, the
// computer is seat 1 — so nothing here has to be rewritten when a second human
// seat (multiplayer) is introduced, unlike the games that hardcoded "human = seat
// 0" early and paid for it later (see tic-tac-toe/js/ui.js's own note on this).
//
// MULTIPLAYER: two human seats over js/net.js's rooms/<CODE> lockstep protocol,
// same conventions as tic-tac-toe/mancala/filler/dots-boxes. Physics is fully
// deterministic (physics.js's own doc comment), which is what makes lockstep MP
// cheap here: a "move" is just the shot's parameters (aim, power, spin, cue
// elevation, and an optional cue-ball placement); BOTH devices re-run the same
// physics locally and must reach the same settled table. The shooter applies its
// own shot immediately (no round-trip wait to see your own shot), then transmits
// it with the resulting state hash; the peer applies the same params on delivery
// and verifies the hash, exactly like the reference games.
import { R, TABLE, strikeCueBall, tick, isMoving, pocketCenters, POCKET_R, POCKET_R_SIDE } from './physics.js';
import { ballById, HEAD_SPOT } from './table.js';
import * as rules from './rules.js';
import { chooseShot } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// v2 keys (visual rebuild, 2026-07-29): the rules change (standard ball-in-hand,
// pool/CLAUDE.md) makes v1 saves genuinely incompatible. THE LAW rule 5: v1 keys
// (gamehub.pool.v1 / .save.v1 / .mp.v1) stay on disk untouched, never read, never
// deleted, never repurposed. See HANDOFF-POOL-VISUAL-REBUILD.md §7 "Storage keys".
const SETTINGS_KEY = 'gamehub.pool.v2';
const SAVE_KEY = 'gamehub.pool.save.v2';
const MP_SAVE_KEY = 'gamehub.pool.mp.v2';
const MP_RECOVERY_MAX_ATTEMPTS = 3;

// Every renderer tunable in one place (handoff §9 constraint 7). Stage is fixed
// 1202x744 (2x the 601x372 reference), uniformly scaled to fit the viewport.
// Physics constants are NOT here — they stay in physics.js's own header
// (handoff §6.3): duplicating them here is how the two copies would drift.
const CONFIG = {
  STAGE_W: 1202,
  STAGE_H: 744,
  // Fractions of the stage, from the build spec's tables (8ball-pool-build-spec.md).
  BAR: { x0: 0.008, x1: 0.992, y0: 0.011, y1: 0.156 },
  TRAY: { x0: 0.300, x1: 0.760, y0: 0.194, y1: 0.283 },
  SPIN_BTN: { x0: 0.878, x1: 0.942, y0: 0.188, y1: 0.290 },
  POWER_TRACK: { x0: 0.900, x1: 0.965, y0: 0.312, y1: 0.900 },
  // Rails extend 0.032*stageW beyond the felt L/R and 0.052*stageH above/below
  // (spec §8.1); felt is fx 0.140-0.862, fy0 0.328, forced to exactly 2:1.
  TABLE_BOX: { x0: 0.108, x1: 0.894, y0: 0.276, y1: 0.741 },
  FELT: { x0: 0.140, x1: 0.862, y0: 0.328, y1: 0.689 },
  POCKET_CORNER_MULT: 1.90,
  POCKET_SIDE_MULT: 2.05,
  // Spin selector open state (spec §6.2): ~0.20*stageW square, centered at
  // fy 0.45, anchored to the right side near the closed-state button.
  SPIN_PANEL_SIZE: 0.20,
  SPIN_PANEL_CX: 0.80,
  SPIN_PANEL_CY: 0.45,
};

// Phase-gate: the real table/ball/cue canvas render (spec §8-10) lands in
// Phase 2. Until then the table-wrap is a plain placeholder box so Phase 1 can
// be judged on the HUD/tray/spin-button/power-meter shell alone, per
// POOL-REBUILD-PROMPT.md's phase plan ("No table yet").
const SHOW_TABLE_RENDER = true;

function fracRect(r) {
  return {
    left: r.x0 * CONFIG.STAGE_W,
    top: r.y0 * CONFIG.STAGE_H,
    width: (r.x1 - r.x0) * CONFIG.STAGE_W,
    height: (r.y1 - r.y0) * CONFIG.STAGE_H,
  };
}
function applyRect(el, r) {
  const box = fracRect(r);
  el.style.left = box.left + 'px';
  el.style.top = box.top + 'px';
  el.style.width = box.width + 'px';
  el.style.height = box.height + 'px';
}

const SOLID_NUMBERS = [1, 2, 3, 4, 5, 6, 7];
const STRIPE_NUMBERS = [9, 10, 11, 12, 13, 14, 15];

const BALL_COLOR = {
  1: '#F5D033', 2: '#1F5FA8', 3: '#D0342C', 4: '#6A3FA0', 5: '#E0752D', 6: '#1E7A46', 7: '#7B3F2E',
  9: '#F5D033', 10: '#1F5FA8', 11: '#D0342C', 12: '#6A3FA0', 13: '#E0752D', 14: '#1E7A46', 15: '#7B3F2E',
};
function _stripeGradient(hex) {
  return `linear-gradient(180deg, #f4f4ef 0%, #f4f4ef 22%, ${hex} 22%, ${hex} 78%, #f4f4ef 78%)`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 255 * amt);
  const g = Math.min(255, ((n >> 8) & 255) + 255 * amt);
  const b = Math.min(255, (n & 255) + 255 * amt);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Screenshot state, spec §11 — felt-fraction (u,v) positions, exact. Cue at
 *  194deg (screen space), power 0, spin centered. `pottedBalls` seeds all
 *  three potted-ball readers (tray + both HUD rows) per spec §5's "single
 *  array" rule, even though this is a debug/verification snapshot, not a
 *  live game. */
const SCREENSHOT_STATE = {
  balls: [
    { id: 'cue', u: 0.318, v: 0.288, kind: 'cue', number: null },
    { id: 'b1', u: 0.129, v: 0.567, kind: 'solid', number: 1 },
    { id: 'b2', u: 0.700, v: 0.060, kind: 'solid', number: 2 },
    { id: 'b3', u: 0.309, v: 0.596, kind: 'solid', number: 3 },
    { id: 'b4', u: 0.433, v: 0.413, kind: 'solid', number: 4 },
    { id: 'b5', u: 0.940, v: 0.070, kind: 'solid', number: 5 },
    { id: 'b7', u: 0.624, v: 0.567, kind: 'solid', number: 7 },
    { id: 'b8', u: 0.758, v: 0.361, kind: 'eight', number: 8 },
    { id: 'b9', u: 0.855, v: 0.567, kind: 'stripe', number: 9 },
    { id: 'b12', u: 0.960, v: 0.702, kind: 'stripe', number: 12 },
    { id: 'b13', u: 0.878, v: 0.930, kind: 'stripe', number: 13 },
  ],
  potted: [6, 10, 11, 14, 15],
  cueAngleDeg: 194,
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch { /* ignore */ }
  return { difficulty: 'intermediate' };
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
function clearKey(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

class PoolUI {
  constructor(container) {
    this.root = container;
    this.view = 'setup';         // 'setup' | 'game'
    this.mode = 'ai';             // 'ai' | 'practice' | 'online'
    this.settings = loadSettings();
    this.profile = (() => { try { return loadProfile(); } catch { return null; } })();
    this.game = null;
    this.mp = null;               // set when an online room is joined
    this._raf = null;
    this._lastT = 0;
    this._simResolve = null;
    this._pointers = new Map();
    this._aimAngle = -Math.PI / 2;
    this._power = 0;
    this._aiming = false;
    this._pulling = false;
    this._offset = { a: 0, b: 0 };
    this._elevation = 0;
    this._placingCue = false;
    this._foulMsg = null;
    this._boundResize = () => this._resizeCanvas();
    this._boundVis = () => { if (document.hidden) this._syncNothingSpecial(); };
    this._boundScreenshotKey = (e) => { if (e.shiftKey && (e.key === 'S' || e.key === 's')) this.loadScreenshotState(); };
    document.addEventListener('keydown', this._boundScreenshotKey);
    try { if (new URLSearchParams(location.search).get('debug') === '1') window.__poolDebug = this; } catch { /* never block a normal mount over this */ }
    this._tryAutoResume();
    this.render();
    // Reachable without a keyboard (spec §11's Shift+S alone isn't — Matt
    // reviews on a phone): ?debug=1 auto-loads it once the shell is mounted.
    try {
      if (new URLSearchParams(location.search).get('debug') === '1') this.loadScreenshotState();
    } catch { /* malformed URL: never block a normal mount over this */ }
  }

  /** Spec §11 "screenshot state": loads a fixed felt-fraction ball layout and
   *  cue angle for visual diffing against the reference PNG, bypassing rules.js
   *  entirely (this._screenshotBalls, not this.game.balls — see _drawFrame's
   *  header comment on why Phase 2 keeps the two separate). Susan/Brian-style
   *  hardcoding is spec-sanctioned for this debug path only (handoff §7). */
  loadScreenshotState() {
    if (this.view !== 'game') { this.mode = 'practice'; this.game = rules.newGame(); this._afterNewGame(); }
    this._screenshotBalls = SCREENSHOT_STATE.balls;
    this._screenshotCueAngleDeg = SCREENSHOT_STATE.cueAngleDeg;
    this._paintHud();
    this._drawFrame();
  }

  /** Silent autosave/resume (solo/practice only, never MP — a room rejoin is its
   *  own explicit "Rejoin" button since it needs the network). Matches the
   *  pattern set by mancala/tic-tac-toe: no "resume?" prompt, straight onto the
   *  board; anything malformed is treated as no save, never a crash. */
  _tryAutoResume() {
    const save = readJSON(SAVE_KEY);
    if (!save || !save.game || typeof save.game !== 'object' || !Array.isArray(save.game.balls)) return;
    if (save.game.over) { clearKey(SAVE_KEY); return; }
    this.mode = save.mode === 'practice' ? 'practice' : 'ai';
    if (save.difficulty) this.settings.difficulty = save.difficulty;
    this.game = save.game;
    this.view = 'game';
  }

  // ---- seat model -------------------------------------------------------
  _localSeat() { return this.mp ? this.mp.localSeat : 0; }
  _oppSeat() { return 1 - this._localSeat(); }
  _isMySeat(seat) { return seat === this._localSeat(); }
  _oppName() {
    if (this.mp && this.mp.opp && this.mp.opp.name) return this.mp.opp.name;
    return t('computer');
  }
  _myName() { return (this.profile && this.profile.name) || t('you'); }

  _syncNothingSpecial() { /* placeholder hook, kept for parity with hub visibility checks */ }

  // ---- module contract ---------------------------------------------------
  destroy() {
    this._dead = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    document.removeEventListener('visibilitychange', this._boundVis);
    document.removeEventListener('keydown', this._boundScreenshotKey);
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this.mp && this.mp.code) net.leaveRoom(this.mp.code, this.mp.role).catch(() => {});
    net.disconnect();
    this.root.innerHTML = '';
  }

  isInProgress() {
    // Solo (vs. computer) and practice both autosave/resume — leaving mid-game is
    // lossless, so this returns false for them (root CLAUDE.md's "autosave/resume
    // built in" meaning). MP returns true for as long as a room is joined — an
    // in-progress online match is consequential for the other person, same split
    // as every other MP-capable game in this repo.
    return !!(this.mp && this.mp.code && !this.mp.opponentLeft);
  }

  // ---- stylesheet ---------------------------------------------------------
  _ensureCss() {
    if (document.getElementById('pl-css')) return;
    const link = document.createElement('link');
    link.id = 'pl-css';
    link.rel = 'stylesheet';
    link.href = new URL('../css/pool.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  // ---- render dispatch ------------------------------------------------
  render() {
    this._ensureCss();
    this.root.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'pl-root';
    this.root.appendChild(div);
    this.el = div;
    if (this.view === 'setup') this._renderSetup();
    else this._renderGame();
  }

  _renderSetup() {
    const savedMp = readJSON(MP_SAVE_KEY);
    this.el.innerHTML = `
      <div class="pl-setup">
        <h1 class="pl-title">${t('title')}</h1>
        <p class="pl-tagline">${t('tagline')}</p>
        <div class="pl-row">
          <div class="pl-label">${t('mode')}</div>
          <div class="pl-seg" data-role="mode">
            <button type="button" data-v="ai" class="${this.mode === 'ai' ? 'is-active' : ''}">${t('mode_ai')}</button>
            <button type="button" data-v="practice" class="${this.mode === 'practice' ? 'is-active' : ''}">${t('mode_practice')}</button>
            <button type="button" data-v="online" class="${this.mode === 'online' ? 'is-active' : ''}">${t('mode_online')}</button>
          </div>
        </div>
        <div class="pl-row" data-if="ai" style="${this.mode === 'ai' ? '' : 'display:none'}">
          <div class="pl-label">${t('difficulty')}</div>
          <div class="pl-seg" data-role="diff">
            ${['beginner', 'intermediate', 'pro'].map((d) => `<button type="button" data-v="${d}" class="${this.settings.difficulty === d ? 'is-active' : ''}">${t('diff_' + d)}</button>`).join('')}
          </div>
        </div>
        <div class="pl-online" data-if="online" style="${this.mode === 'online' ? '' : 'display:none'}">
          ${savedMp ? `<button type="button" class="pl-btn" data-role="rejoin">${t('rejoin')}</button>` : ''}
          <button type="button" class="pl-btn" data-role="create-room">${t('create_room')}</button>
          <div class="pl-joinrow">
            <input type="text" maxlength="4" placeholder="${t('enter_code')}" data-role="code-input" class="pl-code-input">
            <button type="button" class="pl-btn" data-role="join-room">${t('join_room')}</button>
          </div>
          <div class="pl-mp-status" data-role="mp-status"></div>
        </div>
        <div class="pl-actions">
          <button type="button" class="pl-btn pl-btn-primary" data-role="start" ${this.mode === 'online' ? 'disabled' : ''}>${t('start')}</button>
          <button type="button" class="pl-btn pl-btn-ghost" data-role="howto">${t('howto')}</button>
        </div>
      </div>`;
    this.el.querySelector('[data-role="mode"]').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.mode = b.dataset.v; this._renderSetup();
    });
    const diffRow = this.el.querySelector('[data-role="diff"]');
    if (diffRow) diffRow.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.settings.difficulty = b.dataset.v; saveSettings(this.settings); this._renderSetup();
    });
    this.el.querySelector('[data-role="start"]').addEventListener('click', () => this._startLocalGame());
    this.el.querySelector('[data-role="howto"]').addEventListener('click', () => this._openHelp());
    const createBtn = this.el.querySelector('[data-role="create-room"]');
    if (createBtn) createBtn.addEventListener('click', () => this._mpCreateRoom());
    const joinBtn = this.el.querySelector('[data-role="join-room"]');
    if (joinBtn) joinBtn.addEventListener('click', () => {
      const code = this.el.querySelector('[data-role="code-input"]').value.trim();
      if (code) this._mpJoinRoom(code);
    });
    const rejoinBtn = this.el.querySelector('[data-role="rejoin"]');
    if (rejoinBtn) rejoinBtn.addEventListener('click', () => this._mpRejoin());
  }

  _openHelp() {
    const dlg = document.createElement('div');
    dlg.className = 'pl-dialog-overlay';
    dlg.innerHTML = `
      <div class="pl-dialog">
        <button type="button" class="pl-x" data-role="close" aria-label="${t('cancel')}">✕</button>
        <p><strong>${t('title')}</strong>: 8-ball.</p>
        <p>${t('solids')} vs ${t('stripes')}. ${t('open_table')} until someone legally pockets a group ball.</p>
        <p>${t('place_cue')}</p>
      </div>`;
    dlg.querySelector('[data-role="close"]').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.remove(); });
    this.el.appendChild(dlg);
  }

  _startLocalGame() {
    this.mp = null;
    this.game = rules.newGame();
    this._afterNewGame();
  }

  _afterNewGame() {
    this.view = 'game';
    this._foulMsg = null;
    this.render();
  }

  // ---- persistence (solo/practice autosave; not MP) -----------------------
  _saveProgress() {
    if (this.mode === 'online') return;
    if (!this.game || this.game.over) { clearKey(SAVE_KEY); return; }
    writeJSON(SAVE_KEY, { mode: this.mode, difficulty: this.settings.difficulty, game: this.game });
  }

  // ---- canvas + camera ------------------------------------------------
  _renderGame() {
    // Transient input state from a previous game (or a quit mid-aim) must never
    // carry into a new one — otherwise a stale dashed aim line/cue stick shows
    // before the player has touched anything on the fresh table.
    this._aiming = false;
    this._pulling = false;
    this._power = 0;
    this._offset = { a: 0, b: 0 };
    this._placingCue = false;
    this._quitArmed = false;
    this._foulMsg = null;
    this._screenshotBalls = null;
    this._screenshotCueAngleDeg = null;
    this.el.innerHTML = `
      <div class="pl-game">
        <div class="pl-stage-outer" data-role="stage-outer">
          <div class="pl-stage" data-role="stage">
            <div class="pl-bar" data-role="bar">
              <div class="pl-player pl-player--p1">
                <div class="pl-namecol">
                  <div class="pl-plate" data-role="p1-name"></div>
                  <div class="pl-ballrow" data-role="p1-balls"></div>
                </div>
                <div class="pl-avatar" data-role="p1-avatar"></div>
              </div>
              <div class="pl-player pl-player--p2">
                <div class="pl-avatar" data-role="p2-avatar"></div>
                <div class="pl-namecol">
                  <div class="pl-plate" data-role="p2-name"></div>
                  <div class="pl-ballrow" data-role="p2-balls"></div>
                </div>
              </div>
              <div class="pl-turn-indicator" data-role="turn-indicator"><div class="pl-turn-cue"></div></div>
            </div>
            <div class="pl-tray" data-role="tray">
              <div class="pl-tray-balls" data-role="tray-balls"></div>
            </div>
            <div class="pl-spin-btn" data-role="spin-btn" role="button" tabindex="0" aria-label="${t('spin_aria')}"></div>
            <div class="pl-power-track" data-role="power-track" role="slider" aria-label="${t('power')}">
              <div class="pl-power-fill" data-role="power-fill"></div>
              <div class="pl-power-cue">
                <div class="pl-power-cue-shaft"></div>
                <div class="pl-power-cue-joint"></div>
                <div class="pl-power-cue-butt"><span></span><span></span><span></span><span></span></div>
                <div class="pl-power-cue-bumper"></div>
              </div>
            </div>
            <div class="pl-table-wrap" data-role="table-wrap">
              <canvas data-role="canvas"></canvas>
              <div class="pl-foul-slot" data-role="foul-slot"></div>
            </div>
            <div class="pl-spin-panel" data-role="spin-panel" hidden>
              <div class="pl-spin-backdrop" data-role="spin-backdrop"></div>
              <div class="pl-spin-box" data-role="spin-box">
                <button type="button" class="pl-spin-close" data-role="spin-close" aria-label="${t('cancel')}">&times;</button>
                <div class="pl-spin-ball" data-role="spin-ball">
                  <div class="pl-spin-cross-v"></div>
                  <div class="pl-spin-cross-h"></div>
                  <div class="pl-spin-dot" data-role="spin-dot"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="pl-rotate-overlay" data-role="rotate-overlay">
            <div class="pl-rotate-glyph" aria-hidden="true">📱</div>
            <div>${t('rotate_device')}</div>
          </div>
        </div>
        <div class="pl-dock" data-role="dock">
          <span class="pl-turn-text" data-role="turn-text"></span>
          <span class="pl-quit-confirm" data-role="quit-confirm" hidden>${t('quit_confirm')}</span>
          ${this.mode === 'practice' ? `<button type="button" class="pl-btn" data-role="rerack">${t('new_game')}</button>` : ''}
          <button type="button" class="pl-btn" data-role="quit">${t('quit')}</button>
        </div>
      </div>`;
    this.stageOuter = this.el.querySelector('[data-role="stage-outer"]');
    this.stage = this.el.querySelector('[data-role="stage"]');
    this.canvas = this.el.querySelector('[data-role="canvas"]');
    this.tableWrap = this.el.querySelector('[data-role="table-wrap"]');
    this.ctx = this.canvas.getContext('2d');
    this._layoutStage();
    this.el.querySelector('[data-role="quit"]').addEventListener('click', () => this._confirmQuit());
    const rerack = this.el.querySelector('[data-role="rerack"]');
    if (rerack) rerack.addEventListener('click', () => { this.game = rules.newGame(); this._saveProgress(); this._drawFrame(); this._paintHud(); });
    this._bindSpinButton();
    this._bindSpinPanel();
    this._bindPowerTrack();
    this._bindTablePointer();
    this._offViewport = onViewportResize(this._boundResize);
    document.addEventListener('visibilitychange', this._boundVis);
    // ResizeObserver, not just the window 'resize' event: a flex-layout settle,
    // a font swap, or an orientation change all resize .pl-stage-outer without
    // ever firing 'resize' on window, and the FIRST layout pass after mount is
    // exactly one of those (see _resizeStage's zero-size guard/retry below).
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => { this._resizeStage(); this._resizeCanvas(); });
      this._resizeObserver.observe(this.stageOuter);
    }
    this._resizeStage();
    this._resizeCanvas();
    this._paintHud();
    this._startLoop();
    if (this.game && this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
    this._maybeDriveAiOrMp();
  }

  /** Position every fixed-fraction HUD/tray/spin-button/power-meter/table-box
   *  element on the 1202x744 stage from CONFIG. Layout only — no drawing. */
  _layoutStage() {
    applyRect(this.el.querySelector('[data-role="bar"]'), CONFIG.BAR);
    applyRect(this.el.querySelector('[data-role="tray"]'), CONFIG.TRAY);
    applyRect(this.el.querySelector('[data-role="spin-btn"]'), CONFIG.SPIN_BTN);
    applyRect(this.el.querySelector('[data-role="power-track"]'), CONFIG.POWER_TRACK);
    applyRect(this.tableWrap, CONFIG.TABLE_BOX);
    // Spin panel: backdrop covers the table only (spec §6.2), the box itself
    // is a centered SQUARE anchored near the closed-state button. Sized in real
    // px off STAGE_W alone — deriving it as a fraction of each axis separately
    // made it 240x149 on the 1202x744 stage, i.e. the "cue ball" rendered as a
    // flat ellipse rather than a ball.
    applyRect(this.el.querySelector('[data-role="spin-backdrop"]'), CONFIG.TABLE_BOX);
    const side = CONFIG.SPIN_PANEL_SIZE * CONFIG.STAGE_W;
    const box = this.el.querySelector('[data-role="spin-box"]');
    box.style.width = side + 'px';
    box.style.height = side + 'px';
    box.style.left = (CONFIG.SPIN_PANEL_CX * CONFIG.STAGE_W - side / 2) + 'px';
    box.style.top = (CONFIG.SPIN_PANEL_CY * CONFIG.STAGE_H - side / 2) + 'px';
  }

  /** Landscape-only (handoff §9 constraint 2): scale the fixed 1202x744 stage
   *  to fit whatever box .pl-stage-outer actually has, uniformly, and show the
   *  rotate overlay in portrait. .hub-game sets no explicit height and
   *  immersive mode eats real vertical space (pool/CLAUDE.md's "height trap"
   *  writeup) — never commit a bogus scale from a pre-layout 0-size box; retry
   *  next frame like the original _resizeCanvas fix did. */
  _resizeStage() {
    if (!this.stageOuter || this._dead) return;
    const rect = this.stageOuter.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      // Re-run the CANVAS sizing too once a real box shows up: _resizeCanvas
      // reads this._stageScale for its backing-store resolution, and on the
      // first layout pass that value doesn't exist yet.
      requestAnimationFrame(() => { this._resizeStage(); this._resizeCanvas(); });
      return;
    }
    const portrait = rect.height > rect.width;
    const overlay = this.el.querySelector('[data-role="rotate-overlay"]');
    if (overlay) overlay.classList.toggle('is-shown', portrait);
    const scale = Math.min(rect.width / CONFIG.STAGE_W, rect.height / CONFIG.STAGE_H);
    // translate(-50%,-50%) first (centers the stage's own box on its absolute
    // top:50%/left:50% anchor), then scale — order matters, translate is
    // evaluated in the pre-scale coordinate space so it isn't shrunk by scale.
    this.stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this._stageScale = scale;
  }

  // The v1 "camera" toggle (a cosmetic perspective()/rotateX() tilt on the
  // table box) is GONE, not disabled: it skewed the table into a trapezoid
  // that no longer matched the canvas's own flat top-down geometry, so pockets
  // and balls sat visibly off their drawn positions. It is also not in the
  // spec, and handoff §9 constraint 8 says not to add what the spec doesn't
  // ask for. Removed rather than left as a broken control.

  _resizeCanvas() {
    if (!this.canvas || this._dead) return;
    // NEVER getBoundingClientRect() here. .pl-table-wrap lives inside .pl-stage,
    // which carries `transform: scale(s)`, and getBoundingClientRect() returns
    // the POST-TRANSFORM box. Writing that back as canvas.style.width (a LAYOUT
    // size, inside the already-scaled stage) makes the browser scale it a second
    // time: at s=0.5 the table drew at QUARTER size in the top-left corner with
    // the wrap's own background filling the rest, which is exactly how this
    // shipped and was rightly called unusable. offsetWidth/offsetHeight are
    // layout sizes and are transform-independent, which is what's wanted.
    // (The stage is fixed 1202x744 by design, so these are in fact constant —
    // CONFIG.TABLE_BOX's fractions x STAGE_W/H — but reading them keeps this
    // correct automatically if the CONFIG rect ever changes.)
    const cssW = this.tableWrap.offsetWidth;
    const cssH = this.tableWrap.offsetHeight;
    // The very first layout pass after mount can report a 0 (or near-0) box
    // before the flex chain has settled — committing that produces garbage.
    // Never commit a bogus size; retry next frame until a real one shows up.
    if (cssW < 20 || cssH < 20) {
      requestAnimationFrame(() => this._resizeCanvas());
      return;
    }
    // Backing store also multiplies by the stage's scale, so a stage scaled UP
    // on a big screen still rasterises sharp rather than being a magnified
    // low-res bitmap. Capped so a huge display can't allocate an absurd canvas.
    const stageScale = this._stageScale || 1;
    const dpr = Math.min((window.devicePixelRatio || 1) * stageScale, 3);
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this._dpr = dpr;
    this._cw = cssW; this._ch = cssH;
    if (SHOW_TABLE_RENDER) this._drawFrame();
  }

  /** A pointer event -> canvas LAYOUT coordinates (the same space _toCanvas
   *  and _toWorld speak). getBoundingClientRect() gives the canvas's visual,
   *  post-transform box, and clientX/clientY are visual too — so their
   *  difference is in VISUAL px and must be divided by the stage scale to
   *  become layout px. Skipping that divide is the same class of bug as sizing
   *  the canvas off a transformed rect (see _resizeCanvas): it made aiming
   *  progressively wronger the further the stage was from 1:1 scale, i.e.
   *  on every phone. One helper, so there is one place to get this right. */
  _pointerLocal(e) {
    const rect = this.canvas.getBoundingClientRect();
    const s = this._stageScale || 1;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  }

  // ---- stage <-> physics coordinate mapping (handoff §5: exactly ONE place) --
  // physics.js: origin at table center, table-local METERS, TABLE.w the SHORT
  // axis, TABLE.h the LONG axis, +y toward the foot rail (table.js's FOOT_SPOT).
  // Stage: felt-fraction u (0->1, left->right, the LONG axis on a landscape
  // stage) and v (0->1, top->bottom, the SHORT axis). u tracks physics y (the
  // rack sits at u~0.75, matching FOOT_SPOT.y=+TABLE.h*0.25); v tracks physics
  // x (an arbitrary but fixed left/right choice — table.js's rack rows are
  // symmetric about x=0, so either choice is equally valid, this just has to
  // stay the same everywhere, which is the entire point of having one place).
  _toCanvas(x, y) {
    const u = y / TABLE.h + 0.5, v = x / TABLE.w + 0.5;
    const p = this._uvToLocal(u, v);
    return { cx: p.x, cy: p.y };
  }
  _toWorld(cx, cy) {
    const felt = this._feltLocalRect();
    const u = (cx - felt.x0) / (felt.x1 - felt.x0);
    const v = (cy - felt.y0) / (felt.y1 - felt.y0);
    return { x: (v - 0.5) * TABLE.w, y: (u - 0.5) * TABLE.h };
  }

  // ---- main loop --------------------------------------------------------
  _startLoop() {
    const loop = (now) => {
      if (this._dead) return;
      const dtReal = this._lastT ? Math.min((now - this._lastT) / 1000, 0.05) : 0;
      this._lastT = now;
      if (this._simulating) {
        this._simAccum = (this._simAccum || 0) + dtReal;
        const step = 1 / 240;
        let steps = 0;
        while (this._simAccum >= step && steps < 40) {
          const ev = tick(this.game.balls, step);
          this._simEvents.hits.push(...ev.hits);
          this._simEvents.rails += ev.rails;
          this._simEvents.pocketed.push(...ev.pocketed);
          this._simAccum -= step; steps++;
        }
        if (!isMoving(this.game.balls)) {
          this._simulating = false;
          const events = this._simEvents;
          this._simEvents = null;
          const resolve = this._simResolve; this._simResolve = null;
          if (resolve) resolve(events);
        }
      }
      this._drawFrame();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** Run one shot to rest, animated. Returns a Promise<events>. Shared by
   *  solo, practice, AI and MP so every path uses the identical deterministic
   *  physics loop (root CLAUDE.md / physics.js's determinism guarantee). */
  _runShot(dir, power, offset, elevation) {
    const cue = ballById(this.game.balls, 'cue');
    strikeCueBall(cue, dir, power, offset, elevation);
    this._simulating = true;
    this._simAccum = 0;
    this._simEvents = { hits: [], rails: 0, pocketed: [] };
    return new Promise((resolve) => { this._simResolve = resolve; });
  }

  // ---- drawing --------------------------------------------------------
  // The table renders entirely in FELT-FRACTION space (u,v each 0-1 across the
  // felt, per spec §11) — `_toCanvas`/`_toWorld` below are the ONE place stage
  // coordinates convert to/from physics.js's table-local meters (handoff §5,
  // Phase 3). Screenshot-verification mode bypasses that mapping entirely (its
  // u,v are already felt fractions, straight from the spec's own table).
  _drawFrame() {
    if (!SHOW_TABLE_RENDER) return; // Phase 1 leaves the table-wrap a plain placeholder
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.clearRect(0, 0, this._cw, this._ch);
    this._drawTable(ctx);
    if (this._screenshotBalls) {
      this._drawScreenshotBalls(ctx);
      this._drawScreenshotCue(ctx);
    } else if (this.game) {
      this._drawLiveBalls(ctx);
      if (this._placingCue) this._drawPlacementGhost(ctx);
      else if (this._canShootNow()) this._drawLiveCue(ctx);
    }
    ctx.restore();
    this._paintPowerMeter();
  }

  /** `this.game.balls` (physics.js table-local meters) through the ONE stage
   *  <-> physics mapping (_toCanvas), reusing the same ball renderer the
   *  screenshot-verification path uses (_drawOneBall) — one look, two sources. */
  _drawLiveBalls(ctx) {
    const felt = this._feltLocalRect();
    const rad = this._ballRadiusLocal(felt);
    for (const b of this.game.balls) {
      if (b.pocketed) continue;
      // The cue ball mid-placement is drawn separately as a ghost (see
      // _drawPlacementGhost) — 70% opacity + a legal/illegal ring, per spec
      // §13's ball-in-hand UI, not the normal opaque ball.
      if (this._placingCue && b.id === 'cue') continue;
      const c = this._toCanvas(b.x, b.y);
      this._drawOneBall(ctx, c.cx, c.cy, rad, b.kind, b.number);
    }
  }

  /** Ball-in-hand placement ghost (spec §13): cue ball at 70% opacity with a
   *  ring — white while the pointer's current spot is legal, RED when it
   *  isn't (overlapping a ball, inside a pocket, off the felt, or outside the
   *  head string when this.game.headStringRestricted — see _placementLegal,
   *  spec §13.5's addition to this UI). Illegal drops are refused by
   *  _commitCuePlacement regardless of what's drawn here. */
  _drawPlacementGhost(ctx) {
    const cue = ballById(this.game.balls, 'cue');
    if (!cue) return;
    const felt = this._feltLocalRect();
    const rad = this._ballRadiusLocal(felt);
    const c = this._toCanvas(cue.x, cue.y);
    const legal = this._placementLegal(cue.x, cue.y);
    ctx.save();
    ctx.globalAlpha = 0.7;
    this._drawOneBall(ctx, c.cx, c.cy, rad, 'cue', null);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, rad + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = legal ? '#ffffff' : '#e0392f';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  /** Felt rect, in TABLE-WRAP-LOCAL css-pixel space (this._cw/this._ch), derived
   *  from CONFIG.FELT's position as a FRACTION of CONFIG.TABLE_BOX — scale-
   *  invariant, so it's correct at any stage scale factor without re-deriving. */
  _feltLocalRect() {
    const box = CONFIG.TABLE_BOX, felt = CONFIG.FELT;
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const fx0 = (felt.x0 - box.x0) / bw, fx1 = (felt.x1 - box.x0) / bw;
    const fy0 = (felt.y0 - box.y0) / bh, fy1 = (felt.y1 - box.y0) / bh;
    return {
      x0: fx0 * this._cw, x1: fx1 * this._cw,
      y0: fy0 * this._ch, y1: fy1 * this._ch,
    };
  }

  _uvToLocal(u, v, felt) {
    felt = felt || this._feltLocalRect();
    return { x: felt.x0 + u * (felt.x1 - felt.x0), y: felt.y0 + v * (felt.y1 - felt.y0) };
  }

  _ballRadiusLocal(felt) {
    felt = felt || this._feltLocalRect();
    return (felt.x1 - felt.x0) / 64; // spec §9: ballRadius = feltW / 64
  }

  /** Table-wrap-local CSS px per physics metre, along either felt axis (the
   *  felt and TABLE share the same 2:1 aspect, so this is isotropic — see
   *  _toCanvas's header comment). Used by the live aim/power gesture to
   *  convert a pointer's pixel distance from the cue ball into a power value
   *  in the same real units _toCanvas/_toWorld already use. */
  _pxPerMeter(felt) {
    felt = felt || this._feltLocalRect();
    return (felt.x1 - felt.x0) / TABLE.h;
  }

  _drawTable(ctx) {
    const felt = this._feltLocalRect();
    const R2 = this._ballRadiusLocal(felt);
    const w = this._cw, h = this._ch;

    // Rails: whole table-wrap box, dark maroon gradient (sampled palette —
    // brightest at the felt-facing bevel, darkest at the outer edge; see
    // pool.css's --pl-rail-* header comment for the sampling writeup).
    const railGrad = ctx.createLinearGradient(0, felt.y0, 0, 0);
    railGrad.addColorStop(0, '#8a4041');
    railGrad.addColorStop(1, '#4a1013');
    ctx.fillStyle = '#4a1013';
    roundRect(ctx, 0, 0, w, h, 10);
    ctx.fill();
    // Felt-facing bevel highlight: a thin brighter inset stroke around the felt.
    ctx.save();
    roundRect(ctx, 0, 0, w, h, 10);
    ctx.clip();
    ctx.strokeStyle = '#8a4041';
    ctx.lineWidth = R2 * 0.5;
    ctx.strokeRect(felt.x0, felt.y0, felt.x1 - felt.x0, felt.y1 - felt.y0);
    ctx.restore();

    // Pocket housings: near-black blocks at the 4 corners + 2 side midpoints.
    ctx.fillStyle = '#0b0b0d';
    const cornerSz = w * 0.055, sideW = w * 0.072, sideH = R2 * 3.4;
    for (const [cx, cy] of [[felt.x0, felt.y0], [felt.x1, felt.y0], [felt.x0, felt.y1], [felt.x1, felt.y1]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, cornerSz * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const cy of [felt.y0, felt.y1]) {
      ctx.fillRect((felt.x0 + felt.x1) / 2 - sideW / 2, cy - sideH / 2, sideW, sideH);
    }

    // Felt: radial gradient sampled from the reference (center bright, edges
    // dark), clipped to the felt rect.
    ctx.save();
    ctx.beginPath();
    ctx.rect(felt.x0, felt.y0, felt.x1 - felt.x0, felt.y1 - felt.y0);
    ctx.clip();
    const cx = felt.x0 + 0.42 * (felt.x1 - felt.x0), cy = felt.y0 + 0.40 * (felt.y1 - felt.y0);
    const feltGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, (felt.x1 - felt.x0) * 0.75);
    feltGrad.addColorStop(0, '#80c9dc');
    feltGrad.addColorStop(0.6, '#4f9dc2');
    feltGrad.addColorStop(1, '#256074');
    ctx.fillStyle = feltGrad;
    ctx.fillRect(felt.x0, felt.y0, felt.x1 - felt.x0, felt.y1 - felt.y0);
    // Head string (u=0.25) and foot spot (u=0.75, v=0.5).
    const head = this._uvToLocal(0.25, 0, felt), headB = this._uvToLocal(0.25, 1, felt);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(headB.x, headB.y); ctx.stroke();
    const foot = this._uvToLocal(0.75, 0.5, felt);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(foot.x, foot.y, 2, 0, Math.PI * 2); ctx.fill();
    // Rail sights: faint dots, 3 per half long rail, 1 per half short rail.
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    for (const v of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) {
      for (const u of [0, 1]) { const p = this._uvToLocal(u, v, felt); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const u of [0.25, 0.75]) {
      for (const v of [0, 1]) { const p = this._uvToLocal(u, v, felt); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();

    // Pockets: 6 black capture circles, corners 1.90R, sides 2.05R (CONFIG).
    ctx.fillStyle = '#000';
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [u, v] of corners) {
      const p = this._uvToLocal(u, v, felt);
      ctx.beginPath(); ctx.arc(p.x, p.y, R2 * CONFIG.POCKET_CORNER_MULT, 0, Math.PI * 2); ctx.fill();
    }
    for (const [u, v] of [[0.5, 0], [0.5, 1]]) {
      const p = this._uvToLocal(u, v, felt);
      ctx.beginPath(); ctx.arc(p.x, p.y, R2 * CONFIG.POCKET_SIDE_MULT, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawOneBall(ctx, x, y, rad, kind, number) {
    ctx.save();
    // Ambient occlusion shadow on the felt.
    ctx.beginPath();
    ctx.ellipse(x, y + rad * 0.18, rad * 1.15, rad * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const base = kind === 'cue' ? '#f7f7f2' : kind === 'eight' ? '#0d0d0d' : BALL_COLOR[number];
    if (kind === 'stripe') {
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      ctx.fillStyle = base;
      ctx.fillRect(x - rad, y - rad * 0.55, rad * 2, rad * 1.1);
    } else {
      const grad = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.05, x, y, rad);
      grad.addColorStop(0, lighten(base, 0.35));
      grad.addColorStop(1, base);
      ctx.fillStyle = grad;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.beginPath();
    ctx.ellipse(x - rad * 0.34, y - rad * 0.40, rad * 0.30, rad * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (kind !== 'cue') {
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#fbfbf6';
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `bold ${Math.max(7, rad * 0.56)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), x, y + 0.5);
    }
  }

  _drawScreenshotBalls(ctx) {
    const felt = this._feltLocalRect();
    const rad = this._ballRadiusLocal(felt);
    for (const b of this._screenshotBalls) {
      const p = this._uvToLocal(b.u, b.v, felt);
      this._drawOneBall(ctx, p.x, p.y, rad, b.kind, b.number);
    }
  }

  /** Static cue stick at CONFIG's screenshot-state angle, tip near the cue
   *  ball, per spec §10. Screen-space angle: 0deg = due right, clockwise —
   *  the same convention canvas already uses with y pointing down, so no
   *  sign flip is needed here. */
  _drawScreenshotCue(ctx) {
    const felt = this._feltLocalRect();
    const rad = this._ballRadiusLocal(felt);
    const cue = this._screenshotBalls.find((b) => b.kind === 'cue');
    if (!cue) return;
    const c = this._uvToLocal(cue.u, cue.v, felt);
    const angle = (this._screenshotCueAngleDeg || 194) * Math.PI / 180;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const feltW = felt.x1 - felt.x0;
    const len = feltW * 0.52;
    const tipGap = rad * 0.9;
    const tipX = c.x - dx * tipGap, tipY = c.y - dy * tipGap;
    const buttX = tipX - dx * len, buttY = tipY - dy * len;
    // Felt shadow, offset per spec §10.
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = rad * 0.32;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX + 3, tipY + 5); ctx.lineTo(buttX + 3, buttY + 5); ctx.stroke();
    ctx.restore();
    const grad = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
    grad.addColorStop(0, '#141414');
    grad.addColorStop(0.03, '#f2ece0');
    grad.addColorStop(0.55, '#c79a5e');
    grad.addColorStop(1, '#16233f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = rad * 0.32;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(buttX, buttY); ctx.stroke();
  }

  _legalNumbersForLocal() {
    if (!this.game || this.game.over || this.mode === 'practice') return [];
    const seat = this.game.turnSeat;
    if (!this._isMySeat(seat)) return [];
    const legal = rules.legalTarget(this.game, seat);
    return legal;
  }

  /** The cue stick only — hard constraint 1 (handoff §9 / spec §0): NO
   *  aim-assist. No guideline, no ghost-ball circle, no deflection/tangent
   *  line, no cushion-bounce prediction, ever. Pulls back from the cue ball
   *  proportional to _power, matching the on-table drag and the power-meter
   *  drag (both write the same this._power, so both stay in sync here too —
   *  spec §7's "both input paths must set the same power and keep the meter
   *  in sync" extends naturally to whatever reads that one field). */
  _drawLiveCue(ctx) {
    const cue = ballById(this.game.balls, 'cue');
    if (!cue || cue.pocketed) return;
    const c = this._toCanvas(cue.x, cue.y);
    const felt = this._feltLocalRect();
    const rad = this._ballRadiusLocal(felt);
    const dirx = Math.cos(this._aimAngle), diry = Math.sin(this._aimAngle);
    const pull = Math.min(1, this._power / 4.2) * rad * 6;
    const tipGap = rad * 0.9 + pull;
    const stickLen = rad * 0.52 * 32; // spec §10: cue length = 0.52 * feltW
    const butt = tipGap + stickLen;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = rad * 0.30;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.cx - dirx * tipGap + 3, c.cy - diry * tipGap + 5);
    ctx.lineTo(c.cx - dirx * butt + 3, c.cy - diry * butt + 5);
    ctx.stroke();
    ctx.restore();
    const grad = ctx.createLinearGradient(c.cx - dirx * tipGap, c.cy - diry * tipGap, c.cx - dirx * butt, c.cy - diry * butt);
    grad.addColorStop(0, '#141414');
    grad.addColorStop(0.03, '#f2ece0');
    grad.addColorStop(0.55, '#c79a5e');
    grad.addColorStop(1, '#16233f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = rad * (this._pulling ? 0.32 : 0.30);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.cx - dirx * tipGap, c.cy - diry * tipGap);
    ctx.lineTo(c.cx - dirx * butt, c.cy - diry * butt);
    ctx.stroke();
  }

  /** Moves the DOM spin dot to match this._offset (spec §6.2: dot offset maps
   *  to spin = {side: dx/(0.72r), top: -dy/(0.72r)}, constrained to a circle of
   *  0.72 * ball radius from centre — applied here in reverse to POSITION the
   *  dot from a stored {a,b} in [-1,1]). */
  _paintSpinDot() {
    const dot = this.el.querySelector('[data-role="spin-dot"]');
    if (!dot) return;
    const pct = 0.72 * 50; // 0.72 * ball radius, expressed as % of the ball's own box
    dot.style.left = (50 + this._offset.a * pct) + '%';
    dot.style.top = (50 - this._offset.b * pct) + '%';
  }

  _bindSpinButton() {
    const btn = this.el.querySelector('[data-role="spin-btn"]');
    const panel = this.el.querySelector('[data-role="spin-panel"]');
    if (!btn || !panel) return;
    const open = () => { panel.hidden = false; this._paintSpinDot(); };
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }

  /** Spec §6.2: a large cue ball, a draggable red dot constrained to 0.72 x
   *  ball radius from centre, a close (x), tap-outside-closes, double-tap
   *  recentres. Closing (either way) RETAINS the chosen spin — it only resets
   *  to centre after the next shot fires (see _commitShot). */
  _bindSpinPanel() {
    const panel = this.el.querySelector('[data-role="spin-panel"]');
    const backdrop = this.el.querySelector('[data-role="spin-backdrop"]');
    const closeBtn = this.el.querySelector('[data-role="spin-close"]');
    const ball = this.el.querySelector('[data-role="spin-ball"]');
    if (!panel || !ball) return;
    const close = () => { panel.hidden = true; };
    if (backdrop) backdrop.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    let dragging = false;
    const setFromEvent = (e) => {
      const rect = ball.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const rMax = (rect.width / 2) * 0.72;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const mag = Math.hypot(dx, dy);
      if (mag > rMax && rMax > 0) { dx = dx / mag * rMax; dy = dy / mag * rMax; }
      this._offset = { a: rMax > 0 ? dx / rMax : 0, b: rMax > 0 ? -dy / rMax : 0 };
      this._paintSpinDot();
    };
    ball.addEventListener('pointerdown', (e) => {
      dragging = true;
      setFromEvent(e);
      try { ball.setPointerCapture(e.pointerId); } catch { /* invalid/synthetic pointer id: drag still works via move/up */ }
    });
    ball.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    ball.addEventListener('pointerup', () => { dragging = false; });
    ball.addEventListener('dblclick', () => { this._offset = { a: 0, b: 0 }; this._paintSpinDot(); });
  }

  /** Spec §7: pointer-down anywhere on the track and drag sets power in
   *  [0, max] from the drag position (top=0, bottom=max) — the SAME
   *  this._power the on-table drag sets (_bindTablePointer), so the fill and
   *  the on-table cue's pull-back stay in sync regardless of which control
   *  last touched it. Release above the shared threshold shoots, using
   *  whatever aim angle is currently set. */
  _bindPowerTrack() {
    const track = this.el.querySelector('[data-role="power-track"]');
    if (!track) return;
    let dragging = false;
    const setFromEvent = (e) => {
      const rect = track.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      this._power = frac * 4.2;
      this._pulling = this._power > 0.05;
      this._paintPowerMeter();
    };
    track.addEventListener('pointerdown', (e) => {
      if (!this._canShootNow() || this._placingCue) return;
      dragging = true;
      setFromEvent(e);
      try { track.setPointerCapture(e.pointerId); } catch { /* invalid/synthetic pointer id: drag still works via move/up */ }
    });
    track.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    const release = () => {
      if (!dragging) return;
      dragging = false;
      const power = this._power;
      this._pulling = false;
      if (power > 0.35) this._commitShot(power);
      else { this._power = 0; this._paintPowerMeter(); }
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
  }

  _paintPowerMeter() {
    const fill = this.el.querySelector('[data-role="power-fill"]');
    if (fill) fill.style.height = Math.min(100, (this._power / 4.2) * 100) + '%';
  }

  /** Colorblind-safe palette (root CLAUDE.md's accessibility convention) for the
   *  profile's `preferredColor` ('yellow'|'blue'|'red'|'green'|null). Never the
   *  only cue in the UI — the avatar frame also carries an active/inactive
   *  shape marker (pool.css's .pl-avatar.is-active::after triangle). */
  _profileColorHex(name) {
    return { yellow: '#F2B705', blue: '#1F5FA8', red: '#E0532F', green: '#178A7A' }[name] || '#4a4858';
  }

  /** Seat 0's identity/avatar for the HUD (name, emoji, preferred colour). The
   *  profile is defaults-only (root CLAUDE.md "shared profile" contract) — try/
   *  catch already happened once in the constructor; missing data just falls
   *  back to neutral placeholders, never a crash. */
  _seatIdentity(seat) {
    if (seat === this._localSeat()) {
      return {
        name: this._myName(),
        emoji: (this.profile && this.profile.emoji) || '🙂',
        color: this._profileColorHex(this.profile && this.profile.preferredColor),
      };
    }
    if (this.mp && this.mp.opp) {
      return { name: this.mp.opp.name || t('computer'), emoji: this.mp.opp.avatar || '🙂', color: '#4a4858' };
    }
    const opp = this.profile && Array.isArray(this.profile.opponents) ? this.profile.opponents[0] : null;
    return { name: (opp && opp.name) || t('computer'), emoji: (opp && opp.emoji) || '🤖', color: '#4a4858' };
  }

  /** HUD text/avatars/ball-rows/tray/turn-indicator — every read here derives
   *  from _localSeat()/game state, never assumes the local player is seat 0
   *  (root CLAUDE.md's explicit ask for this game, see ui.js's top comment). */
  _paintHud() {
    if (!this.game) return;
    const seat0 = this._seatIdentity(0);
    const seat1 = this._seatIdentity(1);
    const nameEl0 = this.el.querySelector('[data-role="p1-name"]');
    const nameEl1 = this.el.querySelector('[data-role="p2-name"]');
    if (nameEl0) nameEl0.textContent = seat0.name;
    if (nameEl1) nameEl1.textContent = seat1.name;
    const av0 = this.el.querySelector('[data-role="p1-avatar"]');
    const av1 = this.el.querySelector('[data-role="p2-avatar"]');
    const turnSeat = this.game.turnSeat;
    if (av0) { av0.textContent = seat0.emoji; av0.style.background = seat0.color; av0.classList.toggle('is-active', turnSeat === 0 && !this.game.over); }
    if (av1) { av1.textContent = seat1.emoji; av1.style.background = seat1.color; av1.classList.toggle('is-active', turnSeat === 1 && !this.game.over); }

    // The one pottedBalls read (spec §5) all three UI surfaces share — the tray,
    // both HUD rows here, and (Phase 3+) the balls actually missing from the
    // table. Screenshot-verification mode substitutes its own fixed set so the
    // debug snapshot is internally consistent without touching `this.game`.
    const pottedNumbers = this._screenshotBalls ? SCREENSHOT_STATE.potted
      : this.game.balls.filter((b) => b.pocketed && b.id !== 'cue').map((b) => b.number);
    const pottedIds = new Set(pottedNumbers.map((n) => 'b' + n));
    this._renderBallRow('[data-role="p1-balls"]', SOLID_NUMBERS, pottedIds);
    this._renderBallRow('[data-role="p2-balls"]', STRIPE_NUMBERS, pottedIds);
    this._renderTray(pottedNumbers);

    const el = this.el.querySelector('[data-role="turn-text"]');
    if (el) {
      if (this.mode === 'practice' || this.game.over) el.textContent = '';
      else if (this._isMySeat(turnSeat)) el.textContent = this.game.ballInHand ? t('place_cue') : t('your_turn');
      else el.textContent = this.mode === 'ai' && this._aiThinking ? t('opp_thinking', { opp: this._oppName() }) : t('opp_turn', { opp: this._oppName() });
    }
    const slot = this.el.querySelector('[data-role="foul-slot"]');
    if (slot) {
      slot.innerHTML = this._foulMsg
        ? `<button type="button" class="pl-foul-icon" data-role="foul-explain" title="${t('foul')}">⚠</button>`
        : '';
      const btn = slot.querySelector('[data-role="foul-explain"]');
      if (btn) btn.addEventListener('click', () => this._showFoulToast());
    }
  }

  _renderBallRow(selector, numbers, pottedIds) {
    const row = this.el.querySelector(selector);
    if (!row) return;
    row.innerHTML = numbers.map((n) => {
      const potted = pottedIds.has('b' + n);
      if (potted) return '<span class="pl-mini is-potted"></span>';
      const bg = n <= 7 ? BALL_COLOR[n] : _stripeGradient(BALL_COLOR[n]);
      return `<span class="pl-mini" style="background:${bg}"></span>`;
    }).join('');
  }

  /** All three of the tray, and both HUD ball rows above, derive from this one
   *  potted-ball read (spec §5's "never maintain them independently"; the
   *  balls on the table will be the third reader once Phase 2 wires the canvas). */
  _renderTray(pottedNumbers) {
    const box = this.el.querySelector('[data-role="tray-balls"]');
    if (!box) return;
    box.innerHTML = pottedNumbers.map((n) => {
      const bg = n <= 7 ? BALL_COLOR[n] : _stripeGradient(BALL_COLOR[n]);
      return `<span class="pl-tray-ball" style="background:${bg}"></span>`;
    }).join('');
  }

  /** A native alert() blocks the whole page's main thread/input pipeline until
   *  dismissed — a real correctness bug (it can make drags elsewhere look
   *  "stuck"), not just a UX wart. This is a plain, non-blocking DOM popover
   *  instead, matching the build guide's "tapping the icon can explain it,
   *  nothing else appears" (a native dialog is itself an extra surface). */
  _showFoulToast() {
    if (!this._foulMsg) return;
    const slot = this.el.querySelector('[data-role="foul-slot"]');
    if (!slot) return;
    let toast = slot.querySelector('.pl-foul-toast');
    if (toast) { toast.remove(); return; } // tap again to dismiss
    toast = document.createElement('div');
    toast.className = 'pl-foul-toast';
    toast.textContent = this._foulMsg;
    slot.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3200);
  }

  // ---- pointer input: aim / power / spin / elevation ----------------------
  _canShootNow() {
    return this.game && !this.game.over && this._isMySeat(this.game.turnSeat) && !this._simulating;
  }


  // ONE continuous drag, no lift-then-repress in the middle. Earlier draft
  // required a release to "arm" a second power-pull press, but a real
  // touchscreen mints a brand-new pointerId on every fresh contact, so the
  // code was never able to recognize that second press as the same shot: aim
  // locked, the power meter never moved, and no shot ever fired. This is the
  // standard mobile-pool-app pattern instead: while ONE finger is down, its
  // live distance from the cue ball IS the power (further away = harder,
  // "stretch and release"), and its live angle relative to the cue ball IS
  // the aim, both continuously — release above a small threshold shoots,
  // anything smaller (or no real drag at all) is just a tap and cancels
  // cleanly on its own, no separate cancel gesture needed. A second finger
  // held down damps the aim-angle update rate for fine adjustment (build
  // guide's "a second finger held down makes the drag much finer").
  _bindTablePointer() {
    const c = this.canvas;
    let primaryId = null;
    let fineMode = false;

    const angleAndDistFromCue = (px, py) => {
      const cue = ballById(this.game.balls, 'cue');
      const cc = this._toCanvas(cue.x, cue.y);
      const dx = px - cc.cx, dy = py - cc.cy;
      return { angle: Math.atan2(-dy, -dx), dist: Math.hypot(dx, dy) };
    };

    const updateAimPower = (px, py) => {
      const { angle, dist } = angleAndDistFromCue(px, py);
      if (fineMode) {
        let delta = angle - this._aimAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this._aimAngle += delta * 0.22;
      } else {
        this._aimAngle = angle;
      }
      const felt = this._feltLocalRect();
      const rad = this._ballRadiusLocal(felt);
      const pxPerMeter = this._pxPerMeter(felt);
      const DEADZONE_PX = rad * 1.4;
      const worldPull = Math.max(0, dist - DEADZONE_PX) / pxPerMeter;
      this._power = Math.max(0, Math.min(4.2, worldPull * 2.6));
      this._pulling = this._power > 0.05;
      this._paintPowerMeter();
    };

    c.addEventListener('pointerdown', (e) => {
      if (!this.game || this.game.over) return;
      this._pointers.set(e.pointerId, e);
      if (this._placingCue) {
        if (primaryId === null) primaryId = e.pointerId;
        return;
      }
      if (!this._canShootNow()) return;
      if (primaryId === null) {
        primaryId = e.pointerId;
        this._aiming = true;
        this._power = 0;
        this._pulling = false;
        const p = this._pointerLocal(e);
        updateAimPower(p.x, p.y);
      } else if (this._pointers.size === 2) {
        fineMode = true;
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, e);
      if (this._placingCue) {
        if (e.pointerId !== primaryId) return;
        const p = this._pointerLocal(e);
        const w = this._toWorld(p.x, p.y);
        this._tryPlaceCuePreview(w.x, w.y);
        return;
      }
      if (e.pointerId !== primaryId || !this._aiming) return;
      const p = this._pointerLocal(e);
      updateAimPower(p.x, p.y);
    });

    const finish = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      if (this._placingCue) {
        if (e.pointerId === primaryId) {
          const p = this._pointerLocal(e);
          const w = this._toWorld(p.x, p.y);
          this._commitCuePlacement(w.x, w.y);
          primaryId = null;
        }
        return;
      }
      if (e.pointerId !== primaryId) { if (this._pointers.size < 2) fineMode = false; return; }
      const power = this._power;
      this._aiming = false; this._pulling = false; this._power = 0; primaryId = null; fineMode = false;
      if (power > 0.35) this._commitShot(power);
    };
    c.addEventListener('pointerup', finish);
    c.addEventListener('pointercancel', finish);
  }

  /** Illegal: overlapping a ball, inside a pocket, off the felt (spec §13's
   *  ball-in-hand UI), or outside the head string when this.game.
   *  headStringRestricted (spec §13.5's new restriction — see rules.js). The
   *  felt-bounds check is real, not just the caller's clamp: (x,y) here is
   *  the pointer's raw world position, unclamped. */
  _placementLegal(x, y) {
    const hw = TABLE.w / 2, hh = TABLE.h / 2;
    if (x < -hw + R || x > hw - R || y < -hh + R || y > hh - R) return false;
    const overlaps = this.game.balls.some((b) => b.id !== 'cue' && !b.pocketed && Math.hypot(b.x - x, b.y - y) < 2 * R);
    if (overlaps) return false;
    const inPocket = pocketCenters().some((p) => {
      const pr = p.side ? POCKET_R_SIDE : POCKET_R;
      return Math.hypot(x - p.x, y - p.y) < pr;
    });
    if (inPocket) return false;
    if (this.game.headStringRestricted && y >= HEAD_SPOT.y) return false;
    return true;
  }

  _tryPlaceCuePreview(x, y) {
    // no persistent preview state needed beyond redraw; ghost cue follows pointer
    const cue = ballById(this.game.balls, 'cue');
    cue.x = Math.max(-TABLE.w / 2 + R, Math.min(TABLE.w / 2 - R, x));
    cue.y = Math.max(-TABLE.h / 2 + R, Math.min(TABLE.h / 2 - R, y));
  }

  _commitCuePlacement(x, y) {
    const cx = Math.max(-TABLE.w / 2 + R, Math.min(TABLE.w / 2 - R, x));
    const cy = Math.max(-TABLE.h / 2 + R, Math.min(TABLE.h / 2 - R, y));
    if (!this._placementLegal(cx, cy)) return; // refuses illegal spots on its own, per the build guide
    this.game = rules.placeCueBall(this.game, cx, cy);
    this._placingCue = false;
    this._saveProgress();
  }

  async _commitShot(power) {
    if (!this._canShootNow()) return;
    const dir = { x: Math.cos(this._aimAngle), y: Math.sin(this._aimAngle) };
    const offset = { ...this._offset };
    const elevation = this._elevation;
    const seat = this.game.turnSeat;
    // Spec §6.2: chosen spin persists for the next shot only, then resets to
    // centre — reset now, right after this shot's offset is snapshotted above,
    // so the panel is back to centre before the player can open it again.
    this._offset = { a: 0, b: 0 };
    this._paintSpinDot();
    if (this.mp) {
      await this._mpLocalShoot(dir, power, offset, elevation);
    } else {
      const events = await this._runShot(dir, power, offset, elevation);
      this._settleLocal(events, seat);
    }
  }

  _settleLocal(events, seat) {
    if (this.mode === 'practice') { this._foulMsg = null; this._paintHud(); this._saveProgress(); return; }
    const { state, outcome } = rules.resolveShot(this.game, events);
    this.game = state;
    this._applyOutcomeUi(outcome, seat);
    this._saveProgress();
    if (this.game.over) this._onGameOver(seat, outcome);
    else if (this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
    this._maybeDriveAiOrMp();
  }

  _applyOutcomeUi(outcome, actingSeat) {
    this._foulMsg = null;
    if (outcome.foul) {
      const key = 'foul_' + outcome.foulReason;
      this._foulMsg = t(key) || t('foul');
    }
    this._paintHud();
  }

  _onGameOver(actingSeat, outcome) {
    const iWon = this.game.winner === this._localSeat();
    if (this.mode === 'ai') {
      recordResult('pool', this.settings.difficulty, iWon);
    } else if (this.mp) {
      recordResult('pool', 'mp', iWon);
      if (this.mp.opp) { try { recordHeadToHead('pool', this.mp.opp, iWon); } catch { /* never block the result */ } }
      if (this.mp.role === 'host') net.writeResult(this.mp.code, { winner: this.game.winner }).catch(() => {});
      clearKey(MP_SAVE_KEY);
    }
    clearKey(SAVE_KEY);
    this._showEndDialog(iWon);
  }

  /** Spec §15, minus §6.2's coins-flying-to-the-winner (handoff §6.2: this
   *  hub has no economy to animate) plus a close X (house convention, spec
   *  omits it): dim the table, a gold WINNER plate over the winning avatar,
   *  a green Play Again button centered below the table. */
  _showEndDialog(iWon) {
    const winnerSeat = this.game.winner;
    const av = this.el.querySelector(`[data-role="p${winnerSeat === 0 ? '1' : '2'}-avatar"]`);
    if (av) av.classList.add('pl-avatar-winner');
    const dim = document.createElement('div');
    dim.className = 'pl-end-dim';
    applyRect(dim, CONFIG.TABLE_BOX);
    const actions = document.createElement('div');
    actions.className = 'pl-end-actions';
    applyRect(actions, { x0: 0.40, x1: 0.60, y0: 0.80, y1: 0.94 });
    actions.innerHTML = `
      <button type="button" class="pl-end-close" data-role="end-close" aria-label="${t('cancel')}">&times;</button>
      <div class="pl-end-title">${iWon ? t('you_win') : t('opp_wins', { opp: this._oppName() })}</div>
      <div class="pl-end-btns">
        ${this.mp ? '' : `<button type="button" class="pl-end-again" data-role="again">${t('play_again')}</button>`}
        <button type="button" class="pl-btn" data-role="new">${t('new_game')}</button>
      </div>`;
    this.stage.appendChild(dim);
    this.stage.appendChild(actions);
    const cleanup = () => { dim.remove(); actions.remove(); if (av) av.classList.remove('pl-avatar-winner'); };
    actions.querySelector('[data-role="end-close"]').addEventListener('click', cleanup);
    const again = actions.querySelector('[data-role="again"]');
    if (again) again.addEventListener('click', () => { cleanup(); this._startLocalGame(); });
    actions.querySelector('[data-role="new"]').addEventListener('click', () => { cleanup(); this.view = 'setup'; this.mp = null; this.render(); });
  }

  _confirmQuit() {
    if (this._quitArmed) {
      if (this.mp && this.mp.code) net.leaveRoom(this.mp.code, this.mp.role).catch(() => {});
      clearKey(SAVE_KEY); clearKey(MP_SAVE_KEY);
      this.mp = null; this.view = 'setup'; this.render();
      return;
    }
    this._quitArmed = true;
    const btn = this.el.querySelector('[data-role="quit"]');
    // A title= tooltip never shows on a touch device (no hover), so the
    // original "tap again" affordance was invisible on a phone — a tap could
    // quit silently with nothing ever shown on screen. This badge is real,
    // visible, on-screen text instead.
    const badge = this.el.querySelector('[data-role="quit-confirm"]');
    if (btn) btn.classList.add('is-confirm');
    if (badge) badge.hidden = false;
    setTimeout(() => {
      this._quitArmed = false;
      if (btn) btn.classList.remove('is-confirm');
      if (badge) badge.hidden = true;
    }, 3500);
  }

  // ---- AI turn driver -------------------------------------------------
  async _maybeDriveAiOrMp() {
    if (!this.game || this.game.over || this.mode !== 'ai') return;
    const seat = this.game.turnSeat;
    if (this._isMySeat(seat)) return;
    this._aiThinking = true;
    this._paintHud();
    await new Promise((r) => setTimeout(r, 550));
    if (this._dead || !this.game || this.game.over) return;
    if (this.game.ballInHand) {
      const spot = this._aiPlacementSpot();
      this.game = rules.placeCueBall(this.game, spot.x, spot.y);
    }
    const shot = chooseShot(this.game, seat, this.settings.difficulty);
    this._aiThinking = false;
    if (!shot) return;
    const events = await this._runShot(shot.dir, shot.power, shot.offset, shot.elevation);
    this._settleLocal(events, seat);
  }

  _aiPlacementSpot() {
    // Spec §13.5: the AI must respect the same head-string restriction a
    // human placement does (this.game.headStringRestricted) — deterministic,
    // no attempt at "smart" safety placement, same as the unrestricted case.
    const yMax = this.game.headStringRestricted ? HEAD_SPOT.y : TABLE.h / 2 - R;
    const candidates = [];
    for (let gx = -0.4; gx <= 0.4; gx += 0.08) {
      for (let gy = -0.85; gy <= Math.min(0.85, yMax); gy += 0.12) candidates.push({ x: gx, y: gy });
    }
    for (const c of candidates) {
      const blocked = this.game.balls.some((b) => b.id !== 'cue' && !b.pocketed && Math.hypot(b.x - c.x, b.y - c.y) < 2.1 * R);
      if (!blocked) return c;
    }
    return { x: 0, y: -TABLE.h * 0.25 };
  }

  // ---- multiplayer ------------------------------------------------------
  _myIdentity() {
    return { name: this._myName(), avatar: (this.profile && this.profile.emoji) || '🙂', deviceId: deviceId() };
  }

  async _mpCreateRoom() {
    const status = this.el.querySelector('[data-role="mp-status"]');
    if (status) status.textContent = t('joining');
    const res = await net.createRoom('pool', {}, this._myIdentity());
    if (res.error) { if (status) status.textContent = res.error === 'offline' ? t('online_offline') : t('room_full'); return; }
    this.mp = {
      role: 'host', code: res.code, localSeat: 0, opp: null,
      appliedSeq: 0, movesById: new Map(), maxKnownSeq: 0, delivering: false,
      awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false,
    };
    net.heartbeat(res.code, 'host');
    if (status) status.textContent = t('share_code', { code: res.code });
    await net.onRoom(res.code, (room) => this._mpRoomCallback(room));
  }

  async _mpJoinRoom(code) {
    const status = this.el.querySelector('[data-role="mp-status"]');
    if (status) status.textContent = t('joining');
    const res = await net.joinRoom(code, this._myIdentity());
    if (res.error) {
      if (status) status.textContent = res.error === 'not-found' ? t('room_not_found')
        : res.error === 'full' ? t('room_full')
        : res.error === 'version' ? t('version_mismatch') : t('online_offline');
      return;
    }
    this.mp = {
      role: 'guest', code: code.toUpperCase(), localSeat: 1, opp: null,
      appliedSeq: 0, movesById: new Map(), maxKnownSeq: 0, delivering: false,
      awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false,
    };
    net.heartbeat(this.mp.code, 'guest');
    await net.onRoom(this.mp.code, (room) => this._mpRoomCallback(room));
    if (res.room && res.room.round) this._mpApplyRoundRecord(res.room.round, res.room);
  }

  _mpRejoin() {
    const save = readJSON(MP_SAVE_KEY);
    if (!save) return;
    (async () => {
      const res = save.role === 'host'
        ? { code: save.code }
        : await net.joinRoom(save.code, this._myIdentity());
      if (res.error) return;
      this.mp = {
        role: save.role, code: save.code, localSeat: save.role === 'host' ? 0 : 1, opp: null,
        appliedSeq: save.seq | 0, movesById: new Map(), maxKnownSeq: save.seq | 0, delivering: false,
        awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false,
      };
      this.game = save.game;
      net.heartbeat(this.mp.code, this.mp.role);
      await net.onRoom(this.mp.code, (room) => this._mpRoomCallback(room));
      this.view = 'game';
      this.render();
    })();
  }

  async _mpRoomCallback(room) {
    if (!room || !this.mp) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;
    if (room.status === 'ended' && !mp.opponentLeft && this.game && !this.game.over) {
      mp.opponentLeft = true;
      this._foulMsg = null;
      this._paintHud();
    }
    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        net.writeRecovery(mp.code, mp.appliedSeq, this._mpSnapshot()).catch(() => {});
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this._mpApplyRecovery(room.recovery);
      }
    }
    if (room.round && (room.round.n | 0) !== (mp.gameNum | 0)) {
      this._mpApplyRoundRecord(room.round, room);
    }
    const entries = Object.values(room.moves || {}).sort((a, b) => a.seq - b.seq);
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    if (this.view === 'game') this._paintHud();
    this._mpDrain();
    // Host starts round 1 the first time both seats are present.
    if (mp.role === 'host' && !room.round && room.guest && !mp.starting) {
      mp.starting = true;
      await net.startRound(mp.code, 1, null, 0);
    }
  }

  _mpApplyRoundRecord(round, room) {
    const mp = this.mp;
    mp.gameNum = round.n | 0;
    mp.appliedSeq = 0;
    mp.movesById = new Map();
    mp.maxKnownSeq = 0;
    this.game = rules.newGame();
    this.game.turnSeat = round.dealer === 1 ? 1 : 0;
    this.view = 'game';
    this.render();
  }

  _mpSnapshot() { return { balls: this.game.balls, rules: { ...this.game, balls: undefined } }; }

  _mpApplyRecovery(recovery) {
    const snap = recovery.state;
    this.game = { ...snap.rules, balls: snap.balls.map((b) => ({ ...b })) };
    this.mp.appliedSeq = recovery.seq | 0;
    this.mp.maxKnownSeq = Math.max(this.mp.maxKnownSeq | 0, this.mp.appliedSeq);
    this.mp.awaitingRecovery = false;
    this.mp.recoveryAttempts = 0;
    this.render();
    net.clearRecovery(this.mp.code).catch(() => {});
  }

  async _mpLocalShoot(dir, power, offset, elevation) {
    const mp = this.mp;
    const seat = this.game.turnSeat;
    const events = await this._runShot(dir, power, offset, elevation);
    const { state, outcome } = rules.resolveShot(this.game, events);
    this.game = state;
    this._applyOutcomeUi(outcome, seat);
    const h = stateHash(this.game);
    const seq = ++mp.appliedSeq;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq, seq);
    this._mpSaveProgress();
    net.appendMove(mp.code, mp.role, seq, { g: mp.gameNum, dir, power, offset, elevation }, h).catch(() => {});
    if (this.game.over) this._onGameOver(seat, outcome);
    else if (this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
  }

  async _mpDrain() {
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this._dead || !this.game) return;
    mp.delivering = true;
    try {
      // eslint-disable-next-line no-await-in-loop
      while (await this._mpApplyNextEntry()) { /* keep draining */ }
    } finally { mp.delivering = false; }
  }

  async _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !this.game || this.game.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry) return false;
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;
    if (entry.by === mp.role) { mp.appliedSeq = seq; return true; } // already applied locally
    const move = entry.move;
    const events = await this._runShot(move.dir, move.power, move.offset, move.elevation);
    const seat = this.game.turnSeat;
    const { state, outcome } = rules.resolveShot(this.game, events);
    this.game = state;
    this._applyOutcomeUi(outcome, seat);
    const h = stateHash(this.game);
    if (h !== entry.h) { this._mpHandleMismatch(seq); return false; }
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    this._mpSaveProgress();
    if (this.game.over) { this._onGameOver(seat, outcome); return false; }
    if (this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
    return true;
  }

  _mpHandleMismatch(seq) {
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) return;
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      net.writeRecovery(mp.code, seq, this._mpSnapshot()).catch(() => {});
    } else {
      mp.awaitingRecovery = true;
      net.requestRecovery(mp.code, seq).catch(() => {});
    }
  }

  _mpSaveProgress() {
    if (!this.mp) return;
    writeJSON(MP_SAVE_KEY, { role: this.mp.role, code: this.mp.code, seq: this.mp.appliedSeq, game: this.game });
  }
}

let instance = null;
export function init(container) { instance = new PoolUI(container); }
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
export function isInProgress() { return instance ? instance.isInProgress() : false; }
export default { init, destroy, isInProgress };
