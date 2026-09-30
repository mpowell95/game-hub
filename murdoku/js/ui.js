// murdoku/js/ui.js - the DOM shell, input, timer, autosave and the module contract. The puzzle
// itself (layout, clues, solvers, checking) lives in engine.js; nothing here decides anything
// about it - this file only draws a puzzle and passes the player's placements to checkBoard().
//
// THE MODULE CONTRACT: init / destroy / isInProgress (docs/BUILDING-A-GAME.md, "The module
// contract"). `destroy()` must be leak-free - the hub reuses the same container for the next game.
//
// isInProgress() RETURNS FALSE, DELIBERATELY. Autosave/resume built in (root CLAUDE.md's second
// isInProgress() meaning): the case is written to `gamehub.murdoku.save.v1` after EVERY change, so
// leaving mid-case is lossless - the Sudoku / Nuts & Bolts class, not the Ball Run class.
import '../../js/theme.js';   // side effect: stamps .gh-dark so this screen themes standalone too
import { onViewportResize } from '../../js/viewport.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { recordResult } from '../../js/game-stats.js';
import {
  generate, checkBoard, personInfo, validPuzzle, nextHint, TIERS, TIER_N, ROOM_ICON, OBJ_ICON, isBlocker, SAVE_V,
} from './engine.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.murdoku.v1';
const SAVE_KEY = 'gamehub.murdoku.save.v1';
const STATS_ID = 'murdoku';
const TIER_LABEL_KEY = { easy: 'tier_easy', medium: 'tier_medium', hard: 'tier_hard', expert: 'tier_expert' };
const N_ROOM_TINTS = 7;   // engine: at most 7 rooms (expert); one tint each
const BOARD_BORDER = 3;   // px, the outer wall of the floor plan; must match .mu-board's border

const esc = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- persistence ---------------------------------------------------------------------------------

/** `learned`: this device has been given the guided first case. It is only ever set to true, so a
 *  player is walked through it once, automatically, and can replay it from "Learn to play". */
function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    return { tier: TIERS.includes(v.tier) ? v.tier : 'easy', learned: v.learned === true };
  } catch { return { tier: 'easy', learned: false }; }
}
/** Saved on SELECTION, not on start (docs/BUILDING-A-GAME.md, "Setup-screen defaults"). */
function saveSettings(patch) {
  const next = { ...loadSettings(), ...(patch || {}) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tier: next.tier, learned: !!next.learned })); } catch (err) { console.error('[murdoku] settings', err); }
  return next;
}

/** A save is only trusted if it is structurally whole; anything else reads as "no save" (a
 *  malformed save starts a fresh case rather than crashing - the profile-reader rule). */
function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== SAVE_V || !validPuzzle(s.puzzle)) return null;
    const n = s.puzzle.n, cells = n * n;
    if (!Array.isArray(s.pos) || s.pos.length !== n) return null;
    if (!s.pos.every((c) => Number.isInteger(c) && c >= -1 && c < cells)) return null;
    const marks = Array.isArray(s.marks) ? s.marks.filter((c) => Number.isInteger(c) && c >= 0 && c < cells) : [];
    return {
      puzzle: s.puzzle, pos: s.pos.slice(), marks,
      elapsedMs: Number.isFinite(s.elapsedMs) && s.elapsedMs > 0 ? s.elapsedMs : 0,
      solved: !!s.solved, recorded: !!s.recorded, guided: !!s.guided,
    };
  } catch { return null; }
}
function writeSaveObj(o) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_V, puzzle: o.puzzle, pos: o.pos, marks: o.marks, elapsedMs: Math.round(o.elapsedMs),
      solved: !!o.solved, recorded: !!o.recorded, guided: !!o.guided,
    }));
    return true;
  } catch (err) { console.error('[murdoku] save', err); return false; }
}

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- clue text -----------------------------------------------------------------------------------

const roomName = (puz, roomId) => t('room_' + puz.roomNames[roomId]);
const roomIcon = (puz, roomId) => ROOM_ICON[puz.roomNames[roomId]] || '';

/** One clue as a display fragment (room and object fragments carry their icon). */
function clueText(puz, cl) {
  const who = () => ({ name: personInfo(puz, cl.b).name });
  switch (cl.k) {
    case 'in': return `${t('frag_in', { room: roomName(puz, cl.a) })} ${roomIcon(puz, cl.a)}`;
    case 'notin': return `${t('frag_notin', { room: roomName(puz, cl.a) })} ${roomIcon(puz, cl.a)}`;
    case 'on': return `${t('frag_on_' + cl.a)}${OBJ_ICON[cl.a] ? ' ' + OBJ_ICON[cl.a] : ''}`;
    case 'by': return `${t('frag_by', { obj: t('obj_' + cl.a) })}${OBJ_ICON[cl.a] ? ' ' + OBJ_ICON[cl.a] : ''}`;
    case 'row': return t('frag_row_' + cl.a);
    case 'corner': return t('frag_corner');
    case 'above': case 'below': case 'left': case 'right': case 'diag': case 'north': case 'west':
    case 'with': case 'notwith':
      return t('frag_' + cl.k, who());
    case 'alone': return t('frag_alone');
    default: return '';
  }
}

// --- inline icons --------------------------------------------------------------------------------

const SVG_ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_HELP = `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.4c0 1.6-2.1 1.9-2.1 3.6"/><path d="M12 17.5v.01"/></svg>`;
/** A rug CAN be stood on, so it must not look like furniture: a flat woven rug with a fringe at
 *  both ends (the old striped box read as a crate). Colours come from the theme tokens. */
const RUG_SVG = `<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M2 8H6M2 12H6M2 16H6M2 20H6M2 24H6M34 8H38M34 12H38M34 16H38M34 20H38M34 24H38" stroke="var(--mu-rug-fringe)" stroke-width="1.4" stroke-linecap="round"/><rect x="6" y="5" width="28" height="22" rx="2" fill="var(--mu-rug-a)"/><rect x="9.5" y="8.5" width="21" height="15" rx="1.5" fill="none" stroke="var(--mu-rug-b)" stroke-width="1.4" stroke-dasharray="2.6 2"/><path d="M20 11.5L24.5 16L20 20.5L15.5 16Z" fill="var(--mu-rug-b)"/></svg>`;
const ICON_NEW = `<svg ${SVG_ATTR}><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`;

