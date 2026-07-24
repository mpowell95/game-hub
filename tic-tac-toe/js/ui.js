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
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.tictactoe.v1';
// The in-progress-game autosave (2026-07-23, batch 9, HANDOFF-FB-RESUME.md).
// Separate from SETTINGS_KEY -- this holds a live match, not preferences.
// One save slot, either variant; cleared the moment a match ends or is
// explicitly abandoned (Restart/New game). Pattern copied from
// mancala/js/ui.js's saveGame/loadGame/clearGame -- do not invent a new one.
const SAVE_KEY = 'gamehub.tictactoe.save.v1';
const AI_THINK_MS = 450;
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Beginner/Intermediate/Pro) -- do not invent
// new tier names here. Values (first element) stay canonical; labelKey resolves via t().
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
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

/** Persist the in-progress match (either variant) so leaving -- hub back, a
 *  reload, or closing the PWA -- never loses it. Called from the single
 *  post-move funnel (_afterStateChange) after every human and AI move, so it
 *  always holds the latest settled position. Clears itself the moment the
 *  match ends (mirrors mancala/js/ui.js's saveGame). */
function saveGame(ui) {
  try {
    if (!ui.state || ui.state.over || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      variant: ui.state.variant,
      difficulty: ui._setup.difficulty,
      humanMark: ui.humanMark,
      aiMark: ui.aiMark,
      state: ui.state,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved match, or null. Validates hard: a corrupt or
 *  non-standard shape is treated as "no saved game" rather than crashing the
 *  module on mount. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (raw.variant !== 'classic' && raw.variant !== 'ultimate') return null;
    if (raw.humanMark !== X && raw.humanMark !== O) return null;
    if (raw.aiMark !== X && raw.aiMark !== O) return null;
    if (!DIFFICULTIES.some(([k]) => k === raw.difficulty)) return null;
    const s = raw.state;
    if (!s || typeof s !== 'object' || s.variant !== raw.variant || s.over) return null;
    if (raw.variant === 'classic') {
      if (!Array.isArray(s.board) || s.board.length !== 9) return null;
    } else {
      if (!Array.isArray(s.boards) || s.boards.length !== 9 || s.boards.some((b) => !Array.isArray(b) || b.length !== 9)) return null;
      if (!Array.isArray(s.meta) || s.meta.length !== 9) return null;
    }
    return { variant: raw.variant, difficulty: raw.difficulty, humanMark: raw.humanMark, aiMark: raw.aiMark, state: s };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

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
    this._confirmTimer = null;
    this._setup = this._loadSetup();

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    if (this.root) this.root.removeEventListener('click', this._onClick);
    this.container.innerHTML = '';
    this.state = null;
  }

  // Autosave/resume built in (2026-07-23, batch 9, HANDOFF-FB-RESUME.md):
  // every move checkpoints the match to SAVE_KEY and the next mount restores
  // it silently, straight onto the board. Per root CLAUDE.md's "two
  // legitimate meanings" note on isInProgress(), this game now uses the
  // resumable meaning -- leaving costs nothing, so the hub's "leave game?"
  // confirm would be a lie and this always returns false, even mid-match.
  isInProgress() {
    return false;
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(SETTINGS_KEY, {});
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const profileDiff = (opp && SKILL_TO_DIFF[opp.skill]) || null;
    // firstMode: 'you' | 'opponent' | 'alternate'. New field, additive to the
    // frozen gamehub.tictactoe.v1 shape. Precedence: an explicit new-shape
    // choice wins; else a pre-existing device's old `humanFirst` boolean
    // (present in the store from before this change) is honored as-is (it
    // is the closest available proxy for "an explicit You/Opponent choice
    // from before this change" -- the old writer never distinguished a
    // user's deliberate pick from the untouched default, so any prior save
    // is treated as that device's standing choice); a device with NO saved
    // settings at all gets the new default, Alternate.
    let firstMode = 'you';
    if (saved.firstMode === 'you' || saved.firstMode === 'opponent' || saved.firstMode === 'alternate') {
      firstMode = saved.firstMode;
    } else if (Object.prototype.hasOwnProperty.call(saved, 'humanFirst')) {
      firstMode = saved.humanFirst !== false ? 'you' : 'opponent';
    } else {
      firstMode = 'alternate';
    }
    return {
      variant: saved.variant === 'classic' ? 'classic' : 'ultimate',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      firstMode,
      // Who opens the NEXT alternate-mode game; flipped and banked in
      // startGame() every time a new game begins (including Restart/rematch).
      nextStarter: saved.nextStarter === 'you' || saved.nextStarter === 'opponent' ? saved.nextStarter : 'you',
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { variant: s.variant, difficulty: s.difficulty, firstMode: s.firstMode, nextStarter: s.nextStarter });
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
    return t('stats_line', {
      total, cw: c.won | 0, cl: c.lost | 0, ct: c.tied | 0,
      uw: u.won | 0, ul: u.lost | 0, ut: u.tied | 0,
    });
  }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="ttt-root"><div class="ttt-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.ttt-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    // Come back to exactly where you left off: an unfinished match (from the
    // hub back button, a reload, or closing the PWA) resumes straight onto
    // the board, no "resume?" dialog. Otherwise start at setup.
    const saved = loadGame();
    if (saved) this.resumeGame(saved); else this.renderSetup();
  }

  // --- setup screen -----------------------------------------------------------

  // `lbl` is trusted HTML, not plain text: callers pass either a translated
  // (trusted) string or already-`esc()`-ed user content (e.g. the opponent
  // name in _firstContent, or a diffShapeSVG() shape prefix) -- _seg must
  // not re-escape it, or a caller's own esc() call turns into visible
  // "&lt;svg&gt;" markup instead of rendering.
  _seg(action, value, opts) {
    return `<div class="ttt-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="ttt-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${lbl}</button>`).join('')}</div>`;
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
    return this._seg('set-variant', s.variant, [['classic', t('variant_classic')], ['ultimate', t('variant_ultimate')]]) +
      `<p class="ttt-hint">${s.variant === 'ultimate' ? t('hint_variant_ultimate') : t('hint_variant_classic')}</p>`;
  }

  _diffContent() {
    const s = this._setup;
    return this._seg('set-diff', s.difficulty, DIFFICULTIES.map(([v, k]) => [v, diffShapeSVG(tierOf(v)) + esc(t(k))]));
  }

  _firstContent() {
    const id = this._identity();
    const sel = this._setup.firstMode;
    return this._seg('set-first', sel, [['you', t('you')], ['opponent', esc(id.oppName)], ['alternate', t('first_alternate')]]);
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    // Leaving an unfinished match via "New game" is an explicit abandon
    // (same bucket as Restart), so the autosave clears here too -- otherwise
    // stale progress would ambush the player on the next mount.
    if (this.view === 'game' && this.state && !this.state.over) clearGame();
    this.view = 'setup';
    this.state = null;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    this.shell.innerHTML = `
      <h1 class="ttt-title">${t('title')}</h1>
      <p class="ttt-sub">${t('tagline')}</p>
      ${stats ? `<p class="ttt-stats">${esc(stats)}</p>` : ''}
      <div class="ttt-vscard">
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.humanEmoji)}</span><span class="ttt-vsname">${esc(id.humanName)}</span></div>
        <span class="ttt-vslabel">${t('vs')}</span>
        <div class="ttt-vsside"><span class="ttt-vsemoji">${esc(id.oppEmoji)}</span><span class="ttt-vsname">${esc(id.oppName)}</span></div>
      </div>
      <div class="ttt-summary">
        ${this._row('variant', t('row_variant'), s.variant === 'ultimate' ? t('variant_ultimate') : t('variant_classic'), this._variantContent())}
        ${this._row('difficulty', t('row_difficulty'), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
        ${this._row('first', t('row_first'),
          s.firstMode === 'you' ? t('you') : s.firstMode === 'opponent' ? id.oppName : t('first_alternate'),
          this._firstContent())}
      </div>
      <button type="button" class="ttt-btn ttt-btn-primary" data-action="start">${t('start')}</button>
      <button type="button" class="ttt-link" data-action="help">${t('howto')}</button>`;
  }

  // --- game screen --------------------------------------------------------

  startGame() {
    const s = this._setup;
    // Resolve who opens THIS game. In Alternate mode, flip nextStarter and
    // bank it immediately (before any move is played) so the choice survives
    // navigating away mid-game -- mirrors mancala/js/ui.js's startGame().
    let starter;
    if (s.firstMode === 'you') starter = 'you';
    else if (s.firstMode === 'opponent') starter = 'opponent';
    else {
      starter = s.nextStarter === 'opponent' ? 'opponent' : 'you';
      s.nextStarter = starter === 'you' ? 'opponent' : 'you';
    }
    this._saveSetup();
    this.humanMark = starter === 'you' ? X : O;
    this.aiMark = this.humanMark === X ? O : X;
    clearGame();                 // a new match replaces any saved one
    this.state = newGame(s.variant, X);
    this.view = 'game';
    this._afterStateChange();
    // Who opens is already announced by the existing status line
    // (_statusText: "Your turn" / "{opp}'s turn" / "{opp} is thinking...")
    // rendered by _afterStateChange -- no separate toast/UI surface needed.
  }

  /** Rebuild an in-progress match exactly as left and hand the turn back to
   *  whoever had it -- mirrors mancala/js/ui.js's resumeGame(). Reuses the
   *  normal post-move funnel, so a saved AI turn picks up right where it
   *  left off (same "worst case: the in-flight move rolls back" note as
   *  Mancala -- the save is only ever a fully-settled position). */
  resumeGame(saved) {
    this._setup.difficulty = saved.difficulty;
    this.humanMark = saved.humanMark;
    this.aiMark = saved.aiMark;
    this.state = saved.state;
    this.view = 'game';
    this._afterStateChange();
  }

  /** Single funnel after every state change (initial deal, human move, AI
   *  move): checkpoint the save, render, resolve a finished match, or
   *  schedule the AI's turn. */
  _afterStateChange() {
    if (this._dead) return;
    saveGame(this);   // checkpoint after every settled move (clears itself once over)
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
    if (s.over) return s.isDraw ? t('draw') : (s.winner === this.humanMark ? t('you_win') : t('opp_wins', { opp: id.oppName }));
    if (this.busy) return t('opp_thinking', { opp: id.oppName });
    if (s.turn === this.humanMark) {
      if (s.variant === 'ultimate') {
        return s.forcedBoard === null ? t('your_turn_any_board') : t('your_turn_board', { n: s.forcedBoard + 1 });
      }
      return t('your_turn');
    }
    return t('opp_turn', { opp: id.oppName });
  }

  _classicBoardHtml(s) {
    const legal = s.over ? [] : legalMoves(s);
    const legalSet = new Set(legal);
    const winSet = new Set(s.winLine || []);
    const canClickNow = !s.over && !this.busy && s.turn === this.humanMark;
    const cellsHtml = s.board.map((mark, i) => {
      const r = Math.floor(i / 3) + 1, c = (i % 3) + 1;
      const live = canClickNow && legalSet.has(i);
      const name = mark ? t('cell_occupied_aria', { r, c, mark }) : t('cell_empty_aria', { r, c });
      return `<button type="button" class="ttt-cell ${live ? 'is-live' : ''} ${winSet.has(i) ? 'is-win' : ''}"
        data-action="cell" data-cell="${i}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
        aria-label="${name}">${mark || ''}</button>`;
    }).join('');
    return `<div class="ttt-board" role="grid" aria-label="${t('board_aria')}">${cellsHtml}</div>`;
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
      const label = resolved
        ? (owner === 'D' ? t('sboard_drawn_aria', { n: b + 1 }) : t('sboard_won_aria', { n: b + 1, mark: owner }))
        : t('sboard_aria', { n: b + 1 });
      const cellsHtml = cells.map((mark, c) => {
        const r = Math.floor(c / 3) + 1, col = (c % 3) + 1;
        const live = canClickNow && legalSet.has(`${b}:${c}`);
        const name = mark
          ? t('scell_occupied_aria', { n: b + 1, r, c: col, mark })
          : t('scell_empty_aria', { n: b + 1, r, c: col });
        return `<button type="button" class="ttt-scell ${live ? 'is-live' : ''}"
          data-action="scell" data-board="${b}" data-cell="${c}" data-mark="${mark || ''}" ${live ? '' : 'disabled'}
          aria-label="${name}">${mark || ''}</button>`;
      }).join('');
      return `<div class="ttt-sboard ${cls}" data-owner="${owner || ''}" aria-label="${label}">
        ${cellsHtml}<div class="ttt-soverlay" aria-hidden="true">${overlayGlyph}</div>
      </div>`;
    }).join('');

    return `<div class="ttt-uboard" role="grid" aria-label="${t('uboard_aria')}">${boardsHtml}</div>`;
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
        <span class="ttt-vsdash">${t('vs')}</span>
        <div class="ttt-idchip ${!s.over && s.turn === this.aiMark ? 'is-turn' : ''}" data-mark="${this.aiMark}">
          <span class="ttt-mark">${this.aiMark}</span><span>${esc(id.oppName)}</span><span>${esc(id.oppEmoji)}</span>
        </div>
      </div>
      <p class="ttt-status" aria-live="polite">${esc(this._statusText(s, id))}</p>
      ${boardHtml}
      <div class="ttt-actions">
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="help">${t('howto')}</button>
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-role="restart" data-action="restart">${t('restart_game')}</button>
        <button type="button" class="ttt-btn ttt-btn-ghost ttt-btn-small" data-action="change-settings">${t('new_game')}</button>
      </div>`;
  }

  /** Run `action` immediately if there's no game in progress to lose; otherwise
   *  require a second confirming tap on `btn` (guards against accidentally
   *  abandoning a game). Reference pattern: connect-four/js/ui.js. */
  confirmDestructive(btn, action) {
    if (!this.state || this.state.over) { action(); return; }
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
    if (!this.shell) return;
    const b = this.shell.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
  }

  finish() {
    const s = this.state;
    const won = s.isDraw ? null : (s.winner === this.humanMark);
    try { recordTicTacToe(s.variant, this._setup.difficulty, won); } catch { /* never block the result */ }

    const id = this._identity();
    const title = s.isDraw ? t('draw') : won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = s.isDraw ? '🤝' : won ? '🏆' : id.oppEmoji;
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="ttt-scrim"></div>
      <div class="ttt-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="ttt-card-emoji">${esc(emoji)}</span>
        <h3 class="ttt-card-title">${esc(title)}</h3>
        <p class="ttt-card-sub">${s.variant === 'ultimate' ? t('variant_ultimate') : t('variant_classic')} &middot; ${t(DIFF_LABEL_KEY[this._setup.difficulty])}</p>
        <div class="ttt-card-actions">
          <button type="button" class="ttt-btn ttt-btn-primary" data-action="rematch">${t('play_again')}</button>
          <button type="button" class="ttt-btn ttt-btn-ghost" data-action="change-settings">${t('change_settings')}</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------

  /** The one thing prose explains badly: play the top-right cell of a board,
   *  your opponent is sent to the top-right board. Nine board outlines, one
   *  shown with its own 3x3 grid and a marked cell, an arrow to the matching
   *  board. Colors ride on top of shape (mark, outline, arrow), never alone. */
  _forcedBoardDiagram() {
    return `<svg class="ttt-diagram" viewBox="0 0 224 224" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="ttt-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ttt-gold)"/>
        </marker>
      </defs>
      <rect x="10" y="10" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="10" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="148" y="10" width="66" height="66" rx="6" class="ttt-dg-board ttt-dg-dest"/>
      <rect x="10" y="79" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="79" width="66" height="66" rx="6" class="ttt-dg-board ttt-dg-src"/>
      <rect x="148" y="79" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="10" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="79" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <rect x="148" y="148" width="66" height="66" rx="6" class="ttt-dg-board"/>
      <g class="ttt-dg-grid">
        <line x1="101" y1="79" x2="101" y2="145"/><line x1="123" y1="79" x2="123" y2="145"/>
        <line x1="79" y1="101" x2="145" y2="101"/><line x1="79" y1="123" x2="145" y2="123"/>
      </g>
      <g class="ttt-dg-mark">
        <line x1="127" y1="83" x2="141" y2="97"/><line x1="141" y1="83" x2="127" y2="97"/>
      </g>
      <path d="M139,85 Q166,58 179,44" class="ttt-dg-arrow" marker-end="url(#ttt-dg-arrowhead)"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'ttt-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="ttt-scrim" data-action="close-overlay"></div>
      <div class="ttt-card ttt-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="ttt-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="ttt-card-title">${t('howto')}</h3>
        <p class="ttt-help-lead">${t('help_lead')}</p>
        <div class="ttt-diagram-wrap">${this._forcedBoardDiagram()}</div>
        <div class="ttt-help-lines">
          <p class="ttt-help-caption">${t('help_caption')}</p>
          <p class="ttt-help-example">${t('help_example')}</p>
          <p class="ttt-help-rule">${t('help_rule')}</p>
        </div>
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
      this._setup.firstMode = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'cell') {
      this.humanMove(Number(btn.dataset.cell));
    } else if (action === 'scell') {
      this.humanMove({ board: Number(btn.dataset.board), cell: Number(btn.dataset.cell) });
    } else if (action === 'restart') {
      // Same-settings restart, mid-game (Task 4). Counts as a new completed
      // game for Alternate-mode purposes, same as Connect Four's menu-restart.
      this.confirmDestructive(btn, () => this.startGame());
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
