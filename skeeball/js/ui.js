// skeeball/js/ui.js - the DOM shell, the swipe, and the hub module contract.
//
// Two screens plus overlays, all mounted into the one container the hub hands us:
//   SETUP  the machine gallery: each cabinet card carries the four records the machine tracks -
//          the top score by ANY player, this player's all-time best, this player's best today,
//          and the last game rolled - plus Play/Resume and How to play.
//   PLAY   the canvas (render.js) under a marquee-style HUD: score, ball pips, the records
//          strip, and the swipe surface that IS the lane.
//   OVER   the finished rack: final score, which records it broke, and the tally - with a close
//          X in the corner (root CLAUDE.md's rule for every end-of-game panel).
//
// This file owns the clock, the storage keys and every listener. The rules live in game.js, the
// machines in boards.js, the solver in physics.js, the pixels in render.js.
//
// isInProgress(): the AUTOSAVE/RESUME meaning of the contract (root CLAUDE.md, "The module
// contract" - Escoba's class, not Ball Run's): it returns FALSE even mid-rack, because leaving
// is lossless. The between-throws state is snapshotted to gamehub.skeeball.save.v1 after every
// settled ball, and the setup screen's Play button becomes "Resume rack" while one is banked. A
// ball actually in flight resolves in under two seconds and is not part of the saved state; the
// throw a player abandons mid-air was theirs to abandon.

import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { Renderer } from './render.js';
import { BOARDS, boardById, unlocksEarned, DEFAULT_BOARD } from './boards.js';
import { howToMarkup } from './howto.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { loadStats, recordSkeeball, unlockSkeeballBoard } from '../../js/game-stats.js';
import { syncMyStats, readPlayersOnce } from '../../js/stats-net.js';
import { aggregatePlayers } from '../../js/players-agg.js';
import { bestOn, todayBestOn, appWideBest, isUnlocked } from '../../js/arcade-scores.js';
import { loadProfile } from '../../js/profile-store.js';

const t = makeT(STRINGS);

const SETTINGS_KEY = 'gamehub.skeeball.v1';   // { board } - a one-tap-recreatable preference
const SAVE_KEY = 'gamehub.skeeball.save.v1';  // the mid-rack snapshot (game.js's shape)

let instance = null;

function ensureCSS() {
  if (document.querySelector('link[data-sk-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../css/skeeball.css', import.meta.url).href;
  link.setAttribute('data-sk-css', '1');
  document.head.appendChild(link);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { board: typeof s.board === 'string' ? s.board : DEFAULT_BOARD };
  } catch { return { board: DEFAULT_BOARD }; }
}
function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* a preference, not history */ }
  return s;
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1) return null;
    const used = s.ballsUsed | 0;
    return used > 0 && used < BALLS_PER_GAME ? s : null;
  } catch { return null; }
}
function writeSave(snap) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snap)); } catch (err) { console.error('[skeeball] autosave failed', err); }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to lose - the rack is recorded */ }
}

/** This player's own records for a board, straight from the shared store (never a local copy). */
function myRecords(boardId) {
  try {
    const sk = (loadStats().games.skeeball || {}).sk || {};
    return { mine: bestOn(sk, boardId), today: todayBestOn(sk, boardId, Date.now()) };
  } catch { return { mine: 0, today: 0 }; }
}

