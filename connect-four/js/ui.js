// ui.js — Connect Four UI module.
//
// Exposes the hub module contract:
//   init(container)  — mount the game into a DOM element
//   destroy()        — tear down listeners/state/worker
//
// The UI reads the game state straight from the engine (Game/Board); the AI runs
// in a Web Worker so the board stays responsive during Expert's search, with a
// transparent main-thread fallback if workers aren't available.

import { Game, WIN, DRAW } from './game.js';
import { Difficulty } from './ai.js';
import { COLS, ROWS, PLAYER_ONE, PLAYER_TWO } from './board.js';
import { loadProfile } from '../../js/profile-store.js';
import { cfForcedDifficulty, cfInEasyPhase, codeFor, taunt } from '../../js/challenge/hooks.js';
import { loadChallenge, updateChallenge, recordWin } from '../../js/challenge/challenge-store.js';
import { showCodeReveal, showTaunt } from '../../js/challenge/reveal.js';
import { recordConnect4 } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.connect4.v1';

/** Connect Four persisted nothing before batch 8; this is a new, standard `gamehub.<game>.v1`
 *  key holding only the who-goes-first choice + its alternation state. Additive-only: any future
 *  field just gets added here, never a rename. Malformed/missing storage reads as "no saved
 *  choice yet" (defaults to Alternate per the handoff), never throws. */
function loadC4Settings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
function saveC4Settings(v) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)); } catch { /* best-effort */ }
}

const GAME_KEY = 'gamehub.connect4.save.v1';

/** Batch 9 (2026-07-23): silent autosave/resume, following the Escoba/Mancala pattern
 *  (see mancala/js/ui.js's saveGame/loadGame/clearGame). Snapshots the in-progress game
 *  (board history, whose turn via firstPlayer, difficulty, the hint toggle, and the
 *  _statsDisqualified flag so a hint-assisted game STAYS disqualified after a resume) to
 *  localStorage after every move. Only ever holds ONE unfinished game; a finished game or
 *  the setup screen clears it. Never touches SETTINGS_KEY (who-goes-first stays separate). */
