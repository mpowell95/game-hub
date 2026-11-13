// number-merge/js/ui.js - Number Merge: swipe to slide every tile; equal tiles merge into one, doubled. Module entry
// (init / destroy / isInProgress / back). The rules are in engine.js (pure); this file draws, saves and records.
//
// isInProgress(): always false. Every move is saved at once (gamehub.numbermerge.save.v1 / .daily.v1), so leaving is
// lossless and the game resumes where it was (Continue).
//
// Two ways to play: Classic (endless, a best score) and Daily (one seeded tile sequence a day, the same for everyone,
// the day from the server's clock via js/server-time.js bestNow(); one try).
// QUITTING (a solo game, no computer to lose to): Classic's New game over a game in progress ENDS it, asked first
// ("This game ends at N."), and records it like a finished game with its score. A daily left unfinished when its day
// is over is ended and recorded the same way on the next open. Leaving the game is never quitting.
// RECORDING (THE LAW): the recorder runs FIRST when a game ends, inside withMode; `recorded` is saved only after it
// returned the store. A refused record (rate gate) stays `recorded: false` and is retried on every open.

import * as E from './engine.js';
import STRINGS from './strings.js';
import { makeT, getLang } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordNumberMerge, withMode, loadStats } from '../../js/game-stats.js';
import { bestNow, startServerTime } from '../../js/server-time.js';
import { backStack } from '../../js/back-stack.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.numbermerge.v1';             // settings: { seen } (How to play shown once; a preference)
const SAVE_KEY = 'gamehub.numbermerge.save.v1';   // classic: { v: 1, st: state, done, recorded, ended }
const DAILY_KEY = 'gamehub.numbermerge.daily.v1'; // { v: 1, d: { 'YYYY-MM-DD': { st, done, recorded, ended } } }
const SLIDE_MS = 120;
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SVG = {
  back: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z" fill="currentColor"/></svg>',
};

// --- tiles: told apart by NUMBER and LIGHTNESS (Matt is red/green colourblind), never hue alone ------------------
// Each step down the ladder is darker than the one before; the dark ones carry white numbers, and 2048 and up
// wear a gold ring as well.
const lvlOf = (v) => (v > 1 ? Math.min(12, Math.round(Math.log2(v))) : 0);
const fmt = (n, lang) => { try { return Number(n || 0).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US'); } catch { return String(n | 0); } };

// --- storage (every write verified by a fresh re-read, rule 6) --------------------------------------------------
function readJSON(key, dflt) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : dflt; } catch { return dflt; }
}
function writeJSON(key, val) {
  try {
    const s = JSON.stringify(val);
    localStorage.setItem(key, s);
    if (localStorage.getItem(key) !== s) throw new Error('did not read back');
    return true;
  } catch (err) { console.error('[number-merge] progress NOT saved', key, err); return false; }
}
const loadSettings = () => readJSON(KEY, {});
const saveSettings = (patch) => writeJSON(KEY, { ...loadSettings(), ...patch });
function nmRec() {
  try { return ((loadStats().games || {}).numbermerge || {}).nm || {}; } catch { return {}; }
}
/** 'YYYY-MM-DD', the LOCAL date (each player's own midnight, as Spelling Bee and Word Weaver). */
function dayKey(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
const todayKey = () => dayKey(new Date(bestNow()));
function randomSeed() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0; } catch { return (Math.random() * 4294967296) >>> 0; }
}

