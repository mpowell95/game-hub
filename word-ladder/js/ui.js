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
import { recordWordLadder, recordWordLadderDaily, withMode, loadStats, wlKey, wlLevels } from '../../js/game-stats.js';
import { bestNow, startServerTime } from '../../js/server-time.js';
import { loadProfile } from '../../js/profile-store.js';
import { backStack } from '../../js/back-stack.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { noteTipShown, noteTipDone } from '../../js/tips-log.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.wordladder.v1';            // settings: { lang, seen, band, tip1 }
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
  flagIn: '<svg viewBox="4.6 2.6 13.4 19.8" width="14" height="20" aria-hidden="true"><path d="M6 21V4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M6 4h11l-2.5 4L17 12H6" fill="currentColor"/></svg>',
  streak: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5c.6 3.2 2.6 4.9 4.3 6.9 1.6 1.9 2.7 3.8 2.7 6.1A7 7 0 0112 22a7 7 0 01-7-6.5c0-2.6 1.3-4.5 3-6.1.3 1.6 1 2.7 2.2 3.3C9.9 9 10.6 5.4 12 2.5z" fill="currentColor"/><path d="M12 13.2c1.6 1.5 2.8 2.8 2.8 4.5a2.8 2.8 0 01-5.6 0c0-1.7 1.2-3 2.8-4.5z" fill="#fff3c4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const STAR_PATH = 'M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z';
