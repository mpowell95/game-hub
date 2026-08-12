// skeeball/js/ui.js - Skeeball's DOM shell: the machine picker, the canvas alley and its rAF loop,
// the flick input, the marquee, the end card, autosave and stats.
// game.js owns every rule; boards.js owns the machines; render.js owns every pixel; this file owns
// the clock, the input and the screens.
//
// Reworked 2026-08-11 (Matt): no computer opponent. A game is nine balls against three numbers on
// the cabinet head - the app-wide record for that machine, your all-time best, and your best today
// - and the ladder is unlocking machines by hitting a target score. See skeeball/CLAUDE.md.
//
// isInProgress(): the AUTOSAVE/RESUME meaning (root CLAUDE.md, "The module contract"). Skeeball is
// turn-based with no clock, so leaving mid-rack is lossless: every landed throw snapshots and the
// picker offers Resume. Always returns false; do not "fix" it to true mid-game.

import { Game, BALLS_PER_RACK, resolveThrow, flickToThrow, laneOffsetAt, SHORT_BELOW } from './game.js';
import { BOARDS, DEFAULT_BOARD, boardById, nextBoard } from './boards.js';
import * as R from './render.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { recordSkeeball, unlockSkeeballBoard, loadStats } from '../../js/game-stats.js';
import { isUnlocked, bestOn, todayBestOn, appWideBest } from '../../js/arcade-scores.js';
import { onViewportResize } from '../../js/viewport.js';
import { howToHtml, createHowTo } from './howto.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.skeeball.v1';
const SAVE_KEY = 'gamehub.skeeball.save.v1';

// The gesture -> throw mapping is game.js's `flickToThrow`, NOT anything in this file. It is half
// of the difficulty, it is pure, and `test.js` drives real gestures through it. This file's only
// job is to turn pointer events into the four numbers it wants.
//
// How long a window at the end of the swipe counts as "the release". 100ms is Android's
// VelocityTracker default and it is a good one: long enough to average out a jittery finger,
// short enough that a pull-back before the flick does not bleed into it.
const VEL_WINDOW_MS = 100;

// THE ROLL. Release speed in DESIGN PIXELS PER SECOND along the ball's own path: `ROLL_V0` at no
// energy, plus `ROLL_VE` per unit of it, so a hard throw is visibly quicker than a soft one.
// `ROLL_KEEP` is the fraction of that speed the ball still has when it arrives - how much it slows
// down rolling. The DURATION is not a constant at all: it falls out of speed and path length.
//
// These replaced a 720/260/200ms three-segment animation whose pieces covered wildly different
// distances and had nothing to do with the throw. Matt: "None of the different speeds feel related
// to or based on each other... It goes SO slow down the ramp, then SO fast off the jump."
const ROLL_V0 = 700;
const ROLL_VE = 900;
const ROLL_KEEP = 0.55;
const DROP_MS = 150;
const POPUP_MS = 850;

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (err) { console.error('[skeeball] write failed', k, err); }
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** This player's `sk` sub-counter, or an empty one. Never throws. */
function sub() {
  try { return (loadStats().games.skeeball || {}).sk || {}; } catch { return {}; }
}

let instance = null;

