// baseball/js/ui.js - phase 3 (BB-3): the real play screen. Quick Play only: pick a league, play a
// full three-inning game against one CPU team, batting and pitching both real, through the actual
// engine (`js/engine/`). No career, no stats recording, no leaderboard - see baseball/CLAUDE.md.
//
// Module contract (docs/BUILDING-A-GAME.md, "Part 1 - Building a game"): init/destroy/isInProgress.

import { makeT } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { isDevProfile } from '../../js/challenge/hooks.js';
import { STRINGS } from './strings.js';

import * as SETTINGS from './engine/settings.js';
import { Game } from './engine/game.js';
import { CpuPitcher, CpuBatter } from './engine/agents.js';
import { makeLeague, makePlayerTeam } from './engine/teams.js';
import { drawField, drawBall, drawLandingMarker, project } from './field.js';
import { drawRingState, RING_D, BTN_D, NICE_CENTER, NICE_HALF } from './ring.js';

const t = makeT(STRINGS);

/** Idempotently ensure this module's stylesheets are on the page (hub or standalone) - the hub
 *  shell does not preload a game's own CSS, same as every other in-hub module (escoba/js/ui.js's
 *  own ensureStylesheet is the reference). css/ui.css is `.gh-*` primitives (segmented control,
 *  buttons) this screen's setup/end-modal chrome is built on. */
