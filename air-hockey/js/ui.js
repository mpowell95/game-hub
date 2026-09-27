// air-hockey/js/ui.js - Air Hockey's DOM shell: start card, score row, pause and result cards,
// touch/mouse input, sound, the clock. physics.js owns every rule; render.js every pixel.
//
// STAGE 1 (2026-09-27): one simple computer (ai.js 'medium'), no setup screen, no stats. Stage 2
// adds Easy/Medium/Hard, the setup screen, how to play and recordResult('airhockey', ...).
//
// isInProgress(): the LITERAL meaning (no mid-game resume, Hoops' / Snake's class): true while a
// match is under way (playing, between goals, or paused). Nothing is persisted mid-match.

import { TABLE, createMatch, resetMatch, advance, clampTarget } from './physics.js';
import { createCpu, cpuThink } from './ai.js';
import { createRenderer } from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onThemeChange } from '../../js/theme.js';
import { onViewportResize } from '../../js/viewport.js';

const t = makeT(STRINGS);
const { H } = TABLE;
const CPU_LEVEL = 'medium';
const FINGER_OFFSET_CSS = 34;   // the mallet sits this far ABOVE the finger, so the thumb never hides it

const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
const TRI_SVG = '<svg class="ah-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 1.5 L11 10.5 L1 10.5 Z" fill="currentColor"/></svg>';
const SQ_SVG = '<svg class="ah-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="9" height="9" fill="currentColor"/></svg>';

/** Tiny Web Audio kit: a puck-on-mallet clack, a softer wall tick, a two-note goal horn. Created
 *  on the first touch (browsers only allow audio after a gesture). Silent if Web Audio is absent. */
function createSound() {
  let ac = null, lastHit = 0;
  function unlock() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch { ac = null; }
  }
  function blip(freq, dur, vol, type) {
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now + dur + 0.02);
  }
  return {
    unlock,
    hit(speed) {
      const n = performance.now();
      if (n - lastHit < 45) return;
      lastHit = n;
      blip(700 + Math.min(600, speed * 0.25), 0.06, Math.min(0.35, 0.08 + speed / 5000), 'triangle');
    },
    wall(speed) { blip(320, 0.04, Math.min(0.12, speed / 12000), 'sine'); },
    goal(mine) { blip(mine ? 660 : 330, 0.18, 0.25, 'square'); setTimeout(() => blip(mine ? 880 : 247, 0.26, 0.22, 'square'), 170); },
    close() { if (ac) { ac.close().catch(() => {}); ac = null; } },
  };
}

let instance = null;

