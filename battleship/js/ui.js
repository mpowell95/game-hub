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
// How long a cannonball spends in the air, in ms, and the ONE place it is set: `renderBattle`
// pushes it into CSS as `--bs-fly`, which is what holds the peg/splash at the target back so the
// splash happens when the ball ARRIVES, and `_shotSettleMs` adds it to the window a shot owns
// before the next re-render. Change it here and the whole sequence follows.
//
// It was 340ms and Matt could not see the ball move at all -- across a whole phone screen that is
// a blink. At 850ms the shot is something you actually watch cross the water.
const FLY_MS = 850;
const SETTINGS_KEY = 'gamehub.battleship.v1';
const SAVE_KEY = 'gamehub.battleship.save.v1';
const MP_SAVE_KEY = 'gamehub.battleship.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
// How long any lobby round trip (create room / join room / restore) may take before this game
// gives up and shows the offline error. See _withNetTimeout for why this has to exist at all.
const MP_NET_TIMEOUT_MS = 12 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
const MP_DIFFICULTY = 'mp';
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
const SIZES = [['classic', 'size_classic'], ['quick', 'size_quick']];
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };
const SHIP_LABEL_KEY = { carrier: 'ship_carrier', battleship: 'ship_battleship', cruiser: 'ship_cruiser', submarine: 'ship_submarine', destroyer: 'ship_destroyer' };

// Inline glyphs for the two big mode buttons and the two deploy pills. Drawn here rather than in
// ship-art.js: that file is the SHIP silhouette builder and nothing else.
const BOT_ICON = `<svg class="bs-bigbtn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <rect x="4" y="8" width="16" height="11" rx="3"/><rect x="11" y="3" width="2" height="4"/><circle cx="12" cy="3" r="1.6"/>
  <circle cx="9" cy="13" r="1.7" fill="#fff"/><circle cx="15" cy="13" r="1.7" fill="#fff"/><rect x="9" y="16" width="6" height="1.4" rx=".7" fill="#fff"/>
</svg>`;
const PERSON_ICON = `<svg class="bs-bigbtn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <circle cx="12" cy="7.5" r="3.8"/><path d="M4.5 20c0-4.1 3.4-6.5 7.5-6.5S19.5 15.9 19.5 20z"/>
</svg>`;
const DICE_ICON = `<svg class="bs-pill-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.8" fill="#fff"/>
  <circle cx="15.5" cy="15.5" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1.8" fill="#fff"/>
</svg>`;
const BOLT_ICON = `<svg class="bs-pill-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <path d="M13 2 4 14h6l-1 8 9-12h-6z"/>
</svg>`;
// The wordless controls. Every one of these replaced a labelled button (Matt, 2026-08-11: "There's
// way too much text"), so each keeps its meaning in an aria-label at the call site -- a symbol
// with no accessible name is a step backwards, not a simplification.
const ICON_TRASH = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></svg>`;
const ICON_HELP = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 15.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6m0-11.6c2.2 0 3.9 1.5 3.9 3.5 0 1.5-.8 2.3-2 3.1-.9.6-1.1 1-1.1 1.8v.4h-2v-.7c0-1.5.6-2.3 1.7-3 .9-.6 1.3-1 1.3-1.7 0-.9-.7-1.5-1.8-1.5s-1.9.7-1.9 1.8H8C8 7.4 9.7 5.8 12 5.8"/></svg>`;
const ICON_CLOSE = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
  stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_RESTART = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 13a8 8 0 1 0 2.3-6"/><path d="M4 4v7h7"/></svg>`;