class NumberMerge {
  constructor(host) {
    this.host = host;
    this.lang = getLang() === 'es' ? 'es' : 'en';
    this.cur = null;     // { kind: 'classic'|'daily', key, st, done, recorded, ended, prevBest }
    this._ensureCss();
    this.root = document.createElement('div');
    this.root.className = 'nm-root';
    host.appendChild(this.root);
    this._onClick = (e) => this._click(e);
    this._onKey = (e) => this._key(e);
    this._onDown = (e) => this._down(e);
    this._onUp = (e) => this._up(e);
    this._onCancel = () => { this._drag = null; };
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('pointerup', this._onUp);
    this.root.addEventListener('pointercancel', this._onCancel);
    document.addEventListener('keydown', this._onKey);
    // THE PHONE'S BACK SWIPE steps back one screen, as in every leaderboard (js/back-stack.js). Levels: start screen 0,
    // a game 1, How to play or the New game? sheet +1. The hub's top-left button takes the same step via back().
    this._bs = backStack((n) => this._stepBack(n));
    this._offResize = onViewportResize(() => this._fit());
    try { startServerTime(); } catch { /* the day falls back to the phone's clock */ }
    this._flushAll();
    this._setup();
  }

  // --- the back step (swipe, the hub's button, the game's own back arrow and X, Esc: one path) ---------------
  _level() {
    const sheet = this.root.querySelector('.nm-ov') ? 1 : 0;
    return (/^(setup|help-setup|confirm-setup)$/.test(this.screen) ? 0 : 1) + sheet;
  }
  _sync() {
    if (this._dead || !this._bs || this._stepping) return;
    const lv = Math.max(0, this._level());
    this._bs.sync(lv);
    this._label(lv > 0);
  }
  /** The hub's top-left button reads "‹ Back" while the game has a step to take, "‹ Hub" on the start screen. */
  _label(step) {
    if (step === this._backStep) return;
    this._backStep = step;
    try { window.dispatchEvent(new CustomEvent('gamehub:backlabel', { detail: step })); } catch { /* old browser */ }
  }
  _goBack() {
    if (this._bs && this._bs.level > 0) this._bs.back(); else this._stepBack(1);
  }
  _stepBack(n) {
    this._stepping = true;
    try {
      for (let i = 0; i < n; i++) {
        if (this.root.querySelector('.nm-ov')) { this._closeSheet(); continue; }
        if (this.screen !== 'setup') { this._setup(); continue; }
        break;
      }
    } finally { this._stepping = false; }
    this._sync();
  }
  back() {
    if (this._level() > 0) { this._goBack(); return true; }
    return false;
  }

