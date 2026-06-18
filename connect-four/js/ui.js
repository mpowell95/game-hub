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

const EXPERT_BUDGET_MS = 1500; // per-move ceiling for Expert (incl. opening fallback)
const HINT_BUDGET_MS = 3000;   // budget for the "show best moves" per-column analysis
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
  [Difficulty.EASY, 'Easy'],
  [Difficulty.MEDIUM, 'Medium'],
  [Difficulty.HARD, 'Hard'],
  [Difficulty.EXPERT, 'Expert'],
];

class ConnectFourUI {
  constructor(container) {
    this.container = container;

    // Settings (human is always red / PLAYER_ONE; turn order is configurable).
    this.difficulty = Difficulty.MEDIUM;
    this.humanFirst = true;
    this.humanPlayer = PLAYER_ONE;
    this.aiPlayer = PLAYER_TWO;

    // Runtime state.
    this.game = null;
    this.busy = false;        // true while the AI thinks or a drop animates
    this.hoverCol = -1;
    this.ghostEl = null;
    this.hiCells = [];
    this.humanHasMoved = false;
    this.showBestMoves = false;
    this.hintReqId = 0;
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

  /** Resolve to the AI's chosen column, via worker if possible, else inline. */
  async requestAIMove() {
    const params = {
      id: ++this.requestId,
      kind: 'move',
      history: this.game.history.slice(),
      firstPlayer: this.game.firstPlayer,
      difficulty: this.difficulty,
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
        return { evals: r.evals, exact: r.exact };
      } catch { this.disableWorker(); }
    }
    const { evaluateColumns } = await import('./ai.js');
    const game = new Game(params.firstPlayer);
    for (const c of params.history) game.play(c);
    await new Promise((r) => setTimeout(r, 16));
    const evals = evaluateColumns(game.board, game.currentPlayer, params.budgetMs);
    return { evals: evals.map((v) => ({ col: v.col, score: v.score })), exact: evals.exact };
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
          <h1 class="cf-title">Connect Four</h1>
        </header>

        <section class="cf-setup" aria-label="Game setup">
          <div class="cf-field">
            <span class="cf-label">Difficulty</span>
            <div class="cf-segmented" data-role="difficulty">
              ${DIFFICULTY_LABELS.map(([val, label]) =>
                `<button type="button" class="cf-seg" data-value="${val}">${label}</button>`).join('')}
            </div>
          </div>

          <div class="cf-field">
            <span class="cf-label">Who goes first</span>
            <div class="cf-segmented" data-role="first">
              <button type="button" class="cf-seg" data-value="you">You</button>
              <button type="button" class="cf-seg" data-value="ai">Computer</button>
            </div>
          </div>

          <button type="button" class="cf-btn cf-btn-primary" data-role="start">Start game</button>
        </section>

        <section class="cf-game" hidden>
          <div class="cf-statusbar">
            <span class="cf-turn-dot" data-role="dot"></span>
            <span class="cf-status" data-role="status" role="status" aria-live="polite">Your move</span>
            <span class="cf-bar-actions">
              <button type="button" class="cf-btn cf-btn-ghost" data-role="undo" title="Take back your last move">↩ Undo</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu">Menu</button>
            </span>
          </div>

          <div class="cf-subbar">
            <span class="cf-legend">
              <span class="cf-legend-item"><span class="cf-chip p1"></span>You</span>
              <span class="cf-legend-item"><span class="cf-chip p2"></span>Computer</span>
            </span>
            <span class="cf-hint" data-role="hint">Tap a column to drop ↓</span>
          </div>

          <div class="cf-hints" data-role="hints" hidden>
            <div class="cf-eval-row" data-role="eval-row"></div>
            <p class="cf-eval-caption" data-role="eval-caption"></p>
          </div>

          <div class="cf-board-wrap">
            <div class="cf-board" data-role="board" role="grid" aria-label="Connect Four board — press number keys 1 to 7 to drop in a column"></div>
          </div>

          <div class="cf-result" data-role="result" hidden>
            <p class="cf-result-msg" data-role="result-msg"></p>
            <div class="cf-result-actions">
              <button type="button" class="cf-btn cf-btn-primary" data-role="rematch">Rematch</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="change">Change settings</button>
            </div>
          </div>
        </section>

        <div class="cf-menu" data-role="menu-panel" hidden>
          <div class="cf-menu-scrim" data-role="menu-scrim"></div>
          <div class="cf-menu-card" role="dialog" aria-modal="true" aria-label="Game menu">
            <h2 class="cf-menu-title">Menu</h2>
            <label class="cf-switch">
              <input type="checkbox" data-role="hint-toggle">
              <span class="cf-switch-track"><span class="cf-switch-thumb"></span></span>
              <span class="cf-switch-text">Show best moves</span>
            </label>
            <p class="cf-menu-note">Rates each column and highlights your best move.</p>
            <div class="cf-menu-actions">
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-undo">↩ Undo your last move</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-restart">Restart game</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="menu-quit">Quit to setup</button>
            </div>
            <button type="button" class="cf-btn cf-btn-primary" data-role="menu-resume">Resume game</button>
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
      result: q('[data-role="result"]'),
      resultMsg: q('[data-role="result-msg"]'),
      difficulty: q('[data-role="difficulty"]'),
      first: q('[data-role="first"]'),
      menuPanel: q('[data-role="menu-panel"]'),
      hintToggle: q('[data-role="hint-toggle"]'),
    };

