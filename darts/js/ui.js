// darts/js/ui.js - Darts' DOM shell: setup, the play screen (canvas board under a thin HUD), the
// flick input, the turn flow, the computer, menus, autosave and stats. Rules live in engine.js,
// pixels in render.js.
//
// isInProgress(): the AUTOSAVE meaning. The match is saved after every dart and every turn change
// (gamehub.darts.save.v1) and picks up where it left off, so leaving is lossless and this returns
// false. A match is only recorded once it is won.

import { newMatch, throwDart, nextTurn, validMatch, computerThrow, flickLanding, scoreAt, DIFFS, DARTS_PER_TURN, RING } from './engine.js';
import { createRenderer, SEAT_COLOR } from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.darts.v1';
const SAVE_KEY = 'gamehub.darts.save.v1';
const MODES = ['cpu', 'pass'];
const FIRSTS = ['alt', 'me', 'them'];

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
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MINI_DART = '<svg viewBox="0 0 10 30" aria-hidden="true" focusable="false"><path d="M5 0 L6 6 L6.4 13 L5.6 18 L9.5 27 L5 25 L0.5 27 L4.4 18 L3.6 13 L4 6 Z" fill="currentColor"/></svg>';
/** The active-seat marker: a triangle, so whose turn it is never rests on colour alone. */
const TURN_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 1 L11 6 L2 11 Z" fill="currentColor"/></svg>';

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
            <p class="dt-tag" data-l="tagline"></p>
            <div class="dt-field">
              <span class="dt-label" data-l="mode"></span>
              <div class="gh-seg dt-seg" role="group" data-role="modes"></div>
            </div>
            <div class="dt-field" data-role="diffField">
              <span class="dt-label" data-l="difficulty"></span>
              <div class="gh-seg dt-seg" role="group" data-role="diffs"></div>
            </div>
            <div class="dt-field">
              <span class="dt-label" data-l="first"></span>
              <div class="gh-seg dt-seg" role="group" data-role="firsts"></div>
            </div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block dt-go" data-act="continue" data-role="continueBtn" hidden><span data-l="continue"></span></button>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block dt-go" data-act="play" data-role="playBtn"><span data-l="play"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="howto"><span data-l="howto"></span></button>
          </div>
        </div>

        <div class="dt-ov" data-ov="menu" hidden>
          <div class="dt-card dt-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="dt-x" data-act="resume" data-la="aria_close">${X_SVG}</button>
            <h2 class="dt-h2" data-l="menu"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="howto"><span data-l="howto"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="quit"><span data-l="quit"></span></button>
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
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-l="play_again"></span></button>
            <button type="button" class="gh-btn gh-btn--block dt-alt" data-act="toSetup"><span data-l="menu"></span></button>
          </div>
        </div>

        <div class="dt-ov" data-ov="help" hidden>
          <div class="dt-card dt-help" role="dialog" aria-modal="true">
            <button type="button" class="dt-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="dt-h2" data-l="howto"></h2>
            <p class="dt-help-goal" data-l="help_goal"></p>
            <div data-role="helpSvg"></div>
            <p class="dt-help-line" data-l="help_cap"></p>
            <p class="dt-help-line dt-help-ex" data-l="help_example"></p>
            <p class="dt-help-line" data-l="help_bull"></p>
            <p class="dt-help-line" data-l="help_bust"></p>
            <p class="dt-help-line" data-l="help_flick"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
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
    const seg = (role, key, ids, cur, label, extra) => {
      const el = this.root.querySelector(`[data-role="${role}"]`);
      el.setAttribute('aria-label', t(key));
      el.innerHTML = ids.map((id) => `<button type="button" class="gh-seg__item dt-seg-item" data-${role}="${id}" aria-pressed="${cur === id}">${extra ? extra(id) : ''}<span>${esc(label(id))}</span></button>`).join('');
    };
    seg('modes', 'mode', MODES, s.mode, (id) => t('mode_' + id));
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('firsts', 'first', FIRSTS, s.first, (id) => id === 'alt' ? t('first_alt') : id === 'me' ? t('first_me') : t(s.mode === 'pass' ? 'first_them_pass' : 'first_them_cpu'));
    this.root.querySelector('[data-role="diffField"]').hidden = s.mode !== 'cpu';
    this.root.querySelector('[data-role="continueBtn"]').hidden = !this._savedMatch();
    if (this.seats) this._seatsHud();
    this._dartsLeftHud();
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'pass') this._fillPass();
    if (this.screen === 'help') this._fitHelp();
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
    this.hand = null; this.flying = null; this.falling = null; this.flash = null;
    this.timers = [];
    this.phase = 'idle';
    this.fx.innerHTML = '';
    this.banner.classList.remove('is-show');
    this.hintEl.classList.remove('is-show');
    this._relabel();
    this._showOnly('setup');
  }

  // --- layout ----------------------------------------------------------------------------------
  /** Board as big as the width allows, under the top row; the dart in the hand below it; the
   *  plaques in the bottom corners. Everything is measured from the root's real size. */
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
    const R = Math.max(60, Math.min((w / 2 - 8) / RING.frame, (avail / 2) / RING.frame));
    const cx = w / 2;
    const cy = topBottom + 4 + R * RING.frame;
    this.r.layout(w, h, cx, cy, Math.round(R));
    this.handLen = Math.max(90, Math.min(h * 0.22, w * 0.46, h - (cy + R * RING.frame) - seatH * 0.4));
    // The tip rests a little below the board's bottom edge.
    const boardBottom = cy + R * RING.frame;
    const floor = h - 10 - this.handLen;
    this.handRest = { x: cx, y: Math.min(floor, boardBottom + Math.max(16, (h - boardBottom - this.handLen) * 0.32)) };
    this.root.style.setProperty('--dt-hint-y', Math.round(this.handRest.y - 30) + 'px');
    // Banners (MISS!, BUST!, whose turn) sit in the gap between the board and the dart, where they
    // cover nothing; on a short screen with no gap, over the board's lower edge instead.
    const gapMid = (boardBottom + this.handRest.y) / 2;
    this.root.style.setProperty('--dt-banner-y', Math.round(this.handRest.y - boardBottom > 70 ? gapMid : boardBottom - 40) + 'px');
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
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(starter) }, true);
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
    this.seats = this._seatsFor(g.mode, g.diff);
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
    if (!this.match) return;
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
      this._bannerShow(s.human && this.mode === 'cpu' ? t('your_turn') : t('turn_of', { name: s.name }), '', 'turn');
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
    const p = computerThrow(this.match.scores[this.match.turn], this.diff);
    const from = { x: this.hand.x, y: this.hand.y };
    this._launch(from, p.x, p.y);
  }

  /** The dart leaves the hand at `from` (CSS px, the tip) for board point (x, y). */
  _launch(from, x, y) {
    this.phase = 'flying';
    this.hintEl.classList.remove('is-show');
    const to = this.r.toPx(x, y);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.flying = { fx: from.x, fy: from.y, tx: to.x, ty: to.y, bx: x, by: y, t: 0, dur: Math.min(0.42, 0.2 + dist / 2600), seat: this.match.turn, startLen: this.hand ? this.hand.len : this.handLen, x: from.x, y: from.y, len: this.handLen, spin: this.spin, stuckBlend: 0 };
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
    if (hit.ring === 'off') {
      this.falling = { x: f.tx, y: f.ty, len: Math.max(14, f.len), seat, spin: f.spin, vy: 0, a: 1 };
      this.flying = null;
    } else {
      this.flying = null;
    }
    if (hit.pts > 0) {
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
    if (hit.pts > 0) this._say(t('say_hit', { name, pts: hit.pts, left: m.scores[seat] }));
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
    const title = this.mode === 'cpu' ? t(m.winner === 0 ? 'win_you' : 'lose_you') : t('win_name', { name: w.name });
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = title;
    // Turns the winner took: their own visits to the oche.
    const visits = m.winner === m.starter ? Math.floor(m.turns / 2) + 1 : Math.floor((m.turns + 1) / 2);
    this.root.querySelector('[data-role="resLine"]').textContent = t('result_line', { n: visits });
  }

  // --- effects ---------------------------------------------------------------------------------
  _popup(x, y, txt, sub) {
    const el = document.createElement('div');
    el.className = 'dt-pop' + (this.reduce ? ' is-still' : '');
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
    const seg = e.target.closest('[data-modes], [data-diffs], [data-firsts]');
    if (seg) {
      if (seg.dataset.modes) this.settings.mode = seg.dataset.modes;
      else if (seg.dataset.diffs) this.settings.difficulty = seg.dataset.diffs;
      else this.settings.first = seg.dataset.firsts;
      writeJSON(SETTINGS_KEY, this.settings);
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
    else if (act === 'menu') { if (this.screen === 'play') { this.screen = 'menu'; this._showOnly('menu'); this.drag = null; } }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._save(); this._showSetup(); }
    else if (act === 'ready') { this.screen = 'play'; this._showOnly(null); this._startTurn(false); this._bannerShow(t('turn_of', { name: this._seat().name }), '', 'turn'); }
    else if (act === 'again') this._newMatch();
    else if (act === 'toSetup') this._showSetup();
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
    // The dart follows the finger.
    if (this.hand) { this.hand.x = d.hx + (p.x - d.sx); this.hand.y = d.hy + (p.y - d.sy); }
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
      const k = Math.min(1, f.t / f.dur);
      const e = 1 - Math.pow(1 - k, 2);
      const dist = Math.hypot(f.tx - f.fx, f.ty - f.fy);
      f.x = f.fx + (f.tx - f.fx) * e;
      f.y = f.fy + (f.ty - f.fy) * e - Math.sin(Math.PI * k) * dist * 0.1;
      const endLen = this.r.R * 0.2;
      f.len = f.startLen + (endLen - f.startLen) * Math.pow(k, 0.6);
      f.spin += dt * 22;
      f.stuckBlend = k < 0.82 ? 0 : (k - 0.82) / 0.18;
      if (k >= 1) this._land();
    }
    const fl = this.falling;
    if (fl) {
      fl.vy += 1800 * dt; fl.y += fl.vy * dt; fl.a -= dt * 2.2;
      if (fl.a <= 0 || fl.y > this.r.h + 40) this.falling = null;
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

  _draw() {
    if (!this.r || !this.r.w) return;
    const m = this.match;
    const stuck = [];
    if (m && (this.screen === 'play' || this.screen === 'menu' || this.screen === 'result' || this.screen === 'help')) {
      // The dart in flight is already in m.darts only after it lands, so every listed dart is stuck.
      for (const d of m.darts) if (d.ring !== 'off') stuck.push({ x: d.x, y: d.y, seat: m.turn, alpha: this.stuckAlpha });
    }
    const scene = { stuck, flash: this.flash, hand: null, flying: null };
    if (this.flying) scene.flying = this.flying;
    if (this.falling) scene.hand = { x: this.falling.x, y: this.falling.y, len: this.falling.len, seat: this.falling.seat, spin: this.falling.spin, alpha: Math.max(0, this.falling.a) };
    else if (this.hand && this.screen !== 'pass') scene.hand = this.hand;
    // Setup: a dart waits in the hand, turning, so the screen reads as darts at a glance.
    if (this.screen === 'setup' || (this.screen === 'help' && !m)) scene.hand = { x: this.handRest.x, y: this.handRest.y, len: this.handLen, seat: 0, spin: this.spin };
    this.r.draw(scene);
  }

  destroy() {
    this._stop();
    clearTimeout(this._bannerTimer);
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