// --- the UI --------------------------------------------------------------------------------------

class MurdokuUI {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.selectedTier = this.settings.tier;
    this.screen = 'setup';
    this.puz = null; this.pos = []; this.marks = new Set();
    this.elapsedMs = 0; this.solved = false; this.recorded = false;
    this.sel = -1; this.mode = 'place';
    this.guided = false; this.hint = null;
    this.check = null;
    this._runStart = null; this._timerInterval = null;
    this._genTimer = null; this._building = false;
    this._overlay = null; this._overlayKind = '';
    this.root = null; this.el = {};
    this._onVisibility = () => {
      if (document.hidden) { this._pauseTimer(); this._save(); } else this._startTimer();
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    // An unfinished case resumes STRAIGHT onto the board; anything else opens the setup screen. A
    // finished case is never resumed, but a solve that was never recorded (the tab died between
    // the win and the write) is recorded now, once.
    const saved = readSave();
    if (saved && saved.solved && !saved.recorded) this._recordOnce(saved);
    if (saved && !saved.solved) this._enter(saved);
    // A first-time player is walked through a case instead of being dropped on a menu.
    else if (!this.settings.learned) this._startFresh({ guided: true });
    else this.renderSetup();
  }

  // --- timer ---------------------------------------------------------------------------------
  _startTimer() {
    if (this.screen !== 'play' || this.solved || this._overlayKind === 'howto' || document.hidden) return;
    if (this._runStart === null) this._runStart = Date.now();
  }
  _pauseTimer() {
    if (this._runStart !== null) { this.elapsedMs += Date.now() - this._runStart; this._runStart = null; }
  }
  _elapsed() { return this.elapsedMs + (this._runStart !== null ? Date.now() - this._runStart : 0); }
  _tickTimer() { if (this.el.timer) this.el.timer.textContent = fmtTime(this._elapsed()); }
  _stopLoop() { clearInterval(this._timerInterval); this._timerInterval = null; }

  // --- screens -------------------------------------------------------------------------------

