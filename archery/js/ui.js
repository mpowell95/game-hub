// archery/js/ui.js - Archery's DOM shell: setup, the HUD, the bow and arm (an SVG over the canvas),
// the hold-to-draw input, the turn flow, the computer, the replays, menus, autosave and stats. Rules
// live in engine.js, the range in render.js, online matches in mp.js (lazily loaded).
//
// isInProgress(): the AUTOSAVE meaning. A match vs the computer is saved after every arrow
// (gamehub.archery.save.v1) and Continue match picks it up, so leaving is lossless and this returns
// false. An online match lives on the server, every arrow written as it lands.
//
// THE TURN, timed off Matt's recording (docs/ARCHERY-BRIEF.md section 2): touch and hold, the bow
// comes up in under 0.25 s with the target magnified in the sight; drag to aim, the sight sways, the
// ring round it runs down; let go and the camera chases the arrow for 0.75 s; cut to the target, the
// number pops 0.6 s later with a burst of stars; 2 s on the target, then back to the line.
import { newMatch, shoot, totals, stageShots, arrowsFor, isShootOff, windFor, driftOf, landing, panicPoint,
  drainGauge, swayAt, GAUGE, newHand, stepHand, cpuShot, gauss, DIFFS, ROUNDS, validMatch, scoreAt, hashStr, BOSS } from './engine.js';
import { Renderer, ARROW_COLORS, FLIGHT_T } from './render.js';

import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.archery.v1';
const SAVE_KEY = 'gamehub.archery.save.v1';
const FIRSTS = ['alt', 'me', 'them'];
const HIT_POP = 0.3;           // seconds from an arrow hitting to its number popping (Matt, 2026-10-20: was 0.6, read as a freeze)
const HIT_HOLD = 2.0;          // seconds on the target after a hit
const DRAW_T = 0.25;           // seconds to bring the bow up (the recording, frame by frame)
const PANIC_T = 0.6;           // seconds of shaking before a panicked arrow goes
const BOW_IN_T = 0.2;          // seconds for the bow to slide up into view on the line
const JOLT_T = 0.033;           // seconds of the arrow leaving the bow (the string snaps), before the flight

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) { console.error('[archery] save failed: ' + k, err); return false; }
}
function profile() { try { return loadProfile(); } catch { return null; } }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Saved choices beat the profile's first opponent skill (1/2/3) beat Medium. */
function loadSettings() {
  const s = readJSON(SETTINGS_KEY) || {};
  let difficulty = DIFFS.includes(s.difficulty) ? s.difficulty : null;
  if (!difficulty) {
    const p = profile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : 2;
    difficulty = skill === 1 ? 'easy' : skill === 3 ? 'hard' : 'medium';
  }
  return {
    difficulty,
    first: FIRSTS.includes(s.first) ? s.first : 'alt',
    nextStarter: s.nextStarter === 1 ? 1 : 0,
    shots: Math.max(0, s.shots | 0),
  };
}

const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const WIND_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><defs><linearGradient id="ar-windg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa6ff"/><stop offset="1" stop-color="#1557d4"/></linearGradient></defs><path d="M4 15.5 H20 V7 L37 20 L20 33 V24.5 H4 Z" fill="url(#ar-windg)" stroke="#0e3f9e" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const PAD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2.5" y="6.5" width="19" height="11" rx="5.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 10v4M5 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="11" r="1.3" fill="currentColor"/><circle cx="18" cy="13.3" r="1.3" fill="currentColor"/></svg>';
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z" fill="currentColor"/></svg>';
const LEAF_SVG = '<svg viewBox="0 0 30 16" aria-hidden="true" focusable="false"><path d="M1 8 C8 -1 22 -1 29 8 C22 17 8 17 1 8 Z" fill="currentColor"/><path d="M2 8 H27" stroke="rgba(0,0,0,0.2)" stroke-width="1"/></svg>';
const HAND_SVG = '<svg viewBox="0 0 40 48" aria-hidden="true" focusable="false"><path d="M14 4 C14 1.5 18 1.5 18 4 V22 L18.5 14 C18.8 11.5 22.4 11.6 22.4 14.2 V22 L23 16 C23.3 13.6 26.8 13.7 26.8 16.3 V23 L27.4 19 C27.8 16.8 31 17 31 19.4 V31 C31 39 26 45 19 45 C13 45 10.5 41 8 36 L3.5 27 C2.3 24.7 5 22.6 7 24.4 L14 31 Z" fill="#ffffff" stroke="#3a3a3a" stroke-width="2" stroke-linejoin="round"/></svg>';

// --- the sight's ring ------------------------------------------------------------------------------
// The bow, hand, arm and arrow are 3D (bow3d.js, drawn by render.js). This SVG is only the ring
// round the sight: the hold gauge and the crosshair, in a frame where the sight's centre is (0, 0)
// and its inner radius 46 units. ui.js moves (0, 0) onto the aim point and tells render.js the
// same place and size, so the ring, the 3D sight housing and the magnified view always line up.
const SCOPE_IN = 46;
function ringSVG() {
  const C = 2 * Math.PI * 52.5;
  return `<svg class="ar-bow-svg" viewBox="-70 -70 140 140" width="140" height="140" aria-hidden="true" focusable="false">
    <g class="ar-scope-ring">
      <circle r="57" fill="none" stroke="#3b3f45" stroke-width="13"/>
      <circle r="57" fill="none" stroke="#6b7078" stroke-width="5" transform="translate(-1 -1.5)" opacity="0.55"/>
      <circle r="52.5" fill="none" stroke="#15171a" stroke-width="7"/>
      <circle class="ar-gauge" r="52.5" fill="none" stroke="#2fdc4a" stroke-width="6" transform="rotate(-90)" stroke-dasharray="${C.toFixed(1)} ${C.toFixed(1)}" data-c="${C.toFixed(2)}"/>
      <circle r="${SCOPE_IN + 1}" fill="none" stroke="#08090b" stroke-width="3"/>
      <path d="M-45,0 H-15 M15,0 H45 M0,-45 V-15 M0,15 V45" stroke="#ff2b2b" stroke-width="3.6"/>
    </g>
  </svg>`;
}

/** How to play: the face's rings, a sight held off to the side, and the wind carrying the arrow in. */
function helpSvg() {
  const cx = 70, cy = 56, R = 44;
  const cols = ['#f6f6f4', '#202020', '#2ea7e8', '#e8342b', '#ffd21f'];
  let rings = '';
  for (let i = 0; i < 5; i++) rings += `<circle cx="${cx}" cy="${cy}" r="${R * (1 - i / 5)}" fill="${cols[i]}" stroke="#1a1a1a" stroke-width="1"/>`;
  return `<svg class="ar-help-svg" viewBox="0 0 240 112" role="img" aria-hidden="true">
    ${rings}
    <text x="${cx}" y="${cy + 4}" font-size="11" font-weight="800" text-anchor="middle" fill="#1a1a1a">10</text>
    <text x="${cx + R * 0.7}" y="${cy + 4}" font-size="9" font-weight="800" text-anchor="middle" fill="#ffffff">4</text>
    <g transform="translate(${cx + 30} ${cy - 6})">
      <circle r="13" fill="none" stroke="#1d2128" stroke-width="4"/>
      <path d="M-11 0 H-4 M4 0 H11 M0 -11 V-4 M0 4 V11" stroke="#ff2d2d" stroke-width="1.6"/>
    </g>
    <path d="M${cx + 30} ${cy - 6} Q ${cx + 18} ${cy - 16} ${cx + 3} ${cy - 2}" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 3" fill="none"/>
    <path d="M${cx + 6} ${cy - 7} L${cx + 2} ${cy - 1} L${cx + 9} ${cy - 1}" stroke="#ffffff" stroke-width="2" fill="none"/>
    <g transform="translate(176 40)" fill="#ffffff">
      <path d="M30 0 H4" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
      <path d="M10 -9 L-2 0 L10 9 Z"/>
      <text x="14" y="26" font-size="12" font-weight="800" text-anchor="middle">${t('wind', { n: '' }).trim()}</text>
    </g>
  </svg>`;
}

let instance = null;
/** Where the quick-chat button sits (js/match-chat-ui.js `place`): under the menu button on the
 *  right edge (the menu is `right: 10px` at the top row, 44px tall, then a 10px gap), clear of the
 *  round pill and tiles in the middle and of the hub's chip on the left, on a 320px phone too. */
const CHAT_PLACE = { top: 'calc(max(env(safe-area-inset-top, 0px), 50px) + 54px)', right: '10px', popsTop: 'calc(max(env(safe-area-inset-top, 0px), 50px) + 108px)' };