    // Setup-screen wiring.
    this.el.difficulty.addEventListener('click', (e) => {
      const btn = e.target.closest('.cf-seg'); if (!btn) return;
      this.difficulty = btn.dataset.value;
      this.syncSegmented(this.el.difficulty, this.difficulty);
    });
    this.el.first.addEventListener('click', (e) => {
      const btn = e.target.closest('.cf-seg'); if (!btn) return;
      this.humanFirst = btn.dataset.value === 'you';
      this.syncSegmented(this.el.first, this.humanFirst ? 'you' : 'ai');
    });
    root.querySelector('[data-role="start"]').addEventListener('click', () => this.startGame());
    root.querySelector('[data-role="rematch"]').addEventListener('click', () => this.startGame());
    root.querySelector('[data-role="change"]').addEventListener('click', () => this.showSetup());

    // In-game controls.
    this.el.undo.addEventListener('click', () => this.undo());
    root.querySelector('[data-role="menu"]').addEventListener('click', () => this.openMenu());

    // Menu panel. Restart/Quit abandon the game, so they confirm-on-second-tap
    // while a game is in progress (no friction once it's already over).
    const restartBtn = root.querySelector('[data-role="menu-restart"]');
    const quitBtn = root.querySelector('[data-role="menu-quit"]');
    root.querySelector('[data-role="menu-resume"]').addEventListener('click', () => this.closeMenu());
    root.querySelector('[data-role="menu-scrim"]').addEventListener('click', () => this.closeMenu());
    root.querySelector('[data-role="menu-undo"]').addEventListener('click', () => { this.closeMenu(); this.undo(); });
    restartBtn.addEventListener('click', () => this.confirmDestructive(restartBtn, () => { this.closeMenu(); this.startGame(); }));
    quitBtn.addEventListener('click', () => this.confirmDestructive(quitBtn, () => { this.closeMenu(); this.showSetup(); }));
    this.el.hintToggle.addEventListener('change', () => this.onHintToggle());

    // Board interaction (delegated).
    this.el.board.addEventListener('click', this._onBoardClick);
    this.el.board.addEventListener('pointermove', this._onBoardMove);
    this.el.board.addEventListener('pointerleave', this._onBoardLeave);
    document.addEventListener('keydown', this._onKeyDown);

