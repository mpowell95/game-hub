// contexto/js/ui.js - the DOM shell for Contexto (docs/BUILDING-A-GAME.md, "The module contract").
// The rules and the word model live in engine.js; nothing here decides anything about ranking.
//
// isInProgress() RETURNS FALSE, DELIBERATELY. The save is written after every guess and every
// hint (root CLAUDE.md's second isInProgress() meaning, the Sudoku/Nuts & Bolts class): leaving
// mid-puzzle is lossless, so the hub has nothing to warn about.
import '../../js/theme.js';   // side effect: stamps .gh-dark so this screen themes standalone too
import { loadProfile } from '../../js/profile-store.js';
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange, getLang } from '../../js/i18n.js';
import * as gs from '../../js/game-stats.js';
import { loadModel, puzzleNumber, hintRank, band } from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.contexto.v1';
const SAVE_KEY = 'gamehub.contexto.save.v1';
const WORD_LANGS = ['en', 'es'];
const CLOSEST_PER_PAGE = 10;
const CLOSEST_MAX_RANK = 100;
const LIST_MORE_H = 24; // px reserved for the "+N more" line once truncation kicks in

const esc = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- settings + save (localStorage) -----------------------------------------------------------

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    return { v: 1, lang: WORD_LANGS.includes(v.lang) ? v.lang : null };
  } catch { return { v: 1, lang: null }; }
}
function saveSettings(lang) {
  const next = { v: 1, lang };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (err) { console.error('[contexto] settings', err); }
  return next;
}

function loadSave() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {};
    return { v: 1, games: (v.games && typeof v.games === 'object') ? v.games : {} };
  } catch { return { v: 1, games: {} }; }
}
function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { console.error('[contexto] save', err); }
}
const gameKey = (lang, word) => `${lang}:${word}`;

// --- model cache (per session; avoids re-fetching ~3.7MB on every hub navigation) --------------

const MODEL_CACHE = new Map();
function loadModelCached(lang) {
  if (!MODEL_CACHE.has(lang)) {
    MODEL_CACHE.set(lang, loadModel(lang).catch((err) => { MODEL_CACHE.delete(lang); throw err; }));
  }
  return MODEL_CACHE.get(lang);
}

// --- pure-ish helpers over a loaded model + save -----------------------------------------------

/** { status: 'new'|'progress'|'solved'|'gave', guesses } for puzzle n under this word-lang. */
function puzzleStatus(model, lang, save, n) {
  const secret = model.secretFor(n);
  const word = model.words[secret];
  const rec = save.games[gameKey(lang, word)];
  if (!rec || !rec.guesses || !rec.guesses.length) return { status: 'new' };
  if (rec.done === 'won') return { status: 'solved', guesses: rec.guesses.filter((g) => !g.hint).length };
  if (rec.done === 'gave') return { status: 'gave' };
  return { status: 'progress', guesses: rec.guesses.length };
}

function nextUnplayedEarlier(model, lang, save, fromN) {
  for (let n = fromN - 1; n >= 1; n--) if (puzzleStatus(model, lang, save, n).status === 'new') return n;
  return null;
}

