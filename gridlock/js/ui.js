// gridlock/js/ui.js - the setup and play screens, the board, dragging, undo / restart / hint, the win
// popup, autosave and the module contract. The puzzle itself (what a legal slide is, the solver)
// lives in engine.js and the levels in levels.js; nothing here decides anything about the puzzle.
//
// GRIDLOCK (gridlock/CLAUDE.md): the sliding-block "traffic jam" puzzle (Unblock Me, Rush Hour).
// Two looks of the SAME game, chosen on the setup screen and remembered per phone: WOOD (blocks on
// a wooden board, the default) and CARS (cars and trucks in a parking lot). Levels, stars and
// points are identical in both.
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md).
// isInProgress() RETURNS FALSE, DELIBERATELY: the level is written to `gamehub.gridlock.save.v2`
// after every move, so leaving is lossless.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the standalone page themes too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { recordGridlock, recordGridlockHint, loadStats } from '../../js/game-stats.js';
import { GL_TIERS, GL_BAND_START, glBandOf, glBandEnd, glStars, glLevels, glHints, glCrowned, glPointsFor, glPoints, glLevelPoints, glHintedPoints } from '../../js/gridlock-points.js';
import { V1_TO_V2 } from '../../js/gridlock-v1map.js';
import { N, EXIT_ROW, SOLVED_POS, parse, positions, range, solve, isSolved, cellOf } from './engine.js';
import { LEVELS } from './levels.js';
import { pieceArt, RED, WOOD_TONES, CAR_COLORS } from './art.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.gridlock.v1';     // { look, band } (+ the first build's `next`, kept as stored, unread)
// Progress, one attempt per difficulty: { <band>: { v, n, hist: [[piece, from, to]], hints } | null }.
// `.v2` holds LADDER 2 level numbers (2026-10-14). The first build's `.v1` key held ladder 1 numbers;
// it is read ONCE (an attempt in progress is carried across as the same board, js/gridlock-v1map.js)
// and never written again (THE LAW rule 5).
const OLD_SAVE_KEY = 'gamehub.gridlock.save.v1';
const SAVE_KEY = 'gamehub.gridlock.save.v2';
// The test seam (window.__glTest: the solution and a move function) exists only on a dev server:
// on the live site it would let anyone solve every level from the browser console (Matt, 2026-10-14).
const DEV_HOST = (() => { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch { return false; } })();
const SAVE_V = 1;
const TOTAL = LEVELS.length;
const TIER_NUM = { easy: 1, medium: 2, hard: 3, expert: 4 };
const LOOKS = ['wood', 'cars'];
const PAGE = 25;                                 // levels per page of the level list (5 x 5)

/** Ladder level n (1-based): its board string and fewest moves. */
function levelAt(n) {
  const line = LEVELS[n - 1];
  if (!line) return null;
  const [board, d] = line.split(' ');
  return { board, fewest: +d };
}
const bandEnd = (band) => glBandEnd(band, TOTAL);

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// --- persistence ---------------------------------------------------------------------------------

function readJSON(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeJSON(key, v, what) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (err) { console.error(`[gridlock] ${what} NOT saved`, err); return false; }
}

/** The levels this player has cleared (this device's store), as { n: {m, s, c, t} } on ladder 2. */
function clearedLevels() {
  try { return glLevels(loadStats().games.gridlock); } catch { return {}; }
}
/** When a hint was first used on each level (this device's store): { n: ms }. */
function hintTimes() {
  try { return glHints(loadStats().games.gridlock); } catch { return {}; }
}

/** Settings: { look, band }. The next level of each band is not stored: it is the LOWEST level of
 *  that band not yet cleared (a band is played in order, so for a player who cleared 1..k it is
 *  k + 1; a level carried over from ladder 1 can be cleared further on, and stays playable). The
 *  first build stored ladder 1 numbers in `next`; that field is written back exactly as stored and
 *  never read (THE LAW rule 5). */
function loadSettings() {
  const v = readJSON(SETTINGS_KEY);
  const cleared = clearedLevels();
  const next = {};
  for (const k of GL_TIERS) {
    let n = GL_BAND_START[k];
    const end = bandEnd(k);
    while (n <= end && cleared[n]) n++;
    next[k] = n;
  }
  return {
    look: LOOKS.includes(v.look) ? v.look : 'wood',
    band: GL_TIERS.includes(v.band) ? v.band : 'easy',
    next,
  };
}
function saveSettings(patch = {}) {
  const raw = readJSON(SETTINGS_KEY), cur = loadSettings();
  writeJSON(SETTINGS_KEY, { ...raw, look: patch.look || cur.look, band: patch.band || cur.band }, 'settings');
  return loadSettings();
}

/** The saves, carrying the first build's attempts (ladder 1 numbers) across ONCE, as the same
 *  boards on ladder 2, into the band each now belongs to. The old key is never written. */
function loadSaves() {
  const all = readJSON(SAVE_KEY);
  if (all.migrated) return all;
  const old = readJSON(OLD_SAVE_KEY);
  for (const band of GL_TIERS) {
    const sv = old[band];
    const n2 = sv && V1_TO_V2[Math.floor(Number(sv.n)) - 1];
    if (!n2) continue;
    const b2 = glBandOf(n2);
    if (!all[b2]) all[b2] = { ...sv, n: n2 };
  }
  all.migrated = 1;
  writeJSON(SAVE_KEY, all, 'level progress');
  return all;
}

