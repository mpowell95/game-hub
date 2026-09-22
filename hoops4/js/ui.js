// hoops4/js/ui.js - CONNECT 4 HOOPS: the shell, the swipe, and the module contract.
//
// THE LAW applies here. Nothing in this folder stores anything earned: `gamehub.hoops4.v1` holds
// one preference (the opponent) and nothing else. The match itself is not persisted - see
// isInProgress() below for which meaning of the contract that is, and why.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { BOARD, COLS } from './boarddef.js';
import { Match, RED, YELLOW } from './game.js';
import { Cpu } from './cpu.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.hoops4.v1';
const CSS_MARK = 'data-hoops4-css';

let instance = null;

const readSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { opponent: [1, 2, 3, 'two'].includes(raw.opponent) ? raw.opponent : 2 };
  } catch { return { opponent: 2 }; }
};
const writeSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

/** Inject the stylesheet once per PAGE. Module stylesheets are never removed on destroy() - they
 *  live in the shared document.head for the life of the page (a hub-wide fact), which is why
 *  every rule is scoped under .h4-root. */
function ensureCSS() {
  if (document.head.querySelector('[' + CSS_MARK + ']')) return Promise.resolve();
  return new Promise((res) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/hoops4.css', import.meta.url).href;
    link.setAttribute(CSS_MARK, '1');
    link.onload = link.onerror = () => res();       // a 404 must not hang the mount for ever
    document.head.appendChild(link);
    setTimeout(res, 2500);
  });
}

class Hoops4 {
  constructor(root) {
    this.root = root;
    this.settings = readSettings();
    this.disposed = false;
    this.raf = 0;
    this.match = null;
    this.throwState = null;
    this.offViewport = null;
    this.engine = null;
    this.recorded = false;
    this.busy = false;
    this._bound = [];
  }

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('h4-root');
    this.renderSetup();
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

  // --- the setup screen -----------------------------------------------------------------------
  renderSetup() {
    if (this.disposed) return;
    this.stopLoop();
    const s = this.settings;
    const opt = (v, label) =>
      `<button type="button" class="gh-btn h4-opt${s.opponent === v ? ' is-on' : ''}" data-opp="${v}">${label}</button>`;
    this.root.innerHTML = `
      <div class="h4-setup">
        <h1 class="h4-title">${t('title')}</h1>
        <p class="h4-tag">${t('tagline')}</p>
        <div class="h4-card">
          <p class="h4-label">${t('opponent')}</p>
          <div class="h4-opts">
            ${opt(1, t('cpu1'))}${opt(2, t('cpu2'))}${opt(3, t('cpu3'))}${opt('two', t('twoPlayer'))}
          </div>
          <p class="h4-note">${t('cpuNote')}</p>
        </div>
        <button type="button" class="gh-btn gh-btn-primary h4-play">${t('play')}</button>
        <button type="button" class="h4-howto-link">${t('howto')}</button>
      </div>`;
    for (const b of this.root.querySelectorAll('[data-opp]')) {
      this.on(b, 'click', () => {
        const v = b.dataset.opp === 'two' ? 'two' : Number(b.dataset.opp);
        this.settings.opponent = v;
        writeSettings(this.settings);
        this.renderSetup();
      });
    }
    this.on(this.root.querySelector('.h4-play'), 'click', () => this.start());
    this.on(this.root.querySelector('.h4-howto-link'), 'click', () => this.showHowto());
  }

