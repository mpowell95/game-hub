// ui.js — Poolv2 UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen: Filler's flat/segmented pattern (root CLAUDE.md marks it acceptable
// for a small game, vs. Escoba's fuller accordion) — Poolv2 has only two real
// choices (mode, difficulty). CSS scoping follows Mancala's discipline (every rule
// descendant-scoped under .p2-root). Settings key follows the current convention,
// gamehub.poolv2.v1.
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
// and verifies the hash, exactly like the reference games. One room hosts a
// REMATCH SERIES (round.n / round.dealer alternated by the host via
// mp.nextDealer), same vocabulary as Tic Tac Toe/Mancala/Filler/Dots and Boxes.
import { R, TABLE, strikeCueBall, tick, isMoving, pocketCenters } from './physics.js';
import { ballById } from './table.js';
import * as rules from './rules.js';
import { chooseShot } from './ai.js';
import { mulberry32 } from './rng.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.poolv2.v1';
const SAVE_KEY = 'gamehub.poolv2.save.v1';
const MP_SAVE_KEY = 'gamehub.poolv2.mp.v1';
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// Pinch-zoom/pan tiebreak (BUILD-SPEC.md §4 rule 6): two fingers meant "fine aim"
// once aiming had already committed with one finger down. To tell "about to pinch"
// from "about to aim" on the very first touch, aim commit is held for this short
// window; a second finger landing before it elapses reads as a pinch instead. A
// single finger that MOVES before the window elapses commits aim immediately
// (below this threshold), so ordinary single-finger aiming never feels delayed.
const PINCH_WINDOW_MS = 90;
const PENDING_MOVE_COMMIT_PX = 6;
const CAM_ZOOM_MIN = 1, CAM_ZOOM_MAX = 2.5;

