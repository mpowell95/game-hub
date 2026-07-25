// ui.js - Uno UI module. Hub contract: init(container) / destroy() / isInProgress().
//
// Human is always engine seat 0; seats 1..n-1 are AI, filled from the shared profile's
// opponents (rotated by `nextStarter` for variety - see startGame()). Colorblind-safe by
// construction: every one of the four colors always carries its own shape glyph (circle/
// triangle/square/diamond), on cards, the color chooser, and the current-color chip.

import { UnoGame, COLORS } from './game.js';
import { chooseAction } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.uno.v1';
const SAVE_KEY = 'gamehub.uno.save.v1';
const HUMAN = 0;

const AI_THINK_MS = 650;
const DRAW_STEP_MS = 420;
const MAX_SAVE_AGE_MS = 30 * 60 * 1000;
const PENALTY_TOAST_MS = 2200;

const COLOR_META = {
  red: { hex: '#E0532F', shape: 'square', labelKey: 'color_red' },
  yellow: { hex: '#F2B705', shape: 'circle', labelKey: 'color_yellow' },
  green: { hex: '#178A7A', shape: 'diamond', labelKey: 'color_green' },
  blue: { hex: '#1F5FA8', shape: 'triangle', labelKey: 'color_blue' },
};

const DIFF_KEYS = [['easy', 'diff_easy'], ['medium', 'diff_medium'], ['hard', 'diff_hard']];
const DIFF_SKILL = { 1: 'easy', 2: 'medium', 3: 'hard' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureStylesheet() {
  const href = new URL('../css/uno.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/uno.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function shapeSVG(shape, fill) {
  if (shape === 'circle') return `<circle cx="6" cy="6" r="5" fill="${fill}"/>`;
  if (shape === 'triangle') return `<path d="M6,1 L11,10.5 L1,10.5 Z" fill="${fill}"/>`;
  if (shape === 'square') return `<rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="${fill}"/>`;
  if (shape === 'diamond') return `<rect x="3" y="3" width="6" height="6" fill="${fill}" transform="rotate(45 6 6)"/>`;
  return '';
}

/** Small curved play-direction arrow (clockwise when `cw`), mirrored for counter-clockwise.
 *  Style mirrors js/difficulty-tiers.js's inline-SVG glyph pattern (currentColor, aria-hidden). */
function dirArrowSVG(cw) {
  const inner = '<path d="M18.4 7.4 A8 8 0 1 0 20 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M13.9 5.7 L19.4 6.7 L18.3 12.1 Z" fill="currentColor"/>';
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${cw ? inner : `<g transform="translate(24,0) scale(-1,1)">${inner}</g>`}</svg>`;
}

function colorGlyphHTML(color, size = 12) {
  const m = COLOR_META[color];
  if (!m) return '';
  return `<svg class="un-glyph" width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">${shapeSVG(m.shape, '#fff')}</svg>`;
}

function cardFaceGlyph(card) {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'skip') return '⊘';
  if (card.kind === 'reverse') return '⇄';
  if (card.kind === 'draw2') return '+2';
  if (card.kind === 'wild') return '★';
  if (card.kind === 'wild4') return '+4';
  return '';
}

function cardAriaLabel(card) {
  if (card.kind === 'wild') return t('aria_wild');
  if (card.kind === 'wild4') return t('aria_wild4');
  const colorName = t(COLOR_META[card.color].labelKey);
  const value = card.kind === 'number' ? card.value
    : card.kind === 'skip' ? '⊘' : card.kind === 'reverse' ? '⇄' : '+2';
  return t('aria_card', { color: colorName, value });
}

/** Card face markup. `live` toggles the playable highlight; `back` renders a face-down card. */
function cardHTML(card, { live = false, back = false, small = false } = {}) {
  if (back) return `<div class="un-card un-back ${small ? 'un-card-sm' : ''}" aria-hidden="true"></div>`;
  const isWild = card.color === 'wild';
  const glyph = cardFaceGlyph(card);
  const corner = isWild ? '' : `<span class="un-corner un-corner-tl">${colorGlyphHTML(card.color)}${glyph}</span>
    <span class="un-corner un-corner-br">${colorGlyphHTML(card.color)}${glyph}</span>`;
  return `<button type="button" class="un-card ${small ? 'un-card-sm' : ''} ${live ? 'is-live' : ''}"
      data-color="${card.color}" data-kind="${card.kind}" data-action="${live ? 'play-card' : ''}" data-id="${card.id}"
      ${live ? '' : 'disabled tabindex="-1"'} aria-label="${esc(cardAriaLabel(card))}">
    ${corner}
    <span class="un-face">${isWild ? `<span class="un-wildquad" aria-hidden="true">${COLORS.map((c) => `<span data-color="${c}"></span>`).join('')}</span>` : ''}<span class="un-glyph-big">${glyph}</span></span>
  </button>`;
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    const p = Math.round(Number(raw.players));
    if (p >= 2 && p <= 4) out.players = p;
    if (DIFF_KEYS.some(([k]) => k === raw.difficulty)) out.difficulty = raw.difficulty;
    if (Number.isInteger(raw.nextStarter)) out.nextStarter = raw.nextStarter;
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

function saveSettings(players, difficulty, nextStarter) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ players, difficulty, nextStarter })); } catch { /* ignore */ }
}

