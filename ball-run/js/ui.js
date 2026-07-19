// ui.js — Ball Run UI module. Exposes the hub module contract (init/destroy/
// isInProgress), owns all DOM/screens, and drives the fixed-timestep sim loop
// (brief section 3). Game rules/state live in sim.js and track.js, kept
// separate from this file per the build guide's module split.

import { Sim, RunState } from './sim.js';
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { SIM_DT, MAX_STEPS_PER_FRAME, DIFFICULTIES, DEFAULT_DIFFICULTY, difficultyConfig } from './config.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordBallRun } from '../../js/game-stats.js';

// Fourth-playthrough item 2: the local per-difficulty personal best changed from distance (meters)
// to obstacle count. Renamed (not just re-valued) so old meter-based bests under the old
// 'ballrun.best.' prefix are simply never read as if they were counts - a fresh key, per this
// module's existing plain-localStorage convention (no old data is touched or deleted, it's just
// orphaned under its old key).
const BEST_KEY_PREFIX = 'ballrun.bestObstacles.';
const DIFFICULTY_KEY = 'ballrun.difficulty';
const SEEN_HELP_KEY = 'ballrun.seenHelp';
const DIFF_ORDER = ['easy', 'medium', 'hard'];

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

// Static how-to-play stills (brief section 11). Drawn as small inline SVGs
// approximating the reference frames rather than live 3D demos, per the brief.
// Re-drawn (item 5) with the ball sitting lower in frame with a generous
// forward view, matching the retuned camera framing in render.js, and with
// the drag cue replaced by a plain touch-point + double-headed-arrow glyph
// (no hand/finger illustration) in the hub's own inline-SVG stroke style.
function stillDragSteer() {
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <rect width="200" height="200" fill="#000"/>
    <path d="M14 196 L100 40 L186 196 Z" fill="none" stroke="#8f9aef" stroke-width="2"/>
    <path d="M50 160 L150 160" stroke="#8f9aef" stroke-width="1.5"/>
    <path d="M70 122 L130 122" stroke="#8f9aef" stroke-width="1.2"/>
    <circle cx="100" cy="140" r="19" fill="#e91ec4"/>
    <ellipse cx="93" cy="133" rx="6" ry="4" fill="#ff9fe6" opacity="0.7"/>
    <g stroke="#39f4ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <line x1="44" y1="182" x2="156" y2="182"/>
      <path d="M44 182 l16 -11 M44 182 l16 11"/>
      <path d="M156 182 l-16 -11 M156 182 l-16 11"/>
      <circle cx="100" cy="182" r="9" fill="#000"/>
    </g>
  </svg>`;
}
function stillObstacle() {
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <rect width="200" height="200" fill="#000"/>
    <path d="M6 196 L100 60 L194 196 Z" fill="none" stroke="#8f9aef" stroke-width="2"/>
    <path d="M50 152 L150 152" stroke="#8f9aef" stroke-width="1.5"/>
    <circle cx="72" cy="128" r="17" fill="#e91ec4"/>
    <rect x="112" y="104" width="24" height="24" fill="#9b1fd6" stroke="#ff5fe0" stroke-width="2"/>
  </svg>`;
}
function stillEdge() {
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <rect width="200" height="200" fill="#000"/>
    <path d="M64 196 L128 60 L200 96 L200 196 Z" fill="none" stroke="#8f9aef" stroke-width="2"/>
    <path d="M108 150 L182 154" stroke="#8f9aef" stroke-width="1.5"/>
    <circle cx="84" cy="162" r="17" fill="#e91ec4"/>
  </svg>`;
}
function stillTunnel() {
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
    <rect width="200" height="200" fill="#2b0a3d"/>
    <path d="M0 0 L100 46 L200 0 Z" fill="#9b1fd6" opacity="0.5"/>
    <path d="M0 200 L100 148 L200 200 Z" fill="#3a2f7b"/>
    <path d="M18 178 L100 116 L182 178" fill="none" stroke="#39f4ff" stroke-width="9" stroke-linecap="round"/>
    <path d="M42 152 L100 116 L158 152" fill="none" stroke="#39f4ff" stroke-width="9" stroke-linecap="round"/>
    <circle cx="100" cy="150" r="16" fill="#e91ec4"/>
  </svg>`;
}

const HELP_PAGES = [
  { still: stillDragSteer, text: 'Hold and drag your finger left and right to steer your ball as it speeds up' },
  { still: stillObstacle, text: 'Guide your ball to avoid hitting obstacles, or your run ends!' },
  { still: stillEdge, text: "Steer carefully and don't let your ball fall off, or your run ends!" },
  { still: stillTunnel, text: 'At each speedpoint the ball accelerates again. Survive as long as you can to get the highest score!' },
];

