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
//
// CHALLENGES, turn by turn (2026-10-27): a third way to play a person, beside Host and Join. The
// match lives in Firebase (mp.js: both fleets and a log of shots), every phone replays it, and a hit
// shoots again. The `_ch*` methods below are the whole of it; the live-room `_mp*` code is untouched.

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
import { recordBattleship, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { makeT, myName } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onViewportResize } from '../../js/viewport.js';
// The real screen height. NOT visualViewport.height: iOS 26 can leave it at about half the screen
// (WebKit bug 297779), and Matt's battle screen shrank to the top 60% with tiny boards (2026-10-28).
import { trueBottom } from '../../js/tabbar-fix.js';
import { shipArtHtml } from './ship-art.js';
import * as net from '../../js/net.js';
import { onlineGate, onlineGateText } from '../../js/online-gate.js';
import { enableCodeCopy } from '../../js/mp-code-copy.js';
import { createReactions } from '../../js/mp-reactions-ui.js';
import STRINGS from './strings.js';
import * as LL from '../../js/live-leave.js';
import * as CH from './mp.js';
import { takeOpen } from './alert.js';

const t = makeT(STRINGS);
// How long a cannonball spends in the air, in ms, and the ONE place it is set: `renderBattle`
// pushes it into CSS as `--bs-fly`, which is what holds the peg/splash at the target back so the
// splash happens when the ball ARRIVES, and `_shotSettleMs` adds it to the window a shot owns
// before the next re-render. Change it here and the whole sequence follows.
//
// It was 340ms and Matt could not see the ball move at all -- across a whole phone screen that is
// a blink. At 850ms the shot is something you actually watch cross the water.
const FLY_MS = 850;
// A volley's balls leave the barrel this far apart (a salvo challenge fires up to five at once), and
// the first one leaves LAUNCH_MS after the shot is taken: the time the barrel needs to swing onto
// its new target. Every impact is timed off these (`_lateMs`).
const STAGGER_MS = 150;
const LAUNCH_MS = 260;
const RETICLE_SVG = `<svg class="bs-reticle-svg" viewBox="0 0 44 44" focusable="false">
  <circle class="bs-reticle-ring" cx="22" cy="22" r="11"/>
  <line class="bs-reticle-cross" x1="22" y1="2" x2="22" y2="42"/>
  <line class="bs-reticle-cross" x1="2" y1="22" x2="42" y2="22"/>
</svg>`;
const SETTINGS_KEY = 'gamehub.battleship.v1';
const SAVE_KEY = 'gamehub.battleship.save.v1';
const MP_SAVE_KEY = 'gamehub.battleship.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const STATS_ID = 'battleship';
// How long any lobby round trip (create room / join room / restore) may take before this game
// gives up and shows the offline error. See _withNetTimeout for why this has to exist at all.
const MP_NET_TIMEOUT_MS = 12 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
const MP_DIFFICULTY = 'mp';
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };
const SHIP_LABEL_KEY = { carrier: 'ship_carrier', battleship: 'ship_battleship', cruiser: 'ship_cruiser', submarine: 'ship_submarine', destroyer: 'ship_destroyer' };

// Inline glyphs for the two big mode buttons and the two deploy pills. Drawn here rather than in
// ship-art.js: that file is the SHIP silhouette builder and nothing else.
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

