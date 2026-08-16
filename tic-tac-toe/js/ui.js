// ui.js - Tic Tac Toe UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen follows Escoba's accordion pattern (one settings row open at a
// time, toggle-row/is-open) per Matt's explicit ranking of setup screens in
// this repo (2026-07-21: Escoba is the model; Filler is an acceptable
// fallback; Mancala and Connect Four are not to be copied). CSS scoping
// discipline follows Mancala (every rule descendant-scoped under .ttt-root).
// The settings KEY follows Filler's convention (gamehub.<game>.v1) -- key and
// screen are separate axes, see root CLAUDE.md.
//
// game.js/ai.js stay pure and synchronous (no DOM, no async agent interface):
// unlike Escoba/Chinchon, a tic-tac-toe move has no multi-step resolution to
// pace, so this mirrors Filler/Mancala's simpler direct-call shape instead.
//
// MULTIPLAYER (phase 1 of HANDOFF-MP-ROADMAP.md). Two human seats only, host
// seat 0 / guest seat 1, over the shared js/net.js room protocol -- js/net.js
// itself is untouched. Because this game has no agent interface, the remote
// seat is NOT an agent object (Chinchon/Escoba's shape): it is a third kind of
// turn owner in the UI's own dispatch. Where solo schedules the AI on a timer,
// MP waits for the next entry in the room's move log. Every "self" lookup goes
// through _localSeat()/_myMark(); see the block comment above _localSeat().

import { newGame, legalMoves, applyMove, X, O } from './game.js';
import { chooseMove } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordTicTacToe, recordHeadToHead, loadStats, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import * as net from '../../js/net.js';
import { enableCodeCopy } from '../../js/mp-code-copy.js';
import { createReactions } from '../../js/mp-reactions-ui.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.tictactoe.v1';
// The in-progress-game autosave (2026-07-23, batch 9, HANDOFF-FB-RESUME.md).
// Separate from SETTINGS_KEY -- this holds a live match, not preferences.
// One save slot, either variant; cleared the moment a match ends or is
// explicitly abandoned (Restart/New game). Pattern copied from
// mancala/js/ui.js's saveGame/loadGame/clearGame -- do not invent a new one.
const SAVE_KEY = 'gamehub.tictactoe.save.v1';
// The MULTIPLAYER autosave, a THIRD key, distinct from both of the above and
// never read or written by either of the other two paths (THE LAW rule 5: keys
// are never renamed or repurposed, so this one is permanent as of the day it
// ships). Follows Chinchon's separate-key choice (gamehub.chinchon.mp.v1), not
// Escoba's mp-sub-object-in-the-solo-key shape -- Escoba's is a consequence of
// its save key being a frozen gen-1 name, not something anyone would pick fresh.
const MP_SAVE_KEY = 'gamehub.tictactoe.mp.v1';
const AI_THINK_MS = 450;
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// The difficulty bucket a MULTIPLAYER result records under. A real human
// opponent has no AI tier, and inheriting whatever tier the local setup screen
// happened to be showing (the wart both reference games carry -- see
// HANDOFF-MP-WEB-SESSION.md touchpoint 5) would file human matches under a
// meaningless one. 'mp' is unmapped in js/difficulty-tiers.js, so tierOf()
// returns null: the play counts in every total and in the leaderboard's "All"
// filter, and claims no tier pill. Additive and LAW-safe by construction.
const MP_DIFFICULTY = 'mp';
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Easy/Medium/Hard) -- do not invent
// new tier names here. Values (first element) stay canonical; labelKey resolves via t().
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/tic-tac-toe.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/tic-tac-toe.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

/** Persist the in-progress SOLO match (either variant) so leaving -- hub back, a
 *  reload, or closing the PWA -- never loses it. Called from the single
 *  post-move funnel (_afterStateChange) after every human and AI move, so it
 *  always holds the latest settled position. Clears itself the moment the
 *  match ends (mirrors mancala/js/ui.js's saveGame). Multiplayer has its own
 *  key and its own writer (_mpSaveSnapshot) and never comes through here. */
