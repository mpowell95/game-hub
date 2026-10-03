// darts/js/ui.js - Darts' DOM shell: setup, the play screen (canvas board under a thin HUD), the
// flick input, the turn flow, the computer, menus, autosave and stats. Rules live in engine.js,
// pixels in render.js.
//
// isInProgress(): the AUTOSAVE meaning. The match is saved after every dart and every turn change
// (gamehub.darts.save.v1) and picks up where it left off, so leaving is lossless and this returns
// false. A match is only recorded once it is won. An ONLINE match (2026-10-01, mp.js) lives on the
// server, every dart written as it lands, so leaving one loses nothing either.

import { newMatch, throwDart, nextTurn, validMatch, computerThrow, flickLanding, scoreAt, DIFFS, DARTS_PER_TURN, RING, isCricket, kindOf, CRICKET, cricketNext, bedLabel } from './engine.js';
import { createRenderer, SEAT_COLOR } from './render.js';
import { makeCamera, unproject, pose, solveLength, makeFlight, at as flightAt, stuckAxis, boardPoint, norm, HAND_Z, REST_AXIS } from './flight.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.darts.v1';
const SAVE_KEY = 'gamehub.darts.save.v1';
// The setup screen (2026-10-03, Matt: "there's 2 player and online? where's the challenge button
// like all the other apps?") has Multiplayer at the top, like Cup Pong and Hoops: Challenge
// someone, your matches and Pass & play live behind it. `mode` is the LOCAL kind a match is played
// as; a stored 'online' from before reads as 'cpu'.
const MODES = ['cpu', 'pass'];
const LOCAL_MODES = ['cpu', 'pass'];      // the ones a saved match can be (online lives on the server)
const FIRSTS = ['alt', 'me', 'them'];
const GAMES = ['301', '201', '101', 'cricket'];
const ORDERS = ['any', 'order'];
/** The match kind (engine.js KINDS) the setup screen's Game and Order choices make. */
const kindFrom = (s) => (s.game === 'cricket' ? (s.order === 'order' ? 'cricket-order' : 'cricket') : s.game);


function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) { console.error('[darts] save failed: ' + k, err); return false; }
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
    first: FIRSTS.includes(s.first) ? s.first : 'alt',
    nextStarter: s.nextStarter === 1 ? 1 : 0,
    game: GAMES.includes(s.game) ? s.game : '301',
    order: ORDERS.includes(s.order) ? s.order : 'any',
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MINI_DART = '<svg viewBox="0 0 10 30" aria-hidden="true" focusable="false"><path d="M5 0 L6 6 L6.4 13 L5.6 18 L9.5 27 L5 25 L0.5 27 L4.4 18 L3.6 13 L4 6 Z" fill="currentColor"/></svg>';
/** The active-seat marker: a triangle, so whose turn it is never rests on colour alone. */
const TURN_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 1 L11 6 L2 11 Z" fill="currentColor"/></svg>';
/** Cricket marks, the way a chalkboard keeps them: / one, X two, a circled X closed. */
const MARK_SVG = [
  '',
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 16 L15 4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>',
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 16 L15 4 M5 4 L15 16" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/></svg>',
  '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.2" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M6.2 13.8 L13.8 6.2 M6.2 6.2 L13.8 13.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>',
];
/** The how-to lines for each game, in order. */
const helpKeys = (kind) => (isCricket(kind)
  ? ['help_c_marks', 'help_c_bull', 'help_c_points', kind === 'cricket-order' ? 'help_c_order' : 'help_c_any', 'help_c_win', 'help_flick']
  : ['help_cap', 'help_example', 'help_bull', 'help_bust', 'help_flick']);

