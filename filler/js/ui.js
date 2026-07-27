// ui.js - Filler UI module. Hub contract:
//   init(container)  - mount the game into a DOM element
//   destroy()        - tear down listeners and state
//
// Colorblind-safe by construction: every one of the six colors is always
// paired with its own shape glyph (circle, triangle, square, diamond, star,
// cross), on the board tiles, the color buttons, and the HUD swatches, so no
// information is ever carried by hue alone.

import {
  COLS, ROWS, TILES, COLOR_COUNT, P1, P2, P1_START, P2_START,
  newGame, cloneGame, legalColors, applyMove, territoryDistances,
} from './game.js';
import { chooseColor } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.filler.v1';
const GAME_KEY = 'gamehub.filler.save.v1';   // the one in-progress solo game (see saveGame)
// The MULTIPLAYER autosave, a THIRD key, distinct from both of the above and never read or
// written by either of the other two paths (THE LAW rule 5: permanent once shipped). Follows
// Chinchon's/Tic Tac Toe's/Mancala's separate-key choice, not Escoba's mp-sub-object shape.
const MP_SAVE_KEY = 'gamehub.filler.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// The difficulty bucket a MULTIPLAYER result records under -- settled by Tic Tac Toe
// (js/CLAUDE.md, "The third consumer: Tic Tac Toe"; HANDOFF-MP-WEB-SESSION.md touchpoint 5),
// followed since by Mancala. A real human opponent has no AI tier; 'mp' is unmapped in
// js/difficulty-tiers.js, so tierOf() returns null and the play counts in every total/the
// leaderboard's "All" filter with no tier pill. Follow it -- a second convention here would
// split one player's MP history across two bucket names for no benefit.
const MP_DIFFICULTY = 'mp';

// Index order matches the engine's color ids 0..5. `labelKey` doubles as the
// accessible name; it names the shape too, so screen reader output is also
// hue-independent.
const COLOR_META = [
  { key: 'yellow', labelKey: 'color_yellow' },
  { key: 'blue', labelKey: 'color_blue' },
  { key: 'vermilion', labelKey: 'color_vermilion' },
  { key: 'teal', labelKey: 'color_teal' },
  { key: 'purple', labelKey: 'color_purple' },
  { key: 'pink', labelKey: 'color_pink' },
];

const LEVELS = [
  { level: 1, key: 'beginner', labelKey: 'diff_beginner' },
  { level: 2, key: 'intermediate', labelKey: 'diff_intermediate' },
  { level: 3, key: 'pro', labelKey: 'diff_pro' },
];
const LEVEL_KEY = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const AI_THINK_MS = 550;      // pause before the AI plays, so turns read clearly
const RIPPLE_STEP_MS = 16;    // per-BFS-ring delay of the recolor ripple
// Pacing beat after a REMOTE move's ripple settles, before the drain loop checks for the next
// entry (mirrors mancala/js/ui.js's async delivery gap). This is exactly the window the
// redeliverRequested latch below exists to cover -- see _mpTryDeliverNextMove's comment.
const MP_DELIVER_SETTLE_MS = 150;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Deterministic seeded PRNG (mulberry32), same construction used elsewhere in this repo for
 *  test-authoring seeds. The HOST rolls a fresh 32-bit seed per game and transmits it (never the
 *  board itself) via the room's round.deck field; both sides call newGame(mulberry32(seed))
 *  locally and reach byte-identical boards. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureStylesheet() {
  const href = new URL('../css/filler.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/filler.css'));
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
      const lvl = Math.round(Number(raw.level));
      const out = {};
      if (lvl >= 1 && lvl <= 3) out.level = lvl;
      // nextStarter: additive field (2026-07-24) - who opens the next game,
      // silently alternated each game. Absent on a fresh install/pre-existing
      // store, which defaults to P1 (the human), matching prior behavior.
      if (raw.nextStarter === P2 || raw.nextStarter === P1) out.nextStarter = raw.nextStarter;
      return Object.keys(out).length ? out : null;
    }
  } catch { /* treat as no settings */ }
  return null;
}

function saveSettings(level, nextStarter) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level, nextStarter })); } catch { /* ignore */ }
}

/** Persist the in-progress SOLO game so leaving (hub back, a reload, or closing the
 *  PWA) never loses it. Only ever holds ONE unfinished game; cleared the
 *  moment it finishes or a new one starts (mirrors mancala/js/ui.js's
 *  saveGame/loadGame/clearGame). Typed arrays are flattened to plain arrays
 *  for JSON. MP never writes this slot (mirrors mancala/js/ui.js's saveGame). */
