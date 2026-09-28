// cup-pong/js/ui.js - CUP PONG: the setup screen, the flick, the match flow, the module contract.
//
// THE LAW applies here. Nothing in this folder stores anything earned: `gamehub.cuppong.v1` holds
// preferences only (difficulty, Gentleman's, who opens next). A finished match vs the computer goes
// to the shared recorder, `recordResult('cuppong', difficulty, won)`, exactly once; a CLEARED solo
// rack goes to `recordCupPongSolo(throws)`, exactly once. Neither is persisted mid-way - see
// isInProgress() for which meaning of the contract that is.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { recordResult, recordCupPongSolo, loadStats } from '../../js/game-stats.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { THROW, CUP, RACK_Z0, ROW_H } from './geom.js';
import { makeRack, cupsXZ, presetsFor, cellXZ, AREA } from './rack.js';
import { Match } from './match.js';

/** The middle of the full rack, along the table: where aim is measured. */
const RACK_MID_Z = RACK_Z0 + 1.5 * ROW_H;

const t = makeT(STRINGS);
const CSS_MARK = 'data-cuppong-css';
const SETTINGS_KEY = 'gamehub.cuppong.v1';
const SETTLE_MS = 450;          // after a throw resolves, before anything else happens
const CPU_PAUSE_MS = 900;       // before each computer throw, so it reads as a person lining up
const TURN_PAUSE_MS = 700;      // between one side's last throw and the camera moving
const DIFFS = ['easy', 'medium', 'hard'];
const RERACKS = [0, 1, 2, 3, 'inf'];

let instance = null;

/** This player's fewest throws to clear a solo rack, from their own stats store; 0 = never. */
function soloBest() {
  try { return ((((loadStats().games || {}).cuppong || {}).cp || {}).soloBest) | 0; } catch { return 0; }
}

const readSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      diff: DIFFS.includes(raw.diff) ? raw.diff : 'medium',
      gentlemans: raw.gentlemans !== false,          // default On (brief 4a)
      reracks: RERACKS.includes(raw.reracks) ? raw.reracks : 2,   // per player per game, default 2
      // Turn-based games alternate who opens (docs/BUILDING-A-GAME.md, setup defaults).
      nextFirst: raw.nextFirst === 'b' ? 'b' : 'a',
    };
  } catch { return { diff: 'medium', gentlemans: true, reracks: 2, nextFirst: 'a' }; }
};
const writeSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

/** css/ui.css's primitives first (idempotent, matched by resolved href too, the same guard
 *  skeeball and hoops4 use), then this game's own sheet. Module stylesheets are never removed on
 *  destroy() - they live in document.head for the life of the page, which is why every rule in
 *  cup-pong.css is scoped under .cp-root. Resolves once the sheet has parsed (capped). */
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
  const href = new URL('../css/cup-pong.css', import.meta.url).href;
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

/** A preset, drawn top-down: one circle per cup, the shooter at the bottom. Shape only, one colour. */
function presetSVG(spots) {
  const pts = spots.map((sp) => cellXZ(sp));
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const r = 0.0485, pad = 0.01;
  const x0 = Math.min(...xs) - r - pad, x1 = Math.max(...xs) + r + pad;
  const z0 = Math.min(...zs) - r - pad, z1 = Math.max(...zs) + r + pad;
  const w = x1 - x0, h = z1 - z0, sc = 56 / Math.max(w, h);
  return `<svg viewBox="0 0 ${(w * sc).toFixed(1)} ${(h * sc).toFixed(1)}" width="${(w * sc).toFixed(0)}" height="${(h * sc).toFixed(0)}" aria-hidden="true">${
    pts.map((p) => `<circle cx="${((p.x - x0) * sc).toFixed(1)}" cy="${((p.z - z0) * sc).toFixed(1)}" r="${(r * sc * 0.94).toFixed(1)}"/>`).join('')}</svg>`;
}

/** Every cell of the rack area (brief 4c's grid), far row first: where a custom rack may put a cup. */
const AREA_CELLS = (() => {
  const out = [];
  for (let r = 0; r <= AREA.rMax; r++) for (let c = -AREA.cMax; c <= AREA.cMax; c++) if (Math.abs(c + r) % 2 === 1) out.push({ c, r });
  return out;
})();