  renderSetup() {
    this._closeOverlay(true);
    this.screen = 'setup';
    this._pauseTimer(); this._stopLoop();
    this.el = {};
    const saved = readSave();
    const canContinue = !!(saved && !saved.solved);
    const segs = TIERS.map((tier) => `
      <button type="button" class="mu-seg${tier === this.selectedTier ? ' is-selected' : ''}"
        data-tier="${tier}" role="radio" aria-checked="${tier === this.selectedTier}">
        <span class="mu-seg-label">${diffShapeSVG(tierOf(tier))}<b>${esc(t(TIER_LABEL_KEY[tier]))}</b></span>
        <span class="mu-seg-size">${TIER_N[tier]}×${TIER_N[tier]}</span>
      </button>`).join('');
    const contLabel = canContinue
      ? `${esc(t('continue_case'))} · ${esc(t(TIER_LABEL_KEY[saved.puzzle.tier]))} · ${esc(fmtTime(saved.elapsedMs))}` : '';
    this.container.innerHTML = `
      <div class="mu-root mu-setup">
        <div class="mu-hero" aria-hidden="true">🕵️</div>
        <div class="mu-setup-head">
          <h1>${esc(t('title'))}</h1>
          <p>${esc(t('tagline'))}</p>
        </div>
        <div class="gh-card mu-setup-card">
          <div class="gh-field">
            <span class="gh-field__label" id="mu-difflabel">${esc(t('setup_difficulty'))}</span>
            <div class="mu-seg-wrap" role="radiogroup" aria-labelledby="mu-difflabel">${segs}</div>
          </div>
          ${canContinue ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-action="continue">${contLabel}</button>` : ''}
          <button type="button" class="gh-btn gh-btn--block ${canContinue ? 'gh-btn--ghost' : 'gh-btn--primary'}" data-action="start">${esc(t('new_case'))}</button>
        </div>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-action="guided">${esc(t('learn'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-action="howto">${esc(t('howto'))}</button>
      </div>`;
    this._bindRoot();
  }

  /** The "Building the crime scene" screen. Expert can take most of a second on a slow phone, so
   *  it is PAINTED first and the generator runs a tick later. */
  _renderBuilding(failed) {
    this.screen = 'building';
    this._closeOverlay(true);
    this._pauseTimer(); this._stopLoop();
    this.el = {};
    this.container.innerHTML = `
      <div class="mu-root mu-setup mu-building">
        <div class="mu-hero mu-hero--busy" aria-hidden="true">🔍</div>
        <p class="mu-building-text" role="status">${esc(t(failed ? 'build_failed' : 'building'))}</p>
        ${failed ? `<button type="button" class="gh-btn gh-btn--primary" data-action="retry">${esc(t('retry'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost" data-action="menu">${esc(t('menu'))}</button>` : ''}
      </div>`;
    this._bindRoot();
  }

  /** A new case. `guided`: an Easy case where the next step is shown after every move (the
   *  first case every player gets, and "Learn to play"). */
  _startFresh(opts) {
    const guided = !!(opts && opts.guided);
    if (guided) this.settings = saveSettings({ learned: true });
    if (this._building) return;
    this._building = true;
    this._renderBuilding(false);
    clearTimeout(this._genTimer);
    this._genTimer = setTimeout(() => {
      this._genTimer = null;
      this._building = false;
      try {
        const seed = Math.floor(Math.random() * 1e9);
        const puz = generate(guided ? 'easy' : this.selectedTier, seed);
        this._enter({ puzzle: puz, pos: new Array(puz.n).fill(-1), marks: [], elapsedMs: 0, solved: false, recorded: false, guided });
        if (guided) this._openGuidedIntro();
      } catch (err) {
        console.error('[murdoku] generate failed', err);
        this._renderBuilding(true);
      }
    }, 30);
  }

  _enter(s) {
    this.puz = s.puzzle; this.pos = s.pos.slice(); this.marks = new Set(s.marks);
    this.elapsedMs = s.elapsedMs; this.solved = s.solved; this.recorded = s.recorded;
    this.sel = -1; this.mode = 'place';
    this.guided = !!s.guided; this.hint = null;
    if (!s.guided) this.selectedTier = s.puzzle.tier;
    this._save();
    if (this.guided) this._autoHint();
    this.renderPlay();
  }

  renderPlay() {
    this._closeOverlay(true);
    this.screen = 'play';
    const p = this.puz;
    this.container.innerHTML = `
      <div class="mu-root mu-play">
        <div class="mu-hud" data-role="hud">
          <span class="mu-hud-mid">
            <span class="mu-hud-case">${esc(this.guided ? t('case_guided') : t('case_label', { n: p.seed % 10000 }))}</span>
            <span class="mu-hud-tier">${diffShapeSVG(tierOf(p.tier))}${esc(t(TIER_LABEL_KEY[p.tier]))}</span>
          </span>
          <span class="mu-hud-timer" data-role="timer" role="timer" aria-label="${esc(t('timer_aria'))}">0:00</span>
          <button type="button" class="mu-iconbtn" data-action="howto" aria-label="${esc(t('howto_aria'))}">${ICON_HELP}</button>
          <button type="button" class="mu-iconbtn" data-action="new" aria-label="${esc(t('new_aria'))}">${ICON_NEW}</button>
        </div>
        <div class="mu-main" data-role="main">
          <div class="mu-stage" data-role="stage">
            <div class="mu-boardcol" data-role="boardcol">
              <div class="mu-board" data-role="board" role="grid" aria-label="${esc(t('board_aria'))}"></div>
            </div>
            <div class="mu-tools" data-role="tools">
              <div class="mu-tool-seg" role="group" aria-label="${esc(t('tool_aria'))}">
                <button type="button" class="mu-toolbtn" data-tool="place">${esc(t('tool_place'))}</button>
                <button type="button" class="mu-toolbtn" data-tool="mark">${esc(t('tool_mark'))}</button>
              </div>
              <button type="button" class="mu-hintbtn" data-action="hint" aria-label="${esc(t('hint_aria'))}">${esc(t('hint_btn'))}</button>
              <div class="mu-status" data-role="status" role="status" aria-live="polite"></div>
            </div>
          </div>
          <div class="mu-list" data-role="list" role="group" aria-label="${esc(t('suspects_aria'))}"></div>
        </div>
      </div>`;
    this._bindRoot();
    const q = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.el = { hud: q('hud'), main: q('main'), boardcol: q('boardcol'), board: q('board'), stage: q('stage'),
      tools: q('tools'), status: q('status'), list: q('list'), timer: q('timer') };
    this._buildBoard();
    this._exposeSeam();
    this._paint();
    this._fit();
    requestAnimationFrame(() => { this._fit(); requestAnimationFrame(() => this._fit()); });
    this._stopLoop();
    this._timerInterval = setInterval(() => this._tickTimer(), 500);
    this._startTimer();
    this._tickTimer();
    if (this.solved) this._openWin();
  }

  /** Root positioned by measurement, standalone AND mounted (same technique as sudoku/js/ui.js's
   *  `_positionRoot`; see the long comment on `.mu-root` in murdoku.css for why CSS alone cannot). */
  _positionRoot() {
    if (!this.root || !this.container) return;
    const r = this.container.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
    if (!vh) return;
    this.root.style.left = Math.round(r.left) + 'px';
    this.root.style.width = Math.round(r.width || window.innerWidth || 0) + 'px';
    // IMMERSIVE in the hub (js/hub.js): the hub's header collapses to one floating back button, so
    // the root takes the whole height and the HUD row sits BESIDE that button instead of below it.
    // That band is the ~90px an Expert board needed on a small phone (murdoku/CLAUDE.md, "Space").
    // Measured, not assumed: the button's size and the top inset differ by device and language.
    const back = document.querySelector('.hub-top-immersive .hub-back');
    const b = back && back.getBoundingClientRect();
    if (b && b.width && b.height) {
      this.root.classList.add('is-immersive');
      this.root.style.top = '0px';
      this.root.style.height = Math.max(200, Math.round(vh)) + 'px';
      this.root.style.setProperty('--mu-top', Math.max(0, Math.round(b.top + (b.height - 44) / 2)) + 'px');
      this.root.style.setProperty('--mu-hud-inset', Math.max(0, Math.round(b.right - r.left + 6)) + 'px');
      return;
    }
    this.root.classList.remove('is-immersive');
    this.root.style.top = Math.round(r.top) + 'px';
    this.root.style.height = Math.max(200, Math.round(vh - r.top)) + 'px';
  }

  _bindRoot() {
    this.root = this.container.querySelector('.mu-root');
    this._positionRoot();
    this._onClick = (ev) => this._handleClick(ev);
    this._onKey = (ev) => this._handleKey(ev);
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('keydown', this._onKey);
  }

  // --- the board -----------------------------------------------------------------------------

  _buildBoard() {
    const p = this.puz, n = p.n;
    this.cellEls = new Array(n * n);
    let html = '';
    for (let s = 0; s < n * n; s++) {
      const room = p.rooms[s], obj = p.objects[s];
      const r = (s / n) | 0, c = s % n;
      const blocker = isBlocker(obj);
      let label = t('cell_aria', { r: r + 1, c: c + 1, room: roomName(p, room) });
      if (blocker) label += ', ' + t('cell_blocked', { obj: t('obj_' + obj) });
      else if (obj) label += ', ' + t('obj_' + obj);
      html += `<div class="mu-cell mu-r${room % N_ROOM_TINTS}${blocker ? ' is-blocker' : ''}" data-i="${s}" role="gridcell" tabindex="${s === 0 ? 0 : -1}" aria-label="${esc(label)}">`
        + (obj === 'rug' ? `<span class="mu-rug" aria-hidden="true">${RUG_SVG}</span>`
          : obj ? `<span class="mu-obj" aria-hidden="true">${OBJ_ICON[obj]}</span>` : '')
        + '<span class="mu-dyn"></span></div>';
    }
    html += this._roomLabels();
    html += this._wallsSVG();
    this.el.board.style.setProperty('--mu-n', String(n));
    this.el.board.innerHTML = html;
    this.el.board.querySelectorAll('.mu-cell').forEach((c) => { this.cellEls[Number(c.dataset.i)] = c; });
  }

  /** Each room's NAME, printed on the board (Matt, 2026-09-30: a bare icon in a corner told a
   *  first-time player nothing). It sits along the room's widest row of squares, topmost first, so
   *  it has the most room to be read; a name that still does not fit ends in an ellipsis, and the
   *  icon beside it is the same one every clue about that room carries. */
  _roomLabels() {
    const p = this.puz, n = p.n;
    let html = '';
    for (const room of p.roomIds) {
      let best = null;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n;) {
          if (p.rooms[r * n + c] !== room) { c++; continue; }
          let e = c;
          while (e < n && p.rooms[r * n + e] === room) e++;
          if (!best || e - c > best.w) best = { r, c, w: e - c };
          c = e;
        }
      }
      if (!best) continue;
      html += `<span class="mu-roomlabel" style="--r:${best.r};--c:${best.c};--w:${best.w}" aria-hidden="true">${roomIcon(p, room)} ${esc(t('rname_' + p.roomNames[room]))}</span>`;
    }
    return html;
  }

  /** The walls: a thick line wherever two neighbouring squares are in different rooms. Drawn as ONE
   *  SVG over the grid (non-scaling stroke, so 3px is 3px at any board size) rather than as
   *  per-cell borders, which would double up on a wall shared by two cells. The walls carry the
   *  meaning of the floor plan; the pastel tint is only a second cue (Matt is red/green
   *  colourblind). */
  _wallsSVG() {
    const p = this.puz, n = p.n;
    let d = '';
    for (let r = 0; r < n; r++) {          // vertical walls, between (r,c) and (r,c+1)
      for (let c = 0; c < n - 1; c++) {
        if (p.rooms[r * n + c] !== p.rooms[r * n + c + 1]) d += `M${c + 1} ${r}V${r + 1}`;
      }
    }
    for (let r = 0; r < n - 1; r++) {      // horizontal walls, between (r,c) and (r+1,c)
      for (let c = 0; c < n; c++) {
        if (p.rooms[r * n + c] !== p.rooms[(r + 1) * n + c]) d += `M${c} ${r + 1}H${c + 1}`;
      }
    }
    return `<svg class="mu-walls" viewBox="0 0 ${n} ${n}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  _personAt(cell) { return this.pos.indexOf(cell); }

  _placedCount() { return this.pos.filter((c) => c >= 0).length; }

  /** Repaint everything that depends on state. Cheap: at most 64 cells and 8 rows. */
  _paint() {
    if (!this.puz || !this.el.board) return;
    const p = this.puz, n = p.n;
    const chk = this.check = checkBoard(p, this.pos);
    const clash = new Set(chk.clash), blocked = new Set(chk.blocked);
    const showBroken = chk.full && !chk.solved;
    const broken = new Set(showBroken ? chk.broken : []);
    const hintCells = new Set(this.hint ? this.hint.cells : []);
    const hintAnswer = this.hint && (this.hint.reveal || (this.hint.k === 'only')) ? p.solution[this.hint.p] : -1;
    const takenRow = new Set(), takenCol = new Set();
    this.pos.forEach((s) => { if (s >= 0) { takenRow.add((s / n) | 0); takenCol.add(s % n); } });

    for (let s = 0; s < n * n; s++) {
      const el = this.cellEls[s];
      const who = this._personAt(s);
      const r = (s / n) | 0, c = s % n;
      el.classList.toggle('is-taken', who < 0 && (takenRow.has(r) || takenCol.has(c)));
      el.classList.toggle('is-hint', hintCells.has(s) && s !== hintAnswer);
      el.classList.toggle('is-hint-answer', s === hintAnswer);
      const dyn = el.lastElementChild;
      let html = '';
      if (who >= 0) {
        const info = personInfo(p, who);
        const warn = clash.has(who) || blocked.has(who);
        const cls = `mu-token${info.victim ? ' is-victim' : ''}${warn ? ' is-warn' : ''}${who === this.sel ? ' is-sel' : ''}`;
        let alt = t('token_aria', { name: info.name });
        if (clash.has(who)) alt += ' ' + t('warn_clash') + '.';
        if (blocked.has(who)) alt += ' ' + t('warn_blocked') + '.';
        html = `<div class="${cls}" role="button" tabindex="0" data-p="${who}" aria-label="${esc(alt)}">${info.face}</div>`
          + (warn ? '<span class="mu-warnicon" aria-hidden="true">⚠️</span>' : '');
      } else if (this.marks.has(s)) {
        html = `<span class="mu-mark" aria-hidden="true">✕</span>`;
      }
      if (dyn.dataset.sig !== html) { dyn.innerHTML = html; dyn.dataset.sig = html; }
    }

    // the suspect list
    const by = p.people.map(() => []);
    p.clues.forEach((cl, i) => by[cl.p].push(i));
    this.el.list.innerHTML = this._hintHTML() + p.people.map((_, i) => {
      const info = personInfo(p, i);
      const placed = this.pos[i] >= 0, selected = i === this.sel;
      const frags = by[i].map((ci) => {
        const bad = broken.has(ci);
        return `<span class="mu-frag${bad ? ' is-bad' : ''}">${bad ? `<span class="mu-fragwarn" role="img" aria-label="${esc(t('warn_clue'))}">⚠️</span> ` : ''}${esc(clueText(p, p.clues[ci]))}</span>`;
      }).join(' · ');
      const state = selected ? t('row_selected') : placed ? t('row_placed') : t('row_waiting');
      return `<div class="mu-row${selected ? ' is-sel' : ''}${placed ? ' is-placed' : ''}${info.victim ? ' is-victim' : ''}" role="button" tabindex="0" data-p="${i}" aria-pressed="${selected}" aria-label="${esc(`${info.name}, ${state}`)}">
        <span class="mu-row-cur" aria-hidden="true">▶</span>
        <span class="mu-who"><span class="mu-face">${info.face}</span><b class="mu-name">${esc(info.name)}</b>${info.victim ? `<span class="mu-vic">${esc(t('victim_suffix'))}</span>` : ''}</span>
        <span class="mu-frags">${frags}</span>
        <span class="mu-row-ok" aria-hidden="true">✓</span>
      </div>`;
    }).join('');

    this.root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === this.mode)));
    this._paintStatus(chk);
    this._tickTimer();
  }

