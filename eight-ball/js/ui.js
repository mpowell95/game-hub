// eight-ball/js/ui.js - Pool's DOM shell: setup, the play screen (one canvas table under a
// scoreboard with each player's balls), GamePigeon's input (aim on the table, power on a meter), ball in hand
// (with a lock-in tick above Easy), calling a pocket, spin, the turn flow for two or three players,
// the computer, menus, autosave and stats. Rules and physics live in engine.js, the computer in
// ai.js, pixels in render.js.
//
// isInProgress(): the AUTOSAVE meaning. The match is saved every time the table comes to rest
// (gamehub.eightball.save.v2) and the setup screen offers Continue, so leaving is lossless and this
// returns false. Leaving while a shot is still rolling plays that shot out first (_settleNow), so a
// pot in flight is never lost and a bad shot can never be taken back by quitting. A match is
// recorded once it is won, against the computer only. An ONLINE challenge (Stage 2, mp.js) lives on
// the server, every shot written the moment it is taken, so leaving one loses nothing either.

import {
  newMatch, validMatch, step, atRest, freeze, settle, begin, play, nextRack, runToRest, maxShotSteps,
  aimContact, rayStop, canPlace, nearestPlace, onEight, needCall, targetsOf, cloneBalls, ballsOf,
  seatsOf, CUE, R, W, H, DT, HEAD_Y, POCKETS, RACK_OPTIONS, MODES, TABLE_NOW, TB, useTable, tableOf,
} from './engine.js';
import { planShot, seededRng, DIFFS } from './ai.js';
import { createRenderer, ballSVG, ballPaint, LOOKS } from './render.js';
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
/** v2 (2026-10-22, the modes): a different match shape. The v1 key is left where it was, unread. */
const SAVE_KEY = 'gamehub.eightball.save.v2';
const OPPS = ['cpu', 'pass'];
const OPTS = ['call', 'bank', 'obst'];
/** GamePigeon's controls (Matt, 2026-10-22, replacing the slingshot, which ran out of screen with
 *  the cue ball against a cushion): a touch on the table points the cue at the finger; the power is
 *  a meter beside the table, dragged DOWN, and letting go shoots (back up to the top: no shot).
 *  The meter (touch area `METER_W` px wide, the bar drawn 26 px wide in its middle) is `METER_K` of
 *  the table's height, `METER_GAP` px left of it; full power is `METER_TRAVEL` of its height. The table keeps `SIDE_K` of the width free on each side
 *  (at least `SIDE_MIN` px), as there. */
const METER_W = 46;
const METER_K = 0.47;
const METER_GAP = 0;
const METER_TRAVEL = 0.8;
const SIDE_K = 0.115;
const SIDE_MIN = 44;
/** The aim drag (ui.js _pointAt): finger wobble ignored before it counts, and the nearest a finger
 *  counts as being to the cue ball when turning the cue (closer still does not turn it faster). */
const AIM_DEAD_PX = 8;
const AIM_NEAR_PX = 90;
/** The match's table (engine.js, TABLE VERSIONS); the setup screen shows today's. */
const tbOf = (m) => (m ? tableOf(m) : TABLE_NOW);
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

/** How much aiming help each difficulty gets (Matt, 2026-10-22): Easy, the line to the first thing
 *  the cue ball meets, a ghost ball there, and a short line for where that ball goes, fading out;
 *  Medium, the line and the ghost ball; Hard, no lines at all. Easy and Medium also ring the balls
 *  you may hit first. Ball in hand is free on Easy; above it the spot is locked in with the tick
 *  before aiming (Matt: "in medium or hard you should have to lock in where you put the ball").
 *  Two or three players on one phone play Medium. */
const AIDS = {
  easy: { line: true, obj: true, rings: true, freeHand: true },
  medium: { line: true, obj: false, rings: true, freeHand: false },
  hard: { line: false, obj: false, rings: false, freeHand: false },
};

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) { console.error('[eight-ball] save failed: ' + k, err); return false; }
}
function profile() { try { return loadProfile(); } catch { return null; } }

/** Saved choices beat the profile's first opponent skill (1/2/3 -> easy/medium/hard) beat Medium.
 *  The fields added 2026-10-22 (game, options, balls) read their defaults when absent. */
