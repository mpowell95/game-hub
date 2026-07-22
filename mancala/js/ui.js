// ui.js - Mancala UI module. Hub contract:
//   init(container)  - mount the game into a DOM element
//   destroy()        - tear down listeners, timers, and animations
//
// Every stone is a persistent DOM element on an overlay layer above the board.
// Moves physically sow the stones: each one flies pit to pit on an arced path
// (Web Animations API), the receiving pit's cluster re-flows, counts pop as
// stones land, and captures sweep both pits into the mancala. Reduced motion
// (or ?motion=0) snaps to the final layout instead.
//
// Colorblind-safe: the two sides are told apart by position (top vs bottom),
// by name and emoji on the score bar, and by the turn marker, never hue alone.

import {
  P1, P2, P1_STORE, P2_STORE, PITS_PER_SIDE, START_STONES,
  pitsOf, storeOf, ownerOf, isStore,
  newGame, legalMoves, applyMove,
} from './game.js';
import { chooseMove } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';

const SETTINGS_KEY = 'gamehub.mancala.v1';
const GAME_KEY = 'gamehub.mancala.game.v1';   // the one in-progress game (see saveGame)

const LEVELS = [
  { level: 1, key: 'beginner', label: 'Beginner' },
  { level: 2, key: 'intermediate', label: 'Intermediate' },
  { level: 3, key: 'pro', label: 'Pro' },
];
const LEVEL_KEY = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };
// Short difficulty word for the compact in-game chip (the setup screen keeps the
// full Beginner/Intermediate/Pro tier names). These are the same tiers, just the
// space-saving synonym, so the score bar never has to truncate a player's name.
const CHIP_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

// Animation speed. 'slow' doubles every duration/stagger (half speed) for a
// calmer pace over a full game; 'normal' is the default.
const SPEEDS = [
  { key: 'normal', label: 'Normal' },
  { key: 'slow', label: 'Relaxed' },
];

// The bot's default identity. The hub's other games give the AI a real name +
// person avatar rather than "Computer" (Chinchón/Escoba share this exact
// roster); Mancala follows suit. A profile opponent still wins when one is set.
const AI_ROSTER = [
  { name: 'Lucía', emoji: '💃' },
  { name: 'Diego', emoji: '🤠' },
  { name: 'Sofía', emoji: '🎸' },
  { name: 'Mateo', emoji: '🧢' },
  { name: 'Elena', emoji: '🌹' },
];

const SOW_STAGGER_MS = 115;    // launch interval between sown stones
const FLIGHT_MS = 300;         // one stone's pit-to-pit flight
const CAPTURE_STAGGER_MS = 55; // interval between captured stones leaving
const BOT_THINK_MS = 650;      // pause before the bot plays

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureStylesheet() {
  const href = new URL('../css/mancala.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/mancala.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const out = {};
      const lvl = Math.round(Number(raw.level));
      if (lvl >= 1 && lvl <= 3) out.level = lvl;
      if (raw.speed === 'slow' || raw.speed === 'normal') out.speed = raw.speed;
      // Who opens the NEXT new game. Persisted so the alternation survives
      // leaving the game, a reload, or closing the app.
      if (raw.nextStarter === P1 || raw.nextStarter === P2) out.nextStarter = raw.nextStarter;
      return Object.keys(out).length ? out : null;
    }
  } catch { /* treat as no settings */ }
  return null;
}

/** Merge a patch into the stored settings, so no writer clobbers another's field. */
function saveSettings(patch) {
  try {
    const cur = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    const base = (cur && typeof cur === 'object') ? cur : {};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...base, ...patch }));
  } catch { /* ignore */ }
}

/** Persist the in-progress game so leaving (hub, Setup, a reload, or closing the
 *  PWA) never loses it. Only ever holds ONE unfinished game; cleared the moment
 *  it finishes or a new one starts. */
function saveGame(ui) {
  try {
    if (!ui.state || ui.state.over || ui.view !== 'game') { clearGame(); return; }
    localStorage.setItem(GAME_KEY, JSON.stringify({
      v: 1,
      pits: ui.state.pits,
      turn: ui.state.turn,
      mode: ui.mode,
      level: ui.level,
      movesMade: ui.movesMade,
    }));
  } catch { /* a full quota must never break the game */ }
}

/** Read back a saved game, or null. Validates hard: a corrupt or non-standard
 *  board is treated as "no saved game" rather than crashing the module. */
