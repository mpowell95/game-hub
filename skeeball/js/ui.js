// skeeball/js/ui.js - the DOM shell, the swipe, and the hub module contract.
//
// Three screens plus overlays, all mounted into the one container the hub hands us: SETUP (the
// machine gallery and its records), PLAY (the canvas under a marquee-style HUD, the swipe
// surface that IS the lane), OVER (the finished rack, with a close X per root CLAUDE.md's rule).
//
// This file owns the clock, the storage keys and every listener. The rules live in game.js, the
// machines in boards.js, the solver in physics.js, the pixels in render.js.
//
// GUARD: isInProgress() is the AUTOSAVE/RESUME meaning of the module contract (root CLAUDE.md,
// "The module contract" - Escoba's class, not Ball Run's) and always returns FALSE, even
// mid-rack - the between-throws state is snapshotted after every settled ball, so leaving is
// lossless. A ball in flight is not part of the saved state.

import { SkeeballGame, BALLS_PER_GAME } from './game.js';
import { engineFor } from './engines.js';
import { BOARDS, boardById, DEFAULT_BOARD } from './boards.js';
import { swipeSpeed, powerOf, launchSpeed } from './swipe.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import '../../js/theme.js';   // side effect: stamps .gh-dark so the setup screen themes standalone
import { onViewportResize } from '../../js/viewport.js';
import { loadStats, recordSkeeball, unlockSkeeballBoard, deviceId, statsId } from '../../js/game-stats.js';
import { readGoals, readGoalsLive, allGoalsMet } from './goals.js';
import { getStatsApp } from '../../js/firebase-boot.js';
import { syncMyStats, readPlayersOnce } from '../../js/stats-net.js';
import { aggregatePlayers } from '../../js/players-agg.js';
import { appWideBest, isUnlocked, dayKey } from '../../js/arcade-scores.js';
import { correctBoard, correctionFor } from '../../js/stats-corrections.js';
import { isBoardReleased, isBoardTesting, corrections, myBoardCorrections } from '../../js/admin-config.js';
import { isDevProfile } from '../../js/challenge/hooks.js';
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

/** THE KEY, drawn once and used twice - the one that grows out of the ceremony's point, and the
 *  one that flies into the lock in the gallery. Matt, 2026-08-25, with a reference picture:
 *  "just make the key look a bit more like a key". So it is a chunky outlined cartoon key rather
 *  than a stroked outline: a round bow with a real hole in it, a collar, a shaft, and two stepped
 *  teeth at the business end.
 *
 *  GUARD: ONE PATH WITH fill-rule="evenodd", NOT A PILE OF SHAPES. The silhouette and the bow's
 *  hole are subpaths of the same `d`, so a single stroke draws the outer outline AND the ring
 *  around the hole with no internal seams where a shaft meets a circle - and the hole is a real
 *  hole, so it works on the dark lane and on the gallery's white card without a mask or an id
 *  that two copies on one page would fight over. Teeth point LEFT, bow sits RIGHT: the gallery's
 *  key drives in from the right, so that is the direction it has to face.
 *  Aspect is 106:58 - size it by width and let height follow, or it shears. */
const KEY_SVG = `<svg viewBox="5 -1 106 58" fill="none" aria-hidden="true">
  <path d="M14 20H62.83A22 22 0 1 1 62.83 32H40V40H30V32H24V44H14Z M93.5 26a9.5 9.5 0 1 0-19 0 9.5 9.5 0 1 0 19 0Z" fill-rule="evenodd" stroke="#2a1608" stroke-width="9" stroke-linejoin="round"/>
  <path d="M14 20H62.83A22 22 0 1 1 62.83 32H40V40H30V32H24V44H14Z M93.5 26a9.5 9.5 0 1 0-19 0 9.5 9.5 0 1 0 19 0Z" fill-rule="evenodd" fill="#f5b32e"/>
  <rect x="54" y="15" width="12" height="22" rx="4" fill="#e8791a" stroke="#2a1608" stroke-width="4"/>
  <path d="M22 24.5H48" stroke="#fff6d8" stroke-width="4" stroke-linecap="round" opacity="0.75"/>
  <path d="M68.97 20.53A16 16 0 0 1 81.22 10.24" stroke="#fff6d8" stroke-width="3.5" stroke-linecap="round" opacity="0.7"/>
</svg>`;

/** The padlock, with a KEYHOLE - the gallery's key has to go into something. */
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path class="sk-lock-shackle" d="M8 11V7a4 4 0 0 1 8 0v4"/><g class="sk-lock-hole"><circle cx="12" cy="15" r="1.35"/><path d="M12 16.4v1.6"/></g></svg>`;

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

/* THE LOCK POP (2026-08-25). "This machine was just unlocked and the player has not popped its
   lock yet." PURE THEATRE, and deliberately its own key rather than a field on anything that
   records an earn: the unlock itself is banked the instant it is earned (_rackOver ->
   unlockSkeeballBoard, additive, THE LAW rule 2), so a player who earns a machine and force-quits
   before the ceremony still owns it. This flag only decides whether the gallery shows the golden
   lock first.

   GUARD: IT IS ARMED, NEVER BACKFILLED. An absent entry means "no ceremony owed", so every
   machine already unlocked before this shipped stays open exactly as it was, and a wiped key can
   only ever skip a ceremony - it can never put a lock back on a machine somebody earned. */
const LOCKPOP_KEY = 'gamehub.skeeball.lockpop.v1';   // { [boardId]: true } - cosmetic, per device
function lockPops() {
  try {
    const o = JSON.parse(localStorage.getItem(LOCKPOP_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}
function armLockPop(id) {
  try { localStorage.setItem(LOCKPOP_KEY, JSON.stringify({ ...lockPops(), [id]: true })); }
  catch { /* the unlock is already banked; only the ceremony is lost */ }
}
function clearLockPop(id) {
  const o = lockPops();
  delete o[id];
  try { localStorage.setItem(LOCKPOP_KEY, JSON.stringify(o)); } catch { /* it pops again next time */ }
}
const isLockPending = (id) => !!lockPops()[id];

/* THE CEREMONY A PLAYER IS STILL OWED (2026-08-25). A machine can be BANKED without its ceremony
   ever having been seen: `_ensureGoalUnlocks` grants a machine whose parent's objectives were
   already complete - goals met on another device, or met while the machine was still in Testing
   and therefore skipped by both unlock writers. That grant is silent by design (it can happen at
   mount, with no rack on screen to animate), so without this the player's reward for finishing a
   machine is a slide that quietly stops being grey.

   Matt, 2026-08-25, about King of Games, who had cleared HOT SHOT's three before BRICK CITY was
   ever released: "I want him to see the unlock animations we created... set it so that the next
   time he scores a single point in hot shot, the animation plays."

   So a retroactive grant ARMS this, and the next ball that puts a point on the board during a
   round on the PARENT machine plays the full ceremony. Same class as the lock pop above: local,
   cosmetic, per device, armed and never backfilled. It cannot grant, ungrant or delay anything -
   the unlock is banked before this flag is ever written, and losing the key only loses theatre. */
const CEREMONY_KEY = 'gamehub.skeeball.ceremonyowed.v1';   // { [boardId]: true } - cosmetic
function ceremoniesOwed() {
  try {
    const o = JSON.parse(localStorage.getItem(CEREMONY_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}
function armCeremonyOwed(id) {
  try { localStorage.setItem(CEREMONY_KEY, JSON.stringify({ ...ceremoniesOwed(), [id]: true })); }
  catch { /* the unlock is already banked; only the ceremony is lost */ }
}
function clearCeremonyOwed(id) {
  const o = ceremoniesOwed();
  delete o[id];
  try { localStorage.setItem(CEREMONY_KEY, JSON.stringify(o)); } catch { /* it plays once more */ }
}
const isCeremonyOwed = (id) => !!ceremoniesOwed()[id];

/** One throwaway Renderer draws the machine (no ball) to an off-DOM canvas we read back as a
 *  JPEG - render.js sets preserveDrawingBuffer, so the canvas is readable, and the WebGL context
 *  is disposed immediately after. This is how the setup carousel (and later the how-to card) show
 *  the ACTUAL machine rather than a drawing (batch G, 2026-08-18). Returns null on any failure so
 *  the caller keeps its placeholder rather than breaking. */
function renderMachineImage(board, sb) {
  try {
    const c = document.createElement('canvas');
    const r = new (engineFor(board.id).Renderer)(c, board);
    // GUARD: HAND IT THE RECORDS. The backboard IS the machine's scoreboard, and a Renderer
    // nobody pushes values into paints its constructor defaults - four dashes. That is what put
    // an empty ALL TIME / YOUR BEST / TODAY / LAST GAME strip in the setup picture, four inches
    // above the player's real stats, reading as though their history had been lost (playtest,
    // 2026-08-21). Labels first: setScoreboard repaints, and repaints with whatever labels it
    // finds.
    if (sb) { r.sbLabels = sb.labels; r.setScoreboard(sb.values); }
    r.framePreview(600, 800);
    r.render(null, 0);
    const url = c.toDataURL('image/jpeg', 0.85);
    r.dispose();
    return url;
  } catch (err) {
    console.error('[skeeball] machine preview render failed', err);
    return null;
  }
}

/** 1240 -> "1.2k", 2000 -> "2k". The goal rails are 66px wide; four digits over four more do
 *  not fit, and nobody reads a lifetime total to the point anyway. */
const shortNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/.0$/, '')}k` : String(n));

/** A ball's value as the landing popup prints it, WITH ITS SIGN. Every popup used to be built as
 *  `+${value}`, which printed "+-20" the moment a machine with negative cups existed (BRICK
 *  CITY's penalty row, 2026-08-24). A minus sign is the whole message on those baskets, so it is
 *  spelled with a real minus (U+2212, what POPONGO's equalizer popup already uses) rather than a
 *  hyphen - at popup size a hyphen reads as a dash in the number. Zero prints bare. */
const signedValue = (v) => {
  const n = v | 0;
  if (n > 0) return `+${n}`;
  if (n < 0) return `\u2212${-n}`;
  return '0';
};

