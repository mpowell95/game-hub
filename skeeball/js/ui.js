// skeeball/js/ui.js - the DOM shell, the swipe, and the hub module contract.
//
// Three screens plus overlays, all mounted into the one container the hub hands us: SETUP (the
// machine gallery and its records), PLAY (the canvas under a marquee-style HUD, the swipe
// surface that IS the lane), OVER (the finished rack, with a close X per root CLAUDE.md's rule).
//
// This file owns the clock, the storage keys and every listener. The rules live in game.js, the
// machines in boards.js, the solver in physics.js, the pixels in render.js.
//
// GUARD: isInProgress() is the AUTOSAVE/RESUME meaning of the module contract (root CLAUDE.md,
// "The module contract" - Escoba's class, not Ball Run's) and always returns FALSE, even
// mid-rack - the between-throws state is snapshotted after every settled ball, so leaving is
// lossless. A ball in flight is not part of the saved state.

import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { Renderer } from './render.js';
import { BOARDS, boardById, unlocksEarned, DEFAULT_BOARD } from './boards.js';
import { swipeSpeed, powerOf, launchSpeed } from './swipe.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the setup screen themes standalone
import { onViewportResize } from '../../js/viewport.js';
import { loadStats, recordSkeeball, unlockSkeeballBoard, deviceId } from '../../js/game-stats.js';
import { readGoals, goalsWon, GOAL_BEST, GOAL_TOTAL } from './goals.js';
import { getStatsApp } from '../../js/firebase-boot.js';
import { syncMyStats, readPlayersOnce } from '../../js/stats-net.js';
import { aggregatePlayers } from '../../js/players-agg.js';
import { bestOn, todayBestOn, appWideBest, isUnlocked } from '../../js/arcade-scores.js';
import { loadProfile } from '../../js/profile-store.js';

const t = makeT(STRINGS);

const SETTINGS_KEY = 'gamehub.skeeball.v1';   // { board } - a one-tap-recreatable preference
const SAVE_KEY = 'gamehub.skeeball.save.v1';  // the mid-rack snapshot (game.js's shape)

let instance = null;

function ensureCSS() {
  // The shared primitives first (the setup screen is BUILT on css/ui.css - the same injection
  // marker bug-report-ui.js uses, so the two never double-load it), then the game's own sheet.
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-sk-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/skeeball.css', import.meta.url).href;
  link.setAttribute('data-sk-css', '1');
  document.head.appendChild(link);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { board: typeof s.board === 'string' ? s.board : DEFAULT_BOARD };
  } catch { return { board: DEFAULT_BOARD }; }
}
function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* a preference, not history */ }
  return s;
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1) return null;
    const used = s.ballsUsed | 0;
    return used > 0 && used < BALLS_PER_GAME ? s : null;
  } catch { return null; }
}
function writeSave(snap) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snap)); } catch (err) { console.error('[skeeball] autosave failed', err); }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to lose - the rack is recorded */ }
}

/** One throwaway Renderer draws the machine (no ball) to an off-DOM canvas we read back as a
 *  JPEG - render.js sets preserveDrawingBuffer, so the canvas is readable, and the WebGL context
 *  is disposed immediately after. This is how the setup carousel (and later the how-to card) show
 *  the ACTUAL machine rather than a drawing (batch G, 2026-08-18). Returns null on any failure so
 *  the caller keeps its placeholder rather than breaking. */
function renderMachineImage(board) {
  try {
    const c = document.createElement('canvas');
    const r = new Renderer(c, board);
    r.framePreview(600, 800);
    r.render(null, 0);
    const url = c.toDataURL('image/jpeg', 0.85);
    r.dispose();
    return url;
  } catch (err) {
    console.error('[skeeball] machine preview render failed', err);
    return null;
  }
}

/** This player's own records for a board, straight from the shared store (never a local copy). */
function myRecords(boardId) {
  try {
    const sk = (loadStats().games.skeeball || {}).sk || {};
    return { mine: bestOn(sk, boardId), today: todayBestOn(sk, boardId, Date.now()) };
  } catch { return { mine: 0, today: 0 }; }
}

