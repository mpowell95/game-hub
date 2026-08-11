// skeeball/js/ui.js - Skeeball's DOM shell: setup screen, the canvas alley and its rAF loop, the
// flick input, the opponent's turn, the handover card, the end modal, autosave and stats.
// The engine (game.js) owns every rule; render.js owns every pixel; this file owns the clock, the
// input and the screens.
//
// isInProgress(): the AUTOSAVE/RESUME meaning (root CLAUDE.md, "The module contract"). Skeeball is
// strictly turn-based with no clock of its own, so leaving mid-rack is lossless: every completed
// throw snapshots to `gamehub.skeeball.save.v1` and the setup screen offers Resume. It therefore
// returns FALSE during solo play even mid-game, like every other resumable module game, and the
// hub does not nag on the way out.

import { Game, BALLS_PER_ROUND, ROUND_OPTIONS, DIFFS, MULTIPLIER, resolveThrow } from './game.js';
import * as R from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordSkeeball, loadStats } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onViewportResize } from '../../js/viewport.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.skeeball.v1';
const SAVE_KEY = 'gamehub.skeeball.save.v1';

// Flick calibration: a full-power throw is a flick up 42% of the canvas height; a full-tilt aim is
// 30% of its width sideways. Fractions of the canvas, never pixels, so the feel is the same on a
// small phone and a tall one.
const POWER_SPAN = 0.42;
const AIM_SPAN = 0.30;
const MIN_FLICK = 0.10;        // shorter than this is a tap, not a throw

const ROLL_MS = 720;           // at zero power; a hard throw is faster (see _throw)
const BOARD_MS = 260;
const DROP_MS = 200;
const POPUP_MS = 850;
const AI_THINK_MS = 620;

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (err) { console.error('[skeeball] write failed', k, err); }
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Last-used settings beat the profile's opponent skill beat the defaults. */
function loadSettings() {
  const saved = readJSON(SETTINGS_KEY);
  const rounds = saved && ROUND_OPTIONS.includes(saved.rounds) ? saved.rounds : 1;
  if (saved && DIFFS.includes(saved.difficulty)) return { difficulty: saved.difficulty, rounds };
  let skillDiff = null;
  try {
    const p = loadProfile();
    const skill = p && p.opponents && p.opponents[0] ? p.opponents[0].skill : null;
    skillDiff = skill === 1 ? 'easy' : skill === 3 ? 'hard' : skill === 2 ? 'medium' : null;
  } catch { /* no profile is fine - defaults-only, never a crash */ }
  return { difficulty: skillDiff || 'medium', rounds };
}

/** The opponent's name/emoji come from the shared profile (defaults-only, never written back). */
function loadOpponent() {
  try {
    const p = loadProfile();
    const o = p && p.opponents && p.opponents[0];
    if (o && o.name) return { name: o.name, emoji: o.emoji || '🤖' };
  } catch { /* fall through */ }
  return { name: 'Bot', emoji: '🤖' };
}

function loadMe() {
  try {
    const p = loadProfile();
    if (p && p.name) return { name: p.name, emoji: p.emoji || '🙂' };
  } catch { /* fall through */ }
  return { name: t('you'), emoji: '🙂' };
}

function bestScore() {
  try { return ((loadStats().games.skeeball || {}).sk || {}).bestGame | 0; }
  catch { return 0; }
}

let instance = null;