class BallRunUI {
  constructor(container) {
    ensureStylesheet();
    this.container = container;

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
    this.helpPage = 0;
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
          <h1 class="br-title">BALL RUN</h1>
          <p class="br-blurb">Steer your ball by dragging your finger left and right. Avoid obstacles and stay on the track. Survive as long as you can!</p>
          <div class="br-best" data-role="setup-best"></div>
          <div class="br-diff-panel">
            <div class="br-diff-face" data-role="diff-face"></div>
            <div class="br-diff-label" data-role="diff-label"></div>
            <input type="range" class="br-diff-slider" data-role="diff-slider" min="0" max="2" step="1" aria-label="Difficulty">
          </div>
          <div class="br-setup-actions">
            <button type="button" class="br-btn br-btn-primary" data-role="play">PLAY</button>
            <button type="button" class="br-btn br-btn-help" data-role="help-open" aria-label="How to play">?</button>
          </div>
        </section>

        <section class="br-game" data-role="game" hidden>
          <canvas class="br-canvas" data-role="canvas"></canvas>
          <div class="br-hud" data-role="hud">
            <div class="br-hud-score" data-role="score" aria-label="Obstacles passed">
              <svg class="br-hud-cube" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 7 L12 12 L21 7 M12 12 V22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              <span data-role="score-value">0</span>
            </div>
            <div class="br-hud-distance" data-role="distance">0 m</div>
            <div class="br-hud-tiers" data-role="tiers"></div>
          </div>
          <div class="br-gate" data-role="resume-gate" hidden>
            <button type="button" class="br-btn br-btn-primary" data-role="resume">Tap to resume</button>
          </div>
          <div class="br-overlay" data-role="gameover" hidden>
            <div class="br-panel">
              <h2 data-role="go-title">Run over</h2>
              <p class="br-go-score" data-role="go-score"></p>
              <p class="br-go-distance" data-role="go-distance"></p>
              <p class="br-go-best" data-role="go-best"></p>
              <div class="br-panel-actions">
                <button type="button" class="br-btn br-btn-primary" data-role="play-again">Play Again</button>
                <button type="button" class="br-btn br-btn-ghost" data-role="go-hub">Back to hub</button>
              </div>
            </div>
          </div>
        </section>

        <div class="br-help-overlay" data-role="help" hidden>
          <div class="br-help-panel">
            <button type="button" class="br-help-close" data-action="close-help" aria-label="Close">&times;</button>
            <h2 class="br-help-title">HOW TO PLAY</h2>
            <div class="br-help-card">
              <div class="br-help-still" data-role="help-still"></div>
              <p class="br-help-text" data-role="help-text"></p>
            </div>
            <div class="br-help-dots" data-role="help-dots"></div>
            <div class="br-help-nav">
              <button type="button" class="br-btn br-btn-nav" data-action="help-first" aria-label="First page">|&larr;</button>
              <button type="button" class="br-btn br-btn-primary" data-action="help-ok">OK</button>
              <button type="button" class="br-btn br-btn-nav" data-action="help-next" aria-label="Next page">&rarr;|</button>
            </div>
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
      helpText: q('[data-role="help-text"]'),
      helpDots: q('[data-role="help-dots"]'),
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

    root.querySelector('.br-help-overlay').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close-help') this.closeHelp();
      else if (action.dataset.action === 'help-ok') { if (this.helpPage >= HELP_PAGES.length - 1) this.closeHelp(); else this.helpNext(); }
      else if (action.dataset.action === 'help-next') this.helpNext();
      else if (action.dataset.action === 'help-first') this.helpGo(0);
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
    this.el.diffLabel.textContent = DIFFICULTIES[this.difficulty].label.toUpperCase();
    this.el.diffLabel.dataset.diff = this.difficulty;
    this.el.diffFace.dataset.diff = this.difficulty;
  }

  syncBestUi() {
    const best = loadBest(this.difficulty);
    this.el.setupBest.textContent = best > 0 ? `Best: ${best} passed` : 'No runs yet';
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

  teardownRun() {
    this.stopLoop();
    if (this.input) { this.input.destroy(); this.input = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
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
    if (!this._resultRecorded) { this._resultRecorded = true; try { recordBallRun(score, this.difficulty); } catch { /* ignore */ } }

    this.el.goTitle.textContent = this.sim.crashReason === 'edge' ? 'You fell off!' : 'Crashed!';
    this.el.goScore.textContent = `${score} obstacles passed`;
    this.el.goDistance.textContent = `Distance: ${distance} m`;
    this.el.goBest.innerHTML = isNewBest
      ? '<span class="br-star" aria-hidden="true">&#9733;</span> New best!'
      : `Best: ${Math.max(prevBest, score)}`;
    this.el.gameover.hidden = false;
  }

  // --- Help carousel (brief section 11) --------------------------------

  openHelp(fromScreen) {
    this.helpReturnScreen = fromScreen;
    this.helpPage = 0;
    if (this.running) { this.stopLoop(); this._pausedForHelp = true; }
    this.renderHelpPage();
    this.el.help.hidden = false;
  }

  closeHelp() {
    this.el.help.hidden = true;
    if (this._pausedForHelp) { this._pausedForHelp = false; if (this.sim && !this.sim.isOver()) this.startLoop(); }
  }

  helpNext() {
    this.helpGo(Math.min(HELP_PAGES.length - 1, this.helpPage + 1));
  }

  helpGo(i) {
    this.helpPage = i;
    this.renderHelpPage();
  }

  renderHelpPage() {
    const page = HELP_PAGES[this.helpPage];
    this.el.helpStill.innerHTML = page.still();
    this.el.helpText.textContent = page.text;
    this.el.helpDots.innerHTML = HELP_PAGES.map((_, i) =>
      `<span class="br-dot${i === this.helpPage ? ' is-active' : ''}"></span>`).join('');
  }

  // --- Teardown -----------------------------------------------------------

  destroy() {
    this.stopLoop();
    this.teardownRun();
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