export class SkeeballUI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.screen = 'setup';
    this.game = null;
    this.renderer = null;
    this.raf = 0;
    this.last = 0;
    this.recorded = false;
    this.lastScore = null;             // this session's most recent finished rack, per board id
    this.overlay = null;
    this.swipe = null;                 // active pointer samples while a swipe is live
    this._pending = null;              // a captured ball's score, held until it has settled
    this.msgTimer = 0;
    this.top = {};                     // boardId -> { score, name } once the network answers
    this.hubAvg = null;                // hub-wide average score across synced players (game-over card)
    this._machineImg = {};             // boardId -> cached data URL of the actual machine render

    this._onPointerMove = (e) => this._swipeMove(e);
    this._onPointerUp = (e) => this._swipeEnd(e);
    // GUARD: A CANCELLED GESTURE IS NOT A THROW. pointercancel fires when the browser takes the
    // pointer away mid-swipe - switching apps, a system edge-swipe, a call arriving - and it used
    // to run the same handler as pointerup, so leaving the game with a finger down launched a ball
    // the player never released (Matt, 2026-08-21). Dropping the samples IS the fix.
    this._onPointerCancel = () => { this.swipe = null; };
    // Same reason one layer out: some platforms hide the page without ever cancelling the pointer.
    this._onHide = () => { if (document.visibilityState === 'hidden') this.swipe = null; };
    this._loop = (ts) => this._frame(ts);

    ensureCSS();
    this.root.classList.add('sk-root');
    this.root.innerHTML = '';

    this._unsubLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); });
    this._unsubViewport = onViewportResize(() => this._fit());
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    document.addEventListener('visibilitychange', this._onHide);

    // The landscape door. On <body> rather than inside this.root, because every screen change
    // replaces this.root's innerHTML and would take it with it. Visibility is entirely the
    // stylesheet's; this only has to exist and carry the translated line.
    this._rotate = document.createElement('div');
    this._rotate.className = 'sk-rotate';
    this._rotate.innerHTML = `<p>${esc(t('rotate'))}</p>`;
    document.body.appendChild(this._rotate);

    this._refreshTopRecords();
    // A RELOAD MID-RACK PUTS YOU BACK ON THE LANE, not on the gallery. The rack always survived
    // a refresh, but you landed on the machine screen and had to find Resume - two taps back to
    // a game you never left (playtest, 2026-08-21).
    const resume = loadSave();
    if (resume) this._startGame(resume); else this._renderSetup();
  }

  // --- records ---------------------------------------------------------------------------------

  /** The app-wide best on each machine: derived from the synced player records (js/arcade-scores
   *  appWideBest over js/players-agg rows - deliberately no separate highscores node; see that
   *  file's header). Local history is merged in so a device that has never synced still shows
   *  its own truth. Async and best-effort: the panel renders with the local answer first. */
  async _refreshTopRecords() {
    let rows = [];
    try { rows = aggregatePlayers(await readPlayersOnce()); }
    catch { rows = []; /* offline: local merge below still answers */ }
    if (this.disposed) return;
    let myName = '';
    try { myName = (loadProfile()?.name || '').trim(); } catch { /* no profile is fine */ }
    for (const b of BOARDS) {
      const remote = appWideBest(rows, 'skeeball', 'sk', b.id);
      const localBest = myRecords(b.id).mine;
      this.top[b.id] = localBest > remote.score ? { score: localBest, name: myName } : remote;
      const slot = this.root.querySelector(`[data-rec-top="${b.id}"]`);
      if (slot && this.top[b.id].score) {
        slot.textContent = this._topText(b.id);
      }
      const line = this.root.querySelector(`[data-rec-top-line="${b.id}"]`);
      if (line && this.top[b.id].score) {
        line.textContent = String(this.top[b.id].score);
      }
    }
    // Hub-wide average score across every synced player (lifetime points / games), for the
    // game-over card. Falls to null offline; the tile then shows a dash and fills in once online.
    let hubPts = 0, hubGames = 0;
    for (const r of rows) {
      const sk = r && r.games && r.games.skeeball && r.games.skeeball.sk;
      if (sk) { hubPts += sk.points | 0; hubGames += sk.played | 0; }
    }
    this.hubAvg = hubGames ? Math.round(hubPts / hubGames) : null;
    // The network answer is what fills in the All Time column, so repaint the backboard with it.
    this._pushScoreboard();
  }

  /**
   * Hand the renderer the four records its backboard paints. Called on mount, when the network
   * answers with the app-wide best, and after every finished rack.
   *
   * The All Time column carries the RECORD HOLDER'S NAME as well as the score - it is the only
   * one of the four that can belong to somebody else. The other three are always this player's.
   * The labels are passed in translated, because the renderer has no t() of its own.
   */
  _pushScoreboard() {
    if (!this.renderer || !this.game) return;
    const id = this.game.board.id;
    const mine = myRecords(id);
    this.renderer.sbLabels = {
      allTime: t('sb_all_time'),
      best: t('sb_your_best'),
      today: t('sb_today'),
      last: t('sb_last_game'),
    };
    this.renderer.setScoreboard({
      allTime: this.top[id] || null,
      best: mine.mine || 0,
      today: mine.today || 0,
      last: this.lastScore && this.lastScore.board === id ? this.lastScore.score : null,
    });
  }

  _topText(boardId) {
    const top = this.top[boardId];
    if (!top || !top.score) return '-';
    return top.name ? `${top.score} · ${top.name}` : String(top.score);
  }

  // --- the machine gallery ---------------------------------------------------------------------

  _renderSetup() {
    this.screen = 'setup';
    this._stopLoop();
    this._closeOverlay();
    this.game = null;
    if (this.renderer) this.renderer.dispose();
    this.renderer = null;

    let sk = {};
    try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
    const save = loadSave();
    const board = boardById(this.settings.board);
    const val = (n) => (n ? String(n) : '-');

    // Your average, game-wide (lifetime points / games). One machine today, so this IS the Classic
    // average; a per-board average would need a per-board points sum the store does not keep yet.
    let myAvg = null;
    try { if (sk.played) myAvg = Math.round((sk.points | 0) / sk.played); } catch { /* fine */ }

    // A swipeable carousel of machines (Matt's call over Escoba's accordion): one slide per
    // machine, each showing that machine's ACTUAL board (render.js render, cached as an image),
    // never a drawing. Locked machines show a padlock. Scroll-snap does the swipe; with one
    // machine there is a single centred card and no carousel chrome.
    const idx = Math.max(0, BOARDS.findIndex((b) => b.id === board.id));
    const slides = BOARDS.map((b) => {
      const open = isUnlocked(sk, b.id, DEFAULT_BOARD);
      if (!open) {
        const from = boardById(b.unlock.board);
        return `<div class="sk-slide sk-slide-locked" data-board="${b.id}">
          <div class="sk-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
          <p class="sk-slide-name">${esc(b.name)}</p>
          <p class="sk-slide-locktext">${esc(t('unlock_hint', { score: b.unlock.score, name: from.name }))}</p>
        </div>`;
      }
      const r = myRecords(b.id);
      return `<div class="sk-slide" data-board="${b.id}">
        <p class="sk-slide-name">${esc(b.name)}</p>
        <div class="sk-slide-machine"><img class="sk-slide-img" data-machine="${b.id}" alt="${esc(b.name)}" /></div>
        <div class="sk-slide-recwide"><em>${esc(t('over_hub_record'))}</em><b data-rec-top="${b.id}">${esc(this._topText(b.id))}</b></div>
        <div class="sk-slide-rec3">
          <div class="sk-slide-rec"><b>${val(r.mine)}</b><em>${esc(t('rec_mine'))}</em></div>
          <div class="sk-slide-rec"><b>${val(r.today)}</b><em>${esc(t('rec_today'))}</em></div>
          <div class="sk-slide-rec"><b>${val(myAvg)}</b><em>${esc(t('over_your_avg'))}</em></div>
        </div>
      </div>`;
    }).join('');
    const multi = BOARDS.length > 1;

    this.root.innerHTML = `
      <div class="sk-setup">
        <div class="sk-setup-inner">
          <h1 class="sk-title">${esc(t('title'))}</h1>
          <div class="sk-carwrap">
            <div class="sk-car" data-role="car">${slides}</div>
            ${multi ? `<button type="button" class="sk-car-chev l" data-role="prev" aria-label="${esc(t('prev_machine'))}">&#8249;</button>
            <button type="button" class="sk-car-chev r" data-role="next" aria-label="${esc(t('next_machine'))}">&#8250;</button>` : ''}
          </div>
          ${multi ? `<div class="sk-car-dots" data-role="dots">${BOARDS.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>
          <p class="sk-car-hint">${esc(t('car_hint'))}</p>` : ''}
          ${save ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">
            ${esc(t('resume'))} &middot; ${(save.ballsUsed | 0) + 1}/${BALLS_PER_GAME}</button>` : ''}
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="howto">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5c-1.6-1-4.2-1.5-6.2-1.5-1 0-1.8.1-1.8.1v12s.8-.1 1.8-.1c2 0 4.6.5 6.2 1.5 1.6-1 4.2-1.5 6.2-1.5 1 0 1.8.1 1.8.1v-12s-.8-.1-1.8-.1c-2 0-4.6.5-6.2 1.5z"/><path d="M12 6.5V18.6"/></svg>
            ${esc(t('howto'))}</button>
          <button type="button" class="gh-btn ${save ? 'gh-btn--ghost' : 'gh-btn--primary'} gh-btn--block" data-role="play">
            ${esc(save ? t('new_game') : t('play'))}</button>
        </div>
      </div>`;

    // Paint each unlocked machine's actual board (cached), deferred so the setup shows first.
    for (const b of BOARDS) {
      if (!isUnlocked(sk, b.id, DEFAULT_BOARD)) continue;
      const imgEl = this.root.querySelector(`img[data-machine="${b.id}"]`);
      if (imgEl) this._ensureMachineImg(b, imgEl);
    }

    // The centred slide IS the selected machine. Scroll-snap does the swipe; this settle listener
    // pins the selection and the active dot. No-op with one machine (nothing scrolls).
    const car = this.root.querySelector('[data-role="car"]');
    if (car && multi) {
      requestAnimationFrame(() => { car.scrollLeft = idx * car.clientWidth; });
      let rafId = 0;
      car.addEventListener('scroll', () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const w = car.clientWidth || 1;
          const i = Math.max(0, Math.min(BOARDS.length - 1, Math.round(car.scrollLeft / w)));
          const b = BOARDS[i];
          if (b && isUnlocked(sk, b.id, DEFAULT_BOARD) && b.id !== this.settings.board) {
            this.settings = saveSettings({ board: b.id });
          }
          this.root.querySelectorAll('[data-role="dots"] i').forEach((d, di) => d.classList.toggle('on', di === i));
        });
      }, { passive: true });
      const prev = this.root.querySelector('[data-role="prev"]');
      const next = this.root.querySelector('[data-role="next"]');
      if (prev) prev.addEventListener('click', () => car.scrollBy({ left: -car.clientWidth, behavior: 'smooth' }));
      if (next) next.addEventListener('click', () => car.scrollBy({ left: car.clientWidth, behavior: 'smooth' }));
    }

    if (save) {
      this.root.querySelector('[data-role="resume"]').addEventListener('click', () => {
        this._startGame(loadSave());
      });
    }
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this._showHowTo());
    // New game DISCARDS a banked mid-rack snapshot - the player's explicit choice (the snapshot
    // is a resume convenience, not earned history; the Resume button sits directly above).
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => {
      clearSave();
      this._startGame(null);
    });
  }

  /** Render a machine's ACTUAL board (render.js) to a cached image and show it in `imgEl`,
   *  deferred one frame so the setup paints first. A failure leaves the dark placeholder. */
  _ensureMachineImg(board, imgEl) {
    const cached = this._machineImg[board.id];
    if (cached) { imgEl.src = cached; return; }
    requestAnimationFrame(() => {
      if (this.disposed) return;
      const url = renderMachineImage(board);
      if (!url) return;
      this._machineImg[board.id] = url;
      imgEl.src = url;
    });
  }

  _showHowTo() {
    const board = boardById(this.settings.board);
    // Mancala's how-to chrome (dark modal, white card, chunky OK) but the illustration is a LIVE
    // throw: the real engine (render.js + game.js physics) loops a scoring roll, so it looks like an
    // actual ball was thrown rather than a flat overlay. The caption cross-fades roll -> unlock.
    const el = document.createElement('div');
    el.className = 'sk-hp-veil';
    el.innerHTML = `
      <div class="sk-hp-modal" role="dialog" aria-modal="true" aria-label="${esc(t('howto_h'))}">
        <div class="sk-hp-title">${esc(t('howto_h'))}</div>
        <div class="sk-hp-card">
          <div class="sk-hp-panel"><canvas class="sk-hp-canvas" aria-hidden="true"></canvas></div>
          <p class="sk-hp-cap">
            <span class="c1">${esc(t('ht_roll'))}</span>
            <span class="c2">${esc(t('ht_unlock'))}</span>
          </p>
        </div>
        <button type="button" class="sk-hp-ok" data-role="ok">${esc(t('ht_ok'))}</button>
      </div>`;
    this._closeOverlay();
    this._stopHpDemo();
    this.root.appendChild(el);
    this.overlay = el;
    const canvas = el.querySelector('.sk-hp-canvas');
    // Start after layout so the canvas has real dimensions to size the renderer to.
    if (canvas) requestAnimationFrame(() => { if (this.overlay === el) this._startHpDemo(board, canvas); });
    const close = () => {
      this._stopHpDemo();
      if (el.parentNode) el.parentNode.removeChild(el);
      if (this.overlay === el) this.overlay = null;
    };
    el.querySelector('[data-role="ok"]').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }

  /** The how-to illustration is a REAL throw, looped: the actual renderer + physics engine, a
   *  measured power that scores the 50, re-thrown after it settles. That is why it looks like a
   *  thrown ball and not an overlay - it IS the game. Torn down by _stopHpDemo on close/destroy. */
  _startHpDemo(board, canvas) {
    try {
      this._stopHpDemo();
      const rect = canvas.getBoundingClientRect();
      const R = new Renderer(canvas, board);
      R.resize(Math.max(2, Math.round(rect.width)), Math.max(2, Math.round(rect.height)));
      this._hpRenderer = R;
      this._hpGame = new SkeeballGame(board.id);
      this._hpLast = 0;
      this._hpSettleAt = 0;
      this._hpThrown = false;
      this._hpPending = null;
      // Reduced motion: one still frame (the machine with a ball ready at the serve spot), no loop.
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { R.render(this._hpGame, 0); return; }
      const frame = (ts) => {
        if (!this._hpRenderer || !this._hpGame) return;
        this._hpRaf = requestAnimationFrame(frame);
        const now = ts / 1000;
        const dt = Math.min(this._hpLast ? now - this._hpLast : 1 / 60, 0.05);
        this._hpLast = now;
        this._hpGame.update(dt);
        // Minimal event drain (mirrors _drainEvents): light the rim on capture, pop the score on
        // ballDone, so the demo shows the ball dropping in AND the +50.
        for (const ev of this._hpGame.takeEvents()) {
          if (ev.type === 'capture') { this._hpRenderer.flashHole(ev.hole); this._hpPending = { pos: ev.pos, value: ev.value }; }
          else if (ev.type === 'ballDone') {
            const at = this._hpPending; this._hpPending = null;
            if (at) {
              const gold = at.value >= 100, big = at.value >= 50;
              this._hpRenderer.popupAt(at.pos, `+${at.value}`, gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
              if (big) this._hpRenderer.burstAt(at.pos, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
              if (gold) this._hpRenderer.celebrate();
            }
          }
        }
        this._hpRenderer.render(this._hpGame, dt);
        if (!this._hpGame.ball) {
          if (!this._hpSettleAt) this._hpSettleAt = now;
          const pause = this._hpThrown ? 1.3 : 0.5;
          if (now - this._hpSettleAt > pause) {
            if (this._hpGame.over) this._hpGame = new SkeeballGame(board.id);  // fresh rack, loops forever
            this._hpGame.throwBall({ power: 0.60, aim: 0 });   // measured: a straight 0.60 scores the 50
            this._hpThrown = true;
            this._hpSettleAt = 0;
          }
        } else {
          this._hpSettleAt = 0;
        }
      };
      this._hpRaf = requestAnimationFrame(frame);
    } catch (err) {
      console.error('[skeeball] how-to demo failed', err);
      this._stopHpDemo();
    }
  }

  _stopHpDemo() {
    if (this._hpRaf) { cancelAnimationFrame(this._hpRaf); this._hpRaf = 0; }
    if (this._hpRenderer) { this._hpRenderer.dispose(); this._hpRenderer = null; }
    this._hpGame = null;
    this._hpPending = null;
  }

  // --- play ------------------------------------------------------------------------------------

  _startGame(snap) {
    const board = boardById(this.settings.board);
    this.screen = 'play';
    this.recorded = false;
    this._closeOverlay();
    this.game = snap ? SkeeballGame.restore(snap) : new SkeeballGame(board.id);

    const pips = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');

    this.root.innerHTML = `
      <div class="sk-play-wrap">
        <button type="button" class="sk-menu" data-role="machines" aria-label="${esc(t('quit'))}">☰</button>
        <!-- THE LIVE RACK, DIRECTLY ABOVE THE MACHINE. GUARD: this is IN FLOW, above the stage,
             NOT floated over it. Floated, it overlapped the machine's own marquee the moment the
             stage went full-bleed - the renderer fits the machine to whatever height the stage
             has, so anything lying on top of the stage collides with it. In flow, the stage gets
             what is left and the two can never meet. It is no longer a bar at the very top of the
             screen either: that was too far from the board to catch the eye, and it crowded the
             hub's floating Hub button. No TOP/BEST/TODAY strip here - those records are painted
             on the machine's own backboard (render.js setScoreboard), never shown twice. -->
        <div class="sk-rack">
          <div class="sk-hud-name">${esc(this.game.board.name)}</div>
          <div class="sk-score" data-role="score" aria-label="${esc(t('hud_score_aria'))}">${this.game.score}</div>
          <div class="sk-pips" data-role="pips" aria-label="${esc(t('hud_ball'))}">${pips}</div>
        </div>
        <div class="sk-stage" data-role="stage">
          <canvas class="sk-canvas" data-role="canvas" role="img" aria-label="${esc(t('aria_lane'))}"></canvas>
          <div class="sk-msg" data-role="msg" aria-live="polite"></div>
          <div class="sk-swipe" data-role="swipe" aria-hidden="true">
            <span class="sk-hint" data-role="hint">${esc(t('hint_swipe'))}</span>
          </div>
        </div>
      </div>`;

    this.el = {
      stage: this.root.querySelector('[data-role="stage"]'),
      canvas: this.root.querySelector('[data-role="canvas"]'),
      score: this.root.querySelector('[data-role="score"]'),
      pips: this.root.querySelector('[data-role="pips"]'),
      msg: this.root.querySelector('[data-role="msg"]'),
      hint: this.root.querySelector('[data-role="hint"]'),
      swipe: this.root.querySelector('[data-role="swipe"]'),
    };
    this._shownScore = this.game.score;   // what the counter is currently showing; see _paintHud

    if (this.renderer) this.renderer.dispose();
    this.renderer = new Renderer(this.el.canvas, this.game.board);
    this._pushScoreboard();
    this._bindPlay();
    this._fit();
    this.last = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  _bindPlay() {
    this.root.querySelector('[data-role="machines"]').addEventListener('click', () => {
      // Mid-rack state is already banked (autosave lands after every settled ball), so leaving
      // for the gallery is lossless; the card's button will say Resume.
      this._renderSetup();
    });
    const zone = this.el.swipe;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.game || !this.game.canThrow()) return;
      // e.timeStamp, never performance.now(): the sample must carry the EVENT's time. Under
      // load the handler runs late and bunched, and clocking samples at handler time collapses
      // the measured flick speed - a strong swipe reads as a dribble on a busy frame.
      this.swipe = { id: e.pointerId, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });
    // Bound to the ZONE, never to document: a non-passive document-level touchmove kills
    // compositor scrolling for the whole page while the game is mounted (root CLAUDE.md's
    // scroll and touch rules). The zone is where every throw starts, so nothing is lost.
    zone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  _swipeMove(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const s = this.swipe.samples;
    s.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });   // event time, not handler time
    if (s.length > 48) s.shift();
  }

  _swipeEnd(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const samples = this.swipe.samples;
    this.swipe = null;
    if (!this.game || !this.game.canThrow() || samples.length < 2) return;
    const first = samples[0];
    const end = samples[samples.length - 1];

    // THE SWIPE MATHS LIVES IN js/swipe.js AND IS NOT REPEATED HERE. skeeball/flick-test.html
    // imports the same file, so the number that page prints IS the number this line computes.
    // They used to be two hand-copied copies, and they drifted inside a single edit - see that
    // file's header for exactly how, and what it cost.
    const perH = swipeSpeed(samples, window.innerHeight);
    if (perH == null) return;                              // a tap or a sideways smudge
    // NOT CLAMPED to 0..1: swipe.js's SWIPE_SLOW/SWIPE_FAST mark the ends of the NATURAL range,
    // not of what a throw can be, and physics.js extrapolates past both.
    const power = powerOf(perH);

    // The throw's params, logged with their real result at ballDone (see _drainEvents /
    // _logThrow), so there is measured data (flick -> power -> launch -> actual hole) and not
    // just the calculation. GUARD: this is RECORDED, never displayed. The on-screen readout of it
    // came off 2026-08-20 - players have no use for it - but the logging behind it stays, because
    // it is the only way to check the curve against people who are not Matt. Read it back with
    // read-skeeball-throws.mjs.
    const launch = launchSpeed(power, this.game.board.geom.minSpeed, this.game.board.geom.maxSpeed);

    // AIM: the direction of the whole swipe, eased so a small wobble stays small and a
    // deliberate diagonal still reaches the corner 100s. This shapes the INPUT only - once
    // thrown, the ball is the engine's and is never touched again: no magnetism, no correction.
    // GUARD: the divisor is set by the real maximum diagonal a thumb can reach on a 393px
    // screen, not a round number - too large a divisor and the corner 100s need a swipe angle
    // that physically doesn't fit on the screen, making them unreachable.
    const raw = Math.max(-1, Math.min(1, Math.atan2(end.x - first.x, first.y - end.y) / 0.38));
    const aim = Math.sign(raw) * (raw * raw);

    if (this.game.throwBall({ power, aim })) {
      if (this.el.hint) { this.el.hint.classList.add('is-gone'); }
      // Held until the ball settles, then logged with its real result at ballDone.
      this._lastThrow = { flick: +perH.toFixed(3), power: +power.toFixed(3), aim: +aim.toFixed(3), launch: +launch.toFixed(3) };

      this._throwStats = { bounces: 0, backboard: 0, impact: false, impactSpeed: null, seq: [],
        t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
    }
  }

  /** THE ONLY THING THIS GAME SENDS ANYWHERE BESIDES A SCORE. One settled throw's inputs and its
   *  real result, pushed to skeeballThrows/<deviceId>/, so the swipe curve can be checked against
   *  people who are not Matt rather than against the calculation. Kept deliberately for that
   *  (2026-08-20); it is what will say whether the 100 is reachable in real hands.
   *
   *  Best-effort and fire-and-forget: throwaway instrumentation, not player history, so a failed
   *  write is dropped rather than queued and never blocks the game. Read it back with
   *  read-skeeball-throws.mjs.
   *
   *  GUARD: NO CONTACT JOURNEY. This used to carry every part the ball touched on the way down -
   *  up to 300 entries per throw, per player, nine times a game. That existed to chase physics
   *  bugs which are now fixed, and nothing has read it since. What stays is what calibration
   *  actually needs: the flick, the power it mapped to, the aim, the launch speed, where it
   *  landed and how long it took. */
  async _logThrow(rec) {
    const full = { ...rec, board: (this.game && this.game.board.id) || this.settings.board,
      name: (loadProfile() || {}).name || '', at: Date.now() };
    try {
      const boot = await getStatsApp();
      if (!boot) return;
      const { db, api } = boot;
      await api.set(api.push(api.ref(db, 'skeeballThrows/' + deviceId())), full);
    } catch { /* throwaway instrumentation: a dropped write never becomes a player-visible error */ }
  }

  // --- the frame -------------------------------------------------------------------------------

  _frame(ts) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.game || !this.renderer) return;
    const now = ts / 1000;
    const dt = Math.min(this.last ? now - this.last : 1 / 60, 0.05);
    this.last = now;
    this.game.update(dt);
    this._drainEvents();
    this.renderer.render(this.game, dt);
    this._tickScore(dt);
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.el.msg.classList.remove('is-on');
        // The node is aria-live. Leaving the word in it after the fade means a screen reader goes
        // on announcing a MISS! from several throws ago, so the text goes out with the opacity.
        this.el.msg.textContent = '';
      }
    }
  }

  _stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** game.js's event stream becomes light and numbers. Presentation only - no branch here
   *  changes a score or a rule. */
  _drainEvents() {
    const Rr = this.renderer;
    for (const ev of this.game.takeEvents()) {
      const ts = this._throwStats;
      if (ts && ev.type !== 'contact') {
        ts.seq.push(ev.type);
        if (ev.type === 'bounce') ts.bounces++;
        else if (ev.type === 'backboard') ts.backboard++;
        else if (ev.type === 'impact') { ts.impact = true; if (ts.impactSpeed == null && typeof ev.speed === 'number') ts.impactSpeed = +ev.speed.toFixed(2); }
      }
      switch (ev.type) {
        // THE BALL SETTLES FIRST, THEN THE SCORE. `capture` fires the instant the ball's centre
        // crosses the mouth, which is ~300ms before it has finished dropping through the collar
        // - so announcing there put the number on screen while the ball was still visibly
        // rattling, and the throw was over before it looked over. All this does now is light the
        // rim the ball is going into, which is what a real machine does at exactly this moment.
        // The number, the burst and the marquee wait for `ballDone`.
        case 'capture':
          Rr.flashHole(ev.hole);
          this._pending = { pos: ev.pos, value: ev.value };
          break;
        case 'gutter':
          Rr.flashHole('gutter');
          this._say(t('msg_gutter'));
          break;
        // GUARD: a returned ball says NOTHING. It used to call "Too soft. Have it back." - a
        // scolding for a throw the player just watched fall short, and the most frequent message
        // in the game. Silence reads better; the ball rolling back IS the message.
        case 'returned':
          this._pending = null;
          break;
        case 'ballDone': {
          const at = this._pending;
          this._pending = null;
          if (at) {
            const gold = at.value >= 100, big = at.value >= 50;
            Rr.popupAt(at.pos, `+${at.value}`, gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
            if (big) Rr.burstAt(at.pos, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
            if (gold) Rr.celebrate();
          }
          this._paintHud();
          // GUARD: only with NOTHING in the air. A snapshot has no room for a ball in flight,
          // so saving mid-flight would quietly drop it and hand the player a free re-throw.
          if (!this.game.balls.length) writeSave(this.game.snapshot());
          if (this._lastThrow) {
            const ts = this._throwStats || {};
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            this._logThrow({ ...this._lastThrow, value: ev.value | 0, hole: String(ev.hole || '-'),
              bounces: ts.bounces | 0, backboard: ts.backboard | 0, touchedBoard: !!ts.impact,
              impactSpeed: (ts.impactSpeed != null ? ts.impactSpeed : null),
              settleMs: (ts.t0 ? Math.round(now - ts.t0) : null),
              seq: (ts.seq || []).join(','),
              drop: (at && at.pos) ? { x: +at.pos.x.toFixed(3), y: +at.pos.y.toFixed(3), z: +at.pos.z.toFixed(3) } : null });
            this._lastThrow = null; this._throwStats = null;
          }
          break;
        }
        case 'rackOver':
          this._rackOver(ev.result);
          break;
        default: break;                      // launch/impact/bounce/throw: the canvas already shows them
      }
    }
  }

  /** GUARD: the score is NOT written straight to the element here. It used to be, and points
   *  landing was a silent digit swap that was genuinely easy to miss - the ball, the burst and
   *  the number all happened at once and the number lost. _frame runs the count up to the new
   *  total (see _tickScore) and this only sets the target and fires the flash. */
  _paintHud() {
    this.el.score.classList.remove('is-hit');
    if (this.game.score > this._shownScore) {
      // reflow, so re-adding the class restarts the animation on a second score in a row
      void this.el.score.offsetWidth;
      this.el.score.classList.add('is-hit');
    } else {
      this._shownScore = this.game.score;      // a new rack: no run-up, just show it
      this.el.score.textContent = String(this.game.score);
    }
    this.el.pips.innerHTML = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');
  }

  /** Run the displayed score up to the real one. Deliberately quick - this is a machine totting
   *  up, not a progress bar - and always lands exactly on the target rather than easing into it. */
  _tickScore(dt) {
    if (!this.el || !this.el.score) return;
    const target = this.game.score;
    if (this._shownScore === target) return;
    // Whole points per second, scaled to the gap, so a 10 and a 100 both take about a third of
    // a second rather than the 100 taking ten times as long.
    const step = Math.max(1, Math.ceil((target - this._shownScore) * dt * 4.5));
    this._shownScore = Math.min(target, this._shownScore + step);
    this.el.score.textContent = String(this._shownScore);
  }

  _say(text) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('is-on');
    this.msgTimer = 1.8;
  }

  /** THE THREE GOALS, and how far along. GUARD: read fresh from the store every time rather than
   *  cached on `this` - a rack recorded on another device changes them, and this screen is the
   *  first thing shown after every game. js/goals.js explains why nothing is stored here. */
  _goalsMarkup() {
    const goals = readGoals();
    const label = {
      cups: t('goal_cups'),
      best: t('goal_best', { n: GOAL_BEST }),
      total: t('goal_total', { n: GOAL_TOTAL }),
    };
    const done = goals.every((g) => g.met);
    const rows = goals.map((g) => `
      <li class="sk-goal${g.met ? ' is-done' : ''}">
        <span class="sk-goal-tick" aria-hidden="true">${g.met ? '&#10003;' : ''}</span>
        <span class="sk-goal-text">${esc(label[g.id])}</span>
        <span class="sk-goal-num">${g.met ? esc(t('goal_done')) : `${g.now}/${g.target}`}</span>
      </li>`).join('');
    return `<div class="sk-goals${done ? ' is-all' : ''}">
        <p class="sk-goals-h">${esc(done ? t('goals_all') : t('goals_h'))}</p>
        <ul class="sk-goals-list">${rows}</ul>
      </div>`;
  }

  /** One firework per goal just earned, a bigger volley when that completed the set. Fired from
   *  _rackOver, which reads the goals BEFORE recording the rack and again after, so it celebrates
   *  the rack that actually earned it and can never fire twice for the same goal.
   *  GUARD: silent under reduced motion - the goals panel still says what was earned. */
  _fireworks(n, big) {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !this.root) return;
    const host = document.createElement('div');
    host.className = 'sk-fw' + (big ? ' is-big' : '');
    host.setAttribute('aria-hidden', 'true');
    const shots = big ? 7 : n;
    let html = '';
    for (let i = 0; i < shots; i++) {
      // Spread across the upper half, each a beat after the last, so they read as several
      // fireworks rather than one flash. Every spark is one element: cheap, and nothing to
      // tear down afterwards but the host.
      const x = 12 + (76 * (i + 0.5)) / shots + (i % 2 ? 6 : -6);
      const y = 18 + (i % 3) * 12;
      const delay = (i * (big ? 0.16 : 0.22)).toFixed(2);
      const hue = big ? [45, 28, 8, 45, 28, 8, 45][i % 7] : [45, 28, 8][i % 3];
      let sparks = '';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        sparks += `<i style="--dx:${(Math.cos(a) * 100).toFixed(0)}px;--dy:${(Math.sin(a) * 100).toFixed(0)}px"></i>`;
      }
      html += `<span class="sk-fw-burst" style="left:${x.toFixed(1)}%;top:${y}%;--d:${delay}s;--h:${hue}">${sparks}</span>`;
    }
    host.innerHTML = html;
    this.root.appendChild(host);
    setTimeout(() => host.remove(), big ? 3200 : 2400);
  }

  // --- the finished rack -----------------------------------------------------------------------

  _rackOver(result) {
    const board = this.game.board;
    // What stood BEFORE this rack lands in the store - that is what "NEW BEST" means.
    const prev = myRecords(board.id);
    const prevTop = (this.top[board.id] && this.top[board.id].score) || 0;
    const goalsBefore = readGoals();

    if (!this.recorded) {
      this.recorded = true;
      // Record ONCE (every write in js/game-stats.js is additive - a double call would inflate
      // the play count silently rather than fail loudly).
      try {
        recordSkeeball(board.id, { ...result, at: Date.now() });
      } catch (err) {
        console.error('[skeeball] could not record the rack', err);
      }
      try {
        for (const id of unlocksEarned(board.id, result.score)) unlockSkeeballBoard(id);
      } catch (err) {
        console.error('[skeeball] could not store an earned unlock', err);
      }
      try { syncMyStats(); } catch (err) { console.error('[skeeball] stats sync could not start', err); }
      clearSave();
    }
    this.lastScore = { board: board.id, score: result.score };

    // What this rack just earned. recordSkeeball has already run above, so the store is current.
    const won = goalsWon(goalsBefore, readGoals());
    if (won.fresh.length) this._fireworks(won.fresh.length, won.all);

    const now = myRecords(board.id);
    if (this.top[board.id] && result.score > (this.top[board.id].score | 0)) {
      let myName = '';
      try { myName = (loadProfile()?.name || '').trim(); } catch { /* fine */ }
      this.top[board.id] = { score: result.score, name: myName };
    }
    // The rack just finished, so all four of the backboard's records can have moved.
    this._pushScoreboard();
    const isTop = prevTop > 0 && result.score > prevTop;
    const isMine = result.score > prev.mine;
    const isToday = !isMine && result.score > prev.today;

    // One pill on the score, strongest claim first: machine record > personal best > best today.
    const pillKey = isTop ? 'over_new_top' : isMine ? 'over_new_mine' : isToday ? 'over_new_today' : '';
    const pill = pillKey ? `<span class="gh-chip gh-chip--accent sk-over-pill">${esc(t(pillKey))}</span>` : '';

    // Your average: lifetime points / games, from the store this rack was just written to.
    let myAvg = null;
    try {
      const sk = (loadStats().games.skeeball || {}).sk || {};
      if (sk.played) myAvg = Math.round((sk.points | 0) / sk.played);
    } catch { /* no stats is fine - the tile shows a dash */ }
    const dash = (n) => (n == null || n === '' || n === 0 ? '-' : String(n));

    // Hub-standard card (batch G): css/ui.css's .gh-overlay + .gh-modal, so it follows the hub
    // theme, plus the .sk-over-* skin for the score, the hub-wide-record row and the stat tiles.
    const el = document.createElement('div');
    el.className = 'gh-overlay sk-over-veil';
    el.innerHTML = `
      <div class="gh-modal sk-over" role="dialog" aria-label="${esc(t('over_h'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        <h2 class="sk-over-title">${esc(t('over_h'))}</h2>
        <p class="sk-over-machine">${esc(board.name)}</p>
        <p class="sk-over-score">${result.score}</p>
        ${pill}
        <div class="sk-over-rec">
          <em>${esc(t('over_hub_record'))}</em>
          <b>${esc(this._topText(board.id))}</b>
        </div>
        <div class="sk-over-tiles">
          <div class="sk-over-tile"><b>${dash(now.mine)}</b><span>${esc(t('rec_mine'))}</span></div>
          <div class="sk-over-tile"><b>${dash(now.today)}</b><span>${esc(t('rec_today'))}</span></div>
          <div class="sk-over-tile"><b>${dash(myAvg)}</b><span>${esc(t('over_your_avg'))}</span></div>
          <div class="sk-over-tile"><b>${dash(this.hubAvg)}</b><span>${esc(t('over_hub_avg'))}</span></div>
        </div>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${esc(t('over_again'))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="gallery">${esc(t('quit'))}</button>
        </div>
      </div>`;
    this._closeOverlay();
    this.root.appendChild(el);
    this.overlay = el;
    if (isMine || isTop) this.renderer.celebrate();
    el.querySelector('[data-role="again"]').addEventListener('click', () => this._startGame(null));
    el.querySelector('[data-role="gallery"]').addEventListener('click', () => this._renderSetup());
    // The X closes to the gallery rather than leaving a finished rack behind the sheet.
    el.querySelector('[data-role="close"]').addEventListener('click', () => this._renderSetup());
  }

  // --- overlays --------------------------------------------------------------------------------

  _closeOverlay() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    this.overlay = null;
  }

  // --- layout ----------------------------------------------------------------------------------

  _fit() {
    if (!this.renderer || !this.el || !this.el.stage) return;
    const r = this.el.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.resize(r.width, r.height);
  }

  // --- teardown --------------------------------------------------------------------------------

  destroy() {
    this.disposed = true;
    this._stopLoop();
    this._stopHpDemo();
    this._closeOverlay();
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    document.removeEventListener('visibilitychange', this._onHide);
    if (this._rotate) { this._rotate.remove(); this._rotate = null; }
    if (this._unsubLang) this._unsubLang();
    if (this._unsubViewport) this._unsubViewport();
    this.game = null;
    if (this.renderer) this.renderer.dispose();   // WebGL contexts leak if not released
    this.renderer = null;
    this.root.classList.remove('sk-root');
    this.root.innerHTML = '';
  }
}

// --- the hub module contract --------------------------------------------------------------------

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
  // Test hook (the __yzTest precedent): read-only access for the drivers that PLAY this game
  // headlessly - test-visual.mjs's probe and the session play scripts. Never used by the game.
  if (typeof window !== 'undefined') window.__skTest = { get ui() { return instance; } };
  return instance;
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** FALSE even mid-rack: this game is in the autosave/resume class of the contract (root
 *  CLAUDE.md, "The module contract"). Every settled ball snapshots to gamehub.skeeball.save.v1
 *  and the gallery's Play button becomes Resume, so leaving loses nothing worth confirming. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
