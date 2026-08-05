// ui.js - Battleship UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen follows Escoba's accordion pattern (root CLAUDE.md). CSS scoping follows
// Mancala (every rule descendant-scoped under .bs-root). Stylesheet injection follows Filler's
// ensureStylesheet(). Settings key is gen-3 (gamehub.battleship.v1).
//
// game.js/fleet.js/ai.js/hash.js stay pure and DOM-free.
//
// MULTIPLAYER (HANDOFF-BATTLESHIP.md section 7): the repo's first hidden-information game. A shot
// is TWO log entries: the shooter appends a 's' entry, the defender resolves it against its own
// LOCAL fleet (never transmitted) and appends the authoritative 'a' entry; both devices apply the
// 'a' entry to their shared PUBLIC state (the two shot grids) and hash after it. There is also a
// 'r' (ready) entry per seat, gating the first shot on both being present -- the one genuinely
// concurrent beat in the protocol, since placement happens simultaneously. See battleship/CLAUDE.md
// for the full write-up and js/CLAUDE.md's "tenth consumer" section.

import {
  CELL_MISS, CELL_HIT, CELL_SUNK, cellAt, newGame, setFleet, isShotLegal,
  resolveShot, applyAnswer, fireAndResolve, shipsAfloat,
} from './game.js';
import {
  SHIP_SETS, boardSizeFor, shipSetFor, emptyFleet, placeShip, isFleetComplete,
  autoPlace, mulberry32,
} from './fleet.js';
import { chooseShot } from './ai.js';
import { stateHash } from './hash.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordBattleship, recordHeadToHead, loadStats, deviceId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onViewportResize } from '../../js/viewport.js';
import { shipArtHtml } from './ship-art.js';
import * as net from '../../js/net.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.battleship.v1';
const SAVE_KEY = 'gamehub.battleship.save.v1';
const MP_SAVE_KEY = 'gamehub.battleship.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
const MP_DIFFICULTY = 'mp';
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
const SIZES = [['classic', 'size_classic'], ['quick', 'size_quick']];
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };
const SHIP_LABEL_KEY = { carrier: 'ship_carrier', battleship: 'ship_battleship', cruiser: 'ship_cruiser', submarine: 'ship_submarine', destroyer: 'ship_destroyer' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deepCopy = (v) => JSON.parse(JSON.stringify(v));
const reducedMotion = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

function ensureStylesheet() {
  const href = new URL('../css/battleship.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/battleship.css'));
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

// --- solo autosave (mirrors tic-tac-toe/js/ui.js's saveGame/loadGame/clearGame) -----------------
// Only ever holds a MID-BATTLE position: placement itself is not autosaved (leaving mid-placement
// just restarts placement, an accepted simplification -- nothing earned is ever at risk there).

function validSoloState(s, sizeKey) {
  if (!s || typeof s !== 'object' || s.sizeKey !== sizeKey || s.over) return false;
  if (!s.fleets || !s.fleets[0] || !s.fleets[1]) return false;
  if (!Array.isArray(s.shots) || s.shots.length !== 2) return false;
  return true;
}

function saveGame(ui) {
  try {
    if (ui.mp) return;
    if (!ui.state || ui.state.over || ui.view !== 'battle') { clearGame(); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, sizeKey: ui.state.sizeKey, difficulty: ui._setup.difficulty, state: ui.state }));
  } catch { /* a full quota must never break the game */ }
}
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (raw.sizeKey !== 'classic' && raw.sizeKey !== 'quick') return null;
    if (!DIFFICULTIES.some(([k]) => k === raw.difficulty)) return null;
    if (!validSoloState(raw.state, raw.sizeKey)) return null;
    return { sizeKey: raw.sizeKey, difficulty: raw.difficulty, state: raw.state };
  } catch { return null; }
}
function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

class BattleshipUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.view = 'setup';   // 'setup' | 'placement' | 'battle'
    this._setupExpanded = null;
    this._setup = this._loadSetup();
    this._mode = 'solo';   // 'solo' | 'host' | 'join'
    this._lobby = null;    // null | 'host' | 'join'
    this._mpBusy = false;
    this._mpError = '';
    this._mpStatusMsg = '';
    this._mpJoinCode = '';
    this._mpPendingCode = null;
    this._mpJoinedCode = null;
    this._mpLobbyRoom = null;

    this.state = null;
    this.busy = false;
    this.aiTimer = null;
    this._settleTimer = null;
    this._confirmTimer = null;
    this._mpDelayTimer = null;
    this._bannerTimer = null;
    this._statsCommitted = false;
    this._lastShot = null;     // { seat, r, c, result, sunk, cells } -- the one cell that gets an entrance animation
    this._sunkBanner = '';
    this._sunkShips = {};      // seat -> shipId -> {id,len,r,c,dir}, reconstructed from revealed cells (see _recordSunkShipGeometry)
    this._sinkPlayed = new Set(); // "seat:shipId" already played its one-shot sink animation (see _shouldPlaySink)

    // Placement-screen working state.
    this._placeSizeKey = null;
    this._placeShipSet = null;
    this._placeFleet = null;
    this._placeDir = {};       // shipId -> 'h'|'v'
    this._placeSelected = null;
    this._placePreview = null; // { r, c } hover/cursor position
    this._dragging = null;
    this._justRotatedShip = null; // consumed once by the next renderPlacement() (see _rotateShip)
    this._soloStarterSeat = 0;

    this.mp = null;

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onPointerDown = (e) => this.onPointerDown(e);
    this._onPointerMove = (e) => this.onPointerMove(e);
    this._onPointerUp = (e) => this.onPointerUp(e);
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._offViewport = null;

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    if (this._mpDelayTimer) { clearTimeout(this._mpDelayTimer); this._mpDelayTimer = null; }
    if (this._bannerTimer) { clearTimeout(this._bannerTimer); this._bannerTimer = null; }
    // Same reasoning as every other MP game: destroy() runs for any hub teardown (including just
    // navigating back), so a live room is preserved for the 30-minute rejoin window. A hosted room
    // that never reached a game is released, since nobody depends on it.
    if (!this.mp && this._lobby === 'host' && this._mpPendingCode) {
      net.leaveRoom(this._mpPendingCode, 'host').catch(() => { /* best-effort */ });
    }
    try { net.disconnect(); } catch { /* never let teardown throw */ }
    this.mp = null;
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('input', this._onInput);
      this.root.removeEventListener('pointerdown', this._onPointerDown);
      this.root.removeEventListener('pointermove', this._onPointerMove);
      this.root.removeEventListener('pointerup', this._onPointerUp);
      this.root.removeEventListener('pointercancel', this._onPointerUp);
      this.root.removeEventListener('keydown', this._onKeyDown);
    }
    this.container.innerHTML = '';
    this.state = null;
  }

  // Autosave/resume built in for SOLO (mirrors tic-tac-toe): leaving costs nothing, so this always
  // returns false there. MULTIPLAYER is the exception within the exception: true for as long as a
  // room is joined (including the lobby and simultaneous placement), since leaving is consequential
  // for the live opponent even though this device could rejoin.
  isInProgress() { return !!this.mp; }

  // --- settings persistence --------------------------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(SETTINGS_KEY, {});
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const profileDiff = (opp && SKILL_TO_DIFF[opp.skill]) || null;
    return {
      size: saved.size === 'quick' ? 'quick' : 'classic',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      bonusShotOnHit: !!saved.bonusShotOnHit,
      firstMode: (saved.firstMode === 'you' || saved.firstMode === 'opponent' || saved.firstMode === 'alternate') ? saved.firstMode : 'alternate',
      nextStarter: saved.nextStarter === 'opponent' ? 'opponent' : 'you',
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { v: 1, size: s.size, difficulty: s.difficulty, bonusShotOnHit: s.bonusShotOnHit, firstMode: s.firstMode, nextStarter: s.nextStarter });
  }

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

  _myIdentity() {
    const id = this._identity();
    return { name: id.humanName, avatar: id.humanEmoji, deviceId: deviceId() };
  }

  _statsLine() {
    let rec = null;
    try { rec = (loadStats().games || {}).battleship; } catch { rec = null; }
    const bs = rec && rec.bs;
    if (!bs || !bs.played) return '';
    const acc = bs.shots > 0 ? Math.round((bs.hits / bs.shots) * 100) : 0;
    return t('stats_line', { total: bs.played, w: bs.won, l: bs.lost, acc });
  }

  // --- seats -------------------------------------------------------------------------------------
  // Seats are SYMMETRIC here (both sides have a fleet and shoot): host = seat 0, guest = seat 1,
  // fixed for the whole room. In solo the local human is always seat 0 and the AI is seat 1.
  _localSeat() { return this.mp ? this.mp.localSeat : 0; }
  _remoteSeat() { return 1 - this._localSeat(); }

  // --- DOM construction --------------------------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="bs-root"><div class="bs-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.bs-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('input', this._onInput);
    this.root.addEventListener('pointerdown', this._onPointerDown);
    this.root.addEventListener('pointermove', this._onPointerMove);
    this.root.addEventListener('pointerup', this._onPointerUp);
    this.root.addEventListener('pointercancel', this._onPointerUp);
    this.root.addEventListener('keydown', this._onKeyDown);
    // Coalesced to one callback per frame by js/viewport.js -- a raw resize listener would re-fit
    // the boards several times per frame while a mobile URL bar animates (js/CLAUDE.md, "Overlay
    // scrolling" / hill-climb/js/ui.js's usage). --bs-cell is the one value ship sprites, the
    // roster, and both boards all derive from, computed once per real viewport change.
    this._offViewport = onViewportResize(() => this._updateCellSize());
    const mpSave = this._mpLoadSave();
    if (mpSave) {
      this.renderSetup();
      this._tryRestoreMP(mpSave);
      return;
    }
    const saved = loadGame();
    if (saved) this.resumeGame(saved); else this.renderSetup();
  }

  resumeGame(saved) {
    this._setup.difficulty = saved.difficulty;
    this._statsCommitted = false;
    this.state = saved.state;
    this.view = 'battle';
    this._lastShot = null;
    this._sunkShips = {};
    this._sinkPlayed = new Set();
    // Solo only (this branch never runs in MP): both fleets are held locally, so any ship already
    // sunk before this resume can be reconstructed outright rather than waiting to see it sink
    // again -- otherwise a resumed match would show sunk cells with no boat sprite until the next kill.
    for (let seat = 0; seat < 2; seat++) {
      const fleet = this.state.fleets[seat];
      if (!fleet) continue;
      for (const ship of fleet.ships) {
        if (ship.hits.every(Boolean)) {
          this._sunkShips[seat] = this._sunkShips[seat] || {};
          this._sunkShips[seat][ship.id] = { id: ship.id, len: ship.len, r: ship.r, c: ship.c, dir: ship.dir };
        }
      }
    }
    this._afterStateChange();
  }

  // --- setup screen --------------------------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="bs-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="bs-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="bs-row ${open ? 'is-open' : ''}">
      <button type="button" class="bs-row-head" data-action="toggle-row" data-row="${key}">
        <span class="bs-row-label">${label}</span><span class="bs-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="bs-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _modeSeg() {
    return this._seg('set-mode', this._mode, [
      ['solo', t('mode_solo')], ['host', t('mode_host')], ['join', t('mode_join')],
    ]);
  }

  _sizeContent() {
    const s = this._setup;
    return this._seg('set-size', s.size, SIZES.map(([v, k]) => [v, t(k)])) +
      `<p class="bs-hint">${s.size === 'quick' ? t('hint_size_quick') : t('hint_size_classic')}</p>`;
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

  _bonusContent() {
    const s = this._setup;
    return this._seg('set-bonus', s.bonusShotOnHit ? 'on' : 'off', [['off', t('bonus_off')], ['on', t('bonus_on')]])
      + `<p class="bs-hint">${t('hint_bonus')}</p>`;
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    if (this.view === 'battle' && this.state && !this.state.over && !this.mp) clearGame();
    this.view = 'setup';
    this.state = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    const head = `
      <h1 class="bs-title">${t('title')}</h1>
      <p class="bs-sub">${t('tagline')}</p>
      ${stats ? `<p class="bs-stats">${esc(stats)}</p>` : ''}
      ${this._modeSeg()}`;

    if (this._lobby) { this.shell.innerHTML = head + this._lobbyHTML(); return; }
    if (this._mode === 'join') { this.shell.innerHTML = head + this._joinBodyHTML(); return; }

    const hosting = this._mode === 'host';
    this.shell.innerHTML = head + `
      ${hosting ? '' : `<div class="bs-vscard">
        <div class="bs-vsside"><span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span></div>
        <span class="bs-vslabel">${t('vs')}</span>
        <div class="bs-vsside"><span>${esc(id.oppEmoji)}</span><span>${esc(id.oppName)}</span></div>
      </div>`}
      <div class="bs-summary">
        ${this._row('size', t('row_size'), s.size === 'quick' ? t('size_quick') : t('size_classic'), this._sizeContent())}
        ${hosting ? '' : this._row('difficulty', t('row_difficulty'), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
        ${this._row('first', t('row_first'),
          s.firstMode === 'you' ? t('you') : s.firstMode === 'opponent' ? (hosting ? t('mp_opponent_label') : id.oppName) : t('first_alternate'),
          this._firstContent())}
        ${this._row('bonus', t('row_bonus'), s.bonusShotOnHit ? t('bonus_on') : t('bonus_off'), this._bonusContent())}
      </div>
      ${hosting
        ? `<p class="bs-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
           <button type="button" class="bs-btn bs-btn-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`
        : `<button type="button" class="bs-btn bs-btn-primary" data-action="start">${t('start')}</button>`}
      <button type="button" class="bs-link" data-action="help">${t('howto')}</button>`;
  }

  // --- multiplayer lobby (Tic Tac Toe's shape) --------------------------------------------------

  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="bs-mp-msg bs-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="bs-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : t('mp_join_hint')))}</p>`;
    return `<div class="bs-mp-lobby">
      <span class="bs-mp-label">${t('mp_enter_code')}</span>
      <input class="bs-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="bs-btn bs-btn-primary" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = `<button type="button" class="bs-btn bs-btn-ghost" data-action="mp-cancel">${t('mp_back_btn')}</button>`;
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="bs-mp-lobby">
        <span class="bs-mp-label">${t('mp_code_aria')}</span>
        <div class="bs-mp-code">${code ? esc(code) : '····'}</div>
        <span class="bs-mp-label">${t('mp_opponent_label')}</span>
        <div class="bs-mp-oppslot">${guest
          ? `<span>${esc(guest.avatar || '🙂')}</span><span>${esc(guest.name || '')}</span>`
          : `<span class="bs-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="bs-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="bs-btn bs-btn-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    return `<div class="bs-mp-lobby">
      <span class="bs-mp-label">${t('mp_code_aria')}</span>
      <div class="bs-mp-code">${esc(this._mpJoinedCode || '')}</div>
      <span class="bs-mp-label">${t('mp_host_label')}</span>
      <div class="bs-mp-oppslot">${host
        ? `<span>${esc(host.avatar || '🙂')}</span><span>${esc(host.name || '')}</span>`
        : `<span class="bs-mp-oppempty">—</span>`}</div>
      <p class="bs-mp-msg" data-role="mp-msg">${t('mp_waiting_host')}</p>
      ${back}
    </div>`;
  }

  _setMpStatus(key) { this._mpStatusMsg = key; this._rerenderCurrentView(); }
  _clearMpStatus() { if (!this._mpStatusMsg) return; this._mpStatusMsg = ''; this._rerenderCurrentView(); }

  _rerenderCurrentView() {
    if (this._dead) return;
    if (this.view === 'placement') this.renderPlacement();
    else if (this.view === 'battle' && this.state) this.renderBattle();
    else this.renderSetup();
  }

  _syncMpMsgSlot() {
    const slot = this.shell && this.shell.querySelector('[data-role="mp-msg"]');
    if (!slot) return;
    slot.textContent = this._mpError || (this._mpBusy ? t('mp_joining') : t('mp_join_hint'));
  }

  // --- starting a match ------------------------------------------------------------------------

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
    const starter = this._resolveStarter();
    this._soloStarterSeat = starter === 'you' ? 0 : 1;
    clearGame();
    this._statsCommitted = false;
    this._newPlacement(this._setup.size);
    this.view = 'placement';
    this.renderPlacement();
  }

  // --- placement screen --------------------------------------------------------------------------

  _newPlacement(sizeKey) {
    this._placeSizeKey = sizeKey;
    this._placeShipSet = shipSetFor(sizeKey);
    this._placeFleet = emptyFleet(sizeKey);
    this._placeDir = {};
    this._placeSelected = this._placeShipSet[0].id;
    this._placePreview = null;
    this._placeInvalid = null;
    this._dragging = null;
  }

  _placementLegalAt(shipId, r, c, dir) {
    const def = this._placeShipSet.find((d) => d.id === shipId);
    if (!def) return false;
    return !!placeShip(this._placeFleet, def, r, c, dir);
  }

  _tryPlaceAt(shipId, r, c) {
    const def = this._placeShipSet.find((d) => d.id === shipId);
    if (!def) return;
    const dir = this._placeDir[shipId] || 'h';
    const placed = placeShip(this._placeFleet, def, r, c, dir);
    if (!placed) {
      this._placeInvalid = { shipId, r, c, dir };
      this.renderPlacement();
      return;
    }
    this._placeFleet = placed;
    this._placeInvalid = null;
    this._placePreview = null;
    const next = this._placeShipSet.find((d) => !this._placeFleet.ships.some((s) => s.id === d.id));
    this._placeSelected = next ? next.id : null;
    this.renderPlacement();
  }

  _rotateShip(shipId) {
    if (!shipId) return;
    this._placeDir[shipId] = (this._placeDir[shipId] || 'h') === 'h' ? 'v' : 'h';
    this._placeInvalid = null;
    // Consumed by the very next renderPlacement() only (see there) -- the rotate icon's spin
    // animation must fire for THIS render alone, not replay on every later render the way an
    // unconditional CSS `animation:` on the icon would (the same class of bug as the sink reveal).
    this._justRotatedShip = shipId;
    this.renderPlacement();
  }

  _selectShip(shipId) {
    const already = this._placeFleet.ships.find((s) => s.id === shipId);
    if (already) {
      // Re-select a placed ship to reposition it: pull it back off the board, keep its rotation.
      this._placeDir[shipId] = already.dir;
      this._placeFleet = { ...this._placeFleet, ships: this._placeFleet.ships.filter((s) => s.id !== shipId) };
    }
    this._placeSelected = shipId;
    this._placeInvalid = null;
    this.renderPlacement();
  }

  _autoPlaceAll() {
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    const f = autoPlace(this._placeSizeKey, this._placeShipSet, rng);
    if (f) { this._placeFleet = f; this._placeSelected = null; this._placePreview = null; this.renderPlacement(); }
  }

  _clearPlacement() {
    this._placeFleet = emptyFleet(this._placeSizeKey);
    this._placeSelected = this._placeShipSet[0].id;
    this._placePreview = null;
    this.renderPlacement();
  }

  _placementReady() {
    if (this.mp) this._mpAfterLocalReady();
    else this._finishPlacementSolo();
  }

  _finishPlacementSolo() {
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    const aiFleet = autoPlace(this._placeSizeKey, this._placeShipSet, rng) || emptyFleet(this._placeSizeKey);
    const size = boardSizeFor(this._placeSizeKey);
    let s = newGame(size, this._placeSizeKey, this._setup.bonusShotOnHit, this._soloStarterSeat);
    s = setFleet(s, 0, this._placeFleet);
    s = setFleet(s, 1, aiFleet);
    this.state = s;
    this.view = 'battle';
    this._statsCommitted = false;
    this._lastShot = null;
    this._sunkShips = {};
    this._sinkPlayed = new Set();
    this._afterStateChange();
  }

  /** The one px value ship sprites, the fleet roster and both boards derive from. Measured from an
   *  actual rendered `.bs-cell`, not derived from the board's own width/size (that math has to
   *  duplicate the board's `padding`/`gap` CSS by hand and drifts the moment either changes --
   *  exactly how ships ended up rendering 1-2 squares oversized: the old `boardWidth / gridSize`
   *  calculation ignored the board's padding and inter-cell gap, so --bs-cell came out larger than
   *  a real cell. Reading the cell's own box is immune to that by construction. */
  _updateCellSize() {
    if (this._dead || !this.root) return;
    // PER BOARD, not once on the root. The battle screen shows TWO boards at DIFFERENT widths
    // (enemy waters large, your own fleet small), and a single --bs-cell on .bs-root meant the
    // small board drew its ship sprites at the large board's scale - boats overhanging the grid
    // and each other. Each board owns its own value, and `var(--bs-cell)` inside a sprite resolves
    // against its nearest board ancestor, so both are right by construction.
    //
    // Measured from an actual rendered `.bs-cell` inside that board, not `boardWidth / gridSize`
    // arithmetic - that math has to duplicate the board's own `padding`/`gap` CSS by hand and
    // drifts the moment either changes, which is exactly how ships ended up rendering 1-2 squares
    // oversized: the old calculation ignored the board's padding and inter-cell gap, so --bs-cell
    // came out larger than a real cell. Reading the cell's own box is immune to that by
    // construction.
    let primaryW = 0;
    const boards = this.root.querySelectorAll('.bs-board');
    for (const board of boards) {
      const cell = board.querySelector('.bs-cell');
      const w = cell ? cell.getBoundingClientRect().width : 0;
      if (w > 0) {
        board.style.setProperty('--bs-cell', `${w.toFixed(2)}px`);
        if (board.dataset.role === 'enemy-board' || board.dataset.role === 'place-board') primaryW = w;
      }
    }
    // Kept on the root as well: the fleet roster's silhouettes sit OUTSIDE both boards and still
    // need a sensible unit. The primary (enemy/placement) board is the right reference for them.
    if (primaryW > 0) this.root.style.setProperty('--bs-cell', `${primaryW.toFixed(2)}px`);
  }

  renderPlacement() {
    if (this._dead) return;
    this.closeOverlays();
    const size = boardSizeFor(this._placeSizeKey);
    const remaining = this._placeShipSet.filter((d) => !this._placeFleet.ships.some((s) => s.id === d.id)).length;
    const justRotated = this._justRotatedShip;
    this._justRotatedShip = null;

    const chips = this._placeShipSet.map((def) => {
      const placedShip = this._placeFleet.ships.find((s) => s.id === def.id);
      const dir = this._placeDir[def.id] || 'h';
      const vertical = placedShip ? placedShip.dir === 'v' : dir === 'v';
      return `<div class="bs-shipchip ${placedShip ? 'is-placed' : ''} ${this._placeSelected === def.id ? 'is-selected' : ''}"
          data-role="ship-chip" data-ship="${def.id}" role="button" tabindex="0" aria-label="${esc(t(SHIP_LABEL_KEY[def.id]))}">
        <span class="bs-shipchip-cells ${vertical ? 'is-vertical' : ''}">${shipArtHtml(def.id, def.len)}</span>
        <span>${esc(t(SHIP_LABEL_KEY[def.id]))}</span>
        <button type="button" class="bs-rotate-btn" data-action="rotate-ship" data-ship="${def.id}" aria-label="${esc(t('rotate_aria', { ship: t(SHIP_LABEL_KEY[def.id]) }))}"><span class="bs-rotate-icon ${justRotated === def.id ? 'is-spinning' : ''}" aria-hidden="true">⟳</span></button>
      </div>`;
    }).join('');

    const preview = this._placePreview;
    const selDef = this._placeSelected && this._placeShipSet.find((d) => d.id === this._placeSelected);
    let ghostCells = new Map();
    if (selDef && preview) {
      const dir = this._placeDir[selDef.id] || 'h';
      const legal = this._placementLegalAt(selDef.id, preview.r, preview.c, dir);
      for (let i = 0; i < selDef.len; i++) {
        const rr = dir === 'v' ? preview.r + i : preview.r;
        const cc = dir === 'h' ? preview.c + i : preview.c;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) ghostCells.set(`${rr},${cc}`, legal);
      }
    }

    const cellsHtml = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const key = `${r},${c}`;
        const ghost = ghostCells.get(key);
        const cls = ['bs-cell', 'bs-water-cell',
          ghost === true ? 'bs-ghost-valid' : '', ghost === false ? 'bs-ghost-invalid' : ''].filter(Boolean).join(' ');
        const badge = ghost === false ? '<span class="bs-ghost-x" aria-hidden="true">&times;</span>' : '';
        cellsHtml.push(`<button type="button" class="${cls}" data-role="place-cell" data-r="${r}" data-c="${c}"
          aria-label="${esc(t('placement_cell_aria', { r: r + 1, c: c + 1 }))}">${badge}</button>`);
      }
    }

    // Placed ships render as real sprites (same ship-art.js reused on the battle board); a
    // selected-but-unplaced ship gets the same sprite, semi-transparent, following the cursor --
    // the per-cell valid/invalid outline + X badges above are the legality signal, unchanged.
    const placedSprites = this._placeFleet.ships.map((ship) => this._shipSpriteHtml(ship)).join('');
    const ghostSprite = (selDef && preview)
      ? this._shipSpriteHtml({ id: selDef.id, len: selDef.len, r: preview.r, c: preview.c, dir: this._placeDir[selDef.id] || 'h' }, { ghost: true })
      : '';

    this.shell.innerHTML = `
      <div class="bs-place">
        <div class="bs-place-head">
          <h1 class="bs-title">${t('placement_title')}</h1>
          <button type="button" class="bs-link" data-action="help">${t('howto')}</button>
        </div>
        <p class="bs-hint">${t('placement_hint')}</p>
        <div class="bs-place-layout">
          <div class="bs-shiplist">${chips}</div>
          <div class="bs-board-wrap">
            <div class="bs-board" style="grid-template-columns:repeat(${size},1fr)" data-role="place-board">${cellsHtml.join('')}${placedSprites}${ghostSprite}</div>
          </div>
        </div>
        <div class="bs-placement-status">
          <span>${remaining > 0 ? t('ships_remaining', { n: remaining }) : ''}</span>
          <span>${this.mp && this.mp.localReady ? t('waiting_for_opponent_placement', { opp: this._identity().oppName }) : ''}</span>
        </div>
        <div class="bs-place-actions">
          <button type="button" class="bs-btn bs-btn-ghost" data-action="auto-place">${t('auto_place')}</button>
          <button type="button" class="bs-btn bs-btn-ghost" data-action="clear-fleet">${t('clear_fleet')}</button>
          <button type="button" class="bs-btn bs-btn-primary" data-action="placement-ready" ${remaining > 0 || (this.mp && this.mp.localReady) ? 'disabled' : ''}>${t('ready')}</button>
        </div>
      </div>`;
    this._updateCellSize();
  }

  // --- battle screen -----------------------------------------------------------------------------

  _shipSetForState() { return shipSetFor(this.state.sizeKey); }

  _isMyTurn() { return !!(this.state && !this.state.over && this.state.turn === this._localSeat()); }

  _aiThinkMs() { return reducedMotion() ? 120 : 300 + Math.random() * 300; }

  /** How long a just-rendered shot's own ordnance animation needs before it's safe to wipe the
   *  board with the NEXT re-render -- battleship-redesign-spec bug 3: `_aiThinkMs()` alone
   *  (300-600ms) is far shorter than the ~1.15-2.05s travel/impact/sink sequence in
   *  battleship.css, so the bot's re-render was cutting the player's own shot off mid-flight.
   *  Numbers track (not duplicate exactly, just bound) the CSS keyframe delays/durations: travel
   *  ends .36s in, impact settle by ~.7-1.1s, the sink reveal (`bs-sink-reveal`) adds another .9s
   *  on top. Reduced motion strips the animation to an instant state change, so it only needs
   *  enough time to be legible, not to let anything play out. */
  _shotSettleMs(shot) {
    if (!shot) return 0;
    if (reducedMotion()) return 150;
    return (shot.result === 'hit' ? 1150 : 1100) + (shot.sunk ? 900 : 0);
  }

  /** Renders the just-applied shot, then holds `busy` (which gates `fireAt`/the fire buttons)
   *  until that shot's own animation has actually had time to play, instead of flipping back to
   *  "your turn" the instant state updates. Shared by both solo branches below so a shot's
   *  animation is respected whether it was the player's own bonus-chain continuation or the bot's
   *  reply passing the turn back. */
  _settleThenIdle() {
    this.busy = true;
    this.renderBattle();
    const ms = this._shotSettleMs(this._lastShot);
    if (ms <= 0) { this.busy = false; this.renderBattle(); return; }
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      if (this._dead) return;
      this.busy = false;
      this.renderBattle();
    }, ms);
  }

  /** Single funnel after every settled state change (placement done, local shot answered, remote
   *  answer applied, resume). MP ORDERING IS LOAD-BEARING, same reasoning as every other MP game
   *  here: the seq bookkeeping for whatever got us here has ALREADY run, so the autosave below
   *  records a seq that matches the move already inside its own snapshot. */
  _afterStateChange() {
    if (this._dead) return;
    // A fresh game (no shots fired either way) can't have any sunk ships -- clears stale
    // reconstructed geometry from a previous game in a rematch series without needing to touch the
    // MP methods that start one (root CLAUDE.md polish pass: no `_mp*` method edited here).
    if (this.state.shotCount[0] === 0 && this.state.shotCount[1] === 0) { this._sunkShips = {}; this._sinkPlayed = new Set(); }
    if (this.mp) this._mpSaveSnapshot(); else saveGame(this);
    if (this.state.over) {
      this.busy = false;
      this.renderBattle();
      this.finish();
      return;
    }
    if (this.mp) {
      this.busy = false;
      this.renderBattle();
      this._mpTryDeliverNextMove();
      return;
    }
    if (this.state.turn === this._remoteSeat()) {
      this.busy = true;
      this.renderBattle();
      // Wait out the shot that JUST rendered (the player's own, or the bot's previous bonus-chain
      // shot) before the bot's reply lands and re-renders over it.
      const wait = this._shotSettleMs(this._lastShot) + this._aiThinkMs();
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        const shipSet = this._shipSetForState();
        const shot = chooseShot(this.state, this._localSeat(), shipSet, this._setup.difficulty, Math.random);
        if (!shot) return;
        const res = fireAndResolve(this.state, this._localSeat(), shot[0], shot[1]);
        this.state = res.state;
        this._lastShot = { seat: this._localSeat(), r: shot[0], c: shot[1], result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells };
        this._maybeShowSunkBanner(res.answer);
        this._afterStateChange();
      }, wait);
    } else {
      this._settleThenIdle();
    }
  }

  _maybeShowSunkBanner(answer) {
    if (!answer || !answer.sunk || !answer.shipId) return;
    this._recordSunkShipGeometry(answer);
    this._sunkBanner = t('sunk_banner', { ship: t(SHIP_LABEL_KEY[answer.shipId] || answer.shipId) });
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this._sunkBanner = ''; this._bannerTimer = null; if (!this._dead && this.view === 'battle') this.renderBattle(); }, 1600);
  }

  /** Reconstructs a just-sunk ship's board position purely from its own already-public revealed
   *  cells (`answer.cells`), for the enemy board's visual reveal sprite -- never new hidden
   *  information, since every one of those cells was already known to this device as a hit before
   *  the ship could be confirmed sunk (see game.js's own comment on `resolveShot`). Finds which
   *  seat by matching `answer.cells` against both public shot grids rather than taking a `seat`
   *  argument, so this stays a SHARED helper reachable from both solo and the untouched MP path
   *  (root CLAUDE.md polish pass: no `_mp*` method edited here). */
  _recordSunkShipGeometry(answer) {
    if (!Array.isArray(answer.cells) || !answer.cells.length) return;
    const [r0, c0] = answer.cells[0];
    for (let seat = 0; seat < 2; seat++) {
      const grid = this.state.shots[seat];
      if (!grid || !grid.sunkIds.includes(answer.shipId) || cellAt(grid, r0, c0) !== CELL_SUNK) continue;
      const rows = answer.cells.map(([r]) => r), cols = answer.cells.map(([, c]) => c);
      this._sunkShips = this._sunkShips || {};
      this._sunkShips[seat] = this._sunkShips[seat] || {};
      this._sunkShips[seat][answer.shipId] = {
        id: answer.shipId, len: answer.cells.length,
        r: Math.min(...rows), c: Math.min(...cols),
        dir: rows.every((r) => r === rows[0]) ? 'h' : 'v',
      };
      return;
    }
  }

  fireAt(r, c) {
    if (this.busy || !this.state || this.state.over) return;
    if (!this._isMyTurn()) return;
    const target = this._remoteSeat();
    if (!isShotLegal(this.state, target, r, c)) return;
    if (this.mp) { this._mpFireAt(r, c); return; }
    const res = fireAndResolve(this.state, target, r, c);
    this.state = res.state;
    this._lastShot = { seat: target, r, c, result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells };
    this._maybeShowSunkBanner(res.answer);
    this._afterStateChange();
  }

  _statusText() {
    const s = this.state, id = this._identity();
    if (this.mp && this._mpStatusMsg) return t(this._mpStatusMsg);
    if (s.over) return s.winner === this._localSeat() ? t('you_win') : t('opp_wins', { opp: id.oppName });
    if (this.busy && !this.mp) return t('opp_thinking', { opp: id.oppName });
    if (s.turn === this._localSeat()) {
      if (s.bonusShotOnHit && this._lastShot && this._lastShot.seat === this._remoteSeat() && this._lastShot.result === 'hit') {
        return t('bonus_turn_continues');
      }
      return t('your_turn');
    }
    return t('opp_turn', { opp: id.oppName });
  }

  _fleetRosterHtml(seat, sunkIds) {
    const shipSet = this._shipSetForState();
    const sunk = new Set(sunkIds || []);
    const items = shipSet.map((def) => {
      const isSunk = sunk.has(def.id);
      return `<span class="bs-roster-item ${isSunk ? 'is-sunk' : ''}">
        <span class="bs-roster-silhouette">${shipArtHtml(def.id, def.len)}</span>
        <span class="bs-roster-name">${esc(t(SHIP_LABEL_KEY[def.id]))}</span>
      </span>`;
    }).join('');
    return `<div class="bs-fleetroster">${items}</div>`;
  }

  /** One absolutely-positioned sprite per ship, sized/positioned from --bs-cell. The inner element
   *  is always drawn at its natural horizontal size and rotated in place for vertical ships -- the
   *  SVG markup from ship-art.js is never redrawn for orientation (HANDOFF-BATTLESHIP-POLISH.md
   *  section 3). `sinking` plays the one-shot list-and-slide reveal; gate it on `_lastShot` the same
   *  way `_cellHtml` gates the peg entrance animation, so it plays once, not on every re-render. */
  _shipSpriteHtml(ship, { ghost = false, sinking = false } = {}) {
    const vertical = ship.dir === 'v';
    const wrapStyle = `left:calc(var(--bs-cell) * ${ship.c}); top:calc(var(--bs-cell) * ${ship.r}); `
      + `width:calc(var(--bs-cell) * ${vertical ? 1 : ship.len}); height:calc(var(--bs-cell) * ${vertical ? ship.len : 1});`;
    const innerStyle = `position:absolute; top:50%; left:50%; width:calc(var(--bs-cell) * ${ship.len}); height:var(--bs-cell); `
      + `transform:translate(-50%,-50%)${vertical ? ' rotate(90deg)' : ''};`;
    const cls = ['bs-ship-sprite', ghost ? 'is-ghost' : '', sinking ? 'is-sinking' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" style="${wrapStyle}" aria-hidden="true"><div style="${innerStyle}">${shipArtHtml(ship.id, ship.len)}</div></div>`;
  }

  _shipSpritesHtml(fleet, opts) {
    if (!fleet) return '';
    return fleet.ships.map((s) => this._shipSpriteHtml(s, opts && opts(s))).join('');
  }

  _cellHtml(size, r, c, opts) {
    const { shots, interactive, isTarget } = opts;
    const v = cellAt(shots, r, c);
    const isLast = this._lastShot && this._lastShot.seat === opts.seat && this._lastShot.r === r && this._lastShot.c === c;
    const classes = ['bs-cell'];
    let inner = '';
    // The travel beat (a shell arcing in over a growing shadow) plays for ANY fresh shot, miss or
    // hit alike -- only the impact beat that follows differs by shape (a hollow ring vs a filled
    // peg + burst outline), never by color alone (HANDOFF-BATTLESHIP-POLISH.md section 4).
    const travel = isLast ? '<span class="bs-ordnance-shadow"></span><span class="bs-ordnance"></span>' : '';
    if (v === 0) {
      classes.push('bs-water-cell');
    } else if (v === CELL_MISS) {
      const specks = isLast ? [...Array(4)].map((_, i) => {
        const ang = (i / 4) * Math.PI * 2 + 0.4;
        return `<span class="bs-speck" style="--bs-dx:${(Math.cos(ang) * 12).toFixed(1)}px;--bs-dy:${(Math.sin(ang) * 12 - 6).toFixed(1)}px"></span>`;
      }).join('') : '';
      inner = `<span class="bs-peg">${travel}${isLast ? '<span class="bs-plume"></span><span class="bs-splash-ring"></span><span class="bs-splash-ring r2"></span><span class="bs-splash-ring r3"></span>' + specks : ''}<span class="bs-peg-miss"></span></span>`;
    } else if (v === CELL_HIT || v === CELL_SUNK) {
      if (v === CELL_SUNK) classes.push('bs-cell-sunk');
      inner = `<span class="bs-peg">${travel}${isLast ? '<span class="bs-fireball"></span><span class="bs-flash"></span><span class="bs-shockwave"></span><span class="bs-smoke"></span>' : ''}<span class="bs-peg-hit"></span></span>`;
    }
    const label = v === CELL_MISS ? t('cell_miss') : v === CELL_HIT ? t('cell_hit') : v === CELL_SUNK ? t('cell_sunk') : t('cell_unknown');
    const isFree = v === 0;
    const canFire = isTarget && interactive && isFree;
    const el = isTarget
      ? `<button type="button" class="${classes.join(' ')}" data-action="fire" data-r="${r}" data-c="${c}" ${canFire ? '' : 'disabled'}
          aria-label="${esc(t('shot_cell_aria', { r: r + 1, c: c + 1, state: label }))}">${inner}</button>`
      : `<div class="${classes.join(' ')}" aria-hidden="true">${inner}</div>`;
    return el;
  }

  /** True if the fired-at cell of `ship` is the one just sunk on `seat`'s board. `ship` is either
   *  a real fleet ship ({cells: [[r,c],...]}) or a reconstructed enemy-board entry
   *  ({r,c,dir,len}, see `_recordSunkShipGeometry`) -- both shapes are checked. */
  _shipHoldsLastShot(ship, seat) {
    if (!this._lastShot || !this._lastShot.sunk || this._lastShot.seat !== seat) return false;
    const { r: lr, c: lc } = this._lastShot;
    if (Array.isArray(ship.cells)) return ship.cells.some(([r, c]) => r === lr && c === lc);
    for (let i = 0; i < ship.len; i++) {
      const rr = ship.dir === 'v' ? ship.r + i : ship.r;
      const cc = ship.dir === 'h' ? ship.c + i : ship.c;
      if (rr === lr && cc === lc) return true;
    }
    return false;
  }

  /** Gates the one-shot sink-reveal animation. `_shipHoldsLastShot` alone isn't enough: `_lastShot`
   *  stays pointed at the same sunk shot across every re-render until the NEXT shot (the sunk-
   *  banner's own 1600ms auto-clear re-renders the board while it's still current, for one), so a
   *  naive "is this the last shot" gate replayed the reveal on a freshly-built DOM element every
   *  time -- the redesign spec's "sink animation plays twice" bug. `_sinkPlayed` marks a
   *  {seat,shipId} pair the first time it's rendered as sinking and never again, so every
   *  subsequent render shows the settled sunk pose instead of replaying the animation. */
  _shouldPlaySink(ship, seat) {
    if (!this._shipHoldsLastShot(ship, seat)) return false;
    const key = `${seat}:${ship.id}`;
    if (this._sinkPlayed.has(key)) return false;
    this._sinkPlayed.add(key);
    return true;
  }

  /** Enemy-board sunk ships this device can legitimately show a sprite for. In solo, at game end,
   *  every remaining ship is known outright (this device always held both fleets). Otherwise
   *  (mid-battle, or MP where the enemy fleet is never known -- see battleship/CLAUDE.md) only
   *  ships this device has actually seen sunk are shown, from the reconstructed geometry recorded
   *  in `_recordSunkShipGeometry`, itself built only from cells this device already knew as hits. */
  _enemySpritesHtml(seat) {
    const s = this.state;
    if (!this.mp && s.over) {
      return this._shipSpritesHtml(s.fleets[seat], () => ({}));
    }
    const known = (this._sunkShips && this._sunkShips[seat]) || {};
    return Object.values(known).map((ship) => this._shipSpriteHtml(ship, { sinking: this._shouldPlaySink(ship, seat) })).join('');
  }

  _boardHtml(kind, active) {
    const s = this.state;
    const size = s.size;
    const localSeat = this._localSeat(), remoteSeat = this._remoteSeat();
    const isEnemy = kind === 'enemy';
    const seat = isEnemy ? remoteSeat : localSeat;
    const shots = s.shots[seat];
    const interactive = isEnemy && this._isMyTurn() && !this.busy;
    const cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        cells.push(this._cellHtml(size, r, c, { shots, interactive, isTarget: isEnemy, seat }));
      }
    }
    const showRadar = isEnemy && !s.over && (this.busy || (this.mp && this.mp.pendingShot));
    const sprites = isEnemy
      ? this._enemySpritesHtml(seat)
      : this._shipSpritesHtml(this.mp ? this.mp.myFleet : s.fleets[localSeat], (ship) => ({ sinking: this._shouldPlaySink(ship, seat) }));
    const shake = this._lastShot && this._lastShot.seat === seat && (this._lastShot.result === 'hit') ? 'bs-shake' : '';
    return `<div class="bs-board ${isEnemy ? 'bs-target' : ''} ${active ? 'is-active-turn' : ''} ${shake}"
        style="grid-template-columns:repeat(${size},1fr)" data-role="${kind}-board">
      ${cells.join('')}
      ${sprites}
      ${showRadar ? '<div class="bs-radar" aria-hidden="true"></div>' : ''}
    </div>`;
  }

  renderBattle() {
    if (this._dead || !this.state) return;
    const id = this._identity();
    const s = this.state;
    const isMyTurn = this._isMyTurn();
    const series = this.mp ? `<p class="bs-mp-series">${esc(this._seriesLine())}</p>` : '';
    const banner = this._sunkBanner ? `<div class="bs-sunk-banner">${esc(this._sunkBanner)}</div>` : '';
    // Boards NEVER swap size on a turn flip (HANDOFF-BATTLESHIP-POLISH.md section 2) -- enemy
    // waters is always the big panel, your own fleet always the small one. Whose turn it is is
    // shown only via .is-active-turn (box-shadow/opacity) and the status line above.
    this.shell.innerHTML = `
      <div class="bs-battle">
        <div class="bs-turnbar">
          <div class="bs-vsside"><span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span></div>
          <span class="bs-shotcount">${t('shots_fired', { n: s.shotCount[this._localSeat()] | 0 })}</span>
          <div class="bs-vsside"><span>${esc(id.oppEmoji)}</span><span>${esc(id.oppName)}</span></div>
        </div>
        ${series}
        <p class="bs-status" aria-live="polite">${esc(this._statusText())}</p>
        <div class="bs-boards">
          <div class="bs-boardpanel bs-boardpanel-enemy">
            <div class="bs-boardpanel-h">${t('enemy_waters')}</div>
            ${this._boardHtml('enemy', isMyTurn && !s.over)}
            ${this._fleetRosterHtml('enemy', s.shots[this._remoteSeat()].sunkIds)}
          </div>
          <div class="bs-boardpanel bs-boardpanel-own">
            <div class="bs-boardpanel-h">${t('your_waters')}</div>
            ${this._boardHtml('own', !isMyTurn && !s.over)}
            ${this._fleetRosterHtml('own', s.shots[this._localSeat()].sunkIds)}
          </div>
        </div>
        ${banner}
        <div class="bs-actions">
          <button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-action="help">${t('howto')}</button>
          ${this.mp
            ? `<button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-action="mp-leave">${t('mp_leave_btn')}</button>`
            : `<button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
               <button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-action="change-settings">${t('new_game')}</button>`}
        </div>
      </div>`;
    this._updateCellSize();
  }

  _seriesLine() {
    const mp = this.mp;
    if (!mp) return '';
    const id = this._identity();
    return t('mp_series', { me: mp.series.wins[this._localSeat()] | 0, them: mp.series.wins[this._remoteSeat()] | 0, opp: id.oppName });
  }

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
    if (b && b.dataset.armed === '1') { b.textContent = b.dataset.label; b.dataset.armed = ''; b.classList.remove('is-confirm'); }
  }

  // --- stats + finish ------------------------------------------------------------------------

  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const s = this.state;
    const won = s.winner === this._localSeat();
    const difficulty = this.mp ? MP_DIFFICULTY : this._setup.difficulty;
    const myShots = s.shotCount[this._localSeat()] | 0;
    const oppGrid = s.shots[this._remoteSeat()];
    let hits = 0;
    for (const v of oppGrid.cells) if (v === CELL_HIT || v === CELL_SUNK) hits++;
    const sunk = oppGrid.sunkIds.length;
    const accuracy = myShots > 0 ? Math.round((hits / myShots) * 100) : 0;
    // fewestShotsWin: recordBattleship applies the sentinel-aware Math.min itself (0 = "no win
    // recorded yet", never "zero shots") and only when `won` -- see js/game-stats.js.
    const extras = { shots: myShots, hits, sunk, accuracy };
    try { recordBattleship(difficulty, won, extras); } catch { /* never block the result */ }
    const opp = this.mp && this.mp.opp;
    if (opp) { try { recordHeadToHead('battleship', opp, won); } catch { /* never block the result */ } }
  }

  finish() {
    const s = this.state;
    const won = s.winner === this._localSeat();
    this._commitStats();
    if (this.mp) this._mpAfterGameEnd();

    const id = this._identity();
    const title = won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = won ? '🏆' : id.oppEmoji;
    const isHost = !!(this.mp && this.mp.role === 'host');
    const actions = !this.mp
      ? `<button type="button" class="bs-btn bs-btn-primary" data-action="rematch">${t('play_again')}</button>
         <button type="button" class="bs-btn bs-btn-ghost" data-action="change-settings">${t('change_settings')}</button>`
      : isHost
        ? `<button type="button" class="bs-btn bs-btn-primary" data-action="mp-next-game">${t('play_again')}</button>
           <button type="button" class="bs-btn bs-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`
        : `<p class="bs-card-wait">${esc(t('mp_waiting_rematch', { opp: id.oppName }))}</p>
           <button type="button" class="bs-btn bs-btn-ghost" data-action="mp-leave">${t('mp_leave_btn')}</button>`;
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="bs-scrim"></div>
      <div class="bs-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="bs-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="bs-card-emoji">${esc(emoji)}</span>
        <h3 class="bs-card-title">${esc(title)}</h3>
        <p class="bs-card-sub">${this.mp ? esc(this._seriesLine()) : t(DIFF_LABEL_KEY[this._setup.difficulty])}</p>
        <div class="bs-card-actions">${actions}</div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // ==============================================================================================
  // Multiplayer. Room protocol (js/net.js, unchanged): rooms/<CODE> with a seq-keyed move log,
  // a `round` record the host publishes, a `recovery` field, heartbeats.
  //
  // Vocabulary mapping (HANDOFF-BATTLESHIP.md section 7.2): a `round` is ONE GAME of a rematch
  // series; `round.n` is the game number; `round.dealer` is the SEAT THAT SHOOTS FIRST in that
  // game; `round.deck` is UNUSED (no shared randomness -- both fleets are private and locally
  // generated). `writeResult` is deliberately never called (it sets status:'ended', which would
  // kill a room meant to host the next game), so status:'ended' means exactly "somebody abandoned
  // the room".
  //
  // A SHOT IS TWO LOG ENTRIES (section 7.1): the shooter appends `{k:'s', seat, r, c}`; the
  // DEFENDER resolves it against its own local fleet (never transmitted) and appends
  // `{k:'a', seat, r, c, result, shipId, sunk, fleetSunk, cells}` -- the authoritative event both
  // devices apply and hash after. The shooter does not apply its own shot; it shows a pending
  // reticle + radar sweep and waits for the answer. A `{k:'r', seat}` ready entry per seat gates
  // the first shot on both being present -- the one genuinely concurrent beat in the protocol,
  // since placement happens simultaneously.
  // ==============================================================================================

  _mpNewState(role, code, opp, sizeKey, bonusShotOnHit) {
    return {
      role, code,
      localSeat: role === 'host' ? 0 : 1,
      opp: opp || null,
      sizeKey: sizeKey === 'quick' ? 'quick' : 'classic',
      bonusShotOnHit: !!bonusShotOnHit,
      gameNum: 0,
      dealerSeat: 0,
      series: { wins: [0, 0] },
      readySeats: new Set(),
      localReady: false,
      myFleet: null,
      pendingShot: null,
      lastShotSeat: null,
      lastShotRC: null,
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      replayMode: false, recoveryAttempts: 0, delivering: false, redeliverRequested: false,
      awaitingRecovery: false,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
      lastScoredGame: 0,
      awaitingGameN: null, awaitingGameResolve: null,
    };
  }

  _mpNormalizeSeries(s) {
    const w = s && Array.isArray(s.wins) ? s.wins : [];
    return { wins: [w[0] | 0, w[1] | 0] };
  }

  /** Host only: publish the next game of the series and start it locally. */
  async _mpStartNextGame() {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this._dead) return;
    const n = (mp.gameNum | 0) + 1;
    const starter = this._resolveStarter();
    const dealerSeat = starter === 'you' ? this._localSeat() : this._remoteSeat();
    try { await net.startRound(mp.code, n, null, dealerSeat); }
    catch { this._setMpStatus('mp_status_connection_error'); }
    if (this._dead || !this.mp) return;
    if ((this.mp.gameNum | 0) < n) this._mpApplyPlacementRound({ n, dealer: dealerSeat }, null);
  }

  /** Both host and guest reach a fresh game through here: reset per-game MP fields, rebuild the
   *  move-log cache from the record's own room snapshot (never carried over -- invariant 3's
   *  failure shape, no literal analogue here since there's no consumable randomness queue, but
   *  the same "per-round state leaking into the next round" risk applies to the move log). */
  _mpApplyPlacementRound(round, room) {
    const mp = this.mp;
    if (!mp || this._dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.dealerSeat = round.dealer === 1 ? 1 : 0;
    mp.appliedSeq = 0;
    mp.replayMode = false;
    mp.recoveryAttempts = 0;
    mp.awaitingRecovery = false;
    mp.readySeats = new Set();
    mp.localReady = false;
    mp.myFleet = null;
    mp.pendingShot = null;
    mp.lastShotSeat = null;
    mp.lastShotRC = null;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this._statsCommitted = false;
    this.state = newGame(boardSizeFor(mp.sizeKey), mp.sizeKey, mp.bonusShotOnHit, mp.dealerSeat);
    this._newPlacement(mp.sizeKey);
    this.view = 'placement';
    this.busy = false;
    this._mpStatusMsg = '';
    this._lastShot = null;
    this.closeOverlays();
    this._mpSaveSnapshot();
    this._mpRefreshReadySeats();
    this._rerenderCurrentView();
    this._mpTryDeliverNextMove();
  }

  /** Both seats place SIMULTANEOUSLY, so both may write a ready entry before either has seen the
   *  other's -- `net.appendMove` is a plain write, not a transaction, so two independent
   *  `++mp.appliedSeq` reservations would race onto the SAME shared seq and one would silently
   *  clobber the other in the room's move log (a real collision, found by this game's own MP
   *  lockstep test, BS-series). Ready entries are the ONE place in this protocol two devices can
   *  legitimately write at once, so they are exempted from the strict, single-writer-at-a-time
   *  seq stream entirely: each seat's ready entry lives at a FIXED, seat-derived seq
   *  (`seat + 1` -- host always 1, guest always 2) that can never collide by construction, and is
   *  discovered by scanning the log for `k:'r'` entries rather than by walking `appliedSeq+1`.
   *  Once both are seen, `appliedSeq` is bumped PAST both reserved slots (to 2) so the strict
   *  shot/answer stream -- which IS single-writer-per-turn, like every other MP game here --
   *  starts clean at seq 3. */
  _mpRefreshReadySeats() {
    const mp = this.mp;
    if (!mp || mp.readySeats.size >= 2) return;
    for (const entry of mp.movesById.values()) {
      const mv = entry.move;
      if (mv && mv.k === 'r' && (mv.g | 0) === (mp.gameNum | 0)) mp.readySeats.add(mv.seat | 0);
    }
    this._maybeStartBattle();
  }

  _maybeStartBattle() {
    const mp = this.mp;
    if (!mp || this.view !== 'placement') return;
    if (mp.readySeats.has(0) && mp.readySeats.has(1)) {
      mp.appliedSeq = Math.max(mp.appliedSeq, 2);   // both fixed ready slots (seq 1, 2) consumed
      this.view = 'battle';
      this._afterStateChange();
    }
  }

  /** Local player finished placing and tapped Ready: lock the fleet in, announce readiness at
   *  this seat's FIXED, collision-free seq slot (see _mpRefreshReadySeats). */
  _mpAfterLocalReady() {
    const mp = this.mp;
    if (!mp || mp.localReady || !isFleetComplete(this._placeFleet, this._placeShipSet)) return;
    mp.myFleet = this._placeFleet;
    mp.localReady = true;
    mp.readySeats.add(this._localSeat());
    const seq = this._localSeat() + 1;
    net.appendMove(mp.code, mp.role, seq, { t: 'r', k: 'r', g: mp.gameNum, seat: this._localSeat() }, stateHash(this.state))
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
    this._mpSaveSnapshot();
    this._maybeStartBattle();
    this._rerenderCurrentView();
  }

  /** Shooter's half of the shot/answer protocol: reserve the seq synchronously (before the network
   *  await), same as every other MP game's local-move pattern, so nothing can race onto the same
   *  number. No local PUBLIC state change happens yet -- only the defender's answer changes it.
   *
   *  Sets `mp.lastShotSeat`/`mp.lastShotRC` HERE, not only when the defender processes the
   *  incoming 's' entry: the shooter's OWN copy of that entry is self-consumed by the synchronous
   *  seq reservation above (same "already accounted for" pattern every local move uses) and so
   *  never actually runs through `_mpApplyNextEntry`'s `k === 's'` branch -- the one place that
   *  would otherwise set these fields. Without this, the shooter has no record of its own shot to
   *  validate the incoming answer against, and every answer to its own shot is wrongly discarded
   *  as an "unauthorized author" (found by this game's own BS1 lockstep test). */
  _mpFireAt(r, c) {
    const mp = this.mp;
    if (!mp || this.busy) return;
    this.busy = true;
    mp.pendingShot = { r, c };
    mp.lastShotSeat = this._localSeat();
    mp.lastShotRC = [r, c];
    const seq = ++mp.appliedSeq;
    net.appendMove(mp.code, mp.role, seq, { t: 's', k: 's', g: mp.gameNum, seat: this._localSeat(), r, c }, stateHash(this.state))
      .catch(() => { this._setMpStatus('mp_status_connection_error'); });
    this.renderBattle();
  }

  /** Defender's half: resolve against the LOCAL, never-transmitted fleet, apply the answer to the
   *  shared public state immediately (I authored it, so I already know the result -- no need to
   *  wait for a round trip), and publish it. */
  _mpDefenderResolveAndAnswer(shooterSeat, r, c) {
    const mp = this.mp;
    const mySeat = this._localSeat();
    const res = resolveShot(mp.myFleet, r, c);
    mp.myFleet = res.fleet;
    const answer = { result: res.result, shipId: res.shipId, sunk: res.sunk, fleetSunk: res.fleetSunk, cells: res.cells };
    this.state = applyAnswer(this.state, mySeat, r, c, answer);
    this._lastShot = { seat: mySeat, r, c, result: answer.result, sunk: answer.sunk, cells: answer.cells };
    this._maybeShowSunkBanner(answer);
    const seq = ++mp.appliedSeq;
    net.appendMove(mp.code, mp.role, seq,
      { t: 'a', k: 'a', g: mp.gameNum, seat: mySeat, r, c, result: answer.result, shipId: answer.shipId, sunk: answer.sunk, fleetSunk: answer.fleetSunk, cells: answer.cells },
      stateHash(this.state)).catch(() => { this._setMpStatus('mp_status_connection_error'); });
    this._afterStateChange();
  }

  _mpDelay(ms) { return new Promise((resolve) => { this._mpDelayTimer = setTimeout(resolve, ms); }); }

  /** Drain every deliverable entry from the cached log. `redeliverRequested` guards the exact race
   *  Mancala found and Filler/Dots and Boxes confirmed (js/CLAUDE.md, "Multiplayer lockstep"): a
   *  room update carrying the next entry can land in the microtask gap right after the drain
   *  loop's own "nothing left to apply" check already read a stale cache, and the entry then sits
   *  undelivered until some unrelated room update happens to trigger a new drain -- which may
   *  never come. More load-bearing here than in any previous game: with `bonusShotOnHit` on, a
   *  single turn can be a long chain of shot/answer pairs. */
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

  /** Apply the single log entry at appliedSeq+1, if present and valid. Returns whether the drain
   *  should continue. Each entry is checked against WHO WAS ALLOWED TO AUTHOR IT (section 7.3,
   *  new to this game): a shot only from the seat whose turn it is; an answer only from the
   *  defender of the immediately preceding shot, referencing the same cell. A discard here is a
   *  protocol violation, logged loudly, and treated as a divergence rather than silently
   *  continuing. */
  async _mpApplyNextEntry() {
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state) return false;
    // Placement's ready entries live at fixed seq 1/2, outside this strict single-writer stream
    // (see _mpRefreshReadySeats) -- this walk only ever runs once both are seen and appliedSeq
    // has been bumped past them, so it starts at seq 3.
    if (this.view !== 'battle') return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move) return false;
    const move = entry.move;
    if ((move.g | 0) !== (mp.gameNum | 0)) return false;   // belongs to a previous game's log
    if (move.k === 'r') return false;   // already accounted for; never part of this stream

    if (move.k === 's') {
      const shooterSeat = move.seat | 0;
      if (!this.state || this.state.over || shooterSeat !== this.state.turn) {
        console.error('[battleship mp] discarding a shot entry from a seat whose turn it is not', { shooterSeat, turn: this.state && this.state.turn });
        return this._mpOnDivergence(seq);
      }
      mp.appliedSeq = seq;
      mp.lastShotSeat = shooterSeat;
      mp.lastShotRC = [move.r | 0, move.c | 0];
      if (shooterSeat === this._localSeat()) return true;   // our own shot's echo: already accounted for
      this._mpDefenderResolveAndAnswer(shooterSeat, move.r | 0, move.c | 0);
      return true;
    }

    if (move.k === 'a') {
      const defenderSeat = move.seat | 0;
      const validAuthor = mp.lastShotSeat != null && defenderSeat === 1 - mp.lastShotSeat
        && mp.lastShotRC && (move.r | 0) === mp.lastShotRC[0] && (move.c | 0) === mp.lastShotRC[1];
      if (!validAuthor) {
        console.error('[battleship mp] discarding an answer that is not from the defender of the shot it claims to answer');
        return this._mpOnDivergence(seq);
      }
      if (defenderSeat === this._localSeat()) { mp.appliedSeq = seq; return true; }   // our own answer's echo
      const answer = { result: move.result, shipId: move.shipId || null, sunk: !!move.sunk, fleetSunk: !!move.fleetSunk, cells: move.cells };
      const next = applyAnswer(this.state, defenderSeat, move.r | 0, move.c | 0, answer);
      if (stateHash(next) !== entry.h) return this._mpOnDivergence(seq);
      this.state = next;
      mp.appliedSeq = seq;
      mp.recoveryAttempts = 0;
      if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
      mp.pendingShot = null;
      this._lastShot = { seat: defenderSeat, r: move.r | 0, c: move.c | 0, result: answer.result, sunk: answer.sunk, cells: answer.cells };
      this._maybeShowSunkBanner(answer);
      this.busy = true;
      this.renderBattle();
      await this._mpDelay(reducedMotion() ? 60 : 420);
      if (this._dead || !this.mp) return false;
      this._afterStateChange();
      return true;
    }
    return false;
  }

  /** A remote entry did not match this device's state (bad hash, or a discarded protocol
   *  violation). The HOST is authoritative: keeps its own state, TAKES THE SEQ anyway, publishes
   *  a PUBLIC-ONLY snapshot (section 7.5 -- never a fleet). The GUEST latches until that snapshot
   *  lands, or every subsequent room update would re-deliver the same entry onto the
   *  already-diverged state and burn the attempt budget before the host's answer can arrive. */
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

  /** PUBLIC STATE ONLY (section 7.4/7.5): neither fleet is ever in here. A recovering device
   *  rebuilds its own secret fleet from its OWN local MP save, never from the network. */
  _mpSnapshot() {
    const mp = this.mp;
    return {
      v: 1, sizeKey: mp.sizeKey, bonusShotOnHit: mp.bonusShotOnHit,
      gameNum: mp.gameNum, dealerSeat: mp.dealerSeat,
      readySeats: [...mp.readySeats],
      series: { wins: mp.series.wins.slice() },
      state: this.state,
    };
  }

  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery && recovery.state;
    if (!snap || !snap.state) return;
    mp.sizeKey = snap.sizeKey === 'quick' ? 'quick' : 'classic';
    mp.bonusShotOnHit = !!snap.bonusShotOnHit;
    mp.gameNum = snap.gameNum | 0;
    mp.dealerSeat = snap.dealerSeat === 1 ? 1 : 0;
    mp.readySeats = new Set(snap.readySeats || []);
    mp.series = this._mpNormalizeSeries(snap.series);
    this.state = deepCopy(snap.state);
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.pendingShot = null;
    const bothReady = mp.readySeats.has(0) && mp.readySeats.has(1);
    // The honest failure case (section 7.5): if this device lost its own local fleet (storage
    // cleared, different browser) it cannot recover it from anywhere, and the match cannot
    // continue here. Never invent a fleet, never forfeit silently, never mirror one into the room.
    if (bothReady && !mp.myFleet) { net.clearRecovery(mp.code).catch(() => {}); this._mpCannotResume(); return; }
    this.view = bothReady ? 'battle' : 'placement';
    this.busy = false;
    this.closeOverlays();
    this._mpStatusMsg = '';
    net.clearRecovery(mp.code).catch(() => {});
    if (this.view === 'placement') this.renderPlacement(); else this._afterStateChange();
  }

  _mpCannotResume() {
    const mp = this.mp;
    if (mp && mp.code) net.leaveRoom(mp.code, mp.role).catch(() => { /* best-effort */ });
    else net.disconnect();
    this.mp = null;
    this._mpClearSave();
    this._mpStatusMsg = '';
    this._mpEndModal('mp_cannot_resume_title', 'mp_cannot_resume_sub');
  }

  _mpAfterGameEnd() {
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    mp.series.wins[s.winner] += 1;
    this._mpSaveSnapshot();
  }

  // --- room lifecycle --------------------------------------------------------------------------

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
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;

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
      this._mpApplyPlacementRound(room.round, room);
    } else if (roundN === (mp.gameNum | 0)) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      if (this.view === 'placement') this._mpRefreshReadySeats();
      mp.redeliverRequested = true;
      this._mpTryDeliverNextMove();
    }

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
    const config = { sizeKey: this._setup.size, bonusShotOnHit: this._setup.bonusShotOnHit };
    const res = await net.createRoom('battleship', config, this._myIdentity());
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

  _mpHostStartMatch() {
    const room = this._mpLobbyRoom;
    if (!room || !room.guest || this.mp || this._mpBusy) return;
    clearGame();
    this.mp = this._mpNewState('host', this._mpPendingCode, room.guest, this._setup.size, this._setup.bonusShotOnHit);
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
    if (res.room && res.room.game && res.room.game !== 'battleship') {
      this._mpError = t('mp_err_wrong_game');
      this.renderSetup();
      return;
    }
    this._mpPendingCode = code;
    this._mpJoinedCode = code;
    this._lobby = 'join';
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
    const cfg = room.config || {};
    this.mp = this._mpNewState('guest', this._mpJoinedCode, room.host, cfg.sizeKey, cfg.bonusShotOnHit);
    this._lobby = null;
    this._mpApplyPlacementRound(room.round, room);
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

  _mpEndModal(titleKey, subKey) {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="bs-scrim"></div>
      <div class="bs-card" role="dialog" aria-modal="true" aria-label="${t(titleKey)}">
        <button type="button" class="bs-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="bs-card-emoji">📡</span>
        <h3 class="bs-card-title">${t(titleKey)}</h3>
        <p class="bs-card-sub">${t(subKey)}</p>
        <div class="bs-card-actions">
          <button type="button" class="bs-btn bs-btn-primary" data-action="mp-end-ok">${t('mp_back_to_setup')}</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave -------------------------------------------------------------------------------

  /** `myFleet` rides along -- THIS is what makes local-fleet recovery possible (section 7.5): a
   *  rejoin rebuilds the secret fleet from here, never from the network. */
  _mpSaveSnapshot() {
    const mp = this.mp;
    if (!mp) return;
    try {
      saveJSON(MP_SAVE_KEY, {
        v: 1, code: mp.code, role: mp.role, at: Date.now(),
        sizeKey: mp.sizeKey, bonusShotOnHit: mp.bonusShotOnHit,
        gameNum: mp.gameNum | 0, dealerSeat: mp.dealerSeat | 0,
        readySeats: [...mp.readySeats],
        myFleet: mp.myFleet,
        series: { wins: mp.series.wins.slice() },
        seq: mp.appliedSeq | 0,
        midGame: !!(this.state && !this.state.over),
        view: this.view,
        statsCommitted: !!this._statsCommitted,
        state: this.state,
      });
    } catch { /* private mode / quota */ }
  }

  _mpLoadSave() {
    const raw = loadJSON(MP_SAVE_KEY, null);
    if (!raw || raw.v !== 1 || !raw.code) return null;
    if (raw.role !== 'host' && raw.role !== 'guest') return null;
    if (raw.sizeKey !== 'classic' && raw.sizeKey !== 'quick') return null;
    if (Date.now() - (raw.at || 0) > MP_RESTORE_MAX_AGE_MS) { this._mpClearSave(); return null; }
    return raw;
  }

  _mpClearSave() { try { localStorage.removeItem(MP_SAVE_KEY); } catch { /* ignore */ } }

  /** Backgrounding/restore: reattach to the room and pick up where this device left off, rather
   *  than dropping the player back on a blank setup screen. Runs once, right after mount(). */
  async _tryRestoreMP(save) {
    const { code, role } = save;
    try {
      if (role === 'guest') {
        const res = await net.joinRoom(code, this._myIdentity());
        if (res.error || (res.room && res.room.status === 'ended')) { this._mpClearSave(); return; }
      } else if (!(await net.init())) return;
    } catch { return; }
    if (this._dead || this.mp || this.view === 'game' || this.view === 'battle' || this.view === 'placement') return;

    this.mp = this._mpNewState(role, code, null, save.sizeKey, save.bonusShotOnHit);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.dealerSeat = save.dealerSeat === 1 ? 1 : 0;
    mp.readySeats = new Set(save.readySeats || []);
    mp.localReady = mp.readySeats.has(this._localSeat());
    mp.myFleet = save.myFleet || null;
    mp.series = this._mpNormalizeSeries(save.series);
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    mp.lastScoredGame = save.midGame ? 0 : mp.gameNum;
    this.state = save.state;
    this._statsCommitted = !!save.statsCommitted;
    this.view = save.view === 'placement' ? 'placement' : 'battle';
    this.busy = false;
    net.heartbeat(code, role);
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    if (this._dead) return;

    const bothReady = mp.readySeats.has(0) && mp.readySeats.has(1);
    if (this.view === 'battle' && !mp.myFleet) { this._mpCannotResume(); return; }
    if (this.view === 'placement') {
      if (!this._placeFleet) this._newPlacement(mp.sizeKey);
      this.renderPlacement();
      if (bothReady) this._maybeStartBattle();
      this._mpTryDeliverNextMove();
      return;
    }
    this.renderBattle();
    if (save.midGame) { this._mpTryDeliverNextMove(); return; }
    if (this.state.over) this._commitStats();
    this.finish();
  }

  // --- how to play (root CLAUDE.md's pattern; tic-tac-toe/js/ui.js's openHelp() is the reference) */

  _helpDiagram() {
    return `<svg class="bs-diagram" viewBox="0 0 120 60" role="img" aria-label="${t('help_caption')}">
      <rect x="2" y="2" width="116" height="56" fill="none" stroke="currentColor" stroke-opacity=".25"/>
      <g fill="var(--bs-ship, #2c3e50)">
        <rect x="10" y="24" width="44" height="12" rx="2"/>
        <rect x="54" y="24" width="22" height="12" rx="2"/>
      </g>
      <text x="88" y="24" font-size="20">✓</text>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="bs-scrim" data-action="close-overlay"></div>
      <div class="bs-card" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="bs-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="bs-card-title">${t('howto')}</h3>
        <p class="bs-help-lead">${t('help_lead')}</p>
        <div class="bs-diagram-wrap">${this._helpDiagram()}</div>
        <div class="bs-help-lines">
          <p class="bs-help-caption">${t('help_caption')}</p>
          <p class="bs-help-example">${t('help_example')}</p>
          <p class="bs-help-rule">${t('help_rule')}</p>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.bs-overlay').forEach((el) => el.remove());
  }

  // --- events --------------------------------------------------------------------------------

  onInput(e) {
    const el = e.target.closest('[data-role="mp-code-input"]');
    if (!el) return;
    const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (el.value !== clean) el.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  onPointerDown(e) {
    if (this.view !== 'placement') return;
    const chip = e.target.closest('[data-role="ship-chip"]');
    if (chip && !e.target.closest('[data-action="rotate-ship"]')) {
      const shipId = chip.dataset.ship;
      this._selectShip(shipId);
      this._dragging = { shipId, pointerId: e.pointerId };
      try { chip.setPointerCapture(e.pointerId); } catch { /* not all browsers need this */ }
    }
  }

  /** Redesign spec bug 1: `document.elementFromPoint` under an active `setPointerCapture` is
   *  unreliable on several mobile browsers (it can keep resolving to the CAPTURING element -- the
   *  ship chip -- for every pointer position, so a real drag never finds a target cell and every
   *  placement fell back to the separate tap-a-cell path, which read as "click to place" even
   *  though the drag code was there). Computing the target cell directly from the pointer's own
   *  coordinates against the board's own geometry sidesteps hit-testing (and its capture quirks)
   *  entirely, so it works the same everywhere. */
  _cellAtPoint(clientX, clientY) {
    const board = this.root && this.root.querySelector('[data-role="place-board"]');
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const size = boardSizeFor(this._placeSizeKey);
    const cell = rect.width / size;
    if (cell <= 0) return null;
    const c = Math.min(size - 1, Math.max(0, Math.floor((clientX - rect.left) / cell)));
    const r = Math.min(size - 1, Math.max(0, Math.floor((clientY - rect.top) / cell)));
    return { r, c };
  }

  onPointerMove(e) {
    if (this.view !== 'placement' || !this._dragging) return;
    const cell = this._cellAtPoint(e.clientX, e.clientY);
    if (!cell) { if (this._placePreview) { this._placePreview = null; this.renderPlacement(); } return; }
    if (this._placePreview && this._placePreview.r === cell.r && this._placePreview.c === cell.c) return;
    this._placePreview = cell;
    this.renderPlacement();
  }

  onPointerUp(e) {
    if (this.view !== 'placement' || !this._dragging) return;
    const { shipId } = this._dragging;
    this._dragging = null;
    if (this._placePreview) this._tryPlaceAt(shipId, this._placePreview.r, this._placePreview.c);
    this._placePreview = null;
  }

  onKeyDown(e) {
    if (this.view !== 'placement' || !this._placeSelected) return;
    const size = boardSizeFor(this._placeSizeKey);
    const cur = this._placePreview || { r: 0, c: 0 };
    if (e.key === 'ArrowUp') { this._placePreview = { r: Math.max(0, cur.r - 1), c: cur.c }; this.renderPlacement(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this._placePreview = { r: Math.min(size - 1, cur.r + 1), c: cur.c }; this.renderPlacement(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { this._placePreview = { r: cur.r, c: Math.max(0, cur.c - 1) }; this.renderPlacement(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { this._placePreview = { r: cur.r, c: Math.min(size - 1, cur.c + 1) }; this.renderPlacement(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { this._rotateShip(this._placeSelected); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { this._tryPlaceAt(this._placeSelected, cur.r, cur.c); e.preventDefault(); }
  }

  onClick(e) {
    const cell = e.target.closest('[data-role="place-cell"]');
    if (cell && this.view === 'placement' && this._placeSelected && !this._dragging) {
      this._tryPlaceAt(this._placeSelected, Number(cell.dataset.r), Number(cell.dataset.c));
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.root.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'toggle-row') {
      this._setupExpanded = this._setupExpanded === btn.dataset.row ? null : btn.dataset.row;
      this.renderSetup();
    } else if (action === 'set-size') {
      this._setup.size = btn.dataset.v; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-diff') {
      this._setup.difficulty = btn.dataset.v; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-first') {
      this._setup.firstMode = btn.dataset.v; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-bonus') {
      this._setup.bonusShotOnHit = btn.dataset.v === 'on'; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-mode') {
      this._mode = btn.dataset.v; this._setupExpanded = null; this._mpError = ''; this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'select-ship') {
      this._selectShip(btn.dataset.ship);
    } else if (action === 'rotate-ship') {
      this._rotateShip(btn.dataset.ship);
    } else if (action === 'auto-place') {
      this._autoPlaceAll();
    } else if (action === 'clear-fleet') {
      this._clearPlacement();
    } else if (action === 'placement-ready') {
      this._placementReady();
    } else if (action === 'fire') {
      this.fireAt(Number(btn.dataset.r), Number(btn.dataset.c));
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
    } else if (action === 'rematch') {
      this.closeOverlays(); this.startGame();
    } else if (action === 'change-settings') {
      this.closeOverlays(); this.renderSetup();
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
      this.closeOverlays(); this._mpStartNextGame();
    } else if (action === 'mp-leave') {
      this.closeOverlays(); this._mpLeaveToSetup();
    } else if (action === 'mp-end-ok') {
      this.closeOverlays(); this.renderSetup();
    } else if (action === 'mp-update-required') {
      this._mpForceUpdate();
    }
  }
}

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new BattleshipUI(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
export function isInProgress() {
  return !!(instance && instance.isInProgress());
}
export default { init, destroy, isInProgress };
