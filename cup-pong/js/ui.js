// cup-pong/js/ui.js - CUP PONG: the setup screen, the flick, the match flow, the module contract.
//
// THE LAW applies here. Nothing in this folder stores anything earned: `gamehub.cuppong.v1` holds
// preferences only (difficulty, Gentleman's, who opens next). A finished match vs the computer goes
// to the shared recorder, `recordResult('cuppong', difficulty, won)`, exactly once. A match is not
// persisted - see isInProgress() for which meaning of the contract that is.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { recordResult } from '../../js/game-stats.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { THROW, CUP, RACK_Z0, ROW_H } from './geom.js';
import { makeRack, cupsXZ } from './rack.js';
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

let instance = null;

const readSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      diff: DIFFS.includes(raw.diff) ? raw.diff : 'medium',
      gentlemans: raw.gentlemans !== false,          // default On (brief 4a)
      // Turn-based games alternate who opens (docs/BUILDING-A-GAME.md, setup defaults).
      nextFirst: raw.nextFirst === 'b' ? 'b' : 'a',
    };
  } catch { return { diff: 'medium', gentlemans: true, nextFirst: 'a' }; }
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
    this.mode = null;        // 'practice' | 'cpu'
    this.match = null;       // Match, in 'cpu' mode
    this.rack = [];          // practice: the cups still standing
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
    this.root.innerHTML = `
      <div class="cp-setup">
        <h1 class="cp-title">${t('title')}</h1>
        <div class="gh-card cp-setup-card">
          <p class="cp-setup-label">${t('vsCpu')}</p>
          ${seg('diff', DIFFS.map((d) => [d, t(d), diffShapeSVG(tierOf(d))]), s.diff)}
          <p class="cp-setup-label">${t('gentlemans')} <span class="cp-setup-hint">${t('gentlemansHint')}</span></p>
          ${seg('gent', [['on', t('on')], ['off', t('off')]], s.gentlemans ? 'on' : 'off')}
        </div>
        <button type="button" class="gh-btn gh-btn--primary cp-setup-play" data-role="play">${t('play')}</button>
        <button type="button" class="gh-btn gh-btn--ghost cp-setup-practice" data-role="practice">${t('practiceBtn')}</button>
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
    this.on(this.root.querySelector('[data-role="play"]'), 'click', () => this.start('cpu'));
    this.on(this.root.querySelector('[data-role="practice"]'), 'click', () => this.start('practice'));
  }

  // --- starting a game -------------------------------------------------------------------------
  async start(mode) {
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
      if (mode === 'practice') this.newRack();
      else this.newMatch();
      this.startLoop();
      // Read-only hook for headless drivers (skeeball's `__skTest` precedent). Never read by the game.
      try { window.__cpTest = this; } catch {}
    } catch (err) {
      // Land somewhere recoverable, never on a dead canvas (skeeball, 2026-09-01).
      console.error('[cup-pong] engine failed to load', err);
      if (!this.disposed) this.renderLoadError(mode);
    }
  }

  renderLoadError(mode) {
    this.teardownEngine();
    this.root.innerHTML = `<div class="cp-error"><p>${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn--primary" data-role="retry">${t('retry')}</button></div>`;
    this.on(this.root.querySelector('[data-role="retry"]'), 'click', () => this.start(mode));
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
        </div>
      </div>`;
    this.bindSwipe();
    this.on(this.root.querySelector('.cp-menu'), 'click', () => this.showPause());
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
    if (this.mode === 'practice') {
      mode.textContent = t('practice');
      const n = this.rack.length;
      sub.textContent = (n === 1 ? t('oneCupLeft') : t('cupsLeft', { n }))
        + ' · ' + (this.throws === 1 ? t('oneThrow') : t('throws', { n: this.throws }));
      return;
    }
    const m = this.match;
    if (!m) return;
    mode.textContent = m.shooter === 'a' ? t('yourTurn') : t('cpuTurn');
    mode.classList.toggle('is-cpu', m.shooter === 'b');
    const bits = [t('cupsScore', { a: m.racks.a.length, b: m.racks.b.length })];
    if (m.phase === 'rebuttal') bits.push(t('rebuttal'));
    else if (m.phase === 'overtime') bits.push(t('overtime'));
    if (m.onFire) bits.push(t('onFire'));
    else if (m.phase !== 'rebuttal' && m.heating(m.shooter)) bits.push(t('heatingUp'));
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

  // --- practice (stage 1, unchanged) -----------------------------------------------------------
  newRack() {
    this.rack = makeRack('tri10');
    this.throws = 0;
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
    this.match = new Match({ first, gentlemans: this.settings.gentlemans });
    this.recorded = false;
    this.throwState = null;
    const R = this.engine.rend;
    R.setRack('a', cupsXZ(this.match.racks.a));
    R.setRack('b', cupsXZ(this.match.racks.b));
    R.setView(first === 'a' ? 'shoot' : 'defend');
    R.hideBall();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = true;
    this.paintHud();
    this.toast(first === 'a' ? t('firstYou') : t('firstCpu'), 1400);
    this.busy = true;
    this.later(() => this.beginTurn(), 900);
  }

  /** The shooter's turn starts: Gentleman's, the rebuttal notice, then a ball for whoever throws. */
  beginTurn() {
    const m = this.match;
    if (!m || m.over) return;
    const R = this.engine.rend;
    const ev = m.startTurn();
    let wait = 0;
    for (const e of ev) {
      if (e.type === 'gentlemans') {
        R.slideRack(e.side, cupsXZ(e.to));
        this.toast(t('gentlemansDone'));
        wait = Math.max(wait, 700);
      } else if (e.type === 'rebuttal') {
        this.toast(e.side === 'a' ? t('rebuttalYou') : t('rebuttal'), 1600);
        wait = Math.max(wait, 900);
      }
    }
    this.paintHud();
    R.setView(m.shooter === 'a' ? 'shoot' : 'defend');
    if (m.shooter === 'a') {
      R.showRestBall(this.spareShown());
      this.busy = false;
    } else {
      R.hideBall();
      this.busy = true;
      this.later(() => this.cpuShoot(), Math.max(wait, CPU_PAUSE_MS + 300));
    }
  }

  /** The greyed second ball shows while this turn still has a throw after this one. */
  spareShown() {
    const m = this.match;
    return !!m && m.phase !== 'rebuttal' && !m.onFire && m.throwsLeft >= 2;
  }

  cpuShoot() {
    const m = this.match;
    if (!m || m.over || m.shooter !== 'b' || !this.engine) return;
    const cups = cupsXZ(m.target());
    const th = this.engine.cpu.cpuThrow(this.settings.diff, cups);
    this.shooter = 'b';
    this.throwState = this.engine.phys.startThrow({ power: th.power, aim: th.aim, cups });
  }

  /** A throw has resolved and settled: the rules decide what happens next. */
  applyThrow(outcome) {
    const m = this.match;
    const made = outcome && outcome.kind === 'made' ? outcome.id : null;
    const ev = m.throwResult({ made, bounced: !!(outcome && outcome.bounced) });
    const R = this.engine.rend;
    let turnOver = false;
    for (const e of ev) {
      if (e.type === 'ballsBack') this.toast(t('ballsBack'));
      else if (e.type === 'heatingUp') this.toast(t('heatingUp'));
      else if (e.type === 'onFire') this.toast(t('onFire'), 1400);
      else if (e.type === 'overtime') {
        this.toast(t('overtime'), 1600);
        R.setRack('a', cupsXZ(m.racks.a));
        R.setRack('b', cupsXZ(m.racks.b));
      } else if (e.type === 'turnOver') turnOver = true;
      else if (e.type === 'win') { this.finish(); return; }
    }
    this.paintHud();
    if (turnOver) {
      this.busy = true;
      this.later(() => this.beginTurn(), TURN_PAUSE_MS);
    } else if (m.shooter === 'a') {
      R.showRestBall(this.spareShown());
      this.busy = false;
    } else {
      this.later(() => this.cpuShoot(), CPU_PAUSE_MS);
    }
  }

  finish() {
    const m = this.match;
    const won = m.winner === 'a';
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
    if (this.mode === 'practice') {
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
    // The side whose cups are being shot at.
    const side = this.shooter === 'a' ? 'b' : 'a';
    if (ev.type === 'made') {
      E.rend.vanish(side, ev.id);
      this.later(() => E.rend.hideBall(), 60);
      if (this.mode === 'practice') {
        this.rack = this.rack.filter((k) => k.id !== ev.id);
        this.paintHud();
      }
    } else if (ev.type === 'done') {
      const o = ev.outcome;
      const wait = o.kind === 'made' ? SETTLE_MS + 200 : SETTLE_MS;
      if (this.mode === 'practice') this.later(() => this.serve(), wait);
      else this.later(() => { this.throwState = null; this.applyThrow(o); }, wait);
    }
  }

  serve() {
    this.throwState = null;
    if (!this.rack.length) { this.showCleared(); return; }
    this.engine.rend.showRestBall();
    this.busy = false;
  }

  showCleared() {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${t('cleared')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${t('cleared')}</h2>
        <p class="cp-card-line">${t('clearedIn', { n: this.throws })}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('again')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const go = () => { el.remove(); this.newRack(); };
    this.on(el.querySelector('[data-role="close"]'), 'click', go);
    this.on(el.querySelector('[data-role="again"]'), 'click', go);
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
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${this.mode === 'practice' ? t('newRack') : t('newGame')}</button>
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
    this.on(el.querySelector('[data-role="new"]'), 'click', () => {
      el.remove();
      this.clearTimers();
      this.throwState = null;
      if (this.mode === 'practice') this.newRack(); else this.newMatch();
      if (!this.disposed) this.startLoop();
    });
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  teardownEngine() {
    this.stopLoop();
    this.clearTimers();
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
 *  computer is not persisted, so leaving one that has started really does abandon it and the hub
 *  should say so. Practice has nothing to lose. A challenge (stage 5) will live in Firebase, so
 *  leaving one will lose nothing and this must answer false for it. */
export function isInProgress() {
  const m = instance && instance.mode === 'cpu' ? instance.match : null;
  return !!(m && !m.over && m.throwsTaken > 0);
}

export default { init, destroy, isInProgress };
