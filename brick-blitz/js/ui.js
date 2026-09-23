// brick-blitz/js/ui.js — Brick Blitz's DOM shell: setup screen (over a live attract-mode demo),
// HUD, pause / game-over / how-to-play overlays, input, the clock, and stats. The engine
// (game.js) owns every rule and every pixel on the canvas.
//
// isInProgress(): the LITERAL meaning (no mid-run resume, same class as Snake/Pinball): true while
// a run is live, so the hub confirms before navigating away. A run that is left with points on the
// board is still RECORDED (destroy() finishes it), so a hub back-tap never loses a score.

import { createGame, createSound, DIFFS, POWER_COLORS } from './game.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordBrickBlitz, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.brickblitz.v1';
const MODES = ['arcade', 'endless'];

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  catch (err) { console.error('[brickblitz] settings save failed', err); }
}
/** Last-used settings beat the profile's first opponent skill (1/2/3 -> easy/medium/hard) beat Medium. */
function loadSettings() {
  const saved = readJSON(SETTINGS_KEY) || {};
  const mode = MODES.includes(saved.mode) ? saved.mode : 'arcade';
  const muted = saved.muted === true;
  if (DIFFS.includes(saved.difficulty)) return { difficulty: saved.difficulty, mode, muted };
  let skillDiff = null;
  try {
    const p = loadProfile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : null;
    skillDiff = skill === 1 ? 'easy' : skill === 3 ? 'hard' : skill === 2 ? 'medium' : null;
  } catch { /* no profile is fine */ }
  return { difficulty: skillDiff || 'medium', mode, muted };
}
/** The best score is read from the shared stats store, never a local high-score table: one home
 *  for a score, so it cannot disagree with My Stats or the leaderboard. */
