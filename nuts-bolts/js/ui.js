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

const CONFETTI_COLORS = ['#f2b705', '#1f5fa8', '#c24420', '#178a7a', '#7a3fe0', '#e88bc4'];

function isBoltFull(stack) {
  return stack.length === CAP && stack.every((n) => n.color === stack[0].color);
}

// Builds one nut element (outer wrapper + clipped hex face + letter/hidden-mark).
// Shared by the real board render and the fx-layer's flying clones so both stay
// visually identical.
function buildNutEl(nut) {
  const nutEl = document.createElement('div');
  nutEl.className = 'nb-nut';
  const face = document.createElement('div');
  face.className = 'nb-nut-face';
  nutEl.appendChild(face);
  if (nut.hidden) {
    nutEl.dataset.hidden = 'true';
    const mark = document.createElement('span');
    mark.className = 'nb-hidden-mark';
    mark.textContent = '?';
    nutEl.appendChild(mark);
  } else {
    nutEl.dataset.color = nut.color;
    const letter = document.createElement('span');
    letter.className = 'nb-letter';
    letter.textContent = LETTER_MAP[nut.color] || '';
    nutEl.appendChild(letter);
  }
  return nutEl;
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
        <div class="nb-title">
          <span class="nb-eyebrow">Level</span>
          <span class="nb-level-num" data-role="level"></span>
        </div>
        <div class="nb-moves" data-role="moves"></div>
        <button type="button" class="nb-btn nb-btn-icon" data-action="help" aria-label="Help">${ICON_HELP}</button>
      </div>
      <div class="nb-board" data-role="board"></div>
      <div class="nb-fx-layer" data-role="fx-layer"></div>
      <div class="nb-actionbar">
        <button type="button" class="nb-btn nb-btn-icon" data-action="undo" aria-label="Undo">${ICON_UNDO}</button>
        <button type="button" class="nb-btn nb-btn-icon" data-action="restart" aria-label="Restart">${ICON_RESTART}</button>
      </div>
      <div class="nb-toast" role="status" aria-live="polite" data-role="toast">
        <span class="nb-toast-chip" data-role="toast-chip"></span>
        <span data-role="toast-text"></span>
      </div>
      <div class="nb-assist" role="status" aria-live="polite" data-role="assist" hidden></div>
      <div class="nb-overlay" data-role="restart-overlay" hidden>
        <div class="nb-confirm" data-role="restart-confirm">
          <p>Restart this level? Your moves will be lost.</p>
          <div class="nb-panel-actions">
            <button type="button" class="nb-btn" data-action="restart-cancel">Cancel</button>
            <button type="button" class="nb-btn nb-btn-primary" data-action="restart-confirm">Restart</button>
          </div>
        </div>
      </div>
      <div class="nb-overlay" data-role="win-overlay" hidden>
        <div class="nb-panel">
          <div class="nb-win-flash" data-role="win-flash"></div>
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
          <label class="nb-settings-row nb-settings-row-top">
            <span>Show color letters</span>
            <input type="checkbox" data-role="letters-toggle">
          </label>
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
    this.winFlash = root.querySelector('[data-role="win-flash"]');
    this.toastEl = root.querySelector('[data-role="toast"]');
    this.toastChip = root.querySelector('[data-role="toast-chip"]');
    this.toastTextEl = root.querySelector('[data-role="toast-text"]');
    this.assistEl = root.querySelector('[data-role="assist"]');
    this.winOverlay = root.querySelector('[data-role="win-overlay"]');
    this.helpOverlay = root.querySelector('[data-role="help-overlay"]');
    this.restartOverlay = root.querySelector('[data-role="restart-overlay"]');
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
        const nutEl = buildNutEl(nut);
        const lifted = this.game.selected === index && i >= stack.length - run.length;
        if (lifted) nutEl.classList.add('nb-lifted');
        if (i === stack.length - 1) nutEl.classList.add('nb-top-nut');
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
        this.restartOverlay.hidden = false;
        break;
      case 'restart-cancel':
        this.restartOverlay.hidden = true;
        break;
      case 'restart-confirm':
        this.game.restart();
        this._winRecorded = false;
        this.restartOverlay.hidden = true;
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
    const attemptColor = pendingFrom !== null ? getTopRun(this.game.stacks[pendingFrom]).color : null;

    const result = this.game.select(index);
    if (result.reason) {
      const chipColor = result.reason === "Colors don't match" ? attemptColor : null;
      this.showToast(result.reason, chipColor);
      // Shake the bolt just tapped: for a select-time rejection that's the
      // attempted source, for an illegal move attempt it's the destination,
      // so feedback always points at whichever bolt the player just touched.
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
  // the topmost portion of the run, see game.js). The whole group flies as a
  // single clone unit (one wrapper, not one clone per nut) from its old
  // position to where the destination bolt just rendered it: a 300ms
  // lift/arc-travel/drop+squash, purely visual over already-committed state.
  // Destination nuts stay hidden (visibility, not display) until the clone
  // lands so no double image ever shows; this is fire-and-forget, so spam-tap,
  // undo-mid-animation, and reload-mid-animation never wait on it.
  animateMove(preRects, toIndex, count) {
    const moved = preRects.slice(-count);
    if (!moved.length) return;
    const boltEl = this.boardEl.querySelector(`[data-index="${toIndex}"]`);
    if (!boltEl) return;
    const newEls = [...boltEl.querySelectorAll('.nb-nut')].slice(-count);
    if (newEls.length !== moved.length) return;
    const rootRect = this.root.getBoundingClientRect();

    const oldLeft = moved[0].left;
    const oldTop = Math.min(...moved.map((r) => r.top));
    const oldBottom = Math.max(...moved.map((r) => r.top + r.height));
    const width = moved[0].width;
    const height = oldBottom - oldTop;

    const newRects = newEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - rootRect.left, top: r.top - rootRect.top };
    });
    const newLeft = newRects[0].left;
    const newTop = Math.min(...newRects.map((r) => r.top));
    const dx = newLeft - oldLeft;
    const dy = newTop - oldTop;

    newEls.forEach((el) => el.classList.add('nb-fx-hidden'));

    const group = document.createElement('div');
    group.className = 'nb-fx-group';
    group.style.left = `${oldLeft}px`;
    group.style.top = `${oldTop}px`;
    group.style.width = `${width}px`;
    group.style.height = `${height}px`;
    moved.forEach((r) => {
      const nutEl = buildNutEl({ color: r.color, hidden: r.hidden });
      nutEl.style.position = 'absolute';
      nutEl.style.left = '0px';
      nutEl.style.top = `${r.top - oldTop}px`;
      nutEl.style.width = `${r.width}px`;
      nutEl.style.height = `${r.height}px`;
      group.appendChild(nutEl);
    });
    this.fxLayer.appendChild(group);

    // 60ms lift + 120ms arc travel + 80ms drop + 40ms squash = 300ms total.
    const anim = group.animate([
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0, easing: 'ease-out' },
      { transform: 'translate(0px, -12px) scale(1, 1)', offset: 0.2, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 12 - 14}px) scale(1, 1)`, offset: 0.4, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: `translate(${dx}px, ${dy - 12}px) scale(1, 1)`, offset: 0.6, easing: 'cubic-bezier(.34,1.4,.64,1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(1, 1)`, offset: 0.867, easing: 'ease-out' },
      { transform: `translate(${dx}px, ${dy}px) scale(1.06, 0.88)`, offset: 0.933, easing: 'ease-in' },
      { transform: `translate(${dx}px, ${dy}px) scale(1, 1)`, offset: 1 },
    ], { duration: 300, fill: 'forwards' });

    anim.finished.then(() => {
      group.remove();
      newEls.forEach((el) => el.classList.remove('nb-fx-hidden'));
    }).catch(() => {
      group.remove();
      newEls.forEach((el) => el.classList.remove('nb-fx-hidden'));
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

  showToast(text, colorKey) {
    this.toastTextEl.textContent = text;
    this.toastChip.style.background = colorKey ? `var(--nb-${colorKey})` : 'var(--nb-muted)';
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
    if (this.winFlash) {
      this.winFlash.classList.remove('nb-flash-active');
      // eslint-disable-next-line no-unused-expressions
      this.winFlash.offsetWidth; // restart the animation
      this.winFlash.classList.add('nb-flash-active');
    }
  }

  // A single restrained burst, not a persistent effect: capped piece count,
  // fires once per win, cleans itself up after the fall animation ends.
  // transform/opacity only, no per-frame box-shadow/filter, to stay inside
  // the frame budget.
  launchConfetti() {
    if (!this.confettiLayer) return;
    this.confettiLayer.innerHTML = '';
    const pieceCount = 28;
    for (let i = 0; i < pieceCount; i++) {
      const piece = document.createElement('div');
      piece.className = 'nb-confetti-piece';
      piece.style.left = `${(i / pieceCount) * 100 + (Math.random() * 6 - 3)}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = `${Math.random() * 120}ms`;
      piece.style.setProperty('--nb-confetti-rot', `${Math.round(Math.random() * 720)}deg`);
      piece.style.setProperty('--nb-confetti-scale', (0.6 + Math.random() * 0.6).toFixed(2));
      piece.style.setProperty('--nb-confetti-dx', `${Math.round(Math.random() * 120 - 60)}px`);
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
      else groups.push({ label, count: 1, color: nut.hidden ? null : nut.color, hidden: nut.hidden });
    }
    this.assistEl.innerHTML = '';
    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'nb-assist-label';
      empty.textContent = 'Empty bolt';
      this.assistEl.appendChild(empty);
    } else {
      groups.forEach((g, i) => {
        const row = document.createElement('div');
        row.className = 'nb-assist-row';
        const prefix = document.createElement('span');
        prefix.textContent = i === 0 ? 'Top:' : (i === groups.length - 1 && groups.length > 1 ? 'Base:' : '');
        const detail = document.createElement('span');
        detail.className = 'nb-assist-detail';
        const swatch = buildNutEl({ color: g.color, hidden: g.hidden });
        swatch.classList.add('nb-assist-swatch');
        const text = document.createElement('span');
        text.textContent = `${g.label} x${g.count}`;
        detail.append(swatch, text);
        row.append(prefix, detail);
        this.assistEl.appendChild(row);
      });
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
