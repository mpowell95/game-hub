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
const WORLD = E.H0 + 60;                     // half the world the board shows (the platform plus a margin of water)
const STEPS_PER_FRAME = 2;                   // a round's slide plays at twice the simulation's step rate
const REVEAL_MS = 1100;                      // both sides' arrows shown before the slide
const SHRINK_MS = 700;

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
        <div class="so-hud"></div>
        <div class="so-foot"></div>
      </section>
      <div class="so-ov" data-ov="help" hidden></div>
      <div class="so-ov" data-ov="menu" hidden></div>
      <div class="so-ov" data-ov="over" hidden></div>
      <div class="so-toast" role="status" aria-live="polite" hidden></div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('.so-board');
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
  }
  _takeCpu(g) {
    const mp = this.mp;
    mp.game = g;
    mp.them = g.b;
    mp.m = MP.replay(g.log) || E.newMatch();
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
      mp.draft = { r, a: d && d.length <= E.slotCount(MP.replay(g.log) || E.newMatch()) ? d : [] };
    }
    mp.m = MP.replay(g.log) || E.newMatch();
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
    const m = MP.replay(g.log, idx + 1, idx, frames);
    if (!m) { this._markShown(n); return; }
    const rec = m.rounds[m.rounds.length - 1];
    this.anim = { n, rec, frames, t0: performance.now(), m };
    this._renderHud(rec.before);
    this._renderFoot();
    this._layout();
    this._loop();
  }
  _loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      if (this.destroyed) return;
      try { this._draw(); } catch (err) { console.error('[shoveoff] draw', err); }
      if (this.anim || this.drag) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  _animDone() {
    const a = this.anim;
    this.anim = null;
    const mp = this.mp;
    if (!mp || !mp.game) return;
    this._markShown(a.n);
    // More rounds than shown (both sent twice while away): show the next, else settle.
    if (mp.game.resolved > a.n) { this._animateRound(mp.game.resolved); return; }
    this._renderHud(); this._renderFoot(); this._draw();
    if (mp.game.over) this._finish();
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
    if (this.anim) mid = '';
    else if (g.over) mid = `<button type="button" class="so-go" data-act="overagain">${esc(t('result'))}</button>`;
    else if (this._sent()) mid = `<p class="so-status"><b>${esc(t('sent'))}</b> ${esc(t('waiting', { name: first(mp.them.name) || t('anon') }))}</p>`;
    else {
      const need = E.slotsOf(mp.m, mp.side);
      const have = need.filter((i) => mp.draft.a[i]).length;
      mid = have >= need.length && need.length
        ? `<button type="button" class="so-go so-launch" data-act="launch"${this._sending ? ' disabled' : ''}>${esc(t('launch'))}</button>`
        : `<p class="so-status so-count" aria-label="${esc(t('aria_aimed', { a: have, b: need.length }))}">${have} / ${need.length}</p>`;
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
    const size = Math.max(120, Math.min(W - 16, bottom - top));
    this.view = { W, H, cx: W / 2, cy: top + (bottom - top) / 2, k: size / (2 * WORLD) };
    this._draw();
  }
  _toScreen(x, y) { const v = this.view; return [v.cx + x * v.k, v.cy + y * v.k]; }
  _toWorld(px, py) { const v = this.view; return [(px - v.cx) / v.k, (py - v.cy) / v.k]; }
  _draw() {
    if (this.screen !== 'play' || !this.view) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const mp = this.mp, g = mp && mp.game;
    const kind = A.kindOf(g ? this._myLook() : this.s.look);
    A.drawSurround(ctx, kind, v.W, v.H, 0);
    if (!g) return;
    const looks = this._looks();
    const r = E.R * v.k;
    const face = (p, aim) => (aim ? Math.atan2(aim[1], aim[0]) : Math.atan2(-p.y, -p.x));
    if (this.anim) { this._drawAnim(ctx, kind, looks, r, face); return; }
    const m = mp.m;
    A.drawPlatform(ctx, kind, v.cx, v.cy, m.H * v.k);
    const showMine = !g.over;
    const myAims = this._sent() ? (mp.pending && mp.pending.r === g.round ? (E.parseAims(m, mp.side, mp.pending.aims) || []) : this._sentAims()) : mp.draft.a;
    const canAim = this._canAim();
    for (const p of m.pieces) {
      if (!p.alive) continue;
      const [x, y] = this._toScreen(p.x, p.y);
      const aim = p.s === mp.side && showMine ? myAims[p.i] : null;
      A.drawPiece(ctx, x, y, r, looks[p.s], p.s, face(p, aim), { ring: canAim && p.s === mp.side && !aim });
    }
    if (showMine) for (const p of m.pieces) {
      if (!p.alive || p.s !== mp.side) continue;
      const a = myAims[p.i];
      if (!a) continue;
      const [x, y] = this._toScreen(p.x, p.y);
      A.drawArrow(ctx, x, y, a[0] * v.k, a[1] * v.k, r, { alpha: this._sent() ? 0.55 : 1 });
    }
  }
  _sentAims() {
    const mp = this.mp, g = mp.game;
    const e = g.log.find((x) => x.by === mp.side && x.r === g.round);
    return e ? (E.parseAims(mp.m, mp.side, e.aims) || []) : [];
  }
  _drawAnim(ctx, kind, looks, r, face) {
    const a = this.anim, v = this.view;
    const rec = a.rec;
    const el = performance.now() - a.t0;
    const slideMs = Math.ceil(a.frames.length / STEPS_PER_FRAME) * (1000 / 60);
    let phase, k = 0;
    if (el < REVEAL_MS) phase = 'reveal';
    else if (el < REVEAL_MS + slideMs) { phase = 'slide'; k = Math.min(a.frames.length - 1, Math.floor((el - REVEAL_MS) / (1000 / 60) * STEPS_PER_FRAME)); }
    else if (el < REVEAL_MS + slideMs + SHRINK_MS) { phase = 'shrink'; k = (el - REVEAL_MS - slideMs) / SHRINK_MS; }
    else { this._animDone(); return; }
    const Hpx = rec.H * v.k, H1px = rec.H1 * v.k;
    if (phase === 'shrink') {
      A.drawGhostEdge(ctx, kind, v.cx, v.cy, Hpx, 1 - k);
      A.drawPlatform(ctx, kind, v.cx, v.cy, H1px + (Hpx - H1px) * (1 - easeOut(k)));
    } else A.drawPlatform(ctx, kind, v.cx, v.cy, Hpx);
    const frame = phase === 'reveal' ? null : phase === 'slide' ? a.frames[k] : a.frames[a.frames.length - 1];
    rec.before.forEach((p, i) => {
      if (!p.alive) return;
      const aim = rec.aims[p.s] && rec.aims[p.s][p.i];
      let wx = p.x, wy = p.y, alpha = 1, scale = 1;
      if (frame) { wx = frame[i * 2]; wy = frame[i * 2 + 1]; }
      const fell = rec.falls.indexOf(i) >= 0;
      if (fell && phase !== 'reveal') {
        const fs = Math.max(0, a.frames.findIndex((f) => Math.abs(f[i * 2]) > rec.H || Math.abs(f[i * 2 + 1]) > rec.H));
        const since = (phase === 'slide' ? k : a.frames.length + 20) - fs;
        if (since > 0) { const q = Math.min(1, since / 26); scale = 1 - q * 0.65; alpha = 1 - q; if (q < 1) A.drawSplash(ctx, kind, ...this._toScreen(wx, wy), r, q); }
      }
      if (phase === 'shrink' && rec.shrinkFalls.indexOf(i) >= 0) { scale = 1 - k * 0.65; alpha = 1 - k; A.drawSplash(ctx, kind, ...this._toScreen(wx, wy), r, k); }
      if (alpha <= 0.02) return;
      const [x, y] = this._toScreen(wx, wy);
      A.drawPiece(ctx, x, y, r, looks[p.s], p.s, face(p, aim), { alpha, scale });
      if (phase === 'reveal' && aim) A.drawArrow(ctx, x, y, aim[0] * v.k, aim[1] * v.k, r, { color: p.s === this.mp.side ? '#ffce3a' : '#ffffff', alpha: Math.min(1, el / 300) });
    });
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
    this._renderFoot();
    this._draw();
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
    ov.innerHTML = `<div class="so-card so-over" role="dialog" aria-modal="true" aria-label="${esc(head)}">
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
    clearTimeout(this._toastT);
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

/** How to play's diagram: the platform, an aimed piece of each side (circle / triangle markers, never
 *  colour alone), one shoved off the edge, and the smaller platform of the next round dashed. */
function helpSVG() {
  return `<svg class="so-diagram" viewBox="0 0 260 150" role="img" aria-label="${esc(t('help_aria'))}">
    <rect x="0" y="0" width="260" height="150" rx="12" fill="#163e63"/>
    <rect x="40" y="12" width="126" height="126" rx="8" fill="#d9b77e" stroke="#f1dcae" stroke-width="3"/>
    <rect x="58" y="30" width="90" height="90" rx="6" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="6 5"/>
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