/** The saved attempt for a band's level n, re-played from the start so it is trusted only when every
 *  move in it is legal on that board. Anything else starts the level fresh. */
function readSave(band, n, pz) {
  const s = loadSaves()[band];
  if (!s || s.v !== SAVE_V || s.n !== n || !Array.isArray(s.hist)) return null;
  const pos = positions(pz);
  const hist = [];
  for (const m of s.hist) {
    if (!Array.isArray(m) || m.length !== 3) return null;
    const [i, from, to] = m.map((x) => Math.floor(Number(x)));
    if (!(i >= 0 && i < pos.length) || pos[i] !== from || from === to) return null;
    const r = range(pz, pos, i);
    if (to < r.lo || to > r.hi) return null;
    pos[i] = to;
    hist.push([i, from, to]);
  }
  return { pos, hist, hints: Math.max(0, Math.floor(Number(s.hints) || 0)) };
}
function writeSave(band, data) {
  const all = loadSaves();
  all[band] = data;
  writeJSON(SAVE_KEY, all, 'level progress');
}
function hasProgress(band, n) {
  const s = loadSaves()[band];
  return !!(s && s.v === SAVE_V && s.n === n && Array.isArray(s.hist) && s.hist.length);
}

// --- drawings ------------------------------------------------------------------------------------

const SVGA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_BACK = `<svg ${SVGA}><path d="M15 5l-7 7l7 7"/></svg>`;
const ICON_UNDO = `<svg ${SVGA}><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`;
const ICON_RESTART = `<svg ${SVGA}><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M4 4v4.5h4.5"/></svg>`;
const ICON_BULB = `<svg ${SVGA}><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>`;

function star(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}

/** The how-to-play picture: a small board, a block that slides up and down, red heading out. */
const HOW_SVG = `<svg viewBox="0 0 220 150" aria-hidden="true">
  <rect x="34" y="6" width="138" height="138" rx="12" class="gl-how-frame"/>
  <rect x="44" y="16" width="118" height="118" rx="4" class="gl-how-bed"/>
  <rect x="160" y="57" width="16" height="16" class="gl-how-bed"/>
  <rect x="47" y="58" width="36" height="16" rx="4" fill="${RED}"/>
  <circle cx="65" cy="66" r="6" fill="#fff"/><path d="M61.5 66h6M65.5 63l3 3-3 3" stroke="${RED}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="107" y="38" width="16" height="36" rx="4" class="gl-how-block"/>
  <path d="M115 30v-8M111 26l4-4 4 4M115 82v8M111 86l4 4 4-4" class="gl-how-move"/>
  <rect x="47" y="98" width="36" height="16" rx="4" class="gl-how-block"/>
  <path d="M140 66h40M174 60l7 6-7 6" class="gl-how-way"/>
</svg>`;

// --- the game ------------------------------------------------------------------------------------

