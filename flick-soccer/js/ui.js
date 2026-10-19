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
  newMatch, validMatch, step, atRest, freeze, settle, flick, discAt, aimContact, runToRest, restScorer,
  ballPath, maxShotSteps, teamOf, BALL, BALL_R, DISC_R, DT, GOAL_OPTIONS, FORMATIONS, FORM_IDS, W, H,
} from './engine.js';
import { planShot, DIFFS } from './ai.js';
import { createRenderer, TEAM } from './render.js';
import { roundShot } from './mp.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the cards theme standalone too
import { recordResult } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const STATS_ID = 'flicksoccer';
const SETTINGS_KEY = 'gamehub.flicksoccer.v1';
const SAVE_KEY = 'gamehub.flicksoccer.save.v1';
const MODES = ['cpu', 'pass'];
const FIRSTS = ['alt', 'me', 'them'];
/** How far back (pitch units) a full-strength pull goes, and the SAFE zone round the disc: letting go
 *  anywhere in it never flicks (Matt and King of Games, several times each, 2026-10-16: they aimed a
 *  disc, went back to it to aim another, let go a little off its centre and it flicked a tiny bit,
 *  ending the turn). It is the whole disc and a little more (it was half the disc's radius), the same
 *  everywhere; strength counts from its edge, so a full pull is as far as ever, and a small flick
 *  still goes when the finger has clearly left the disc. Only where the room is too short for both
 *  (a disc against a side wall, pulled toward it) does it give way, keeping PULL_RAMP of travel. */
const PULL_MAX = 34;
const PULL_SAFE = DISC_R * 1.3;
const PULL_RAMP = 18;
/** Pulling near the edge (`_fullPull`): where a full pull lands, this far inside the screen's edge
 *  (px; the bottom adds the home bar), a thumb's width, since a finger stops short of the very edge
 *  (Matt, 2026-10-16: "I can't get full power", from the bottom-left corner, his finger ~60px up);
 *  the least finger travel a full pull may take (px), however near the edge the disc sits; and the
 *  edge a finger is never asked to pass (px). */
const EDGE_M = 36;
const EDGE_MIN_TRAVEL = 28;
const EDGE_HARD = 4;
/** The bottom strip (px above the home bar) where letting go never shoots (Matt, 2026-10-16: "I was
 *  aiming a piece and this happened and it shot automatically", with a screenshot of the iPhone's
 *  Reachability slide). A pull dragged down into the home bar's corner sets off the phone's own
 *  swipe-down gestures, and the phone still reported the finger lifting, so the flick went. Inside
 *  this strip the aim is dropped (as if pulled back onto the disc); moving back up brings it back.
 *  A full pull always lands above it (`_edgeCam`). It was 24px; Matt, same day: "too sensitive... I
 *  need to be able to pull farther down". Now only the home bar itself (`_safe`) is the strip. */
const NO_SHOT_STRIP = 0;
/** How far the view eases out (a look only, `_edgeCam`) while a pull near an edge is at full power,
 *  and how close (px) the finger must get to running out of room before it starts (Matt, 2026-10-16:
 *  "before i've run out of room, the whole board begins to move... There's no need for a zoom out
 *  here. i have the whole field to drag my finger that direction"). */
const ZOOM_LOOK = 0.88;
const ZOOM_NEAR = 60;
const CAM_RATE = 14;
/** How quickly the look-only zoom follows a pull (per s): slow, so a wiggle of the finger does not
 *  move the board. */