export class SkeeballUI {
  constructor(container) {
    this.root = container;
    this.settings = loadSettings();
    this.screen = 'setup';
    this.game = null;
    this.renderer = null;
    this.raf = 0;
    this.last = 0;
    this.recorded = false;
    this.lastScore = null;             // this session's most recent finished rack, per board id
    this.overlay = null;
    this.swipe = null;                 // active pointer samples while a swipe is live
    this.msgTimer = 0;
    this.top = {};                     // boardId -> { score, name } once the network answers

    this._onPointerMove = (e) => this._swipeMove(e);
    this._onPointerUp = (e) => this._swipeEnd(e);
    this._loop = (ts) => this._frame(ts);

    ensureCSS();
    this.root.classList.add('sk-root');
    this.root.innerHTML = '';

    this._unsubLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); });
    this._unsubViewport = onViewportResize(() => this._fit());
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);

    this._refreshTopRecords();
    this._renderSetup();
  }

  // --- records ---------------------------------------------------------------------------------

  /** The app-wide best on each machine: derived from the synced player records (js/arcade-scores
   *  appWideBest over js/players-agg rows - deliberately no separate highscores node; see that
   *  file's header). Local history is merged in so a device that has never synced still shows
   *  its own truth. Async and best-effort: the panel renders with the local answer first. */
  async _refreshTopRecords() {
    let rows = [];
    try { rows = aggregatePlayers(await readPlayersOnce()); }
    catch { rows = []; /* offline: local merge below still answers */ }
    if (this.disposed) return;
    let myName = '';
    try { myName = (loadProfile()?.name || '').trim(); } catch { /* no profile is fine */ }
    for (const b of BOARDS) {
      const remote = appWideBest(rows, 'skeeball', 'sk', b.id);
      const localBest = myRecords(b.id).mine;
      this.top[b.id] = localBest > remote.score ? { score: localBest, name: myName } : remote;
      const slot = this.root.querySelector(`[data-rec-top="${b.id}"]`);
      if (slot && this.top[b.id].score) {
        slot.textContent = this._topText(b.id);
      }
    }
  }

  _topText(boardId) {
    const top = this.top[boardId];
    if (!top || !top.score) return '-';
    return top.name ? `${top.score} · ${top.name}` : String(top.score);
  }

  // --- the machine gallery ---------------------------------------------------------------------

  _renderSetup() {
    this.screen = 'setup';
    this._stopLoop();
    this._closeOverlay();
    this.game = null;
    this.renderer = null;

    let sk = {};
    try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
    const save = loadSave();

    const cards = BOARDS.map((b) => {
      const open = isUnlocked(sk, b.id, DEFAULT_BOARD);
      const rec = myRecords(b.id);
      const last = this.lastScore && this.lastScore.board === b.id ? this.lastScore.score : null;
      const resume = save && save.board === b.id;
      const val = (n) => (n ? String(n) : '-');
      if (!open) {
        const from = boardById(b.unlock.board);
        return `<section class="sk-card is-locked" aria-label="${esc(b.name)} - ${esc(t('locked'))}">
          <div class="sk-card-marquee"><b>${esc(b.name)}</b></div>
          <p class="sk-card-tag">${esc(t('unlock_hint', { score: b.unlock.score, name: from.name }))}</p>
        </section>`;
      }
      return `<section class="sk-card" aria-label="${esc(b.name)}">
        <div class="sk-card-marquee"><i class="sk-bulbs" aria-hidden="true"></i><b>${esc(b.name)}</b><i class="sk-bulbs" aria-hidden="true"></i></div>
        <p class="sk-card-tag">${esc(t(b.taglineKey))}</p>
        <dl class="sk-records">
          <div class="sk-rec sk-rec-top"><dt>${esc(t('rec_top'))} <span>(${esc(t('rec_top_any'))})</span></dt>
            <dd data-rec-top="${b.id}">${this._topText(b.id)}</dd></div>
          <div class="sk-rec"><dt>${esc(t('rec_mine'))}</dt><dd>${val(rec.mine)}</dd></div>
          <div class="sk-rec"><dt>${esc(t('rec_today'))}</dt><dd>${val(rec.today)}</dd></div>
          <div class="sk-rec"><dt>${esc(t('rec_last'))}</dt><dd>${last == null ? '-' : last}</dd></div>
        </dl>
        <button type="button" class="sk-play" data-board="${b.id}">
          ${resume ? `${esc(t('resume'))} · ${(save.ballsUsed | 0) + 1}/${BALLS_PER_GAME}` : esc(t('play'))}
        </button>
      </section>`;
    }).join('');

    this.root.innerHTML = `
      <div class="sk-setup">
        <div class="sk-setup-inner">
          <h1 class="sk-title">${esc(t('title'))}</h1>
          <h2 class="sk-sub">${esc(t('setup_machines'))}</h2>
          <div class="sk-cards">${cards}</div>
          <button type="button" class="sk-link" data-role="howto">${esc(t('howto'))}</button>
        </div>
      </div>`;

    this.root.querySelectorAll('[data-board]').forEach((el) => {
      el.addEventListener('click', () => {
        this.settings = saveSettings({ board: el.dataset.board });
        const banked = loadSave();
        this._startGame(banked && banked.board === el.dataset.board ? banked : null);
      });
    });
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this._showHowTo());
  }

  _showHowTo() {
    this._openOverlay('howto', `
      <div class="sk-sheet-head">
        <h2>${esc(t('howto_h'))}</h2>
        <button type="button" class="sk-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
      </div>
      <div class="sk-sheet-body sk-help">${howToMarkup(t)}</div>`);
  }

  // --- play ------------------------------------------------------------------------------------

  _startGame(snap) {
    const board = boardById(this.settings.board);
    this.screen = 'play';
    this.recorded = false;
    this._closeOverlay();
    this.game = snap ? SkeeballGame.restore(snap) : new SkeeballGame(board.id);

    const pips = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');

    this.root.innerHTML = `
      <div class="sk-play-wrap">
        <div class="sk-hud">
          <button type="button" class="sk-hud-back" data-role="machines" aria-label="${esc(t('quit'))}">☰</button>
          <div class="sk-hud-mid">
            <div class="sk-hud-name">${esc(this.game.board.name)}</div>
            <div class="sk-score" data-role="score" aria-label="${esc(t('hud_score_aria'))}">${this.game.score}</div>
            <div class="sk-pips" data-role="pips" aria-label="${esc(t('hud_ball'))}">${pips}</div>
          </div>
          <div class="sk-hud-recs">
            <span class="sk-hud-rec"><em>${esc(t('rec_top'))}</em><b data-role="hud-top">${this._topText(this.game.board.id)}</b></span>
            <span class="sk-hud-rec"><em>${esc(t('rec_mine'))}</em><b data-role="hud-mine">${myRecords(this.game.board.id).mine || '-'}</b></span>
            <span class="sk-hud-rec"><em>${esc(t('rec_today'))}</em><b data-role="hud-today">${myRecords(this.game.board.id).today || '-'}</b></span>
          </div>
        </div>
        <div class="sk-stage" data-role="stage">
          <canvas class="sk-canvas" data-role="canvas" role="img" aria-label="${esc(t('aria_lane'))}"></canvas>
          <div class="sk-msg" data-role="msg" aria-live="polite"></div>
          <div class="sk-swipe" data-role="swipe" aria-hidden="true">
            <span class="sk-hint" data-role="hint">${esc(t('hint_swipe'))}</span>
          </div>
        </div>
      </div>`;

    this.el = {
      stage: this.root.querySelector('[data-role="stage"]'),
      canvas: this.root.querySelector('[data-role="canvas"]'),
      score: this.root.querySelector('[data-role="score"]'),
      pips: this.root.querySelector('[data-role="pips"]'),
      msg: this.root.querySelector('[data-role="msg"]'),
      hint: this.root.querySelector('[data-role="hint"]'),
      swipe: this.root.querySelector('[data-role="swipe"]'),
      hudMine: this.root.querySelector('[data-role="hud-mine"]'),
      hudToday: this.root.querySelector('[data-role="hud-today"]'),
      hudTop: this.root.querySelector('[data-role="hud-top"]'),
    };

    this.renderer = new Renderer(this.el.canvas, this.game.board);
    this._bindPlay();
    this._fit();
    if (snap) this._say(t('msg_resumed', { n: this.game.ballsUsed + 1, total: BALLS_PER_GAME }));
    this.last = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  _bindPlay() {
    this.root.querySelector('[data-role="machines"]').addEventListener('click', () => {
      // Mid-rack state is already banked (autosave lands after every settled ball), so leaving
      // for the gallery is lossless; the card's button will say Resume.
      this._renderSetup();
    });
    const zone = this.el.swipe;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.game || !this.game.canThrow()) return;
      this.swipe = { id: e.pointerId, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    });
    // Bound to the ZONE, never to document: a non-passive document-level touchmove kills
    // compositor scrolling for the whole page while the game is mounted (root CLAUDE.md's
    // scroll and touch rules). The zone is where every throw starts, so nothing is lost.
    zone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  _swipeMove(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const s = this.swipe.samples;
    s.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (s.length > 48) s.shift();
  }

  _swipeEnd(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const samples = this.swipe.samples;
    this.swipe = null;
    if (!this.game || !this.game.canThrow() || samples.length < 2) return;
    const end = samples[samples.length - 1];
    // Measure over the swipe's last ~130ms: that is the release flick, which is what a real
    // skeeball roll is - the wind-up before it is grip, not power.
    let ref = samples[0];
    for (const smp of samples) { if (end.t - smp.t <= 130) { ref = smp; break; } }
    const dt = Math.max(16, end.t - ref.t) / 1000;
    const dx = end.x - ref.x;
    const dy = end.y - ref.y;                  // negative = upward
    if (-dy < 24) return;                      // not a throw - a tap or a sideways wander
    const up = -dy / dt;                       // px/s
    const H = Math.max(320, this.el.stage.getBoundingClientRect().height);
    // Normalised against the stage height so phone and desktop feel alike: a gentle push
    // (~0.8 stage-heights/s) is a soft roll, a brisk flick (~2 H/s) finds the rings, and only
    // a genuine fling (3+ H/s) has the power the corner pockets ask for.
    const power = Math.min(1, up / (H * 3.0));
    const aim = Math.max(-1, Math.min(1, Math.atan2(dx, -dy) / 0.42));
    if (this.game.throwBall({ power, aim })) {
      if (this.el.hint) { this.el.hint.classList.add('is-gone'); }
    }
  }

  // --- the frame -------------------------------------------------------------------------------

  _frame(ts) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.game || !this.renderer) return;
    const now = ts / 1000;
    const dt = Math.min(this.last ? now - this.last : 1 / 60, 0.05);
    this.last = now;
    this.game.update(dt);
    this._drainEvents();
    this.renderer.render(this.game, dt);
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.classList.remove('is-on');
    }
  }

  _stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** game.js's event stream becomes light and numbers. Presentation only - no branch here
   *  changes a score or a rule. */
  _drainEvents() {
    const Rr = this.renderer;
    for (const ev of this.game.takeEvents()) {
      switch (ev.type) {
        case 'capture': {
          const f = Rr.face(ev.u, ev.v);
          const gold = ev.value >= 100, big = ev.value >= 50;
          Rr.flashHole(ev.hole);
          Rr.popupAt(f.x, f.y, f.z + 0.05, `+${ev.value}`, gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
          if (big) Rr.burstAt(f.x, f.y, f.z + 0.03, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
          if (gold) Rr.celebrate();
          break;
        }
        case 'gutter':
          Rr.flashHole('gutter');
          this._say(t('msg_gutter'));
          break;
        case 'returned':
          this._say(t('msg_returned'));
          break;
        case 'ballDone':
          this._paintHud();
          writeSave(this.game.snapshot());   // the autosave that makes leaving lossless
          break;
        case 'rackOver':
          this._rackOver(ev.result);
          break;
        default: break;                      // launch/impact/bounce/throw: the canvas already shows them
      }
    }
  }

  _paintHud() {
    this.el.score.textContent = String(this.game.score);
    this.el.pips.innerHTML = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');
  }

  _say(text) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('is-on');
    this.msgTimer = 1.8;
  }

  // --- the finished rack -----------------------------------------------------------------------

  _rackOver(result) {
    const board = this.game.board;
    // What stood BEFORE this rack lands in the store - that is what "NEW BEST" means.
    const prev = myRecords(board.id);
    const prevTop = (this.top[board.id] && this.top[board.id].score) || 0;

    if (!this.recorded) {
      this.recorded = true;
      // Record ONCE (every write in js/game-stats.js is additive - a double call would inflate
      // the play count silently rather than fail loudly).
      try {
        recordSkeeball(board.id, { ...result, at: Date.now() });
      } catch (err) {
        console.error('[skeeball] could not record the rack', err);
      }
      try {
        for (const id of unlocksEarned(board.id, result.score)) unlockSkeeballBoard(id);
      } catch (err) {
        console.error('[skeeball] could not store an earned unlock', err);
      }
      try { syncMyStats(); } catch (err) { console.error('[skeeball] stats sync could not start', err); }
      clearSave();
    }
    this.lastScore = { board: board.id, score: result.score };

    const now = myRecords(board.id);
    if (this.top[board.id] && result.score > (this.top[board.id].score | 0)) {
      let myName = '';
      try { myName = (loadProfile()?.name || '').trim(); } catch { /* fine */ }
      this.top[board.id] = { score: result.score, name: myName };
    }
    const isTop = prevTop > 0 && result.score > prevTop;
    const isMine = result.score > prev.mine;
    const isToday = !isMine && result.score > prev.today;
    const pill = (key) => `<span class="sk-newpill">${esc(t(key))}</span>`;

    const row = (label, value, isNew, newKey, cls = '') => `
      <div class="sk-rec${cls}"><dt>${label}</dt><dd>${value}${isNew ? pill(newKey) : ''}</dd></div>`;

    const el = this._openOverlay('over', `
      <div class="sk-sheet-head">
        <h2>${esc(t('over_h'))}</h2>
        <button type="button" class="sk-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
      </div>
      <div class="sk-sheet-body">
        <p class="sk-final-label">${esc(t('over_final'))} · ${esc(board.name)}</p>
        <p class="sk-final">${result.score}</p>
        <dl class="sk-records sk-records-over">
          ${row(`${esc(t('rec_top'))} <span>(${esc(t('rec_top_any'))})</span>`, esc(this._topText(board.id)), isTop, 'over_new_top', ' sk-rec-top')}
          ${row(esc(t('rec_mine')), now.mine || '-', isMine, 'over_new_mine')}
          ${row(esc(t('rec_today')), now.today || '-', isToday, 'over_new_today')}
        </dl>
        <div class="sk-tiles">
          <div class="sk-tile"><b>${result.bestThrow}</b><span>${esc(t('over_best_throw'))}</span></div>
          <div class="sk-tile"><b>${result.hundreds}</b><span>${esc(t('over_hundreds'))}</span></div>
          <div class="sk-tile"><b>${result.fifties}</b><span>${esc(t('over_fifties'))}</span></div>
        </div>
        <div class="sk-sheet-actions">
          <button type="button" class="sk-play" data-role="again">${esc(t('over_again'))}</button>
          <button type="button" class="sk-link" data-role="gallery">${esc(t('quit'))}</button>
        </div>
      </div>`);
    if (isMine || isTop) this.renderer.celebrate();
    el.querySelector('[data-role="again"]').addEventListener('click', () => this._startGame(null));
    el.querySelector('[data-role="gallery"]').addEventListener('click', () => this._renderSetup());
    // The X closes to the gallery rather than leaving a finished rack behind the sheet.
    el.querySelector('[data-role="close"]').addEventListener('click', () => this._renderSetup());
  }

  // --- overlays --------------------------------------------------------------------------------

  _openOverlay(kind, html) {
    this._closeOverlay();
    const el = document.createElement('div');
    el.className = `sk-veil sk-veil-${kind}`;
    el.innerHTML = `<div class="sk-sheet">${html}</div>`;
    this.root.appendChild(el);
    this.overlay = el;
    el.querySelectorAll('[data-role="close"]').forEach((b) => b.addEventListener('click', () => this._closeOverlay()));
    return el;
  }

  _closeOverlay() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    this.overlay = null;
  }

  // --- layout ----------------------------------------------------------------------------------

  _fit() {
    if (!this.renderer || !this.el || !this.el.stage) return;
    const r = this.el.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.resize(r.width, r.height);
  }

  // --- teardown --------------------------------------------------------------------------------

  destroy() {
    this.disposed = true;
    this._stopLoop();
    this._closeOverlay();
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    if (this._unsubLang) this._unsubLang();
    if (this._unsubViewport) this._unsubViewport();
    this.game = null;
    this.renderer = null;
    this.root.classList.remove('sk-root');
    this.root.innerHTML = '';
  }
}

// --- the hub module contract --------------------------------------------------------------------

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
  return instance;
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

/** FALSE even mid-rack: this game is in the autosave/resume class of the contract (root
 *  CLAUDE.md, "The module contract"). Every settled ball snapshots to gamehub.skeeball.save.v1
 *  and the gallery's Play button becomes Resume, so leaving loses nothing worth confirming. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