/** This player's own records for a board, straight from the shared store (never a local copy). */
function myRecords(boardId) {
  try {
    const sk = (loadStats().games.skeeball || {}).sk || {};
    // An admin correction (js/stats-corrections.js) applies to the backboard's own numbers too. If
    // it did not, a voided best would vanish from My Stats and the leaderboard while the machine
    // itself kept showing it - one number, two answers, which is worse than not correcting at all.
    const corrs = myBoardCorrections(statsId()) || {};
    const board = correctBoard((sk.boards || {})[boardId], correctionFor(corrs, boardId));
    return {
      mine: board.best | 0,
      today: (board.daily || {})[dayKey(Date.now())] | 0,
    };
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
    this.hubAvg = {};                  // boardId -> hub-wide average score across synced players (game-over card)
    this._machineImg = {};             // board id + its records -> cached data URL of that render

    this._onPointerMove = (e) => this._swipeMove(e);
    this._onPointerUp = (e) => this._swipeEnd(e);
    // GUARD: A CANCELLED GESTURE IS NOT A THROW. pointercancel fires when the browser takes the
    // pointer away mid-swipe - switching apps, a system edge-swipe, a call arriving - and it used
    // to run the same handler as pointerup, so leaving the game with a finger down launched a ball
    // the player never released (Matt, 2026-08-21). Dropping the samples IS the fix.
    this._onPointerCancel = () => { this.swipe = null; };
    // Same reason one layer out: some platforms hide the page without ever cancelling the pointer.
    this._onHide = () => { if (document.visibilityState === 'hidden') this.swipe = null; };
    this._loop = (ts) => this._frame(ts);
    // WHAT AN OBJECTIVE MEANS, ON A TAP. Matt, 2026-08-25, setting BRICK CITY's new three:
    // "'perfect rounds' must be defined when you click on the objective." Delegated from the
    // root because every screen change replaces its innerHTML - a listener bound to a rail box
    // would die with the first repaint of the rack. Removed in destroy(), so nothing outlives
    // the mount.
    this._onDefTap = (e) => {
      const box = e.target && e.target.closest ? e.target.closest('[data-def]') : null;
      if (box) this._showGoalDefs(box.getAttribute('data-def'));
    };
    this._onDefKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const box = e.target && e.target.closest ? e.target.closest('[data-def]') : null;
      if (!box) return;
      e.preventDefault();
      this._showGoalDefs(box.getAttribute('data-def'));
    };

    ensureCSS();
    this.root.classList.add('sk-root');
    this.root.innerHTML = '';

    this._unsubLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); });
    this._unsubViewport = onViewportResize(() => this._fit());
    this.root.addEventListener('click', this._onDefTap);
    this.root.addEventListener('keydown', this._onDefKey);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    document.addEventListener('visibilitychange', this._onHide);

    // The landscape door. On <body> rather than inside this.root, because every screen change
    // replaces this.root's innerHTML and would take it with it. Visibility is entirely the
    // stylesheet's; this only has to exist and carry the translated line.
    this._rotate = document.createElement('div');
    this._rotate.className = 'sk-rotate';
    this._rotate.innerHTML = `<p>${esc(t('rotate'))}</p>`;
    document.body.appendChild(this._rotate);

    this._refreshTopRecords();
    this._ensureGoalUnlocks();
    // A RELOAD MID-RACK PUTS YOU BACK ON THE LANE, not on the gallery. The rack always survived
    // a refresh, but you landed on the machine screen and had to find Resume - two taps back to
    // a game you never left (playtest, 2026-08-21).
    const resume = loadSave();
    if (resume) this._startGame(resume); else this._renderSetup();
  }

  // --- unlocks ---------------------------------------------------------------------------------

  /** Every machine this board's finished rack has just earned. Two unlock shapes exist
   *  (boards.js): { board, score } - reach that score in one game - and { board, goals: true } -
   *  complete all three of that board's objectives (js/goals.js). The goals check reads the
   *  RECORDED store, so callers run this after recordSkeeball has landed. */
  _earnedUnlocks(boardId, score) {
    const out = [];
    for (const b of BOARDS) {
      // Still in testing = never unlocked by play. `adminOnly` is only the CODE DEFAULT now: the
      // admin page can move a machine to Unlockable, and from that moment it earns normally
      // (js/admin-config.js). Reading the resolved answer here rather than the raw flag is what
      // makes "live and can be unlocked" a real state rather than a label.
      if (isBoardTesting(b.id, !!b.adminOnly)) continue;
      if (!b.unlock || b.unlock.board !== boardId) continue;
      const ok = b.unlock.goals ? allGoalsMet(boardId) : (score | 0) >= (b.unlock.score | 0);
      if (ok) out.push(b.id);
    }
    return out;
  }

  /** Goals completed BEFORE this shipped (or on another device - the goals derive from the
   *  synced store) must still open the machine they promise: check once per mount, additive and
   *  idempotent, so nobody is asked to re-earn something the store already proves. */
  _ensureGoalUnlocks() {
    try {
      const sk = (loadStats().games.skeeball || {}).sk || {};
      for (const b of BOARDS) {
        if (isBoardTesting(b.id, !!b.adminOnly)) continue;   // never retroactively unlock a machine still in testing
        if (!b.unlock || !b.unlock.goals) continue;
        if (isUnlocked(sk, b.id, DEFAULT_BOARD)) continue;
        if (!allGoalsMet(b.unlock.board)) continue;
        // BANK IT FIRST, then owe the theatre. The order matters: a player who is granted a
        // machine here and closes the app before ever playing again still owns it.
        unlockSkeeballBoard(b.id);
        armCeremonyOwed(b.id);
      }
    } catch (err) {
      console.error('[skeeball] goal-unlock check failed', err);
    }
  }

  /** WHAT ONE MACHINE'S SLIDE IS, in one place. Three sources decide it and they used to be read
   *  in three places in _renderSetup: the admin config's TESTING/OPEN states over boards.js's
   *  `adminOnly` default (js/admin-config.js), the player's own earned unlock, and - since
   *  2026-08-25 - whether an earned machine still owes the player its lock ceremony.
   *  PENDING can only be true for a machine the player has ALREADY earned; it is never a gate on
   *  anything they own, only on the tap that shows it off. A machine open to everyone by admin
   *  release never waits on a lock, and neither does a dev profile. */
  _slideState(b, sk, devAll) {
    const testing = isBoardTesting(b.id, !!b.adminOnly);
    const earned = !testing && isUnlocked(sk, b.id, DEFAULT_BOARD);
    const released = !testing && isBoardReleased(b.id);
    const pending = earned && !released && !devAll && isLockPending(b.id);
    return { testing, earned, released, pending, open: devAll || released || (earned && !pending) };
  }

  /** The lock falls off. Cosmetic from end to end: clearLockPop only forgets that a ceremony was
   *  owed, and the machine was unlocked before this screen was ever drawn. Selects the machine it
   *  just opened, so the player lands on it rather than having to find it again. */
  _popLock(id) {
    const slide = this.root.querySelector(`.sk-slide-pop[data-board="${id}"]`);
    const btn = slide && slide.querySelector('[data-pop]');
    if (!slide || !btn || btn.disabled) return;
    btn.disabled = true;
    clearLockPop(id);
    const done = () => {
      if (this.disposed || this.screen !== 'setup') return;
      this.settings = saveSettings({ board: id });
      this._renderSetup();
    };
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { done(); return; }
    slide.classList.add('is-popping');
    setTimeout(done, 3700);   // keep in step with the sk-lock-* timeline in skeeball.css
  }

  // --- records ---------------------------------------------------------------------------------

  /** The app-wide best on each machine: derived from the synced player records (js/arcade-scores
   *  appWideBest over js/players-agg rows - deliberately no separate highscores node; see that
   *  file's header). Local history is merged in so a device that has never synced still shows
   *  its own truth. Async and best-effort: the panel renders with the local answer first. */
  async _refreshTopRecords() {
    let rows = [];
    try { rows = aggregatePlayers(await readPlayersOnce(), corrections()); }
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
    // Hub-wide average score across every synced player, PER MACHINE (each board's own points /
    // plays - machines score on different scales, so a blended average would mean nothing), for
    // the game-over card. Falls to nulls offline; the tile shows a dash and fills in once online.
    this.hubAvg = {};
    for (const b of BOARDS) {
      let hubPts = 0, hubGames = 0;
      for (const r of rows) {
        const rec = r && r.games && r.games.skeeball && r.games.skeeball.sk
          && r.games.skeeball.sk.boards && r.games.skeeball.sk.boards[b.id];
        if (rec) { hubPts += rec.points | 0; hubGames += rec.plays | 0; }
      }
      this.hubAvg[b.id] = hubGames ? Math.round(hubPts / hubGames) : null;
    }
    // The setup card's picture has the four records BAKED INTO IT (see _ensureMachineImg),
    // and the hub-wide one only exists once this answer lands - so the first render always
    // painted a dash in that column and never went back for it. Re-ensure whatever slide is
    // still on screen: the image cache is keyed on the records, so this is a no-op unless a
    // number actually moved, and there is nothing to find on the play screen.
    for (const b of BOARDS) {
      const imgEl = this.root.querySelector(`img[data-machine="${b.id}"]`);
      if (imgEl) this._ensureMachineImg(b, imgEl);
    }
    // The network answer is what fills in the All Time column, so repaint the backboard with it.
    this._pushScoreboard();
  }

  /**
   * The four backboard records for a board, labels translated. ONE source for both the live
   * machine and the setup screen's cached picture of it: the picture used to be rendered
   * without ever being handed any values, so the two disagreed on the same screen.
   *
   * The All Time column carries the RECORD HOLDER'S NAME as well as the score - it is the only
   * one of the four that can belong to somebody else. The other three are always this player's.
   * The labels are translated here, because the renderer has no t() of its own.
   */
  _scoreboardFor(boardId) {
    const mine = myRecords(boardId);
    return {
      labels: {
        allTime: t('sb_all_time'),
        best: t('sb_your_best'),
        today: t('sb_today'),
        last: t('sb_last_game'),
      },
      values: {
        allTime: this.top[boardId] || null,
        best: mine.mine || 0,
        today: mine.today || 0,
        last: this.lastScore && this.lastScore.board === boardId ? this.lastScore.score : null,
      },
    };
  }

  /** Hand the live renderer those records. Called on mount, when the network answers with the
   *  app-wide best, and after every finished rack. */
  _pushScoreboard() {
    if (!this.renderer || !this.game) return;
    const sb = this._scoreboardFor(this.game.board.id);
    this.renderer.sbLabels = sb.labels;
    this.renderer.setScoreboard(sb.values);
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
    const board = boardById(this.settings.board);
    const val = (n) => (n ? String(n) : '-');

    // THE DEV BYPASS (Matt, 2026-08-22): a dev profile sees every machine open, so a new machine
    // is playable for testing the moment it deploys, without earning the unlock. Display and
    // selection ONLY - it never writes sk.unlocked, so nothing is earned that was not, and every
    // other player still meets the real lock. A bypass-opened slide is marked TEST so it cannot
    // be mistaken for an earned unlock.
    let devAll = false;
    try { devAll = isDevProfile((loadProfile()?.name || '').trim()); } catch { devAll = false; }

    // RELEASED BY THE ADMIN PAGE (2026-08-24): Matt can open a machine for everybody from inside
    // the app (js/admin-config.js), without anyone earning it and without a deploy. Like the dev
    // bypass above this is READ-TIME only - it never writes sk.unlocked, so nothing is recorded as
    // earned that was not - and unlike the dev bypass it applies to every player. Locking a machine
    // back can therefore never take an EARNED one away (THE LAW rule 2): `earned` is still ORed in
    // below, and it is the half that comes from the player's own store.

    // A swipeable carousel of machines (Matt's call over Escoba's accordion): one slide per
    // machine, each showing that machine's ACTUAL board (render.js render, cached as an image),
    // never a drawing. Locked machines show a padlock. Scroll-snap does the swipe; with one
    // machine there is a single centred card and no carousel chrome.
    const idx = Math.max(0, BOARDS.findIndex((b) => b.id === board.id));
    const slides = BOARDS.map((b) => {
      // Three states, resolved from the admin config over boards.js's `adminOnly` default
      // (js/admin-config.js): TESTING (only a dev profile), UNLOCKABLE (earned the normal way),
      // OPEN (everyone, no unlock needed). A machine in testing is open ONLY to a dev profile and
      // declines to honor an earned unlock while it is set - it honors it again the moment it is
      // not, because the unlock itself is never touched (THE LAW rule 2).
      const { testing, earned, pending, open } = this._slideState(b, sk, devAll);
      // EARNED, BUT THE LOCK HAS NOT BEEN POPPED YET (2026-08-25). The machine is already the
      // player's - sk.unlocked says so and nothing here can take it back - it just has one tap of
      // theatre left on it. Its slide is the locked one with a GOLDEN, pulsing lock and no hint
      // text about earning it, because there is nothing left to earn.
      if (pending) {
        return `<div class="sk-slide sk-slide-locked sk-slide-pop" data-board="${b.id}">
          <div class="sk-lock-peek" aria-hidden="true"><img class="sk-lock-img" data-machine-locked="${b.id}" alt="" /></div>
          <button type="button" class="sk-lock sk-lock--pop" data-pop="${b.id}" aria-label="${esc(t('pop_aria', { name: b.name }))}">${LOCK_SVG}<span class="sk-lock-key">${KEY_SVG}</span></button>
          <p class="sk-slide-name">${esc(b.name)}</p>
          <p class="sk-slide-locktext sk-slide-poptext">${esc(t('pop_hint'))}</p>
        </div>`;
      }
      if (!open) {
        // The locked slide (MACHINE-SPEC section 17): the machine greyed out behind a large
        // lock, with only a SLIVER of the board visible - the picture is the real render, but
        // the CSS window (.sk-lock-peek) crops, greys and blurs it down to a tease.
        const from = b.unlock ? boardById(b.unlock.board) : null;
        // A machine in testing has no unlock a player can chase, so it says so plainly rather
        // than promising a goal that would never open it.
        const hint = testing
          ? t('lock_testing')
          : b.unlock.goals
            ? t('unlock_goals_hint', { name: from.name })
            : t('unlock_hint', { score: b.unlock.score, name: from.name });
        return `<div class="sk-slide sk-slide-locked" data-board="${b.id}">
          <div class="sk-lock-peek" aria-hidden="true"><img class="sk-lock-img" data-machine-locked="${b.id}" alt="" /></div>
          <div class="sk-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
          <p class="sk-slide-name">${esc(b.name)}</p>
          <p class="sk-slide-locktext">${esc(hint)}</p>
        </div>`;
      }
      const r = myRecords(b.id);
      // Your average ON THIS MACHINE (its per-board record - js/arcade-scores.js keeps points
      // and plays per board since 2026-08-11). Dash until it has any plays.
      const bRec = (sk.boards || {})[b.id] || {};
      const myAvg = bRec.plays ? Math.round((bRec.points | 0) / bRec.plays) : null;
      return `<div class="sk-slide" data-board="${b.id}">
        <p class="sk-slide-name">${esc(b.name)}${!earned ? ' <span class="sk-devtag">TEST</span>' : ''}</p>
        <div class="sk-slide-machine"><img class="sk-slide-img" data-machine="${b.id}" alt="${esc(b.name)}" /></div>
        <div class="sk-slide-rec3">
          <div class="sk-slide-rec"><b>${val(r.mine)}</b><em>${esc(t('rec_mine'))}</em></div>
          <div class="sk-slide-rec"><b>${val(r.today)}</b><em>${esc(t('rec_today'))}</em></div>
          <div class="sk-slide-rec"><b>${val(myAvg)}</b><em>${esc(t('over_your_avg'))}</em></div>
        </div>
        <div class="sk-slide-recwide"><em>${esc(t('over_hub_record'))}</em><b data-rec-top="${b.id}">${esc(this._topText(b.id))}</b></div>
      </div>`;
    }).join('');
    const multi = BOARDS.length > 1;

    this.root.innerHTML = `
      <div class="sk-setup">
        <div class="sk-setup-inner">
          <h1 class="sk-title">${esc(t('title'))}</h1>
          <div class="sk-carwrap">
            <div class="sk-car" data-role="car">${slides}</div>
            ${multi ? `<button type="button" class="sk-car-chev l" data-role="prev" aria-label="${esc(t('prev_machine'))}">&#8249;</button>
            <button type="button" class="sk-car-chev r" data-role="next" aria-label="${esc(t('next_machine'))}">&#8250;</button>` : ''}
          </div>
          ${multi ? `<div class="sk-car-dots" data-role="dots">${BOARDS.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : ''}
          <!-- RESUME BELONGS TO ONE MACHINE. It is always in the DOM and shown/hidden by
               _paintSetupActions, because the carousel changes the selected machine without
               re-rendering this screen - and a Resume button that survives the swipe takes you
               to a machine you are not looking at (Matt, 2026-08-24: "it's confusing being taken
               to a different machine"). -->
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume" style="display:none"></button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="howto">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5c-1.6-1-4.2-1.5-6.2-1.5-1 0-1.8.1-1.8.1v12s.8-.1 1.8-.1c2 0 4.6.5 6.2 1.5 1.6-1 4.2-1.5 6.2-1.5 1 0 1.8.1 1.8.1v-12s-.8-.1-1.8-.1c-2 0-4.6.5-6.2 1.5z"/><path d="M12 6.5V18.6"/></svg>
            ${esc(t('howto'))}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="play"></button>
        </div>
      </div>`;

    // Paint each machine's actual board (cached), deferred so the setup shows first. A locked
    // machine gets one too - its slide's CSS reduces it to the greyed sliver behind the lock.
    for (const b of BOARDS) {
      // GUARD: the SAME answer the slide was built from (_slideState). Two copies of this test
      // drifted once already, and a mismatch paints the machine into a picture element that the
      // other branch never rendered - a blank slide.
      const imgEl = this.root.querySelector(this._slideState(b, sk, devAll).open
        ? `img[data-machine="${b.id}"]` : `img[data-machine-locked="${b.id}"]`);
      if (imgEl) this._ensureMachineImg(b, imgEl);
    }

    // The golden lock. One tap, one animation, then the machine is just a machine.
    for (const btn of this.root.querySelectorAll('[data-pop]')) {
      btn.addEventListener('click', () => this._popLock(btn.getAttribute('data-pop')));
    }

    // The centred slide IS the selected machine. Scroll-snap does the swipe; this settle listener
    // pins the selection and the active dot. No-op with one machine (nothing scrolls).
    const car = this.root.querySelector('[data-role="car"]');
    if (car && multi) {
      requestAnimationFrame(() => { car.scrollLeft = idx * car.clientWidth; });
      let rafId = 0;
      car.addEventListener('scroll', () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const w = car.clientWidth || 1;
          const i = Math.max(0, Math.min(BOARDS.length - 1, Math.round(car.scrollLeft / w)));
          const b = BOARDS[i];
          const bOpen = !!b && this._slideState(b, sk, devAll).open;
          if (bOpen && b.id !== this.settings.board) {
            this.settings = saveSettings({ board: b.id });
            // The selection moved, so Resume/Play have to move with it. This screen is not
            // re-rendered on a swipe (the carousel owns its own scroll position), so repaint
            // just the two buttons.
            this._paintSetupActions();
          }
          this.root.querySelectorAll('[data-role="dots"] i').forEach((d, di) => d.classList.toggle('on', di === i));
        });
      }, { passive: true });
      const prev = this.root.querySelector('[data-role="prev"]');
      const next = this.root.querySelector('[data-role="next"]');
      if (prev) prev.addEventListener('click', () => car.scrollBy({ left: -car.clientWidth, behavior: 'smooth' }));
      if (next) next.addEventListener('click', () => car.scrollBy({ left: car.clientWidth, behavior: 'smooth' }));
    }

    // Bound ONCE - neither button is ever recreated, only repainted, so there is nothing here to
    // rebind on a swipe. Both re-read the save at click time rather than closing over the one
    // this render saw.
    this.root.querySelector('[data-role="resume"]').addEventListener('click', () => {
      const snap = loadSave();
      if (snap && snap.board === this.settings.board) this._startGame(snap);
    });
    this.root.querySelector('[data-role="howto"]').addEventListener('click', () => this._showHowTo());
    this.root.querySelector('[data-role="play"]').addEventListener('click', () => {
      // New game DISCARDS a banked mid-rack snapshot - the player's explicit choice (the snapshot
      // is a resume convenience, not earned history; the Resume button sits directly above).
      // GUARD: only when the snapshot is THIS machine's. Pressing Play on a machine you have no
      // round going on must not throw away the round you have going somewhere else.
      const snap = loadSave();
      if (snap && snap.board === this.settings.board) clearSave();
      this._startGame(null);
    });
    this._paintSetupActions();
  }

  /** Resume and Play, against the machine the carousel is currently showing. Resume appears only
   *  on the machine its snapshot belongs to; every other machine offers a plain Play, because a
   *  Resume that follows you across the gallery starts a game on a board you are not looking at.
   *  Called on render and on every carousel settle. */
  _paintSetupActions() {
    const resume = this.root.querySelector('[data-role="resume"]');
    const play = this.root.querySelector('[data-role="play"]');
    if (!resume || !play) return;
    const snap = loadSave();
    const mine = !!snap && snap.board === this.settings.board;
    resume.style.display = mine ? '' : 'none';
    if (mine) {
      resume.innerHTML = `${esc(t('resume'))} &middot; ${(snap.ballsUsed | 0) + 1}/${BALLS_PER_GAME}`;
    }
    play.textContent = t(mine ? 'new_game' : 'play');
    play.classList.toggle('gh-btn--ghost', mine);
    play.classList.toggle('gh-btn--primary', !mine);
  }

  /** Render a machine's ACTUAL board (render.js) to a cached image and show it in `imgEl`,
   *  deferred one frame so the setup paints first. A failure leaves the dark placeholder. */
  _ensureMachineImg(board, imgEl) {
    const sb = this._scoreboardFor(board.id);
    const v = sb.values;
    // GUARD: KEYED ON THE VALUES, not just the board id. The picture has the records baked into
    // it now, so a new personal best has to produce a new picture - keyed on the id alone the
    // setup screen would go on showing yesterday's numbers until the tab was closed.
    const at = v.allTime || {};
    const key = [board.id, at.score || 0, at.name || '', v.best, v.today, v.last].join('|');
    const cached = this._machineImg[key];
    if (cached) { imgEl.src = cached; return; }
    requestAnimationFrame(() => {
      if (this.disposed) return;
      const url = renderMachineImage(board, sb);
      if (!url) return;
      this._machineImg[key] = url;
      imgEl.src = url;
    });
  }

  /** The pause card. This button used to be an INSTANT QUIT: one tap and you were on the
   *  gallery with no way to say you had not meant it. Nothing was ever lost - the autosave
   *  lands after every settled ball - but for the two seconds before you spotted the Resume
   *  button it read as though a live game had been binned (Matt, 2026-08-21). Hub-standard
   *  card, the same .gh-overlay/.gh-modal primitives the game-over one uses. */
  _showPause() {
    // NOT ONCE THE RACK IS OVER. Between the ninth ball settling and the game-over card landing,
    // _showWhenQuiet is holding the card back for the fireworks and the score count-up - and the
    // machines button is still there to tap. Opening the sheet in that gap put a pause card on
    // screen with the game-over card about to append on top of it, and freezing the loop (below)
    // stops _tickScore, so the count-up would never finish and the gap would stretch to
    // _showWhenQuiet's full 4s bound. The card is already coming and carries its own Quit.
    if (!this.game || this.game.over) return;
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal sk-pause" role="dialog" aria-modal="true" aria-label="${esc(t('paused'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        <h2 class="sk-pause-title">${esc(t('paused'))}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${esc(t('resume'))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${esc(t('new_game'))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="gallery">${esc(t('quit'))}</button>
        </div>
      </div>`;
    this._closeOverlay();
    this.root.appendChild(el);
    this.overlay = el;
    // PAUSED MEANS PAUSED (2026-08-26). This sheet said "Paused" and stopped nothing: the loop
    // kept stepping physics behind it, so a ball still in the air when you tapped the machines
    // button went on flying, dropped into a cup, scored, painted its popup and autosaved while
    // you sat reading the menu - and you came back to a number you never watched happen.
    // Stopping the loop also stops the scene rendering under the scrim, which is the performance
    // half. The canvas keeps showing its last frame because render.js sets preserveDrawingBuffer,
    // so the machine sits frozen rather than going black.
    //
    // NOT done for the other two overlays, deliberately: the game-over card has the marquee
    // celebrating a personal best behind it (_rackOver), and the how-to sheet runs a live demo
    // throw on its own canvas. Both have to keep rendering.
    //
    // A ball frozen in flight and then abandoned via Quit is HANDED BACK, not lost: the autosave
    // is written at the last SETTLED ball, so the rack resumes with that throw still owed. Nothing
    // decrements and no history moves (THE LAW rule 2).
    this._stopLoop();
    const close = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (this.overlay === el) this.overlay = null;
      this._startLoop();
    };
    el.querySelector('[data-role="close"]').addEventListener('click', close);
    el.querySelector('[data-role="resume"]').addEventListener('click', close);
    // GUARD: this DISCARDS the live rack, exactly as the gallery's New game does with a banked
    // one. Same rule in both places, so the word means one thing wherever a player meets it.
    el.querySelector('[data-role="new"]').addEventListener('click', () => { close(); clearSave(); this._startGame(null); });
    // Leaving is lossless: the gallery's button will say Resume.
    el.querySelector('[data-role="gallery"]').addEventListener('click', () => { close(); this._renderSetup(); });
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }

  _showHowTo() {
    const board = boardById(this.settings.board);
    // Mancala's how-to chrome (dark modal, white card, chunky OK) but the illustration is a LIVE
    // throw: the real engine (render.js + game.js physics) loops a scoring roll, so it looks like an
    // actual ball was thrown rather than a flat overlay. The caption cross-fades roll -> unlock.
    const el = document.createElement('div');
    el.className = 'sk-hp-veil';
    el.innerHTML = `
      <div class="sk-hp-modal" role="dialog" aria-modal="true" aria-label="${esc(t('howto_h'))}">
        <div class="sk-hp-title">${esc(t('howto_h'))}</div>
        <div class="sk-hp-card">
          <div class="sk-hp-panel"><canvas class="sk-hp-canvas" aria-hidden="true"></canvas></div>
          <p class="sk-hp-cap">
            <span class="c1">${esc(t('ht_roll'))}</span>
            <span class="c2">${esc(t('ht_unlock'))}</span>
          </p>
        </div>
        <button type="button" class="sk-hp-ok" data-role="ok">${esc(t('ht_ok'))}</button>
      </div>`;
    this._closeOverlay();
    this._stopHpDemo();
    this.root.appendChild(el);
    this.overlay = el;
    const canvas = el.querySelector('.sk-hp-canvas');
    // Start after layout so the canvas has real dimensions to size the renderer to.
    if (canvas) requestAnimationFrame(() => { if (this.overlay === el) this._startHpDemo(board, canvas); });
    const close = () => {
      this._stopHpDemo();
      if (el.parentNode) el.parentNode.removeChild(el);
      if (this.overlay === el) this.overlay = null;
    };
    el.querySelector('[data-role="ok"]').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }

  /** WHAT THE THREE OBJECTIVES MEAN, on a tap. Matt, 2026-08-25: "'perfect rounds' must be
   *  defined when you click on the objective." Every box that shows an objective carries
   *  data-def - both rails, the wide total bar, and the game-over tiles - so wherever a player
   *  meets one, tapping it opens this.
   *
   *  It shows ALL THREE, not just the one tapped, with the tapped one lit: a player asking what
   *  one objective means is a player who does not know what any of them mean, and three short
   *  lines cost nothing. Progress comes from the LIVE goals mid-round so the sheet cannot
   *  disagree with the rail that opened it.
   *
   *  GUARD: read-only, and it does not pause. The rack behind it keeps its state (a ball in
   *  flight settles and still scores); nothing here writes. */
  _showGoalDefs(focusId) {
    const boardId = this.game ? this.game.board.id : this.settings.board;
    const goals = this.game ? this._liveGoals() : readGoals(boardId);
    if (!goals || !goals.length) return;
    const el = document.createElement('div');
    el.className = 'sk-hp-veil sk-def-veil';
    const rows = goals.map((g) => `
      <div class="sk-def-row${g.id === focusId ? ' is-focus' : ''}${g.met ? ' is-done' : ''}">
        <div class="sk-def-head">
          <em>${esc(t(g.labelKey))}</em>
          <b>${shortNum(g.now)}/${shortNum(g.target)}</b>
        </div>
        <p class="sk-def-text">${esc(t(g.defKey || 'obj_def_h'))}</p>
      </div>`).join('');
    el.innerHTML = `
      <div class="sk-def-modal" role="dialog" aria-modal="true" aria-label="${esc(t('obj_def_h'))}">
        <button type="button" class="sk-def-x" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        <div class="sk-hp-title">${esc(t('obj_def_h'))}</div>
        <div class="sk-def-rows">${rows}</div>
        <button type="button" class="sk-hp-ok" data-role="ok">${esc(t('ht_ok'))}</button>
      </div>`;
    this._closeOverlay();
    this.root.appendChild(el);
    this.overlay = el;
    const close = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (this.overlay === el) this.overlay = null;
    };
    el.querySelector('[data-role="ok"]').addEventListener('click', close);
    el.querySelector('[data-role="close"]').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
  }

  /** The how-to illustration is a REAL throw, looped: the actual renderer + physics engine, a
   *  measured power that scores the 50, re-thrown after it settles. That is why it looks like a
   *  thrown ball and not an overlay - it IS the game. Torn down by _stopHpDemo on close/destroy. */
  _startHpDemo(board, canvas) {
    try {
      this._stopHpDemo();
      const rect = canvas.getBoundingClientRect();
      const R = new (engineFor(board.id).Renderer)(canvas, board);
      R.resize(Math.max(2, Math.round(rect.width)), Math.max(2, Math.round(rect.height)));
      this._hpRenderer = R;
      this._hpGame = new SkeeballGame(board.id);
      this._hpLast = 0;
      this._hpSettleAt = 0;
      this._hpThrown = false;
      this._hpPending = null;
      // Reduced motion: one still frame (the machine with a ball ready at the serve spot), no loop.
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { R.render(this._hpGame, 0); return; }
      const frame = (ts) => {
        if (!this._hpRenderer || !this._hpGame) return;
        this._hpRaf = requestAnimationFrame(frame);
        const now = ts / 1000;
        const dt = Math.min(this._hpLast ? now - this._hpLast : 1 / 60, 0.05);
        this._hpLast = now;
        this._hpGame.update(dt);
        // Minimal event drain (mirrors _drainEvents): light the rim on capture, pop the score on
        // ballDone, so the demo shows the ball dropping in AND the +50.
        for (const ev of this._hpGame.takeEvents()) {
          if (ev.type === 'capture') { this._hpRenderer.flashHole(ev.hole); this._hpPending = { pos: ev.pos, value: ev.value }; }
          else if (ev.type === 'ballDone') {
            const at = this._hpPending; this._hpPending = null;
            if (at) {
              const gold = at.value >= 100, big = at.value >= 50;
              this._hpRenderer.popupAt(at.pos, signedValue(at.value), gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
              if (big) this._hpRenderer.burstAt(at.pos, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
              if (gold) this._hpRenderer.celebrate();
            }
          }
        }
        this._hpRenderer.render(this._hpGame, dt);
        if (!this._hpGame.ball) {
          if (!this._hpSettleAt) this._hpSettleAt = now;
          const pause = this._hpThrown ? 1.3 : 0.5;
          if (now - this._hpSettleAt > pause) {
            if (this._hpGame.over) this._hpGame = new SkeeballGame(board.id);  // fresh rack, loops forever
            this._hpGame.throwBall({ power: 0.60, aim: 0 });   // measured: a straight 0.60 scores the 50
            this._hpThrown = true;
            this._hpSettleAt = 0;
          }
        } else {
          this._hpSettleAt = 0;
        }
      };
      this._hpRaf = requestAnimationFrame(frame);
    } catch (err) {
      console.error('[skeeball] how-to demo failed', err);
      this._stopHpDemo();
    }
  }

  _stopHpDemo() {
    if (this._hpRaf) { cancelAnimationFrame(this._hpRaf); this._hpRaf = 0; }
    if (this._hpRenderer) { this._hpRenderer.dispose(); this._hpRenderer = null; }
    this._hpGame = null;
    this._hpPending = null;
  }

  // --- play ------------------------------------------------------------------------------------

  _startGame(snap) {
    const board = boardById(this.settings.board);
    this.screen = 'play';
    this.recorded = false;
    this._closeOverlay();
    this.game = snap ? SkeeballGame.restore(snap) : new SkeeballGame(board.id);
    // What was already met before this rack. Anything that turns met from here is fresh.
    this._goalsMet = new Set(readGoalsLive(this.game.board.id, null).filter((g) => g.met).map((g) => g.id));
    this._ceremony = false;
    // THE OBJECTIVES VANISH once this machine has nothing left to ask for (Matt, 2026-08-25).
    // Decided ONCE, here, on purpose: the rack that completes the last one must KEEP its rails on
    // screen, because the ceremony flies those very boxes to the middle of the screen. Hiding
    // them the instant the third one landed would leave it nothing to animate.
    this._goalsHidden = this._goalsSpent();

    const pips = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');

    this.root.innerHTML = `
      <div class="sk-play-wrap">
        <button type="button" class="sk-menu" data-role="machines" aria-label="${esc(t('pause'))}">☰</button>
        <!-- THE LIVE RACK, DIRECTLY ABOVE THE MACHINE. GUARD: this is IN FLOW, above the stage,
             NOT floated over it. Floated, it overlapped the machine's own marquee the moment the
             stage went full-bleed - the renderer fits the machine to whatever height the stage
             has, so anything lying on top of the stage collides with it. In flow, the stage gets
             what is left and the two can never meet. It is no longer a bar at the very top of the
             screen either: that was too far from the board to catch the eye, and it crowded the
             hub's floating Hub button. No TOP/BEST/TODAY strip here - those records are painted
             on the machine's own backboard (render.js setScoreboard), never shown twice. -->
        <div class="sk-rack">
          <div class="sk-hud-name">${esc(this.game.board.name)}</div>
          <div class="sk-score" data-role="score" aria-label="${esc(t('hud_score_aria'))}">${this.game.score}</div>
          <div class="sk-pips" data-role="pips" aria-label="${esc(t('hud_ball'))}">${pips}</div>
        </div>
        <!-- Total points, IN FLOW between the rack and the stage, for the same reason .sk-rack
             is: the stage gets what is left, so this bar can never lie across a machine's
             marquee. It used to be absolutely positioned 25px under the pips - a constant taken
             from THE CLASSIC's band - and on the taller staircase machines that put it straight
             over a designed sign. See skeeball.css's block above .sk-gtotal. -->
        <div class="sk-gtotal-row" data-role="gtotal">${this._goalTotalMarkup()}</div>
        <!-- The other two goals, in the gutters either side of the machine. Absolutely positioned
             against .sk-play-wrap, so this wrapper is only a handle for repainting them. -->
        <div class="sk-grails" data-role="grails">${this._goalRailsMarkup()}</div>
        <div class="sk-stage" data-role="stage">
          <canvas class="sk-canvas" data-role="canvas" role="img" aria-label="${esc(t('aria_lane'))}"></canvas>
          <div class="sk-msg" data-role="msg" aria-live="polite"></div>
          <div class="sk-swipe" data-role="swipe" aria-hidden="true"></div>
        </div>
      </div>`;

    this.el = {
      stage: this.root.querySelector('[data-role="stage"]'),
      canvas: this.root.querySelector('[data-role="canvas"]'),
      score: this.root.querySelector('[data-role="score"]'),
      pips: this.root.querySelector('[data-role="pips"]'),
      grails: this.root.querySelector('[data-role="grails"]'),
      gtotal: this.root.querySelector('[data-role="gtotal"]'),
      msg: this.root.querySelector('[data-role="msg"]'),
      swipe: this.root.querySelector('[data-role="swipe"]'),
    };
    this._shownScore = this.game.score;   // what the counter is currently showing; see _paintHud

    if (this.renderer) this.renderer.dispose();
    this.renderer = new (engineFor(this.game.board.id).Renderer)(this.el.canvas, this.game.board);
    this._pushScoreboard();
    this._pushOwedSlots();
    this._bindPlay();
    if (!this._fit()) this._fitWhenLaidOut();
    // Watch the STAGE ELEMENT for size changes, not just the viewport. On the first load after
    // a deploy the stage measures before skeeball.css has re-fetched, so _fit() succeeds at the
    // unstyled size and nothing re-fits when the stylesheet lands - the machine rendered
    // squashed into the top half until the game was closed and reopened (Matt, 2026-08-23).
    // onViewportResize cannot see that reflow (the window never resized); only the element can.
    // Coalesced to one _fit per frame; _fit() itself is a no-op when nothing changed materially.
    if (this._ro) this._ro.disconnect();
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => {
        if (this._roRaf) return;
        this._roRaf = requestAnimationFrame(() => { this._roRaf = 0; this._fit(); });
      });
      this._ro.observe(this.el.stage);
    }
    this._startLoop();
  }

  _bindPlay() {
    this.root.querySelector('[data-role="machines"]').addEventListener('click', () => this._showPause());
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

    // The throw's params, logged with their real result at ballDone (see _drainEvents /
    // _logThrow), so there is measured data (flick -> power -> launch -> actual hole) and not
    // just the calculation. GUARD: this is RECORDED, never displayed. The on-screen readout of it
    // came off 2026-08-20 - players have no use for it - but the logging behind it stays, because
    // it is the only way to check the curve against people who are not Matt. Read it back with
    // read-skeeball-throws.mjs.
    const launch = launchSpeed(power, this.game.board.geom.minSpeed, this.game.board.geom.maxSpeed);

    // AIM: the direction of the whole swipe, eased so a small wobble stays small and a
    // deliberate diagonal still reaches the corner 100s. This shapes the INPUT only - once
    // thrown, the ball is the engine's and is never touched again: no magnetism, no correction.
    // GUARD: the divisor is set by the real maximum diagonal a thumb can reach on a 393px
    // screen, not a round number - too large a divisor and the corner 100s need a swipe angle
    // that physically doesn't fit on the screen, making them unreachable.
    const raw = Math.max(-1, Math.min(1, Math.atan2(end.x - first.x, first.y - end.y) / 0.38));
    const aim = Math.sign(raw) * (raw * raw);

    if (this.game.throwBall({ power, aim })) {
      // Held until the ball settles, then logged with its real result at ballDone.
      this._lastThrow = { flick: +perH.toFixed(3), power: +power.toFixed(3), aim: +aim.toFixed(3), launch: +launch.toFixed(3) };

      this._throwStats = { bounces: 0, backboard: 0, impact: false, impactSpeed: null, seq: [],
        t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
    }
  }

  /** THE ONLY THING THIS GAME SENDS ANYWHERE BESIDES A SCORE. One settled throw's inputs and its
   *  real result, pushed to skeeballThrows/<deviceId>/, so the swipe curve can be checked against
   *  people who are not Matt rather than against the calculation. Kept deliberately for that
   *  (2026-08-20); it is what will say whether the 100 is reachable in real hands.
   *
   *  Best-effort and fire-and-forget: throwaway instrumentation, not player history, so a failed
   *  write is dropped rather than queued and never blocks the game. Read it back with
   *  read-skeeball-throws.mjs.
   *
   *  GUARD: NO CONTACT JOURNEY. This used to carry every part the ball touched on the way down -
   *  up to 300 entries per throw, per player, nine times a game. That existed to chase physics
   *  bugs which are now fixed, and nothing has read it since. What stays is what calibration
   *  actually needs: the flick, the power it mapped to, the aim, the launch speed, where it
   *  landed and how long it took. */
  async _logThrow(rec) {
    const full = { ...rec, board: (this.game && this.game.board.id) || this.settings.board,
      name: (loadProfile() || {}).name || '', at: Date.now() };
    try {
      const boot = await getStatsApp();
      if (!boot) return;
      const { db, api } = boot;
      await api.set(api.push(api.ref(db, 'skeeballThrows/' + deviceId())), full);
    } catch { /* throwaway instrumentation: a dropped write never becomes a player-visible error */ }
  }

  // --- the frame -------------------------------------------------------------------------------

  _frame(ts) {
    // A destroyed UI's chain ENDS here. `_frame` used to reschedule itself before looking at
    // anything, so a loop left running past destroy() re-armed itself for the life of the page -
    // doing nothing, forever, once per frame, one chain per rack ever played.
    if (this.disposed) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(this._loop);
    if (!this.game || !this.renderer) return;
    const now = ts / 1000;
    const dt = Math.min(this.last ? now - this.last : 1 / 60, 0.05);
    this.last = now;
    this.game.update(dt);
    this._drainEvents();
    this.renderer.render(this.game, dt);
    this._tickScore(dt);
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.el.msg.classList.remove('is-on');
        // The node is aria-live. Leaving the word in it after the fade means a screen reader goes
        // on announcing a MISS! from several throws ago, so the text goes out with the opacity.
        this.el.msg.textContent = '';
      }
    }
  }

  /** THE ONLY WAY THE RENDER LOOP IS STARTED, and idempotent on purpose (2026-08-26).
   *
   *  THE BUG THIS FIXES, measured in a browser: `_startGame` used to arm a rAF chain
   *  unconditionally, and two buttons reach it with a chain ALREADY RUNNING - the pause sheet's
   *  New game and the game-over card's Play again. Each one therefore left an extra chain behind,
   *  and they accumulate: one rack -> 1 loop, then 2, then 3, then 4, every one of them stepping
   *  physics and rendering the same scene on every frame. Counted directly (a rAF ticker beside
   *  a counter inside `_frame`): 1.00, then 2.00, 3.00, 4.00 `_frame` calls per animation frame
   *  after three New games, with the browser's own frame rate falling from 22fps to 7.5fps as it
   *  went. That is Matt's "slow and choppy", and it is why it gets WORSE the longer you play.
   *
   *  `_stopLoop()` could never clean it up either: `this.raf` only ever holds the LAST chain's id,
   *  so quitting to the gallery cancelled one and left the rest running behind the carousel.
   *
   *  `last = 0` is what makes the frame after a pause safe: `_frame` reads `this.last ? ... : 1/60`,
   *  so a stale timestamp from before the sheet opened can never arrive as one giant dt and bunch
   *  a rack's worth of 240Hz substeps into a single frame. */
  _startLoop() {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this._loop);
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
      const ts = this._throwStats;
      if (ts && ev.type !== 'contact') {
        ts.seq.push(ev.type);
        if (ev.type === 'bounce') ts.bounces++;
        else if (ev.type === 'backboard') ts.backboard++;
        else if (ev.type === 'impact') { ts.impact = true; if (ts.impactSpeed == null && typeof ev.speed === 'number') ts.impactSpeed = +ev.speed.toFixed(2); }
      }
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
        // GUARD: a returned ball says NOTHING. It used to call "Too soft. Have it back." - a
        // scolding for a throw the player just watched fall short, and the most frequent message
        // in the game. Silence reads better; the ball rolling back IS the message.
        case 'returned':
          this._pending = null;
          break;
        case 'ballDone': {
          const at = this._pending;
          this._pending = null;
          if (at && ev.eq) {
            // An equalizer cup (POPONGO's black): the popup says what it took, not what it paid.
            // The minus sign carries the meaning; the red is emphasis, never the signal.
            Rr.popupAt(at.pos, ev.wiped ? `−${ev.wiped}` : '0', '#ff6b5e', !!ev.wiped);
          } else if (at) {
            // The board's OWN scale decides what counts as a big deal: the classic's 50/100
            // thresholds read as literal values, so on a 1-6 cup board nothing would ever
            // celebrate. Gold = the machine's best cup, big = over half of it.
            const topValue = Math.max(...Object.values(this.game.board.geom.holes).map((h) => h.value | 0));
            const gold = at.value > 0 && at.value >= topValue, big = at.value >= topValue / 2;
            Rr.popupAt(at.pos, signedValue(at.value), gold ? '#ffd977' : big ? '#ff9d3d' : '#fff6e0', big);
            if (big) Rr.burstAt(at.pos, gold ? '#ffd977' : '#ff9d3d', gold ? 22 : 14);
            if (gold) Rr.celebrate();
          }
          this._paintHud();
          // GUARD: only with NOTHING in the air. A snapshot has no room for a ball in flight,
          // so saving mid-flight would quietly drop it and hand the player a free re-throw.
          if (!this.game.balls.length) writeSave(this.game.snapshot());
          if (this._lastThrow) {
            const ts = this._throwStats || {};
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            this._logThrow({ ...this._lastThrow, value: ev.value | 0, hole: String(ev.hole || '-'),
              bounces: ts.bounces | 0, backboard: ts.backboard | 0, touchedBoard: !!ts.impact,
              impactSpeed: (ts.impactSpeed != null ? ts.impactSpeed : null),
              settleMs: (ts.t0 ? Math.round(now - ts.t0) : null),
              seq: (ts.seq || []).join(','),
              drop: (at && at.pos) ? { x: +at.pos.x.toFixed(3), y: +at.pos.y.toFixed(3), z: +at.pos.z.toFixed(3) } : null });
            this._lastThrow = null; this._throwStats = null;
          }
          break;
        }
        case 'rackOver':
          this._rackOver(ev.result);
          break;
        default: break;                      // launch/impact/bounce/throw: the canvas already shows them
      }
    }
  }

  /** GUARD: the score is NOT written straight to the element here. It used to be, and points
   *  landing was a silent digit swap that was genuinely easy to miss - the ball, the burst and
   *  the number all happened at once and the number lost. _frame runs the count up to the new
   *  total (see _tickScore) and this only sets the target and fires the flash. */
  _paintHud() {
    this.el.score.classList.remove('is-hit');
    if (this.game.score > this._shownScore) {
      // reflow, so re-adding the class restarts the animation on a second score in a row
      void this.el.score.offsetWidth;
      this.el.score.classList.add('is-hit');
    } else {
      this._shownScore = this.game.score;      // a new rack: no run-up, just show it
      this.el.score.textContent = String(this.game.score);
    }
    this.el.pips.innerHTML = Array.from({ length: BALLS_PER_GAME }, (_, i) =>
      `<i class="${i < this.game.ballsUsed ? 'is-used' : ''}"></i>`).join('');
    // The rails move on the same beat: a settled ball can change all three numbers.
    this._paintGoalRails();
    this._pushOwedSlots();
    this._checkGoalsNow();
  }

  /** THE BASKETS YOU STILL OWE, handed to the renderer so it can light their value cards
   *  (render.js setOwedSlots). Same source as the "every basket" objective - the per-board
   *  `slots` set from js/arcade-scores.js, unioned with what this round has already hit - so the
   *  face and the rail can never disagree.
   *
   *  Sends NULL once every basket is accounted for, which puts every card back to its built-in
   *  brightness. A machine whose objective does not count baskets never gets a call at all, so
   *  nothing here can light up a board that has no such goal. */
  _pushOwedSlots() {
    if (!this.renderer || typeof this.renderer.setOwedSlots !== 'function' || !this.game) return;
    const board = this.game.board;
    const ids = Object.keys((board.geom && board.geom.holes) || {});
    if (!ids.length) return;
    let sk = {};
    try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
    const rec = ((sk.boards || {})[board.id] || {}).slots || {};
    const seen = new Set(Object.keys(rec).filter((k) => rec[k]));
    const rack = this.game.result();
    if (rack && Array.isArray(rack.slotsHit)) for (const id of rack.slotsHit) seen.add(id);
    const owed = ids.filter((id) => !seen.has(id));
    this.renderer.setOwedSlots(owed.length ? owed : null);
  }

  /** Run the displayed score up to the real one. Deliberately quick - this is a machine totting
   *  up, not a progress bar - and always lands exactly on the target rather than easing into it. */
  _tickScore(dt) {
    if (!this.el || !this.el.score) return;
    const target = this.game.score;
    if (this._shownScore === target) return;
    // Whole points per second, scaled to the gap, so a 10 and a 100 both take about a third of
    // a second rather than the 100 taking ten times as long.
    const step = Math.max(1, Math.ceil((target - this._shownScore) * dt * 4.5));
    this._shownScore = Math.min(target, this._shownScore + step);
    this.el.score.textContent = String(this._shownScore);
  }

  _say(text) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('is-on');
    // 0.7s, down from 0.9 and 1.8 before that. The next ball arrives on TOUCHDOWN (~1.2s), so a
    // longer message is still sitting over the lane when the player is lining up the next throw
    // (Matt, 2026-08-21), and a score popup - the thing a MISS is now sized to match - is fully
    // faded by 1.1s (render.js's _popups). Matt again, 2026-08-24: "stays too long."
    this.msgTimer = 0.7;
  }

  /** THE THREE GOALS, live on the lane: two rails in the gutters either side of the machine.
   *
   *  GUARD: THESE LIE OVER THE STAGE, which .sk-rack deliberately does not. That is safe only
   *  because they sit in the gutters frame.mjs measures - 66px clear at the board's widest
   *  point, wider further up - and never over the board itself. Re-run frame.mjs before moving
   *  either one inward, and keep pointer-events: none on them so a rail can never eat a swipe.
   *
   *  GUARD: ALL THREE LIVE IN THE GUTTERS. Total points used to sit CENTRED between the ball
   *  count and the top of the marquee, on a band measured at 48-72px. That band is THE CLASSIC's:
   *  frame.mjs builds its geometry from BOARDS[0] and machines/classic/machine.js, and the
   *  staircase machines stand taller, so on those the chip landed ON the marquee - across the
   *  lettering of a sign somebody designed. Matt, 2026-08-24: "obviously I don't want the
   *  objectives to cover any machine." The gutters are the only space on this screen that is
   *  measured clear for EVERY board, so the third goal joins the second there rather than
   *  sitting on a band that only one machine's geometry guarantees. Nothing here may go back to
   *  centre without a per-machine measurement that does not exist.
   *
   *  Read fresh every time rather than cached on `this`: a rack recorded on another device
   *  moves them. js/goals.js explains why nothing is stored here. */
  /** THE MACHINE'S OWN three goals (js/goals.js is per-machine), live against the rack in
   *  progress. Every one of them is keyed by its own labelKey, so nothing here has to know
   *  whose goals it is painting. */
  _liveGoals() {
    const rack = this.game ? this.game.result() : null;
    const boardId = this.game ? this.game.board.id : this.settings.board;
    return readGoalsLive(boardId, rack);
  }

  /** The two goals that ride the gutters: the signature goal - the one that names a shot rather
   *  than a number - on the left, the single-game score on the right. ONE BOX PER RAIL. The
   *  third used to stack under this one; it is the wide bar above the machine now. */
  /** True when this machine's three objectives have nothing left to say: all three met, AND
   *  whatever they open is already in the player's hands with its lock popped. A TERMINAL machine
   *  (POPONGO opens nothing) is spent on all-three-met alone - waiting for an unlock that can
   *  never happen would leave its rails up forever. Anything unreadable here answers NO, so the
   *  failure mode is showing the objectives, never hiding something still owed. */
  _goalsSpent() {
    try {
      const boardId = this.game ? this.game.board.id : this.settings.board;
      if (!readGoalsLive(boardId, null).every((g) => g.met)) return false;
      const opens = BOARDS.filter((b) => b.unlock && b.unlock.goals && b.unlock.board === boardId
        && !isBoardTesting(b.id, !!b.adminOnly));
      if (!opens.length) return true;
      const sk = (loadStats().games.skeeball || {}).sk || {};
      // A machine that owes its ceremony is NOT spent, even though it is already banked: the
      // ceremony flies these very boxes to the middle of the screen, so hiding them would leave
      // it nothing to animate and the player would never see what they earned.
      return opens.every((b) => isUnlocked(sk, b.id, DEFAULT_BOARD)
        && !isLockPending(b.id) && !isCeremonyOwed(b.id));
    } catch { return false; }
  }

  _goalRailsMarkup() {
    if (this._goalsHidden) return '';
    const [g1, g2] = this._liveGoals();
    // role=button + tabindex, never a real <button>: Safari before 16.4 will not lay a <button>
    // out reliably as a flex container, and .sk-gtotal below IS one (docs/BUILDING-A-GAME.md,
    // Part 0). The three objective boxes are one component, so they take one shape.
    const box = (g) => `
      <div class="sk-goal${g.met ? ' is-done' : ''}" data-goal="${g.id}" data-def="${g.id}"
        role="button" tabindex="0" aria-label="${esc(`${t(g.labelKey)} ${g.now}/${g.target}. ${t(g.defKey || 'obj_def_h')}`)}">
        <em>${esc(t(g.labelKey))}</em>
        <b>${shortNum(g.now)}<i>/${shortNum(g.target)}</i></b>
        <span class="sk-goal-bar"><i style="width:${Math.round((100 * g.now) / g.target)}%"></i></span>
      </div>`;
    return `
      <div class="sk-grail sk-grail--l">
        ${box(g1)}
      </div>
      <div class="sk-grail sk-grail--r">
        ${box(g2)}
      </div>`;
  }

  /** The RUNNING TOTAL - the third goal on every machine, and the slowest-moving of the three,
   *  which is why it is the one that can sit furthest from the eye. One wide row above the
   *  machine. GUARD: it carries data-goal like the rail boxes do, because _checkGoalsNow finds
   *  the box to pop by that attribute; drop it and completing this goal stops being celebrated. */
  _goalTotalMarkup() {
    if (this._goalsHidden) return '';
    const g = this._liveGoals()[2];
    if (!g) return '';
    return `
      <div class="sk-gtotal${g.met ? ' is-done' : ''}" data-goal="${g.id}" data-def="${g.id}"
        role="button" tabindex="0" aria-label="${esc(`${t(g.labelKey)} ${g.now}/${g.target}. ${t(g.defKey || 'obj_def_h')}`)}">
        <em>${esc(t(g.labelKey))}</em>
        <b>${shortNum(g.now)}<i>/${shortNum(g.target)}</i></b>
        <span class="sk-goal-bar"><i style="width:${Math.round((100 * g.now) / g.target)}%"></i></span>
      </div>`;
  }

  /** The same three on the game-over card, in the SAME tile as the four stats above them so the
   *  card reads as one thing rather than as something bolted on. Cups hit opens a row naming
   *  which values are still owed - three identical numbers cannot say that on their own.
   *  Reads the recorded store, not the live rack: by the time this card exists the rack is in. */
  _goalTilesMarkup() {
    const boardId = this.game ? this.game.board.id : this.settings.board;
    const goals = readGoals(boardId);
    // The header says what completing these actually does: 'Next machine' when another machine's
    // unlock hangs off this board's goals, plain 'Objectives' when nothing does (POPONGO today) -
    // promising a next machine that does not exist would be a lie on a reward card.
    const opensNext = BOARDS.some((b) => b.unlock && b.unlock.goals && b.unlock.board === boardId);
    const head = opensNext ? t('goals_h') : t('goals_obj_h');
    // All three done: the tiles have nothing left to say, so they go and the unlock takes the
    // space. Three tiles reading 5/5, 360/360, 10k/10k are a receipt, not a reward.
    if (goals.every((g) => g.met)) {
      return `<div class="sk-gwon"><em>${esc(head)}</em><b>${esc(t(opensNext ? 'goals_unlocked' : 'goals_done'))}</b></div>`;
    }
    const tile = (g) => `
      <div class="sk-gtile${g.met ? ' is-done' : ''}" data-def="${g.id}" role="button" tabindex="0"
        aria-label="${esc(`${t(g.labelKey)} ${g.now}/${g.target}. ${t(g.defKey || 'obj_def_h')}`)}">
        <b>${shortNum(g.now)}/${shortNum(g.target)}</b><span>${esc(t(g.labelKey))}</span>
      </div>`;
    return `
      <div class="sk-gsep"><span>${esc(head)}</span></div>
      <div class="sk-gtiles">
        ${goals.map(tile).join('')}
      </div>`;
  }

  /** GUARD: A GOAL IS CELEBRATED THE MOMENT IT LANDS, not when the rack ends. This used to run
   *  off _rackOver, comparing the goals before and after the rack was recorded - so a fifth
   *  100 thrown on ball 3 was celebrated after ball 9, behind the game-over card, and nothing
   *  whatsoever marked the moment it happened (Matt, 2026-08-21). It reads the LIVE goals, so
   *  the rack in progress counts, and `_goalsMet` makes each one fire exactly once. */
  /** THE CEREMONY A RETROACTIVE GRANT NEVER GOT (2026-08-25, and see CEREMONY_KEY at the top of
   *  this file). Nothing here is fresh - the objectives were finished days ago and the machine is
   *  already banked - so `_checkGoalsNow` below can never fire it: it only celebrates a goal that
   *  turns met while you watch.
   *
   *  Matt's trigger, in his words: "the next time he scores a single point in hot shot, the
   *  animation plays." So: a round on the parent machine, a score above zero, and the objectives
   *  still genuinely all met in the RECORDED store (never the live rack - a machine's own goals
   *  cannot be re-earned, and reading the store is what the unlock itself trusts).
   *
   *  It grants nothing, takes nothing, and can run at most once per owed machine. */
  _checkOwedCeremony() {
    if (!this.game || this._ceremony) return;
    if ((this.game.score | 0) <= 0) return;
    const boardId = this.game.board.id;
    const owed = BOARDS.some((b) => b.unlock && b.unlock.goals && b.unlock.board === boardId
      && !isBoardTesting(b.id, !!b.adminOnly) && isCeremonyOwed(b.id));
    if (!owed || !allGoalsMet(boardId)) return;
    this._unlockCeremony();
  }

  _checkGoalsNow() {
    if (!this.game || !this._goalsMet) return;
    this._checkOwedCeremony();
    const live = readGoalsLive(this.game.board.id, this.game.result());
    const fresh = live.filter((g) => g.met && !this._goalsMet.has(g.id));
    if (!fresh.length) return;
    for (const g of fresh) {
      this._goalsMet.add(g.id);
      // Applied AFTER the repaint above, so it survives until the next ball and the one-shot
      // animation plays once rather than restarting on every beat.
      const box = this.root.querySelector(`[data-goal="${g.id}"]`);
      if (box) box.classList.add('is-fresh');
    }
    const all = live.every((g) => g.met);
    this._fireworks(fresh.length, all);
    // ALL THREE, JUST NOW. _goalsMet makes each goal fire exactly once, so this can only be the
    // rack that completed the set - never a later one on a finished machine.
    if (all) this._unlockCeremony();
  }

  /** THE UNLOCK CEREMONY (Matt, 2026-08-25). The three objective boxes turn gold, fly together to
   *  the middle of the screen, merge into one pulsing blob, shrink to a point, and a golden key
   *  pops out of it - all on the lane, ahead of the game-over card, which waits on _fwUntil.
   *
   *  GUARD: THIS IS THEATRE OVER AN UNLOCK THAT IS ALREADY BANKED. _rackOver writes sk.unlocked
   *  the moment the rack lands (additive, THE LAW rule 2) and _ensureGoalUnlocks catches anything
   *  earned on another device. NOTHING HERE GRANTS ANYTHING - it only arms the gallery's golden
   *  lock, so a player who skips it, misses it, or force-quits mid-ceremony still owns the
   *  machine. Silent under reduced motion, exactly like _fireworks; the game-over card still says
   *  UNLOCKED and the gallery still opens the machine.
   *
   *  IT WAITS FOR A TAP. The key, the machine's name and an OK button hold on screen until the
   *  player dismisses them; the game-over card is behind that, not behind a timer.
   *
   *  It fires the moment the third objective lands, which can be ball 3 - the unlock itself is
   *  banked at ball 9. Quitting in between leaves the flag armed against a machine not yet
   *  earned, which the gallery reads as still locked (pending requires `earned`); the next
   *  finished rack banks it and the lock is waiting. Nothing is lost either way. */
  _unlockCeremony() {
    if (!this.game || !this.root || this._ceremony) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const boardId = this.game.board.id;
    let sk = {};
    try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
    // The machine this opens, if it opens one and the player does not already have it. A terminal
    // machine (POPONGO) opens nothing, and gets fireworks without a key rather than a lie.
    // ...OR one they already hold that has never been celebrated (see CEREMONY_KEY above): a
    // machine granted retroactively is banked before its ceremony is owed, so "not unlocked yet"
    // alone would silently skip the only showing it will ever get.
    const next = BOARDS.find((b) => b.unlock && b.unlock.goals && b.unlock.board === boardId
      && !isBoardTesting(b.id, !!b.adminOnly)
      && (!isUnlocked(sk, b.id, DEFAULT_BOARD) || isCeremonyOwed(b.id)));
    if (!next) return;
    const wrap = this.root.querySelector('.sk-play-wrap');
    const boxes = Array.from(this.root.querySelectorAll('[data-goal]'));
    if (!wrap || !boxes.length) return;

    this._ceremony = true;
    // It is being paid right now, so it is no longer owed. Cleared BEFORE the animation rather
    // than after, so a player who quits half way through is not shown it again on their next
    // point - the lock pop below is the half that survives leaving.
    clearCeremonyOwed(next.id);
    armLockPop(next.id);

    const host = wrap.getBoundingClientRect();
    // Where the three meet: mid-width, a little above centre, so the key ends up clear of the
    // machine's own marquee and of the game-over card that follows it.
    const cx = host.width / 2;
    const cy = host.height * 0.44;
    const tiles = boxes.map((el, i) => {
      const r = el.getBoundingClientRect();
      const left = r.left - host.left;
      const top = r.top - host.top;
      const label = (el.querySelector('em') || {}).textContent || '';
      const tx = Math.round(cx - (left + r.width / 2));
      const ty = Math.round(cy - (top + r.height / 2));
      return `<span class="sk-cer-tile" style="left:${Math.round(left)}px;top:${Math.round(top)}px;`
        + `width:${Math.round(r.width)}px;height:${Math.round(r.height)}px;`
        + `--tx:${tx}px;--ty:${ty}px;--d:${(i * 0.07).toFixed(2)}s">`
        + `<b>${esc(label)}</b></span>`;
    }).join('');

    const el = document.createElement('div');
    el.className = 'sk-cer';
    el.innerHTML = `${tiles}
      <span class="sk-cer-blob" style="left:${Math.round(cx)}px;top:${Math.round(cy)}px" aria-hidden="true"></span>
      <span class="sk-cer-point" style="left:${Math.round(cx)}px;top:${Math.round(cy)}px" aria-hidden="true"></span>
      <span class="sk-cer-key" style="left:${Math.round(cx)}px;top:${Math.round(cy)}px" aria-hidden="true">${KEY_SVG}</span>
      <span class="sk-cer-say" style="top:${Math.round(cy + host.height * 0.17)}px">
        <em>${esc(t('cer_unlocked'))}</em><b>${esc(next.name)}</b>
      </span>
      <button type="button" class="sk-cer-ok" style="top:${Math.round(cy + host.height * 0.30)}px">${esc(t('cer_ok'))}</button>`;
    wrap.classList.add('sk-cer-on');
    wrap.appendChild(el);

    // IT ENDS ON THE PLAYER'S TAP, not on a timer (Matt, 2026-08-25: "make them have to click to
    // get rid of it"). _showWhenQuiet holds the game-over card for as long as _ceremony is true
    // and is NOT bounded by its own 4s while it is - that bound is there for a stuck score
    // counter, not for something deliberately waiting on a person. The 60s backstop below is what
    // makes that safe: a player who puts the phone down still gets their card.
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(bail);
      el.classList.add('is-out');
      setTimeout(() => {
        el.remove();
        if (this.disposed) return;
        wrap.classList.remove('sk-cer-on');
        // The objectives are spent now, so they do not come back for the rest of this rack -
        // which is the other half of what Matt asked for.
        this._ceremony = false;
        this._goalsHidden = true;
        this._paintGoalRails();
      }, 460);
    };
    const bail = setTimeout(close, 60000);
    el.querySelector('.sk-cer-ok').addEventListener('click', close);
    // The fireworks' own hold still covers the opening beats, in case anything below it changes.
    this._fwUntil = Math.max(this._fwUntil || 0, Date.now() + 3200);
  }

  /** Repaint all three objectives. Called wherever the ball count is repainted, which is the
   *  same moment any of the three numbers can have moved. TWO TARGETS since the total moved out
   *  of the right rail: repaint one and the other silently stops updating mid-rack. */
  _paintGoalRails() {
    if (!this.el) return;
    // The ceremony owns those boxes while it runs - repainting them mid-flight would put the
    // originals back underneath the gold ones it is animating.
    if (this._ceremony) return;
    if (this.el.grails) this.el.grails.innerHTML = this._goalRailsMarkup();
    if (this.el.gtotal) this.el.gtotal.innerHTML = this._goalTotalMarkup();
  }

  /** One firework per goal just earned, a bigger volley when that completed the set. Fired from
   *  _rackOver, which reads the goals BEFORE recording the rack and again after, so it celebrates
   *  the rack that actually earned it and can never fire twice for the same goal.
   *  GUARD: silent under reduced motion - the goals panel still says what was earned. */
  _fireworks(n, big) {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !this.root) return;
    const host = document.createElement('div');
    host.className = 'sk-fw' + (big ? ' is-big' : '');
    host.setAttribute('aria-hidden', 'true');
    const shots = big ? 7 : n;
    let html = '';
    for (let i = 0; i < shots; i++) {
      // Spread across the upper half, each a beat after the last, so they read as several
      // fireworks rather than one flash. Every spark is one element: cheap, and nothing to
      // tear down afterwards but the host.
      const x = 12 + (76 * (i + 0.5)) / shots + (i % 2 ? 6 : -6);
      const y = 18 + (i % 3) * 12;
      const delay = (i * (big ? 0.16 : 0.22)).toFixed(2);
      const hue = big ? [45, 28, 8, 45, 28, 8, 45][i % 7] : [45, 28, 8][i % 3];
      let sparks = '';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        sparks += `<i style="--dx:${(Math.cos(a) * 100).toFixed(0)}px;--dy:${(Math.sin(a) * 100).toFixed(0)}px"></i>`;
      }
      html += `<span class="sk-fw-burst" style="left:${x.toFixed(1)}%;top:${y}%;--d:${delay}s;--h:${hue}">${sparks}</span>`;
    }
    host.innerHTML = html;
    this.root.appendChild(host);
    const runs = big ? 3200 : 2400;
    // The game-over card waits for this. A goal earned on the ninth ball used to be covered by
    // the card the instant it landed (Matt, 2026-08-21).
    this._fwUntil = Math.max(this._fwUntil || 0, Date.now() + runs);
    setTimeout(() => host.remove(), runs);
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
        // A machine still in TESTING records to sk.practice and touches nothing else (Matt,
        // 2026-08-24, after two boards handed out scores while they were being tuned). The flag is
        // resolved at RECORD time, so the rack is judged by the machine's state when it was thrown.
        const practice = isBoardTesting(board.id, !!board.adminOnly);
        recordSkeeball(board.id, { ...result, at: Date.now(), practice });
      } catch (err) {
        console.error('[skeeball] could not record the rack', err);
      }
      try {
        for (const id of this._earnedUnlocks(board.id, result.score)) unlockSkeeballBoard(id);
      } catch (err) {
        console.error('[skeeball] could not store an earned unlock', err);
      }
      try { syncMyStats(); } catch (err) { console.error('[skeeball] stats sync could not start', err); }
      clearSave();
    }
    this.lastScore = { board: board.id, score: result.score };

    // Nothing is celebrated here any more: _checkGoalsNow fires the moment a goal lands, off
    // the live reading. Firing again from the recorded one would double every celebration.

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

    // One pill on the score, strongest claim first: machine record > personal best > best today.
    const pillKey = isTop ? 'over_new_top' : isMine ? 'over_new_mine' : isToday ? 'over_new_today' : '';
    const pill = pillKey ? `<span class="gh-chip gh-chip--accent sk-over-pill">${esc(t(pillKey))}</span>` : '';

    // Your average ON THIS MACHINE: its per-board points / plays, from the store this rack was
    // just written to (a blended cross-machine average reads as wrong the moment two machines
    // score on different scales - a 30 popongo rack is a good one, a 30 classic rack is not).
    let myAvg = null;
    try {
      const sk = (loadStats().games.skeeball || {}).sk || {};
      const bRec = (sk.boards || {})[board.id] || {};
      if (bRec.plays) myAvg = Math.round((bRec.points | 0) / bRec.plays);
    } catch { /* no stats is fine - the tile shows a dash */ }
    const dash = (n) => (n == null || n === '' || n === 0 ? '-' : String(n));

    // Hub-standard card (batch G): css/ui.css's .gh-overlay + .gh-modal, so it follows the hub
    // theme, plus the .sk-over-* skin for the score, the hub-wide-record row and the stat tiles.
    const el = document.createElement('div');
    el.className = 'gh-overlay sk-over-veil';
    el.innerHTML = `
      <div class="gh-modal sk-over" role="dialog" aria-label="${esc(t('over_h'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        <h2 class="sk-over-title">${esc(t('over_h'))}</h2>
        <p class="sk-over-machine">${esc(board.name)}</p>
        <p class="sk-over-score">${result.score}</p>
        ${pill}
        <div class="sk-over-rec">
          <em>${esc(t('over_hub_record'))}</em>
          <b>${esc(this._topText(board.id))}</b>
        </div>
        <div class="sk-over-tiles">
          <div class="sk-over-tile"><b>${dash(now.mine)}</b><span>${esc(t('rec_mine'))}</span></div>
          <div class="sk-over-tile"><b>${dash(now.today)}</b><span>${esc(t('rec_today'))}</span></div>
          <div class="sk-over-tile"><b>${dash(myAvg)}</b><span>${esc(t('over_your_avg'))}</span></div>
          <div class="sk-over-tile"><b>${dash(this.hubAvg && this.hubAvg[board.id])}</b><span>${esc(t('over_hub_avg'))}</span></div>
        </div>
        ${this._goalTilesMarkup()}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${esc(t('over_again'))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="gallery">${esc(t('quit'))}</button>
        </div>
      </div>`;
    this._closeOverlay();
    this._showWhenQuiet(el);
    this.overlay = el;
    if (isMine || isTop) this.renderer.celebrate();
    el.querySelector('[data-role="again"]').addEventListener('click', () => this._startGame(null));
    el.querySelector('[data-role="gallery"]').addEventListener('click', () => this._renderSetup());
    // The X closes to the gallery rather than leaving a finished rack behind the sheet.
    el.querySelector('[data-role="close"]').addEventListener('click', () => this._renderSetup());
  }

  /** Put the game-over card up only once nothing is still moving: the fireworks have finished
   *  and the score has finished counting. A goal earned on the last ball fired its burst and
   *  the card landed on top of it in the same instant, which is no celebration at all.
   *  Bounded at 4s so a stuck counter can never strand the player on the lane. */
  _showWhenQuiet(el, waited = 0) {
    const fwLeft = Math.max(0, (this._fwUntil || 0) - Date.now());
    const counting = this.game && this._shownScore !== this.game.score;
    // GUARD: THE CEREMONY IS NOT BOUNDED BY THE 4s. It ends when the player taps its OK button,
    // and 4s in it has not even produced the key yet - the bound below exists for a stuck score
    // counter, not for something waiting on a person. _unlockCeremony carries its own 60s
    // backstop, so this can still never strand anyone on the lane.
    if ((fwLeft > 0 || counting) && waited < 4000 || this._ceremony) {
      setTimeout(() => { if (!this.disposed && this.screen === 'play') this._showWhenQuiet(el, waited + 120); }, 120);
      return;
    }
    if (this.disposed || this.screen !== 'play') return;
    this.root.appendChild(el);
  }

  // --- overlays --------------------------------------------------------------------------------

  _closeOverlay() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    this.overlay = null;
  }

  // --- layout ----------------------------------------------------------------------------------

  /** Size the renderer to the stage. Returns FALSE when the stage has no size yet - the caller
   *  has to care, because a silent no-op here leaves the renderer at its constructor size for
   *  the rest of the session. See _fitWhenLaidOut. */
  _fit() {
    if (!this.renderer || !this.el || !this.el.stage) return false;
    const r = this.el.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    this.renderer.resize(r.width, r.height);
    return true;
  }

  /** GUARD: KEEP TRYING UNTIL THE STAGE HAS A SIZE. _startGame can run straight out of the
   *  constructor - a reload mid-rack boots onto the lane rather than the gallery - and at that
   *  point this.root has not laid out, so getBoundingClientRect answers 0 and _fit does nothing.
   *  Nothing re-fits afterwards unless a viewport resize happens to fire, so the canvas keeps
   *  its constructor size: on 2026-08-21 that shipped as a machine squashed into the top half of
   *  the screen, cropped and off-centre. Bounded, and a no-op on the normal path where the first
   *  _fit already succeeded. */
  _fitWhenLaidOut(tries = 12) {
    requestAnimationFrame(() => {
      if (this.disposed || this.screen !== 'play') return;
      if (this._fit() || tries <= 1) return;
      this._fitWhenLaidOut(tries - 1);
    });
  }

  // --- teardown --------------------------------------------------------------------------------

  destroy() {
    this.disposed = true;
    this._stopLoop();
    this._stopHpDemo();
    this._closeOverlay();
    this.root.removeEventListener('click', this._onDefTap);
    this.root.removeEventListener('keydown', this._onDefKey);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    document.removeEventListener('visibilitychange', this._onHide);
    if (this._rotate) { this._rotate.remove(); this._rotate = null; }
    if (this._unsubLang) this._unsubLang();
    if (this._unsubViewport) this._unsubViewport();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._roRaf) { cancelAnimationFrame(this._roRaf); this._roRaf = 0; }
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
