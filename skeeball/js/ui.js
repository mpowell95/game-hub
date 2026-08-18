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
import { howToMarkup } from './howto.js';
import { swipeSpeed, powerOf, launchSpeed } from './swipe.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the setup screen themes standalone
import { onViewportResize } from '../../js/viewport.js';
import { loadStats, recordSkeeball, unlockSkeeballBoard, deviceId } from '../../js/game-stats.js';
import { getStatsApp } from '../../js/firebase-boot.js';   // DEV throw-logging, remove before public
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
    this._loop = (ts) => this._frame(ts);

    ensureCSS();
    this.root.classList.add('sk-root');
    this.root.innerHTML = '';

    this._unsubLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); });
    this._unsubViewport = onViewportResize(() => this._fit());
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);

    this._refreshTopRecords();
    this._renderSetup();
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
    // Mancala's how-to treatment (mancala/js/howto.js): a dark modal with a white illustration
    // card. Here the illustration is the ACTUAL machine (the cached render) with a ball rolling up
    // into a cup, and the caption cross-fades roll -> unlock. Always dark, like Mancala's sheet.
    const el = document.createElement('div');
    el.className = 'sk-hp-veil';
    el.innerHTML = `
      <div class="sk-hp-modal" role="dialog" aria-modal="true" aria-label="${esc(t('howto_h'))}">
        <div class="sk-hp-title">${esc(t('howto_h'))}</div>
        <div class="sk-hp-card">
          <div class="sk-hp-panel">
            <img class="sk-hp-img" alt="${esc(board.name)}" />
            <span class="sk-hp-ball" aria-hidden="true"></span>
            <span class="sk-hp-score" aria-hidden="true">+50</span>
          </div>
          <p class="sk-hp-cap">
            <span class="c1">${esc(t('ht_roll'))}</span>
            <span class="c2">${esc(t('ht_unlock'))}</span>
          </p>
        </div>
        <button type="button" class="sk-hp-ok" data-role="ok">${esc(t('ht_ok'))}</button>
      </div>`;
    this._closeOverlay();
    this.root.appendChild(el);
    this.overlay = el;
    const img = el.querySelector('.sk-hp-img');
    if (img) this._ensureMachineImg(board, img);
    const close = () => { if (el.parentNode) el.parentNode.removeChild(el); if (this.overlay === el) this.overlay = null; };
    el.querySelector('[data-role="ok"]').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }

  /** The pattern's single-row rule (tic-tac-toe/CLAUDE.md): measure each line's rendered width
   *  against the container's real width, size down until it fits, then lock it with nowrap. */
  _fitHelpLines(el) {
    for (const line of el.querySelectorAll('.sk-ht-line')) {
      line.style.whiteSpace = 'nowrap';
      let size = parseFloat(getComputedStyle(line).fontSize) || 15;
      let guard = 14;
      while (line.scrollWidth > line.clientWidth && size > 10 && guard-- > 0) {
        size -= 0.5;
        line.style.fontSize = `${size}px`;
      }
      // If it still cannot fit at the floor, let it wrap rather than clip.
      if (line.scrollWidth > line.clientWidth) line.style.whiteSpace = 'normal';
    }
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
        <div class="sk-hud">
          <button type="button" class="sk-hud-back" data-role="machines" aria-label="${esc(t('quit'))}">☰</button>
          <div class="sk-hud-mid">
            <div class="sk-hud-name">${esc(this.game.board.name)}</div>
            <div class="sk-score" data-role="score" aria-label="${esc(t('hud_score_aria'))}">${this.game.score}</div>
            <div class="sk-pips" data-role="pips" aria-label="${esc(t('hud_ball'))}">${pips}</div>
          </div>
          <!-- No TOP/BEST/TODAY strip here: those records are painted on the machine's own
               backboard (render.js setScoreboard) so the data isn't shown twice. The header
               keeps only the LIVE state of the rack in progress: score and ball pips. -->
        </div>
        <div class="sk-stage" data-role="stage">
          <canvas class="sk-canvas" data-role="canvas" role="img" aria-label="${esc(t('aria_lane'))}"></canvas>
          <div class="sk-msg" data-role="msg" aria-live="polite"></div>
          <!-- DEV readout, remove before this game goes public: every real flick's measured
               speed, so the swipe curve can be tuned while actually playing. -->
          <div class="sk-flickread" data-role="flickread" aria-hidden="true">flick: -</div>
          <div class="sk-flickread sk-dbg" data-role="dbg" aria-hidden="true">log: -</div>
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
      flickread: this.root.querySelector('[data-role="flickread"]'),   // DEV readout, remove before public
      dbg: this.root.querySelector('[data-role="dbg"]'),               // DEV log diagnostic, remove before public
    };
    this._dbg = { thrown: 0, done: 0, log: 0, ok: 0, err: '-' };       // DEV: throw-logging counters

    if (this.renderer) this.renderer.dispose();
    this.renderer = new Renderer(this.el.canvas, this.game.board);
    this._pushScoreboard();
    this._bindPlay();
    this._fit();
    if (snap) this._say(t('msg_resumed', { n: this.game.ballsUsed + 1, total: BALLS_PER_GAME }));
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

    // DEV, remove before public: the live readout, plus the captured throw params - logged with
    // their real result at ballDone (see _drainEvents / _logThrow), so there's measured data
    // (flick -> power -> launch -> actual hole), not just the calculation, to check the curve.
    const launch = launchSpeed(power, this.game.board.geom.minSpeed, this.game.board.geom.maxSpeed);
    if (this.el && this.el.flickread) {
      this.el.flickread.textContent = `flick ${perH.toFixed(2)} h/s  ·  pow ${power.toFixed(2)}  ·  ${launch.toFixed(2)} m/s`;
    }

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
      // DEV, remove before public: hold this throw's inputs; _drainEvents logs them with the real
      // result when the ball settles (ballDone).
      this._lastThrow = { flick: +perH.toFixed(3), power: +power.toFixed(3), aim: +aim.toFixed(3), launch: +launch.toFixed(3) };
      // DEV, remove before public: per-throw physics stats, tallied from the event stream in
      // _drainEvents and logged with the result at ballDone.
      this._throwStats = { bounces: 0, backboard: 0, impact: false, impactSpeed: null, seq: [],
        contacts: [],
        t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
      if (this._dbg) { this._dbg.thrown++; this._renderDbg(); }
    }
  }

  /** DEV, remove before this game goes public. One settled throw's inputs and its REAL result,
   *  pushed to skeeballThrows/<deviceId>/ so actual play data (flick -> power -> launch -> hole)
   *  can be checked against the calculated ranges. Best-effort and fire-and-forget: this is
   *  throwaway instrumentation, not player history, so a failed write is simply dropped (never
   *  queued, never blocks the game). Read it with read-skeeball-throws.mjs. */
  async _logThrow(rec) {
    if (this._dbg) { this._dbg.log++; this._renderDbg(); }
    const full = { ...rec, board: (this.game && this.game.board.id) || this.settings.board,
      name: (loadProfile() || {}).name || '', at: Date.now() };
    try {
      const boot = await getStatsApp();
      if (!boot) { if (this._dbg) { this._dbg.err = 'no-boot'; this._renderDbg(); } return; }
      const { db, api } = boot;
      await api.set(api.push(api.ref(db, 'skeeballThrows/' + deviceId())), full);
      if (this._dbg) { this._dbg.ok++; this._dbg.err = '-'; this._renderDbg(); }
    } catch (e) {
      if (this._dbg) { this._dbg.err = String((e && e.message) || e).slice(0, 48); this._renderDbg(); }
    }
  }

  /** DEV diagnostic, remove before public: show the throw-logging counters on screen so the
   *  pipeline can be watched on a real device - thrown (a throw was captured), done (a ball
   *  settled), log (a write was attempted), ok (a write committed), and the last error. */
  _renderDbg() {
    if (!this.el || !this.el.dbg || !this._dbg) return;
    const d = this._dbg;
    this.el.dbg.textContent = `thrown ${d.thrown} · done ${d.done} · log ${d.log} · ok ${d.ok} · err ${d.err}`;
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
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.classList.remove('is-on');
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
      // DEV, remove before public: tally every physics event of the throw in flight.
      const ts = this._throwStats;
      if (ts) {
        // DEV, remove before public: the full contact log (every part the ball touched, where, how
        // hard, when) rides its own array; `seq` stays the readable event-type list it always was.
        if (ev.type === 'contact') {
          if (ts.contacts) ts.contacts.push({ part: ev.part, cup: ev.cup || null, speed: ev.speed,
            x: ev.x, y: ev.y, z: ev.z, t: ev.t });
        } else {
          ts.seq.push(ev.type);
          if (ev.type === 'bounce') ts.bounces++;
          else if (ev.type === 'backboard') ts.backboard++;
          else if (ev.type === 'impact') { ts.impact = true; if (ts.impactSpeed == null && typeof ev.speed === 'number') ts.impactSpeed = +ev.speed.toFixed(2); }
        }
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
        case 'returned':
          this._say(t('msg_returned'));
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
          writeSave(this.game.snapshot());   // the autosave that makes leaving lossless
          // DEV, remove before public: this ball's inputs + its REAL result, to a Firebase node we
          // can read back (real data to check the calculated ranges against).
          if (this._dbg) { this._dbg.done++; this._renderDbg(); }
          if (this._lastThrow) {
            const ts = this._throwStats || {};
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            this._logThrow({ ...this._lastThrow, value: ev.value | 0, hole: String(ev.hole || '-'),
              bounces: ts.bounces | 0, backboard: ts.backboard | 0, touchedBoard: !!ts.impact,
              impactSpeed: (ts.impactSpeed != null ? ts.impactSpeed : null),
              settleMs: (ts.t0 ? Math.round(now - ts.t0) : null),
              seq: (ts.seq || []).join(','),
              // DEV, remove before public: the whole journey - every contact in order (part / cup /
              // pos / speed / t), the first hit, and the final drop point the capture already knows.
              contacts: ts.contacts || [],
              firstHit: (ts.contacts && ts.contacts[0]) || null,
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

  _paintHud() {
    this.el.score.textContent = String(this.game.score);
    this.el.pips.innerHTML = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');
  }

  _say(text) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('is-on');
    this.msgTimer = 1.8;
  }

  // --- the finished rack -----------------------------------------------------------------------

  _rackOver(result) {
    const board = this.game.board;
    // What stood BEFORE this rack lands in the store - that is what "NEW BEST" means.
    const prev = myRecords(board.id);
    const prevTop = (this.top[board.id] && this.top[board.id].score) || 0;

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
    const pill = pillKey ? `<span class="gh-chip gh-chip--accent">${esc(t(pillKey))}</span>` : '';

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

  _openOverlay(kind, html) {
    this._closeOverlay();
    const el = document.createElement('div');
    el.className = `sk-veil sk-veil-${kind}`;
    el.innerHTML = `<div class="sk-sheet">${html}</div>`;
    this.root.appendChild(el);
    this.overlay = el;
    el.querySelectorAll('[data-role="close"]').forEach((b) => b.addEventListener('click', () => this._closeOverlay()));
    return el;
  }

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
    this._closeOverlay();
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
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
