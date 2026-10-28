// spelling-bee/js/ui.js - SPELLING BEE: a clone of the NYT game. One puzzle a day (the same for
// everyone), seven letters in a honeycomb, the centre letter in every word. The rules live in
// engine.js; this file is the DOM, input, autosave and the module contract.
//
// THE LAW applies here. `gamehub.spellingbee.save.v1` keeps every puzzle ever played, keyed by its
// letters, and its found words only ever GROW. Reaching Genius on a puzzle records ONE win,
// `recordResult('spellingbee', 'daily', true)`, guarded by the save's `recorded` flag.
//
// isInProgress() RETURNS FALSE, DELIBERATELY: every found word is saved at once, so leaving is
// lossless (the Contexto / Sudoku class).
import '../../js/theme.js';   // side effect: stamps .gh-dark so this screen themes standalone too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, getLang, onLangChange } from '../../js/i18n.js';
import { recordResult, noteVoidedResult } from '../../js/game-stats.js';
import { VOIDED_MATCHES } from '../../js/stats-corrections.js';
import {
  RANKS, GENIUS, QUEEN, MAX_LEN, loadData, dayKey, dayNumber, dateOfDay, puzzleAt, puzzleOf, fold, answersFor, extrasFor, totalPoints,
  rankThresholds, rankIndex, checkWord, praiseFor, scoreWord, isPangram, hintsFor, shuffled,
} from './engine.js';
import STRINGS from './strings.js';
import { postProgress, watchDaily, needsPost } from './board.js';
import { logAction, flushLog } from './log.js';
import { myCode } from '../../js/messages.js';
import { loadProfile } from '../../js/profile-store.js';

const t = makeT(STRINGS);
const CSS_MARK = 'data-spellingbee-css';
const SAVE_KEY = 'gamehub.spellingbee.save.v1';
const STATS_ID = 'spellingbee';
let instance = null;
const DATA_PROMISE = {};   // per language: the word list, fetched once per page

/** A word found under an older, bigger bonus list keeps counting (THE LAW rules 1-2: Matt's CRATCH,
 *  found 2026-10-26, before the list was hand-checked). Only words that passed checkWord were ever
 *  saved, so a stored word that still fits the puzzle's letters was accepted when it was found. */
const legal = (w, p) => typeof w === 'string' && w.length >= 4 && w.includes(p.center) && [...w].every((c) => p.letters.has(c));
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The mark at Genius and above (Matt, 2026-10-27: "Obviously a bee should be the highest award").
const crestOf = (ri) => (ri === QUEEN ? '🐝' : '🧠');
/** A voided day this phone counted a Genius win for (js/stats-corrections.js): noted once, so the stats
 *  screens take the win back out. The save itself is untouched. */
function noteVoidedDays(save) {
  const me = myCode();
  if (!me) return;
  for (const [id, v] of Object.entries(VOIDED_MATCHES[STATS_ID] || {})) {
    const r = save && save.games && save.games[v.puzzle];
    if (v.winner !== me || !r || !r.recorded) continue;
    try { noteVoidedResult(STATS_ID, id, 'won'); } catch (err) { console.error('[spelling-bee] noting a voided day failed', err); }
  }
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** The puzzle language follows the hub's EN/ES setting (2026-10-26): Spanish players get Spanish words. */
// The puzzle language: this phone's EN/ES choice in the game (Matt, 2026-10-27: "add a language toggle
// within the Spelling Bee game"), else the hub's language. Only the words change; the screens keep the
// hub's language.
const LANG_KEY = 'gamehub.spellingbee.lang.v1';
const wordLang = () => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'es') return v; } catch { /* hub's */ }
  return getLang() === 'es' ? 'es' : 'en';
};

function getData(lang) {
  if (!DATA_PROMISE[lang]) DATA_PROMISE[lang] = loadData(lang).catch((err) => { DATA_PROMISE[lang] = null; throw err; });
  return DATA_PROMISE[lang];
}

function ensureCSS() {
  const uiHref = new URL('../../css/ui.css', import.meta.url).href;
  const hasUi = document.head.querySelector('link[data-gh-ui-css="1"]')
    || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === uiHref);
  if (!hasUi) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = uiHref;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  const href = new URL('../css/spelling-bee.css', import.meta.url).href;
  if (document.head.querySelector('[' + CSS_MARK + ']')
    || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) {
    return Promise.resolve();
  }
  return new Promise((res) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(CSS_MARK, '1');
    link.onload = link.onerror = () => res();
    document.head.appendChild(link);
    setTimeout(res, 2500);
  });
}

// --- save -------------------------------------------------------------------------------------
// { v:1, games: { "<centre>:<outer>": { day, found: [words in the order found], recorded, seenGenius, seenQueen } } }

function loadSave() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {};
    return { v: 1, games: (v.games && typeof v.games === 'object' && !Array.isArray(v.games)) ? v.games : {} };
  } catch { return { v: 1, games: {} }; }
}

/** Writes, then re-reads to prove it landed (THE LAW rule 6). */
function writeSave(save) {
  try {
    const s = JSON.stringify(save);
    localStorage.setItem(SAVE_KEY, s);
    if (localStorage.getItem(SAVE_KEY) !== s) throw new Error('re-read mismatch');
    return true;
  } catch (err) { console.error('[spelling-bee] save FAILED - progress may not survive a reload', err); return false; }
}

function recOf(save, puzzle, day) {
  let r = save.games[puzzle.key];
  if (!r || typeof r !== 'object') r = save.games[puzzle.key] = {};
  if (!Array.isArray(r.found)) r.found = [];
  r.found = r.found.filter((w) => typeof w === 'string');
  if (!r.day) r.day = day;
  return r;
}

// --- the honeycomb ----------------------------------------------------------------------------
// Flat-topped hexagons, circumradius 50, a 6-unit gap. Outer order: top, top right, bottom right,
// bottom, bottom left, top left (the NYT layout).
const HEX = '-50,0 -25,-43.3 25,-43.3 50,0 25,43.3 -25,43.3';
const G = 6;
const DY = 86.6 + G;
const DX = 75 + G * 0.866;
const SPOTS = [[0, 0], [0, -DY], [DX, -DY / 2], [DX, DY / 2], [0, DY], [-DX, DY / 2], [-DX, -DY / 2]];

