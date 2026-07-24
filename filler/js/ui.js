// ui.js - Filler UI module. Hub contract:
//   init(container)  - mount the game into a DOM element
//   destroy()        - tear down listeners and state
//
// Colorblind-safe by construction: every one of the six colors is always
// paired with its own shape glyph (circle, triangle, square, diamond, star,
// cross), on the board tiles, the color buttons, and the HUD swatches, so no
// information is ever carried by hue alone.

import {
  COLS, ROWS, TILES, P1, P2, P1_START, P2_START,
  newGame, legalColors, applyMove, territoryDistances,
} from './game.js';
import { chooseColor } from './ai.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.filler.v1';

// Index order matches the engine's color ids 0..5. `labelKey` doubles as the
// accessible name; it names the shape too, so screen reader output is also
// hue-independent.
const COLOR_META = [
  { key: 'yellow', labelKey: 'color_yellow' },
  { key: 'blue', labelKey: 'color_blue' },
  { key: 'vermilion', labelKey: 'color_vermilion' },
  { key: 'teal', labelKey: 'color_teal' },
  { key: 'purple', labelKey: 'color_purple' },
  { key: 'pink', labelKey: 'color_pink' },
];

const LEVELS = [
  { level: 1, key: 'beginner', labelKey: 'diff_beginner' },
  { level: 2, key: 'intermediate', labelKey: 'diff_intermediate' },
  { level: 3, key: 'pro', labelKey: 'diff_pro' },
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
      const out = {};
      if (lvl >= 1 && lvl <= 3) out.level = lvl;
      // nextStarter: additive field (2026-07-24) - who opens the next game,
      // silently alternated each game. Absent on a fresh install/pre-existing
      // store, which defaults to P1 (the human), matching prior behavior.
      if (raw.nextStarter === P2 || raw.nextStarter === P1) out.nextStarter = raw.nextStarter;
      return Object.keys(out).length ? out : null;
    }
  } catch { /* treat as no settings */ }
  return null;
}

