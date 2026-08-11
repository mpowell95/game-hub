// ui.js - Mancala UI module. Hub contract:
//   init(container)  - mount the game into a DOM element
//   destroy()        - tear down listeners, timers, and animations
//
// Every stone is a persistent DOM element on an overlay layer above the board.
// Moves physically sow the stones: each one flies pit to pit on an arced path
// (Web Animations API), the receiving pit's cluster re-flows, counts pop as
// stones land, and captures sweep both pits into the mancala. Reduced motion
// (or ?motion=0) snaps to the final layout instead.
//
// Colorblind-safe: the two sides are told apart by position (top vs bottom),
// by name and emoji on the score bar, and by the turn marker, never hue alone.

import {
  P1, P2, P1_STORE, P2_STORE, PITS_PER_SIDE, START_STONES,
  pitsOf, storeOf, ownerOf, isStore,
  newGame, legalMoves, applyMove,
} from './game.js';
import { chooseMove } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';
import { howToHtml, createHowTo } from './howto.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.mancala.v1';
const GAME_KEY = 'gamehub.mancala.game.v1';   // the one in-progress game (see saveGame)
// The MULTIPLAYER autosave, a THIRD key, distinct from both of the above and never read or
// written by either of the other two paths (THE LAW rule 5: permanent once shipped). Follows
// Chinchon's/Tic Tac Toe's separate-key choice, not Escoba's mp-sub-object-in-the-solo-key shape.
const MP_SAVE_KEY = 'gamehub.mancala.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// The difficulty bucket a MULTIPLAYER result records under -- settled by Tic Tac Toe
// (js/CLAUDE.md, "The third consumer: Tic Tac Toe"; HANDOFF-MP-WEB-SESSION.md touchpoint 5).
// A real human opponent has no AI tier; 'mp' is unmapped in js/difficulty-tiers.js, so
// tierOf() returns null and the play counts in every total/the leaderboard's "All" filter with
// no tier pill. Follow it -- a second convention here would split one player's MP history
// across two bucket names for no benefit.
const MP_DIFFICULTY = 'mp';

const LEVELS = [
  { level: 1, key: 'beginner', labelKey: 'diff_beginner' },
  { level: 2, key: 'intermediate', labelKey: 'diff_intermediate' },
  { level: 3, key: 'pro', labelKey: 'diff_pro' },
];
const LEVEL_KEY = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };
// Short difficulty word for the compact in-game chip (the setup screen keeps the
// full Easy/Medium/Hard tier names). These are the same tiers, just the
// space-saving synonym, so the score bar never has to truncate a player's name.
const CHIP_LABEL_KEY = { 1: 'chip_easy', 2: 'chip_medium', 3: 'chip_hard' };

// Animation speed. 'slow' doubles every duration/stagger (half speed) for a
// calmer pace over a full game; 'normal' is the default.
const SPEEDS = [
  { key: 'normal', labelKey: 'speed_normal' },
  { key: 'slow', labelKey: 'speed_slow' },
];

// The bot's default identity. The hub's other games give the AI a real name +
// person avatar rather than "Computer" (Chinchón/Escoba share this exact
// roster); Mancala follows suit. A profile opponent still wins when one is set.
const AI_ROSTER = [
  { name: 'Lucía', emoji: '💃' },
  { name: 'Diego', emoji: '🤠' },
  { name: 'Sofía', emoji: '🎸' },
  { name: 'Mateo', emoji: '🧢' },
  { name: 'Elena', emoji: '🌹' },
];

const SOW_STAGGER_MS = 115;    // launch interval between sown stones
const FLIGHT_MS = 300;         // one stone's pit-to-pit flight
const CAPTURE_STAGGER_MS = 55; // interval between captured stones leaving
const BOT_THINK_MS = 650;      // pause before the bot plays

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureStylesheet() {
  const href = new URL('../css/mancala.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/mancala.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const out = {};
      const lvl = Math.round(Number(raw.level));
      if (lvl >= 1 && lvl <= 3) out.level = lvl;
      if (raw.speed === 'slow' || raw.speed === 'normal') out.speed = raw.speed;
      // Who opens the NEXT new game. Persisted so the alternation survives
      // leaving the game, a reload, or closing the app.
      if (raw.nextStarter === P1 || raw.nextStarter === P2) out.nextStarter = raw.nextStarter;
      return Object.keys(out).length ? out : null;
    }
  } catch { /* treat as no settings */ }
  return null;
}

/** Merge a patch into the stored settings, so no writer clobbers another's field. */
function saveSettings(patch) {
  try {
    const cur = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    const base = (cur && typeof cur === 'object') ? cur : {};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...patch }));
  } catch { /* ignore */ }
}

/** Persist the in-progress game so leaving (hub, Setup, a reload, or closing the
 *  PWA) never loses it. Only ever holds ONE unfinished game; cleared the moment
 *  it finishes or a new one starts. */
function saveGame(ui) {
  try {
    if (ui.mp) return;   // MP never writes the solo slot (see MP_SAVE_KEY)
    if (!ui.state || ui.state.over || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      pits: ui.state.pits,
      turn: ui.state.turn,
      mode: ui.mode,
      level: ui.level,
      movesMade: ui.movesMade,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard: a corrupt or non-standard
 *  board is treated as "no saved game" rather than crashing the module. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1 || !Array.isArray(raw.pits) || raw.pits.length !== 14) return null;
    const pits = raw.pits.map((n) => Math.round(Number(n)));
    if (!pits.every((n) => Number.isFinite(n) && n >= 0)) return null;
    // A standard Kalah board always holds exactly 6*2*4 = 48 stones.
    if (pits.reduce((a, b) => a + b, 0) !== PITS_PER_SIDE * 2 * START_STONES) return null;
    const lvl = Math.round(Number(raw.level));
    return {
      pits,
      turn: raw.turn === P2 ? P2 : P1,
      mode: raw.mode === 'friend' ? 'friend' : 'bot',
      level: lvl >= 1 && lvl <= 3 ? lvl : 2,
      movesMade: Math.max(0, Math.round(Number(raw.movesMade)) || 0),
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

/** Shared hard validation for any restored engine state (MP autosave, recovery snapshot).
 *  A corrupt or non-standard board is treated as "invalid" rather than crashing the module. */
function validMpBoardState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.pits) || s.pits.length !== 14) return false;
  const pits = s.pits.map((n) => Math.round(Number(n)));
  if (!pits.every((n) => Number.isFinite(n) && n >= 0)) return false;
  if (pits.reduce((a, b) => a + b, 0) !== PITS_PER_SIDE * 2 * START_STONES) return false;
  return s.turn === P1 || s.turn === P2;
}

/** Small deterministic hash for per-stone jitter (stable across re-layouts). */
function hash(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Cluster offsets (unit circle) for n stones in a round pit, slot k. */
function pitSlot(k, n) {
  if (n <= 1) return [0, 0];
  if (n === 2) return [[-0.4, -0.1], [0.4, 0.1]][k];
  if (n === 3) return [[0, -0.45], [-0.42, 0.28], [0.42, 0.28]][k];
  if (n === 4) return [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]][k];
  if (n === 5) return [[-0.45, -0.45], [0.45, -0.45], [0, 0], [-0.45, 0.45], [0.45, 0.45]][k];
  if (n <= 7) {
    if (k === 6) return [0, 0];
    const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * 0.55, Math.sin(a) * 0.55];
  }
  // 8+: outer ring of 8, then an inner ring.
  if (k < 8) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * 0.62, Math.sin(a) * 0.62];
  }
  const a = ((k - 8) / Math.max(1, Math.min(n - 8, 5))) * Math.PI * 2 + 0.6;
  return [Math.cos(a) * 0.28, Math.sin(a) * 0.28];
}

class MancalaUI {
  constructor(container) {
    this.container = container;

    // Identity + difficulty prefill. Precedence: this game's own last-used
    // settings, then the shared profile, then built-in defaults.
    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const saved = loadSettings();
    this.level = (saved && saved.level) || (opp && opp.skill) || 2;
    // Animation speed: 'normal' (default) or 'slow' (half speed). speedFactor
    // multiplies every animation duration/stagger in the move sequence.
    this.speed = (saved && saved.speed) || 'normal';
    this.speedFactor = this.speed === 'slow' ? 2 : 1;
    // The opening move alternates game to game (you, then the opponent, then you
    // ...), on every difficulty and in both modes. Very first game: you open.
    this.nextStarter = (saved && saved.nextStarter != null) ? saved.nextStarter : P1;
    this.hasProfileName = !!(profile && profile.name);
    this.humanName = (profile && profile.name) || t('you');
    this.humanEmoji = (profile && profile.emoji) || '🙂';
    // A profile opponent wins; otherwise the bot is a named character from the
    // shared roster (a random one per session, so the opponent varies game to game).
    const cast = AI_ROSTER[Math.floor(Math.random() * AI_ROSTER.length)];
    this.botName = (opp && opp.name) || cast.name;
    this.botEmoji = (opp && opp.emoji) || cast.emoji;

    this.mode = 'bot';
    this.view = 'setup';
    this.state = null;
    this.busy = false;
    this.movesMade = 0;
    this.gen = 0;             // bumped on every teardown; async sequences bail out
    this.timers = [];
    this.anims = new Set();
    this.stones = [];         // [{ id, el, pit, scale, rot }]
    this.pitEls = [];
    this.countEls = [];
    this.resizeObs = null;
    this._dead = false;
    this._statsCommitted = false;

    // Multiplayer session state, or null in solo. Everything MP-specific hangs off this one
    // field, so `if (this.mp)` is the whole mode test (mirrors tic-tac-toe/js/ui.js).
    this.mp = null;
    this._mode = 'solo';          // 'solo' | 'host' | 'join'; deliberately NOT persisted
    this._lobby = null;           // null | 'host' | 'join'
    this._mpBusy = false;
    this._mpError = '';
    this._mpStatusMsg = '';
    this._mpJoinCode = '';
    this._mpPendingCode = null;
    this._mpJoinedCode = null;
    this._mpLobbyRoom = null;

    const params = new URLSearchParams(location.search);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // ?motion=1 forces animation on (dev aid); ?motion=0 forces it off.
    this.motionOK = params.get('motion') === '1' ? true
      : params.get('motion') === '0' ? false : !reduced;

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };
    // Belt and braces with the board ResizeObserver: some embedded browsers
    // never deliver RO callbacks, and rotation always fires window resize.
    // Re-place twice: right away, and again once the media-query relayout has
    // settled (the event can fire before the new grid geometry is final).
    this._onResize = () => {
      if (this.view !== 'game') return;
      this.placeAllStones(false);
      clearTimeout(this._resizeSettle);
      this._resizeSettle = setTimeout(() => this.placeAllStones(false), 140);
    };

    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    this.container.addEventListener('input', this._onInput);
    document.addEventListener('keydown', this._onKey);
    this._offViewport = onViewportResize(this._onResize);

