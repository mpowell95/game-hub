// ui.js — Chinchón UI module. Exposes the hub contract: init(container)/destroy().
//
// The UI owns the DOM and implements a HumanAgent whose decision methods return
// promises resolved on tap — so the engine's async turn loop blocks on the human
// exactly as it resolves instantly on the AI. "Thinking" delays for AI turns are
// added here (never in the engine), in the awaited onEvent hook.

import { SUIT_META } from './deck.js';
import { Game, DEFAULT_CONFIG, makePlayer } from './game.js';
import { AIAgent } from './ai.js';
import * as meld from './meld.js';
import { renderCardFace as cardFaceHTML, preloadDeck, setDeck, listDecks, deckAssetUrl } from './cards.js';
import { loadProfile } from '../../js/profile-store.js';
import { qualifyChinchon, codeFor } from '../../js/challenge/hooks.js';
import { recordWin, loadChallenge } from '../../js/challenge/challenge-store.js';
import { showCodeReveal } from '../../js/challenge/reveal.js';
import { recordChinchon, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { stateHash } from './hash.js';
import * as net from '../../js/net.js';

const DECKS_BY_ID = Object.fromEntries(listDecks().map((d) => [d.id, d]));
const DEFAULT_DECK_ID = 'anita';

const AI_NAMES = ['Lucía', 'Diego', 'Sofía'];
const AI_AVATARS = ['💃', '🤠', '🎸'];
const HUMAN_AVATARS = ['🤠', '💃', '🕺', '🎸', '🐂', '🌹', '🏰', '🍷', '👑', '🦁', '🐉', '⚔️', '🛡️', '🎭', '🌟', '🔥', '🦊', '🐼', '🦉', '🐺', '😎', '🧔', '🎩', '🃏'];
const DIFFICULTIES = [['easy', 'Easy'], ['normal', 'Average'], ['hard', 'Hard']];
// Profile skill tiers (1-3) -> Chinchón's three AI levels.
const SKILL_TO_DIFF = { 1: 'easy', 2: 'normal', 3: 'hard' };
const PLAYER_COLORS = ['#d4a017', '#d22f27', '#1f5fd4', '#2e8b57'];

const BEAT_TURN = 700, BEAT_DRAW = 650, BEAT_DISCARD = 550, BEAT_CLOSE = 800;
const STORE_SETTINGS = 'chinchon-settings';
const STORE_STATS = 'chinchon-stats';

// Multiplayer (M2b). Chinchón has no existing solo autosave, so this key is
// MP-only: written after every applied entry while this.mp is set, cleared on
// match end/leave. Never touches STORE_SETTINGS/STORE_STATS.
const STORE_MP_SAVE = 'gamehub.chinchon.mp.v1';
const MP_CODE_LEN = 4;
const MP_RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const MP_STALE_MS = 60 * 1000;
const MP_RECOVERY_MAX_ATTEMPTS = 3;
// Human labels for the room's locked config, host-lobby summary line only
// (mirrors Escoba's MP_CONFIG_LABELS pattern). Unknown keys are skipped.
const MP_CONFIG_LABELS = {
  victoryCondition: (v) => (v === 'rounds' ? 'By rounds' : v === 'roundsOrPoints' ? 'Rounds or points' : 'By points'),
  scoreLimit: (v) => `${v} pts`,
  roundsLimit: (v) => `${v} rounds`,
  extended: (v) => (v ? '48-card deck' : null),
  joker: (v) => (v ? 'Joker' : null),
};

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/chinchon.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some(
    (l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/chinchon.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.ccStyle = '';
  document.head.appendChild(link);
}

/** URL for an Anita-deck outcome image (Betty win/loss art), resolved like the stylesheet. */
function anitaImgUrl(file) { return new URL(`../decks/anita/${file}`, import.meta.url).href; }

/** Spanish label for a face name like 'oros-11' (used by the deck-viewer gallery). */
const GAL_SUIT = { oros: 'Oros', copas: 'Copas', espadas: 'Espadas', bastos: 'Bastos' };
function galleryLabel(name) {
  if (name === 'back') return 'Reverso';
  const [suit, rankStr] = name.split('-');
  const rank = +rankStr;
  const r = rank === 1 ? 'As' : rank === 10 ? 'Sota' : rank === 11 ? 'Caballo' : rank === 12 ? 'Rey' : rank;
  return `${r} de ${GAL_SUIT[suit] || suit}`;
}
/** Names shown in the deck viewer: every card (ranks 1–12, all four suits) + the back. */
function galleryNames() {
  const names = [];
  for (const s of ['oros', 'copas', 'espadas', 'bastos']) for (let r = 1; r <= 12; r++) names.push(`${s}-${r}`);
  names.push('back');
  return names;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

const SUIT_ORDER = { oros: 0, copas: 1, espadas: 2, bastos: 3 };
function sortKey(c) { return c.isJoker ? { s: 9, r: 99 } : { s: SUIT_ORDER[c.suit], r: c.rank }; }
/** Sort a hand by suit-then-rank or rank-then-suit (jokers last). */
function sortHand(hand, mode) {
  return hand.slice().sort((x, y) => {
    const kx = sortKey(x), ky = sortKey(y);
    return mode === 'suit' ? (kx.s - ky.s || kx.r - ky.r) : (kx.r - ky.r || kx.s - ky.s);
  });
}

// Card faces are rendered by cards.js (imported above, aliased as cardFaceHTML).

class ChinchonUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.game = null;
    this._pending = null;        // { kind:'draw'|'discard'|'close', resolve }
    this._selectedCardId = null;
    this._newCardId = null;      // id of the human's just-drawn card (cleared on discard)
    this.activePlayerId = null;
    this._modalResolve = null;
    this._placeResolve = null;
    this._chartView = false;
    this._setupExpanded = null;   // which settings-card row is open (M3a accordion, mirrors Escoba's M1.2), one at a time
    this._sortMode = 'suit';        // 'suit' | 'rank' (cycled by the sort button)
    this._highlightSets = false;    // colour-code melds in the hand
    this._manualOrder = null;       // [cardId] once the player drag-reorders
    this._displayOrder = [];        // ids in current on-screen order (for drag math)
    this._drag = null;
    this._justDragged = false;

    this._setup = this._loadSetup();
    this.stats = loadJSON(STORE_STATS, { games: 0, wins: 0, losses: 0, closes: 0, chinchons: 0, minusTen: 0 });
    // Hidden challenge (M3b): retired. The gift is complete; forcing this false
    // collapses every challengeActive/challengeLive branch below back to plain,
    // ungated play for every profile, including the former recipient. The entry
    // point is neutralized here rather than deleting the branches themselves --
    // see js/challenge/keepsake.js for what replaced it.
    this.challengeActive = false;

    // Multiplayer (M2b). null in solo -- every MP code path is gated behind
    // this single field so solo play is byte-identical to before.
    this.mp = null;
    this._screen = 'setup';      // 'setup' | 'host-lobby' | 'join-lobby'
    this._mpBusy = false;
    this._mpError = '';
    this._mpJoinCode = '';
    this._mpStatusMsg = '';

    const ui = this;
    this.humanAgent = {
      isHuman: true,
      chooseDraw: () => ui.promptDraw(),
      chooseDiscard: () => ui.promptDiscard(),
      decideClose: async () => {
        const wants = await ui.promptClose();
        // A DECLINED close has no engine event to hook (playTurn() just
        // returns false with no state change) -- but for that exact reason,
        // sending here (immediately, no mutation pending) already reflects
        // the correct post-decision state; an ACCEPTED close is instead
        // sent from the 'close' event once whoClosed is actually set.
        if (ui.mp && !wants) await ui._mpAfterDecision(ui._human(), { t: 'close', kind: false });
        return wants;
      },
      choosePlacements: (view, locked, attachable) => ui.promptPlacements(attachable),
    };

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onHandPointerDown = (e) => this.onHandPointerDown(e);
    this._onPointerMove = (e) => this.onPointerMove(e);
    this._onPointerUp = (e) => this.onPointerUp(e);

    ensureStylesheet();
    setDeck(this._setup.deck);
    preloadDeck();
    this.mount();
    this._tryRestoreMP();
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(STORE_SETTINGS, {});
    // Shared hub profile: defaults-only, applied only where the game has no saved
    // last-used value (precedence: last-used > profile > built-in). AI identity is
    // read from the profile fresh each load (never persisted), so profile edits to
    // opponents always show; humanName/avatar/difficulty are persisted, so once the
    // player customizes them in-game their last-used choice wins.
    const profile = loadProfile();
    const opps = (profile && profile.opponents) || [];
    const aiNames = [], aiAvatars = [];
    const savedNames = Array.isArray(saved.aiNames) ? saved.aiNames : [];
    for (let i = 0; i < 3; i++) {
      // Precedence: last-used in-game rename > shared profile opponent > built-in.
      // 'Mateo' was a former built-in default; drop it so it can't stick around.
      const savedName = savedNames[i] === 'Mateo' ? '' : savedNames[i];
      aiNames.push(savedName || (opps[i] && opps[i].name) || AI_NAMES[i]);
      aiAvatars.push((opps[i] && opps[i].emoji) || AI_AVATARS[i]);
    }
    const profileDiff = (i) => (opps[i] && SKILL_TO_DIFF[opps[i].skill]) || 'normal';
    return {
      count: clamp(saved.count || (opps.length ? opps.length + 1 : 3), 2, 4),
      humanName: typeof saved.humanName === 'string' ? saved.humanName
        : (profile && profile.name) || 'You',
      humanAvatar: HUMAN_AVATARS.includes(saved.humanAvatar) ? saved.humanAvatar
        : (profile && profile.emoji) || HUMAN_AVATARS[0],
      aiNames, aiAvatars,
      aiDifficulty: Array.isArray(saved.aiDifficulty) ? saved.aiDifficulty.slice(0, 3)
        : [profileDiff(0), profileDiff(1), profileDiff(2)],
      deck: DECKS_BY_ID[saved.deck] ? saved.deck : DEFAULT_DECK_ID,
      dark: !!saved.dark,
      config: Object.assign({}, DEFAULT_CONFIG, saved.config || {}),
      // Last-used setup-screen mode (M2b). Additive: absent on an older save
      // simply defaults to 'solo', same as today's only screen.
      mode: ['solo', 'host', 'join'].includes(saved.mode) ? saved.mode : 'solo',
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(STORE_SETTINGS, { count: s.count, humanName: s.humanName, humanAvatar: s.humanAvatar, aiNames: s.aiNames, aiDifficulty: s.aiDifficulty, deck: s.deck, dark: s.dark, config: s.config, mode: s.mode });
  }

  /** Apply the dark-mode class to the root (idempotent; safe before mount). */
  _applyTheme() {
    if (this.root) this.root.classList.toggle('cc-dark', !!(this._setup && this._setup.dark));
  }

  // --- DOM construction -----------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="cc-root">
        <header class="cc-header" data-role="header"><h1 class="cc-title">Chinchón</h1></header>
        <section class="cc-setup" data-role="setup"></section>
        <section class="cc-game" data-role="game" hidden>
          <div class="cc-topbar">
            <div class="cc-opponents" data-role="opponents"></div>
            <button class="cc-menu-btn" data-action="open-menu" aria-label="Game menu">☰</button>
          </div>
          <div class="cc-mat">
            <div class="cc-piles" data-role="piles"></div>
            <div class="cc-status" data-role="status"></div>
          </div>
          <div class="cc-self-row">
            <div class="cc-self" data-role="self"></div>
            <div class="cc-handbar" data-role="handbar"></div>
          </div>
          <div class="cc-hand" data-role="hand"></div>
          <div class="cc-actions" data-role="actions"></div>
        </section>
        <div class="cc-modal" data-role="modal" hidden></div>
        <div class="cc-menu" data-role="menu" hidden></div>
        <div class="cc-toast" data-role="toast" hidden></div>
      </div>`;

    this.root = this.container.querySelector('.cc-root');
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.el = {
      header: q('header'), setup: q('setup'), game: q('game'),
      opponents: q('opponents'), piles: q('piles'), status: q('status'),
      self: q('self'), handbar: q('handbar'), hand: q('hand'), actions: q('actions'),
      modal: q('modal'), menu: q('menu'), toast: q('toast'),
    };

    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('input', this._onInput);
    this.el.hand.addEventListener('pointerdown', this._onHandPointerDown);
    this._applyTheme();
    this.showSetup();
  }

  // --- setup screen ---------------------------------------------------------

  showSetup() {
    if (this._dead) return;
    if (this.game) { this.game.abort(); this.game = null; }
    this._pending = null; this._selectedCardId = null; this.activePlayerId = null;
    this._modalResolve = null; this._placeResolve = null; this._chartView = false;
    this._matchEnded = false; this._closeMenu();
    // A lobby-only subscription (no match started yet) that wasn't already
    // torn down by its own cancel/leave path -- disconnect it defensively.
    // A live match's own room stays connected until an explicit leave.
    if (!this.mp && (this._screen === 'host-lobby' || this._screen === 'join-lobby')) net.disconnect();
    this._screen = 'setup'; this._mpError = ''; this._mpBusy = false; this._mpStatusMsg = ''; this._mpJoinCode = '';
    this._setupExpanded = null;
    this.mp = null;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this.el.game.hidden = true; this.el.header.hidden = false; this.el.setup.hidden = false;
    this.renderSetup();
  }

  /** Still working on the Chinchón challenge? (active AND not yet won). Once won, the game
   *  reverts to fully normal play. Dynamic, re-read each render. */
  get challengeLive() {
    if (!this.challengeActive) return false;
    try { return !loadChallenge().wins.chinchon; } catch { return true; }
  }

  /** Shared `.cc-segmented` builder, used throughout the settings card. */
  _seg(action, value, opts, cls = '', attrs = '') {
    return `<div class="cc-segmented${cls}"${attrs}>${opts.map(([v, lbl]) =>
      `<button class="cc-seg ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
  }

  /** One accordion row of the settings summary card (M3a, mirrors Escoba's
   *  M1.2 _summaryRow): a label + collapsed value, tap to expand the actual
   *  controls in place. Only `content` is rendered when open. */
  _summaryRow(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="cc-summary-item ${open ? 'is-open' : ''}">
      <button class="cc-summary-row" data-action="toggle-row" data-row="${key}">
        <span class="cc-summary-label">${label}</span>
        <span class="cc-summary-value">${value}</span>
      </button>
      ${open ? `<div class="cc-summary-expand">${content}</div>` : ''}
    </div>`;
  }

  /** The settings summary card (M3a): one collapsed accordion mirroring
   *  Escoba's M1.2 layout, replacing the old flat Players/Card deck/Game
   *  Settings sections. Solo and Host-online share this verbatim (Host is
   *  simply the screen where the host locks in these values pre-room). */
  _renderSettingsCard(isHost) {
    const s = this._setup;
    const c = s.config;
    const seg = this._seg.bind(this);

    const toggleRow = (field, label) =>
      `<div class="cc-rule"><span class="cc-rule-name">${label}</span>
        <button class="cc-switch ${c[field] ? 'is-on' : ''}" data-action="rule-toggle" data-field="${field}" role="switch" aria-checked="${!!c[field]}"><span class="cc-switch-thumb"></span></button></div>`;
    const stepRow = (field, label, val, suffix = '') =>
      `<div class="cc-rule"><span class="cc-rule-name">${label}</span>
        <span class="cc-stepper"><button class="cc-step" data-action="rule-step" data-field="${field}" data-d="-1">−</button>
        <span class="cc-step-val">${val}${suffix}</span>
        <button class="cc-step" data-action="rule-step" data-field="${field}" data-d="1">+</button></span></div>`;

    // --- Players row: count + human identity + (solo/join) AI name inputs.
    // Host online is 2-player only: a fixed, non-interactive "2" instead of
    // the count selector, and no AI rows (the second seat is the remote
    // guest, shown once they join the lobby, not here). ---
    const opponentNames = isHost ? [] : s.aiNames.slice(0, s.count - 1);
    const playersValue = isHost ? `2 · ${esc(s.humanName)} · online`
      : esc([s.humanName, ...opponentNames].join(' vs '));
    const aiNameRows = opponentNames.map((name, i) => `<div class="cc-player-row">
      <span class="cc-av">${s.aiAvatars[i]}</span>
      <input class="cc-name-input" data-ai-name="${i}" value="${esc(name)}" maxlength="14" aria-label="Opponent ${i + 1} name">
    </div>`).join('');
    const playersContent = `
      ${isHost ? `<div class="cc-locked-count" aria-label="2 players (online)">2</div>` : seg('set-count', String(s.count), [['2', '2'], ['3', '3'], ['4', '4']])}
      <div class="cc-player-row">
        <button class="cc-av cc-av-btn" data-action="open-avatar" title="Choose avatar">${s.humanAvatar}</button>
        <input class="cc-name-input" data-field="humanName" value="${esc(s.humanName)}" maxlength="14" aria-label="Your name">
      </div>
      ${aiNameRows}`;

    // --- Difficulty row: absent in Host mode (no AI opponents to tune). ---
    const diffLabel = (d) => (DIFFICULTIES.find(([v]) => v === d) || DIFFICULTIES[1])[1];
    const diffValue = esc(s.aiDifficulty.slice(0, s.count - 1).map(diffLabel).join(' · '));
    const diffContent = opponentNames.map((name, i) => `<div class="cc-diff-row">
      <span class="cc-diff-name">${esc(name)}</span>
      ${seg('set-aidiff', s.aiDifficulty[i] || 'normal', DIFFICULTIES, ' cc-seg-sm', ` data-i="${i}"`)}
    </div>`).join('');

    // --- Card deck row: replaces the old floating deck button + gallery
    // "See all cards" nudge (M3a A3) -- deck choices are inline here, the
    // gallery is one link away, and nothing is unreachable. ---
    const deckValue = esc(DECKS_BY_ID[s.deck].name);
    const deckContent = `<div class="cc-deck-grid">${this._deckOptionsHtml()}</div>`;

    // --- Game settings, regrouped into sensible rows (was one flat
    // disclosure): victory + limits, closing rules, deck rules, misc. ---
    const usesPoints = c.victoryCondition !== 'rounds';
    const usesRounds = c.victoryCondition !== 'points';
    const victoryLabel = { points: 'By points', rounds: 'By rounds', roundsOrPoints: 'Rounds or points' }[c.victoryCondition];
    const limitBits = [];
    if (usesPoints) limitBits.push(`${c.scoreLimit} pts`);
    if (usesRounds) limitBits.push(`${c.roundsLimit} rounds`);
    const victoryValue = esc([victoryLabel, ...limitBits].join(' · '));
    const victoryContent = `
      <div class="cc-rule"><span class="cc-rule-name">Victory</span>
        ${seg('rule-victory', c.victoryCondition, [['points', 'Points'], ['rounds', 'Rounds'], ['roundsOrPoints', 'Both']])}</div>
      ${usesPoints ? stepRow('scoreLimit', 'Score limit', c.scoreLimit) : ''}
      ${usesRounds ? stepRow('roundsLimit', 'Rounds', c.roundsLimit) : ''}`;

    const placeLabel = { auto: 'Auto placement', manual: 'Manual placement', off: 'No placement' }[c.placeOnEnding];
    const closingValue = esc(`Close ≤${c.maxClose} · ${c.figuresFaceValue ? 'Own' : 'Flat'} figures · ${placeLabel}`);
    const closingContent = `
      <div class="cc-rule"><span class="cc-rule-name">Max points to close</span>
        ${seg('rule-maxclose', String(c.maxClose), [['3', '3'], ['4', '4'], ['5', '5']])}</div>
      <div class="cc-rule"><span class="cc-rule-name">Figures value</span>
        ${seg('rule-figures', c.figuresFaceValue ? 'own' : 'flat', [['flat', 'Flat 10'], ['own', 'Own']])}</div>
      <div class="cc-rule"><span class="cc-rule-name">Place cards on ending</span>
        ${seg('rule-place', c.placeOnEnding, [['auto', 'Auto'], ['manual', 'Manual'], ['off', 'Off']])}</div>`;

    const deckRuleBits = [c.extended ? '48-card' : null, c.joker ? 'Joker' : null, c.aceOrosWild ? 'Wild Ace' : null].filter(Boolean);
    deckRuleBits.push(`${c.maxResets} reset${c.maxResets === 1 ? '' : 's'}`);
    const deckRulesValue = esc(deckRuleBits.join(' · '));
    const deckRulesContent = `
      ${toggleRow('extended', 'Use 8s & 9s (48 cards)')}
      ${toggleRow('joker', 'Play with Joker')}
      ${toggleRow('aceOrosWild', 'Ace of Oros is wild')}
      ${stepRow('maxResets', 'Deck resets', c.maxResets)}`;

    const miscOn = [c.winWithChinchon ? 'Chinchón wins' : null, c.showRemaining ? 'Remaining shown' : null].filter(Boolean);
    const miscValue = esc(miscOn.length ? miscOn.join(' · ') : 'Off');
    const miscContent = `
      ${toggleRow('winWithChinchon', 'Win with chinchón')}
      ${toggleRow('showRemaining', 'Show remaining cards')}`;

    return `<div class="cc-summary-card">
      ${this._summaryRow('players', 'Players', playersValue, playersContent)}
      ${isHost ? '' : this._summaryRow('difficulty', 'Difficulty', diffValue, diffContent)}
      ${this._summaryRow('deck', 'Card deck', deckValue, deckContent)}
      ${this._summaryRow('victory', 'Victory', victoryValue, victoryContent)}
      ${this._summaryRow('closing', 'Closing rules', closingValue, closingContent)}
      ${this._summaryRow('deckrules', 'Deck rules', deckRulesValue, deckRulesContent)}
      ${this._summaryRow('rules', 'Other rules', miscValue, miscContent)}
    </div>`;
  }

  renderSetup() {
    if (this._screen === 'host-lobby' || this._screen === 'join-lobby') {
      this.el.header.innerHTML = `<h1 class="cc-title">Chinchón</h1>`;
      this.el.setup.innerHTML = `<div class="cc-card-panel">${this._renderMpLobby()}</div>`;
      return;
    }
    // While the challenge is unwon, force the qualifying config (exactly 1 opponent at
    // Average or Hard) so the locked setup she plays actually counts.
    if (this.challengeLive) {
      this._setup.count = 2;
      if (!['normal', 'hard'].includes(this._setup.aiDifficulty[0])) this._setup.aiDifficulty[0] = 'normal';
    }
    const live = this.challengeLive;
    const done = this.challengeActive && !live;
    const s = this._setup;
    const st = this.stats;
    // In challenge mode the setup is fixed and the app runs "straight"; suppress the joke
    // flavor (Ana Banana title, lifetime stats). Normal play keeps all of it.
    const statsLine = (!this.challengeActive && st.games > 0)
      ? `<p class="cc-stats">🏆 ${st.games} played · ${st.wins} won · ${st.closes} closes · ${st.chinchons} chinchón</p>`
      : '';

    // Themed title: the Ana Banana deck rebrands the whole screen as a joke edition.
    const anita = s.deck === 'anita';
    const themeBtn = `<button class="cc-theme-btn" data-action="toggle-theme" aria-label="Toggle dark mode" title="${s.dark ? 'Light mode' : 'Dark mode'}">${s.dark ? '☀️' : '🌙'}</button>`;
    this.el.header.innerHTML = ((anita && !this.challengeActive)
      ? `<h1 class="cc-title cc-title-anita">Chinchón <span class="cc-title-bonita">Ana Banana</span></h1>`
      : `<h1 class="cc-title">Chinchón</h1>`) + themeBtn;

    // Multiplayer (M2b): a Solo/Host online/Join selector, absent entirely in
    // challenge mode (that hidden feature is solo-only by construction, and
    // MP would only complicate its locked/qualifying setup for no benefit).
    const mpMode = this.challengeActive ? 'solo' : (s.mode || 'solo');
    const modeSeg = this.challengeActive ? '' : this._seg('set-mode', mpMode, [['solo', 'Solo'], ['host', 'Host online'], ['join', 'Join']]);

    if (mpMode === 'join') {
      this.el.setup.innerHTML = `<div class="cc-card-panel">${statsLine}${modeSeg}${this._renderMpJoinBody()}</div>`;
      return;
    }

    const isHost = mpMode === 'host';
    const actionBtn = isHost
      ? `<button class="cc-btn cc-btn-ghost" data-action="mp-host">Host game</button>`
      : `<button class="cc-btn cc-btn-primary ${live ? 'cc-btn-challenge' : ''}" data-action="start">${live ? 'Begin challenge' : 'Start game'}</button>`;

    this.el.setup.innerHTML = `
      <div class="cc-card-panel ${live ? 'cc-locked' : ''}">
        ${done ? '<p class="cc-challenge-note">Chinch&oacute;n challenge completed. Play anyways?</p>' : ''}
        ${statsLine}
        ${modeSeg}
        ${this._renderSettingsCard(isHost)}
        ${actionBtn}
      </div>`;
  }

  // --- multiplayer lobby (M2b) ------------------------------------------------

  /** Join mode's body: code input on the main setup screen itself (never its
   *  own pre-join screen) -- _screen only switches to 'join-lobby' once the
   *  join actually succeeds (see _mpJoinSubmit). Mirrors Escoba's M1.2 Join
   *  mode, incl. retained-on-error input (see onInput/_syncMpMsgSlot). */
  _renderMpJoinBody() {
    const err = this._mpError;
    const msg = err === 'version'
      ? `<button class="cc-mp-msg cc-mp-msg-action" data-action="mp-update-required">Update required</button>`
      : `<p class="cc-mp-msg" data-role="mp-msg">${esc(err || (this._mpBusy ? 'Joining…' : ''))}</p>`;
    return `<div class="cc-mp-lobby">
      <span class="cc-label">Enter code</span>
      <input class="cc-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}"
        value="${esc(this._mpJoinCode)}"
        autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Room code">
      ${msg}
      <button class="cc-btn cc-btn-primary" data-action="mp-join-submit">Join</button>
    </div>`;
  }

  /** Mid-dot summary of the room's locked config for the host lobby (e.g.
   *  "By points · 100 pts"). Unknown/falsy-labeled keys are skipped, and
   *  scoreLimit/roundsLimit are only shown when victoryCondition actually
   *  uses them (mirrors the setup screen's own usesPoints/usesRounds gate). */
  _mpConfigSummary(config) {
    if (!config) return '';
    const usesPoints = config.victoryCondition !== 'rounds';
    const usesRounds = config.victoryCondition !== 'points';
    return Object.keys(MP_CONFIG_LABELS)
      .filter((k) => (k === 'scoreLimit' ? usesPoints : k === 'roundsLimit' ? usesRounds : true))
      .map((k) => (config[k] !== undefined ? MP_CONFIG_LABELS[k](config[k]) : null))
      .filter(Boolean)
      .join(' · ');
  }

  _renderMpLobby() {
    const back = `<button class="cc-btn cc-btn-ghost" data-action="mp-cancel">Back</button>`;
    if (this._screen === 'host-lobby') {
      const room = this._mpLobbyRoom;
      const guest = room && room.guest;
      const code = this._mpPendingCode;
      const msg = this._mpError || (this._mpBusy ? 'Creating room…' : '');
      return `<div class="cc-mp-lobby">
        <span class="cc-label">Room code</span>
        ${code ? `<div class="cc-mp-code">${esc(code)}</div>` : `<div class="cc-mp-code cc-mp-code-empty">····</div>`}
        <span class="cc-label">Opponent</span>
        <div class="cc-mp-oppslot">${guest
          ? `<span class="cc-av">${guest.avatar}</span><span class="cc-mp-oppname">${esc(guest.name)}</span>`
          : `<span class="cc-mp-oppslot-empty">—</span>`}</div>
        <p class="cc-mp-summary">${esc(this._mpConfigSummary(room && room.config))}</p>
        <p class="cc-mp-msg" data-role="mp-msg">${esc(msg)}</p>
        <button class="cc-btn cc-btn-primary" data-action="mp-start" ${guest ? '' : 'disabled'}>Start</button>
        ${back}
      </div>`;
    }
    // The only other lobby state is 'join-lobby', only ever entered once a
    // join has actually succeeded (see _mpJoinSubmit) -- waiting on the host
    // to tap Start. Mirrored shape of the host lobby's opponent slot.
    const room = this._mpLobbyRoom;
    const host = room && room.host;
    return `<div class="cc-mp-lobby">
      <span class="cc-label">Room code</span>
      <div class="cc-mp-code">${esc(this._mpJoinedCode)}</div>
      <span class="cc-label">Host</span>
      <div class="cc-mp-oppslot">${host
        ? `<span class="cc-av">${host.avatar}</span><span class="cc-mp-oppname">${esc(host.name)}</span>`
        : `<span class="cc-mp-oppslot-empty">—</span>`}</div>
      <p class="cc-mp-msg" data-role="mp-msg">Waiting for host</p>
      ${back}
    </div>`;
  }

  syncSetupInputs() {
    const input = this.el.setup.querySelector('[data-field="humanName"]');
    if (input) this._setup.humanName = input.value.trim() || 'You';
    this.el.setup.querySelectorAll('[data-ai-name]').forEach((inp) => {
      const i = +inp.dataset.aiName;
      this._setup.aiNames[i] = inp.value.trim() || AI_NAMES[i] || `Player ${i + 2}`;
    });
  }

  _openAvatarPicker() {
    const grid = HUMAN_AVATARS.map((av) =>
      `<button class="cc-av-opt ${av === this._setup.humanAvatar ? 'is-sel' : ''}" data-action="pick-avatar" data-v="${av}" aria-label="Avatar ${av}">${av}</button>`).join('');
    this.el.modal.innerHTML = `<div class="cc-scrim" data-action="close-avatar"></div><div class="cc-sheet cc-avatar-sheet">
      <h2 class="cc-sheet-title">Choose your avatar</h2>
      <div class="cc-av-grid">${grid}</div>
      <button class="cc-btn cc-btn-ghost" data-action="close-avatar">Close</button>
    </div>`;
    this.el.modal.hidden = false;
  }

  _closeAvatarPicker() {
    this.el.modal.hidden = true;
    this.el.modal.innerHTML = '';
  }

  /** The Card deck accordion row's expanded content (M3a): deck options inline,
   *  no modal -- picking a deck is a direct tap here. Each option keeps its own
   *  "View all cards" link into the full-screen gallery (still a modal, since
   *  it's genuinely full-screen content, not a setup control). */
  _deckOptionsHtml() {
    return listDecks().map((d) => {
      const sel = d.id === this._setup.deck ? 'is-sel' : '';
      return `<div class="cc-deck-opt-wrap ${sel}">
        <button class="cc-deck-opt ${sel}" data-action="pick-deck" data-v="${d.id}" aria-pressed="${sel ? 'true' : 'false'}">
          <img class="cc-deck-back" src="${deckAssetUrl(d.id, 'back')}" alt="${esc(d.name)} back" draggable="false">
          <span class="cc-deck-opt-name">${esc(d.name)}${sel ? ' <span class="cc-deck-tick">✓</span>' : ''}</span>
        </button>
        <button class="cc-deck-view-btn" data-action="view-deck" data-v="${d.id}">🔍 View all cards</button>
      </div>`;
    }).join('');
  }

  /** Gallery of every card in a deck; tap any card to view it full-screen. */
  _openDeckGallery(deckId) {
    const d = DECKS_BY_ID[deckId];
    const cells = galleryNames().map((n) => {
      const label = galleryLabel(n);
      return `<button class="cc-gal-cell" data-action="zoom-card" data-deck="${deckId}" data-name="${n}">
        <img class="cc-gal-img" src="${deckAssetUrl(deckId, n)}" alt="${esc(label)}" loading="lazy" draggable="false">
        <span class="cc-gal-cap">${esc(label)}</span>
      </button>`;
    }).join('');
    this.el.modal.innerHTML = `<div class="cc-scrim" data-action="close-gallery"></div><div class="cc-sheet cc-gallery-sheet">
      <div class="cc-gallery-head">
        <h2 class="cc-sheet-title">${esc(d.name)}</h2>
        <button class="cc-btn cc-btn-ghost" data-action="close-gallery">Done</button>
      </div>
      <p class="cc-gallery-hint">Tap any card to zoom in.</p>
      <div class="cc-gallery-grid">${cells}</div>
    </div>`;
    this.el.modal.hidden = false;
  }

  _closeGalleryModal() {
    this.el.modal.hidden = true;
    this.el.modal.innerHTML = '';
  }

  /** Full-screen view of a single card, layered above the gallery. */
  _openCardZoom(deckId, name) {
    this._closeCardZoom();
    const label = galleryLabel(name);
    const z = document.createElement('div');
    z.className = 'cc-zoom';
    z.dataset.role = 'zoom';
    z.innerHTML = `<div class="cc-zoom-scrim" data-action="close-zoom"></div>
      <div class="cc-zoom-inner" data-action="close-zoom">
        <img class="cc-zoom-img" src="${deckAssetUrl(deckId, name)}" alt="${esc(label)}" draggable="false">
        <span class="cc-zoom-cap">${esc(label)}</span>
      </div>
      <button class="cc-zoom-close" data-action="close-zoom" aria-label="Close">✕</button>`;
    this.root.appendChild(z);
  }

  _closeCardZoom() {
    const z = this.root.querySelector('[data-role="zoom"]');
    if (z) z.remove();
  }

  startGame() {
    this.syncSetupInputs();
    this._saveSetup();
    const s = this._setup;
    const players = [makePlayer({ id: 0, name: s.humanName || 'You', avatar: s.humanAvatar, isHuman: true, agent: this.humanAgent })];
    for (let i = 0; i < s.count - 1; i++) {
      const diff = s.aiDifficulty[i] || 'normal';
      players.push(makePlayer({
        id: i + 1, name: s.aiNames[i], avatar: s.aiAvatars[i], difficulty: diff,
        agent: new AIAgent({ difficulty: diff, name: s.aiNames[i] }),
      }));
    }
    const config = Object.assign({}, DEFAULT_CONFIG, s.config);
    this.game = new Game({ players, config });
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this._newCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._matchMinusTens = 0; this._statsCommitted = false;
    this._matchEnded = false; this._closeMenu();

    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this._buildPiles();
    this.render();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Chinchón match error', err); });
  }

  // --- human agent (promise-resolving prompts) ------------------------------

  promptDraw() { return new Promise((resolve) => { this._pending = { kind: 'draw', resolve }; this.render(); }); }
  promptDiscard() { return new Promise((resolve) => { this._pending = { kind: 'discard', resolve }; this._selectedCardId = null; this.render(); }); }
  promptClose() { return new Promise((resolve) => { this._pending = { kind: 'close', resolve }; this.render(); }); }

  promptPlacements(attachable) {
    return new Promise((resolve) => {
      this._placeResolve = resolve;
      this._placeIds = attachable.map((c) => c.id);
      const g = this.game;
      const closer = g.byId(g.whoClosed);
      const total = attachable.reduce((sum, c) => sum + c.value, 0);
      const cards = attachable.map((c) => cardFaceHTML(c, { static: true, mini: true, melded: true })).join('');
      this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
        <h2 class="cc-sheet-title">Lay off cards?</h2>
        <p class="cc-sheet-sub">Onto ${esc(closer.name)}'s melds · −${total} pts</p>
        <div class="cc-place-cards">${cards}</div>
        <div class="cc-place-actions">
          <button class="cc-btn cc-btn-primary" data-action="place-all">Place all (−${total})</button>
          <button class="cc-btn cc-btn-ghost" data-action="place-skip">Keep them</button>
        </div></div>`;
      this.el.modal.hidden = false;
    });
  }

  _resolvePending(value) {
    if (!this._pending) return;
    const { resolve } = this._pending;
    this._pending = null; this._selectedCardId = null;
    this.render();
    resolve(value);
  }

  _resolvePlace(value) {
    if (!this._placeResolve) return;
    const r = this._placeResolve;
    this._placeResolve = null;
    if (this.el && this.el.modal) { this.el.modal.hidden = true; this.el.modal.innerHTML = ''; }
    r(value);
  }

  // --- engine event hook (rendering + AI pacing + stats) --------------------

  async onEvent(type, payload) {
    if (this._dead) return;
    const p = payload && payload.playerId != null ? this.game.byId(payload.playerId) : null;
    switch (type) {
      case 'roundStart':
        this.activePlayerId = null; this._pending = null; this._selectedCardId = null; this._newCardId = null; this.render();
        // Host publishes the round it just built (deck order + dealer) before
        // any turn plays, so the guest can preset its own engine to match.
        // Read right here: lastDeckOrder was just set by startRound(), which
        // ran synchronously before this event, with no await in between.
        if (this.mp && this.mp.role === 'host') {
          try { await net.startRound(this.mp.code, this.game.round, this.game.lastDeckOrder, this.game.dealerIndex); }
          catch { this._setMpStatus('Connection error'); }
        }
        break;
      case 'turnStart':
        this.activePlayerId = payload.playerId; this.render();
        // Guest only: the engine is about to check tryResetStock() (right
        // after this emit resolves, before any award); if the stock is
        // already empty, block here until the host's reported reset order
        // has arrived, so the guest's own tryResetStock() call finds
        // config.presetStockResets already populated instead of falling
        // through to a local (non-deterministic) shuffle.
        if (this.mp && this.mp.role === 'guest') await this._mpAwaitStockReset();
        if (p && !p.isHuman) await this.beat(BEAT_TURN);
        break;
      case 'draw':
        if (p && p.isHuman) this._newCardId = payload.card.id;
        this.render();
        if (this.mp) await this._mpAfterDecision(p, { t: 'draw', src: payload.source });
        if (p && !p.isHuman) { this.toast(`${p.name} drew from the ${payload.source === 'discard' ? 'discard pile' : 'deck'}`); await this.beat(BEAT_DRAW); }
        break;
      case 'discard':
        if (p && p.isHuman) this._newCardId = null;
        this.render();
        if (this.mp) await this._mpAfterDecision(p, { t: 'discard', cardId: payload.card.id });
        if (p && !p.isHuman) await this.beat(BEAT_DISCARD);
        break;
      case 'close':
        if (this.mp) await this._mpAfterDecision(p, { t: 'close', kind: true });
        this.toast(`${p.name} closed the round!`); this.render(); await this.beat(BEAT_CLOSE);
        break;
      case 'reset':
        this.toast('Deck reshuffled'); this.render();
        break;
      case 'roundScored':
        if (this.game.whoClosed === this._human().id) {
          this._matchCloses++;
          if (this.game.closeType === 'chinchon') this._matchChinchons++;
          else if (this.game.closeType === 'doubleMeld') this._matchMinusTens++;   // a -10 close (menos diez)
        }
        this._chartView = false;
        // Turn boundary: safe autosave point (see snapshot() doc comment). Never
        // save a CONCLUDED match: matchEnd is about to clear the save anyway, and
        // a crash in between would otherwise leave a restorable save for a match
        // that is over (whose restore would deal a phantom next round).
        if (this.mp && !payload.matchOver) this._mpSaveSnapshot();
        await this.showRoundModal();
        // Guest only: the next round's deck can't be dealt locally until the
        // host has shuffled it and published it (see the 'roundStart' hook).
        // Wait here so a guest who taps "Next round" before the host does
        // simply waits in place. Gate on payload.matchOver, NOT on
        // this.game.winner: the engine only decides a points/rounds ending
        // AFTER this emit, so winner is still null here on the final round -
        // gating on it deadlocked the guest ("Waiting for host", forever, no
        // stats recorded) at every normal match end (test-mp-lockstep.mjs C1).
        if (this.mp && this.mp.role === 'guest' && !payload.matchOver) await this._mpAwaitNextRound();
        break;
      case 'matchEnd':
        this._matchEnded = true;
        this._commitStats();
        this._chartView = false;
        if (this.mp) {
          this._mpClearSave();
          if (this.mp.role === 'host') {
            try { await net.writeResult(this.mp.code, { winnerId: this.game.winner.id, standings: this.game.standings.map((pl) => ({ id: pl.id, totalScore: pl.totalScore })) }); }
            catch { /* best-effort: the match already concluded locally either way */ }
          }
        }
        await this.showMatchModal();
        this._onChallengeMatchEnd(); // hidden challenge: reveal the code after the match modal
        break;
    }
  }

  beat(ms) {
    const scaled = this.mp && this.mp.replayMode ? ms * 0.25 : ms;
    return new Promise((resolve) => { this._beatTimer = setTimeout(resolve, scaled); });
  }

  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const human = this._human();
    this.stats.games += 1;
    if (this.game.winner && this.game.winner.id === human.id) this.stats.wins += 1; else this.stats.losses += 1;
    this.stats.closes += this._matchCloses || 0;
    this.stats.chinchons += this._matchChinchons || 0;
    this.stats.minusTen = (this.stats.minusTen | 0) + (this._matchMinusTens || 0);
    saveJSON(STORE_STATS, this.stats);
    // Also record into the unified Game Stats (per difficulty + close-quality counters), kept
    // alongside chinchon-stats.
    const opp0 = this.game.players.find((p) => !p.isHuman);
    const difficulty = (opp0 && opp0.difficulty) || (this._setup && this._setup.aiDifficulty && this._setup.aiDifficulty[0]) || 'normal';
    const won = !!(this.game.winner && this.game.winner.id === human.id);
    recordChinchon(difficulty, won, {
      closed: this._matchCloses || 0,
      minusTen: this._matchMinusTens || 0,
      chinchons: this._matchChinchons || 0,
    });
    // Multiplayer only: capture WHO this was against while the room state is still live. Solo play
    // has no `mp`, so it is untouched. Never allowed to block the result being recorded.
    const opp = this.mp && this.mp.opp;
    if (opp) { try { recordHeadToHead('chinchon', opp, won); } catch { /* never block the result */ } }
  }

  /** Hidden challenge: on a qualifying human match win (exactly 1 opponent at Average or
   *  higher), record the win and reveal the code. Inert unless the profile name matches. */
  _onChallengeMatchEnd() {
    try {
      if (!this.challengeLive) return;   // active AND not yet won
      const human = this._human();
      const humanWon = !!(this.game.winner && this.game.winner.id === human.id);
      const opps = this.game.players.filter((p) => !p.isHuman);
      const aiDifficulty = (opps[0] && opps[0].difficulty)
        || (this._setup && this._setup.aiDifficulty && this._setup.aiDifficulty[0]) || null;
      if (qualifyChinchon({ humanWon, opponentCount: opps.length, aiDifficulty })) {
        recordWin('chinchon');
        showCodeReveal(codeFor('chinchon'), 'Chinchón');
      }
    } catch { /* never break the game */ }
  }

  // --- rendering ------------------------------------------------------------

  _human() { return this.game.players.find((p) => p.isHuman); }

  render() {
    if (this._dead || !this.game || this.el.game.hidden) return;
    const nOpp = this.game.players.filter((p) => !p.isHuman).length;
    this.el.opponents.className = 'cc-opponents cc-opp-n' + nOpp;
    this.el.opponents.innerHTML = this.renderOpponents();
    this._syncPiles();
    this.el.status.innerHTML = this.renderStatus();
    this.el.self.innerHTML = this.renderSelf();
    this.el.handbar.innerHTML = this.renderHandbar();
    this._syncHand();
    this.el.actions.innerHTML = this.renderActions();
  }

  renderOpponents() {
    return this.game.players.filter((p) => !p.isHuman).map((p) => {
      const active = p.id === this.activePlayerId;
      return `<span class="cc-opp-pill ${active ? 'is-active' : ''}">
        <span class="cc-opp-av">${p.avatar}</span>
        <span class="cc-opp-name">${esc(p.name)}</span>
        <span class="cc-opp-score">${p.totalScore}</span>
      </span>`;
    }).join('');
  }

  /** One-time pile skeleton per game — the stock back <img> is created once and
      never rebuilt, so it can't flash. Only the discard's top card is swapped. */
  _buildPiles() {
    this.el.piles.innerHTML = `
      <button class="cc-pile cc-stock" data-action="draw-stock" disabled aria-label="Draw from deck">
        ${cardFaceHTML({}, { faceDown: true, static: true })}
        <span class="cc-pile-count" hidden></span>
        <span class="cc-pile-label">Deck</span>
      </button>
      <button class="cc-pile cc-discard" data-action="draw-discard" disabled aria-label="Take the discard">
        <div class="cc-card cc-empty"></div>
        <span class="cc-pile-label">Discard</span>
      </button>`;
    this._pilesEl = {
      stock: this.el.piles.querySelector('.cc-stock'),
      discard: this.el.piles.querySelector('.cc-discard'),
      count: this.el.piles.querySelector('.cc-pile-count'),
    };
    this._discTopKey = 'empty';
  }

  _syncPiles() {
    if (!this._pilesEl || !this.el.piles.contains(this._pilesEl.stock)) this._buildPiles();
    const g = this.game;
    const P = this._pilesEl;
    const drawMode = !!(this._pending && this._pending.kind === 'draw');
    P.stock.classList.toggle('is-actionable', drawMode);
    P.stock.disabled = !drawMode;
    P.discard.classList.toggle('is-actionable', drawMode);
    P.discard.disabled = !drawMode;
    if (g.config.showRemaining) { P.count.hidden = false; P.count.textContent = g.stock.length; }
    else P.count.hidden = true;
    this._setDiscardTop(g.discardTop());
  }

  /** Swap the discard's top card node only when the top card actually changes. */
  _setDiscardTop(top) {
    const P = this._pilesEl;
    const key = top ? (top.isJoker ? 'joker' : `${top.suit}-${top.rank}`) : 'empty';
    if (key === this._discTopKey) return;
    this._discTopKey = key;
    const node = this._cardNode(top || null, top ? { static: true } : null);
    P.discard.querySelector('.cc-card').replaceWith(node);
  }

  renderStatus() {
    const g = this.game;
    const pills = [
      `<span class="cc-pill">Round ${g.round}</span>`,
      `<span class="cc-pill">Resets ${g.resetsUsed}/${g.config.maxResets}</span>`,
    ];
    if (g.config.showRemaining) pills.push(`<span class="cc-pill">Deck ${g.stock.length}</span>`);
    return `<span class="cc-status-text">${esc(this.statusText())}</span><span class="cc-pills">${pills.join('')}</span>`;
  }

  statusText() {
    // A persistent MP status (Resyncing / Opponent disconnected / Opponent
    // left / Waiting for host) owns this reserved slot -- Chinchón has no
    // separate announce row (see the T4 handoff note), so it reuses the
    // existing status-text slot rather than adding new DOM.
    if (this._mpStatusMsg) return this._mpStatusMsg;
    if (this._pending) {
      // No draw prompt text: the glowing name chip + highlighted piles say it.
      if (this._pending.kind === 'discard') return '';
      if (this._pending.kind === 'close') return 'You can close! Close the round, or keep playing.';
    }
    const ap = this.activePlayerId != null ? this.game.byId(this.activePlayerId) : null;
    if (ap && !ap.isHuman) return `${ap.name} is playing…`;
    return '';
  }

  _setMpStatus(msg) { this._mpStatusMsg = msg; this.render(); }
  _clearMpStatus() { if (!this._mpStatusMsg) return; this._mpStatusMsg = ''; this.render(); }

  renderSelf() {
    const h = this._human();
    const active = this.activePlayerId === h.id || !!this._pending;
    return `<span class="cc-self-chip ${active ? 'is-active is-myturn' : ''}">
      <span class="cc-self-av">${h.avatar}</span>
      <span class="cc-self-name">${esc(h.name)}</span>
      <span class="cc-self-score">${h.totalScore} pts</span></span>`;
  }

  renderHandbar() {
    const sortLabel = this._sortMode === 'suit' ? 'by suit' : 'by rank';
    return `<button class="cc-tool cc-tool-icon" data-action="sort-cycle" title="Sorted ${sortLabel} — tap to cycle" aria-label="Sorted ${sortLabel}, tap to cycle">↕</button>
      <button class="cc-tool cc-tool-sm ${this._highlightSets ? 'is-on' : ''}" data-action="toggle-highlight" title="Highlight sets">Sets</button>`;
  }

  _computeHandOrder(hand) {
    if (this._manualOrder) {
      const byId = new Map(hand.map((c) => [c.id, c]));
      const kept = this._manualOrder.filter((id) => byId.has(id));
      const keptSet = new Set(kept);
      const added = hand.filter((c) => !keptSet.has(c.id)).map((c) => c.id);
      this._manualOrder = kept.concat(added);
      return this._manualOrder.map((id) => byId.get(id));
    }
    return sortHand(hand, this._sortMode);
  }

  /** Build one detached card element from cardFaceHTML (null -> empty slot). */
  _cardNode(card, opts) {
    const tpl = document.createElement('template');
    tpl.innerHTML = (card ? cardFaceHTML(card, opts || {}) : '<div class="cc-card cc-empty"></div>').trim();
    return tpl.content.firstElementChild;
  }

  /** Sync the hand in place: card nodes are keyed by id and REUSED across renders,
      so their <img> elements never reload (the old innerHTML rebuild made every
      action flash). Also inserts the 2-row break so the last 4 cards sit on the
      bottom row (7 cards -> 3 top / 4 bottom; 8 after a draw -> 4 / 4). */
  _syncHand() {
    const hand = this.el.hand;
    const h = this._human();
    const order = this._computeHandOrder(h.hand);
    this._displayOrder = order.map((c) => c.id);

    let colorOf = null;
    if (this._highlightSets) {
      const bp = meld.bestPartition(h.hand, this.game.config);
      colorOf = new Map();
      bp.melds.forEach((m, mi) => m.idx.forEach((i) => colorOf.set(h.hand[i].id, mi)));
    }

    const byId = new Map();
    for (const el of hand.querySelectorAll('.cc-card[data-drag]')) byId.set(el.dataset.drag, el);
    let brk = hand.querySelector('.cc-hand-break');
    if (!brk) { brk = document.createElement('div'); brk.className = 'cc-hand-break'; }

    const MELD_CLASSES = ['cc-meld-c0', 'cc-meld-c1', 'cc-meld-c2', 'cc-meld-c3', 'cc-meld-c4', 'cc-meld-c5'];
    const breakAt = Math.max(0, order.length - 4);
    const seq = [];
    order.forEach((c, i) => {
      if (i === breakAt && order.length > 4) seq.push(brk);
      let el = byId.get(c.id);
      if (!el) el = this._cardNode(c, { draggable: true });
      byId.delete(c.id);
      el.classList.toggle('is-selected', c.id === this._selectedCardId);
      el.classList.toggle('is-new', c.id === this._newCardId);
      for (const mc of MELD_CLASSES) el.classList.remove(mc);
      const inSet = !!(colorOf && colorOf.has(c.id));
      if (inSet) el.classList.add('cc-meld-c' + (colorOf.get(c.id) % 6));
      el.classList.toggle('is-dimmed', !!colorOf && !inSet);
      seq.push(el);
    });
    for (const el of byId.values()) el.remove();
    if (order.length <= 4 && brk.parentNode) brk.remove();
    // Appending an existing child moves it: order is applied without recreating nodes.
    seq.forEach((el) => hand.appendChild(el));
  }

  renderActions() {
    if (!this._pending) return '';
    if (this._pending.kind === 'discard') {
      const sel = this._selectedCardId;
      return `<button class="cc-btn cc-btn-primary" data-action="discard-confirm" ${sel ? '' : 'disabled'}>Discard${sel ? ' ' + esc(this._cardLabel(sel)) : ''}</button>`;
    }
    if (this._pending.kind === 'close') {
      return `<button class="cc-btn cc-btn-primary" data-action="close-yes">Close round ✓</button>
              <button class="cc-btn cc-btn-ghost" data-action="close-no">Keep playing</button>`;
    }
    // Draw phase intentionally shows no text — the glowing name chip and the
    // highlighted piles already signal "your turn; tap a pile".
    return '';
  }

  _cardLabel(id) {
    const c = this._human().hand.find((x) => x.id === id);
    if (!c) return '';
    if (c.isJoker) return 'Joker';
    return `${c.rank} ${SUIT_META[c.suit].label}`;
  }

  /** Delegated `input` listener (mirrors the click delegation): the join-code
   *  field auto-uppercases, filters to the code alphabet, and submits itself
   *  once a full code is typed. A prior error's TEXT clears the moment the
   *  player edits the code (the code itself is never cleared by a failed
   *  attempt); done via a targeted DOM patch rather than a full renderSetup()
   *  so the input never loses focus/caret mid-keystroke. */
  onInput(e) {
    const el = e.target;
    if (!(el && el.dataset && el.dataset.role === 'mp-code-input')) return;
    const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
    if (clean !== el.value) el.value = clean;
    this._mpJoinCode = clean;
    if (this._mpError) { this._mpError = ''; this._syncMpMsgSlot(); }
    if (clean.length === MP_CODE_LEN) this._mpJoinSubmit();
  }

  /** Patches the reserved message slot in place (see onInput above). Handles
   *  both renderings that can occupy it: the plain <p> and the version-error
   *  <button> (mp-update-required) -- always replaced with an empty/busy <p>. */
  _syncMpMsgSlot() {
    if (!this.el || !this.el.setup) return;
    const slot = this.el.setup.querySelector('.cc-mp-msg');
    if (!slot) return;
    slot.outerHTML = `<p class="cc-mp-msg" data-role="mp-msg">${esc(this._mpError || (this._mpBusy ? 'Joining…' : ''))}</p>`;
  }

  // --- hand drag-to-reorder (pointer events) --------------------------------

  onHandPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cardEl = e.target.closest('.cc-card[data-drag]');
    if (!cardEl || !this.el.hand.contains(cardEl)) return;
    this._justDragged = false;
    this._drag = { id: cardEl.dataset.drag, el: cardEl, x0: e.clientX, y0: e.clientY, moved: false, targetIndex: -1 };
    document.addEventListener('pointermove', this._onPointerMove, { passive: false });
    document.addEventListener('pointerup', this._onPointerUp);
    document.addEventListener('pointercancel', this._onPointerUp);
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 8) return;   // still a tap, not a drag
      d.moved = true;
      d.el.classList.add('is-dragging');
    }
    e.preventDefault();
    d.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    const over = this._canDropDiscard() && this._overDiscard(e.clientX, e.clientY);
    if (over !== d.overDiscard) {
      d.overDiscard = over;
      d.el.classList.toggle('is-over-discard', over);
      if (this._pilesEl) this._pilesEl.discard.classList.toggle('is-droptarget', over);
    }
    d.targetIndex = over ? -1 : this._dropIndex(e.clientX, e.clientY, d.id);
  }

  onPointerUp() {
    const d = this._drag;
    this._drag = null;
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointercancel', this._onPointerUp);
    if (!d) return;
    // Nodes persist across renders now, so drag styling must be cleared by hand.
    d.el.classList.remove('is-dragging', 'is-over-discard');
    d.el.style.transform = '';
    if (this._pilesEl) this._pilesEl.discard.classList.remove('is-droptarget');
    if (!d.moved) return;
    this._justDragged = true;        // swallow the click that follows a drag
    if (d.overDiscard && this._canDropDiscard()) { this._resolvePending(d.id); return; }
    this._applyDrop(d.id, d.targetIndex);
    this.render();
  }

  /** Dropping on the discard is only a discard while the engine awaits one. */
  _canDropDiscard() { return !!(this._pending && this._pending.kind === 'discard'); }

  /** Pointer within the discard pile (small padding for fat fingers). */
  _overDiscard(x, y) {
    if (!this._pilesEl) return false;
    const r = this._pilesEl.discard.getBoundingClientRect();
    const pad = 10;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  /** Insertion index for the pointer among the non-dragged hand cards (row-aware). */
  _dropIndex(x, y, dragId) {
    const cards = [...this.el.hand.querySelectorAll('.cc-card[data-drag]')].filter((el) => el.dataset.drag !== dragId);
    let idx = 0;
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rowTol = r.height * 0.5;
      if (cy < y - rowTol || (Math.abs(cy - y) <= rowTol && cx < x)) idx++;
    }
    return idx;
  }

  _applyDrop(id, idx) {
    const without = this._displayOrder.filter((x) => x !== id);
    without.splice(Math.max(0, Math.min(idx, without.length)), 0, id);
    this._manualOrder = without;
  }

  // --- modals ---------------------------------------------------------------

  showRoundModal() {
    return new Promise((resolve) => { this._modalResolve = resolve; this._renderRoundModal(); });
  }

  _renderRoundModal() {
    const g = this.game;
    const closer = g.whoClosed != null ? g.byId(g.whoClosed) : null;
    const title = closer ? `${esc(closer.name)} closed the round` : 'Deck exhausted';
    const cat = closer && closer.closeInfo ? closer.closeInfo.category : null;
    const isChinchon = cat === 'chinchon';
    const sub = cat === 'doubleMeld' ? 'Double meld' : cat === 'sixAndOne' ? 'Six and one' : '';
    const banner = isChinchon ? this._chinchonBanner() : '';
    let body;
    if (this._chartView) {
      body = this.renderChartBlock();
    } else {
      const rows = g.players.map((p) => {
        const placed = p.placed && p.placed.length ? ` <span class="cc-placed">laid off ${p.placed.length}</span>` : '';
        return `<tr class="${closer && p.id === closer.id ? 'is-closer' : ''}">
          <td>${p.avatar} ${esc(p.name)}${placed}</td>
          <td class="num">${this._sign(p.roundScore)}</td>
          <td class="num">${p.totalScore}</td></tr>`;
      }).join('');
      const bonusLine = closer ? this._bonusLine(closer) : '';
      const breakdown = closer ? this._closerBreakdown(closer) : '';
      body = `<table class="cc-score"><thead><tr><th>Player</th><th class="num">Round</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>${bonusLine}${breakdown}`;
    }
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
      ${banner}
      <h2 class="cc-sheet-title">${title}</h2>
      ${sub ? `<p class="cc-sheet-sub">${sub}</p>` : ''}
      ${body}
      <div class="cc-sheet-actions">
        <button class="cc-btn cc-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Scores' : '📈 Scoreboard'}</button>
        <button class="cc-btn cc-btn-primary" data-action="next-round">Next round</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  /** Large, unmissable banner leading a round/match summary won via chinchón. */
  _chinchonBanner() {
    return `<div class="cc-chinchon-banner">
      <div class="cc-chinchon-headline">¡CHINCHÓN!</div>
      <p class="cc-chinchon-sub">Seven cards in a single run. Round won instantly.</p>
    </div>`;
  }

  /** Explicit labeled line for a closer's scoring bonus (chinchón or all-cards-melded).
      Always reads the value the engine actually recorded, never a hardcoded number. */
  _bonusLine(closer) {
    const info = closer.closeInfo;
    if (!info) return '';
    if (info.category === 'chinchon') return `<p class="cc-bonus-line">Chinchón bonus: ${this._sign(info.score)}</p>`;
    if (info.category === 'doubleMeld') return `<p class="cc-bonus-line">All cards melded: ${this._sign(info.score)}</p>`;
    return '';
  }

  _closerBreakdown(closer) {
    if (!closer.closeInfo || !closer.closeInfo.partition) return '';
    const cfg = this.game.config;
    const bp = meld.bestPartition(closer.hand, cfg);
    const meldedIdx = new Set();
    bp.melds.forEach((m) => m.idx.forEach((i) => meldedIdx.add(i)));
    const groups = bp.melds.map((m) =>
      `<span class="cc-meld-group">${m.idx.map((i) => cardFaceHTML(closer.hand[i], { static: true, mini: true, melded: true })).join('')}</span>`).join('');
    const leftover = closer.hand.map((c, i) => meldedIdx.has(i) ? '' : cardFaceHTML(c, { static: true, mini: true, dead: true })).join('');
    return `<div class="cc-breakdown"><span class="cc-breakdown-label">${esc(closer.name)}'s hand</span>
      <div class="cc-breakdown-cards">${groups}${leftover ? `<span class="cc-meld-group cc-leftover">${leftover}</span>` : ''}</div></div>`;
  }

  showMatchModal() {
    return new Promise((resolve) => { this._matchResolve = resolve; this._renderMatchModal(); resolve(); });
  }

  _renderMatchModal() {
    const g = this.game;
    const standings = g.standings || g.players;
    const winner = g.winner;
    const isChinchonWin = g.matchEndReason === 'chinchon';
    const reason = isChinchonWin ? ' with a Chinchón' : '';
    const banner = isChinchonWin ? this._chinchonBanner() : '';
    let body;
    if (this._chartView) {
      body = this.renderChartBlock();
    } else {
      body = `<ol class="cc-standings">${standings.map((p, i) => `<li class="${p === winner ? 'is-winner' : ''}">
        <span class="cc-rank">${i + 1}</span><span>${p.avatar} ${esc(p.name)}</span><span class="num">${p.totalScore}</span></li>`).join('')}</ol>`;
    }
    const humanWon = winner && winner.id === this._human().id;
    const betty = (!this._chartView && this._setup.deck === 'anita')
      ? `<div class="cc-betty is-${humanWon ? 'win' : 'loss'}">
          <img class="cc-betty-img" src="${anitaImgUrl(humanWon ? 'betty-win.webp' : 'betty-loss.webp')}" alt="" draggable="false">
          <p class="cc-betty-cap">${humanWon ? 'Betty approves 😎' : 'Betty is not impressed.'}</p>
        </div>`
      : '';
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
      ${banner}
      <h2 class="cc-sheet-title">${winner.avatar} ${esc(winner.name)} wins${reason}!</h2>
      ${betty}
      ${body}
      <div class="cc-sheet-actions">
        <button class="cc-btn cc-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Standings' : '📈 Scoreboard'}</button>
        <button class="cc-btn cc-btn-primary" data-action="new-game">${this.challengeLive ? 'Retry Challenge' : 'New game'}</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  /** Inline SVG line chart of cumulative score per round, per player. */
  renderChartBlock() {
    const g = this.game;
    const players = g.players;
    const W = 440, H = 210, padL = 30, padR = 12, padT = 12, padB = 22;
    const maxRound = Math.max(1, players[0].scoreHistory.length - 1);
    const cap = g.config.scoreLimit;
    const maxHist = Math.max(...players.flatMap((p) => p.scoreHistory), 10);
    const domainMax = Math.max(cap, maxHist);
    const x = (r) => padL + (W - padL - padR) * (r / maxRound);
    const y = (v) => padT + (H - padT - padB) * (1 - v / domainMax);

    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const gy = padT + (H - padT - padB) * f;
      return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="cc-grid"/>`;
    }).join('');
    const capLine = (cap <= domainMax)
      ? `<line x1="${padL}" y1="${y(cap).toFixed(1)}" x2="${W - padR}" y2="${y(cap).toFixed(1)}" class="cc-caprule"/><text x="${W - padR}" y="${(y(cap) - 3).toFixed(1)}" class="cc-axis" text-anchor="end">limit ${cap}</text>`
      : '';
    const yLabels = `<text x="${padL - 4}" y="${(y(0) + 3).toFixed(1)}" class="cc-axis" text-anchor="end">0</text>
      <text x="${padL - 4}" y="${(y(domainMax) + 8).toFixed(1)}" class="cc-axis" text-anchor="end">${domainMax}</text>`;
    const xLabels = `<text x="${padL}" y="${H - 6}" class="cc-axis" text-anchor="start">R0</text>
      <text x="${W - padR}" y="${H - 6}" class="cc-axis" text-anchor="end">R${maxRound}</text>`;

    const lines = players.map((p, idx) => {
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const pts = p.scoreHistory.map((s, r) => `${x(r).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
      const dots = p.scoreHistory.map((s, r) => `<circle cx="${x(r).toFixed(1)}" cy="${y(s).toFixed(1)}" r="2.6" fill="${color}"/>`).join('');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>${dots}`;
    }).join('');

    const legend = players.map((p, idx) =>
      `<span class="cc-legend-item"><span class="cc-legend-dot" style="background:${PLAYER_COLORS[idx % PLAYER_COLORS.length]}"></span>${p.avatar} ${esc(p.name)} · ${p.totalScore}</span>`).join('');

    return `<div class="cc-chart">
      <svg viewBox="0 0 ${W} ${H}" class="cc-chart-svg" role="img" aria-label="Cumulative score by round">
        ${grid}${capLine}${yLabels}${xLabels}${lines}
      </svg>
      <div class="cc-legend">${legend}</div>
    </div>`;
  }

  _resolveModal() {
    if (!this._modalResolve) return;
    const r = this._modalResolve;
    this._modalResolve = null;
    if (this.el && this.el.modal) { this.el.modal.hidden = true; this.el.modal.innerHTML = ''; }
    r();
  }

  _sign(n) { return n > 0 ? `+${n}` : `${n}`; }

  // --- toast ----------------------------------------------------------------

  toast(msg) {
    if (this._dead || !this.el || !this.el.toast) return;
    this.el.toast.textContent = msg;
    this.el.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { if (this.el && this.el.toast) this.el.toast.hidden = true; }, 1600);
  }

  /** Confetti burst — a short, self-contained celebration (no libraries). */
  _celebrate() {
    if (this._dead || !this.root) return;
    const layer = document.createElement('div');
    layer.className = 'cc-confetti';
    const colors = ['#f7b500', '#ff5c4d', '#2878ff', '#22a84f', '#ffd84d', '#ff8ad0'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      const left = Math.round((i / 70) * 100);           // spread across, seed-free
      const hue = colors[i % colors.length];
      const delay = (i % 10) * 30;
      const dur = 1100 + (i % 7) * 130;
      const drift = ((i % 11) - 5) * 14;
      p.style.cssText = `left:${left}%;background:${hue};animation-delay:${delay}ms;animation-duration:${dur}ms;--drift:${drift}px`;
      layer.appendChild(p);
    }
    this.root.appendChild(layer);
    setTimeout(() => layer.remove(), 2400);
  }

  // --- input ----------------------------------------------------------------

  onClick(e) {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    const pend = this._pending;
    switch (act) {
      // setup
      case 'set-count': this.syncSetupInputs(); this._setup.count = +a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'open-avatar': this.syncSetupInputs(); this._openAvatarPicker(); break;
      case 'pick-avatar': this._setup.humanAvatar = a.dataset.v; this._saveSetup(); this._closeAvatarPicker(); this.renderSetup(); break;
      case 'close-avatar': this._closeAvatarPicker(); break;
      case 'pick-deck': {
        const wasOther = this._setup.deck !== a.dataset.v;
        this._setup.deck = a.dataset.v; setDeck(a.dataset.v); preloadDeck();
        this._saveSetup(); this.renderSetup();
        // Reward picking the Ana Banana deck with a little celebration.
        if (a.dataset.v === 'anita' && wasOther) { this._celebrate(); this.toast('Nice choice! 🎉'); }
        break;
      }
      case 'toggle-theme':
        if (!this.el.setup.hidden) this.syncSetupInputs();
        this._setup.dark = !this._setup.dark;
        this._applyTheme(); this._saveSetup();
        if (!this.el.menu.hidden) this._renderMenu();
        if (!this.el.setup.hidden) this.renderSetup();
        break;
      case 'close-gallery': this._closeCardZoom(); this._closeGalleryModal(); break;
      case 'view-deck': this._openDeckGallery(a.dataset.v); break;
      case 'zoom-card': this._openCardZoom(a.dataset.deck, a.dataset.name); break;
      case 'close-zoom': this._closeCardZoom(); break;
      case 'set-aidiff': { this.syncSetupInputs(); const i = +a.closest('.cc-segmented').dataset.i; this._setup.aiDifficulty[i] = a.dataset.v; this._saveSetup(); this.renderSetup(); break; }
      case 'toggle-row': { this.syncSetupInputs(); const row = a.dataset.row; this._setupExpanded = this._setupExpanded === row ? null : row; this.renderSetup(); break; }
      case 'rule-victory': this.syncSetupInputs(); this._setup.config.victoryCondition = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-maxclose': this.syncSetupInputs(); this._setup.config.maxClose = +a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-figures': this.syncSetupInputs(); this._setup.config.figuresFaceValue = a.dataset.v === 'own'; this._saveSetup(); this.renderSetup(); break;
      case 'rule-place': this.syncSetupInputs(); this._setup.config.placeOnEnding = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-toggle': this.syncSetupInputs(); this._setup.config[a.dataset.field] = !this._setup.config[a.dataset.field]; this._saveSetup(); this.renderSetup(); break;
      case 'rule-step': this.syncSetupInputs(); this._stepRule(a.dataset.field, +a.dataset.d); this._saveSetup(); this.renderSetup(); break;
      case 'start': this.startGame(); break;
      // multiplayer lobby (M2b)
      case 'set-mode': this.syncSetupInputs(); this._setup.mode = a.dataset.v; this._setupExpanded = null; this._mpError = ''; this._saveSetup(); this.renderSetup(); break;
      case 'mp-host': this.syncSetupInputs(); this._screen = 'host-lobby'; this._mpError = ''; this.renderSetup(); this._mpHostCreate(); break;
      case 'mp-join-submit': this._mpJoinSubmit(); break;
      case 'mp-start': this._mpHostStart(); break;
      case 'mp-cancel': this._mpCancelLobby(); break;
      case 'mp-update-required': this._mpForceUpdate(); break;
      case 'mp-error-ok': this.showSetup(); break;
      // game
      case 'draw-stock': if (pend && pend.kind === 'draw') this._resolvePending('stock'); break;
      case 'draw-discard': if (pend && pend.kind === 'draw') this._resolvePending('discard'); break;
      case 'card':
        if (this._justDragged) { this._justDragged = false; break; }
        this.onCardTap(a.dataset.id); break;
      case 'sort-cycle': this._sortMode = this._sortMode === 'suit' ? 'rank' : 'suit'; this._manualOrder = null; this.render(); break;
      case 'toggle-highlight': this._highlightSets = !this._highlightSets; this.render(); break;
      case 'discard-confirm': if (pend && pend.kind === 'discard' && this._selectedCardId) this._resolvePending(this._selectedCardId); break;
      case 'close-yes': if (pend && pend.kind === 'close') this._resolvePending(true); break;
      case 'close-no': if (pend && pend.kind === 'close') this._resolvePending(false); break;
      case 'place-all': this._resolvePlace(this._placeIds || []); break;
      case 'place-skip': this._resolvePlace([]); break;
      case 'toggle-chart': this._chartView = !this._chartView; if (this._modalResolve) this._renderRoundModal(); else this._renderMatchModal(); break;
      case 'next-round': this._resolveModal(); break;
      case 'new-game': if (this.mp) this._mpLeaveToSetup(); else this.showSetup(); break;
      // in-game menu
      case 'open-menu': this._openMenu(); break;
      case 'close-menu': case 'menu-resume': this._closeMenu(); break;
      case 'menu-newgame': this._menuAction('newgame'); break;
      case 'menu-quit': this._menuAction('quit'); break;
    }
  }

  // --- in-game menu ---------------------------------------------------------

  /** A live match worth confirming before abandoning. */
  _inProgress() {
    return !!this.game && !this.el.game.hidden && !this._matchEnded;
  }

  _openMenu() { this._menuConfirm = null; this._renderMenu(); this.el.menu.hidden = false; }
  _closeMenu() { this.el.menu.hidden = true; this._menuConfirm = null; }

  _renderMenu() {
    const btn = (which, label) => {
      const confirming = this._menuConfirm === which;
      return `<button class="cc-btn cc-btn-ghost ${confirming ? 'cc-confirm' : ''}" data-action="menu-${which}">${
        confirming ? 'Tap again — you’ll lose this game' : label}</button>`;
    };
    this.el.menu.innerHTML = `<div class="cc-scrim" data-action="close-menu"></div>
      <div class="cc-sheet cc-menu-sheet">
        <h2 class="cc-sheet-title">Menu</h2>
        <button class="cc-btn cc-btn-ghost" data-action="toggle-theme">${this._setup.dark ? '☀️ Light mode' : '🌙 Dark mode'}</button>
        ${btn('newgame', this.mp ? 'Leave match' : 'New game (same settings)')}
        ${this.mp ? '' : btn('quit', 'Quit to setup')}
        <button class="cc-btn cc-btn-primary" data-action="menu-resume">Resume game</button>
      </div>`;
  }

  /** Destructive menu actions confirm-on-second-tap while a match is live.
   *  In MP either action leaves the match (there is no "same settings"
   *  restart -- rehosting isn't automatic), which also ends the room for
   *  the opponent, unlike backgrounding (destroy()), which preserves it. */
  _menuAction(which) {
    if (this._inProgress() && this._menuConfirm !== which) {
      this._menuConfirm = which;
      this._renderMenu();
      return;
    }
    this._closeMenu();
    if (this.mp) { this._mpLeaveToSetup(); return; }
    if (which === 'newgame') this.startGame();
    else this.showSetup();
  }

  _stepRule(field, d) {
    const c = this._setup.config;
    if (field === 'scoreLimit') c.scoreLimit = clamp(c.scoreLimit + d * 10, 20, 300);
    else if (field === 'roundsLimit') c.roundsLimit = clamp(c.roundsLimit + d, 1, 30);
    else if (field === 'maxResets') c.maxResets = clamp(c.maxResets + d, 0, 6);
  }

  onCardTap(id) {
    if (!this._pending || this._pending.kind !== 'discard') return;
    if (this._selectedCardId === id) { this._resolvePending(id); return; } // second tap confirms
    this._selectedCardId = id;
    this.render();
  }

  // --- multiplayer (M2b) -------------------------------------------------------
  // Everything below is reached only through this.mp -- null for the entire
  // life of a solo match, so none of it runs a single line in solo play.

  _myIdentity() {
    return { name: this._setup.humanName || 'You', avatar: this._setup.humanAvatar, deviceId: deviceId() };
  }

  /** The remote seat, unambiguous in a 2-player MP match: whichever player
   *  isn't the local human. Used where an agent callback needs "the player
   *  object" but isn't itself passed one (RemoteAgent's decideClose). */
  _remotePlayer() { return this.game.players.find((p) => !p.isHuman); }

  _mpNewState(role, code, opp) {
    return {
      role, code,
      // Who we are playing, `{ name, avatar, deviceId }` from the room (js/net.js). This was
      // accepted as a parameter and then discarded, so every multiplayer match forgot its
      // opponent the moment it ended; _commitStats now records it. Null on the restore path,
      // where _mpOnRoomUpdate backfills it from the live room.
      opp: opp || null,
      appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
      pendingResolve: null, pendingType: null, pendingSeq: null, pendingHash: null,
      replayMode: false, recoveryAttempts: 0,
      opponentLeft: false, lastRoomSnapshot: null,
      lastRecoveryHandled: null, lastRecoveryApplied: null,
      awaitingRoundN: null, awaitingRoundResolve: null,
      awaitingStockReset: null,
    };
  }

  /** Manual lay-off prompts every non-closer for a choice mid-scoring; M2b's
   *  move protocol doesn't sync that decision (out of scope -- the T1
   *  move-type list is draw/discard/close/stock-reset only), so MP coerces
   *  'manual' to 'auto' (same net effect on the hand, no prompt needed). */
  _mpBuildConfig(cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg);
    if (c.placeOnEnding === 'manual') c.placeOnEnding = 'auto';
    return c;
  }

  /** Same agent interface as AIAgent/humanAgent: each method returns a
   *  promise the engine awaits, resolved from the network instead of a tap
   *  or a heuristic. choosePlacements is never actually exercised (manual
   *  placement is coerced away for MP, see _mpBuildConfig) but is defined
   *  defensively so a stale/edge-case config can never hit a missing method. */
  _makeRemoteAgent() {
    const ui = this;
    return {
      isHuman: false,
      chooseDraw() { return ui._mpAwaitDecisionValue('draw'); },
      chooseDiscard() { return ui._mpAwaitDecisionValue('discard'); },
      async decideClose() {
        const kind = await ui._mpAwaitDecisionValue('close');
        // A DECLINED close has no engine event to hook (playTurn() just
        // returns false with no state change) -- verify immediately, since
        // no mutation is coming for this decision either.
        if (!kind) await ui._mpAfterDecision(ui._remotePlayer(), null);
        return kind;
      },
      async choosePlacements(view, locked, attachable) { return attachable.map((c) => c.id); },
    };
  }

  /** If a RemoteAgent method is currently awaiting AND the next entry in the
   *  cached log matches, resolve it. A no-op otherwise (the next room update,
   *  or the next call from the engine, will retry) -- single-slot re-entrancy
   *  guard, mirroring Escoba's _mpTryDeliverNextMove. Also greedily consumes
   *  any LEADING 'stock-reset' entries first: those need no agent decision at
   *  all (see tryResetStock()'s doc comment in game.js), just an append to
   *  config.presetStockResets before the log can be seen as "caught up". */
  _mpTryDeliverNextMove() {
    const mp = this.mp;
    if (!mp || !mp.movesById) return;
    while (true) {
      const seq = mp.appliedSeq + 1;
      const entry = mp.movesById.get(seq);
      if (!entry || entry.move.t !== 'stock-reset') break;
      this.game.config.presetStockResets = (this.game.config.presetStockResets || []).concat([entry.move.order]);
      mp.appliedSeq = seq;
      if (mp.awaitingStockReset) { const r = mp.awaitingStockReset; mp.awaitingStockReset = null; this._clearMpStatus(); r(); }
    }
    if (!mp.pendingResolve) return;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry) return;
    const resolve = mp.pendingResolve;
    mp.pendingResolve = null; mp.pendingType = null;
    mp.pendingSeq = seq;
    mp.pendingHash = entry.h;
    const m = entry.move;
    resolve(m.t === 'draw' ? m.src : m.t === 'discard' ? m.cardId : !!m.kind);
  }

  _mpAwaitDecisionValue(expectedType) {
    return new Promise((resolve) => {
      this.mp.pendingResolve = resolve;
      this.mp.pendingType = expectedType;
      this._mpTryDeliverNextMove();   // the move may already be cached from a prior room update
    });
  }

  /** Guest-only: block right before the engine's own tryResetStock() call
   *  (hooked from 'turnStart', which fires before it) until the host's
   *  reported reset order has arrived and been queued into
   *  config.presetStockResets -- otherwise the guest's own tryResetStock()
   *  would fall through to a local, non-deterministic shuffle. */
  _mpAwaitStockReset() {
    const mp = this.mp;
    if (this.game.stock.length > 0 || this.game.resetsUsed >= this.game.config.maxResets) return Promise.resolve();
    // presetStockResets is a QUEUE the engine shift()-consumes (see
    // tryResetStock() in game.js): any queued entry IS the next reset, so
    // proceed when one is waiting. This used to compare against the per-round
    // resetsUsed counter, which read leftover round-1 entries as "round 2's
    // reset already arrived" and skipped the wait (test-mp-lockstep.mjs C2b).
    const have = (this.game.config.presetStockResets || []).length;
    if (have > 0) return Promise.resolve();
    this._setMpStatus('Waiting for host');
    return new Promise((resolve) => { mp.awaitingStockReset = resolve; });
  }

  /** Called after every applied draw/discard/close decision in MP (and,
   *  directly, after a declined close, which has no engine event). `p` is
   *  whoever's decision it was, BY SEAT (Chinchón's own _human() already
   *  resolves by isHuman flag, not index, so this needs no seat-index fix):
   *  p.isHuman means it was made by this device's own local human via the
   *  ordinary humanAgent, so it needs sending; otherwise it just arrived
   *  from the peer via RemoteAgent and needs hash verification. */
  async _mpAfterDecision(p, moveIfLocal) {
    const mp = this.mp;
    if (!mp) return;
    if (p.isHuman) {
      // Reserve the seq SYNCHRONOUSLY, not after the network await: the
      // synchronous onStockReset hook (see _mpSendStockReset) can otherwise
      // race a subsequent awaited send and collide on the same seq number.
      const seq = ++mp.appliedSeq;
      const hash = stateHash(this.game);
      net.appendMove(mp.code, mp.role, seq, moveIfLocal, hash).catch(() => { this._setMpStatus('Connection error'); });
      return;
    }
    const expectedSeq = mp.pendingSeq, expectedHash = mp.pendingHash;
    mp.pendingSeq = null; mp.pendingHash = null;
    if (expectedSeq == null) return;
    const hash = stateHash(this.game);
    if (hash === expectedHash) {
      mp.appliedSeq = expectedSeq;
      mp.recoveryAttempts = 0;
      if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
      return;
    }
    await this._mpHandleMismatch(expectedSeq);
  }

  /** Host's onStockReset hook (config.onStockReset, wired in _mpHostStart):
   *  fires SYNCHRONOUSLY inside tryResetStock(), so this reserves its seq
   *  the same synchronous way _mpAfterDecision's send branch does, then
   *  fires the network write in the background. */
  _mpSendStockReset(order) {
    const mp = this.mp;
    if (!mp) return;
    const seq = ++mp.appliedSeq;
    const hash = stateHash(this.game);
    net.appendMove(mp.code, mp.role, seq, { t: 'stock-reset', order }, hash).catch(() => { this._setMpStatus('Connection error'); });
  }

  /** Desync: guest can only flag it (host is authoritative in M2b, matching
   *  M1's Escoba protocol); host rebuilds a snapshot for the guest either
   *  way. Three consecutive failed attempts end the match. */
  async _mpHandleMismatch(seq) {
    const mp = this.mp;
    if (!mp) return;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { await this._mpEndDueToError(); return; }
    this._setMpStatus('Resyncing');
    try {
      if (mp.role === 'host') await net.writeRecovery(mp.code, mp.appliedSeq, this.game.snapshot());
      else await net.requestRecovery(mp.code, seq);
    } catch { /* the next room update (heartbeat-driven) retries this naturally */ }
  }

  /** Guest side of a resync: rebuild via Game.fromSnapshot (the same
   *  turn-boundary resume path T5's autosave/restore uses) with MP agents
   *  instead of AI.
   *
   *  Seat mapping: the snapshot's isHuman flags are the SENDER's (host's)
   *  perspective. isHuman is device-RELATIVE - it decides which seat prompts
   *  locally and which seat sends vs verifies in _mpAfterDecision - so the
   *  flags must be remapped by SEAT (host is always id 0, guest id 1, fixed
   *  at match start) and normalized before rebuilding. Trusting the
   *  transmitted flags handed this device's human agent to the HOST's seat
   *  and a RemoteAgent to its own (test-mp-lockstep.mjs C3/E3), leaving the
   *  recovered player prompted for the opponent's cards while their own
   *  turns waited on the network forever. */
  _mpApplyRecovery(recovery) {
    const mp = this.mp;
    if (!mp || this._dead) return;
    const snap = recovery.state;
    const mySeat = mp.role === 'host' ? 0 : 1;
    const agentsById = {};
    for (const sp of snap.players) {
      sp.isHuman = sp.id === mySeat;
      agentsById[sp.id] = sp.isHuman ? this.humanAgent : this._makeRemoteAgent();
    }
    if (this.game) this.game.abort();
    this._resolvePending(null); this._resolvePlace([]); this._resolveModal();
    this.game = Game.fromSnapshot(snap, agentsById);
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this._newCardId = null; this.activePlayerId = null;
    this._matchEnded = false; this._closeMenu();
    mp.appliedSeq = recovery.seq;
    mp.pendingResolve = null; mp.pendingType = null; mp.pendingSeq = null; mp.pendingHash = null;
    mp.replayMode = false; mp.recoveryAttempts = 0;
    this._clearMpStatus();
    net.clearRecovery(mp.code).catch(() => {});
    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this._buildPiles();
    this.render();
    const start = () => {
      if (this._dead) return;
      this.game.playMatch().catch((err) => { if (!this._dead) console.error('Chinchón MP recovery error', err); });
    };
    // A round-BOUNDARY snapshot (midRound:false - e.g. the host answered while its
    // round modal was open) resumes with the NEXT round, whose deck must come from
    // the host's round record first - same gate the live 'roundScored' hook uses.
    // Without it the guest would deal a locally-shuffled round and desync again.
    if (!snap.midRound && mp.role === 'guest') this._mpAwaitNextRound().then(start);
    else start();
  }

  /** Guest-only: block the engine's own round transition until the host's
   *  freshly-shuffled deck for the next round has arrived (see the
   *  'roundStart'/'roundScored' hooks in onEvent). */
  _mpAwaitNextRound() {
    const mp = this.mp;
    const targetRound = this.game.round + 1;
    const room = mp.lastRoomSnapshot;
    if (room && room.round && room.round.n === targetRound) {
      this.game.config.presetDeck = room.round.deck;
      return Promise.resolve();
    }
    this._setMpStatus('Waiting for host');
    return new Promise((resolve) => { mp.awaitingRoundN = targetRound; mp.awaitingRoundResolve = resolve; });
  }

  async _mpEndDueToError() {
    if (this._dead || this._matchEnded) return;
    if (this.game) this.game.abort();
    this._matchEnded = true;
    this._chartView = false;
    this._mpClearSave();
    const mp = this.mp;
    this.mp = null;
    if (mp && mp.code) { try { await net.leaveRoom(mp.code, mp.role); } catch { /* best-effort */ } }
    else net.disconnect();
    this.render();
    this._renderMpErrorModal();
  }

  _mpEndDueToOpponentLeft() {
    if (this._dead || this._matchEnded) return;
    if (this.game) this.game.abort();
    this._matchEnded = true;
    this._chartView = false;
    this._mpClearSave();
    net.stopHeartbeat();
    this.render();
    this._renderMpOpponentLeftModal();
  }

  _renderMpErrorModal() {
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
      <h2 class="cc-sheet-title">Connection error</h2>
      <p class="cc-sheet-sub">The match could not stay in sync</p>
      <div class="cc-sheet-actions">
        <button class="cc-btn cc-btn-primary" data-action="mp-error-ok">Back to setup</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  _renderMpOpponentLeftModal() {
    const standings = this.game.players.slice().sort((a, b) => b.totalScore - a.totalScore);
    const rows = standings.map((p, i) => `<li><span class="cc-rank">${i + 1}</span><span>${p.avatar} ${esc(p.name)}</span><span class="num">${p.totalScore}</span></li>`).join('');
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
      <h2 class="cc-sheet-title">Opponent left</h2>
      <p class="cc-sheet-sub">Final standings</p>
      <ol class="cc-standings">${rows}</ol>
      <div class="cc-sheet-actions">
        <button class="cc-btn cc-btn-primary" data-action="mp-error-ok">Back to setup</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  /** The one room subscription for this device's whole MP session (lobby
   *  through match end): net.js allows exactly one at a time. */
  _mpRoomCallback(room) {
    if (this._dead) return;
    this._mpLobbyRoom = room;
    if (this.mp) { this._mpOnRoomUpdate(room); return; }
    if (this._screen === 'host-lobby' || this._screen === 'join-lobby') this.renderSetup();
    if (this._screen === 'join-lobby' && this._mpJoinedCode && room && room.status === 'active' && room.round) {
      this._mpGuestStartMatch(room);
    }
  }

  async _mpOnRoomUpdate(room) {
    if (this._dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    // Keep the opponent's identity current from the live room (and fill it in at all on the
    // restore/rejoin path, which starts with none). Only overwritten while the other side is
    // actually present, so a mid-match departure leaves the last known identity intact.
    const other = mp.role === 'host' ? room.guest : room.host;
    if (other && other.deviceId) mp.opp = other;

    // An abandon (leaveRoom) sets status:'ended' with no result; a natural
    // conclusion (writeResult) sets both together -- result == null is what
    // tells the two apart, since matchEnd may not have reached this device
    // yet even when it concluded normally.
    if (room.status === 'ended' && room.result == null && !mp.opponentLeft && !this._matchEnded) {
      mp.opponentLeft = true;
      this._setMpStatus('Opponent left');
      this._mpEndDueToOpponentLeft();
      return;
    }

    const oppKey = mp.role === 'host' ? 'guest' : 'host';
    const opp = room[oppKey];
    if (opp && !mp.opponentLeft) {
      const stale = (Date.now() - (opp.lastSeen || 0)) > MP_STALE_MS;
      if (stale && this._mpStatusMsg !== 'Opponent disconnected') this._setMpStatus('Opponent disconnected');
      else if (!stale && this._mpStatusMsg === 'Opponent disconnected') this._clearMpStatus();
    }

    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        try { await net.writeRecovery(mp.code, mp.appliedSeq, this.game.snapshot()); } catch { /* the requester retries */ }
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this._mpApplyRecovery(room.recovery);
      }
    }

    const entries = Object.values(room.moves || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq), 0);
    if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
    mp.maxKnownSeq = maxSeq;
    this._mpTryDeliverNextMove();

    if (mp.awaitingRoundResolve && room.round && room.round.n === mp.awaitingRoundN) {
      this.game.config.presetDeck = room.round.deck;
      const resolve = mp.awaitingRoundResolve;
      mp.awaitingRoundN = null; mp.awaitingRoundResolve = null;
      this._clearMpStatus();
      resolve();
    }
  }

  async _mpHostCreate() {
    if (this._mpBusy) return;
    this._mpBusy = true; this._mpError = '';
    this.renderSetup();
    const me = this._myIdentity();
    const config = this._mpBuildConfig(this._setup.config);
    const res = await net.createRoom('chinchon', config, me);
    this._mpBusy = false;
    if (this._dead) return;
    if (res.error) {
      this._mpError = res.error === 'busy' ? 'Could not create a room' : 'Offline';
      this.renderSetup();
      return;
    }
    this._mpPendingCode = res.code;
    net.heartbeat(res.code, 'host');
    await net.onRoom(res.code, (room) => this._mpRoomCallback(room));
    this.renderSetup();
  }

  async _mpHostStart() {
    const room = this._mpLobbyRoom;
    if (!room || !room.guest || this._mpBusy || this.mp) return;
    const code = this._mpPendingCode;
    this.mp = this._mpNewState('host', code, room.guest);
    if (this.game) this.game.abort();
    this.syncSetupInputs();
    const s = this._setup;
    const config = this._mpBuildConfig(s.config);
    config.onStockReset = (order) => this._mpSendStockReset(order);
    const players = [
      makePlayer({ id: 0, name: s.humanName || 'You', avatar: s.humanAvatar, isHuman: true, agent: this.humanAgent }),
      makePlayer({ id: 1, name: room.guest.name, avatar: room.guest.avatar, agent: this._makeRemoteAgent() }),
    ];
    this.game = new Game({ players, config });
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this._newCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._matchMinusTens = 0; this._statsCommitted = false;
    this._matchEnded = false; this._closeMenu();
    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this._buildPiles();
    this.render();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Chinchón MP match error', err); });
  }

  async _mpJoinSubmit() {
    if (this._mpBusy) return;
    const code = this._mpJoinCode;
    if (code.length !== MP_CODE_LEN) return;
    this._mpBusy = true; this._mpError = '';
    this.renderSetup();
    const me = this._myIdentity();
    const res = await net.joinRoom(code, me);
    this._mpBusy = false;
    if (this._dead) return;
    if (res.error) {
      this._mpError = res.error === 'not-found' ? 'Room not found'
        : res.error === 'ended' ? 'Room ended'
        : res.error === 'full' ? 'Room full'
        : res.error === 'version' ? 'version'
        : 'Offline';
      this.renderSetup();
      return;
    }
    // Game-type check: net.js is game-agnostic, so a wrong-game join must be
    // caught client-side. Treated as a not-found-class error (no room slot
    // was actually claimed on our behalf server-side to undo -- the guest
    // field write already happened, but harmlessly, since the room is unusable
    // to us either way and its own TTL/host will reclaim it).
    if (res.room && res.room.game && res.room.game !== 'chinchon') {
      this._mpError = 'Wrong game';
      this.renderSetup();
      return;
    }
    this._mpPendingCode = code;
    this._mpJoinedCode = code;
    this._screen = 'join-lobby';   // only now: a failed attempt stays on the setup screen's Join mode
    net.heartbeat(code, 'guest');
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    this._mpLobbyRoom = res.room;
    this.renderSetup();
    if (res.room && res.room.status === 'active' && res.room.round) this._mpGuestStartMatch(res.room);
  }

  _mpGuestStartMatch(room) {
    if (this.mp || this._dead) return;
    const code = this._mpJoinedCode;
    this.mp = this._mpNewState('guest', code, room.host);
    if (this.game) this.game.abort();
    const s = this._setup;
    const config = this._mpBuildConfig(room.config || {});
    config.presetDeck = room.round.deck;
    // Dealer rotation in Chinchón is fully deterministic (initMatch() always
    // starts at 0, finishRoundAfterPlay() always advances by 1) -- unlike
    // Escoba's randomly-picked round-1 dealer, there is nothing to force
    // here; both engines reach the identical dealerIndex on their own.
    const players = [
      makePlayer({ id: 0, name: room.host.name, avatar: room.host.avatar, agent: this._makeRemoteAgent() }),
      makePlayer({ id: 1, name: s.humanName || 'You', avatar: s.humanAvatar, isHuman: true, agent: this.humanAgent }),
    ];
    this.game = new Game({ players, config });
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this._newCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._matchMinusTens = 0; this._statsCommitted = false;
    this._matchEnded = false; this._closeMenu();
    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this._buildPiles();
    this.render();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Chinchón MP match error', err); });
  }

  _mpCancelLobby() {
    const code = this._mpPendingCode;
    const role = this._screen === 'host-lobby' ? 'host' : 'guest';
    this._screen = 'setup';
    this._mpError = ''; this._mpBusy = false; this._mpJoinCode = '';
    this._mpPendingCode = null; this._mpJoinedCode = null; this._mpLobbyRoom = null;
    if (code) net.leaveRoom(code, role).catch(() => {});
    else net.disconnect();
    this.renderSetup();
  }

  /** The in-game menu's leave action: unlike destroy() (backgrounding, room
   *  left untouched), this is an explicit abandon -- ends the room too. */
  _mpLeaveToSetup() {
    const mp = this.mp;
    if (this.game) this.game.abort();
    this.mp = null;
    this._mpClearSave();
    if (mp && mp.code) net.leaveRoom(mp.code, mp.role).catch(() => {});
    else net.disconnect();
    this.showSetup();
  }

  async _mpForceUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch { /* ignore */ }
    try { location.reload(); } catch { /* ignore */ }
  }

  // --- MP autosave (T5): MP-only, no solo equivalent exists ------------------

  /** Snapshot timing constraint (from M2a/game.js's snapshot() doc comment):
   *  only valid BETWEEN turns, never mid-turn (between a draw and its
   *  discard). Called only from the 'roundScored' onEvent hook (a round
   *  boundary, always safe) -- NOT after every entry, unlike Escoba's
   *  per-move autosave, because Chinchón's per-DECISION granularity means
   *  "after a draw" is mid-turn. A restored match resumes with the NEXT
   *  round via playMatch()'s boundary branch (game.js: `_resumeNextRound`,
   *  scores/round/dealer kept), waits for the host's round record
   *  (_tryRestoreMP's _mpAwaitNextRound gate), then fast-replays whatever
   *  of the new round already happened via the normal move log (replayMode). */
  _mpSaveSnapshot() {
    if (!this.game || !this.mp) return;
    try {
      saveJSON(STORE_MP_SAVE, {
        v: 1, code: this.mp.code, role: this.mp.role, seq: this.mp.appliedSeq,
        at: Date.now(), snap: this.game.snapshot(),
      });
    } catch { /* private mode / quota */ }
  }

  _mpLoadSave() {
    const raw = loadJSON(STORE_MP_SAVE, null);
    return (raw && raw.v === 1 && raw.snap) ? raw : null;
  }

  _mpClearSave() { try { localStorage.removeItem(STORE_MP_SAVE); } catch { /* ignore */ } }

  /** Backgrounding/restore: an MP autosave younger than 30 minutes, with the
   *  room still active, reattaches to the same room and fast-replays
   *  (replayMode) whatever moves landed while this device was away, instead
   *  of just returning to a blank setup screen. Runs once, right after
   *  mount(). Chinchón has no solo autosave, so this never fires outside MP. */
  async _tryRestoreMP() {
    const save = this._mpLoadSave();
    if (!save) return;
    const age = Date.now() - (save.at || 0);
    if (age > MP_RESTORE_MAX_AGE_MS) { this._mpClearSave(); return; }
    const { code, role } = save;
    if (!code || !role || !save.snap) return;
    try {
      if (role === 'guest') {
        const res = await net.joinRoom(code, this._myIdentity());
        if (res.error || (res.room && res.room.status === 'ended')) { this._mpClearSave(); return; }
      } else if (!(await net.init())) return;
    } catch { return; }
    if (this._dead || this.mp || this.game) return;   // superseded by a faster user action meanwhile

    const agentsById = {};
    for (const sp of save.snap.players) agentsById[sp.id] = sp.isHuman ? this.humanAgent : this._makeRemoteAgent();
    this.mp = this._mpNewState(role, code, null);
    this.mp.appliedSeq = save.seq | 0;
    this.game = Game.fromSnapshot(save.snap, agentsById);
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this._newCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._matchMinusTens = 0; this._statsCommitted = false;
    this._matchEnded = false;
    net.heartbeat(code, role);
    await net.onRoom(code, (room) => this._mpRoomCallback(room));
    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this._buildPiles();
    this.render();
    // The autosave is always a round-BOUNDARY snapshot (see _mpSaveSnapshot), so the
    // restored engine continues with the NEXT round - whose deck must come from the
    // host's published round record, exactly like the live 'roundScored' gate. The
    // host side needs no wait: it shuffles and publishes its own next round. If the
    // host hasn't advanced yet (still on its round modal), this waits in place and
    // the onRoom subscription above resolves it when the record lands.
    if (role === 'guest' && save.snap && !save.snap.midRound) await this._mpAwaitNextRound();
    if (this._dead) return;
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Chinchón MP restore error', err); });
  }

  // --- teardown -------------------------------------------------------------

  destroy() {
    this._dead = true;
    // Deliberately do NOT abandon an MP room here: this is backgrounding
    // (destroy() runs for ANY hub teardown, incl. just navigating back to
    // the launcher mid-match), not an explicit abandon -- see
    // _mpLeaveToSetup/_menuAction for that. The room stays alive server-side
    // (only the local listener/heartbeat stop, per Invariant 2) and the MP
    // autosave lets a relaunch within 30 min pick the match back up.
    if (this.game) this.game.abort();
    this._resolvePending(null); // unblock any awaiting human decision (engine then aborts)
    this._resolvePlace([]);     // unblock any awaiting placement prompt
    this._resolveModal();       // unblock any awaiting round modal
    net.disconnect();
    this.mp = null;
    if (this.root) { this.root.removeEventListener('click', this._onClick); this.root.removeEventListener('input', this._onInput); }
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointercancel', this._onPointerUp);
    clearTimeout(this._beatTimer);
    clearTimeout(this._toastTimer);
    this.game = null;
    this.container.innerHTML = '';
  }
}

// --- module contract --------------------------------------------------------

let instance = null;

/** Mount Chinchón into `container`. Replaces any prior instance. */
export function init(container) {
  if (instance) instance.destroy();
  instance = new ChinchonUI(container);
  return instance;
}

/** Tear down the mounted game. */
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** True if a match is in progress (so the hub can confirm before unmounting). */
export function isInProgress() {
  return !!instance && instance._inProgress();
}

export default { init, destroy, isInProgress };
