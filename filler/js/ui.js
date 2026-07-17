// ui.js - Filler UI module. Hub contract:
//   init(container)  - mount the game into a DOM element
//   destroy()        - tear down listeners and state
//
// Colorblind-safe by construction: every one of the six colors is always
// paired with its own shape glyph (circle, triangle, square, diamond, star,
// cross), on the board tiles, the color buttons, and the HUD swatches, so no
// information is ever carried by hue alone.

import {
  COLS, ROWS, TILES, MAJORITY, P1, P2, P1_START, P2_START,
  newGame, legalColors, applyMove, territoryDistances,
} from './game.js';
import { chooseColor } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';

const SETTINGS_KEY = 'gamehub.filler.v1';

// Index order matches the engine's color ids 0..5. `label` doubles as the
// accessible name; it names the shape too, so screen reader output is also
// hue-independent.
const COLOR_META = [
  { key: 'yellow', label: 'Yellow circle' },
  { key: 'blue', label: 'Blue triangle' },
  { key: 'vermilion', label: 'Vermilion square' },
  { key: 'teal', label: 'Teal diamond' },
  { key: 'purple', label: 'Purple star' },
  { key: 'pink', label: 'Pink cross' },
];

const LEVELS = [
  { level: 1, key: 'beginner', label: 'Beginner' },
  { level: 2, key: 'intermediate', label: 'Intermediate' },
  { level: 3, key: 'pro', label: 'Pro' },
];
const LEVEL_KEY = { 1: 'beginner', 2: 'intermediate', 3: 'pro' };

const AI_THINK_MS = 550;      // pause before the AI plays, so turns read clearly
const RIPPLE_STEP_MS = 16;    // per-BFS-ring delay of the recolor ripple

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ensureStylesheet() {
  const href = new URL('../css/filler.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/filler.css'));
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
      const lvl = Math.round(Number(raw.level));
      if (lvl >= 1 && lvl <= 3) return { level: lvl };
    }
  } catch { /* treat as no settings */ }
  return null;
}

function saveSettings(level) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level })); } catch { /* ignore */ }
}