function saveSettings(level, nextStarter) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level, nextStarter })); } catch { /* ignore */ }
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
    // Silently alternate who opens each game (no setup UI for this - see
    // filler/CLAUDE.md). Defaults to P1 (the human) when absent, matching
    // pre-existing behavior for anyone with a pre-alternation settings store.
    this.nextStarter = (saved && saved.nextStarter) || P1;
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
    clearTimeout(this._confirmTimer);
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
    return `<span class="fl-swatch ${cls}" data-color="${color}" role="img" aria-label="${t(COLOR_META[color].labelKey)}"></span>`;
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
          <h2 class="fl-title">${t('title')}</h2>
          <p class="fl-sub">${t('tagline')}</p>

          <div class="fl-vscard">
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.humanEmoji)}</span>
              <span class="fl-vsname">${esc(this.humanName)}</span>
            </div>
            <span class="fl-vslabel">${t('vs')}</span>
            <div class="fl-vsside">
              <span class="fl-vsemoji">${esc(this.oppEmoji)}</span>
              <span class="fl-vsname">${esc(this.oppName)}</span>
            </div>
          </div>

          <div class="fl-field">
            <span class="fl-fieldlabel" id="fl-difflabel">${t('difficulty')}</span>
            <div class="fl-seg" role="radiogroup" aria-labelledby="fl-difflabel">
              ${LEVELS.map((l) => `
                <button type="button" class="fl-segbtn${l.level === this.level ? ' is-active' : ''}"
                  data-action="level" data-level="${l.level}" role="radio"
                  aria-checked="${l.level === this.level}">${diffShapeSVG(tierOf(l.key))}${t(l.labelKey)}</button>`).join('')}
            </div>
          </div>

          <button type="button" class="fl-primary" data-action="start">${t('start')}</button>
          <button type="button" class="fl-ghost" data-action="help">${t('howto')}</button>
        </div>
      </div>`;
  }

  // --- game view -------------------------------------------------------------

  startGame() {
    // Alternate the opening move every new game (including Restart), then
    // bank the flip immediately so it survives leaving mid-game (mirrors
    // mancala/js/ui.js's startGame()). The engine itself always constructs
    // state with P1 to move; when the AI is due to open, we hand it the
    // turn right after construction and kick off its move automatically.
    const starter = this.nextStarter === P2 ? P2 : P1;
    this.nextStarter = starter === P1 ? P2 : P1;
    saveSettings(this.level, this.nextStarter);
    this.state = newGame();
    if (starter === P2) this.state.turn = P2;
    this.view = 'game';
    this.busy = false;
    this.renderGame();
    // When the AI opens, the existing per-turn status line ("{opp} is
    // thinking...") already announces it - no separate banner needed.
    if (starter === P2) this.later(() => this.aiMove(), AI_THINK_MS);
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
                <span class="fl-pcount"><b data-role="count-1">1</b> ${t('tiles_suffix')}</span>
              </span>
              <span data-role="swatch-1">${this.swatchHTML(s.current[P1], 'fl-hudswatch')}</span>
            </div>
            <div class="fl-player fl-p2" data-role="card-2">
              <span data-role="swatch-2">${this.swatchHTML(s.current[P2], 'fl-hudswatch')}</span>
              <span class="fl-pmeta">
                <span class="fl-pname">${esc(this.oppName)}</span>
                <span class="fl-pcount"><b data-role="count-2">1</b> ${t('tiles_suffix')}</span>
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

          <div class="fl-board" role="img" aria-label="${t('board_aria')}" data-role="board">
            ${Array.from({ length: TILES }, (_, i) => `
              <span class="fl-tile" data-i="${i}" data-color="${s.colors[i]}">${
                i === P1_START ? `<span class="fl-flag fl-flag-1">${esc(this.humanEmoji)}</span>`
                : i === P2_START ? `<span class="fl-flag fl-flag-2">${esc(this.oppEmoji)}</span>` : ''
              }</span>`).join('')}
          </div>

          <div class="fl-colors" data-role="colors" aria-label="${t('pick_color_aria')}">
            ${COLOR_META.map((m, i) => `
              <button type="button" class="fl-cbtn" data-action="pick" data-color="${i}"
                aria-label="${t(m.labelKey)}"><span class="fl-hold" data-role="hold-${i}" hidden></span></button>`).join('')}
          </div>

          <footer class="fl-bar">
            <button type="button" class="fl-ghost fl-small" data-action="help">${t('howto')}</button>
            <button type="button" class="fl-ghost fl-small" data-action="restart" data-role="restart">${t('restart_game')}</button>
            <button type="button" class="fl-ghost fl-small" data-action="newgame">${t('new_game')}</button>
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
      ? t('game_over')
      : s.turn === P1 ? t('your_turn') : t('opp_thinking', { opp: this.oppName });

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

    const title = won === true ? t('you_win') : won === false ? t('opp_wins', { opp: esc(this.oppName) }) : t('draw');
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'end';
    overlay.innerHTML = `
      <div class="fl-scrim" data-action="close-overlay"></div>
      <div class="fl-card" role="dialog" aria-modal="true" aria-label="${t('game_over')}">
        <button type="button" class="fl-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <span class="fl-card-emoji">${won === true ? '🏆' : won === false ? esc(this.oppEmoji) : '🤝'}</span>
        <h3 class="fl-card-title">${title}</h3>
        <p class="fl-card-score">
          <span>${esc(this.humanName)} <b>${s.counts[P1]}</b></span>
          <span class="fl-card-dash">:</span>
          <span><b>${s.counts[P2]}</b> ${esc(this.oppName)}</span>
        </p>
        <div class="fl-card-actions">
          <button type="button" class="fl-primary" data-action="rematch">${t('play_again')}</button>
          <button type="button" class="fl-ghost" data-action="newgame">${t('change_difficulty')}</button>
          <button type="button" class="fl-ghost fl-small" data-action="close-overlay">${t('view_board')}</button>
        </div>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  // --- how to play ------------------------------------------------------------
  //
  // Same shape as Tic Tac Toe's how-to-play sheet: one bold goal line, ONE
  // diagram of the single non-obvious mechanic, a plain-word caption, an
  // "X = Y" example, then at most a couple one-sentence bullets.

  /** Two isolated teal tiles touch a blue 2x2 territory (top and right edges);
   *  arrows show them joining the territory on a blue pick. Shape-driven
   *  (triangle/diamond glyphs), color is reinforcement only. */
  _floodDiagram() {
    return `<svg class="fl-diagram" viewBox="0 0 224 224" role="img" aria-label="${t('help_diagram_aria')}">
      <defs>
        <marker id="fl-dg-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fl-accent)"/>
        </marker>
      </defs>
      <g class="fl-dg-tile">
        <rect x="11" y="11" width="46" height="46" rx="6"/><rect x="63" y="11" width="46" height="46" rx="6"/>
        <rect x="115" y="11" width="46" height="46" rx="6"/><rect x="167" y="11" width="46" height="46" rx="6"/>
        <rect x="115" y="63" width="46" height="46" rx="6"/><rect x="167" y="63" width="46" height="46" rx="6"/>
        <rect x="167" y="115" width="46" height="46" rx="6"/>
        <rect x="115" y="167" width="46" height="46" rx="6"/><rect x="167" y="167" width="46" height="46" rx="6"/>
      </g>
      <rect x="63" y="63" width="46" height="46" rx="6" class="fl-dg-teal"/>
      <rect x="11" y="115" width="46" height="46" rx="6" class="fl-dg-blue"/>
      <rect x="63" y="115" width="46" height="46" rx="6" class="fl-dg-blue"/>
      <rect x="11" y="167" width="46" height="46" rx="6" class="fl-dg-blue"/>
      <rect x="63" y="167" width="46" height="46" rx="6" class="fl-dg-blue"/>
      <g class="fl-dg-glyph">
        <path d="M86,74.5 106,101 66,101z"/>
        <path d="M34,138 46,150 22,150z"/>
        <path d="M86,138 98,150 74,150z"/>
        <path d="M34,190 46,202 22,202z"/>
        <path d="M86,190 98,202 74,202z"/>
      </g>
      <path d="M86,105 Q100,118 88,133" class="fl-dg-arrow" marker-end="url(#fl-dg-arrowhead)"/>
      <path d="M65,138 Q40,150 42,163" class="fl-dg-arrow" marker-end="url(#fl-dg-arrowhead)"/>
    </svg>`;
  }

  openHelp() {
    this.closeOverlays();
    const overlay = document.createElement('div');
    overlay.className = 'fl-overlay';
    overlay.dataset.role = 'help';
    overlay.innerHTML = `
      <div class="fl-scrim" data-action="close-overlay"></div>
      <div class="fl-card fl-help" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="fl-x" data-action="close-overlay" aria-label="${t('close')}">&times;</button>
        <h3 class="fl-card-title">${t('howto')}</h3>
        <p class="fl-help-lead">${t('help_lead')}</p>
        <div class="fl-diagram-wrap">${this._floodDiagram()}</div>
        <div class="fl-help-lines">
          <p class="fl-help-caption">${t('help_caption')}</p>
          <p class="fl-help-example">${t('help_example')}</p>
        </div>
        <ul class="fl-help-bullets">
          <li>${t('help_bullet1')}</li>
          <li>${t('help_bullet2')}</li>
        </ul>
      </div>`;
    this.container.querySelector('.filler').appendChild(overlay);
  }

  closeOverlays() {
    this.container.querySelectorAll('.fl-overlay').forEach((el) => el.remove());
  }

  // --- restart confirm guard --------------------------------------------------
  //
  // Same tap-again-to-confirm pattern as connect-four/js/ui.js's
  // confirmDestructive/resetConfirms: a mid-game Restart is destructive (it
  // discards the board in progress), so it needs a second confirming tap.
  // A finished game (or no game at all) restarts immediately, no confirm.

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
    const b = this.container.querySelector('[data-role="restart"]');
    if (b && b.dataset.armed === '1') {
      b.textContent = b.dataset.label;
      b.dataset.armed = '';
      b.classList.remove('is-confirm');
    }
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
    } else if (action === 'restart') {
      this.confirmDestructive(btn, () => this.startGame());
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