/** The "make your own" icon: a triangle of dashed spots with one cup lifted off it. */
const CUSTOM_ICON = `<svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">${
  [[10, 14], [28, 14], [19, 30], [37, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/>`).join('')
}<circle cx="46" cy="14" r="8"/><circle cx="28" cy="46" r="8"/><path d="M40 22 L32 38" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`;

const escapeHTML = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

class CupPong {
  constructor(root) {
    this.root = root;
    this.settings = readSettings();
    this.disposed = false;
    this.raf = 0;
    this.engine = null;      // { phys, rend, cpu }
    this.mode = null;        // 'solo' | 'cpu'
    this.match = null;       // Match, in 'cpu' mode
    this.rack = [];          // solo: the cups still standing
    this.throws = 0;
    this.throwState = null;
    this.shooter = 'a';      // whose throw is in the air
    this.busy = false;
    this.recorded = false;
    this.offViewport = null;
    this._bound = [];
    this._timers = new Set();
  }

  // --- listener hygiene: destroy() must leave nothing behind ---------------------------------
  on(target, type, fn, opts) {
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

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('cp-root');
    this.renderSetup();
    // A launcher bubble or a tapped notification names a match: open it straight away.
    import('./alert.js').then((A) => { const o = A.takeOpen(); if (o && !this.disposed) this.openMatch(o.id); }).catch(() => {});
  }

  // --- the setup screen ------------------------------------------------------------------------
  // A HUB screen on css/ui.css's primitives (the light/dark hub skin), like Hoops' and Skeeball's.
  // The selected option is marked by the segmented control's raised pill AND a shape for each
  // difficulty, never colour alone (Matt is red/green colourblind).
  renderSetup() {
    if (this.disposed) return;
    this.teardownEngine();
    this.unbindAll();
    this.mode = null;
    this.match = null;
    const s = this.settings;
    const seg = (role, items, cur) => `<div class="gh-seg" role="group" data-role="${role}">${items.map(([v, label, icon]) =>
      `<button type="button" class="gh-seg__item" data-v="${v}" aria-pressed="${v === cur}">${icon || ''}<span>${label}</span></button>`).join('')}</div>`;
    // HOOPS' LAYOUT (Matt, 2026-09-28: "just like connect 4 hoops"): your turns first, then
    // Multiplayer as a door, then the computer card, then Solo as a door. Solo was a card with a
    // heading, a hint, a best and a button - "too many words and it's still not clear what it is".
    const best = soloBest();
    this.root.innerHTML = `
      <div class="cp-setup">
        <h1 class="cp-title">${t('title')}</h1>
        <div class="gh-card cp-turns" hidden></div>
        <button type="button" class="gh-card cp-row" data-role="mp">
          <span class="cp-row-head">${t('multiplayer')}</span>
          <span class="cp-row-chev" aria-hidden="true">\u203A</span>
        </button>
        <div class="gh-card cp-setup-card">
          <p class="cp-card-head">${t('vsCpu')}</p>
          ${seg('diff', DIFFS.map((d) => [d, t(d), diffShapeSVG(tierOf(d))]), s.diff)}
          <p class="cp-setup-label">${t('gentlemans')} <span class="cp-setup-hint">${t('gentlemansHint')}</span></p>
          ${seg('gent', [['on', t('on')], ['off', t('off')]], s.gentlemans ? 'on' : 'off')}
          <p class="cp-setup-label">${t('reracks')}</p>
          ${seg('rr', RERACKS.map((n) => [String(n), n === 'inf' ? '\u221e' : String(n)]), String(s.reracks))}
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block cp-setup-play" data-role="play">${t('play')}</button>
        </div>
        <button type="button" class="gh-card cp-row" data-role="solo">
          <span class="cp-row-text"><span class="cp-row-head">${t('solo')}</span><span class="cp-row-sub">${t('soloHint')}</span></span>
          ${best ? `<span class="cp-row-best"><b>${best}</b><span>${t('soloBestShort')}</span></span>` : ''}
          <span class="cp-row-chev" aria-hidden="true">\u203A</span>
        </button>
      </div>`;
    const pick = (role, fn) => {
      const g = this.root.querySelector(`[data-role="${role}"]`);
      this.on(g, 'click', (e) => {
        const b = e.target.closest('.gh-seg__item');
        if (!b) return;
        for (const x of g.querySelectorAll('.gh-seg__item')) x.setAttribute('aria-pressed', String(x === b));
        fn(b.dataset.v);
        writeSettings(this.settings);                    // persist on selection, not only at start
      });
    };
    pick('diff', (v) => { this.settings.diff = v; });
    pick('gent', (v) => { this.settings.gentlemans = v === 'on'; });
    pick('rr', (v) => { this.settings.reracks = v === 'inf' ? 'inf' : Number(v); });
    this.on(this.root.querySelector('[data-role="play"]'), 'click', () => this.start('cpu'));
    this.on(this.root.querySelector('[data-role="solo"]'), 'click', () => this.start('solo'));
    this.on(this.root.querySelector('[data-role="mp"]'), 'click', () => this.openMultiplayer());
    this.fillTurns();
  }

  // --- starting a game -------------------------------------------------------------------------
  async start(mode, opts = {}) {
    this.teardownEngine();
    this.unbindAll();
    this.clearTimers();
    this.mode = mode;
    this.recorded = false;
    this.renderPlay();
    try {
      const [phys, rend, cpu] = await Promise.all([import('./physics.js'), import('./render.js'), import('./cpu.js')]);
      if (this.disposed || this.mode !== mode) return;
      const canvas = this.root.querySelector('.cp-canvas');
      this.engine = { phys, cpu, rend: new rend.Renderer(canvas, { reducedMotion: reducedMotion() }) };
      this.fit();
      this.offViewport = onViewportResize(() => this.fit());
      if (mode === 'solo') this.newRack();
      else if (mode === 'mp') this.mpBegin(opts.game);
      else this.newMatch();
      this.startLoop();
      // Read-only hook for headless drivers (skeeball's `__skTest` precedent). Never read by the game.
      try { window.__cpTest = this; } catch {}
    } catch (err) {
      // Land somewhere recoverable, never on a dead canvas (skeeball, 2026-09-01).
      console.error('[cup-pong] engine failed to load', err);
      if (!this.disposed) this.renderLoadError(mode, opts);
    }
  }

  renderLoadError(mode, opts) {
    this.teardownEngine();
    this.root.innerHTML = `<div class="cp-error"><p>${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn--primary" data-role="retry">${t('retry')}</button></div>`;
    this.on(this.root.querySelector('[data-role="retry"]'), 'click', () => this.start(mode, opts));
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="cp-play">
        <div class="cp-hud">
          <div class="cp-status" aria-live="polite">
            <span class="cp-mode"></span>
            <span class="cp-sub"></span>
          </div>
          <button type="button" class="cp-menu" aria-label="${t('menu')}">&#9776;</button>
        </div>
        <div class="cp-stage">
          <canvas class="cp-canvas"></canvas>
          <div class="cp-swipe" role="application" aria-label="${t('swipeArea')}"></div>
          <p class="cp-toast" aria-live="polite"></p>
          <p class="cp-hint">${t('swipeHint')}</p>
          <p class="cp-last" aria-hidden="true"></p>
          <div class="cp-opts"></div>
          <div class="cp-pick" hidden><p class="cp-pick-say"></p></div>
        </div>
      </div>`;
    this.bindSwipe();
    this.on(this.root.querySelector('.cp-menu'), 'click', () => this.showPause());
    this.on(this.root.querySelector('.cp-opts'), 'click', (e) => {
      const b = e.target.closest('.cp-opt');
      if (b) this.onOption(b.dataset.role);
    });
    this.on(this.root.querySelector('.cp-pick'), 'click', (e) => this.onPickTap(e));
  }

  fit() {
    const stage = this.root.querySelector('.cp-stage');
    if (!stage || !this.engine) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) { this.later(() => this.fit(), 50); return; }   // flex not settled yet
    this.engine.rend.resize(w, h);
  }

  paintHud() {
    const mode = this.root.querySelector('.cp-mode');
    const sub = this.root.querySelector('.cp-sub');
    if (!mode || !sub) return;
    if (this.mode === 'solo') {
      mode.textContent = t('solo');
      const n = this.rack.length;
      sub.textContent = (n === 1 ? t('oneCupLeft') : t('cupsLeft', { n }))
        + ' · ' + (this.throws === 1 ? t('oneThrow') : t('throws', { n: this.throws }));
      return;
    }
    const m = this.match;
    if (!m) return;
    const them = this.mp ? this.mp.themName : '';
    mode.textContent = (this.mp && this.mp.finished && !m.over) ? t('gameOver')
      : m.over ? (m.winner === 'a' ? t('youWin') : t('youLose'))
      : m.shooter === 'a' ? t('yourTurn') : (this.mp ? t('theirTurn', { name: them }) : t('cpuTurn'));
    mode.classList.toggle('is-cpu', !m.over && m.shooter === 'b');
    const bits = [this.mp ? t('cupsVs', { a: m.racks.a.length, b: m.racks.b.length, name: them })
      : t('cupsScore', { a: m.racks.a.length, b: m.racks.b.length })];
    if (m.phase === 'rebuttal') bits.push(t('rebuttal'));
    else if (m.phase === 'overtime') bits.push(t('overtime'));
    if (m.called) bits.push(t('islandCalled'));
    else if (m.phase !== 'rebuttal' && m.ball !== null) {
      const h = m.heat(m.shooter, m.ball);
      if (h >= 3) bits.push(t('ballOnFire', { n: m.ball + 1 }));
      else if (h === 2) bits.push(t('ballHeating', { n: m.ball + 1 }));
    }
    sub.textContent = bits.join(' · ');
  }

  toast(msg, ms = 1100) {
    const el = this.root.querySelector('.cp-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-on');
    void el.offsetWidth;            // restart the fade for a repeat of the same word
    el.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('is-on'), ms);
  }

  // --- solo: clear the full rack in the fewest throws --------------------------------------------
  // Stage 1's practice, now recorded (Matt, 2026-09-28). One ball a throw, no balls back, no
  // reracks, no opponent. Only a CLEARED rack is recorded; giving up part way records nothing.
  newRack() {
    this.rack = makeRack('tri10');
    this.throws = 0;
    this.recorded = false;
    this.throwState = null;
    this.busy = false;
    this.shooter = 'a';
    if (this.engine) {
      this.engine.rend.setRack('b', cupsXZ(this.rack));
      this.engine.rend.setView('shoot');
      this.engine.rend.showRestBall();
    }
    this.paintHud();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = false;
  }

  // --- a match vs the computer -----------------------------------------------------------------
  newMatch() {
    this.clearTimers();
    const first = this.settings.nextFirst;
    this.match = new Match({ first, gentlemans: this.settings.gentlemans, reracks: this.settings.reracks === 'inf' ? Infinity : this.settings.reracks });
    this.recorded = false;
    this.throwState = null;
    this.pickMode = null;
    const R = this.engine.rend;
    R.setRack('a', cupsXZ(this.match.racks.a));
    R.setRack('b', cupsXZ(this.match.racks.b));
    R.setView(first === 'a' ? 'shoot' : 'defend');
    R.hideBall();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = true;
    this.paintHud();
    this.paintOptions();
    this.toast(first === 'a' ? t('firstYou') : t('firstCpu'), 1400);
    this.busy = true;
    this.later(() => this.beginTurn(), 900);
  }

  /** The shooter's turn starts: the rebuttal notice, then a ball for whoever throws. */
  beginTurn() {
    const m = this.match;
    if (!m || m.over) return;
    const R = this.engine.rend;
    for (const e of m.startTurn()) {
      if (e.type === 'rebuttal') this.toast(e.side === 'a' ? t('rebuttalYou') : t('rebuttal'), 1600);
    }
    R.setMarks('a', null); R.setMarks('b', null);
    this.paintHud();
    R.setView(m.shooter === 'a' ? 'shoot' : 'defend');
    if (m.shooter === 'a' && m.mustPickOwed()) {
      this.askOwed();
    } else if (m.shooter === 'a') {
      this.serveMatchBall();
    } else if (this.mp) {
      this.mpWaiting();
    } else {
      R.hideBall();
      this.busy = true;
      this.paintOptions();
      this.later(() => this.cpuTurnStart(), CPU_PAUSE_MS + 300);
    }
  }

  /** The player's ball on the table, the spare beside it, the options on the left. */
  serveMatchBall() {
    const m = this.match;
    const R = this.engine.rend;
    R.showRestBall(m.spare !== null);
    R.setBallHeat(m.heat('a', m.ball), m.spare !== null ? m.heat('a', m.spare) : 0);
    this.busy = false;
    this.paintHud();
    this.paintOptions();
  }

  /** The computer takes its options (by the same rules), then throws. */
  cpuTurnStart() {
    const m = this.match;
    if (!m || m.over || m.shooter !== 'b') return;
    const C = this.engine.cpu;
    let wait = 0;
    for (const act of C.cpuOptions(m)) {
      const ev = act.type === 'gentlemans' ? m.applyGentlemans() : m.rerack(act.key);
      for (const e of ev) {
        this.engine.rend.slideRack(e.side, cupsXZ(e.to));
        this.toast(e.type === 'gentlemans' ? t('cpuGentlemans') : t('cpuRerack'), 1400);
        wait = 1300;
      }
    }
    this.later(() => this.cpuShoot(), wait);
  }

  cpuShoot() {
    const m = this.match;
    if (!m || m.over || m.shooter !== 'b' || !this.engine || m.pendingPick) return;
    const C = this.engine.cpu;
    // An island first, if it has one to call: announced, marked, then thrown at.
    const isl = C.cpuIsland(m);
    if (isl && !m.called) {
      m.callIsland(isl);
      this.engine.rend.setMarks('a', [isl], 'called');
      this.toast(t('cpuIsland'), 1300);
      this.paintHud();
      this.later(() => this.cpuShoot(), 1100);
      return;
    }
    const cups = cupsXZ(m.target());
    const th = C.cpuThrow(this.settings.diff, cups, Math.random, m.called);
    this.shooter = 'b';
    this.engine.rend.setBallHeat(m.heat('b', m.ball), 0);
    this.throwState = this.engine.phys.startThrow({ power: th.power, aim: th.aim, cups });
  }

  /** A throw has resolved: the rules decide now; the table shows it now; what comes next waits. */
  applyThrow(outcome, wait) {
    const m = this.match;
    const made = outcome && outcome.kind === 'made' ? outcome.id : null;
    const shooter = m.shooter;
    const ev = m.throwResult({ made, bounced: !!(outcome && outcome.bounced) });
    if (ev.length && shooter === 'a' && this.lastShot) {
      this.mpRecord({ k: 't', p: this.lastShot.power, a: this.lastShot.aim, m: made || '', b: outcome && outcome.bounced ? 1 : 0 });
    }
    this.showEvents(ev);
    if (m.over) { this.finish(); return; }
    this.paintHud();
    this.paintOptions();
    if (m.pendingPick) { this.later(() => this.askPick(), wait); return; }
    this.later(() => this.nextStep(ev), wait);
  }

  /** What the table and the words show for a batch of rule events. */
  showEvents(ev) {
    const m = this.match;
    const R = this.engine.rend;
    for (const e of ev) {
      if (e.type === 'made') {
        const side = e.side === 'a' ? 'b' : 'a';
        R.setMarks(side, null);
        if (e.lastCup) this.toast(t('lastCup'), 1600);              // it stands for the next ball
        else R.vanish(side, e.id);
        if (e.sameCup) this.toast(t('sameCup'), 1600);
        else if (e.island) this.toast(t('islandHit'), 1500);
      } else if (e.type === 'removed' || e.type === 'picked' || e.type === 'owedPicked') R.vanish(e.side, e.id);
      else if (e.type === 'owedCleared') { for (const id of e.ids) R.vanish(e.side, id); }
      else if (e.type === 'islandOwed') this.toast(e.side === 'a' ? t('youOwe') : t('theyOwe'), 1600);
      else if (e.type === 'ballsBack') this.toast(t('ballsBack'));
      else if (e.type === 'heatingUp') this.toast(t('heatingUp'));
      else if (e.type === 'onFire') this.toast(t('onFire'), 1400);
      else if (e.type === 'overtime') {
        this.toast(t('overtime'), 1600);
        R.setRack('a', cupsXZ(m.racks.a));
        R.setRack('b', cupsXZ(m.racks.b));
      }
    }
  }

  nextStep(ev) {
    const m = this.match;
    if (!m || m.over) return;
    if (ev.some((e) => e.type === 'turnOver')) {
      this.busy = true;
      this.later(() => this.beginTurn(), TURN_PAUSE_MS);
    } else if (m.shooter === 'a') {
      this.serveMatchBall();
    } else {
      this.later(() => this.cpuShoot(), CPU_PAUSE_MS);
    }
  }

  /** ISLAND: the defender owes a second cup. The computer picks at once; the player taps one. */
  askPick() {
    const m = this.match;
    if (!m || !m.pendingPick) return;
    if (m.pendingPick.picker === 'b') {
      const id = this.engine.cpu.cpuPick(cupsXZ(m.target()));
      this.afterPick(m.pickCup(id));
      return;
    }
    // The player is the defender: their own cups, from their end.
    this.engine.rend.setView('defend');
    this.engine.rend.setMarks('a', m.target().map((k) => k.id), 'island');
    this.startPick('defend', t('pickYours'), (id) => this.afterPick(m.pickCup(id)));
  }

  afterPick(ev) {
    this.engine.rend.setMarks('a', null);
    this.engine.rend.setMarks('b', null);
    this.showEvents(ev);
    if (this.match.over) { this.finish(); return; }
    this.paintHud();
    this.later(() => this.nextStep(ev), SETTLE_MS);
  }

  // --- CHALLENGES: a match played turn by turn with someone else (2026-09-28) --------------------
  // cup-pong/js/mp.js keeps the match as a LOG; this phone is always side 'a' locally (its own red
  // cups near the camera), whichever side it holds in the stored match. What happens here:
  //   - opening a match REPLAYS the other person's latest run of throws from their launch vectors,
  //     with the RECORDED outcome deciding each one (brief 5b);
  //   - every action of yours is appended to the log as it happens (mpRecord -> mpFlush), so a
  //     closed app loses nothing and cannot take a throw back;
  //   - while it is their turn the match is WATCHED, so their throws arrive while you look at it.
  async loadMP() { if (!this.MP) this.MP = await import('./mp.js'); return this.MP; }

  async mpBegin(game) {
    const MP = await this.loadMP();
    if (this.disposed || !this.engine) return;
    const side = MP.sideOf(game, MP.myCode());
    if (!side) { this.renderSetup(); return; }
    const them = MP.themOf(game, MP.myCode());
    const other = side === 'a' ? 'b' : 'a';
    let from = game.log.length ? MP.lastRunStart(game, other) : 0;
    const shown = MP.readShown(game.id);
    if (shown > from) from = Math.min(shown, game.log.length);
    this.mp = { id: game.id, side, game, themName: them.name || '?', themEmoji: them.emoji || '🙂', them,
      base: game.log.length, applied: from, pending: [], sending: false, stop: null, finished: false };
    this.match = MP.buildLocal(game, side, from);
    this.recorded = false;
    this.throwState = null;
    this.pickMode = null;
    const R = this.engine.rend;
    R.setRack('a', cupsXZ(this.match.racks.a));
    R.setRack('b', cupsXZ(this.match.racks.b));
    R.hideBall();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = true;
    this.busy = true;
    this.paintHud();
    this.paintOptions();
    const stop = await MP.watchGame(game.id, (g) => this.mpOnGame(g));
    if (!this.mp || this.mp.id !== game.id) { try { stop(); } catch {} return; }
    this.mp.stop = stop;
    this.later(() => this.mpCatchUp(), 500);
  }

  /** Show whatever the board has not shown yet, then play on (or wait). */
  mpCatchUp() {
    const mp = this.mp;
    if (!mp || this.replaying || !this.engine) return;
    const g = mp.game;
    if (mp.applied < g.log.length) { this.replayNext(); return; }
    this.MP.markShown(mp.id, g.log.length);
    this.MP.markSeen(mp.id, g.updated);
    if (this.match.over) { this.finish(); return; }
    if (g.over && g.over.why === 'resign') { this.mpFinish(g.over.winner === mp.side, true); return; }
    this.mpResume();
  }

  /** Your turn picks up where it stands (mid-turn on a reopened match, or a fresh turn). */
  mpResume() {
    const m = this.match;
    const R = this.engine.rend;
    this.waiting = false;
    if (m.shooter !== 'a') { this.mpWaiting(); return; }
    if (m.queue.length) {
      R.setView('shoot');
      if (m.mustPickOwed()) this.askOwed(); else this.serveMatchBall();
    } else this.beginTurn();
  }

  mpWaiting() {
    const R = this.engine.rend;
    this.waiting = true;
    this.busy = true;
    R.hideBall();
    R.setView('defend');
    this.paintHud();
    this.paintOptions();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) { hint.textContent = t('sentWait', { name: this.mp.themName }); hint.hidden = false; }
  }

  /** One entry of the log onto the board: the other person's throws fly, yours land at once. */
  replayNext() {
    const mp = this.mp;
    const e = this.MP.toLocal(mp.game.log[mp.applied], mp.side);
    const m = this.match;
    const R = this.engine.rend;
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = true;
    if (e.by === 'a') {                 // this player's own action, from another phone or a reopen
      const ev = this.MP.applyEntry(m, e) || [];
      mp.applied++;
      this.showEventsQuiet(ev);
      this.mpCatchUp();
      return;
    }
    this.replaying = true;
    this.waiting = false;
    R.setView('defend');
    if (e.k === 't') {
      if (!m.queue.length) m.startTurn();
      const cups = cupsXZ(m.target());
      this.pendingReplay = e;
      this.shooter = 'b';
      R.setBallHeat(m.heat('b', m.ball), 0);
      this.throwState = this.engine.phys.startThrow({ power: e.p, aim: e.a, cups });
      return;
    }
    const ev = this.MP.applyEntry(m, e) || [];
    mp.applied++;
    for (const x of ev) {
      if (x.type === 'gentlemans' || x.type === 'rerack') R.slideRack(x.side, cupsXZ(x.to));
    }
    if (e.k === 'g') this.toast(t('theyGentlemans', { name: mp.themName }), 1300);
    else if (e.k === 'r') this.toast(t('theyRerack', { name: mp.themName }), 1300);
    else if (e.k === 'i') { R.setMarks('a', [e.id], 'called'); this.toast(t('theyIsland', { name: mp.themName }), 1300); }
    else this.showEvents(ev);
    this.paintHud();
    this.later(() => { this.replaying = false; this.mpCatchUp(); }, 1100);
  }

  /** A replayed throw has landed: the RECORDED outcome decides it, whatever the flight did. */
  replayThrowDone() {
    const e = this.pendingReplay;
    this.pendingReplay = null;
    if (!e || !this.mp) { this.replaying = false; return; }
    const ev = this.MP.applyEntry(this.match, e) || [];
    this.mp.applied++;
    this.engine.rend.hideBall();
    this.showEvents(ev);
    this.paintHud();
    this.replaying = false;
    if (this.match.over) { this.finish(); return; }
    this.later(() => this.mpCatchUp(), ev.some((x) => x.type === 'turnOver') ? TURN_PAUSE_MS : 250);
  }

  /** Events applied without a flight (this player's own actions on reopen): the table only. */
  showEventsQuiet(ev) {
    const R = this.engine.rend;
    for (const e of ev) {
      if (e.type === 'gentlemans' || e.type === 'rerack') R.setRack(e.side, cupsXZ(e.to));
    }
    R.setRack('a', cupsXZ(this.match.racks.a));
    R.setRack('b', cupsXZ(this.match.racks.b));
    this.paintHud();
  }

  /** The watched match changed: new throws from them are shown, our own echoes are ignored. */
  mpOnGame(g) {
    const mp = this.mp;
    if (!mp || g.id !== mp.id || g.log.length < mp.game.log.length) return;
    mp.game = g;
    if (g.over && g.over.why === 'resign' && !mp.finished && mp.applied >= g.log.length) {
      this.mpFinish(g.over.winner === mp.side, true);
      return;
    }
    if (mp.applied < g.log.length && this.waiting && !this.replaying) this.mpCatchUp();
  }

  /** One of this player's actions, into the log (local frame 'a' -> the stored side). */
  mpRecord(e) {
    const mp = this.mp;
    if (!mp) return;
    mp.pending.push(this.MP.toStored({ ...e, by: 'a' }, mp.side));
    mp.applied++;
    this.mpFlush();
  }

  async mpFlush() {
    const mp = this.mp;
    const MP = this.MP;
    if (!mp || mp.sending || !mp.pending.length) return;
    mp.sending = true;
    const list = mp.pending.slice();
    const base = mp.base;
    MP.savePending(mp.id, base, mp.pending);          // kept on the phone until the server has it
    const res = await MP.appendLog(mp.id, base, list);
    if (this.mp !== mp) return;
    mp.sending = false;
    if (res.ok) {
      mp.pending.splice(0, list.length);
      mp.base = base + list.length;
      mp.game = res.game;
      MP.savePending(mp.id, mp.base, mp.pending);
      MP.markShown(mp.id, mp.base);
      if (mp.pending.length) this.mpFlush();
      return;
    }
    if (res.retryable) {
      this.toast(t('notSent'), 1600);
      this.later(() => this.mpFlush(), 4000);
    } else {
      console.error('[cup-pong] a throw could not be sent:', res.reason);
      this.toast(res.reason === 'denied' ? t('mpDenied') : t('sendFailed'), 2600);
    }
  }

  /** A challenge's island: the defender gives up a cup of its own before throwing. */
  askOwed() {
    const m = this.match;
    const R = this.engine.rend;
    R.hideBall();
    R.setView('defend');
    R.setMarks('a', m.racks.a.map((k) => k.id), 'island');
    this.startPick('defend', t('pickOwed'), (id) => {
      const ev = m.pickOwed(id);
      if (!ev.length) return false;
      this.mpRecord({ k: 'o', id });
      this.showEvents(ev);
      if (m.mustPickOwed()) { R.setMarks('a', m.racks.a.map((k) => k.id), 'island'); return false; }
      this.endPick();
      R.setMarks('a', null);
      this.later(() => { R.setView('shoot'); this.serveMatchBall(); }, 700);
      return false;
    });
  }

  mpFinish(won, resigned = false) {
    const mp = this.mp;
    if (!mp || mp.finished) return;
    mp.finished = true;
    this.busy = true;
    this.waiting = false;
    const MP = this.MP;
    MP.countResult(mp.id, won);                        // once per phone, whoever ended it
    MP.markResultSeen(mp.id);
    this.paintHud();
    this.paintOptions();
    this.later(() => this.showMpOver(won, resigned), 700);
  }

  showMpOver(won, resigned) {
    const mp = this.mp;
    if (!mp) return;
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    const line = resigned ? (won ? t('theyResigned', { name: mp.themName }) : t('youResigned'))
      : t('cupsVs', { a: this.match.racks.a.length, b: this.match.racks.b.length, name: mp.themName });
    el.innerHTML = `
      <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${won ? t('youWin') : t('youLose')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <p class="cp-card-kicker">${t('gameOver')}</p>
        <h2 class="cp-card-title">${won ? t('youWin') : t('youLose')}</h2>
        <p class="cp-card-line">${mp.themEmoji} ${escapeHTML(line)}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('challengeAgain')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="mphome">${t('backMp')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const them = mp.them;
    const rules = mp.game.rules;
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="mphome"]'), 'click', () => { el.remove(); this.openMultiplayer(); });
    this.on(el.querySelector('[data-role="again"]'), 'click', () => { el.remove(); this.sendChallenge(them, rules); });
  }

  mpResign() {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${t('quitQ')}">
        <h2 class="cp-card-title">${t('quitQ')}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${t('quitMatch')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="no">${t('cancel')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('[data-role="no"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="yes"]'), 'click', async () => {
      const mp = this.mp;
      if (!mp) { el.remove(); return; }
      const res = await this.MP.resignGame(mp.id);
      el.remove();
      if (!res.ok) { this.toast(res.reason === 'denied' ? t('mpDenied') : t('sendFailed'), 2400); return; }
      this.MP.countResult(mp.id, false);
      this.MP.markResultSeen(mp.id);
      this.openMultiplayer();
    });
  }

  // --- the doors to it: the setup screen's turns card and the Multiplayer screen ----------------
  async openMultiplayer() {
    this.teardownEngine();
    this.unbindAll();
    this.clearTimers();
    this.mode = null;
    this.match = null;
    const [MP, UI] = await Promise.all([this.loadMP(), import('./mp-ui.js')]);
    if (this.disposed) return;
    UI.home(this, MP);
  }

  /** Open one stored match. Throws still waiting on this phone go first, so none is lost. */
  async openMatch(id) {
    const MP = await this.loadMP();
    if (MP.pendingFor(id)) await MP.drainOutbox(id);
    const game = await MP.readGame(id);
    if (this.disposed) return;
    if (!game) { this.toast(t('mpNotFound'), 2000); this.openMultiplayer(); return; }
    this.start('mp', { game });
  }

  /** A new challenge: created now, delivered when your first turn is over. */
  async sendChallenge(them, rules) {
    const MP = await this.loadMP();
    const res = await MP.createGame({ them, rules });
    if (this.disposed) return;
    if (!res.ok) return res;
    this.start('mp', { game: res.game });
    return res;
  }

  /** YOUR TURN, on the setup screen (Hoops' 2026-09-24 card): every match waiting on you. */
  async fillTurns() {
    let MP;
    try {
      const { loadProfile } = await import('../../js/profile-store.js');
      const p = loadProfile();
      if (!p || !p.playerId) return;
      MP = await this.loadMP();
    } catch { return; }
    const rows = await MP.readMyGames();
    if (this.disposed || this.mode !== null) return;
    try { MP.recordFinished(rows); } catch (err) { console.warn('[cup-pong] recordFinished', err); }
    const box = this.root.querySelector('.cp-turns');
    const mine = rows.filter((r) => !r.over && r.yourTurn);
    if (box && mine.length) {
      box.innerHTML = `<p class="cp-card-head">${t('yourTurn')}</p>` + mine.slice(0, 4).map((r) => `
        <button type="button" class="cp-trow" data-id="${r.id}">
          <span class="cp-trow-face" aria-hidden="true">${escapeHTML(r.emoji)}</span>
          <span class="cp-trow-name">${escapeHTML(r.name)}${r.rebuttal ? `<small>${t('rebuttal')}</small>` : ''}</span>
          <span class="cp-trow-go">${t('play')}</span>
        </button>`).join('')
        + (mine.length > 4 ? `<button type="button" class="cp-trow-more" data-role="more">${t('moreN', { n: mine.length - 4 })}</button>` : '');
      box.hidden = false;
      this.on(box, 'click', (e) => {
        const b = e.target.closest('.cp-trow');
        if (b) this.openMatch(b.dataset.id);
        else if (e.target.closest('[data-role="more"]')) this.openMultiplayer();
      });
    }
    import('./mp-ui.js').then((UI) => { if (!this.disposed && this.mode === null) UI.showUnseen(this, MP, rows); }).catch(() => {});
  }

  // --- the shooter's options: buttons on the left, only while on offer -----------------------
  paintOptions() {
    const box = this.root.querySelector('.cp-opts');
    if (!box) return;
    const m = this.match;
    const mine = (this.mode === 'cpu' || this.mode === 'mp') && m && !m.over && m.shooter === 'a' && !this.busy && !this.pickMode && !m.pendingPick && !m.mustPickOwed();
    const btn = (role, label) => `<button type="button" class="cp-opt" data-role="${role}">${label}</button>`;
    let html = '';
    if (mine && m.canGentlemans()) html += btn('gent', t('gentlemansQ'));
    if (mine && m.canRerack()) {
      const n = m.reracksLeft.a;
      html += btn('rerack', t('rerackQ', { n: Number.isFinite(n) ? n : '∞' }));
    }
    if (mine && m.canIsland()) html += btn('island', t('islandQ'));
    box.innerHTML = html;
  }

  onOption(role) {
    const m = this.match;
    if (!m || this.busy || m.shooter !== 'a') return;
    const R = this.engine.rend;
    if (role === 'gent') {
      const ev = m.applyGentlemans();
      if (ev.length) this.mpRecord({ k: 'g' });
      for (const e of ev) R.slideRack(e.side, cupsXZ(e.to));
      this.paintOptions();
    } else if (role === 'rerack') {
      this.showRerack();
    } else if (role === 'island') {
      const isl = m.islands();
      if (isl.length === 1) this.callIsland(isl[0]);
      else {
        // "If there are multiple available islands, you must call the specific one."
        R.setMarks('b', isl, 'island');
        this.startPick('shoot', t('pickIsland'), (id) => {
          if (!isl.includes(id)) return false;
          this.callIsland(id);
          return true;
        });
      }
    }
  }

  callIsland(id) {
    if (this.match.callIsland(id).length) this.mpRecord({ k: 'i', id });
    this.engine.rend.setMarks('b', [id], 'called');
    this.toast(t('islandCalled'), 1200);
    this.paintHud();
    this.paintOptions();
  }

  /** A full-stage tap layer: tap a cup of the given end, `fn(id)` returns false to keep waiting. */
  startPick(view, prompt, fn) {
    const side = view === 'defend' ? 'a' : 'b';
    this.pickMode = { side, fn };
    this.busy = true;
    const layer = this.root.querySelector('.cp-pick');
    const say = this.root.querySelector('.cp-pick-say');
    if (say) say.textContent = prompt;
    if (layer) layer.hidden = false;
    this.paintOptions();
  }

  endPick() {
    this.pickMode = null;
    const layer = this.root.querySelector('.cp-pick');
    if (layer) layer.hidden = true;
  }

  onPickTap(e) {
    const p = this.pickMode;
    if (!p || !this.engine) return;
    const cv = this.root.querySelector('.cp-canvas');
    const box = cv.getBoundingClientRect();
    const id = this.engine.rend.cupAt(p.side, e.clientX - box.left, e.clientY - box.top);
    if (!id) return;
    const was = this.match.pendingPick;
    if (p.fn(id) === false) return;
    this.endPick();
    // Calling an island hands the ball back; a defender's pick carries on from afterPick.
    if (!was) { this.busy = false; this.paintOptions(); }
  }

  showRerack() {
    const m = this.match;
    const rack = m.target();
    const presets = presetsFor(rack.length);
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card cp-rerack" role="dialog" aria-modal="true" aria-label="${t('rerack')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${t('rerack')}</h2>
        <div class="cp-presets">${presets.map((p) => `
          <button type="button" class="cp-preset" data-key="${p.key}">${presetSVG(p.spots)}<span>${t('rk_' + p.key)}</span></button>`).join('')}
          <button type="button" class="cp-preset is-custom" data-role="custom">${CUSTOM_ICON}<span>${t('rk_custom')}</span></button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="custom"]'), 'click', () => { el.remove(); this.showCustomRack(); });
    for (const b of el.querySelectorAll('.cp-preset[data-key]')) {
      this.on(b, 'click', () => {
        el.remove();
        this.applyRerack(m.rerack(b.dataset.key), { k: 'r', key: b.dataset.key });
      });
    }
  }

  /** A rerack's events: record it (a challenge), slide the cups, repaint the options. */
  applyRerack(ev, entry) {
    if (ev.length) this.mpRecord(entry);
    for (const e of ev) this.engine.rend.slideRack(e.side, cupsXZ(e.to));
    this.engine.rend.setMarks('b', null);
    this.paintOptions();
  }

  /**
   * MAKE YOUR OWN (brief 4c). The rack drawn top-down on its hex grid, shooter at the bottom: drag
   * a cup to any empty spot, or tap a cup and then a spot. Cups snap to cells, two can never share
   * one, and the grid IS the rack area, so nothing drawn can be illegal. Cups need not touch. Done
   * spends the rerack; Cancel goes back to the presets with it unspent.
   */
  showCustomRack() {
    const m = this.match;
    const rack = m.target();
    // Start from where the cups stand now, each on its nearest free cell (a line preset sits on
    // exact spots, off the grid).
    const taken = new Set();
    const pos = rack.map((k) => {
      const p = cellXZ(k);
      let best = -1, bd = Infinity;
      AREA_CELLS.forEach((cell, i) => {
        if (taken.has(i)) return;
        const q = cellXZ(cell), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      taken.add(best);
      return best;
    });
    const start = pos.slice();
    const pts = AREA_CELLS.map((c) => cellXZ(c));
    const R = CUP.topR, pad = 0.012;
    const x0 = Math.min(...pts.map((p) => p.x)) - R - pad, x1 = Math.max(...pts.map((p) => p.x)) + R + pad;
    const z0 = Math.min(...pts.map((p) => p.z)) - R - pad, z1 = Math.max(...pts.map((p) => p.z)) + R + pad;
    const W = 1000, sc = W / (x1 - x0), H = (z1 - z0) * sc;
    const X = (i) => ((pts[i].x - x0) * sc).toFixed(1), Y = (i) => ((pts[i].z - z0) * sc).toFixed(1);
    const rr = (R * sc * 0.96).toFixed(1);
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card cp-rerack cp-custom" role="dialog" aria-modal="true" aria-label="${t('rk_custom')}">
        <h2 class="cp-card-title">${t('rk_custom')}</h2>
        <p class="cp-custom-say">${t('rkDrag')}</p>
        <svg class="cp-grid" viewBox="0 0 ${W} ${H.toFixed(1)}" role="img" aria-label="${t('rk_custom')}">
          ${AREA_CELLS.map((_, i) => `<circle class="cp-spot" data-cell="${i}" cx="${X(i)}" cy="${Y(i)}" r="${rr}"/>`).join('')}
          ${pos.map((ci, k) => `<g class="cp-cup" data-cup="${k}" transform="translate(${X(ci)} ${Y(ci)})"><circle r="${rr}"/><circle class="cp-cup-in" r="${(R * sc * 0.62).toFixed(1)}"/></g>`).join('')}
        </svg>
        <div class="cp-custom-btns">
          <button type="button" class="gh-btn" data-role="cancel">${t('cancel')}</button>
          <button type="button" class="gh-btn gh-btn--primary" data-role="done" disabled>${t('rkDone')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const svg = el.querySelector('.cp-grid');
    const cups = [...el.querySelectorAll('.cp-cup')];
    const done = el.querySelector('[data-role="done"]');
    let sel = -1, drag = null;
    const toSvg = (e) => {
      const b = svg.getBoundingClientRect();
      return { x: (e.clientX - b.left) / b.width * W, y: (e.clientY - b.top) / b.height * H };
    };
    const place = (k, x, y) => cups[k].setAttribute('transform', `translate(${(+x).toFixed(1)} ${(+y).toFixed(1)})`);
    const paint = () => {
      pos.forEach((ci, k) => { place(k, X(ci), Y(ci)); cups[k].classList.toggle('is-sel', k === sel); });
      done.disabled = pos.every((ci, k) => ci === start[k]);
    };
    // The free cell nearest a point, or the cup's own cell (dropping it back where it was).
    const nearest = (k, x, y) => {
      let best = pos[k], bd = Infinity;
      AREA_CELLS.forEach((_, i) => {
        if (i !== pos[k] && pos.includes(i)) return;
        const d = (X(i) - x) ** 2 + (Y(i) - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };
    this.on(svg, 'pointerdown', (e) => {
      const g = e.target.closest && e.target.closest('.cp-cup');
      const p = toSvg(e);
      if (g) {
        const k = +g.dataset.cup;
        drag = { k, id: e.pointerId, x: p.x, y: p.y, moved: false };
        try { svg.setPointerCapture(e.pointerId); } catch { /* still works without */ }
        g.classList.add('is-drag');
        e.preventDefault();
        return;
      }
      const s = e.target.closest && e.target.closest('.cp-spot');
      if (s && sel >= 0) {
        const i = +s.dataset.cell;
        if (!pos.includes(i)) pos[sel] = i;
        sel = -1;
        paint();
      }
    });
    this.on(svg, 'pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = toSvg(e);
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < R * sc * 0.25) return;
      drag.moved = true;
      place(drag.k, p.x, p.y);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { k, moved } = drag;
      cups[k].classList.remove('is-drag');
      drag = null;
      if (moved) { const p = toSvg(e); pos[k] = nearest(k, p.x, p.y); sel = -1; }
      else sel = sel === k ? -1 : k;              // a tap picks it up (or puts it back down)
      paint();
    };
    this.on(svg, 'pointerup', end);
    this.on(svg, 'pointercancel', (e) => { if (drag && e.pointerId === drag.id) { cups[drag.k].classList.remove('is-drag'); drag = null; paint(); } });
    this.on(el.querySelector('[data-role="cancel"]'), 'click', () => { el.remove(); this.showRerack(); });
    this.on(done, 'click', () => {
      const cells = pos.map((i) => ({ c: AREA_CELLS[i].c, r: AREA_CELLS[i].r }));
      el.remove();
      this.applyRerack(m.rerackCustom(cells), { k: 'r', key: 'custom', cells });
    });
  }

  finish() {
    const m = this.match;
    const won = m.winner === 'a';
    if (this.mp) { this.mpFinish(won); return; }
    if (!this.recorded) {
      this.recorded = true;
      // ONCE per match: every write in the shared store is additive, so a second call inflates.
      try { recordResult('cuppong', this.settings.diff, won); } catch (err) { console.error('[cup-pong] record failed', err); }
      this.settings.nextFirst = this.settings.nextFirst === 'a' ? 'b' : 'a';
      writeSettings(this.settings);
    }
    this.busy = true;
    this.paintHud();
    this.later(() => this.showGameOver(won), 700);
  }

  showGameOver(won) {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${won ? t('youWin') : t('youLose')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${won ? t('youWin') : t('youLose')}</h2>
        <p class="cp-card-line">${t('cupsScore', { a: this.match.racks.a.length, b: this.match.racks.b.length })}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('playAgain')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="setup">${t('backSetup')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="again"]'), 'click', () => { el.remove(); this.newMatch(); });
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  // --- input -----------------------------------------------------------------------------------
  // THE FLICK IS SKEEBALL'S, NOT A NEW ONE: skeeball/js/swipe.js turns a gesture into a speed
  // (screen-heights per second, clocked with e.timeStamp - never performance.now(), which
  // collapses a strong swipe into a dribble on a busy phone) and a power, and its two ends were
  // MEASURED from a real hand. Only the mapping from power to a throw is this game's (geom.js).
  bindSwipe() {
    const pad = this.root.querySelector('.cp-swipe');
    if (!pad) return;
    let samples = null;
    let touchId = null;
    const pt = (e) => {
      if (e.changedTouches) {
        for (const tt of e.changedTouches) if (tt.identifier === touchId) return tt;
        return null;
      }
      return e;
    };
    const start = (e) => {
      if (this.busy || !this.engine) return;
      if (e.changedTouches) {
        if (touchId !== null) return;
        touchId = e.changedTouches[0].identifier;
      }
      const p = pt(e);
      samples = [{ x: p.clientX, y: p.clientY, t: e.timeStamp }];
    };
    const move = (e) => {
      if (!samples) return;
      const p = pt(e);
      if (!p) return;
      samples.push({ x: p.clientX, y: p.clientY, t: e.timeStamp });
      // Bound to the game's own pad, never to document (a non-passive touchmove on document
      // turns off compositor scrolling for the whole page while the game is mounted).
      if (e.cancelable) e.preventDefault();
    };
    const end = (e) => {
      if (!samples) return;
      const p = pt(e);
      if (e.changedTouches && !p) return;
      if (p) samples.push({ x: p.clientX, y: p.clientY, t: e.timeStamp });
      const list = samples;
      samples = null; touchId = null;
      if (list.length < 2) return;
      const first = list[0], last = list[list.length - 1];
      if (first.y - last.y < MIN_UP_PX) return;             // a tap or a sideways smudge
      const perH = swipeSpeed(list, Math.max(320, window.innerHeight));
      if (perH === null) return;
      const power = powerOf(perH);
      this.shoot(power, this.aimFromSwipe(first, last), { perH });
    };
    const cancel = () => { samples = null; touchId = null; };
    this.on(pad, 'touchstart', start, { passive: true });
    this.on(pad, 'touchmove', move, { passive: false });
    this.on(pad, 'touchend', end);
    this.on(pad, 'touchcancel', cancel);
    this.on(pad, 'mousedown', start);
    this.on(pad, 'mousemove', move);
    this.on(pad, 'mouseup', end);
    this.on(pad, 'mouseleave', cancel);
  }

  /**
   * AIM FOLLOWS YOUR FINGER. The flick's direction ON SCREEN is carried up from the waiting ball to
   * the rack's row on screen, and that screen point is unprojected onto the table: the heading is
   * the line from the ball to it. So a flick that points at a cup sends the ball at that cup, on any
   * phone, whatever the camera does.
   */
  aimFromSwipe(first, last) {
    const R = this.engine && this.engine.rend;
    const dx = last.x - first.x, dy = last.y - first.y;
    if (!R || dy >= 0) return 0;
    const ball = R.project(0, THROW.y0, THROW.z0);
    const row = R.project(0, CUP.h, RACK_MID_Z);
    const k = (row.y - ball.y) / dy;                  // how far along the flick the rack row is
    const hit = R.unproject(ball.x + dx * k, row.y, CUP.h);
    if (!hit) return 0;
    return Math.atan2(hit.x - 0, THROW.z0 - hit.z);
  }

  /** The player's throw. */
  shoot(power, aim, info = {}) {
    if (this.busy || !this.engine) return;
    let cups;
    if (this.mode === 'solo') {
      if (!this.rack.length) return;
      cups = cupsXZ(this.rack);
      this.throws++;
    } else {
      const m = this.match;
      if (!m || m.over || m.shooter !== 'a') return;
      cups = cupsXZ(m.target());
    }
    this.busy = true;
    this.shooter = 'a';
    this.lastShot = { power, aim, ...info };
    this.paintOptions();                 // the options are for before a throw
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = true;
    const last = this.root.querySelector('.cp-last');
    if (last) {
      last.textContent = t('lastThrow', {
        p: power.toFixed(2),
        a: (aim * 180 / Math.PI >= 0 ? '+' : '') + (aim * 180 / Math.PI).toFixed(1) + '°',
      });
    }
    // The greyed spare stays where it is while this ball flies (it is the NEXT throw).
    this.throwState = this.engine.phys.startThrow({ power, aim, cups });
    this.paintHud();
  }

  // --- the loop --------------------------------------------------------------------------------
  startLoop() {
    // Idempotent, and THE ONLY way the loop starts: an orphaned rAF chain goes on stepping physics
    // for the life of the page (skeeball, 2026-08-26).
    if (this.raf) return;
    let prev = performance.now();
    const frame = (now) => {
      if (this.disposed) { this.raf = 0; return; }
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stopLoop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  tick(dt) {
    const E = this.engine;
    if (!E) return;
    const st = this.throwState;
    if (st && !st.done) {
      E.phys.step(st, dt);
      for (const ev of E.phys.takeEvents(st)) this.onEvent(ev, st);
      E.rend.render(st.ball, dt, this.shooter);
      if (st.done) this.throwState = { done: true, ball: st.ball, outcome: st.outcome };
      return;
    }
    E.rend.render(null, dt, this.shooter);
  }

  onEvent(ev) {
    const E = this.engine;
    if (ev.type === 'made') {
      this.later(() => E.rend.hideBall(), 60);
      if (this.mode === 'solo') {
        E.rend.vanish('b', ev.id);
        this.rack = this.rack.filter((k) => k.id !== ev.id);
        this.paintHud();
      }
    } else if (ev.type === 'done') {
      const o = ev.outcome;
      const wait = o.kind === 'made' ? SETTLE_MS + 200 : SETTLE_MS;
      if (this.replaying) { this.throwState = null; this.later(() => this.replayThrowDone(), wait); return; }
      if (this.mode === 'solo') this.later(() => this.serve(), wait);
      else { this.throwState = { done: true, ball: this.throwState && this.throwState.ball, outcome: o }; this.applyThrow(o, wait); }
    }
  }

  serve() {
    this.throwState = null;
    if (!this.rack.length) { this.showCleared(); return; }
    this.engine.rend.showRestBall();
    this.busy = false;
  }

  showCleared() {
    const before = soloBest();
    if (!this.recorded) {
      this.recorded = true;
      try { recordCupPongSolo(this.throws); } catch (err) { console.error('[cup-pong] solo result not recorded', err); }
    }
    const best = soloBest();
    // "New best" only when this rack actually set it (a first clear counts); otherwise the best.
    const line2 = best && best === this.throws && (!before || this.throws < before)
      ? t('soloNewBest') : (best ? t('soloBest', { n: best }) : '');
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${t('cleared')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${t('cleared')}</h2>
        <p class="cp-card-line">${t('clearedIn', { n: this.throws })}</p>
        ${line2 ? `<p class="cp-card-line cp-card-best">${line2}</p>` : ''}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('again')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="setup">${t('backSetup')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const go = () => { el.remove(); this.newRack(); };
    this.on(el.querySelector('[data-role="close"]'), 'click', go);
    this.on(el.querySelector('[data-role="again"]'), 'click', go);
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  showPause() {
    if (this.root.querySelector('.cp-pause')) return;
    if (this.match && this.match.over) return;          // the game-over card carries its own buttons
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-pause" role="dialog" aria-modal="true" aria-label="${t('paused')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${t('paused')}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>
          ${this.mp ? `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="mphome">${t('backMp')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="resign">${t('quitMatch')}</button>`
    : `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${this.mode === 'solo' ? t('newRack') : t('newGame')}</button>`}
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="setup">${t('backSetup')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    // The sheet really pauses: a ball in the air freezes and carries on after (skeeball's lesson).
    // Timers are not paused, so a computer throw due during the pause simply waits for its turn:
    // it cannot fire while the loop is stopped because it only starts a throw the loop then steps.
    this.stopLoop();
    const close = () => { el.remove(); if (!this.disposed) this.startLoop(); };
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    // A new game abandons this one, and nothing is recorded until a match ENDS: a restart loses a
    // board and no history (THE LAW rule 2).
    if (this.mp) {
      this.on(el.querySelector('[data-role="mphome"]'), 'click', () => { el.remove(); this.openMultiplayer(); });
      this.on(el.querySelector('[data-role="resign"]'), 'click', () => { el.remove(); this.mpResign(); });
    } else this.on(el.querySelector('[data-role="new"]'), 'click', () => {
      el.remove();
      this.clearTimers();
      this.throwState = null;
      if (this.mode === 'solo') this.newRack(); else this.newMatch();
      if (!this.disposed) this.startLoop();
    });
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  teardownEngine() {
    this.stopLoop();
    this.clearTimers();
    if (this.mp && this.mp.stop) { try { this.mp.stop(); } catch {} }
    this.mp = null;
    this.replaying = false;
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    if (this.engine && this.engine.rend) {
      const r = this.engine.rend;
      try { r.dispose(); } catch {}
      // dispose() leaves the WebGL context alive; only forceContextLoss() hands it back, and a
      // browser holds ~16 for the whole page (skeeball, 2026-08-26).
      try { r.renderer && r.renderer.forceContextLoss(); } catch {}
      try { r.renderer && r.renderer.dispose(); } catch {}
    }
    this.engine = null;
    this.throwState = null;
    this.busy = false;
  }

  destroy() {
    this.disposed = true;
    try { if (window.__cpTest === this) delete window.__cpTest; } catch {}
    clearTimeout(this._toastT);
    this.teardownEngine();
    this.unbindAll();
    this.root.classList.remove('cp-root');
    this.root.innerHTML = '';
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch {} }
  instance = new CupPong(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE "NO MID-GAME RESUME" MEANING of the contract (Hoops', Ball Run's class): a match vs the
 *  computer, or a solo rack, is not persisted, so leaving one that has started really does abandon
 *  it and the hub should say so. A challenge (stage 5) will live in Firebase, so leaving one will
 *  lose nothing and this must answer false for it. */
export function isInProgress() {
  if (!instance) return false;
  if (instance.mode === 'solo') return instance.throws > 0 && instance.rack.length > 0;
  const m = instance.mode === 'cpu' ? instance.match : null;
  return !!(m && !m.over && m.throwsTaken > 0);
}

export default { init, destroy, isInProgress };