  /** The hint bar at the top of the suspect list (inside it, so `_fit()` measures it for free). */
  _hintHTML() {
    const h = this.hint;
    if (!h || this.solved) return '';
    const name = personInfo(this.puz, h.p).name;
    // The reason first, then (once revealed) where. A one-square hint is its own answer.
    let msg = h.k === 'look' ? t('hint_look', { name, k: h.cells.length }) : t('hint_' + h.k, { name });
    if (h.k !== 'wrong' && h.k !== 'only' && h.cells.length > 1) msg += ' ' + (h.reveal ? t('hint_answer', { name }) : t('hint_more'));
    else if (h.k !== 'wrong' && h.k !== 'only') msg += ' ' + t('hint_answer', { name });
    return `<div class="mu-hintbar" role="status"><span aria-hidden="true">💡</span><span>${esc(msg)}</span></div>`;
  }

  /** Hint button: the first tap shows the next step; a second tap on the same step shows the exact
   *  square. The hinted person is selected, so the next tap on a square places them. */
  _hintTap() {
    if (this.solved || !this.puz) return;
    const h = this.hint;
    if (h && !h.reveal && h.k !== 'wrong' && h.cells.length > 1) {
      this.hint = { ...h, reveal: true };
    } else {
      const next = nextHint(this.puz, this.pos);
      this.hint = next ? { ...next, reveal: false } : null;
    }
    if (this.hint && this.hint.k !== 'wrong') { this.sel = this.hint.p; this.mode = 'place'; }
    this._paint(); this._fit();
  }