function loadSettings() {
  const s = readJSON(SETTINGS_KEY) || {};
  let difficulty = DIFFS.includes(s.difficulty) ? s.difficulty : null;
  if (!difficulty) {
    const p = profile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : 2;
    difficulty = skill === 1 ? 'easy' : skill === 3 ? 'hard' : 'medium';
  }
  const o = s.opts && typeof s.opts === 'object' ? s.opts : {};
  return {
    game: MODES.includes(s.game) ? s.game : '8',
    mode: OPPS.includes(s.mode) ? s.mode : 'cpu',
    difficulty,
    racks: RACK_OPTIONS.includes(s.racks) ? s.racks : 1,
    opts: { call: !!o.call, bank: !!o.bank, obst: !!o.obst },
    look: LOOKS.includes(s.look) ? s.look : 'classic',
    aimHelp: DIFFS.includes(s.aimHelp) ? s.aimHelp : 'medium',   // a challenge's aiming help (Stage 2)
    nextBreaker: Number.isInteger(s.nextBreaker) && s.nextBreaker >= 0 ? s.nextBreaker : 0,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const OK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const CPU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="7" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="12.5" r="1.6" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.6" fill="currentColor"/><path d="M12 7V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PASS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M14 14.6c.6-.2 1.3-.3 2-.3 2.4 0 4.2 1.4 4.8 4.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
/** The option chips' pictures: a pocket with an arrow into it, a ball off a cushion, a bottle. */
const OPT_SVG = {
  call: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="17" cy="7" r="4.5" fill="currentColor"/><path d="M5 19 L12.5 11.5 M12.5 11.5 h-5 M12.5 11.5 v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  bank: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M5 20 L12 6 L19 20" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.4" fill="none"/><circle cx="19" cy="19" r="2.6" fill="currentColor"/></svg>',
  obst: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 3h4v4l2 3v10a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 20V10l2-3z" fill="currentColor"/></svg>',
};
/** The spin button: the cue ball with a dot where the tip will strike it. */
const spinSVG = (s) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" fill="#F7EFCB" stroke="#2a2a2a" stroke-width="1.4"/><circle cx="12" cy="${(12 - s * 6).toFixed(2)}" r="2.6" fill="#E0532F" stroke="#fff" stroke-width="0.8"/></svg>`;

/** How to play: the cue drawn back from the cue ball, the shot, a ball dropping into a pocket. */
function helpSvg() {
  return `<svg class="ep-help-svg" viewBox="0 0 240 104" role="img" aria-hidden="true">
    <rect x="0" y="0" width="240" height="104" rx="10" fill="#6B3432"/>
    <rect x="7" y="7" width="226" height="90" rx="5" fill="#4A84BE"/>
    <rect x="11" y="11" width="218" height="82" rx="3" fill="#4B87C3"/>
    <circle cx="226" cy="14" r="8" fill="#000"/>
    <path d="M6 96 L58 66" stroke="#5A3420" stroke-width="6" stroke-linecap="round"/>
    <path d="M40 76 L64 62" stroke="#F1D9A6" stroke-width="4" stroke-linecap="round"/>
    <circle cx="20" cy="88" r="8" fill="#fff" opacity="0.85"/>
    <path d="M20 88 L70 58" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>
    <circle cx="76" cy="54" r="8" fill="#F7EFCB" stroke="#222" stroke-width="1"/>
    <path d="M86 48 L160 22" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3"/>
    <circle cx="166" cy="20" r="8" fill="none" stroke="#fff" stroke-width="1.4"/>
    <circle cx="180" cy="22" r="8" fill="#D8262C" stroke="#222" stroke-width="1"/>
    <circle cx="180" cy="22" r="4.4" fill="#fff"/><text x="180" y="25" text-anchor="middle" font-size="7" font-weight="800" font-family="system-ui,sans-serif" fill="#141414">3</text>
    <path d="M190 20 Q206 16 218 15" stroke="#ffce3a" stroke-width="2.5" stroke-dasharray="5 4" fill="none"/>
    <path d="M222 14 L211 10 L213 20 Z" fill="#ffce3a"/>
  </svg>`;
}

let instance = null;
/** Everybody in an online match but this phone's player, as {code, name, emoji} (Challenge again). */
const othersOfMine = (mp) => mp.game.p.filter((_, k) => k !== mp.seat).map((x) => ({ code: x.code, name: x.name, emoji: x.emoji }));
/** Where the quick-chat button sits (js/match-chat-ui.js `place`): the top row, left of the spin and
 *  menu buttons (each 44px, 8px apart, from `right: 10px`); its bubbles come down under the
 *  scoreboard and the status line, so a line never covers the score or whose turn it is. */
const CHAT_PLACE = { top: 'var(--ep-top)', right: '114px', popsTop: 'calc(var(--ep-top) + 140px)' };

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
    this.call = -1;                // the pocket called for this shot (-1 none yet)
    this.placing = false;          // ball in hand, not yet locked in with the tick
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
      if (document.hidden) { this._dropAim(); this._stop(); this._save(); }
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
    // Shots queued while offline go out on mount and the moment the connection comes back.
    this._onOnline = () => this._drainAll();
    window.addEventListener('online', this._onOnline);
    setTimeout(() => { if (instance === this) this._drainAll(); }, 0);

    this._layout();
    this._showSetup();
    this._start();
    // A tapped launcher bubble or notification names a match: open it straight away. The hub's
    // Multiplayer screen can also hand over a person to challenge ('pick').
    import('./alert.js').then((A) => {
      const o = A.takeOpen();
      if (!o || instance !== this) return;
      if (o.kind === 'pick') this._openOnline(o.them); else this._openMatch(o.id);
    }).catch(() => {});
  }

  /** An option chip's picture (the challenge card draws them too). */
  optSVG(k) { return OPT_SVG[k] || ''; }

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
        <div class="ep-board" data-role="board"></div>
        <p class="ep-status" data-role="status"></p>
        <div class="ep-banner" data-role="banner" aria-hidden="true"><b data-role="bannerMain"></b><span data-role="bannerSub"></span></div>
        <button type="button" class="ep-ok" data-act="placeOk" data-role="ok" data-la="aria_ok" hidden>${OK_SVG}</button>
        <div class="ep-meter" data-role="meter" role="slider" data-la="aria_power" hidden><i class="ep-meter-track"><i class="ep-meter-fill"></i><i class="ep-meter-cue"></i></i></div>
        <button type="button" class="ep-skip" data-act="skip" data-role="skip" hidden><span data-l="mp_skip"></span></button>
        <span class="ep-safe" data-role="safe" aria-hidden="true"></span>

        <div class="ep-ov ep-ov-setup" data-ov="setup" hidden>
          <div class="ep-card">
            <button type="button" class="ep-x ep-q" data-act="howto" data-la="howto">?</button>
            <button type="button" class="ep-x" data-act="exit" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-logo" data-l="title"></h2>
            <button type="button" class="ep-mprow" data-act="multi">
              <b data-l="multiplayer"></b>
              <span class="ep-mprow-badge" data-role="onlineNote" hidden></span>
              <span class="ep-mprow-chev" aria-hidden="true">›</span>
            </button>
            <div class="gh-seg ep-seg ep-seg-big" role="group" data-role="games"></div>
            <div class="gh-seg ep-seg" role="group" data-role="modes"></div>
            <div class="gh-seg ep-seg" role="group" data-role="diffs"></div>
            <div class="ep-opts" role="group" data-role="opts"></div>
            <div class="ep-row">
              <span class="ep-label" data-l="racks"></span>
              <div class="gh-seg ep-seg ep-seg-racks" role="group" data-role="racksSeg"></div>
              <div class="gh-seg ep-seg ep-seg-look" role="group" data-role="looks"></div>
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
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="quit" data-local><span data-l="quit"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="mpHome" data-online><span data-l="mp_back"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-danger" data-act="resign" data-online><span data-l="mp_resign"></span></button>
          </div>
        </div>

        <div class="ep-ov ep-ov-mp" data-ov="mp" hidden></div>

        <div class="ep-ov" data-ov="resign" hidden>
          <div class="ep-card ep-card-sm" role="dialog" aria-modal="true">
            <h2 class="ep-h2" data-l="mp_resign_q"></h2>
            <button type="button" class="gh-btn gh-btn--block ep-danger" data-act="resignYes"><span data-l="mp_resign_yes"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="menu"><span data-l="mp_cancel"></span></button>
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
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-role="againLabel"></span></button>
            <button type="button" class="gh-btn gh-btn--block ep-alt" data-act="toSetup"><span data-role="toSetupLabel"></span></button>
          </div>
        </div>

        <div class="ep-ov" data-ov="help" hidden>
          <div class="ep-card ep-help" role="dialog" aria-modal="true">
            <button type="button" class="ep-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ep-h2" data-l="howto"></h2>
            <div data-role="helpBody"></div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <p class="ep-toast" data-role="toast" role="status" hidden></p>
        <p class="ep-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.ep-root');
    this.canvas = q('.ep-canvas');
    this.banner = q('[data-role="banner"]');
    this.statusEl = q('[data-role="status"]');
    this.liveEl = q('[data-role="live"]');
    this.boardEl = q('[data-role="board"]');
    this.okEl = q('[data-role="ok"]');
    this.meterEl = q('[data-role="meter"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });

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
    this._onMeter = (e) => this._meter(e);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) this.meterEl.addEventListener(ev, this._onMeter);
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
      el.innerHTML = ids.map((id) => {
        const lb = label(id);
        return `<button type="button" class="gh-seg__item ep-seg-item" data-${role.toLowerCase()}="${id}" aria-pressed="${cur === id}"${lb ? '' : ` aria-label="${esc(t('look_' + id))}"`}>${extra ? extra(id) : ''}${lb ? `<span>${esc(lb)}</span>` : ''}</button>`;
      }).join('');
    };
    const n = seatsOf(s.game);
    seg('games', 'aria_mode', MODES, s.game, (id) => t('mode_' + id));
    seg('modes', 'aria_opp', OPPS, s.mode, (id) => (id === 'cpu' ? t('opp_cpu') : t(n === 3 ? 'opp_pass3' : 'opp_pass2')), (id) => (id === 'cpu' ? CPU_SVG : PASS_SVG));
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('racksSeg', 'racks', RACK_OPTIONS.map(String), String(s.racks), (id) => id);
    // The two looks, as pictures: a 3 and an 11 in each.
    seg('looks', 'aria_look', LOOKS, s.look, () => '', (id) => `${ballSVG(3, id, s.game === '9' ? '8' : s.game, 20)}${ballSVG(11, id, s.game === '9' ? '8' : s.game, 20)}`);
    const opts = this.root.querySelector('[data-role="opts"]');
    opts.setAttribute('aria-label', t('aria_opts'));
    opts.innerHTML = OPTS.map((k) => `<button type="button" class="ep-opt" data-opt="${k}" aria-pressed="${!!s.opts[k]}">${OPT_SVG[k]}<span>${esc(t('opt_' + k))}</span></button>`).join('');
    this.root.querySelector('[data-role="diffs"]').hidden = s.mode !== 'cpu';
    this.root.querySelector('[data-role="continueBtn"]').hidden = !this._savedMatch();
    this._paintOnlineNote();
    const online = this.mode === 'mp';
    this.root.querySelectorAll('[data-online]').forEach((el) => { el.hidden = !online; });
    this.root.querySelectorAll('[data-local]').forEach((el) => { el.hidden = online; });
    this._paintHelp();
    this._paintSpin();
    if (this.seats) { if (!online) this.seats = this._seatsFor(this.mode, this.diff, this.match.n); this._hud(); }
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'help') this._fitHelp();
    if (this.screen === 'play') this._status();
  }

  /** How to play, for the game being played (or chosen on the setup card), with a line for each
   *  option that is on. */
  _paintHelp() {
    const m = this.match;
    const game = m ? m.mode : this.settings.game;
    const opts = m ? m.opts : this.settings.opts;
    const look = this.settings.look;
    const balls = game === '9'
      ? [1, 2, 3].map((i) => ballSVG(i, look, '9', 20)).join('') + '<span aria-hidden="true">…</span>' + ballSVG(9, look, '9', 20)
      : game === 'ct'
        ? [1, 6, 11].map((i) => ballSVG(i, look, 'ct', 20)).join('')
        : `${ballSVG(1, look, '8', 20)}${ballSVG(9, look, '8', 20)}<span aria-hidden="true">→</span>${ballSVG(8, look, '8', 20)}`;
    const lines = [
      `<p class="ep-help-goal">${esc(t('help_goal_' + game))}</p>`,
      `<p class="ep-help-groups">${balls}</p>`,
      helpSvg(),
      `<p class="ep-help-line ep-help-cap">${esc(t('help_caption'))}</p>`,
      `<p class="ep-help-line ep-help-ex">${esc(t('help_example'))}</p>`,
      `<p class="ep-help-line">${esc(t('help_again_' + game))}</p>`,
      `<p class="ep-help-line">${esc(t('help_foul'))}</p>`,
    ];
    if (game === '8') lines.push(`<p class="ep-help-line">${esc(t('help_eight'))}</p>`);
    if (game === '9') lines.push(`<p class="ep-help-line">${esc(t('help_nine'))}</p>`);
    if (game === 'ct') lines.push(`<p class="ep-help-line">${esc(t('help_foul_ct'))}</p>`, `<p class="ep-help-line">${esc(t('help_out'))}</p>`);
    for (const k of OPTS) if (opts[k]) lines.push(`<p class="ep-help-line">${esc(t('help_' + k))}</p>`);
    lines.push(`<p class="ep-help-line">${esc(t('help_spin'))}</p>`);
    this.root.querySelector('[data-role="helpBody"]').innerHTML = lines.join('');
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
    if (!s || !OPPS.includes(s.mode) || !validMatch(s.match) || s.match.winner != null) return null;
    return s;
  }

  _say(s) { this.liveEl.textContent = s; }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-setup', name === 'setup' || name === 'mp' || (name === 'help' && !this.match));
    this._paintOk();
  }

  _showSetup() {
    const leftOnline = !!this.mp;
    this._mpLeave();
    if (leftOnline) this._drainAll();
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
    this.placing = false;
    this.sinking = []; this.bursts = [];
    this.banner.classList.remove('is-show');
    this.boardEl.innerHTML = '';
    this._relabel();
    this._showOnly('setup');
    this._draw();
    this._countOnline();
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
    const top = Math.max(0, statusBottom) + 8;
    const mx = Math.round(Math.max(SIDE_MIN, w * SIDE_K));
    const box = { x: mx, y: top, w: Math.max(120, w - 2 * mx), h: Math.max(160, h - top - 6 - safe), top: true };
    this._safe = safe;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    useTable(tbOf(this.match));
    this.r.layout(w, h, box);
    this._paintMeter();
    const mid = this.r.toPx(W / 2, H / 2);
    this.root.style.setProperty('--ep-banner-y', Math.round(mid.y) + 'px');
    this._paintOk();
    this._draw();
  }

  // --- the match -------------------------------------------------------------------------------
  _seatsFor(mode, diff, n) {
    const p = profile();
    const me = { name: (p && p.name) || t('player1'), emoji: (p && p.emoji) || '🙂', human: true };
    if (mode === 'pass') return [me, { name: t('player2'), emoji: '😎', human: true }, { name: t('player3'), emoji: '🤠', human: true }].slice(0, n);
    const o = (p && p.opponents) || [];
    const cpu = (k) => ({
      name: (o[k] && o[k].name) || t(k ? 'computer2' : 'computer'),
      emoji: (o[k] && o[k].emoji) || (k ? '👾' : '🤖'),
      human: false,
      diff,
    });
    return [me, cpu(0), cpu(1)].slice(0, n);
  }

  _newMatch() {
    const s = this.settings;
    const n = seatsOf(s.game);
    const breaker = s.nextBreaker % n;
    s.nextBreaker = (breaker + 1) % 6;      // the break moves round, match to match
    writeJSON(SETTINGS_KEY, s);
    const seed = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(s.game, s.racks, breaker, seed, s.opts) });
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
    useTable(tbOf(this.match));
    freeze(this.match.b);
    this.seats = g.seats || this._seatsFor(g.mode, g.diff, this.match.n);
    this.root.classList.toggle('ep-m9', this.match.mode === '9');
    this.root.classList.toggle('ep-n3', this.match.n === 3);
    this._buildBoard();
    this._relabel();
    this.screen = 'play';
    this.timers = [];
    this.aim = null; this.drag = null; this.cpu = null; this.ev = null; this.showB = null;
    this.sinking = []; this.bursts = [];
    this.spin = 0;
    this._paintSpin();
    this._showOnly(null);
    this._layout();
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
    if (!m || !this.mode || this.mode === 'mp') return;     // an online match lives on the server
    if (m.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    if (!atRest(m.b) || this.phase === 'moving') return;
    writeJSON(SAVE_KEY, shot ? { mode: this.mode, diff: this.diff, match: m, shot } : { mode: this.mode, diff: this.diff, match: m });
  }

  /** The scoreboard: one card per player (two or three), each with a second row of its balls. */
  _buildBoard() {
    const m = this.match;
    this.boardEl.innerHTML = `${this.seats.map((_, i) => `
      <div class="ep-side ep-side-${i}" data-side="${i}">
        <div class="ep-side-top">
          <span class="ep-ava" data-role="ava${i}"></span>
          <span class="ep-nm" data-role="name${i}"></span>
          <span class="ep-grp" data-role="grp${i}"></span>
          <b class="ep-sc" data-role="score${i}"></b>
        </div>
        <div class="ep-tray" data-role="tray${i}"></div>
      </div>`).join('')}${m.mode === '9' ? '<div class="ep-tray9" data-role="tray9"></div>' : ''}`;
    this.sideEls = this.seats.map((_, i) => this.boardEl.querySelector(`[data-side="${i}"]`));
  }

  _saveSettings() { writeJSON(SETTINGS_KEY, this.settings); }

  /** A seat's balls: its group (8-ball once decided, Cutthroat always), each shown down (faded,
   *  ticked) or still on the table. */
  _groupOf(seat) {
    const m = this.match;
    if (!m || !m.groups) return null;
    const g = m.groups[seat];
    const balls = ballsOf(g);
    const down = balls.filter((i) => !m.b[i].on).length;
    return { g, balls, down };
  }

  _hud() {
    const m = this.match;
    if (!m || !this.seats || !this.sideEls) return;
    const look = this.settings.look;
    const b = this.showB || m.b;
    for (let i = 0; i < m.n; i++) {
      const s = this.seats[i];
      const gi = this._groupOf(i);
      const q = (r) => this.boardEl.querySelector(`[data-role="${r}${i}"]`);
      q('ava').textContent = s.emoji;
      q('name').textContent = s.name;
      const eight = m.mode === '8' && gi && gi.down === gi.balls.length;
      q('grp').textContent = gi ? t(eight ? 'group_eight' : 'group_' + gi.g) : '';
      const sc = q('score');
      sc.textContent = m.racks > 1 ? String(m.scores[i]) : '';
      sc.hidden = m.racks <= 1;
      q('tray').innerHTML = gi
        ? gi.balls.map((k) => ballSVG(k, look, m.mode, 15, !b[k].on)).join('') + (eight ? `<span class="ep-tray-8">${ballSVG(8, look, '8', 15, !b[8].on)}</span>` : '')
        : '';
      const turn = m.turn === i && m.winner == null;
      this.sideEls[i].classList.toggle('is-turn', turn);
      this.sideEls[i].classList.toggle('is-out', !!m.out[i]);
      this.sideEls[i].setAttribute('aria-label', gi
        ? t('aria_side', { name: s.name, group: q('grp').textContent, down: gi.down, total: gi.balls.length })
        : t('aria_side_plain', { name: s.name }));
    }
    const t9 = this.boardEl.querySelector('[data-role="tray9"]');
    if (t9) {
      const on = [];
      for (let i = 1; i < b.length; i++) if (b[i].on) on.push(i);
      t9.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<span class="ep-t9${k === on[0] ? ' is-next' : ''}">${ballSVG(k, look, '9', 17, !b[k].on)}</span>`).join('');
      t9.setAttribute('aria-label', on.length ? t('aria_lowest', { n: on[0] }) : '');
    }
    // The whole surround is the turn colour (reference/pool/SPEC.md): one per seat.
    for (let k = 0; k < 3; k++) this.root.classList.toggle('ep-turn-' + k, m.turn === k);
    this.canvas.setAttribute('aria-label', t('aria_table'));
  }

  _status() {
    const m = this.match;
    if (!m || this.screen === 'setup' || m.winner != null) { this.statusEl.textContent = ''; return; }
    const s = this.seats[m.turn];
    let txt;
    const mp = this.mode === 'mp' ? this.mp : null;
    if (this.phase === 'moving' || this.phase === 'pause') txt = '';
    else if (mp && m.turn !== mp.seat) {
      const sending = this.phase === 'waiting' && (mp.pending.length || mp.sending);
      txt = t(this.phase !== 'waiting' ? 'status_mp_them' : sending ? 'status_mp_sending' : 'status_mp_wait', { name: s.name });
    }
    else if (!s.human && (this.phase === 'cpu' || this.phase === 'cpuplace' || this.phase === 'cpuaim')) txt = t('status_cpu', { name: s.name });
    else if (this.placing) txt = t('status_place', { name: s.name });
    else if (!m.broke) txt = t('status_break', { name: s.name });
    else if (needCall(m, m.turn) && this.call < 0) txt = t('status_call', { name: s.name });
    else if (m.inHand) txt = t('status_hand', { name: s.name });
    else if (onEight(m, m.turn)) txt = t('status_eight', { name: s.name });
    else if (m.mode === '8' && !m.groups) txt = t('status_open', { name: s.name });
    else txt = t('status_turn', { name: s.name });
    this.statusEl.textContent = txt;
    this._fitStatus();
    this._paintSkip();
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

  /** Vs the computer: its difficulty. Players sharing a phone: Medium. */
  _level() {
    if (this.mode === 'cpu') return this.diff;
    if (this.mode === 'mp' && this.mp && this.mp.game) return this.mp.game.aids;
    return 'medium';
  }
  _aids() { return AIDS[this._level()] || AIDS.medium; }

  _startTurn(announce) {
    const m = this.match;
    const s = this.seats[m.turn];
    this.aim = null;
    this.aimDir = null;
    this.power = 0;
    this.drag = null;
    this.bad = false;
    this.call = -1;
    this.placing = !!m.inHand && s.human && !this._aids().freeHand;
    this._hud();
    if (announce) this._say(t('say_turn', { name: s.name }));
    if (this.mode === 'mp') { this.placing = false; this._mpCatchUp(); this._paintOk(); return; }
    if (s.human) {
      this.phase = 'aim';
    } else {
      this.phase = 'cpu';
      this.cpu = { gen: planShot(m, m.turn, this.diff, seededRng(m, m.turn)), started: this.clock, shot: null };
    }
    this._status();
    this._paintOk();
  }

  /** The computer thinks a slice at a time, puts the cue ball down if it has it in hand, shows its
   *  cue drawing back (and the pocket it calls), then shoots. */
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
      if (Number.isInteger(sh.c) && needCall(m, m.turn)) this.call = sh.c;
      const k = this.reduce ? 1 : Math.min(1, (this.clock - c.at) / CPU_AIM_SECS);
      const len = Math.sqrt(sh.dx * sh.dx + sh.dy * sh.dy) || 1;
      this.aim = { dx: sh.dx / len, dy: sh.dy / len, power: sh.p * k, contact: null };
      if (k >= 1) {
        this.aim = null;
        this.cpu = null;
        this._shoot(sh, { replay: !!c.replay });
      }
    }
  }

  /** Take a shot ({x?, y?, dx, dy, p, s, c?}). Rounded to fixed decimals first, so the saved shot
   *  (and a future online one) replays exactly what this phone played. */
  _shoot(raw, opts = {}) {
    const m = this.match;
    if (!m || m.winner != null) return;
    if (this.mode === 'mp' && m.turn !== this.mp.seat && !opts.replay) return;
    const len = Math.sqrt(raw.dx * raw.dx + raw.dy * raw.dy) || 1;
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const shot = { dx: r6(raw.dx / len), dy: r6(raw.dy / len), p: Math.round(Math.max(0, Math.min(1, raw.p)) * 1e4) / 1e4, s: Math.round((raw.s || 0) * 100) / 100 };
    if (m.inHand && Number.isFinite(raw.x)) {
      // The cue ball's spot, ROUNDED, must still be a legal spot (rounding can nudge a ball placed
      // right against another a hair into it, and every replay would then refuse the shot).
      const r3 = (v) => Math.round(v * 1000) / 1000;
      const kitchen = m.inHand === 'kitchen';
      let x = r3(raw.x), y = r3(raw.y);
      for (let k = 0; k < 24 && !canPlace(m, x, y, kitchen); k++) {
        const p = nearestPlace(m, x + (k ? 0.02 * k : 0), y, kitchen);
        x = r3(p.x); y = r3(p.y);
      }
      shot.x = x; shot.y = y;
    }
    if (Number.isInteger(raw.c) && raw.c >= 0) shot.c = raw.c;
    this._save(shot);   // the position the shot was taken from, and the shot
    const ev = begin(m, shot);
    if (!ev) { this._startTurn(false); return; }
    if (this.mode === 'mp') {
      // Your shot, written NOW (before it has rolled), exactly as it will be replayed elsewhere.
      // Only a shot this table accepted is ever written.
      if (!opts.replay) this._mpRecord({ by: this.mp.seat, ...shot });
      this.mp.applied++;
    }
    this.ev = ev;
    this.potSeen = 0;
    this.phase = 'moving';
    this.placing = false;
    this.acc = 0;
    this.shotSteps = 0;
    this.spin = 0;
    this._paintSpin();
    this._paintOk();
    this._status();
  }

  /** Advance the rolling table by real time `dt`. */
  _physics(dt) {
    const m = this.match;
    this.acc = Math.min(this.acc + dt, MAX_STEPS * DT);
    let n = 0;
    while (this.acc >= DT && n < MAX_STEPS) {
      this.acc -= DT; n++;
      step(m.b, this.ev, m.obs);
      this.shotSteps++;
      this._notePots();
      if (atRest(m.b) || this.shotSteps >= maxShotSteps()) { this._rest(); return; }
    }
  }

  /** A ball just dropped: it sinks into its pocket, and a ring bursts out in its colour. */
  _notePots() {
    const ev = this.ev;
    while (this.potSeen < ev.pots.length) {
      const i = ev.pots[this.potSeen], k = ev.pocketAt[this.potSeen];
      this.potSeen++;
      const o = this.match.b[i], p = POCKETS[k];
      this.sinking.push({ i, x: o.x, y: o.y, px: p.cx, py: p.cy, k: 1, at: this.clock });
      if (!this.reduce) this.bursts.push({ k, color: ballPaint(i, this.settings.look, this.match.mode).body, f: 0, at: this.clock });
      this._hud();
    }
  }

  _rest() {
    const m = this.match;
    const ev = this.ev;
    this.ev = null;
    freeze(m.b);
    const r = settle(m, ev);
    if (this.mode === 'mp' && this.mp && this.MP) this.MP.fixAfter(m, this.mp.game, this.mp.applied);
    this.phase = 'idle';
    this.call = -1;
    this._hud();
    if (r.kind === 'win') { this._finish(); return; }
    if (r.outs && r.outs.length) {
      const nm = this.seats[r.outs[0]].name;
      this._say(t('say_out', { name: nm }));
    }
    if (r.kind === 'rack') {
      // The next rack is set up (and saved) now; the old one stays on screen under the banner.
      const w = r.rackWinner;
      this.showB = cloneBalls(m.b);
      this._showObs = m.obs;
      nextRack(m);
      this._save();
      this.phase = 'pause';
      this._bannerShow(t('rack_won', { name: this.seats[w].name }), m.scores.join(' – '), w);
      this._say(t('say_rack', { name: this.seats[w].name }));
      this._status();
      this._after(RACK_PAUSE, () => { this.showB = null; this._showObs = null; this.sinking = []; this._startTurn(true); });
      return;
    }
    if (r.kind === 'foul') {
      this._bannerShow(t('foul'), t('foul_' + r.foul), m.turn);
      this._say(t('say_foul', { why: t('foul_' + r.foul), name: this.seats[m.turn].name }));
    } else if (r.outs && r.outs.length) {
      this._bannerShow(t('out'), t('out_sub', { name: this.seats[r.outs[0]].name }), r.outs[0]);
    }
    this._save();
    this._startTurn(r.kind !== 'again');
  }

  /** Leaving mid-shot: play it out now, off screen, so the result stands (a pot in flight counts). */
  _settleNow() {
    const m = this.match;
    if (!m || m.winner != null) return;
    if (this.phase === 'moving' && this.ev) {
      runToRest(m.b, this.ev, undefined, m.obs);
      const r = settle(m, this.ev);
      if (this.mode === 'mp' && this.mp && this.MP) this.MP.fixAfter(m, this.mp.game, this.mp.applied);
      this.ev = null;
      this.phase = 'idle';
      if (r.kind === 'rack') nextRack(m);
      if (r.kind === 'win') this._record();
    } else if (this.phase === 'pause') {
      this.timers = [];
      this.showB = null;
      this._showObs = null;
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
    if (this.mode === 'mp') { this._mpFinish(m.winner === this.mp.seat, false); return; }
    this._record();
    this._save();
    this._say(t('say_win', { name: this.seats[m.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this.placing = false;
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
    const mp = this.mode === 'mp' ? this.mp : null;
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = t('win_name', { name: w.name });
    this.root.querySelector('[data-role="againLabel"]').textContent = t(mp ? 'mp_again' : 'play_again');
    this.root.querySelector('[data-role="toSetupLabel"]').textContent = t(mp ? 'mp_back' : 'to_menu');
    const line = this.root.querySelector('[data-role="resLine"]');
    const quit = mp && mp.resigned && mp.game.over && Number.isInteger(mp.game.over.by) ? mp.game.p[mp.game.over.by] : null;
    line.textContent = quit ? t('mp_x_resigned', { name: quit.name || '?' }) : m.racks > 1 ? m.scores.join(' – ') : '';
    line.hidden = !line.textContent;
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

  /** The lock-in tick: beside the cue ball while it is being placed (not while it is being
   *  dragged), above it unless that is off the table, kept on screen. */
  _paintOk() {
    const el = this.okEl;
    if (!el) return;
    const m = this.match;
    const on = !!m && this.placing && this.screen === 'play' && this.phase === 'aim' && !(this.drag && this.drag.mode === 'place');
    el.hidden = !on;
    if (!on || !this.r.w) return;
    const c = this.r.toPx(m.b[CUE].x, m.b[CUE].y);
    const tr = this.r.tableRect();
    const off = 46;
    let y = c.y - off;
    if (y - 24 < tr.y + 6) y = c.y + off;
    const x = Math.max(28, Math.min(this.r.w - 28, c.x));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  // --- input -----------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-games], [data-modes], [data-diffs], [data-racksseg], [data-looks], [data-opt]');
    if (seg) {
      const s = this.settings;
      if (seg.dataset.games) s.game = seg.dataset.games;
      else if (seg.dataset.modes) s.mode = seg.dataset.modes;
      else if (seg.dataset.diffs) s.difficulty = seg.dataset.diffs;
      else if (seg.dataset.looks) s.look = seg.dataset.looks;
      else if (seg.dataset.opt) s.opts[seg.dataset.opt] = !s.opts[seg.dataset.opt];
      else s.racks = Number(seg.dataset.racksseg);
      writeJSON(SETTINGS_KEY, s);
      this._relabel();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') this._newMatch();
    else if (act === 'multi') this._openOnline();
    else if (act === 'mpHome') this._openOnline();
    else if (act === 'skip') this._mpSkip();
    else if (act === 'resign') { this._paintResign(); this.screen = 'resign'; this._showOnly('resign'); }
    else if (act === 'resignYes') this._mpResign();
    else if (act === 'continue') this._continue();
    else if (act === 'howto') { this._helpFrom = this.screen; this.screen = 'help'; this._paintHelp(); this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') {
      if (this._helpFrom === 'menu') { this.screen = 'menu'; this._showOnly('menu'); }
      else this._showSetup();
    }
    else if (act === 'menu') { if (this.screen === 'play' || this.screen === 'resign') { this._paintResign(); this.screen = 'menu'; this._dropAim(); this._showOnly('menu'); } }
    else if (act === 'spin') { if (this.screen === 'play') { this.screen = 'spin'; this._dropAim(); this._paintSpin(); this._showOnly('spin'); } }
    else if (act === 'spinClose') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'spinZero') { this.spin = 0; this._paintSpin(); this.screen = 'play'; this._showOnly(null); }
    else if (act === 'placeOk') {
      if (this.placing && this.match) { this._placeEnd(); this.placing = false; this._paintOk(); this._status(); }
    }
    else if (act === 'exit') {
      // The setup card's X: leave the way the hub's own back pill does.
      const back = document.querySelector('.hub-back');
      if (back && !back.hidden) back.click(); else location.href = '../';
    }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._settleNow(); this._save(); if (this.match && this.match.winner != null) this._finish(); else this._showSetup(); }
    else if (act === 'again') {
      if (this.mode === 'mp') this._sendChallenge(othersOfMine(this.mp), this.mp.game);
      else this._newMatch();
    }
    else if (act === 'toSetup') { if (this.mode === 'mp') this._openOnline(); else this._showSetup(); }
  }

  /** A menu or the spin pad opened mid-aim: the aim is dropped, a cue ball being placed stays put. */
  _dropAim() {
    if (this.drag && this.drag.mode === 'place') this._placeEnd();
    this.drag = null;
    if (this.phase === 'aim') this.aim = null;
    this.power = 0;
    this._paintMeter();
  }

  // --- online (mp.js keeps the match; mp-ui.js draws the lists) ------------------------------------
  // The local match is the STORED one (seat 0 the challenger). Opening a match replays the log up to
  // the other players' latest run of shots, then PLAYS that run on the table (cue placed, pocket
  // called, cue drawn back, the shot rolls); every shot of yours is appended the moment you take it
  // (_mpRecord -> _mpFlush), so a closed app loses nothing and cannot take a shot back; while it is
  // someone else's turn the match is WATCHED, so their shot plays as it lands.
  async _loadMP() { if (!this.MP) this.MP = await import('./mp.js'); return this.MP; }

  _toast(msg, ms = 1800) {
    const el = this.root.querySelector('[data-role="toast"]');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /** "2 waiting on you" on the Multiplayer row. Re-read every time the setup screen shows. */
  _paintOnlineNote() {
    const el = this.root.querySelector('[data-role="onlineNote"]');
    if (!el) return;
    const n = this._onlineWaiting | 0;
    el.hidden = !n;
    el.textContent = n === 1 ? t('online_waiting1') : t('online_waiting', { n });
  }
  async _countOnline() {
    try {
      const MP = await this._loadMP();
      const rows = await MP.readMyGames();
      if (instance !== this) return;
      try { MP.recordFinished(rows); } catch { /* counted on the next open instead */ }
      this._onlineWaiting = rows.filter((r) => !r.over && r.yourTurn).length;
      this._paintOnlineNote();
    } catch { /* offline: no count */ }
  }

  /** Send shots still queued on this phone for ANY match, not just the one open. */
  async _drainAll() {
    if (this._draining) return;
    this._draining = true;
    try {
      const MP = await this._loadMP();
      if (!MP.outboxCount()) return;
      const sent = await MP.drainOutbox(null, this.mp ? this.mp.id : null);
      if (sent && instance === this && this.screen === 'setup') this._countOnline();
    } catch (err) { console.warn('[eight-ball] could not send queued shots yet', err); }
    finally { this._draining = false; }
    if (instance === this && this.MP && this.MP.outboxCount() > (this.mp && this.MP.pendingFor(this.mp.id) ? 1 : 0)) {
      clearTimeout(this._drainTimer);
      this._drainTimer = setTimeout(() => { if (instance === this) this._drainAll(); }, 6000);
    }
  }

  /** The Multiplayer home. `pickFor` ({code, name, emoji}, from the hub's Multiplayer screen) opens
   *  straight onto "challenge them". */
  async _openOnline(pickFor = null) {
    this._mpLeave();
    this._drainAll();
    this.match = null; this.seats = null; this.mode = null;
    this.timers = []; this.cpu = null; this.aim = null; this.drag = null; this.placing = false;
    this.phase = 'idle';
    this.boardEl.innerHTML = '';
    this.banner.classList.remove('is-show');
    const [MP, UI] = await Promise.all([this._loadMP(), import('./mp-ui.js')]);
    if (instance !== this) return;
    this.UI = UI;
    if (pickFor && pickFor.code) UI.challengeTo(this, MP, pickFor);
    else UI.home(this, MP);
  }

  /** A notification for a match was tapped while Pool is ALREADY open: open that match unless a
   *  game against the computer or on one phone is under way, or a shot is rolling. */
  openArmed() {
    import('./alert.js').then((A) => {
      const o = A.takeOpen();
      if (!o || instance !== this) return;
      if (o.kind === 'pick') { if (!this.match || this.mp) this._openOnline(o.them); return; }
      if (this.mp && this.mp.id === o.id) return;
      if (this.phase === 'moving' || this.phase === 'pause') return;
      if (!this.mp && this.match && this.match.winner == null && this.phase !== 'idle') return;
      this._openMatch(o.id);
    }).catch(() => {});
  }

  /** Open one stored match. Shots still waiting on this phone go first, so none is lost. */
  async _openMatch(id) {
    const MP = await this._loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (instance !== this) return;
    if (!game) { this._toast(t('mp_not_found'), 2200); this._openOnline(); return; }
    this._mpBegin(game);
  }

  /** Resign, or CANCEL / DECLINE while nobody it was sent to has shot (js/challenge-life.js). */
  _paintResign() {
    const mp = this.mp;
    if (!mp || !this.MP || !mp.game) return;
    const life = this.MP.lifeOf(mp.game);
    const kind = !life.open ? 'resign' : mp.seat === 0 ? 'cancel' : 'decline';
    const set = (sel, key) => { const el = this.host.querySelector(sel); if (el) el.textContent = t(key); };
    set('[data-act="resign"] span', kind === 'resign' ? 'mp_resign' : `mp_${kind}_ch`);
    set('[data-ov="resign"] h2', kind === 'resign' ? 'mp_resign_q' : `mp_${kind}_q`);
    set('[data-act="resignYes"] span', kind === 'resign' ? 'mp_resign_yes' : `mp_${kind}_ch`);
    set('[data-ov="resign"] [data-act="menu"] span', kind === 'resign' ? 'mp_cancel' : 'mp_keep');
  }

  /** What to say about a match that ended with no result (called off, or expired); '' otherwise. */
  _mpEndText(game, seat) {
    const MP = this.MP;
    if (!game || !MP) return '';
    if (MP.lifeOf(game).expired) return t('mp_expired');
    if (!MP.isCalledOff(game)) return '';
    const why = game.over.why === 'declined' ? 'declined' : 'cancelled';
    const by = Number.isInteger(game.over.by) ? game.over.by : (why === 'cancelled' ? 0 : 1);
    if (by === seat) return t(`mp_you_${why}`);
    return t(`mp_they_${why}`, { name: (game.p[by] && game.p[by].name) || '?' });
  }

  /** A new challenge (`people`: one, or two for Cutthroat; `terms` a finished match's, for Challenge
   *  again, else the setup card's). The first person breaks, so it goes to them at once. */
  async _sendChallenge(people, terms = null) {
    if (this._challenging) return { ok: false, reason: 'busy' };      // a double tap makes ONE match
    this._challenging = true;
    const s = this.settings;
    const tm = terms ? { mode: terms.mode, racks: terms.racks, opts: terms.opts, aids: terms.aids }
      : { mode: s.game, racks: s.racks, opts: s.opts, aids: s.aimHelp };
    let res;
    try {
      const MP = await this._loadMP();
      res = await MP.createGame({ them: people, ...tm });
    } finally { this._challenging = false; }
    if (instance !== this) return res;
    if (!res.ok) {
      if (this.screen !== 'mp') this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2400);
      return res;
    }
    this._mpBegin(res.game);
    this._bannerShow(t('mp_sent'), t('mp_sent_sub', { name: res.game.p[1].name || '?' }), 0);
    return res;
  }

  _mpBegin(game) {
    const MP = this.MP;
    const me = MP.myCode();
    const seat = MP.seatOf(game, me);
    if (seat < 0) { this._openOnline(); return; }
    const endText = this._mpEndText(game, seat);
    if (endText) { this._mpLeave(); this._toast(endText, 3200); this._openOnline(); return; }
    this._mpLeave();
    let from = game.log.length ? MP.lastRunStart(game, seat) : 0;
    // Shots this phone took that never reached the server are still this phone's shots: shown on the
    // table and retried, never re-taken.
    const q = MP.pendingFor(game.id);
    const queued = q && q.base === game.log.length && Array.isArray(q.entries) ? q.entries.map((e) => MP.cleanEntry(e, game.n)).filter(Boolean) : [];
    // The others' last shots replay EVERY time you open the match while it is your turn (Flick
    // Soccer, 2026-10-13); otherwise a run already shown is not shown twice. Skip jumps past it.
    const now = from < game.log.length && !queued.length && !game.over ? MP.buildMatch(game) : null;
    const myTurn = !!now && now.winner == null && now.turn === seat;
    const shown = MP.readShown(game.id);
    if (!myTurn && shown > from) from = Math.min(shown, game.log.length);
    if (q && !queued.length) MP.savePending(game.id, 0, []);
    this.mp = { id: game.id, seat, game, applied: from, base: game.log.length,
      pending: queued.slice(), unshown: queued.slice(), sending: false, stop: null, finished: false, resigned: false };
    const seats = game.p.map((x) => ({ name: x.name || '?', emoji: x.emoji || '🙂', human: true }));
    const match = MP.buildMatch(game, from);
    this._begin({ mode: 'mp', diff: 'mp', match, seats });
    const mp = this.mp;
    this._mpMountChat({ id: game.id, seat, game });
    MP.watchGame(game.id, (g) => this._mpOnGame(g)).then((stop) => {
      if (this.mp === mp) mp.stop = stop; else { try { stop(); } catch { /* detached */ } }
    });
    if (mp.pending.length) this._mpFlush();
  }

  /** The table is at rest: show whatever the log has that this phone has not played yet, then play
   *  on (your turn) or wait (someone else's). */
  _mpCatchUp() {
    const mp = this.mp;
    if (!mp || this.mode !== 'mp' || mp.finished) return;
    const g = mp.game;
    const m = this.match;
    if (m.winner != null) { this._finish(); return; }
    if (mp.applied < g.log.length) {
      const e = g.log[mp.applied];
      if (e.by === mp.seat) {
        // Your own shot from another phone (or before a reopen): played out off screen.
        this.MP.applyEntry(m, e);
        mp.applied++;
        this.MP.fixAfter(m, g, mp.applied);
        this._hud();
        this._mpCatchUp();
        return;
      }
      // Theirs: placed, called and drawn back on the table, then it rolls for real.
      mp.replaying = true;
      this.phase = 'cpu';
      const shot = { dx: e.dx, dy: e.dy, p: e.p, s: e.s };
      if (e.x != null) { shot.x = e.x; shot.y = e.y; }
      if (e.c != null) shot.c = e.c;
      this.cpu = { started: this.clock - 0.3, shot, replay: true };
      this._status();
      return;
    }
    mp.replaying = false;
    if (mp.unshown.length) {
      for (const e of mp.unshown) { this.MP.applyEntry(m, e); mp.applied++; this.MP.fixAfter(m, g, mp.applied); }
      mp.unshown = [];
      this._hud();
      if (m.winner != null) { this._finish(); return; }
    }
    this.MP.markShown(mp.id, g.log.length);
    if (g.over && (this.MP.isCalledOff(g) || !g.log.length)) { this._mpCalledOff(this._mpEndText(g, mp.seat)); return; }
    if (g.over && g.over.why === 'resign') { this._mpFinish(g.over.winner === mp.seat, true); return; }
    if (m.turn === mp.seat) {
      this.phase = 'aim';
      this.placing = !!m.inHand && !this._aids().freeHand;
      this._status();
      this._paintOk();
      return;
    }
    this.phase = 'waiting';
    this._status();
    this._mpSentNote();
  }

  /** Skip: straight to the table after the others' last shots, rebuilt from the stored log (exactly
   *  what the replay would have ended on). */
  _mpSkip() {
    const mp = this.mp, MP = this.MP;
    if (!mp || !MP || !mp.replaying || this.mode !== 'mp' || this.screen !== 'play') return;
    const g = mp.game;
    mp.replaying = false;
    this.cpu = null; this.aim = null; this.drag = null; this.ev = null;
    this.timers = []; this.showB = null; this._showObs = null; this.sinking = []; this.bursts = [];
    clearTimeout(this._bannerTimer);
    this.banner.classList.remove('is-show');
    this.match = MP.buildMatch(g, g.log.length);
    freeze(this.match.b);
    mp.applied = g.log.length;
    this.phase = 'idle';
    this._startTurn(false);
  }

  /** The Skip button shows only while the others' shots are being replayed. */
  _paintSkip() {
    const el = this.root && this.root.querySelector('[data-role="skip"]');
    if (!el) return;
    const on = this.mode === 'mp' && !!this.mp && !!this.mp.replaying && this.screen === 'play';
    if (el.hidden === on) el.hidden = !on;
  }

  /** "SENT!" once per hand-over, only for a turn played on THIS phone, only once the server has it. */
  _mpSentNote() {
    const mp = this.mp;
    if (!mp || this.phase !== 'waiting' || !mp.shotHere || mp.pending.length || mp.sending) return;
    if (mp.sentFor === mp.base) return;
    mp.sentFor = mp.base;
    const next = this.seats[this.match.turn];
    this._bannerShow(t('mp_sent'), t('mp_sent_sub', { name: (next && next.name) || '?' }), this.match.turn);
    this._say(t('mp_sent_sub', { name: (next && next.name) || '?' }));
  }

  /** The watched match changed: new shots from the others are played, our own echoes ignored. */
  _mpOnGame(g) {
    const mp = this.mp;
    if (!mp || g.id !== mp.id || g.log.length < mp.game.log.length) return;
    mp.game = g;
    if (g.over && (this.MP.isCalledOff(g) || !g.log.length) && !mp.finished) { this._mpCalledOff(this._mpEndText(g, mp.seat)); return; }
    if (g.over && g.over.why === 'resign' && !mp.finished && mp.applied >= g.log.length && this.phase !== 'moving') {
      this._mpFinish(g.over.winner === mp.seat, true);
      return;
    }
    if (mp.applied >= g.log.length) return;
    if (this.phase === 'waiting') this._mpCatchUp();
    else if (this.phase === 'aim' && !mp.pending.length && !mp.sending) {
      // Your turn here, but the log moved: you played it on another phone. Catch up instead of
      // taking a second, different shot from a table that is no longer the match.
      this.drag = null; this.aim = null; this.placing = false;
      this._mpCatchUp();
    }
  }

  /** One of your shots, into the log. */
  _mpRecord(entry) {
    const mp = this.mp;
    if (!mp.pending.length && !mp.sending) mp.base = mp.applied;
    mp.shotHere = true;
    mp.pending.push(entry);
    this._mpFlush();
  }

  async _mpFlush() {
    const mp = this.mp;
    const MP = this.MP;
    if (!mp || mp.sending || !mp.pending.length) return;
    mp.sending = true;
    const list = mp.pending.slice();
    const base = mp.base;
    MP.savePending(mp.id, base, mp.pending);          // kept on the phone until the server has it
    const res = await MP.appendLog(mp.id, base, list);
    if (this.mp !== mp) return;
    mp.sending = false;
    if (res.ok) {
      mp.pending.splice(0, list.length);
      mp.base = base + list.length;
      mp.game = res.game;
      MP.savePending(mp.id, mp.base, mp.pending);
      MP.markShown(mp.id, mp.base);
      if (mp.pending.length) { this._mpFlush(); return; }
      if (this.phase === 'waiting') { this._status(); this._mpSentNote(); }
      return;
    }
    if (res.retryable) {
      this._toast(t('mp_not_sent'), 1800);
      setTimeout(() => { if (this.mp === mp) this._mpFlush(); }, 4000);
    } else {
      console.error('[eight-ball] a shot could not be sent:', res.reason);
      if (!MP.NEVER_SENDABLE.includes(res.reason)) {
        this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
        return;
      }
      mp.pending = [];
      MP.savePending(mp.id, 0, []);
      if (res.reason === 'expired') this._mpCalledOff(t('mp_expired'));
      else if (['moved-on', 'already-over', 'rules-refused'].includes(res.reason)) {
        this._toast(t('mp_moved_on'), 2600);
        this._openMatch(mp.id);
      } else this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
    }
  }

  _mpFinish(won, resigned) {
    const mp = this.mp;
    if (!mp || mp.finished) return;
    mp.replaying = false;
    mp.finished = true;
    mp.resigned = !!resigned;
    const m = this.match;
    if (resigned) m.winner = mp.game.over.winner;
    this.MP.countResult(mp.id, won);                   // once per phone, whoever ended it
    this.MP.markResultSeen(mp.id);
    this._say(t('say_win', { name: this.seats[m.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this.placing = false;
    this._hud();
    this._status();
    this._fillResult();
    this._showOnly('result');
  }

  async _mpResign() {
    const mp = this.mp;
    if (!mp) return;
    const res = await this.MP.resignGame(mp.id);
    if (this.mp !== mp) return;
    if (!res.ok) { this.screen = 'menu'; this._showOnly('menu'); this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2400); return; }
    mp.game = res.game;
    if (res.cancelled) { this._mpCalledOff(this._mpEndText(res.game, mp.seat)); return; }
    this._mpFinish(false, true);
  }

  /** A challenge called off before anybody answered, or expired: counts for nobody, back to the list. */
  _mpCalledOff(text = t('mp_cancelled')) {
    const mp = this.mp;
    if (mp) { mp.finished = true; mp.replaying = false; try { this.MP.markSeen(mp.id, mp.game && mp.game.updated); } catch { /* bubble again */ } }
    this._toast(text || t('mp_cancelled'), 3200);
    this._openOnline();
  }

  // --- quick chat inside a challenge (required for every online game, root CLAUDE.md) -------------
  // js/match-chat-ui.js is the panel, js/match-chat.js the data (`eightball/chat/<id>`, BESIDE the
  // match). With three players each line carries its sender (`who`), the third seat writes as 'c'.
  async _mpMountChat(desc) {
    this._mpUnmountChat();
    if (!desc || !desc.id) return;
    this._chatDesc = desc;
    let CUI, DATA;
    try { [CUI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
    if (instance !== this || this._chatDesc !== desc || this._chat) return;
    const node = 'eightball';
    const { id, seat, game } = desc;
    const side = this.MP.sideLetter(seat);
    const others = game.p.filter((_, k) => k !== seat);
    const seenAt = DATA.readChatSeen(node, id);
    const chat = CUI.createMatchChat({
      root: this.root,
      send: (pl) => DATA.sendChat({ node, id, side }, pl),
      them: () => ({ name: others.map((x) => x.name || '?').join(' & '), emoji: (others[0] && others[0].emoji) || '' }),
      place: CHAT_PLACE,
    });
    this._chat = chat;
    const stop = await DATA.watchChat({ node, id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === side;
        const from = game.p['abc'.indexOf(c.by)];
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at, ...(from && !mine ? { who: { name: from.name || '?', emoji: from.emoji || '' } } : {}) }, { pop: !mine && c.at > seenAt });
        if (!mine) newest = Math.max(newest, c.at);
      }
      DATA.markChatSeen(node, id, newest);
    });
    if (instance !== this || this._chatDesc !== desc || this._chat !== chat) { try { stop(); } catch { /* detached */ } return; }
    this._chatStop = stop;
  }

  _mpUnmountChat() {
    this._chatDesc = null;
    if (this._chatStop) { try { this._chatStop(); } catch { /* detached */ } this._chatStop = null; }
    if (this._chat) { try { this._chat.destroy(); } catch { /* gone */ } this._chat = null; }
  }

  /** Stop watching the open online match (shots not yet sent stay in the outbox). */
  _mpLeave() {
    this._mpUnmountChat();
    const mp = this.mp;
    if (!mp) return;
    this.mp = null;
    if (mp.stop) { try { mp.stop(); } catch { /* detached */ } }
  }

  _local(e) {
    const rc = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  }

  /** The pocket under screen point `lp` (generous: the hole and a thumb around it), or -1. */
  _pocketAt(lp) {
    const s = this.r.s;
    let best = -1, bd = Infinity;
    POCKETS.forEach((p, k) => {
      const c = this.r.toPx(p.cx, p.cy);
      const d = Math.sqrt((lp.x - c.x) ** 2 + (lp.y - c.y) ** 2);
      if (d < p.r * s + 16 && d < bd) { bd = d; best = k; }
    });
    return best;
  }

  /** Is it this phone's player's move, with the cue ball ready to be aimed? */
  _myAim() {
    const m = this.match;
    if (this.screen !== 'play' || this.phase !== 'aim' || !m || !this.seats || !this.seats[m.turn].human) return false;
    if (this.mode === 'mp' && (!this.mp || m.turn !== this.mp.seat)) return false;
    return !this.placing && !(this.drag && this.drag.mode === 'place');
  }

  /** The cue's direction this turn: where the finger last pointed, at first the nearest ball the
   *  player may hit. */
  _aimDir() {
    if (this.aimDir) return this.aimDir;
    const m = this.match, c = m.b[CUE];
    let best = null, bd = Infinity;
    for (const i of targetsOf(m, m.turn)) {
      const o = m.b[i];
      if (!o || !o.on) continue;
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    const dx = best ? best.x - c.x : 0, dy = best ? best.y - c.y : -1, l = Math.sqrt(dx * dx + dy * dy) || 1;
    this.aimDir = { dx: dx / l, dy: dy / l };
    return this.aimDir;
  }

  /** The aim as drawn: the cue along the direction, drawn back by the meter's power, and the lines
   *  the level allows. */
  _humanAim() {
    const m = this.match;
    const { dx, dy } = this._aimDir();
    const a = { dx, dy, power: this.power || 0 };
    const aids = this._aids();
    if (aids.line) {
      a.contact = aimContact(m, dx, dy);
      if (aids.obj && a.contact && a.contact.hit >= 0) {
        const q = m.b[a.contact.hit];
        a.objEnd = rayStop(m, q.x, q.y, a.contact.ox, a.contact.oy, 14 + 22 * a.power, [CUE, a.contact.hit]);
      }
    }
    return a;
  }

  _pointerDown(e) {
    const m = this.match;
    if (e.button !== 0 || this.drag) return;   // the main button / one finger; a second touch is ignored
    if (this.screen !== 'play' || this.phase !== 'aim' || !m || !this.seats[m.turn].human) return;
    if (this.mode === 'mp' && m.turn !== this.mp.seat) return;
    e.preventDefault();
    const lp = this._local(e);
    const c = m.b[CUE];
    const cp = this.r.toPx(c.x, c.y);
    const d = Math.sqrt((lp.x - cp.x) ** 2 + (lp.y - cp.y) ** 2);
    const onBall = d <= Math.max(R * 2.6 * this.r.s, 26);
    if (this.placing) {
      // Ball in hand, not locked in yet: a drag ANYWHERE moves the cue ball (by as much as the
      // finger moves); the tick locks it in.
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
      this.drag = { id: e.pointerId, mode: 'place', ox: cp.x - lp.x, oy: cp.y - lp.y };
      this._paintOk();
      this._paintMeter();
      return;
    }
    // Calling a pocket: a touch on one calls it (or changes the call), never on the cue ball.
    if (needCall(m, m.turn) && !onBall) {
      const k = this._pocketAt(lp);
      if (k >= 0) { this.call = k; this._say(t('say_call', { n: k + 1 })); this._status(); this._paintMeter(); return; }
    }
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive */ }
    if (m.inHand && onBall) {
      // Easy: the cue ball can be picked up again until the shot is taken.
      this.drag = { id: e.pointerId, mode: 'place', ox: cp.x - lp.x, oy: cp.y - lp.y };
      this._paintMeter();
      return;
    }
    this._aimDir();
    this.drag = { id: e.pointerId, mode: 'aim', x0: lp.x, y0: lp.y, lx: lp.x, ly: lp.y, live: false };
  }

  /** GamePigeon's aim (Matt's video, 2026-10-23: "you have to spin it around fully so you can drag
   *  from either side"): a drag anywhere TURNS the cue round the cue ball, never points it at the
   *  finger. A touch alone never moves it (`AIM_DEAD_PX` of wobble is ignored, Matt: "it's jumping
   *  all over the place when I tap"). The turn is the finger's movement ACROSS the line to the cue
   *  ball over its distance from it, but never over less than `AIM_NEAR_PX`: far off, the cue
   *  follows the finger round; close to the ball, a small move is a small turn. */
  _pointAt(lp) {
    const d = this.drag;
    if (!d.live) {
      if ((lp.x - d.x0) ** 2 + (lp.y - d.y0) ** 2 < AIM_DEAD_PX * AIM_DEAD_PX) return;
      d.live = true;
    }
    const c = this.r.toPx(this.match.b[CUE].x, this.match.b[CUE].y);
    const rx = d.lx - c.x, ry = d.ly - c.y, rl = Math.sqrt(rx * rx + ry * ry);
    const mx = lp.x - d.lx, my = lp.y - d.ly;
    d.lx = lp.x; d.ly = lp.y;
    if (rl < 1) return;
    const da = (rx * my - ry * mx) / (rl * Math.max(rl, AIM_NEAR_PX));   // + = clockwise on screen
    if (!da) return;
    const { dx, dy } = this._aimDir();
    const cs = Math.cos(da), sn = Math.sin(da);
    const nx = dx * cs - dy * sn, ny = dx * sn + dy * cs, l = Math.sqrt(nx * nx + ny * ny) || 1;
    this.aimDir = { dx: nx / l, dy: ny / l };
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const lp = this._local(e);
    if (d.mode === 'place') { this._placeMove(lp); return; }
    if (d.mode === 'aim') this._pointAt(lp);
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
    this.bad = !canPlace(m, x, y, kitchen);
  }
  _placeEnd() {
    const m = this.match;
    const c = m.b[CUE];
    const kitchen = m.inHand === 'kitchen';
    if (!canPlace(m, c.x, c.y, kitchen)) { const p = nearestPlace(m, c.x, c.y, kitchen); c.x = p.x; c.y = p.y; }
    this.bad = false;
  }

  _pointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.mode === 'place') { this._placeEnd(); this._paintOk(); }
    this._paintMeter();
  }

  /** The power meter: a drag DOWN from wherever the finger lands on it draws the cue back; letting
   *  go shoots, unless it is back at the top (or the turn has gone). */
  _meter(e) {
    const el = this.meterEl;
    const d = this.drag;
    if (e.type === 'pointerdown') {
      if (e.button !== 0 || d || !this._myAim()) return;
      const m = this.match;
      if (needCall(m, m.turn) && this.call < 0) { this._say(t('status_call', { name: this.seats[m.turn].name })); return; }
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* moves still arrive */ }
      this.drag = { id: e.pointerId, mode: 'power', y0: e.clientY, travel: el.clientHeight * METER_TRAVEL };
      this.power = 0;
      this._paintMeter();
      return;
    }
    if (!d || d.mode !== 'power' || e.pointerId !== d.id) return;
    e.preventDefault();
    if (e.type === 'pointermove') {
      this.power = Math.max(0, Math.min(1, (e.clientY - d.y0) / Math.max(40, d.travel)));
      this._paintMeter();
      return;
    }
    this.drag = null;
    const p = this.power;
    this.power = 0;
    this._paintMeter();
    if (e.type !== 'pointerup' || p < MIN_POWER || !this._myAim() || document.hidden) return;
    const m = this.match;
    if (needCall(m, m.turn) && this.call < 0) return;
    const { dx, dy } = this._aimDir();
    const shot = { dx, dy, p, s: this.spin };
    if (m.inHand) { shot.x = m.b[CUE].x; shot.y = m.b[CUE].y; }
    if (needCall(m, m.turn)) shot.c = this.call;
    this._shoot(shot);
  }

  /** The meter sits left of the table, half its height, centred on it; lit only when it can shoot. */
  _paintMeter() {
    const el = this.meterEl;
    if (!el) return;
    const show = this.screen === 'play' && !!this.match && !!this.r && !!this.r.w;
    const tr = show ? this.r.tableRect() : null;
    const off = show && !this._myAim();
    const pow = this.power || 0;
    const key = show ? [tr.x, tr.y, tr.h, off, pow].join('|') : 'none';
    if (key === this._meterKey) return;      // painted every frame: touch the DOM only on a change
    this._meterKey = key;
    el.hidden = !show;
    if (!show) return;
    const h = Math.round(tr.h * METER_K);
    el.style.left = Math.round(Math.max(4, tr.x - METER_W - METER_GAP)) + 'px';
    el.style.top = Math.round(tr.y + (tr.h - h) / 2) + 'px';
    el.style.height = h + 'px';
    el.style.setProperty('--ep-pow', String(pow));
    el.classList.toggle('is-off', off);
    el.setAttribute('aria-valuenow', String(Math.round(pow * 100)));
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
    useTable(tbOf(this.match));    // the match's own table, whatever else ran since (engine.js)
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
      if (this.placing && !this.okEl.hidden) this._paintOk();
    }
    this._paintMeter();
    this._draw();
  }

  _draw() {
    if (!this.r || !this.r.w) return;
    const m = this.match;
    const human = !!m && this.phase === 'aim' && this.seats && this.seats[m.turn].human && (this.mode !== 'mp' || m.turn === this.mp.seat);
    const halo = human && !this.placing ? (this.reduce ? 1 : 0.7 + 0.3 * Math.sin(this.glowT * 3.4)) : 0;
    const b = m ? this.showB || m.b : null;
    const inHandShown = m && !this.showB && m.inHand && (human || this.phase === 'cpuplace') ? m.inHand : null;
    const replayCall = this.cpu && this.cpu.shot && this.phase === 'cpuaim';
    const calling = !!m && !this.showB && human && !this.placing && needCall(m, m.turn);
    let targets = null;
    if (human && !this.placing && this._aids().rings && m.mode !== 'ct' && (m.mode === '9' || m.groups)) targets = targetsOf(m, m.turn);
    this.r.draw({
      b,
      obs: m ? this._showObs || m.obs : null,
      look: this.settings.look,
      mode: m ? m.mode : '8',
      halo,
      aim: this._myAim() ? this._humanAim() : this.aim && !this.aim.idle ? this.aim : null,
      inHand: inHandShown,
      bad: this.bad,
      t: this.glowT,
      sinking: this.sinking,
      bursts: this.bursts,
      targets,
      calling,
      called: m && (calling || replayCall || this.phase === 'moving') && this.call >= 0 ? this.call : null,
    });
  }

  destroy() {
    this._stop();
    this._mpLeave();
    clearTimeout(this._toastTimer);
    clearTimeout(this._drainTimer);
    window.removeEventListener('online', this._onOnline);
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
/** The hub armed a match (alert.js armOpen) while this game is open: take it (see openArmed). */
export function openArmed() { if (instance) instance.openArmed(); }
export default { init, destroy, isInProgress, openArmed };
