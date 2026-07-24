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
//
// INPUT: swipe-to-trace is the primary way to play (drag through the letters
// without lifting, release to submit), because tapping each letter
// individually and then hitting a submit button is too slow to be worth
// playing against a clock -- Matt's direct call, 2026-07-22. Tap-to-select is
// KEPT as a second path, not as a fallback nobody uses: it is what makes the
// board work for keyboard and screen-reader users, since every tile is still a
// real <button>. The two modes coexist (see _onPointerDown/_onPointerMove and
// `_tapMode`), so a tap-built word and a swiped word are the same code path
// from onSubmitWord() onward.
//
// The rules for what a given tile means mid-trace live in game.js's pure
// pathAction(), not here, so they are unit-testable without a DOM.

import {
  BOARD_SIZE, neighbors, pathAction, wordForPath, scoreForWord, MIN_WORD_LEN,
} from './game.js';
import { loadDictionary, isValidWord } from './dict.js';
import { shakePlayableBoard, solveBoard } from './solver.js';
import { selectAiWords, totalScore } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordBoggle, loadStats } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.boggle.v1';
// The one in-progress round (autosave/resume, batch 9 of the 2026-07-23
// feedback arc -- see HANDOFF-FB-RESUME.md). Deliberately NOT the solver's
// full word list: that is cheap to recompute deterministically from the
// saved board once the dictionary is loaded again (see resumeGame()), so
// only the board letters + found words + time remaining + the round's own
// settings are persisted. Never touch SETTINGS_KEY's shape or values.
const SAVE_KEY = 'gamehub.boggle.save.v1';

// Ids stay module-scope (storage vocabulary); display labels resolve through t()
// inside the render functions, same pattern as every other bilingual game.
const TIMERS = [2, 3, 5];
const TIMER_LABEL_KEY = { 2: 'timer_2', 3: 'timer_3', 5: 'timer_5' };
// Difficulty tiers, in the hub's shared vocabulary (js/game-stats-ui.js's
// DIFF_META normalizes these to Beginner/Intermediate/Pro) -- do not invent
// new tier names here.
const DIFFICULTIES = ['beginner', 'intermediate', 'pro'];
const DIFF_LABEL_KEY = { beginner: 'diff_beginner', intermediate: 'diff_intermediate', pro: 'diff_pro' };
// Shared hub profile: opponent skill (1/2/3) maps 1:1 onto beginner/intermediate/pro.
const SKILL_TO_DIFF = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const posKey = (r, c) => `${r},${c}`;
const displayFace = (face) => (face === 'QU' ? 'Qu' : face);
// A browser fires `click` within a few ms of pointerup; anything later than
// this is a genuine keyboard activation, not the tail of a tap.
const CLICK_AFTER_POINTER_MS = 700;

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

/** Rebuild a solver-shaped `{ grid, tiles }` board from saved face letters.
 *  `dieIndex` is not gameplay state (only test.js's dice-authenticity check
 *  uses it), so a resumed board carries -1 there -- harmless everywhere else. */
function boardFromFaces(faces) {
  const grid = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(null));
  const tiles = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tile = { r, c, face: faces[r][c], dieIndex: -1 };
      grid[r][c] = tile;
      tiles.push(tile);
    }
  }
  return { grid, tiles };
}

/** Persist the live round so leaving (hub back, reload, closing the PWA)
 *  never loses it. Called after every scored word and from destroy() (belt
 *  and braces -- covers backgrounding mid-word-entry too). Never called for
 *  hub navigation specifically; destroy() runs regardless of the reason. */
function saveGame(ui) {
  try {
    if (ui.view !== 'game' || !ui._board || ui._roundOver) { clearGame(); return; }
    const faces = ui._board.grid.map((row) => row.map((tile) => tile.face));
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      faces,
      found: [...ui._found.keys()], // insertion order = discovery order; scores are recomputed on load, never trusted from storage
      remainingSec: ui._remainingSec,
      timerMinutes: ui._setup.timerMinutes,
      difficulty: ui._setup.difficulty,
    }));
  } catch { /* a full quota must never break the round */ }
}

