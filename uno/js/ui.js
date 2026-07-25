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

// UN-4 (motion, spec §6). These are JS-side SCHEDULING numbers only (how long to hold a
// transient flag before clearing it / how long before a stray clone is force-cleaned) -
// the actual animated durations/easings live in uno.css as --un-dur-*/--un-ease-* tokens
// and are what the eye actually sees; these mirror them loosely for bookkeeping, the same
// pattern AI_THINK_MS/DRAW_STEP_MS above already use.
const AI_PULSE_MS = 340;      // row 12 chip pulse, matches --un-dur-play
const FLIGHT_SAFETY_MS = 900; // a clone must never outlive a re-render; generous vs. the longest flight (deal 420ms + up to ~7*55ms stagger)

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

/** Debossed shape medallion (spec §7). Reuses shapeSVG()/COLOR_META - never a second
 *  shape function. Wild cards get all four shapes quartered into one disc (each is the
 *  same shapeSVG() output, scaled to a quadrant) instead of a single shape, since a wild
 *  is the one card where four shapes coexist.
 *
 *  UN-4 note: the quartered disc used to be clipped with an SVG <clipPath id="un-wildclip-
 *  {card.id}">. UN-4's flight animations (rows 3/6/12) clone card nodes into a fixed
 *  overlay layer; SVG id references are document-global and resolve by first DOM match
 *  (some browsers additionally cache the resolved element by reference), so a cloned
 *  wild card's clip-path could lose its target mid-flight once the original node is
 *  removed from the fan, rendering the medallion unclipped for a frame. Fixed per session
 *  2's addendum by dropping the id/clipPath entirely and clipping via CSS `clip-path:
 *  circle()` on the wrapping .un-medallion element instead - no id, no document-global
 *  scope, so cloning is trivially safe. Verified: a Wild Draw Four's medallion stays
 *  circular through its entire flight animation. */
function medallionHTML(card) {
  const fill = 'var(--un-medallion)';
  if (card.color === 'wild') {
    return `<svg class="un-medallion un-medallion-wild" viewBox="0 0 12 12" aria-hidden="true">
      <g transform="translate(0,0) scale(.5)">${shapeSVG('square', fill)}</g>
      <g transform="translate(6,0) scale(.5)">${shapeSVG('circle', fill)}</g>
      <g transform="translate(0,6) scale(.5)">${shapeSVG('diamond', fill)}</g>
      <g transform="translate(6,6) scale(.5)">${shapeSVG('triangle', fill)}</g>
    </svg>`;
  }
  return `<svg class="un-medallion" viewBox="0 0 12 12" aria-hidden="true">${shapeSVG(COLOR_META[card.color].shape, fill)}</svg>`;
}

/** Card face markup. `live` toggles the playable highlight; `back` renders a face-down card.
 *  `extraClass`/`style` (UN-4) are purely additive hooks for one-shot motion classes and
 *  inline custom-property values (e.g. the discard pile's settle rotation) - every
 *  existing call site is unaffected since both default to empty.
 *  Layer order, outermost in (spec §7 / UN-2 handoff): card bg + rim (CSS on .un-card),
 *  gloss (::before, CSS only), medallion, numeral, corner mark. `.un-corner-br` is gone
 *  (spec §5: never visible in a fan, only steals face area) - top-left is the only corner. */
function cardHTML(card, { live = false, back = false, small = false, extraClass = '', style = '' } = {}) {
  if (back) return `<div class="un-card un-back ${small ? 'un-card-sm' : ''} ${extraClass}" style="${style}" aria-hidden="true"></div>`;
  const isWild = card.color === 'wild';
  const glyph = cardFaceGlyph(card);
  const isAction = card.kind !== 'number'; // action glyphs render smaller than digits (spec §3)
  const corner = isWild ? '' : `<span class="un-corner un-corner-tl">${colorGlyphHTML(card.color)}${glyph}</span>`;
  return `<button type="button" class="un-card ${small ? 'un-card-sm' : ''} ${live ? 'is-live' : ''} ${extraClass}"
      style="${style}"
      data-color="${card.color}" data-kind="${card.kind}" data-action="${live ? 'play-card' : ''}" data-id="${card.id}"
      ${live ? '' : 'disabled tabindex="-1"'} aria-label="${esc(cardAriaLabel(card))}">
    ${medallionHTML(card)}
    <span class="un-face"><span class="un-glyph-big ${isAction ? 'un-glyph-action' : ''}">${glyph}</span></span>
    ${corner}
  </button>`;
}

