// ui.js - Dots and Boxes UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Setup screen follows Escoba's accordion pattern (one settings row open at a
// time, toggle-row/is-open), per Matt's explicit ranking of setup screens in
// this repo (2026-07-21: Escoba is the model; Filler is an acceptable
// fallback; Mancala and Connect Four are not to be copied) -- Tic Tac Toe is
// the newest game built to the same convention and is this file's structural
// template. CSS scoping discipline follows Mancala (every rule descendant-
// scoped under .db-root). The settings KEY follows Filler/Tic Tac Toe's
// convention (gamehub.<game>.v1).
//
// game.js/ai.js stay pure and synchronous (no DOM, no async agent interface):
// a Dots and Boxes move has no multi-step resolution to await from the
// engine's point of view (chain captures are just repeated calls to
// applyMove/chooseMove for the same player), so this mirrors Filler/Mancala/
// Tic Tac Toe's direct-call shape instead of Escoba/Chinchon's agent
// interface.

import { newGame, legalMoves, applyMove, edgeKey, edgeCount, isOver, score } from './game.js';
import { chooseMove } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordDotsBoxes, loadStats } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.dotsboxes.v1';
const GAME_KEY = 'gamehub.dotsboxes.save.v1';   // the one in-progress game (see saveGame/loadGame)
const AI_THINK_MS = 500;      // pause before the AI's first move of a fresh turn
const AI_CHAIN_STEP_MS = 220; // faster pacing between successive chain-capture moves

// Board size is a SETTING, not the difficulty tier (AI skill is, see DIFFICULTIES
// below) -- the two are independent axes, see root CLAUDE.md / the handoff. Values
// (first element) stay canonical; labelKey resolves via t().
const SIZES = [['small', 'size_small', 3, 3], ['medium', 'size_medium', 4, 4], ['large', 'size_large', 10, 10]];
const SIZE_META = Object.fromEntries(SIZES.map(([k, labelKey, rows, cols]) => [k, { labelKey, rows, cols }]));
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Beginner/Intermediate/Pro) -- do not invent
// new tier names here.
const DIFFICULTIES = [['beginner', 'diff_beginner'], ['intermediate', 'diff_intermediate'], ['pro', 'diff_pro']];
const DIFF_LABEL_KEY = Object.fromEntries(DIFFICULTIES);
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/dots-boxes.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/dots-boxes.css'));
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

/** Persist the in-progress match so leaving (hub, Menu, a reload, or closing
 *  the PWA) never loses it. Only ever holds ONE unfinished game; cleared the
 *  moment it finishes or a new one starts. Mirrors mancala/js/ui.js's
 *  saveGame/loadGame/clearGame pattern -- do not invent a new shape. */