const CAM_RATE_DRAG = 4;
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
    lineup: FORM_IDS.includes(s.lineup) ? s.lineup : 'balanced',   // the single line-up of 2026-10-11, kept
    // Offense and defense line-ups (2026-10-14): a player who had one line-up starts with it as both.
    offense: FORM_IDS.includes(s.offense) ? s.offense : FORM_IDS.includes(s.lineup) ? s.lineup : 'attack',
    defense: FORM_IDS.includes(s.defense) ? s.defense : FORM_IDS.includes(s.lineup) ? s.lineup : 'defend',
    nextStarter: s.nextStarter === 1 ? 1 : 0,
    aimHelp: DIFFS.includes(s.aimHelp) ? s.aimHelp : 'medium',   // a challenge's aiming help (2026-10-15)
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
/** A team's chip: its colour AND its shape, never colour alone. */
const teamChip = (seat) => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" fill="${TEAM[seat].fill}" stroke="#fff" stroke-width="1.5"/>${seat === 0
  ? '<path d="M10 4.6 L15 13.4 L5 13.4 Z" fill="#fff"/>'
  : '<rect x="6" y="6" width="8" height="8" fill="#fff"/>'}</svg>`;
/** A line-up's little picture: your half of a real pitch (grass, the halfway line and centre
 *  circle at the top, your goal at the bottom) with its five discs in your colour. It used to be
 *  dots in a grey box, which read as a die (Matt, 2026-10-14). */
export const formSVG = (id) => `<svg class="fs-form-ico" viewBox="0 0 60 52" aria-hidden="true" focusable="false">`
  + '<rect x="0" y="0" width="60" height="52" rx="4" fill="#2f8a3e"/>'
  + '<g fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1"><rect x="2" y="2" width="56" height="48"/><path d="M21 2a9 9 0 0 0 18 0"/><rect x="19" y="41" width="22" height="9"/></g>'
  + (FORMATIONS[id] || FORMATIONS.balanced).map(([x, y]) => `<circle cx="${(2 + (x / W) * 56).toFixed(1)}" cy="${(2 + ((y - H / 2) / (H / 2)) * 48).toFixed(1)}" r="4" fill="${TEAM[0].fill}" stroke="#fff" stroke-width="1.2"/>`).join('')
  + '</svg>';
/** A challenge's aiming help (2026-10-15): Easy / Medium / Hard as pills with the difficulty
 *  shapes, and one line under them saying what that level shows. */
export const aidsRowHTML = (cur) => `<div class="fs-aids"><div class="gh-seg fs-seg" role="group" aria-label="${esc(t('aim_help'))}">${
  DIFFS.map((id) => `<button type="button" class="gh-seg__item fs-seg-item" data-aid="${id}" aria-pressed="${cur === id}">${diffShapeSVG(tierOf(id))}<span>${esc(t('diff_' + id))}</span></button>`).join('')
}</div><p class="fs-aid-note">${esc(t('aid_' + cur))}</p></div>`;
/** The two line-up buttons (Offense, Defense) for the start menu and both challenge cards: each
 *  says its role, draws its line-up and names it, and opens the picker (`_luPicker`). */
export const lineupsRowHTML = (s) => `<div class="fs-lus" data-role="lineups">${['off', 'def'].map((r) => {
  const id = r === 'off' ? s.offense : s.defense;
  return `<button type="button" class="fs-lu" data-lu="${r}" aria-label="${esc(t('lu_' + r) + ': ' + t('form_' + id))}">${formSVG(id)}<span class="fs-lu-txt"><span class="fs-lu-role">${esc(t('lu_' + r))}</span><b class="fs-lu-name">${esc(t('form_' + id))}</b></span></button>`;
}).join('')}</div>`;
/** How much aiming help each difficulty gets (Matt, 2026-10-11): Easy shows the power ring, the
 *  aim arrow and the ball's bounce line; Medium the power ring and the arrow; Hard the power ring
 *  only. Pass and play and online are Medium. */
const AIDS = {
  easy: { arrow: true, guide: true },
  medium: { arrow: true, guide: false },
  hard: { arrow: false, guide: false },
};

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

/** Where the quick-chat button sits (js/match-chat-ui.js `place`): on the top row, left of the
 *  Menu button (which is `right: 10px`, 44px wide), exactly the default spot. The bubbles come
 *  down UNDER the scoreboard and the status line (board at top row + 50..94px, status +98..116px),
 *  so a line from them never covers the score or whose turn it is. */
const CHAT_PLACE = { top: 'var(--fs-top)', right: '64px', popsTop: 'calc(var(--fs-top) + 122px)' };

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
    // Nothing stands on the pitch behind a card: discs half hidden by it looked broken (Matt,
    // 2026-10-14). The line-up buttons draw their own pictures.
    this.preview = null;

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
    // Flicks queued while offline go out on mount and the moment the connection comes back.
    this._onOnline = () => this._drainAll();
    window.addEventListener('online', this._onOnline);
    setTimeout(() => { if (instance === this) this._drainAll(); }, 0);

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
        <button type="button" class="fs-skip" data-act="skip" data-role="skip" hidden><span data-l="mp_skip"></span></button>

        <div class="fs-ov fs-ov-setup" data-ov="setup" hidden>
          <div class="fs-card">
            <button type="button" class="fs-x fs-q" data-act="howto" data-la="howto">?</button>
            <button type="button" class="fs-x" data-act="exit" data-la="aria_close">${X_SVG}</button>
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
            <div class="fs-field" data-role="lineupsField"></div>
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
    this.canvas.addEventListener('lostpointercapture', this._onCancel);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this._paintLineups();
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
    const leftOnline = !!this.mp;
    this._mpLeave();
    if (leftOnline) this._drainAll();
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
    this._fitStatus();
    const rootTop = this.root.getBoundingClientRect().top;
    const statusBottom = this.statusEl.getBoundingClientRect().bottom - rootTop;
    const safe = this.root.querySelector('[data-role="safe"]').offsetHeight || 0;
    const top = Math.max(0, statusBottom) + 4;
    const box = { x: 6, y: top, w: w - 12, h: Math.max(120, h - top - 8 - safe) };
    this._safe = safe;
    this._setCam(null);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.r.layout(w, h, box);
    // The goal banner sits over the middle of the pitch.
    const mid = this.r.toPx(W / 2, H / 2);
    this.root.style.setProperty('--fs-banner-y', Math.round(mid.y) + 'px');
    this._draw();
  }

  // --- offense and defense line-ups (2026-10-14) -------------------------------------------------
  /** Every pair of line-up buttons on screen (start menu, challenge cards) shows the saved pair. */
  _paintLineups() {
    const field = this.root.querySelector('[data-role="lineupsField"]');
    if (field) field.innerHTML = lineupsRowHTML(this.settings);
    this.root.querySelectorAll('.fs-ov-mp .fs-lus').forEach((el) => { el.outerHTML = lineupsRowHTML(this.settings); });
  }

  /** Choose the offense (`role` 'off') or defense ('def') line-up: the four as real little pitches,
   *  two by two, over whatever card is showing; a pick is saved at once and closes it. */
  _luPicker(role) {
    this.root.querySelector('.fs-lupick')?.remove();
    const s = this.settings;
    const cur = role === 'off' ? s.offense : s.defense;
    const el = document.createElement('div');
    el.className = 'fs-ov fs-lupick';
    el.innerHTML = `
      <div class="fs-card fs-card-sm" role="dialog" aria-modal="true" aria-label="${esc(t('lu_pick_' + role))}">
        <button type="button" class="fs-x" data-lux aria-label="${esc(t('aria_close'))}">${X_SVG}</button>
        <h2 class="fs-h2">${esc(t('lu_pick_' + role))}</h2>
        <p class="fs-lupick-sub">${esc(t('lu_when_' + role))}</p>
        <div class="fs-lupick-grid">${FORM_IDS.map((id) => `
          <button type="button" class="fs-lupick-opt" data-lupick="${id}" aria-pressed="${cur === id}">${formSVG(id)}<span>${esc(t('form_' + id))}</span>${cur === id ? '<i class="fs-lupick-tick" aria-hidden="true">✓</i>' : ''}</button>`).join('')}
        </div>
      </div>`;
    const close = () => el.remove();
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-lupick]');
      if (b) {
        if (role === 'off') s.offense = b.dataset.lupick; else s.defense = b.dataset.lupick;
        writeJSON(SETTINGS_KEY, s);
        this._paintLineups();
        close();
        return;
      }
      if (e.target === el || e.target.closest('[data-lux]')) close();
    });
    this.root.appendChild(el);
    el.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
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
    // Offense and defense line-ups (2026-10-14). Vs the computer it picks its own pair; pass and
    // play is one pair for both teams.
    const pick = () => FORM_IDS[Math.floor(Math.random() * FORM_IDS.length)];
    const mine = [s.offense, s.defense];
    const theirs = s.mode === 'cpu' ? [pick(), pick()] : mine;
    this._begin({ mode: s.mode, diff: s.difficulty, match: newMatch(s.goals, starter, null, [mine, theirs]) });
  }

  _continue() {
    const sv = this._savedMatch();
    if (!sv) { this._newMatch(); return; }
    const m = sv.match;
    const sh = sv.shot;
    // A shot that was still rolling when the app went away: play it out now, exactly as it would have.
    let replayed = false;
    if (sh && Number.isInteger(sh.i) && teamOf(sh.i) === m.turn && [sh.dx, sh.dy, sh.power].every(Number.isFinite)) {
      flick(m.b, sh.i, sh.dx, sh.dy, sh.power);
      settle(m, runToRest(m.b).scorer);
      replayed = true;
    }
    this._begin({ mode: sv.mode, diff: DIFFS.includes(sv.diff) ? sv.diff : 'medium', match: m });
    if (replayed && m.winner != null) this._finish();
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
    if (this.match.winner != null && this.mode !== 'mp') return;   // replayed to a win: _continue shows the result
    this._save();
    this._startTurn(true);
  }

  /** `shot` (from _shoot): the flick about to be played from this position. Saved WITH the position,
   *  so an app killed or reloaded while the shot rolls (or during the goal banner) replays that same
   *  flick on Continue (the engine is deterministic) instead of handing the shot back. */
  _save(shot = null) {
    const m = this.match;
    if (!m || !this.mode || this.mode === 'mp') return;     // an online match lives on the server
    if (m.winner != null) { try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ } return; }
    // Only a position at rest is a position (a rolling shot is played out first: _settleNow).
    if (!atRest(m.b) || this.phase === 'goal') return;
    writeJSON(SAVE_KEY, shot ? { mode: this.mode, diff: this.diff, match: m, shot } : { mode: this.mode, diff: this.diff, match: m });
  }

  _saveSettings() { writeJSON(SETTINGS_KEY, this.settings); }

  _hud() {
    const m = this.match;
    const sc = m ? (this.phase === 'goal' && this.goalScores) || m.scores : [0, 0];
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      this.root.querySelector(`[data-role="ava${i}"]`).textContent = s.emoji;
      this.root.querySelector(`[data-role="name${i}"]`).textContent = s.name;
      this.root.querySelector(`[data-role="score${i}"]`).textContent = String(sc[i]);
      this.sideEls[i].classList.toggle('is-turn', !!m && m.turn === i && m.winner == null);
      this.sideEls[i].setAttribute('aria-label', t('aria_score', { name: s.name, n: sc[i] }));
    }
    if (m) {
      this.canvas.setAttribute('aria-label', t('aria_pitch', { a: this.seats[0].name, sa: sc[0], b: this.seats[1].name, sb: sc[1] }));
    }
  }

  _status() {
    this._paintSkip();
    const m = this.match;
    if (!m || this.screen === 'setup' || m.winner != null) { this.statusEl.textContent = ''; return; }
    const s = this.seats[m.turn];
    const team = t(m.turn === 0 ? 'team_blue' : 'team_red');
    let txt;
    if (this.phase === 'moving' || this.phase === 'goal') txt = t('status_wait');
    else if (this.mode === 'mp' && this.mp.game.pick) txt = t('status_mp_picking', { name: this.mp.them.name || '?' });
    else if (this.mode === 'mp' && m.turn !== this.mp.mySeat) {
      const sending = this.phase === 'waiting' && (this.mp.pending.length || this.mp.sending);
      txt = t(this.phase !== 'waiting' ? 'status_mp_them' : sending ? 'status_mp_sending' : 'status_mp_wait', { name: s.name });
    }
    else if (this.mode === 'mp') txt = t('status_you', { team });
    else if (!s.human) txt = t('status_cpu', { name: s.name });
    else if (this.mode === 'cpu') txt = t('status_you', { team });
    else txt = t('status_team', { name: s.name, team });
    this.statusEl.textContent = txt;
    this.statusEl.dataset.seat = String(m.turn);
    this._fitStatus();
  }

  /** The status line keeps its whole sentence (the team word is at the END, and it is the part that
   *  says which discs to drag): shrunk to fit, never below 11px (docs/BUILDING-A-GAME.md, Part 0). */
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
      this.aim = { i: sh.i, dx: sh.dx, dy: sh.dy, power: sh.power * k, contact: null, arrow: true };
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
    this._save({ i, dx, dy, power });   // the position the shot was taken from, and the shot
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
      if (atRest(m.b) || this.shotSteps >= maxShotSteps()) {
        const r = restScorer(m.b);            // stopped more than halfway into a net
        if (r >= 0) { freeze(m.b); this._goal(r); } else this._rest();
        return;
      }
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
    this.goalScores = sc;                  // the scoreboard counts it now, with the banner
    this._hud();
    this._bannerShow(t('goal'), (own ? t('own_goal') + ' · ' : '') + t('goal_sub', { a: sc[0], b: sc[1] }), scorer);
    this._say(t('say_goal', { a: this.seats[0].name, sa: sc[0], b: this.seats[1].name, sb: sc[1] }));
    this._status();
    this._after(1.7, () => {
      const res = settle(m, scorer);
      this.goalScores = null;
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
    this.banner.classList.toggle('is-long', main.length > 6);   // "¡ENVIADO!" is wider than "GOAL!"
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
    const lu = e.target.closest('[data-lu]');
    if (lu) { this._luPicker(lu.dataset.lu); return; }
    const aid = e.target.closest('[data-aid]');
    if (aid) {
      this.settings.aimHelp = aid.dataset.aid;
      writeJSON(SETTINGS_KEY, this.settings);
      this.root.querySelectorAll('.fs-aids').forEach((el) => { el.outerHTML = aidsRowHTML(this.settings.aimHelp); });
      return;
    }
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
    else if (act === 'menu') { if (this.screen === 'play' || this.screen === 'resign') { this._paintResign(); this.screen = 'menu'; this.drag = null; if (this.phase === 'aim') this.aim = null; this._showOnly('menu'); } }
    else if (act === 'exit') {
      // The setup card's X (Matt, 2026-10-19): leave the way the hub's own back pill does.
      const back = document.querySelector('.hub-back');
      if (back && !back.hidden) back.click(); else location.href = '../';
    }
    else if (act === 'resume') { this.screen = 'play'; this._showOnly(null); }
    else if (act === 'quit') { this._settleNow(); this._save(); if (this.match && this.match.winner != null) this._finish(); else this._showSetup(); }
    else if (act === 'mpHome') this._openOnline();
    else if (act === 'skip') this._mpSkip();
    else if (act === 'resign') { this._paintResign(); this.screen = 'resign'; this._showOnly('resign'); }
    else if (act === 'resignYes') this._mpResign();
    else if (act === 'again') {
      // The same goals and aiming help; your offense and defense line-ups.
      if (this.mode === 'mp') this._sendChallenge(this.mp.them, this.match.goals, undefined, this.mp.game.aids);
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
  /** Send flicks still queued on this phone for ANY match (not just the one open): a match-ending
   *  flick made offline must reach the other person without anybody reopening that match. */
  async _drainAll() {
    if (this._draining) return;
    this._draining = true;
    try {
      const MP = await this._loadMP();
      if (!MP.outboxCount()) return;
      const sent = await MP.drainOutbox(null, this.mp ? this.mp.id : null);
      if (sent && instance === this && this.screen === 'setup') this._countOnline();
    } catch (err) { console.warn('[flick-soccer] could not send queued flicks yet', err); }
    finally { this._draining = false; }
    // Still something waiting (no signal, or a server that is not answering): try again shortly,
    // for as long as the game is open. The open match retries on its own timer (_mpFlush).
    if (instance === this && this.MP && this.MP.outboxCount() > (this.mp && this.MP.pendingFor(this.mp.id) ? 1 : 0)) {
      clearTimeout(this._drainTimer);
      this._drainTimer = setTimeout(() => { if (instance === this) this._drainAll(); }, 6000);
    }
  }

  async _openOnline(pickFor = null) {
    this._mpLeave();
    this.preview = null;
    this._drainAll();                  // after leaving: the match just left may be the one waiting
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
  /** A notification for a challenge was tapped while Flick Soccer is ALREADY open (2026-10-14, the
   *  hub's `openArmed` hand-over): open that match if nothing is in the way. Matt: "when i click a
   *  notification that it's my turn... it brings me to the hub, but doesn't necessarily open the
   *  challenge." Never pulls the player out of a game against the computer or two players on one
   *  phone, or out of a shot still rolling; a match already on screen is left alone (its own watch
   *  plays their flick). The armed id is always taken, so a declined one cannot pop up later. */
  openArmed() {
    import('./alert.js').then((A) => {
      const o = A.takeOpen();
      if (!o || instance !== this) return;
      if (o.kind === 'pick') { if (!this.match || this.mp) this._openOnline(o.them); return; }
      if (this.mp && this.mp.id === o.id) return;
      if (this.phase === 'moving' || this.phase === 'goal') return;
      if (!this.mp && this.match && !this.match.over && this.phase !== 'idle') return;
      this._openMatch(o.id);
    }).catch(() => {});
  }

  async _openMatch(id) {
    const MP = await this._loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (instance !== this) return;
    if (!game) { this._toast(t('mp_not_found'), 2200); this._openOnline(); return; }
    this._mpBegin(game);
  }

  /** Resign, or CANCEL / DECLINE while the other person has not answered (2026-10-13,
   *  js/challenge-life.js): the menu button and its question say which one the tap will do. */
  _paintResign() {
    const mp = this.mp;
    if (!mp || !this.MP || !mp.game) return;
    const life = this.MP.lifeOf(mp.game);
    const kind = !life.open ? 'resign' : mp.side === this.MP.recipientOf(mp.game) ? 'decline' : 'cancel';
    const set = (sel, key) => { const el = this.host.querySelector(sel); if (el) el.textContent = t(key); };
    set('[data-act="resign"] span', kind === 'resign' ? 'mp_resign' : `mp_${kind}_ch`);
    set('[data-ov="resign"] h2', kind === 'resign' ? 'mp_resign_q' : `mp_${kind}_q`);
    set('[data-act="resignYes"] span', kind === 'resign' ? 'mp_resign_yes' : `mp_${kind}_ch`);
    // "Cancel" beside "Cancel challenge" would say two opposite things: the way back says what it keeps.
    set('[data-ov="resign"] [data-act="menu"] span', kind === 'resign' ? 'mp_cancel' : 'mp_keep');
  }

  /** What to say about a match that ended with no result: called off by either side, or expired
   *  unanswered (js/challenge-life.js). '' for a match that is neither. A match from the first form
   *  of calling off (a resignation with no flick in it) reads as cancelled. */
  _mpEndText(game, side) {
    const MP = this.MP;
    if (!game || !MP) return '';
    if (MP.lifeOf(game).expired) return t('mp_expired');
    if (!MP.isCalledOff(game)) return game.over && !game.log.length ? t('mp_cancelled') : '';
    const why = game.over.why === 'declined' ? 'declined' : 'cancelled';
    // A cancel is always the sender's, a decline always the receiver's.
    const iSent = side !== MP.recipientOf(game);
    const mine = why === 'cancelled' ? iSent : !iSent;
    const them = MP.themOf(game, MP.myCode());
    return t(mine ? `mp_you_${why}` : `mp_they_${why}`, { name: (them && them.name) || '?' });
  }

  /** A new challenge: created now, delivered when your first turn is over. */
  async _sendChallenge(them, goals = this.settings.goals, lineups = [this.settings.offense, this.settings.defense], aids = this.settings.aimHelp) {
    if (this._challenging) return { ok: false, reason: 'busy' };      // a double tap makes ONE match
    this._challenging = true;
    let res;
    try {
      const MP = await this._loadMP();
      res = await MP.createGame({ them, goals, pair: lineups, aids });
    } finally { this._challenging = false; }
    if (instance !== this) return res;
    if (!res.ok) {
      if (this.screen !== 'mp') this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2400);
      return res;
    }
    this._mpBegin(res.game);
    // Their move first now (they pick a line-up and kick off): say the challenge has gone.
    this._bannerShow(t('mp_sent'), t('mp_sent_sub', { name: (them && them.name) || '?' }), 0);
    return res;
  }

  _mpBegin(game) {
    const MP = this.MP;
    const me = MP.myCode();
    const side = MP.sideOf(game, me);
    if (!side) { this._openOnline(); return; }
    // Cancelled, declined or expired (2026-10-13): there is no match to show.
    const endText = this._mpEndText(game, side);
    if (endText) { this._mpLeave(); this._toast(endText, 3200); this._openOnline(); return; }
    if (game.pick === 'b' && side === 'b') { this._mpPick(game); return; }
    this._mpLeave();
    const theirSide = side === 'a' ? 'b' : 'a';
    let from = game.log.length ? MP.lastRunStart(game, theirSide) : 0;
    const them = MP.themOf(game, me);
    // Flicks this phone made that never reached the server are still this phone's flicks: shown on
    // the pitch and retried, never re-taken (a second flick would have replaced them in the outbox).
    const q = MP.pendingFor(game.id);
    const queued = q && q.base === game.log.length && Array.isArray(q.entries) ? q.entries.map(MP.cleanEntry).filter(Boolean) : [];
    // Their last move is replayed EVERY time you open the match while it is your turn (Matt,
    // 2026-10-13: he left and came back to screen-record it, and it did not play again); Skip jumps
    // past it. Otherwise (their turn, or the match over) a run already shown is not shown twice.
    const now = from < game.log.length && !queued.length && !game.over ? MP.buildMatch(game) : null;
    const myTurn = !!now && now.winner == null && now.turn === (side === 'b' ? 1 : 0);
    const shown = MP.readShown(game.id);
    if (!myTurn && shown > from) from = Math.min(shown, game.log.length);
    if (q && !queued.length) MP.savePending(game.id, 0, []);           // left behind by a match that moved on
    this.mp = { id: game.id, side, mySeat: side === 'b' ? 1 : 0, game, them, applied: from, base: game.log.length,
      pending: queued.slice(), unshown: queued.slice(), sending: false, stop: null, finished: false, resigned: false };
    const seat = (who) => ({ name: who.name || '?', emoji: who.emoji || '🙂', human: true });
    const match = MP.buildMatch(game, from);
    this._begin({ mode: 'mp', diff: 'mp', match, seats: [seat(game.a), seat(game.b)] });
    const mp = this.mp;
    this._mpMountChat({ id: game.id, side, them });
    MP.watchGame(game.id, (g) => this._mpOnGame(g)).then((stop) => {
      if (this.mp === mp) mp.stop = stop; else { try { stop(); } catch { /* detached */ } }
    });
    if (mp.pending.length) this._mpFlush();
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
      mp.replaying = true;
      this.phase = 'cpu';
      this.cpu = { started: this.clock, shot: { i, dx: e.dx, dy: e.dy, power: e.p }, replay: true };
      this._status();
      return;
    }
    mp.replaying = false;
    if (mp.unshown.length) {
      for (const e of mp.unshown) this.MP.applyEntry(m, e);
      mp.applied += mp.unshown.length;
      mp.unshown = [];
      this._hud();
      if (m.winner != null) { this._finish(); return; }
    }
    this.MP.markShown(mp.id, g.log.length);
    if (g.over && (this.MP.isCalledOff(g) || !g.log.length)) { this._mpCalledOff(this._mpEndText(g, mp.side)); return; }
    if (g.over && g.over.why === 'resign') { this._mpFinish(g.over.winner === mp.side, true); return; }
    if (m.turn === mp.mySeat) { this.phase = 'aim'; this._status(); return; }
    this.phase = 'waiting';
    this._status();
    this._mpSentNote();
  }

  /** Skip (Matt, 2026-10-13: "add a skip button on the bottom for someone if they don't wanna
   *  rewatch it"): jump straight to the position after their last flick. The pitch is rebuilt from
   *  the stored log, which is exactly what the replay would have ended on (the engine is
   *  deterministic, and validateGame already proved the log replays). */
  _mpSkip() {
    const mp = this.mp, MP = this.MP;
    if (!mp || !MP || !mp.replaying || this.mode !== 'mp' || this.screen !== 'play') return;
    const g = mp.game;
    mp.replaying = false;
    this.cpu = null; this.aim = null; this.drag = null;
    this.timers = [];
    this.goalScores = null;
    clearTimeout(this._bannerTimer);
    this.banner.classList.remove('is-show');
    this.match = MP.buildMatch(g, g.log.length);
    freeze(this.match.b);
    mp.applied = g.log.length;
    this.phase = 'idle';
    this._startTurn(false);
  }

  /** The Skip button shows only while the other person's flicks are being replayed. */
  _paintSkip() {
    const el = this.root && this.root.querySelector('[data-role="skip"]');
    if (!el) return;
    const on = this.mode === 'mp' && !!this.mp && !!this.mp.replaying && this.screen === 'play';
    if (el.hidden === on) el.hidden = !on;
  }

  /** "SENT!" (Matt, 2026-10-13: "Need a 'turn sent' or something after I play"). Shown once per
   *  hand-over, only for a turn played on THIS phone, and only once the server HAS it: while a flick
   *  is still queued the status line says "Sending your turn..." instead, and the banner waits for
   *  the flush that lands it (_mpFlush calls this again). */
  _mpSentNote() {
    const mp = this.mp;
    if (!mp || this.phase !== 'waiting' || !mp.flickedHere || mp.pending.length || mp.sending) return;
    if (mp.sentFor === mp.base) return;
    mp.sentFor = mp.base;
    this._bannerShow(t('mp_sent'), t('mp_sent_sub', { name: mp.them.name || '?' }), mp.mySeat);
    this._say(t('mp_sent_sub', { name: mp.them.name || '?' }));
  }

  /** The watched match changed: new flicks from them are played, our own echoes are ignored. */
  _mpOnGame(g) {
    const mp = this.mp;
    if (!mp || g.id !== mp.id || g.log.length < mp.game.log.length) return;
    if (mp.game.pick && !g.pick && !g.over) { this._mpBegin(g); return; }   // they chose: both line-ups now
    mp.game = g;
    if (g.over && (this.MP.isCalledOff(g) || !g.log.length) && !mp.finished) { this._mpCalledOff(this._mpEndText(g, mp.side)); return; }
    if (g.over && g.over.why === 'resign' && !mp.finished && mp.applied >= g.log.length) {
      this._mpFinish(g.over.winner === mp.side, true);
      return;
    }
    if (mp.applied >= g.log.length) return;
    if (this.phase === 'waiting') this._mpCatchUp();
    else if (this.phase === 'aim' && !mp.pending.length && !mp.sending) {
      // Your turn here, but the log moved: you played it on another phone. Catch this one up rather
      // than letting it take a second, different shot from a position that is no longer the match.
      this.drag = null; this.aim = null;
      this._mpCatchUp();
    }
  }

  /** One of your flicks, into the log. */
  _mpRecord(entry) {
    const mp = this.mp;
    // Where this flick sits in the log: `applied` is its index (the caller counts it next). Set only
    // when nothing is queued, so a run of queued flicks stays contiguous.
    if (!mp.pending.length && !mp.sending) mp.base = mp.applied;
    mp.flickedHere = true;
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
      console.error('[flick-soccer] a flick could not be sent:', res.reason);
      // Only the MATCH refusing it drops the flick (mp.js NEVER_SENDABLE). Anything about this phone
      // (denied, a dev server, no player code) keeps it queued for the next try.
      if (!MP.NEVER_SENDABLE.includes(res.reason)) {
        this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
        return;
      }
      mp.pending = [];
      MP.savePending(mp.id, 0, []);
      if (res.reason === 'expired') {
        // Nobody answered it in 3 days: it lapsed before this flick got there.
        this._mpCalledOff(t('mp_expired'));
      } else if (['moved-on', 'already-over', 'rules-refused'].includes(res.reason)) {
        // The match moved on without this flick (played on another phone, or already finished):
        // what the server has is the match. Open it again from there.
        this._toast(t('mp_moved_on'), 2600);
        this._openMatch(mp.id);
      } else {
        this._toast(this.UI ? this.UI.reasonText(res.reason) : t('mp_send_failed'), 2600);
      }
    }
  }

  _mpFinish(won, resigned) {
    if (this.mp) this.mp.replaying = false;
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
    if (res.cancelled) {
      // Nobody had answered it: called off (cancelled or declined), nothing to count. Back to the list.
      this._mpCalledOff(this._mpEndText(res.game, mp.side));
      return;
    }
    this._mpFinish(false, true);
  }

  /** A challenge called off before anybody answered, or expired: counts for nobody, back to the list. */
  _mpCalledOff(text = t('mp_cancelled')) {
    const mp = this.mp;
    if (mp) { mp.finished = true; mp.replaying = false; try { this.MP.markSeen(mp.id, mp.game && mp.game.updated); } catch { /* bubble again */ } }
    this._toast(text || t('mp_cancelled'), 3200);
    this._openOnline();
  }

  /** Side b of an own-lineup challenge: see their line-up and your role, pick yours, kick off. The
   *  pitch behind the card shows both teams as they will stand, you at the bottom. */
  async _mpPick(game) {
    this._mpLeave();
    this.match = null; this.seats = null; this.mode = null; this.phase = 'idle';
    this._setFlip(true);
    this._mpMountChat({ id: game.id, side: 'b', them: game.a });   // the challenge is on screen: say hello before picking
    const UI = this.UI || (this.UI = await import('./mp-ui.js'));
    if (instance !== this) return;
    UI.pickLineup(this, this.MP, game);
  }

  // --- quick chat inside a challenge (2026-10-14) ---------------------------------------------
  // js/match-chat-ui.js is the panel, js/match-chat.js the data (`flicksoccer/chat/<id>`, BESIDE
  // the match, never inside it, so watchGame and validateGame never see a chat line). Mounted while
  // a stored match is on screen (playing, watching their flicks, a finished one, the result card)
  // and torn down in _mpLeave. `side` is the STORED side (mp.side). Lazy-imported, so a vs-computer
  // or two-players-on-one-phone game downloads none of it. The line-up card (_mpPick) is the
  // challenge on screen too, so chat mounts there as well (`desc` is { id, side, them }).
  async _mpMountChat(desc) {
    this._mpUnmountChat();
    if (!desc || !desc.id) return;
    this._chatDesc = desc;
    let UI, DATA;
    try { [UI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
    if (instance !== this || this._chatDesc !== desc || this._chat) return;
    const node = 'flicksoccer';
    const { id, side } = desc;
    const seenAt = DATA.readChatSeen(node, id);
    const chat = UI.createMatchChat({
      root: this.root,
      send: (p) => DATA.sendChat({ node, id, side }, p),
      them: () => ({ name: (desc.them && desc.them.name) || '?', emoji: (desc.them && desc.them.emoji) || '' }),
      place: CHAT_PLACE,
    });
    this._chat = chat;
    const stop = await DATA.watchChat({ node, id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === side;
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at }, { pop: !mine && c.at > seenAt });
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

  /** Stop watching the open online match (flicks not yet sent stay in the outbox). */
  _mpLeave() {
    this._mpUnmountChat();
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
    if (e.button !== 0 || this.drag) return;   // the main button / one finger; a second touch is ignored
    if (this.screen !== 'play' || this.phase !== 'aim' || !m || !this.seats[m.turn].human) return;
    if (this.mode === 'mp' && m.turn !== this.mp.mySeat) return;
    const p = this._pt(e);
    const reach = Math.max(DISC_R * 1.6, 26 / this.r.s);
    const i = discAt(m.b, m.turn, p.x, p.y, reach);
    if (i < 0) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive */ }
    this.drag = { id: e.pointerId, i, cx: e.clientX, cy: e.clientY };
    this._setCam(null);      // the disc where it really is, so the pull is read from it
    this.camTo = null;
    this._aimFrom();
  }

  _pointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    this.drag.cx = e.clientX; this.drag.cy = e.clientY;
    this._aimFrom();
    this.camTo = this._edgeCam();   // the view glides there (_camTick); the aim never depends on it
    if (this._inNoShotStrip(e.clientY) && this.aim) this.aim.idle = true;
  }

  /** Is this screen height (clientY) inside the bottom strip where a release never shoots? */
  _inNoShotStrip(clientY) {
    const rc = this.canvas.getBoundingClientRect();
    return clientY - rc.top > rc.height - (this._safe || 0) - NO_SHOT_STRIP;
  }

  /** Pulling near the edge (Matt, 2026-10-13 to 10-16: a disc near the side could not be pulled back
   *  to full strength; then "make it zoom in and out depending on how hard you're pulling"; then "I
   *  can't get full power"; then "it seems super sensitive now... the whole board and board size
   *  moves a lot, which actually makes the angle i'm aimed at move even more"). The finger's distance
   *  from the disc, on screen, that is a FULL pull in the direction (ux, uy) it is pulling: the usual
   *  PULL_MAX, or, where the screen runs out first, the room there is, EDGE_M inside the edge (the
   *  bottom adding the home bar), at least EDGE_MIN_TRAVEL, never into the bottom strip. So near an
   *  edge the same finger travel is a harder pull. Read off the FITTED layout from the disc's own
   *  place, so nothing the view does can change it. */
  _fullPull(bo, ux, uy) {
    const r = this.r, safe = this._safe || 0;
    const room = (m, bottom) => {
      let e = Infinity;
      if (ux > 0) e = Math.min(e, (r.w - m - bo.x) / ux); else if (ux < 0) e = Math.min(e, (m - bo.x) / ux);
      if (uy > 0) e = Math.min(e, (r.h - bottom - bo.y) / uy); else if (uy < 0) e = Math.min(e, (m - bo.y) / uy);
      return e;
    };
    const full = PULL_MAX * r.s0;
    // At least the disc plus PULL_RAMP of travel past it, so the disc itself is always the safe zone,
    // even for a disc against a side wall pulled toward it (its full pull then sits nearer the edge).
    const least = Math.max(EDGE_MIN_TRAVEL, DISC_R * r.s0 + PULL_RAMP);
    const fit = Math.min(Math.max(room(EDGE_M, EDGE_M + safe), least), room(EDGE_HARD, NO_SHOT_STRIP + 4 + safe));
    return Math.max(8, Math.min(full, fit));
  }

  /** The view eases out a little as a pull near an edge grows, and back in as it eases off: a LOOK
   *  only. It zooms about the disc being pulled, so that disc, the finger and the aim between them
   *  stay exactly where they are; it never moves anything the aim is read from. */
  _edgeCam() {
    const a = this.aim, r = this.r, d = this.drag;
    if (!a || a.idle || !d || !this.match || !r.box || !(a.amp > 0)) return null;
    // Only for the direction pulled NOW, and only once the finger is within ZOOM_NEAR of running
    // out of room (where full power lands): a pull with the field in front of it never zooms.
    // (the last third of the room, where the room itself is short).
    const zone = Math.min(ZOOM_NEAR, (a.gap + a.len) / 3);
    const near = Math.max(0, Math.min(1, 1 - a.gap / zone));
    const k = 1 - (1 - ZOOM_LOOK) * a.amp * near;
    if (k > 0.999) return null;
    const o = this.match.b[a.i];
    const bo = r.toPxBase(o.x, o.y);
    return { k, ox: bo.x + (r.ox0 - bo.x) * k, oy: bo.y + (r.oy0 - bo.y) * k };
  }

  _setCam(c) {
    this.cam = c;
    const r = this.r;
    if (r && r.box) r.setCam(c ? c.k : 1, c ? c.ox : r.ox0, c ? c.oy : r.oy0);
  }

  /** Once the finger is lifted, eases the view back to the fitted layout (at once under reduced
   *  motion). While it is down the camera is set straight from the finger (`_pointerMove`). */
  _camTick(dt) {
    const r = this.r;
    if (!r || !r.box) return;
    const base = { k: 1, ox: r.ox0, oy: r.oy0 };
    const to = (this.drag && this.camTo) || base, c = this.cam || base;
    if (c.k === to.k && c.ox === to.ox && c.oy === to.oy) return;
    const f = this.reduce ? 1 : 1 - Math.exp(-dt * (this.drag ? CAM_RATE_DRAG : CAM_RATE));
    let n = { k: c.k + (to.k - c.k) * f, ox: c.ox + (to.ox - c.ox) * f, oy: c.oy + (to.oy - c.oy) * f };
    if (Math.abs(n.k - to.k) < 0.001 && Math.abs(n.ox - to.ox) < 0.3 && Math.abs(n.oy - to.oy) < 0.3) n = to;
    this._setCam(n === base ? null : n);
    if (this.drag && this.aim) {
      // Keep the string's end under the finger as the view glides (direction and power do not move).
      const idle = this.aim.idle;
      this._aimFrom();
      if (idle && this._inNoShotStrip(this.drag.cy)) this.aim.idle = true;
    }
  }

  /** The aim, read from where the finger is ON SCREEN against where the disc is: the flick goes from
   *  the finger through the disc, and the strength is the finger's distance over a full pull's
   *  (`_fullPull`). The view's zoom is about the disc, so neither depends on it. */
  _aimFrom() {
    const m = this.match, d = this.drag, r = this.r;
    const o = m.b[d.i];
    const rc = this.canvas.getBoundingClientRect();
    const sx = d.cx - rc.left, sy = d.cy - rc.top;
    const bo = r.toPxBase(o.x, o.y);
    const fp = r.toPitch(sx, sy);                       // the string's end, under the finger
    const vx = sx - bo.x, vy = sy - bo.y, len = Math.sqrt(vx * vx + vy * vy);
    const reach = PULL_MAX * r.s0;
    const full = len > 0 ? this._fullPull(bo, vx / len, vy / len) : reach;
    // The safe zone (px): the disc and a little more; never less than the disc itself.
    const dead = Math.min(PULL_SAFE * r.s0, Math.max(DISC_R * r.s0 + 1, full - PULL_RAMP));
    const px = o.x - fp.x, py = o.y - fp.y, pl = Math.sqrt(px * px + py * py);
    if (len < dead || !(pl > 0)) { this.aim = { i: d.i, dx: 0, dy: -1, power: 0, fx: fp.x, fy: fp.y, contact: null, idle: true }; return; }
    const dx = px / pl, dy = py / pl;
    const power = Math.min(1, (len - dead) / (full - dead));
    const amp = Math.max(0, Math.min(1, (reach - full) / (reach * 0.5)));   // how much the edge squeezes this pull
    // Vs the computer: its difficulty. A challenge: the aiming help its sender chose (2026-10-15).
    const level = this.mode === 'cpu' ? this.diff : this.mode === 'mp' && this.mp && this.mp.game ? this.mp.game.aids : 'medium';
    const aids = AIDS[level] || AIDS.medium;
    const contact = aids.guide ? aimContact(m.b, d.i, dx, dy) : null;
    const path = contact && contact.hit === BALL ? ballPath(m.b, d.i, contact, 30 + 90 * power) : null;
    this.aim = { i: d.i, dx, dy, power, fx: fp.x, fy: fp.y, contact, path, arrow: aids.arrow, amp, gap: full - len, len };
  }

  _pointerUp(e, cancel) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const a = this.aim;
    this.drag = null;
    this.aim = null;
    if (cancel || !a || a.idle || a.power < MIN_POWER || this.phase !== 'aim' || this.screen !== 'play') return;
    // Lifted in the bottom strip (the phone's own gestures live there), or with the app no longer in
    // front: not a flick.
    if (this._inNoShotStrip(e.clientY) || document.hidden) return;
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
    this._camTick(dt);
    this._paintSkip();
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
      hideTeam: m && this.mode === 'mp' && this.mp && this.mp.game.pick ? 1 : -1,
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
    window.removeEventListener('online', this._onOnline);
    clearTimeout(this._drainTimer);
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
/** The hub armed a match (alert.js armOpen) while this game is open: take it (see openArmed). */
export function openArmed() { if (instance) instance.openArmed(); }
export default { init, destroy, isInProgress, openArmed };
