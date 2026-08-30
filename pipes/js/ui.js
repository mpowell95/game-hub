// pipes/js/ui.js - the DOM shell, input, and the water animation. The rules live in game.js and
// the board generation in generator.js; nothing here decides anything about the puzzle.
//
// THE MODULE CONTRACT: init / destroy / isInProgress, plus the default bundle
// (docs/BUILDING-A-GAME.md, "The module contract"). `destroy()` must be leak-free - the hub reuses
// the same container for the next game.
//
// isInProgress() RETURNS FALSE, DELIBERATELY. This is the Nuts & Bolts class, not the Ball Run
// class: the board autosaves after every single turn, so leaving is lossless and the hub has no
// reason to interrupt with a "leave game?" confirm. Nothing here is ever mid-anything.
//
// HOW A TILE IS DRAWN, because it is the one thing worth knowing before editing this file. The SVG
// for a cell is built ONCE, for the mask the piece had when the board was mounted, and a turn only
// changes a CSS `transform: rotate()`. That is why rotation animates for free and costs nothing:
// no path is rebuilt, no layout runs, and `transform` is on the UX floor's allowed list. The
// authoritative mask is always game.cells[i]; the transform is presentation only.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the screens theme standalone too
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { recordPipes } from '../../js/game-stats.js';
import { PipesGame } from './game.js';
import { TIER_ORDER, kindOf, popcount, N, E, S, W, DIRS } from './generator.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.pipes.v1';
const SAVE_KEY = 'gamehub.pipes.save.v1';

/** Per-tile delay along the flow order. 9 tiles/second reads as water travelling rather than a
 *  board flicking on, and a 30-tile path lands inside the 1.2-1.8s window the scope asked for. */