// Shots a turn for a challenge. Kept HERE as well as in mp.js on purpose (2026-10-27): mid-update a
// phone can serve this file new and mp.js from the previous build, and ui.js used to call
// mp.js's asShots while it was being built, so the whole game failed to open (Ana's iPhone).
const CH_SHOTS = [1, 3, 5];
const chShotsOf = (v) => (CH_SHOTS.includes(Number(v)) ? Number(v) : null);
const ICON_FLAG = `<svg class="bs-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/></svg>`;
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
    if (ui.mp || ui.ch) return;   // a challenge lives in Firebase (mp.js), never in the solo save
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
    this._codeCopyOff = enableCodeCopy(this.container);   // tap the room code to copy it
    this._reactions = createReactions({             // quick-chat reactions during MP
      send: (p) => { if (this.mp && this.mp.code) net.sendReaction(this.mp.code, String(this.mp.role), p); },
      mySeatKey: () => (this.mp ? String(this.mp.role) : null),
    });
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
    this._lastShot = null;     // { seat, r, c, result, sunk, cells }: the last shot of `_volley`
    this._volley = [];         // the latest volley: the shots that land together (see _setVolley)
    this._volleyKey = 0;       // bumped per volley; `_fxPlayed` holds the one already thrown
    this._fxPlayed = 0;
    this._fxTimers = [];       // the volley's own timers (balls, recoil, shake); see _clearFx
    this._sunkBanner = '';
    this._aims = [];        // the squares aimed at, awaiting FIRE (more than one in a salvo challenge)
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
    this._cannonDeg = {};         // where each gun was last left pointing, so it never swings round from north
    this._aimBySide = { mine: null, theirs: null }; // where each cannon is left pointing
    this._botAiming = false;      // the bot has the gun up and is choosing a cell
    this._fxPending = null;       // a shot whose cannonball still has to be thrown this render
    this._cannons = { mine: null, theirs: null };
    this._aimTimer = null;
    this._armed = null;           // 'restart' | 'exit-battle' | 'mp-leave' awaiting its confirming tap
    this._endTimer = null;        // holds the end card back until the last shot has landed

    this.mp = null;

    // Challenges (the `_ch*` methods). `ch` is the open match's link, null off the battle screen.
    this.ch = null;
    this._chRows = null;       // your matches (mp.js readMyGames), null while loading
    this._chNote = '';         // one line on the list: why we came back to it
    this._chPick = null;       // the pick-a-person view: { opps|null, q }
    this._chChoose = null;     // the board + shots step after picking: { them, size, shots }
    this._chPlace = null;      // what the deploy screen is placing for: { kind:'new', them, size } | { kind:'fleet', id, size }
    this._chQueue = [];        // the other person's shots still to show
    this._chTimer = null;      // holds the next queued shot back until this one has landed
    this._chGen = 0;           // bumped by every list read and open, so a late one is dropped
    this._chPushOff = false;   // notifications are off on this phone: the list offers to turn them on
    this._chListStop = null;   // the list's live watch (mp.js watchMyGames), only while it is up
    this._chSaving = false;

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
    this._chStopList();
    this._chClose();
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    if (this._mpDelayTimer) { clearTimeout(this._mpDelayTimer); this._mpDelayTimer = null; }
    if (this._bannerTimer) { clearTimeout(this._bannerTimer); this._bannerTimer = null; }
    if (this._botPlaceTimer) { clearTimeout(this._botPlaceTimer); this._botPlaceTimer = null; }
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    for (const id of this._fxTimers || []) clearTimeout(id);
    this._fxTimers = [];
    if (this._mpRestoreTimer) { clearTimeout(this._mpRestoreTimer); this._mpRestoreTimer = null; }
    // Same reasoning as every other MP game: destroy() runs for any hub teardown (including just
    // navigating back), so a live room is preserved for the 30-minute rejoin window. A hosted room
    // that never reached a game is released, since nobody depends on it.
    if (!this.mp && this._lobby === 'host' && this._mpPendingCode) {
      net.leaveRoom(this._mpPendingCode, 'host').catch(() => { /* best-effort */ });
    }
    try { net.disconnect(); } catch { /* never let teardown throw */ }
    if (this.mp) LL.detachLeave(STATS_ID);   // the match stays armed: closing is not leaving
    LL.hideClaim(this.root);
    this.mp = null;
    if (this._codeCopyOff) { this._codeCopyOff(); this._codeCopyOff = null; }
    if (this._reactions) { this._reactions.destroy(); this._reactions = null; }
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
      chShots: chShotsOf(saved.chShots) || 3,   // shots a turn for a NEW challenge (2026-10-27)
      soloShots: chShotsOf(saved.soloShots) || 3,   // a volley vs the bot (salvos, 2026-10-27)
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { v: 1, size: s.size, difficulty: s.difficulty, bonusShotOnHit: s.bonusShotOnHit, firstMode: s.firstMode, nextStarter: s.nextStarter, chShots: s.chShots, soloShots: s.soloShots });
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
    if (this.ch || (this._chPlace && this._chPlace.them)) {
      const them = this.ch ? this.ch.them : this._chPlace.them;
      return {
        humanName: (profile && profile.name) || t('you'),
        humanEmoji: (profile && profile.emoji) || '🙂',
        oppName: (them && them.name) || t('mp_opponent_label'),
        oppEmoji: (them && them.emoji) || '🙂',
      };
    }
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

  // --- seats -------------------------------------------------------------------------------------
  // Seats are SYMMETRIC here (both sides have a fleet and shoot): host = seat 0, guest = seat 1,
  // fixed for the whole room. In solo the local human is always seat 0 and the AI is seat 1.
  _localSeat() { return this.mp ? this.mp.localSeat : this.ch ? this.ch.seat : 0; }
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
    this._offViewport = onViewportResize(() => { this._fitBattleBoards(); this._updateCellSize(); this._fitScene(); });
    // A challenge handed over by the hub (a tapped notification, the launcher bubble, the
    // Multiplayer screen) opens first. A live room or solo save is left exactly where it was.
    let armed = null;
    try { armed = takeOpen(); } catch { armed = null; }
    if (armed) { this._chTakeArmed(armed); return; }
    const mpSave = this._mpLoadSave();
    if (mpSave) {
      this.renderSetup();
      this._tryRestoreMP(mpSave);
      return;
    }
    LL.settleLeave(STATS_ID);   // a live game that died with its page, never rejoined: its armed loss
    const saved = loadGame();
    if (saved) this.resumeGame(saved); else this.renderSetup();
  }

  resumeGame(saved) {
    this._setup.difficulty = saved.difficulty;
    this._statsCommitted = false;
    this.state = saved.state;
    this.view = 'battle';
    this._aims = [];
    this._setVolley([]);
    this._sunkShips = {};
    this._sinkPlayed = new Set();
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

  /** A segmented control, the newer setup screens' way (Darts, Archery): a full-width track, the
   *  chosen item outlined. `opts` = [[value, label-html, aria?]]. */
  _seg(action, value, opts, aria = '') {
    return `<div class="bs-seg" role="group"${aria ? ` aria-label="${esc(aria)}"` : ''}>${opts.map(([v, lbl]) =>
      `<button type="button" class="bs-segbtn" data-action="${action}" data-v="${v}" aria-pressed="${String(v) === String(value)}"><span>${lbl}</span></button>`).join('')}</div>`;
  }

  /** The setup card's header: How to play (?) top-right, or Back top-left on a sub-card, then the title. */
  _cardTop(title, { back = '' } = {}) {
    return `${back ? `<button type="button" class="bs-cardbtn bs-cardbtn-l" data-action="${back}" aria-label="${esc(t('mp_back_btn'))}">‹</button>` : ''}
      <button type="button" class="bs-cardbtn bs-cardbtn-r" data-action="help" aria-label="${esc(t('howto'))}">?</button>
      <h1 class="bs-logo">${esc(title)}</h1>`;
  }

  /** Multiplayer: Host / Join / Challenge, the EXISTING lobby and challenge list (no second path). */
  _friendHTML() {
    if (this._lobby) return this._lobbyHTML();
    if (this._mode === 'ch' && this._chChoose) return this._chChooseHTML();
    if (this._mode === 'ch' && this._chPick) return this._chPickerHTML();
    const seg = this._seg('set-mode', this._mode, [['host', t('mode_host')], ['join', t('mode_join')], ['ch', t('mode_ch')]]);
    if (this._mode === 'join') return `${seg}${this._joinBodyHTML()}`;
    if (this._mode === 'ch') return `${seg}${this._chHTML()}`;
    const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : '');
    return `${seg}
      ${msg ? `<p class="bs-mp-msg">${esc(msg)}</p>` : ''}
      <button type="button" class="bs-go" data-action="mp-host" ${this._mpBusy ? 'disabled' : ''}>${t('mp_host_btn')}</button>`;
  }

  /** SCREEN 1, THE SETUP CARD (rebuilt 2026-10-27). Matt: "make it be more in line with other gamehub
   *  setup screens. This one doesn't have anything in common with the other, especially the newer,
   *  ones", and cut the words. So it is Darts' and Archery's card: centred over the game's own water,
   *  ? top-right, the title, **Multiplayer ›** first, then Easy/Medium/Hard (shape markers), the board,
   *  Shots (a volley vs the bot too: salvos) and First shot, and one Play button. The tagline, the
   *  bot avatar, the slider, the "Options" label, the cycling chips and the stats line are gone. The
   *  stored values are unchanged (`beginner`/`intermediate`/`pro`, `classic`/`quick`, THE LAW rule 5);
   *  the old Bonus shot chip is gone with the rule it set (a hit always shoots again in a salvo). */
  renderSetup() {
    this._shellMode('scene');
    if (this._dead) return;
    this.closeOverlays();
    if (this.view === 'battle' && this.state && !this.state.over && !this.mp && !this.ch) clearGame();
    this._chClose();
    this._chPlace = null;
    if (this._mode !== 'ch') this._chStopList();
    this.view = 'setup';
    this.state = null;
    this._botFleet = null;
    this._stopGameTimers();
    this._aims = [];
    const id = this._identity();
    const s = this._setup;

    if (this._lobby || this._mode === 'host' || this._mode === 'join' || this._mode === 'ch') {
      const back = this._lobby ? 'mp-cancel' : this._chChoose ? 'ch-choose-back' : this._chPick ? 'ch-pick-back' : 'mode-solo';
      this.shell.innerHTML = `<div class="bs-setup"><div class="bs-setcard bs-setcard-mp">
        ${this._cardTop(t('multiplayer'), { back })}
        ${this._friendHTML()}
      </div></div>`;
      this._fitScene();
      return;
    }

    const diffs = DIFFICULTIES.map(([v, k]) => [v, `${diffShapeSVG(tierOf(v))}${esc(t(k))}`]);
    const firstName = (n) => `<span class="bs-seg-name">${esc(n)}</span>`;
    this.shell.innerHTML = `<div class="bs-setup"><div class="bs-setcard">
      ${this._cardTop(t('title'))}
      <button type="button" class="bs-mprow" data-action="play-friend">
        <b>${esc(t('multiplayer'))}</b>
        <span class="bs-mprow-badge" data-role="mp-badge" hidden></span>
        <span class="bs-mprow-chev" aria-hidden="true">›</span>
      </button>
      ${this._seg('set-diff', s.difficulty, diffs, t('row_difficulty'))}
      <div class="bs-field">
        <span class="bs-label">${esc(t('grid_size'))}</span>
        ${this._seg('set-size', s.size, [['quick', '8×8'], ['classic', '10×10']])}
      </div>
      <div class="bs-field">
        <span class="bs-label">${esc(t('chip_ch_shots'))}</span>
        ${this._seg('set-shots', s.soloShots, CH_SHOTS.map((n) => [n, String(n)]))}
      </div>
      <div class="bs-field">
        <span class="bs-label">${esc(t('chip_first'))}</span>
        ${this._seg('set-first', s.firstMode, [['alternate', esc(t('first_alternate'))], ['you', esc(t('first_me'))], ['opponent', firstName(id.oppName)]])}
      </div>
      <button type="button" class="bs-go" data-action="play-bot">${esc(t('play'))}</button>
    </div></div>`;
    this._fitScene();
    this._paintMpBadge();
  }

  /** "N" on the Multiplayer row: challenges waiting on you (the index, one small read). */
  _paintMpBadge() {
    const gen = this._chGen;
    Promise.resolve().then(() => CH.readMyGames()).then((rows) => {
      if (this._dead || gen !== this._chGen || this.view !== 'setup') return;
      const n = (rows || []).filter((r) => !r.over && r.yourTurn).length;
      const el = this.shell && this.shell.querySelector('[data-role="mp-badge"]');
      if (!el) return;
      el.textContent = String(n);
      el.setAttribute('aria-label', t('ch_your_turn'));
      el.hidden = !n;
    }).catch(() => { /* no badge offline */ });
  }

  /** The setup card sits CENTRED on the game's own water, edge to edge (`_bleedToEdges`). The shell is
   *  stretched to the screen height minus whatever host chrome lies below it (measured as overflow,
   *  as `_fitBattleBoards` does), so the page never scrolls; a card taller than that starts at the top. */
  _fitScene() {
    if (this._dead || !this.shell || this.view !== 'setup') return;
    const vh = trueBottom();
    this.shell.style.minHeight = '';
    const top = this.shell.getBoundingClientRect().top;
    let h = Math.max(0, vh - Math.max(0, top));
    this.shell.style.minHeight = `${h}px`;
    const over = document.documentElement.scrollHeight - vh;
    if (over > 1) { h = Math.max(0, h - over); this.shell.style.minHeight = `${h}px`; }
    this._bleedToEdges();
  }

  // --- multiplayer lobby (Tic Tac Toe's shape) --------------------------------------------------

  _joinBodyHTML() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button type="button" class="bs-mp-msg bs-mp-msg-action" data-action="mp-update-required">${t('mp_update_required')}</button>`
      : `<p class="bs-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? t('mp_joining') : ''))}</p>`;
    return `<div class="bs-mp-lobby">
      <span class="bs-mp-label">${t('mp_enter_code')}</span>
      <input class="bs-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${t('mp_code_aria')}">
      ${msg}
      <button type="button" class="bs-go" data-action="mp-join-submit">${t('mp_join_btn')}</button>
    </div>`;
  }

  _lobbyHTML() {
    const back = '';
    if (this._lobby === 'host') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? t('mp_creating_room') : t('mp_share_code'));
      return `<div class="bs-mp-lobby">
        <span class="bs-mp-label">${t('mp_code_aria')}</span>
        <div class="bs-mp-code" data-role="mp-code" role="button" tabindex="0">${code ? esc(code) : '····'}</div>
        <span class="bs-mp-label">${t('mp_opponent_label')}</span>
        <div class="bs-mp-oppslot">${guest
          ? `<span>${esc(guest.avatar || '🙂')}</span><span>${esc(guest.name || '')}</span>`
          : `<span class="bs-mp-oppempty">${t('mp_waiting_opponent')}</span>`}</div>
        <p class="bs-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button type="button" class="bs-go" data-action="mp-start" ${guest ? '' : 'disabled'}>${t('mp_start_btn')}</button>
        ${back}
      </div>`;
    }
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    return `<div class="bs-mp-lobby">
      <span class="bs-mp-label">${t('mp_code_aria')}</span>
      <div class="bs-mp-code" data-role="mp-code" role="button" tabindex="0">${esc(this._mpJoinedCode || '')}</div>
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

  /** Stops every timer that belongs to the game on screen. A timer left running across a restart
   *  fires into the NEXT screen: the bot's two-beat shot timer used to land a second after Restart
   *  and repaint the old battle over the fresh deploy screen, then shoot at the old board. */
  _stopGameTimers() {
    for (const k of ['aiTimer', '_settleTimer', '_bannerTimer', '_botPlaceTimer', '_endTimer', '_chTimer']) {
      if (this[k]) { clearTimeout(this[k]); this[k] = null; }
    }
    this._sunkBanner = '';
    this._botAiming = false;
    this.busy = false;
    this._armed = null;
    this._clearFx();
  }

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
    this._recordSavedQuitLoss();   // a set-aside solo battle replaced by a new one (2026-10-29, second pass)
    const starter = this._resolveStarter();
    this._soloStarterSeat = starter === 'you' ? 0 : 1;
    this._chStopList();
    this._chClose();
    this._chPlace = null;
    clearGame();
    this._stopGameTimers();
    this.state = null;
    this._aims = [];
    this._statsCommitted = false;
    this._newPlacement(this._setup.size);
    this.view = 'placement';
    this.renderPlacement();
  }

  // --- placement screen --------------------------------------------------------------------------

  /** THE FLEET STARTS ON THE BOARD (2026-10-27). Matt: "Placing ships is weird and awkward." It
   *  started in a tray of thumbnail silhouettes, each to be dragged on one at a time. Now every ship
   *  is already placed at random: SAVE is there at once, a ship is dragged to move it and tapped to
   *  turn it, the dice deals a new layout and the bin empties the board into the tray. */
  _newPlacement(sizeKey) {
    this._placeSizeKey = sizeKey;
    this._placeShipSet = shipSetFor(sizeKey);
    const rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this._placeFleet = autoPlace(sizeKey, this._placeShipSet, rng) || emptyFleet(sizeKey);
    this._placeDir = {};
    const first = this._placeShipSet.find((d) => !this._placeFleet.ships.some((sh) => sh.id === d.id));
    this._placeSelected = first ? first.id : null;
    this._placePreview = null;
    this._placeInvalid = null;
    this._endDrag();
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
    else if (this._chPlace) this._chPlaced();
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
    // SALVOS vs the bot (2026-10-27): the volley size rides on the game, so a resumed save keeps it
    if (typeof CH.fireVolley === 'function') {
      s = { ...s, salvo: chShotsOf(this._setup.soloShots) || 3 };
      // one bonus shot per hit (2026-10-28), when this build's mp.js knows it
      if (Array.isArray(CH.SALVO_RULES) && CH.SALVO_RULES.includes(2)) s = { ...s, salvoRule: 2 };
      // a 5-shot game shrinks 5, 4, 3, then 2 (2026-10-28)
      if (s.salvo === 5 && CH.SALVO_RULES.includes(3)) s = { ...s, salvoRule: 3 };
    }
    s = setFleet(s, 0, this._placeFleet);
    s = setFleet(s, 1, this._botFleet);
    this._botFleet = null;
    this.state = s;
    this.view = 'battle';
    this._statsCommitted = false;
    this._aims = [];
    this._setVolley([]);
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
    const vh = trueBottom();
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
    const vh = trueBottom();
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
    // the ship in your hand is in neither place: not on the board and not in the tray
    const held = this._dragging && this._dragging.lifted ? this._dragging.shipId : null;

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
    const tray = trayDefs.filter((def) => def.id !== held).map((def) => {
      const label = t(SHIP_LABEL_KEY[def.id]);
      // Sized by FLEX, proportional to the ship's length, never a pixel width: five chips at a fixed
      // px-per-cell overflowed a 390px phone and the longest ship was silently clipped by the row's
      // own `overflow: hidden`. Flex-basis 0 with grow = len means the row always fits exactly,
      // whatever the board size or the screen, and the ships stay in correct relative proportion.
      return `<div class="bs-trayship ${this._placeSelected === def.id ? 'is-selected' : ''}"
          style="flex-grow:${def.len}" data-role="ship-chip" data-ship="${def.id}" role="button" tabindex="0"
          aria-label="${esc(label)}" title="${esc(label)}">
        <span class="bs-trayship-art">${shipArtHtml(def.id, def.len)}</span>
      </div>`;
    }).join('');

    // A tap that could not place the ship leaves its dashed ghost where it was refused, so the tap
    // visibly did SOMETHING. It used to be stored and never drawn: the tap simply did nothing.
    const inv = this._placeInvalid;
    const preview = this._placePreview
      || (inv && inv.shipId === this._placeSelected && inv.dir === (this._placeDir[inv.shipId] || 'h') ? inv : null);
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
    const placedSprites = this._placeFleet.ships.map((ship) => this._shipSpriteHtml(ship, { draggable: true })
      .replace('class="bs-ship-sprite', `class="bs-ship-sprite${justRotated === ship.id ? ' is-turned' : ''}`)).join('');
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
            ${remaining === 0 && !held
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

  // --- THE SHOT, ONCE (rebuilt 2026-10-27) ---------------------------------------------------------
  // Matt: "The animations are all weird and messed up." They were, for one reason underneath all of
  // it: renderBattle rebuilt the whole battle screen from a string on every state change, every
  // timer and every banner, so anything that animates on arrival (a splash, a peg, the reticle, the
  // cannon swinging to its target) played again on every rebuild, and the board washes snapped
  // instead of fading because their elements were new each time. The screen is now built ONCE per
  // battle and PATCHED: a cell, sprite, cannon or banner is only replaced when what it shows
  // changes, so an effect plays exactly once. The ball, its reticle, the recoil and the shake are
  // thrown imperatively by `_playVolleyFx` into the `.bs-fx` overlay, which no render touches.
  //
  // A VOLLEY is the shots that land together: one shot everywhere except a salvo challenge, where it
  // is up to five (mp.js, "SALVOS"). `_volley` is the latest one; `_lastShot` its last shot (the
  // live-room code reads that). Shot i leaves the barrel at LAUNCH_MS + i * STAGGER_MS and lands
  // FLY_MS later (`_lateMs`); every impact, the banner and the settle are timed off that.

  _setVolley(shots) {
    this._volley = (shots || []).filter(Boolean);
    this._lastShot = this._volley.length ? this._volley[this._volley.length - 1] : null;
    this._volleyKey = (this._volleyKey | 0) + 1;
  }

  /** Where (seat, r, c) sits in the latest volley, or -1. `seat` is the board shot at. */
  _volleyIdx(seat, r, c) {
    const v = this._volley || [];
    for (let i = 0; i < v.length; i++) if (v[i].seat === seat && v[i].r === r && v[i].c === c) return i;
    return -1;
  }

  /** When shot i of the volley lands, in ms from the render that showed it. */
  _lateMs(i) { return reducedMotion() ? 0 : LAUNCH_MS + FLY_MS + Math.max(0, i) * STAGGER_MS; }

  /** How long a just-rendered volley needs before the next beat (the bot's reply, the next queued
   *  challenge volley, the end card): the last ball's flight plus the impact and, for a sink, the
   *  reveal. Takes a volley (array) or one shot. Reduced motion only needs it to be legible. */
  _shotSettleMs(volley) {
    const v = Array.isArray(volley) ? volley : volley ? [volley] : [];
    if (!v.length) return 0;
    if (reducedMotion()) return 150;
    const hit = v.some((x) => x.result === 'hit'), sunk = v.some((x) => x.sunk);
    return this._lateMs(v.length - 1) + (hit ? 950 : 800) + (sunk ? 700 : 0);
  }

  /** Renders the just-applied volley, then holds `busy` (which gates aiming and FIRE) until it has
   *  played out. */
  _settleThenIdle() {
    this.busy = true;
    this.renderBattle();
    const ms = this._shotSettleMs(this._volley);
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
      this._sunkShips = {}; this._sinkPlayed = new Set();
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
    if (this.ch) {
      // A challenge: let the volley that just landed play out, then show the next of the other
      // person's volleys (if any are queued). Nothing here ever plays for them.
      this.busy = true;
      this.renderBattle();
      if (this._chTimer) clearTimeout(this._chTimer);
      this._chTimer = setTimeout(() => {
        this._chTimer = null;
        if (this._dead || !this.ch || !this.state) return;
        this.busy = false;
        this.renderBattle();
        this._chNext();
      }, Math.max(0, this._shotSettleMs(this._volley)));
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
      const settle = this._shotSettleMs(this._volley);
      const fire = () => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        const n = this._salvoN();
        if (n) {
          const local = this._localSeat();
          const cells = this._botVolley(CH.volleyLeft(this.state, this._remoteSeat(), n, this._salvoRuleN()));
          const res = CH.fireVolley(this.state, this._remoteSeat(), cells, n, this._salvoRuleN());
          if (!res.fired.length) return;
          this.state = res.state;
          this._setVolley(res.fired.map(([r, c], i) => ({ seat: local, r, c, result: res.answers[i].result, sunk: res.answers[i].sunk, cells: res.answers[i].cells })));
          this._showResultBanner(res.answers, local);
          this._afterStateChange();
          return;
        }
        const shipSet = this._shipSetForState();
        const shot = chooseShot(this.state, this._localSeat(), shipSet, this._setup.difficulty, Math.random);
        if (!shot) return;
        const res = fireAndResolve(this.state, this._localSeat(), shot[0], shot[1]);
        this.state = res.state;
        this._setVolley([{ seat: this._localSeat(), r: shot[0], c: shot[1], result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells }]);
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

  /** EVERY SHOT SAYS WHAT IT DID (Matt, 2026-08-11: "there's no 'hit' or 'miss'"). One banner per
   *  volley: SUNK with the ship(s) struck through if any sank, else HIT! (x2 for two), else MISS.
   *  It sits over the board that was SHOT AT (it used to sit over the enemy board whoever fired, so
   *  the bot's MISS covered the bot's own gun), and lands with the last ball. `seat` is the
   *  DEFENDER: the banner's colour is whose good news it is, a sunk ship is drawn in its OWNER's. */
  _showResultBanner(answers, seat) {
    const list = (answers || []).filter((a) => a && a.result);
    if (!list.length) return;
    for (const a of list) if (a.sunk && a.shipId) this._recordSunkShipGeometry(a);
    const iScored = seat != null && seat !== this._localSeat();
    const set = this._shipSetForState() || [];
    const sunk = list.filter((a) => a.sunk && a.shipId);
    const hits = list.filter((a) => a.result === 'hit').length;
    const base = { id: (this._bannerId = (this._bannerId | 0) + 1), mine: iScored, shipTheirs: iScored,
      board: seat === this._localSeat() ? 'own' : 'enemy', delay: this._lateMs(list.length - 1) };
    if (sunk.length) {
      const art = sunk.map((a) => {
        const def = set.find((d) => d.id === a.shipId);
        const len = def ? def.len : 3;
        return `<span class="bs-sunk-banner-art" style="width:${len * 22}px">${shipArtHtml(a.shipId, len)}</span>`;
      }).join('');
      this._sunkBanner = { ...base, kind: 'sunk', word: t('res_sunk'), html: art,
        label: sunk.map((a) => t('sunk_banner', { ship: t(SHIP_LABEL_KEY[a.shipId] || a.shipId) })).join(' ') };
    } else {
      const hit = hits > 0;
      const word = hit ? `${t('res_hit')}${hits > 1 ? ` ×${hits}` : ''}` : t('res_miss');
      this._sunkBanner = { ...base, kind: hit ? 'hit' : 'miss', word, html: '', label: word };
    }
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    // Down as the volley's settle ends (`_shotSettleMs`), never across into the next turn.
    const wait = reducedMotion() ? 900 : this._sunkBanner.delay + (hits ? 950 : 800) + (sunk.length ? 700 : 0) - 120;
    this._bannerTimer = setTimeout(() => { this._sunkBanner = ''; this._bannerTimer = null; if (!this._dead && this.view === 'battle') this.renderBattle(); }, wait);
  }

  /** One shot's banner (solo, the live rooms). */
  _maybeShowSunkBanner(answer, seat) { this._showResultBanner([answer], seat); }

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
    if (this.ch) { this._chFireAt(r, c); return; }
    const res = fireAndResolve(this.state, target, r, c);
    this.state = res.state;
    this._setVolley([{ seat: target, r, c, result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells }]);
    this._maybeShowSunkBanner(res.answer, target);
    this._afterStateChange();
  }

  /** Is this a SALVO challenge (pick N squares, fire them together)? Old challenges, the bot and the
   *  live rooms are one aim at a time. */
  _isSalvo() { return this._salvoN() > 0; }

  /** Squares a volley holds in a salvo game, 0 if it is not one: a challenge stored `salvo: true`, or
   *  a game vs the bot started with Shots (`state.salvo`, 2026-10-27). Never a live room. A bot game's
   *  save from an mp.js without volleys (mid-update) falls back to one shot a turn. */
  _salvoN() {
    if (this.ch) return this.ch.game && this.ch.game.salvo ? (chShotsOf(this.ch.game.shots) || 1) : 0;
    if (this.mp || !this.state || typeof CH.fireVolley !== 'function') return 0;
    return chShotsOf(this.state.salvo) || 0;
  }

  /** Which salvo rule this game plays (mp.js "ONE BONUS SHOT PER HIT"): 2 = a hit earns one more
   *  shot, 1 = any hit earns another full volley (the first day's challenges and bot saves). */
  _salvoRuleN() {
    const v = this.ch ? (this.ch.game && this.ch.game.salvo) : (this.state && this.state.salvoRule);
    return v === 3 ? 3 : v === 2 ? 2 : 1;
  }

  /** How many squares can be aimed at before FIRE: the volley owed in a salvo game, else one. */
  _aimCap() {
    const n = this._salvoN();
    if (!n || !this.state) return 1;
    return CH.volleyLeft(this.state, this._localSeat(), n, this._salvoRuleN());
  }

  /** A salvo vs the bot: every aimed square at once (mp.js fireVolley, the challenges' own rule). */
  _soloFireVolley(aims) {
    const target = this._remoteSeat();
    const res = CH.fireVolley(this.state, this._localSeat(), aims.map((a) => [a.r, a.c]), this._salvoN(), this._salvoRuleN());
    if (!res.fired.length) return;
    this.state = res.state;
    this._setVolley(res.fired.map(([r, c], i) => ({ seat: target, r, c, result: res.answers[i].result, sunk: res.answers[i].sunk, cells: res.answers[i].cells })));
    this._showResultBanner(res.answers, target);
    this._afterStateChange();
  }

  /** The bot's volley of `k` squares, chosen TOGETHER like a person's: each pick is made on a copy of
   *  your board where its earlier picks already count as fired (unknown result), so it never learns
   *  mid-volley what it hit. ai.js still never reads a fleet. */
  _botVolley(k) {
    const local = this._localSeat();
    const set = this._shipSetForState();
    let st = this.state;
    const out = [];
    for (let i = 0; i < k; i++) {
      const shot = chooseShot(st, local, set, this._setup.difficulty, Math.random);
      if (!shot) break;
      out.push(shot);
      const shots = st.shots.slice();
      const grid = { ...shots[local], cells: shots[local].cells.slice() };
      grid.cells[shot[0] * st.size + shot[1]] = CELL_MISS;
      shots[local] = grid;
      st = { ...st, shots };
    }
    return out;
  }

  /** A tap on an enemy square while it is your turn. One aim: tap to aim, tap it again (or FIRE) to
   *  shoot. A salvo: tap to add a square, tap an aimed one to take it back; with every square
   *  chosen, a new tap moves the last one. FIRE shows once the volley is full. */
  _aimAt(r, c) {
    if (this.busy || !this._isMyTurn() || !isShotLegal(this.state, this._remoteSeat(), r, c)) return;
    const cap = this._aimCap();
    const i = this._aims.findIndex((a) => a.r === r && a.c === c);
    if (cap <= 1) {
      if (i >= 0) { this._confirmFire(); return; }
      this._aims = [{ r, c }];
    } else if (i >= 0) {
      this._aims = this._aims.filter((_, k) => k !== i);
    } else if (this._aims.length < cap) {
      this._aims = this._aims.concat([{ r, c }]);
    } else {
      this._aims = this._aims.slice(0, cap - 1).concat([{ r, c }]);
    }
    this.renderBattle();
  }

  /** Shoot at whatever is aimed. The aims are cleared FIRST so FIRE cannot be double-fired while the
   *  volley is resolving. */
  _confirmFire() {
    const aims = this._aims;
    if (!aims.length || this.busy || !this._isMyTurn()) return;
    if (this._isSalvo()) {
      if (aims.length < this._aimCap()) return;
      this._aims = [];
      if (this.ch) this._chFireVolley(aims); else this._soloFireVolley(aims);
      return;
    }
    this._aims = [];
    this.fireAt(aims[0].r, aims[0].c);
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

  /** The battle screen's turn indicator: a full-width bar in the SHOOTER's colour carrying their
   *  name and a chevron at the board about to be hit (up = enemy waters, down = your deck). Matt,
   *  2026-08-11: "it's not clear whose turn it is." `_statusText()` still feeds the screen-reader
   *  live region inside it. MP failures stay WORDS, as a pill over the bar. Returns the bar's
   *  class, direction and inner markup: the bar itself is never rebuilt, so its colour FADES. */
  _turnBarParts() {
    const s = this.state, id = this._identity();
    const mine = this._cannons && this._cannons.mine;
    const theirs = this._cannons && this._cannons.theirs;
    // Who is SHOOTING, which is not the same as whose turn it is: while your own shell is still in
    // the air the turn has already passed. The cannon on screen is the authority.
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
    const who = s.over
      ? (s.winner === this._localSeat() ? id.humanName : id.oppName)
      : (shootingMine ? id.humanName : id.oppName);
    let pips = '';
    if (!s.over && (this.ch || this._isSalvo())) {
      if (this._isSalvo()) {
        // A salvo: one dot per square in the volley, filled as you aim them. Only on your turn.
        const cap = shootingMine && s.turn === this._localSeat() && !this.busy ? this._aimCap() : 0;
        const n = Math.min(cap, this._aims.length);
        if (cap > 1) pips = `<span class="bs-turn-shots" role="img" aria-label="${esc(t('shots_left', { n: cap - n }))}">${'●'.repeat(n)}${'○'.repeat(cap - n)}</span>`;
      } else {
        // An older challenge of 3 or 5 (a turn is that many misses): filled dots = misses left.
        const per = chShotsOf(this.ch.game.shots) || 1;
        const left = per > 1 ? (Number.isInteger(s.chLeft) ? s.chLeft : per) : 0;
        if (per > 1) pips = `<span class="bs-turn-shots" role="img" aria-label="${esc(t('shots_left', { n: left }))}">${'●'.repeat(left)}${'○'.repeat(per - left)}</span>`;
      }
    }
    return {
      cls: `bs-turnbar bs-turn-${shootingMine ? 'mine' : 'theirs'}`,
      dir,
      inner: `<span class="bs-turn-face" aria-hidden="true">${esc(face)}</span>
      <span class="bs-turn-name">${esc(who)}</span>
      ${chevron}${pips}${err}
      <p class="bs-sr" aria-live="polite">${esc(this._statusText())}</p>`,
    };
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

  /** THE CANNON, seen from directly above the way the reference draws it: a fat black ring base with
   *  the owner's colour banded inside, a stubby grey barrel, a black muzzle collar. Each side's gun
   *  stands on ITS OWN board and fires across at the other one. Three nested elements, and the
   *  nesting is load-bearing: .bs-cannon (positioned + drop shadow, only ever translated),
   *  .bs-cannon-aim (the rotation), .bs-cannon-rig (the recoil, thrown by `_playVolleyFx`). It is
   *  born pointing where that gun was last left (`_cannonDeg`), so a gun coming back up does not
   *  swing round from north. Its own namespace (.bs-cannon...), never a layout class. */
  _cannonHtml(side, { thinking = false } = {}) {
    const base = side === 'mine' ? 0 : 180;
    const deg = this._cannonDeg && Number.isFinite(this._cannonDeg[side]) ? this._cannonDeg[side] : base;
    return `<div class="bs-cannon bs-cannon-${side}" data-role="cannon-${side}" aria-hidden="true">
      <div class="bs-cannon-aim" style="--bs-aim:${deg.toFixed(1)}deg">
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

  /** The crosshair on a cell: a ring with a full cross straight through it, overhanging on all four
   *  sides. Drawn by the board only for a live room's shot still waiting for its answer; a flying
   *  ball's crosshair is thrown by `_playVolleyFx` and fades as the ball lands. */
  _reticleHtml(r, c) {
    const style = `left:calc(var(--bs-pad) + var(--bs-cell) * ${(c + 0.5).toFixed(2)}); `
      + `top:calc(var(--bs-pad) + var(--bs-cell) * ${(r + 0.5).toFixed(2)});`;
    return `<div class="bs-reticle" style="${style}" aria-hidden="true">${RETICLE_SVG}</div>`;
  }

  /** Decides, ONCE per render, which cannon is on screen and what it is doing. Returns
   *  `{ mine, theirs }`, at most one non-null. Exactly one cannon is up at any moment:
   *   - a volley that has not been thrown yet -> the SHOOTER's cannon, and `_fxPending` is armed so
   *     `_playVolleyFx` throws it once layout exists (gated on `_volleyKey`, so never twice);
   *   - a live room's shot waiting for its answer -> ours, aimed at it;
   *   - the bot choosing a cell -> theirs, wearing the "Bot thinking" pill;
   *   - still settling a volley -> the shooter's stays up while it plays out;
   *   - otherwise the cannon of whoever's turn it is, still pointing where it last fired (or, on
   *     your turn, at the squares you are aiming at). */
  _resolveCannons() {
    const out = { mine: null, theirs: null };
    const s = this.state;
    if (!s || s.over) return out;
    const local = this._localSeat();
    const v = this._volley || [];
    // `seat` on a shot is the DEFENDER, so the shooter is the other side.
    const shooterSide = v.length ? (v[0].seat === local ? 'theirs' : 'mine') : null;
    if (shooterSide) this._aimBySide[shooterSide] = v.map((x) => ({ r: x.r, c: x.c }));
    if (this.mp && this.mp.pendingShot) this._aimBySide.mine = [{ r: this.mp.pendingShot.r, c: this.mp.pendingShot.c }];
    let side = null, thinking = false;
    if (v.length && this._fxPlayed !== this._volleyKey) {
      this._fxPlayed = this._volleyKey;
      side = shooterSide;
      this._fxPending = v;
    } else if (this.mp && this.mp.pendingShot) {
      side = 'mine';
    } else if (this._botAiming) {
      side = 'theirs';
      thinking = true;
    } else if (this.busy && shooterSide) {
      side = shooterSide;
    } else {
      side = s.turn === local ? 'mine' : 'theirs';
      if (side === 'mine' && this._aims.length) this._aimBySide.mine = this._aims.slice();
    }
    if (side) out[side] = { thinking };
    return out;
  }

  /** The middle of the cells a gun is aimed at, in client px, or null. */
  _aimPoint(side) {
    const at = this._aimBySide[side];
    if (!at || !at.length) return null;
    const role = side === 'mine' ? 'enemy-board' : 'own-board';
    let x = 0, y = 0, n = 0;
    for (const a of at) {
      const cell = this.shell.querySelector(`[data-role="${role}"] .bs-cell[data-r="${a.r}"][data-c="${a.c}"]`);
      const b = cell && cell.getBoundingClientRect();
      if (!b || !b.width) continue;
      x += b.left + b.width / 2; y += b.top + b.height / 2; n++;
    }
    return n ? { x: x / n, y: y / n } : null;
  }

  /** Points every on-screen cannon at what it is shooting at, from real DOM geometry (the two boards
   *  are separate elements and nothing in CSS knows how far apart they ended up). Each gun has its
   *  own forward (yours north, theirs south: Matt, 2026-08-11, "the cannon isn't even facing the
   *  right direction"), and only the DEVIATION from it is clamped. The angle is remembered per side
   *  and only written when it changes, so the barrel swings once, to a new target, and never again. */
  _aimCannons() {
    if (this._dead || !this.shell) return;
    this._cannonDeg = this._cannonDeg || {};
    for (const cannon of this.shell.querySelectorAll('.bs-cannon')) {
      const aim = cannon.querySelector('.bs-cannon-aim');
      if (!aim) continue;
      const side = cannon.classList.contains('bs-cannon-mine') ? 'mine' : 'theirs';
      const base = side === 'mine' ? 0 : 180;
      const pt = this._aimPoint(side);
      const cr = cannon.getBoundingClientRect();
      let deg = Number.isFinite(this._cannonDeg[side]) ? this._cannonDeg[side] : base;
      if (pt && cr.width) {
        const px = cr.left + cr.width * 0.5, py = cr.top + cr.height * 0.5;
        const raw = Math.atan2(pt.x - px, -(pt.y - py)) * 180 / Math.PI;
        let delta = raw - base;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        deg = base + Math.max(-64, Math.min(64, delta));
      }
      if (aim._bsDeg !== deg.toFixed(1)) {
        aim._bsDeg = deg.toFixed(1);
        aim.style.setProperty('--bs-aim', `${deg.toFixed(1)}deg`);
      }
      this._cannonDeg[side] = deg;
    }
  }

  _fxLater(ms, fn) {
    const id = setTimeout(() => {
      this._fxTimers = (this._fxTimers || []).filter((x) => x !== id);
      if (!this._dead) fn();
    }, Math.max(0, ms));
    (this._fxTimers = this._fxTimers || []).push(id);
  }

  _clearFx() {
    for (const id of this._fxTimers || []) clearTimeout(id);
    this._fxTimers = [];
    const fx = this.shell && this.shell.querySelector('[data-role="fx"]');
    if (fx) fx.innerHTML = '';
  }

  /** THROWS A VOLLEY, once (`_resolveCannons` arms it). Crosshairs snap onto every target, the gun
   *  swings onto them (LAUNCH_MS), recoils, and the balls leave the muzzle STAGGER_MS apart and land
   *  FLY_MS later, on the beat each cell's own splash or flash is timed to (`_lateMs`). A hit shakes
   *  the board it lands on. All of it lives in `.bs-fx` or is a Web Animation on an element no render
   *  replaces, so nothing here can play twice. Decorative only: under reduced motion it does nothing
   *  and the volley still resolves. */
  _playVolleyFx(volley) {
    if (!volley || !volley.length || this._dead || reducedMotion()) return;
    const fx = this.shell && this.shell.querySelector('[data-role="fx"]');
    if (!fx) return;
    const local = this._localSeat();
    const iShot = volley[0].seat !== local;
    const side = iShot ? 'mine' : 'theirs';
    const role = iShot ? 'enemy-board' : 'own-board';
    const board = this.shell.querySelector(`[data-role="${role}"]`);
    const cellOf = (s) => this.shell.querySelector(`[data-role="${role}"] .bs-cell[data-r="${s.r}"][data-c="${s.c}"]`);
    const cannonEl = () => this.shell.querySelector(`.bs-cannon-${side}`);
    const host = () => fx.getBoundingClientRect();

    // the crosshairs: on at once, each fading as its ball lands
    volley.forEach((shot, i) => {
      const cell = cellOf(shot);
      const b = cell && cell.getBoundingClientRect();
      if (!b || !b.width) return;
      const h = host();
      const el = document.createElement('div');
      el.className = 'bs-reticle bs-reticle-fx';
      el.innerHTML = RETICLE_SVG;
      const d = b.width * 1.5;
      el.style.width = el.style.height = `${d.toFixed(1)}px`;
      el.style.left = `${(b.left - h.left + b.width / 2).toFixed(1)}px`;
      el.style.top = `${(b.top - h.top + b.height / 2).toFixed(1)}px`;
      fx.appendChild(el);
      if (typeof el.animate !== 'function') { el.remove(); return; }
      el.animate([{ transform: 'translate(-50%, -50%) scale(2.2)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }],
        { duration: 260, easing: 'ease-out', fill: 'forwards' });
      // gone as the ball arrives, so it never sits on top of the splash (it used to linger 400ms after)
      const off = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay: Math.max(0, this._lateMs(i) - 140), easing: 'ease-in', fill: 'forwards' });
      off.onfinish = () => el.remove();
    });

    // the recoil, as the first ball leaves
    this._fxLater(LAUNCH_MS, () => {
      const rig = cannonEl() && cannonEl().querySelector('.bs-cannon-rig');
      if (rig && typeof rig.animate === 'function') {
        rig.animate([
          { transform: 'translateY(0)' }, { transform: 'translateY(11%)', offset: 0.14 },
          { transform: 'translateY(-2.5%)', offset: 0.55 }, { transform: 'translateY(0)' },
        ], { duration: 400, easing: 'cubic-bezier(.2, .8, .3, 1)' });
      }
    });
    // the balls
    volley.forEach((shot, i) => {
      this._fxLater(LAUNCH_MS + i * STAGGER_MS, () => this._throwBall(fx, cannonEl(), cellOf(shot), side));
    });
    // THE IMPACT, above the board: the in-square splash and flash are clipped by their own square, so
    // on their own a hit or a miss barely registered (Matt, 2026-10-28: the animations after a shot
    // "were off ... regardless of whether or not you hit something"). A fire burst for a hit, a white
    // ring for a miss, each about two squares wide, as that ball lands.
    volley.forEach((shot, i) => {
      if (shot.sunk) return;   // a sink gets the whole ship's burst below
      this._fxLater(this._lateMs(i), () => {
        const b = cellOf(shot) && cellOf(shot).getBoundingClientRect();
        if (!b || !b.width) return;
        const h = host();
        const el = document.createElement('span');
        el.className = shot.result === 'hit' ? 'bs-boom' : 'bs-splashfx';
        el.style.width = el.style.height = `${(b.width * (shot.result === 'hit' ? 1.8 : 2.1)).toFixed(1)}px`;
        el.style.left = `${(b.left - h.left + b.width / 2).toFixed(1)}px`;
        el.style.top = `${(b.top - h.top + b.height / 2).toFixed(1)}px`;
        fx.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
      });
    });
    // A SINK GOES UP IN FLAMES, square by square from the one just hit (Matt, 2026-10-28: the sink "was
    // weird"; it used to just pop in). A burst on every square of the ship, 70ms apart, outward.
    volley.forEach((shot, i) => {
      if (!shot.sunk || !Array.isArray(shot.cells)) return;
      const order = shot.cells.slice().sort((a, b2) => (Math.abs(a[0] - shot.r) + Math.abs(a[1] - shot.c)) - (Math.abs(b2[0] - shot.r) + Math.abs(b2[1] - shot.c)));
      order.forEach(([r, c], k) => this._fxLater(this._lateMs(i) + 60 + k * 70, () => {
        const cell = this.shell.querySelector(`[data-role="${role}"] .bs-cell[data-r="${r}"][data-c="${c}"]`);
        const b = cell && cell.getBoundingClientRect();
        if (!b || !b.width) return;
        const h = host();
        const el = document.createElement('span');
        el.className = 'bs-boom';
        el.style.width = el.style.height = `${(b.width * 1.9).toFixed(1)}px`;
        el.style.left = `${(b.left - h.left + b.width / 2).toFixed(1)}px`;
        el.style.top = `${(b.top - h.top + b.height / 2).toFixed(1)}px`;
        fx.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
      }));
    });
    // a hit shakes the board it lands on, once, as the first hit lands
    const firstHit = volley.findIndex((x) => x.result === 'hit');
    if (firstHit >= 0 && board && typeof board.animate === 'function') {
      this._fxLater(this._lateMs(firstHit), () => board.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-3px)', offset: 0.1 }, { transform: 'translateX(3px)', offset: 0.3 },
        { transform: 'translateX(-2px)', offset: 0.5 }, { transform: 'translateX(2px)', offset: 0.7 }, { transform: 'translateX(0)' },
      ], { duration: 320, easing: 'ease-in-out' }));
    }
  }

  /** One cannonball: a black-rimmed iron sphere launched from the muzzle (wherever the barrel points)
   *  to the middle of `cell`, with a puff of white smoke left at the muzzle. Constant speed; the
   *  SCALE sells the arc (top-down, "up" is "bigger"). */
  _throwBall(fx, cannon, cell, side) {
    if (!fx || !cannon || !cell || this._dead) return;
    const host = fx.getBoundingClientRect();
    const cr = cannon.getBoundingClientRect();
    const b = cell.getBoundingClientRect();
    if (!cr.width || !b.width) return;
    const deg = (this._cannonDeg && Number.isFinite(this._cannonDeg[side])) ? this._cannonDeg[side] : (side === 'mine' ? 0 : 180);
    const rad = deg * Math.PI / 180;
    const px = cr.left + cr.width * 0.5, py = cr.top + cr.height * 0.5;
    const reach = cr.height * 0.36;   // pivot -> muzzle, matching the SVG's own geometry
    const mx = px + Math.sin(rad) * reach, my = py - Math.cos(rad) * reach;
    const tx = b.left + b.width / 2, ty = b.top + b.height / 2;
    const size = Math.max(12, Math.min(cr.width * 0.42, b.width * 1.05));

    for (let i = 0; i < 6; i++) {
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

    const ball = document.createElement('span');
    ball.className = 'bs-ball';
    ball.style.width = ball.style.height = `${size.toFixed(1)}px`;
    // the black iron rim is a px box-shadow spread: a percentage silently drops the declaration
    ball.style.boxShadow = `0 0 0 ${(size * 0.1).toFixed(1)}px #0A0B0D, 0 ${(size * 0.14).toFixed(1)}px ${(size * 0.2).toFixed(1)}px rgba(0, 0, 0, .4)`;
    ball.style.left = `${(mx - host.left).toFixed(1)}px`;
    ball.style.top = `${(my - host.top).toFixed(1)}px`;
    fx.appendChild(ball);
    if (typeof ball.animate !== 'function') { ball.remove(); return; }
    const dx = tx - mx, dy = ty - my;
    const at = (f, k) => ({ transform: `translate(calc(-50% + ${(dx * f).toFixed(1)}px), calc(-50% + ${(dy * f).toFixed(1)}px)) scale(${k})` });
    const anim = ball.animate(
      [
        { ...at(0, 0.55), opacity: 0.3, offset: 0 },
        { ...at(0.10, 1.12), opacity: 1, offset: 0.10 },
        { ...at(0.50, 1.3), opacity: 1, offset: 0.50 },
        { ...at(0.88, 1.0), opacity: 1, offset: 0.88 },
        { ...at(1, 0.7), opacity: 0, offset: 1 },
      ],
      { duration: FLY_MS, easing: 'linear', fill: 'forwards' },
    );
    anim.onfinish = () => ball.remove();
    anim.oncancel = () => ball.remove();
  }

  /** One absolutely-positioned sprite per ship, sized/positioned from --bs-cell. The inner element
   *  is always drawn at its natural horizontal size and rotated in place for vertical ships. The art
   *  FILLS the ship's own squares exactly (`fill`): it used to keep its aspect ratio, so it sat a
   *  little short and off-centre of the squares it was on. */
  _shipSpriteHtml(ship, { ghost = false, sinking = false, sunk = false, faint = false, draggable = false, sinkDelay = 0 } = {}) {
    const vertical = ship.dir === 'v';
    const span = (n) => `calc(var(--bs-cell) * ${n} - var(--bs-gap))`;
    const wrapStyle = `left:calc(var(--bs-pad) + var(--bs-cell) * ${ship.c}); top:calc(var(--bs-pad) + var(--bs-cell) * ${ship.r}); `
      + `width:${span(vertical ? 1 : ship.len)}; height:${span(vertical ? ship.len : 1)};`;
    const innerStyle = `position:absolute; top:50%; left:50%; width:${span(ship.len)}; height:${span(1)}; `
      + `transform:translate(-50%,-50%)${vertical ? ' rotate(90deg)' : ''};`;
    const cls = ['bs-ship-sprite', ghost ? 'is-ghost' : '', faint ? 'is-faint' : '', sunk ? 'is-sunk' : '',
      sinking ? 'is-sinking' : '', draggable ? 'is-draggable' : ''].filter(Boolean).join(' ');
    const hook = draggable ? ` data-role="board-ship" data-ship="${ship.id}"` : '';
    const delay = sinking && sinkDelay ? ` --bs-sink-delay:${sinkDelay}ms;` : '';
    return `<div class="${cls}" style="${wrapStyle}${delay}"${hook} aria-hidden="true"><div class="bs-ship-inner" style="${innerStyle}">${shipArtHtml(ship.id, ship.len, { fill: true })}</div></div>`;
  }

  _shipSpritesHtml(fleet, opts) {
    if (!fleet) return '';
    return fleet.ships.map((s) => this._shipSpriteHtml(s, opts && opts(s))).join('');
  }

  /** One cell of a battle board. A cell in the latest volley is `is-late`: its splash (miss) or
   *  flash (hit) is held back until its own ball lands (`--bs-fly`, per cell). Nothing in the
   *  markup depends on whose turn it is or on `busy`, so a cell's string only changes when the cell
   *  itself does, and the patcher leaves it (and its animation) alone otherwise. */
  _cellHtml(r, c, { shots, isTarget, seat, occupied }) {
    const v = cellAt(shots, r, c);
    const vi = this._volleyIdx(seat, r, c);
    const late = vi >= 0;
    const classes = ['bs-cell'];
    if (occupied && occupied.has(`${r},${c}`)) classes.push('bs-cell-ship');
    if (isTarget && this._aims.some((a) => a.r === r && a.c === c)) classes.push('bs-cell-aimed');
    let inner = '', style = '';
    const peg = `class="bs-peg${late ? ' is-late' : ''}"${late ? ` style="--bs-fly:${this._lateMs(vi)}ms"` : ''}`;
    if (v === CELL_MISS) {
      const bubbles = late ? [...Array(7)].map((_, i) => {
        const ang = (i / 7) * Math.PI * 2 + 0.5;
        return `<span class="bs-bubble" style="--bs-dx:${(Math.cos(ang) * 15).toFixed(1)}px;--bs-dy:${(Math.sin(ang) * 15 - 4).toFixed(1)}px;animation-delay:calc(var(--bs-fly) + ${(i * 34)}ms)"></span>`;
      }).join('') : '';
      inner = `<span ${peg}>${late ? `${bubbles}<span class="bs-splash-ring"></span>` : ''}<span class="bs-peg-miss"></span></span>`;
    } else if (v === CELL_HIT || v === CELL_SUNK) {
      // A ship sunk by THIS volley darkens as the ball that sank it lands, never before: it used to
      // turn black the moment FIRE was pressed and give the result away while the ball was in the air.
      const sinkAt = v === CELL_SUNK && !reducedMotion() ? this._sinkingAt(seat, r, c) : -1;
      if (v === CELL_SUNK) classes.push(sinkAt >= 0 ? 'bs-cell-sinking' : 'bs-cell-sunk');
      if (sinkAt >= 0) style = ` style="--bs-sink-at:${sinkAt}ms"`;
      inner = `<span ${peg}>${late ? '<span class="bs-flash"></span><span class="bs-smoke"></span>' : ''}<span class="bs-peg-hit"></span></span>`;
    }
    const label = v === CELL_MISS ? t('cell_miss') : v === CELL_HIT ? t('cell_hit') : v === CELL_SUNK ? t('cell_sunk') : t('cell_unknown');
    // data-r/data-c on BOTH boards' cells: the cannon's aim and the ball's landing point look a cell
    // up by coordinate. Only a square already fired at is disabled; the rest are refused in code
    // while it is not your turn (a `disabled` that flipped every turn rebuilt all 100 cells).
    return isTarget
      ? `<button type="button" class="${classes.join(' ')}"${style} data-action="fire" data-r="${r}" data-c="${c}" ${v === 0 ? '' : 'disabled'}
          aria-label="${esc(t('shot_cell_aria', { r: r + 1, c: c + 1, state: label }))}">${inner}</button>`
      : `<div class="${classes.join(' ')}"${style} data-r="${r}" data-c="${c}" aria-hidden="true">${inner}</div>`;
  }

  /** When the shot that sank the ship on (seat, r, c) lands, if a shot in the latest volley sank it
   *  (ms from the render, `_lateMs`), else -1. */
  _sinkingAt(seat, r, c) {
    const v = this._volley || [];
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (x.sunk && x.seat === seat && Array.isArray(x.cells) && x.cells.some(([cr, cc]) => cr === r && cc === c)) return this._lateMs(i);
    }
    return -1;
  }

  /** Is `ship` (a real fleet ship, or a reconstructed {r,c,dir,len}) sunk by the latest volley? */
  _shipHoldsLastShot(ship, seat) {
    const v = (this._volley || []).filter((x) => x.sunk && x.seat === seat);
    if (!v.length) return false;
    const cells = Array.isArray(ship.cells) ? ship.cells
      : [...Array(ship.len)].map((_, i) => [ship.dir === 'v' ? ship.r + i : ship.r, ship.dir === 'h' ? ship.c + i : ship.c]);
    return v.some((x) => cells.some(([r, c]) => r === x.r && c === x.c));
  }

  /** The sink reveal plays once per ship, ever (`_sinkPlayed`), however many renders follow. */
  _shouldPlaySink(ship, seat) {
    if (!this._shipHoldsLastShot(ship, seat)) return false;
    const key = `${seat}:${ship.id}`;
    if (this._sinkPlayed.has(key)) return false;
    this._sinkPlayed.add(key);
    return true;
  }

  /** The sprites one board shows, keyed by ship. The enemy board: every ship once the match is over
   *  where this phone knows both fleets (solo, challenges), otherwise only ships seen sunk (rebuilt
   *  from public cells, `_recordSunkShipGeometry`). Your own board: your fleet, faint until sunk. A
   *  sprite's `sig` leaves out `is-sinking`, so the next render does not cut the reveal short. */
  _spriteItems(isEnemy, seat) {
    const s = this.state;
    // A ship sunk by this volley surfaces as the ball that sank it lands.
    const sinkAt = (ship) => {
      const cells = Array.isArray(ship.cells) ? ship.cells
        : [...Array(ship.len)].map((_, i) => [ship.dir === 'v' ? ship.r + i : ship.r, ship.dir === 'h' ? ship.c + i : ship.c]);
      const i = (this._volley || []).findIndex((x) => x.sunk && x.seat === seat && cells.some(([r, c]) => r === x.r && c === x.c));
      return i >= 0 ? this._lateMs(i) : 0;
    };
    const item = (ship, opts) => {
      const html = this._shipSpriteHtml(ship, opts.sinking ? { ...opts, sinkDelay: sinkAt(ship) } : opts);
      return { key: ship.id, html, sig: opts.sinking ? this._shipSpriteHtml(ship, { ...opts, sinking: false }) : html };
    };
    if (isEnemy) {
      if (!this.mp && s.over) {
        const sunkIds = new Set(s.shots[seat].sunkIds);
        return (s.fleets[seat] ? s.fleets[seat].ships : []).map((ship) => item(ship, { sunk: sunkIds.has(ship.id), sinking: sunkIds.has(ship.id) && this._shouldPlaySink(ship, seat) }));
      }
      const known = (this._sunkShips && this._sunkShips[seat]) || {};
      return Object.values(known).map((ship) => item(ship, { sunk: true, sinking: this._shouldPlaySink(ship, seat) }));
    }
    const fleet = this.mp ? this.mp.myFleet : s.fleets[seat];
    const sunkIds = new Set((s.shots[seat] && s.shots[seat].sunkIds) || []);
    return ((fleet && fleet.ships) || []).map((ship) => item(ship, {
      sunk: sunkIds.has(ship.id), faint: !sunkIds.has(ship.id), sinking: this._shouldPlaySink(ship, seat),
    }));
  }

  /** The battle screen's frame, built ONCE per battle (and again only if the board size or the kind
   *  of match changes). Everything that changes is filled in by `_patchBattle`. */
  _battleSkeletonHtml(size) {
    const blank = new Array(size * size).fill('<div class="bs-cell"></div>').join('');
    const board = (kind) => `<div class="bs-board bs-board-${kind} ${kind === 'enemy' ? 'bs-target' : ''}"
        style="grid-template-columns:repeat(${size},1fr)" data-role="${kind}-board">${blank}<div class="bs-layer" data-layer="sprites"></div><div class="bs-layer" data-layer="reticle"></div><div class="bs-layer" data-layer="cannon"></div></div>`;
    const panel = (kind) => `<div class="bs-boardpanel bs-boardpanel-${kind}" data-panel="${kind}">
        <div class="bs-board-wrap">${board(kind)}<div class="bs-banner-slot" data-slot="banner-${kind}"></div></div>
      </div>`;
    return `<div class="bs-battle" data-sig="${size}|${this.mp ? 1 : 0}">
      <div class="bs-turnbar" data-slot="bar"></div>
      ${this.mp ? '<p class="bs-mp-series" data-slot="series"></p>' : ''}
      ${panel('enemy')}
      <div class="bs-strip">
        <div class="bs-scoredisc" role="img" data-slot="score"></div>
        <div class="bs-rosterrows">
          <div class="bs-rosterrow bs-rosterrow-theirs" data-slot="roster-theirs"></div>
          <div class="bs-rosterrow bs-rosterrow-mine" data-slot="roster-mine"></div>
        </div>
        <span class="bs-slot" data-slot="exit"></span>
      </div>
      ${panel('own')}
      <div class="bs-fx" data-role="fx" aria-hidden="true"></div>
      <div class="bs-actions" data-slot="actions"></div>
    </div>`;
  }

  /** innerHTML, only when it changed. */
  _patchHtml(el, html) {
    if (!el || el._bsH === html) return;
    el.innerHTML = html;
    el._bsH = html;
  }

  _parseOne(html) {
    const tpl = this._tpl || (this._tpl = document.createElement('template'));
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  /** Replaces only the cells whose markup changed. */
  _patchCells(board, htmls) {
    if (!board._bsCells) {
      board._bsCells = [...board.children].filter((el) => el.classList.contains('bs-cell'));
      board._bsCellH = [];
    }
    for (let i = 0; i < htmls.length; i++) {
      if (board._bsCellH[i] === htmls[i] || !board._bsCells[i]) continue;
      const el = this._parseOne(htmls[i]);
      board._bsCells[i].replaceWith(el);
      board._bsCells[i] = el;
      board._bsCellH[i] = htmls[i];
    }
  }

  /** Keyed children: kept while their `sig` holds, replaced when it changes, removed when gone. */
  _patchKeyed(layer, items) {
    if (!layer) return;
    const have = new Map();
    for (const ch of [...layer.children]) have.set(ch.dataset.key, ch);
    const keep = new Set();
    for (const it of items) {
      const ex = have.get(it.key);
      if (ex && ex._bsSig === it.sig) { keep.add(ex); continue; }
      const el = this._parseOne(it.html);
      el.dataset.key = it.key;
      el._bsSig = it.sig;
      if (ex) ex.replaceWith(el); else layer.appendChild(el);
      keep.add(el);
    }
    for (const ch of [...layer.children]) if (!keep.has(ch)) ch.remove();
  }

  _patchBoard(kind, live) {
    const s = this.state;
    const isEnemy = kind === 'enemy';
    const seat = isEnemy ? this._remoteSeat() : this._localSeat();
    const panel = this.shell.querySelector(`[data-panel="${kind}"]`);
    const board = panel && panel.querySelector('.bs-board');
    if (!board) return;
    panel.classList.toggle('is-live', live);
    board.classList.toggle('is-active-turn', live);
    board.classList.toggle('is-locked', !(isEnemy && this._isMyTurn() && !this.busy));
    // Your own board's ship squares are filled in (a hull never lines up with the gridlines).
    const occupied = new Set();
    if (!isEnemy) {
      const fleet = this.mp ? this.mp.myFleet : s.fleets[seat];
      for (const ship of (fleet && fleet.ships) || []) {
        for (let i = 0; i < ship.len; i++) occupied.add(`${ship.dir === 'v' ? ship.r + i : ship.r},${ship.dir === 'h' ? ship.c + i : ship.c}`);
      }
    }
    const cells = [];
    for (let r = 0; r < s.size; r++) {
      for (let c = 0; c < s.size; c++) cells.push(this._cellHtml(r, c, { shots: s.shots[seat], isTarget: isEnemy, seat, occupied }));
    }
    this._patchCells(board, cells);
    this._patchKeyed(board.querySelector('[data-layer="sprites"]'), this._spriteItems(isEnemy, seat));
    const pending = isEnemy && this.mp && this.mp.pendingShot;
    this._patchHtml(board.querySelector('[data-layer="reticle"]'), pending ? this._reticleHtml(pending.r, pending.c) : '');
    const side = isEnemy ? 'theirs' : 'mine';
    const cn = this._cannons && this._cannons[side];
    this._patchKeyed(board.querySelector('[data-layer="cannon"]'),
      cn ? [{ key: side, sig: `${side}|${cn.thinking ? 1 : 0}`, html: this._cannonHtml(side, cn) }] : []);
    const sb = this._sunkBanner;
    const slot = panel.querySelector('[data-slot^="banner"]');
    this._patchHtml(slot, sb && sb.board === kind
      ? `<div class="bs-sunk-banner bs-res-${sb.kind} ${sb.mine ? 'is-mine' : 'is-theirs'} ${sb.shipTheirs ? 'ship-theirs' : 'ship-mine'}" data-banner="${sb.id}"
           role="status" aria-label="${esc(sb.label)}" style="--bs-fly-in:${sb.delay}ms">
          ${sb.html}<span class="bs-res-word">${esc(sb.word)}</span>
        </div>`
      : '');
  }

  renderBattle() {
    if (this._dead || !this.state) return;
    const s = this.state;
    const isMyTurn = this._isMyTurn();
    this._shellMode('battle');
    // FLY_MS is the single source of truth for the shot's timing; under reduced motion it MUST be
    // zero inline (an inline custom property beats the stylesheet's reduced-motion block).
    this.root.style.setProperty('--bs-fly', reducedMotion() ? '0ms' : `${FLY_MS}ms`);
    this._cannons = this._resolveCannons();
    let battle = this.shell.querySelector(':scope > .bs-battle');
    const sig = `${s.size}|${this.mp ? 1 : 0}`;
    if (!battle || battle.dataset.sig !== sig) {
      this._clearFx();
      this.shell.innerHTML = this._battleSkeletonHtml(s.size);
      battle = this.shell.querySelector(':scope > .bs-battle');
    }
    // The BRIGHT half of the screen is the half being SHOT AT, which is not "whose turn it is":
    // while your own shell is still in the air the turn has already passed. At the end both are lit.
    const shooting = this._cannons.mine ? 'mine' : this._cannons.theirs ? 'theirs' : (isMyTurn ? 'mine' : 'theirs');
    const enemyLive = s.over || shooting === 'mine';
    const ownLive = s.over || shooting === 'theirs';

    const bar = battle.querySelector('[data-slot="bar"]');
    const tb = this._turnBarParts();
    if (bar.className !== tb.cls) bar.className = tb.cls;
    if (bar.dataset.dir !== tb.dir) bar.dataset.dir = tb.dir;
    this._patchHtml(bar, tb.inner);
    const series = battle.querySelector('[data-slot="series"]');
    if (series && series.textContent !== this._seriesLine()) series.textContent = this._seriesLine();

    this._patchBoard('enemy', enemyLive);
    this._patchBoard('own', ownLive);

    const theirSunk = s.shots[this._remoteSeat()].sunkIds.length;
    const mySunk = s.shots[this._localSeat()].sunkIds.length;
    const score = battle.querySelector('[data-slot="score"]');
    score.setAttribute('aria-label', t('score_aria', { them: theirSunk, me: mySunk }));
    this._patchHtml(score, `<span class="bs-scoredisc-n bs-scoredisc-them">${theirSunk}</span>
      <span class="bs-scoredisc-dot" aria-hidden="true"></span>
      <span class="bs-scoredisc-n bs-scoredisc-me">${mySunk}</span>`);
    // Both fleets ride in the strip; the one being SHOT AT is in full colour, the other sinks back.
    const rt = battle.querySelector('[data-slot="roster-theirs"]');
    const rm = battle.querySelector('[data-slot="roster-mine"]');
    rt.classList.toggle('is-dim', !enemyLive);
    rm.classList.toggle('is-dim', enemyLive);
    this._patchHtml(rt, this._rosterItems(s.shots[this._remoteSeat()].sunkIds));
    this._patchHtml(rm, this._rosterItems(s.shots[this._localSeat()].sunkIds));
    this._patchHtml(battle.querySelector('[data-slot="exit"]'),
      this._armedBtn('bs-exitdisc', this.mp ? 'mp-leave' : this.ch ? 'ch-back' : 'exit-battle', 'exit'));

    const cap = this._aimCap();
    const ready = this._aims.length && this._aims.length >= cap && isMyTurn && !this.busy && !s.over;
    // Shots left this turn, big, beside the board (Matt, 2026-10-28: "show the shots left on screen each
    // turn"; with 5s shrinking 5, 4, 3, 2 the count changes turn to turn). Counts down as you aim; FIRE
    // takes its place at 0. Salvo games of 3 or 5 only (a bonus volley of 1 shows 1).
    const left = Math.max(0, cap - this._aims.length);
    const showLeft = !ready && isMyTurn && !this.busy && !s.over && this._salvoN() > 1;
    this._patchHtml(battle.querySelector('[data-slot="actions"]'), `
      <button type="button" class="bs-iconbtn bs-iconbtn-sm" data-action="help" aria-label="${esc(t('howto'))}" title="${esc(t('howto'))}">${ICON_HELP}</button>
      ${ready
        ? `<button type="button" class="bs-firebtn" data-action="fire-confirm">${ICON_TARGET}${esc(t('fire'))}</button>`
        : showLeft
          ? `<span class="bs-shotsleft" role="img" aria-label="${esc(t('shots_left', { n: left }))}"><b>${left}</b><span class="bs-shotsleft-dots" aria-hidden="true">${'<i></i>'.repeat(left)}${'<i class="is-used"></i>'.repeat(cap - left)}</span></span>`
          : `<span class="bs-shotcount" role="img" aria-label="${esc(t('shots_fired', { n: s.shotCount[this._localSeat()] | 0 }))}">${ICON_TARGET}${s.shotCount[this._localSeat()] | 0}</span>`}
      ${this.mp
        ? ''
        : this.ch
          ? (s.over ? '' : this._armedBtn('bs-iconbtn bs-iconbtn-sm', 'ch-resign', this._chResignKey()))
          : this._armedBtn('bs-iconbtn bs-iconbtn-sm', 'restart', 'restart_game')}`);

    this._fitBattleBoards();
    this._updateCellSize();
    this._aimCannons();
    if (this.ch) this._chPlaceChat();
    if (this._fxPending) {
      const v = this._fxPending;
      this._fxPending = null;
      this._playVolleyFx(v);
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
    // the setup card's water (renderSetup / _fitScene)
    this.shell.classList.toggle('bs-shell-scene', mode === 'scene');
    this.root.classList.toggle('bs-scene', mode === 'scene');
    if (mode !== 'scene') this.shell.style.minHeight = '';
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

  /** Restart and Exit are two-tap controls mid-battle: one stray tap on either used to throw a
   *  whole game away. Arming turns the disc red and glows it, and the accessible name changes with
   *  it. The ARMED state lives on the instance, not on the button, because the battle re-renders
   *  every time a shot settles -- an armed flag kept on the element was wiped by the next render,
   *  so the confirming tap just armed it again. */
  _armedBtn(cls, action, labelKey) {
    const armed = this._armed === action;
    const label = esc(t(armed ? (this._quitCostsLoss() ? 'quit_loss' : 'tap_again_confirm') : labelKey));
    const icon = action === 'restart' ? ICON_RESTART : action === 'ch-resign' ? ICON_FLAG : ICON_CLOSE;
    return `<button type="button" class="${cls} ${armed ? 'is-confirm' : ''}" data-action="${action}" data-armable="1"
      aria-label="${label}" title="${label}">${icon}</button>`;
  }

  confirmDestructive(btn, action) {
    const key = btn.dataset.action;
    if (!this.state || this.state.over || this._armed === key) { this.resetConfirms(); action(); return; }
    this.resetConfirms();
    this._armed = key;
    btn.classList.add('is-confirm');
    const armedLabel = t(this._quitCostsLoss() ? 'quit_loss' : 'tap_again_confirm');
    btn.setAttribute('aria-label', armedLabel);
    btn.setAttribute('title', armedLabel);
    this._confirmTimer = setTimeout(() => this.resetConfirms(), 3500);
  }

  resetConfirms() {
    clearTimeout(this._confirmTimer);
    this._confirmTimer = null;
    const was = this._armed;
    this._armed = null;
    if (!was || !this.shell) return;
    const b = this.shell.querySelector(`[data-armable][data-action="${was}"]`);
    if (!b) return;
    const label = t(was === 'restart' ? 'restart_game' : was === 'ch-resign' ? this._chResignKey() : 'exit');
    b.classList.remove('is-confirm');
    b.setAttribute('aria-label', label);
    b.setAttribute('title', label);
  }

  // --- stats + finish ------------------------------------------------------------------------

  /** Quitting a battle against the bot (Restart, Exit) once the player has fired is a LOSS
   *  (2026-10-29, docs/INTEGRITY-CHECKS-SPEC.md "Holes closed 2026-10-29: quitting and easier
   *  settings"). Placing ships is not a move. Leaving the hub is not quitting: the save resumes it.
   *  Live rooms and challenges are untouched. */
  _quitCostsLoss() {
    const s = this.state;
    if (this.mp) return this._mpLeaveCosts();
    // Once the BATTLE is on screen (2026-10-29, second pass, Matt): quitting after the bot's opening
    // volley was free. Placing ships is still not a move.
    return !this.ch && this.view === 'battle' && !!s && !s.over && !this._statsCommitted;
  }

  /** A solo battle waiting in the save while nothing is on the table (a challenge or a notification
   *  set it aside, `_chTakeArmed`): starting a NEW solo battle throws it away, which is quitting it.
   *  True when one is waiting. (A live room or a challenge leaves it alone: it resumes later.) */
  _savedQuitPending() {
    return !this.mp && !this.ch && !(this.view === 'battle' && this.state) && !!loadGame();
  }

  /** Record that set-aside battle's loss once (the save cleared first), with its shots so far. */
  _recordSavedQuitLoss() {
    if (!this._savedQuitPending()) return;
    const saved = loadGame();
    clearGame();
    const s = saved.state;
    const myShots = s.shotCount[0] | 0;
    const oppGrid = s.shots[1];
    let hits = 0;
    for (const v of oppGrid.cells) if (v === CELL_HIT || v === CELL_SUNK) hits++;
    const extras = { shots: myShots, hits, sunk: oppGrid.sunkIds.length, accuracy: myShots > 0 ? Math.round((hits / myShots) * 100) : 0 };
    try { recordBattleship(saved.difficulty, false, extras); } catch { /* never block the new game */ }
  }

  /** Record the quit as a loss, once (`_statsCommitted`), with the shots fired so far. */
  _recordQuitLoss() {
    if (this.mp || !this._quitCostsLoss()) return;
    this._statsCommitted = true;
    const s = this.state;
    const myShots = s.shotCount[this._localSeat()] | 0;
    const oppGrid = s.shots[this._remoteSeat()];
    let hits = 0;
    for (const v of oppGrid.cells) if (v === CELL_HIT || v === CELL_SUNK) hits++;
    const extras = { shots: myShots, hits, sunk: oppGrid.sunkIds.length, accuracy: myShots > 0 ? Math.round((hits / myShots) * 100) : 0 };
    try { recordBattleship(this._setup.difficulty, false, extras); } catch { /* never block leaving */ }
    clearGame();
  }

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
    if (this.ch) {
      // Counted once per match on this phone, through mp.js's ledger (the launcher's list read may
      // have counted it already, without these extras). Challenges write no head-to-head.
      const ov = this.ch.game && this.ch.game.over;   // its finish time keeps a fresh storage honest (2026-10-29)
      try { CH.countResult(this.ch.id, won, extras, (ov && ov.at) || Date.now()); CH.markResultSeen(this.ch.id); } catch (err) { console.error('[battleship] counting the challenge failed', err); }
      return;
    }
    // A live game already decided by a leave on this phone (js/live-leave.js) counts once, as that.
    if (this.mp && LL.alreadyCounted(this._mpKey())) return;
    if (this.mp) LL.endedNormally(STATS_ID, this._mpKey());
    try { recordBattleship(difficulty, won, extras); } catch { /* never block the result */ }
    const opp = this.mp && this.mp.opp;
    if (opp) { try { recordHeadToHead('battleship', opp, won); } catch { /* never block the result */ } }
  }

  finish() {
    this._commitStats();
    if (this.mp) this._mpAfterGameEnd();
    // THE LAST SHOT GETS SEEN. The card used to go up the instant the state said "over", on top of
    // the winning ball still in the air -- so the final sink, the one shot of the game that matters
    // most, played out underneath a modal. The stats are written above, immediately; only the CARD
    // waits for the shot to land. A restart or exit in that window cancels it (_stopGameTimers).
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    const wait = this._shotSettleMs(this._volley);
    if (wait <= 0) { this._showEndCard(); return; }
    this._endTimer = setTimeout(() => {
      this._endTimer = null;
      if (!this._dead && this.state && this.state.over && this.view === 'battle') this._showEndCard();
    }, wait);
  }

  _showEndCard() {
    const s = this.state;
    const won = s.winner === this._localSeat();
    this.closeOverlays();
    const id = this._identity();
    const title = won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = won ? '🏆' : id.oppEmoji;
    const isHost = !!(this.mp && this.mp.role === 'host');
    const actions = this.ch
      ? `<button type="button" class="bs-btn bs-btn-primary" data-action="ch-rematch">${esc(t('ch_rematch'))}</button>
         <button type="button" class="bs-btn bs-btn-ghost" data-action="ch-back">${esc(t('mp_back_btn'))}</button>`
      : !this.mp
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
        ${this.ch ? '' : `<p class="bs-card-sub">${this.mp ? esc(this._seriesLine()) : t(DIFF_LABEL_KEY[this._setup.difficulty])}</p>`}
        ${this._endStatsHtml()}
        <div class="bs-card-actions">${actions}</div>
      </div>`;
    this.root.appendChild(overlay);
  }

  /** Your shots and accuracy for the game just played, from the public grid -- the same numbers
   *  _commitStats records. */
  _endStatsHtml() {
    const s = this.state;
    const shots = s.shotCount[this._localSeat()] | 0;
    if (!shots) return '';
    let hits = 0;
    for (const v of s.shots[this._remoteSeat()].cells) if (v === CELL_HIT || v === CELL_SUNK) hits++;
    const acc = Math.round((hits / shots) * 100);
    return `<p class="bs-card-stats" role="img" aria-label="${esc(t('end_stats_aria', { n: shots, acc }))}">
      <span>${ICON_TARGET}${shots}</span><span class="bs-card-stats-acc">${acc}%</span></p>`;
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
    this._setVolley([]);
    this._aims = [];
    this._stopGameTimers();
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
    // The first shot arms the leave (js/live-leave.js): leaving from now on is this player's loss.
    if (!this._statsCommitted) LL.armLeave(STATS_ID, this._mpKey(), 'recordBattleship', [MP_DIFFICULTY, false, this._mpExtras()], [mp.opp]);
    this.renderBattle();
  }

  /** This player's shots, hits and ships sunk so far (the recorder's extras for a leave). */
  _mpExtras() {
    const s = this.state;
    if (!s) return { shots: 0, hits: 0, sunk: 0, accuracy: 0 };
    const myShots = s.shotCount[this._localSeat()] | 0;
    const oppGrid = s.shots[this._remoteSeat()];
    let hits = 0;
    for (const v of oppGrid.cells) if (v === CELL_HIT || v === CELL_SUNK) hits++;
    return { shots: myShots, hits, sunk: oppGrid.sunkIds.length, accuracy: myShots > 0 ? Math.round((hits / myShots) * 100) : 0 };
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
    this._setVolley([{ seat: mySeat, r, c, result: answer.result, sunk: answer.sunk, cells: answer.cells }]);
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
      this._setVolley([{ seat: defenderSeat, r: move.r | 0, c: move.c | 0, result: answer.result, sunk: answer.sunk, cells: answer.cells }]);
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
      // A leave that decided the game in play (js/live-leave.js): this phone's win, or its loss when
      // the other player claimed it. Anything else ends the room with nothing recorded, as before.
      let res = 'none';
      if (this._mpInGame() && !this._statsCommitted) {
        res = LL.onRoomEnded(room, { statsId: STATS_ID, key: this._mpKey(), n: mp.gameNum, mySeat: mp.role,
          fn: 'recordBattleship', winArgs: [MP_DIFFICULTY, true, this._mpExtras()], opps: [mp.opp] });
        if (res !== 'none') this._statsCommitted = true;
      }
      this._mpEndDueToOpponentLeft(res);
      return;
    }

    const opp = room[mp.role === 'host' ? 'guest' : 'host'];
    if (opp && !mp.opponentLeft) {
      const stale = (Date.now() - (opp.lastSeen || 0)) > MP_STALE_MS;
      if (stale && this._mpStatusMsg !== 'mp_status_opponent_disconnected') this._setMpStatus('mp_status_opponent_disconnected');
      else if (!stale && this._mpStatusMsg === 'mp_status_opponent_disconnected') this._clearMpStatus();
    }
    if (this._mpCanClaim()) LL.showClaim(this.root, () => this._mpClaim()); else LL.hideClaim(this.root);

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
      this._mpError = onlineGateText(res.error) || this._mpError;
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
    // A solo battle in the save is KEPT (2026-10-29, second pass): it used to be cleared here for
    // free, a quit with no loss. A live match never writes the solo save; the battle resumes later.
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
      this._mpError = onlineGateText(res.error) || this._mpError;
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
    // The solo save is kept, as for the host (2026-10-29, second pass).
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
    // Leaving the game in play (js/live-leave.js): after your own first move it is your loss, and the
    // room ends with your forfeit so the other phone records its win. The other player gone 90 s
    // after moving: leaving claims the win instead.
    if (this._mpCanClaim()) { this._mpClaim(); return; }
    const costs = this._mpLeaveCosts();
    if (this._reactions) this._reactions.setActive(false);   // no reactions off the table
    LL.hideClaim(this.root);
    const mp = this.mp;
    if (mp && costs) { this._statsCommitted = true; LL.forfeitNow(STATS_ID); }
    else if (mp && this._mpInGame()) LL.disarmLeave(STATS_ID);
    this.mp = null;
    this._mpClearSave();
    this._lobby = null; this._mode = 'solo';
    this._mpPendingCode = null; this._mpJoinedCode = null; this._mpLobbyRoom = null;
    this._mpStatusMsg = '';
    if (mp && mp.code && costs) LL.leaveWithForfeit(net, mp.code, mp.role, mp.role, mp.gameNum).catch(() => {});
    else if (mp && mp.code) net.leaveRoom(mp.code, mp.role).catch(() => {});
    else net.disconnect();
    this.renderSetup();
  }

  // --- leaving a live game (2026-10-29, js/live-leave.js) ----------------------------------------
  _mpKey() { return this.mp ? LL.liveKey(STATS_ID, this.mp.code, this.mp.gameNum) : null; }
  _mpOppRoleOf(mp) { return mp.role === 'host' ? 'guest' : 'host'; }
  _mpInGame() { return !!(this.mp && this.state && !(this.state.over) && this.view === 'battle'); }
  _mpOppAwayMs() { const r = this.mp && this.mp.lastRoomSnapshot; return r ? LL.awayMs(r[this._mpOppRoleOf(this.mp)]) : 0; }
  /** Has the other player fired in the game in play? (`startRound` clears the log per game.) */
  _mpOppMoved() {
    const r = this.mp && this.mp.lastRoomSnapshot, by = this.mp && this._mpOppRoleOf(this.mp);
    return !!(r && Object.values(r.moves || {}).some((m) => m && m.by === by && m.move && m.move.k === 's'));
  }
  _mpCanClaim() { return this._mpInGame() && !this._statsCommitted && this._mpOppAwayMs() >= LL.CLAIM_MS && this._mpOppMoved(); }
  _mpLeaveCosts() { return this._mpInGame() && !this._statsCommitted && this._mpOppAwayMs() < LL.CLAIM_MS && LL.leaveCosts(STATS_ID, this._mpKey()); }

  /** The other player has been gone 90 s after moving: this phone records its win and ends the room
   *  with their forfeit (their phone records the loss when it comes back, or its armed marker does). */
  _mpClaim() {
    if (!this._mpCanClaim()) return;
    const mp = this.mp;
    this._statsCommitted = true;
    LL.recordLeaveWin(STATS_ID, this._mpKey(), 'recordBattleship', [MP_DIFFICULTY, true, this._mpExtras()], [mp.opp]);
    if (this._reactions) this._reactions.setActive(false);
    LL.hideClaim(this.root);
    this.mp = null;
    this._mpClearSave();
    this._mpStatusMsg = '';
    LL.leaveWithForfeit(net, mp.code, mp.role, this._mpOppRoleOf(mp), mp.gameNum, true).catch(() => {});
    this._mpEndModal('mp_opponent_left_title', 'mp_opponent_left_sub', LL.lt('ll_claimed'));
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

  _mpEndDueToOpponentLeft(res) {
    if (this._dead || !this.mp) return;
    const name = (this.mp.opp && this.mp.opp.name) || '?';
    this.mp = null;
    this._mpClearSave();
    this._mpStatusMsg = '';
    LL.hideClaim(this.root);
    net.stopHeartbeat();
    const title = res === 'won' ? LL.lt('ll_left_win', { name }) : res === 'lost' ? LL.lt('ll_lost', { name }) : null;
    this._mpEndModal('mp_opponent_left_title', 'mp_opponent_left_sub', title);
  }

  _mpEndModal(titleKey, subKey, titleText) {
    this.closeOverlays();
    const title = titleText || t(titleKey);
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.dataset.role = 'mp-end';
    overlay.innerHTML = `
      <div class="bs-scrim"></div>
      <div class="bs-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="bs-x" data-action="mp-end-ok" aria-label="${t('close')}">&times;</button>
        <span class="bs-card-emoji">${titleText ? '🏳️' : '📡'}</span>
        <h3 class="bs-card-title">${esc(title)}</h3>
        ${titleText ? '' : `<p class="bs-card-sub">${t(subKey)}</p>`}
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
    if (save.midGame) {
      // Was the game decided by a leave while this phone was away? (js/live-leave.js)
      const other = role === 'host' ? 'guest' : 'host';
      const chk = await LL.checkRejoin(net, code, { statsId: STATS_ID, key: LL.liveKey(STATS_ID, code, save.gameNum),
        n: save.gameNum, mySeat: role, role, fn: 'recordBattleship', winArgs: [MP_DIFFICULTY, true, { shots: 0, hits: 0, sunk: 0, accuracy: 0 }],
        oppsOf: (room) => [room[other]] });
      if (this._dead) return;
      if (!chk.go) {
        this._mpClearSave();
        net.disconnect();
        const o = chk.room && chk.room[other];
        const name = (o && o.name) || '?';
        if (chk.res === 'won' || chk.res === 'lost') {
          this._mpEndModal('mp_opponent_left_title', 'mp_opponent_left_sub', chk.res === 'won' ? LL.lt('ll_left_win', { name }) : LL.lt('ll_lost', { name }));
        }
        return;
      }
    }
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

  // ==============================================================================================
  // CHALLENGES, turn by turn (2026-10-27). The data is mp.js; the launcher bubble alert.js. Three
  // screens live inside the Play vs. Friend card (its Challenge tab): your matches, a person picker,
  // and the deploy screen. A match plays on the ordinary battle screen with `this.ch` set: both
  // fleets are known here (they are in the match), so a shot resolves at once through game.js
  // exactly as solo, and is then written (`_chSend`, kept in mp.js's outbox until it lands). The
  // other person's shots arrive by `watchGame` and are shown one at a time (`_chNext`), each with its
  // ball, its banner and its settle, like the bot's. Leaving loses nothing, so isInProgress() stays false.
  // ==============================================================================================

  _chReason(reason) {
    const gate = onlineGateText(reason);
    if (gate) return gate;
    if (reason === 'offline' || reason === 'did-not-land') return t('ch_e_offline');
    if (reason === 'not-found') return t('ch_e_not_found');
    if (reason === 'expired') return t('ch_e_expired');
    if (reason === 'dev-origin-blocked') return t('ch_e_dev');
    return t('ch_e_failed');
  }

  /** What the hub handed over: a person to challenge, or a match to open. */
  _chTakeArmed(o) {
    if (!o) return;
    // A solo battle on screen (a notification tapped mid-game) stays in its save, untouched: without
    // this, renderSetup would treat leaving it as "New game" and clear it. It resumes next open.
    if (!this.mp && !this.ch && this.view === 'battle') { this._stopGameTimers(); this.state = null; }
    this._mode = 'ch';
    this._lobby = null;
    if (o.kind === 'pick' && o.them && o.them.code) {
      const gate = onlineGate();
      if (gate) { this._chHome(onlineGateText(gate)); return; }
      this._chChooseFor(o.them);
      return;
    }
    if (o.id) { this._chHome(); this._chOpen(o.id); }
  }

  /** Back to the list of matches (the Challenge tab), with an optional one-line note. */
  _chHome(note = '') {
    this._chClose();
    this._chPlace = null;
    this._chPick = null;
    this._chChoose = null;
    this._lobby = null;
    this._mode = 'ch';
    this._chNote = note;
    this.closeOverlays();
    this.renderSetup();
    this._chLoadList();
  }

  _chOnList() { return this.view === 'setup' && this._mode === 'ch' && !this._chPick && !this._chChoose && !this._lobby; }

  async _chLoadList() {
    const gen = ++this._chGen;
    try { await CH.drainOutbox(); } catch { /* sent next time */ }
    const rows = await CH.readMyGames();
    if (this._dead || gen !== this._chGen) return;
    this._chApplyRows(rows);
    // LIVE while the list is up: a move, a cancel or a result lands on it without a reload. (A
    // one-off read raced the other half of a cancel: the match said "called off" a moment before
    // both list rows were rewritten, and the stale row stayed on screen.)
    this._chWatchList();
    const onList = () => this._chOnList();
    try {
      const P = await import('../../js/push.js');
      const off = (await P.pushState()) === 'off';
      if (this._dead || gen !== this._chGen || off === this._chPushOff) return;
      this._chPushOff = off;
      if (onList()) this.renderSetup();
    } catch { /* no notifications on this phone */ }
  }

  _chApplyRows(rows) {
    try { CH.recordFinished(rows); } catch (err) { console.warn('[battleship] recordFinished', err); }
    this._chRows = rows;
    if (this._chOnList()) { this.renderSetup(); this._chShowUnseen(rows); }
  }

  _chWatchList() {
    if (this._chListStop) return;
    let stop = null, stopped = false;
    this._chListStop = () => { stopped = true; if (stop) { try { stop(); } catch { /* detached */ } } };
    CH.watchMyGames((rows) => { if (!stopped && !this._dead) this._chApplyRows(rows); })
      .then((s) => { if (stopped) { try { s(); } catch { /* detached */ } } else stop = s; });
  }

  _chStopList() {
    if (this._chListStop) { this._chListStop(); this._chListStop = null; }
  }

  async _chEnablePush() {
    try {
      const P = await import('../../js/push.js');
      const res = await P.enablePush();
      if (res && res.ok) { this._chPushOff = false; if (this.view === 'setup' && this._mode === 'ch') this.renderSetup(); }
    } catch { /* stays offered */ }
  }

  /** The Challenge tab: the board size, New challenge, then your matches (yours first), cut to fit. */
  _chStale() {
    return typeof CH.fireShot !== 'function' || typeof CH.replay !== 'function'
      || typeof CH.fireVolley !== 'function' || typeof CH.fireSalvoShot !== 'function' || typeof CH.volleyLeft !== 'function'
      || !Array.isArray(CH.SALVO_RULES) || !CH.SALVO_RULES.includes(3);
  }

  /** After picking a person: the board and shots a turn, then the deploy screen. Every way into a new
   *  challenge comes through here (the Challenge tab, the Multiplayer screen, Rematch), so neither
   *  choice can be skipped (Matt, 2026-10-27: "I didn't get a choice on the size of the board either"). */
  _chChooseFor(them, { size = this._setup.size, shots = this._setup.chShots } = {}) {
    if (this._chStale()) { this._chHome(); return; }
    this._chStopList();
    this._chClose();
    this._chPick = null;
    this._lobby = null;
    this._mode = 'ch';
    this._chChoose = { them, size: size === 'quick' ? 'quick' : 'classic', shots: chShotsOf(shots) || 3 };
    this.renderSetup();
  }

  _chChooseHTML() {
    const c = this._chChoose;
    return `<div class="bs-ch-pick">
      <div class="bs-mp-oppslot"><span>${esc(c.them.emoji || '🙂')}</span><span>${esc(c.them.name || '?')}</span></div>
      <div class="bs-field">
        <span class="bs-label">${esc(t('grid_size'))}</span>
        ${this._seg('ch-size', c.size, [['quick', '8×8'], ['classic', '10×10']])}
      </div>
      <div class="bs-field">
        <span class="bs-label">${esc(t('chip_ch_shots'))}</span>
        ${this._seg('ch-shots', c.shots, CH_SHOTS.map((n) => [n, String(n)]))}
      </div>
      <button type="button" class="bs-go" data-action="ch-place">${esc(t('start'))}</button>
    </div>`;
  }

  _chHTML() {
    const note = this._chNote ? `<p class="bs-mp-msg" aria-live="polite">${esc(this._chNote)}</p>` : '';
    const rows = this._chRows;
    let list;
    if (!rows) list = '<p class="bs-ch-note">…</p>';
    else {
      const live = rows.filter((r) => !r.over);
      const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
      // NO SCROLLING (root CLAUDE.md): at most four rows, one fewer for a note and one fewer for
      // Notify me (measured in the hub at 390x664), then "+N more". The Multiplayer screen lists
      // every match.
      let left = 4 - (this._chNote ? 1 : 0) - (this._chPushOff ? 1 : 0);
      const take = (arr) => { const out = arr.slice(0, left); left -= out.length; return out; };
      const m = take(mine), th = take(theirs);
      const more = live.length - m.length - th.length;
      list = (m.length ? `<h3 class="bs-ch-h">${esc(t('ch_your_turn'))} <span>${mine.length}</span></h3>${m.map((r) => this._chRowHTML(r)).join('')}` : '')
        + (th.length ? `<h3 class="bs-ch-h">${esc(t('ch_their_turn'))} <span>${theirs.length}</span></h3>${th.map((r) => this._chRowHTML(r)).join('')}` : '')
        + (more > 0 ? `<p class="bs-ch-note">${esc(t('ch_more', { n: more }))}</p>` : '')
        + (live.length ? '' : `<p class="bs-ch-note">${esc(t('ch_none'))}</p>`);
    }
    const notify = this._chPushOff
      ? `<button type="button" class="bs-btn bs-btn-ghost bs-btn-small" data-action="ch-notify">${esc(t('ch_notify'))}</button>` : '';
    // An mp.js from an older build (mid-update, see CH_SHOTS above): no challenge can be played
    // with it, so the only button is the update. Never a crash.
    if (this._chStale()) {
      return `<button type="button" class="bs-go bs-ch-newbtn" data-action="mp-update-required">${esc(t('mp_update_required'))}</button>`;
    }
    return `<button type="button" class="bs-go bs-ch-newbtn" data-action="ch-new">${esc(t('ch_new'))}</button>
      ${note}
      <div class="bs-ch-list">${list}</div>
      ${notify}`;
  }

  _chRowHTML(r) {
    const sub = r.mine || r.theirs ? `${myName()} ${r.mine} · ${r.name || '?'} ${r.theirs}` : '';
    return `<button type="button" class="bs-ch-row${r.yourTurn ? ' is-mine' : ''}" data-action="ch-open" data-id="${esc(r.id)}">
      <span class="bs-ch-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="bs-ch-text"><span class="bs-ch-name">${esc(r.name || '?')}</span>${sub ? `<span class="bs-ch-sub">${esc(sub)}</span>` : ''}</span>
      <span class="bs-ch-chev" aria-hidden="true">${r.yourTurn ? '▶' : '›'}</span>
    </button>`;
  }

  /** Who to challenge: a search box and the names that match it (the small directory, never players/). */
  _chNewPicker() {
    const gate = onlineGate();
    if (gate) { this._chNote = onlineGateText(gate); this.renderSetup(); return; }
    this._chPick = { opps: null, q: '' };
    this.renderSetup();
    const gen = ++this._chGen;
    CH.readOpponents().then((opps) => {
      if (this._dead || gen !== this._chGen || !this._chPick) return;
      this._chPick.opps = opps;
      const list = this.shell.querySelector('[data-role="ch-pick-list"]');
      if (list) list.innerHTML = this._chPickListHTML();
    });
  }

  _chPickerHTML() {
    return `<div class="bs-ch-pick">
      <input type="search" class="bs-ch-search" data-role="ch-search" value="${esc(this._chPick.q || '')}"
        placeholder="${esc(t('ch_search'))}" aria-label="${esc(t('ch_search'))}" autocomplete="off">
      <div class="bs-ch-list" data-role="ch-pick-list">${this._chPickListHTML()}</div>
    </div>`;
  }

  _chPickListHTML() {
    const p = this._chPick;
    if (!p || !p.opps) return '<p class="bs-ch-note">…</p>';
    const k = String(p.q || '').trim().toLowerCase();
    const all = p.opps.filter((o) => !k || String(o.name).toLowerCase().includes(k));
    if (!all.length) return `<p class="bs-ch-note">${esc(t('ch_nobody'))}</p>`;
    const SHOW = 5;
    return all.slice(0, SHOW).map((o) => `<button type="button" class="bs-ch-row" data-action="ch-pick" data-oi="${p.opps.indexOf(o)}">
        <span class="bs-ch-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="bs-ch-text"><span class="bs-ch-name">${esc(o.name)}</span></span>
        <span class="bs-ch-chev" aria-hidden="true">›</span>
      </button>`).join('')
      + (all.length > SHOW ? `<p class="bs-ch-note">${esc(t('ch_more', { n: all.length - SHOW }))}</p>` : '');
  }

  /** A match that ended while this phone was away: who won, by profile name, a close (X) and OK. */
  _chShowUnseen(rows) {
    const ids = CH.readUnseen();
    const ended = (rows || []).filter((r) => r.over && r.result && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
    if (!ended.length || !this.root || this.root.querySelector('[data-role="ch-unseen"]')) return;
    const r = ended[0];
    const won = r.result === 'won';
    const title = t('opp_wins', { opp: won ? myName() : (r.name || '?') });
    const all = ended.map((x) => x.id).join(',');
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';
    overlay.dataset.role = 'ch-unseen';
    overlay.innerHTML = `
      <div class="bs-scrim"></div>
      <div class="bs-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="bs-x" data-action="ch-unseen-ok" data-ids="${esc(all)}" aria-label="${esc(t('close'))}">&times;</button>
        <span class="bs-card-emoji">${esc(won ? '🏆' : r.emoji)}</span>
        <h3 class="bs-card-title">${esc(title)}</h3>
        ${r.why === 'timeout' ? `<p class="bs-card-sub">${esc(t('ch_timed_out'))}</p>` : r.why === 'resign' ? `<p class="bs-card-sub">${esc(t('ch_resigned', { name: won ? (r.name || '?') : myName() }))}</p>` : ''}
        <div class="bs-card-actions"><button type="button" class="bs-btn bs-btn-primary" data-action="ch-unseen-ok" data-ids="${esc(all)}">${esc(t('ch_ok'))}</button></div>
      </div>`;
    this.root.appendChild(overlay);
  }

  /** The deploy screen, placing a fleet for a new challenge or for one sent to you. */
  _chStartPlacement(target) {
    if (this._chStale()) { this._chHome(); return; }
    this._chStopList();
    this._chClose();
    this._chPick = null;
    this._chChoose = null;
    this._stopGameTimers();
    this.closeOverlays();
    this.state = null;
    this._aims = [];
    this._statsCommitted = false;
    this._chPlace = { ...target, size: CH.asSize(target.size) || 'classic' };
    this._newPlacement(this._chPlace.size);
    this.view = 'placement';
    this.renderPlacement();
  }

  /** SAVE on the deploy screen: send the challenge, or put your fleet on the one sent to you. */
  async _chPlaced() {
    const p = this._chPlace;
    if (!p || this._chSaving) return;
    this._chSaving = true;
    const fleet = this._placeFleet.ships.map((sh) => ({ id: sh.id, r: sh.r, c: sh.c, dir: sh.dir }));
    this.renderWaiting(this._identity().oppName, null);
    const res = p.kind === 'new'
      ? await CH.createGame({ them: p.them, fleet, size: p.size, shots: p.shots })
      : await CH.placeFleet(p.id, fleet);
    this._chSaving = false;
    if (this._dead || this._chPlace !== p) return;
    // Placing on a challenge that was called off while you placed: say so, not "went wrong".
    if (!res.ok) { this._chHome(res.reason === 'already-over' ? t('ch_called_off') : this._chReason(res.reason)); return; }
    this._chOpen(p.kind === 'new' ? res.id : p.id, res.game);
  }

  /** Open a match on the battle screen. A first-time receiver places their fleet first. The other
   *  person's latest run of shots, not yet shown on this phone, is played back one at a time. */
  async _chOpen(id, given = null) {
    if (this._chStale()) { this._chHome(); return; }
    const gen = ++this._chGen;
    if (!given) { try { await CH.drainOutbox(id); } catch { /* still owed: sent next time */ } }
    const game = given || await CH.readGame(id);
    if (this._dead || gen !== this._chGen) return;
    const me = CH.myCode();
    const side = game && CH.sideOf(game, me);
    if (!game || !side) { this._chHome(this._chReason('not-found')); return; }
    if (CH.isCalledOff(game)) { this._chHome(t('ch_called_off')); return; }
    const them = CH.themOf(game, me);
    if (CH.needsFleet(game, side)) {
      if (CH.lifeOf(game).expired) { this._chHome(t('ch_e_expired')); return; }
      this._chStartPlacement({ kind: 'fleet', id, size: game.size, them });
      return;
    }
    const theirs = side === 'a' ? 'b' : 'a';
    const shown = Math.min(game.log.length, CH.readShown(id));
    const start = Math.max(CH.lastRunStart(game, theirs), shown);
    let log = game.log.slice(0, start);
    let queue = game.log.slice(start);
    const link = {
      id, game, side, seat: CH.seatOfSide(side),
      them: { code: them.code, name: them.name || '?', emoji: them.emoji || '🙂' },
      known: game.log.length, foeUnknown: !game[theirs].fleet,
      pending: null, pendingBase: 0, sending: false, retry: null, stop: null, dead: false, chat: null, chatStop: null,
    };
    // Shots this phone fired and still owes the server (the outbox): they are part of the match here.
    const owed = CH.pendingFor(id);
    if (owed && owed.base === game.log.length && Array.isArray(owed.entries) && owed.entries.length) {
      link.pending = owed.entries.slice();
      link.pendingBase = owed.base;
      link.known += link.pending.length;
      if (queue.length) queue = queue.concat(link.pending); else log = log.concat(link.pending);
    }
    const rep = CH.replay(game.size, game.a.fleet, game.b.fleet, log, game.bonus, game.shots, game.salvo);
    if (!rep.ok) { CH.savePending(id, 0, []); this._chHome(this._chReason('failed')); return; }
    CH.markShown(id, game.log.length);
    this._chStopList();
    this._chClose();
    this._chPlace = null;
    this._chPick = null;
    this._stopGameTimers();
    this.closeOverlays();
    this.ch = link;
    this.state = rep.state;
    this.view = 'battle';
    this._statsCommitted = false;
    this._aims = [];
    this._setVolley([]);
    this._aimBySide = { mine: null, theirs: null };
    this._botAiming = false;
    this._fxPending = null;
    this._sunkShips = {};
    this._sinkPlayed = new Set();
    // Every ship already sunk is drawn at once (the same rebuild a solo resume does): both fleets
    // are known, and a sunk ship's cells are public anyway.
    for (let seat = 0; seat < 2; seat++) {
      for (const ship of ((this.state.fleets[seat] || {}).ships || [])) {
        if (!ship.hits.every(Boolean)) continue;
        this._sunkShips[seat] = this._sunkShips[seat] || {};
        this._sunkShips[seat][ship.id] = { id: ship.id, len: ship.len, r: ship.r, c: ship.c, dir: ship.dir };
        this._sinkPlayed.add(`${seat}:${ship.id}`);
      }
    }
    this._chQueue = queue.slice();
    this._chWatch(link);
    this._chMountChat(link);
    if (link.pending) this._chFlush(link);
    this._afterStateChange();
  }

  /** Show the other person's next queued VOLLEY (one shot in an older match: they still land one at
   *  a time), or, with none left, a resignation. A salvo volley is every shot up to the end of that
   *  volley, thrown together exactly as they fired it. */
  _chNext() {
    if (this._dead || !this.ch || !this.state || this._chTimer) return;
    if (!this._chQueue.length) { this._chMaybeForceEnd(); return; }
    const salvo = this._isSalvo(), per = this.ch.game.shots;
    const shots = [], answers = [];
    let target = null;
    while (this._chQueue.length) {
      const e = this._chQueue[0];
      const shooter = CH.seatOfSide(e.by);
      if (target !== null && 1 - shooter !== target) break;
      if (this.state.over || this.state.turn !== shooter || !isShotLegal(this.state, 1 - shooter, e.r, e.c)) {
        if (shots.length) break;
        this._chResync(); return;
      }
      this._chQueue.shift();
      target = 1 - shooter;
      const res = salvo ? CH.fireSalvoShot(this.state, shooter, e.r, e.c, per, this._salvoRuleN()) : CH.fireShot(this.state, shooter, e.r, e.c, per);
      this.state = res.state;
      shots.push({ seat: target, r: e.r, c: e.c, result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells });
      answers.push(res.answer);
      if (!salvo || this.state.over || !this.state.chVol) break;
    }
    this._setVolley(shots);
    this._showResultBanner(answers, target);
    this._afterStateChange();
  }

  /** A resignation is not in the log: once every shot is shown, end the match the way it ended. */
  _chMaybeForceEnd() {
    const g = this.ch && this.ch.game;
    // Resigned, or 7 days on someone's turn (js/challenge-life.js): a result the log did not produce.
    if (!g || !g.over || (g.over.why !== 'resign' && g.over.why !== 'timeout') || !this.state || this.state.over) return;
    this.state = { ...this.state, over: true, winner: CH.seatOfSide(g.over.winner) };
    this._afterStateChange();
  }

  /** One shot in an older (one-at-a-time) challenge. */
  _chFireAt(r, c) {
    const link = this.ch;
    if (!link || this._chQueue.length) return;
    if (CH.lifeOf(link.game).expired) { this._chHome(t('ch_e_expired')); return; }
    const target = this._remoteSeat();
    const res = CH.fireShot(this.state, this._localSeat(), r, c, link.game.shots);
    this.state = res.state;
    this._setVolley([{ seat: target, r, c, result: res.answer.result, sunk: res.answer.sunk, cells: res.answer.cells }]);
    this._maybeShowSunkBanner(res.answer, target);
    this._chSend(link, [{ by: link.side, r, c }]);
    this._afterStateChange();
  }

  /** A salvo: every aimed square at once (mp.js fireVolley stops at a winning shot), written as ONE
   *  batch so the other phone always receives the volley whole. */
  _chFireVolley(aims) {
    const link = this.ch;
    if (!link || this._chQueue.length || !aims.length) return;
    if (CH.lifeOf(link.game).expired) { this._chHome(t('ch_e_expired')); return; }
    const target = this._remoteSeat();
    const res = CH.fireVolley(this.state, this._localSeat(), aims.map((a) => [a.r, a.c]), link.game.shots, this._salvoRuleN());
    if (!res.fired.length) return;
    this.state = res.state;
    this._setVolley(res.fired.map(([r, c], i) => ({ seat: target, r, c, result: res.answers[i].result, sunk: res.answers[i].sunk, cells: res.answers[i].cells })));
    this._showResultBanner(res.answers, target);
    this._chSend(link, res.fired.map(([r, c]) => ({ by: link.side, r, c })));
    this._afterStateChange();
  }

  /** Our shots: sent at once, one batch at a time, kept in the outbox until they land. */
  _chSend(link, entries) {
    if (!link.pending) { link.pending = []; link.pendingBase = link.known; }
    for (const e of entries) { link.pending.push(e); link.known++; }
    CH.savePending(link.id, link.pendingBase, link.pending);
    this._chFlush(link);
  }

  async _chFlush(link) {
    if (link.sending || link.dead || !link.pending || !link.pending.length) return;
    link.sending = true;
    const batch = link.pending.slice();
    const res = await CH.appendLog(link.id, link.pendingBase, batch);
    link.sending = false;
    if (res.ok) {
      if (res.game) link.game = res.game;
      link.pending = link.pending.slice(batch.length);
      link.pendingBase += batch.length;
      CH.savePending(link.id, link.pendingBase, link.pending);
      if (!link.pending.length) link.pending = null;
      else this._chFlush(link);
      return;
    }
    // No signal: kept (the outbox holds it), tried again in a moment and on the next open.
    if (res.retryable) { if (!link.dead) link.retry = setTimeout(() => { link.retry = null; this._chFlush(link); }, 3000); return; }
    // The match moved on without these shots (expired, over, another phone): say so, start again.
    CH.savePending(link.id, link.pendingBase, []);
    link.pending = null;
    if (!link.dead && this.ch === link) this._chHome(this._chReason(res.reason));
  }

  _chWatch(link) {
    CH.watchGame(link.id, (g) => this._chOnGame(link, g)).then((stop) => {
      if (link.dead) { try { stop(); } catch { /* detached */ } } else link.stop = stop;
    });
  }

  _chOnGame(link, g) {
    if (link.dead || this.ch !== link || !g) return;
    link.game = g;
    if (CH.isCalledOff(g)) { this._chHome(t('ch_called_off')); return; }
    const theirs = link.side === 'a' ? 'b' : 'a';
    // They have just placed their fleet: open the match again with it.
    if (link.foeUnknown && g[theirs].fleet) { this._chResync(); return; }
    if (g.log.length > link.known) {
      for (const e of g.log.slice(link.known)) {
        if (e.by !== theirs) { this._chResync(); return; }   // our own shot, from another phone
        link.known++;
        this._chQueue.push(e);
      }
      CH.markShown(link.id, g.log.length);
    }
    if (!this.busy && !this._chTimer) this._chNext();
  }

  _chResync() {
    const link = this.ch;
    if (link) this._chOpen(link.id);
  }

  async _chResign() {
    const link = this.ch;
    if (!link) return;
    const res = await CH.resignGame(link.id);
    if (this.ch !== link) return;
    if (!res.ok) { this._chHome(this._chReason(res.reason)); return; }
    if (res.cancelled) { this._chHome(t('ch_called_off')); return; }
    link.game = res.game;
    this._chQueue = [];
    this._chMaybeForceEnd();
  }

  /** The battle screen's flag: Cancel / Decline while the challenge is unanswered, else Resign. */
  _chResignKey() {
    const link = this.ch;
    if (!link || !CH.lifeOf(link.game).open) return 'ch_resign';
    return link.side === CH.recipientOf(link.game) ? 'ch_decline' : 'ch_cancel';
  }

  /** Take the open match down: its watch, its retry timer, its chat. Shots still owed stay in the outbox. */
  _chClose() {
    this._chQueue = [];
    if (this._chTimer) { clearTimeout(this._chTimer); this._chTimer = null; }
    const link = this.ch;
    if (!link) return;
    this.ch = null;
    link.dead = true;
    if (link.retry) { clearTimeout(link.retry); link.retry = null; }
    if (link.stop) { try { link.stop(); } catch { /* detached */ } link.stop = null; }
    this._chUnmountChat(link);
  }

  // --- quick chat (REQUIRED in every online match, root CLAUDE.md) ---------------------------------
  // js/match-chat-ui.js is the panel; js/match-chat.js keeps the lines at `battleship/chat/<id>`,
  // BESIDE the match (never inside it).
  async _chMountChat(link) {
    let UI, DATA;
    try { [UI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
    if (link.dead || this.ch !== link || link.chat || !this.root) return;
    const chat = UI.createMatchChat({
      root: this.root,
      send: (p) => DATA.sendChat({ node: CH.NODE, id: link.id, side: link.side }, p),
      them: () => ({ name: link.them.name, emoji: link.them.emoji }),
    });
    link.chat = chat;
    this._chPlaceChat();
    const seenAt = DATA.readChatSeen(CH.NODE, link.id);
    const stop = await DATA.watchChat({ node: CH.NODE, id: link.id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === link.side;
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at }, { pop: !mine && c.at > seenAt });
        if (!mine) newest = Math.max(newest, c.at);
      }
      DATA.markChatSeen(CH.NODE, link.id, newest);
    });
    if (link.dead || link.chat !== chat) { try { stop(); } catch { /* detached */ } return; }
    link.chatStop = stop;
  }

  /** THE CHAT BUTTON SITS ON THE TURN BAR'S RIGHT END (2026-10-27). Matt: "No quick chat??" It was
   *  at the root's top-right corner, which on an iPhone in the hub is UNDER THE STATUS BAR (over the
   *  battery): it did not look like part of the game. Measured off the bar after every render, since
   *  the battle screen pulls itself to the edges by measurement too (_bleedToEdges). */
  _chPlaceChat() {
    if (!this.ch || !this.ch.chat || !this.root) return;
    const layer = this.root.querySelector('.ghc');
    const bar = this.shell && this.shell.querySelector('.bs-turnbar');
    if (!layer || !bar) return;
    const r = this.root.getBoundingClientRect(), b = bar.getBoundingClientRect();
    if (!b.height) return;
    const top = Math.round(b.top - r.top + (b.height - 44) / 2);
    layer.style.setProperty('--ghc-top', `${top}px`);
    layer.style.setProperty('--ghc-right', `${Math.max(6, Math.round(r.right - b.right) + 6)}px`);
    layer.style.setProperty('--ghc-pops-top', `${Math.round(b.bottom - r.top) + 8}px`);
  }

  _chUnmountChat(link) {
    if (link.chatStop) { try { link.chatStop(); } catch { /* detached */ } link.chatStop = null; }
    if (link.chat) { try { link.chat.destroy(); } catch { /* gone */ } link.chat = null; }
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
          <p class="bs-help-rule">${t('help_rule_ch')}</p>
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
    const search = e.target.closest('[data-role="ch-search"]');
    if (search && this._chPick) {
      this._chPick.q = search.value;
      const list = this.shell.querySelector('[data-role="ch-pick-list"]');
      if (list) list.innerHTML = this._chPickListHTML();
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

  // --- dragging a ship (rebuilt 2026-10-27) --------------------------------------------------------
  // Matt: placing ships "is weird and awkward and riddled with bugs". What was wrong underneath:
  //  - The board re-rendered the moment a finger touched a ship, destroying the element under it.
  //    On an iPhone the rest of that touch keeps going to the destroyed element and never reaches
  //    the game, so a placed ship could vanish into the tray on a touch and never follow the drag.
  //    The pointer is now CAPTURED BY THE ROOT (never re-rendered) and nothing re-renders until the
  //    finger has really moved.
  //  - The ship jumped square to square by re-rendering the whole board on every square. It now
  //    FOLLOWS THE FINGER (`.bs-drag-float`, moved by transform), and the squares it will land on
  //    light up in place (solid + tick = fits, dashed + cross = does not).
  //  - Dropping a placed ship off the board ROTATED it back where it was; dropping it where it did
  //    not fit lost it to the tray. Off the board now puts it in the tray; a drop that does not fit
  //    puts it back where it came from.
  //  - A tap that could not turn a ship (too near an edge) did nothing; it now slides along the
  //    board to make room when it can.

  onPointerDown(e) {
    if (this.view !== 'placement' || this._dragging) return;
    const sprite = e.target.closest('[data-role="board-ship"]');
    const chip = !sprite && e.target.closest('[data-role="ship-chip"]');
    if (!sprite && !chip) return;
    const shipId = (sprite || chip).dataset.ship;
    const def = this._placeShipSet.find((d) => d.id === shipId);
    if (!def) return;
    let origin = null, grab = 0;
    if (sprite) {
      const ship = this._placeFleet.ships.find((x) => x.id === shipId);
      if (!ship) return;
      origin = { r: ship.r, c: ship.c, dir: ship.dir };
      grab = this._grabIndexOnBoard(sprite, ship, e.clientX, e.clientY);
    } else {
      // grabbing the middle of a chip puts the MIDDLE of the ship under your finger, not its bow
      const cb = chip.getBoundingClientRect();
      const frac = cb.width ? (e.clientX - cb.left) / cb.width : 0.5;
      grab = Math.max(0, Math.min(def.len - 1, Math.floor(frac * def.len)));
    }
    this._dragging = { shipId, pointerId: e.pointerId, origin, grab, x: e.clientX, y: e.clientY, moved: false, lifted: false, anchor: null, float: null, ghost: [] };
    try { this.root.setPointerCapture(e.pointerId); } catch { /* the drag still works without it on most browsers */ }
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

  /** The board cell under a point, from the board's own geometry (never `elementFromPoint`, which
   *  keeps answering with the capturing element on several mobile browsers). */
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

  /** The board's cell step, padding and gap in px (set per board by _updateCellSize). */
  _placeGeom() {
    const board = this.root && this.root.querySelector('[data-role="place-board"]');
    if (!board) return null;
    const px = (k) => parseFloat(board.style.getPropertyValue(k)) || 0;
    const step = px('--bs-cell');
    return step > 0 ? { board, step, pad: px('--bs-pad'), gap: px('--bs-gap') } : null;
  }

  /** Picks the ship up: off the board (or out of the tray) and into your hand. */
  _liftShip(d) {
    d.lifted = true;
    if (d.origin) {
      this._placeDir[d.shipId] = d.origin.dir;
      this._placeFleet = { ...this._placeFleet, ships: this._placeFleet.ships.filter((x) => x.id !== d.shipId) };
    }
    this._placeSelected = d.shipId;
    this._placeInvalid = null;
    this._placePreview = null;
    this.renderPlacement();
    const g = this._placeGeom();
    const def = this._placeShipSet.find((x) => x.id === d.shipId);
    if (!g || !def) return;
    const dir = this._placeDir[d.shipId] || 'h';
    const long = def.len * g.step - g.gap, short = g.step - g.gap;
    const el = document.createElement('div');
    el.className = 'bs-drag-float';
    el.setAttribute('aria-hidden', 'true');
    el.style.width = `${(dir === 'v' ? short : long).toFixed(1)}px`;
    el.style.height = `${(dir === 'v' ? long : short).toFixed(1)}px`;
    el.innerHTML = `<div class="bs-ship-inner" style="position:absolute; top:50%; left:50%; width:${long.toFixed(1)}px; height:${short.toFixed(1)}px; transform:translate(-50%,-50%)${dir === 'v' ? ' rotate(90deg)' : ''};">${shipArtHtml(def.id, def.len, { fill: true })}</div>`;
    this.root.appendChild(el);
    // the grabbed square's middle sits under the finger
    const along = (d.grab + 0.5) * g.step - g.gap / 2;
    d.float = el;
    d.offX = dir === 'v' ? short / 2 : along;
    d.offY = dir === 'v' ? along : short / 2;
  }

  onPointerMove(e) {
    const d = this._dragging;
    if (this.view !== 'placement' || !d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) <= 6 && Math.abs(e.clientY - d.y) <= 6) return;
      d.moved = true;
      this._liftShip(d);
    }
    if (d.float) d.float.style.transform = `translate(${(e.clientX - d.offX).toFixed(1)}px, ${(e.clientY - d.offY).toFixed(1)}px)`;
    const under = this._cellAtPoint(e.clientX, e.clientY);
    const anchor = under ? this._anchorFor(d.shipId, under, d.grab | 0) : null;
    if ((anchor && d.anchor && anchor.r === d.anchor.r && anchor.c === d.anchor.c) || (!anchor && !d.anchor)) return;
    d.anchor = anchor;
    this._paintGhost(d);
  }

  /** Lights the squares the held ship would land on, in place (no re-render mid-drag). */
  _paintGhost(d) {
    for (const el of d.ghost) {
      el.classList.remove('bs-ghost-valid', 'bs-ghost-invalid');
      const badge = el.querySelector('.bs-ghost-badge');
      if (badge) badge.remove();
    }
    d.ghost = [];
    const board = this.root.querySelector('[data-role="place-board"]');
    const def = this._placeShipSet.find((x) => x.id === d.shipId);
    if (!board || !def || !d.anchor) return;
    const dir = this._placeDir[d.shipId] || 'h';
    const legal = this._placementLegalAt(d.shipId, d.anchor.r, d.anchor.c, dir);
    for (let i = 0; i < def.len; i++) {
      const r = dir === 'v' ? d.anchor.r + i : d.anchor.r;
      const c = dir === 'h' ? d.anchor.c + i : d.anchor.c;
      const el = board.querySelector(`[data-role="place-cell"][data-r="${r}"][data-c="${c}"]`);
      if (!el) continue;
      el.classList.add(legal ? 'bs-ghost-valid' : 'bs-ghost-invalid');
      el.insertAdjacentHTML('beforeend', `<span class="bs-ghost-badge" aria-hidden="true">${legal ? '&#10003;' : '&times;'}</span>`);
      d.ghost.push(el);
    }
  }

  /** The ship's anchor (its stern cell) given the cell the FINGER is over and which cell of the ship
   *  that is, slid back onto the board so the ship stops at the edge like a real piece would. */
  _anchorFor(shipId, under, grab) {
    const def = this._placeShipSet.find((x) => x.id === shipId);
    if (!def) return under;
    const dir = this._placeDir[shipId] || 'h';
    const size = boardSizeFor(this._placeSizeKey);
    const max = Math.max(0, size - def.len);
    if (dir === 'h') return { r: under.r, c: Math.max(0, Math.min(max, under.c - grab)) };
    return { r: Math.max(0, Math.min(max, under.r - grab)), c: under.c };
  }

  _endDrag() {
    const d = this._dragging;
    this._dragging = null;
    if (!d) return;
    if (d.float) d.float.remove();
    try { if (this.root && this.root.hasPointerCapture && this.root.hasPointerCapture(d.pointerId)) this.root.releasePointerCapture(d.pointerId); } catch { /* already released */ }
  }

  /** Turns a placed ship about its first square, sliding it back onto the board if the turn would
   *  hang it off the edge. A turn that cannot fit anywhere there leaves it as it was. */
  _turnPlaced(shipId) {
    const ship = this._placeFleet.ships.find((x) => x.id === shipId);
    if (!ship) return;
    const size = boardSizeFor(this._placeSizeKey);
    const rest = { ...this._placeFleet, ships: this._placeFleet.ships.filter((x) => x.id !== shipId) };
    const def = this._placeShipSet.find((x) => x.id === shipId);
    const dir = ship.dir === 'h' ? 'v' : 'h';
    const r = dir === 'v' ? Math.min(ship.r, size - ship.len) : ship.r;
    const c = dir === 'h' ? Math.min(ship.c, size - ship.len) : ship.c;
    const turned = def && placeShip(rest, def, r, c, dir);
    if (!turned) return;
    this._placeFleet = turned;
    this._placeDir[shipId] = dir;
    this._justRotatedShip = shipId;
  }

  onPointerUp(e) {
    const d = this._dragging;
    if (this.view !== 'placement' || !d || (e && e.pointerId != null && e.pointerId !== d.pointerId)) return;
    const cancelled = !!(e && e.type === 'pointercancel');
    this._endDrag();
    if (!d.moved) {
      if (cancelled) return;
      // a TAP: on a placed ship, turn it; on a tray ship, pick it (then tap a square to put it there)
      if (d.origin) this._turnPlaced(d.shipId);
      else { this._placeSelected = d.shipId; this._placeInvalid = null; }
      this.renderPlacement();
      return;
    }
    const def = this._placeShipSet.find((x) => x.id === d.shipId);
    const dir = this._placeDir[d.shipId] || 'h';
    const at = !cancelled && d.anchor;
    const placed = at && def && placeShip(this._placeFleet, def, at.r, at.c, dir);
    if (placed) {
      this._placeFleet = placed;
      this._placeInvalid = null;
      const next = this._placeShipSet.find((x) => !placed.ships.some((sh) => sh.id === x.id));
      this._placeSelected = next ? next.id : null;
    } else if (d.origin && (at || cancelled)) {
      // dropped where it does not fit: back where it came from
      const back = placeShip(this._placeFleet, def, d.origin.r, d.origin.c, d.origin.dir);
      if (back) this._placeFleet = back;
      this._placeDir[d.shipId] = d.origin.dir;
    } else if (at) {
      // from the tray onto a square it does not fit: leave its dashed ghost where it was refused
      this._placeInvalid = { shipId: d.shipId, r: at.r, c: at.c, dir };
    }
    // (dropped off the board: it stays in the tray, selected)
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
      // The tapped square is where the ship STARTS, slid back onto the board if it would hang off
      // the edge -- the same clamp a drag uses. A five-long carrier tapped into the last column used
      // to be silently refused, which read as the tap not working.
      const at = this._anchorFor(this._placeSelected, { r: Number(cell.dataset.r), c: Number(cell.dataset.c) }, 0);
      this._tryPlaceAt(this._placeSelected, at.r, at.c);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.root.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'ch-size' && this._chChoose) {
      this._chChoose.size = btn.dataset.v === 'quick' ? 'quick' : 'classic';
      this._setup.size = this._chChoose.size; this._saveSetup(); this.renderSetup();
    } else if (action === 'ch-shots' && this._chChoose) {
      this._chChoose.shots = chShotsOf(btn.dataset.v) || 3;
      this._setup.chShots = this._chChoose.shots; this._saveSetup(); this.renderSetup();
    } else if (action === 'ch-place' && this._chChoose) {
      const c = this._chChoose;
      this._chStartPlacement({ kind: 'new', them: c.them, size: c.size, shots: c.shots });
    } else if (action === 'ch-choose-back') {
      this._chChoose = null; this._chHome();
    } else if (action === 'set-diff') {
      if (DIFFICULTIES.some(([k]) => k === btn.dataset.v)) { this._setup.difficulty = btn.dataset.v; this._saveSetup(); this.renderSetup(); }
    } else if (action === 'set-size') {
      this._setup.size = btn.dataset.v === 'quick' ? 'quick' : 'classic'; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-shots') {
      this._setup.soloShots = chShotsOf(btn.dataset.v) || 3; this._saveSetup(); this.renderSetup();
    } else if (action === 'set-first') {
      const v = btn.dataset.v;
      if (v === 'you' || v === 'opponent' || v === 'alternate') { this._setup.firstMode = v; this._saveSetup(); this.renderSetup(); }
    } else if (action === 'set-mode') {
      this._mode = btn.dataset.v; this._setupExpanded = null; this._mpError = '';
      if (this._mode === 'ch') { this._chHome(); return; }
      this.renderSetup();
    } else if (action === 'play-bot') {
      this._mode = 'solo'; this.startGame();
    } else if (action === 'play-friend') {
      // Multiplayer opens on Challenge: the matches waiting on you are what people come here for.
      this._mpError = ''; this._chHome();
    } else if (action === 'mode-solo') {
      this._mode = 'solo'; this._mpError = ''; this._mpJoinCode = ''; this._chPick = null; this._chChoose = null; this._chNote = ''; this._chGen++; this.renderSetup();
    } else if (action === 'start') {
      // Over a set-aside solo battle: two taps, the button saying it counts as a loss.
      if (this._savedQuitPending() && btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = t('quit_loss'); return; }
      this.startGame();
    } else if (action === 'select-ship') {
      this._selectShip(btn.dataset.ship);
    } else if (action === 'exit-placement') {
      if (this._chPlace) { this._chHome(); return; }
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
      this._aimAt(Number(btn.dataset.r), Number(btn.dataset.c));
    } else if (action === 'fire-confirm') {
      this._confirmFire();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => { this._recordQuitLoss(); this.startGame(); });
    } else if (action === 'exit-battle') {
      this.confirmDestructive(btn, () => { this._recordQuitLoss(); this.closeOverlays(); this.renderSetup(); });
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
      // The battle screen's exit disc ends the match for the OTHER player too, so it takes the same
      // two taps as solo's; the lobby, waiting screen and end card leave on one.
      if (btn.dataset.armable) { this.confirmDestructive(btn, () => { this.closeOverlays(); this._mpLeaveToSetup(); }); return; }
      this.closeOverlays(); this._mpLeaveToSetup();
    } else if (action === 'mp-end-ok') {
      this.closeOverlays(); this.renderSetup();
    } else if (action === 'mp-update-required') {
      this._mpForceUpdate();
    } else if (action === 'ch-new') {
      this._chNewPicker();
    } else if (action === 'ch-pick') {
      const o = this._chPick && (this._chPick.opps || [])[Number(btn.dataset.oi)];
      if (o) this._chChooseFor(o);
    } else if (action === 'ch-pick-back') {
      this._chPick = null; this.renderSetup();
    } else if (action === 'ch-open') {
      this._chOpen(btn.dataset.id);
    } else if (action === 'ch-back') {
      this.closeOverlays(); this._chHome();
    } else if (action === 'ch-rematch') {
      const link = this.ch;
      if (!link) return;
      const them = { code: link.them.code, name: link.them.name, emoji: link.them.emoji };
      this.closeOverlays();
      this._chChooseFor(them, { size: link.game.size, shots: link.game.shots });
    } else if (action === 'ch-resign') {
      this.confirmDestructive(btn, () => this._chResign());
    } else if (action === 'ch-notify') {
      this._chEnablePush();
    } else if (action === 'ch-unseen-ok') {
      for (const id of String(btn.dataset.ids || '').split(',')) if (id) CH.markResultSeen(id);
      this.closeOverlays();
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
/** The hub hands a notified match to the game already open (js/hub.js `_openPushedGameNow`). Never
 *  while a live room is joined: that match is someone else's live game. */
export function openArmed() {
  if (!instance || instance.mp) return;
  let o = null;
  try { o = takeOpen(); } catch { o = null; }
  if (o) instance._chTakeArmed(o);
}
/** A live game's leave costs a loss (js/live-leave.js); the hub's leave confirm says so. */
export function quitCostsLoss() { return !!(instance && instance.mp && instance._mpLeaveCosts()); }

/** The hub's leave was confirmed: resign the live game in play (destroy() alone only detaches). */
export function leaveMatch() { if (instance && instance.mp) instance._mpLeaveToSetup(); }

export default { init, destroy, isInProgress, openArmed, quitCostsLoss, leaveMatch };
