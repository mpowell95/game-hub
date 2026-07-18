// ui.js : Escoba UI module. Exposes the hub contract: init(container)/destroy().
//
// The UI owns the DOM and implements a human agent whose chooseMove returns a
// promise resolved on tap, so the engine's async turn loop blocks on the human
// exactly as it resolves instantly on the AI. "Thinking" delays for AI turns
// are added here (never in the engine), in the awaited onEvent hook.
//
// Design rules this file follows throughout (a professional-app pass, not a
// tutorial): no instructional or narrating sentences in gameplay (turn state
// is shown by the active-player ring; the action button IS the instruction);
// zero layout shift once a match is on screen (every region has fixed
// geometry; transient content lives in overlays or reserved-width chips).

import { Game, makePlayer } from './game.js';
import { AIAgent } from './ai.js';
import { captureOptions, sumValues, cardLabel } from './deck.js';
import { renderCardFace as cardFaceHTML, preloadDeck } from './cards.js';
import { loadProfile } from '../../js/profile-store.js';
import { loadStats, recordEscoba } from '../../js/game-stats.js';

const AI_NAMES = ['Lucía', 'Diego', 'Sofía'];
const AI_AVATARS = ['💃', '🤠', '🎸'];
const HUMAN_AVATARS = ['🤠', '💃', '🕺', '🎸', '🐂', '🌹', '🏰', '🍷', '👑', '🦁', '🐉', '⚔️', '🛡️', '🎭', '🌟', '🔥', '🦊', '🐼', '🦉', '🐺', '😎', '🧔', '🎩', '🃏'];
const DIFFICULTIES = [['easy', 'Beginner'], ['normal', 'Intermediate'], ['hard', 'Pro']];
// Profile skill tiers (1-3) -> Escoba's three AI levels.
const SKILL_TO_DIFF = { 1: 'easy', 2: 'normal', 3: 'hard' };
const PLAYER_COLORS = ['#e8b53a', '#d22f27', '#1f5fd4', '#2e8b57'];