class ArcheryUI {
  constructor(container) {
    this.host = container;
    this.settings = loadSettings();
    this.screen = 'setup';
    this.phase = 'idle';
    this.mode = null;
    this.match = null;
    this.seats = null;
    this.clock = 0;
    this.timers = [];
    this.raf = 0;
    this.last = 0;
    this.raise = 0;              // 0 = the bow down, 1 = drawn
    this.aim = { x: 0, y: 0 };
    this.gauge = 1;
    this.leaves = [];
    this.leafAt = 0;
    this.turnArrows = [];
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this._ensureCss();
    this._build();
    this.r = new Renderer(this.canvas, { reducedMotion: this.reduce });

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
    // A tapped launcher bubble or notification names a match; the hub's Challenges screen can hand
    // over a person to challenge ('pick').
    import('./alert.js').then((A) => {
      const o = A.takeOpen();
      if (!o || instance !== this) return;
      if (o.kind === 'pick') this._openOnline(o.them); else this._openMatch(o.id);
    }).catch(() => {});
  }

  _ensureCss() {
    for (const href of [new URL('../../css/ui.css', import.meta.url).href, new URL('../css/archery.css', import.meta.url).href]) {
      if ([...document.styleSheets].some((s) => s.href === href) || document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- DOM -------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="ar-root">
        <canvas class="ar-canvas" role="img"></canvas>
        <div class="ar-leaves" data-role="leaves" aria-hidden="true"></div>
        <div class="ar-bow" data-role="bow" aria-hidden="true">${ringSVG()}</div>
        <div class="ar-hintdot" data-role="hintdot" aria-hidden="true"><i></i>${HAND_SVG}</div>
        <div class="ar-fx" data-role="fx" aria-hidden="true"></div>
        <div class="ar-top" data-role="top">
          <div class="ar-round" data-role="round"></div>
          <div class="ar-tiles" data-role="tiles" role="img"></div>
        </div>
        <button type="button" class="ar-ibtn ar-menubtn" data-act="menu" data-la="aria_menu">${MENU_SVG}</button>
        <div class="ar-side" data-role="side">
          <div class="ar-wind" data-role="wind" role="img"><i data-role="windArrow">${WIND_SVG}</i><b data-role="windText"></b></div>
          <div class="ar-score ar-score-them" data-role="scoreThem"><span class="ar-score-ava" data-role="avaThem"></span><b data-role="totThem">0</b></div>
          <span class="ar-vs" aria-hidden="true"><i>V</i><i>S</i></span>
          <div class="ar-score ar-score-me" data-role="scoreMe"><span class="ar-score-ava" data-role="avaMe"></span><b data-role="totMe">0</b></div>
        </div>
        <div class="ar-banner" data-role="banner" aria-hidden="true"><b data-role="bannerMain"></b><span data-role="bannerSub"></span></div>
        <p class="ar-hint" data-role="hint" aria-hidden="true"></p>
        <div class="ar-bottom" data-role="bottom" hidden>
          <button type="button" class="ar-go" data-act="yourTurn" data-role="goBtn" hidden>${PAD_SVG}<span data-l="your_turn"></span></button>
          <p class="ar-wait" data-role="wait" hidden></p>
          <button type="button" class="gh-btn ar-alt ar-waitback" data-act="mpHome" data-role="waitBack" hidden><span data-l="mp_back"></span></button>
        </div>

        <div class="ar-ov ar-ov-setup" data-ov="setup" hidden>
          <div class="ar-card">
            <button type="button" class="ar-x ar-q" data-act="howto" data-la="howto">?</button>
            <h2 class="ar-logo" data-l="title"></h2>
            <button type="button" class="ar-mprow" data-act="multi">
              <b data-l="multiplayer"></b>
              <span class="ar-mprow-badge" data-role="onlineNote" hidden></span>
              <span class="ar-mprow-chev" aria-hidden="true">›</span>
            </button>
            <div class="ar-field">
              <div class="gh-seg ar-seg" role="group" data-role="diffs"></div>
            </div>
            <div class="ar-field">
              <span class="ar-label" data-l="first"></span>
              <div class="gh-seg ar-seg" role="group" data-role="firsts"></div>
            </div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block ar-gobtn" data-act="continue" data-role="continueBtn" hidden><span data-l="continue"></span></button>
            <div class="ar-go-row">
              <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="practice"><span data-l="practice"></span></button>
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block ar-gobtn" data-act="play"><span data-l="play"></span></button>
            </div>
          </div>
        </div>

        <div class="ar-ov ar-ov-mp" data-ov="mp" hidden></div>

        <div class="ar-ov" data-ov="menu" hidden>
          <div class="ar-card ar-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="ar-x" data-act="resume" data-la="aria_close">${X_SVG}</button>
            <h2 class="ar-h2" data-l="menu"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="howto"><span data-l="howto"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="quit" data-local><span data-l="quit"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="mpHome" data-online><span data-l="mp_back"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt ar-danger" data-act="resign" data-online><span data-l="mp_resign"></span></button>
          </div>
        </div>

        <div class="ar-ov" data-ov="pass" hidden>
          <button type="button" class="ar-card ar-card-sm ar-pass" data-act="ready">
            <span class="ar-pass-ava" data-role="passAva"></span>
            <b data-role="passName"></b>
            <span data-l="tap_ready"></span>
          </button>
        </div>

        <div class="ar-ov" data-ov="result" hidden>
          <div class="ar-card ar-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="ar-x" data-act="toSetup" data-la="aria_close">${X_SVG}</button>
            <p class="ar-res-ava" data-role="resAva"></p>
            <h2 class="ar-h2" data-role="resTitle"></h2>
            <p class="ar-res-line" data-role="resLine"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-role="againLabel"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="toSetup"><span data-role="toSetupLabel"></span></button>
          </div>
        </div>

        <div class="ar-ov" data-ov="help" hidden>
          <div class="ar-card ar-help" role="dialog" aria-modal="true">
            <button type="button" class="ar-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ar-h2" data-l="howto"></h2>
            <p class="ar-help-goal" data-l="help_goal"></p>
            <div data-role="helpSvg"></div>
            <div class="ar-help-lines">
              <p class="ar-help-line" data-l="help_rings"></p>
              <p class="ar-help-line" data-l="help_hold"></p>
              <p class="ar-help-line" data-l="help_wind"></p>
              <p class="ar-help-line" data-l="help_wind2"></p>
              <p class="ar-help-line" data-l="help_ring"></p>
              <p class="ar-help-line" data-l="help_panic"></p>
              <p class="ar-help-line" data-l="help_tie"></p>
            </div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <div class="ar-ov" data-ov="resign" hidden>
          <div class="ar-card ar-card-sm" role="dialog" aria-modal="true">
            <h2 class="ar-h2" data-l="mp_resign_q"></h2>
            <button type="button" class="gh-btn gh-btn--block ar-danger" data-act="resignYes"><span data-l="mp_resign_yes"></span></button>
            <button type="button" class="gh-btn gh-btn--block ar-alt" data-act="menu"><span data-l="mp_cancel"></span></button>
          </div>
        </div>
        <p class="ar-toast" data-role="toast" role="status" hidden></p>
        <p class="ar-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.ar-root');
    this.canvas = q('.ar-canvas');
    this.fx = q('[data-role="fx"]');
    this.bowEl = q('[data-role="bow"]');
    this.gaugeEl = q('.ar-gauge');
    this.gaugeC = parseFloat(this.gaugeEl.dataset.c);
    this.leavesEl = q('[data-role="leaves"]');
    this.hintEl = q('[data-role="hint"]');
    this.hintDot = q('[data-role="hintdot"]');
    this.banner = q('[data-role="banner"]');
    this.liveEl = q('[data-role="live"]');
    this.bottom = q('[data-role="bottom"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });

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

  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    this.canvas.setAttribute('aria-label', t('aria_scene'));
    this.root.querySelector('[data-role="helpSvg"]').innerHTML = helpSvg();
    const s = this.settings;
    const seg = (role, key, ids, cur, label, extra) => {
      const el = this.root.querySelector(`[data-role="${role}"]`);
      el.setAttribute('aria-label', t(key));
      el.innerHTML = ids.map((id) => `<button type="button" class="gh-seg__item ar-seg-item" data-${role}="${id}" aria-pressed="${cur === id}">${extra ? extra(id) : ''}<span>${esc(label(id))}</span></button>`).join('');
    };
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('firsts', 'first', FIRSTS, s.first, (id) => (id === 'alt' ? t('first_alt') : id === 'me' ? t('first_me') : t('first_them_cpu')));
    this.root.querySelector('[data-role="continueBtn"]').hidden = !this._savedMatch();
    this._paintOnlineNote();
    const online = this.mode === 'mp';
    this.root.querySelectorAll('[data-online]').forEach((el) => { el.hidden = !online; });
    this.root.querySelectorAll('[data-local]').forEach((el) => { el.hidden = online; });
    if (this.match || this.mode === 'practice') this._hud();
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'pass') this._fillPass();
    if (this.screen === 'help') this._fitHelp();
  }

  /** Every how-to line on one row: shrunk until it fits, never below 11px. */
  _fitHelp() {
    this.root.querySelectorAll('.ar-help-goal, .ar-help-line').forEach((el) => {
      el.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(el).fontSize) || 13;
      while (el.scrollWidth > el.clientWidth + 0.5 && fs > 11) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
    });
  }

  _savedMatch() {
    const s = readJSON(SAVE_KEY);
    if (!s || s.mode !== 'cpu' || !DIFFS.includes(s.diff) || !validMatch(s.match) || s.match.winner != null) return null;
    return s;
  }

  _say(s) { this.liveEl.textContent = s; }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-setup', name === 'setup' || name === 'mp' || (name === 'help' && !this.match && this.mode !== 'practice'));
  }