class SkeeballUI {
  constructor(container) {
    this.root = container;
    const saved = readJSON(SETTINGS_KEY) || {};
    this.boardId = BOARDS.some((b) => b.id === saved.board) ? saved.board : DEFAULT_BOARD;
    this.game = null;
    this.screen = 'pick';
    this.raf = 0;
    this.flight = null;
    this.popup = null;
    this.pending = null;
    this.drag = null;
    this.recorded = false;
    // The app-wide record per board. Populated only when the leaderboard data is reachable; until
    // then the marquee shows a dash rather than a wrong number (see _loadAppWide).
    this.appWide = {};
    this._ensureCss();

    this._onVis = () => { if (document.hidden) this._save(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._offLang = onLangChange(() => this._rerenderForLang());
    this._offResize = onViewportResize(() => {
      this._fit();
      if (this.screen === 'pick') { this._fitPicker(); this._paintThumbs(); }
      if (this._help) this._help.ht.refit();
    });

    this._loadAppWide();
    this.renderPicker();
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

  /** Read the app-wide records off the same synced player data the leaderboard uses. Read-only,
   *  best-effort, and deliberately late-bound: the game is fully playable with no network, the
   *  marquee just shows a dash where the record would be. Dynamic import so a device that cannot
   *  reach Firebase never pays for the module at mount. */
  async _loadAppWide() {
    try {
      const [{ watchPlayers }, { aggregatePlayers }] = await Promise.all([
        import('../../js/stats-net.js'),
        import('../../js/players-agg.js'),
      ]);
      // watchPlayers is async and RESOLVES to the unsubscribe - awaiting it is what makes
      // destroy() able to actually detach the listener.
      this._offPlayers = await watchPlayers((all) => {
        try {
          const rows = aggregatePlayers(all || {});
          const next = {};
          for (const b of BOARDS) next[b.id] = appWideBest(rows, 'skeeball', 'sk', b.id);
          this.appWide = next;
          if (this.screen === 'pick') this.renderPicker();
        } catch (err) { console.warn('[skeeball] app-wide records unavailable', err); }
      });
    } catch (err) {
      console.warn('[skeeball] offline: app-wide records not shown', err);
    }
  }

  // --- machine picker -----------------------------------------------------------------------

  /**
   * THE MACHINE CAROUSEL. Matt, 2026-08-11: "I want the setup screen to be different too. A
   * carousel with an image of the board you're selecting. Then the chains and a lock on the
   * [locked] ones - just like in the reference photos."
   *
   * One full-width slide per machine, swipeable with CSS scroll-snap (no JS drag handler, so it
   * keeps native momentum and never fights the page). Each slide's art is the ACTUAL machine
   * painted by render.js's drawThumb, so it cannot drift from what you get when you press Play;
   * a locked one is dimmed, chained and padlocked exactly as IMG_3959/IMG_3960 show.
   *
   * The Play button lives on the slide rather than under the strip on purpose: the thing you are
   * looking at and the thing you are starting are then the same object.
   */
  renderPicker() {
    this._stopLoop();
    this.screen = 'pick';
    this.game = null;
    const sk = sub();
    const resumable = Game.restore(readJSON(SAVE_KEY));
    const start = Math.max(0, BOARDS.findIndex((b) => b.id === this.boardId));

    const slides = BOARDS.map((b, i) => {
      const open = isUnlocked(sk, b.id, DEFAULT_BOARD);
      const best = bestOn(sk, b.id);
      const today = todayBestOn(sk, b.id);
      const world = this.appWide[b.id];
      const prev = BOARDS[i - 1];
      return `
        <li class="sk-slide${open ? '' : ' is-locked'}" data-board="${b.id}" data-i="${i}">
          <div class="sk-slide-art">
            <canvas class="sk-thumb" data-thumb="${b.id}" data-locked="${open ? '0' : '1'}"></canvas>
          </div>
          <h3 class="sk-slide-name">${t(b.nameKey)}</h3>
          ${open ? `
            <dl class="sk-scores">
              <div><dt>${t('world_best')}</dt><dd>${world && world.score ? world.score : '—'}</dd></div>
              <div><dt>${t('your_best')}</dt><dd>${best || '—'}</dd></div>
              <div><dt>${t('today')}</dt><dd>${today || '—'}</dd></div>
            </dl>
            <button type="button" class="sk-play" data-role="play" data-board="${b.id}">${t('play')}</button>
          ` : `
            <p class="sk-need">${t('unlock_hint', { n: b.unlockScore, board: prev ? t(prev.nameKey) : '' })}</p>
            <button type="button" class="sk-play is-off" disabled>${t('locked')}</button>
          `}
        </li>`;
    }).join('');

    const dots = BOARDS.map((b, i) =>
      `<button type="button" class="sk-dot${i === start ? ' is-on' : ''}" data-go="${i}"
        aria-label="${t(b.nameKey)}"></button>`).join('');

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-pick">
          <h2 class="sk-title">${t('title')}</h2>
          ${resumable && !resumable.over ? `<button type="button" class="sk-resume" data-role="resume">${t('resume')}</button>` : ''}
          <div class="sk-carousel">
            <button type="button" class="sk-arrow sk-arrow-l" data-step="-1" aria-label="${t('prev_machine')}">‹</button>
            <ul class="sk-track">${slides}</ul>
            <button type="button" class="sk-arrow sk-arrow-r" data-step="1" aria-label="${t('next_machine')}">›</button>
          </div>
          <div class="sk-dots">${dots}</div>
          <p class="sk-soon">${t('more_maps')}</p>
          <button type="button" class="sk-howto" data-role="howto">${t('howto')}</button>
        </div>
      </div>`;

    const track = this.root.querySelector('.sk-track');

    const goTo = (i, smooth) => {
      const n = clamp(i, 0, BOARDS.length - 1);
      track.scrollTo({ left: n * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    };
    // One frame first: measuring or painting straight after innerHTML reads a track with no width
    // and a picker with no position, which is how the art ended up pinned to its 140px floor with
    // 84px of room going spare. Land on the machine you last played without animating there.
    // TWO frames, and the second one is not belt-and-braces. On the first frame after innerHTML
    // the track has no width yet, so its two `flex: 0 0 100%` slides have not laid out side by
    // side and `pick.scrollHeight` reads 521 instead of 306 - the measurement then hands the art
    // its 140px floor with 84px of room going spare. The settle pass re-measures a real layout.
    // _fitPicker collapses before measuring, so running it twice is idempotent, not cumulative.
    requestAnimationFrame(() => {
      this._fitPicker();
      goTo(start, false);
      requestAnimationFrame(() => { this._fitPicker(); this._paintThumbs(); });
    });

    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const b = BOARDS[clamp(i, 0, BOARDS.length - 1)];
      if (!b || b.id === this.boardId) return;
      this.boardId = b.id;
      this.root.querySelectorAll('.sk-dot').forEach((d, k) => d.classList.toggle('is-on', k === i));
    }, { passive: true });

    this.root.querySelector('.sk-carousel').addEventListener('click', (e) => {
      const play = e.target.closest('[data-role="play"]');
      if (play) {
        this.boardId = play.dataset.board;
        writeJSON(SETTINGS_KEY, { board: this.boardId });
        this.startGame();
        return;
      }
      const arrow = e.target.closest('[data-step]');
      if (arrow) goTo(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + Number(arrow.dataset.step), true);
    });
    this.root.querySelector('.sk-dots').addEventListener('click', (e) => {
      const d = e.target.closest('[data-go]');
      if (d) goTo(Number(d.dataset.go), true);
    });
    const res = this.root.querySelector('[data-role="resume"]');
    if (res) res.addEventListener('click', () => this.startGame(Game.restore(readJSON(SAVE_KEY))));
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this.openHelp());
  }

  /**
   * Size the machine art from a MEASUREMENT of the host, not from a viewport unit.
   *
   * `svh` describes the screen, and in the hub this screen already has ~138px of chrome above us,
   * so a `46svh` square overflowed a short phone by 81px there while fitting perfectly standalone.
   * This is the same measure-the-host job `_fit()` does for the alley (and Battleship's
   * `_fitBattleBoards()` for its grids): take the space actually left below us, subtract what
   * every other row in the picker needs, and give the rest to the art.
   */
  _fitPicker() {
    const pick = this.root.querySelector('.sk-pick');
    // EVERY slide, not just the visible one. The track is a flex row, so its height is the TALLEST
    // slide's - capping only the first one left the locked machine's art at full size and the
    // carousel stayed 149px taller than anything on screen could explain.
    const arts = [...this.root.querySelectorAll('.sk-slide-art')];
    if (!pick || !arts.length) return;
    const setMax = (px) => arts.forEach((a) => { a.style.maxHeight = px; });
    setMax('0px');                               // collapse first, so we are not measuring ourselves
    const vh = window.innerHeight || 640;
    const avail = vh - pick.getBoundingClientRect().top;
    const rest = pick.scrollHeight;              // everything except the art, now that it is 0
    const box = Math.max(140, avail - rest - 20);
    setMax(`${box}px`);
    // Then the same second pass `_fit()` needs, and for the same reason: measuring only the space
    // ABOVE us misses whatever the HOST adds BELOW - the hub's .hub-main carries 40px of
    // padding-bottom. Re-measure the real overflow and give it back.
    const over = document.documentElement.scrollHeight - vh;
    if (over > 0) setMax(`${Math.max(140, box - over)}px`);
  }

  /** Paint every slide's machine art at the device's real pixel density. Called on first render
   *  and again on resize, because a canvas sized in CSS pixels goes soft otherwise. */
  _paintThumbs() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const cv of this.root.querySelectorAll('canvas[data-thumb]')) {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) continue;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      R.drawThumb(c, boardById(cv.dataset.thumb), w, h, cv.dataset.locked === '1');
    }
  }

  /** The HOW TO PLAY carousel (skeeball/js/howto.js). Its illustration is the real machine drawn
   *  by render.js with real engine-resolved throws, so it teaches the board you are about to
   *  play rather than a diagram of one. */
  openHelp() {
    this._closeHelp();
    const host = document.createElement('div');
    host.className = 'sk-root sk-ht-host';
    host.innerHTML = howToHtml();
    document.body.appendChild(host);
    const ht = createHowTo(host, this.boardId);
    host.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="close"]') || e.target.classList.contains('sk-ht-scrim')) {
        this._closeHelp();
      } else if (e.target.closest('[data-role="next"]')) ht.next();
      else if (e.target.closest('[data-role="first"]')) ht.first();
    });
    this._help = { host, ht };
    ht.open(0);
  }

  _closeHelp() {
    if (!this._help) return;
    this._help.ht.destroy();
    this._help.host.remove();
    this._help = null;
  }

  // --- play ------------------------------------------------------------------------------------

  startGame(restored) {
    this.screen = 'game';
    this.game = restored || new Game({ board: this.boardId });
    this.boardId = this.game.board.id;
    this.recorded = false;
    this.flight = null; this.popup = null; this.pending = null; this.drag = null;

    this.root.innerHTML = `
      <div class="sk-root">
        <div class="sk-game" data-role="game">
          <canvas class="sk-canvas" data-role="canvas" aria-label="${t('aria_lane')}"></canvas>
          <p class="sk-hint" data-role="hint">${t('drag_to_throw')}</p>
          <p class="sk-balls" data-role="balls"></p>
        </div>
      </div>`;
    this.gameEl = this.root.querySelector('[data-role="game"]');
    this.canvas = this.root.querySelector('[data-role="canvas"]');
    this.hintEl = this.root.querySelector('[data-role="hint"]');
    this.ctx = this.canvas.getContext('2d');

    this._bindInput();
    this._fit();
    this._paintHud();
    this._startLoop();
    if (this.game.over) this._finish();
  }

  /** Pin the game box to the space actually available, measured rather than assumed.
   *  Collapsed to 0 FIRST so our own overflow cannot corrupt the measurement, and the residual
   *  overflow is then subtracted because the hub's 40px of `.hub-main` padding sits BELOW us and is
   *  invisible to a top-only measurement (VISUAL-PROCESS.md 3c; this game overflowed by exactly
   *  that once). The root never asks for 100dvh for the same reason. */
  _fit() {
    if (!this.gameEl || !this.canvas) return;
    this.gameEl.style.height = '0px';
    const top = this.gameEl.getBoundingClientRect().top;
    let avail = Math.max(280, Math.floor((window.innerHeight || 640) - top - 6));
    this.gameEl.style.height = `${avail}px`;
    const over = document.documentElement.scrollHeight - (window.innerHeight || 640);
    if (over > 0) { avail = Math.max(280, avail - over); this.gameEl.style.height = `${avail}px`; }

    const w = this.gameEl.clientWidth || 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(avail * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${avail}px`;
    this.layout = R.layoutFor(w, avail);
    this.dpr = dpr;
    this._buildMachine();
  }

  /** The machine never changes between throws, so it is painted once per resize into an offscreen
   *  canvas and blitted each frame. Only the ball, badge, popup, queue and marquee numbers move. */
  _buildMachine() {
    const { scale, ox, oy } = this.layout;
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = this.game ? this.game.board.palette.wall : '#111';
    g.fillRect(0, 0, this.layout.w, this.layout.h);
    g.save(); g.translate(ox, oy); g.scale(scale, scale);
    R.drawMachine(g, this.game.board);
    g.restore();
    this.machine = c;
  }

  /**
   * The gesture, as a ring of timestamped samples.
   *
   * `flickToThrow` (game.js) wants the whole gesture's displacement AND the velocity over the last
   * moment before release. The second half is the reason this buffer exists: a fling is described
   * by its last ~100ms, not by everything since touch-down. Android's VelocityTracker uses the
   * same window for the same reason, and it is what lets you wind up - pull back, then flick -
   * without the pull-back cancelling out the throw.
   *
   * Everything is normalised to CANVAS HEIGHTS, x included, so the angle `flickToThrow` takes is a
   * real screen angle and the feel is identical on any phone.
   */
  _gesture() {
    const d = this.drag;
    const h = this.layout.h || 1;
    if (!d || d.pts.length < 2) return null;
    const pts = d.pts;
    const last = pts[pts.length - 1];
    const first = pts[0];

    // The velocity window: walk back until we are older than VEL_WINDOW_MS, keeping at least one
    // earlier sample so a very short flick still has something to measure against.
    let i = pts.length - 1;
    while (i > 0 && last.t - pts[i - 1].t < VEL_WINDOW_MS) i -= 1;
    const from = pts[i];
    const dt = Math.max(8, last.t - from.t) / 1000;
    return {
      dx: (last.x - first.x) / h,
      dy: (last.y - first.y) / h,
      vx: ((last.x - from.x) / h) / dt,
      vy: ((last.y - from.y) / h) / dt,
    };
  }

  _bindInput() {
    const cv = this.canvas;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const stamp = (e, p) => {
      const t = e.timeStamp || performance.now();
      this.drag.pts.push({ x: p.x, y: p.y, t });
      // Keep a little more than the velocity window; the displacement terms use pts[0], which is
      // the touch-down sample and is never dropped.
      while (this.drag.pts.length > 2 && t - this.drag.pts[1].t > VEL_WINDOW_MS * 2.5) {
        this.drag.pts.splice(1, 1);
      }
    };
    this._onDown = (e) => {
      if (!this.game || this.game.over || this.flight || this.popup) return;
      const p = pos(e);
      this.drag = { pts: [], power: 0, aim: 0 };
      stamp(e, p);
      cv.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!this.drag) return;
      stamp(e, pos(e));
      // The live AIM, for the guide. Smoothed, because a raw per-frame angle estimate flickers
      // badly and a guide that twitches is worse than no guide. Power is deliberately NOT tracked
      // here: it is not known until release (see render.js's drawAimGuide).
      const g = this.drag.pts.length > 1 ? flickToThrow(this._gesture()) : null;
      if (g) this.drag.aim += (g.aim - this.drag.aim) * 0.4;
    };
    this._onUp = () => {
      if (!this.drag) return;
      const g = this._gesture();
      this.drag = null;
      const shot = g && flickToThrow(g);
      if (!shot) return;                       // a tap, a yank back, or a stray touch
      this._throw(shot.power, shot.aim);
    };
    cv.addEventListener('pointerdown', this._onDown);
    cv.addEventListener('pointermove', this._onMove);
    cv.addEventListener('pointerup', this._onUp);
    cv.addEventListener('pointercancel', this._onUp);
    // Non-passive, bound to the GAME'S ROOT not document: a document-level touchmove turns off
    // compositor scrolling page-wide for as long as this game is mounted (js/CLAUDE.md).
    this._onTouchMove = (e) => { if (this.drag) e.preventDefault(); };
    this.root.addEventListener('touchmove', this._onTouchMove, { passive: false });
  }

  /**
   * ONE ROLL, ONE SPEED. Matt, 2026-08-11: "You flick it, it goes some speed down the ramp, then
   * it speeds up to go off the jump, then it flies through the air. None of the different speeds
   * feel related to or based on each other... It goes SO slow down the ramp, then SO fast off the
   * jump. Then like an ok speed in the air."
   *
   * Two separate faults produced that, and the second one is the reason the first was not enough:
   *
   *   1. THREE HARDCODED DURATIONS - 720ms for the lane, 260ms for the board, 200ms for the drop -
   *      stapled together. Each covered a completely different distance, so each ran at a different
   *      apparent speed, and none had anything to do with how hard the ball was thrown. There was
   *      even a `sin()` hop over the crest, which is the "flies through the air".
   *   2. A HOLE IN THE PATH. The lane's top is at design y=660, the bowl's lip at y=560, and the
   *      ramp between them was on nobody's path: the ball went straight from `lanePoint(1)` to
   *      `boardPoint(...)`, teleporting 100px in a single frame. Traced, that frame ran at
   *      6535 px/s against 406 px/s the frame before it.
   *
   * So the throw is now ONE polyline through lane -> ramp -> bowl (render.js owns each piece's
   * geometry, including `rampPoint`, so the ball rolls on the surface that is actually drawn), and
   * the ball advances along it by ARC LENGTH. Arc length rather than a world coordinate on purpose:
   * the bowl is deliberately drawn oversized - the reference cabinet does the same - so "world
   * units" do not convert to screen pixels at the same rate on both sides of the lip, and any
   * model that assumes they do reintroduces a speed step at exactly that seam.
   *
   * Release speed comes from the THROW, and the ball decelerates to `ROLL_KEEP` of it like
   * something rolling. The duration is not declared anywhere; it falls out of speed and length.
   */
  _throw(power, aim) {
    if (!this.game || this.game.over) return;
    const preview = resolveThrow(power, aim, this.game.board);
    const out = this.game.throwBall(power, aim);
    if (!out) return;
    const short = out.kind === 'short';

    // How far up the lane a throw that never made the ramp actually got.
    const reach = clamp(preview.energy / SHORT_BELOW, 0.12, 1) * 0.9;
    const path = this._buildPath(aim, out, short ? reach : null);
    const v0 = ROLL_V0 + ROLL_VE * clamp(preview.energy, 0, 1);
    const len = path.len[path.len.length - 1];

    this.flight = {
      out, short, path, t0: performance.now(),
      // Non-short: constant deceleration v0 -> ROLL_KEEP*v0, so the mean is v0*(1+KEEP)/2.
      // Short: decelerate to a dead stop at the apex, so the mean is v0/2.
      rollMs: (len / (v0 * (short ? 0.5 : (1 + ROLL_KEEP) / 2))) * 1000,
      dropMs: short ? 0 : DROP_MS,
    };
    this.flight.backMs = short ? this.flight.rollMs * 0.95 : 0;
    // Hold the points back until the ball LANDS - the engine has them already, but revealing them
    // on release tells the player the answer while the ball is still rolling.
    this.pending = out.scored;
    this.hintEl.hidden = true;
    this._paintHud();
  }

  /**
   * The throw's path, as a polyline in design space plus its cumulative arc length.
   * `laneTo` non-null means a short throw that only ever gets that far up the lane.
   *
   * The lane leg uses the ENGINE's `laneOffsetAt`, so a banked throw is drawn hitting the rail at
   * exactly the point it was scored hitting it. This file used to keep its own copy of that fold
   * with a stale `1.35` in it, which is why Matt saw a ball "bounce off the wall, but then continue
   * on the line it originally was on".
   */
  _buildPath(aim, out, laneTo) {
    const pts = [];
    const top = laneTo == null ? 1 : laneTo;
    for (let i = 0; i <= 28; i++) {
      const v = (i / 28) * top;
      const q = R.lanePoint(v, R.boardXToLaneU(laneOffsetAt(aim, v).u));
      pts.push({ x: q.x, y: q.y, r: q.r });
    }
    if (laneTo == null) {
      const u = laneOffsetAt(aim, 1).u;
      for (let i = 1; i <= 10; i++) pts.push(R.rampPoint(i / 10, u));
      const endY = Math.min(0.97, out.y);
      for (let i = 1; i <= 20; i++) {
        const y = (i / 20) * endY;
        const q = R.boardPoint(out.x, y);
        pts.push({ x: q.x, y: q.y, r: R.ballROnBoard(y) });
      }
    }
    const len = [0];
    for (let i = 1; i < pts.length; i++) {
      len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    return { pts, len };
  }

  /** Interpolate the polyline at arc length `s`. */
  _atLength(path, s) {
    const { pts, len } = path;
    const total = len[len.length - 1];
    const d = clamp(s, 0, total);
    let i = 1;
    while (i < len.length - 1 && len[i] < d) i += 1;
    const span = Math.max(1e-6, len[i] - len[i - 1]);
    const k = (d - len[i - 1]) / span;
    const a = pts[i - 1], b = pts[i];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: a.r + (b.r - a.r) * k };
  }

  _ballNow(now) {
    const f = this.flight;
    if (!f) return null;
    const el = now - f.t0;
    const total = f.path.len[f.path.len.length - 1];

    if (f.short) {
      // Up, decelerating to a standstill at the apex, then back down. One curve, mirrored: no
      // separate "rolls back" animation to get out of step with the way out.
      if (el < f.rollMs) {
        const k = el / f.rollMs;
        return this._atLength(f.path, total * k * (2 - k));
      }
      const k = clamp((el - f.rollMs) / f.backMs, 0, 1);
      const p = this._atLength(f.path, total * (1 - k * k));
      return { ...p, fading: k > 0.75 ? (k - 0.75) / 0.25 : 0 };
    }

    if (el < f.rollMs) {
      // Constant deceleration from v0 to ROLL_KEEP*v0 across the whole path. No easing curve is
      // layered on top: the polyline already carries the perspective, and stacking a hand-drawn
      // ease on that is half of what made the old one read as three unrelated speeds.
      const k = el / f.rollMs;
      return this._atLength(f.path, (total * ((2 * k) - (1 - ROLL_KEEP) * k * k)) / (1 + ROLL_KEEP));
    }

    // The drop. A ball that found a CUP disappears into it; a ball that only made the playfield
    // stays on top of it and just settles, because there is no hole under it to fall through.
    const end = this._atLength(f.path, total);
    const k = clamp((el - f.rollMs) / f.dropMs, 0, 1);
    const sank = f.out.kind === 'hit' && f.out.target && !this._isCatchAll(f.out.target);
    if (sank) return { x: end.x, y: end.y + k * end.r * 0.5, r: end.r * (1 - k * 0.85) };
    return { x: end.x, y: end.y + k * 2, r: end.r, fading: k > 0.55 ? (k - 0.55) / 0.45 : 0 };
  }

  /** The board's big consolation target - a ball resting on the playfield, not sunk in anything. */
  _isCatchAll(id) {
    const t = this.game.board.targets.find((z) => z.id === id);
    return !!t && t.kind === 'ring';
  }

  _flightDone(now) {
    const f = this.flight;
    return !!f && (now - f.t0) >= f.rollMs + f.backMs + f.dropMs;
  }

  _landed() {
    const out = this.flight.out;
    this.flight = null;
    this.pending = null;
    this.popup = {
      t0: performance.now(),
      // At the LANDING POINT, for the same reason the ball flies there: a "+10" floating over the
      // middle of the ring when the ball stopped near the left rail reads as the board deciding
      // for you.
      at: R.boardPoint(out.x, Math.min(0.97, out.y)),
      text: out.kind === 'short' ? t('short')
        : out.kind === 'over' ? t('over')
          : out.kind === 'miss' ? t('miss')
            : `${out.scored}${out.multiplied ? '!' : ''}`,
    };
    this._paintHud();
    this._save();
  }

  _afterPopup() {
    this.popup = null;
    if (this.game.over) { this._finish(); return; }
    this.hintEl.hidden = false;
    this._paintHud();
  }

  _paintHud() {
    if (!this.game || this.screen !== 'game') return;
    const el = this.root.querySelector('[data-role="balls"]');
    if (el) el.textContent = this.game.over ? '' : t('balls_left', { n: this.game.ballsLeft });
  }

  /** The three numbers on the cabinet head, plus the live score. */
  _marqueeRows() {
    const sk = sub();
    const id = this.game.board.id;
    const world = this.appWide[id];
    const shown = this.game.score - (this.pending || 0);
    return [
      { label: t('m_world'), value: world && world.score ? world.score : '—', tone: 'dim' },
      { label: t('m_score'), value: shown, tone: 'lit' },
      { label: t('m_best'), value: Math.max(bestOn(sk, id), todayBestOn(sk, id)) || '—', tone: 'dim' },
    ];
  }

  _startLoop() {
    this._stopLoop();
    const frame = () => { this.raf = requestAnimationFrame(frame); this._draw(); };
    this.raf = requestAnimationFrame(frame);
  }
  _stopLoop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  _draw() {
    if (!this.ctx || !this.machine || !this.game) return;
    const now = performance.now();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.machine, 0, 0);
    const { scale, ox, oy } = this.layout;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.save(); c.translate(ox, oy); c.scale(scale, scale);

    R.drawMarquee(c, this.game.board, this._marqueeRows());
    R.drawQueue(c, this.game.over ? 0 : this.game.ballsLeft - (this.flight ? 1 : 0));
    if (!this.game.over && this.game.multTarget && !this.popup) {
      R.drawMultiplier(c, this.game.board, this.game.multTarget, 0.5 + 0.5 * Math.sin(now / 320));
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
      else R.drawPopup(c, this.popup.at, this.popup.text, k);
    }
    if (this.drag && this.drag.pts.length > 1) R.drawAimGuide(c, this.drag.aim);
    c.restore();
  }

  _save() {
    if (!this.game) return;
    if (this.game.over) { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } return; }
    writeJSON(SAVE_KEY, this.game.snapshot());
  }