function ensureCSS() {
  const want = [
    { href: new URL('../../css/ui.css', import.meta.url).href },
    { href: new URL('../css/baseball.css', import.meta.url).href },
  ];
  for (const { href } of want) {
    const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href);
    if (present) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

// ---------------------------------------------------------------------------------------------
// Fixed geometry (the handoff's own table). Nothing here may move between batting and pitching -
// only labels/contents change.
const HUD_H = 48;
const STRIP_H = 108;
const CONTROL_H = 172;
const FIELD_FLOOR_FRAC = 0.28;

const BETWEEN_MS = SETTINGS.FEEL.ui.betweenMs;
const WINDUP_MS = SETTINGS.FEEL.ui.windupMs;
const RESULT_MS = SETTINGS.FEEL.ui.resultMs;

const LEAGUE_ORDER = SETTINGS.LEAGUES;

let root = null;

export default { init, destroy, isInProgress };

export function init(el) {
  // Idempotency guard: a container already holding a live instance (e.g. init() called twice
  // before the first destroy(), such as a fast double-tap on the launcher tile) must not stack a
  // second .bb-root on top of the first - a real device screenshot showed exactly that ghosting
  // (a stale, differently-sized control band showing through the current one).
  if (el._bbInstance) el._bbInstance.destroy();
  root = el;
  const game = new BaseballPlayScreen(el);
  root._bbInstance = game;
}

export function destroy() {
  if (root && root._bbInstance) root._bbInstance.destroy();
  if (root) root.innerHTML = '';
  root = null;
}

/** Career autosave arrives in phase 4 - a Quick Play game that is force-quit mid-play is simply
 *  lost today, same as any other unsaved arcade round in this repo. */
export function isInProgress() {
  return false;
}

// ---------------------------------------------------------------------------------------------

function randPick(arr, rand = Math.random) { return arr[Math.floor(rand() * arr.length)]; }

class BaseballPlayScreen {
  constructor(container) {
    this.container = container;
    this.destroyed = false;
    this.screen = 'setup'; // setup | play | end
    this.league = 'college';
    this.dev = isDevProfile();

    ensureCSS();

    // Golf's own reference pattern (golf/js/ui.js's `_fitInsets`): the hub's floating immersive
    // back pill is `position: absolute` OVER this game, not reserving layout space for it, and
    // `.bb-root` is itself `position: fixed`, which ignores `.hub-main-immersive`'s own top
    // padding entirely (that padding only helps a normally-flowed root). So the HUD's top
    // clearance has to be measured against the pill directly, every fit, or it collides with the
    // status bar and the pill exactly as a real-device screenshot showed on 2026-09-14.
    this.inHub = !!container.closest('.hub-game');

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'bb-root';
    container.appendChild(this.rootEl);

    this.offViewport = onViewportResize(() => this._fit());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this._fit());
      this.ro.observe(container);
      if (container.parentElement) this.ro.observe(container.parentElement);
    }
    this._onVis = () => { if (document.visibilityState === 'visible') this._fit(); };
    document.addEventListener('visibilitychange', this._onVis);

    // Rapid-tap cure (Hill Climb's own fix, root CLAUDE.md's Part 0 "iOS rapid-tap cure"): block
    // the double-tap select gesture at the source rather than fight it after the fact.
    this._onSelectStart = (e) => e.preventDefault();
    this.rootEl.addEventListener('selectstart', this._onSelectStart);
    this.rootEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this._renderSetup();
    this._fit();
    requestAnimationFrame(() => this._fit());
  }

  destroy() {
    this.destroyed = true;
    if (this.offViewport) this.offViewport();
    if (this.ro) this.ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._onWindowPointerUp) window.removeEventListener('pointerup', this._onWindowPointerUp);
    if (this._rafBall) cancelAnimationFrame(this._rafBall);
    if (this._pitchRaf) cancelAnimationFrame(this._pitchRaf);
    if (this._safeAreaProbe) { this._safeAreaProbe.remove(); this._safeAreaProbe = null; }
    if (this.gameAbort) this.gameAbort();
  }

  _fit() {
    if (this.destroyed || !this.rootEl) return;
    this._fitInsets();
    const el = this.rootEl;
    el.style.height = '';
    const rect = el.getBoundingClientRect();
    const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const top = rect.top;
    let h = Math.max(320, Math.round(vh - top));
    el.style.height = h + 'px';
    if (this._sizeCanvas) this._sizeCanvas();
  }

  /** Measure the hub's own floating immersive back pill (`.hub-back`) and reserve exactly enough
   *  top clearance to clear it - golf's own `_fitInsets` pattern. Because `.bb-root` is `position:
   *  fixed`, `.hub-main-immersive`'s CSS padding never reaches it, so this has to be a real
   *  measurement rather than a hardcoded constant: absent, hidden or clear of us, the pad is 0. */
  _fitInsets() {
    if (!this.rootEl) return;
    const r = this.rootEl.getBoundingClientRect();
    let pad = 0;
    if (this.inHub) {
      const back = document.querySelector('.hub-back');
      if (back && back.offsetParent !== null) {
        const b = back.getBoundingClientRect();
        if (b.bottom > r.top && b.right > r.left && b.left < r.right) pad = Math.ceil(b.bottom - r.top) + 6;
      }
    } else {
      // Standalone: no hub chrome to clear, but the device's own status bar/notch still needs
      // clearance. env(safe-area-inset-top) can't be read directly in JS, so it's measured off a
      // one-off probe element - the same trick because a CSS-only padding here would double-count
      // against the hub-back measurement above on devices where both apply.
      if (!this._safeAreaProbe) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top, 0px);pointer-events:none;visibility:hidden;';
        document.body.appendChild(probe);
        this._safeAreaProbe = probe;
      }
      pad = Math.ceil(parseFloat(getComputedStyle(this._safeAreaProbe).paddingTop) || 0);
    }
    this.rootEl.style.setProperty('--bb-top-pad', Math.max(0, pad) + 'px');
  }

  // -------------------------------------------------------------------------------- setup screen
  _renderSetup() {
    this.rootEl.innerHTML = `
      <div class="bb-setup">
        <h1 class="bb-setup-title">${t('title')}</h1>
        <div class="gh-seg bb-league-seg" role="radiogroup" aria-label="${t('setup_league')}">
          ${LEAGUE_ORDER.map((lg) => `
            <button type="button" class="gh-seg__item" data-league="${lg}" role="radio" aria-checked="${lg === this.league}" aria-pressed="${lg === this.league}">${t('league_' + lg)}</button>
          `).join('')}
        </div>
        <button type="button" class="gh-btn gh-btn--primary bb-play-btn" data-act="play">${t('setup_play')}</button>
        ${this.dev ? `<button type="button" class="bb-tune-open" data-act="tune">${t('tune_open')}</button>` : ''}
      </div>`;
    this.rootEl.querySelectorAll('[data-league]').forEach((b) => {
      b.addEventListener('click', () => {
        this.league = b.dataset.league;
        this.rootEl.querySelectorAll('[data-league]').forEach((x) => {
          const sel = x === b;
          x.setAttribute('aria-checked', sel ? 'true' : 'false');
          x.setAttribute('aria-pressed', sel ? 'true' : 'false');
        });
      });
    });
    this.rootEl.querySelector('[data-act="play"]').addEventListener('click', () => this._startGame());
    const tuneBtn = this.rootEl.querySelector('[data-act="tune"]');
    if (tuneBtn) tuneBtn.addEventListener('click', () => this._openTune());
  }

  // -------------------------------------------------------------------------------- game start
  _startGame() {
    const league = this.league;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const cpuLeague = makeLeague(league);
    const cpuTeam = randPick(cpuLeague);
    const skillIds = SETTINGS.SKILL_IDS;
    const preset = randPick(Object.values(SETTINGS.PRESETS));
    const hand = Math.random() < 0.5 ? 'R' : 'L';
    const playerTeam = makePlayerTeam({ skills: preset, hand });
    playerTeam.league = league;

    this.human = new HumanAgent(this, league);
    const agents = {
      away: this.human,
      home: {
        decidePitch: (v) => new CpuPitcher({ league, settings: SETTINGS, ladderOffset: cpuTeam.ladderOffset }).decidePitch(v),
        decideSwing: (v) => {
          const batter = cpuTeam.players.find((p) => p.id === v.batterId) || cpuTeam.players[0];
          return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS, styleId: cpuTeam.styleId, ladderOffset: cpuTeam.ladderOffset }).decideSwing(v);
        },
      },
    };

    this.game = new Game({ home: cpuTeam, away: playerTeam, seed, agents, settings: SETTINGS });
    this.cpuTeam = cpuTeam;
    this.playerTeam = playerTeam;
    this.state = {
      mode: 'batting', // 'batting' | 'pitching'
      selectedPitch: 'fastball',
      unlockedPitches: SETTINGS.unlockedPitchesFor(league, 0),
      line1: '', line2: '',
      lastPitches: [], // batting strip: last 8 of the at-bat
      recentPitches: [], // pitching strip: last 4
    };
    this.gameAbort = () => { if (this.game) this.game.abort(); };

    this.screen = 'play';
    this._renderPlay();
    this._fit();

    this.game.onEvent = (type, payload) => this._onEngineEvent(type, payload);
    this.game.playGame().then(() => {
      if (this.destroyed) return;
      this._showEndModal();
    });
  }

  // -------------------------------------------------------------------------------- play screen shell
  _renderPlay() {
    this.rootEl.innerHTML = `
      <div class="bb-play">
        <div class="bb-top-spacer" data-role="topspacer"></div>
        <div class="bb-hud" data-role="hud"></div>
        <div class="bb-field-wrap" data-role="fieldwrap">
          <canvas class="bb-field-canvas" data-role="canvas"></canvas>
          <div class="bb-lines">
            <div class="bb-line1" data-role="line1"></div>
            <div class="bb-line2" data-role="line2"></div>
          </div>
        </div>
        <div class="bb-strip" data-role="strip"></div>
        <div class="bb-control" data-role="control"></div>
      </div>
      ${this.inHub ? '' : `<button type="button" class="bb-back" data-act="back" aria-label="${t('back')}">&larr;</button>`}
    `;
    this.canvas = this.rootEl.querySelector('[data-role="canvas"]');
    this.ctx = this.canvas.getContext('2d');
    this._sizeCanvas = () => {
      const wrap = this.rootEl.querySelector('[data-role="fieldwrap"]');
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) { requestAnimationFrame(this._sizeCanvas); return; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._fieldW = r.width;
      this._fieldH = r.height;
      this._drawStaticField();
    };
    const backBtn = this.rootEl.querySelector('[data-act="back"]');
    if (backBtn) backBtn.addEventListener('click', () => this._confirmBack());
    this._paintHud();
    this._paintStrip();
    this._paintControl();
    requestAnimationFrame(() => { this._sizeCanvas(); });
  }

  _fenceFt() {
    return (SETTINGS.FIELD[this.league] || SETTINGS.FIELD.majors).fenceFt;
  }

  _drawStaticField() {
    if (!this.ctx || !this._fieldW) return;
    const dark = document.documentElement.classList.contains('gh-dark');
    drawField(this.ctx, this._fieldW, this._fieldH, this.league, this._fenceFt(), dark);
  }

  // -------------------------------------------------------------------------------- HUD
  _paintHud() {
    const hud = this.rootEl.querySelector('[data-role="hud"]');
    if (!hud || !this.game) return;
    const g = this.game;
    const battingSide = g.half === 'top' ? 'away' : 'home';
    const you = 'away';
    const arrow = g.half === 'top' ? '▲' : '▼';
    const battingId = g._currentBatterId ? g._currentBatterId(battingSide) : null;
    const battingTeam = g[battingSide];
    const batter = battingTeam && battingId ? battingTeam.players.find((p) => p.id === battingId) : null;
    hud.innerHTML = `
      <div class="bb-hud-score">
        <span class="bb-hud-team${you === 'away' ? ' is-you' : ''}">${t('you')}</span>
        <span class="bb-hud-runs">${g.score.away}</span>
        <span class="bb-hud-dash">-</span>
        <span class="bb-hud-runs">${g.score.home}</span>
        <span class="bb-hud-team">${t('cpu')}</span>
      </div>
      <div class="bb-hud-inning">${arrow} ${g.inning}</div>
      <div class="bb-hud-count">
        <span class="bb-dotrow" aria-label="balls">${dots(g.balls, 3, 'b')}</span>
        <span class="bb-dotrow" aria-label="strikes">${dots(g.strikes, 2, 's')}</span>
        <span class="bb-dotrow" aria-label="outs">${dots(g.outs, 2, 'o')}</span>
      </div>
      <div class="bb-hud-bases">${basesSvg(g.bases)}</div>
      <div class="bb-hud-batter">${batter ? '#' + batter.jersey + ' ' + batter.pos : ''}</div>
    `;
  }

  // -------------------------------------------------------------------------------- strip
  _paintStrip() {
    const strip = this.rootEl.querySelector('[data-role="strip"]');
    if (!strip) return;
    if (this.state.mode === 'pitching') {
      strip.innerHTML = `<div class="bb-strip-pitches">${
        this.state.unlockedPitches.map((p) => `
          <button type="button" class="bb-pitch-tile${p === this.state.selectedPitch ? ' is-sel' : ''}" data-pitch="${p}">
            <span class="bb-pitch-name">${t('pitch_' + p)}</span>
          </button>`).join('')
      }</div>`;
      strip.querySelectorAll('[data-pitch]').forEach((b) => {
        b.addEventListener('click', () => {
          this.state.selectedPitch = b.dataset.pitch;
          this._paintStrip();
        });
      });
    } else {
      const recent = this.state.lastPitches.slice(-8);
      strip.innerHTML = `<div class="bb-strip-history">${
        recent.map((p) => `<div class="bb-hist-chip ${p.isStrike ? 'is-strike' : 'is-ball'}">${t('pitch_' + p.type)} ${p.mph}</div>`).join('')
      }</div>`;
    }
  }

  // -------------------------------------------------------------------------------- control band
  _paintControl() {
    const control = this.rootEl.querySelector('[data-role="control"]');
    if (!control) return;
    control.innerHTML = `
      <div class="bb-pad" data-role="pad">
        <div class="bb-pad-zone"></div>
        <div class="bb-pad-sweet"></div>
        <div class="bb-pad-marker" data-role="padmarker"></div>
      </div>
      <div class="bb-actions">
        <button type="button" class="bb-slot" data-act="steal" disabled title="${t('locked')}">${t('act_steal')}</button>
        <button type="button" class="bb-slot" data-act="bunt" disabled title="${t('locked')}">${t('act_bunt')}</button>
        <button type="button" class="bb-slot" data-act="pickoff" disabled title="${t('locked')}">${t('act_pickoff')}</button>
      </div>
      <div class="bb-ringwrap" data-role="mainbtn" role="button" aria-label="${t('act_swing')}">
        <canvas data-role="ringcanvas" width="${RING_D}" height="${RING_D}"></canvas>
        <div class="bb-ring-label" data-role="ringlabel"></div>
      </div>
    `;
    this._bindControlInput();
    this._paintModeLabels();
    this._paintRing('idle', 0);
  }

  _paintModeLabels() {
    const label = this.rootEl.querySelector('[data-role="ringlabel"]');
    if (label) label.textContent = this.state.mode === 'pitching' ? t('act_pitch') : t('act_swing');
  }

  /** Redraw the Swing/Throw ring+button in one state - see ring.js's own header for why this is a
   *  single canvas rather than a CSS-colored button overlapping an SVG ring. */
  _paintRing(state, value) {
    const cv = this.rootEl.querySelector('[data-role="ringcanvas"]');
    if (!cv) return;
    drawRingState(cv, this.state.mode === 'pitching' ? 'throw' : 'swing', state, value);
  }

  _bindControlInput() {
    const pad = this.rootEl.querySelector('[data-role="pad"]');
    const mainBtn = this.rootEl.querySelector('[data-role="mainbtn"]');
    pad.style.touchAction = 'none';
    mainBtn.style.touchAction = 'none';

    // Pad: drag to choose lateral position (sweet spot / aim / steer), fraction of plate half-width.
    this.padX = 0;
    const setPadFromEvent = (clientX) => {
      const r = pad.getBoundingClientRect();
      const frac = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1));
      this.padX = frac;
      const marker = this.rootEl.querySelector('[data-role="padmarker"]');
      if (marker) marker.style.left = (50 + frac * 45) + '%';
      if (this._onPadMove) this._onPadMove(frac);
    };
    let padDown = false;
    const padStart = (clientX) => { padDown = true; setPadFromEvent(clientX); };
    const padMove = (clientX) => { if (padDown) setPadFromEvent(clientX); };
    const padEnd = () => { padDown = false; };
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); padStart(e.touches[0].clientX); }, { passive: false });
    pad.addEventListener('touchmove', (e) => { e.preventDefault(); padMove(e.touches[0].clientX); }, { passive: false });
    pad.addEventListener('touchend', (e) => { e.preventDefault(); padEnd(); });
    pad.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; padStart(e.clientX); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; padMove(e.clientX); });
    this._onWindowPointerUp = (e) => { if (e.pointerType === 'touch') return; padEnd(); };
    window.addEventListener('pointerup', this._onWindowPointerUp);
    setPadFromEvent(pad.getBoundingClientRect().left + pad.getBoundingClientRect().width / 2);

    // Main button: Hill Climb's rapid-tap cure, verbatim shape - non-passive touchstart, touch
    // drives it directly, pointer events ignore pointerType==='touch'.
    let holdStart = null;
    const onDown = () => {
      holdStart = performance.now();
      mainBtn.classList.add('is-down');
      if (this._onMainDown) this._onMainDown();
    };
    const onUp = () => {
      const heldMs = holdStart != null ? performance.now() - holdStart : 0;
      holdStart = null;
      mainBtn.classList.remove('is-down');
      if (this._onMainUp) this._onMainUp(heldMs);
    };
    mainBtn.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    mainBtn.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); });
    mainBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); onUp(); });
    mainBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; onDown(); });
    mainBtn.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') return; onUp(); });
  }

  // -------------------------------------------------------------------------------- engine glue
  async _onEngineEvent(type, payload) {
    if (this.destroyed) return;
    if (type === 'halfInningStart') {
      this.state.mode = this.game.half === 'top' ? 'batting' : 'pitching';
      this.state.lastPitches = [];
      this._paintHud(); this._paintStrip(); this._paintModeLabels();
    } else if (type === 'atBatStart') {
      this._paintHud();
    } else if (type === 'count') {
      this._paintHud();
    } else if (type === 'pitch') {
      // Handled inline by HumanAgent while the ball is in flight (it owns the visual).
    } else if (type === 'atBatEnd') {
      this._paintHud();
      await this._settleAtBat(payload);
    } else if (type === 'halfInningEnd') {
      this._setLine1(t('half_end'));
      await sleep(BETWEEN_MS);
      this._setLine1(''); this._setLine2('');
    } else if (type === 'gameEnd') {
      // handled by the playGame().then() in _startGame
    }
  }

  _setLine1(text) { const el = this.rootEl.querySelector('[data-role="line1"]'); if (el) el.textContent = text; }
  _setLine2(text) { const el = this.rootEl.querySelector('[data-role="line2"]'); if (el) el.textContent = text; }

  async _settleAtBat(payload) {
    const outKind = payload.outcome;
    let word = t('res_' + outcomeWord(outKind));
    this._setLine1(word);
    if (payload.distanceFt != null && payload.sprayAngleDeg != null) {
      const isOut = /out$/.test(outKind) || outKind === 'strikeout';
      const isHr = outKind === 'homer';
      const rad = (payload.sprayAngleDeg * Math.PI) / 180;
      const xFt = Math.sin(rad) * payload.distanceFt;
      const yFt = Math.cos(rad) * payload.distanceFt;
      await this._animateBattedBall(xFt, yFt, isOut ? 'out' : (isHr ? 'hr' : 'hit'), basesLabel(payload.bases));
    }
    await sleep(RESULT_MS);
    this._setLine1(''); this._setLine2('');
  }

  _animateBattedBall(xFt, yFt, kind, label) {
    return new Promise((resolve) => {
      const dur = 700;
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        this._drawStaticField();
        drawBall(this.ctx, this._fieldW, this._fieldH, xFt * frac, yFt * frac, { baseRadius: 7 });
        if (frac < 1) {
          this._rafBall = requestAnimationFrame(step);
        } else {
          drawLandingMarker(this.ctx, this._fieldW, this._fieldH, xFt, yFt, kind, label, document.documentElement.classList.contains('gh-dark'));
          resolve();
        }
      };
      this._rafBall = requestAnimationFrame(step);
    });
  }

  _animatePitchFlight(pitchResult) {
    return new Promise((resolve) => {
      const dur = pitchResult.timeToPlateS * 1000;
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        const yFt = 60.5 * (1 - frac);
        const xFt = pitchResult.x * 8.5 * frac; // spread from center-line toward final x near the plate
        this._drawStaticField();
        drawBall(this.ctx, this._fieldW, this._fieldH, xFt, yFt, { baseRadius: 6 });
        if (frac < 1) {
          this._pitchRaf = requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      this._pitchRaf = requestAnimationFrame(step);
    });
  }

  async _confirmBack() {
    if (this.screen === 'play') {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(t('confirm_forfeit'));
      if (!ok) return;
    }
    if (this.game) this.game.abort();
    this._backToLauncher();
  }

  _backToLauncher() {
    window.dispatchEvent(new CustomEvent('gamehub:backtolauncher'));
    if (window.history.length > 1) window.history.back();
  }

  // -------------------------------------------------------------------------------- end modal
  _showEndModal() {
    if (this.destroyed || !this.game) return;
    const g = this.game;
    const you = g.score.away, cpu = g.score.home;
    const wonYou = g.winner === 'away';
    const modal = document.createElement('div');
    modal.className = 'bb-end-overlay';
    modal.innerHTML = `
      <div class="bb-end-modal">
        <button type="button" class="bb-end-close" data-act="close" aria-label="${t('close')}">&times;</button>
        <div class="bb-end-title">${wonYou ? t('end_win') : (g.winner === 'tie' ? t('end_tie') : t('end_loss'))}</div>
        <div class="bb-end-line">${t('you')} ${you} - ${cpu} ${t('cpu')}</div>
        <div class="bb-end-actions">
          <button type="button" class="gh-btn gh-btn--primary" data-act="again">${t('play_again')}</button>
          <button type="button" class="gh-btn" data-act="done">${t('done')}</button>
        </div>
      </div>`;
    this.rootEl.appendChild(modal);
    const close = () => { modal.remove(); this._backToLauncher(); };
    modal.querySelector('[data-act="close"]').addEventListener('click', close);
    modal.querySelector('[data-act="done"]').addEventListener('click', close);
    modal.querySelector('[data-act="again"]').addEventListener('click', () => {
      modal.remove();
      this.screen = 'setup';
      this._renderSetup();
      this._fit();
    });
  }

  // -------------------------------------------------------------------------------- Tune panel (dev only)
  _openTune() {
    if (!this.dev) return;
    const KEYS_ENGINE = ['fastballMs', 'timingWindow', 'foulMult', 'swingDelay', 'sweetSpot', 'batReach',
      'chargeTime', 'chargeWindowMult', 'chargePower', 'meterTime', 'niceWidth', 'perfectMs'];
    const KEYS_UI = ['betweenMs', 'windupMs', 'resultMs'];
    const sheet = document.createElement('div');
    sheet.className = 'bb-tune-overlay';
    const row = (label, group, key, val, min, max, step) => `
      <label class="bb-tune-row">
        <span>${label}</span>
        <input type="range" data-group="${group}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="bb-tune-val" data-out="${group}.${key}">${val}</span>
      </label>`;
    let html = '<div class="bb-tune-sheet"><h2>Tune</h2>';
    for (const k of KEYS_ENGINE) {
      const v = SETTINGS.FEEL.engine[k];
      html += row(k, 'engine', k, v, 0, Math.max(2, v * 3), v < 2 ? 0.01 : 1);
    }
    for (const k of KEYS_UI) {
      const v = SETTINGS.FEEL.ui[k];
      html += row(k, 'ui', k, v, 0, Math.max(2, v * 3), 1);
    }
    html += `<div class="bb-tune-actions">
      <button type="button" class="gh-btn" data-act="copy">Copy settings</button>
      <button type="button" class="gh-btn gh-btn--primary" data-act="close">Close</button>
    </div></div>`;
    sheet.innerHTML = html;
    document.body.appendChild(sheet);
    sheet.querySelectorAll('input[type="range"]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const group = inp.dataset.group, key = inp.dataset.key;
        const val = parseFloat(inp.value);
        SETTINGS.FEEL[group][key] = val;
        const out = sheet.querySelector(`[data-out="${group}.${key}"]`);
        if (out) out.textContent = val;
      });
    });
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => sheet.remove());
    sheet.querySelector('[data-act="copy"]').addEventListener('click', () => {
      const json = JSON.stringify(SETTINGS.FEEL, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    });
  }
}

