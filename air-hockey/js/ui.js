// air-hockey/js/ui.js - Air Hockey's DOM shell: start card, score row, pause and result cards,
// touch/mouse input, the clock. physics.js owns every rule; render.js every pixel.
//
// NO SOUND, EVER (Matt, 2026-09-28: "it should not make any sound ever"). The stage 1 Web Audio
// clack/horn was removed, and there is deliberately no mute button, because there is nothing to
// mute. Do not add audio back.
//
// 2026-09-28 additions: shot speed on every goal you score and on the result card; records
// (fastest shot, shutouts, best win streak, goals) via recordAirHockey; Expert level; table
// colours; invite a player by name (a Messages message with a Join button).
//
// Stage 2 (2026-09-27): setup screen (Easy / Medium / Hard), how to play, and the result recorded
// with recordResult('airhockey', difficulty, won) when a match ENDS. A match left before 7 records
// nothing (it was neither won nor lost).
//
// Stage 4 (2026-09-28): PLAY ONLINE. Lobby = js/net.js (create / join by code / heartbeat /
// leave, room game id 'airhockey'); the match itself runs on js/live.js (rooms/<CODE>/ah/). An
// online result records as recordResult('airhockey', 'mp', won). A quiet peer (no message for 3 s)
// freezes the table under "Waiting for <name>..."; after 30 s "End match" appears (no result). A
// peer who leaves (room status 'ended') ends it for both, no result. Leaving (Back, hub back,
// closing the game) calls leaveRoom, which is what tells the other phone.
//
// isInProgress(): the LITERAL meaning (no mid-game resume, Hoops' / Snake's class): true while a
// match is under way (playing, between goals, or paused). Nothing is persisted mid-match.

import { TABLE, createMatch, resetMatch, advance, clampTarget } from './physics.js';
import { createCpu, cpuThink, DIFFS } from './ai.js';
import { createRenderer, TABLES } from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange, getLang } from '../../js/i18n.js';
import { onThemeChange } from '../../js/theme.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordAirHockey, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onlineGateText, codeMayPlayOnline } from '../../js/online-gate.js';
import { deviceId } from '../../js/game-stats.js';
import { getStatsApp } from '../../js/firebase-boot.js';

const t = makeT(STRINGS);
const { H } = TABLE;
const SETTINGS_KEY = 'gamehub.airhockey.v1';
/** A Join tapped on an invite in Messages hands the code over here (session only, never kept). */
export const JOIN_KEY = 'gamehub.airhockey.join';

/** Shot speed for people. The table is 900 units long; a real full-size table is 8 ft (2.44 m), so
 *  one unit is 2.44/900 m. The STORED record stays in table units per second (rule 4: never store a
 *  converted number); this only converts for display. EN shows mph, ES km/h. */
export function shotText(u, lang) {
  const ms = (u || 0) * 2.44 / 900;
  return lang === 'es' ? `${Math.round(ms * 3.6)} km/h` : `${Math.round(ms * 2.23694)} mph`;
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  catch (err) { console.error('[airhockey] settings save failed', err); }
}
/** Last difficulty picked, else the profile's first opponent skill (1/2/3), else Medium. The table
 *  colour is a separate choice, Classic by default. */
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { /* none */ }
  const table = saved && TABLES.includes(saved.table) ? saved.table : 'classic';
  if (saved && DIFFS.includes(saved.difficulty)) return { difficulty: saved.difficulty, table };
  let d = null;
  try {
    const p = loadProfile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : null;
    d = skill === 1 ? 'easy' : skill === 3 ? 'hard' : skill === 2 ? 'medium' : null;
  } catch { /* no profile is fine */ }
  return { difficulty: d || 'medium', table };
}
/** The Air Hockey records (the `ah` sub-counter) as stored, for the result card. */
function ahRecord() {
  try { return (loadStats().games.airhockey || {}).ah || {}; } catch { return {}; }
}
/** This player's record against one level, read from the shared stats store (THE LAW rule 1: the
 *  setup screen shows what is stored, so a result is never invisible). */
function recordVs(diff) {
  try {
    const b = ((loadStats().games.airhockey || {}).byDiff || {})[diff] || {};
    return { won: b.won | 0, lost: b.lost | 0 };
  } catch { return { won: 0, lost: 0 }; }
}
const QUIET_MS = 3000;       // no message from the other phone for this long: freeze and wait
const GIVE_UP_MS = 30000;    // ...and after this long, offer "End match"
const ROOM_GAME = 'airhockey';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** How to play: the diagram carries the one non-obvious part - your mallet stays in YOUR half and
 *  sits just above your finger - with shapes and arrows, never colour alone. Built at render time
 *  so the labels follow the language. */