function bestFor(diff) {
  try {
    const bz = (loadStats().games.brickblitz || {}).bz || {};
    return (bz.bestScoreByDiff || {})[diff] | 0;
  } catch { return 0; }
}
const fmt = (n) => (Math.max(0, Math.floor(n)) | 0).toLocaleString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
const soundSVG = (muted) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/>${muted
  ? '<path d="M16 9l6 6M22 9l-6 6"/>' : '<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 5.5a9 9 0 0 1 0 13"/>'}</g></svg>`;

/** How-to-play diagram: a plain brick beside a two-hit brick (told apart by the inner outline and
 *  rivets, never colour), then the four capsules, each carrying its LETTER. */
function helpDiagramSVG() {
  const cap = (x, k) => `<g transform="translate(${x} 70)"><rect x="-22" y="-10" width="44" height="20" rx="10" fill="${POWER_COLORS[k]}"/>
    <text x="0" y="5" text-anchor="middle" font-size="14" font-weight="900" font-style="italic" fill="#12002b">${k}</text></g>`;
  return `<svg class="bx-help-svg" viewBox="0 0 260 90" role="img" aria-hidden="true">
    <rect x="40" y="10" width="70" height="24" rx="5" fill="rgba(255,46,151,.35)" stroke="#ff2e97" stroke-width="2"/>
    <rect x="150" y="10" width="70" height="24" rx="5" fill="rgba(0,245,212,.6)" stroke="#00f5d4" stroke-width="2"/>
    <rect x="154" y="14" width="62" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.4"/>
    <circle cx="158" cy="22" r="2" fill="#fff"/><circle cx="212" cy="22" r="2" fill="#fff"/>
    <text x="75" y="48" text-anchor="middle" font-size="11" fill="#e7d7ff">1</text>
    <text x="185" y="48" text-anchor="middle" font-size="11" fill="#e7d7ff">2</text>
    ${cap(40, 'M')}${cap(100, 'W')}${cap(160, 'L')}${cap(220, 'S')}
  </svg>`;
}

let instance = null;

class BrickBlitzUI {
  constructor(container) {
    this.host = container;
    this.settings = loadSettings();
    this.screen = 'setup';       // setup | game | paused | over | victory | help
    this.runActive = false;
    this.raf = 0;
    this.last = 0;
    this.touch = matchMedia('(hover: none)').matches;
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this.sound = createSound();
    this.sound.setMuted(this.settings.muted);
    this.pointer = { active: false, id: null, sx: 0, spx: 0, moved: 0, t: 0 };
    this._hud = {};
    this._ensureCss();
    this._build();

    this.game = createGame(this.canvas, {
      t, sound: this.sound, reduce: () => this.reduce,
      onHud: () => this._syncHud(),
      onCombo: (c, bump) => this._combo(c, bump),
      onStage: (n, key, endless) => this._stageStarted(n, key, endless),
      onStageClear: (bonus) => this._say(t('say_clear', { n: bonus })),
      onLifeLost: (n) => this._say(t('say_life', { n })),
      onGameOver: () => this._gameOver(),
      onVictory: () => this._victory(),
    });

    this._onKey = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keyUp(e);
    this._onVis = () => { if (document.hidden) { if (this.screen === 'game') this._pause(); this._stop(); } else this._start(); };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    // The stage's size also changes with no viewport event at all: the module stylesheet landing
    // after the first paint, a flex settle, the hub chrome collapsing. A ResizeObserver catches
    // those (docs/BUILDING-A-GAME.md, "The .hub-game height trap"); size-change-only, so cheap.
    this._stageSize = '';
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const k = this.stage.clientWidth + 'x' + this.stage.clientHeight;
      if (k !== this._stageSize) this._layout();
    }) : null;
    if (this._ro) this._ro.observe(this.stage);
    this._offLang = onLangChange(() => this._relabel());

    this._layout();
    this.game.attract();
    this._showSetup();
    this._start();
  }

  _ensureCss() {
    const href = new URL('../css/brick-blitz.css', import.meta.url).href;
    if (![...document.styleSheets].some((s) => s.href === href) && !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- DOM -------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="bx-root">
        <div class="bx-hud" data-role="hud">
          <span class="bx-h"><small data-l="hud_score"></small><strong data-hud="score">0</strong></span>
          <span class="bx-h bx-h-c"><small data-hud="stageLabel"></small><strong data-hud="stage">1</strong></span>
          <span class="bx-h"><small data-l="hud_lives"></small><span class="bx-lives" data-hud="lives"></span></span>
          <span class="bx-h bx-h-v"><small data-l="hud_best"></small><strong data-hud="best">0</strong></span>
        </div>
        <div class="bx-stage" data-role="stage">
          <div class="bx-screen" data-role="screen">
            <canvas class="bx-canvas" role="img"></canvas>
            <div class="bx-combo" data-role="combo" aria-hidden="true"><b data-role="comboNum">x2</b><span data-l="combo"></span></div>
            <div class="bx-banner" data-role="banner" aria-hidden="true"><span data-role="bannerTop"></span><b data-role="bannerMain"></b></div>
            <div class="bx-scan" aria-hidden="true"></div>
          </div>
        </div>
        <div class="bx-dock" data-role="dock">
          <button type="button" class="bx-ibtn" data-act="mute"></button>
          <button type="button" class="bx-ibtn" data-act="pause">${PAUSE_SVG}<span data-l="pause"></span></button>
        </div>

        <div class="bx-ov bx-ov-setup" data-ov="setup">
          <div class="bx-setup">
            <h2 class="bx-logo" data-l="title"></h2>
            <p class="bx-tag" data-l="tagline"></p>
            <div class="bx-field">
              <span class="bx-label" data-l="difficulty"></span>
              <div class="bx-segrow" role="group" data-role="diffs"></div>
            </div>
            <div class="bx-field">
              <span class="bx-label" data-l="mode"></span>
              <div class="bx-segrow" role="group" data-role="modes"></div>
            </div>
            <button type="button" class="bx-mbtn" data-act="play"><span data-l="play"></span></button>
            <button type="button" class="bx-mbtn bx-alt" data-act="howto"><span data-l="howto"></span></button>
            <p class="bx-best" data-role="setupBest"></p>
          </div>
        </div>

        <div class="bx-ov" data-ov="pause" hidden>
          <div class="bx-card">
            <h2 class="bx-h2" data-l="paused"></h2>
            <div class="bx-menu">
              <button type="button" class="bx-mbtn bx-alt" data-act="resume"><span data-l="resume"></span></button>
              <button type="button" class="bx-mbtn" data-act="quit"><span data-l="quit"></span></button>
            </div>
          </div>
        </div>

        <div class="bx-ov" data-ov="over" hidden>
          <div class="bx-card">
            <button type="button" class="bx-x" data-act="menu" data-la="aria_close">${X_SVG}</button>
            <p class="bx-kick" data-role="overKick"></p>
            <h2 class="bx-h2" data-role="overTitle"></h2>
            <p class="bx-scoreline" data-role="overScore"></p>
            <p class="bx-record" data-role="overRecord" hidden></p>
            <p class="bx-note" data-role="overNote"></p>
            <div class="bx-menu">
              <button type="button" class="bx-mbtn" data-act="again"><span data-role="againLabel"></span></button>
              <button type="button" class="bx-mbtn bx-alt" data-act="menu"><span data-l="menu"></span></button>
            </div>
          </div>
        </div>

        <div class="bx-ov" data-ov="help" hidden>
          <div class="bx-card bx-help" role="dialog" aria-modal="true">
            <button type="button" class="bx-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="bx-h2 bx-h2-sm" data-l="howto"></h2>
            <p class="bx-help-goal" data-l="help_goal"></p>
            ${helpDiagramSVG()}
            <p class="bx-help-line" data-l="help_armor"></p>
            <p class="bx-help-line" data-l="help_caps"></p>
            <p class="bx-help-line bx-help-kv" data-l="help_M"></p>
            <p class="bx-help-line bx-help-kv" data-l="help_W"></p>
            <p class="bx-help-line bx-help-kv" data-l="help_L"></p>
            <p class="bx-help-line bx-help-kv" data-l="help_S"></p>
            <p class="bx-help-line" data-l="help_combo"></p>
            <p class="bx-help-line" data-l="help_controls"></p>
            <button type="button" class="bx-mbtn bx-alt" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <p class="bx-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.bx-root');
    this.stage = q('[data-role="stage"]');
    this.screenEl = q('[data-role="screen"]');
    this.canvas = q('.bx-canvas');
    this.comboEl = q('[data-role="combo"]');
    this.comboNum = q('[data-role="comboNum"]');
    this.banner = q('[data-role="banner"]');
    this.liveEl = q('[data-role="live"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });
    this.hudEls = {};
    this.root.querySelectorAll('[data-hud]').forEach((el) => { this.hudEls[el.dataset.hud] = el; });

    this.root.addEventListener('click', (e) => this._click(e));
    // Pointer input lives on the stage (the canvas plus the dark margin around it), so a thumb
    // resting just below the field still steers. Pointer capture keeps a drag alive past its edge.
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this.stage.addEventListener('pointerdown', this._onDown);
    this.stage.addEventListener('pointermove', this._onMove);
    this.stage.addEventListener('pointerup', this._onUp);
    this.stage.addEventListener('pointercancel', this._onUp);
    // Scroll-leak guard, root-scoped (never document: root CLAUDE.md, "Scroll and touch rules").
    this._onTouchMove = (e) => { if (this.screen === 'game') e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._relabel();
  }

  /** Every translated label, re-applied on a language switch. */
  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    this.canvas.setAttribute('aria-label', t('aria_canvas'));
    const d = this.settings.difficulty, m = this.settings.mode;
    this.root.querySelector('[data-role="diffs"]').setAttribute('aria-label', t('difficulty'));
    this.root.querySelector('[data-role="diffs"]').innerHTML = DIFFS.map((id) => `
      <button type="button" class="bx-seg${d === id ? ' is-on' : ''}" data-diff="${id}" aria-pressed="${d === id}">
        ${diffShapeSVG(tierOf(id))}<span>${esc(t('diff_' + id))}</span></button>`).join('');
    this.root.querySelector('[data-role="modes"]').setAttribute('aria-label', t('mode'));
    this.root.querySelector('[data-role="modes"]').innerHTML = MODES.map((id) => `
      <button type="button" class="bx-seg bx-seg-2${m === id ? ' is-on' : ''}" data-mode="${id}" aria-pressed="${m === id}">
        <span>${esc(t('mode_' + id))}</span><small>${esc(t('mode_' + id + '_sub'))}</small></button>`).join('');
    this._syncMute();
    this._syncSetupBest();
    if (this.game) { this._hud = {}; this._syncHud(); }
    if (this.screen === 'over' || this.screen === 'victory') this._fillOver(this._lastOver);
  }
  _syncSetupBest() {
    const d = this.settings.difficulty;
    this.root.querySelector('[data-role="setupBest"]').textContent = t('best', { diff: t('diff_' + d), n: fmt(bestFor(d)) });
  }
  _syncMute() {
    const m = this.sound.muted;
    const b = this.root.querySelector('[data-act="mute"]');
    b.innerHTML = `${soundSVG(m)}<span>${esc(t(m ? 'muted' : 'sound'))}</span>`;
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', t(m ? 'aria_unmute' : 'aria_mute'));
  }
  _setHud(k, v, html) {
    if (this._hud[k] === v) return;
    this._hud[k] = v;
    const el = this.hudEls[k]; if (!el) return;
    if (html) el.innerHTML = v; else el.textContent = v;
  }
  _syncHud() {
    const g = this.game;
    const live = !g.demo;
    this._setHud('score', fmt(live ? g.score : 0));
    this._setHud('stageLabel', t(g.endless ? 'hud_wave' : 'hud_stage'));
    this._setHud('stage', String(g.stageNum));
    this._setHud('lives', '<i></i>'.repeat(Math.max(0, Math.min(5, live ? g.lives : 0))), true);
    this._setHud('best', fmt(Math.max(this._runBest | 0, live ? g.score : 0)));
  }
  _combo(c, bump) {
    if (c >= 2) {
      this.comboNum.textContent = 'x' + c;
      this.comboEl.classList.add('is-on');
      if (bump && !this.reduce) { this.comboEl.classList.remove('is-pop'); void this.comboEl.offsetWidth; this.comboEl.classList.add('is-pop'); }
      this._comboT = 1.4;
    }
  }
  _stageStarted(n, key, endless) {
    this.root.querySelector('[data-role="bannerTop"]').textContent = t(endless ? 'banner_wave' : 'banner_stage', { n: String(n).padStart(2, '0') });
    this.root.querySelector('[data-role="bannerMain"]').textContent = key ? t(key) : t('mode_endless');
    this.banner.classList.remove('is-show'); void this.banner.offsetWidth; this.banner.classList.add('is-show');
    this._say(endless ? t('say_wave', { n }) : t('say_stage', { n, name: t(key) }));
  }
  _say(s) { this.liveEl.textContent = s; }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-setup', name === 'setup' || (name === 'help' && !this.runActive));
  }
  _showSetup() {
    this.screen = 'setup';
    this._syncSetupBest();
    this._showOnly('setup');
  }

  // --- layout ----------------------------------------------------------------------------------
  _layout() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._stageSize = w + 'x' + h;
    const size = this.game.layout(w - 8, h - 8);
    this.screenEl.style.width = size.w + 'px';
    this.screenEl.style.height = size.h + 'px';
    this.game.render(this.touch);
  }

  // --- run lifecycle ---------------------------------------------------------------------------
  _play() {
    this.sound.init();
    const d = this.settings.difficulty;
    this._runBest = bestFor(d);
    this.runActive = true;
    this.screen = 'game';
    this._showOnly(null);
    this._hud = {};
    this.game.startRun(this.settings.mode, d);
    this._start();
  }
  _pause() {
    if (this.screen !== 'game') return;
    this.screen = 'paused';
    this._showOnly('pause');
    this.root.querySelector('[data-act="resume"]').focus({ preventScroll: true });
  }
  _resume() {
    if (this.screen !== 'paused') return;
    this.screen = 'game';
    this._showOnly(null);
    this.last = performance.now();
    this._start();
  }
  /** Record the run, once. Only a run that actually scored is worth a stats row when the player
   *  walks away mid-run (quit / hub back); a run that ENDED (game over, circuit cleared) always
   *  records, zero or not. Returns true when this beat the stored best for the difficulty. */
  _finishRun(ended) {
    if (!this.runActive) return false;
    this.runActive = false;
    const s = this.game.summary;
    if (!ended && !(s.score > 0)) return false;
    const d = this.game.difficulty;
    const before = bestFor(d);
    try {
      const st = recordBrickBlitz(s.score, d, { bricks: s.bricks, stages: s.stages, bestCombo: s.bestCombo, circuit: s.circuit, endless: s.endless });
      if (!st) console.warn('[brickblitz] result not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[brickblitz] recording the result failed', err); }
    return s.score > before;
  }
  _gameOver() {
    const rec = this._finishRun(true);
    const s = this.game.summary;
    this._lastOver = { kind: 'over', score: s.score, rec, bestCombo: s.bestCombo, bricks: s.bricks };
    this.screen = 'over';
    this._fillOver(this._lastOver);
    this._showOnly('over');
    this._say(t('say_over', { n: s.score }));
    this.root.querySelector('[data-act="again"]').focus({ preventScroll: true });
  }
  _victory() {
    const s = this.game.summary;
    this._lastOver = { kind: 'victory', score: s.score, rec: s.score > (this._runBest | 0), bestCombo: s.bestCombo, bricks: s.bricks };
    this.screen = 'victory';
    this._fillOver(this._lastOver);
    this._showOnly('over');
    this.root.querySelector('[data-act="again"]').focus({ preventScroll: true });
  }
  _fillOver(o) {
    if (!o) return;
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    const v = o.kind === 'victory';
    q('overKick').textContent = t(v ? 'victory_kick' : 'over_kick');
    q('overTitle').textContent = t(v ? 'victory_title' : 'over_title');
    q('overScore').textContent = fmt(o.score);
    q('overRecord').hidden = !o.rec;
    q('overRecord').textContent = t('new_best');
    q('overNote').textContent = v ? t('victory_note') : t('over_note', { n: o.bestCombo, b: o.bricks });
    q('againLabel').textContent = t(v ? 'go_endless' : 'play_again');
  }
  _toMenu() {
    this._finishRun(this.screen === 'victory');
    this.game.attract();
    this._comboT = 0; this.comboEl.classList.remove('is-on');
    this._showSetup();
    this._start();
  }

  // --- input -----------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-diff], [data-mode]');
    if (seg) {
      if (seg.dataset.diff) this.settings.difficulty = seg.dataset.diff;
      else this.settings.mode = seg.dataset.mode;
      saveSettings(this.settings);
      const row = seg.parentElement;
      row.querySelectorAll('.bx-seg').forEach((x) => { x.classList.toggle('is-on', x === seg); x.setAttribute('aria-pressed', String(x === seg)); });
      this._syncSetupBest();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') this._play();
    else if (act === 'howto') { this.screen = 'help'; this._showOnly('help'); }
    else if (act === 'helpClose') this._showSetup();
    else if (act === 'pause') { if (this.screen === 'game') this._pause(); else if (this.screen === 'paused') this._resume(); }
    else if (act === 'resume') this._resume();
    else if (act === 'quit') this._toMenu();
    else if (act === 'menu') this._toMenu();
    else if (act === 'again') {
      if (this.screen === 'victory') { this.screen = 'game'; this._showOnly(null); this.game.continueEndless(); this._start(); }
      else this._play();
    }
    else if (act === 'mute') {
      this.sound.init();
      this.sound.setMuted(!this.sound.muted);
      this.settings.muted = this.sound.muted;
      saveSettings(this.settings);
      this._syncMute();
    }
  }
  _fieldX(clientX) {
    const r = this.canvas.getBoundingClientRect();
    return (clientX - r.left) / (r.width || 1) * 600;
  }
  _pointerDown(e) {
    this.sound.init();
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') {
      this.game.setTarget(this._fieldX(e.clientX));
      if (this.game.phase === 'serve') this.game.launch();
      return;
    }
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.pointer = { active: true, id: e.pointerId, sx: e.clientX, spx: this.game.paddleX, moved: 0, t: performance.now() };
  }
  _pointerMove(e) {
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') { this.game.setTarget(this._fieldX(e.clientX)); return; }
    const p = this.pointer;
    if (!p.active || e.pointerId !== p.id) return;
    const dx = e.clientX - p.sx;
    p.moved = Math.max(p.moved, Math.abs(dx));
    // Relative drag (the original's feel): the paddle follows the thumb's MOVEMENT, a little
    // faster than 1:1, so the thumb never has to sit on top of the paddle and hide the ball.
    this.game.setTarget(p.spx + dx / (this.game.fieldScale || 1) * 1.25);
  }
  _pointerUp(e) {
    const p = this.pointer;
    if (!p.active || e.pointerId !== p.id) return;
    if (e.type === 'pointerup' && p.moved < 12 && performance.now() - p.t < 320 && this.screen === 'game' && this.game.phase === 'serve') this.game.launch();
    p.active = false;
  }
  _keyDown(e) {
    const k = e.key;
    const inGame = this.screen === 'game';
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { this.game.keys.left = true; if (inGame) e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { this.game.keys.right = true; if (inGame) e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar') {
      if (e.target && e.target.closest && e.target.closest('button') && !inGame) return;
      if (inGame) { e.preventDefault(); this.sound.init(); if (this.game.phase === 'serve') this.game.launch(); else this._pause(); }
      else if (this.screen === 'paused') { e.preventDefault(); this._resume(); }
    }
    else if (k === 'p' || k === 'P' || k === 'Escape') { if (inGame) this._pause(); else if (this.screen === 'paused') this._resume(); }
    else if ((k === 'm' || k === 'M') && this.screen !== 'setup') { this.root.querySelector('[data-act="mute"]').click(); }
  }
  _keyUp(e) {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.game.keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') this.game.keys.right = false;
  }

  // --- clock -----------------------------------------------------------------------------------
  _start() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  _frame(now) {
    this.raf = 0;
    if (instance !== this) return;
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (this.screen !== 'paused') this.game.update(dt);
    this.game.render(this.touch);
    if (this._comboT > 0) { this._comboT -= dt; if (this._comboT <= 0) this.comboEl.classList.remove('is-on'); }
    // A paused game draws its frame and stops: nothing moves, so there is nothing to redraw.
    if (this.screen === 'paused') return;
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }

  destroy() {
    this._finishRun(false);
    this._stop();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.reduceMQ.removeEventListener) this.reduceMQ.removeEventListener('change', this._onReduce);
    if (this._offResize) this._offResize();
    if (this._ro) this._ro.disconnect();
    if (this._offLang) this._offLang();
    this.sound.close();
    this.host.innerHTML = '';
  }
}

export function init(container) {
  if (instance) destroy();
  instance = new BrickBlitzUI(container);
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
}
/** Literal meaning: a live run (playing or paused) would be lost by leaving. */
export function isInProgress() {
  return !!(instance && instance.runActive && (instance.screen === 'game' || instance.screen === 'paused'));
}
export default { init, destroy, isInProgress };