class Gridlock {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.screen = 'home';
    this.timers = [];
    this.drag = null;
  }

  mount() {
    this.container.innerHTML = '<div class="gl-root"></div>';
    this.root = this.container.querySelector('.gl-root');
    this._onClick = (ev) => this._handleClick(ev);
    this._onKey = (ev) => this._handleKey(ev);
    this._onDown = (ev) => this._pointerDown(ev);
    this._onMove = (ev) => this._pointerMove(ev);
    this._onUp = (ev) => this._pointerUp(ev);
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('pointermove', this._onMove);
    this.root.addEventListener('pointerup', this._onUp);
    this.root.addEventListener('pointercancel', this._onUp);
    document.addEventListener('keydown', this._onKey);
    this.offResize = onViewportResize(() => { this._positionRoot(); this._layout(); });
    this.offLang = onLangChange(() => this.render());
    this.render();
  }

  destroy() {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    document.removeEventListener('keydown', this._onKey);
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('pointerdown', this._onDown);
      this.root.removeEventListener('pointermove', this._onMove);
      this.root.removeEventListener('pointerup', this._onUp);
      this.root.removeEventListener('pointercancel', this._onUp);
    }
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.offResize) this.offResize();
    if (this.offLang) this.offLang();
    try { delete window.__glTest; } catch { /* no window */ }
    this.container.innerHTML = '';
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers = this.timers.filter((x) => x !== id); fn(); }, ms);
    this.timers.push(id);
  }
  _clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
  }

  /** Arrow Maze's / Murdoku's technique: a fixed root measured against the mount point; in the
   *  hub's immersive mode it runs edge to edge and the top bar shares the floating back button's row.
   *  The BOTTOM is `bottom: 0`, never a height measured from the viewport: an iPhone can report a
   *  short visualViewport mid-transition and nothing re-measures it (Arrow Maze, 2026-10-14: the
   *  setup screen was cut off half way down). */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    this.root.style.bottom = '0px';
    this.root.style.height = 'auto';
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      this.root.classList.add('is-immersive');
      this.root.style.left = '0px';
      this.root.style.width = (document.documentElement.clientWidth || window.innerWidth || 0) + 'px';
      this.root.style.top = '0px';
      this.root.style.setProperty('--gl-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--gl-inset', Math.max(0, Math.round(b.right + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.max(0, Math.round(r.top)) + 'px';
  }

  // --- rendering ----------------------------------------------------------------------------------

  render() {
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    // A re-render (a language change) mid-drag replaces the block being dragged: drop the drag, or
    // `this.drag` would stay set with no pointerup ever coming, and no block could be moved again.
    this.drag = null;
    const modal = '<div class="gh-overlay gl-modal" hidden></div>';
    const body = this.screen === 'play' ? this._playHTML() : this.screen === 'levels' ? this._levelsHTML() : this._homeHTML();
    this.root.innerHTML = body + modal;
    this.root.classList.toggle('is-home', this.screen !== 'play');
    this.root.classList.toggle('is-levels', this.screen === 'levels');
    for (const k of LOOKS) this.root.classList.toggle('gl-look-' + k, this.settings.look === k);
    this._positionRoot();
    if (this.screen === 'play') {
      this._buildBoard();
      this.ro = new ResizeObserver(() => this._layout());
      this.ro.observe(this.root.querySelector('.gl-stage'));
      this._layout();
      this._paintHud();
      this._installTestSeam();
      if (this.won && this.winShown) this._showWin();
    } else {
      try { delete window.__glTest; } catch { /* no window */ }
    }
  }

  /** The setup screen. AS FEW WORDS AS POSSIBLE (Matt, 2026-10-14: "There are WAY too many words.
   *  This is the same comment you force me to make 10 times per day."): the title, the points, the two
   *  looks, the four difficulties (shape + name), Play, Levels and How to play. No tagline, no field
   *  labels, no level ranges, no "worth N points" line. */
  _homeHTML() {
    const s = this.settings;
    const band = s.band, n = s.next[band];
    const done = n > bandEnd(band);
    const resume = !done && hasProgress(band, n);
    let pts = 0;
    try { pts = glPoints(loadStats().games.gridlock); } catch { pts = 0; }
    const segs = GL_TIERS.map((k) => `
      <button type="button" class="gl-seg${k === band ? ' is-selected' : ''}" data-act="band" data-band="${k}" role="radio" aria-checked="${k === band}">
        <span class="gl-seg-top">${diffShapeSVG(TIER_NUM[k])}<b>${t('tier_' + k)}</b></span>
      </button>`).join('');
    const looks = LOOKS.map((k) => `
      <button type="button" class="gl-look${k === s.look ? ' is-selected' : ''}" data-act="look" data-look="${k}" role="radio" aria-checked="${k === s.look}">
        ${lookThumb(k)}<b>${t('look_' + k)}</b>${k === s.look ? '<span class="gl-check" aria-hidden="true">&#10003;</span>' : ''}
      </button>`).join('');
    const play = done
      ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" disabled>${band === 'expert' ? t('all_done') : t('band_done_play', { name: t('tier_' + band) })}</button>`
      : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play">${t(resume ? 'continue_level' : 'play_level', { n })}</button>`;
    return `
      <div class="gl-home">
        <div class="gl-head">
          <h1>${t('title')}</h1>
          <p class="gl-pts"><b>${pts}</b> ${t('pts_word')}</p>
        </div>
        <div class="gh-card gl-menu-card">
          <div class="gl-looks" role="radiogroup" aria-label="${t('look_label')}">${looks}</div>
          <div class="gl-segs" role="radiogroup" aria-label="${t('diff_label')}">${segs}</div>
          ${play}
        </div>
        <div class="gl-home-foot">
          <button type="button" class="gh-btn gh-btn--ghost" data-act="levels">${t('levels_btn')}</button>
          <button type="button" class="gh-btn gh-btn--ghost" data-act="help">${t('how_title')}</button>
        </div>
      </div>`;
  }

  /** The level list for the selected difficulty, PAGE levels a page (pages, never a scroll): every
   *  level cleared shows its best stars and its crown; the next one is open; the rest are locked,
   *  because a difficulty's levels are played in order. Picking a cleared level replays it. */
  _levelsHTML() {
    const band = this.settings.band, next = this.settings.next[band];
    const first = GL_BAND_START[band], last = bandEnd(band);
    const pages = Math.max(1, Math.ceil((last - first + 1) / PAGE));
    this.page = Math.max(0, Math.min(pages - 1, this.page | 0));
    const a = first + this.page * PAGE, z = Math.min(last, a + PAGE - 1);
    const cleared = clearedLevels(), hints = hintTimes();
    let tiles = '';
    for (let n = a; n <= z; n++) {
      const e = cleared[n];
      const open = n <= next || !!e;
      const stars = e ? [0, 1, 2].map((k) => `<i class="${k < e.s ? 'is-on' : ''}"></i>`).join('') : '';
      const label = !open ? t('level_locked_aria', { n }) : e ? t('level_tile_aria', { n, s: e.s }) : t('level_n', { n });
      tiles += `<button type="button" class="gl-tile${e ? ' is-done' : ''}${n === next ? ' is-next' : ''}" data-act="pick" data-n="${n}" ${open ? '' : 'disabled'} aria-label="${label}">
        <b>${n}</b>${open ? `<span class="gl-tile-stars" aria-hidden="true">${stars}</span>` : '<span class="gl-lock" aria-hidden="true"></span>'}${glCrowned(e, hints[n]) ? '<span class="gl-tile-crown" aria-hidden="true">&#128081;</span>' : ''}
      </button>`;
    }
    return `
      <div class="gl-levels">
        <div class="gl-lv-head">
          <div class="gl-lv-title">${diffShapeSVG(TIER_NUM[band])}<b>${t('tier_' + band)}</b><span>${t('band_range', { a, b: z })}</span></div>
        </div>
        <div class="gl-grid">${tiles}</div>
        <div class="gl-pager">
          <button type="button" class="gh-btn" data-act="page" data-step="-10" ${this.page === 0 ? 'disabled' : ''} aria-label="${t('page_back10')}">&laquo;</button>
          <button type="button" class="gh-btn" data-act="page" data-step="-1" ${this.page === 0 ? 'disabled' : ''} aria-label="${t('page_prev')}">&lsaquo;</button>
          <span>${t('page_of', { p: this.page + 1, n: pages })}</span>
          <button type="button" class="gh-btn" data-act="page" data-step="1" ${this.page >= pages - 1 ? 'disabled' : ''} aria-label="${t('page_next')}">&rsaquo;</button>
          <button type="button" class="gh-btn" data-act="page" data-step="10" ${this.page >= pages - 1 ? 'disabled' : ''} aria-label="${t('page_fwd10')}">&raquo;</button>
        </div>
        <button type="button" class="gh-btn gh-btn--block gl-lv-back" data-act="home">${ICON_BACK}<span>${t('back_setup')}</span></button>
      </div>`;
  }

  _playHTML() {
    return `
      <div class="gl-game">
        <div class="gl-hud">
          <div class="gl-hud-mid">${diffShapeSVG(TIER_NUM[this.band])}<b>${t('level_n', { n: this.n })}</b><span>${t('tier_' + this.band)}</span></div>
        </div>
        <div class="gl-strip">
          <button type="button" class="gl-back" data-act="menu" aria-label="${t('menu_aria')}">${ICON_BACK}</button>
          <div class="gl-chip"><small>${t('moves')}</small><b class="gl-moves">0</b></div>
          <div class="gl-chip"><small>${t('fewest')}</small><b>${this.fewest}</b></div>
        </div>
        <div class="gl-stage"><div class="gl-board" role="group"></div></div>
        <div class="gl-tools">
          <button type="button" class="gl-tool" data-act="undo">${ICON_UNDO}<span>${t('undo')}</span></button>
          <button type="button" class="gl-tool" data-act="restart">${ICON_RESTART}<span>${t('restart')}</span></button>
          <button type="button" class="gl-tool gl-tool-hint" data-act="hint">${ICON_BULB}<span>${t('hint')}</span></button>
        </div>
      </div>`;
  }

  // --- home ---------------------------------------------------------------------------------------

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !this.root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'band') {
      if (btn.dataset.band !== this.settings.band) { this.settings = saveSettings({ band: btn.dataset.band }); this.render(); }
    } else if (act === 'look') {
      if (btn.dataset.look !== this.settings.look) { this.settings = saveSettings({ look: btn.dataset.look }); this.render(); }
    } else if (act === 'play') {
      const k = this.settings.band, n = this.settings.next[k];
      if (n <= bandEnd(k)) this._startLevel(k, n);
    } else if (act === 'help') this._openHelp();
    else if (act === 'levels') { this.screen = 'levels'; this.page = Math.floor((Math.min(this.settings.next[this.settings.band], bandEnd(this.settings.band)) - GL_BAND_START[this.settings.band]) / PAGE); this.render(); }
    else if (act === 'page') { this.page += +btn.dataset.step; this.render(); }
    else if (act === 'pick') { const n = +btn.dataset.n, b = this.settings.band; if (n >= GL_BAND_START[b] && n <= bandEnd(b) && (n <= this.settings.next[b] || clearedLevels()[n])) this._startLevel(b, n); }
    else if (act === 'home') { this.screen = 'home'; this.render(); }
    else if (act === 'menu') this._toSetup();
    else if (act === 'undo') this._undo();
    else if (act === 'restart') this._restart();
    else if (act === 'hint') this._hint();
    else if (act === 'close') this._closeModal();
    else if (act === 'win-close') this._toSetup();
    else if (act === 'next') this._next();
    else if (act === 'again') { this._closeModal(); this._startLevel(this.band, this.n, true); }
  }

  _handleKey(ev) {
    if (!this.root) return;
    const m = this.root.querySelector('.gl-modal');
    if (m && !m.hidden) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (m.querySelector('[data-act="win-close"]')) this._toSetup(); else this._closeModal();
      }
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!step) return;
    const radio = ev.target && ev.target.closest && ev.target.closest('.gl-seg, .gl-look');
    if (radio && this.root.contains(radio)) {
      ev.preventDefault();
      if (radio.classList.contains('gl-seg')) {
        const k = GL_TIERS[(GL_TIERS.indexOf(this.settings.band) + step + GL_TIERS.length) % GL_TIERS.length];
        this.settings = saveSettings({ band: k });
        this.render();
        const now = this.root.querySelector(`.gl-seg[data-band="${k}"]`);
        if (now) now.focus();
      } else {
        const k = LOOKS[(LOOKS.indexOf(this.settings.look) + step + LOOKS.length) % LOOKS.length];
        this.settings = saveSettings({ look: k });
        this.render();
        const now = this.root.querySelector(`.gl-look[data-look="${k}"]`);
        if (now) now.focus();
      }
      return;
    }
    // Keyboard play: a focused block moves one cell along its own line per key.
    const el = ev.target && ev.target.closest && ev.target.closest('.gl-piece');
    if (this.screen === 'play' && el && this.root.contains(el) && !this.won) {
      const i = +el.dataset.i, p = this.pz.pieces[i];
      const along = p.h ? (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') : (ev.key === 'ArrowUp' || ev.key === 'ArrowDown');
      if (!along) return;
      ev.preventDefault();
      const r = range(this.pz, this.pos, i);
      const q = this.pos[i] + step;
      if (q < r.lo || q > r.hi) return;
      // Repeated keys on the same block are ONE slide, the way a drag is.
      const last = this.hist[this.hist.length - 1];
      if (last && last[0] === i && this.kbLast === i) {
        this.pos[i] = q;
        if (q === last[1]) this.hist.pop(); else last[2] = q;
        this._afterMove(i);
      } else {
        this._commit(i, q);
      }
      this.kbLast = i;
    }
  }

  _openHelp() {
    const m = this.root.querySelector('.gl-modal');
    m.innerHTML = `
      <div class="gh-modal gl-dialog" role="dialog" aria-modal="true" aria-labelledby="gl-how-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="gl-how-h">${t('how_title')}</h2>
        <p class="gl-how-goal">${t('how_goal')}</p>
        <div class="gl-how-pic">${HOW_SVG}</div>
        <p class="gl-how-txt">${t('how_rule')}</p>
        <p class="gl-how-ex">${t('how_example')}</p>
        <p class="gl-how-txt">${t('how_stars')}</p>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="close">${t('got_it')}</button>
      </div>`;
    this._openModal();
  }
  _openModal() {
    const m = this.root.querySelector('.gl-modal');
    if (m.hidden) this._opener = document.activeElement;
    m.hidden = false;
    const go = m.querySelector('.gh-btn--primary');
    if (go) go.focus({ preventScroll: true });
  }
  _closeModal() {
    const m = this.root.querySelector('.gl-modal');
    if (!m) return;
    m.hidden = true;
    m.innerHTML = '';
    const back = this._opener;
    this._opener = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  _toSetup() {
    this._clearTimers();
    this.drag = null;
    this.screen = 'home';
    this.won = false;
    this.winShown = false;
    this.settings = loadSettings();
    this.render();
  }

  // --- a level ------------------------------------------------------------------------------------

  /** Ladder level n of `band`. `fresh` ignores (and clears) the saved attempt: Play again. */
  _startLevel(band, n, fresh = false) {
    const lvl = levelAt(n);
    if (!lvl) return;
    this._clearTimers();
    this.band = band;
    this.n = n;
    this.fewest = lvl.fewest;
    this.pz = parse(lvl.board);
    this.start = positions(this.pz);
    const saved = fresh ? null : readSave(band, n, this.pz);
    this.pos = saved ? saved.pos : this.start.slice();
    this.hist = saved ? saved.hist : [];
    this.hints = saved ? saved.hints : 0;
    this.hintMove = null;
    this.hintKey = '';
    this.kbLast = -1;
    this.won = false;
    this.winShown = false;
    this.drag = null;
    this.prevBest = clearedLevels()[n] || null;
    this.prevHint = hintTimes()[n];
    this.settings = saveSettings({ band });
    this.screen = 'play';
    this._save();
    this.render();
    // A save whose last move already reached the exit is a win that was never counted (the app was
    // closed during the slide out): count it now rather than show a finished board.
    if (isSolved(this.pos)) this._win();
  }

  _save() {
    if (this.won) return;
    writeSave(this.band, { v: SAVE_V, n: this.n, hist: this.hist, hints: this.hints });
  }

  _restart() {
    if (!this.pz || this.won || !this.hist.length) return;
    this.pos = this.start.slice();
    this.hist = [];
    this.kbLast = -1;
    this._clearHint();
    this._save();
    this._placeAll(true);
    this._paintHud();
  }

  _undo() {
    if (!this.pz || this.won || !this.hist.length) return;
    const [i, from] = this.hist.pop();
    this.pos[i] = from;
    this.kbLast = -1;
    this._clearHint();
    this._save();
    this._place(i, true);
    this._paintHud();
  }

  _hint() {
    if (!this.pz || this.won) return;
    const key = this.pos.join(',');
    if (this.hintMove && this.hintKey === key) return;      // already showing for this position: no charge
    const path = solve(this.pz, this.pos);
    if (!path || !path.length) return;
    this.hintMove = path[0];
    this.hintKey = key;
    this.hints += 1;
    // Remembered per LEVEL in the stats store (and synced), not just in this attempt: leaving the
    // level and coming back must not forget it (Matt, 2026-10-14). From now on this level earns half
    // its points and no crown, unless it was already solved with no hint.
    recordGridlockHint(this.n);
    this._save();
    this._paintHint();
    this._paintHud();
  }
  _clearHint() {
    this.hintMove = null;
    this.hintKey = '';
    this._paintHint();
  }

  /** A slide of piece i to q (one move). */
  _commit(i, q) {
    if (q === this.pos[i]) return;
    this.hist.push([i, this.pos[i], q]);
    this.pos[i] = q;
    this._afterMove(i);
  }
  _afterMove(i) {
    this._clearHint();
    this._save();
    this._place(i, true);
    this._paintHud();
    if (isSolved(this.pos)) this._win();
  }

  _win() {
    if (this.won) return;
    this.won = true;
    this.kbLast = -1;
    const moves = this.hist.length;
    const stars = glStars(moves, this.fewest);
    // Record first, then everything else: the solve must be counted even if the app closes now.
    const prevPts = this.prevBest ? glPointsFor(this.n, this.prevBest, this.prevHint) : 0;
    const res = recordGridlock(this.band, { level: this.n, moves, stars, hints: this.hints });
    if (!res) console.warn('[gridlock] the solve was not recorded (rate gate)');
    writeSave(this.band, null);
    this.settings = loadSettings();
    const now = clearedLevels()[this.n], hintAt = hintTimes()[this.n];
    const crown = glCrowned(now, hintAt);
    const gained = now ? glPointsFor(this.n, now, hintAt) - prevPts : 0;
    this.result = { moves, stars, crown, hinted: this.hints > 0 || hintAt > 0 || this.prevHint > 0, gained, first: !this.prevBest, better: !!(this.prevBest && (moves < this.prevBest.m || stars > this.prevBest.s)) };
    // The red block leaves through the exit, then the popup.
    this._place(0, false);
    this._paintHud();
    this._later(() => { this.winShown = true; this._showWin(); }, reduceMotion() ? 120 : 520);
  }

  _showWin() {
    const r = this.result || { moves: this.hist.length, stars: 1, crown: false, first: false };
    const starRow = [0, 1, 2].map((k) => `<svg viewBox="0 0 46 46" class="gl-star${k < r.stars ? ' is-on' : ''}" aria-hidden="true"><path d="${star(23, 24, 20)}"/></svg>`).join('');
    const end = this.n >= bandEnd(this.band) && this.settings.next[this.band] > bandEnd(this.band);
    const third = r.gained > 0
      ? `<div><small>${t('points')}</small><b>+${r.gained}</b></div>`
      : `<div><small>${r.better ? t('new_best') : t('your_best')}</small><b>${r.better || !this.prevBest || !this.prevBest.m ? r.moves : this.prevBest.m}</b></div>`;
    const m = this.root.querySelector('.gl-modal');
    m.innerHTML = `
      <div class="gh-modal gl-dialog gl-win" role="dialog" aria-modal="true" aria-labelledby="gl-win-h">
        <button type="button" class="gh-modal__close" data-act="win-close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="gl-win-h">${t('cleared', { n: this.n })}</h2>
        <div class="gl-stars" role="img" aria-label="${t('stars_aria', { n: r.stars })}">${starRow}</div>
        ${r.crown ? `<div class="gl-crown"><span aria-hidden="true">&#128081;</span>${t('no_hints')}</div>` : r.hinted ? `<p class="gl-hint-note">${t(glHintedPoints(this.n) < glLevelPoints(this.n) ? 'hint_half' : 'hint_crown')}</p>` : ''}
        ${end ? `<p class="gl-how-txt">${this.band === 'expert' ? t('all_done') : t('band_finished', { name: t('tier_' + this.band) })}</p>` : ''}
        <div class="gl-nums">
          <div><small>${t('moves')}</small><b>${r.moves}</b></div>
          <div><small>${t('fewest')}</small><b>${this.fewest}</b></div>
          ${third}
        </div>
        ${end
          ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="win-close">${t('back_levels')}</button>`
          : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="next">${t('next_level')}</button>`}
        <button type="button" class="gh-btn gh-btn--block" data-act="again">${t('play_again')}</button>
      </div>`;
    this._openModal();
  }

  /** The level after this one, if it is open (cleared, or the band's next); otherwise the band's
   *  next level. Replaying a cleared level that sits past the next one (a ladder 1 level carried
   *  over) must not open the locked level after it: a band is played in order. */
  _next() {
    this._closeModal();
    const end = bandEnd(this.band), next = this.settings.next[this.band];
    let n = this.n + 1;
    if (!(n <= next || clearedLevels()[n])) n = next;
    if (n > end) { this._toSetup(); return; }
    this._startLevel(this.band, n);
  }

  // --- the board ----------------------------------------------------------------------------------

  _buildBoard() {
    const board = this.root.querySelector('.gl-board');
    const look = this.settings.look;
    let html = '<div class="gl-frame"></div><div class="gl-bed"></div><div class="gl-exit" aria-hidden="true"></div>';
    for (let k = 0; k < N * N; k++) html += `<div class="gl-cell" data-c="${k}"></div>`;
    for (const w of this.pz.walls) html += `<div class="gl-wall" data-w="${w}" aria-hidden="true"></div>`;
    html += '<div class="gl-ghost" hidden></div>';
    let k = 0;
    this.pz.pieces.forEach((p, i) => {
      const red = i === 0;
      const pal = look === 'cars' ? CAR_COLORS : WOOD_TONES;
      const color = red ? RED : pal[(k++ + this.n * 3) % pal.length];
      const what = red ? t('piece_red') : t('piece_other');
      html += `<div class="gl-piece${red ? ' is-red' : ''}${p.h ? ' is-h' : ' is-v'}" data-i="${i}" tabindex="0" role="button"
        aria-label="${t('piece_aria', { what, dir: t(p.h ? 'dir_h' : 'dir_v') })}" style="--gl-c:${color}">
        ${pieceArt(p, look, color, red, this.n * 97 + i * 13, `glp${i}`)}
      </div>`;
    });
    board.innerHTML = html;
  }

  /** Size the board to the room it has (measured, never guessed) and place everything. */
  _layout() {
    if (this.screen !== 'play' || !this.root) return;
    const stage = this.root.querySelector('.gl-stage');
    const board = this.root.querySelector('.gl-board');
    if (!stage || !board) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    // Board = 6 cells + a frame of 0.34 cell each side; the exit sticks out 0.5 cell on the right,
    // matched on the left so the board stays centred.
    const cell = Math.max(24, Math.floor(Math.min((w - 12) / 7.68, (h - 8) / 6.68, 76)));
    // A resize or rotation mid-drag changes the cell size under the finger: end the drag where the
    // block started (no move) rather than snap it by the old size.
    if (this.drag && cell !== this.cell) {
      const d = this.drag;
      this.drag = null;
      d.el.classList.remove('is-drag');
      try { d.el.releasePointerCapture(d.id); } catch { /* fine */ }
    }
    const frame = Math.round(cell * 0.34);
    this.cell = cell;
    this.frame = frame;
    board.style.setProperty('--gl-cell', cell + 'px');
    board.style.setProperty('--gl-frame', frame + 'px');
    board.style.width = (cell * N + frame * 2) + 'px';
    board.style.height = (cell * N + frame * 2) + 'px';
    const exit = board.querySelector('.gl-exit');
    exit.style.top = (frame + EXIT_ROW * cell) + 'px';
    for (const el of board.querySelectorAll('.gl-cell')) {
      const c = +el.dataset.c;
      el.style.transform = `translate(${frame + (c % N) * cell}px, ${frame + ((c / N) | 0) * cell}px)`;
    }
    for (const el of board.querySelectorAll('.gl-wall')) {
      const c = +el.dataset.w;
      el.style.transform = `translate(${frame + (c % N) * cell}px, ${frame + ((c / N) | 0) * cell}px)`;
    }
    this._placeAll(false);
    this._paintHint();
  }

  _xyOf(i, pos) {
    const p = this.pz.pieces[i];
    const c = cellOf(p, pos, 0);
    return { x: this.frame + (c % N) * this.cell, y: this.frame + ((c / N) | 0) * this.cell };
  }
  _place(i, animate) {
    const el = this.root && this.root.querySelector(`.gl-piece[data-i="${i}"]`);
    if (!el || !this.cell) return;
    const p = this.pz.pieces[i];
    el.style.width = (p.h ? p.len * this.cell : this.cell) + 'px';
    el.style.height = (p.h ? this.cell : p.len * this.cell) + 'px';
    el.classList.toggle('is-anim', !!animate && !reduceMotion());
    let { x, y } = this._xyOf(i, this.pos[i]);
    // Solved: the red block carries on out through the exit and fades.
    if (this.won && i === 0) { x += 2 * this.cell + this.frame; el.classList.add('is-out'); el.style.opacity = '0'; }
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  _placeAll(animate) {
    if (!this.pz) return;
    for (let i = 0; i < this.pz.pieces.length; i++) this._place(i, animate);
  }

  _paintHint() {
    if (!this.root) return;
    for (const el of this.root.querySelectorAll('.gl-piece.is-hint')) el.classList.remove('is-hint');
    const ghost = this.root.querySelector('.gl-ghost');
    if (!ghost) return;
    if (!this.hintMove || !this.cell) { ghost.hidden = true; return; }
    const [i, q] = this.hintMove;
    const el = this.root.querySelector(`.gl-piece[data-i="${i}"]`);
    if (el) el.classList.add('is-hint');
    const p = this.pz.pieces[i];
    const { x, y } = this._xyOf(i, q);
    ghost.style.width = (p.h ? p.len * this.cell : this.cell) + 'px';
    ghost.style.height = (p.h ? this.cell : p.len * this.cell) + 'px';
    ghost.style.transform = `translate(${x}px, ${y}px)`;
    ghost.hidden = false;
  }

  _paintHud() {
    if (!this.root || this.screen !== 'play') return;
    const mv = this.root.querySelector('.gl-moves');
    if (mv) mv.textContent = String(this.hist.length);
    const board = this.root.querySelector('.gl-board');
    if (board) board.setAttribute('aria-label', t('board_aria', { n: this.n, m: this.hist.length }));
    const busy = this.won;
    const undo = this.root.querySelector('[data-act="undo"]');
    const rs = this.root.querySelector('[data-act="restart"]');
    const hint = this.root.querySelector('[data-act="hint"]');
    if (undo) undo.disabled = busy || !this.hist.length;
    if (rs) rs.disabled = busy || !this.hist.length;
    if (hint) { hint.disabled = busy; hint.classList.toggle('is-on', !!this.hintMove); }
  }

  // --- dragging -------------------------------------------------------------------------------------

  _pointerDown(ev) {
    if (this.screen !== 'play' || this.won || this.drag) return;
    if (ev.button != null && ev.button !== 0) return;
    const el = ev.target.closest && ev.target.closest('.gl-piece');
    if (!el || !this.root.contains(el) || !this.cell) return;
    const i = +el.dataset.i, p = this.pz.pieces[i];
    const r = range(this.pz, this.pos, i);
    this.drag = {
      i, el, id: ev.pointerId, h: p.h,
      start: p.h ? ev.clientX : ev.clientY,
      from: this.pos[i],
      lo: r.lo, hi: r.hi,
      at: this.pos[i] * this.cell,
      moved: false,
    };
    try { el.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    el.classList.remove('is-anim');
    el.classList.add('is-drag');
    this.kbLast = -1;
    ev.preventDefault();
  }
  _pointerMove(ev) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    const delta = (d.h ? ev.clientX : ev.clientY) - d.start;
    if (Math.abs(delta) > 3) d.moved = true;
    const px = Math.max(d.lo * this.cell, Math.min(d.hi * this.cell, d.from * this.cell + delta));
    d.at = px;
    const p = this.pz.pieces[d.i];
    const base = this._xyOf(d.i, 0);
    const x = p.h ? this.frame + px : base.x;
    const y = p.h ? base.y : this.frame + px;
    d.el.style.transform = `translate(${x}px, ${y}px)`;
  }
  _pointerUp(ev) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    this.drag = null;
    d.el.classList.remove('is-drag');
    try { d.el.releasePointerCapture(ev.pointerId); } catch { /* fine */ }
    const q = Math.max(d.lo, Math.min(d.hi, Math.round(d.at / this.cell)));
    if (ev.type === 'pointerup' && q !== d.from) this._commit(d.i, q);
    else this._place(d.i, true);
  }

  /** A seam for headless checks (test-visual.mjs and QA): read the state and make a move. */
  _installTestSeam() {
    if (!DEV_HOST) return;
    try {
      window.__glTest = {
        state: () => ({ band: this.band, n: this.n, pos: this.pos.slice(), moves: this.hist.length, fewest: this.fewest, won: this.won, hints: this.hints }),
        solution: () => solve(this.pz, this.pos),
        move: (i, q) => { const r = range(this.pz, this.pos, i); if (q >= r.lo && q <= r.hi && !this.won) { this._commit(i, q); return true; } return false; },
      };
    } catch { /* no window */ }
  }
}

/** The look picker's little pictures. */
function lookThumb(kind) {
  if (kind === 'wood') return `<svg class="gl-thumb" viewBox="0 0 54 40" aria-hidden="true"><rect width="54" height="40" rx="7" fill="#6b4220"/><rect x="4" y="4" width="46" height="32" rx="4" fill="#3c2614"/>
    <rect x="7" y="7" width="22" height="11" rx="3" fill="#d9a866"/><rect x="7" y="21" width="20" height="11" rx="3" fill="${RED}"/><rect x="33" y="7" width="11" height="25" rx="3" fill="#c98f4e"/></svg>`;
  const car = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4.5" fill="${c}" stroke="#1d2230" stroke-width="1.6"/>`;
  return `<svg class="gl-thumb" viewBox="0 0 54 40" aria-hidden="true"><rect width="54" height="40" rx="7" fill="#c9ccd2"/><rect x="4" y="4" width="46" height="32" rx="4" fill="#535c6c"/>
    ${car(7, 7.5, 21, 10, '#2f7de1')}<rect x="21" y="9.5" width="3.5" height="6" rx="1" fill="#9fdcfb" stroke="#1d2230" stroke-width="1"/>
    ${car(7, 21.5, 19, 10, RED)}<rect x="19" y="23.5" width="3.5" height="6" rx="1" fill="#9fdcfb" stroke="#1d2230" stroke-width="1"/>
    ${car(33, 7.5, 10, 24, '#ffc61a')}<rect x="35" y="11" width="6" height="3.5" rx="1" fill="#9fdcfb" stroke="#1d2230" stroke-width="1"/></svg>`;
}

// --- module contract -------------------------------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (!document.querySelector('link[data-gl-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/gridlock.css', import.meta.url).href;
    link.dataset.glCss = '1';
    document.head.appendChild(link);
  }
  instance = new Gridlock(container);
  instance.mount();
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** False on purpose: every move is saved, so leaving is lossless (see the header). */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