function saveGame(ui) {
  try {
    if (!ui.state || isOver(ui.state) || ui.view !== 'game') { clearGame(); return; }
    const s = ui.state;
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      size: ui._setup.size,
      difficulty: ui._setup.difficulty,
      rows: s.rows,
      cols: s.cols,
      hEdges: s.hEdges,
      vEdges: s.vEdges,
      boxes: s.boxes,
      turn: s.turn,
      drawnEdges: s.drawnEdges,
      totalEdges: s.totalEdges,
      humanSeat: ui.humanSeat,
      aiSeat: ui.aiSeat,
      lastCaptured: ui._lastCaptured,
      humanChainRun: ui._humanChainRun,
      humanBestChainThisGame: ui._humanBestChainThisGame,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard (board size must match a
 *  real SIZE_META entry and every array must be shaped exactly right for
 *  that size) so a corrupt or stale-shape save is treated as "no saved
 *  game" rather than crashing the module on mount. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    const meta = SIZE_META[raw.size];
    if (!meta) return null;
    const rows = Math.round(Number(raw.rows));
    const cols = Math.round(Number(raw.cols));
    if (rows !== meta.rows || cols !== meta.cols) return null;
    if (!DIFFICULTIES.some(([k]) => k === raw.difficulty)) return null;

    const validCell = (v) => v === null || v === 0 || v === 1;
    const validGrid = (grid, nRows, nCols) => Array.isArray(grid) && grid.length === nRows
      && grid.every((row) => Array.isArray(row) && row.length === nCols && row.every(validCell));
    if (!validGrid(raw.hEdges, rows + 1, cols)) return null;
    if (!validGrid(raw.vEdges, rows, cols + 1)) return null;
    if (!validGrid(raw.boxes, rows, cols)) return null;

    const totalEdges = (rows + 1) * cols + rows * (cols + 1);
    const drawnEdges = Math.max(0, Math.round(Number(raw.drawnEdges)) || 0);
    if (drawnEdges >= totalEdges) return null; // an already-finished board is not "in progress"
    const humanSeat = raw.humanSeat === 1 ? 1 : 0;

    return {
      size: raw.size,
      difficulty: raw.difficulty,
      rows, cols,
      hEdges: raw.hEdges,
      vEdges: raw.vEdges,
      boxes: raw.boxes,
      turn: raw.turn === 1 ? 1 : 0,
      drawnEdges,
      totalEdges,
      humanSeat,
      aiSeat: 1 - humanSeat,
      lastCaptured: Array.isArray(raw.lastCaptured) ? raw.lastCaptured.filter((p) => Array.isArray(p) && p.length === 2) : [],
      humanChainRun: Math.max(0, Math.round(Number(raw.humanChainRun)) || 0),
      humanBestChainThisGame: Math.max(0, Math.round(Number(raw.humanBestChainThisGame)) || 0),
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

class DotsBoxesUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.view = 'setup';
    this._setupExpanded = null;
    this.state = null;
    this.busy = false;
    this.humanSeat = 0;
    this.aiSeat = 1;
    this.aiTimer = null;
    this._chaining = false;
    this._lastCaptured = [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = 0;
    this._confirmTimer = null;
    this._setup = this._loadSetup();

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    this.mount();
    // Come back to exactly where you left off: an unfinished match (from the
    // hub back button, the in-game Menu button, a reload, or closing the PWA)
    // resumes straight onto the board, no setup screen and no "resume?"
    // dialog. Otherwise start at setup. Mirrors mancala/js/ui.js's mount-time
    // `loadGame()` check.
    const saved = loadGame();
    if (saved) this._resumeGame(saved); else this.renderSetup();
  }

  destroy() {
    this._dead = true;
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    clearTimeout(this._confirmTimer);
    if (this.root) this.root.removeEventListener('click', this._onClick);
    this.container.innerHTML = '';
    this.state = null;
  }

  // Dots and Boxes autosaves after every drawn edge (see saveGame/loadGame,
  // key GAME_KEY = 'gamehub.dotsboxes.save.v1') and resumes straight back
  // onto the board on the next mount -- leaving mid-match costs nothing. Per
  // root CLAUDE.md's "two legitimate meanings" note on isInProgress(), this
  // game now uses the autosave/resume meaning: false for solo play even
  // mid-game, because a resumed match is exactly where you left it.
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
    // First-move mode (2026-07-24, batch 8): 'you' | 'opponent' | 'alternate'.
    // `humanFirst` is the FROZEN gen-1 field (existing shape, never renamed) --
    // if a device has an explicit legacy `humanFirst` boolean saved (from before
    // Alternate existed), that choice always wins and maps to 'you'/'opponent'.
    // A device with NO saved choice at all (fresh `{}`, no `firstMode`, no
    // `humanFirst`) defaults to 'alternate', per Matt's "every turn-based game
    // should alternate who goes first by default" (same call as Connect Four's
    // identical 2026-07-23 change, gamehub.connect4.v1).
    let firstMode;
    if (['you', 'opponent', 'alternate'].includes(saved.firstMode)) {
      firstMode = saved.firstMode;
    } else if (typeof saved.humanFirst === 'boolean') {
      firstMode = saved.humanFirst ? 'you' : 'opponent';
    } else {
      firstMode = 'alternate';
    }
    const nextStarter = saved.nextStarter === 'opponent' ? 'opponent' : 'you';
    return {
      size: SIZE_META[saved.size] ? saved.size : 'medium',
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
      firstMode,
      nextStarter,
    };
  }

  _saveSetup() {
    const s = this._setup;
    // humanFirst is kept in step with the resolved mode (frozen field, still
    // written) so any older/unexpected reader of this key sees a sane boolean;
    // firstMode/nextStarter are the new, additive fields that actually govern
    // Alternate. Only size/difficulty/humanFirst existed before this change.
    saveJSON(SETTINGS_KEY, {
      size: s.size,
      difficulty: s.difficulty,
      humanFirst: s.firstMode === 'opponent' ? false : true,
      firstMode: s.firstMode,
      nextStarter: s.nextStarter,
    });
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
    try { rec = (loadStats().games || {}).dotsboxes; } catch { rec = null; }
    const db = rec && rec.db;
    if (!db || !db.played) return '';
    return t('stats_line', { played: db.played, w: db.won | 0, l: db.lost | 0, t: db.tied | 0, chain: db.bestChain | 0 });
  }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="db-root"><div class="db-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.db-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    // Caller (constructor) decides setup vs. resume straight into the game.
  }

  // --- setup screen -----------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="db-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="db-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${esc(lbl)}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="db-row ${open ? 'is-open' : ''}">
      <button type="button" class="db-row-head" data-action="toggle-row" data-row="${key}">
        <span class="db-row-label">${label}</span><span class="db-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="db-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _sizeContent() {
    const s = this._setup;
    const meta = SIZE_META[s.size];
    const hint = t('hint_size_boxes', { rows: meta.rows, cols: meta.cols });
    return this._seg('set-size', s.size, SIZES.map(([k, labelKey]) => [k, t(labelKey)]))
      + `<p class="db-hint">${hint}</p>`;
  }

  /** Difficulty picker with a ski-slope shape (diffShapeSVG/tierOf, the same
   *  shared shapes the leaderboard uses) before each label -- no explanation
   *  prose anymore (Matt asked for the per-tier hint paragraph removed). */
  _diffContent() {
    const s = this._setup;
    const btns = DIFFICULTIES.map(([v, k]) => {
      const shape = diffShapeSVG(tierOf(v));
      return `<button type="button" class="db-segbtn ${v === s.difficulty ? 'is-selected' : ''}" data-action="set-diff" data-v="${v}">${shape}<span>${esc(t(k))}</span></button>`;
    }).join('');
    return `<div class="db-seg">${btns}</div>`;
  }

  _firstContent() {
    const id = this._identity();
    return this._seg('set-first', this._setup.firstMode,
      [['you', t('you')], ['opponent', esc(id.oppName)], ['alternate', t('alternate')]]);
  }

  /** Display label for the collapsed "First move" row. */
  _firstLabel() {
    const id = this._identity();
    const m = this._setup.firstMode;
    return m === 'you' ? t('you') : m === 'opponent' ? id.oppName : t('alternate');
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
      <h1 class="db-title">${t('title')}</h1>
      <p class="db-sub">${t('tagline')}</p>
      ${stats ? `<p class="db-stats">${esc(stats)}</p>` : ''}
      <div class="db-vscard">
        <div class="db-vsside"><span class="db-vsemoji">${esc(id.humanEmoji)}</span><span class="db-vsname">${esc(id.humanName)}</span></div>
        <span class="db-vslabel">${t('vs')}</span>
        <div class="db-vsside"><span class="db-vsemoji">${esc(id.oppEmoji)}</span><span class="db-vsname">${esc(id.oppName)}</span></div>
      </div>
      <div class="db-summary">
        ${this._row('size', t('row_size'), t(SIZE_META[s.size].labelKey), this._sizeContent())}
        ${this._row('difficulty', t('row_difficulty'), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
        ${this._row('first', t('row_first'), this._firstLabel(), this._firstContent())}
      </div>
      <button type="button" class="db-btn db-btn-primary" data-action="start">${t('start')}</button>
      <button type="button" class="db-link" data-action="help">${t('howto')}</button>`;
  }

  // --- game screen --------------------------------------------------------

  startGame() {
    // Resolve who opens. Under Alternate, consume this._setup.nextStarter and
    // flip it for NEXT time, then bank the flip immediately (persisted by
    // _saveSetup below) so it survives navigating away mid-game -- every call
    // to startGame() (fresh game, rematch, Restart) is a "new game" for this
    // purpose. Mirrors mancala/js/ui.js's startGame() alternation pattern.
    let starter;
    if (this._setup.firstMode === 'alternate') {
      starter = this._setup.nextStarter === 'opponent' ? 'opponent' : 'you';
      this._setup.nextStarter = starter === 'you' ? 'opponent' : 'you';
    } else {
      starter = this._setup.firstMode === 'opponent' ? 'opponent' : 'you';
    }
    this._saveSetup();
    clearGame();   // a new game (fresh start, rematch, or Restart) replaces any saved one
    // newGame() always starts turn 0, so whichever seat we call human here IS
    // the opener -- the existing status line (_statusText, "Your turn" /
    // "{opp}'s turn") already announces this correctly with no new UI needed.
    this.humanSeat = starter === 'you' ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    const meta = SIZE_META[this._setup.size];
    this.state = newGame(meta.rows, meta.cols);
    this._lastCaptured = [];
    this._humanChainRun = 0;
    this._humanBestChainThisGame = 0;
    this.view = 'game';
    this._afterStateChange(false);
  }

  /** Rebuild the board from a saved game and hand the turn back to whoever
   *  had it -- if we left while the AI was mid-chain, it picks up right
   *  where it left off (`_afterStateChange` already schedules its move when
   *  `state.turn === aiSeat`). Mirrors mancala/js/ui.js's resumeGame(). */
  _resumeGame(saved) {
    this._setup.size = saved.size;
    this._setup.difficulty = saved.difficulty;
    this.humanSeat = saved.humanSeat;
    this.aiSeat = saved.aiSeat;
    this.state = {
      rows: saved.rows,
      cols: saved.cols,
      hEdges: saved.hEdges,
      vEdges: saved.vEdges,
      boxes: saved.boxes,
      turn: saved.turn,
      drawnEdges: saved.drawnEdges,
      totalEdges: saved.totalEdges,
    };
    this._lastCaptured = saved.lastCaptured;
    this._humanChainRun = saved.humanChainRun;
    this._humanBestChainThisGame = saved.humanBestChainThisGame;
    this.view = 'game';
    this._afterStateChange(false);
  }

  /** Single funnel after every state change (initial deal, human move, AI
   *  move): render, resolve a finished match, or schedule the AI's turn.
   *  `chaining` is true iff the player about to move is continuing a capture
   *  streak from their own previous move (controls AI pacing and whether the
   *  human's best-chain-this-game counter resets). */
  _afterStateChange(chaining) {
    if (this._dead) return;
    this._chaining = chaining;
    if (isOver(this.state)) {
      this.busy = false;
      this.renderGame();
      clearGame();   // a finished match has nothing left to resume
      this.finish();
      return;
    }
    if (this.state.turn === this.aiSeat) {
      this.busy = true;
      this.renderGame();
      saveGame(this);   // checkpoint after every settled move (clears itself once over)
      const delay = chaining ? AI_CHAIN_STEP_MS : AI_THINK_MS;
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this._dead || !this.state || isOver(this.state)) return;
        const move = chooseMove(this.state, this._setup.difficulty);
        const res = applyMove(this.state, move);
        this._lastCaptured = res.boxes;
        this._afterStateChange(res.again);
      }, delay);
    } else {
      if (!chaining) this._humanChainRun = 0;
      this.busy = false;
      this.renderGame();
      saveGame(this);   // checkpoint after every settled move (clears itself once over)
    }
  }

  humanMove(edge) {
    if (this.busy || !this.state || isOver(this.state) || this.state.turn !== this.humanSeat) return;
    const legal = legalMoves(this.state).some((m) => edgeKey(m) === edgeKey(edge));
    if (!legal) return;
    const res = applyMove(this.state, edge);
    this._lastCaptured = res.boxes;
    if (res.claimed > 0) {
      this._humanChainRun += res.claimed;
      this._humanBestChainThisGame = Math.max(this._humanBestChainThisGame, this._humanChainRun);
    }
    this._afterStateChange(res.again);
  }

  _statusText(s, id) {
    if (isOver(s)) {
      const sc = score(s);
      const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
      return humanScore === aiScore ? t('tie_game') : (humanScore > aiScore ? t('you_win') : t('opp_wins', { opp: id.oppName }));
    }
    if (this.busy) return this._chaining ? t('opp_claims_again', { opp: id.oppName }) : t('opp_thinking', { opp: id.oppName });
    if (s.turn === this.humanSeat) return this._chaining ? t('you_claimed_again') : t('your_turn');
    return t('opp_turn', { opp: id.oppName });
  }

  _gridTemplate(n) {
    const tracks = [];
    for (let i = 0; i <= n; i++) { tracks.push('var(--db-dot)'); if (i < n) tracks.push('var(--db-cell)'); }
    return tracks.join(' ');
  }

  /** '' | 'is-human' | 'is-ai' for a seat owner (null|0|1) -- shared by edges
   *  and boxes so a player's lines and their claimed boxes read as the same
   *  color at a glance, the way the game is played on paper. */
  _ownerClass(owner) {
    return owner === null ? '' : (owner === this.humanSeat ? 'is-human' : 'is-ai');
  }

  _boardHtml(s, id) {
    const rows = s.rows, cols = s.cols;
    const canClickNow = !isOver(s) && !this.busy && s.turn === this.humanSeat;
    const claimed = this._lastCaptured || [];
    const parts = [];
    for (let mr = 0; mr <= 2 * rows; mr++) {
      const rowIsDots = mr % 2 === 0;
      for (let mc = 0; mc <= 2 * cols; mc++) {
        const colIsDots = mc % 2 === 0;
        if (rowIsDots && colIsDots) {
          parts.push('<div class="db-dot" aria-hidden="true"></div>');
        } else if (rowIsDots) {
          const r = mr / 2, c = (mc - 1) / 2;
          const owner = s.hEdges[r][c];
          const drawn = owner !== null;
          const live = canClickNow && !drawn;
          parts.push(`<button type="button" class="db-edge db-edge-h ${drawn ? 'is-drawn' : ''} ${this._ownerClass(owner)} ${live ? 'is-live' : ''}"
            data-action="edge" data-etype="h" data-r="${r}" data-c="${c}" ${live ? '' : 'disabled'}
            aria-label="${t('edge_h_aria', { state: t(drawn ? 'line_drawn' : 'draw_line'), r: r + 1, c1: c + 1, c2: c + 2 })}">
            <span class="db-line" aria-hidden="true"></span></button>`);
        } else if (colIsDots) {
          const r = (mr - 1) / 2, c = mc / 2;
          const owner = s.vEdges[r][c];
          const drawn = owner !== null;
          const live = canClickNow && !drawn;
          parts.push(`<button type="button" class="db-edge db-edge-v ${drawn ? 'is-drawn' : ''} ${this._ownerClass(owner)} ${live ? 'is-live' : ''}"
            data-action="edge" data-etype="v" data-r="${r}" data-c="${c}" ${live ? '' : 'disabled'}
            aria-label="${t('edge_v_aria', { state: t(drawn ? 'line_drawn' : 'draw_line'), c: c + 1, r1: r + 1, r2: r + 2 })}">
            <span class="db-line" aria-hidden="true"></span></button>`);
        } else {
          const r = (mr - 1) / 2, c = (mc - 1) / 2;
          const owner = s.boxes[r][c];
          const capturable = owner === null && edgeCount(s, r, c) === 3 && this._setup.difficulty === 'beginner';
          const isNew = claimed.some(([br, bc]) => br === r && bc === c);
          const glyph = owner === null ? '' : esc(owner === this.humanSeat ? id.humanEmoji : id.oppEmoji);
          const label = owner === null
            ? t(capturable ? 'box_capturable_aria' : 'box_empty_aria', { r: r + 1, c: c + 1 })
            : t('box_claimed_aria', { r: r + 1, c: c + 1, who: owner === this.humanSeat ? id.humanName : id.oppName });
          parts.push(`<div class="db-box ${this._ownerClass(owner)} ${capturable ? 'is-capturable' : ''} ${isNew ? 'is-claim' : ''}" aria-label="${label}">
            ${glyph ? `<span class="db-glyph">${glyph}</span>` : ''}</div>`);
        }
      }
    }
    return `<div class="db-board" data-size="${this._setup.size}"
      style="grid-template-columns:${this._gridTemplate(cols)};grid-template-rows:${this._gridTemplate(rows)};"
      role="grid" aria-label="${t('board_aria')}">${parts.join('')}</div>`;
  }

  renderGame() {
    if (this._dead) return;
    const id = this._identity();
    const s = this.state;
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const over = isOver(s);
    this.shell.innerHTML = `
      <div class="db-topbar">
        <div class="db-idchip ${!over && s.turn === this.humanSeat ? 'is-turn' : ''}">
          <span>${esc(id.humanEmoji)}</span><span>${esc(id.humanName)}</span><span class="db-score">${humanScore}</span>
        </div>
        <span class="db-vsdash">${t('vs')}</span>
        <div class="db-idchip ${!over && s.turn === this.aiSeat ? 'is-turn' : ''}">
          <span class="db-score">${aiScore}</span><span>${esc(id.oppName)}</span><span>${esc(id.oppEmoji)}</span>
        </div>
      </div>
      <p class="db-status" aria-live="polite">${esc(this._statusText(s, id))}</p>
      ${this._boardHtml(s, id)}
      <div class="db-actions">
        <button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="help">${t('howto')}</button>
        <button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="restart">${t('restart_game')}</button>
        <button type="button" class="db-btn db-btn-ghost db-btn-small" data-action="change-settings">${t('new_game')}</button>
      </div>`;
  }

  finish() {
    clearGame();   // belt and braces: _afterStateChange already cleared the save on game-over
    const s = this.state;
    const sc = score(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const won = humanScore === aiScore ? null : humanScore > aiScore;
    const extras = { boxes: humanScore, bestChain: this._humanBestChainThisGame };
    try { recordDotsBoxes(this._setup.difficulty, won, extras); } catch { /* never block the result */ }

    const id = this._identity();
    const title = won === null ? t('tie_game') : won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = won === null ? '🤝' : won ? '🏆' : id.oppEmoji;
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="db-scrim"></div>
      <div class="db-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="db-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="db-card-emoji">${emoji}</span>
        <h3 class="db-card-title">${esc(title)}</h3>
        <p class="db-card-sub">${humanScore}-${aiScore} · ${t(SIZE_META[this._setup.size].labelKey)} · ${t(DIFF_LABEL_KEY[this._setup.difficulty])}</p>
        <div class="db-card-actions">
          <button type="button" class="db-btn db-btn-primary" data-action="rematch">${t('play_again')}</button>
          <button type="button" class="db-btn db-btn-ghost" data-action="change-settings">${t('change_settings')}</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------
  //
  // Everyone already knows "draw a line, fill the grid" -- the one genuinely
  // non-obvious mechanic is the extra turn (completing a box lets you go
  // again), so the sheet shows ONLY that, as a diagram, not a rules dump.
  // Same shape as Tic Tac Toe's how-to-play sheet: one bold goal line, a
  // diagram of the one confusing mechanic, a plain-word caption, an "X = Y"
  // example, then the one remaining edge case as its own sentence.

  /** Completing a box's 4th side (highlighted in YOUR color, checked off)
   *  claims it and hands you another move (the curved arrow to a second,
   *  still-open box) -- shape/arrow driven, color is a reinforcement on top,
   *  never the only signal. */
  _extraTurnDiagram() {
    return `<svg class="db-diagram" viewBox="0 0 224 224" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="db-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--db-gold)"/>
        </marker>
      </defs>
      <g class="db-dg-claimed">
        <rect x="16" y="70" width="88" height="88" rx="4" class="db-dg-fill"/>
        <line x1="16" y1="70" x2="104" y2="70" class="db-dg-side"/>
        <line x1="16" y1="70" x2="16" y2="158" class="db-dg-side"/>
        <line x1="16" y1="158" x2="104" y2="158" class="db-dg-side"/>
        <line x1="104" y1="70" x2="104" y2="158" class="db-dg-move"/>
      </g>
      <g class="db-dg-dots">
        <circle cx="16" cy="70" r="4.5"/><circle cx="104" cy="70" r="4.5"/>
        <circle cx="16" cy="158" r="4.5"/><circle cx="104" cy="158" r="4.5"/>
      </g>
      <g class="db-dg-open">
        <rect x="148" y="44" width="60" height="60" rx="4"/>
      </g>
      <g class="db-dg-dots db-dg-dots-open">
        <circle cx="148" cy="44" r="4"/><circle cx="208" cy="44" r="4"/>
        <circle cx="148" cy="104" r="4"/><circle cx="208" cy="104" r="4"/>
      </g>
      <path d="M108,85 Q140,40 150,55" class="db-dg-arrow" marker-end="url(#db-dg-arrowhead)"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const id = this._identity();
    const overlay = document.createElement('div');
    overlay.className = 'db-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="db-scrim" data-action="close-overlay"></div>
      <div class="db-card db-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="db-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="db-card-title">${t('howto')}</h3>
        <p class="db-help-lead">${t('help_lead')}</p>
        <div class="db-diagram-wrap">${this._extraTurnDiagram()}</div>
        <div class="db-help-lines">
          <p class="db-help-caption">${t('help_caption')}</p>
          <p class="db-help-example">${t('help_example')}</p>
          <p class="db-help-rule">${t('help_rule')}</p>
        </div>
        <div class="db-help-legend">
          <span class="db-legend-chip is-human"><span class="db-legend-swatch" aria-hidden="true"></span>${t('you')}</span>
          <span class="db-legend-chip is-ai"><span class="db-legend-swatch" aria-hidden="true"></span>${esc(id.oppName)}</span>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.db-overlay').forEach((el) => el.remove());
  }

  /** Run `action` immediately if there's no live match to lose; otherwise
   *  require a second confirming tap on `btn` (guards Restart against
   *  accidentally discarding an in-progress game). Same shape as Connect
   *  Four's confirmDestructive/resetConfirms (connect-four/js/ui.js). */
  confirmDestructive(btn, action) {
    if (!this.state || isOver(this.state)) { action(); return; }
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
    const b = this.shell.querySelector('[data-action="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
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
    } else if (action === 'set-size') {
      this._setup.size = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'set-diff') {
      this._setup.difficulty = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'set-first') {
      this._setup.firstMode = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'edge') {
      this.humanMove({ type: btn.dataset.etype, r: Number(btn.dataset.r), c: Number(btn.dataset.c) });
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
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
  instance = new DotsBoxesUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