function loadGame() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    if (!raw || raw.v !== 1 || !Array.isArray(raw.pits) || raw.pits.length !== 14) return null;
    const pits = raw.pits.map((n) => Math.round(Number(n)));
    if (!pits.every((n) => Number.isFinite(n) && n >= 0)) return null;
    // A standard Kalah board always holds exactly 6*2*4 = 48 stones.
    if (pits.reduce((a, b) => a + b, 0) !== PITS_PER_SIDE * 2 * START_STONES) return null;
    const lvl = Math.round(Number(raw.level));
    return {
      pits,
      turn: raw.turn === P2 ? P2 : P1,
      mode: raw.mode === 'friend' ? 'friend' : 'bot',
      level: lvl >= 1 && lvl <= 3 ? lvl : 2,
      movesMade: Math.max(0, Math.round(Number(raw.movesMade)) || 0),
    };
  } catch { return null; }
}

function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch { /* ignore */ } }

/** Small deterministic hash for per-stone jitter (stable across re-layouts). */
function hash(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Cluster offsets (unit circle) for n stones in a round pit, slot k. */
function pitSlot(k, n) {
  if (n <= 1) return [0, 0];
  if (n === 2) return [[-0.4, -0.1], [0.4, 0.1]][k];
  if (n === 3) return [[0, -0.45], [-0.42, 0.28], [0.42, 0.28]][k];
  if (n === 4) return [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]][k];
  if (n === 5) return [[-0.45, -0.45], [0.45, -0.45], [0, 0], [-0.45, 0.45], [0.45, 0.45]][k];
  if (n <= 7) {
    if (k === 6) return [0, 0];
    const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * 0.55, Math.sin(a) * 0.55];
  }
  // 8+: outer ring of 8, then an inner ring.
  if (k < 8) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * 0.62, Math.sin(a) * 0.62];
  }
  const a = ((k - 8) / Math.max(1, Math.min(n - 8, 5))) * Math.PI * 2 + 0.6;
  return [Math.cos(a) * 0.28, Math.sin(a) * 0.28];
}