  _finish() {
    this._stopLoop();
    this.hintEl.hidden = true;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* a stale save only costs a stale Resume */ }

    const g = this.game;
    const sk = sub();
    const prevBest = bestOn(sk, g.board.id);
    const unlocked = g.unlocks();

    // Record ONCE, before the card shows, so a fast "play again" can never skip it.
    if (!this.recorded) {
      this.recorded = true;
      try {
        recordSkeeball(g.board.id, {
          score: g.score, balls: g.tally.balls, hundreds: g.tally.hundreds,
          fifties: g.tally.fifties, bestThrow: g.tally.bestThrow, at: Date.now(),
        });
        if (unlocked) unlockSkeeballBoard(unlocked.id);
      } catch (err) { console.error('[skeeball] stats record failed - this game is not counted', err); }
    }

    const newBest = g.score > prevBest;
    const nxt = nextBoard(g.board.id);
    const modal = document.createElement('div');
    modal.className = 'sk-modal';
    modal.innerHTML = `
      <div class="sk-modal-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="sk-x" data-role="close" aria-label="${t('aria_close')}">✕</button>
        <h3 class="sk-modal-h">${t('game_over')}</h3>
        <p class="sk-modal-score">${g.score}</p>
        ${newBest ? `<p class="sk-modal-line"><b>${t('new_best')}</b></p>` : ''}
        ${unlocked ? `<p class="sk-unlocked">${t('unlocked', { board: t(unlocked.nameKey) })}</p>`
          : nxt ? `<p class="sk-modal-line">${t('unlock_progress', { n: nxt.unlockScore, board: t(nxt.nameKey) })}</p>` : ''}
        <div class="sk-modal-actions">
          <button type="button" class="sk-play" data-role="again">${t('play_again')}</button>
          <button type="button" class="sk-howto" data-role="pick">${t('change_machine')}</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="again"]')) { modal.remove(); this.startGame(); }
      else if (e.target.closest('[data-role="pick"]')) { modal.remove(); this.renderPicker(); }
      else if (e.target.closest('[data-role="close"]')) modal.remove();   // X: no forced rematch
    });
    this.gameEl.appendChild(modal);
  }

  _rerenderForLang() {
    if (this.screen === 'pick') { this.renderPicker(); return; }
    const hint = this.root.querySelector('[data-role="hint"]');
    if (hint) hint.textContent = t('drag_to_throw');
    const cv = this.root.querySelector('[data-role="canvas"]');
    if (cv) cv.setAttribute('aria-label', t('aria_lane'));
    this._paintHud();
  }

  destroy() {
    this._stopLoop();
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
    if (this._offPlayers) { try { this._offPlayers(); } catch { /* already gone */ } }
    this._closeHelp();
    document.querySelectorAll('.sk-ht-host').forEach((n) => n.remove());
    this.root.innerHTML = '';
    this.game = null;
    this.machine = null;
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
}
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
/** Autosave/resume meaning: solo play is lossless to leave, so always false. */
export function isInProgress() { return false; }

export default { init, destroy, isInProgress };
