// baseball/js/ui.js - phase 3 (BB-3): the real play screen. Quick Play only: pick a league, play a
// full three-inning game against one CPU team, batting and pitching both real, through the actual
// engine (`js/engine/`). No career, no stats recording, no leaderboard - see baseball/CLAUDE.md.
//
// Module contract (docs/BUILDING-A-GAME.md, "Part 1 - Building a game"): init/destroy/isInProgress.

import { makeT } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { isDevProfile } from '../../js/challenge/hooks.js';
import { loadProfile } from '../../js/profile-store.js';
import { STRINGS } from './strings.js';

import * as SETTINGS from './engine/settings.js';
import { Game } from './engine/game.js';
import { CpuPitcher, CpuBatter } from './engine/agents.js';
import { makeLeague, makePlayerTeam } from './engine/teams.js';
import { resolveSteer, steerDirectionSign, clampSteerDx } from './engine/pitch.js';
import {
  drawField, drawBall, drawLandingMarker, project, drawPlateView, preloadPlateImages, plateReady,
  PLATE_ANCHORS, plateCover, anchorPx, plateBallPos, zoneRect,
  NEAR_BATTER_HEIGHT_FRAC, MOUND_PITCHER_HEIGHT_FRAC, BATTER_AIM_TRAVEL_FRAC,
} from './field.js';
import { drawRingState, RING_D, BTN_D, NICE_CENTER, NICE_HALF } from './ring.js';
// stage 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D actor layer. Loaded eagerly, not lazily -
// unlike Boggle's dictionary, this is the PRIMARY visual for the live play screen, not an optional
// extra, so there is no "first play only" moment to defer it past; ui.js itself is only requested
// when Baseball actually mounts, so this import costs nothing before that.
import { Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD } from './actors.js';

const t = makeT(STRINGS);

/** Idempotently ensure this module's stylesheets are on the page (hub or standalone) - the hub
 *  shell does not preload a game's own CSS, same as every other in-hub module (escoba/js/ui.js's
 *  own ensureStylesheet is the reference). css/ui.css is `.gh-*` primitives (segmented control,
 *  buttons) this screen's setup/end-modal chrome is built on. */