class SkeeballUI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.opp = loadOpponent();
    this.me = loadMe();
    this.game = null;
    this.screen = 'setup';
    this.raf = 0;
    this.flight = null;
    this.popup = null;
    this.drag = null;
    this.aiTimer = 0;
    this.recorded = false;
    this._ensureCss();

    this._onVis = () => { if (document.hidden) this._save(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._offLang = onLangChange(() => this._rerenderForLang());
    this._offResize = onViewportResize(() => this._fit());

    this.renderSetup();
  }

  _ensureCss() {
    const href = new URL('../css/skeeball.css', import.meta.url).href;
    if (![...document.styleSheets].some((s) => s.href === href) &&
        !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  // --- setup ---------------------------------------------------------------------------------

  renderSetup() {
    this._stopLoop();
    this._clearAiTimer();
    this.screen = 'setup';
    this.game = null;
    const d = this.settings.difficulty;
    const r = this.settings.rounds;
    const resumable = Game.restore(readJSON(SAVE_KEY));
    const seg = (attr, id, label, extra) => `
      <button type="button" class="sk-seg${String(this.settings[attr]) === String(id) ? ' is-on' : ''}"
        data-${attr}="${id}" aria-pressed="${String(this.settings[attr]) === String(id)}">${extra || ''}${label}</button>`;

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-setup">
          <h2 class="sk-title">${t('title')}</h2>
          <p class="sk-tag">${t('tagline')}</p>
          <div class="sk-field">
            <span class="sk-label">${t('difficulty')}</span>
            <div class="sk-segrow" role="group" aria-label="${t('difficulty')}">
              ${seg('difficulty', 'easy', t('diff_easy'), diffShapeSVG(tierOf('easy')))}
              ${seg('difficulty', 'medium', t('diff_medium'), diffShapeSVG(tierOf('medium')))}
              ${seg('difficulty', 'hard', t('diff_hard'), diffShapeSVG(tierOf('hard')))}
            </div>
          </div>
          <div class="sk-field">
            <span class="sk-label">${t('rounds')}</span>
            <div class="sk-segrow" role="group" aria-label="${t('rounds')}">
              ${seg('rounds', 1, t('rounds_1'))}${seg('rounds', 3, t('rounds_3'))}
            </div>
            <p class="sk-hint-line">${t('rounds_hint')}</p>
          </div>
          ${resumable && !resumable.over ? `<button type="button" class="sk-play" data-role="resume">${t('resume')}</button>` : ''}
          <button type="button" class="sk-play${resumable && !resumable.over ? ' sk-play--alt' : ''}"
            data-role="start-ai">${t('play')}</button>
          <button type="button" class="sk-howto" data-role="howto">${t('howto')}</button>
        </div>
      </div>`;
    // `start-ai` rather than a name of this game's own choosing: it is one of the selectors
    // test-visual.mjs taps to get PAST a setup screen, and a setup screen is not the layout its
    // fit and play probes exist to check.

    this.root.querySelectorAll('.sk-segrow').forEach((row) => {
      row.addEventListener('click', (e) => {
        const b = e.target.closest('[data-difficulty], [data-rounds]');
        if (!b || !row.contains(b)) return;
        if (b.dataset.difficulty) this.settings.difficulty = b.dataset.difficulty;
        else this.settings.rounds = Number(b.dataset.rounds);
        writeJSON(SETTINGS_KEY, this.settings);
        row.querySelectorAll('.sk-seg').forEach((x) => {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
      });
    });
    this.root.querySelector('[data-role="start-ai"]').addEventListener('click', () => this.startGame());
    const res = this.root.querySelector('[data-role="resume"]');
    if (res) res.addEventListener('click', () => this.startGame(Game.restore(readJSON(SAVE_KEY))));
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this.openHelp());
  }

  openHelp() {
    // The repo's how-to-play pattern (tic-tac-toe/CLAUDE.md): the goal, then only the mechanics a
    // player cannot guess - the flick, what happens at both ends of the power range, and the two
    // things this game has that plain skeeball does not (the corner cups' bank shot, the x3 badge).
    const host = document.createElement('div');
    host.className = 'sk-root sk-help-overlay';
    host.innerHTML = `
      <div class="sk-scrim" data-role="close"></div>
      <div class="sk-help" role="dialog" aria-modal="true" aria-label="${t('aria_help')}">
        <button type="button" class="sk-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <p class="sk-help-goal"><strong>${t('help_goal')}</strong></p>
        <svg class="sk-help-art" viewBox="0 0 200 96" aria-hidden="true">
          <path d="M28 92 L74 26 h52 l46 66 z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
          <ellipse cx="100" cy="30" rx="26" ry="7" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="100" cy="43" rx="34" ry="9" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="100" cy="58" rx="43" ry="11" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="58" cy="27" rx="10" ry="5" fill="none" stroke="currentColor" stroke-width="3"/>
          <ellipse cx="142" cy="27" rx="10" ry="5" fill="none" stroke="currentColor" stroke-width="3"/>
          <path d="M100 88 v-18" stroke="currentColor" stroke-width="3" stroke-dasharray="5 4"/>
          <path d="M94 76 l6 -8 l6 8" fill="currentColor"/>
          <circle cx="100" cy="88" r="7" fill="currentColor"/>
        </svg>
        <p class="sk-help-line">${t('help_flick')}</p>
        <p class="sk-help-line">${t('help_rings')}</p>
        <p class="sk-help-line">${t('help_cups')}</p>
        <p class="sk-help-line">${t('help_mult')}</p>
      </div>`;
    host.addEventListener('click', (e) => { if (e.target.closest('[data-role="close"]')) host.remove(); });
    document.body.appendChild(host);
  }

  // --- the game screen -------------------------------------------------------------------------

  startGame(restored) {
    this.screen = 'game';
    this.game = restored || new Game({ rounds: this.settings.rounds, difficulty: this.settings.difficulty });
    if (restored) {
      // A resumed match keeps the rules it was started with, whatever the setup screen now says.
      this.settings.rounds = this.game.rounds;
      this.settings.difficulty = this.game.difficulty;
    }
    this.recorded = false;
    this.flight = null;
    this.popup = null;
    this.pending = null;
    this.drag = null;
    this.best = bestScore();
    this.phase = 'aim';

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-game" data-role="game">
          <canvas class="sk-canvas" data-role="canvas" aria-label="${t('aria_lane')}"></canvas>
          <div class="sk-hud" aria-label="${t('aria_scores')}">
            <div class="sk-pill" data-role="pill-you">
              <span class="sk-av">${this.me.emoji}</span><b data-role="score-you">0</b>
            </div>
            <div class="sk-mid">
              <span class="sk-round" data-role="round"></span>
              <span class="sk-balls" data-role="balls"></span>
            </div>
            <div class="sk-pill" data-role="pill-opp">
              <b data-role="score-opp">0</b><span class="sk-av">${this.opp.emoji}</span>
            </div>
          </div>
          <p class="sk-hint" data-role="hint">${t('drag_to_throw')}</p>
          <div class="sk-band" data-role="band" hidden></div>
        </div>
      </div>`;

    this.gameEl = this.root.querySelector('[data-role="game"]');
    this.canvas = this.root.querySelector('[data-role="canvas"]');
    this.hintEl = this.root.querySelector('[data-role="hint"]');
    this.bandEl = this.root.querySelector('[data-role="band"]');
    this.ctx = this.canvas.getContext('2d');

    this._bindInput();
    this._fit();
    this._paintHud();
    this._startLoop();
    if (this.game.over) this._finish();
    else if (this.game.turn === 'opp') this._scheduleAi();
  }

  /** Pin the game box to the space actually available, measured rather than assumed.
   *
   *  The height is collapsed to 0 FIRST so that whatever we set last time cannot be the reason the
   *  page is scrolled while we measure - `getBoundingClientRect().top` is viewport-relative, and
   *  measuring it against our own overflow is exactly the mistake VISUAL-PROCESS.md section 3c
   *  records (it computed a zero correction and left the page scrollable). This is also why the
   *  root never asks for `100dvh`: in the hub the same element sits under ~98px of floating-back-
   *  button padding, so a viewport-height request is guaranteed to overflow there. */
  _fit() {
    if (!this.gameEl || !this.canvas) return;
    this.gameEl.style.height = '0px';
    const top = this.gameEl.getBoundingClientRect().top;
    let avail = Math.max(280, Math.floor((window.innerHeight || 640) - top - 6));
    this.gameEl.style.height = `${avail}px`;

    // Everything ABOVE us is now accounted for, but anything BELOW us still counts toward the page
    // height and is invisible to the measurement above: the hub gives `.hub-main` 40px of
    // padding-bottom, which is exactly the 34px (40 minus our own 6px gap) this game overflowed
    // the hub by, at every viewport height, while fitting standalone perfectly. So measure what is
    // ACTUALLY left over and take it off, rather than hard-coding a chrome budget that goes stale
    // the next time the hub's padding changes (VISUAL-PROCESS.md 3c: measure the distance, not a
    // particular ancestor's style).
    const over = (document.documentElement.scrollHeight - (window.innerHeight || 640));
    if (over > 0) {
      avail = Math.max(280, avail - over);
      this.gameEl.style.height = `${avail}px`;
    }

    const w = this.gameEl.clientWidth || 320;
    const h = avail;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.layout = R.layoutFor(w, h);
    this.dpr = dpr;
    this._buildAlley();
  }

  /** The alley never changes between throws, so it is painted once per resize into an offscreen
   *  canvas and blitted each frame. Everything moving is drawn on top of the blit. */
  _buildAlley() {
    const { scale, ox, oy } = this.layout;
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#1B1B1F';
    g.fillRect(0, 0, this.layout.w, this.layout.h);
    g.save();
    g.translate(ox, oy);
    g.scale(scale, scale);
    R.drawAlley(g);
    g.restore();
    this.alley = c;
  }

  // --- input -----------------------------------------------------------------------------------

  _bindInput() {
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this._onDown = (e) => {
      if (this.phase !== 'aim' || !this.game || this.game.turn !== 'you' || this.game.over) return;
      const p = pos(e);
      this.drag = { x0: p.x, y0: p.y, power: 0, aim: 0 };
      cv.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!this.drag) return;
      const p = pos(e);
      const h = this.layout.h || 1, w = this.layout.w || 1;
      this.drag.power = clamp((this.drag.y0 - p.y) / (POWER_SPAN * h), 0, 1);
      this.drag.aim = clamp((p.x - this.drag.x0) / (AIM_SPAN * w), -1, 1);
    };
    this._onUp = () => {
      if (!this.drag) return;
      const { power, aim } = this.drag;
      this.drag = null;
      if (power < MIN_FLICK) return;      // a tap, or a flick that never went anywhere
      this._throw(power, aim);
    };
    cv.addEventListener('pointerdown', this._onDown);
    cv.addEventListener('pointermove', this._onMove);
    cv.addEventListener('pointerup', this._onUp);
    cv.addEventListener('pointercancel', this._onUp);

    // Non-passive, and bound to the GAME'S OWN ROOT rather than to document: a document-level
    // touchmove turns off compositor scrolling for the whole page for as long as this game is
    // mounted (js/CLAUDE.md, and snake/CLAUDE.md's note). A touchmove is dispatched at the element
    // the touch started on and bubbles, so root scoping loses nothing.
    this._onTouchMove = (e) => { if (this.drag) e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
  }

  // --- throwing ----------------------------------------------------------------------------------

  /** Build the flight plan for a throw and hand the throw to the engine.
   *
   *  The engine resolves the score FIRST and the animation is derived from the same resolved
   *  numbers (`res.offset`, `res.energy`), so what the ball is drawn doing and what the scoreboard
   *  says can never disagree - the reason `resolveThrow` is pure and the UI never re-simulates. */
  _throw(power, aim) {
    if (!this.game || this.game.over || this.phase !== 'aim') return;
    const preview = resolveThrow(power, aim);
    const out = this.game.throwBall(power, aim);
    if (!out) return;

    const short = out.kind === 'short';
    const vEnd = short ? clamp(preview.energy / 0.28, 0.15, 1) * 0.88 : 1;
    this.flight = {
      aim, out,
      vEnd,
      short,
      t0: performance.now(),
      rollMs: ROLL_MS - power * 260,
      backMs: short ? 520 : 0,
      boardMs: short ? 0 : BOARD_MS,
      dropMs: short ? 0 : DROP_MS,
    };
    // Hold the points back until the ball LANDS. The engine has already applied them (it resolves
// first, so the animation can be derived from the same numbers), but showing them the instant the
// flick is released tells the player the answer while the ball is still rolling and throws away
// the only suspense the game has.
    this.pending = { thrower: out.thrower, scored: out.scored };
    this.phase = 'flight';
    this.hintEl.hidden = true;
    this._paintHud();
  }

  /** Where the ball is right now, or null once the flight is done. */
  _ballNow(now) {
    const f = this.flight;
    if (!f) return null;
    const el = now - f.t0;
    const foldU = (v) => {
      let u = f.aim * 1.35 * v;
      while (Math.abs(u) > 1) u = Math.sign(u) * (2 - Math.abs(u));
      return u;
    };

    if (el < f.rollMs) {
      // Rolling up the lane, decelerating slightly - a ball loses speed to the boards. Part
      // ease-out, part linear, so it slows without ever looking like it stalls near the top.
      const k = el / f.rollMs;
      const v = f.vEnd * (k * (2 - k) * 0.55 + k * 0.45);
      const p = R.lanePoint(v, foldU(v));
      return { ...p, v };
    }
    if (f.short) {
      const k = clamp((el - f.rollMs) / f.backMs, 0, 1);
      const v = f.vEnd * (1 - k) - 0.12 * k;
      const p = R.lanePoint(Math.max(-0.12, v), foldU(Math.max(0, v)));
      return { ...p, v, fading: k > 0.8 ? (k - 0.8) / 0.2 : 0 };
    }
    if (el < f.rollMs + f.boardMs) {
      // Up onto the board and into its hole, arcing slightly as it climbs the ramp.
      const k = (el - f.rollMs) / f.boardMs;
      const from = R.lanePoint(1, foldU(1));
      const to = R.targetPoint(f.out.target || '10');
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 22;
      return { x, y, r: from.r * (1 - k * 0.42), v: 1 };
    }
    const k = clamp((el - f.rollMs - f.boardMs) / f.dropMs, 0, 1);
    const to = R.targetPoint(f.out.target || '10');
    const from = R.lanePoint(1, foldU(1));
    return { x: to.x, y: to.y + k * 8, r: from.r * 0.58 * (1 - k), v: 1 };
  }

  _flightDone(now) {
    const f = this.flight;
    if (!f) return false;
    return (now - f.t0) >= f.rollMs + f.backMs + f.boardMs + f.dropMs;
  }

  _landed() {
    const out = this.flight.out;
    this.flight = null;
    this.pending = null;
    this.popup = {
      t0: performance.now(),
      target: out.target || '10',
      text: out.kind === 'short' ? t('short')
        : out.kind === 'over' ? t('over')
          : `${out.scored}${out.multiplied ? '!' : ''}`,
    };
    this.phase = 'popup';
    this._paintHud();
    this._save();
  }

  _afterPopup() {
    this.popup = null;
    if (this.game.over) { this._finish(); return; }
    // A rack just ended if the engine reset the ball counter.
    const handover = this.game.ball === 1;
    if (handover) { this._showBand(); return; }
    this.phase = 'aim';
    if (this.game.turn === 'opp') this._scheduleAi();
    else this.hintEl.hidden = false;
    this._paintHud();
  }

  /** "You scored N points", the reference's own turn handover. Tap (or wait) to carry on. */
  _showBand() {
    const justThrew = this.game.turn === 'opp' ? 'you' : 'opp';
    const name = justThrew === 'you' ? this.me.name : this.opp.name;
    const n = this.game.scores[justThrew];
    this.phase = 'band';
    this.bandEl.innerHTML = `
      <span class="sk-band-line">${t('scored_points', { name, n })}</span>
      <span class="sk-band-sub">${t('tap_continue')}</span>`;
    this.bandEl.hidden = false;
    const go = () => {
      this.bandEl.hidden = true;
      this.bandEl.removeEventListener('click', go);
      clearTimeout(this._bandTimer);
      this.phase = 'aim';
      this._paintHud();
      if (this.game.turn === 'opp') this._scheduleAi();
      else this.hintEl.hidden = false;
    };
    this.bandEl.addEventListener('click', go);
    this._bandTimer = setTimeout(go, 1900);
  }

  _scheduleAi() {
    this._clearAiTimer();
    this.hintEl.hidden = true;
    this._paintHud();
    this.aiTimer = setTimeout(() => {
      this.aiTimer = 0;
      if (!this.game || this.game.over || this.game.turn !== 'opp' || this.phase !== 'aim') return;
      const plan = this.game.aiPlan();
      this._throw(plan.power, plan.aim);
    }, AI_THINK_MS);
  }

  _clearAiTimer() { if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = 0; } }

  // --- hud, loop, end ------------------------------------------------------------------------------

  _paintHud() {
    if (!this.game || this.screen !== 'game') return;
    const q = (s) => this.root.querySelector(`[data-role="${s}"]`);
    const held = (k) => this.game.scores[k] - (this.pending && this.pending.thrower === k ? this.pending.scored : 0);
    const you = q('score-you'), opp = q('score-opp');
    if (you) you.textContent = held('you');
    if (opp) opp.textContent = held('opp');
    const round = q('round');
    if (round) {
      round.textContent = this.game.rounds > 1
        ? t('round_of', { n: this.game.round, total: this.game.rounds }) : '';
    }
    const balls = q('balls');
    if (balls) {
      balls.textContent = this.game.over ? ''
        : this.game.turn === 'you' ? t('balls_left', { n: this.game.ballsLeft })
          : t('opp_turn', { name: this.opp.name });
    }
    const py = q('pill-you'), po = q('pill-opp');
    if (py) py.classList.toggle('is-turn', !this.game.over && this.game.turn === 'you');
    if (po) po.classList.toggle('is-turn', !this.game.over && this.game.turn === 'opp');
  }

  _startLoop() {
    this._stopLoop();
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      this._draw();
    };
    this.raf = requestAnimationFrame(frame);
  }
  _stopLoop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  _draw() {
    if (!this.ctx || !this.alley || !this.game) return;
    const now = performance.now();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.alley, 0, 0);

    const { scale, ox, oy } = this.layout;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.save();
    c.translate(ox, oy);
    c.scale(scale, scale);

    R.drawQueue(c, this.game.over ? 0 : this.game.ballsLeft - (this.flight ? 1 : 0));

    if (!this.game.over && (this.phase === 'aim' || this.phase === 'flight')) {
      R.drawMultiplier(c, this.game.multTarget, 0.5 + 0.5 * Math.sin(now / 320));
    }

    if (this.flight) {
      const b = this._ballNow(now);
      if (b) {
        if (b.fading) c.globalAlpha = 1 - b.fading;
        R.drawBall(c, b.x, b.y, b.r);
        c.globalAlpha = 1;
      }
      if (this._flightDone(now)) this._landed();
    }

    if (this.popup) {
      const k = (now - this.popup.t0) / POPUP_MS;
      if (k >= 1) this._afterPopup();
      else R.drawPopup(c, this.popup.target, this.popup.text, k);
    }

    if (this.drag && this.drag.power > 0.02) R.drawAimGuide(c, this.drag.power, this.drag.aim);

    c.restore();
  }

  _save() {
    if (!this.game) return;
    if (this.game.over) { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } return; }
    writeJSON(SAVE_KEY, this.game.snapshot());
  }

  _finish() {
    this.phase = 'over';
    this._clearAiTimer();
    this.hintEl.hidden = true;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* a stale save only costs a stale Resume */ }

    // Record ONCE, before the modal, so a fast "play again" can never skip it.
    if (!this.recorded) {
      this.recorded = true;
      const g = this.game;
      try {
        recordSkeeball(g.difficulty, g.winner === 'tie' ? null : g.winner === 'you', {
          score: g.scores.you,
          balls: g.tally.balls,
          hundreds: g.tally.hundreds,
          fifties: g.tally.fifties,
          bestThrow: g.tally.bestThrow,
        });
      } catch (err) { console.error('[skeeball] stats record failed - this game is not counted', err); }
    }

    const g = this.game;
    const newBest = g.scores.you > (this.best | 0);
    const head = g.winner === 'you' ? t('you_won')
      : g.winner === 'tie' ? t('tie') : t('you_lost', { name: this.opp.name });
    const modal = document.createElement('div');
    modal.className = 'sk-modal';
    modal.innerHTML = `
      <div class="sk-modal-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="sk-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <h3 class="sk-modal-h">${head}</h3>
        <p class="sk-modal-score">${t('final_score', { you: g.scores.you, opp: g.scores.opp })}</p>
        ${newBest ? `<p class="sk-modal-line"><b>${t('new_best')}</b></p>` : ''}
        <div class="sk-modal-actions">
          <button type="button" class="sk-play" data-role="again">${t('play_again')}</button>
          <button type="button" class="sk-howto" data-role="setup">${t('change_setup')}</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="again"]')) { modal.remove(); this.startGame(); }
      else if (e.target.closest('[data-role="setup"]')) { modal.remove(); this.renderSetup(); }
      else if (e.target.closest('[data-role="close"]')) modal.remove();   // X: dismiss, no forced rematch
    });
    this.gameEl.appendChild(modal);
  }

  _rerenderForLang() {
    this.me = loadMe();
    if (this.screen === 'setup') { this.renderSetup(); return; }
    const hint = this.root.querySelector('[data-role="hint"]');
    if (hint) hint.textContent = t('drag_to_throw');
    const cv = this.root.querySelector('[data-role="canvas"]');
    if (cv) cv.setAttribute('aria-label', t('aria_lane'));
    this._paintHud();
  }

  destroy() {
    this._stopLoop();
    this._clearAiTimer();
    clearTimeout(this._bandTimer);
    this._save();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._onDown);
      this.canvas.removeEventListener('pointermove', this._onMove);
      this.canvas.removeEventListener('pointerup', this._onUp);
      this.canvas.removeEventListener('pointercancel', this._onUp);
    }
    if (this._onTouchMove) this.root.removeEventListener('touchmove', this._onTouchMove);
    if (this._offLang) this._offLang();
    if (this._offResize) this._offResize();
    document.querySelectorAll('.sk-help-overlay').forEach((n) => n.remove());
    this.root.innerHTML = '';
    this.game = null;
    this.alley = null;
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
/** Autosave/resume meaning (see the file header): solo play is lossless to leave, so this is
 *  always false. Every throw snapshots, and the setup screen offers Resume on the way back in. */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