function helpSVG() {
  const lbl = (x, y, key, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="currentColor">${esc(t(key))}</text>`;
  return `<svg class="ah-help-svg" viewBox="0 0 240 190" role="img" aria-hidden="true">
    <rect x="60" y="6" width="120" height="178" rx="16" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <rect x="96" y="3" width="48" height="6" fill="currentColor"/><rect x="96" y="181" width="48" height="6" fill="currentColor"/>
    <rect x="62" y="95" width="116" height="87" rx="14" fill="currentColor" opacity="0.12"/>
    <line x1="60" y1="95" x2="180" y2="95" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/>
    <circle cx="112" cy="40" r="7" fill="currentColor"/>
    <path d="M114 60 L113 50" stroke="currentColor" stroke-width="2"/><path d="M109 53 L113 46 L117 53" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="120" cy="130" r="13" fill="#1f5fa8"/><path d="M120 124 L125.5 133.5 L114.5 133.5 Z" fill="#fff"/>
    <path d="M120 146 L120 160" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 3"/>
    <path d="M113 177 q0 -12 7 -14 q7 2 7 14 z" fill="currentColor" opacity="0.55"/>
    <path d="M122 118 L114 70" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 3"/>
    ${lbl(186, 140, 'hl_half', 'start')}${lbl(54, 172, 'hl_finger', 'end')}${lbl(54, 44, 'hl_puck', 'end')}${lbl(186, 12, 'hl_goal', 'start')}
  </svg>`;
}
const FINGER_OFFSET_CSS = 34;   // the mallet sits this far ABOVE the finger, so the thumb never hides it

const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
const TRI_SVG = '<svg class="ah-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 1.5 L11 10.5 L1 10.5 Z" fill="currentColor"/></svg>';
const SQ_SVG = '<svg class="ah-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="9" height="9" fill="currentColor"/></svg>';

let instance = null;

class AirHockeyUI {
  constructor(host) {
    this.host = host;
    this.screen = 'menu';          // menu | help | game | paused | over
    this.settings = loadSettings();
    this.match = createMatch();
    this.cpu = createCpu(this.settings.difficulty, 1, (Date.now() & 0xffff) + 1);
    this.raf = 0;
    this.last = 0;
    this.flash = 0;
    this.goalT = 0;
    // Everything render.js draws beyond the bodies. One object, reused every frame.
    this.fx = { dt: 0, flash: 0, goal: -1, goalT: 0, reduce: false };
    this.lastShot = 0;          // speed of MY last hit (table units/s): the goal readout
    this.matchBest = 0;         // my fastest shot this match: the record
    this.drag = { id: null };
    this.online = null;          // { code, side, role, oppName, session, channel, net, ... } while online
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this._ensureCss();
    this._build();
    this.renderer = createRenderer(this.canvas);

    this._onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.online) return;   // an online match cannot be paused
        if (this.screen === 'game') this._pause(); else if (this.screen === 'paused') this._resume();
      }
    };
    // Solo: hiding the tab pauses. Online: nothing can pause the other phone, so the loop simply
    // stops (it shows "Waiting for you" over there) and restarts when this phone comes back.
    this._onVis = () => {
      if (document.hidden) { if (this.screen === 'game' && !this.online) this._pause(); this._stop(); }
      else if (this.online && (this.screen === 'game' || this.screen === 'wait' || this.screen === 'over')) this._start();
    };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    // The stage also changes size with no viewport event (the stylesheet landing after first
    // paint, the hub chrome settling): docs/BUILDING-A-GAME.md, "The .hub-game height trap".
    this._stageSize = '';
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (this.stage.clientWidth + 'x' + this.stage.clientHeight !== this._stageSize) this._layout();
    }) : null;
    if (this._ro) this._ro.observe(this.stage);
    this._offLang = onLangChange(() => this._relabel());
    this._offTheme = onThemeChange(() => this._layout());

    resetMatch(this.match, 0);
    this._layout();
    this._showOnly('menu');
    // Arrived from a Join button on an invite (js/messages-ui.js): straight into that game.
    let join = '';
    try { join = sessionStorage.getItem(JOIN_KEY) || ''; sessionStorage.removeItem(JOIN_KEY); } catch { /* none */ }
    if (/^[A-Z0-9]{4}$/.test(join)) {
      this._openOnline();
      this.root.querySelector('[data-role="codeIn"]').value = join;
      this._joinRoom();
    }
  }

  _ensureCss() {
    const add = (href, mark) => {
      if (document.head.querySelector(`link[${mark}]`)
        || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.setAttribute(mark, '1');
      document.head.appendChild(link);
    };
    add(new URL('../../css/ui.css', import.meta.url).href, 'data-gh-ui-css');
    add(new URL('../css/air-hockey.css', import.meta.url).href, 'data-ah-css');
  }

  // --- DOM ---------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="ah-root">
        <div class="ah-hud">
          <p class="ah-score" data-role="score" aria-live="off">
            <span class="ah-sc ah-sc-cpu">${SQ_SVG}<span class="ah-opp" data-role="oppName"></span><b data-role="s1">0</b></span>
            <span class="ah-sc ah-sc-you">${TRI_SVG}<span data-l="you"></span><b data-role="s0">0</b></span>
          </p>
          <button type="button" class="gh-btn gh-btn--icon ah-pause" data-act="pause" data-la="pause">${PAUSE_SVG}</button>
        </div>
        <div class="ah-stage" data-role="stage">
          <div class="ah-screen" data-role="screen">
            <canvas class="ah-canvas" role="img"></canvas>
            <p class="ah-banner" data-role="banner" hidden></p>
          </div>
        </div>

        <div class="ah-ov" data-ov="menu" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title" data-l="title"></h2>
            <p class="ah-tag" data-l="tagline"></p>
            <p class="ah-label" data-l="difficulty"></p>
            <div class="gh-seg ah-seg" role="group" data-role="diffs"></div>
            <div class="ah-tablerow">
              <span class="ah-label" data-role="tableLabel"></span>
              <div class="ah-swatches" role="group" data-role="tables"></div>
            </div>
            <p class="ah-rec" data-role="rec"></p>
            <div class="ah-actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play"><span data-l="play"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="online"><span data-l="play_online"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="howto"><span data-l="howto"></span></button>
            </div>
          </div>
        </div>

        <div class="ah-ov" data-ov="online" hidden>
          <div class="gh-modal ah-card" role="dialog" aria-modal="true">
            <button type="button" class="gh-modal__close" data-act="onlineClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ah-title ah-title-sm" data-l="play_online"></h2>
            <div data-role="lobbyMain">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="invite"><span data-l="invite_player"></span></button>
              <button type="button" class="gh-btn gh-btn--block ah-mt" data-act="create"><span data-l="create_game"></span></button>
              <p class="ah-label" data-l="or_join"></p>
              <div class="ah-joinrow">
                <input class="gh-input ah-code" data-role="codeIn" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" data-lp="code_ph">
                <button type="button" class="gh-btn" data-act="join"><span data-l="join"></span></button>
              </div>
            </div>
            <div data-role="lobbyInvite" hidden>
              <label class="ah-label" for="ah-who" data-l="invite_who"></label>
              <select class="gh-input ah-select" id="ah-who" data-role="who"></select>
              <div class="ah-actions">
                <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="sendInvite"><span data-l="send_invite"></span></button>
                <button type="button" class="gh-btn gh-btn--block" data-act="inviteBack"><span data-l="back"></span></button>
              </div>
            </div>
            <div data-role="lobbyWait" hidden>
              <p class="ah-note" data-role="invitedLine" hidden></p>
              <p class="ah-label" data-l="share_code"></p>
              <p class="ah-bigcode" data-role="bigCode"></p>
              <p class="ah-rec" data-l="waiting_join"></p>
              <button type="button" class="gh-btn gh-btn--block" data-act="cancelRoom"><span data-l="cancel"></span></button>
            </div>
            <p class="ah-err" data-role="lobbyErr" role="alert"></p>
            <p class="ah-rec" data-role="recOnline"></p>
          </div>
        </div>

        <div class="ah-ov ah-ov-soft" data-ov="wait" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title ah-title-sm" data-role="waitTitle"></h2>
            <button type="button" class="gh-btn gh-btn--block" data-act="endMatch" data-role="endMatch" hidden><span data-l="end_match"></span></button>
          </div>
        </div>

        <div class="ah-ov" data-ov="left" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title ah-title-sm" data-role="leftTitle"></h2>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="leftBack"><span data-l="back"></span></button>
          </div>
        </div>

        <div class="ah-ov" data-ov="help" hidden>
          <div class="gh-modal ah-card ah-help" role="dialog" aria-modal="true">
            <button type="button" class="gh-modal__close" data-act="helpClose" data-la="aria_close">${X_SVG}</button>
            <h2 class="ah-title ah-title-sm" data-l="howto"></h2>
            <div class="ah-help-body" data-role="helpBody">
              <p class="ah-line ah-line-goal" data-l="help_goal"></p>
              <div data-role="helpSvg"></div>
              <p class="ah-line" data-l="help_caption"></p>
              <p class="ah-line ah-line-ex" data-l="help_example"></p>
              <p class="ah-line" data-l="help_in"></p>
              <p class="ah-line" data-l="help_serve"></p>
              <p class="ah-line" data-l="help_stuck"></p>
            </div>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="helpClose"><span data-l="help_close"></span></button>
          </div>
        </div>

        <div class="ah-ov" data-ov="paused" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title" data-l="paused"></h2>
            <div class="ah-actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="quit"><span data-l="quit"></span></button>
            </div>
          </div>
        </div>

        <div class="ah-ov" data-ov="over" hidden>
          <div class="gh-modal ah-card" role="dialog" aria-modal="true">
            <button type="button" class="gh-modal__close" data-act="back" data-la="aria_close">${X_SVG}</button>
            <h2 class="ah-title" data-role="overTitle"></h2>
            <p class="ah-final" data-role="overScore"></p>
            <p class="ah-shot" data-role="overShot"></p>
            <p class="ah-badges" data-role="overBadges"></p>
            <p class="ah-rec" data-role="overRec"></p>
            <p class="ah-note" data-role="overNote" hidden></p>
            <div class="ah-actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="rematch"><span data-role="rematchLabel"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="back"><span data-l="back"></span></button>
            </div>
          </div>
        </div>
        <p class="ah-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.ah-root');
    this.stage = q('[data-role="stage"]');
    this.screenEl = q('[data-role="screen"]');
    this.canvas = q('.ah-canvas');
    this.banner = q('[data-role="banner"]');
    this.liveEl = q('[data-role="live"]');
    this.scoreEl = q('[data-role="score"]');
    this.s0 = q('[data-role="s0"]');
    this.s1 = q('[data-role="s1"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });

    this.root.addEventListener('click', (e) => this._click(e));
    // Input lives on the stage (the table plus the margin round it), so a thumb just below the
    // table still steers. Pointer capture keeps a drag alive past the edge.
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

  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    this.root.querySelectorAll('[data-lp]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.lp)); el.setAttribute('aria-label', t('code_label')); });
    this.canvas.setAttribute('aria-label', t('aria_canvas'));
    this.root.querySelector('[data-role="helpSvg"]').innerHTML = helpSVG();
    this._syncOpp();
    const d = this.settings.difficulty;
    const row = this.root.querySelector('[data-role="diffs"]');
    row.setAttribute('aria-label', t('difficulty'));
    row.innerHTML = DIFFS.map((id) => `
      <button type="button" class="gh-seg__item" data-diff="${id}" aria-pressed="${d === id}">
        ${diffShapeSVG(tierOf(id))}<span>${esc(t('diff_' + id))}</span></button>`).join('');
    const tb = this.settings.table, trow = this.root.querySelector('[data-role="tables"]');
    trow.setAttribute('aria-label', t('table'));
    trow.innerHTML = TABLES.map((id) => `
      <button type="button" class="ah-swbtn" data-table="${id}" aria-pressed="${tb === id}" aria-label="${esc(t('table_' + id))}">
        <i class="ah-swatch ah-swatch-${id}" aria-hidden="true"></i></button>`).join('');
    this._syncTableLabel();
    this._syncRec();
    this._syncScore();
    if (this.screen === 'over') this._fillOver();
    if (this.screen === 'help') this._fitHelp();
  }
  /** The chosen table's NAME beside the dots: the dots alone would be colour only. */
  _syncTableLabel() {
    this.root.querySelector('[data-role="tableLabel"]').textContent = t('table_is', { name: t('table_' + this.settings.table) });
  }
  _syncRec() {
    const d = this.settings.difficulty, r = recordVs(d), o = recordVs('mp');
    this.root.querySelector('[data-role="rec"]').textContent = t('rec_vs', { diff: t('diff_' + d), w: r.won, l: r.lost });
    this.root.querySelector('[data-role="recOnline"]').textContent = t('rec_online', { w: o.won, l: o.lost });
  }
  /** The opponent's label in the score row: CPU, or the other player's name online. */
  _syncOpp() {
    this.root.querySelector('[data-role="oppName"]').textContent = this.online ? this.online.oppName : t('cpu');
    if (this.screen === 'wait') this._fillWait();
  }
  /** Every help line on ONE row (docs/BUILDING-A-GAME.md, "How-to-play screens"): measure, and
   *  step the font down until it fits, never below the 11px floor. */
  _fitHelp() {
    this.root.querySelectorAll('.ah-help .ah-line').forEach((el) => {
      el.style.fontSize = '';
      let px = parseFloat(getComputedStyle(el).fontSize) || 14;
      while (el.scrollWidth > el.clientWidth + 0.5 && px > 11) { px -= 0.5; el.style.fontSize = px + 'px'; }
    });
  }

  _syncScore() {
    const [a, b] = this.match.score;
    this.s0.textContent = String(a);
    this.s1.textContent = String(b);
    this.scoreEl.setAttribute('aria-label', t('aria_score', { a, b }));
  }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-playing', name === null || name === 'wait');
    this.root.classList.toggle('is-online', !!this.online);
    const focus = name && this.ov[name].querySelector('.gh-btn--primary');
    if (focus) focus.focus({ preventScroll: true });
  }

  // --- layout ------------------------------------------------------------------------------------
  _layout() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._stageSize = w + 'x' + h;
    const dark = document.documentElement.classList.contains('gh-dark');
    const size = this.renderer.layout(w - 8, h - 8, dark, this.settings.table);
    this.screenEl.style.width = size.w + 'px';
    this.screenEl.style.height = size.h + 'px';
    this.renderer.render(this.match, this.fx);
  }

  // --- match lifecycle ---------------------------------------------------------------------------
  _play() {
    resetMatch(this.match, 0);
    this.cpu = createCpu(this.settings.difficulty, 1, (Date.now() & 0xffff) + 1);
    this.difficulty = this.settings.difficulty;
    this._resetFx();
    this.banner.hidden = true;
    this._syncScore();
    this.screen = 'game';
    this._showOnly(null);
    this._start();
  }
  _pause() {
    if (this.screen !== 'game') return;
    this.screen = 'paused';
    this._stop();
    this._showOnly('paused');
  }
  _resume() {
    if (this.screen !== 'paused') return;
    this.screen = 'game';
    this._showOnly(null);
    this._start();
  }
  _toMenu() {
    this._stop();
    this.screen = 'menu';
    this._syncOpp();
    resetMatch(this.match, 0);
    this.banner.hidden = true;
    this._syncScore();
    this.renderer.render(this.match, this.fx);
    this._syncRec();
    this._showOnly('menu');
  }
  _over() {
    if (!this.online) this._stop();   // online, the loop keeps running: it carries the rematch handshake
    this.screen = 'over';
    this.banner.hidden = true;
    this.renderer.clearFx();
    this.renderer.render(this.match, this.fx);
    // Recorded once, when the match ENDS at 7. Rule 6: a refused or failed write is said loudly.
    try {
      const [gf, ga] = this.match.score;
      this._bestBefore = ahRecord().bestShot | 0;
      const st = recordAirHockey(this.online ? 'mp' : this.difficulty, this.match.winner === 0,
        { goalsFor: gf, goalsAgainst: ga, shot: this.matchBest });
      if (!st) console.warn('[airhockey] result not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[airhockey] recording the result failed', err); }
    this._fillOver();
    this._showOnly('over');
  }
  _fillOver() {
    const [a, b] = this.match.score;
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    const on = this.online;
    const d = on ? 'mp' : (this.difficulty || this.settings.difficulty), r = recordVs(d);
    q('overTitle').textContent = this.match.winner === 0 ? t('you_win') : on ? t('name_wins', { name: on.oppName }) : t('cpu_wins');
    q('overScore').textContent = `${a} - ${b}`;
    const lang = getLang();
    const rec = ahRecord();
    q('overShot').textContent = this.matchBest ? t('fastest_shot', { v: shotText(this.matchBest, lang) }) : '';
    const badges = [];
    if (this.matchBest && this.matchBest > (this._bestBefore | 0)) badges.push(t('new_best_shot'));
    if (this.match.winner === 0 && b === 0) badges.push(t('shutout'));
    if (this.match.winner === 0 && (rec.streak | 0) >= 2) badges.push(t('streak', { n: rec.streak | 0 }));
    q('overBadges').textContent = badges.join('  ·  ');
    q('overBadges').hidden = !badges.length;
    q('overRec').textContent = on ? t('rec_online', { w: r.won, l: r.lost }) : t('rec_vs', { diff: t('diff_' + d), w: r.won, l: r.lost });
    const asked = !!(on && on.session.wantsRematch);
    q('rematchLabel').textContent = asked ? t('rematch_wait', { name: on.oppName }) : t('rematch');
    q('rematchLabel').parentElement.disabled = asked;
    const theyAsked = !!(on && on.session.peerWantsRematch && !asked);
    q('overNote').hidden = !theyAsked;
    q('overNote').textContent = theyAsked ? t('rematch_asked', { name: on.oppName }) : '';
  }

  _goal(scorer) {
    const [a, b] = this.match.score;
    this._syncScore();
    this.liveEl.textContent = scorer === 0 ? t('say_goal_you', { a, b })
      : this.online ? t('say_goal_opp', { name: this.online.oppName, a, b }) : t('say_goal_cpu', { a, b });
    if (this.match.phase === 'over') return;
    const lang = getLang();
    this.banner.innerHTML = scorer === 0 && this.lastShot
      ? `${esc(t('goal'))}<small>${esc(shotText(this.lastShot, lang))}</small>` : esc(t('goal'));
    this.banner.classList.toggle('is-cpu', scorer === 1);
    this.banner.hidden = false;
    // The scorer's number pops; the goal mouth lights up. Garnish: off under reduced motion.
    const num = scorer === 0 ? this.s0 : this.s1;
    num.classList.remove('is-pop'); void num.offsetWidth; num.classList.add('is-pop');
    this.fx.goal = scorer === 0 ? 0 : 1; this.fx.goalT = 1;
    if (!this.reduce) {
      this.flash = 1;
      this.banner.classList.remove('is-pop'); void this.banner.offsetWidth; this.banner.classList.add('is-pop');
    }
    this.goalT = 1.1;
  }

  _resetFx() {
    this.flash = 0; this.goalT = 0; this.lastShot = 0; this.matchBest = 0;
    this.fx.flash = 0; this.fx.goal = -1; this.fx.goalT = 0;
    this.banner.hidden = true;
    this.renderer.clearFx();
  }
  /** After a physics step: remember my shot speeds, throw sparks off a hard hit. */
  _shots(s) {
    const ev = s.ev;
    if (ev.shot > 0) {
      if (ev.shotBy === 0) { this.lastShot = ev.shot; if (ev.shot > this.matchBest) this.matchBest = ev.shot; }
      if (ev.shot > 450 && !this.reduce) this.renderer.sparks(ev.hx, ev.hy, Math.min(1, ev.shot / 4000));
    }
    ev.shot = 0; ev.shotBy = -1;
  }
  _tickFx(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.fx.goalT > 0) this.fx.goalT = Math.max(0, this.fx.goalT - dt * 0.9);
    this.fx.dt = dt; this.fx.flash = this.flash; this.fx.reduce = this.reduce;
  }

  // --- input -------------------------------------------------------------------------------------
  _click(e) {
    const tseg = e.target.closest('[data-table]');
    if (tseg) {
      this.settings.table = tseg.dataset.table;
      saveSettings(this.settings);
      this.root.querySelectorAll('[data-table]').forEach((x) => x.setAttribute('aria-pressed', String(x === tseg)));
      this._syncTableLabel();
      this._layout();
      return;
    }
    const seg = e.target.closest('[data-diff]');
    if (seg) {
      this.settings.difficulty = seg.dataset.diff;
      saveSettings(this.settings);   // saved on selection, not only at start
      this.root.querySelectorAll('[data-diff]').forEach((x) => x.setAttribute('aria-pressed', String(x === seg)));
      this._syncRec();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'rematch' && this.online) { this.online.session.rematch(performance.now()); this._fillOver(); }
    else if (act === 'play' || act === 'rematch') { saveSettings(this.settings); this._play(); }
    else if (act === 'online') this._openOnline();
    else if (act === 'onlineClose') { this._cancelRoom(); this._toMenu(); }
    else if (act === 'create') this._createRoom();
    else if (act === 'invite') this._openInvite();
    else if (act === 'sendInvite') this._sendInvite();
    else if (act === 'inviteBack') { this._lobbyError(''); this._lobbyView('main'); }
    else if (act === 'join') this._joinRoom();
    else if (act === 'cancelRoom') this._cancelRoom();
    else if (act === 'endMatch' || act === 'leftBack') { this._leaveOnline(); this._toMenu(); }
    else if (act === 'back' && this.online) { this._leaveOnline(); this._toMenu(); }
    else if (act === 'howto') { this.screen = 'help'; this._showOnly('help'); this._fitHelp(); }
    else if (act === 'helpClose') { this.screen = 'menu'; this._showOnly('menu'); }
    else if (act === 'pause') { if (this.online) return; if (this.screen === 'game') this._pause(); else if (this.screen === 'paused') this._resume(); }
    else if (act === 'resume') this._resume();
    else if (act === 'quit' || act === 'back') this._toMenu();
  }
  _tablePoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.renderer.toTable(e.clientX - r.left, e.clientY - r.top);
  }
  _aim(e, offset) {
    const p = this._tablePoint(e);
    const off = offset ? FINGER_OFFSET_CSS / (this.renderer.scale || 1) : 0;
    clampTarget(this.match.mallets[0], p.x, p.y - off);
  }
  _pointerDown(e) {
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') { this._aim(e, false); return; }
    // Touch anywhere in your half (with a little grace above the centre line) to grab the mallet.
    const p = this._tablePoint(e);
    if (p.y < H / 2 - 60) return;
    this.drag.id = e.pointerId;
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this._aim(e, true);
  }
  _pointerMove(e) {
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') { this._aim(e, false); return; }
    if (e.pointerId === this.drag.id) this._aim(e, true);
  }
  _pointerUp(e) {
    if (e.pointerId === this.drag.id) this.drag.id = null;
  }

  // --- clock -------------------------------------------------------------------------------------
  _start() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  _frame(now) {
    this.raf = 0;
    if (instance !== this) return;
    if (this.online) { this._onlineFrame(now); return; }
    if (this.screen !== 'game') return;
    let dt = Math.max(0, (now - this.last) / 1000); this.last = now;
    if (dt > 0.05) dt = 0.05;
    const s = this.match;
    cpuThink(s, this.cpu, dt);
    s.ev.hit = 0; s.ev.wall = 0; s.ev.goal = -1; s.ev.stuck = -1;
    advance(s, dt);
    this._shots(s);
    if (s.ev.goal >= 0) this._goal(s.ev.goal);
    this._tickFx(dt);
    if (this.goalT > 0) { this.goalT -= dt; if (this.goalT <= 0) this.banner.hidden = true; }
    this.renderer.render(s, this.fx);
    if (s.phase === 'over') { this._over(); return; }
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }

  // --- online (stage 4) --------------------------------------------------------------------------
  async _net() {
    if (!this._netMod) this._netMod = await import('../../js/net.js');
    return this._netMod;
  }
  _me() {
    let p = null;
    try { p = loadProfile(); } catch { /* none */ }
    return { name: (p && p.name) || t('friend'), avatar: (p && p.emoji) || '', deviceId: deviceId() };
  }
  /** 'main' (create / invite / join), 'invite' (pick a player) or 'wait' (a room, waiting). */
  _lobbyView(mode, code) {
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    q('lobbyMain').hidden = mode !== 'main';
    q('lobbyInvite').hidden = mode !== 'invite';
    q('lobbyWait').hidden = mode !== 'wait';
    if (mode !== 'wait') q('invitedLine').hidden = true;
    if (code) q('bigCode').textContent = code;
  }
  /** `text` (already in words, from js/online-gate.js) wins over `key` when given. */
  _lobbyError(key, text) {
    this.root.querySelector('[data-role="lobbyErr"]').textContent = text || (key ? t(key) : '');
    this.root.querySelectorAll('[data-act="create"], [data-act="join"], [data-act="invite"], [data-act="sendInvite"]').forEach((b) => { b.disabled = false; });
  }
  _lobbyBusy() {
    this.root.querySelector('[data-role="lobbyErr"]').textContent = t('connecting');
    this.root.querySelectorAll('[data-act="create"], [data-act="join"], [data-act="invite"], [data-act="sendInvite"]').forEach((b) => { b.disabled = true; });
  }
  _openOnline() {
    this.screen = 'online';
    this._lobbyView('main');
    this._lobbyError('');
    this._syncRec();
    this._showOnly('online');
  }
  async _createRoom() {
    this._lobbyBusy();
    const net = await this._net();
    const r = await net.createRoom(ROOM_GAME, {}, this._me());
    if (instance !== this || this.screen !== 'online') { if (r && r.code) net.leaveRoom(r.code, 'host'); return null; }
    if (!r || r.error) { this._lobbyError(r && r.error === 'busy' ? 'err_busy' : 'err_offline', onlineGateText(r && r.error)); return null; }
    this._lobbyError('');
    this._lobbyView('wait', r.code);
    this._pending = { code: r.code, stop: null };
    // Wait for the guest. A narrow listener on the guest slot only (never net.onRoom, which would
    // fire on every live message once the match starts).
    const app = await getStatsApp();
    if (!app || !this._pending || this._pending.code !== r.code) return r.code;
    this._pending.stop = app.api.onValue(app.api.ref(app.db, `rooms/${r.code}/guest`), (snap) => {
      const g = snap.val();
      if (g && this._pending && this._pending.code === r.code) {
        const stop = this._pending.stop; this._pending = null;
        try { if (stop) stop(); } catch { /* detached */ }
        this._beginOnline(r.code, 0, g.name);
      }
    });
    return r.code;
  }
  /** Invite a player by name: pick from everyone with a player code (js/messages.js
   *  readContacts, the same list Messages uses). A <select>, so a long list never scrolls the card. */
  async _openInvite() {
    this._lobbyView('invite');
    this._lobbyError('');
    const sel = this.root.querySelector('[data-role="who"]');
    sel.innerHTML = `<option value="">${esc(t('loading_players'))}</option>`;
    let list = [];
    try { list = await (await import('../../js/messages.js')).readContacts(); } catch { list = []; }
    // Only people who may play online (js/online-gate.js): an invite to anyone else could never be joined.
    list = list.filter((c) => c && codeMayPlayOnline(c.code));
    if (instance !== this || this.screen !== 'online') return;
    this._contacts = list;
    if (!list.length) { sel.innerHTML = ''; this._lobbyError('invite_none'); return; }
    // Starts on "Choose a player" so the box reads as a list, not as one fixed name.
    sel.innerHTML = `<option value="" disabled selected>${esc(t('pick_player'))}</option>`
      + list.map((c, i) => `<option value="${i}">${esc((c.emoji ? c.emoji + ' ' : '') + c.name)}</option>`).join('');
  }
  async _sendInvite() {
    const sel = this.root.querySelector('[data-role="who"]');
    const who = sel.value === '' ? null : (this._contacts || [])[Number(sel.value)];
    if (!who) { this._lobbyError('pick_first'); return; }
    const code = await this._createRoom();
    if (!code) return;
    // The invite is an ordinary Messages message (so it notifies like one, and reads fine on an
    // older app), plus an `invite` that gives it a Join button. Never queued in the outbox: a
    // room code goes stale, and the code is on screen to share by hand if the send fails.
    let res = null;
    try {
      const msgs = await import('../../js/messages.js');
      res = await msgs.sendMessage({ toCode: who.code, toName: who.name, toEmoji: who.emoji,
        text: t('invite_text', { code }), invite: { game: 'air-hockey', code } });
    } catch (err) { res = { ok: false, reason: String(err) }; }
    if (instance !== this || !this._pending || this._pending.code !== code) return;
    const line = this.root.querySelector('[data-role="invitedLine"]');
    line.hidden = false;
    line.textContent = res && res.ok ? t('invite_sent', { name: who.name }) : t('invite_failed');
    line.classList.toggle('is-err', !(res && res.ok));
    if (!(res && res.ok)) console.warn('[airhockey] invite not sent', res);
  }
  /** Back out of the lobby: close a room nobody has joined yet. */
  _cancelRoom() {
    const p = this._pending;
    if (!p) { this._lobbyView('main'); return; }
    this._pending = null;
    try { if (p.stop) p.stop(); } catch { /* detached */ }
    if (this._netMod) this._netMod.leaveRoom(p.code, 'host');
    this._lobbyView('main');
  }
  async _joinRoom() {
    const input = this.root.querySelector('[data-role="codeIn"]');
    const code = String(input.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { this._lobbyError('err_code'); return; }
    this._lobbyBusy();
    const net = await this._net();
    const app = await getStatsApp();
    if (!app) { this._lobbyError('err_offline'); return; }
    // Refuse another game's room BEFORE joinRoom writes us into it.
    try {
      const g = (await app.api.get(app.api.ref(app.db, `rooms/${code}/game`))).val();
      if (g !== ROOM_GAME) { this._lobbyError('err_not_found'); return; }
    } catch { this._lobbyError('err_offline'); return; }
    const r = await net.joinRoom(code, this._me());
    if (instance !== this || this.screen !== 'online') return;
    if (!r || r.error) {
      const k = { 'not-found': 'err_not_found', full: 'err_full', version: 'err_version' }[r && r.error] || 'err_offline';
      this._lobbyError(k, onlineGateText(r && r.error));
      return;
    }
    this._beginOnline(code, 1, r.room && r.room.host && r.room.host.name);
  }
  async _beginOnline(code, side, oppName) {
    const net = await this._net();
    const { openChannel, createLiveSession } = await import('./live.js');
    const app = await getStatsApp();
    if (instance !== this) return;
    const on = { code, side, role: side === 0 ? 'host' : 'guest', oppName: String(oppName || t('friend')).slice(0, 24), net };
    on.channel = await openChannel(code, side, (msg, now) => { if (on.session) on.session.onPeer(msg, now); });
    if (!on.channel || !app) { this._lobbyError('err_offline'); net.leaveRoom(code, on.role); return; }
    resetMatch(this.match, side === 0 ? 0 : 1);
    on.session = createLiveSession(this.match, side, on.channel, {
      onGoal: (scorer) => this._goal(scorer),
      onRound: () => this._onlineRound(),
    });
    on.startedAt = performance.now();
    on.quietSince = 0;
    net.heartbeat(code, on.role);
    // The other phone leaving (Back, End match, closing the game) marks the room 'ended'.
    on.stopStatus = app.api.onValue(app.api.ref(app.db, `rooms/${code}/status`), (snap) => {
      if (snap.val() === 'ended' && this.online === on && !on.leaving) this._peerLeft();
    });
    this.online = on;
    this._syncOpp();
    this._syncScore();
    this._resetFx();
    this.screen = 'game';
    this._showOnly(null);
    this._start();
  }
  _onlineRound() {
    this._syncScore();
    this._resetFx();
    this.screen = 'game';
    this._showOnly(null);
  }
  _fillWait() {
    const on = this.online; if (!on) return;
    this.root.querySelector('[data-role="waitTitle"]').textContent = t('wait_for', { name: on.oppName });
    this.root.querySelector('[data-role="endMatch"]').hidden = !(on.quietSince && performance.now() - on.quietSince > GIVE_UP_MS);
  }
  _onlineFrame(now) {
    const on = this.online;
    let dt = Math.max(0, (now - this.last) / 1000); this.last = now;
    if (dt > 0.05) dt = 0.05;
    const s = this.match, ses = on.session;
    // Quiet: nothing heard for QUIET_MS (or nothing at all 1.5 s after starting).
    const quiet = ses.heard ? ses.sinceHeard > QUIET_MS : now - on.startedAt > 1500;
    if (quiet && !on.quietSince) on.quietSince = now;
    if (!quiet) on.quietSince = 0;
    s.ev.hit = 0; s.ev.wall = 0; s.ev.stuck = -1;
    ses.frame(dt, now, quiet);
    if (this.screen === 'game' || this.screen === 'wait') {
      if (quiet && this.screen === 'game') { this.screen = 'wait'; this._showOnly('wait'); }
      else if (!quiet && this.screen === 'wait') { this.screen = 'game'; this._showOnly(null); }
      if (this.screen === 'wait') this._fillWait();
      this._shots(s);
      this._tickFx(dt);
      if (this.goalT > 0) { this.goalT -= dt; if (this.goalT <= 0) this.banner.hidden = true; }
      this.renderer.render(s, this.fx);
      if (s.phase === 'over') this._over();
    } else if (this.screen === 'over') {
      if (this._overWant !== ses.peerWantsRematch) { this._overWant = ses.peerWantsRematch; this._fillOver(); }
    }
    if (this.online === on) this.raf = requestAnimationFrame((n) => this._frame(n));
  }
  _peerLeft() {
    const on = this.online;
    if (!on) return;
    this._teardownOnline(false);
    this.root.querySelector('[data-role="leftTitle"]').textContent = t('left', { name: on.oppName });
    this.screen = 'left';
    this._showOnly('left');
  }
  /** Stop everything online; `announce` also marks the room ended so the other phone knows. */
  _teardownOnline(announce) {
    const on = this.online;
    if (!on) return;
    on.leaving = true;
    this.online = null;
    this._stop();
    try { if (on.stopStatus) on.stopStatus(); } catch { /* detached */ }
    try { on.channel.close(); } catch { /* closed */ }
    if (announce) on.net.leaveRoom(on.code, on.role); else on.net.disconnect();
    this.match.puckRemote = false;
  }
  _leaveOnline() { this._teardownOnline(true); }

  destroy() {
    this._leaveOnline();
    this._cancelRoom();
    this._stop();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.reduceMQ.removeEventListener) this.reduceMQ.removeEventListener('change', this._onReduce);
    if (this._offResize) this._offResize();
    if (this._ro) this._ro.disconnect();
    if (this._offLang) this._offLang();
    if (this._offTheme) this._offTheme();
    this.host.innerHTML = '';
  }
}

export function init(container) {
  if (instance) destroy();
  instance = new AirHockeyUI(container);
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
}
/** Literal meaning: a match under way (playing, between goals or paused) would be lost by leaving. */
export function isInProgress() {
  return !!(instance && (instance.screen === 'game' || instance.screen === 'paused' || instance.screen === 'wait'));
}
export default { init, destroy, isInProgress };
