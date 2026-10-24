// battle-arena/js/ui.js - BATTLE ARENA: home, draft, the battle, the module contract.
// The rules live in engine.js (pure, JSON state, seeded RNG); this file only draws them and turns
// the engine's `events` into animation. The computer is cpu.js; the pictures are art.js.
//
// THE LAW applies here. `gamehub.battlearena.v1` holds preferences only (difficulty, last team,
// who opens next, which tips were seen). `gamehub.battlearena.save.v1` holds the match in
// progress (the engine state, written after every move) so leaving is lossless. A finished match
// vs the computer goes to the shared recorder, `recordResult('battlearena', diff, won)`, exactly
// once, and only then is the save removed. Unlocks are DERIVED from total wins at read time;
// nothing here stores an unlock.
import { onViewportResize } from '../../js/viewport.js';
import { makeT, myName } from '../../js/i18n.js';
import { recordResult, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { STRINGS } from './strings.js';
import * as E from './engine.js';
import { chooseMove, chooseTeam } from './cpu.js';
import { MONSTERS, BY_ID, unlockedIds, specialOf, ELEMENT_COLOR, monName, BERRIES_TO_EVOLVE } from './monsters.js';
import { monsterSVG, gemSVG, elementBadge, arenaSVG } from './art.js';
import { mirror, mirrorEvents, entryOf, moveOf } from './online.js';

const t = makeT(STRINGS);
const CSS_MARK = 'data-battlearena-css';
const SETTINGS_KEY = 'gamehub.battlearena.v1';
const SAVE_KEY = 'gamehub.battlearena.save.v1';
const DIFFS = ['easy', 'medium', 'hard'];
const ME = 0, CPU = 1;            // SCREEN sides: this phone's player right, the other team left


// Timings, from the reference recordings (slower and weightier than a puzzle game).
const SWAP_MS = 190;
const GLOW_MS = 170;
const POP_MS = 230;
const FALL_BASE_MS = 150;
const FALL_ROW_MS = 60;
const SPECIAL_MS = 1250;
const TURN_BANNER_MS = 1150;
const PROJ_MS = 380;
const CPU_THINK_MS = 650;
const CPU_SHOW_MS = 450;
const TURN_SECONDS = 25;          // per MOVE (the reference resets it after every move); live rooms only
const REMOTE_SHOW_MS = 450;       // the other person's swap: the two tiles light up, as the computer's do
const MOVE_HEXES = 2;

let instance = null;

const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const writeJSON = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (err) { console.error('[battle-arena] write failed', key, err); return false; }
};

function readSettings() {
  const raw = readJSON(SETTINGS_KEY) || {};
  return {
    diff: DIFFS.includes(raw.diff) ? raw.diff : 'easy',
    team: Array.isArray(raw.team) ? raw.team.filter((id) => BY_ID[id]).slice(0, 2) : [],
    // Turn-based games alternate who opens (docs/BUILDING-A-GAME.md, setup defaults).
    nextFirst: raw.nextFirst === 1 ? 1 : 0,
    tips: raw.tips && typeof raw.tips === 'object' ? raw.tips : {},
  };
}

/** A match in progress, or null. Anything malformed reads as "no match" (never a crash). */
function readSave() {
  const s = readJSON(SAVE_KEY);
  if (!s || s.v !== 1 || !s.state || !Array.isArray(s.state.board) || s.state.board.length !== E.N) return null;
  if (!Array.isArray(s.state.sides) || s.state.sides.length !== 2) return null;
  if (s.state.sides.some((sd) => !Array.isArray(sd.mons) || sd.mons.some((m) => !BY_ID[m.id]))) return null;
  return { v: 1, diff: DIFFS.includes(s.diff) ? s.diff : 'easy', state: s.state };
}

/** Is a match handed over to this game's next mount (alert.js armOpen / armChallenge)? */
function hasArmedOpen() { try { return !!sessionStorage.getItem('gamehub.battlearena.open.v1'); } catch { return false; } }
/** Was this phone in a live room when the game last closed (live.js ROOM_KEY)? */
function hasLiveRoom() { try { return !!localStorage.getItem('gamehub.battlearena.room.v1'); } catch { return false; } }

/** Total Battle Arena wins on this device's store: the ONLY input to unlocks. */
function totalWins() {
  try { return ((loadStats().games.battlearena || {}).total || {}).won | 0; } catch { return 0; }
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
  const href = new URL('../css/battle-arena.css', import.meta.url).href;
  if (document.head.querySelector('[' + CSS_MARK + ']')
    || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) {
    return Promise.resolve();
  }
  return new Promise((res) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(CSS_MARK, '1');
    link.onload = link.onerror = () => res();       // a 404 must not hang the mount for ever
    document.head.appendChild(link);
    setTimeout(res, 2500);
  });
}

const escapeHTML = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="#E0532F"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z" fill="#9fb3c8" stroke="#2c3b4d" stroke-width="1.8"/></svg>',
  snow: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#bfe6ff" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/></g></svg>',
  hex: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8.7 5v10L12 22l-8.7-5V7z" fill="#7B4FC4" stroke="#C9A2F0" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="#C9A2F0"/></svg>',
  berry: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="currentColor"/><path d="M12 5c0-3 2-4 5-4-1 3-2 4-5 4z" fill="#2E9E44"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

/** One line per special effect, for the monster card. */
function effectLines(sp) {
  const out = [];
  if (sp.dmg) out.push(t('fx_dmg', { n: sp.dmg }));
  if (sp.heal) out.push(t('fx_heal', { n: sp.heal }));
  if (sp.shield) out.push(t('fx_shield', { n: sp.shield }));
  if (sp.drain) out.push(t('fx_drain', { n: sp.drain }));
  if (sp.freeze) out.push(t('fx_freeze'));
  if (sp.curse) out.push(t('fx_curse', { n: sp.curse.tick, k: sp.curse.turns }));
  if (sp.chain) out.push(t('fx_chain', { n: sp.chain }));
  if (sp.rows) out.push(sp.rows === 1 ? t('fx_rows1') : t('fx_rowsN', { n: sp.rows }));
  if (sp.convert) out.push(t('fx_convert', { n: sp.convert }));
  if (sp.col) out.push(sp.col === 1 ? t('fx_col1') : t('fx_colN', { n: sp.col }));
  if (sp.block) out.push(t('fx_block', { n: sp.block }));
  return out;
}

/** How to play's diagram: a swap lines up three fire gems, and the fire monster charges. */
function helpSVG() {
  const g = (k, x, y, s = 30) => `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 40 40">${gemSVG(k).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`;
  return `<svg viewBox="0 0 240 92" width="240" height="92" aria-hidden="true" class="ba-help-svg">
    ${g('fire', 6, 10)}${g('fire', 40, 10)}${g('water', 74, 10)}${g('fire', 74, 50)}
    <path d="M70 56c-10-6-10-22 0-28" class="ba-help-arrow"/><path d="M104 28c10 6 10 22 0 28" class="ba-help-arrow"/>
    <path d="M118 30h26" class="ba-help-arrow"/><path d="M140 24l8 6-8 6" class="ba-help-arrow"/>
    <svg x="152" y="0" width="80" height="80" viewBox="0 0 120 120">${monsterSVG('emberkit').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
    <text x="214" y="88" class="ba-help-plus">+3</text></svg>`;
}