class MancalaUI {
  constructor(container) {
    this.container = container;

    // Identity + difficulty prefill. Precedence: this game's own last-used
    // settings, then the shared profile, then built-in defaults.
    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const saved = loadSettings();
    this.level = (saved && saved.level) || (opp && opp.skill) || 2;
    // Animation speed: 'normal' (default) or 'slow' (half speed). speedFactor
    // multiplies every animation duration/stagger in the move sequence.
    this.speed = (saved && saved.speed) || 'normal';
    this.speedFactor = this.speed === 'slow' ? 2 : 1;
    // The opening move alternates game to game (you, then the opponent, then you
    // ...), on every difficulty and in both modes. Very first game: you open.
    this.nextStarter = (saved && saved.nextStarter != null) ? saved.nextStarter : P1;
    this.hasProfileName = !!(profile && profile.name);
    this.humanName = (profile && profile.name) || 'You';
    this.humanEmoji = (profile && profile.emoji) || '🙂';
    // A profile opponent wins; otherwise the bot is a named character from the
    // shared roster (a random one per session, so the opponent varies game to game).
    const cast = AI_ROSTER[Math.floor(Math.random() * AI_ROSTER.length)];
    this.botName = (opp && opp.name) || cast.name;
    this.botEmoji = (opp && opp.emoji) || cast.emoji;

    this.mode = 'bot';
    this.view = 'setup';
    this.state = null;
    this.busy = false;
    this.movesMade = 0;
    this.gen = 0;             // bumped on every teardown; async sequences bail out
    this.timers = [];
    this.anims = new Set();
    this.stones = [];         // [{ id, el, pit, scale, rot }]
    this.pitEls = [];
    this.countEls = [];
    this.resizeObs = null;

    const params = new URLSearchParams(location.search);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // ?motion=1 forces animation on (dev aid); ?motion=0 forces it off.
    this.motionOK = params.get('motion') === '1' ? true
      : params.get('motion') === '0' ? false : !reduced;

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };
    // Belt and braces with the board ResizeObserver: some embedded browsers
    // never deliver RO callbacks, and rotation always fires window resize.
    // Re-place twice: right away, and again once the media-query relayout has
    // settled (the event can fire before the new grid geometry is final).
    this._onResize = () => {
      if (this.view !== 'game') return;
      this.placeAllStones(false);
      clearTimeout(this._resizeSettle);
      this._resizeSettle = setTimeout(() => this.placeAllStones(false), 140);
    };

    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);

    // Come back to exactly where you left off: an unfinished game (from the hub
    // back button, the Setup screen, a reload, or closing the PWA) resumes
    // straight onto the board. Otherwise start at setup.
    const inProgress = loadGame();
    if (inProgress) this.resumeGame(inProgress); else this.renderSetup();
  }

  // --- lifecycle -------------------------------------------------------------

  destroy() {
    // Leaving mid-game keeps the board. If a move is still animating, `this.state`
    // is the position BEFORE it (playMove only commits at the end), so the worst
    // case is that the in-flight move is rolled back, never a half-applied board.
    saveGame(this);
    this.gen += 1;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const a of this.anims) { try { a.cancel(); } catch { /* ignore */ } }
    this.anims.clear();
    if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._resizeSettle);
    this.container.innerHTML = '';
    this.state = null;
    this.stones = [];
  }

  inProgress() {
    return this.view === 'game' && !!this.state && !this.state.over && this.movesMade > 0;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  sleep(ms) { return new Promise((res) => this.later(res, ms)); }

  // --- setup view ------------------------------------------------------------

  renderSetup() {
    this.gen += 1;
    if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
    this.view = 'setup';
    this.state = null;
    this.busy = false;
    this.stones = [];
    // Coming here from a live game (e.g. to change the speed) must not lose it:
    // the saved game is still on disk, so offer to go straight back to it.
    const paused = !!loadGame();
    this.container.innerHTML = `
      <div class="mancala">
        <div class="mc-shell mc-setup">
          <div class="mc-logo" aria-hidden="true">
            <span class="mc-logo-store mc-logo-store--p2"></span>
            <span class="mc-logo-pits">
              ${Array.from({ length: 6 }, (_, i) => `<span class="mc-logo-pit" data-lp="${i}"></span>`).join('')}
            </span>
            <span class="mc-logo-store mc-logo-store--p1"></span>
          </div>
          <h2 class="mc-title">Mancala</h2>
          <p class="mc-sub">Sow stones counterclockwise. Bank the most in your mancala.</p>

          <div class="mc-vscard">
            <div class="mc-vsside">
              <span class="mc-vsemoji">${esc(this.humanEmoji)}</span>
              <span class="mc-vsname">${esc(this.humanName)}</span>
            </div>
            <span class="mc-vslabel">vs</span>
            <div class="mc-vsside" data-role="vs-opp">
              <span class="mc-vsemoji">${esc(this.botEmoji)}</span>
              <span class="mc-vsname">${esc(this.botName)}</span>
            </div>
          </div>

          <div class="mc-field">
            <span class="mc-fieldlabel" id="mc-difflabel">Difficulty</span>
            <div class="mc-seg" role="radiogroup" aria-labelledby="mc-difflabel">
              ${LEVELS.map((l) => `
                <button type="button" class="mc-segbtn${l.level === this.level ? ' is-active' : ''}"
                  data-action="level" data-level="${l.level}" role="radio"
                  aria-checked="${l.level === this.level}">${l.label}</button>`).join('')}
            </div>
          </div>

          <div class="mc-field">
            <span class="mc-fieldlabel" id="mc-speedlabel">Animation speed</span>
            <div class="mc-seg" role="radiogroup" aria-labelledby="mc-speedlabel">
              ${SPEEDS.map((s) => `
                <button type="button" class="mc-segbtn${s.key === this.speed ? ' is-active' : ''}"
                  data-action="speed" data-speed="${s.key}" role="radio"
                  aria-checked="${s.key === this.speed}">${s.label}</button>`).join('')}
            </div>
          </div>

          ${paused ? `
          <button type="button" class="mc-primary" data-action="resume">Resume game</button>
          <p class="mc-resumenote">Starting a new game below ends it.</p>` : ''}
          <button type="button" class="${paused ? 'mc-secondary' : 'mc-primary'}" data-action="start-bot">Play vs ${esc(this.botName)}</button>
          <button type="button" class="mc-secondary" data-action="start-friend">Two players</button>
          <button type="button" class="mc-ghost" data-action="help">How to play</button>
        </div>
      </div>`;
  }

  // --- game view -------------------------------------------------------------

  names() {
    if (this.mode === 'bot') {
      return {
        p1: { name: this.humanName, emoji: this.humanEmoji },
        p2: { name: this.botName, emoji: this.botEmoji },
      };
    }
    return {
      p1: { name: this.hasProfileName ? this.humanName : 'Player 1', emoji: this.humanEmoji },
      p2: { name: 'Player 2', emoji: '👥' },
    };
  }

  startGame(mode) {
    this.gen += 1;
    this.mode = mode;
    // Alternate the opening move every new game (including Restart and Play
    // again), then bank the flip immediately so it survives leaving mid-game.
    const starter = this.nextStarter === P2 ? P2 : P1;
    this.nextStarter = starter === P1 ? P2 : P1;
    this.persistSettings();
    clearGame();                 // a new game replaces any saved one
    this.state = newGame(starter);
    this.view = 'game';
    this.busy = false;
    this.movesMade = 0;
    this.renderGame();
    saveGame(this);
    // Say who opens. Without this the alternation is invisible: the opponent's
    // opening move just appears, and a game you open looks identical to one
    // where the turn never alternated.
    const n = this.names();
    this.toast(starter === P1 && this.mode === 'bot' ? 'You start' : `${n[starter === P1 ? 'p1' : 'p2'].name} starts`);
    // When the opponent opens, hand them the first move.
    if (this.mode === 'bot' && starter === P2) this.botTurn();
  }

  /** Write level, speed and the alternating starter back to the settings store. */
  persistSettings() {
    saveSettings({ level: this.level, speed: this.speed, nextStarter: this.nextStarter });
  }

  /** Rebuild the board from a saved game and hand the turn back to whoever had it. */
  resumeGame(saved) {
    this.gen += 1;
    this.mode = saved.mode;
    this.level = saved.level;
    this.state = { pits: saved.pits.slice(), turn: saved.turn, over: false, winner: null };
    this.view = 'game';
    this.busy = false;
    this.movesMade = saved.movesMade;
    this.renderGame();
    // If we left while the bot was on move, it picks up where it left off.
    if (this.mode === 'bot' && this.state.turn === P2) this.botTurn();
  }

  renderGame() {
    const n = this.names();
    const chip = this.mode === 'bot' ? CHIP_LABEL[this.level] : '2 Players';

    // Portrait sow order runs up the right column and down the left, so the
    // right column lists P2's pits bottom-up and the left column P1's top-down.
    const pitBtn = (i) => `
      <button type="button" class="mc-pit mc-pit--${ownerOf(i) === P1 ? 'p1' : 'p2'}"
        data-pit="${i}" style="grid-area:p${i}" aria-label="Pit">
        <span class="mc-hole"></span>
        <span class="mc-count"><b class="mc-countnum" data-role="count-${i}">0</b></span>
      </button>`;

    this.container.innerHTML = `
      <div class="mancala" data-turn="p1">
        <div class="mc-shell mc-game">
          <div class="mc-boardwrap">
            <!-- Opponent identity sits with their mancala (the top store). -->
            <div class="mc-id mc-id--opp" data-role="id-p2">
              <span class="mc-id-emoji">${esc(n.p2.emoji)}</span>
              <span class="mc-id-name">${esc(n.p2.name)}</span>
              <span class="mc-id-chip">${esc(chip)}</span>
            </div>
            <div class="mc-board" data-role="board">
              <div class="mc-store mc-store--p2" style="grid-area:s13" data-pit="13">
                <span class="mc-storecount"><b class="mc-countnum" data-role="count-13">0</b></span>
              </div>
              ${[12, 11, 10, 9, 8, 7, 0, 1, 2, 3, 4, 5].map(pitBtn).join('')}
              <div class="mc-store mc-store--p1" style="grid-area:s6" data-pit="6">
                <span class="mc-storecount"><b class="mc-countnum" data-role="count-6">0</b></span>
              </div>
              <div class="mc-stones" data-role="stones" aria-hidden="true"></div>
              <div class="mc-think" data-role="think" hidden>
                <span>${esc(n.p2.name)} thinking</span><span class="mc-dots"><i></i><i></i><i></i></span>
              </div>
              <div class="mc-toast" data-role="toast" hidden></div>
            </div>
            <!-- Your identity sits with your mancala (the bottom store). -->
            <div class="mc-id mc-id--you" data-role="id-p1">
              <span class="mc-id-emoji">${esc(n.p1.emoji)}</span>
              <span class="mc-id-name">${esc(n.p1.name)}</span>
            </div>
          </div>

          <p class="mc-status" data-role="status" aria-live="polite"></p>

          <footer class="mc-bar">
            <button type="button" class="mc-ghost mc-small" data-action="help">Help</button>
            <!-- Speed is togglable IN the game: changing it used to mean going out
                 to Setup, which threw the match away. Applies to the next move. -->
            <button type="button" class="mc-ghost mc-small" data-action="speed-toggle"
              data-role="speedbtn" aria-label="Animation speed">${this.speed === 'slow' ? '½&times;' : '1&times;'}</button>
            <button type="button" class="mc-ghost mc-small" data-action="restart">Restart</button>
            <button type="button" class="mc-ghost mc-small" data-action="newgame">Setup</button>
          </footer>
        </div>
      </div>`;

    const board = this.container.querySelector('[data-role="board"]');
    this.boardEl = board;
    this.stonesEl = this.container.querySelector('[data-role="stones"]');
    this.pitEls = [];
    this.countEls = [];
    for (let i = 0; i < 14; i++) {
      this.pitEls[i] = board.querySelector(`[data-pit="${i}"]`);
      this.countEls[i] = board.querySelector(`[data-role="count-${i}"]`);
    }

    this.spawnStones();
    this.resizeObs = new ResizeObserver(() => this.placeAllStones(false));
    this.resizeObs.observe(board);
    this.refresh();
  }

  // --- stones ----------------------------------------------------------------

  spawnStones() {
    this.stonesEl.innerHTML = '';
    this.stones = [];
    let id = 0;
    for (let pit = 0; pit < 14; pit++) {
      for (let k = 0; k < this.state.pits[pit]; k++) {
        const el = document.createElement('span');
        el.className = 'mc-stone';
        const stone = {
          id, el, pit,
          scale: 0.9 + hash(id * 7 + 1) * 0.25,
          rot: (hash(id * 13 + 5) - 0.5) * 40,
        };
        el.dataset.tone = String(id % 3);
        this.stonesEl.appendChild(el);
        this.stones.push(stone);
        id += 1;
      }
    }
    this.nextStoneId = id;
    this.placeAllStones(false);
  }

  stonesIn(pit) { return this.stones.filter((s) => s.pit === pit); }

  /** Target transform for a stone at slot k of n in its pit. */
  posFor(stone, pit, k, n) {
    const el = this.pitEls[pit];
    const stoneSize = this.stoneSize || 13;
    const half = stoneSize / 2;
    let x; let y;
    if (isStore(pit)) {
      const w = el.offsetWidth; const h = el.offsetHeight;
      const pad = stoneSize * 0.9;
      const innerW = Math.max(1, w - pad * 2); const innerH = Math.max(1, h - pad * 2);
      const sp = stoneSize * 0.95;
      const cols = Math.max(1, Math.floor(innerW / sp));
      const rows = Math.max(1, Math.floor(innerH / sp));
      const col = k % cols; const row = Math.floor(k / cols) % rows;
      const usedCols = Math.min(n, cols); const usedRows = Math.min(Math.ceil(n / cols), rows);
      x = el.offsetLeft + pad + (innerW - (usedCols - 1) * sp) / 2 + col * sp - half;
      y = el.offsetTop + pad + (innerH - (usedRows - 1) * sp) / 2 + row * sp - half;
      x += (hash(stone.id * 3 + pit) - 0.5) * 5;
      y += (hash(stone.id * 5 + pit) - 0.5) * 5;
    } else {
      const cx = el.offsetLeft + el.offsetWidth / 2;
      const cy = el.offsetTop + el.offsetHeight / 2;
      const hole = el.querySelector('.mc-hole');
      const R = ((hole ? hole.offsetWidth : el.offsetWidth) / 2) - half - 3;
      const [ux, uy] = pitSlot(k, n);
      x = cx + ux * R + (hash(stone.id * 3 + pit) - 0.5) * 3 - half;
      y = cy + uy * R + (hash(stone.id * 5 + pit) - 0.5) * 3 - half;
    }
    return { x, y, t: `translate(${x}px, ${y}px) rotate(${stone.rot}deg) scale(${stone.scale})` };
  }

  /** Re-place every stone from state (no flight). `settle`: animate the nudge. */
  placeAllStones(settle) {
    if (!this.boardEl || !this.state) return;
    const hole = this.boardEl.querySelector('.mc-hole');
    this.stoneSize = hole ? Math.max(10, Math.min(17, Math.round(hole.offsetWidth * 0.24))) : 13;
    this.stonesEl.style.setProperty('--mc-stone', this.stoneSize + 'px');
    for (let pit = 0; pit < 14; pit++) {
      const list = this.stonesIn(pit);
      list.forEach((s, k) => {
        if (!settle) s.el.classList.add('mc-nomove');
        s.el.style.transform = this.posFor(s, pit, k, list.length).t;
        if (!settle) {
          // Reflow so the transform applies without a transition, then re-enable.
          void s.el.offsetWidth;
          s.el.classList.remove('mc-nomove');
        }
      });
    }
  }

  /** Nudge one pit's cluster into its n-stone arrangement (smooth CSS transition). */
  settlePit(pit) {
    const list = this.stonesIn(pit);
    list.forEach((s, k) => { s.el.style.transform = this.posFor(s, pit, k, list.length).t; });
  }

  /** Fly one stone to `pit` on an arc. Resolves when it lands. */
  flyStone(stone, pit, ms) {
    const list = this.stonesIn(pit);
    const from = stone.el.style.transform;
    const dest = this.posFor(stone, pit, list.length, list.length + 1);
    stone.pit = pit;
    if (!this.motionOK) { stone.el.style.transform = dest.t; return Promise.resolve(); }

    // Arc: raise the midpoint above the straight line, scale up in flight.
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(from);
    const x0 = m ? parseFloat(m[1]) : dest.x; const y0 = m ? parseFloat(m[2]) : dest.y;
    const dist = Math.hypot(dest.x - x0, dest.y - y0);
    const lift = Math.max(16, Math.min(56, dist * 0.3));
    const midX = (x0 + dest.x) / 2; const midY = Math.min(y0, dest.y) - lift;
    stone.el.classList.add('mc-nomove', 'is-flying');
    const anim = stone.el.animate([
      { transform: from },
      { transform: `translate(${midX}px, ${midY}px) rotate(${stone.rot + 24}deg) scale(${stone.scale * 1.28})`, offset: 0.5 },
      { transform: dest.t },
    ], { duration: ms, easing: 'cubic-bezier(0.33, 0.05, 0.35, 1)' });
    this.anims.add(anim);
    // Race a timeout so a throttled or hidden tab can never stall the move
    // sequence: if the animation clock is frozen, land the stone anyway.
    const landed = Promise.race([
      anim.finished.catch(() => {}),
      new Promise((res) => this.later(res, ms + 500)),
    ]);
    return landed.then(() => {
      this.anims.delete(anim);
      try { anim.cancel(); } catch { /* already finished */ }
      stone.el.style.transform = dest.t;
      stone.el.classList.remove('is-flying');
      void stone.el.offsetWidth;
      stone.el.classList.remove('mc-nomove');
    });
  }

  // --- HUD -------------------------------------------------------------------

  setCount(pit, value, pop) {
    const el = this.countEls[pit];
    if (!el) return;
    el.textContent = value;
    if (pop && this.motionOK) {
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
    }
    // The mancala stores ARE the score display now (centered plaques), so there
    // is no separate scoreboard number to mirror.
  }

  /** Sync counts, turn highlight, and pit affordances from the engine. */
  refresh() {
    const s = this.state;
    for (let i = 0; i < 14; i++) this.setCount(i, s.pits[i], false);
    const root = this.container.querySelector('.mancala');
    if (root) root.dataset.turn = s.turn === P1 ? 'p1' : 'p2';
    this.container.querySelector('[data-role="id-p1"]').classList.toggle('is-turn', !s.over && s.turn === P1);
    this.container.querySelector('[data-role="id-p2"]').classList.toggle('is-turn', !s.over && s.turn === P2);
    const live = new Set(!s.over && !this.busy ? legalMoves(s) : []);
    const humanTurn = this.mode === 'friend' || s.turn === P1;
    for (let i = 0; i < 14; i++) {
      const el = this.pitEls[i];
      if (!el || isStore(i)) continue;
      el.classList.toggle('is-live', humanTurn && live.has(i));
      el.disabled = !humanTurn || !live.has(i);
    }
    this.setStatus(s.over ? '' : humanTurn
      ? (this.mode === 'friend' ? `${esc(this.names()[s.turn === P1 ? 'p1' : 'p2'].name)}'s turn` : 'Your turn')
      : '');
  }

  setStatus(html) {
    const el = this.container.querySelector('[data-role="status"]');
    if (el) el.innerHTML = html;
  }

  toast(text) {
    const el = this.container.querySelector('[data-role="toast"]');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;
    el.classList.add('is-in');
    this.later(() => { el.hidden = true; }, 1400);
  }

  showThinking(on) {
    const el = this.container.querySelector('[data-role="think"]');
    if (el) el.hidden = !on;
  }

  // --- move sequencing -------------------------------------------------------

  async playMove(pit) {
    const gen = this.gen;
    const SF = this.speedFactor;   // 1 = normal, 2 = relaxed (half speed)
    const result = applyMove(this.state, pit);
    if (!result) return;
    const { state: next, events } = result;
    this.busy = true;
    this.movesMade += 1;
    for (const el of this.pitEls) { if (el && !isStore(Number(el.dataset.pit))) { el.classList.remove('is-live'); el.disabled = true; } }

    // Running per-pit counts so numbers tick as stones land.
    const counts = this.state.pits.slice();
    const moving = this.stonesIn(pit);
    counts[pit] = 0;
    this.setCount(pit, 0, false);

    if (!this.motionOK) {
      this.state = next;
      this.finishMove(events, gen);
      return;
    }

    // Lift the handful, then sow: one stone per target pit, staggered.
    for (const s of moving) s.el.classList.add('is-held');
    await this.sleep(140 * SF);
    if (gen !== this.gen) return;

    const flights = moving.map((s, k) => new Promise((res) => {
      this.later(() => {
        if (gen !== this.gen) { res(); return; }
        s.el.classList.remove('is-held');
        const target = events.path[k];
        this.flyStone(s, target, FLIGHT_MS * SF).then(() => {
          if (gen !== this.gen) { res(); return; }
          counts[target] += 1;
          this.setCount(target, counts[target], true);
          this.pulsePit(target);
          res();
        });
      }, k * SOW_STAGGER_MS * SF);
    }));
    await Promise.all(flights);
    if (gen !== this.gen) return;

    // Capture: the landing stone plus the opposite pit sweep into the store.
    if (events.capture) {
      await this.sleep(230 * SF);
      if (gen !== this.gen) return;
      const grabbed = [...this.stonesIn(events.capture.pit), ...this.stonesIn(events.capture.opposite)];
      this.setCount(events.capture.pit, 0, false);
      this.setCount(events.capture.opposite, 0, false);
      let landed = counts[events.capture.store];
      await Promise.all(grabbed.map((s, k) => new Promise((res) => {
        this.later(() => {
          if (gen !== this.gen) { res(); return; }
          this.flyStone(s, events.capture.store, (FLIGHT_MS + 60) * SF).then(() => {
            if (gen !== this.gen) { res(); return; }
            landed += 1;
            this.setCount(events.capture.store, landed, true);
            res();
          });
        }, k * CAPTURE_STAGGER_MS * SF);
      })));
      if (gen !== this.gen) return;
      this.toast(`+${events.capture.count}`);
    }

    // End of game: the side with stones left sweeps them home.
    if (events.sweep) {
      await this.sleep(320 * SF);
      if (gen !== this.gen) return;
      const swept = events.sweep.pits.flatMap((p) => {
        this.setCount(p, 0, false);
        return this.stonesIn(p);
      });
      let landed = counts[events.sweep.store] + (events.capture && events.capture.store === events.sweep.store ? events.capture.count : 0);
      await Promise.all(swept.map((s, k) => new Promise((res) => {
        this.later(() => {
          if (gen !== this.gen) { res(); return; }
          this.flyStone(s, events.sweep.store, (FLIGHT_MS + 60) * SF).then(() => {
            if (gen !== this.gen) { res(); return; }
            landed += 1;
            this.setCount(events.sweep.store, landed, true);
            res();
          });
        }, k * CAPTURE_STAGGER_MS * SF);
      })));
      if (gen !== this.gen) return;
    }

    this.state = next;
    this.finishMove(events, gen);
  }

  pulsePit(pit) {
    const el = this.pitEls[pit];
    if (!el || !this.motionOK) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }

  /** Reassign stone objects to pits so sprite clusters match the engine state.
   *  The animated path keeps them in sync stone by stone (flyStone); this is
   *  for the reduced-motion path, which skips the flights entirely. */
  syncStonesToState() {
    if (!this.state) return;
    const pool = [];
    for (let pit = 0; pit < 14; pit++) {
      const list = this.stonesIn(pit);
      for (let i = this.state.pits[pit]; i < list.length; i++) {
        list[i].pit = -1;
        pool.push(list[i]);
      }
    }
    for (let pit = 0; pit < 14; pit++) {
      let have = this.stonesIn(pit).length;
      while (have < this.state.pits[pit] && pool.length) {
        pool.pop().pit = pit;
        have += 1;
      }
    }
  }

  finishMove(events, gen) {
    if (gen !== this.gen) return;
    this.busy = false;
    if (!this.motionOK) { this.syncStonesToState(); this.placeAllStones(false); }
    this.refresh();
    saveGame(this);   // checkpoint after every settled move (clears itself once over)

    if (events.over) {
      this.later(() => { if (gen === this.gen) this.finish(); }, this.motionOK ? 650 * this.speedFactor : 250);
      return;
    }
    if (events.extraTurn) {
      this.toast('Extra turn');
      this.pulseStore(storeOf(this.state.turn));
    }
    if (this.mode === 'bot' && this.state.turn === P2) this.botTurn();
  }

  pulseStore(pit) {
    const el = this.pitEls[pit];
    if (!el || !this.motionOK) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }

  botTurn() {
    const gen = this.gen;
    this.busy = true;
    this.later(() => { if (gen === this.gen && this.busy) this.showThinking(true); }, 220);
    this.later(() => {
      if (gen !== this.gen) return;
      const pit = chooseMove(this.state, this.level);
      this.showThinking(false);
      if (pit == null) { this.busy = false; this.refresh(); return; }
      this.playMove(pit);
    }, BOT_THINK_MS);
  }

  // --- end of game -----------------------------------------------------------

  finish() {
    const s = this.state;
    const n = this.names();
    const won = s.winner === P1 ? true : s.winner === P2 ? false : null;
    if (this.mode === 'bot') {
      try { recordResult('mancala', LEVEL_KEY[this.level], won); } catch { /* never block the result */ }
    }
    const title = this.mode === 'friend'
      ? (won === null ? 'Draw' : `${esc(n[won ? 'p1' : 'p2'].name)} wins!`)
      : (won === true ? 'You win!' : won === false ? `${esc(n.p2.name)} wins` : 'Draw');
    const overlay = document.createElement('div');
    overlay.className = 'mc-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="mc-scrim"></div>
      <div class="mc-card" role="dialog" aria-modal="true" aria-label="Game over">
        <button type="button" class="mc-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <span class="mc-card-emoji">${won === true ? '🏆' : won === false ? esc(n.p2.emoji) : '🤝'}</span>
        <h3 class="mc-card-title">${title}</h3>
        <p class="mc-card-score">
          <span>${esc(n.p1.name)} <b>${s.pits[P1_STORE]}</b></span>
          <span class="mc-card-dash">:</span>
          <span><b>${s.pits[P2_STORE]}</b> ${esc(n.p2.name)}</span>
        </p>
        <div class="mc-card-actions">
          <button type="button" class="mc-primary" data-action="rematch">Play again</button>
          <button type="button" class="mc-ghost" data-action="newgame">Change setup</button>
          <button type="button" class="mc-ghost mc-small" data-action="close-overlay">View board</button>
        </div>
      </div>`;
    this.container.querySelector('.mancala').appendChild(overlay);
  }

  // --- how to play -----------------------------------------------------------

  openHelp() {
    this.closeOverlays();
    const oppName = this.mode === 'friend' ? 'your opponent' : esc(this.botName);
    const overlay = document.createElement('div');
    overlay.className = 'mc-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="mc-scrim" data-action="close-overlay"></div>
      <div class="mc-card mc-help" role="dialog" aria-modal="true" aria-label="How to play">
        <button type="button" class="mc-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <h3 class="mc-card-title">How to play</h3>
        <section>
          <h4>The board</h4>
          <p>Each player has six pits and a mancala (the long tray) that stores every stone they collect. You own the blue side; ${oppName} owns the red side.</p>
        </section>
        <section>
          <h4>Your turn</h4>
          <p>Tap one of your pits. All of its stones are picked up and sown counterclockwise, one per pit, including your own mancala. The opponent's mancala is skipped.</p>
        </section>
        <section>
          <h4>Extra turn</h4>
          <p>If the last stone lands in your mancala, you move again.</p>
        </section>
        <section>
          <h4>Capture</h4>
          <p>If the last stone lands in an empty pit on your side, you win that stone and every stone in the opposite pit.</p>
        </section>
        <section>
          <h4>End of the game</h4>
          <p>The game ends when all six pits on one side are empty. The other player keeps the stones left on their side. Most stones in the mancala wins.</p>
        </section>
      </div>`;
    this.container.querySelector('.mancala').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.mc-overlay').forEach((el) => el.remove());
  }

  // --- events ----------------------------------------------------------------

  onClick(e) {
    const pitBtn = e.target.closest('.mc-pit');
    if (pitBtn && this.container.contains(pitBtn) && this.view === 'game') {
      if (this.busy || !this.state || this.state.over) return;
      const pit = Number(pitBtn.dataset.pit);
      const humanSide = this.mode === 'friend' ? this.state.turn : P1;
      if (ownerOf(pit) !== humanSide || this.state.turn !== humanSide) return;
      if (this.state.pits[pit] === 0) return;
      this.playMove(pit);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.container.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'level') {
      this.level = Number(btn.dataset.level) || 2;
      this.container.querySelectorAll('[data-action="level"]').forEach((el) => {
        const on = Number(el.dataset.level) === this.level;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-checked', String(on));
      });
      this.persistSettings();
    } else if (action === 'speed') {
      this.speed = btn.dataset.speed === 'slow' ? 'slow' : 'normal';
      this.speedFactor = this.speed === 'slow' ? 2 : 1;
      this.container.querySelectorAll('[data-action="speed"]').forEach((el) => {
        const on = el.dataset.speed === this.speed;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-checked', String(on));
      });
      this.persistSettings();
    } else if (action === 'speed-toggle') {
      // In-game toggle: flip the speed and relabel in place. No re-render, so
      // the board and the match are untouched.
      this.speed = this.speed === 'slow' ? 'normal' : 'slow';
      this.speedFactor = this.speed === 'slow' ? 2 : 1;
      const label = this.container.querySelector('[data-role="speedbtn"]');
      if (label) label.innerHTML = this.speed === 'slow' ? '½&times;' : '1&times;';
      this.toast(this.speed === 'slow' ? 'Relaxed' : 'Normal');
      this.persistSettings();
    } else if (action === 'resume') {
      const saved = loadGame();
      if (saved) this.resumeGame(saved); else this.startGame('bot');
    } else if (action === 'start-bot') {
      this.startGame('bot');
    } else if (action === 'start-friend') {
      this.startGame('friend');
    } else if (action === 'rematch') {
      this.closeOverlays();
      this.startGame(this.mode);
    } else if (action === 'restart') {
      this.closeOverlays();
      this.startGame(this.mode);
    } else if (action === 'newgame') {
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
  instance = new MancalaUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** The hub shows a "progress will be lost" confirm when this is true. Mancala
 *  saves an unfinished game on teardown and resumes it on the next mount, so
 *  leaving costs nothing and the warning would be a lie. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