  _clearPlay() {
    this.timers = [];
    this.phase = 'idle';
    this.drag = null;
    this.raise = 0;
    this.fx.innerHTML = '';
    this.r.setScope(null);
    this.r.endFlight();
    this.r.clearIncoming();
    this.r.setStuck([]);
    this._lineView();
    this.turnArrows = [];
    this.banner.classList.remove('is-show');
    this._hint(null);
    this._bottom(null);
  }

  _showSetup() {
    this._mpLeave();
    this._clearPlay();
    this.screen = 'setup';
    this.match = null;
    this.mode = null;
    this.seats = null;
    this.practice = null;
    this.root.classList.remove('is-playing');
    this._relabel();
    this._showOnly('setup');
    this._countOnline();
  }

  // --- layout ----------------------------------------------------------------------------------
  _layout() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._size = w + 'x' + h;
    this.r.layout(w, h);
    this.w = w; this.h = h;
    // The bow's scale: the sight's outer ring is a tenth of the screen width (the recording).
    this.k = Math.min((0.072 * w) / SCOPE_IN, (0.0405 * h) / SCOPE_IN);
    this._draw();
  }

  // --- whose seat is whose -----------------------------------------------------------------------
  /** The seat drawn in BLUE at the bottom: this phone's player (seat 0 in pass and play). */
  _meSeat() { return this.mode === 'mp' && this.mp ? this.mp.mySeat : 0; }
  /** Does the seat shoot on this phone? */
  _isLocal(seat) {
    if (this.mode === 'pass' || this.mode === 'practice') return true;
    if (this.mode === 'mp') return !!this.mp && seat === this.mp.mySeat;
    return seat === 0;
  }
  _colorOf(seat) { return seat === this._meSeat() ? ARROW_COLORS.me : ARROW_COLORS.them; }

  _seatsFor(mode, diff) {
    const p = profile();
    const me = { name: (p && p.name) || t('you'), emoji: (p && p.emoji) || '🙂', human: true };
    if (mode === 'pass') return [me, { name: t('player2'), emoji: '🙂', human: true }];
    const o = p && p.opponents && p.opponents[0];
    return [me, { name: (o && o.name) || t('computer'), emoji: (o && o.emoji) || '🤖', human: false, diff }];
  }

  // --- starting ------------------------------------------------------------------------------------
  _newMatch(mode = 'cpu') {
    if (mode === 'cpu') this._recordQuitLoss();   // only a new match vs the computer replaces the save
    const s = this.settings;
    let starter = 0;
    if (mode === 'cpu') {
      if (s.first === 'me') starter = 0;
      else if (s.first === 'them') starter = 1;
      else { starter = s.nextStarter; s.nextStarter = starter ^ 1; }
    } else { starter = s.nextStarter; s.nextStarter = starter ^ 1; }
    writeJSON(SETTINGS_KEY, s);
    const seed = (Math.random() * 4294967296) >>> 0;
    this._begin({ mode, diff: s.difficulty, match: newMatch(seed, starter) });
  }
  _passPlay() { this._newMatch('pass'); }

  // QUITTING IS A LOSS (2026-10-29, docs/INTEGRITY-CHECKS-SPEC.md "Holes closed 2026-10-29: quitting
  // and easier settings"): the saved match against the computer, once the player has shot an arrow in
  // it, thrown away for a new one, records as a loss. Quit keeps the save (Continue), so it is not a quit.
  _quitPending() {
    if (this.match && this.mode === 'cpu') {
      const m = this.match;
      return m.winner == null && !m.recorded && m.shots[0].length > 0 ? { diff: this.diff, m } : null;
    }
    if (this.match) return null;
    const sv = this._savedMatch();
    return sv && !sv.match.recorded && sv.match.shots[0].length > 0 ? { diff: sv.diff, m: sv.match } : null;
  }

  /** Record that match as a loss, once (its own `recorded` flag, then the slot is cleared). */
  _recordQuitLoss() {
    const q = this._quitPending();
    if (!q) return;
    q.m.recorded = true;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
    try {
      const st = recordResult('archery', q.diff, false);
      if (!st) console.warn('[archery] quit loss not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[archery] recording the quit loss failed', err); }
  }

  /** Play over such a saved match asks twice, the button saying it counts as a loss. */
  _quitGate(btn, go) {
    if (!this._quitPending() || (btn && btn.dataset.armed === '1')) { if (btn) btn.dataset.armed = ''; go(); return; }
    btn.dataset.armed = '1';
    const label = btn.querySelector('[data-l]') || btn;
    label.textContent = t('quit_loss');
    clearTimeout(this._quitTimer);
    this._quitTimer = setTimeout(() => { btn.dataset.armed = ''; this._relabel(); }, 3500);
  }
  _continue() {
    const sv = this._savedMatch();
    if (!sv) { this._newMatch('cpu'); return; }
    this._begin({ mode: 'cpu', diff: sv.diff, match: sv.match });
  }

  _begin(g) {
    this._clearPlay();
    this.mode = g.mode;
    this.diff = g.diff;
    this.match = g.match;
    this.seats = g.seats || this._seatsFor(g.mode, g.diff);
    this.practice = null;
    this.screen = 'play';
    this.root.classList.add('is-playing');
    this._relabel();
    this._showOnly(null);
    this._save();
    this._tiles(this.match.turn, this.match.stage, stageShots(this.match, this.match.turn, this.match.stage).map((a) => a.s));
    this.windStage = this.match.stage;
    this.dispTotals = totals(this.match);
    this._hud();
    this._advance(null);
  }

  _save() {
    if (!this.match || this.mode !== 'cpu') return;
    if (this.match.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    writeJSON(SAVE_KEY, { mode: 'cpu', diff: this.diff, match: this.match });
  }

  // --- the HUD -------------------------------------------------------------------------------------
  _hud() {
    const m = this.match;
    const roundEl = this.root.querySelector('[data-role="round"]');
    if (this.mode === 'practice') {
      roundEl.textContent = t('practice').toUpperCase();
    } else if (m) {
      const st = this.tileView ? this.tileView.stage : m.stage;
      roundEl.textContent = isShootOff(st) ? t('shootoff') : t('round', { n: st + 1, m: ROUNDS });
    }
    // Wind.
    const w = this._wind();
    const arrowEl = this.root.querySelector('[data-role="windArrow"]');
    arrowEl.firstElementChild.style.transform = `rotate(${-w.dir * 45}deg)`;
    this.root.querySelector('[data-role="windText"]').textContent = t('wind', { n: w.mph.toFixed(1) });
    this.root.querySelector('[data-role="wind"]').setAttribute('aria-label', t('aria_wind', { mph: w.mph.toFixed(1) }));
    // Totals: you (blue) below, them (red) above.
    const me = this._meSeat(), them = me ^ 1;
    const showScores = this.mode !== 'practice' && !!this.seats;
    this.root.querySelector('[data-role="scoreThem"]').hidden = !showScores;
    this.root.querySelector('.ar-vs').hidden = !showScores;
    if (this.mode === 'practice') {
      const p = this.practice;
      this.root.querySelector('[data-role="avaMe"]').textContent = '🏆';
      this.root.querySelector('[data-role="totMe"]').textContent = String(p ? p.best : 0);
      this.root.querySelector('[data-role="scoreMe"]').setAttribute('aria-label', t('practice_best') + ' ' + (p ? p.best : 0));
    } else if (showScores) {
      const tot = this.dispTotals || [0, 0];
      this.root.querySelector('[data-role="avaMe"]').textContent = this.seats[me].emoji;
      this.root.querySelector('[data-role="avaThem"]').textContent = this.seats[them].emoji;
      this.root.querySelector('[data-role="totMe"]').textContent = String(tot[me]);
      this.root.querySelector('[data-role="totThem"]').textContent = String(tot[them]);
      this.root.querySelector('[data-role="scoreMe"]').setAttribute('aria-label', `${this.seats[me].name} ${tot[me]}`);
      this.root.querySelector('[data-role="scoreThem"]').setAttribute('aria-label', `${this.seats[them].name} ${tot[them]}`);
    }
    this._paintTiles();
  }

  _wind() {
    if (this.mode === 'practice' && this.practice) return windFor(this.practice.seed, this.practice.stage);
    if (!this.match) return { mph: 0, dir: 0 };
    return windFor(this.match.seed, this.windStage == null ? this.match.stage : this.windStage);
  }

  /** The tiles under the round pill: whose arrows, which stage, the scores so far. */
  _tiles(seat, stage, vals) { this.tileView = { seat, stage, vals: vals.slice() }; this._paintTiles(); }
  _paintTiles() {
    const tv = this.tileView;
    const el = this.root.querySelector('[data-role="tiles"]');
    if (!tv) { el.innerHTML = ''; return; }
    const n = this.mode === 'practice' ? 3 : arrowsFor(tv.stage);
    const red = this.mode !== 'practice' && tv.seat !== this._meSeat();
    el.classList.toggle('is-red', red);
    el.innerHTML = Array.from({ length: n }, (_, i) => {
      const v = tv.vals[i];
      return `<span class="ar-tile${v != null ? ' is-set' : ''}${v >= 10 ? ' is-two' : ''}">${v == null ? '?' : v === 0 ? 'M' : v}</span>`;
    }).join('');
    el.setAttribute('aria-label', t('aria_tiles', { list: tv.vals.length ? tv.vals.join(', ') : '-' }));
  }

  _hint(key) {
    if (!key) { this.hintEl.classList.remove('is-show'); this.hintDot.classList.remove('is-show'); return; }
    // No words on the range (the recording has none; How to play explains it): only the pulsing
    // dot and hand on the bow at rest. Screen readers still hear it, through the live region.
    this._say(t(key));
    this.hintDot.classList.toggle('is-show', key === 'hint_hold');
  }

  /** The bar at the bottom: the yellow Your Turn button, or "Waiting for ...". */
  _bottom(kind, name) {
    const go = this.root.querySelector('[data-role="goBtn"]');
    const wait = this.root.querySelector('[data-role="wait"]');
    const back = this.root.querySelector('[data-role="waitBack"]');
    this.bottom.hidden = !kind;
    go.hidden = kind !== 'go';
    wait.hidden = kind !== 'wait' && kind !== 'watch';
    back.hidden = kind !== 'wait';
    if (kind === 'wait') wait.textContent = t('waiting_for', { name: name || '?' });
    if (kind === 'watch') wait.textContent = t('shooting', { name: name || '?' });
  }

  _bannerShow(main, sub, kind = 'turn', ms = 1200) {
    this.root.querySelector('[data-role="bannerMain"]').textContent = main;
    this.root.querySelector('[data-role="bannerSub"]').textContent = sub || '';
    this.banner.dataset.kind = kind;
    this.banner.classList.remove('is-show');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('is-show'), ms);
  }

  /** Run `fn` after `sec` of game time (stops while a menu is open). */
  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  // --- the flow ------------------------------------------------------------------------------------
  /**
   * What happens next, after `event` (engine.js shoot's event, or null at the start):
   *   the match is won        -> the result;
   *   the next shooter is on this phone -> the line (via the Your Turn button after the other
   *                              player's round, or a Pass card in pass and play);
   *   the computer            -> its round, shown on the target;
   *   the other person online -> their arrows from the log, or waiting.
   */
  _advance(event) {
    const m = this.match;
    if (!m) return;
    if (m.winner != null) { this._finish(); return; }
    const stageStart = m.inTurn === 0 && m.turn === m.starter;
    const turnChanged = event === 'turn' || event === 'round' || event === 'tie';
    if (this._isLocal(m.turn)) {
      if (turnChanged && this.mode === 'pass') { this._passCard(stageStart, event); return; }
      if (turnChanged && (this.mode === 'cpu' || this.mode === 'mp')) {
        // Their round is on the target: the yellow button takes you to the line.
        this.phase = 'yourturn';
        for (const el of this.fx.querySelectorAll('.ar-pop')) el.remove();   // the recording: no number left up
        this._goNext = () => this._toLine(stageStart, event);
        this._bottom('go');
        this._say(t('say_turn', { name: this.seats[m.turn].name }));
        return;
      }
      this._toLine(stageStart, event);
      return;
    }
    if (this.mode === 'cpu') { this._cpuTurn(stageStart, event); return; }
    if (this.mode === 'mp') { this._mpCatchUp(); }
  }

  /** The banner a new stage gets: Round n with its wind, or the shoot-off. */
  _stageBanner(event) {
    const m = this.match;
    this.windStage = m.stage;
    this._hud();
    const w = windFor(m.seed, m.stage);
    if (isShootOff(m.stage)) {
      this._bannerShow(event === 'tie' && m.stage > ROUNDS ? t('shootoff_again') : t('shootoff_banner'), '', 'turn', 1800);
    } else {
      this._bannerShow(t('round_banner', { n: m.stage + 1 }), '', 'turn', 1400);
    }
  }

  /** To the shooting line, for the shooter whose turn it is. */
  _toLine(stageStart, event) {
    const m = this.match;
    this._bottom(null);
    this.fx.innerHTML = '';
    this.r.clearIncoming();
    this._lineView();
    this.r.setStuck([]);
    this.screen = 'play';
    this._showOnly(null);
    const seat = m.turn;
    this.turnArrows = stageShots(m, seat, m.stage).map((a) => ({ x: a.x, y: a.y, color: this._colorOf(seat) }));
    this._tiles(seat, m.stage, stageShots(m, seat, m.stage).map((a) => a.s));
    this.windStage = m.stage;
    this._hud();
    let wait = 0;
    if (stageStart) { this._stageBanner(event); wait = 1.0; }
    else if (this.mode === 'pass' && m.inTurn === 0) { this._bannerShow(t('turn_of', { name: this.seats[seat].name }), '', 'turn'); }
    this.phase = 'line';
    this.raise = 0;
    this._after(wait, () => this._ready());
  }

  _ready() {
    if (this.phase !== 'line') return;
    this.phase = 'ready';
    const m = this.match;
    // The hint: before the first arrow of each of your turns (the recording), and always for a new
    // player's first few arrows.
    const first = this.mode === 'practice' ? this.practice.arrows.length === 0 : m.inTurn === 0;
    this._hint(first || this.settings.shots < 3 ? 'hint_hold' : null);
  }

  /** Pass and play: the phone changes hands before the other seat shoots. */
  _passCard(stageStart, event) {
    this.phase = 'idle';
    this.screen = 'pass';
    this._passNext = () => this._toLine(stageStart, event);
    this._fillPass();
    this._showOnly('pass');
  }
  _fillPass() {
    const m = this.match;
    if (!m || !this.seats) return;
    const s = this.seats[m.turn];
    this.root.querySelector('[data-role="passName"]').textContent = t('pass_to', { name: s.name });
    this.root.querySelector('[data-role="passAva"]').textContent = s.emoji;
  }

  // --- the computer's round: shown on the target, the way the other person's is online ---------
  _cpuTurn(stageStart, event) {
    const m = this.match;
    const seat = m.turn;
    const name = this.seats[seat].name;
    this._bottom('watch', name);
    this.phase = 'replay';
    const go = () => {
      this._closeUp(seat);
      this._after(0.5, () => this._cpuArrow());
    };
    if (stageStart) {
      this._lineView();
      this.r.setStuck([]);
      this._stageBanner(event);
      this._after(1.3, go);
    } else go();
  }
  _cpuArrow() {
    const m = this.match;
    if (!m || this.mode !== 'cpu' || this.phase !== 'replay') return;
    const seat = m.turn;
    const p = cpuShot(m, this.seats[seat].diff || this.diff);
    this._incoming(seat, p, () => {
      const res = shoot(m, p.x, p.y);
      this._save();
      this._landed(seat, p, res, this.r.incomingDir());
      if (res.event === 'arrow') this._after(0.9, () => this._cpuArrow());
      else this._after(1.6, () => { this._bottom(null); this._advance(res.event); });
    });
  }

  /** The close-up of the target, showing `seat`'s arrows of the stage being shot. */
  _closeUp(seat) {
    const m = this.match;
    this.r.setView('close');
    this.turnArrows = stageShots(m, seat, m.stage).map((a) => ({ x: a.x, y: a.y, color: this._colorOf(seat) }));
    this.r.setStuck(this.turnArrows);
    this.fx.innerHTML = '';
    this._tiles(seat, m.stage, stageShots(m, seat, m.stage).map((a) => a.s));
    this.windStage = m.stage;
    this._hud();
  }

  /** An arrow comes in to the close-up at `p`, then `done()`. */
  _incoming(seat, p, done) {
    const color = this._colorOf(seat);
    // Matt, 2026-10-20: at 0.28 s it seemed to appear from nowhere; now it flies in with a trail.
    const T = this.reduce ? 0.01 : 0.5;
    this._inc = { p, color, t: 0, T, done };
  }
  /** An arrow has just hit: it is in the target (quivering) at once; its number comes with _landed. */
  _preStick(p, color, dir) {
    // The last arrow's number goes as this one hits, so it is never read as this one's.
    for (const old of this.fx.querySelectorAll('.ar-pop')) old.remove();
    this._pendingHit = performance.now();
    this.r.setStuck([...this.turnArrows, { x: p.x, y: p.y, color, dir, hit: this._pendingHit }]);
  }

  /** An arrow has landed (any shooter): stick it, pop its number, fill its tile, count the total. */
  _landed(seat, p, res, dir) {
    const m = this.match;
    const s = res ? res.s : scoreAt(p.x, p.y);
    const st = res && (res.event === 'round' || res.event === 'tie') ? m.stage - 1 : m.stage;
    this.turnArrows.push({ x: p.x, y: p.y, color: this._colorOf(seat), dir, hit: this._pendingHit || 0 });
    this._pendingHit = 0;
    this.r.setStuck(this.turnArrows);
    if (this.tileView && this.tileView.seat === seat) this.tileView.vals.push(s);
    else this._tiles(seat, st, [s]);
    this.dispTotals = totals(m);
    this._hud();
    this._pop(p, s);
    const name = this.seats[seat].name;
    this._say(s ? t('say_score', { name, n: s }) : t('say_miss', { name }));
  }

  _pop(p, s) {
    // Only the newest number stays up (the recording): an earlier one goes when the next lands.
    for (const old of this.fx.querySelectorAll('.ar-pop')) old.remove();
    const onBoss = Math.max(Math.abs(p.x), Math.abs(p.y)) <= BOSS;
    if (!s) { this._bannerShow(t('miss'), '', 'miss', 1000); return; }
    const at = onBoss ? this.r.faceToScreen(p.x, p.y) : { x: this.w / 2, y: this.h * 0.4 };
    const el = document.createElement('div');
    el.className = 'ar-pop' + (this.reduce ? ' is-still' : '');
    el.style.left = Math.round(at.x) + 'px';
    el.style.top = Math.round(at.y - 18) + 'px';
    el.innerHTML = `<b>${s}</b>`;
    if (!this.reduce) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
        const d = 50 + Math.random() * 45;
        const star = document.createElement('i');
        star.className = 'ar-star';
        star.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
        star.style.setProperty('--dy', Math.round(Math.sin(a) * d) + 'px');
        star.style.animationDelay = (Math.random() * 0.08).toFixed(2) + 's';
        star.innerHTML = STAR_SVG;
        el.appendChild(star);
      }
    }
    this.fx.appendChild(el);
    // The ring it scored flashes yellow (the recording), drawn on the face itself (render.js).
    if (onBoss && s > 0) this.r.flashRing(s);
  }

  // --- your shot ---------------------------------------------------------------------------------
  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  _pointerDown(e) {
    if (this.screen !== 'play' || this.phase !== 'ready') return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const p = this._local(e);
    this.drag = { id: e.pointerId, x: p.x, y: p.y };
    this.phase = 'draw';
    this.held = 0;
    this.gauge = 1;
    this.moved = 0;
    this._hint('hint_aim');
    // The sight comes up a little off the middle, as it does in the recording; you bring it in.
    const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.35;
    this.aim = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 - 0.15 };
    this.hand = newHand(this.aim);
    this.pull = { x: 0, y: 0 };
    this.swayPh = [Math.random() * 6, Math.random() * 6, Math.random() * 6, Math.random() * 6];
    this.swayT = 0;
  }
  _pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id || this.phase !== 'draw') return;
    const p = this._local(e);
    // About a ring for every 6 px of finger at phone width: fine enough to place, coarse enough to
    // reach the edge of the target in one thumb movement.
    const gain = 1 / (0.155 * this.w);
    const dx = (p.x - d.x) * gain, dy = (p.y - d.y) * gain;
    d.x = p.x; d.y = p.y;
    // The finger moves where the hand is trying to aim; the sight follows with weight (_tick,
    // engine.js stepHand).
    this.pull.x += dx; this.pull.y -= dy;
    this.moved += Math.hypot(dx, dy);
  }
  _pointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (this.phase !== 'draw') return;
    if (e.type !== 'pointerup') { this.phase = 'ready'; this._hint('hint_hold'); return; }   // cancelled: the bow comes down
    this._release(false);
  }
  /** The hand catches up with the finger: the sight lags, overshoots a jerk, then settles. */
  _steady(dt) {
    if (!this.hand) return;
    stepHand(this.hand, this.pull.x, this.pull.y, dt);
    this.pull.x = 0; this.pull.y = 0;
    this.aim.x = this.hand.x; this.aim.y = this.hand.y;
  }
  _aimNow() {
    const s = swayAt(this.swayT || 0, this.gauge, this.swayPh);
    return { x: this.aim.x + s.x, y: this.aim.y + s.y };
  }

  _joltT() { return this.reduce ? 0 : JOLT_T; }

  /** Let go (or panic): the arrow flies. */
  _release(panicked) {
    const m = this.match;
    const aim = this._aimNow();
    const w = this._wind();
    const hit = panicked ? panicPoint(aim) : landing(aim, w, [gauss() * 0.012, gauss() * 0.012]);
    this.phase = 'flight';
    this._hint(null);
    this.settings.shots++;
    writeJSON(SETTINGS_KEY, this.settings);
    const seat = this.mode === 'practice' ? 0 : m.turn;
    this.shot = { hit: { x: Math.round(hit.x * 1e4) / 1e4, y: Math.round(hit.y * 1e4) / 1e4 }, aim, seat, panicked, t: 0 };
    this.r.setScope(null);
    this.r.startFlight(aim, this.shot.hit, this._colorOf(seat));
    // The rules take the arrow now (so a closed app cannot take it back online); the screen shows
    // the result when it lands.
    if (this.mode === 'practice') this.shot.res = null;
    else {
      this.shot.res = shoot(m, this.shot.hit.x, this.shot.hit.y);
      this._save();
      if (this.mode === 'mp') { this.mp.applied++; this._mpRecord(this.shot.hit.x, this.shot.hit.y); }
    }
    if (panicked) this._say(t('say_panic', { name: this.mode === 'practice' ? this._myName() : this.seats[seat].name }));
  }

  /** The arrow arrives: cut to the target. */
  _arrive() {
    const sh = this.shot;
    const dir = this.r.flightDir();
    this.r.endFlight();
    this.r.setView('close');
    // The arrow stays in the target from the moment it hits; the number pops HIT_POP later. (It used
    // to be left out here and only stuck with the number, so it vanished as it hit: Matt, 2026-10-20.)
    this._preStick(sh.hit, this._colorOf(sh.seat), dir);
    this.phase = 'hit';
    this._after(HIT_POP, () => {
      if (this.mode === 'practice') { this._practiceLanded(sh, dir); return; }
      this._landed(sh.seat, sh.hit, sh.res, dir);
      const ev = sh.res ? sh.res.event : 'arrow';
      this._after(HIT_HOLD - HIT_POP + (ev === 'arrow' ? 0 : 0.8), () => {
        if (this.mode === 'mp' && ev !== 'arrow' && !this._isLocal(this.match.turn) && this.match.winner == null) {
          // Your turn is over: it is theirs now. Your arrows stay on the target while you wait.
          this._mpCatchUp();
          return;
        }
        this._advance(ev === 'arrow' ? null : ev);
      });
    });
  }

  // --- practice: no rules, no end ---------------------------------------------------------------
  _practiceStart() {
    this._clearPlay();
    this.mode = 'practice';
    this.match = null;
    this.seats = null;
    this.practice = { seed: (Math.random() * 4294967296) >>> 0, stage: 0, arrows: [], best: 0, sum: 0, n: 0 };
    this.screen = 'play';
    this.root.classList.add('is-playing');
    this._relabel();
    this._showOnly(null);
    this.tileView = { seat: 0, stage: 0, vals: [] };
    this._hud();
    this._practiceLine(true);
  }
  _practiceLine(newRound) {
    const p = this.practice;
    this._bottom(null);
    this.fx.innerHTML = '';
    this._lineView();
    this.r.setStuck([]);
    this.turnArrows = p.arrows.map((a) => ({ x: a.x, y: a.y, color: ARROW_COLORS.me }));
    this.tileView = { seat: 0, stage: 0, vals: p.arrows.map((a) => a.s) };
    this._hud();
    if (newRound) this._bannerShow(t('practice'), '', 'turn', 1300);
    this.phase = 'line';
    this._after(newRound ? 0.9 : 0, () => this._ready());
  }
  _practiceLanded(sh, dir) {
    const p = this.practice;
    const s = scoreAt(sh.hit.x, sh.hit.y);
    p.arrows.push({ x: sh.hit.x, y: sh.hit.y, s });
    p.sum += s; p.n++;
    this.turnArrows.push({ x: sh.hit.x, y: sh.hit.y, color: ARROW_COLORS.me, dir, hit: this._pendingHit || 0 });
    this._pendingHit = 0;
    this.r.setStuck(this.turnArrows);
    this.tileView.vals.push(s);
    this._pop(sh.hit, s);
    this._hud();
    this._say(s ? t('say_score', { name: this._myName(), n: s }) : t('say_miss', { name: this._myName() }));
    if (p.arrows.length < 3) { this._after(HIT_HOLD - HIT_POP, () => this._practiceLine(false)); return; }
    const total = p.arrows.reduce((n, a) => n + a.s, 0);
    p.best = Math.max(p.best, total);
    this._after(0.9, () => { this._bannerShow(String(total), t('practice_round'), 'turn', 1500); this._hud(); });
    this._after(HIT_HOLD + 0.8, () => {
      p.arrows = [];
      p.stage = (p.stage + 1) % 3;
      if (p.stage === 0) p.seed = (Math.random() * 4294967296) >>> 0;
      this._practiceLine(true);
    });
  }

  // --- the end -------------------------------------------------------------------------------------
  _finish() {
    const m = this.match;
    if (!m || m.winner == null) return;
    this._bottom(null);
    if (this.mode === 'mp') { this._mpFinish(m.winner === this.mp.mySeat, false); return; }
    if (this.mode === 'cpu' && !m.recorded) {
      m.recorded = true;
      try {
        const st = recordResult('archery', this.diff, m.winner === 0);
        if (!st) console.warn('[archery] result not recorded (rate gate or store refused it)');
      } catch (err) { console.error('[archery] recording the result failed', err); }
    }
    this._save();
    this._say(t('say_win', { name: this.seats[m.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
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
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = t('win_name', { name: w.name });
    const tot = totals(m);
    const a = tot[m.winner], b = tot[m.winner ^ 1];
    let line = t(isShootOff(m.stage) ? 'result_so' : 'result_line', { a, b });
    if (mp && mp.resigned) line = mp.timedOut ? t('mp_timed_out') : t('mp_they_resigned', { name: (iWon ? mp.them : this.seats[mp.mySeat]).name });
    this.root.querySelector('[data-role="resLine"]').textContent = line;
    this.root.querySelector('[data-role="againLabel"]').textContent = t(mp ? 'mp_again' : 'play_again');
    this.root.querySelector('[data-role="toSetupLabel"]').textContent = t(mp ? 'mp_back' : 'menu');
  }

  // --- input ---------------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-diffs], [data-firsts]');
    if (seg) {
      if (seg.dataset.diffs) this.settings.difficulty = seg.dataset.diffs;
      else this.settings.first = seg.dataset.firsts;
      writeJSON(SETTINGS_KEY, this.settings);
      this._relabel();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') this._quitGate(b, () => this._newMatch('cpu'));
    else if (act === 'multi') this._openOnline();
    else if (act === 'practice') this._practiceStart();
    else if (act === 'continue') this._continue();
    else if (act === 'howto') { this._helpFrom = this.screen; this.screen = 'help'; this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') {
      if (this._helpFrom === 'menu') { this.screen = 'menu'; this._showOnly('menu'); } else this._showSetup();
    }
    else if (act === 'menu') {
      if (this.screen === 'play' || this.screen === 'resign') {
        if (this.phase === 'draw' || this.phase === 'panic') return;
        this._paintResign();
        this.screen = 'menu';
        this._showOnly('menu');
      }
    }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._save(); this._showSetup(); }
    else if (act === 'mpHome') this._openOnline();
    else if (act === 'resign') { this._paintResign(); this.screen = 'resign'; this._showOnly('resign'); }
    else if (act === 'resignYes') this._mpResign();
    else if (act === 'ready') { this.screen = 'play'; this._showOnly(null); const f = this._passNext; this._passNext = null; if (f) f(); }
    else if (act === 'yourTurn') { if (this.phase === 'yourturn' && this._goNext) { const f = this._goNext; this._goNext = null; f(); } }
    else if (act === 'again') {
      if (this.mode === 'mp') this._sendChallenge(this.mp.them);
      else this._newMatch(this.mode === 'pass' ? 'pass' : 'cpu');
    }
    else if (act === 'toSetup') { if (this.mode === 'mp') this._openOnline(); else this._showSetup(); }
  }

  // --- online (archery/js/mp.js keeps the match; archery/js/mp-ui.js draws the lists) -------------
  // The local match is the STORED one (seat 0 = side 'a', the challenger, who shoots first in every
  // round). Opening a match replays the log up to the other person's latest run, then SHOWS that
  // run arrow by arrow on the target (the recording's opening: their arrows in the target, red
  // tiles, then the yellow Your Turn button). Your arrows are appended to the log as they are shot.
  async _loadMP() { if (!this.MP) this.MP = await import('./mp.js'); return this.MP; }

  _toast(msg, ms = 1800) {
    const el = this.root.querySelector('[data-role="toast"]');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

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

  async _openOnline(pickFor = null) {
    this._mpLeave();
    this._clearPlay();
    this.match = null; this.seats = null; this.mode = null; this.practice = null;
    this.root.classList.remove('is-playing');
    const [MP, UI] = await Promise.all([this._loadMP(), import('./mp-ui.js')]);
    if (instance !== this) return;
    this.UI = UI;
    if (pickFor && pickFor.code) UI.challengeTo(this, MP, pickFor);
    else UI.home(this, MP);
  }

  async _openMatch(id) {
    const MP = await this._loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (instance !== this) return;
    if (!game) { this._toast(t('mp_not_found'), 2200); this._openOnline(); return; }
    this._mpBegin(game);
  }

  async _sendChallenge(them) {
    const MP = await this._loadMP();
    const res = await MP.createGame({ them });
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
    const endText = this._mpEndText(game, side);
    if (endText) { this._mpLeave(); this._openOnline(); this._toast(endText, 3200); return; }
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
    const mp = this.mp;
    this._begin({ mode: 'mp', diff: 'mp', match, seats: [seat(game.a), seat(game.b)] });
    this._mpMountChat();
    MP.watchGame(game.id, (g) => this._mpOnGame(g)).then((stop) => {
      if (this.mp === mp) mp.stop = stop; else { try { stop(); } catch { /* detached */ } }
    });
  }

  /** Show whatever the target has not shown yet, then play on (or wait). */
  _mpCatchUp() {
    const mp = this.mp;
    if (!mp || this.mode !== 'mp' || mp.finished) return;
    const g = mp.game;
    const m = this.match;
    if (mp.applied < g.log.length) {
      const e = g.log[mp.applied];
      if (e.by === mp.side) {
        // Your own arrow from another phone (or before a reopen): straight in, no show.
        this.MP.applyEntry(m, e);
        mp.applied++;
        this.dispTotals = totals(m);
        this._hud();
        this._mpCatchUp();
        return;
      }
      // Theirs: on the target, one at a time.
      const seat = mp.mySeat ^ 1;
      if (this.phase !== 'replay') {
        this.phase = 'replay';
        const stageStart = m.inTurn === 0 && m.turn === m.starter;
        this._bottom('watch', mp.them.name);
        const go = () => { this._closeUp(seat); this._after(0.5, () => this._mpReplayNext()); };
        if (stageStart && m.stage > 0) { this._lineView(); this.r.setStuck([]); this._stageBanner(null); this._after(1.3, go); }
        else go();
      }
      return;
    }
    this.MP.markShown(mp.id, g.log.length);
    if (this.MP.isCalledOff(g)) { this._mpEndedNoResult(this._mpEndText(g, mp.side)); return; }
    if (m.winner != null) { this._finish(); return; }
    if (g.over && (g.over.why === 'resign' || g.over.why === 'timeout')) { this._mpFinish(g.over.winner === mp.side, true); return; }
    if (m.turn === mp.mySeat) { this._advance(this._mpLastEvent || null); this._mpLastEvent = null; return; }
    this._mpWaiting();
  }
  _mpReplayNext() {
    const mp = this.mp;
    if (!mp || this.phase !== 'replay') return;
    const g = mp.game, m = this.match;
    const e = g.log[mp.applied];
    if (!e || e.by === mp.side) { this.phase = 'idle'; this._mpCatchUp(); return; }
    const seat = mp.mySeat ^ 1;
    this._incoming(seat, { x: e.x, y: e.y }, () => {
      const before = m.stage;
      const res = { event: this.MP.applyEntry(m, e), s: scoreAt(e.x, e.y) };
      mp.applied++;
      if (m.stage !== before && res.event === 'round') { /* the stage moved on with this arrow */ }
      this._landed(seat, { x: e.x, y: e.y }, res, this.r.incomingDir());
      this.MP.markShown(mp.id, mp.applied);
      const more = mp.applied < g.log.length && g.log[mp.applied].by !== mp.side;
      if (res.event === 'arrow' && more) { this._after(0.9, () => this._mpReplayNext()); return; }
      this._mpLastEvent = res.event === 'arrow' ? null : res.event;
      this._after(res.event === 'arrow' ? 0.9 : 1.6, () => { this.phase = 'idle'; this._bottom(null); this._mpCatchUp(); });
    });
  }

  _mpWaiting() {
    this.phase = 'waiting';
    this._bottom('wait', this.mp.them.name);
  }

  _mpOnGame(g) {
    const mp = this.mp;
    if (!mp || g.id !== mp.id || g.log.length < mp.game.log.length) return;
    mp.game = g;
    if (this.MP.isCalledOff(g) && !mp.finished) { this._mpEndedNoResult(this._mpEndText(g, mp.side)); return; }
    if (g.over && (g.over.why === 'resign' || g.over.why === 'timeout') && !mp.finished && mp.applied >= g.log.length) {
      this._mpFinish(g.over.winner === mp.side, true);
      return;
    }
    if (mp.applied < g.log.length && this.phase === 'waiting') { this._bottom(null); this._mpCatchUp(); }
  }

  /** One of your arrows, into the log. */
  _mpRecord(x, y) {
    const mp = this.mp;
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
    MP.savePending(mp.id, base, mp.pending);
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
    } else if (res.reason === 'expired') {
      this.MP.savePending(mp.id, mp.base, []);
      this._mpEndedNoResult(t('mp_expired'));
    } else {
      console.error('[archery] an arrow could not be sent:', res.reason);
      this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
    }
  }

  _mpFinish(won, resigned) {
    const mp = this.mp;
    if (!mp || mp.finished) return;
    mp.finished = true;
    mp.resigned = !!resigned;
    if (resigned) this.match.winner = won ? mp.mySeat : mp.mySeat ^ 1;
    const ov = mp.game && mp.game.over;
    mp.timedOut = !!(resigned && ov && ov.why === 'timeout');   // 7 days on a turn (2026-10-29)
    this.MP.countResult(mp.id, won, (ov && ov.at) || Date.now());   // once per phone; the finish time keeps a fresh storage honest
    this.MP.markResultSeen(mp.id);
    this._say(t('say_win', { name: this.seats[this.match.winner].name }));
    this.screen = 'result';
    this.phase = 'idle';
    this._bottom(null);
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
    if (res.cancelled) { this._mpEndedNoResult(this._mpEndText(res.game, mp.side)); return; }
    this._mpFinish(false, true);
  }

  /** Resign, or CANCEL / DECLINE while the other person has not answered (js/challenge-life.js). */
  _paintResign() {
    const mp = this.mp;
    if (!mp || !this.MP || !mp.game) return;
    const life = this.MP.lifeOf(mp.game);
    const kind = !life.open ? 'resign' : mp.side === this.MP.recipientOf(mp.game) ? 'decline' : 'cancel';
    const set = (sel, key) => { const el = this.host.querySelector(sel); if (el) el.textContent = t(key); };
    set('[data-act="resign"] span', kind === 'resign' ? 'mp_resign' : `mp_${kind}_ch`);
    set('[data-ov="resign"] h2', kind === 'resign' ? 'mp_resign_q' : `mp_${kind}_q`);
    set('[data-act="resignYes"] span', kind === 'resign' ? 'mp_resign_yes' : `mp_${kind}_ch`);
    set('[data-ov="resign"] [data-act="menu"] span', kind === 'resign' ? 'mp_cancel' : 'mp_keep');
  }

  _mpEndText(game, side) {
    const MP = this.MP;
    if (!game || !MP) return '';
    if (MP.lifeOf(game).expired) return t('mp_expired');
    if (!MP.isCalledOff(game)) return '';
    const why = game.over.why === 'declined' ? 'declined' : 'cancelled';
    const iSent = side !== MP.recipientOf(game);
    const mine = why === 'cancelled' ? iSent : !iSent;
    const them = MP.themOf(game, MP.myCode());
    return t(mine ? `mp_you_${why}` : `mp_they_${why}`, { name: (them && them.name) || '?', me: this._myName() });
  }
  _mpEndedNoResult(text) {
    const mp = this.mp;
    if (mp) { mp.finished = true; try { this.MP.markSeen(mp.id, mp.game && mp.game.updated); } catch { /* bubble again */ } }
    this._openOnline();
    this._toast(text, 3200);
  }

  // --- quick chat inside a challenge (js/match-chat-ui.js + js/match-chat.js, archery/chat/<id>) --
  async _mpMountChat() {
    this._mpUnmountChat();
    const mp = this.mp;
    if (!mp) return;
    let UI, DATA;
    try { [UI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
    if (instance !== this || this.mp !== mp || this._chat) return;
    const node = 'archery';
    const side = mp.side;
    const seenAt = DATA.readChatSeen(node, mp.id);
    const chat = UI.createMatchChat({
      root: this.root,
      send: (p) => DATA.sendChat({ node, id: mp.id, side }, p),
      them: () => ({ name: mp.them.name || '?', emoji: mp.them.emoji || '' }),
      place: CHAT_PLACE,
    });
    this._chat = chat;
    const stop = await DATA.watchChat({ node, id: mp.id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === side;
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at }, { pop: !mine && c.at > seenAt });
        if (!mine) newest = Math.max(newest, c.at);
      }
      DATA.markChatSeen(node, mp.id, newest);
    });
    if (instance !== this || this.mp !== mp || this._chat !== chat) { try { stop(); } catch { /* detached */ } return; }
    this._chatStop = stop;
  }
  _mpUnmountChat() {
    if (this._chatStop) { try { this._chatStop(); } catch { /* detached */ } this._chatStop = null; }
    if (this._chat) { try { this._chat.destroy(); } catch { /* gone */ } this._chat = null; }
  }
  _mpLeave() {
    this._mpUnmountChat();
    const mp = this.mp;
    if (!mp) return;
    this.mp = null;
    if (mp.stop) { try { mp.stop(); } catch { /* detached */ } }
  }

  // --- clock -----------------------------------------------------------------------------------------
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
    if (this.screen === 'play' || this.screen === 'result') this._tick(dt * (this.speed || 1));
    this._leaves(dt);
    this._draw();
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }

  _tick(dt) {
    this.clock += dt;
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.clock);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.at > this.clock);
        for (const x of due) x.fn();
      }
    }
    // The bow comes up while drawing.
    const up = this.phase === 'draw' || this.phase === 'panic';
    this.raise = Math.max(0, Math.min(1, this.raise + (up ? dt : -dt) / DRAW_T));
    if (this.phase === 'draw') {
      this.held += dt;
      this.swayT = (this.swayT || 0) + dt;
      const speed = this.moved / Math.max(dt, 1e-3);
      this.moved = 0;
      this._steady(dt);
      this.gauge = drainGauge(this.gauge, dt, this.held, speed);
      if (this.gauge <= 0) {
        // PANIC (Matt): the arm shakes, jerks up, and the arrow goes over the target.
        this.phase = 'panic';
        this.panicT = 0;
        this.drag = null;
        this._bannerShow(t('panic'), '', 'miss', 900);
      }
    } else if (this.phase === 'panic') {
      this.panicT += dt;
      this.swayT = (this.swayT || 0) + dt;
      this._steady(dt);
      if (this.panicT >= PANIC_T) this._release(true);
    }
    if (this.phase === 'flight' && this.shot) {
      // The arrow leaves the bow (JOLT_T), then the flight.
      this.shot.t += dt;
      const u = (this.shot.t - this._joltT()) / FLIGHT_T;
      if (u >= 0) this.r.setFlight(u);
      if (u >= 1) this._arrive();
    }
    const inc = this._inc;
    if (inc) {
      inc.t += dt;
      this.r.setIncoming(inc.p, inc.color, inc.t / inc.T);
      if (inc.t >= inc.T) {
        this._inc = null;
        this.r.clearIncoming();
        this._preStick(inc.p, inc.color, this.r.incomingDir());
        this._after(HIT_POP, inc.done);
      }
    }
  }

  // --- leaves on the wind (decoration: none with reduced motion) --------------------------------
  _leaves(dt) {
    const playing = this.screen !== 'setup' && this.screen !== 'mp' && (this.match || this.practice);
    if (this.reduce || !playing || !this.w) {
      if (this.leaves.length) { this.leaves = []; this.leavesEl.innerHTML = ''; }
      return;
    }
    const w = this._wind();
    const d = driftOf(w);
    const len = Math.hypot(d.x, d.y) || 1;
    const vx = (d.x / len), vy = -(d.y / len);
    this.leafAt -= dt;
    if (this.leafAt <= 0 && this.leaves.length < 6) {
      this.leafAt = Math.max(0.35, 1.6 - w.mph * 0.2);
      const el = document.createElement('i');
      el.className = 'ar-leaf';
      el.innerHTML = LEAF_SVG;
      el.style.color = ['#5fbf3a', '#7fd14a', '#3d9d2c'][(Math.random() * 3) | 0];
      // Enter from the side the wind comes from.
      const W = this.w, H = this.h;
      let x, y;
      if (Math.abs(vx) >= Math.abs(vy)) { x = vx > 0 ? -30 : W + 30; y = Math.random() * H * 0.8; }
      else { y = vy > 0 ? -30 : H + 30; x = Math.random() * W; }
      const sp = 120 + w.mph * 45;
      this.leaves.push({ el, x, y, vx: vx * sp + (Math.random() - 0.5) * 40, vy: vy * sp + 20 + (Math.random() - 0.5) * 40, rot: Math.random() * 360, vr: (Math.random() - 0.5) * 400, s: 0.6 + Math.random() * 0.7 });
      this.leavesEl.appendChild(el);
    }
    this.leaves = this.leaves.filter((l) => {
      l.x += l.vx * dt; l.y += l.vy * dt; l.rot += l.vr * dt;
      l.vy += Math.sin(l.rot / 40) * 6 * dt;
      const out = l.x < -60 || l.x > this.w + 60 || l.y < -60 || l.y > this.h + 60;
      if (out) { l.el.remove(); return false; }
      l.el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) rotate(${l.rot.toFixed(0)}deg) scale(${l.s})`;
      return true;
    });
  }

  // --- a frame: the bow over the range ------------------------------------------------------------
  _draw() {
    if (!this.r || !this.w) return;
    const jolt = this.phase === 'flight' && this.shot && this.shot.t < this._joltT();
    const showBow = (this.screen === 'play' || this.screen === 'menu' || this.screen === 'help' || this.screen === 'resign' || this.screen === 'setup' || this.screen === 'mp')
      && this.r.view === 'line' && (jolt || this.phase === 'line' || this.phase === 'ready' || this.phase === 'draw' || this.phase === 'panic' || this.screen === 'setup' || this.screen === 'mp' || this.phase === 'idle');
    this.bowEl.style.visibility = showBow ? 'visible' : 'hidden';
    // Back on the line the bow slides up into view from below (the recording, about 0.2 s).
    if (showBow && !this._bowShown) this._bowInAt = performance.now();
    this._bowShown = showBow;
    if (showBow) {
      const T = this.r.faceToScreen(0, 0);
      const ease = (p) => p * p * (3 - 2 * p);
      const p = jolt ? 1 : ease(this.raise);
      // Down: the sight small, right of the target, the bow lower. Drawn: the sight on the aim.
      const aimP = this.phase === 'draw' || this.phase === 'panic' ? this._aimNow() : jolt ? this.shot.aim : { x: 0, y: 0 };
      const A = this.r.faceToScreen(aimP.x, aimP.y);
      const idle = { x: T.x + this.w * 0.143, y: T.y + this.h * 0.015, k: this.k * 0.6, rot: 3 };
      const drawn = { x: A.x, y: A.y, k: this.k, rot: 0 };
      let x = idle.x + (drawn.x - idle.x) * p, y = idle.y + (drawn.y - idle.y) * p;
      const k = idle.k + (drawn.k - idle.k) * p;
      // On the way up the bow tilts and swings left, then settles upright on the aim.
      const bump = Math.sin(Math.PI * p);
      let rot = idle.rot + (drawn.rot - idle.rot) * p - 7 * bump;
      x -= this.w * 0.05 * bump;
      if (this.phase === 'panic' && !this.reduce) {
        const s = 6 + this.panicT * 18;
        x += (Math.random() - 0.5) * s; y += (Math.random() - 0.5) * s - this.panicT * 40;
      }
      // Let go: the string snaps straight and the arrow leaves the bow (no kick: the bow jumping and
      // turning for two frames before the cut read as a glitch, Matt's recording 2026-10-22).
      let fly = 0;
      if (jolt) fly = this.shot.t / this._joltT();
      if (!this.reduce && this._bowInAt) {
        const q = Math.min(1, (performance.now() - this._bowInAt) / (BOW_IN_T * 1000));
        if (q < 1) { const e = 1 - (1 - q) * (1 - q); y += (1 - e) * this.h * 0.45; x += (1 - e) * this.w * 0.12; }
      }
      this.bowEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${k.toFixed(4)})`;
      this.r.setBow({ x, y, r: SCOPE_IN * k, rot, p, fly }, this._bowColor());
      // The ring: how much hold is left, green, then yellow below a third.
      const g = this.phase === 'draw' || this.phase === 'panic' ? this.gauge : 1;
      this.gaugeEl.setAttribute('stroke-dasharray', `${(g * this.gaugeC).toFixed(1)} ${this.gaugeC.toFixed(1)}`);
      this.gaugeEl.setAttribute('stroke', g < GAUGE.red ? '#ff3b30' : g < GAUGE.yellow ? '#ffd21f' : '#2fdc4a');
      if (p > 0.55 && (this.phase === 'draw' || this.phase === 'panic')) this.r.setScope({ x, y, r: SCOPE_IN * k, ax: aimP.x, ay: aimP.y });
      else this.r.setScope(null);
      // The hint dot sits left of the hand, on the bow at rest.
      if (this.hintDot.classList.contains('is-show')) {
        const kk = idle.k;
        this.hintDot.style.transform = `translate(${(idle.x - 22 + 10 * kk).toFixed(1)}px, ${(idle.y + 360 * kk).toFixed(1)}px)`;
      }
    } else { this.r.setScope(null); this.r.setBow(null); }
    this.r.render();
  }

  /** This phone's player, by profile name (never "You"). */
  _myName() { const p = loadProfile(); return (p && p.name) || t('you'); }

  /** Back to the shooting line. A score number (or ring flash) from the close-up never follows
   *  the view there (Matt's phone recording: a "10" was left floating over the round banner). */
  _lineView() {
    this.r.setView('line');
    this.r.clearFlash();
    if (this.fx) for (const el of this.fx.querySelectorAll('.ar-pop')) el.remove();
  }

  /** The colour of the arrow on the bow: the shooter's. */
  _bowColor() {
    if (this.mode === 'practice' || !this.match) return ARROW_COLORS.me;
    return this._colorOf(this.match.turn);
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
    this.root.removeEventListener('touchmove', this._onTouchMove);
    try { this.r.dispose(); } catch { /* gone */ }
    this.host.innerHTML = '';
  }
}

export function init(container) {
  if (instance) destroy();
  instance = new ArcheryUI(container);
  // Test seam (like Darts' window.__dtTest): lets the headless checks drive the game.
  if (typeof window !== 'undefined') window.__arTest = { ui: instance, hashStr };
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
  if (typeof window !== 'undefined' && window.__arTest && window.__arTest.ui === i) delete window.__arTest;
}
/** Autosave meaning: every arrow is saved and the match resumes, so leaving loses nothing. */
export function isInProgress() { return false; }
export default { init, destroy, isInProgress };
