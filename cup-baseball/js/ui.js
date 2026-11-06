// cup-baseball/js/ui.js - CUP BASEBALL: the setup screen, the flick, the game flow, the module
// contract. The table, the cups, the ball and the flick are Cup Pong's (cup-pong/js/physics.js,
// render.js via ./render.js, skeeball/js/swipe.js), imported, never copied.
//
// THE LAW applies here. `gamehub.cupbaseball.v1` holds preferences only (difficulty, innings, who
// bats first next). A finished game vs the computer goes to the shared recorder,
// `recordResult('cupbaseball', difficulty, won)`, exactly once. Two players on one phone records
// nothing (there is no second profile to credit).
// A GAME IN PROGRESS IS SAVED (2026-11-06, Matt: "We should add resume to the other games that don't
// save"): `gamehub.cupbaseball.save.v1` = { v: 1, at, mode, cfg: {diff}, game: Game.toJSON(), fly },
// vs the computer and two players alike, after every throw resolves, at each throw's launch (`fly`,
// flown again on Continue: the physics is a fixed step, so it lands where it was going) and at a new
// game. Removed before the result is recorded. Holds no earned history. Leaving (the hub, Change
// settings, a closed app) is not quitting; New game over a computer game anyone has thrown in is ONE
// loss, asked twice.
import { onViewportResize } from '../../js/viewport.js';
import { makeT, myName } from '../../js/i18n.js';
import { recordResult, armQuitLoss, dropQuitLoss, takeQuitLoss, quitLossLost, withMode, modeTag } from '../../js/game-stats.js';
/** WHICH game was played, recorded with its result (js/game-stats.js withMode, 2026-10-30): innings
 *  and who batted first. */
const modeOf = (g) => ({ inn: g && g.innings, first: g && g.first === 'b' ? 'them' : 'me' });
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { THROW, CUP } from '../../cup-pong/js/geom.js';
import { STRINGS } from './strings.js';
import { Game, INNINGS } from './game.js';
import { CUPS, hitOf, MID_Z } from './field.js';

const t = makeT(STRINGS);
const CSS_MARK = 'data-cupbaseball-css';
const SETTINGS_KEY = 'gamehub.cupbaseball.v1';
const SAVE_KEY = 'gamehub.cupbaseball.save.v1';
const SETTLE_MS = 450;          // after a throw resolves, before anything else happens
const CPU_PAUSE_MS = 1000;      // before each computer throw, so it reads as a person lining up
const SWITCH_MS = 1300;         // the "Out! Switch" word, before the camera moves
const DIFFS = ['easy', 'medium', 'hard'];
const HIT_WORD = { 1: 'single', 2: 'double', 3: 'triple', 4: 'homeRun' };
let instance = null;

const readSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      diff: DIFFS.includes(raw.diff) ? raw.diff : 'medium',
      innings: INNINGS.includes(raw.innings) ? raw.innings : 3,
      // Turn-based games alternate who opens (docs/BUILDING-A-GAME.md, setup defaults).
      nextFirst: raw.nextFirst === 'b' ? 'b' : 'a',
    };
  } catch { return { diff: 'medium', innings: 3, nextFirst: 'a' }; }
};
const writeSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

/** The saved game, or null. `cfg` is that game's own settings (the setup screen may have changed). */
function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1 || !(s.mode === 'cpu' || s.mode === 'pass') || !s.cfg || !DIFFS.includes(s.cfg.diff)) return null;
    const g = Game.fromJSON(s.game);
    if (g.over) return null;
    return s;
  } catch { return null; }
}
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch (err) { console.error('[cup-baseball] saved game not cleared', err); } };
/** A game vs the computer anyone has thrown in (one still in the air included): throwing it away is a loss. */
const savedMoved = (s) => !!s && s.mode === 'cpu' && ((s.game.throws | 0) > 0 || !!s.fly);
/** A throw left in the air: `{ s, p, a }` (shooter, power, aim). */
const flyOk = (f) => !!f && (f.s === 'a' || f.s === 'b') && Number.isFinite(+f.p) && Number.isFinite(+f.a);

/** css/ui.css's primitives first (idempotent), then this game's own sheet (Cup Pong's guard). */
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
  const href = new URL('../css/cup-baseball.css', import.meta.url).href;
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

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** The bases, strikes and outs, drawn: an occupied base is a FILLED diamond, an empty one an outline;
 *  a strike (S) or an out (O) is a filled circle. Shape, fill and letter carry it, never colour alone. */