  /** Guided case: the next step is always on screen, WITH its square - a first-time player is
   *  being shown how the reasoning goes, not tested on it. */
  _autoHint() {
    const next = this.solved ? null : nextHint(this.puz, this.pos);
    this.hint = next ? { ...next, reveal: true } : null;
    if (this.hint && this.hint.k !== 'wrong') { this.sel = this.hint.p; this.mode = 'place'; }
  }

  _paintStatus(chk) {
    let msg;
    if (this.solved) msg = t('solved_status');
    else if (chk.full && chk.broken.length) msg = t(chk.broken.length === 1 ? 'not_quite_one' : 'not_quite_many', { n: chk.broken.length });
    else if (chk.full && (chk.clash.length || chk.blocked.length)) msg = t('not_quite_rules');
    else if (this.mode === 'mark') msg = t('status_mark');
    else if (this.hint) msg = t('status_placed', { n: this._placedCount(), total: this.puz.n });
    else if (this.sel >= 0) msg = t('status_place', { name: personInfo(this.puz, this.sel).name });
    else if (this._placedCount() === 0) msg = t('status_pick');
    else msg = t('status_placed', { n: this._placedCount(), total: this.puz.n });
    this.el.status.textContent = msg;
  }

  // --- layout: one screen, no scrolling ------------------------------------------------------

  /** Fit by MEASUREMENT (docs/BUILDING-A-GAME.md Part 3): the board is whatever height is left
   *  after the header, the tool row and the suspect list, so the list is made as short as it can
   *  be before the board is allowed to shrink. Three knobs, tried in this order of preference and
   *  stopped at the first combination that gives the board a comfortable size:
   *    1. the list's font, 12.5px down to the 11px floor;
   *    2. the list as two columns of run-in cards instead of one full-width row per suspect (about
   *       a third shorter, but denser to read, so it is only used when the rows do not fit);
   *    3. the tool buttons BESIDE the board instead of in their own row (only possible while the
   *       board is narrower than the screen, which is exactly when height is the scarce thing).
   *  If nothing reaches the comfortable size, the largest board any combination allows wins.
   *  A wide window (landscape phone, desktop) puts the tool column and the list beside the board instead. */
  _fit() {
    if (this.screen !== 'play' || !this.el.board || !this.puz) return;
    const root = this.root;
    const cs = getComputedStyle(root);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    const innerW = root.clientWidth - padL - padR;
    const innerH = root.clientHeight - padT - padB;
    if (innerW <= 0 || innerH <= 0) return;
    const n = this.puz.n;
    const { list, tools, stage, hud, main } = this.el;
    const wide = root.clientWidth / root.clientHeight >= 1.3;
    root.classList.toggle('mu-wide', wide);
    const gap = parseFloat(getComputedStyle(main).rowGap) || 6;
    const mainH = innerH - hud.offsetHeight - (parseFloat(cs.rowGap) || 6);
    const FS = [12.5, 12, 11.5, 11];
    const TOOLS_MIN_W = 104;          // two stacked 44px buttons and a line of status beside the board
    const setBoard = (side) => {
      this.el.boardcol.style.width = side + 'px';
      this.el.boardcol.style.height = side + 'px';
      this.el.board.style.setProperty('--mu-cell', ((side - 2 * BOARD_BORDER) / n).toFixed(2) + 'px');
    };
    const apply = (grid, fs, beside) => {
      list.classList.toggle('is-grid', grid);
      root.style.setProperty('--mu-fs', fs + 'px');
      stage.classList.toggle('is-beside', beside);
    };
    if (!wide) {
      let best = null;
      const want = Math.min(innerW, n * 40);
      search:
      for (const grid of [false, true]) {
        for (const fs of FS) {
          for (const beside of [false, true]) {
            apply(grid, fs, beside);
            const listH = list.offsetHeight;
            const side = beside
              ? Math.min(innerW - TOOLS_MIN_W - gap, mainH - listH - gap)
              : Math.min(innerW, mainH - 44 - listH - 2 * gap);
            const score = side - (grid ? 10 : 0) - (12.5 - fs) * 1.5;
            if (!best || score > best.score) best = { grid, fs, beside, side, score };
            if (side >= want) { best = { grid, fs, beside, side, score }; break search; }
          }
        }
      }
      apply(best.grid, best.fs, best.beside);
      const side = Math.floor(Math.max(n * 12, best.side));
      tools.style.width = best.beside ? Math.floor(innerW - side - gap) + 'px' : '';
      setBoard(side);
    } else {
      // Wide: [board][tool column][suspect list], left to right, so the list gets the full height.
      tools.style.width = TOOLS_MIN_W + 'px';
      let side = Math.floor(Math.min(mainH, innerW * 0.5));
      for (let i = 0; i < 16; i++) {
        setBoard(side);
        let fit = false;
        for (const grid of [false, true]) {
          for (const fs of FS) {
            apply(grid, fs, true);
            if (list.offsetHeight <= mainH) { fit = true; break; }
          }
          if (fit) break;
        }
        if (fit) break;
        side = Math.floor(side * 0.94);
      }
      setBoard(side);
    }
  }

