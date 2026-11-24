// shove-off/js/ui.js - SHOVE OFF (2026-11-18), module entry (init / destroy / isInProgress / back).
// Matt filmed GamePigeon's Knockout: "I want our own version of this". Online challenges, and (2026-11-18, Matt: "Add
// computer play to the game so i can test it") vs the computer: cpu.js chooses, cpu-game.js saves and records.
//
// isInProgress(): always FALSE. Nothing is lost by leaving: every round's aims are written to the match
// the moment Launch is tapped (kept in an outbox when there is no signal), and arrows not yet launched
// are kept on this phone (`gamehub.shoveoff.draft.v1`) and put back when the match is reopened.
//
// Screens: setup (looks, tabs Matches | Challenge), people (pick someone), challenge (their name, your
// look, Challenge), play (the board, both players' pieces left, Launch / Sent / Waiting), and three
// overlays (How to play, the match menu, Game over). The rules are engine.js (pure), the data mp.js,
// the drawing art.js. NOTHING SCROLLS: lists are paged by measurement.
import * as E from './engine.js';
import * as A from './art.js';
import * as MP from './mp.js';
import * as CG from './cpu-game.js';
import * as FX from './fx.js';
import { STRINGS } from './strings.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { onThemeChange } from '../../js/theme.js';
import { backStack } from '../../js/back-stack.js';
import { onlineGateText } from '../../js/online-gate.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.shoveoff.v1';
const DRAFT_KEY = 'gamehub.shoveoff.draft.v1';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = (n) => String(n || '').trim().split(/\s+/)[0] || String(n || '');
const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const DOTS_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="5" cy="12" r="2.3" fill="currentColor"/><circle cx="12" cy="12" r="2.3" fill="currentColor"/><circle cx="19" cy="12" r="2.3" fill="currentColor"/></svg>';
const WORLD = E.H0 + 60;                     // rv 1: half the world the board shows (the square plus a margin of water)
const EDGE_PX = 9;                           // rv 2: the round-1 circle spans the width minus this much each side
const STEPS_PER_FRAME = 2;                   // a round's slide plays at twice the simulation's step rate
const REVEAL_MS = 1100;                      // both sides' arrows shown before the slide
const SHRINK_MS = 700;
const PARTY_MS = 1100;                       // the round that decides it: the winner's pieces hop before the card
const ARROW_GROW_MS = 380;                   // the reveal: arrows shoot out of the pieces...
const WINDUP_MS = 320;                       // ...then every piece pulls back before it goes
const FALL_STEPS = 40;                       // a fallen piece tumbles away over this many simulation steps
const TRAIL = 7;                             // frames of motion trail behind a fast piece

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  // tab: 'online' | 'cpu' (the older 'matches' / 'challenge' both mean Online)
  return { look: A.LOOKS.includes(s.look) ? s.look : 'sumo0', tab: s.tab === 'cpu' ? 'cpu' : 'online', diff: CG.asDiff(s.diff) };
}
function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify({ look: s.look, tab: s.tab, diff: s.diff })); } catch (err) { console.warn('[shoveoff] settings not saved', err); }
}
const DIFF_TIER = { easy: 1, medium: 2, hard: 3 };
function readDraft(id, r) {
  try { const d = (JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {})[id]; return d && d.r === r && Array.isArray(d.a) ? d.a : null; } catch { return null; }
}
function writeDraft(id, r, a) {
  try {
    const map = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {};
    if (a) map[id] = { r, a }; else delete map[id];
    const keys = Object.keys(map);
    if (keys.length > 30) delete map[keys[0]];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  } catch { /* the arrows are drawn again: a preference */ }
}
function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'denied') return t('mp_denied');
  if (reason === 'offline') return t('mp_offline');
  if (reason === 'dev-origin-blocked') return t('mp_dev');
  if (reason === 'no-player-code') return t('mp_no_code');
  if (reason === 'expired') return t('mp_expired');
  return t('mp_failed');
}