/** Fan geometry, spec §5. Pure: n -> per-card transforms + container fit scale.
 *  Design-space constants live here and nowhere else: W = card width, STEP = the
 *  constant exposed sliver per card, A = usable width (452px shell interior minus
 *  24px breathing room). The caller passes a measured A when the shell is
 *  narrower than the 480px design width, so the fan never overflows on phones.
 *  fit = min(1, A/need) is mathematically <= 1 for all n: the fan CANNOT exceed
 *  its box, which is what retires the old overflow-x scroll container. */
function fanLayout(n, { W = 62, STEP = 26, A = 428 } = {}) {
  const c = (n - 1) / 2;
  const rotStep = n > 1 ? Math.min(2.4, 26 / (n - 1)) : 0; // total arc capped at ~26deg
  const cards = [];
  for (let i = 0; i < n; i++) {
    const d = i - c;
    cards.push({
      x: d * STEP,
      y: Math.min(14, d * d * 0.55), // parabolic arc, capped
      rot: d * rotStep,
      z: i, // paint order stays positional: later (rightward) cards on top
    });
  }
  const need = STEP * (n - 1) + W;
  const fit = Math.min(1, A / need);
  return { fit, cards };
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
    this._regions = null; // persistent game-screen region elements (see _ensureGameShell)
    this._fanEl = null;   // the persistent .un-fan node (see _syncFan)
    this._flightEl = null; // the persistent flight-clone layer (UN-4)

    // UN-4 motion bookkeeping - all one-shot-animation gates for markup that is NOT
    // DOM-persisted (mat/opponents/uno-slot are rebuilt via innerHTML every render, unlike
    // the fan), so "did this actually just happen" has to be tracked explicitly rather
    // than inferred from a transition running across a rebuild.
    this._dealPending = false;    // row 1: next _syncFan build is the initial deal
    this._revealPending = false;  // row 5: next new discard top gets the flip, not the settle
    this._lastDiscardId = null;   // row 4/5: which physical card last got its settle/flip
    this._discardRot = 0;         // row 4/5: that card's stable random rest tilt
    this._lastPendingDraw = 0;    // row 8: only grow-pulse on an actual increase
    this._lastHandLen = {};       // row 10: per-seat hand length, to catch the 1-card transition
    this._aiPulsePi = null;       // row 12: which opponent chip is mid-pulse
    this._pulseTimer = null;

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };
    // The fan's fit scale depends on the measured hand width, so a rotation or
    // window resize needs a re-render (renderGame is idempotent presentation of
    // current state, so calling it here is always safe).
    this._onResize = () => { if (this.view === 'game' && this.game) this.renderGame(); };
    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);

    const inProgress = loadGame();
    if (inProgress) this.resumeGame(inProgress); else this.renderSetup();
  }

  destroy() {
    saveGame(this);
    for (const tm of this.timers) clearTimeout(tm);
    this.timers = [];
    clearTimeout(this._confirmTimer);
    clearTimeout(this._penaltyTimer);
    clearTimeout(this._pulseTimer);
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this.container.innerHTML = ''; // also removes any in-flight clones - they never outlive destroy()
    this._regions = null;
    this._fanEl = null;
    this._flightEl = null;
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
    // Setup rebuilds the whole container, so the persistent game shell (and the
    // fan inside it) is gone after this; drop the refs so the next game rebuilds.
    this._regions = null;
    this._fanEl = null;
    this._flightEl = null;
    clearTimeout(this._pulseTimer);
    this._aiPulsePi = null;
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
    // The game shell persists across renders now, so the end-of-match overlay is
    // no longer swept away by a full innerHTML rewrite - remove it explicitly.
    this.closeOverlays();
    this._pendingWildId = null;
    // UN-4: a fresh match gets the deal (row 1) and the first-card flip (row 5); a stray
    // clone from whatever the last game was doing (e.g. a rapid rematch tap) must not
    // survive into this one, so the flight layer is wiped defensively even though in
    // practice the overlay tap that reaches here is always well after any flight finished.
    this._dealPending = true;
    this._revealPending = true;
    this._lastDiscardId = null;
    this._lastPendingDraw = 0;
    this._lastHandLen = {};
    if (this._flightEl) this._flightEl.innerHTML = '';
    this.seats = this._buildSeats(this.players);
    this.game = new UnoGame({ playerCount: this.players, startPlayer, onEvent: (type, p) => this._onEngineEvent(type, p) });
    this.view = 'game';
    this._afterStateChange();
  }

  resumeGame(saved) {
    this.seats = saved.seats;
    this.players = saved.seats.length;
    this.difficulty = saved.difficulty;
    // UN-4: silent restore, no deal/flip/pop flourish for cards and state that were
    // already there before this mount - seed the "last seen" trackers from the snapshot
    // so the first render reads as "unchanged," not "everything just happened."
    this._dealPending = false;
    this._revealPending = false;
    const topCard = saved.snap.discard[saved.snap.discard.length - 1];
    this._lastDiscardId = topCard ? topCard.id : null;
    this._lastPendingDraw = saved.snap.pendingDraw || 0;
    this._lastHandLen = {};
    saved.snap.players.forEach((p, i) => { this._lastHandLen[i] = p.hand.length; });
    if (this._flightEl) this._flightEl.innerHTML = '';
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
    if (action.type === 'draw') {
      g.draw(pi);
      this._afterStateChange();
      return;
    }
    // row 12: capture the chip's rect and the played card BEFORE the state change, since
    // opponents markup rebuilds every render (the chip element itself will be gone the
    // instant _afterStateChange's render runs) - the RECT survives, the element does not.
    const playedCard = g.players[pi].hand.find((c) => c.id === action.cardId);
    const chipEl = this._regions && this._regions.opponents.querySelector(`.un-oppchip[data-seat="${pi}"]`);
    const chipRect = chipEl ? chipEl.getBoundingClientRect() : null;
    this._aiPulsePi = pi;
    clearTimeout(this._pulseTimer);
    this._pulseTimer = setTimeout(() => {
      this._aiPulsePi = null;
      if (this.view === 'game' && this.game) this.renderGame();
    }, AI_PULSE_MS);
    g.play(pi, action.cardId, action.color);
    this._afterStateChange();
    if (playedCard && chipRect) this._flyFromChip(chipRect, playedCard);
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

  /** Build the persistent game-screen skeleton once per entry into the game view.
   *
   *  RENDER EXEMPTION (UN-3c, load-bearing - do not "fix" this back to one big
   *  innerHTML): the fan's card nodes must survive re-render so CSS transitions
   *  (UN-4) can animate them. Reinserted DOM nodes get no before-change style,
   *  so a transition never runs across a rebuild - and that applies to ANCESTORS
   *  too: re-attaching the fan into a freshly rebuilt parent detaches it, which
   *  kills every running and future transition on its cards. The skeleton below
   *  therefore persists for the whole game view, and each render rebuilds only
   *  the REGION CONTENTS (same template strings as before), while _syncFan()
   *  reconciles the fan's children in place. */
  _ensureGameShell() {
    if (this._fanEl && this.container.querySelector('.un-game')) return;
    this.container.innerHTML = `
      <div class="un-root">
        <div class="un-shell un-game">
          <div class="un-opponents"></div>
          <p class="un-status" aria-live="polite"></p>
          <div class="un-mat"></div>
          <div class="un-toastslot"></div>
          <div class="un-handwrap">
            <div class="un-unoslot"></div>
            <div class="un-hand" role="list" aria-label="${esc(this.humanName)}">
              <div class="un-fan"></div>
            </div>
          </div>
          <footer class="un-bar">
            <button type="button" class="un-ghost un-small" data-action="help">${t('howto')}</button>
            <button type="button" class="un-ghost un-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
            <button type="button" class="un-ghost un-small" data-action="newgame">${t('new_game')}</button>
          </footer>
        </div>
        <div class="un-flightlayer"></div>
      </div>`;
    const q = (s) => this.container.querySelector(s);
    this._regions = {
      opponents: q('.un-opponents'),
      status: q('.un-status'),
      mat: q('.un-mat'),
      toast: q('.un-toastslot'),
      uno: q('.un-unoslot'),
    };
    this._fanEl = q('.un-fan');
    this._flightEl = q('.un-flightlayer');
  }

  renderGame() {
    const g = this.game;
    const opponents = this.seats.map((s, i) => i).filter((i) => i !== HUMAN);
    const activeColor = g.activeColor;
    const top = g.discard[g.discard.length - 1];
    const pi = g.phase === 'chooseColor' ? -1 : g.currentPlayer;
    const legal = g.phase === 'playing' ? g.getLegalMoves(HUMAN) : { canPlay: [], mustDraw: false };

    const showFirstCardChooser = g.phase === 'chooseColor' && g.pendingWild.isFirstCard;
    const showCardWildChooser = this._pendingWildId != null;
    const chooserOpen = showFirstCardChooser || showCardWildChooser;
    // While the color chooser is up it is the only live control: leaving other
    // cards tappable used to allow a second play with a stale _pendingWildId.
    const humanTurn = pi === HUMAN && !this.busy && !chooserOpen;
    const legalIds = new Set(legal.canPlay.map((c) => c.id));
    const drawTappable = humanTurn && g.pendingDraw > 0 && !legal.mustDraw;
    const showDir = this.seats.length > 2 && g.phase !== 'over';

    // UN-4 rows 4/5: the discard pile's markup is rebuilt every render (it is NOT part of
    // the fan's DOM-persistence exemption), so a settle/flip animation is only correct on
    // the render where the top card actually changed - otherwise every unrelated
    // re-render (a toast firing, an opponent's count changing) would replay it.
    const discardIsNew = this._lastDiscardId !== top.id;
    if (discardIsNew) {
      this._lastDiscardId = top.id;
      this._discardRot = (Math.random() * 12 - 6).toFixed(2);
    }
    const discardFlip = discardIsNew && (top.color === 'wild' || this._revealPending);
    if (discardIsNew) this._revealPending = false;
    const discardExtra = discardFlip ? 'un-card-flip' : (discardIsNew ? 'un-card-settle' : '');
    const discardStyle = `--settle-rot:${this._discardRot}deg`;

    // row 8: only pulse on an actual increase, never on a re-render at the same level.
    const pendingGrew = g.pendingDraw > this._lastPendingDraw;
    this._lastPendingDraw = g.pendingDraw;

    // row 10: only pop on the render where a hand FIRST drops to exactly one card.
    const unoJustReached = (i) => {
      const len = g.players[i].hand.length;
      const prev = this._lastHandLen[i];
      this._lastHandLen[i] = len;
      return len === 1 && prev !== 1;
    };

    this._ensureGameShell();
    const r = this._regions;

    r.opponents.innerHTML = opponents.map((i) => {
      const pop = unoJustReached(i);
      return `
      <div class="un-oppchip ${g.phase !== 'over' && g.currentPlayer === i ? 'is-turn' : ''} ${this._aiPulsePi === i ? 'un-chip-pulse' : ''}" data-seat="${i}">
        <span class="un-oppemoji">${esc(this.seats[i].emoji)}</span>
        <span class="un-oppname">${esc(this.seats[i].name)}</span>
        <span class="un-oppcount">${g.players[i].hand.length}</span>
        ${g.players[i].hand.length === 1 ? `<span class="un-unochip ${pop ? 'un-chip-pop' : ''}">${t('uno_banner')}</span>` : ''}
      </div>`;
    }).join('');

    r.status.textContent = chooserOpen ? '' : this._seatStatusText();

    r.mat.innerHTML = `
      <button type="button" class="un-pile un-drawpile ${drawTappable ? 'is-live' : ''}" data-action="draw-pile"
        ${drawTappable ? '' : 'disabled'} aria-label="${esc(t('aria_draw_pile', { n: g.deck.length }))}">
        ${cardHTML({ id: -1, color: 'wild', kind: 'wild', value: null }, { back: true })}
        <span class="un-pilecount">${g.deck.length}</span>
      </button>
      <div class="un-pile un-discardpile" aria-label="${esc(t('aria_discard_pile', { card: cardAriaLabel(top) }))}">
        ${cardHTML(top, { extraClass: discardExtra, style: discardStyle })}
        <span class="un-colorchip" data-color="${activeColor || top.color}" aria-hidden="true">${activeColor ? colorGlyphHTML(activeColor, 14) : ''}</span>
      </div>
      ${showDir ? `<span class="un-dir" role="img" aria-label="${esc(t(g.direction === 1 ? 'direction_cw' : 'direction_ccw'))}">${dirArrowSVG(g.direction === 1)}</span>` : ''}
      ${g.pendingDraw > 0 ? `<span class="un-pendingbadge ${pendingGrew ? 'un-badge-grow' : ''}">${esc(t('pending_draw', { n: g.pendingDraw }))}</span>` : ''}
      ${chooserOpen ? this._colorChooserHTML() : ''}`;

    r.toast.innerHTML = this._penaltyToast ? `<div class="un-toast" role="status">${esc(this._penaltyToast)}</div>` : '';

    const humanPop = unoJustReached(HUMAN);
    r.uno.innerHTML = g.players[HUMAN].hand.length === 1 ? `<span class="un-unochip un-unochip-self ${humanPop ? 'un-chip-pop' : ''}">${t('uno_banner')}</span>` : '';

    // Display order: newest card at the LEFT end (spec §5, decided). The engine
    // appends drawn cards to the END of the hand array, so the display order is
    // the reversed engine order. Presentation only - every data-id and play()
    // call still uses the card's real id. (UN-6's sortedHand() will absorb this
    // reversal as its 'draw' mode.)
    const displayHand = g.players[HUMAN].hand.slice().reverse();
    this._syncFan(displayHand, legalIds, humanTurn);
  }

  /** The fan reconciler (UN-3c) - the ONLY code that mutates card DOM outside a
   *  render template string. Every call is a FULL, stateless reconciliation
   *  against the hand it is given: membership, position, and live state are all
   *  recomputed, so the fan cannot drift from engine state no matter how fast
   *  plays stack up - the last call wins and reflects current truth, and a card
   *  played-then-redrawn before anything "resolves" simply reconciles again.
   *  Card nodes are keyed by data-id, reused across calls, and NEVER moved or
   *  reparented once inserted (position and paint order are carried entirely by
   *  --x/--y/--rot/--z, so DOM order does not need to change) - that is what
   *  lets UN-4's transitions animate re-layout. Removal is immediate: UN-4's
   *  flight animations use detached clones, never the live nodes. */
  _syncFan(hand, legalIds, humanTurn) {
    const fan = this._fanEl;
    if (!fan) return;
    const hostW = fan.parentElement ? fan.parentElement.clientWidth : 0;
    const layout = hostW > 0
      ? fanLayout(hand.length, { A: Math.min(428, Math.max(24, hostW - 24)) })
      : fanLayout(hand.length);
    fan.style.setProperty('--fit', String(layout.fit));

    const byId = new Map();
    for (const el of [...fan.children]) byId.set(el.dataset.id, el);
    const want = new Set(hand.map((c) => String(c.id)));
    for (const [id, el] of byId) {
      if (!want.has(id)) { el.remove(); byId.delete(id); }
    }

    // UN-4 rows 1/6: a newly-inserted node has no "before" state, so a transition can't
    // animate its arrival - it would just pop into place. Hide it (un-card-entering) and
    // reveal it only once its flight clone (spawned below, after positions are set) has
    // visually "landed," so the pop-in is masked by the flight rather than visible.
    const isDeal = this._dealPending;
    const newEntries = [];

    hand.forEach((card, i) => {
      let el = byId.get(String(card.id));
      if (!el) {
        el = this._buildCardEl(card);
        el.classList.add('un-card-entering');
        fan.appendChild(el);
        newEntries.push({ el, i });
      }
      const p = layout.cards[i];
      el.style.setProperty('--x', `${p.x}px`);
      el.style.setProperty('--y', `${p.y}px`);
      el.style.setProperty('--rot', `${p.rot}deg`);
      el.style.setProperty('--z', String(p.z));
      el.style.setProperty('--i', String(i)); // row 7's left-to-right lift stagger
      const live = humanTurn && legalIds.has(card.id);
      el.classList.toggle('is-live', live);
      el.dataset.action = live ? 'play-card' : '';
      el.disabled = !live;
      el.tabIndex = live ? 0 : -1;
    });

    if (newEntries.length) {
      if (isDeal) {
        this._dealPending = false;
        for (const entry of newEntries) this._animateDealEntry(entry.el, entry.i);
      } else {
        for (const entry of newEntries) this._animateDrawEntry(entry.el);
      }
    }
  }

  /** One fan card node, built from the same cardHTML() template string the rest
   *  of the screen uses - one source of card markup, no drift. State (live/
   *  disabled/position vars) is applied by _syncFan immediately after. */
  _buildCardEl(card) {
    const tpl = document.createElement('template');
    tpl.innerHTML = cardHTML(card, {});
    return tpl.content.firstElementChild;
  }

  // --- UN-4 motion: flight clones ---------------------------------------------

  /** Generic clone-flight (spec §6 rows 1/3/6/12): a fixed-position clone travels from
   *  `srcRect` to `destRect` using transform only (translate/rotate/scale - never top/
   *  left/width/height, which are set ONCE as static inline styles here, not animated).
   *  Either clone an existing live node (`cloneOf`, used for the human's own fan card and
   *  the draw pile) or build a fresh one from a cardHTML() string (`cardHTMLStr`, used for
   *  an AI's played card, which has no live per-card DOM to clone from - opponent hands
   *  aren't rendered card-by-card). The clone lives in `.un-flightlayer`, a sibling of the
   *  reconciled fan/mat regions, so a re-render never touches it directly. Removed on
   *  `animationend`, with a timeout safety net so a clone can never outlive a re-render
   *  (e.g. the tab being backgrounded and dropping the animation event). */
  _spawnFlight({ cloneOf, cardHTMLStr, srcRect, destRect, className, rotateDeg = 0, i = 0, onDone }) {
    const layer = this._flightEl;
    // Under prefers-reduced-motion the flight layer is display:none (spec §6), and an
    // element that never generates a box never fires animationend - so without this
    // short-circuit, onDone (which reveals newly drawn/dealt cards) would only ever run
    // via the safety-net timeout below, leaving a new card invisible for up to
    // FLIGHT_SAFETY_MS. Skip spawning the clone entirely and resolve immediately instead.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (onDone) onDone();
      return;
    }
    if (!layer || !srcRect || !destRect || srcRect.width === 0 || destRect.width === 0) {
      if (onDone) onDone();
      return;
    }
    let clone;
    if (cloneOf) {
      clone = cloneOf.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-action');
      clone.classList.remove('is-live', 'un-card-entering');
      clone.disabled = true;
      clone.tabIndex = -1;
    } else {
      const wrap = document.createElement('div');
      wrap.innerHTML = cardHTMLStr;
      clone = wrap.firstElementChild;
    }
    clone.classList.add('un-flightcard', className);
    clone.style.position = 'fixed';
    clone.style.left = `${srcRect.left}px`;
    clone.style.top = `${srcRect.top}px`;
    clone.style.width = `${srcRect.width}px`;
    clone.style.height = `${srcRect.height}px`;
    clone.style.margin = '0';
    clone.style.setProperty('--i', String(i));
    clone.style.setProperty('--fly-dx', `${(destRect.left + destRect.width / 2) - (srcRect.left + srcRect.width / 2)}px`);
    clone.style.setProperty('--fly-dy', `${(destRect.top + destRect.height / 2) - (srcRect.top + srcRect.height / 2)}px`);
    clone.style.setProperty('--fly-scale', String(destRect.width / srcRect.width));
    clone.style.setProperty('--fly-rot', `${rotateDeg}deg`);

    layer.appendChild(clone);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clone.remove();
      if (onDone) onDone();
    };
    clone.addEventListener('animationend', finish);
    this.later(finish, FLIGHT_SAFETY_MS);
  }

  /** row 6: a single drawn card arcs from the draw pile into its (already-computed) fan
   *  slot, then reveals the real (till-now-hidden) node and runs its 6a settle glow. */
  _animateDrawEntry(el) {
    const pile = this._regions && this._regions.mat.querySelector('.un-drawpile');
    if (!pile) { el.classList.remove('un-card-entering'); return; }
    this._spawnFlight({
      cloneOf: pile.querySelector('.un-card') || pile,
      srcRect: pile.getBoundingClientRect(),
      destRect: el.getBoundingClientRect(),
      className: 'un-fly-draw',
      onDone: () => {
        el.classList.remove('un-card-entering');
        el.classList.add('un-card-new');
        el.addEventListener('animationend', () => el.classList.remove('un-card-new'), { once: true });
      },
    });
  }

  /** row 1: the initial deal, one clone per dealt card, all spawned together - the 55ms
   *  stagger is a pure-CSS animation-delay (un-fly-deal, keyed off --i), not JS timing, so
   *  it survives prefers-reduced-motion's blanket delay override with no special case. No
   *  6a glow here (row 1 already tells the "arriving" story via the stagger itself). */
  _animateDealEntry(el, i) {
    const pile = this._regions && this._regions.mat.querySelector('.un-drawpile');
    if (!pile) { el.classList.remove('un-card-entering'); return; }
    this._spawnFlight({
      cloneOf: pile.querySelector('.un-card') || pile,
      srcRect: pile.getBoundingClientRect(),
      destRect: el.getBoundingClientRect(),
      className: 'un-fly-deal',
      i,
      onDone: () => el.classList.remove('un-card-entering'),
    });
  }

  /** row 3: the human's own play, fan slot -> discard. Called AFTER the state change (so
   *  `sourceEl` was captured beforehand, before _syncFan removed it) and after renderGame
   *  has already picked this render's --settle-rot, so the flight ends at the same tilt
   *  the discard settles to underneath it. */
  _flyToDiscard(sourceEl) {
    if (!sourceEl || !this._regions) return;
    const discardCard = this._regions.mat.querySelector('.un-discardpile .un-card');
    if (!discardCard) return;
    this._spawnFlight({
      cloneOf: sourceEl,
      srcRect: sourceEl.getBoundingClientRect(),
      destRect: discardCard.getBoundingClientRect(),
      className: 'un-fly-play',
      rotateDeg: Number(this._discardRot) || 0,
    });
  }

  /** row 12: an AI's play, opponent chip -> discard. Opponent hands have no per-card DOM
   *  to clone, so the clone is built fresh from cardHTML() - the played card is public
   *  information the instant it lands on the discard, so this reveals nothing hidden. */
  _flyFromChip(srcRect, card) {
    if (!this._regions) return;
    const discardCard = this._regions.mat.querySelector('.un-discardpile .un-card');
    if (!discardCard) return;
    this._spawnFlight({
      cardHTMLStr: cardHTML(card, {}),
      srcRect,
      destRect: discardCard.getBoundingClientRect(),
      className: 'un-fly-play',
      rotateDeg: Number(this._discardRot) || 0,
    });
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
    // row 3: capture the live fan node BEFORE the state change - _syncFan removes it
    // immediately once the hand no longer contains this card, so it must be cloned while
    // it still exists (and still sits at its correct, un-touched fan position).
    const sourceEl = this._fanEl && this._fanEl.querySelector(`[data-id="${cardId}"]`);
    g.play(HUMAN, cardId);
    this._afterStateChange();
    this._flyToDiscard(sourceEl);
  }

  _onChooseColor(color) {
    const g = this.game;
    if (!COLORS.includes(color)) return;
    if (this._pendingWildId != null) {
      const id = this._pendingWildId;
      this._pendingWildId = null;
      // Guard against a stale id (turn or hand changed since the chooser opened):
      // dropping the choice and re-rendering is always safe; throwing is not.
      if (g.phase !== 'playing' || g.currentPlayer !== HUMAN
        || !g.players[HUMAN].hand.some((c) => c.id === id)) { this.renderGame(); return; }
      // row 3 (wild case): the fan card is still present (disabled) while the chooser is
      // open - capture it before playing, same reasoning as the non-wild path above.
      const sourceEl = this._fanEl && this._fanEl.querySelector(`[data-id="${id}"]`);
      g.play(HUMAN, id, color);
      this._afterStateChange();
      this._flyToDiscard(sourceEl);
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