const ICON_TARGET = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
  stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke-linecap="round"/></svg>`;

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
    this.view = 'setup';   // 'setup' | 'placement' | 'botplace' | 'battle'
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
    this._mpRestoreTimer = null;  // see _tryRestoreMP's watchdog
    this._statsCommitted = false;
    this._lastShot = null;     // { seat, r, c, result, sunk, cells } -- the one cell that gets an entrance animation
    this._sunkBanner = '';
    this._aimCell = null;   // the square the crosshair is parked on, awaiting FIRE
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
    this._botFleet = null;        // screen 3: the bot's fleet, built before the battle starts
    this._botPlaceTimer = null;
    this._cannonPlayed = null;    // "seat:r:c" whose recoil has already played (see _resolveCannons)
    this._aimBySide = { mine: null, theirs: null }; // where each cannon is left pointing
    this._botAiming = false;      // the bot has the gun up and is choosing a cell
    this._fxPending = null;       // a shot whose cannonball still has to be thrown this render
    this._cannons = { mine: null, theirs: null };
    this._aimTimer = null;

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
    if (this._botPlaceTimer) { clearTimeout(this._botPlaceTimer); this._botPlaceTimer = null; }
    if (this._mpRestoreTimer) { clearTimeout(this._mpRestoreTimer); this._mpRestoreTimer = null; }
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

  /** IN MULTIPLAYER THE PROFILE'S BOT OPPONENT IS NEVER A FALLBACK. It used to be, and that is what
   *  put "Waiting for Anita Bonita..." (a computer opponent configured on the profile page) on a
   *  screen that was waiting for a real person -- Matt's own screenshot of MP failing, 2026-08-11.
   *  A name that belongs to nobody in the room is worse than no name: it makes a stuck screen look
   *  like a working one. Until the room actually tells us who joined, MP says "Opponent". */
  _identity() {
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const bot = profile && profile.opponents && profile.opponents[0];
    const mpOpp = this.mp && this.mp.opp;
    if (this.mp) {
      return {
        humanName: (profile && profile.name) || t('you'),
        humanEmoji: (profile && profile.emoji) || '🙂',
        oppName: (mpOpp && mpOpp.name) || t('mp_opponent_label'),
        oppEmoji: (mpOpp && mpOpp.avatar) || '🙂',
      };
    }
    return {
      humanName: (profile && profile.name) || t('you'),
      humanEmoji: (profile && profile.emoji) || '🙂',
      oppName: (bot && bot.name) || t('computer'),
      oppEmoji: (bot && bot.emoji) || '🤖',
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
    this._offViewport = onViewportResize(() => { this._fitBattleBoards(); this._updateCellSize(); });
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
    this._cannonPlayed = null;
    this._aimBySide = { mine: null, theirs: null };
    this._botAiming = false;
    this._fxPending = null;
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

  /** The three Options chips: board size, first shot, bonus shot on hit. Every setting the old
   *  accordion carried is still here (and writes the same keys) -- it is one compact line of
   *  chips now instead of four expanding rows, per the redesign. Each chip CYCLES its value. */
  _optionChips() {
    const s = this._setup;
    const id = this._identity();
    const firstLbl = s.firstMode === 'you' ? t('you') : s.firstMode === 'opponent' ? id.oppName : t('first_alternate');
    const chip = (action, label, value) =>
      `<button type="button" class="bs-chip" data-action="${action}">${esc(label)}: <span class="bs-chip-value">${esc(value)}</span></button>`;
    return `<div class="bs-options">
      <span class="bs-options-label">${t('options_label')}</span>
      <div class="bs-chips">
        ${chip('cycle-size', t('chip_size'), s.size === 'quick' ? t('size_quick') : t('size_classic'))}
        ${chip('cycle-first', t('chip_first'), firstLbl)}
        ${chip('cycle-bonus', t('chip_bonus'), s.bonusShotOnHit ? t('bonus_on') : t('bonus_off'))}
      </div>
    </div>`;
  }

  _diffIndex() {
    const i = DIFFICULTIES.findIndex(([k]) => k === this._setup.difficulty);
    return i < 0 ? 1 : i;
  }

  /** The Play vs. Friend panel. This is the EXISTING host/join lobby, reached from the purple
   *  button instead of a mode segment -- there is no second multiplayer path. */
  _friendHTML() {
    if (this._lobby) return this._lobbyHTML();
    const seg = this._seg('set-mode', this._mode, [['host', t('mode_host')], ['join', t('mode_join')]]);
    const back = `<button type="button" class="bs-btn bs-btn-ghost" data-action="mode-solo">${t('mp_back_btn')}</button>`;
    if (this._mode === 'join') return `${seg}${this._joinBodyHTML()}${back}`;
    return `${seg}
      <p class="bs-mp-msg">${esc(this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_host_hint')))}</p>
      <button type="button" class="bs-btn bs-btn-primary" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>
      ${back}`;
  }

  /** Screen 1: the mode screen. A dark navy header with the game's own one-line explanation, and a
   *  card riding over it with the opponent avatar, the difficulty in gold caps over a three-stop
   *  slider, the two big play buttons, and the Options chips.
   *
   *  THE SLIDER IS DISPLAY ONLY: the stored values stay `beginner`/`intermediate`/`pro` (storage
   *  vocabulary that js/difficulty-tiers.js and js/game-stats-ui.js's DIFF_META both key on) --
   *  only the labels are Easy/Medium/Hard. The ski-slope tier shape (diffShapeSVG) stays beside
   *  the name: it is the repo's colorblind-safe difficulty marker, never hue alone. */
  renderSetup() {
    this._shellMode('');
    if (this._dead) return;
    this.closeOverlays();
    if (this.view === 'battle' && this.state && !this.state.over && !this.mp) clearGame();
    this.view = 'setup';
    this.state = null;
    this._botFleet = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    if (this._botPlaceTimer) { clearTimeout(this._botPlaceTimer); this._botPlaceTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    const header = `<div class="bs-headerpanel">
      <h1 class="bs-title">${t('title')}</h1>
      <p class="bs-sub">${t('tagline')}</p>
    </div>`;
    const statsLine = stats ? `<p class="bs-stats">${esc(stats)}</p>` : '';

    if (this._lobby || this._mode === 'host' || this._mode === 'join') {
      this.shell.innerHTML = `<div class="bs-mode">${header}
        <div class="bs-modecard">${this._friendHTML()}</div>${statsLine}</div>`;
      return;
    }

    const di = this._diffIndex();
    this.shell.innerHTML = `<div class="bs-mode">
      ${header}
      <div class="bs-modecard">
        <div class="bs-avatar" aria-hidden="true">${esc(id.oppEmoji)}</div>
        <div class="bs-avatar-name">${esc(id.oppName)}</div>
        <div class="bs-diffname">${diffShapeSVG(tierOf(s.difficulty))}${esc(t(DIFF_LABEL_KEY[s.difficulty]))}</div>
        <div class="bs-slider-wrap">
          <input class="bs-slider" type="range" min="0" max="2" step="1" value="${di}"
            data-role="diff-slider" aria-label="${esc(t('row_difficulty'))}">
          <div class="bs-slider-stops">${DIFFICULTIES.map(([, k], i) =>
            `<span class="bs-slider-stop ${i === di ? 'is-on' : ''}">${esc(t(k))}</span>`).join('')}</div>
        </div>
        <button type="button" class="bs-bigbtn bs-bigbtn-bot" data-action="play-bot">${BOT_ICON}${esc(t('play_vs_bot'))}</button>
        <button type="button" class="bs-bigbtn bs-bigbtn-friend" data-action="play-friend">${PERSON_ICON}${esc(t('play_vs_friend'))}</button>
        ${this._optionChips()}
        <button type="button" class="bs-link" data-action="help">${t('howto')}</button>
      </div>
      ${statsLine}
    </div>`;
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
    else if (this.view === 'botplace') this.renderBotPlacing();
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

  /** Screen 3, solo: the bot lays out its own fleet while you watch. Two seconds, skippable by a
   *  tap. The bot's ships are shown as loose silhouettes on a deck, NEVER on a board -- showing
   *  where they sit would hand the player the whole game. */
  _finishPlacementSolo() {
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this._botFleet = autoPlace(this._placeSizeKey, this._placeShipSet, rng) || emptyFleet(this._placeSizeKey);
    this.view = 'botplace';
    this.renderBotPlacing();
    if (this._botPlaceTimer) clearTimeout(this._botPlaceTimer);
    this._botPlaceTimer = setTimeout(() => {
      this._botPlaceTimer = null;
      this._startBattleSolo();
    }, reducedMotion() ? 400 : 2000);
  }

  _skipBotPlacing() {
    if (this.view !== 'botplace') return;
    if (this._botPlaceTimer) { clearTimeout(this._botPlaceTimer); this._botPlaceTimer = null; }
    this._startBattleSolo();
  }

  _startBattleSolo() {
    if (this._dead || !this._botFleet) return;
    const size = boardSizeFor(this._placeSizeKey);
    let s = newGame(size, this._placeSizeKey, this._setup.bonusShotOnHit, this._soloStarterSeat);
    s = setFleet(s, 0, this._placeFleet);
    s = setFleet(s, 1, this._botFleet);
    this._botFleet = null;
    this.state = s;
    this.view = 'battle';
    this._statsCommitted = false;
    this._lastShot = null;
    this._cannonPlayed = null;
    this._aimBySide = { mine: null, theirs: null };
    this._botAiming = false;
    this._fxPending = null;
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
    //
    // --bs-cell is the STEP from one cell's left edge to the next (cell width PLUS the grid gap),
    // measured from two real cells, so a sprite spanning `len` cells lands exactly on the grid
    // instead of falling short by (len-1) gaps. --bs-pad is the board's own padding offset (the
    // absolute-positioning origin is the padding box) and --bs-gap is the leftover, so a sprite is
    // `len * --bs-cell - --bs-gap` wide. All three are read from the DOM, never duplicated from
    // the CSS by hand -- the arithmetic version drifts the moment padding or gap changes.
    let primaryW = 0;
    const boards = this.root.querySelectorAll('.bs-board');
    for (const board of boards) {
      const cells = board.querySelectorAll('.bs-cell');
      if (cells.length < 2) continue;
      const b0 = cells[0].getBoundingClientRect();
      const b1 = cells[1].getBoundingClientRect();
      const step = (b1.left - b0.left) || b0.width;
      if (!(step > 0)) continue;
      const brect = board.getBoundingClientRect();
      const pad = Math.max(0, b0.left - (brect.left + board.clientLeft));
      board.style.setProperty('--bs-cell', `${step.toFixed(2)}px`);
      board.style.setProperty('--bs-pad', `${pad.toFixed(2)}px`);
      board.style.setProperty('--bs-gap', `${Math.max(0, step - b0.width).toFixed(2)}px`);
      if (board.dataset.role === 'enemy-board' || board.dataset.role === 'place-board') primaryW = step;
    }
    // Kept on the root as well: the fleet roster's silhouettes sit OUTSIDE both boards and still
    // need a sensible unit. The primary (enemy/placement) board is the right reference for them.
    if (primaryW > 0) this.root.style.setProperty('--bs-cell', `${primaryW.toFixed(2)}px`);
  }

  /** Section 5's "fixed, no page scroll" requirement, from real measurement instead of a vw/vh
   *  guess. The static `min(90vw, 42vh, 420px)` / `min(64vw, 30vh, 300px)` CSS ceilings on the two
   *  boards (kept below as a fallback) were sized as if the boards were the only thing on screen --
   *  they don't know about the hub's own immersive back-button padding, the topbar, the roster
   *  strip, or the actions row, so real devices needed to scroll to see the whole battle screen,
   *  the exact thing section 5 rules out. This measures every non-board sibling in `.bs-battle` for
   *  its REAL rendered height, subtracts that (plus the grid's own row gaps) from the REAL viewport
   *  height available below the boards' own top, and splits what's left between the two boards at a
   *  fixed 4:3 ratio (enemy:own -- the same "clearly bigger" relationship the old vw ratio drew),
   *  still capped by the old vw-based ceilings so a wide/short viewport (tablet, landscape) never
   *  grows a board absurdly. Inline `style.width` wins over the stylesheet rule by construction, so
   *  this only ever tightens the ceiling, never fights it. Only meaningful in the battle view --
   *  a no-op elsewhere since it needs the sandwich's specific children to be mounted. */
  _fitBattleBoards() {
    if (this._dead || !this.root || this.view !== 'battle') return;
    const battle = this.root.querySelector('.bs-battle');
    if (!battle) return;
    const enemyPanel = battle.querySelector('.bs-boardpanel-enemy');
    const ownPanel = battle.querySelector('.bs-boardpanel-own');
    const enemyBoard = enemyPanel && enemyPanel.querySelector('.bs-board');
    const ownBoard = ownPanel && ownPanel.querySelector('.bs-board');
    if (!enemyBoard || !ownBoard) return;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const top = battle.getBoundingClientRect().top;
    let inFlow = 0;
    let consumed = 0;
    for (const child of battle.children) {
      if (child === enemyPanel || child === ownPanel) {
        // whatever the panel wraps its board in (the water/deck frame's own padding) is fixed px
        // and does not scale with the board, so measuring it once here is safe
        const board = child === enemyPanel ? enemyBoard : ownBoard;
        consumed += Math.max(0, child.getBoundingClientRect().height - board.getBoundingClientRect().height);
        inFlow++;
        continue;
      }
      // The FX overlay and the sunk banner are absolute/fixed: they take no room in the grid, and
      // counting their boxes (the overlay's is the FULL height of the screen) would shrink the
      // boards to nothing the moment either appeared.
      const pos = getComputedStyle(child).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      inFlow++;
      consumed += child.getBoundingClientRect().height;
    }
    const gapPx = parseFloat(getComputedStyle(battle).rowGap) || 0;
    consumed += gapPx * Math.max(0, inFlow - 1);
    const bottomSafe = 6;
    const available = Math.max(160, vh - top - consumed - bottomSafe);
    // Both boards are the SAME size and as close to edge-to-edge as the viewport allows -- the
    // reference's two boards are equals filling the width, not a big one and a little one.
    const wide = Math.min(document.documentElement.clientWidth - 4, 460);
    const apply = (px) => {
      enemyBoard.style.width = `${px.toFixed(1)}px`;
      ownBoard.style.width = `${px.toFixed(1)}px`;
    };
    let size = Math.max(120, Math.min(available / 2, wide));
    apply(size);
    // Whatever chrome sits BELOW this game is invisible from inside its own DOM -- in the hub it is
    // `.hub-main`'s 40px bottom padding, which is why the battle screen fitted exactly in the
    // standalone page and hung 40px off the bottom once mounted in the hub. Rather than hard-code
    // a guess at the host's padding, measure the overflow it actually produced and take it off
    // both boards, once. Idempotent: re-running measures no overflow and changes nothing.
    const over = document.documentElement.scrollHeight - vh;
    if (over > 1) apply(Math.max(120, size - over / 2));
    this._bleedToEdges();
  }

  /** Full-bleed the battle screen out of whatever gutter the host page wraps the game in. In the
   *  hub that is `.hub-main`'s 16px sides, its 40px bottom, and the ~98px of top clearance the
   *  floating back button needs; the standalone page has none of it. All four are MEASURED rather
   *  than assumed, so neither host is hard-coded here and neither ends up with a band of hub grey
   *  where the reference has continuous deck.
   *
   *  Sideways it is plain negative margins, capped so a desktop-width window doesn't stretch the
   *  game across the whole screen. Vertically it is negative margin PLUS matching padding: the
   *  root's background reaches the screen edge while its content stays exactly where it was, so
   *  the page's total height is unchanged and nothing starts scrolling. The measurement is taken
   *  from the SHELL, which those margins do not move -- measuring the root instead would read
   *  its own correction back as zero on the next pass and undo itself. Cleared by
   *  `_shellMode('')` on every other screen. */
  _bleedToEdges() {
    // Measured off the HOST's content box, not the root's own: the root's width already carries
    // whatever correction the last pass applied, so reading it back would compute zero and undo
    // itself on every second render. The host box is unaffected by anything done here.
    const host = this.root.parentElement;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    const hcs = getComputedStyle(host);
    const avail = hr.width - (parseFloat(hcs.paddingLeft) || 0) - (parseFloat(hcs.paddingRight) || 0);
    if (!avail) return;
    const target = Math.min(document.documentElement.clientWidth, 560);
    const extra = Math.max(0, Math.round((target - avail) / 2));
    const st = this.shell.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const up = Math.max(0, Math.round(st.top));
    const down = Math.max(0, Math.round(vh - st.bottom));
    const px = (n) => (n ? `${n}px` : '');
    this.root.style.marginLeft = px(-extra);
    this.root.style.marginRight = px(-extra);
    this.root.style.marginTop = px(-up);
    this.root.style.paddingTop = px(up);
    this.root.style.marginBottom = px(-down);
    this.root.style.paddingBottom = px(down);
  }

  /** Screen 2: Deploy your ships. Dark navy panel on top (title, hint, RANDOM, and SAVE once the
   *  fleet is complete), then the salmon deck carrying the tray of not-yet-placed ships and the
   *  wooden board. SAVE is ABSENT until every ship is down, not disabled-and-greyed. */
  renderPlacement() {
    this._shellMode('');
    if (this._dead) return;
    this.closeOverlays();
    // MP: once this device has announced readiness there is nothing left to place, so it moves to
    // the same waiting screen the solo bot-placing beat uses. Driven entirely by the EXISTING
    // ready handshake (mp.localReady / _maybeStartBattle) -- no second handshake was invented.
    if (this.mp && this.mp.localReady) {
      this.renderWaiting(t('waiting_for_opponent', { opp: this._identity().oppName }), null);
      return;
    }
    // The keyboard path (arrows move, R rotates, Enter places) re-renders on EVERY key, which
    // destroys whatever was focused -- and the keydown listener is root-scoped, so once focus falls
    // back to <body> no further key ever reaches it and the path dies after one press. Re-focus the
    // equivalent element after the render, but only if focus was inside the game to begin with, so
    // this never steals it from anywhere else.
    const keepFocus = !!(this.root && this.root.contains(document.activeElement) && document.activeElement !== document.body);
    const size = boardSizeFor(this._placeSizeKey);
    const placedIds = new Set(this._placeFleet.ships.map((s) => s.id));
    const trayDefs = this._placeShipSet.filter((d) => !placedIds.has(d.id));
    const remaining = trayDefs.length;
    const justRotated = this._justRotatedShip;
    this._justRotatedShip = null;

    // THE TRAY IS ONE FIXED-HEIGHT ROW AND IT NEVER REFLOWS. Matt, 2026-08-11: "It moves around if
    // you drag your boats while placing them." It did, and the tray was why: five named chips with
    // their own rotate buttons wrapped onto TWO rows, so placing the first ship collapsed it to one
    // and yanked the board 71px up the screen -- mid-drag, under the finger. The chips are bare
    // silhouettes now (no name, no button), they always fit one row, and `.bs-tray` carries a fixed
    // height so an emptying tray leaves the board exactly where it was. Measured, not assumed:
    // test-visual.mjs's battleship PLAY probe asserts the board's top never moves across a full
    // placement.
    //
    // The per-chip rotate BUTTON was the other half of the bug. It sat dead centre on the chip --
    // the natural place to grab a ship -- and `onPointerDown` returns early on it, so a drag begun
    // there did nothing at all. Rotation is now the same gesture a placed ship already used: tap
    // the ship. Tap an unselected chip to select it, tap it again to rotate.
    const tray = trayDefs.map((def) => {
      const dir = this._placeDir[def.id] || 'h';
      const label = t(SHIP_LABEL_KEY[def.id]);
      // Sized by FLEX, proportional to the ship's length, never a pixel width: five chips at a fixed
      // px-per-cell overflowed a 390px phone and the longest ship was silently clipped by the row's
      // own `overflow: hidden`. Flex-basis 0 with grow = len means the row always fits exactly,
      // whatever the board size or the screen, and the ships stay in correct relative proportion.
      return `<div class="bs-trayship ${this._placeSelected === def.id ? 'is-selected' : ''} ${dir === 'v' ? 'is-vert' : ''} ${justRotated === def.id ? 'is-spinning' : ''}"
          style="flex-grow:${def.len}" data-role="ship-chip" data-ship="${def.id}" role="button" tabindex="0"
          aria-label="${esc(label)}" title="${esc(label)}">
        <span class="bs-trayship-art">${shipArtHtml(def.id, def.len)}</span>
      </div>`;
    }).join('');

    const preview = this._placePreview;
    const selDef = this._placeSelected && this._placeShipSet.find((d) => d.id === this._placeSelected);
    const ghostCells = new Map();
    let ghostLegal = false;
    if (selDef && preview) {
      const dir = this._placeDir[selDef.id] || 'h';
      ghostLegal = this._placementLegalAt(selDef.id, preview.r, preview.c, dir);
      for (let i = 0; i < selDef.len; i++) {
        const rr = dir === 'v' ? preview.r + i : preview.r;
        const cc = dir === 'h' ? preview.c + i : preview.c;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) ghostCells.set(`${rr},${cc}`, ghostLegal);
      }
    }

    // Legality is SHAPE first: a legal ghost is a solid outline with a check badge, an illegal one
    // a dashed outline with a cross badge. Color only reinforces it (Matt is red/green colorblind).
    // WHICH SQUARES IS THIS BOAT ON. Matt, 2026-08-11: "what squares are the 2 square boat even on?
    // They visually cover 3 squares." The sprite is a hull with a pointed bow and a rounded stern
    // drawn over the grid, so its silhouette never lines up with the gridlines and you cannot count
    // squares off it -- a 2-cell destroyer genuinely looks like it is touching three. The CELLS
    // underneath a ship are filled in now, which is the answer every physical Battleship set uses:
    // the footprint is the coloured squares, and the sprite is just the picture sitting on them.
    const occupied = new Set();
    for (const ship of this._placeFleet.ships) {
      for (let i = 0; i < ship.len; i++) {
        occupied.add(`${ship.dir === 'v' ? ship.r + i : ship.r},${ship.dir === 'h' ? ship.c + i : ship.c}`);
      }
    }
    const cellsHtml = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const ghost = ghostCells.get(`${r},${c}`);
        const cls = ['bs-cell',
          occupied.has(`${r},${c}`) ? 'bs-cell-ship' : '',
          ghost === true ? 'bs-ghost-valid' : '', ghost === false ? 'bs-ghost-invalid' : ''].filter(Boolean).join(' ');
        const badge = ghost === undefined ? ''
          : `<span class="bs-ghost-badge" aria-hidden="true">${ghost ? '&#10003;' : '&times;'}</span>`;
        cellsHtml.push(`<button type="button" class="${cls}" data-role="place-cell" data-r="${r}" data-c="${c}"
          aria-label="${esc(t('placement_cell_aria', { r: r + 1, c: c + 1 }))}">${badge}</button>`);
      }
    }

    // A placed ship is a real sprite you can pick straight off the board: drag to move, tap to
    // rotate in place.
    const placedSprites = this._placeFleet.ships.map((ship) => this._shipSpriteHtml(ship, { draggable: true })).join('');
    // The floating corner rotate arrows are gone with the tray's rotate buttons, for the same
    // reason: they are one more control sitting on top of the thing you are trying to drag, and
    // tapping the ship itself has always rotated it (onPointerUp's `origin` branch). The keyboard
    // path (R) is unchanged.
    const rotateHandles = '';
    const ghostSprite = (selDef && preview)
      ? this._shipSpriteHtml({ id: selDef.id, len: selDef.len, r: preview.r, c: preview.c, dir: this._placeDir[selDef.id] || 'h' }, { ghost: true })
      : '';

    // Everything that used to be prose here is a symbol now: the hint line, the "N ships left to
    // place" counter, the "Every ship is on the board" / "Fleet ready. Tap SAVE to sail." pair, and
    // the two word-buttons at the bottom. What is left says the same things without sentences --
    // the tray shows what is unplaced, and SAVE only exists once nothing is.
    this.shell.innerHTML = `
      <div class="bs-deploy">
        <div class="bs-headerpanel">
          <h1 class="bs-title">${t('deploy_title')}</h1>
          <div class="bs-deploy-btns">
            <button type="button" class="bs-iconbtn" data-action="exit-placement" aria-label="${esc(t('exit'))}" title="${esc(t('exit'))}">${ICON_CLOSE}</button>
            <button type="button" class="bs-iconbtn" data-action="clear-fleet" aria-label="${esc(t('clear_fleet'))}" title="${esc(t('clear_fleet'))}">${ICON_TRASH}</button>
            <button type="button" class="bs-iconbtn bs-iconbtn-random" data-action="auto-place" aria-label="${esc(t('random'))}" title="${esc(t('random'))}">${DICE_ICON}</button>
            ${remaining === 0
              ? `<button type="button" class="bs-pill bs-pill-save" data-action="placement-ready" aria-label="${esc(t('save'))}">${BOLT_ICON}${esc(t('save'))}</button>`
              : ''}
            <button type="button" class="bs-iconbtn" data-action="help" aria-label="${esc(t('howto'))}" title="${esc(t('howto'))}">${ICON_HELP}</button>
          </div>
        </div>
        <div class="bs-deck-surface">
          <div class="bs-tray">${tray}</div>
          <div class="bs-board-wrap">
            <div class="bs-board bs-board-place" tabindex="0" style="grid-template-columns:repeat(${size},1fr)" data-role="place-board">${cellsHtml.join('')}${placedSprites}${ghostSprite}${rotateHandles}</div>
          </div>
        </div>
        <p class="bs-sr" aria-live="polite">${remaining > 0 ? esc(t('ships_remaining', { n: remaining })) : esc(t('fleet_ready_hint'))}</p>
      </div>`;
    this._updateCellSize();
    if (keepFocus) {
      const el = this.shell.querySelector(`[data-role="ship-chip"][data-ship="${this._placeSelected}"]`)
        || this.shell.querySelector('[data-role="place-board"]');
      if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch { el.focus(); } }
    }
  }

  /** Screen 3: the opponent is getting ready. Enemy waters dark and empty on top, the line, and
   *  (solo only) the bot's fleet laid out below in THEIR blue -- as loose silhouettes, never on a
   *  board, so nothing about where they sit is given away. Tap anywhere to skip. */
  renderWaiting(line, botFleet) {
    this._shellMode('');
    if (this._dead) return;
    this.closeOverlays();
    const sizeKey = this._placeSizeKey || (this.mp ? this.mp.sizeKey : this._setup.size);
    const size = boardSizeFor(sizeKey);
    const cells = new Array(size * size).fill('<div class="bs-cell"></div>').join('');
    const ships = botFleet
      ? botFleet.ships.map((s) => `<span class="bs-trayship"><span class="bs-trayship-art" style="width:${s.len * 18}px">${shipArtHtml(s.id, s.len)}</span></span>`).join('')
      : '';
    // MP WAITING IS NOT A DEAD END ANY MORE. Matt's screenshot of MP failing (2026-08-11) was this
    // screen, stuck: no room code to check against the other phone, no way out except the hub's own
    // back button, and a name ("Anita Bonita") belonging to a computer opponent rather than to
    // anyone in the room. It now shows the code, the opponent as the room actually reports them,
    // and a Leave button -- and _mpOnRoomUpdate re-renders it, so the moment the room learns who
    // joined, the screen says so instead of staying frozen on its first guess.
    const mpBits = this.mp
      ? `<div class="bs-wait-code" role="img" aria-label="${esc(t('mp_code_aria'))}">${esc(this.mp.code || '')}</div>
         <button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-action="mp-leave">${esc(t('mp_leave_btn'))}</button>`
      : '';
    this.shell.innerHTML = `
      <div class="bs-wait" ${botFleet ? 'data-action="skip-botplace"' : ''}>
        <div class="bs-headerpanel">
          <h1 class="bs-title">${t('title')}</h1>
        </div>
        <div class="bs-boardpanel bs-boardpanel-enemy">
          <div class="bs-board bs-board-enemy bs-wait-board" style="grid-template-columns:repeat(${size},1fr)" data-role="wait-board" aria-hidden="true">${cells}</div>
        </div>
        <p class="bs-wait-line">${esc(line)}<span class="bs-wait-dots" aria-hidden="true"> ...</span></p>
        ${mpBits}
        ${botFleet ? `<div class="bs-deck-surface bs-wait-fleet"><div class="bs-tray bs-tray-loose">${ships}</div></div>` : ''}
      </div>`;
    this._updateCellSize();
  }

  renderBotPlacing() { this.renderWaiting(t('bot_placing'), this._botFleet); }

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
    // + FLY_MS: the ball's time in the air happens BEFORE the impact, and the impact's own
    // animations are held back by the same amount (`--bs-fly`), so the whole sequence is that
    // much longer than the impact alone.
    return FLY_MS + (shot.result === 'hit' ? 1150 : 1100) + (shot.sunk ? 900 : 0);
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
    this._botAiming = false;
    // A fresh game (no shots fired either way) can't have any sunk ships -- clears stale
    // reconstructed geometry from a previous game in a rematch series without needing to touch the
    // MP methods that start one (root CLAUDE.md polish pass: no `_mp*` method edited here).
    if (this.state.shotCount[0] === 0 && this.state.shotCount[1] === 0) {
      this._sunkShips = {}; this._sinkPlayed = new Set(); this._cannonPlayed = null;
      this._aimBySide = { mine: null, theirs: null };
    }
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
      // Two beats, not one. First wait out the shot that JUST rendered (the player's own, or the
      // bot's previous bonus-chain shot) -- during which the shooter's own cannon stays on screen
      // finishing its shot. Only THEN does the bot's cannon come up on its own water wearing the
      // "Bot thinking" pill, and it fires a think-beat later. Firing straight out of one timer
      // meant the bot's gun never appeared before the shot it fired.
      const settle = this._shotSettleMs(this._lastShot);
      const fire = () => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        const shipSet = this._shipSetForState();
        const shot = chooseShot(this.state, this._localSeat(), shipSet, this._setup.difficulty, Math.random);
        if (!shot) return;
        const res = fireAndResolve(this.state, this._localSeat(), shot[0], shot[1]);
        this.state = res.state;
        this._lastShot = { seat: this._localSeat(), r: shot[0], c: shot[1], result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells };
        this._maybeShowSunkBanner(res.answer, this._localSeat());
        this._afterStateChange();
      };
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        this._botAiming = true;
        this.renderBattle();
        this.aiTimer = setTimeout(fire, this._aiThinkMs());
      }, Math.max(0, settle));
    } else {
      this._settleThenIdle();
    }
  }

  /** EVERY SHOT SAYS WHAT IT DID. Matt, 2026-08-11: "there's no 'hit' or 'miss'."
   *
   *  It used to announce only a SINK, and only as a picture. That was a text cut taken too far: a
   *  hit and a miss both left nothing but a small mark on a board that was being dimmed at the same
   *  moment, so the single most important question in the game -- did that shot do anything? -- had
   *  no answer on screen. Every resolved shot now raises a banner: MISS, HIT!, or SUNK with the
   *  ship's own silhouette struck through. Words here are the point, not clutter.
   *
   *  `seat` is the DEFENDER, which is what decides whose news this is: your hit on them is good
   *  news, their hit on you is not, and the banner is coloured accordingly. */
  _maybeShowSunkBanner(answer, seat) {
    if (!answer || !answer.result) return;
    if (answer.sunk && answer.shipId) this._recordSunkShipGeometry(answer);
    // `seat` is the DEFENDER, so a defender who is NOT me means I scored this. Two different things
    // key off that and they point opposite ways, which is why they are separate fields: the
    // BANNER's colour is whose good news it is (mine when I scored), while a sunk ship is drawn in
    // its OWNER's fleet colour (theirs when I sank it).
    const iScored = seat != null && seat !== this._localSeat();
    const def = answer.shipId ? (this._shipSetForState() || []).find((d) => d.id === answer.shipId) : null;
    if (answer.sunk && answer.shipId) {
      this._sunkBanner = {
        kind: 'sunk',
        word: t('res_sunk'),
        html: shipArtHtml(answer.shipId, def ? def.len : 3),
        len: def ? def.len : 3,
        mine: iScored,
        shipTheirs: iScored,
        label: t('sunk_banner', { ship: t(SHIP_LABEL_KEY[answer.shipId] || answer.shipId) }),
      };
    } else {
      const hit = answer.result === 'hit';
      this._sunkBanner = {
        kind: hit ? 'hit' : 'miss',
        word: hit ? t('res_hit') : t('res_miss'),
        html: '', len: 0, mine: iScored, shipTheirs: iScored,
        label: hit ? t('res_hit') : t('res_miss'),
      };
    }
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    // Held back by the shell's flight time: the news lands with the ball, not before it leaves.
    const wait = (reducedMotion() ? 0 : FLY_MS) + (this._sunkBanner.kind === 'sunk' ? 1700 : 1150);
    this._bannerTimer = setTimeout(() => { this._sunkBanner = ''; this._bannerTimer = null; if (!this._dead && this.view === 'battle') this.renderBattle(); }, wait);
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
    this._maybeShowSunkBanner(res.answer, target);
    this._afterStateChange();
  }

  /** Shoot at whatever the crosshair is parked on. The aim is cleared FIRST so the confirm button
   *  cannot be double-fired while the shot is resolving. */
  _confirmFire() {
    const aim = this._aimCell;
    if (!aim || this.busy || !this._isMyTurn()) return;
    this._aimCell = null;
    this.fireAt(aim.r, aim.c);
  }

  _statusText() {
    const s = this.state, id = this._identity();
    if (this.mp && this._mpStatusMsg) return t(this._mpStatusMsg);
    if (s.over) return s.winner === this._localSeat() ? t('you_win') : t('opp_wins', { opp: id.oppName });
    if (this.busy && !this.mp) {
      if (this._botAiming) return t('opp_thinking', { opp: id.oppName });
      // A shot is in the air. Say whose, rather than announcing the bot's turn over the top of
      // the player's own shell while it is still flying.
      return this._lastShot && this._lastShot.seat === this._remoteSeat() ? t('shot_away') : t('shot_incoming');
    }
    if (s.turn === this._localSeat()) {
      if (s.bonusShotOnHit && this._lastShot && this._lastShot.seat === this._remoteSeat() && this._lastShot.result === 'hit') {
        return t('bonus_turn_continues');
      }
      return t('your_turn');
    }
    return t('opp_turn', { opp: id.oppName });
  }

  /** The battle screen's turn indicator, WITHOUT WORDS. Matt, 2026-08-11: "There's way too much
   *  text." The whole sentence this replaced ("Your turn: fire!", "Incoming!", "Bot thinking",
   *  "Hit! Fire again.") said one thing: which board is about to be shot at. So that is what it
   *  draws -- the shooter's own avatar, and a chevron pointing at the board taking the shot. Up is
   *  enemy waters, down is your own deck; the same geometry the whole screen is built on.
   *
   *  `_statusText()` is NOT deleted: it still feeds the screen-reader live region below, so nothing
   *  was actually taken away from anyone who needs the sentence.
   *
   *  MP status messages (connection error, resyncing, opponent disconnected) deliberately stay as
   *  WORDS -- they are failures, not instructions, and a symbol for "we lost sync" teaches nobody
   *  anything. They render as a pill over the bar. */
  _turnBarHtml() {
    const s = this.state, id = this._identity();
    const mine = this._cannons && this._cannons.mine;
    const theirs = this._cannons && this._cannons.theirs;
    // Who is SHOOTING, which is not the same as whose turn it is: while your own shell is still in
    // the air the turn has already passed. The cannon on screen is the authority (same source the
    // board wash uses), falling back to the turn when no gun is up.
    const shootingMine = mine ? true : theirs ? false : s.turn === this._localSeat();
    const face = s.over
      ? (s.winner === this._localSeat() ? id.humanEmoji : id.oppEmoji)
      : (shootingMine ? id.humanEmoji : id.oppEmoji);
    const dir = s.over ? 'none' : shootingMine ? 'up' : 'down';
    const chevron = dir === 'none'
      ? '<span class="bs-turn-trophy" aria-hidden="true">🏆</span>'
      : `<svg class="bs-turn-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
          stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15l7-7 7 7"/></svg>`;
    const err = this.mp && this._mpStatusMsg
      ? `<span class="bs-turn-msg">${esc(t(this._mpStatusMsg))}</span>` : '';
    // WHOSE TURN, AT A GLANCE. The first cut of this bar was a small emoji and a small chevron on
    // the deck colour, and Matt's verdict was "it's not clear whose turn it is" -- correct: two
    // 19px marks on a busy screen are not an announcement. It is a full-width coloured bar now,
    // YOUR colour when you are shooting and THEIRS when they are, carrying the name of whoever is
    // up. That is a deliberate step back from the wordless pass: "no word INSTRUCTIONS during the
    // game" was the rule, and a name is not an instruction.
    const who = s.over
      ? (s.winner === this._localSeat() ? id.humanName : id.oppName)
      : (shootingMine ? id.humanName : id.oppName);
    return `<div class="bs-turnbar bs-turn-${shootingMine ? 'mine' : 'theirs'}" data-dir="${dir}">
      <span class="bs-turn-face" aria-hidden="true">${esc(face)}</span>
      <span class="bs-turn-name">${esc(who)}</span>
      ${chevron}${err}
      <p class="bs-sr" aria-live="polite">${esc(this._statusText())}</p>
    </div>`;
  }

  /** One line of the roster strip: a fleet as small silhouettes, each struck through once sunk.
   *  The row's own class supplies --bs-ship, so theirs read blue and yours coral. */
  _rosterItems(sunkIds) {
    const sunk = new Set(sunkIds || []);
    return this._shipSetForState().map((def) => {
      const name = esc(t(SHIP_LABEL_KEY[def.id]));
      return `<span class="bs-roster-item ${sunk.has(def.id) ? 'is-sunk' : ''}" title="${name}" aria-label="${esc(t(sunk.has(def.id) ? 'fleet_status_sunk' : 'fleet_status_afloat', { ship: t(SHIP_LABEL_KEY[def.id]) }))}">
        <span class="bs-roster-silhouette" style="width:${def.len * 11}px">${shipArtHtml(def.id, def.len)}</span>
      </span>`;
    }).join('');
  }

  /** THE CANNON. Seen from directly above, the way the reference draws it: a fat black ring base
   *  with the owner's colour banded inside it, a stubby grey barrel lying across the middle with a
   *  bright highlight down one side, and a black muzzle collar around a dark bore at the tip.
   *  Nothing about it is a side view -- no wheels, no carriage, no silhouette. It is a gun turret
   *  seen from a helicopter.
   *
   *  Each side's cannon sits on ITS OWN board and fires across at the other one: yours red-ringed
   *  on your deck pointing north, theirs blue-ringed on their water pointing south. The barrel is
   *  drawn pointing straight up here and the whole thing is ROTATED to aim (`_aimCannons`, which
   *  needs real layout, so it runs after the HTML is in the document).
   *
   *  Three nested elements, and the nesting is load-bearing:
   *    .bs-cannon      positioned + drop-shadow. Only ever TRANSLATED, so the shadow keeps
   *                    falling the same way however the barrel is pointing.
   *    .bs-cannon-aim  the rotation, about the base centre (`transform-origin: 50% 60%`).
   *    .bs-cannon-rig  the recoil, a shove backwards ALONG the barrel -- which is what a plain
   *                    translateY means once it is inside the rotation.
   *  Its own namespace (.bs-cannon...), never a layout class -- see the header of battleship.css. */
  _cannonHtml(side, { firing = false, thinking = false } = {}) {
    return `<div class="bs-cannon bs-cannon-${side} ${firing ? 'is-firing' : ''}" data-role="cannon-${side}" aria-hidden="true">
      <div class="bs-cannon-aim">
        <div class="bs-cannon-rig">
          <svg class="bs-cannon-svg" viewBox="0 0 100 100" focusable="false">
            <circle cx="50" cy="50" r="46" fill="#0A0B0D"/>
            <circle cx="50" cy="50" r="39" fill="var(--bs-cannon-ring)"/>
            <circle cx="50" cy="50" r="37.4" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="3"/>
            <circle cx="50" cy="50" r="29" fill="#111318"/>
            <rect x="32" y="6.5" width="36" height="69" rx="18" fill="#50565C" stroke="#0A0B0D" stroke-width="4.6" stroke-linejoin="round"/>
            <rect x="36.5" y="32" width="11" height="30" rx="5.5" fill="#9EA5AB"/>
            <ellipse cx="50" cy="16" rx="22" ry="11" fill="#0A0B0D"/>
            <ellipse cx="50" cy="16.5" rx="14.5" ry="7" fill="#282C31"/>
          </svg>
        </div>
      </div>
      ${thinking ? `<span class="bs-cannon-pill">${esc(t('bot_thinking'))}</span>` : ''}
    </div>`;
  }

  /** The crosshair on the cell being fired at: a ring with a full cross straight through it,
   *  overhanging on all four sides. It marks the target while the ball is in the air and fades as
   *  the shot lands. */
  _reticleHtml(r, c, { fading = false } = {}) {
    const style = `left:calc(var(--bs-pad) + var(--bs-cell) * ${(c + 0.5).toFixed(2)}); `
      + `top:calc(var(--bs-pad) + var(--bs-cell) * ${(r + 0.5).toFixed(2)});`;
    return `<div class="bs-reticle ${fading ? 'is-fading' : ''}" style="${style}" aria-hidden="true">
      <svg class="bs-reticle-svg" viewBox="0 0 44 44" focusable="false">
        <circle class="bs-reticle-ring" cx="22" cy="22" r="11"/>
        <line class="bs-reticle-cross" x1="22" y1="2" x2="22" y2="42"/>
        <line class="bs-reticle-cross" x1="2" y1="22" x2="42" y2="22"/>
      </svg>
    </div>`;
  }

  /** Decides, ONCE per render, which cannon is on screen and what it is doing -- rather than
   *  letting each board work it out for itself, which is how you end up with both of them on
   *  screen at once. Returns `{ mine, theirs }`, at most one non-null.
   *
   *  Exactly one cannon is up at any moment, belonging to whichever side is doing the shooting:
   *   - a shot just resolved and its recoil has NOT played  -> the SHOOTER's cannon, firing, and
   *     `_fxPending` is armed so `_playShotFx` throws the ball once layout exists. Gated on
   *     `_cannonPlayed` for the same reason the sink reveal is gated on `_sinkPlayed`:
   *     `_lastShot` outlives many re-renders and an ungated CSS `animation:` replays on each one.
   *   - the bot is choosing a cell -> theirs, on their water, wearing the "Bot thinking" pill.
   *   - still settling a shot      -> the shooter's cannon stays put while its shot plays out.
   *   - otherwise                  -> the cannon of whoever's turn it is, idle, still pointing
   *     where that side last fired (`_aimBySide`), because a gun does not snap back to north. */
  _resolveCannons() {
    const out = { mine: null, theirs: null };
    const s = this.state;
    if (!s || s.over) return out;
    const local = this._localSeat();
    const last = this._lastShot;
    // `_lastShot.seat` is the DEFENDER, so the shooter is the other seat.
    const shooterSide = last ? (last.seat === local ? 'theirs' : 'mine') : null;
    if (shooterSide) this._aimBySide[shooterSide] = { r: last.r, c: last.c };
    if (this.mp && this.mp.pendingShot) this._aimBySide.mine = { r: this.mp.pendingShot.r, c: this.mp.pendingShot.c };
    const key = last ? `${last.seat}:${last.r}:${last.c}` : null;

    let side = null, firing = false, thinking = false;
    if (key && this._cannonPlayed !== key) {
      this._cannonPlayed = key;
      side = shooterSide;
      firing = true;
      this._fxPending = last;
    } else if (this.mp && this.mp.pendingShot) {
      // MP: our shot is out but the defender has not answered yet. We are the one shooting, so our
      // gun is the one up, aimed at the pending cell -- it just has not gone off. (The recoil and
      // the ball wait for the answer, which is when `_lastShot` finally exists.)
      side = 'mine';
    } else if (this._botAiming) {
      side = 'theirs';
      thinking = true;
    } else if (this.busy && shooterSide) {
      side = shooterSide;
    } else {
      side = s.turn === local ? 'mine' : 'theirs';
    }
    if (side) out[side] = { firing, thinking };
    return out;
  }

  /** Points every on-screen cannon at the cell it is shooting at. Has to run after the markup is
   *  in the document: the angle is the real geometry between the cannon's pivot and the target
   *  cell, both measured from the DOM, because the two boards are separate elements and nothing
   *  in CSS knows how far apart they ended up. */
  _aimCannons() {
    if (this._dead || !this.shell) return;
    for (const cannon of this.shell.querySelectorAll('.bs-cannon')) {
      const aim = cannon.querySelector('.bs-cannon-aim');
      if (!aim) continue;
      const side = cannon.classList.contains('bs-cannon-mine') ? 'mine' : 'theirs';
      const at = this._aimBySide[side];
      // Yours shoots at their board; theirs shoots at yours.
      const role = side === 'mine' ? 'enemy-board' : 'own-board';
      // EACH GUN HAS ITS OWN FORWARD. The SVG is drawn pointing NORTH, which is right for YOUR
      // cannon (it stands on your deck at the bottom and fires up at enemy waters) and exactly
      // backwards for THEIRS (it stands on their water at the top and fires DOWN at you). The
      // clamp below used to be a flat +/-64deg about north for both, so the enemy's gun was pinned
      // sideways and never once pointed at the board it was shooting at -- Matt, 2026-08-11: "the
      // cannon isn't even facing the right direction." Clamp the DEVIATION from each side's own
      // forward heading instead, and rest at that heading when there is nothing to aim at.
      const base = side === 'mine' ? 0 : 180;
      const cell = at && this.shell.querySelector(`[data-role="${role}"] .bs-cell[data-r="${at.r}"][data-c="${at.c}"]`);
      if (!cell) { aim.style.setProperty('--bs-aim', `${base}deg`); continue; }
      const cr = cannon.getBoundingClientRect();
      const b = cell.getBoundingClientRect();
      if (!cr.width || !b.width) { aim.style.setProperty('--bs-aim', `${base}deg`); continue; }
      // the pivot matches .bs-cannon-aim's transform-origin (the base centre of the SVG)
      const px = cr.left + cr.width * 0.5, py = cr.top + cr.height * 0.5;
      const dx = (b.left + b.width / 2) - px, dy = (b.top + b.height / 2) - py;
      const deg = Math.atan2(dx, -dy) * 180 / Math.PI;
      let delta = deg - base;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      const aimed = base + Math.max(-64, Math.min(64, delta));
      aim.style.setProperty('--bs-aim', `${aimed.toFixed(1)}deg`);
    }
  }

  /** Throws the cannonball. A black-rimmed iron sphere with a hard grey highlight, launched from
   *  the muzzle (wherever the barrel is currently pointing) and landing dead centre on the target
   *  cell, with a puff of white smoke left behind at the muzzle. Lives in `.bs-fx`, an overlay
   *  spanning BOTH boards, because the whole point is that the shot crosses between them.
   *
   *  Purely decorative and entirely skippable: under reduced motion, or if anything it needs is
   *  missing, it does nothing and the shot still resolves normally. */
  _playShotFx(shot) {
    if (!shot || this._dead || reducedMotion()) return;
    const fx = this.shell && this.shell.querySelector('[data-role="fx"]');
    if (!fx) return;
    const iShot = shot.seat === this._remoteSeat();
    const cannon = this.shell.querySelector(iShot ? '.bs-cannon-mine' : '.bs-cannon-theirs');
    const cell = this.shell.querySelector(`[data-role="${iShot ? 'enemy-board' : 'own-board'}"] .bs-cell[data-r="${shot.r}"][data-c="${shot.c}"]`);
    if (!cannon || !cell) return;
    const host = fx.getBoundingClientRect();
    const cr = cannon.getBoundingClientRect();
    const b = cell.getBoundingClientRect();
    if (!cr.width || !b.width) return;
    const aim = cannon.querySelector('.bs-cannon-aim');
    const deg = parseFloat((aim && aim.style.getPropertyValue('--bs-aim')) || '0') || 0;
    const rad = deg * Math.PI / 180;
    const px = cr.left + cr.width * 0.5, py = cr.top + cr.height * 0.5;
    const reach = cr.height * 0.36;   // pivot -> muzzle, matching the SVG's own geometry
    const mx = px + Math.sin(rad) * reach, my = py - Math.cos(rad) * reach;
    const tx = b.left + b.width / 2, ty = b.top + b.height / 2;
    const size = Math.max(14, cr.width * 0.55);

    const puff = (n) => {
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span');
        s.className = 'bs-puff';
        const d = size * (0.4 + Math.random() * 0.55);
        s.style.width = s.style.height = `${d.toFixed(1)}px`;
        s.style.left = `${(mx - host.left + Math.sin(rad) * size * 0.35).toFixed(1)}px`;
        s.style.top = `${(my - host.top - Math.cos(rad) * size * 0.35).toFixed(1)}px`;
        s.style.setProperty('--bs-px', `${((Math.random() - 0.5) * size * 1.9 + Math.sin(rad) * size).toFixed(1)}px`);
        s.style.setProperty('--bs-py', `${((Math.random() - 0.5) * size * 1.9 - Math.cos(rad) * size).toFixed(1)}px`);
        s.style.animationDelay = `${(i * 28)}ms`;
        fx.appendChild(s);
        s.addEventListener('animationend', () => s.remove());
      }
    };

    const ball = document.createElement('span');
    ball.className = 'bs-ball';
    ball.style.width = ball.style.height = `${size.toFixed(1)}px`;
    ball.style.boxShadow = `0 0 0 ${(size * 0.1).toFixed(1)}px #0A0B0D, 0 ${(size * 0.14).toFixed(1)}px ${(size * 0.2).toFixed(1)}px rgba(0, 0, 0, .4)`;
    ball.style.left = `${(mx - host.left).toFixed(1)}px`;
    ball.style.top = `${(my - host.top).toFixed(1)}px`;
    fx.appendChild(ball);
    puff(7);
    const dx = tx - mx, dy = ty - my;
    if (typeof ball.animate !== 'function') { ball.remove(); return; }
    const at = (f, s) => ({ transform: `translate(calc(-50% + ${(dx * f).toFixed(1)}px), calc(-50% + ${(dy * f).toFixed(1)}px)) scale(${s})` });
    // Constant speed (linear, with the keyframes evenly spaced along the path) -- a ball that
    // accelerates or brakes mid-air reads as a glitch rather than as a shot. The SCALE is what
    // sells the arc: in a top-down view "up" is "bigger", so it swells out of the muzzle, rides
    // large across the middle, and shrinks as it drops onto the cell.
    const anim = ball.animate(
      [
        { ...at(0, 0.55), opacity: 0.3, offset: 0 },
        { ...at(0.10, 1.18), opacity: 1, offset: 0.10 },
        { ...at(0.50, 1.36), opacity: 1, offset: 0.50 },
        { ...at(0.88, 1.06), opacity: 1, offset: 0.88 },
        { ...at(1, 0.78), opacity: 1, offset: 1 },
      ],
      { duration: FLY_MS, easing: 'linear', fill: 'forwards' },
    );
    anim.onfinish = () => ball.remove();
    anim.oncancel = () => ball.remove();
  }

  /** One absolutely-positioned sprite per ship, sized/positioned from --bs-cell. The inner element
   *  is always drawn at its natural horizontal size and rotated in place for vertical ships -- the
   *  SVG markup from ship-art.js is never redrawn for orientation (HANDOFF-BATTLESHIP-POLISH.md
   *  section 3). `sinking` plays the one-shot list-and-slide reveal; gate it on `_lastShot` the same
   *  way `_cellHtml` gates the peg entrance animation, so it plays once, not on every re-render. */
  _shipSpriteHtml(ship, { ghost = false, sinking = false, faint = false, draggable = false } = {}) {
    const vertical = ship.dir === 'v';
    const span = (n) => `calc(var(--bs-cell) * ${n} - var(--bs-gap))`;
    const wrapStyle = `left:calc(var(--bs-pad) + var(--bs-cell) * ${ship.c}); top:calc(var(--bs-pad) + var(--bs-cell) * ${ship.r}); `
      + `width:${span(vertical ? 1 : ship.len)}; height:${span(vertical ? ship.len : 1)};`;
    const innerStyle = `position:absolute; top:50%; left:50%; width:${span(ship.len)}; height:${span(1)}; `
      + `transform:translate(-50%,-50%)${vertical ? ' rotate(90deg)' : ''};`;
    const cls = ['bs-ship-sprite', ghost ? 'is-ghost' : '', faint ? 'is-faint' : '',
      sinking ? 'is-sinking' : '', draggable ? 'is-draggable' : ''].filter(Boolean).join(' ');
    const hook = draggable ? ` data-role="board-ship" data-ship="${ship.id}"` : '';
    return `<div class="${cls}" style="${wrapStyle}"${hook} aria-hidden="true"><div style="${innerStyle}">${shipArtHtml(ship.id, ship.len)}</div></div>`;
  }

  _shipSpritesHtml(fleet, opts) {
    if (!fleet) return '';
    return fleet.ships.map((s) => this._shipSpriteHtml(s, opts && opts(s))).join('');
  }

  _cellHtml(size, r, c, opts) {
    const { shots, interactive, isTarget, occupied } = opts;
    const v = cellAt(shots, r, c);
    const isLast = this._lastShot && this._lastShot.seat === opts.seat && this._lastShot.r === r && this._lastShot.c === c;
    const classes = ['bs-cell'];
    if (occupied && occupied.has(`${r},${c}`)) classes.push('bs-cell-ship');
    const aimed = isTarget && this._aimCell && this._aimCell.r === r && this._aimCell.c === c;
    if (aimed) classes.push('bs-cell-aimed');
    let inner = '';
    // Miss = a burst of white bubbles spreading and fading on the water, settling to a hollow ring.
    // Hit  = an impact flash and a filled marker. The two SHAPES differ, never just the color.
    // `is-late` holds the whole impact back by --bs-fly, the cannonball's time in the air, so the
    // splash happens when the ball ARRIVES. It also switches the settled marker's entrance
    // animation on: without it the marker re-drops on every one of the many re-renders a cell
    // outlives, which read as the board twitching.
    const peg = `bs-peg${isLast ? ' is-late' : ''}`;
    if (v === CELL_MISS) {
      const bubbles = isLast ? [...Array(7)].map((_, i) => {
        const ang = (i / 7) * Math.PI * 2 + 0.5;
        return `<span class="bs-bubble" style="--bs-dx:${(Math.cos(ang) * 15).toFixed(1)}px;--bs-dy:${(Math.sin(ang) * 15 - 4).toFixed(1)}px;animation-delay:calc(var(--bs-fly) + ${(i * 34)}ms)"></span>`;
      }).join('') : '';
      inner = `<span class="${peg}">${isLast ? `${bubbles}<span class="bs-splash-ring"></span>` : ''}<span class="bs-peg-miss"></span></span>`;
    } else if (v === CELL_HIT || v === CELL_SUNK) {
      if (v === CELL_SUNK) classes.push('bs-cell-sunk');
      inner = `<span class="${peg}">${isLast ? '<span class="bs-flash"></span><span class="bs-smoke"></span>' : ''}<span class="bs-peg-hit"></span></span>`;
    }
    const label = v === CELL_MISS ? t('cell_miss') : v === CELL_HIT ? t('cell_hit') : v === CELL_SUNK ? t('cell_sunk') : t('cell_unknown');
    const isFree = v === 0;
    const canFire = isTarget && interactive && isFree;
    // data-r/data-c on BOTH boards' cells, not just the clickable ones: the cannon-aim maths and
    // the cannonball's landing point both look a cell up by coordinate, and the bot shoots at
    // cells on your board, which are plain divs.
    const el = isTarget
      ? `<button type="button" class="${classes.join(' ')}" data-action="fire" data-r="${r}" data-c="${c}" ${canFire ? '' : 'disabled'}
          aria-label="${esc(t('shot_cell_aria', { r: r + 1, c: c + 1, state: label }))}">${inner}</button>`
      : `<div class="${classes.join(' ')}" data-r="${r}" data-c="${c}" aria-hidden="true">${inner}</div>`;
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
    // Same reason as the deploy board's tint: a hull sprite drawn over a grid never lines up with
    // the gridlines, so on your own board you cannot tell which squares your fleet is actually on.
    // Fill the cells in. (The enemy board gets none -- that is the whole game.)
    const occupied = new Set();
    if (!isEnemy) {
      const fleet = this.mp ? this.mp.myFleet : s.fleets[localSeat];
      for (const ship of (fleet && fleet.ships) || []) {
        for (let i = 0; i < ship.len; i++) {
          occupied.add(`${ship.dir === 'v' ? ship.r + i : ship.r},${ship.dir === 'h' ? ship.c + i : ship.c}`);
        }
      }
    }
    const cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        cells.push(this._cellHtml(size, r, c, { shots, interactive, isTarget: isEnemy, seat, occupied }));
      }
    }
    // YOUR OWN ships stay visible on your board as faint ghosted silhouettes, so incoming fire can
    // be seen landing on them. The enemy board only ever shows a ship once it is sunk.
    const sprites = isEnemy
      ? this._enemySpritesHtml(seat)
      : this._shipSpritesHtml(this.mp ? this.mp.myFleet : s.fleets[localSeat], (ship) => ({
        sinking: this._shouldPlaySink(ship, seat),
        faint: !(s.shots[seat] && s.shots[seat].sunkIds.includes(ship.id)),
      }));
    const shake = this._lastShot && this._lastShot.seat === seat && (this._lastShot.result === 'hit') ? 'bs-shake' : '';
    // The cannon standing on THIS board belongs to this board's owner and shoots at the other one
    // (`_resolveCannons`). The reticle is the opposite way round: it marks the cell being shot AT,
    // so it belongs to the board under fire.
    const mine = !isEnemy;
    const c = this._cannons && this._cannons[mine ? 'mine' : 'theirs'];
    const cannon = c ? this._cannonHtml(mine ? 'mine' : 'theirs', c) : '';
    let reticle = '';
    const shooter = this._cannons && (this._cannons.mine ? 'mine' : this._cannons.theirs ? 'theirs' : null);
    const at = this._aimBySide[isEnemy ? 'mine' : 'theirs'];
    if (at && shooter === (isEnemy ? 'mine' : 'theirs')) {
      const pending = isEnemy && this.mp && this.mp.pendingShot;
      reticle = this._reticleHtml(at.r, at.c, { fading: !pending });
    }
    return `<div class="bs-board bs-board-${isEnemy ? 'enemy' : 'own'} ${isEnemy ? 'bs-target' : ''} ${active ? 'is-active-turn' : ''} ${shake}"
        style="grid-template-columns:repeat(${size},1fr)" data-role="${kind}-board">
      ${cells.join('')}
      ${sprites}
      ${reticle}
      ${cannon}
    </div>`;
  }

  renderBattle() {
    if (this._dead || !this.state) return;
    const id = this._identity();
    const s = this.state;
    const isMyTurn = this._isMyTurn();
    const series = this.mp ? `<p class="bs-mp-series">${esc(this._seriesLine())}</p>` : '';
    const sb = this._sunkBanner;
    const banner = sb
      ? `<div class="bs-sunk-banner bs-res-${sb.kind} ${sb.mine ? 'is-mine' : 'is-theirs'} ${sb.shipTheirs ? 'ship-theirs' : 'ship-mine'}"
           role="status" aria-label="${esc(sb.label)}" style="--bs-fly-in:${reducedMotion() ? 0 : FLY_MS}ms">
          ${sb.html ? `<span class="bs-sunk-banner-art" style="width:${sb.len * 22}px">${sb.html}</span>` : ''}
          <span class="bs-res-word">${esc(sb.word)}</span>
        </div>`
      : '';
    // THE VERTICAL SANDWICH, and the whole visual identity of the game: enemy waters (navy) on
    // top, the roster strip in the middle, your own board (wood on a salmon deck) below. Both are
    // always visible and NEITHER ever resizes -- whose turn it is shows only via .is-active-turn
    // (box-shadow/opacity, compositor-safe) and the status line.
    const theirSunk = s.shots[this._remoteSeat()].sunkIds.length;
    const mySunk = s.shots[this._localSeat()].sunkIds.length;
    // Both fleets ride in the strip between the boards, and the one currently being SHOT AT is the
    // one drawn in full colour -- the other sinks back into the deck. Same read as the boards'
    // own wash: at a glance, the bright half of the screen is the half being fought over.
    this._shellMode('battle');
    // FLY_MS is the single source of truth for the shot's timing; the stylesheet's own --bs-fly is
    // only a fallback, so push the real value in rather than letting the two drift apart. Under
    // reduced motion it MUST be zero here, not just in the stylesheet's reduced-motion block: an
    // inline custom property beats any rule, so leaving 850ms in would hold every impact back by
    // most of a second with no ball in the air to explain the wait.
    this.root.style.setProperty('--bs-fly', reducedMotion() ? '0ms' : `${FLY_MS}ms`);
    this._cannons = this._resolveCannons();
    // The BRIGHT half of the screen is the half being shot at, and the dim half is the one doing
    // the shooting -- which is not the same thing as "whose turn is it". While your own shell is
    // still in the air the turn has already passed to the bot, and washing your target board out
    // underneath your own shot was exactly backwards. The cannon that is up tells us who is
    // shooting; the live board is the other one.
    const shooting = this._cannons.mine ? 'mine' : this._cannons.theirs ? 'theirs' : (isMyTurn ? 'mine' : 'theirs');
    // At game end nobody is shooting and both fleets are revealed, so both boards come up bright:
    // dimming the losing half would hide the reveal that is the whole point of the last frame.
    const enemyLive = s.over || shooting === 'mine';
    const ownLive = s.over || shooting === 'theirs';
    const theirsLive = enemyLive;
    this.shell.innerHTML = `
      <div class="bs-battle">
        ${this._turnBarHtml()}
        ${series}
        <div class="bs-boardpanel bs-boardpanel-enemy ${enemyLive ? 'is-live' : ''}">
          <div class="bs-board-wrap">${this._boardHtml('enemy', enemyLive)}</div>
        </div>
        <div class="bs-strip">
          <div class="bs-scoredisc" role="img" aria-label="${esc(t('score_aria', { them: theirSunk, me: mySunk }))}">
            <span class="bs-scoredisc-n bs-scoredisc-them">${theirSunk}</span>
            <span class="bs-scoredisc-dot" aria-hidden="true"></span>
            <span class="bs-scoredisc-n bs-scoredisc-me">${mySunk}</span>
          </div>
          <div class="bs-rosterrows">
            <div class="bs-rosterrow bs-rosterrow-theirs ${theirsLive ? '' : 'is-dim'}">${this._rosterItems(s.shots[this._remoteSeat()].sunkIds)}</div>
            <div class="bs-rosterrow bs-rosterrow-mine ${theirsLive ? 'is-dim' : ''}">${this._rosterItems(s.shots[this._localSeat()].sunkIds)}</div>
          </div>
          <button type="button" class="bs-exitdisc" data-action="${this.mp ? 'mp-leave' : 'change-settings'}"
            aria-label="${esc(t('exit'))}" title="${esc(t('exit'))}">${ICON_CLOSE}</button>
        </div>
        <div class="bs-boardpanel bs-boardpanel-own ${ownLive ? 'is-live' : ''}">
          <div class="bs-board-wrap">${this._boardHtml('own', ownLive)}</div>
        </div>
        <div class="bs-fx" data-role="fx" aria-hidden="true"></div>
        ${banner}
        <div class="bs-actions">
          <button type="button" class="bs-iconbtn bs-iconbtn-sm" data-action="help" aria-label="${esc(t('howto'))}" title="${esc(t('howto'))}">${ICON_HELP}</button>
          ${this._aimCell && this._isMyTurn() && !this.busy && !s.over
            ? `<button type="button" class="bs-firebtn" data-action="fire-confirm">${ICON_TARGET}${esc(t('fire'))}</button>`
            : `<span class="bs-shotcount" role="img" aria-label="${esc(t('shots_fired', { n: s.shotCount[this._localSeat()] | 0 }))}">${ICON_TARGET}${s.shotCount[this._localSeat()] | 0}</span>`}
          ${this.mp
            ? ''
            : `<button type="button" class="bs-iconbtn bs-iconbtn-sm" data-role="restart" data-action="restart" aria-label="${esc(t('restart_game'))}" title="${esc(t('restart_game'))}">${ICON_RESTART}</button>`}
        </div>
      </div>`;
    this._fitBattleBoards();
    this._updateCellSize();
    this._aimCannons();
    if (this._fxPending) {
      const shot = this._fxPending;
      this._fxPending = null;
      this._playShotFx(shot);
    }
  }

  /** The battle screen is full-bleed (the reference's whole identity is two edge-to-edge boards
   *  sandwiching the roster strip), so it drops the shell's own gutter and takes the deck colour
   *  for the page. Every other screen keeps the ordinary padded card. */
  _shellMode(mode) {
    if (!this.shell || !this.root) return;
    const battling = mode === 'battle';
    this.shell.classList.toggle('bs-shell-battle', battling);
    this.root.classList.toggle('bs-battling', battling);
    if (!battling) {
      for (const k of ['marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom']) {
        this.root.style[k] = '';
      }
    }
  }

  _seriesLine() {
    const mp = this.mp;
    if (!mp) return '';
    const id = this._identity();
    return t('mp_series', { me: mp.series.wins[this._localSeat()] | 0, them: mp.series.wins[this._remoteSeat()] | 0, opp: id.oppName });
  }

  /** Restart is a two-tap control. It used to swap its own LABEL to "Tap again to confirm"; the
   *  button is a bare icon now, so arming it turns the disc red and pulses it instead, and the
   *  accessible name changes with it. Swapping textContent on an icon button would have thrown the
   *  SVG away and never got it back. */
  confirmDestructive(btn, action) {
    if (!this.state || this.state.over) { action(); return; }
    if (btn.dataset.armed === '1') { this.resetConfirms(); action(); return; }
    this.resetConfirms();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.getAttribute('aria-label') || '';
    btn.setAttribute('aria-label', t('tap_again_confirm'));
    btn.setAttribute('title', t('tap_again_confirm'));
    btn.classList.add('is-confirm');
    this._confirmTimer = setTimeout(() => this.resetConfirms(), 3500);
  }

  resetConfirms() {
    clearTimeout(this._confirmTimer);
    if (!this.shell) return;
    const b = this.shell.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.setAttribute('aria-label', b.dataset.label);
      b.setAttribute('title', b.dataset.label);
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
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
    this._maybeShowSunkBanner(answer, mySeat);
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
      this._maybeShowSunkBanner(answer, defenderSeat);
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
      // The rejected entry is consumed, never applied, so anything this device was waiting on it
      // for is over. Leaving `pendingShot` set left the host holding a shot whose answer it had
      // just thrown away, i.e. waiting on something that could not arrive -- the same shape as the
      // deadlock _mpStateSeq documents, reached from the other side.
      mp.pendingShot = null;
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
  /** THE HIGHEST SEQ THIS DEVICE'S PUBLIC STATE ACTUALLY REFLECTS -- which is not `appliedSeq`.
   *
   *  A shooter RESERVES its seq synchronously in `_mpFireAt`, before anything about the state has
   *  changed: only the defender's answer changes it. So a device with a shot in the air has
   *  `appliedSeq` one AHEAD of the last entry baked into `state`.
   *
   *  That gap deadlocked the match. A recovery snapshot published while the host had a shot in the
   *  air said "I am at seq N" and carried a state that did not include seq N; the guest adopted
   *  N, skipped the host's shot entirely -- never running the `k:'s'` branch, so never resolving it
   *  against its own fleet and never publishing an answer -- and the host waited for that answer
   *  forever. Neither side errored, neither side was busy-looping, and both boards simply stopped.
   *  On real phones the window is every bit as wide as the round trip, so a single resync could end
   *  the match. Reproduced 4 runs in 6 by `test-mp-lockstep.mjs`'s BS2, which had been carrying it
   *  as a documented "intermittent timeout" in this game's own CLAUDE.md. */
  _mpStateSeq() {
    const mp = this.mp;
    if (!mp) return 0;
    return mp.pendingShot ? Math.max(0, (mp.appliedSeq | 0) - 1) : (mp.appliedSeq | 0);
  }

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
    // The state just jumped, so "which shot is the next answer allowed to answer" cannot be
    // whatever this device happened to be holding before the jump -- that stale pair would reject
    // a perfectly good answer and bounce straight back into another recovery. Re-derive it from
    // the log: if the last entry the recovered state reflects IS a shot, that is the one an
    // incoming answer must match; otherwise there is no shot outstanding at all.
    mp.lastShotSeat = null; mp.lastShotRC = null;
    const at = mp.movesById && mp.movesById.get(mp.appliedSeq);
    if (at && at.move && at.move.k === 's') {
      mp.lastShotSeat = at.move.seat | 0;
      mp.lastShotRC = [at.move.r | 0, at.move.c | 0];
    }
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
    // A real room record arrived, so the restore watchdog above has nothing left to catch.
    if (mp.restoreProbe) {
      mp.restoreProbe = false;
      if (this._mpRestoreTimer) { clearTimeout(this._mpRestoreTimer); this._mpRestoreTimer = null; }
    }
    mp.lastRoomSnapshot = room;
    const other = mp.role === 'host' ? room.guest : room.host;
    const oppWasUnknown = !mp.opp;
    if (other && other.deviceId) mp.opp = other;
    // The "waiting for {opp}" screen is rendered ONCE, from whatever this device knew at the time.
    // On a restore (and for a host whose guest joins a beat later) that is nothing at all, and the
    // screen then sat there naming the wrong person for the rest of the match. Repaint it the
    // moment the room tells us who is actually there.
    if (oppWasUnknown && mp.opp && this.view === 'placement' && mp.localReady) this.renderPlacement();

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
        try { await net.writeRecovery(mp.code, this._mpStateSeq(), this._mpSnapshot()); } catch { /* the requester retries */ }
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

  /** Firebase's RTDB reads and writes DO NOT REJECT when the device cannot reach the server -- they
   *  simply never settle. So `await net.createRoom(...)` on a phone with no usable signal leaves
   *  "Creating room..." spinning for as long as the player is willing to stare at it, with no
   *  error, no retry and nothing to tap. Every one of this game's lobby round trips is bounded
   *  here instead: after MP_NET_TIMEOUT_MS the player gets the ordinary offline error and their
   *  buttons back. A late reply is harmless -- the room is simply abandoned to the TTL, exactly as
   *  it would be if the app were closed at that moment. */
  _withNetTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve({ error: 'offline' }), MP_NET_TIMEOUT_MS)),
    ]);
  }

  async _mpHostCreate() {
    if (this._mpBusy) return;
    this._mpBusy = true; this._mpError = '';
    this._lobby = 'host';
    this.renderSetup();
    const config = { sizeKey: this._setup.size, bonusShotOnHit: this._setup.bonusShotOnHit };
    const res = await this._withNetTimeout(net.createRoom('battleship', config, this._myIdentity()));
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
    const res = await this._withNetTimeout(net.joinRoom(code, this._myIdentity()));
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
        const res = await this._withNetTimeout(net.joinRoom(code, this._myIdentity()));
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
    // A ROOM THAT NEVER ANSWERS MUST NOT STRAND THE PLAYER. The restore above proves Firebase is
    // reachable, not that this room is still alive: a room that ended, or aged past its TTL and
    // was reclaimed, reads back as null, and `_mpOnRoomUpdate` returns early on a null room -- so
    // the device sat on "waiting for the opponent" forever, with no opponent and no way out. This
    // watchdog gives the subscription one bounded chance to deliver a live room and otherwise
    // hands the player back their setup screen with the save cleared.
    mp.restoreProbe = true;
    this._mpRestoreTimer = setTimeout(() => {
      this._mpRestoreTimer = null;
      if (this._dead || !this.mp || !this.mp.restoreProbe) return;
      this._mpClearSave();
      this.mp = null;
      net.disconnect();
      this.renderSetup();
    }, MP_NET_TIMEOUT_MS);
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

  /** The three marks a player will actually see on the board, drawn rather than described. This
   *  replaced the line "Miss = ripple. Hit = flash. Sunk = the whole ship reveals." -- which was
   *  also wrong by then: a miss has been a CROSS scored into the water since the 2026-08 redesign,
   *  not a ripple. A picture of the real marker cannot drift out of date the way that sentence
   *  did. Each mark keeps its word as an accessible name. */
  _helpMarkerKey() {
    const cell = (cls, key, inner) =>
      `<span class="bs-key-cell ${cls}" role="img" aria-label="${esc(t(key))}">${inner}</span>`;
    return `<div class="bs-help-key">
      ${cell('bs-key-water', 'cell_miss', '<span class="bs-peg" aria-hidden="true"><span class="bs-peg-miss"></span></span>')}
      ${cell('bs-key-water', 'cell_hit', '<span class="bs-peg" aria-hidden="true"><span class="bs-peg-hit"></span></span>')}
      ${cell('bs-key-sunk', 'cell_sunk', `<span class="bs-key-ship" aria-hidden="true">${shipArtHtml('destroyer', 2)}</span>`)}
    </div>`;
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
          ${this._helpMarkerKey()}
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
    // The difficulty slider is DISPLAY ONLY: it picks one of the three canonical stored values
    // (beginner/intermediate/pro), which js/difficulty-tiers.js and js/game-stats-ui.js's
    // DIFF_META both key on. Only the labels are Easy/Medium/Hard.
    const slider = e.target.closest('[data-role="diff-slider"]');
    if (slider) {
      const i = Math.max(0, Math.min(DIFFICULTIES.length - 1, Number(slider.value) | 0));
      const next = DIFFICULTIES[i][0];
      if (next !== this._setup.difficulty) { this._setup.difficulty = next; this._saveSetup(); this.renderSetup(); }
      return;
    }
    const el = e.target.closest('[data-role="mp-code-input"]');
    if (!el) return;
    const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (el.value !== clean) el.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  /** The WHOLE ship is the drag handle, on the board and in the tray alike. Nothing is layered on
   *  top of it any more -- the tray's rotate buttons and the board's corner arrows both used to
   *  sit right where a thumb naturally lands, and `onPointerDown` bailed out on them, so a drag
   *  started there silently did nothing. */
  onPointerDown(e) {
    if (this.view !== 'placement') return;
    // A ship already ON the board is picked straight off it: drag to move, or release without
    // moving to rotate it in place (see onPointerUp). `origin` is what a no-move release goes
    // back to, so a tap can never lose the ship.
    const sprite = e.target.closest('[data-role="board-ship"]');
    if (sprite) {
      const shipId = sprite.dataset.ship;
      const ship = this._placeFleet.ships.find((s) => s.id === shipId);
      const origin = ship ? { r: ship.r, c: ship.c, dir: ship.dir } : null;
      // WHICH CELL OF THE SHIP DID THE FINGER LAND ON. Everything about how the drag FEELS hangs
      // on this one number -- see _cellAtPoint's caller in onPointerMove.
      const grab = ship ? this._grabIndexOnBoard(sprite, ship, e.clientX, e.clientY) : 0;
      this._selectShip(shipId);
      this._dragging = { shipId, pointerId: e.pointerId, origin, grab, x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    const chip = e.target.closest('[data-role="ship-chip"]');
    if (chip) {
      const shipId = chip.dataset.ship;
      // `wasSelected` is what makes a second tap on the same tray chip a ROTATE, mirroring the
      // gesture a placed ship already answered to. Read BEFORE _selectShip, which sets it.
      const wasSelected = this._placeSelected === shipId;
      const def = this._placeShipSet.find((d) => d.id === shipId);
      // Same idea from the tray: grabbing the middle of the chip should put the MIDDLE of the ship
      // under your finger, not its bow.
      const cb = chip.getBoundingClientRect();
      const frac = cb.width ? (e.clientX - cb.left) / cb.width : 0.5;
      const grab = def ? Math.max(0, Math.min(def.len - 1, Math.floor(frac * def.len))) : 0;
      this._selectShip(shipId);
      this._dragging = { shipId, pointerId: e.pointerId, origin: null, grab, wasSelected, x: e.clientX, y: e.clientY, moved: false };
      try { chip.setPointerCapture(e.pointerId); } catch { /* not all browsers need this */ }
    }
  }

  /** Which cell along a PLACED ship the pointer went down on, 0 = stern. Measured off the sprite's
   *  own rendered box so it works for either orientation without knowing the cell size. */
  _grabIndexOnBoard(sprite, ship, clientX, clientY) {
    const r = sprite.getBoundingClientRect();
    const along = ship.dir === 'h'
      ? (r.width ? (clientX - r.left) / r.width : 0)
      : (r.height ? (clientY - r.top) / r.height : 0);
    return Math.max(0, Math.min(ship.len - 1, Math.floor(along * ship.len)));
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

  /** THE SHIP STAYS UNDER YOUR FINGER. Matt, 2026-08-11: "when you drag a boat, it shoots somewhere
   *  else. It's not a natural drag, it's all weird fucked up." It was: the preview cell was used as
   *  the ship's BOW-END ANCHOR, so a five-long carrier grabbed anywhere along its body jumped four
   *  cells away from the finger the moment it moved, and you had to aim at empty water to the left
   *  of where you wanted it. The cell under the finger is now the cell of the ship you actually
   *  grabbed (`d.grab`), and the anchor is derived back from it -- so the ship sits exactly where
   *  your thumb is, in both orientations, from the tray and from the board alike. */
  onPointerMove(e) {
    if (this.view !== 'placement' || !this._dragging) return;
    const d = this._dragging;
    if (!d.moved && (Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6)) d.moved = true;
    const under = this._cellAtPoint(e.clientX, e.clientY);
    if (!under) { if (this._placePreview) { this._placePreview = null; this.renderPlacement(); } return; }
    const cell = this._anchorFor(d.shipId, under, d.grab | 0);
    if (this._placePreview && this._placePreview.r === cell.r && this._placePreview.c === cell.c) return;
    this._placePreview = cell;
    this.renderPlacement();
  }

  /** The ship's anchor (its stern cell, what _tryPlaceAt takes) given the cell the FINGER is over
   *  and which cell of the ship that is. Kept on the board: a ship half off the edge would be
   *  illegal for a reason the player never asked for, so the anchor slides back into range and the
   *  ship simply stops travelling once its far end reaches the edge -- the way a physical piece
   *  behaves against the side of a board. */
  _anchorFor(shipId, under, grab) {
    const def = this._placeShipSet.find((x) => x.id === shipId);
    if (!def) return under;
    const dir = this._placeDir[shipId] || 'h';
    const size = boardSizeFor(this._placeSizeKey);
    const max = Math.max(0, size - def.len);
    if (dir === 'h') return { r: under.r, c: Math.max(0, Math.min(max, under.c - grab)) };
    return { r: Math.max(0, Math.min(max, under.r - grab)), c: under.c };
  }

  onPointerUp() {
    if (this.view !== 'placement' || !this._dragging) return;
    const { shipId, origin, moved, wasSelected } = this._dragging;
    this._dragging = null;
    if (this._placePreview && (moved || !origin)) {
      const { r, c } = this._placePreview;
      this._placePreview = null;
      this._tryPlaceAt(shipId, r, c);
      return;
    }
    this._placePreview = null;
    // A second tap on an already-selected TRAY chip rotates it, the same gesture a placed ship
    // answers to below. This is what replaced the per-chip rotate button.
    if (!origin && !moved && wasSelected) { this._rotateShip(shipId); return; }
    if (origin) {
      // A tap (no drag) on a placed ship rotates it in place. It was lifted off the board by
      // onPointerDown's _selectShip, so put it back either way -- rotated if that fits, exactly
      // as it was if it does not.
      const flipped = origin.dir === 'h' ? 'v' : 'h';
      this._placeDir[shipId] = this._placementLegalAt(shipId, origin.r, origin.c, flipped) ? flipped : origin.dir;
      this._justRotatedShip = shipId;
      this._tryPlaceAt(shipId, origin.r, origin.c);
      return;
    }
    this.renderPlacement();
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
    if (action === 'cycle-size') {
      // Every Options chip CYCLES through the same values the old accordion offered, and writes
      // the same settings key -- the vocabulary in storage is untouched (THE LAW rule 5).
      const i = SIZES.findIndex(([v]) => v === this._setup.size);
      this._setup.size = SIZES[(i + 1) % SIZES.length][0]; this._saveSetup(); this.renderSetup();
    } else if (action === 'cycle-first') {
      const order = ['you', 'opponent', 'alternate'];
      this._setup.firstMode = order[(order.indexOf(this._setup.firstMode) + 1) % order.length];
      this._saveSetup(); this.renderSetup();
    } else if (action === 'cycle-bonus') {
      this._setup.bonusShotOnHit = !this._setup.bonusShotOnHit; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-mode') {
      this._mode = btn.dataset.v; this._setupExpanded = null; this._mpError = ''; this.renderSetup();
    } else if (action === 'play-bot') {
      this._mode = 'solo'; this.startGame();
    } else if (action === 'play-friend') {
      this._mode = 'host'; this._mpError = ''; this.renderSetup();
    } else if (action === 'mode-solo') {
      this._mode = 'solo'; this._mpError = ''; this._mpJoinCode = ''; this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'select-ship') {
      this._selectShip(btn.dataset.ship);
    } else if (action === 'exit-placement') {
      this.renderSetup();
    } else if (action === 'skip-botplace') {
      this._skipBotPlacing();
    } else if (action === 'auto-place') {
      this._autoPlaceAll();
    } else if (action === 'clear-fleet') {
      this._clearPlacement();
    } else if (action === 'placement-ready') {
      this._placementReady();
    } else if (action === 'fire') {
      // TAP TO AIM, THEN CONFIRM. Matt, 2026-08-11: "It's not clear if you've shot or not. There's
      // no 'fire' or confirm." One tap used to fire immediately, so a mis-tap was a wasted turn and
      // nothing on screen ever said "this is the square you are about to shoot at." The first tap
      // parks the crosshair and raises the FIRE button; tapping the same square again, or FIRE,
      // shoots. Tapping a different square just moves the aim.
      const r = Number(btn.dataset.r), c = Number(btn.dataset.c);
      if (this._aimCell && this._aimCell.r === r && this._aimCell.c === c) { this._confirmFire(); return; }
      this._aimCell = { r, c };
      this.renderBattle();
    } else if (action === 'fire-confirm') {
      this._confirmFire();
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
