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
import { swipeSpeed, powerOf } from './swipe.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the setup screen themes standalone
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
  // The shared primitives first (the setup screen is BUILT on css/ui.css - the same injection
  // marker bug-report-ui.js uses, so the two never double-load it), then the game's own sheet.
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = new URL('../../css/ui.css', import.meta.url).href;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
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
    this._pending = null;              // a captured ball's score, held until it has settled
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
      const line = this.root.querySelector(`[data-rec-top-line="${b.id}"]`);
      if (line && this.top[b.id].score) {
        line.textContent = String(this.top[b.id].score);
      }
    }
    // The network answer is what fills in the All Time column, so repaint the backboard with it.
    this._pushScoreboard();
  }

  /**
   * Hand the renderer the four records its backboard paints (2026-08-15). Called on mount, when
   * the network answers with the app-wide best, and after every finished rack.
   *
   * The All Time column carries the RECORD HOLDER'S NAME as well as the score - it is the only
   * one of the four that can belong to somebody else. The other three are always this player's.
   * The labels are passed in translated, because the renderer has no t() of its own.
   */
  _pushScoreboard() {
    if (!this.renderer || !this.game) return;
    const id = this.game.board.id;
    const mine = myRecords(id);
    // ?sb=J - the four records live in the HUD instead of on the machine. This is the only
    // surface in the game drawn at native resolution: a backboard texture is minified about 11:1
    // by the time it reaches the far end of the lane, DOM text is not minified at all.
    let sbq = '';
    try { sbq = (new URLSearchParams(location.search).get('sb') || '').toUpperCase(); } catch { sbq = ''; }
    if (sbq === 'J') {
      const top = this.top[id] || null;
      const last = this.lastScore && this.lastScore.board === id ? this.lastScore.score : null;
      let strip = this.root.querySelector('[data-role="sb-hud"]');
      if (!strip) {
        strip = document.createElement('div');
        strip.setAttribute('data-role', 'sb-hud');
        strip.style.cssText = 'position:absolute;left:0;right:0;top:0;z-index:4;display:flex;'
          + 'justify-content:space-around;padding:6px 4px;background:rgba(7,4,5,.82);'
          + 'border-bottom:2px solid #c98a3a;pointer-events:none;font-variant-numeric:tabular-nums;';
        if (this.el.stage) this.el.stage.appendChild(strip);
      }
      const cell = (label, value, sub) => `<div style="text-align:center;min-width:60px">
        <div style="font-size:9px;letter-spacing:.1em;color:#7ec8f0;font-weight:700">${esc(label.toUpperCase())}</div>
        <div style="font-size:22px;line-height:1.05;color:#ffb02e;font-weight:800">${esc(String(value || '-'))}</div>
        ${sub ? `<div style="font-size:10px;color:#ffb02e;font-weight:700">${esc(sub.toUpperCase())}</div>` : ''}
      </div>`;
      strip.innerHTML = cell(t('sb_all_time'), top && top.score, (top && top.name) || '')
        + cell(t('sb_your_best'), mine.mine, '')
        + cell(t('sb_today'), mine.today, '')
        + cell(t('sb_last_game'), last, '');
    }
    this.renderer.sbLabels = {
      allTime: t('sb_all_time'),
      best: t('sb_your_best'),
      today: t('sb_today'),
      last: t('sb_last_game'),
    };
    this.renderer.setScoreboard({
      allTime: this.top[id] || null,
      best: mine.mine || 0,
      today: mine.today || 0,
      last: this.lastScore && this.lastScore.board === id ? this.lastScore.score : null,
    });
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
    if (this.renderer) this.renderer.dispose();
    this.renderer = null;

    let sk = {};
    try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
    const save = loadSave();
    const board = boardById(this.settings.board);
    const rec = myRecords(board.id);
    const last = this.lastScore && this.lastScore.board === board.id ? this.lastScore.score : null;
    const val = (n) => (n ? String(n) : '-');

    // Escoba's page order (the repo's setup-screen reference): resume if a save exists, one
    // stats line, the settings card (here: the machine accordion), the how-to text link, ONE
    // primary action. Collapsed rows show label + current value; open one to change it.
    const machinesBody = BOARDS.map((b) => {
      const open = isUnlocked(sk, b.id, DEFAULT_BOARD);
      if (!open) {
        const from = boardById(b.unlock.board);
        return `<div class="sk-mrow is-locked"><b>${esc(b.name)}</b>
          <span>${esc(t('unlock_hint', { score: b.unlock.score, name: from.name }))}</span></div>`;
      }
      const r = myRecords(b.id);
      const sel = b.id === board.id;
      return `<button type="button" class="sk-mrow${sel ? ' is-selected' : ''}" data-pick="${b.id}">
        <b>${esc(b.name)}</b>
        <span class="sk-mrow-tag">${esc(t(b.taglineKey))}</span>
        <span class="sk-mrow-recs">
          <span><em>${esc(t('rec_top'))}</em><b data-rec-top="${b.id}">${this._topText(b.id)}</b></span>
          <span><em>${esc(t('rec_mine'))}</em><b>${val(r.mine)}</b></span>
          <span><em>${esc(t('rec_today'))}</em><b>${val(r.today)}</b></span>
          <span><em>${esc(t('rec_last'))}</em><b>${this.lastScore && this.lastScore.board === b.id ? this.lastScore.score : '-'}</b></span>
        </span>
      </button>`;
    }).join('');

    this.root.innerHTML = `
      <div class="sk-setup">
        <div class="sk-setup-inner">
          <h1 class="sk-title">${esc(t('title'))}</h1>
          ${save ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">
            ${esc(t('resume'))} &middot; ${(save.ballsUsed | 0) + 1}/${BALLS_PER_GAME}</button>` : ''}
          <p class="sk-statline">
            ${esc(t('stat_best'))} <b>${val(rec.mine)}</b> &middot;
            ${esc(t('stat_today'))} <b>${val(rec.today)}</b> &middot;
            ${esc(t('stat_top'))} <b data-rec-top-line="${board.id}">${val(this.top[board.id] && this.top[board.id].score)}</b> &middot;
            ${esc(t('stat_last'))} <b>${last == null ? '-' : last}</b>
          </p>
          <div class="gh-acc">
            <button type="button" class="gh-acc__head" data-role="acc" aria-expanded="${this._accOpen ? 'true' : 'false'}">
              <span>${esc(t('machine'))}</span>
              <span class="gh-acc__value">${esc(board.name)}</span>
            </button>
            <div class="gh-acc__body" ${this._accOpen ? '' : 'hidden'}>${machinesBody}</div>
          </div>
          <button type="button" class="sk-howto-link" data-role="howto">&#128214; ${esc(t('howto'))}</button>
          <button type="button" class="gh-btn ${save ? 'gh-btn--ghost' : 'gh-btn--primary'} gh-btn--block" data-role="play">
            ${esc(save ? t('new_game') : t('play'))}</button>
        </div>
      </div>`;

    if (save) {
      this.root.querySelector('[data-role="resume"]').addEventListener('click', () => {
        this._startGame(loadSave());
      });
    }
    this.root.querySelector('[data-role="acc"]').addEventListener('click', () => {
      this._accOpen = !this._accOpen;
      this._renderSetup();
    });
    this.root.querySelectorAll('[data-pick]').forEach((el) => {
      el.addEventListener('click', () => {
        this.settings = saveSettings({ board: el.dataset.pick });
        this._accOpen = false;
        this._renderSetup();
      });
    });
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this._showHowTo());
    // New game DISCARDS a banked mid-rack snapshot - the player's explicit choice (the snapshot
    // is a resume convenience, not earned history; the Resume button sits directly above).
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => {
      clearSave();
      this._startGame(null);
    });
    // ?sb=... goes straight to the machine. The scoreboard trials are ON the play screen, and a
    // headless browser cannot click Play - this is what lets them be screenshotted and actually
    // looked at rather than described. Goes when the trials go.
    try {
      if ((new URLSearchParams(location.search).get('sb') || '')) {
        clearSave();
        this._startGame(null);
      }
    } catch { /* no query string is fine */ }
  }

  _showHowTo() {
    const el = this._openOverlay('howto', `
      <div class="sk-sheet-head">
        <h2>${esc(t('howto_h'))}</h2>
        <button type="button" class="sk-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
      </div>
      <div class="sk-sheet-body sk-help">${howToMarkup(t)}</div>`);
    this._fitHelpLines(el);
  }

  /** The pattern's single-row rule (tic-tac-toe/CLAUDE.md): measure each line's rendered width
   *  against the container's real width, size down until it fits, then lock it with nowrap. */
  _fitHelpLines(el) {
    for (const line of el.querySelectorAll('.sk-ht-line')) {
      line.style.whiteSpace = 'nowrap';
      let size = parseFloat(getComputedStyle(line).fontSize) || 15;
      let guard = 14;
      while (line.scrollWidth > line.clientWidth && size > 10 && guard-- > 0) {
        size -= 0.5;
        line.style.fontSize = `${size}px`;
      }
      // If it still cannot fit at the floor, let it wrap rather than clip.
      if (line.scrollWidth > line.clientWidth) line.style.whiteSpace = 'normal';
    }
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
          <!-- The TOP/BEST/TODAY strip that used to live here is GONE (2026-08-15). Those records
               are painted on the machine's own backboard now (render.js setScoreboard), and Matt's
               rule was not to show the same data twice. The header keeps only the LIVE state of
               the rack in progress: the score and the ball pips. -->
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
    };

    if (this.renderer) this.renderer.dispose();
    this.renderer = new Renderer(this.el.canvas, this.game.board);
    this._pushScoreboard();
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
      // e.timeStamp, never performance.now(): the sample must carry the EVENT's time. Under
      // load the handler runs late and bunched, and clocking samples at handler time collapses
      // the measured flick speed - a strong swipe reads as a dribble on a busy frame.
      this.swipe = { id: e.pointerId, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });
    // Bound to the ZONE, never to document: a non-passive document-level touchmove kills
    // compositor scrolling for the whole page while the game is mounted (root CLAUDE.md's
    // scroll and touch rules). The zone is where every throw starts, so nothing is lost.
    zone.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  _swipeMove(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const s = this.swipe.samples;
    s.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });   // event time, not handler time
    if (s.length > 48) s.shift();
  }

  _swipeEnd(e) {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const samples = this.swipe.samples;
    this.swipe = null;
    if (!this.game || !this.game.canThrow() || samples.length < 2) return;
    const first = samples[0];
    const end = samples[samples.length - 1];

    // THE SWIPE MATHS LIVES IN js/swipe.js AND IS NOT REPEATED HERE. skeeball/flick-test.html
    // imports the same file, so the number that page prints IS the number this line computes.
    // They used to be two hand-copied copies, and they drifted inside a single edit - see that
    // file's header for exactly how, and what it cost.
    const perH = swipeSpeed(samples, window.innerHeight);
    if (perH == null) return;                              // a tap or a sideways smudge
    // NOT CLAMPED to 0..1: swipe.js's SWIPE_SLOW/SWIPE_FAST mark the ends of the NATURAL range,
    // not of what a throw can be, and physics.js extrapolates past both.
    const power = powerOf(perH);

    // AIM: the direction of the whole swipe, eased. Small deviations have to stay small - the
    // lane is 2.5m long, so a launch angle is multiplied by the time the ball spends travelling,
    // and a linear map made a 5-degree wobble the difference between the 40 and the gutter. The
    // exponent keeps a nearly-straight swipe nearly straight and still lets a deliberate
    // 30-degree diagonal fling reach the corner 100s.
    //
    // This shapes the INPUT - what direction the player asked for - and nothing else. Once
    // thrown, the ball is the engine's and is never touched again: no magnetism, no correction.
    // The divisor is set by what a THUMB CAN REACH, not by a round number. A swipe starts near
    // the middle of a 393px screen and runs ~450px up it, so the widest diagonal available is
    // about 22 degrees - anything steeper runs off the side of the phone before it has travelled
    // far enough to be a throw. At the old 0.42 rad divisor the corner 100s needed a 30-degree
    // swipe that physically did not fit on the screen, which is why they read as unreachable.
    // 0.38 rad puts full aim exactly at the edge of what the hand can do.
    const raw = Math.max(-1, Math.min(1, Math.atan2(end.x - first.x, first.y - end.y) / 0.38));
    const aim = Math.sign(raw) * (raw * raw);

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
        // THE BALL SETTLES FIRST, THEN THE SCORE. `capture` fires the instant the ball's centre
        // crosses the mouth, which is ~300ms before it has finished dropping through the collar
        // - so announcing there put the number on screen while the ball was still visibly
        // rattling, and the throw was over before it looked over. All this does now is light the
        // rim the ball is going into, which is what a real machine does at exactly this moment.
        // The number, the burst and the marquee wait for `ballDone`.
        case 'capture':
          Rr.flashHole(ev.hole);
          this._pending = { pos: ev.pos, value: ev.value };
          break;
        case 'gutter':
          Rr.flashHole('gutter');
          this._say(t('msg_gutter'));
          break;
        case 'returned':
          this._say(t('msg_returned'));
          this._pending = null;
          break;
        case 'ballDone': {
          const at = this._pending;
          this._pending = null;
          if (at) {
            const gold = at.value >= 100, big = at.value >= 50;
            Rr.popupAt(at.pos, `+${at.value}`, gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
            if (big) Rr.burstAt(at.pos, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
            if (gold) Rr.celebrate();
          }
          this._paintHud();
          writeSave(this.game.snapshot());   // the autosave that makes leaving lossless
          break;
        }
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
    // The rack just finished, so all four of the backboard's records can have moved.
    this._pushScoreboard();
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
    if (this.renderer) this.renderer.dispose();   // WebGL contexts leak if not released
    this.renderer = null;
    this.root.classList.remove('sk-root');
    this.root.innerHTML = '';
  }
}

// --- the hub module contract --------------------------------------------------------------------

export function init(container) {
  if (instance) instance.destroy();
  instance = new SkeeballUI(container);
  // Test hook (the __yzTest precedent): read-only access for the drivers that PLAY this game
  // headlessly - test-visual.mjs's probe and the session play scripts. Never used by the game.
  if (typeof window !== 'undefined') window.__skTest = { get ui() { return instance; } };
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