const BEAT_TURN = 650, BEAT_PLAY = 800, BEAT_CAPTURE = 520, BEAT_ESCOBA = 1250, BEAT_ANNOUNCE = 1500;
// The played card + whatever it captures are held highlighted together
// before anything exits, so the play always reads before it disappears
// (fixes captures being effectively invisible on AI turns). Humans already
// watched themselves pick the cards, so their hold is short, just enough
// to register the capture visually rather than snapping straight to exit.
const HOLD_AI_MS = 750, HOLD_HUMAN_MS = 380;
// Escoba sweep sequence: broom starts immediately, the capture's cards fly
// partway through the (now slower, ~1.5s) crossing, and the banner pops
// around the halfway point rather than waiting for the full sweep to
// finish, so the total moment stays well under ~1.8s even though the sweep
// itself now takes longer to register as a sweep rather than a flight.
const BROOM_MS = 1500, BROOM_TO_FLYOUT_MS = 480, BROOM_TO_BANNER_MS = 720;
const STORE_SETTINGS = 'escoba-settings';
const STORE_SAVE = 'escoba-save';
const SAVE_SCHEMA_V = 1;
const BROOM_URL = new URL('../img/broom-sprite.webp', import.meta.url).href;
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/escoba.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some(
    (l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/escoba.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

class EscobaUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.game = null;
    this._pending = null;        // { resolve } while the engine awaits the human move
    this._selHand = null;        // selected hand card id
    this._selTable = new Set();  // selected table card ids
    this.activePlayerId = null;
    this._modalResolve = null;
    this._chartView = false;
    this._matchEnded = false;
    this._matchEscobas = 0;

    this._setup = this._loadSetup();

    const ui = this;
    this.humanAgent = {
      isHuman: true,
      chooseMove: () => ui.promptMove(),
    };

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    preloadDeck();
    { const img = new Image(); img.src = BROOM_URL; }   // warm the sweep sprite so the first escoba doesn't flash
    this.mount();
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(STORE_SETTINGS, {});
    // Shared hub profile: defaults only, applied where the game has no saved
    // last-used value (precedence: last-used > profile > built-in). AI identity
    // is read from the profile fresh each load (never persisted), so profile
    // edits to opponents always show; humanName/avatar/difficulty persist, so a
    // player's in-game customization wins.
    const profile = loadProfile();
    const opps = (profile && profile.opponents) || [];
    const aiNames = [], aiAvatars = [];
    const savedNames = Array.isArray(saved.aiNames) ? saved.aiNames : [];
    for (let i = 0; i < 2; i++) {
      aiNames.push(savedNames[i] || (opps[i] && opps[i].name) || AI_NAMES[i]);
      aiAvatars.push((opps[i] && opps[i].emoji) || AI_AVATARS[i]);
    }
    const profileDiff = (i) => (opps[i] && SKILL_TO_DIFF[opps[i].skill]) || 'normal';
    return {
      count: clamp(saved.count || (opps.length ? Math.min(opps.length + 1, 3) : 2), 2, 3),
      humanName: typeof saved.humanName === 'string' ? saved.humanName
        : (profile && profile.name) || 'You',
      humanAvatar: HUMAN_AVATARS.includes(saved.humanAvatar) ? saved.humanAvatar
        : (profile && profile.emoji) || HUMAN_AVATARS[0],
      aiNames, aiAvatars,
      aiDifficulty: Array.isArray(saved.aiDifficulty) ? saved.aiDifficulty.slice(0, 2)
        : [profileDiff(0), profileDiff(1)],
      targetScore: saved.targetScore === 31 ? 31 : 21,
      // Spanish is the default. American only sticks when the player actually
      // tapped the toggle (deckModeChosen); an earlier build wrote 'american'
      // as a default, and that must not survive as if it were a choice.
      deckMode: (saved.deckModeChosen && saved.deckMode === 'american') ? 'american' : 'spanish',
      deckModeChosen: !!saved.deckModeChosen,
      // Capture hints on by default (today's behavior); off = unassisted
      // (no hint highlighting, no auto-pick, no sum chip -- see _matchAssist).
      assist: saved.assist !== false,
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(STORE_SETTINGS, {
      count: s.count, humanName: s.humanName, humanAvatar: s.humanAvatar,
      aiNames: s.aiNames, aiDifficulty: s.aiDifficulty, targetScore: s.targetScore,
      deckMode: s.deckMode, deckModeChosen: s.deckModeChosen, assist: s.assist,
    });
  }

  // --- resume-match persistence ---------------------------------------------

  /** Snapshot the live match to localStorage. Called after every engine event
   *  that changes state; cheap at this size, and means backgrounding the tab
   *  or tapping the hub's back button never loses progress. */
  _saveSnapshot() {
    if (!this.game) return;
    try {
      saveJSON(STORE_SAVE, {
        v: SAVE_SCHEMA_V, matchEscobas: this._matchEscobas, assist: this._matchAssist,
        snap: this.game.snapshot(),
      });
    } catch { /* private mode / quota */ }
  }

  _loadSave() {
    const raw = loadJSON(STORE_SAVE, null);
    return (raw && raw.v === SAVE_SCHEMA_V && raw.snap) ? raw : null;
  }

  _clearSave() { try { localStorage.removeItem(STORE_SAVE); } catch { /* ignore */ } }

  // --- DOM construction -----------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="eb-root">
        <header class="eb-header" data-role="header"><h1 class="eb-title">Escoba</h1></header>
        <section class="eb-setup" data-role="setup"></section>
        <section class="eb-game" data-role="game" hidden>
          <div class="eb-topbar">
            <div class="eb-opponents" data-role="opponents"></div>
            <div class="eb-matchinfo" data-role="matchinfo"></div>
            <button class="eb-menu-btn" data-action="open-menu" aria-label="Game menu">☰</button>
          </div>
          <div class="eb-announce-row">
            <div class="eb-mat-announce" data-role="announce" aria-live="polite"></div>
          </div>
          <div class="eb-mat" data-role="mat">
            <div class="eb-mat-side">
              <div class="eb-stock" data-role="stock"></div>
              <span class="eb-stock-count" data-role="stockcount"></span>
            </div>
            <div class="eb-table" data-role="table" aria-label="Table cards"></div>
            <div class="eb-lasthand-chip" data-role="lasthand" aria-hidden="true">🧹 Last hand</div>
            <div class="eb-sum-chip" data-role="sumchip" aria-hidden="true"></div>
            <div class="eb-broom" data-role="broom" aria-hidden="true"></div>
          </div>
          <div class="eb-self-row" data-role="self"></div>
          <div class="eb-hand" data-role="hand"></div>
          <div class="eb-actions" data-role="actions"></div>
        </section>
        <div class="eb-modal" data-role="modal" hidden></div>
        <div class="eb-menu" data-role="menu" hidden></div>
        <div class="eb-banner" data-role="banner" hidden></div>
      </div>`;

    this.root = this.container.querySelector('.eb-root');
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.el = {
      header: q('header'), setup: q('setup'), game: q('game'),
      opponents: q('opponents'), matchinfo: q('matchinfo'), stock: q('stock'), stockcount: q('stockcount'),
      mat: q('mat'), table: q('table'), announce: q('announce'), lasthand: q('lasthand'), sumchip: q('sumchip'), broom: q('broom'),
      self: q('self'), hand: q('hand'), actions: q('actions'),
      modal: q('modal'), menu: q('menu'), banner: q('banner'),
    };

    this.el.broom.style.backgroundImage = `url("${BROOM_URL}")`;
    this.root.addEventListener('click', this._onClick);
    this._tableCells = new Map();   // card.id -> .eb-table-cell, kept across renders for the FLIP-ish transition
    if (typeof ResizeObserver !== 'undefined') {
      this._matResizeObserver = new ResizeObserver(() => this._relayoutTable());
      this._matResizeObserver.observe(this.el.mat);
    } else {
      this._onWinResize = () => this._relayoutTable();
      window.addEventListener('resize', this._onWinResize);
    }
    this.showSetup();
  }

  /** Re-lay the current table state after a viewport/zone size change (the
   *  mat was resized, not the card count) -- a no-op outside a live game. */
  _relayoutTable() {
    if (this._dead || !this.game || this.el.game.hidden) return;
    this._layoutTable(this.game.table);
  }

  // --- setup screen ---------------------------------------------------------

  showSetup() {
    if (this._dead) return;
    if (this.game) { this.game.abort(); this.game = null; }
    this._resolvePending(null);
    this._resolveModal();
    this._selHand = null; this._selTable.clear(); this.activePlayerId = null;
    this._chartView = false; this._matchEnded = false; this._closeMenu();
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this.el.game.hidden = true; this.el.header.hidden = false; this.el.setup.hidden = false;
    this.renderSetup();
  }

  renderSetup() {
    const s = this._setup;
    const rec = (loadStats().games || {}).escoba;
    const played = rec && rec.total ? rec.total.played | 0 : 0;
    const won = rec && rec.total ? rec.total.won | 0 : 0;
    const escobas = rec && rec.es ? rec.es.escobas | 0 : 0;
    const statsLine = played > 0
      ? `<p class="eb-stats">🧹 ${played} played · ${won} won · ${escobas} escobas</p>` : '';

    const seg = (action, value, opts, cls = '', attrs = '') =>
      `<div class="eb-segmented${cls}"${attrs}>${opts.map(([v, lbl]) =>
        `<button class="eb-seg ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;

    const aiRows = [];
    for (let i = 0; i < s.count - 1; i++) {
      aiRows.push(`<div class="eb-player-row eb-player-row-ai">
        <span class="eb-av">${s.aiAvatars[i]}</span>
        <input class="eb-name-input" data-ai-name="${i}" value="${esc(s.aiNames[i])}" maxlength="14" aria-label="Opponent ${i + 1} name">
        ${seg('set-aidiff', s.aiDifficulty[i] || 'normal', DIFFICULTIES, ' eb-seg-sm', ` data-i="${i}"`)}
      </div>`);
    }

    const save = this._loadSave();
    const resumeBtn = save
      ? `<button class="eb-btn eb-btn-primary" data-action="resume-game">Resume game</button>` : '';

    this.el.setup.innerHTML = `
      <div class="eb-panel">
        ${resumeBtn}
        ${statsLine}
        <div class="eb-section">
          <span class="eb-label">Players</span>
          ${seg('set-count', s.count, [[2, '2'], [3, '3']])}
          <div class="eb-player-row">
            <button class="eb-av eb-av-btn" data-action="open-avatar" title="Choose avatar">${s.humanAvatar}</button>
            <input class="eb-name-input" data-field="humanName" value="${esc(s.humanName)}" maxlength="14" aria-label="Your name">
          </div>
          ${aiRows.join('')}
        </div>
        <div class="eb-section">
          <span class="eb-label">Play to</span>
          ${seg('set-target', s.targetScore, [[21, '21 points'], [31, '31 points']])}
        </div>
        <div class="eb-section">
          <span class="eb-label">Card numbering</span>
          ${seg('set-deckmode', s.deckMode, [['spanish', 'Spanish'], ['american', 'American']])}
          <p class="eb-hint">${s.deckMode === 'american'
            ? 'Cards 1 to 10, every card counts the number printed on it. No Caballo or Rey.'
            : 'Traditional deck: Sota (printed 10) counts 8, Caballo (11) counts 9, Rey (12) counts 10.'}</p>
        </div>
        <div class="eb-section">
          <span class="eb-label">Capture hints</span>
          ${seg('set-assist', s.assist ? 'on' : 'off', [['on', 'On'], ['off', 'Off']])}
          <p class="eb-hint">${s.assist
            ? 'Combinable table cards are highlighted and a running sum shows as you build a capture.'
            : 'Unassisted: nothing is highlighted, no running sum. You work out the 15 yourself.'}</p>
        </div>
        <button class="eb-howto-link" data-action="open-howto">📖 How to play</button>
        <button class="eb-btn ${save ? 'eb-btn-ghost' : 'eb-btn-primary'}" data-action="start">${save ? 'New game' : 'Start game'}</button>
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
      `<button class="eb-av-opt ${av === this._setup.humanAvatar ? 'is-sel' : ''}" data-action="pick-avatar" data-v="${av}" aria-label="Avatar ${av}">${av}</button>`).join('');
    this.el.modal.innerHTML = `<div class="eb-scrim" data-action="close-modal"></div><div class="eb-sheet eb-avatar-sheet">
      <h2 class="eb-sheet-title">Choose your avatar</h2>
      <div class="eb-av-grid">${grid}</div>
      <button class="eb-btn eb-btn-ghost" data-action="close-modal">Close</button>
    </div>`;
    this.el.modal.hidden = false;
  }

  _closeModal() {
    this.el.modal.hidden = true;
    this.el.modal.innerHTML = '';
  }

  // --- how to play ------------------------------------------------------------

  _openHowTo() {
    this.el.modal.innerHTML = `<div class="eb-scrim" data-action="close-howto"></div>
      <div class="eb-sheet eb-howto">
        <div class="eb-howto-head">
          <h2 class="eb-sheet-title">How to play Escoba</h2>
          <button class="eb-btn eb-btn-ghost" data-action="close-howto">Done</button>
        </div>
        <div class="eb-howto-body">
          <section>
            <h3>Goal</h3>
            <p>Capture cards from the table by making combinations that add up to <b>15</b> with one card from your hand. Captured coins, sevens and escobas score points at the end of each round. First to ${this._setup.targetScore} points wins.</p>
          </section>
          <section>
            <h3>Card values</h3>
            ${this._setup.deckMode === 'american'
    ? `<p>The deck has cards 1 to 10 in each suit and <b>every card counts exactly the number printed on it</b>. (This is the American numbering; the Caballo and Rey sit out. Switch to the traditional Spanish figures in the setup screen.)</p>`
    : `<p>The traditional Spanish 40-card deck is used. Pip cards (1 to 7) count their face value. The figure cards keep their printed numbers 10, 11 and 12, but they capture as <b>Sota 8</b>, <b>Caballo 9</b> and <b>Rey 10</b>: trust the corner badge, not the big printed number. (Prefer cards that count as printed? Switch to American numbering in the setup screen.)</p>`}
            <p>Every card shows its capture value in the corner badge.</p>
          </section>
          <section>
            <h3>Your turn</h3>
            <p>Play one card from your hand:</p>
            <ul>
              <li>If your card plus one or more table cards adds up to exactly 15, you <b>capture</b> those cards. Tap a hand card, tap table cards to reach 15, then confirm. Capturing is required when your played card can make 15.</li>
              <li>If your card cannot make 15 with anything on the table, it is <b>placed on the table</b>.</li>
            </ul>
          </section>
          <section>
            <h3>Escoba</h3>
            <p>If your capture clears <b>every</b> card off the table, that is an <b>escoba</b> ("broom"): 1 point. The next player can only place a card.</p>
          </section>
          <section>
            <h3>Dealing</h3>
            <p>Everyone gets 3 cards and 4 go face up on the table. If those 4 cards happen to add up to 15 the dealer captures them for an escoba (30: two escobas). When hands are empty, 3 more cards are dealt each until the deck runs out ("last cards"). Any cards left on the table at the end go to the last player who captured.</p>
          </section>
          <section>
            <h3>Scoring a round</h3>
            <table class="eb-howto-table">
              <tbody>
                <tr><td>Each escoba</td><td>1 pt</td></tr>
                <tr><td>Most cards</td><td>1 pt</td></tr>
                <tr><td>Opponent under 10 cards (2 players)</td><td>+2 pts</td></tr>
                <tr><td>Most coins (Oros)</td><td>1 pt</td></tr>
                <tr><td>All 10 coins</td><td>+2 pts</td></tr>
                <tr><td>The guindis (7 of Oros)</td><td>1 pt</td></tr>
                <tr><td>All four 7s (includes the guindis point)</td><td>3 pts</td></tr>
                <tr><td>Most 7s</td><td>1 pt</td></tr>
              </tbody>
            </table>
            <p>Ties in a "most" category score nothing. A player who captures no cards at all in a round loses the match outright (2 players).</p>
          </section>
          <section>
            <h3>Winning</h3>
            <p>Rounds are played until someone reaches the target score with the sole lead.</p>
          </section>
        </div>
      </div>`;
    this.el.modal.hidden = false;
  }

  // --- game start -------------------------------------------------------------

  startGame() {
    // A live match can still be running here (e.g. the in-game menu's own
    // "New game" calls this directly, without going through showSetup()
    // first): abort it before replacing this.game, or its onEvent callback
    // keeps firing against the SAME UI instance and corrupts the new match.
    if (this.game) this.game.abort();
    this.syncSetupInputs();
    this._saveSetup();
    this._clearSave();   // an explicit (re)start replaces any resumable match
    const s = this._setup;
    const players = [makePlayer({ id: 0, name: s.humanName || 'You', avatar: s.humanAvatar, isHuman: true, agent: this.humanAgent })];
    for (let i = 0; i < s.count - 1; i++) {
      const diff = s.aiDifficulty[i] || 'normal';
      players.push(makePlayer({
        id: i + 1, name: s.aiNames[i], avatar: s.aiAvatars[i], difficulty: diff,
        agent: new AIAgent({ difficulty: diff }),
      }));
    }
    this._resolvePending(null);
    this.game = new Game({ players, config: { targetScore: s.targetScore, deckMode: s.deckMode } });
    this._bindGame();
    this._matchEscobas = 0;
    // Frozen for the life of this match (see _saveSnapshot/_resumeGame): a
    // setup-screen change to the toggle should never retroactively alter a
    // match already in progress, only future ones.
    this._matchAssist = !!s.assist;
    this._enterGameScreen();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Escoba match error', err); });
  }

  /** Rebuild a Game from the saved snapshot and rejoin the match loop where it
   *  left off (mid-round or at a fresh round boundary; the engine handles
   *  both from the same restored state). */
  _resumeGame() {
    const save = this._loadSave();
    if (!save) return;
    if (this.game) this.game.abort();   // same zombie-loop guard as startGame()
    const agentsById = {};
    for (const sp of save.snap.players) {
      agentsById[sp.id] = sp.isHuman ? this.humanAgent : new AIAgent({ difficulty: sp.difficulty });
    }
    this._resolvePending(null);
    this.game = Game.fromSnapshot(save.snap, agentsById);
    this._bindGame();
    this._matchEscobas = save.matchEscobas | 0;
    this._matchAssist = save.assist !== false;
    this._enterGameScreen();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Escoba resume error', err); });
  }

  _bindGame() {
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._selHand = null; this._selTable.clear(); this.activePlayerId = null;
    this._matchEnded = false; this._statsCommitted = false; this._celebrated = false;
    this._closeMenu();
  }

  _enterGameScreen() {
    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this.render();
  }

  // --- human agent ------------------------------------------------------------

  promptMove() {
    return new Promise((resolve) => {
      this._pending = { resolve };
      this._selHand = null; this._selTable.clear();
      this.render();
    });
  }

  _resolvePending(value) {
    if (!this._pending) return;
    const { resolve } = this._pending;
    this._pending = null; this._selHand = null; this._selTable.clear();
    this.render();
    resolve(value);
  }

  // --- engine event hook (rendering + pacing + persistence) --------------------

  async onEvent(type, payload) {
    if (this._dead) return;
    const p = payload && payload.playerId != null ? this.game.byId(payload.playerId) : null;
    switch (type) {
      case 'roundStart':
        this.activePlayerId = null;
        this.render();
        break;
      case 'deal':
        this.render();
        // Skip the snapshot on the very first deal of a round: the initial-
        // escoba check runs synchronously right after with no further await,
        // so there is no useful mid-step to resume into there.
        if (!payload.first) this._saveSnapshot();
        if (payload.lastCards) { this.announce('Last cards'); await this.beat(BEAT_TURN); }
        break;
      case 'initialEscoba': {
        this.render();   // the engine already moved these into the dealer's pile
        this._saveSnapshot();
        if (!reducedMotion()) {
          // Briefly re-show the swept cards (render() just cleared the table
          // since game.table is already empty) so the broom has something
          // to act on, mirroring a played-card escoba's fly-out.
          this._layoutTable(payload.cards);
          const cardEls = payload.cards
            .map((c) => this._tableCells.get(c.id))
            .filter(Boolean).map((cell) => cell.querySelector('.eb-card')).filter(Boolean);
          await this.beat(60);
          this._startBroomSweep();
          await this.beat(BROOM_TO_FLYOUT_MS);
          cardEls.forEach((el) => el.classList.add('is-swept'));
          await this.beat(BROOM_TO_BANNER_MS - BROOM_TO_FLYOUT_MS);
          this._layoutTable(this.game.table);   // drops the now-stale temp cells
        }
        await this.showBanner(payload.count === 2 ? '¡ESCOBA! ×2' : '¡ESCOBA!', `${p.name} takes the opening table`);
        break;
      }
      case 'turnStart':
        this.activePlayerId = payload.playerId;
        this.render();
        if (p && !p.isHuman) await this.beat(BEAT_TURN);
        break;
      case 'play':
        await this.animatePlay(p, payload);
        this.render();
        this._saveSnapshot();
        if (payload.escoba) await this.showBanner('¡ESCOBA!', `${p.name} clears the table`);
        break;
      case 'sweepLeftovers':
        this.render();
        this._saveSnapshot();
        this.announce(`${p.name} takes the leftover cards`);
        await this.beat(BEAT_PLAY);
        break;
      case 'roundScored':
        this._chartView = false;
        this._matchEscobas += this.game.byId(0).escobas;
        if (!this.game.winner) this._saveSnapshot();   // a won boundary isn't resumable; matchEnd clears it
        await this.showRoundModal();
        break;
      case 'matchEnd':
        this._matchEnded = true;
        this._clearSave();
        this._commitStats();
        this._chartView = false;
        this.showMatchModal();
        break;
    }
  }

  beat(ms) { return new Promise((resolve) => { this._beatTimer = setTimeout(resolve, ms); }); }

  /** Show the played card landing on the table, then -- for a capture --
   *  hold it and what it captures highlighted together before anything
   *  exits, so the play is always legible instead of vanishing before the
   *  player registers it. An escoba's exit is the broom sweep (started
   *  right after the hold); an ordinary capture just flies its cards off.
   *  `game.table` already excludes both the captured cards AND the played
   *  card at this point (the engine removed the former and only pushes the
   *  latter for a non-capturing play), so a capturing play is displayed via
   *  a temporary augmented list: the current table plus the cards it's
   *  about to take plus the card itself, laid out together exactly like a
   *  real (about-to-shrink) table. */
  async animatePlay(p, { card, captured, escoba }) {
    if (this._dead) return;
    const isAI = p && !p.isHuman;
    const displayList = captured.length ? [...this.game.table, ...captured, card] : this.game.table;
    this._layoutTable(displayList);
    const playedCell = this._tableCells.get(card.id);
    const playedCardEl = playedCell && playedCell.querySelector('.eb-card');
    if (playedCardEl) playedCardEl.classList.add('is-played');

    if (isAI) {
      this.announce(captured.length
        ? `${p.name} plays ${cardLabel(card)} · captures ${captured.length}`
        : `${p.name} plays ${cardLabel(card)}`);
    }
    if (!captured.length) { await this.beat(isAI ? BEAT_PLAY : 380); return; }

    const capturedEls = captured
      .map((c) => this._tableCells.get(c.id))
      .filter(Boolean)
      .map((cell) => cell.querySelector('.eb-card'))
      .filter(Boolean);
    const highlightEls = playedCardEl ? [playedCardEl, ...capturedEls] : capturedEls;
    highlightEls.forEach((el) => el.classList.add('is-hinted'));
    await this.beat(isAI ? HOLD_AI_MS : HOLD_HUMAN_MS);
    highlightEls.forEach((el) => el.classList.remove('is-hinted'));

    if (escoba && !reducedMotion()) {
      this._startBroomSweep();
      await this.beat(BROOM_TO_FLYOUT_MS);
      this._flyOutCaptured(captured, playedCardEl, true);
      await this.beat(BROOM_TO_BANNER_MS - BROOM_TO_FLYOUT_MS);
    } else {
      this._flyOutCaptured(captured, playedCardEl, false);
      await this.beat(BEAT_CAPTURE);
    }
  }

  /** Exit the captured cards (plus the card that was just played, if any).
   *  `swept` picks the escoba variant: fly right + rotate, matching the
   *  broom's travel, instead of the plain lift-and-fade used for an
   *  ordinary capture. The elements are left in place after this -- the
   *  next _layoutTable(game.table) call (from the caller's this.render())
   *  drops their now-stale ids once the exit transition has had time to
   *  finish, per the beat this method's caller awaits afterward. */
  _flyOutCaptured(captured, playedCardEl, swept) {
    const exitCls = swept ? 'is-swept' : 'is-taken';
    for (const c of captured) {
      const cell = this._tableCells.get(c.id);
      const cardEl = cell && cell.querySelector('.eb-card');
      if (cardEl) cardEl.classList.add(exitCls);
    }
    if (playedCardEl) playedCardEl.classList.add(exitCls);
  }

  /** Play the broom spritesheet once across the felt. Restarts cleanly if a
   *  second escoba lands before the first sweep's timer has cleared. */
  _startBroomSweep() {
    const b = this.el.broom;
    if (!b) return;
    b.classList.remove('is-sweeping');
    void b.offsetWidth;   // restart the animation from frame 1
    b.classList.add('is-sweeping');
    clearTimeout(this._broomTimer);
    this._broomTimer = setTimeout(() => { if (this.el && this.el.broom) this.el.broom.classList.remove('is-sweeping'); }, BROOM_MS + 80);
  }

  showBanner(headline, sub) {
    return new Promise((resolve) => {
      this.el.banner.innerHTML = `<div class="eb-banner-card">
        <span class="eb-banner-broom" aria-hidden="true">🧹</span>
        <span class="eb-banner-headline">${esc(headline)}</span>
        <span class="eb-banner-sub">${esc(sub)}</span>
      </div>`;
      this.el.banner.hidden = false;
      this._bannerTimer = setTimeout(() => {
        if (this.el && this.el.banner) this.el.banner.hidden = true;
        resolve();
      }, BEAT_ESCOBA);
    });
  }

  _commitStats() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const human = this.game.byId(0);
    const won = !!(this.game.winner && this.game.winner.id === human.id);
    const opp0 = this.game.players.find((x) => !x.isHuman);
    const difficulty = (opp0 && opp0.difficulty) || 'normal';
    recordEscoba(difficulty, won, { escobas: this._matchEscobas | 0 });
  }

  // --- rendering ------------------------------------------------------------

  _human() { return this.game.byId(0); }

  render() {
    if (this._dead || !this.game || this.el.game.hidden) return;
    const nOpp = this.game.players.length - 1;
    this.el.opponents.className = 'eb-opponents eb-opp-n' + nOpp;
    this.el.opponents.innerHTML = this.renderOpponents();
    this.el.matchinfo.innerHTML = this.renderMatchInfo();
    this._syncStock();
    this._syncLastHand();
    this._layoutTable(this.game.table);
    this._syncSumChip();
    this.el.self.innerHTML = this.renderSelf();
    this.el.hand.innerHTML = this.renderHand();
    this.el.actions.innerHTML = this.renderActions();
  }

  _pileChips(p) {
    return `<span class="eb-pile-chip" title="Cards captured">🂠 ${p.captured.length}</span>` +
      (p.escobas ? `<span class="eb-pile-chip eb-pile-escoba" title="Escobas this round">🧹 ${p.escobas}</span>` : '');
  }

  /** Mini card-back fan (capped at 3) + an exact-count numeral, so an
   *  opponent's hand size reads as recognizable cards at a glance rather
   *  than an abstract row of rectangles. */
  _miniCards(count) {
    const shown = Math.min(count, 3);
    const backs = Array.from({ length: shown }, () => '<i></i>').join('');
    return `<span class="eb-mini-cards" title="Cards in hand">${backs}<em>${count}</em></span>`;
  }

  renderOpponents() {
    const g = this.game;
    return g.players.filter((p) => !p.isHuman).map((p) => {
      const active = p.id === this.activePlayerId;
      const dealer = g.dealer === p.id;
      return `<div class="eb-opp-pill ${active ? 'is-active' : ''}">
        <div class="eb-opp-top">
          <span class="eb-opp-av">${p.avatar}${dealer ? '<i class="eb-dealer-dot" title="Dealer">D</i>' : ''}</span>
          <span class="eb-opp-name">${esc(p.name)}</span>
        </div>
        <div class="eb-opp-score"><b>${p.totalScore}</b><span>pts</span></div>
        <div class="eb-opp-foot">${this._miniCards(p.hand.length)}${this._pileChips(p)}</div>
      </div>`;
    }).join('');
  }

  /** Round/target, merged into the top bar as full words now that the old
   *  "Last" abbreviation is gone (it's a stateful chip on the mat now, see
   *  _syncLastHand). Always renders both lines so the slot never shifts. */
  renderMatchInfo() {
    const g = this.game;
    return `<span class="eb-mi-line">Round ${g.round}</span>
      <span class="eb-mi-line">First to ${g.config.targetScore}</span>`;
  }

  /** The last-hand flag is a persistent state chip on the mat (Task C), not
   *  a fading toast: it stays lit for the rest of the round once the final
   *  deal happens. Always rendered; only its opacity/scale toggles. */
  _syncLastHand() {
    this.el.lasthand.classList.toggle('is-on', !!(this.game && this.game.lastCards));
  }

  /** Running capture sum anchored to the mat (Task D): visible only while a
   *  capture-capable hand card is selected, so feedback lives where the
   *  player is already looking instead of only in the action button.
   *  Unassisted mode hides it outright -- the player counts. */
  _syncSumChip() {
    const chip = this.el.sumchip;
    if (!this._matchAssist) { chip.classList.remove('is-on', 'is-valid'); return; }
    const selCard = this._selCard();
    const opts = selCard ? this._optsFor(selCard) : [];
    if (!selCard || !opts.length) { chip.classList.remove('is-on', 'is-valid'); return; }
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    const sum = selCard.value + sumValues(picked);
    chip.textContent = `${sum} / 15`;
    chip.classList.add('is-on');
    chip.classList.toggle('is-valid', sum === 15);
  }

  /** One-time pile skeleton is unnecessary here (the stock is a single static
   *  card); just keep the back art stable and only touch the count text. */
  _syncStock() {
    const g = this.game;
    if (!g.stock.length) {
      this.el.stock.innerHTML = `<div class="eb-stock-empty"></div>`;
      this.el.stockcount.textContent = '';
      return;
    }
    if (!this.el.stock.querySelector('.eb-card')) {
      this.el.stock.innerHTML = cardFaceHTML({}, { faceDown: true, static: true });
    }
    this.el.stockcount.textContent = String(g.stock.length);
  }

  /** The table layout contract: given N cards and the (fixed-size) zone they
   *  render into, compute a per-card {x, y, z} position plus a shared card
   *  size, so the table always reads as a deliberate 2-row grid rather than
   *  wherever flex-wrap happened to break lines.
   *    cols = clamp(ceil(N/2), 2, 5); row 1 gets min(N, cols), row 2 the
   *    rest -- so N never needs a 3rd row (row 2 can only exceed cols by
   *    overlapping, never by adding another line).
   *    cardW = min(widthFit, heightFit): whichever of "N/cols across the
   *    zone width" or "2 rows down the zone height" is tighter. This alone
   *    produces the three visible size tiers (N 1-6 is height-limited so
   *    2 and 3 columns render the SAME large size; 7-8 and 9-10 each step
   *    down once as cols grows to 4 then 5) with no tier boundaries hand-
   *    coded anywhere.
   *    Rows beyond 5 cards (only possible for row 2, since row 1 is capped
   *    at cols) keep the 5-column size and fan with overlap instead of
   *    shrinking further or adding a 3rd row: `step` spaces the row's cards
   *    evenly across the full zone width, so overlap only ever eats into
   *    each card's right edge -- the left/top-left index corner, and the
   *    tap target, are never covered. */
  _computeTableLayout(n, zoneW, zoneH) {
    // The exact aspect ratio of the shipped Anita deck art (480x720,
    // verified against the actual webp files -- NOT the 400x616 the docs
    // used to claim), not a rough approximation: using the real ratio here
    // is what guarantees a card can never render taller than its row
    // budget, and (via .eb-card's matching CSS aspect-ratio) that
    // object-fit:cover never has to crop the art, which was quietly
    // shaving a couple percent off the sides -- right where the corner
    // index digit sits -- whenever this drifted from the real asset shape.
    const ASPECT = 720 / 480;
    const GAP = 8;
    if (!n || zoneW <= 0 || zoneH <= 0) return { cardW: 0, cardH: 0, positions: [] };
    const cols = Math.min(5, Math.max(2, Math.ceil(n / 2)));
    const row1n = Math.min(n, cols);
    const row2n = n - row1n;
    const rows = row2n > 0 ? [row1n, row2n] : [row1n];

    const widthFit = (zoneW - (cols - 1) * GAP) / cols;
    const heightFit = ((zoneH - GAP) / 2) / ASPECT;
    const cardW = Math.max(24, Math.min(widthFit, heightFit));
    const cardH = cardW * ASPECT;

    const rowsTotalH = rows.length === 2 ? cardH * 2 + GAP : cardH;
    const startY = (zoneH - rowsTotalH) / 2;

    const positions = [];
    rows.forEach((count, ri) => {
      const y = startY + ri * (cardH + GAP);
      if (count <= cols) {
        const rowW = count * cardW + (count - 1) * GAP;
        const startX = (zoneW - rowW) / 2;
        for (let i = 0; i < count; i++) positions.push({ x: startX + i * (cardW + GAP), y, z: i + 1 });
      } else {
        const step = (zoneW - cardW) / (count - 1);
        for (let i = 0; i < count; i++) positions.push({ x: i * step, y, z: i + 1 });
      }
    });
    return { cardW, cardH, positions };
  }

  /** Reconciling table renderer: keyed by card.id (this._tableCells), so an
   *  existing card's .eb-table-cell persists across calls and its own CSS
   *  transition (not a manual FLIP invert/play) animates it to its new
   *  slot. A brand-new id snaps to position immediately (no stale rect to
   *  animate from); a tracked id no longer present is dropped, which is
   *  exactly the point where a captured card's already-finished exit
   *  animation gets cleaned up (see animatePlay/_flyOutCaptured -- this is
   *  only ever called after their exit transition has had time to finish). */
  /** Headroom band reserved on each side of the card zone for adornments
   *  that bleed past a card's own box (lift + ring on top, ring alone on
   *  the left, the value-badge bleed on the right/bottom). REGRESSION GUARD:
   *  `.eb-table-cell` is `position:absolute` inside `.eb-table`, so its
   *  `top:0/left:0` resolves against the PADDING BOX, not the content box --
   *  CSS `padding` on `.eb-table` does NOT push absolutely positioned
   *  children inward the way it would normal-flow content. That is exactly
   *  how this clipped twice before: the headroom looked reserved (padding
   *  was there) but was never actually applied to card positions. Zone
   *  dimensions returned here (and by _computeTableLayout, which only ever
   *  sees this already-shrunk zoneW/zoneH) are POST-headroom; every x/y this
   *  method assigns is then explicitly offset by (left, top) below, so a
   *  card's own box always starts inside the reserved band, never at the
   *  table's outer edge. Read from the CSS custom properties (not
   *  hardcoded px) so this can never silently drift out of sync with the
   *  values escoba.css actually uses for the adornments themselves. */
  _tableHeadroom() {
    const cs = getComputedStyle(this.el.table);
    const px = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
    return {
      top: px('--eb-lift-overhang', 12),
      right: px('--eb-badge-overhang', 11),
      bottom: px('--eb-badge-overhang', 11),
      left: px('--eb-ring-overhang', 3),
    };
  }

  _layoutTable(cardList) {
    if (this._dead || !this.el || !this.el.table) return;
    const table = this.el.table;
    const headroom = this._tableHeadroom();
    const zoneW = table.clientWidth - headroom.left - headroom.right;
    const zoneH = table.clientHeight - headroom.top - headroom.bottom;
    const { cardW, cardH, positions } = this._computeTableLayout(cardList.length, zoneW, zoneH);

    // Hint highlighting and the over-15 dim are assists: unassisted mode
    // leaves hintIds empty and remaining null, so every card below renders
    // with hinted/dim both false regardless of what's selected (the
    // player's own is-selected marks still show -- that's their pick, not
    // a hint from the game).
    const selCard = this._matchAssist ? this._selCard() : null;
    const hintIds = new Set();
    let remaining = null;
    if (selCard) {
      const opts = this._optsFor(selCard);
      for (const combo of opts) for (const c of combo) hintIds.add(c.id);
      if (opts.length) {
        const picked = this.game.table.filter((c) => this._selTable.has(c.id));
        remaining = 15 - selCard.value - sumValues(picked);
      }
    }

    const seen = new Set();
    cardList.forEach((c, i) => {
      seen.add(c.id);
      let cell = this._tableCells.get(c.id);
      const isNew = !cell;
      if (isNew) {
        cell = document.createElement('span');
        cell.className = 'eb-table-cell';
        cell.dataset.id = c.id;
        table.appendChild(cell);
        this._tableCells.set(c.id, cell);
      }
      const isSel = this._selTable.has(c.id);
      cell.innerHTML = cardFaceHTML(c, {
        selected: isSel,
        hinted: hintIds.has(c.id) && !isSel,
        dim: remaining != null && !isSel && c.value > remaining,
        value: true,
      });
      if (isNew) cell.style.transitionProperty = 'none';
      const pos = positions[i];
      cell.style.width = `${cardW}px`;
      cell.style.height = `${cardH}px`;
      cell.style.transform = `translate(${pos.x + headroom.left}px, ${pos.y + headroom.top}px)`;
      cell.style.zIndex = String(pos.z);
      if (isNew) { void cell.offsetWidth; cell.style.transitionProperty = ''; }
    });
    for (const [id, cell] of this._tableCells) {
      if (!seen.has(id)) { cell.remove(); this._tableCells.delete(id); }
    }
  }

  renderSelf() {
    const h = this._human();
    const active = !!this._pending || this.activePlayerId === 0;
    const dealer = this.game.dealer === 0;
    return `<div class="eb-self-chip ${active ? 'is-active' : ''}">
      <div class="eb-self-top">
        <span class="eb-self-av">${h.avatar}${dealer ? '<i class="eb-dealer-dot" title="Dealer">D</i>' : ''}</span>
        <span class="eb-self-name">${esc(h.name)}</span>
      </div>
      <div class="eb-self-score"><b>${h.totalScore}</b><span>pts</span></div>
      <span class="eb-self-piles">${this._pileChips(h)}</span>
    </div>`;
  }

  renderHand() {
    const h = this._human();
    return h.hand.map((c) => cardFaceHTML(c, {
      selected: c.id === this._selHand,
      value: true,
    })).join('');
  }

  /** The action bar IS the instruction: no separate status sentence anywhere.
   *  Fixed min-width and tabular numerals keep the button from resizing as
   *  its label changes ("Capture 9/15" building up to "Capture"). */
  renderActions() {
    if (this._matchEnded) {
      return `<button class="eb-btn eb-btn-ghost" data-action="show-results">Results</button>
        <button class="eb-btn eb-btn-primary" data-action="new-game">New game</button>`;
    }
    if (!this._pending) return '';
    const selCard = this._selCard();
    if (!selCard) return '';
    if (!this._matchAssist) {
      // Unassisted: which button shows is driven ONLY by whether the player
      // has picked any table cards, never by whether a capture is actually
      // legal or mandatory (that would itself be a hint). Capture is never
      // pre-disabled either -- an invalid sum is rejected at tap time (see
      // _confirmCapture), same wordless shake as an over-mandatory place.
      if (this._selTable.size > 0) {
        return `<button class="eb-btn eb-btn-primary" data-action="capture">Capture</button>`;
      }
      return `<button class="eb-btn eb-btn-primary" data-action="lay">Place ${esc(cardLabel(selCard))}</button>`;
    }
    const opts = this._optsFor(selCard);
    if (!opts.length) {
      return `<button class="eb-btn eb-btn-primary" data-action="lay">Place ${esc(cardLabel(selCard))}</button>`;
    }
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    const sum = selCard.value + sumValues(picked);
    const valid = picked.length > 0 && sum === 15;
    // The running sum lives in the mat-anchored chip now (_syncSumChip), not
    // the button label: feedback stays where the player is already looking.
    return `<button class="eb-btn eb-btn-primary" data-action="capture" ${valid ? '' : 'disabled'}>Capture</button>`;
  }

  _selCard() {
    if (!this._selHand) return null;
    return this._human().hand.find((c) => c.id === this._selHand) || null;
  }

  _optsFor(card) {
    return captureOptions(this.game.table, card);
  }

  // --- selection input --------------------------------------------------------

  onCardTap(id) {
    if (!this._pending) return;
    const h = this._human();
    const inHand = h.hand.some((c) => c.id === id);
    if (inHand) {
      this._selTable.clear();
      this._selHand = this._selHand === id ? null : id;
      // Convenience: a single possible combo is preselected, ready to
      // confirm. Assisted only -- unassisted never pre-selects anything,
      // that's the whole point of the mode.
      const card = this._selCard();
      if (card && this._matchAssist) {
        const opts = this._optsFor(card);
        if (opts.length === 1) for (const c of opts[0]) this._selTable.add(c.id);
      }
      this.render();
      return;
    }
    // Table card: toggle within the current hand selection.
    const card = this._selCard();
    if (!card) return;
    if (!this._matchAssist) {
      // Free selection: no gating on whether a combo exists, no over-15
      // rejection. Legality is enforced only at Capture tap.
      if (this._selTable.has(id)) this._selTable.delete(id); else this._selTable.add(id);
      this.render();
      return;
    }
    if (!this._optsFor(card).length) return;
    if (this._selTable.has(id)) { this._selTable.delete(id); this.render(); return; }
    // Values are all positive, so a pick that would push the running sum
    // past 15 can never become part of a valid combo without deselecting
    // something first: reject it outright rather than allow, then disable.
    const tableCard = this.game.table.find((c) => c.id === id);
    if (!tableCard) return;
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    if (card.value + sumValues(picked) + tableCard.value > 15) { this._rejectPick(id); return; }
    this._selTable.add(id);
    this.render();
  }

  /** Brief shake on an over-15 tap: no text, just feedback where the tap
   *  happened. A transient class on the existing node, no re-render needed. */
  _rejectPick(id) {
    if (reducedMotion()) return;
    const el = this.el.table.querySelector(`.eb-card[data-id="${id}"]`);
    if (!el) return;
    el.classList.remove('eb-shake');
    void el.offsetWidth;   // restart the animation if it was still running
    el.classList.add('eb-shake');
    clearTimeout(this._shakeTimer);
    this._shakeTimer = setTimeout(() => el.classList.remove('eb-shake'), 420);
  }

  /** Same wordless shake, on the action button itself -- used when the
   *  button's own action turns out to be illegal at tap time (unassisted
   *  mode's only legality feedback: an invalid-sum Capture, or a Place
   *  attempted while a capture was actually mandatory). */
  _shakeActionButton() {
    if (reducedMotion()) return;
    const btn = this.el.actions.querySelector('.eb-btn');
    if (!btn) return;
    btn.classList.remove('eb-shake');
    void btn.offsetWidth;
    btn.classList.add('eb-shake');
    clearTimeout(this._actionShakeTimer);
    this._actionShakeTimer = setTimeout(() => btn.classList.remove('eb-shake'), 420);
  }

  /** IMPORTANT: game.js's legalize() silently coerces an illegal human move
   *  into opts[0] (its first valid capture) rather than rejecting it -- a
   *  safety net for AI agents, never meant to be relied on for the human.
   *  In unassisted mode the Capture button is never pre-disabled (that
   *  would itself be a hint), so this is the ONLY gate: a picked set that
   *  doesn't sum to exactly 15 must never reach _resolvePending, or the
   *  engine would silently substitute a combo the player never chose. */
  _confirmCapture() {
    const card = this._selCard();
    if (!card || !this._pending) return;
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    if (card.value + sumValues(picked) !== 15 || !picked.length) {
      this._shakeActionButton();
      return;
    }
    const move = { cardId: card.id, captureIds: picked.map((c) => c.id) };
    this._resolvePending(move);
  }

  _confirmLay() {
    const card = this._selCard();
    if (!card || !this._pending) return;
    if (this._optsFor(card).length) { this._shakeActionButton(); return; }   // capture is mandatory for this card
    this._resolvePending({ cardId: card.id, captureIds: [] });
  }

  // --- modals ---------------------------------------------------------------

  showRoundModal() {
    return new Promise((resolve) => { this._modalResolve = resolve; this._renderRoundModal(); });
  }

  /** Per-player capture stats for the round comparison table. */
  _roundStats(p) {
    return {
      escobas: p.escobas,
      cards: p.captured.length,
      coins: p.captured.filter((c) => c.suit === 'oros').length,
      sevens: p.captured.filter((c) => c.rank === 7).length,
      guindis: p.captured.some((c) => c.suit === 'oros' && c.rank === 7),
    };
  }

  /** Index of the sole player with the strict max of `key`, or -1 on a tie or
   *  all-zero (mirrors the engine's soleMax in scoreRound()). */
  _soleMaxIdx(stats, key) {
    let best = -1, idx = -1, tie = false;
    stats.forEach((s, i) => {
      if (s[key] > best) { best = s[key]; idx = i; tie = false; }
      else if (s[key] === best) tie = true;
    });
    return (best > 0 && !tie) ? idx : -1;
  }

  /** Comparison-table round summary (Task B): one shared column grid (a
   *  category label column plus one column per player) used by EVERY row,
   *  including the round-points and total-scores summary rows, so every
   *  number lands in a straight line under its player header. The sole
   *  category leader's cell is tinted + bold (never hue alone). Escobas has
   *  no "leader" (it isn't a compared category, just an additive count) so
   *  it is never highlighted. */
  _renderScoreTable(g) {
    const players = g.players;
    const stats = players.map((p) => this._roundStats(p));
    const cardsIdx = this._soleMaxIdx(stats, 'cards');
    const coinsIdx = this._soleMaxIdx(stats, 'coins');
    const sevensIdx = this._soleMaxIdx(stats, 'sevens');
    const guindisIdx = stats.findIndex((s) => s.guindis);

    const cell = (val, hit) => `<span class="eb-score-cell ${hit ? 'is-lead' : ''}">${val}</span>`;
    const row = (label, cells) => `<div class="eb-score-row"><span class="eb-score-cat">${label}</span>${cells.join('')}</div>`;

    const head = `<div class="eb-score-head"><span></span>${players.map((p) => `<span>${p.avatar} ${esc(p.name)}</span>`).join('')}</div>`;
    const rows = [
      row('Escobas', stats.map((s) => cell(s.escobas))),
      row('Cards', stats.map((s, i) => cell(s.cards, i === cardsIdx))),
      row('Coin cards', stats.map((s, i) => cell(s.coins, i === coinsIdx))),
      row('7 de Oros', stats.map((s, i) => cell(s.guindis ? '✓' : '✕', i === guindisIdx))),
      row('Sevens', stats.map((s, i) => cell(s.sevens, i === sevensIdx))),
    ].join('');
    const pointsRow = `<div class="eb-score-points-row"><span class="eb-score-cat">Round ${g.round} points</span>
      ${players.map((p) => `<span class="eb-score-cell">${this._sign(p.roundScore)}</span>`).join('')}</div>`;
    const totalRow = `<div class="eb-score-total-row"><span class="eb-score-cat">Total scores</span>
      ${players.map((p) => `<span class="eb-score-cell">${p.totalScore}</span>`).join('')}</div>`;

    const footnotes = players.map((p) => {
      const bonus = p.roundItems.filter((it) => it.key === 'cardsBonus' || it.key === 'allCoins' || it.key === 'allSevens');
      if (!bonus.length) return '';
      return `<p class="eb-score-footnote">${p.avatar} ${esc(p.name)}: ${bonus.map((b) => esc(b.label)).join(' · ')}</p>`;
    }).join('');

    return `<div class="eb-score-tablewrap"><div class="eb-score-grid" style="--eb-players:${players.length}">
        ${head}${rows}${pointsRow}${totalRow}
      </div></div>
      ${footnotes}`;
  }

  _renderRoundModal() {
    const g = this.game;
    const body = this._chartView ? this.renderChartBlock() : this._renderScoreTable(g);
    this.el.modal.innerHTML = `<div class="eb-scrim"></div><div class="eb-sheet">
      <h2 class="eb-sheet-title">Round ${g.round}</h2>
      ${body}
      <div class="eb-sheet-actions">
        <button class="eb-btn eb-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Table' : '📈 Scoreboard'}</button>
        <button class="eb-btn eb-btn-primary" data-action="next-round">Next round</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  showMatchModal() {
    this._renderMatchModal();
    const humanWon = this.game.winner && this.game.winner.id === 0;
    if (humanWon && !this._celebrated) { this._celebrate(); this._celebrated = true; }
  }

  _renderMatchModal() {
    const g = this.game;
    const standings = g.standings || g.players;
    const winner = g.winner;
    const body = this._chartView ? this.renderChartBlock() : `<ol class="eb-standings">${standings.map((p, i) => `<li class="${p === winner ? 'is-winner' : ''}">
        <span class="eb-rank">${i + 1}</span><span>${p.avatar} ${esc(p.name)}</span><span class="num">${p.totalScore}</span></li>`).join('')}</ol>`;
    const reason = g.matchEndReason === 'whitewash'
      ? `<p class="eb-sheet-sub">Opponent captured no cards: instant win</p>` : '';
    this.el.modal.innerHTML = `<div class="eb-scrim" data-action="close-match"></div><div class="eb-sheet">
      <button class="eb-sheet-x" data-action="close-match" aria-label="Close">✕</button>
      <h2 class="eb-sheet-title">${winner.avatar} ${esc(winner.name)} wins!</h2>
      ${reason}
      ${body}
      <div class="eb-sheet-actions">
        <button class="eb-btn eb-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Standings' : '📈 Scoreboard'}</button>
        <button class="eb-btn eb-btn-primary" data-action="new-game">New game</button>
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
    const cap = g.config.targetScore;
    const maxHist = Math.max(...players.flatMap((p) => p.scoreHistory), 10);
    const domainMax = Math.max(cap, maxHist);
    const x = (r) => padL + (W - padL - padR) * (r / maxRound);
    const y = (v) => padT + (H - padT - padB) * (1 - v / domainMax);

    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const gy = padT + (H - padT - padB) * f;
      return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="eb-grid"/>`;
    }).join('');
    const capLine = `<line x1="${padL}" y1="${y(cap).toFixed(1)}" x2="${W - padR}" y2="${y(cap).toFixed(1)}" class="eb-caprule"/>
      <text x="${W - padR}" y="${(y(cap) - 3).toFixed(1)}" class="eb-axis" text-anchor="end">target ${cap}</text>`;
    const yLabels = `<text x="${padL - 4}" y="${(y(0) + 3).toFixed(1)}" class="eb-axis" text-anchor="end">0</text>
      <text x="${padL - 4}" y="${(y(domainMax) + 8).toFixed(1)}" class="eb-axis" text-anchor="end">${domainMax}</text>`;
    const xLabels = `<text x="${padL}" y="${H - 6}" class="eb-axis" text-anchor="start">R0</text>
      <text x="${W - padR}" y="${H - 6}" class="eb-axis" text-anchor="end">R${maxRound}</text>`;

    const lines = players.map((p, idx) => {
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const pts = p.scoreHistory.map((s, r) => `${x(r).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
      const dots = p.scoreHistory.map((s, r) => `<circle cx="${x(r).toFixed(1)}" cy="${y(s).toFixed(1)}" r="2.6" fill="${color}"/>`).join('');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>${dots}`;
    }).join('');

    const legend = players.map((p, idx) =>
      `<span class="eb-legend-item"><span class="eb-legend-dot" style="background:${PLAYER_COLORS[idx % PLAYER_COLORS.length]}"></span>${p.avatar} ${esc(p.name)} · ${p.totalScore}</span>`).join('');

    return `<div class="eb-chart">
      <svg viewBox="0 0 ${W} ${H}" class="eb-chart-svg" role="img" aria-label="Cumulative score by round">
        ${grid}${capLine}${yLabels}${xLabels}${lines}
      </svg>
      <div class="eb-legend">${legend}</div>
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

  // --- mat-anchored announcements + confetti ---------------------------------

  /** Transient, absolutely-positioned pill anchored to the mat (never the
   *  page bottom): announces AI plays, deals and leftovers without disturbing
   *  the fixed game geometry (Task 5). */
  announce(msg) {
    if (this._dead || !this.el || !this.el.announce) return;
    this.el.announce.textContent = msg;
    this.el.announce.classList.add('is-in');
    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => {
      if (this.el && this.el.announce) this.el.announce.classList.remove('is-in');
    }, BEAT_ANNOUNCE);
  }

  /** Confetti burst: a short, self-contained celebration (no libraries). */
  _celebrate() {
    if (this._dead || !this.root) return;
    const layer = document.createElement('div');
    layer.className = 'eb-confetti';
    const colors = ['#f7b500', '#ff5c4d', '#2878ff', '#22a84f', '#ffd84d', '#ff8ad0'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      const left = Math.round((i / 70) * 100);
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
    switch (a.dataset.action) {
      // setup
      case 'set-count': this.syncSetupInputs(); this._setup.count = +a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'set-target': this.syncSetupInputs(); this._setup.targetScore = +a.dataset.v; this._saveSetup(); this.renderSetup(); break;
      case 'set-deckmode': this.syncSetupInputs(); this._setup.deckMode = a.dataset.v; this._setup.deckModeChosen = true; this._saveSetup(); this.renderSetup(); break;
      case 'set-assist': this.syncSetupInputs(); this._setup.assist = a.dataset.v === 'on'; this._saveSetup(); this.renderSetup(); break;
      case 'set-aidiff': {
        this.syncSetupInputs();
        const i = +a.closest('.eb-segmented').dataset.i;
        this._setup.aiDifficulty[i] = a.dataset.v;
        this._saveSetup(); this.renderSetup(); break;
      }
      case 'open-avatar': this.syncSetupInputs(); this._openAvatarPicker(); break;
      case 'pick-avatar': this._setup.humanAvatar = a.dataset.v; this._saveSetup(); this._closeModal(); this.renderSetup(); break;
      case 'close-modal': this._closeModal(); break;
      case 'open-howto': if (!this.el.setup.hidden) this.syncSetupInputs(); this._closeMenu(); this._openHowTo(); break;
      case 'close-howto': this._closeModal(); break;
      case 'start': this.startGame(); break;
      case 'resume-game': this._resumeGame(); break;
      // game
      case 'card': this.onCardTap(a.dataset.id); break;
      case 'capture': this._confirmCapture(); break;
      case 'lay': this._confirmLay(); break;
      case 'toggle-chart': this._chartView = !this._chartView; if (this._modalResolve) this._renderRoundModal(); else this._renderMatchModal(); break;
      case 'next-round': this._resolveModal(); break;
      case 'new-game': this.startGame(); break;
      case 'show-results': this.showMatchModal(); break;
      case 'close-match': this._closeModal(); this.render(); break;
      // in-game menu
      case 'open-menu': this._openMenu(); break;
      case 'close-menu': case 'menu-resume': this._closeMenu(); break;
      case 'menu-newgame': this._menuAction('newgame'); break;
      case 'menu-quit': this._menuAction('quit'); break;
    }
  }

  // --- in-game menu ---------------------------------------------------------

  _inProgress() {
    return !!this.game && !this.el.game.hidden && !this._matchEnded;
  }

  _openMenu() { this._menuConfirm = null; this._renderMenu(); this.el.menu.hidden = false; }
  _closeMenu() { if (this.el && this.el.menu) { this.el.menu.hidden = true; } this._menuConfirm = null; }

  _renderMenu() {
    const btn = (which, label) => {
      const confirming = this._menuConfirm === which;
      return `<button class="eb-btn eb-btn-ghost ${confirming ? 'eb-confirm' : ''}" data-action="menu-${which}">${
        confirming ? 'Tap again: this game will be lost' : label}</button>`;
    };
    this.el.menu.innerHTML = `<div class="eb-scrim" data-action="close-menu"></div>
      <div class="eb-sheet eb-menu-sheet">
        <h2 class="eb-sheet-title">Menu</h2>
        <button class="eb-btn eb-btn-ghost" data-action="open-howto">📖 How to play</button>
        ${btn('newgame', 'New game (same settings)')}
        ${btn('quit', 'Quit to setup')}
        <button class="eb-btn eb-btn-primary" data-action="menu-resume">Resume game</button>
      </div>`;
  }

  /** Destructive menu actions confirm-on-second-tap while a match is live.
   *  Both actually clear the resumable save (an explicit in-game abandon),
   *  unlike leaving via the hub's own back button, which now preserves it. */
  _menuAction(which) {
    if (this._inProgress() && this._menuConfirm !== which) {
      this._menuConfirm = which;
      this._renderMenu();
      return;
    }
    this._closeMenu();
    if (which === 'newgame') this.startGame();
    else { this._clearSave(); this.showSetup(); }
  }

  // --- teardown -------------------------------------------------------------

  destroy() {
    this._dead = true;
    // Deliberately do NOT clear the resumable save here: destroy() runs when
    // the hub tears the module down for ANY reason, including the player
    // just navigating back to the launcher mid-match, which is exactly the
    // case resume exists for.
    if (this.game) this.game.abort();
    this._resolvePending(null);
    this._resolveModal();
    if (this.root) this.root.removeEventListener('click', this._onClick);
    if (this._matResizeObserver) this._matResizeObserver.disconnect();
    if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
    clearTimeout(this._beatTimer);
    clearTimeout(this._announceTimer);
    clearTimeout(this._bannerTimer);
    clearTimeout(this._broomTimer);
    clearTimeout(this._shakeTimer);
    clearTimeout(this._actionShakeTimer);
    this.game = null;
    this.container.innerHTML = '';
  }
}

// --- module contract --------------------------------------------------------

let instance = null;

/** Mount Escoba into `container`. Replaces any prior instance. */
export function init(container) {
  if (instance) instance.destroy();
  instance = new EscobaUI(container);
  return instance;
}

/** Tear down the mounted game. */
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** Escoba persists its match on every state change and can resume after being
 *  unmounted (see _saveSnapshot/_resumeGame), so leaving via the hub's back
 *  button never loses progress: the hub never needs its "you'll lose your
 *  progress" confirm for this game. The in-game menu's own "Quit to setup"
 *  still warns and clears the save, since that IS an explicit abandon. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
