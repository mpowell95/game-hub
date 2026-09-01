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
import { TIER_ORDER, tierConfig, kindOf, popcount, N, E, S, W, DIRS } from './generator.js';
import { pipeSVG } from './art.js';
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

/**
 * WHICH BOARD YOU ARE ON, PER TIER - DERIVED, never stored here.
 *
 * `recordPipes()` already increments `games.pipes.byDiff[<tier>].won` on every solve, so "boards
 * solved at this tier, plus one" IS the level. Deriving it means there is no second copy to drift
 * out of step, nothing new that could be lost (THE LAW), and - because the stats store syncs to
 * `players/<id>` - your level follows you to your other phone. Nuts & Bolts, which this is modelled
 * on, keeps its levels in its own local settings key and they do not travel.
 *
 * NOTE THE LOWERCASE. `js/game-stats.js` runs every tier id through `normDiff()`, so 'extraHard' is
 * stored under 'extrahard'. Reading it back with the mixed-case id silently returns level 1 forever
 * on the one tier hardest to reach.
 */
function pipesStats() {
  try { return (JSON.parse(localStorage.getItem('gamehub.stats') || '{}').games || {}).pipes || {}; }
  catch { return {}; }
}
function levelOf(tier) {
  const byDiff = pipesStats().byDiff || {};
  return ((byDiff[String(tier).toLowerCase()] || {}).won | 0) + 1;
}
function solvedTotal() { return (pipesStats().pi || {}).solved | 0; }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class PipesUI {
  constructor(root) {
    this.root = root;
    this.root.classList.add('pi-root');
    this.settings = loadSettings();
    this.game = null;
    this.cellEls = [];
    this.spins = null;
    this.wetTimers = [];
    this._lastFillMs = 0;
    this.level = 1;
    this.replaying = false;
    this._onFootClick = null;
    this.offViewport = null;
    this.offLang = null;
    this._onKey = null;
    this.renderSetup();
  }

  /** The running total under the tier picker, read from the SHARED store - this game keeps no
   *  earned history of its own (see pipes/CLAUDE.md, Persistence). Each tier button carries its own
   *  level now, so this is the sum across all four rather than a "best" of anything. */
  _bestLine() {
    const n = solvedTotal();
    return n ? t('solved_total', { n }) : t('no_best');
  }

  // --- screens -----------------------------------------------------------------------------------

  renderSetup() {
    this.screen = 'setup';
    this._stopWater();
    const saved = loadSave();
    // THE SHAPE IS NUTS & BOLTS', DELIBERATELY, because that is the game Matt compared this one
    // to and it is this hub's reference for a solo-puzzle setup screen: a header with the game
    // name and one line under it, a labelled field holding ONE ROW of tier options (shape marker
    // above the name, a sub-line under it), then a primary action and a ghost "How to play".
    //
    // Two earlier versions of this screen were invented from scratch instead of copied, and Matt
    // said so twice. The lesson written into pipes/CLAUDE.md is the checklist's own: copy the
    // reference per axis, and for a setup screen the reference is a real screen in this repo.
    const seg = TIER_ORDER.map((d) => `
      <button type="button" class="pi-seg${d === this.settings.tier ? ' is-on' : ''}" data-tier="${d}"
        role="radio" aria-checked="${d === this.settings.tier ? 'true' : 'false'}">
        <span class="pi-seg-label">${diffShapeSVG(tierOf(d))}<b>${esc(t('diff_' + d))}</b></span>
        <span class="pi-seg-lvl">${esc(t('level_n', { n: levelOf(d) }))}</span>
        <span class="pi-seg-sub">${esc(t('grid_n', { w: tierConfig(d).w, h: tierConfig(d).h }))}</span>
      </button>`).join('');

    this.root.innerHTML = `
      <div class="pi-screen pi-setup">
        <div class="pi-menu-header">
          <h1>${esc(t('title'))}</h1>
          <p>${esc(t('tagline'))}</p>
        </div>
        <div class="pi-field">
          <span class="pi-fieldlabel" id="pi-difflabel">${esc(t('setup_difficulty'))}</span>
          <div class="pi-seg-wrap" role="radiogroup" aria-labelledby="pi-difflabel">${seg}</div>
        </div>
        <p class="pi-best">${esc(this._bestLine())}</p>
        ${saved && saved.solvedAt === null
          ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${esc(t('resume'))}</button>`
          : ''}
        <button type="button" class="gh-btn gh-btn--block ${saved && saved.solvedAt === null ? 'gh-btn--ghost' : 'gh-btn--primary'}" data-role="play">${esc(t('play'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="howto">${esc(t('howto'))}</button>
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
    this._fillHeight();
    requestAnimationFrame(() => this._fillHeight());
  }

  /** One bold sentence, ONE diagram carrying the non-obvious part, a caption, short rules - the
   *  repo-wide pattern (docs/BUILDING-A-GAME.md Part 2). The non-obvious part here is NOT "turn the
   *  pipes", which anyone can see; it is that an open end anywhere on the run is a leak. */
  renderHowTo() {
    this.screen = 'howto';
    const box = (mask, mode, label) => `
      <figure>
        <svg viewBox="0 0 100 100" width="76" height="76" aria-hidden="true">
          ${pipeSVG(mask, '', mode).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}
        </svg>
        <figcaption>${esc(label)}</figcaption>
      </figure>`;
    this.root.innerHTML = `
      <div class="pi-screen">
        <div class="gh-card">
        <p class="pi-howto-lead">${esc(t('howto_lead'))}</p>
        <div class="pi-howto-fig">
          ${box(N | E | S, 'dry', t('howto_leak'))}
          ${box(N | S, 'wet', t('howto_sealed'))}
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
    this._fillHeight();
  }

  startGame(saved) {
    this.game = saved || new PipesGame({ tier: this.settings.tier });
    this.replaying = false;
    // Captured when the board starts, so the number on screen cannot change under the player
    // mid-board when the solve is recorded.
    this.level = levelOf(this.game.tier);
    this.renderPlay();
  }

  renderPlay() {
    this.screen = 'play';
    this._stopWater();
    const g = this.game;
    this.root.innerHTML = `
      <div class="pi-screen pi-play">
        <div class="pi-hud">
          <button type="button" class="pi-icon" data-role="back" aria-label="${esc(t('hud_back'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 L7 12 L15 20"/></svg>
          </button>
          <span class="pi-hud-stats">
            <span class="pi-hud-level">${esc(t('level_n', { n: this.level }))}</span>
            <span class="pi-hud-stat">${esc(t('hud_moves'))} <b data-role="moves">0</b></span>
          </span>
          <span class="pi-hud-icons">
            <button type="button" class="pi-icon" data-role="new" aria-label="${esc(t('hud_new'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/></svg>
            </button>
            <button type="button" class="pi-icon" data-role="lb" aria-label="${esc(t('leaderboard'))}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/></svg>
            </button>
          </span>
        </div>
        <div class="pi-boardwrap"><div class="pi-board" data-role="board"
          role="group" aria-label="${esc(t('aria_board', { w: g.w, h: g.h }))}"></div></div>
        <div class="pi-foot" data-role="foot">
          <div class="pi-banner" data-role="banner"></div>
          <div class="pi-done" data-role="done" hidden>
            <p class="pi-done-title" data-role="donetitle"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="continue">${esc(t('continue'))}</button>
            <div class="pi-done-row">
              <button type="button" class="gh-btn gh-btn--block" data-act="replay">${esc(t('replay'))}</button>
              <button type="button" class="gh-btn gh-btn--block" data-act="leaderboard">${esc(t('leaderboard'))}</button>
            </div>
          </div>
        </div>
      </div>`;

    this.el = {
      board: this.root.querySelector('[data-role="board"]'),
      moves: this.root.querySelector('[data-role="moves"]'),
      banner: this.root.querySelector('[data-role="banner"]'),
      doneTitle: this.root.querySelector('[data-role="donetitle"]'),
      foot: this.root.querySelector('[data-role="foot"]'),
      done: this.root.querySelector('[data-role="done"]'),
    };
    // ONE delegated listener for all three completion buttons, so destroy() has one to remove -
    // the same reason the board itself has one listener rather than 70.
    this._onFootClick = (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'continue') { clearSave(); this.startGame(null); }
      else if (btn.dataset.act === 'replay') this._replay();
      else if (btn.dataset.act === 'leaderboard') this._openLeaderboard();
    };
    this.el.foot.addEventListener('click', this._onFootClick);
    this.root.querySelector('[data-role="back"]').addEventListener('click', () => this.renderSetup());
    this.root.querySelector('[data-role="new"]').addEventListener('click', () => {
      clearSave();
      this.startGame(null);
    });
    this.root.querySelector('[data-role="lb"]').addEventListener('click', () => this._openLeaderboard());

    // Dev hook, read-only. Pinball shipped four times on green headless tests while being
    // unplayable, because every fault lived in the DOM glue no headless test constructs. This is
    // how a browser session can see what the board actually is.
    try { window.__piTest = { ui: this, game: g }; } catch { /* no window */ }
    this._buildBoard();
    this._fit();
    // The hub mounts this container and lays it out in the same frame, so the first measure can
    // land before the host has a height. Measure again once layout has settled.
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    // Instant on mount: a restored board shows the water it already had, it does not replay it.
    this._paint(true);
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
      el.innerHTML = pipeSVG(mask, 'pi-art', 'dry') + pipeSVG(mask, 'pi-water', 'wet', i === g.src);
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
    // Solved is decided BEFORE the repaint, so _paint() draws the finished state in one pass. The
    // other order meant the winning turn painted the whole run wet and then a separate celebratory
    // replay wiped it and refilled from the inlet - a flash of white across a board the player had
    // just watched fill.
    const justSolved = g.checkSolved(Date.now());
    this._paint();
    writeSave(g);

    if (justSolved && !this.replaying) {
      try {
        // `r.level` is the TIER INDEX (1-4), not the board number on screen. It is what
        // `pi.bestLevel` / `pi.bestByTier` have always meant - "the hardest tier cleared" - and
        // passing the board number instead would quietly repurpose a stored field that My Stats and
        // the leaderboard already read (THE LAW rule 5). The board number is DERIVED from
        // `byDiff[tier].won`, which this same call increments.
        const r = g.result();
        recordPipes(r.level, r.moves, r.tier);
      } catch (err) { console.error('[pipes] recordPipes', err); }
    }
  }


  /** Repaint the live state: move count, which tiles are wet, which are leaking. */
  _paint(instant) {
    const g = this.game;
    this.el.moves.textContent = String(g.moves);
    const { reached, order, leaks } = g.flow();
    const leakSet = new Set(leaks);
    const solved = g.solvedAt !== null;
    // NO LEAK STYLING BEFORE THE FIRST TURN. A fresh board's inlet cap points at whatever the
    // scramble gave it, so `flow()` honestly reports a leak on move zero - and a puzzle that opens
    // by telling you off, in red, before you have touched anything reads as a fault rather than a
    // hint. Feedback starts the moment the player engages.
    const showLeaks = g.moves > 0 && !solved;
    for (let i = 0; i < this.cellEls.length; i++) {
      this.cellEls[i].classList.toggle('is-leak', showLeaks && leakSet.has(i));
    }
    const fillMs = this._flowWater(order, reached, instant);
    this._lastFillMs = fillMs;

    const leaking = showLeaks && leaks.length > 0;
    // On the winning turn the last stretch is still flowing, so the banner waits for the water to
    // arrive rather than announcing the win over a half-filled board.
    const banner = () => {
      // The headline rides WITH the buttons, in the floating panel, so the completion screen reads
      // in the reference's order - "Puzzle Solved!", then Continue, then Replay / Leaderboard.
      // Putting it in the in-flow banner instead left it stranded UNDER the buttons.
      this.el.banner.className = 'pi-banner' + (leaking && !solved ? ' is-leak' : '');
      this.el.banner.textContent = (leaking && !solved) ? t('leaking') : '';
      if (this.el.doneTitle) {
        this.el.doneTitle.innerHTML = solved
          ? `<b>${esc(t('solved_title'))}</b><span>${esc(t('solved_moves', { n: g.moves }))}</span>`
          : '';
      }
      // No re-fit: the panel is out of flow, so revealing it changes no box on the screen and the
      // board stays exactly where the player left it.
      if (this.el.done) this.el.done.hidden = !solved;
    };
    if (solved && fillMs > 0) {
      this.el.banner.className = 'pi-banner';
      this.el.banner.textContent = '';
      this.wetTimers.push(setTimeout(banner, fillMs + 120));
    } else banner();
  }

  /**
   * THE WATER, and it is the thing Matt asked to be treated as first-class:
   * *"Animations are what really impresses people playing the games."*
   *
   * **Water is drawn wherever it REACHES, always** - while the board is leaking included. It used
   * to be gated on `!leakSet.size`, so a single open end anywhere blanked the water on the WHOLE
   * board and an unsolved puzzle was a screen of white outlines with no blue in it at all. Matt,
   * looking at exactly that: *"I want it to be blue."* A leak is not a reason to hide the water;
   * it is a reason to show it arriving at the place it is spilling out of.
   *
   * It walks `flow().order` - the rules' own breadth-first order out of the inlet - so the render
   * layer never works the path out for itself and cannot disagree with the rules about where the
   * water goes. Only NEWLY reached tiles are sequenced: tiles already wet are left alone, so a turn
   * that extends the run looks like water creeping onward instead of the whole network blinking off
   * and refilling from the inlet. Water that no longer reaches a tile is removed at once - a
   * receding network is a mistake being undone, not something to celebrate in slow motion.
   *
   * Each tile is revealed with opacity + a small scale pop, both on the UX floor's allowed list.
   * A true directional fill along each pipe would want `stroke-dashoffset`, which is NOT on that
   * list; see pipes/CLAUDE.md for that trade.
   *
   * @returns {number} ms until the last newly-wet tile lands, so a caller can wait for it.
   */
  _flowWater(order, reached, instant) {
    this._stopWater();
    for (let i = 0; i < this.cellEls.length; i++) {
      if (!reached.has(i)) this.cellEls[i].classList.remove('is-wet');
    }
    const fresh = order.filter((i) => !this.cellEls[i].classList.contains('is-wet'));
    if (!fresh.length) return 0;
    // Reduced motion thins garnish, it does not freeze gameplay: the water still ARRIVES, it just
    // does not crawl (docs/BUILDING-A-GAME.md Part 0).
    let reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch { /* no matchMedia: animate */ }
    if (instant || reduced) {
      for (const i of fresh) this.cellEls[i].classList.add('is-wet');
      return 0;
    }
    fresh.forEach((i, k) => {
      this.wetTimers.push(setTimeout(() => this.cellEls[i].classList.add('is-wet'), k * WET_STEP_MS));
    });
    return fresh.length * WET_STEP_MS;
  }

  /**
   * REPLAY THE SAME BOARD. `generate()` is deterministic on (tier, seed), so rebuilding the game
   * with this board's own seed gives back the identical scramble.
   *
   * A REPLAYED SOLVE IS NOT RECORDED AGAIN. The board was credited the first time; counting it
   * twice would inflate the level, which is defined as "boards solved at this tier". Nothing is
   * lost by declining the duplicate - the original solve is already in the stats store, and this
   * only ever appears on a board that has just been recorded.
   */
  _replay() {
    const g = this.game;
    clearSave();
    this.replaying = true;
    this.game = new PipesGame({ tier: g.tier, seed: g.seed });
    this.renderPlay();
  }

  /** The hub's Leaderboards overlay, which is where this game's rows already live. Lazily imported
   *  exactly as js/hub.js does it, and it is `position: fixed` so it covers a mounted game the same
   *  way it covers the launcher. */
  _openLeaderboard() {
    import('../../js/leaderboard-ui.js')
      .then((m) => m.openLeaderboard())
      .catch((err) => console.error('[pipes] leaderboard', err));
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
  /**
   * THE FIELD RUNS TO THE BOTTOM OF THE SCREEN. The reference is one flat field filling the phone,
   * and ours was a panel ending partway down with the launcher's own (slightly different) grey
   * below it - which read as a card even after the border-radius and shadow came off. The host
   * container has no definite height, so this is measured rather than a CSS percentage, the same
   * way _fit() measures the board.
   */
  _fillHeight() {
    if (!this.root) return;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    // Allow for what the HOST puts BELOW us - the hub's .hub-main carries 40px of bottom padding,
    // and filling straight to the viewport bottom pushed the page 40px taller than the screen
    // (test-visual's fit probe caught exactly that). Read from the container chain's padding, which
    // is a fixed fact about the layout: measuring the document instead is circular, because
    // collapsing this element to measure it also changes the document's height.
    let below = 0;
    for (let el = this.root.parentElement; el; el = el.parentElement) {
      below += parseFloat(getComputedStyle(el).paddingBottom) || 0;
      if (el === document.body) break;
    }
    const top = this.root.getBoundingClientRect().top;
    this.root.style.minHeight = Math.max(320, Math.round(vh - top - below)) + 'px';
  }

  _fit() {
    this._fillHeight();
    if (this.screen !== 'play' || !this.el || !this.el.board) return;
    const wrap = this.el.board.parentElement;
    const r = wrap.getBoundingClientRect();
    if (r.width < 2) return;
    const g = this.game;
    // THESE MUST MATCH .pi-board IN THE CSS, and since the board lost its frame and gaps to match
    // the reference art (see art.js), both are now zero. They were 4 and 14 against a sheet that
    // said 2 and 6, which quietly shaved every cell: this arithmetic has to describe the box that
    // actually gets laid out, not an approximation of it.
    const GAP = 0, PAD = 0;

    // visualViewport is the honest height on mobile while the URL bar is animating.
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    // THE WHOLE FOOTER, not just the banner. The completion actions live in that box and appear
    // when the board is solved, so measuring only the banner would let them overlap the board the
    // moment they showed up. _fit() re-runs when they appear and the board makes room for them.
    const below = (this.el.foot ? this.el.foot.getBoundingClientRect().height : 44) + 16;
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
    if (this.el && this.el.foot && this._onFootClick) this.el.foot.removeEventListener('click', this._onFootClick);
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
