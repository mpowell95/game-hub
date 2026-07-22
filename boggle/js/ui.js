// ui.js - Boggle UI module. Hub contract: init(container)/destroy()/isInProgress().
//
// Structural template: Dots and Boxes (newest game at the time this was
// built, same module-contract/settings/CSS shape). Setup screen follows
// Escoba's accordion pattern (one settings row open at a time), CSS scoping
// discipline follows Mancala (every rule descendant-scoped under .bg-root),
// the settings KEY follows Filler/Tic Tac Toe/Dots and Boxes's convention
// (gamehub.<game>.v1).
//
// game.js/dict.js/solver.js/ai.js stay pure and DOM-free (see each file's own
// header). This module's one unusual job versus every other game here: it
// awaits an async dictionary load (dict.js's loadDictionary(), a ~1.6MB
// fetch + a trie build) before a round can start, so there is a genuine
// 'loading' view between 'setup' and 'game' that no other game in this repo
// needs.

import {
  BOARD_SIZE, newBoard, neighbors, isAdjacent, wordForPath, scoreForWord, MIN_WORD_LEN,
} from './game.js';
import { loadDictionary, isValidWord } from './dict.js';
import { solveBoard } from './solver.js';
import { selectAiWords, totalScore } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordBoggle, loadStats } from '../../js/game-stats.js';

const SETTINGS_KEY = 'gamehub.boggle.v1';

const TIMERS = [[2, '2 min'], [3, '3 min'], [5, '5 min']];
const TIMER_LABEL = Object.fromEntries(TIMERS);
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Beginner/Intermediate/Pro) -- do not invent
// new tier names here.
const DIFFICULTIES = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['pro', 'Pro']];
const DIFF_LABEL = Object.fromEntries(DIFFICULTIES);
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const posKey = (r, c) => `${r},${c}`;
const displayFace = (face) => (face === 'QU' ? 'Qu' : face);

/** Idempotently ensure the module's stylesheet is on the page (hub or standalone). */
function ensureStylesheet() {
  const href = new URL('../css/boggle.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/boggle.css'));
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

class BoggleUI {
  constructor(container) {
    this.container = container;
    this._dead = false;
    this.view = 'setup';
    this._setupExpanded = null;
    this._board = null;
    this._trieRoot = null;
    this._solved = [];
    this._path = [];
    this._found = new Map(); // word -> score, insertion order = discovery order
    this._feedback = null;
    this._roundOver = false;
    this._timerId = null;
    this._remainingSec = 0;
    this._endsAt = 0;
    this._result = null;
    this._solveExpanded = false;
    this._setup = this._loadSetup();

    this._onClick = (e) => this.onClick(e);

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    this.stopTimer();
    if (this.root) this.root.removeEventListener('click', this._onClick);
    this.container.innerHTML = '';
    this._board = null;
  }

  // No mid-game resume: a round is a live countdown (2-5 minutes) that cannot
  // meaningfully pause across a hub navigation -- same reasoning as Dots and
  // Boxes / Tic Tac Toe (see root CLAUDE.md's "two legitimate meanings" note
  // on isInProgress()). True only while a round is actually ticking right now.
  isInProgress() {
    return this.view === 'game' && !this._roundOver;
  }

  // --- settings persistence -------------------------------------------------