function ensureCSS() {
  const want = [
    { href: new URL('../../css/ui.css', import.meta.url).href },
    { href: new URL('../css/baseball.css', import.meta.url).href },
  ];
  for (const { href } of want) {
    const present = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href);
    if (present) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

// ---------------------------------------------------------------------------------------------
// Fixed geometry (the handoff's own table). Nothing here may move between batting and pitching -
// only labels/contents change.
const HUD_H = 48;
const STRIP_H = 108;
const CONTROL_H = 172;
const FIELD_FLOOR_FRAC = 0.28;

const BETWEEN_MS = SETTINGS.FEEL.ui.betweenMs;
const WINDUP_MS = SETTINGS.FEEL.ui.windupMs;
const RESULT_MS = SETTINGS.FEEL.ui.resultMs;
// The half-inning transition's cross-fade (SPEC.md section 5, "the swap is instant at the beat's
// midpoint" under reduced motion - so full motion fades AROUND that same midpoint): half of each
// side of `_crossFadeSwap`'s own round trip (fade out, then in), well inside the BETWEEN_MS/2
// budget `_onEngineEvent`'s 'halfInningEnd'/'halfInningStart' pair splits around it.
const FADE_MS = 150;

// STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7): the flow beats added around a ball in play and a
// delivery's own end. All four are fixed presentation durations, not tuned engine feel - they sit
// beside FEEL.ui's numbers rather than inside them because SETTINGS.js is out of scope for this
// stage (see the doc's own "never touch baseball/js/engine/" rule); `_settleAtBat`'s own
// book-keeping comment is what ties them back to RESULT_MS/BETWEEN_MS so the total is never a
// literal 4800.
const CONTACT_HOLD_MS = 400;   // the plate view holds after contact before the cut to the overhead
const FLIGHT_MS = 1000;        // the overhead ball flight (was 700)
const MARKER_HOLD_MS = 1000;   // the landing marker's own hold before the cut back to the plate
const PITCHER_RETURN_MS = 400; // ball-crosses-plate -> actors.toSet() (both the CPU's pitch and the human's own)
const PLATE_READY_CAP_MS = 3000; // the first wind-up's own cap on waiting for plate.webp to decode

// STAGE 4: field.js now exports NEAR_BATTER_HEIGHT_FRAC/MOUND_PITCHER_HEIGHT_FRAC (see the import
// above) - the dev-only 3D preview (_open3DCheck) used to carry its own mirrored copy here
// (DEV3D_NEAR_BATTER_HEIGHT_FRAC/DEV3D_MOUND_PITCHER_HEIGHT_FRAC) because they were module-private;
// both call sites now read the one real export, so there is nothing left to drift out of step.

const LEAGUE_ORDER = SETTINGS.LEAGUES;
/** The league's center-field fence, in feet, from the same FIELD table the game plays on - the
 *  ONE number the Quick Play picker shows beside each league. Matt (2026-09-15): the five-segment
 *  picker "reads as a difficulty menu", and baseball is tier-blind by the doc's own lock; a
 *  ballpark distance reframes the choice as a PLACE, not a level. No shapes, no tier words. */
function fenceCenterFt(league) {
  const f = SETTINGS.FIELD[league] || SETTINGS.FIELD.majors;
  return Math.round(f.fenceFt.center);
}

let root = null;

export default { init, destroy, isInProgress };

export function init(el) {
  // Idempotency guard: a container already holding a live instance (e.g. init() called twice
  // before the first destroy(), such as a fast double-tap on the launcher tile) must not stack a
  // second .bb-root on top of the first - a real device screenshot showed exactly that ghosting
  // (a stale, differently-sized control band showing through the current one).
  if (el._bbInstance) el._bbInstance.destroy();
  root = el;
  const game = new BaseballPlayScreen(el);
  root._bbInstance = game;
}

export function destroy() {
  if (root && root._bbInstance) root._bbInstance.destroy();
  if (root) root.innerHTML = '';
  root = null;
}

/** BB-3b commit 6: `true` while a Quick Play game is actually being played (the `play` screen,
 *  game not yet decided) - `false` on setup and once the end modal is up, since leaving from
 *  either of those loses nothing. This is the hub's OWN question (`requestLeave()` in `js/hub.js`)
 *  - answering it honestly is what makes the hub's leave dialog fire from the back pill instead of
 *  silently dropping an in-progress game with no warning at all, which is what a permanent `false`
 *  did. Career autosave (so a force-quit game could actually be resumed) is still phase 4 - this
 *  only makes losing one ASK first, the same bar `isInProgress()`'s own doc contract sets. */
export function isInProgress() {
  const g = root && root._bbInstance;
  return !!(g && g.screen === 'play' && g.game && g.game.winner == null && !g.game.aborted);
}

// ---------------------------------------------------------------------------------------------

function randPick(arr, rand = Math.random) { return arr[Math.floor(rand() * arr.length)]; }

class BaseballPlayScreen {
  constructor(container) {
    this.container = container;
    this.destroyed = false;
    this.screen = 'setup'; // setup | play | end
    this.league = LEAGUE_ORDER[0]; // Quick Play opens on Little League (the ladder's first rung), never mid-ladder
    // Found wrong against the real file while wiring the stage 1 dev screen (docs/BASEBALL-3D-BUILD.md
    // section 3.7): this called `isDevProfile()` with no argument, so it could never match a real
    // profile name and the Frames panel (and now the 3D preview inside it) was unreachable for
    // anyone, dev names included. Every other caller in the repo passes the loaded profile's own
    // name (skeeball/js/ui.js, golf/js/ui.js, js/hub.js) - matched here. `__bbDevForce` is a
    // test-only seam, the same shape as skeeball's `__skTest`/yahtzee's `__yzTest`, for a headless
    // screenshot that cannot know Matt's real secret name.
    let profName = '';
    try { profName = (loadProfile()?.name || '').trim(); } catch { /* stay non-dev */ }
    this.dev = isDevProfile(profName) || !!globalThis.__bbDevForce;

    // STAGE 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D actor layer starts loading here, at
    // MOUNT (the setup screen), not at _startGame - a player who spends a few seconds picking a
    // league gets that time for free against the model fetch. `this.actors.canvas` lives detached
    // from the document until _renderPlay() reparents it into the real field-wrap (a DOM node can
    // be built and even rendered into off-tree; only initGL()'s WebGL context needs the canvas to
    // exist, which it does the moment `new Actors()` creates it).
    // STAGE 5 (docs/BASEBALL-3D-BUILD.md section 3.10): there is no sprite path to fall back to any
    // more, so `initGL()` returning false or `load()` rejecting sets `_actorsFailed` instead of
    // silently carrying on - `_renderLoadError()` is what the Play button shows for it (see
    // `_initActors3D`'s own header). Every place in this file that used to branch on a live-vs-
    // sprite flag now just calls `this.actors` directly: by the time any of them can run,
    // `_startGame` has already been reached, which is only possible past the Play click's own
    // `_actorsFailed` check, so `this.actors` is guaranteed live there.
    this._actorsHost = document.createElement('div');
    this.actors = null;
    this._actorsSettled = true;
    this._actorsFailed = false;
    this._actorsReadyPromise = null;
    this._initActors3D();

    // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 7): the preload moves here (mount, the
    // setup screen) from `_startGame` - the same reasoning as the 3D model load two lines above,
    // now applied to `plate.webp` itself: a player picking a league gets that fetch for free, and
    // `_stepWindup`'s own await on `plateReady()` (below) resolves near-instantly by the time the
    // first pitch actually needs the picture instead of racing it from a cold start.
    preloadPlateImages();
    // THE CUTAWAY FLAG (docs/BASEBALL-3D-BUILD.md section 7, row 6): true for the WHOLE overhead
    // cutaway (contact hold through the landing-marker hold), cleared only by `_returnToPlate()`.
    // `_drawStaticField()` is a no-op while it is set, whoever calls it - see that function's own
    // guard. Matt: a slider touch during the cutaway redrew the plate view underneath and re-showed
    // the 3D layer over the overhead picture; v858 fixed one call path, this flag closes all of them
    // at once, structurally, rather than needing every future caller to remember to check.
    this._cutawayUp = false;

    ensureCSS();

    // Golf's own reference pattern (golf/js/ui.js's `_fitInsets`): the hub's floating immersive
    // back pill is `position: absolute` OVER this game, not reserving layout space for it, and
    // `.bb-root` is itself `position: fixed`, which ignores `.hub-main-immersive`'s own top
    // padding entirely (that padding only helps a normally-flowed root). So the HUD's top
    // clearance has to be measured against the pill directly, every fit, or it collides with the
    // status bar and the pill exactly as a real-device screenshot showed on 2026-09-14.
    this.inHub = !!container.closest('.hub-game');

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'bb-root';
    container.appendChild(this.rootEl);

    this.offViewport = onViewportResize(() => this._fit());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this._fit());
      this.ro.observe(container);
      if (container.parentElement) this.ro.observe(container.parentElement);
    }
    // STAGE 4: a backgrounded tab pauses the actor layer's own render loop (never a leaked RAF
    // while nothing is visible) and resumes it on return, same shape as the resize/fit call this
    // listener already made.
    this._onVis = () => {
      if (document.visibilityState === 'visible') {
        this._fit();
        // Only if the plate view is up: during the overhead cutaway the canvas is hidden and the
        // loop stays paused until `_drawStaticField()` brings both back (v858, `_showActors`).
        if (this.actors && this.actors.canvas && this.actors.canvas.style.display !== 'none') this.actors.resume();
      } else if (this.actors) {
        this.actors.pause();
      }
    };
    document.addEventListener('visibilitychange', this._onVis);

    // Rapid-tap cure (Hill Climb's own fix, root CLAUDE.md's Part 0 "iOS rapid-tap cure"): block
    // the double-tap select gesture at the source rather than fight it after the fact.
    this._onSelectStart = (e) => e.preventDefault();
    this.rootEl.addEventListener('selectstart', this._onSelectStart);
    this.rootEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this._renderSetup();
    this._fit();
    requestAnimationFrame(() => this._fit());
  }

  /** STAGE 4: start the 3D model loading the moment Baseball mounts (the setup screen), per
   *  docs/BASEBALL-3D-BUILD.md section 3.6's own "Loading" bullet. `this._actorsSettled` gates the
   *  setup screen's Play button (`_renderSetup`/`_updatePlayButtonState`) - true the instant there
   *  is nothing left to wait for, whichever way it went.
   *  STAGE 5: there is no sprite path to fall back to any more. `initGL()` returning false (no
   *  WebGL context at all - a permanent, hardware-level fact) or `load()` rejecting (WebGL works
   *  but the fetch/parse of player.glb failed) both set `_actorsFailed` instead of silently
   *  carrying on - the Play click checks it and shows `_renderLoadError()` in place of starting a
   *  game with nothing to draw its two figures. */
  _initActors3D() {
    this._actorsFailed = false;
    try {
      const a = new Actors(this._actorsHost);
      if (!a.initGL()) {
        this.actors = null;
        this._actorsSettled = true;
        this._actorsFailed = true;
        return;
      }
      this.actors = a;
      this._actorsSettled = false;
      // `globalThis.__bbModelUrlOverride` is a test-only seam (same shape as `_open3DCheck`'s own
      // `__bbDevModelUrl`) for forcing a load failure from outside the app - a genuinely bad path
      // that a service-worker interception can't quietly rescue, unlike a Playwright route abort
      // on the real model URL, which the cache-first REST tier can already be holding.
      const modelUrl = globalThis.__bbModelUrlOverride || new URL('../models/player.glb', import.meta.url).href;
      this._actorsReadyPromise = a.load(modelUrl)
        .catch((e) => {
          console.warn('baseball 3D: player.glb failed to load', e);
          this._actorsFailed = true;
          if (this.actors) { this.actors.dispose(); this.actors = null; }
        })
        .then(() => { this._actorsSettled = true; this._updatePlayButtonState(); });
    } catch (e) {
      console.warn('baseball 3D: actor layer unavailable', e);
      this.actors = null;
      this._actorsSettled = true;
      this._actorsFailed = true;
    }
  }

  /** The setup screen's Play button, kept in sync with `_actorsSettled` without a full
   *  `_renderSetup()` (which would also reset the league selection mid-load). A no-op once the
   *  screen has moved on (`_renderSetup` calls this once up front; the load promise's own
   *  `.then()` calls it again later, possibly after Play). */
  _updatePlayButtonState() {
    if (this.destroyed || this.screen !== 'setup') return;
    const btn = this.rootEl && this.rootEl.querySelector('[data-act="play"]');
    if (!btn) return;
    btn.textContent = this._actorsSettled ? t('setup_play') : t('load_model');
    if (this._actorsSettled) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
  }

  /** STAGE 5 (docs/BASEBALL-3D-BUILD.md section 3.6's own "Loading" bullet, boggle/js/ui.js's
   *  `renderLoadError()` pattern): shown in place of the setup screen when the Play tap finds
   *  `_actorsFailed` true, so a failed model load is a real, translated screen with a way back in
   *  rather than a play screen with a blank field where two figures should be (docs/BUILDING-A-GAME.md
   *  Part 0, "if you paint before the data has arrived, name the path back to the truth"). Retry
   *  disposes whatever the failed attempt left behind and starts a fresh load. */
  _renderLoadError() {
    if (this.destroyed || !this.rootEl) return;
    this.rootEl.innerHTML = `
      <div class="bb-setup bb-load-error">
        <p class="bb-load-error-msg">${t('load_error')}</p>
        <button type="button" class="gh-btn gh-btn--primary" data-act="retry">${t('retry')}</button>
      </div>`;
    this.rootEl.querySelector('[data-act="retry"]').addEventListener('click', () => {
      if (this.destroyed) return;
      if (this.actors) { this.actors.dispose(); this.actors = null; }
      this._initActors3D();
      this._renderSetup();
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.offViewport) this.offViewport();
    if (this.ro) this.ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._onWindowPointerUp) window.removeEventListener('pointerup', this._onWindowPointerUp);
    if (this._rafBall) cancelAnimationFrame(this._rafBall);
    if (this._pitchRaf) cancelAnimationFrame(this._pitchRaf);
    if (this._flightRaf) cancelAnimationFrame(this._flightRaf);
    if (this._contactRaf) cancelAnimationFrame(this._contactRaf);
    if (this._markerTimer) clearTimeout(this._markerTimer);
    if (this._pitcherReturnTimer) clearTimeout(this._pitcherReturnTimer);
    if (this.actors) { this.actors.dispose(); this.actors = null; }
    if (this._popTimer) clearTimeout(this._popTimer);
    if (this._safeAreaProbe) { this._safeAreaProbe.remove(); this._safeAreaProbe = null; }
    if (this._devActors) { this._devActors.dispose(); this._devActors = null; }
    if (this.gameAbort) this.gameAbort();
  }

  _fit() {
    if (this.destroyed || !this.rootEl) return;
    this._fitInsets();
    const el = this.rootEl;
    el.style.height = '';
    const rect = el.getBoundingClientRect();
    const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const top = rect.top;
    let h = Math.max(320, Math.round(vh - top));
    el.style.height = h + 'px';
    if (this._sizeCanvas) this._sizeCanvas();
  }

  /** Measure the hub's own floating immersive back pill (`.hub-back`) and reserve exactly enough
   *  top clearance to clear it - golf's own `_fitInsets` pattern. Because `.bb-root` is `position:
   *  fixed`, `.hub-main-immersive`'s CSS padding never reaches it, so this has to be a real
   *  measurement rather than a hardcoded constant: absent, hidden or clear of us, the pad is 0. */
  _fitInsets() {
    if (!this.rootEl) return;
    const r = this.rootEl.getBoundingClientRect();
    let pad = 0;
    if (this.inHub) {
      const back = document.querySelector('.hub-back');
      if (back && back.offsetParent !== null) {
        const b = back.getBoundingClientRect();
        if (b.bottom > r.top && b.right > r.left && b.left < r.right) pad = Math.ceil(b.bottom - r.top) + 6;
      }
    } else {
      // Standalone: no hub chrome to clear, but the device's own status bar/notch still needs
      // clearance. env(safe-area-inset-top) can't be read directly in JS, so it's measured off a
      // one-off probe element - the same trick because a CSS-only padding here would double-count
      // against the hub-back measurement above on devices where both apply.
      if (!this._safeAreaProbe) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top, 0px);pointer-events:none;visibility:hidden;';
        document.body.appendChild(probe);
        this._safeAreaProbe = probe;
      }
      pad = Math.ceil(parseFloat(getComputedStyle(this._safeAreaProbe).paddingTop) || 0);
    }
    this.rootEl.style.setProperty('--bb-top-pad', Math.max(0, pad) + 'px');
  }

  // -------------------------------------------------------------------------------- setup screen
  _renderSetup() {
    this.rootEl.innerHTML = `
      <div class="bb-setup">
        <h1 class="bb-setup-title">${t('setup_quick')}</h1>
        <div class="bb-league-list" role="radiogroup" aria-label="${t('setup_league')}">
          ${LEAGUE_ORDER.map((lg) => `
            <button type="button" class="bb-league-row" data-league="${lg}" role="radio" aria-checked="${lg === this.league}" aria-pressed="${lg === this.league}">
              <span class="bb-league-mark" aria-hidden="true"></span>
              <span class="bb-league-name">${t('league_' + lg)}</span>
              <span class="bb-league-fence">${t('setup_fence').replace('{ft}', String(fenceCenterFt(lg)))}</span>
            </button>
          `).join('')}
        </div>
        <button type="button" class="gh-btn gh-btn--primary bb-play-btn" data-act="play"${this._actorsSettled ? '' : ' aria-disabled="true"'}>${this._actorsSettled ? t('setup_play') : t('load_model')}</button>
        ${this.dev ? `<button type="button" class="bb-tune-open" data-act="tune">${t('tune_open')}</button>` : ''}
        ${this.dev ? `<button type="button" class="bb-tune-open" data-act="frames">Frames</button>` : ''}
      </div>`;
    this.rootEl.querySelectorAll('[data-league]').forEach((b) => {
      b.addEventListener('click', () => {
        this.league = b.dataset.league;
        this.rootEl.querySelectorAll('[data-league]').forEach((x) => {
          const sel = x === b;
          x.setAttribute('aria-checked', sel ? 'true' : 'false');
          x.setAttribute('aria-pressed', sel ? 'true' : 'false');
        });
      });
    });
    // STAGE 4: the button stays a real, always-tappable <button> (never HTML `disabled`) so a
    // tap that lands during the model load isn't silently dropped - it just awaits the same
    // promise the button's own label is already counting down, then starts the game exactly as a
    // tap after loading would. `_actorsReadyPromise` is null the instant there is nothing to wait
    // for (no WebGL, or already settled), so this resolves immediately in that case.
    // STAGE 5: once settled, a failed load (`_actorsFailed`) goes to `_renderLoadError()` instead
    // of `_startGame()` - there is no sprite path left to play without the model.
    this.rootEl.querySelector('[data-act="play"]').addEventListener('click', async () => {
      if (this._actorsReadyPromise) await this._actorsReadyPromise;
      if (this.destroyed || this.screen !== 'setup') return;
      if (this._actorsFailed) { this._renderLoadError(); return; }
      this._startGame();
    });
    const tuneBtn = this.rootEl.querySelector('[data-act="tune"]');
    if (tuneBtn) tuneBtn.addEventListener('click', () => this._openTune());
    const framesBtn = this.rootEl.querySelector('[data-act="frames"]');
    if (framesBtn) framesBtn.addEventListener('click', () => this._openFrameCheck());
  }

  // -------------------------------------------------------------------------------- game start
  _startGame() {
    const league = this.league;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const cpuLeague = makeLeague(league);
    const cpuTeam = randPick(cpuLeague);
    const skillIds = SETTINGS.SKILL_IDS;
    const preset = randPick(Object.values(SETTINGS.PRESETS));
    const hand = Math.random() < 0.5 ? 'R' : 'L';
    const playerTeam = makePlayerTeam({ skills: preset, hand });
    playerTeam.league = league;

    this.human = new HumanAgent(this, league, playerTeam);
    const agents = {
      away: this.human,
      home: {
        decidePitch: (v) => new CpuPitcher({ league, settings: SETTINGS, ladderOffset: cpuTeam.ladderOffset }).decidePitch(v),
        decideSwing: (v) => {
          const batter = cpuTeam.players.find((p) => p.id === v.batterId) || cpuTeam.players[0];
          return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS, styleId: cpuTeam.styleId, ladderOffset: cpuTeam.ladderOffset }).decideSwing(v);
        },
      },
    };

    this.game = new Game({ home: cpuTeam, away: playerTeam, seed, agents, settings: SETTINGS });
    this.cpuTeam = cpuTeam;
    this.playerTeam = playerTeam;
    this.state = {
      mode: 'batting', // 'batting' | 'pitching'
      selectedPitch: 'fastball',
      unlockedPitches: SETTINGS.unlockedPitchesFor(league, 0),
      line1: '', line2: '',
      lastPitches: [], // batting strip: last 8 of the at-bat
      recentPitches: [], // pitching strip: last 4
      pendingPitchType: null, // Line 2's readout - see _pitchReadout
    };
    this.gameAbort = () => { if (this.game) this.game.abort(); };
    // STAGE 7: preloadPlateImages() moved to the constructor (Baseball's mount) - see its own
    // comment there.

    this.screen = 'play';
    this._renderPlay();
    this._fit();

    this.game.onEvent = (type, payload) => this._onEngineEvent(type, payload);
    this.game.playGame().then(() => {
      if (this.destroyed) return;
      this._showEndModal();
    });
  }

  // -------------------------------------------------------------------------------- play screen shell
  _renderPlay() {
    this.rootEl.innerHTML = `
      <div class="bb-play">
        <div class="bb-top-spacer" data-role="topspacer"></div>
        <div class="bb-hud" data-role="hud"></div>
        <div class="bb-field-wrap" data-role="fieldwrap">
          <div class="bb-pop" data-role="pop" aria-live="polite"></div>
          <canvas class="bb-field-canvas" data-role="canvas"></canvas>
          <div class="bb-lines">
            <div class="bb-line1" data-role="line1"></div>
            <div class="bb-line2" data-role="line2"></div>
          </div>
        </div>
        <div class="bb-strip" data-role="strip"></div>
        <div class="bb-control" data-role="control"></div>
      </div>
      ${this.inHub ? '' : `<button type="button" class="bb-back" data-act="back" aria-label="${t('back')}">&larr;</button>`}
    `;
    this.canvas = this.rootEl.querySelector('[data-role="canvas"]');
    this.ctx = this.canvas.getContext('2d');
    const fieldwrap = this.rootEl.querySelector('[data-role="fieldwrap"]');
    // STAGE 4: the actor canvas was built detached (constructor time, docs/BASEBALL-3D-BUILD.md
    // section 3.6) so the model could start loading before this screen existed at all - reparent it
    // into the real field-wrap now. A DOM append MOVES an existing node rather than cloning it, so
    // the same live WebGL context (and whatever it has already rendered) survives the move; CSS
    // (`.bb-actor-canvas`, baseball.css) stacks it over `.bb-field-canvas` and under `.bb-pop`.
    // STAGE 5: `this.actors` is guaranteed non-null and ready here - the Play click that reached
    // `_startGame` already routed a failed load to `_renderLoadError()` instead.
    fieldwrap.appendChild(this.actors.canvas);
    this.actors.idle('batter');
    this.actors.idle('pitcher');
    this.actors.start();
    this._sizeCanvas = () => {
      const wrap = this.rootEl.querySelector('[data-role="fieldwrap"]');
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) { requestAnimationFrame(this._sizeCanvas); return; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._fieldW = r.width;
      this._fieldH = r.height;
      this.actors.resize(r.width, r.height, plateCover(r.width, r.height));
      this._drawStaticField();
    };
    const backBtn = this.rootEl.querySelector('[data-act="back"]');
    if (backBtn) backBtn.addEventListener('click', () => this._confirmBack());
    this._paintHud();
    this._paintStrip();
    this._paintControl();
    requestAnimationFrame(() => { this._sizeCanvas(); });
  }

  _fenceFt() {
    return (SETTINGS.FIELD[this.league] || SETTINGS.FIELD.majors).fenceFt;
  }

  /** The PLATE camera - live for every pitch (aiming, the throw, the swing). See field.js's own
   *  header for the camera (one fixed picture in both states, BB-3b) and baseball/CLAUDE.md's "The
   *  camera was rebuilt to match the reference" for the history.
   *  STAGE 5: `drawPlateView` now only draws the picture and the strike zone (the sprite figures it
   *  used to draw are gone, section 3.10) - `_syncActors` places the real 3D figures on the canvas
   *  above this one, unconditionally, since `this.actors` is guaranteed live for the whole play
   *  screen (see `_startGame`'s own note). */
  _drawStaticField() {
    // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 6): a NO-OP for the whole overhead cutaway,
    // whoever calls it - the pad handler's own `batterAimX` write, the charge loop, a half-inning
    // swap, all of them. Matt's report: a slider touch during the cutaway redrew the plate view
    // underneath and re-showed the 3D layer over the overhead picture (v858 fixed one call path,
    // `_animateBattedBall`'s own re-show - this closes every path at once, structurally, since
    // nothing downstream of this guard can draw the plate view or bring the actors back while
    // `_cutawayUp` is set). Only `_returnToPlate()` clears the flag and calls this again for real.
    if (this._cutawayUp) return;
    if (!this.ctx || !this._fieldW) return;
    const dark = document.documentElement.classList.contains('gh-dark');
    const mode = this.state.mode === 'pitching' ? 'pitching' : 'batting';
    drawPlateView(this.ctx, this._fieldW, this._fieldH, mode, dark);
    this._syncActors(mode);
    // The plate view is on screen again: THIS is where the 3D layer comes back after the overhead
    // cutaway, never at the end of the batted ball's own flight alone. Matt's first recording of
    // the shipped 3D build (2026-09-19, v857) showed the batter standing frozen over the overhead
    // diamond for about seven seconds after every ball in play, because `_animateBattedBall` used
    // to show the canvas again the moment the landing marker was drawn, while the overhead picture
    // stayed up for the whole result beat and the between-pitches beat. The figures are anchored to
    // the plate camera's picture and mean nothing over the overhead one, so they stay hidden until
    // that picture is actually redrawn here.
    this._showActors();
  }

  /** THE CUTAWAY FLAG's only exit (stage 7, docs/BASEBALL-3D-BUILD.md section 7, row 6): clears
   *  `_cutawayUp`, then redraws the plate view for real (`_drawStaticField()` no-ops while the flag
   *  is set, so clearing it first is what lets this call actually paint) and shows the 3D layer.
   *  Also where the beat's own end-of-delivery poses land: the batter drops out of its held Swing
   *  follow-through into Idle, and the pitcher cross-fades into Set - both per docs/BASEBALL-3D-
   *  BUILD.md section 7 row 3/row 4, called from here rather than scattered across every caller of
   *  `_animateBattedBall` since this is the one place that always runs once, on the way back. */
  _returnToPlate() {
    this._cutawayUp = false;
    if (this.actors) { this.actors.idle('batter'); this.actors.toSet(); }
    this._drawStaticField();
    this._showActors();
  }

  /** Show the 3D layer and restart its loop, for the plate view only. Idempotent. */
  _showActors() {
    if (!this.actors || !this.actors.canvas) return;
    if (this.actors.canvas.style.display === 'none') this.actors.canvas.style.display = '';
    this.actors.resume();
  }

  /** Hide the 3D layer and stop its loop, for the overhead cutaway. Idempotent. */
  _hideActors() {
    if (!this.actors || !this.actors.canvas) return;
    this._actorBallHide();
    this.actors.pause();
    this.actors.canvas.style.display = 'none';
  }

  /** STAGE 4: the 3D figures' own placement, mirroring `drawPlateView`'s sprite maths exactly
   *  (same anchors, same aim shift, same side/flip rules - docs/BASEBALL-3D-BUILD.md section 3.6)
   *  so the two paths can never draw a different picture. Fire-and-forget: `setBatter`/`setPitcher`
   *  are async only on an actual side change (a real texture swap), which this screen does not need
   *  to await on every redraw - `_syncActors` runs on every `_drawStaticField()` call, several times
   *  a second during a pitch's flight. Skips the whole frame (not a crash, not a stale pose - just
   *  a no-op, same as the sprite path's own "still loading" fallback) while `plate.webp` hasn't
   *  resolved yet, since every anchor here is measured off its own cover-fit. */
  _syncActors(mode) {
    const cover = plateCover(this._fieldW, this._fieldH);
    if (!cover) return;
    const flip = this._currentBatterFlip();
    const pitcherFlip = this._currentPitcherFlip();
    const aimShift = mode === 'batting' ? (this.state.batterAimX || 0) * BATTER_AIM_TRAVEL_FRAC * cover.drawW : 0;
    const nearXY = anchorPx(flip ? PLATE_ANCHORS.nearBoxRight : PLATE_ANCHORS.nearBoxLeft, cover);
    const batterSide = mode === 'pitching' ? 'away' : 'home';
    const pitcherSide = mode === 'pitching' ? 'home' : 'away';
    this.actors.setBatter({
      side: batterSide, bats: flip ? 'L' : 'R', aimX: this.state.batterAimX || 0, facingRad: BATTER_FACING_RAD,
      anchor: { x: nearXY.x + aimShift, y: nearXY.y }, heightPx: this._fieldH * NEAR_BATTER_HEIGHT_FRAC,
    });
    this.actors.setPitcher({
      side: pitcherSide, throws: pitcherFlip ? 'L' : 'R', facingRad: PITCHER_FACING_RAD,
      anchor: anchorPx(PLATE_ANCHORS.mound, cover), heightPx: this._fieldH * MOUND_PITCHER_HEIGHT_FRAC,
    });
  }

  /** STAGE 4: the pitch, in 3D - `field.js`'s own `plateBallPos` curve (identical position/size to
   *  the 2D trail), blended toward the pitcher's REAL throwing-hand bone near release (weight
   *  `depthFrac`, 1 at release fading linearly to 0 at the plate - `plateBallPos` already returns
   *  it) rather than the flat `PLATE_ANCHORS.release` point the 2D camera anchors to. */
  _actorBallAt(xFt, yFt) {
    if (!this.actors) return;
    const cover = plateCover(this._fieldW, this._fieldH);
    if (!cover) return;
    const pos = plateBallPos(this._fieldW, this._fieldH, cover, xFt, yFt);
    const hand = this.actors.handWorldPx('pitcher');
    let x = pos.x, y = pos.y;
    if (hand) {
      const releaseXY = anchorPx(PLATE_ANCHORS.release, cover);
      x += (hand.x - releaseXY.x) * pos.depthFrac;
      y += (hand.y - releaseXY.y) * pos.depthFrac;
    }
    this.actors.setBall({ x, y, r: pos.r });
  }
  _actorBallHide() { if (this.actors) this.actors.setBall(null); }

  /** Both frame sets are drawn RIGHT-handed (Matt's correction, field.js's own header); a
   *  LEFT-handed batter is the flip, standing at the opposite box (nearBoxRight instead of
   *  nearBoxLeft - see field.js's `drawPlateView`). Whichever team is BATTING supplies the hand,
   *  regardless of which state the human is in - see `_drawStaticField`'s mode note. Same rule
   *  for both sets: your own batting hand in the batting state, the CPU batter's hand (teams.js's
   *  lefty rate) in the pitching state. */
  _currentBatterFlip() {
    if (!this.game) return false;
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    const battingId = this.game._currentBatterId ? this.game._currentBatterId(battingSide) : null;
    const team = this.game[battingSide];
    const batter = team && battingId ? team.players.find((p) => p.id === battingId) : null;
    return !!(batter && batter.bats === 'L');
  }

  /** Same rule as the batter, for the mound figure: both pitcher sets are drawn RIGHT-handed, so
   *  a LEFT-handed pitcher (teams.js's own `throws`) is the flip. Whichever team is PITCHING
   *  (the defense) supplies the hand, regardless of which state the human is in. */
  _currentPitcherFlip() {
    if (!this.game) return false;
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    const defenseSide = battingSide === 'away' ? 'home' : 'away';
    const team = this.game[defenseSide];
    const pitcher = team ? team.players.find((p) => p.id === team.pitcherId) : null;
    return !!(pitcher && pitcher.throws === 'L');
  }

  /** The pitcher's real 1400ms delivery (spec section 9, R1) before every pitch the CPU throws to
   *  a human batter: `actors.play('pitcher', 'Pitch', { markAtMs: WINDUP_MS })` starts the authored
   *  delivery clip so its release keyframe (poses.js's `CLIPS.Pitch.mark`) lands exactly
   *  `WINDUP_MS` from now - the same instant these two sleeps below time out at, which is what
   *  makes that call a signal `test-baseball-device.mjs`'s r2-cadence probe can watch (call time +
   *  `markAtMs`) instead of a frame number (STAGE 5, docs/BASEBALL-3D-BUILD.md section 3.10 -
   *  proven equivalent to the frame-based signal it replaces before the frames were deleted;
   *  baseball/CLAUDE.md has the measured numbers). The caller starts the flight right after this
   *  resolves. A human's OWN pitch (`this.state.mode === 'pitching'`) steps the delivery a
   *  different way instead - see `HumanAgent.decidePitch`'s `tick()`/`finish()`. */
  async _stepWindup() {
    // THE PRELOAD (stage 7, docs/BASEBALL-3D-BUILD.md section 7, row 7): the FIRST wind-up of a
    // game waits, capped at PLATE_READY_CAP_MS, for `plate.webp` to have actually finished
    // decoding (not merely fetched - see `plateReady()`'s own header), then repaints the static
    // field the instant it resolves. Matt's report: "~1.1s of flat green after Play, and the first
    // wind-up starts under it" - the picture was racing the pitcher's own first delivery from a
    // cold start; `preloadPlateImages()` moved to Baseball's mount (this file's constructor) so in
    // practice this await settles near-instantly by the time a player has picked a league and
    // tapped Play. Every later windup's own await is a no-op (the promise is already settled), so
    // this only ever costs time once, on the very first pitch of a game.
    if (!this._firstWindupAwaited) {
      this._firstWindupAwaited = true;
      await Promise.race([plateReady(), sleep(PLATE_READY_CAP_MS)]);
      if (this.destroyed) return;
      // `_sizeCanvas()` (which paints via its own `_drawStaticField()` call) is scheduled with
      // `requestAnimationFrame` from `_renderPlay()`, and `plateReady()` can already be settled
      // (the preload had a head start from mount) - so this await can resolve on a microtask well
      // before the browser's next paint, racing ahead of that first rAF tick and leaving
      // `this._fieldW` still unset. `getBoundingClientRect()` (inside `_sizeCanvas`) is a
      // synchronous layout read that needs no animation frame, so calling it directly here, rather
      // than waiting on the rAF, is what actually closes the race - measured live: without this,
      // the picture painted up to ~500ms after the wind-up's own Pitch call, not before it.
      if (!this._fieldW && this._sizeCanvas) this._sizeCanvas();
      else this._drawStaticField();
    }
    const total = WINDUP_MS;
    const leadIn = Math.max(0, total - 400);
    this.actors.play('pitcher', 'Pitch', { markAtMs: WINDUP_MS });
    if (leadIn > 0) await sleep(leadIn);
    if (this.destroyed) return;
    await sleep(Math.min(400, total));
  }

  /** The OVERHEAD camera - the cutaway that plays for the batted-ball flight, so the out-zone
   *  geometry and the landing marker (both authored for a top-down view) stay meaningful. Chosen
   *  deliberately over a soft pull-back on the plate camera or dropping the visual outcome
   *  entirely - see field.js's header. */
  _drawOverheadField() {
    if (!this.ctx || !this._fieldW) return;
    const dark = document.documentElement.classList.contains('gh-dark');
    drawField(this.ctx, this._fieldW, this._fieldH, this.league, this._fenceFt(), dark);
  }

  // -------------------------------------------------------------------------------- HUD
  _paintHud() {
    const hud = this.rootEl.querySelector('[data-role="hud"]');
    if (!hud || !this.game) return;
    const g = this.game;
    const battingSide = g.half === 'top' ? 'away' : 'home';
    const you = 'away';
    const arrow = g.half === 'top' ? '▲' : '▼';
    const battingId = g._currentBatterId ? g._currentBatterId(battingSide) : null;
    const battingTeam = g[battingSide];
    const batter = battingTeam && battingId ? battingTeam.players.find((p) => p.id === battingId) : null;
    hud.innerHTML = `
      <div class="bb-hud-score">
        <span class="bb-hud-team${you === 'away' ? ' is-you' : ''}">${t('you')}</span>
        <span class="bb-hud-runs">${g.score.away}</span>
        <span class="bb-hud-dash">-</span>
        <span class="bb-hud-runs">${g.score.home}</span>
        <span class="bb-hud-team">${t('cpu')}</span>
      </div>
      <div class="bb-hud-inning">${arrow} ${g.inning}</div>
      <div class="bb-hud-count">
        <span class="bb-dotrow" aria-label="balls">${dots(g.balls, 3, 'b')}</span>
        <span class="bb-dotrow" aria-label="strikes">${dots(g.strikes, 2, 's')}</span>
        <span class="bb-dotrow" aria-label="outs">${dots(g.outs, 2, 'o')}</span>
      </div>
      <div class="bb-hud-bases">${basesSvg(g.bases)}</div>
      <div class="bb-hud-batter">${batter ? '#' + batter.jersey + ' ' + batter.pos : ''}</div>
    `;
  }

  // -------------------------------------------------------------------------------- strip
  /** BB-3b commit 6: the strip is eight fixed tiles in ONE ROW, in both states (the handoff's own
   *  numbers section: "44 wide, 92 tall, 1px gaps" - `.bb-strip-tiles` in baseball.css). Pitching
   *  shows one well per `SETTINGS.PITCH_TYPES` entry (always 8, in that fixed order) - a locked
   *  one is an empty well with a lock glyph, per SPEC.md section 5, never simply omitted (omitting
   *  it would silently reflow every tile after it, which is exactly the "nothing moves between
   *  states" rule this band exists to hold). Batting shows the last 8 pitches of THIS at-bat,
   *  filling left to right as each one resolves, blank wells for what hasn't been thrown yet -
   *  replaces the prior round's flex-wrap compact chips (a deliberate space simplification,
   *  phase 3's own CLAUDE.md note), now that the fixed-tile geometry has a real home. */
  _paintStrip() {
    const strip = this.rootEl.querySelector('[data-role="strip"]');
    if (!strip) return;
    if (this.state.mode === 'pitching') {
      strip.innerHTML = `<div class="bb-strip-tiles">${
        SETTINGS.PITCH_TYPES.map((p) => {
          if (!this.state.unlockedPitches.includes(p)) {
            return `<div class="bb-pitch-tile is-locked" aria-hidden="true">&#128274;</div>`;
          }
          return `<button type="button" class="bb-pitch-tile${p === this.state.selectedPitch ? ' is-sel' : ''}" data-pitch="${p}">
            <span class="bb-pitch-name">${t('pitch_' + p)}</span>
          </button>`;
        }).join('')
      }</div>`;
      strip.querySelectorAll('[data-pitch]').forEach((b) => {
        b.addEventListener('click', () => {
          this.state.selectedPitch = b.dataset.pitch;
          this._paintStrip();
        });
      });
    } else {
      const recent = this.state.lastPitches.slice(-8);
      const slots = Array.from({ length: 8 }, (_, i) => recent[i] || null);
      strip.innerHTML = `<div class="bb-strip-tiles">${
        slots.map((p) => (p
          ? `<div class="bb-pitch-tile ${p.isStrike ? 'is-strike' : 'is-ball'}">
              <span class="bb-pitch-name">${t('pitch_' + p.type)}</span>
              <span class="bb-pitch-mph">${p.mph}</span>
              <span class="bb-pitch-mark" aria-hidden="true">${p.isStrike ? '■' : '●'}</span>
            </div>`
          : `<div class="bb-pitch-tile is-empty"></div>`)).join('')
      }</div>`;
    }
  }

  // -------------------------------------------------------------------------------- control band
  _paintControl() {
    const control = this.rootEl.querySelector('[data-role="control"]');
    if (!control) return;
    control.innerHTML = `
      <div class="bb-pad" data-role="pad">
        <div class="bb-pad-zone"></div>
        <div class="bb-pad-sweet"></div>
        <div class="bb-pad-marker" data-role="padmarker"></div>
        <div class="bb-pad-steerarrow" data-role="steerarrow" style="display:none">&#10132;</div>
      </div>
      <div class="bb-actions" data-role="actions"></div>
      <div class="bb-ringwrap" data-role="mainbtn" role="button" aria-label="${t('act_swing')}">
        <canvas data-role="ringcanvas" width="${RING_D}" height="${RING_D}"></canvas>
        <div class="bb-ring-label" data-role="ringlabel"></div>
      </div>
    `;
    this._paintActionSlots();
    this._bindControlInput();
    this._paintModeLabels();
    this._paintRing('idle', 0);
  }

  /** SPEC.md section 5's control-band table: the three action slots differ by state - batting
   *  carries Bunt and Steal (slot 3 an empty well), pitching carries Pickoff (slots 1-2 empty
   *  wells). All three stay disabled either way (steal/bunt/pickoff are `RESERVED_PHASE_6` - the
   *  engine has no baserunning between pitches yet, per `baseball/CLAUDE.md`'s "What is
   *  deliberately NOT built this phase") - only which WELL is occupied changes, per state, which
   *  is what "the wells swap" (section 5's transition row) means. */
  _paintActionSlots() {
    const actions = this.rootEl.querySelector('[data-role="actions"]');
    if (!actions) return;
    const empty = () => `<div class="bb-slot is-empty" aria-hidden="true"></div>`;
    const slot = (act) => `<button type="button" class="bb-slot" data-act="${act}" disabled title="${t('locked')}">${t('act_' + act)}</button>`;
    actions.innerHTML = this.state.mode === 'pitching'
      ? `${empty()}${empty()}${slot('pickoff')}`
      : `${slot('bunt')}${slot('steal')}${empty()}`;
  }

  _paintModeLabels() {
    const label = this.rootEl.querySelector('[data-role="ringlabel"]');
    if (label) label.textContent = this.state.mode === 'pitching' ? t('act_pitch') : t('act_swing');
  }

  /** Redraw the Swing/Throw ring+button in one state - see ring.js's own header for why this is a
   *  single canvas rather than a CSS-colored button overlapping an SVG ring. */
  _paintRing(state, value) {
    const cv = this.rootEl.querySelector('[data-role="ringcanvas"]');
    if (!cv) return;
    drawRingState(cv, this.state.mode === 'pitching' ? 'throw' : 'swing', state, value);
  }

  _bindControlInput() {
    const pad = this.rootEl.querySelector('[data-role="pad"]');
    const mainBtn = this.rootEl.querySelector('[data-role="mainbtn"]');
    pad.style.touchAction = 'none';
    mainBtn.style.touchAction = 'none';

    // Pad: drag to choose lateral position (sweet spot / aim / steer), fraction of plate half-width.
    this.padX = 0;
    const setPadFromEvent = (clientX) => {
      const r = pad.getBoundingClientRect();
      const frac = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1));
      this.padX = frac;
      const marker = this.rootEl.querySelector('[data-role="padmarker"]');
      if (marker) marker.style.left = (50 + frac * 45) + '%';
      // Batting: the figure itself moves across the box with the pad (field.js `drawPlateView`,
      // `batterAimX`), so where you are aimed is visible on the field, not only on the pad. A
      // flight in progress redraws every frame anyway and reads the same state; between pitches
      // this is the only redraw, so do it here. Never in the pitching state - that pad is the
      // pitcher's aim and the CPU batter stands where it stands.
      if (this.state && this.state.mode !== 'pitching') {
        this.state.batterAimX = frac;
        if (!this._flightActive) this._drawStaticField();
      }
      if (this._onPadMove) this._onPadMove(frac);
    };
    let padDown = false;
    const padStart = (clientX) => { padDown = true; setPadFromEvent(clientX); };
    const padMove = (clientX) => { if (padDown) setPadFromEvent(clientX); };
    const padEnd = () => { padDown = false; };
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); padStart(e.touches[0].clientX); }, { passive: false });
    pad.addEventListener('touchmove', (e) => { e.preventDefault(); padMove(e.touches[0].clientX); }, { passive: false });
    pad.addEventListener('touchend', (e) => { e.preventDefault(); padEnd(); });
    pad.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; padStart(e.clientX); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; padMove(e.clientX); });
    this._onWindowPointerUp = (e) => { if (e.pointerType === 'touch') return; padEnd(); };
    window.addEventListener('pointerup', this._onWindowPointerUp);
    setPadFromEvent(pad.getBoundingClientRect().left + pad.getBoundingClientRect().width / 2);

    // Main button: Hill Climb's rapid-tap cure, verbatim shape - non-passive touchstart, touch
    // drives it directly, pointer events ignore pointerType==='touch'.
    let holdStart = null;
    const onDown = () => {
      holdStart = performance.now();
      mainBtn.classList.add('is-down');
      if (this._onMainDown) this._onMainDown();
    };
    const onUp = () => {
      const heldMs = holdStart != null ? performance.now() - holdStart : 0;
      holdStart = null;
      mainBtn.classList.remove('is-down');
      if (this._onMainUp) this._onMainUp(heldMs);
    };
    mainBtn.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    mainBtn.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); });
    mainBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); onUp(); });
    mainBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; onDown(); });
    mainBtn.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') return; onUp(); });
  }

  /** SPEC.md section 5's half-inning transition: "the labels swap in place... the strip cross-
   *  fades... the wells swap... the foreground figure cross-fades... no element changes size or
   *  position... under reduced motion the swap is instant at the beat's midpoint." `swapFn` is
   *  the actual state mutation + repaint (mode flip, HUD/strip/actions/labels/field); this only
   *  wraps it in the fade. Reduced motion runs `swapFn` immediately with no fade at all - still at
   *  the beat's midpoint, since the caller (`_onEngineEvent`'s 'halfInningEnd' case) already
   *  splits the 3000ms beat in half around this call either way. */
  async _crossFadeSwap(swapFn) {
    if (this.destroyed) { swapFn(); return; }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { swapFn(); return; }
    const els = this.rootEl.querySelectorAll('[data-role="hud"], [data-role="strip"], [data-role="ringlabel"], [data-role="actions"], [data-role="canvas"]');
    els.forEach((el) => el.classList.add('bb-fading'));
    await sleep(FADE_MS);
    if (this.destroyed) return;
    swapFn();
    // Force a reflow before removing the class, or the browser can coalesce the add+remove into
    // no visible transition at all (the fade-in would never be seen).
    void this.rootEl.offsetHeight;
    els.forEach((el) => el.classList.remove('bb-fading'));
    await sleep(FADE_MS);
  }

  // -------------------------------------------------------------------------------- engine glue
  async _onEngineEvent(type, payload) {
    if (this.destroyed) return;
    if (type === 'halfInningStart') {
      const swap = () => {
        this.state.mode = this.game.half === 'top' ? 'batting' : 'pitching';
        this.state.lastPitches = [];
        this.actors.idle('batter'); this.actors.idle('pitcher');
        this._paintHud(); this._paintStrip(); this._paintActionSlots(); this._paintModeLabels();
        this._drawStaticField();
      };
      if (this._pendingHalfSwap) {
        // A real half-inning transition (not the game's very first half, where there is nothing
        // to fade FROM and no beat to split) - SPEC.md section 5: swap at the beat's midpoint,
        // cross-faded under full motion, instant under reduced motion (`_crossFadeSwap`'s own
        // check).
        this._pendingHalfSwap = false;
        await this._crossFadeSwap(swap);
        const remaining = Math.max(0, BETWEEN_MS / 2 - FADE_MS * 2);
        await sleep(remaining);
        this._setLine1(''); this._setLine2('');
      } else {
        swap();
      }
    } else if (type === 'atBatStart') {
      this._paintHud();
    } else if (type === 'count') {
      this._paintHud();
      this._setLine1(this._verdictWord(payload.verdict, payload.timingWord));
      this._setLine2(this._pitchReadout());
      if (payload.timingWord) this._showPop(t('v_' + payload.timingWord), payload.timingWord);
      // R2 (handoff section 5): "the verdict holds for resultMs, then betweenMs passes, then the
      // wind-up runs for windupMs, then the flight." `_settleAtBat` already applies the same
      // result-hold + between-pitch gap when a pitch CONCLUDES the at-bat; this is the other
      // case - a plain ball/strike/foul that doesn't - so every pitch gets the identical pause
      // before the next one's wind-up begins (`_stepWindup`, already wired since commit 3).
      //
      // BUT: game.js emits 'count' for EVERY pitch that doesn't put the ball in play, strikeout
      // and walk included - it checks the strikeout/walk thresholds and emits 'atBatEnd' right
      // AFTER this handler returns, on the exact same pitch. Pausing here too doubled the beat on
      // those two outcomes (resultMs+betweenMs from this handler, then resultMs+betweenMs again
      // from `_settleAtBat`) - a review fix. So: skip the pause here when this count is about to
      // conclude the at-bat, and let `_settleAtBat`'s own (single) pause cover it instead.
      const strikeoutPending = payload.strikes >= SETTINGS.MECHANICS.strikesForOut;
      const walkPending = payload.balls >= SETTINGS.MECHANICS.ballsForWalk;
      if (!strikeoutPending && !walkPending) {
        await sleep(RESULT_MS);
        await sleep(BETWEEN_MS);
      }
    } else if (type === 'pitch') {
      // Handled inline by HumanAgent while the ball is in flight (it owns the visual) - but Line
      // 2 (SPEC.md section 5: "pitch name and mph, painted the instant the ball crosses the
      // plate") needs to know WHICH pitch just resolved once 'count'/'atBatEnd' fires, so the
      // type rides here, at release, and is read back out at crossing.
      this.state.pendingPitchType = payload.type;
    } else if (type === 'swing') {
      // BB-3b commit 4: additive event (game.js) - the only way this UI learns the CPU batter
      // swung when the HUMAN is pitching (the decision is otherwise made and consumed entirely
      // inside playAtBat). Only relevant in the pitching state, where the away batter is what's
      // on screen (see field.js's header - the near-box figure is always whichever team is
      // BATTING). Irrelevant while batting (the human's own swing already plays its own Swing
      // clip directly via HumanAgent.decideSwing's settle()).
      if (this.state.mode === 'pitching') {
        if (payload.action === 'swing') {
          // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 4): fade:0 - a swing is a snap, never
          // a 150ms dissolve in from Idle.
          this.actors.play('batter', 'Swing', { markAtMs: 80, fade: 0 });
        } else {
          this.actors.idle('batter');
          this._drawStaticField();
        }
      }
    } else if (type === 'atBatEnd') {
      this._paintHud();
      await this._settleAtBat(payload);
    } else if (type === 'halfInningEnd') {
      // First half of the 3000ms beat (SPEC.md section 5); the 'halfInningStart' that follows
      // (always immediately - nothing awaits between the two in game.js's own loop) does the
      // cross-fade swap and holds the second half, then clears both lines.
      this._setLine1(t('half_end'));
      this._pendingHalfSwap = true;
      await sleep(BETWEEN_MS / 2);
    } else if (type === 'gameEnd') {
      // The end modal (_showEndModal, via the playGame().then() in _startGame) covers this
      // whole screen anyway, but a game that ends ON a half-inning-ending pitch never gets a
      // following 'halfInningStart' to clear the "Side retired" beat's own text (there is no
      // next half) - clear defensively rather than leave it stuck under the modal.
      this._pendingHalfSwap = false;
      this._setLine1(''); this._setLine2('');
    }
  }

  /** THE BIG WORD. Matt (2026-09-15): *"They should be obvious... They should be big and on the
   *  screen, not in tiny text on a line somewhere."* Early / Late / Perfect on every swing (a miss
   *  included, since which WAY you missed is the whole point), Nice / Hung on your own release.
   *  One reserved element in the field band, empty except for the beat after the event, so nothing
   *  else moves (fixed geometry). Each word carries its own shape (chevrons for early/late, a star
   *  for perfect/nice), never color alone. Transform/opacity only; reduced motion holds it still. */
  _showPop(word, kind) {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="pop"]');
    if (!el) return;
    const mark = kind === 'early' ? '\u25C0 ' : (kind === 'perfect' || kind === 'nice') ? '\u2605 ' : '';
    const tail = kind === 'late' ? ' \u25B6' : '';
    el.textContent = mark + word + tail;
    el.className = 'bb-pop is-' + kind;
    if (this._popTimer) clearTimeout(this._popTimer);
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    el.classList.add('is-on');
    this._popTimer = setTimeout(() => { el.classList.remove('is-on'); el.textContent = ''; }, RESULT_MS);
  }

  _setLine1(text) { const el = this.rootEl.querySelector('[data-role="line1"]'); if (el) el.textContent = text; }
  _setLine2(text) { const el = this.rootEl.querySelector('[data-role="line2"]'); if (el) el.textContent = text; }

  /** SPEC.md section 3/9: Line 1's per-pitch verdict, before the outcome is known - a swing
   *  ALWAYS reads as its own timing quality (Early/Late/Perfect) rather than a generic "Strike",
   *  except a foul (which keeps its own word regardless of timing); a take reads Ball/Strike
   *  (called). `game.js`'s 'count'/'atBatEnd' events carry `verdict`/`timingWord` for exactly
   *  this - see its own header for the classification. */
  _verdictWord(verdict, timingWord) {
    if (verdict === 'foul') return t('v_foul');
    if (timingWord) return t('v_' + timingWord);
    if (verdict === 'ball') return t('v_ball');
    return t('v_strike');
  }

  /** SPEC.md section 5: Line 2, "pitch name and mph, painted the instant the ball crosses the
   *  plate" - `state.pendingPitchType` was recorded at release (the 'pitch' event) since the
   *  resolving events ('count'/'atBatEnd') don't carry the pitch's own type. */
  _pitchReadout() {
    const type = this.state.pendingPitchType;
    if (!type) return '';
    const mph = Math.round(pitchMph({ type }, this.league));
    return `${t('pitchname_' + type)} ${mph}`;
  }

  async _settleAtBat(payload) {
    const outKind = payload.outcome;
    const inPlay = payload.distanceFt != null && payload.sprayAngleDeg != null;
    // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 4): a walk/strikeout has no batted ball to
    // hold for, so the batter returns to rest right away, same as every at-bat did before this
    // stage. A ball IN PLAY does NOT reset here - the Swing clip keeps playing through the contact
    // hold below and the whole overhead cutaway, and only drops to Idle once `_returnToPlate()`
    // brings the plate view back (paired there with the pitcher's own return to Set).
    if (!inPlay) this.actors.idle('batter');
    let word = t('res_' + outcomeWord(outKind, payload.bases));
    this._setLine1(word);
    this._setLine2(this._pitchReadout());
    if (payload.timingWord) this._showPop(t('v_' + payload.timingWord), payload.timingWord);
    const outsPerInning = SETTINGS.MECHANICS.outsPerInning;
    if (inPlay) {
      const isOut = /out$/.test(outKind) || outKind === 'strikeout';
      const isHr = outKind === 'homer';
      const rad = (payload.sprayAngleDeg * Math.PI) / 180;
      const xFt = Math.sin(rad) * payload.distanceFt;
      const yFt = Math.cos(rad) * payload.distanceFt;
      // THE CONTACT HOLD (row 4): CONTACT_HOLD_MS on the plate view before the cut.
      await this._contactHold();
      // THE OVERHEAD, RE-PARTITIONED (row 5): flight, then the landing marker's own hold, then
      // `_returnToPlate()` (which clears the cutaway flag and repaints the plate view).
      await this._animateBattedBall(xFt, yFt, isOut ? 'out' : (isHr ? 'hr' : 'hit'), basesLabel(payload.bases));
      // Book-keeping (section 7's own paragraph): 0.4 hold + 1.0 flight + 1.0 marker + 2.4 on the
      // plate = 4.8s = RESULT_MS + BETWEEN_MS - computed FROM those two constants, never a literal
      // 4800, so a settings change still flows through. The between beat is skipped at the end of a
      // half-inning (same rule the non-contact branch below applies), which shrinks the BUDGET, not
      // the fixed hold/flight/marker beats already spent - so the plate remainder is correspondingly
      // shorter, per the doc's own "the remaining time is just shorter."
      const skipBetween = this.game && this.game.outs >= outsPerInning;
      const budget = RESULT_MS + (skipBetween ? 0 : BETWEEN_MS);
      const spent = CONTACT_HOLD_MS + FLIGHT_MS + MARKER_HOLD_MS;
      await sleep(Math.max(0, budget - spent));
    } else {
      await sleep(RESULT_MS);
      // R2's between-pitch gap - unless this at-bat ALSO just ended the half-inning, in which case
      // `_onEngineEvent`'s 'halfInningEnd' case supplies the one gap that transition already gets
      // (spec section 5: the half-inning transition's own beat IS betweenMs) - applying both here
      // would double the pause.
      if (this.game && this.game.outs < outsPerInning) await sleep(BETWEEN_MS);
    }
    this._setLine1(''); this._setLine2('');
  }

  /** THE CONTACT HOLD (stage 7, docs/BASEBALL-3D-BUILD.md section 7, row 4): CONTACT_HOLD_MS on
   *  the plate view before the cut to the overhead camera. `_settleAtBat` does not call
   *  `idle('batter')` for an in-play outcome, so the Swing clip's own follow-through keeps playing
   *  through this whole hold; the 3D ball is animated leaving the bat instead of vanishing on
   *  contact - from wherever it last was (`actors.lastBallPx()`, the pitch's own crossing point, or
   *  the zone's own center if nothing was ever set) up and away toward the mound, shrinking from
   *  its crossing size to about 3px, then hidden. */
  _contactHold() {
    return new Promise((resolve) => {
      if (this.destroyed || !this.actors) { resolve(); return; }
      const cover = plateCover(this._fieldW, this._fieldH);
      const zone = cover ? zoneRect(this._fieldW, cover) : null;
      const start = this.actors.lastBallPx() || (zone ? { x: zone.cx, y: zone.cy, r: 14 } : { x: this._fieldW / 2, y: this._fieldH * 0.6, r: 14 });
      const startR = start.r != null ? start.r : 14;
      const mound = cover ? anchorPx(PLATE_ANCHORS.mound, cover) : { x: this._fieldW / 2, y: this._fieldH * 0.3 };
      const dur = CONTACT_HOLD_MS;
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        this.actors.setBall({
          x: start.x + (mound.x - start.x) * frac,
          y: start.y + (mound.y - start.y) * frac,
          r: startR + (3 - startR) * frac,
        });
        if (frac < 1) {
          this._contactRaf = requestAnimationFrame(step);
        } else {
          this._actorBallHide();
          resolve();
        }
      };
      this._contactRaf = requestAnimationFrame(step);
    });
  }

  /** The ball is IN PLAY - cuts to the overhead camera for the flight and the landing marker (see
   *  field.js's header for why: the out-zone geometry and the landing marker are both authored for
   *  a top-down view and don't translate to the close plate camera).
   *  STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 5): re-partitioned - FLIGHT_MS of flight
   *  (was 700), then MARKER_HOLD_MS holding the landing marker, then `_returnToPlate()` (clears the
   *  cutaway flag, repaints the plate view, shows the 3D layer, and settles both figures into their
   *  resting poses) rather than leaving the return to whichever caller happens to redraw the plate
   *  view next. See `_settleAtBat`'s own book-keeping comment for how this sums against
   *  RESULT_MS/BETWEEN_MS.
   *  STAGE 4: the overhead view stays 2D and unchanged (docs/BASEBALL-3D-BUILD.md's own scope
   *  guard); the 3D layer is out of place here entirely (its figures are anchored to the plate
   *  camera's picture, not this one), so it is paused and hidden for the cutaway's WHOLE duration -
   *  see THE CUTAWAY FLAG (`_cutawayUp`, set here, cleared only by `_returnToPlate()`). */
  _animateBattedBall(xFt, yFt, kind, label) {
    this._cutawayUp = true;
    this._hideActors();
    return new Promise((resolve) => {
      const dur = FLIGHT_MS;
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        this._drawOverheadField();
        drawBall(this.ctx, this._fieldW, this._fieldH, xFt * frac, yFt * frac, { baseRadius: 7 });
        if (frac < 1) {
          this._rafBall = requestAnimationFrame(step);
        } else {
          drawLandingMarker(this.ctx, this._fieldW, this._fieldH, xFt, yFt, kind, label, document.documentElement.classList.contains('gh-dark'));
          // THE MARKER HOLD (row 5): stays up MARKER_HOLD_MS before the cut back - `_returnToPlate()`
          // is the only thing that clears `_cutawayUp`.
          this._markerTimer = setTimeout(() => {
            if (this.destroyed) return resolve();
            this._returnToPlate();
            resolve();
          }, MARKER_HOLD_MS);
        }
      };
      this._rafBall = requestAnimationFrame(step);
    });
  }

  /** The pitch, through the plate camera, while batting: the ball starts far (at the mound) and
   *  GROWS as it approaches - real engine data (`pitchResult.x`/`timeToPlateS`), not a cosmetic
   *  approximation, since the human batter's own decideSwing has the real resolved pitch in hand.
   *  BB-3b commit 4: the lateral position now follows `_pitchBendFrac` - the engine's own `path`
   *  is a straight line (pitch.js never models an intermediate curve), so a literal read of it
   *  would draw every pitch type identically; the bend shape is presentation only, per the spec
   *  ("curveball bends from release, slider from steerFromFrac") - it always reaches exactly
   *  `pitchResult.x` at t=1, so the engine's own value stays the truth at the plate. Also carries
   *  a short fading trail and cycles through `ball-sheet`'s frames as it spins.
   *  STAGE 5: `_actorBallAt` draws the ball, a real lit sphere at the same `xFt`/`yFt` this
   *  function already computes, so the flight's timing/curve (the paragraph above) is unchanged.
   *  There is no 2D ball/trail to draw under it any more. */
  _animatePitchFlight(pitchResult) {
    return new Promise((resolveP) => {
      const dur = pitchResult.timeToPlateS * 1000;
      const t0 = performance.now();
      this._flightActive = true;
      const resolve = () => {
        this._actorBallHide();
        this._flightActive = false;
        // THE PITCHER RETURNS TO SET (stage 7, docs/BASEBALL-3D-BUILD.md section 7, row 3): the
        // CPU's own delivery cross-fades back to Set PITCHER_RETURN_MS after the ball crosses the
        // plate - never at release, so the clip's own follow-through tail (past poses.js's `mark`)
        // gets to play out first. Never scheduled once the screen is gone.
        if (!this.destroyed) {
          if (this._pitcherReturnTimer) clearTimeout(this._pitcherReturnTimer);
          this._pitcherReturnTimer = setTimeout(() => {
            if (!this.destroyed && this.actors) this.actors.toSet();
          }, PITCHER_RETURN_MS);
        }
        resolveP();
      };
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        const bendT = pitchBendFrac(pitchResult.type, frac);
        const yFt = 60.5 * (1 - frac);
        const xFt = pitchResult.x * 8.5 * bendT;
        this._drawStaticField();
        this._actorBallAt(xFt, yFt);
        if (frac < 1) {
          this._pitchRaf = requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      this._pitchRaf = requestAnimationFrame(step);
    });
  }

  /** The break-direction arrow on the pad (spec section 8): visible only while a steerable pitch
   *  (curveball/slider) is in flight, rotated toward whichever side the accumulated steer is
   *  currently bending. `visible=false` hides it (every other pitch type, and once the pitch
   *  crosses the plate). */
  _paintSteerArrow(visible, netSteer) {
    const arrow = this.rootEl && this.rootEl.querySelector('[data-role="steerarrow"]');
    if (!arrow) return;
    if (!visible) { arrow.style.display = 'none'; return; }
    arrow.style.display = '';
    arrow.style.transform = `translate(-50%, -50%) scaleX(${netSteer >= 0 ? 1 : -1})`;
  }

  /** BB-3b commit 6: the standalone `.bb-back` button's own leave confirm - `window.confirm` is
   *  banned by the handoff's own contract (section 7), and was also the only one anywhere in this
   *  repo. In-hub, `isInProgress()` above answers the SAME question for the hub's own leave
   *  dialog (`requestLeave()` in `js/hub.js`), so this only fires standalone; both paths now ask
   *  before dropping a game with the same `.gh-overlay`/`.gh-modal` primitive every other confirm
   *  in this repo uses, never a browser dialog. */
  async _confirmBack() {
    if (this.screen === 'play' && this.game && this.game.winner == null && !this.game.aborted) {
      const leave = await this._confirmForfeitModal();
      if (!leave) return;
    }
    if (this.game) this.game.abort();
    this._backToLauncher();
  }

  _confirmForfeitModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'gh-overlay';
      overlay.innerHTML = `
        <div class="gh-modal" role="dialog" aria-modal="true">
          <p>${t('confirm_forfeit')}</p>
          <div class="gh-modal__actions">
            <button type="button" class="gh-btn" data-act="cancel">${t('cancel')}</button>
            <button type="button" class="gh-btn gh-btn--primary" data-act="leave">${t('leave')}</button>
          </div>
        </div>`;
      this.rootEl.appendChild(overlay);
      const done = (leave) => { overlay.remove(); resolve(leave); };
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
      overlay.querySelector('[data-act="leave"]').addEventListener('click', () => done(true));
    });
  }

  _backToLauncher() {
    window.dispatchEvent(new CustomEvent('gamehub:backtolauncher'));
    if (window.history.length > 1) window.history.back();
  }

  // -------------------------------------------------------------------------------- end modal
  _showEndModal() {
    if (this.destroyed || !this.game) return;
    const g = this.game;
    const you = g.score.away, cpu = g.score.home;
    const wonYou = g.winner === 'away';
    const modal = document.createElement('div');
    modal.className = 'bb-end-overlay';
    modal.innerHTML = `
      <div class="bb-end-modal">
        <button type="button" class="bb-end-close" data-act="close" aria-label="${t('close')}">&times;</button>
        <div class="bb-end-title">${wonYou ? t('end_win') : (g.winner === 'tie' ? t('end_tie') : t('end_loss'))}</div>
        <div class="bb-end-line">${t('you')} ${you} - ${cpu} ${t('cpu')}</div>
        <div class="bb-end-actions">
          <button type="button" class="gh-btn gh-btn--primary" data-act="again">${t('play_again')}</button>
          <button type="button" class="gh-btn" data-act="done">${t('done')}</button>
        </div>
      </div>`;
    this.rootEl.appendChild(modal);
    const close = () => { modal.remove(); this._backToLauncher(); };
    modal.querySelector('[data-act="close"]').addEventListener('click', close);
    modal.querySelector('[data-act="done"]').addEventListener('click', close);
    modal.querySelector('[data-act="again"]').addEventListener('click', () => {
      modal.remove();
      this.screen = 'setup';
      this._renderSetup();
      this._fit();
    });
  }

  // -------------------------------------------------------------------------------- Tune panel (dev only)
  _openTune() {
    if (!this.dev) return;
    const KEYS_ENGINE = ['fastballMs', 'timingWindow', 'foulMult', 'swingDelay', 'sweetSpot', 'batReach',
      'chargeTime', 'chargeWindowMult', 'chargePower', 'meterTime', 'niceWidth', 'perfectMs'];
    const KEYS_UI = ['betweenMs', 'windupMs', 'resultMs'];
    const sheet = document.createElement('div');
    sheet.className = 'bb-tune-overlay';
    const row = (label, group, key, val, min, max, step) => `
      <label class="bb-tune-row">
        <span>${label}</span>
        <input type="range" data-group="${group}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
        <span class="bb-tune-val" data-out="${group}.${key}">${val}</span>
      </label>`;
    let html = '<div class="bb-tune-sheet"><h2>Tune</h2>';
    for (const k of KEYS_ENGINE) {
      const v = SETTINGS.FEEL.engine[k];
      html += row(k, 'engine', k, v, 0, Math.max(2, v * 3), v < 2 ? 0.01 : 1);
    }
    for (const k of KEYS_UI) {
      const v = SETTINGS.FEEL.ui[k];
      html += row(k, 'ui', k, v, 0, Math.max(2, v * 3), 1);
    }
    html += `<div class="bb-tune-actions">
      <button type="button" class="gh-btn" data-act="copy">Copy settings</button>
      <button type="button" class="gh-btn gh-btn--primary" data-act="close">Close</button>
    </div></div>`;
    sheet.innerHTML = html;
    document.body.appendChild(sheet);
    sheet.querySelectorAll('input[type="range"]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const group = inp.dataset.group, key = inp.dataset.key;
        const val = parseFloat(inp.value);
        SETTINGS.FEEL[group][key] = val;
        const out = sheet.querySelector(`[data-out="${group}.${key}"]`);
        if (out) out.textContent = val;
      });
    });
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => sheet.remove());
    sheet.querySelector('[data-act="copy"]').addEventListener('click', () => {
      const json = JSON.stringify(SETTINGS.FEEL, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {});
    });
  }

  // -------------------------------------------------------------------------------- Frames panel (dev only)
  /** BB-3b correction: "Build the dev-only flip-through page first and check foot drift across
   *  the eight frames before wiring the timeline." Originally a sprite flip-through with a "3D
   *  preview" button beside it (stages 1-4); stage 5 (docs/BASEBALL-3D-BUILD.md section 3.10)
   *  removed the sprite frames it flipped through along with the rest of the sprite path, so this
   *  now opens straight on the 3D preview (`_open3DCheck`) - the only figures left to check. */
  _openFrameCheck() {
    if (!this.dev) return;
    const sheet = document.createElement('div');
    sheet.className = 'bb-tune-overlay';
    sheet.innerHTML = `
      <div class="bb-tune-sheet">
        <h2>Frames</h2>
        <div class="bb-tune-actions">
          <button type="button" class="gh-btn gh-btn--primary" data-act="close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => {
      if (this._devActors) { this._devActors.dispose(); this._devActors = null; }
      sheet.remove();
    });
    this._open3DCheck(sheet);
  }

  /** docs/BASEBALL-3D-BUILD.md section 3.7: the 3D half of the Frames panel (stage 1's skeleton,
   *  extended in stages 2-3). Both figures placed at the real PLATE_ANCHORS anchors over the real
   *  plate.webp backdrop, in their real cast colours (setBatter/setPitcher - section 2.2), with
   *  clip buttons/scrubber per role and a home/away toggle. No bat nudge buttons: stage 3 checked
   *  `BAT` against all eight batter frames again and it still reads correctly (poses.js's own
   *  header), so there was nothing to tune here this pass - `_attachBat`'s constants stay stage 2's.
   *  The model path is `globalThis.__bbDevModelUrl` when a test harness sets it (so a screenshot
   *  script can point this at the section 2.1 scaffold), else the real `baseball/models/player.glb`
   *  - a missing/failed load is caught and shown in the panel, never thrown. */
  async _open3DCheck(sheet) {
    if (this._devActors) { this._devActors.dispose(); this._devActors = null; }
    const tuneSheet = sheet.querySelector('.bb-tune-sheet');
    let wrap = sheet.querySelector('[data-role="dev3d-wrap"]');
    if (wrap) wrap.remove();
    // Stale clip buttons/scrubber from a previous open would otherwise keep listeners closed over
    // the actors instance just disposed above - drop them here, unconditionally, not only on the
    // success path below (a failed initGL()/load() must not leave a dead control behind).
    const staleClipCtl = tuneSheet.querySelector('[data-role="dev3d-clipctl"]');
    if (staleClipCtl) staleClipCtl.remove();
    wrap = document.createElement('div');
    wrap.dataset.role = 'dev3d-wrap';
    wrap.className = 'bb-dev3d-wrap';
    const bg = document.createElement('canvas');
    bg.className = 'bb-dev3d-bg';
    bg.width = 320; bg.height = 342;
    wrap.appendChild(bg);
    tuneSheet.insertBefore(wrap, tuneSheet.querySelector('.bb-tune-actions'));

    const bgCtx = bg.getContext('2d');
    const w = bg.width, h = bg.height;
    const im = new Image();
    im.src = new URL('../img/plate.webp', import.meta.url).href;
    await new Promise((res) => { if (im.complete && im.naturalWidth) res(); else { im.onload = res; im.onerror = res; } });
    let cover = { drawW: w, drawH: h, offsetX: 0, offsetY: 0 };
    if (im.naturalWidth && im.naturalHeight) {
      // Cover fit, bottom center - the same formula as field.js's own (private) plateCover(); see
      // the DEV3D_* constants above for why this file mirrors rather than imports it.
      const scale = Math.max(w / im.naturalWidth, h / im.naturalHeight);
      const drawW = im.naturalWidth * scale, drawH = im.naturalHeight * scale;
      cover = { drawW, drawH, offsetX: (w - drawW) / 2, offsetY: h - drawH };
      bgCtx.clearRect(0, 0, w, h);
      bgCtx.drawImage(im, cover.offsetX, cover.offsetY, drawW, drawH);
    }
    const anchorPxLocal = (frac) => ({ x: cover.offsetX + frac.x * cover.drawW, y: cover.offsetY + frac.y * cover.drawH });

    if (closedOrGoneCheck(this, sheet)) return;
    const [{ Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD }, { CLIPS }] = await Promise.all([import('./actors.js'), import('./poses.js')]);
    if (closedOrGoneCheck(this, sheet)) return;
    const actors = new Actors(wrap);
    this._devActors = actors;
    if (!actors.initGL()) {
      wrap.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dev3d-err', textContent: 'No WebGL context' }));
      return;
    }
    actors.resize(w, h, cover);
    const modelUrl = globalThis.__bbDevModelUrl || new URL('../models/player.glb', import.meta.url).href;
    try {
      await actors.load(modelUrl);
    } catch (e) {
      console.warn('baseball 3D dev preview: model failed to load', e);
      wrap.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dev3d-err', textContent: 'No model yet (baseball/models/player.glb)' }));
      return;
    }
    if (closedOrGoneCheck(this, sheet)) { actors.dispose(); this._devActors = null; return; }
    await actors.setBatter({ side: 'home', anchor: anchorPxLocal(PLATE_ANCHORS.nearBoxLeft), heightPx: h * NEAR_BATTER_HEIGHT_FRAC, facingRad: BATTER_FACING_RAD });
    await actors.setPitcher({ side: 'away', anchor: anchorPxLocal(PLATE_ANCHORS.mound), heightPx: h * MOUND_PITCHER_HEIGHT_FRAC, facingRad: PITCHER_FACING_RAD });
    if (closedOrGoneCheck(this, sheet)) { actors.dispose(); this._devActors = null; return; }
    actors.idle('pitcher');
    actors.start();

    // STAGE 2/3 (docs/BASEBALL-3D-BUILD.md section 3.7): clip buttons + a scrubber, so a pose can
    // be seeked to and held next to a sprite frame on the phone. Every named CLIPS entry with
    // authored keys gets a button, split into a batter row and a pitcher row (CLIP_ROLE below) so
    // clicking one always plays it on the actor that actually owns that clip - Set/Pitch on the
    // pitcher, Idle/Swing/Miss on the batter. The scrubber pauses the mixer action at the chosen
    // time instead of racing the running render loop (start()'s own mixer.update would otherwise
    // overwrite a manual seek on the very next frame). A home/away select recolours BOTH figures
    // together (section 2.2's colour-key remap) - the quickest way to eyeball a side on a phone
    // without leaving the panel.
    const CLIP_ROLE = { Idle: 'batter', Swing: 'batter', Miss: 'batter', Set: 'pitcher', Pitch: 'pitcher' };
    const clipCtl = document.createElement('div');
    clipCtl.dataset.role = 'dev3d-clipctl';
    clipCtl.className = 'bb-dev3d-clipctl';
    const batterClips = Object.keys(CLIPS).filter((n) => CLIPS[n].keys.length && CLIP_ROLE[n] === 'batter');
    const pitcherClips = Object.keys(CLIPS).filter((n) => CLIPS[n].keys.length && CLIP_ROLE[n] === 'pitcher');
    clipCtl.innerHTML = `
      <div class="bb-tune-actions" data-role="dev3d-clipbtns">
        ${batterClips.map((n) => `<button type="button" class="gh-btn" data-clip="${n}">${n}</button>`).join('')}
      </div>
      <div class="bb-tune-actions" data-role="dev3d-clipbtns-pitcher">
        ${pitcherClips.map((n) => `<button type="button" class="gh-btn" data-clip="${n}">${n}</button>`).join('')}
      </div>
      <label class="bb-tune-row"><span>Time</span>
        <input type="range" data-role="dev3d-scrub" min="0" max="1" step="0.01" value="0">
        <span class="bb-tune-val" data-role="dev3d-scrub-val">0.00s</span>
      </label>
      <label class="bb-tune-row"><span>Colours</span>
        <select data-role="dev3d-side"><option value="home">home</option><option value="away">away</option></select>
      </label>`;
    tuneSheet.insertBefore(clipCtl, tuneSheet.querySelector('.bb-tune-actions'));
    const scrub = clipCtl.querySelector('[data-role="dev3d-scrub"]');
    const scrubVal = clipCtl.querySelector('[data-role="dev3d-scrub-val"]');
    const sideSel = clipCtl.querySelector('[data-role="dev3d-side"]');
    let currentClip = null;
    let currentRole = null;
    const playClip = (name) => {
      const def = CLIPS[name];
      if (!def || !def.keys.length) return;
      currentClip = name;
      currentRole = CLIP_ROLE[name] || 'batter';
      const dur = def.keys[def.keys.length - 1].t;
      scrub.max = String(dur || 1);
      scrub.value = '0';
      scrubVal.textContent = '0.00s';
      actors.play(currentRole, name);
      const a = actors.actors[currentRole].actions[name];
      if (a) a.paused = false;
    };
    for (const btn of clipCtl.querySelectorAll('[data-clip]')) {
      btn.addEventListener('click', () => playClip(btn.dataset.clip));
    }
    scrub.addEventListener('input', () => {
      if (!currentClip || !currentRole) return;
      const a = actors.actors[currentRole].actions[currentClip];
      if (!a) return;
      a.paused = true;
      a.time = parseFloat(scrub.value);
      scrubVal.textContent = `${a.time.toFixed(2)}s`;
    });
    sideSel.addEventListener('change', () => {
      const side = sideSel.value;
      actors.setBatter({ side });
      actors.setPitcher({ side });
    });
    playClip('Idle');
  }
}

