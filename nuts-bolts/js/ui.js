import { NutsBoltsGame, getTopRun } from './game.js';
import { CAP, PALETTE } from './generator.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordNutsBolts } from '../../js/game-stats.js';

const STORAGE_KEY = 'gamehub.nutsbolts.v1';
const LETTER_MAP = { yellow: 'Y', blue: 'B', orange: 'O', teal: 'T', purple: 'P', pink: 'K', slate: 'S' };
const COLOR_NAME = Object.fromEntries(PALETTE.map((p) => [p.key, p.name]));

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function ensureStylesheet() {
  const href = new URL('../css/nuts-bolts.css', import.meta.url).href;
  const present = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .some((l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/nuts-bolts.css'));
  if (present) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fresh: true, data: { version: 1, level: 1, board: null, settings: { letters: false } } };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.level !== 'number') {
      return { fresh: true, data: { version: 1, level: 1, board: null, settings: { letters: false } } };
    }
    return {
      fresh: false,
      data: {
        version: 1,
        level: parsed.level || 1,
        board: parsed.board || null,
        settings: { letters: !!(parsed.settings && parsed.settings.letters) },
      },
    };
  } catch {
    return { fresh: true, data: { version: 1, level: 1, board: null, settings: { letters: false } } };
  }
}

function saveState(level, game, settings) {
  try {
    const board = game.hasProgress() || game.moves > 0
      ? game.toSaved()
      : null;
    const data = { version: 1, level, board: game.isWon() ? null : board, settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can fail (quota, private mode); the game continues in-memory.
  }
}

class NutsBoltsUI {
  constructor(container) {
    ensureStylesheet();
    this.container = container;
    this.profile = loadProfile();

    const saved = loadSaved();
    this.level = saved.data.level;
    this.settings = saved.data.settings;
    this.game = new NutsBoltsGame(this.level, saved.data.board);
    this._winRecorded = false;   // one stats record per board (see showWin)
    this.showHelpOnStart = saved.fresh;

    this.toastTimer = null;
    this.longPressTimer = null;
    this.longPressStart = null;
    this.longPressBoltIndex = null;
    this.suppressNextClick = false;

    this.onDocPointerUp = this.onDocPointerUp.bind(this);
    this.onDocPointerMove = this.onDocPointerMove.bind(this);

    this.render();
    if (this.showHelpOnStart) this.openHelp();
  }

  persist() {
    saveState(this.level, this.game, this.settings);
  }

  render() {
    this.container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'nb-root' + (this.settings.letters ? ' nb-show-letters' : '');
    root.innerHTML = `
      <div class="nb-topbar">
        <div class="nb-title">Level <span data-role="level"></span></div>
        <div class="nb-moves"><span data-role="moves"></span> moves</div>
        <button type="button" class="nb-btn nb-btn-icon" data-action="undo" aria-label="Undo">&#8617;</button>
        <button type="button" class="nb-btn nb-btn-icon" data-action="restart" aria-label="Restart">&#8635;</button>
        <button type="button" class="nb-btn nb-btn-icon" data-action="help" aria-label="Help">?</button>
      </div>
      <div class="nb-board" data-role="board"></div>
      <div class="nb-toast" role="status" aria-live="polite" data-role="toast"></div>
      <div class="nb-assist" role="status" aria-live="polite" data-role="assist" hidden></div>
      <div class="nb-confirm" data-role="restart-confirm" hidden>
        <p>Restart this level? Your moves will be lost.</p>
        <div class="nb-panel-actions">
          <button type="button" class="nb-btn" data-action="restart-cancel">Cancel</button>
          <button type="button" class="nb-btn nb-btn-primary" data-action="restart-confirm">Restart</button>
        </div>
      </div>
      <div class="nb-overlay" data-role="win-overlay" hidden>
        <div class="nb-panel">
          <h2 data-role="win-title"></h2>
          <p data-role="win-detail"></p>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn nb-btn-primary" data-action="next-level">Next level</button>
          </div>
        </div>
      </div>
      <div class="nb-overlay" data-role="help-overlay" hidden>
        <div class="nb-panel">
          <h2>How to play</h2>
          <div class="nb-help-body">
            <ul>
              <li>Tap a bolt to select its top group of same-colored nuts.</li>
              <li>Tap another bolt to move them there. They only move onto an empty bolt or onto a matching color, and only if there's room.</li>
              <li>Fill each bolt with a single color to complete it. A completed bolt locks.</li>
              <li>Some levels have hidden nuts (shown with a "?"). Their color is revealed once they reach the top.</li>
              <li>Undo is free and unlimited.</li>
              <li>Press and hold a bolt to hear its colors by name.</li>
            </ul>
          </div>
          <label class="nb-settings-row">
            <span>Show color letters</span>
            <input type="checkbox" data-role="letters-toggle">
          </label>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn nb-btn-primary" data-action="close-help">OK</button>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(root);
    this.root = root;
    this.boardEl = root.querySelector('[data-role="board"]');
    this.toastEl = root.querySelector('[data-role="toast"]');
    this.assistEl = root.querySelector('[data-role="assist"]');
    this.winOverlay = root.querySelector('[data-role="win-overlay"]');
    this.helpOverlay = root.querySelector('[data-role="help-overlay"]');
    this.restartConfirm = root.querySelector('[data-role="restart-confirm"]');
    this.lettersToggle = root.querySelector('[data-role="letters-toggle"]');
    this.lettersToggle.checked = this.settings.letters;

    root.addEventListener('click', this.onClick.bind(this));
    this.lettersToggle.addEventListener('change', () => {
      this.settings.letters = this.lettersToggle.checked;
      root.classList.toggle('nb-show-letters', this.settings.letters);
      this.persist();
    });

    this.renderBoard();
    this.updateTopbar();
  }

  updateTopbar() {
    this.root.querySelector('[data-role="level"]').textContent = String(this.level);
    this.root.querySelector('[data-role="moves"]').textContent = String(this.game.moves);
    this.root.querySelector('[data-action="undo"]').disabled = !this.game.canUndo();
  }

  renderBoard() {
    this.boardEl.innerHTML = '';
    this.game.stacks.forEach((stack, index) => {
      const locked = stack.length === CAP && stack.every((n) => n.color === stack[0].color);
      const bolt = document.createElement('div');
      bolt.className = 'nb-bolt' + (locked ? ' nb-locked' : '') + (this.game.selected === index ? ' nb-selected' : '');
      bolt.dataset.index = String(index);
      bolt.setAttribute('role', 'button');
      bolt.setAttribute('tabindex', '0');
      bolt.setAttribute('aria-label', `Bolt ${index + 1}`);
      bolt.innerHTML = '<div class="nb-bolt-rod"></div><div class="nb-bolt-cap"></div><div class="nb-bolt-stack"></div><div class="nb-bolt-badge">&#10003;</div>';
      const stackEl = bolt.querySelector('.nb-bolt-stack');

      const run = this.game.selected === index ? getTopRun(stack) : { length: 0 };
      stack.forEach((nut, i) => {
        const nutEl = document.createElement('div');
        nutEl.className = 'nb-nut';
        const lifted = this.game.selected === index && i >= stack.length - run.length;
        if (lifted) nutEl.classList.add('nb-lifted');
        if (nut.hidden) {
          nutEl.dataset.hidden = 'true';
          nutEl.textContent = '?';
        } else {
          nutEl.dataset.color = nut.color;
          const letter = document.createElement('span');
          letter.className = 'nb-letter';
          letter.textContent = LETTER_MAP[nut.color] || '';
          nutEl.appendChild(letter);
        }
        stackEl.appendChild(nutEl);
      });

      bolt.addEventListener('pointerdown', (e) => this.onBoltPointerDown(e, index));
      this.boardEl.appendChild(bolt);
    });
  }

  onClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      this.handleAction(actionEl.dataset.action);
      return;
    }
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    const bolt = e.target.closest('.nb-bolt');
    if (bolt) this.handleBoltTap(Number(bolt.dataset.index));
  }

  handleAction(action) {
    switch (action) {
      case 'undo':
        if (this.game.undo()) {
          this.persist();
          this.renderBoard();
          this.updateTopbar();
        }
        break;
      case 'restart':
        this.restartConfirm.hidden = false;
        break;
      case 'restart-cancel':
        this.restartConfirm.hidden = true;
        break;
      case 'restart-confirm':
        this.game.restart();
        this._winRecorded = false;
        this.restartConfirm.hidden = true;
        this.persist();
        this.renderBoard();
        this.updateTopbar();
        break;
      case 'help':
        this.openHelp();
        break;
      case 'close-help':
        this.helpOverlay.hidden = true;
        break;
      case 'next-level':
        this.winOverlay.hidden = true;
        this.level += 1;
        this.game = new NutsBoltsGame(this.level, null);
        this._winRecorded = false;
        this.persist();
        this.renderBoard();
        this.updateTopbar();
        break;
      default:
        break;
    }
  }

  openHelp() {
    this.helpOverlay.hidden = false;
  }

  handleBoltTap(index) {
    const result = this.game.select(index);
    if (result.reason) {
      this.showToast(result.reason);
      this.shakeBolt(index);
    }
    if (result.changed) {
      this.renderBoard();
      this.updateTopbar();
      if (result.isMove) this.persist();
      if (result.won) this.showWin();
    }
  }

  shakeBolt(index) {
    const bolt = this.boardEl.querySelector(`[data-index="${index}"]`);
    if (!bolt) return;
    bolt.classList.remove('nb-shake');
    // eslint-disable-next-line no-unused-expressions
    bolt.offsetWidth; // restart the animation
    bolt.classList.add('nb-shake');
  }

  showToast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('nb-toast-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('nb-toast-visible');
    }, 1600);
  }

  showWin() {
    // Record the solve exactly once per level instance. `_winRecorded` resets wherever a new
    // board is started (constructor / restart / next-level), so undoing past the winning move
    // and re-solving the same board cannot double-count. Never break the game over stats.
    if (!this._winRecorded) {
      this._winRecorded = true;
      try { recordNutsBolts(this.level, this.game.moves); } catch { /* ignore */ }
    }
    const name = this.profile && this.profile.name;
    const title = `Level ${this.level} complete`;
    const detail = name ? `Nice one, ${esc(name)}! ${this.game.moves} moves.` : `${this.game.moves} moves.`;
    this.root.querySelector('[data-role="win-title"]').textContent = title;
    this.root.querySelector('[data-role="win-detail"]').innerHTML = detail;
    this.winOverlay.hidden = false;
  }

  // --- Long-press color assist ---

  onBoltPointerDown(e, index) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.longPressStart = { x: e.clientX, y: e.clientY };
    this.longPressBoltIndex = index;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.showAssist(index, e.clientX, e.clientY);
      this.suppressNextClick = true;
      this.longPressTimer = null;
    }, LONG_PRESS_MS);
    document.addEventListener('pointerup', this.onDocPointerUp, { once: true });
    document.addEventListener('pointermove', this.onDocPointerMove);
  }

  onDocPointerMove(e) {
    if (!this.longPressStart) return;
    const dx = e.clientX - this.longPressStart.x;
    const dy = e.clientY - this.longPressStart.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  onDocPointerUp() {
    document.removeEventListener('pointermove', this.onDocPointerMove);
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStart = null;
    this.hideAssist();
  }

  showAssist(index, clientX, clientY) {
    const stack = this.game.stacks[index];
    const groups = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const nut = stack[i];
      const label = nut.hidden ? 'Hidden' : COLOR_NAME[nut.color];
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.count += 1;
      else groups.push({ label, count: 1 });
    }
    if (!groups.length) {
      this.assistEl.innerHTML = '<div class="nb-assist-label">Empty bolt</div>';
    } else {
      this.assistEl.innerHTML = groups
        .map((g, i) => {
          const prefix = i === 0 ? 'Top:' : (i === groups.length - 1 && groups.length > 1 ? 'Base:' : '');
          return `<div class="nb-assist-row"><span>${prefix}</span><span>${esc(g.label)} x${g.count}</span></div>`;
        })
        .join('');
    }
    const rootRect = this.root.getBoundingClientRect();
    this.assistEl.style.left = `${clientX - rootRect.left}px`;
    this.assistEl.style.top = `${clientY - rootRect.top - 20}px`;
    this.assistEl.hidden = false;
  }

  hideAssist() {
    this.assistEl.hidden = true;
  }

  destroy() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.longPressTimer);
    document.removeEventListener('pointerup', this.onDocPointerUp);
    document.removeEventListener('pointermove', this.onDocPointerMove);
    this.container.innerHTML = '';
  }

  isInProgress() {
    return this.game.hasProgress();
  }
}

let instance = null;

export function init(container) {
  if (instance) instance.destroy();
  instance = new NutsBoltsUI(container);
  return instance;
}

export function destroy() {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export function isInProgress() {
  return instance ? instance.isInProgress() : false;
}

export default { init, destroy, isInProgress };