  _loadSetup() {
    const saved = loadJSON(SETTINGS_KEY, {});
    let profile = null;
    try { profile = loadProfile(); } catch { profile = null; }
    const opp = profile && profile.opponents && profile.opponents[0];
    const profileDiff = (opp && SKILL_TO_DIFF[opp.skill]) || null;
    return {
      timerMinutes: TIMER_LABEL[saved.timerMinutes] ? saved.timerMinutes : 3,
      difficulty: DIFFICULTIES.some(([k]) => k === saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
    };
  }

  _saveSetup() {
    const s = this._setup;
    saveJSON(SETTINGS_KEY, { timerMinutes: s.timerMinutes, difficulty: s.difficulty });
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
    try { rec = (loadStats().games || {}).boggle; } catch { rec = null; }
    const bg = rec && rec.bg;
    if (!bg || !bg.played) return '';
    return `${bg.played} played · ${bg.won | 0}-${bg.lost | 0}-${bg.tied | 0} · best score ${bg.bestScore | 0}`;
  }

  // --- DOM construction -------------------------------------------------------

  mount() {
    this.container.innerHTML = `<div class="bg-root"><div class="bg-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.bg-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    this.renderSetup();
  }

  // --- setup screen -----------------------------------------------------------

  _seg(action, value, opts) {
    return `<div class="bg-seg">${opts.map(([v, lbl]) =>
      `<button type="button" class="bg-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${esc(lbl)}</button>`).join('')}</div>`;
  }

  _row(key, label, value, content) {
    const open = this._setupExpanded === key;
    return `<div class="bg-row ${open ? 'is-open' : ''}">
      <button type="button" class="bg-row-head" data-action="toggle-row" data-row="${key}">
        <span class="bg-row-label">${label}</span><span class="bg-row-value">${esc(value)}</span>
      </button>
      ${open ? `<div class="bg-row-expand">${content}</div>` : ''}
    </div>`;
  }

  _timerContent() {
    return this._seg('set-timer', this._setup.timerMinutes, TIMERS);
  }

  _diffContent() {
    const s = this._setup;
    const hint = s.difficulty === 'pro'
      ? 'Finds most of the words on the board, especially the long, high-value ones. Tough to beat.'
      : s.difficulty === 'intermediate' ? 'Finds close to half the words on the board, an even mix of lengths.'
        : 'Finds about a fifth of the words on the board, mostly short ones.';
    return this._seg('set-diff', s.difficulty, DIFFICULTIES) + `<p class="bg-hint">${hint}</p>`;
  }

  renderSetup() {
    if (this._dead) return;
    this.closeOverlays();
    this.view = 'setup';
    this.stopTimer();
    this._board = null;
    const id = this._identity();
    const s = this._setup;
    const stats = this._statsLine();
    this.shell.innerHTML = `
      <h1 class="bg-title">Boggle</h1>
      <p class="bg-sub">Shake the grid, race the clock, link touching letters into words.</p>
      ${stats ? `<p class="bg-stats">${esc(stats)}</p>` : ''}
      <div class="bg-vscard">
        <div class="bg-vsside"><span class="bg-vsemoji">${esc(id.humanEmoji)}</span><span class="bg-vsname">${esc(id.humanName)}</span></div>
        <span class="bg-vslabel">vs</span>
        <div class="bg-vsside"><span class="bg-vsemoji">${esc(id.oppEmoji)}</span><span class="bg-vsname">${esc(id.oppName)}</span></div>
      </div>
      <div class="bg-summary">
        ${this._row('timer', 'Timer', TIMER_LABEL[s.timerMinutes], this._timerContent())}
        ${this._row('difficulty', 'Difficulty', DIFF_LABEL[s.difficulty], this._diffContent())}
      </div>
      <button type="button" class="bg-btn bg-btn-primary" data-action="start">Start game</button>
      <button type="button" class="bg-link" data-action="help">How to play</button>`;
  }

  // --- loading ------------------------------------------------------------

  renderLoading() {
    if (this._dead) return;
    this.shell.innerHTML = `
      <div class="bg-loading">
        <div class="bg-spinner" aria-hidden="true"></div>
        <p>Loading the dictionary&hellip;</p>
      </div>`;
  }

  renderLoadError() {
    if (this._dead) return;
    this.shell.innerHTML = `
      <div class="bg-loading">
        <p>Could not load the dictionary. Check your connection and try again.</p>
        <button type="button" class="bg-btn bg-btn-primary" data-action="start">Try again</button>
        <button type="button" class="bg-link" data-action="change-settings">Back to setup</button>
      </div>`;
  }

  // --- game: starting a round ------------------------------------------------

  /** The dictionary is fetched + its trie built lazily on first game start
   *  (not at setup-screen mount), and loadDictionary() caches the in-flight/
   *  resolved promise in module scope -- a second Start (this round or a
   *  future one, including after hub navigation away and back) never
   *  re-fetches the ~1.6MB word list or rebuilds the trie. */
  async startGame() {
    this._saveSetup();
    this._path = [];
    this._found = new Map();
    this._feedback = null;
    this._roundOver = false;
    this._solveExpanded = false;
    this._result = null;
    this.view = 'loading';
    this.renderLoading();
    let dict;
    try {
      dict = await loadDictionary();
    } catch (err) {
      if (this._dead) return;
      console.error('[Boggle] dictionary load failed', err);
      this.renderLoadError();
      return;
    }
    if (this._dead) return;
    console.log(`[Boggle] dictionary ready: ${dict.wordCount.toLocaleString()} words, trie built in ${dict.buildMs.toFixed(1)}ms`);
    this._trieRoot = dict.root;
    this._board = newBoard();
    this._solved = solveBoard(this._board.grid, this._trieRoot);
    this.view = 'game';
    this._remainingSec = this._setup.timerMinutes * 60;
    this._endsAt = Date.now() + this._remainingSec * 1000;
    this.renderGame();
    this.startTimer();
  }

  // --- timer ----------------------------------------------------------------

  startTimer() {
    this.stopTimer();
    this._timerId = setInterval(() => this.tick(), 1000);
  }

  stopTimer() {
    if (this._timerId) { clearInterval(this._timerId); this._timerId = null; }
  }

  /** Recomputed from a fixed end timestamp every tick (not decremented by 1
   *  each call), so a throttled background tab or a slow tick never lets the
   *  displayed time drift from the real deadline. */
  tick() {
    if (this._dead) return;
    const remainingMs = Math.max(0, this._endsAt - Date.now());
    this._remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingMs <= 0) { this.finish(); return; }
    this._updateTimerDisplay();
  }

  /** A direct textContent patch, not a full renderGame() -- ticking once a
   *  second must never rebuild the 16 tile buttons or the path overlay out
   *  from under an in-progress tap. */
  _updateTimerDisplay() {
    if (!this.shell) return;
    const el = this.shell.querySelector('[data-role="timer"]');
    if (!el) return;
    const mm = String(Math.floor(this._remainingSec / 60)).padStart(2, '0');
    const ss = String(this._remainingSec % 60).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
    el.classList.toggle('is-low', this._remainingSec <= 10);
  }

  // --- game: tap-sequence input -----------------------------------------------

  /** Only tiles adjacent to the current path's last tile are selectable (and
   *  the last tile itself, to support tap-to-remove); everything else is
   *  disabled at render time so an illegal path can never be built. */
  onTileTap(r, c) {
    if (this.view !== 'game' || this._roundOver || !this._board) return;
    const key = posKey(r, c);
    const path = this._path;
    if (path.length) {
      const [lr, lc] = path[path.length - 1];
      if (posKey(lr, lc) === key) {
        path.pop();
        this._feedback = null;
        this.renderGame();
        return;
      }
      if (path.some(([pr, pc]) => posKey(pr, pc) === key)) return; // mid-path tile, no reuse
      if (!isAdjacent(lr, lc, r, c)) return; // defensive; button should already be disabled
    }
    path.push([r, c]);
    this._feedback = null;
    this.renderGame();
  }

  onClearPath() {
    if (!this._path.length) return;
    this._path = [];
    this._feedback = null;
    this.renderGame();
  }

  onSubmitWord() {
    if (!this._board || !this._path.length) return;
    const word = wordForPath(this._board.grid, this._path);
    if (word.length < MIN_WORD_LEN) return;
    if (this._found.has(word)) {
      this._feedback = { type: 'duplicate', word };
    } else if (!isValidWord(this._trieRoot, word)) {
      this._feedback = { type: 'invalid', word };
    } else {
      const score = scoreForWord(word);
      this._found.set(word, score);
      this._feedback = { type: 'valid', word, score };
    }
    this._path = [];
    this.renderGame();
  }

  // --- game screen --------------------------------------------------------

  _boardHtml() {
    const grid = this._board.grid;
    const path = this._path;
    const usedKeys = new Set(path.map(([r, c]) => posKey(r, c)));
    const lastKey = path.length ? posKey(path[path.length - 1][0], path[path.length - 1][1]) : null;
    let liveKeys = null;
    if (path.length) {
      const [lr, lc] = path[path.length - 1];
      liveKeys = new Set(neighbors(lr, lc).map(([r, c]) => posKey(r, c)).filter((k) => !usedKeys.has(k)));
    }
    const tiles = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = posKey(r, c);
        const face = displayFace(grid[r][c].face);
        const inPath = usedKeys.has(key);
        const isLast = key === lastKey;
        const live = !this._roundOver && (path.length === 0 || isLast || (liveKeys && liveKeys.has(key)));
        let label;
        if (inPath && !isLast) label = `Letter ${face}, already used in this word`;
        else if (isLast) label = `Letter ${face}, tap to remove from word`;
        else if (!live) label = `Letter ${face}, not connected to the current word`;
        else label = `Letter ${face}, row ${r + 1} column ${c + 1}`;
        tiles.push(`<button type="button" class="bg-tile ${inPath ? 'is-used' : ''} ${isLast ? 'is-last' : ''}"
          data-action="tile" data-r="${r}" data-c="${c}" ${live ? '' : 'disabled'} aria-label="${esc(label)}">
          <span class="bg-tile-face">${esc(face)}</span></button>`);
      }
    }
    const points = path.length > 1
      ? path.map(([r, c]) => `${((c + 0.5) / BOARD_SIZE * 100).toFixed(2)},${((r + 0.5) / BOARD_SIZE * 100).toFixed(2)}`).join(' ')
      : '';
    return `<div class="bg-board-wrap">
      <svg class="bg-path-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${points ? `<polyline points="${points}" class="bg-path-line" fill="none"/>` : ''}
      </svg>
      <div class="bg-board" role="grid" aria-label="Boggle board">${tiles.join('')}</div>
    </div>`;
  }

  _feedbackHtml() {
    const f = this._feedback;
    if (!f) return '<p class="bg-feedback" aria-live="polite"></p>';
    if (f.type === 'valid') return `<p class="bg-feedback is-good" aria-live="polite"><span aria-hidden="true">&check;</span> ${esc(f.word)}: ${f.score} point${f.score === 1 ? '' : 's'}</p>`;
    if (f.type === 'duplicate') return `<p class="bg-feedback is-bad" aria-live="polite"><span aria-hidden="true">&cross;</span> Already found ${esc(f.word)}</p>`;
    return `<p class="bg-feedback is-bad" aria-live="polite"><span aria-hidden="true">&cross;</span> "${esc(f.word)}" is not in the dictionary</p>`;
  }

  renderGame() {
    if (this._dead) return;
    const grid = this._board.grid;
    const word = this._path.length ? wordForPath(grid, this._path) : '';
    const canSubmit = word.length >= MIN_WORD_LEN;
    const score = [...this._found.values()].reduce((s, v) => s + v, 0);
    const foundRows = [...this._found.entries()].reverse()
      .map(([w, pts]) => `<li><span>${esc(w)}</span><b>${pts}</b></li>`).join('');
    const mm = String(Math.floor(this._remainingSec / 60)).padStart(2, '0');
    const ss = String(this._remainingSec % 60).padStart(2, '0');
    this.shell.innerHTML = `
      <div class="bg-topbar">
        <div class="bg-timer ${this._remainingSec <= 10 ? 'is-low' : ''}" data-role="timer" aria-live="polite">${mm}:${ss}</div>
        <div class="bg-scorebox"><b>${score}</b><span>points</span></div>
        <div class="bg-scorebox"><b>${this._found.size}</b><span>words</span></div>
      </div>
      ${this._boardHtml()}
      <div class="bg-wordbar">
        <div class="bg-wordbar-text">${word ? esc(word) : 'Tap letters to build a word'}</div>
        <div class="bg-wordbar-actions">
          <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="clear-path" ${this._path.length ? '' : 'disabled'}>Clear</button>
          <button type="button" class="bg-btn bg-btn-primary bg-btn-small" data-action="submit-word" ${canSubmit ? '' : 'disabled'}><span aria-hidden="true">&check;</span> Enter</button>
        </div>
      </div>
      ${this._feedbackHtml()}
      <div class="bg-found">
        <h4 class="bg-found-h">Words found</h4>
        <ul class="bg-found-list">${foundRows || '<li class="bg-found-empty">None yet</li>'}</ul>
      </div>
      <div class="bg-actions">
        <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="help">How to play</button>
        <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="change-settings">Give up</button>
      </div>`;
  }

  // --- end of round ---------------------------------------------------------

  finish() {
    this.stopTimer();
    this._roundOver = true;
    const humanWords = [...this._found.entries()].map(([word, score]) => ({ word, score }));
    const humanScore = humanWords.reduce((s, w) => s + w.score, 0);
    const aiWords = selectAiWords(this._solved, this._setup.difficulty);
    const aiScore = totalScore(aiWords);
    const won = humanScore === aiScore ? null : humanScore > aiScore;
    const longestWord = humanWords.reduce(
      (best, w) => (w.word.length > best.len ? { word: w.word, len: w.word.length } : best),
      { word: '', len: 0 },
    );
    const extras = { words: humanWords.length, score: humanScore, longestWord };
    try { recordBoggle(this._setup.difficulty, won, extras); } catch { /* never block the result */ }
    this._result = { humanWords, humanScore, aiWords, aiScore, won };
    this._path = [];
    this.renderGame();
    this.openEndOverlay();
  }

  _fullSolveHtml() {
    const id = this._identity();
    const aiSet = new Set(this._result.aiWords.map((e) => e.word));
    const sorted = [...this._solved].sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
    const rows = sorted.map((e) => {
      const mine = this._found.has(e.word);
      const theirs = aiSet.has(e.word);
      const owners = `${mine ? esc(id.humanEmoji) : ''}${theirs ? esc(id.oppEmoji) : ''}` || '&ndash;';
      return `<li class="bg-solve-row ${mine ? 'is-mine' : ''} ${theirs ? 'is-theirs' : ''}">
        <span class="bg-solve-word">${esc(e.word)}</span>
        <span class="bg-solve-pts">${e.score}</span>
        <span class="bg-solve-owners" aria-hidden="true">${owners}</span>
      </li>`;
    }).join('');
    return `<ul class="bg-solve-list">${rows}</ul>`;
  }

  openEndOverlay() {
    this.closeOverlays();
    const id = this._identity();
    const r = this._result;
    const title = r.won === null ? 'Tie game!' : r.won ? 'You win!' : `${id.oppName} wins`;
    const emoji = r.won === null ? '🤝' : r.won ? '🏆' : id.oppEmoji;
    const overlay = document.createElement('div');
    overlay.className = 'bg-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="bg-scrim"></div>
      <div class="bg-card bg-end" role="dialog" aria-modal="true" aria-label="Round over">
        <button type="button" class="bg-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <span class="bg-card-emoji">${emoji}</span>
        <h3 class="bg-card-title">${esc(title)}</h3>
        <p class="bg-card-sub">${r.humanScore}-${r.aiScore} &middot; ${TIMER_LABEL[this._setup.timerMinutes]} &middot; ${DIFF_LABEL[this._setup.difficulty]}</p>
        <div class="bg-end-tallies">
          <div class="bg-tally"><b>${r.humanWords.length}</b><span>${esc(id.humanName)}'s words</span></div>
          <div class="bg-tally"><b>${r.aiWords.length}</b><span>${esc(id.oppName)}'s words</span></div>
          <div class="bg-tally"><b>${this._solved.length}</b><span>Possible on this board</span></div>
        </div>
        <button type="button" class="bg-link" data-action="toggle-solve">${this._solveExpanded ? 'Hide' : 'Browse'} every word on the board &rsaquo;</button>
        ${this._solveExpanded ? this._fullSolveHtml() : ''}
        <div class="bg-card-actions">
          <button type="button" class="bg-btn bg-btn-primary" data-action="rematch">Play again</button>
          <button type="button" class="bg-btn bg-btn-ghost" data-action="change-settings">Change settings</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------
  //
  // Everyone already knows "find words in a letter grid" -- the one genuinely
  // non-obvious mechanic is the adjacency-path-plus-no-reuse rule, so the
  // sheet shows ONLY that, as a diagram, not a rules dump. Same shape as
  // Dots and Boxes/Tic Tac Toe's how-to-play sheets: one bold goal line, a
  // diagram of the one confusing mechanic, a plain-word caption, an "X = Y"
  // example, then the remaining edge cases as their own sentences.

  /** Three tiles traced start-to-end, the last step diagonal (dr=1, dc=1),
   *  with the FIRST tile (already stepped through) shown dashed/crossed to
   *  read as locked-out even though it's part of the same path -- shape,
   *  outline and the crossing lines carry the "no reuse" meaning, never
   *  color alone. */
  _pathDiagram() {
    const gridRects = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) gridRects.push(`<rect x="${14 + c * 46}" y="${14 + r * 46}" width="36" height="36" rx="8"/>`);
    return `<svg class="bg-diagram" viewBox="0 0 200 200" role="img" aria-label="A word traced through three touching tiles including one diagonal step; the first tile, already used, is crossed out and cannot be tapped again">
      <defs>
        <marker id="bg-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--bg-accent-deep)"/>
        </marker>
      </defs>
      <g class="bg-dg-grid">${gridRects.join('')}</g>
      <rect x="60" y="14" width="36" height="36" rx="8" class="bg-dg-step"/>
      <rect x="106" y="60" width="36" height="36" rx="8" class="bg-dg-step"/>
      <rect x="14" y="14" width="36" height="36" rx="8" class="bg-dg-used"/>
      <path d="M23,23 L41,41 M41,23 L23,41" class="bg-dg-cross"/>
      <path d="M32,32 L78,32 L124,78" class="bg-dg-path" marker-end="url(#bg-dg-arrowhead)" fill="none"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'bg-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="bg-scrim" data-action="close-overlay"></div>
      <div class="bg-card bg-help" role="dialog" aria-modal="true" aria-label="How to play">
        <button type="button" class="bg-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <h3 class="bg-card-title">How to play</h3>
        <p class="bg-help-lead">Find as many words as you can before time runs out.</p>
        <div class="bg-diagram-wrap">${this._pathDiagram()}</div>
        <div class="bg-help-lines">
          <p class="bg-help-caption">Letters must touch, including corners. You cannot use the same tile twice in one word.</p>
          <p class="bg-help-example">Tiles touching corner to corner = still connected</p>
          <ul class="bg-help-list">
            <li>Qu is one tile that counts as two letters.</li>
            <li>Longer words score much more: three letters is 1 point, eight letters is 11.</li>
            <li>Words you both find still count for both of you.</li>
          </ul>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays() {
    if (!this.root) return;
    this.root.querySelectorAll('.bg-overlay').forEach((el) => el.remove());
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
    } else if (action === 'set-timer') {
      this._setup.timerMinutes = Number(btn.dataset.v);
      this.renderSetup();
    } else if (action === 'set-diff') {
      this._setup.difficulty = btn.dataset.v;
      this.renderSetup();
    } else if (action === 'start') {
      this.startGame();
    } else if (action === 'tile') {
      this.onTileTap(Number(btn.dataset.r), Number(btn.dataset.c));
    } else if (action === 'submit-word') {
      this.onSubmitWord();
    } else if (action === 'clear-path') {
      this.onClearPath();
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'change-settings') {
      this.closeOverlays();
      this.renderSetup();
    } else if (action === 'help') {
      this.openHelp();
    } else if (action === 'toggle-solve') {
      this._solveExpanded = !this._solveExpanded;
      this.openEndOverlay();
    } else if (action === 'close-overlay') {
      this.closeOverlays();
    }
  }
}

// --- hub module contract -----------------------------------------------------

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new BoggleUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() {
  return !!(instance && instance.isInProgress());
}

export default { init, destroy, isInProgress };