/** True once the game instance or the Frames sheet itself is gone - checked after every await in
 *  _open3DCheck so a slow model load never places actors into, or leaves a render loop running
 *  against, a screen nobody is looking at any more. */
function closedOrGoneCheck(screen, sheet) {
  return screen.destroyed || !sheet.isConnected;
}

// ---------------------------------------------------------------------------------------------
// HumanAgent: implements decidePitch/decideSwing by driving the real UI and waiting for input.
class HumanAgent {
  constructor(screen, league, playerTeam) {
    this.screen = screen;
    this.league = league;
    this.playerTeam = playerTeam;
    // BB-3b commit 4: opts into game.js's pre-rolled scatter seam (see its own header) - a CPU/
    // model agent never sets this, so its own pitches never consume the extra draw and stay
    // byte-identical to every prior phase.
    this.previewsPitch = true;
  }

  /** The human's own pitcher (whichever player teams.js put at the top of the roster - see
   *  makePlayerTeam) - needed to replicate flyPitch's aim-scatter formula in the UI's own preview,
   *  see decidePitch's own header. */
  _ownPitcher() {
    const team = this.playerTeam;
    if (!team) return null;
    return team.players.find((p) => p.id === team.pitcherId) || null;
  }

  async decidePitch(view) {
    const s = this.screen;
    if (s.destroyed) return { type: 'fastball', aim: 0 };
    s.state.mode = 'pitching';
    // 'Set' (== idle('pitcher')) for the whole hold - a continuous loop clip, so nothing needs to
    // be replayed per tick below. The away batter is static until commit 4's swing event.
    s.actors.idle('pitcher'); s.actors.idle('batter');
    s._paintStrip();
    s._paintModeLabels();
    s._setLine1(''); s._setLine2('');
    s._drawStaticField(); // cut back to the plate camera - the last at-bat may have left the
                           // overhead cutaway up (_animateBattedBall)

    return new Promise((resolve) => {
      let steerSamples = [];
      const dtS = SETTINGS.FEEL.engine.dtS;
      const meterMs = SETTINGS.FEEL.engine.meterTime;
      const hangGraceMs = meterMs * SETTINGS.HANG_GRACE_FRAC;
      s._paintRing('filling', 0);
      let raf;
      let released = false;
      const start = performance.now();
      // The pitcher steps set -> wind-up -> release IN TIME WITH the ring's own fill (spec
      // section 8), not a separate fixed delay the way the CPU's own pitch-to-a-human-batter case
      // uses (`_stepWindup`) - a human throwing controls the pace themselves via when they release.
      const tick = (now) => {
        if (s.destroyed) return;
        const elapsed = now - start;
        const frac = elapsed / meterMs;
        if (elapsed > meterMs) {
          s._paintRing('hung', Math.min(1, (elapsed - meterMs) / hangGraceMs));
        } else if (frac >= NICE_CENTER - NICE_HALF) {
          s._paintRing('nice', frac);
        } else {
          s._paintRing('filling', frac);
        }
        if (!released) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      s._onPadMove = () => { /* aim tracked via s.padX, sampled at release; also feeds steer once thrown */ };

      // BB-3b commit 4: decidePitch now resolves at PLATE CROSSING, not at release - it owns the
      // flight clock and samples the pad into `steer` for curveball/slider while the ball is in
      // the air, so what the player watched during the throw is exactly what flyPitch scores once
      // this promise resolves (same hold, same steer array, same pre-rolled scatter draw).
      const finish = () => {
        if (released) return;
        released = true;
        cancelAnimationFrame(raf);
        s._onMainUp = null;
        const holdMs = performance.now() - start;
        s._paintRing('released', Math.min(1.3, holdMs / meterMs));
        // markAtMs:0 seeks straight to the release keyframe (poses.js's CLIPS.Pitch.mark) and
        // plays forward from there at normal speed - the human controls WHEN this fires (their own
        // release), unlike the CPU's fixed-lead-in _stepWindup, so there is no windup to time
        // against; the clip's own follow-through tail (t=1.3) plays out over the flight that
        // follows. This is also the release SIGNAL test-baseball-device.mjs's r2-cadence probe
        // watches (call time + markAtMs) on the CPU-pitches-to-human path via `_stepWindup`'s own
        // call - see its header.
        s.actors.play('pitcher', 'Pitch', { markAtMs: 0 });

        const type = s.state.selectedPitch;
        const aimAtRelease = s.padX;
        const scatterDraw = typeof view.scatterDraw === 'number' ? view.scatterDraw : Math.random();

        // Replicate flyPitch's own hold -> Nice/Hang -> scatter formula (pitch.js) so the live
        // preview below matches what the engine will independently compute from the same hold,
        // scatter and (eventually) steer values.
        const F = SETTINGS.FEEL.engine;
        const niceStartMs = meterMs * (1 - F.niceWidth);
        const hangThresholdMs = meterMs * (1 + SETTINGS.HANG_GRACE_FRAC);
        let wasNice = false, wasHang = false, speedMul = 1, breakMul = 1;
        if (holdMs >= niceStartMs && holdMs <= meterMs) {
          wasNice = true; speedMul = 1 / F.niceBoost; breakMul = F.niceBreak;
        } else if (holdMs > hangThresholdMs) {
          wasHang = true; speedMul = SETTINGS.HANG_SPEED_MULT; breakMul = SETTINGS.HANG_BREAK_MULT;
        }
        if (wasNice) s._showPop(t('v_nice'), 'nice'); else if (wasHang) s._showPop(t('v_hung'), 'hung');
        const pitcher = this._ownPitcher();
        const cap = SETTINGS.CAPS[this.league] != null ? SETTINGS.CAPS[this.league] : SETTINGS.CAPS.majors;
        const skill01 = Math.max(0, Math.min(1, ((pitcher && pitcher.skills.pitchAcc) || 0) / cap));
        const scatterAmt = wasNice ? 0 : F.aimScatter * (1 - skill01 * 0.67);
        const baseX = aimAtRelease + (scatterDraw * 2 - 1) * scatterAmt;

        // A deterministic travel-time estimate for the UI's OWN animation clock (the spec's own
        // words: "travel time is PITCH_TRAVEL_MULT times fastballMs, deterministic") - the UI has
        // no access to the pitcher's speed-affecting skills the way flyPitch itself does, so this
        // is a documented simplification, not the engine's own (slightly different) timeToPlateS.
        const travelMult = SETTINGS.PITCH_TRAVEL_MULT[type] ?? SETTINGS.PITCH_TRAVEL_MULT.fastball;
        const durationMs = F.fastballMs * travelMult * speedMul;
        const totalSteps = Math.max(1, Math.round((durationMs / 1000) / dtS));
        const steerable = SETTINGS.STEERABLE_PITCHES[type];
        const fromStep = steerable ? Math.floor((steerable.steerFromFrac || 0) * totalSteps) : null;
        const steerMaxOffset = SETTINGS.STEER_MAX_OFFSET;
        // doc §11, [Locked]: break direction is the pitch type and the pitcher's OWN hand, never
        // the drag - clamped here exactly as game.js's own flyPitch call will clamp it (same
        // function, same hand), so the live preview never shows a bend the engine won't score.
        const pitcherHand = (pitcher && pitcher.throws) || 'R';
        const dirSign = steerable ? steerDirectionSign(type, pitcherHand) : 1;

        const t0 = performance.now();
        const flightStep = (now) => {
          if (s.destroyed) return finishFlight();
          // Follow-through: the Pitch clip's own tail (poses.js: t=1.3, past the mark) plays it on
          // the mixer's own clock - nothing to schedule here any more.
          const frac = Math.min(1, (now - t0) / durationMs);
          const stepIdx = Math.round(frac * totalSteps);
          if (steerable) steerSamples.push({ step: stepIdx, dx: s.padX - aimAtRelease });
          const clampedSamples = steerable ? steerSamples.map((sm) => ({ step: sm.step, dx: clampSteerDx(dirSign, sm.dx) })) : steerSamples;
          const netSteer = steerable ? resolveSteer(clampedSamples, (st) => st >= fromStep) : 0;
          let liveX = baseX + netSteer * steerMaxOffset * breakMul;
          if (wasHang) liveX = liveX * (1 - SETTINGS.HANG_CENTER_PULL);
          s._drawStaticField();
          s._actorBallAt(liveX * 8.5 * frac, 60.5 * (1 - frac));
          s._paintSteerArrow(steerable, netSteer);
          if (frac < 1) {
            s._flightRaf = requestAnimationFrame(flightStep);
          } else {
            finishFlight();
          }
        };
        const finishFlight = () => {
          s._paintSteerArrow(false, 0);
          s._actorBallHide();
          // THE PITCHER RETURNS TO SET (stage 7, docs/BASEBALL-3D-BUILD.md section 7, row 3): the
          // human's own delivery cross-fades back to Set PITCHER_RETURN_MS after the ball crosses -
          // same rule as the CPU's pitch (`_animatePitchFlight`'s own resolve). Also, in this
          // pitching state, the CPU batter's own figure returns to Idle at the same moment rather
          // than staying wherever its last 'swing' event left it - a ball put in play still gets
          // its own hold/cutaway/return via `_settleAtBat`, so this only matters for the outcomes
          // that never reach it (a swinging miss, a take).
          if (!s.destroyed) {
            if (s._pitcherReturnTimer) clearTimeout(s._pitcherReturnTimer);
            s._pitcherReturnTimer = setTimeout(() => {
              if (s.destroyed || !s.actors) return;
              s.actors.toSet();
              s.actors.idle('batter');
            }, PITCHER_RETURN_MS);
          }
          resolve({ type, aim: aimAtRelease, hold: holdMs, steer: steerSamples, scatter: scatterDraw });
        };
        s._flightRaf = requestAnimationFrame(flightStep);
      };
      s._onMainUp = finish;
    });
  }

  async decideSwing(view) {
    const s = this.screen;
    if (s.destroyed) return { action: 'take' };
    s.state.mode = 'batting';
    s.actors.idle('batter');
    s._paintModeLabels();
    const pitch = view.pitch;
    s.state.lastPitches.push({ type: pitch.type, isStrike: pitch.isStrike, mph: Math.round(pitchMph(pitch, this.league)) });
    s._paintStrip();

    // The CPU's own wind-up (spec section 9, R1): a real 1400ms delivery, timed off
    // FEEL.ui.windupMs, THEN the ball actually leaves the hand - see _stepWindup's own header.
    await s._stepWindup();
    if (s.destroyed) return { action: 'take' };

    const flightPromise = s._animatePitchFlight(pitch);
    s._paintRing('idle', 0);

    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;
      let raf = null;
      let downAt = null;
      const F = SETTINGS.FEEL.engine;
      const releaseMs0 = performance.now();
      const settle = (heldMs) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        const releaseMs = performance.now() - releaseMs0;
        const charged = heldMs >= F.chargeTime;
        const timing = timingFromRelease(releaseMs, pitch.timeToPlateS, F);
        s._paintRing(charged ? 'charged' : 'idle', Math.min(1, heldMs / F.chargeTime));
        // The real swing (BB-3b correction, R3) - starts immediately at release, per spec
        // (`markAtMs: 80` lands the contact keyframe at the same 80ms the old sprite frame-5 did).
        // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 4): fade:0 - no cross-fade in, so the
        // swing is visible on the very frame it starts.
        s.actors.play('batter', 'Swing', { markAtMs: 80, fade: 0 });
        resolve({ action: 'swing', aimX: s.padX, timingErrorMs: timing, charged });
      };
      s._onMainDown = () => {
        downAt = performance.now();
        const loop = () => {
          if (resolved) return;
          const heldMs = performance.now() - downAt;
          const frac = Math.min(1, heldMs / F.chargeTime);
          s._paintRing(frac >= 1 ? 'charged' : 'charging', frac);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      };
      s._onMainUp = (heldMs) => settle(heldMs);

      const timeoutMs = pitch.timeToPlateS * 1000 + 250;
      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        // A take: the batter never left Idle (no half-cock pose exists - inventing one is a
        // feature not discussed, docs/BASEBALL-3D-BUILD.md section 3.6).
        resolve({ action: 'take' });
      }, timeoutMs);
    });
  }
}