function randomUnfinished(model, lang, save, uptoN) {
  const pool = [];
  for (let n = 1; n <= uptoN; n++) {
    const s = puzzleStatus(model, lang, save, n).status;
    if (s === 'new' || s === 'progress') pool.push(n);
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Bar width on a log scale: closer ranks (small numbers) fill more of the bar. */
function barPct(rank, size) {
  if (!rank || rank <= 1) return 100;
  const pct = (1 - Math.log(rank) / Math.log(Math.max(2, size))) * 100;
  return Math.max(4, Math.min(100, pct));
}

const BAND_COLOR = { close: '#178A7A', near: '#F2B705', far: '#E0532F' };

/** Shape marker per closeness band - never color alone (root CLAUDE.md, colorblind rule).
 *  `cls` defaults to `ct-shape`, which is sized by CSS (real DOM guess rows, where 1 CSS px is 1
 *  screen px). Pass `cls: ''` for a shape nested inside ANOTHER svg's own viewBox (the how-to
 *  diagram): a CSS pixel size on a nested <svg> element is resolved against the ANCESTOR svg's
 *  scale factor, not its local viewBox units, which mismatched and made the diagram's markers
 *  overlap the row above/below - explicit width/height attributes (local viewBox units) are what
 *  a nested <svg> needs instead, and CSS would win over them if the class stayed applied. */
function bandShapeSVG(b, cls = 'ct-shape', size = 16) {
  const c = BAND_COLOR[b] || BAND_COLOR.far;
  const clsAttr = cls ? ` class="${cls}"` : '';
  const sizeAttr = cls ? '' : ` width="${size}" height="${size}"`;
  if (b === 'close') return `<svg${clsAttr}${sizeAttr} viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 L15 8 L8 15 L1 8 Z" fill="${c}"/></svg>`;
  if (b === 'near') return `<svg${clsAttr}${sizeAttr} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="${c}"/></svg>`;
  return `<svg${clsAttr}${sizeAttr} viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="${c}"/></svg>`;
}

const ICON_HINT = '<svg class="ct-hicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.4c0 1.6-2.1 1.9-2.1 3.6"/><path d="M12 17.5v.01"/></svg>';
const ICON_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.7 2.7 0 0 1 5.1 1.3c0 1.8-2.4 2.1-2.4 4"/><path d="M12 17.6v.01"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5z"/></svg>';

class ContextoUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.profile = (() => { try { return loadProfile(); } catch { return null; } })();
    this.settings = loadSettings();
    this.lang = this.settings.lang || getLang();
    if (!this.settings.lang) this.settings = saveSettings(this.lang);
    this.save = loadSave();
    this.model = null;
    this.screen = 'loading'; // 'loading' | 'error' | 'play'
    this._overlay = null; // 'howto' | 'previous' | 'result' | 'giveup' | null
    this._msg = '';
    this._lastGuess = null;
    this._prevViewedN = null;

    this._onOnline = () => { if (this.screen === 'error') this._loadModel(); };
    window.addEventListener('online', this._onOnline);

    this.renderShell();
    this._loadModel();
  }

  // --- loading / error -------------------------------------------------------------------------

  async _loadModel() {
    this.screen = 'loading';
    this.renderShell();
    try {
      this.model = await loadModelCached(this.lang);
    } catch (err) {
      if (this._dead) return;
      console.error('[contexto] model load failed', err);
      this.screen = 'error';
      this.renderShell();
      return;
    }
    if (this._dead) return;
    this._enterPuzzle(puzzleNumber(new Date()));
  }

  _switchLang() {
    const next = this.lang === 'en' ? 'es' : 'en';
    this.lang = next;
    this.settings = saveSettings(next);
    const n = this.n || puzzleNumber(new Date());
    this.screen = 'loading';
    this.renderShell();
    loadModelCached(next).then((model) => {
      if (this._dead) return;
      this.model = model;
      this._enterPuzzle(n);
    }).catch((err) => {
      if (this._dead) return;
      console.error('[contexto] model load failed', err);
      this.screen = 'error';
      this.renderShell();
    });
  }

  // --- entering a puzzle -------------------------------------------------------------------------

  _enterPuzzle(n) {
    this.n = n;
    this.secret = this.model.secretFor(n);
    this.word = this.model.words[this.secret];
    this.key = gameKey(this.lang, this.word);
    if (!this.save.games[this.key]) this.save.games[this.key] = { n, guesses: [], done: null, recorded: false };
    this.rec = this.save.games[this.key];
    this.rec.n = n;
    writeSave(this.save);
    this._msg = '';
    this._lastGuess = null;
    this.screen = 'play';
    this._overlay = null;
    this.renderShell();
  }

  // --- guess mechanics -------------------------------------------------------------------------

  _rankedGuesses() {
    return this.rec.guesses.map((g) => {
      const idx = this.model.lookup(g.w);
      const rank = idx >= 0 ? this.model.rankOf(this.secret, idx) : null;
      return { w: g.w, hint: !!g.hint, rank };
    });
  }

  _bestRank() {
    let best = 0;
    for (const g of this._rankedGuesses()) if (g.rank != null && (!best || g.rank < best)) best = g.rank;
    return best;
  }

  _takenRanks() {
    const s = new Set();
    for (const g of this._rankedGuesses()) if (g.rank != null) s.add(g.rank);
    return s;
  }

  _persist() { writeSave(this.save); }

  submitGuess(raw) {
    const text = String(raw || '').trim();
    if (!text || !this.model) return;
    const idx = this.model.lookup(text);
    if (idx < 0) { this._msg = t('msg_unknown', { word: text }); this.renderPlay(); return; }
    const canon = this.model.words[idx];
    if (this.rec.guesses.some((g) => g.w === canon)) { this._msg = t('msg_already', { word: canon }); this.renderPlay(); return; }
    const inflected = text.toLowerCase() !== canon;
    this.rec.guesses.push({ w: canon, hint: false });
    this._lastGuess = canon;
    this._msg = inflected ? t('msg_inflected', { input: text, word: canon }) : '';
    this._persist();
    const rank = this.model.rankOf(this.secret, idx);
    if (rank === 1) { this._finish('won'); return; }
    this.renderPlay();
  }

  doHint() {
    if (!this.model) return;
    const best = this._bestRank();
    const taken = this._takenRanks();
    const hr = hintRank(best, taken);
    if (hr == null) { this._msg = t('msg_hint_none'); this.renderPlay(); return; }
    const w = this.model.wordAt(this.secret, hr);
    this.rec.guesses.push({ w, hint: true });
    this._lastGuess = w;
    this._msg = '';
    this._persist();
    this.renderPlay();
  }

  _finish(kind) {
    this.rec.done = kind === 'won' ? 'won' : 'gave';
    this._persist();
    if (!this.rec.recorded) {
      this.rec.recorded = true;
      this._persist();
      const guesses = this.rec.guesses.filter((g) => !g.hint).length;
      const hints = this.rec.guesses.filter((g) => g.hint).length;
      try { gs.recordContexto?.(this.lang, kind === 'won', { guesses, hints }); }
      catch (err) { console.error('[contexto] recordContexto', err); }
    }
    this._overlay = 'result';
    this.renderShell();
  }

  _playAnother() {
    const n = nextUnplayedEarlier(this.model, this.lang, this.save, this.n);
    if (n == null) return;
    this._enterPuzzle(n);
  }

  // --- render: shell dispatch --------------------------------------------------------------------

  renderShell() {
    if (this.screen === 'loading') return this.renderLoading();
    if (this.screen === 'error') return this.renderErrorScreen();
    return this.renderPlay();
  }

  renderLoading() {
    this.container.innerHTML = `
      <div class="ct-root ct-center">
        <div class="ct-spinner" aria-hidden="true"></div>
        <p>${esc(t('loading'))}</p>
      </div>`;
    this.root = this.container.querySelector('.ct-root');
    this._positionRoot();
  }

  renderErrorScreen() {
    this.container.innerHTML = `
      <div class="ct-root ct-center">
        <p>${esc(t('load_error'))}</p>
        <button type="button" class="gh-btn gh-btn--primary" data-action="retry">${esc(t('try_again'))}</button>
      </div>`;
    this.root = this.container.querySelector('.ct-root');
    this._positionRoot();
    this.root.querySelector('[data-action="retry"]').addEventListener('click', () => this._loadModel());
  }

  // --- render: the one game screen ----------------------------------------------------------------

  renderPlay() {
    const rec = this.rec;
    const guessCount = rec.guesses.filter((g) => !g.hint).length;
    const hintCount = rec.guesses.filter((g) => g.hint).length;
    const ranked = this._rankedGuesses();
    const sorted = ranked.slice().sort((a, b) => (a.rank == null ? Infinity : a.rank) - (b.rank == null ? Infinity : b.rank));
    this._sortedGuesses = sorted;
    const latest = this._lastGuess ? ranked.find((g) => g.w === this._lastGuess) : null;

    this.container.innerHTML = `
      <div class="ct-root">
        <div class="ct-info">
          <span class="ct-pnum">${esc(t('puzzle_label', { n: this.n }))}</span>
          <span class="ct-stat">${esc(t('guesses_short', { n: guessCount }))}</span>
          <span class="ct-stat">${esc(t('hints_short', { n: hintCount }))}</span>
          <button type="button" class="ct-langchip" data-action="lang"
            aria-label="${esc(t('lang_chip_aria', { lang: this.lang.toUpperCase() }))}">${esc(this.lang.toUpperCase())}</button>
          <button type="button" class="ct-iconbtn" data-action="howto" aria-label="${esc(t('howto_aria'))}">${ICON_HELP}</button>
        </div>

        <form class="ct-inputrow" data-role="form">
          <input type="text" class="ct-input" data-role="input" autocapitalize="off" autocomplete="off"
            autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text"
            placeholder="${esc(t('input_placeholder'))}" aria-label="${esc(t('input_aria'))}">
          <button type="submit" class="gh-btn gh-btn--primary">${esc(t('go'))}</button>
        </form>
        <p class="ct-msg" data-role="msg">${esc(this._msg || '')}</p>

        <div class="ct-latest" data-role="latest" ${latest ? '' : 'hidden'}>
          ${latest ? this._rowHTML(latest, true) : ''}
        </div>

        <div class="ct-listwrap" data-role="listwrap">
          <div class="ct-list" data-role="list">
            ${sorted.map((g) => this._rowHTML(g, false)).join('')}
          </div>
          <p class="ct-more" data-role="more" hidden></p>
        </div>

        <div class="ct-actions">
          <button type="button" class="gh-btn ct-actbtn" data-action="hint">${ICON_HINT}<span>${esc(t('action_hint'))}</span></button>
          <button type="button" class="gh-btn ct-actbtn" data-action="giveup">${esc(t('action_giveup'))}</button>
          <button type="button" class="gh-btn ct-actbtn" data-action="previous">${ICON_BOOK}<span>${esc(t('action_previous'))}</span></button>
        </div>
      </div>`;

    this.root = this.container.querySelector('.ct-root');
    this._positionRoot();
    this.el = {
      form: this.root.querySelector('[data-role="form"]'),
      input: this.root.querySelector('[data-role="input"]'),
      listwrap: this.root.querySelector('[data-role="listwrap"]'),
      list: this.root.querySelector('[data-role="list"]'),
      more: this.root.querySelector('[data-role="more"]'),
    };
    this.el.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = this.el.input.value;
      this.el.input.value = '';
      this.submitGuess(v);
    });
    this.root.querySelector('[data-action="lang"]').addEventListener('click', () => this._switchLang());
    this.root.querySelector('[data-action="howto"]').addEventListener('click', () => this.openHowTo());
    this.root.querySelector('[data-action="hint"]').addEventListener('click', () => this.doHint());
    this.root.querySelector('[data-action="giveup"]').addEventListener('click', () => this.openGiveUp());
    this.root.querySelector('[data-action="previous"]').addEventListener('click', () => this.openPrevious());

    requestAnimationFrame(() => this._rebuildList());

    if (this._overlay === 'result') this.openResult();
    else if (this._overlay === 'howto') this.openHowTo();
    else if (this._overlay === 'previous') this.openPrevious();
    else if (this._overlay === 'giveup') this.openGiveUp();
  }

  _rowHTML(g, isLatest) {
    const size = this.model.size;
    const b = g.rank != null ? band(g.rank) : 'far';
    const pct = g.rank != null ? barPct(g.rank, size) : 4;
    return `
      <div class="ct-row${isLatest ? ' ct-row--latest' : ''}" role="listitem"
        aria-label="${esc(g.w)}, ${g.rank != null ? esc(t('rank_aria', { rank: g.rank })) : ''}">
        <div class="ct-bar" style="width:${pct}%; background:${BAND_COLOR[b]}22;"></div>
        ${bandShapeSVG(b)}
        <span class="ct-word">${esc(g.w)}</span>
        ${g.hint ? `<span class="ct-hintmark" aria-label="${esc(t('hint_icon_aria'))}">${ICON_HINT}</span>` : ''}
        <span class="ct-rank">${g.rank != null ? g.rank : '?'}</span>
      </div>`;
  }

  /** Measure-then-trim, per docs/BUILDING-A-GAME.md Part 3: rebuild the FULL sorted list, then
   *  remove rows from the bottom until it fits the box it was actually given, showing "+N more"
   *  for what was trimmed. Never lets the list scroll (root CLAUDE.md's no-scroll rule).
   *  Rebuilds from `this._sortedGuesses` rather than trimming in place, so a later call (e.g. the
   *  viewport growing on rotation) can bring previously-trimmed rows back instead of the list only
   *  ever shrinking. */
  _rebuildList() {
    if (this._dead || !this.el || !this.el.list || !this.el.listwrap || !this._sortedGuesses) return;
    this.el.list.innerHTML = this._sortedGuesses.map((g) => this._rowHTML(g, false)).join('');
    this._layoutList();
  }

  _layoutList() {
    if (this._dead || !this.el || !this.el.list || !this.el.listwrap) return;
    const wrap = this.el.listwrap, list = this.el.list, more = this.el.more;
    if (!list.children.length) return;
    more.hidden = true;
    let removed = 0;
    const avail = () => wrap.clientHeight - (removed > 0 ? LIST_MORE_H : 0);
    while (list.children.length > 1 && list.scrollHeight > avail()) {
      list.removeChild(list.lastElementChild);
      removed++;
    }
    if (removed > 0) { more.hidden = false; more.textContent = t('list_more', { n: removed }); }
  }

  // --- overlays: how to play, previous games, give-up confirm, result -------------------------

  _openOverlay(html, onMount) {
    this.closeOverlay();
    const wrap = document.createElement('div');
    wrap.className = 'gh-overlay ct-overlay';
    wrap.dataset.role = 'overlay';
    wrap.innerHTML = html;
    this.root.appendChild(wrap);
    this._overlayEl = wrap;
    wrap.addEventListener('click', (ev) => { if (ev.target === wrap) this.closeOverlay(); });
    wrap.querySelectorAll('[data-action="close-overlay"]').forEach((el) => el.addEventListener('click', () => this.closeOverlay()));
    if (onMount) onMount(wrap);
  }

  closeOverlay() {
    if (this._overlayEl) { this._overlayEl.remove(); this._overlayEl = null; }
    this._overlay = null;
  }

  openHowTo() {
    this._overlay = 'howto';
    this._openOverlay(`
      <div class="gh-modal ct-howto" role="dialog" aria-modal="true">
        <button type="button" class="gh-modal__close" data-action="close-overlay" aria-label="${esc(t('close_aria'))}">&times;</button>
        <p class="ct-howto-goal"><b>${esc(t('howto_goal'))}</b></p>
        <div class="ct-howto-diagram">${this._howToDiagramSVG()}</div>
        <p class="ct-howto-caption">${esc(t('howto_caption'))}</p>
        <p class="ct-howto-example">${esc(t('howto_example'))}</p>
        <p class="ct-howto-edge">${esc(t('howto_edge_new'))}</p>
        <p class="ct-howto-edge">${esc(t('howto_edge_plural'))}</p>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="close-overlay">${esc(t('howto_close'))}</button>
      </div>`);
  }

  _howToDiagramSVG() {
    // Real rank numbers, not arbitrary example words - a lower number sitting on a fuller bar is
    // exactly the "closer meaning = lower rank" rule the caption states, with no dependency on
    // any specific secret (that concrete example is the separate "Secret cat: dog = rank 3" line).
    const rows = [
      { b: 'close', pct: 88, label: '3' },
      { b: 'near', pct: 46, label: '40' },
      { b: 'far', pct: 10, label: '900' },
    ];
    const rowH = 22, gap = 6, shapeSize = 15;
    const body = rows.map((r, i) => {
      const y = i * (rowH + gap);
      return `<rect x="0" y="${y}" width="200" height="${rowH}" rx="6" fill="var(--ct-surface-2)"/>
        <rect x="0" y="${y}" width="${r.pct * 2}" height="${rowH}" rx="6" fill="${BAND_COLOR[r.b]}33"/>
        <g transform="translate(8, ${y + (rowH - shapeSize) / 2})">${bandShapeSVG(r.b, '', shapeSize)}</g>
        <text x="30" y="${y + rowH / 2 + 4}" font-size="12" fill="var(--ct-ink)">${r.label}</text>`;
    }).join('');
    const h = rows.length * (rowH + gap) - gap;
    return `<svg viewBox="0 0 200 ${h}" role="img" aria-label="${esc(t('howto_diagram_aria'))}">${body}</svg>`;
  }

  openGiveUp() {
    this._overlay = 'giveup';
    this._openOverlay(`
      <div class="gh-modal" role="dialog" aria-modal="true">
        <button type="button" class="gh-modal__close" data-action="close-overlay" aria-label="${esc(t('close_aria'))}">&times;</button>
        <h2 class="gh-modal__title">${esc(t('giveup_confirm_title'))}</h2>
        <p>${esc(t('giveup_confirm_body'))}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn" data-action="close-overlay">${esc(t('cancel'))}</button>
          <button type="button" class="gh-btn gh-btn--danger" data-action="confirm-giveup">${esc(t('confirm_giveup'))}</button>
        </div>
      </div>`, (wrap) => {
      wrap.querySelector('[data-action="confirm-giveup"]').addEventListener('click', () => {
        this.closeOverlay();
        this._finish('gave');
      });
    });
  }

  openResult() {
    this._overlay = 'result';
    this._resultPage = 0;
    this._openOverlay('', () => {});
    this._renderResult();
  }

  _renderResult() {
    const rec = this.rec;
    const guesses = rec.guesses.filter((g) => !g.hint).length;
    const hints = rec.guesses.filter((g) => g.hint).length;
    const name = this.profile && this.profile.name;
    const titleKey = rec.done === 'won' ? 'win_title' : 'gave_title';
    const detail = name
      ? t('result_detail_named', { name, n: this.n, guesses, hints })
      : t('result_detail', { n: this.n, guesses, hints });
    const from = this._resultPage * CLOSEST_PER_PAGE + 1;
    const to = Math.min(from + CLOSEST_PER_PAGE - 1, CLOSEST_MAX_RANK);
    const rows = [];
    for (let r = from; r <= to; r++) rows.push(`<div class="ct-crow"><span class="ct-crank">${r}</span><span class="ct-cword">${esc(this.model.wordAt(this.secret, r))}</span></div>`);
    const canPrev = from > 1, canNext = to < CLOSEST_MAX_RANK;
    const another = nextUnplayedEarlier(this.model, this.lang, this.save, this.n);

    this._overlayEl.innerHTML = `
      <div class="gh-modal ct-result" role="dialog" aria-modal="true">
        <button type="button" class="gh-modal__close" data-action="close-overlay" aria-label="${esc(t('close_aria'))}">&times;</button>
        <h2 class="gh-modal__title">${esc(t(titleKey))}</h2>
        <p class="ct-result-word">${esc(t('result_word', { word: this.word }))}</p>
        <p class="ct-result-detail">${esc(detail)}</p>
        <p class="ct-closest-title">${esc(t('closest_words'))}</p>
        <div class="ct-closest-grid">${rows.join('')}</div>
        <div class="ct-pager">
          <button type="button" class="gh-btn--icon gh-btn" data-action="page-prev" aria-label="${esc(t('page_prev_aria'))}" ${canPrev ? '' : 'disabled'}>&larr;</button>
          <span class="ct-page-label">${esc(t('page_label', { from, to }))}</span>
          <button type="button" class="gh-btn--icon gh-btn" data-action="page-next" aria-label="${esc(t('page_next_aria'))}" ${canNext ? '' : 'disabled'}>&rarr;</button>
        </div>
        ${another != null ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="play-another">${esc(t('play_another'))}</button>` : `<p class="ct-nomore">${esc(t('no_more_puzzles'))}</p>`}
      </div>`;
    this._overlayEl.querySelector('[data-action="close-overlay"]').addEventListener('click', () => this.closeOverlay());
    const prevBtn = this._overlayEl.querySelector('[data-action="page-prev"]');
    const nextBtn = this._overlayEl.querySelector('[data-action="page-next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (this._resultPage > 0) { this._resultPage--; this._renderResult(); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (to < CLOSEST_MAX_RANK) { this._resultPage++; this._renderResult(); } });
    const againBtn = this._overlayEl.querySelector('[data-action="play-another"]');
    if (againBtn) againBtn.addEventListener('click', () => { this.closeOverlay(); this._playAnother(); });
  }

  openPrevious() {
    this._overlay = 'previous';
    this._prevViewedN = this.n;
    this._openOverlay('', () => {});
    this._renderPrevious();
  }

  _renderPrevious() {
    const todayN = puzzleNumber(new Date());
    const n = Math.min(Math.max(1, this._prevViewedN), todayN);
    this._prevViewedN = n;
    const st = puzzleStatus(this.model, this.lang, this.save, n);
    const statusText = st.status === 'new' ? t('status_new')
      : st.status === 'progress' ? t('status_progress', { n: st.guesses })
      : st.status === 'solved' ? t('status_solved', { n: st.guesses })
      : t('status_gave');
    this._overlayEl.innerHTML = `
      <div class="gh-modal ct-previous" role="dialog" aria-modal="true">
        <button type="button" class="gh-modal__close" data-action="close-overlay" aria-label="${esc(t('close_aria'))}">&times;</button>
        <h2 class="gh-modal__title">${esc(t('previous_games_title'))}</h2>
        <div class="ct-stepper">
          <button type="button" class="gh-btn--icon gh-btn" data-action="step-prev" aria-label="${esc(t('stepper_prev_aria'))}" ${n <= 1 ? 'disabled' : ''}>&larr;</button>
          <span class="ct-stepper-n">${esc(t('puzzle_label', { n }))}</span>
          <button type="button" class="gh-btn--icon gh-btn" data-action="step-next" aria-label="${esc(t('stepper_next_aria'))}" ${n >= todayN ? 'disabled' : ''}>&rarr;</button>
        </div>
        <p class="ct-prev-status">${esc(statusText)}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn" data-action="random">${esc(t('random_btn'))}</button>
          <button type="button" class="gh-btn gh-btn--primary" data-action="play">${esc(t('play_btn'))}</button>
        </div>
      </div>`;
    this._overlayEl.querySelector('[data-action="close-overlay"]').addEventListener('click', () => this.closeOverlay());
    const prevBtn = this._overlayEl.querySelector('[data-action="step-prev"]');
    const nextBtn = this._overlayEl.querySelector('[data-action="step-next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (n > 1) { this._prevViewedN = n - 1; this._renderPrevious(); } });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (n < todayN) { this._prevViewedN = n + 1; this._renderPrevious(); } });
    this._overlayEl.querySelector('[data-action="random"]').addEventListener('click', () => {
      const r = randomUnfinished(this.model, this.lang, this.save, todayN);
      if (r != null) { this._prevViewedN = r; this._renderPrevious(); }
    });
    this._overlayEl.querySelector('[data-action="play"]').addEventListener('click', () => {
      this.closeOverlay();
      this._enterPuzzle(n);
    });
  }

  // --- layout: one screen, no scrolling ---------------------------------------------------------

  /** Same technique as sudoku/js/ui.js `_positionRoot()`: pins `.ct-root` to the REAL on-screen
   *  box of `this.container` (`#contexto` standalone, `.hub-game` mounted) by measurement, since
   *  a CSS-only `inset: 0` has no defined box to fill inside the hub's mount point. */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    this.root.style.top = Math.round(r.top) + 'px';
    this.root.style.height = Math.max(200, Math.round(vh - r.top)) + 'px';
  }

  destroy() {
    this._dead = true;
    window.removeEventListener('online', this._onOnline);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this._offLang) { this._offLang(); this._offLang = null; }
    this.container.innerHTML = '';
  }

  /** Autosave/resume built in (root CLAUDE.md's second isInProgress() meaning): the save is
   *  written after every guess and every hint, so leaving mid-puzzle is lossless. */
  isInProgress() { return false; }
}

// --- the module contract ---------------------------------------------------------------------

let instance = null;

function ensureStylesheet() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-contexto-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/contexto.css', import.meta.url).href;
  link.setAttribute('data-contexto-css', '1');
  document.head.appendChild(link);
}

export function init(container) {
  ensureStylesheet();
  if (instance) instance.destroy();
  instance = new ContextoUI(container);
  instance._offViewport = onViewportResize(() => {
    instance._positionRoot();
    if (instance.screen === 'play') instance._rebuildList();
  });
  instance._offLang = onLangChange(() => {
    if (instance.screen === 'play') instance.renderPlay();
  });
  return instance;
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() { return instance ? instance.isInProgress() : false; }

export default { init, destroy, isInProgress };