class ShoveOff {
  constructor(host) {
    this.host = host;
    this.s = loadSettings();
    this.screen = 'setup';
    this.destroyed = false;
    this.mp = null;
    this.rows = [];
    this.anim = null;
    this.raf = 0;
    this.drag = null;
    this._ensureCss();
    this.root = document.createElement('div');
    this.root.className = 'so-root';
    this.root.innerHTML = `
      <section class="so-scr" data-scr="setup"></section>
      <section class="so-scr" data-scr="people" hidden></section>
      <section class="so-scr" data-scr="challenge" hidden></section>
      <section class="so-scr so-play" data-scr="play" hidden>
        <canvas class="so-board" aria-label=""></canvas>
        <div class="so-banner" aria-hidden="true" hidden></div>
        <div class="so-hud"></div>
        <div class="so-foot"></div>
      </section>
      <div class="so-ov" data-ov="help" hidden></div>
      <div class="so-ov" data-ov="menu" hidden></div>
      <div class="so-ov" data-ov="over" hidden></div>
      <canvas class="so-fx" aria-hidden="true"></canvas>
      <div class="so-toast" role="status" aria-live="polite" hidden></div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('.so-board');
    this.fxCanvas = this.root.querySelector('.so-fx');
    this.P = new FX.Particles();                 // board garnish: hits, splashes, dust, crumbs (fx.js)
    this.PC = new FX.Particles();                // confetti, above the overlays
    this.shake = new FX.Shake();
    this._bgCache = null;                        // the still picture behind the pieces (_bg)
    this.root.addEventListener('click', this._onClick = (e) => this._click(e));
    this.root.addEventListener('input', this._onInput = (e) => { if (e.target.matches('[data-role="search"]')) this._paintPeople(); });
    this.canvas.addEventListener('pointerdown', this._onDown = (e) => this._down(e));
    this.canvas.addEventListener('pointermove', this._onMove = (e) => this._move(e));
    this.canvas.addEventListener('pointerup', this._onUp = (e) => this._up(e));
    this.canvas.addEventListener('pointercancel', this._onUp);
    // The aiming drag is the game's own: no page scroll under it (bound to the game root, never document).
    this.root.addEventListener('touchmove', this._onTouchMove = (e) => { if (this.drag) e.preventDefault(); }, { passive: false });
    this._onKey = (e) => {
      const tg = e.target;
      if (tg && tg.closest && tg.closest('input, textarea, select')) return;
      if (e.key === 'Escape') { if (!this.back()) this._closeOverlays(); }
    };
    document.addEventListener('keydown', this._onKey);
    this._offResize = onViewportResize(() => this._layout());
    this._offLang = onLangChange(() => this._rerender());
    this._offTheme = onThemeChange(() => this._rerender());
    this._showSetup();
    // Opened from a notification, the launcher bubble or the Multiplayer screen (alert.js armOpen /
    // armChallenge): straight to that match, or to "challenge <them>" with the person picked.
    import('./alert.js').then((AL) => {
      if (this.destroyed) return;
      const o = AL.takeOpen();
      if (!o) return;
      if (o.kind === 'pick') this._showChallenge(o.them, 1);
      else this._openMatch(o.id);
    }).catch(() => {});
  }

  _ensureCss() {
    const href = new URL('../css/shove-off.css', import.meta.url).href;
    if (![...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.addEventListener('load', () => { if (!this.destroyed) this._layout(); });
      document.head.appendChild(link);
    }
  }
  el(sel) { return this.root.querySelector(sel); }
  _scr(name) {
    this.screen = name;
    for (const s of this.root.querySelectorAll('.so-scr')) s.hidden = s.dataset.scr !== name;
  }
  _rerender() {
    if (this.screen === 'setup') this._renderSetup();
    else if (this.screen === 'people') this._renderPeople();
    else if (this.screen === 'challenge' && this._chThem) this._showChallenge(this._chThem, this._chDepth);
    else if (this.screen === 'play') { this._renderHud(); this._renderFoot(); this._draw(); }
    if (!this.el('[data-ov="help"]').hidden) this._openHelp();
  }
  _toast(msg, ms = 2600) {
    const el = this.el('.so-toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, ms);
  }

  // --- the hub's back (button and the phone's swipe): one screen back ---------------------------
  _setBack(fn, depth = 1) {
    this._backFn = fn || null;
    const level = fn ? Math.max(1, depth | 0) : 0;
    if (level && !this._bs) this._bs = backStack(() => { const f = this._backFn; if (f) { try { f(); } catch (e) { console.warn('[shoveoff] back', e); this._showSetup(); } } });
    if (this._bs) this._bs.sync(level);
    const step = !!fn;
    if (step === this._backStep) return;
    this._backStep = step;
    try { window.dispatchEvent(new CustomEvent('gamehub:backlabel', { detail: step })); } catch { /* old browser */ }
  }
  back() {
    const f = this._backFn;
    if (!f) return false;
    if (this._bs) { this._bs.back(); return true; }
    try { f(); } catch { this._showSetup(); }
    return true;
  }

  // --- SETUP ------------------------------------------------------------------------------------
  _showSetup() {
    this._leaveMatch();
    this._closeOverlays();
    try { CG.settle(); } catch (err) { console.error('[shoveoff] settle', err); }
    this._scr('setup');
    this._setBack(null);
    this._renderSetup();
    this._loadRows();
  }
  async _loadRows() {
    try { await MP.drainOutbox(); } catch { /* sent next time */ }
    const rows = await MP.readMyGames();
    if (this.destroyed || this.screen !== 'setup') return;
    this.rows = rows;
    try { MP.recordFinished(rows); } catch (err) { console.warn('[shoveoff] recordFinished', err); }
    if (!this._tabPicked) this.s.tab = rows.some((r) => !r.over) ? 'online' : 'cpu';
    this._renderSetup();
    this._showUnseen(rows);
  }
  _looksHTML(sel) {
    return `<div class="so-looks" role="radiogroup" aria-label="${esc(t('aria_look'))}">${A.KINDS.map((k) => `
      <div class="so-lookcol">${[0, 1].map((c) => { const id = k + c; return `
        <button type="button" class="so-look${id === sel ? ' is-sel' : ''}" data-act="look" data-v="${id}" role="radio" aria-checked="${id === sel}" aria-label="${esc(t('look_' + k) + ' ' + (c + 1))}">
          <canvas data-thumb="${id}"></canvas>${id === sel ? '<span class="so-chk" aria-hidden="true">&#10003;</span>' : ''}
        </button>`; }).join('')}
        <span class="so-lookname">${esc(t('look_' + k))}</span>
      </div>`).join('')}</div>`;
  }
  _paintThumbs(scope) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of scope.querySelectorAll('canvas[data-thumb]')) {
      const r = c.getBoundingClientRect();
      A.drawThumb(c, c.dataset.thumb, Math.max(40, r.width || 60), Math.max(30, r.height || 46), dpr);
    }
  }
  _renderSetup() {
    const box = this.el('[data-scr="setup"]');
    const live = this.rows.filter((r) => !r.over);
    const mine = live.filter((r) => r.yourTurn).length;
    let won = 0, lost = 0;
    try { for (const o of MP.recordsFrom(this.rows, MP.myCode()).opponents) { won += o.won; lost += o.lost; } } catch { /* no chip */ }
    const tab = this.s.tab;
    box.innerHTML = `
      <div class="so-card so-setup">
        <div class="so-head">
          <h1 class="so-title">${esc(t('title'))}</h1>
          ${won + lost ? `<span class="so-rec" aria-label="${esc(t('aria_record', { w: won, l: lost }))}">${won}-${lost}</span>` : ''}
          <button type="button" class="so-q" data-act="help" aria-label="${esc(t('help'))}">?</button>
        </div>
        ${this._looksHTML(this.s.look)}
        <div class="so-tabs" role="tablist">
          <button type="button" class="so-tab${tab === 'online' ? ' is-on' : ''}" data-act="tab" data-v="online" role="tab" aria-selected="${tab === 'online'}">${esc(t('tab_online'))}${mine ? `<span class="so-badge">${mine}</span>` : ''}</button>
          <button type="button" class="so-tab${tab === 'cpu' ? ' is-on' : ''}" data-act="tab" data-v="cpu" role="tab" aria-selected="${tab === 'cpu'}">${esc(t('tab_cpu'))}</button>
        </div>
        <div class="so-panel" data-role="panel">${tab === 'online' ? `<div class="so-online">${live.length ? '<div class="so-rows"></div>' : ''}${this._challengeHTML()}</div>` : this._cpuHTML()}</div>
      </div>`;
    this._paintThumbs(box);
    if (tab === 'online') { const l = box.querySelector('.so-rows'); if (l) { l._all = live; l._start = this._mStart | 0; this._fitRows(l, (r) => this._rowHTML(r)); } }
  }
  /** The Computer tab: Easy / Medium / Hard, then Play, or Continue (the saved match's level) + New game. */
  _cpuHTML() {
    const sv = CG.readSave();
    const live = sv && CG.gameOf(sv, MP.meLabel(), t('cpu')).over == null ? sv : null;
    return `<div class="so-diffs" role="radiogroup" aria-label="${esc(t('aria_diff'))}">${CG.DIFFS.map((d) => `
        <button type="button" class="so-diff${d === this.s.diff ? ' is-sel' : ''}" data-act="diff" data-v="${d}" role="radio" aria-checked="${d === this.s.diff}">${diffShapeSVG(DIFF_TIER[d])}<span>${esc(t('d_' + d))}</span></button>`).join('')}
      </div>
      <div class="so-cpubtns">${live
        ? `<button type="button" class="so-go" data-act="cpucont">${diffShapeSVG(DIFF_TIER[live.diff])}<span>${esc(t('continue'))}</span></button>
           <button type="button" class="so-alt" data-act="cpunew">${esc(t('new_game'))}</button>
           <p class="so-loss" data-role="cpuloss" hidden>${esc(t('counts_loss'))}</p>`
        : `<button type="button" class="so-go" data-act="cpunew">${esc(t('play'))}</button>`}
      </div>`;
  }
  _rowHTML(r) {
    const sub = r.open === 'sent' && !r.yourTurn ? t('row_sent') : (r.sd ? t('sudden') : t('round_n', { n: r.rnd })) + ' · ' + t('left_vs', { a: r.mine, b: r.theirs });
    return `<button type="button" class="so-row${r.yourTurn ? ' is-mine' : ''}" data-act="open" data-id="${esc(r.id)}">
      <span class="so-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="so-rowtext"><span class="so-rowname">${esc(r.name || t('anon'))}</span><span class="so-rowsub">${esc(sub)}</span></span>
      ${r.yourTurn ? `<span class="so-pill">${esc(t('play'))}</span>` : '<span class="so-chev" aria-hidden="true">›</span>'}
    </button>`;
  }
  _recent() {
    const seen = new Set();
    return this.rows.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .filter((r) => r.with && !seen.has(r.with) && seen.add(r.with)).slice(0, 4)
      .map((r) => ({ code: r.with, name: r.name, emoji: r.emoji }));
  }
  _challengeHTML() {
    this._recentList = this._recent();
    return `<div class="so-faces">
      <button type="button" class="so-facebtn is-any" data-act="anyone"><span class="so-facedot" aria-hidden="true">+</span><span class="so-facename">${esc(t('anyone'))}</span></button>
      ${this._recentList.map((o, i) => `<button type="button" class="so-facebtn" data-act="recent" data-oi="${i}"><span class="so-facedot" aria-hidden="true">${esc(o.emoji)}</span><span class="so-facename">${esc(first(o.name) || t('anon'))}</span></button>`).join('')}
    </div>`;
  }
  /** NO SCROLLING: a page of rows that fits the card; "+N more" turns the page (last page back to first). */
  _fitRows(list, html) {
    const all = list._all || [];
    const start = Math.min(list._start | 0, Math.max(0, all.length - 1));
    list.innerHTML = all.slice(start).map(html).join('');
    const scr = list.closest('.so-scr');
    const card = list.closest('.so-card');
    const over = () => card.getBoundingClientRect().bottom > scr.getBoundingClientRect().bottom - 10;
    const rows = [...list.querySelectorAll('.so-row')];
    while (over() && rows.length > 1) rows.pop().remove();
    let shown = rows.length;
    if (start > 0 || start + shown < all.length) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'so-more'; more.dataset.act = 'more';
      list.appendChild(more);
      if (over() && rows.length > 1) { rows.pop().remove(); shown--; }
      more.textContent = t('more', { n: all.length - shown });
    }
    list.dataset.shown = String(shown);
  }
  _showUnseen(rows) {
    try {
      const unseen = MP.readUnseen();
      const r = rows.find((x) => x.over && unseen.includes(x.id) && MP.RESULTS.includes(x.result));
      if (!r) return;
      MP.markResultSeen(r.id);
      this._openOver({ result: r.result, them: { name: r.name, emoji: r.emoji }, why: r.why, id: r.id, mine: r.mine, theirs: r.theirs, rematch: { code: r.with, name: r.name, emoji: r.emoji } });
    } catch (err) { console.warn('[shoveoff] unseen result', err); }
  }

  // --- PEOPLE (Anyone) --------------------------------------------------------------------------
  async _showPeople() {
    this._scr('people');
    this._setBack(() => this._showSetup(), 1);
    this._people = null;
    this._renderPeople();
    const list = await MP.readOpponents();
    if (this.destroyed || this.screen !== 'people') return;
    this._people = list;
    this._paintPeople();
  }
  _renderPeople() {
    const box = this.el('[data-scr="people"]');
    box.innerHTML = `
      <div class="so-card so-people">
        <div class="so-head"><h2 class="so-title">${esc(t('anyone'))}</h2></div>
        <input type="search" class="so-search" data-role="search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" autocomplete="off" enterkeyhint="search">
        <div class="so-rows" data-role="people"></div>
      </div>`;
    this._paintPeople();
  }
  _paintPeople() {
    const list = this.el('[data-role="people"]');
    if (!list) return;
    if (!this._people) { list.innerHTML = `<p class="so-empty">${esc(t('loading'))}</p>`; return; }
    const q = String((this.el('[data-role="search"]') || {}).value || '').trim().toLowerCase();
    const all = this._people.filter((p) => !q || p.name.toLowerCase().includes(q));
    if (!all.length) { list.innerHTML = `<p class="so-empty">${esc(t('nobody'))}</p>`; return; }
    this._peopleShown = all;
    list._all = all.map((p, i) => ({ p, i }));
    list._start = this._pStart | 0;
    this._fitRows(list, peopleRow);
  }

  // --- CHALLENGE (one person, your look, Challenge) ---------------------------------------------
  _showChallenge(them, depth = 1) {
    this._chThem = them; this._chDepth = depth;
    this._scr('challenge');
    this._setBack(() => (depth >= 2 ? this._showPeople() : this._showSetup()), depth);
    const box = this.el('[data-scr="challenge"]');
    box.innerHTML = `
      <div class="so-card so-chcard">
        <div class="so-who"><span class="so-bigface" aria-hidden="true">${esc(them.emoji || '🙂')}</span><span class="so-whoname">${esc(them.name || t('anon'))}</span></div>
        ${this._looksHTML(this.s.look)}
        <button type="button" class="so-go" data-act="send">${esc(t('challenge'))}</button>
      </div>`;
    this._paintThumbs(box);
  }
  async _createWith(them) {
    if (this._busy) return;
    this._busy = true;
    const btn = this.root.querySelector('[data-act="send"]');
    if (btn) btn.disabled = true;
    const res = await MP.createGame({ them, look: this.s.look });
    this._busy = false;
    if (this.destroyed) return;
    if (!res.ok) { if (btn) btn.disabled = false; this._toast(reasonText(res.reason)); return; }
    this._openMatch(res.id, res.game);
  }

  // --- VS THE COMPUTER (cpu-game.js: the save, the result; cpu.js: the computer's aims) ------------
  /** New game (Play, New game, Again): over a started save that is ONE loss, asked twice by the caller. */
  _newCpu() {
    CG.settle();                                          // a save already decided counts as it ended
    const old = CG.readSave();
    if (old && CG.started(old)) CG.finish(old, true);     // the save is cleared first, then the loss recorded
    else if (old) CG.clearSave();
    writeDraft('cpu', 0, null);                           // no arrows left over from an earlier match
    const sv = CG.newSave(this.s.diff, this.s.look);
    if (!CG.writeSave(sv)) this._toast(t('not_saved'));
    this._openCpu(sv);
  }
  _openCpu(sv) {
    this._closeOverlays();
    this._leaveMatch();
    this._scr('play');
    this._setBack(() => this._showSetup(), 1);
    this.mp = { cpu: true, id: 'cpu', sv, game: null, side: 'a', them: null, draft: null, stop: null, pending: null, shown: 0 };
    // the computer's aims for this round exist BEFORE the player aims (chosen from the board only, kept in the save)
    if (!sv.cpu && CG.ensureCpuAims(sv)) CG.writeSave(sv);
    const g = CG.gameOf(sv, MP.meLabel(), t('cpu'));
    this.mp.shown = g.resolved;                         // reopening never replays an old round
    this._takeCpu(g);
    this._layout();
    if (this._canAim()) this._roundBanner();
    this._loop();
  }
  _takeCpu(g) {
    const mp = this.mp;
    mp.game = g;
    mp.them = g.b;
    mp.m = MP.replayGame(g) || E.newMatch(MP.rvOf(g));
    if (!mp.draft || mp.draft.r !== g.round) {
      const d = readDraft('cpu', g.round);
      mp.draft = { r: g.round, a: d && d.length <= E.slotCount(mp.m) ? d : [] };
    }
    if (g.resolved > mp.shown && !this.anim) this._animateRound(g.resolved);
    else if (!this.anim) { this._renderHud(); this._renderFoot(); this._draw(); }
    if (g.over && !this.anim) this._finish();
  }
  _launchCpu() {
    const mp = this.mp;
    const g = mp.game;
    const slots = E.slotCount(mp.m);
    const list = [];
    for (let i = 0; i < slots; i++) list.push(E.slotsOf(mp.m, 'a').includes(i) ? mp.draft.a[i] || null : null);
    const str = E.aimsToString(list);
    if (!E.parseAims(mp.m, 'a', str)) { this._toast(t('aim_all')); return; }
    const m = CG.playRound(mp.sv, str);
    if (!m) { this._toast(t('aim_all')); return; }
    // saved even when it decided the match (a close mid-slide must not let the round be played again);
    // _finishCpu clears it and records
    if (!CG.writeSave(mp.sv)) this._toast(t('not_saved'));
    writeDraft('cpu', g.round, null);
    this._takeCpu(CG.gameOf(mp.sv, MP.meLabel(), t('cpu')));
    // The next round's computer aims, chosen from the NEW board only (never from anything the player does next),
    // while the reveal is on screen, then saved; a close before this runs is caught by _openCpu.
    if (m.winner == null) setTimeout(() => { if (this.mp === mp && !this.destroyed && CG.ensureCpuAims(mp.sv)) CG.writeSave(mp.sv); }, 0);
  }
  /** The match vs the computer is over: clear the save, record ONE result, show it. */
  _finishCpu() {
    const mp = this.mp, g = mp.game;
    if (!mp.counted) { mp.counted = true; CG.finish(mp.sv); }
    if (mp.shownOver) return;
    mp.shownOver = true;
    const me = MP.meLabel();
    this._openOver({ result: MP.resultOf(g, 'a'), them: g.b, why: g.over.why, cpu: true, me });
  }

  // --- PLAY -------------------------------------------------------------------------------------
  async _openMatch(id, have = null) {
    this._closeOverlays();
    this._leaveMatch();
    this._scr('play');
    this._setBack(() => this._showSetup(), 1);
    this.mp = { id, game: null, side: null, draft: null, stop: null, pending: null };
    const mp = this.mp;
    this._renderHud(); this._renderFoot(); this._layout();
    try { await MP.drainOutbox(id); } catch { /* still in the outbox */ }
    const game = have || await MP.readGame(id);
    if (this.destroyed || this.mp !== mp) return;
    if (!game) { this._toast(t('mp_gone')); this._showSetup(); return; }
    this._takeGame(game, true);
    if (this._canAim()) this._roundBanner();
    this._loop();
    mp.stop = await MP.watchGame(id, (g) => { if (this.mp === mp && !this.destroyed) this._takeGame(g, false); });
    if (this.destroyed || this.mp !== mp) { try { mp.stop && mp.stop(); } catch { /* detached */ } return; }
    this._mountChat();
  }
  _takeGame(g, opening) {
    const mp = this.mp;
    const prev = mp.game;
    mp.game = g;
    mp.side = MP.sideOf(g, MP.myCode());
    if (!mp.side) { this._toast(t('mp_gone')); this._showSetup(); return; }
    mp.them = MP.themOf(g, MP.myCode());
    mp.pending = MP.pendingFor(g.id);
    // The arrows this phone has not launched yet, kept across a close.
    const r = g.round;
    if (!mp.draft || mp.draft.r !== r) {
      const d = readDraft(g.id, r);
      mp.draft = { r, a: d && d.length <= E.slotCount(MP.replayGame(g) || E.newMatch(MP.rvOf(g))) ? d : [] };
    }
    mp.m = MP.replayGame(g) || E.newMatch(MP.rvOf(g));
    const shown = MP.readShown(g.id);
    if (g.resolved > shown && g.resolved > 0 && !this.anim) {
      this._animateRound(g.resolved);
    } else if (!this.anim) {
      this._renderHud(); this._renderFoot(); this._layout();
    }
    if (g.over && !this.anim) this._finish();
    if (!g.over && (!prev || prev.updated !== g.updated) && !MP.isMyTurn(g, MP.myCode())) MP.markSeen(g.id, g.updated);
  }
  /** Slide round `n` (1-based count of resolved rounds) on screen: both sides' arrows, the slide, the shrink. */
  _animateRound(n) {
    const mp = this.mp;
    const g = mp.game;
    // the entry that resolved round n is the 2n-th of its round; replay to just before it with frames on it
    let count = 0, idx = -1;
    const per = new Map();
    for (let i = 0; i < g.log.length; i++) { const c = (per.get(g.log[i].r) || 0) + 1; per.set(g.log[i].r, c); if (c === 2 && ++count === n) { idx = i; break; } }
    if (idx < 0) { this._markShown(n); return; }
    const frames = [];
    const m = MP.replayGame(g, idx + 1, idx, frames);
    if (!m) { this._markShown(n); return; }
    const rec = m.rounds[m.rounds.length - 1];
    // Drawing only (fx.js): the hits, each piece's path length (puck spin, sumo waddle) and heading (cars).
    const RL = E.rulesOf(m);
    const N = rec.before.length;
    const hits = FX.findHits(rec.before, frames, rec.falls, rec.fallAt || [], E.R, E.MAX_AIM * RL.SPEED_K);
    const path = [], head = [];
    for (let i = 0; i < N; i++) {
      const L = new Float32Array(frames.length), Hd = new Float32Array(frames.length);
      const p = rec.before[i], aim = rec.aims[p.s] && rec.aims[p.s][p.i];
      let px = p.x, py = p.y, acc = 0, h = aim ? Math.atan2(aim[1], aim[0]) : this._faceOf(p);
      for (let k = 0; k < frames.length; k++) {
        const x = frames[k][i * 2], y = frames[k][i * 2 + 1], dx = x - px, dy = y - py, d = Math.sqrt(dx * dx + dy * dy);
        acc += d;
        if (d > 0.8) { let to = Math.atan2(dy, dx), dh = to - h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI; h += dh * 0.25; }
        L[k] = acc; Hd[k] = h; px = x; py = y;
      }
      path.push(L); head.push(Hd);
    }
    this.anim = { n, rec, frames, t0: performance.now(), m, hits, path, head, hitAt: 0, fallsDone: new Set(), sq: new Map(), launched: false, shrunk: false, partied: false };
    this._renderHud(rec.before);
    this._renderFoot();
    this._layout();
    this._loop();
  }
  /** One draw a frame while anything moves: a round playing, a drag, particles, a shake, or the aiming screen
   *  (the "aim me" rings turn, the water drifts; that idle redraw runs at ~30 fps). */
  _loop() {
    if (this.raf) return;
    let last = 0;
    const tick = (now) => {
      this.raf = 0;
      if (this.destroyed) return;
      const busy = this.anim || this.drag || this.P.busy || this.shake.busy || this._popUntil > performance.now();
      const idle = !busy && this.screen === 'play' && this._canAim() && !FX.reduced();
      if (busy || (idle && now - last > 30)) { last = now; try { this._draw(); } catch (err) { console.error('[shoveoff] draw', err); } }
      if (busy || idle) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  _animDone() {
    const a = this.anim;
    this.anim = null;
    const mp = this.mp;
    if (!mp || !mp.game) return;
    this._markShown(a.n);
    // where every piece ended up facing, so it does not snap back to the middle while the next round is aimed
    a.rec.before.forEach((p, i) => { if (a.head[i] && a.head[i].length) this._faceSet(p, a.head[i][a.head[i].length - 1]); });
    // More rounds than shown (both sent twice while away): show the next, else settle.
    if (mp.game.resolved > a.n) { this._animateRound(mp.game.resolved); return; }
    this._renderHud(); this._renderFoot(); this._draw();
    if (mp.game.over) this._finish();
    else this._roundBanner(a.m);
    this._loop();
  }
  /** "Round N" / "Sudden death" slams onto the board as a round begins (same words as the pill above). */
  _roundBanner(m = null) {
    const mp = this.mp, g = mp && mp.game;
    const b = this.el('.so-banner');
    if (!g || g.over || !b) return;
    const sd = m ? m.sd > 0 : g.sd > 0;
    b.textContent = sd ? t('sudden') : t('round_n', { n: g.round });
    b.classList.toggle('is-sd', sd);
    b.hidden = true; void b.offsetWidth;          // restart the animation
    b.hidden = false;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { b.hidden = true; }, FX.reduced() ? 900 : 1500);
  }
  _faceOf(p) {
    const mem = this.mp && this.mp.face;
    const f = mem && mem.get(p.s + p.i);
    return f != null ? f : Math.atan2(-p.y, -p.x);
  }
  _faceSet(p, a) { const mp = this.mp; if (!mp) return; if (!mp.face) mp.face = new Map(); mp.face.set(p.s + p.i, a); }
  /** A piece of `side` fell: its icon in the score bar is knocked out with a jolt (the final paint keeps it out). */
  _hudKO(side) {
    const icons = [...this.root.querySelectorAll(`.so-hud canvas[data-icon="${side}"][data-out="0"]`)];
    const c = icons[icons.length - 1];
    if (!c) return;
    c.dataset.out = '1';
    const looks = this._looks();
    A.drawIcon(c, looks[side], side, 22, Math.min(2, window.devicePixelRatio || 1), true);
    c.classList.remove('is-ko'); void c.offsetWidth; c.classList.add('is-ko');
    const card = c.closest('.so-pc');
    if (card) { card.classList.remove('is-hit'); void card.offsetWidth; card.classList.add('is-hit'); }
  }

  _finish() {
    const mp = this.mp;
    const g = mp && mp.game;
    if (!g || !g.over) return;
    this._renderHud(); this._renderFoot(); this._draw();
    if (mp.cpu) { this._finishCpu(); return; }
    if (MP.isCalledOff(g)) { if (!mp.shownOver) { mp.shownOver = true; this._toast(t(g.over.why === 'declined' ? 'mp_declined' : 'mp_cancelled'), 3200); } return; }
    try { MP.countGame(g); } catch (err) { console.error('[shoveoff] count', err); }
    MP.markResultSeen(g.id);
    MP.markSeen(g.id, g.updated);
    if (mp.shownOver) return;
    mp.shownOver = true;
    const left = g.left;
    this._openOver({ result: MP.resultOf(g, mp.side), them: mp.them, why: g.over.why, id: g.id, mine: left[mp.side], theirs: left[E.other(mp.side)],
      rematch: { code: mp.them.code, name: mp.them.name, emoji: mp.them.emoji } });
  }

  _markShown(n) {
    const mp = this.mp;
    if (!mp || !mp.game) return;
    if (mp.cpu) mp.shown = Math.max(mp.shown | 0, n); else MP.markShown(mp.game.id, n);
  }
  _myLook() {
    const mp = this.mp;
    const g = mp && mp.game;
    if (!g) return this.s.look;
    if (mp.cpu) return g.a.look;
    // The receiver plays in the look chosen NOW until their first send fixes it in the match.
    const fixed = g.log.some((e) => e.by === mp.side) || mp.side !== MP.recipientOf(g);
    return fixed ? g[mp.side].look : this.s.look;
  }
  _looks() {
    const mp = this.mp, g = mp.game;
    const mine = this._myLook();
    const la = mp.side === 'a' ? mine : g.a.look, lb = mp.side === 'b' ? mine : g.b.look;
    return A.sideLooks(la, lb);
  }
  _sent() {
    const mp = this.mp, g = mp && mp.game;
    if (!g || g.over) return false;
    return !g.owes[mp.side] || (mp.pending && mp.pending.r === g.round);
  }
  _canAim() {
    const mp = this.mp, g = mp && mp.game;
    return !!g && !g.over && !this.anim && !this._sent() && !this._sending;
  }

  _renderHud(pieces = null) {
    const hud = this.el('.so-hud');
    const mp = this.mp;
    const g = mp && mp.game;
    if (!g) { hud.innerHTML = ''; return; }
    const looks = this._looks();
    const ps = pieces || (mp.m ? mp.m.pieces : []);
    const slots = ps.length > 2 ? E.PIECES : 1;
    const card = (side, who, cls) => {
      const left = ps.filter((p) => p.s === side && p.alive).length;
      const owe = !g.over && !this.anim && g.owes[side];
      return `<div class="so-pc ${cls}${owe ? ' is-owe' : ''}">
        <span class="so-pcface" aria-hidden="true">${esc(who.emoji || '🙂')}</span>
        <span class="so-pctext"><span class="so-pcname">${esc(first(who.name) || t('anon'))}</span>
          <span class="so-icons" aria-label="${esc(t('aria_left', { n: left }))}">${Array.from({ length: slots }, (_, i) => `<canvas data-icon="${side}" data-out="${i >= left ? 1 : 0}"></canvas>`).join('')}</span></span>
      </div>`;
    };
    const me = mp.side, th = E.other(me);
    const last = mp.m && mp.m.rounds.length ? mp.m.rounds[mp.m.rounds.length - 1] : null;
    const lineRound = this.anim ? this.anim.rec.r : g.over && last ? last.r : g.round;
    const sd = this.anim ? !!this.anim.rec.sd : g.over && last ? !!last.sd : g.sd > 0;
    hud.innerHTML = `<div class="so-cards">${card(me, g[me], 'is-me')}${card(th, g[th], 'is-them')}</div>
      <div class="so-roundline">${esc(sd ? t('sudden') : t('round_n', { n: lineRound }))}</div>`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of hud.querySelectorAll('canvas[data-icon]')) A.drawIcon(c, looks[c.dataset.icon], c.dataset.icon, 22, dpr, c.dataset.out === '1');
  }
  _renderFoot() {
    const foot = this.el('.so-foot');
    const mp = this.mp;
    const g = mp && mp.game;
    if (!g) { foot.innerHTML = `<p class="so-status">${esc(t('loading'))}</p>`; return; }
    let mid;
    if (this.anim || g.over || this._sent()) this._lastHave = null;
    if (this.anim) mid = '';
    else if (g.over) mid = `<button type="button" class="so-go" data-act="overagain">${esc(t('result'))}</button>`;
    else if (this._sent()) mid = `<p class="so-status"><b>${esc(t('sent'))}</b> ${esc(t('waiting', { name: first(mp.them.name) || t('anon') }))}</p>`;
    else {
      const need = E.slotsOf(mp.m, mp.side);
      const have = need.filter((i) => mp.draft.a[i]).length;
      const bump = this._lastHave != null && have > this._lastHave ? ' is-bump' : '';
      this._lastHave = have;
      mid = have >= need.length && need.length
        ? `<button type="button" class="so-go so-launch${bump ? ' is-in' : ''}" data-act="launch"${this._sending ? ' disabled' : ''}>${esc(t('launch'))}</button>`
        : `<p class="so-status so-count${bump}" aria-label="${esc(t('aria_aimed', { a: have, b: need.length }))}">${have} / ${need.length}</p>`;
    }
    foot.innerHTML = `<button type="button" class="so-menubtn" data-act="menu" aria-label="${esc(t('menu'))}">${DOTS_SVG}</button>
      <div class="so-footmid">${mid}</div><span class="so-footpad" aria-hidden="true"></span>`;
  }

  // --- the board ----------------------------------------------------------------------------------
  _layout() {
    // The stylesheet can land after the first paint (in the hub): the thumbnails are re-drawn at their real size.
    if (this.screen === 'setup' || this.screen === 'challenge') this._paintThumbs(this.el(`[data-scr="${this.screen}"]`));
    if (this.screen === 'setup') { const l = this.el('[data-scr="setup"] .so-rows'); if (l && l._all) this._fitRows(l, (r) => this._rowHTML(r)); }
    if (this.screen !== 'play') return;
    const sec = this.el('[data-scr="play"]');
    const rect = sec.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const W = Math.max(1, rect.width), H = Math.max(1, rect.height);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    }
    const hud = this.el('.so-hud').getBoundingClientRect();
    const foot = this.el('.so-foot').getBoundingClientRect();
    const top = hud.bottom - rect.top + 6, bottom = foot.top - rect.top - 6;
    const g = this.mp && this.mp.game;
    const RL = E.RULES[g ? (MP.rvOf(g) || 1) : E.RV];
    let k;
    if (RL.shape === 'circle') {
      // rv 2: the round-1 circle fills the width (EDGE_PX each side) or the height between the HUD and the foot
      const rad = Math.max(60, Math.min((W - 2 * EDGE_PX) / 2, (bottom - top) / 2));
      k = rad / RL.H0;
    } else {
      const size = Math.max(120, Math.min(W - 16, bottom - top));
      k = size / (2 * WORLD);
    }
    this.view = { W, H, cx: W / 2, cy: top + (bottom - top) / 2, k };
    this._draw();
  }
  _toScreen(x, y) { const v = this.view; return [v.cx + x * v.k, v.cy + y * v.k]; }
  _toWorld(px, py) { const v = this.view; return [(px - v.cx) / v.k, (py - v.cy) / v.k]; }
  /** The still ground (and, for any but the bumper cars, its texture), drawn once per look and screen size into an
   *  offscreen canvas and copied each frame; the cars' water is drawn once a ripple-period wider and slid
   *  sideways. The platform is drawn live (it shrinks, and caching it cost a 30-120 ms rebuild at each change). */
  _bg(ctx, kind, now) {
    const v = this.view, dpr = this.dpr;
    const key = [kind, v.W, v.H, dpr].join('|');
    let c = this._bgCache;
    if (!c || c.key !== key) {
      const cv = c ? c.cv : document.createElement('canvas');
      cv.width = Math.round(v.W * dpr); cv.height = Math.round(v.H * dpr);
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      A.drawSurround(x, kind, v.W, v.H, kind === 'car' ? null : 0);
      let wv = null;
      if (kind === 'car') {
        wv = (c && c.wv) || document.createElement('canvas');
        wv.width = Math.round((v.W + A.WATER_PERIOD) * dpr); wv.height = cv.height;
        const wx = wv.getContext('2d'); wx.setTransform(dpr, 0, 0, dpr, 0, 0); wx.clearRect(0, 0, v.W + A.WATER_PERIOD, v.H);
        A.drawWater(wx, v.W + A.WATER_PERIOD, v.H, 0);
      }
      c = { key, cv, wv };
      this._bgCache = c;
    }
    ctx.drawImage(c.cv, 0, 0, v.W, v.H);
    if (c.wv) {
      const off = FX.reduced() ? 0 : ((now / 1000) * 1.4 * 46) % A.WATER_PERIOD;
      ctx.drawImage(c.wv, -off, 0, v.W + A.WATER_PERIOD, v.H);
    }
  }
  _draw() {
    if (this.screen !== 'play' || !this.view) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const v = this.view, now = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const mp = this.mp, g = mp && mp.game;
    const kind = A.kindOf(g ? this._myLook() : this.s.look);
    const m = mp && mp.m;
    this._bg(ctx, kind, now);
    if (!g || !m) return;
    const shape = E.rulesOf(m).shape;
    const [sx, sy] = FX.reduced() ? [0, 0] : this.shake.offset(now);
    ctx.save();
    ctx.translate(sx, sy);
    // the platform (the shrink draws its own, in _drawAnim)
    const shrinking = this.anim && now - this.anim.t0 >= REVEAL_MS + this._slideMs();
    if (!shrinking) A.drawPlatform(ctx, kind, v.cx, v.cy, (this.anim ? this.anim.rec.H : m.H) * v.k, shape);
    const looks = this._looks();
    const r = E.R * v.k;
    if (this.anim) this._drawAnim(ctx, kind, looks, r, now);
    else this._drawIdle(ctx, looks, r, now);
    this.P.draw(ctx, now);
    ctx.restore();
    if ((this.anim ? this.anim.rec.sd : g.sd > 0 && !g.over) && !FX.reduced()) this._vignette(ctx, now);
  }
  /** Sudden death: the screen's edges glow and breathe. */
  _vignette(ctx, now) {
    const v = this.view;
    const k = 0.5 + 0.5 * Math.sin(now / 420);
    const gr = ctx.createRadialGradient(v.cx, v.cy, Math.min(v.W, v.H) * 0.35, v.cx, v.cy, Math.max(v.W, v.H) * 0.75);
    gr.addColorStop(0, 'rgba(224,83,47,0)');
    gr.addColorStop(1, `rgba(224,83,47,${0.18 + 0.14 * k})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, v.W, v.H);
  }
  /** Between rounds: the pieces, my arrows, the power ring on the one being dragged. Pieces breathe, an unaimed
   *  piece's ring turns, a piece close to falling teeters, the dragged one is lifted. */
  _drawIdle(ctx, looks, r, now) {
    const mp = this.mp, g = mp.game, m = mp.m, v = this.view;
    const showMine = !g.over;
    const myAims = this._sent() ? (mp.pending && mp.pending.r === g.round ? (E.parseAims(m, mp.side, mp.pending.aims) || []) : this._sentAims()) : mp.draft.a;
    const canAim = this._canAim();
    const calm = FX.reduced();
    const RL = E.rulesOf(m);
    const edge = RL.shape === 'circle' ? E.fallDist(m.H) : m.H;
    const T = now / 1000;
    const drag = this.drag;
    for (const p of m.pieces) {
      if (!p.alive) continue;
      const [x, y] = this._toScreen(p.x, p.y);
      const aim = p.s === mp.side && showMine ? myAims[p.i] : null;
      const o = { ring: canAim && p.s === mp.side && !aim, spin: T * 0.9 };
      if (!calm) {
        const d = RL.shape === 'circle' ? Math.sqrt(p.x * p.x + p.y * p.y) : Math.max(Math.abs(p.x), Math.abs(p.y));
        const near = (d - edge * 0.78) / (edge * 0.22);
        if (near > 0) o.tilt = Math.sin(T * 9 + p.i * 2) * 0.16 * Math.min(1, near);      // teetering on the edge
        o.scale = 1 + Math.sin(T * 2.2 + p.i * 1.7 + (p.s === 'b' ? 1 : 0)) * 0.025;      // breathing
        const pop = mp.pop && mp.pop.get(p.s + p.i);
        if (drag && drag.p === p) { o.scale = 1.12; o.lift = r * 0.18; }
        else if (pop && now - pop < 260) { const q = (now - pop) / 260; o.scale = 1 + Math.sin(q * Math.PI) * 0.12; }
        if (drag && drag.p === p && aim) {
          const len = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]);
          if (len >= E.MAX_AIM - 1) o.tilt = (o.tilt || 0) + Math.sin(T * 60) * 0.06;     // straining at full power
        }
      }
      A.drawPiece(ctx, x, y, r, looks[p.s], p.s, aim ? Math.atan2(aim[1], aim[0]) : this._faceOf(p), o);
    }
    if (showMine) for (const p of m.pieces) {
      if (!p.alive || p.s !== mp.side) continue;
      const a = myAims[p.i];
      if (!a) continue;
      const [x, y] = this._toScreen(p.x, p.y);
      A.drawArrow(ctx, x, y, a[0] * v.k, a[1] * v.k, r, { alpha: this._sent() ? 0.55 : 1 });
      if (drag && drag.p === p) A.drawPower(ctx, x, y, r, Math.min(1, Math.sqrt(a[0] * a[0] + a[1] * a[1]) / E.MAX_AIM), 0.5 + 0.5 * Math.sin(T * 12));
    }
  }
  _slideMs() { const a = this.anim; return a ? Math.ceil(a.frames.length / STEPS_PER_FRAME) * (1000 / 60) : 0; }
  _sentAims() {
    const mp = this.mp, g = mp.game;
    const e = g.log.find((x) => x.by === mp.side && x.r === g.round);
    return e ? (E.parseAims(mp.m, mp.side, e.aims) || []) : [];
  }
  /** A round playing: reveal (arrows shoot out, pieces wind up), slide (trails, hits, falls), shrink (the edge
   *  crumbles), and, when it decided the match, the winner's pieces hopping. Only the garnish reads the clock;
   *  where every piece is comes from the engine's frames. */
  _drawAnim(ctx, kind, looks, r, now) {
    const a = this.anim, v = this.view;
    const rec = a.rec;
    const el = now - a.t0;
    const slideMs = this._slideMs();
    const party = a.m.winner != null && a.m.winner !== E.DRAW;
    const calm = FX.reduced();
    const tEnd = REVEAL_MS + slideMs + SHRINK_MS + (party ? PARTY_MS : 0);
    let phase, k = 0, q = 0;
    if (el < REVEAL_MS) phase = 'reveal';
    else if (el < REVEAL_MS + slideMs) { phase = 'slide'; k = Math.min(a.frames.length - 1, Math.floor((el - REVEAL_MS) / (1000 / 60) * STEPS_PER_FRAME)); }
    else if (el < REVEAL_MS + slideMs + SHRINK_MS) { phase = 'shrink'; q = (el - REVEAL_MS - slideMs) / SHRINK_MS; }
    else if (el < tEnd) { phase = 'party'; q = (el - REVEAL_MS - slideMs - SHRINK_MS) / PARTY_MS; }
    else { this._animDone(); return; }
    const Hpx = rec.H * v.k, H1px = rec.H1 * v.k;
    const shape = E.rulesOf(a.m).shape;
    const last = a.frames.length - 1;
    const fk = phase === 'reveal' ? -1 : phase === 'slide' ? k : last;
    const frame = fk < 0 ? null : a.frames[fk];
    if (phase === 'shrink' || phase === 'party') {
      if (phase === 'shrink') A.drawGhostEdge(ctx, kind, v.cx, v.cy, Hpx, 1 - q, shape);
      A.drawPlatform(ctx, kind, v.cx, v.cy, phase === 'party' ? H1px : H1px + (Hpx - H1px) * (1 - easeOut(q)), shape);
    }
    // --- one-time garnish as each moment arrives ---
    if (!calm) {
      if (phase !== 'reveal' && !a.launched) {
        a.launched = true;
        rec.before.forEach((p, i) => {
          const aim = p.alive && rec.aims[p.s] && rec.aims[p.s][p.i];
          if (!aim) return;
          const len = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]) || 1;
          FX.launchPuff(this.P, kind, ...this._toScreen(p.x, p.y), r, aim[0] / len, aim[1] / len, len / E.MAX_AIM);
        });
      }
      while (a.hitAt < a.hits.length && a.hits[a.hitAt].k <= fk) {
        const h = a.hits[a.hitAt++];
        const [hx, hy] = this._toScreen(h.x, h.y);
        FX.impact(this.P, hx, hy, h.s, r);
        if (h.s > 0.3) this.shake.kick(2 + h.s * 8);
        a.sq.set(h.i, { t: now, a: h.ang, s: h.s }); a.sq.set(h.j, { t: now, a: h.ang, s: h.s });
      }
      if ((phase === 'shrink' || phase === 'party') && !a.shrunk) {
        a.shrunk = true;
        if (rec.H1 < rec.H) { FX.crumble(this.P, kind, v.cx, v.cy, Hpx, r); this.shake.kick(2.5); }
      }
    }
    // a fall (off the edge mid-slide, or left outside when the edge melts): the score bar loses an icon at once
    rec.falls.forEach((i, n) => {
      const at = rec.fallAt ? rec.fallAt[n] : 0;
      if (fk >= at && !a.fallsDone.has(i)) {
        a.fallsDone.add(i);
        this._hudKO(rec.before[i].s);
        if (!calm) {
          const f = a.frames[Math.min(last, at)], pf = a.frames[Math.max(0, Math.min(last, at) - 1)];
          const [fx, fy] = this._toScreen(f[i * 2], f[i * 2 + 1]);
          FX.splash(this.P, kind, fx, fy, r, (f[i * 2] - pf[i * 2]) * v.k * 60 * STEPS_PER_FRAME, (f[i * 2 + 1] - pf[i * 2 + 1]) * v.k * 60 * STEPS_PER_FRAME);
          this.shake.kick(5);
        }
      }
    });
    if (phase === 'shrink' || phase === 'party') for (const i of rec.shrinkFalls) {
      if (a.fallsDone.has(i)) continue;
      a.fallsDone.add(i);
      this._hudKO(rec.before[i].s);
      if (!calm) { const f = a.frames[last]; FX.splash(this.P, kind, ...this._toScreen(f[i * 2], f[i * 2 + 1]), r); }
    }
    if (phase === 'party' && !a.partied) {
      a.partied = true;
      if (!calm && a.m.winner === this.mp.side) this._confetti();
    }
    // --- trails under the pieces ---
    if (phase === 'slide' && !calm) {
      const trail = kind === 'puck' ? '40,70,120' : kind === 'sumo' ? '255,240,215' : '255,255,255';
      rec.before.forEach((p, i) => {
        if (!p.alive || a.fallsDone.has(i)) return;
        const k0 = Math.max(0, k - TRAIL * STEPS_PER_FRAME);
        const f0 = a.frames[k0];
        const dx = frame[i * 2] - f0[i * 2], dy = frame[i * 2 + 1] - f0[i * 2 + 1];
        const d = Math.sqrt(dx * dx + dy * dy) * v.k;
        if (d < r * 0.6) return;
        ctx.save();
        ctx.lineCap = 'round';
        const steps = 6;
        for (let s = 0; s < steps; s++) {
          const ka = Math.max(0, k - Math.round((s / steps) * (k - k0))), kb = Math.max(0, k - Math.round(((s + 1) / steps) * (k - k0)));
          const [x1, y1] = this._toScreen(a.frames[ka][i * 2], a.frames[ka][i * 2 + 1]);
          const [x2, y2] = this._toScreen(a.frames[kb][i * 2], a.frames[kb][i * 2 + 1]);
          ctx.strokeStyle = `rgba(${trail},${0.22 * (1 - s / steps) * Math.min(1, d / (r * 3))})`;
          ctx.lineWidth = r * 1.5 * (1 - s / steps);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.restore();
      });
    }
    // --- the pieces ---
    const grow = Math.min(1, el / ARROW_GROW_MS);
    const growK = calm ? 1 : easeOutBack(grow);
    const wind = calm || phase !== 'reveal' ? 0 : Math.max(0, (el - (REVEAL_MS - WINDUP_MS)) / WINDUP_MS);
    rec.before.forEach((p, i) => {
      if (!p.alive) return;
      const aim = rec.aims[p.s] && rec.aims[p.s][p.i];
      let wx = p.x, wy = p.y, alpha = 1, scale = 1, tilt = 0;
      if (frame) { wx = frame[i * 2]; wy = frame[i * 2 + 1]; }
      const fi = rec.falls.indexOf(i);
      if (fi >= 0 && phase !== 'reveal') {
        const fs = rec.fallAt ? rec.fallAt[fi] : 0;
        const since = (phase === 'slide' ? k : a.frames.length + FALL_STEPS) - fs;
        if (since > 0) { const f = Math.min(1, since / FALL_STEPS); scale = 1 - f * 0.7; alpha = 1 - f * f; tilt = f * 3 * (i % 2 ? 1 : -1); }
      }
      if ((phase === 'shrink' || phase === 'party') && rec.shrinkFalls.indexOf(i) >= 0) {
        const f = phase === 'party' ? 1 : Math.min(1, q * 1.4);
        scale = 1 - f * 0.7; alpha = 1 - f * f; tilt = f * 3 * (i % 2 ? 1 : -1);
      }
      if (alpha <= 0.02) return;
      let [x, y] = this._toScreen(wx, wy);
      const o = { alpha, scale, tilt };
      const kd = A.kindOf(looks[p.s]);
      let ang = aim ? Math.atan2(aim[1], aim[0]) : this._faceOf(p);
      if (fk >= 0) {
        const L = a.path[i][fk];
        const sp = fk > 0 ? Math.abs(L - a.path[i][fk - 1]) : 0;
        if (kd === 'puck') ang += L / E.R * 0.6;                                         // pucks spin as they slide
        else if (!calm && phase === 'slide' && kd === 'car') {                           // cars lean into the slide, rattling
          o.tilt += Math.cos(a.head[i][fk]) * 0.22 * Math.min(1, sp / 8) + Math.sin(L / E.R * 6) * 0.04 * Math.min(1, sp / 8);
        } else if (!calm && phase === 'slide') {                                         // sumo: a waddle while moving
          o.tilt += Math.sin(L / E.R * 2.4) * 0.22 * Math.min(1, sp / 8);
        }
      }
      if (wind > 0 && aim) {
        // wind-up: pull back against the aim, squashed along it, harder shoves pull further
        const len = Math.sqrt(aim[0] * aim[0] + aim[1] * aim[1]) || 1;
        const pull = easeOut(Math.min(1, wind)) * r * 0.28 * (len / E.MAX_AIM);
        x -= aim[0] / len * pull; y -= aim[1] / len * pull;
        o.squash = { a: Math.atan2(aim[1], aim[0]), k: 0.12 * easeOut(Math.min(1, wind)) };
      }
      const sq = a.sq.get(i);
      if (sq && !calm) { const t2 = (now - sq.t) / 180; if (t2 < 1) o.squash = { a: sq.a, k: (0.06 + sq.s * 0.12) * Math.sin(t2 * Math.PI) }; }
      if (phase === 'party' && !calm && p.s === a.m.winner && fi < 0 && rec.shrinkFalls.indexOf(i) < 0) {
        const hop = Math.abs(Math.sin(q * Math.PI * 3 + i * 0.5)) * (1 - q * 0.5);
        o.lift = hop * r * 0.7; o.scale = scale * (1 + hop * 0.08);
      }
      A.drawPiece(ctx, x, y, r, looks[p.s], p.s, ang, o);
      if (phase === 'reveal' && aim) A.drawArrow(ctx, x, y, aim[0] * v.k * growK, aim[1] * v.k * growK, r, { color: p.s === this.mp.side ? '#ffce3a' : '#ffffff', alpha: Math.min(1, el / 200) });
    });
  }
  /** A win: confetti over everything (the card included) on its own canvas, until the last piece lands. */
  _confetti() {
    if (FX.reduced()) return;
    const c = this.fxCanvas, rect = this.root.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr);
    FX.confetti(this.PC, rect.width, rect.height);
    if (this._fxRaf) return;
    const tick = () => {
      this._fxRaf = 0;
      if (this.destroyed) return;
      const x = c.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, rect.width, rect.height);
      this.PC.draw(x);
      if (this.PC.busy) this._fxRaf = requestAnimationFrame(tick);
      else x.clearRect(0, 0, rect.width, rect.height);
    };
    this._fxRaf = requestAnimationFrame(tick);
  }

  // --- aiming input -------------------------------------------------------------------------------
  _pt(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _down(e) {
    if (!this._canAim() || !this.view) return;
    const mp = this.mp;
    const [px, py] = this._pt(e);
    const [wx, wy] = this._toWorld(px, py);
    let best = null, bd = (E.R * 1.6) ** 2;
    for (const p of mp.m.pieces) {
      if (!p.alive || p.s !== mp.side) continue;
      const d = (p.x - wx) ** 2 + (p.y - wy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* old browser */ }
    this.drag = { id: e.pointerId, p: best, moved: false };
    this._loop();
  }
  _move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const [px, py] = this._pt(e);
    const [wx, wy] = this._toWorld(px, py);
    const dx = wx - d.p.x, dy = wy - d.p.y;
    if (dx * dx + dy * dy < (E.R * 0.9) ** 2) { if (d.moved) this.mp.draft.a[d.p.i] = null; return; }
    d.moved = true;
    this.mp.draft.a[d.p.i] = E.clampAim(dx, dy);
  }
  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const mp = this.mp;
    if (!d.moved) mp.draft.a[d.p.i] = null;    // a tap clears that piece's arrow (then drag again)
    writeDraft(mp.game.id, mp.draft.r, mp.draft.a);
    if (!mp.pop) mp.pop = new Map();
    mp.pop.set(d.p.s + d.p.i, performance.now()); // a little bounce as it is let go
    this._popUntil = performance.now() + 280;
    this._renderFoot();
    this._draw();
    this._loop();
  }
  async _launch() {
    const mp = this.mp, g = mp && mp.game;
    if (!g || !this._canAim()) return;
    if (mp.cpu) { this._launchCpu(); return; }
    const slots = E.slotCount(mp.m);
    const list = [];
    for (let i = 0; i < slots; i++) list.push(E.slotsOf(mp.m, mp.side).includes(i) ? mp.draft.a[i] || null : null);
    const str = E.aimsToString(list);
    if (!E.parseAims(mp.m, mp.side, str)) { this._toast(t('aim_all')); return; }
    this._sending = true;
    const look = this._myLook();
    MP.savePending(g.id, g.round, str, look);     // kept until it lands: no signal never loses a round
    mp.pending = { r: g.round, aims: str };
    this._renderFoot(); this._draw();
    const res = await MP.sendAims(g.id, g.round, str, look);
    this._sending = false;
    if (this.destroyed || this.mp !== mp) return;
    if (res.ok) {
      MP.savePending(g.id, g.round, null);
      mp.pending = null;
      writeDraft(g.id, g.round, null);
      this._takeGame(res.game, false);
      return;
    }
    if (!res.retryable) { MP.savePending(g.id, g.round, null); mp.pending = null; }
    this._toast(res.retryable ? t('mp_queued') : reasonText(res.reason), 3200);
    this._renderFoot(); this._draw();
  }

  // --- overlays -----------------------------------------------------------------------------------
  _closeOverlays() { for (const o of this.root.querySelectorAll('.so-ov')) { o.hidden = true; o.innerHTML = ''; } }
  _openHelp() {
    const ov = this.el('[data-ov="help"]');
    ov.innerHTML = `<div class="so-card so-help" role="dialog" aria-modal="true" aria-label="${esc(t('help'))}">
      <button type="button" class="so-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <p class="so-goal">${esc(t('help_goal'))}</p>
      ${helpSVG()}
      <p class="so-hl">${esc(t('help_aim'))}</p>
      <p class="so-hl">${esc(t('help_eg'))}</p>
      <p class="so-hl">${esc(t('help_off'))}</p>
      <p class="so-hl">${esc(t('help_shrink'))}</p>
      <p class="so-hl">${esc(t('help_sd'))}</p>
    </div>`;
    ov.hidden = false;
    this._fitLines(ov);
  }
  /** Every line of How to play on ONE row: the goal and the lines each shrink to fit (goal floor 17px, lines
   *  15px), the lines all to the SAME size (the smallest any of them needs); never wrapped unless 15px fails. */
  _fitLines(scope) {
    const fit = (els, min) => {
      if (!els.length) return;
      let fs = parseFloat(getComputedStyle(els[0]).fontSize) || 17;
      const over = () => els.some((p) => p.scrollWidth > p.clientWidth + 1);
      while (over() && fs > min) { fs -= 0.5; for (const p of els) p.style.fontSize = fs + 'px'; }
      for (const p of els) if (p.scrollWidth > p.clientWidth + 1) p.style.whiteSpace = 'normal';
    };
    fit([...scope.querySelectorAll('.so-goal')], 17);
    fit([...scope.querySelectorAll('.so-hl')], 15);
  }
  async _openMenu() {
    const mp = this.mp, g = mp && mp.game;
    const ov = this.el('[data-ov="menu"]');
    let action = null, loss = false;
    if (mp && mp.cpu) {
      if (g && !g.over) { action = 'newcpu'; loss = CG.started(mp.sv); }
    } else if (g && !g.over) {
      const life = MP.lifeOf(g);
      if (!life.expired) {
        if (!life.open) { action = 'resign'; loss = true; }
        else { action = mp.side === MP.recipientOf(g) ? 'decline' : 'cancel'; loss = MP.cancelCosts(g); }
      }
    }
    ov.innerHTML = `<div class="so-card so-menu" role="dialog" aria-modal="true" aria-label="${esc(t('menu'))}">
      <button type="button" class="so-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <button type="button" class="so-mbtn" data-act="help">${esc(t('help'))}</button>
      ${action ? `<button type="button" class="so-mbtn so-danger" data-act="end" data-v="${action}">${esc(t(action === 'newcpu' ? 'new_game' : 'end_' + action))}</button>
        <p class="so-loss" data-role="loss" hidden>${loss ? esc(t('counts_loss')) : ''}</p>` : ''}
      <button type="button" class="so-mbtn" data-act="tosetup">${esc(t(mp && mp.cpu ? 'settings' : 'to_setup'))}</button>
    </div>`;
    ov.hidden = false;
  }
  async _end(btn) {
    // Two taps: the first says what it costs, the second does it.
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = t('sure');
      const l = this.root.querySelector('[data-role="loss"]');
      if (l && l.textContent) l.hidden = false;
      return;
    }
    const mp = this.mp, g = mp && mp.game;
    if (!g) return;
    if (btn.dataset.v === 'newcpu') { this._newCpu(); return; }
    btn.disabled = true;
    const res = btn.dataset.v === 'resign' ? await MP.resignGame(g.id) : await MP.cancelGame(g.id);
    if (this.destroyed || this.mp !== mp) return;
    this._closeOverlays();
    if (!res.ok) { this._toast(reasonText(res.reason)); return; }
    if (res.cancelled) { this._toast(t('mp_cancelled')); this._showSetup(); return; }
    this._takeGame(res.game, false);
  }
  _openOver(o) {
    const ov = this.el('[data-ov="over"]');
    this._overInfo = o;
    const name = first(o.them && o.them.name) || t('anon');
    const me = MP.meLabel();
    const head = o.result === 'won' ? t('you_win', { name: first(me.name) || t('anon') }) : o.result === 'lost' ? t('they_win', { name }) : t('draw');
    const face = o.result === 'won' ? me.emoji : o.result === 'lost' ? (o.them && o.them.emoji) : '🤝';
    const why = o.why === 'resign' ? t(o.result === 'won' ? 'why_resign_them' : 'why_resign_me', { name }) : o.why === 'timeout' ? t('why_timeout')
      : o.why === 'sudden' ? t('sudden') : o.why === 'count' ? t('why_count') : '';
    ov.innerHTML = `<div class="so-card so-over is-${o.result === 'won' ? 'won' : o.result === 'lost' ? 'lost' : 'draw'}" role="dialog" aria-modal="true" aria-label="${esc(head)}">
      <button type="button" class="so-x" data-act="close" aria-label="${esc(t('close'))}">${X_SVG}</button>
      <div class="so-overface" aria-hidden="true">${esc(face || '🙂')}</div>
      <h2 class="so-overhead">${esc(head)}</h2>
      ${why ? `<p class="so-overwhy">${esc(why)}</p>` : ''}
      <div class="so-overbtns">
        ${o.cpu ? `<button type="button" class="so-go" data-act="cpuagain">${esc(t('again'))}</button>`
          : o.rematch && o.rematch.code ? `<button type="button" class="so-go" data-act="rematch">${esc(t('again'))}</button>` : ''}
        <button type="button" class="so-alt" data-act="tosetup">${esc(t(o.cpu ? 'settings' : 'to_setup'))}</button>
      </div>
    </div>`;
    ov.hidden = false;
    if (o.result === 'won' && !this.PC.busy) this._confetti();
  }

  // --- quick chat (js/match-chat-ui.js + js/match-chat.js, `shoveoff/chat/<id>`) -----------------
  async _mountChat() {
    this._unmountChat();
    const mp = this.mp;
    if (!mp || !mp.game || mp.cpu) return;          // no quick chat against the computer
    let UI, DATA;
    try { [UI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
    if (this.destroyed || this.mp !== mp || this._chat) return;
    const node = MP.NODE, side = mp.side;
    const seenAt = DATA.readChatSeen(node, mp.id);
    const top = this.el('.so-roundline');
    const sec = this.el('[data-scr="play"]');
    const y = top ? Math.round(top.getBoundingClientRect().top - sec.getBoundingClientRect().top - 6) : 120;
    const chat = UI.createMatchChat({
      root: this.el('[data-scr="play"]'),
      send: (p) => DATA.sendChat({ node, id: mp.id, side }, p),
      photos: { node, id: mp.id, side },
      them: () => ({ name: (mp.them && mp.them.name) || '?', emoji: (mp.them && mp.them.emoji) || '' }),
      place: { top: `${y}px`, right: '10px', popsTop: `${y + 54}px` },
    });
    this._chat = chat;
    const stop = await DATA.watchChat({ node, id: mp.id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === side;
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at }, { pop: !mine && c.at > seenAt });
        if (!mine) newest = Math.max(newest, c.at);
      }
      DATA.markChatSeen(node, mp.id, newest);
    });
    if (this.destroyed || this.mp !== mp || this._chat !== chat) { try { stop(); } catch { /* detached */ } return; }
    this._chatStop = stop;
  }
  _unmountChat() {
    if (this._chatStop) { try { this._chatStop(); } catch { /* detached */ } this._chatStop = null; }
    if (this._chat) { try { this._chat.destroy(); } catch { /* gone */ } this._chat = null; }
  }
  _leaveMatch() {
    this._unmountChat();
    const mp = this.mp;
    this.mp = null;
    this.anim = null;
    this.drag = null;
    this._lastHave = null;
    this.P.clear();
    clearTimeout(this._bannerT);
    const b = this.el('.so-banner'); if (b) b.hidden = true;
    if (mp && mp.stop) { try { mp.stop(); } catch { /* detached */ } }
  }

  // --- taps ---------------------------------------------------------------------------------------
  _click(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !this.root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'look') {
      this.s.look = b.dataset.v; saveSettings(this.s);
      const scope = b.closest('.so-looks');
      for (const x of scope.querySelectorAll('.so-look')) {
        const on = x.dataset.v === this.s.look;
        x.classList.toggle('is-sel', on); x.setAttribute('aria-checked', String(on));
        x.classList.toggle('is-pop', on && x === b);
        const chk = x.querySelector('.so-chk');
        if (on && !chk) x.insertAdjacentHTML('beforeend', '<span class="so-chk" aria-hidden="true">&#10003;</span>');
        if (!on && chk) chk.remove();
      }
    } else if (act === 'tab') { this.s.tab = b.dataset.v; this._tabPicked = true; saveSettings(this.s); this._mStart = 0; this._renderSetup(); }
    else if (act === 'help') { this._closeOverlays(); this._openHelp(); }
    else if (act === 'close') this._closeOverlays();
    else if (act === 'more') {
      const l = b.closest('.so-rows');
      const st = (l._start | 0) + (Number(l.dataset.shown) || 1);
      l._start = st >= l._all.length ? 0 : st;
      if (this.screen === 'people') this._pStart = l._start; else this._mStart = l._start;
      this._fitRows(l, this.screen === 'people' ? ((x) => peopleRow(x)) : ((r) => this._rowHTML(r)));
    }
    else if (act === 'open') this._openMatch(b.dataset.id);
    else if (act === 'anyone') { this._pStart = 0; this._showPeople(); }
    else if (act === 'recent') { const o = (this._recentList || [])[Number(b.dataset.oi)]; if (o) this._showChallenge(o, 1); }
    else if (act === 'person') { const p = (this._peopleShown || [])[Number(b.dataset.pi)]; if (p) this._showChallenge(p, 2); }
    else if (act === 'send') { if (this._chThem) this._createWith(this._chThem); }
    else if (act === 'launch') this._launch();
    else if (act === 'menu') this._openMenu();
    else if (act === 'end') this._end(b);
    else if (act === 'tosetup') { if (this.mp && this.mp.cpu) { this.s.tab = 'cpu'; this._tabPicked = true; } this._showSetup(); }
    else if (act === 'diff') {
      this.s.diff = CG.asDiff(b.dataset.v); saveSettings(this.s);
      for (const x of b.parentNode.querySelectorAll('.so-diff')) { const on = x.dataset.v === this.s.diff; x.classList.toggle('is-sel', on); x.setAttribute('aria-checked', String(on)); }
    }
    else if (act === 'cpucont') { const sv = CG.readSave(); if (sv) this._openCpu(sv); else this._renderSetup(); }
    else if (act === 'cpunew') {
      // over a started match: two taps, the first says it counts as a loss
      const sv = CG.readSave();
      if (sv && CG.started(sv) && !b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = t('sure');
        const l = this.root.querySelector('[data-role="cpuloss"]'); if (l) l.hidden = false;
        return;
      }
      this._newCpu();
    }
    else if (act === 'cpuagain') this._newCpu();
    else if (act === 'overagain') { const g = this.mp && this.mp.game; if (g) { this.mp.shownOver = false; this._finish(); } }
    else if (act === 'rematch') { const o = this._overInfo; this._closeOverlays(); if (o && o.rematch) this._showChallenge(o.rematch, 1); }
  }

  destroy() {
    this.destroyed = true;
    try { this._setBack(null); } catch { /* gone */ }
    if (this._bs) { try { this._bs.close(); } catch { /* gone */ } this._bs = null; }
    this._leaveMatch();
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this._fxRaf) cancelAnimationFrame(this._fxRaf);
    clearTimeout(this._toastT);
    clearTimeout(this._bannerT);
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('input', this._onInput);
    this.root.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    document.removeEventListener('keydown', this._onKey);
    if (this._offResize) this._offResize();
    if (this._offLang) this._offLang();
    if (this._offTheme) this._offTheme();
    this.root.remove();
  }
}