const BALL_COLOR = {
  1: '#F5D033', 2: '#1F5FA8', 3: '#D0342C', 4: '#6A3FA0', 5: '#E0752D', 6: '#1E7A46', 7: '#7B3F2E',
  9: '#F5D033', 10: '#1F5FA8', 11: '#D0342C', 12: '#6A3FA0', 13: '#E0752D', 14: '#1E7A46', 15: '#7B3F2E',
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
    this._camera = 'top';
    this._camZoom = 1;
    this._camPan = { x: 0, y: 0 };
    this._placingCue = false;
    this._foulMsg = null;
    this._aiRng = null;
    this._aiSeed = null;
    this._boundResize = () => this._resizeCanvas();
    this._boundVis = () => { if (document.hidden) this._syncNothingSpecial(); };
    this._setupWorker();
    this._tryAutoResume();
    this.render();
    // Live language re-render (root CLAUDE.md item 9's minimum bar is render-time-only;
    // this is the optional live re-label, BUILD-SPEC §6 #13). Re-running the current
    // view's render is safe mid-game because _startLoop() cancels any prior RAF loop
    // and every other piece of live state (game/mp/sim*) lives on `this`, not a closure.
    this._offLang = onLangChange(() => { if (!this._dead) this.render(); });
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
    if (this.mode === 'ai') this._ensureAiRng(save.aiSeed);
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
    if (this._offLang) { this._offLang(); this._offLang = null; }
    window.removeEventListener('resize', this._boundResize);
    document.removeEventListener('visibilitychange', this._boundVis);
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this.mp && this.mp.code) net.leaveRoom(this.mp.code, this.mp.role).catch(() => {});
    net.disconnect();
    this._disableWorker();
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
    if (document.getElementById('p2-css')) return;
    const link = document.createElement('link');
    link.id = 'p2-css';
    link.rel = 'stylesheet';
    link.href = new URL('../css/poolv2.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  // ---- render dispatch ------------------------------------------------
  render() {
    this._ensureCss();
    this.root.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'p2-root';
    this.root.appendChild(div);
    this.el = div;
    if (this.view === 'setup') this._renderSetup();
    else this._renderGame();
  }

  _renderSetup() {
    const savedMp = readJSON(MP_SAVE_KEY);
    this.el.innerHTML = `
      <div class="p2-setup">
        <h1 class="p2-title">${t('title')}</h1>
        <p class="p2-tagline">${t('tagline')}</p>
        <div class="p2-row">
          <div class="p2-label">${t('mode')}</div>
          <div class="p2-seg" data-role="mode">
            <button type="button" data-v="ai" class="${this.mode === 'ai' ? 'is-active' : ''}">${t('mode_ai')}</button>
            <button type="button" data-v="practice" class="${this.mode === 'practice' ? 'is-active' : ''}">${t('mode_practice')}</button>
            <button type="button" data-v="online" class="${this.mode === 'online' ? 'is-active' : ''}">${t('mode_online')}</button>
          </div>
        </div>
        <div class="p2-row" data-if="ai" style="${this.mode === 'ai' ? '' : 'display:none'}">
          <div class="p2-label">${t('difficulty')}</div>
          <div class="p2-seg" data-role="diff">
            ${['beginner', 'intermediate', 'pro'].map((d) => `<button type="button" data-v="${d}" class="${this.settings.difficulty === d ? 'is-active' : ''}">${t('diff_' + d)}</button>`).join('')}
          </div>
        </div>
        <div class="p2-online" data-if="online" style="${this.mode === 'online' ? '' : 'display:none'}">
          ${savedMp ? `<button type="button" class="p2-btn" data-role="rejoin">${t('rejoin')}</button>` : ''}
          <button type="button" class="p2-btn" data-role="create-room">${t('create_room')}</button>
          <div class="p2-joinrow">
            <input type="text" maxlength="4" placeholder="${t('enter_code')}" data-role="code-input" class="p2-code-input">
            <button type="button" class="p2-btn" data-role="join-room">${t('join_room')}</button>
          </div>
          <div class="p2-mp-status" data-role="mp-status"></div>
        </div>
        <div class="p2-actions">
          <button type="button" class="p2-btn p2-btn-primary" data-role="start" ${this.mode === 'online' ? 'disabled' : ''}>${t('start')}</button>
          <button type="button" class="p2-btn p2-btn-ghost" data-role="howto">${t('howto')}</button>
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
    dlg.className = 'p2-dialog-overlay';
    dlg.innerHTML = `
      <div class="p2-dialog">
        <button type="button" class="p2-x" data-role="close" aria-label="${t('cancel')}">✕</button>
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
    if (this.mode === 'ai') this._ensureAiRng();
    this._afterNewGame();
  }

  _afterNewGame() {
    this.view = 'game';
    this._foulMsg = null;
    this._resetCamera();
    this.render();
  }

  // ---- persistence (solo/practice autosave; not MP) -----------------------
  _saveProgress() {
    if (this.mode === 'online') return;
    if (!this.game || this.game.over) { clearKey(SAVE_KEY); return; }
    writeJSON(SAVE_KEY, { mode: this.mode, difficulty: this.settings.difficulty, game: this.game, aiSeed: this._aiSeed });
  }

  // ---- AI RNG (BUILD-SPEC.md §6 #8: seed the RNG so AI games are reproducible) ---
  /** (Re)seed this game's AI generator. `seed` restores a specific seed (resume);
   *  omitted, a fresh one is drawn. One generator lives for the whole game so its
   *  sequence of draws (one _nextAiSubSeed() per AI turn) is itself reproducible
   *  given the top-level seed, worker or not. */
  _ensureAiRng(seed) {
    this._aiSeed = (seed != null ? seed : ((Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0)) >>> 0;
    this._aiRng = mulberry32(this._aiSeed);
  }

  /** One sub-seed per AI turn, drawn from this game's own seeded generator so the
   *  worker (which gets a fresh mulberry32(seed) per request, not the live
   *  generator object — Workers can't receive closures) reproduces the exact same
   *  draw a main-thread call would have made at that point in the game. */
  _nextAiSubSeed() {
    if (!this._aiRng) this._ensureAiRng();
    return Math.floor(this._aiRng() * 0xffffffff) >>> 0;
  }

  // ---- AI worker (BUILD-SPEC.md §6 #8: move the search off the main thread) ------
  _setupWorker() {
    try {
      this._worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this._workerCallbacks = new Map();
      this._workerReqId = 0;
      this._worker.onmessage = (e) => {
        const cb = this._workerCallbacks.get(e.data.id);
        if (!cb) return; // stale/unknown
        this._workerCallbacks.delete(e.data.id);
        if (e.data.error) cb.reject(new Error(e.data.error));
        else cb.resolve(e.data);
      };
      this._worker.onerror = () => {
        for (const cb of this._workerCallbacks.values()) cb.reject(new Error('worker error'));
        this._workerCallbacks.clear();
        this._disableWorker();
      };
    } catch {
      this._worker = null; // workers unavailable -> main-thread fallback
    }
  }

  _disableWorker() {
    if (this._worker) { this._worker.terminate(); this._worker = null; }
  }

  _postToWorker(params) {
    return new Promise((resolve, reject) => {
      this._workerCallbacks.set(params.id, { resolve, reject });
      this._worker.postMessage(params);
    });
  }

  /** Run ai.js's chooseShot off the main thread when a worker is available, same
   *  fallback discipline as connect-four/js/ui.js's requestAIMove: try the worker,
   *  disable it and fall through to an inline call on any failure. The seed always
   *  comes from THIS game's seeded generator (_nextAiSubSeed), so the AI's
   *  decisions stay reproducible/replayable given the game's aiSeed whether or not
   *  the worker path is actually taken. */
  async _chooseShotOffThread(state, seat, difficulty) {
    const seed = this._nextAiSubSeed();
    if (this._worker) {
      try {
        const res = await this._postToWorker({ id: ++this._workerReqId, state, seat, difficulty, seed });
        return res.shot;
      } catch { this._disableWorker(); }
    }
    return chooseShot(state, seat, difficulty, mulberry32(seed));
  }

  // ---- canvas + camera ------------------------------------------------
  _renderGame() {
    // Transient input state from a previous game (or a quit mid-aim) must never
    // carry into a new one — otherwise a stale dashed aim line/cue stick shows
    // before the player has touched anything on the fresh table.
    this._aiming = false;
    this._pulling = false;
    this._power = 0;
    this._placingCue = false;
    this._quitArmed = false;
    this._foulMsg = null;
    this.el.innerHTML = `
      <div class="p2-game">
        <div class="p2-hud">
          <div class="p2-hud-left">
            <span class="p2-turn-text" data-role="turn-text"></span>
          </div>
          <div class="p2-hud-right">
            ${this.mode === 'practice' ? `<button type="button" class="p2-icon-btn" data-role="rerack" title="${t('new_game')}">↺</button>` : ''}
            <button type="button" class="p2-icon-btn" data-role="camera" title="${t('camera')}">🎥</button>
            <span class="p2-quit-confirm" data-role="quit-confirm" hidden>${t('quit_confirm')}</span>
            <button type="button" class="p2-icon-btn" data-role="quit" title="${t('quit')}">✕</button>
          </div>
        </div>
        <div class="p2-table-wrap" data-role="table-wrap">
          <canvas data-role="canvas"></canvas>
          <div class="p2-rail-glow p2-rail-near" data-role="rail-near"></div>
          <div class="p2-rail-glow p2-rail-far" data-role="rail-far"></div>
          <div class="p2-foul-slot" data-role="foul-slot"></div>
        </div>
        <div class="p2-controls">
          <div class="p2-spin-wrap">
            <div class="p2-spin-label">${t('spin')}</div>
            <canvas class="p2-spin" data-role="spin" width="72" height="72"></canvas>
          </div>
          <div class="p2-power-wrap">
            <div class="p2-power-label">${t('power')}</div>
            <div class="p2-power-meter"><div class="p2-power-fill" data-role="power-fill"></div></div>
          </div>
          <div class="p2-elev-wrap">
            <div class="p2-elev-label">${t('elevate_cue')}</div>
            <input type="range" min="0" max="28" value="0" data-role="elev" class="p2-elev-slider">
          </div>
        </div>
      </div>`;
    this.canvas = this.el.querySelector('[data-role="canvas"]');
    this.tableWrap = this.el.querySelector('[data-role="table-wrap"]');
    this.ctx = this.canvas.getContext('2d');
    this.spinCanvas = this.el.querySelector('[data-role="spin"]');
    this.spinCtx = this.spinCanvas.getContext('2d');
    this.el.querySelector('[data-role="quit"]').addEventListener('click', () => this._confirmQuit());
    this.el.querySelector('[data-role="camera"]').addEventListener('click', () => this._toggleCamera());
    const rerack = this.el.querySelector('[data-role="rerack"]');
    if (rerack) rerack.addEventListener('click', () => { this.game = rules.newGame(); this._resetCamera(); this._saveProgress(); this._drawFrame(); });
    this.el.querySelector('[data-role="elev"]').addEventListener('input', (e) => {
      this._elevation = (Number(e.target.value) || 0) * Math.PI / 180;
    });
    this._bindSpinPicker();
    this._bindTablePointer();
    window.addEventListener('resize', this._boundResize);
    document.addEventListener('visibilitychange', this._boundVis);
    // ResizeObserver, not just the window 'resize' event: a flex-layout settle,
    // a font swap, or an orientation change all resize .p2-table-wrap without
    // ever firing 'resize' on window, and the FIRST layout pass after mount is
    // exactly one of those (see _resizeCanvas's zero-size guard/retry below).
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this._resizeObserver.observe(this.tableWrap);
    }
    this._resizeCanvas();
    this._paintHud();
    this._drawSpin();
    this._startLoop();
    if (this.game && this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
    this._maybeDriveAiOrMp();
  }

  _toggleCamera() {
    this._camera = this._camera === 'top' ? 'behind' : 'top';
    this.tableWrap.classList.toggle('p2-camera-behind', this._camera === 'behind');
  }

  _resizeCanvas() {
    if (!this.canvas || this._dead) return;
    const rect = this.tableWrap.getBoundingClientRect();
    // The very first layout pass after mount can report a 0 (or near-0) box
    // before the flex chain has settled — computing _scale from that produces
    // garbage (this was the actual cause of the table rendering as a squeezed
    // strip / the rack rendering as an unscaled blob). Never commit a bogus
    // scale; retry next frame instead until a real size shows up.
    if (rect.width < 20 || rect.height < 20) {
      requestAnimationFrame(() => this._resizeCanvas());
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this._dpr = dpr;
    this._cw = rect.width; this._ch = rect.height;
    this._scale = Math.min(this._cw / TABLE.w, this._ch / TABLE.h) * 0.9;
    this._drawFrame();
  }

  // Pinch-zoom/pan (BUILD-SPEC.md §6 #10): _camZoom/_camPan fold in here, so every
  // existing caller of _toCanvas/_toWorld (drawing, aim, placement) automatically
  // respects the current view without its own zoom-awareness.
  _toCanvas(x, y) {
    const z = this._camZoom || 1;
    return { cx: this._cw / 2 + (x - this._camPan.x) * this._scale * z, cy: this._ch / 2 + (y - this._camPan.y) * this._scale * z };
  }
  _toWorld(cx, cy) {
    const z = this._camZoom || 1;
    return { x: (cx - this._cw / 2) / (this._scale * z) + this._camPan.x, y: (cy - this._ch / 2) / (this._scale * z) + this._camPan.y };
  }
  _resetCamera() { this._camZoom = 1; this._camPan = { x: 0, y: 0 }; }

  // ---- main loop --------------------------------------------------------
  _startLoop() {
    // A re-render mid-game (e.g. the language toggle re-mounting _renderGame, see
    // onLangChange above) must not leave the PREVIOUS loop running against a canvas
    // that's no longer in the DOM — cancel it before arming a new one.
    if (this._raf) cancelAnimationFrame(this._raf);
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
          this._simEvents.log.push(...ev.log);
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
    this._simEvents = { hits: [], rails: 0, pocketed: [], log: [] };
    return new Promise((resolve) => { this._simResolve = resolve; });
  }

  // ---- drawing ------------------------------------------------------------
  _drawFrame() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this._dpr, this._dpr);
    ctx.clearRect(0, 0, this._cw, this._ch);
    this._drawTable(ctx);
    if (this.game) this._drawBalls(ctx);
    if (this._aiming && !this._placingCue) this._drawAimLine(ctx);
    ctx.restore();
    this._paintPowerMeter();
  }

  _drawTable(ctx) {
    const hw = TABLE.w / 2, hh = TABLE.h / 2;
    const tl = this._toCanvas(-hw, -hh), br = this._toCanvas(hw, hh);
    ctx.fillStyle = '#0b3d2e';
    ctx.fillRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy);
    ctx.strokeStyle = '#3a2418';
    ctx.lineWidth = 14;
    ctx.strokeRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy);
    const z = this._camZoom || 1;
    for (const p of pocketCenters()) {
      const c = this._toCanvas(p.x, p.y);
      const pr = this._scale * z * R * 1.9;
      const grad = ctx.createRadialGradient(c.cx, c.cy, pr * 0.15, c.cx, c.cy, pr);
      grad.addColorStop(0, '#000');
      grad.addColorStop(0.7, '#0a0a0a');
      grad.addColorStop(1, '#2a2a2a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _legalNumbersForLocal() {
    if (!this.game || this.game.over || this.mode === 'practice') return [];
    const seat = this.game.turnSeat;
    if (!this._isMySeat(seat)) return [];
    const legal = rules.legalTarget(this.game, seat);
    return legal;
  }

  _drawBalls(ctx) {
    const legal = this._legalNumbersForLocal();
    const z = this._camZoom || 1;
    for (const b of this.game.balls) {
      if (b.pocketed) continue;
      const c = this._toCanvas(b.x, b.y);
      const rad = this._scale * z * R;
      const isLegal = legal && legal.kinds && (legal.kinds.indexOf(b.kind) >= 0 || (b.kind === 'eight' && legal.allowEight));
      if (isLegal) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, rad + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffce3a';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, rad, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (b.kind === 'cue') {
        ctx.fillStyle = '#f4f1e8';
        ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
      } else if (b.kind === 'eight') {
        ctx.fillStyle = '#111';
        ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
      } else if (b.kind === 'solid') {
        ctx.fillStyle = BALL_COLOR[b.number];
        ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
      } else {
        ctx.fillStyle = '#f4f1e8';
        ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
        ctx.fillStyle = BALL_COLOR[b.number];
        ctx.fillRect(c.cx - rad, c.cy - rad * 0.55, rad * 2, rad * 1.1);
      }
      // A soft highlight so balls read as spheres, not flat colored discs.
      const hg = ctx.createRadialGradient(
        c.cx - rad * 0.35, c.cy - rad * 0.4, rad * 0.05,
        c.cx - rad * 0.35, c.cy - rad * 0.4, rad * 1.3,
      );
      hg.addColorStop(0, 'rgba(255,255,255,0.55)');
      hg.addColorStop(0.35, 'rgba(255,255,255,0.12)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
      const sg = ctx.createRadialGradient(
        c.cx + rad * 0.4, c.cy + rad * 0.5, rad * 0.1,
        c.cx + rad * 0.4, c.cy + rad * 0.5, rad * 1.2,
      );
      sg.addColorStop(0, 'rgba(0,0,0,0.22)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(c.cx - rad, c.cy - rad, rad * 2, rad * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (b.kind !== 'cue') {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, rad * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#f4f1e8';
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = `bold ${Math.max(8, rad * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.number), c.cx, c.cy + 0.5);
      }
    }
  }

  _drawAimLine(ctx) {
    const cue = ballById(this.game.balls, 'cue');
    if (!cue || cue.pocketed) return;
    const c = this._toCanvas(cue.x, cue.y);
    const z = this._camZoom || 1;
    const dirx = Math.cos(this._aimAngle), diry = Math.sin(this._aimAngle);
    // Forward dashed guideline (the direction the cue ball will travel).
    const len = Math.max(this._cw, this._ch);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.cx + dirx * (this._scale * z * R + 4), c.cy + diry * (this._scale * z * R + 4));
    ctx.lineTo(c.cx + dirx * len, c.cy + diry * len);
    ctx.stroke();
    ctx.restore();
    // The cue stick itself, receding from the ball as power charges — the real
    // "you are now charging a shot" visual the dashed line alone can't give.
    const ballR = this._scale * z * R;
    const pullPx = Math.min(1, this._power / 4.2) * this._scale * z * 0.55;
    const tipGap = ballR + 5 + pullPx;
    const stickLen = this._scale * z * 0.7;
    const butt = tipGap + stickLen;
    ctx.save();
    ctx.strokeStyle = this._pulling ? '#e8d3a0' : 'rgba(232,211,160,0.55)';
    ctx.lineWidth = Math.max(2.5, this._scale * z * 0.018);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.cx - dirx * tipGap, c.cy - diry * tipGap);
    ctx.lineTo(c.cx - dirx * butt, c.cy - diry * butt);
    ctx.stroke();
    ctx.restore();
  }

  _drawSpin() {
    const ctx = this.spinCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, 72, 72);
    ctx.beginPath();
    ctx.arc(36, 36, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f1e8';
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 36); ctx.lineTo(66, 36);
    ctx.moveTo(36, 6); ctx.lineTo(36, 66);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();
    const px = 36 + this._offset.a * 26, py = 36 - this._offset.b * 26;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#E0532F';
    ctx.fill();
  }

  _paintPowerMeter() {
    const fill = this.el.querySelector('[data-role="power-fill"]');
    if (fill) fill.style.width = Math.min(100, (this._power / 4.2) * 100) + '%';
  }

  _paintHud() {
    const el = this.el.querySelector('[data-role="turn-text"]');
    if (!el || !this.game) return;
    if (this.mode === 'practice') { el.textContent = ''; return; }
    if (this.game.over) { el.textContent = ''; return; }
    const seat = this.game.turnSeat;
    if (this._isMySeat(seat)) el.textContent = this.game.ballInHand ? t('place_cue') : t('your_turn');
    else el.textContent = this.mode === 'ai' && this._aiThinking ? t('opp_thinking', { opp: this._oppName() }) : t('opp_turn', { opp: this._oppName() });
    const near = this.el.querySelector('[data-role="rail-near"]');
    const far = this.el.querySelector('[data-role="rail-far"]');
    if (near && far) {
      near.classList.toggle('is-lit', this._isMySeat(seat));
      far.classList.toggle('is-lit', !this._isMySeat(seat));
    }
    const slot = this.el.querySelector('[data-role="foul-slot"]');
    if (slot) {
      slot.innerHTML = this._foulMsg
        ? `<button type="button" class="p2-foul-icon" data-role="foul-explain" title="${t('foul')}">⚠</button>`
        : '';
      const btn = slot.querySelector('[data-role="foul-explain"]');
      if (btn) btn.addEventListener('click', () => this._showFoulToast());
    }
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
    let toast = slot.querySelector('.p2-foul-toast');
    if (toast) { toast.remove(); return; } // tap again to dismiss
    toast = document.createElement('div');
    toast.className = 'p2-foul-toast';
    toast.textContent = this._foulMsg;
    slot.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3200);
  }

  // ---- pointer input: aim / power / spin / elevation ----------------------
  _canShootNow() {
    return this.game && !this.game.over && this._isMySeat(this.game.turnSeat) && !this._simulating;
  }

  _bindSpinPicker() {
    const c = this.spinCanvas;
    let dragging = false;
    const setFromEvent = (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - 36, y = e.clientY - rect.top - 36;
      let a = x / 26, b = -y / 26;
      const mag = Math.sqrt(a * a + b * b);
      if (mag > 1) { a /= mag; b /= mag; }
      this._offset = { a, b };
      this._drawSpin();
    };
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      setFromEvent(e); // apply the visual update first: capture is a nice-to-have, never a prerequisite
      try { c.setPointerCapture(e.pointerId); } catch { /* invalid/synthetic pointer id: drag still works via move/up */ }
    });
    c.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    c.addEventListener('pointerup', () => { dragging = false; });
    c.addEventListener('dblclick', () => { this._offset = { a: 0, b: 0 }; this._drawSpin(); });
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
  // guide's "a second finger held down makes the drag much finer") — UNLESS
  // that second finger arrives before the FIRST one has committed to aiming,
  // in which case it's read as a pinch-zoom/pan gesture instead (BUILD-SPEC.md
  // §4 rule 6, §6 #10): see the PINCH_WINDOW_MS doc comment above.
  _bindTablePointer() {
    const c = this.canvas;
    let primaryId = null;
    let fineMode = false;
    // Pending-aim state: the brief window after the FIRST finger touches down,
    // during which a second finger still reads as "meant to pinch" rather than
    // "meant to fine-aim". primaryId stays null the whole time we're pending —
    // that's what lets a second finger arriving here fall into the pinch branch.
    let pendingId = null, pendingTimer = null, pendingCX = 0, pendingCY = 0;
    // Pinch/pan state, live only while exactly the two pointers below are down.
    let pinch = null; // { id1, id2, startDist, startMidCX, startMidCY, startZoom, startPanX, startPanY }

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
      const z = this._camZoom || 1;
      const DEADZONE_PX = this._scale * z * R * 1.4;
      const worldPull = Math.max(0, dist - DEADZONE_PX) / (this._scale * z);
      this._power = Math.max(0, Math.min(4.2, worldPull * 2.6));
      this._pulling = this._power > 0.05;
    };

    const commitAim = (pointerId, px, py) => {
      primaryId = pointerId;
      this._aiming = true;
      this._power = 0;
      this._pulling = false;
      updateAimPower(px, py);
    };
    const clearPending = () => { if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = null; pendingId = null; };

    const dist2 = (p1, p2) => Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
    const mid2 = (p1, p2) => ({ x: (p1.clientX + p2.clientX) / 2, y: (p1.clientY + p2.clientY) / 2 });
    const clampPan = () => {
      const z = this._camZoom;
      const maxX = Math.max(0, (TABLE.w / 2) * (1 - 1 / z) + TABLE.w * 0.15);
      const maxY = Math.max(0, (TABLE.h / 2) * (1 - 1 / z) + TABLE.h * 0.15);
      this._camPan.x = Math.max(-maxX, Math.min(maxX, this._camPan.x));
      this._camPan.y = Math.max(-maxY, Math.min(maxY, this._camPan.y));
    };
    const startPinch = () => {
      const pts = [...this._pointers.values()];
      if (pts.length < 2) return;
      const [p1, p2] = pts;
      const rect = c.getBoundingClientRect();
      const m = mid2(p1, p2);
      pinch = {
        id1: p1.pointerId, id2: p2.pointerId,
        startDist: dist2(p1, p2) || 1,
        startMidCX: m.x - rect.left, startMidCY: m.y - rect.top,
        startZoom: this._camZoom, startPanX: this._camPan.x, startPanY: this._camPan.y,
      };
    };
    const updatePinch = () => {
      const p1 = this._pointers.get(pinch.id1), p2 = this._pointers.get(pinch.id2);
      if (!p1 || !p2) return;
      const rect = c.getBoundingClientRect();
      const zoom = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, pinch.startZoom * ((dist2(p1, p2) || 1) / pinch.startDist)));
      const m = mid2(p1, p2);
      // Pan by the midpoint's screen delta, converted to world units at the
      // CURRENT zoom so panning tracks the fingers 1:1 regardless of zoom level.
      const dCX = (m.x - rect.left) - pinch.startMidCX, dCY = (m.y - rect.top) - pinch.startMidCY;
      this._camZoom = zoom;
      this._camPan = { x: pinch.startPanX - dCX / (this._scale * zoom), y: pinch.startPanY - dCY / (this._scale * zoom) };
      clampPan();
      this._drawFrame();
    };

    c.addEventListener('pointerdown', (e) => {
      if (!this.game || this.game.over) return;
      this._pointers.set(e.pointerId, e);
      const rect = c.getBoundingClientRect();
      if (this._placingCue) {
        if (primaryId === null) primaryId = e.pointerId;
        return;
      }
      if (pinch) return;
      if (this._pointers.size === 2 && primaryId === null) {
        // Two fingers with no committed aim yet: always the camera gesture,
        // whether or not it's my turn (BUILD-SPEC.md §4 rule 6's tiebreak).
        clearPending();
        startPinch();
        return;
      }
      if (!this._canShootNow()) return;
      if (primaryId === null) {
        pendingId = e.pointerId;
        pendingCX = e.clientX; pendingCY = e.clientY;
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (!this._pointers.has(pendingId)) return; // lifted before it fired
          commitAim(pendingId, px, py);
        }, PINCH_WINDOW_MS);
      } else if (this._pointers.size === 2) {
        fineMode = true;
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, e);
      const rect = c.getBoundingClientRect();
      if (pinch) { updatePinch(); return; }
      if (this._placingCue) {
        if (e.pointerId !== primaryId) return;
        const w = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
        this._tryPlaceCuePreview(w.x, w.y);
        return;
      }
      if (pendingTimer && e.pointerId === pendingId) {
        // A single finger that moves before the pinch window elapses was never
        // going to pinch (its partner never showed up) — commit aim right away
        // so ordinary aiming doesn't feel delayed.
        if (Math.hypot(e.clientX - pendingCX, e.clientY - pendingCY) > PENDING_MOVE_COMMIT_PX) {
          clearTimeout(pendingTimer); pendingTimer = null;
          commitAim(pendingId, e.clientX - rect.left, e.clientY - rect.top);
        }
        return;
      }
      if (e.pointerId !== primaryId || !this._aiming) return;
      updateAimPower(e.clientX - rect.left, e.clientY - rect.top);
    });

    const finish = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      if (pinch) {
        // Ends the moment either finger lifts; a fresh single-finger touch is
        // required to start aiming afterward (no fallthrough into aim/pull).
        if (e.pointerId === pinch.id1 || e.pointerId === pinch.id2) pinch = null;
        return;
      }
      if (pendingTimer && e.pointerId === pendingId) { clearPending(); return; }
      if (this._placingCue) {
        if (e.pointerId === primaryId) {
          const rect = c.getBoundingClientRect();
          const w = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
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

  _tryPlaceCuePreview(x, y) {
    // no persistent preview state needed beyond redraw; ghost cue follows pointer
    const cue = ballById(this.game.balls, 'cue');
    cue.x = Math.max(-TABLE.w / 2 + R, Math.min(TABLE.w / 2 - R, x));
    cue.y = Math.max(-TABLE.h / 2 + R, Math.min(TABLE.h / 2 - R, y));
  }

  _commitCuePlacement(x, y) {
    const cx = Math.max(-TABLE.w / 2 + R, Math.min(TABLE.w / 2 - R, x));
    const cy = Math.max(-TABLE.h / 2 + R, Math.min(TABLE.h / 2 - R, y));
    const overlaps = this.game.balls.some((b) => b.id !== 'cue' && !b.pocketed && Math.hypot(b.x - cx, b.y - cy) < 2 * R);
    if (overlaps) return; // refuses illegal spots on its own, per the build guide
    this.game = rules.placeCueBall(this.game, cx, cy);
    this._placingCue = false;
    // MP: placement travels as part of the NEXT move (see BUILD-SPEC §6 #1) so it can
    // never desync from the strike that follows it. Applied locally now (so the shooter
    // aims from the real spot); queued here so _mpLocalShoot can attach it to the move.
    if (this.mp) this.mp.pendingPlacement = { x: cx, y: cy };
    this._saveProgress();
  }

  async _commitShot(power) {
    if (!this._canShootNow()) return;
    const dir = { x: Math.cos(this._aimAngle), y: Math.sin(this._aimAngle) };
    const offset = { ...this._offset };
    const elevation = this._elevation;
    const seat = this.game.turnSeat;
    if (this.mp) {
      await this._mpLocalShoot(dir, power, offset, elevation);
    } else {
      const events = await this._runShot(dir, power, offset, elevation);
      this._settleLocal(events, seat);
    }
  }

  _settleLocal(events, seat) {
    if (this.mode === 'practice') {
      this._foulMsg = null;
      // Practice never runs rules.resolveShot, so the scratch scrub that un-pockets the
      // cue ball never runs either (BUILD-SPEC §6 #3). Handle it directly here: drop
      // straight into ball-in-hand placement rather than leaving the cue ball gone
      // until the whole table is re-racked.
      if (events.pocketed.indexOf('cue') >= 0) {
        const cue = ballById(this.game.balls, 'cue');
        if (cue) { cue.pocketed = false; cue.vx = 0; cue.vy = 0; cue.wx = 0; cue.wy = 0; cue.wz = 0; }
        this._placingCue = true;
      }
      this._paintHud();
      this._saveProgress();
      return;
    }
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
      recordResult('poolv2', this.settings.difficulty, iWon);
    } else if (this.mp) {
      recordResult('poolv2', 'mp', iWon);
      if (this.mp.opp) { try { recordHeadToHead('poolv2', this.mp.opp, iWon); } catch { /* never block the result */ } }
      // net.js's writeResult is deliberately NOT called here: it sets status:'ended',
      // which would kill the room this rematch series is hosted in. status:'ended'
      // means exactly one thing in this room now -- somebody left (see _confirmQuit /
      // the end-dialog's "new game" handler below) -- same convention as every other
      // MP-capable game in this repo (BUILD-SPEC.md §6 #7).
      this._mpAfterGameEnd();
    }
    clearKey(SAVE_KEY);
    this._showEndDialog(iWon);
  }

  _showEndDialog(iWon) {
    const dlg = document.createElement('div');
    dlg.className = 'p2-dialog-overlay';
    const isHost = !!(this.mp && this.mp.role === 'host');
    const seriesLine = this.mp ? `<p class="p2-series">${this._seriesLine()}</p>` : '';
    const actions = !this.mp
      ? `<button type="button" class="p2-btn p2-btn-primary" data-role="again">${t('play_again')}</button>
         <button type="button" class="p2-btn" data-role="new">${t('new_game')}</button>`
      : isHost
        ? `<button type="button" class="p2-btn p2-btn-primary" data-role="mp-next">${t('play_again')}</button>
           <button type="button" class="p2-btn" data-role="new">${t('new_game')}</button>`
        : `<p class="p2-mp-wait">${t('mp_waiting_rematch', { opp: this._oppName() })}</p>
           <button type="button" class="p2-btn" data-role="new">${t('new_game')}</button>`;
    dlg.innerHTML = `
      <div class="p2-dialog">
        <button type="button" class="p2-x" data-role="close" aria-label="${t('cancel')}">✕</button>
        <h2>${iWon ? t('you_win') : t('opp_wins', { opp: this._oppName() })}</h2>
        ${seriesLine}
        <div class="p2-actions">
          ${actions}
        </div>
      </div>`;
    dlg.querySelector('[data-role="close"]').addEventListener('click', () => dlg.remove());
    const again = dlg.querySelector('[data-role="again"]');
    if (again) again.addEventListener('click', () => { dlg.remove(); this._startLocalGame(); });
    const mpNext = dlg.querySelector('[data-role="mp-next"]');
    if (mpNext) mpNext.addEventListener('click', () => { dlg.remove(); this._mpStartNextGameSeries(); });
    dlg.querySelector('[data-role="new"]').addEventListener('click', () => {
      dlg.remove();
      if (this.mp && this.mp.code) net.leaveRoom(this.mp.code, this.mp.role).catch(() => {});
      clearKey(MP_SAVE_KEY);
      this.mp = null; this.view = 'setup'; this.render();
    });
    this.el.appendChild(dlg);
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
    const shot = await this._chooseShotOffThread(this.game, seat, this.settings.difficulty);
    this._aiThinking = false;
    if (this._dead || !this.game || this.game.over || this.game.turnSeat !== seat) return;
    if (!shot) return;
    const events = await this._runShot(shot.dir, shot.power, shot.offset, shot.elevation);
    this._settleLocal(events, seat);
  }

  _aiPlacementSpot() {
    const candidates = [];
    for (let gx = -0.4; gx <= 0.4; gx += 0.08) {
      for (let gy = -0.85; gy <= 0.85; gy += 0.12) candidates.push({ x: gx, y: gy });
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
    const res = await net.createRoom('poolv2', {}, this._myIdentity());
    if (res.error) { if (status) status.textContent = res.error === 'offline' ? t('online_offline') : t('room_full'); return; }
    this.mp = {
      role: 'host', code: res.code, localSeat: 0, opp: null,
      appliedSeq: 0, movesById: new Map(), maxKnownSeq: 0, delivering: false,
      awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false, pendingPlacement: null,
      // Rematch series (BUILD-SPEC.md §6 #7, ported from Mancala): gameNum tracks
      // which round.n this device is on; nextDealer alternates who breaks each game
      // (host-only, flipped in _mpStartNextGameSeries); series is the seat-indexed
      // win tally, NEVER device-relative; lastScoredGame guards _mpAfterGameEnd so a
      // re-render/recovery can never double-count the same game's result.
      gameNum: 0, nextDealer: 0, series: { wins: [0, 0] }, lastScoredGame: 0,
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
      awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false, pendingPlacement: null,
      gameNum: 0, nextDealer: 0, series: { wins: [0, 0] }, lastScoredGame: 0,
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
        awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false, pendingPlacement: null,
        // Series tally/round bookkeeping is carried through UNTOUCHED from the save,
        // never reset here (see js/CLAUDE.md's rematch-series invariant: a restore
        // that reset this to {wins:[0,0]} would silently erase the series the
        // moment either device backgrounds and restores mid-series).
        gameNum: save.gameNum | 0, nextDealer: save.nextDealer === 1 ? 1 : 0,
        series: this._mpNormalizeSeries(save.series), lastScoredGame: save.lastScoredGame | 0,
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
    // Host starts round 1 the first time both seats are present, via the same path
    // a rematch uses (mp.nextDealer starts at 0, so game 1 opens with the host, same
    // as the single-game behavior this replaces).
    if (mp.role === 'host' && !room.round && room.guest && !mp.starting) {
      mp.starting = true;
      this._mpStartNextGameSeries();
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
    this._foulMsg = null;
    this._resetCamera();
    this.view = 'game';
    this.render();
  }

  /** Host only: publish the next game of the series (round.n + 1) and start it
   *  locally. Sides stay fixed for the whole room (host is always seat 0, guest
   *  always seat 1); only who BREAKS alternates, carried across games (and across a
   *  host restore, via _mpSnapshot/_mpSaveProgress) by mp.nextDealer. BUILD-SPEC.md
   *  §6 #7, ported from mancala/js/ui.js's _mpStartNextGame. */
  async _mpStartNextGameSeries() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const dealer = mp.nextDealer === 1 ? 1 : 0;
    mp.nextDealer = dealer === 0 ? 1 : 0;
    // Publish BEFORE applying locally: startRound clears the room's move log, so a
    // very fast local action could otherwise be written and then wiped by our own
    // publish (same reasoning as tic-tac-toe/mancala's _mpStartNextGame).
    try { await net.startRound(mp.code, n, null, dealer); }
    catch { /* connection issue surfaces via the room callback/status, same as elsewhere */ }
    if (this._dead || !this.mp) return;
    // The room update carrying our own record may have raced us here and already
    // applied it; never rebuild a game that has begun.
    if ((this.mp.gameNum | 0) < n) this._mpApplyRoundRecord({ n, dealer }, null);
  }

  /** Series bookkeeping at the end of one game, MP only. Idempotent per game number
   *  (lastScoredGame): _onGameOver can run more than once for the same game across a
   *  recovery/re-render. Poolv2's rules.js never produces a draw (the 8-ball always
   *  has a winner), so unlike Mancala/Tic Tac Toe there is no draws counter. */
  _mpAfterGameEnd() {
    const mp = this.mp;
    if (!mp || !this.game || !this.game.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (this.game.winner != null) mp.series.wins[this.game.winner] += 1;
    this._mpSaveProgress();
  }

  /** The running series tally, MP only. Read by SEAT so each device sees its own
   *  record first -- the stored counters are seat-indexed, never device-relative. */
  _seriesLine() {
    const mp = this.mp;
    if (!mp) return '';
    return t('mp_series', {
      me: mp.series.wins[this._localSeat()] | 0,
      them: mp.series.wins[this._oppSeat()] | 0,
      opp: this._oppName(),
    });
  }

  /** Normalize a transmitted/restored series tally to the shape mp.series always
   *  holds -- same defensive shape as the reference games' _mpNormalizeSeries. */
  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [w[0] | 0, w[1] | 0] };
  }

  _mpSnapshot() {
    return {
      balls: this.game.balls, rules: { ...this.game, balls: undefined },
      // Series bookkeeping rides along with every recovery snapshot so a guest that
      // resyncs mid-series never loses its place in the rematch (BUILD-SPEC §6 #7).
      gameNum: this.mp.gameNum, nextDealer: this.mp.nextDealer,
      series: { wins: this.mp.series.wins.slice() }, lastScoredGame: this.mp.lastScoredGame,
    };
  }

  _mpApplyRecovery(recovery) {
    const snap = recovery.state;
    this.game = { ...snap.rules, balls: snap.balls.map((b) => ({ ...b })) };
    this.mp.appliedSeq = recovery.seq | 0;
    this.mp.maxKnownSeq = Math.max(this.mp.maxKnownSeq | 0, this.mp.appliedSeq);
    this.mp.awaitingRecovery = false;
    this.mp.recoveryAttempts = 0;
    if (snap.gameNum != null) this.mp.gameNum = snap.gameNum | 0;
    if (snap.nextDealer != null) this.mp.nextDealer = snap.nextDealer === 1 ? 1 : 0;
    if (snap.series) this.mp.series = this._mpNormalizeSeries(snap.series);
    if (snap.lastScoredGame != null) this.mp.lastScoredGame = snap.lastScoredGame | 0;
    this.render();
    net.clearRecovery(this.mp.code).catch(() => {});
    if (this.game.over) this._onGameOver(this.game.turnSeat, null);
  }

  async _mpLocalShoot(dir, power, offset, elevation) {
    const mp = this.mp;
    const seat = this.game.turnSeat;
    // Placement (if any) was already applied locally by _commitCuePlacement; it rides
    // along with this move so the peer applies it before re-running the strike (BUILD-SPEC
    // §6 #1 — placement and strike must never be able to desync from each other).
    const place = mp.pendingPlacement || null;
    mp.pendingPlacement = null;
    const events = await this._runShot(dir, power, offset, elevation);
    const { state, outcome } = rules.resolveShot(this.game, events);
    this.game = state;
    this._applyOutcomeUi(outcome, seat);
    const h = stateHash(this.game);
    const seq = ++mp.appliedSeq;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq, seq);
    this._mpSaveProgress();
    net.appendMove(mp.code, mp.role, seq, { g: mp.gameNum, dir, power, offset, elevation, place }, h).catch(() => {});
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
    // Apply the peer's cue-ball placement (if this shot followed a foul) BEFORE
    // re-running the strike, exactly as the shooter's own device did (BUILD-SPEC §6 #1).
    if (move.place) this.game = rules.placeCueBall(this.game, move.place.x, move.place.y);
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
    writeJSON(MP_SAVE_KEY, {
      role: this.mp.role, code: this.mp.code, seq: this.mp.appliedSeq, game: this.game,
      gameNum: this.mp.gameNum, nextDealer: this.mp.nextDealer,
      series: { wins: this.mp.series.wins.slice() }, lastScoredGame: this.mp.lastScoredGame,
    });
  }
}

let instance = null;
export function init(container) { instance = new PoolUI(container); }
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
export function isInProgress() { return instance ? instance.isInProgress() : false; }
export default { init, destroy, isInProgress };