  showHowto() {
    const el = document.createElement('div');
    el.className = 'h4-sheet';
    el.innerHTML = `<div class="h4-sheet-in" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <h2>${t('howto')}</h2><p>${t('howtoBody')}</p>
        <button type="button" class="gh-btn h4-sheet-x">${t('close')}</button></div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('.h4-sheet-x'), 'click', () => el.remove());
    this.on(el, 'click', (e) => { if (e.target === el) el.remove(); });
  }

  // --- the match --------------------------------------------------------------------------------
  async start() {
    const vsCpu = this.settings.opponent !== 'two';
    this.match = new Match({ vsCpu, cpuSkill: vsCpu ? this.settings.opponent : 2 });
    this.cpu = vsCpu ? new Cpu(this.settings.opponent) : null;
    this.recorded = false;
    this.renderPlay();
    try {
      const [phys, mach, rend] = await Promise.all([
        import('./physics.js'), import('./machine.js'), import('./render.js'),
      ]);
      if (this.disposed) return;
      this.engine = { phys, machine: mach.buildMachine(BOARD.geom), Renderer: rend.Renderer };
      const canvas = this.root.querySelector('.h4-canvas');
      this.rend = new this.engine.Renderer(canvas, BOARD, this.engine.machine);
      this.fit();
      this.rend.setGrid(this.match.cells(), null);
      this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
      this.offViewport = onViewportResize(() => this.fit());
      this.startLoop();
      this.maybeCpu();
      // Read-only hook for the headless drivers (skeeball's `window.__skTest` precedent). The
      // game itself never reads it; `reference/hoops/check-display.mjs` projects the display and
      // the hoops through the real play camera with it.
      try { window.__h4Test = this; } catch {}
    } catch (err) {
      // A mount that throws lands somewhere recoverable rather than on a dead canvas - the exact
      // failure skeeball shipped on 2026-09-01, where the HUD painted over a 300x150 default.
      console.error('[hoops4] engine failed to load', err);
      if (!this.disposed) this.renderLoadError();
    }
  }

  renderLoadError() {
    this.root.innerHTML = `<div class="h4-setup"><p class="h4-note">${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn-primary h4-play">${t('play')}</button></div>`;
    this.on(this.root.querySelector('.h4-play'), 'click', () => this.renderSetup());
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="h4-play-wrap">
        <div class="h4-hud">
          <span class="h4-who"></span>
          <span class="h4-shots"></span>
        </div>
        <div class="h4-stage">
          <canvas class="h4-canvas"></canvas>
          <div class="h4-swipe" aria-label="${t('swipeHint')}"></div>
          <p class="h4-toast" aria-live="polite"></p>
        </div>
      </div>`;
    this.paintHud();
    this.bindSwipe();
  }

  paintHud() {
    const m = this.match;
    if (!m) return;
    const who = this.root.querySelector('.h4-who');
    const sh = this.root.querySelector('.h4-shots');
    if (!who || !sh) return;
    const mine = m.turn === RED;
    const label = m.vsCpu ? (mine ? t('yourTurn') : t('theirTurn')) : (mine ? t('red') : t('yellow'));
    who.textContent = label;
    who.className = 'h4-who ' + (mine ? 'is-red' : 'is-yellow');
    sh.textContent = m.shotsThisTurn ? `${t('shots')} ${m.shotsThisTurn}` : '';
  }

  toast(msg) {
    const el = this.root.querySelector('.h4-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el && el.classList.remove('is-on'), 1100);
  }

  // --- input -------------------------------------------------------------------------------------
  bindSwipe() {
    const pad = this.root.querySelector('.h4-swipe');
    if (!pad) return;
    let samples = null;
    const start = (e) => {
      if (this.busy || !this.match || this.match.over || this.match.isCpuTurn()) return;
      const p = e.touches ? e.touches[0] : e;
      samples = [{ x: p.clientX, y: p.clientY, t: e.timeStamp }];
    };
    const move = (e) => {
      if (!samples) return;
      const p = e.touches ? e.touches[0] : e;
      samples.push({ x: p.clientX, y: p.clientY, t: e.timeStamp });
      // The pad owns the gesture, so the page must not also scroll it. Bound to the game's OWN
      // element, never to document - a non-passive touchmove on document turns off
      // compositor scrolling for the whole page while this game is mounted.
      if (e.cancelable) e.preventDefault();
    };
    const end = (e) => {
      if (!samples) return;
      const list = samples; samples = null;
      if (list.length < 2) return;
      const first = list[0], last = list[list.length - 1];
      if (first.y - last.y < MIN_UP_PX) return;          // not an upward swipe at all
      const perH = swipeSpeed(list, Math.max(320, window.innerHeight));
      const power = powerOf(perH);
      const G = BOARD.geom;
      const div = G.aimDiv > 0 ? G.aimDiv : 0.38;
      const raw = Math.max(-1, Math.min(1, Math.atan2(last.x - first.x, first.y - last.y) / div));
      const curve = G.aimCurve > 0 ? G.aimCurve : 2;
      const aim = Math.sign(raw) * Math.pow(Math.abs(raw), curve);
      this.shoot(power, aim);
    };
    this.on(pad, 'touchstart', start, { passive: true });
    this.on(pad, 'touchmove', move, { passive: false });
    this.on(pad, 'touchend', end);
    this.on(pad, 'mousedown', start);
    this.on(pad, 'mousemove', move);
    this.on(pad, 'mouseup', end);
  }

  shoot(power, aim) {
    if (this.busy || !this.engine || !this.match || this.match.over) return;
    this.busy = true;
    // A FRESH SEED PER SHOT is what makes the release imperfect (boarddef's jitter*). Passing a
    // seed is opt-in at the engine, so every headless probe stays exactly deterministic.
    const seed = (Math.random() * 0x7fffffff) | 0;
    this.throwState = this.engine.phys.startThrow(BOARD, { power, aim, seed });
    this.captured = null;
  }

  maybeCpu() {
    if (!this.match || this.match.over || !this.match.isCpuTurn() || this.busy) return;
    this._cpuT = setTimeout(() => {
      if (this.disposed || !this.match || !this.match.isCpuTurn()) return;
      const col = this.cpu.pickColumn(this.match);
      const { aim, power } = this.cpu.aimFor(col);
      this.shoot(power, aim);
    }, 800);
  }

  // --- the loop ------------------------------------------------------------------------------
  startLoop() {
    // Idempotent, and THE ONLY way the loop is ever started. Two buttons reach a restart with a
    // chain already running, and each orphan goes on stepping physics for the life of the page.
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
    const st = this.throwState;
    if (st && !st.done) {
      this.engine.phys.step(BOARD, st, dt);
      for (const ev of this.engine.phys.takeEvents(st)) {
        if (ev.type === 'capture') { this.captured = ev.hole; this.rend && this.rend.flashRim(ev.hole); }
      }
    } else if (st && st.done) {
      this.throwState = null;
      this.resolve(st);
    }
    if (this.rend) this.rend.render(st && !st.done ? [st.ball] : [], dt);
  }

  resolve(st) {
    const m = this.match;
    const hole = st.outcome && st.outcome.hole;
    const H = BOARD.geom.holes[hole];
    let res;
    if (H) {
      res = m.land(H.value - 1);            // hole value IS the column, 1-based
    } else {
      res = m.miss();
    }
    this.busy = false;

    if (res.type === 'miss') { this.toast(t('miss')); }
    else if (res.type === 'full') { this.toast(t('full')); }
    else { this.toast(t('inCol').replace('{n}', String(res.col + 1))); }

    if (this.rend) {
      this.rend.setGrid(m.cells(), res.type === 'win' ? res.cells : null);
      this.rend.setBallColor(m.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    this.paintHud();

    if (m.over) { this.finish(); return; }
    this.maybeCpu();
  }

  finish() {
    const m = this.match;
    // ONE-SHOT. Every write in js/game-stats.js is additive, so recording twice silently inflates
    // the play count rather than failing loudly.
    if (!this.recorded) {
      this.recorded = true;
      const r = m.result();
      try {
        if (m.vsCpu) recordResult('hoops4', ['easy', 'medium', 'hard'][this.settings.opponent - 1] || 'medium', r.won);
      } catch (e) { console.error('[hoops4] recordResult failed', e); }
    }
    const r = m.result();
    const acc = r.myShots ? Math.round((100 * r.myDiscs) / r.myShots) : 0;
    let head;
    if (m.winner === null) head = t('draw');
    else if (m.vsCpu) head = m.winner === RED ? t('youWin') : t('youLose');
    else head = m.winner === RED ? t('redWins') : t('yellowWins');

    const card = document.createElement('div');
    card.className = 'h4-over';
    // EVERY win/lose popup in this repo gets a close (X) in its top-right, so it can be dismissed
    // without being forced into a rematch (root CLAUDE.md).
    card.innerHTML = `<div class="h4-over-in" role="dialog" aria-modal="true">
        <button type="button" class="h4-x" aria-label="${t('close')}">&times;</button>
        <h2>${head}</h2>
        <p class="h4-acc">${t('accuracy')} ${acc}% <span>(${r.myDiscs}/${r.myShots})</span></p>
        <button type="button" class="gh-btn gh-btn-primary h4-again">${t('again')}</button>
        <button type="button" class="gh-btn h4-quit">${t('quit')}</button>
      </div>`;
    this.root.appendChild(card);
    this.on(card.querySelector('.h4-x'), 'click', () => card.remove());
    this.on(card.querySelector('.h4-again'), 'click', () => { card.remove(); this.start(); });
    this.on(card.querySelector('.h4-quit'), 'click', () => { card.remove(); this.teardownEngine(); this.renderSetup(); });
  }

  fit() {
    const stage = this.root.querySelector('.h4-stage');
    if (!stage || !this.rend) return;
    const r = stage.getBoundingClientRect();
    this.rend.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  }

  teardownEngine() {
    this.stopLoop();
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    if (this._cpuT) { clearTimeout(this._cpuT); this._cpuT = 0; }
    if (this.rend) {
      try { this.rend.dispose(); } catch {}
      // dispose() frees three.js's buffers and LEAVES THE CONTEXT ALIVE. Only forceContextLoss()
      // hands it back, and a browser holds ~16 globally - leaking one per match throttles the
      // whole hub, which is what happened to skeeball on 2026-08-26.
      try { this.rend.renderer && this.rend.renderer.forceContextLoss(); } catch {}
      try { this.rend.renderer && this.rend.renderer.dispose(); } catch {}
      this.rend = null;
    }
    this.throwState = null;
    this.engine = null;
    this.busy = false;
  }

  destroy() {
    this.disposed = true;
    try { if (window.__h4Test === this) delete window.__h4Test; } catch {}
    clearTimeout(this._toastT);
    this.teardownEngine();
    this.unbindAll();
    this.root.classList.remove('h4-root');
    this.root.innerHTML = '';
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch {} }
  instance = new Hoops4(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE "NO MID-GAME RESUME" MEANING of the contract (Ball Run / Snake / Pinball's class, not
 *  Escoba's): nothing about a match is persisted, so leaving really does abandon it and the hub
 *  should say so. A 3D throw mid-flight and a turn that is mid-shoot-until-you-make-it are not
 *  states worth snapshotting, and skeeball deliberately removed its own mid-rack resume for the
 *  same reason (Matt: "you either finish or quit"). */
export function isInProgress() {
  return !!(instance && instance.match && !instance.match.over && instance.match.moves.length > 0);
}

export default { init, destroy, isInProgress };
