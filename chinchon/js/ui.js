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

const AI_NAMES = ['Lucía', 'Mateo', 'Sofía'];
const AI_AVATARS = ['🦊', '🐼', '🦉'];
const HUMAN_AVATARS = ['🙂', '😎', '🦁', '🐯', '🐲', '👑', '🌟', '🐙'];
const DIFFICULTIES = [['easy', 'Easy'], ['normal', 'Average'], ['hard', 'Hard']];
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

/** Build a card face as an HTML string. `opts`: {selected, melded, dead, faceDown, static, mini}. */
function cardFaceHTML(card, opts = {}) {
  if (opts.faceDown) return '<div class="cc-card cc-back"></div>';
  const actionAttr = opts.static ? '' : ` data-action="card" data-id="${card.id}"`;
  const extra = opts.mini ? ' cc-mini' : '';
  if (card.isJoker) {
    return `<div class="cc-card cc-joker${extra}"${actionAttr}><span class="cc-corner cc-tl">★</span><span class="cc-pip">★</span><span class="cc-corner cc-br">★</span></div>`;
  }
  const glyph = SUIT_META[card.suit].glyph;
  const cls = ['cc-card', 'cc-suit-' + card.suit];
  if (opts.selected) cls.push('is-selected');
  if (opts.melded) cls.push('is-melded');
  if (opts.dead) cls.push('is-dead');
  if (opts.mini) cls.push('cc-mini');
  const r = card.rank;
  return `<div class="${cls.join(' ')}"${actionAttr}>` +
    `<span class="cc-corner cc-tl">${r}<i>${glyph}</i></span>` +
    `<span class="cc-pip">${glyph}</span>` +
    `<span class="cc-corner cc-br">${r}<i>${glyph}</i></span></div>`;
}

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
    this._onResize = () => this.layoutFan();

    ensureStylesheet();
    this.mount();
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(STORE_SETTINGS, {});
    return {
      count: clamp(saved.count || 3, 2, 4),
      humanName: typeof saved.humanName === 'string' ? saved.humanName : 'You',
      humanAvatar: HUMAN_AVATARS.includes(saved.humanAvatar) ? saved.humanAvatar : HUMAN_AVATARS[0],
      aiDifficulty: Array.isArray(saved.aiDifficulty) ? saved.aiDifficulty.slice(0, 3) : ['normal', 'normal', 'normal'],
      rulesOpen: false,
      config: Object.assign({}, DEFAULT_CONFIG, saved.config || {}),
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(STORE_SETTINGS, { count: s.count, humanName: s.humanName, humanAvatar: s.humanAvatar, aiDifficulty: s.aiDifficulty, config: s.config });
  }

  // --- DOM construction -----------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="cc-root">
        <header class="cc-header" data-role="header"><h1 class="cc-title">Chinchón</h1></header>
        <section class="cc-setup" data-role="setup"></section>
        <section class="cc-game" data-role="game" hidden>
          <div class="cc-opponents" data-role="opponents"></div>
          <div class="cc-mat">
            <div class="cc-piles" data-role="piles"></div>
            <div class="cc-status" data-role="status"></div>
          </div>
          <div class="cc-self" data-role="self"></div>
          <div class="cc-hand" data-role="hand"></div>
          <div class="cc-actions" data-role="actions"></div>
        </section>
        <div class="cc-modal" data-role="modal" hidden></div>
        <div class="cc-toast" data-role="toast" hidden></div>
      </div>`;

    this.root = this.container.querySelector('.cc-root');
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.el = {
      header: q('header'), setup: q('setup'), game: q('game'),
      opponents: q('opponents'), piles: q('piles'), status: q('status'),
      self: q('self'), hand: q('hand'), actions: q('actions'),
      modal: q('modal'), toast: q('toast'),
    };

    this.root.addEventListener('click', this._onClick);
    window.addEventListener('resize', this._onResize);
    this.showSetup();
  }

  // --- setup screen ---------------------------------------------------------

  showSetup() {
    if (this._dead) return;
    if (this.game) { this.game.abort(); this.game = null; }
    this._pending = null; this._selectedCardId = null; this.activePlayerId = null;
    this._modalResolve = null; this._placeResolve = null; this._chartView = false;
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
        <span class="cc-av">${AI_AVATARS[i]}</span>
        <span class="cc-player-name">${esc(AI_NAMES[i])}</span>
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

    this.el.setup.innerHTML = `
      <div class="cc-card-panel">
        ${statsLine}
        <p class="cc-lead">Spanish rummy. Build runs and sets, keep your hand light, and <em>close</em> when your leftover is small. Lowest score wins.</p>

        <div class="cc-section">
          <span class="cc-label">Players</span>
          ${seg('set-count', String(s.count), [['2', '2'], ['3', '3'], ['4', '4']])}
          <div class="cc-player-row">
            <button class="cc-av cc-av-btn" data-action="cycle-avatar" title="Change avatar">${s.humanAvatar}</button>
            <input class="cc-name-input" data-field="humanName" value="${esc(s.humanName)}" maxlength="14" aria-label="Your name">
          </div>
          ${aiRows.join('')}
        </div>

        <div class="cc-section">
          <button class="cc-rules-toggle" data-action="toggle-rules" aria-expanded="${s.rulesOpen}">
            <span class="cc-label">Rules</span><span class="cc-chevron">${s.rulesOpen ? '▾' : '▸'}</span></button>
          <div class="cc-rules" ${s.rulesOpen ? '' : 'hidden'}>${rulesBody}</div>
        </div>

        <button class="cc-btn cc-btn-primary" data-action="start">Start game</button>
      </div>`;
  }

  syncSetupInputs() {
    const input = this.el.setup.querySelector('[data-field="humanName"]');
    if (input) this._setup.humanName = input.value.trim() || 'You';
  }

  startGame() {
    this.syncSetupInputs();
    this._saveSetup();
    const s = this._setup;
    const players = [makePlayer({ id: 0, name: s.humanName || 'You', avatar: s.humanAvatar, isHuman: true, agent: this.humanAgent })];
    for (let i = 0; i < s.count - 1; i++) {
      const diff = s.aiDifficulty[i] || 'normal';
      players.push(makePlayer({
        id: i + 1, name: AI_NAMES[i], avatar: AI_AVATARS[i], difficulty: diff,
        agent: new AIAgent({ difficulty: diff, name: AI_NAMES[i] }),
      }));
    }
    const config = Object.assign({}, DEFAULT_CONFIG, s.config);
    this.game = new Game({ players, config });
    this.game.onEvent = (type, payload) => this.onEvent(type, payload);
    this._pending = null; this._selectedCardId = null; this.activePlayerId = null;
    this._matchCloses = 0; this._matchChinchons = 0; this._statsCommitted = false;

    this.el.setup.hidden = true; this.el.header.hidden = true; this.el.game.hidden = false;
    this.el.modal.hidden = true; this.el.modal.innerHTML = '';
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
  _diffLabel(p) {
    const found = DIFFICULTIES.find(([v]) => v === p.difficulty);
    return found ? found[1] : '';
  }

  render() {
    if (this._dead || !this.game || this.el.game.hidden) return;
    this.el.opponents.innerHTML = this.renderOpponents();
    this.el.piles.innerHTML = this.renderPiles();
    this.el.status.innerHTML = this.renderStatus();
    this.el.self.innerHTML = this.renderSelf();
    this.el.hand.innerHTML = this.renderHand();
    this.el.actions.innerHTML = this.renderActions();
    this.layoutFan();
  }

  renderOpponents() {
    return this.game.players.filter((p) => !p.isHuman).map((p) => {
      const active = p.id === this.activePlayerId;
      const backs = '<span class="cc-mini-back"></span>'.repeat(Math.min(p.hand.length, 7));
      return `<div class="cc-opp ${active ? 'is-active' : ''}">
        <span class="cc-opp-av">${p.avatar}</span>
        <span class="cc-opp-meta"><span class="cc-opp-name">${esc(p.name)}</span><span class="cc-opp-sub">${this._diffLabel(p)} · ${p.totalScore} pts</span></span>
        <span class="cc-opp-hand"><span class="cc-mini-stack">${backs}</span><span class="cc-opp-count">${p.hand.length}</span></span>
      </div>`;
    }).join('');
  }

  renderPiles() {
    const g = this.game;
    const top = g.discardTop();
    const drawMode = !!(this._pending && this._pending.kind === 'draw');
    const showCount = g.config.showRemaining;
    return `
      <button class="cc-pile cc-stock ${drawMode ? 'is-actionable' : ''}" data-action="draw-stock" ${drawMode ? '' : 'disabled'} aria-label="Draw from deck">
        <div class="cc-card cc-back"></div>
        ${showCount ? `<span class="cc-pile-count">${g.stock.length}</span>` : ''}
        <span class="cc-pile-label">Deck</span>
      </button>
      <button class="cc-pile cc-discard ${drawMode ? 'is-actionable' : ''}" data-action="draw-discard" ${drawMode ? '' : 'disabled'} aria-label="Take the discard">
        ${top ? cardFaceHTML(top, { static: true }) : '<div class="cc-card cc-empty"></div>'}
        <span class="cc-pile-label">Discard</span>
      </button>`;
  }

  renderStatus() {
    const g = this.game;
    const meta = `Round ${g.round} · Resets ${g.resetsUsed}/${g.config.maxResets}${g.config.showRemaining ? ` · Deck ${g.stock.length}` : ''}`;
    return `<span class="cc-status-text">${esc(this.statusText())}</span><span class="cc-meta">${meta}</span>`;
  }

  statusText() {
    if (this._pending) {
      if (this._pending.kind === 'draw') return 'Your turn — draw from the deck or take the discard.';
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
    return `<span class="cc-self-chip ${active ? 'is-active' : ''}">
      <span class="cc-opp-av">${h.avatar}</span>
      <span class="cc-self-name">${esc(h.name)}</span>
      <span class="cc-self-score">${h.totalScore} pts</span></span>`;
  }

  renderHand() {
    const h = this._human();
    const cfg = this.game.config;
    const bp = meld.bestPartition(h.hand, cfg);
    const meldedIdx = new Set();
    bp.melds.forEach((m) => m.idx.forEach((i) => meldedIdx.add(i)));
    const ordered = [];
    bp.melds.forEach((m) => m.idx.forEach((i) => ordered.push({ card: h.hand[i], melded: true })));
    h.hand.forEach((c, i) => { if (!meldedIdx.has(i)) ordered.push({ card: c, melded: false }); });
    return ordered.map((o) => cardFaceHTML(o.card, {
      selected: o.card.id === this._selectedCardId, melded: o.melded, dead: !o.melded,
    })).join('');
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

  /** Overlap the hand into a fan that fits the container width. */
  layoutFan() {
    if (this._dead || !this.el || !this.el.hand) return;
    const cards = [...this.el.hand.querySelectorAll('.cc-card')];
    const n = cards.length;
    if (!n) return;
    const cw = cards[0].offsetWidth || 60;
    const avail = this.el.hand.clientWidth - 8;
    const total = n * cw;
    const overlap = total > avail ? (total - avail) / (n - 1) : 0;
    cards.forEach((c, i) => {
      c.style.marginLeft = i === 0 ? '0' : `${-overlap}px`;
      c.style.zIndex = String(c.classList.contains('is-selected') ? 100 : i);
    });
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
    this.el.modal.innerHTML = `<div class="cc-scrim"></div><div class="cc-sheet">
      <h2 class="cc-sheet-title">${winner.avatar} ${esc(winner.name)} wins${reason}!</h2>
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
      case 'cycle-avatar': {
        this.syncSetupInputs();
        const i = HUMAN_AVATARS.indexOf(this._setup.humanAvatar);
        this._setup.humanAvatar = HUMAN_AVATARS[(i + 1) % HUMAN_AVATARS.length];
        this._saveSetup(); this.renderSetup(); break;
      }
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
      case 'card': this.onCardTap(a.dataset.id); break;
      case 'discard-confirm': if (pend && pend.kind === 'discard' && this._selectedCardId) this._resolvePending(this._selectedCardId); break;
      case 'close-yes': if (pend && pend.kind === 'close') this._resolvePending(true); break;
      case 'close-no': if (pend && pend.kind === 'close') this._resolvePending(false); break;
      case 'place-all': this._resolvePlace(this._placeIds || []); break;
      case 'place-skip': this._resolvePlace([]); break;
      case 'toggle-chart': this._chartView = !this._chartView; if (this._modalResolve) this._renderRoundModal(); else this._renderMatchModal(); break;
      case 'next-round': this._resolveModal(); break;
      case 'new-game': this.showSetup(); break;
    }
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
    window.removeEventListener('resize', this._onResize);
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

export default { init, destroy };