/** A row of three small stars, `n` filled (How to play's star key). */
const miniStars = (n) => [1, 2, 3].map((i) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${STAR_PATH}" fill="${i <= n ? '#f2b705' : 'none'}" stroke="${i <= n ? '#8a6500' : '#9aa6bb'}" stroke-width="1.8" stroke-linejoin="round"/></svg>`).join('');
/** The position where two equal-length words differ (-1 when none). */
const changedAt = (a, b) => { if (!a || !b) return -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
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
/** The difficulty picked on the start screen (a preference), Easy when none. */
function loadBand() { const b = loadSettings().band; return E.TIERS.includes(b) ? b : 'easy'; }
function loadLang() {
  const s = readJSON(KEY, {});
  return s.lang === 'es' || s.lang === 'en' ? s.lang : (getLang() === 'es' ? 'es' : 'en');
}
/** The puzzle version an attempt was played on (its level's `v`); a save from before the 2026-11-19 remake has none = 1. */
function wlVer(a) { return Math.max(1, Math.floor(Number((a && (a.ver || (a.level && a.level.v))) || 1))); }
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
    this.band = loadBand();
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
    // THE PHONE'S BACK SWIPE steps back one screen, as in every leaderboard (js/back-stack.js; Matt, 2026-11-13: "make sure
    // the swipe back feature we built into all leaderboard screens also works here"). Levels: start screen 0, a level /
    // the daily / its done card 1, How to play +1. The hub's top-left button takes the same step ("‹ Back") via back().
    this._bs = backStack((n) => this._stepBack(n));
    this._offResize = onViewportResize(() => (this.screen === 'done' ? this._fitFinal() : this._fit()));
    try { startServerTime(); } catch { /* the day falls back to the phone's clock */ }
    this._repair1113();
    this._flushAll();
    this._setup();
  }

  // --- the back step (swipe, the hub's button, the game's own back arrow and X, Esc: one path) ---------------
  _level() {
    const help = !!this.root.querySelector('.wl-ov');
    return (this.screen === 'setup' ? 0 : 1) + (help ? 1 : 0) - (this.screen === 'help' && this._helpPrev === 'setup' ? 1 : 0);
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
  /** One step back through history (so the swipe and every on-screen back run the same code). */
  _goBack() {
    if (this._bs && this._bs.level > 0) this._bs.back(); else this._stepBack(1);
  }
  /** Step back n levels: How to play closes first, then a level or the daily returns to the start screen. */
  _stepBack(n) {
    // Screens are drawn without syncing history in between: one sync at the end, to where the steps landed
    // (a sync per step would push an entry from inside the popstate, js/back-stack.js).
    this._stepping = true;
    try {
      for (let i = 0; i < n; i++) {
        if (this.root.querySelector('.wl-ov')) { this._closeHelp(); continue; }
        if (this.screen !== 'setup') { this._setup(); continue; }
        break;
      }
    } finally { this._stepping = false; }
    this._sync();
  }
  /** The hub's back (its button, or a gesture it holds): true when the game took the step itself. */
  back() {
    if (this._level() > 0) { this._goBack(); return true; }
    return false;
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
  /** A band's attempt in the save: `<lang>:<band>` (2026-11-14, one per difficulty); before that ONE attempt per language
   *  under `<lang>`, still read (never deleted, rule 5) when its level falls in this band and the band has none of its own. */
  _bandAttempt(lang, band) {
    const s = this._saves();
    const own = s[`${lang}:${band}`];
    if (own && typeof own === 'object') return own;
    const old = s[lang];
    const [lo, hi] = E.bandRange(band);
    return old && typeof old === 'object' && Number.isInteger(old.n) && old.n >= lo && old.n <= hi ? old : null;
  }
  /** The level to play in a band: its attempt in progress, else its lowest level not completed; null = band done. */
  /** Level n's CURRENT puzzle finished (its version's entry, wlKey). A remade level's old solve stays stored and counted
   *  (board, stars) but the new puzzle is there to play (2026-11-19, Matt: replays remade levels, keeps what he earned). */
  _solved(lang, n, map = this._map(lang)) { return !!map[wlKey(n, E.levelVersion(lang, n))]; }
  /** The level to play in a band: its attempt in progress, else its lowest level not completed; null = band done.
   *  An attempt saved on an earlier version of its level is not this band's attempt any more. */
  _nextN(lang, band = this.band) {
    const map = this._map(lang);
    let a = this._bandAttempt(lang, band);
    if (a && !(Number.isInteger(a.n) && wlVer(a) === E.levelVersion(lang, a.n))) a = null;
    if (a && a.n >= 1 && !(a.done && a.recorded) && !this._solved(lang, a.n, map)) return a.n;
    const [lo, hi] = E.bandRange(band);
    for (let n = lo; n <= hi; n++) if (!this._solved(lang, n, map) && !(a && a.n === n && a.done && a.recorded)) return n;
    return null;
  }
  /** [solved, total] levels of a band in one language (the start screen's and the done card's progress): current puzzles. */
  _bandCount(lang, band, also) {
    const map = this._map(lang);
    const [lo, hi] = E.bandRange(band);
    let n = 0;
    for (let i = lo; i <= hi; i++) if (this._solved(lang, i, map) || i === also) n++;
    return [n, hi - lo + 1];
  }
  /** Stars earned: each level NUMBER once, at its best over every puzzle version (wlLevels), so an old solve keeps its
   *  stars and a replay of the remade puzzle never adds them twice. */
  _totalStars() {
    let n = 0;
    try { for (const r of wlLevels({ wl: wlRec() }).values()) n += (r.e && r.e.s) | 0; } catch { /* no stats */ }
    return n;
  }
  _todayKey(lang) { return `${lang}-${dayKey(new Date(bestNow()))}`; }
  /** The daily streak in one language, worked out when shown (never stored): the days in a row, by the phone's LOCAL
   *  date, with a finished daily in the save or the stats (`wl.dl`), ending today, or yesterday while today is open. */
  _streak(lang) {
    const done = new Set();
    for (const [k, a] of Object.entries(readJSON(DAILY_KEY, { d: {} }).d || {})) if (a && a.done && k.startsWith(lang + '-')) done.add(k);
    for (const k of Object.keys(wlRec().dl || {})) if (k.startsWith(lang + '-')) done.add(k);
    const now = new Date(bestNow());
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!done.has(`${lang}-${dayKey(d)}`)) d.setDate(d.getDate() - 1);
    let n = 0;
    while (done.has(`${lang}-${dayKey(d)}`) && n < 5000) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  _streakHTML(n) {
    return n ? `<span class="wl-streak" aria-label="${esc(t('streak_aria', { n }))}">${SVG.streak}<b>${n}</b></span>` : '';
  }
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
    for (const [k, a] of Object.entries(saves)) {
      const m = /^(en|es)(?::(easy|medium|hard|expert))?$/.exec(k);
      if (m && a && a.done && !a.recorded && Number.isInteger(a.n)) this._record({ kind: 'ladder', lang: m[1], band: m[2] || E.bandOf(a.n), ...a }, true);
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
          { detail: () => ({ moves: a.moves, par: a.p, hints: a.hints }), log: () => ({ kind: a.kind, ver: wlVer(a), key: a.key || null, n: a.n, lang: a.lang, start: a.s || (a.level && a.level.s) || null, target: a.level ? a.level.t : null, par: a.p, chain: a.chain, seq: a.seq || [], moves: a.moves, hints: a.hints, secs: a.t0 ? Math.round((Date.now() - a.t0) / 1000) : null, res: a.res | 0 }) });
      } else {
        res = withMode(() => ({ mode: 'ladder', lang: a.lang }), () => E.bandOf(a.n), () => recordWordLadder(a.n, { moves: a.moves, par: a.p, hints: a.hints, lang: a.lang, band: E.bandOf(a.n), ver: wlVer(a) }),
          { detail: () => ({ moves: a.moves, par: a.p, hints: a.hints }), log: () => ({ kind: a.kind, ver: wlVer(a), key: a.key || null, n: a.n, lang: a.lang, start: a.s || (a.level && a.level.s) || null, target: a.level ? a.level.t : null, par: a.p, chain: a.chain, seq: a.seq || [], moves: a.moves, hints: a.hints, secs: a.t0 ? Math.round((Date.now() - a.t0) / 1000) : null, res: a.res | 0 }) });
      }
    } catch (err) { console.error('[word-ladder] result NOT recorded yet, retried on the next open', err); res = null; }
    if (!res) { if (!quiet) console.error('[word-ladder] the recorder refused the result; kept as not recorded, retried on the next open'); return false; }
    this._saveAttempt({ ...a, recorded: true });
    return true;
  }
  _saveAttempt(a) {
    const rec = { v: 1, n: a.n, ver: wlVer(a), s: a.level ? a.level.s : a.s, p: a.p, chain: a.chain, moves: a.moves, hints: a.hints, done: !!a.done, recorded: !!a.recorded };
    if (a.kind === 'daily') {
      const all = readJSON(DAILY_KEY, { v: 1, d: {} });
      if (!all.d || typeof all.d !== 'object') all.d = {};
      all.v = 1;
      all.d[a.key] = rec;
      return writeJSON(DAILY_KEY, all);
    }
    const s = this._saves();
    s[`${a.lang}:${a.band || E.bandOf(a.n)}`] = rec;   // one attempt per difficulty (the old `<lang>` attempt stays as stored)
    return writeJSON(SAVE_KEY, s);
  }

  // --- screens ----------------------------------------------------------------------------------------------
  _setup() {
    this._clearTimers();
    this.screen = 'setup';
    this.cur = null;
    const n = this._nextN(this.lang, this.band);
    const done = this._dailyDone(this.lang);
    // Each difficulty shows how far along it is: "12/100" and a thin bar (like Gridlock's start screen).
    const segs = E.TIERS.map((k, i) => {
      const [got, all] = this._bandCount(this.lang, k);
      const pct = Math.round((got / all) * 100);
      return `<button type="button" class="wl-seg${k === this.band ? ' is-selected' : ''}" data-act="band" data-band="${k}" role="radio" aria-checked="${k === this.band}" aria-label="${esc(t('seg_aria', { name: t('tier_' + k), n: got, m: all }))}">
        <span class="wl-seg-n">${diffShapeSVG(i + 1)}<b>${esc(t('tier_' + k))}</b></span>
        <span class="wl-seg-p"><i class="wl-bar"><i style="width:${pct}%"></i></i><small>${got}/${all}</small></span></button>`;
    }).join('');
    const play = n == null
      ? `<button type="button" class="wl-btn wl-btn-main" disabled>${esc(t('band_done', { name: t('tier_' + this.band) }))}</button>`
      : `<button type="button" class="wl-btn wl-btn-main" data-act="play">${esc(t('play_n', { n }))}</button>`;
    this.root.innerHTML = `
      <div class="wl-setup">
        <div class="wl-home">
          ${heroSVG(this.lang)}
          <h1 class="wl-title">${esc(t('title'))}</h1>
          <div class="wl-sub">
            ${this._totalStars() ? `<span class="wl-total" aria-label="${esc(t('total_aria', { n: this._totalStars() }))}">${starSVG(true)}<b>${this._totalStars()}</b></span>` : ''}
            <button type="button" class="wl-lang" data-act="lang" aria-label="${esc(t('lang_aria'))}">${this.lang === 'es' ? 'ES' : 'EN'}</button>
          </div>
          <div class="wl-segs" role="radiogroup" aria-label="${esc(t('diff_aria'))}">${segs}</div>
          ${play}
          <button type="button" class="wl-btn wl-btn-daily${done ? ' is-done' : ''}" data-act="daily" aria-label="${esc(t(done ? 'daily_done_aria' : 'daily_aria'))}">${SVG.cal}<span>${esc(t('daily'))}</span>${done ? `<i class="wl-ok">${SVG.check}</i>` : ''}${this._streakHTML(this._streak(this.lang))}</button>
          <button type="button" class="wl-help" data-act="help" aria-label="${esc(t('help_aria'))}">?</button>
        </div>
      </div>`;
    this._sync();
  }

  async _open(kind) {
    const lang = this.lang;
    this.screen = 'loading';
    this.cur = null;
    this.root.innerHTML = '<div class="wl-setup"><div class="wl-home"><div class="wl-wait"></div></div></div>';
    this._sync();
    let d;
    try { d = await loadData(lang); } catch (err) {
      console.error('[word-ladder] data not loaded', err);
      this.root.innerHTML = `<div class="wl-setup"><div class="wl-home"><p class="wl-err">${esc(t('load_failed'))}</p>
        <button type="button" class="wl-btn wl-btn-main" data-act="${kind === 'daily' ? 'daily' : 'play'}">${esc(t('retry'))}</button>
        <button type="button" class="wl-btn" data-act="setup">${esc(t('back'))}</button></div></div>`;
      return;
    }
    if (!this.root.isConnected || this.lang !== lang || this.screen !== 'loading') return;   // left meanwhile
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
      n = this._nextN(lang, this.band);
      if (n == null || n > d.levels.length) { this._soon(n == null ? t('band_done', { name: t('tier_' + this.band) }) : null); return; }
      level = E.cleanLevel(d.levels[n - 1]);
      const s = this._bandAttempt(lang, this.band);
      a = s && s.n === n ? s : null;
    }
    if (!level) { console.error('[word-ladder] level does not add up, not drawn', kind, n); this._soon(); return; }
    const c = E.cleanAttempt(a, level, d.dict);
    this.data = d;
    this.cur = { kind, lang, n, key, level, ver: level.v || 1, p: level.p, chain: c.chain, moves: c.moves, hints: c.hints, done: c.done, recorded: c.recorded, sel: null, band: kind === 'daily' ? null : this.band, seq: [], t0: Date.now(), res: (c.chain && c.chain.length > 1) ? 1 : 0 };   // no letter picked: the player chooses (Matt, 2026-11-14)
    this.dist = null;
    if (c.done) { if (!c.recorded) this._record(this.cur); this._done(); return; }
    this._saveAttempt(this.cur);
    this._play();
  }
  _soon(text) {
    this.screen = 'soon';
    this._sync();
    this.root.innerHTML = `<div class="wl-setup"><div class="wl-home"><h1 class="wl-title">${esc(text || t('done_all'))}</h1>
      <button type="button" class="wl-btn wl-btn-main" data-act="setup">${esc(t('back'))}</button></div></div>`;
  }


  _word() { return this.cur.chain[this.cur.chain.length - 1]; }


  _play() {
    this._clearTimers();
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
          <button type="button" class="wl-icon wl-tool wl-hintbtn" data-act="hint" aria-label="${esc(t('hint_aria'))}">${SVG.hint}<i class="wl-badge" data-role="hints"${c.hints ? '' : ' hidden'}>${c.hints}</i></button>
        </div>
        <div class="wl-kb" data-role="kb">${kb.map((row) => `<div class="wl-kr">${[...row].map((ch) =>
          `<button type="button" class="wl-key" data-key="${ch}" aria-label="${esc(t('key_aria', { l: ch }))}">${ch}</button>`).join('')}</div>`).join('')}</div>
      </div>`;
    this._drawLadder();
    this._fit();
    this._sync();
    // The first time on this device, How to play opens by itself (Matt, 2026-11-13: "not clear how to play AT ALL"),
    // and after its Got it the first move is shown by doing it (_startTip), once per device.
    if (!loadSettings().seen) {
      saveSettings({ seen: 1 });
      this._tipArmed = !loadSettings().tip1 && c.chain.length === 1;
      this._help();
    }
  }

  // --- the first move, taught by doing it (2026-11-19 UI review) ------------------------------------------------
  /** After the first How to play's Got it, on this device's first level only: the letter that starts a shortest path
   *  pulses, then (once it is tapped) its key. Nothing is picked for the player (Matt, 2026-11-14): the pulse only points.
   *  Shown once (`tip1` in the settings, a preference); who saw it is reported (js/tips-log.js). */
  _startTip() {
    this._tipArmed = false;
    const c = this.cur;
    if (this.screen !== 'play' || !c || c.chain.length !== 1 || loadSettings().tip1) return;
    const next = (c.level.h || [])[1];
    const pos = changedAt(c.chain[0], next);
    if (pos < 0) return;
    this._tip = { pos, ch: next[pos] };
    saveSettings({ tip1: 1 });
    try { noteTipShown('wordladder', 'first-move'); } catch { /* a report only */ }
    this._drawLadder();
  }
  _endTip() {
    if (!this._tip) return;
    this._tip = null;
    try { noteTipDone('wordladder', 'first-move'); } catch { /* a report only */ }
    for (const k of this.root.querySelectorAll('.wl-key.is-tip')) k.classList.remove('is-tip');
  }
  _paintTipKey() {
    for (const k of this.root.querySelectorAll('.wl-key.is-tip')) k.classList.remove('is-tip');
    const tp = this._tip, c = this.cur;
    if (!tp || !c || c.sel !== tp.pos) return;
    const k = this.root.querySelector(`.wl-key[data-key="${tp.ch}"]`);
    if (k) k.classList.add('is-tip');
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

  /** Empty rungs between the word being changed and the target: the moves left to finish at par, counted from the
   *  start (par minus moves so far, minus the target's own step), never below 0. Honest: it never says where the path
   *  goes, only how many changes par allows from here. */
  _rungs() {
    const c = this.cur;
    return c ? Math.max(0, c.p - c.moves - 1) : 0;
  }

  /** The ladder: earlier words (small; the letter each one changed outlined gold), the word being changed (big,
   *  tappable), empty rungs (moves left at par), the target (flag). `anim` = { pos, fill } animates a step just made. */
  _drawLadder(anim) {
    const el = this.root.querySelector('[data-role="ladder"]');
    if (!el) return;
    const c = this.cur, tg = c.level.t, w = this._word(), chain = c.chain;
    const tip = this._tip && c.sel !== this._tip.pos ? this._tip.pos : -1;
    const small = (k) => {
      const word = chain[k], chg = k > 0 ? changedAt(chain[k - 1], word) : -1;
      return `<div class="wl-w wl-past">${[...word].map((ch, i) => `<span class="wl-t${ch === tg[i] ? ' is-match' : ''}${i === chg ? ' is-chg' : ''}">${ch}</span>`).join('')}</div>`;
    };
    const past = chain.length - 1;
    const maxPast = this._maxPast || 1;
    let rows = '';
    if (past <= maxPast) for (let k = 0; k < past; k++) rows += small(k);
    else {
      // Too many to fit: the first word, a ⋮, then the last ones (the start stays in sight; 2026-11-19 review).
      const tail = maxPast >= 2 ? maxPast - 1 : maxPast;
      if (maxPast >= 2) rows += small(0);
      rows += '<div class="wl-more" aria-hidden="true">⋮</div>';
      for (let k = past - tail; k < past; k++) rows += small(k);
    }
    const nowTiles = [...w].map((ch, i) => {
      const cls = `wl-t${ch === tg[i] ? ' is-match' : ''}${i === c.sel ? ' is-sel' : ''}${i === tip ? ' is-tip' : ''}${anim && anim.pos === i ? (anim.fill ? ' is-flip is-fill' : ' is-flip') : ''}`;
      return `<button type="button" class="${cls}" data-pos="${i}" aria-label="${esc(t('letter_aria', { n: i + 1, l: ch }))}"${i === c.sel ? ' aria-pressed="true"' : ''}>${ch}</button>`;
    }).join('');
    const nR = this._rungs();
    const rungRow = `<div class="wl-rung">${'<i></i>'.repeat(tg.length)}</div>`;
    const middle = nR ? `<div class="wl-rungs" aria-hidden="true">${rungRow.repeat(nR)}</div>` : '<div class="wl-link" aria-hidden="true"></div>';
    el.innerHTML = `${rows}
      <div class="wl-w wl-now${anim ? ' is-new' : ''}" data-role="now">${nowTiles}</div>
      ${middle}
      <div class="wl-w wl-goal" aria-label="${esc(t('target_aria', { w: tg }))}"><i class="wl-flag">${SVG.flag}</i>${[...tg].map((ch) => `<span class="wl-t">${ch}</span>`).join('')}</div>`;
    const mv = this.root.querySelector('[data-role="moves"]');
    if (mv) mv.textContent = String(c.moves);
    const hb = this.root.querySelector('[data-role="hints"]');
    if (hb) { hb.textContent = String(c.hints); hb.hidden = !c.hints; }
    const undo = this.root.querySelector('[data-act="undo"]');
    if (undo) undo.disabled = chain.length < 2;
    this._coach();
    this._paintTipKey();
  }

  /** Tile size from the room the ladder has (never scrolls): the width for the letters and the height for its rows.
   *  At least 3 earlier words stay in sight when there are 3 (the first, a ⋮, the last ones), the tile shrinking for
   *  them first; the empty rungs take what is left (6-20px each). */
  _fit() {
    if (this.screen !== 'play' || !this.cur) return;
    const el = this.root.querySelector('[data-role="ladder"]');
    if (!el) return;
    const len = this.cur.level.t.length;
    const H = el.clientHeight, W = el.clientWidth;
    if (!H || !W) { if (this.root.isConnected && !this._dead) requestAnimationFrame(() => this._fit()); return; }
    // Rows (the ladder's flex gap is 6): the word being changed (big + 4 margin), the target (0.8 big), the middle
    // (the dashed link, 22; or the rungs, 6px each + 4 gaps at least), then earlier words (0.62 big + 6 each) and,
    // when some are folded away, the ⋮ row (28).
    const past = this.cur.chain.length - 1;
    const nR = this._rungs();
    const mid = nR ? nR * 14 - 8 + 8 : 22;   // the rungs' least room (6px each, 8px gaps); they grow into what is left
    const per = (b) => Math.round(b * 0.62) + 6;
    const room = (b) => H - (b + 4) - Math.round(b * 0.8) - 12 - mid - 6 - 4;   // 4: a little air above the coach line
    const rowsFor = (b) => {
      const all = Math.floor(room(b) / per(b));
      return all >= past ? all : Math.floor((room(b) - 28) / per(b));
    };
    // Up to 64px, or 80 on a tall phone (the room under the ladder was empty on 393/402x852+; 2026-11-19 re-grade).
    let big = Math.max(40, Math.min(H > 360 ? 80 : 64, Math.floor((W - 16 - (len - 1) * 8) / len)));
    const want = Math.min(3, past);
    while (big > 34 && rowsFor(big) < want) big -= 2;
    this.root.style.setProperty('--wl-big', big + 'px');
    const fit = Math.max(1, rowsFor(big));
    // What is left over (tall phones had empty room under the ladder, 2026-11-19 re-grade): the rungs grow first, up to a
    // full target tile; then, when every earlier word is shown, those grow from 0.62 up to 0.8 of the big tile.
    const shown = Math.min(past, fit), folded = past > fit;
    let left = room(big) + mid - shown * per(big) - (folded ? 28 : 0) - 8;
    if (nR) {
      const rh = Math.max(6, Math.min(Math.round(big * 0.8), Math.floor((left + 8) / nR) - 8));
      this.root.style.setProperty('--wl-rung', rh + 'px');
      left -= nR * (rh + 8) - 8 - (mid - 8);
    }
    let small = Math.round(big * 0.62);
    if (shown && !folded && left > 0) small = Math.min(Math.round(big * 0.8), small + Math.floor(left / shown));
    this.root.style.setProperty('--wl-small', small + 'px');
    if (fit !== this._maxPast) { this._maxPast = fit; this._drawLadder(); }
  }

  _msg(text, noShake) {
    const m = this.root.querySelector('[data-role="msg"]');
    if (!m) return;
    m.textContent = text;
    clearTimeout(this._msgT);
    m.classList.remove('is-coach', 'was-coach');
    this._msgT = setTimeout(() => { if (m.isConnected) { m.textContent = ''; this._coach(); } }, 1600);
    if (!noShake) this._shake();
  }
  _shake() {
    const now = this.root.querySelector('[data-role="now"]');
    if (now) { now.classList.remove('is-shake'); void now.offsetWidth; now.classList.add('is-shake'); }
  }

  /** A word that is not on the list: the tried letter shows in its tile (navy, a gold X) for a moment, the word shakes,
   *  then the tile goes back. Never blocks: the next tap puts the word back at once and is played as usual. */
  _bad(pos, ch) {
    this._cancelBad();
    const tile = this.root.querySelector(`.wl-now [data-pos="${pos}"]`);
    if (!tile) return;
    tile.textContent = ch;
    tile.classList.remove('is-match', 'is-flip', 'is-fill');
    tile.classList.add('is-bad');
    this._badOn = true;
    this._badT = [
      setTimeout(() => this._shake(), 260),
      setTimeout(() => { this._badT = null; this._cancelBad(); }, 680),
    ];
  }
  _cancelBad() {
    if (this._badT) { for (const x of this._badT) clearTimeout(x); this._badT = null; }
    if (this._badOn) { this._badOn = false; if (this.screen === 'play' && this.cur) this._drawLadder(); }
  }

  /** Change the selected letter to `ch`. */
  _letter(ch) {
    const c = this.cur;
    if (!c || this.screen !== 'play') return;
    this._cancelBad();
    const w = this._word();
    if (c.sel == null) { this._msg(t('pick_first')); return; }   // a key before a letter: say so
    const next = w.slice(0, c.sel) + ch + w.slice(c.sel + 1);
    if (next === w) return;
    const why = E.checkMove(this.data.dict, w, next);
    if (why !== 'ok') {
      this._wlNote((why === 'word' ? 'x:' : 'o:') + next);
      this._msg(t(why === 'word' ? 'not_word' : 'one_letter'), true);
      this._bad(c.sel, ch);
      return;
    }
    this._step(next, false);
  }
  /** PRIVATE play log only (admin play log `x`, never saved): every try in order, with the clock. */
  _wlNote(e) {
    try { const c = this.cur; if (c && c.seq && c.seq.length < 600) c.seq.push(e + '@' + Math.round((Date.now() - (c.t0 || Date.now())) / 1000)); } catch { /* private log only */ }
  }
  _step(next, hint) {
    const c = this.cur;
    this._cancelBad();
    this._endTip();
    this._wlNote((hint ? 'h:' : 'w:') + next);
    const prev = this._word();
    c.chain = [...c.chain, next];
    c.moves += 1;
    if (hint) c.hints += 1;
    if (next === c.level.t) {
      c.done = true;
      c.recorded = false;
      this._saveAttempt(c);
      this._record(c);           // FIRST: before any screen (THE LAW)
      this._done(true);
      return;
    }
    c.sel = null;
    this._saveAttempt(c);
    const pos = changedAt(prev, next);
    this._drawLadder({ pos, fill: pos >= 0 && next[pos] === c.level.t[pos] && prev[pos] !== c.level.t[pos] });
    this._fit();
  }
  _undo() {
    const c = this.cur;
    if (!c || c.chain.length < 2) return;
    this._cancelBad();
    this._wlNote('u');
    c.chain = E.undoChain(c.chain);
    c.moves += 1;               // an undo is a move (par counts every change)
    c.sel = null;
    this._saveAttempt(c);
    this._drawLadder();
    this._fit();
  }
  _hint() {
    const c = this.cur;
    if (!c) return;
    this._cancelBad();
    if (!this.dist) this.dist = E.distancesTo(this.data.dict, c.level.t, this.data.alpha);
    const next = E.hintFrom(this.data.dict, this._word(), c.level.t, this.data.alpha, this.dist);
    if (next) this._step(next, true);
  }

  /** The finish: the ladder lights up row by row, the stars fill one at a time, the heading names the result (Par! at
   *  3 stars), one line of progress (the difficulty's levels done, or the daily's date and the time to the next one).
   *  `fresh` = just finished (the animation runs); reopening a finished daily shows it still. Next is live at once. */
  _done(fresh) {
    this._clearTimers();
    this.screen = 'done';
    const c = this.cur;
    const stars = E.starsFor(c.moves, c.p, c.hints);
    const head = esc(t(stars === 3 ? 'res_par' : 'res_ok'));
    let sub;
    if (c.kind === 'daily') {
      sub = `<p class="wl-prog">${SVG.cal}<span>${esc(this._dateText(c.key))}</span>${this._streakHTML(this._streak(c.lang))}</p>
          <p class="wl-prog wl-next-in" data-role="nextin">${SVG.clock}<span></span></p>`;
    } else {
      const band = c.band || E.bandOf(c.n);
      const [got, all] = this._bandCount(c.lang, band, c.n);
      sub = `<p class="wl-prog" aria-label="${esc(t('seg_aria', { name: t('tier_' + band), n: got, m: all }))}">${diffShapeSVG(E.TIERS.indexOf(band) + 1)}<span>${esc(t('tier_' + band))} · ${esc(t('prog', { n: got, m: all }))}</span></p>`;
    }
    this._finalAnim = !!fresh;
    this.root.innerHTML = `
      <div class="wl-game wl-is-done${fresh ? ' is-fresh' : ''}${stars === 3 ? ' is-par' : ''}">
        <div class="wl-ladder wl-final" data-role="final"></div>
        <div class="wl-card" role="dialog" aria-label="${head}">
          <button type="button" class="wl-icon wl-x" data-act="setup" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
          <h2 class="wl-card-h">${head}</h2>
          <div class="wl-stars${fresh && stars === 3 ? ' is-burst' : ''}" data-role="stars" data-n="${stars}" aria-label="${esc(t('stars_aria', { n: stars }))}">${[1, 2, 3].map((i) => `<span class="wl-star${i <= stars ? ' is-on' : ''}">${starSVG(false)}${i <= stars ? starSVG(true) : ''}</span>`).join('')}</div>
          <div class="wl-count wl-count-card"><span>${esc(t('moves'))} <b>${c.moves}</b></span><span>${esc(t('par'))} <b>${c.p}</b></span>${c.hints ? `<span class="wl-hints-n" aria-label="${esc(t('hints_aria', { n: c.hints }))}">${SVG.hint}<b>${c.hints}</b></span>` : ''}</div>
          ${sub}
          ${c.kind === 'daily'
            ? `<button type="button" class="wl-btn wl-btn-main" data-act="setup">${esc(t('back'))}</button>`
            : `<button type="button" class="wl-btn wl-btn-main" data-act="next">${esc(t('next'))}</button>`}
        </div>
      </div>`;
    this._fitFinal();
    if (c.kind === 'daily') { this._tickNext(); this._tick = setInterval(() => this._tickNext(), 1000); }
    this._sync();
  }
  /** "Thu, Nov 19" / "jue, 19 nov" for a daily key `<lang>-YYYY-MM-DD`. */
  _dateText(key) {
    const m = /(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(bestNow());
    try { return new Intl.DateTimeFormat(getLang() === 'es' ? 'es' : 'en', { weekday: 'short', month: 'short', day: 'numeric' }).format(d); } catch { return d.toDateString(); }
  }
  /** The time to the next daily ladder: the phone's next LOCAL midnight on the server's clock (bestNow). */
  _tickNext() {
    const el = this.root.querySelector('[data-role="nextin"] span');
    if (!el) { this._clearTimers(); return; }
    const now = new Date(bestNow());
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const s = Math.max(0, Math.round((mid - now.getTime()) / 1000));
    const p = (n) => String(n).padStart(2, '0');
    el.textContent = t('next_in', { t: `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` });
  }
  _clearTimers() {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
    if (this._badT) { for (const x of this._badT) clearTimeout(x); this._badT = null; }
    this._badOn = false;
  }
  /** The finished ladder above the card. Tiles 30-44px; a ladder too long for the room shows its first word, a ⋮ and
   *  the last words that fit (2026-11-13 review: an 18-word ladder shrank to 16px tiles with 9px letters and overflowed).
   *  Each word's changed letter is outlined; just finished, the rows light up one after another (60ms each). */
  _fitFinal() {
    const el = this.root.querySelector('[data-role="final"]');
    if (!el || !this.cur) return;
    const c = this.cur, chain = c.chain, len = c.level.t.length, tg = c.level.t;
    const H = el.clientHeight || 300, W = el.clientWidth || 300;
    const fitRows = (sz) => Math.floor((H + 5) / (sz + 5));
    const s = Math.max(30, Math.min(44, Math.floor((H + 5) / chain.length) - 5, Math.floor((W - 40 - (len - 1) * 8) / len)));
    let rows = chain.map((w, k) => k);
    if (fitRows(s) < chain.length) {
      const room = Math.max(3, Math.floor((H + 5 - 27) / (s + 5)));   // 27 = the ⋮ row and its gap
      rows = [0, null, ...rows.slice(chain.length - (room - 1))];
    }
    this.root.style.setProperty('--wl-small', s + 'px');
    const anim = this._finalAnim;
    const step = Math.min(60, Math.floor(600 / rows.length));
    el.innerHTML = rows.map((k, i) => {
      if (k == null) return '<div class="wl-more" aria-hidden="true">⋮</div>';
      const w = chain[k], chg = k > 0 ? changedAt(chain[k - 1], w) : -1;
      return `<div class="wl-w ${k === chain.length - 1 ? 'wl-goal is-won' : 'wl-past'}${anim ? ' is-lit' : ''}"${anim ? ` style="--d:${i * step}ms"` : ''}>${[...w].map((ch, j) => `<span class="wl-t${ch === tg[j] ? ' is-match' : ''}${j === chg ? ' is-chg' : ''}" style="--j:${j}">${ch}</span>`).join('')}</div>`;
    }).join('');
    // The stars start after the last row has lit; the heading pops in once the last star has landed (stars 160ms apart,
    // each 320ms); at 3 stars the burst and the target row's sweep land with the third.
    const g = this.root.querySelector('.wl-is-done');
    const st = this.root.querySelector('[data-role="stars"]');
    if (g && st) {
      const d0 = anim ? rows.length * step + 120 : 0, n = Number(st.dataset.n) || 1;
      g.style.setProperty('--d0', d0 + 'ms');
      g.style.setProperty('--dh', (d0 + (n - 1) * 160 + 300) + 'ms');
    }
    this._finalAnim = false;   // a refit on resize redraws still
  }


  _help() {
    const prev = this.screen;
    const ov = document.createElement('div');
    ov.className = 'wl-ov';
    ov.innerHTML = `<div class="wl-sheet" role="dialog" aria-label="${esc(t('how_title'))}">
      <button type="button" class="wl-icon wl-x" data-act="close-help" aria-label="${esc(t('close_aria'))}">${SVG.x}</button>
      <h2 class="wl-card-h">${esc(t('how_title'))}</h2>
      <p class="wl-how-b">${String(t('how_goal', { flag: '\u0000' })).split('\u0000').map(esc).join(`<i class="wl-flag-in">${SVG.flagIn}</i>`)}</p>
      ${howSVG(String(t('how_eg')).split(' '))}
      <p class="wl-how-cap">${esc(t('how_step'))}</p>
      <p>${esc(t('how_tap'))}</p>
      <p><span class="wl-t wl-t-demo is-match">A</span> ${esc(t('how_dot'))}</p>
      ${starKey()}
      <p>${esc(t('how_undo'))}</p>
      <button type="button" class="wl-btn wl-btn-main wl-gotit" data-act="close-help">${esc(t('got_it'))}</button>
    </div>`;
    this.root.appendChild(ov);
    this.screen = 'help';
    this._helpPrev = prev;
    this._sync();
  }

  // --- input ------------------------------------------------------------------------------------------------
  _click(e) {
    const b = e.target.closest('button');
    if (!b || !this.root.contains(b)) {
      if (e.target.classList && e.target.classList.contains('wl-ov')) this._goBack();
      return;
    }
    if (b.dataset.key) { this._letter(b.dataset.key); return; }
    if (b.dataset.pos != null) {
      if (this.screen !== 'play' || !this.cur) return;
      this._cancelBad();
      this.cur.sel = Number(b.dataset.pos) | 0;
      this._drawLadder();
      return;
    }
    const act = b.dataset.act;
    if (act === 'play') this._open('ladder');
    else if (act === 'daily') this._open('daily');
    else if (act === 'setup') { if (this.screen === 'done' || this.screen === 'play' || this.screen === 'soon') this._goBack(); else this._setup(); }
    else if (act === 'next') this._open('ladder');
    else if (act === 'help') this._help();
    else if (act === 'close-help') this._goBack();
    else if (act === 'undo') this._undo();
    else if (act === 'hint') this._hint();
    else if (act === 'band') {
      if (E.TIERS.includes(b.dataset.band) && b.dataset.band !== this.band) { this.band = b.dataset.band; saveSettings({ band: this.band }); this._setup(); }
    }
    else if (act === 'lang') {
      this.lang = this.lang === 'es' ? 'en' : 'es';
      saveSettings({ lang: this.lang });
      this._setup();
    }
  }
  _closeHelp() {
    const ov = this.root.querySelector('.wl-ov');
    if (ov) ov.remove();
    if (this.screen === 'help') this.screen = this._helpPrev || 'setup';
    if (this.screen === 'play') this._fit();   // a resize while the sheet was up
    this._sync();
    if (this._tipArmed && this.screen === 'play') this._startTip();
  }
  _key(e) {
    const tg = e.target;
    if (tg && tg.closest && (tg.closest('input, textarea, select, [contenteditable]') || (tg !== document.body && !this.root.contains(tg)))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && this._level() > 0) { this._goBack(); e.preventDefault(); return; }
    if (this.screen !== 'play' || !this.cur) return;
    const len = this.cur.level.t.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this._cancelBad();
    if (e.key === 'ArrowLeft') { this.cur.sel = this.cur.sel == null ? len - 1 : (this.cur.sel + len - 1) % len; this._drawLadder(); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { this.cur.sel = this.cur.sel == null ? 0 : (this.cur.sel + 1) % len; this._drawLadder(); e.preventDefault(); return; }
    if (e.key === 'Backspace') { this._undo(); e.preventDefault(); return; }
    // A Spanish keyboard's á / é / ü types its plain vowel (the word list has no accents); Ñ stays Ñ.
    let ch = String(e.key || '').toUpperCase();
    if (ch.length === 1 && ch !== 'Ñ') ch = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
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
    this._clearTimers();
    try { if (this._bs) this._bs.close(); } catch { /* gone */ }
    this._bs = null;
    this._dead = true;
    this._label(false);
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

/** How to play's star key, drawn not written: moves (par, +1 / +2, more) and hints (0, 1, 2+), each with its stars. */
function starKey() {
  const bulb = `<i class="wl-sk-b">${SVG.hint}</i>`;
  const row = (label, n) => `<span class="wl-sk-l">${label}</span><span class="wl-sk-s">${miniStars(n)}</span>`;
  return `<div class="wl-sk" role="img" aria-label="${esc(t('how_stars_aria'))}">
    <div class="wl-sk-c">${row(esc(t('par')), 3)}${row('+1 / +2', 2)}${row(esc(t('how_more')), 1)}</div>
    <div class="wl-sk-c">${row(`${bulb}0`, 3)}${row(`${bulb}1`, 2)}${row(`${bulb}2+`, 1)}</div>
  </div>`;
}

/** The title picture: a real ladder, one word on each rung, cold to warm, each step's changed letter outlined gold.
 *  English COLD CORD WORD WARD WARM; Spanish MAR MAL SAL SOL (sea to sun). Short phones get the short ladder (first two
 *  words, a ⋮, the last), so its tiles stay big enough to read (2026-11-19 re-grade); CSS shows one of the two. */
function heroSVG(lang) {
  const es = lang === 'es';
  const words = es ? ['MAR', 'MAL', 'SAL', 'SOL'] : ['COLD', 'CORD', 'WORD', 'WARD', 'WARM'];
  const fills = es ? ['#8fd0ff', '#c9e4f2', '#ffd98a', '#ffb347'] : ['#8fd0ff', '#bfe0f5', '#f1ead8', '#ffd08a', '#ffad5c'];
  const all = words.map((w, i) => ({ w, f: fills[i], chg: i ? changedAt(words[i - 1], w) : -1 }));
  const short = [all[0], all[1], null, { ...all[all.length - 1], chg: -1 }];
  return ladderSVG(all, 'wl-hero-full') + ladderSVG(short, 'wl-hero-short');
}
function ladderSVG(rows, cls) {
  const len = rows[0].w.length, cell = 24, gap = 7, rowH = 33, dotH = 18;
  const w = len * cell + (len - 1) * gap, railL = 4, x0 = railL + 14, W = x0 * 2 + w;
  const H = rows.reduce((h, r) => h + (r ? rowH : dotH), 0) + 8;
  let out = `<path d="M${railL} 2V${H - 2}M${W - railL} 2V${H - 2}" stroke="#c98d00" stroke-width="5" stroke-linecap="round"/>`;
  let y = 7;
  for (const r of rows) {
    if (!r) {
      for (let k = 0; k < 3; k++) out += `<circle cx="${W / 2}" cy="${y + 1 + k * 5}" r="1.9" fill="#f5f8ff"/>`;
      y += dotH;
      continue;
    }
    out += `<path d="M${railL} ${y + cell / 2}H${W - railL}" stroke="#c98d00" stroke-width="4"/>`;
    [...r.w].forEach((ch, i) => {
      const x = x0 + i * (cell + gap);
      if (i === r.chg) out += `<rect x="${x - 3.5}" y="${y - 3.5}" width="${cell + 7}" height="${cell + 7}" rx="7" fill="none" stroke="#f2b705" stroke-width="3"/>`;
      out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${r.f}" stroke="#10203c" stroke-width="1.5"/>`;
      out += `<text x="${x + cell / 2}" y="${y + 17.5}" text-anchor="middle" font-size="15" font-weight="800" font-family="system-ui,sans-serif" fill="#10203c">${ch}</text>`;
    });
    y += rowH;
  }
  return `<svg class="wl-hero ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${out}</svg>`;
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
/** The hub's back: one screen back inside the game (How to play, then the start screen); false = leave to the hub. */
export function back() { return !!(instance && instance.back()); }
export default { init, destroy, isInProgress, back };