function saveC4Game(ui) {
  try {
    if (!ui.game || ui.game.isOver() || !ui.el || ui.el.game.hidden) { clearC4Game(); return; }
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      history: ui.game.history.slice(),
      firstPlayer: ui.game.firstPlayer,
      difficulty: ui.difficulty,
      showBestMoves: ui.showBestMoves,
      statsDisqualified: ui._statsDisqualified,
      humanHasMoved: ui.humanHasMoved,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard (shape, column range, a legal
 *  replay that isn't already over) — a corrupt or foreign save is treated as "no
 *  saved game" rather than crashing the module on mount. */
function loadC4Game() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (!Array.isArray(raw.history) || !raw.history.every((c) => Number.isInteger(c) && c >= 0 && c < COLS)) return null;
    if (raw.firstPlayer !== PLAYER_ONE && raw.firstPlayer !== PLAYER_TWO) return null;
    if (!DIFFICULTY_LABELS.some(([v]) => v === raw.difficulty)) return null;
    const game = new Game(raw.firstPlayer);
    for (const c of raw.history) {
      if (game.isOver() || !game.board.canPlay(c)) return null; // not a legal replay
      game.play(c);
    }
    if (game.isOver()) return null; // a finished game should never have been saved
    return {
      game,
      difficulty: raw.difficulty,
      showBestMoves: !!raw.showBestMoves,
      statsDisqualified: !!raw.statsDisqualified,
      humanHasMoved: !!raw.humanHasMoved,
    };
  } catch { return null; }
}

function clearC4Game() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

const EXPERT_BUDGET_MS = 1500; // per-move ceiling for Expert (incl. opening fallback)
const HINT_BUDGET_MS = 3000;   // Pass 2 (estimate) budget for the "show best moves" analysis
const INLINE_EXACT_ATTEMPT_MS = 300; // Pass 1 cap when the worker is unavailable (blocks the UI thread)
const DROP_MS = 360; // keep in sync with --cf-drop-time in the CSS

/**
 * Ensure the module's stylesheet is present, so the game is self-contained when
 * mounted by a host (e.g. the hub) whose page doesn't link it. Idempotent and a
 * no-op when the stylesheet is already on the page (e.g. the standalone host).
 */
function ensureStylesheet() {
  const href = new URL('../css/connect-four.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some(
    (l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/connect-four.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.cfStyle = '';
  document.head.appendChild(link);
}

const DIFFICULTY_LABELS = [
  [Difficulty.EASY, 'diff_easy'],
  [Difficulty.MEDIUM, 'diff_medium'],
  [Difficulty.HARD, 'diff_hard'],
  [Difficulty.EXPERT, 'diff_expert'],
];

// Profile skill tiers (1-3) map onto the first three difficulties. Connect Four's
// Expert (perfect solver) stays a manual, in-game choice, not a profile tier.
const SKILL_TO_DIFFICULTY = { 1: Difficulty.EASY, 2: Difficulty.MEDIUM, 3: Difficulty.HARD };
// Escape user-entered names before they go into innerHTML (setup screen + legend).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class ConnectFourUI {
  constructor(container) {
    this.container = container;

    // Settings (human is always red / PLAYER_ONE; turn order is configurable).
    // Prefill from the shared hub profile (defaults-only; still editable on setup).
    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    this.difficulty = (opp && SKILL_TO_DIFFICULTY[opp.skill]) || Difficulty.MEDIUM;
    // Who-goes-first: 'you' | 'ai' | 'alternate'. No saved settings at all -> default
    // Alternate (the handoff's default-for-new-devices rule). Any saved explicit choice
    // (including a previously saved 'alternate') always wins over that default.
    const c4settings = loadC4Settings();
    this.firstMode = (c4settings && ['you', 'ai', 'alternate'].includes(c4settings.firstMode))
      ? c4settings.firstMode : 'alternate';
    this.nextStarter = (c4settings && (c4settings.nextStarter === 'you' || c4settings.nextStarter === 'ai'))
      ? c4settings.nextStarter : 'you';
    this.humanFirst = this.firstMode === 'ai' ? false : true; // resolved per-game in startGame() for 'alternate'
    this.humanPlayer = PLAYER_ONE;
    this.aiPlayer = PLAYER_TWO;

    // Player identity for on-screen labels (profile-driven; falls back to the
    // original "You" / "Computer" when there is no profile).
    this.humanName = (profile && profile.name) || 'You';
    this.humanEmoji = (profile && profile.emoji) || '';
    this.oppName = (opp && opp.name) || 'Computer';
    this.oppEmoji = (opp && opp.emoji) || '';

    // Hidden challenge (M3b): retired. Forcing this false collapses every
    // challengeActive/challengeLive branch below back to plain, ungated play
    // (normal difficulty, no hazing, no taunts) for every profile. The entry
    // point is neutralized here rather than deleting the branches themselves --
    // see js/challenge/keepsake.js for what replaced it.
    this.challengeActive = false;

    // Runtime state.
    this.game = null;
    this.busy = false;        // true while the AI thinks or a drop animates
    this.hoverCol = -1;
    this.ghostEl = null;
    this.hiCells = [];
    this.humanHasMoved = false;
    this.showBestMoves = false;
    this.hintReqId = 0;
    // C4-2/C4-3: one shared disqualification flag, reset per game (startGame()).
    // Set by a confirmed undo or by confirming "Show best moves" - either taints
    // the same flag, so the game records no W/L when it ends (see the
    // recordConnect4 call). Never re-prompts again once true for this game.
    this._statsDisqualified = false;
    this.worker = null;
    this.workerCallbacks = new Map(); // request id -> { resolve, reject }
    this.requestId = 0;

    // Bound handlers (stable refs for add/removeEventListener).
    this._onBoardClick = (e) => this.onBoardClick(e);
    this._onBoardMove = (e) => this.onBoardPointerMove(e);
    this._onBoardLeave = () => this.clearHover();
    this._onKeyDown = (e) => this.onKeyDown(e);

    ensureStylesheet();
    this.setupWorker();
    this.mount();
  }

  // --- Worker plumbing ------------------------------------------------------

  setupWorker() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const cb = this.workerCallbacks.get(e.data.id);
        if (!cb) return; // stale / unknown
        this.workerCallbacks.delete(e.data.id);
        if (e.data.error) cb.reject(new Error(e.data.error));
        else cb.resolve(e.data);
      };
      this.worker.onerror = () => {
        for (const cb of this.workerCallbacks.values()) cb.reject(new Error('worker error'));
        this.workerCallbacks.clear();
        this.disableWorker();
      };
    } catch {
      this.worker = null; // workers unavailable -> main-thread fallback
    }
  }

  disableWorker() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  postToWorker(params) {
    return new Promise((resolve, reject) => {
      this.workerCallbacks.set(params.id, { resolve, reject });
      this.worker.postMessage(params);
    });
  }

  /** The difficulty the AI actually plays. Normally this.difficulty; during the hidden
   *  challenge it is silently forced (Expert while hazing, then Easy) with the visible
   *  label left untouched, so the switch is invisible. */
  effectiveDifficulty() {
    if (!this.challengeLive) return this.difficulty;
    try { return cfForcedDifficulty(loadChallenge().cf.completed); } catch { return this.difficulty; }
  }

  /** Resolve to the AI's chosen column, via worker if possible, else inline. */
  async requestAIMove() {
    const params = {
      id: ++this.requestId,
      kind: 'move',
      history: this.game.history.slice(),
      firstPlayer: this.game.firstPlayer,
      difficulty: this.effectiveDifficulty(),
      budgetMs: EXPERT_BUDGET_MS,
    };
    if (this.worker) {
      try { return (await this.postToWorker(params)).col; }
      catch { this.disableWorker(); } // fall through to inline compute
    }
    return this.computeInline(params);
  }

  /** Resolve to per-column evaluations for the "show best moves" helper. */
  async requestEval() {
    const params = {
      id: ++this.requestId,
      kind: 'eval',
      history: this.game.history.slice(),
      firstPlayer: this.game.firstPlayer,
      budgetMs: HINT_BUDGET_MS,
    };
    if (this.worker) {
      try {
        const r = await this.postToWorker(params);
        return { evals: r.evals, exact: r.exact, reachedDepth: r.reachedDepth };
      } catch { this.disableWorker(); }
    }
    const { evaluateColumns } = await import('./ai.js');
    const game = new Game(params.firstPlayer);
    for (const c of params.history) game.play(c);
    await new Promise((r) => setTimeout(r, 16));
    // Workers unavailable: this runs ON the UI thread, so Pass 1's exact
    // attempt gets a much smaller slice than the worker path's default (2500ms)
    // — "nothing blocks" only applies in a worker.
    const evals = evaluateColumns(game.board, game.currentPlayer, params.budgetMs, INLINE_EXACT_ATTEMPT_MS);
    return {
      evals: evals.map((v) => ({ col: v.col, score: v.score, exact: v.exact })),
      exact: evals.exact, reachedDepth: evals.reachedDepth,
    };
  }

  async computeInline(params) {
    const { AI } = await import('./ai.js');
    const game = new Game(params.firstPlayer);
    for (const c of params.history) game.play(c);
    const ai = new AI(params.difficulty, { expertBudgetMs: params.budgetMs });
    await new Promise((r) => setTimeout(r, 16)); // let "thinking…" paint first
    return ai.chooseMove(game);
  }

  // --- DOM construction -----------------------------------------------------

  mount() {
    this.container.innerHTML = `
      <div class="cf-root">
        <header class="cf-header" data-role="header">
          <h1 class="cf-title">${t('title')}</h1>
        </header>

        <section class="cf-setup" aria-label="${t('setup_aria')}">
          <p class="cf-challenge-note" data-role="challenge-note" hidden></p>
          <div class="cf-field">
            <span class="cf-label">${t('difficulty')}</span>
            <div class="cf-segmented" data-role="difficulty">
              ${DIFFICULTY_LABELS.map(([val, labelKey]) =>
                `<button type="button" class="cf-seg" data-value="${val}">${diffShapeSVG(tierOf(val))}<span>${t(labelKey)}</span></button>`).join('')}
            </div>
          </div>

          <div class="cf-field">
            <span class="cf-label">${t('who_first')}</span>
            <div class="cf-segmented" data-role="first">
              <button type="button" class="cf-seg" data-value="you">${t('you')}</button>
              <button type="button" class="cf-seg" data-value="ai">${this.oppLabel()}</button>
              <button type="button" class="cf-seg" data-value="alternate">${t('alternate')}</button>
            </div>
          </div>

          <button type="button" class="cf-btn cf-btn-primary" data-role="start">${t('start_game')}</button>
        </section>

        <section class="cf-game" hidden>
          <div class="cf-statusbar">
            <span class="cf-turn-dot" data-role="dot"></span>
            <span class="cf-status" data-role="status" role="status" aria-live="polite">${t('your_move')}</span>
            <span class="cf-bar-actions">
              <button type="button" class="cf-btn cf-btn-ghost" data-role="undo" title="${t('undo_title')}">${t('undo_btn')}</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu">${t('menu')}</button>
            </span>
          </div>

          <div class="cf-subbar">
            <span class="cf-legend">
              <span class="cf-legend-item"><span class="cf-chip p1"></span>${this.humanLabel()}</span>
              <span class="cf-legend-item"><span class="cf-chip p2"></span>${this.oppLabel()}</span>
            </span>
            <span class="cf-hint" data-role="hint">${t('tap_column_hint')}</span>
          </div>

          <div class="cf-hints" data-role="hints" hidden>
            <div class="cf-eval-row" data-role="eval-row"></div>
            <p class="cf-eval-caption" data-role="eval-caption"></p>
            <p class="cf-eval-fallible" data-role="eval-fallible" hidden></p>
          </div>

          <div class="cf-board-wrap">
            <div class="cf-board" data-role="board" role="grid" aria-label="${t('board_aria')}"></div>
          </div>

          <div class="cf-result" data-role="result" hidden>
            <button type="button" class="cf-result-x" data-role="result-close" aria-label="${t('close')}">✕</button>
            <p class="cf-result-msg" data-role="result-msg"></p>
            <div class="cf-result-actions">
              <button type="button" class="cf-btn cf-btn-primary" data-role="rematch">${t('rematch')}</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="change">${t('change_settings')}</button>
            </div>
          </div>
        </section>

        <div class="cf-menu" data-role="menu-panel" hidden>
          <div class="cf-menu-scrim" data-role="menu-scrim"></div>
          <div class="cf-menu-card" role="dialog" aria-modal="true" aria-label="${t('menu_dialog_aria')}">
            <h2 class="cf-menu-title">${t('menu')}</h2>
            <label class="cf-switch">
              <input type="checkbox" data-role="hint-toggle">
              <span class="cf-switch-track"><span class="cf-switch-thumb"></span></span>
              <span class="cf-switch-text">${t('show_best_moves')}</span>
            </label>
            <p class="cf-menu-note">${t('menu_note')}</p>
            <div class="cf-menu-actions">
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-undo">${t('menu_undo')}</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-restart">${t('restart_game')}</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-quit">${t('quit_to_setup')}</button>
            </div>
            <button type="button" class="cf-btn cf-btn-primary" data-role="menu-resume">${t('resume_game')}</button>
          </div>
        </div>

        <div class="cf-menu" data-role="stats-confirm" hidden>
          <div class="cf-menu-scrim" data-role="stats-confirm-cancel"></div>
          <div class="cf-menu-card" role="dialog" aria-modal="true" aria-label="${t('confirm_dialog_aria')}">
            <p class="cf-menu-note" data-role="stats-confirm-msg"></p>
            <div class="cf-menu-actions">
              <button type="button" class="cf-btn cf-btn-ghost" data-role="stats-confirm-cancel-btn">${t('cancel')}</button>
              <button type="button" class="cf-btn cf-btn-primary" data-role="stats-confirm-ok">${t('confirm')}</button>
            </div>
          </div>
        </div>
      </div>`;

    const root = this.container.querySelector('.cf-root');
    const q = (sel) => root.querySelector(sel);
    this.el = {
      header: q('[data-role="header"]'),
      setup: root.querySelector('.cf-setup'),
      game: root.querySelector('.cf-game'),
      board: q('[data-role="board"]'),
      status: q('[data-role="status"]'),
      dot: q('[data-role="dot"]'),
      hint: q('[data-role="hint"]'),
      undo: q('[data-role="undo"]'),
      hints: q('[data-role="hints"]'),
      evalRow: q('[data-role="eval-row"]'),
      evalCaption: q('[data-role="eval-caption"]'),
      evalFallible: q('[data-role="eval-fallible"]'),
      result: q('[data-role="result"]'),
      resultMsg: q('[data-role="result-msg"]'),
      difficulty: q('[data-role="difficulty"]'),
      first: q('[data-role="first"]'),
      menuPanel: q('[data-role="menu-panel"]'),
      hintToggle: q('[data-role="hint-toggle"]'),
      statsConfirm: q('[data-role="stats-confirm"]'),
      statsConfirmMsg: q('[data-role="stats-confirm-msg"]'),
    };

    // Setup-screen wiring.
    this.el.difficulty.addEventListener('click', (e) => {
      const btn = e.target.closest('.cf-seg'); if (!btn) return;
      this.difficulty = btn.dataset.value;
      this.syncSegmented(this.el.difficulty, this.difficulty);
    });
    this.el.first.addEventListener('click', (e) => {
      const btn = e.target.closest('.cf-seg'); if (!btn) return;
      this.firstMode = btn.dataset.value;
      if (this.firstMode !== 'alternate') this.humanFirst = this.firstMode === 'you';
      saveC4Settings({ firstMode: this.firstMode, nextStarter: this.nextStarter });
      this.syncSegmented(this.el.first, this.firstMode);
    });
    root.querySelector('[data-role="start"]').addEventListener('click', () => this.startGame());
    root.querySelector('[data-role="rematch"]').addEventListener('click', () => this.startGame());
    root.querySelector('[data-role="change"]').addEventListener('click', () => this.showSetup());
    // Connect Four's board is never hidden behind its result banner (unlike
    // other games' overlay modals), so there's no "view board" to route to -
    // the X just hides the banner itself, reclaiming the space it took so the
    // full board shows without needing a rematch/settings change first.
    root.querySelector('[data-role="result-close"]').addEventListener('click', () => { this.el.result.hidden = true; });

    // In-game controls.
    this.el.undo.addEventListener('click', () => this.requestUndo());
    root.querySelector('[data-role="menu"]').addEventListener('click', () => this.openMenu());

    // Menu panel. Restart/Quit abandon the game, so they confirm-on-second-tap
    // while a game is in progress (no friction once it's already over).
    const restartBtn = root.querySelector('[data-role="menu-restart"]');
    const quitBtn = root.querySelector('[data-role="menu-quit"]');
    root.querySelector('[data-role="menu-resume"]').addEventListener('click', () => this.closeMenu());
    root.querySelector('[data-role="menu-scrim"]').addEventListener('click', () => this.closeMenu());
    root.querySelector('[data-role="menu-undo"]').addEventListener('click', () => { this.closeMenu(); this.requestUndo(); });
    restartBtn.addEventListener('click', () => this.confirmDestructive(restartBtn, () => { this.closeMenu(); this.startGame(); }));
    // Quitting to setup abandons the current game (unlike hub navigation): clear the
    // save so a later mount doesn't silently resume a game the player explicitly left.
    quitBtn.addEventListener('click', () => this.confirmDestructive(quitBtn, () => { clearC4Game(); this.game = null; this.closeMenu(); this.showSetup(); }));
    this.el.hintToggle.addEventListener('change', () => this.onHintToggle());
    root.querySelector('[data-role="stats-confirm-cancel"]').addEventListener('click', () => this.cancelStatsConfirm());
    root.querySelector('[data-role="stats-confirm-cancel-btn"]').addEventListener('click', () => this.cancelStatsConfirm());
    root.querySelector('[data-role="stats-confirm-ok"]').addEventListener('click', () => this.confirmStatsConfirm());

    // Board interaction (delegated).
    this.el.board.addEventListener('click', this._onBoardClick);
    this.el.board.addEventListener('pointermove', this._onBoardMove);
    this.el.board.addEventListener('pointerleave', this._onBoardLeave);
    document.addEventListener('keydown', this._onKeyDown);

    this.syncSegmented(this.el.difficulty, this.difficulty);
    this.syncSegmented(this.el.first, this.firstMode);
    this.buildBoardCells();
    // Come back to exactly where you left off: an in-progress game (from the hub
    // back button, a reload, or closing the PWA) resumes silently, straight onto
    // the board — no "resume?" dialog. Otherwise start at setup as before.
    const saved = loadC4Game();
    if (saved) this.resumeGame(saved); else this.showSetup();   // showSetup() calls syncChallengeUi()
  }

  /** Restore a saved in-progress game straight into the live game screen. If the
   *  save was interrupted mid AI-think (the human's move was applied and saved,
   *  but the AI's reply never landed), hand the turn back to the AI immediately. */
  resumeGame(saved) {
    this.difficulty = saved.difficulty;
    this.showBestMoves = saved.showBestMoves;
    this._statsDisqualified = saved.statsDisqualified;
    this.humanHasMoved = saved.humanHasMoved;
    this.game = saved.game;
    this.busy = false;
    this.hoverCol = -1;
    this.clearHover();
    this.syncSegmented(this.el.difficulty, this.difficulty);
    this.syncChallengeUi();
    this.redrawBoard();
    this.el.result.hidden = true;
    this.closeMenu();
    this.el.setup.hidden = true;
    this.el.header.hidden = true;
    this.el.game.hidden = false;
    if (this.showBestMoves) { this.el.hints.hidden = false; this.clearEvalRow(); } else this.hideHints();
    this.updateStatus();
    if (this.game.currentPlayer === this.aiPlayer) this.aiTurn();
    else this.refreshHints();
  }

  /** Still working on the Connect Four challenge? (active AND not yet won). Once won, the
   *  game reverts to fully normal play. Dynamic, re-read each time. */
  get challengeLive() {
    if (!this.challengeActive) return false;
    try { return !loadChallenge().wins.connect4; } catch { return true; }
  }

  /** Configure the challenge UI for the CURRENT state; called each time the setup shows
   *  or a game starts. While the challenge is unwon: hide assist + undo, gray out the
   *  fixed setup choices, and use a "Begin challenge" bar / "Retry Challenge" end button.
   *  Once won: normal play, with a "completed, play anyways?" note. No-op for others. */
  syncChallengeUi() {
    if (!this.challengeActive) return;
    const live = this.challengeLive;
    if (live) this.showBestMoves = false;
    const sw = this.el.hintToggle.closest('.cf-switch'); if (sw) sw.hidden = live;
    const menuNote = this.el.menuPanel.querySelector('.cf-menu-note'); if (menuNote) menuNote.hidden = live;
    this.el.undo.hidden = live;
    const mu = this.el.menuPanel.querySelector('[data-role="menu-undo"]'); if (mu) mu.hidden = live;
    const startBtn = this.el.setup.querySelector('[data-role="start"]');
    if (startBtn) { startBtn.textContent = live ? t('begin_challenge') : t('start_game'); startBtn.classList.toggle('cf-btn-challenge', live); }
    [this.el.difficulty, this.el.first].forEach((g) => { if (g) g.classList.toggle('is-locked', live); });
    const cnote = this.el.setup.querySelector('[data-role="challenge-note"]');
    if (cnote) { cnote.hidden = live; cnote.textContent = live ? '' : t('challenge_completed_note'); }
    const rematch = this.el.result.querySelector('[data-role="rematch"]');
    if (rematch) rematch.textContent = live ? t('retry_challenge') : t('rematch');
    const change = this.el.result.querySelector('[data-role="change"]');
    if (change) change.hidden = live;
  }

  syncSegmented(group, value) {
    group.querySelectorAll('.cf-seg').forEach((b) =>
      b.classList.toggle('is-selected', b.dataset.value === value));
  }

  /** Escaped "emoji name" (or just name) for the human / opponent, safe for innerHTML. */
  humanLabel() { return this.humanEmoji ? `${esc(this.humanEmoji)} ${esc(this.humanName)}` : esc(this.humanName); }
  oppLabel() { return this.oppEmoji ? `${esc(this.oppEmoji)} ${esc(this.oppName)}` : esc(this.oppName); }

  buildBoardCells() {
    const cells = [];
    // Visual rows top (engine row ROWS-1) to bottom (engine row 0).
    for (let vr = 0; vr < ROWS; vr++) {
      const r = ROWS - 1 - vr;
      for (let c = 0; c < COLS; c++) {
        cells.push(
          `<div class="cf-cell" data-col="${c}" data-row="${r}" role="gridcell"` +
          ` aria-label="${t('col_row_empty_aria', { col: c + 1, row: r + 1 })}" style="--cf-vr:${vr}">` +
          `<div class="cf-piece"></div></div>`);
      }
    }
    this.el.board.innerHTML = cells.join('');
  }

  /** Update a cell's accessible label to reflect its occupant. */
  labelCell(col, row, who) {
    const cell = this.el.board.querySelector(`.cf-cell[data-col="${col}"][data-row="${row}"]`);
    if (!cell) return;
    const occ = who === this.humanPlayer ? t('your_disc') : who >= 0 ? t('computer_disc') : t('empty');
    cell.setAttribute('aria-label', t('col_row_occ_aria', { col: col + 1, row: row + 1, occ }));
  }

  // --- Screen transitions ---------------------------------------------------

  showSetup() {
    this.busy = false;
    this.clearHover();
    this.hideHints();
    this.closeMenu();
    this.el.game.hidden = true;
    this.el.header.hidden = false; // title belongs on the setup screen
    this.el.setup.hidden = false;
    this.syncChallengeUi();
  }

  startGame() {
    this.syncChallengeUi();   // reflect current challenge state (assist/undo, etc.)
    // Fresh game -> drop the exact solver's cached bounds from the last one
    // (module-scope transTable in ai.js persists across the worker's whole
    // lifetime otherwise; harmless to keep but unbounded across many rematches
    // in one sitting). Fire-and-forget: nothing waits on this.
    if (this.worker) this.worker.postMessage({ id: ++this.requestId, kind: 'newgame' });
    else import('./ai.js').then((m) => m.clearTranspositionTable());
    // Who opens this game. 'alternate' flips on EVERY completed game (including rematches):
    // consume this.nextStarter, then bank the flip immediately so it survives leaving mid-game
    // (mirrors mancala/js/ui.js:359-366, the reference pattern).
    if (this.firstMode === 'alternate') {
      this.humanFirst = this.nextStarter === 'you';
      this.nextStarter = this.nextStarter === 'you' ? 'ai' : 'you';
      saveC4Settings({ firstMode: this.firstMode, nextStarter: this.nextStarter });
    }
    const firstPlayer = this.humanFirst ? this.humanPlayer : this.aiPlayer;
    this.game = new Game(firstPlayer);
    this.busy = false;
    this.hoverCol = -1;
    this.humanHasMoved = false;
    // C4-2/C4-3: fresh game, fresh flag - except "Show best moves" persists
    // across rematches, and per THE LAW rule 2 (Matt's stated simplest rule),
    // hints on at ANY point in the game disqualifies it, including already
    // being on when it starts. No re-prompt here: the confirm already
    // happened whenever it was first turned on.
    this._statsDisqualified = this.showBestMoves;

    // Reset board visuals.
    this.buildBoardCells();
    this.el.result.hidden = true;
    this.clearEvalRow();
    if (this.showBestMoves) { this.el.hints.hidden = false; this.renderEvalRow(null); }
    else this.hideHints();
    this.closeMenu();

    this.el.setup.hidden = true;
    this.el.header.hidden = true;  // reclaim vertical space for the board
    this.el.game.hidden = false;

    this.updateStatus();
    saveC4Game(this); // checkpoint the fresh game immediately (0 moves is still resumable)
    if (this.game.currentPlayer === this.aiPlayer) this.aiTurn();
    else this.refreshHints();
  }

  // --- Menu panel -----------------------------------------------------------

  openMenu() {
    this._menuReturnFocus = document.activeElement;
    this.el.hintToggle.checked = this.showBestMoves;
    this.el.menuPanel.querySelector('[data-role="menu-undo"]').disabled = !this.canUndo();
    this.el.menuPanel.hidden = false;
    this.el.menuPanel.querySelector('[data-role="menu-resume"]').focus(); // focus into the dialog
  }

  closeMenu() {
    this.resetConfirms();
    this.el.menuPanel.hidden = true;
    if (this._menuReturnFocus && this._menuReturnFocus.focus) this._menuReturnFocus.focus();
    this._menuReturnFocus = null;
  }

  /** Run `action` immediately if the game is over; otherwise require a second
   *  confirming tap on `btn` (a guard against accidentally abandoning a game). */
  confirmDestructive(btn, action) {
    if (!this.game || this.game.isOver()) { action(); return; }
    if (btn.dataset.armed === '1') { this.resetConfirms(); action(); return; }
    this.resetConfirms();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = t('tap_again_confirm');
    btn.classList.add('is-confirm');
    this._confirmTimer = setTimeout(() => this.resetConfirms(), 3500);
  }

  resetConfirms() {
    clearTimeout(this._confirmTimer);
    for (const role of ['menu-restart', 'menu-quit']) {
      const b = this.el.menuPanel.querySelector(`[data-role="${role}"]`);
      if (b && b.dataset.armed === '1') {
        b.textContent = b.dataset.label;
        b.dataset.armed = '';
        b.classList.remove('is-confirm');
      }
    }
  }

  /** C4-3: turning "Show best moves" ON taints stats the same way an undo does
   *  (one shared flag - see _statsDisqualified). Turning it off, or turning it
   *  on when the game is already disqualified, needs no prompt. Declining
   *  reverts the checkbox instead of silently leaving it checked but inert. */
  onHintToggle() {
    const turningOn = this.el.hintToggle.checked && !this.showBestMoves;
    if (turningOn && this.game && !this._statsDisqualified) {
      this.showStatsConfirm(
        t('hint_toggle_confirm'),
        () => { this._statsDisqualified = true; this.applyHintToggle(true); },
      );
      return; // checkbox stays checked visually until confirmed/reverted
    }
    this.applyHintToggle(this.el.hintToggle.checked);
  }

  applyHintToggle(on) {
    this.showBestMoves = on;
    this.el.hintToggle.checked = on;
    if (this.showBestMoves) { this.clearEvalRow(); this.refreshHints(); }
    else { this.hideHints(); this.clearEvalRow(); }
    saveC4Game(this); // the toggle (and any disqualification it just caused) must persist
  }

  // --- Turn flow ------------------------------------------------------------

  isHumanTurn() {
    return this.game && !this.game.isOver() && this.game.currentPlayer === this.humanPlayer;
  }

  onBoardClick(e) {
    if (this.busy || !this.isHumanTurn()) return;
    const cell = e.target.closest('.cf-cell');
    if (!cell) return;
    this.humanMove(+cell.dataset.col);
  }

  onKeyDown(e) {
    if (this.el.game.hidden) return;
    if (!this.el.statsConfirm.hidden) {     // confirm open: Esc cancels, ignore game keys
      if (e.key === 'Escape') this.cancelStatsConfirm();
      return;
    }
    if (!this.el.menuPanel.hidden) {       // menu open: Esc closes, ignore game keys
      if (e.key === 'Escape') this.closeMenu();
      return;
    }
    if (e.key >= '1' && e.key <= '7') {
      if (this.busy || !this.isHumanTurn()) return;
      this.humanMove(+e.key - 1);
    }
  }

  async humanMove(col) {
    if (this.busy || !this.game.board.canPlay(col)) return;
    this.busy = true;          // lock input + undo through the drop animation
    this.clearHover();
    this.dimHints(); // about to be the computer's turn — dim but keep reserved
    await this.applyMove(col);
    if (this.game.isOver()) return;
    if (this.game.currentPlayer === this.aiPlayer) {
      this.aiTurn();           // keeps busy = true until the AI has replied
    } else {
      this.busy = false;
      this.updateStatus();
    }
  }

  async aiTurn() {
    this.busy = true;
    this.dimHints();
    this.updateStatus();
    let col;
    try {
      col = await this.requestAIMove();
    } catch {
      // Last-resort inline compute if the worker path threw.
      col = await this.computeInline({
        history: this.game.history.slice(),
        firstPlayer: this.game.firstPlayer,
        difficulty: this.effectiveDifficulty(),
        budgetMs: EXPERT_BUDGET_MS,
      });
    }
    // Guard against a teardown / new game during the async wait.
    if (!this.game || this.game.isOver() || this.game.currentPlayer !== this.aiPlayer) return;
    await this.applyMove(col);
    this.busy = false;
    if (!this.game.isOver()) { this.updateStatus(); this.refreshHints(); }
  }

  /** Play `col` for the current player and animate the dropped disc. */
  async applyMove(col) {
    const player = this.game.currentPlayer;
    const row = this.game.board.heights[col]; // landing row (before the move)
    this.game.play(col);
    if (player === this.humanPlayer) this.humanHasMoved = true;
    // Flip the turn label the instant the disc starts dropping (avoids a stale
    // "Computer is thinking…" while the AI's disc is already visibly falling).
    if (!this.game.isOver()) this.updateStatus();
    await this.dropPiece(col, row, player);
    saveC4Game(this); // checkpoint after every settled move (clears itself once over)
    if (this.game.isOver()) this.endGame();
  }

  dropPiece(col, row, player) {
    const piece = this.el.board.querySelector(
      `.cf-cell[data-col="${col}"][data-row="${row}"] .cf-piece`);
    if (!piece) return Promise.resolve();
    piece.classList.add(player === PLAYER_ONE ? 'p1' : 'p2', 'is-dropping');
    this.labelCell(col, row, player);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; piece.classList.remove('is-dropping'); resolve(); };
      piece.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, DROP_MS + 80); // fallback if animationend doesn't fire
    });
  }

  // --- Hover preview --------------------------------------------------------

  onBoardPointerMove(e) {
    if (this.busy || !this.isHumanTurn()) { this.clearHover(); return; }
    const cell = e.target.closest('.cf-cell');
    if (!cell) { this.clearHover(); return; }
    const col = +cell.dataset.col;
    if (col !== this.hoverCol) this.setHover(col);
  }

  setHover(col) {
    this.clearHover();
    this.hoverCol = col;
    if (!this.game.board.canPlay(col)) return;
    this.hiCells = [...this.el.board.querySelectorAll(`.cf-cell[data-col="${col}"]`)];
    this.hiCells.forEach((c) => c.classList.add('cf-col-hi'));
    const row = this.game.board.heights[col];
    const target = this.el.board.querySelector(
      `.cf-cell[data-col="${col}"][data-row="${row}"] .cf-piece`);
    if (target) {
      target.classList.add('cf-ghost', this.humanPlayer === PLAYER_ONE ? 'p1' : 'p2');
      this.ghostEl = target;
    }
  }

  clearHover() {
    this.hoverCol = -1;
    if (this.hiCells.length) {
      this.hiCells.forEach((c) => c.classList.remove('cf-col-hi'));
      this.hiCells = [];
    }
    if (this.ghostEl) {
      this.ghostEl.classList.remove('cf-ghost', 'p1', 'p2');
      this.ghostEl = null;
    }
  }

  // --- Status & end of game -------------------------------------------------

  updateStatus() {
    const turn = this.game.currentPlayer;
    this.el.dot.classList.toggle('p1', turn === PLAYER_ONE);
    this.el.dot.classList.toggle('p2', turn === PLAYER_TWO);
    let text;
    if (this.busy && turn === this.aiPlayer) text = t('opp_thinking', { opp: this.oppName });
    else if (turn === this.humanPlayer) text = t('your_move');
    else text = t('opp_move', { opp: this.oppName });
    this.el.status.textContent = text;
    // Cue that the board isn't tappable unless it's your turn (no dead-tap mystery).
    this.el.board.classList.toggle('is-locked', !(turn === this.humanPlayer && !this.busy));
    this.updateHint();
    this.updateUndoState();
  }

  /** Show the "tap a column" hint only while the human hasn't moved yet. */
  updateHint() {
    const show = this.game && !this.game.isOver() && !this.humanHasMoved
      && this.game.currentPlayer === this.humanPlayer;
    this.el.hint.hidden = !show;
  }

  updateUndoState() {
    this.el.undo.disabled = !this.canUndo();
  }

  endGame() {
    clearC4Game(); // game end (result recorded) is one of the cross-cutting clear points
    this.busy = false;
    this.clearHover();
    this.dimHints(); // keep the hint row reserved (dimmed) — no end-of-game shift
    this.el.hint.hidden = true;

    let msg, dot = null;
    if (this.game.status === WIN) {
      const line = this.game.board.findWinningLine(this.game.winner);
      if (line) {
        line.forEach(([c, r]) => {
          const p = this.el.board.querySelector(`.cf-cell[data-col="${c}"][data-row="${r}"] .cf-piece`);
          if (p) p.classList.add('cf-win');
        });
      }
      const youWon = this.game.winner === this.humanPlayer;
      msg = youWon ? t('you_win') : t('opp_wins', { opp: this.oppName });
      dot = this.game.winner === PLAYER_ONE ? 'p1' : 'p2';
      this.el.result.dataset.outcome = youWon ? 'win' : 'loss';
    } else if (this.game.status === DRAW) {
      msg = t('draw');
      this.el.result.dataset.outcome = 'draw';
    }

    // Show the outcome in the (always-visible) status bar — so you see who won
    // without scrolling, and the top isn't an orphaned dot — and color the dot
    // to the winner. The board (with its highlighted line) stays fully visible.
    this.el.dot.classList.toggle('p1', dot === 'p1');
    this.el.dot.classList.toggle('p2', dot === 'p2');
    this.el.status.textContent = msg;
    // C4-2/C4-3: say so on the result banner itself when this game won't be
    // recorded - a silent skip would just look like the stats are broken.
    this.el.resultMsg.textContent = msg + (this._statsDisqualified ? t('not_counted') : '');
    this.el.result.hidden = false;
    this.updateUndoState(); // can still take back the final move
    // Bring the Rematch / Change-settings actions into view on tall layouts.
    this.el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Record the finished game for Game Stats (every player, not just the challenge). Guard on the
    // game object so a stray re-entry can't double-count. this.difficulty is the player's pick
    // (never the hazing's forced level). firstMove tracks WHO MOVED FIRST (humanPlayer === PLAYER_ONE).
    // A draw records as played-only (won = null), which the stats grid leaves out (W/L only).
    // C4-2/C4-3: a confirmed undo or "show best moves" this game taints
    // _statsDisqualified - skip recordConnect4 entirely so the game leaves no
    // W/L trace (not even a loss), same as never having recorded it.
    if (this.game && !this.game._statsRecorded) {
      this.game._statsRecorded = true;
      if (!this._statsDisqualified) {
        const won = this.game.status === WIN ? (this.game.winner === this.humanPlayer) : null;
        const firstMove = this.game.firstPlayer === this.humanPlayer ? 'player' : 'computer';
        recordConnect4(this.difficulty, firstMove, won);
      }
    }

    if (this.challengeLive) {
      this.onChallengeGameEnd(this.game.status === WIN && this.game.winner === this.humanPlayer);
    }
  }

  /** Count the completed game for the hazing and, once past it, award the Connect Four
   *  code on a genuine win. Only difficulty was ever forced; this win is real. */
  onChallengeGameEnd(youWon) {
    try {
      const before = loadChallenge().cf.completed;
      updateChallenge((st) => { st.cf.completed = (st.cf.completed | 0) + 1; });
      if (youWon && cfInEasyPhase(before)) {
        recordWin('connect4');
        showCodeReveal(codeFor('connect4'), 'Connect Four');
      } else if (!youWon) {
        showTaunt(taunt(before));   // Matt's escalating taunt on each rigged loss
      }
    } catch { /* never break the game */ }
  }

  // --- Undo -----------------------------------------------------------------

  /** True if there's a human move to take back (and we're not mid-think). */
  canUndo() {
    return !this.challengeLive && !!this.game && !this.busy && this.humanHasMoved;
  }

  /** C4-2: the FIRST undo in a game asks for confirmation (it taints stats);
   *  once disqualified, later undos in the same game just undo directly. */
  requestUndo() {
    if (!this.canUndo()) return;
    if (this._statsDisqualified) { this.undo(); return; }
    this.showStatsConfirm(
      t('undo_confirm'),
      () => { this._statsDisqualified = true; this.undo(); },
    );
  }

  /** Shared confirm dialog for C4-2/C4-3 - reuses the menu's scrim/card look. */
  showStatsConfirm(message, onConfirm) {
    this._statsConfirmAction = onConfirm;
    this.el.statsConfirmMsg.textContent = message;
    this.el.statsConfirm.hidden = false;
  }

  cancelStatsConfirm() {
    this._statsConfirmAction = null;
    this.el.statsConfirm.hidden = true;
    // Reverting a declined hint-toggle confirm needs the checkbox put back.
    this.el.hintToggle.checked = this.showBestMoves;
  }

  confirmStatsConfirm() {
    const action = this._statsConfirmAction;
    this._statsConfirmAction = null;
    this.el.statsConfirm.hidden = true;
    if (action) action();
  }

  /**
   * Take back to just before the human's most recent move (also removing the
   * computer's reply), so it's the human's turn again. Rebuilds the game from
   * the truncated history and redraws the board without animation.
   */
  undo() {
    if (!this.canUndo()) return;
    const fp = this.game.firstPlayer;
    const hist = this.game.history;
    let len = hist.length;
    do { len--; } while (len > 0 && ((fp ^ (len % 2)) !== this.humanPlayer));
    const kept = hist.slice(0, len);

    this.game = new Game(fp);
    for (const c of kept) this.game.play(c);
    this.humanHasMoved = kept.some((_, i) => (fp ^ (i % 2)) === this.humanPlayer);
    this.busy = false;
    this.clearHover();
    this.redrawBoard();
    this.el.result.hidden = true;
    this.updateStatus();
    this.refreshHints();
    saveC4Game(this); // the undo (and its disqualification, if just confirmed) must persist
  }

  /** Repaint every cell from the current game state (no drop animation). */
  redrawBoard() {
    this.buildBoardCells();
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < this.game.board.heights[c]; r++) {
        const who = this.game.board.cellAt(c, r);
        const piece = this.el.board.querySelector(`.cf-cell[data-col="${c}"][data-row="${r}"] .cf-piece`);
        if (piece) piece.classList.add(who === PLAYER_ONE ? 'p1' : 'p2');
        this.labelCell(c, r, who);
      }
    }
  }

  // --- Best-moves hints -----------------------------------------------------

  // The hint area's on-screen presence is tied ONLY to the toggle — never to
  // whose turn it is — so the board never shifts up/down between turns.

  hideHints() {
    this.hintReqId++; // invalidate any in-flight analysis
    if (this.el && this.el.hints) {
      this.el.hints.hidden = true;
      this.el.hints.classList.remove('is-stale');
      this.setThinking(false);
    }
  }

  /** Keep the hint row reserved + visible but dimmed (not the human's turn). */
  dimHints() {
    if (this.showBestMoves && this.el && this.el.hints) {
      this.el.hints.hidden = false;
      if (this.el.evalRow.childElementCount === 0) this.renderEvalRow(null);
      this.el.hints.classList.add('is-stale');
      this.setThinking(false); // the status bar already shows the computer thinking
    }
  }

  clearEvalRow() {
    if (!this.el) return;
    this.el.evalRow.innerHTML = '';
    this.el.evalCaption.textContent = '';
    this.el.evalFallible.hidden = true;
  }

  /** Request and display per-column evaluations (only on the human's turn). */
  refreshHints() {
    if (!this.showBestMoves) { this.hideHints(); return; }
    this.el.hints.hidden = false; // reserve the space whenever the toggle is on
    if (!this.game || this.game.isOver() || this.busy
      || this.game.currentPlayer !== this.humanPlayer) {
      this.dimHints();
      return;
    }
    const reqId = ++this.hintReqId;
    // Keep the previous chips visible but dimmed while recomputing (no flicker);
    // only show placeholders the very first time, when there's nothing to dim.
    if (this.el.evalRow.childElementCount === 0) this.renderEvalRow(null);
    this.el.hints.classList.add('is-stale');
    this.setThinking(true); // animated "Analyzing…" so it's clear it's working
    this.requestEval().then((data) => {
      if (reqId !== this.hintReqId || !this.showBestMoves) return; // stale or toggled off
      this.el.hints.classList.remove('is-stale');
      this.setThinking(false);
      this.renderEvalRow(data);
    }).catch(() => { this.el.hints.classList.remove('is-stale'); this.setThinking(false); });
  }

  /** Animated ellipsis in the caption while the analysis is running. */
  setThinking(on) {
    if (!this.el) return;
    this._thinking = on;
    if (on) {
      this.el.evalCaption.innerHTML =
        `${t('analyzing')}<span class="cf-dots"><i>.</i><i>.</i><i>.</i></span>`;
      // C4-1: refreshHints() keeps the PREVIOUS position's star/box visible
      // (dimmed via is-stale) while a fresh analysis runs, so nothing flickers
      // between moves - but that star is the answer to the last position, not
      // the one being analyzed now. Suppress just the star/box look while
      // "Analyzing..." is showing; renderEvalRow() rebuilds the row fresh once
      // the real result lands, so nothing needs restoring here.
      for (const cell of this.el.evalRow.querySelectorAll('.cf-eval.is-best, .cf-eval.is-pick')) {
        cell.classList.remove('is-best', 'is-pick');
        if (cell.textContent === '★') { cell.textContent = '·'; cell.classList.add('is-faint'); }
      }
    }
    // When off, the next renderEvalRow() writes the real caption.
  }

  /**
   * `data.evals` is now a per-column mix (2026-07-23): each entry carries its
   * own `.exact` flag, since Pass 1 of evaluateColumns proves whatever it can
   * within its time slice every turn and the rest fall back to the Pass 2
   * estimate — a turn can be entirely solved, entirely estimated, or (most
   * turns, once the game is deep enough for SOME lines to resolve quickly)
   * a mix of both. Exact and estimate scores are on different scales (Pons
   * vs. the bitboard heuristic), so they're shown on their own terms per
   * column rather than compared — the single "best" pick prefers a PROVEN
   * win over anything estimated, falls back to the estimate ranking when no
   * column is fully solved, and only compares exact scores directly against
   * each other when every column got proven this turn.
   */
  renderEvalRow(data) {
    const row = this.el.evalRow;
    row.innerHTML = '';
    const byCol = new Map();
    if (data) for (const e of data.evals) byCol.set(e.col, e);

    let bestCol = -1;
    if (data && data.evals.length) {
      const exactWins = data.evals.filter((e) => e.exact && e.score > 0);
      const pool = exactWins.length ? exactWins
        : data.exact ? data.evals
        : data.evals.filter((e) => !e.exact);
      if (pool.length) {
        const best = Math.max(...pool.map((e) => e.score));
        for (const c of [3, 2, 4, 1, 5, 0, 6]) {
          if (pool.some((e) => e.col === c && e.score === best)) { bestCol = c; break; }
        }
      }
    }

    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cf-eval';
      if (!data) { cell.classList.add('is-loading'); cell.textContent = '·'; }
      else if (byCol.has(c)) {
        const e = byCol.get(c);
        if (c === bestCol) cell.classList.add('is-best'); // the single recommended move
        if (e.exact) {
          cell.textContent = e.score > 0 ? `+${e.score}` : `${e.score}`;
          cell.classList.add(e.score > 0 ? 'is-win' : e.score < 0 ? 'is-loss' : 'is-draw');
        } else {
          // Estimate mode: a ★ on the single pick, a faint dot elsewhere (blank
          // pills read as "failed to load").
          cell.textContent = c === bestCol ? '★' : '·';
          cell.classList.add(c === bestCol ? 'is-pick' : 'is-faint');
        }
      } else {
        cell.classList.add('is-empty'); // full column
      }
      row.appendChild(cell);
    }

    if (this._thinking) return; // don't clobber the animated "Analyzing…"
    if (!data) {
      this.el.evalCaption.textContent = '';
      this.el.evalFallible.hidden = true;
      return;
    }
    // A partially-solved turn (some columns proven, some not) is still "not
    // solved" as a whole — never call a mixed row "Solved".
    this.el.evalCaption.textContent = data.exact ? t('eval_solved') : t('eval_estimate');

    // Every column reads as losing on a sub-Expert difficulty: the AI itself
    // isn't perfect at this level, so a "you're doomed" panel would mislead.
    const belowExpert = this.difficulty !== Difficulty.EXPERT;
    const allNegative = data.evals.every((e) => e.score < 0);
    this.el.evalFallible.hidden = !(belowExpert && allNegative);
    if (!this.el.evalFallible.hidden) this.el.evalFallible.textContent = t('eval_fallible');
  }

  // --- Teardown -------------------------------------------------------------

  destroy() {
    // Checkpoint one last time: a move's game.play() commits synchronously, before its
    // drop animation (and the saveC4Game() call after it) resolves, so a destroy() that
    // lands mid-animation could otherwise leave the save one move stale. Never clears
    // here — leaving mid-game via the hub is the whole point of autosave/resume.
    saveC4Game(this);
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.el && this.el.board) {
      this.el.board.removeEventListener('click', this._onBoardClick);
      this.el.board.removeEventListener('pointermove', this._onBoardMove);
      this.el.board.removeEventListener('pointerleave', this._onBoardLeave);
    }
    this.disableWorker();
    this.workerCallbacks.clear();
    this.game = null;
    this.container.innerHTML = '';
  }
}

// --- Module contract --------------------------------------------------------

let instance = null;

/** Mount Connect Four into `container`. Replaces any prior instance. */
export function init(container) {
  if (instance) instance.destroy();
  instance = new ConnectFourUI(container);
  return instance;
}

/** Tear down the mounted game. */
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** Two legitimate meanings exist for this hook, depending on whether the game can
 *  resume (root CLAUDE.md, "The module contract"): literal "true while a game is
 *  actually in progress" for games with no mid-game resume, or "always false for
 *  solo play" for games with autosave/resume built in, because leaving is lossless.
 *  Connect Four moved to the second meaning (batch 9, 2026-07-23): every move is
 *  snapshotted to `gamehub.connect4.save.v1` and silently restored on mount, so the
 *  hub's "leave game?" confirm is no longer needed — there's nothing to lose. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
