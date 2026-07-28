// ui.js - Dots and Boxes UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen follows Escoba's accordion pattern (one settings row open at a
// time, toggle-row/is-open), per Matt's explicit ranking of setup screens in
// this repo (2026-07-21: Escoba is the model; Filler is an acceptable
// fallback; Mancala and Connect Four are not to be copied) -- Tic Tac Toe is
// the newest game built to the same convention and is this file's structural
// template. CSS scoping discipline follows Mancala (every rule descendant-
// scoped under .db-root). The settings KEY follows Filler/Tic Tac Toe's
// convention (gamehub.<game>.v1).
//
// game.js/ai.js stay pure and synchronous (no DOM, no async agent interface):
// a Dots and Boxes move has no multi-step resolution to await from the
// engine's point of view (chain captures are just repeated calls to
// applyMove/chooseMove for the same player), so this mirrors Filler/Mancala/
// Tic Tac Toe's direct-call shape instead of Escoba/Chinchon's agent
// interface.
//
// MULTIPLAYER (roadmap phase 2, web-session pass). Two human seats only, host
// seat 0 / guest seat 1, over the shared js/net.js room protocol -- js/net.js
// itself is untouched. The remote seat is NOT an agent object (no agent
// interface exists here): it is a third kind of turn owner in the UI's own
// dispatch, same shape as Tic Tac Toe/Mancala. MOVE GRANULARITY: one lockstep
// move per drawn EDGE (matches game.js's applyMove()), never a whole chain
// batched into one move -- the simplest thing that can work, and the one
// design choice this web session cannot fully de-risk (a long chain on Large
// means many rapid edges inside a single real turn; see the handoff for the
// real-device latency check). Every "self" lookup goes through
// _localSeat()/humanSeat; see the block comment above _localSeat().

import { newGame, legalMoves, applyMove, edgeKey, edgeCount, isOver, score } from './game.js';
import { chooseMove } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordDotsBoxes, recordHeadToHead, loadStats, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.dotsboxes.v1';
const GAME_KEY = 'gamehub.dotsboxes.save.v1';   // the one in-progress game (see saveGame/loadGame)
// The MULTIPLAYER autosave, a THIRD key, distinct from both of the above and never read or
// written by either of the other two paths (THE LAW rule 5: permanent once shipped). Follows
// Chinchon's/Tic Tac Toe's/Mancala's separate-key choice, not Escoba's mp-sub-object shape.
const MP_SAVE_KEY = 'gamehub.dotsboxes.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// The difficulty bucket a MULTIPLAYER result records under -- settled by Tic Tac Toe
// (js/CLAUDE.md, "The third consumer: Tic Tac Toe"; HANDOFF-MP-WEB-SESSION.md touchpoint 5). A
// real human opponent has no AI tier; 'mp' is unmapped in js/difficulty-tiers.js, so tierOf()
// returns null and the play counts in every total/the leaderboard's "All" filter with no tier
// pill. Follow it -- a second convention here would split one player's MP history across two
// bucket names for no benefit.
const MP_DIFFICULTY = 'mp';
// Paced delay between successively DELIVERED remote edges (this game animates a captured box's
// claim with the CSS "is-claim" pop, ~260ms -- see dots-boxes.css). Matches that duration so a
// remote chain capture reads as a sequence of drawn edges, the same way the AI's own chain
// pacing (AI_CHAIN_STEP_MS below) does, rather than the whole chain snapping in at once. This
// is also what OPENS the async gap _mpTryDeliverNextMove's redeliverRequested guard exists for
// (js/CLAUDE.md's Mancala section, "an ASYNC delivery loop... needs one MORE piece"): a room
// update carrying a fresh entry can land while a delivery is mid-delay.
const MP_DELIVER_STEP_MS = 260;
const AI_THINK_MS = 500;      // pause before the AI's first move of a fresh turn
const AI_CHAIN_STEP_MS = 220; // faster pacing between successive chain-capture moves

// Board size is a SETTING, not the difficulty tier (AI skill is, see DIFFICULTIES
// below) -- the two are independent axes, see root CLAUDE.md / the handoff. Values
// (first element) stay canonical; labelKey resolves via t().
const SIZES = [['small', 'size_small', 3, 3], ['medium', 'size_medium', 4, 4], ['large', 'size_large', 10, 10]];
const SIZE_META = Object.fromEntries(SIZES.map(([k, labelKey, rows, cols]) => [k, { labelKey, rows, cols }]));
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Easy/Medium/Hard) -- do not invent
// new tier names here.
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/dots-boxes.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/dots-boxes.css'));
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

// Shared hard validation for any restored edge/box grid (solo save, MP save, recovery
// snapshot). A corrupt or non-standard shape is treated as "invalid" rather than crashing the
// module on mount.
const validCell = (v) => v === null || v === 0 || v === 1;
const validGrid = (grid, nRows, nCols) => Array.isArray(grid) && grid.length === nRows
  && grid.every((row) => Array.isArray(row) && row.length === nCols && row.every(validCell));

/** Shared hard validation for any restored MULTIPLAYER engine state (MP autosave, recovery
 *  snapshot) against a given board size. Mirrors mancala/js/ui.js's validMpBoardState. */
function validDbBoardState(s, size) {
  const meta = SIZE_META[size];
  if (!meta || !s || typeof s !== 'object') return false;
  if (!validGrid(s.hEdges, meta.rows + 1, meta.cols)) return false;
  if (!validGrid(s.vEdges, meta.rows, meta.cols + 1)) return false;
  if (!validGrid(s.boxes, meta.rows, meta.cols)) return false;
  return s.turn === 0 || s.turn === 1;
}

/** Persist the in-progress match so leaving (hub, Menu, a reload, or closing
 *  the PWA) never loses it. Only ever holds ONE unfinished game; cleared the
 *  moment it finishes or a new one starts. Mirrors mancala/js/ui.js's
 *  saveGame/loadGame/clearGame pattern -- do not invent a new shape. */
