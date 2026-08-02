// dominoes/js/ui.js — Dominoes UI module. Hub contract: init(container) / destroy() / isInProgress().
//
// The play screen is one screen with no words in it: whose turn it is is the felt colour, what
// you can play is tile brightness, where you can play it is the end badges, and what just
// happened is a popup at the tile that caused it. Every overlay (bot thinking, the boneyard
// drawer, the round card) sits ON TOP of a layout that never changes size.
//
// Rendering split: the play shell is built once and then its regions are re-filled, so the
// `.dm-chain` container survives every update and its centre-and-fit transform can animate
// instead of snapping.

import { DominoesGame, TILES, HUMAN, BOT, countAfter, scoreOf } from './game.js';
import { layoutChain } from './board.js';
import { chooseMove } from './ai.js';
import { tileHTML } from './tiles.js';
import { openTutorial, CROWN_SVG } from './tutorial.js';
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordDominoes } from '../../js/game-stats.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

const SETTINGS_KEY = 'gamehub.dominoes.v1';
const SAVE_KEY = 'gamehub.dominoes.save.v1';

const DIFFS = [['easy', 'diff_easy'], ['medium', 'diff_medium'], ['hard', 'diff_hard']];
const DIFF_SKILL = { 1: 'easy', 2: 'medium', 3: 'hard' };
const TARGETS = [150, 300, 500];

// One board unit is half a domino's short side (see board.js). 11px gives a 44x22 domino before
// the fit-to-felt scale, which reads comfortably on a phone and shrinks gracefully from there.
const UNIT = 11;
const FELT_PAD = 30;
// The chain is scaled to fit, and allowed to scale UP as well as down: a two-tile board on a
// phone-height felt would otherwise sit marooned in the middle at postage-stamp size. It grows
// to fill the space it has and shrinks back as the chain gets longer.
const MAX_SCALE = 1.8;

// Bot pacing. Deliberate, not computation: the spec is explicit that the pause is what makes
// the opponent feel like an opponent.
const THINK_MIN = 950, THINK_VAR = 550;
const BOT_DRAW_MS = 420;
const AFTER_PLAY_MS = 420;
const ROUND_CARD_MS = 700;

// Breathing room under the play stack, in px. Small on purpose: every pixel spent here is a
// pixel the felt does not get.
const GAP = 6;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** tiles.js is i18n-free, so the aria label for a face-up tile is composed here. */
const tileAria = (values) => t('aria_tile', { a: values[0], b: values[1] });

