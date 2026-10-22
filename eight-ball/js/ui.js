// eight-ball/js/ui.js - Pool's DOM shell: setup, the play screen (one canvas table under a thin
// scoreboard), the drag-back-and-shoot input (Flick Soccer's, flick-soccer/js/ui.js), ball in hand,
// spin, the turn flow, the computer, menus, autosave and stats. Rules and physics live in
// engine.js, the computer in ai.js, pixels in render.js.
//
// isInProgress(): the AUTOSAVE meaning. The match is saved every time the table comes to rest
// (gamehub.eightball.save.v1) and the setup screen offers Continue, so leaving is lossless and this
// returns false. Leaving while a shot is still rolling plays that shot out first (_settleNow), so a
// pot in flight is never lost and a bad shot can never be taken back by quitting. A match is
// recorded once it is won, against the computer only.

import {
  newMatch, validMatch, step, atRest, freeze, settle, begin, play, nextRack, runToRest, maxShotSteps,
  aimContact, rayStop, canPlace, nearestPlace, onEight, cloneBalls, ballsOf,
  CUE, EIGHT, R, W, H, DT, HEAD_Y, POCKETS, RACK_OPTIONS,
} from './engine.js';
import { planShot, DIFFS } from './ai.js';
import { createRenderer, ballSVG } from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the cards theme standalone too
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const STATS_ID = 'eightball';
const SETTINGS_KEY = 'gamehub.eightball.v1';
const SAVE_KEY = 'gamehub.eightball.save.v1';
const MODES = ['cpu', 'pass'];
/** The SAFE zone (px) round the point the pull starts from: letting go inside it never shoots
 *  (Flick Soccer, 2026-10-16: a fingertip is wider than the ball). The pull may start anywhere on
 *  the table: the shot goes from the finger through the cue ball, and the strength is how far the
 *  finger has moved AWAY from the ball since it came closest, so touching far off and turning round
 *  the ball gives a finer aim, and a tap anywhere is never a shot. */
const PULL_SAFE_PX = 22;
/** Finger travel (px) past the safe zone for a full-strength shot, and the least it may shrink to
 *  where the screen's edge comes first (EDGE_M inside the edge; the bottom adds the home bar). */
const PULL_FULL_PX = 130;
const PULL_MIN_PX = 24;
const EDGE_M = 30;
/** The weakest shot that counts; anything less is a cancelled aim. */
const MIN_POWER = 0.03;
/** Physics steps allowed per frame, so a stalled tab cannot teleport anything (Part 3). */
const MAX_STEPS = 24;
/** The computer's thinking budget per frame (ms), the least time it takes to "decide", how long it
 *  takes to put the cue ball down with the ball in hand, and how long its cue is drawn back. */
const CPU_SLICE_MS = 7;
const CPU_MIN_THINK = 0.6;
const CPU_PLACE_SECS = 0.45;
const CPU_AIM_SECS = 0.6;
const BURST_SECS = 0.52;
const SINK_SECS = 0.22;
const RACK_PAUSE = 1.8;

/** How much aiming help each difficulty gets, as in Flick Soccer (Matt, 2026-10-11: Easy shows the
 *  most, Hard the least). Easy: the line to the first ball, a ghost ball there, where that ball goes
 *  and where the cue ball glances off. Medium: the line, the ghost ball and a short stub of the
 *  ball's path. Hard: a short line out of the cue ball only. Pass and play is Medium. */
const AIDS = {
  easy: { contact: true, paths: 'long' },
  medium: { contact: true, paths: 'short' },
  hard: { contact: false, paths: null },
};

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) { console.error('[eight-ball] save failed: ' + k, err); return false; }
}
function profile() { try { return loadProfile(); } catch { return null; } }

