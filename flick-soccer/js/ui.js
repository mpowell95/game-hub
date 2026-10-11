// flick-soccer/js/ui.js - Flick Soccer's DOM shell: setup, the play screen (one canvas pitch under
// a thin scoreboard), the drag-and-flick input, the turn flow, the computer, menus, autosave and
// stats. Rules and physics live in engine.js, the computer in ai.js, pixels in render.js.
//
// isInProgress(): the AUTOSAVE meaning. The match is saved every time the pitch comes to rest
// (gamehub.flicksoccer.save.v1) and the setup screen offers Continue match, so leaving is lossless
// and this returns false. Leaving while a shot is still rolling plays that shot out first
// (_settleNow), so a goal in flight is never lost or taken back. A match is recorded once it is won,
// against the computer only. An ONLINE challenge (2026-10-11, mp.js) lives on the server, every flick
// written the moment it is made, so leaving one loses nothing either.

import {
  newMatch, validMatch, step, atRest, freeze, settle, flick, discAt, aimContact, runToRest,
  maxShotSteps, teamOf, BALL, BALL_R, DISC_R, DT, GOAL_OPTIONS, W, H,
} from './engine.js';
import { planShot, DIFFS } from './ai.js';
import { createRenderer, TEAM } from './render.js';
import { roundShot } from './mp.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const STATS_ID = 'flicksoccer';
const SETTINGS_KEY = 'gamehub.flicksoccer.v1';
const SAVE_KEY = 'gamehub.flicksoccer.save.v1';
const MODES = ['cpu', 'pass'];
const FIRSTS = ['alt', 'me', 'them'];
/** How far back (pitch units) a full-strength pull goes, and the dead zone round the disc. */
const PULL_MAX = 34;
const PULL_DEAD = DISC_R * 0.5;
/** The weakest flick that counts; anything less is a cancelled aim. */
const MIN_POWER = 0.04;
/** Physics steps allowed per frame, so a stalled tab cannot teleport anything (Part 3). */
const MAX_STEPS = 24;
/** The computer's thinking budget per frame (ms), and the least time it takes to "decide". */
const CPU_SLICE_MS = 7;
const CPU_MIN_THINK = 0.55;
const CPU_AIM_SECS = 0.5;

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (err) { console.error('[flick-soccer] save failed: ' + k, err); return false; }
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
    goals: GOAL_OPTIONS.includes(s.goals) ? s.goals : 2,
    first: FIRSTS.includes(s.first) ? s.first : 'alt',
    nextStarter: s.nextStarter === 1 ? 1 : 0,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