function diamondSVG(bases, outs, strikes) {
  const base = (x, y, on) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${x} ${y})"
    class="${on ? 'is-on' : ''}"/>`;
  const out = (x, on) => `<circle cx="${x}" cy="62" r="5" class="${on ? 'is-on' : ''}"/>`;
  return `<svg viewBox="0 0 64 70" width="110" height="120" aria-hidden="true">
    ${base(48, 26, bases[0])}${base(32, 10, bases[1])}${base(16, 26, bases[2])}
    <rect x="27" y="37" width="10" height="10" transform="rotate(45 32 42)" class="cb-home"/>
    <text x="3" y="65.5" class="cb-dia-txt">S</text>${out(16, strikes >= 1)}
    <text x="29" y="65.5" class="cb-dia-txt">O</text>${out(43, outs >= 1)}${out(56, outs >= 2)}</svg>`;
}

/** How to play's diagram: the four cups in a line, the shooter's ball below, each cup's hit beside it. */
const HELP_SVG = `<svg viewBox="0 0 200 150" width="200" height="150" aria-hidden="true" class="cb-help-svg">
  <rect x="50" y="4" width="100" height="142" rx="4" class="cb-help-felt"/>
  ${[1, 2, 3, 4].map((h, i) => {
    const y = 120 - i * 30 - 12;
    return `<circle cx="90" cy="${y}" r="11" class="cb-help-cup"/><text x="108" y="${y + 5}" class="cb-help-txt">${['1B', '2B', '3B', 'HR'][i]}</text>`;
  }).join('')}
  <circle cx="90" cy="138" r="5" class="cb-help-ball"/></svg>`;

class CupBaseball {
  constructor(root) {
    this.root = root;
    this.settings = readSettings();
    this.disposed = false;
    this.raf = 0;
    this.engine = null;      // { phys, rend, cpu }
    this.mode = null;        // 'cpu' | 'pass'
    this.game = null;
    this.cfg = null;         // THIS game's settings ({ diff }); the setup screen's may change meanwhile
    this._fly = null;        // the throw in the air, as saved
    this.names = { a: '', b: '' };
    this.throwState = null;
    this.shooter = 'a';      // render frame of the ball in the air ('b' = from the far end)
    this.busy = false;
    this.recorded = false;
    this.offViewport = null;
    this._bound = [];
    this._timers = new Set();
  }

  // --- listener hygiene: destroy() must leave nothing behind ---------------------------------
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

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('cb-root');
    this.renderSetup();
  }

  // --- the setup screen ------------------------------------------------------------------------
  // A hub screen on css/ui.css's primitives. Names, numbers and one action word per button.
  renderSetup() {
    if (this.disposed) return;
    this.teardownEngine();
    this.unbindAll();
    this.mode = null;
    this.game = null;
    this.cfg = null;
    this._fly = null;
    const s = this.settings;
    const saved = readSave();
    const seg = (role, items, cur) => `<div class="gh-seg" role="group" data-role="${role}">${items.map(([v, label, icon]) =>
      `<button type="button" class="gh-seg__item" data-v="${v}" aria-pressed="${v === cur}">${icon || ''}<span>${label}</span></button>`).join('')}</div>`;
    this.root.innerHTML = `
      <div class="cb-setup">
        <h1 class="cb-title">${t('title')}</h1>
        <div class="gh-card cb-setup-card">
          <p class="cb-setup-label">${t('innings')}</p>
          ${seg('inn', INNINGS.map((n) => [String(n), String(n)]), String(s.innings))}
          <p class="cb-setup-label">${t('computer')}</p>
          ${seg('diff', DIFFS.map((d) => [d, t(d), diffShapeSVG(tierOf(d))]), s.diff)}
          ${saved ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block cb-setup-play" data-role="continue">${t('continueGame')}</button>` : ''}
          <button type="button" class="gh-btn ${saved ? 'gh-btn--ghost' : 'gh-btn--primary'} gh-btn--block cb-setup-play" data-role="play">${t('play')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block cb-setup-play" data-role="pass">${t('twoPlayers')}</button>
        </div>
        <button type="button" class="cb-link" data-role="help">${t('help')}</button>
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
    pick('inn', (v) => { this.settings.innings = Number(v); });
    pick('diff', (v) => { this.settings.diff = v; });
    // A new game over a saved computer game someone has thrown in throws it away: two taps, a loss.
    this.on(this.root.querySelector('[data-role="play"]'), 'click', (e) => this.quitGate(e.currentTarget, () => this.start('cpu')));
    this.on(this.root.querySelector('[data-role="pass"]'), 'click', (e) => this.quitGate(e.currentTarget, () => this.start('pass')));
    if (saved) this.on(this.root.querySelector('[data-role="continue"]'), 'click', () => this.start(saved.mode, { resume: true }));
    this.on(this.root.querySelector('[data-role="help"]'), 'click', () => this.showHelp());
  }

  showHelp() {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cb-help" role="dialog" aria-modal="true" aria-label="${t('help')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <p class="cb-help-goal">${t('helpGoal')}</p>
        ${HELP_SVG}
        <p class="cb-help-line">${t('helpCups')}</p>
        <p class="cb-help-line">${t('helpStrike')}</p>
        <p class="cb-help-line">${t('helpEx')}</p>
        <p class="cb-help-line">${t('helpOuts')}</p>
        <p class="cb-help-line">${t('helpTie')}</p>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
  }

  // --- starting a game -------------------------------------------------------------------------
  async start(mode, opts = {}) {
    this.teardownEngine();
    this.unbindAll();
    this.clearTimers();
    this.mode = mode;
    this.renderPlay();
    try {
      const [phys, rend, cpu] = await Promise.all([
        import('../../cup-pong/js/physics.js'), import('./render.js'), import('./cpu.js')]);
      if (this.disposed || this.mode !== mode) return;
      const canvas = this.root.querySelector('.cb-canvas');
      this.engine = { phys, cpu, rend: new rend.Renderer(canvas, { reducedMotion: reducedMotion() }) };
      this.fit();
      this.offViewport = onViewportResize(() => this.fit());
      if (!opts.resume || !this.resumeGame()) this.newGame();
      this.startLoop();
      // Read-only hook for headless drivers (Cup Pong's `__cpTest` precedent). Never read by the game.
      try { window.__cbTest = this; } catch {}
    } catch (err) {
      // Land somewhere recoverable, never on a dead canvas (skeeball, 2026-09-01).
      console.error('[cup-baseball] engine failed to load', err);
      if (!this.disposed) this.renderLoadError(mode, opts);
    }
  }

  renderLoadError(mode, opts = {}) {
    this.teardownEngine();
    this.root.innerHTML = `<div class="cb-error"><p>${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn--primary" data-role="retry">${t('retry')}</button></div>`;
    this.on(this.root.querySelector('[data-role="retry"]'), 'click', () => this.start(mode, opts));
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="cb-play">
        <div class="cb-hud">
          <div class="cb-status" aria-live="polite">
            <span class="cb-mode"></span>
            <span class="cb-sub"></span>
          </div>
          <button type="button" class="cb-menu" aria-label="${t('menu')}">&#9776;</button>
        </div>
        <div class="cb-stage">
          <canvas class="cb-canvas"></canvas>
          <div class="cb-swipe" role="application" aria-label="${t('swipeArea')}"></div>
          <div class="cb-diamond" role="img"></div>
          <p class="cb-toast" aria-live="polite"></p>
          <p class="cb-hint">${t('swipeHint')}</p>
          <button type="button" class="cb-pass" hidden><b></b><span>${t('tapGo')}</span></button>
        </div>
      </div>`;
    this.bindSwipe();
    this.on(this.root.querySelector('.cb-menu'), 'click', () => this.showPause());
    this.on(this.root.querySelector('.cb-pass'), 'click', () => this.passTaken());
  }

  fit() {
    const stage = this.root.querySelector('.cb-stage');
    if (!stage || !this.engine) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) { this.later(() => this.fit(), 50); return; }   // flex not settled yet
    this.engine.rend.resize(w, h);
  }

  paintHud() {
    const g = this.game;
    const mode = this.root.querySelector('.cb-mode');
    const sub = this.root.querySelector('.cb-sub');
    const dia = this.root.querySelector('.cb-diamond');
    if (!g || !mode || !sub) return;
    const N = this.names;
    mode.textContent = g.over ? t('wins', { name: N[g.winner] }) : t('up', { name: N[g.batting] });
    mode.classList.toggle('is-cpu', !g.over && this.mode === 'cpu' && g.batting === 'b');
    sub.textContent = t('score', { a: N.a, ra: g.runs.a, rb: g.runs.b, b: N.b })
      + ' · ' + t(g.half === 0 ? 'top' : 'bottom', { n: g.inning });
    if (dia) {
      dia.innerHTML = diamondSVG(g.bases, g.outs, g.strikes);
      const on = ['1B', '2B', '3B'].filter((_, i) => g.bases[i]);
      dia.setAttribute('aria-label', `${t('bases')}: ${on.join(', ') || '0'}. ${t('strikesLabel')}: ${g.strikes}. ${t('outsLabel')}: ${g.outs}`);
    }
  }

  toast(msg, ms = 1100) {
    const el = this.root.querySelector('.cb-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('is-on');
    void el.offsetWidth;            // restart the fade for a repeat of the same word
    el.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('is-on'), ms);
  }

  // --- the game --------------------------------------------------------------------------------
  newGame() {
    this.takeQuit();   // a game thrown in and not finished, replaced by a new one, is a loss
    this.clearTimers();
    this.throwState = null;
    this.recorded = false;
    this.names = this.namesFor(this.mode);
    this.game = new Game({ innings: this.settings.innings, first: this.settings.nextFirst });
    this.cfg = { diff: this.settings.diff };
    this._fly = null;
    const R = this.engine.rend;
    R.flash('a', null); R.flash('b', null);
    const hint = this.root.querySelector('.cb-hint');
    if (hint) hint.hidden = false;
    this.paintHud();
    this.busy = true;
    this.saveGame();
    if (this.mode === 'pass') { this.askPass(); return; }
    this.toast(t('up', { name: this.names[this.game.batting] }), 1400);
    this.later(() => this.beginTurn(), 900);
  }

  namesFor(mode) {
    const p = (() => { try { return loadProfile(); } catch { return null; } })();
    const o = p && Array.isArray(p.opponents) ? p.opponents[0] : null;
    return { a: myName(), b: mode === 'pass' ? t('player2') : ((o && o.name) || t('computer')) };
  }

  /** CONTINUE: the saved game exactly as it was left. False when there is none to continue. */
  resumeGame() {
    const sv = readSave();
    let g = null;
    try { g = sv && sv.mode === this.mode && Game.fromJSON(sv.game); } catch (err) { console.error('[cup-baseball] saved game unreadable', err); }
    if (!g || g.over) return false;
    this.clearTimers();
    this.throwState = null;
    this.recorded = false;
    this.cfg = { diff: sv.cfg.diff };
    this.game = g;
    this.names = this.namesFor(this.mode);
    this._fly = null;
    const R = this.engine.rend;
    R.flash('a', null); R.flash('b', null);
    const hint = this.root.querySelector('.cb-hint');
    if (hint) hint.hidden = true;
    this.paintHud();
    this.busy = true;
    const f = sv.fly;
    // whose throw it can be: the computer bats from the far end, everyone else from this one
    const shooter = this.mode === 'cpu' && g.batting === 'b' ? 'b' : 'a';
    this.later(() => {
      if (flyOk(f) && f.s === shooter) { this.reFly(f); return; }
      if (this.mode === 'pass') { this.askPass(); return; }
      this.toast(t('up', { name: this.names[g.batting] }), 1400);
      this.beginTurn();
    }, 600);
    return true;
  }

  /** A throw that was in the air when the game was left, flown again from its launch. */
  reFly(f) {
    const R = this.engine.rend;
    R.setView(f.s === 'b' ? 'defend' : 'shoot');
    if (f.s === 'b') R.hideBall();
    this.busy = true;
    this.shooter = f.s;
    this.throwState = this.engine.phys.startThrow({ power: +f.p, aim: +f.a, cups: CUPS });
    this.saveGame({ s: f.s, p: +f.p, a: +f.a });
  }

  /** The game as it stands (`fly`: a throw in the air). A finished game leaves no save. */
  saveGame(fly = null) {
    const g = this.game;
    if (!g || !this.cfg || this.recorded || !(this.mode === 'cpu' || this.mode === 'pass')) return;
    this._fly = fly;
    if (g.over) { clearSave(); return; }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), mode: this.mode, cfg: this.cfg, game: g.toJSON(), fly }));
    } catch (err) { console.error('[cup-baseball] game not saved', err); }
  }

  /** The batter's next throw: the player's ball on the table, or the computer lining up. */
  beginTurn() {
    const g = this.game;
    if (!g || g.over || !this.engine) return;
    const R = this.engine.rend;
    this.paintHud();
    const cpuUp = this.mode === 'cpu' && g.batting === 'b';
    R.setView(cpuUp ? 'defend' : 'shoot');
    if (cpuUp) {
      const hint = this.root.querySelector('.cb-hint');
      if (hint) hint.hidden = true;
      R.hideBall();
      this.busy = true;
      this.later(() => this.cpuShoot(), CPU_PAUSE_MS);
      return;
    }
    R.showRestBall(false);
    this.busy = false;
  }

  /** Two players on one phone: the phone is handed over at every switch. */
  askPass() {
    const el = this.root.querySelector('.cb-pass');
    if (!el) return;
    this.busy = true;
    this.engine.rend.hideBall();
    el.querySelector('b').textContent = t('passTo', { name: this.names[this.game.batting] });
    el.hidden = false;
  }
  passTaken() {
    const el = this.root.querySelector('.cb-pass');
    if (el) el.hidden = true;
    this.beginTurn();
  }

  cpuShoot() {
    const g = this.game;
    if (!g || g.over || g.batting !== 'b' || this.mode !== 'cpu' || !this.engine) return;
    const th = this.engine.cpu.cpuThrow(this.cfg.diff);
    this.shooter = 'b';
    this.throwState = this.engine.phys.startThrow({ power: th.power, aim: th.aim, cups: CUPS });
    this.saveGame({ s: 'b', p: th.power, a: th.aim });   // leaving cannot take the computer's throw back
  }

  /** Whose cups a throw in the air is going at: the computer throws from the far end at side a's. */
  get rackSide() { return this.shooter === 'b' ? 'a' : 'b'; }

  /** A throw has resolved: the rules decide, the screen says it, what comes next waits. `touched` =
   *  the ball hit the table or a cup (no cup = a strike); a ball that touched neither is an out. */
  applyThrow(outcome, touched) {
    const g = this.game;
    const made = outcome && outcome.kind === 'made' ? outcome.id : null;
    const batting = g.batting;
    const ev = g.throwResult(made ? hitOf(made) : 0, !!touched);
    this.throwState = null;
    this.saveGame();   // the throw has landed (a finished game clears the save)
    const hint = this.root.querySelector('.cb-hint');
    if (hint) hint.hidden = true;
    const hit = ev.find((e) => e.type === 'hit');
    const switched = ev.some((e) => e.type === 'side');
    const won = ev.find((e) => e.type === 'win');
    const extra = ev.some((e) => e.type === 'extra');
    const out = ev.some((e) => e.type === 'out');
    let word;
    if (hit) {
      word = t(HIT_WORD[hit.n]);
      if (hit.runs) word += ' ' + (hit.runs === 1 ? t('runs1') : t('runsN', { n: hit.runs }));
      if (won) word = t('walkOff') + ' ' + word;
    } else if (!out) word = t('strike');
    else word = switched || won ? t('outs2') : t('out');
    this.toast(word, hit ? 1500 : 1100);
    this.paintHud();
    if (won) { this.finish(); return; }
    const R = this.engine.rend;
    if (switched) {
      this.later(() => {
        R.flash('a', null); R.flash('b', null);
        if (this.mode === 'pass') { this.askPass(); return; }
        this.toast(extra ? t('extra') : t('up', { name: this.names[g.batting] }), 1400);
        this.beginTurn();
      }, SWITCH_MS);
      return;
    }
    this.later(() => { R.flash('a', null); R.flash('b', null); this.beginTurn(); }, made ? SETTLE_MS + 500 : SETTLE_MS);
  }

  finish() {
    const g = this.game;
    this.busy = true;
    if (!this.recorded) {
      // The save goes first, so a continued game can never be finished and counted a second time.
      clearSave();
      this.recorded = true;
      if (this.mode === 'cpu') {
        const lost = quitLossLost('cupbaseball');   // already counted as a loss (its armed marker was settled while this page was frozen 30+ minutes, 2026-10-29)
        dropQuitLoss('cupbaseball');   // the real result replaces the armed quit loss
        // ONCE per game: every write in the shared store is additive, so a second call inflates.
        if (!lost) try {
          const diff = this.cfg.diff;
          const st = withMode(() => (modeOf(g)), diff, () => recordResult('cupbaseball', diff, g.winner === 'a'));
          if (!st) console.warn('[cup-baseball] result not recorded (rate gate or store refused it)');
        } catch (err) { console.error('[cup-baseball] record failed', err); }
      }
      this.settings.nextFirst = g.first === 'a' ? 'b' : 'a';
      writeSettings(this.settings);
    }
    this.paintHud();
    this.later(() => this.showGameOver(), 1300);
  }

  /** The line score: each inning's runs, then the total. */
  lineHTML() {
    const g = this.game;
    const n = Math.max(g.innings, g.line.a.length, g.line.b.length);
    const cols = Array.from({ length: n }, (_, i) => i);
    const row = (s) => `<tr><th>${escapeHTML(this.names[s])}</th>${cols.map((i) => `<td>${g.line[s][i] == null ? (g.over && i < n ? '–' : '') : g.line[s][i]}</td>`).join('')}<td class="cb-r">${g.runs[s]}</td></tr>`;
    return `<table class="cb-line"><thead><tr><th></th>${cols.map((i) => `<td>${i + 1}</td>`).join('')}<td class="cb-r">${t('runsCol')}</td></tr></thead>
      <tbody>${row(g.first)}${row(g.second)}</tbody></table>`;
  }

  showGameOver() {
    const g = this.game;
    const title = t('wins', { name: this.names[g.winner] });
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cb-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cb-card-title">${escapeHTML(title)}</h2>
        ${this.lineHTML()}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('playAgain')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="setup">${t('backSetup')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('[data-role="close"]'), 'click', () => el.remove());
    this.on(el.querySelector('[data-role="again"]'), 'click', () => { el.remove(); this.newGame(); });
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  // --- input -----------------------------------------------------------------------------------
  // THE FLICK IS SKEEBALL'S, as in Cup Pong: skeeball/js/swipe.js turns a gesture into a power,
  // clocked with e.timeStamp. Bound to the game's own pad, never to document.
  bindSwipe() {
    const pad = this.root.querySelector('.cb-swipe');
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
      this.shoot(powerOf(perH), this.aimFromSwipe(first, last));
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

  /** AIM FOLLOWS YOUR FINGER (Cup Pong's aimFromSwipe): the flick's direction on screen is carried
   *  up to the line of cups on screen and unprojected onto the table. */
  aimFromSwipe(first, last) {
    const R = this.engine && this.engine.rend;
    const dx = last.x - first.x, dy = last.y - first.y;
    if (!R || dy >= 0) return 0;
    const ball = R.project(0, THROW.y0, THROW.z0);
    const row = R.project(0, CUP.h, MID_Z);
    const k = (row.y - ball.y) / dy;
    const hit = R.unproject(ball.x + dx * k, row.y, CUP.h);
    if (!hit) return 0;
    return Math.atan2(hit.x - 0, THROW.z0 - hit.z);
  }

  /** The player's throw (either player in two-player mode: both throw from this end). */
  shoot(power, aim) {
    const g = this.game;
    if (this.busy || !this.engine || !g || g.over) return;
    if (this.mode === 'cpu' && g.batting !== 'a') return;
    this.busy = true;
    this.shooter = 'a';
    const hint = this.root.querySelector('.cb-hint');
    if (hint) hint.hidden = true;
    this.throwState = this.engine.phys.startThrow({ power, aim, cups: CUPS });
    this.saveGame({ s: 'a', p: power, a: aim });   // saved at launch: leaving cannot take a throw back
  }

  // --- the loop --------------------------------------------------------------------------------
  startLoop() {
    // Idempotent, and THE ONLY way the loop starts (skeeball, 2026-08-26).
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
      if (this.throwState) E.rend.render(st.ball, dt, this.shooter);
      else E.rend.render(null, dt, this.shooter);
      return;
    }
    E.rend.render(null, dt, this.shooter);
  }

  onEvent(ev) {
    const E = this.engine;
    if (ev.type === 'made') {
      this.later(() => E.rend.hideBall(), 60);
      E.rend.flash(this.rackSide, ev.id);
    } else if (ev.type === 'done') {
      const o = ev.outcome;
      const st = this.throwState;
      const touched = !!(st && (st.tableHits > 0 || st.touchedCup));
      this.throwState = { done: true, ball: st && st.ball };
      this.busy = true;
      this.later(() => this.applyThrow(o, touched), o.kind === 'made' ? 250 : SETTLE_MS);
    }
  }

  showPause() {
    if (this.root.querySelector('.cb-pause')) return;
    if (this.game && this.game.over) return;          // the game-over card carries its own buttons
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal cb-pause" role="dialog" aria-modal="true" aria-label="${t('paused')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="cb-card-title">${t('paused')}</h2>
        ${this.game ? this.lineHTML() : ''}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${t('newGame')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="setup">${t('backSetup')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    // The sheet really pauses: a ball in the air freezes and carries on after.
    this.stopLoop();
    const close = () => { el.remove(); if (!this.disposed) this.startLoop(); };
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    // A new game throws this one away (a loss once anyone has thrown vs the computer, asked twice);
    // Change settings keeps it saved for Continue.
    this.on(el.querySelector('[data-role="new"]'), 'click', (e) => this.quitGate(e.currentTarget, () => {
      this.takeQuit();
      el.remove();
      const pass = this.root.querySelector('.cb-pass');
      if (pass) pass.hidden = true;
      if (this.engine) this.newGame();
      if (!this.disposed) this.startLoop();
    }));
    this.on(el.querySelector('[data-role="setup"]'), 'click', () => { el.remove(); this.renderSetup(); });
  }

  /** The game vs the computer a new one would THROW AWAY, once any throw was made in it: the one on the
   *  table, or (from the setup screen) the saved one. Null when there is nothing to lose. */
  quitPending() {
    const g = this.game;
    if (g) {
      return this.mode === 'cpu' && !g.over && !this.recorded && this.cfg && (g.throws > 0 || !!this._fly)
        ? { diff: this.cfg.diff, g } : null;
    }
    const sv = readSave();
    return savedMoved(sv) ? { diff: sv.cfg.diff, g: Game.fromJSON(sv.game) } : null;
  }
  quitCostsLoss() { return !!this.quitPending(); }

  /** Record that loss, once: the save goes first, then the loss through the quit-loss marker (armed and
   *  taken at once, so the play log says it was a quit), through the game's own recorder. */
  takeQuit() {
    const q = this.quitPending();
    clearSave();   // every caller starts a new game at once, which saves itself
    if (!q) return;
    if (this.game) this.recorded = true;
    const qg = q.g;
    armQuitLoss('cupbaseball', 'recordResult', ['cupbaseball', q.diff, false], modeTag(() => (modeOf(qg)), q.diff));
    if (!takeQuitLoss('cupbaseball')) console.error('[cup-baseball] the thrown-away game was not recorded as a loss');
  }

  /** A button that would quit such a game asks twice, saying it counts as a loss. */
  quitGate(btn, go) {
    if (!this.quitCostsLoss() || btn.dataset.armed === '1') { go(); return; }
    btn.dataset.armed = '1';
    btn.textContent = t('quitLoss');
  }

  teardownEngine() {
    this.stopLoop();
    this.clearTimers();
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    if (this.engine && this.engine.rend) {
      const r = this.engine.rend;
      try { r.dispose(); } catch {}
      // dispose() leaves the WebGL context alive; only forceContextLoss() hands it back.
      try { r.renderer && r.renderer.forceContextLoss(); } catch {}
      try { r.renderer && r.renderer.dispose(); } catch {}
    }
    this.engine = null;
    this.throwState = null;
    this.busy = false;
  }

  destroy() {
    // Leaving costs nothing: the game is saved (Continue on the setup screen).
    this.disposed = true;
    try { if (window.__cbTest === this) delete window.__cbTest; } catch {}
    clearTimeout(this._toastT);
    this.teardownEngine();
    this.unbindAll();
    this.root.classList.remove('cb-root');
    this.root.innerHTML = '';
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch {} }
  // A marker armed by a build from before the save (2026-11-06): that game is gone (it had no save),
  // so under the rule it was played by, it is a loss. This build arms none it does not take at once.
  takeQuitLoss('cupbaseball');
  instance = new CupBaseball(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE AUTOSAVE MEANING of the contract (2026-11-06): a game in progress is saved (Continue on the
 *  setup screen), so leaving loses nothing: false. No `quitCostsLoss` export: the hub's back never
 *  costs a loss here. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
