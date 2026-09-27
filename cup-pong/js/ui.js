// cup-pong/js/ui.js - CUP PONG: the shell, the flick, and the module contract.
//
// STAGE 1 (docs/CUP-PONG-BRIEF.md section 6): the table and the throw, solo practice only. No
// rules, no opponent, nothing recorded. THE LAW applies all the same: nothing in this folder
// stores anything earned - there is no storage at all yet.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { THROW } from './geom.js';
import { makeRack, cupsXZ } from './rack.js';

const t = makeT(STRINGS);
const CSS_MARK = 'data-cuppong-css';
const SETTLE_MS = 450;          // after a throw resolves, before the next ball is served

let instance = null;

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
    this.disposed = false;
    this.raf = 0;
    this.engine = null;      // { phys, rend }
    this.rack = [];          // [{ id, c, r }] - the cups still standing
    this.throws = 0;
    this.throwState = null;
    this.busy = false;
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

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('cp-root');
    this.renderPlay();
    try {
      const [phys, rend] = await Promise.all([import('./physics.js'), import('./render.js')]);
      if (this.disposed) return;
      const canvas = this.root.querySelector('.cp-canvas');
      this.engine = { phys, rend: new rend.Renderer(canvas, { reducedMotion: reducedMotion() }) };
      this.newRack();
      this.fit();
      this.offViewport = onViewportResize(() => this.fit());
      this.startLoop();
      // Read-only hook for headless drivers (skeeball's `__skTest` precedent). Never read by the game.
      try { window.__cpTest = this; } catch {}
    } catch (err) {
      // Land somewhere recoverable, never on a dead canvas (skeeball, 2026-09-01).
      console.error('[cup-pong] engine failed to load', err);
      if (!this.disposed) this.renderLoadError();
    }
  }

  renderLoadError() {
    this.teardownEngine();
    this.root.innerHTML = `<div class="cp-error"><p>${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn--primary" data-role="retry">${t('retry')}</button></div>`;
    this.on(this.root.querySelector('[data-role="retry"]'), 'click', () => this.mount());
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="cp-play">
        <div class="cp-hud">
          <div class="cp-status" aria-live="polite">
            <span class="cp-mode">${t('practice')}</span>
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
    const sub = this.root.querySelector('.cp-sub');
    if (!sub) return;
    const n = this.rack.length;
    sub.textContent = (n === 1 ? t('oneCupLeft') : t('cupsLeft', { n }))
      + ' · ' + (this.throws === 1 ? t('oneThrow') : t('throws', { n: this.throws }));
  }

  toast(msg) {
    const el = this.root.querySelector('.cp-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-on');
    void el.offsetWidth;            // restart the fade for a repeat of the same word
    el.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('is-on'), 1100);
  }

  newRack() {
    this.rack = makeRack('tri10');
    this.throws = 0;
    this.throwState = null;
    this.busy = false;
    if (this.engine) {
      this.engine.rend.setCups(cupsXZ(this.rack));
      this.engine.rend.showRestBall();
    }
    this.paintHud();
    const hint = this.root.querySelector('.cp-hint');
    if (hint) hint.hidden = false;
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
      // AIM IS THE SWIPE'S ANGLE off straight up, scaled down to a heading (geom.js aimGain).
      const ang = Math.atan2(last.x - first.x, first.y - last.y);
      this.shoot(power, ang * THROW.aimGain, { perH, ang });
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

  shoot(power, aim, info = {}) {
    if (this.busy || !this.engine || !this.rack.length) return;
    this.busy = true;
    this.throws++;
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
    this.throwState = this.engine.phys.startThrow({ power, aim, cups: cupsXZ(this.rack) });
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
      for (const ev of E.phys.takeEvents(st)) this.onEvent(ev);
      E.rend.render(st.ball, dt);
      if (st.done) this.throwState = { done: true, ball: st.ball, outcome: st.outcome };
      return;
    }
    E.rend.render(null, dt);
  }

  onEvent(ev) {
    const E = this.engine;
    if (ev.type === 'made') {
      this.rack = this.rack.filter((k) => k.id !== ev.id);
      E.rend.vanish(ev.id);
      this.later(() => E.rend.hideBall(), 90);
      this.toast(ev.bounced ? t('bounceMade') : t('made'));
      this.paintHud();
    } else if (ev.type === 'done') {
      const o = ev.outcome;
      if (o.kind !== 'made') this.toast(this.throwState && this.throwState.touchedCup ? t('rimOut') : t('miss'));
      this.later(() => this.serve(), o.kind === 'made' ? SETTLE_MS + 200 : SETTLE_MS);
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
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cp-pause" role="dialog" aria-modal="true" aria-label="${t('paused')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cp-card-title">${t('paused')}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${t('newRack')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    // The sheet really pauses: a ball in the air freezes and carries on after (skeeball's lesson).
    this.stopLoop();
    const close = () => { el.remove(); if (!this.disposed) this.startLoop(); };
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    this.on(el.querySelector('[data-role="new"]'), 'click', () => {
      el.remove();
      for (const id of this._timers) clearTimeout(id);
      this._timers.clear();
      this.newRack();
      if (!this.disposed) this.startLoop();
    });
  }

  teardownEngine() {
    this.stopLoop();
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
  }

  destroy() {
    this.disposed = true;
    try { if (window.__cpTest === this) delete window.__cpTest; } catch {}
    clearTimeout(this._toastT);
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
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

/** STAGE 1: PRACTICE ONLY, so always false - there is no match to abandon and nothing is lost by
 *  leaving. Stage 2 (a real match vs the computer) takes the NO MID-GAME RESUME meaning (Hoops',
 *  Ball Run's): true while a match is under way, because a match vs the computer is not persisted.
 *  A challenge will live in Firebase, so leaving one will lose nothing and stay false. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