function saveGame(ui) {
  try {
    if (!ui.game || ui.game.phase === 'over' || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, at: Date.now(), seats: ui.seats, difficulty: ui.difficulty, snap: ui.game.snapshot(),
    }));
  } catch { /* a full quota must never break the game */ }
}

function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (Date.now() - Number(raw.at || 0) > MAX_SAVE_AGE_MS) return null;
    if (!Array.isArray(raw.seats) || raw.seats.length < 2 || raw.seats.length > 4) return null;
    if (!raw.snap || !Array.isArray(raw.snap.players) || raw.snap.players.length !== raw.seats.length) return null;
    if (raw.snap.phase === 'over') return null;
    if (!DIFF_KEYS.some(([k]) => k === raw.difficulty)) return null;
    return raw;
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

class UnoUI {
  constructor(container) {
    this.container = container;
    const profile = loadProfile();
    this.profile = profile;
    this.humanName = (profile && profile.name) || t('you');
    this.humanEmoji = (profile && profile.emoji) || '🙂';

    const saved = loadSettings();
    this.players = (saved && saved.players) || 2;
    const oppSkill = profile && profile.opponents && profile.opponents[0] && profile.opponents[0].skill;
    this.difficulty = (saved && saved.difficulty) || DIFF_SKILL[oppSkill] || 'medium';
    this.nextStarter = (saved && saved.nextStarter) || 0;

    this.game = null;
    this.seats = null;
    this.view = 'setup';
    this.busy = false;
    this.timers = [];
    this._pendingWildId = null;
    this._setupExpanded = null;
    this._penaltyToast = null;
    this._penaltyTimer = null;

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };
    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);

    const inProgress = loadGame();
    if (inProgress) this.resumeGame(inProgress); else this.renderSetup();
  }

  destroy() {
    saveGame(this);
    for (const tm of this.timers) clearTimeout(tm);
    this.timers = [];
    clearTimeout(this._confirmTimer);
    clearTimeout(this._penaltyTimer);
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    this.container.innerHTML = '';
    this.game = null;
  }

  later(fn, ms) {
    const tm = setTimeout(() => { this.timers = this.timers.filter((x) => x !== tm); fn(); }, ms);
    this.timers.push(tm);
    return tm;
  }

  _isAI(pi) { return !!(this.seats && this.seats[pi] && this.seats[pi].isAI); }

  _buildSeats(playerCount) {
    const pool = (this.profile && Array.isArray(this.profile.opponents)) ? this.profile.opponents.slice(0, 3) : [];
    const seats = [{ name: this.humanName, emoji: this.humanEmoji, isAI: false }];
    for (let i = 0; i < playerCount - 1; i++) {
      const o = pool[i];
      seats.push({ name: (o && o.name) || t('computer_n', { n: i + 1 }), emoji: (o && o.emoji) || '🤖', isAI: true });
    }
    return seats;
  }

  // --- setup screen ------------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="un-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="un-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="un-row ${open ? 'is-open' : ''}">
      <button type="button" class="un-row-head" data-action="toggle-row" data-row="${key}">
        <span class="un-row-label">${label}</span><span class="un-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="un-row-expand">${content}</div>` : ''}
    </div>`;
  }

  renderSetup() {
    this.view = 'setup';
    this.game = null;
    const playersContent = this._seg('set-players', this.players, [2, 3, 4].map((n) => [n, String(n)]));
    const diffContent = this._seg('set-diff', this.difficulty, DIFF_KEYS.map(([v, k]) => [v, diffShapeSVG(tierOf(v)) + esc(t(k))]));
    this.container.innerHTML = `
      <div class="un-root">
        <div class="un-shell un-setup">
          <h2 class="un-title">${t('title')}</h2>
          <p class="un-sub">${t('tagline')}</p>
          <div class="un-summary">
            ${this._row('players', t('row_players'), t('n_players', { n: this.players }), playersContent)}
            ${this._row('difficulty', t('row_difficulty'), t(DIFF_KEYS.find(([v]) => v === this.difficulty)[1]), diffContent)}
          </div>
          <button type="button" class="un-primary" data-action="start">${t('start')}</button>
          <button type="button" class="un-ghost" data-action="help">${t('howto')}</button>
        </div>
      </div>`;
  }

  // --- game lifecycle ------------------------------------------------------------

  startGame() {
    // Alternate who OPENS the hand across all seats, human included - the engine's
    // first-card flip only randomizes which card starts the discard, never who acts on
    // it, so without this the same seat (the human, seat 0) would open ~70% of hands
    // (every first flip except an action card that redirects it). Banked immediately,
    // before the game is built, so the rotation survives leaving mid-game (mirrors
    // mancala/js/ui.js's startGame() alternation).
    const startPlayer = this.nextStarter % this.players;
    this.nextStarter = (startPlayer + 1) % this.players;
    saveSettings(this.players, this.difficulty, this.nextStarter);
    clearGame();
    this.seats = this._buildSeats(this.players);
    this.game = new UnoGame({ playerCount: this.players, startPlayer, onEvent: (type, p) => this._onEngineEvent(type, p) });
    this.view = 'game';
    this._afterStateChange();
  }

  resumeGame(saved) {
    this.seats = saved.seats;
    this.players = saved.seats.length;
    this.difficulty = saved.difficulty;
    this.game = UnoGame.fromSnapshot(saved.snap, { onEvent: (type, p) => this._onEngineEvent(type, p) });
    this.view = 'game';
    this._afterStateChange();
  }

  /** Engine event hook. Announces a penalty draw (a +2 stack lump, a Wild+4 victim, or a
   *  first-card +2) as a short auto-dismissing toast; the badge/render already show the live
   *  pending amount, this names the moment the cards actually land. */
  _onEngineEvent(type, payload) {
    if (type !== 'penaltyDraw') return;
    const pi = payload.playerIndex;
    const n = payload.amount;
    const name = (this.seats && this.seats[pi]) ? this.seats[pi].name : '';
    this._penaltyToast = pi === HUMAN ? t('penalty_draw_you', { n }) : t('penalty_draw_opp', { name, n });
    clearTimeout(this._penaltyTimer);
    this._penaltyTimer = setTimeout(() => {
      this._penaltyToast = null;
      if (this.view === 'game' && this.game) this.renderGame();
    }, PENALTY_TOAST_MS);
  }

  /** Single funnel after every engine action: checkpoint, render, resolve a finished
   *  game, or schedule whoever's turn it is next (AI think pause, or an automatic
   *  draw-until-playable step when there is truly no legal card to choose). */
  _afterStateChange() {
    saveGame(this);
    const g = this.game;
    if (!g) { this.renderGame(); return; }
    if (g.phase === 'over') { this.busy = false; this.renderGame(); this.finish(); return; }
    if (g.phase === 'chooseColor') { this.busy = false; this.renderGame(); return; } // first-card wild: human resolves via the overlay

    // Resolve busy/scheduling BEFORE rendering, so the render reflects whose move it
    // actually is right now rather than the state left over from the previous call.
    const pi = g.currentPlayer;
    const legal = g.getLegalMoves(pi);
    const autoDraw = legal.mustDraw; // no legal card at all (or a penalty stack you can't answer) - not a real decision
    if (this._isAI(pi)) {
      this.busy = true;
      this.renderGame();
      this.later(() => this._aiStep(), autoDraw ? DRAW_STEP_MS : AI_THINK_MS);
    } else if (autoDraw) {
      this.busy = true;
      this.renderGame();
      this.later(() => { g.draw(pi); this._afterStateChange(); }, DRAW_STEP_MS);
    } else {
      this.busy = false;
      this.renderGame();
    }
  }

  _aiStep() {
    const g = this.game;
    if (!g || g.phase !== 'playing') return;
    const pi = g.currentPlayer;
    const action = chooseAction(g, pi, this.difficulty, Math.random);
    if (action.type === 'draw') g.draw(pi);
    else g.play(pi, action.cardId, action.color);
    this._afterStateChange();
  }

  // --- game rendering ------------------------------------------------------------

  _seatStatusText() {
    const g = this.game;
    if (g.phase === 'over') return t('game_over');
    const pi = g.phase === 'chooseColor' ? g.pendingWild.playerIndex : g.currentPlayer;
    if (pi === HUMAN) return t('your_turn');
    if (this.busy) return t('opp_thinking', { name: this.seats[pi].name });
    return t('opp_turn', { name: this.seats[pi].name });
  }

  _colorChooserHTML() {
    return `<div class="un-colorchoose" role="dialog" aria-modal="true" aria-label="${t('choose_color')}">
      <p class="un-cc-title">${t('choose_color')}</p>
      <div class="un-cc-grid">
        ${COLORS.map((c) => `<button type="button" class="un-cc-btn" data-action="choose-color" data-color="${c}"
          style="--un-cc: ${COLOR_META[c].hex}" aria-label="${esc(t(COLOR_META[c].labelKey))}">${colorGlyphHTML(c, 22)}</button>`).join('')}
      </div>
    </div>`;
  }

  renderGame() {
    const g = this.game;
    const opponents = this.seats.map((s, i) => i).filter((i) => i !== HUMAN);
    const activeColor = g.activeColor;
    const top = g.discard[g.discard.length - 1];
    const pi = g.phase === 'chooseColor' ? -1 : g.currentPlayer;
    const legal = g.phase === 'playing' ? g.getLegalMoves(HUMAN) : { canPlay: [], mustDraw: false };
    const humanTurn = pi === HUMAN && !this.busy;
    const legalIds = new Set(legal.canPlay.map((c) => c.id));
    const drawTappable = humanTurn && g.pendingDraw > 0 && !legal.mustDraw;

    const showFirstCardChooser = g.phase === 'chooseColor' && g.pendingWild.isFirstCard;
    const showCardWildChooser = this._pendingWildId != null;
    const chooserOpen = showFirstCardChooser || showCardWildChooser;
    const showDir = this.seats.length > 2 && g.phase !== 'over';

    this.container.innerHTML = `
      <div class="un-root">
        <div class="un-shell un-game">
          <div class="un-opponents">
            ${opponents.map((i) => `
              <div class="un-oppchip ${g.phase !== 'over' && g.currentPlayer === i ? 'is-turn' : ''}">
                <span class="un-oppemoji">${esc(this.seats[i].emoji)}</span>
                <span class="un-oppname">${esc(this.seats[i].name)}</span>
                <span class="un-oppcount">${g.players[i].hand.length}</span>
                ${g.players[i].hand.length === 1 ? `<span class="un-unochip">${t('uno_banner')}</span>` : ''}
              </div>`).join('')}
          </div>

          <p class="un-status" aria-live="polite">${chooserOpen ? '' : esc(this._seatStatusText())}</p>

          <div class="un-mat">
            <button type="button" class="un-pile un-drawpile ${drawTappable ? 'is-live' : ''}" data-action="draw-pile"
              ${drawTappable ? '' : 'disabled'} aria-label="${esc(t('aria_draw_pile', { n: g.deck.length }))}">
              ${cardHTML({ id: -1, color: 'wild', kind: 'wild', value: null }, { back: true })}
              <span class="un-pilecount">${g.deck.length}</span>
            </button>
            <div class="un-pile un-discardpile" aria-label="${esc(t('aria_discard_pile', { card: cardAriaLabel(top) }))}">
              ${cardHTML(top, {})}
              <span class="un-colorchip" data-color="${activeColor || top.color}" aria-hidden="true">${activeColor ? colorGlyphHTML(activeColor, 14) : ''}</span>
            </div>
            ${showDir ? `<span class="un-dir" role="img" aria-label="${esc(t(g.direction === 1 ? 'direction_cw' : 'direction_ccw'))}">${dirArrowSVG(g.direction === 1)}</span>` : ''}
            ${g.pendingDraw > 0 ? `<span class="un-pendingbadge">${esc(t('pending_draw', { n: g.pendingDraw }))}</span>` : ''}
            ${chooserOpen ? this._colorChooserHTML() : ''}
          </div>

          ${this._penaltyToast ? `<div class="un-toast" role="status">${esc(this._penaltyToast)}</div>` : ''}

          <div class="un-handwrap">
            ${g.players[HUMAN].hand.length === 1 ? `<span class="un-unochip un-unochip-self">${t('uno_banner')}</span>` : ''}
            <div class="un-hand" role="list" aria-label="${esc(this.humanName)}">
              ${g.players[HUMAN].hand.map((c) => cardHTML(c, { live: humanTurn && legalIds.has(c.id) })).join('')}
            </div>
          </div>

          <footer class="un-bar">
            <button type="button" class="un-ghost un-small" data-action="help">${t('howto')}</button>
            <button type="button" class="un-ghost un-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
            <button type="button" class="un-ghost un-small" data-action="newgame">${t('new_game')}</button>
          </footer>
        </div>
      </div>`;
  }

  // --- end of game -----------------------------------------------------------

  finish() {
    const g = this.game;
    const won = g.winner === HUMAN;
    try { recordResult('uno', this.difficulty, won); } catch { /* never block the result */ }
    clearGame();

    const winnerSeat = this.seats[g.winner];
    const title = won ? t('you_win') : t('opp_wins', { name: winnerSeat.name });
    const overlay = document.createElement('div');
    overlay.className = 'un-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="un-scrim" data-action="close-overlay"></div>
      <div class="un-card2" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="un-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="un-card2-emoji">${won ? '🏆' : esc(winnerSeat.emoji)}</span>
        <h3 class="un-card2-title">${esc(title)}</h3>
        <div class="un-card2-actions">
          <button type="button" class="un-primary" data-action="rematch">${t('play_again')}</button>
          <button type="button" class="un-ghost" data-action="newgame">${t('change_settings')}</button>
        </div>
      </div>`;
    this.container.querySelector('.un-root').appendChild(overlay);
  }

  // --- how to play -----------------------------------------------------------

  _diagramHTML() {
    const pile = { color: 'red', kind: 'number', value: 7 };
    const match1 = { color: 'red', kind: 'number', value: 3 };
    const match2 = { color: 'yellow', kind: 'number', value: 7 };
    const wild = { color: 'wild', kind: 'wild', value: null };
    return `<svg class="un-diagram" viewBox="0 0 260 110" role="img" aria-label="${esc(t('help_caption'))}">
      <foreignObject x="0" y="0" width="70" height="100">${cardHTML(pile, { small: true })}</foreignObject>
      <text x="90" y="55" class="un-dg-eq">=</text>
      <foreignObject x="105" y="0" width="70" height="100">${cardHTML(match1, { small: true })}</foreignObject>
      <foreignObject x="180" y="0" width="70" height="100">${cardHTML(match2, { small: true })}</foreignObject>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'un-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="un-scrim" data-action="close-overlay"></div>
      <div class="un-card2 un-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="un-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="un-card2-title">${t('howto')}</h3>
        <p class="un-help-lead">${t('help_lead')}</p>
        <div class="un-diagram-wrap">${this._diagramHTML()}</div>
        <p class="un-help-caption">${t('help_caption')}</p>
        <p class="un-help-example">${t('help_example')}</p>
        <ul class="un-help-bullets">
          <li>${t('help_bullet1')}</li>
          <li>${t('help_bullet2')}</li>
          <li>${t('help_bullet3')}</li>
          <li>${t('help_bullet4')}</li>
        </ul>
      </div>`;
    this.container.querySelector('.un-root').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.un-overlay').forEach((el) => el.remove());
  }

  // --- restart confirm guard --------------------------------------------------

  confirmDestructive(btn, action) {
    if (!this.game || this.game.phase === 'over') { action(); return; }
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
    const b = this.container.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  // --- events ------------------------------------------------------------------

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.container.contains(btn) || !btn.dataset.action) return;
    const action = btn.dataset.action;

    if (action === 'toggle-row') {
      const row = btn.dataset.row;
      this._setupExpanded = this._setupExpanded === row ? null : row;
      this.renderSetup();
    } else if (action === 'set-players') {
      this.players = Number(btn.dataset.v) || 2;
      saveSettings(this.players, this.difficulty, this.nextStarter);
      this.renderSetup();
    } else if (action === 'set-diff') {
      this.difficulty = btn.dataset.v;
      saveSettings(this.players, this.difficulty, this.nextStarter);
      this.renderSetup();
    } else if (action === 'start' || action === 'rematch') {
      this.startGame();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
    } else if (action === 'newgame') {
      this.renderSetup();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
    } else if (action === 'play-card') {
      this._onPlayCard(Number(btn.dataset.id));
    } else if (action === 'draw-pile') {
      if (this.busy || !this.game || this.game.currentPlayer !== HUMAN) return;
      this.game.draw(HUMAN);
      this._afterStateChange();
    } else if (action === 'choose-color') {
      this._onChooseColor(btn.dataset.color);
    }
  }

  _onPlayCard(cardId) {
    const g = this.game;
    if (this.busy || !g || g.phase !== 'playing' || g.currentPlayer !== HUMAN) return;
    const card = g.players[HUMAN].hand.find((c) => c.id === cardId);
    if (!card) return;
    if (card.kind === 'wild' || card.kind === 'wild4') {
      this._pendingWildId = cardId;
      this.renderGame();
      return;
    }
    const legal = g.getLegalMoves(HUMAN);
    if (!legal.canPlay.some((c) => c.id === cardId)) return;
    g.play(HUMAN, cardId);
    this._afterStateChange();
  }

  _onChooseColor(color) {
    const g = this.game;
    if (!COLORS.includes(color)) return;
    if (this._pendingWildId != null) {
      const id = this._pendingWildId;
      this._pendingWildId = null;
      g.play(HUMAN, id, color);
      this._afterStateChange();
    } else if (g.phase === 'chooseColor' && g.pendingWild && g.pendingWild.playerIndex === HUMAN) {
      g.chooseColor(HUMAN, color);
      this._afterStateChange();
    }
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new UnoUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** Autosave/resume built in: the match snapshots after every settled action and
 *  restores silently on the next mount, so leaving mid-game is lossless. Per root
 *  CLAUDE.md's "two legitimate meanings" for isInProgress(), this always returns
 *  `false` for solo play - the hub's "leave game?" confirm would be a lie. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