const WET_STEP_MS = 34;

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    return { tier: TIER_ORDER.includes(v.tier) ? v.tier : 'easy' };
  } catch { return { tier: 'easy' }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[pipes] settings', err); }
  return next;
}
function loadSave() {
  try { return PipesGame.fromJSON(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch { return null; }
}
function writeSave(game) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch (err) { console.error('[pipes] save', err); }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The pipe art for one mask: a stroked arm from the centre to each open side, plus a hub dot.
 *  Drawn in a 100x100 box so the cell can be any size. */
function pipeSVG(mask, cls, color) {
  if (!popcount(mask)) return '';
  const arms = [];
  if (mask & N) arms.push('M50 50 L50 2');
  if (mask & E) arms.push('M50 50 L98 50');
  if (mask & S) arms.push('M50 50 L50 98');
  if (mask & W) arms.push('M50 50 L2 50');
  const cap = popcount(mask) === 1
    ? `<circle cx="50" cy="50" r="17" fill="${color}"/>`
    : `<circle cx="50" cy="50" r="11" fill="${color}"/>`;
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">`
    + `<g stroke="${color}" stroke-width="22" stroke-linecap="round" fill="none">`
    + arms.map((d) => `<path d="${d}"/>`).join('')
    + `</g>${cap}</svg>`;
}

class PipesUI {
  constructor(root) {
    this.root = root;
    this.root.classList.add('pi-root');
    this.settings = loadSettings();
    this.game = null;
    this.cellEls = [];
    this.spins = null;
    this.wetTimers = [];
    this.offViewport = null;
    this.offLang = null;
    this._onKey = null;
    this.renderSetup();
  }

  /** The best line under the tier picker, read from the SHARED store - this game keeps no
   *  earned history of its own (see pipes/CLAUDE.md, Persistence). */
  _bestLine() {
    try {
      const pi = (JSON.parse(localStorage.getItem('gamehub.stats') || '{}').games || {}).pipes;
      const solved = ((pi || {}).pi || {}).solved | 0;
      return solved ? `${t('best_level')}: ${solved}` : t('no_best');
    } catch { return t('no_best'); }
  }

  // --- screens -----------------------------------------------------------------------------------

  renderSetup() {
    this.screen = 'setup';
    this._stopWater();
    const saved = loadSave();
    // A .gh-card holding a .gh-seg segmented control for the tier, then .gh-btn--block actions -
    // the same vocabulary every other screen in the hub uses. The difficulty SHAPE marker comes
    // from js/difficulty-tiers.js, because hue alone is never allowed (Matt is red/green
    // colourblind).
    const seg = TIER_ORDER.map((d) => `
      <button type="button" class="gh-btn pi-seg${d === this.settings.tier ? ' is-on' : ''}" data-tier="${d}"
        aria-pressed="${d === this.settings.tier ? 'true' : 'false'}">
        ${diffShapeSVG(tierOf(d))}<span>${esc(t('diff_' + d))}</span>
      </button>`).join('');

    this.root.innerHTML = `
      <div class="pi-screen pi-setup">
        <div class="gh-card pi-setup-card">
          <h2 class="gh-field__label">${esc(t('setup_difficulty'))}</h2>
          <div class="pi-seg-wrap" role="group" aria-label="${esc(t('setup_difficulty'))}">${seg}</div>
          <p class="pi-best">${esc(this._bestLine())}</p>
        </div>
        <div class="pi-actions">
          ${saved && saved.solvedAt === null
            ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${esc(t('resume'))}</button>`
            : ''}
          <button type="button" class="gh-btn gh-btn--block ${saved && saved.solvedAt === null ? 'gh-btn--ghost' : 'gh-btn--primary'}" data-role="play">${esc(t('play'))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="howto">${esc(t('howto'))}</button>
        </div>
      </div>`;

    this.root.querySelectorAll('[data-tier]').forEach((el) => {
      el.addEventListener('click', () => {
        this.settings = saveSettings({ tier: el.dataset.tier });
        this.renderSetup();
      });
    });
    const resume = this.root.querySelector('[data-role="resume"]');
    if (resume) resume.addEventListener('click', () => this.startGame(loadSave()));
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => this.startGame(null));
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this.renderHowTo());
  }

  /** One bold sentence, ONE diagram carrying the non-obvious part, a caption, short rules - the
   *  repo-wide pattern (docs/BUILDING-A-GAME.md Part 2). The non-obvious part here is NOT "turn the
   *  pipes", which anyone can see; it is that an open end anywhere on the run is a leak. */
  renderHowTo() {
    this.screen = 'howto';
    const box = (mask, color, label) => `
      <figure>
        <svg viewBox="0 0 100 100" width="76" height="76" aria-hidden="true">
          <rect width="100" height="100" rx="10" fill="var(--pi-tile)"/>
          ${pipeSVG(mask, '', color).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}
        </svg>
        <figcaption>${esc(label)}</figcaption>
      </figure>`;
    this.root.innerHTML = `
      <div class="pi-screen">
        <div class="gh-card">
        <p class="pi-howto-lead">${esc(t('howto_lead'))}</p>
        <div class="pi-howto-fig">
          ${box(N | E | S, 'var(--pi-leak)', t('howto_leak'))}
          ${box(N | S, 'var(--pi-water)', t('howto_sealed'))}
        </div>
        <p class="pi-howto-cap">${esc(t('howto_caption'))}</p>
        <ul class="pi-howto-rules">
          <li>${esc(t('howto_rule_1'))}</li>
          <li>${esc(t('howto_rule_2'))}</li>
          <li>${esc(t('howto_rule_3'))}</li>
        </ul>
        </div>
        <div class="pi-actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="close">${esc(t('howto_close'))}</button>
        </div>
      </div>`;
    this.root.querySelector('[data-role="close"]').addEventListener('click', () => this.renderSetup());
  }

  startGame(saved) {
    this.game = saved || new PipesGame({ tier: this.settings.tier });
    this.renderPlay();
  }

  renderPlay() {
    this.screen = 'play';
    this._stopWater();
    const g = this.game;
    this.root.innerHTML = `
      <div class="pi-screen">
        <div class="pi-hud">
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="back">${esc(t('hud_back'))}</button>
          <span class="pi-hud-stat">${esc(t('hud_moves'))} <b data-role="moves">0</b></span>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="new">${esc(t('hud_new'))}</button>
        </div>
        <div class="pi-boardwrap"><div class="pi-board" data-role="board"
          role="group" aria-label="${esc(t('aria_board', { w: g.w, h: g.h }))}"></div></div>
        <div class="pi-banner" data-role="banner"></div>
      </div>`;

    this.el = {
      board: this.root.querySelector('[data-role="board"]'),
      moves: this.root.querySelector('[data-role="moves"]'),
      banner: this.root.querySelector('[data-role="banner"]'),
    };
    this.root.querySelector('[data-role="back"]').addEventListener('click', () => this.renderSetup());
    this.root.querySelector('[data-role="new"]').addEventListener('click', () => {
      clearSave();
      this.game = new PipesGame({ tier: this.settings.tier });
      this.renderPlay();
    });

    // Dev hook, read-only. Pinball shipped four times on green headless tests while being
    // unplayable, because every fault lived in the DOM glue no headless test constructs. This is
    // how a browser session can see what the board actually is.
    try { window.__piTest = { ui: this, game: g }; } catch { /* no window */ }
    this._buildBoard();
    this._fit();
    // The hub mounts this container and lays it out in the same frame, so the first measure can
    // land before the host has a height. Measure again once layout has settled.
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    this._paint();
    if (g.solvedAt !== null) this._runWater(true);
  }

  _buildBoard() {
    const g = this.game;
    this.cellEls = new Array(g.w * g.h);
    this.spins = new Int16Array(g.w * g.h);
    this.el.board.style.gridTemplateColumns = `repeat(${g.w}, var(--pi-cell))`;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < g.cells.length; i++) {
      const mask = g.cells[i];
      const [x, y] = g.xy(i);
      const fixed = popcount(mask) === 0 || popcount(mask) === 4;
      const el = document.createElement('div');
      // A DIV WITH role="button", NOT A <button> - Safari before 16.4 will not reliably make a
      // <button> a flex/grid container, and this element is drawn dozens of times per screen
      // (dominoes/CLAUDE.md, generalised in docs/BUILDING-A-GAME.md Part 0).
      el.className = 'pi-cell' + (fixed ? ' is-fixed' : '');
      el.dataset.i = String(i);
      if (!fixed) {
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
      }
      el.setAttribute('aria-label', t('aria_cell', { r: y + 1, c: x + 1, piece: t('piece_' + kindOf(mask)) }));
      el.innerHTML = pipeSVG(mask, 'pi-art', 'var(--pi-pipe)')
        + pipeSVG(mask, 'pi-water', i === g.src || i === g.dst ? 'var(--pi-cap)' : 'var(--pi-water)');
      frag.appendChild(el);
      this.cellEls[i] = el;
    }
    this.el.board.appendChild(frag);

    // ONE delegated listener for the whole grid, not one per tile: a board is up to 72 cells and
    // destroy() has to be able to remove every listener it added.
    this._onBoardClick = (ev) => {
      const cell = ev.target.closest('.pi-cell');
      if (!cell || !this.el.board.contains(cell)) return;
      this._tap(Number(cell.dataset.i));
    };
    this._onBoardKey = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const cell = ev.target.closest('.pi-cell');
      if (!cell) return;
      ev.preventDefault();
      this._tap(Number(cell.dataset.i));
    };
    this.el.board.addEventListener('click', this._onBoardClick);
    this.el.board.addEventListener('keydown', this._onBoardKey);
  }

  _tap(i) {
    const g = this.game;
    const el = this.cellEls[i];
    if (!g.turn(i)) {
      // A cross or a blank cannot turn. Nudge it rather than doing nothing, so the tap is
      // acknowledged instead of reading as an unresponsive control.
      el.classList.remove('is-nudge');
      void el.offsetWidth;
      el.classList.add('is-nudge');
      return;
    }
    this.spins[i] += 1;
    el.querySelector('.pi-art').style.setProperty('--pi-rot', `${this.spins[i] * 90}deg`);
    el.querySelector('.pi-art').style.transform = `rotate(${this.spins[i] * 90}deg)`;
    const wat = el.querySelector('.pi-water');
    if (wat) wat.style.transform = `rotate(${this.spins[i] * 90}deg)`;
    el.setAttribute('aria-label', t('aria_cell', {
      r: g.xy(i)[1] + 1, c: g.xy(i)[0] + 1, piece: t('piece_' + kindOf(g.cells[i])),
    }));
    this._paint();
    writeSave(g);

    if (g.checkSolved(Date.now())) {
      writeSave(g);
      this._runWater(false);
      try {
        const r = g.result();
        recordPipes(r.level, r.moves, r.tier);
      } catch (err) { console.error('[pipes] recordPipes', err); }
    }
  }

  /** Repaint the live state: move count, which tiles are wet, which are leaking. */
  _paint() {
    const g = this.game;
    this.el.moves.textContent = String(g.moves);
    const { reached, leaks } = g.flow();
    const leakSet = new Set(leaks);
    // NO LEAK STYLING BEFORE THE FIRST TURN. A fresh board's inlet cap points at whatever the
    // scramble gave it, so `flow()` honestly reports a leak on move zero - and a puzzle that opens
    // by telling you off, in red, before you have touched anything reads as a fault rather than a
    // hint. Feedback starts the moment the player engages.
    const showLeaks = g.moves > 0;
    for (let i = 0; i < this.cellEls.length; i++) {
      const el = this.cellEls[i];
      el.classList.toggle('is-leak', showLeaks && g.solvedAt === null && leakSet.has(i));
      if (g.solvedAt === null) el.classList.toggle('is-wet', reached.has(i) && !leakSet.size);
    }
    const solved = g.solvedAt !== null;
    const leaking = showLeaks && leaks.length > 0;
    this.el.banner.className = 'pi-banner' + (solved ? ' is-win' : leaking ? ' is-leak' : '');
    this.el.banner.textContent = solved ? t('solved_moves', { n: g.moves }) : (leaking ? t('leaking') : '');
  }

  /**
   * THE WATER RUN, and it is the thing Matt asked to be treated as first-class:
   * *"Animations are what really impresses people playing the games."*
   *
   * It walks `flow().order` - the rules' own breadth-first order out of the inlet - and wets one
   * tile every WET_STEP_MS. The render layer never works the path out for itself, so it cannot
   * disagree with the rules about where the water goes.
   *
   * Each tile is revealed with opacity + a small scale pop, both on the UX floor's allowed list.
   * A true directional fill along each pipe would want `stroke-dashoffset`, which is NOT on that
   * list; see pipes/CLAUDE.md for that trade.
   */
  _runWater(instant) {
    this._stopWater();
    const g = this.game;
    const order = g.flow().order;
    const reduced = (() => {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
      catch { return false; }
    })();
    for (const i of this.cellEls.keys()) this.cellEls[i].classList.remove('is-leak');
    if (instant || reduced) {
      for (const i of order) this.cellEls[i].classList.add('is-wet');
      this.el.banner.className = 'pi-banner is-win';
      this.el.banner.textContent = t('solved_moves', { n: g.moves });
      return;
    }
    for (const i of this.cellEls.keys()) this.cellEls[i].classList.remove('is-wet');
    order.forEach((i, k) => {
      this.wetTimers.push(setTimeout(() => this.cellEls[i].classList.add('is-wet'), k * WET_STEP_MS));
    });
    this.wetTimers.push(setTimeout(() => {
      this.el.banner.className = 'pi-banner is-win';
      this.el.banner.textContent = t('solved_moves', { n: g.moves });
    }, order.length * WET_STEP_MS + 120));
  }

  _stopWater() {
    for (const id of this.wetTimers) clearTimeout(id);
    this.wetTimers.length = 0;
  }

  /**
   * Size the cells so the whole board fits ONE screen, with no scrolling and no cell under the
   * 44px tap floor. A game screen that scrolls at all is a bug (dominoes/CLAUDE.md), and the tier
   * sizes in generator.js were chosen against this arithmetic rather than by eye.
   */
  /**
   * Size the cells so the board fills the space it actually has.
   *
   * IT MEASURES AGAINST THE VIEWPORT, NOT ITS OWN WRAPPER, and that is the fix rather than a
   * detail. The first version measured `.pi-boardwrap`, which is `flex: 1` inside a column - and
   * inside the HUB the host container has no definite height, so that flex child collapsed to its
   * own content and reported a box barely bigger than the board already was. The board came out
   * tiny and pinned to the top with the whole screen empty below it (Matt: "the box is not the
   * right size at all"). Reading the viewport and subtracting what is above and below cannot
   * collapse that way.
   *
   * A game screen that scrolls at all is a bug (dominoes/CLAUDE.md), so the result is clamped to
   * what fits - and never below the 44px tap floor unless the device genuinely cannot give it,
   * in which case fitting on screen wins and the tier sizes are what keep that from happening.
   */
  _fit() {
    if (this.screen !== 'play' || !this.el || !this.el.board) return;
    const wrap = this.el.board.parentElement;
    const r = wrap.getBoundingClientRect();
    if (r.width < 2) return;
    const g = this.game;
    // THESE MUST MATCH .pi-board IN THE CSS. They did not at first (4 and 14 against the sheet's
    // 2 and 6), which quietly shaved every cell: this arithmetic has to describe the box that
    // actually gets laid out, not an approximation of it.
    const GAP = 2, PAD = 12;

    // visualViewport is the honest height on mobile while the URL bar is animating.
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    const below = (this.el.banner ? this.el.banner.getBoundingClientRect().height : 44) + 16;
    const avail = Math.max(120, vh - r.top - below);

    const byW = (r.width - PAD - GAP * (g.w - 1)) / g.w;
    const byH = (avail - PAD - GAP * (g.h - 1)) / g.h;
    const size = Math.max(26, Math.floor(Math.min(byW, byH)));
    this.el.board.style.setProperty('--pi-cell', size + 'px');
    this.el.board.style.gridTemplateColumns = `repeat(${g.w}, ${size}px)`;
    this.el.board.style.gridAutoRows = size + 'px';
  }

  destroy() {
    this._stopWater();
    if (this.el && this.el.board) {
      this.el.board.removeEventListener('click', this._onBoardClick);
      this.el.board.removeEventListener('keydown', this._onBoardKey);
    }
    if (this.offViewport) this.offViewport();
    if (this.offLang) this.offLang();
    this.offViewport = this.offLang = null;
    this.root.classList.remove('pi-root');
    this.root.innerHTML = '';
    this.game = null;
    this.cellEls = [];
  }
}

// --- the module contract ---------------------------------------------------------------------------

let instance = null;

function injectCSS() {
  // THE SHARED PRIMITIVES FIRST. This game's screens are BUILT on css/ui.css - the .gh-* buttons,
  // cards, fields and segmented controls - rather than reinvented. Root CLAUDE.md puts it plainly:
  // a new game is the cheapest possible place to adopt them, because there is nothing to migrate.
  // The first version of this file ignored that and hand-rolled its own chrome; Matt: "you made
  // this setup screen completely from scratch. it looks nothing like anything we've created
  // before." Same injection marker skeeball/js/ui.js and bug-report-ui.js use, so the sheet is
  // never double-loaded.
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-pipes-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/pipes.css', import.meta.url).href;
  link.setAttribute('data-pipes-css', '1');
  document.head.appendChild(link);
}

export function init(container) {
  injectCSS();
  if (instance) instance.destroy();
  instance = new PipesUI(container);
  // onViewportResize, never a raw resize listener: mobile browsers fire `resize` continuously while
  // the URL bar animates, and a raw listener re-lays-out several times per frame (js/viewport.js).
  instance.offViewport = onViewportResize(() => instance._fit());
  instance.offLang = onLangChange(() => {
    if (instance.screen === 'setup') instance.renderSetup();
    else if (instance.screen === 'howto') instance.renderHowTo();
    else if (instance.screen === 'play') instance.renderPlay();
  });
  return instance;
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** FALSE on purpose. The board autosaves after every turn, so leaving is lossless and the hub has
 *  nothing to warn about - the Nuts & Bolts class, not the Ball Run class. See this file's header. */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
