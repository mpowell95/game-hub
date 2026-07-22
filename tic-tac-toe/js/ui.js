// ui.js - Tic Tac Toe UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen follows Escoba's accordion pattern (one settings row open at a
// time, toggle-row/is-open) per Matt's explicit ranking of setup screens in
// this repo (2026-07-21: Escoba is the model; Filler is an acceptable
// fallback; Mancala and Connect Four are not to be copied). CSS scoping
// discipline follows Mancala (every rule descendant-scoped under .ttt-root).
// The settings KEY follows Filler's convention (gamehub.<game>.v1) -- key and
// screen are separate axes, see root CLAUDE.md.
//
// game.js/ai.js stay pure and synchronous (no DOM, no async agent interface):
// unlike Escoba/Chinchon, a tic-tac-toe move has no multi-step resolution to
// pace, so this mirrors Filler/Mancala's simpler direct-call shape instead.

import { newGame, legalMoves, applyMove, X, O } from './game.js';
import { chooseMove } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordTicTacToe, loadStats } from '../../js/game-stats.js';

const SETTINGS_KEY = 'gamehub.tictactoe.v1';
const AI_THINK_MS = 450;
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Beginner/Intermediate/Pro) -- do not invent
// new tier names here.
const DIFFICULTIES = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['pro', 'Pro']];
const DIFF_LABEL = Object.fromEntries(DIFFICULTIES);
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/tic-tac-toe.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/tic-tac-toe.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

class TicTacToeUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.view = 'setup';
    this._setupExpanded = null;
    this.state = null;
    this.busy = false;
    this.humanMark = X;
    this.aiMark = O;
    this.aiTimer = null;
    this._setup = this._loadSetup();

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this.root) this.root.removeEventListener('click', this._onClick);
    this.container.innerHTML = '';
    this.state = null;
  }

  // A Tic Tac Toe match is seconds long, so autosave/resume would be
  // over-engineering (see root CLAUDE.md's "two legitimate meanings" note on
  // isInProgress()). This uses the literal, no-mid-game-resume meaning:
  // true only while a match is actually in progress right now.
  isInProgress() {
    return this.view === 'game' && !!this.state && !this.state.over;
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(SETTINGS_KEY, {});
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const profileDiff = (opp && SKILL_TO_DIFF[opp.skill]) || null;
    return {
      variant: saved.variant === 'ultimate' ? 'ultimate' : 'classic',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      humanFirst: saved.humanFirst !== false,
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { variant: s.variant, difficulty: s.difficulty, humanFirst: s.humanFirst });
  }

  /** Identity is read fresh from the profile every render (never persisted),
   *  so profile edits always show -- same precedence rule as every other
   *  game module: last-used settings > shared profile > built-in default. */
  _identity() {
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    return {
      humanName: (profile && profile.name) || 'You',
      humanEmoji: (profile && profile.emoji) || '🙂',
      oppName: (opp && opp.name) || 'Computer',
      oppEmoji: (opp && opp.emoji) || '🤖',
    };
  }

  _statsLine() {
    let rec = null;
    try { rec = (loadStats().games || {}).tictactoe; } catch { rec = null; }
    const total = rec && rec.total ? rec.total.played | 0 : 0;
    if (!total) return '';
    const tt = (rec && rec.tt) || {};
    const c = tt.classic || {}, u = tt.ultimate || {};
    return `${total} played · Classic ${c.won | 0}-${c.lost | 0}-${c.tied | 0} · Ultimate ${u.won | 0}-${u.lost | 0}-${u.tied | 0}`;
  }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="ttt-root"><div class="ttt-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.ttt-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    this.renderSetup();
  }

  // --- setup screen -----------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="ttt-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="ttt-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${esc(lbl)}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="ttt-row ${open ? 'is-open' : ''}">
      <button type="button" class="ttt-row-head" data-action="toggle-row" data-row="${key}">
        <span class="ttt-row-label">${label}</span><span class="ttt-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="ttt-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _variantContent() {
    const s = this._setup;
    return this._seg('set-variant', s.variant, [['classic', 'Classic'], ['ultimate', 'Ultimate']]) +
      `<p class="ttt-hint">${s.variant === 'ultimate'
        ? 'Nine 3x3 boards in one. The cell you play picks which board your opponent plays next.'
        : 'The original: one 3x3 board, three in a row wins.'}</p>`;
  }

  _diffContent() {
    const s = this._setup;
    const hint = s.difficulty === 'pro'
      ? (s.variant === 'ultimate' ? 'Deep search under a time budget. Very tough to beat.' : 'Perfect play: the best you can do is draw.')
      : s.difficulty === 'intermediate' ? 'Blocks your wins and thinks a little ahead.' : 'Mostly plays at random.';
    return this._seg('set-diff', s.difficulty, DIFFICULTIES) + `<p class="ttt-hint">${hint}</p>`;
  }

  _firstContent() {
    const id = this._identity();
    const sel = this._setup.humanFirst ? 'you' : 'ai';
    return this._seg('set-first', sel, [['you', 'You'], ['ai', esc(id.oppName)]]);
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    this.view = 'setup';
    this.state = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    this.shell.innerHTML = `
      <h1 class="ttt-title">Tic Tac Toe</h1>
      <p class="ttt-sub">Classic 3x3, or Ultimate: nine boards in one.</p>
      ${stats ? `<p class="ttt-stats">${esc(stats)}</p>` : ''}
      <div class="ttt-vscard">
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.humanEmoji)}</span><span class="ttt-vsname">${esc(id.humanName)}</span></div>
        <span class="ttt-vslabel">vs</span>
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.oppEmoji)}</span><span class="ttt-vsname">${esc(id.oppName)}</span></div>
      </div>
      <div class="ttt-summary">
        ${this._row('variant', 'Variant', s.variant === 'ultimate' ? 'Ultimate' : 'Classic', this._variantContent())}
        ${this._row('difficulty', 'Difficulty', DIFF_LABEL[s.difficulty], this._diffContent())}
        ${this._row('first', 'First move', s.humanFirst ? 'You' : id.oppName, this._firstContent())}
      </div>
      <button type="button" class="ttt-btn ttt-btn-primary" data-action="start">Start game</button>
      <button type="button" class="ttt-link" data-action="help">How to play</button>`;
  }

  // --- game screen --------------------------------------------------------

  startGame() {
    this._saveSetup();
    this.humanMark = this._setup.humanFirst ? X : O;
    this.aiMark = this.humanMark === X ? O : X;
    this.state = newGame(this._setup.variant, X);
    this.view = 'game';
    this._afterStateChange();
  }

  /** Single funnel after every state change (initial deal, human move, AI
   *  move): render, resolve a finished match, or schedule the AI's turn. */
  _afterStateChange() {
    if (this._dead) return;
    if (this.state.over) {
      this.busy = false;
      this.renderGame();
      this.finish();
      return;
    }
    if (this.state.turn === this.aiMark) {
      this.busy = true;
      this.renderGame();
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || this.state.over) return;
        const move = chooseMove(this.state, this._setup.difficulty);
        applyMove(this.state, move);
        this._afterStateChange();
      }, AI_THINK_MS);
    } else {
      this.busy = false;
      this.renderGame();
    }
  }

  humanMove(move) {
    if (this.busy || !this.state || this.state.over || this.state.turn !== this.humanMark) return;
    const legal = legalMoves(this.state);
    const isLegal = this.state.variant === 'ultimate'
      ? legal.some((m) => m.board === move.board && m.cell === move.cell)
      : legal.includes(move);
    if (!isLegal) return;
    applyMove(this.state, move);
    this._afterStateChange();
  }

  _statusText(s, id) {
    if (s.over) return s.isDraw ? 'Draw' : (s.winner === this.humanMark ? 'You win!' : `${id.oppName} wins`);
    if (this.busy) return `${id.oppName} is thinking...`;
    if (s.turn === this.humanMark) {
      if (s.variant === 'ultimate') {
        return s.forcedBoard === null ? 'Your turn: play in any highlighted board' : `Your turn: play in board ${s.forcedBoard + 1}`;
      }
      return 'Your turn';
    }
    return `${id.oppName}'s turn`;
  }

  _classicBoardHtml(s) {
    const legal = s.over ? [] : legalMoves(s);
    const legalSet = new Set(legal);
    const winSet = new Set(s.winLine || []);
    const canClickNow = !s.over && !this.busy && s.turn === this.humanMark;
    const cellsHtml = s.board.map((mark, i) => {
      const r = Math.floor(i / 3) + 1, c = (i % 3) + 1;
      const live = canClickNow && legalSet.has(i);
      const name = mark ? `Row ${r}, column ${c}, occupied by ${mark}` : `Row ${r}, column ${c}, empty`;
      return `<button type="button" class="ttt-cell ${live ? 'is-live' : ''} ${winSet.has(i) ? 'is-win' : ''}"
        data-action="cell" data-cell="${i}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
        aria-label="${name}">${mark || ''}</button>`;
    }).join('');
    return `<div class="ttt-board" role="grid" aria-label="Tic Tac Toe board">${cellsHtml}</div>`;
  }

  _ultimateBoardHtml(s) {
    const legal = s.over ? [] : legalMoves(s);
    const legalSet = new Set(legal.map((m) => `${m.board}:${m.cell}`));
    const playableBoards = new Set(legal.map((m) => m.board));
    const winBoards = new Set(!s.over || s.isDraw ? [] : s.winLine);
    const canClickNow = !s.over && !this.busy && s.turn === this.humanMark;

    const boardsHtml = s.boards.map((cells, b) => {
      const owner = s.meta[b];
      const resolved = owner !== null;
      let cls = '';
      if (s.over) { if (winBoards.has(b)) cls = 'is-win-board'; }
      else if (resolved) cls = 'is-resolved';
      else cls = playableBoards.has(b) ? 'is-forced' : 'is-dim';

      const overlayGlyph = owner === 'D' ? '–' : (owner || '');   // en dash: a drawn board's glyph, not em-dash punctuation
      const label = `Board ${b + 1}${resolved ? (owner === 'D' ? ', drawn' : `, won by ${owner}`) : ''}`;
      const cellsHtml = cells.map((mark, c) => {
        const r = Math.floor(c / 3) + 1, col = (c % 3) + 1;
        const live = canClickNow && legalSet.has(`${b}:${c}`);
        const name = mark
          ? `Board ${b + 1}, row ${r}, column ${col}, occupied by ${mark}`
          : `Board ${b + 1}, row ${r}, column ${col}, empty`;
        return `<button type="button" class="ttt-scell ${live ? 'is-live' : ''}"
          data-action="scell" data-board="${b}" data-cell="${c}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
          aria-label="${name}">${mark || ''}</button>`;
      }).join('');
      return `<div class="ttt-sboard ${cls}" data-owner="${owner || ''}" aria-label="${label}">
        ${cellsHtml}<div class="ttt-soverlay" aria-hidden="true">${overlayGlyph}</div>
      </div>`;
    }).join('');

    return `<div class="ttt-uboard" role="grid" aria-label="Ultimate Tic Tac Toe board">${boardsHtml}</div>`;
  }

  renderGame() {
    if (this._dead) return;
    const id = this._identity();
    const s = this.state;
    const boardHtml = s.variant === 'ultimate' ? this._ultimateBoardHtml(s) : this._classicBoardHtml(s);
    this.shell.innerHTML = `
      <div class="ttt-topbar">
        <div class="ttt-idchip ${!s.over && s.turn === this.humanMark ? 'is-turn' : ''}" data-mark="${this.humanMark}">
          <span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span><span class="ttt-mark">${this.humanMark}</span>
        </div>
        <span class="ttt-vsdash">vs</span>
        <div class="ttt-idchip ${!s.over && s.turn === this.aiMark ? 'is-turn' : ''}" data-mark="${this.aiMark}">
          <span class="ttt-mark">${this.aiMark}</span><span>${esc(id.oppName)}</span><span>${esc(id.oppEmoji)}</span>
        </div>
      </div>
      <p class="ttt-status" aria-live="polite">${esc(this._statusText(s, id))}</p>
      ${boardHtml}
      <div class="ttt-actions">
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="help">How to play</button>
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="change-settings">New game</button>
      </div>`;
  }

  finish() {
    const s = this.state;
    const won = s.isDraw ? null : (s.winner === this.humanMark);
    try { recordTicTacToe(s.variant, this._setup.difficulty, won); } catch { /* never block the result */ }

    const id = this._identity();
    const title = s.isDraw ? 'Draw' : won ? 'You win!' : `${id.oppName} wins`;
    const emoji = s.isDraw ? '🤝' : won ? '🏆' : id.oppEmoji;
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="ttt-scrim"></div>
      <div class="ttt-card" role="dialog" aria-modal="true" aria-label="Game over">
        <span class="ttt-card-emoji">${esc(emoji)}</span>
        <h3 class="ttt-card-title">${esc(title)}</h3>
        <p class="ttt-card-sub">${s.variant === 'ultimate' ? 'Ultimate' : 'Classic'} &middot; ${DIFF_LABEL[this._setup.difficulty]}</p>
        <div class="ttt-card-actions">
          <button type="button" class="ttt-btn ttt-btn-primary" data-action="rematch">Play again</button>
          <button type="button" class="ttt-btn ttt-btn-ghost" data-action="change-settings">Change settings</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="ttt-scrim" data-action="close-overlay"></div>
      <div class="ttt-card ttt-help" role="dialog" aria-modal="true" aria-label="How to play">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <h3 class="ttt-card-title">How to play</h3>
        <section>
          <h4>Classic</h4>
          <p>Take turns placing X and O. Three in a row, across, down, or diagonal, wins. A full board with no line is a draw.</p>
        </section>
        <section>
          <h4>Ultimate</h4>
          <p>Nine Classic boards arranged in a 3x3 grid. Win a small board to claim its cell on the big board; win three small boards in a row to win the match.</p>
          <p>The cell you play picks which small board your opponent must play in next.</p>
          <ul>
            <li>Sent to a board that's already won or full? Play in any open board.</li>
            <li>A small board that fills with no winner is dead: it counts for neither side and can never be played in again.</li>
            <li>Every small board resolved with no line on the big board is a draw.</li>
          </ul>
        </section>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.ttt-overlay').forEach((el) => el.remove());
  }

  // --- events -------------------------------------------------------------

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.root.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'toggle-row') {
      const row = btn.dataset.row;
      this._setupExpanded = this._setupExpanded === row ? null : row;
      this.renderSetup();
    } else if (action === 'set-variant') {
      this._setup.variant = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'set-diff') {
      this._setup.difficulty = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'set-first') {
      this._setup.humanFirst = btn.dataset.v === 'you';
      this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'cell') {
      this.humanMove(Number(btn.dataset.cell));
    } else if (action === 'scell') {
      this.humanMove({ board: Number(btn.dataset.board), cell: Number(btn.dataset.cell) });
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'change-settings') {
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
    }
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new TicTacToeUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
