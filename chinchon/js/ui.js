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

const DECKS_BY_ID = Object.fromEntries(listDecks().map((d) => [d.id, d]));
const DEFAULT_DECK_ID = 'anita';

const AI_NAMES = ['Lucía', 'Mateo', 'Sofía'];
const AI_AVATARS = ['💃', '🤠', '🎸'];
const HUMAN_AVATARS = ['🤠', '💃', '🕺', '🎸', '🐂', '🌹', '🏰', '🍷', '👑', '🦁', '🐉', '⚔️', '🛡️', '🎭', '🌟', '🔥', '🦊', '🐼', '🦉', '🐺', '😎', '🧔', '🎩', '🃏'];
const DIFFICULTIES = [['easy', 'Easy'], ['normal', 'Average'], ['hard', 'Hard']];
// Profile skill tiers (1-3) -> Chinchón's three AI levels.
const SKILL_TO_DIFF = { 1: 'easy', 2: 'normal', 3: 'hard' };
const PLAYER_COLORS = ['#d4a017', '#d22f27', '#1f5fd4', '#2e8b57'];

const BEAT_TURN = 700, BEAT_DRAW = 650, BEAT_DISCARD = 550, BEAT_CLOSE = 800;
const STORE_SETTINGS = 'chinchon-settings';
const STORE_STATS = 'chinchon-stats';

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
/** Names shown in the deck viewer: the 12 face cards (Sota/Caballo/Rey) + the back. */
function galleryNames() {
  const names = [];
  for (const s of ['oros', 'copas', 'espadas', 'bastos']) for (const r of [10, 11, 12]) names.push(`${s}-${r}`);
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
    this.activePlayerId = null;
    this._modalResolve = null;
    this._placeResolve = null;
    this._chartView = false;
    this._sortMode = 'suit';        // 'suit' | 'rank' (cycled by the sort button)
    this._highlightSets = false;    // colour-code melds in the hand
    this._manualOrder = null;       // [cardId] once the player drag-reorders
    this._displayOrder = [];        // ids in current on-screen order (for drag math)
    this._drag = null;
    this._justDragged = false;

    this._setup = this._loadSetup();
    this.stats = loadJSON(STORE_STATS, { games: 0, wins: 0, losses: 0, closes: 0, chinchons: 0 });

    const ui = this;
    this.humanAgent = {
      isHuman: true,
      chooseDraw: () => ui.promptDraw(),
      chooseDiscard: () => ui.promptDiscard(),
      decideClose: () => ui.promptClose(),
      choosePlacements: (view, locked, attachable) => ui.promptPlacements(attachable),
    };

    this._onClick = (e) => this.onClick(e);
    this._onHandPointerDown = (e) => this.onHandPointerDown(e);
    this._onPointerMove = (e) => this.onPointerMove(e);
    this._onPointerUp = (e) => this.onPointerUp(e);

    ensureStylesheet();
    setDeck(this._setup.deck);
    preloadDeck();
    this.mount();
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
      aiNames.push(savedNames[i] || (opps[i] && opps[i].name) || AI_NAMES[i]);
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
      rulesOpen: false,
      config: Object.assign({}, DEFAULT_CONFIG, saved.config || {}),
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(STORE_SETTINGS, { count: s.count, humanName: s.humanName, humanAvatar: s.humanAvatar, aiNames: s.aiNames, aiDifficulty: s.aiDifficulty, deck: s.deck, config: s.config });
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
    this.el.hand.addEventListener('pointerdown', this._onHandPointerDown);
    this.showSetup();
  }

  // --- setup screen ---------------------------------------------------------

  showSetup() {
    if (this._dead) return;
    if (this.game) { this.game.abort(); this.game = null; }
    this._pending = null; this._selectedCardId = null; this.activePlayerId = null;
    this._modalResolve = null; this._placeResolve = null; this._chartView = false;
    this._matchEnded = false; this._closeMenu();
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this.el.game.hidden = true; this.el.header.hidden = false; this.el.setup.hidden = false;
    this.renderSetup();
  }

  renderSetup() {
    const s = this._setup;
    const c = s.config;
    const st = this.stats;
    const statsLine = st.games > 0
      ? `<p class="cc-stats">🏆 ${st.games} played · ${st.wins} won · ${st.closes} closes · ${st.chinchons} chinchón</p>`
      : '';

    const seg = (action, value, opts, attrs = '') =>
      `<div class="cc-segmented" ${attrs}>${opts.map(([v, lbl]) =>
        `<button class="cc-seg ${v === value ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
    const toggleRow = (field, label) =>
      `<div class="cc-rule"><span class="cc-rule-name">${label}</span>
        <button class="cc-switch ${c[field] ? 'is-on' : ''}" data-action="rule-toggle" data-field="${field}" role="switch" aria-checked="${!!c[field]}"><span class="cc-switch-thumb"></span></button></div>`;
    const stepRow = (field, label, val, suffix = '') =>
      `<div class="cc-rule"><span class="cc-rule-name">${label}</span>
        <span class="cc-stepper"><button class="cc-step" data-action="rule-step" data-field="${field}" data-d="-1">−</button>
        <span class="cc-step-val">${val}${suffix}</span>
        <button class="cc-step" data-action="rule-step" data-field="${field}" data-d="1">+</button></span></div>`;

    const aiDiffSeg = (i) => `<div class="cc-segmented cc-seg-sm">${DIFFICULTIES.map(([v, lbl]) =>
      `<button class="cc-seg ${(s.aiDifficulty[i] || 'normal') === v ? 'is-selected' : ''}" data-action="set-aidiff" data-i="${i}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
    const aiRows = [];
    for (let i = 0; i < s.count - 1; i++) {
      aiRows.push(`<div class="cc-player-row">
        <span class="cc-av">${s.aiAvatars[i]}</span>
        <input class="cc-name-input" data-ai-name="${i}" value="${esc(s.aiNames[i])}" maxlength="14" aria-label="Opponent ${i + 1} name">
        ${aiDiffSeg(i)}
      </div>`);
    }

    const usesPoints = c.victoryCondition !== 'rounds';
    const usesRounds = c.victoryCondition !== 'points';

    const rulesBody = `
      <div class="cc-rule"><span class="cc-rule-name">Victory</span>
        ${seg('rule-victory', c.victoryCondition, [['points', 'Points'], ['rounds', 'Rounds'], ['roundsOrPoints', 'Both']])}</div>
      ${usesPoints ? stepRow('scoreLimit', 'Score limit', c.scoreLimit) : ''}
      ${usesRounds ? stepRow('roundsLimit', 'Rounds', c.roundsLimit) : ''}
      <div class="cc-rule"><span class="cc-rule-name">Max points to close</span>
        ${seg('rule-maxclose', String(c.maxClose), [['3', '3'], ['4', '4'], ['5', '5']])}</div>
      ${stepRow('maxResets', 'Deck resets', c.maxResets)}
      <div class="cc-rule"><span class="cc-rule-name">Figures value</span>
        ${seg('rule-figures', c.figuresFaceValue ? 'own' : 'flat', [['flat', 'Flat 10'], ['own', 'Own']])}</div>
      <div class="cc-rule"><span class="cc-rule-name">Place cards on ending</span>
        ${seg('rule-place', c.placeOnEnding, [['auto', 'Auto'], ['manual', 'Manual'], ['off', 'Off']])}</div>
      ${toggleRow('winWithChinchon', 'Win with chinchón')}
      ${toggleRow('extended', 'Use 8s & 9s (48 cards)')}
      ${toggleRow('joker', 'Play with Joker')}
      ${toggleRow('aceOrosWild', 'Ace of Oros is wild')}
      ${toggleRow('showRemaining', 'Show remaining cards')}`;

    // Themed title: the Anita deck rebrands the whole screen as a joke edition.
    const anita = s.deck === 'anita';
    this.el.header.innerHTML = anita
      ? `<h1 class="cc-title cc-title-anita">Chinchón <span class="cc-title-bonita">Anita Attack</span></h1>`
      : `<h1 class="cc-title">Chinchón</h1>`;

    this.el.setup.innerHTML = `
      <div class="cc-card-panel">
        ${statsLine}
        <div class="cc-section">
          <span class="cc-label">Players</span>
          ${seg('set-count', String(s.count), [['2', '2'], ['3', '3'], ['4', '4']])}
          <div class="cc-player-row">
            <button class="cc-av cc-av-btn" data-action="open-avatar" title="Choose avatar">${s.humanAvatar}</button>
            <input class="cc-name-input" data-field="humanName" value="${esc(s.humanName)}" maxlength="14" aria-label="Your name">
          </div>
          ${aiRows.join('')}
        </div>

        <div class="cc-section">
          <span class="cc-label">Card deck</span>
          <button class="cc-deck-btn" data-action="open-deck" title="Choose a deck">
            <img class="cc-deck-thumb" src="${deckAssetUrl(s.deck, 'back')}" alt="">
            <span class="cc-deck-meta">
              <span class="cc-deck-name">${esc(DECKS_BY_ID[s.deck].name)}</span>
              <span class="cc-deck-sub">Tap to change</span>
            </span>
            <span class="cc-deck-go">▸</span>
          </button>
        </div>

        <div class="cc-section">
          <button class="cc-rules-toggle" data-action="toggle-rules" aria-expanded="${s.rulesOpen}">
            <span class="cc-label">Game Settings</span><span class="cc-chevron">${s.rulesOpen ? '▾' : '▸'}</span></button>
          <div class="cc-rules" ${s.rulesOpen ? '' : 'hidden'}>${rulesBody}</div>
        </div>

        <button class="cc-btn cc-btn-primary" data-action="start">Start game</button>
        <p class="cc-credit">${s.deck === 'baraja-libre'
          ? `Card art: Baraja Española · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>`
          : `Card art: ${esc(DECKS_BY_ID[s.deck].credit)}`}</p>
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

  _openDeckPicker() {
    const opts = listDecks().map((d) => {
      const sel = d.id === this._setup.deck ? 'is-sel' : '';
      return `<div class="cc-deck-opt-wrap ${sel}">
        <button class="cc-deck-opt ${sel}" data-action="pick-deck" data-v="${d.id}" aria-pressed="${sel ? 'true' : 'false'}">
          <img class="cc-deck-back" src="${deckAssetUrl(d.id, 'back')}" alt="${esc(d.name)} back" draggable="false">
          <span class="cc-deck-opt-name">${esc(d.name)}${sel ? ' <span class="cc-deck-tick">✓</span>' : ''}</span>
          <span class="cc-deck-opt-credit">${esc(d.credit)}</span>
        </button>
        <button class="cc-deck-view-btn" data-action="view-deck" data-v="${d.id}">🔍 View all cards</button>
      </div>`;
    }).join('');
    this.el.modal.innerHTML = `<div class="cc-scrim" data-action="close-deck"></div><div class="cc-sheet cc-deck-sheet">
      <h2 class="cc-sheet-title">Choose a deck</h2>
      <div class="cc-deck-grid">${opts}</div>
      <button class="cc-btn cc-btn-ghost" data-action="close-deck">Close</button>
    </div>`;
    this.el.modal.hidden = false;
  }

  _closeDeckPicker() {
    this.el.modal.hidden = true;
    this.el.modal.innerHTML = '';
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
    this.el.modal.innerHTML = `<div class="cc-scrim" data-action="close-deck"></div><div class="cc-sheet cc-gallery-sheet">
      <div class="cc-gallery-head">
        <button class="cc-btn cc-btn-ghost cc-gallery-back" data-action="back-to-decks">← Decks</button>
        <h2 class="cc-sheet-title">${esc(d.name)}</h2>
        <button class="cc-btn cc-btn-ghost" data-action="close-deck">Done</button>
      </div>
      <p class="cc-gallery-hint">Tap any card to zoom in.</p>
      <div class="cc-gallery-grid">${cells}</div>
    </div>`;
    this.el.modal.hidden = false;
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
    this._pending = null; this._selectedCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._statsCommitted = false;
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
        this.activePlayerId = null; this._pending = null; this._selectedCardId = null; this.render();
        break;
      case 'turnStart':
        this.activePlayerId = payload.playerId; this.render();
        if (p && !p.isHuman) await this.beat(BEAT_TURN);
        break;
      case 'draw':
        this.render();
        if (p && !p.isHuman) { this.toast(`${p.name} drew from the ${payload.source === 'discard' ? 'discard pile' : 'deck'}`); await this.beat(BEAT_DRAW); }
        break;
      case 'discard':
        this.render();
        if (p && !p.isHuman) await this.beat(BEAT_DISCARD);
        break;
      case 'close':
        this.toast(`${p.name} closed the round!`); this.render(); await this.beat(BEAT_CLOSE);
        break;
      case 'reset':
        this.toast('Deck reshuffled'); this.render();
        break;
      case 'roundScored':
        if (this.game.whoClosed === 0) { this._matchCloses++; if (this.game.closeType === 'chinchon') this._matchChinchons++; }
        this._chartView = false;
        await this.showRoundModal();
        break;
      case 'matchEnd':
        this._matchEnded = true;
        this._commitStats();
        this._chartView = false;
        await this.showMatchModal();
        break;
    }
  }

  beat(ms) { return new Promise((resolve) => { this._beatTimer = setTimeout(resolve, ms); }); }

  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const human = this._human();
    this.stats.games += 1;
    if (this.game.winner && this.game.winner.id === human.id) this.stats.wins += 1; else this.stats.losses += 1;
    this.stats.closes += this._matchCloses || 0;
    this.stats.chinchons += this._matchChinchons || 0;
    saveJSON(STORE_STATS, this.stats);
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
    if (this._pending) {
      // No draw prompt text: the glowing name chip + highlighted piles say it.
      if (this._pending.kind === 'discard') return this._selectedCardId ? 'Discard the selected card, or pick another.' : 'Choose a card to discard.';
      if (this._pending.kind === 'close') return 'You can close! Close the round, or keep playing.';
    }
    const ap = this.activePlayerId != null ? this.game.byId(this.activePlayerId) : null;
    if (ap && !ap.isHuman) return `${ap.name} is playing…`;
    return '';
  }

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
    if (this._pending.kind === 'draw') return '<span class="cc-hint">Tap the deck or the discard pile.</span>';
    return '';
  }

  _cardLabel(id) {
    const c = this._human().hand.find((x) => x.id === id);
    if (!c) return '';
    if (c.isJoker) return 'Joker';
    return `${c.rank} ${SUIT_META[c.suit].label}`;
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
    let sub = '';
    if (closer && closer.closeInfo) {
      const cat = closer.closeInfo.category;
      sub = cat === 'chinchon' ? '¡Chinchón! 🎉' : cat === 'doubleMeld' ? 'Double meld · −10' : cat === 'sixAndOne' ? 'Six and one' : '';
    }
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
      const breakdown = closer ? this._closerBreakdown(closer) : '';
      body = `<table class="cc-score"><thead><tr><th>Player</th><th class="num">Round</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>${breakdown}`;
    }
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
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
    const reason = g.matchEndReason === 'chinchon' ? ' with a Chinchón' : '';
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
      <h2 class="cc-sheet-title">${winner.avatar} ${esc(winner.name)} wins${reason}!</h2>
      ${betty}
      ${body}
      <div class="cc-sheet-actions">
        <button class="cc-btn cc-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Standings' : '📈 Scoreboard'}</button>
        <button class="cc-btn cc-btn-primary" data-action="new-game">New game</button>
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
      case 'open-deck': this.syncSetupInputs(); this._openDeckPicker(); break;
      case 'pick-deck':
        this._setup.deck = a.dataset.v; setDeck(a.dataset.v); preloadDeck();
        this._saveSetup(); this._closeDeckPicker(); this.renderSetup(); break;
      case 'close-deck': this._closeCardZoom(); this._closeDeckPicker(); break;
      case 'view-deck': this._openDeckGallery(a.dataset.v); break;
      case 'back-to-decks': this._openDeckPicker(); break;
      case 'zoom-card': this._openCardZoom(a.dataset.deck, a.dataset.name); break;
      case 'close-zoom': this._closeCardZoom(); break;
      case 'set-aidiff': this.syncSetupInputs(); this._setup.aiDifficulty[+a.dataset.i] = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'toggle-rules': this.syncSetupInputs(); this._setup.rulesOpen = !this._setup.rulesOpen; this.renderSetup(); break;
      case 'rule-victory': this.syncSetupInputs(); this._setup.config.victoryCondition = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-maxclose': this.syncSetupInputs(); this._setup.config.maxClose = +a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-figures': this.syncSetupInputs(); this._setup.config.figuresFaceValue = a.dataset.v === 'own'; this._saveSetup(); this.renderSetup(); break;
      case 'rule-place': this.syncSetupInputs(); this._setup.config.placeOnEnding = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'rule-toggle': this.syncSetupInputs(); this._setup.config[a.dataset.field] = !this._setup.config[a.dataset.field]; this._saveSetup(); this.renderSetup(); break;
      case 'rule-step': this.syncSetupInputs(); this._stepRule(a.dataset.field, +a.dataset.d); this._saveSetup(); this.renderSetup(); break;
      case 'start': this.startGame(); break;
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
      case 'new-game': this.showSetup(); break;
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
        ${btn('newgame', 'New game (same settings)')}
        ${btn('quit', 'Quit to setup')}
        <button class="cc-btn cc-btn-primary" data-action="menu-resume">Resume game</button>
      </div>`;
  }

  /** Destructive menu actions confirm-on-second-tap while a match is live. */
  _menuAction(which) {
    if (this._inProgress() && this._menuConfirm !== which) {
      this._menuConfirm = which;
      this._renderMenu();
      return;
    }
    this._closeMenu();
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

  // --- teardown -------------------------------------------------------------

  destroy() {
    this._dead = true;
    if (this.game) this.game.abort();
    this._resolvePending(null); // unblock any awaiting human decision (engine then aborts)
    this._resolvePlace([]);     // unblock any awaiting placement prompt
    this._resolveModal();       // unblock any awaiting round modal
    if (this.root) this.root.removeEventListener('click', this._onClick);
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