function saveGame(ui) {
  try {
    if (ui.mp) return;   // MP never writes the solo slot (see MP_SAVE_KEY)
    if (!ui.state || ui.state.over || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      variant: ui.state.variant,
      difficulty: ui._setup.difficulty,
      // Field names frozen by the shipped save shape (THE LAW rule 5). In solo
      // the local human is always seat 0, so humanMark IS marks[0] and aiMark
      // IS marks[1] -- the seat model below is a strict generalization of this
      // shape, not a change to it.
      humanMark: ui._myMark(),
      aiMark: ui._oppMark(),
      state: ui.state,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved match, or null. Validates hard: a corrupt or
 *  non-standard shape is treated as "no saved game" rather than crashing the
 *  module on mount. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (raw.variant !== 'classic' && raw.variant !== 'ultimate') return null;
    if (raw.humanMark !== X && raw.humanMark !== O) return null;
    if (raw.aiMark !== X && raw.aiMark !== O) return null;
    if (!DIFFICULTIES.some(([k]) => k === raw.difficulty)) return null;
    const s = raw.state;
    if (!validState(s, raw.variant)) return null;
    return { variant: raw.variant, difficulty: raw.difficulty, humanMark: raw.humanMark, aiMark: raw.aiMark, state: s };
  } catch { return null; }
}

/** Shared hard validation for any restored engine state (solo save, MP save,
 *  recovery snapshot). `requireLive` is false for MP, whose boundary saves
 *  legitimately hold a finished game (the room is between games). */
function validState(s, variant, requireLive = true) {
  if (!s || typeof s !== 'object' || s.variant !== variant) return false;
  if (requireLive && s.over) return false;
  if (variant === 'classic') {
    if (!Array.isArray(s.board) || s.board.length !== 9) return false;
  } else {
    if (!Array.isArray(s.boards) || s.boards.length !== 9 || s.boards.some((b) => !Array.isArray(b) || b.length !== 9)) return false;
    if (!Array.isArray(s.meta) || s.meta.length !== 9) return false;
  }
  return true;
}

function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

class TicTacToeUI {
  constructor(container) {
    this.container = container;
    this._codeCopyOff = enableCodeCopy(this.container);   // tap the room code to copy it
    this._reactions = createReactions({             // quick-chat reactions during MP
      send: (p) => { if (this.mp && this.mp.code) net.sendReaction(this.mp.code, String(this.mp.role), p); },
      mySeatKey: () => (this.mp ? String(this.mp.role) : null),
    });
    this._dead = false;
    this.view = 'setup';
    this._setupExpanded = null;
    this.state = null;
    this.busy = false;
    // Seat -> mark. Index 0 is the host's seat, index 1 the guest's; in solo
    // the local human is seat 0 and the AI is seat 1, so this is exactly the
    // old humanMark/aiMark pair with the seat made explicit. Never read
    // directly for "my" mark -- go through _myMark()/_oppMark().
    this.marks = [X, O];
    this.aiTimer = null;
    this._confirmTimer = null;
    this._setup = this._loadSetup();
    this._statsCommitted = false;

    // Multiplayer session state, or null in solo. Everything MP-specific hangs
    // off this one field, so `if (this.mp)` is the whole mode test.
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

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    // Deliberately do NOT abandon an MP room here: destroy() runs for ANY hub
    // teardown, including just navigating back to the launcher mid-match, which
    // is exactly what the MP autosave's 30-minute rejoin window exists for.
    // Only the LOCAL listener and heartbeat stop. An explicit abandon is
    // _mpLeaveToSetup(). Same reasoning as escoba/chinchon's destroy().
    // A hosted room that never reached a game is the one exception: nobody is
    // depending on it and there is no match to preserve, so it is released
    // rather than left occupying a code until its 24h TTL.
    if (!this.mp && this._lobby === 'host' && this._mpPendingCode) {
      net.leaveRoom(this._mpPendingCode, 'host').catch(() => { /* best-effort */ });
    }
    try { net.disconnect(); } catch { /* never let teardown throw */ }
    this.mp = null;
    if (this._codeCopyOff) { this._codeCopyOff(); this._codeCopyOff = null; }
    if (this._reactions) { this._reactions.destroy(); this._reactions = null; }
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('input', this._onInput);
    }
    this.container.innerHTML = '';
    this.state = null;
  }

  // Autosave/resume built in (2026-07-23, batch 9, HANDOFF-FB-RESUME.md):
  // every move checkpoints the match to SAVE_KEY and the next mount restores
  // it silently, straight onto the board. Per root CLAUDE.md's "two
  // legitimate meanings" note on isInProgress(), SOLO uses the resumable
  // meaning -- leaving costs nothing, so the hub's "leave game?" confirm would
  // be a lie and it returns false, even mid-match.
  //
  // MULTIPLAYER is the exception within the exception, exactly as in Chinchon
  // and Escoba: leaving is consequential for the live opponent (their room goes
  // stale and their game is over) even though this device could rejoin, so the
  // confirm IS wanted. True for as long as a room is joined -- including
  // BETWEEN games in a rematch series, when the opponent is sitting on the
  // "waiting for host" screen.
  isInProgress() {
    return !!this.mp;
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(SETTINGS_KEY, {});
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const profileDiff = (opp && SKILL_TO_DIFF[opp.skill]) || null;
    // firstMode: 'you' | 'opponent' | 'alternate'. New field, additive to the
    // frozen gamehub.tictactoe.v1 shape. Precedence: an explicit new-shape
    // choice wins; else a pre-existing device's old `humanFirst` boolean
    // (present in the store from before this change) is honored as-is (it
    // is the closest available proxy for "an explicit You/Opponent choice
    // from before this change" -- the old writer never distinguished a
    // user's deliberate pick from the untouched default, so any prior save
    // is treated as that device's standing choice); a device with NO saved
    // settings at all gets the new default, Alternate.
    let firstMode = 'you';
    if (saved.firstMode === 'you' || saved.firstMode === 'opponent' || saved.firstMode === 'alternate') {
      firstMode = saved.firstMode;
    } else if (Object.prototype.hasOwnProperty.call(saved, 'humanFirst')) {
      firstMode = saved.humanFirst !== false ? 'you' : 'opponent';
    } else {
      firstMode = 'alternate';
    }
    return {
      variant: saved.variant === 'classic' ? 'classic' : 'ultimate',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      firstMode,
      // Who opens the NEXT alternate-mode game; flipped and banked in
      // _resolveStarter() every time a new game begins (including Restart,
      // rematch, and each game of a multiplayer series).
      nextStarter: saved.nextStarter === 'you' || saved.nextStarter === 'opponent' ? saved.nextStarter : 'you',
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { variant: s.variant, difficulty: s.difficulty, firstMode: s.firstMode, nextStarter: s.nextStarter });
  }

  /** Identity is read fresh from the profile every render (never persisted),
   *  so profile edits always show -- same precedence rule as every other
   *  game module: last-used settings > shared profile > built-in default.
   *  In multiplayer the opponent half comes from the live room instead: a real
   *  person, not the profile's configured AI. */
  _identity() {
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const mpOpp = this.mp && this.mp.opp;
    return {
      humanName: (profile && profile.name) || t('you'),
      humanEmoji: (profile && profile.emoji) || '🙂',
      oppName: (mpOpp && mpOpp.name) || (opp && opp.name) || (this.mp ? t('mp_opponent_label') : t('computer')),
      oppEmoji: (mpOpp && mpOpp.avatar) || (opp && opp.emoji) || (this.mp ? '🙂' : '🤖'),
    };
  }

  /** Who this device is, in js/net.js's room vocabulary. */
  _myIdentity() {
    const id = this._identity();
    return { name: id.humanName, avatar: id.humanEmoji, deviceId: deviceId() };
  }

  _statsLine() {
    let rec = null;
    try { rec = (loadStats().games || {}).tictactoe; } catch { rec = null; }
    const total = rec && rec.total ? rec.total.played | 0 : 0;
    if (!total) return '';
    const tt = (rec && rec.tt) || {};
    const c = tt.classic || {}, u = tt.ultimate || {};
    return t('stats_line', {
      total, cw: c.won | 0, cl: c.lost | 0, ct: c.tied | 0,
      uw: u.won | 0, ul: u.lost | 0, ut: u.tied | 0,
    });
  }

  // --- seats ----------------------------------------------------------------

  /** The local player's seat: always 0 in solo. In MP the host is seat 0 and
   *  the GUEST IS SEAT 1 -- every "self" lookup must go through this rather
   *  than assume seat 0, or a guest reads the host's side of the board as its
   *  own (and, worse, records the host's result as its own: a THE LAW rule 2
   *  violation, since a loss written as a win is not additive-safe). Stated as
   *  a rule at escoba/js/ui.js:860; built in here from the first line of the
   *  multiplayer pass rather than retrofitted. */
  _localSeat() { return this.mp ? this.mp.localSeat : 0; }
  _remoteSeat() { return 1 - this._localSeat(); }
  /** This device's own mark. Replaces the old `this.humanMark` field. */
  _myMark() { return this.marks[this._localSeat()]; }
  /** The other seat's mark (the AI's in solo, the remote human's in MP). */
  _oppMark() { return this.marks[this._remoteSeat()]; }
  _seatOfMark(mark) { return this.marks[0] === mark ? 0 : 1; }
  _isMyTurn() { return !!(this.state && !this.state.over && this.state.turn === this._myMark()); }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="ttt-root"><div class="ttt-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.ttt-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('input', this._onInput);
    // Come back to exactly where you left off. A live MULTIPLAYER room takes
    // precedence over a solo save (starting an MP match clears the solo slot,
    // so in practice only one of the two is ever fresh) and is restored
    // asynchronously, since it has a room to rejoin first.
    const mpSave = this._mpLoadSave();
    if (mpSave) {
      this.renderSetup();
      this._tryRestoreMP(mpSave);
      return;
    }
    const saved = loadGame();
    if (saved) this.resumeGame(saved); else this.renderSetup();
  }

  // --- setup screen -----------------------------------------------------------

  // `lbl` is trusted HTML, not plain text: callers pass either a translated
  // (trusted) string or already-`esc()`-ed user content (e.g. the opponent
  // name in _firstContent, or a diffShapeSVG() shape prefix) -- _seg must
  // not re-escape it, or a caller's own esc() call turns into visible
  // "&lt;svg&gt;" markup instead of rendering.
  _seg(action, value, opts) {
    return `<div class="ttt-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="ttt-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="ttt-row ${open ? 'is-open' : ''}">
      <button type="button" class="ttt-row-head" data-action="toggle-row" data-row="${key}">
        <span class="ttt-row-label">${label}</span><span class="ttt-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="ttt-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _variantContent() {
    const s = this._setup;
    return this._seg('set-variant', s.variant, [['classic', t('variant_classic')], ['ultimate', t('variant_ultimate')]]) +
      `<p class="ttt-hint">${s.variant === 'ultimate' ? t('hint_variant_ultimate') : t('hint_variant_classic')}</p>`;
  }

  _diffContent() {
    const s = this._setup;
    return this._seg('set-diff', s.difficulty, DIFFICULTIES.map(([v, k]) => [v, diffShapeSVG(tierOf(v)) + esc(t(k))]));
  }

  _firstContent() {
    const id = this._identity();
    const sel = this._setup.firstMode;
    const oppLabel = this._mode === 'host' ? t('mp_opponent_label') : id.oppName;
    return this._seg('set-first', sel, [['you', t('you')], ['opponent', esc(oppLabel)], ['alternate', t('first_alternate')]]);
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    // Leaving an unfinished match via "New game" is an explicit abandon
    // (same bucket as Restart), so the autosave clears here too -- otherwise
    // stale progress would ambush the player on the next mount.
    if (this.view === 'game' && this.state && !this.state.over && !this.mp) clearGame();
    this.view = 'setup';
    this.state = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    const head = `
      <h1 class="ttt-title">${t('title')}</h1>
      <p class="ttt-sub">${t('tagline')}</p>
      ${stats ? `<p class="ttt-stats">${esc(stats)}</p>` : ''}
      ${this._modeSeg()}`;

    if (this._lobby) {
      this.shell.innerHTML = head + this._lobbyHTML();
      return;
    }
    if (this._mode === 'join') {
      this.shell.innerHTML = head + this._joinBodyHTML();
      return;
    }
    const hosting = this._mode === 'host';
    this.shell.innerHTML = head + `
      ${hosting ? '' : `<div class="ttt-vscard">
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.humanEmoji)}</span><span class="ttt-vsname">${esc(id.humanName)}</span></div>
        <span class="ttt-vslabel">${t('vs')}</span>
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.oppEmoji)}</span><span class="ttt-vsname">${esc(id.oppName)}</span></div>
      </div>`}
      <div class="ttt-summary">
        ${this._row('variant', t('row_variant'), s.variant === 'ultimate' ? t('variant_ultimate') : t('variant_classic'), this._variantContent())}
        ${hosting ? '' : this._row('difficulty', t('row_difficulty'), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
        ${this._row('first', t('row_first'),
          s.firstMode === 'you' ? t('you') : s.firstMode === 'opponent' ? (hosting ? t('mp_opponent_label') : id.oppName) : t('first_alternate'),
          this._firstContent())}
      </div>
      ${hosting
        ? `<p class="ttt-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
           <button type="button" class="ttt-btn ttt-btn-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`
        : `<button type="button" class="ttt-btn ttt-btn-primary" data-action="start">${t('start')}</button>`}
      <button type="button" class="ttt-link" data-action="help">${t('howto')}</button>`;
  }

  // --- multiplayer lobby ------------------------------------------------------

  _modeSeg() {
    return this._seg('set-mode', this._mode, [
      ['solo', t('mode_solo')], ['host', t('mode_host')], ['join', t('mode_join')],
    ]);
  }

  /** Join mode's body: the code input lives on the setup screen itself, never
   *  its own pre-join screen -- _lobby only switches to 'join' once the join
   *  has actually succeeded (see _mpJoinSubmit). Mirrors Chinchon's Join mode,
   *  including the retained-on-error input. */
  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="ttt-mp-msg ttt-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="ttt-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : t('mp_join_hint')))}</p>`;
    return `<div class="ttt-mp-lobby">
      <span class="ttt-mp-label">${t('mp_enter_code')}</span>
      <input class="ttt-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}"
        autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="ttt-btn ttt-btn-primary" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = `<button type="button" class="ttt-btn ttt-btn-ghost" data-action="mp-cancel">${t('mp_back_btn')}</button>`;
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="ttt-mp-lobby">
        <span class="ttt-mp-label">${t('mp_code_aria')}</span>
        <div class="ttt-mp-code" data-role="mp-code" role="button" tabindex="0">${code ? esc(code) : '····'}</div>
        <span class="ttt-mp-label">${t('mp_opponent_label')}</span>
        <div class="ttt-mp-oppslot">${guest
          ? `<span class="ttt-mp-oppav">${esc(guest.avatar || '🙂')}</span><span class="ttt-mp-oppname">${esc(guest.name || '')}</span>`
          : `<span class="ttt-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="ttt-mp-summary">${esc(this._setup.variant === 'ultimate' ? t('variant_ultimate') : t('variant_classic'))}</p>
        <p class="ttt-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="ttt-btn ttt-btn-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    const variant = room && room.config && room.config.variant === 'classic' ? t('variant_classic') : t('variant_ultimate');
    return `<div class="ttt-mp-lobby">
      <span class="ttt-mp-label">${t('mp_code_aria')}</span>
      <div class="ttt-mp-code" data-role="mp-code" role="button" tabindex="0">${esc(this._mpJoinedCode || '')}</div>
      <span class="ttt-mp-label">${t('mp_host_label')}</span>
      <div class="ttt-mp-oppslot">${host
        ? `<span class="ttt-mp-oppav">${esc(host.avatar || '🙂')}</span><span class="ttt-mp-oppname">${esc(host.name || '')}</span>`
        : `<span class="ttt-mp-oppempty">—</span>`}</div>
      <p class="ttt-mp-summary">${esc(variant)}</p>
      <p class="ttt-mp-msg" data-role="mp-msg">${t('mp_waiting_host')}</p>
      ${back}
    </div>`;
  }

  _setMpStatus(key) { this._mpStatusMsg = key; this._rerender(); }
  _clearMpStatus() { if (!this._mpStatusMsg) return; this._mpStatusMsg = ''; this._rerender(); }
  _rerender() {
    if (this._dead) return;
    if (this.view === 'game' && this.state) this.renderGame(); else this.renderSetup();
  }

  /** Keep the code input's message slot fresh without re-rendering the input
   *  itself (which would drop what the player is typing). */
  _syncMpMsgSlot() {
    const slot = this.shell && this.shell.querySelector('[data-role="mp-msg"]');
    if (!slot) return;
    slot.textContent = this._mpError || (this._mpBusy ? t('mp_joining') : t('mp_join_hint'));
  }

  // --- game screen --------------------------------------------------------

  /** Resolve who opens the next game and bank the Alternate flip immediately
   *  (before any move is played) so the choice survives navigating away
   *  mid-game -- mirrors mancala/js/ui.js's startGame(). Shared by solo,
   *  Restart/rematch, and every game of a multiplayer series (the HOST calls
   *  it; the guest never derives who opens, it reads the host's round record). */
  _resolveStarter() {
    const s = this._setup;
    let starter;
    if (s.firstMode === 'you') starter = 'you';
    else if (s.firstMode === 'opponent') starter = 'opponent';
    else {
      starter = s.nextStarter === 'opponent' ? 'opponent' : 'you';
      s.nextStarter = starter === 'you' ? 'opponent' : 'you';
    }
    this._saveSetup();
    return starter;
  }

  startGame() {
    const s = this._setup;
    const starter = this._resolveStarter();
    this.marks = starter === 'you' ? [X, O] : [O, X];
    clearGame();                 // a new match replaces any saved one
    this._statsCommitted = false;
    this.state = newGame(s.variant, X);
    this.view = 'game';
    this._afterStateChange();
    // Who opens is already announced by the existing status line
    // (_statusText: "Your turn" / "{opp}'s turn" / "{opp} is thinking...")
    // rendered by _afterStateChange -- no separate toast/UI surface needed.
  }

  /** Rebuild an in-progress match exactly as left and hand the turn back to
   *  whoever had it -- mirrors mancala/js/ui.js's resumeGame(). Reuses the
   *  normal post-move funnel, so a saved AI turn picks up right where it
   *  left off (same "worst case: the in-flight move rolls back" note as
   *  Mancala -- the save is only ever a fully-settled position). */
  resumeGame(saved) {
    this._setup.difficulty = saved.difficulty;
    this.marks = [saved.humanMark, saved.aiMark];   // solo: seat 0 is the local human
    this._statsCommitted = false;
    this.state = saved.state;
    this.view = 'game';
    this._afterStateChange();
  }

  /** Single funnel after every settled state change (game start, local move,
   *  remote move, recovery, resume).
   *
   *  MP ORDERING IS LOAD-BEARING. The multiplayer bookkeeping for the move that
   *  got us here -- the seq reservation + append for a local move
   *  (_mpAfterLocalMove), or the seq advance + hash verify for a remote one
   *  (_mpApplyNextEntry) -- has ALREADY run by the time this is called, so the
   *  autosave below records a seq that matches the move already inside its own
   *  snapshot. Saving first would store mp.seq one LOW and every rejoin would
   *  re-apply a move it already had (invariant 4; escoba/js/ui.js's E4
   *  off-by-one is the same bug in the other direction). Never hoist the save. */
  _afterStateChange() {
    if (this._dead) return;
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);
    if (this.state.over) {
      this.busy = false;
      this.renderGame();
      this.finish();
      return;
    }
    if (this.mp) {
      // The remote seat is driven by the room's move log, not a timer: where
      // solo schedules the AI below, MP renders and waits. The next entry may
      // already be cached from an earlier room update, so try to drain now.
      this.busy = false;
      this.renderGame();
      this._mpTryDeliverNextMove();
      return;
    }
    if (this.state.turn === this._oppMark()) {
      this.busy = true;
      this.renderGame();
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        const move = chooseMove(this.state, this._setup.difficulty);
        applyMove(this.state, move);
        this._afterStateChange();
      }, AI_THINK_MS);
    } else {
      this.busy = false;
      this.renderGame();
    }
  }

  /** Is `move` legal in the current state? The single legality gate, read by
   *  the local tap path AND by every remote move before it is applied -- one
   *  gate for both seats is what makes a network-driven seat safe to add. */
  _isLegal(move) {
    const s = this.state;
    if (!s || s.over) return false;
    const legal = legalMoves(s);
    return s.variant === 'ultimate'
      ? legal.some((m) => m.board === move.board && m.cell === move.cell)
      : legal.includes(move);
  }

  humanMove(move) {
    if (this.busy || !this.state || this.state.over) return;
    if (this.state.turn !== this._myMark()) return;
    if (!this._isLegal(move)) return;
    applyMove(this.state, move);
    if (this.mp) this._mpAfterLocalMove(move);   // BEFORE the funnel's autosave (invariant 4)
    this._afterStateChange();
  }

  _statusText(s, id) {
    // An MP status (waiting/resyncing/opponent disconnected) outranks the
    // ordinary turn text and reuses the same slot rather than adding new DOM.
    if (this.mp && this._mpStatusMsg) return t(this._mpStatusMsg);
    if (s.over) return s.isDraw ? t('draw') : (s.winner === this._myMark() ? t('you_win') : t('opp_wins', { opp: id.oppName }));
    if (this.busy) return t('opp_thinking', { opp: id.oppName });
    if (s.turn === this._myMark()) {
      if (s.variant === 'ultimate') {
        return s.forcedBoard === null ? t('your_turn_any_board') : t('your_turn_board', { n: s.forcedBoard + 1 });
      }
      return t('your_turn');
    }
    return t('opp_turn', { opp: id.oppName });
  }

  _classicBoardHtml(s) {
    const legal = s.over ? [] : legalMoves(s);
    const legalSet = new Set(legal);
    const winSet = new Set(s.winLine || []);
    const canClickNow = !s.over && !this.busy && s.turn === this._myMark();
    const cellsHtml = s.board.map((mark, i) => {
      const r = Math.floor(i / 3) + 1, c = (i % 3) + 1;
      const live = canClickNow && legalSet.has(i);
      const name = mark ? t('cell_occupied_aria', { r, c, mark }) : t('cell_empty_aria', { r, c });
      return `<button type="button" class="ttt-cell ${live ? 'is-live' : ''} ${winSet.has(i) ? 'is-win' : ''}"
        data-action="cell" data-cell="${i}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
        aria-label="${name}">${mark || ''}</button>`;
    }).join('');
    return `<div class="ttt-board" role="grid" aria-label="${t('board_aria')}">${cellsHtml}</div>`;
  }

  _ultimateBoardHtml(s) {
    const legal = s.over ? [] : legalMoves(s);
    const legalSet = new Set(legal.map((m) => `${m.board}:${m.cell}`));
    const playableBoards = new Set(legal.map((m) => m.board));
    const winBoards = new Set(!s.over || s.isDraw ? [] : s.winLine);
    const canClickNow = !s.over && !this.busy && s.turn === this._myMark();

    const boardsHtml = s.boards.map((cells, b) => {
      const owner = s.meta[b];
      const resolved = owner !== null;
      let cls = '';
      if (s.over) { if (winBoards.has(b)) cls = 'is-win-board'; }
      else if (resolved) cls = 'is-resolved';
      else cls = playableBoards.has(b) ? 'is-forced' : 'is-dim';

      const overlayGlyph = owner === 'D' ? '–' : (owner || '');   // en dash: a drawn board's glyph, not em-dash punctuation
      const label = resolved
        ? (owner === 'D' ? t('sboard_drawn_aria', { n: b + 1 }) : t('sboard_won_aria', { n: b + 1, mark: owner }))
        : t('sboard_aria', { n: b + 1 });
      const cellsHtml = cells.map((mark, c) => {
        const r = Math.floor(c / 3) + 1, col = (c % 3) + 1;
        const live = canClickNow && legalSet.has(`${b}:${c}`);
        const name = mark
          ? t('scell_occupied_aria', { n: b + 1, r, c: col, mark })
          : t('scell_empty_aria', { n: b + 1, r, c: col });
        return `<button type="button" class="ttt-scell ${live ? 'is-live' : ''}"
          data-action="scell" data-board="${b}" data-cell="${c}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
          aria-label="${name}">${mark || ''}</button>`;
      }).join('');
      return `<div class="ttt-sboard ${cls}" data-owner="${owner || ''}" aria-label="${label}">
        ${cellsHtml}<div class="ttt-soverlay" aria-hidden="true">${overlayGlyph}</div>
      </div>`;
    }).join('');

    return `<div class="ttt-uboard" role="grid" aria-label="${t('uboard_aria')}">${boardsHtml}</div>`;
  }

  /** The running series tally, MP only. Read by SEAT so each device sees its
   *  own record first -- the stored counters are seat-indexed, never
   *  device-relative (see _mpSnapshot). */
  _seriesLine() {
    const mp = this.mp;
    if (!mp) return '';
    const id = this._identity();
    return t('mp_series', {
      me: mp.series.wins[this._localSeat()] | 0,
      them: mp.series.wins[this._remoteSeat()] | 0,
      d: mp.series.draws | 0,
      opp: id.oppName,
    });
  }

  renderGame() {
    if (this._dead) return;
    const id = this._identity();
    const s = this.state;
    const myMark = this._myMark(), oppMark = this._oppMark();
    const boardHtml = s.variant === 'ultimate' ? this._ultimateBoardHtml(s) : this._classicBoardHtml(s);
    const series = this.mp ? `<p class="ttt-mp-series">${esc(this._seriesLine())}</p>` : '';
    this.shell.innerHTML = `
      <div class="ttt-topbar">
        <div class="ttt-idchip ${!s.over && s.turn === myMark ? 'is-turn' : ''}" data-mark="${myMark}">
          <span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span><span class="ttt-mark">${myMark}</span>
        </div>
        <span class="ttt-vsdash">${t('vs')}</span>
        <div class="ttt-idchip ${!s.over && s.turn === oppMark ? 'is-turn' : ''}" data-mark="${oppMark}">
          <span class="ttt-mark">${oppMark}</span><span>${esc(id.oppName)}</span><span>${esc(id.oppEmoji)}</span>
        </div>
      </div>
      ${series}
      <p class="ttt-status" aria-live="polite">${esc(this._statusText(s, id))}</p>
      ${boardHtml}
      <div class="ttt-actions">
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="help">${t('howto')}</button>
        ${this.mp
          ? `<button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
          : `<button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
             <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="change-settings">${t('new_game')}</button>`}
      </div>`;
  }

  /** Run `action` immediately if there's no game in progress to lose; otherwise
   *  require a second confirming tap on `btn` (guards against accidentally
   *  abandoning a game). Reference pattern: connect-four/js/ui.js. */
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
    if (!this.shell) return;
    const b = this.shell.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  /** Record the finished game exactly once on THIS device.
   *
   *  Both devices in a multiplayer match run this, and that is NOT
   *  double-counting: gamehub.stats is keyed per PLAYER (statsKey()/statsId(),
   *  "Whose stats are these" in js/CLAUDE.md), so two devices each writing "I
   *  played one game" is two different people each correctly getting one.
   *  Idempotence is the local _statsCommitted flag, set BEFORE any write --
   *  MP reaches game-end by several paths (normal finish, restore of a
   *  finished game), and the flag is what stops one game counting twice here. */
  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const s = this.state;
    // `won` resolves through _myMark(), which resolves through _localSeat():
    // a guest MUST NOT record the host's result as its own (THE LAW rule 2 --
    // a loss written as a win is not additive-safe). null = draw.
    const won = s.isDraw ? null : (s.winner === this._myMark());
    const difficulty = this.mp ? MP_DIFFICULTY : this._setup.difficulty;
    try { recordTicTacToe(s.variant, difficulty, won); } catch { /* never block the result */ }
    // Multiplayer only: capture WHO this was against while the room state is
    // still live. Solo has no `this.mp` and is untouched. Never allowed to
    // block the ordinary result from being recorded.
    const opp = this.mp && this.mp.opp;
    if (opp) { try { recordHeadToHead('tictactoe', opp, won); } catch { /* never block the result */ } }
  }

  finish() {
    const s = this.state;
    const won = s.isDraw ? null : (s.winner === this._myMark());
    this._commitStats();
    if (this.mp) this._mpAfterGameEnd();

    const id = this._identity();
    const title = s.isDraw ? t('draw') : won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = s.isDraw ? '🤝' : won ? '🏆' : id.oppEmoji;
    const isHost = !!(this.mp && this.mp.role === 'host');
    const actions = !this.mp
      ? `<button type="button" class="ttt-btn ttt-btn-primary" data-action="rematch">${t('play_again')}</button>
         <button type="button" class="ttt-btn ttt-btn-ghost" data-action="change-settings">${t('change_settings')}</button>`
      : isHost
        ? `<button type="button" class="ttt-btn ttt-btn-primary" data-action="mp-next-game">${t('play_again')}</button>
           <button type="button" class="ttt-btn ttt-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`
        : `<p class="ttt-card-wait">${esc(t('mp_waiting_rematch', { opp: id.oppName }))}</p>
           <button type="button" class="ttt-btn ttt-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`;
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="ttt-scrim"></div>
      <div class="ttt-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="ttt-card-emoji">${esc(emoji)}</span>
        <h3 class="ttt-card-title">${esc(title)}</h3>
        <p class="ttt-card-sub">${s.variant === 'ultimate' ? t('variant_ultimate') : t('variant_classic')} &middot; ${this.mp ? esc(this._seriesLine()) : t(DIFF_LABEL_KEY[this._setup.difficulty])}</p>
        <div class="ttt-card-actions">${actions}</div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // ==========================================================================
  // Multiplayer
  //
  // Room protocol (js/net.js, unchanged): rooms/<CODE> with a seq-keyed move
  // log both sides append into, a `round` record the HOST publishes, a
  // `recovery` field, and heartbeats. Two roles only.
  //
  // Vocabulary mapping, because Tic Tac Toe shares none of Chinchon's:
  //   - a net.js "round" is ONE GAME of a rematch series in this room. The
  //     record's `n` is the game number; its `deck` slot is unused (no cards)
  //     and its `dealer` slot carries the SEAT THAT PLAYS X in that game --
  //     the equivalent "who opens" datum. Reusing the existing slots is
  //     deliberate: js/net.js is shared infrastructure two production games
  //     depend on and a single game's MP pass never changes it.
  //   - net.js's writeResult is deliberately NOT used. It sets status:'ended'
  //     on the room, which would kill a room that is meant to host the NEXT
  //     game of the series. So in this game `status:'ended'` unambiguously
  //     means somebody abandoned the room (leaveRoom), which is exactly what
  //     _mpOnRoomUpdate's opponent-left branch keys on.
  // ==========================================================================

  _mpNewState(role, code, opp, variant) {
    return {
      role, code,
      // Fixed at match start and never re-derived: host = 0, guest = 1.
      localSeat: role === 'host' ? 0 : 1,
      // Who we are playing, `{ name, avatar, deviceId }` from the room. Null on
      // the restore path, where _mpOnRoomUpdate backfills it from the live room.
      opp: opp || null,
      variant: variant === 'classic' ? 'classic' : 'ultimate',
      gameNum: 0,
      xSeat: 0,
      // Seat-indexed, NEVER device-relative (see _mpSnapshot).
      series: { wins: [0, 0], draws: 0 },
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      replayMode: false, recoveryAttempts: 0, delivering: false,
      // Set by a GUEST that has flagged a divergence: stops it consuming the
      // log until the host's snapshot lands (see _mpOnDivergence).
      awaitingRecovery: false,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
      lastScoredGame: 0,
      awaitingGameN: null, awaitingGameResolve: null,
    };
  }

  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [w[0] | 0, w[1] | 0], draws: (s && s.draws) | 0 };
  }

  /** The move payload written to the room log. `g` is the game number this
   *  move belongs to: an entry from an earlier game of the series can never be
   *  consumed as this game's, no matter how a stale room snapshot is ordered
   *  (see _mpApplyNextEntry). */
  _mpEncodeMove(move) {
    const g = this.mp.gameNum;
    return this.state.variant === 'ultimate'
      ? { t: 'move', g, b: move.board | 0, c: move.cell | 0 }
      : { t: 'move', g, c: move | 0 };
  }

  _mpDecodeMove(m) {
    return this.state.variant === 'ultimate' ? { board: m.b | 0, cell: m.c | 0 } : (m.c | 0);
  }

  /** Called immediately after a LOCAL move has been applied to this device's
   *  state, and always BEFORE the funnel's autosave. The seq is reserved
   *  SYNCHRONOUSLY (not after the network await) so nothing can race onto the
   *  same number, exactly as chinchon/js/ui.js's _mpAfterDecision does. */
  _mpAfterLocalMove(move) {
    const mp = this.mp;
    if (!mp) return;
    const seq = ++mp.appliedSeq;
    const hash = stateHash(this.state);
    net.appendMove(mp.code, mp.role, seq, this._mpEncodeMove(move), hash)
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
  }

  /** Drain every deliverable entry from the cached log. Re-entrant by design:
   *  each applied move runs the ordinary post-move funnel, which calls back in
   *  here, and the `delivering` flag turns that into iteration instead of
   *  recursion. */
  _mpTryDeliverNextMove() {
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this._dead || !this.state) return;
    mp.delivering = true;
    try { while (this._mpApplyNextEntry()) { /* keep draining */ } }
    finally { mp.delivering = false; }
  }

  /** Apply the single log entry at appliedSeq+1 if it is present, legal and
   *  hash-consistent. Returns true if the drain should continue. */
  _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    // Belt and braces against a stale log: an entry stamped with a different
    // game number is never this game's move (see _mpApplyRoundRecord, which is
    // the structural fix -- the log cache is rebuilt per game record).
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;
    const move = this._mpDecodeMove(entry.move);
    // Legality is checked against OUR state BEFORE applying: applyMove is a
    // silent no-op on an illegal move, so an already-diverged state would
    // otherwise absorb the entry, advance the seq and desync invisibly. Then
    // the post-apply hash is compared with the sender's.
    let agreed = this._isLegal(move);
    if (agreed) { applyMove(this.state, move); agreed = stateHash(this.state) === entry.h; }
    if (!agreed) return this._mpOnDivergence(seq);
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this._afterStateChange();
    return true;
  }

  /** A remote entry did not match this device's state.
   *
   *  The HOST is authoritative (same rule as Chinchon/Escoba): it keeps its own
   *  state, TAKES THE SEQ anyway -- not doing so would leave it writing its next
   *  move onto a number the peer has already used -- and publishes a snapshot
   *  for the guest to rebuild from.
   *
   *  The GUEST stops consuming the log until that snapshot lands. Without that
   *  latch, every subsequent room update re-delivers the same entry onto the
   *  already-diverged state, each re-delivery counts as another failed attempt,
   *  and the match dies of "too many recovery attempts" before the host's answer
   *  has had time to arrive. Three genuinely distinct failures still end it.
   *  Returns whether the drain should continue. */
  _mpOnDivergence(seq) {
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this._mpEndDueToError(); return false; }
    this._setMpStatus('mp_status_resyncing');
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      net.writeRecovery(mp.code, seq, this._mpSnapshot()).catch(() => {});
      this._afterStateChange();
      return true;
    }
    mp.awaitingRecovery = true;
    net.requestRecovery(mp.code, seq).catch(() => {});
    return false;
  }

  /** The full-state snapshot the host publishes for recovery, and the payload
   *  shape the MP autosave stores.
   *
   *  EVERY FIELD HERE IS SEAT-INDEXED OR ABSOLUTE. Nothing device-relative is
   *  transmitted: not "my mark", not "my wins". A receiver derives its own side
   *  from _localSeat() and the seat-indexed xSeat/series. This is invariant 2
   *  ("a transmitted snapshot's isHuman flags are sender-relative") solved by
   *  construction rather than by remapping after the fact -- if a sender-
   *  relative field is ever added to this object, a recovered guest starts
   *  playing the host's side of the board and records the host's result as its
   *  own. Do not add one. */
  _mpSnapshot() {
    const mp = this.mp;
    return {
      v: 1,
      variant: mp.variant,
      gameNum: mp.gameNum,
      xSeat: mp.xSeat,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: this.state,
    };
  }

  /** Guest side of a resync: rebuild wholesale from the host's snapshot,
   *  re-deriving this device's own mark from its own seat. */
  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery && recovery.state;
    if (!snap || !validState(snap.state, snap.variant, false)) return;
    mp.variant = snap.variant;
    mp.gameNum = snap.gameNum | 0;
    mp.xSeat = snap.xSeat === 1 ? 1 : 0;
    mp.series = this._mpNormalizeSeries(snap.series);
    // Seat -> mark, re-derived locally. _myMark() then reads marks[localSeat].
    this.marks = mp.xSeat === 0 ? [X, O] : [O, X];
    this.state = deepCopy(snap.state);
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0;
    mp.awaitingRecovery = false;
    this.view = 'game'; this.busy = false;
    this.closeOverlays();
    this._mpStatusMsg = '';
    net.clearRecovery(mp.code).catch(() => {});
    this._afterStateChange();
  }

  /** Start the local game described by the host's round record. BOTH sides go
   *  through here -- the host applies its own record the moment it publishes
   *  it, the guest applies the one it receives -- so a game's seat->mark
   *  assignment is decided in exactly one place, and it is always the host's.
   *  The guest NEVER derives who opens locally (invariant 5: the next round's
   *  deck must come from the host, not a local shuffle; here the equivalent
   *  datum is which seat plays X).
   *
   *  `room` is the snapshot the record arrived in, or null when the host
   *  applies its own. The move-log cache is rebuilt FROM THAT RECORD's room
   *  snapshot and never carried over: net.js's startRound clears `moves`
   *  atomically with the record, so a log entry can never be read across a
   *  game boundary (invariant 3's failure shape -- per-round consumption state
   *  leaking into the next round). */
  _mpApplyRoundRecord(round, room) {
    const mp = this.mp;
    if (!mp || this._dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.xSeat = round.dealer === 1 ? 1 : 0;
    this.marks = mp.xSeat === 0 ? [X, O] : [O, X];
    mp.appliedSeq = 0;
    mp.replayMode = false;
    mp.recoveryAttempts = 0;
    mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this._statsCommitted = false;
    this.state = newGame(mp.variant, X);
    this.view = 'game';
    this.busy = false;
    this._mpStatusMsg = '';
    this.closeOverlays();
    this._afterStateChange();
  }

  /** Host only: publish the next game of the series and start it locally. */
  async _mpStartNextGame() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const starter = this._resolveStarter();
    const xSeat = starter === 'you' ? this._localSeat() : this._remoteSeat();
    // Publish BEFORE applying locally. startRound clears the room's move log, so
    // a very fast first tap on an already-rendered board could otherwise be
    // written and then wiped by our own publish. The local apply still happens
    // if the write fails, so an offline host is never left stateless.
    try { await net.startRound(mp.code, n, null, xSeat); }
    catch { this._setMpStatus('mp_status_connection_error'); }
    if (this._dead || !this.mp) return;
    // The room update carrying our own record may have raced us here and
    // already applied it; never rebuild a game that has begun.
    if ((this.mp.gameNum | 0) < n) this._mpApplyRoundRecord({ n, dealer: xSeat }, null);
  }

  /** Guest only: block until the host has published the record for the next
   *  game. Used by the restore path -- a boundary save must not guess who opens
   *  the next game (invariant 5). */
  _mpAwaitNextGame() {
    const mp = this.mp;
    const target = (mp.gameNum | 0) + 1;
    const room = mp.lastRoomSnapshot;
    if (room && room.round && (room.round.n | 0) >= target) {
      this._mpApplyRoundRecord(room.round, room);
      return Promise.resolve();
    }
    this._setMpStatus('mp_waiting_host');
    return new Promise((resolve) => { mp.awaitingGameN = target; mp.awaitingGameResolve = resolve; });
  }

  /** Series bookkeeping at the end of one game. Idempotent per game number:
   *  finish() can run more than once for the same game (a rematch overlay
   *  re-render, a restore of a finished game). */
  _mpAfterGameEnd() {
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.isDraw) mp.series.draws += 1;
    else mp.series.wins[this._seatOfMark(s.winner)] += 1;
    this._mpSaveSnapshot();   // re-save with the tally and statsCommitted set
  }

  // --- room lifecycle -------------------------------------------------------

  /** The one room subscription for this device's whole MP session (lobby
   *  through the last game): net.js allows exactly one at a time. */
  _mpRoomCallback(room) {
    if (this._dead) return;
    this._mpLobbyRoom = room;
    if (this._reactions) { this._reactions.onRoom(room); this._reactions.setActive(!!(this.mp && this.mp.code)); }
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
    // Keep the opponent's identity current from the live room (and fill it in
    // at all on the restore path, which starts with none). Only overwritten
    // while the other side is actually present, so a mid-match departure leaves
    // the last known identity intact for the stats/head-to-head write.
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;

    // This game never calls net.writeResult (see the vocabulary note above), so
    // status:'ended' means exactly one thing: the other device abandoned the
    // room.
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
      // A newer record: the host started the next game of the series. Its own
      // room snapshot carries the (cleared) log that goes with it.
      this._mpApplyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0)) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      this._mpTryDeliverNextMove();
    }
    // roundN < gameNum: this snapshot predates the record we already applied
    // (the host applies locally the instant it publishes). Its move log belongs
    // to the previous game and is ignored entirely.

    if (mp.awaitingGameResolve && room.round && roundN >= mp.awaitingGameN) {
      const resolve = mp.awaitingGameResolve;
      mp.awaitingGameN = null; mp.awaitingGameResolve = null;
      this._clearMpStatus();
      resolve();
    }
  }

  async _mpHostCreate() {
    if (this._mpBusy) return;
    this._mpBusy = true; this._mpError = '';
    this._lobby = 'host';
    this.renderSetup();
    const config = { variant: this._setup.variant };
    const res = await net.createRoom('tictactoe', config, this._myIdentity());
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

  /** Host taps Start in the lobby: the room has a guest, so game 1 begins. */
  _mpHostStartMatch() {
    const room = this._mpLobbyRoom;
    if (!room || !room.guest || this.mp || this._mpBusy) return;
    clearGame();                                   // an MP match supersedes any solo save
    this.mp = this._mpNewState('host', this._mpPendingCode, room.guest, this._setup.variant);
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
    if (res.room && res.room.game && res.room.game !== 'tictactoe') {
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
    clearGame();
    this.mp = this._mpNewState('guest', this._mpJoinedCode, room.host, room.config && room.config.variant);
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

  /** Explicit abandon (the in-game Leave button), unlike destroy()'s
   *  backgrounding: this ends the room for the opponent too. */
  _mpLeaveToSetup() {
    if (this._reactions) this._reactions.setActive(false);   // no reactions off the table
    const mp = this.mp;
    this.mp = null;
    this._mpClearSave();
    this._lobby = null; this._mode = 'solo';
    this._mpPendingCode = null; this._mpJoinedCode = null; this._mpLobbyRoom = null;
    this._mpStatusMsg = '';
    this.marks = [X, O];
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

  /** Terminal MP overlay. An abandoned or desynced game is deliberately NOT
   *  recorded as a result: it was not played to a conclusion, and inventing a
   *  win or a loss for it would be fabricating history. Whatever games in the
   *  series DID conclude were already recorded, each at its own end. */
  _mpEndModal(titleKey, subKey) {
    this.closeOverlays();
    this.marks = [X, O];
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="ttt-scrim"></div>
      <div class="ttt-card" role="dialog" aria-modal="true" aria-label="${t(titleKey)}">
        <button type="button" class="ttt-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="ttt-card-emoji">📡</span>
        <h3 class="ttt-card-title">${t(titleKey)}</h3>
        <p class="ttt-card-sub">${t(subKey)}</p>
        <div class="ttt-card-actions">
          <button type="button" class="ttt-btn ttt-btn-primary" data-action="mp-end-ok">${t('mp_back_to_setup')}</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave ----------------------------------------------------------

  /** Written from the post-move funnel after EVERY settled move, and again
   *  after a game concludes (_mpAfterGameEnd, for the series tally and the
   *  stats-committed flag). Unlike Chinchon -- whose snapshot is only valid at
   *  a round boundary -- every Tic Tac Toe position is settled, so there is no
   *  mid-turn state to be careful about; this follows Escoba's per-move
   *  cadence instead.
   *
   *  `seq` is read AFTER the move's own MP bookkeeping (see _afterStateChange's
   *  ordering note): the saved seq always matches the move already inside the
   *  saved state, so a rejoin replays only genuinely new entries. */
  _mpSaveSnapshot() {
    const mp = this.mp;
    if (!mp || !this.state) return;
    try {
      saveJSON(MP_SAVE_KEY, {
        v: 1,
        code: mp.code, role: mp.role,
        seq: mp.appliedSeq | 0,
        at: Date.now(),
        variant: mp.variant,
        gameNum: mp.gameNum | 0,
        xSeat: mp.xSeat | 0,
        series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
        // false = the room is BETWEEN games (this game finished, the next
        // record has not arrived). The restore path branches on it.
        midGame: !this.state.over,
        statsCommitted: !!this._statsCommitted,
        state: this.state,
      });
    } catch { /* private mode / quota */ }
  }

  /** Read back the MP save, or null. A stale one (older than the rejoin
   *  window) is wiped here rather than restored. */
  _mpLoadSave() {
    const raw = loadJSON(MP_SAVE_KEY, null);
    if (!raw || raw.v !== 1 || !raw.code || !raw.state) return null;
    if (raw.role !== 'host' && raw.role !== 'guest') return null;
    if (raw.variant !== 'classic' && raw.variant !== 'ultimate') return null;
    if (!validState(raw.state, raw.variant, false)) { this._mpClearSave(); return null; }
    if (Date.now() - (raw.at || 0) > MP_RESTORE_MAX_AGE_MS) { this._mpClearSave(); return null; }
    return raw;
  }

  _mpClearSave() { try { localStorage.removeItem(MP_SAVE_KEY); } catch { /* ignore */ } }

  /** Backgrounding/restore: an MP autosave younger than 30 minutes, with the
   *  room still alive, reattaches to the same room and replays whatever landed
   *  while this device was away, instead of dropping the player back on a blank
   *  setup screen. Runs once, right after mount(). */
  async _tryRestoreMP(save) {
    const { code, role } = save;
    try {
      if (role === 'guest') {
        const res = await net.joinRoom(code, this._myIdentity());
        if (res.error || (res.room && res.room.status === 'ended')) { this._mpClearSave(); return; }
      } else if (!(await net.init())) return;
    } catch { return; }
    if (this._dead || this.mp || this.view === 'game') return;   // superseded by a faster user action

    this.mp = this._mpNewState(role, code, null, save.variant);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.xSeat = save.xSeat === 1 ? 1 : 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    // The series tally is carried through UNTOUCHED. A restore that rebuilt the
    // room from scratch and zeroed it would be the initMatch-wipe of invariant
    // 5 in this game's vocabulary: with both devices restoring at once there is
    // no authoritative host left to recover the record from.
    mp.series = this._mpNormalizeSeries(save.series);
    mp.lastScoredGame = save.midGame ? 0 : mp.gameNum;
    this.marks = mp.xSeat === 0 ? [X, O] : [O, X];
    this.state = save.state;
    this._statsCommitted = !!save.statsCommitted;
    this.view = 'game';
    this.busy = false;
    net.heartbeat(code, role);
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;
    this.renderGame();

    if (save.midGame) {
      this._mpTryDeliverNextMove();
      return;
    }
    // A BOUNDARY save: the saved game is over and the room is between games.
    // Record it first if the device died before it could (the flag is what
    // stops a double count), then move to the next game -- which for the GUEST
    // means waiting for the host's record rather than deriving who opens
    // locally (invariant 5).
    if (this.state.over) this._commitStats();
    if (role === 'guest') await this._mpAwaitNextGame();
    else await this._mpStartNextGame();
  }

  // --- how to play ------------------------------------------------------------

  /** The one thing prose explains badly: play the top-right cell of a board,
   *  your opponent is sent to the top-right board. Nine board outlines, one
   *  shown with its own 3x3 grid and a marked cell, an arrow to the matching
   *  board. Colors ride on top of shape (mark, outline, arrow), never alone. */
  _forcedBoardDiagram() {
    return `<svg class="ttt-diagram" viewBox="0 0 224 224" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="ttt-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ttt-gold)"/>
        </marker>
      </defs>
      <rect x="10" y="10" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="10" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="148" y="10" width="66" height="66" rx="6" class="ttt-dg-board ttt-dg-dest"/>
      <rect x="10" y="79" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="79" width="66" height="66" rx="6" class="ttt-dg-board ttt-dg-src"/>
      <rect x="148" y="79" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="10" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="148" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <g class="ttt-dg-grid">
        <line x1="101" y1="79" x2="101" y2="145"/><line x1="123" y1="79" x2="123" y2="145"/>
        <line x1="79" y1="101" x2="145" y2="101"/><line x1="79" y1="123" x2="145" y2="123"/>
      </g>
      <g class="ttt-dg-mark">
        <line x1="127" y1="83" x2="141" y2="97"/><line x1="141" y1="83" x2="127" y2="97"/>
      </g>
      <path d="M139,85 Q166,58 179,44" class="ttt-dg-arrow" marker-end="url(#ttt-dg-arrowhead)"/>
    </svg>`;
  }

  /** Minimal Classic diagram: a 3x3 grid, three-in-a-row on the diagonal
   *  highlighted (diagonal chosen because, even in a 3x3, it's the least
   *  obvious of the eight winning lines -- rows/columns are self-evident).
   *  Same shape-not-color discipline as the Ultimate diagram: the winning
   *  line is carried by an actual connecting stroke, not by hue alone. */
  _classicDiagram() {
    return `<svg class="ttt-diagram ttt-diagram-classic" viewBox="0 0 108 108" role="img" aria-label="${t('help_classic_diagram_aria')}">
      <g class="ttt-dg-grid">
        <line x1="36" y1="4" x2="36" y2="104"/><line x1="72" y1="4" x2="72" y2="104"/>
        <line x1="4" y1="36" x2="104" y2="36"/><line x1="4" y1="72" x2="104" y2="72"/>
      </g>
      <g class="ttt-dg-mark">
        <line x1="10" y1="10" x2="26" y2="26"/><line x1="26" y1="10" x2="10" y2="26"/>
      </g>
      <g class="ttt-dg-mark">
        <line x1="46" y1="46" x2="62" y2="62"/><line x1="62" y1="46" x2="46" y2="62"/>
      </g>
      <g class="ttt-dg-mark">
        <line x1="82" y1="82" x2="98" y2="98"/><line x1="98" y1="82" x2="82" y2="98"/>
      </g>
      <line x1="12" y1="12" x2="96" y2="96" class="ttt-dg-winline"/>
    </svg>`;
  }

  /** Variant-aware content (bug fix, batch D/FB3-HOWTO3): the sheet must
   *  match whichever variant is actually being played, not always Ultimate.
   *  Mid-game it reads the LIVE game's variant (this.state.variant); at
   *  setup it reads the pending selection (this._setup.variant) -- so it's
   *  always accurate whether opened from the setup screen or the in-game
   *  help button. */
  openHelp() {
    this.closeOverlays();
    const variant = (this.view === 'game' && this.state) ? this.state.variant : this._setup.variant;
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = variant === 'ultimate' ? this._helpUltimateMarkup() : this._helpClassicMarkup();
    this.root.appendChild(overlay);
  }

  _helpUltimateMarkup() {
    return `
      <div class="ttt-scrim" data-action="close-overlay"></div>
      <div class="ttt-card ttt-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="ttt-card-title">${t('howto')}</h3>
        <p class="ttt-help-lead">${t('help_lead')}</p>
        <div class="ttt-diagram-wrap">${this._forcedBoardDiagram()}</div>
        <div class="ttt-help-lines">
          <p class="ttt-help-caption">${t('help_caption')}</p>
          <p class="ttt-help-example">${t('help_example')}</p>
          <p class="ttt-help-rule">${t('help_rule')}</p>
        </div>
      </div>`;
  }

  /** Classic is barely more than the diagram (root CLAUDE.md item 3: "Classic
   *  barely needs more than the diagram") -- goal line, diagram, one caption,
   *  no example, no bullets. */
  _helpClassicMarkup() {
    return `
      <div class="ttt-scrim" data-action="close-overlay"></div>
      <div class="ttt-card ttt-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="ttt-card-title">${t('howto')}</h3>
        <p class="ttt-help-lead">${t('help_classic_lead')}</p>
        <div class="ttt-diagram-wrap">${this._classicDiagram()}</div>
        <div class="ttt-help-lines">
          <p class="ttt-help-caption">${t('help_classic_caption')}</p>
        </div>
      </div>`;
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.ttt-overlay').forEach((el) => el.remove());
  }

  // --- events -------------------------------------------------------------

  onInput(e) {
    const el = e.target.closest('[data-role="mp-code-input"]');
    if (!el) return;
    const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (el.value !== clean) el.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.root.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'toggle-row') {
      const row = btn.dataset.row;
      this._setupExpanded = this._setupExpanded === row ? null : row;
      this.renderSetup();
    } else if (action === 'set-variant') {
      this._setup.variant = btn.dataset.v;
      this._saveSetup();
      this.renderSetup();
    } else if (action === 'set-diff') {
      this._setup.difficulty = btn.dataset.v;
      this._saveSetup();
      this.renderSetup();
    } else if (action === 'set-first') {
      this._setup.firstMode = btn.dataset.v;
      this._saveSetup();
      this.renderSetup();
    } else if (action === 'set-mode') {
      this._mode = btn.dataset.v;
      this._setupExpanded = null;
      this._mpError = '';
      this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'cell') {
      this.humanMove(Number(btn.dataset.cell));
    } else if (action === 'scell') {
      this.humanMove({ board: Number(btn.dataset.board), cell: Number(btn.dataset.cell) });
    } else if (action === 'restart') {
      // Same-settings restart, mid-game (Task 4). Counts as a new completed
      // game for Alternate-mode purposes, same as Connect Four's menu-restart.
      this.confirmDestructive(btn, () => this.startGame());
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'change-settings') {
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
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
    } else if (action === 'mp-end-ok') {
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'mp-update-required') {
      this._mpForceUpdate();
    }
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new TicTacToeUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
