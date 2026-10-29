// ui.js - Uno UI module. Hub contract: init(container) / destroy() / isInProgress().
//
// Human is always engine seat 0; seats 1..n-1 are AI, filled from the shared profile's
// opponents. Colorblind-safe by construction: every one of the four colors always carries
// its own shape glyph (circle/triangle/square/diamond), on cards, the color chooser, and the
// current-color chip.
//
// The play screen (overhaul 2026-10-23, Matt: "The cards don't move like any other game. They
// aren't displayed like any other game. And most of the gameplay screen is dead space."): built
// the way Chinchón and Escoba are. Opponent pills + a ☰ menu on top, a green felt table that
// takes every spare pixel, your name chip, then your hand as big straight overlapped cards in
// one or two rows. Cards travel the way Chinchón's do: a copy flies in a fixed layer with
// translate+scale (Web Animations, FLY_MS, the same easing), the real card stays hidden until
// it lands, and a card leaving the stock turns face up as it arrives. See uno/CLAUDE.md.

import { UnoGame, COLORS } from './game.js';
import { chooseAction, pickWildColor } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
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

// Card travel, the same numbers and easing as Chinchón (chinchon/js/ui.js FLY_MS /
// FLY_DEAL_GAP_MS / TURN_UP_MS), so a card moves the same in every card game on the hub.
const FLY_MS = 340;
const FLY_DEAL_GAP_MS = 45;
const FLY_DRAW_GAP_MS = 90;   // several cards drawn at once (a +2 stack, a Wild +4) arrive one after another
const TURN_UP_MS = 200;
const FLY_EASE = 'cubic-bezier(.25,.8,.35,1)';

// Play screen geometry (px). Everything else is measured (see _fit / handLayout).
const LIFT = 14;              // how far a playable card rises out of the hand
const TOP_H = 52;             // opponent pills + menu row
const SELF_H = 44;            // your chip + sort button row
const GAP = 8;                // the column's gap

const COLOR_META = {
  red: { hex: '#E0532F', shape: 'square', labelKey: 'color_red' },
  yellow: { hex: '#F2B705', shape: 'circle', labelKey: 'color_yellow' },
  green: { hex: '#178A7A', shape: 'diamond', labelKey: 'color_green' },
  blue: { hex: '#1F5FA8', shape: 'triangle', labelKey: 'color_blue' },
};

const DIFF_KEYS = [['easy', 'diff_easy'], ['medium', 'diff_medium'], ['hard', 'diff_hard']];
// Computer speed (2026-09-28). Scales only the waits that belong to a COMPUTER: its think
// pause and its own draw-until-playable steps.
const PACES = ['slow', 'normal', 'fast'];
const PACE_MULT = { slow: 1.6, normal: 1, fast: 0.3 };
// Hand sort: presentation only, applied to a COPY of the hand at render time; the engine's
// hand, every id passed to play(), and the save never see it.
const SORTS = ['draw', 'color', 'rank'];
const HUE_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
const KIND_ORDER = { number: 0, skip: 1, reverse: 2, draw2: 3, wild: 4, wild4: 5 };
const rankKey = (c) => (c.kind === 'number' ? c.value : 10 + KIND_ORDER[c.kind]);
function sortedHand(hand, mode) {
  const shown = hand.slice().reverse(); // 'draw': newest first
  if (mode === 'color') {
    shown.sort((a, b) => (HUE_ORDER[a.color] - HUE_ORDER[b.color]) || (rankKey(a) - rankKey(b)) || (a.id - b.id));
  } else if (mode === 'rank') {
    shown.sort((a, b) => (rankKey(a) - rankKey(b)) || (HUE_ORDER[a.color] - HUE_ORDER[b.color]) || (a.id - b.id));
  }
  return shown;
}
const DIFF_SKILL = { 1: 'easy', 2: 'medium', 3: 'hard' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

/** Curved play-direction arrow (clockwise when `cw`), mirrored for counter-clockwise. */
function dirArrowSVG(cw) {
  const inner = '<path d="M18.4 7.4 A8 8 0 1 0 20 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M13.9 5.7 L19.4 6.7 L18.3 12.1 Z" fill="currentColor"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${cw ? inner : `<g transform="translate(24,0) scale(-1,1)">${inner}</g>`}</svg>`;
}

function colorGlyphHTML(color, cls = 'un-glyph') {
  const m = COLOR_META[color];
  if (!m) return '';
  return `<svg class="${cls}" viewBox="0 0 12 12" aria-hidden="true">${shapeSVG(m.shape, 'currentColor')}</svg>`;
}

function cardFaceGlyph(card) {
  if (card.kind === 'number') return String(card.value);
  if (card.kind === 'skip') return '⊘';
  if (card.kind === 'reverse') return '⇄';
  if (card.kind === 'draw2') return '+2';
  if (card.kind === 'wild') return '';
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

/** The wild's oval: four quadrants, each a hue WITH its shape (never hue alone). */
function wildOvalSVG() {
  const q = (shape, x, y) => `<g transform="translate(${x},${y}) scale(.42)">${shapeSVG(shape, '#fff')}</g>`;
  return `<svg class="un-wildmarks" viewBox="0 0 12 12" aria-hidden="true">
    ${q('square', 1.2, 1.2)}${q('circle', 5.8, 1.2)}${q('diamond', 1.2, 5.8)}${q('triangle', 5.8, 5.8)}</svg>`;
}

/** One card, face up or `back`. A `<div role="button">`, not a `<button>`: the tile drawn many
 *  times per screen must not lean on old WebKit's flex-in-button support
 *  (docs/BUILDING-A-GAME.md, Part 0). Every size inside is in em, and the card's font-size is a
 *  fixed fraction of its width (--cw), so the same markup draws at any size (hand, pile,
 *  flight, the how-to diagram). */
function cardHTML(card, { back = false, extraClass = '', style = '' } = {}) {
  if (back) {
    return `<div class="un-card un-back ${extraClass}" style="${style}" aria-hidden="true">
      <span class="un-oval"></span><span class="un-backword">UNO</span></div>`;
  }
  const isWild = card.color === 'wild';
  const glyph = cardFaceGlyph(card);
  const action = card.kind !== 'number' ? 'is-action' : '';
  const ix = (pos) => `<span class="un-ix un-ix-${pos}">${isWild ? '' : colorGlyphHTML(card.color, 'un-ixshape')}<b>${glyph || '★'}</b></span>`;
  const mid = isWild
    ? `<span class="un-oval un-oval-wild">${wildOvalSVG()}</span>${glyph ? `<span class="un-mid un-mid-wild">${glyph}</span>` : ''}`
    : `<span class="un-oval">${colorGlyphHTML(card.color, 'un-ovalshape')}</span><span class="un-mid ${action}">${glyph}</span>`;
  return `<div class="un-card ${extraClass}" style="${style}" data-color="${card.color}" data-kind="${card.kind}"
      data-id="${card.id}" aria-label="${esc(cardAriaLabel(card))}">${mid}${ix('tl')}${ix('br')}</div>`;
}

/** Hand geometry. Pure: n cards in a box `A` wide and at most `maxH` tall -> card width,
 *  rows and each card's top-left. Cards overlap left to right like Chinchón's hand, at least
 *  ~38% of every card showing (the corner index and the oval's edge); a third of the way
 *  past two rows the card size steps down rather than the box growing. Rows are balanced,
 *  lower rows paint in front and overlap the row above by about half a card. `LIFT` px of
 *  headroom sit above the top row so a lifted card never leaves the box. */
function handLayout(n, { A = 360, cw = 84, maxH = 220, lift = LIFT } = {}) {
  let c = Math.round(cw);
  let rows = 1, perRowMax = 1, pitch = 0;
  for (; c >= 40; c -= 2) {
    const ch = c * 1.5;
    const minStep = Math.max(22, c * 0.38);
    perRowMax = Math.max(1, Math.floor((A - c) / minStep) + 1);
    rows = Math.max(1, Math.ceil(n / perRowMax));
    if (rows === 1) { pitch = 0; break; }
    pitch = Math.min(ch * 0.52, (maxH - lift - ch) / (rows - 1));
    if (pitch >= Math.max(26, ch * 0.3)) break;
  }
  c = Math.max(40, c);
  const ch = c * 1.5;
  const perRow = Math.max(1, Math.ceil(n / rows));
  const cards = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const j = i - r * perRow;
    const rowN = Math.min(perRow, n - r * perRow);
    const step = rowN > 1 ? Math.min(c + 6, (A - c) / (rowN - 1)) : 0;
    const rowW = c + step * (rowN - 1);
    cards.push({ x: Math.round((A - rowW) / 2 + j * step), y: Math.round(lift + r * pitch), z: r * 100 + j });
  }
  return { cw: c, ch, rows, height: Math.ceil(lift + ch + pitch * (rows - 1)), cards };
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
    if (PACES.includes(raw.pace)) out.pace = raw.pace;
    if (SORTS.includes(raw.handSort)) out.handSort = raw.handSort;
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

// `pace` and `handSort` (2026-09-28) are additive fields; absent reads as Normal / newest-first.
function saveSettings(players, difficulty, nextStarter, pace, handSort) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ players, difficulty, nextStarter, pace, handSort })); } catch { /* ignore */ }
}