class FillerUI {
  constructor(container) {
    this.container = container;

    // Identity + difficulty prefill. Precedence: this game's own last-used
    // settings, then the shared profile, then built-in defaults.
    const profile = loadProfile();
    const opp = profile && profile.opponents && profile.opponents[0];
    const saved = loadSettings();
    this.level = (saved && saved.level) || (opp && opp.skill) || 2;
    this.humanName = (profile && profile.name) || 'You';
    this.humanEmoji = (profile && profile.emoji) || '🙂';
    this.oppName = (opp && opp.name) || 'Computer';
    this.oppEmoji = (opp && opp.emoji) || '🤖';

    this.state = null;
    this.busy = false;        // true while a move animates or the AI thinks
    this.view = 'setup';
    this.tiles = [];          // tile elements by board index
    this.timers = [];
    this.motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._onClick = (e) => this.onClick(e);
    this._onKey = (e) => { if (e.key === 'Escape') this.closeOverlays(); };

    ensureStylesheet();
    this.container.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKey);
    this.renderSetup();
  }

  // --- lifecycle -------------------------------------------------------------

  destroy() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.container.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    this.container.innerHTML = '';
    this.state = null;
  }

  inProgress() {
    return this.view === 'game' && !!this.state && !this.state.over && this.state.moves > 0;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  // --- shared bits -----------------------------------------------------------

  swatchHTML(color, cls = '') {
    return `<span class="fl-swatch ${cls}" data-color="${color}" role="img" aria-label="${COLOR_META[color].label}"></span>`;
  }

  legendHTML() {
    return `<ul class="fl-legend">${COLOR_META.map((m, i) =>
      `<li>${this.swatchHTML(i)}<span>${m.label}</span></li>`).join('')}</ul>`;
  }

  // --- setup view ------------------------------------------------------------

  renderSetup() {
    this.view = 'setup';
    this.state = null;
    this.container.innerHTML = `
      <div class="filler">
        <div class="fl-shell fl-setup">
          <div class="fl-logo" aria-hidden="true">
            ${[0, 2, 4, 1, 3].map((c) => `<span class="fl-swatch fl-logo-tile" data-color="${c}"></span>`).join('')}
          </div>
          <h2 class="fl-title">Filler</h2>
          <p class="fl-sub">Flood the board. Capture the majority.</p>

          <div class="fl-vscard">
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.humanEmoji)}</span>
              <span class="fl-vsname">${esc(this.humanName)}</span>
            </div>
            <span class="fl-vslabel">vs</span>
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.oppEmoji)}</span>
              <span class="fl-vsname">${esc(this.oppName)}</span>
            </div>
          </div>

          <div class="fl-field">
            <span class="fl-fieldlabel" id="fl-difflabel">Difficulty</span>
            <div class="fl-seg" role="radiogroup" aria-labelledby="fl-difflabel">
              ${LEVELS.map((l) => `
                <button type="button" class="fl-segbtn${l.level === this.level ? ' is-active' : ''}"
                  data-action="level" data-level="${l.level}" role="radio"
                  aria-checked="${l.level === this.level}">${l.label}</button>`).join('')}
            </div>
          </div>

          <button type="button" class="fl-primary" data-action="start">Start game</button>
          <button type="button" class="fl-ghost" data-action="help">How to play</button>
        </div>
      </div>`;
  }

  // --- game view -------------------------------------------------------------

  startGame() {
    saveSettings(this.level);
    this.state = newGame();
    this.view = 'game';
    this.busy = false;
    this.renderGame();
  }

  renderGame() {
    const s = this.state;
    this.container.innerHTML = `
      <div class="filler">
        <div class="fl-shell fl-game">
          <header class="fl-hud">
            <div class="fl-player fl-p1" data-role="card-1">
              <span class="fl-pemoji">${esc(this.humanEmoji)}</span>
              <span class="fl-pmeta">
                <span class="fl-pname">${esc(this.humanName)}</span>
                <span class="fl-pcount"><b data-role="count-1">1</b> tiles</span>
              </span>
              <span data-role="swatch-1">${this.swatchHTML(s.current[P1], 'fl-hudswatch')}</span>
            </div>
            <div class="fl-player fl-p2" data-role="card-2">
              <span data-role="swatch-2">${this.swatchHTML(s.current[P2], 'fl-hudswatch')}</span>
              <span class="fl-pmeta">
                <span class="fl-pname">${esc(this.oppName)}</span>
                <span class="fl-pcount"><b data-role="count-2">1</b> tiles</span>
              </span>
              <span class="fl-pemoji">${esc(this.oppEmoji)}</span>
            </div>
          </header>

          <div class="fl-progress" data-role="progress" aria-hidden="true">
            <span class="fl-prog-1" data-role="prog-1"></span>
            <span class="fl-prog-2" data-role="prog-2"></span>
            <span class="fl-prog-mid"></span>
          </div>

          <p class="fl-status" data-role="status" aria-live="polite"></p>

          <div class="fl-board" role="img" aria-label="Filler board" data-role="board">
            ${Array.from({ length: TILES }, (_, i) => `
              <span class="fl-tile" data-i="${i}" data-color="${s.colors[i]}">${
                i === P1_START ? `<span class="fl-flag">${esc(this.humanEmoji)}</span>`
                : i === P2_START ? `<span class="fl-flag">${esc(this.oppEmoji)}</span>` : ''
              }</span>`).join('')}
          </div>

          <div class="fl-colors" data-role="colors" aria-label="Pick a color">
            ${COLOR_META.map((m, i) => `
              <button type="button" class="fl-cbtn" data-action="pick" data-color="${i}"
                aria-label="${m.label}"><span class="fl-hold" data-role="hold-${i}" hidden></span></button>`).join('')}
          </div>

          <footer class="fl-bar">
            <button type="button" class="fl-ghost fl-small" data-action="help">How to play</button>
            <button type="button" class="fl-ghost fl-small" data-action="newgame">New game</button>
          </footer>
        </div>
      </div>`;

    const boardEl = this.container.querySelector('[data-role="board"]');
    this.tiles = [...boardEl.querySelectorAll('.fl-tile')];
    this.refresh();
  }

  /** Sync HUD, progress bar, status line, and button states from the engine. */
  refresh() {
    const s = this.state;
    const q = (sel) => this.container.querySelector(sel);
    q('[data-role="count-1"]').textContent = s.counts[P1];
    q('[data-role="count-2"]').textContent = s.counts[P2];
    q('[data-role="swatch-1"]').innerHTML = this.swatchHTML(s.current[P1], 'fl-hudswatch');
    q('[data-role="swatch-2"]').innerHTML = this.swatchHTML(s.current[P2], 'fl-hudswatch');
    q('[data-role="prog-1"]').style.width = `${(s.counts[P1] / TILES) * 100}%`;
    q('[data-role="prog-2"]').style.width = `${(s.counts[P2] / TILES) * 100}%`;
    q('[data-role="prog-1"]').dataset.color = s.current[P1];
    q('[data-role="prog-2"]').dataset.color = s.current[P2];
    q('[data-role="card-1"]').classList.toggle('is-turn', !s.over && s.turn === P1);
    q('[data-role="card-2"]').classList.toggle('is-turn', !s.over && s.turn === P2);

    const status = q('[data-role="status"]');
    status.textContent = s.over
      ? 'Game over'
      : s.turn === P1 ? 'Your turn: pick a color' : `${this.oppName} is thinking...`;

    for (let i = 0; i < COLOR_META.length; i++) {
      const btn = q(`[data-action="pick"][data-color="${i}"]`);
      const hold = q(`[data-role="hold-${i}"]`);
      const holder = s.current[P1] === i ? P1 : s.current[P2] === i ? P2 : 0;
      const blocked = holder !== 0;
      btn.disabled = blocked || s.over || s.turn !== P1 || this.busy;
      btn.classList.toggle('is-held', blocked);
      hold.hidden = !blocked;
      hold.textContent = holder === P1 ? this.humanEmoji : holder === P2 ? this.oppEmoji : '';
    }
  }

  // --- moves + animation -----------------------------------------------------

  humanMove(color) {
    const s = this.state;
    if (this.busy || !s || s.over || s.turn !== P1) return;
    if (legalColors(s).indexOf(color) < 0) return;
    this.busy = true;
    const captured = applyMove(s, color);
    const rippleMs = this.animateMove(P1, color, captured);
    this.refresh();
    if (s.over) { this.later(() => this.finish(), rippleMs + 350); return; }
    this.later(() => this.aiMove(), rippleMs + AI_THINK_MS);
  }

  aiMove() {
    const s = this.state;
    if (!s || s.over) return;
    const color = chooseColor(s, this.level);
    const captured = applyMove(s, color);
    const rippleMs = this.animateMove(P2, color, captured);
    this.busy = false;
    this.refresh();
    if (s.over) this.later(() => this.finish(), rippleMs + 350);
  }

  /** Recolor the mover's territory with a BFS ripple from their corner; newly
   *  captured tiles get a pop. Returns the ripple's total duration in ms. */
  animateMove(player, color, captured) {
    const s = this.state;
    const dist = territoryDistances(s, player);
    const isNew = new Set(captured);
    let maxD = 0;
    for (let i = 0; i < TILES; i++) {
      if (dist[i] < 0) continue;
      if (dist[i] > maxD) maxD = dist[i];
      const el = this.tiles[i];
      if (this.motionOK) el.style.transitionDelay = `${dist[i] * RIPPLE_STEP_MS}ms`;
      el.dataset.color = color;
      el.classList.toggle('is-owned', true);
      if (isNew.has(i) && this.motionOK) {
        el.style.animationDelay = `${dist[i] * RIPPLE_STEP_MS}ms`;
        el.classList.add('is-pop');
      }
    }
    const total = this.motionOK ? maxD * RIPPLE_STEP_MS + 240 : 0;
    this.later(() => {
      for (const el of this.tiles) {
        el.style.transitionDelay = '';
        el.style.animationDelay = '';
        el.classList.remove('is-pop');
      }
    }, total + 300);
    return total;
  }

  // --- end of game -----------------------------------------------------------

  finish() {
    const s = this.state;
    const won = s.winner === P1 ? true : s.winner === P2 ? false : null;
    try { recordResult('filler', LEVEL_KEY[this.level], won); } catch { /* never block the result */ }

    const title = won === true ? 'You win!' : won === false ? `${esc(this.oppName)} wins` : 'Draw';
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="fl-scrim"></div>
      <div class="fl-card" role="dialog" aria-modal="true" aria-label="Game over">
        <span class="fl-card-emoji">${won === true ? '🏆' : won === false ? esc(this.oppEmoji) : '🤝'}</span>
        <h3 class="fl-card-title">${title}</h3>
        <p class="fl-card-score">
          <span>${esc(this.humanName)} <b>${s.counts[P1]}</b></span>
          <span class="fl-card-dash">:</span>
          <span><b>${s.counts[P2]}</b> ${esc(this.oppName)}</span>
        </p>
        <div class="fl-card-actions">
          <button type="button" class="fl-primary" data-action="rematch">Play again</button>
          <button type="button" class="fl-ghost" data-action="newgame">Change difficulty</button>
          <button type="button" class="fl-ghost fl-small" data-action="close-overlay">View board</button>
        </div>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  // --- how to play -----------------------------------------------------------

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="fl-scrim" data-action="close-overlay"></div>
      <div class="fl-card fl-help" role="dialog" aria-modal="true" aria-label="How to play">
        <button type="button" class="fl-x" data-action="close-overlay" aria-label="Close">&times;</button>
        <h3 class="fl-card-title">How to play</h3>
        <section>
          <h4>Goal</h4>
          <p>Capture more than half of the board: ${MAJORITY} of the ${TILES} tiles.</p>
        </section>
        <section>
          <h4>Setup</h4>
          <p>You start from the top-left tile. ${esc(this.oppName)} starts from the bottom-right tile. You move first.</p>
        </section>
        <section>
          <h4>Your turn</h4>
          <p>Pick one of the six colors. Your whole territory changes to that color, and every tile of that color touching your territory joins it.</p>
        </section>
        <section>
          <h4>Blocked colors</h4>
          <p>You cannot pick your own current color or your opponent's current color, so you always choose from four options. Blocked buttons show who holds that color.</p>
        </section>
        <section>
          <h4>End of the game</h4>
          <p>The game ends when every tile is captured. Whoever holds more tiles wins.</p>
        </section>
        <section>
          <h4>Tips</h4>
          <ul>
            <li>Early on, pick the color that grabs the most tiles.</li>
            <li>Watch where ${esc(this.oppName)} is spreading and pick colors that cut off their path.</li>
            <li>Think a turn or two ahead: a capture now also changes which colors both of you can pick next.</li>
          </ul>
        </section>
        <section>
          <h4>Colors</h4>
          <p>Every color has its own shape, so tiles are never told apart by hue alone.</p>
          ${this.legendHTML()}
        </section>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.fl-overlay').forEach((el) => el.remove());
  }

  // --- events ----------------------------------------------------------------

  onClick(e) {
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
    } else if (action === 'start' || action === 'rematch') {
      this.startGame();
    } else if (action === 'newgame') {
      this.renderSetup();
    } else if (action === 'pick') {
      this.humanMove(Number(btn.dataset.color));
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
  instance = new FillerUI(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

/** The hub asks before navigating away mid-game. */
export function isInProgress() {
  return !!(instance && instance.inProgress());
}

export default { init, destroy, isInProgress };