/** Shrink a single-line label until it fits its box (never under 11px). */
function fitText(el, max = 15) {
  if (!el) return;
  let size = max;
  el.style.fontSize = size + 'px';
  while (size > 11 && el.scrollWidth > el.clientWidth + 0.5) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

class BattleArena {
  constructor(root) {
    this.root = root;
    this.settings = readSettings();
    this.disposed = false;
    this.gen = 0;              // bumped on every screen change: a stale animation chain stops
    this.screen = null;
    this.state = null;
    this.diff = 'easy';
    this.names = ['', ''];
    this.busy = false;
    this.sel = null;
    this.tiles = new Map();    // tile id -> element
    this.cell = 48;
    this.ui = null;
    this.offViewport = null;
    this.recorded = false;
    // ONLINE (2026-10-24, online-ui.js): `link` is the challenge or live room this match belongs to
    // (null vs the computer). `canon` is the match in the STORED frame (side 0 = 'a'); `state` is
    // what the screen draws, mirrored when this phone is side 'b' so its player is always on the
    // right (online.js mirror). Vs the computer the two are the same object.
    this.link = null;
    this.canon = null;
    this.inbox = [];
    this._bound = [];
    this._timers = new Set();
    this._screenBound = [];
  }

  // --- listener hygiene: destroy() must leave nothing behind ----------------------------------
  on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    this._bound.push([target, type, fn, opts]);
  }
  unbindAll() {
    for (const [tg, ty, fn, o] of this._bound) { try { tg.removeEventListener(ty, fn, o); } catch {} }
    this._bound = [];
  }
  later(fn, ms) {
    const id = setTimeout(() => { this._timers.delete(id); if (!this.disposed) fn(); }, ms);
    this._timers.add(id);
    return id;
  }
  clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    for (const id of this._intervals || []) clearInterval(id);
    if (this._intervals) this._intervals.clear();
  }
  /** A pause inside an animation chain. Resolves (never hangs) even after a screen change; the
   *  chain checks its generation after every await. */
  sleep(ms) {
    return new Promise((res) => {
      const id = setTimeout(() => { this._timers.delete(id); res(); }, Math.max(0, ms));
      this._timers.add(id);
    });
  }
  newScreen(name) {
    this.gen++;
    this.clearTimers();
    this.unbindAll();
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    this.screen = name;
    this.busy = false;
    this.sel = null;
    this.tiles = new Map();
    return this.gen;
  }

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('ba-root');
    // Read-only hook for headless drivers (Cup Pong's `__cpTest` precedent). Never read by the game.
    try { window.__baTest = this; } catch {}
    // ONLINE FIRST: a match handed over by the launcher / Multiplayer screen / a notification
    // (alert.js armOpen, armChallenge), or a live room this phone was in when it left. Both are
    // looked up synchronously so a vs-computer player downloads none of the online code.
    if (hasArmedOpen() || hasLiveRoom()) {
      const done = await this.openOnline({ armed: true });
      if (done || this.disposed) return;
    }
    const save = readSave();
    // A save is always resumed, even one whose last move WON: the match was saved before its
    // animation, so leaving during it means finish() never ran; resuming records it now (once).
    if (save) this.resume(save);
    else this.renderHome();
  }

  /** The online screens (online-ui.js, lazily imported). `armed`: only act on a handed-over match or
   *  a live room to resume; resolves true when it took the screen. */
  async openOnline(opts = {}) {
    let O;
    try { O = await import('./online-ui.js'); } catch (err) { console.error('[battle-arena] online did not load', err); return false; }
    if (this.disposed) return true;
    return O.open(this, opts);
  }

  /** The hub's "same game already open" hand-off (js/hub.js openArmed): a tapped notification or
   *  the Multiplayer screen names a match while this game is up. */
  openArmed() {
    if (this.disposed || (this.link && this.link.kind === 'live')) return;
    this.openOnline({ armed: true });
  }

  // --- home -------------------------------------------------------------------------------------
  renderHome() {
    this.newScreen('home');
    const s = this.settings;
    const seg = DIFFS.map((d) => `<button type="button" class="gh-seg__item" data-v="${d}" aria-pressed="${d === s.diff}">${diffShapeSVG(tierOf(d))}<span>${t(d)}</span></button>`).join('');
    this.root.innerHTML = `
      <div class="ba-home">
        <div class="ba-home-art" aria-hidden="true">
          <div class="ba-home-mon">${monsterSVG('emberkit')}</div>
          <div class="ba-home-mon ba-face-left">${monsterSVG('driplet')}</div>
        </div>
        <h1 class="ba-title">${t('title')}</h1>
        <div class="gh-card ba-home-card">
          <div class="gh-seg" role="group" data-role="diff">${seg}</div>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="play">${t('play')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block ba-online-btn" data-role="online">${t('online')}<span class="ba-badge-n" hidden></span></button>
        </div>
        <button type="button" class="ba-link" data-role="help">${t('help')}</button>
      </div>`;
    const g = this.root.querySelector('[data-role="diff"]');
    this.on(g, 'click', (e) => {
      const b = e.target.closest('.gh-seg__item');
      if (!b) return;
      for (const x of g.querySelectorAll('.gh-seg__item')) x.setAttribute('aria-pressed', String(x === b));
      this.settings.diff = b.dataset.v;
      writeJSON(SETTINGS_KEY, this.settings);          // persist on selection, not only at start
    });
    this.on(this.root.querySelector('[data-role="play"]'), 'click', () => this.renderDraft());
    this.on(this.root.querySelector('[data-role="online"]'), 'click', () => this.openOnline());
    this.on(this.root.querySelector('[data-role="help"]'), 'click', () => this.showHelp());
    this.paintOnlineBadge();
  }

  /** "Online 2": how many challenges wait on this player (alert.js, one small read). */
  async paintOnlineBadge() {
    const gen = this.gen;
    let n = 0;
    try { const A = await import('./alert.js'); await A.check(); n = A.myTurnCount(); } catch { return; }
    if (gen !== this.gen) return;
    const b = this.root.querySelector('.ba-online-btn .ba-badge-n');
    if (!b) return;
    b.hidden = !n;
    b.textContent = String(n);
  }

  showHelp() {
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    const lines = ['helpSwap', 'helpCharge', 'helpEx', 'helpFull', 'helpFour', 'helpFive', 'helpBerry', 'helpBomb', 'helpBoom', 'helpSudden'];
    el.innerHTML = `
      <div class="gh-modal ba-help" role="dialog" aria-modal="true" aria-label="${t('help')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <p class="ba-help-goal">${t('helpGoal')}</p>
        ${helpSVG()}
        ${lines.map((k) => `<p class="ba-help-line">${k === 'helpBerry' ? gemSVG('berry') : k === 'helpBomb' || k === 'helpBoom' ? gemSVG('bomb', k === 'helpBoom' ? 0 : 5) : ''}<span>${t(k)}</span></p>`).join('')}
      </div>`;
    this.root.appendChild(el);
    for (const p of el.querySelectorAll('.ba-help-line span, .ba-help-goal')) fitText(p, p.classList.contains('ba-help-goal') ? 16 : 14);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
  }

  // --- draft ------------------------------------------------------------------------------------
  /** The draft. Vs the computer by default; online passes `onFight(team)` (and `onBack`), and the
   *  player picks from THEIR OWN unlocked monsters either way. */
  renderDraft(opts = {}) {
    this.newScreen('draft');
    this.draftOpts = opts;
    const unlocked = unlockedIds(totalWins());
    this.unlocked = unlocked;
    this.picks = this.settings.team.filter((id) => unlocked.includes(id));
    const cells = MONSTERS.map((m) => {
      const locked = !unlocked.includes(m.id);
      return `<div class="ba-pick${locked ? ' is-locked' : ''}" role="button" tabindex="0" data-id="${m.id}"
          aria-label="${escapeHTML(m.name)}${locked ? ', ' + t('locked') : ''}">
          <div class="ba-pick-art">${monsterSVG(m.id)}</div>
          <span class="ba-pick-gem">${elementBadge(m.el)}</span>
          ${locked ? `<span class="ba-pick-name">${ICONS.lock}${m.unlock}</span>` : ''}
        </div>`;
    }).join('');
    this.root.innerHTML = `
      <div class="ba-draft">
        <div class="ba-draft-top">
          <button type="button" class="ba-iconbtn" data-role="back" aria-label="${t('back')}">${ICONS.back}</button>
          <div class="ba-slots">
            <div class="ba-slot" role="button" tabindex="0" data-slot="0"></div>
            <div class="ba-slot" role="button" tabindex="0" data-slot="1"></div>
          </div>
          <span class="ba-iconbtn-spacer"></span>
        </div>
        <div class="ba-grid">${cells}</div>
        <div class="ba-draft-actions">
          <button type="button" class="gh-btn gh-btn--ghost" data-role="random">${t('random')}</button>
          <button type="button" class="gh-btn gh-btn--primary" data-role="fight">${t('fight')}</button>
        </div>
      </div>`;
    this.paintDraft();
    const grid = this.root.querySelector('.ba-grid');
    const open = (e) => {
      const c = e.target.closest('.ba-pick');
      if (c) this.showCard(c.dataset.id, { draft: true });
    };
    this.on(grid, 'click', open);
    this.on(grid, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    this.on(this.root.querySelector('.ba-slots'), 'click', (e) => {
      const s = e.target.closest('.ba-slot');
      const id = s && this.picks[Number(s.dataset.slot)];
      if (id) this.showCard(id, { draft: true });
    });
    this.on(this.root.querySelector('[data-role="back"]'), 'click', () => (opts.onBack ? opts.onBack() : this.renderHome()));
    this.on(this.root.querySelector('[data-role="random"]'), 'click', () => {
      const pool = this.unlocked.slice();
      this.picks = [];
      while (this.picks.length < 2 && pool.length) this.picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      this.paintDraft();
    });
    this.on(this.root.querySelector('[data-role="fight"]'), 'click', () => {
      if (this.picks.length !== 2) return;
      this.settings.team = this.picks.slice();
      writeJSON(SETTINGS_KEY, this.settings);
      if (opts.onFight) opts.onFight(this.picks.slice());
      else this.startMatch(this.picks.slice());
    });
  }

  paintDraft() {
    const slots = this.root.querySelectorAll('.ba-slot');
    slots.forEach((el, i) => {
      const id = this.picks[i];
      el.classList.toggle('is-empty', !id);
      el.innerHTML = id ? `<div class="ba-slot-art">${monsterSVG(id)}</div><span class="ba-slot-gem">${elementBadge(BY_ID[id].el)}</span>` : '';
      el.setAttribute('aria-label', id ? BY_ID[id].name : String(i + 1));
    });
    for (const c of this.root.querySelectorAll('.ba-pick')) c.classList.toggle('is-on', this.picks.includes(c.dataset.id));
    const fight = this.root.querySelector('[data-role="fight"]');
    if (fight) fight.disabled = this.picks.length !== 2;
  }

  /** A monster's card: Normal / Evolved, HP, cost, special. In the draft it carries Pick/Remove. */
  showCard(id, { draft = false, evolved = false } = {}) {
    const m = BY_ID[id];
    if (!m) return;
    const locked = draft && !this.unlocked.includes(id);
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    let evo = !!evolved;
    const body = () => {
      const sp = specialOf(id, evo);
      const fx = effectLines(sp);
      if (m.el === 'all') fx.push(t('fx_half'));
      return `
        <div class="ba-card-art${evo ? ' is-evo' : ''}">${monsterSVG(id, evo)}</div>
        <h2 class="ba-card-name">${escapeHTML(monName(id, evo))}</h2>
        <div class="ba-card-stats">
          <span class="ba-card-stat" aria-label="${t('el_' + m.el)} ${m.cost}">${elementBadge(m.el)}<b>${m.cost}</b></span>
        </div>
        <div class="ba-card-sp">
          <b class="ba-card-spname">${t('sp_' + id + (evo ? '_evo' : ''))}</b>
          <span class="ba-card-fx">${fx.join(' · ')}</span>
        </div>`;
    };
    const action = !draft ? '' : locked
      ? `<p class="ba-card-lock">${ICONS.lock}<span>${t('winsN', { n: m.unlock })}</span></p>`
      : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="pick">${this.picks.includes(id) ? t('remove') : t('pick')}</button>`;
    el.innerHTML = `
      <div class="gh-modal ba-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(m.name)}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="gh-seg ba-card-tabs" role="group">
          <button type="button" class="gh-seg__item" data-evo="0" aria-pressed="${!evo}"><span>${t('normal')}</span></button>
          <button type="button" class="gh-seg__item" data-evo="1" aria-pressed="${evo}"><span>${t('evolved')}</span></button>
        </div>
        <div class="ba-card-body">${body()}</div>
        ${action}
      </div>`;
    this.root.appendChild(el);
    const fitAll = () => { for (const p of el.querySelectorAll('.ba-card-fx, .ba-card-spname, .ba-card-name')) fitText(p, p.classList.contains('ba-card-name') ? 22 : 15); };
    fitAll();
    const close = () => el.remove();
    this.on(el, 'click', (e) => { if (e.target === el) close(); });
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('.ba-card-tabs'), 'click', (e) => {
      const b = e.target.closest('.gh-seg__item');
      if (!b) return;
      evo = b.dataset.evo === '1';
      for (const x of el.querySelectorAll('.ba-card-tabs .gh-seg__item')) x.setAttribute('aria-pressed', String(x === b));
      el.querySelector('.ba-card-body').innerHTML = body();
      fitAll();
    });
    const pick = el.querySelector('[data-role="pick"]');
    this.on(pick, 'click', () => {
      if (this.picks.includes(id)) this.picks = this.picks.filter((x) => x !== id);
      else if (this.picks.length < 2) this.picks.push(id);
      else this.picks = [this.picks[1], id];
      this.paintDraft();
      close();
    });
  }

  // --- a match ----------------------------------------------------------------------------------
  startMatch(team) {
    const unlocked = unlockedIds(totalWins());
    const foe = chooseTeam(this.settings.diff, unlocked, team);
    let seed = 1;
    try { seed = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0; } catch { seed = Math.floor(Math.random() * 4294967296) >>> 0; }
    const state = E.newMatch({ seed, teams: [team, foe], first: this.settings.nextFirst });
    this.diff = this.settings.diff;
    this.link = null;
    this.state = this.canon = state;
    this.recorded = false;
    this.save();
    this.renderBattle();
  }

  resume(save) {
    this.diff = save.diff;
    this.link = null;
    this.state = this.canon = save.state;
    this.recorded = false;
    this.renderBattle();
  }

  /** An ONLINE match (online-ui.js): `canon` is the stored-frame state to start the screen on;
   *  `queue` the other person's entries still to animate on it (a challenge's latest run). */
  startOnline(link, canon, queue = []) {
    if (this.link && this.link !== link) { try { this.link.destroy(); } catch {} }
    this.link = link;
    this.diff = 'mp';
    this.canon = canon;
    this.state = this.view(canon);
    this.recorded = false;
    this.inbox = queue.slice();
    this.renderBattle();
  }

  /** What the screen draws: the stored state, mirrored when this phone plays side 'b'. */
  view(canon) { return this.link && this.link.seat === 1 ? mirror(canon) : canon; }

  /** Apply a move given in SCREEN terms (side ME / CPU) to the stored state. Returns the engine's
   *  answer with `state`/`events` in screen terms plus `canon` and the stored-frame `move`. */
  step(move) {
    const flip = !!(this.link && this.link.seat === 1);
    const cmove = { ...move, side: flip ? 1 - move.side : move.side };
    const res = E.apply(this.canon || this.state, cmove);
    if (!res.ok) return res;
    return { ok: true, canon: res.state, state: flip ? mirror(res.state) : res.state, events: flip ? mirrorEvents(res.events) : res.events, move: cmove };
  }

  save() {
    if (!this.state || this.link) return;            // the one save slot is the match vs the computer
    writeJSON(SAVE_KEY, { v: 1, diff: this.diff, state: this.state });
  }
  clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

  get foeName() {
    const p = (() => { try { return loadProfile(); } catch { return null; } })();
    const o = p && Array.isArray(p.opponents) ? p.opponents[0] : null;
    return (o && o.name) || t('computer');
  }

  // --- the battle screen --------------------------------------------------------------------------
  // Modelled on the reference recordings: the two teams' panels across the top (avatar, HP, berries)
  // with the move hexes between them, the four monsters on a stage (the other team on the LEFT, the
  // player on the RIGHT, facing each other), the board below. Every engine event is a beat of
  // animation: gems glow and burst, orbs fly to the monster they charge, a special is a full-width
  // banner then an attack and a hit, a turn change is a banner across the stage.
  renderBattle() {
    const gen = this.newScreen('battle');
    const prof = (() => { try { return loadProfile(); } catch { return null; } })();
    // Online: the other person by their PROFILE name and emoji, on the LEFT (never "You").
    const them = this.link ? this.link.them : null;
    this.names = [myName(), them ? (them.name || '?') : this.foeName];
    this.avatars = [(prof && prof.emoji) || '🙂', them ? (them.emoji || '🙂') : '🤖'];
    // The reference's top bar: each side shows its berries over its HP (big), then its avatar with
    // the name under it; the other team LEFT, the player RIGHT; MOVES in the middle under the clock.
    const team = (sd) => `
      <div class="ba-team" data-side="${sd}">
        <div class="ba-counts">
          <span class="ba-stat ba-stat-berry"><b class="ba-berry-n"></b>${ICONS.berry}</span>
          <span class="ba-stat ba-stat-hp"><b class="ba-hp-n"></b>${ICONS.heart}</span>
          <span class="ba-badges"></span>
        </div>
        <div class="ba-who">
          <div class="ba-avatar"><span>${escapeHTML(this.avatars[sd])}</span></div>
          <span class="ba-name">${escapeHTML(this.names[sd])}</span>
          ${sd === ME ? `<span class="ba-yourturn" hidden>${escapeHTML(t('yourTurn'))}</span>` : ''}
        </div>
      </div>`;
    const mon = (sd, mi) => `
      <div class="ba-mon ${mi === 0 ? 'is-back' : 'is-front'}" data-side="${sd}" data-mon="${mi}" role="button" tabindex="0">
        <div class="ba-plat"></div>
        <div class="ba-mon-art"><div class="ba-mon-bob"></div></div>
        <div class="ba-bar"><span class="ba-bar-gem"></span><span class="ba-bar-track"><i class="ba-bar-fill"></i><span class="ba-bar-txt"></span></span></div>
        <span class="ba-evo-pill" hidden>${ICONS.berry}<b>${t('evolve')}</b></span>
      </div>`;
    this.root.innerHTML = `
      <div class="ba-battle${this.link && this.link.foeUnknown ? ' is-foe-unknown' : ''}">
        <div class="ba-arena-bg" aria-hidden="true">${arenaSVG()}</div>
        <div class="ba-floor" aria-hidden="true"></div>
        <div class="ba-scene">
          <div class="ba-hubrow">
            <span class="ba-hubspace"></span>
            ${team(CPU)}
            <div class="ba-center">
              <div class="ba-clock" hidden><small>${escapeHTML(t('timer'))}</small><b class="ba-clock-n"></b></div>
            </div>
            ${team(ME)}
            <button type="button" class="ba-iconbtn ba-menu" aria-label="${t('menu')}">${ICONS.menu}</button>
          </div>
          <div class="ba-subrow">
            <span class="ba-chatslot"><span class="ba-presence" hidden></span></span>
            <div class="ba-movesbox"><div class="ba-moves" aria-live="polite"></div><span class="ba-moves-label">${escapeHTML(t('moves'))}</span></div>
            <button type="button" class="ba-stagebtn">${escapeHTML(t('stage'))}</button>
          </div>
          <div class="ba-field">${mon(CPU, 0)}${mon(CPU, 1)}${mon(ME, 0)}${mon(ME, 1)}</div>
        </div>
        <div class="ba-boardwrap"><div class="ba-board" role="application" aria-label="${t('board')}"></div></div>
        <div class="ba-fx" aria-hidden="true"></div>
      </div>`;
    for (const sd of [0, 1]) {
      this.state.sides[sd].mons.forEach((m, mi) => {
        const el = this.monEl(sd, mi);
        const def = BY_ID[m.id];
        el.querySelector('.ba-mon-bob').innerHTML = monsterSVG(m.id, m.evo);
        el.querySelector('.ba-mon-bob').dataset.evo = m.evo ? '1' : '0';
        el.querySelector('.ba-bar-gem').innerHTML = elementBadge(def.el);
        el.style.setProperty('--ba-el', def.el === 'all' ? '#C9A2F0' : ELEMENT_COLOR[def.el]);
        el.classList.toggle('is-all', def.el === 'all');
      });
    }
    this.hpShown = this.state.sides.map((x) => x.hp);
    this.bindBoard();
    this.on(this.root.querySelector('.ba-menu'), 'click', () => this.showPause());
    this.on(this.root.querySelector('.ba-stagebtn'), 'click', () => this.showStage());
    this.on(this.root.querySelector('.ba-field'), 'click', (e) => this.onMonTap(e));
    this.offViewport = onViewportResize(() => this.fit());
    this.fit();
    this.buildTiles();
    this.ui = null;
    this.syncAll();
    this.timed = !!(this.link && this.link.timed);   // the clock is for live rooms only (Matt)
    this.timerLeft = TURN_SECONDS;
    this.lastAct = Date.now();
    this.startClock(gen);
    requestAnimationFrame(() => { if (gen === this.gen) { this.fit(); this.placeAll(); } });
    const fresh = this.state.moveNo === 0 && this.state.turnNo === 1 && !this.inbox.length;
    if (this.link) { try { this.link.mountChat(this); } catch (err) { console.warn('[battle-arena] chat', err); } }
    this.busy = true;
    (async () => {
      await this.sleep(250);
      if (gen !== this.gen) return;
      if (fresh) {
        await this.stageIntro();
        if (gen !== this.gen) return;
        await this.turnBanner(this.state.turn);
        if (gen !== this.gen) return;
      }
      this.busy = false;
      this.timerLeft = TURN_SECONDS;
      this.next();
    })();
  }

  sideEl(sd) { return this.root.querySelector(`.ba-team[data-side="${sd}"]`); }
  monEl(sd, mi) { return this.root.querySelector(`.ba-mon[data-side="${sd}"][data-mon="${mi}"]`); }

  /** Board cell size and monster size, measured from the space really there. */
  fit() {
    const battle = this.root.querySelector('.ba-battle');
    const field = this.root.querySelector('.ba-field');
    if (!battle || !field) return;
    const W = battle.clientWidth, H = battle.clientHeight;
    if (!W || !H) { this.later(() => this.fit(), 50); return; }
    const byW = Math.floor((Math.min(W, 520) - 16) / E.COLS);
    const byH = Math.floor((H * 0.40) / E.ROWS);
    const cell = Math.max(34, Math.min(66, byW, byH));
    this.cell = cell;
    battle.style.setProperty('--ba-cell', cell + 'px');
    const fH = field.clientHeight, fW = field.clientWidth;
    // The floor starts just under the back monsters' tanks (the scene follows the layout).
    const floor = this.root.querySelector('.ba-floor');
    if (floor) floor.style.top = Math.round(field.offsetTop + fH * 0.47) + 'px';
    const art = Math.max(56, Math.min(150, Math.floor((fH - 2 * 30) / 1.9), Math.floor(fW * 0.3)));
    battle.style.setProperty('--ba-art', art + 'px');
    this.placeAll();
  }

  // --- the board ----------------------------------------------------------------------------------
  xy(i) { return `translate(${E.colOf(i) * this.cell}px, ${E.rowOf(i) * this.cell}px)`; }

  makeTile(tile) {
    const el = document.createElement('div');
    el.className = 'ba-tile';
    el.dataset.id = tile.id;
    el.dataset.k = tile.k;
    if (tile.k === 'bomb') el.dataset.n = String(tile.n);
    el.innerHTML = `<div class="ba-gem">${gemSVG(tile.k, tile.n)}</div>`;
    return el;
  }

  setTileArt(el, tile) {
    el.dataset.k = tile.k;
    if (tile.k === 'bomb') el.dataset.n = String(tile.n); else delete el.dataset.n;
    el.innerHTML = `<div class="ba-gem">${gemSVG(tile.k, tile.n)}</div>`;
  }

  buildTiles() {
    const board = this.root.querySelector('.ba-board');
    if (!board) return;
    board.innerHTML = '';
    this.tiles = new Map();
    this.state.board.forEach((tile, i) => {
      const el = this.makeTile(tile);
      el.style.transform = this.xy(i);
      board.appendChild(el);
      this.tiles.set(tile.id, el);
    });
  }

  placeAll() {
    if (!this.state || this.screen !== 'battle') return;
    this.state.board.forEach((tile, i) => {
      const el = this.tiles.get(tile.id);
      if (el) el.style.transform = this.xy(i);
    });
  }

  /** Make the DOM match the state exactly (after animations, on resume, as a guard against drift). */
  syncTiles(board = this.state.board) {
    const host = this.root.querySelector('.ba-board');
    if (!host) return;
    const keep = new Set();
    board.forEach((tile, i) => {
      keep.add(tile.id);
      let el = this.tiles.get(tile.id);
      if (!el || !el.isConnected) {
        el = this.makeTile(tile);
        host.appendChild(el);
        this.tiles.set(tile.id, el);
      } else if (el.dataset.k !== tile.k || (tile.k === 'bomb' && el.dataset.n !== String(tile.n))) {
        this.setTileArt(el, tile);
      }
      el.style.transform = this.xy(i);
      el.style.opacity = '';
      el.classList.remove('is-sel', 'is-cpu', 'is-hint', 'is-glow');
    });
    for (const [id, el] of this.tiles) {
      if (!keep.has(id)) { el.remove(); this.tiles.delete(id); }
    }
    for (const el of host.querySelectorAll('.ba-tile')) if (!keep.has(Number(el.dataset.id))) el.remove();
  }

  cellAt(clientX, clientY) {
    const board = this.root.querySelector('.ba-board');
    const r = board.getBoundingClientRect();
    const c = Math.floor((clientX - r.left) / this.cell);
    const row = Math.floor((clientY - r.top) / this.cell);
    if (c < 0 || c >= E.COLS || row < 0 || row >= E.ROWS) return -1;
    return E.idx(row, c);
  }

  canInput() {
    const s = this.state;
    return !!s && this.screen === 'battle' && !this.busy && s.winner == null && s.turn === ME;
  }

  /** Swipe a tile into its neighbour, or tap one then the other. Bound to the board only. */
  bindBoard() {
    const board = this.root.querySelector('.ba-board');
    let start = null;
    const down = (e) => {
      if (!this.canInput()) return;
      const i = this.cellAt(e.clientX, e.clientY);
      if (i < 0) return;
      this.poke();
      start = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
      try { board.setPointerCapture(e.pointerId); } catch {}
      if (e.cancelable) e.preventDefault();
    };
    const move = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < this.cell * 0.3) return;
      const i = start.i;
      start = null;
      let j;
      if (Math.abs(dx) > Math.abs(dy)) j = dx > 0 ? (E.colOf(i) < E.COLS - 1 ? i + 1 : -1) : (E.colOf(i) > 0 ? i - 1 : -1);
      else j = dy > 0 ? (E.rowOf(i) < E.ROWS - 1 ? i + E.COLS : -1) : (E.rowOf(i) > 0 ? i - E.COLS : -1);
      this.select(null);
      if (j >= 0) this.trySwap(i, j);
    };
    const up = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const i = start.i;
      start = null;
      this.tapCell(i);
    };
    const cancel = () => { start = null; };
    this.on(board, 'pointerdown', down);
    this.on(board, 'pointermove', move);
    this.on(board, 'pointerup', up);
    this.on(board, 'pointercancel', cancel);
  }

  /** The player did something: the hint waits again. */
  poke() {
    this.lastAct = Date.now();
    for (const el of this.root.querySelectorAll('.ba-tile.is-hint')) el.classList.remove('is-hint');
  }

  tapCell(i) {
    if (!this.canInput()) return;
    if (this.sel == null) { this.select(i); return; }
    if (this.sel === i) { this.select(null); return; }
    if (E.adjacent(this.sel, i)) { const a = this.sel; this.select(null); this.trySwap(a, i); return; }
    this.select(i);
  }

  select(i) {
    if (this.sel != null) {
      const t0 = this.state.board[this.sel];
      const el = t0 && this.tiles.get(t0.id);
      if (el) el.classList.remove('is-sel');
    }
    this.sel = i;
    if (i != null) {
      const el = this.tiles.get(this.state.board[i].id);
      if (el) el.classList.add('is-sel');
    }
  }

  async trySwap(a, b) {
    if (!this.canInput()) return;
    this.poke();
    const res = this.step({ type: 'swap', a, b, side: ME });
    if (!res.ok) {
      if (res.error === 'no-match') await this.badSwap(a, b);
      return;
    }
    await this.commit(res, true);
  }

  /** An illegal swap: the two tiles trade places and snap back. Costs nothing. */
  async badSwap(a, b) {
    const gen = this.gen;
    this.busy = true;
    const ea = this.tiles.get(this.state.board[a].id), eb = this.tiles.get(this.state.board[b].id);
    const go = (el, from, to) => el && el.animate([{ transform: this.xy(from) }, { transform: this.xy(to), offset: 0.45 }, { transform: this.xy(to), offset: 0.55 }, { transform: this.xy(from) }],
      { duration: SWAP_MS * 2.6, easing: 'ease-in-out' });
    go(ea, a, b); go(eb, b, a);
    await this.sleep(SWAP_MS * 2.6);
    if (gen === this.gen) this.busy = false;
  }

  /** A legal move: keep the new state (saved at once), then tell its story. */
  async commit(res, mine = false) {
    const gen = this.gen;
    this.state = res.state;
    this.canon = res.canon || res.state;
    this.save();
    // Online: this player's move goes out the moment it is made (before its animation), so the
    // other phone can start showing it while this one still is.
    if (mine && this.link && res.move) {
      try { this.link.send(entryOf(res.move), this.canon); } catch (err) { console.error('[battle-arena] could not send the move', err); }
    }
    this.busy = true;
    try {
      await this.play(res.events, gen);
    } catch (err) {
      console.error('[battle-arena] animation failed', err);
    }
    if (gen !== this.gen) return;
    this.syncTiles();
    this.syncAll();
    this.busy = false;
    this.lastAct = Date.now();
    this.timerLeft = TURN_SECONDS;     // the clock is per move
    this.next();
  }

  /** What happens now: the computer moves, the player chooses an evolution, or the match ends. */
  next() {
    const s = this.state;
    if (!s || this.screen !== 'battle' || this.busy) return;
    if (s.winner != null) { this.finish(); return; }
    if (s.turn === CPU) { if (this.link) this.pumpRemote(); else this.cpuTurn(); return; }
    this.syncAll();
  }

  // --- the other person's moves (online) ----------------------------------------------------------
  /** One stored entry from the other phone: queued, then played exactly as the computer's moves
   *  are (the two tiles light up, then the same swap, glow, orbs, specials and banners). */
  remoteEntry(entry) {
    this.inbox.push(entry);
    if (this.screen === 'battle' && !this.busy) this.pumpRemote();
  }

  async pumpRemote() {
    const s = this.state;
    if (!s || this.screen !== 'battle' || this.busy || !this.inbox.length) return;
    const entry = this.inbox[0];
    if (entry.k === 'r') { this.inbox.shift(); this.forceEnd(1 - (entry.by === 'b' ? 1 : 0)); return; }
    if (s.winner != null) return;
    const mv = moveOf(entry);
    const flip = this.link && this.link.seat === 1;
    if (!mv || (flip ? 1 - mv.side : mv.side) !== CPU || s.turn !== CPU) {
      // Not theirs to play now: the two phones disagree. Start again from the stored match.
      console.error('[battle-arena] an online move arrived out of turn; reloading the match', entry);
      this.inbox = [];
      if (this.link) this.link.resync();
      return;
    }
    this.inbox.shift();
    const gen = this.gen;
    this.busy = true;
    if (mv.type === 'swap') {
      for (const i of [mv.a, mv.b]) { const el = this.tiles.get(this.state.board[i].id); if (el) el.classList.add('is-cpu'); }
      await this.sleep(REMOTE_SHOW_MS);
      if (gen !== this.gen) return;
      for (const el of this.tiles.values()) el.classList.remove('is-cpu');
    }
    const res = this.step({ ...mv, side: CPU });
    if (!res.ok) {
      console.error('[battle-arena] an online move did not replay; reloading the match', res.error, entry);
      this.busy = false;
      this.inbox = [];
      if (this.link) this.link.resync();
      return;
    }
    this.busy = false;
    if (mv.type === 'evolve') this.hideEvolve();
    await this.commit(res);
  }

  /** A match decided outside the board (a resignation): `canonWinner` in the stored frame. */
  forceEnd(canonWinner) {
    if (!this.canon || this.canon.winner != null) return;
    this.canon = { ...this.canon, winner: canonWinner, resigned: 1 - canonWinner };
    this.state = this.view(this.canon);
    this.inbox = [];
    if (this.screen !== 'battle') return;
    this.busy = false;
    this.syncTiles();
    this.finish();
  }

  async cpuTurn() {
    const gen = this.gen;
    this.busy = true;
    await this.sleep(CPU_THINK_MS);
    if (gen !== this.gen) return;
    const mv = chooseMove(this.state, this.diff);
    if (!mv) { this.busy = false; return; }
    if (mv.type === 'swap') {
      for (const i of [mv.a, mv.b]) { const el = this.tiles.get(this.state.board[i].id); if (el) el.classList.add('is-cpu'); }
      await this.sleep(CPU_SHOW_MS);
      if (gen !== this.gen) return;
      for (const el of this.tiles.values()) el.classList.remove('is-cpu');
    }
    const res = E.apply(this.state, { ...mv, side: CPU });
    if (!res.ok) { console.error('[battle-arena] computer move refused', res.error, mv); this.busy = false; return; }
    this.busy = false;
    await this.commit(res);
  }

  onMonTap(e) {
    const mon = e.target.closest('.ba-mon');
    if (!mon) return;
    const sd = Number(mon.dataset.side), mi = Number(mon.dataset.mon);
    const s = this.state;
    const m = s.sides[sd].mons[mi];
    if (sd === ME && s.turn === ME && !this.busy && E.evolveOptions(s).includes(mi)) {
      const res = this.step({ type: 'evolve', mon: mi, side: ME });
      if (res.ok) { this.poke(); this.select(null); this.hideEvolve(); this.commit(res, true); }
      return;
    }
    if (this.busy) return;
    this.showCard(m.id, { evolved: m.evo });
  }

  hideEvolve() { for (const p of this.root.querySelectorAll('.ba-evo-pill')) p.hidden = true; for (const m of this.root.querySelectorAll('.ba-mon')) m.classList.remove('is-evo-pick'); }

  // --- the turn clock and the hint ----------------------------------------------------------------
  /** The move clock: 25 s a MOVE (reset after each), LIVE ONLINE MATCHES ONLY (Matt, 2026-10-24: never vs the
   *  computer). `this.timed` is false for every match today; when it is on, the clock runs only
   *  while the player can act and at 0 the turn passes. The same tick drives the idle hint. */
  startClock(gen) {
    let last = Date.now();
    const id = setInterval(() => {
      if (gen !== this.gen || this.disposed) { clearInterval(id); return; }
      const now = Date.now(), dt = (now - last) / 1000;
      last = now;
      const s = this.state;
      const clock = this.root.querySelector('.ba-clock');
      if (!s || !clock) return;
      const live = s.winner == null;
      const mine = live && s.turn === ME;
      // Live rooms show the clock on BOTH turns (the other person's runs here too, so it can be
      // seen ticking); only this phone's own clock ever passes a turn.
      clock.hidden = !this.timed || !live;
      if (!this.timed || !live) return;
      // A menu pauses the clock vs the computer only; online the other person is waiting.
      const paused = this.busy || (!this.link && !!this.root.querySelector('.gh-overlay'));
      if (!paused) this.timerLeft = Math.max(0, this.timerLeft - dt);
      const n = Math.ceil(this.timerLeft);
      const label = clock.querySelector('.ba-clock-n');
      if (label.textContent !== String(n)) label.textContent = String(n);
      clock.classList.toggle('is-low', n <= 5);
      clock.classList.toggle('is-them', !mine);
      if (mine && this.timerLeft <= 0 && !paused) {
        this.timerLeft = TURN_SECONDS;
        const res = this.step({ type: 'pass', side: ME });
        if (res.ok) { this.select(null); this.hideEvolve(); this.commit(res, true); }
        return;
      }
      // No idle hint: Matt turned it off (2026-10-24).
    }, 200);
    this._intervals = this._intervals || new Set();
    this._intervals.add(id);
  }

  // --- the HUD ------------------------------------------------------------------------------------
  syncAll() {
    const s = this.state;
    if (!s || this.screen !== 'battle') return;
    for (const sd of [0, 1]) {
      this.hpShown[sd] = s.sides[sd].hp;
      this.paintSide(sd);
      s.sides[sd].mons.forEach((_, mi) => this.paintMon(sd, mi));
    }
    this.ui = { turn: s.turn, left: s.movesLeft };
    this.paintTurn();
    const opts = s.turn === ME ? E.evolveOptions(s) : [];
    s.sides[ME].mons.forEach((m, mi) => {
      const el = this.monEl(ME, mi);
      if (!el) return;
      const on = opts.includes(mi);
      el.querySelector('.ba-evo-pill').hidden = !on;
      el.classList.toggle('is-evo-pick', on);
    });
  }

  paintSide(sd, hpOverride) {
    const el = this.sideEl(sd);
    const side = this.state.sides[sd];
    if (!el) return;
    const hp = hpOverride != null ? hpOverride : side.hp;
    el.querySelector('.ba-hp-n').textContent = String(hp);
    el.classList.toggle('is-low', hp <= side.maxHp * 0.25);
    el.querySelector('.ba-stat-hp').setAttribute('aria-label', `${t('hp')} ${hp} / ${side.maxHp}`);
    const allEvo = side.mons.every((m) => m.evo);
    const b = el.querySelector('.ba-stat-berry');
    b.hidden = allEvo;
    b.querySelector('.ba-berry-n').textContent = `${side.berries}/${BERRIES_TO_EVOLVE}`;
    b.setAttribute('aria-label', t('berries', { n: side.berries }));
    let badges = '';
    if (side.shield) badges += `<span class="ba-badge">${ICONS.shield}<b>${side.shield}</b></span>`;
    if (side.frozen) badges += `<span class="ba-badge">${ICONS.snow}</span>`;
    if (side.curse && side.curse.left > 0) badges += `<span class="ba-badge">${ICONS.hex}<b>${side.curse.left}</b></span>`;
    el.querySelector('.ba-badges').innerHTML = badges;
  }

  paintMon(sd, mi, energyOverride) {
    const el = this.monEl(sd, mi);
    const m = this.state.sides[sd].mons[mi];
    if (!el || !m) return;
    const bob = el.querySelector('.ba-mon-bob');
    if (bob.dataset.evo !== (m.evo ? '1' : '0')) { bob.innerHTML = monsterSVG(m.id, m.evo); bob.dataset.evo = m.evo ? '1' : '0'; }
    const cost = BY_ID[m.id].cost;
    const e = energyOverride != null ? energyOverride : m.energy;
    el.querySelector('.ba-bar-fill').style.transform = `scaleX(${Math.min(1, e / cost)})`;
    el.querySelector('.ba-bar-txt').textContent = `${e}/${cost}`;
    el.classList.toggle('is-full', e >= cost);
    el.setAttribute('aria-label', `${monName(m.id, m.evo)}, ${t('energy', { n: e, max: cost })}`);
  }

  /** The move hexes follow the STORY (this.ui, stepped by events as they play), never the final
   *  state, which is already a move ahead while the animation runs. */
  paintTurn() {
    const s = this.state;
    const ui = this.ui || { turn: s.turn, left: s.movesLeft };
    const box = this.root.querySelector('.ba-moves');
    if (!box) return;
    const over = s.winner != null && !this.busy;
    const n = over ? 0 : Math.max(MOVE_HEXES, ui.left);
    box.classList.toggle('is-cpu', ui.turn === CPU);
    box.innerHTML = Array.from({ length: n }, (_, i) => `<span class="ba-hex${i < ui.left ? ' is-on' : ''}"><svg viewBox="0 0 24 26" aria-hidden="true"><path d="M12 1.5 22.5 7.5v11L12 24.5 1.5 18.5v-11z"/></svg></span>`).join('');
    box.setAttribute('aria-label', t('movesLeft', { n: ui.left }));
    for (const sd of [0, 1]) {
      const el = this.sideEl(sd);
      if (el) el.classList.toggle('is-turn', !over && ui.turn === sd);
    }
    const yt = this.root.querySelector('.ba-yourturn');
    if (yt) yt.hidden = over || ui.turn !== ME;
    // As in the reference, the board dims while it is the other side's turn.
    const board = this.root.querySelector('.ba-board');
    if (board) board.classList.toggle('is-dim', !over && ui.turn !== ME);
  }

  /** The STAGE button: the arena's name and its rule (the reference's stage card). */
  showStage() {
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    el.innerHTML = `
      <div class="gh-modal ba-stagecard" role="dialog" aria-modal="true" aria-label="${escapeHTML(t('stage_boiler'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="ba-stage-hex">${gemSVG('bomb', 5)}</div>
        <b class="ba-stage-name">${escapeHTML(t('stage_boiler'))}</b>
        <p class="ba-help-line">${gemSVG('bomb', 5)}<span>${escapeHTML(t('helpBomb'))}</span></p>
        <p class="ba-help-line">${gemSVG('bomb', 0)}<span>${escapeHTML(t('helpBoom'))}</span></p>
      </div>`;
    this.root.appendChild(el);
    for (const p of el.querySelectorAll('.ba-help-line span')) fitText(p, 15);
    const close = () => el.remove();
    this.on(el, 'click', (e) => { if (e.target === el) close(); });
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
  }

  // --- effects ------------------------------------------------------------------------------------
  fxLayer() { return this.root.querySelector('.ba-fx'); }

  /** Centre of an element (or of a board cell) relative to the battle screen. */
  centre(el) {
    const host = this.root.querySelector('.ba-battle');
    if (!el || !host) return { x: 0, y: 0 };
    const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
  }
  cellCentre(i) {
    const board = this.root.querySelector('.ba-board');
    const host = this.root.querySelector('.ba-battle');
    if (!board || !host) return { x: 0, y: 0 };
    const a = board.getBoundingClientRect(), b = host.getBoundingClientRect();
    return { x: a.left - b.left + (E.colOf(i) + 0.5) * this.cell, y: a.top - b.top + (E.rowOf(i) + 0.5) * this.cell };
  }

  fx(cls, html = '', at = null) {
    const layer = this.fxLayer();
    if (!layer) return null;
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    if (at) { d.style.left = at.x + 'px'; d.style.top = at.y + 'px'; }
    layer.appendChild(d);
    return d;
  }

  /** Big outlined text that pops in and floats up (the reference's "-10 DMG", "EXTRA MOVE!"). */
  pop(at, html, cls = '', ms = 1100) {
    const d = this.fx('ba-pop ' + cls, html, at);
    if (!d) return;
    const rm = reducedMotion();
    d.animate(rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.18)', opacity: 1, offset: 0.14 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.26 }, { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.82 },
        { transform: 'translate(-50%, -100%) scale(.9)', opacity: 0 }],
    { duration: ms, easing: 'ease-out' }).finished.catch(() => {}).then(() => d.remove());
  }

  /** Little sparks flying out of a point. */
  burst(at, color, n = 7, spread = 34, size = 8) {
    if (reducedMotion()) return;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
      const r = spread * (0.6 + Math.random() * 0.6);
      const d = this.fx('ba-spark', '', at);
      if (!d) return;
      d.style.background = color;
      d.style.width = d.style.height = size + 'px';
      d.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.2)`, opacity: 0 }],
        { duration: 420 + Math.random() * 160, easing: 'cubic-bezier(.2,.8,.3,1)' }).finished.catch(() => {}).then(() => d.remove());
    }
  }

  /** A glowing orb flying on a curve from `a` to `b`; resolves when it lands. */
  orb(a, b, color, delay = 0, ms = 520) {
    return new Promise((res) => {
      const d = this.fx('ba-orb', '', a);
      if (!d || reducedMotion()) { if (d) d.remove(); res(); return; }
      d.style.setProperty('--c', color);
      const mx = (a.x + b.x) / 2 + (a.x < b.x ? -40 : 40), my = Math.min(a.y, b.y) - 60;
      const frames = [];
      for (let k = 0; k <= 10; k++) {
        const u = k / 10;
        const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x;
        const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y;
        frames.push({ transform: `translate(${x - a.x}px, ${y - a.y}px) translate(-50%, -50%) scale(${1 - u * 0.35})`, opacity: u > 0.92 ? 0.6 : 1 });
      }
      d.animate(frames, { duration: ms, delay, easing: 'ease-in', fill: 'backwards' }).finished.catch(() => {}).then(() => { d.remove(); res(); });
    });
  }

  shake(el, amp = 6, ms = 340) {
    if (!el || reducedMotion()) return;
    el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${-amp}px, ${amp / 3}px)` }, { transform: `translate(${amp}px, ${-amp / 3}px)` },
      { transform: `translate(${-amp / 2}px, 0)` }, { transform: 'translate(0,0)' }], { duration: ms, easing: 'ease-out' });
  }

  flash(el, color = '#fff') {
    if (!el || reducedMotion()) return;
    el.animate([{ filter: 'brightness(1)' }, { filter: `brightness(2.6) drop-shadow(0 0 10px ${color})` }, { filter: 'brightness(1)' }, { filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }],
      { duration: 420, easing: 'linear' });
  }

  /** Count a team's HP number from what is shown to `to`. */
  tweenHP(sd, to) {
    const from = this.hpShown[sd];
    this.hpShown[sd] = to;
    if (from === to || reducedMotion()) { this.paintSide(sd, to); return; }
    const t0 = performance.now(), ms = 450;
    const step = (now) => {
      if (this.screen !== 'battle') return;
      const u = Math.min(1, (now - t0) / ms);
      this.paintSide(sd, Math.round(from + (to - from) * u));
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** "Boiler Room": the arena's name in a hexagon, as the reference's stage reveal. */
  async stageIntro() {
    const d = this.fx('ba-stage', `<div class="ba-stage-hex">${gemSVG('bomb', 5)}</div><b class="ba-stage-name">${escapeHTML(t('stage_boiler'))}</b>`);
    if (!d) return;
    const a = d.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.18 }, { opacity: 1, transform: 'scale(1)', offset: 0.3 },
      { opacity: 1, transform: 'scale(1)', offset: 0.82 }, { opacity: 0, transform: 'scale(1.1)' }], { duration: 1600, easing: 'ease-out' });
    await a.finished.catch(() => {});
    d.remove();
    if (reducedMotion()) return;
    // The doors: shut over the screen, then open on the arena.
    const doors = document.createElement('div');
    doors.className = 'ba-doors';
    doors.innerHTML = '<div class="ba-door"></div><div class="ba-door"></div>';
    this.root.querySelector('.ba-battle').appendChild(doors);
    const [l, r] = doors.children;
    await Promise.all([
      l.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished,
      r.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished,
    ]).catch(() => {});
    this.shake(doors, 4, 200);
    await this.sleep(320);
    await Promise.all([
      l.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { duration: 420, easing: 'ease-out', fill: 'forwards' }).finished,
      r.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 420, easing: 'ease-out', fill: 'forwards' }).finished,
    ]).catch(() => {});
    doors.remove();
  }

  /** "<name>'s turn." on a white strip that slides across the stage. */
  async turnBanner(sd) {
    const scene = this.root.querySelector('.ba-boardwrap');
    const d = this.fx('ba-tbanner' + (sd === ME ? ' is-me' : ''), `<span class="ba-tbanner-av">${escapeHTML(this.avatars[sd])}</span><b>${escapeHTML(t('turnOf', { name: this.names[sd] }))}</b>`);
    if (!d || !scene) return;
    d.style.top = (this.centre(scene).y - scene.offsetHeight / 2 - 6) + 'px';
    fitText(d.querySelector('b'), 22);
    const rm = reducedMotion();
    const a = d.animate(rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [{ transform: 'translate(100%, -50%)' }, { transform: 'translate(0, -50%)', offset: 0.2 }, { transform: 'translate(0, -50%)', offset: 0.8 }, { transform: 'translate(-100%, -50%)' }],
    { duration: TURN_BANNER_MS, easing: 'cubic-bezier(.2,.8,.3,1)' });
    await a.finished.catch(() => {});
    d.remove();
  }

  /** The special's banner: a white slab across the stage, the monster big at its edge, the move's
   *  name in its element's colour, speed lines behind; the monster lunges as it ends. */
  async specialBanner(sd, mi, id, evo) {
    const field = this.root.querySelector('.ba-boardwrap');
    const el = BY_ID[id].el;
    const color = el === 'all' ? '#9b6fe0' : ELEMENT_COLOR[el];
    const d = this.fx('ba-sbanner' + (sd === ME ? ' is-me' : ''), `<div class="ba-sbanner-lines"></div><div class="ba-sbanner-slab"><b class="ba-sbanner-name">${escapeHTML(t('sp_' + id + (evo ? '_evo' : '')))}</b></div><div class="ba-sbanner-art">${monsterSVG(id, evo)}</div>`);
    if (!d || !field) return;
    d.style.setProperty('--c', color);
    d.style.top = (this.centre(field).y - field.offsetHeight / 2 - 10) + 'px';
    fitText(d.querySelector('.ba-sbanner-name'), 30);
    const dim = this.fx('ba-dim');
    const rm = reducedMotion();
    const from = sd === ME ? '100%' : '-100%', to = sd === ME ? '-100%' : '100%';
    dim && dim.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: SPECIAL_MS, fill: 'forwards' });
    const a = d.animate(rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [{ transform: `translate(${from}, -50%)` }, { transform: 'translate(0, -50%)', offset: 0.16 }, { transform: 'translate(0, -50%)', offset: 0.84 }, { transform: `translate(${to}, -50%)` }],
    { duration: SPECIAL_MS, easing: 'cubic-bezier(.2,.8,.3,1)' });
    await a.finished.catch(() => {});
    d.remove();
    if (dim) dim.remove();
    const mon = this.monEl(sd, mi);
    if (mon && !rm) {
      mon.querySelector('.ba-mon-art').animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${sd === ME ? -26 : 26}px, -6px) scale(1.15)`, offset: 0.45 }, { transform: 'translate(0,0) scale(1)' }],
        { duration: 380, easing: 'ease-out' });
      await this.sleep(170);
    }
  }

  /** The middle of a team's two monsters (where a hit lands). */
  teamCentre(sd) {
    const a = this.centre(this.monEl(sd, 0) && this.monEl(sd, 0).querySelector('.ba-mon-art'));
    const b = this.centre(this.monEl(sd, 1) && this.monEl(sd, 1).querySelector('.ba-mon-art'));
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  teamArts(sd) { return [0, 1].map((mi) => this.monEl(sd, mi)).filter(Boolean).map((m) => m.querySelector('.ba-mon-art')); }
  hpAt(sd) { const el = this.sideEl(sd); return this.centre(el && el.querySelector('.ba-stat-hp')); }

  /** A projectile from the attacker to the other team: an element-coloured ball with a trail. */
  async projectile(sd, mi) {
    const from = this.centre(this.monEl(sd, mi) && this.monEl(sd, mi).querySelector('.ba-mon-art'));
    const to = this.teamCentre(1 - sd);
    const m = this.state.sides[sd].mons[mi];
    const el = BY_ID[m.id].el;
    const color = el === 'all' ? '#ffffff' : ELEMENT_COLOR[el];
    if (reducedMotion()) return;
    const d = this.fx('ba-proj', '', from);
    if (!d) return;
    d.style.setProperty('--c', color);
    const dx = to.x - from.x, dy = to.y - from.y;
    const trail = (delay) => {
      const t2 = this.fx('ba-proj is-trail', '', from);
      if (!t2) return;
      t2.style.setProperty('--c', color);
      t2.animate([{ transform: 'translate(-50%, -50%) scale(.8)', opacity: 0.7 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0 }],
        { duration: PROJ_MS, delay, easing: 'ease-in', fill: 'backwards' }).finished.catch(() => {}).then(() => t2.remove());
    };
    trail(40); trail(80);
    await d.animate([{ transform: 'translate(-50%, -50%) scale(.6)' }, { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 30}px)) scale(1.2)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)` }], { duration: PROJ_MS, easing: 'ease-in' }).finished.catch(() => {});
    d.remove();
    this.burst(to, color, 12, 60, 10);
    const ring = this.fx('ba-ring', '', to);
    if (ring) {
      ring.style.setProperty('--c', color);
      ring.animate([{ transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%, -50%) scale(2.2)', opacity: 0 }], { duration: 420, easing: 'ease-out' })
        .finished.catch(() => {}).then(() => ring.remove());
    }
  }

  /** A row/column blast on the board from a bomb. */
  blast(at, boom) {
    const p = this.cellCentre(at);
    const board = this.root.querySelector('.ba-board');
    const c = this.cell;
    if (board) {
      for (const [cls, style] of [['is-row', { top: E.rowOf(at) * c + 'px', height: c + 'px' }], ['is-col', { left: E.colOf(at) * c + 'px', width: c + 'px' }]]) {
        const d = document.createElement('div');
        d.className = 'ba-beam ' + cls;
        Object.assign(d.style, style);
        board.appendChild(d);
        d.animate([{ opacity: 0, transform: cls === 'is-row' ? 'scaleX(.1)' : 'scaleY(.1)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { opacity: 0, transform: 'scale(1)' }],
          { duration: 480, easing: 'ease-out' }).finished.catch(() => {}).then(() => d.remove());
      }
    }
    this.burst(p, '#ffb02e', 14, 70, 11);
    this.burst(p, '#ff5a1f', 8, 40, 9);
    this.shake(this.root.querySelector('.ba-boardwrap'), boom ? 9 : 6, 380);
  }

  /** Four berries: the reference's full-screen evolution. The old form flickers into the new one. */
  async evolveScene(sd, mi, id) {
    const rm = reducedMotion();
    const d = this.fx('ba-evo', `<div class="ba-evo-rays"></div><div class="ba-evo-art"><div class="ba-evo-old">${monsterSVG(id, false)}</div><div class="ba-evo-new">${monsterSVG(id, true)}</div></div><b class="ba-evo-txt">${escapeHTML(t('evolvedInto', { a: monName(id, false), b: monName(id, true) }))}</b>`);
    if (!d) return;
    if (sd === ME) d.classList.add('is-me');
    fitText(d.querySelector('.ba-evo-txt'), 22);
    const oldEl = d.querySelector('.ba-evo-old'), newEl = d.querySelector('.ba-evo-new'), txt = d.querySelector('.ba-evo-txt');
    newEl.style.opacity = '0';
    txt.style.opacity = '0';
    await d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' }).finished.catch(() => {});
    if (!rm) {
      // Flicker, faster and faster, between the two silhouettes.
      const steps = [220, 190, 160, 130, 100, 80, 65, 55];
      oldEl.classList.add('is-sil'); newEl.classList.add('is-sil');
      for (let k = 0; k < steps.length; k++) {
        oldEl.style.opacity = k % 2 ? '1' : '0';
        newEl.style.opacity = k % 2 ? '0' : '1';
        await this.sleep(steps[k]);
      }
      oldEl.style.opacity = '0'; newEl.style.opacity = '1';
      const flash = this.fx('ba-evo-flash');
      if (flash) flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' }).finished.catch(() => {}).then(() => flash.remove());
      newEl.classList.remove('is-sil');
      newEl.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.12)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
    } else {
      oldEl.style.opacity = '0'; newEl.style.opacity = '1';
    }
    txt.style.opacity = '1';
    this.paintMon(sd, mi);
    await this.sleep(rm ? 900 : 1300);
    await d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.catch(() => {});
    d.remove();
  }

  // --- the story of a move ----------------------------------------------------------------------
  async play(events, gen) {
    const rm = reducedMotion();
    let extra = false;
    let landed = Promise.resolve();      // the orbs of the last clear; a special waits for them
    let attacker = null;                 // the monster whose special is playing
    for (let k = 0; k < events.length; k++) {
      if (gen !== this.gen) return;
      const e = events[k];
      switch (e.t) {
        case 'swap': {
          if (this.ui) this.ui.left = Math.max(0, this.ui.left - 1);
          const [idA, idB] = e.ids;           // idA now sits at b, idB at a
          const ea = this.tiles.get(idA), eb = this.tiles.get(idB);
          for (const [el, from, to] of [[ea, e.a, e.b], [eb, e.b, e.a]]) {
            if (!el) continue;
            el.style.transform = this.xy(to);
            el.animate([{ transform: this.xy(from) }, { transform: this.xy(to) }], { duration: SWAP_MS, easing: 'ease-in-out' });
          }
          this.paintTurn();
          await this.sleep(SWAP_MS + 30);
          break;
        }
        case 'extra':
          extra = true;
          if (this.ui) this.ui.left += 1;
          break;
        case 'bomb':
          this.blast(e.at, e.boom);
          await this.sleep(rm ? 120 : 300);
          break;
        case 'rows': {
          const board = this.root.querySelector('.ba-board');
          for (const r of e.rows) {
            const d = document.createElement('div');
            d.className = 'ba-beam is-row is-fire';
            d.style.top = r * this.cell + 'px';
            d.style.height = this.cell + 'px';
            board.appendChild(d);
            d.animate([{ opacity: 0, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.3 }, { opacity: 0 }], { duration: 520 }).finished.catch(() => {}).then(() => d.remove());
            for (let c = 0; c < E.COLS; c++) this.burst(this.cellCentre(E.idx(r, c)), '#ff7a2a', 4, 26, 7);
          }
          await this.sleep(320);
          break;
        }
        case 'cols': case 'block': {
          const board = this.root.querySelector('.ba-board');
          const cells = e.t === 'block' ? e.cells : e.cols.flatMap((c) => Array.from({ length: E.ROWS }, (_, r) => E.idx(r, c)));
          if (e.t === 'cols' && board) {
            for (const c of e.cols) {
              const d = document.createElement('div');
              d.className = 'ba-beam is-col is-fire';
              d.style.left = c * this.cell + 'px';
              d.style.width = this.cell + 'px';
              board.appendChild(d);
              d.animate([{ opacity: 0, transform: 'scaleY(.1)' }, { opacity: 1, transform: 'scaleY(1)', offset: 0.3 }, { opacity: 0 }], { duration: 520 }).finished.catch(() => {}).then(() => d.remove());
            }
          }
          for (const i of cells) this.burst(this.cellCentre(i), e.t === 'block' ? '#ffe070' : '#ff7a2a', 4, 26, 7);
          if (e.t === 'block') this.shake(this.root.querySelector('.ba-boardwrap'), 5, 300);
          await this.sleep(rm ? 120 : 320);
          break;
        }
        case 'clear': {
          // What this clear gave: the charges and berries ride along with it.
          const gains = [];
          while (k + 1 < events.length && ['energy', 'berry'].includes(events[k + 1].t)) gains.push(events[++k]);
          const cells = e.cells.map((i, n) => ({ i, id: e.ids[n], el: this.tiles.get(e.ids[n]) })).filter((c) => c.el);
          for (const c of cells) { c.k = c.el.dataset.k; c.at = this.cellCentre(c.i); }
          // 1. glow
          for (const c of cells) c.el.classList.add('is-glow');
          if (extra) {
            // As in the reference: "EXTRA MOVE!" shows while the matched tiles still glow.
            extra = false;
            const board = this.root.querySelector('.ba-board');
            this.pop(this.centre(board), escapeHTML(t('extraMove')), 'is-extra', 1300);
            this.paintTurn();
            const box = this.root.querySelector('.ba-moves');
            if (box && !rm) box.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 520 });
          }
          await this.sleep(rm ? 60 : GLOW_MS + 120);
          if (gen !== this.gen) return;
          // 2. burst
          for (const c of cells) {
            this.tiles.delete(c.id);
            const base = c.el.style.transform;
            c.el.animate(rm ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: base + ' scale(1.15)', opacity: 1 }, { transform: base + ' scale(.1)', opacity: 0 }],
              { duration: POP_MS, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {}).then(() => c.el.remove());
            if (c.k !== 'bomb') this.burst(c.at, c.k === 'berry' ? '#e0405e' : ELEMENT_COLOR[c.k], 5, 26, 7);
          }
          // 3. orbs to whoever they charge
          const flights = [];
          for (const g of gains) {
            if (g.t === 'energy') {
              const mon = this.monEl(g.side, g.mon);
              const from = cells.filter((c) => g.k === 'all' ? E.isGem({ k: c.k }) : c.k === g.k).slice(0, 7);
              const to = this.centre(mon && mon.querySelector('.ba-bar'));
              const color = g.k === 'all' ? '#ffffff' : ELEMENT_COLOR[g.k];
              const all = from.map((c, n) => this.orb(c.at, to, color, n * 45));
              flights.push(Promise.all(all).then(() => {
                if (gen !== this.gen) return;
                this.paintMon(g.side, g.mon, g.energy);
                if (mon && !rm) mon.querySelector('.ba-bar').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 300 });
                const art = mon && mon.querySelector('.ba-mon-art');
                this.pop({ x: this.centre(art).x, y: this.centre(art).y - this.artSize() * 0.45 }, `<b>${g.n}</b>${elementBadge(g.k)}`, 'is-count', 1000);
              }));
            } else if (g.t === 'berry') {
              const stat = this.sideEl(g.side) && this.sideEl(g.side).querySelector('.ba-stat-berry');
              const to = this.centre(stat);
              const from = cells.filter((c) => c.k === 'berry').slice(0, 7);
              flights.push(Promise.all(from.map((c, n) => this.orb(c.at, to, '#e0405e', n * 45))).then(() => {
                if (gen !== this.gen) return;
                if (stat) stat.querySelector('.ba-berry-n').textContent = `${g.berries}/${BERRIES_TO_EVOLVE}`;
                if (stat && !rm) stat.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320 });
                this.pop({ x: to.x, y: to.y + 26 }, `<b>+${g.n}</b>${ICONS.berry}`, 'is-count is-berry', 1000);
              }));
            }
          }
          landed = Promise.all(flights);
          await this.sleep(rm ? 80 : POP_MS);
          break;
        }
        case 'fall': {
          const host = this.root.querySelector('.ba-board');
          let longest = 0;
          for (const m of e.moves) {
            const el = this.tiles.get(m.id);
            if (!el) continue;
            const rows = E.rowOf(m.to) - E.rowOf(m.from);
            const ms = FALL_BASE_MS + rows * FALL_ROW_MS;
            longest = Math.max(longest, ms);
            el.style.transform = this.xy(m.to);
            el.animate([{ transform: this.xy(m.from) }, { transform: this.xy(m.to) }], { duration: ms, easing: 'cubic-bezier(.45,0,.6,1.35)' });
          }
          for (const sp of e.spawns) {
            const el = this.makeTile(sp);
            el.style.transform = this.xy(sp.to);
            host.appendChild(el);
            this.tiles.set(sp.id, el);
            const rows = E.rowOf(sp.to) - sp.fromRow;
            const ms = FALL_BASE_MS + rows * FALL_ROW_MS;
            longest = Math.max(longest, ms);
            const from = `translate(${E.colOf(sp.to) * this.cell}px, ${sp.fromRow * this.cell}px)`;
            el.animate([{ transform: from, opacity: 0 }, { transform: from, opacity: 1, offset: 0.05 }, { transform: this.xy(sp.to), opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.45,0,.6,1.35)' });
          }
          await this.sleep(longest + 40);
          break;
        }
        case 'energy': {
          // A charge that did not come from a clear (Chain Bolt's gift to the partner).
          const mon = this.monEl(e.side, e.mon);
          this.paintMon(e.side, e.mon, e.energy);
          const art = mon && mon.querySelector('.ba-mon-art');
          this.pop({ x: this.centre(art).x, y: this.centre(art).y - this.artSize() * 0.45 }, `<b>+${e.n}</b>${elementBadge(e.k)}`, 'is-count', 1000);
          await this.sleep(300);
          break;
        }
        case 'berry': {
          const stat = this.sideEl(e.side) && this.sideEl(e.side).querySelector('.ba-stat-berry');
          if (stat) stat.querySelector('.ba-berry-n').textContent = `${e.berries}/${BERRIES_TO_EVOLVE}`;
          break;
        }
        case 'special': {
          await landed;
          if (gen !== this.gen) return;
          this.paintMon(e.side, e.mon);
          attacker = { side: e.side, mon: e.mon };
          const mon = this.monEl(e.side, e.mon);
          if (mon) mon.classList.add('is-full');
          await this.specialBanner(e.side, e.mon, e.id, e.evo);
          if (gen !== this.gen) return;
          this.paintMon(e.side, e.mon, 0);
          break;
        }
        case 'damage': {
          const sd = e.side;
          if (e.cause === 'special' && attacker) {
            await this.projectile(attacker.side, attacker.mon);
            if (gen !== this.gen) return;
          } else if (e.cause === 'curse') {
            this.burst(this.teamCentre(sd), '#9b6fe0', 12, 60, 9);
          }
          for (const a of this.teamArts(sd)) { this.flash(a, '#fff'); this.shake(a, 8, 380); }
          this.shake(this.root.querySelector('.ba-scene'), 4, 300);
          if (e.absorbed) this.pop({ x: this.hpAt(sd).x, y: this.hpAt(sd).y + 34 }, `${ICONS.shield}<b>-${e.absorbed}</b>`, 'is-shield', 1100);
          if (e.n) this.pop({ x: this.hpAt(sd).x, y: this.hpAt(sd).y + (e.absorbed ? 62 : 38) }, `<b>-${e.n}</b><small>${escapeHTML(t('dmg'))}</small>`, 'is-dmg', 1300);
          this.tweenHP(sd, e.hp);
          this.paintSide(sd, e.hp);
          await this.sleep(rm ? 250 : 620);
          break;
        }
        case 'heal': {
          const sd = e.side;
          if (!rm) for (const a of this.teamArts(sd)) { const p = this.centre(a); for (let n = 0; n < 6; n++) this.healSpark(p, n); }
          const at = this.hpAt(sd);
          if (e.blocked) this.pop({ x: at.x, y: at.y + 38 }, escapeHTML(t('noHeal')), 'is-note', 1200);
          else {
            if (e.n) this.pop({ x: at.x, y: at.y + 38 }, `<b>+${e.n}</b><small>${escapeHTML(t('healTxt'))}</small>`, 'is-heal', 1300);
            if (e.capped) this.later(() => this.pop({ x: at.x, y: at.y + (e.n ? 66 : 38) }, escapeHTML(t('maxHp')), 'is-max', 1200), e.n ? 260 : 0);
            this.tweenHP(sd, e.hp);
          }
          await this.sleep(rm ? 250 : 620);
          break;
        }
        case 'shield': {
          for (const a of this.teamArts(e.side)) {
            const b = this.fx('ba-bubble', '', this.centre(a));
            if (b) b.animate([{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }],
              { duration: 800, easing: 'ease-out' }).finished.catch(() => {}).then(() => b.remove());
          }
          this.pop({ x: this.hpAt(e.side).x, y: this.hpAt(e.side).y + 38 }, `${ICONS.shield}<b>+${e.n}</b>`, 'is-shield', 1200);
          this.paintSide(e.side);
          await this.sleep(rm ? 200 : 520);
          break;
        }
        case 'drain': {
          const mon = this.monEl(e.side, e.mon);
          if (e.n) {
            const art = mon && mon.querySelector('.ba-mon-art');
            this.burst(this.centre(mon && mon.querySelector('.ba-bar')), '#9b6fe0', 8, 34, 8);
            this.pop({ x: this.centre(art).x, y: this.centre(art).y - this.artSize() * 0.45 }, `<b>-${e.n}</b>${elementBadge(BY_ID[this.state.sides[e.side].mons[e.mon].id].el)}`, 'is-count is-drain', 1000);
          }
          this.paintMon(e.side, e.mon, e.energy);
          await this.sleep(rm ? 120 : 260);
          break;
        }
        case 'freeze': {
          for (const a of this.teamArts(e.side)) {
            a.classList.add('is-frozen');
            this.burst(this.centre(a), '#bfe6ff', 10, 50, 8);
          }
          this.later(() => { for (const a of this.root.querySelectorAll('.ba-mon-art.is-frozen')) a.classList.remove('is-frozen'); }, 1400);
          this.paintSide(e.side);
          await this.sleep(rm ? 200 : 520);
          break;
        }
        case 'curse':
          for (const a of this.teamArts(e.side)) this.burst(this.centre(a), '#9b6fe0', 10, 46, 8);
          this.paintSide(e.side);
          await this.sleep(rm ? 120 : 380);
          break;
        case 'curseTick':
          this.paintSide(e.side);
          break;
        case 'convert': {
          for (const i of e.cells) {
            const tile = e.board[i];
            const el = this.tiles.get(tile.id);
            if (!el) continue;
            this.setTileArt(el, tile);
            this.burst(this.cellCentre(i), ELEMENT_COLOR.leaf, 5, 24, 7);
            if (!rm) el.animate([{ transform: this.xy(i) + ' scale(0.3)' }, { transform: this.xy(i) + ' scale(1.2)', offset: 0.6 }, { transform: this.xy(i) }], { duration: 360, easing: 'ease-out' });
          }
          await this.sleep(380);
          break;
        }
        case 'evolveReady':
          await landed;
          this.syncAll();
          break;
        case 'evolve': {
          await landed;
          if (gen !== this.gen) return;
          this.hideEvolve();
          await this.evolveScene(e.side, e.mon, e.id);
          if (gen !== this.gen) return;
          this.paintMon(e.side, e.mon);
          const sd = this.sideEl(e.side);
          if (sd) sd.querySelector('.ba-berry-n').textContent = `0/${BERRIES_TO_EVOLVE}`;
          this.paintSide(e.side, e.hp);
          await this.sleep(rm ? 200 : 450);
          break;
        }
        case 'tick': {
          await landed;
          for (const b of e.bombs) {
            const el = this.tiles.get(b.id);
            if (!el) continue;
            this.setTileArt(el, { k: 'bomb', n: Math.max(0, b.n) });
            if (!rm) el.animate([{ transform: this.xy(b.at) + ' scale(1)' }, { transform: this.xy(b.at) + ' scale(1.3)' }, { transform: this.xy(b.at) + ' scale(1)' }], { duration: 320 });
          }
          await this.sleep(rm ? 80 : 260);
          break;
        }
        case 'pass':
          this.shake(this.root.querySelector('.ba-clock'), 5, 400);
          await this.sleep(300);
          break;
        case 'turn': {
          await landed;
          if (gen !== this.gen) return;
          this.ui = { turn: e.side, left: e.moves };
          this.paintTurn();
          for (const sd of [0, 1]) this.paintSide(sd, this.hpShown[sd]);
          await this.turnBanner(e.side);
          if (e.frozen) {
            for (const a of this.teamArts(e.side)) { a.classList.add('is-frozen'); this.later(() => a.classList.remove('is-frozen'), 1200); }
            await this.sleep(500);
          }
          this.timerLeft = TURN_SECONDS;
          break;
        }
        case 'suddenDeath': {
          const field = this.root.querySelector('.ba-field');
          this.pop(this.centre(field), escapeHTML(t('suddenDeath')), 'is-extra', 1500);
          await this.sleep(900);
          break;
        }
        case 'shuffle': {
          const board = this.root.querySelector('.ba-board');
          if (board && !rm) await board.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.1, transform: 'scale(.94)' }], { duration: 220 }).finished.catch(() => {});
          this.syncTiles(e.board);
          if (board && !rm) board.animate([{ opacity: 0.1, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 240 });
          await this.sleep(240);
          break;
        }
        default:
          break;
      }
    }
    await landed;
  }

  artSize() {
    const b = this.root.querySelector('.ba-battle');
    return b ? parseFloat(getComputedStyle(b).getPropertyValue('--ba-art')) || 100 : 100;
  }

  healSpark(p, n) {
    const d = this.fx('ba-healspark', '+', { x: p.x + (Math.random() - 0.5) * 70, y: p.y + 10 + Math.random() * 20 });
    if (!d) return;
    d.animate([{ transform: 'translate(-50%, 0) scale(.5)', opacity: 0 }, { transform: 'translate(-50%, -20px) scale(1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%, -70px) scale(.8)', opacity: 0 }],
      { duration: 900, delay: n * 70, easing: 'ease-out', fill: 'backwards' }).finished.catch(() => {}).then(() => d.remove());
  }

  // --- the end ----------------------------------------------------------------------------------
  finish() {
    const s = this.state;
    if (!this.recorded && this.link) {
      // ONLINE: the link records it ('mp' bucket, once per match through its own ledger; a live
      // room also writes head-to-head). Never the computer's save slot or who-opens-next.
      this.recorded = true;
      try { this.link.finish(this.canon, s.winner === ME); } catch (err) { console.error('[battle-arena] online record failed', err); }
    }
    if (!this.recorded) {
      this.recorded = true;
      // ONCE per match: every write in the shared store is additive, so a second call inflates.
      try {
        const st = recordResult('battlearena', this.diff, s.winner === ME);
        if (!st) console.warn('[battle-arena] result not recorded (rate gate or store refused it)');
      } catch (err) { console.error('[battle-arena] record failed', err); }
      this.clearSave();
      this.settings.nextFirst = this.settings.nextFirst === 1 ? 0 : 1;
      writeJSON(SETTINGS_KEY, this.settings);
    }
    this.syncAll();
    // The losers faint; then the result.
    for (const a of this.teamArts(1 - s.winner)) {
      if (!reducedMotion()) a.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: 'translateY(20px) rotate(-12deg)', opacity: 0.35 }], { duration: 700, easing: 'ease-in', fill: 'forwards' });
    }
    this.later(() => this.showResult(), 1000);
  }

  /** The reference's ending, on the stage: the winners in the middle under a big VICTORY (or DEFEAT),
   *  a white strip "<name> wins!", and a panel with the losers' monsters in tears. X closes it. */
  showResult() {
    const s = this.state;
    if (!s || s.winner == null || this.root.querySelector('.ba-result')) return;
    const w = s.winner, l = 1 - w;
    const title = t('teamWins', { name: this.names[w] });
    const el = document.createElement('div');
    el.className = 'ba-result-ov';
    el.innerHTML = `
      <div class="ba-result${w === ME ? ' is-win' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <button type="button" class="gh-modal__close ba-result-x" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="ba-result-stage">
          <div class="ba-result-art">${s.sides[w].mons.map((m, i) => `<div class="ba-result-mon${w === ME ? ' ba-face-left' : ''}" style="animation-delay:${i * -0.6}s"><span class="ba-result-emo">${i ? '😊' : '🎉'}</span>${monsterSVG(m.id, m.evo)}</div>`).join('')}</div>
          <b class="ba-result-big">${escapeHTML(t(w === ME ? 'victory' : 'defeat'))}</b>
        </div>
        <div class="ba-result-strip"><span class="ba-result-av">${escapeHTML(this.avatars[w])}</span><span class="ba-result-title">${escapeHTML(title)}</span></div>
        ${this.canon && this.canon.resigned != null ? `<p class="ba-result-why">${escapeHTML(t('resigned', { name: this.names[l] }))}</p>` : ''}
        <div class="ba-result-lose">
          <span class="ba-result-luck">${escapeHTML(t('betterLuck', { name: this.names[l] }))}</span>
          <div class="ba-result-losers"><span class="ba-result-av">${escapeHTML(this.avatars[l])}</span>${s.sides[l].mons.map((m, i) => `<div class="ba-result-hex${l === ME ? ' ba-face-left' : ''}"><span class="ba-result-emo">${i ? '😥' : '😭'}</span>${monsterSVG(m.id, m.evo)}</div>`).join('')}</div>
          <div class="ba-result-actions">
            ${this.link ? `<button type="button" class="gh-btn gh-btn--primary" data-role="done">${t('done')}</button>` : `
            <button type="button" class="gh-btn gh-btn--primary" data-role="again">${t('playAgain')}</button>
            <button type="button" class="gh-btn gh-btn--ghost" data-role="team">${t('newTeam')}</button>`}
          </div>
        </div>
      </div>`;
    this.root.querySelector('.ba-battle').appendChild(el);
    fitText(el.querySelector('.ba-result-title'), 22);
    fitText(el.querySelector('.ba-result-luck'), 14);
    if (!reducedMotion()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
      el.querySelector('.ba-result-big').animate([{ transform: 'scale(2.6)', opacity: 0 }, { transform: 'scale(.9)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 560, easing: 'ease-out' });
      el.querySelector('.ba-result-strip').animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 420, delay: 250, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
    }
    const team = s.sides[ME].mons.map((m) => m.id);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="again"]'), 'click', () => { el.remove(); this.startMatch(team); });
    this.on(el.querySelector('[data-role="done"]'), 'click', () => { el.remove(); if (this.link) this.link.done(); });
    this.on(el.querySelector('[data-role="team"]'), 'click', () => { el.remove(); this.renderDraft(); });
  }

  showPause() {
    if (this.root.querySelector('.ba-pause')) return;
    if (this.link) { this.showOnlineMenu(); return; }
    const over = this.state && this.state.winner != null;
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    el.innerHTML = `
      <div class="gh-modal ba-pause" role="dialog" aria-modal="true" aria-label="${t('paused')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="gh-modal__actions">
          ${over ? '' : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>`}
          <button type="button" class="gh-btn ${over ? 'gh-btn--primary' : 'gh-btn--ghost'} gh-btn--block" data-role="new">${t('newMatch')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="help">${t('help')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="home">${t('home')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const close = () => el.remove();
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    this.on(el.querySelector('[data-role="help"]'), 'click', () => { close(); this.showHelp(); });
    // Leaving a match abandons it: nothing is recorded until a match ENDS (THE LAW rule 2), and
    // the save (a match in progress, not history) is dropped.
    this.on(el.querySelector('[data-role="new"]'), 'click', () => { close(); this.clearSave(); this.state = null; this.renderDraft(); });
    this.on(el.querySelector('[data-role="home"]'), 'click', () => { close(); this.clearSave(); this.state = null; this.renderHome(); });
  }

  /** The menu in an online match: Resume, what the link allows (Resign / Cancel / Decline / Claim
   *  win; live rooms: Resign is leaving), How to play, and back to the online list (challenges). */
  showOnlineMenu() {
    const over = this.state && this.state.winner != null;
    const items = over ? [] : this.link.menuItems();
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    el.innerHTML = `
      <div class="gh-modal ba-pause" role="dialog" aria-modal="true" aria-label="${t('menu')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="gh-modal__actions">
          ${over ? '' : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>`}
          ${items.map((it, i) => `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-item="${i}">${escapeHTML(it.label)}</button>`).join('')}
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="help">${t('help')}</button>
          ${this.link.kind === 'live' && !over ? '' : `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="back">${t('online')}</button>`}
        </div>
      </div>`;
    this.root.appendChild(el);
    const close = () => el.remove();
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    this.on(el.querySelector('[data-role="help"]'), 'click', () => { close(); this.showHelp(); });
    this.on(el.querySelector('[data-role="back"]'), 'click', () => { close(); this.link.done(); });
    this.on(el.querySelector('.gh-modal__actions'), 'click', (e) => {
      const b = e.target.closest('[data-item]');
      if (!b) return;
      close();
      const it = items[Number(b.dataset.item)];
      if (it) it.act();
    });
  }

  /** Forget the online match (the screen that comes next is the caller's). */
  leaveOnline() {
    if (this.link) { try { this.link.destroy(); } catch {} }
    this.link = null;
    this.canon = null;
    this.state = null;
    this.inbox = [];
  }

  destroy() {
    this.disposed = true;
    if (this.link) { try { this.link.destroy(); } catch {} this.link = null; }
    this.gen++;
    try { if (window.__baTest === this) delete window.__baTest; } catch {}
    this.clearTimers();
    this.unbindAll();
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    this.root.classList.remove('ba-root');
    this.root.innerHTML = '';
    this.tiles = new Map();
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch {} }
  instance = new BattleArena(container);
  instance.mount();
  return instance;
}

/** The hub hands a notified match to the open game (js/hub.js `openArmed`). */
export function openArmed() {
  if (instance) instance.openArmed();
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE "AUTOSAVE / RESUME" MEANING of the contract: the match in progress is saved after every
 *  move (`gamehub.battlearena.save.v1`) and picked up on return, so leaving is lossless. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress, openArmed };
