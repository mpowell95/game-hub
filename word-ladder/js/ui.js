// word-ladder/js/ui.js - Word Ladder: turn a start word into a target word, one letter at a time. Module entry
// (init / destroy / isInProgress). The rules are in engine.js (pure); this file draws, saves and records.
//
// isInProgress(): always false. Every move is saved at once (gamehub.wordladder.save.v1 / .daily.v1), so leaving is
// lossless and the level resumes where it was.
//
// Screens: setup (title, stars, EN/ES, Play <n>, Daily, How to play), play (the ladder, the word being changed, the
// target, Undo, Hint, a keyboard), done (a card with an X: level, stars, moves and par, Next / Back).
// RECORDING (THE LAW): the recorder runs FIRST when the target is reached, inside withMode; `recorded` is saved only
// after it returned the store. A refused record (rate gate) stays `recorded: false` and is retried on every open.

import * as E from './engine.js';
import STRINGS from './strings.js';
import { makeT, getLang } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordWordLadder, recordWordLadderDaily, withMode, loadStats } from '../../js/game-stats.js';
import { bestNow, startServerTime } from '../../js/server-time.js';
import { loadProfile } from '../../js/profile-store.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.wordladder.v1';            // settings: { lang }
const SAVE_KEY = 'gamehub.wordladder.save.v1';  // { en: attempt | null, es: attempt | null }
const DAILY_KEY = 'gamehub.wordladder.daily.v1';// { v: 1, d: { '<en|es>-<YYYY-MM-DD>': attempt } }
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KB = {
  en: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  es: ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM'],
};
const SVG = {
  back: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 7L4 12l5 5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 12H14a5 5 0 010 10h-2" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>',
  hint: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z" fill="currentColor"/><rect x="9" y="17.5" width="6" height="2.2" rx="1" fill="currentColor"/><rect x="10" y="20.6" width="4" height="1.8" rx=".9" fill="currentColor"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 21V4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M6 4h11l-2.5 4L17 12H6" fill="currentColor"/></svg>',
};
const starSVG = (on) => `<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z" fill="${on ? '#f2b705' : 'none'}" stroke="${on ? '#8a6500' : 'currentColor'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

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
  } catch (err) { console.error('[word-ladder] progress NOT saved', key, err); return false; }
}
function loadSettings() { return readJSON(KEY, {}); }
/** Settings are { lang, seen } (seen = How to play shown once on this device, a preference). */
function saveSettings(patch) { return writeJSON(KEY, { ...loadSettings(), ...patch }); }
function loadLang() {
  const s = readJSON(KEY, {});
  return s.lang === 'es' || s.lang === 'en' ? s.lang : (getLang() === 'es' ? 'es' : 'en');
}
function wlRec() {
  try { return ((loadStats().games || {}).wordladder || {}).wl || {}; } catch { return {}; }
}
/** 'YYYY-MM-DD' (LOCAL date) and the day number from the data's epoch: Spelling Bee's / Word Weaver's day. */
function dayKey(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function dayNumber(epoch, d) {
  const [y, m, dd] = String(epoch).split('-').map(Number);
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(y, m - 1, dd)) / 86400000);
}

// --- data (fetched once per language; LAZY) ---------------------------------------------------------------------
const _data = {};
async function loadData(lang) {
  if (_data[lang]) return _data[lang];
  const get = async (f) => {
    const r = await fetch(new URL(`../data/${lang}/${f}`, import.meta.url));
    if (!r.ok) throw new Error(`${f} ${r.status}`);
    return r.json();
  };
  const [words, levels, daily] = await Promise.all([get('words.json'), get('levels.json'), get('daily.json')]);
  const d = { dict: E.makeDict(words), levels: levels.levels || [], daily, alpha: E.ALPHABET[lang] };
  _data[lang] = d;
  return d;
}

class WordLadder {
  constructor(host) {
    this.host = host;
    this.lang = loadLang();
    this.cur = null;     // { kind: 'ladder'|'daily', n, key, level, chain, moves, hints, sel, recorded }
    this.dist = null;
    this._ensureCss();
    this.root = document.createElement('div');
    this.root.className = 'wl-root';
    host.appendChild(this.root);
    this._onClick = (e) => this._click(e);
    this._onKey = (e) => this._key(e);
    this.root.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    this._offResize = onViewportResize(() => (this.screen === 'done' ? this._fitFinal() : this._fit()));
    try { startServerTime(); } catch { /* the day falls back to the phone's clock */ }
    this._repair1113();
    this._flushAll();
    this._setup();
  }

  _ensureCss() {
    if (document.querySelector('link[data-wl-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../css/word-ladder.css', import.meta.url).href;
    l.setAttribute('data-wl-css', '');
    document.head.appendChild(l);
  }

  // --- progress ---------------------------------------------------------------------------------------------
  _saves() { return readJSON(SAVE_KEY, {}); }
  _map(lang) { const wl = wlRec(); return (lang === 'es' ? wl.es : wl.lv) || {}; }
  /** The level to play: the attempt in progress, else one past the highest completed. */
  _nextN(lang) {
    const a = this._saves()[lang];
    const map = this._map(lang);
    let top = 0;
    for (const k of Object.keys(map)) { const n = Number(k.slice(1)); if (Number.isInteger(n) && n > top) top = n; }
    if (a && Number.isInteger(a.n) && a.n >= 1) {
      if (!(a.done && a.recorded) && !map['L' + a.n]) return Math.max(a.n, 1);
      top = Math.max(top, a.n);
    }
    return top + 1;
  }
  _totalStars() {
    const wl = wlRec();
    let n = 0;
    for (const m of [wl.lv, wl.es]) if (m && typeof m === 'object') for (const e of Object.values(m)) n += (e && e.s) | 0;
    return n;
  }
  _todayKey(lang) { return `${lang}-${dayKey(new Date(bestNow()))}`; }
  _dailyDone(lang) {
    const k = this._todayKey(lang);
    const a = (readJSON(DAILY_KEY, { d: {} }).d || {})[k];
    return !!((a && a.done) || ((wlRec().dl || {})[k]));
  }

  /** ONE-TIME REPAIR (2026-11-13), Matt's code only: his daily KICK LICK LICE LIVE LOVE was saved and recorded as 5 moves
   *  (one move carried over from the old LIES puzzle; cleanAttempt now drops such saves). The save is set to 4 moves and
   *  the result recorded again: recordWordLadderDaily only IMPROVES the day's entry (stars 2 -> 3, moves 5 -> 4), no new
   *  play is counted. Stamped once done, verified by a fresh re-read of the stats entry; nothing else is touched. */
  _repair1113() {
    const STAMP = 'gamehub.wordladder.repair1113.v1';
    try {
      if (localStorage.getItem(STAMP)) return;
      const p = loadProfile();
      if (!p || p.playerId !== 'QZCC4') return;
      const key = 'en-2026-11-13';
      const all = readJSON(DAILY_KEY, { d: {} });
      const a = (all.d || {})[key];
      if (!a || !a.done || (a.moves | 0) !== 5 || (a.hints | 0) !== 0 || (a.chain || []).join(' ') !== 'KICK LICK LICE LIVE LOVE') return;
      const fixed = { kind: 'daily', key, lang: 'en', ...a, s: 'KICK', p: 4, moves: 4, recorded: false };
      this._saveAttempt(fixed);
      if (!this._record(fixed)) { console.error('[word-ladder] repair1113: not recorded yet, tried again on the next open'); return; }
      const e = ((wlRec().dl || {})[key]) || {};
      if ((e.m | 0) !== 4 || (e.s | 0) !== 3) { console.error('[word-ladder] repair1113: entry did not read back', e); return; }
      localStorage.setItem(STAMP, String(Date.now()));
    } catch (err) { console.error('[word-ladder] repair1113 failed; nothing stamped, tried again on the next open', err); }
  }

  /** Every finished attempt the recorder has not taken yet, recorded now (both languages, ladder and daily). */
  _flushAll() {
    const saves = this._saves();
    for (const lang of ['en', 'es']) {
      const a = saves[lang];
      if (a && a.done && !a.recorded && Number.isInteger(a.n)) this._record({ kind: 'ladder', lang, ...a }, true);
    }
    const all = readJSON(DAILY_KEY, { v: 1, d: {} });
    for (const [k, a] of Object.entries(all.d || {})) if (a && a.done && !a.recorded) this._record({ kind: 'daily', key: k, lang: k.slice(0, 2), ...a }, true);
  }
  /** Record a finished attempt. Returns true once the recorder took it. */
  _record(a, quiet) {
    let res = null;
    try {
      if (a.kind === 'daily') {
        res = withMode(() => ({ mode: 'daily', lang: a.lang }), 'daily', () => recordWordLadderDaily(a.key, { moves: a.moves, par: a.p, hints: a.hints }),
          { detail: () => ({ moves: a.moves, par: a.p, hints: a.hints }) });
      } else {
        res = withMode(() => ({ mode: 'ladder', lang: a.lang }), () => E.bandOf(a.n), () => recordWordLadder(a.n, { moves: a.moves, par: a.p, hints: a.hints, lang: a.lang, band: E.bandOf(a.n) }),
          { detail: () => ({ moves: a.moves, par: a.p, hints: a.hints }) });
      }
    } catch (err) { console.error('[word-ladder] result NOT recorded yet, retried on the next open', err); res = null; }
    if (!res) { if (!quiet) console.error('[word-ladder] the recorder refused the result; kept as not recorded, retried on the next open'); return false; }
    this._saveAttempt({ ...a, recorded: true });
    return true;
  }
  _saveAttempt(a) {
    const rec = { v: 1, n: a.n, s: a.level ? a.level.s : a.s, p: a.p, chain: a.chain, moves: a.moves, hints: a.hints, sel: a.sel | 0, done: !!a.done, recorded: !!a.recorded };
    if (a.kind === 'daily') {
      const all = readJSON(DAILY_KEY, { v: 1, d: {} });
      if (!all.d || typeof all.d !== 'object') all.d = {};
      all.v = 1;
      all.d[a.key] = rec;
      return writeJSON(DAILY_KEY, all);
    }
    const s = this._saves();
    s[a.lang] = rec;
    return writeJSON(SAVE_KEY, s);
  }

  // --- screens ----------------------------------------------------------------------------------------------
  _setup() {
    this.screen = 'setup';
    this.cur = null;
    const n = this._nextN(this.lang);
    const done = this._dailyDone(this.lang);
    this.root.innerHTML = `
      <div class="wl-setup">
        <div class="wl-home">
          ${heroSVG()}
          <h1 class="wl-title">${esc(t('title'))}</h1>
          <div class="wl-sub">
            <span class="wl-total" aria-label="${esc(t('total_aria', { n: this._totalStars() }))}">${starSVG(true)}<b>${this._totalStars()}</b></span>
            <button type="button" class="wl-lang" data-act="lang" aria-label="${esc(t('lang_aria'))}">${this.lang === 'es' ? 'ES' : 'EN'}</button>
          </div>
          <button type="button" class="wl-btn wl-btn-main" data-act="play">${esc(t('play_n', { n }))}</button>
          <button type="button" class="wl-btn wl-btn-daily${done ? ' is-done' : ''}" data-act="daily" aria-label="${esc(t(done ? 'daily_done_aria' : 'daily_aria'))}">${SVG.cal}<span>${esc(t('daily'))}</span>${done ? `<i class="wl-ok">${SVG.check}</i>` : ''}</button>
          <button type="button" class="wl-help" data-act="help" aria-label="${esc(t('help_aria'))}">?</button>
        </div>
      </div>`;
  }

  async _open(kind) {
    const lang = this.lang;
    this.root.innerHTML = '<div class="wl-setup"><div class="wl-home"><div class="wl-wait"></div></div></div>';
    let d;
    try { d = await loadData(lang); } catch (err) {
      console.error('[word-ladder] data not loaded', err);
      this.root.innerHTML = `<div class="wl-setup"><div class="wl-home"><p class="wl-err">${esc(t('load_failed'))}</p>
        <button type="button" class="wl-btn wl-btn-main" data-act="${kind === 'daily' ? 'daily' : 'play'}">${esc(t('retry'))}</button>
        <button type="button" class="wl-btn" data-act="setup">${esc(t('back'))}</button></div></div>`;
      return;
    }
    if (!this.root.isConnected || this.lang !== lang) return;
    let a, level, n = 0, key = '';
    if (kind === 'daily') {
      const today = new Date(bestNow());
      const dn = dayNumber(d.daily.epoch, today);
      const list = d.daily.levels || [];
      level = E.cleanLevel(list[((dn % list.length) + list.length) % list.length]);
      key = `${lang}-${dayKey(today)}`;
      a = (readJSON(DAILY_KEY, { d: {} }).d || {})[key] || null;
      n = Math.max(0, dn);
    } else {
      n = this._nextN(lang);
      if (n > d.levels.length) { this._soon(); return; }
      level = E.cleanLevel(d.levels[n - 1]);
      const s = this._saves()[lang];
      a = s && s.n === n ? s : null;
    }
    if (!level) { console.error('[word-ladder] level does not add up, not drawn', kind, n); this._soon(); return; }
    const c = E.cleanAttempt(a, level, d.dict);
    this.data = d;
    this.cur = { kind, lang, n, key, level, p: level.p, chain: c.chain, moves: c.moves, hints: c.hints, done: c.done, recorded: c.recorded, sel: 0 };
    this.cur.sel = this._firstDiff();
    this.dist = null;
    if (c.done) { if (!c.recorded) this._record(this.cur); this._done(); return; }
    this._saveAttempt(this.cur);
    this._play();
  }
  _soon() {
    this.root.innerHTML = `<div class="wl-setup"><div class="wl-home"><h1 class="wl-title">${esc(t('done_all'))}</h1>
      <button type="button" class="wl-btn wl-btn-main" data-act="setup">${esc(t('back'))}</button></div></div>`;
  }

  _word() { return this.cur.chain[this.cur.chain.length - 1]; }
  _firstDiff() {
    const w = this._word(), tg = this.cur.level.t;
    for (let i = 0; i < w.length; i++) if (w[i] !== tg[i]) return i;
    return 0;
  }

  _play() {
    this.screen = 'play';
    const c = this.cur;
    const chip = c.kind === 'daily' ? `${SVG.cal}<span>${esc(t('daily'))}</span>` : esc(t('level_n', { n: c.n }));
    const kb = KB[c.lang] || KB.en;
    this.root.innerHTML = `
      <div class="wl-game">
        <div class="wl-top"><div class="wl-chip">${chip}</div></div>
        <div class="wl-row2">
          <button type="button" class="wl-icon wl-back" data-act="setup" aria-label="${esc(t('menu_aria'))}">${SVG.back}</button>
          <div class="wl-count"><span>${esc(t('moves'))} <b data-role="moves">${c.moves}</b></span><span>${esc(t('par'))} <b>${c.p}</b></span></div>
          <button type="button" class="wl-icon wl-help2" data-act="help" aria-label="${esc(t('help_aria'))}">?</button>
        </div>
        <div class="wl-ladder" data-role="ladder"></div>
        <div class="wl-msg" data-role="msg" aria-live="polite"></div>
        <div class="wl-tools">
          <button type="button" class="wl-icon wl-tool" data-act="undo" aria-label="${esc(t('undo_aria'))}">${SVG.undo}</button>
          <button type="button" class="wl-icon wl-tool" data-act="hint" aria-label="${esc(t('hint_aria'))}">${SVG.hint}</button>
        </div>
        <div class="wl-kb" data-role="kb">${kb.map((row) => `<div class="wl-kr">${[...row].map((ch) =>
          `<button type="button" class="wl-key" data-key="${ch}" aria-label="${esc(t('key_aria', { l: ch }))}">${ch}</button>`).join('')}</div>`).join('')}</div>
      </div>`;
    this._drawLadder();
    this._fit();
    // The first time on this device, How to play opens by itself (Matt, 2026-11-13: "not clear how to play AT ALL").
    if (!loadSettings().seen) { saveSettings({ seen: 1 }); this._help(); }
  }

  /** The goal, said on the screen until the first move: "Change one letter. Get to AYE." */
  _coach() {
    const m = this.root.querySelector('[data-role="msg"]');
    if (!m || !this.cur) return;
    const on = this.cur.chain.length === 1;
    m.classList.toggle('is-coach', on);
    if (on) m.textContent = t('coach', { w: this.cur.level.t });
    else if (m.classList.contains('was-coach')) m.textContent = '';
    m.classList.toggle('was-coach', on);
  }

  /** The ladder: earlier words (small), the word being changed (big, tappable), the target (flag). */
  _drawLadder() {
    const el = this.root.querySelector('[data-role="ladder"]');
    if (!el) return;
    const c = this.cur, tg = c.level.t, w = this._word();
    const tiles = (word, cls, tap) => [...word].map((ch, i) => {
      const m = ch === tg[i] ? ' is-match' : '';
      if (!tap) return `<span class="wl-t${m}">${ch}</span>`;
      return `<button type="button" class="wl-t${m}${i === c.sel ? ' is-sel' : ''}" data-pos="${i}" aria-label="${esc(t('letter_aria', { n: i + 1, l: ch }))}"${i === c.sel ? ' aria-pressed="true"' : ''}>${ch}</button>`;
    }).join('');
    const past = c.chain.slice(0, -1);
    const maxPast = this._maxPast || 1;
    let shown = past;
    let gap = false;
    // Too many to fit: the last ones, under a ⋮ (the start word is the first of the ladder, kept in the save).
    if (past.length > maxPast) { shown = past.slice(past.length - maxPast); gap = true; }
    const rows = (gap ? '<div class="wl-more" aria-hidden="true">⋮</div>' : '') + shown.map((p) => `<div class="wl-w wl-past">${tiles(p, '', false)}</div>`).join('');
    el.innerHTML = `${rows}
      <div class="wl-w wl-now" data-role="now">${tiles(w, '', true)}</div>
      <div class="wl-link" aria-hidden="true"></div>
      <div class="wl-w wl-goal" aria-label="${esc(t('target_aria', { w: tg }))}"><i class="wl-flag">${SVG.flag}</i>${[...tg].map((ch) => `<span class="wl-t">${ch}</span>`).join('')}</div>`;
    const mv = this.root.querySelector('[data-role="moves"]');
    if (mv) mv.textContent = String(c.moves);
    const undo = this.root.querySelector('[data-act="undo"]');
    if (undo) undo.disabled = c.chain.length < 2;
    this._coach();
  }

  /** Tile size from the room the ladder has (never scrolls): the width for 5 letters and the height for its rows. */
  _fit() {
    if (this.screen !== 'play' || !this.cur) return;
    const el = this.root.querySelector('[data-role="ladder"]');
    if (!el) return;
    const len = this.cur.level.t.length;
    const H = el.clientHeight, W = el.clientWidth;
    if (!H || !W) { requestAnimationFrame(() => this._fit()); return; }
    // Rows: the word being changed (big), the link (34 with margins), the target (0.8 big), then earlier words
    // (0.62 big + 6 each) and, when some are folded away, the ⋮ row (28).
    const past = this.cur.chain.length - 1;
    const rowsFor = (b) => {
      const room = H - b - Math.round(b * 0.8) - 34;
      const per = Math.round(b * 0.62) + 6;
      const all = Math.floor(room / per);
      return all >= past ? all : Math.floor((room - 28) / per);
    };
    let big = Math.max(40, Math.min(64, Math.floor((W - 16 - (len - 1) * 8) / len)));
    while (big > 32 && rowsFor(big) < Math.min(1, past)) big -= 2;
    this.root.style.setProperty('--wl-big', big + 'px');
    this.root.style.setProperty('--wl-small', Math.round(big * 0.62) + 'px');
    const fit = Math.max(1, rowsFor(big));
    if (fit !== this._maxPast) { this._maxPast = fit; this._drawLadder(); }
  }

  _msg(text) {
    const m = this.root.querySelector('[data-role="msg"]');
    if (!m) return;
    m.textContent = text;
    clearTimeout(this._msgT);
    m.classList.remove('is-coach', 'was-coach');
    this._msgT = setTimeout(() => { if (m.isConnected) { m.textContent = ''; this._coach(); } }, 1600);
    const now = this.root.querySelector('[data-role="now"]');
    if (now) { now.classList.remove('is-shake'); void now.offsetWidth; now.classList.add('is-shake'); }
  }

  /** Change the selected letter to `ch`. */
  _letter(ch) {
    const c = this.cur;
    if (!c || this.screen !== 'play') return;
    const w = this._word();
    const next = w.slice(0, c.sel) + ch + w.slice(c.sel + 1);
    if (next === w) return;
    const why = E.checkMove(this.data.dict, w, next);
    if (why !== 'ok') { this._msg(t(why === 'word' ? 'not_word' : 'one_letter')); return; }
    this._step(next, false);
  }
  _step(next, hint) {
    const c = this.cur;
    c.chain = [...c.chain, next];
    c.moves += 1;
    if (hint) c.hints += 1;
    if (next === c.level.t) {
      c.done = true;
      c.recorded = false;
      this._saveAttempt(c);
      this._record(c);           // FIRST: before any screen (THE LAW)
      this._done();
      return;
    }
    c.sel = this._firstDiff();
    this._saveAttempt(c);
    this._drawLadder();
    this._fit();
  }
  _undo() {
    const c = this.cur;
    if (!c || c.chain.length < 2) return;
    c.chain = E.undoChain(c.chain);
    c.moves += 1;               // an undo is a move (par counts every change)
    c.sel = this._firstDiff();
    this._saveAttempt(c);
    this._drawLadder();
    this._fit();
  }
  _hint() {
    const c = this.cur;
    if (!c) return;
    if (!this.dist) this.dist = E.distancesTo(this.data.dict, c.level.t, this.data.alpha);
    const next = E.hintFrom(this.data.dict, this._word(), c.level.t, this.data.alpha, this.dist);
    if (next) this._step(next, true);
  }

  _done() {
    this.screen = 'done';
    const c = this.cur;
    const stars = E.starsFor(c.moves, c.p, c.hints);
    const head = c.kind === 'daily' ? esc(t('daily')) : esc(t('level_n', { n: c.n }));
    this.root.innerHTML = `
      <div class="wl-game wl-is-done">
        <div class="wl-ladder wl-final" data-role="final"></div>
        <div class="wl-card" role="dialog" aria-label="${head}">
          <button type="button" class="wl-icon wl-x" data-act="setup" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
          <h2 class="wl-card-h">${head}</h2>
          <div class="wl-stars" aria-label="${esc(t('stars_aria', { n: stars }))}">${[1, 2, 3].map((i) => starSVG(i <= stars)).join('')}</div>
          <div class="wl-count wl-count-card"><span>${esc(t('moves'))} <b>${c.moves}</b></span><span>${esc(t('par'))} <b>${c.p}</b></span></div>
          ${c.kind === 'daily'
            ? `<button type="button" class="wl-btn wl-btn-main" data-act="setup">${esc(t('back'))}</button>`
            : `<button type="button" class="wl-btn wl-btn-main" data-act="next">${esc(t('next'))}</button>`}
        </div>
      </div>`;
    this._fitFinal();
  }
  /** The finished ladder above the card. Tiles 30-44px; a ladder too long for the room shows its first word, a ⋮ and
   *  the last words that fit (2026-11-13 review: an 18-word ladder shrank to 16px tiles with 9px letters and overflowed). */
  _fitFinal() {
    const el = this.root.querySelector('[data-role="final"]');
    if (!el || !this.cur) return;
    const c = this.cur, chain = c.chain, len = c.level.t.length, tg = c.level.t;
    const H = el.clientHeight || 300, W = el.clientWidth || 300;
    const fitRows = (sz) => Math.floor((H + 5) / (sz + 5));
    let s = Math.max(30, Math.min(44, Math.floor((H + 5) / chain.length) - 5, Math.floor((W - 40 - (len - 1) * 8) / len)));
    let rows = chain.slice();
    if (fitRows(s) < chain.length) {
      const room = Math.max(3, Math.floor((H + 5 - 27) / (s + 5)));   // 27 = the ⋮ row and its gap
      rows = [chain[0], null, ...chain.slice(chain.length - (room - 1))];
    }
    this.root.style.setProperty('--wl-small', s + 'px');
    el.innerHTML = rows.map((w, i) => w == null ? '<div class="wl-more" aria-hidden="true">⋮</div>'
      : `<div class="wl-w ${i === rows.length - 1 ? 'wl-goal is-won' : 'wl-past'}">${[...w].map((ch, j) => `<span class="wl-t${ch === tg[j] ? ' is-match' : ''}">${ch}</span>`).join('')}</div>`).join('');
  }


  _help() {
    const prev = this.screen;
    const ov = document.createElement('div');
    ov.className = 'wl-ov';
    ov.innerHTML = `<div class="wl-sheet" role="dialog" aria-label="${esc(t('how_title'))}">
      <button type="button" class="wl-icon wl-x" data-act="close-help" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
      <h2 class="wl-card-h">${esc(t('how_title'))}</h2>
      <p class="wl-how-b">${String(t('how_goal', { flag: '\u0000' })).split('\u0000').map(esc).join(`<i class="wl-flag-in">${SVG.flag}</i>`)}</p>
      ${howSVG(String(t('how_eg')).split(' '))}
      <p class="wl-how-cap">${esc(t('how_step'))}</p>
      <p>${esc(t('how_tap'))}</p>
      <p><span class="wl-t wl-t-demo is-match">A</span> ${esc(t('how_dot'))}</p>
      <p>${esc(t('how_stars'))}</p>
      <p>${esc(t('how_hint'))}</p>
      <button type="button" class="wl-btn wl-btn-main wl-gotit" data-act="close-help">${esc(t('got_it'))}</button>
    </div>`;
    this.root.appendChild(ov);
    this.screen = 'help';
    this._helpPrev = prev;
  }

  // --- input ------------------------------------------------------------------------------------------------
  _click(e) {
    const b = e.target.closest('button');
    if (!b || !this.root.contains(b)) {
      if (e.target.classList && e.target.classList.contains('wl-ov')) this._closeHelp();
      return;
    }
    if (b.dataset.key) { this._letter(b.dataset.key); return; }
    if (b.dataset.pos != null) {
      this.cur.sel = Number(b.dataset.pos) | 0;
      this._drawLadder();
      return;
    }
    const act = b.dataset.act;
    if (act === 'play') this._open('ladder');
    else if (act === 'daily') this._open('daily');
    else if (act === 'setup') this._setup();
    else if (act === 'next') this._open('ladder');
    else if (act === 'help') this._help();
    else if (act === 'close-help') this._closeHelp();
    else if (act === 'undo') this._undo();
    else if (act === 'hint') this._hint();
    else if (act === 'lang') {
      this.lang = this.lang === 'es' ? 'en' : 'es';
      saveSettings({ lang: this.lang });
      this._setup();
    }
  }
  _closeHelp() {
    const ov = this.root.querySelector('.wl-ov');
    if (ov) ov.remove();
    this.screen = this._helpPrev || 'setup';
  }
  _key(e) {
    const tg = e.target;
    if (tg && tg.closest && (tg.closest('input, textarea, select, [contenteditable]') || (tg !== document.body && !this.root.contains(tg)))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.screen === 'help' && e.key === 'Escape') { this._closeHelp(); return; }
    if (this.screen !== 'play' || !this.cur) return;
    const len = this.cur.level.t.length;
    if (e.key === 'ArrowLeft') { this.cur.sel = (this.cur.sel + len - 1) % len; this._drawLadder(); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { this.cur.sel = (this.cur.sel + 1) % len; this._drawLadder(); e.preventDefault(); return; }
    if (e.key === 'Backspace') { this._undo(); e.preventDefault(); return; }
    const ch = String(e.key || '').toUpperCase();
    if (ch.length === 1 && (this.data.alpha || '').includes(ch)) { this._letter(ch); e.preventDefault(); }
  }

  destroy() {
    // Forget the words and levels: the hub keeps this module loaded for the life of the page, so without this a phone
    // kept a data update out until the app was closed (2026-11-13: Matt's phone refused LIEN from the old list).
    for (const k of Object.keys(_data)) delete _data[k];
    this.root.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    try { if (this._offResize) this._offResize(); } catch { /* gone */ }
    clearTimeout(this._msgT);
    this.root.remove();
  }

  _seam() {
    return {
      ui: this,
      state: () => this.cur && { ...this.cur },
      type: (w) => { const c = this.cur; const cur = this._word(); for (let i = 0; i < cur.length; i++) if (cur[i] !== w[i]) { c.sel = i; this._letter(w[i]); return; } },
      hint: () => this._hint(),
    };
  }
}

/** How to play's diagram: the example ladder top to bottom, the letter each step changes outlined in gold with
 *  an arrow between rungs, the last word marked with the flag (shape and outline, never colour alone). */
function howSVG(words) {
  const n = words.length, len = (words[0] || '').length, cell = 30, gap = 6, rowH = 42;
  const w = len * cell + (len - 1) * gap, x0 = 40, W = x0 + w + 40, H = n * rowH - (rowH - cell) + 4;
  let out = '';
  words.forEach((wd, r) => {
    const y = 2 + r * rowH;
    const prev = r ? words[r - 1] : null;
    [...wd].forEach((ch, i) => {
      const x = x0 + i * (cell + gap);
      const changed = prev && prev[i] !== ch;
      const last = r === n - 1;
      out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="6" fill="${last ? 'none' : '#ffffff'}" stroke="${changed ? '#f2b705' : last ? '#f2b705' : '#9aa6bb'}" stroke-width="${changed ? 4 : 2}"${last && !changed ? ' stroke-dasharray="5 4"' : ''}/>`;
      out += `<text x="${x + cell / 2}" y="${y + 22}" text-anchor="middle" font-size="19" font-weight="800" font-family="system-ui,sans-serif" fill="#10203c">${esc(ch)}</text>`;
    });
    if (r < n - 1) out += `<path d="M${x0 - 18} ${y + cell - 4}v${rowH - cell + 8}" stroke="#10203c" stroke-width="2.4" fill="none"/><path d="M${x0 - 23} ${y + rowH - 2}l5 6 5-6" stroke="#10203c" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`;
    else out += `<path d="M${x0 + w + 14} ${y + 30}V${y + 4}" stroke="#10203c" stroke-width="2.4"/><path d="M${x0 + w + 14} ${y + 4}h14l-4 5 4 5h-14z" fill="#f2b705" stroke="#10203c" stroke-width="1.2"/>`;
  });
  return `<svg class="wl-how-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${out}</svg>`;
}