// ---------------------------------------------------------------------------------------------
// HumanAgent: implements decidePitch/decideSwing by driving the real UI and waiting for input.
class HumanAgent {
  constructor(screen, league) {
    this.screen = screen;
    this.league = league;
  }

  async decidePitch(view) {
    const s = this.screen;
    if (s.destroyed) return { type: 'fastball', aim: 0 };
    s.state.mode = 'pitching';
    s._paintStrip();
    s._paintModeLabels();
    s._setLine1(''); s._setLine2('');

    return new Promise((resolve) => {
      let steerSamples = [];
      const dtS = SETTINGS.FEEL.engine.dtS;
      const meterMs = SETTINGS.FEEL.engine.meterTime;
      const hangGraceMs = meterMs * SETTINGS.HANG_GRACE_FRAC;
      s._paintRing('filling', 0);
      let raf;
      let released = false;
      const start = performance.now();
      const tick = (now) => {
        if (s.destroyed) return;
        const elapsed = now - start;
        const frac = elapsed / meterMs;
        if (elapsed > meterMs) {
          s._paintRing('hung', Math.min(1, (elapsed - meterMs) / hangGraceMs));
        } else if (frac >= NICE_CENTER - NICE_HALF) {
          s._paintRing('nice', frac);
        } else {
          s._paintRing('filling', frac);
        }
        if (!released) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      s._onPadMove = () => { /* aim tracked via s.padX, sampled at release; also feeds steer once thrown */ };

      const finish = () => {
        if (released) return;
        released = true;
        cancelAnimationFrame(raf);
        s._onMainUp = null;
        const holdMs = performance.now() - start;
        s._paintRing('released', Math.min(1.3, holdMs / meterMs));
        resolve({ type: s.state.selectedPitch, aim: s.padX, hold: holdMs, steer: steerSamples });
      };
      s._onMainUp = finish;
    });
  }

  async decideSwing(view) {
    const s = this.screen;
    if (s.destroyed) return { action: 'take' };
    s.state.mode = 'batting';
    s._paintModeLabels();
    const pitch = view.pitch;
    s.state.lastPitches.push({ type: pitch.type, isStrike: pitch.isStrike, mph: Math.round(pitchMph(pitch, this.league)) });
    s._paintStrip();

    const flightPromise = s._animatePitchFlight(pitch);
    s._paintRing('idle', 0);

    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;
      let raf = null;
      let downAt = null;
      const F = SETTINGS.FEEL.engine;
      const releaseMs0 = performance.now();
      const settle = (heldMs) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        const releaseMs = performance.now() - releaseMs0;
        const charged = heldMs >= F.chargeTime;
        const timing = timingFromRelease(releaseMs, pitch.timeToPlateS, F);
        s._paintRing(charged ? 'charged' : 'idle', Math.min(1, heldMs / F.chargeTime));
        resolve({ action: 'swing', aimX: s.padX, timingErrorMs: timing, charged });
      };
      s._onMainDown = () => {
        downAt = performance.now();
        const loop = () => {
          if (resolved) return;
          const heldMs = performance.now() - downAt;
          const frac = Math.min(1, heldMs / F.chargeTime);
          s._paintRing(frac >= 1 ? 'charged' : 'charging', frac);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      };
      s._onMainUp = (heldMs) => settle(heldMs);

      const timeoutMs = pitch.timeToPlateS * 1000 + 250;
      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        resolve({ action: 'take' });
      }, timeoutMs);
    });
  }
}

