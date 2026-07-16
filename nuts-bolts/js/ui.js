import { NutsBoltsGame, getTopRun } from './game.js';
import { CAP, PALETTE } from './generator.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordNutsBolts } from '../../js/game-stats.js';

const STORAGE_KEY = 'gamehub.nutsbolts.v1';
const LETTER_MAP = { yellow: 'Y', blue: 'B', orange: 'O', teal: 'T', purple: 'P', pink: 'K', slate: 'S' };
const COLOR_NAME = Object.fromEntries(PALETTE.map((p) => [p.key, p.name]));

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const ICON_RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const ICON_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.6 1.4c0 1.6-2.1 1.9-2.1 3.6"/><path d="M12 17.5v.01"/></svg>';

const CONFETTI_COLORS = ['#f2b705', '#1f5fa8', '#e0532f', '#178a7a', '#7a3fe0', '#e88bc4'];

function isBoltFull(stack) {
  return stack.length === CAP && stack.every((n) => n.color === stack[0].color);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function pluralMoves(n) {
  return `${n} move${n === 1 ? '' : 's'}`;
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
        <div class="nb-moves" data-role="moves"></div>
        <button type="button" class="nb-btn nb-btn-icon" data-action="help" aria-label="Help">${ICON_HELP}</button>
      </div>
      <div class="nb-board" data-role="board"></div>
      <div class="nb-fx-layer" data-role="fx-layer"></div>
      <div class="nb-actionbar">
        <button type="button" class="nb-btn nb-btn-icon" data-action="undo" aria-label="Undo">${ICON_UNDO}</button>
        <button type="button" class="nb-btn nb-btn-icon" data-action="restart" aria-label="Restart">${ICON_RESTART}</button>
      </div>
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
          <div class="nb-confetti-layer" data-role="confetti"></div>
          <h2 data-role="win-title"></h2>
          <p data-role="win-detail"></p>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn nb-btn-primary" data-action="next-level">Next level</button>
          </div>
        </div>
      </div>
      <div class="nb-overlay" data-role="help-overlay" hidden>
        <div class="nb-panel">
          <button type="button" class="nb-panel-close" data-action="close-help" aria-label="Close">&times;</button>
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
    this.fxLayer = root.querySelector('[data-role="fx-layer"]');
    this.confettiLayer = root.querySelector('[data-role="confetti"]');
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
    this.boardEl.classList.add('nb-fade-in');
  }

  updateTopbar(pulseMoves) {
    this.root.querySelector('[data-role="level"]').textContent = String(this.level);
    const movesEl = this.root.querySelector('[data-role="moves"]');
    movesEl.textContent = pluralMoves(this.game.moves);
    if (pulseMoves) {
      movesEl.classList.remove('nb-pulse');
      // eslint-disable-next-line no-unused-expressions
      movesEl.offsetWidth; // restart the animation
      movesEl.classList.add('nb-pulse');
      setTimeout(() => movesEl.classList.remove('nb-pulse'), 180);
    }
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
        if (i === stack.length - 1) nutEl.classList.add('nb-top-nut');
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

      for (let i = stack.length; i < CAP; i++) {
        const ghost = document.createElement('div');
        ghost.className = 'nb-slot-ghost';
        stackEl.appendChild(ghost);
      }

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
    // Capture the pre-move DOM rects before `select()` mutates state, so the
    // move can be replayed as a visible travel animation after re-render.
    const pendingFrom = this.game.selected;
    const preRects = pendingFrom !== null && pendingFrom !== index ? this.captureTopRunRects(pendingFrom) : null;

    const result = this.game.select(index);
    if (result.reason) {
      this.showToast(result.reason);
      this.shakeBolt(index);
    }
    if (result.changed) {
      this.renderBoard();
      this.updateTopbar(result.isMove);
      if (result.isMove) {
        this.persist();
        if (preRects && preRects.length) this.animateMove(preRects, result.to, result.count);
        const destStack = this.game.stacks[result.to];
        if (isBoltFull(destStack)) this.flashCompleted(result.to);
      }
      if (result.won) this.showWin();
    }
  }

  // The topmost run currently visible on `boltIndex`, captured as DOM rects
  // (relative to the root) before the move mutates the model.
  captureTopRunRects(boltIndex) {
    const stack = this.game.stacks[boltIndex];
    const run = getTopRun(stack);
    if (!run.length) return [];
    const boltEl = this.boardEl.querySelector(`[data-index="${boltIndex}"]`);
    if (!boltEl) return [];
    const nutEls = [...boltEl.querySelectorAll('.nb-nut')].slice(-run.length);
    const rootRect = this.root.getBoundingClientRect();
    return nutEls.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - rootRect.left,
        top: r.top - rootRect.top,
        width: r.width,
        height: r.height,
        color: el.dataset.color,
        hidden: el.dataset.hidden === 'true',
      };
    });
  }

  // Only the last `count` captured nuts actually moved (a partial group takes
  // the topmost portion of the run, see game.js). Fly clones from their old
  // position to where the destination bolt just rendered them, arcing up and
  // over like nuts physically sliding off one bolt and onto another.
  animateMove(preRects, toIndex, count) {
    const moved = preRects.slice(-count);
    const boltEl = this.boardEl.querySelector(`[data-index="${toIndex}"]`);
    if (!boltEl) return;
    const newEls = [...boltEl.querySelectorAll('.nb-nut')].slice(-count);
    const rootRect = this.root.getBoundingClientRect();

    newEls.forEach((el, i) => {
      const from = moved[i];
      if (!from) return;
      const to = el.getBoundingClientRect();
      const newLeft = to.left - rootRect.left;
      const newTop = to.top - rootRect.top;
      const dx = newLeft - from.left;
      const dy = newTop - from.top;

      el.classList.add('nb-fx-hidden');

      const clone = document.createElement('div');
      clone.className = 'nb-nut nb-fx-nut';
      if (from.hidden) clone.dataset.hidden = 'true';
      else clone.dataset.color = from.color;
      clone.style.left = `${from.left}px`;
      clone.style.top = `${from.top}px`;
      clone.style.width = `${from.width}px`;
      clone.style.height = `${from.height}px`;
      this.fxLayer.appendChild(clone);

      const anim = clone.animate([
        { transform: 'translate(0px, 0px) rotate(0deg)', easing: 'cubic-bezier(.34,1.56,.64,1)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) rotate(10deg)`, offset: 0.5, easing: 'cubic-bezier(.4,0,.2,1)' },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
      ], { duration: 480, fill: 'forwards' });

      anim.finished.then(() => {
        clone.remove();
        el.classList.remove('nb-fx-hidden');
        el.classList.add('nb-just-landed');
        setTimeout(() => el.classList.remove('nb-just-landed'), 200);
      }).catch(() => {
        clone.remove();
        el.classList.remove('nb-fx-hidden');
      });
    });
  }

  flashCompleted(boltIndex) {
    const boltEl = this.boardEl.querySelector(`[data-index="${boltIndex}"]`);
    if (!boltEl) return;
    boltEl.classList.add('nb-just-completed');
    setTimeout(() => boltEl.classList.remove('nb-just-completed'), 320);
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
    const detail = name ? `Nice one, ${esc(name)}! ${pluralMoves(this.game.moves)}.` : `${pluralMoves(this.game.moves)}.`;
    this.root.querySelector('[data-role="win-title"]').textContent = title;
    this.root.querySelector('[data-role="win-detail"]').innerHTML = detail;
    this.winOverlay.hidden = false;
    this.launchConfetti();
  }

  // A single restrained burst, not a persistent effect: capped piece count,
  // fires once per win, cleans itself up after the fall animation ends.
  launchConfetti() {
    if (!this.confettiLayer) return;
    this.confettiLayer.innerHTML = '';
    const pieceCount = 16;
    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement('div');
      piece.className = 'nb-confetti-piece';
      piece.style.left = `${(i / pieceCount) * 100 + (Math.random() * 6 - 3)}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = `${(i % 5) * 60}ms`;
      this.confettiLayer.appendChild(piece);
    }
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