function heroSVG() {
  return `<svg class="wl-hero" viewBox="0 0 160 90" aria-hidden="true">
    <path d="M52 6v80M108 6v80" stroke="#f2b705" stroke-width="6" stroke-linecap="round"/>
    ${[18, 40, 62].map((y) => `<path d="M52 ${y}h56" stroke="#f2b705" stroke-width="5"/>`).join('')}
    ${['C', 'O', 'L', 'D'].map((ch, i) => `<rect x="${14 + i * 34}" y="${i % 2 ? 26 : 48}" width="26" height="26" rx="5" fill="#fff" stroke="#1e2f4d" stroke-width="2"/><text x="${27 + i * 34}" y="${(i % 2 ? 26 : 48) + 19}" text-anchor="middle" font-size="17" font-weight="800" font-family="system-ui,sans-serif" fill="#1e2f4d">${ch}</text>`).join('')}
  </svg>`;
}

let instance = null;
export function init(container) {
  if (instance) instance.destroy();
  instance = new WordLadder(container);
  try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__wlTest = instance._seam(); } catch { /* no window */ }
}
export function destroy() {
  if (instance) instance.destroy();
  instance = null;
  try { delete window.__wlTest; } catch { /* no window */ }
}
// Always false: every move is saved, leaving is lossless (see the header).
export function isInProgress() { return false; }
export default { init, destroy, isInProgress };