function timingFromRelease(releaseMs, timeToPlateS, F) {
  const crossMs = timeToPlateS * 1000;
  const idealReleaseMs = crossMs - F.swingDelay;
  return releaseMs - idealReleaseMs;
}

function pitchMph(pitch, league) {
  const readout = (SETTINGS.READOUT[league] || SETTINGS.READOUT.majors);
  return readout[pitch.type] || readout.fastball;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function dots(n, max, cls) {
  let out = '';
  for (let i = 0; i < max; i++) out += `<span class="bb-dot bb-dot-${cls}${i < n ? ' is-on' : ''}"></span>`;
  return out;
}

function basesSvg(bases) {
  const on = (i) => bases[i] != null;
  return `<svg viewBox="0 0 40 40" class="bb-bases-svg">
    <rect x="18" y="4" width="8" height="8" transform="rotate(45 22 8)" class="${on(1) ? 'is-on' : ''}"></rect>
    <rect x="4" y="18" width="8" height="8" transform="rotate(45 8 22)" class="${on(0) ? 'is-on' : ''}"></rect>
    <rect x="28" y="18" width="8" height="8" transform="rotate(45 32 22)" class="${on(2) ? 'is-on' : ''}"></rect>
  </svg>`;
}

function outcomeWord(kind) {
  if (kind === 'homer') return 'homer';
  if (kind === 'walk') return 'walk';
  if (kind === 'strikeout') return 'strikeout';
  if (/out$/.test(kind)) return 'out';
  return 'hit';
}

function basesLabel(bases) {
  if (bases === 1) return '1B';
  if (bases === 2) return '2B';
  if (bases === 3) return '3B';
  return '';
}
