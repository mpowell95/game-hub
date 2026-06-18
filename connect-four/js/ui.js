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
    this.worker = null;
    this.pending = null;      // { resolve, reject } for an in-flight worker request
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
        const p = this.pending;
        if (!p || e.data.id !== p.id) return; // stale / mismatched reply
        this.pending = null;
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.col);
      };
      this.worker.onerror = () => {
        const p = this.pending;
        this.pending = null;
        this.disableWorker();
        if (p) p.reject(new Error('worker error'));
      };
    } catch {
      this.worker = null; // workers unavailable -> main-thread fallback
    }
  }

  disableWorker() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }

  /** Resolve to the AI's chosen column, via worker if possible, else inline. */
  async requestAIMove() {
    const params = {
      id: ++this.requestId,
      history: this.game.history.slice(),
      firstPlayer: this.game.firstPlayer,
      difficulty: this.difficulty,
      budgetMs: EXPERT_BUDGET_MS,
    };
    if (this.worker) {
      try {
        return await new Promise((resolve, reject) => {
          this.pending = { id: params.id, resolve, reject };
          this.worker.postMessage(params);
        });
      } catch {
        this.disableWorker(); // fall through to inline compute
      }
    }
    return this.computeInline(params);
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
            <span class="cf-status" data-role="status">Your move</span>
            <button type="button" class="cf-btn cf-btn-ghost" data-role="menu">Menu</button>
          </div>

          <div class="cf-subbar">
            <span class="cf-legend">
              <span class="cf-legend-item"><span class="cf-chip p1"></span>You</span>
              <span class="cf-legend-item"><span class="cf-chip p2"></span>Computer</span>
            </span>
            <span class="cf-hint" data-role="hint">Tap a column to drop ↓</span>
          </div>

          <div class="cf-board-wrap">
            <div class="cf-board" data-role="board" role="grid" aria-label="Connect Four board"></div>
          </div>

          <div class="cf-result" data-role="result" hidden>
            <p class="cf-result-msg" data-role="result-msg"></p>
            <div class="cf-result-actions">
              <button type="button" class="cf-btn cf-btn-primary" data-role="rematch">Rematch</button>
              <button type="button" class="cf-btn cf-btn-ghost" data-role="change">Change settings</button>
            </div>
          </div>
        </section>
      </div>`;

    const root = this.container.querySelector('.cf-root');
    this.el = {
      header: root.querySelector('[data-role="header"]'),
      setup: root.querySelector('.cf-setup'),
      game: root.querySelector('.cf-game'),
      board: root.querySelector('[data-role="board"]'),
      status: root.querySelector('[data-role="status"]'),
      dot: root.querySelector('[data-role="dot"]'),
      hint: root.querySelector('[data-role="hint"]'),
      result: root.querySelector('[data-role="result"]'),
      resultMsg: root.querySelector('[data-role="result-msg"]'),
      difficulty: root.querySelector('[data-role="difficulty"]'),
      first: root.querySelector('[data-role="first"]'),
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
    root.querySelector('[data-role="menu"]').addEventListener('click', () => this.showSetup());
    root.querySelector('[data-role="rematch"]').addEventListener('click', () => this.startGame());
    root.querySelector('[data-role="change"]').addEventListener('click', () => this.showSetup());

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
          `<div class="cf-cell" data-col="${c}" data-row="${r}" style="--cf-vr:${vr}">` +
          `<div class="cf-piece"></div></div>`);
      }
    }
    this.el.board.innerHTML = cells.join('');
  }

  // --- Screen transitions ---------------------------------------------------

  showSetup() {
    this.busy = false;
    this.clearHover();
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

    this.el.setup.hidden = true;
    this.el.header.hidden = true;  // reclaim vertical space for the board
    this.el.game.hidden = false;

    this.updateStatus();
    if (this.game.currentPlayer === this.aiPlayer) this.aiTurn();
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
    if (e.key >= '1' && e.key <= '7') {
      if (this.busy || !this.isHumanTurn()) return;
      this.humanMove(+e.key - 1);
    }
  }

  async humanMove(col) {
    if (!this.game.board.canPlay(col)) return;
    this.clearHover();
    await this.applyMove(col);
    if (!this.game.isOver() && this.game.currentPlayer === this.aiPlayer) {
      this.aiTurn();
    }
  }

  async aiTurn() {
    this.busy = true;
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
    if (!this.game.isOver()) this.updateStatus();
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
    this.updateHint();
  }

  /** Show the "tap a column" hint only while the human hasn't moved yet. */
  updateHint() {
    const show = this.game && !this.game.isOver() && !this.humanHasMoved
      && this.game.currentPlayer === this.humanPlayer;
    this.el.hint.hidden = !show;
  }

  endGame() {
    this.busy = false;
    this.clearHover();
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

    // Top dot reflects the winner (not a flat grey); the result message lives in
    // the banner below the board so the winning line stays visible.
    this.el.dot.classList.toggle('p1', dot === 'p1');
    this.el.dot.classList.toggle('p2', dot === 'p2');
    this.el.status.textContent = '';
    this.el.resultMsg.textContent = msg;
    this.el.result.hidden = false;
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
    this.pending = null;
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