/** Read back a saved round, or null. Validates hard: any corrupt or
 *  non-4x4-of-letters save is treated as "no saved round" rather than
 *  crashing the module on mount (same discipline as every other game's
 *  save/load pair -- see mancala/js/ui.js's loadGame()). */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || raw.v !== 1) return null;
    if (!Array.isArray(raw.faces) || raw.faces.length !== BOARD_SIZE) return null;
    for (const row of raw.faces) {
      if (!Array.isArray(row) || row.length !== BOARD_SIZE) return null;
      if (!row.every((f) => typeof f === 'string' && /^[A-Z]{1,2}$/.test(f))) return null;
    }
    if (!Array.isArray(raw.found)) return null;
    const found = raw.found
      .filter((w) => typeof w === 'string' && w.length >= MIN_WORD_LEN)
      .map((w) => [w, scoreForWord(w)]);
    const remainingSec = Math.round(Number(raw.remainingSec));
    if (!Number.isFinite(remainingSec) || remainingSec <= 0 || remainingSec > 5 * 60) return null;
    if (!TIMERS.includes(raw.timerMinutes) || !DIFFICULTIES.includes(raw.difficulty)) return null;
    return {
      faces: raw.faces, found, remainingSec, timerMinutes: raw.timerMinutes, difficulty: raw.difficulty,
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

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
    // True only while resumeGame() is mid-flight (awaiting the dictionary):
    // destroy() must NOT touch the save during this window, or a fast
    // navigate-away-again before the resume finishes would wipe the very
    // save it was trying to restore.
    this._restoring = false;

    // Swipe-trace state. `_tracing` = a pointer is currently down on the board;
    // `_traceMoved` = it has reached a second tile, which is what separates a
    // DRAG (submit on release) from a TAP (keep the path, wait for more taps);
    // `_tapMode` = the current path was built by tapping, so the next tap
    // extends it instead of starting over. `_tileRects` is measured once per
    // gesture (see _onPointerDown) so hit-testing never depends on the DOM
    // mid-drag.
    this._tracing = false;
    this._traceMoved = false;
    this._tapMode = false;
    this._tileRects = null;
    this._pointerId = null;
    // When the last pointer gesture ended. Used to ignore the synthetic click
    // browsers fire after a tap -- deliberately a TIMESTAMP and not a boolean
    // flag: ending a trace can re-render the board, which leaves the browser
    // dispatching that click at a now-detached node where a delegated handler
    // never sees it. A flag would then stay stuck true and silently swallow the
    // next KEYBOARD activation; a timestamp cannot get stuck.
    this._lastPointerAt = 0;

    this._onClick = (e) => this.onClick(e);
    this._onPointerDown = (e) => this._pointerDown(e);
    this._onPointerMove = (e) => this._pointerMove(e);
    this._onPointerUp = (e) => this._pointerUp(e);
    this._onPointerCancel = () => this._pointerCancel();

    ensureStylesheet();
    this.mount();
  }

  destroy() {
    this._dead = true;
    // Belt and braces with the per-word checkpoint in onSubmitWord(): covers
    // backgrounding mid-word-entry too. Skipped while a resume is still
    // loading the dictionary -- nothing has changed yet, and touching the
    // save here (saveGame() clears it when view isn't 'game') would wipe the
    // very save resumeGame() was in the middle of restoring.
    if (!this._restoring) saveGame(this);
    this.stopTimer();
    this._detachBoardPointer();
    if (this.root) this.root.removeEventListener('click', this._onClick);
    this.container.innerHTML = '';
    this._board = null;
  }

  // Autosave/resume built in (saveGame/loadGame/clearGame above): the round
  // snapshots after every scored word and on destroy(), and resumes silently
  // into the same board, found-words list and countdown on the next mount.
  // Per root CLAUDE.md's "two legitimate meanings" note on isInProgress(),
  // that makes this the SECOND meaning (Escoba/Mancala's) -- leaving costs
  // nothing, so this returns false even mid-round.
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
    return {
      timerMinutes: TIMERS.includes(saved.timerMinutes) ? saved.timerMinutes : 3,
      difficulty: DIFFICULTIES.includes(saved.difficulty) ? saved.difficulty : (profileDiff || 'intermediate'),
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
    return t('stats_line', { played: bg.played, w: bg.won | 0, l: bg.lost | 0, t: bg.tied | 0, score: bg.bestScore | 0 });
  }

  // --- DOM construction -------------------------------------------------------

  mount() {
    // translate="no": machine translation rewrites single-letter tiles into
    // words (Ana hit this 2026-07-23) -- see boggle/CLAUDE.md.
    this.container.innerHTML = `<div class="bg-root" translate="no"><div class="bg-shell" data-role="shell"></div></div>`;
    this.root = this.container.querySelector('.bg-root');
    this.shell = this.root.querySelector('[data-role="shell"]');
    this.root.addEventListener('click', this._onClick);
    // A saved round wins over setup, straight onto the live board -- no
    // "resume?" dialog, same silent pattern as Escoba/Mancala.
    const save = loadGame();
    if (save) this.resumeGame(save); else this.renderSetup();
  }

  // --- setup screen -----------------------------------------------------------

  _seg(action, value, ids, labelKeys, shapes) {
    return `<div class="bg-seg">${ids.map((v) => {
      const shape = shapes ? diffShapeSVG(tierOf(v)) : '';
      return `<button type="button" class="bg-segbtn ${String(v) === String(value) ? 'is-selected' : ''}" data-action="${action}" data-v="${v}">${shape}${esc(t(labelKeys[v]))}</button>`;
    }).join('')}</div>`;
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
    return this._seg('set-timer', this._setup.timerMinutes, TIMERS, TIMER_LABEL_KEY);
  }

  _diffContent() {
    const s = this._setup;
    return this._seg('set-diff', s.difficulty, DIFFICULTIES, DIFF_LABEL_KEY, true);
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
      <h1 class="bg-title">${esc(t('title'))}</h1>
      <p class="bg-sub">${esc(t('tagline'))}</p>
      ${stats ? `<p class="bg-stats">${esc(stats)}</p>` : ''}
      <div class="bg-vscard">
        <div class="bg-vsside"><span class="bg-vsemoji">${esc(id.humanEmoji)}</span><span class="bg-vsname">${esc(id.humanName)}</span></div>
        <span class="bg-vslabel">${esc(t('vs'))}</span>
        <div class="bg-vsside"><span class="bg-vsemoji">${esc(id.oppEmoji)}</span><span class="bg-vsname">${esc(id.oppName)}</span></div>
      </div>
      <div class="bg-summary">
        ${this._row('timer', esc(t('row_timer')), t(TIMER_LABEL_KEY[s.timerMinutes]), this._timerContent())}
        ${this._row('difficulty', esc(t('row_difficulty')), t(DIFF_LABEL_KEY[s.difficulty]), this._diffContent())}
      </div>
      <button type="button" class="bg-btn bg-btn-primary" data-action="start">${esc(t('start'))}</button>
      <button type="button" class="bg-link" data-action="help">${esc(t('howto'))}</button>`;
  }

  // --- loading ------------------------------------------------------------

  renderLoading() {
    if (this._dead) return;
    this.shell.innerHTML = `
      <div class="bg-loading">
        <div class="bg-spinner" aria-hidden="true"></div>
        <p>${esc(t('loading'))}</p>
      </div>`;
  }

  renderLoadError() {
    if (this._dead) return;
    this.shell.innerHTML = `
      <div class="bg-loading">
        <p>${esc(t('load_error'))}</p>
        <button type="button" class="bg-btn bg-btn-primary" data-action="start">${esc(t('try_again'))}</button>
        <button type="button" class="bg-link" data-action="change-settings">${esc(t('back_to_setup'))}</button>
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
    clearGame(); // a new round replaces any saved one
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
    // Shake until the board is actually worth playing (see solver.js's
    // BOARD_QUALITY): the dice stay authentic, but a vowel-starved board with
    // nothing findable on it gets re-shaken rather than dealt.
    const shake = shakePlayableBoard(this._trieRoot);
    this._board = shake.board;
    this._solved = shake.solved;
    console.log(`[Boggle] board ready after ${shake.attempts} shake(s): ${this._solved.length} words findable`);
    this._tapMode = false;
    this._tracing = false;
    this._traceMoved = false;
    this.view = 'game';
    this._remainingSec = this._setup.timerMinutes * 60;
    this._endsAt = Date.now() + this._remainingSec * 1000;
    this.renderGame();
    this.startTimer();
  }

  /** Restore a saved round straight onto the live board -- no setup screen,
   *  no "resume?" dialog. The solver's full word list is NOT saved; it is
   *  cheap to recompute deterministically from the saved board letters once
   *  the dictionary trie is loaded again (same lazy/cached load startGame()
   *  uses). The clock is the deliberate special case: `remainingSec` (a
   *  duration, not a timestamp) is saved, and `_endsAt` is recomputed fresh
   *  from `Date.now()` here -- so time spent away from the game never counts
   *  down. That is intentional, favoring the player. */
  async resumeGame(save) {
    this._restoring = true;
    this.view = 'loading';
    this.renderLoading();
    let dict;
    try {
      dict = await loadDictionary();
    } catch (err) {
      if (this._dead) return;
      console.error('[Boggle] dictionary load failed (resume)', err);
      this._restoring = false;
      clearGame(); // can't resume without the dictionary; don't strand a stale save
      this.renderLoadError();
      return;
    }
    if (this._dead) { this._restoring = false; return; }
    this._restoring = false;
    this._trieRoot = dict.root;
    this._board = boardFromFaces(save.faces);
    this._solved = solveBoard(this._board.grid, this._trieRoot);
    this._found = new Map(save.found);
    this._path = [];
    this._feedback = null;
    this._roundOver = false;
    this._solveExpanded = false;
    this._result = null;
    this._setup.timerMinutes = save.timerMinutes;
    this._setup.difficulty = save.difficulty;
    this._tapMode = false;
    this._tracing = false;
    this._traceMoved = false;
    this.view = 'game';
    this._remainingSec = save.remainingSec;
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

  // --- game: swipe tracing + tap fallback -------------------------------------

  _attachBoardPointer() {
    const board = this.shell && this.shell.querySelector('.bg-board');
    if (!board) return;
    this._boardEl = board;
    board.addEventListener('pointerdown', this._onPointerDown);
    board.addEventListener('pointermove', this._onPointerMove);
    board.addEventListener('pointerup', this._onPointerUp);
    board.addEventListener('pointercancel', this._onPointerCancel);
  }

  _detachBoardPointer() {
    const board = this._boardEl;
    if (!board) return;
    board.removeEventListener('pointerdown', this._onPointerDown);
    board.removeEventListener('pointermove', this._onPointerMove);
    board.removeEventListener('pointerup', this._onPointerUp);
    board.removeEventListener('pointercancel', this._onPointerCancel);
    this._boardEl = null;
  }

  /** Measure all 16 tiles ONCE per gesture. Hit-testing against cached rects
   *  (rather than elementFromPoint) keeps tracing independent of the DOM: tiles
   *  that are `disabled` because they are not legal continuations would still
   *  need to be hit-testable for BACKTRACKING to work, and nothing re-lays-out
   *  mid-drag because _updateBoardVisuals() only patches classes. */
  _measureTiles() {
    const board = this._boardEl;
    if (!board) { this._tileRects = []; return; }
    this._tileRects = [...board.querySelectorAll('.bg-tile')].map((el) => ({
      r: Number(el.dataset.r),
      c: Number(el.dataset.c),
      rect: el.getBoundingClientRect(),
    }));
  }

  /** The tile under (x, y), or null. Each rect is inset ~14% so the pointer has
   *  to be meaningfully INSIDE a tile before it joins the word -- clipping a
   *  corner on the way past should not silently add a letter. */
  _tileAt(x, y) {
    if (!this._tileRects) return null;
    for (const t of this._tileRects) {
      const { rect } = t;
      const ix = rect.width * 0.14, iy = rect.height * 0.14;
      if (x >= rect.left + ix && x <= rect.right - ix && y >= rect.top + iy && y <= rect.bottom - iy) return t;
    }
    return null;
  }

  _canPlay() {
    return this.view === 'game' && !this._roundOver && !!this._board;
  }

  _pointerDown(e) {
    if (!this._canPlay()) return;
    const hit = this._tileAt(e.clientX, e.clientY) || this._measureThenHit(e);
    if (!hit) return;
    e.preventDefault();
    this._tracing = true;
    this._traceMoved = false;
    this._pointerId = e.pointerId;
    this._feedback = null;
    try { this._boardEl.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

    // Continuing a tap-built word vs starting a new one. A tap on the current
    // head removes it (the documented tap-to-remove affordance); anything that
    // is not a legal continuation starts fresh.
    if (this._tapMode && this._path.length) {
      const action = pathAction(this._path, hit.r, hit.c);
      if (action === 'end') this._path.pop();
      else if (action === 'append') this._path.push([hit.r, hit.c]);
      else this._path = [[hit.r, hit.c]];
    } else {
      this._path = [[hit.r, hit.c]];
    }
    this._updateBoardVisuals();
  }

  /** pointerdown can arrive before any gesture has measured the board (first
   *  touch of a round), so measure lazily and re-test once. */
  _measureThenHit(e) {
    this._measureTiles();
    return this._tileAt(e.clientX, e.clientY);
  }

  _pointerMove(e) {
    if (!this._tracing || !this._canPlay()) return;
    if (this._pointerId !== null && e.pointerId !== this._pointerId) return;
    const hit = this._tileAt(e.clientX, e.clientY);
    if (!hit) return;
    const action = pathAction(this._path, hit.r, hit.c);
    if (action === 'append') {
      this._path.push([hit.r, hit.c]);
      this._traceMoved = true;
    } else if (action === 'backtrack') {
      this._path.pop();
      this._traceMoved = true;
    } else {
      return; // 'end' (still on the head), 'blocked' (reused), 'far' (overshot)
    }
    e.preventDefault();
    this._updateBoardVisuals();
  }

  _pointerUp(e) {
    if (!this._tracing) return;
    this._endTrace(e, true);
  }

  _pointerCancel() {
    if (!this._tracing) return;
    // Interrupted (system gesture, call, etc): end the trace but never submit
    // a word the player did not choose to finish.
    this._endTrace(null, false);
  }

  _endTrace(e, submit) {
    this._tracing = false;
    this._lastPointerAt = Date.now();
    if (e && this._pointerId !== null) {
      try { this._boardEl.releasePointerCapture(this._pointerId); } catch { /* already gone */ }
    }
    this._pointerId = null;
    const wasDrag = this._traceMoved;
    this._traceMoved = false;

    if (!submit) { this._tapMode = false; this._path = []; this.renderGame(); return; }
    if (wasDrag) {
      // A real swipe: releasing IS the submit. Too short just clears, with no
      // scolding -- an aborted drag is not a mistake worth a red message.
      this._tapMode = false;
      if (this._path.length && wordForPath(this._board.grid, this._path).length >= MIN_WORD_LEN) {
        this.onSubmitWord();
      } else {
        this._path = [];
        this.renderGame();
      }
      return;
    }
    // A tap, not a drag: keep the letter selected so taps can build a word.
    // Patch in place rather than re-render, so the element the browser is about
    // to fire `click` at is still the live one in the document.
    this._tapMode = true;
    this._updateBoardVisuals();
  }

  /** Keyboard equivalent of a tap: same rules as _pointerDown's tap branch,
   *  driven by pathAction so the two can never disagree. */
  _onKeyboardTile(r, c) {
    if (!this._canPlay()) return;
    const action = pathAction(this._path, r, c);
    if (action === 'start' || action === 'far' || action === 'blocked') {
      if (action === 'far' || action === 'blocked') return; // illegal, ignore
      this._path = [[r, c]];
    } else if (action === 'end') {
      this._path.pop();
    } else if (action === 'append') {
      this._path.push([r, c]);
    }
    this._tapMode = true;
    this._feedback = null;
    this.renderGame();
  }

  onClearPath() {
    if (!this._path.length) return;
    this._path = [];
    this._tapMode = false;
    this._feedback = null;
    this.renderGame();
  }

  onSubmitWord() {
    if (!this._board || !this._path.length) return;
    const word = wordForPath(this._board.grid, this._path);
    if (word.length < MIN_WORD_LEN) return;
    this._tapMode = false;
    if (this._found.has(word)) {
      this._feedback = { type: 'duplicate', word };
    } else if (!isValidWord(this._trieRoot, word)) {
      this._feedback = { type: 'invalid', word };
    } else {
      const score = scoreForWord(word);
      this._found.set(word, score);
      this._feedback = { type: 'valid', word, score };
      saveGame(this); // checkpoint after every scored word
    }
    this._path = [];
    this.renderGame();
  }

  // --- game screen --------------------------------------------------------

  /** Per-tile display state for the current path. Shared by the initial render
   *  (_boardHtml) and the in-place patch (_updateBoardVisuals) so the two can
   *  never drift apart. */
  _tileStates() {
    const grid = this._board.grid;
    const path = this._path;
    const usedKeys = new Set(path.map(([r, c]) => posKey(r, c)));
    const lastKey = path.length ? posKey(path[path.length - 1][0], path[path.length - 1][1]) : null;
    let liveKeys = null;
    if (path.length) {
      const [lr, lc] = path[path.length - 1];
      liveKeys = new Set(neighbors(lr, lc).map(([r, c]) => posKey(r, c)).filter((k) => !usedKeys.has(k)));
    }
    const out = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = posKey(r, c);
        const face = displayFace(grid[r][c].face);
        const inPath = usedKeys.has(key);
        const isLast = key === lastKey;
        const live = !this._roundOver && (path.length === 0 || isLast || (liveKeys && liveKeys.has(key)));
        let label;
        if (inPath && !isLast) label = t('tile_used', { face });
        else if (isLast) label = t('tile_last', { face });
        else if (!live) label = t('tile_dead', { face });
        else label = t('tile_live', { face, row: r + 1, col: c + 1 });
        out.push({ r, c, face, inPath, isLast, live, label });
      }
    }
    return out;
  }

  /** Polyline points in the 0-100 viewBox space, one per tile centre. */
  _pathPoints() {
    if (this._path.length < 2) return '';
    return this._path
      .map(([r, c]) => `${((c + 0.5) / BOARD_SIZE * 100).toFixed(2)},${((r + 0.5) / BOARD_SIZE * 100).toFixed(2)}`)
      .join(' ');
  }

  _boardHtml() {
    const tiles = this._tileStates().map((t) => `<button type="button"
      class="bg-tile ${t.inPath ? 'is-used' : ''} ${t.isLast ? 'is-last' : ''}"
      data-action="tile" data-r="${t.r}" data-c="${t.c}" ${t.live ? '' : 'disabled'}
      aria-label="${esc(t.label)}"><span class="bg-tile-face">${esc(t.face)}</span></button>`).join('');
    const points = this._pathPoints();
    return `<div class="bg-board-wrap">
      <svg class="bg-path-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${points}" class="bg-path-line" fill="none"${points ? '' : ' style="display:none"'}/>
      </svg>
      <div class="bg-board" role="grid" aria-label="${esc(t('aria_board'))}">${tiles}</div>
    </div>`;
  }

  /** Patch the board in place instead of re-rendering it. A swipe fires many
   *  pointermove events per second, and rebuilding innerHTML on each one would
   *  destroy the very element the finger is on (breaking pointer capture) and
   *  re-lay-out the grid, invalidating the cached hit-test rects. Only classes,
   *  the disabled flag, aria-labels, the polyline and the word bar change. */
  _updateBoardVisuals() {
    if (this._dead || !this._boardEl) return;
    const buttons = this._boardEl.querySelectorAll('.bg-tile');
    const states = this._tileStates();
    states.forEach((t, i) => {
      const el = buttons[i];
      if (!el) return;
      el.classList.toggle('is-used', t.inPath);
      el.classList.toggle('is-last', t.isLast);
      el.disabled = !t.live;
      el.setAttribute('aria-label', t.label);
    });
    const line = this.shell.querySelector('.bg-path-line');
    if (line) {
      const points = this._pathPoints();
      line.setAttribute('points', points);
      line.style.display = points ? '' : 'none';
    }
    this._updateWordBar();
  }

  _updateWordBar() {
    const word = this._path.length ? wordForPath(this._board.grid, this._path) : '';
    const textEl = this.shell.querySelector('.bg-wordbar-text');
    if (textEl) {
      textEl.textContent = word || t('wordbar_hint');
      textEl.classList.toggle('is-empty', !word);
    }
    const clearBtn = this.shell.querySelector('[data-action="clear-path"]');
    if (clearBtn) clearBtn.disabled = !this._path.length;
    const submitBtn = this.shell.querySelector('[data-action="submit-word"]');
    if (submitBtn) submitBtn.disabled = word.length < MIN_WORD_LEN;
  }

  _feedbackHtml() {
    const f = this._feedback;
    if (!f) return '<p class="bg-feedback" aria-live="polite"></p>';
    if (f.type === 'valid') return `<p class="bg-feedback is-good" aria-live="polite"><span aria-hidden="true">&check;</span> ${esc(t('feedback_valid', { word: f.word, n: f.score }))}</p>`;
    if (f.type === 'duplicate') return `<p class="bg-feedback is-bad" aria-live="polite"><span aria-hidden="true">&cross;</span> ${esc(t('feedback_duplicate', { word: f.word }))}</p>`;
    return `<p class="bg-feedback is-bad" aria-live="polite"><span aria-hidden="true">&cross;</span> ${esc(t('feedback_invalid', { word: f.word }))}</p>`;
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
        <div class="bg-scorebox"><b>${score}</b><span>${esc(t('points'))}</span></div>
        <div class="bg-scorebox"><b>${this._found.size}</b><span>${esc(t('words'))}</span></div>
      </div>
      ${this._boardHtml()}
      <div class="bg-wordbar">
        <div class="bg-wordbar-text ${word ? '' : 'is-empty'}">${word ? esc(word) : esc(t('wordbar_hint'))}</div>
        <div class="bg-wordbar-actions">
          <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="clear-path" ${this._path.length ? '' : 'disabled'}>${esc(t('clear'))}</button>
          <button type="button" class="bg-btn bg-btn-primary bg-btn-small" data-action="submit-word" ${canSubmit ? '' : 'disabled'}><span aria-hidden="true">&check;</span> ${esc(t('enter'))}</button>
        </div>
      </div>
      ${this._feedbackHtml()}
      <div class="bg-found">
        <h4 class="bg-found-h">${esc(t('words_found'))}</h4>
        <ul class="bg-found-list">${foundRows || `<li class="bg-found-empty">${esc(t('none_yet'))}</li>`}</ul>
      </div>
      <div class="bg-actions">
        <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="help">${esc(t('howto'))}</button>
        <button type="button" class="bg-btn bg-btn-ghost bg-btn-small" data-action="change-settings">${esc(t('give_up'))}</button>
      </div>`;
    // renderGame() replaces the board element, so the pointer listeners have to
    // be re-bound to the NEW node (and the old ones dropped) every time.
    this._detachBoardPointer();
    this._attachBoardPointer();
    this._measureTiles();
  }

  // --- end of round ---------------------------------------------------------

  finish() {
    this.stopTimer();
    this._roundOver = true;
    clearGame(); // round is over and recorded; nothing left to resume into
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
    const title = r.won === null ? t('tie_game') : r.won ? t('you_win') : t('opp_wins', { opp: id.oppName });
    const emoji = r.won === null ? '🤝' : r.won ? '🏆' : id.oppEmoji;
    const overlay = document.createElement('div');
    overlay.className = 'bg-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="bg-scrim"></div>
      <div class="bg-card bg-end" role="dialog" aria-modal="true" aria-label="${esc(t('aria_round_over'))}">
        <button type="button" class="bg-x" data-action="close-overlay" aria-label="${esc(t('aria_close'))}">&times;</button>
        <span class="bg-card-emoji">${emoji}</span>
        <h3 class="bg-card-title">${esc(title)}</h3>
        <p class="bg-card-sub">${esc(t('end_sub', { score1: r.humanScore, score2: r.aiScore, timer: t(TIMER_LABEL_KEY[this._setup.timerMinutes]), diff: t(DIFF_LABEL_KEY[this._setup.difficulty]) }))}</p>
        <div class="bg-end-tallies">
          <div class="bg-tally"><b>${r.humanWords.length}</b><span>${esc(t('your_words', { name: id.humanName }))}</span></div>
          <div class="bg-tally"><b>${r.aiWords.length}</b><span>${esc(t('your_words', { name: id.oppName }))}</span></div>
          <div class="bg-tally"><b>${this._solved.length}</b><span>${esc(t('possible_on_board'))}</span></div>
        </div>
        <button type="button" class="bg-link" data-action="toggle-solve">${esc(t(this._solveExpanded ? 'hide_words' : 'browse_words'))}</button>
        ${this._solveExpanded ? this._fullSolveHtml() : ''}
        <div class="bg-card-actions">
          <button type="button" class="bg-btn bg-btn-primary" data-action="rematch">${esc(t('play_again'))}</button>
          <button type="button" class="bg-btn bg-btn-ghost" data-action="change-settings">${esc(t('change_settings'))}</button>
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
    return `<svg class="bg-diagram" viewBox="0 0 200 200" role="img" aria-label="${esc(t('aria_diagram'))}">
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
      <div class="bg-card bg-help" role="dialog" aria-modal="true" aria-label="${esc(t('howto'))}">
        <button type="button" class="bg-x" data-action="close-overlay" aria-label="${esc(t('aria_close'))}">&times;</button>
        <h3 class="bg-card-title">${esc(t('howto'))}</h3>
        <p class="bg-help-lead">${esc(t('help_lead'))}</p>
        <div class="bg-diagram-wrap">${this._pathDiagram()}</div>
        <div class="bg-help-lines">
          <p class="bg-help-caption">${esc(t('help_caption'))}</p>
          <p class="bg-help-example">${esc(t('help_example'))}</p>
          <ul class="bg-help-list">
            <li>${esc(t('help_1'))}</li>
            <li>${esc(t('help_2'))}</li>
            <li>${esc(t('help_3'))}</li>
            <li>${esc(t('help_4'))}</li>
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
      // Pointer input is fully handled by the pointerdown/up pair; the click a
      // browser fires straight afterwards must not re-apply it. A KEYBOARD
      // activation (Enter/Space on a focused tile) arrives with no recent
      // pointer gesture behind it, and that is what this branch exists for --
      // it is what keeps the board playable with no pointer at all.
      if (Date.now() - this._lastPointerAt < CLICK_AFTER_POINTER_MS) return;
      this._onKeyboardTile(Number(btn.dataset.r), Number(btn.dataset.c));
    } else if (action === 'submit-word') {
      this.onSubmitWord();
    } else if (action === 'clear-path') {
      this.onClearPath();
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame();
    } else if (action === 'change-settings') {
      this.closeOverlays();
      clearGame(); // "give up" (or leaving a load-error screen): explicit abandon, not a hub nav
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
