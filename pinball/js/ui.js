// pinball/js/ui.js - the DOM shell, the input, and the hub module contract.
//
// Three screens, all mounted into the single container the hub hands us:
//   SETUP   table choice, sound, personal best, how to play
//   PLAY    the canvas (render.js) under a fixed HUD: score, ball, the dot-matrix display, the
//           mission timer, and the launch / nudge / pause controls
//   OVER    the final score and what the game was made of, with a close X (root CLAUDE.md's rule
//           for every win/lose panel)
//
// This file owns the clock and every listener. The rules live in game.js, the table in table.js,
// the solver in physics.js, the pixels in render.js, the noise in audio.js. Nothing here computes
// physics or scoring; it reads game.js's event stream once a frame and turns it into sound,
// particles, popups and text.
//
// isInProgress(): the LITERAL meaning (root CLAUDE.md, "The module contract") - the same class as
// Ball Run, Snake and Hill Climb. A ball in flight cannot be meaningfully snapshotted and resumed,
// so leaving genuinely abandons the game and the hub should confirm. The setup screen is never "in
// progress": everything there is already saved the instant it changes.

import { Pinball, MISSIONS } from './game.js';
import { Renderer, PALETTE } from './render.js';
import { Sfx } from './audio.js';
import { loadSettings, saveSettings, bestScore } from './store.js';
import { H as TH } from './table.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordPinball } from '../../js/game-stats.js';
import { syncMyStats } from '../../js/stats-net.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);

let instance = null;

/** Inject the stylesheet once, resolved relative to this module so it works standalone and in-hub
 *  alike (root CLAUDE.md, "Adding a game" item 2). */