function saveGame(ui) {
  try {
    if (!ui.game || ui.game.phase === 'over' || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, at: Date.now(), seats: ui.seats, difficulty: ui.difficulty, snap: ui.game.snapshot(),
      moved: !!ui._moved,   // 2026-10-29: the player has played or drawn (quitting now is a loss)
    }));
  } catch { /* a full quota must never break the game */ }
}

function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (!Array.isArray(raw.seats) || raw.seats.length < 2 || raw.seats.length > 4) return null;
    if (!raw.snap || !Array.isArray(raw.snap.players) || raw.snap.players.length !== raw.seats.length) return null;
    if (raw.snap.phase === 'over') return null;
    if (!DIFF_KEYS.some(([k]) => k === raw.difficulty)) return null;
    // Too old to resume: the hand is over. Once the player had moved in it, that is a LOSS
    // (2026-10-29): waiting out the 30 minutes must not be a way to make a losing hand vanish.
    if (Date.now() - Number(raw.at || 0) > MAX_SAVE_AGE_MS) {
      if (savedMoved(raw)) { try { recordResult('uno', raw.difficulty, false); } catch { /* never block the mount */ } }
      clearGame();
      return null;
    }
    return raw;
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

/** Has the player acted in this saved hand? Its own flag; a save from before it counts a hand that
 *  is not the dealt seven as moved. */