function saveGame(ui) {
  try {
    if (!ui.state || isOver(ui.state) || ui.view !== 'game') { clearGame(); return; }
    const s = ui.state;
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      size: ui._setup.size,
      difficulty: ui._setup.difficulty,
      rows: s.rows,
      cols: s.cols,
      hEdges: s.hEdges,
      vEdges: s.vEdges,
      boxes: s.boxes,
      turn: s.turn,
      drawnEdges: s.drawnEdges,
      totalEdges: s.totalEdges,
      humanSeat: ui.humanSeat,
      aiSeat: ui.aiSeat,
      lastCaptured: ui._lastCaptured,
      humanChainRun: ui._humanChainRun,
      humanBestChainThisGame: ui._humanBestChainThisGame,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard (board size must match a
 *  real SIZE_META entry and every array must be shaped exactly right for
 *  that size) so a corrupt or stale-shape save is treated as "no saved
 *  game" rather than crashing the module on mount. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    const meta = SIZE_META[raw.size];
    if (!meta) return null;
    const rows = Math.round(Number(raw.rows));
    const cols = Math.round(Number(raw.cols));
    if (rows !== meta.rows || cols !== meta.cols) return null;
    if (!DIFFICULTIES.some(([k]) => k === raw.difficulty)) return null;

    if (!validGrid(raw.hEdges, rows + 1, cols)) return null;
    if (!validGrid(raw.vEdges, rows, cols + 1)) return null;
    if (!validGrid(raw.boxes, rows, cols)) return null;

    const totalEdges = (rows + 1) * cols + rows * (cols + 1);
    const drawnEdges = Math.max(0, Math.round(Number(raw.drawnEdges)) || 0);
    if (drawnEdges >= totalEdges) return null; // an already-finished board is not "in progress"
    const humanSeat = raw.humanSeat === 1 ? 1 : 0;

    return {
      size: raw.size,
      difficulty: raw.difficulty,
      rows, cols,
      hEdges: raw.hEdges,
      vEdges: raw.vEdges,
      boxes: raw.boxes,
      turn: raw.turn === 1 ? 1 : 0,
      drawnEdges,
      totalEdges,
      humanSeat,
      aiSeat: 1 - humanSeat,
      lastCaptured: Array.isArray(raw.lastCaptured) ? raw.lastCaptured.filter((p) => Array.isArray(p) && p.length === 2) : [],
      humanChainRun: Math.max(0, Math.round(Number(raw.humanChainRun)) || 0),
      humanBestChainThisGame: Math.max(0, Math.round(Number(raw.humanBestChainThisGame)) || 0),
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

class DotsBoxesUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.view = 'setup';
    this._setupExpanded = null;
    this.state = null;
    this.busy = false;
    this.humanSeat = 0;
    this.aiSeat = 1;
    this.aiTimer = null;
    this._chaining = false;
    this._lastCaptured = [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = 0;
    this._confirmTimer = null;
    this._setup = this._loadSetup();
    this._statsCommitted = false;

    // Multiplayer session state, or null in solo. Everything MP-specific hangs off this one
    // field, so `if (this.mp)` is the whole mode test (mirrors tic-tac-toe/js/ui.js and
    // mancala/js/ui.js).
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
    this._mpDelayTimer = null;

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);

    ensureStylesheet();
    this.mount();
    // Come back to exactly where you left off. A live MULTIPLAYER room takes precedence over a
    // solo save (starting an MP match clears the solo slot, so in practice only one of the two
    // is ever fresh) and is restored asynchronously, since it has a room to rejoin first.
    // Mirrors mancala/js/ui.js's mount-time check.
    const mpSave = this._mpLoadSave();
    if (mpSave) {
      this.renderSetup();
      this._tryRestoreMP(mpSave);
      return;
    }
    // An unfinished SOLO match (from the hub back button, the in-game Menu
    // button, a reload, or closing the PWA) resumes straight onto the board,
    // no setup screen and no "resume?" dialog. Otherwise start at setup.
    const saved = loadGame();
    if (saved) this._resumeGame(saved); else this.renderSetup();
  }

  destroy() {
    this._dead = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._mpDelayTimer) { clearTimeout(this._mpDelayTimer); this._mpDelayTimer = null; }
    clearTimeout(this._confirmTimer);
    if (this.mp) this._mpSaveSnapshot();
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
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('input', this._onInput);
    }
    this.container.innerHTML = '';
    this.state = null;
  }

  // Dots and Boxes autosaves after every drawn edge (see saveGame/loadGame,
  // key GAME_KEY = 'gamehub.dotsboxes.save.v1') and resumes straight back
  // onto the board on the next mount -- leaving mid-match costs nothing. Per
  // root CLAUDE.md's "two legitimate meanings" note on isInProgress(), SOLO
  // uses the autosave/resume meaning: false even mid-game, because a resumed
  // match is exactly where you left it.
  //
  // MULTIPLAYER is the exception within the exception, same as Tic Tac Toe
  // and Mancala: leaving is consequential for the live opponent (their room
  // goes stale) even though this device could rejoin, so the hub's "leave
  // game?" confirm IS wanted. True for as long as a room is joined --
  // including BETWEEN games in a rematch series.
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
    // First-move mode (2026-07-24, batch 8): 'you' | 'opponent' | 'alternate'.
    // `humanFirst` is the FROZEN gen-1 field (existing shape, never renamed) --
    // if a device has an explicit legacy `humanFirst` boolean saved (from before
    // Alternate existed), that choice always wins and maps to 'you'/'opponent'.
    // A device with NO saved choice at all (fresh `{}`, no `firstMode`, no
    // `humanFirst`) defaults to 'alternate', per Matt's "every turn-based game
    // should alternate who goes first by default" (same call as Connect Four's
    // identical 2026-07-23 change, gamehub.connect4.v1).
    let firstMode;
    if (['you', 'opponent', 'alternate'].includes(saved.firstMode)) {
      firstMode = saved.firstMode;
    } else if (typeof saved.humanFirst === 'boolean') {
      firstMode = saved.humanFirst ? 'you' : 'opponent';
    } else {
      firstMode = 'alternate';
    }
    const nextStarter = saved.nextStarter === 'opponent' ? 'opponent' : 'you';
    return {
      size: SIZE_META[saved.size] ? saved.size : 'medium',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      firstMode,
      nextStarter,
    };
  }

  _saveSetup() {
    const s = this._setup;
    // humanFirst is kept in step with the resolved mode (frozen field, still
    // written) so any older/unexpected reader of this key sees a sane boolean;
    // firstMode/nextStarter are the new, additive fields that actually govern
    // Alternate. Only size/difficulty/humanFirst existed before this change.
    saveJSON(SETTINGS_KEY, {
      size: s.size,
      difficulty: s.difficulty,
      humanFirst: s.firstMode === 'opponent' ? false : true,
      firstMode: s.firstMode,
      nextStarter: s.nextStarter,
    });
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
    try { rec = (loadStats().games || {}).dotsboxes; } catch { rec = null; }
    const db = rec && rec.db;
    if (!db || !db.played) return '';
    return t('stats_line', { played: db.played, w: db.won | 0, l: db.lost | 0, t: db.tied | 0, chain: db.bestChain | 0 });
  }

  // --- seats ------------------------------------------------------------------

  /** The local player's network seat: always 0 in solo. In MP the host is seat 0 and the GUEST
   *  IS SEAT 1 -- every "self" lookup must go through this rather than assume seat 0, or a guest
   *  reads the host's side of the board as its own (and, worse, records the host's result as its
   *  own: a THE LAW rule 2 violation, since a loss written as a win is not additive-safe). Stated
   *  as a rule at escoba/js/ui.js:860, tic-tac-toe/js/ui.js:316, mancala/js/ui.js:358; built in
   *  here from the first line of the multiplayer pass rather than retrofitted.
   *
   *  Engine seat 0/1 (humanSeat/aiSeat, box ownership, s.turn) is SYMMETRIC -- unlike Mancala's
   *  physically different board halves, a Dots and Boxes box can be claimed by either seat, so
   *  which engine seat a given network seat plays is reassigned every game (mp.dealer is the
   *  network seat that plays engine seat 0, i.e. opens), the same "swappable marks" shape as Tic
   *  Tac Toe's marks[] -- not Mancala's fixed-seat deviation. humanSeat/aiSeat below are already
   *  the resolved engine seats and every render/game-logic path already goes through them
   *  unchanged; only WHERE they get set (_resolveStarter() in solo, mp.dealer in MP) differs. */
  _localSeat() { return this.mp ? this.mp.localSeat : 0; }
  _remoteSeat() { return 1 - this._localSeat(); }
  /** The board size actually being played: the host's chosen size in MP (the guest never picks
   *  one -- it arrives via room config, see _mpNewState), else the solo setup's own size. */
  _boardSizeKey() { return this.mp ? this.mp.size : this._setup.size; }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="db-root"><div class="db-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.db-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('input', this._onInput);
    // Caller (constructor) decides setup vs. resume straight into the game.
  }

  // --- setup screen -----------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="db-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="db-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${esc(lbl)}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="db-row ${open ? 'is-open' : ''}">
      <button type="button" class="db-row-head" data-action="toggle-row" data-row="${key}">
        <span class="db-row-label">${label}</span><span class="db-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="db-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _sizeContent() {
    const s = this._setup;
    const meta = SIZE_META[s.size];
    const hint = t('hint_size_boxes', { rows: meta.rows, cols: meta.cols });
    return this._seg('set-size', s.size, SIZES.map(([k, labelKey]) => [k, t(labelKey)]))
      + `<p class="db-hint">${hint}</p>`;
  }

  /** Difficulty picker with a ski-slope shape (diffShapeSVG/tierOf, the same
   *  shared shapes the leaderboard uses) before each label -- no explanation
   *  prose anymore (Matt asked for the per-tier hint paragraph removed). */
  _diffContent() {
    const s = this._setup;
    const btns = DIFFICULTIES.map(([v, k]) => {
      const shape = diffShapeSVG(tierOf(v));
      return `<button type="button" class="db-segbtn ${v === s.difficulty ? 'is-selected' : ''}" data-action="set-diff" data-v="${v}">${shape}<span>${esc(t(k))}</span></button>`;
    }).join('');
    return `<div class="db-seg">${btns}</div>`;
  }

  _firstContent() {
    const id = this._identity();
    const oppLabel = this._mode === 'host' ? t('mp_opponent_label') : id.oppName;
    return this._seg('set-first', this._setup.firstMode,
      [['you', t('you')], ['opponent', esc(oppLabel)], ['alternate', t('alternate')]]);
  }

  /** Display label for the collapsed "First move" row. */
  _firstLabel() {
    const id = this._identity();
    const m = this._setup.firstMode;
    const oppLabel = this._mode === 'host' ? t('mp_opponent_label') : id.oppName;
    return m === 'you' ? t('you') : m === 'opponent' ? oppLabel : t('alternate');
  }

  // --- multiplayer lobby ------------------------------------------------------

  _modeSeg() {
    return this._seg('set-mode', this._mode, [
      ['solo', t('mode_solo')], ['host', t('mode_host')], ['join', t('mode_join')],
    ]);
  }

  /** Join mode's body: the code input lives on the setup screen itself, never its own pre-join
   *  screen -- _lobby only switches to 'join' once the join has actually succeeded (see
   *  _mpJoinSubmit). Mirrors tic-tac-toe/js/ui.js's Join mode. */
  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="db-mp-msg db-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="db-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : t('mp_join_hint')))}</p>`;
    return `<div class="db-mp-lobby">
      <span class="db-mp-label">${t('mp_enter_code')}</span>
      <input class="db-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}"
        autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="db-btn db-btn-primary" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = `<button type="button" class="db-btn db-btn-ghost" data-action="mp-cancel">${t('mp_back_btn')}</button>`;
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="db-mp-lobby">
        <span class="db-mp-label">${t('mp_code_aria')}</span>
        <div class="db-mp-code">${code ? esc(code) : '····'}</div>
        <span class="db-mp-label">${t('mp_opponent_label')}</span>
        <div class="db-mp-oppslot">${guest
          ? `<span>${esc(guest.avatar || '🙂')}</span><span>${esc(guest.name || '')}</span>`
          : `<span class="db-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="db-mp-summary">${esc(t(SIZE_META[this._setup.size].labelKey))}</p>
        <p class="db-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="db-btn db-btn-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    const sizeKey = room && room.config && SIZE_META[room.config.size] ? room.config.size : 'medium';
    return `<div class="db-mp-lobby">
      <span class="db-mp-label">${t('mp_code_aria')}</span>
      <div class="db-mp-code">${esc(this._mpJoinedCode || '')}</div>
      <span class="db-mp-label">${t('mp_host_label')}</span>
      <div class="db-mp-oppslot">${host
        ? `<span>${esc(host.avatar || '🙂')}</span><span>${esc(host.name || '')}</span>`
        : `<span class="db-mp-oppempty">—</span>`}</div>
      <p class="db-mp-summary">${esc(t(SIZE_META[sizeKey].labelKey))}</p>
      <p class="db-mp-msg" data-role="mp-msg">${t('mp_waiting_host')}</p>
      ${back}
    </div>`;
  }

  _setMpStatus(key) { this._mpStatusMsg = key; this._rerender(); }
  _clearMpStatus() { if (!this._mpStatusMsg) return; this._mpStatusMsg = ''; this._rerender(); }
  _rerender() {
    if (this._dead) return;
    if (this.view === 'game' && this.state) this.renderGame(); else this.renderSetup();
  }

  /** Keep the code input's message slot fresh without re-rendering the input itself (which
   *  would drop what the player is typing). */
  _syncMpMsgSlot() {
    const slot = this.shell && this.shell.querySelector('[data-role="mp-msg"]');
    if (!slot) return;
    slot.textContent = this._mpError || (this._mpBusy ? t('mp_joining') : t('mp_join_hint'));
  }

  onInput(e) {
    const el = e.target.closest('[data-role="mp-code-input"]');
    if (!el) return;
    const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (el.value !== clean) el.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    this.view = 'setup';
    this.state = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    const head = `
      <h1 class="db-title">${t('title')}</h1>
      <p class="db-sub">${t('tagline')}</p>
      ${stats ? `<p class="db-stats">${esc(stats)}</p>` : ''}
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
      ${hosting ? '' : `<div class="db-vscard">
        <div class="db-vsside"><span class="db-vsemoji">${esc(id.humanEmoji)}</span><span class="db-vsname">${esc(id.humanName)}</span></div>
        <span class="db-vslabel">${t('vs')}</span>
        <div class="db-vsside"><span class="db-vsemoji">${esc(id.oppEmoji)}</span><span class="db-vsname">${esc(id.oppName)}</span></div>
      </div>`}
      <div class="db-summary">
        ${this._row('size', t('row_size'), t(SIZE_META[s.size].labelKey), this._sizeContent())}
        ${hosting ? '' : this._row('difficulty', t('row_difficulty'), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
        ${this._row('first', t('row_first'), this._firstLabel(), this._firstContent())}
      </div>
      ${hosting
        ? `<p class="db-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
           <button type="button" class="db-btn db-btn-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`
        : `<button type="button" class="db-btn db-btn-primary" data-action="start">${t('start')}</button>`}
      <button type="button" class="db-link" data-action="help">${t('howto')}</button>`;
  }

  // --- game screen --------------------------------------------------------

  /** Resolve who opens the next game and bank the Alternate flip immediately (before any move is
   *  played) so the choice survives navigating away mid-game -- mirrors mancala/js/ui.js's
   *  startGame() alternation pattern. Shared by solo, Restart/rematch, and every game of a
   *  multiplayer series (the HOST calls it; the guest never derives who opens, it reads the
   *  host's round record -- see _mpApplyRoundRecord). */
  _resolveStarter() {
    const s = this._setup;
    let starter;
    if (s.firstMode === 'alternate') {
      starter = s.nextStarter === 'opponent' ? 'opponent' : 'you';
      s.nextStarter = starter === 'you' ? 'opponent' : 'you';
    } else {
      starter = s.firstMode === 'opponent' ? 'opponent' : 'you';
    }
    this._saveSetup();
    return starter;
  }

  startGame() {
    const starter = this._resolveStarter();
    clearGame();   // a new game (fresh start, rematch, or Restart) replaces any saved one
    // newGame() always starts turn 0, so whichever seat we call human here IS
    // the opener -- the existing status line (_statusText, "Your turn" /
    // "{opp}'s turn") already announces this correctly with no new UI needed.
    this.humanSeat = starter === 'you' ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    const meta = SIZE_META[this._setup.size];
    this.state = newGame(meta.rows, meta.cols);
    this._lastCaptured = [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = 0;
    this.view = 'game';
    this._afterStateChange(false);
  }

  /** Rebuild the board from a saved game and hand the turn back to whoever
   *  had it -- if we left while the AI was mid-chain, it picks up right
   *  where it left off (`_afterStateChange` already schedules its move when
   *  `state.turn === aiSeat`). Mirrors mancala/js/ui.js's resumeGame(). */
  _resumeGame(saved) {
    this._setup.size = saved.size;
    this._setup.difficulty = saved.difficulty;
    this.humanSeat = saved.humanSeat;
    this.aiSeat = saved.aiSeat;
    this.state = {
      rows: saved.rows,
      cols: saved.cols,
      hEdges: saved.hEdges,
      vEdges: saved.vEdges,
      boxes: saved.boxes,
      turn: saved.turn,
      drawnEdges: saved.drawnEdges,
      totalEdges: saved.totalEdges,
    };
    this._lastCaptured = saved.lastCaptured;
    this._humanChainRun = saved.humanChainRun;
    this._humanBestChainThisGame = saved.humanBestChainThisGame;
    this.view = 'game';
    this._afterStateChange(false);
  }

  /** Single funnel after every state change (initial deal, human move, AI move, remote move):
   *  render, resolve a finished match, or schedule the AI's turn / wait on the remote seat.
   *  `chaining` is true iff the player about to move is continuing a capture streak from their
   *  own previous move (controls AI pacing and whether the human's best-chain-this-game counter
   *  resets).
   *
   *  MP ORDERING IS LOAD-BEARING (invariant 4). The multiplayer bookkeeping for the move that
   *  got us here -- the seq reservation + append for a local move (_mpAfterLocalMove, called
   *  BEFORE this), or the seq advance + hash verify for a remote one (_mpApplyNextEntry, which
   *  advances mp.appliedSeq before calling this) -- has ALREADY run by the time this executes,
   *  so the MP snapshot below records a seq that matches the move already inside it. Never hoist
   *  the save earlier than this point. */
  _afterStateChange(chaining) {
    if (this._dead) return;
    this._chaining = chaining;
    if (isOver(this.state)) {
      this.busy = false;
      this.renderGame();
      clearGame();   // a finished match has nothing left to resume (solo only; MP has no solo save)
      this.finish();
      return;
    }
    if (this.mp) {
      // The remote seat is driven by the room's move log, not a timer: where solo schedules the
      // AI below, MP renders and waits. The next entry may already be cached from an earlier
      // room update, so try to drain now.
      if (!chaining) this._humanChainRun = 0;
      this.busy = false;
      this.renderGame();
      this._mpSaveSnapshot();
      this._mpTryDeliverNextMove();
      return;
    }
    if (this.state.turn === this.aiSeat) {
      this.busy = true;
      this.renderGame();
      saveGame(this);   // checkpoint after every settled move (clears itself once over)
      const delay = chaining ? AI_CHAIN_STEP_MS : AI_THINK_MS;
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || isOver(this.state)) return;
        const move = chooseMove(this.state, this._setup.difficulty);
        const res = applyMove(this.state, move);
        this._lastCaptured = res.boxes;
        this._afterStateChange(res.again);
      }, delay);
    } else {
      if (!chaining) this._humanChainRun = 0;
      this.busy = false;
      this.renderGame();
      saveGame(this);   // checkpoint after every settled move (clears itself once over)
    }
  }

  /** Is `edge` legal in the current state? The single legality gate, read by the local tap path
   *  AND by every remote move before it is applied -- one gate for both seats is what makes a
   *  network-driven seat safe to add. */
  _isLegal(edge) {
    if (!this.state || isOver(this.state)) return false;
    return legalMoves(this.state).some((m) => edgeKey(m) === edgeKey(edge));
  }

  humanMove(edge) {
    if (this.busy || !this.state || isOver(this.state) || this.state.turn !== this.humanSeat) return;
    if (this.mp && this.mp.awaitingRecovery) return;
    if (!this._isLegal(edge)) return;
    const res = applyMove(this.state, edge);
    this._lastCaptured = res.boxes;
    if (res.claimed > 0) {
      this._humanChainRun += res.claimed;
      this._humanBestChainThisGame = Math.max(this._humanBestChainThisGame, this._humanChainRun);
    }
    if (this.mp) this._mpAfterLocalMove(edge);   // BEFORE the funnel's autosave (invariant 4)
    this._afterStateChange(res.again);
  }

  _statusText(s, id) {
    // An MP status (waiting/resyncing/opponent disconnected) outranks the ordinary turn text and
    // reuses the same slot rather than adding new DOM.
    if (this.mp && this._mpStatusMsg) return t(this._mpStatusMsg);
    if (isOver(s)) {
      const sc = score(s);
      const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
      return humanScore === aiScore ? t('tie_game') : (humanScore > aiScore ? t('you_win') : t('opp_wins', { opp: id.oppName }));
    }
    if (this.busy) return this._chaining ? t('opp_claims_again', { opp: id.oppName }) : t('opp_thinking', { opp: id.oppName });
    if (s.turn === this.humanSeat) return this._chaining ? t('you_claimed_again') : t('your_turn');
    return t('opp_turn', { opp: id.oppName });
  }

  _gridTemplate(n) {
    const tracks = [];
    for (let i = 0; i <= n; i++) { tracks.push('var(--db-dot)'); if (i < n) tracks.push('var(--db-cell)'); }
    return tracks.join(' ');
  }

  /** '' | 'is-human' | 'is-ai' for a seat owner (null|0|1) -- shared by edges
   *  and boxes so a player's lines and their claimed boxes read as the same
   *  color at a glance, the way the game is played on paper. */
  _ownerClass(owner) {
    return owner === null ? '' : (owner === this.humanSeat ? 'is-human' : 'is-ai');
  }

  _boardHtml(s, id) {
    const rows = s.rows, cols = s.cols;
    const canClickNow = !isOver(s) && !this.busy && s.turn === this.humanSeat && !(this.mp && this.mp.awaitingRecovery);
    const claimed = this._lastCaptured || [];
    const parts = [];
    for (let mr = 0; mr <= 2 * rows; mr++) {
      const rowIsDots = mr % 2 === 0;
      for (let mc = 0; mc <= 2 * cols; mc++) {
        const colIsDots = mc % 2 === 0;
        if (rowIsDots && colIsDots) {
          parts.push('<div class="db-dot" aria-hidden="true"></div>');
        } else if (rowIsDots) {
          const r = mr / 2, c = (mc - 1) / 2;
          const owner = s.hEdges[r][c];
          const drawn = owner !== null;
          const live = canClickNow && !drawn;
          parts.push(`<button type="button" class="db-edge db-edge-h ${drawn ? 'is-drawn' : ''} ${this._ownerClass(owner)} ${live ? 'is-live' : ''}"
            data-action="edge" data-etype="h" data-r="${r}" data-c="${c}" ${live ? '' : 'disabled'}
            aria-label="${t('edge_h_aria', { state: t(drawn ? 'line_drawn' : 'draw_line'), r: r + 1, c1: c + 1, c2: c + 2 })}">
            <span class="db-line" aria-hidden="true"></span></button>`);
        } else if (colIsDots) {
          const r = (mr - 1) / 2, c = mc / 2;
          const owner = s.vEdges[r][c];
          const drawn = owner !== null;
          const live = canClickNow && !drawn;
          parts.push(`<button type="button" class="db-edge db-edge-v ${drawn ? 'is-drawn' : ''} ${this._ownerClass(owner)} ${live ? 'is-live' : ''}"
            data-action="edge" data-etype="v" data-r="${r}" data-c="${c}" ${live ? '' : 'disabled'}
            aria-label="${t('edge_v_aria', { state: t(drawn ? 'line_drawn' : 'draw_line'), c: c + 1, r1: r + 1, r2: r + 2 })}">
            <span class="db-line" aria-hidden="true"></span></button>`);
        } else {
          const r = (mr - 1) / 2, c = (mc - 1) / 2;
          const owner = s.boxes[r][c];
          // No capture hint in MP (there is no difficulty tier for a real opponent).
          const capturable = owner === null && edgeCount(s, r, c) === 3 && !this.mp && this._setup.difficulty === 'beginner';
          const isNew = claimed.some(([br, bc]) => br === r && bc === c);
          const glyph = owner === null ? '' : esc(owner === this.humanSeat ? id.humanEmoji : id.oppEmoji);
          const label = owner === null
            ? t(capturable ? 'box_capturable_aria' : 'box_empty_aria', { r: r + 1, c: c + 1 })
            : t('box_claimed_aria', { r: r + 1, c: c + 1, who: owner === this.humanSeat ? id.humanName : id.oppName });
          parts.push(`<div class="db-box ${this._ownerClass(owner)} ${capturable ? 'is-capturable' : ''} ${isNew ? 'is-claim' : ''}" aria-label="${label}">
            ${glyph ? `<span class="db-glyph">${glyph}</span>` : ''}</div>`);
        }
      }
    }
    return `<div class="db-board" data-size="${this._boardSizeKey()}"
      style="grid-template-columns:${this._gridTemplate(cols)};grid-template-rows:${this._gridTemplate(rows)};"
      role="grid" aria-label="${t('board_aria')}">${parts.join('')}</div>`;
  }

  /** The running series tally, MP only. Read by SEAT so each device sees its own record first --
   *  the stored counters are seat-indexed, never device-relative (see _mpSnapshot). */
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
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const over = isOver(s);
    const series = this.mp ? `<p class="db-mp-series">${esc(this._seriesLine())}</p>` : '';
    this.shell.innerHTML = `
      <div class="db-topbar">
        <div class="db-idchip ${!over && s.turn === this.humanSeat ? 'is-turn' : ''}">
          <span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span><span class="db-score">${humanScore}</span>
        </div>
        <span class="db-vsdash">${t('vs')}</span>
        <div class="db-idchip ${!over && s.turn === this.aiSeat ? 'is-turn' : ''}">
          <span class="db-score">${aiScore}</span><span>${esc(id.oppName)}</span><span>${esc(id.oppEmoji)}</span>
        </div>
      </div>
      ${series}
      <p class="db-status" aria-live="polite">${esc(this._statusText(s, id))}</p>
      ${this._boardHtml(s, id)}
      <div class="db-actions">
        <button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="help">${t('howto')}</button>
        ${this.mp
          ? `<button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
          : `<button type="button" class="db-btn db-btn-ghost db-btn-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
             <button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="change-settings">${t('new_game')}</button>`}
      </div>`;
  }

  /** Record the finished game exactly once on THIS device.
   *
   *  Both devices in a multiplayer match run this, and that is NOT double-counting:
   *  gamehub.stats is keyed per PLAYER (statsKey()/statsId(), "Whose stats are these" in
   *  js/CLAUDE.md), so two devices each writing "I played one game" is two different people each
   *  correctly getting one. Idempotence is the local _statsCommitted flag, set BEFORE any write
   *  -- MP reaches game-end by several paths (normal finish, restore of a finished game), and the
   *  flag is what stops one game counting twice here. */
  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const s = this.state;
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const won = humanScore === aiScore ? null : humanScore > aiScore;
    const difficulty = this.mp ? MP_DIFFICULTY : this._setup.difficulty;
    const extras = { boxes: humanScore, bestChain: this._humanBestChainThisGame };
    try { recordDotsBoxes(difficulty, won, extras); } catch { /* never block the result */ }
    // Multiplayer only: capture WHO this was against while the room state is still live. Solo
    // has no `this.mp` and is untouched. Never allowed to block the ordinary result from being
    // recorded.
    const opp = this.mp && this.mp.opp;
    if (opp) { try { recordHeadToHead('dotsboxes', opp, won); } catch { /* never block the result */ } }
  }

  finish() {
    clearGame();   // belt and braces: _afterStateChange already cleared the save on game-over
    const s = this.state;
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const won = humanScore === aiScore ? null : humanScore > aiScore;
    this._commitStats();
    if (this.mp) this._mpAfterGameEnd();
    if (this.mp) this._mpSaveSnapshot();   // re-save with statsCommitted (and any series bump) set

    const id = this._identity();
    const title = won === null ? t('tie_game') : won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = won === null ? '🤝' : won ? '🏆' : id.oppEmoji;
    const isHost = !!(this.mp && this.mp.role === 'host');
    const series = this.mp ? `<p class="db-card-series">${esc(this._seriesLine())}</p>` : '';
    const sub = this.mp
      ? `${humanScore}-${aiScore} · ${t(SIZE_META[this._boardSizeKey()].labelKey)}`
      : `${humanScore}-${aiScore} · ${t(SIZE_META[this._setup.size].labelKey)} · ${t(DIFF_LABEL_KEY[this._setup.difficulty])}`;
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="db-scrim"></div>
      <div class="db-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="db-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="db-card-emoji">${emoji}</span>
        <h3 class="db-card-title">${esc(title)}</h3>
        <p class="db-card-sub">${sub}</p>
        ${series}
        <div class="db-card-actions">
          ${!this.mp
            ? `<button type="button" class="db-btn db-btn-primary" data-action="rematch">${t('play_again')}</button>
               <button type="button" class="db-btn db-btn-ghost" data-action="change-settings">${t('change_settings')}</button>`
            : isHost
              ? `<button type="button" class="db-btn db-btn-primary" data-action="mp-next-game">${t('play_again')}</button>
                 <button type="button" class="db-btn db-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`
              : `<p class="db-card-wait">${esc(t('mp_waiting_rematch', { opp: id.oppName }))}</p>
                 <button type="button" class="db-btn db-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`}
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------
  //
  // Everyone already knows "draw a line, fill the grid" -- the one genuinely
  // non-obvious mechanic is the extra turn (completing a box lets you go
  // again), so the sheet shows ONLY that, as a diagram, not a rules dump.
  // Same shape as Tic Tac Toe's how-to-play sheet: one bold goal line, a
  // diagram of the one confusing mechanic, a plain-word caption, an "X = Y"
  // example, then the one remaining edge case as its own sentence.

  /** Completing a box's 4th side (highlighted in YOUR color, checked off)
   *  claims it and hands you another move (the curved arrow to a second,
   *  still-open box) -- shape/arrow driven, color is a reinforcement on top,
   *  never the only signal. */
  _extraTurnDiagram() {
    return `<svg class="db-diagram" viewBox="0 0 224 224" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="db-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--db-gold)"/>
        </marker>
      </defs>
      <g class="db-dg-claimed">
        <rect x="16" y="70" width="88" height="88" rx="4" class="db-dg-fill"/>
        <line x1="16" y1="70" x2="104" y2="70" class="db-dg-side"/>
        <line x1="16" y1="70" x2="16" y2="158" class="db-dg-side"/>
        <line x1="16" y1="158" x2="104" y2="158" class="db-dg-side"/>
        <line x1="104" y1="70" x2="104" y2="158" class="db-dg-move"/>
      </g>
      <g class="db-dg-dots">
        <circle cx="16" cy="70" r="4.5"/><circle cx="104" cy="70" r="4.5"/>
        <circle cx="16" cy="158" r="4.5"/><circle cx="104" cy="158" r="4.5"/>
      </g>
      <g class="db-dg-open">
        <rect x="148" y="44" width="60" height="60" rx="4"/>
      </g>
      <g class="db-dg-dots db-dg-dots-open">
        <circle cx="148" cy="44" r="4"/><circle cx="208" cy="44" r="4"/>
        <circle cx="148" cy="104" r="4"/><circle cx="208" cy="104" r="4"/>
      </g>
      <path d="M108,85 Q140,40 150,55" class="db-dg-arrow" marker-end="url(#db-dg-arrowhead)"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const id = this._identity();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="db-scrim" data-action="close-overlay"></div>
      <div class="db-card db-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="db-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="db-card-title">${t('howto')}</h3>
        <p class="db-help-lead">${t('help_lead')}</p>
        <div class="db-diagram-wrap">${this._extraTurnDiagram()}</div>
        <div class="db-help-lines">
          <p class="db-help-caption">${t('help_caption')}</p>
          <p class="db-help-example">${t('help_example')}</p>
          <p class="db-help-rule">${t('help_rule')}</p>
        </div>
        <div class="db-help-legend">
          <span class="db-legend-chip is-human"><span class="db-legend-swatch" aria-hidden="true"></span>${t('you')}</span>
          <span class="db-legend-chip is-ai"><span class="db-legend-swatch" aria-hidden="true"></span>${esc(id.oppName)}</span>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.db-overlay').forEach((el) => el.remove());
  }

  /** Run `action` immediately if there's no live match to lose; otherwise
   *  require a second confirming tap on `btn` (guards Restart against
   *  accidentally discarding an in-progress game). Same shape as Connect
   *  Four's confirmDestructive/resetConfirms (connect-four/js/ui.js). */
  confirmDestructive(btn, action) {
    if (!this.state || isOver(this.state)) { action(); return; }
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
    const b = this.shell.querySelector('[data-action="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  // --- events -------------------------------------------------------------

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.root.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'toggle-row') {
      const row = btn.dataset.row;
      this._setupExpanded = this._setupExpanded === row ? null : row;
      this.renderSetup();
    } else if (action === 'set-size') {
      this._setup.size = btn.dataset.v;
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
    } else if (action === 'edge') {
      this.humanMove({ type: btn.dataset.etype, r: Number(btn.dataset.r), c: Number(btn.dataset.c) });
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
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

  // ==========================================================================
  // Multiplayer
  //
  // Room protocol (js/net.js, unchanged): rooms/<CODE> with a seq-keyed move log both sides
  // append into, a `round` record the HOST publishes, a `recovery` field, and heartbeats. Two
  // roles only. One room hosts a rematch SERIES, same vocabulary as Tic Tac Toe/Mancala:
  // round.n is the game number, round.dealer is the NETWORK seat (0 host / 1 guest) that plays
  // ENGINE seat 0 (i.e. opens) in that game -- see the seat block comment above _localSeat().
  // round.deck is unused. net.js's writeResult is deliberately NOT used, so status:'ended'
  // unambiguously means somebody abandoned the room (leaveRoom).
  //
  // Move payload: a single drawn EDGE ({type, r, c}) -- one lockstep move per edge, matching
  // game.js's applyMove() grain (see the file-header comment for why this granularity was
  // chosen over batching a whole chain capture into one move).
  // ==========================================================================

  _mpNewState(role, code, opp, size) {
    return {
      role, code,
      // Fixed at match start and never re-derived: host = network seat 0, guest = seat 1.
      localSeat: role === 'host' ? 0 : 1,
      // Who we are playing, `{ name, avatar, deviceId }` from the room. Null on the restore
      // path, where _mpOnRoomUpdate backfills it from the live room.
      opp: opp || null,
      size: SIZE_META[size] ? size : 'medium',
      gameNum: 0,
      // The NETWORK seat that plays engine seat 0 (opens) in the CURRENT game -- see the seat
      // block comment above _localSeat(). Host opens game 1, matching the single-game behavior
      // this replaces; alternated by the host every game via _resolveStarter() (_mpStartNextGame).
      dealer: 0,
      // Seat-indexed (by NETWORK seat), NEVER device-relative (see _mpSnapshot).
      series: { wins: [0, 0], draws: 0 },
      // Idempotence guard for _mpAfterGameEnd: finish() can run more than once for the same game
      // (a rematch overlay re-render, a restore of an already-finished game).
      lastScoredGame: 0,
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      replayMode: false, recoveryAttempts: 0, delivering: false,
      // Set by a GUEST that has flagged a divergence: stops it consuming the log until the
      // host's snapshot lands (see _mpOnDivergence). Dots and Boxes is flag-driven (no agent
      // interface), so it needs this latch explicitly -- without it, every subsequent room
      // update would re-deliver the same entry onto the already-diverged state.
      awaitingRecovery: false,
      // Set whenever a room update refreshes the move-log cache WHILE a drain is already in
      // flight (see _mpTryDeliverNextMove's comment): delivery here is asynchronous (each
      // remote edge gets a brief paced delay, MP_DELIVER_STEP_MS, so its capture pop can play
      // before the next edge lands -- same reasoning as mancala/js/ui.js's redeliverRequested),
      // so a fresh entry can land in the gap opened by that delay, right after the drain loop's
      // own "nothing left to apply" check already ran on stale data. Without this flag that
      // entry is silently dropped until some UNRELATED room update happens to trigger a new
      // drain -- which may never come, e.g. while both devices are otherwise idle.
      redeliverRequested: false,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
    };
  }

  /** Normalize a transmitted/restored series tally to the shape mp.series always holds -- same
   *  defensive shape as tic-tac-toe/js/ui.js's/mancala/js/ui.js's _mpNormalizeSeries. */
  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [w[0] | 0, w[1] | 0], draws: (s && s.draws) | 0 };
  }

  /** The move payload written to the room log. `g` is the game number this move belongs to: an
   *  entry from an earlier game of the series can never be consumed as this game's, no matter
   *  how a stale room snapshot is ordered (see _mpApplyNextEntry). */
  _mpEncodeMove(edge) { return { t: 'move', g: this.mp.gameNum, e: edge.type, r: edge.r | 0, c: edge.c | 0 }; }
  _mpDecodeMove(m) { return { type: m.e === 'v' ? 'v' : 'h', r: m.r | 0, c: m.c | 0 }; }

  /** Called immediately after a LOCAL move has been applied to this device's state, and always
   *  BEFORE the funnel's autosave. The seq is reserved SYNCHRONOUSLY (not after the network
   *  await) so nothing can race onto the same number, exactly as chinchon/js/ui.js's
   *  _mpAfterDecision does. */
  _mpAfterLocalMove(edge) {
    const mp = this.mp;
    if (!mp) return;
    const seq = ++mp.appliedSeq;
    const hash = stateHash(this.state);
    net.appendMove(mp.code, mp.role, seq, this._mpEncodeMove(edge), hash)
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
  }

  _mpDelay(ms) {
    return new Promise((resolve) => { this._mpDelayTimer = setTimeout(resolve, ms); });
  }

  /** Drain every deliverable entry from the cached log, ONE AT A TIME.
   *
   *  ASYNC, same reasoning as mancala/js/ui.js's version: each remote edge is applied then given
   *  a brief PACED delay (MP_DELIVER_STEP_MS, see _mpApplyNextEntry) before the next one in the
   *  log can be delivered, so a chain capture reads as a sequence of drawn edges instead of
   *  snapping in all at once. That await opens the same race Mancala's M1 probe caught: a room
   *  update carrying a fresh move can land in the gap right after the drain loop's own "nothing
   *  left to apply" check already read a stale cache. redeliverRequested is the guard. */
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
   *  Returns whether the drain should continue. */
  async _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || isOver(this.state)) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    // Belt and braces against a stale log: an entry stamped with a different game number is
    // never this game's move.
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;
    const edge = this._mpDecodeMove(entry.move);
    // Legality is checked against OUR state BEFORE applying: an already-diverged state could
    // otherwise silently absorb an "illegal" move (game.js's applyMove is a no-op on one) and
    // desync invisibly. Then the post-apply hash is compared with the sender's.
    let agreed = this._isLegal(edge);
    let res = null;
    if (agreed) { res = applyMove(this.state, edge); agreed = stateHash(this.state) === entry.h; }
    if (!agreed) return this._mpOnDivergence(seq);
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this._lastCaptured = res.boxes;
    this.busy = true;
    this.renderGame();   // show the just-drawn edge (and any capture pop) before pacing the next
    await this._mpDelay(MP_DELIVER_STEP_MS);
    if (this._dead || !this.mp) return false;
    this._afterStateChange(res.again);
    return true;
  }

  /** A remote entry did not match this device's state.
   *
   *  The HOST is authoritative (same rule as every other MP game here): it keeps its own state,
   *  TAKES THE SEQ anyway (not doing so would leave it writing its next move onto a number the
   *  peer has already used), and publishes a snapshot for the guest to rebuild from. The GUEST
   *  latches (awaitingRecovery) until that snapshot lands. Returns whether the drain should
   *  continue. */
  _mpOnDivergence(seq) {
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this._mpEndDueToError(); return false; }
    this._setMpStatus('mp_status_resyncing');
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      net.writeRecovery(mp.code, seq, this._mpSnapshot()).catch(() => {});
      this.renderGame();
      return true;
    }
    mp.awaitingRecovery = true;
    net.requestRecovery(mp.code, seq).catch(() => {});
    return false;
  }

  /** The full-state snapshot the host publishes for recovery, and the payload shape the MP
   *  autosave stores. Nothing device-relative: `state` is the absolute engine state (every array
   *  positional, never "my side first"), and a receiver derives its own side from _localSeat()
   *  and the seat-indexed dealer/series. This is invariant 2 ("a transmitted snapshot's isHuman
   *  flags are sender-relative") solved by construction rather than by remapping after the fact. */
  _mpSnapshot() {
    const mp = this.mp;
    return {
      v: 1,
      size: mp.size,
      gameNum: mp.gameNum,
      dealer: mp.dealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: this.state,
      lastCaptured: this._lastCaptured,
      humanBestChainThisGame: this._humanBestChainThisGame,
    };
  }

  /** Guest side of a resync: rebuild wholesale from the host's snapshot, re-deriving this
   *  device's own engine seat from its own network seat. Snaps directly to the recovered board
   *  rather than animating a resync nobody asked to watch (same as mancala/js/ui.js's recovery). */
  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery && recovery.state;
    if (!snap || !SIZE_META[snap.size] || !validDbBoardState(snap.state, snap.size)) return;
    mp.size = snap.size;
    mp.gameNum = snap.gameNum | 0;
    mp.dealer = snap.dealer === 1 ? 1 : 0;
    mp.series = this._mpNormalizeSeries(snap.series);
    this.humanSeat = this._localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    const st = snap.state;
    this.state = {
      rows: st.rows, cols: st.cols,
      hEdges: st.hEdges.map((row) => row.slice()),
      vEdges: st.vEdges.map((row) => row.slice()),
      boxes: st.boxes.map((row) => row.slice()),
      turn: st.turn === 1 ? 1 : 0,
      drawnEdges: st.drawnEdges | 0,
      totalEdges: st.totalEdges | 0,
    };
    this._lastCaptured = Array.isArray(snap.lastCaptured) ? snap.lastCaptured.filter((p) => Array.isArray(p) && p.length === 2) : [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = Math.max(0, Math.round(Number(snap.humanBestChainThisGame)) || 0);
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.lastScoredGame = isOver(this.state) ? mp.gameNum : mp.lastScoredGame;
    this.view = 'game'; this.busy = false;
    this.closeOverlays();
    this._mpStatusMsg = '';
    net.clearRecovery(mp.code).catch(() => {});
    this.renderGame();
    this._mpSaveSnapshot();
    if (isOver(this.state)) this.finish(); else this._mpTryDeliverNextMove();
  }

  /** Start the local game described by the host's round record. BOTH sides go through here --
   *  the host applies its own record the moment it publishes it, the guest applies the one it
   *  receives -- so a game's dealer assignment is decided in exactly one place, and it is always
   *  the host's. The guest NEVER derives who opens locally (invariant 5: the next round's deck
   *  must come from the host, not a local shuffle; here the equivalent datum is which network
   *  seat opens).
   *
   *  `room` is the snapshot the record arrived in, or null when the host applies its own. The
   *  move-log cache is rebuilt FROM THAT RECORD's room snapshot and never carried over: net.js's
   *  startRound clears `moves` atomically with the record, so a log entry can never be read
   *  across a game boundary (invariant 3's failure shape). */
  _mpApplyRoundRecord(round, room) {
    const mp = this.mp;
    if (!mp || this._dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.dealer = round.dealer === 1 ? 1 : 0;
    this.humanSeat = this._localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    mp.appliedSeq = 0;
    mp.replayMode = false;
    mp.recoveryAttempts = 0;
    mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this._statsCommitted = false;
    clearGame();   // an MP match supersedes any solo save
    const meta = SIZE_META[mp.size];
    this.state = newGame(meta.rows, meta.cols);
    this._lastCaptured = [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = 0;
    this.view = 'game';
    this.busy = false;
    this._mpStatusMsg = '';
    this.closeOverlays();
    this._afterStateChange(false);
  }

  /** Host only: publish the next game of the series and start it locally. */
  async _mpStartNextGame() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const starter = this._resolveStarter();
    const dealer = starter === 'you' ? this._localSeat() : this._remoteSeat();
    // Publish BEFORE applying locally. startRound clears the room's move log, so a very fast
    // first tap on an already-rendered board could otherwise be written and then wiped by our
    // own publish. The local apply still happens if the write fails, so an offline host is
    // never left stateless.
    try { await net.startRound(mp.code, n, null, dealer); }
    catch { this._setMpStatus('mp_status_connection_error'); }
    if (this._dead || !this.mp) return;
    // The room update carrying our own record may have raced us here and already applied it;
    // never rebuild a game that has begun.
    if ((this.mp.gameNum | 0) < n) this._mpApplyRoundRecord({ n, dealer }, null);
  }

  /** Series bookkeeping at the end of one game. Idempotent per game number: finish() can run
   *  more than once for the same game (a rematch overlay re-render, a restore of a finished
   *  game). Seat-indexed by NETWORK seat, mirroring mp.series. */
  _mpAfterGameEnd() {
    const mp = this.mp, s = this.state;
    if (!mp || !s || !isOver(s)) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    if (humanScore === aiScore) mp.series.draws += 1;
    else mp.series.wins[humanScore > aiScore ? this._localSeat() : this._remoteSeat()] += 1;
    this._mpSaveSnapshot();   // re-save with the tally set
  }

  // --- room lifecycle ---------------------------------------------------------

  /** The one room subscription for this device's whole MP session (lobby through the last
   *  game): net.js allows exactly one at a time. */
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
    // restore path, which starts with none). Only overwritten while the other side is actually
    // present, so a mid-match departure leaves the last known identity intact for the
    // stats/head-to-head write.
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;

    // This game never calls net.writeResult (see the vocabulary note above), so status:'ended'
    // means exactly one thing: the other device abandoned the room.
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
    } else if (roundN === (mp.gameNum | 0)) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      // See the redeliverRequested field comment: a drain already in flight (mp.delivering) may
      // have checked for this very entry against a stale cache a moment ago. Flag it regardless
      // of whether a drain is currently running -- harmless when one isn't, since
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
    const config = { size: this._setup.size };
    const res = await net.createRoom('dotsboxes', config, this._myIdentity());
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
    clearGame();   // an MP match supersedes any solo save
    this.mp = this._mpNewState('host', this._mpPendingCode, room.guest, this._setup.size);
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
    if (res.room && res.room.game && res.room.game !== 'dotsboxes') {
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
    const size = room.config && room.config.size;
    this.mp = this._mpNewState('guest', this._mpJoinedCode, room.host, size);
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

  /** Explicit abandon (the in-game/end-card Leave button), unlike destroy()'s backgrounding:
   *  this ends the room for the opponent too. */
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
   *  fabricating history. Whatever games in the series DID conclude were already recorded, each
   *  at its own end. */
  _mpEndModal(titleKey, subKey) {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="db-scrim"></div>
      <div class="db-card" role="dialog" aria-modal="true" aria-label="${t(titleKey)}">
        <button type="button" class="db-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="db-card-emoji">📡</span>
        <h3 class="db-card-title">${t(titleKey)}</h3>
        <p class="db-card-sub">${t(subKey)}</p>
        <div class="db-card-actions">
          <button type="button" class="db-btn db-btn-primary" data-action="mp-end-ok">${t('mp_back_to_setup')}</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave -------------------------------------------------------------

  /** Written from the post-move funnel after EVERY settled move (_afterStateChange), and again
   *  after a game concludes (_mpAfterGameEnd, for the series tally, and finish(), for the
   *  statsCommitted flag). `seq` is read AFTER the move's own MP bookkeeping (see
   *  _afterStateChange's ordering note): the saved seq always matches the move already inside
   *  the saved state, so a rejoin replays only genuinely new entries. */
  _mpSaveSnapshot() {
    const mp = this.mp;
    if (!mp || !this.state) return;
    try {
      localStorage.setItem(MP_SAVE_KEY, JSON.stringify({
        v: 1,
        code: mp.code, role: mp.role,
        seq: mp.appliedSeq | 0,
        at: Date.now(),
        size: mp.size,
        gameNum: mp.gameNum | 0,
        dealer: mp.dealer | 0,
        series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
        // false = the room is BETWEEN games (this game finished, the next record has not
        // arrived). The restore path branches on it.
        midGame: !isOver(this.state),
        statsCommitted: !!this._statsCommitted,
        lastScoredGame: mp.lastScoredGame | 0,
        state: this.state,
        lastCaptured: this._lastCaptured,
        humanChainRun: this._humanChainRun,
        humanBestChainThisGame: this._humanBestChainThisGame,
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
      if (!SIZE_META[raw.size]) return null;
      if (!validDbBoardState(raw.state, raw.size)) { this._mpClearSave(); return null; }
      if (Date.now() - (raw.at || 0) > MP_RESTORE_MAX_AGE_MS) { this._mpClearSave(); return null; }
      return raw;
    } catch { return null; }
  }

  _mpClearSave() { try { localStorage.removeItem(MP_SAVE_KEY); } catch { /* ignore */ } }

  /** Backgrounding/restore: an MP autosave younger than 30 minutes, with the room still alive,
   *  reattaches to the same room and replays whatever landed while this device was away, instead
   *  of dropping the player back on a blank setup screen. Runs once, right after mount(). */
  async _tryRestoreMP(save) {
    const { code, role } = save;
    try {
      if (role === 'guest') {
        const res = await net.joinRoom(code, this._myIdentity());
        if (res.error || (res.room && res.room.status === 'ended')) { this._mpClearSave(); return; }
      } else if (!(await net.init())) return;
    } catch { return; }
    if (this._dead || this.mp || this.view === 'game') return;   // superseded by a faster user action

    this.mp = this._mpNewState(role, code, null, save.size);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.dealer = save.dealer === 1 ? 1 : 0;
    // The series tally is carried through UNTOUCHED, same as tic-tac-toe/js/ui.js's and
    // mancala/js/ui.js's restore: a restore that zeroed it would be the initMatch-wipe failure
    // shape from js/CLAUDE.md's invariant 5, translated to this game's vocabulary.
    mp.series = this._mpNormalizeSeries(save.series);
    mp.lastScoredGame = save.midGame ? 0 : (save.lastScoredGame | 0);
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.humanSeat = this._localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    const st = save.state;
    this.state = {
      rows: st.rows, cols: st.cols,
      hEdges: st.hEdges.map((row) => row.slice()),
      vEdges: st.vEdges.map((row) => row.slice()),
      boxes: st.boxes.map((row) => row.slice()),
      turn: st.turn === 1 ? 1 : 0,
      drawnEdges: st.drawnEdges | 0,
      totalEdges: st.totalEdges | 0,
    };
    this._lastCaptured = Array.isArray(save.lastCaptured) ? save.lastCaptured.filter((p) => Array.isArray(p) && p.length === 2) : [];
    this._humanChainRun = Math.max(0, Math.round(Number(save.humanChainRun)) || 0);
    this._humanBestChainThisGame = Math.max(0, Math.round(Number(save.humanBestChainThisGame)) || 0);
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
    // A BOUNDARY save: the saved game is over and the room is between games. Re-show the
    // end-of-game overlay rather than silently deriving or auto-starting the next game --
    // mirrors mancala/js/ui.js's restore, deliberately NOT tic-tac-toe/js/ui.js's
    // auto-_mpStartNextGame-on-restore shape (there is no settled convention here, per
    // HANDOFF-MP-WEB-SESSION.md's save-key note applying equally to this choice; re-showing the
    // overlay means the host decides when to start game N+1 by tapping Play Again, same as it
    // would have without ever leaving, and the guest simply waits -- no separate "await the next
    // record" path is needed, since finish()'s own actions already cover it). finish() calls
    // _commitStats() itself, whose _statsCommitted guard (already restored from the save) keeps
    // this idempotent.
    this.finish();
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new DotsBoxesUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