function ensureCSS() {
  if (document.querySelector('link[data-pb-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/pinball.css', import.meta.url).href;
  link.setAttribute('data-pb-css', '1');
  document.head.appendChild(link);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();

const DIFF_ORDER = ['easy', 'medium', 'hard'];

export class PinballUI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.sfx = new Sfx(this.settings.sound);
    this.game = null;
    this.renderer = null;
    this.raf = 0;
    this.last = 0;
    this.paused = false;
    this.screen = 'setup';
    this.messages = [];
    this.msgUntil = 0;
    this.msgText = '';
    this.pointerSides = new Map();
    this.recorded = false;

    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onPointerUp = (e) => this._releasePointer(e);
    this._onVis = () => { if (document.visibilityState === 'hidden' && this.screen === 'play') this._setPaused(true); };
    this._loop = (ts) => this._frame(ts);

    ensureCSS();
    this.root.classList.add('pb-root');
    this.root.innerHTML = '';

    this._unsubLang = onLangChange(() => this._relabel());
    this._unsubViewport = onViewportResize(() => this._fit());

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    document.addEventListener('visibilitychange', this._onVis);

    this._renderSetup();
  }

  // --- screens -------------------------------------------------------------------------------------

  _renderSetup() {
    this.screen = 'setup';
    this._stopLoop();
    const best = bestScore();
    const cards = DIFF_ORDER.map((d) => {
      const tier = tierOf(d);
      return `<button type="button" class="pb-diff${d === this.settings.difficulty ? ' is-on' : ''}" data-diff="${d}">
        <span class="pb-diff-top">${diffShapeSVG(tier)}<b>${esc(t(`diff_${d}`))}</b></span>
        <span class="pb-diff-note">${esc(t(`diff_${d}_note`))}</span>
      </button>`;
    }).join('');

    this.root.innerHTML = `
      <div class="pb-setup">
        <div class="pb-setup-inner">
          <div class="pb-brand">
            <span class="pb-brand-sub">${esc(t('title'))}</span>
            <span class="pb-brand-main">NOVA CADET</span>
          </div>
          <p class="pb-best">${best ? `${esc(t('your_best'))}: <b>${fmt(best)}</b>` : esc(t('no_best'))}</p>

          <h2 class="pb-h">${esc(t('setup_table'))}</h2>
          <div class="pb-diffs">${cards}</div>

          <div class="pb-row">
            <span class="pb-h pb-h-inline">${esc(t('setup_sound'))}</span>
            <button type="button" class="pb-toggle" data-role="sound" aria-pressed="${this.settings.sound}">
              ${esc(this.settings.sound ? t('sound_on') : t('sound_off'))}
            </button>
          </div>

          <button type="button" class="pb-play" data-role="play">${esc(t('play'))}</button>
          <button type="button" class="pb-link" data-role="howto">${esc(t('howto'))}</button>
        </div>
      </div>`;

    this.root.querySelectorAll('[data-diff]').forEach((el) => {
      el.addEventListener('click', () => {
        this.settings = saveSettings({ difficulty: el.dataset.diff });
        this._renderSetup();
      });
    });
    this.root.querySelector('[data-role="sound"]').addEventListener('click', () => {
      this.settings = saveSettings({ sound: !this.settings.sound });
      this.sfx.setEnabled(this.settings.sound);
      this._renderSetup();
    });
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => {
      this.sfx.resume();
      this._startGame();
    });
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this._showHowTo());
  }

  _showHowTo() {
    const secs = ['launch', 'flip', 'nudge', 'shots', 'modes'].map((k) =>
      `<section class="pb-howto-sec"><h3>${esc(t(`howto_${k}_h`))}</h3><p>${esc(t(`howto_${k}_b`))}</p></section>`).join('');
    this._overlay('howto', `
      <div class="pb-sheet-head">
        <h2>${esc(t('howto_h'))}</h2>
        <button type="button" class="pb-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
      </div>
      <div class="pb-sheet-body">${secs}</div>`);
  }

  /** One overlay helper for how-to / pause / game over. `kind` becomes a modifier class. */
  _overlay(kind, html) {
    this._closeOverlay();
    const el = document.createElement('div');
    el.className = `pb-veil pb-veil-${kind}`;
    el.innerHTML = `<div class="pb-sheet">${html}</div>`;
    this.root.appendChild(el);
    this.overlay = el;
    el.querySelectorAll('[data-role="close"]').forEach((b) => b.addEventListener('click', () => this._closeOverlay()));
    return el;
  }

  _closeOverlay() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    this.overlay = null;
  }

  _startGame() {
    this.screen = 'play';
    this.recorded = false;
    this._closeOverlay();
    this.root.innerHTML = `
      <div class="pb-play-wrap">
        <div class="pb-hud">
          <div class="pb-hud-top">
            <div class="pb-ball" data-role="ball"></div>
            <div class="pb-score" data-role="score">0</div>
          </div>
          <div class="pb-dmd">
            <div class="pb-dmd-msg" data-role="msg"></div>
            <div class="pb-dmd-sub" data-role="sub"></div>
            <div class="pb-timer" data-role="timer"><i></i></div>
          </div>
        </div>
        <div class="pb-stage" data-role="stage">
          <canvas class="pb-canvas" data-role="canvas" aria-label="${esc(t('aria_table'))}" role="img"></canvas>
          <button type="button" class="pb-zone pb-zone-l" data-side="left" aria-label="${esc(t('btn_left_flipper'))}"></button>
          <button type="button" class="pb-zone pb-zone-r" data-side="right" aria-label="${esc(t('btn_right_flipper'))}"></button>
        </div>
        <div class="pb-controls">
          <button type="button" class="pb-btn pb-btn-launch" data-role="launch">${esc(t('btn_launch'))}</button>
          <button type="button" class="pb-btn pb-btn-nudge" data-role="nudge">${esc(t('btn_nudge'))}</button>
          <button type="button" class="pb-btn pb-btn-pause" data-role="pause" aria-label="${esc(t('btn_pause'))}">II</button>
        </div>
      </div>`;

    this.el = {
      stage: this.root.querySelector('[data-role="stage"]'),
      canvas: this.root.querySelector('[data-role="canvas"]'),
      score: this.root.querySelector('[data-role="score"]'),
      ball: this.root.querySelector('[data-role="ball"]'),
      msg: this.root.querySelector('[data-role="msg"]'),
      sub: this.root.querySelector('[data-role="sub"]'),
      timer: this.root.querySelector('[data-role="timer"]'),
    };

    this.renderer = new Renderer(this.el.canvas);
    this.game = new Pinball({ difficulty: this.settings.difficulty });
    this.game.start();
    this.messages = [];
    this.msgUntil = 0;
    this.paused = false;

    this._bindPlay();
    this._fit();
    this._drainEvents();
    this.last = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  _bindPlay() {
    for (const z of this.root.querySelectorAll('.pb-zone')) {
      z.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.sfx.resume();
        if (this.paused) return;
        this.pointerSides.set(e.pointerId, z.dataset.side);
        this.game.setFlipper(z.dataset.side, true);
        z.classList.add('is-on');
      });
      // A touchmove bound to the ZONE, never to document: a non-passive document-level touchmove
      // turns off compositor scrolling for the whole page while this game is mounted (root
      // CLAUDE.md's scroll and touch rules).
      z.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    const launch = this.root.querySelector('[data-role="launch"]');
    launch.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sfx.resume();
      if (this.paused) return;
      this.game.plungerDown();
      launch.classList.add('is-on');
    });

    this.root.querySelector('[data-role="nudge"]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.paused) return;
      const r = this.el.stage.getBoundingClientRect();
      this.game.nudge(e.clientX < r.left + r.width / 2 ? 'left' : 'right');
    });

    this.root.querySelector('[data-role="pause"]').addEventListener('click', () => this._setPaused(!this.paused));
  }

  _releasePointer(e) {
    if (!this.game) return;
    const side = this.pointerSides.get(e.pointerId);
    if (side) {
      this.pointerSides.delete(e.pointerId);
      this.game.setFlipper(side, false);
      const z = this.root.querySelector(`.pb-zone-${side === 'left' ? 'l' : 'r'}`);
      if (z) z.classList.remove('is-on');
    }
    const launch = this.root.querySelector('[data-role="launch"]');
    if (launch && launch.classList.contains('is-on')) {
      launch.classList.remove('is-on');
      this.game.plungerUp();
    }
  }

  _key(e, down) {
    if (!this.game || this.screen !== 'play') return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A' || (k === 'Shift' && e.location === 1)) {
      e.preventDefault(); if (!this.paused) this.game.setFlipper('left', down);
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D' || (k === 'Shift' && e.location === 2)) {
      e.preventDefault(); if (!this.paused) this.game.setFlipper('right', down);
    } else if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (this.paused) return;
      if (down) this.game.plungerDown(); else this.game.plungerUp();
    } else if (down && (k === 'ArrowDown' || k === 'n' || k === 'N')) {
      e.preventDefault(); this.game.nudge(k === 'ArrowDown' ? 'up' : 'left');
    } else if (down && (k === 'Escape' || k === 'p' || k === 'P')) {
      this._setPaused(!this.paused);
    }
    if (down) this.sfx.resume();
  }

  _setPaused(on) {
    if (this.screen !== 'play' || !this.game || this.game.phase === 'over') return;
    this.paused = on;
    if (on) {
      this.game.setFlipper('left', false);
      this.game.setFlipper('right', false);
      this._overlay('pause', `
        <div class="pb-sheet-head">
          <h2>${esc(t('paused'))}</h2>
          <button type="button" class="pb-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        </div>
        <div class="pb-sheet-body pb-sheet-actions">
          <button type="button" class="pb-play" data-role="resume">${esc(t('resume'))}</button>
          <button type="button" class="pb-link" data-role="quit">${esc(t('quit'))}</button>
        </div>`);
      this.overlay.querySelector('[data-role="resume"]').addEventListener('click', () => this._setPaused(false));
      this.overlay.querySelector('[data-role="quit"]').addEventListener('click', () => {
        this.paused = false;
        this._closeOverlay();
        this._renderSetup();
      });
      // Closing the pause sheet with the X is the same as resuming.
      this.overlay.querySelector('[data-role="close"]').addEventListener('click', () => { this.paused = false; });
    } else {
      this._closeOverlay();
      this.last = 0;
    }
  }

  // --- the frame ------------------------------------------------------------------------------------

  _frame(ts) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.game || !this.renderer) return;
    const now = ts / 1000;
    let dt = this.last ? now - this.last : 1 / 60;
    this.last = now;
    dt = Math.min(dt, 0.05);

    if (!this.paused) this.game.update(dt);
    this._drainEvents();
    this.renderer.render(this.game, dt);
    this._paintHud(dt);
  }

  _stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** The one place game.js's event stream becomes sound and light. Everything here is presentation:
   *  no branch below changes a score, a lamp state or a rule. */
  _drainEvents() {
    const R = this.renderer;
    const S = this.sfx;
    for (const ev of this.game.takeEvents()) {
      switch (ev.type) {
        case 'bumper': {
          const i = Number(ev.id.slice(3)) || 0;
          R.hitBumper(i); R.spawnHit(ev.x, ev.y, 9, PALETTE.cyan, 260); R.kick(2.5);
          S.bumper(Math.min(1, ev.speed / 900));
          break;
        }
        case 'sling':
          R.hitSling(ev.id === 'slingL' ? 0 : 1); R.spawnHit(ev.x, ev.y, 6, PALETTE.gold, 240); S.sling();
          break;
        case 'standup':
          R.hitStand(ev.id === 'standL' ? 0 : 1); R.spawnHit(ev.x, ev.y, 6, PALETTE.red, 200); S.target();
          break;
        case 'drop':
          R.spawnHit(ev.x, ev.y, 10, PALETTE.gold, 240); S.target(); R.kick(2);
          break;
        case 'bankdone':
          R.flash(0.4, PALETTE.green); R.kick(6); S.bank();
          R.spawnHit(ev.x, ev.y, 22, PALETTE.green, 340);
          break;
        case 'spinner':
          R.hitSpinner(ev.rips); S.spinner(ev.rips);
          break;
        case 'orbit':
          R.spawnHit(ev.x, ev.y, 12, PALETTE.gold, 300); S.orbit(ev.combo);
          break;
        case 'lane':
          R.hitLane(ev.id); S.lane();
          break;
        case 'laneset':
          R.flash(0.35, PALETTE.gold); S.laneSet(); R.kick(4);
          break;
        case 'ramp':
          R.hitRamp(); S.ramp();
          break;
        case 'rampreject':
          S.rampReject();
          break;
        case 'rampexit':
          R.spawnHit(ev.x, ev.y, 6, PALETTE.magenta, 180);
          break;
        case 'jackpot':
          R.flash(0.6, PALETTE.magenta); R.kick(8); S.jackpot(this.game.jackpots);
          R.spawnHit(ev.x, ev.y, 26, PALETTE.magenta, 400);
          break;
        case 'superjackpot':
          R.flash(0.9, '#ffffff'); R.kick(14); S.superJackpot();
          R.spawnHit(ev.x, ev.y, 44, PALETTE.gold, 520);
          break;
        case 'scoop': case 'lock':
          R.hitScoop(); R.spawnHit(ev.x, ev.y, 14, PALETTE.cyan, 260);
          if (ev.type === 'lock') { S.lock(); R.flash(0.35, PALETTE.cyan); } else S.scoop();
          break;
        case 'kickout':
          S.kickout(); R.spawnHit(ev.x, ev.y, 8, PALETTE.cyan, 300);
          break;
        case 'missionstart':
          S.missionStart(); R.flash(0.45, PALETTE.gold); R.kick(6);
          break;
        case 'missiondone':
          S.missionDone(); R.flash(0.6, PALETTE.green); R.kick(9);
          break;
        case 'missionfail':
          S.missionFail();
          break;
        case 'multiball':
          S.multiball(); R.flash(0.85, ev.wizard ? PALETTE.magenta : PALETTE.cyan); R.kick(16);
          break;
        case 'launch':
          S.launch(ev.power);
          break;
        case 'drain':
          S.drain(); R.spawnHit(ev.x, TH - 14, 12, '#7d8aa8', 200);
          break;
        case 'ballsave':
          S.ballSave(); R.flash(0.4, PALETTE.green);
          break;
        case 'extraball':
          S.extraBall(); R.flash(0.5, PALETTE.gold);
          break;
        case 'tilt':
          S.tilt(); R.kick(20);
          break;
        case 'nudge':
          S.nudge(); R.kick(9);
          break;
        case 'bonustick':
          S.bonusTick(Math.round(ev.paid / 1000));
          break;
        case 'thock':
          S.thock(Math.min(1, ev.speed / 900));
          break;
        case 'clink': case 'clack':
          S.clink(Math.min(1, ev.speed / 900));
          break;
        case 'flip':
          S.flip();
          break;
        case 'score':
          if (ev.x != null && ev.value >= 2000) {
            R.popup(ev.x, ev.y, fmt(ev.value), ev.label ? PALETTE.gold : '#ffffff', ev.value >= 50000);
          }
          if (ev.label && ev.x != null) {
            R.popup(ev.x, ev.y - 20, t(`lbl_${ev.label}`) || '', PALETTE.cyan, false);
          }
          break;
        case 'msg':
          this._pushMessage(ev);
          break;
        case 'gameover':
          this._gameOver();
          break;
        default: break;
      }
    }
  }

  _pushMessage(ev) {
    const text = t(ev.key, ev.params || {});
    this.messages.push({ text, big: !!ev.big, dur: ev.big ? 2.1 : 1.4 });
    if (this.messages.length > 6) this.messages.splice(0, this.messages.length - 6);
  }

  _paintHud(dt) {
    const hud = this.game.hud();
    this.el.score.textContent = fmt(this.game.score);
    this.el.score.classList.toggle('is-multi', hud.scoreMult > 1);

    const dots = [];
    for (let i = 1; i <= hud.ballsTotal; i++) dots.push(`<i class="${i <= hud.ball ? 'is-used' : ''}"></i>`);
    this.el.ball.innerHTML =
      `<span class="pb-ball-l">${esc(t('hud_ball'))} ${hud.ball}/${hud.ballsTotal}</span>`
      + `<span class="pb-pips">${dots.join('')}</span>`
      + (hud.mult > 1 ? `<span class="pb-mult">${hud.mult}x</span>` : '')
      + (hud.multiball ? `<span class="pb-mb">${esc(t(hud.wizard ? 'msg_wizard' : 'msg_multiball'))}</span>` : '');

    // The dot-matrix line: whatever message is current, otherwise the standing state.
    this.msgUntil -= dt;
    if (this.msgUntil <= 0 && this.messages.length) {
      const m = this.messages.shift();
      this.msgText = m.text;
      this.msgUntil = m.dur;
      this.el.msg.classList.toggle('is-big', m.big);
      this.el.msg.classList.remove('is-hint');
      this.el.msg.classList.remove('is-in');
      void this.el.msg.offsetWidth;      // restart the entry animation
      this.el.msg.classList.add('is-in');
    }
    if (this.msgUntil <= 0) {
      // Never leave the display blank: with no event to show, it states the STANDING OBJECTIVE.
      // A dark empty panel reads as broken, and a player who has not read the how-to has no other
      // way to learn what the lit scoop is for.
      this.msgText = hud.onPlunger ? t('hud_pull') : this._objective(hud);
      this.el.msg.classList.remove('is-big');
      // The standing objective is a SENTENCE, not a two-word announcement, so it gets its own
      // smaller, tighter treatment. At the headline's 0.14em tracking it simply did not fit and
      // was rendering as "DROP THE 4 TARGETS TO LIGH...".
      this.el.msg.classList.add('is-hint');
    }
    this.el.msg.textContent = this.msgText;

    let sub = '';
    let bar = 0;
    if (hud.mission) {
      const m = hud.mission;
      // The sub-line says what to SHOOT, not the mission's name: the name already went past on the
      // big line when the mission started, and repeating it tells the player nothing they need.
      sub = `${t(`task_${m.id}`)}  ${m.got}/${m.need}`;
      bar = Math.max(0, m.left / (MISSIONS.find((x) => x.id === m.id) || { time: 26 }).time);
      this.el.timer.classList.add('is-on');
    } else {
      this.el.timer.classList.remove('is-on');
      if (hud.save > 0) sub = `${t('hud_save')}  ${hud.save.toFixed(0)}`;
      else if (hud.locks > 0) sub = t('hint_locks', { n: hud.locks });
      else if (hud.mult > 1) sub = t('msg_bonus_x', { n: hud.mult });
    }
    this.el.sub.textContent = sub;
    this.el.timer.firstElementChild.style.transform = `scaleX(${bar.toFixed(3)})`;
  }

  /** The one line that says what to shoot next, in the same priority order the scoop itself uses.
   *  Purely derived from the HUD snapshot: it holds no state of its own, so it can never disagree
   *  with the lamps on the playfield. */
  _objective(hud) {
    if (hud.multiball) return hud.superLit ? t('hint_super') : t('hint_jackpot');
    if (hud.bankLit) return t('hint_scoop');
    if (hud.lockLit) return t('hint_lock');
    if (hud.missionsDone < 4) return t('hint_bank');
    return t('hint_ramp');
  }

  // --- game over -------------------------------------------------------------------------------------

  _gameOver() {
    this.sfx.gameOver();
    const res = this.game.result();
    const prev = bestScore();

    // Record ONCE per game. `recorded` guards a second call if a duplicate gameover event ever
    // reaches here: every write in js/game-stats.js is additive, so a double call would silently
    // inflate the play count rather than fail loudly.
    if (!this.recorded) {
      this.recorded = true;
      try {
        recordPinball(res.score, res.difficulty, {
          jackpots: res.jackpots, multiballs: res.multiballs,
          missions: res.missions, ramps: res.ramps, bestBall: res.bestBall,
        });
      } catch (err) {
        console.error('[pinball] could not record the game', err);
      }
      try { syncMyStats(); } catch (err) { console.error('[pinball] stats sync could not start', err); }
    }

    const isBest = res.score > prev;
    const tile = (v, label) => `<div class="pb-tile"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
    const el = this._overlay('over', `
      <div class="pb-sheet-head">
        <h2>${esc(t('over_h'))}</h2>
        <button type="button" class="pb-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
      </div>
      <div class="pb-sheet-body">
        <p class="pb-final-label">${esc(t('over_final'))}</p>
        <p class="pb-final">${fmt(res.score)}</p>
        ${isBest ? `<p class="pb-newbest">${esc(t('over_best'))}</p>` : ''}
        <h3 class="pb-tiles-h">${esc(t('over_stats'))}</h3>
        <div class="pb-tiles">
          ${tile(fmt(res.missions), t('over_missions'))}
          ${tile(fmt(res.multiballs), t('over_multiballs'))}
          ${tile(fmt(res.jackpots), t('over_jackpots'))}
          ${tile(fmt(res.bestBall), t('over_bestball'))}
        </div>
        <div class="pb-sheet-actions">
          <button type="button" class="pb-play" data-role="again">${esc(t('over_again'))}</button>
        </div>
      </div>`);
    el.querySelector('[data-role="again"]').addEventListener('click', () => this._startGame());
    // The X closes back to the setup screen rather than leaving a finished table running behind it.
    el.querySelector('[data-role="close"]').addEventListener('click', () => this._renderSetup());
  }

  // --- layout ------------------------------------------------------------------------------------------

  /** Fit the canvas to whatever box the stage ended up with. Subscribed through js/viewport.js, so
   *  it is coalesced to at most once per frame and skipped when nothing actually changed. */
  _fit() {
    if (!this.renderer || !this.el || !this.el.stage) return;
    const r = this.el.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.resize(r.width, r.height);
  }

  _relabel() {
    if (this.screen === 'setup') this._renderSetup();
  }

  // --- teardown -----------------------------------------------------------------------------------------

  destroy() {
    this._stopLoop();
    this._closeOverlay();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._unsubLang) this._unsubLang();
    if (this._unsubViewport) this._unsubViewport();
    this.sfx.close();
    this.game = null;
    this.renderer = null;
    this.root.classList.remove('pb-root');
    this.root.innerHTML = '';
  }

  isInProgress() {
    return !!(this.game && this.screen === 'play' && this.game.phase !== 'over');
  }
}

// --- the hub module contract ------------------------------------------------------------------------

export function init(container) {
  if (instance) instance.destroy();
  instance = new PinballUI(container);
  return instance;
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** True while a game is live. Pinball is live action with no meaningful mid-ball resume (a ball in
 *  flight cannot be snapshotted), so this is the LITERAL reading of the contract, the same as Ball
 *  Run, Snake and Hill Climb, and the hub should confirm before navigating away. */
export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