    this.syncSegmented(this.el.difficulty, this.difficulty);
    this.syncSegmented(this.el.first, this.humanFirst ? 'you' : 'ai');
    this.buildBoardCells();
    this.showSetup();
  }

  syncSegmented(group, value) {
    group.querySelectorAll('.cf-seg').forEach((b) =>
      b.classList.toggle('is-selected', b.dataset.value === value));
  }

  buildBoardCells() {
    const cells = [];
    // Visual rows top (engine row ROWS-1) to bottom (engine row 0).
    for (let vr = 0; vr < ROWS; vr++) {
      const r = ROWS - 1 - vr;
      for (let c = 0; c < COLS; c++) {
        cells.push(
          `<div class="cf-cell" data-col="${c}" data-row="${r}" role="gridcell"` +
          ` aria-label="Column ${c + 1}, row ${r + 1}, empty" style="--cf-vr:${vr}">` +
          `<div class="cf-piece"></div></div>`);
      }
    }
    this.el.board.innerHTML = cells.join('');
  }

  /** Update a cell's accessible label to reflect its occupant. */
  labelCell(col, row, who) {
    const cell = this.el.board.querySelector(`.cf-cell[data-col="${col}"][data-row="${row}"]`);
    if (!cell) return;
    const occ = who === this.humanPlayer ? 'your disc' : who >= 0 ? 'computer disc' : 'empty';
    cell.setAttribute('aria-label', `Column ${col + 1}, row ${row + 1}, ${occ}`);
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
  }

  startGame() {
    const firstPlayer = this.humanFirst ? this.humanPlayer : this.aiPlayer;
    this.game = new Game(firstPlayer);
    this.busy = false;
    this.hoverCol = -1;
    this.humanHasMoved = false;

    // Reset board visuals.
    this.buildBoardCells();
    this.el.result.hidden = true;
    this.hideHints();
    this.clearEvalRow();
    this.closeMenu();

    this.el.setup.hidden = true;
    this.el.header.hidden = true;  // reclaim vertical space for the board
    this.el.game.hidden = false;

    this.updateStatus();
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
    btn.textContent = 'Tap again to confirm';
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

  onHintToggle() {
    this.showBestMoves = this.el.hintToggle.checked;
    if (this.showBestMoves) { this.clearEvalRow(); this.refreshHints(); }
    else { this.hideHints(); this.clearEvalRow(); }
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
    this.hideHints(); // about to be the computer's turn
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
    this.hideHints();
    this.updateStatus();
    let col;
    try {
      col = await this.requestAIMove();
    } catch {
      // Last-resort inline compute if the worker path threw.
      col = await this.computeInline({
        history: this.game.history.slice(),
        firstPlayer: this.game.firstPlayer,
        difficulty: this.difficulty,
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
    if (this.busy && turn === this.aiPlayer) text = 'Computer is thinking…';
    else if (turn === this.humanPlayer) text = 'Your move';
    else text = "Computer's move";
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
    this.busy = false;
    this.clearHover();
    this.hideHints();
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
      msg = youWon ? 'You win! 🎉' : 'Computer wins';
      dot = this.game.winner === PLAYER_ONE ? 'p1' : 'p2';
      this.el.result.dataset.outcome = youWon ? 'win' : 'loss';
    } else if (this.game.status === DRAW) {
      msg = "It's a draw";
      this.el.result.dataset.outcome = 'draw';
    }

    // Show the outcome in the (always-visible) status bar — so you see who won
    // without scrolling, and the top isn't an orphaned dot — and color the dot
    // to the winner. The board (with its highlighted line) stays fully visible.
    this.el.dot.classList.toggle('p1', dot === 'p1');
    this.el.dot.classList.toggle('p2', dot === 'p2');
    this.el.status.textContent = msg;
    this.el.resultMsg.textContent = msg;
    this.el.result.hidden = false;
    this.updateUndoState(); // can still take back the final move
    // Bring the Rematch / Change-settings actions into view on tall layouts.
    this.el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // --- Undo -----------------------------------------------------------------

  /** True if there's a human move to take back (and we're not mid-think). */
  canUndo() {
    return !!this.game && !this.busy && this.humanHasMoved;
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

  hideHints() {
    this.hintReqId++; // invalidate any in-flight analysis
    if (this.el && this.el.hints) {
      this.el.hints.hidden = true;
      this.el.hints.classList.remove('is-stale');
    }
  }

  clearEvalRow() {
    if (!this.el) return;
    this.el.evalRow.innerHTML = '';
    this.el.evalCaption.textContent = '';
  }

  /** Request and display per-column evaluations (only on the human's turn). */
  refreshHints() {
    if (!this.showBestMoves || !this.game || this.game.isOver() || this.busy
      || this.game.currentPlayer !== this.humanPlayer) {
      this.hideHints();
      return;
    }
    const reqId = ++this.hintReqId;
    this.el.hints.hidden = false;
    // Keep the previous chips visible but dimmed while recomputing (no flicker);
    // only show placeholders the very first time, when there's nothing to dim.
    if (this.el.evalRow.childElementCount === 0) this.renderEvalRow(null);
    else this.el.hints.classList.add('is-stale');
    this.requestEval().then((data) => {
      if (reqId !== this.hintReqId || !this.showBestMoves) return; // stale or toggled off
      this.el.hints.classList.remove('is-stale');
      this.renderEvalRow(data);
    }).catch(() => { this.el.hints.classList.remove('is-stale'); });
  }

  renderEvalRow(data) {
    const row = this.el.evalRow;
    row.innerHTML = '';
    const byCol = new Map();
    let best = -Infinity;
    if (data) for (const e of data.evals) { byCol.set(e.col, e.score); best = Math.max(best, e.score); }

    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cf-eval';
      if (!data) { cell.classList.add('is-loading'); cell.textContent = '·'; }
      else if (byCol.has(c)) {
        const s = byCol.get(c);
        if (s === best) cell.classList.add('is-best'); // unified recommendation accent
        if (data.exact) {
          cell.textContent = s > 0 ? `+${s}` : `${s}`;
          cell.classList.add(s > 0 ? 'is-win' : s < 0 ? 'is-loss' : 'is-draw');
        } else {
          // Estimate mode: a clear ★ on the pick, a faint dot elsewhere (not blank,
          // which read as "failed to load").
          cell.textContent = s === best ? '★' : '·';
          cell.classList.add(s === best ? 'is-pick' : 'is-faint');
        }
      } else {
        cell.classList.add('is-empty'); // full column
      }
      row.appendChild(cell);
    }

    this.el.evalCaption.textContent = !data ? 'Analyzing…'
      : data.exact
        ? 'Perfect: + wins, − loses, bigger = sooner. Your best move is ringed.'
        : 'Estimate (exact once the board fills in) — the engine’s pick is ★.';
  }

  // --- Teardown -------------------------------------------------------------

  destroy() {
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

export default { init, destroy };