function saveGame(ui) {
  try {
    if (ui.mp) return;
    if (!ui.state || ui.state.over || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      colors: Array.from(ui.state.colors),
      owner: Array.from(ui.state.owner),
      turn: ui.state.turn,
      counts: ui.state.counts,
      current: ui.state.current,
      moves: ui.state.moves,
      dryMoves: ui.state.dryMoves,
      level: ui.level,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard: a corrupt or non-standard
 *  board is treated as "no saved game" rather than crashing the module. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (!Array.isArray(raw.colors) || raw.colors.length !== TILES) return null;
    if (!Array.isArray(raw.owner) || raw.owner.length !== TILES) return null;
    const colors = Uint8Array.from(raw.colors.map((n) => Math.round(Number(n))));
    if (!colors.every((n) => n >= 0 && n < COLOR_COUNT)) return null;
    const owner = Uint8Array.from(raw.owner.map((n) => Math.round(Number(n))));
    if (!owner.every((n) => n === 0 || n === P1 || n === P2)) return null;
    // The two starting corners must still belong to their own player - a
    // structural invariant of every legal Filler position.
    if (owner[P1_START] !== P1 || owner[P2_START] !== P2) return null;
    if (!Array.isArray(raw.counts) || raw.counts.length !== 3) return null;
    if (!Array.isArray(raw.current) || raw.current.length !== 3) return null;
    const lvl = Math.round(Number(raw.level));
    return {
      colors,
      owner,
      turn: raw.turn === P2 ? P2 : P1,
      counts: raw.counts.map((n) => Math.max(0, Math.round(Number(n)) || 0)),
      current: raw.current.map((n) => Math.round(Number(n)) || 0),
      moves: Math.max(0, Math.round(Number(raw.moves)) || 0),
      dryMoves: Math.max(0, Math.round(Number(raw.dryMoves)) || 0),
      over: false,
      winner: 0,
      level: lvl >= 1 && lvl <= 3 ? lvl : 2,
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

/** Shared hard validation for any restored engine state (MP autosave, recovery snapshot).
 *  A corrupt or non-standard board is treated as "invalid" rather than crashing the module. */
function validMpBoardState(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Array.isArray(s.colors) || s.colors.length !== TILES) return false;
  if (!Array.isArray(s.owner) || s.owner.length !== TILES) return false;
  if (!s.colors.every((n) => Number.isInteger(n) && n >= 0 && n < COLOR_COUNT)) return false;
  if (!s.owner.every((n) => n === 0 || n === P1 || n === P2)) return false;
  if (s.owner[P1_START] !== P1 || s.owner[P2_START] !== P2) return false;
  return s.turn === P1 || s.turn === P2;
}

function mpStateFromPlain(snap) {
  return {
    colors: Uint8Array.from(snap.colors),
    owner: Uint8Array.from(snap.owner),
    turn: snap.turn === P2 ? P2 : P1,
    counts: snap.counts.slice(),
    current: snap.current.slice(),
    over: !!snap.over,
    winner: snap.winner | 0,
    moves: snap.moves | 0,
    dryMoves: snap.dryMoves | 0,
  };
}

function plainFromState(s) {
  return {
    colors: Array.from(s.colors),
    owner: Array.from(s.owner),
    turn: s.turn,
    counts: s.counts.slice(),
    current: s.current.slice(),
    over: s.over,
    winner: s.winner,
    moves: s.moves,
    dryMoves: s.dryMoves,
  };
}

class FillerUI {
  constructor(container) {
    this.container = container;

    // Identity + difficulty prefill. Precedence: this game's own last-used
    // settings, then the shared profile, then built-in defaults.
    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const saved = loadSettings();
    this.level = (saved && saved.level) || (opp && opp.skill) || 2;
    // Silently alternate who opens each SOLO game (no setup UI for this - see
    // filler/CLAUDE.md). Defaults to P1 (the human) when absent, matching
    // pre-existing behavior for anyone with a pre-alternation settings store.
    this.nextStarter = (saved && saved.nextStarter) || P1;
    this.humanName = (profile && profile.name) || t('you');
    this.humanEmoji = (profile && profile.emoji) || '🙂';
    this.oppName = (opp && opp.name) || t('computer');
    this.oppEmoji = (opp && opp.emoji) || '🤖';

    this.state = null;
    this.busy = false;        // true while a move animates or the AI thinks
    this.view = 'setup';
    this.tiles = [];          // tile elements by board index
    this.timers = [];
    this.motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._dead = false;
    this._statsCommitted = false;

    // Multiplayer session state, or null in solo. Everything MP-specific hangs off this one
    // field, so `if (this.mp)` is the whole mode test (mirrors mancala/js/ui.js,
    // tic-tac-toe/js/ui.js).
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

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };

    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    this.container.addEventListener('input', this._onInput);
    document.addEventListener('keydown', this._onKey);

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
    // Leaving mid-game keeps the board (checkpointed after every settled
    // move); this is a belt-and-braces save in case a move was still
    // in-flight, mirroring mancala/js/ui.js's destroy().
    this._dead = true;
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearTimeout(this._confirmTimer);
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
    this.container.innerHTML = '';
    this.state = null;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  sleep(ms) { return new Promise((res) => this.later(res, ms)); }

  // --- seats -------------------------------------------------------------------
  //
  // Host = P1 (bottom-left corner), guest = P2 (top-right corner), FIXED for the whole room --
  // same deviation from the Tic Tac Toe template that mancala/js/ui.js states explicitly: these
  // corners are physically different fixed positions on the shared board (P1_START/P2_START),
  // not interchangeable marks, so which corner you sit at is fixed like a real board's fixed
  // seating; only who OPENS a given game alternates (mp.nextDealer, below). Every "self" lookup
  // goes through _localSeat() rather than assuming P1, or a guest would read the host's corner
  // as its own and record the host's result as its own (a THE LAW rule 2 violation).

  _localSeat() { return this.mp ? this.mp.localSeat : P1; }
  _remoteSeat() { return 3 - this._localSeat(); }   // P1=1, P2=2 (game.js): the other one.

  /** Who this device is, in js/net.js's room vocabulary. */
  _myIdentity() { return { name: this.humanName, avatar: this.humanEmoji, deviceId: deviceId() }; }

  /** Own identity always renders at the corner THIS device's seat physically occupies (host
   *  always sees itself at p1/bottom-left, guest always at p2/top-right), read through
   *  _localSeat(), never assumed -- same rule as mancala/js/ui.js's names(). */
  names() {
    if (this.mp) {
      const me = { name: this.humanName, emoji: this.humanEmoji };
      const oppInfo = this.mp.opp;
      const opp = { name: (oppInfo && oppInfo.name) || t('mp_opponent_label'), emoji: (oppInfo && oppInfo.avatar) || '🙂' };
      return this._localSeat() === P1 ? { p1: me, p2: opp } : { p1: opp, p2: me };
    }
    return {
      p1: { name: this.humanName, emoji: this.humanEmoji },
      p2: { name: this.oppName, emoji: this.oppEmoji },
    };
  }

  // --- shared bits -----------------------------------------------------------

  swatchHTML(color, cls = '') {
    return `<span class="fl-swatch ${cls}" data-color="${color}" role="img" aria-label="${t(COLOR_META[color].labelKey)}"></span>`;
  }

  // --- setup view ------------------------------------------------------------

  _logoBlock() {
    return `<div class="fl-logo" aria-hidden="true">
        ${[0, 2, 4, 1, 3].map((c) => `<span class="fl-swatch fl-logo-tile" data-color="${c}"></span>`).join('')}
      </div>
      <h2 class="fl-title">${t('title')}</h2>
      <p class="fl-sub">${t('tagline')}</p>`;
  }

  _modeSeg() {
    return `<div class="fl-field">
      <div class="fl-seg" role="radiogroup" aria-label="${t('title')}">
        ${[['solo', t('mode_solo')], ['host', t('mode_host')], ['join', t('mode_join')]].map(([v, lbl]) => `
          <button type="button" class="fl-segbtn${this._mode === v ? ' is-active' : ''}"
            data-action="set-mode" data-v="${v}" role="radio" aria-checked="${this._mode === v}">${lbl}</button>`).join('')}
      </div>
    </div>`;
  }

  renderSetup() {
    this.view = 'setup';
    this.state = null;

    if (this._lobby) {
      this.container.innerHTML = `<div class="filler"><div class="fl-shell fl-setup">${this._logoBlock()}${this._lobbyHTML()}</div></div>`;
      return;
    }
    if (this._mode === 'join') {
      this.container.innerHTML = `<div class="filler"><div class="fl-shell fl-setup">${this._logoBlock()}${this._modeSeg()}${this._joinBodyHTML()}
        <button type="button" class="fl-ghost" data-action="help">${t('howto')}</button>
      </div></div>`;
      return;
    }

    const hosting = this._mode === 'host';
    this.container.innerHTML = `
      <div class="filler">
        <div class="fl-shell fl-setup">
          ${this._logoBlock()}
          ${this._modeSeg()}

          ${hosting ? '' : `<div class="fl-vscard">
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.humanEmoji)}</span>
              <span class="fl-vsname">${esc(this.humanName)}</span>
            </div>
            <span class="fl-vslabel">${t('vs')}</span>
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.oppEmoji)}</span>
              <span class="fl-vsname">${esc(this.oppName)}</span>
            </div>
          </div>`}

          ${hosting ? '' : `<div class="fl-field">
            <span class="fl-fieldlabel" id="fl-difflabel">${t('difficulty')}</span>
            <div class="fl-seg" role="radiogroup" aria-labelledby="fl-difflabel">
              ${LEVELS.map((l) => `
                <button type="button" class="fl-segbtn${l.level === this.level ? ' is-active' : ''}"
                  data-action="level" data-level="${l.level}" role="radio"
                  aria-checked="${l.level === this.level}">${diffShapeSVG(tierOf(l.key))}${t(l.labelKey)}</button>`).join('')}
            </div>
          </div>`}

          ${hosting
            ? `<p class="fl-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
               <button type="button" class="fl-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`
            : `<button type="button" class="fl-primary" data-action="start">${t('start')}</button>`}
          <button type="button" class="fl-ghost" data-action="help">${t('howto')}</button>
        </div>
      </div>`;
  }

  /** Join mode's body: the code input lives on the setup screen itself, never its own
   *  pre-join screen -- _lobby only switches to 'join' once the join has actually succeeded
   *  (see _mpJoinSubmit). Mirrors mancala/js/ui.js's Join mode. */
  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="fl-mp-msg fl-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="fl-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : t('mp_join_hint')))}</p>`;
    return `<div class="fl-mp-lobby">
      <span class="fl-mp-label">${t('mp_enter_code')}</span>
      <input class="fl-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}"
        autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="fl-primary" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = `<button type="button" class="fl-ghost" data-action="mp-cancel">${t('mp_back_btn')}</button>`;
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="fl-mp-lobby">
        <span class="fl-mp-label">${t('mp_code_aria')}</span>
        <div class="fl-mp-code">${code ? esc(code) : '····'}</div>
        <span class="fl-mp-label">${t('mp_opponent_label')}</span>
        <div class="fl-mp-oppslot">${guest
          ? `<span>${esc(guest.avatar || '🙂')}</span><span>${esc(guest.name || '')}</span>`
          : `<span class="fl-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="fl-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="fl-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    return `<div class="fl-mp-lobby">
      <span class="fl-mp-label">${t('mp_code_aria')}</span>
      <div class="fl-mp-code">${esc(this._mpJoinedCode || '')}</div>
      <span class="fl-mp-label">${t('mp_host_label')}</span>
      <div class="fl-mp-oppslot">${host
        ? `<span>${esc(host.avatar || '🙂')}</span><span>${esc(host.name || '')}</span>`
        : `<span class="fl-mp-oppempty">—</span>`}</div>
      <p class="fl-mp-msg" data-role="mp-msg">${t('mp_waiting_host')}</p>
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

  startGame() {
    // Alternate the opening move every new SOLO game (including Restart), then
    // bank the flip immediately so it survives leaving mid-game (mirrors
    // mancala/js/ui.js's startGame()). The engine itself always constructs
    // state with P1 to move; when the AI is due to open, we hand it the
    // turn right after construction and kick off its move automatically.
    const starter = this.nextStarter === P2 ? P2 : P1;
    this.nextStarter = starter === P1 ? P2 : P1;
    saveSettings(this.level, this.nextStarter);
    clearGame();                 // a new game replaces any saved one
    this.state = newGame();
    if (starter === P2) this.state.turn = P2;
    this.view = 'game';
    this.busy = false;
    this.renderGame();
    saveGame(this);
    // When the AI opens, the existing per-turn status line ("{opp} is
    // thinking...") already announces it - no separate banner needed.
    if (starter === P2) this.later(() => this.aiMove(), AI_THINK_MS);
  }

  /** Rebuild the board from a saved SOLO game and hand the turn back to whoever
   *  had it. Mirrors mancala/js/ui.js's resumeGame(). */
  resumeGame(saved) {
    this.level = saved.level;
    this.state = {
      colors: saved.colors,
      owner: saved.owner,
      turn: saved.turn,
      counts: saved.counts,
      current: saved.current,
      over: false,
      winner: 0,
      moves: saved.moves,
      dryMoves: saved.dryMoves,
    };
    this.view = 'game';
    this.busy = false;
    this.renderGame();
    // If we left while the AI was on move (its turn had already been
    // handed over but it hadn't played yet), it picks up where it left off.
    if (this.state.turn === P2) this.later(() => this.aiMove(), AI_THINK_MS);
  }

  renderGame() {
    const s = this.state;
    const n = this.names();
    this.container.innerHTML = `
      <div class="filler">
        <div class="fl-shell fl-game">
          <header class="fl-hud">
            <div class="fl-player fl-p1" data-role="card-1">
              <span class="fl-pemoji">${esc(n.p1.emoji)}</span>
              <span class="fl-pmeta">
                <span class="fl-pname">${esc(n.p1.name)}</span>
                <span class="fl-pcount"><b data-role="count-1">1</b> ${t('tiles_suffix')}</span>
              </span>
              <span data-role="swatch-1">${this.swatchHTML(s.current[P1], 'fl-hudswatch')}</span>
            </div>
            <div class="fl-player fl-p2" data-role="card-2">
              <span data-role="swatch-2">${this.swatchHTML(s.current[P2], 'fl-hudswatch')}</span>
              <span class="fl-pmeta">
                <span class="fl-pname">${esc(n.p2.name)}</span>
                <span class="fl-pcount"><b data-role="count-2">1</b> ${t('tiles_suffix')}</span>
              </span>
              <span class="fl-pemoji">${esc(n.p2.emoji)}</span>
            </div>
          </header>

          <div class="fl-progress" data-role="progress" aria-hidden="true">
            <span class="fl-prog-1" data-role="prog-1"></span>
            <span class="fl-prog-2" data-role="prog-2"></span>
            <span class="fl-prog-mid"></span>
          </div>

          <p class="fl-status" data-role="status" aria-live="polite"></p>

          <div class="fl-board" role="img" aria-label="${t('board_aria')}" data-role="board">
            ${Array.from({ length: TILES }, (_, i) => `
              <span class="fl-tile" data-i="${i}" data-color="${s.colors[i]}">${
                i === P1_START ? `<span class="fl-flag fl-flag-1">${esc(n.p1.emoji)}</span>`
                : i === P2_START ? `<span class="fl-flag fl-flag-2">${esc(n.p2.emoji)}</span>` : ''
              }</span>`).join('')}
          </div>

          <div class="fl-colors" data-role="colors" aria-label="${t('pick_color_aria')}">
            ${COLOR_META.map((m, i) => `
              <button type="button" class="fl-cbtn" data-action="pick" data-color="${i}"
                aria-label="${t(m.labelKey)}"><span class="fl-hold" data-role="hold-${i}" hidden></span></button>`).join('')}
          </div>

          <footer class="fl-bar">
            <button type="button" class="fl-ghost fl-small" data-action="help">${t('howto')}</button>
            ${this.mp
              ? `<button type="button" class="fl-ghost fl-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
              : `<button type="button" class="fl-ghost fl-small" data-action="restart" data-role="restart">${t('restart_game')}</button>
                 <button type="button" class="fl-ghost fl-small" data-action="newgame">${t('new_game')}</button>`}
          </footer>
        </div>
      </div>`;

    const boardEl = this.container.querySelector('[data-role="board"]');
    this.tiles = [...boardEl.querySelectorAll('.fl-tile')];
    this.refresh();
  }

  /** Sync HUD, progress bar, status line, and button states from the engine. */
  refresh() {
    const s = this.state;
    const n = this.names();
    const q = (sel) => this.container.querySelector(sel);
    q('[data-role="count-1"]').textContent = s.counts[P1];
    q('[data-role="count-2"]').textContent = s.counts[P2];
    q('[data-role="swatch-1"]').innerHTML = this.swatchHTML(s.current[P1], 'fl-hudswatch');
    q('[data-role="swatch-2"]').innerHTML = this.swatchHTML(s.current[P2], 'fl-hudswatch');
    q('[data-role="prog-1"]').style.width = `${(s.counts[P1] / TILES) * 100}%`;
    q('[data-role="prog-2"]').style.width = `${(s.counts[P2] / TILES) * 100}%`;
    q('[data-role="prog-1"]').dataset.color = s.current[P1];
    q('[data-role="prog-2"]').dataset.color = s.current[P2];
    q('[data-role="card-1"]').classList.toggle('is-turn', !s.over && s.turn === P1);
    q('[data-role="card-2"]').classList.toggle('is-turn', !s.over && s.turn === P2);

    const mpBlocked = !!(this.mp && this.mp.awaitingRecovery);
    const humanTurn = s.turn === this._localSeat();
    const status = q('[data-role="status"]');
    // An MP status (resyncing/opponent disconnected/connection error) outranks the ordinary
    // turn text and reuses the same slot rather than adding new DOM (mirrors mancala/js/ui.js).
    if (this.mp && this._mpStatusMsg) {
      status.textContent = t(this._mpStatusMsg);
    } else if (s.over) {
      status.textContent = t('game_over');
    } else if (this.mp) {
      status.textContent = humanTurn ? t('your_turn') : t('mp_opp_turn', { opp: n[s.turn === P1 ? 'p1' : 'p2'].name });
    } else {
      status.textContent = humanTurn ? t('your_turn') : t('opp_thinking', { opp: this.oppName });
    }

    for (let i = 0; i < COLOR_META.length; i++) {
      const btn = q(`[data-action="pick"][data-color="${i}"]`);
      const hold = q(`[data-role="hold-${i}"]`);
      const holder = s.current[P1] === i ? P1 : s.current[P2] === i ? P2 : 0;
      const blocked = holder !== 0;
      btn.disabled = blocked || s.over || !humanTurn || this.busy || mpBlocked;
      btn.classList.toggle('is-held', blocked);
      hold.hidden = !blocked;
      hold.textContent = holder === P1 ? n.p1.emoji : holder === P2 ? n.p2.emoji : '';
    }
  }

  // --- moves + animation -----------------------------------------------------

  humanMove(color) {
    const s = this.state;
    if (this.busy || !s || s.over) return;
    if (this.mp) {
      if (this.mp.awaitingRecovery || s.turn !== this._localSeat()) return;
    } else if (s.turn !== P1) return;
    if (legalColors(s).indexOf(color) < 0) return;
    this.busy = true;
    // BEFORE the real move (invariant 4's ordering, mirrored from mancala/js/ui.js's onClick):
    // the seq is reserved and the move sent from a CLONE, so the real applyMove()/animation
    // below is unaffected by the network write.
    if (this.mp) this._mpAfterLocalMove(color);
    const mover = s.turn;
    const captured = applyMove(s, color);
    const rippleMs = this.animateMove(mover, color, captured);
    this.refresh();
    this._afterMove(rippleMs);
  }

  aiMove() {
    const s = this.state;
    if (!s || s.over) return;
    const color = chooseColor(s, this.level);
    const captured = applyMove(s, color);
    const rippleMs = this.animateMove(P2, color, captured);
    this.busy = false;
    this.refresh();
    saveGame(this);   // checkpoint after every settled move (clears itself once over)
    if (s.over) this.later(() => this.finish(), rippleMs + 350);
  }

  /** Single funnel after every LOCAL move (human tap, solo or MP). Mirrors
   *  mancala/js/ui.js's finishMove ordering note: the MP bookkeeping for this move
   *  (_mpAfterLocalMove, above) has ALREADY run by the time this saves, so the
   *  autosave's seq matches the move already inside its own snapshot. */
  _afterMove(rippleMs) {
    const s = this.state;
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);
    if (s.over) { this.later(() => this.finish(), rippleMs + 350); return; }
    if (this.mp) {
      this.later(() => {
        this.busy = false;
        this.refresh();
        this._mpTryDeliverNextMove();
      }, rippleMs + MP_DELIVER_SETTLE_MS);
      return;
    }
    this.later(() => this.aiMove(), rippleMs + AI_THINK_MS);
  }

  /** Recolor the mover's territory with a BFS ripple from their corner; newly
   *  captured tiles get a pop. Returns the ripple's total duration in ms. */
  animateMove(player, color, captured) {
    const s = this.state;
    const dist = territoryDistances(s, player);
    const isNew = new Set(captured);
    let maxD = 0;
    for (let i = 0; i < TILES; i++) {
      if (dist[i] < 0) continue;
      if (dist[i] > maxD) maxD = dist[i];
      const el = this.tiles[i];
      if (this.motionOK) el.style.transitionDelay = `${dist[i] * RIPPLE_STEP_MS}ms`;
      el.dataset.color = color;
      el.classList.toggle('is-owned', true);
      if (isNew.has(i) && this.motionOK) {
        el.style.animationDelay = `${dist[i] * RIPPLE_STEP_MS}ms`;
        el.classList.add('is-pop');
      }
    }
    const total = this.motionOK ? maxD * RIPPLE_STEP_MS + 240 : 0;
    this.later(() => {
      for (const el of this.tiles) {
        el.style.transitionDelay = '';
        el.style.animationDelay = '';
        el.classList.remove('is-pop');
      }
    }, total + 300);
    return total;
  }

  // --- end of game -----------------------------------------------------------

  finish() {
    const s = this.state;
    const n = this.names();
    const won = this.mp
      ? (s.winner === 0 ? null : s.winner === this._localSeat())
      : (s.winner === P1 ? true : s.winner === P2 ? false : null);

    // Both devices in a multiplayer match run this, and that is NOT double-counting:
    // gamehub.stats is keyed per PLAYER, so two devices each writing "I played one game" is two
    // different people each correctly getting one. Idempotence is _statsCommitted, set BEFORE
    // any write -- MP reaches this by more than one path (normal finish, a restore of an
    // already-finished game).
    if (!this._statsCommitted) {
      this._statsCommitted = true;
      if (this.mp) {
        try { recordResult('filler', MP_DIFFICULTY, won); } catch { /* never block the result */ }
        // Multiplayer only: capture WHO this was against while the room state is still live.
        // Never allowed to block the ordinary result from being recorded.
        const opp = this.mp.opp;
        if (opp) { try { recordHeadToHead('filler', opp, won); } catch { /* never block the result */ } }
      } else {
        try { recordResult('filler', LEVEL_KEY[this.level], won); } catch { /* never block the result */ }
      }
    }
    if (this.mp) this._mpAfterGameEnd();
    if (this.mp) this._mpSaveSnapshot();   // re-save with statsCommitted (and any series bump) set

    const oppName = this.mp ? (this._localSeat() === P1 ? n.p2.name : n.p1.name) : this.oppName;
    const oppEmoji = this.mp ? (this._localSeat() === P1 ? n.p2.emoji : n.p1.emoji) : this.oppEmoji;
    const title = won === true ? t('you_win') : won === false ? t('opp_wins', { opp: esc(oppName) }) : t('draw');
    const isHost = !!(this.mp && this.mp.role === 'host');
    const series = this.mp ? `<p class="fl-card-series">${esc(this._seriesLine())}</p>` : '';
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="fl-scrim" data-action="close-overlay"></div>
      <div class="fl-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="fl-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="fl-card-emoji">${won === true ? '🏆' : won === false ? esc(oppEmoji) : '🤝'}</span>
        <h3 class="fl-card-title">${title}</h3>
        <p class="fl-card-score">
          <span>${esc(n.p1.name)} <b>${s.counts[P1]}</b></span>
          <span class="fl-card-dash">:</span>
          <span><b>${s.counts[P2]}</b> ${esc(n.p2.name)}</span>
        </p>
        ${series}
        <div class="fl-card-actions">
          ${!this.mp
            ? `<button type="button" class="fl-primary" data-action="rematch">${t('play_again')}</button>
               <button type="button" class="fl-ghost" data-action="newgame">${t('change_difficulty')}</button>
               <button type="button" class="fl-ghost fl-small" data-action="close-overlay">${t('view_board')}</button>`
            : isHost
              ? `<button type="button" class="fl-primary" data-action="mp-next-game">${t('play_again')}</button>
                 <button type="button" class="fl-ghost fl-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
              : `<p class="fl-card-wait">${esc(t('mp_waiting_rematch', { opp: oppName }))}</p>
                 <button type="button" class="fl-ghost fl-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`}
        </div>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------
  //
  // Same shape as Tic Tac Toe's how-to-play sheet: one bold goal line, ONE
  // diagram of the single non-obvious mechanic, a plain-word caption, an
  // "X = Y" example, then at most a couple one-sentence bullets.

  /** BEFORE -> AFTER pair (2026-07-24 redo, HANDOFF-FB2-HOWTO2 item 3: Matt's "I don't get
   *  the line running through the squares" - the old diagram's connector arrows read as a
   *  mystery line). Left board: your territory (top-left, filled + glyph) with two teal
   *  cells adjacent to it outlined but not yet owned; a fourth cell (bottom-right, not
   *  adjacent) stays a different color and is unaffected either way. A fat arrow with a teal
   *  dot (the picked color) points to the right board, where the two teal cells have joined
   *  your territory (filled + glyph) and the unrelated cell is still untouched. */
  _floodDiagram() {
    const board = (ox, joined) => `
      <rect x="${ox}" y="10" width="60" height="60" rx="7" class="fl-dg-blue"/>
      <path d="M${ox + 30},26 ${ox + 44},50 ${ox + 16},50z" class="fl-dg-glyph"/>
      <rect x="${ox + 66}" y="10" width="60" height="60" rx="7" class="${joined ? 'fl-dg-blue' : 'fl-dg-target'}"/>
      ${joined ? `<path d="M${ox + 96},26 ${ox + 110},50 ${ox + 82},50z" class="fl-dg-glyph"/>` : ''}
      <rect x="${ox}" y="76" width="60" height="60" rx="7" class="${joined ? 'fl-dg-blue' : 'fl-dg-target'}"/>
      ${joined ? `<path d="M${ox + 30},92 ${ox + 44},116 ${ox + 16},116z" class="fl-dg-glyph"/>` : ''}
      <rect x="${ox + 66}" y="76" width="60" height="60" rx="7" class="fl-dg-tile"/>`;
    return `<svg class="fl-diagram" viewBox="0 0 332 146" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="fl-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fl-accent)"/>
        </marker>
      </defs>
      ${board(10, false)}
      ${board(196, true)}
      <path d="M142,73 L184,73" class="fl-dg-arrow" marker-end="url(#fl-dg-arrowhead)"/>
      <circle cx="163" cy="73" r="6" class="fl-dg-dot"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="fl-scrim" data-action="close-overlay"></div>
      <div class="fl-card fl-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="fl-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="fl-card-title">${t('howto')}</h3>
        <p class="fl-help-lead">${t('help_lead')}</p>
        <div class="fl-diagram-wrap">${this._floodDiagram()}</div>
        <div class="fl-help-lines">
          <p class="fl-help-caption">${t('help_caption')}</p>
          <p class="fl-help-example">${t('help_example')}</p>
        </div>
        <ul class="fl-help-bullets">
          <li>${t('help_bullet1')}</li>
          <li>${t('help_bullet2')}</li>
        </ul>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.fl-overlay').forEach((el) => el.remove());
  }

  // --- restart confirm guard --------------------------------------------------
  //
  // Same tap-again-to-confirm pattern as connect-four/js/ui.js's
  // confirmDestructive/resetConfirms: a mid-game Restart is destructive (it
  // discards the board in progress), so it needs a second confirming tap.
  // A finished game (or no game at all) restarts immediately, no confirm.

  confirmDestructive(btn, action) {
    if (!this.state || this.state.over) { action(); return; }
    if (btn.dataset.armed === '1') { this.resetConfirms(); action(); return; }
    this.resetConfirms();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = t('tap_again_confirm');
    btn.classList.add('is-confirm');
    this._confirmTimer = setTimeout(() => this.resetConfirms(), 3500);
  }

  resetConfirms() {
    clearTimeout(this._confirmTimer);
    const b = this.container.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  // ==========================================================================
  // Multiplayer
  //
  // Room protocol (js/net.js, unchanged): rooms/<CODE> with a seq-keyed move log both sides
  // append into, a `round` record the HOST publishes, a `recovery` field, and heartbeats. Two
  // roles only. One room hosts a rematch SERIES, same vocabulary as Tic Tac Toe/Mancala:
  // round.n is the game number, round.dealer is the seat that moves first in that game
  // (alternated by the host every game via mp.nextDealer -- see _mpStartNextGame). Sides
  // themselves never swap (host stays P1/bottom-left, guest stays P2/top-right for the whole
  // room -- see the seat note above); only who OPENS alternates.
  //
  // DEVIATION FROM THE HANDOFF'S LITERAL WORDING, stated explicitly: the handoff doc says "the
  // host can seed board generation deterministically -- transmit the SEED in room config".
  // room.config is fixed once at createRoom and this room hosts a REMATCH SERIES (a new board
  // seed per game, not one seed for the whole room), so the seed rides round.deck instead --
  // exactly the field Chinchon uses for its per-round deck order. round.deck is otherwise
  // unused by every other game on the roadmap; Filler is the first to give it a real payload.
  //
  // Move payload: a single color index (0-5), same shape as Tic Tac Toe's Classic variant /
  // Mancala's pit index.
  //
  // net.js's writeResult is deliberately NOT used, so status:'ended' unambiguously means
  // somebody abandoned the room (leaveRoom).
  // ==========================================================================

  /** Is `color` legal in the current state? The single legality gate, read by the local tap AND
   *  by every remote move before it is applied -- one gate for both seats is what makes a
   *  network-driven seat safe to add. */
  _isLegal(color) {
    if (!this.state || this.state.over) return false;
    return legalColors(this.state).indexOf(color) >= 0;
  }

  _mpNewState(role, code, opp) {
    return {
      role, code,
      // Fixed at match start and never re-derived: host = P1 (bottom-left), guest = P2
      // (top-right).
      localSeat: role === 'host' ? P1 : P2,
      // Who we are playing, `{ name, avatar, deviceId }` from the room. Null on the restore
      // path, where _mpOnRoomUpdate backfills it from the live room.
      opp: opp || null,
      gameNum: 0,
      // Host only: which seat opens the NEXT game of the series (flipped by
      // _mpStartNextGame every time it publishes a round). Game 1 opens with the
      // host (P1), matching solo's "very first game: you open" default.
      nextDealer: P1,
      // The running series tally, indexed DIRECTLY by seat value (P1=1, P2=2 in game.js, so
      // index 0 is simply unused) and NEVER device-relative -- same discipline as Tic Tac
      // Toe's/Mancala's mp.series.
      series: { wins: [0, 0, 0], draws: 0 },
      // Idempotence guard for _mpAfterGameEnd: finish() can run more than once for
      // the same game (a restore of an already-finished game).
      lastScoredGame: 0,
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      replayMode: false, recoveryAttempts: 0, delivering: false,
      // Set by a GUEST that has flagged a divergence: stops it consuming the log until the
      // host's snapshot lands (see _mpOnDivergence). Filler is flag-driven (no agent
      // interface), so it needs this latch explicitly -- without it, every subsequent room
      // update would re-deliver the same entry onto the already-diverged state.
      awaitingRecovery: false,
      // Set whenever a room update refreshes the move-log cache WHILE a drain is already in
      // flight (see _mpTryDeliverNextMove's comment): because delivery here is PACED to let
      // the flood-fill ripple settle (MP_DELIVER_SETTLE_MS) before the next entry is checked,
      // a fresh entry can land in that gap right after the drain loop's own "nothing left to
      // apply" check already ran on stale data -- the exact shape of the race
      // mancala/js/ui.js's redeliverRequested comment describes for its animated sow. Without
      // this flag that entry is silently dropped until some UNRELATED room update happens to
      // trigger a new drain, which may never come.
      redeliverRequested: false,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
    };
  }

  /** The move payload written to the room log. `g` is the game number this move belongs to:
   *  an entry from an earlier game of the series can never be consumed as this game's, no
   *  matter how a stale room snapshot is ordered (see _mpApplyNextEntry). */
  _mpEncodeMove(color) { return { t: 'move', g: this.mp.gameNum, c: color | 0 }; }
  _mpDecodeMove(m) { return m.c | 0; }

  /** Called immediately after a LOCAL move has been legality-checked, and always BEFORE the
   *  real applyMove()/animation (invariant 4). The seq is reserved SYNCHRONOUSLY (not after a
   *  network await) so nothing can race onto the same number. game.js's applyMove MUTATES its
   *  argument (unlike Mancala's pure applyMove), so the hash is computed from a CLONE
   *  (cloneGame) rather than the live state -- the real move is applied separately, a moment
   *  later, by the caller. */
  _mpAfterLocalMove(color) {
    const mp = this.mp;
    if (!mp) return;
    const trial = cloneGame(this.state);
    applyMove(trial, color);
    const seq = ++mp.appliedSeq;
    const h = stateHash(trial);
    net.appendMove(mp.code, mp.role, seq, this._mpEncodeMove(color), h)
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
  }

  /** Drain every deliverable entry from the cached log, ONE AT A TIME.
   *
   *  ASYNC, like mancala/js/ui.js's drain loop (not Tic Tac Toe's tight synchronous `while`):
   *  each remote move is animated with the same flood-fill ripple a local move gets (better UX,
   *  and the reason to route it through the real animation path at all), and a settle beat
   *  (MP_DELIVER_SETTLE_MS) runs before the next entry is even checked. The `delivering` flag
   *  turns re-entry into iteration rather than recursion; `redeliverRequested` covers the same
   *  microtask-gap race mancala/js/ui.js's field comment describes. */
  async _mpTryDeliverNextMove() {
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this._dead || !this.state) return;
    mp.delivering = true;
    mp.redeliverRequested = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await this._mpApplyNextEntry()) continue;
        if (mp.redeliverRequested) { mp.redeliverRequested = false; continue; }
        break;
      }
    } finally { mp.delivering = false; }
  }

  /** Apply the single log entry at appliedSeq+1 if it is present, legal and hash-consistent.
   *  Returns whether the drain should continue. Speculates on a CLONE (game.js's applyMove
   *  mutates its argument) so a mismatch never corrupts the live board before it is detected. */
  async _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    // Belt and braces against a stale log: an entry stamped with a different game number is
    // never this game's move.
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;
    const color = this._mpDecodeMove(entry.move);
    let agreed = this._isLegal(color);
    let trial = null;
    let captured = null;
    let mover = null;
    if (agreed) {
      mover = this.state.turn;
      trial = cloneGame(this.state);
      captured = applyMove(trial, color);
      agreed = stateHash(trial) === entry.h;
    }
    if (!agreed) return this._mpOnDivergence(seq);
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this.state = trial;
    this.busy = true;
    const rippleMs = this.animateMove(mover, color, captured);
    this.refresh();
    this._mpSaveSnapshot();
    if (this.state.over) {
      await this.sleep(rippleMs + 350);
      this.finish();
      return true;
    }
    await this.sleep(rippleMs + MP_DELIVER_SETTLE_MS);
    this.busy = false;
    this.refresh();
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
   *  same defensive shape as tic-tac-toe/js/ui.js's/mancala/js/ui.js's _mpNormalizeSeries. */
  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [0, w[1] | 0, w[2] | 0], draws: (s && s.draws) | 0 };
  }

  /** The full-state snapshot the host publishes for recovery, and the payload shape the MP
   *  autosave stores. Nothing device-relative: `state` is the absolute board (colors[]/owner[]
   *  are positional, never "my side first"), and a receiver derives its own side from
   *  _localSeat(), never from anything in this object. `nextDealer`/`series` are seat-indexed
   *  for the same reason. */
  _mpSnapshot() {
    const mp = this.mp;
    return {
      v: 1, gameNum: mp.gameNum, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: plainFromState(this.state),
    };
  }

  /** Guest side of a resync: rebuild wholesale from the host's snapshot. Unlike the animated
   *  move path, recovery snaps directly to the recovered board (a resync is not a moment worth
   *  animating -- the ripple would otherwise sweep across a board the player never actually
   *  watched being captured). */
  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery && recovery.state;
    if (!snap || !validMpBoardState(snap.state)) return;
    mp.gameNum = snap.gameNum | 0;
    mp.nextDealer = snap.nextDealer === P2 ? P2 : P1;
    mp.series = this._mpNormalizeSeries(snap.series);
    this.state = mpStateFromPlain(snap.state);
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
   *  the whole room (host always P1, guest always P2), but WHICH SEAT MOVES FIRST alternates
   *  every game (mp.nextDealer), exactly as solo's startGame() alternates nextStarter. A FRESH
   *  seed is rolled for this game (never reused) and rides round.deck -- see the class comment
   *  above for why deck, not room config. */
  async _mpStartNextGame() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const dealer = mp.nextDealer === P2 ? P2 : P1;
    mp.nextDealer = dealer === P1 ? P2 : P1;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    // Publish BEFORE applying locally, same reasoning as tic-tac-toe/js/ui.js's/mancala/js/
    // ui.js's _mpStartNextGame: startRound clears the room's move log, so a very fast local
    // action could otherwise be written and then wiped by our own publish.
    try { await net.startRound(mp.code, n, seed, dealer); }
    catch { this._setMpStatus('mp_status_connection_error'); }
    if (this._dead || !this.mp) return;
    // The room update carrying our own record may have raced us here and already
    // applied it; never rebuild a game that has begun.
    if ((this.mp.gameNum | 0) < n) this._mpApplyRoundRecord({ n, deck: seed, dealer }, null);
  }

  /** Start the local game described by the host's round record. BOTH sides go through here --
   *  the host applies its own record the moment it publishes it, the guest applies the one it
   *  receives -- so the log cache is rebuilt FROM THAT RECORD's room snapshot and never carried
   *  over (net.js's startRound clears `moves` atomically with the record). The board is built
   *  from round.deck (the seed), NEVER transmitted directly: both sides call
   *  newGame(mulberry32(seed)) and reach byte-identical boards. */
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
    this.state = newGame(mulberry32(round.deck >>> 0));
    if (round.dealer === P2) this.state.turn = P2;
    this.view = 'game';
    this.busy = false;
    this._mpStatusMsg = '';
    this.closeOverlays();
    this.renderGame();
    this._mpSaveSnapshot();
    this._mpTryDeliverNextMove();
  }

  /** Series bookkeeping at the end of one game, MP only. Idempotent per game number: finish()
   *  can run more than once for the same game (a rematch overlay re-render, a restore of a
   *  finished game). `s.winner` is P1/P2/0 (draw), and mp.series.wins is indexed DIRECTLY by
   *  the seat value (see _mpNewState's comment on why index 0 is unused). */
  _mpAfterGameEnd() {
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.winner === 0) mp.series.draws += 1;
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

    // This game never calls net.writeResult (see the class comment above), so
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
    const res = await net.createRoom('filler', {}, this._myIdentity());
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
    if (res.room && res.room.game && res.room.game !== 'filler') {
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
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="fl-scrim"></div>
      <div class="fl-card" role="dialog" aria-modal="true" aria-label="${t(titleKey)}">
        <button type="button" class="fl-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="fl-card-emoji">📡</span>
        <h3 class="fl-card-title">${t(titleKey)}</h3>
        <p class="fl-card-score">${t(subKey)}</p>
        <div class="fl-card-actions">
          <button type="button" class="fl-primary" data-action="mp-end-ok">${t('mp_back_to_setup')}</button>
        </div>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave -------------------------------------------------------------

  /** Written from the post-move funnel after EVERY settled move, and again after a game
   *  concludes (finish(), for the statsCommitted flag). `seq` is read AFTER the move's own MP
   *  bookkeeping (invariant 4): the saved seq always matches the move already inside the saved
   *  state, so a rejoin replays only genuinely new entries. */
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
        state: plainFromState(this.state),
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
   *  next game" branch is needed here (mirrors mancala/js/ui.js's _tryRestoreMP) -- the saved
   *  position IS the finished game, and either it is still live (drain the tail) or it already
   *  finished (show the result once more; finish()'s own _statsCommitted/lastScoredGame guards
   *  keep this idempotent, including for the series tally). A guest waiting on the NEXT game's
   *  round record after restoring simply gets it the ordinary way, through _mpOnRoomUpdate's
   *  roundN > gameNum branch, once the host publishes it. */
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
    // The series tally is carried through UNTOUCHED, same as Tic Tac Toe's/Mancala's restore:
    // a restore that zeroed it would be the initMatch-wipe failure shape from js/CLAUDE.md's
    // invariant 5, translated to this game's vocabulary.
    mp.series = this._mpNormalizeSeries(save.series);
    mp.lastScoredGame = save.lastScoredGame | 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.state = mpStateFromPlain(save.state);
    this._statsCommitted = !!save.statsCommitted;
    this.view = 'game';
    this.busy = false;
    net.heartbeat(code, role);
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;
    this.renderGame();

    if (this.state.over) { this.finish(); return; }
    this._mpTryDeliverNextMove();
  }

  // --- events ----------------------------------------------------------------

  onClick(e) {
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
      saveSettings(this.level, this.nextStarter);
    } else if (action === 'start' || action === 'rematch') {
      this.startGame();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
    } else if (action === 'newgame') {
      this.renderSetup();
    } else if (action === 'pick') {
      this.humanMove(Number(btn.dataset.color));
    } else if (action === 'help') {
      this.openHelp();
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
  instance = new FillerUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** Autosave/resume built in for SOLO play (2026-07-23): Filler snapshots the board after every
 *  settled move and silently restores it on the next mount, so leaving mid-game is lossless --
 *  `false`, even mid-game (per root CLAUDE.md's "two legitimate meanings"). MULTIPLAYER is the
 *  exception within the exception (same as Chinchón/Escoba/Tic Tac Toe/Mancala): leaving is
 *  consequential for the live opponent (their room goes stale) even though this device could
 *  rejoin, so the confirm IS wanted -- `true` for as long as a room is joined. */
export function isInProgress() {
  return !!(instance && instance.mp);
}

export default { init, destroy, isInProgress };