function ensureStylesheet() {
  const href = new URL('../css/dominoes.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/dominoes.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

const ICON_SETUP = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 L8 12 L15 19"/></svg>';

const ICON_RESTART ='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V9h-5.5"/></svg>';

/** Three bot faces, one per tier: a mild grin, the reference app's smug half-lidded stare, and a
 *  hard scowl. Shape carries the tier, not colour alone (they share the accent orange). */
function botFaceSVG(diff) {
  const brow = diff === 'hard'
    ? '<path d="M14 24 L28 30 M50 30 L64 24" stroke="#2A1B04" stroke-width="5" stroke-linecap="round"/>'
    : diff === 'medium'
      ? '<path d="M14 27 L28 27 M50 27 L64 27" stroke="#2A1B04" stroke-width="5" stroke-linecap="round"/>'
      : '';
  const mouth = diff === 'hard'
    ? '<path d="M26 56 Q39 46 52 56" stroke="#2A1B04" stroke-width="5" fill="none" stroke-linecap="round"/>'
    : diff === 'medium'
      ? '<ellipse cx="39" cy="55" rx="9" ry="6" fill="#2A1B04"/>'
      : '<path d="M26 50 Q39 62 52 50" stroke="#2A1B04" stroke-width="5" fill="none" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 78 78" aria-hidden="true">
    <circle cx="39" cy="39" r="36" fill="#F2A125" stroke="#141414" stroke-width="4"/>
    <circle cx="27" cy="36" r="6" fill="#2A1B04"/><circle cx="51" cy="36" r="6" fill="#2A1B04"/>
    ${brow}${mouth}
  </svg>`;
}

const YOU_FACE_SVG = `<svg viewBox="0 0 78 78" aria-hidden="true">
  <circle cx="39" cy="39" r="36" fill="#EF4B4B" stroke="#141414" stroke-width="4"/>
  <circle cx="27" cy="34" r="6" fill="#2A1B04"/><circle cx="51" cy="34" r="6" fill="#2A1B04"/>
  <path d="M25 50 Q39 63 53 50" stroke="#2A1B04" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`;

const PANEL_ART = `<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <g fill="#F7EDD3" stroke="#0A2A22" stroke-width="3">
    <g transform="translate(24 12) rotate(-16)"><rect width="46" height="92" rx="8"/><line x1="0" y1="46" x2="46" y2="46"/></g>
    <g transform="translate(120 8) rotate(12)"><rect width="46" height="92" rx="8"/><line x1="0" y1="46" x2="46" y2="46"/></g>
    <g transform="translate(74 52) rotate(-4)"><rect width="92" height="46" rx="8"/><line x1="46" y1="0" x2="46" y2="46"/></g>
  </g>
</svg>`;

// --- storage ----------------------------------------------------------------------------------

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { return null; }
}
function saveSettings(difficulty, target) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ difficulty, target })); }
  catch (e) { console.error('[dominoes] settings write failed', e); }
}
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}
function writeSave(obj) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); }
  catch (e) { console.error('[dominoes] save write failed', e); }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

// --- the UI -------------------------------------------------------------------------------------

class DominoesUI {
  constructor(container) {
    this.container = container;
    const profile = loadProfile();
    const saved = loadSettings();
    const skill = profile && profile.opponents && profile.opponents[0] && profile.opponents[0].skill;
    this.difficulty = (saved && saved.difficulty) || DIFF_SKILL[skill] || 'medium';
    this.target = (saved && TARGETS.indexOf(saved.target) >= 0) ? saved.target : 300;

    this.game = null;
    this.view = 'setup';
    this.timers = [];
    this.busy = false;              // a bot beat or an animation owns the turn
    this.selected = null;           // tileId lifted out of the hand, awaiting an end
    this.boneOpen = false;
    this.dealing = false;
    this._freshId = null;           // the tile that just landed, for its one-shot pop
    this._shownScores = [0, 0];     // what the header currently displays, for the count-up
    this._bestRound = 0;
    this._statsCommitted = false;
    this._confirmTimer = null;
    this._countTimer = null;
    this._closeTutorial = null;      // tutorial.js's teardown while its carousel is open
    this.el = null;

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };
    // orientationchange and the visual viewport (a collapsing URL bar) both change the usable
    // height without necessarily firing a plain window resize.
    this._onResize = () => { this._fit(); this._layoutBoard(); };
    // (visualViewport is subscribed by js/viewport.js's onViewportResize now, not here.)
    this._offLang = onLangChange(() => { if (this.view === 'setup') this.renderSetup(); else this._syncChrome(); });

    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    // onViewportResize already folds window resize, orientationchange AND visualViewport into
    // one per-frame callback, so this game's three separate subscriptions become one.
    this._offViewport = onViewportResize(this._onResize);

    const save = loadSave();
    if (save && save.snap && save.snap.phase !== 'matchOver') this.resume(save);
    else this.renderSetup();
  }

  destroy() {
    this._persist();
    for (const tm of this.timers) clearTimeout(tm);
    this.timers = [];
    clearTimeout(this._confirmTimer);
    clearInterval(this._countTimer);
    if (this._closeTutorial) { this._closeTutorial(); this._closeTutorial = null; }
    if (this._offLang) this._offLang();
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    this.container.innerHTML = '';
    this.el = null;
    this.game = null;
  }

  later(fn, ms) {
    const tm = setTimeout(() => { this.timers = this.timers.filter((x) => x !== tm); fn(); }, ms);
    this.timers.push(tm);
    return tm;
  }

  // --- setup ------------------------------------------------------------------------------

  renderSetup() {
    this.view = 'setup';
    this.game = null;
    this.el = null;
    const diffLabel = t(DIFFS.find(([v]) => v === this.difficulty)[1]);
    // A live save means the player came here mid-match (the header's back button keeps it), so
    // Play is a destructive choice and must not be the only one on offer.
    const save = loadSave();
    const canResume = !!(save && save.snap && save.snap.phase !== 'matchOver');
    this.container.innerHTML = `
      <div class="dm-root">
        <div class="dm-setup">
          <div class="dm-setup-panel">
            <div class="dm-panel-art">${PANEL_ART}</div>
            <h2 class="dm-setup-title">${esc(t('title'))}</h2>
            <p class="dm-setup-sub">${esc(t('tagline'))}</p>
          </div>
          <div class="dm-setup-avatar">${botFaceSVG(this.difficulty)}</div>
          <p class="dm-setup-diffname">${esc(diffLabel)}</p>
          <div class="dm-field">
            <span>${esc(t('row_difficulty'))}</span>
            <div class="dm-seg">${DIFFS.map(([v, k]) => `
              <button type="button" class="dm-segbtn ${v === this.difficulty ? 'is-selected' : ''}" data-action="set-diff" data-v="${v}">
                ${diffShapeSVG(tierOf(v))}<span>${esc(t(k))}</span>
              </button>`).join('')}</div>
          </div>
          <div class="dm-field">
            <span>${esc(t('row_goal'))}</span>
            <div class="dm-seg">${TARGETS.map((n) => `
              <button type="button" class="dm-segbtn ${n === this.target ? 'is-selected' : ''}" data-action="set-target" data-v="${n}">${n}</button>`).join('')}</div>
          </div>
          ${canResume ? `<button type="button" class="dm-btn is-go is-wide" data-action="resume">${esc(t('resume_match'))}</button>` : ''}
          <div class="dm-setup-actions">
            <button type="button" class="dm-btn" data-action="start">${esc(canResume ? t('new_match') : t('play'))}</button>
            <button type="button" class="dm-btn is-help" data-action="help" aria-label="${esc(t('aria_help'))}">?</button>
          </div>
        </div>
      </div>`;
  }

  // --- match lifecycle ----------------------------------------------------------------------

  startMatch() {
    saveSettings(this.difficulty, this.target);
    clearSave();
    this.game = new DominoesGame({ target: this.target });
    this.game.startMatch();
    this._bestRound = 0;
    this._statsCommitted = false;
    this._shownScores = [0, 0];
    this.selected = null;
    this._freshId = null;
    this.renderGame({ deal: true });
    this._persist();
    this.later(() => this._advance(), 1100);
  }

  resume(save) {
    this.difficulty = save.difficulty || this.difficulty;
    this.target = save.target || this.target;
    this.game = DominoesGame.fromSnapshot(save.snap);
    this._bestRound = save.bestRound | 0;
    this._statsCommitted = !!save.statsCommitted;
    this._shownScores = this.game.scores.slice();
    this.selected = null;
    this._freshId = null;
    this.renderGame({ deal: false });
    this.later(() => this._advance(), 320);
  }

  /** Deal the next round of the same match. */
  nextRound() {
    this.closeOverlays();
    this.game.startRound();
    this.selected = null;
    this._freshId = null;
    this.renderGame({ deal: true });
    this._persist();
    this.later(() => this._advance(), 1100);
  }

  _persist() {
    if (!this.game || this.view !== 'game') return;
    if (this.game.phase === 'matchOver') { clearSave(); return; }
    writeSave({
      snap: this.game.snapshot(),
      difficulty: this.difficulty,
      target: this.target,
      bestRound: this._bestRound,
      statsCommitted: this._statsCommitted,
      ts: Date.now(),
    });
  }

  // --- play screen --------------------------------------------------------------------------

  renderGame(opts = {}) {
    this.view = 'game';
    this.container.innerHTML = `
      <div class="dm-root">
        <div class="dm-play">
          <div class="dm-header">
            <button type="button" class="dm-iconbtn" data-action="to-setup-keep" aria-label="${esc(t('aria_to_setup'))}">${ICON_SETUP}</button>
            <div class="dm-hcenter" data-region="chrome"></div>
            <button type="button" class="dm-iconbtn" data-role="restart" data-action="restart" aria-label="${esc(t('aria_restart'))}">${ICON_RESTART}</button>
          </div>
          <div class="dm-mat" data-region="mat">
            <div class="dm-botrow" data-region="bot"></div>
            <div class="dm-thinking" data-region="thinking">${esc(t('bot_thinking'))}</div>
            <div class="dm-felt" role="img" aria-label="${esc(t('aria_board'))}">
              <div class="dm-chain" data-region="chain"></div>
              <div class="dm-fx" data-region="fx"></div>
            </div>
            <div class="dm-hand" data-region="hand" aria-label="${esc(t('aria_hand'))}"></div>
          </div>
          <div class="dm-floor"></div>
        </div>
      </div>`;
    const root = this.container.querySelector('.dm-root');
    this.el = {
      root,
      play: root.querySelector('.dm-play'),
      chrome: root.querySelector('[data-region="chrome"]'),
      bot: root.querySelector('[data-region="bot"]'),
      mat: root.querySelector('[data-region="mat"]'),
      felt: root.querySelector('.dm-felt'),
      chain: root.querySelector('[data-region="chain"]'),
      fx: root.querySelector('[data-region="fx"]'),
      hand: root.querySelector('[data-region="hand"]'),
      thinking: root.querySelector('[data-region="thinking"]'),
    };
    this.dealing = !!opts.deal;
    this._fit();
    this._refitSoon();
    this._syncChrome();
    this._syncHands();
    this._layoutBoard();
    if (this.dealing) this.later(() => { this.dealing = false; }, 900);
  }

  /** The play stack owns a fixed height so nothing in it can ever reflow, and a game screen that
   *  SCROLLS at all is a bug.
   *
   *  Measure the host directly, and only the host: `topInDoc` is where the game starts and
   *  `belowUs` is the page that exists AFTER the game's bottom edge (the hub's content padding,
   *  for one). Both are independent of our own height — when `--dm-h` changes, our bottom and the
   *  document's height move together — which makes this a stable fixed point that repeated calls
   *  converge on rather than drift from.
   *
   *  It replaced a version that set a height and then subtracted the whole document's overflow.
   *  That blamed this element for overflow it might not have caused, and it could not undo a bad
   *  first guess — it could only ever shrink. Combined with the timing bug below it collapsed the
   *  board to its minimum height on every resume.
   *
   *  `innerHeight`, not `visualViewport.height`: it has to share a basis with `scrollHeight`, and
   *  mixing the two made the correction over-shrink by the height of a phone's URL bar. */
  _fit() {
    if (!this.el) return;
    const root = this.el.root;
    const doc = document.documentElement;
    const vh = window.innerHeight;

    // How much page exists BELOW the game (the hub's content padding, for one) cannot be read
    // off `scrollHeight` directly: that value never drops below the viewport height, so an
    // element shorter than the screen makes plain empty space look like host chrome. So measure
    // it while the stack is deliberately TALLER than the viewport, where scrollHeight is pure
    // content: below = scrollHeight - ourTop - probeHeight. Both writes happen inside one frame,
    // so nothing is painted at the probe size.
    const PROBE = 2000;
    root.style.setProperty('--dm-h', PROBE + 'px');
    const rect = root.getBoundingClientRect();
    const topInDoc = rect.top + window.scrollY;
    const below = Math.max(0, doc.scrollHeight - topInDoc - PROBE);

    const h = Math.max(340, Math.min(880, Math.round(vh - topInDoc - below - GAP)));
    root.style.setProperty('--dm-h', h + 'px');
  }

  /** Fit again once the host has actually laid us out. The resume path mounts from the
   *  constructor, before the hub has positioned the container, so the first measurement can see a
   *  top of 0 and size the stack for the whole viewport. Re-fitting on the next frame (and again
   *  shortly after, for hosts that animate the mount) costs nothing — `_fit` is idempotent — and
   *  is what stops "go back to the hub and come back" from returning a collapsed board. */
  _refitSoon() {
    const again = () => { if (this.el && this.view === 'game') { this._fit(); this._layoutBoard(); } };
    requestAnimationFrame(again);
    this.later(again, 150);
  }

  _syncChrome() {
    if (!this.el || !this.game) return;
    const g = this.game;
    const diffLabel = t(DIFFS.find(([v]) => v === this.difficulty)[1]);
    this.el.chrome.innerHTML = `
      <span class="dm-chip">${diffShapeSVG(tierOf(this.difficulty))}${esc(diffLabel)}</span>
      <div class="dm-scorebar">
        <b class="dm-s-you" data-role="s0">${this._shownScores[0]}</b>
        <div class="dm-goal"><span>${esc(t('goal'))}</span><b>${g.target}</b></div>
        <b class="dm-s-bot" data-role="s1">${this._shownScores[1]}</b>
      </div>`;
    this.el.thinking.textContent = t('bot_thinking');
    this.el.mat.classList.toggle('is-cool', g.phase === 'playing' && g.turn === BOT);
  }

  _syncHands() {
    if (!this.el || !this.game) return;
    const g = this.game;
    this.el.bot.innerHTML = g.hands[BOT].map(() => '<div class="dm-back"></div>').join('');
    const myMoves = (g.turn === HUMAN && g.phase === 'playing') ? g.legalMoves(HUMAN) : [];
    const playable = new Set(myMoves.map((m) => m.tileId));
    // What each tile is WORTH, best case. Without this the player has no way to see which of
    // their legal moves scores, while the bot picks the best one every single turn - which is
    // not a difficulty gap, it is an information gap, and it read as the bot scoring at will.
    const worth = new Map();
    for (const m of myMoves) {
      const sc = scoreOf(countAfter(g.chain, m));
      if (sc > (worth.get(m.tileId) || 0)) worth.set(m.tileId, sc);
    }
    this.el.hand.innerHTML = g.hands[HUMAN].map((id, i) => {
      const cls = [];
      if (!playable.has(id)) cls.push('is-dead');
      if (id === this.selected) cls.push('is-sel');
      if (this.dealing) cls.push('is-dealt');
      const style = this.dealing ? `animation-delay:${60 * i}ms;--dm-from-x:${(i - 3) * 26}px` : '';
      const sc = worth.get(id) || 0;
      const html = tileHTML(TILES[id], {
        vertical: true, button: true, cls: cls.join(' '), style,
        aria: sc ? t('aria_tile_scores', { a: TILES[id][0], b: TILES[id][1], v: sc }) : tileAria(TILES[id]),
        attrs: ` data-action="pick" data-id="${id}"`,
      });
      return sc ? html.replace('</button>', `<i class="dm-worth">+${sc}</i></button>`) : html;
    }).join('');
  }

  /** Re-lay the chain and glide the whole group to its new centre. One transform on one
   *  container, never per-tile repositioning. */
  _layoutBoard() {
    if (!this.el || !this.game) return;
    const g = this.game;
    const { tiles, ends, bbox } = layoutChain(g.chain);
    const fw = this.el.felt.clientWidth || 360;
    const fh = this.el.felt.clientHeight || 360;
    const s = tiles.length
      ? Math.min(MAX_SCALE, (fw - FELT_PAD) / Math.max(1, bbox.w * UNIT), (fh - FELT_PAD) / Math.max(1, bbox.h * UNIT))
      : 1;
    const tx = fw / 2 - (bbox.x + bbox.w / 2) * UNIT * s;
    const ty = fh / 2 - (bbox.y + bbox.h / 2) * UNIT * s;
    this.el.chain.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    this.el.chain.style.setProperty('--dm-cs', String(1 / s));
    this._fit_ = { tx, ty, s };

    const scoringNow = this._isScoringState(g.countEnds());
    const targets = this._targetSides();
    const parts = tiles.map((tl) => tileHTML(tl.values, {
      vertical: tl.vertical, aria: tileAria(tl.values),
      cls: tl.id === this._freshId ? 'is-fresh' : '',
      style: `left:${tl.x * UNIT}px;top:${tl.y * UNIT}px;width:${tl.w * UNIT}px;height:${tl.h * UNIT}px`,
    }));
    for (const e of ends) {
      const isTarget = targets.has(e.side);
      // A `pending` side is a place to play, not an end: it scores nothing, so it must not look
      // like a number to add up. Neutral marker, and it shows the pip you MATCH rather than a
      // contribution it does not make.
      const cls = e.pending ? 'is-pending' : (scoringNow ? 'is-scoring' : '');
      const shown = e.pending ? e.value : e.contrib;
      const label = e.pending ? t('aria_end_open', { m: e.value }) : t('aria_end', { v: e.contrib, m: e.value });
      parts.push(`<button type="button" class="dm-end ${cls} ${isTarget ? 'is-target' : ''}"
        ${isTarget ? `data-action="drop" data-side="${e.side}"` : 'tabindex="-1" aria-hidden="true"'}
        aria-label="${esc(label)}"
        style="left:${e.x * UNIT}px;top:${e.y * UNIT}px;transform:translate(-50%,-50%) scale(var(--dm-cs,1))">${shown}</button>`);
    }
    this.el.chain.innerHTML = parts.join('');
    this.el.chain.classList.toggle('is-picking', targets.size > 0);
    this._freshId = null;
  }

  /** The ends the lifted tile could legally land on. Empty unless a tile is selected. */
  _targetSides() {
    const g = this.game;
    if (this.selected == null || !g || g.phase !== 'playing' || g.turn !== HUMAN) return new Set();
    return new Set(g.legalMoves(HUMAN).filter((m) => m.tileId === this.selected).map((m) => m.side));
  }

  _isScoringState(count) { return count > 0 && count % 5 === 0; }

  // --- turn loop ------------------------------------------------------------------------------

  /** The single place that decides what happens next. Every state change funnels back here. */
  _advance() {
    if (!this.game || this.view !== 'game') return;
    const g = this.game;
    if (g.phase !== 'playing') { this._finishRound(); return; }
    this._syncChrome();
    this._syncHands();
    if (g.turn === BOT) { this._botTurn(); return; }
    this.busy = false;
    const need = g.requiredAction(HUMAN);
    if (need === 'draw') { this.openBoneyard(); return; }
    this.closeBoneyard();
    if (need === 'pass') {
      this.busy = true;
      this.toast(t('you_passed'));
      this.later(() => { g.pass(HUMAN); this._persist(); this._advance(); }, 1000);
    }
  }

  _botTurn() {
    const g = this.game;
    this.busy = true;
    this.selected = null;
    this.closeBoneyard();
    this.el.thinking.classList.add('is-on');
    this.later(() => {
      this.el.thinking.classList.remove('is-on');
      if (!this.game || this.view !== 'game' || g.phase !== 'playing' || g.turn !== BOT) return;
      const need = g.requiredAction(BOT);
      if (need === 'draw') {
        g.draw(BOT);
        this.toast(t('bot_drew'));
        this._syncHands();
        this._persist();
        this.later(() => this._botTurn(), BOT_DRAW_MS);
        return;
      }
      if (need === 'pass') {
        this.toast(t('bot_passed'));
        g.pass(BOT);
        this._persist();
        this.later(() => this._advance(), 900);
        return;
      }
      const move = chooseMove(g, BOT, this.difficulty);
      this._commitPlay(BOT, move.tileId, move.side);
    }, THINK_MIN + Math.random() * THINK_VAR);
  }

  /** Apply one placement and play everything that hangs off it: the landing pop, the score
   *  burst, the header count-up, the reflow. */
  _commitPlay(seat, tileId, side) {
    const g = this.game;
    const before = g.scores.slice();
    const res = g.play(seat, tileId, side);
    if (!res.ok) { this._advance(); return; }
    this.selected = null;
    this._freshId = tileId;
    // Hand the felt over to the new turn NOW rather than at the end of the settle beat: the
    // cross-fade takes half a second, so starting it here lands it just as _advance() runs.
    this.el.mat.classList.toggle('is-cool', g.phase === 'playing' && g.turn === BOT);
    this._syncHands();
    this._layoutBoard();
    if (res.scored) this._burst(tileId, seat, res.scored);
    this._countUp(g.scores, before);
    this._persist();
    this.busy = true;
    this.later(() => this._advance(), res.roundOver ? ROUND_CARD_MS : AFTER_PLAY_MS);
  }

  /** The `+5` and its little star burst, right where the tile landed. */
  _burst(tileId, seat, points) {
    const { tiles } = layoutChain(this.game.chain);
    const tl = tiles.find((x) => x.id === tileId);
    const f = this._fit_;
    if (!tl || !f || !this.el) return;
    const x = f.tx + (tl.x + tl.w / 2) * UNIT * f.s;
    const y = f.ty + (tl.y + tl.h / 2) * UNIT * f.s;
    const stars = Array.from({ length: 5 }, (_, i) => {
      const ang = (Math.PI * 2 * i) / 5 + Math.random();
      return `<i class="dm-star" style="left:${x}px;top:${y}px;--dx:${Math.cos(ang) * 46}px;--dy:${Math.sin(ang) * 46}px"></i>`;
    }).join('');
    const pop = document.createElement('div');
    pop.innerHTML = `<div class="dm-pop ${seat === HUMAN ? 'is-you' : 'is-bot'}" style="left:${x}px;top:${y}px">+${points}</div>${stars}`;
    while (pop.firstChild) this.el.fx.appendChild(pop.firstChild);
    this.later(() => { if (this.el) this.el.fx.innerHTML = ''; }, 900);
  }

  /** Header scores tick up rather than jumping. */
  _countUp(toScores, fromScores) {
    clearInterval(this._countTimer);
    const from = fromScores.slice();
    const steps = 14;
    let i = 0;
    this._countTimer = setInterval(() => {
      i += 1;
      const k = Math.min(1, i / steps);
      this._shownScores = [0, 1].map((s) => Math.round(from[s] + (toScores[s] - from[s]) * k));
      const el0 = this.el && this.el.chrome.querySelector('[data-role="s0"]');
      const el1 = this.el && this.el.chrome.querySelector('[data-role="s1"]');
      if (el0) el0.textContent = this._shownScores[0];
      if (el1) el1.textContent = this._shownScores[1];
      if (k >= 1) { clearInterval(this._countTimer); this._shownScores = toScores.slice(); }
    }, 40);
  }

  toast(text) {
    if (!this.el) return;
    const old = this.el.play.querySelector('.dm-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'dm-toast';
    el.textContent = text;
    this.el.play.appendChild(el);
    this.later(() => el.remove(), 1700);
  }

  // --- boneyard ---------------------------------------------------------------------------------

  _boneWellHTML() {
    return this.game.boneyard.map((id) => tileHTML(null, {
      vertical: true, blank: true, button: true, aria: t('aria_boneyard_tile'),
      attrs: ` data-action="draw" data-id="${id}"`,
    })).join('');
  }

  openBoneyard() {
    if (!this.el || this.boneOpen) return;
    this.boneOpen = true;
    const el = document.createElement('div');
    el.className = 'dm-bone';
    el.dataset.role = 'bone';
    el.innerHTML = `<span class="dm-bone-title">${esc(t('boneyard'))}</span>
      <div class="dm-bone-well" data-role="bone-well">${this._boneWellHTML()}</div>`;
    this.el.play.appendChild(el);
  }

  /** The drawer stays put and only its grid re-lays out, so drawing several tiles in a row does
   *  not replay the slide-up each time. */
  _syncBoneyard() {
    if (!this.boneOpen || !this.el) return;
    const well = this.el.play.querySelector('[data-role="bone-well"]');
    if (well) well.innerHTML = this._boneWellHTML();
  }

  closeBoneyard() {
    if (!this.el) return;
    const el = this.el.play.querySelector('[data-role="bone"]');
    if (el) el.remove();
    this.boneOpen = false;
  }

  // --- round / match end -------------------------------------------------------------------------

  _finishRound() {
    const g = this.game;
    this._bestRound = Math.max(this._bestRound, g.roundScore[HUMAN] | 0);
    this.closeBoneyard();
    this.el.mat.classList.remove('is-cool');
    this._shownScores = g.scores.slice();
    this._syncChrome();
    this._syncHands();
    if (g.phase === 'matchOver') this._recordMatch();
    this._persist();
    this.showRoundCard();
  }

  _recordMatch() {
    if (this._statsCommitted) return;
    this._statsCommitted = true;
    const g = this.game;
    try {
      // matchWinner is null on a genuine draw (both totals passed the target level), and
      // recordDominoes reads null as a tie rather than a loss.
      recordDominoes(this.difficulty, g.matchWinner == null ? null : g.matchWinner === HUMAN, {
        rounds: g.round,
        bestRound: this._bestRound,
        points: g.scores[HUMAN],
      });
    } catch (e) {
      console.error('[dominoes] stats write failed', e);
    }
  }

  /** The round card, and — on the last round — the Game Finished card (addendum §D): same slate
   *  shell, but titled `Game Finished!` with no rules reminder under it, and the avatar becomes
   *  the WINNER's own face on a green celebration disc with a crown over it. The face stays the
   *  winner's rather than a generic green one, and the rows stay YOU/BOT rather than switching to
   *  colour names, so the red-you / blue-bot identity the rest of the screen teaches survives to
   *  the last screen — the addendum recommends exactly that. */
  showRoundCard() {
    const g = this.game;
    const over = g.phase === 'matchOver';
    const drawn = over && g.matchWinner == null;
    const youWon = over ? g.matchWinner === HUMAN : g.roundWinner === HUMAN;
    const title = over ? t('game_over') : t('round_n', { n: g.round });
    const rows = [
      { label: t('you'), round: g.roundScore[HUMAN], total: g.scores[HUMAN] },
      { label: t('bot'), round: g.roundScore[BOT], total: g.scores[BOT] },
    ];
    const rank = rows[0].total === rows[1].total ? [null, null]
      : rows[0].total > rows[1].total ? [1, 2] : [2, 1];
    const overlay = document.createElement('div');
    overlay.className = 'dm-overlay';
    overlay.dataset.role = 'round';
    overlay.innerHTML = `
      <div class="dm-scrim"></div>
      <div class="dm-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="dm-x" data-action="close-card" aria-label="${esc(t('aria_close'))}">&times;</button>
        <div class="dm-card-av ${youWon && !drawn ? 'is-you' : ''} ${over && !drawn ? 'is-champion' : ''}">
          ${over && !drawn ? `<span class="dm-crown">${CROWN_SVG}</span>` : ''}
          ${youWon && !drawn ? YOU_FACE_SVG : botFaceSVG(this.difficulty)}
        </div>
        <h3>${esc(title)}</h3>
        ${over ? '<div class="dm-card-gap"></div>' : `<p class="dm-card-note">${esc(t('round_rule', { n: g.target }))}</p>`}
        <div class="dm-cols"><span>${esc(t('col_player'))}</span><span>${esc(t('col_round'))}</span><span>${esc(t('col_total'))}</span></div>
        ${rows.map((r, i) => `<div class="dm-scorerow">
          ${rank[i] ? `<i class="dm-medal is-${rank[i]}" style="animation-delay:${900 + i * 120}ms">${rank[i]}</i>` : ''}
          <span>${esc(r.label)}</span><span data-role="tally" data-to="${r.round}">0</span><span data-role="tally" data-to="${r.total}">0</span>
        </div>`).join('')}
        <div class="dm-card-actions">
          <button type="button" class="dm-btn is-stop is-icon" data-action="${over ? 'to-setup' : 'restart-match'}" aria-label="${esc(t('aria_restart'))}">${ICON_RESTART}</button>
          <button type="button" class="dm-btn is-go" data-action="${over ? 'rematch' : 'next-round'}">${esc(over ? t('play_again') : t('continue'))}</button>
        </div>
      </div>`;
    this.el.play.appendChild(overlay);
    this._tally(overlay);
  }

  /** The numbers count up from zero over about a second, then the medals slide in. */
  _tally(overlay) {
    const cells = [...overlay.querySelectorAll('[data-role="tally"]')];
    const steps = 22;
    let i = 0;
    const tm = setInterval(() => {
      i += 1;
      const k = Math.min(1, i / steps);
      for (const c of cells) c.textContent = Math.round((+c.dataset.to || 0) * k);
      if (k >= 1) clearInterval(tm);
    }, 40);
    this.timers.push(tm);
  }

  // --- overlays ------------------------------------------------------------------------------

  /** Queries the CONTAINER, not `this.el`: help opens on the setup screen too, where there is no
   *  play shell at all (`this.el` is null there), and an early return on that left the card
   *  stuck open over an unclickable Play button. */
  closeOverlays() {
    if (this._closeTutorial) { this._closeTutorial(); this._closeTutorial = null; }
    this.container.querySelectorAll('.dm-overlay').forEach((el) => el.remove());
  }

  /** How to play is the eight-page carousel now (addendum §B); tutorial.js owns it and hands
   *  back its own teardown, which closeOverlays() also has to run so the keydown listener the
   *  carousel installs on `document` never outlives the card. */
  openHelp() {
    this.closeOverlays();
    const host = this.el ? this.el.play : this.container.querySelector('.dm-root');
    this._closeTutorial = openTutorial(host, t);
  }

  /** Restart is destructive mid-match, so it arms first and fires on a second tap. */
  confirmDestructive(btn, action) {
    if (!this.game || this.game.phase !== 'playing') { action(); return; }
    if (btn.dataset.armed === '1') { this.resetConfirm(); action(); return; }
    this.resetConfirm();
    btn.dataset.armed = '1';
    btn.dataset.icon = btn.innerHTML;
    btn.textContent = t('tap_again_confirm');
    btn.classList.add('is-confirm');
    this._confirmTimer = setTimeout(() => this.resetConfirm(), 3500);
  }

  resetConfirm() {
    clearTimeout(this._confirmTimer);
    const b = this.container.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.innerHTML = b.dataset.icon;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  // --- input ---------------------------------------------------------------------------------

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.container.contains(btn)) return;
    const action = btn.dataset.action;

    if (action === 'set-diff') {
      this.difficulty = btn.dataset.v;
      saveSettings(this.difficulty, this.target);
      this.renderSetup();
    } else if (action === 'set-target') {
      this.target = Number(btn.dataset.v) || 300;
      saveSettings(this.difficulty, this.target);
      this.renderSetup();
    } else if (action === 'start' || action === 'rematch') {
      this.startMatch();
    } else if (action === 'to-setup') {
      clearSave();
      this.renderSetup();
    } else if (action === 'to-setup-keep') {
      // Non-destructive: the save stays, so the setup screen can offer Resume and nothing is
      // lost by looking. Only `start` (a fresh match) ever clears it.
      this._persist();
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'resume') {
      const save = loadSave();
      if (save && save.snap && save.snap.phase !== 'matchOver') this.resume(save);
      else this.renderSetup();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startMatch());
    } else if (action === 'restart-match') {
      this.startMatch();
    } else if (action === 'next-round') {
      this.nextRound();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'close-card') {
      this.closeOverlays();
    } else if (action === 'pick') {
      this._onPick(Number(btn.dataset.id));
    } else if (action === 'drop') {
      this._onDrop(btn.dataset.side);
    } else if (action === 'draw') {
      this._onDraw(Number(btn.dataset.id));
    }
  }

  /** Tapping a tile: one legal end plays it straight away, several lifts it and lights the
   *  badges so the player picks which end. */
  _onPick(tileId) {
    const g = this.game;
    if (this.busy || !g || g.phase !== 'playing' || g.turn !== HUMAN) return;
    const sides = g.legalMoves(HUMAN).filter((m) => m.tileId === tileId).map((m) => m.side);
    if (!sides.length) return;
    if (this.selected === tileId) { this.selected = null; this._syncHands(); this._layoutBoard(); return; }
    if (sides.length === 1) { this._commitPlay(HUMAN, tileId, sides[0]); return; }
    this.selected = tileId;
    this._syncHands();
    this._layoutBoard();
    this.toast(t('pick_an_end'));
  }

  _onDrop(side) {
    const g = this.game;
    if (this.busy || this.selected == null || !g || g.turn !== HUMAN) return;
    this._commitPlay(HUMAN, this.selected, side);
  }

  _onDraw(tileId) {
    const g = this.game;
    if (!g || g.phase !== 'playing' || g.turn !== HUMAN) return;
    const res = g.drawTile(HUMAN, tileId);
    if (!res.ok) return;
    this._persist();
    this._syncHands();
    if (res.canPlay) { this.closeBoneyard(); this._advance(); }
    else if (!g.boneyard.length) { this.closeBoneyard(); this._advance(); }
    else this._syncBoneyard();
  }
}

// --- hub module contract -----------------------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new DominoesUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** Autosave/resume built in (`gamehub.dominoes.save.v1`): the match snapshots after every
 *  settled action and restores silently on the next mount, so leaving mid-match is lossless.
 *  Per root CLAUDE.md's "two legitimate meanings" for isInProgress(), this is the
 *  autosave/resume meaning and always returns false — the hub's "leave game?" confirm would
 *  be a lie here. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