/** A team's chip: its colour AND its shape, never colour alone. */
const teamChip = (seat) => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" fill="${TEAM[seat].fill}" stroke="#fff" stroke-width="1.5"/>${seat === 0
  ? '<path d="M10 4.6 L15 13.4 L5 13.4 Z" fill="#fff"/>'
  : '<rect x="6" y="6" width="8" height="8" fill="#fff"/>'}</svg>`;

/** How to play: a disc pulled back, the flick, the ball on its way to goal. Shape and arrows carry
 *  it, not colour (docs/BUILDING-A-GAME.md, "How-to-play screens"). */
function helpSvg() {
  return `<svg class="fs-help-svg" viewBox="0 0 240 104" role="img" aria-hidden="true">
    <rect x="0" y="0" width="240" height="104" rx="10" fill="#2a7d37"/>
    <rect x="0" y="0" width="120" height="104" fill="#2f8a3e"/>
    <path d="M228 30 H240 V74 H228" fill="rgba(255,255,255,0.18)" stroke="#fff" stroke-width="2"/>
    <line x1="228" y1="6" x2="228" y2="98" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>
    <circle cx="20" cy="84" r="9" fill="#fff" opacity="0.9"/>
    <path d="M20 84 L58 60" stroke="#fff" stroke-width="2" stroke-dasharray="4 3" fill="none"/>
    <circle cx="70" cy="52" r="15" fill="#103a6b"/><circle cx="70" cy="52" r="12.5" fill="#1F5FA8"/>
    <path d="M70 44.5 L77 56 L63 56 Z" fill="#fff"/>
    <path d="M88 41 L132 14" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
    <path d="M137 11 L124 12 L131 22 Z" fill="#fff"/>
    <circle cx="150" cy="40" r="8" fill="#fbfbfb" stroke="#222" stroke-width="1"/>
    <path d="M150 36 l3 2 -1 3.5 h-4 l-1 -3.5 z" fill="#222"/>
    <path d="M160 42 Q196 46 222 52" stroke="#ffce3a" stroke-width="2.5" stroke-dasharray="5 4" fill="none"/>
    <path d="M226 53 L215 47 L216 57 Z" fill="#ffce3a"/>
  </svg>`;
}

let instance = null;

class FlickSoccerUI {
  constructor(container) {
    this.host = container;
    this.settings = loadSettings();
    this.screen = 'setup';         // setup | help | play | menu | result
    this.phase = 'idle';           // aim | cpu | cpuaim | moving | goal | idle
    this.match = null;
    this.seats = null;
    this.clock = 0;                // game time (s); stops while a menu is open
    this.timers = [];
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.spin = 0;
    this.glowT = 0;
    this.drag = null;
    this.aim = null;
    this.shotSteps = 0;
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this._ensureCss();
    this._build();
    this.r = createRenderer(this.canvas);
    this.preview = newMatch(2, 0).b;   // the line-up drawn behind the setup screen

    this._onVis = () => { if (document.hidden) { this._stop(); this._save(); } else this._start(); };
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
    // A tapped launcher bubble or notification names a match: open it straight away. The hub's
    // Challenges screen can also hand over a person to challenge ('pick').
    import('./alert.js').then((A) => {
      const o = A.takeOpen();
      if (!o || instance !== this) return;
      if (o.kind === 'pick') this._openOnline(o.them); else this._openMatch(o.id);
    }).catch(() => {});
  }

  _ensureCss() {
    for (const href of [new URL('../../css/ui.css', import.meta.url).href, new URL('../css/flick-soccer.css', import.meta.url).href]) {
      if ([...document.styleSheets].some((s) => s.href === href) || document.querySelector(`link[href="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- DOM -------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="fs-root">
        <canvas class="fs-canvas" role="img"></canvas>
        <div class="fs-top" data-role="top">
          <button type="button" class="fs-ibtn" data-act="menu" data-la="aria_menu">${MENU_SVG}</button>
        </div>
        <div class="fs-board" data-role="board">
          <div class="fs-side fs-side-0" data-side="0">
            <span class="fs-chip">${teamChip(0)}</span>
            <span class="fs-ava" data-role="ava0"></span>
            <span class="fs-nm" data-role="name0"></span>
            <b class="fs-sc" data-role="score0">0</b>
          </div>
          <span class="fs-dash" aria-hidden="true">&ndash;</span>
          <div class="fs-side fs-side-1" data-side="1">
            <b class="fs-sc" data-role="score1">0</b>
            <span class="fs-nm" data-role="name1"></span>
            <span class="fs-ava" data-role="ava1"></span>
            <span class="fs-chip">${teamChip(1)}</span>
          </div>
        </div>
        <p class="fs-status" data-role="status"></p>
        <div class="fs-banner" data-role="banner" aria-hidden="true"><b data-role="bannerMain"></b><span data-role="bannerSub"></span></div>
        <span class="fs-safe" data-role="safe" aria-hidden="true"></span>

        <div class="fs-ov fs-ov-setup" data-ov="setup" hidden>
          <div class="fs-card">
            <button type="button" class="fs-x fs-q" data-act="howto" data-la="howto">?</button>
            <h2 class="fs-logo" data-l="title"></h2>
            <p class="fs-tag" data-l="tagline"></p>
            <button type="button" class="fs-mprow" data-act="multi">
              <b data-l="multiplayer"></b>
              <span class="fs-mprow-badge" data-role="onlineNote" hidden></span>
              <span class="fs-mprow-chev" aria-hidden="true">›</span>
            </button>
            <div class="fs-field" data-role="diffField">
              <span class="fs-label" data-l="difficulty"></span>
              <div class="gh-seg fs-seg" role="group" data-role="diffs"></div>
            </div>
            <div class="fs-field">
              <span class="fs-label" data-l="goals"></span>
              <div class="gh-seg fs-seg" role="group" data-role="goalsSeg"></div>
            </div>
            <div class="fs-field">
              <span class="fs-label" data-l="first"></span>
              <div class="gh-seg fs-seg" role="group" data-role="firsts"></div>
            </div>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="continue" data-role="continueBtn" hidden><span data-l="continue"></span></button>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block fs-go" data-act="play"><span data-l="play"></span></button>
          </div>
        </div>

        <div class="fs-ov" data-ov="menu" hidden>
          <div class="fs-card fs-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="fs-x" data-act="resume" data-la="aria_close">${X_SVG}</button>
            <h2 class="fs-h2" data-l="menu"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="howto"><span data-l="howto"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="quit" data-local><span data-l="quit"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="mpHome" data-online><span data-l="mp_back"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-danger" data-act="resign" data-online><span data-l="mp_resign"></span></button>
          </div>
        </div>

        <div class="fs-ov fs-ov-mp" data-ov="mp" hidden></div>

        <div class="fs-ov fs-ov-confirm" data-ov="resign" hidden>
          <div class="fs-card fs-card-sm" role="dialog" aria-modal="true">
            <h2 class="fs-h2" data-l="mp_resign_q"></h2>
            <button type="button" class="gh-btn gh-btn--block fs-danger" data-act="resignYes"><span data-l="mp_resign_yes"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="menu"><span data-l="mp_cancel"></span></button>
          </div>
        </div>

        <div class="fs-ov" data-ov="result" hidden>
          <div class="fs-card fs-card-sm" role="dialog" aria-modal="true">
            <button type="button" class="fs-x" data-act="toSetup" data-la="aria_close">${X_SVG}</button>
            <p class="fs-res-ava" data-role="resAva"></p>
            <h2 class="fs-h2" data-role="resTitle"></h2>
            <p class="fs-res-line" data-role="resLine"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again"><span data-role="againLabel"></span></button>
            <button type="button" class="gh-btn gh-btn--block fs-alt" data-act="toSetup"><span data-role="toSetupLabel"></span></button>
          </div>
        </div>

        <div class="fs-ov" data-ov="help" hidden>
          <div class="fs-card fs-help" role="dialog" aria-modal="true">
            <button type="button" class="fs-x" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="fs-h2" data-l="howto"></h2>
            <p class="fs-help-goal" data-l="help_goal"></p>
            <div data-role="helpSvg"></div>
            <p class="fs-help-line fs-help-cap" data-l="help_caption"></p>
            <p class="fs-help-line fs-help-ex" data-l="help_example"></p>
            <p class="fs-help-line" data-l="help_turns"></p>
            <p class="fs-help-line" data-l="help_own"></p>
            <p class="fs-help-line" data-l="help_kick"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>
        <p class="fs-toast" data-role="toast" role="status" hidden></p>
        <p class="fs-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.fs-root');
    this.canvas = q('.fs-canvas');
    this.banner = q('[data-role="banner"]');
    this.statusEl = q('[data-role="status"]');
    this.liveEl = q('[data-role="live"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });
    this.sideEls = [q('[data-side="0"]'), q('[data-side="1"]')];
    this.root.querySelector('[data-role="helpSvg"]').innerHTML = helpSvg();

    this.root.addEventListener('click', (e) => this._click(e));
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e, false);
    this._onCancel = (e) => this._pointerUp(e, true);
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onCancel);
    // Scroll-leak guard, root-scoped (never document: root CLAUDE.md, "Scroll and touch rules").
    this._onTouchMove = (e) => { if (this.screen === 'play') e.preventDefault(); };
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
      el.innerHTML = ids.map((id) => `<button type="button" class="gh-seg__item fs-seg-item" data-${role.toLowerCase()}="${id}" aria-pressed="${cur === id}">${extra ? extra(id) : ''}<span>${esc(label(id))}</span></button>`).join('');
    };
    seg('diffs', 'difficulty', DIFFS, s.difficulty, (id) => t('diff_' + id), (id) => diffShapeSVG(tierOf(id)));
    seg('goalsSeg', 'goals', GOAL_OPTIONS.map(String), String(s.goals), (id) => id);
    seg('firsts', 'first', FIRSTS, s.first, (id) => (id === 'alt' ? t('first_alt') : id === 'me' ? t('first_me') : t('first_them_cpu')));
    this.root.querySelector('[data-role="continueBtn"]').hidden = !this._savedMatch();
    this._paintOnlineNote();
    const online = this.mode === 'mp';
    this.root.querySelectorAll('[data-online]').forEach((el) => { el.hidden = !online; });
    this.root.querySelectorAll('[data-local]').forEach((el) => { el.hidden = online; });
    if (this.seats) { if (!online) this.seats = this._seatsFor(this.mode, this.diff); this._hud(); }
    if (this.screen === 'result') this._fillResult();
    if (this.screen === 'help') this._fitHelp();
    if (this.screen === 'play') this._status();
  }

  /** Every how-to line on one row: measured, shrunk until it fits, never below 11px
   *  (docs/BUILDING-A-GAME.md, "How-to-play screens"). */
  _fitHelp() {
    this.root.querySelectorAll('.fs-help-goal, .fs-help-line').forEach((el) => {
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
    this.root.classList.toggle('is-setup', name === 'setup' || name === 'mp' || (name === 'help' && !this.match));
  }

  _showSetup() {
    this._mpLeave();
    this._setFlip(false);
    this.screen = 'setup';
    this.match = null;
    this.seats = null;
    this.mode = null;
    this.timers = [];
    this.phase = 'idle';
    this.aim = null;
    this.drag = null;
    this.cpu = null;
    this.banner.classList.remove('is-show');
    this._relabel();
    this._showOnly('setup');
    this._draw();
    this._countOnline();
  }

  /** Online, the player on side b sees the pitch turned round, so their own team is at the bottom. */
  _setFlip(on) {
    this.r.flip = !!on;
    this.root.classList.toggle('is-flip', !!on);
  }

  // --- layout ----------------------------------------------------------------------------------
  /** The pitch as big as fits under the scoreboard and status line, measured from the root's real
   *  size (docs/BUILDING-A-GAME.md, Part 3). */
  _layout() {
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._size = w + 'x' + h;
    const rootTop = this.root.getBoundingClientRect().top;
    const statusBottom = this.statusEl.getBoundingClientRect().bottom - rootTop;
    const safe = this.root.querySelector('[data-role="safe"]').offsetHeight || 0;
    const top = Math.max(0, statusBottom) + 4;
    const box = { x: 6, y: top, w: w - 12, h: Math.max(120, h - top - 8 - safe) };
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.r.layout(w, h, box);
    // The goal banner sits over the middle of the pitch.
    const mid = this.r.toPx(W / 2, H / 2);
    this.root.style.setProperty('--fs-banner-y', Math.round(mid.y) + 'px');
    this._draw();
  }

  // --- the match -------------------------------------------------------------------------------
  _seatsFor(mode, diff) {
    const p = profile();
    if (mode === 'pass') {
      return [{ name: t('blue'), emoji: (p && p.emoji) || '🙂', human: true }, { name: t('red'), emoji: '😎', human: true }];
    }
    const o = p && p.opponents && p.opponents[0];
    return [
      { name: (p && p.name) || t('you'), emoji: (p && p.emoji) || '🙂', human: true },
      { name: (o && o.name) || t('computer'), emoji: (o && o.emoji) || '🤖', human: false, diff },
    ];
  }

  _newMatch() {
    const s = this.settings;
    let starter;
    if (s.first === 'me') starter = 0;
    else if (s.first === 'them') starter = 1;
    else { starter = s.nextStarter; s.nextStarter = starter ^ 1; }
    writeJSON(SETTINGS_KEY, s);
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(s.goals, starter) });
  }

  _continue() {
    const sv = this._savedMatch();
    if (!sv) { this._newMatch(); return; }
    this._begin({ mode: sv.mode, diff: DIFFS.includes(sv.diff) ? sv.diff : 'medium', match: sv.match });
  }

  _begin(g) {
    this.mode = g.mode;
    this.diff = g.diff;
    this.match = g.match;
    freeze(this.match.b);
    this.seats = g.seats || this._seatsFor(g.mode, g.diff);
    this._setFlip(g.mode === 'mp' && this.mp && this.mp.mySeat === 1);
    this._relabel();
    this.screen = 'play';
    this.timers = [];
    this.aim = null; this.drag = null; this.cpu = null;
    this._showOnly(null);
    this._hud();
    this._save();
    this._startTurn(true);
  }

  _save() {
    const m = this.match;
    if (!m || !this.mode || this.mode === 'mp') return;     // an online match lives on the server
    if (m.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    // Only a position at rest is a position (a rolling shot is played out first: _settleNow).
    if (!atRest(m.b) || this.phase === 'goal') return;
    writeJSON(SAVE_KEY, { mode: this.mode, diff: this.diff, match: m });
  }

  _hud() {
    const m = this.match;
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      this.root.querySelector(`[data-role="ava${i}"]`).textContent = s.emoji;
      this.root.querySelector(`[data-role="name${i}"]`).textContent = s.name;
      this.root.querySelector(`[data-role="score${i}"]`).textContent = String(m ? m.scores[i] : 0);
      this.sideEls[i].classList.toggle('is-turn', !!m && m.turn === i && m.winner == null);
      this.sideEls[i].setAttribute('aria-label', t('aria_score', { name: s.name, n: m ? m.scores[i] : 0 }));
    }
    if (m) {
      this.canvas.setAttribute('aria-label', t('aria_pitch', { a: this.seats[0].name, sa: m.scores[0], b: this.seats[1].name, sb: m.scores[1] }));
    }
  }

  _status() {
    const m = this.match;
    if (!m || this.screen === 'setup' || m.winner != null) { this.statusEl.textContent = ''; return; }
    const s = this.seats[m.turn];
    const team = t(m.turn === 0 ? 'team_blue' : 'team_red');
    let txt;
    if (this.phase === 'moving' || this.phase === 'goal') txt = t('status_wait');
    else if (this.mode === 'mp' && m.turn !== this.mp.mySeat) txt = t(this.phase === 'waiting' ? 'status_mp_wait' : 'status_mp_them', { name: s.name });
    else if (this.mode === 'mp') txt = t('status_you', { team });
    else if (!s.human) txt = t('status_cpu', { name: s.name });
    else if (this.mode === 'cpu') txt = t('status_you', { team });
    else txt = t('status_team', { name: s.name, team });
    this.statusEl.textContent = txt;
    this.statusEl.dataset.seat = String(m.turn);
  }

  _startTurn(announce) {
    const m = this.match;
    const s = this.seats[m.turn];
    this.aim = null;
    this.drag = null;
    this._hud();
    if (announce) this._say(t('say_turn', { name: s.name }));
    if (this.mode === 'mp') { this._mpCatchUp(); return; }
    if (s.human) {
      this.phase = 'aim';
    } else {
      this.phase = 'cpu';
      this.cpu = { gen: planShot(m.b, m.turn, this.diff), started: this.clock, shot: null };
    }
    this._status();
  }

  /** The computer thinks a slice at a time, then shows its aim growing, then flicks. */
  _cpuTick() {
    const c = this.cpu;
    if (!c) return;
    if (!c.shot) {
      const until = performance.now() + CPU_SLICE_MS;
      while (performance.now() < until) {
        const r = c.gen.next();
        if (r.done) { c.shot = r.value; break; }
      }
      if (!c.shot) return;
    }
    if (this.phase === 'cpu' && this.clock - c.started >= CPU_MIN_THINK) {
      this.phase = 'cpuaim';
      c.aimAt = this.clock;
    }
    if (this.phase === 'cpuaim') {
      const k = this.reduce ? 1 : Math.min(1, (this.clock - c.aimAt) / CPU_AIM_SECS);
      const sh = c.shot;
      this.aim = { i: sh.i, dx: sh.dx, dy: sh.dy, power: sh.power * k, contact: null };
      if (k >= 1) {
        this.aim = null;
        this.cpu = null;
        this._shoot(sh.i, sh.dx, sh.dy, sh.power, { replay: !!c.replay });
      }
    }
  }

  _shoot(i, dx, dy, power, opts = {}) {
    const m = this.match;
    if (!m || teamOf(i) !== m.turn) return;
    if (this.mode === 'mp') {
      const mp = this.mp;
      if (!opts.replay) {
        // Your flick, rounded to exactly what is stored, and written NOW (before it has rolled), so
        // what this phone plays is what the other phone will replay.
        const k = i - 1 - mp.mySeat * 5;
        const r = roundShot(k, dx, dy, power);
        if (!r) return;
        dx = r.dx; dy = r.dy; power = r.p;
        this._mpRecord({ by: mp.side, k, dx, dy, p: power });
      }
      mp.applied++;
    }
    this._save();                       // the position the shot was taken from
    flick(m.b, i, dx, dy, power);
    this.phase = 'moving';
    this.acc = 0;
    this.shotSteps = 0;
    this._status();
  }

  /** Advance the rolling pitch by real time `dt`. */
  _physics(dt) {
    const m = this.match;
    this.acc = Math.min(this.acc + dt, MAX_STEPS * DT);
    let n = 0;
    while (this.acc >= DT && n < MAX_STEPS) {
      this.acc -= DT; n++;
      const ball = m.b[BALL];
      const bx = ball.x, by = ball.y;
      const g = step(m.b);
      this.spin += Math.hypot(ball.x - bx, ball.y - by) / BALL_R;
      this.shotSteps++;
      if (g >= 0) { this._goal(g); return; }
      if (atRest(m.b) || this.shotSteps >= maxShotSteps()) { this._rest(); return; }
    }
  }

  _rest() {
    const m = this.match;
    freeze(m.b);
    settle(m, -1);
    this._save();
    this._startTurn(true);
  }

  _goal(scorer) {
    const m = this.match;
    this.phase = 'goal';
    // The shooter put it in their own net: say so.
    const own = m.turn !== scorer;
    const sc = m.scores.slice(); sc[scorer]++;
    this._bannerShow(t('goal'), (own ? t('own_goal') + ' · ' : '') + t('goal_sub', { a: sc[0], b: sc[1] }), scorer);
    this._say(t('say_goal', { a: this.seats[0].name, sa: sc[0], b: this.seats[1].name, sb: sc[1] }));
    this._status();
    this._after(1.7, () => {
      const res = settle(m, scorer);
      this._hud();
      if (res === 'win') { this._finish(); return; }
      this._save();
      this._startTurn(true);
    });
  }

  /** Leaving mid-shot: play it out now, off screen, so the result stands (a goal in flight counts). */
  _settleNow() {
    const m = this.match;
    if (!m || m.winner != null) return;
    if (this.phase === 'moving') {
      const r = runToRest(m.b);
      this.phase = 'idle';
      const res = settle(m, r.scorer);
      if (res === 'win') this._record();
    } else if (this.phase === 'goal') {
      // The goal already went in; the celebration timer just has not fired.
      const pending = this.timers.length ? this.timers[0] : null;
      this.timers = [];
      this.phase = 'idle';
      if (pending) pending.fn();
    }
  }

  _record() {
    const m = this.match;
    if (!m || m.winner == null || m.recorded || this.mode !== 'cpu') return;
    m.recorded = true;
    try {
      const st = recordResult(STATS_ID, this.diff, m.winner === 0);
      if (!st) console.warn('[flick-soccer] result not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[flick-soccer] recording the result failed', err); }
  }

  _finish() {
    const m = this.match;
    if (!m || m.winner == null) return;
    if (this.mode === 'mp') { this._mpFinish(m.winner === this.mp.mySeat, false); return; }
    this._record();
    this._save();
    this._say(t('say_win', { name: this.seats[m.winner].name, sa: m.scores[m.winner], sb: m.scores[m.winner ^ 1] }));
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
    const mp = this.mode === 'mp' ? this.mp : null;
    const iWon = mp ? m.winner === mp.mySeat : m.winner === 0;
    const title = this.mode === 'pass' ? t('win_name', { name: w.name }) : t(iWon ? 'win_you' : 'lose_you');
    this.root.querySelector('[data-role="againLabel"]').textContent = t(mp ? 'mp_again' : 'play_again');
    this.root.querySelector('[data-role="toSetupLabel"]').textContent = t(mp ? 'mp_back' : 'to_menu');
    this.root.querySelector('[data-role="resAva"]').textContent = w.emoji;
    this.root.querySelector('[data-role="resTitle"]').textContent = title;
    this.root.querySelector('[data-role="resLine"]').innerHTML =
      `<span class="fs-res-team">${teamChip(0)}<b>${m.scores[0]}</b></span><span aria-hidden="true">&ndash;</span><span class="fs-res-team"><b>${m.scores[1]}</b>${teamChip(1)}</span>`;
    this.root.querySelector('[data-role="resLine"]').setAttribute('aria-label', t('result_line', { a: m.scores[0], b: m.scores[1] }));
    if (mp && mp.resigned) {
      this.root.querySelector('[data-role="resLine"]').textContent = iWon ? t('mp_they_resigned', { name: mp.them.name }) : t('mp_you_resigned');
    }
  }

  // --- effects ---------------------------------------------------------------------------------
  _bannerShow(main, sub, seat) {
    this.root.querySelector('[data-role="bannerMain"]').textContent = main;
    this.root.querySelector('[data-role="bannerSub"]').textContent = sub || '';
    this.banner.dataset.seat = String(seat);
    this.banner.classList.remove('is-show');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('is-show'), 1600);
  }

  /** Run `fn` after `sec` of GAME time (stops while a menu is open). */
  _after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }

  // --- input -----------------------------------------------------------------------------------
  _click(e) {
    const seg = e.target.closest('[data-diffs], [data-goalsseg], [data-firsts]');
    if (seg) {
      const s = this.settings;
      if (seg.dataset.diffs) s.difficulty = seg.dataset.diffs;
      else if (seg.dataset.goalsseg) s.goals = Number(seg.dataset.goalsseg);
      else s.first = seg.dataset.firsts;
      writeJSON(SETTINGS_KEY, s);
      this._relabel();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') { this.settings.mode = 'cpu'; this._newMatch(); }
    else if (act === 'multi') this._openOnline();
    else if (act === 'continue') this._continue();
    else if (act === 'howto') { this._helpFrom = this.screen; this.screen = 'help'; this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') {
      if (this._helpFrom === 'menu') { this.screen = 'menu'; this._showOnly('menu'); }
      else this._showSetup();
    }
    else if (act === 'menu') { if (this.screen === 'play' || this.screen === 'resign') { this.screen = 'menu'; this.drag = null; if (this.phase === 'aim') this.aim = null; this._showOnly('menu'); } }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._settleNow(); this._save(); if (this.match && this.match.winner != null) this._finish(); else this._showSetup(); }
    else if (act === 'mpHome') this._openOnline();
    else if (act === 'resign') { this.screen = 'resign'; this._showOnly('resign'); }
    else if (act === 'resignYes') this._mpResign();
    else if (act === 'again') {
      if (this.mode === 'mp') this._sendChallenge(this.mp.them, this.match.goals);
      else this._newMatch();
    }
    else if (act === 'toSetup') { if (this.mode === 'mp') this._openOnline(); else this._showSetup(); }
  }

  // --- online (mp.js keeps the match; mp-ui.js draws the lists) ------------------------------------
  // The local match is the STORED one (seat 0 = side 'a', the challenger). What happens here:
  //   - opening a match replays the log up to the other person's latest run of flicks, then PLAYS
  //     that run on the pitch, one flick at a time, aim arrow and all;
  //   - every flick of yours is appended to the log the moment you let go (_mpRecord -> _mpFlush),
  //     so a closed app loses nothing and cannot take a shot back;
  //   - while it is their turn the match is WATCHED, so their flick arrives while you look at it.
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

  /** Pass & play, from the Multiplayer screen: two people, this phone. */
  _passPlay() { this.settings.mode = 'pass'; this._newMatch(); }

  /** The Multiplayer home. `pickFor` ({code, name, emoji}, from the hub's Challenges screen) opens
   *  straight onto "challenge them". */
  async _openOnline(pickFor = null) {
    this._mpLeave();
    this._setFlip(false);
    this.match = null; this.seats = null; this.mode = null;
    this.timers = []; this.cpu = null; this.aim = null; this.drag = null;
    this.phase = 'idle';
    this.banner.classList.remove('is-show');
    const [MP, UI] = await Promise.all([this._loadMP(), import('./mp-ui.js')]);
    if (instance !== this) return;
    this.UI = UI;
    if (pickFor && pickFor.code) UI.challengeTo(this, MP, pickFor);
    else UI.home(this, MP);
  }

  /** Open one stored match. Flicks still waiting on this phone go first, so none is lost. */
  async _openMatch(id) {
    const MP = await this._loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (instance !== this) return;
    if (!game) { this._toast(t('mp_not_found'), 2200); this._openOnline(); return; }
    this._mpBegin(game);
  }

  /** A new challenge: created now, delivered when your first turn is over. */
  async _sendChallenge(them, goals = this.settings.goals) {
    const MP = await this._loadMP();
    const res = await MP.createGame({ them, goals });
    if (instance !== this) return res;
    if (!res.ok) {
      if (this.screen !== 'mp') this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2400);
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
    this._begin({ mode: 'mp', diff: 'mp', match, seats: [seat(game.a), seat(game.b)] });
    const mp = this.mp;
    MP.watchGame(game.id, (g) => this._mpOnGame(g)).then((stop) => {
      if (this.mp === mp) mp.stop = stop; else { try { stop(); } catch { /* detached */ } }
    });
  }

  /** The pitch is at rest: show whatever the log has that this phone has not played yet, then play
   *  on (your turn) or wait (theirs). */
  _mpCatchUp() {
    const mp = this.mp;
    if (!mp || this.mode !== 'mp' || mp.finished) return;
    const g = mp.game;
    const m = this.match;
    if (m.winner != null) { this._finish(); return; }
    if (mp.applied < g.log.length) {
      const e = g.log[mp.applied];
      const i = this.MP.bodyOf(e.by, e.k);
      if (e.by === mp.side) {
        // Your own flick from another phone (or before a reopen): played out off screen.
        this.MP.applyEntry(m, e);
        mp.applied++;
        this._hud();
        this._mpCatchUp();
        return;
      }
      // Theirs: their aim grows on the pitch, then the flick plays out for real.
      this.phase = 'cpu';
      this.cpu = { started: this.clock, shot: { i, dx: e.dx, dy: e.dy, power: e.p }, replay: true };
      this._status();
      return;
    }
    this.MP.markShown(mp.id, g.log.length);
    if (g.over && g.over.why === 'resign') { this._mpFinish(g.over.winner === mp.side, true); return; }
    if (m.turn === mp.mySeat) { this.phase = 'aim'; this._status(); return; }
    this.phase = 'waiting';
    this._status();
  }

  /** The watched match changed: new flicks from them are played, our own echoes are ignored. */
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

  /** One of your flicks, into the log. */
  _mpRecord(entry) {
    const mp = this.mp;
    // Where this flick sits in the log: `applied` is its index (the caller counts it next). Set only
    // when nothing is queued, so a run of queued flicks stays contiguous.
    if (!mp.pending.length && !mp.sending) mp.base = mp.applied;
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
      if (mp.pending.length) this._mpFlush();
      return;
    }
    if (res.retryable) {
      this._toast(t('mp_not_sent'), 1800);
      setTimeout(() => { if (this.mp === mp) this._mpFlush(); }, 4000);
    } else {
      console.error('[flick-soccer] a flick could not be sent:', res.reason);
      this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
    }
  }

  _mpFinish(won, resigned) {
    const mp = this.mp;
    if (!mp || mp.finished) return;
    mp.finished = true;
    mp.resigned = !!resigned;
    const m = this.match;
    if (resigned) m.winner = won ? mp.mySeat : mp.mySeat ^ 1;
    this.MP.countResult(mp.id, won);                   // once per phone, whoever ended it
    this.MP.markResultSeen(mp.id);
    this._say(t('say_win', { name: this.seats[m.winner].name, sa: m.scores[m.winner], sb: m.scores[m.winner ^ 1] }));
    this.screen = 'result';
    this.phase = 'idle';
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
    this._mpFinish(false, true);
  }

  /** Stop watching the open online match (flicks not yet sent stay in the outbox). */
  _mpLeave() {
    const mp = this.mp;
    if (!mp) return;
    this.mp = null;
    if (mp.stop) { try { mp.stop(); } catch { /* detached */ } }
  }

  _pt(e) {
    const rc = this.canvas.getBoundingClientRect();
    return this.r.toPitch(e.clientX - rc.left, e.clientY - rc.top);
  }

  _pointerDown(e) {
    const m = this.match;
    if (this.screen !== 'play' || this.phase !== 'aim' || !m || !this.seats[m.turn].human) return;
    if (this.mode === 'mp' && m.turn !== this.mp.mySeat) return;
    const p = this._pt(e);
    const reach = Math.max(DISC_R * 1.6, 26 / this.r.s);
    const i = discAt(m.b, m.turn, p.x, p.y, reach);
    if (i < 0) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive */ }
    this.drag = { id: e.pointerId, i };
    this._aimFrom(p);
  }

  _pointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    this._aimFrom(this._pt(e));
  }

  _aimFrom(p) {
    const m = this.match;
    const o = m.b[this.drag.i];
    const px = o.x - p.x, py = o.y - p.y;
    const len = Math.hypot(px, py);
    if (len < PULL_DEAD) { this.aim = { i: this.drag.i, dx: 0, dy: -1, power: 0, fx: p.x, fy: p.y, contact: null, idle: true }; return; }
    const dx = px / len, dy = py / len;
    const power = Math.min(1, (len - PULL_DEAD) / (PULL_MAX - PULL_DEAD));
    this.aim = { i: this.drag.i, dx, dy, power, fx: p.x, fy: p.y, contact: aimContact(m.b, this.drag.i, dx, dy) };
  }

  _pointerUp(e, cancel) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const a = this.aim;
    this.drag = null;
    this.aim = null;
    if (cancel || !a || a.idle || a.power < MIN_POWER || this.phase !== 'aim' || this.screen !== 'play') return;
    this._shoot(a.i, a.dx, a.dy, a.power);
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
      else if (this.phase === 'cpu' || this.phase === 'cpuaim') this._cpuTick();
    }
    this._draw();
  }

  _draw() {
    if (!this.r || !this.r.w) return;
    const m = this.match;
    const human = !!m && this.phase === 'aim' && this.seats && this.seats[m.turn].human;
    const glow = this.reduce ? 1 : 0.55 + 0.45 * Math.sin(this.glowT * 4.2);
    this.r.draw({
      b: m ? m.b : this.preview,
      glowTeam: human ? m.turn : -1,
      glow,
      aim: this.aim && !this.aim.idle ? this.aim : null,
      spin: this.spin,
    });
  }

  destroy() {
    this._stop();
    this._mpLeave();
    clearTimeout(this._toastTimer);
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
  instance = new FlickSoccerUI(container);
  // Test seam: lets the headless checks drive a shot.
  if (typeof window !== 'undefined') window.__fsTest = { ui: instance };
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
  if (typeof window !== 'undefined' && window.__fsTest && window.__fsTest.ui === i) delete window.__fsTest;
}
/** Autosave meaning: the match is saved at every rest and resumes, so leaving loses nothing. */
export function isInProgress() { return false; }
export default { init, destroy, isInProgress };
