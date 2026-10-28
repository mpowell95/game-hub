// word-weaver/js/ui.js - the screens: the crossword, the letter wheel (swipe to spell), the hint and
// shuffle buttons, the extra-words chip and sheet, How to play, the level-done screen, the save and
// the module contract. What a word means, the hint and the stars live in engine.js; nothing here
// decides anything about the puzzle.
//
// WORD WEAVER (word-weaver/CLAUDE.md): a Wordscapes-style crossword. One ladder, played in order, no
// difficulty and no replays: opening the game goes straight to the current level.
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md).
// isInProgress() RETURNS FALSE, DELIBERATELY: the level is written to `gamehub.wordweaver.save.v1` after
// every accepted word and every hint, so leaving is lossless.
import '../../js/theme.js';   // side effect: stamps .gh-dark so the standalone page themes too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordWordWeaver } from '../../js/game-stats.js';
import { loadIndex, loadLevel, cellsOf, applyWord, hintCell, starsFor, isDone, cleanState, freshState, foundCells } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// The test seam (window.__wwTest) exists only on a dev server: on the live site it would let anyone
// solve every level from the console (the way Gridlock's does not).
const DEV_HOST = (() => { try { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch { return false; } })();
const DATA = new URL('../data/', import.meta.url);

// --- persistence ---------------------------------------------------------------------------------
// SAVE: { v: 1, n: <current level>, found: [grid words], extra: [extra words], hints: <count on this level>,
//         revealed: ['r,c', ...], recorded: <bool> }. Written after every accepted word and every hint.
// BEST: { v: 1, n } the furthest level ever reached; only ever grows (THE LAW rule 2). It is the place to
//       carry on from if the save is ever missing or unreadable, so a bad save never sends a player back to 1.
// PENDING: [{ n, hints, extra }] completions the recorder refused (its rate gate); retried on every open,
//          removed only after the recorder took them.
const SAVE_KEY = 'gamehub.wordweaver.save.v1';
const BEST_KEY = 'gamehub.wordweaver.best.v1';
const PENDING_KEY = 'gamehub.wordweaver.pending.v1';
const SAVE_V = 1;

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function readObj(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeJSON(key, v, what) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (err) { console.error(`[word-weaver] ${what} NOT saved`, err); return false; }
}

function bestLevel() {
  const b = readObj(BEST_KEY), n = b ? Math.floor(Number(b.n)) : 0;
  return n >= 1 ? n : 1;
}
function noteBest(n) {
  if (n > bestLevel() || !readObj(BEST_KEY)) writeJSON(BEST_KEY, { v: 1, n: Math.max(n, bestLevel()) }, 'furthest level');
}

/** The level to open and its saved state ({ n, raw }); raw is null when there is no usable save. */
function loadSave() {
  const s = readObj(SAVE_KEY), n = s ? Math.floor(Number(s.n)) : 0;
  if (s && s.v === SAVE_V && n >= 1) return { n, raw: s };
  return { n: bestLevel(), raw: null };
}

function readPending() {
  try {
    const a = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(a) ? a.filter((e) => e && Number(e.n) >= 1) : [];
  } catch { return []; }
}
/** Hand every queued completion to the recorder again; keep the ones it still refuses. */
function flushPending() {
  const list = readPending();
  if (!list.length) return;
  const left = [];
  for (const e of list) {
    let ok = null;
    try { ok = recordWordWeaver(Math.floor(e.n), { hints: Math.max(0, Math.floor(e.hints) || 0), extra: Math.max(0, Math.floor(e.extra) || 0) }); } catch (err) { console.error('[word-weaver] queued level not recorded', err); }
    if (!ok) left.push(e);
  }
  if (left.length !== list.length) writeJSON(PENDING_KEY, left, 'queued levels');
}

// --- drawings ------------------------------------------------------------------------------------

const SVGA = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_SHUFFLE = `<svg ${SVGA}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>`;
const ICON_BULB = `<svg ${SVGA}><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></svg>`;
const STAR_D = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
const ICON_STAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${STAR_D}"/></svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The wheel is drawn in a 240 x 240 box (the mockup's numbers): letters sit on a ring of radius 78,
// 27 across the visible disc of a letter, 31 as the touch radius (62 of 240 units: 58px on a 224px wheel).
const RING = 78, LETTER_R = 27, HIT_R = 31, DISC_R = 116;

// --- the game ------------------------------------------------------------------------------------

class WordWeaver {
  constructor(container) {
    this.container = container;
    this.timers = [];
    this.view = 'loading';       // loading | play | done | soon | fail
    this.level = null;
    this.st = freshState();
    this.n = 1;
    this.order = [];             // wheel slot -> index into level.l
    this.sel = [];               // wheel letters picked so far (indices into level.l)
    this.drag = null;
    this.tail = null;            // the finger's place in wheel units while swiping
    this.finishing = false;
    this.seq = 0;
    this.dead = false;
    this.cells = new Map();      // 'r,c' -> grid cell element
    this.cell = 0;
  }

  mount() {
    this.container.innerHTML = '<div class="ww-root"></div>';
    this.root = this.container.querySelector('.ww-root');
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
    this.offLang = onLangChange(() => { if (this.view !== 'loading') this._render(); });
    this._positionRoot();
    try { flushPending(); } catch (err) { console.error('[word-weaver] queued levels', err); }
    this._open(loadSave().n);
  }

  destroy() {
    this.dead = true;
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
    try { delete window.__wwTest; } catch { /* no window */ }
    this.container.innerHTML = '';
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this.timers = this.timers.filter((x) => x !== id); if (!this.dead) fn(); }, ms);
    this.timers.push(id);
    return id;
  }
  _cancel(id) {
    clearTimeout(id);
    this.timers = this.timers.filter((x) => x !== id);
  }

  /** Gridlock's / Arrow Maze's technique: a fixed root measured against the mount point; in the hub's
   *  immersive mode it runs edge to edge and the top row starts right of the floating back button.
   *  The BOTTOM is `bottom: 0`, never a height measured from the viewport. */
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
      this.root.style.setProperty('--ww-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--ww-inset', Math.max(0, Math.round(b.right + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.max(0, Math.round(r.top)) + 'px';
  }

  // --- opening a level ----------------------------------------------------------------------------

  /** Load level n and show it: the saved state if the save is for this level, else a fresh one. Past the
   *  last level is the "More levels soon" state; an unreadable level is "Can't load" with a retry. */
  async _open(n) {
    const seq = ++this.seq;
    this.n = n;
    const lv = await loadLevel(n, DATA);
    if (this.dead || seq !== this.seq) return;
    if (!lv) {
      const idx = await loadIndex(DATA);
      if (this.dead || seq !== this.seq) return;
      this.level = null;
      this.view = idx && n > idx.count ? 'soon' : 'fail';
      this._render();
      return;
    }
    const sv = loadSave();
    this.level = lv;
    this.st = cleanState(lv, sv.n === n ? sv.raw : null);
    this.order = shuffled(lv.l.length, null);
    this.finishing = false;
    this.view = isDone(lv, this.st) ? 'done' : 'play';
    // The last word of a level can be saved with the recorder never reached (the app closed): count it now.
    if (this.view === 'done') this._record();
    this._render();
  }

  _save() {
    if (!this.level) return false;
    const s = this.st;
    const ok = writeJSON(SAVE_KEY, { v: SAVE_V, n: this.n, found: s.found, extra: s.extra, hints: s.hints, revealed: s.revealed, recorded: s.recorded }, 'level progress');
    noteBest(this.n);
    return ok;
  }

  /** Count the level, once. The recorder runs FIRST (before any animation); the `recorded` flag is set only
   *  after it returned. A refusal is queued (PENDING_KEY) rather than lost. */
  _record() {
    if (this.st.recorded) return true;
    const info = { n: this.n, hints: this.st.hints, extra: this.st.extra.length };
    let res = null;
    try { res = recordWordWeaver(info.n, { hints: info.hints, extra: info.extra }); } catch (err) { console.error('[word-weaver] recordWordWeaver failed - level NOT recorded yet, queued', err); }
    if (!res) {
      console.error('[word-weaver] level not recorded (refused); queued to retry');
      const list = readPending();
      if (!list.some((e) => Math.floor(e.n) === info.n)) { list.push(info); writeJSON(PENDING_KEY, list, 'queued levels'); }
    }
    this.st.recorded = true;
    this._save();
    return !!res;
  }

  // --- rendering ----------------------------------------------------------------------------------

  _render() {
    if (!this.root) return;
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    this.drag = null;
    this.sel = [];
    this.tail = null;
    this.pillHold = null;
    const v = this.view, played = v === 'play' || v === 'done';
    let top = `<button type="button" class="ww-help" data-act="help" aria-label="${t('help_aria')}">?</button>`;
    if (played) {
      top += `<button type="button" class="ww-chip" data-act="extras" aria-label="">${ICON_STAR}<span class="ww-badge" hidden></span></button>`
        + `<span class="ww-lvl" aria-label="${t('level_aria', { n: this.n })}">${this.n}</span>`;
    }
    let stage = '', lower = '';
    if (played) {
      stage = `<div class="ww-grid"></div>`;
      lower = v === 'play' ? this._playHTML() : this._doneHTML();
    } else if (v === 'soon') {
      stage = `<div class="ww-msg">${ICON_STAR}<b>${t('soon')}</b></div>`;
    } else if (v === 'fail') {
      stage = `<div class="ww-msg"><b>${t('load_failed')}</b><button type="button" class="ww-next" data-act="retry">${t('retry')}</button></div>`;
    }
    this.root.innerHTML = `<div class="ww-top">${top}</div><div class="ww-stage">${stage}</div>${lower ? `<div class="ww-lower">${lower}</div>` : ''}<div class="gh-overlay ww-modal" hidden></div>`;
    this._positionRoot();
    if (played) {
      this._buildGrid();
      if (v === 'play') this._paintWheel(false);
      this.ro = new ResizeObserver(() => this._layout());
      this.ro.observe(this.root.querySelector('.ww-stage'));
      this._layout();
      this._paintGrid();
      this._paintExtra(false);
      this._paintTools();
      this._installTestSeam();
    } else {
      try { delete window.__wwTest; } catch { /* no window */ }
    }
  }

  _playHTML() {
    const L = this.level.l;
    this.pos = this._slots();
    let ltrs = '';
    for (let i = 0; i < L.length; i++) {
      ltrs += `<g class="ww-ltr" data-i="${i}"><circle class="ww-lc" r="${LETTER_R}"/><text class="ww-lt" dy=".36em">${esc(L[i])}</text></g>`;
    }
    return `
      <div class="ww-pillrow"><div class="ww-pill" role="status" aria-live="polite"></div></div>
      <div class="ww-dock">
        <button type="button" class="ww-side ww-l" data-act="shuffle" aria-label="${t('shuffle_aria')}">${ICON_SHUFFLE}</button>
        <div class="ww-wheelbox">
          <svg class="ww-wheel" viewBox="-120 -120 240 240" role="group" aria-label="${t('wheel_aria')}">
            <circle class="ww-disc" r="${DISC_R}"/>
            <polyline class="ww-trail" points=""/>
            ${ltrs}
          </svg>
        </div>
        <button type="button" class="ww-side ww-r" data-act="hint" aria-label="${t('hint_aria')}">${ICON_BULB}</button>
      </div>`;
  }

  _doneHTML() {
    const stars = starsFor(this.st.hints);
    const row = [0, 1, 2].map((k) => `<svg viewBox="0 0 24 24" class="ww-star${k < stars ? ' is-on' : ''}" aria-hidden="true"><path d="${STAR_D}"/></svg>`).join('');
    return `
      <div class="ww-done">
        <h2>${t('level_n', { n: this.n })}</h2>
        <div class="ww-stars" role="img" aria-label="${t('stars_aria', { n: stars })}">${row}</div>
        <button type="button" class="ww-bonus" data-act="extras" aria-label="${t('extra_aria', { n: this.st.extra.length })}">${ICON_STAR}<b>${this.st.extra.length}</b></button>
        <button type="button" class="ww-next" data-act="next">${t('next')}</button>
      </div>`;
  }

  /** Where each wheel letter (by index) sits, in wheel units, for the current order. */
  _slots() {
    const n = this.order.length, pos = [];
    this.order.forEach((idx, j) => {
      const a = -Math.PI / 2 + (j * 2 * Math.PI) / n;
      pos[idx] = [Math.round(Math.cos(a) * RING * 10) / 10, Math.round(Math.sin(a) * RING * 10) / 10];
    });
    return pos;
  }

  _buildGrid() {
    const grid = this.root.querySelector('.ww-grid');
    this.cells = new Map();
    const lv = this.level;
    // Only the box the words really fill is drawn and centred (the data's declared grid may be larger).
    let r0 = 99, c0 = 99, r1 = 0, c1 = 0;
    for (const e of lv.w) for (const q of cellsOf(e)) { r0 = Math.min(r0, q.r); c0 = Math.min(c0, q.c); r1 = Math.max(r1, q.r); c1 = Math.max(c1, q.c); }
    this.box = [r1 - r0 + 1, c1 - c0 + 1];
    grid.style.setProperty('--ww-cols', this.box[1]);
    grid.style.setProperty('--ww-rows', this.box[0]);
    for (const e of lv.w) {
      for (const q of cellsOf(e)) {
        const k = q.r + ',' + q.c;
        if (this.cells.has(k)) continue;
        const el = document.createElement('div');
        el.className = 'ww-c is-e';
        el.dataset.k = k;
        el.dataset.ch = q.ch;
        el.style.gridRow = String(q.r - r0 + 1);
        el.style.gridColumn = String(q.c - c0 + 1);
        grid.appendChild(el);
        this.cells.set(k, el);
      }
    }
  }

  /** The grid, from the state: a cell of a found word is a tile, a revealed cell a faded tile, the rest a slot. */
  _paintGrid() {
    if (!this.level) return;
    const fc = foundCells(this.level, this.st), rv = new Set(this.st.revealed);
    for (const [k, el] of this.cells) {
      const s = fc.has(k) ? 'f' : rv.has(k) ? 'h' : 'e';
      const cls = 'ww-c is-' + s;
      if (el.dataset.s !== s) {
        el.dataset.s = s;
        el.className = cls;
        el.textContent = s === 'e' ? '' : el.dataset.ch;
      }
    }
  }

  _paintExtra(bump) {
    const n = this.st.extra.length;
    const chip = this.root.querySelector('.ww-chip');
    if (chip) {
      const b = chip.querySelector('.ww-badge');
      b.textContent = String(n);
      b.hidden = n === 0;
      chip.setAttribute('aria-label', t('extra_aria', { n }));
      if (bump) this._anim(chip, bump);
    }
  }

  _paintTools() {
    const hint = this.root.querySelector('[data-act="hint"]');
    if (hint) hint.disabled = this.finishing || !hintCell(this.level, this.st);
  }

  /** Restart a CSS animation class on an element (the class is removed when it ends). */
  _anim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const off = () => { el.classList.remove(cls); el.removeEventListener('animationend', off); };
    el.addEventListener('animationend', off);
  }

  // --- layout -------------------------------------------------------------------------------------

  /** Size the wheel, then the grid to the room above it (measured, never guessed). The wheel is as big as
   *  the width and height allow (its letters stay well over 44px); a big grid takes some of that back, down
   *  to 200px, before its cells get small. */
  _layout() {
    if (!this.root || !this.level || (this.view !== 'play' && this.view !== 'done')) return;
    const stage = this.root.querySelector('.ww-stage');
    const grid = this.root.querySelector('.ww-grid');
    if (!stage || !grid) return;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    if (!W || !H) return;
    let wheel = Math.floor(Math.max(150, Math.min(250, W - 136, H * 0.34)));
    const [rows, cols] = this.box || this.level.g;
    const gap = cols >= 8 || rows >= 8 ? 3 : 4;
    const fit = (wpx) => {
      this.root.style.setProperty('--ww-wheel', wpx + 'px');
      const cs = getComputedStyle(stage);
      const sw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const sh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return Math.floor(Math.min((sw - gap * (cols - 1)) / cols, (sh - gap * (rows - 1)) / rows, 54));
    };
    let cell = fit(wheel);
    while (cell < 34 && wheel > 200) { wheel = Math.max(200, wheel - 12); cell = fit(wheel); }
    cell = Math.max(18, cell);
    this.cell = cell;
    grid.style.setProperty('--ww-cell', cell + 'px');
    grid.style.setProperty('--ww-gap', gap + 'px');
    grid.style.setProperty('--ww-fs', Math.round(cell * 0.58) + 'px');
  }

  // --- the wheel ----------------------------------------------------------------------------------

  _paintWheel(animate) {
    const svg = this.root && this.root.querySelector('.ww-wheel');
    if (!svg) return;
    this.pos = this._slots();
    svg.classList.toggle('is-still', !animate);
    for (const g of svg.querySelectorAll('.ww-ltr')) {
      const i = +g.dataset.i, p = this.pos[i];
      g.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
      g.classList.toggle('is-on', this.sel.includes(i));
    }
    const pts = this.sel.map((i) => this.pos[i].join(','));
    if (this.tail && this.sel.length) pts.push(this.tail.join(','));
    const trail = svg.querySelector('.ww-trail');
    trail.setAttribute('points', pts.join(' '));
    trail.classList.toggle('is-on', this.sel.length > 0);
    this._paintPill();
  }

  _selWord() { return this.sel.map((i) => this.level.l[i]).join(''); }

  /** The pill above the wheel: the word being spelled now, or for a moment the word just tried. */
  _paintPill() {
    const pill = this.root && this.root.querySelector('.ww-pill');
    if (!pill) return;
    if (this.sel.length) {
      if (this.pillTimer) { this._cancel(this.pillTimer); this.pillTimer = 0; }
      this.pillHold = null;
      pill.className = 'ww-pill is-on';
      pill.textContent = this._selWord();
    } else if (!this.pillHold) {
      pill.className = 'ww-pill';
      pill.textContent = '';
    }
  }
  _showPill(word, kind, ms) {
    const pill = this.root && this.root.querySelector('.ww-pill');
    if (!pill) return;
    if (this.pillTimer) this._cancel(this.pillTimer);
    this.pillHold = { word, kind };
    pill.className = 'ww-pill is-on';
    pill.textContent = word;
    if (kind === 'bad') this._anim(pill, 'is-shake');
    this.pillTimer = this._later(() => { this.pillTimer = 0; this.pillHold = null; if (!this.sel.length) this._paintPill(); }, ms);
  }

  _shuffle() {
    if (this.view !== 'play' || this.drag || this.finishing) return;
    this.sel = [];
    this.tail = null;
    this.order = shuffled(this.level.l.length, this.order);
    this._paintWheel(!reduceMotion());
  }

  /** The wheel letter under a point (client coordinates), or -1. */
  _letterAt(x, y) {
    const svg = this.root.querySelector('.ww-wheel');
    if (!svg) return -1;
    const r = svg.getBoundingClientRect();
    if (!r.width) return -1;
    const ux = ((x - r.left) / r.width) * 240 - 120, uy = ((y - r.top) / r.height) * 240 - 120;
    this._lastPt = [ux, uy];
    let best = -1, bd = HIT_R * HIT_R;
    this.pos.forEach((p, i) => {
      const d = (p[0] - ux) ** 2 + (p[1] - uy) ** 2;
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }

  _pointerDown(ev) {
    if (this.view !== 'play' || this.finishing || this.drag) return;
    if (ev.button != null && ev.button !== 0) return;
    const svg = ev.target.closest && ev.target.closest('.ww-wheel');
    if (!svg || !this.root.contains(svg)) return;
    this.drag = { id: ev.pointerId, svg };
    try { svg.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    this.sel = [];
    const hit = this._letterAt(ev.clientX, ev.clientY);
    if (hit >= 0) this.sel.push(hit);
    this.tail = null;
    this._paintWheel(false);
    ev.preventDefault();
  }
  _pointerMove(ev) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    const hit = this._letterAt(ev.clientX, ev.clientY);
    if (hit >= 0) {
      const n = this.sel.length;
      if (n >= 2 && hit === this.sel[n - 2]) this.sel.pop();          // slid back onto the previous letter: un-select
      else if (!this.sel.includes(hit)) this.sel.push(hit);
    }
    const [ux, uy] = this._lastPt;
    const len = Math.hypot(ux, uy) || 1, k = Math.min(1, DISC_R / len);
    this.tail = [Math.round(ux * k * 10) / 10, Math.round(uy * k * 10) / 10];
    this._paintWheel(false);
  }
  _pointerUp(ev) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    this.drag = null;
    try { d.svg.releasePointerCapture(ev.pointerId); } catch { /* fine */ }
    this.tail = null;
    if (ev.type === 'pointerup') this._submitSel();
    else { this.sel = []; this._paintWheel(false); }
  }

  _submitSel() {
    const word = this._selWord();
    this.sel = [];
    this.tail = null;
    this.pillHold = null;
    this._paintWheel(false);
    if (word) this._resolve(word);
  }

  // --- a word -------------------------------------------------------------------------------------

  /** Judge a word and show what it did. Returns the engine's kind. */
  _resolve(word) {
    if (this.view !== 'play' || !this.level || this.finishing) return 'bad';
    const W = String(word).toUpperCase();
    const before = foundCells(this.level, this.st);
    const res = applyWord(this.level, this.st, W);
    switch (res.kind) {
      case 'grid': {
        this._save();
        const fresh = cellsOf(res.word).map((q) => q.r + ',' + q.c).filter((k) => !before.has(k));
        this._paintGrid();
        this._showPill(W, 'ok', 450);
        this._fly(fresh);
        if (isDone(this.level, this.st)) this._complete(); else this._paintTools();
        break;
      }
      case 'found':
        for (const q of cellsOf(res.word)) this._anim(this.cells.get(q.r + ',' + q.c), 'is-flash');
        this._showPill(W, 'ok', 450);
        break;
      case 'extra':
        this._save();
        this._paintExtra('is-bump');
        this._showPill(W, 'ok', 450);
        break;
      case 'extraFound':
        this._paintExtra('is-wiggle');
        this._showPill(W, 'ok', 450);
        break;
      case 'bad':
        this._showPill(W, 'bad', 520);
        break;
      default:
        this.pillHold = null;
        this._paintPill();
    }
    return res.kind;
  }

  /** The new letters of a word fly from the pill into their cells. */
  _fly(keys) {
    if (reduceMotion() || !keys.length) return;
    const pill = this.root.querySelector('.ww-pill');
    if (!pill) return;
    const pr = pill.getBoundingClientRect();
    const px = pr.left + pr.width / 2, py = pr.top + pr.height / 2;
    keys.forEach((k, i) => {
      const el = this.cells.get(k);
      if (!el || !el.animate) return;
      const r = el.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
      el.style.zIndex = '5';
      const a = el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.55)`, opacity: 0 },
        { transform: 'translate(0, 0) scale(1.12)', opacity: 1, offset: 0.78 },
        { transform: 'none', opacity: 1 },
      ], { duration: 420, delay: i * 55, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
      a.onfinish = a.oncancel = () => { el.style.zIndex = ''; };
    });
  }

  _hint() {
    if (this.view !== 'play' || this.finishing) return;
    const c = hintCell(this.level, this.st);
    if (!c) return;
    const k = c.r + ',' + c.c;
    this.st.revealed.push(k);
    this.st.hints += 1;
    // A word whose every letter is now showing counts as found, as in Wordscapes (no swipe needed).
    const shown = foundCells(this.level, this.st);
    for (const r of this.st.revealed) shown.add(r);
    for (const e of this.level.w) {
      if (!this.st.found.includes(e[0]) && cellsOf(e).every((q) => shown.has(q.r + ',' + q.c))) this.st.found.push(e[0]);
    }
    this._save();
    this._paintGrid();
    this._anim(this.cells.get(k), 'is-flash');
    this._paintTools();
    if (isDone(this.level, this.st)) this._complete();
  }

  /** The last word is in: count the level FIRST, then let the letters land and show the done screen. */
  _complete() {
    this.finishing = true;
    this._record();
    this._paintTools();
    this._later(() => { this.finishing = false; this.view = 'done'; this._render(); }, reduceMotion() ? 150 : 800);
  }

  _next() {
    if (this.view !== 'done') return;
    this._record();
    const next = this.n + 1;
    const ok = writeJSON(SAVE_KEY, { v: SAVE_V, n: next, found: [], extra: [], hints: 0, revealed: [], recorded: false }, 'level progress');
    noteBest(next);
    const back = readObj(SAVE_KEY);
    if (!ok || !back || back.n !== next) console.error('[word-weaver] the next level was not saved; this level will show again after a restart');
    this._open(next);
  }

  // --- input --------------------------------------------------------------------------------------

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (ev.target.classList && ev.target.classList.contains('ww-modal') && !ev.target.hidden) { this._closeModal(); return; }
    if (!btn || !this.root.contains(btn)) return;
    const act = btn.dataset.act;
    if (act === 'shuffle') this._shuffle();
    else if (act === 'hint') this._hint();
    else if (act === 'extras') this._openExtras();
    else if (act === 'help') this._openHelp();
    else if (act === 'close') this._closeModal();
    else if (act === 'next') this._next();
    else if (act === 'retry') this._open(this.n);
  }

  /** Desktop: letters type into the pill (the wheel's letters only, respecting counts), Backspace, Enter
   *  submits, Space shuffles. */
  _handleKey(ev) {
    if (!this.root || this.dead) return;
    const m = this.root.querySelector('.ww-modal');
    if (m && !m.hidden) {
      if (ev.key === 'Escape') { ev.preventDefault(); this._closeModal(); }
      return;
    }
    if (this.view !== 'play' || this.finishing || this.drag) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const onControl = ev.target && ev.target.closest && ev.target.closest('button, input, textarea, select, a');
    const k = ev.key;
    if (k === 'Backspace') { ev.preventDefault(); this.sel.pop(); this._paintWheel(false); return; }
    if (k === 'Escape') { this.sel = []; this._paintWheel(false); return; }
    if (k === 'Enter' && !onControl) { ev.preventDefault(); this._submitSel(); return; }
    if (k === ' ' && !onControl) { ev.preventDefault(); this._shuffle(); return; }
    if (k.length === 1 && /[a-z]/i.test(k)) {
      const ch = k.toUpperCase();
      const i = this.level.l.split('').findIndex((c, j) => c === ch && !this.sel.includes(j));
      if (i >= 0) { ev.preventDefault(); this.sel.push(i); this._paintWheel(false); }
    }
  }

  // --- sheets -------------------------------------------------------------------------------------

  _openHelp() {
    this._sheet(`
      <div class="gh-modal ww-dialog" role="dialog" aria-modal="true" aria-labelledby="ww-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="ww-h">${t('how_title')}</h2>
        <p>${t('how_swipe')}</p>
        <p>${t('how_hints')}</p>
        <p>${t('how_extra')}</p>
      </div>`);
  }

  _openExtras() {
    if (!this.level) return;
    const words = this.st.extra.slice().sort((a, b) => a.localeCompare(b));
    this._sheet(`
      <div class="gh-modal ww-dialog" role="dialog" aria-modal="true" aria-labelledby="ww-h">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close_aria')}">&times;</button>
        <h2 class="gh-modal__title" id="ww-h"><span class="ww-h-star">${ICON_STAR}</span>${words.length}</h2>
        <ul class="ww-words" aria-label="${t('extras_title')}">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      </div>`);
  }

  _sheet(html) {
    const m = this.root.querySelector('.ww-modal');
    if (!m) return;
    if (m.hidden) this._opener = document.activeElement;
    m.innerHTML = html;
    m.hidden = false;
    const x = m.querySelector('.gh-modal__close');
    if (x) x.focus({ preventScroll: true });
  }
  _closeModal() {
    const m = this.root && this.root.querySelector('.ww-modal');
    if (!m) return;
    m.hidden = true;
    m.innerHTML = '';
    const back = this._opener;
    this._opener = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  /** A seam for headless checks (dev server only). */
  _installTestSeam() {
    if (!DEV_HOST) return;
    try {
      const ui = this;
      window.__wwTest = {
        ui,
        get level() { return ui.level; },
        get state() { return ui.st; },
        submit: (word) => ui._resolve(word),
        hint: () => ui._hint(),
      };
    } catch { /* no window */ }
  }
}

/** A random order of 0..n-1 that differs from `prev` when it can. */
function shuffled(n, prev) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let tries = 0; tries < 6; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (!prev || n < 3 || a.some((v, i) => v !== prev[i])) break;
  }
  return a;
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
  if (!document.querySelector('link[data-ww-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/word-weaver.css', import.meta.url).href;
    link.dataset.wwCss = '1';
    document.head.appendChild(link);
  }
  instance = new WordWeaver(container);
  instance.mount();
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** False on purpose: every accepted word and hint is saved, so leaving is lossless (see the header). */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