  _ensureCss() {
    if (document.querySelector('link[data-nm-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../css/number-merge.css', import.meta.url).href;
    l.setAttribute('data-nm-css', '');
    document.head.appendChild(l);
  }

  // --- progress ---------------------------------------------------------------------------------------------
  _classicSave() {
    const s = readJSON(SAVE_KEY, null);
    if (!s) return null;
    const st = E.cleanState(s.st);
    return st ? { kind: 'classic', key: '', st, done: !!s.done || st.over, recorded: !!s.recorded, ended: s.ended || '' } : null;
  }
  _dailyAll() { const a = readJSON(DAILY_KEY, { v: 1, d: {} }); if (!a.d || typeof a.d !== 'object' || Array.isArray(a.d)) a.d = {}; return a; }
  _dailySave(key) {
    const s = this._dailyAll().d[key];
    const st = s && E.cleanState(s.st);
    return st ? { kind: 'daily', key, st, done: !!s.done || st.over, recorded: !!s.recorded, ended: s.ended || '' } : null;
  }
  _save(c) {
    const rec = { v: 1, st: c.st, done: !!c.done, recorded: !!c.recorded, ended: c.ended || '' };
    if (c.kind === 'daily') {
      const all = this._dailyAll();
      all.v = 1;
      all.d[c.key] = rec;
      return writeJSON(DAILY_KEY, all);
    }
    return writeJSON(SAVE_KEY, rec);
  }
  /** Every ended game the recorder has not taken yet, recorded now; a past day's unfinished daily is ended first. */
  _flushAll() {
    const c = this._classicSave();
    if (c && c.done && !c.recorded) this._record(c, true);
    const today = todayKey();
    for (const key of Object.keys(this._dailyAll().d)) {
      const d = this._dailySave(key);
      if (!d || d.recorded) continue;
      if (!d.done && key < today && d.st.moves > 0) { d.done = true; d.ended = 'day'; this._save(d); }
      if (d.done) this._record(d, true);
    }
  }
  /** Record an ended game. Returns true once the recorder took it. */
  _record(c, quiet) {
    let res = null;
    const det = () => ({ moves: c.st.moves, merges: c.st.merges | 0, top: String(E.bestTile(c.st.grid)), end: c.ended || 'over' });
    try {
      res = withMode(() => ({ mode: c.kind }), c.kind,
        () => recordNumberMerge(c.st.score, { mode: c.kind, tile: E.bestTile(c.st.grid), moves: c.st.moves, day: c.key }),
        () => ({ hi: c.st.score, detail: det }));
    } catch (err) { console.error('[number-merge] result NOT recorded yet, retried on the next open', err); res = null; }
    if (!res) { if (!quiet) console.error('[number-merge] the recorder refused the result; kept as not recorded, retried on the next open'); return false; }
    c.recorded = true;
    this._save(c);
    return true;
  }
  _best() { return nmRec().best | 0; }
  _dailyScore(key) {
    const e = (nmRec().dl || {})[key];
    if (e && typeof e === 'object') return e.sc | 0;
    const d = this._dailySave(key);
    return d && d.done ? d.st.score : null;
  }

  // --- screens ----------------------------------------------------------------------------------------------
  _setup() {
    this._settle();
    this.screen = 'setup';
    this.cur = null;
    const c = this._classicSave();
    const going = c && !c.done && c.st.moves > 0;
    const best = this._best();
    const dk = todayKey();
    const dScore = this._dailyScore(dk);
    const dDone = dScore != null;
    this.root.innerHTML = `
      <div class="nm-setup">
        <div class="nm-home">
          ${heroSVG()}
          <h1 class="nm-title">${esc(t('title'))}</h1>
          ${best ? `<div class="nm-bestline">${SVG.star}<span>${esc(t('best'))}</span><b>${fmt(best, this.lang)}</b></div>` : ''}
          ${going
            ? `<button type="button" class="nm-btn nm-btn-main" data-act="continue">${esc(t('cont'))} <b class="nm-btn-n">${fmt(c.st.score, this.lang)}</b></button>
               <button type="button" class="nm-btn" data-act="new">${esc(t('new_game'))}</button>`
            : `<button type="button" class="nm-btn nm-btn-main" data-act="classic">${esc(t('play'))}</button>`}
          <button type="button" class="nm-btn nm-btn-daily${dDone ? ' is-done' : ''}" data-act="daily" aria-label="${esc(dDone ? t('daily_done_aria', { n: fmt(dScore, this.lang) }) : t('daily_aria'))}">${SVG.cal}<span>${esc(t('daily'))}</span>${dDone ? `<i class="nm-ok">${SVG.check}</i><b class="nm-btn-n">${fmt(dScore, this.lang)}</b>` : ''}</button>
          <button type="button" class="nm-help" data-act="help" aria-label="${esc(t('help_aria'))}">?</button>
        </div>
      </div>`;
    this._sync();
  }

  _openClassic(fresh) {
    let c = fresh ? null : this._classicSave();
    if (!c || (c.done && c.recorded)) c = { kind: 'classic', key: '', st: E.newGame(randomSeed()), done: false, recorded: false, ended: '' };
    this._start(c);
  }
  _openDaily() {
    const key = todayKey();
    let c = this._dailySave(key);
    if (!c) c = { kind: 'daily', key, st: E.newGame(E.dailySeed(key)), done: false, recorded: false, ended: '' };
    this._start(c);
  }
  _start(c) {
    c.prevBest = this._best();
    this.cur = c;
    if (c.done && !c.recorded) this._record(c);
    this._save(c);
    this._play();
    if (c.done) this._over(true);
  }

  _play() {
    this.screen = 'play';
    const c = this.cur;
    const chip = c.kind === 'daily' ? `${SVG.cal}<span>${esc(t('daily'))}</span>` : `<span>${esc(t('classic'))}</span>`;
    const best = c.kind === 'daily' ? null : Math.max(c.prevBest | 0, c.st.score);
    this.root.innerHTML = `
      <div class="nm-game">
        <div class="nm-top"><div class="nm-chip">${chip}</div></div>
        <div class="nm-row2">
          <button type="button" class="nm-icon" data-act="setup" aria-label="${esc(t('menu_aria'))}">${SVG.back}</button>
          <div class="nm-boxes">
            <div class="nm-box"><span>${esc(t('score'))}</span><b data-role="score">${fmt(c.st.score, this.lang)}</b></div>
            ${best == null ? '' : `<div class="nm-box"><span>${esc(t('best'))}</span><b data-role="best">${fmt(best, this.lang)}</b></div>`}
          </div>
          <button type="button" class="nm-icon" data-act="help" aria-label="${esc(t('help_aria'))}">?</button>
        </div>
        <div class="nm-stage" data-role="stage">
          <div class="nm-board" data-role="board" role="grid" aria-label="${esc(t('board_aria'))}">
            ${Array.from({ length: 16 }, () => '<div class="nm-cell"></div>').join('')}
            <div class="nm-layer" data-role="layer"></div>
          </div>
        </div>
      </div>`;
    this._fit();
    this._drawTiles(null);
    this._sync();
    if (!loadSettings().seen) { saveSettings({ seen: 1 }); this._help(); }
  }

  /** The board is the biggest square the room allows (never scrolls), measured. */
  _fit() {
    if (this.screen !== 'play' && this.screen !== 'help-play') return;
    const st = this.root.querySelector('[data-role="stage"]');
    const bd = this.root.querySelector('[data-role="board"]');
    if (!st || !bd) return;
    const W = st.clientWidth, H = st.clientHeight;
    if (!W || !H) { if (this.root.isConnected && !this._dead) requestAnimationFrame(() => this._fit()); return; }
    const size = Math.max(200, Math.min(W, H, 560));
    const gap = Math.round(Math.max(6, Math.min(12, size * 0.026)));
    const cell = (size - gap * 5) / 4;
    this.root.style.setProperty('--nm-size', size + 'px');
    this.root.style.setProperty('--nm-gap', gap + 'px');
    this.root.style.setProperty('--nm-cell', cell + 'px');
  }

  /** Draw every tile where it stands now. `fx` = { merged: [index], at } for the pop and the new tile. */
  _drawTiles(fx) {
    const layer = this.root.querySelector('[data-role="layer"]');
    if (!layer || !this.cur) return;
    const g = this.cur.st.grid;
    const merged = new Set((fx && fx.merged) || []);
    let html = '';
    for (let i = 0; i < 16; i++) {
      const v = g[i];
      if (!v) continue;
      const lv = lvlOf(v), dg = String(v).length;
      const cls = `nm-tile nm-v${lv} nm-d${Math.min(5, dg)}${merged.has(i) ? ' is-pop' : ''}${fx && fx.at === i ? ' is-new' : ''}`;
      html += `<div class="${cls}" data-i="${i}" style="--r:${Math.floor(i / 4)};--c:${i % 4}" role="gridcell" aria-label="${v}"><span>${v}</span></div>`;
    }
    layer.innerHTML = html;
    const sc = this.root.querySelector('[data-role="score"]');
    if (sc) sc.textContent = fmt(this.cur.st.score, this.lang);
    const bs = this.root.querySelector('[data-role="best"]');
    if (bs) bs.textContent = fmt(Math.max(this.cur.prevBest | 0, this.cur.st.score), this.lang);
  }

  /** Finish a slide that is still running (a fast second swipe), so every move starts from a drawn board. */
  _settle() {
    if (!this._anim) return;
    clearTimeout(this._anim.timer);
    const a = this._anim;
    this._anim = null;
    a.finish();
  }

  _move(dir) {
    const c = this.cur;
    if (!c || c.done || this.screen !== 'play') return;
    this._settle();
    const r = E.move(c.st, dir);
    if (!r.moved) { this._bump(dir); return; }
    c.st = r.state;
    if (r.state.over) { c.done = true; c.ended = 'over'; c.recorded = false; }
    this._save(c);                       // saved before anything is drawn
    if (c.done) this._record(c);         // FIRST: before the game over card (THE LAW)
    // Slide: each tile's element moves to its square; merged pairs meet on one. Then the board is redrawn.
    const layer = this.root.querySelector('[data-role="layer"]');
    const els = {};
    if (layer) for (const el of layer.querySelectorAll('.nm-tile')) els[el.dataset.i] = el;
    for (const s of r.slides) {
      const el = els[s.from];
      if (el) { el.style.setProperty('--r', Math.floor(s.to / 4)); el.style.setProperty('--c', s.to % 4); el.classList.remove('is-pop', 'is-new'); }
    }
    const finish = () => {
      if (this._dead || this.cur !== c) return;
      this._drawTiles({ merged: r.merged, at: r.at });
      if (c.done) this._overT = setTimeout(() => { if (!this._dead && this.cur === c && this.screen === 'play') this._over(false); }, 450);
    };
    this._anim = { finish, timer: setTimeout(() => { this._anim = null; finish(); }, SLIDE_MS) };
  }
  /** A swipe that moves nothing: a small nudge of the board that way (garnish; none with reduced motion). */
  _bump(dir) {
    const bd = this.root.querySelector('[data-role="board"]');
    if (!bd) return;
    bd.classList.remove('is-bump-up', 'is-bump-down', 'is-bump-left', 'is-bump-right');
    void bd.offsetWidth;
    bd.classList.add('is-bump-' + dir);
  }

  /** Game over: a card over the board with the score, the top tile, and what next. */
  _over(revisit) {
    const c = this.cur;
    if (!c) return;
    const stage = this.root.querySelector('[data-role="board"]');
    if (!stage || stage.querySelector('.nm-card')) return;
    const top = E.bestTile(c.st.grid);
    const isBest = c.kind === 'classic' && !revisit && c.st.score > 0 && c.st.score > (c.prevBest | 0);
    const lv = lvlOf(top);
    const card = document.createElement('div');
    card.className = 'nm-over';
    card.innerHTML = `<div class="nm-card" role="dialog" aria-label="${esc(t('over'))}">
      <button type="button" class="nm-icon nm-x" data-act="setup" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
      <h2 class="nm-card-h">${esc(c.kind === 'daily' ? t('daily') : t('over'))}</h2>
      <div class="nm-big">${fmt(c.st.score, this.lang)}</div>
      ${isBest ? `<div class="nm-newbest">${SVG.star}<span>${esc(t('new_best'))}</span></div>` : ''}
      <div class="nm-facts">
        <span class="nm-fact">${esc(t('tile'))} <i class="nm-mini nm-v${lv} nm-d${Math.min(5, String(top).length)}"><span>${top}</span></i></span>
        <span class="nm-fact">${esc(t('moves'))} <b>${fmt(c.st.moves, this.lang)}</b></span>
      </div>
      ${c.kind === 'daily'
        ? `<button type="button" class="nm-btn nm-btn-main" data-act="setup">${esc(t('back'))}</button>`
        : `<button type="button" class="nm-btn nm-btn-main" data-act="again">${esc(t('again'))}</button>`}
    </div>`;
    stage.appendChild(card);
    this.screen = 'play';
  }

  // --- sheets: How to play, New game? ---------------------------------------------------------------------
  _help() {
    this._settle();
    const prev = this.screen;
    const ov = document.createElement('div');
    ov.className = 'nm-ov';
    ov.innerHTML = `<div class="nm-sheet" role="dialog" aria-label="${esc(t('how_title'))}">
      <button type="button" class="nm-icon nm-x" data-act="close-sheet" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
      <h2 class="nm-card-h">${esc(t('how_title'))}</h2>
      <p class="nm-how-b">${esc(t('how_goal'))}</p>
      ${howSVG()}
      <p class="nm-how-cap">${esc(t('how_merge'))}</p>
      <p>${esc(t('how_new'))}</p>
      <p>${esc(t('how_end'))}</p>
      <p>${esc(t('how_daily'))}</p>
      <button type="button" class="nm-btn nm-btn-main nm-gotit" data-act="close-sheet">${esc(t('got_it'))}</button>
    </div>`;
    this.root.appendChild(ov);
    this._sheetPrev = prev;
    this.screen = prev === 'setup' ? 'help-setup' : 'help-play';
    this._sync();
  }
  _confirmNew() {
    const c = this._classicSave();
    const ov = document.createElement('div');
    ov.className = 'nm-ov';
    ov.innerHTML = `<div class="nm-sheet nm-confirm" role="dialog" aria-label="${esc(t('end_q'))}">
      <button type="button" class="nm-icon nm-x" data-act="close-sheet" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
      <h2 class="nm-card-h">${esc(t('end_q'))}</h2>
      <p class="nm-how-b">${esc(t('end_t', { n: fmt(c ? c.st.score : 0, this.lang) }))}</p>
      <button type="button" class="nm-btn nm-btn-main" data-act="end-new">${esc(t('new_game'))}</button>
      <button type="button" class="nm-btn nm-btn-dark" data-act="close-sheet">${esc(t('keep'))}</button>
    </div>`;
    this.root.appendChild(ov);
    this._sheetPrev = this.screen;
    this.screen = 'confirm-setup';
    this._sync();
  }
  _closeSheet() {
    const ov = this.root.querySelector('.nm-ov');
    if (ov) ov.remove();
    if (this.screen.startsWith('help') || this.screen.startsWith('confirm')) this.screen = this._sheetPrev || 'setup';
    if (this.screen === 'play') this._fit();
    this._sync();
  }
  /** New game over a game in progress: that game ends here and counts with its score (asked first). */
  _endAndNew() {
    const c = this._classicSave();
    const ov = this.root.querySelector('.nm-ov');
    if (ov) ov.remove();
    this.screen = 'setup';
    if (c && !c.done && c.st.moves > 0) {
      c.done = true; c.ended = 'quit'; c.recorded = false;
      this._save(c);
      this._record(c);
    }
    this._openClassic(true);
  }

  // --- input ------------------------------------------------------------------------------------------------
  _click(e) {
    const b = e.target.closest('button');
    if (!b || !this.root.contains(b)) {
      if (e.target.classList && e.target.classList.contains('nm-ov')) this._goBack();
      return;
    }
    const act = b.dataset.act;
    if (act === 'classic' || act === 'continue') this._openClassic(false);
    else if (act === 'new') this._confirmNew();
    else if (act === 'end-new') this._endAndNew();
    else if (act === 'again') this._openClassic(true);
    else if (act === 'daily') this._openDaily();
    else if (act === 'setup') { if (this.screen !== 'setup') this._goBack(); }
    else if (act === 'help') this._help();
    else if (act === 'close-sheet') this._goBack();
  }
  _down(e) {
    if (this.screen !== 'play' || !e.target.closest('[data-role="stage"]') || e.target.closest('button, .nm-card')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* fine */ }
  }
  _up(e) {
    const d = this._drag;
    this._drag = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 24) return;
    this._move(ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }
  _key(e) {
    const tg = e.target;
    if (tg && tg.closest && (tg.closest('input, textarea, select, [contenteditable]') || (tg !== document.body && !this.root.contains(tg)))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && this._level() > 0) { this._goBack(); e.preventDefault(); return; }
    if (this.screen !== 'play') return;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right' }[e.key];
    if (dir) { this._move(dir); e.preventDefault(); }
  }

  destroy() {
    this._label(false);
    this._dead = true;
    if (this._anim) { clearTimeout(this._anim.timer); this._anim = null; }
    clearTimeout(this._overT);
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('pointerdown', this._onDown);
    this.root.removeEventListener('pointerup', this._onUp);
    this.root.removeEventListener('pointercancel', this._onCancel);
    document.removeEventListener('keydown', this._onKey);
    try { if (this._offResize) this._offResize(); } catch { /* gone */ }
    try { if (this._bs) this._bs.close(); } catch { /* gone */ }
    this._bs = null;
    this.root.remove();
  }

  _seam() {
    return {
      ui: this,
      state: () => this.cur && JSON.parse(JSON.stringify(this.cur)),
      move: (d) => { this._move(d); this._settle(); },
      /** Put a grid on the board (a test only, localhost): the game continues from it. */
      setGrid: (g) => { if (!this.cur) return; this.cur.st = E.cleanState({ ...this.cur.st, grid: g }) || this.cur.st; this._save(this.cur); this._drawTiles(null); },
    };
  }
}

/** How to play's diagram: a row 2 2 _ _ slides left into 4 _ _ _ (the merged tile ringed), arrows show the swipe. */
function howSVG() {
  const cell = 40, gap = 6, x0 = 20;
  const row = (vals, y, ring) => vals.map((v, i) => {
    const x = x0 + i * (cell + gap);
    const fill = v === 0 ? '#3a4256' : v === 2 ? '#f7f4ec' : '#e8dcbf';
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="7" fill="${fill}"${ring === i ? ' stroke="#ffce3a" stroke-width="4"' : ''}/>`
      + (v ? `<text x="${x + cell / 2}" y="${y + 27}" text-anchor="middle" font-size="20" font-weight="800" font-family="system-ui,sans-serif" fill="#2a2320">${v}</text>` : '');
  }).join('');
  const w = x0 * 2 + 4 * cell + 3 * gap;
  return `<svg class="nm-how-svg" viewBox="0 0 ${w} 140" width="${w}" height="140" aria-hidden="true">
    ${row([0, 0, 2, 2], 4, -1)}
    <path d="M${w / 2 + 30} 66H${w / 2 - 30}" stroke="#f5f8ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M${w / 2 - 22} 58l-8 8 8 8" stroke="#f5f8ff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${row([4, 0, 0, 0], 92, 0)}
  </svg>`;
}

function heroSVG() {
  const t = (x, y, v, fill, ink) => `<rect x="${x}" y="${y}" width="40" height="40" rx="8" fill="${fill}"/><text x="${x + 20}" y="${y + 27}" text-anchor="middle" font-size="${String(v).length > 2 ? 15 : 20}" font-weight="800" font-family="system-ui,sans-serif" fill="${ink}">${v}</text>`;
  return `<svg class="nm-hero" viewBox="0 0 160 100" aria-hidden="true">
    <rect x="34" y="4" width="92" height="92" rx="12" fill="#2c3448"/>
    ${t(38, 8, 2, '#f7f4ec', '#2a2320')}${t(82, 8, 4, '#e8dcbf', '#2a2320')}
    ${t(38, 52, 64, '#a2433a', '#fff')}${t(82, 52, 128, '#8a3d5f', '#fff')}
  </svg>`;
}

let instance = null;
export function init(container) {
  if (instance) instance.destroy();
  instance = new NumberMerge(container);
  try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__nmTest = instance._seam(); } catch { /* no window */ }
}
export function destroy() {
  if (instance) instance.destroy();
  instance = null;
  try { delete window.__nmTest; } catch { /* no window */ }
}
// Always false: every move is saved, leaving is lossless (see the header).
export function isInProgress() { return false; }
/** The hub's back: one screen back inside the game (a sheet, then the start screen); false = leave to the hub. */
export function back() { return !!(instance && instance.back()); }
export default { init, destroy, isInProgress, back };