class AirHockeyUI {
  constructor(host) {
    this.host = host;
    this.screen = 'menu';          // menu | game | paused | over
    this.match = createMatch();
    this.cpu = createCpu(CPU_LEVEL, 1, (Date.now() & 0xffff) + 1);
    this.raf = 0;
    this.last = 0;
    this.flash = 0;
    this.goalT = 0;
    this.drag = { id: null };
    this.reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduce = this.reduceMQ.matches;
    this._onReduce = (e) => { this.reduce = e.matches; };
    if (this.reduceMQ.addEventListener) this.reduceMQ.addEventListener('change', this._onReduce);
    this.sound = createSound();
    this._ensureCss();
    this._build();
    this.renderer = createRenderer(this.canvas);

    this._onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.screen === 'game') this._pause(); else if (this.screen === 'paused') this._resume();
      }
    };
    this._onVis = () => { if (document.hidden) { if (this.screen === 'game') this._pause(); this._stop(); } };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    // The stage also changes size with no viewport event (the stylesheet landing after first
    // paint, the hub chrome settling): docs/BUILDING-A-GAME.md, "The .hub-game height trap".
    this._stageSize = '';
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (this.stage.clientWidth + 'x' + this.stage.clientHeight !== this._stageSize) this._layout();
    }) : null;
    if (this._ro) this._ro.observe(this.stage);
    this._offLang = onLangChange(() => this._relabel());
    this._offTheme = onThemeChange(() => this._layout());

    resetMatch(this.match, 0);
    this._layout();
    this._showOnly('menu');
  }

  _ensureCss() {
    const add = (href, mark) => {
      if (document.head.querySelector(`link[${mark}]`)
        || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.setAttribute(mark, '1');
      document.head.appendChild(link);
    };
    add(new URL('../../css/ui.css', import.meta.url).href, 'data-gh-ui-css');
    add(new URL('../css/air-hockey.css', import.meta.url).href, 'data-ah-css');
  }

  // --- DOM ---------------------------------------------------------------------------------------
  _build() {
    this.host.innerHTML = `
      <div class="ah-root">
        <div class="ah-hud">
          <p class="ah-score" data-role="score" aria-live="off">
            <span class="ah-sc ah-sc-cpu">${SQ_SVG}<span data-l="cpu"></span><b data-role="s1">0</b></span>
            <span class="ah-sc ah-sc-you">${TRI_SVG}<span data-l="you"></span><b data-role="s0">0</b></span>
          </p>
          <button type="button" class="gh-btn gh-btn--icon ah-pause" data-act="pause" data-la="pause">${PAUSE_SVG}</button>
        </div>
        <div class="ah-stage" data-role="stage">
          <div class="ah-screen" data-role="screen">
            <canvas class="ah-canvas" role="img"></canvas>
            <p class="ah-banner" data-role="banner" hidden></p>
          </div>
        </div>

        <div class="ah-ov" data-ov="menu" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title" data-l="title"></h2>
            <p class="ah-tag" data-l="tagline"></p>
            <p class="ah-hint" data-l="hint"></p>
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play"><span data-l="play"></span></button>
          </div>
        </div>

        <div class="ah-ov" data-ov="paused" hidden>
          <div class="gh-modal ah-card">
            <h2 class="ah-title" data-l="paused"></h2>
            <div class="ah-actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="resume"><span data-l="resume"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="quit"><span data-l="quit"></span></button>
            </div>
          </div>
        </div>

        <div class="ah-ov" data-ov="over" hidden>
          <div class="gh-modal ah-card" role="dialog" aria-modal="true">
            <button type="button" class="gh-modal__close" data-act="back" data-la="aria_close">${X_SVG}</button>
            <h2 class="ah-title" data-role="overTitle"></h2>
            <p class="ah-final" data-role="overScore"></p>
            <div class="ah-actions">
              <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="rematch"><span data-l="rematch"></span></button>
              <button type="button" class="gh-btn gh-btn--block" data-act="back"><span data-l="back"></span></button>
            </div>
          </div>
        </div>
        <p class="ah-sr" aria-live="polite" data-role="live"></p>
      </div>`;
    const q = (s) => this.host.querySelector(s);
    this.root = q('.ah-root');
    this.stage = q('[data-role="stage"]');
    this.screenEl = q('[data-role="screen"]');
    this.canvas = q('.ah-canvas');
    this.banner = q('[data-role="banner"]');
    this.liveEl = q('[data-role="live"]');
    this.scoreEl = q('[data-role="score"]');
    this.s0 = q('[data-role="s0"]');
    this.s1 = q('[data-role="s1"]');
    this.ov = {};
    this.root.querySelectorAll('[data-ov]').forEach((el) => { this.ov[el.dataset.ov] = el; });

    this.root.addEventListener('click', (e) => this._click(e));
    // Input lives on the stage (the table plus the margin round it), so a thumb just below the
    // table still steers. Pointer capture keeps a drag alive past the edge.
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this.stage.addEventListener('pointerdown', this._onDown);
    this.stage.addEventListener('pointermove', this._onMove);
    this.stage.addEventListener('pointerup', this._onUp);
    this.stage.addEventListener('pointercancel', this._onUp);
    // Scroll-leak guard, root-scoped (never document: root CLAUDE.md, "Scroll and touch rules").
    this._onTouchMove = (e) => { if (this.screen === 'game') e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this._relabel();
  }

  _relabel() {
    this.root.querySelectorAll('[data-l]').forEach((el) => { el.textContent = t(el.dataset.l); });
    this.root.querySelectorAll('[data-la]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.la)); });
    this.canvas.setAttribute('aria-label', t('aria_canvas'));
    this._syncScore();
    if (this.screen === 'over') this._fillOver();
  }

  _syncScore() {
    const [a, b] = this.match.score;
    this.s0.textContent = String(a);
    this.s1.textContent = String(b);
    this.scoreEl.setAttribute('aria-label', t('aria_score', { a, b }));
  }

  _showOnly(name) {
    for (const k of Object.keys(this.ov)) this.ov[k].hidden = k !== name;
    this.root.classList.toggle('is-playing', name === null);
    const focus = name && this.ov[name].querySelector('.gh-btn--primary');
    if (focus) focus.focus({ preventScroll: true });
  }

  // --- layout ------------------------------------------------------------------------------------
  _layout() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) { requestAnimationFrame(() => { if (instance === this) this._layout(); }); return; }
    this._stageSize = w + 'x' + h;
    const dark = document.documentElement.classList.contains('gh-dark');
    const size = this.renderer.layout(w - 8, h - 8, dark);
    this.screenEl.style.width = size.w + 'px';
    this.screenEl.style.height = size.h + 'px';
    this.renderer.render(this.match, 0);
  }

  // --- match lifecycle ---------------------------------------------------------------------------
  _play() {
    resetMatch(this.match, 0);
    this.cpu = createCpu(CPU_LEVEL, 1, (Date.now() & 0xffff) + 1);
    this.flash = 0; this.goalT = 0;
    this.banner.hidden = true;
    this._syncScore();
    this.screen = 'game';
    this._showOnly(null);
    this._start();
  }
  _pause() {
    if (this.screen !== 'game') return;
    this.screen = 'paused';
    this._stop();
    this._showOnly('paused');
  }
  _resume() {
    if (this.screen !== 'paused') return;
    this.screen = 'game';
    this._showOnly(null);
    this._start();
  }
  _toMenu() {
    this._stop();
    this.screen = 'menu';
    resetMatch(this.match, 0);
    this.banner.hidden = true;
    this._syncScore();
    this.renderer.render(this.match, 0);
    this._showOnly('menu');
  }
  _over() {
    this._stop();
    this.screen = 'over';
    this.banner.hidden = true;
    this.renderer.render(this.match, 0);
    this._fillOver();
    this._showOnly('over');
  }
  _fillOver() {
    const [a, b] = this.match.score;
    this.root.querySelector('[data-role="overTitle"]').textContent = t(this.match.winner === 0 ? 'you_win' : 'cpu_wins');
    this.root.querySelector('[data-role="overScore"]').textContent = `${a} - ${b}`;
  }

  _goal(scorer) {
    const [a, b] = this.match.score;
    this._syncScore();
    this.sound.goal(scorer === 0);
    this.liveEl.textContent = t(scorer === 0 ? 'say_goal_you' : 'say_goal_cpu', { a, b });
    if (this.match.phase === 'over') return;
    this.banner.textContent = t('goal');
    this.banner.classList.toggle('is-cpu', scorer === 1);
    this.banner.hidden = false;
    if (!this.reduce) {
      this.flash = 1;
      this.banner.classList.remove('is-pop'); void this.banner.offsetWidth; this.banner.classList.add('is-pop');
    }
    this.goalT = 1.1;
  }

  // --- input -------------------------------------------------------------------------------------
  _click(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    this.sound.unlock();
    if (act === 'play' || act === 'rematch') this._play();
    else if (act === 'pause') { if (this.screen === 'game') this._pause(); else if (this.screen === 'paused') this._resume(); }
    else if (act === 'resume') this._resume();
    else if (act === 'quit' || act === 'back') this._toMenu();
  }
  _tablePoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.renderer.toTable(e.clientX - r.left, e.clientY - r.top);
  }
  _aim(e, offset) {
    const p = this._tablePoint(e);
    const off = offset ? FINGER_OFFSET_CSS / (this.renderer.scale || 1) : 0;
    clampTarget(this.match.mallets[0], p.x, p.y - off);
  }
  _pointerDown(e) {
    this.sound.unlock();
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') { this._aim(e, false); return; }
    // Touch anywhere in your half (with a little grace above the centre line) to grab the mallet.
    const p = this._tablePoint(e);
    if (p.y < H / 2 - 60) return;
    this.drag.id = e.pointerId;
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this._aim(e, true);
  }
  _pointerMove(e) {
    if (this.screen !== 'game') return;
    if (e.pointerType === 'mouse') { this._aim(e, false); return; }
    if (e.pointerId === this.drag.id) this._aim(e, true);
  }
  _pointerUp(e) {
    if (e.pointerId === this.drag.id) this.drag.id = null;
  }

  // --- clock -------------------------------------------------------------------------------------
  _start() {
    if (this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  _frame(now) {
    this.raf = 0;
    if (instance !== this || this.screen !== 'game') return;
    let dt = Math.max(0, (now - this.last) / 1000); this.last = now;
    if (dt > 0.05) dt = 0.05;
    const s = this.match;
    cpuThink(s, this.cpu, dt);
    s.ev.hit = 0; s.ev.wall = 0; s.ev.goal = -1; s.ev.stuck = -1;
    advance(s, dt);
    if (s.ev.hit > 120) this.sound.hit(s.ev.hit);
    else if (s.ev.wall > 250) this.sound.wall(s.ev.wall);
    if (s.ev.goal >= 0) this._goal(s.ev.goal);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    if (this.goalT > 0) { this.goalT -= dt; if (this.goalT <= 0) this.banner.hidden = true; }
    this.renderer.render(s, this.flash);
    if (s.phase === 'over') { this._over(); return; }
    this.raf = requestAnimationFrame((n) => this._frame(n));
  }

  destroy() {
    this._stop();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.reduceMQ.removeEventListener) this.reduceMQ.removeEventListener('change', this._onReduce);
    if (this._offResize) this._offResize();
    if (this._ro) this._ro.disconnect();
    if (this._offLang) this._offLang();
    if (this._offTheme) this._offTheme();
    this.sound.close();
    this.host.innerHTML = '';
  }
}

export function init(container) {
  if (instance) destroy();
  instance = new AirHockeyUI(container);
}
export function destroy() {
  if (!instance) return;
  const i = instance;
  instance = null;
  i.destroy();
}
/** Literal meaning: a match under way (playing, between goals or paused) would be lost by leaving. */
export function isInProgress() {
  return !!(instance && (instance.screen === 'game' || instance.screen === 'paused'));
}
export default { init, destroy, isInProgress };
