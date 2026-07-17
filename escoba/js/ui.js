// ui.js : Escoba UI module. Exposes the hub contract: init(container)/destroy().
//
// The UI owns the DOM and implements a human agent whose chooseMove returns a
// promise resolved on tap, so the engine's async turn loop blocks on the human
// exactly as it resolves instantly on the AI. "Thinking" delays for AI turns
// are added here (never in the engine), in the awaited onEvent hook.

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

const BEAT_TURN = 650, BEAT_PLAY = 800, BEAT_CAPTURE = 520, BEAT_ESCOBA = 1250;
const STORE_SETTINGS = 'escoba-settings';

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

    this._setup = this._loadSetup();

    const ui = this;
    this.humanAgent = {
      isHuman: true,
      chooseMove: () => ui.promptMove(),
    };

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    preloadDeck();
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
      deckMode: saved.deckMode === 'spanish' ? 'spanish' : 'american',
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(STORE_SETTINGS, {
      count: s.count, humanName: s.humanName, humanAvatar: s.humanAvatar,
      aiNames: s.aiNames, aiDifficulty: s.aiDifficulty, targetScore: s.targetScore,
      deckMode: s.deckMode,
    });
  }

  // --- DOM construction -----------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="eb-root">
        <header class="eb-header" data-role="header"><h1 class="eb-title">Escoba</h1></header>
        <section class="eb-setup" data-role="setup"></section>
        <section class="eb-game" data-role="game" hidden>
          <div class="eb-topbar">
            <div class="eb-opponents" data-role="opponents"></div>
            <button class="eb-menu-btn" data-action="open-menu" aria-label="Game menu">☰</button>
          </div>
          <div class="eb-mat">
            <div class="eb-mat-side">
              <div class="eb-stock" data-role="stock"></div>
            </div>
            <div class="eb-table" data-role="table" aria-label="Table cards"></div>
          </div>
          <div class="eb-status" data-role="status"></div>
          <div class="eb-self-row" data-role="self"></div>
          <div class="eb-hand" data-role="hand"></div>
          <div class="eb-actions" data-role="actions"></div>
        </section>
        <div class="eb-modal" data-role="modal" hidden></div>
        <div class="eb-menu" data-role="menu" hidden></div>
        <div class="eb-toast" data-role="toast" hidden></div>
        <div class="eb-banner" data-role="banner" hidden></div>
      </div>`;

    this.root = this.container.querySelector('.eb-root');
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.el = {
      header: q('header'), setup: q('setup'), game: q('game'),
      opponents: q('opponents'), stock: q('stock'), table: q('table'),
      status: q('status'), self: q('self'), hand: q('hand'), actions: q('actions'),
      modal: q('modal'), menu: q('menu'), toast: q('toast'), banner: q('banner'),
    };

    this.root.addEventListener('click', this._onClick);
    this.showSetup();
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

    this.el.setup.innerHTML = `
      <div class="eb-panel">
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
          ${seg('set-deckmode', s.deckMode, [['american', 'American'], ['spanish', 'Spanish']])}
          <p class="eb-hint">${s.deckMode === 'american'
            ? 'Cards 1 to 10, every card counts the number printed on it. No Caballo or Rey.'
            : 'Traditional deck: Sota (printed 10) counts 8, Caballo (11) counts 9, Rey (12) counts 10.'}</p>
        </div>
        <button class="eb-howto-link" data-action="open-howto">📖 How to play</button>
        <button class="eb-btn eb-btn-primary" data-action="start">Start game</button>
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
    this.syncSetupInputs();
    this._saveSetup();
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
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._selHand = null; this._selTable.clear(); this.activePlayerId = null;
    this._matchEnded = false; this._matchEscobas = 0; this._statsCommitted = false;
    this._closeMenu();

    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
    this.render();
    this.game.playMatch().catch((err) => { if (!this._dead) console.error('Escoba match error', err); });
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

  // --- engine event hook (rendering + pacing) ----------------------------------

  async onEvent(type, payload) {
    if (this._dead) return;
    const p = payload && payload.playerId != null ? this.game.byId(payload.playerId) : null;
    switch (type) {
      case 'roundStart': {
        this.activePlayerId = null;
        const dealer = this.game.byId(payload.dealer);
        this.render();
        this.toast(`Round ${payload.round} · ${dealer.name} deals`);
        await this.beat(BEAT_TURN);
        break;
      }
      case 'deal':
        this.render();
        if (payload.lastCards) { this.toast('Last cards'); await this.beat(BEAT_TURN); }
        break;
      case 'initialEscoba':
        this.render();
        await this.showBanner(payload.count === 2 ? '¡ESCOBA! ×2' : '¡ESCOBA!', `${p.name} takes the opening table`);
        break;
      case 'turnStart':
        this.activePlayerId = payload.playerId;
        this.render();
        if (p && !p.isHuman) await this.beat(BEAT_TURN);
        break;
      case 'play':
        await this.animatePlay(p, payload);
        this.render();
        if (payload.escoba) await this.showBanner('¡ESCOBA!', `${p.name} clears the table`);
        break;
      case 'sweepLeftovers':
        this.render();
        this.toast(`${p.name} takes the leftover cards`);
        await this.beat(BEAT_PLAY);
        break;
      case 'roundScored':
        this._chartView = false;
        this._matchEscobas += this.game.byId(0).escobas;
        await this.showRoundModal();
        break;
      case 'matchEnd':
        this._matchEnded = true;
        this._commitStats();
        this._chartView = false;
        this.showMatchModal();
        break;
    }
  }

  beat(ms) { return new Promise((resolve) => { this._beatTimer = setTimeout(resolve, ms); }); }

  /** Show the AI's played card landing on the table, then fly captures out. */
  async animatePlay(p, { card, captured }) {
    if (this._dead) return;
    const isAI = p && !p.isHuman;
    // Drop the played card onto the table so both players see what was played.
    const node = document.createElement('template');
    node.innerHTML = cardFaceHTML(card, { static: true, value: true }).trim();
    const el = node.content.firstElementChild;
    el.classList.add('is-played');
    this.el.table.appendChild(el);
    if (isAI) {
      this.toast(captured.length
        ? `${p.name} plays ${cardLabel(card)} and captures ${captured.length}`
        : `${p.name} plays ${cardLabel(card)}`);
    }
    await this.beat(isAI ? BEAT_PLAY : 380);
    if (captured.length) {
      const ids = new Set(captured.map((c) => c.id));
      for (const cardEl of this.el.table.querySelectorAll('.eb-card')) {
        if (ids.has(cardEl.dataset.id) || cardEl === el) cardEl.classList.add('is-taken');
      }
      el.classList.add('is-taken');
      await this.beat(BEAT_CAPTURE);
    }
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
    this.el.stock.innerHTML = this.renderStock();
    this.el.table.innerHTML = this.renderTable();
    this.el.status.innerHTML = this.renderStatus();
    this.el.self.innerHTML = this.renderSelf();
    this.el.hand.innerHTML = this.renderHand();
    this.el.actions.innerHTML = this.renderActions();
  }

  _pileChips(p) {
    return `<span class="eb-pile-chip" title="Cards captured">🂠 ${p.captured.length}</span>` +
      (p.escobas ? `<span class="eb-pile-chip eb-pile-escoba" title="Escobas this round">🧹 ${p.escobas}</span>` : '');
  }

  renderOpponents() {
    const g = this.game;
    return g.players.filter((p) => !p.isHuman).map((p) => {
      const active = p.id === this.activePlayerId;
      const dealer = g.dealer === p.id;
      const cardsBack = Array.from({ length: p.hand.length }, () =>
        `<span class="eb-opp-cardback"></span>`).join('');
      return `<div class="eb-opp-pill ${active ? 'is-active' : ''}">
        <span class="eb-opp-av">${p.avatar}${dealer ? '<i class="eb-dealer-dot" title="Dealer">D</i>' : ''}</span>
        <span class="eb-opp-meta">
          <span class="eb-opp-name">${esc(p.name)}</span>
          <span class="eb-opp-sub">${p.totalScore} pts ${this._pileChips(p)}</span>
        </span>
        <span class="eb-opp-hand">${cardsBack}</span>
      </div>`;
    }).join('');
  }

  renderStock() {
    const g = this.game;
    if (!g.stock.length) return `<div class="eb-stock-empty"></div>`;
    return `${cardFaceHTML({}, { faceDown: true, static: true })}
      <span class="eb-stock-count">${g.stock.length}</span>`;
  }

  renderTable() {
    const g = this.game;
    const selCard = this._selCard();
    const hintIds = new Set();
    if (selCard) {
      for (const combo of this._optsFor(selCard)) for (const c of combo) hintIds.add(c.id);
    }
    if (!g.table.length) return `<div class="eb-table-empty">Table is clear</div>`;
    return g.table.map((c) => cardFaceHTML(c, {
      selected: this._selTable.has(c.id),
      hinted: hintIds.has(c.id) && !this._selTable.has(c.id),
      value: true,
    })).join('');
  }

  renderStatus() {
    const g = this.game;
    let text = '';
    if (this._pending) {
      const selCard = this._selCard();
      if (!selCard) text = 'Your turn: play a card';
      else if (this._optsFor(selCard).length) {
        const sum = selCard.value + sumValues(g.table.filter((c) => this._selTable.has(c.id)));
        text = `Pick table cards to make 15 · now ${sum}`;
      } else text = 'No capture: this card goes to the table';
    } else {
      const ap = this.activePlayerId != null ? g.byId(this.activePlayerId) : null;
      if (ap && !ap.isHuman) text = `${ap.name} is playing…`;
    }
    const pills = [`<span class="eb-pill">Round ${g.round}</span>`,
      `<span class="eb-pill">Target ${g.config.targetScore}</span>`];
    if (g.lastCards) pills.push('<span class="eb-pill eb-pill-last">Last cards</span>');
    return `<span class="eb-status-text">${esc(text)}</span><span class="eb-pills">${pills.join('')}</span>`;
  }

  renderSelf() {
    const h = this._human();
    const active = !!this._pending || this.activePlayerId === 0;
    const dealer = this.game.dealer === 0;
    return `<div class="eb-self-chip ${active ? 'is-active' : ''}">
      <span class="eb-self-av">${h.avatar}${dealer ? '<i class="eb-dealer-dot" title="Dealer">D</i>' : ''}</span>
      <span class="eb-self-name">${esc(h.name)}</span>
      <span class="eb-self-score">${h.totalScore} pts</span>
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

  renderActions() {
    if (!this._pending) return '';
    const selCard = this._selCard();
    if (!selCard) return '';
    const opts = this._optsFor(selCard);
    if (!opts.length) {
      return `<button class="eb-btn eb-btn-primary" data-action="lay">Place ${esc(cardLabel(selCard))}</button>`;
    }
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    const sum = selCard.value + sumValues(picked);
    const valid = picked.length > 0 && sum === 15;
    return `<button class="eb-btn eb-btn-primary" data-action="capture" ${valid ? '' : 'disabled'}>
        Capture ${valid ? `(${picked.length + 1} cards)` : `· ${sum} of 15`}</button>`;
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
      // Convenience: a single possible combo is preselected, ready to confirm.
      const card = this._selCard();
      if (card) {
        const opts = this._optsFor(card);
        if (opts.length === 1) for (const c of opts[0]) this._selTable.add(c.id);
      }
      this.render();
      return;
    }
    // Table card: toggle within the current hand selection.
    const card = this._selCard();
    if (!card) return;
    if (!this._optsFor(card).length) return;
    if (this._selTable.has(id)) this._selTable.delete(id);
    else this._selTable.add(id);
    this.render();
  }

  _confirmCapture() {
    const card = this._selCard();
    if (!card || !this._pending) return;
    const picked = this.game.table.filter((c) => this._selTable.has(c.id));
    if (card.value + sumValues(picked) !== 15 || !picked.length) return;
    const move = { cardId: card.id, captureIds: picked.map((c) => c.id) };
    this._resolvePending(move);
  }

  _confirmLay() {
    const card = this._selCard();
    if (!card || !this._pending) return;
    if (this._optsFor(card).length) return;   // capture is mandatory for this card
    this._resolvePending({ cardId: card.id, captureIds: [] });
  }

  // --- modals ---------------------------------------------------------------

  showRoundModal() {
    return new Promise((resolve) => { this._modalResolve = resolve; this._renderRoundModal(); });
  }

  _captureSummary(p) {
    const coins = p.captured.filter((c) => c.suit === 'oros').length;
    const sevens = p.captured.filter((c) => c.rank === 7).length;
    const guindis = p.captured.some((c) => c.suit === 'oros' && c.rank === 7);
    return `<span class="eb-sum-chips">
      <span class="eb-sum-chip">${p.captured.length} cards</span>
      <span class="eb-sum-chip">${coins} coins</span>
      <span class="eb-sum-chip">${sevens} sevens</span>
      ${guindis ? '<span class="eb-sum-chip eb-sum-guindis">guindis</span>' : ''}
      ${p.escobas ? `<span class="eb-sum-chip eb-sum-escoba">🧹 ${p.escobas}</span>` : ''}
    </span>`;
  }

  _renderRoundModal() {
    const g = this.game;
    let body;
    if (this._chartView) {
      body = this.renderChartBlock();
    } else {
      body = g.players.map((p) => {
        const items = p.roundItems.length
          ? p.roundItems.map((it) => `<li><span>${esc(it.label)}</span><b>+${it.points}</b></li>`).join('')
          : '<li class="eb-noitems"><span>No points this round</span><b>0</b></li>';
        return `<div class="eb-score-block">
          <div class="eb-score-head">
            <span class="eb-score-who">${p.avatar} ${esc(p.name)}</span>
            <span class="eb-score-nums"><b>+${p.roundScore}</b> · total ${p.totalScore}</span>
          </div>
          ${this._captureSummary(p)}
          <ul class="eb-score-items">${items}</ul>
        </div>`;
      }).join('');
    }
    this.el.modal.innerHTML = `<div class="eb-scrim"></div><div class="eb-sheet">
      <h2 class="eb-sheet-title">Round ${g.round}</h2>
      ${body}
      <div class="eb-sheet-actions">
        <button class="eb-btn eb-btn-ghost" data-action="toggle-chart">${this._chartView ? 'Scores' : '📈 Scoreboard'}</button>
        <button class="eb-btn eb-btn-primary" data-action="next-round">Next round</button>
      </div>
    </div>`;
    this.el.modal.hidden = false;
  }

  showMatchModal() {
    this._renderMatchModal();
    const humanWon = this.game.winner && this.game.winner.id === 0;
    if (humanWon) this._celebrate();
  }

  _renderMatchModal() {
    const g = this.game;
    const standings = g.standings || g.players;
    const winner = g.winner;
    let body;
    if (this._chartView) {
      body = this.renderChartBlock();
    } else {
      body = `<ol class="eb-standings">${standings.map((p, i) => `<li class="${p === winner ? 'is-winner' : ''}">
        <span class="eb-rank">${i + 1}</span><span>${p.avatar} ${esc(p.name)}</span><span class="num">${p.totalScore}</span></li>`).join('')}</ol>`;
    }
    const reason = g.matchEndReason === 'whitewash'
      ? `<p class="eb-sheet-sub">Opponent captured no cards: instant win</p>` : '';
    this.el.modal.innerHTML = `<div class="eb-scrim"></div><div class="eb-sheet">
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

  // --- toast + confetti -------------------------------------------------------

  toast(msg) {
    if (this._dead || !this.el || !this.el.toast) return;
    this.el.toast.textContent = msg;
    this.el.toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { if (this.el && this.el.toast) this.el.toast.hidden = true; }, 1600);
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
      case 'set-deckmode': this.syncSetupInputs(); this._setup.deckMode = a.dataset.v; this._saveSetup(); this.renderSetup(); break;
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
      // game
      case 'card': this.onCardTap(a.dataset.id); break;
      case 'capture': this._confirmCapture(); break;
      case 'lay': this._confirmLay(); break;
      case 'toggle-chart': this._chartView = !this._chartView; if (this._modalResolve) this._renderRoundModal(); else this._renderMatchModal(); break;
      case 'next-round': this._resolveModal(); break;
      case 'new-game': this.startGame(); break;
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

  // --- teardown -------------------------------------------------------------

  destroy() {
    this._dead = true;
    if (this.game) this.game.abort();
    this._resolvePending(null);
    this._resolveModal();
    if (this.root) this.root.removeEventListener('click', this._onClick);
    clearTimeout(this._beatTimer);
    clearTimeout(this._toastTimer);
    clearTimeout(this._bannerTimer);
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

/** True if a match is in progress (so the hub can confirm before unmounting). */
export function isInProgress() {
  return !!instance && instance._inProgress();
}

export default { init, destroy, isInProgress };