/** How to play: the board's rings with their multipliers, drawn rather than described. */
function helpSvg() {
  const R = 46, cx = 64, cy = 54;
  const ring = (r0, r1, fill) => `<path d="${annulus(cx, cy, r0 * R, r1 * R)}" fill="${fill}" fill-rule="evenodd"/>`;
  const label = (x, y, txt, anchor = 'start') => `<text x="${x}" y="${y}" font-size="12" font-weight="800" fill="#fff" text-anchor="${anchor}">${esc(txt)}</text>`;
  return `<svg class="dt-help-svg" viewBox="0 0 240 108" role="img" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${RING.frame * R}" fill="#151515"/>
    ${ring(0, 1, '#f1ebdc')}
    ${ring(RING.trebIn, RING.trebOut, '#d42a2a')}
    ${ring(RING.dblIn, RING.dblOut, '#d42a2a')}
    <circle cx="${cx}" cy="${cy}" r="${RING.bullOut * R}" fill="#1d8a3c"/>
    <circle cx="${cx}" cy="${cy}" r="${RING.bullIn * R}" fill="#d42a2a"/>
    <path d="M${cx + R * 0.72} ${cy - R * 0.69} L150 16" stroke="#fff" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>
    <path d="M${cx + R * 0.45} ${cy - R * 0.42} L150 50" stroke="#fff" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>
    <path d="M${cx + 3} ${cy + 2} L150 86" stroke="#fff" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>
    ${label(154, 20, t('lbl_double'))}
    ${label(154, 54, t('lbl_treble'))}
    ${label(154, 90, '25 / 50')}
  </svg>`;
}
function annulus(cx, cy, r0, r1) {
  const c = (r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return r0 > 0 ? c(r1) + ' ' + c(r0) : c(r1);
}

let instance = null;

class DartsUI {
  constructor(container) {
    this.host = container;
    this.settings = loadSettings();
    this.screen = 'setup';         // setup | help | play | menu | result | pass
    this.phase = 'idle';           // aim | flying | wait | cpu | idle
    this.match = null;
    this.seats = null;
    this.clock = 0;                // game time in seconds; stops while a menu is open
    this.timers = [];
    this.raf = 0;
    this.last = 0;
    this.spin = 0;
    this.flash = null;
    this.flying = null;
    this.falling = null;
    this.hand = null;
    this.stuckAlpha = 1;
    this.shown = [0, 0];           // the plaque numbers as displayed (they count down to the score)
    this.drag = null;
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this._ensureCss();
    this._build();
    this.r = createRenderer(this.canvas);

    this._onVis = () => { if (document.hidden) this._stop(); else this._start(); };
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
    // A tapped launcher bubble or notification names a match: open it straight away.
    import('./alert.js').then((A) => { const o = A.takeOpen(); if (o && instance === this) this._openMatch(o.id); }).catch(() => {});
  }

  _ensureCss() {
    for (const href of [new URL('../../css/ui.css', import.meta.url).href, new URL('../css/darts.css', import.meta.url).href]) {
      if ([...document.styleSheets].some((s) => s.href === href) || document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- DOM -------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="dt-root">
        <canvas class="dt-canvas" role="img"></canvas>
        <div class="dt-top" data-role="top">
          <div class="dt-left" data-role="dartsLeft"></div>
          <button type="button" class="dt-ibtn" data-act="menu" data-la="aria_menu">${MENU_SVG}</button>
        </div>
        <div class="dt-fx" data-role="fx" aria-hidden="true"></div>
        <div class="dt-banner" data-role="banner" aria-hidden="true"><b data-role="bannerMain"></b><span data-role="bannerSub"></span></div>
        <p class="dt-hint" data-role="hint" aria-hidden="true"></p>
        <div class="dt-marks dt-marks-0" data-role="marks0" role="img" hidden></div>
        <div class="dt-marks dt-marks-1" data-role="marks1" role="img" hidden></div>
        <div class="dt-seat dt-seat-0" data-seat="0">
          <span class="dt-turn">${TURN_SVG}</span>
          <span class="dt-ava" data-role="ava0"></span>
          <span class="dt-plaque"><small data-role="name0"></small><b data-role="score0">301</b></span>
        </div>
        <div class="dt-seat dt-seat-1" data-seat="1">
          <span class="dt-plaque"><small data-role="name1"></small><b data-role="score1">301</b></span>
          <span class="dt-ava" data-role="ava1"></span>
          <span class="dt-turn">${TURN_SVG}</span>
        </div>

        <div class="dt-ov dt-ov-setup" data-ov="setup" hidden>
          <div class="dt-card">
            <h2 class="dt-logo" data-l="title"></h2>
            <p class="dt-tag" data-role="tagline"></p>
            <button type="button" class="dt-mprow" data-act="multi">
              <b data-l="multiplayer"></b>
              <span class="dt-mprow-badge" data-role="onlineNote" hidden></span>
              <span class="dt-mprow-chev" aria-hidden="true">›</span>
            </button>
            <div class="dt-field">
              <span class="dt-label" data-l="game"></span>
              <div class="gh-seg dt-seg" role="group" data-role="games"></div>
            </div>
            <div class="dt-field" data-role="orderField">
              <span class="dt-label" data-l="order"></span>
              <div class="gh-seg dt-seg" role="group" data-role="orders"></div>
            </div>
            <div class="dt-field" data-role="diffField">
              <span class="dt-label" data-l="difficulty"></span>
              <div class="gh-seg dt-seg" role="group" data-role="diffs"></div>
            </div>
            <div class="dt-field" data-role="firstField">
              <span class="dt-label" data-l="first"></span>
              <div class="gh-seg dt-seg" role="group" data-role="firsts"></div>
            </div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block dt-go" data-act="continue" data-role="continueBtn" hidden><span data-l="continue"></span></button>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block dt-go" data-act="play" data-role="playBtn"><span data-l="play"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="howto"><span data-l="howto"></span></button>
          </div>
        </div>

        <div class="dt-ov dt-ov-mp" data-ov="mp" hidden></div>

        <div class="dt-ov" data-ov="menu" hidden>
          <div class="dt-card dt-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="dt-x" data-act="resume" data-la="aria_close">${X_SVG}</button>
            <h2 class="dt-h2" data-l="menu"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="howto"><span data-l="howto"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="quit" data-local><span data-l="quit"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="mpHome" data-online><span data-l="mp_back"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt dt-danger" data-act="resign" data-online><span data-l="mp_resign"></span></button>
          </div>
        </div>

        <div class="dt-ov" data-ov="pass" hidden>
          <button type="button" class="dt-card dt-card-sm dt-pass" data-act="ready">
            <b data-role="passName"></b>
            <span data-l="tap_ready"></span>
          </button>
        </div>

        <div class="dt-ov" data-ov="result" hidden>
          <div class="dt-card dt-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="dt-x" data-act="toSetup" data-la="aria_close">${X_SVG}</button>
            <p class="dt-res-ava" data-role="resAva"></p>
            <h2 class="dt-h2" data-role="resTitle"></h2>
            <p class="dt-res-line" data-role="resLine"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-role="againLabel"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="toSetup"><span data-role="toSetupLabel"></span></button>
          </div>
        </div>

        <div class="dt-ov" data-ov="help" hidden>
          <div class="dt-card dt-help" role="dialog" aria-modal="true">
            <button type="button" class="dt-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="dt-h2" data-l="howto"></h2>
            <p class="dt-help-goal" data-role="helpGoal"></p>
            <div data-role="helpSvg"></div>
            <div class="dt-help-lines" data-role="helpLines"></div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <div class="dt-ov" data-ov="resign" hidden>
          <div class="dt-card dt-card-sm" role="dialog" aria-modal="true">
            <h2 class="dt-h2" data-l="mp_resign_q"></h2>
            <button type="button" class="gh-btn gh-btn--block dt-danger" data-act="resignYes"><span data-l="mp_resign_yes"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="menu"><span data-l="mp_cancel"></span></button>
          </div>
        </div>
        <p class="dt-toast" data-role="toast" role="status" hidden></p>
        <p class="dt-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.dt-root');
    this.canvas = q('.dt-canvas');
    this.fx = q('[data-role="fx"]');
    this.banner = q('[data-role="banner"]');
    this.hintEl = q('[data-role="hint"]');
    this.liveEl = q('[data-role="live"]');
    this.leftEl = q('[data-role="dartsLeft"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });
    this.seatEls = [q('[data-seat="0"]'), q('[data-seat="1"]')];
    this.marksEls = [q('[data-role="marks0"]'), q('[data-role="marks1"]')];

    this.root.addEventListener('click', (e) => this._click(e));
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onUp);
    // Scroll-leak guard, root-scoped (never document: root CLAUDE.md, "Scroll and touch rules").
    this._onTouchMove = (e) => { if (this.screen === 'play') e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._relabel();
  }

  /** Every translated label, re-applied on a language switch. */
  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    this.canvas.setAttribute('aria-label', t('aria_board'));
    this.root.querySelector('[data-role="helpSvg"]').innerHTML = helpSvg();
    const s = this.settings;
    this._paintHelp();
    const seg = (role, key, ids, cur, label, extra) => {
      const el = this.root.querySelector(`[data-role="${role}"]`);
      el.setAttribute('aria-label', t(key));
      el.innerHTML = ids.map((id) => `<button type="button" class="gh-seg__item dt-seg-item" data-${role}="${id}" aria-pressed="${cur === id}">${extra ? extra(id) : ''}<span>${esc(label(id))}</span></button>`).join('');
    };
    seg('games', 'game', GAMES, s.game, (id) => (id === 'cricket' ? t('game_cricket') : id));
    seg('orders', 'order', ORDERS, s.order, (id) => t('order_' + id));
    this.root.querySelector('[data-role="orderField"]').hidden = s.game !== 'cricket';
    const kind = kindFrom(s);
    this.root.querySelector('[data-role="tagline"]').textContent = isCricket(kind)
      ? t(kind === 'cricket-order' ? 'tagline_cricket_order' : 'tagline_cricket') : t('tagline_x01', { n: kind });
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('firsts', 'first', FIRSTS, s.first, (id) => id === 'alt' ? t('first_alt') : id === 'me' ? t('first_me') : t('first_them_cpu'));
    const sv = this._savedMatch();
    this.root.querySelector('[data-role="continueBtn"]').hidden = !sv;
    this._paintOnlineNote();
    const online = this.mode === 'mp';
    this.root.querySelectorAll('[data-online]').forEach((el) => { el.hidden = !online; });
    this.root.querySelectorAll('[data-local]').forEach((el) => { el.hidden = online; });
    if (this.seats) this._seatsHud(); else this._marksHud();
    this._dartsLeftHud();
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'pass') this._fillPass();
    if (this.screen === 'help') this._fitHelp();
  }

  /** The how-to for the game being played, or the one chosen on the setup screen. */
  _paintHelp() {
    const kind = this.match ? kindOf(this.match) : kindFrom(this.settings);
    const cricket = isCricket(kind);
    this.root.querySelector('[data-role="helpGoal"]').textContent = cricket ? t('help_c_goal') : t('tagline_x01', { n: kind });
    this.root.querySelector('[data-role="helpLines"]').innerHTML = helpKeys(kind)
      .map((k) => `<p class="dt-help-line${k === 'help_example' ? ' dt-help-ex' : ''}">${esc(t(k))}</p>`).join('');
  }

  /** Every how-to line on one row: measured, shrunk until it fits, never below 11px
   *  (docs/BUILDING-A-GAME.md, "How-to-play screens"). */
  _fitHelp() {
    this.root.querySelectorAll('.dt-help-goal, .dt-help-line').forEach((el) => {
      el.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(el).fontSize) || 13;
      while (el.scrollWidth > el.clientWidth + 0.5 && fs > 11) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
    });
  }

  _savedMatch() {
    const s = readJSON(SAVE_KEY);
    if (!s || !LOCAL_MODES.includes(s.mode) || !validMatch(s.match) || s.match.winner != null) return null;
    return s;
  }

  _say(s) { this.liveEl.textContent = s; }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-setup', name === 'setup' || name === 'mp' || (name === 'help' && !this.match));
  }
  _showSetup() {
    this._mpLeave();
    this.screen = 'setup';
    this.match = null;
    this.mode = null;
    this.seats = null;
    this.hand = null; this.flying = null; this.falling = null; this.flash = null;
    this.timers = [];
    this.phase = 'idle';
    this.fx.innerHTML = '';
    this.banner.classList.remove('is-show');
    this.hintEl.classList.remove('is-show');
    this._relabel();
    this._showOnly('setup');
    this._countOnline();
  }

  // --- layout ----------------------------------------------------------------------------------
  /** Board as big as the width allows, under the top row; the dart in the hand below it; the
   *  plaques in the bottom corners (and, in Cricket, each seat's marks above its plaque, either side
   *  of the dart). Everything is measured from the root's real size. */
  _layout() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._size = w + 'x' + h;
    const top = this.root.querySelector('[data-role="top"]').getBoundingClientRect();
    const rootTop = this.root.getBoundingClientRect().top;
    const topBottom = Math.max(0, top.bottom - rootTop);
    const seatH = this.seatEls[0].offsetHeight || 70;
    // Height left for board + hand: the hand dart needs about a fifth of the screen.
    const handSpace = Math.max(120, h * 0.24);
    const avail = h - topBottom - seatH - 18 - handSpace;
    let R = Math.max(60, Math.min((w / 2 - 8) / RING.frame, (avail / 2) / RING.frame));
    // Cricket's marks need 7 rows of at least 15px between the board and the plaques: on a short
    // phone the board gives up the difference.
    if (this.root.classList.contains('is-cricket')) {
      const room = (h - 10 - seatH - 8) - (topBottom + 4 + 2 * R * RING.frame + 6);
      const need = CRICKET.length * 15 + 12;
      if (room < need) R = Math.max(60, R - (need - room) / (2 * RING.frame));
    }
    const cx = w / 2;
    const cy = topBottom + 4 + R * RING.frame;
    this.r.layout(w, h, cx, cy, Math.round(R));
    this.handLen = Math.max(90, Math.min(h * 0.22, w * 0.46, h - (cy + R * RING.frame) - seatH * 0.4));
    // The tip rests a little below the board's bottom edge.
    const boardBottom = cy + R * RING.frame;
    const floor = h - 10 - this.handLen;
    this.handRest = { x: cx, y: Math.min(floor, boardBottom + Math.max(16, (h - boardBottom - this.handLen) * 0.32)) };
    this.root.style.setProperty('--dt-hint-y', Math.round(this.handRest.y - 30) + 'px');
    // The 3D throw (darts/js/flight.js): a camera behind the thrower, sized so the board is exactly
    // where it is drawn, and a dart long enough to be `handLen` px on screen when it rests in the hand.
    this.cam = makeCamera(cx, cy, Math.round(R));
    this.dartLen = solveLength(this.cam, this.handRest.x, this.handRest.y, this.handLen);
    const rest = pose(this.cam, unproject(this.cam, this.handRest.x, this.handRest.y, HAND_Z), REST_AXIS, this.dartLen);
    this.unitW = (this.handLen * rest.zMid) / this.cam.f;     // world size whose projection is the dart's width unit
    // Banners (MISS!, BUST!, whose turn) sit in the gap between the board and the dart, where they
    // cover nothing; on a short screen with no gap, over the board's lower edge instead.
    const gapMid = (boardBottom + this.handRest.y) / 2;
    this.root.style.setProperty('--dt-banner-y', Math.round(this.handRest.y - boardBottom > 70 ? gapMid : boardBottom - 40) + 'px');
    // Cricket's marks: between the board and the plaques, rows sized to the room there.
    const marksTop = boardBottom + 6;
    const marksRoom = Math.max(0, (h - 10 - seatH - 8) - marksTop);
    this.root.style.setProperty('--dt-marks-top', Math.round(marksTop) + 'px');
    this.root.style.setProperty('--dt-mk-h', Math.max(14, Math.min(26, Math.floor((marksRoom - 12) / CRICKET.length))) + 'px');
    this._draw();
  }

  // --- the match -------------------------------------------------------------------------------
  _seatsFor(mode, diff) {
    const p = profile();
    const me = { name: (p && p.name) || t('you'), emoji: (p && p.emoji) || '🙂', human: true };
    if (mode === 'pass') return [me, { name: t('player2'), emoji: '🙂', human: true }];
    const o = p && p.opponents && p.opponents[0];
    return [me, { name: (o && o.name) || t('computer'), emoji: (o && o.emoji) || '🤖', human: false, diff }];
  }

  _newMatch() {
    const s = this.settings;
    let starter;
    if (s.first === 'me') starter = 0;
    else if (s.first === 'them') starter = 1;
    else { starter = s.nextStarter; s.nextStarter = starter ^ 1; }
    writeJSON(SETTINGS_KEY, s);
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(starter, kindFrom(s)) }, true);
  }

  /** Pass & play, from the Multiplayer screen: two people, this phone, the chosen game. */
  _passPlay() { this.settings.mode = 'pass'; this._newMatch(); }

  /** The game the setup screen has chosen (an online challenge is sent as this). */
  _kind() { return kindFrom(this.settings); }

  /** Play again: the same game as the one just finished, whatever the setup screen now says. */
  _rematch() {
    const kind = kindOf(this.match);
    const s = this.settings;
    if (isCricket(kind)) { s.game = 'cricket'; s.order = kind === 'cricket-order' ? 'order' : 'any'; } else s.game = kind;
    this._newMatch();
  }

  _continue() {
    const sv = this._savedMatch();
    if (!sv) { this._newMatch(); return; }
    this._begin({ mode: sv.mode, diff: DIFFS.includes(sv.diff) ? sv.diff : 'medium', match: sv.match }, false);
  }

  _begin(g, fresh) {
    this.mode = g.mode;
    this.diff = g.diff;
    this.match = g.match;
    this.seats = g.seats || this._seatsFor(g.mode, g.diff);
    // Online, you sit on the LEFT whichever side of the stored match you are (mp.js: 'a' is seat 0).
    this.root.classList.toggle('is-flip', g.mode === 'mp' && this.mp && this.mp.mySeat === 1);
    this._relabel();
    this.screen = 'play';
    this.timers = [];
    this.flying = null; this.falling = null; this.flash = null;
    this.stuckAlpha = 1;
    this.fx.innerHTML = '';
    this.shown = this.match.scores.slice();
    this._showOnly(null);
    this._seatsHud();
    this._save();
    if (this.match.turnOver) { this._endTurn(true); return; }
    this._startTurn(fresh || this.match.darts.length === 0);
  }

  _save() {
    if (!this.match || this.mode === 'mp') return;
    if (this.match.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    writeJSON(SAVE_KEY, { mode: this.mode, diff: this.diff, match: this.match });
  }

  _seat() { return this.seats[this.match.turn]; }

  _seatsHud() {
    const m = this.match;
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      this.root.querySelector(`[data-role="ava${i}"]`).textContent = s.emoji;
      this.root.querySelector(`[data-role="name${i}"]`).textContent = s.name;
      this.root.querySelector(`[data-role="score${i}"]`).textContent = String(Math.round(this.shown[i]));
      this.seatEls[i].classList.toggle('is-turn', !!m && m.turn === i && m.winner == null);
      this.seatEls[i].style.setProperty('--dt-seat', SEAT_COLOR[i]);
    }
    this._dartsLeftHud();
    this._marksHud();
  }

  /** Cricket's chalkboard: each seat's marks on 20-15 and the bull, beside its own plaque. In order,
   *  the number each player is on carries a ring and a triangle; a number both have closed is dead. */
  _marksHud() {
    const m = this.match;
    const on = !!m && isCricket(m.kind) && !!this.seats;
    if (this.root.classList.contains('is-cricket') !== on) {
      this.root.classList.toggle('is-cricket', on);
      this._layout();                                  // the board makes room for the marks, or takes it back
    }
    for (let i = 0; i < 2; i++) {
      const el = this.marksEls[i];
      el.hidden = !on;
      if (!on) continue;
      const next = m.kind === 'cricket-order' ? cricketNext(m, i) : -1;
      el.style.setProperty('--dt-seat', SEAT_COLOR[i]);
      el.innerHTML = CRICKET.map((n, k) => {
        const mk = m.marks[i][k];
        const dead = mk >= 3 && m.marks[i ^ 1][k] >= 3;
        return `<div class="dt-mk-row${dead ? ' is-dead' : ''}${k === next ? ' is-next' : ''}"><b>${n === 25 ? esc(t('lbl_bull')) : n}</b><i>${MARK_SVG[mk]}</i></div>`;
      }).join('');
      const list = CRICKET.map((n, k) => `${n === 25 ? t('lbl_bull') : n} ${m.marks[i][k] >= 3 ? t('aria_mark_closed') : t('aria_mark_n', { n: m.marks[i][k] })}`).join(', ');
      el.setAttribute('aria-label', t('aria_marks', { name: this.seats[i].name, list }));
    }
  }

  _dartsLeftHud() {
    const m = this.match;
    const left = m ? (m.turnOver ? 0 : DARTS_PER_TURN - m.darts.length) : DARTS_PER_TURN;
    const seat = m ? m.turn : 0;
    this.leftEl.style.setProperty('--dt-seat', SEAT_COLOR[seat]);
    this.leftEl.innerHTML = Array.from({ length: DARTS_PER_TURN }, (_, i) => `<i class="${i < left ? 'is-on' : ''}">${MINI_DART}</i>`).join('');
    this.leftEl.setAttribute('aria-label', t('aria_darts_left', { n: left }));
    this.leftEl.setAttribute('role', 'img');
  }

  /** A turn begins: in pass and play, the phone is handed over first. */
  _startTurn(announce) {
    const s = this._seat();
    this._seatsHud();
    this.stuckAlpha = 1;
    if (this.mode === 'pass' && announce && this.match.turns > 0) {
      this.screen = 'pass';
      this.phase = 'idle';
      this.hand = null;
      this._fillPass();
      this._showOnly('pass');
      return;
    }
    if (announce) {
      const mine = this.mode === 'mp' ? this.match.turn === this.mp.mySeat : s.human && this.mode === 'cpu';
      this._bannerShow(mine ? t('your_turn') : t('turn_of', { name: s.name }), '', 'turn');
      this._say(t('say_turn', { name: s.name }));
    }
    this._nextDart();
  }

  _fillPass() {
    const s = this.seats && this.match ? this._seat() : null;
    if (s) this.root.querySelector('[data-role="passName"]').textContent = t('pass_to', { name: s.name });
  }

  _nextDart() {
    const s = this._seat();
    // Online, the other person's darts are not thrown here: they are SHOWN from the log.
    if (this.mode === 'mp' && this.match.turn !== this.mp.mySeat) { this.hand = null; this.phase = 'idle'; this._mpCatchUp(); return; }
    this.hand = { x: this.handRest.x, y: this.handRest.y, len: this.handLen, seat: this.match.turn, spin: this.spin, alpha: 1, rise: 0 };
    if (s.human) {
      this.phase = 'aim';
      // The flick hint, until this device has thrown a few darts.
      this.hintEl.textContent = t('hint_flick');
      this.hintEl.classList.toggle('is-show', (this._thrown | 0) < 3);
    } else {
      this.phase = 'cpu';
      this.hintEl.classList.remove('is-show');
      this._after(0.75, () => this._cpuThrow());
    }
    this._dartsLeftHud();
  }

  _cpuThrow() {
    if (!this.match || this.phase !== 'cpu') return;
    const p = computerThrow(this.match, this.diff);
    const from = { x: this.hand.x, y: this.hand.y };
    this._launch(from, p.x, p.y);
  }

  /** The dart leaves the hand at `from` (CSS px, the tip) for board point (x, y). */
  _launch(from, x, y) {
    // Kept to the precision an online match stores (mp.js cleanEntry), so a dart on a wire scores the
    // same here as on the other phone.
    x = Math.round(x * 1e4) / 1e4; y = Math.round(y * 1e4) / 1e4;
    this.phase = 'flying';
    this.hintEl.classList.remove('is-show');
    const to = this.r.toPx(x, y);
    // A real arc in 3D from the hand to the landing point the rules already decided.
    const fl = makeFlight(unproject(this.cam, from.x, from.y, HAND_Z), x, y);
    this.flying = { fl, t: 0, tx: to.x, ty: to.y, bx: x, by: y, seat: this.match.turn, spin: this.spin };
    this.hand = null;
  }

  /** The dart arrives: score it. */
  _land() {
    const f = this.flying;
    const m = this.match;
    const seat = m.turn;
    const name = this.seats[seat].name;
    const res = throwDart(m, f.bx, f.by);
    const hit = res.hit;
    this._thrown = (this._thrown | 0) + 1;
    if (this.mode === 'mp') {
      this.mp.applied++;
      if (seat === this.mp.mySeat) this._mpRecord(f.bx, f.by);
    }
    if (hit.ring === 'off') {
      // Missed the board: it hits the wall and drops away, fading.
      const end = flightAt(f.fl, f.fl.T);
      this.falling = { tip: end.tip.slice(), axis: end.axis, seat, spin: f.spin, vy: 0, a: 1 };
    }
    this.flying = null;
    const cricket = isCricket(m.kind);
    if (cricket && hit.num > 0) {
      // Cricket: the bed it hit, and the points if it scored any. A bed that counts for nothing
      // (7, or 19 while 20 is still open in order) shows dimmed, with no flash.
      if (hit.counted) this.flash = { x: f.bx, y: f.by, a: 1 };
      this._popup(f.tx, f.ty, bedLabel(hit), hit.pts > 0 ? '+' + hit.pts : '', !hit.counted);
      this._marksHud();
    } else if (hit.pts > 0) {
      this.flash = { x: f.bx, y: f.by, a: 1 };
      this._popup(f.tx, f.ty, String(hit.pts), hit.ring === 'bull' ? t('bull') : '');
    } else {
      this._bannerShow(t('miss'), '', 'miss');
    }
    this._dartsLeftHud();
    if (res.event === 'bust') {
      m.turnOver = true;
      this._bannerShow(t('bust'), t('bust_sub', { n: m.turnStart }), 'bust');
      this._say(t('say_bust', { name, n: m.turnStart }));
      this._save();
      this.phase = 'wait';
      this._after(1.6, () => this._endTurn(false));
      return;
    }
    if (cricket && hit.num > 0) this._say(t(hit.counted ? 'say_c_hit' : 'say_c_none', { name, bed: bedLabel(hit), score: m.scores[seat] }));
    else if (hit.pts > 0) this._say(t('say_hit', { name, pts: hit.pts, left: m.scores[seat] }));
    else this._say(t('say_miss', { name }));
    if (res.event === 'win') {
      this._save();
      this.phase = 'wait';
      this._seatsHud();
      this._after(1.1, () => this._finish());
      return;
    }
    if (res.event === 'end') {
      m.turnOver = true;
      this._save();
      this.phase = 'wait';
      this._after(1.15, () => this._endTurn(false));
      return;
    }
    this._save();
    this.phase = 'wait';
    this._after(0.5, () => this._nextDart());
  }

  /** Pull the darts out and hand the board over. */
  _endTurn(instant) {
    const go = () => {
      const m = this.match;
      if (!m) return;
      delete m.turnOver;
      nextTurn(m);
      this.shown = m.scores.slice();
      this.stuckAlpha = 1;
      this._save();
      this._startTurn(true);
    };
    if (instant || this.reduce) { go(); return; }
    this.phase = 'wait';
    this._fadeOut = { t: 0, dur: 0.3 };
    this._after(0.32, () => { this._fadeOut = null; go(); });
  }

  _finish() {
    const m = this.match;
    if (!m || m.winner == null) return;
    if (this.mode === 'mp') { this._mpFinish(m.winner === this.mp.mySeat, false); return; }
    if (this.mode === 'cpu' && !m.recorded) {
      m.recorded = true;
      try {
        const st = recordResult('darts', this.diff, m.winner === 0);
        if (!st) console.warn('[darts] result not recorded (rate gate or store refused it)');
      } catch (err) { console.error('[darts] recording the result failed', err); }
    }
    this._save();
    this._say(t('say_win', { name: this.seats[m.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this.hand = null;
    this._fillResult();
    this._showOnly('result');
    this.root.querySelector('[data-ov="result"] [data-act="again"]').focus({ preventScroll: true });
  }

  _fillResult() {
    const m = this.match;
    if (!m || m.winner == null) return;
    const w = this.seats[m.winner];
    const mp = this.mode === 'mp' ? this.mp : null;
    const iWon = mp ? m.winner === mp.mySeat : m.winner === 0;
    const title = this.mode === 'pass' ? t('win_name', { name: w.name }) : t(iWon ? 'win_you' : 'lose_you');
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = title;
    // Turns the winner took: their own visits to the oche.
    const visits = m.winner === m.starter ? Math.floor(m.turns / 2) + 1 : Math.floor((m.turns + 1) / 2);
    let line = t('result_line', { n: visits });
    if (mp && mp.resigned) line = iWon ? t('mp_they_resigned', { name: mp.them.name }) : t('mp_you_resigned');
    this.root.querySelector('[data-role="resLine"]').textContent = line;
    this.root.querySelector('[data-role="againLabel"]').textContent = t(mp ? 'mp_again' : 'play_again');
    this.root.querySelector('[data-role="toSetupLabel"]').textContent = t(mp ? 'mp_back' : 'menu');
  }

  // --- effects ---------------------------------------------------------------------------------
  _popup(x, y, txt, sub, dim = false) {
    const el = document.createElement('div');
    el.className = 'dt-pop' + (this.reduce ? ' is-still' : '') + (dim ? ' is-dim' : '');
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    el.innerHTML = `<b>${esc(txt)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    this.fx.appendChild(el);
    this._after(1.3, () => el.remove());
  }

  _bannerShow(main, sub, kind) {
    this.root.querySelector('[data-role="bannerMain"]').textContent = main;
    this.root.querySelector('[data-role="bannerSub"]').textContent = sub || '';
    this.banner.dataset.kind = kind;
    this.banner.classList.remove('is-show');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('is-show'), kind === 'bust' ? 1600 : 1100);
  }

  /** Run `fn` after `sec` of GAME time (stops while a menu is open). */
  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  // --- input -----------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-diffs], [data-firsts], [data-games], [data-orders]');
    if (seg) {
      if (seg.dataset.diffs) this.settings.difficulty = seg.dataset.diffs;
      else if (seg.dataset.games) this.settings.game = seg.dataset.games;
      else if (seg.dataset.orders) this.settings.order = seg.dataset.orders;
      else this.settings.first = seg.dataset.firsts;
      writeJSON(SETTINGS_KEY, this.settings);
      this._relabel();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') { this.settings.mode = 'cpu'; this._newMatch(); }
    else if (act === 'multi') this._openOnline();
    else if (act === 'continue') this._continue();
    else if (act === 'howto') { this._helpFrom = this.screen; this.screen = 'help'; this._paintHelp(); this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') {
      if (this._helpFrom === 'menu') { this.screen = 'menu'; this._showOnly('menu'); }
      else this._showSetup();
    }
    else if (act === 'menu') { if (this.screen === 'play' || this.screen === 'resign') { this.screen = 'menu'; this._showOnly('menu'); this.drag = null; } }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._save(); this._showSetup(); }
    else if (act === 'mpHome') this._openOnline();
    else if (act === 'resign') { this.screen = 'resign'; this._showOnly('resign'); }
    else if (act === 'resignYes') this._mpResign();
    else if (act === 'ready') { this.screen = 'play'; this._showOnly(null); this._startTurn(false); this._bannerShow(t('turn_of', { name: this._seat().name }), '', 'turn'); }
    else if (act === 'again') {
      if (this.mode === 'mp') this._sendChallenge(this.mp.them, kindOf(this.match));
      else if (this.match) this._rematch();
      else this._newMatch();
    }
    else if (act === 'toSetup') { if (this.mode === 'mp') this._openOnline(); else this._showSetup(); }
  }

  // --- online (darts/js/mp.js keeps the match; darts/js/mp-ui.js draws the lists) ----------------
  // The local match is the STORED one (seat 0 = side 'a', the challenger). What happens here:
  //   - opening a match replays the log up to the other person's latest run of darts, then FLIES
  //     that run, one dart at a time, to the points they landed on;
  //   - every dart of yours is appended to the log as it lands (_mpRecord -> _mpFlush), so a closed
  //     app loses nothing and cannot take a dart back;
  //   - while it is their turn the match is WATCHED, so their darts arrive while you look at it.
  async _loadMP() { if (!this.MP) this.MP = await import('./mp.js'); return this.MP; }

  _toast(msg, ms = 1800) {
    const el = this.root.querySelector('[data-role="toast"]');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /** "2 waiting on you" under the Online matches button. Painted from the last count; the count is
   *  re-read every time the setup screen shows (`_countOnline`). */
  _paintOnlineNote() {
    const el = this.root.querySelector('[data-role="onlineNote"]');
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

  async _openOnline() {
    this._mpLeave();
    this.match = null; this.seats = null; this.mode = null;
    this.hand = null; this.flying = null; this.falling = null; this.flash = null;
    this.timers = [];
    this.phase = 'idle';
    this.fx.innerHTML = '';
    this.hintEl.classList.remove('is-show');
    this.root.classList.remove('is-flip');
    this._marksHud();
    const [MP, UI] = await Promise.all([this._loadMP(), import('./mp-ui.js')]);
    if (instance !== this) return;
    this.UI = UI;
    UI.home(this, MP);
  }

  /** Open one stored match. Darts still waiting on this phone go first, so none is lost. */
  async _openMatch(id) {
    const MP = await this._loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (instance !== this) return;
    if (!game) { this._toast(t('mp_not_found'), 2200); this._openOnline(); return; }
    this._mpBegin(game);
  }

  /** A new challenge: created now, delivered when your first turn is over. */
  async _sendChallenge(them, kind = kindFrom(this.settings)) {
    const MP = await this._loadMP();
    const res = await MP.createGame({ them, kind });
    if (instance !== this) return res;
    if (!res.ok) {
      if (this.screen !== 'mp') this._toast((this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed')), 2400);
      return res;
    }
    this._mpBegin(res.game);
    return res;
  }

  _mpBegin(game) {
    const MP = this.MP;
    const me = MP.myCode();
    const side = MP.sideOf(game, me);
    if (!side) { this._openOnline(); return; }
    this._mpLeave();
    const theirSide = side === 'a' ? 'b' : 'a';
    let from = game.log.length ? MP.lastRunStart(game, theirSide) : 0;
    const shown = MP.readShown(game.id);
    if (shown > from) from = Math.min(shown, game.log.length);
    const them = MP.themOf(game, me);
    this.mp = { id: game.id, side, mySeat: side === 'b' ? 1 : 0, game, them, applied: from, base: game.log.length,
      pending: [], sending: false, stop: null, finished: false, resigned: false };
    const seat = (who) => ({ name: who.name || '?', emoji: who.emoji || '🙂', human: true });
    const match = MP.buildMatch(game, from);
    this._begin({ mode: 'mp', diff: 'mp', match, seats: [seat(game.a), seat(game.b)] }, false);
    const mp = this.mp;
    MP.watchGame(game.id, (g) => this._mpOnGame(g)).then((stop) => {
      if (this.mp === mp) mp.stop = stop; else { try { stop(); } catch { /* detached */ } }
    });
  }

  /** Show whatever the board has not shown yet, then play on (or wait). Called whenever the match
   *  is ready for its next dart (`_nextDart`) and it is not this phone's to throw. */
  _mpCatchUp() {
    const mp = this.mp;
    if (!mp || this.mode !== 'mp' || mp.finished) return;
    const g = mp.game;
    const m = this.match;
    if (mp.applied < g.log.length) {
      const e = g.log[mp.applied];
      if (e.by === mp.side) {
        // Your own dart from another phone (or before a reopen): onto the board without a flight.
        this.MP.applyEntry(m, e);
        mp.applied++;
        this.shown = m.scores.slice();
        this._seatsHud();
        this._mpCatchUp();
        return;
      }
      // Theirs: the dart appears in their hand, then flies to where it landed.
      this.hintEl.classList.remove('is-show');
      this.phase = 'replay';
      this.hand = { x: this.handRest.x, y: this.handRest.y, len: this.handLen, seat: m.turn, spin: this.spin, alpha: 1 };
      this._after(0.6, () => { if (this.mp === mp && this.phase === 'replay') this._launch({ x: this.hand.x, y: this.hand.y }, e.x, e.y); });
      return;
    }
    this.MP.markShown(mp.id, g.log.length);
    this.MP.markSeen(mp.id, g.updated);
    if (m.winner != null) { this._finish(); return; }
    if (g.over && g.over.why === 'resign') { this._mpFinish(g.over.winner === mp.side, true); return; }
    if (m.turn === mp.mySeat) { this._nextDart(); return; }
    this._mpWaiting();
  }

  _mpWaiting() {
    this.phase = 'waiting';
    this.hand = null;
    this.hintEl.textContent = t('mp_waiting', { name: this.mp.them.name || '?' });
    this.hintEl.classList.add('is-show');
  }

  /** The watched match changed: new darts from them are shown, our own echoes are ignored. */
  _mpOnGame(g) {
    const mp = this.mp;
    if (!mp || g.id !== mp.id || g.log.length < mp.game.log.length) return;
    mp.game = g;
    if (g.over && g.over.why === 'resign' && !mp.finished && mp.applied >= g.log.length) {
      this._mpFinish(g.over.winner === mp.side, true);
      return;
    }
    if (mp.applied < g.log.length && this.phase === 'waiting') this._mpCatchUp();
  }

  /** One of your darts, into the log. */
  _mpRecord(x, y) {
    const mp = this.mp;
    // Where this dart sits in the log: `applied` already counts it. Set only when nothing is queued,
    // so a run of queued darts stays contiguous (the flush moves `base` on as each batch lands).
    if (!mp.pending.length && !mp.sending) mp.base = mp.applied - 1;
    mp.pending.push({ by: mp.side, x, y });
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
      if (mp.pending.length) this._mpFlush();
      return;
    }
    if (res.retryable) {
      this._toast(t('mp_not_sent'), 1800);
      setTimeout(() => { if (this.mp === mp) this._mpFlush(); }, 4000);
    } else {
      console.error('[darts] a dart could not be sent:', res.reason);
      this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
    }
  }

  _mpFinish(won, resigned) {
    const mp = this.mp;
    if (!mp || mp.finished) return;
    mp.finished = true;
    mp.resigned = !!resigned;
    if (resigned) this.match.winner = won ? mp.mySeat : mp.mySeat ^ 1;
    this.MP.countResult(mp.id, won);                   // once per phone, whoever ended it
    this.MP.markResultSeen(mp.id);
    this._say(t('say_win', { name: this.seats[this.match.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this.hand = null;
    this.hintEl.classList.remove('is-show');
    this._seatsHud();
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
    this._mpFinish(false, true);
  }

  /** Stop watching the open online match (darts not yet sent stay in the outbox). */
  _mpLeave() {
    const mp = this.mp;
    if (!mp) return;
    this.mp = null;
    if (mp.stop) { try { mp.stop(); } catch { /* detached */ } }
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  }

  _pointerDown(e) {
    if (this.screen !== 'play' || this.phase !== 'aim' || !this.hand) return;
    const p = this._local(e);
    // Grab anywhere below the board, or on the dart itself.
    const boardBottom = this.r.cy + this.r.R * RING.frame;
    if (p.y < Math.min(boardBottom, this.hand.y - 20)) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.drag = { id: e.pointerId, sx: p.x, sy: p.y, hx: this.hand.x, hy: this.hand.y, samples: [p] };
  }
  _pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = this._local(e);
    d.samples.push(p);
    if (d.samples.length > 30) d.samples.shift();
    // The dart follows the finger, but not up over the board: past its lower part the finger keeps
    // going (its speed is what throws) while the dart waits there (2026-10-02).
    if (this.hand) {
      this.hand.x = d.hx + (p.x - d.sx);
      this.hand.y = Math.max(this.r.cy + this.r.R * RING.frame * 0.6, d.hy + (p.y - d.sy));
    }
  }
  _pointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (e.type !== 'pointerup' || this.phase !== 'aim' || !this.hand) { this._springBack(); return; }
    const p = this._local(e);
    d.samples.push(p);
    // Velocity over the last ~90 ms of the drag.
    const end = d.samples[d.samples.length - 1];
    let i = d.samples.length - 1;
    while (i > 0 && end.t - d.samples[i - 1].t <= 90) i--;
    const st = d.samples[Math.max(0, Math.min(i, d.samples.length - 2))];
    const dt = Math.max(0.008, (end.t - st.t) / 1000);
    const vx = (end.x - st.x) / dt, vy = (end.y - st.y) / dt;
    const travel = d.sy - end.y;
    const speed = -vy / (this.r.h || 1);
    const o = this.r.toBoard(this.hand.x, this.hand.y);
    const jitter = [gauss() * 0.02, gauss() * 0.02];
    const land = travel > 24 ? flickLanding(o.x, o.y, vx, vy, speed, jitter) : null;
    if (!land) { this._springBack(); return; }
    this._launch({ x: this.hand.x, y: this.hand.y }, land.x, land.y);
  }
  _springBack() {
    if (this.hand) { this.hand.x = this.handRest.x; this.hand.y = this.handRest.y; }
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
    let dt = Math.max(0, (now - this.last) / 1000); this.last = now;
    if (dt > 0.05) dt = 0.05;
    const running = this.screen === 'play' || this.screen === 'result';
    if (running) this._tick(dt);
    else if (!this.reduce) this.spin += dt * 1.4;
    this._draw();
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }

  _tick(dt) {
    this.clock += dt;
    if (!this.reduce) this.spin += dt * 1.6;
    // Timers.
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.clock);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.at > this.clock);
        for (const x of due) x.fn();
      }
    }
    if (this.hand) this.hand.spin = this.spin;
    const f = this.flying;
    if (f) {
      f.t += dt;
      f.spin += dt * 22;
      if (f.t >= f.fl.T) this._land();
    }
    const fl = this.falling;
    if (fl) {
      fl.vy += 9.8 * dt; fl.tip[1] += fl.vy * dt; fl.a -= dt * 2.2;
      fl.axis = norm([fl.axis[0], fl.axis[1] + dt * 3, fl.axis[2]]);
      if (fl.a <= 0) this.falling = null;
    }
    if (this.flash) { this.flash.a -= dt * 1.4; if (this.flash.a <= 0) this.flash = null; }
    if (this._fadeOut) { this._fadeOut.t += dt; this.stuckAlpha = Math.max(0, 1 - this._fadeOut.t / this._fadeOut.dur); }
    // Plaques count down to the real score.
    const m = this.match;
    if (m) {
      for (let i = 0; i < 2; i++) {
        const target = m.scores[i];
        if (this.shown[i] !== target) {
          const step = Math.max(1, Math.abs(this.shown[i] - target) * dt * 6);
          this.shown[i] = this.shown[i] > target ? Math.max(target, this.shown[i] - step) : Math.min(target, this.shown[i] + step);
          if (this.reduce) this.shown[i] = target;
          this.root.querySelector(`[data-role="score${i}"]`).textContent = String(Math.round(this.shown[i]));
        }
      }
    }
  }

  /** A dart's screen pose for the renderer, from its world tip and axis. */
  _dartPose(tip, axis, seat, spin, alpha, shadow) {
    const p = pose(this.cam, tip, axis, this.dartLen);
    return { tip: p.tip, tail: p.tail, unit: (this.unitW * this.cam.f) / p.zMid, seat, spin, alpha, shadow };
  }
  _handPose(x, y, seat, alpha = 1) {
    return this._dartPose(unproject(this.cam, x, y, HAND_Z), REST_AXIS, seat, this.reduce ? 0 : this.spin, alpha, false);
  }

  _draw() {
    if (!this.r || !this.r.w || !this.cam) return;
    const m = this.match;
    const darts = [];
    if (m && (this.screen === 'play' || this.screen === 'menu' || this.screen === 'result' || this.screen === 'help' || this.screen === 'resign')) {
      // Stuck darts sit the way they arrived from the hand's resting point (flight.stuckAxis), so a
      // dart replayed from an online log or a save sits exactly like a fresh one.
      for (const d of m.darts) {
        if (d.ring === 'off') continue;
        darts.push(this._dartPose(boardPoint(d.x, d.y), stuckAxis(), m.turn, Math.PI / 4, this.stuckAlpha, true));
      }
    }
    const f = this.flying;
    if (f) {
      const now = flightAt(f.fl, f.t);
      darts.push(this._dartPose(now.tip, now.axis, f.seat, f.spin, 1, f.t >= f.fl.T * 0.97));
    }
    const fa = this.falling;
    if (fa) darts.push(this._dartPose(fa.tip, fa.axis, fa.seat, fa.spin, Math.max(0, fa.a), false));
    else if (this.hand && this.screen !== 'pass') darts.push(this._handPose(this.hand.x, this.hand.y, this.hand.seat, this.hand.alpha == null ? 1 : this.hand.alpha));
    // Setup: a dart waits in the hand, turning, so the screen reads as darts at a glance.
    if (this.screen === 'setup' || (this.screen === 'help' && !m)) darts.push(this._handPose(this.handRest.x, this.handRest.y, 0));
    this.r.draw({ flash: this.flash, darts });
  }

  destroy() {
    this._stop();
    this._mpLeave();
    clearTimeout(this._bannerTimer);
    clearTimeout(this._toastTimer);
    this._save();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.reduceMQ.removeEventListener) this.reduceMQ.removeEventListener('change', this._onReduce);
    if (this._offResize) this._offResize();
    if (this._ro) this._ro.disconnect();
    if (this._offLang) this._offLang();
    this.host.innerHTML = '';
  }
}

function gauss() {
  let u = 0; while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export function init(container) {
  if (instance) destroy();
  instance = new DartsUI(container);
  // Test seam (like Murdoku's window.__muTest): lets the headless checks drive a throw.
  if (typeof window !== 'undefined') window.__dtTest = { ui: instance, scoreAt };
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
  if (typeof window !== 'undefined' && window.__dtTest && window.__dtTest.ui === i) delete window.__dtTest;
}
/** Autosave meaning: every dart is saved and the match resumes, so leaving loses nothing. */
export function isInProgress() { return false; }
export default { init, destroy, isInProgress };