  // --- input ---------------------------------------------------------------------------------

  _handleClick(ev) {
    const target = ev.target;
    if (this._overlay && this._overlay.contains(target)) { this._handleOverlayClick(ev); return; }
    const actionEl = target.closest('[data-action]');
    if (actionEl) { this._handleAction(actionEl.dataset.action); return; }
    const seg = target.closest('[data-tier]');
    if (seg) {
      this.selectedTier = seg.dataset.tier;
      this.settings = saveSettings({ tier: this.selectedTier });
      this.renderSetup();
      return;
    }
    if (this.screen !== 'play') return;
    const tool = target.closest('[data-tool]');
    if (tool) { this.mode = tool.dataset.tool; if (this.mode === 'mark') this.sel = -1; this._paint(); this._fit(); return; }
    const tok = target.closest('.mu-token');
    if (tok) { this._liftPerson(Number(tok.dataset.p)); return; }
    const cell = target.closest('.mu-cell');
    if (cell) { this._cellTap(Number(cell.dataset.i)); return; }
    const row = target.closest('.mu-row');
    if (row) { this._rowTap(Number(row.dataset.p)); }
  }

  _handleKey(ev) {
    if (ev.key === 'Escape' && this._overlay) { this._closeOverlay(); ev.preventDefault(); return; }
    if (this._overlay) return;
    const isAct = ev.key === 'Enter' || ev.key === ' ';
    const cell = ev.target.closest && ev.target.closest('.mu-cell');
    if (cell && !ev.target.closest('.mu-token') && this.screen === 'play') {
      const dirs = { ArrowUp: -this.puz.n, ArrowDown: this.puz.n, ArrowLeft: -1, ArrowRight: 1 };
      const s = Number(cell.dataset.i);
      if (dirs[ev.key] !== undefined) {
        const to = s + dirs[ev.key];
        const wrapsRow = Math.abs(dirs[ev.key]) === 1 && ((to / this.puz.n) | 0) !== ((s / this.puz.n) | 0);
        if (to >= 0 && to < this.puz.n * this.puz.n && !wrapsRow) {
          cell.tabIndex = -1; this.cellEls[to].tabIndex = 0; this.cellEls[to].focus({ preventScroll: true });
        }
        ev.preventDefault();
        return;
      }
      if (isAct) { this._cellTap(s); this._refocusCell(s); ev.preventDefault(); return; }
    }
    if (isAct) {
      const el = ev.target.closest && ev.target.closest('.mu-token, .mu-row');
      if (el && el.dataset.p !== undefined && this.screen === 'play') {
        ev.preventDefault();
        if (el.classList.contains('mu-token')) this._liftPerson(Number(el.dataset.p));
        else this._rowTap(Number(el.dataset.p));
      }
    }
  }

