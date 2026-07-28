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
import { R, TABLE, strikeCueBall, tick, isMoving, pocketCenters } from './physics.js';
import { ballById } from './table.js';
import * as rules from './rules.js';
import { chooseShot } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.pool.v1';
const SAVE_KEY = 'gamehub.pool.save.v1';
const MP_SAVE_KEY = 'gamehub.pool.mp.v1';
const MP_RECOVERY_MAX_ATTEMPTS = 3;

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
    this._placingCue = false;
    this._foulMsg = null;
    this._boundResize = () => this._resizeCanvas();
    this._boundVis = () => { if (document.hidden) this._syncNothingSpecial(); };
    this._tryAutoResume();
    this.render();
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
    window.removeEventListener('resize', this._boundResize);
    document.removeEventListener('visibilitychange', this._boundVis);
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
    this.el.innerHTML = `
      <div class="pl-game">
        <div class="pl-hud">
          <div class="pl-hud-left">
            <span class="pl-turn-text" data-role="turn-text"></span>
          </div>
          <div class="pl-hud-right">
            ${this.mode === 'practice' ? `<button type="button" class="pl-icon-btn" data-role="rerack" title="${t('new_game')}">↺</button>` : ''}
            <button type="button" class="pl-icon-btn" data-role="camera" title="${t('camera')}">🎥</button>
            <button type="button" class="pl-icon-btn" data-role="quit" title="${t('quit')}">✕</button>
          </div>
        </div>
        <div class="pl-table-wrap" data-role="table-wrap">
          <canvas data-role="canvas"></canvas>
          <div class="pl-rail-glow pl-rail-near" data-role="rail-near"></div>
          <div class="pl-rail-glow pl-rail-far" data-role="rail-far"></div>
          <div class="pl-foul-slot" data-role="foul-slot"></div>
        </div>
        <div class="pl-controls">
          <div class="pl-spin-wrap">
            <div class="pl-spin-label">${t('spin')}</div>
            <canvas class="pl-spin" data-role="spin" width="72" height="72"></canvas>
          </div>
          <div class="pl-power-wrap">
            <div class="pl-power-label">${t('power')}</div>
            <div class="pl-power-meter"><div class="pl-power-fill" data-role="power-fill"></div></div>
          </div>
          <div class="pl-elev-wrap">
            <div class="pl-elev-label">${t('elevate_cue')}</div>
            <input type="range" min="0" max="45" value="0" data-role="elev" class="pl-elev-slider">
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
    if (rerack) rerack.addEventListener('click', () => { this.game = rules.newGame(); this._saveProgress(); this._drawFrame(); });
    this.el.querySelector('[data-role="elev"]').addEventListener('input', (e) => {
      this._elevation = (Number(e.target.value) || 0) * Math.PI / 180;
    });
    this._bindSpinPicker();
    this._bindTablePointer();
    window.addEventListener('resize', this._boundResize);
    document.addEventListener('visibilitychange', this._boundVis);
    this._resizeCanvas();
    this._paintHud();
    this._drawSpin();
    this._startLoop();
    if (this.game && this.game.ballInHand && this._isMySeat(this.game.turnSeat)) this._placingCue = true;
    this._maybeDriveAiOrMp();
  }

  _toggleCamera() {
    this._camera = this._camera === 'top' ? 'behind' : 'top';
    this.tableWrap.classList.toggle('pl-camera-behind', this._camera === 'behind');
  }

  _resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.tableWrap.getBoundingClientRect();
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

  _toCanvas(x, y) { return { cx: this._cw / 2 + x * this._scale, cy: this._ch / 2 + y * this._scale }; }
  _toWorld(cx, cy) { return { x: (cx - this._cw / 2) / this._scale, y: (cy - this._ch / 2) / this._scale }; }

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
    ctx.fillStyle = '#111';
    for (const p of pocketCenters()) {
      const c = this._toCanvas(p.x, p.y);
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, this._scale * R * 1.9, 0, Math.PI * 2);
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
    for (const b of this.game.balls) {
      if (b.pocketed) continue;
      const c = this._toCanvas(b.x, b.y);
      const rad = this._scale * R;
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
    const len = Math.max(this._cw, this._ch);
    const ex = c.cx + Math.cos(this._aimAngle) * len;
    const ey = c.cy + Math.sin(this._aimAngle) * len;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.cx, c.cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
    if (this._pulling) {
      const pull = this._power / 4.2 * this._scale * 0.35;
      ctx.save();
      ctx.strokeStyle = '#ffce3a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(c.cx - Math.cos(this._aimAngle) * (this._scale * R + 6), c.cy - Math.sin(this._aimAngle) * (this._scale * R + 6));
      ctx.lineTo(c.cx - Math.cos(this._aimAngle) * (this._scale * R + 6 + pull), c.cy - Math.sin(this._aimAngle) * (this._scale * R + 6 + pull));
      ctx.stroke();
      ctx.restore();
    }
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
    if (this._foulMsg) {
      const slot = this.el.querySelector('[data-role="foul-slot"]');
      if (slot) {
        slot.innerHTML = `<button type="button" class="pl-foul-icon" data-role="foul-explain" title="${t('foul')}">⚠</button>`;
        slot.querySelector('[data-role="foul-explain"]').addEventListener('click', () => alert(this._foulMsg));
      }
    }
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
    c.addEventListener('pointerdown', (e) => { dragging = true; c.setPointerCapture(e.pointerId); setFromEvent(e); });
    c.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    c.addEventListener('pointerup', () => { dragging = false; });
    c.addEventListener('dblclick', () => { this._offset = { a: 0, b: 0 }; this._drawSpin(); });
  }

  _bindTablePointer() {
    const c = this.canvas;
    let primaryId = null;
    let fineMode = false;
    let lastAngle = 0;
    let pullStart = null;

    const angleTo = (wx, wy, cue) => Math.atan2(cue.y - wy, cue.x - wx);

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
        const cue = ballById(this.game.balls, 'cue');
        const rect = c.getBoundingClientRect();
        const w = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
        this._aimAngle = angleTo(w.x, w.y, cue);
        lastAngle = this._aimAngle;
        this._aiming = true;
        this._pulling = false;
        this._power = 0;
        pullStart = null;
      } else if (this._pointers.size === 2) {
        fineMode = true;
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, e);
      if (this._placingCue) {
        if (e.pointerId !== primaryId) return;
        const rect = c.getBoundingClientRect();
        const w = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
        this._tryPlaceCuePreview(w.x, w.y);
        return;
      }
      if (e.pointerId !== primaryId || !this._aiming) return;
      const cue = ballById(this.game.balls, 'cue');
      const rect = c.getBoundingClientRect();
      const w = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (!this._pulling) {
        const rawAngle = angleTo(w.x, w.y, cue);
        if (fineMode) {
          let delta = rawAngle - lastAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          this._aimAngle += delta * 0.22;
        } else {
          this._aimAngle = rawAngle;
        }
        lastAngle = rawAngle;
      } else {
        // Power pull: distance from pull-start along the aim axis; large sideways
        // deviation cancels the shot instead of firing it (build guide's rule).
        const cuec = this._toCanvas(cue.x, cue.y);
        const dx = e.clientX - rect.left - pullStart.cx, dy = e.clientY - rect.top - pullStart.cy;
        const along = dx * -Math.cos(this._aimAngle) + dy * -Math.sin(this._aimAngle);
        const perp = Math.abs(dx * -Math.sin(this._aimAngle) - dy * Math.cos(this._aimAngle));
        if (perp > 46) { this._pulling = false; this._power = 0; this._aiming = true; return; }
        this._power = Math.max(0, Math.min(4.2, along / this._scale * 3.2));
      }
    });

    const finish = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
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
      if (!this._pulling && this._aiming) {
        // First release after aiming: arm the power-pull phase instead of firing.
        const rect = c.getBoundingClientRect();
        pullStart = { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
        this._pulling = true;
        this._pointers.set(e.pointerId, e);
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (this._pulling && this._power > 0.15) this._commitShot();
      this._aiming = false; this._pulling = false; this._power = 0; primaryId = null; fineMode = false;
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
    this._saveProgress();
  }

  async _commitShot() {
    if (!this._canShootNow()) return;
    const dir = { x: Math.cos(this._aimAngle), y: Math.sin(this._aimAngle) };
    const power = this._power;
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

  _showEndDialog(iWon) {
    const dlg = document.createElement('div');
    dlg.className = 'pl-dialog-overlay';
    dlg.innerHTML = `
      <div class="pl-dialog">
        <button type="button" class="pl-x" data-role="close" aria-label="${t('cancel')}">✕</button>
        <h2>${iWon ? t('you_win') : t('opp_wins', { opp: this._oppName() })}</h2>
        <div class="pl-actions">
          ${this.mp ? '' : `<button type="button" class="pl-btn pl-btn-primary" data-role="again">${t('play_again')}</button>`}
          <button type="button" class="pl-btn" data-role="new">${t('new_game')}</button>
        </div>
      </div>`;
    dlg.querySelector('[data-role="close"]').addEventListener('click', () => dlg.remove());
    const again = dlg.querySelector('[data-role="again"]');
    if (again) again.addEventListener('click', () => { dlg.remove(); this._startLocalGame(); });
    dlg.querySelector('[data-role="new"]').addEventListener('click', () => { dlg.remove(); this.view = 'setup'; this.mp = null; this.render(); });
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
    if (btn) { btn.title = t('quit_confirm'); btn.classList.add('is-confirm'); }
    setTimeout(() => { this._quitArmed = false; if (btn) btn.classList.remove('is-confirm'); }, 3500);
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
