// ui.js — Ball Run UI module. Exposes the hub module contract (init/destroy/
// isInProgress), owns all DOM/screens, and drives the fixed-timestep sim loop
// (brief section 3). Game rules/state live in sim.js and track.js, kept
// separate from this file per the build guide's module split.

import { Sim, RunState } from './sim.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { SIM_DT, MAX_STEPS_PER_FRAME, DEFAULT_DIFFICULTY, difficultyConfig } from './config.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordBallRun, loadStats } from '../../js/game-stats.js';
import { syncMyStats } from '../../js/stats-net.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// config.js's own DIFFICULTIES[].label stays English (a tuning/config module, same discipline as
// sim.js/track.js) — this maps the same keys onto translated display text instead.
const DIFF_LABEL_KEY = { easy: 'diff_easy', medium: 'diff_medium', hard: 'diff_hard' };

// Fourth-playthrough item 2: the local per-difficulty personal best changed from distance (meters)
// to obstacle count. Renamed (not just re-valued) so old meter-based bests under the old
// 'ballrun.best.' prefix are simply never read as if they were counts - a fresh key, per this
// module's existing plain-localStorage convention (no old data is touched or deleted, it's just
// orphaned under its old key).
const BEST_KEY_PREFIX = 'ballrun.bestObstacles.';
const DIFFICULTY_KEY = 'ballrun.difficulty';
const SEEN_HELP_KEY = 'ballrun.seenHelp';
const DIFF_ORDER = ['easy', 'medium', 'hard'];

// Fifth-playthrough incident: a player's finished runs never reached the shared stats store, and
// the only trace of the failure was a swallowed exception nobody could see. `recordBallRun` writing
// straight into the shared multi-game blob is genuinely the more fragile path (shared shape, shared
// migrations, shared code touched by every other game); the local best above never lost anything.
// This is a dead-simple, independent "flight recorder": every finished run is appended here FIRST,
// synchronously, before the shared store is touched at all. If the shared write then fails (throws,
// or silently doesn't move the needle), the entry stays `synced:false` and `reconcileRunLog()` (run
// on every Ball Run open, i.e. before every subsequent play) retries it. A run can now only vanish
// from the leaderboard/My Skills if this log entry AND every later retry all fail, not just one call.
const RUN_LOG_KEY = 'ballrun.runLog.v1';
const RUN_LOG_MAX = 200;

function readRunLog() {
  try {
    const v = JSON.parse(localStorage.getItem(RUN_LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeRunLog(log) {
  try { localStorage.setItem(RUN_LOG_KEY, JSON.stringify(log)); } catch (err) { console.error('[ball-run] run log write failed', err); }
}
function appendRunLog(entry) {
  const log = readRunLog();
  log.push(entry);
  while (log.length > RUN_LOG_MAX) log.shift();
  writeRunLog(log);
  return log;
}
function markRunLogSynced(ts) {
  const log = readRunLog();
  const e = log.find((x) => x.ts === ts);
  if (e) { e.synced = true; writeRunLog(log); }
}

/** Attempt the shared-store write for one flight-recorder entry. Verifies the write actually landed
 *  on disk (a FRESH loadStats() re-read afterward, not the in-memory object recordBallRun returns)
 *  rather than trusting "didn't throw" alone: game-stats.js's own persist() swallows storage-write
 *  failures internally, so its returned object can show an incremented count even when nothing was
 *  actually written to localStorage. Returns true only on a confirmed-on-disk new run. Never throws;
 *  logs loudly on any failure so a connected debugging session can see it. */
function trySyncRunEntry(entry) {
  let before = -1;
  try { before = loadStats().games.ballrun.br.runs | 0; } catch (err) { console.error('[ball-run] pre-write stats read failed', err); }
  try {
    recordBallRun(entry.score, entry.difficulty);
  } catch (err) {
    console.error('[ball-run] recordBallRun threw', { entry, err });
    return false;
  }
  let after = -1;
  try { after = loadStats().games.ballrun.br.runs | 0; } catch (err) { console.error('[ball-run] post-write stats read failed', err); return false; }
  if (after >= 0 && (before < 0 || after > before)) return true;
  console.error('[ball-run] recordBallRun did not confirm a new run (persist may have failed)', { entry, before, after });
  return false;
}

/** Retry any run this device recorded locally but never confirmed reaching the shared store, e.g.
 *  because the shared write threw or silently no-opped last time. Runs on every Ball Run open, so a
 *  failed run gets another chance every time the player comes back, not just once. Idempotent: a
 *  successfully-synced entry is never retried, so this cannot double-count a run that already landed. */
function reconcileRunLog() {
  const log = readRunLog();
  for (const entry of log) {
    if (entry.synced) continue;
    if (trySyncRunEntry(entry)) markRunLogSynced(entry.ts);
  }
}

function ensureStylesheet() {
  const href = new URL('../css/ball-run.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/ball-run.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadBest(difficulty) {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY_PREFIX + difficulty) || '0', 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

function saveBest(difficulty, obstaclesPassed) {
  try { localStorage.setItem(BEST_KEY_PREFIX + difficulty, String(Math.floor(obstaclesPassed))); } catch { /* ignore */ }
}

function loadSavedDifficulty() {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    return DIFF_ORDER.includes(v) ? v : null;
  } catch { return null; }
}

function saveDifficulty(v) {
  try { localStorage.setItem(DIFFICULTY_KEY, v); } catch { /* ignore */ }
}

// Skill tiers (build guide section 5) map 1:1 onto Ball Run's three difficulties.
const SKILL_TO_DIFFICULTY = { 1: 'easy', 2: 'medium', 3: 'hard' };

const FACE_SVGS = {
  easy: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="currentColor"/><circle cx="13" cy="17" r="2.6" fill="#1a1a1a"/><circle cx="27" cy="17" r="2.6" fill="#1a1a1a"/><path d="M12 25c2.5 3 13.5 3 16 0" stroke="#1a1a1a" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
  medium: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="currentColor"/><path d="M9.5 16.5l7 1.4M30.5 16.5l-7 1.4" stroke="#1a1a1a" stroke-width="2.4" stroke-linecap="round"/><path d="M8 22h9M23 22h9" stroke="#1a1a1a" stroke-width="4.4" stroke-linecap="round"/><path d="M13 29c3-2 11-2 14 0" stroke="#1a1a1a" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
  hard: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="currentColor"/><path d="M8 14l9 4M32 14l-9 4" stroke="#1a1a1a" stroke-width="2.8" stroke-linecap="round"/><path d="M9 22h8.5M22.5 22H31" stroke="#1a1a1a" stroke-width="4.6" stroke-linecap="round"/><path d="M13 30c3-3.5 11-3.5 14 0" stroke="#1a1a1a" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>',
};

// Single static how-to-play diagram (2026-07-23 rewrite: the old 4-slide pager showed
// abstract shapes that didn't depict their captions, and its "first page" button was
// actually skip-to-first, so tapping it looked like "previous" but always restarted the
// deck). One inline SVG instead, drawn with the same track colors render.js actually uses
// (COLOR_TRACK_TILE fill, COLOR_TRACK_GROUT edges, COLOR_CHEVRON gap markers, COLOR_BALL)
// so the sheet matches what the player sees in-game: the ball steering on a dark track,
// with a visible gap in the right edge showing where falling off ends the run, and a
// touch-point + double-headed-arrow glyph for the drag-to-steer gesture.
function helpDiagram() {
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${t('help_diagram_aria')}">
    <rect width="200" height="200" fill="#000"/>
    <path d="M14 196 L100 40 L186 196 Z" fill="#2b2f6b"/>
    <path d="M14 196 L100 40" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M100 40 L152 118" stroke="#8f9aef" stroke-width="3" fill="none"/>
    <path d="M162 134 L186 196" stroke="#39f4ff" stroke-width="3" stroke-dasharray="3 5" fill="none"/>
    <path d="M50 160 L150 160" stroke="#8f9aef" stroke-width="1.2" opacity="0.6"/>
    <path d="M70 122 L130 122" stroke="#8f9aef" stroke-width="1" opacity="0.6"/>
    <circle cx="88" cy="140" r="19" fill="#e91ec4"/>
    <ellipse cx="81" cy="133" rx="6" ry="4" fill="#ff9fe6" opacity="0.7"/>
    <g stroke="#39f4ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="44" y1="182" x2="156" y2="182"/>
      <path d="M44 182 l16 -11 M44 182 l16 11"/>
      <path d="M156 182 l-16 -11 M156 182 l-16 11"/>
      <circle cx="100" cy="182" r="9" fill="#000"/>
    </g>
  </svg>`;
}

class BallRunUI {
  constructor(container) {
    ensureStylesheet();
    this.container = container;

    // Retry any run recorded locally last session that never confirmed reaching the shared
    // stats/leaderboard store (see RUN_LOG_KEY above). Cheap no-op when there's nothing to retry.
    try { reconcileRunLog(); } catch (err) { console.error('[ball-run] reconcile on open failed', err); }

    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const skillDefault = SKILL_TO_DIFFICULTY[opp && opp.skill];
    this.difficulty = loadSavedDifficulty() || skillDefault || DEFAULT_DIFFICULTY;

    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.sim = null;
    this.renderer = null;
    this.input = null;
    this.rafId = 0;
    this.running = false;
    this.helpReturnScreen = 'setup';
    this._lastTime = 0;
    this._acc = 0;
    this._pausedForVisibility = false;
    this._resultRecorded = false;

    this._onVisibilityChange = () => this.handleVisibilityChange();
    this._onResize = () => this.handleResize();

    // Lock page scroll for the whole time this route is mounted (item 3):
    // .br-root is fixed full-viewport, but an unlocked body can still
    // rubber-band/scroll on iOS Safari on touch drag. Restored in destroy().
    this._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    this.mount();
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  // --- DOM construction -------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="br-root">
        <section class="br-setup" data-role="setup">
          <h1 class="br-title">${t('title')}</h1>
          <p class="br-blurb">${t('blurb')}</p>
          <div class="br-best" data-role="setup-best"></div>
          <div class="br-diff-panel">
            <div class="br-diff-face" data-role="diff-face"></div>
            <div class="br-diff-label" data-role="diff-label"></div>
            <input type="range" class="br-diff-slider" data-role="diff-slider" min="0" max="2" step="1" aria-label="${t('diff_aria')}">
          </div>
          <div class="br-setup-actions">
            <button type="button" class="br-btn br-btn-primary" data-role="play">${t('play')}</button>
            <button type="button" class="br-btn br-btn-help" data-role="help-open" aria-label="${t('howto_aria')}">?</button>
          </div>
        </section>

        <section class="br-game" data-role="game" hidden>
          <canvas class="br-canvas" data-role="canvas"></canvas>
          <div class="br-hud" data-role="hud">
            <div class="br-hud-score" data-role="score" aria-label="${t('score_aria')}">
              <svg class="br-hud-cube" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 7 L12 12 L21 7 M12 12 V22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              <span data-role="score-value">0</span>
            </div>
            <div class="br-hud-distance" data-role="distance">0 m</div>
            <div class="br-hud-tiers" data-role="tiers"></div>
          </div>
          <div class="br-gate" data-role="resume-gate" hidden>
            <button type="button" class="br-btn br-btn-primary" data-role="resume">${t('resume')}</button>
          </div>
          <div class="br-overlay" data-role="gameover" hidden>
            <div class="br-panel">
              <button type="button" class="br-help-close" data-action="close-gameover" aria-label="${t('close')}">&times;</button>
              <h2 data-role="go-title">${t('run_over')}</h2>
              <p class="br-go-score" data-role="go-score"></p>
              <p class="br-go-distance" data-role="go-distance"></p>
              <p class="br-go-best" data-role="go-best"></p>
              <div class="br-panel-actions">
                <button type="button" class="br-btn br-btn-primary" data-role="play-again">${t('play_again')}</button>
                <button type="button" class="br-btn br-btn-ghost" data-role="go-hub">${t('back_to_hub')}</button>
              </div>
            </div>
          </div>
        </section>

        <div class="br-help-overlay" data-role="help" hidden>
          <div class="br-help-panel">
            <button type="button" class="br-help-close" data-action="close-help" aria-label="${t('close')}">&times;</button>
            <h2 class="br-help-title">${t('howto_title')}</h2>
            <p class="br-help-lead">${t('help_goal')}</p>
            <div class="br-help-card">
              <div class="br-help-still" data-role="help-still"></div>
            </div>
            <p class="br-help-caption">${t('help_caption')}</p>
            <ul class="br-help-bullets">
              <li>${t('help_bullet1')}</li>
            </ul>
          </div>
        </div>
      </div>`;

    const root = this.container.querySelector('.br-root');
    const q = (sel) => root.querySelector(sel);
    this.el = {
      root,
      setup: q('[data-role="setup"]'),
      setupBest: q('[data-role="setup-best"]'),
      diffFace: q('[data-role="diff-face"]'),
      diffLabel: q('[data-role="diff-label"]'),
      diffSlider: q('[data-role="diff-slider"]'),
      play: q('[data-role="play"]'),
      helpOpen: q('[data-role="help-open"]'),
      game: q('[data-role="game"]'),
      canvas: q('[data-role="canvas"]'),
      hud: q('[data-role="hud"]'),
      score: q('[data-role="score"]'),
      scoreValue: q('[data-role="score-value"]'),
      distance: q('[data-role="distance"]'),
      tiers: q('[data-role="tiers"]'),
      resumeGate: q('[data-role="resume-gate"]'),
      resumeBtn: q('[data-role="resume"]'),
      gameover: q('[data-role="gameover"]'),
      goTitle: q('[data-role="go-title"]'),
      goScore: q('[data-role="go-score"]'),
      goDistance: q('[data-role="go-distance"]'),
      goBest: q('[data-role="go-best"]'),
      playAgain: q('[data-role="play-again"]'),
      goHub: q('[data-role="go-hub"]'),
      help: q('[data-role="help"]'),
      helpStill: q('[data-role="help-still"]'),
    };

    this.el.diffSlider.value = String(DIFF_ORDER.indexOf(this.difficulty));
    this.syncDifficultyUi();
    this.syncBestUi();

    this.el.diffSlider.addEventListener('input', () => {
      this.difficulty = DIFF_ORDER[+this.el.diffSlider.value];
      saveDifficulty(this.difficulty);
      this.syncDifficultyUi();
      this.syncBestUi();
    });
    this.el.play.addEventListener('click', () => this.startRun());
    this.el.helpOpen.addEventListener('click', () => this.openHelp('setup'));
    this.el.resumeBtn.addEventListener('click', () => this.resumeFromGate());
    this.el.playAgain.addEventListener('click', () => this.startRun());
    this.el.goHub.addEventListener('click', () => this.showSetup());
    // No "view board" equivalent exists for a finished run (there's nothing more
    // to look at once the run has ended), so the X reuses "Back to hub"'s own
    // handler - same non-destructive exit, just from the corner instead of a
    // labeled button.
    this.el.gameover.querySelector('[data-action="close-gameover"]').addEventListener('click', () => this.showSetup());

    root.querySelector('.br-help-overlay').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close-help') this.closeHelp();
    });

    this.showSetup();

    if (!this.hasSeenHelp()) {
      this.markSeenHelp();
      this.openHelp('setup');
    }
  }

  hasSeenHelp() {
    try { return localStorage.getItem(SEEN_HELP_KEY) === '1'; } catch { return true; }
  }
  markSeenHelp() {
    try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch { /* ignore */ }
  }

  syncDifficultyUi() {
    this.el.diffFace.innerHTML = FACE_SVGS[this.difficulty];
    this.el.diffLabel.innerHTML = diffShapeSVG(tierOf(this.difficulty)) + t(DIFF_LABEL_KEY[this.difficulty]);
    this.el.diffLabel.dataset.diff = this.difficulty;
    this.el.diffFace.dataset.diff = this.difficulty;
  }

  syncBestUi() {
    const best = loadBest(this.difficulty);
    this.el.setupBest.textContent = best > 0 ? t('best_passed', { n: best }) : t('no_runs_yet');
  }

  // --- Screens ------------------------------------------------------------

  showSetup() {
    this.stopLoop();
    this.teardownRun();
    this.el.game.hidden = true;
    this.el.setup.hidden = false;
    this.syncBestUi();
  }

  startRun() {
    this.teardownRun();
    this.el.setup.hidden = true;
    this.el.game.hidden = false;
    this.el.gameover.hidden = true;
    this.el.resumeGate.hidden = true;

    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.sim = new Sim(this.difficulty, seed);
    this.renderer = new Renderer(this.el.canvas);
    this.input = new InputController(this.el.canvas);
    this._resultRecorded = false;

    this.handleResize();
    this.renderer.resetCamera(0);
    this.updateHud(true);
    this.startLoop();
  }

  /** `fullExit` is false for an in-game restart (Play/Play Again reuse the same canvas
   *  immediately after) and true for actually leaving the game (hub destroy()) - see
   *  Renderer.dispose()'s doc comment for why forcing context loss on a restart blacks
   *  out the canvas. */
  teardownRun(fullExit = false) {
    this.stopLoop();
    if (this.input) { this.input.destroy(); this.input = null; }
    if (this.renderer) { this.renderer.dispose(fullExit); this.renderer = null; }
    this.sim = null;
  }

  // --- Fixed-step loop ------------------------------------------------------

  startLoop() {
    this.running = true;
    this._acc = 0;
    this._lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  stopLoop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.25) dt = 0.25; // clamp a huge stall (e.g. devtools pause) instead of spiral-of-death
    this._acc += dt;

    let steps = 0;
    while (this._acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      const dragAxis = this.input.consumeDragAxis();
      const keyAxis = this.input.keyAxis();
      this.sim.step(dragAxis, keyAxis);
      this._acc -= SIM_DT;
      steps++;
      if (this.sim.isOver()) break;
    }

    this.renderer.render(this.sim, this.reducedMotion);
    this.updateHud();

    if (this.sim.isOver()) this.onGameOver();
  }

  updateHud(force) {
    if (!this.sim) return;
    // Obstacle count is the primary HUD number (fourth-playthrough item 2); distance stays as a
    // secondary flavor line, never compared against a best.
    const score = this.sim.score;
    if (force || this._lastShownScore !== score) {
      this._lastShownScore = score;
      this.el.scoreValue.textContent = String(score);
    }
    const meters = Math.floor(this.sim.z);
    if (force || this._lastShownDistance !== meters) {
      this._lastShownDistance = meters;
      this.el.distance.textContent = `${meters} m`;
    }
    const tierCount = Math.min(6, this.sim.tiersPassed);
    if (this._lastShownTiers !== tierCount) {
      this._lastShownTiers = tierCount;
      this.el.tiers.innerHTML = Array.from({ length: tierCount }, () => '<span class="br-pip"></span>').join('');
    }
  }

  // --- Pause / resume (non-negotiable 4) ------------------------------------

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.running) { this.stopLoop(); this._pausedForVisibility = true; this.el.resumeGate.hidden = false; }
    }
  }

  resumeFromGate() {
    this.el.resumeGate.hidden = true;
    this._pausedForVisibility = false;
    if (this.sim && !this.sim.isOver()) this.startLoop();
  }

  handleResize() {
    if (!this.renderer || !this.el.canvas) return;
    const rect = this.el.canvas.parentElement.getBoundingClientRect();
    this.renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  }

  // --- Game over --------------------------------------------------------

  onGameOver() {
    this.stopLoop();
    // Fourth-playthrough item 2: obstacle count is now the headline score and what's compared
    // against the personal best. Distance is shown once as secondary flavor info only.
    const score = this.sim.score;
    const distance = Math.floor(this.sim.z);
    const prevBest = loadBest(this.difficulty);
    const isNewBest = score > prevBest;
    if (isNewBest) saveBest(this.difficulty, score);
    // Shared cross-device stats/leaderboard store, additive alongside the local best above (which
    // stays the source of truth for the pre-game/game-over "your best" display).
    if (!this._resultRecorded) {
      this._resultRecorded = true;
      // Sixth-playthrough fix: write the raw result to the flight-recorder log FIRST, before
      // touching the shared store at all, so the run is never lost even if the write below fails.
      const logEntry = { ts: Date.now(), difficulty: this.difficulty, score, distance, synced: false };
      appendRunLog(logEntry);
      if (trySyncRunEntry(logEntry)) markRunLogSynced(logEntry.ts);
      // Fifth-playthrough fix: previously the only thing that pushed a finished run up to Firebase
      // was hub.js's own lifecycle sync (tab-hide / returning to the launcher grid). This screen's
      // own "Back to hub" button only calls this module's showSetup() - it stays mounted inside Ball
      // Run, it does not leave the module - so a player who finishes a run, sees "Back to hub", and
      // plays again (or closes the tab) from there could go an entire session without the hub's sync
      // ever firing for that run. Syncing right here means every finished run reaches the leaderboard
      // on its own, regardless of what the player clicks next. Best-effort/fire-and-forget like every
      // other syncMyStats() call site; never blocks the game-over screen from showing.
      try { syncMyStats(); } catch (err) { console.error('[ball-run] syncMyStats failed', err); }
    }

    this.el.goTitle.textContent = this.sim.crashReason === 'edge' ? t('fell_off') : t('crashed');
    this.el.goScore.textContent = t('obstacles_passed', { n: score });
    this.el.goDistance.textContent = t('distance_m', { n: distance });
    this.el.goBest.innerHTML = isNewBest
      ? `<span class="br-star" aria-hidden="true">&#9733;</span> ${t('new_best')}`
      : t('best_n', { n: Math.max(prevBest, score) });
    this.el.gameover.hidden = false;
  }

  // --- Help sheet (one static diagram, no pagination) --------------------

  openHelp(fromScreen) {
    this.helpReturnScreen = fromScreen;
    if (this.running) { this.stopLoop(); this._pausedForHelp = true; }
    this.el.helpStill.innerHTML = helpDiagram();
    this.el.help.hidden = false;
  }

  closeHelp() {
    this.el.help.hidden = true;
    if (this._pausedForHelp) { this._pausedForHelp = false; if (this.sim && !this.sim.isOver()) this.startLoop(); }
  }

  // --- Teardown -----------------------------------------------------------

  destroy() {
    this.stopLoop();
    this.teardownRun(true);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.body.style.overflow = this._prevBodyOverflow;
    this.container.innerHTML = '';
  }

  isInProgress() {
    return !!this.sim && this.sim.state === RunState.PLAYING;
  }
}

// --- Module contract --------------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new BallRunUI(container);
  return instance;
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!instance && instance.isInProgress();
}

export default { init, destroy, isInProgress };
