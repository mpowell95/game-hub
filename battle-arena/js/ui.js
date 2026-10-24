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
import { monsterSVG, gemSVG, elementBadge } from './art.js';

const t = makeT(STRINGS);
const CSS_MARK = 'data-battlearena-css';
const SETTINGS_KEY = 'gamehub.battlearena.v1';
const SAVE_KEY = 'gamehub.battlearena.save.v1';
const DIFFS = ['easy', 'medium', 'hard'];
const ME = 0, CPU = 1;

const SWAP_MS = 150;
const CLEAR_MS = 210;
const FALL_BASE_MS = 120;
const FALL_ROW_MS = 50;
const BANNER_MS = 950;
const CPU_THINK_MS = 420;
const CPU_SHOW_MS = 300;

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
    const save = readSave();
    // A save is always resumed, even one whose last move WON: the match was saved before its
    // animation, so leaving during it means finish() never ran; resuming records it now (once).
    if (save) this.resume(save);
    else this.renderHome();
    // Read-only hook for headless drivers (Cup Pong's `__cpTest` precedent). Never read by the game.
    try { window.__baTest = this; } catch {}
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
    this.on(this.root.querySelector('[data-role="help"]'), 'click', () => this.showHelp());
  }

  showHelp() {
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    const lines = ['helpSwap', 'helpCharge', 'helpEx', 'helpFull', 'helpFour', 'helpBerry', 'helpBomb', 'helpBoom', 'helpSudden'];
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
  renderDraft() {
    this.newScreen('draft');
    const unlocked = unlockedIds(totalWins());
    this.unlocked = unlocked;
    this.picks = this.settings.team.filter((id) => unlocked.includes(id));
    const cells = MONSTERS.map((m) => {
      const locked = !unlocked.includes(m.id);
      return `<div class="ba-pick${locked ? ' is-locked' : ''}" role="button" tabindex="0" data-id="${m.id}"
          aria-label="${escapeHTML(m.name)}${locked ? ', ' + t('locked') : ''}">
          <div class="ba-pick-art">${monsterSVG(m.id)}</div>
          <span class="ba-pick-gem">${elementBadge(m.el)}</span>
          <span class="ba-pick-name">${locked ? `${ICONS.lock}${m.unlock}` : escapeHTML(m.name)}</span>
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
    this.on(this.root.querySelector('[data-role="back"]'), 'click', () => this.renderHome());
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
      this.startMatch(this.picks.slice());
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
    this.state = state;
    this.recorded = false;
    this.save();
    this.renderBattle();
  }

  resume(save) {
    this.diff = save.diff;
    this.state = save.state;
    this.recorded = false;
    this.renderBattle();
  }

  save() {
    if (!this.state) return;
    writeJSON(SAVE_KEY, { v: 1, diff: this.diff, state: this.state });
  }
  clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

  get foeName() {
    const p = (() => { try { return loadProfile(); } catch { return null; } })();
    const o = p && Array.isArray(p.opponents) ? p.opponents[0] : null;
    return (o && o.name) || t('computer');
  }

  renderBattle() {
    const gen = this.newScreen('battle');
    this.names = [myName(), this.foeName];
    const side = (sd) => `
      <div class="ba-side" data-side="${sd}">
        <div class="ba-head">
          <span class="ba-name">${escapeHTML(this.names[sd])}</span>
          <div class="ba-hp" role="img"><span class="ba-hp-fill"></span><span class="ba-hp-txt"></span></div>
          <div class="ba-status"><span class="ba-berries"></span><span class="ba-badges"></span></div>
        </div>
        ${[0, 1].map((mi) => `
          <div class="ba-mon" data-mon="${mi}" role="button" tabindex="0">
            <div class="ba-mon-art"></div>
            <div class="ba-bar"><span class="ba-bar-fill"></span><span class="ba-bar-gem"></span><span class="ba-bar-txt"></span></div>
            <span class="ba-evo-pill" hidden>${t('evolve')}</span>
          </div>`).join('')}
      </div>`;
    this.root.innerHTML = `
      <div class="ba-battle">
        <div class="ba-hubrow">
          <div class="ba-turn" aria-live="polite"><span class="ba-turn-name"></span><span class="ba-pips"></span></div>
          <button type="button" class="ba-iconbtn ba-menu" aria-label="${t('menu')}">${ICONS.menu}</button>
        </div>
        <div class="ba-arena">
          <div class="ba-arena-bg" aria-hidden="true"></div>
          ${side(CPU)}${side(ME)}
        </div>
        <div class="ba-boardwrap">
          <div class="ba-board" role="application" aria-label="${t('board')}"></div>
          <p class="ba-tip" aria-live="polite"></p>
        </div>
        <div class="ba-fx" aria-hidden="true"></div>
      </div>`;
    this.arenaBg();
    for (const sd of [0, 1]) {
      const el = this.sideEl(sd);
      this.state.sides[sd].mons.forEach((m, mi) => {
        const art = el.querySelector(`.ba-mon[data-mon="${mi}"] .ba-mon-art`);
        art.innerHTML = monsterSVG(m.id, m.evo);
        art.dataset.evo = m.evo ? '1' : '0';
        el.querySelector(`.ba-mon[data-mon="${mi}"] .ba-bar-gem`).innerHTML = elementBadge(BY_ID[m.id].el);
        el.querySelector(`.ba-mon[data-mon="${mi}"] .ba-bar`).style.setProperty('--ba-el', BY_ID[m.id].el === 'all' ? '#C9A2F0' : ELEMENT_COLOR[BY_ID[m.id].el]);
        el.querySelector(`.ba-mon[data-mon="${mi}"]`).classList.toggle('is-all', BY_ID[m.id].el === 'all');
      });
    }
    this.bindBoard();
    this.on(this.root.querySelector('.ba-menu'), 'click', () => this.showPause());
    this.on(this.root.querySelector('.ba-arena'), 'click', (e) => this.onMonTap(e));
    this.offViewport = onViewportResize(() => this.fit());
    this.fit();
    this.buildTiles();
    this.ui = null;
    this.syncAll();
    // The layout may still be settling on the first frame (flex inside the hub's container).
    requestAnimationFrame(() => { if (gen === this.gen) { this.fit(); this.placeAll(); } });
    this.later(() => { if (gen === this.gen) this.next(); }, 350);
  }

  /** The Boiler Room: pipes, and a gauge, behind the monsters. Decoration only. */
  arenaBg() {
    const bg = this.root.querySelector('.ba-arena-bg');
    if (!bg) return;
    bg.innerHTML = `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
      <g class="ba-pipe"><rect x="-10" y="40" width="420" height="16" rx="8"/><rect x="60" y="0" width="16" height="300" rx="8"/><rect x="324" y="0" width="16" height="300" rx="8"/><rect x="-10" y="250" width="420" height="12" rx="6"/></g>
      <g class="ba-pipe-joint"><rect x="54" y="34" width="28" height="28" rx="5"/><rect x="318" y="34" width="28" height="28" rx="5"/><rect x="54" y="242" width="28" height="28" rx="5"/><rect x="318" y="242" width="28" height="28" rx="5"/></g>
      <g class="ba-gauge"><circle cx="200" cy="48" r="20"/><path d="M200 48l10-12" stroke-width="3" stroke-linecap="round"/></g>
    </svg>`;
  }

  sideEl(sd) { return this.root.querySelector(`.ba-side[data-side="${sd}"]`); }
  monEl(sd, mi) { const s = this.sideEl(sd); return s && s.querySelector(`.ba-mon[data-mon="${mi}"]`); }

  /** Board cell size and monster art size, from the space really there (measured, not guessed). */
  fit() {
    const battle = this.root.querySelector('.ba-battle');
    const wrap = this.root.querySelector('.ba-boardwrap');
    const arena = this.root.querySelector('.ba-arena');
    if (!battle || !wrap || !arena) return;
    const W = battle.clientWidth, H = battle.clientHeight;
    if (!W || !H) { this.later(() => this.fit(), 50); return; }
    const byW = Math.floor((Math.min(W, 520) - 20) / E.COLS);
    const byH = Math.floor((H * 0.42) / E.ROWS);
    const cell = Math.max(34, Math.min(64, byW, byH));
    this.cell = cell;
    battle.style.setProperty('--ba-cell', cell + 'px');
    // The arena takes what is left; two monsters per column share it.
    const aH = arena.clientHeight;
    const head = this.root.querySelector('.ba-head');
    const headH = head ? head.offsetHeight : 52;
    const art = Math.max(44, Math.min(112, Math.floor((aH - headH - 2 * 26 - 14) / 2)));
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
    el.innerHTML = gemSVG(tile.k, tile.n);
    return el;
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
        el.dataset.k = tile.k;
        el.innerHTML = gemSVG(tile.k, tile.n);
      }
      if (tile.k === 'bomb') el.dataset.n = String(tile.n);
      el.style.transform = this.xy(i);
      el.style.opacity = '';
    });
    for (const [id, el] of this.tiles) {
      if (!keep.has(id)) { el.remove(); this.tiles.delete(id); }
    }
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
    return !!s && this.screen === 'battle' && !this.busy && s.winner == null && s.turn === ME && s.pendingEvolve == null;
  }

  /** Swipe a tile into its neighbour, or tap one then the other. Bound to the board only. */
  bindBoard() {
    const board = this.root.querySelector('.ba-board');
    let start = null;
    const down = (e) => {
      if (!this.canInput()) return;
      const i = this.cellAt(e.clientX, e.clientY);
      if (i < 0) return;
      start = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
      try { board.setPointerCapture(e.pointerId); } catch {}
      if (e.cancelable) e.preventDefault();
    };
    const move = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < this.cell * 0.32) return;
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
    const res = E.apply(this.state, { type: 'swap', a, b, side: ME });
    if (!res.ok) {
      if (res.error === 'no-match') await this.badSwap(a, b);
      return;
    }
    await this.commit(res);
  }

  /** An illegal swap: the two tiles trade places and snap back. Costs nothing. */
  async badSwap(a, b) {
    const gen = this.gen;
    this.busy = true;
    const ea = this.tiles.get(this.state.board[a].id), eb = this.tiles.get(this.state.board[b].id);
    const go = (el, from, to) => el && el.animate([{ transform: this.xy(from) }, { transform: this.xy(to) }, { transform: this.xy(from) }],
      { duration: SWAP_MS * 2.2, easing: 'ease-in-out' });
    go(ea, a, b); go(eb, b, a);
    await this.sleep(SWAP_MS * 2.2);
    if (gen === this.gen) this.busy = false;
  }

  /** A legal move: keep the new state (saved at once), then tell its story. */
  async commit(res) {
    const gen = this.gen;
    this.state = res.state;
    this.save();
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
    this.next();
  }

  /** What happens now: the computer moves, the player chooses an evolution, or the match ends. */
  next() {
    const s = this.state;
    if (!s || this.screen !== 'battle' || this.busy) return;
    if (s.winner != null) { this.finish(); return; }
    if (s.turn === CPU) { this.cpuTurn(); return; }
    this.syncAll();
    if (s.pendingEvolve === ME) return;
    this.maybeTip();
  }

  maybeTip() {
    const tips = this.settings.tips;
    let key = null;
    if (!tips.moves) key = 'moves';
    else if (!tips.four && this.state.sides[ME].turns >= 2) key = 'four';
    if (!key) return;
    tips[key] = true;
    writeJSON(SETTINGS_KEY, this.settings);
    const el = this.root.querySelector('.ba-tip');
    if (!el) return;
    el.textContent = t(key === 'moves' ? 'tipMoves' : 'tipFour');
    el.classList.add('is-on');
    this.later(() => el.classList.remove('is-on'), 3200);
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
    const sd = Number(mon.closest('.ba-side').dataset.side), mi = Number(mon.dataset.mon);
    const s = this.state;
    const m = s.sides[sd].mons[mi];
    if (sd === ME && s.pendingEvolve === ME && s.turn === ME && !this.busy && !m.evo) {
      const res = E.apply(s, { type: 'evolve', mon: mi, side: ME });
      if (res.ok) { this.hideEvolve(); this.commit(res); }
      return;
    }
    this.showCard(m.id, { evolved: m.evo });
  }

  hideEvolve() { for (const p of this.root.querySelectorAll('.ba-evo-pill')) p.hidden = true; for (const m of this.root.querySelectorAll('.ba-mon')) m.classList.remove('is-evo-pick'); }

  // --- the HUD ------------------------------------------------------------------------------------
  syncAll() {
    const s = this.state;
    if (!s || this.screen !== 'battle') return;
    for (const sd of [0, 1]) {
      this.paintSide(sd);
      s.sides[sd].mons.forEach((_, mi) => this.paintMon(sd, mi));
    }
    this.uiFromState();
    this.paintTurn();
    const pick = s.pendingEvolve === ME && s.turn === ME && s.winner == null;
    s.sides[ME].mons.forEach((m, mi) => {
      const el = this.monEl(ME, mi);
      if (!el) return;
      const on = pick && !m.evo;
      el.querySelector('.ba-evo-pill').hidden = !on;
      el.classList.toggle('is-evo-pick', on);
    });
  }

  paintSide(sd, hpOverride) {
    const el = this.sideEl(sd);
    const side = this.state.sides[sd];
    if (!el) return;
    const hp = hpOverride != null ? hpOverride : side.hp;
    el.querySelector('.ba-hp-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, hp / side.maxHp))})`;
    el.querySelector('.ba-hp-txt').innerHTML = `${hp}<small>/${side.maxHp}</small>${side.shield ? `<span class="ba-shield">${ICONS.shield}${side.shield}</span>` : ''}`;
    el.querySelector('.ba-hp').setAttribute('aria-label', `${t('hp')} ${hp} / ${side.maxHp}`);
    const allEvo = side.mons.every((m) => m.evo);
    const b = el.querySelector('.ba-berries');
    b.innerHTML = allEvo ? '' : Array.from({ length: BERRIES_TO_EVOLVE }, (_, i) => `<span class="ba-berry${i < side.berries ? ' is-on' : ''}">${ICONS.berry}</span>`).join('');
    b.setAttribute('aria-label', allEvo ? '' : t('berries', { n: side.berries }));
    let badges = '';
    if (side.frozen) badges += `<span class="ba-badge" title="${t('frozen')}">${ICONS.snow}</span>`;
    if (side.curse && side.curse.left > 0) badges += `<span class="ba-badge">${ICONS.hex}<b>${side.curse.left}</b></span>`;
    el.querySelector('.ba-badges').innerHTML = badges;
  }

  paintMon(sd, mi, energyOverride) {
    const el = this.monEl(sd, mi);
    const m = this.state.sides[sd].mons[mi];
    if (!el || !m) return;
    const art = el.querySelector('.ba-mon-art');
    if (art.dataset.evo !== (m.evo ? '1' : '0')) { art.innerHTML = monsterSVG(m.id, m.evo); art.dataset.evo = m.evo ? '1' : '0'; }
    const cost = BY_ID[m.id].cost;
    const e = energyOverride != null ? energyOverride : m.energy;
    el.querySelector('.ba-bar-fill').style.transform = `scaleX(${Math.min(1, e / cost)})`;
    el.querySelector('.ba-bar-txt').textContent = `${e}/${cost}`;
    el.classList.toggle('is-full', e >= cost);
    el.setAttribute('aria-label', `${monName(m.id, m.evo)}, ${t('energy', { n: e, max: cost })}`);
  }

  /** The turn marker follows the STORY (this.ui, stepped by the events as they play), not the
   *  final state, which is already a move ahead while the animation runs. */
  uiFromState() {
    const s = this.state;
    if (!this.ui || this.ui.turn !== s.turn) this.ui = { turn: s.turn, left: s.movesLeft, total: Math.max(s.movesLeft, 1) };
    else { this.ui.left = s.movesLeft; this.ui.total = Math.max(this.ui.total, s.movesLeft); }
  }

  paintTurn() {
    const s = this.state;
    const ui = this.ui || { turn: s.turn, left: s.movesLeft, total: s.movesLeft };
    const name = this.root.querySelector('.ba-turn-name');
    const pips = this.root.querySelector('.ba-pips');
    if (!name || !pips) return;
    const over = s.winner != null && !this.busy;
    if (over) {
      name.textContent = t('wins', { name: this.names[s.winner] });
      pips.innerHTML = '';
    } else {
      name.textContent = this.names[ui.turn];
      pips.innerHTML = Array.from({ length: Math.max(ui.total, ui.left) }, (_, i) => `<span class="ba-pip${i < ui.left ? ' is-on' : ''}"></span>`).join('');
      pips.setAttribute('aria-label', t('movesLeft', { n: ui.left }));
    }
    for (const sd of [0, 1]) {
      const el = this.sideEl(sd);
      if (el) el.classList.toggle('is-turn', !over && ui.turn === sd);
    }
    const turnEl = this.root.querySelector('.ba-turn');
    if (turnEl) turnEl.classList.toggle('is-cpu', !over && ui.turn === CPU);
  }

  // --- the story of a move ----------------------------------------------------------------------
  fxLayer() { return this.root.querySelector('.ba-fx'); }

  /** Position of an element's centre relative to the battle screen. */
  centre(el) {
    const host = this.root.querySelector('.ba-battle');
    if (!el || !host) return { x: 0, y: 0 };
    const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
  }

  floater(atEl, html, cls = '', dy = -10) {
    const layer = this.fxLayer();
    if (!layer || !atEl) return;
    const p = this.centre(atEl);
    const f = document.createElement('div');
    f.className = 'ba-float ' + cls;
    f.innerHTML = html;
    f.style.left = p.x + 'px';
    f.style.top = (p.y + dy) + 'px';
    layer.appendChild(f);
    const rm = reducedMotion();
    const a = f.animate(rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [{ transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -70%) scale(1.1)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -110%) scale(1)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%, -135%) scale(1)', opacity: 0 }],
    { duration: 900, easing: 'ease-out' });
    a.finished.catch(() => {}).then(() => f.remove());
  }

  shake(el) {
    if (!el || reducedMotion()) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-out' });
  }

  async banner(sd, mi, id, evo) {
    const layer = this.fxLayer();
    const arena = this.root.querySelector('.ba-arena');
    if (!layer || !arena) return;
    const b = document.createElement('div');
    b.className = 'ba-banner' + (sd === ME ? ' is-me' : '');
    const el = BY_ID[id].el;
    b.style.setProperty('--ba-el', el === 'all' ? '#C9A2F0' : ELEMENT_COLOR[el]);
    b.innerHTML = `<div class="ba-banner-art${sd === ME ? ' ba-face-left' : ''}">${monsterSVG(id, evo)}</div><b class="ba-banner-name">${escapeHTML(t('sp_' + id + (evo ? '_evo' : '')))}</b>`;
    const p = this.centre(arena);
    b.style.top = p.y + 'px';
    layer.appendChild(b);
    fitText(b.querySelector('.ba-banner-name'), 22);
    const mon = this.monEl(sd, mi);
    if (mon && !reducedMotion()) {
      mon.animate([{ transform: 'translateX(0) scale(1)' }, { transform: `translateX(${sd === ME ? -14 : 14}px) scale(1.12)`, offset: 0.4 }, { transform: 'translateX(0) scale(1)' }],
        { duration: 520, easing: 'ease-out' });
    }
    const from = sd === ME ? '60%' : '-60%';
    const a = b.animate(reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [{ transform: `translate(${from}, -50%)`, opacity: 0 }, { transform: 'translate(0, -50%)', opacity: 1, offset: 0.18 },
        { transform: 'translate(0, -50%)', opacity: 1, offset: 0.82 }, { transform: `translate(${sd === ME ? '-30%' : '30%'}, -50%)`, opacity: 0 }],
    { duration: BANNER_MS, easing: 'ease-out' });
    await a.finished.catch(() => {});
    b.remove();
  }

  /** The whole board flashes a beam along a bomb's row and column. */
  beam(at, cells, boom) {
    const board = this.root.querySelector('.ba-board');
    if (!board) return;
    const mk = (cls, style) => {
      const d = document.createElement('div');
      d.className = 'ba-beam ' + cls;
      Object.assign(d.style, style);
      board.appendChild(d);
      d.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }).finished.catch(() => {}).then(() => d.remove());
    };
    const c = this.cell;
    mk('is-row', { top: E.rowOf(at) * c + 'px', height: c + 'px' });
    mk('is-col', { left: E.colOf(at) * c + 'px', width: c + 'px' });
    if (boom) this.shake(this.root.querySelector('.ba-boardwrap'));
  }

  async play(events, gen) {
    const rm = reducedMotion();
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
          await this.sleep(SWAP_MS + 20);
          break;
        }
        case 'bomb':
          this.beam(e.at, e.cells, e.boom);
          await this.sleep(rm ? 120 : 200);
          break;
        case 'rows': {
          const board = this.root.querySelector('.ba-board');
          for (const r of e.rows) {
            const d = document.createElement('div');
            d.className = 'ba-beam is-row is-fire';
            d.style.top = r * this.cell + 'px';
            d.style.height = this.cell + 'px';
            board.appendChild(d);
            d.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 420 }).finished.catch(() => {}).then(() => d.remove());
          }
          await this.sleep(240);
          break;
        }
        case 'clear': {
          const els = e.ids.map((id) => this.tiles.get(id)).filter(Boolean);
          for (const el of els) {
            this.tiles.delete(Number(el.dataset.id));
            const base = el.style.transform;
            el.animate(rm
              ? [{ opacity: 1 }, { opacity: 0 }]
              : [{ transform: base + ' scale(1)', opacity: 1 }, { transform: base + ' scale(1.25)', opacity: 1, offset: 0.35 }, { transform: base + ' scale(0.2)', opacity: 0 }],
            { duration: CLEAR_MS, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
          }
          // The charges, berries and extra move that this clear produced show WITH it, not after.
          while (k + 1 < events.length && ['energy', 'berry', 'extra'].includes(events[k + 1].t)) this.instant(events[++k]);
          await this.sleep(CLEAR_MS);
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
            el.animate([{ transform: this.xy(m.from) }, { transform: this.xy(m.to) }], { duration: ms, easing: 'cubic-bezier(.5,0,.75,1.2)' });
          }
          for (const sp of e.spawns) {
            const el = this.makeTile(sp);
            if (sp.k === 'bomb') el.dataset.n = String(sp.n);
            el.style.transform = this.xy(sp.to);
            host.appendChild(el);
            this.tiles.set(sp.id, el);
            const rows = E.rowOf(sp.to) - sp.fromRow;
            const ms = FALL_BASE_MS + rows * FALL_ROW_MS;
            longest = Math.max(longest, ms);
            const from = `translate(${E.colOf(sp.to) * this.cell}px, ${sp.fromRow * this.cell}px)`;
            el.animate([{ transform: from }, { transform: this.xy(sp.to) }], { duration: ms, easing: 'cubic-bezier(.5,0,.75,1.2)' });
          }
          await this.sleep(longest + 30);
          break;
        }
        case 'energy': case 'berry': case 'extra': case 'shield': case 'drain': case 'tick': case 'curse':
          this.instant(e);
          break;
        case 'special':
          await this.banner(e.side, e.mon, e.id, e.evo);
          this.paintMon(e.side, e.mon);
          break;
        case 'damage': {
          const head = this.sideEl(e.side) && this.sideEl(e.side).querySelector('.ba-head');
          this.shake(this.sideEl(e.side));
          if (e.absorbed) this.floater(head, `${ICONS.shield}-${e.absorbed}`, 'is-shield', 8);
          if (e.n) this.floater(head, `-${e.n}`, 'is-dmg', 16);
          this.paintSide(e.side, e.hp);
          await this.sleep(rm ? 200 : 380);
          break;
        }
        case 'heal': {
          const head = this.sideEl(e.side) && this.sideEl(e.side).querySelector('.ba-head');
          if (e.blocked) this.floater(head, t('noHeal'), 'is-note');
          else {
            this.floater(head, `+${e.n}`, 'is-heal');
            if (e.capped) this.later(() => this.floater(head, t('maxHp'), 'is-note', 14), 260);
          }
          this.paintSide(e.side, e.hp);
          await this.sleep(rm ? 200 : 360);
          break;
        }
        case 'freeze': {
          const head = this.sideEl(e.side) && this.sideEl(e.side).querySelector('.ba-head');
          this.floater(head, `${ICONS.snow}${t('frozen')}`, 'is-note');
          this.paintSide(e.side);
          await this.sleep(300);
          break;
        }
        case 'curseTick': {
          this.paintSide(e.side);
          break;
        }
        case 'convert': {
          for (const i of e.cells) {
            const tile = e.board[i];
            const el = this.tiles.get(tile.id);
            if (!el) continue;
            el.dataset.k = tile.k;
            el.innerHTML = gemSVG(tile.k);
            if (!rm) el.animate([{ transform: this.xy(i) + ' scale(0.3)' }, { transform: this.xy(i) + ' scale(1.15)', offset: 0.6 }, { transform: this.xy(i) }], { duration: 300, easing: 'ease-out' });
          }
          await this.sleep(320);
          break;
        }
        case 'evolveReady':
          this.syncAll();
          break;
        case 'evolve': {
          const mon = this.monEl(e.side, e.mon);
          this.hideEvolve();
          if (mon) {
            const art = mon.querySelector('.ba-mon-art');
            if (!rm) await art.animate([{ filter: 'brightness(1)', transform: 'scale(1)' }, { filter: 'brightness(3)', transform: 'scale(1.18)' }], { duration: 380, easing: 'ease-in' }).finished.catch(() => {});
            if (gen !== this.gen) return;
            this.paintMon(e.side, e.mon);
            if (!rm) art.animate([{ filter: 'brightness(3)', transform: 'scale(1.18)' }, { filter: 'brightness(1)', transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
            this.floater(mon, `${escapeHTML(monName(e.id, true))}`, 'is-evo');
            const head = this.sideEl(e.side).querySelector('.ba-head');
            this.floater(head, '+5', 'is-heal');
          }
          this.paintSide(e.side);
          await this.sleep(rm ? 300 : 650);
          break;
        }
        case 'turn': {
          this.ui = { turn: e.side, left: e.moves, total: e.moves };
          this.paintTurn();
          await this.sleep(rm ? 120 : 260);
          break;
        }
        case 'suddenDeath': {
          const arena = this.root.querySelector('.ba-arena');
          this.floater(arena, t('suddenDeath'), 'is-big');
          await this.sleep(700);
          break;
        }
        case 'shuffle': {
          const board = this.root.querySelector('.ba-board');
          if (board && !rm) await board.animate([{ opacity: 1 }, { opacity: 0.1 }], { duration: 200 }).finished.catch(() => {});
          this.syncTiles(e.board);
          if (board && !rm) board.animate([{ opacity: 0.1 }, { opacity: 1 }], { duration: 220 });
          await this.sleep(220);
          break;
        }
        case 'win':
          break;
        default:
          break;
      }
    }
  }

  /** The small things that ride along with a clear. */
  instant(e) {
    switch (e.t) {
      case 'energy': {
        const mon = this.monEl(e.side, e.mon);
        this.floater(mon, `+${e.n}${elementBadge(e.k)}`, 'is-energy', -18);
        this.paintMon(e.side, e.mon, e.energy);
        if (mon && e.gained && !reducedMotion()) mon.querySelector('.ba-bar').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 260 });
        break;
      }
      case 'berry': {
        const el = this.sideEl(e.side);
        const b = el && el.querySelector('.ba-berries');
        this.floater(b, `+${e.n}${ICONS.berry}`, 'is-berry', 22);
        if (b) b.innerHTML = Array.from({ length: BERRIES_TO_EVOLVE }, (_, i) => `<span class="ba-berry${i < e.berries ? ' is-on' : ''}">${ICONS.berry}</span>`).join('');
        break;
      }
      case 'extra': {
        const turn = this.root.querySelector('.ba-turn');
        this.floater(turn, t('extraMove'), 'is-note', 26);
        if (this.ui) { this.ui.left += 1; this.ui.total += 1; }
        this.paintTurn();
        break;
      }
      case 'shield':
        this.paintSide(e.side);
        break;
      case 'drain': {
        const mon = this.monEl(e.side, e.mon);
        if (e.n) this.floater(mon, `-${e.n}`, 'is-dmg', -18);
        this.paintMon(e.side, e.mon, e.energy);
        break;
      }
      case 'tick': {
        for (const b of e.bombs) {
          const el = this.tiles.get(b.id);
          if (!el) continue;
          el.dataset.n = String(b.n);
          el.innerHTML = gemSVG('bomb', Math.max(0, b.n));
          if (!reducedMotion()) el.animate([{ transform: this.xy(b.at) + ' scale(1)' }, { transform: this.xy(b.at) + ' scale(1.2)' }, { transform: this.xy(b.at) + ' scale(1)' }], { duration: 300 });
        }
        break;
      }
      case 'curse':
        this.paintSide(e.side);
        break;
      default:
        break;
    }
  }

  // --- the end ----------------------------------------------------------------------------------
  finish() {
    const s = this.state;
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
    this.later(() => this.showResult(), 700);
  }

  showResult() {
    const s = this.state;
    if (!s || s.winner == null || this.root.querySelector('.ba-result')) return;
    const w = s.winner;
    const title = t('wins', { name: this.names[w] });
    const el = document.createElement('div');
    el.className = 'gh-overlay ba-overlay';
    el.innerHTML = `
      <div class="gh-modal ba-result" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <div class="ba-result-art">${s.sides[w].mons.map((m) => `<div class="ba-result-mon">${monsterSVG(m.id, m.evo)}</div>`).join('')}</div>
        <h2 class="ba-result-title">${escapeHTML(title)}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('playAgain')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="team">${t('newTeam')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    fitText(el.querySelector('.ba-result-title'), 24);
    const team = s.sides[ME].mons.map((m) => m.id);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="again"]'), 'click', () => { el.remove(); this.startMatch(team); });
    this.on(el.querySelector('[data-role="team"]'), 'click', () => { el.remove(); this.renderDraft(); });
  }

  showPause() {
    if (this.root.querySelector('.ba-pause')) return;
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

  destroy() {
    this.disposed = true;
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

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE "AUTOSAVE / RESUME" MEANING of the contract: the match in progress is saved after every
 *  move (`gamehub.battlearena.save.v1`) and picked up on return, so leaving is lossless. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