    // Come back to exactly where you left off. A live MULTIPLAYER room takes precedence over a
    // solo save (starting an MP match clears the solo slot, so in practice only one of the two
    // is ever fresh) and is restored asynchronously, since it has a room to rejoin first.
    const mpSave = this._mpLoadSave();
    if (mpSave) {
      this.renderSetup();
      this._tryRestoreMP(mpSave);
    } else {
      const inProgress = loadGame();
      if (inProgress) this.resumeGame(inProgress); else this.renderSetup();
    }
  }

  // --- lifecycle -------------------------------------------------------------

  destroy() {
    // Leaving mid-game keeps the board. If a move is still animating, `this.state`
    // is the position BEFORE it (playMove only commits at the end), so the worst
    // case is that the in-flight move is rolled back, never a half-applied board.
    this._dead = true;
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);
    this.gen += 1;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const a of this.anims) { try { a.cancel(); } catch { /* ignore */ } }
    this.anims.clear();
    if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
    if (this._howTo) { this._howTo.destroy(); this._howTo = null; }
    // Deliberately do NOT abandon an MP room here: destroy() runs for ANY hub teardown,
    // including just navigating back to the launcher mid-match, which is exactly what the MP
    // autosave's 30-minute rejoin window exists for. Only the LOCAL listener and heartbeat
    // stop. An explicit abandon is _mpLeaveToSetup(). A hosted room that never reached a game
    // is the one exception: nobody depends on it, so it is released rather than left occupying
    // a code until its 24h TTL.
    if (!this.mp && this._lobby === 'host' && this._mpPendingCode) {
      net.leaveRoom(this._mpPendingCode, 'host').catch(() => { /* best-effort */ });
    }
    try { net.disconnect(); } catch { /* never let teardown throw */ }
    this.mp = null;
    this.container.removeEventListener('click', this._onClick);
    this.container.removeEventListener('input', this._onInput);
    document.removeEventListener('keydown', this._onKey);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    clearTimeout(this._resizeSettle);
    this.container.innerHTML = '';
    this.state = null;
    this.stones = [];
  }

  inProgress() {
    return this.view === 'game' && !!this.state && !this.state.over && this.movesMade > 0;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  sleep(ms) { return new Promise((res) => this.later(res, ms)); }

  // --- seats ------------------------------------------------------------------

  /** The local player's engine side: P1 (0) in solo/friend, P1 for the MP HOST and P2 for the
   *  MP GUEST -- host and guest fixed to a side for the whole room, same as engine seat 0/1 in
   *  every other MP game (P1===0, P2===1, a happy coincidence of game.js's existing constants).
   *  Every "self" lookup must go through this rather than assume P1, or a guest reads the
   *  host's side of the board as its own (and records the host's result as its own -- a THE LAW
   *  rule 2 violation). Built in from the first line of this pass, not retrofitted (escoba/js/
   *  ui.js:860, tic-tac-toe/js/ui.js:316 state the same rule).
   *
   *  DEVIATION FROM THE TIC-TAC-TOE TEMPLATE, stated explicitly rather than silently: Tic Tac
   *  Toe's X/O marks are symmetric and get reassigned to whichever seat opens each game
   *  (marks[] flips). Mancala's P1/P2 are NOT symmetric -- they are physically different halves
   *  of the board (P1 owns pits 0-5/store 6, rendered bottom; P2 owns 7-12/store 13, rendered
   *  top) -- so which side you sit on is fixed for the room, like a real board's fixed seating,
   *  and only WHO MOVES FIRST varies. */
  _localSeat() { return this.mp ? this.mp.localSeat : P1; }
  _remoteSeat() { return 1 - this._localSeat(); }
  /** Whose turn counts as a tap on the board: MP goes through the seat: solo/friend keep their
   *  existing rule (friend = hot-seat, both sides shared on one screen; bot = always P1). */
  _humanSide() { return this.mp ? this._localSeat() : (this.mode === 'friend' ? this.state.turn : P1); }

  /** Who this device is, in js/net.js's room vocabulary. */
  _myIdentity() { return { name: this.humanName, avatar: this.humanEmoji, deviceId: deviceId() }; }

  // --- setup view ------------------------------------------------------------

  _logoHtml() {
    return `<div class="mc-logo" aria-hidden="true">
      <span class="mc-logo-store mc-logo-store--p2"></span>
      <span class="mc-logo-pits">
        ${Array.from({ length: 6 }, (_, i) => `<span class="mc-logo-pit" data-lp="${i}"></span>`).join('')}
      </span>
      <span class="mc-logo-store mc-logo-store--p1"></span>
    </div>`;
  }

  _modeSeg() {
    return `<div class="mc-seg" role="radiogroup" aria-label="${t('title')}">
      ${[['solo', t('mode_solo')], ['host', t('mode_host')], ['join', t('mode_join')]].map(([v, lbl]) => `
        <button type="button" class="mc-segbtn${this._mode === v ? ' is-active' : ''}"
          data-action="set-mode" data-v="${v}" role="radio" aria-checked="${this._mode === v}">${lbl}</button>`).join('')}
    </div>`;
  }

  renderSetup() {
    this.gen += 1;
    if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
    this.view = 'setup';
    this.state = null;
    this.busy = false;
    this.stones = [];
    // Coming here from a live game (e.g. to change the speed) must not lose it:
    // the saved game is still on disk, so offer to go straight back to it.
    const paused = !!loadGame();
    const head = `${this._logoHtml()}<h2 class="mc-title">${t('title')}</h2><p class="mc-sub">${t('tagline')}</p>${this._modeSeg()}`;

    if (this._lobby) {
      this.container.innerHTML = `<div class="mancala"><div class="mc-shell mc-setup">${head}${this._lobbyHTML()}</div></div>`;
      return;
    }
    if (this._mode === 'join') {
      this.container.innerHTML = `<div class="mancala"><div class="mc-shell mc-setup">${head}${this._joinBodyHTML()}
        <button type="button" class="mc-ghost" data-action="help">${t('howto')}</button>
      </div></div>`;
      return;
    }

    const hosting = this._mode === 'host';
    this.container.innerHTML = `
      <div class="mancala">
        <div class="mc-shell mc-setup">
          ${head}
          ${hosting ? '' : `<div class="mc-vscard">
            <div class="mc-vsside">
              <span class="mc-vsemoji">${esc(this.humanEmoji)}</span>
              <span class="mc-vsname">${esc(this.humanName)}</span>
            </div>
            <span class="mc-vslabel">${t('vs')}</span>
            <div class="mc-vsside" data-role="vs-opp">
              <span class="mc-vsemoji">${esc(this.botEmoji)}</span>
              <span class="mc-vsname">${esc(this.botName)}</span>
            </div>
          </div>`}

          ${hosting ? '' : `<div class="mc-field">
            <span class="mc-fieldlabel" id="mc-difflabel">${t('difficulty')}</span>
            <div class="mc-seg" role="radiogroup" aria-labelledby="mc-difflabel">
              ${LEVELS.map((l) => `
                <button type="button" class="mc-segbtn${l.level === this.level ? ' is-active' : ''}"
                  data-action="level" data-level="${l.level}" role="radio"
                  aria-checked="${l.level === this.level}">${diffShapeSVG(tierOf(l.key))}${t(l.labelKey)}</button>`).join('')}
            </div>
          </div>`}

          <div class="mc-field">
            <span class="mc-fieldlabel" id="mc-speedlabel">${t('anim_speed')}</span>
            <div class="mc-seg" role="radiogroup" aria-labelledby="mc-speedlabel">
              ${SPEEDS.map((s) => `
                <button type="button" class="mc-segbtn${s.key === this.speed ? ' is-active' : ''}"
                  data-action="speed" data-speed="${s.key}" role="radio"
                  aria-checked="${s.key === this.speed}">${t(s.labelKey)}</button>`).join('')}
            </div>
          </div>

          ${hosting
            ? `<p class="mc-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
               <button type="button" class="mc-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`
            : `${paused ? `
          <button type="button" class="mc-primary" data-action="resume">${t('resume_game')}</button>
          <p class="mc-resumenote">${t('resume_note')}</p>` : ''}
          <button type="button" class="${paused ? 'mc-secondary' : 'mc-primary'}" data-action="start-bot">${t('play_vs', { name: esc(this.botName) })}</button>
          <button type="button" class="mc-secondary" data-action="start-friend">${t('two_players')}</button>`}
          <button type="button" class="mc-ghost" data-action="help">${t('howto')}</button>
        </div>
      </div>`;
  }

  /** Join mode's body: the code input lives on the setup screen itself, never its own
   *  pre-join screen -- _lobby only switches to 'join' once the join has actually succeeded
   *  (see _mpJoinSubmit). Mirrors tic-tac-toe/js/ui.js's Join mode. */
  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="mc-mp-msg mc-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="mc-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : t('mp_join_hint')))}</p>`;
    return `<div class="mc-mp-lobby">
      <span class="mc-mp-label">${t('mp_enter_code')}</span>
      <input class="mc-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}"
        autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="mc-primary" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = `<button type="button" class="mc-ghost" data-action="mp-cancel">${t('mp_back_btn')}</button>`;
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="mc-mp-lobby">
        <span class="mc-mp-label">${t('mp_code_aria')}</span>
        <div class="mc-mp-code">${code ? esc(code) : '····'}</div>
        <span class="mc-mp-label">${t('mp_opponent_label')}</span>
        <div class="mc-mp-oppslot">${guest
          ? `<span>${esc(guest.avatar || '🙂')}</span><span>${esc(guest.name || '')}</span>`
          : `<span class="mc-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="mc-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="mc-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    return `<div class="mc-mp-lobby">
      <span class="mc-mp-label">${t('mp_code_aria')}</span>
      <div class="mc-mp-code">${esc(this._mpJoinedCode || '')}</div>
      <span class="mc-mp-label">${t('mp_host_label')}</span>
      <div class="mc-mp-oppslot">${host
        ? `<span>${esc(host.avatar || '🙂')}</span><span>${esc(host.name || '')}</span>`
        : `<span class="mc-mp-oppempty">—</span>`}</div>
      <p class="mc-mp-msg" data-role="mp-msg">${t('mp_waiting_host')}</p>
      ${back}
    </div>`;
  }

  _setMpStatus(key) { this._mpStatusMsg = key; this._rerender(); }
  _clearMpStatus() { if (!this._mpStatusMsg) return; this._mpStatusMsg = ''; this._rerender(); }
  _rerender() {
    if (this._dead) return;
    if (this.view === 'game' && this.state) { this.refresh(); } else { this.renderSetup(); }
  }

  /** Keep the code input's message slot fresh without re-rendering the input itself (which
   *  would drop what the player is typing). */
  _syncMpMsgSlot() {
    const slot = this.container.querySelector('[data-role="mp-msg"]');
    if (!slot) return;
    slot.textContent = this._mpError || (this._mpBusy ? t('mp_joining') : t('mp_join_hint'));
  }

  onInput(e) {
    const input = e.target.closest('[data-role="mp-code-input"]');
    if (!input || !this.container.contains(input)) return;
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (input.value !== clean) input.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  // --- game view -------------------------------------------------------------

  /** Own identity always renders where THIS device's seat physically sits (P1 = bottom, P2 =
   *  top -- see the deviation note above _localSeat()): the host always sees itself at p1, the
   *  guest always sees itself at p2. Read through _localSeat(), never assumed. */
  names() {
    if (this.mp) {
      const me = { name: this.humanName, emoji: this.humanEmoji };
      const oppInfo = this.mp.opp;
      const opp = { name: (oppInfo && oppInfo.name) || t('mp_opponent_label'), emoji: (oppInfo && oppInfo.avatar) || '🙂' };
      return this._localSeat() === P1 ? { p1: me, p2: opp } : { p1: opp, p2: me };
    }
    if (this.mode === 'bot') {
      return {
        p1: { name: this.humanName, emoji: this.humanEmoji },
        p2: { name: this.botName, emoji: this.botEmoji },
      };
    }
    return {
      p1: { name: this.hasProfileName ? this.humanName : t('player_1'), emoji: this.humanEmoji },
      p2: { name: t('player_2'), emoji: '👥' },
    };
  }

  startGame(mode) {
    this.gen += 1;
    this.mode = mode;
    // Alternate the opening move every new game (including Restart and Play
    // again), then bank the flip immediately so it survives leaving mid-game.
    const starter = this.nextStarter === P2 ? P2 : P1;
    this.nextStarter = starter === P1 ? P2 : P1;
    this.persistSettings();
    clearGame();                 // a new game replaces any saved one
    this.state = newGame(starter);
    // Reset the per-game idempotence guard so THIS game's own result gets recorded when it ends
    // (finish()'s `if (!this._statsCommitted)` would otherwise silently skip every game after the
    // first one played in a session -- Play again/Restart/New game all call startGame() again on
    // this SAME instance rather than remounting, so nothing else was clearing it. The MP rematch
    // path (_mpApplyRoundRecord) already resets it per game; this brings solo in line -- same bug,
    // same fix, as dots-boxes/js/ui.js's startGame() 2026-07-30).
    this._statsCommitted = false;
    this.view = 'game';
    this.busy = false;
    this.movesMade = 0;
    this.renderGame();
    saveGame(this);
    // Say who opens. Without this the alternation is invisible: the opponent's
    // opening move just appears, and a game you open looks identical to one
    // where the turn never alternated.
    const n = this.names();
    this.toast(starter === P1 && this.mode === 'bot' ? t('you_start') : t('name_starts', { name: n[starter === P1 ? 'p1' : 'p2'].name }));
    // When the opponent opens, hand them the first move.
    if (this.mode === 'bot' && starter === P2) this.botTurn();
  }

  /** Write level, speed and the alternating starter back to the settings store. */
  persistSettings() {
    saveSettings({ level: this.level, speed: this.speed, nextStarter: this.nextStarter });
  }

  /** Rebuild the board from a saved game and hand the turn back to whoever had it. */
  resumeGame(saved) {
    this.gen += 1;
    this.mode = saved.mode;
    this.level = saved.level;
    this.state = { pits: saved.pits.slice(), turn: saved.turn, over: false, winner: null };
    this.view = 'game';
    this.busy = false;
    this.movesMade = saved.movesMade;
    this.renderGame();
    // If we left while the bot was on move, it picks up where it left off.
    if (this.mode === 'bot' && this.state.turn === P2) this.botTurn();
  }

  renderGame() {
    const n = this.names();
    const chip = this.mp ? '' : this.mode === 'bot' ? t(CHIP_LABEL_KEY[this.level]) : t('chip_two_players');

    // Portrait sow order runs up the right column and down the left, so the
    // right column lists P2's pits bottom-up and the left column P1's top-down.
    const pitBtn = (i) => `
      <button type="button" class="mc-pit mc-pit--${ownerOf(i) === P1 ? 'p1' : 'p2'}"
        data-pit="${i}" style="grid-area:p${i}" aria-label="${t('pit_aria')}">
        <span class="mc-hole"></span>
        <span class="mc-count"><b class="mc-countnum" data-role="count-${i}">0</b></span>
      </button>`;

    this.container.innerHTML = `
      <div class="mancala" data-turn="p1">
        <div class="mc-shell mc-game">
          <div class="mc-boardwrap">
            <!-- Opponent identity sits with their mancala (the top store). -->
            <div class="mc-id mc-id--opp" data-role="id-p2">
              <span class="mc-id-emoji">${esc(n.p2.emoji)}</span>
              <span class="mc-id-name">${esc(n.p2.name)}</span>
              <span class="mc-id-chip">${esc(chip)}</span>
            </div>
            <div class="mc-board" data-role="board">
              <div class="mc-store mc-store--p2" style="grid-area:s13" data-pit="13">
                <span class="mc-storecount"><b class="mc-countnum" data-role="count-13">0</b></span>
              </div>
              ${[12, 11, 10, 9, 8, 7, 0, 1, 2, 3, 4, 5].map(pitBtn).join('')}
              <div class="mc-store mc-store--p1" style="grid-area:s6" data-pit="6">
                <span class="mc-storecount"><b class="mc-countnum" data-role="count-6">0</b></span>
              </div>
              <div class="mc-stones" data-role="stones" aria-hidden="true"></div>
              <div class="mc-think" data-role="think" hidden>
                <span>${t('thinking', { name: esc(n.p2.name) })}</span><span class="mc-dots"><i></i><i></i><i></i></span>
              </div>
              <div class="mc-toast" data-role="toast" hidden></div>
            </div>
            <!-- Your identity sits with your mancala (the bottom store). -->
            <div class="mc-id mc-id--you" data-role="id-p1">
              <span class="mc-id-emoji">${esc(n.p1.emoji)}</span>
              <span class="mc-id-name">${esc(n.p1.name)}</span>
            </div>
          </div>

          <p class="mc-status" data-role="status" aria-live="polite"></p>

          <footer class="mc-bar">
            <button type="button" class="mc-ghost mc-small" data-action="help">${t('help_short')}</button>
            <!-- Speed is togglable IN the game: changing it used to mean going out
                 to Setup, which threw the match away. Applies to the next move. -->
            <button type="button" class="mc-ghost mc-small" data-action="speed-toggle"
              data-role="speedbtn" aria-label="${t('anim_speed')}">${this.speed === 'slow' ? '½&times;' : '1&times;'}</button>
            ${this.mp
              ? `<button type="button" class="mc-ghost mc-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
              : `<button type="button" class="mc-ghost mc-small" data-action="restart">${t('restart')}</button>
                 <button type="button" class="mc-ghost mc-small" data-action="newgame">${t('setup')}</button>`}
          </footer>
        </div>
      </div>`;

    const board = this.container.querySelector('[data-role="board"]');
    this.boardEl = board;
    this.stonesEl = this.container.querySelector('[data-role="stones"]');
    this.pitEls = [];
    this.countEls = [];
    for (let i = 0; i < 14; i++) {
      this.pitEls[i] = board.querySelector(`[data-pit="${i}"]`);
      this.countEls[i] = board.querySelector(`[data-role="count-${i}"]`);
    }

    this.spawnStones();
    this.resizeObs = new ResizeObserver(() => this.placeAllStones(false));
    this.resizeObs.observe(board);
    this.refresh();
  }

  // --- stones ----------------------------------------------------------------

  spawnStones() {
    this.stonesEl.innerHTML = '';
    this.stones = [];
    let id = 0;
    for (let pit = 0; pit < 14; pit++) {
      for (let k = 0; k < this.state.pits[pit]; k++) {
        const el = document.createElement('span');
        el.className = 'mc-stone';
        const stone = {
          id, el, pit,
          scale: 0.9 + hash(id * 7 + 1) * 0.25,
          rot: (hash(id * 13 + 5) - 0.5) * 40,
        };
        el.dataset.tone = String(id % 3);
        this.stonesEl.appendChild(el);
        this.stones.push(stone);
        id += 1;
      }
    }
    this.nextStoneId = id;
    this.placeAllStones(false);
  }

  stonesIn(pit) { return this.stones.filter((s) => s.pit === pit); }

  /** Target transform for a stone at slot k of n in its pit. */
  posFor(stone, pit, k, n) {
    const el = this.pitEls[pit];
    const stoneSize = this.stoneSize || 13;
    const half = stoneSize / 2;
    let x; let y;
    if (isStore(pit)) {
      const w = el.offsetWidth; const h = el.offsetHeight;
      const pad = stoneSize * 0.9;
      const innerW = Math.max(1, w - pad * 2); const innerH = Math.max(1, h - pad * 2);
      const sp = stoneSize * 0.95;
      const cols = Math.max(1, Math.floor(innerW / sp));
      const rows = Math.max(1, Math.floor(innerH / sp));
      const col = k % cols; const row = Math.floor(k / cols) % rows;
      const usedCols = Math.min(n, cols); const usedRows = Math.min(Math.ceil(n / cols), rows);
      x = el.offsetLeft + pad + (innerW - (usedCols - 1) * sp) / 2 + col * sp - half;
      y = el.offsetTop + pad + (innerH - (usedRows - 1) * sp) / 2 + row * sp - half;
      x += (hash(stone.id * 3 + pit) - 0.5) * 5;
      y += (hash(stone.id * 5 + pit) - 0.5) * 5;
    } else {
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      const hole = el.querySelector('.mc-hole');
      const R = ((hole ? hole.offsetWidth : el.offsetWidth) / 2) - half - 3;
      const [ux, uy] = pitSlot(k, n);
      x = cx + ux * R + (hash(stone.id * 3 + pit) - 0.5) * 3 - half;
      y = cy + uy * R + (hash(stone.id * 5 + pit) - 0.5) * 3 - half;
    }
    return { x, y, t: `translate(${x}px, ${y}px) rotate(${stone.rot}deg) scale(${stone.scale})` };
  }

  /** Re-place every stone from state (no flight). `settle`: animate the nudge. */
  placeAllStones(settle) {
    if (!this.boardEl || !this.state) return;
    const hole = this.boardEl.querySelector('.mc-hole');
    this.stoneSize = hole ? Math.max(10, Math.min(17, Math.round(hole.offsetWidth * 0.24))) : 13;
    this.stonesEl.style.setProperty('--mc-stone', this.stoneSize + 'px');
    for (let pit = 0; pit < 14; pit++) {
      const list = this.stonesIn(pit);
      list.forEach((s, k) => {
        if (!settle) s.el.classList.add('mc-nomove');
        s.el.style.transform = this.posFor(s, pit, k, list.length).t;
        if (!settle) {
          // Reflow so the transform applies without a transition, then re-enable.
          void s.el.offsetWidth;
          s.el.classList.remove('mc-nomove');
        }
      });
    }
  }

  /** Nudge one pit's cluster into its n-stone arrangement (smooth CSS transition). */
  settlePit(pit) {
    const list = this.stonesIn(pit);
    list.forEach((s, k) => { s.el.style.transform = this.posFor(s, pit, k, list.length).t; });
  }

  /** Fly one stone to `pit` on an arc. Resolves when it lands. */
  flyStone(stone, pit, ms) {
    const list = this.stonesIn(pit);
    const from = stone.el.style.transform;
    const dest = this.posFor(stone, pit, list.length, list.length + 1);
    stone.pit = pit;
    if (!this.motionOK) { stone.el.style.transform = dest.t; return Promise.resolve(); }

    // Arc: raise the midpoint above the straight line, scale up in flight.
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(from);
    const x0 = m ? parseFloat(m[1]) : dest.x; const y0 = m ? parseFloat(m[2]) : dest.y;
    const dist = Math.hypot(dest.x - x0, dest.y - y0);
    const lift = Math.max(16, Math.min(56, dist * 0.3));
    const midX = (x0 + dest.x) / 2; const midY = Math.min(y0, dest.y) - lift;
    stone.el.classList.add('mc-nomove', 'is-flying');
    const anim = stone.el.animate([
      { transform: from },
      { transform: `translate(${midX}px, ${midY}px) rotate(${stone.rot + 24}deg) scale(${stone.scale * 1.28})`, offset: 0.5 },
      { transform: dest.t },
    ], { duration: ms, easing: 'cubic-bezier(0.33, 0.05, 0.35, 1)' });
    this.anims.add(anim);
    // Race a timeout so a throttled or hidden tab can never stall the move
    // sequence: if the animation clock is frozen, land the stone anyway.
    const landed = Promise.race([
      anim.finished.catch(() => {}),
      new Promise((res) => this.later(res, ms + 500)),
    ]);
    return landed.then(() => {
      this.anims.delete(anim);
      try { anim.cancel(); } catch { /* already finished */ }
      stone.el.style.transform = dest.t;
      stone.el.classList.remove('is-flying');
      void stone.el.offsetWidth;
      stone.el.classList.remove('mc-nomove');
    });
  }

  // --- HUD -------------------------------------------------------------------

  setCount(pit, value, pop) {
    const el = this.countEls[pit];
    if (!el) return;
    el.textContent = value;
    if (pop && this.motionOK) {
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
    }
    // The mancala stores ARE the score display now (centered plaques), so there
    // is no separate scoreboard number to mirror.
  }

  /** Sync counts, turn highlight, and pit affordances from the engine. */
  refresh() {
    const s = this.state;
    for (let i = 0; i < 14; i++) this.setCount(i, s.pits[i], false);
    const root = this.container.querySelector('.mancala');
    if (root) root.dataset.turn = s.turn === P1 ? 'p1' : 'p2';
    this.container.querySelector('[data-role="id-p1"]').classList.toggle('is-turn', !s.over && s.turn === P1);
    this.container.querySelector('[data-role="id-p2"]').classList.toggle('is-turn', !s.over && s.turn === P2);
    const mpBlocked = !!(this.mp && this.mp.awaitingRecovery);
    const live = new Set(!s.over && !this.busy && !mpBlocked ? legalMoves(s) : []);
    const humanTurn = this.mp ? s.turn === this._localSeat() : (this.mode === 'friend' || s.turn === P1);
    for (let i = 0; i < 14; i++) {
      const el = this.pitEls[i];
      if (!el || isStore(i)) continue;
      el.classList.toggle('is-live', humanTurn && live.has(i));
      el.disabled = !humanTurn || !live.has(i);
    }
    // An MP status (resyncing/opponent disconnected/connection error) outranks the ordinary
    // turn text and reuses the same slot rather than adding new DOM.
    if (this.mp && this._mpStatusMsg) { this.setStatus(esc(t(this._mpStatusMsg))); return; }
    if (s.over) { this.setStatus(''); return; }
    if (this.mp) {
      this.setStatus(humanTurn ? t('your_turn') : t('mp_opp_turn', { name: esc(this.names()[s.turn === P1 ? 'p1' : 'p2'].name) }));
      return;
    }
    this.setStatus(humanTurn
      ? (this.mode === 'friend' ? t('players_turn', { name: esc(this.names()[s.turn === P1 ? 'p1' : 'p2'].name) }) : t('your_turn'))
      : '');
  }

  setStatus(html) {
    const el = this.container.querySelector('[data-role="status"]');
    if (el) el.innerHTML = html;
  }

  toast(text) {
    const el = this.container.querySelector('[data-role="toast"]');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
    this.later(() => { el.hidden = true; }, 1400);
  }

  showThinking(on) {
    const el = this.container.querySelector('[data-role="think"]');
    if (el) el.hidden = !on;
  }

  // --- move sequencing -------------------------------------------------------

  async playMove(pit) {
    const gen = this.gen;
    const SF = this.speedFactor;   // 1 = normal, 2 = relaxed (half speed)
    const result = applyMove(this.state, pit);
    if (!result) return;
    const { state: next, events } = result;
    this.busy = true;
    this.movesMade += 1;
    for (const el of this.pitEls) { if (el && !isStore(Number(el.dataset.pit))) { el.classList.remove('is-live'); el.disabled = true; } }

    // Running per-pit counts so numbers tick as stones land.
    const counts = this.state.pits.slice();
    const moving = this.stonesIn(pit);
    counts[pit] = 0;
    this.setCount(pit, 0, false);

    if (!this.motionOK) {
      this.state = next;
      this.finishMove(events, gen);
      return;
    }

    // Lift the handful, then sow: one stone per target pit, staggered.
    for (const s of moving) s.el.classList.add('is-held');
    await this.sleep(140 * SF);
    if (gen !== this.gen) return;

    const flights = moving.map((s, k) => new Promise((res) => {
      this.later(() => {
        if (gen !== this.gen) { res(); return; }
        s.el.classList.remove('is-held');
        const target = events.path[k];
        this.flyStone(s, target, FLIGHT_MS * SF).then(() => {
          if (gen !== this.gen) { res(); return; }
          counts[target] += 1;
          this.setCount(target, counts[target], true);
          this.pulsePit(target);
          res();
        });
      }, k * SOW_STAGGER_MS * SF);
    }));
    await Promise.all(flights);
    if (gen !== this.gen) return;

    // Capture: the landing stone plus the opposite pit sweep into the store.
    if (events.capture) {
      await this.sleep(230 * SF);
      if (gen !== this.gen) return;
      const grabbed = [...this.stonesIn(events.capture.pit), ...this.stonesIn(events.capture.opposite)];
      this.setCount(events.capture.pit, 0, false);
      this.setCount(events.capture.opposite, 0, false);
      let landed = counts[events.capture.store];
      await Promise.all(grabbed.map((s, k) => new Promise((res) => {
        this.later(() => {
          if (gen !== this.gen) { res(); return; }
          this.flyStone(s, events.capture.store, (FLIGHT_MS + 60) * SF).then(() => {
            if (gen !== this.gen) { res(); return; }
            landed += 1;
            this.setCount(events.capture.store, landed, true);
            res();
          });
        }, k * CAPTURE_STAGGER_MS * SF);
      })));
      if (gen !== this.gen) return;
      this.toast(`+${events.capture.count}`);
    }

    // End of game: the side with stones left sweeps them home.
    if (events.sweep) {
      await this.sleep(320 * SF);
      if (gen !== this.gen) return;
      const swept = events.sweep.pits.flatMap((p) => {
        this.setCount(p, 0, false);
        return this.stonesIn(p);
      });
      let landed = counts[events.sweep.store] + (events.capture && events.capture.store === events.sweep.store ? events.capture.count : 0);
      await Promise.all(swept.map((s, k) => new Promise((res) => {
        this.later(() => {
          if (gen !== this.gen) { res(); return; }
          this.flyStone(s, events.sweep.store, (FLIGHT_MS + 60) * SF).then(() => {
            if (gen !== this.gen) { res(); return; }
            landed += 1;
            this.setCount(events.sweep.store, landed, true);
            res();
          });
        }, k * CAPTURE_STAGGER_MS * SF);
      })));
      if (gen !== this.gen) return;
    }

    this.state = next;
    this.finishMove(events, gen);
  }

  pulsePit(pit) {
    const el = this.pitEls[pit];
    if (!el || !this.motionOK) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }

  /** Reassign stone objects to pits so sprite clusters match the engine state.
   *  The animated path keeps them in sync stone by stone (flyStone); this is
   *  for the reduced-motion path, which skips the flights entirely. */
  syncStonesToState() {
    if (!this.state) return;
    const pool = [];
    for (let pit = 0; pit < 14; pit++) {
      const list = this.stonesIn(pit);
      for (let i = this.state.pits[pit]; i < list.length; i++) {
        list[i].pit = -1;
        pool.push(list[i]);
      }
    }
    for (let pit = 0; pit < 14; pit++) {
      let have = this.stonesIn(pit).length;
      while (have < this.state.pits[pit] && pool.length) {
        pool.pop().pit = pit;
        have += 1;
      }
    }
  }

  /** Single funnel after every settled move (local human, remote human, or bot).
   *
   *  MP ORDERING IS LOAD-BEARING (invariant 4). The multiplayer bookkeeping for the move that
   *  got us here -- the seq reservation + append for a local move (_mpAfterLocalMove, called
   *  BEFORE playMove), or the seq advance + hash verify for a remote one (_mpApplyNextEntry,
   *  which sets mp.appliedSeq synchronously before awaiting playMove) -- has ALREADY run by the
   *  time this is called, so the autosave below records a seq that matches the move already
   *  inside its own snapshot. Never hoist the save earlier than this point. */
  finishMove(events, gen) {
    if (gen !== this.gen) return;
    this.busy = false;
    if (!this.motionOK) { this.syncStonesToState(); this.placeAllStones(false); }
    this.refresh();
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);   // checkpoint after every settled move

    if (events.over) {
      this.later(() => { if (gen === this.gen) this.finish(); }, this.motionOK ? 650 * this.speedFactor : 250);
      return;
    }
    if (events.extraTurn) {
      this.toast(t('extra_turn'));
      this.pulseStore(storeOf(this.state.turn));
    }
    if (this.mp) { this._mpTryDeliverNextMove(); return; }
    if (this.mode === 'bot' && this.state.turn === P2) this.botTurn();
  }

  pulseStore(pit) {
    const el = this.pitEls[pit];
    if (!el || !this.motionOK) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }

  botTurn() {
    const gen = this.gen;
    this.busy = true;
    this.later(() => { if (gen === this.gen && this.busy) this.showThinking(true); }, 220);
    this.later(() => {
      if (gen !== this.gen) return;
      const pit = chooseMove(this.state, this.level);
      this.showThinking(false);
      if (pit == null) { this.busy = false; this.refresh(); return; }
      this.playMove(pit);
    }, BOT_THINK_MS);
  }

  // --- end of game -----------------------------------------------------------

  /** Series bookkeeping at the end of one game, MP only. Idempotent per game number: finish()
   *  can run more than once for the same game (a rematch overlay re-render, a restore of a
   *  finished game). `s.winner` is already P1/P2 (0/1), so it indexes mp.series.wins directly --
   *  no seat-of-mark remapping needed the way Tic Tac Toe's marks require. */
  _mpAfterGameEnd() {
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.winner === null) mp.series.draws += 1;
    else mp.series.wins[s.winner] += 1;
    this._mpSaveSnapshot();   // re-save with the tally and statsCommitted set
  }

  /** The running series tally, MP only. Read by SEAT so each device sees its own record first --
   *  the stored counters are seat-indexed, never device-relative (see _mpSnapshot). */
  _seriesLine() {
    const mp = this.mp;
    if (!mp) return '';
    const n = this.names();
    const oppName = this._localSeat() === P1 ? n.p2.name : n.p1.name;
    return t('mp_series', {
      me: mp.series.wins[this._localSeat()] | 0,
      them: mp.series.wins[this._remoteSeat()] | 0,
      d: mp.series.draws | 0,
      opp: oppName,
    });
  }

  /** Record the finished game exactly once on THIS device, and show the end-of-game overlay.
   *
   *  Both devices in a multiplayer match run this, and that is NOT double-counting:
   *  gamehub.stats is keyed per PLAYER, so two devices each writing "I played one game" is two
   *  different people each correctly getting one. Idempotence is `_statsCommitted`, set BEFORE
   *  any write -- MP reaches this by more than one path (normal finish, a restore of an
   *  already-finished game), and the flag is what stops one game counting twice on one device. */
  finish() {
    const s = this.state;
    const n = this.names();
    const won = this.mp
      ? (s.winner === null ? null : s.winner === this._localSeat())
      : (s.winner === P1 ? true : s.winner === P2 ? false : null);
    if (!this._statsCommitted) {
      this._statsCommitted = true;
      if (this.mp) {
        try { recordResult('mancala', MP_DIFFICULTY, won); } catch { /* never block the result */ }
        // Multiplayer only: capture WHO this was against while the room state is still live.
        // Never allowed to block the ordinary result from being recorded.
        const opp = this.mp.opp;
        if (opp) { try { recordHeadToHead('mancala', opp, won); } catch { /* never block the result */ } }
      } else if (this.mode === 'bot') {
        try { recordResult('mancala', LEVEL_KEY[this.level], won); } catch { /* never block the result */ }
      }
    }
    if (this.mp) this._mpAfterGameEnd();
    if (this.mp) this._mpSaveSnapshot();   // re-save with statsCommitted (and any series bump) set

    const title = this.mp
      ? (won === null ? t('draw') : won ? t('you_win') : t('opp_wins', { name: esc(this._localSeat() === P1 ? n.p2.name : n.p1.name) }))
      : this.mode === 'friend'
        ? (won === null ? t('draw') : t('name_wins', { name: esc(n[won ? 'p1' : 'p2'].name) }))
        : (won === true ? t('you_win') : won === false ? t('opp_wins', { name: esc(n.p2.name) }) : t('draw'));
    const oppEmoji = this.mp ? (this._localSeat() === P1 ? n.p2.emoji : n.p1.emoji) : n.p2.emoji;
    const isHost = !!(this.mp && this.mp.role === 'host');
    const series = this.mp ? `<p class="mc-card-series">${esc(this._seriesLine())}</p>` : '';
    const overlay = document.createElement('div');
    overlay.className = 'mc-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="mc-scrim"></div>
      <div class="mc-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="mc-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="mc-card-emoji">${won === true ? '🏆' : won === false ? esc(oppEmoji) : '🤝'}</span>
        <h3 class="mc-card-title">${title}</h3>
        <p class="mc-card-score">
          <span>${esc(n.p1.name)} <b>${s.pits[P1_STORE]}</b></span>
          <span class="mc-card-dash">:</span>
          <span><b>${s.pits[P2_STORE]}</b> ${esc(n.p2.name)}</span>
        </p>
        ${series}
        <div class="mc-card-actions">
          ${!this.mp
            ? `<button type="button" class="mc-primary" data-action="rematch">${t('play_again')}</button>
               <button type="button" class="mc-ghost" data-action="newgame">${t('change_setup')}</button>
               <button type="button" class="mc-ghost mc-small" data-action="close-overlay">${t('view_board')}</button>`
            : isHost
              ? `<button type="button" class="mc-primary" data-action="mp-next-game">${t('play_again')}</button>
                 <button type="button" class="mc-ghost mc-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
              : `<p class="mc-card-wait">${esc(t('mp_waiting_rematch', { opp: this._localSeat() === P1 ? n.p2.name : n.p1.name }))}</p>
                 <button type="button" class="mc-ghost mc-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`}
        </div>
      </div>`;
    this.container.querySelector('.mancala').appendChild(overlay);
  }

  // --- how to play -----------------------------------------------------------

  /** Mini board diagram (2026-07-24 overhaul, HANDOFF-FB2-HOWTO2 item 1: Matt's "must be
   *  completely overhauled... same excess-prose issue"). One board, one counterclockwise
   *  path: your pits (bottom, blue) into your mancala (right), across the opponent's pits
   *  (top, vermilion) right to left, then a dashed hop that visibly skips the opponent's
   *  mancala (left) and lands back on your first pit. */
  _sowDiagram() {
    return `<svg class="mc-help-diagram" viewBox="0 0 240 160" role="img" aria-label="${t('help_diagram_aria')}">
      <rect x="8" y="30" width="26" height="100" rx="8" fill="var(--mc-p2)"/>
      <rect x="206" y="30" width="26" height="100" rx="8" fill="var(--mc-p1)"/>
      ${[52, 76, 100, 124, 148, 172].map((x) => `<circle cx="${x}" cy="45" r="10" fill="var(--mc-p2)"/>`).join('')}
      ${[52, 76, 100, 124, 148, 172].map((x) => `<circle cx="${x}" cy="115" r="10" fill="var(--mc-p1)"/>`).join('')}
      <path d="M100,115 L172,115 Q206,115 214,80 Q206,45 172,45 L52,45"
        fill="none" stroke="#f2b705" stroke-width="3" stroke-linecap="round"/>
      <path d="M52,45 Q20,80 52,115" fill="none" stroke="#f2b705" stroke-width="3"
        stroke-dasharray="5 6" stroke-linecap="round"/>
      ${[100, 124, 148, 172, 214, 172, 148, 124, 100, 76, 52].map((x, i) =>
        `<circle cx="${x}" cy="${i === 4 ? 80 : i > 4 ? 45 : 115}" r="3.5" fill="#f2b705"/>`).join('')}
      <circle cx="52" cy="115" r="3.5" fill="#f2b705" opacity="0.5"/>
    </svg>`;
  }

  /** HOW TO PLAY -- the six-page animated carousel cloned from reference/mancala/*.MOV
   *  (2026-08-11). It REPLACED a static sheet: one SVG diagram, a lead line, a caption and two
   *  bullets. That sheet was correct and nobody could learn the game from it -- sowing, the
   *  extra turn and the capture are all things a board DOES, and prose about motion is the
   *  thing this repo's own VISUAL-PROCESS.md says survives the trip worst.
   *
   *  Built on demand and torn down on close, matching this game's existing overlay idiom
   *  (closeOverlays() removes them wholesale) -- Mancala rewrites its whole root on every
   *  render, so a persistently-mounted sheet would be destroyed underneath itself. */
  openHelp() {
    this.closeOverlays();
    const host = this.container.querySelector('.mancala');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'mc-overlay mc-ht-overlay';
    wrap.dataset.role = 'help';
    wrap.innerHTML = howToHtml();
    host.appendChild(wrap);
    this._howTo = createHowTo(wrap);
    if (this._howTo) this._howTo.open(0);
  }

  closeOverlays() {
    // The carousel owns running timers; removing its node alone would leave them ticking against
    // a detached board until the next clearTimers().
    if (this._howTo) { this._howTo.destroy(); this._howTo = null; }
    this.container.querySelectorAll('.mc-overlay').forEach((el) => el.remove());
  }

  // ==========================================================================
  // Multiplayer
  //
  // Room protocol (js/net.js, unchanged): rooms/<CODE> with a seq-keyed move log both sides
  // append into, a `round` record the HOST publishes, a `recovery` field, and heartbeats. Two
  // roles only. One room hosts a SERIES of games, same vocabulary as Tic Tac Toe: round.n is
  // the game number, round.dealer is the seat that moves first in that game (alternated by the
  // host every game via mp.nextDealer -- see _mpStartNextGame), round.deck is unused. Sides
  // themselves never swap (host stays P1/bottom, guest stays P2/top for the whole room -- see
  // the deviation note above _localSeat()); only who OPENS alternates, exactly like solo's
  // nextStarter. net.js's writeResult is deliberately NOT used, so status:'ended' unambiguously
  // means somebody abandoned the room (leaveRoom).
  //
  // Move payload: a single pit index (0-5, 7-12), same shape as Tic Tac Toe's Classic variant --
  // Mancala has no board-routing analogue to Ultimate.
  // ==========================================================================

  /** Is `pit` legal in the current state? The single legality gate, read by the local tap AND
   *  by every remote move before it is applied -- one gate for both seats is what makes a
   *  network-driven seat safe to add. */
  _isLegal(pit) {
    if (!this.state || this.state.over) return false;
    return legalMoves(this.state).includes(pit);
  }

  _mpNewState(role, code, opp) {
    return {
      role, code,
      // Fixed at match start and never re-derived: host = P1 (bottom), guest = P2 (top).
      localSeat: role === 'host' ? P1 : P2,
      // Who we are playing, `{ name, avatar, deviceId }` from the room. Null on the restore
      // path, where _mpOnRoomUpdate backfills it from the live room.
      opp: opp || null,
      gameNum: 0,
      // Host only: which seat opens the NEXT game of the series (flipped by
      // _mpStartNextGame every time it publishes a round). Game 1 opens with the
      // host (P1), matching the single-game behavior this replaces. Carried in the
      // MP snapshot/save so a host that restores mid-series keeps alternating
      // instead of resetting to "host always opens" -- see _mpSnapshot.
      nextDealer: P1,
      // The running series tally, seat-indexed (P1=0, P2=1) and NEVER
      // device-relative -- same discipline as Tic Tac Toe's mp.series. Sides are
      // fixed for the room (see the deviation note above _localSeat()), so seat
      // indexing is exactly as stable as device-relative would be here, but this
      // stays consistent with the shared convention anyway.
      series: { wins: [0, 0], draws: 0 },
      // Idempotence guard for _mpAfterGameEnd: finish() can run more than once for
      // the same game (a restore of an already-finished game).
      lastScoredGame: 0,
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      replayMode: false, recoveryAttempts: 0, delivering: false,
      // Set by a GUEST that has flagged a divergence: stops it consuming the log until the
      // host's snapshot lands (see _mpOnDivergence). Mancala is flag-driven (no agent
      // interface), so it needs this latch explicitly -- without it, every subsequent room
      // update would re-deliver the same entry onto the already-diverged state.
      awaitingRecovery: false,
      // Set whenever a room update refreshes the move-log cache WHILE a drain is already in
      // flight (see _mpTryDeliverNextMove's comment): because delivery here is asynchronous
      // (unlike Tic Tac Toe's fully synchronous drain), a fresh entry can land in the
      // microtask gap opened by awaiting one animated move, right after the drain loop's own
      // "nothing left to apply" check already ran on stale data. Without this flag that entry
      // is silently dropped until some UNRELATED room update happens to trigger a new drain --
      // which may never come, e.g. while both devices are otherwise idle waiting on each other.
      redeliverRequested: false,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
    };
  }

  /** The move payload written to the room log. `g` is the game number this move belongs to:
   *  an entry from an earlier game of the series can never be consumed as this game's, no
   *  matter how a stale room snapshot is ordered (see _mpApplyNextEntry). */
  _mpEncodeMove(pit) { return { t: 'move', g: this.mp.gameNum, p: pit | 0 }; }
  _mpDecodeMove(m) { return m.p | 0; }

  /** Called immediately after a LOCAL move has been legality-checked, and always BEFORE
   *  playMove() (and therefore before the funnel's autosave -- invariant 4). The seq is
   *  reserved SYNCHRONOUSLY (not after the network await) so nothing can race onto the same
   *  number, exactly as tic-tac-toe/js/ui.js's _mpAfterLocalMove does. `applyMove` is pure
   *  (game.js never mutates its argument), so computing the resulting hash here and letting
   *  playMove() recompute the same move a moment later for the actual sow is cheap and safe. */
  _mpAfterLocalMove(pit) {
    const mp = this.mp;
    if (!mp) return;
    const result = applyMove(this.state, pit);
    if (!result) return;
    const seq = ++mp.appliedSeq;
    const hash = stateHash(result.state);
    net.appendMove(mp.code, mp.role, seq, this._mpEncodeMove(pit), hash)
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
  }

  /** Drain every deliverable entry from the cached log, ONE AT A TIME.
   *
   *  DEVIATION FROM THE TIC-TAC-TOE TEMPLATE: Tic Tac Toe's remote moves apply and settle
   *  synchronously, so its drain loop is a tight `while` with no awaits. Mancala's playMove()
   *  is asynchronous (the stones physically fly pit to pit -- reusing that animation for a
   *  remote move is the whole point of routing input through the existing engine call instead
   *  of a instant-snap side channel), so each remote move must finish animating before the
   *  next one in the log can be applied -- this.state isn't "next" until playMove() resolves.
   *  The `delivering` flag still turns re-entry into iteration rather than recursion, same as
   *  the reference games; it's just an async iteration here. */
  async _mpTryDeliverNextMove() {
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this._dead || !this.state) return;
    mp.delivering = true;
    mp.redeliverRequested = false;
    try {
      // Keep draining. If a fresh entry was cached by a room update that arrived WHILE we were
      // mid-await (redeliverRequested), one more pass is required even though the previous
      // applyNextEntry() call itself already returned false against stale data -- see the
      // redeliverRequested field comment in _mpNewState.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await this._mpApplyNextEntry()) continue;
        if (mp.redeliverRequested) { mp.redeliverRequested = false; continue; }
        break;
      }
    } finally { mp.delivering = false; }
  }

  /** Apply the single log entry at appliedSeq+1 if it is present, legal and hash-consistent.
   *  Returns whether the drain should continue. */
  async _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    // Belt and braces against a stale log: an entry stamped with a different game number is
    // never this game's move.
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;
    const pit = this._mpDecodeMove(entry.move);
    // Legality is checked against OUR state BEFORE applying: an already-diverged state could
    // otherwise silently absorb an "illegal" move (game.js's applyMove is a no-op on one) and
    // desync invisibly. Then the post-apply hash is compared with the sender's.
    let agreed = this._isLegal(pit);
    let result = null;
    if (agreed) { result = applyMove(this.state, pit); agreed = !!result && stateHash(result.state) === entry.h; }
    if (!agreed) return this._mpOnDivergence(seq);
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    // Re-runs applyMove once more inside playMove (pure, deterministic, cheap on a 14-pit
    // board) and animates it exactly the way a local tap would -- the opponent's stones sow
    // for real, not an instant snap.
    await this.playMove(pit);
    return true;
  }

  /** A remote entry did not match this device's state.
   *
   *  The HOST is authoritative (same rule as every other MP game here): it keeps its own
   *  state, TAKES THE SEQ anyway (not doing so would leave it writing its next move onto a
   *  number the peer has already used), and publishes a snapshot for the guest to rebuild
   *  from. The GUEST latches (awaitingRecovery) until that snapshot lands. Returns whether the
   *  drain should continue. */
  _mpOnDivergence(seq) {
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this._mpEndDueToError(); return false; }
    this._setMpStatus('mp_status_resyncing');
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      net.writeRecovery(mp.code, seq, this._mpSnapshot()).catch(() => {});
      this.refresh();
      return true;
    }
    mp.awaitingRecovery = true;
    net.requestRecovery(mp.code, seq).catch(() => {});
    return false;
  }

  /** Normalize a transmitted/restored series tally to the shape mp.series always holds --
   *  same defensive shape as tic-tac-toe/js/ui.js's _mpNormalizeSeries. */
  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [w[0] | 0, w[1] | 0], draws: (s && s.draws) | 0 };
  }

  /** The full-state snapshot the host publishes for recovery, and the payload shape the MP
   *  autosave stores. Nothing device-relative: `state` is the absolute board (pits[] is
   *  positional, never "my side first"), and a receiver derives its own side from
   *  _localSeat(), never from anything in this object. `nextDealer`/`series` are seat-indexed
   *  for the same reason. */
  _mpSnapshot() {
    const mp = this.mp;
    return {
      v: 1, gameNum: mp.gameNum, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: this.state,
    };
  }

  /** Guest side of a resync: rebuild wholesale from the host's snapshot. Unlike the animated
   *  move path, recovery snaps directly to the recovered board (a resync is not a moment worth
   *  animating -- stones would otherwise fly across a board the player never actually saw). */
  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery && recovery.state;
    if (!snap || !validMpBoardState(snap.state)) return;
    mp.gameNum = snap.gameNum | 0;
    mp.nextDealer = recovery.state.nextDealer === P2 ? P2 : P1;
    mp.series = this._mpNormalizeSeries(recovery.state.series);
    this.state = {
      pits: snap.state.pits.slice(), turn: snap.state.turn,
      over: !!snap.state.over, winner: snap.state.winner == null ? null : snap.state.winner,
    };
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.lastScoredGame = this.state.over ? mp.gameNum : mp.lastScoredGame;
    this.view = 'game'; this.busy = false;
    this.closeOverlays();
    this._mpStatusMsg = '';
    net.clearRecovery(mp.code).catch(() => {});
    this.renderGame();
    this._mpSaveSnapshot();
    if (this.state.over) this.finish(); else this._mpTryDeliverNextMove();
  }

  /** Host only: publish the next game of the series and start it locally. Sides stay fixed for
   *  the whole room (see the deviation note above _localSeat(): host is always P1, guest always
   *  P2 -- that never changes here), but WHICH SEAT MOVES FIRST alternates every game, exactly
   *  as solo's startGame() alternates nextStarter. mp.nextDealer carries that flip across games
   *  of the series (and across a host restore -- see _mpSnapshot). */
  async _mpStartNextGame() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const dealer = mp.nextDealer === P2 ? P2 : P1;
    mp.nextDealer = dealer === P1 ? P2 : P1;
    // Publish BEFORE applying locally, same reasoning as tic-tac-toe/js/ui.js's
    // _mpStartNextGame: startRound clears the room's move log, so a very fast local
    // action could otherwise be written and then wiped by our own publish.
    try { await net.startRound(mp.code, n, null, dealer); }
    catch { this._setMpStatus('mp_status_connection_error'); }
    if (this._dead || !this.mp) return;
    // The room update carrying our own record may have raced us here and already
    // applied it; never rebuild a game that has begun.
    if ((this.mp.gameNum | 0) < n) this._mpApplyRoundRecord({ n, dealer }, null);
  }

  /** Start the local game described by the host's round record. BOTH sides go through here --
   *  the host applies its own record the moment it publishes it, the guest applies the one it
   *  receives -- so the log cache is rebuilt FROM THAT RECORD's room snapshot and never carried
   *  over (net.js's startRound clears `moves` atomically with the record). */
  _mpApplyRoundRecord(round, room) {
    const mp = this.mp;
    if (!mp || this._dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.appliedSeq = 0;
    mp.replayMode = false;
    mp.recoveryAttempts = 0;
    mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this._statsCommitted = false;
    clearGame();   // an MP match supersedes any solo save
    this.state = newGame(round.dealer === P2 ? P2 : P1);
    this.view = 'game';
    this.busy = false;
    this.movesMade = 0;
    this._mpStatusMsg = '';
    this.closeOverlays();
    this.renderGame();
    this._mpSaveSnapshot();
    this._mpTryDeliverNextMove();
  }

  // --- room lifecycle ---------------------------------------------------------

  /** The one room subscription for this device's whole MP session (lobby through the game):
   *  net.js allows exactly one at a time. */
  _mpRoomCallback(room) {
    if (this._dead) return;
    this._mpLobbyRoom = room;
    if (this.mp) { this._mpOnRoomUpdate(room); return; }
    if (this._lobby) this.renderSetup();
    if (this._lobby === 'join' && this._mpJoinedCode && room && room.status === 'active' && room.round) {
      this._mpGuestStartMatch(room);
    }
  }

  async _mpOnRoomUpdate(room) {
    if (this._dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    // Keep the opponent's identity current from the live room (and fill it in at all on the
    // restore path, which starts with none). Only overwritten while the other side is
    // actually present, so a mid-match departure leaves the last known identity intact for
    // the stats/head-to-head write.
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;

    // This game never calls net.writeResult (see the vocabulary note above), so
    // status:'ended' means exactly one thing: the other device abandoned the room.
    if (room.status === 'ended' && !mp.opponentLeft) {
      mp.opponentLeft = true;
      this._mpEndDueToOpponentLeft();
      return;
    }

    const opp = room[mp.role === 'host' ? 'guest' : 'host'];
    if (opp && !mp.opponentLeft) {
      const stale = (Date.now() - (opp.lastSeen || 0)) > MP_STALE_MS;
      if (stale && this._mpStatusMsg !== 'mp_status_opponent_disconnected') this._setMpStatus('mp_status_opponent_disconnected');
      else if (!stale && this._mpStatusMsg === 'mp_status_opponent_disconnected') this._clearMpStatus();
    }

    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        try { await net.writeRecovery(mp.code, mp.appliedSeq, this._mpSnapshot()); } catch { /* the requester retries */ }
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this._mpApplyRecovery(room.recovery);
      }
    }

    const roundN = room.round ? (room.round.n | 0) : 0;
    if (room.round && roundN > (mp.gameNum | 0)) {
      // A newer record: either a fresh guest join, or the host started the next game of the
      // series. Its own room snapshot carries the (cleared) log that goes with it.
      this._mpApplyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0) && this.state) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      // See the redeliverRequested field comment: a drain already in flight (mp.delivering)
      // may have checked for this very entry against a stale cache a moment ago. Flag it
      // regardless of whether a drain is currently running -- harmless when one isn't, since
      // _mpTryDeliverNextMove clears the flag itself the next time it starts a fresh drain.
      mp.redeliverRequested = true;
      this._mpTryDeliverNextMove();
    }
  }

  async _mpHostCreate() {
    if (this._mpBusy) return;
    this._mpBusy = true; this._mpError = '';
    this._lobby = 'host';
    this.renderSetup();
    const res = await net.createRoom('mancala', {}, this._myIdentity());
    this._mpBusy = false;
    if (this._dead) return;
    if (res.error) {
      this._mpError = res.error === 'busy' ? t('mp_err_could_not_create_room') : t('mp_err_offline');
      this._lobby = null;
      this.renderSetup();
      return;
    }
    this._mpPendingCode = res.code;
    net.heartbeat(res.code, 'host');
    await net.onRoom(res.code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;
    this.renderSetup();
  }

  /** Host taps Start in the lobby: the room has a guest, so game 1 of the series begins. */
  _mpHostStartMatch() {
    const room = this._mpLobbyRoom;
    if (!room || !room.guest || this.mp || this._mpBusy) return;
    this.mp = this._mpNewState('host', this._mpPendingCode, room.guest);
    this._lobby = null;
    this._mpStartNextGame();
  }

  async _mpJoinSubmit() {
    if (this._mpBusy) return;
    const code = this._mpJoinCode;
    if (code.length !== MP_CODE_LEN) return;
    this._mpBusy = true; this._mpError = '';
    this._syncMpMsgSlot();
    const res = await net.joinRoom(code, this._myIdentity());
    this._mpBusy = false;
    if (this._dead) return;
    if (res.error) {
      this._mpError = res.error === 'not-found' ? t('mp_err_room_not_found')
        : res.error === 'full' ? t('mp_err_room_full')
        : res.error === 'version' ? 'version'
        : t('mp_err_offline');
      this.renderSetup();
      return;
    }
    // net.js is game-agnostic, so a wrong-game join must be caught client-side.
    if (res.room && res.room.game && res.room.game !== 'mancala') {
      this._mpError = t('mp_err_wrong_game');
      this.renderSetup();
      return;
    }
    this._mpPendingCode = code;
    this._mpJoinedCode = code;
    this._lobby = 'join';        // only now: a failed attempt stays on the Join screen
    net.heartbeat(code, 'guest');
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;
    this._mpLobbyRoom = res.room;
    this.renderSetup();
    if (res.room && res.room.status === 'active' && res.room.round) this._mpGuestStartMatch(res.room);
  }

  _mpGuestStartMatch(room) {
    if (this.mp || this._dead || !room || !room.round) return;
    this.mp = this._mpNewState('guest', this._mpJoinedCode, room.host);
    this._lobby = null;
    this._mpApplyRoundRecord(room.round, room);
  }

  _mpCancelLobby() {
    const code = this._mpPendingCode;
    const role = this._lobby === 'host' ? 'host' : 'guest';
    this._lobby = null;
    this._mpError = ''; this._mpBusy = false; this._mpJoinCode = '';
    this._mpPendingCode = null; this._mpJoinedCode = null; this._mpLobbyRoom = null;
    if (code) net.leaveRoom(code, role).catch(() => {});
    else net.disconnect();
    this.renderSetup();
  }

  /** Explicit abandon (the in-game/end-card Leave button), unlike destroy()'s
   *  backgrounding: this ends the room for the opponent too. */
  _mpLeaveToSetup() {
    const mp = this.mp;
    this.mp = null;
    this._mpClearSave();
    this._lobby = null; this._mode = 'solo';
    this._mpPendingCode = null; this._mpJoinedCode = null; this._mpLobbyRoom = null;
    this._mpStatusMsg = '';
    if (mp && mp.code) net.leaveRoom(mp.code, mp.role).catch(() => {});
    else net.disconnect();
    this.renderSetup();
  }

  async _mpEndDueToError() {
    if (this._dead || !this.mp) return;
    const mp = this.mp;
    this.mp = null;
    this._mpClearSave();
    this._mpStatusMsg = '';
    if (mp.code) { try { await net.leaveRoom(mp.code, mp.role); } catch { /* best-effort */ } }
    else net.disconnect();
    if (this._dead) return;
    this._mpEndModal('mp_error_title', 'mp_error_sub');
  }

  _mpEndDueToOpponentLeft() {
    if (this._dead || !this.mp) return;
    this.mp = null;
    this._mpClearSave();
    this._mpStatusMsg = '';
    net.stopHeartbeat();
    this._mpEndModal('mp_opponent_left_title', 'mp_opponent_left_sub');
  }

  /** Terminal MP overlay. An abandoned or desynced game is deliberately NOT recorded as a
   *  result: it was not played to a conclusion, and inventing a win or a loss for it would be
   *  fabricating history. */
  _mpEndModal(titleKey, subKey) {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'mc-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="mc-scrim"></div>
      <div class="mc-card" role="dialog" aria-modal="true" aria-label="${t(titleKey)}">
        <button type="button" class="mc-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="mc-card-emoji">📡</span>
        <h3 class="mc-card-title">${t(titleKey)}</h3>
        <p class="mc-card-score">${t(subKey)}</p>
        <div class="mc-card-actions">
          <button type="button" class="mc-primary" data-action="mp-end-ok">${t('mp_back_to_setup')}</button>
        </div>
      </div>`;
    this.container.querySelector('.mancala').appendChild(overlay);
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave -------------------------------------------------------------

  /** Written from the post-move funnel after EVERY settled move (finishMove), and again after
   *  a game concludes (finish(), for the statsCommitted flag). `seq` is read AFTER the move's
   *  own MP bookkeeping (see finishMove's ordering note): the saved seq always matches the
   *  move already inside the saved state, so a rejoin replays only genuinely new entries. */
  _mpSaveSnapshot() {
    const mp = this.mp;
    if (!mp || !this.state) return;
    try {
      localStorage.setItem(MP_SAVE_KEY, JSON.stringify({
        v: 1,
        code: mp.code, role: mp.role,
        seq: mp.appliedSeq | 0,
        at: Date.now(),
        gameNum: mp.gameNum | 0,
        nextDealer: mp.nextDealer,
        series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
        lastScoredGame: mp.lastScoredGame | 0,
        statsCommitted: !!this._statsCommitted,
        state: this.state,
      }));
    } catch { /* private mode / quota */ }
  }

  /** Read back the MP save, or null. A stale one (older than the rejoin window) is wiped here
   *  rather than restored. */
  _mpLoadSave() {
    try {
      const raw = JSON.parse(localStorage.getItem(MP_SAVE_KEY) || 'null');
      if (!raw || raw.v !== 1 || !raw.code || !raw.state) return null;
      if (raw.role !== 'host' && raw.role !== 'guest') return null;
      if (!validMpBoardState(raw.state)) { this._mpClearSave(); return null; }
      if (Date.now() - (raw.at || 0) > MP_RESTORE_MAX_AGE_MS) { this._mpClearSave(); return null; }
      return raw;
    } catch { return null; }
  }

  _mpClearSave() { try { localStorage.removeItem(MP_SAVE_KEY); } catch { /* ignore */ } }

  /** Backgrounding/restore: an MP autosave younger than 30 minutes, with the room still alive,
   *  reattaches to the same room and replays whatever landed while this device was away,
   *  instead of dropping the player back on a blank setup screen. Runs once, right after
   *  mount(). Since a boundary save's `state.over` is always true, no separate "waiting for the
   *  next game" branch is needed here the way tic-tac-toe/js/ui.js's restore has one -- the
   *  saved position IS the finished game, and either it is still live (drain the tail) or it
   *  already finished (show the result once more; finish()'s own `_statsCommitted`/
   *  `lastScoredGame` guards keep this idempotent, including for the series tally). A guest
   *  waiting on the NEXT game's round record after restoring simply gets it the ordinary way,
   *  through `_mpOnRoomUpdate`'s roundN > gameNum branch, once the host publishes it -- no
   *  separate await path needed. */
  async _tryRestoreMP(save) {
    const { code, role } = save;
    try {
      if (role === 'guest') {
        const res = await net.joinRoom(code, this._myIdentity());
        if (res.error || (res.room && res.room.status === 'ended')) { this._mpClearSave(); return; }
      } else if (!(await net.init())) return;
    } catch { return; }
    if (this._dead || this.mp || this.view === 'game') return;   // superseded by a faster user action

    this.mp = this._mpNewState(role, code, null);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.nextDealer = save.nextDealer === P2 ? P2 : P1;
    // The series tally is carried through UNTOUCHED, same as tic-tac-toe/js/ui.js's restore:
    // a restore that zeroed it would be the initMatch-wipe failure shape from js/CLAUDE.md's
    // invariant 5, translated to this game's vocabulary.
    mp.series = this._mpNormalizeSeries(save.series);
    mp.lastScoredGame = save.lastScoredGame | 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.state = {
      pits: save.state.pits.slice(), turn: save.state.turn,
      over: !!save.state.over, winner: save.state.winner == null ? null : save.state.winner,
    };
    this._statsCommitted = !!save.statsCommitted;
    this.view = 'game';
    this.busy = false;
    this.movesMade = mp.appliedSeq;
    net.heartbeat(code, role);
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;
    this.renderGame();

    if (this.state.over) { this.finish(); return; }
    this._mpTryDeliverNextMove();
  }

  // --- events ----------------------------------------------------------------

  onClick(e) {
    const pitBtn = e.target.closest('.mc-pit');
    if (pitBtn && this.container.contains(pitBtn) && this.view === 'game') {
      if (this.busy || !this.state || this.state.over) return;
      if (this.mp && this.mp.awaitingRecovery) return;
      const pit = Number(pitBtn.dataset.pit);
      const humanSide = this._humanSide();
      if (ownerOf(pit) !== humanSide || this.state.turn !== humanSide) return;
      if (this.state.pits[pit] === 0) return;
      if (this.mp) this._mpAfterLocalMove(pit);   // BEFORE the funnel's autosave (invariant 4)
      this.playMove(pit);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.container.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'level') {
      this.level = Number(btn.dataset.level) || 2;
      this.container.querySelectorAll('[data-action="level"]').forEach((el) => {
        const on = Number(el.dataset.level) === this.level;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-checked', String(on));
      });
      this.persistSettings();
    } else if (action === 'speed') {
      this.speed = btn.dataset.speed === 'slow' ? 'slow' : 'normal';
      this.speedFactor = this.speed === 'slow' ? 2 : 1;
      this.container.querySelectorAll('[data-action="speed"]').forEach((el) => {
        const on = el.dataset.speed === this.speed;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-checked', String(on));
      });
      this.persistSettings();
    } else if (action === 'speed-toggle') {
      // In-game toggle: flip the speed and relabel in place. No re-render, so
      // the board and the match are untouched.
      this.speed = this.speed === 'slow' ? 'normal' : 'slow';
      this.speedFactor = this.speed === 'slow' ? 2 : 1;
      const label = this.container.querySelector('[data-role="speedbtn"]');
      if (label) label.innerHTML = this.speed === 'slow' ? '½&times;' : '1&times;';
      this.toast(this.speed === 'slow' ? t('speed_slow') : t('speed_normal'));
      this.persistSettings();
    } else if (action === 'resume') {
      const saved = loadGame();
      if (saved) this.resumeGame(saved); else this.startGame('bot');
    } else if (action === 'start-bot') {
      this.startGame('bot');
    } else if (action === 'start-friend') {
      this.startGame('friend');
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame(this.mode);
    } else if (action === 'restart') {
      this.closeOverlays();
      this.startGame(this.mode);
    } else if (action === 'newgame') {
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'ht-close') {
      this.closeOverlays();
    } else if (action === 'ht-next') {
      if (this._howTo) this._howTo.next();
    } else if (action === 'ht-first') {
      if (this._howTo) this._howTo.first();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
    } else if (action === 'set-mode') {
      this._mode = btn.dataset.v;
      this._mpError = '';
      this.renderSetup();
    } else if (action === 'mp-host') {
      this._mpHostCreate();
    } else if (action === 'mp-start') {
      this._mpHostStartMatch();
    } else if (action === 'mp-join-submit') {
      this._mpJoinSubmit();
    } else if (action === 'mp-cancel') {
      this._mpCancelLobby();
    } else if (action === 'mp-next-game') {
      this.closeOverlays();
      this._mpStartNextGame();
    } else if (action === 'mp-leave') {
      this.closeOverlays();
      this._mpLeaveToSetup();
    } else if (action === 'mp-update-required') {
      this._mpForceUpdate();
    } else if (action === 'mp-end-ok') {
      this.closeOverlays();
      this.renderSetup();
    }
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new MancalaUI(container);
  return instance;   // test hook (see test-mancala-stats.mjs); hub.js's `m.init(el)` ignores it
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** The hub shows a "progress will be lost" confirm when this is true. SOLO play saves an
 *  unfinished game on teardown and resumes it on the next mount, so leaving costs nothing and
 *  the warning would be a lie: false, even mid-game. MULTIPLAYER is the exception within the
 *  exception (same as Chinchón/Escoba/Tic Tac Toe): leaving is consequential for the live
 *  opponent (their room goes stale) even though this device could rejoin, so the confirm IS
 *  wanted -- true for as long as a room is joined. */
export function isInProgress() {
  return !!(instance && instance.mp);
}

export default { init, destroy, isInProgress };