/** Saved choices beat the profile's first opponent skill (1/2/3 -> easy/medium/hard) beat Medium. */
function loadSettings() {
  const s = readJSON(SETTINGS_KEY) || {};
  let difficulty = DIFFS.includes(s.difficulty) ? s.difficulty : null;
  if (!difficulty) {
    const p = profile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : 2;
    difficulty = skill === 1 ? 'easy' : skill === 3 ? 'hard' : 'medium';
  }
  return {
    mode: MODES.includes(s.mode) ? s.mode : 'cpu',
    difficulty,
    racks: RACK_OPTIONS.includes(s.racks) ? s.racks : 1,
    nextBreaker: s.nextBreaker === 1 ? 1 : 0,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const CPU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="7" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="12.5" r="1.6" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.6" fill="currentColor"/><path d="M12 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PASS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M14 14.6c.6-.2 1.3-.3 2-.3 2.4 0 4.2 1.4 4.8 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
/** The spin button: the cue ball with a dot where the tip will strike it. */
const spinSVG = (s) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" fill="#F7EFCB" stroke="#2a2a2a" stroke-width="1.4"/><circle cx="12" cy="${(12 - s * 6).toFixed(2)}" r="2.6" fill="#E0532F" stroke="#fff" stroke-width="0.8"/></svg>`;

/** How to play: the cue drawn back from the cue ball, the shot, a ball dropping into a pocket. */
function helpSvg() {
  return `<svg class="ep-help-svg" viewBox="0 0 240 104" role="img" aria-hidden="true">
    <rect x="0" y="0" width="240" height="104" rx="10" fill="#8C5A3F"/>
    <rect x="7" y="7" width="226" height="90" rx="5" fill="#3FBE63"/>
    <rect x="11" y="11" width="218" height="82" rx="3" fill="#0F8A3C"/>
    <circle cx="226" cy="14" r="9" fill="#000"/>
    <path d="M6 96 L58 66" stroke="#5A3420" stroke-width="6" stroke-linecap="round"/>
    <path d="M40 76 L64 62" stroke="#F1D9A6" stroke-width="4" stroke-linecap="round"/>
    <circle cx="20" cy="88" r="8" fill="#fff" opacity="0.85"/>
    <path d="M20 88 L70 58" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>
    <circle cx="76" cy="54" r="8" fill="#F7EFCB" stroke="#222" stroke-width="1"/>
    <path d="M86 48 L160 22" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3"/>
    <circle cx="166" cy="20" r="8" fill="none" stroke="#fff" stroke-width="1.4"/>
    <circle cx="180" cy="22" r="8" fill="#F2604C" stroke="#222" stroke-width="1"/>
    <path d="M190 20 Q206 16 218 15" stroke="#ffce3a" stroke-width="2.5" stroke-dasharray="5 4" fill="none"/>
    <path d="M222 14 L211 10 L213 20 Z" fill="#ffce3a"/>
  </svg>`;
}

let instance = null;

class PoolUI {
  constructor(container) {
    this.host = container;
    this.settings = loadSettings();
    this.screen = 'setup';         // setup | help | play | menu | spin | result
    this.phase = 'idle';           // aim | cpu | cpuplace | cpuaim | moving | pause | idle
    this.match = null;
    this.seats = null;
    this.clock = 0;                // game time (s); stops while a menu is open
    this.timers = [];
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.glowT = 0;
    this.drag = null;
    this.aim = null;
    this.spin = 0;
    this.ev = null;
    this.shotSteps = 0;
    this.sinking = [];
    this.bursts = [];
    this.showB = null;             // the old rack, still shown while "wins the rack" is up
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this._ensureCss();
    this._build();
    this.r = createRenderer(this.canvas);

    this._onVis = () => {
      if (document.hidden) { this.drag = null; if (this.phase === 'aim') this.aim = null; this._stop(); this._save(); }
      else this._start();
    };
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    this._size = '';
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (this.root.clientWidth + 'x' + this.root.clientHeight !== this._size) this._layout();
    }) : null;
    if (this._ro) this._ro.observe(this.root);
    this._offLang = onLangChange(() => this._relabel());

    this._layout();
    this._showSetup();
    this._start();
  }

  _ensureCss() {
    for (const href of [new URL('../../css/ui.css', import.meta.url).href, new URL('../css/eight-ball.css', import.meta.url).href]) {
      if ([...document.styleSheets].some((s) => s.href === href) || document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- DOM -------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="ep-root ep-turn-0">
        <canvas class="ep-canvas" role="img"></canvas>
        <div class="ep-top" data-role="top">
          <button type="button" class="ep-ibtn ep-spinbtn" data-act="spin" data-role="spinBtn"></button>
          <button type="button" class="ep-ibtn" data-act="menu" data-la="aria_menu">${MENU_SVG}</button>
        </div>
        <div class="ep-board" data-role="board">
          <div class="ep-side ep-side-0" data-side="0">
            <span class="ep-ava" data-role="ava0"></span>
            <span class="ep-nm" data-role="name0"></span>
            <span class="ep-grp" data-role="grp0"></span>
            <b class="ep-sc" data-role="score0"></b>
          </div>
          <div class="ep-side ep-side-1" data-side="1">
            <b class="ep-sc" data-role="score1"></b>
            <span class="ep-grp" data-role="grp1"></span>
            <span class="ep-nm" data-role="name1"></span>
            <span class="ep-ava" data-role="ava1"></span>
          </div>
        </div>
        <p class="ep-status" data-role="status"></p>
        <div class="ep-banner" data-role="banner" aria-hidden="true"><b data-role="bannerMain"></b><span data-role="bannerSub"></span></div>
        <span class="ep-safe" data-role="safe" aria-hidden="true"></span>

        <div class="ep-ov ep-ov-setup" data-ov="setup" hidden>
          <div class="ep-card">
            <button type="button" class="ep-x ep-q" data-act="howto" data-la="howto">?</button>
            <button type="button" class="ep-x" data-act="exit" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-logo" data-l="title"></h2>
            <div class="gh-seg ep-seg ep-seg-big" role="group" data-role="modes"></div>
            <div class="gh-seg ep-seg" role="group" data-role="diffs"></div>
            <div class="ep-field">
              <span class="ep-label" data-l="racks"></span>
              <div class="gh-seg ep-seg" role="group" data-role="racksSeg"></div>
            </div>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="continue" data-role="continueBtn" hidden><span data-l="continue"></span></button>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block ep-go" data-act="play"><span data-l="play"></span></button>
          </div>
        </div>

        <div class="ep-ov" data-ov="menu" hidden>
          <div class="ep-card ep-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="ep-x" data-act="resume" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-h2" data-l="menu"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="howto"><span data-l="howto"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="quit"><span data-l="quit"></span></button>
          </div>
        </div>

        <div class="ep-ov ep-ov-spin" data-ov="spin" hidden>
          <div class="ep-card ep-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="ep-x" data-act="spinClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-h2" data-l="spin"></h2>
            <div class="ep-spinpad" data-role="spinPad">
              <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                <circle cx="50" cy="50" r="46" fill="#F7EFCB" stroke="#2a2a2a" stroke-width="2"/>
                <path d="M50 8 V92" stroke="rgba(0,0,0,0.18)" stroke-width="1.4" stroke-dasharray="3 3"/>
                <path d="M50 14 l-6 8 h12 z M50 86 l-6 -8 h12 z" fill="rgba(0,0,0,0.35)"/>
                <circle data-role="spinDot" cx="50" cy="50" r="9" fill="#E0532F" stroke="#fff" stroke-width="2.4"/>
              </svg>
            </div>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="spinZero"><span data-l="spin_center"></span></button>
          </div>
        </div>

        <div class="ep-ov" data-ov="result" hidden>
          <div class="ep-card ep-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="ep-x" data-act="toSetup" data-la="aria_close">${X_SVG}</button>
            <p class="ep-res-ava" data-role="resAva"></p>
            <h2 class="ep-h2" data-role="resTitle"></h2>
            <p class="ep-res-line" data-role="resLine"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-l="play_again"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="toSetup"><span data-l="to_menu"></span></button>
          </div>
        </div>

        <div class="ep-ov" data-ov="help" hidden>
          <div class="ep-card ep-help" role="dialog" aria-modal="true">
            <button type="button" class="ep-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-h2" data-l="howto"></h2>
            <p class="ep-help-goal" data-l="help_goal"></p>
            <p class="ep-help-groups" data-role="helpGroups"></p>
            <div data-role="helpSvg"></div>
            <p class="ep-help-line ep-help-cap" data-l="help_caption"></p>
            <p class="ep-help-line ep-help-ex" data-l="help_example"></p>
            <p class="ep-help-line" data-l="help_again"></p>
            <p class="ep-help-line" data-l="help_foul"></p>
            <p class="ep-help-line" data-l="help_hand"></p>
            <p class="ep-help-line" data-l="help_eight"></p>
            <p class="ep-help-line" data-l="help_spin"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <p class="ep-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.ep-root');
    this.canvas = q('.ep-canvas');
    this.banner = q('[data-role="banner"]');
    this.statusEl = q('[data-role="status"]');
    this.liveEl = q('[data-role="live"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });
    this.sideEls = [q('[data-side="0"]'), q('[data-side="1"]')];
    q('[data-role="helpSvg"]').innerHTML = helpSvg();

    this.root.addEventListener('click', (e) => this._click(e));
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e, false);
    this._onCancel = (e) => this._pointerUp(e, true);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onCancel);
    this.canvas.addEventListener('lostpointercapture', this._onCancel);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // The spin pad: a tap or a drag on the cue ball's face sets where the tip strikes it.
    const pad = q('[data-role="spinPad"]');
    this._onPad = (e) => {
      if (e.type === 'pointerdown') { try { pad.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ } this._padOn = true; }
      if (!this._padOn) return;
      if (e.type === 'pointerup' || e.type === 'pointercancel') { this._padOn = false; return; }
      const rc = pad.getBoundingClientRect();
      const v = -((e.clientY - rc.top) / rc.height - 0.5) / 0.38;
      let s = Math.max(-1, Math.min(1, v));
      if (Math.abs(s) < 0.12) s = 0;
      this.spin = Math.round(s * 100) / 100;
      this._paintSpin();
      e.preventDefault();
    };
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) pad.addEventListener(ev, this._onPad);
    // Scroll-leak guard, root-scoped (never document: root CLAUDE.md, "Scroll and touch rules").
    this._onTouchMove = (e) => { if (this.screen === 'play' || this.screen === 'spin') e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._relabel();
  }

  /** Every translated label, re-applied on a language switch. */
  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    const s = this.settings;
    const seg = (role, key, ids, cur, label, extra) => {
      const el = this.root.querySelector(`[data-role="${role}"]`);
      el.setAttribute('aria-label', t(key));
      el.innerHTML = ids.map((id) => `<button type="button" class="gh-seg__item ep-seg-item" data-${role.toLowerCase()}="${id}" aria-pressed="${cur === id}">${extra ? extra(id) : ''}<span>${esc(label(id))}</span></button>`).join('');
    };
    seg('modes', 'aria_opp', MODES, s.mode, (id) => t(id === 'cpu' ? 'opp_cpu' : 'opp_pass'), (id) => (id === 'cpu' ? CPU_SVG : PASS_SVG));
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('racksSeg', 'racks', RACK_OPTIONS.map(String), String(s.racks), (id) => id);
    this.root.querySelector('[data-role="diffs"]').hidden = s.mode !== 'cpu';
    this.root.querySelector('[data-role="continueBtn"]').hidden = !this._savedMatch();
    this.root.querySelector('[data-role="helpGroups"]').innerHTML = `${ballSVG('a', 20)}${ballSVG('b', 20)}<span aria-hidden="true">→</span>${ballSVG('eight', 20)}`;
    this._paintSpin();
    if (this.seats) { this.seats = this._seatsFor(this.mode, this.diff); this._hud(); }
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'help') this._fitHelp();
    if (this.screen === 'play') this._status();
  }

  /** Every how-to line on one row: measured, shrunk until it fits, never below 11px
   *  (docs/BUILDING-A-GAME.md, "How-to-play screens"). */
  _fitHelp() {
    this.root.querySelectorAll('.ep-help-goal, .ep-help-line').forEach((el) => {
      el.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(el).fontSize) || 13;
      while (el.scrollWidth > el.clientWidth + 0.5 && fs > 11) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
    });
  }

  _savedMatch() {
    const s = readJSON(SAVE_KEY);
    if (!s || !MODES.includes(s.mode) || !validMatch(s.match) || s.match.winner != null) return null;
    return s;
  }

  _say(s) { this.liveEl.textContent = s; }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-setup', name === 'setup' || (name === 'help' && !this.match));
  }

  _showSetup() {
    this.screen = 'setup';
    this.match = null;
    this.seats = null;
    this.mode = null;
    this.timers = [];
    this.phase = 'idle';
    this.aim = null;
    this.drag = null;
    this.cpu = null;
    this.ev = null;
    this.showB = null;
    this.sinking = []; this.bursts = [];
    this.banner.classList.remove('is-show');
    this._relabel();
    this._showOnly('setup');
    this._draw();
  }

  // --- layout ----------------------------------------------------------------------------------
  /** The table as big as fits under the scoreboard and status line, measured from the root's real
   *  size (docs/BUILDING-A-GAME.md, Part 3). */
  _layout() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._size = w + 'x' + h;
    this._fitStatus();
    const rootTop = this.root.getBoundingClientRect().top;
    const statusBottom = this.statusEl.getBoundingClientRect().bottom - rootTop;
    const safe = this.root.querySelector('[data-role="safe"]').offsetHeight || 0;
    const top = Math.max(0, statusBottom) + 4;
    const box = { x: 4, y: top, w: w - 8, h: Math.max(160, h - top - 6 - safe) };
    this._safe = safe;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.r.layout(w, h, box);
    const mid = this.r.toPx(W / 2, H / 2);
    this.root.style.setProperty('--ep-banner-y', Math.round(mid.y) + 'px');
    this._draw();
  }

  // --- the match -------------------------------------------------------------------------------
  _seatsFor(mode, diff) {
    const p = profile();
    if (mode === 'pass') {
      return [
        { name: (p && p.name) || t('player1'), emoji: (p && p.emoji) || '🙂', human: true },
        { name: t('player2'), emoji: '😎', human: true },
      ];
    }
    const o = p && p.opponents && p.opponents[0];
    return [
      { name: (p && p.name) || t('player1'), emoji: (p && p.emoji) || '🙂', human: true },
      { name: (o && o.name) || t('computer'), emoji: (o && o.emoji) || '🤖', human: false, diff },
    ];
  }

  _newMatch() {
    const s = this.settings;
    const breaker = s.nextBreaker;
    s.nextBreaker = breaker ^ 1;            // the break alternates, match to match
    writeJSON(SETTINGS_KEY, s);
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(s.racks, breaker, seed) });
  }

  _continue() {
    const sv = this._savedMatch();
    if (!sv) { this._newMatch(); return; }
    const m = sv.match;
    // A shot that was still rolling when the app went away: play it out now, exactly as it would have.
    let ended = false;
    if (sv.shot) {
      const r = play(m, sv.shot);
      if (r && r.kind === 'rack') nextRack(m);
      ended = !!r && r.kind === 'win';
    }
    this._begin({ mode: sv.mode, diff: DIFFS.includes(sv.diff) ? sv.diff : 'medium', match: m });
    if (ended) this._finish();
  }

  _begin(g) {
    this.mode = g.mode;
    this.diff = g.diff;
    this.match = g.match;
    freeze(this.match.b);
    this.seats = this._seatsFor(g.mode, g.diff);
    this._relabel();
    this.screen = 'play';
    this.timers = [];
    this.aim = null; this.drag = null; this.cpu = null; this.ev = null; this.showB = null;
    this.sinking = []; this.bursts = [];
    this.spin = 0;
    this._paintSpin();
    this._showOnly(null);
    this._hud();
    if (this.match.winner != null) return;   // replayed to a win: _continue shows the result
    this._save();
    this._startTurn(true);
  }

  /** `shot`: the shot about to be played from this position. Saved WITH the position, so an app
   *  killed or reloaded while the shot rolls replays that same shot on Continue (the engine is
   *  deterministic) instead of handing it back. */
  _save(shot = null) {
    const m = this.match;
    if (!m || !this.mode) return;
    if (m.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    if (!atRest(m.b) || this.phase === 'moving') return;
    writeJSON(SAVE_KEY, shot ? { mode: this.mode, diff: this.diff, match: m, shot } : { mode: this.mode, diff: this.diff, match: m });
  }

  /** A seat's group as shown: its balls' picture and how many are left, the 8 once they are all
   *  down, nothing while the table is open. */
  _groupOf(seat) {
    const m = this.match;
    if (!m || !m.groups) return { g: null, left: 0 };
    const g = m.groups[seat];
    const left = ballsOf(g).filter((i) => m.b[i].on).length;
    return { g: left ? g : 'eight', left };
  }

  _hud() {
    const m = this.match;
    if (!m || !this.seats) return;
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      const gi = this._groupOf(i);
      this.root.querySelector(`[data-role="ava${i}"]`).textContent = s.emoji;
      this.root.querySelector(`[data-role="name${i}"]`).textContent = s.name;
      this.root.querySelector(`[data-role="grp${i}"]`).innerHTML = gi.g ? `${ballSVG(gi.g, 18)}${gi.g !== 'eight' ? `<i>${gi.left}</i>` : ''}` : '';
      const sc = this.root.querySelector(`[data-role="score${i}"]`);
      sc.textContent = m.racks > 1 ? String(m.scores[i]) : '';
      sc.hidden = m.racks <= 1;
      const turn = m.turn === i && m.winner == null;
      this.sideEls[i].classList.toggle('is-turn', turn);
      const groupWord = !gi.g ? t('group_open') : gi.g === 'eight' ? t('group_eight') : t('group_' + gi.g);
      this.sideEls[i].setAttribute('aria-label', t('aria_side', { name: s.name, group: groupWord, left: gi.left }));
    }
    // The whole surround is the turn colour (reference/pool/SPEC.md): warm for seat 0, sky for seat 1.
    this.root.classList.toggle('ep-turn-0', m.turn === 0);
    this.root.classList.toggle('ep-turn-1', m.turn === 1);
    const gw = (i) => { const gi = this._groupOf(i); return !gi.g ? t('group_open') : gi.g === 'eight' ? t('group_eight') : t('group_' + gi.g); };
    this.canvas.setAttribute('aria-label', t('aria_table', { a: this.seats[0].name, ga: gw(0), b: this.seats[1].name, gb: gw(1) }));
  }

  _status() {
    const m = this.match;
    if (!m || this.screen === 'setup' || m.winner != null) { this.statusEl.textContent = ''; return; }
    const s = this.seats[m.turn];
    let txt;
    if (this.phase === 'moving' || this.phase === 'pause') txt = '';
    else if (!s.human && (this.phase === 'cpu' || this.phase === 'cpuplace' || this.phase === 'cpuaim')) txt = t('status_cpu', { name: s.name });
    else if (!m.broke) txt = t('status_break', { name: s.name });
    else if (m.inHand) txt = t('status_hand', { name: s.name });
    else if (m.groups && onEight(m, m.turn)) txt = t('status_eight', { name: s.name });
    else txt = t('status_turn', { name: s.name });
    this.statusEl.textContent = txt;
    this._fitStatus();
  }

  /** The status line keeps its whole text: shrunk to fit, never below 11px. */
  _fitStatus() {
    const el = this.statusEl;
    if (!el) return;
    el.style.fontSize = '';
    if (!el.clientWidth) return;
    let fs = parseFloat(getComputedStyle(el).fontSize) || 14;
    while (el.scrollWidth > el.clientWidth + 0.5 && fs > 11) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
  }

  _startTurn(announce) {
    const m = this.match;
    const s = this.seats[m.turn];
    this.aim = null;
    this.drag = null;
    this.bad = false;
    this._hud();
    if (announce) this._say(t('say_turn', { name: s.name }));
    if (s.human) {
      this.phase = 'aim';
    } else {
      this.phase = 'cpu';
      this.cpu = { gen: planShot(m, m.turn, this.diff), started: this.clock, shot: null };
    }
    this._status();
  }

  /** The computer thinks a slice at a time, puts the cue ball down if it has it in hand, shows its
   *  cue drawing back, then shoots. */
  _cpuTick() {
    const c = this.cpu;
    if (!c) return;
    const m = this.match;
    if (!c.shot) {
      const until = performance.now() + CPU_SLICE_MS;
      while (performance.now() < until) {
        const r = c.gen.next();
        if (r.done) { c.shot = r.value; break; }
      }
      if (!c.shot) return;
    }
    const sh = c.shot;
    if (this.phase === 'cpu' && this.clock - c.started >= CPU_MIN_THINK) {
      if (m.inHand && Number.isFinite(sh.x)) {
        this.phase = 'cpuplace';
        c.from = { x: m.b[CUE].x, y: m.b[CUE].y };
        c.at = this.clock;
      } else { this.phase = 'cpuaim'; c.at = this.clock; }
    }
    if (this.phase === 'cpuplace') {
      const k = this.reduce ? 1 : Math.min(1, (this.clock - c.at) / CPU_PLACE_SECS);
      const e = k * k * (3 - 2 * k);
      m.b[CUE].x = c.from.x + (sh.x - c.from.x) * e;
      m.b[CUE].y = c.from.y + (sh.y - c.from.y) * e;
      if (k >= 1) { this.phase = 'cpuaim'; c.at = this.clock; }
      return;
    }
    if (this.phase === 'cpuaim') {
      const k = this.reduce ? 1 : Math.min(1, (this.clock - c.at) / CPU_AIM_SECS);
      const len = Math.sqrt(sh.dx * sh.dx + sh.dy * sh.dy) || 1;
      this.aim = { dx: sh.dx / len, dy: sh.dy / len, power: sh.p * k, contact: null, short: true };
      if (k >= 1) {
        this.aim = null;
        this.cpu = null;
        this._shoot(sh);
      }
    }
  }

  /** Take a shot ({x?, y?, dx, dy, p, s}). Rounded to fixed decimals first, so the saved shot (and a
   *  future online one) replays exactly what this phone played. */
  _shoot(raw) {
    const m = this.match;
    if (!m || m.winner != null) return;
    const len = Math.sqrt(raw.dx * raw.dx + raw.dy * raw.dy) || 1;
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const shot = { dx: r6(raw.dx / len), dy: r6(raw.dy / len), p: Math.round(Math.max(0, Math.min(1, raw.p)) * 1e4) / 1e4, s: Math.round((raw.s || 0) * 100) / 100 };
    if (m.inHand && Number.isFinite(raw.x)) { shot.x = Math.round(raw.x * 1000) / 1000; shot.y = Math.round(raw.y * 1000) / 1000; }
    this._save(shot);   // the position the shot was taken from, and the shot
    const ev = begin(m, shot);
    if (!ev) { this._startTurn(false); return; }
    this.ev = ev;
    this.potSeen = 0;
    this.phase = 'moving';
    this.acc = 0;
    this.shotSteps = 0;
    this.spin = 0;
    this._paintSpin();
    this._status();
  }

  /** Advance the rolling table by real time `dt`. */
  _physics(dt) {
    const m = this.match;
    this.acc = Math.min(this.acc + dt, MAX_STEPS * DT);
    let n = 0;
    while (this.acc >= DT && n < MAX_STEPS) {
      this.acc -= DT; n++;
      step(m.b, this.ev);
      this.shotSteps++;
      this._notePots();
      if (atRest(m.b) || this.shotSteps >= maxShotSteps()) { this._rest(); return; }
    }
  }

  /** A ball just dropped: it sinks into its pocket, and a ring bursts out in its group's colour. */
  _notePots() {
    const ev = this.ev;
    while (this.potSeen < ev.pots.length) {
      const i = ev.pots[this.potSeen], k = ev.pocketAt[this.potSeen];
      this.potSeen++;
      const o = this.match.b[i], p = POCKETS[k];
      this.sinking.push({ i, x: o.x, y: o.y, px: p.cx, py: p.cy, k: 1, at: this.clock });
      const g = i === CUE ? 'cue' : i === EIGHT ? 'eight' : i < 8 ? 'a' : 'b';
      if (!this.reduce) this.bursts.push({ k, g, f: 0, at: this.clock });
      this._hud();
    }
  }

  _rest() {
    const m = this.match;
    const ev = this.ev;
    this.ev = null;
    freeze(m.b);
    const r = settle(m, ev);
    this.phase = 'idle';
    this._hud();
    if (r.kind === 'win') { this._finish(); return; }
    if (r.kind === 'rack') {
      // The next rack is set up (and saved) now; the old one stays on screen under the banner.
      const w = r.rackWinner;
      this.showB = cloneBalls(m.b);
      nextRack(m);
      this._save();
      this.phase = 'pause';
      this._bannerShow(t('rack_won', { name: this.seats[w].name }), t('result_line', { a: m.scores[0], b: m.scores[1] }), w);
      this._say(t('say_rack', { name: this.seats[w].name }));
      this._status();
      this._after(RACK_PAUSE, () => { this.showB = null; this.sinking = []; this._startTurn(true); });
      return;
    }
    if (r.kind === 'foul') {
      this._bannerShow(t('foul'), t('foul_' + r.foul), m.turn);
      this._say(t('say_foul', { why: t('foul_' + r.foul), name: this.seats[m.turn].name }));
    }
    this._save();
    this._startTurn(r.kind !== 'again');
  }

  /** Leaving mid-shot: play it out now, off screen, so the result stands (a pot in flight counts). */
  _settleNow() {
    const m = this.match;
    if (!m || m.winner != null) return;
    if (this.phase === 'moving' && this.ev) {
      runToRest(m.b, this.ev);
      const r = settle(m, this.ev);
      this.ev = null;
      this.phase = 'idle';
      if (r.kind === 'rack') nextRack(m);
      if (r.kind === 'win') this._record();
    } else if (this.phase === 'pause') {
      this.timers = [];
      this.showB = null;
      this.phase = 'idle';
    }
  }

  _record() {
    const m = this.match;
    if (!m || m.winner == null || m.recorded || this.mode !== 'cpu') return;
    m.recorded = true;
    try {
      const st = recordResult(STATS_ID, this.diff, m.winner === 0);
      if (!st) console.warn('[eight-ball] result not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[eight-ball] recording the result failed', err); }
  }

  _finish() {
    const m = this.match;
    if (!m || m.winner == null) return;
    this._record();
    this._save();
    this._say(t('say_win', { name: this.seats[m.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this._hud();
    this._status();
    this._fillResult();
    this._showOnly('result');
    this.root.querySelector('[data-ov="result"] [data-act="again"]').focus({ preventScroll: true });
  }

  _fillResult() {
    const m = this.match;
    if (!m || m.winner == null) return;
    const w = this.seats[m.winner];
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = t('win_name', { name: w.name });
    const line = this.root.querySelector('[data-role="resLine"]');
    line.textContent = m.racks > 1 ? t('result_line', { a: m.scores[0], b: m.scores[1] }) : '';
    line.hidden = m.racks <= 1;
  }

  // --- effects ---------------------------------------------------------------------------------
  _bannerShow(main, sub, seat) {
    this.root.querySelector('[data-role="bannerMain"]').textContent = main;
    this.root.querySelector('[data-role="bannerSub"]').textContent = sub || '';
    this.banner.dataset.seat = String(seat);
    this.banner.classList.toggle('is-long', main.length > 8);
    this.banner.classList.remove('is-show');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('is-show'), 1600);
  }

  /** Run `fn` after `sec` of GAME time (stops while a menu is open). */
  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  _paintSpin() {
    const b = this.root.querySelector('[data-role="spinBtn"]');
    if (b) {
      b.innerHTML = spinSVG(this.spin);
      b.setAttribute('aria-label', t('aria_spin', { v: t(this.spin > 0 ? 'spin_follow' : this.spin < 0 ? 'spin_draw' : 'spin_none') }));
      b.classList.toggle('is-set', this.spin !== 0);
    }
    const dot = this.root.querySelector('[data-role="spinDot"]');
    if (dot) dot.setAttribute('cy', String(50 - this.spin * 38 * 0.92));
  }

  // --- input -----------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-modes], [data-diffs], [data-racksseg]');
    if (seg) {
      const s = this.settings;
      if (seg.dataset.modes) s.mode = seg.dataset.modes;
      else if (seg.dataset.diffs) s.difficulty = seg.dataset.diffs;
      else s.racks = Number(seg.dataset.racksseg);
      writeJSON(SETTINGS_KEY, s);
      this._relabel();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') this._newMatch();
    else if (act === 'continue') this._continue();
    else if (act === 'howto') { this._helpFrom = this.screen; this.screen = 'help'; this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') {
      if (this._helpFrom === 'menu') { this.screen = 'menu'; this._showOnly('menu'); }
      else this._showSetup();
    }
    else if (act === 'menu') { if (this.screen === 'play') { this.screen = 'menu'; this._dropAim(); this._showOnly('menu'); } }
    else if (act === 'spin') { if (this.screen === 'play') { this.screen = 'spin'; this._dropAim(); this._paintSpin(); this._showOnly('spin'); } }
    else if (act === 'spinClose') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'spinZero') { this.spin = 0; this._paintSpin(); this.screen = 'play'; this._showOnly(null); }
    else if (act === 'exit') {
      // The setup card's X: leave the way the hub's own back pill does.
      const back = document.querySelector('.hub-back');
      if (back && !back.hidden) back.click(); else location.href = '../';
    }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._settleNow(); this._save(); if (this.match && this.match.winner != null) this._finish(); else this._showSetup(); }
    else if (act === 'again') this._newMatch();
    else if (act === 'toSetup') this._showSetup();
  }

  /** A menu or the spin pad opened mid-aim: the aim is dropped, a cue ball being placed stays put. */
  _dropAim() {
    if (this.drag && this.drag.mode === 'place') this._placeEnd();
    this.drag = null;
    if (this.phase === 'aim') this.aim = null;
  }

  _local(e) {
    const rc = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  }

  _pointerDown(e) {
    const m = this.match;
    if (e.button !== 0 || this.drag) return;   // the main button / one finger; a second touch is ignored
    if (this.screen !== 'play' || this.phase !== 'aim' || !m || !this.seats[m.turn].human) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive */ }
    const lp = this._local(e);
    const c = m.b[CUE];
    const cp = this.r.toPx(c.x, c.y);
    const d = Math.sqrt((lp.x - cp.x) ** 2 + (lp.y - cp.y) ** 2);
    if (m.inHand && d <= Math.max(R * 2.6 * this.r.s, 26)) {
      // Ball in hand: a touch on the cue ball picks it up.
      this.drag = { id: e.pointerId, mode: 'place', ox: cp.x - lp.x, oy: cp.y - lp.y, from: { x: c.x, y: c.y } };
      this.aim = null;
      return;
    }
    this.drag = { id: e.pointerId, mode: 'aim', sx: lp.x, sy: lp.y, base: Math.max(PULL_SAFE_PX, d) };
    this._aimFrom();
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const lp = this._local(e);
    if (d.mode === 'place') { this._placeMove(lp); return; }
    d.sx = lp.x; d.sy = lp.y;
    this._aimFrom();
    if (this._inNoShotStrip(e.clientY) && this.aim) this.aim.idle = true;
  }

  /** The cue ball follows the finger; a spot that is not allowed shows as such, and letting go there
   *  puts it on the nearest spot that is. */
  _placeMove(lp) {
    const m = this.match, d = this.drag;
    const p = this.r.toTable(lp.x + d.ox, lp.y + d.oy);
    const kitchen = m.inHand === 'kitchen';
    const x = Math.max(R, Math.min(W - R, p.x));
    const y = Math.max(kitchen ? HEAD_Y : R, Math.min(H - R, p.y));
    m.b[CUE].x = x; m.b[CUE].y = y;
    this.bad = !canPlace(m.b, x, y, kitchen);
  }
  _placeEnd() {
    const m = this.match;
    const c = m.b[CUE];
    const kitchen = m.inHand === 'kitchen';
    if (!canPlace(m.b, c.x, c.y, kitchen)) { const p = nearestPlace(m.b, c.x, c.y, kitchen); c.x = p.x; c.y = p.y; }
    this.bad = false;
  }

  /** Is this screen height (clientY) inside the home bar, where letting go never shoots (Flick
   *  Soccer, 2026-10-16: the phone's own swipe gestures live there)? */
  _inNoShotStrip(clientY) {
    const rc = this.canvas.getBoundingClientRect();
    return clientY - rc.top > rc.height - (this._safe || 0);
  }

  /** The aim, read on SCREEN: the shot goes from the finger through the cue ball; the strength is
   *  how far the finger has moved away from the ball past the closest it came (never nearer than the
   *  safe zone), over a full pull's travel, which shrinks where the screen's edge comes first. */
  _aimFrom() {
    const m = this.match, d = this.drag, r = this.r;
    const c = m.b[CUE];
    const bo = r.toPx(c.x, c.y);
    const vx = d.sx - bo.x, vy = d.sy - bo.y, len = Math.sqrt(vx * vx + vy * vy);
    d.base = Math.max(PULL_SAFE_PX, Math.min(d.base, len));
    const fp = r.toTable(d.sx, d.sy);
    if (!(len > 0)) { this.aim = { dx: 0, dy: -1, power: 0, idle: true }; return; }
    const ux = vx / len, uy = vy / len;
    // Room along the pull to the screen's edge (the bottom adds the home bar).
    const safe = this._safe || 0;
    let room = Infinity;
    if (ux > 0) room = Math.min(room, (r.w - EDGE_M - bo.x) / ux); else if (ux < 0) room = Math.min(room, (EDGE_M - bo.x) / ux);
    if (uy > 0) room = Math.min(room, (r.h - EDGE_M - safe - bo.y) / uy); else if (uy < 0) room = Math.min(room, (EDGE_M - bo.y) / uy);
    const travel = Math.max(PULL_MIN_PX, Math.min(PULL_FULL_PX, room - d.base));
    const power = Math.max(0, Math.min(1, (len - d.base) / travel));
    const dx = -ux, dy = -uy;
    const aids = this._aids();
    const a = { dx, dy, power, fx: fp.x, fy: fp.y, idle: power < MIN_POWER };
    if (aids.contact) {
      a.contact = aimContact(m.b, dx, dy);
      a.paths = aids.paths;
      if (a.contact && a.contact.hit >= 0 && aids.paths === 'long') {
        const q = m.b[a.contact.hit];
        const k = a.contact;
        const reach = 18 + 60 * Math.max(0, k.ox * dx + k.oy * dy);
        a.objEnd = rayStop(m.b, q.x, q.y, k.ox, k.oy, reach, [CUE, a.contact.hit]);
      }
    } else a.short = true;
    this.aim = a;
  }

  /** Vs the computer: its difficulty. Two players on one phone: Medium. */
  _aids() { return AIDS[this.mode === 'cpu' ? this.diff : 'medium'] || AIDS.medium; }

  _pointerUp(e, cancel) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.mode === 'place') { this._placeEnd(); return; }
    const a = this.aim;
    this.aim = null;
    if (cancel || !a || a.idle || a.power < MIN_POWER || this.phase !== 'aim' || this.screen !== 'play') return;
    if (this._inNoShotStrip(e.clientY) || document.hidden) return;
    const m = this.match;
    const shot = { dx: a.dx, dy: a.dy, p: a.power, s: this.spin };
    if (m.inHand) { shot.x = m.b[CUE].x; shot.y = m.b[CUE].y; }
    this._shoot(shot);
  }

  // --- loop ------------------------------------------------------------------------------------
  _start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this._frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  _frame(dt) {
    const live = this.screen === 'play';
    if (live) {
      this.clock += dt;
      this.glowT += dt;
      if (this.timers.length) {
        const due = this.timers.filter((x) => x.at <= this.clock);
        this.timers = this.timers.filter((x) => x.at > this.clock);
        for (const x of due) x.fn();
      }
      if (this.phase === 'moving') this._physics(dt);
      else if (this.phase === 'cpu' || this.phase === 'cpuplace' || this.phase === 'cpuaim') this._cpuTick();
      for (const s of this.sinking) s.k = Math.max(0, 1 - (this.clock - s.at) / SINK_SECS);
      this.sinking = this.sinking.filter((s) => s.k > 0);
      for (const bu of this.bursts) bu.f = (this.clock - bu.at) / BURST_SECS;
      this.bursts = this.bursts.filter((bu) => bu.f < 1);
    }
    this._draw();
  }

  _draw() {
    if (!this.r || !this.r.w) return;
    const m = this.match;
    const human = !!m && this.phase === 'aim' && this.seats && this.seats[m.turn].human;
    const halo = human ? (this.reduce ? 1 : 0.7 + 0.3 * Math.sin(this.glowT * 3.4)) : 0;
    const b = m ? this.showB || m.b : null;
    const inHandShown = m && !this.showB && m.inHand && (human || this.phase === 'cpuplace') ? m.inHand : null;
    this.r.draw({
      b,
      halo,
      aim: this.aim && !this.aim.idle ? this.aim : null,
      inHand: inHandShown,
      bad: this.bad,
      t: this.glowT,
      sinking: this.sinking,
      bursts: this.bursts,
    });
  }

  destroy() {
    this._stop();
    this._settleNow();
    this._save();
    clearTimeout(this._bannerTimer);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.reduceMQ.removeEventListener) this.reduceMQ.removeEventListener('change', this._onReduce);
    if (this._offResize) this._offResize();
    if (this._ro) this._ro.disconnect();
    if (this._offLang) this._offLang();
    this.host.innerHTML = '';
  }
}

export function init(container) {
  if (instance) destroy();
  instance = new PoolUI(container);
  // Test seam: lets the headless checks drive a shot.
  if (typeof window !== 'undefined') window.__epTest = { ui: instance };
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
  if (typeof window !== 'undefined' && window.__epTest && window.__epTest.ui === i) delete window.__epTest;
}
/** Autosave meaning: the match is saved at every rest and resumes, so leaving loses nothing. */
export function isInProgress() { return false; }
export default { init, destroy, isInProgress };