const ICON = {
  hints: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  yesterday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>',
  rankings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.7 2.7 0 0 1 5.1 1.3c0 1.8-2.4 2.1-2.4 4"/><path d="M12 17.6v.01"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>',
  past: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

class SpellingBee {
  constructor(container) {
    this.container = container;
    this.disposed = false;
    this.data = null;
    this.input = '';
    this.open = false;          // the found-words panel
    this._timers = new Set();
    this._overlay = null;
  }

  async mount() {
    this.container.innerHTML = `<div class="sb-root"><div class="sb-center">${esc(t('loading'))}</div></div>`;
    this.root = this.container.querySelector('.sb-root');
    this._positionRoot();
    this._offResize = onViewportResize(() => { this._positionRoot(); this._layoutPanel(); });
    this._onKey = (ev) => this._handleKey(ev);
    document.addEventListener('keydown', this._onKey);
    this._onVis = () => {
      this._log(document.hidden ? 'hidden' : 'visible');
      if (document.hidden) flushLog(); else this._checkDay();
    };
    document.addEventListener('visibilitychange', this._onVis);
    this._dayTimer = setInterval(() => this._checkDay(), 60000);
    await ensureCSS();
    if (this.disposed) return;
    this._offLang = onLangChange(() => { if (this.data && this.data.lang !== wordLang()) { this._closeOverlay(); this._load(); } });
    this._load();
  }

  async _load() {
    try {
      this.data = await getData(wordLang());
    } catch (err) {
      if (this.disposed) return;
      console.error('[spelling-bee] data', err);
      this._renderError();
      return;
    }
    if (this.disposed) return;
    this._startDay();
  }

  _renderError() {
    this.root.innerHTML = `<div class="sb-center"><p>${esc(t('load_error'))}</p>
      <button type="button" class="gh-btn gh-btn--primary" data-act="retry">${esc(t('try_again'))}</button></div>`;
    this.root.querySelector('[data-act="retry"]').addEventListener('click', () => this._load());
  }

  // --- the day's puzzle ------------------------------------------------------------------------

  /** Day n's puzzle (default today). Past days play exactly like today: same save, same Genius win.
   *  `old` = the day's RETIRED letters (swapped 2026-10-26 for a fuller puzzle): still playable, so
   *  progress on it stays visible (THE LAW rule 1). */
  _startDay(n, old) {
    this.todayN = dayNumber(this.data.epoch, new Date());
    this.n = (Number.isInteger(n) && n >= 0 && n <= this.todayN) ? n : this.todayN;
    this.day = dayKey(dateOfDay(this.data.epoch, this.n));
    this.old = !!(old && this.data.retired[this.n] === old);
    this.puzzle = this.old ? puzzleOf(old, this.data.lang) : puzzleAt(this.data, this.n);
    this.answers = answersFor(this.data, this.puzzle);
    this.answerSet = new Set(this.answers);
    this.extraSet = new Set(extrasFor(this.data, this.puzzle));
    this.max = totalPoints(this.answers, this.puzzle);
    this.save = loadSave();
    noteVoidedDays(this.save);
    this.rec = recOf(this.save, this.puzzle, this.day);
    // Keep only words that still count for the SCORE, but never drop a stored word (rule 5).
    this.found = new Set(this.rec.found.filter((w) => this.counts(w) || legal(w, this.puzzle)));
    this.outer = this.puzzle.outer.slice();
    this._settle = null;
    this._busy = false;
    this.input = '';
    this.open = false;
    this._render();
    this._maybeRecord();
    // The daily board for THIS puzzle: watched while it is on screen, and our count posted if behind.
    if (this._stopBoard) this._stopBoard();
    this.boardRows = [];
    const key = this.puzzle.key;
    this._stopBoard = watchDaily(key, (rows) => {
      if (this.disposed || !this.puzzle || this.puzzle.key !== key) return;
      this.boardRows = rows;
      if (this._overlay && this._overlay.dataset.kind === 'board') this._openBoard();
    });
    this._postSoon(0);
    this._log('open', { r: `day ${this.n}${this.old ? ' old' : ''}` });
    flushLog();   // anything queued from an earlier session (offline, closed too fast)
    try { window.__sbTest = { ui: this, answers: this.answers, submit: (w) => { this.input = w; this.submit(); }, play: (d, old) => this._startDay(d, old) }; } catch { /* ignore */ }
  }

  _checkDay() {
    if (!this.data || this.disposed) return;
    const tn = dayNumber(this.data.epoch, new Date());
    if (tn === this.todayN) return;
    // Midnight: today's puzzle moves on to the new day; a past puzzle being played stays put.
    if (this.n === this.todayN && !this.old) { this._closeOverlay(); this._startDay(); } else this.todayN = tn;
  }

  /** An answer or a bonus word (a rarer real word: scores, never counted in hints or ranks). */
  counts(w) { return this.answerSet.has(w) || this.extraSet.has(w); }

  /** The rank shown. A puzzle that already reached Genius stays at least Genius (rule 2): the
   *  2026-10-26 bigger word list raised every total, and an earned Genius never goes backwards. */
  rank() {
    let all = true;
    for (const w of this.answers) if (!this.found.has(w)) { all = false; break; }
    const i = rankIndex(this.score, this.max, all);
    return this.rec.recorded && i < GENIUS ? GENIUS : i;
  }

  get score() {
    let s = 0;
    for (const w of this.found) s += scoreWord(w, this.puzzle);
    return s;
  }

  // --- render ----------------------------------------------------------------------------------

  _render() {
    this.root.innerHTML = `
      <div class="sb-hud">
        <span class="sb-hud-fill"></span>
        <button type="button" class="sb-langbtn" data-act="lang" aria-label="${esc(t('lang_aria'))}">${this.data.lang === 'es' ? 'ES' : 'EN'}</button>
        <button type="button" class="sb-iconbtn" data-act="past" aria-label="${esc(t('past_aria'))}">${ICON.past}</button>
        <button type="button" class="sb-iconbtn" data-act="hints" aria-label="${esc(t('hints_aria'))}">${ICON.hints}</button>
        <button type="button" class="sb-iconbtn" data-act="yesterday" aria-label="${esc(t('yesterday_aria'))}"${this.n > 0 ? '' : ' hidden'}>${ICON.yesterday}</button>
        <button type="button" class="sb-iconbtn" data-act="board" aria-label="${esc(t('board_aria'))}">${ICON.rankings}</button>
        <button type="button" class="sb-iconbtn" data-act="help" aria-label="${esc(t('help_aria'))}">${ICON.help}</button>
      </div>
      <button type="button" class="sb-progress" data-act="rankings" data-role="progress"></button>
      <div class="sb-wordsbar">
        <button type="button" class="sb-found" data-act="toggle" aria-label="${esc(t('found_aria'))}" aria-expanded="false">
          <span class="sb-found-list" data-role="recent"></span>
          <span class="sb-chev">${ICON.chevron}</span>
        </button>
      </div>
      <div class="sb-main">
        <div class="sb-msg" data-role="msg" aria-live="polite"></div>
        <div class="sb-input" data-role="input" aria-live="off"></div>
        <div class="sb-hivewrap">
          <svg class="sb-hive" data-role="hive" viewBox="-134 -140 268 280" role="group" aria-label="${esc(t('title'))}">
            ${SPOTS.map(([x, y], i) => `<g class="sb-cell${i === 0 ? ' is-center' : ''}" data-i="${i}" transform="translate(${x} ${y})" role="button" tabindex="0">
              <g class="sb-cell-in"><polygon points="${HEX}"/><text x="0" y="2" text-anchor="middle" dominant-baseline="central"></text></g></g>`).join('')}
          </svg>
        </div>
        <div class="sb-controls">
          <button type="button" class="sb-pill" data-act="delete">${esc(t('delete'))}</button>
          <button type="button" class="sb-pill sb-round" data-act="shuffle" aria-label="${esc(t('shuffle_aria'))}">${ICON.shuffle}</button>
          <button type="button" class="sb-pill" data-act="enter">${esc(t('enter'))}</button>
        </div>
        <div class="sb-panel" data-role="panel" hidden></div>
      </div>`;
    this.el = {
      progress: this.root.querySelector('[data-role="progress"]'),
      recent: this.root.querySelector('[data-role="recent"]'),
      toggle: this.root.querySelector('[data-act="toggle"]'),
      msg: this.root.querySelector('[data-role="msg"]'),
      input: this.root.querySelector('[data-role="input"]'),
      hive: this.root.querySelector('[data-role="hive"]'),
      panel: this.root.querySelector('[data-role="panel"]'),
      cells: [...this.root.querySelectorAll('.sb-cell')],
    };
    if (!this._onClick) {
      this._onClick = (ev) => this._handleClick(ev);
      this.root.addEventListener('click', this._onClick);
      this._onDown = (ev) => this._handleDown(ev);
      this.root.addEventListener('pointerdown', this._onDown);
    }
    this._paintLetters();
    this._paintInput();
    this._paintProgress();
    this._paintFound();
  }

  _paintLetters() {
    const letters = [this.puzzle.center, ...this.outer];
    this.el.cells.forEach((c, i) => {
      c.querySelector('text').textContent = letters[i].toUpperCase();
      c.dataset.letter = letters[i];
      c.setAttribute('aria-label', letters[i].toUpperCase());
    });
  }

  _paintInput() {
    const html = [...this.input].map((ch) => {
      const cls = ch === this.puzzle.center ? 'is-center' : this.puzzle.letters.has(ch) ? '' : 'is-bad';
      return `<span class="${cls}">${esc(ch.toUpperCase())}</span>`;
    }).join('');
    this.el.input.innerHTML = `<span class="sb-input-text">${html}<span class="sb-caret"></span></span>`;
    // Long words shrink to fit (NYT does the same).
    const len = this.input.length;
    this.el.input.style.setProperty('--sb-in-fs', (len > 14 ? 22 : len > 10 ? 26 : 30) + 'px');
  }

  _paintProgress() {
    const sc = this.score;
    const ri = this.rank();
    const shown = Math.min(ri, GENIUS);
    const dots = [];
    for (let i = 0; i <= GENIUS; i++) {
      const cls = i < shown ? 'is-past' : i === shown ? 'is-now' : '';
      dots.push(`<span class="sb-dot ${cls}" style="left:calc(16px + (100% - 32px) * ${(i / GENIUS).toFixed(4)})">${i === shown ? `<b>${sc}</b>` : ''}</span>`);
    }
    // A past day's date sits over the rank (2026-10-27: the HUD's left end is the hub's Back button now
    // that the EN/ES button joined the icons).
    const date = this.n < this.todayN || this.old ? `<small class="sb-rank-date">${esc(this._fmt(this.n, { month: 'short', day: 'numeric' }))}</small>` : '';
    this.el.progress.innerHTML = `<span class="sb-rank">${date}${esc(t('rank_' + RANKS[ri].id))}</span>
      <span class="sb-track"><span class="sb-line"></span>${dots.join('')}</span>`;
    this.el.progress.setAttribute('aria-label', `${t('rank_' + RANKS[ri].id)}, ${t('points_n', { n: sc })}`);
  }

  _paintFound() {
    const n = this.found.size;
    const order = this.rec.found.filter((w) => this.found.has(w));
    this.el.recent.innerHTML = this.open
      ? `<span class="sb-found-count">${esc(n === 1 ? t('words_1') : t('words_n', { n }))}</span>`
      : (n ? order.slice().reverse().map((w) => `<span class="${this._cls(w)}">${esc(this._show(w))}</span>`).join('')
        : `<span class="sb-found-count">${esc(t('words_n', { n: 0 }))}</span>`);
    this.el.toggle.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    this.el.toggle.classList.toggle('is-open', this.open);
    this.el.panel.hidden = !this.open;
    if (this.open) this._layoutPanel();
  }

  /** A word as shown: capitalised (Spanish is written without accents, Ñ included). */
  _show(w) { return cap(w); }

  _cls(w) { return !this.answerSet.has(w) ? 'is-bonus' : isPangram(w, this.puzzle) ? 'is-pangram' : ''; }

  /** The open word list: alphabetical, in as many columns as it takes to fit with no scrolling. */
  _layoutPanel() {
    if (!this.open || !this.el || !this.el.panel) return;
    const words = [...this.found].sort();
    const p = this.el.panel;
    p.innerHTML = `<ul class="sb-panel-list">${words.map((w) => `<li class="${this._cls(w)}">${esc(this._show(w))}</li>`).join('')}</ul>`;
    const ul = p.firstChild;
    const h = p.clientHeight - 24;
    const w = p.clientWidth - 24;
    let fs = 16;
    let cols = 1;
    for (; fs >= 12; fs -= 1) {
      const lineH = Math.round(fs * 1.55);
      const rows = Math.max(1, Math.floor(h / lineH));
      cols = Math.max(1, Math.ceil(words.length / rows));
      if (w / cols >= fs * 6) break;
    }
    ul.style.setProperty('--sb-cols', String(Math.max(cols, 2)));
    ul.style.setProperty('--sb-pfs', fs + 'px');
  }

  // --- input -----------------------------------------------------------------------------------

  _handleDown(ev) {
    const cell = ev.target.closest && ev.target.closest('.sb-cell');
    if (!cell || this._overlay) return;
    ev.preventDefault();
    this._press(cell);
    this.type(cell.dataset.letter);
  }

  _press(cell) {
    cell.classList.remove('is-pressed');
    void cell.getBoundingClientRect();
    cell.classList.add('is-pressed');
    this._later(() => cell.classList.remove('is-pressed'), 140);
  }

  _handleClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !this.root.contains(btn)) return;
    const a = btn.dataset.act;
    if (a === 'delete') this.backspace();
    else if (a === 'shuffle') this.shuffle();
    else if (a === 'enter') this.submit();
    else if (a === 'toggle') { this.open = !this.open; this._paintFound(); if (this.open) this._log('list'); }
    else if (a === 'hints') this._openHints();
    else if (a === 'yesterday') this._openYesterday();
    else if (a === 'past') this._openPast();
    else if (a === 'rankings') this._openRankings();
    else if (a === 'board') this._openBoard();
    else if (a === 'lang') this._switchLang();
    else if (a === 'help') this._openHelp();
    else if (a === 'retry') this._load();
  }

  _handleKey(ev) {
    if (!this.puzzle || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (this._overlay) { if (ev.key === 'Escape') this._closeOverlay(); return; }
    const k = ev.key;
    const ch = k.length === 1 ? fold(k) : '';   // á -> a; ñ stays ñ (its own letter)
    if (/^[a-zñ]$/.test(ch)) { this.type(ch); const i = [this.puzzle.center, ...this.outer].indexOf(ch); if (i >= 0) this._press(this.el.cells[i]); ev.preventDefault(); }
    else if (k === 'Backspace') { this.backspace(); ev.preventDefault(); }
    else if (k === 'Enter') { this.submit(); ev.preventDefault(); }
    else if (k === ' ') { this.shuffle(); ev.preventDefault(); }
  }

  type(ch) {
    if (this._settle) this._settle();
    if (!this.puzzle || this._busy) return;
    if (this.open) { this.open = false; this._paintFound(); }
    if (this.input.length >= MAX_LEN + 1) return;
    this.input += ch;
    this._paintInput();
  }

  backspace() {
    if (this._settle) { this._settle(); return; }   // the shown word is already on its way out
    if (this._busy || !this.input) return;
    this.input = this.input.slice(0, -1);
    this._paintInput();
  }

  shuffle() {
    if (!this.puzzle) return;
    this._log('shuffle');
    this.outer = shuffled(this.outer);
    if (reduced()) { this._paintLetters(); return; }
    this.el.hive.classList.add('is-shuffling');
    this._later(() => { this._paintLetters(); this.el.hive.classList.remove('is-shuffling'); }, 160);
  }

  submit() {
    if (!this.puzzle || this._busy || !this.input) return;
    this._checkDay();
    const word = this.input;
    const why = checkWord(word, this.puzzle, this.answerSet, this.found, this.extraSet);
    this._log('guess', { w: word, r: why || (this.answerSet.has(word) ? 'ok' : 'bonus') });
    if (why) { this._reject(why); return; }
    const before = this.rank();
    this.found.add(word);
    this.rec.found.push(word);
    // When each word was found (Matt, 2026-10-26: "Just record when he plays"). Parallel to `found`,
    // additive; words found before this have no time.
    const now = Date.now();
    if (!this.rec.times || typeof this.rec.times !== 'object') this.rec.times = {};
    this.rec.times[word] = now;
    if (!this.rec.geniusAt && this.rank() >= GENIUS) this.rec.geniusAt = now;
    writeSave(this.save);
    const pts = scoreWord(word, this.puzzle);
    // A bonus word (a rarer real word, not in the hints) says so (Matt, 2026-10-26).
    const praise = this.answerSet.has(word) ? praiseFor(word, this.puzzle) : 'bonus';
    this._toast(t('praise_' + praise), praise === 'pangram' ? 'is-pangram' : 'is-good', pts);
    this._feedback('is-accepted', reduced() ? 0 : 450);
    this._paintProgress();
    this._paintFound();
    this._maybeRecord();
    this._postSoon(2500);
    const after = this.rank();
    if (after !== before && after >= GENIUS) this._celebrate(after);
  }

  _reject(why) {
    this._toast(t(why), 'is-bad');
    this._feedback(reduced() ? '' : 'is-shake', 700);
  }

  /** The accepted / refused word stays up for `ms`, then clears. Typing during it ends it at once,
   *  so the next word's first letter is never lost (Matt, 2026-10-26: "_ATCH", HATCH then LATCH lost
   *  the L every time). */
  _feedback(cls, ms) {
    this._busy = true;
    if (cls) this.el.input.classList.add(cls);
    const done = () => {
      if (this._settle !== done) return;
      this._settle = null;
      this._busy = false;
      this.input = '';
      if (cls) this.el.input.classList.remove(cls);
      this._paintInput();
    };
    this._settle = done;
    this._later(done, ms);
  }

  _toast(text, cls, pts) {
    const m = this.el.msg;
    m.innerHTML = `<span class="sb-toast ${cls}">${esc(text)}</span>${pts ? `<span class="sb-plus">+${pts}</span>` : ''}`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { if (!this.disposed) m.innerHTML = ''; }, 1100);
  }

  _later(fn, ms) {
    const id = setTimeout(() => { this._timers.delete(id); if (!this.disposed) fn(); }, ms);
    this._timers.add(id);
  }

  // --- stats -----------------------------------------------------------------------------------

  /** One win per puzzle, the first time it reaches Genius. Flag set only once the recorder took it. */
  _maybeRecord() {
    if (this.rec.recorded || this.rank() < GENIUS) return;
    let st = null;
    try { st = recordResult(STATS_ID, 'daily', true); } catch (err) { console.error('[spelling-bee] recordResult failed - Genius NOT recorded', err); }
    if (!st) { console.error('[spelling-bee] Genius not recorded yet; will retry on the next word or open'); return; }
    this.rec.recorded = true;
    writeSave(this.save);
    noteVoidedDays(this.save);
  }

  _celebrate(ri) {
    const key = ri === QUEEN ? 'seenQueen' : 'seenGenius';
    if (this.rec[key]) return;
    this.rec[key] = true;
    writeSave(this.save);
    this._later(() => this._openOverlay('win', `
      <button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>
      <div class="sb-win-bee" aria-hidden="true">${crestOf(ri)}</div>
      <h2 class="gh-modal__title sb-win-title">${esc(t(ri === QUEEN ? 'queen_title' : 'genius_title'))}</h2>
      <p class="sb-win-pts">${esc(t('points_n', { n: this.score }))}</p>
      <div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--block sb-keep" data-ov="close">${esc(t('keep_going'))}</button></div>`), 700);
  }

  // --- overlays --------------------------------------------------------------------------------

  _openOverlay(kind, html) {
    const was = this._overlay ? this._overlay.dataset.kind : null;   // a refresh or a month flip is not a new open
    this._closeOverlay();
    const ov = document.createElement('div');
    ov.className = 'gh-overlay sb-overlay';
    ov.dataset.kind = kind;
    if (kind !== was) this._log(kind);   // hints, yesterday, past, board, rankings, help, win
    ov.innerHTML = `<div class="gh-modal sb-modal sb-modal--${kind}" role="dialog" aria-modal="true">${html}</div>`;
    ov.addEventListener('click', (ev) => {
      if (ev.target === ov || ev.target.closest('[data-ov="close"]')) this._closeOverlay();
    });
    this.root.appendChild(ov);
    this._overlay = ov;
    this._fitLines(ov);
    const c = ov.querySelector('.gh-modal__close');
    if (c) { try { c.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  _closeOverlay() {
    if (!this._overlay) return;
    this._overlay.remove();
    this._overlay = null;
  }

  /** Every `.sb-fit` line on one row: shrink until it fits, 11px floor (docs/BUILDING-A-GAME.md). */
  _fitLines(ov) {
    ov.querySelectorAll('.sb-fit').forEach((el) => {
      let fs = parseFloat(getComputedStyle(el).fontSize) || 15;
      while (el.scrollWidth > el.clientWidth + 1 && fs > 11) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
    });
  }

  _closeBtn() { return `<button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>`; }

  // --- the daily board (board.js) -------------------------------------------------------------

  /** EN <-> ES puzzle words, remembered on this phone. Both saves are kept (keys differ by language). */
  _switchLang() {
    const next = this.data.lang === 'es' ? 'en' : 'es';
    try { localStorage.setItem(LANG_KEY, next); } catch { /* this session only */ }
    this._log('lang', { r: next });
    this._closeOverlay();
    this._load();
  }

  /** Every guess and action, timed (log.js; Matt, 2026-10-27: "Everything."). Never shown in the game. */
  _log(e, extra) {
    if (this.puzzle) { try { logAction(this.puzzle.key, e, extra); } catch (err) { console.error('[spelling-bee] log', err); } }
  }

  _postSoon(ms) {
    clearTimeout(this._postT);
    this._postT = null;
    if (!needsPost(this.puzzle.key, this.found.size)) return;
    this._postT = setTimeout(() => { this._postT = null; this._post(); }, ms);
  }

  /** Play times for the board row: first word, Genius, and every timed word as seconds after the first
   *  ("12,40,95"). Never shown in the game; read with tools/read-bee-times.mjs. */
  _times() {
    const tm = (this.rec.times && typeof this.rec.times === 'object') ? this.rec.times : {};
    const ms = this.rec.found.map((w) => tm[w]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!ms.length) return null;
    const out = { t0: ms[0], ts: ms.map((x) => Math.round((x - ms[0]) / 1000)).join(',').slice(0, 3000) };
    if (Number.isFinite(this.rec.geniusAt)) out.tg = this.rec.geniusAt;
    return out;
  }

  _post() {
    if (!this.puzzle) return;
    postProgress(this.puzzle.key, { words: this.found.size, points: this.score, rank: this.rank(), times: this._times() }).catch(() => {});
  }

  /** Everyone's word count on the puzzle shown, ours live from this screen (not the board's copy). */
  /** The day's board, English and Spanish as two sections (Matt, 2026-10-27: "show both english and spanish.
   *  separate, but both visible"). The puzzle being played comes first, its own row live from this screen. */
  _openBoard() {
    const other = this.data.lang === 'es' ? 'en' : 'es';
    this._watchOther(other);
    const mine = this._boardSection(this.data.lang, this.boardRows, this.max, true);
    const theirs = this._boardSection(other, this._other ? this._other.rows : [], this._other ? this._other.max : 0, false);
    const title = this.n === this.todayN && !this.old ? t('today') : this._fmt(this.n, { month: 'short', day: 'numeric' });
    this._openOverlay('board', `${this._closeBtn()}<h2 class="gh-modal__title">${esc(title)}</h2>${mine}${theirs}`);
    // No scrolling: drop the lowest rows (never ours), from the longer list first, and say how many.
    const m = this._overlay.querySelector('.gh-modal');
    const lists = [...this._overlay.querySelectorAll('.sb-board')];
    const cuts = new Map(lists.map((ol) => [ol, 0]));
    const removable = (ol) => [...ol.children].filter((x) => !x.classList.contains('is-me') && !x.classList.contains('sb-bd-more') && !x.classList.contains('sb-bd-none'));
    while (m.scrollHeight > m.clientHeight + 1) {
      const ol = lists.filter((l) => removable(l).length).sort((a, b) => removable(b).length - removable(a).length)[0];
      if (!ol) break;
      const rows = removable(ol);
      rows[rows.length - 1].remove();
      cuts.set(ol, cuts.get(ol) + 1);
      let more = ol.querySelector('.sb-bd-more');
      if (!more) { ol.insertAdjacentHTML('beforeend', '<li class="sb-bd-more"></li>'); more = ol.querySelector('.sb-bd-more'); }
      more.textContent = '+' + cuts.get(ol);
    }
  }

  /** One language's list: heading + rows (place, emoji, name and a bar toward Genius, words over points). */
  _boardSection(lang, serverRows, max, live) {
    const code = myCode();
    const rows = serverRows.filter((r) => !live || r.code !== code).map((r) => ({ ...r, me: r.code === code }));
    if (live) {
      const p = (() => { try { return loadProfile() || {}; } catch { return {}; } })();
      rows.push({ code: code || '', name: p.name || '', emoji: p.emoji || '', words: this.found.size, points: this.score, rank: this.rank(), me: true });
    }
    rows.sort((a, b) => b.words - a.words || b.points - a.points || (a.me ? -1 : b.me ? 1 : a.name.localeCompare(b.name)));
    // Place (ties share it), emoji, name (🧠/🐝 at Genius/Queen Bee) over a bar toward Genius, then words
    // over points (Matt, 2026-10-26: "I wanna see how many points they have too").
    const genius = rankThresholds(max || 1)[GENIUS] || 1;
    let place = 0;
    const li = rows.map((r, i) => {
      if (i === 0 || r.words !== rows[i - 1].words || r.points !== rows[i - 1].points) place = i + 1;
      const pct = Math.max(4, Math.round(Math.min(1, r.points / genius) * 100));
      const crest = r.rank >= GENIUS ? crestOf(r.rank) : '';
      return `<li class="sb-bd-row${r.me ? ' is-me' : ''}" aria-label="${esc(`${place}. ${r.name}, ${t('rank_' + RANKS[r.rank].id)}, ${r.words} ${t('words_col')}, ${r.points} ${t('points_col')}`)}">
        <span class="sb-bd-pos${place <= 3 ? ' is-top' : ''}">${place}</span>
        <span class="sb-bd-av" aria-hidden="true">${esc(r.emoji)}</span>
        <span class="sb-bd-mid"><span class="sb-bd-name">${esc(r.name)}</span>
          <span class="sb-bd-line"><span class="sb-bd-bar"><b style="width:${pct}%"></b></span><span class="sb-bd-crest" aria-hidden="true">${crest}</span></span></span>
        <span class="sb-bd-n"><span><b>${r.words}</b> <small>${esc(r.words === 1 ? t('word_1') : t('words_col'))}</small></span>
          <span class="sb-bd-pts"><b>${r.points}</b> <small>${esc(r.points === 1 ? t('point_1') : t('points_col'))}</small></span></span></li>`;
    }).join('') || '<li class="sb-bd-none">-</li>';
    return `<h3 class="sb-bd-lang">${esc(lang === 'es' ? 'Español' : 'English')}</h3><ol class="sb-board">${li}</ol>`;
  }

  /** The other language's board for the same date: its puzzle (its own file, fetched once), watched while
   *  this puzzle is on screen. A date before that language's first puzzle has no board. */
  _watchOther(lang) {
    const date = dateOfDay(this.data.epoch, this.n);
    const want = `${lang}:${dayKey(date)}`;
    if (this._other && this._other.want === want) return;
    if (this._other && this._other.stop) this._other.stop();
    const o = { want, rows: [], max: 0, stop: null };
    this._other = o;
    getData(lang).then((d) => {
      if (this._other !== o || this.disposed) return;
      const n = dayNumber(d.epoch, date);
      if (n < 0) return;
      const pz = puzzleAt(d, n);
      o.max = totalPoints(answersFor(d, pz), pz);
      o.stop = watchDaily(pz.key, (rows) => {
        if (this._other !== o || this.disposed) return;
        o.rows = rows;
        if (this._overlay && this._overlay.dataset.kind === 'board') this._openBoard();
      });
    }).catch((err) => console.warn('[spelling-bee] other board', err));
  }

  _openRankings() {
    const th = rankThresholds(this.max);
    const ri = this.rank();
    const rows = RANKS.map((r, i) => {
      if (i === QUEEN && ri < QUEEN) return '';
      return `<li class="${i === ri ? 'is-now' : ''}"><span class="sb-rk-mark" aria-hidden="true">${i === ri ? '▶' : ''}</span><span class="sb-rk-name">${esc(t('rank_' + r.id))}</span><span class="sb-rk-pts">${th[i]}</span></li>`;
    }).join('');
    this._openOverlay('rankings', `${this._closeBtn()}<h2 class="gh-modal__title">${esc(t('rankings'))}</h2><ol class="sb-ranks">${rows}</ol>`);
  }

  _openHints() {
    const h = hintsFor(this.answers, this.found, this.puzzle);
    const head = `<tr><th></th>${h.lens.map((l) => `<th>${l}</th>`).join('')}<th>Σ</th></tr>`;
    const colSum = (l) => h.firsts.reduce((s, f) => s + h.grid[f][l], 0);
    const body = h.firsts.map((f) => {
      const cells = h.lens.map((l) => h.grid[f][l]);
      const sum = cells.reduce((a, b) => a + b, 0);
      return `<tr class="${f === this.puzzle.center ? 'is-center' : ''}"><th>${f.toUpperCase()}</th>${cells.map((c) => `<td>${c || '-'}</td>`).join('')}<td class="sb-sum">${sum || '-'}</td></tr>`;
    }).join('');
    const foot = `<tr class="sb-sumrow"><th>Σ</th>${h.lens.map((l) => `<td>${colSum(l) || '-'}</td>`).join('')}<td>${h.words}</td></tr>`;
    const two = h.two.map(([k, n]) => `<span>${k.toUpperCase()}-${n}</span>`).join('');
    this._openOverlay('hints', `${this._closeBtn()}<h2 class="gh-modal__title">${esc(t('hints'))}</h2>
      <p class="sb-hint-sum sb-fit">${esc(h.words === 1 ? t('words_1') : t('hint_words', { n: h.words }))} · ${esc(t(h.points === 1 ? 'hint_points_1' : 'hint_points', { n: h.points }))} · ${esc(t(h.pangrams === 1 ? 'hint_pangrams_1' : 'hint_pangrams', { n: h.pangrams }))}${h.perfect ? ' ' + esc(t('hint_perfect', { n: h.perfect })) : ''}</p>
      <table class="sb-grid"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>
      <h3 class="sb-h3">${esc(t('hint_two'))}</h3><div class="sb-two">${two}</div>`);
  }

  _fmt(n, opts) {
    try { return new Intl.DateTimeFormat(getLang(), opts).format(dateOfDay(this.data.epoch, n)); } catch { return dayKey(dateOfDay(this.data.epoch, n)); }
  }

  /** Past puzzles: a month calendar, epoch to today. Tap a day to play it. */
  _openPast(ym) {
    const ep = this.data.epoch;
    const first = dateOfDay(ep, 0);
    const today = dateOfDay(ep, this.todayN);
    const lo = first.getFullYear() * 12 + first.getMonth();
    const hi = today.getFullYear() * 12 + today.getMonth();
    if (!Number.isInteger(ym)) { const d = dateOfDay(ep, this.n); ym = d.getFullYear() * 12 + d.getMonth(); }
    ym = Math.max(lo, Math.min(hi, ym));
    const y = Math.floor(ym / 12);
    const m = ym % 12;
    const n1 = dayNumber(ep, new Date(y, m, 1, 12));
    const days = new Date(y, m + 1, 0).getDate();
    const lead = new Date(y, m, 1).getDay();
    const save = loadSave();
    const wk = [];
    for (let i = 0; i < 7; i++) {
      let w = '';
      try { w = new Intl.DateTimeFormat(getLang(), { weekday: 'narrow' }).format(new Date(2026, 9, 4 + i, 12)); } catch { w = 'SMTWTFS'[i]; }
      wk.push(`<span class="sb-cal-wk" aria-hidden="true">${esc(w)}</span>`);
    }
    const cells = [];
    const olds = [];
    for (let i = 0; i < lead; i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) {
      const n = n1 + d - 1;
      if (n < 0 || n > this.todayN) { cells.push(`<span class="sb-cal-day is-off">${d}</span>`); continue; }
      const pr = this._progress(save, puzzleAt(this.data, n));
      const label = this._fmt(n, { weekday: 'long', month: 'long', day: 'numeric' }) + (pr ? ', ' + t('rank_' + RANKS[pr.ri].id) : '');
      const cls = `sb-cal-day${n === this.n && !this.old ? ' is-now' : ''}${n === this.todayN ? ' is-today' : ''}`;
      cells.push(`<button type="button" class="${cls}" data-day="${n}" aria-label="${esc(label)}"><span>${d}</span>${pr ? pr.mark : ''}</button>`);
      // A retired puzzle this player has words on: still shown and playable, under the grid.
      const old = this.data.retired[n];
      const po = old && this._progress(save, puzzleOf(old, this.data.lang));
      if (po) {
        const q = puzzleOf(old, this.data.lang);
        olds.push(`<button type="button" class="sb-cal-old${n === this.n && this.old ? ' is-now' : ''}" data-day="${n}" data-old="${esc(old)}" aria-label="${esc(this._fmt(n, { month: 'long', day: 'numeric' }) + ', ' + t('rank_' + RANKS[po.ri].id))}">
          <span class="sb-cal-old-d">${esc(this._fmt(n, { month: 'short', day: 'numeric' }))}</span>
          <span class="sb-yletters"><span class="is-center">${q.center.toUpperCase()}</span>${q.outer.map((c) => `<span>${c.toUpperCase()}</span>`).join('')}</span>${po.mark}</button>`);
      }
    }
    let title = '';
    try { title = new Intl.DateTimeFormat(getLang(), { month: 'long', year: 'numeric' }).format(new Date(y, m, 1, 12)); } catch { title = `${y}-${m + 1}`; }
    this._openOverlay('past', `${this._closeBtn()}
      <div class="sb-cal-head">
        <button type="button" class="sb-iconbtn" data-cal="${ym - 1}" aria-label="${esc(t('prev_month_aria'))}"${ym > lo ? '' : ' disabled'}>${ICON.back}</button>
        <h2 class="gh-modal__title sb-cal-title">${esc(title)}</h2>
        <button type="button" class="sb-iconbtn" data-cal="${ym + 1}" aria-label="${esc(t('next_month_aria'))}"${ym < hi ? '' : ' disabled'}>${ICON.fwd}</button>
      </div>
      <div class="sb-cal">${wk.join('')}${cells.join('')}</div>${olds.length ? `<div class="sb-cal-olds">${olds.join('')}</div>` : ''}`);
    this._overlay.addEventListener('click', (ev) => {
      const day = ev.target.closest('[data-day]');
      if (day) { this._closeOverlay(); this._startDay(Number(day.dataset.day), day.dataset.old); return; }
      const nav = ev.target.closest('[data-cal]');
      if (nav && !nav.disabled) this._openPast(Number(nav.dataset.cal));
    });
  }

  /** A puzzle's saved progress for the calendar: { ri, mark } or null if no words found. */
  _progress(save, p) {
    const r = save.games[p.key];
    const got = r && Array.isArray(r.found) ? r.found : [];
    if (!got.length) return null;
    const ans = answersFor(this.data, p);
    const set = new Set(ans);
    const ex = new Set(extrasFor(this.data, p));
    const gs = new Set(got);
    let sc = 0;
    for (const w of gs) if (set.has(w) || ex.has(w) || legal(w, p)) sc += scoreWord(w, p);
    const max = totalPoints(ans, p);
    let ri = rankIndex(sc, max, ans.every((w) => gs.has(w)));
    if (r.recorded && ri < GENIUS) ri = GENIUS;
    const g = rankThresholds(max)[GENIUS] || 1;
    const mark = ri >= GENIUS ? `<i class="sb-cal-mark">${crestOf(ri)}</i>`
      : `<i class="sb-cal-bar"><b style="width:${Math.max(8, Math.round(Math.min(1, sc / g) * 100))}%"></b></i>`;
    return { ri, mark };
  }

  _openYesterday() {
    const p = puzzleAt(this.data, this.n - 1);
    const ans = answersFor(this.data, p);
    const save = loadSave();
    const r = save.games[p.key];
    const got = new Set(r && Array.isArray(r.found) ? r.found : []);
    const letters = `<div class="sb-yletters" aria-label="${esc([p.center, ...p.outer].join(' ').toUpperCase())}"><span class="is-center">${p.center.toUpperCase()}</span>${p.outer.map((c) => `<span>${c.toUpperCase()}</span>`).join('')}</div>`;
    const list = ans.map((w) => `<li class="${isPangram(w, p) ? 'is-pangram' : ''}${got.has(w) ? ' is-got' : ''}">${got.has(w) ? '<span class="sb-tick" aria-hidden="true">✓</span>' : ''}${esc(this._show(w))}${isPangram(w, p) ? ' <span aria-hidden="true">★</span>' : ''}</li>`).join('');
    this._openOverlay('yesterday', `${this._closeBtn()}<h2 class="gh-modal__title">${esc(t('yesterday'))}</h2>${letters}<ul class="sb-ylist">${list}</ul>`);
    // No scrolling: up to ~90 words, so more columns, then smaller type (11px floor), until it fits.
    const m = this._overlay.querySelector('.gh-modal');
    const ul = this._overlay.querySelector('.sb-ylist');
    for (const [cols, fs] of [[2, 14], [3, 14], [3, 13], [3, 12], [4, 12], [4, 11]]) {
      ul.style.columnCount = String(cols);
      ul.style.fontSize = fs + 'px';
      if (m.scrollHeight <= m.clientHeight + 1) break;
    }
  }

  /** Fewest words (Matt, 2026-10-26: "Too. Many. Words."): the hive, then four short lines. */
  _openHelp() {
    const mini = SPOTS.map(([x, y], i) => `<g transform="translate(${x} ${y})"><polygon points="${HEX}" class="${i === 0 ? 'is-center' : ''}"/><text x="0" y="2" text-anchor="middle" dominant-baseline="central">${'ATBLERC'[i]}</text></g>`).join('');
    this._openOverlay('help', `${this._closeBtn()}<h2 class="gh-modal__title">${esc(t('howto'))}</h2>
      <svg class="sb-help-hive" viewBox="-134 -140 268 280" aria-hidden="true">${mini}</svg>
      <p class="sb-fit">${esc(t('howto_rule'))}</p>
      <p class="sb-fit">${esc(t('howto_points'))}</p>
      <p class="sb-fit">${esc(t('howto_pangram'))}</p>
      <p class="sb-fit"><i>${esc(t('howto_bonus_word'))}</i> ${esc(t('howto_bonus'))}</p>`);
  }


  // --- layout ----------------------------------------------------------------------------------

  /** Immersive in the hub: the root takes the whole screen and the HUD sits beside the hub's
   *  floating back button (murdoku's measured approach). */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    if (!vh) return;
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      // Full bleed, like the NYT page: the hub's side margins would show as strips of its colour.
      this.root.classList.add('is-immersive');
      this.root.style.left = '0px';
      this.root.style.width = (document.documentElement.clientWidth || window.innerWidth) + 'px';
      this.root.style.top = '0px';
      this.root.style.height = Math.max(300, Math.round(vh)) + 'px';
      this.root.style.setProperty('--sb-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.round(Math.max(0, r.top)) + 'px';
    this.root.style.height = Math.max(300, Math.round(vh - Math.max(0, r.top))) + 'px';
  }

  destroy() {
    if (this.puzzle) { this._log('close'); flushLog(); }
    this.disposed = true;
    if (this._postT) { clearTimeout(this._postT); this._post(); }   // a word found just before leaving still reaches the board
    if (this._stopBoard) this._stopBoard();
    if (this._other && this._other.stop) this._other.stop();
    if (this._offLang) this._offLang();
    try { if (window.__sbTest && window.__sbTest.ui === this) delete window.__sbTest; } catch { /* ignore */ }
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    clearInterval(this._dayTimer);
    clearTimeout(this._toastT);
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    if (this._offResize) this._offResize();
    if (this.root && this._onClick) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('pointerdown', this._onDown);
    }
    this._closeOverlay();
    this.container.innerHTML = '';
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch { /* ignore */ } }
  instance = new SpellingBee(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** Always false: every found word is saved the moment it is found, so leaving loses nothing. */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