function savedMoved(raw) {
  if (typeof raw.moved === 'boolean') return raw.moved;
  const h = raw.snap && raw.snap.players && raw.snap.players[HUMAN] && raw.snap.players[HUMAN].hand;
  return Array.isArray(h) && h.length !== 7;
}

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
    this.pace = (saved && saved.pace) || 'normal';
    this.handSort = (saved && saved.handSort) || 'draw';

    this.game = null;
    this.seats = null;
    this.view = 'setup';
    this.busy = false;
    this._dealing = false;
    this._dead = false;
    this.timers = [];
    this._pendingWildId = null;
    this._setupExpanded = null;
    this._penaltyToast = null;
    this._penaltyTimer = null;
    this._el = null;          // persistent play-screen regions (see _ensureGameShell)
    this._dims = null;        // measured sizes (see _fit)
    this._pileCW = 0;

    // Motion bookkeeping. The pile, pills and badges are rebuilt every render, so "did this
    // just happen" is tracked explicitly.
    this._dealPending = false;    // the next hand sync is the opening deal
    this._lastPendingDraw = 0;    // the +N badge pops only when the stack grows
    this._lastHandLen = {};       // per seat, to pop the UNO badge only on the 1-card transition
    this._landing = new Set();    // discard ids still flying to the pile (drawn hidden until they land)
    this._seenCounts = {};        // per computer seat: hand size at the last render (draw flights)
    this._turnUpIds = new Set();  // your cards that left the stock face down and turn up on landing

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => this.onKey(e);
    this._onResize = () => {
      if (this.view === 'game' && this.game && this._el) { this._fit(); this.renderGame(); }
    };
    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    this._offViewport = onViewportResize(this._onResize);

    const inProgress = loadGame();
    if (inProgress) this.resumeGame(inProgress); else this.renderSetup();
  }

  destroy() {
    saveGame(this);
    this._dead = true;
    for (const tm of this.timers) clearTimeout(tm);
    this.timers = [];
    clearTimeout(this._confirmTimer);
    clearTimeout(this._penaltyTimer);
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    this.container.innerHTML = ''; // also removes any in-flight copies
    this._el = null;
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

  _saveSettings() { saveSettings(this.players, this.difficulty, this.nextStarter, this.pace, this.handSort); }

  /** A wait that belongs to a computer, scaled by the chosen speed. */
  _aiMs(ms) { return Math.round(ms * (PACE_MULT[this.pace] || 1)); }

  // --- setup screen ------------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="un-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="un-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="un-row ${open ? 'is-open' : ''}">
      <button type="button" class="un-row-head" data-action="toggle-row" data-row="${key}">
        <span class="un-row-label">${label}</span><span class="un-row-value">${value}</span>
      </button>
      ${open ? `<div class="un-row-expand">${content}</div>` : ''}
    </div>`;
  }

  renderSetup() {
    this.view = 'setup';
    this.game = null;
    this._el = null;
    const playersContent = this._seg('set-players', this.players, [2, 3, 4].map((n) => [n, String(n)]));
    const diffContent = this._seg('set-diff', this.difficulty, DIFF_KEYS.map(([v, k]) => [v, diffShapeSVG(tierOf(v)) + esc(t(k))]));
    const paceContent = this._seg('set-pace', this.pace, PACES.map((k) => [k, esc(t('pace_' + k))]));
    const diffLabel = diffShapeSVG(tierOf(this.difficulty)) + esc(t(DIFF_KEYS.find(([v]) => v === this.difficulty)[1]));
    // A fanned hand of four cards, one per colour, as the title art: the game's look, no words.
    const fan = ['red', 'yellow', 'green', 'blue'].map((c, i) =>
      cardHTML({ id: -10 - i, color: c, kind: i === 3 ? 'draw2' : 'number', value: [7, 3, 9, null][i] },
        { extraClass: 'un-fancard', style: `--i:${i}` })).join('');
    this.container.innerHTML = `
      <div class="un-root">
        <div class="un-setup">
          <div class="un-setup-art" aria-hidden="true">${fan}</div>
          <h2 class="un-title">${t('title')}</h2>
          <div class="un-panel">
            <div class="un-summary">
              ${this._row('players', t('row_players'), esc(String(this.players)), playersContent)}
              ${this._row('difficulty', t('row_difficulty'), diffLabel, diffContent)}
              ${this._row('pace', t('row_speed'), esc(t('pace_' + this.pace)), paceContent)}
            </div>
            <div class="un-panel-actions">
              <button type="button" class="un-primary" data-action="start">${t('start')}</button>
              <button type="button" class="un-secondary" data-action="help">${t('howto')}</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // --- game lifecycle ------------------------------------------------------------

  startGame() {
    // Alternate who OPENS the hand across all seats, human included (see uno/CLAUDE.md).
    // Banked before the game is built, so the rotation survives leaving mid-game.
    const startPlayer = this.nextStarter % this.players;
    this.nextStarter = (startPlayer + 1) % this.players;
    this._saveSettings();
    clearGame();
    this.closeOverlays();
    this._moved = false;
    this._statsCommitted = false;
    this._pendingWildId = null;
    for (const tm of this.timers) clearTimeout(tm);
    this.timers = [];
    this._dealPending = true;
    this._lastPendingDraw = 0;
    this._lastHandLen = {};
    this._landing.clear();
    this._turnUpIds.clear();
    this.seats = this._buildSeats(this.players);
    this.game = new UnoGame({ playerCount: this.players, startPlayer, onEvent: (type, p) => this._onEngineEvent(type, p) });
    this._seenCounts = {};
    this.game.players.forEach((p, i) => { this._seenCounts[i] = p.hand.length; }); // the deal flies them itself
    this.view = 'game';
    if (this._el && this._el.flight) this._el.flight.innerHTML = '';
    // The opening deal: everything renders in place, hidden, and flies out of the stock round
    // the table; nobody moves until the last card (and the first discard) has landed.
    const top = this.game.discard[this.game.discard.length - 1];
    this._landing.add(top.id);
    this._dealing = true;
    this.busy = true;
    this.renderGame();
    const dealt = this._animateDeal(startPlayer);
    const go = () => { if (this._dead || this.game == null) return; this._dealing = false; this._afterStateChange(); };
    const settle = () => this.later(go, TURN_UP_MS); // let the first discard finish turning up
    dealt.then(settle, settle);
  }

  resumeGame(saved) {
    this.seats = saved.seats;
    this.players = saved.seats.length;
    this.difficulty = saved.difficulty;
    this._moved = savedMoved(saved);
    this._statsCommitted = false;
    // Silent restore: nothing flies for cards that were already there.
    this._dealPending = false;
    this._lastPendingDraw = saved.snap.pendingDraw || 0;
    this._lastHandLen = {};
    saved.snap.players.forEach((p, i) => { this._lastHandLen[i] = p.hand.length; });
    this._landing.clear();
    this._turnUpIds.clear();
    this._seenCounts = {};
    saved.snap.players.forEach((p, i) => { this._seenCounts[i] = p.hand.length; });
    this.game = UnoGame.fromSnapshot(saved.snap, { onEvent: (type, p) => this._onEngineEvent(type, p) });
    this.view = 'game';
    this._afterStateChange();
    this._refitSoon();
  }

  /** Engine event hook: names the moment a penalty draw (a +2 stack, a Wild +4 victim, a
   *  first-card +2) lands, as a short toast on the table. */
  _onEngineEvent(type, payload) {
    if (type !== 'penaltyDraw') return;
    const pi = payload.playerIndex;
    const name = (this.seats && this.seats[pi]) ? this.seats[pi].name : '';
    this._penaltyToast = t('penalty_draw_opp', { name, n: payload.amount });
    clearTimeout(this._penaltyTimer);
    this._penaltyTimer = setTimeout(() => {
      this._penaltyToast = null;
      if (this.view === 'game' && this.game && !this._dead) this.renderGame();
    }, PENALTY_TOAST_MS);
  }

  /** Single funnel after every engine action: checkpoint, render, resolve a finished game, or
   *  schedule whoever's turn it is next. Busy is decided BEFORE rendering, so legal cards
   *  never render disabled for a frame after a computer's turn. */
  _afterStateChange() {
    saveGame(this);
    const g = this.game;
    if (!g) return;
    if (this._dealing) { this.renderGame(); return; }
    if (g.phase === 'over') { this.busy = false; this.renderGame(); this.later(() => this.finish(), FLY_MS + 120); return; }
    if (g.phase === 'chooseColor') {
      // A first-card wild is coloured by whoever opens. A computer that opens picks its own
      // (before 2026-10-23 the chooser went to the human, who could not answer it for them,
      // and the hand froze; reachable since the opener started rotating).
      const owner = g.pendingWild.playerIndex;
      if (this._isAI(owner)) {
        this.busy = true;
        this.renderGame();
        this.later(() => {
          if (this.game !== g || g.phase !== 'chooseColor') return;
          g.chooseColor(owner, pickWildColor(g.players[owner].hand, Math.random, null));
          this._afterStateChange();
        }, this._aiMs(AI_THINK_MS));
        return;
      }
      this.busy = false; this.renderGame(); return;
    }

    const pi = g.currentPlayer;
    const legal = g.getLegalMoves(pi);
    const autoDraw = legal.mustDraw; // no legal card at all (or a penalty you can't answer)
    if (this._isAI(pi)) {
      this.busy = true;
      this.renderGame();
      this.later(() => this._aiStep(), this._aiMs(autoDraw ? DRAW_STEP_MS : AI_THINK_MS));
    } else if (autoDraw) {
      this.busy = true;
      this.renderGame();
      this.later(() => { if (this.game === g && g.phase === 'playing') { g.draw(pi); this._afterStateChange(); } }, DRAW_STEP_MS);
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
    // Their pill is rebuilt by the render, so read where the card leaves from first.
    const card = g.players[pi].hand.find((c) => c.id === action.cardId);
    const from = this._pillRect(pi);
    if (card && from) this._landing.add(card.id);
    g.play(pi, action.cardId, action.color);
    this._afterStateChange();
    if (card && from) this._flyToDiscard(cardHTML(card), from, card.id);
  }

  // --- layout --------------------------------------------------------------------

  /** Size the play screen to exactly what the host leaves, by measurement (the Dominoes
   *  probe, docs/BUILDING-A-GAME.md Part 3): the page below us (the hub's padding) is read
   *  while the screen is a 2000px probe, then the real height is set, in one frame. From that
   *  height and width come the hand's card size and the piles' size. */
  _fit() {
    const el = this._el;
    if (!el) return;
    const game = el.game;
    const doc = document.documentElement;
    const PROBE = 2000;
    game.style.height = PROBE + 'px';
    const rect = game.getBoundingClientRect();
    const topInDoc = rect.top + window.scrollY;
    const below = Math.max(0, doc.scrollHeight - topInDoc - PROBE);
    const H = Math.max(420, Math.round(window.innerHeight - topInDoc - below));
    game.style.height = H + 'px';
    const cs = getComputedStyle(game);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const W = Math.max(260, game.clientWidth - padX);
    const inner = H - padY;
    const handCW = Math.round(clamp(Math.min(W / 4.1, inner * 0.165), 54, 96));
    const handMaxH = Math.round(LIFT + handCW * 1.5 * 1.52);   // two rows, half-overlapped
    this._dims = { W, H, handCW, handMaxH };
  }

  /** The piles fill the table: sized from the felt's real height once the hand has taken its
   *  rows (they step down only when the hand grows a second row), and from the width so two
   *  piles and their gap always fit. */
  _sizePiles() {
    const el = this._el;
    if (!el || !this._dims) return;
    const fh = el.felt.clientHeight;
    if (!fh) return;
    // padding, the status line and its gap, the count under the stock, the +N badge above.
    const cw = Math.round(clamp(Math.min((fh - 120) / 1.5, this._dims.W * 0.36), 50, 132));
    if (cw !== this._pileCW) { this._pileCW = cw; el.game.style.setProperty('--pile-cw', cw + 'px'); }
  }

  _refitSoon() {
    const again = () => { if (this._el && this.view === 'game' && this.game && !this._dead) { this._fit(); this.renderGame(); } };
    requestAnimationFrame(again);
    this.later(again, 150);
  }

  /** The play screen's skeleton, built once per entry into the game view. Each render
   *  rebuilds the region CONTENTS; the hand's card nodes are reconciled in place by id
   *  (_syncHand), so a card slides to its new slot instead of popping. */
  _ensureGameShell() {
    if (this._el && this.container.contains(this._el.game)) return;
    this.container.innerHTML = `
      <div class="un-root">
        <div class="un-game">
          <div class="un-top">
            <div class="un-opponents"></div>
            <button type="button" class="un-menubtn" data-action="menu" aria-label="${esc(t('aria_menu'))}">☰</button>
          </div>
          <div class="un-felt">
            <div class="un-feltinfo">
              <span class="un-dir" hidden></span>
              <div class="un-toastslot"></div>
            </div>
            <div class="un-piles"></div>
            <p class="un-status" aria-live="polite"></p>
            <div class="un-chooserslot"></div>
          </div>
          <div class="un-selfrow">
            <div class="un-self"></div>
            <button type="button" class="un-sortbtn" data-action="sort"></button>
          </div>
          <div class="un-hand" role="list" aria-label="${esc(this.humanName)}"></div>
        </div>
        <div class="un-flight" aria-hidden="true"></div>
      </div>`;
    const q = (s) => this.container.querySelector(s);
    this._pileCW = 0;
    this._el = {
      game: q('.un-game'), opponents: q('.un-opponents'), felt: q('.un-felt'), dir: q('.un-dir'),
      toast: q('.un-toastslot'), piles: q('.un-piles'), status: q('.un-status'), chooser: q('.un-chooserslot'),
      self: q('.un-self'), sort: q('.un-sortbtn'), hand: q('.un-hand'), flight: q('.un-flight'),
    };
    this._fit();
  }

  // --- rendering -----------------------------------------------------------------

  _seatStatusText() {
    const g = this.game;
    if (g.phase === 'over') return t('opp_wins', { name: this.seats[g.winner].name });
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
          aria-label="${esc(t(COLOR_META[c].labelKey))}">${colorGlyphHTML(c, 'un-cc-shape')}</button>`).join('')}
      </div>
    </div>`;
  }

  /** A computer's hand, face down: a few overlapped backs + the exact count. It is where
   *  their draws land and their plays leave from. */
  _oppHandHTML(n) {
    return `<span class="un-opphand" aria-hidden="true">${'<i></i>'.repeat(Math.min(n, 5))}</span><b class="un-oppcount">${n}</b>`;
  }

  renderGame() {
    const g = this.game;
    if (!g || this._dead) return;
    this._ensureGameShell();
    const el = this._el;
    const top = g.discard[g.discard.length - 1];
    const showFirstCardChooser = g.phase === 'chooseColor' && g.pendingWild.isFirstCard && g.pendingWild.playerIndex === HUMAN && !this._dealing;
    const chooserOpen = showFirstCardChooser || this._pendingWildId != null;
    const pi = g.phase === 'chooseColor' ? -1 : g.currentPlayer;
    const legal = g.phase === 'playing' ? g.getLegalMoves(HUMAN) : { canPlay: [], mustDraw: false };
    const humanTurn = pi === HUMAN && !this.busy && !chooserOpen && !this._dealing;
    const legalIds = new Set(legal.canPlay.map((c) => c.id));
    const drawTappable = humanTurn && g.pendingDraw > 0 && !legal.mustDraw;
    const turnSeat = this._dealing || g.phase === 'over' ? -1 : (g.phase === 'chooseColor' ? g.pendingWild.playerIndex : g.currentPlayer);

    const unoJustReached = (i) => {
      const len = g.players[i].hand.length;
      const prev = this._lastHandLen[i];
      this._lastHandLen[i] = len;
      return len === 1 && prev !== 1;
    };

    // Opponents.
    el.opponents.innerHTML = this.seats.map((s, i) => i).filter((i) => i !== HUMAN).map((i) => {
      const n = g.players[i].hand.length;
      const pop = unoJustReached(i);
      return `<div class="un-opp ${turnSeat === i ? 'is-turn' : ''}" data-seat="${i}">
        <span class="un-oppav">${esc(this.seats[i].emoji)}</span>
        <span class="un-oppbody">
          <span class="un-oppname">${esc(this.seats[i].name)}</span>
          <span class="un-oppfoot">${this._oppHandHTML(n)}</span>
        </span>
        ${n === 1 ? `<span class="un-unochip ${pop ? 'un-pop' : ''}">${t('uno_banner')}</span>` : ''}
      </div>`;
    }).join('');

    // The table.
    const activeColor = g.activeColor;
    const under = g.discard.length > 1 ? cardHTML(g.discard[g.discard.length - 2], { extraClass: 'un-under' }) : '';
    const pendingGrew = g.pendingDraw > this._lastPendingDraw;
    this._lastPendingDraw = g.pendingDraw;
    el.piles.innerHTML = `
      <div class="un-pile un-drawpile ${drawTappable ? 'is-live' : ''}" ${drawTappable ? 'data-action="draw-pile" role="button" tabindex="0"' : ''}
        aria-label="${esc(t('aria_draw_pile', { n: g.deck.length }))}">
        ${g.deck.length > 1 ? cardHTML({}, { back: true, extraClass: 'un-under' }) : ''}
        ${g.deck.length ? cardHTML({}, { back: true, extraClass: 'un-stocktop' }) : '<div class="un-card un-empty"></div>'}
        <span class="un-pilecount">${g.deck.length}</span>
      </div>
      <div class="un-pile un-discardpile" data-active="${this._landing.has(top.id) ? '' : (activeColor || '')}" aria-label="${esc(t('aria_discard_pile', { card: cardAriaLabel(top) }))}">
        ${under}
        ${cardHTML(top, { extraClass: 'un-top', style: this._landing.has(top.id) ? 'visibility:hidden' : '' })}
        ${activeColor && !this._landing.has(top.id) ? `<span class="un-colorchip" data-color="${activeColor}" aria-hidden="true">${colorGlyphHTML(activeColor, 'un-chipshape')}</span>` : ''}
        ${g.pendingDraw > 0 ? `<span class="un-pendingbadge ${pendingGrew ? 'un-pop' : ''}">+${g.pendingDraw}</span>` : ''}
      </div>`;

    const showDir = this.seats.length > 2 && g.phase !== 'over';
    el.dir.hidden = !showDir;
    if (showDir) {
      el.dir.innerHTML = dirArrowSVG(g.direction === 1);
      el.dir.setAttribute('role', 'img');
      el.dir.setAttribute('aria-label', t(g.direction === 1 ? 'direction_cw' : 'direction_ccw'));
    }
    el.toast.innerHTML = this._penaltyToast ? `<div class="un-toast" role="status">${esc(this._penaltyToast)}</div>` : '';
    el.status.textContent = chooserOpen || this._dealing ? '' : this._seatStatusText();
    el.status.classList.toggle('is-mine', humanTurn);
    el.chooser.innerHTML = chooserOpen ? this._colorChooserHTML() : '';

    // You.
    const myN = g.players[HUMAN].hand.length;
    const myPop = unoJustReached(HUMAN);
    el.self.innerHTML = `<div class="un-selfchip ${turnSeat === HUMAN ? 'is-turn' : ''}">
        <span class="un-oppav">${esc(this.humanEmoji)}</span>
        <span class="un-selfname">${esc(this.humanName)}</span>
        <b class="un-oppcount">${myN}</b>
        ${myN === 1 ? `<span class="un-unochip ${myPop ? 'un-pop' : ''}">${t('uno_banner')}</span>` : ''}
      </div>`;
    const mode = t('sort_' + this.handSort);
    el.sort.innerHTML = `<span aria-hidden="true">⇅</span> ${esc(mode)}`;
    el.sort.setAttribute('aria-label', t('aria_sort', { mode }));

    this._syncHand(sortedHand(g.players[HUMAN].hand, this.handSort), legalIds, humanTurn);
    this._sizePiles();

    // A computer's hand grew: those cards fly to it face down from the stock (their own draws,
    // a +2 stack they eat, a Wild +4 they are hit with). Counted against the last render, so
    // it happens once per real change.
    this.seats.forEach((s, i) => {
      if (i === HUMAN) return;
      const len = g.players[i].hand.length;
      const was = this._seenCounts[i];
      this._seenCounts[i] = len;
      if (was != null && len > was) {
        const from = this._stockRect();
        for (let k = 0; k < len - was; k++) this._fly(this._backNode(), from, this._pillRect(i, from), { delay: k * FLY_DRAW_GAP_MS });
      }
    });
  }

  /** The hand reconciler: card nodes are keyed by id and reused (never re-inserted), so a
   *  relayout or a sort SLIDES each card to its new slot. A card new to the hand renders in
   *  its slot hidden and flies in from the stock; it shows when the copy lands. */
  _syncHand(hand, legalIds, humanTurn) {
    const box = this._el.hand;
    const d = this._dims || { W: box.clientWidth || 360, handCW: 84, handMaxH: 220 };
    const lay = handLayout(hand.length, { A: d.W, cw: d.handCW, maxH: d.handMaxH });
    box.style.height = `${lay.height}px`;
    box.style.setProperty('--cw', `${lay.cw}px`);

    // A fresh shell (a resume, a return from the hub) shows the hand as it is: nothing flies.
    const silent = !this._dealPending && box.children.length === 0;
    const byId = new Map();
    for (const node of [...box.children]) byId.set(node.dataset.id, node);
    const want = new Set(hand.map((c) => String(c.id)));
    for (const [id, node] of byId) if (!want.has(id)) { node.remove(); byId.delete(id); }

    const arrived = [];
    hand.forEach((card, i) => {
      let node = byId.get(String(card.id));
      if (!node) {
        const tpl = document.createElement('template');
        tpl.innerHTML = cardHTML(card);
        node = tpl.content.firstElementChild;
        node.setAttribute('role', 'listitem');
        if (!silent) node.style.visibility = 'hidden';
        node.classList.add('no-slide');
        box.appendChild(node);
        arrived.push(node);
      }
      const p = lay.cards[i];
      const live = humanTurn && legalIds.has(card.id);
      node.style.setProperty('--x', `${p.x}px`);
      node.style.setProperty('--y', `${p.y - (live ? LIFT : 0)}px`);
      node.style.zIndex = String(p.z);
      node.classList.toggle('is-live', live);
      node.classList.toggle('is-dim', humanTurn && !live);
      if (live) {
        node.dataset.action = 'play-card';
        node.setAttribute('role', 'button');
        node.tabIndex = 0;
        node.removeAttribute('aria-disabled');
      } else {
        delete node.dataset.action;
        node.setAttribute('role', 'listitem');
        node.removeAttribute('tabindex');
        node.setAttribute('aria-disabled', 'true');
      }
    });
    if (arrived.length) {
      // Let the new nodes take their first position without sliding from the corner.
      void box.offsetWidth;
      arrived.forEach((n) => n.classList.remove('no-slide'));
      if (!this._dealPending && !silent) this._flyDrawnToHand(arrived);
    }
  }

  // --- card travel -----------------------------------------------------------------

  /** Fly a copy of `visual` (an element, or card markup) from rect `from` to rect `to` in the
   *  fixed flight layer; resolves on landing. Chinchón's _fly, card for card. Gameplay motion,
   *  so it runs under reduced motion too (Part 0: reduced motion thins garnish, it does not
   *  freeze the game). A torn-down module never resolves. */
  _fly(visual, from, to, { delay = 0, duration = FLY_MS } = {}) {
    const layer = this._el && this._el.flight;
    if (this._dead || !layer || !visual || !from || !to || !from.width || !to.width
      || typeof Element.prototype.animate !== 'function') return Promise.resolve();
    let node = visual;
    if (typeof visual === 'string') {
      const tpl = document.createElement('template');
      tpl.innerHTML = visual;
      node = tpl.content.firstElementChild;
    }
    node.removeAttribute('data-action');
    node.removeAttribute('role');
    node.removeAttribute('tabindex');
    node.classList.remove('is-live', 'is-dim', 'un-top', 'un-under', 'un-stocktop');
    node.style.visibility = '';
    const box = layer.getBoundingClientRect();
    Object.assign(node.style, {
      left: `${from.left - box.left}px`, top: `${from.top - box.top}px`,
      width: `${from.width}px`, height: `${from.height}px`,
    });
    node.style.setProperty('--cw', `${from.width}px`);
    layer.appendChild(node);
    return new Promise((resolve) => {
      let done = false;
      const end = () => { if (done) return; done = true; node.remove(); if (!this._dead) resolve(); };
      try {
        const a = node.animate([
          { transform: 'translate(0,0) scale(1,1)' },
          { transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height})` },
        ], { duration, delay, easing: FLY_EASE, fill: 'both' });
        a.onfinish = end; a.oncancel = end;
      } catch { end(); return; }
      setTimeout(end, duration + delay + 400);   // a backgrounded tab can drop the event
    });
  }

  /** A card that landed face down turns face up (Chinchón's _turnUp). */
  _turnUp(node) {
    if (!node || !node.isConnected) return;
    try { node.animate([{ transform: 'scaleX(0.05)' }, { transform: 'scaleX(1)' }], { duration: TURN_UP_MS, easing: 'ease-out', composite: 'add' }); } catch { /* fine without it */ }
  }

  _backNode() {
    const tpl = document.createElement('template');
    tpl.innerHTML = cardHTML({}, { back: true });
    return tpl.content.firstElementChild;
  }

  _stockRect() {
    const n = this._el && this._el.piles.querySelector('.un-drawpile .un-card:last-of-type');
    const r = n && n.getBoundingClientRect();
    return r && r.width ? r : null;
  }

  /** A small card-sized rect on computer seat `i`'s pill, where its face-down hand sits. */
  _pillRect(i, like) {
    const pill = this._el && this._el.opponents.querySelector(`.un-opp[data-seat="${i}"]`);
    if (!pill) return null;
    const r = (pill.querySelector('.un-opphand') || pill).getBoundingClientRect();
    if (!r.width) return null;
    const w = 16, h = like && like.width ? w * (like.height / like.width) : 24;
    return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
  }

  _discardTop() { return this._el && this._el.piles.querySelector('.un-discardpile .un-top'); }

  /** Your new cards (a draw, a +2 stack, a Wild +4): each leaves the stock face down, one
   *  after another, and turns face up as it lands in its slot. */
  _flyDrawnToHand(nodes) {
    const from = this._stockRect();
    nodes.forEach((node, k) => {
      const show = () => { node.style.visibility = ''; this._turnUp(node); };
      if (!from) { show(); return; }
      this._fly(this._backNode(), from, node.getBoundingClientRect(), { delay: k * FLY_DRAW_GAP_MS }).then(show, show);
    });
  }

  /** A played card flies from `from` (your hand slot, or a computer's pill) onto the pile; the
   *  pile's top stays hidden until it lands, so the card is never in two places. */
  _flyToDiscard(visual, from, cardId) {
    const land = () => {
      if (!this._landing.delete(cardId) || this._dead) return;
      if (this.view === 'game' && this.game) this.renderGame(); // shows it, with the colour ring and chip
    };
    const dest = this._discardTop();
    if (!from || !dest) { land(); return; }
    this._fly(visual, from, dest.getBoundingClientRect()).then(land, land);
  }

  /** The opening deal: one card at a time out of the stock, round the table from the seat
   *  that opens, then the first discard turns up. Every hidden card is shown however it ends. */
  _animateDeal(startPlayer) {
    this._dealPending = false;
    const g = this.game;
    const n = g.players.length;
    const handNodes = [...this._el.hand.children];
    const reveal = () => {
      handNodes.forEach((node) => { node.style.visibility = ''; });
      const top = g.discard[g.discard.length - 1];
      this._landing.delete(top.id);
      const tn = this._discardTop();
      if (tn) tn.style.visibility = '';
    };
    const from = this._stockRect();
    if (!from) { reveal(); return Promise.resolve(); }
    // Deal order is display order (left to right), which reads as a hand being dealt.
    const order = handNodes.slice().sort((a, b) => parseFloat(a.style.getPropertyValue('--x')) - parseFloat(b.style.getPropertyValue('--x'))
      || (parseFloat(a.style.zIndex) - parseFloat(b.style.zIndex)));
    const flights = [];
    let k = 0;
    const passes = Math.max(...g.players.map((p) => p.hand.length));
    for (let pass = 0; pass < passes; pass++) {
      for (let o = 0; o < n; o++) {
        const seat = (startPlayer + o) % n;
        if (pass >= g.players[seat].hand.length) continue;
        const delay = (k++) * FLY_DEAL_GAP_MS;
        if (seat === HUMAN) {
          const node = order[pass];
          if (node) {
            flights.push(this._fly(this._backNode(), from, node.getBoundingClientRect(), { delay })
              .then(() => { node.style.visibility = ''; this._turnUp(node); }));
          }
        } else {
          flights.push(this._fly(this._backNode(), from, this._pillRect(seat, from), { delay }));
        }
      }
    }
    // The first card of the discard leaves the stock face down and turns up on the pile.
    const flip = Promise.all(flights).then(() => {
      const dest = this._discardTop();
      const top = g.discard[g.discard.length - 1];
      if (!dest || this._dead) return;
      return this._fly(this._backNode(), this._stockRect() || from, dest.getBoundingClientRect()).then(() => {
        this._landing.delete(top.id);
        const tn = this._discardTop();
        if (tn) { tn.style.visibility = ''; this._turnUp(tn); }
      });
    });
    return flip.then(reveal, reveal);
  }

  // --- end of game -----------------------------------------------------------

  finish() {
    const g = this.game;
    if (!g || g.phase !== 'over' || this.container.querySelector('[data-role="end"]')) return;
    const won = g.winner === HUMAN;
    if (!this._statsCommitted) {
      this._statsCommitted = true;
      try { recordResult('uno', this.difficulty, won); } catch { /* never block the result */ }
    }
    clearGame();
    const winnerSeat = this.seats[g.winner];
    const overlay = document.createElement('div');
    overlay.className = 'un-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="un-scrim" data-action="close-overlay"></div>
      <div class="un-card2" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="un-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="un-card2-emoji">${won ? '🏆' : esc(winnerSeat.emoji)}</span>
        <h3 class="un-card2-title">${esc(t('opp_wins', { name: winnerSeat.name }))}</h3>
        <div class="un-card2-actions">
          <button type="button" class="un-primary" data-action="rematch">${t('play_again')}</button>
          <button type="button" class="un-secondary" data-action="newgame">${t('change_settings')}</button>
        </div>
      </div>`;
    this.container.querySelector('.un-root').appendChild(overlay);
  }

  // --- how to play / menu ---------------------------------------------------------

  _diagramHTML() {
    const pile = { id: -1, color: 'red', kind: 'number', value: 7 };
    const match1 = { id: -2, color: 'red', kind: 'number', value: 3 };
    const match2 = { id: -3, color: 'yellow', kind: 'number', value: 7 };
    return `<div class="un-diagram" role="img" aria-label="${esc(t('help_caption'))}">
      ${cardHTML(pile)}<span class="un-dg-eq" aria-hidden="true">=</span>${cardHTML(match1)}${cardHTML(match2)}
    </div>`;
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
        ${this._diagramHTML()}
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

  openMenu() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'un-overlay un-overlay-sheet';
    overlay.dataset.role = 'menu';
    overlay.innerHTML = `
      <div class="un-scrim" data-action="close-overlay"></div>
      <div class="un-sheet" role="dialog" aria-modal="true" aria-label="${esc(t('aria_menu'))}">
        <button type="button" class="un-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <button type="button" class="un-secondary" data-action="help">${t('howto')}</button>
        <button type="button" class="un-secondary" data-role="restart" data-action="restart">${t('restart_game')}</button>
        <button type="button" class="un-secondary" data-action="newgame">${t('new_game')}</button>
      </div>`;
    this.container.querySelector('.un-root').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.un-overlay').forEach((n) => n.remove());
  }

  // --- restart confirm guard --------------------------------------------------

  confirmDestructive(btn, action) {
    if (!this.game || this.game.phase === 'over') { action(); return; }
    if (btn.dataset.armed === '1') { this.resetConfirms(); action(); return; }
    this.resetConfirms();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = this._quitCostsLoss() ? t('quit_loss') : t('tap_again_confirm');
    btn.classList.add('is-confirm');
    this._confirmTimer = setTimeout(() => this.resetConfirms(), 3500);
  }

  resetConfirms() {
    clearTimeout(this._confirmTimer);
    this.container.querySelectorAll('[data-armed="1"]').forEach((b) => {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    });
  }

  /** Quitting a hand (Restart, New game) once the player has played or drawn is a LOSS (2026-10-29,
   *  docs/INTEGRITY-CHECKS-SPEC.md "Holes closed 2026-10-29: quitting and easier settings"). Leaving
   *  the hub is not quitting: the save resumes it (a save past 30 minutes records the loss on load). */
  _quitCostsLoss() {
    return !!(this.game && this.view === 'game' && this.game.phase !== 'over' && this._moved && !this._statsCommitted);
  }

  /** Record the quit as a loss, once (`_statsCommitted`). */
  _recordQuitLoss() {
    if (!this._quitCostsLoss()) return;
    this._statsCommitted = true;
    try { recordResult('uno', this.difficulty, false); } catch { /* never block leaving */ }
    clearGame();
  }

  // --- events ------------------------------------------------------------------

  onKey(e) {
    if (e.key === 'Escape') { this.closeOverlays(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const n = e.target;
    if (!n || !n.getAttribute || n.getAttribute('role') !== 'button' || !this.container.contains(n) || !n.dataset.action) return;
    e.preventDefault();
    n.click();
  }

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
      this._saveSettings();
      this.renderSetup();
    } else if (action === 'set-pace') {
      if (PACES.includes(btn.dataset.v)) this.pace = btn.dataset.v;
      this._saveSettings();
      this.renderSetup();
    } else if (action === 'set-diff') {
      this.difficulty = btn.dataset.v;
      this._saveSettings();
      this.renderSetup();
    } else if (action === 'sort') {
      this.handSort = SORTS[(SORTS.indexOf(this.handSort) + 1) % SORTS.length];
      this._saveSettings();
      if (this.view === 'game' && this.game) this.renderGame();
    } else if (action === 'start' || action === 'rematch') {
      this.startGame();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => { this._recordQuitLoss(); this.startGame(); });
    } else if (action === 'newgame') {
      const go = () => {
        this._recordQuitLoss();
        this.closeOverlays();
        clearGame();
        for (const tm of this.timers) clearTimeout(tm);
        this.timers = [];
        this.renderSetup();
      };
      if (this._quitCostsLoss()) this.confirmDestructive(btn, go); else go();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'menu') {
      this.openMenu();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
    } else if (action === 'play-card') {
      this._onPlayCard(Number(btn.dataset.id));
    } else if (action === 'draw-pile') {
      if (this.busy || this._dealing || !this.game || this.game.currentPlayer !== HUMAN) return;
      this.game.draw(HUMAN);
      this._moved = true;
      this._afterStateChange();
    } else if (action === 'choose-color') {
      this._onChooseColor(btn.dataset.color);
    }
  }

  _onPlayCard(cardId) {
    const g = this.game;
    if (this.busy || this._dealing || !g || g.phase !== 'playing' || g.currentPlayer !== HUMAN) return;
    const card = g.players[HUMAN].hand.find((c) => c.id === cardId);
    if (!card) return;
    const legal = g.getLegalMoves(HUMAN);
    if (!legal.canPlay.some((c) => c.id === cardId)) return;
    if (card.kind === 'wild' || card.kind === 'wild4') {
      this._pendingWildId = cardId;
      this.renderGame();
      return;
    }
    this._playHuman(cardId);
  }

  /** Your play: read the card's slot BEFORE the state change (the reconciler removes the
   *  node), then fly a copy of it onto the pile. */
  _playHuman(cardId, color) {
    const g = this.game;
    const src = this._el && this._el.hand.querySelector(`.un-card[data-id="${cardId}"]`);
    const rect = src && src.getBoundingClientRect();
    const visual = src ? src.cloneNode(true) : null;
    if (visual && rect && rect.width) this._landing.add(cardId);
    g.play(HUMAN, cardId, color);
    this._moved = true;
    this._afterStateChange();
    if (visual && rect && rect.width) this._flyToDiscard(visual, rect, cardId);
  }

  _onChooseColor(color) {
    const g = this.game;
    if (!g || !COLORS.includes(color)) return;
    if (this._pendingWildId != null) {
      const id = this._pendingWildId;
      this._pendingWildId = null;
      // A stale id (turn or hand changed since the chooser opened): drop it and re-render.
      if (g.phase !== 'playing' || g.currentPlayer !== HUMAN
        || !g.players[HUMAN].hand.some((c) => c.id === id)) { this.renderGame(); return; }
      this._playHuman(id, color);
    } else if (g.phase === 'chooseColor' && g.pendingWild && g.pendingWild.playerIndex === HUMAN) {
      g.chooseColor(HUMAN, color);
      this._moved = true;
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

/** Autosave/resume built in: the match snapshots after every settled action and restores
 *  silently on the next mount, so leaving mid-game is lossless (always `false`, see root
 *  CLAUDE.md's "two legitimate meanings"). */
export function isInProgress() {
  return false;
}

export { handLayout };
export default { init, destroy, isInProgress };