function timingFromRelease(releaseMs, timeToPlateS, F) {
  const crossMs = timeToPlateS * 1000;
  const idealReleaseMs = crossMs - F.swingDelay;
  return releaseMs - idealReleaseMs;
}

function pitchMph(pitch, league) {
  const readout = (SETTINGS.READOUT[league] || SETTINGS.READOUT.majors);
  return readout[pitch.type] || readout.fastball;
}

/** Presentation-only break shape for the batting-side flight (BB-3b commit 4): what fraction of
 *  the pitch's own final `x` should be visible at flight-fraction `t`. Always 1 at t=1, so the
 *  drawn ball always lands exactly on the engine's own truth - only the PATH there differs by
 *  type, per spec section 5 ("curveball bends from release, slider from steerFromFrac"). Fastball/
 *  changeup/knuckleball stay linear, matching pitch.js's own (straight) `path`. */
function pitchBendFrac(type, t) {
  if (type === 'curveball') return 1 - Math.pow(1 - t, 2.2); // bends early, eases into its final x
  if (type === 'slider') {
    const from = (SETTINGS.STEERABLE_PITCHES.slider && SETTINGS.STEERABLE_PITCHES.slider.steerFromFrac) || 0.5;
    if (t <= from) return 0;
    const local = (t - from) / (1 - from);
    return local * local;
  }
  return t;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function dots(n, max, cls) {
  let out = '';
  for (let i = 0; i < max; i++) out += `<span class="bb-dot bb-dot-${cls}${i < n ? ' is-on' : ''}"></span>`;
  return out;
}

function basesSvg(bases) {
  const on = (i) => bases[i] != null;
  return `<svg viewBox="0 0 40 40" class="bb-bases-svg">
    <rect x="18" y="4" width="8" height="8" transform="rotate(45 22 8)" class="${on(1) ? 'is-on' : ''}"></rect>
    <rect x="4" y="18" width="8" height="8" transform="rotate(45 8 22)" class="${on(0) ? 'is-on' : ''}"></rect>
    <rect x="28" y="18" width="8" height="8" transform="rotate(45 32 22)" class="${on(2) ? 'is-on' : ''}"></rect>
  </svg>`;
}

/** SPEC.md section 13's exact outcome vocabulary (Single/Double/Triple/Home run/Out/Walk/
 *  Strikeout) - a hit's WORD comes from `bases` (the authoritative count `game.js`'s own
 *  `resolveContact` already resolves), never re-derived from the finer-grained `kind` string
 *  (`ground-gap`/`blooper`/`line-through`/... - those exist for measurement, not for display). */
function outcomeWord(kind, bases) {
  if (kind === 'homer') return 'homer';
  if (kind === 'walk') return 'walk';
  if (kind === 'strikeout') return 'strikeout';
  if (/out$/.test(kind)) return 'out';
  if (bases === 3) return 'triple';
  if (bases === 2) return 'double';
  return 'single';
}

function basesLabel(bases) {
  if (bases === 1) return '1B';
  if (bases === 2) return '2B';
  if (bases === 3) return '3B';
  return '';
}