function peopleRow({ p, i }) {
  return `<button type="button" class="so-row" data-act="person" data-pi="${i}">
      <span class="so-face" aria-hidden="true">${esc(p.emoji)}</span>
      <span class="so-rowtext"><span class="so-rowname">${esc(p.name)}</span></span><span class="so-chev" aria-hidden="true">›</span></button>`;
}
function easeOut(k) { return 1 - (1 - k) * (1 - k); }
function easeOutBack(k) { const c = 1.7; const u = k - 1; return 1 + (c + 1) * u * u * u + c * u * u; }

/** How to play's diagram: the platform, an aimed piece of each side (circle / triangle markers, never
 *  colour alone), one shoved off the edge, and the smaller platform of the next round dashed. */
function helpSVG() {
  return `<svg class="so-diagram" viewBox="0 0 260 150" role="img" aria-label="${esc(t('help_aria'))}">
    <rect x="0" y="0" width="260" height="150" rx="12" fill="#163e63"/>
    <circle cx="103" cy="75" r="64" fill="#d9b77e" stroke="#f1dcae" stroke-width="3"/>
    <circle cx="103" cy="75" r="46" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="6 5"/>
    <circle cx="76" cy="96" r="13" fill="#E0532F" stroke="#7a2412" stroke-width="2"/><circle cx="76" cy="96" r="5" fill="#fff"/>
    <path d="M90 88 L132 64" stroke="#ffce3a" stroke-width="5" stroke-linecap="round"/><path d="M138 60 L124 62 L131 73 Z" fill="#ffce3a"/>
    <circle cx="140" cy="58" r="13" fill="#1F5FA8" stroke="#0e2f57" stroke-width="2"/><path d="M140 51 L146 62 L134 62 Z" fill="#fff"/>
    <path d="M152 52 L186 34" stroke="#ffffff" stroke-width="3" stroke-dasharray="4 4"/>
    <circle cx="200" cy="28" r="11" fill="#1F5FA8" opacity=".45"/><circle cx="200" cy="28" r="17" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>
    <path d="M200 23 L205 32 L195 32 Z" fill="#fff" opacity=".7"/>
    <text x="214" y="70" fill="#fff" font-size="26" font-weight="800" font-family="system-ui,sans-serif">&#10007;</text>
  </svg>`;
}

let instance = null;
export function init(container) {
  if (instance) instance.destroy();
  instance = new ShoveOff(container);
  if (typeof window !== 'undefined') window.__soTest = instance;
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
  if (typeof window !== 'undefined') delete window.__soTest;
}
/** Always false: every round is saved the moment it is launched, arrows in progress are kept on the phone. */
export function isInProgress() { return false; }
/** The hub's back (button or the phone's swipe): one screen back, if one is up. */
export function back() { return !!(instance && instance.back()); }
export default { init, destroy, isInProgress, back };