  _refocusCell(s) {
    const el = this.cellEls && this.cellEls[s];
    if (el) { el.tabIndex = 0; try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  _handleAction(action) {
    switch (action) {
      case 'start': this._startFresh(); break;
      case 'retry': this._startFresh(); break;
      case 'continue': { const s = readSave(); if (s && !s.solved) this._enter(s); break; }
      case 'menu':
        this._pauseTimer(); this._save();
        this.renderSetup();
        break;
      case 'howto': this._openHowto(); break;
      case 'hint': this._hintTap(); break;
      case 'guided': this._startFresh({ guided: true }); break;
      case 'new':
        // One button for "new case" and "change difficulty": the HUD shares its row with the hub's
        // floating back button (immersive), so there is no room for a separate menu button.
        this._openConfirm(!this.solved && (this._placedCount() > 0 || this.marks.size > 0));
        break;
      default: break;
    }
  }

  _rowTap(p) {
    if (this.solved) return;
    this.sel = this.sel === p ? -1 : p;
    if (this.sel >= 0) this.mode = 'place';
    this._paint(); this._fit();
  }

  _liftPerson(p) {
    if (this.solved || this.mode !== 'place') return;
    this.pos[p] = -1;
    this.sel = p;                 // lifted to be moved: the next tap on a square puts them back
    this._afterChange();
  }

  _cellTap(cell) {
    if (this.solved) return;
    const who = this._personAt(cell);
    if (this.mode === 'mark') {
      if (who >= 0) return;
      if (this.marks.has(cell)) this.marks.delete(cell); else this.marks.add(cell);
      this._afterChange();
      return;
    }
    if (who >= 0) { this._liftPerson(who); return; }
    if (this.sel < 0) { this._paint(); return; }
    this._place(this.sel, cell);
  }

  /** Put person p on a square (moving them if they were placed). The one path every placement
   *  takes - the UI, the keyboard and the test seam. */
  _place(p, cell) {
    if (this.solved || !this.puz) return;
    if (p < 0 || p >= this.puz.n || cell < 0 || cell >= this.puz.n * this.puz.n) return;
    const occ = this._personAt(cell);
    if (occ >= 0 && occ !== p) this.pos[occ] = -1;
    this.pos[p] = cell;
    this.marks.delete(cell);
    this.sel = -1;
    this._afterChange();
  }

  _afterChange() {
    const chk = checkBoard(this.puz, this.pos);
    if (chk.solved) { this.hint = null; this._win(); return; }
    if (this.guided) this._autoHint(); else this.hint = null;
    this._save();
    this._paint();
    this._fit();
  }

  // --- winning -------------------------------------------------------------------------------

  _win() {
    this.solved = true;
    this.sel = -1;
    this._pauseTimer();
    this._save();
    this._recordOnce({ puzzle: this.puz, pos: this.pos, marks: [...this.marks], elapsedMs: this.elapsedMs, solved: true, recorded: this.recorded, guided: this.guided }, this);
    this._paint();
    this._fit();
    this._openWin();
  }

  /** Record the solve EXACTLY ONCE per case: the `recorded` flag lives in the save, so a reload,
   *  a re-render or a second call cannot count the same case twice. A failed record is logged
   *  loudly and left unflagged (game-stats.js queues what it cannot write; this flag is only set
   *  after the call returned) - THE LAW rule 6. */
  _recordOnce(s, ui) {
    if (s.recorded) return;
    try {
      recordResult(STATS_ID, s.puzzle.tier, true);
      s.recorded = true;
      if (ui) ui.recorded = true;
      writeSaveObj(s);
    } catch (err) {
      console.error('[murdoku] recordResult failed - the solve was NOT recorded', err);
    }
  }

  _save() {
    if (!this.puz) return;
    const elapsed = this._elapsed();
    writeSaveObj({ puzzle: this.puz, pos: this.pos, marks: [...this.marks], elapsedMs: elapsed, solved: this.solved, recorded: this.recorded, guided: this.guided });
  }

  // --- overlays ------------------------------------------------------------------------------

  _openOverlay(kind, innerHTML) {
    this._closeOverlay(true);
    this._overlayKind = kind;
    const ov = document.createElement('div');
    ov.className = 'gh-overlay mu-overlay';
    ov.innerHTML = `<div class="gh-modal mu-modal mu-modal--${kind}" role="dialog" aria-modal="true">${innerHTML}</div>`;
    this.root.appendChild(ov);
    this._overlay = ov;
    if (kind === 'howto') { this._pauseTimer(); this._fitLines(ov); }
    const first = ov.querySelector('.gh-modal__close');
    if (first) { try { first.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  _closeOverlay(silent) {
    if (!this._overlay) return;
    const kind = this._overlayKind;
    this._overlay.remove();
    this._overlay = null; this._overlayKind = '';
    if (!silent && kind === 'howto') this._startTimer();
  }

  _handleOverlayClick(ev) {
    const t0 = ev.target;
    if (t0 === this._overlay && this._overlayKind !== 'win') { this._closeOverlay(); return; }
    const act = t0.closest('[data-ov]');
    if (!act) return;
    const a = act.dataset.ov;
    if (a === 'close') this._closeOverlay();
    else if (a === 'confirm-new') { this._closeOverlay(true); this._startFresh(); }
    else if (a === 'new') { this._closeOverlay(true); this._startFresh(); }
    else if (a === 'menu') { this._closeOverlay(true); this._pauseTimer(); this._save(); this.renderSetup(); }
  }

  _openConfirm(progress) {
    this._openOverlay('confirm', `
      <button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>
      ${progress ? `<p class="mu-confirm-text">${esc(t('new_confirm'))}</p>` : ''}
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-ov="confirm-new">${esc(t('new_case'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-ov="menu">${esc(t('menu'))}</button>
      </div>`);
  }

  _openGuidedIntro() {
    this._openOverlay('guided', `
      <button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>
      <h2 class="gh-modal__title">${esc(t('guided_title'))}</h2>
      <ol class="mu-guided-steps">
        <li>${esc(t('guided_1'))}</li>
        <li>${esc(t('guided_2'))}</li>
        <li>${esc(t('guided_3'))}</li>
        <li>${esc(t('guided_4'))}</li>
      </ol>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-ov="close">${esc(t('guided_go'))}</button>
      </div>`);
  }

  _openWin() {
    const p = this.puz;
    const killer = personInfo(p, p.killer);
    const room = roomName(p, p.rooms[p.solution[p.victim]]);
    this._openOverlay('win', `
      <button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>
      <h2 class="gh-modal__title">${esc(t('win_title'))}</h2>
      <div class="mu-win-who"><span class="mu-win-face" aria-hidden="true">${killer.face}</span><b>${esc(killer.name)}</b></div>
      <p class="mu-win-line">${esc(t('win_line', { name: killer.name, room }))}</p>
      <p class="mu-win-time">${esc(t('win_time', { time: fmtTime(this.elapsedMs) }))}</p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-ov="new">${esc(t('new_case'))}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-ov="menu">${esc(t('menu'))}</button>
      </div>`);
  }

  _openHowto() {
    this._openOverlay('howto', `
      <button type="button" class="gh-modal__close" data-ov="close" aria-label="${esc(t('close_aria'))}">&times;</button>
      <h2 class="gh-modal__title">${esc(t('howto_title'))}</h2>
      <p class="mu-line mu-line--goal" data-fs="16" data-group="goal">${esc(t('howto_goal_a'))}</p>
      <p class="mu-line mu-line--goal" data-fs="16" data-group="goal">${esc(t('howto_goal_b'))}</p>
      <div class="mu-howto-diagram">${this._howtoSVG()}</div>
      <p class="mu-line mu-line--caption" data-fs="13" data-group="body">${esc(t('howto_caption'))}</p>
      <p class="mu-line mu-line--example" data-fs="13" data-group="example">${esc(t('howto_example'))}</p>
      <p class="mu-line" data-fs="13" data-group="body">${esc(t('howto_line1'))}</p>
      <p class="mu-line" data-fs="13" data-group="body">${esc(t('howto_line2'))}</p>
      <p class="mu-line" data-fs="13" data-group="body">${esc(t('howto_line3'))}</p>
      <p class="mu-line" data-fs="13" data-group="body">${esc(t('howto_line4'))}</p>
      <p class="mu-line" data-fs="13" data-group="body">${esc(t('howto_line5'))}</p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-ov="close">${esc(t('howto_close'))}</button>
      </div>`);
  }

  /** Every line of the how-to must fit on ONE row (docs/BUILDING-A-GAME.md Part 2): measure the
   *  rendered width against the container and size down until it fits, floor 11px, then it is
   *  locked with `white-space: nowrap` in the CSS. */
  _fitLines(scope) {
    const groups = {};
    scope.querySelectorAll('.mu-line').forEach((el) => { (groups[el.dataset.group || el.className] ||= []).push(el); });
    Object.values(groups).forEach((els) => {
      // One shared size per group: the smallest any line in it needs, so the sheet reads as one
      // block of text rather than lines of assorted sizes.
      let fs = Number(els[0].dataset.fs) || 13;
      els.forEach((el) => {
        let f = Number(el.dataset.fs) || 13;
        el.style.fontSize = f + 'px';
        while (el.scrollWidth > el.clientWidth + 0.5 && f > 11) { f -= 0.5; el.style.fontSize = f + 'px'; }
        if (el.scrollWidth > el.clientWidth + 0.5) console.warn('[murdoku] how-to line does not fit at 11px:', el.textContent);
        fs = Math.min(fs, f);
      });
      els.forEach((el) => { el.style.fontSize = fs + 'px'; });
    });
  }

  /** A 3x3 plan: two rooms and a wall between them; the skull and one person share the top left
   *  room (dashed square = the one alone with the victim); the third is in the other room; one
   *  person per row and column (the arrows). Shapes, outlines and arrows carry the meaning, never
   *  colour alone. Drawn from the theme's own variables so it repaints in dark mode for free. */
  _howtoSVG() {
    const X = 30, Y = 22, S = 36;
    let cells = '';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const inA = r < 2 && c < 2;
        cells += `<rect x="${X + c * S}" y="${Y + r * S}" width="${S}" height="${S}" fill="var(${inA ? '--mu-r0' : '--mu-r1'})" stroke="var(--mu-line)" stroke-width="1"/>`;
      }
    }
    const ctr = (r, c) => [X + c * S + S / 2, Y + r * S + S / 2];
    const tok = (r, c, face) => {
      const [cx, cy] = ctr(r, c);
      return `<circle cx="${cx}" cy="${cy}" r="14" fill="var(--mu-token-bg)" stroke="var(--mu-ink)" stroke-width="2"/>`
        + `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18">${face}</text>`;
    };
    const arrows = [0, 1, 2].map((i) => `<text x="${X - 9}" y="${Y + i * S + S / 2 + 4}" text-anchor="middle" font-size="13" fill="var(--mu-muted)">→</text>`
      + `<text x="${X + i * S + S / 2}" y="${Y - 7}" text-anchor="middle" font-size="13" fill="var(--mu-muted)">↓</text>`).join('');
    const [kx, ky] = ctr(1, 1);
    return `<svg viewBox="0 0 142 136" role="img" aria-label="${esc(t('howto_diagram_aria'))}">
      ${cells}
      <path d="M${X + 2 * S} ${Y}V${Y + 2 * S}H${X}" fill="none" stroke="var(--mu-wall)" stroke-width="3.5" stroke-linecap="square"/>
      <rect x="${X}" y="${Y}" width="${3 * S}" height="${3 * S}" fill="none" stroke="var(--mu-wall)" stroke-width="3.5"/>
      ${arrows}
      ${tok(0, 0, '\u{1F480}')}${tok(1, 1, '\u{1F9D4}')}${tok(2, 2, '\u{1F469}')}
      <rect x="${kx - 17}" y="${ky - 17}" width="34" height="34" rx="4" fill="none" stroke="var(--mu-select)" stroke-width="3" stroke-dasharray="6 4"/>
    </svg>`;
  }

  // --- test seam -----------------------------------------------------------------------------

  /** window.__muTest, the same idea as sudoku's __sdTest: lets a headless probe drive the game
   *  (place, solve) through the real code path without simulating every tap. */
  _exposeSeam() {
    const ui = this;
    try {
      window.__muTest = {
        get puzzle() { return ui.puz; },
        get pos() { return ui.pos.slice(); },
        get ui() { return ui; },
        place(p, cell) { if (cell < 0) { ui.pos[p] = -1; ui._afterChange(); } else ui._place(p, cell); },
        solve() { if (ui.puz) ui.puz.solution.forEach((cell, p) => ui._place(p, cell)); },
        hint() { ui._hintTap(); return ui.hint; },
      };
    } catch { /* no window */ }
  }

  // --- teardown ------------------------------------------------------------------------------

  destroy() {
    this._pauseTimer();
    this._stopLoop();
    clearTimeout(this._genTimer); this._genTimer = null; this._building = false;
    if (this.puz && this.screen === 'play') this._save();
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.root) {
      if (this._onClick) this.root.removeEventListener('click', this._onClick);
      if (this._onKey) this.root.removeEventListener('keydown', this._onKey);
    }
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    if (this._offLang) { this._offLang(); this._offLang = null; }
    try { delete window.__muTest; } catch { /* ignore */ }
    this.container.innerHTML = '';
    this.root = null; this.el = {}; this.cellEls = [];
    this.puz = null;
  }

  /** Autosave/resume built in (root CLAUDE.md's second isInProgress() meaning): the case is
   *  written after every change, so leaving mid-case is lossless. */
  isInProgress() { return false; }
}

// --- the module contract ---------------------------------------------------------------------

let instance = null;

function ensureStylesheet() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.querySelector('link[data-murdoku-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/murdoku.css', import.meta.url).href;
  link.setAttribute('data-murdoku-css', '1');
  document.head.appendChild(link);
}

export function init(container) {
  ensureStylesheet();
  if (instance) instance.destroy();
  instance = new MurdokuUI(container);
  const ui = instance;
  ui._offViewport = onViewportResize(() => { ui._positionRoot(); ui._fit(); if (ui._overlayKind === 'howto') ui._fitLines(ui._overlay); });
  ui._offLang = onLangChange(() => {
    if (!ui.root) return;
    if (ui.screen === 'setup') ui.renderSetup();
    else if (ui.screen === 'play') ui.renderPlay();
    else if (ui.screen === 'building') ui._renderBuilding(false);
  });
  return ui;
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

export function isInProgress() { return instance ? instance.isInProgress() : false; }

export default { init, destroy, isInProgress };
