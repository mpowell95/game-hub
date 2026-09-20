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
import { flyPitch, breakOffsetFor } from './engine/pitch.js';
import { fenceFtAt } from './engine/outcomes.js';
import {
  engineToWorld, zoneRectFt, zoneCornersFt, projectToCanvas,
  ZONE, BATTER_BOX, RUBBER, CATCHER, UMPIRE, FIGURE_HEIGHT_FT,
  // R3 (docs/BASEBALL-3D-BUILD.md section 9): the fielders' own spots and the runners' base paths.
  fielderWorld, FIELDER_FACING_RAD, basePositions, runnerPath,
  // R4: the ball's own real-world size, for the fire trail's discs (a fraction of the ball's OWN
  // projected radius, never a literal pixel count - baseball.css's own header on why nothing here
  // hardcodes a screen size).
  BALL_RADIUS_FT,
} from './field.js';
import { drawRingState, RING_D } from './ring.js';
// stage 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D actor layer. Loaded eagerly, not lazily -
// unlike Boggle's dictionary, this is the PRIMARY visual for the live play screen, not an optional
// extra, so there is no "first play only" moment to defer it past; ui.js itself is only requested
// when Baseball actually mounts, so this import costs nothing before that.
import {
  Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD, CATCHER_FACING_RAD, UMPIRE_FACING_RAD,
  FIELDER_ROLES, RUNNER_ROLES,
} from './actors.js';

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
// R2 (docs/BASEBALL-3D-BUILD.md section 9): 1000/1000 -> 900/700. The in-play beat has to FIT the
// re-timed budget - `_settleAtBat`'s own book-keeping spends CONTACT_HOLD_MS + FLIGHT_MS +
// MARKER_HOLD_MS out of RESULT_MS + BETWEEN_MS, which R2 cut from 4800 ms to 2000. 400 + 900 + 700
// is exactly 2000, so the remainder on the plate is zero rather than negative.
const FLIGHT_MS = 900;         // the chase-camera ball flight
const MARKER_HOLD_MS = 700;    // the landing marker's own hold before the cut back to the plate
const PITCHER_RETURN_MS = 400; // ball-crosses-plate -> actors.toSet() (both the CPU's pitch and the human's own)
// R1 (docs/BASEBALL-3D-BUILD.md section 9): the first wind-up used to wait for `plate.webp` to
// DECODE. There is no picture any more, so it waits for the scene's own first rendered frame
// (`actors.firstFrame()`) instead - the same guarantee, against the thing that replaced it: a
// delivery must never run under an empty field.
const FIRST_FRAME_CAP_MS = 3000;
// R1: the pitch's own flight in the world. It leaves the pitcher's real hand and ends at the zone
// plane; these two shape it.
//   SAG_FT - a parabola through both endpoints lies ABOVE its own chord, which is what a thrown
//   ball actually does: it leaves the hand rising against the straight line and drops into the
//   zone faster and faster. 0.8 ft of it peaks 0.2 ft over the chord at mid-flight - enough to
//   read as a throw at the batting camera's scale, small enough that the ball still crosses
//   exactly where the engine says it does (the v843 rule, which nothing here may break).
//   The zone's own centre height is where a pitch ends laterally and vertically; the engine has no
//   vertical aim yet (that is R2), so every pitch crosses at the middle of the zone, as it did.
const PITCH_SAG_FT = 0.8;
// R1: the batted ball's apex, in feet, from the engine's own distance - stage 8's rule, restated in
// world units by section 9. A grounder barely leaves the ground; anything else arcs.
// R2: halved (0.35 -> 0.22, cap 120 -> 80). R1's own record: the old rule is "about 40% too high
// for a real fly ball and puts the wall out of the chase camera's frame on a home run".
const BATTED_APEX_MAX_FT = 80;
const BATTED_APEX_FRAC = 0.22;
const BATTED_GROUNDER_APEX_FT = 4;
// R1: the strike zone is drawn by projecting its real world rectangle. On the BATTING camera that
// is about 50 px wide on a 393 px band, which is legible. On the PITCHING camera the same rectangle
// is 72 ft away and projects to 9 px, which is not - so there, and only there, the drawn box is
// scaled about its own centre up to this fraction of the canvas width. It is the same idea as the
// 0.30W floor the painted camera used to apply to its own zone, kept at the batting camera's own
// measured size so the target reads the same in both states. The ball is NOT scaled with it: what
// is drawn large is the aiming frame, never the thing being judged.
const PITCHING_ZONE_MIN_W_FRAC = 0.13;
// R4 (docs/BASEBALL-3D-BUILD.md section 9): "the batting box reads bigger" - the drawn zone box
// and both cursors on the BATTING camera, scaled about the box's own centre by this factor
// (51px -> ~82px wide, the spec's own numbers). The same `k`-about-centre code `_zoneMap` already
// runs for `PITCHING_ZONE_MIN_W_FRAC` on the other camera; this is that same rule, applied as a
// flat multiplier instead of a "at least this wide" floor because batting's true box is already
// legible - it just reads small next to the batter figure filling the frame. The ball is NEVER
// scaled: it is a real sphere positioned in world feet by `_actorBallAt`/`_pitchWorldPoint`, never
// routed through this zone-unit map at all, so there is nothing here that could scale it.
const BATTING_ZONE_SCALE = 1.6;

// R4 (docs/BASEBALL-3D-BUILD.md section 9): the fire trail. Presentation only, 2-D overlay,
// skipped entirely under reduced motion (`_reducedMotion()`). Drawn over the pitch's OWN last 40%
// (frac >= FIRE_TRAIL_FROM_FRAC) when `pitchResult.isStrike` - known at release, both for the
// CPU's pitch and the human's own (`flyPitch` returns it before either flight animation starts).
const FIRE_TRAIL_FROM_FRAC = 0.6;
const FIRE_TRAIL_DISCS = 7;
const FIRE_TRAIL_STEP_FRAC = 0.05; // how far apart the discs sit along the path, in flight-fraction
// Contact burst: 12 lines radiating from the contact point, 18 to 40px, 250ms, white to gold.
const CONTACT_BURST_MS = 250;
const CONTACT_BURST_LINES = 12;
const CONTACT_BURST_R0 = 18;
const CONTACT_BURST_R1 = 40;
// HOME RUN word + confetti. The word's own 0.6->1.0 scale-in is a pure CSS keyframe
// (`bb-homerun-scale`, baseball.css - 300ms, the spec's own number); confetti falls for this long
// once triggered (cut short, cleanly, whenever `_returnToPlate()` hides the element first - no
// engine/timing change here, the spec's own rule, just an animation whose full length may not
// always be seen).
const CONFETTI_MS = 2000;
const CONFETTI_COUNT = 40;
const CONFETTI_COLORS = ['#ffce3a', '#E0532F', '#1F5FA8', '#178A7A', '#ffffff', '#ff9a2e'];

// STAGE 8 (docs/BASEBALL-3D-BUILD.md section 8, row 3): Matt, on v859: "you can't see where the
// ball goes" applied to the PLATE view too - the 3D ball vanished the instant it crossed, so a
// take (a called ball/strike) never showed WHERE it crossed relative to the zone, only the big word
// after the fact. The ball now HOLDS at its crossing point for this long before hiding - long
// enough to read against the zone rectangle, short enough to stay inside the beat's own budget
// (`_contactHold` below still takes the ball over immediately on a ball IN PLAY, per its own
// header). Orchestrator's review of the live probe: the verdict (and the big word) lands about
// 250 ms AFTER the crossing (`decideSwing`'s own take timeout), so a 600 ms hold left the ball
// and the word together for ~350 ms - the ball now stays exactly as long as the word does
// (RESULT_MS), so what the word says and where the ball sits are readable in the same look.
const CROSSING_HOLD_MS = RESULT_MS;

// R3 (docs/BASEBALL-3D-BUILD.md section 9): fielders, runners, the chase, and the diamond widget.
// RUN_WINDOW_MS is the window every runner's own run must fit inside - "if the total run time of
// the longest mover exceeds CONTACT_HOLD_MS + FLIGHT_MS + MARKER_HOLD_MS (2000 ms), speed up ALL
// movers uniformly" (the spec's own words); computed from those three constants, never a second
// literal, so it can never drift from the beat it is actually sharing. A WALK has no chase or
// marker at all, but its own beat (RESULT_MS + BETWEEN_MS) sums to the identical 2000 ms in R2's
// current tuning, so one constant covers both - `_animateRunners` always runs CONCURRENTLY with
// whatever beat it was called from (never awaited in the beat's own sequential chain), so a walk
// that needed the speed-up never lengthens the beat either.
const RUN_WINDOW_MS = CONTACT_HOLD_MS + FLIGHT_MS + MARKER_HOLD_MS;
const RUNNER_SPEED_FT_S = 27;             // the spec's own number: 90 ft in 3.33 s
const WALK_RUNNER_SPEED_FT_S = RUNNER_SPEED_FT_S / 2; // "the forced runners walk... half speed"
const FIELDER_SPEED_FT_S = 27;
const RUNNER_STAND_FACING_RAD = FIELDER_FACING_RAD; // facing the plate, same as every fielder

// RA (docs/BASEBALL-3D-BUILD.md section 9): STEAL, BUNT, PICKOFF - presentation only. Every rule
// these four numbers pace is decided in the engine and arrives here as an event.
const STEAL_LEAD_FT = 4;        // the spec's own lead: how far off the bag an ARMED runner stands
// The steal's own run. It has to finish inside RESULT_MS (the beat the verdict word already holds
// for), because the next pitch's wind-up starts at the end of that beat and a runner still sliding
// into second while the pitcher is delivering is two plays at once. 700 ms covers 90 ft at a
// sprint; the runner is started at the crossing (when the engine tells us) rather than at release,
// which is the one place this presentation is honestly behind the play - see `_animateSteal`.
const STEAL_RUN_MS = 700;
// The pickoff's whole beat: 1.5 s, the spec's number, spent as `Pickoff`'s own 0.5 s clip with the
// ball leaving the hand at its 0.3 s mark and flying to the bag over PICKOFF_BALL_MS, then the
// verdict word for whatever is left.
const PICKOFF_BEAT_MS = 1500;
const PICKOFF_BALL_MS = 400;
const PICKOFF_MARK_MS = 300;

// ---------------------------------------------------------------------------------------------
// R2 (docs/BASEBALL-3D-BUILD.md section 9): THE CONTROLS.
//
// THE WIND-UP'S OWN MARK. Tap PITCH once and the delivery plays; the aim is whatever the 2-D pad
// reads at this point in it, which is also where the ball leaves the hand. The reference game's
// drag window is ~0.6 s (docs/BASEBALL-REFERENCE-B9.md, pitching step 3); 700 ms is that, rounded
// to leave a beat for a thumb that starts moving on the tap rather than before it.
const PITCH_DRAG_MS = 700;
// How far the 2-D pad's travel reaches, in zone units, per state. Pitching reaches further than
// the zone on purpose - a pitch you MEANT to throw off the plate is a real pitch - and slightly
// less vertically than laterally, because the zone itself is taller than it is wide in units of
// feet and the two would otherwise feel differently geared. Batting is square: the cursor is a
// circle and a circle that travelled further one way than the other would lie about itself.
const PAD_TRAVEL = {
  pitching: { x: 1.6, y: 1.4 },
  batting: { x: 1.5, y: 1.5 },
};
// A press that moves less than this many CSS px is a TAP, not a drag - and a tap on the pad
// cycles (the pitch type while pitching, the batting mode while batting) instead of flinging the
// cursor to wherever the thumb landed. The reference game's left button does exactly this.
const PAD_TAP_SLOP_PX = 8;
// The batting target marker's own ring, in zone units - small enough to sit inside either mode's
// circle and still be read against it.
const TARGET_MARKER_R = 0.12;
// An eephus is lobbed: `BREAK_OFFSET.eephus.hump` arcs the drawn ball this far ABOVE the straight
// line at mid-flight before it drops to its own (low) crossing point. Presentation only - the
// engine never sees it, exactly like `pitchBendFrac`.
const EEPHUS_HUMP_UNITS = 0.5;

// R1: the figures' on-screen sizes are no longer fractions of a picture at all. Every figure is
// FIGURE_HEIGHT_FT (6 ft) tall in the world and the camera decides how big that is on screen, so
// NEAR_BATTER_HEIGHT_FRAC/MOUND_PITCHER_HEIGHT_FRAC are gone with the picture they were measured
// off. field.js's CAMERAS comment carries the sizes those numbers used to set by hand.

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

    // THE CUTAWAY FLAG (docs/BASEBALL-3D-BUILD.md section 7, row 6): true for the WHOLE overhead
    // cutaway (contact hold through the landing-marker hold), cleared only by `_returnToPlate()`.
    // `_drawStaticField()` is a no-op while it is set, whoever calls it - see that function's own
    // guard. Matt: a slider touch during the cutaway redrew the plate view underneath and re-showed
    // the 3D layer over the overhead picture; v858 fixed one call path, this flag closes all of them
    // at once, structurally, rather than needing every future caller to remember to check.
    // R1: the same flag, guarding the same thing one layer down - the cutaway is a CAMERA now
    // (`chaseCam`), so what must not happen on an input redraw is the batter/pitcher camera coming
    // back over a ball still in flight.
    this._cutawayUp = false;

    // R3: the defense's current shift (from the 'atBatStart' event, additive) - what `_syncFielders`
    // rotates the outfielders by; the runner roles' own standing state, so `_syncBaseRunners` only
    // ever calls `idle()`/`hide()` on a REAL change instead of restarting the loop every redraw; and
    // the set of roles `_animateRunners` currently owns, so `_syncBaseRunners` never fights it mid-run.
    this._currentShiftDeg = 0;
    this._runnerStanding = { r1: null, r2: null, r3: null };
    this._runnersInMotion = null;
    this._chasingFielderRole = null;

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
        // R1: there is only one layer now (the scene IS the field), so a return to the tab always
        // resumes it - the cutaway no longer hides anything, it moves the camera.
        if (this.actors) this.actors.resume();
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
        .then(() => {
          this._actorsSettled = true;
          // R1: build the stadium and compile its shaders HERE, at mount, not on the Play tap -
          // see `Actors.warm()` for the 227 ms this moves off the critical path. The league can
          // still be changed on the setup screen, so `_renderPlay` rebuilds if it has.
          if (this.actors) {
            this.actors.buildField(this._fenceFt());
            this._fieldLeague = this.league;
            this.actors.warm();
          }
          this._updatePlayButtonState();
        });
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
    // R2: the wind-up's own sample timer (`decidePitch`) - a screen torn down mid-delivery must
    // not fire a pitch into a dead DOM.
    if (this._pitchDragTimer) { clearTimeout(this._pitchDragTimer); this._pitchDragTimer = null; }
    this.destroyed = true;
    // R2: release a batting turn that is still waiting for its READY tap (see decideSwing).
    if (this._pendingReady) this._pendingReady();
    if (this.offViewport) this.offViewport();
    if (this.ro) this.ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._onWindowPointerUp) window.removeEventListener('pointerup', this._onWindowPointerUp);
    if (this._rafBall) cancelAnimationFrame(this._rafBall);
    if (this._pitchRaf) cancelAnimationFrame(this._pitchRaf);
    if (this._flightRaf) cancelAnimationFrame(this._flightRaf);
    if (this._contactRaf) cancelAnimationFrame(this._contactRaf);
    // STAGE 8 row 4: the marker hold is a rAF loop now (it redraws the pulse ring), not a bare
    // setTimeout - `_markerTimer` is gone, `_markerRaf` is what a mid-hold destroy must cancel.
    if (this._markerRaf) cancelAnimationFrame(this._markerRaf);
    if (this._crossingHideTimer) clearTimeout(this._crossingHideTimer);
    if (this._pitcherReturnTimer) clearTimeout(this._pitcherReturnTimer);
    // R3: the runner and fielder-chase loops (docs/BASEBALL-3D-BUILD.md section 9) - both rAF
    // loops that can be mid-flight exactly like the ball's own, and both need the same guard.
    if (this._runnersRaf) cancelAnimationFrame(this._runnersRaf);
    if (this._fielderRaf) cancelAnimationFrame(this._fielderRaf);
    // RA: the steal's run and the pickoff's throw, both rAF loops that can be mid-flight, plus the
    // widget's own hold timer - the same guard every other loop on this screen already has.
    if (this._stealRaf) cancelAnimationFrame(this._stealRaf);
    if (this._pickoffRaf) cancelAnimationFrame(this._pickoffRaf);
    if (this._stealWidgetTimer) clearTimeout(this._stealWidgetTimer);
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

    // RA (docs/BASEBALL-3D-BUILD.md section 9): this screen is QUICK PLAY and nothing else, so all
    // eight pitch types are unlocked for both sides - the human's strip shows eight live tiles and
    // the CPU throws from `QUICK_PLAY_PITCH_MIX`. Career, when it exists, constructs its own Game
    // without this flag and keeps the ladder's unlocks.
    this.game = new Game({ home: cpuTeam, away: playerTeam, seed, agents, settings: SETTINGS, quickPlay: true });
    this.cpuTeam = cpuTeam;
    this.playerTeam = playerTeam;
    this.state = {
      mode: 'batting', // 'batting' | 'pitching'
      selectedPitch: 'fastball',
      unlockedPitches: SETTINGS.unlockedPitchesFor(league, 0, { quickPlay: true }),
      line1: '', line2: '',
      lastPitches: [], // batting strip: last 8 of the at-bat
      recentPitches: [], // pitching strip: last 4
      pendingPitchType: null, // Line 2's readout - see _pitchReadout
      pendingPitch: null, // STAGE 8 row 5: the strip's own tile, staged at decideSwing, pushed at crossing - see _flushPendingPitch
      // R2 (docs/BASEBALL-3D-BUILD.md section 9): the batting mode (the LEFT control's own cycle
      // while batting) and the word on the RIGHT button, both painted by `_paintModeLabels`.
      battingMode: 'contact',
      actionLabel: 'act_ready',
      // RA: what the three action wells have been ARMED for, if anything. Both are one-pitch
      // choices made between pitches and both clear the instant that pitch resolves - a steal
      // because the runner has already gone, a bunt because the spec says so ("Bunt mode clears
      // after the pitch").
      armedSteal: false,
      armedBunt: false,
    };
    // THE 2-D CURSOR, in zone units, shared by both states (R2) - the pitcher's aim while
    // pitching, the batter's circle while batting. It deliberately PERSISTS across pitches and
    // across the half-inning swap: a player who found a spot keeps it, exactly as the reference
    // game does, and the pad's marker is always showing the truth about where it is.
    this.cursor = { x: 0, y: 0 };
    this._target = null;        // the batting target marker's live position, or null between pitches
    this._targetMarkerPx = null; // where it last projected - read by test-baseball-device.mjs
    this.gameAbort = () => { if (this.game) this.game.abort(); };
    // STAGE 8 test seam (docs/BASEBALL-3D-BUILD.md section 8): dev-profile only (`this.dev`, same
    // gate `__bbDevForce` already uses), a no-op otherwise. `test-baseball-device.mjs`'s
    // tap-tap-pitch probe needs the human's OWN pitching turn, which the top half of an inning
    // never starts on - this reaches it without first playing through a whole half-inning of takes.
    // `this.game.half` is read fresh at the top of every `playAtBat()` (`baseball/js/engine/
    // game.js`), only TWO awaits after `playGame()` is called below (`emit('gameStart')` then
    // `emit('halfInningStart')`) - both can resolve before a test's own separate `page.evaluate()`
    // round-trip ever reaches the page, so `window.__bbForceHalfNext` (set by the test, in the SAME
    // evaluate call that taps Play, before this method even runs) is applied here SYNCHRONOUSLY,
    // in the same tick `this.game` is created - the only timing that is guaranteed safe.
    // `window.__bbTest.forceHalf` is also exposed for a later, explicit call (defensive/idempotent
    // - reapplying the same half is a no-op).
    if (this.dev) {
      const forceHalf = (h) => { if (this.game) this.game.half = h; };
      if (window.__bbForceHalfNext) { forceHalf(window.__bbForceHalfNext); window.__bbForceHalfNext = null; }
      // R2 test seam (docs/BASEBALL-3D-BUILD.md section 9), for `test-baseball-device.mjs`'s
      // pitch-drag probe: pin the human pitcher's four pre-rolled draws to their midpoint, which
      // is exactly NO aim scatter, so the pitch a drag asks for is the pitch that crosses and the
      // probe can assert on the number rather than on a distribution. It is honest rather than a
      // decoration: `_throw` writes the pinned draws back into the SAME `view.scatterDraw` object
      // `game.js` reads after `decidePitch` resolves, so the engine scores the identical pitch the
      // screen drew - the one property the whole seam exists to check.
      // RA test seam (docs/BASEBALL-3D-BUILD.md section 9), for `test-baseball-device.mjs`'s
      // actions-live probe: put a REAL roster player (never the batter at the plate, and never an
      // invented id - the engine looks his skills up) on first, so the STEAL and PICKOFF wells can
      // be driven without first playing until somebody happens to reach base. It writes only
      // `game.bases[0]`, which is ordinary engine state that a single, a walk or an error would
      // have written the same way, and repaints whatever reads it.
      const putOnFirst = () => {
        if (!this.game) return null;
        const side = this.game.half === 'top' ? 'away' : 'home';
        const team = this.game[side];
        const batterId = this.game._currentBatterId(side);
        const id = team.battingOrder.find((x) => x !== batterId) || team.battingOrder[0];
        this.game.bases[0] = id;
        this._runnerStanding = {};
        this._paintHud();
        this._paintActionSlots();
        if (!this._flightActive) this._drawStaticField();
        return id;
      };
      window.__bbTest = { forceHalf, noScatter: (on) => { this._testNoScatter = on !== false; }, putOnFirst };
    }

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
          <div class="bb-pop" data-role="pop" aria-live="polite">
            <div class="bb-pop-word" data-role="popword"></div>
            <div class="bb-pop-line" data-role="popline1"></div>
            <div class="bb-pop-line" data-role="popline2"></div>
          </div>
          <canvas class="bb-field-canvas" data-role="canvas"></canvas>
          <div class="bb-lines">
            <div class="bb-line1" data-role="line1"></div>
            <div class="bb-line2" data-role="line2"></div>
          </div>
          <div class="bb-homerun" data-role="homerun" aria-live="polite">
            <div class="bb-homerun-word" data-role="hrword"></div>
            <div class="bb-homerun-strip" data-role="hrstrip"></div>
          </div>
          ${diamondWidgetHTML()}
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
    // R1: the stadium itself, built once per play screen for THIS league's fence shape (the only
    // geometry that varies by league - settings.js's own `fieldScale` scales named-park distances
    // inside the engine, never the diamond, so the base paths and the rubber are regulation here
    // at every league exactly as they are there).
    if (this._fieldLeague !== this.league) {
      this.actors.buildField(this._fenceFt());
      this._fieldLeague = this.league;
    }
    this.actors.setCamera(this.state.mode === 'pitching' ? 'pitcher' : 'batter');
    this.actors.idle('batter');
    this.actors.idle('pitcher');
    this.actors.idle('catcher');
    this.actors.idle('umpire');
    // R3: the nine fielders' own Idle loop starts once, here - same as the four figures above.
    // `_syncFielders()` (every `_syncActors()` call) only ever repositions them after this; calling
    // `idle()` again on every sync would restart the clip from its own t=0 every single frame.
    for (const role of FIELDER_ROLES) this.actors.idle(role);
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
      this.actors.resize(r.width, r.height);
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

  /** THE LIVE CAMERA. R1 (docs/BASEBALL-3D-BUILD.md section 9) replaced "draw the painted plate
   *  picture and place two figures on it" with "point the scene's camera at the right place and
   *  redraw the overlay": `batterCam` while batting, `pitcherCam` while pitching. The 2-D canvas
   *  above the scene now carries only the strike-zone box, projected from the world through
   *  whichever camera is live (`field.js`'s `projectToCanvas`).
   *
   *  The name is kept, and so is every caller, because what it MEANS is unchanged: "put the pitch
   *  view back on screen the way this state wants it." */
  _drawStaticField() {
    // STAGE 7 (section 7, row 6): a NO-OP for the whole cutaway, whoever calls it - the pad
    // handler's own cursor write, a half-inning swap, all of them. Matt's
    // report: a slider touch during the cutaway brought the plate view back over the ball in play.
    // R1 keeps the flag doing exactly this job one layer down: while it is set the chase camera is
    // live and nothing may switch it back. Only `_returnToPlate()` clears it.
    if (this._cutawayUp) return;
    if (!this.ctx || !this._fieldW) return;
    const mode = this.state.mode === 'pitching' ? 'pitching' : 'batting';
    this.actors.setCamera(mode === 'pitching' ? 'pitcher' : 'batter');
    this._syncActors(mode);
    this._drawOverlay(mode);
  }

  /** The 2-D overlay: the strike-zone box, the control cursor, and (during a flight) the batting
   *  target marker. Every point is a real world point run through the live camera, so what is
   *  drawn is where the ball will actually cross and cannot drift from it (the v843 rule, in
   *  world units).
   *
   *  `PITCHING_ZONE_MIN_W_FRAC` is the one deliberate departure from true size, and only on the
   *  pitching camera - see its own constant for why 9 px of true projection is not a target. R2
   *  scales the CURSORS by the same factor about the same centre (`_zoneMap`), so the aiming
   *  picture is one coherent drawing rather than a big box with a 2 px dot in it.
   */
  _drawOverlay(mode) {
    const ctx = this.ctx, w = this._fieldW, h = this._fieldH;
    if (!ctx || !w) return;
    ctx.clearRect(0, 0, w, h);
    const map = this._zoneMap(mode);
    if (!map) return;
    const { x0, y0, x1, y1 } = map;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    if (mode === 'pitching') this._drawPitchCursor(map);
    else this._drawBatCursor(map);
  }

  /** R4: the TRUE, unscaled projected strike-zone box - four world corners through the live
   *  camera, nothing else. This is what `test-baseball-device.mjs`'s `zone-world`/`zone-scale`
   *  probes read (independently, straight off `field.js`), and what `_zoneMap` below scales UP
   *  from for drawing - one true box, read once, never two competing computations of "how big is
   *  the zone" that could silently drift apart. `null` when nothing is mounted yet or the zone is
   *  behind the camera (should not happen at either camera; guarded anyway). */
  _zoneBoxPx() {
    const w = this._fieldW, h = this._fieldH;
    const cam = this.actors && this.actors.camera;
    if (!cam || !w) return null;
    const pts = zoneCornersFt().map((p) => projectToCanvas(cam, p, w, h));
    if (pts.some((p) => p.behind)) return null;
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    return { x0, y0, x1, y1 };
  }

  /** THE ONE PLACE zone units become canvas pixels (R2). `toPx(u, v)` projects the real world
   *  point at zone-unit `(u, v)` through the live camera and then applies this mode's own box
   *  scale about the box's centre, so a cursor at (0,0) is always in the middle of the drawn box
   *  and one at (1,1) is always on its top-right corner, at either camera. `unit` is how many px
   *  one zone unit spans in each axis, for radii.
   *
   *  R4: the batting camera now scales too (`BATTING_ZONE_SCALE`, "the batting box reads bigger"),
   *  the same about-centre rule `PITCHING_ZONE_MIN_W_FRAC` already applied on the other camera -
   *  both read the SAME true box from `_zoneBoxPx()`, so neither can drift from what
   *  `test-baseball-device.mjs`'s `zone-world`/`zone-scale` probes measure independently. */
  _zoneMap(mode) {
    const w = this._fieldW, h = this._fieldH;
    const cam = this.actors && this.actors.camera;
    if (!cam || !w) return null;
    const box = this._zoneBoxPx();
    if (!box) return null;
    const z = zoneRectFt();
    const halfH = z.h / 2;
    let { x0, y0, x1, y1 } = box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let k = 1;
    if (mode === 'pitching') {
      const want = w * PITCHING_ZONE_MIN_W_FRAC;
      k = Math.max(1, want / Math.max(1e-6, x1 - x0));
    } else if (mode === 'batting') {
      k = BATTING_ZONE_SCALE;
    }
    if (k !== 1) {
      x0 = cx - (cx - x0) * k; x1 = cx + (x1 - cx) * k;
      y0 = cy - (cy - y0) * k; y1 = cy + (y1 - cy) * k;
    }
    const toPx = (u, v) => {
      const p = projectToCanvas(cam, { x: u * ZONE.halfW, y: z.cy + v * halfH, z: ZONE.z }, w, h);
      return { x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k };
    };
    return { toPx, x0, y0, x1, y1, cx, cy, k, unitX: (x1 - x0) / 2, unitY: (y1 - y0) / 2 };
  }

  /** PITCHING: the control cursor (a ring with a crosshair) at the aim, plus - for a pitch that
   *  breaks - the yellow POINT CURSOR at where the ball will actually end up. The reference game's
   *  own pair (docs/BASEBALL-REFERENCE-B9.md, pitching step 3: "the ball goes to the point
   *  cursor"). Colour is never the only cue: the control cursor is a ring with a cross in it and
   *  the point cursor is a ring with a dot, and a line joins the two so which is which is legible
   *  in one look (root CLAUDE.md's colorblind-safe rule). */
  _drawPitchCursor(map) {
    const ctx = this.ctx;
    const c = this.cursor;
    const a = map.toPx(c.x, c.y);
    const r = Math.max(7, map.unitX * 0.30);
    const brk = this._pitchBreakUnits();
    ctx.save();
    if (brk && (brk.x || brk.y)) {
      const b = map.toPx(c.x + brk.x, c.y + brk.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#ffce3a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffce3a';
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(2, r * 0.28), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    this._crosshair(a, r);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    this._crosshair(a, r);
    ctx.restore();
  }

  _crosshair(a, r) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x - r * 1.5, a.y); ctx.lineTo(a.x - r * 0.4, a.y);
    ctx.moveTo(a.x + r * 0.4, a.y); ctx.lineTo(a.x + r * 1.5, a.y);
    ctx.moveTo(a.x, a.y - r * 1.5); ctx.lineTo(a.x, a.y - r * 0.4);
    ctx.moveTo(a.x, a.y + r * 0.4); ctx.lineTo(a.x, a.y + r * 1.5);
    ctx.stroke();
  }

  /** BATTING: the mode's circle where the batter is holding it, and - from release to crossing -
   *  the pitch's own TARGET marker, which starts at the straight-line spot and slides to where the
   *  ball will really cross (`_targetAt`). The circle is drawn as an ellipse because one zone unit
   *  is a different number of pixels across than it is up. */
  _drawBatCursor(map) {
    const ctx = this.ctx;
    const c = this.cursor;
    const a = map.toPx(c.x, c.y);
    const r = SETTINGS.FEEL.engine.cursorR[this.state.battingMode] || SETTINGS.FEEL.engine.cursorR.contact;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(a.x, a.y, Math.abs(map.unitX * r), Math.abs(map.unitY * r), 0, 0, Math.PI * 2); ctx.stroke();
    // POWER's circle is smaller AND drawn heavier, so the two modes differ in weight as well as
    // size - a player who cannot see the size change at a glance still sees which one is live,
    // and the pad's own two-tile label says it in words either way.
    ctx.strokeStyle = this.state.battingMode === 'power' ? '#ffce3a' : '#fff';
    ctx.lineWidth = this.state.battingMode === 'power' ? 3 : 2;
    ctx.beginPath(); ctx.ellipse(a.x, a.y, Math.abs(map.unitX * r), Math.abs(map.unitY * r), 0, 0, Math.PI * 2); ctx.stroke();
    const tgt = this._target;
    if (tgt) {
      const p = map.toPx(tgt.x, tgt.y);
      this._targetMarkerPx = { x: p.x, y: p.y };   // read by test-baseball-device.mjs's target-marker probe
      const tr = Math.max(4, Math.abs(map.unitX * TARGET_MARKER_R));
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, tr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#E0532F';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, tr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - tr * 1.6, p.y); ctx.lineTo(p.x + tr * 1.6, p.y);
      ctx.moveTo(p.x, p.y - tr * 1.6); ctx.lineTo(p.x, p.y + tr * 1.6);
      ctx.stroke();
    } else {
      this._targetMarkerPx = null;
    }
    ctx.restore();
  }

  /** The break the CURRENTLY SELECTED pitch will take, in zone units, from the same function the
   *  engine scores it with (`breakOffsetFor`) - never a second copy of the table. A knuckleball's
   *  own randomness is unknowable before the pitch is thrown, so the point cursor shows its
   *  TYPICAL break (both draws at their midpoint, i.e. none) and the ball then goes where it goes,
   *  which is the pitch's whole character. */
  _pitchBreakUnits() {
    const type = this.state.selectedPitch;
    const hand = this._ownPitcherHand();
    return breakOffsetFor(type, hand, 0.5, 0.5, SETTINGS);
  }

  /** The human's own pitcher's throwing hand - which way a handed break goes. */
  _ownPitcherHand() {
    const team = this.playerTeam;
    const p = team && team.players.find((x) => x.id === team.pitcherId);
    return (p && p.throws) || 'R';
  }

  /** THE CUTAWAY FLAG's only exit (stage 7, section 7, row 6): clears `_cutawayUp`, then puts the
   *  pitch camera back for real (`_drawStaticField()` no-ops while the flag is set, so clearing it
   *  first is what lets that call do anything). Also where the beat's own end-of-delivery poses
   *  land: the batter drops out of its held Swing follow-through into Idle and the pitcher
   *  cross-fades into Set, called from here rather than scattered across every caller of
   *  `_animateBattedBall` since this is the one place that always runs once, on the way back. */
  _returnToPlate() {
    this._cutawayUp = false;
    this._setDiamondVisible(false);
    // R4: whatever the HOME RUN word/confetti was doing, it is done the moment the plate view
    // comes back - cut cleanly rather than let a 2s confetti fall or a 300ms scale-in outlive the
    // marker hold it belongs to (its own header: "no engine/timing change... just an animation
    // whose full length may not always be seen").
    this._hideHomerun();
    if (this.actors) {
      this.actors.clearMarker();
      this.actors.setBall(null);
      this.actors.idle('batter');
      this.actors.toSet();
    }
    this._drawStaticField();
  }

  /** R1: the four figures' own placement, in WORLD FEET. The batter stands in his own box (mirrored
   *  to the other side when he bats left, exactly as the sprite era's `nearBoxLeft`/`nearBoxRight`
   *  pair did); the
   *  pitcher stands on the rubber; the catcher crouches behind the plate and the umpire stands
   *  behind him, both fixed. Fire-and-forget: `setBatter`/`setPitcher` are async only on an actual
   *  side change (a real texture swap), which this screen does not need to await on every redraw -
   *  this runs on every `_drawStaticField()` call, several times a second during a pitch. */
  _syncActors(mode) {
    const flip = this._currentBatterFlip();
    const pitcherFlip = this._currentPitcherFlip();
    // R2: the batter STANDS STILL. The pad used to walk him across his own box (the 1-D aim), and
    // it now moves a cursor drawn over the zone instead - which is the reference game's own
    // picture, and the only one that can mean anything in two axes (nobody aims a bat by jumping).
    const boxX = flip ? BATTER_BOX.x : -BATTER_BOX.x;
    const batterSide = mode === 'pitching' ? 'away' : 'home';
    const pitcherSide = mode === 'pitching' ? 'home' : 'away';
    this.actors.setBatter({
      side: batterSide, bats: flip ? 'L' : 'R', facingRad: BATTER_FACING_RAD,
      pos: { x: boxX, y: 0, z: BATTER_BOX.z }, heightFt: FIGURE_HEIGHT_FT,
    });
    this.actors.setPitcher({
      side: pitcherSide, throws: pitcherFlip ? 'L' : 'R', facingRad: PITCHER_FACING_RAD,
      pos: { x: RUBBER.x, y: RUBBER.y, z: RUBBER.z }, heightFt: FIGURE_HEIGHT_FT,
    });
    // The catcher wears the DEFENSE's colours (the same side the pitcher does), so he swaps with
    // the half-inning like the other two; the umpire is his own side and never changes. Both stand
    // still, so their positions are constants rather than anything this recomputes.
    this.actors.setCatcher({ side: pitcherSide, pos: { x: CATCHER.x, y: 0, z: CATCHER.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: CATCHER_FACING_RAD });
    this.actors.setUmpire({ pos: { x: UMPIRE.x, y: 0, z: UMPIRE.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: UMPIRE_FACING_RAD });
    // R3: the nine fielders and the standing base runners. Both no-op cleanly while `this.game`
    // does not exist yet (the very first `_drawStaticField()`, before `_startGame` has run) and
    // both skip whatever role `_animateRunners`/`_animateFielderChase` currently owns, so this
    // (called every `_drawStaticField()`, several times a second) never fights either animation.
    this._syncFielders();
    this._syncBaseRunners();
  }

  /** R3: the nine fielders' own spots (docs/BASEBALL-3D-BUILD.md section 9) - the four infielders
   *  and the pitcher/catcher never move; the three outfielders scale with the league's fence and
   *  rotate with the defense's current shift (`field.js`'s `fielderWorld`, fed `_currentShiftDeg`
   *  from the 'atBatStart' event). Skips whichever role `_animateFielderChase` currently owns - that
   *  one fielder is mid-chase and this must not snap him back to his stand position under it. */
  _syncFielders() {
    if (!this.actors || !this.game) return;
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    const defenseSide = battingSide === 'away' ? 'home' : 'away';
    const fenceFt = this._fenceFt();
    for (const role of FIELDER_ROLES) {
      if (role === this._chasingFielderRole) continue;
      const pos = fielderWorld(role, fenceFt, this._currentShiftDeg || 0);
      if (!pos) continue;
      this.actors.setActor(role, { side: defenseSide, pos, heightFt: FIGURE_HEIGHT_FT, facingRad: FIELDER_FACING_RAD });
    }
  }

  /** R3: the runners standing on their bags between pitches, driven ONLY by `this.game.bases` (the
   *  engine's own state - this never decides who is on base, it just shows it). `_runnerStanding`
   *  remembers each role's last-known occupant so a base that hasn't changed costs nothing (calling
   *  `idle()` again every redraw would restart the Idle clip from t=0 on every single frame). Skips
   *  entirely while `_animateRunners` owns any runner - `this.game.bases` is already the PLAY'S
   *  after-state the instant it resolves (game.js mutates it synchronously before the event
   *  fires), so syncing from it while a runner is still mid-run would snap him straight to where
   *  he is headed instead of letting him run there. */
  _syncBaseRunners() {
    if (!this.actors || !this.game) return;
    if (this._runnersInMotion && this._runnersInMotion.size) return;
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    const pos = basePositions();
    const ROLE = ['r1', 'r2', 'r3'];
    const AT = [pos.first, pos.second, pos.third];
    const bases = this.game.bases;
    // RA (docs/BASEBALL-3D-BUILD.md section 9): "the runner figure takes a 4 ft lead when armed."
    // Only the runner the STEAL button would actually send - the engine's own candidate - and only
    // while the well is armed; the lead is along his own base path, so he is visibly leaning the
    // way he is about to run rather than just standing next to the bag.
    const armedIdx = (this.state && this.state.armedSteal) ? (this._stealCandidate() || {}).from : null;
    const NEXT = [pos.second, pos.third, pos.home];   // third's own next base is home; the engine never offers it (see its `_stealCandidate`)
    for (let i = 0; i < 3; i++) {
      const role = ROLE[i];
      const occupant = bases[i];
      if (occupant != null) {
        const lead = armedIdx === i;
        // The memo carries the lead, not just the occupant: an unchanged runner who has just been
        // armed still has to be re-placed, and one who has just been disarmed has to go back.
        const memo = occupant + (lead ? '|lead' : '');
        if (this._runnerStanding[role] === memo) continue;
        this._runnerStanding[role] = memo;
        let at = AT[i];
        if (lead) {
          const to = NEXT[i];
          const dx = to.x - at.x, dz = to.z - at.z;
          const len = Math.hypot(dx, dz) || 1;
          at = { x: at.x + (dx / len) * STEAL_LEAD_FT, y: 0, z: at.z + (dz / len) * STEAL_LEAD_FT };
        }
        this.actors.setActor(role, { side: battingSide, pos: at, heightFt: FIGURE_HEIGHT_FT, facingRad: RUNNER_STAND_FACING_RAD });
        this.actors.idle(role);
      } else if (this._runnerStanding[role] !== null) {
        this._runnerStanding[role] = null;
        this.actors.hide(role);
      }
    }
  }

  /** THE PITCH, in the world (R1). `xNorm` is the engine's own lateral aim (-1 at the zone's left
   *  edge, +1 at its right, already multiplied by whatever presentation bend the caller applies);
   *  `yNorm` is the same in the vertical axis (R2 - the zone has a height now, and a pitch ends
   *  somewhere in it rather than always at its middle); `frac` is 0 at release and 1 at the
   *  crossing.
   *
   *  The line runs from the pitcher's REAL throwing hand - sampled once, on the first frame of the
   *  flight, which is the release instant - to the crossing point `(xNorm * ZONE.halfW, zone centre
   *  height, ZONE.z)`, with `PITCH_SAG_FT` of gravity arc on the way. There is no pinhole law and
   *  no `plateBallPos` any more: a real camera does the perspective, so the ball grows on its own
   *  and the old screen-space curve is not just unnecessary, it would fight the camera. */
  _actorBallAt(xNorm, yNorm, frac) {
    if (!this.actors) return;
    this.actors.setBall(this._pitchWorldPoint(xNorm, yNorm, frac));
  }
  /** R4: the same line `_actorBallAt` used to compute inline, pulled out so the fire trail
   *  (`_drawFireTrail`) can ask "where was the ball at an EARLIER frac of this same flight" without
   *  touching `this.actors` at all - it only ever reads world points, it never sets the 3D ball's
   *  position (that stays `_actorBallAt`'s own job, called once per frame from the real flight
   *  loop). Samples the pitcher's real hand once per flight, same as before. */
  _pitchWorldPoint(xNorm, yNorm, frac) {
    if (!this._releaseFrom) {
      const hand = this.actors && this.actors.handWorld('pitcher');
      this._releaseFrom = hand || { x: RUBBER.x, y: RUBBER.y + 5, z: RUBBER.z + 1 };
    }
    const z = zoneRectFt();
    const from = this._releaseFrom;
    const to = { x: xNorm * ZONE.halfW, y: z.cy + yNorm * (z.h / 2), z: ZONE.z };
    const f = Math.max(0, Math.min(1, frac));
    return {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f + PITCH_SAG_FT * f * (1 - f),
      z: from.z + (to.z - from.z) * f,
    };
  }
  /** Forget the release point, so the NEXT pitch samples the hand again at its own release rather
   *  than re-using the last one. Called at the start of every flight. */
  _resetReleasePoint() { this._releaseFrom = null; }

  /** R4 (docs/BASEBALL-3D-BUILD.md section 9): the fire trail - 7 fading discs behind the ball,
   *  drawn on the 2-D overlay over the last 40% of a STRIKE's flight (`pitchResult.isStrike`, known
   *  at release for both the CPU's pitch and the human's own - `flyPitch` returns it before either
   *  flight animation starts). Each disc samples an EARLIER point of the SAME path
   *  (`_pitchWorldPoint`/`pitchPointAt`, never a second curve), projected through the live camera,
   *  sized down from the ball's own projected radius (0.9x nearest, 0.3x farthest) and faded
   *  (alpha 0.6 to 0.1, orange to white), `globalCompositeOperation: 'lighter'` so overlapping
   *  discs brighten. Drawn AFTER `_drawStaticField()`'s own zone-box redraw in the same frame,
   *  never clearing it. Skipped entirely under reduced motion (the caller's own gate). */
  _drawFireTrail(pitchResult, frac) {
    if (!this.ctx || !this._fieldW || !this.actors || !this.actors.camera) return;
    const ballPos = this.actors.lastBallPos();
    if (!ballPos) return;
    const p0 = projectToCanvas(this.actors.camera, ballPos, this._fieldW, this._fieldH);
    if (p0.behind) return;
    const p1 = projectToCanvas(this.actors.camera,
      { x: ballPos.x + BALL_RADIUS_FT, y: ballPos.y, z: ballPos.z }, this._fieldW, this._fieldH);
    const baseR = Math.max(2, Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= FIRE_TRAIL_DISCS; i++) {
      const tf = Math.max(0, frac - i * FIRE_TRAIL_STEP_FRAC);
      const wp = pitchPointAt(pitchResult, tf);
      const world = this._pitchWorldPoint(wp.x, wp.y + (wp.hump || 0), tf);
      const proj = projectToCanvas(this.actors.camera, world, this._fieldW, this._fieldH);
      if (proj.behind) continue;
      const kk = (i - 1) / Math.max(1, FIRE_TRAIL_DISCS - 1);
      const r = baseR * (0.9 - 0.6 * kk);
      const alpha = 0.6 - 0.5 * kk;
      const col = lerpColor([255, 154, 46], [255, 255, 255], kk);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The one gate `_animatePitchFlight` and `HumanAgent._throw`'s own flight loop both call before
   *  drawing the trail - a STRIKE, past FIRE_TRAIL_FROM_FRAC of its flight, and motion allowed. */
  _maybeDrawFireTrail(pitchResult, frac) {
    if (!pitchResult.isStrike || frac < FIRE_TRAIL_FROM_FRAC || this._reducedMotion()) return;
    this._drawFireTrail(pitchResult, frac);
  }
  _actorBallHide() { if (this.actors) this.actors.setBall(null); }

  /** A batted ball's world position at `frac` of its flight: a parabola from the contact point to
   *  the landing point with `apexFt` of height at the middle. One function, so the contact hold
   *  (which flies the first slice of it on the pitch camera) and the chase (which flies the rest)
   *  can never draw two different arcs. */
  _battedBallAt(from, to, apexFt, frac) {
    const f = Math.max(0, Math.min(1, frac));
    return {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f + apexFt * 4 * f * (1 - f),
      z: from.z + (to.z - from.z) * f,
    };
  }
  /** The apex stage 8 chose, in feet rather than in band-height fractions (section 9's own
   *  restatement): a grounder barely lifts, anything else arcs higher the farther it carried.
   *  `battedKind` unset or anything other than the engine's own `'ground'` is treated as a fly. */
  _battedApexFt(battedKind, distanceFt) {
    if (battedKind === 'ground') return BATTED_GROUNDER_APEX_FT;
    return Math.min(BATTED_APEX_MAX_FT, (distanceFt || 0) * BATTED_APEX_FRAC);
  }

  /** The model is built right-handed; a LEFT-handed batter is the mirror, standing in the other
   *  box (world +x rather than -x - `_syncActors`). Whichever team is BATTING supplies the hand,
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
    // THE FIRST FRAME (stage 7 row 7, restated for R1). Matt's report was "~1.1s of flat green
    // after Play, and the first wind-up starts under it" - the picture was racing the pitcher's
    // first delivery. There is no picture now, so the thing to wait for is the SCENE having
    // rendered at least once: `actors.firstFrame()` resolves inside the render loop's own tick, the
    // frame after `renderer.render` actually ran. Capped, and a no-op on every later wind-up (the
    // promise is already settled), so it only ever costs time once, on the very first pitch.
    if (!this._firstWindupAwaited) {
      this._firstWindupAwaited = true;
      await Promise.race([this.actors.firstFrame(), sleep(FIRST_FRAME_CAP_MS)]);
      if (this.destroyed) return;
      // `_sizeCanvas()` is scheduled with `requestAnimationFrame` from `_renderPlay()` and this
      // await can resolve on a microtask before that first tick, leaving `this._fieldW` unset.
      // `getBoundingClientRect()` needs no animation frame, so calling it directly here is what
      // closes the race.
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
          // R4 (docs/BASEBALL-3D-BUILD.md section 9): "each unlocked pitch tile shows its readout
          // mph under the code" - the same `pitchMph`/READOUT this pitch itself is thrown at
          // (`_throw`'s own `flyPitch` call), never a second number.
          return `<button type="button" class="bb-pitch-tile${p === this.state.selectedPitch ? ' is-sel' : ''}" data-pitch="${p}">
            <span class="bb-pitch-name">${t('pitch_' + p)}</span>
            <span class="bb-pitch-mph">${Math.round(pitchMph({ type: p }, this.league))}</span>
          </button>`;
        }).join('')
      }</div>`;
      strip.querySelectorAll('[data-pitch]').forEach((b) => {
        b.addEventListener('click', () => {
          this.state.selectedPitch = b.dataset.pitch;
          this._paintStrip();
          // R2: the pad's head row names the selected pitch and the world overlay draws THAT
          // pitch's point cursor, so choosing from the strip has to repaint both - otherwise the
          // yellow ring goes on promising the break of the pitch you just stopped throwing.
          this._paintModeLabels();
          if (!this._flightActive) this._drawStaticField();
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

  /** STAGE 8 (docs/BASEBALL-3D-BUILD.md section 8, row 5): moves the strip's own push from the
   *  pitch DECISION (`decideSwing`, before the wind-up even starts) to plate CROSSING - Matt's
   *  report: the tile (type, mph AND the (bullet)/(square) result mark) was on screen before the
   *  pitch was even thrown, reading as precognition. `decideSwing` now only stages the incoming
   *  pitch in `state.pendingPitch`; this is the one place that actually pushes it into
   *  `state.lastPitches` and repaints, called from BOTH 'count' and 'atBatEnd' (whichever one
   *  resolves this exact pitch - see `_onEngineEvent`'s own header on why a strikeout/walk pitch
   *  fires both). Clearing `pendingPitch` after the first push is what stops that same pitch being
   *  pushed twice. A no-op outside batting mode (pitching mode never sets `pendingPitch` at all). */
  _flushPendingPitch() {
    if (this.state.mode === 'batting' && this.state.pendingPitch) {
      this.state.lastPitches.push(this.state.pendingPitch);
      this.state.pendingPitch = null;
      this._paintStrip();
    }
  }

  // -------------------------------------------------------------------------------- control band
  /** R2 (docs/BASEBALL-3D-BUILD.md section 9): the LEFT control is a square 2-D PAD - the same
   *  159px box the 1-D slider occupied, with the same fixed geometry, carrying a marker that moves
   *  in x AND y. Its head row is a fixed two-tile strip showing what a TAP on the pad cycles: the
   *  batting mode while batting, the selected pitch while pitching. Nothing in this band changes
   *  size or position between states - only what the tiles say.
   *  Deleted with the meter: `.bb-pad-zone`'s lateral bar, `.bb-pad-sweet`, and the steer arrow. */
  _paintControl() {
    const control = this.rootEl.querySelector('[data-role="control"]');
    if (!control) return;
    control.innerHTML = `
      <div class="bb-pad" data-role="pad">
        <div class="bb-pad-head" data-role="padhead"></div>
        <div class="bb-pad-box"></div>
        <div class="bb-pad-cross" aria-hidden="true"></div>
        <div class="bb-pad-marker" data-role="padmarker"></div>
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
    this._paintRing('idle');
    this._paintPadMarker();
  }

  /** RA (docs/BASEBALL-3D-BUILD.md section 9): THE THREE ACTION WELLS ARE LIVE. Their geometry,
   *  their labels and which well each one occupies are exactly as SPEC.md section 5's control-band
   *  table set them and as every build since has drawn them - batting carries Bunt and Steal with
   *  slot 3 empty, pitching carries Pickoff with slots 1-2 empty. What changed is that they are no
   *  longer permanently `disabled`: each one is enabled by STATE.
   *
   *  The state each turns on is the spec's: STEAL between pitches (before READY) when a runner's
   *  next base is empty, BUNT before READY always, PICKOFF before PITCH when a runner is on first.
   *  "Before READY"/"before PITCH" is `state.actionLabel` - the word on the RIGHT button IS which
   *  half of the turn we are in, so the two can never disagree.
   *
   *  WHO CAN STEAL IS THE ENGINE'S ANSWER, NOT THIS FILE'S: `game._stealCandidate(side)` is the
   *  same function `_buildSwingView` feeds the agents, so an enabled button and a steal the engine
   *  would actually run are the same thing by construction. A disabled well keeps `disabled` and
   *  the `locked` title exactly as it had them.
   *
   *  ARMED is shown with a filled circle in front of the label as well as the accent colour, never
   *  colour alone (root CLAUDE.md's colorblind-safe rule). */
  _paintActionSlots() {
    const actions = this.rootEl.querySelector('[data-role="actions"]');
    if (!actions) return;
    const label = this.state.actionLabel;
    const batting = this.state.mode !== 'pitching';
    const preReady = batting && label === 'act_ready';
    const prePitch = !batting && label === 'act_pitch';
    const canSteal = preReady && !!this._stealCandidate();
    const canPickoff = prePitch && !!(this.game && this.game.bases[0] != null);
    const empty = () => `<div class="bb-slot is-empty" aria-hidden="true"></div>`;
    const slot = (act, enabled, armed) => (enabled
      ? `<button type="button" class="bb-slot is-live${armed ? ' is-armed' : ''}" data-act="${act}" aria-pressed="${armed ? 'true' : 'false'}">${armed ? '\u25CF ' : ''}${t('act_' + act)}</button>`
      : `<button type="button" class="bb-slot" data-act="${act}" disabled title="${t('locked')}">${t('act_' + act)}</button>`);
    actions.innerHTML = !batting
      ? `${empty()}${empty()}${slot('pickoff', canPickoff, false)}`
      : `${slot('bunt', preReady, this.state.armedBunt)}${slot('steal', canSteal, this.state.armedSteal)}${empty()}`;
    actions.querySelectorAll('button[data-act]:not([disabled])').forEach((b) => {
      b.style.touchAction = 'manipulation';
      b.addEventListener('click', () => this._onActionSlot(b.dataset.act));
    });
  }

  /** RA: the engine's own "who could run", read through the live Game so this screen can never
   *  offer a steal the engine would refuse (or hide one it would allow). `null` between games and
   *  whenever nobody is eligible. */
  _stealCandidate() {
    if (!this.game || !this.game._stealCandidate) return null;
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    return this.game._stealCandidate(battingSide);
  }

  /** RA: a tap on one of the three wells. STEAL and BUNT ARM for the next pitch (tap again to
   *  disarm - they are toggles, and a player who armed one by accident must be able to take it
   *  back without throwing a pitch away); PICKOFF is not an arming action at all, it IS the
   *  decision, so it resolves the pitching turn immediately with no pitch thrown. Every one of
   *  them is a TAP, never a hold (doc §3, [Locked]). */
  _onActionSlot(act) {
    if (act === 'steal') {
      this.state.armedSteal = !this.state.armedSteal;
      this._paintActionSlots();
      // The lead is drawn from `_syncBaseRunners`, which reads `armedSteal` - so the figure steps
      // off the bag the instant the well lights up.
      this._runnerStanding = {};
      if (!this._flightActive) this._drawStaticField();
    } else if (act === 'bunt') {
      this.state.armedBunt = !this.state.armedBunt;
      this._paintActionSlots();
      this._paintModeLabels();
    } else if (act === 'pickoff') {
      if (this._onPickoff) this._onPickoff();
    }
  }

  /** RA: both one-pitch arms, cleared the moment the pitch that carried them resolves. Called from
   *  the two places a batting decision is actually returned (`HumanAgent.decideSwing`'s swing tap
   *  and its take timeout), never from an event handler - the decision object has already been
   *  built by then, so clearing here cannot change what the engine was told. */
  _clearArmed() {
    this.state.armedSteal = false;
    this.state.armedBunt = false;
    this._runnerStanding = {};
    this._paintActionSlots();
    this._paintModeLabels();
  }

  /** The main button's word (PITCH / READY / SWING) and the pad's head row, repainted together
   *  because they are two halves of one statement: what the RIGHT control does now, and what the
   *  LEFT one cycles. `state.actionLabel` is set by whichever HumanAgent turn is live. */
  _paintModeLabels() {
    const label = this.rootEl.querySelector('[data-role="ringlabel"]');
    const key = this.state.actionLabel || (this.state.mode === 'pitching' ? 'act_pitch' : 'act_ready');
    if (label) label.textContent = t(key);
    const btn = this.rootEl.querySelector('[data-role="mainbtn"]');
    if (btn) btn.setAttribute('aria-label', t(key));
    const pad = this.rootEl.querySelector('[data-role="pad"]');
    if (pad) pad.dataset.mode = this.state.mode === 'pitching' ? 'pitching' : 'batting';
    const head = this.rootEl.querySelector('[data-role="padhead"]');
    if (!head) return;
    if (this.state.mode === 'pitching') {
      head.innerHTML = `<div class="bb-pad-tile is-sel">${t('pitchname_' + this.state.selectedPitch)}</div>`;
    } else if (this.state.armedBunt) {
      // RA (docs/BASEBALL-3D-BUILD.md section 9): "the mode bar highlights BUNT". Two tiles, the
      // same two this row always has (fixed geometry - nothing in this band may change size or
      // count between states), with the FIRST one reading BUNT and selected: in bunt mode the
      // contact/power circle is not what the pitch is met with, so naming the mode there would be
      // saying something untrue. The second tile still names the mode the batter will be back in
      // the moment the bunt clears.
      head.innerHTML = `<div class="bb-pad-tile is-sel">\u25CF ${t('mode_bunt')}</div>`
        + `<div class="bb-pad-tile">${t('mode_' + this.state.battingMode)}</div>`;
    } else {
      head.innerHTML = ['contact', 'power'].map((m) => (
        `<div class="bb-pad-tile${m === this.state.battingMode ? ' is-sel' : ''}">${m === this.state.battingMode ? '\u25CF ' : ''}${t('mode_' + m)}</div>`
      )).join('');
    }
  }

  /** Redraw the Swing/Pitch button in one state - see ring.js's own header for why this is a
   *  single canvas rather than a CSS-colored button overlapping an SVG ring. R2 deleted the meter
   *  that used to sweep around it, so the only states left are idle and pressed. */
  _paintRing(state) {
    const cv = this.rootEl.querySelector('[data-role="ringcanvas"]');
    if (!cv) return;
    drawRingState(cv, state);
  }

  /** The pad's own marker, from `this.cursor` (zone units) through this state's travel. */
  _paintPadMarker() {
    const marker = this.rootEl && this.rootEl.querySelector('[data-role="padmarker"]');
    if (!marker) return;
    const travel = PAD_TRAVEL[this.state.mode === 'pitching' ? 'pitching' : 'batting'];
    const fx = Math.max(-1, Math.min(1, this.cursor.x / travel.x));
    const fy = Math.max(-1, Math.min(1, this.cursor.y / travel.y));
    marker.style.left = (50 + fx * 45) + '%';
    marker.style.top = (50 - fy * 45) + '%';
  }

  /** THE CURSOR, in zone units, from a point inside the pad. The pad's full half-width is that
   *  state's own travel (`PAD_TRAVEL`), so the finger and the cursor move together 1:1 in pad
   *  units and the zone box sits in the middle of the square at |u| <= 1. */
  _setCursorFromPad(clientX, clientY, padRect) {
    const travel = PAD_TRAVEL[this.state.mode === 'pitching' ? 'pitching' : 'batting'];
    const fx = Math.max(-1, Math.min(1, ((clientX - padRect.left) / padRect.width) * 2 - 1));
    const fy = Math.max(-1, Math.min(1, ((clientY - padRect.top) / padRect.height) * 2 - 1));
    this.cursor = { x: fx * travel.x, y: -fy * travel.y };   // screen down is zone DOWN
    this._paintPadMarker();
    if (!this._flightActive) this._drawStaticField();
    else this._drawOverlay(this.state.mode === 'pitching' ? 'pitching' : 'batting');
  }

  /** Cycle whatever the LEFT control cycles in this state: the pitch type (unlocked ones only,
   *  the same list the strip shows) or the batting mode. The reference game's left button does
   *  exactly this when it is not being dragged. */
  _cyclePad() {
    if (this.state.mode === 'pitching') {
      const list = this.state.unlockedPitches;
      const i = list.indexOf(this.state.selectedPitch);
      this.state.selectedPitch = list[(i + 1) % list.length];
      this._paintStrip();
    } else {
      this.state.battingMode = this.state.battingMode === 'power' ? 'contact' : 'power';
    }
    this._paintModeLabels();
    if (!this._flightActive) this._drawStaticField();
  }

  _bindControlInput() {
    const pad = this.rootEl.querySelector('[data-role="pad"]');
    const mainBtn = this.rootEl.querySelector('[data-role="mainbtn"]');
    pad.style.touchAction = 'none';
    mainBtn.style.touchAction = 'none';

    // THE PAD (R2): a 2-D drag, bound to the pad element only (root CLAUDE.md's "never put a
    // touchmove listener on document"). A press that never travels PAD_TAP_SLOP_PX is a TAP and
    // cycles instead of moving the cursor, so a thumb landing on the pad to change pitch does not
    // also fling the aim into the corner it landed in.
    let padDown = false, padMoved = false, padFrom = null, padRect = null;
    const padStart = (x, y) => {
      padDown = true; padMoved = false; padFrom = { x, y };
      padRect = pad.getBoundingClientRect();
    };
    const padMove = (x, y) => {
      if (!padDown) return;
      if (!padMoved && Math.hypot(x - padFrom.x, y - padFrom.y) < PAD_TAP_SLOP_PX) return;
      padMoved = true;
      this._setCursorFromPad(x, y, padRect);
    };
    const padEnd = () => {
      if (padDown && !padMoved) this._cyclePad();
      padDown = false;
    };
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); padStart(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    pad.addEventListener('touchmove', (e) => { e.preventDefault(); padMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    pad.addEventListener('touchend', (e) => { e.preventDefault(); padEnd(); });
    pad.addEventListener('touchcancel', () => { padDown = false; });
    pad.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; padStart(e.clientX, e.clientY); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; padMove(e.clientX, e.clientY); });
    this._onWindowPointerUp = (e) => { if (e.pointerType === 'touch') return; padEnd(); };
    window.addEventListener('pointerup', this._onWindowPointerUp);

    // Main button: Hill Climb's rapid-tap cure, verbatim shape - non-passive touchstart, touch
    // drives it directly, pointer events ignore pointerType==='touch'. R2: every use of it is now
    // a TAP (tap PITCH, tap READY, tap SWING), so the hold clock the charged swing and the pitch
    // meter both read is gone; `_onMainDown` is the whole input.
    const onDown = () => {
      mainBtn.classList.add('is-down');
      this._paintRing('down');
      if (this._onMainDown) this._onMainDown();
    };
    const onUp = () => {
      mainBtn.classList.remove('is-down');
      this._paintRing('idle');
      if (this._onMainUp) this._onMainUp();
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
    // R1: the WebGL canvas joins the fade. It carries the whole field now, so a half-inning swap
    // that faded only the 2-D overlay would have faded the strike-zone box and nothing else.
    const els = [...this.rootEl.querySelectorAll('[data-role="hud"], [data-role="strip"], [data-role="ringlabel"], [data-role="actions"], [data-role="canvas"]')];
    if (this.actors && this.actors.canvas) els.push(this.actors.canvas);
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
        // R2: the RIGHT button's word belongs to whichever turn is live, and between halves there
        // is none - clearing it lets `_paintModeLabels` fall back to this state's own first word
        // (PITCH or READY) instead of leaving the last one up for the beat before the turn starts.
        this.state.actionLabel = null;
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
      // R3: the defense's current shift for this at-bat (additive on the event, `game.js`'s own
      // `_shiftDegFor`) - what `_syncFielders` rotates the outfielders by. It cannot change again
      // until the NEXT at-bat (nothing in this engine re-shifts mid-at-bat).
      this._currentShiftDeg = payload.shiftDeg || 0;
      this._paintHud();
    } else if (type === 'count') {
      this._paintHud();
      // R4 (docs/BASEBALL-3D-BUILD.md section 9): Line 1/Line 2 (`.bb-lines`, the band's bottom)
      // go EMPTY on a pitch - the verdict word, the pitch readout and the swing line all moved into
      // the pop itself, anchored over the batter. `_settleAtBat` still sets Line 1 to the at-bat's
      // own outcome word (Single/Strikeout/...) below; that is unchanged.
      this._setLine1(''); this._setLine2('');
      // STAGE 8 row 5: the strip tile (type, mph AND the (bullet)/(square) result mark) is pushed
      // and painted HERE, at plate crossing - the same moment the pop's pitch line already reads -
      // never at the pitch DECISION (`decideSwing`'s own header explains why that read as
      // precognition).
      this._flushPendingPitch();
      const opts = { pitchLine: this._pitchReadout(), swingLine: this._swingLine(payload.verdict, payload.timingWord) };
      if (payload.timingWord) {
        this._showPop(t('v_' + payload.timingWord), payload.timingWord, opts);
      } else if (payload.verdict === 'ball') {
        this._showPop(t('v_ball'), 'ball', opts);
      } else if (payload.verdict === 'strike') {
        this._showPop(t('v_strike'), 'strike', opts);
      } else if (payload.verdict === 'foul') {
        this._showPop(t('v_foul'), 'foul', opts);
      }
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
        if (payload.bunt) {
          // RA: the CPU batter squared to bunt. It is a LOOP, held from here through contact, so
          // there is no swing to snap into and the ordinary cross-fade is right.
          this.actors.play('batter', 'Bunt');
        } else if (payload.action === 'swing') {
          // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 4): fade:0 - a swing is a snap, never
          // a 150ms dissolve in from Idle.
          this.actors.play('batter', 'Swing', { markAtMs: 80, fade: 0 });
        } else {
          this.actors.idle('batter');
          this._drawStaticField();
        }
      }
    } else if (type === 'pickoff') {
      // RA (docs/BASEBALL-3D-BUILD.md section 9): the throw over to first, the whole 1.5 s beat.
      // AWAITED, unlike the steal below: the engine goes straight back to the next pitch decision
      // the instant this resolves, so this IS the beat rather than something running beside one.
      await this._playPickoff(payload);
    } else if (type === 'steal') {
      // RA: the runner's own run, started here and deliberately NOT awaited - it has to run
      // alongside the verdict beat the 'count' event is about to hold (`_animateSteal`'s own
      // header), never in front of it, or every steal would add a second to the game's cadence.
      this._animateSteal(payload);
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

  /** R4 (docs/BASEBALL-3D-BUILD.md section 9): true whenever the OS/browser asks for reduced
   *  motion. Read fresh every call (never cached) - the same check `_crossFadeSwap`/
   *  `_runMarkerHold` already make inline; this is the one place the new R4 effects (fire trail,
   *  contact burst, HOME RUN confetti/scale) all gate through, so there is exactly one query to
   *  keep honest rather than four copies of the same media-query string. */
  _reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  /** R4: the batter's own head, in world feet - 6.9 ft above his stand position. There is only
   *  ONE batter figure (`_syncActors` never moves him between modes, only the CAMERA changes), so
   *  "the near batter's position in the batting state, the far batter's in the pitching state"
   *  (the spec's own words) is the same world point either way; what differs is only which camera
   *  projects it, which `_positionPop` reads off `this.actors.camera` at call time. */
  _batterHeadWorld() {
    const flip = this._currentBatterFlip();
    const boxX = flip ? BATTER_BOX.x : -BATTER_BOX.x;
    return { x: boxX, y: 6.9, z: BATTER_BOX.z };
  }

  /** R4: places `.bb-pop` at the batter's head, projected through whichever camera is live right
   *  now, clamped to stay inside the field band with a 12px margin either side (the spec's own
   *  number) so the word can never run off the edge of a narrow phone. A behind-camera projection
   *  (should not happen - both cameras always frame the batter) leaves the element at its last
   *  position rather than snapping it to (0,0). */
  _positionPop() {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="pop"]');
    if (!el || !this.actors || !this.actors.camera || !this._fieldW) return;
    const p = projectToCanvas(this.actors.camera, this._batterHeadWorld(), this._fieldW, this._fieldH);
    if (p.behind) return;
    const margin = 12;
    const x = Math.max(margin, Math.min(this._fieldW - margin, p.x));
    const y = Math.max(margin, Math.min(this._fieldH - margin, p.y));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  /** THE BIG WORD. Matt (2026-09-15): *"They should be obvious... They should be big and on the
   *  screen, not in tiny text on a line somewhere."* Early / Late / Perfect on every swing (a miss
   *  included, since which WAY you missed is the whole point), Nice / Hung on your own release.
   *  One reserved element in the field band, empty except for the beat after the event, so nothing
   *  else moves (fixed geometry - only WHERE inside the band it sits moves, via `_positionPop`,
   *  never its size or the layout around it). Each word carries its own shape (chevrons for
   *  early/late, a star for perfect/nice), never color alone. Transform/opacity only; reduced
   *  motion holds it still.
   *
   *  R4: moved from a fixed 26%-down spot to a point projected from the world, over the batter's
   *  head (`_positionPop`), and grew two lines under the word - `opts.pitchLine` (pitch name + mph)
   *  and `opts.swingLine` (which swing outcome this was), both optional and both cleared when not
   *  supplied so no stale text from the last pop (e.g. a pickoff's plain Out/Safe) survives under
   *  it. */
  _showPop(word, kind, opts) {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="pop"]');
    if (!el) return;
    // STAGE 8 row 3: Ball/Strike carry the SAME shape marks the strip already uses for them (\u25CF/\u25A0,
    // baseball.css's `.bb-pitch-tile`) so the big word and the strip agree at a glance - color is
    // never the only cue (root CLAUDE.md's colorblind-safe rule). Foul keeps its own word alone
    // (it was never a shape in the strip either).
    // RA: Out and Safe carry the SAME two shapes Strike and Ball already do - a square for the
    // verdict that costs you something, a circle for the one that does not - so a player reads the
    // shape without having to learn a second vocabulary, and colour is never the only cue.
    const mark = kind === 'early' ? '\u25C0 ' : (kind === 'perfect' || kind === 'nice') ? '\u2605 '
      : (kind === 'ball' || kind === 'safe') ? '\u25CF ' : (kind === 'strike' || kind === 'out') ? '\u25A0 ' : '';
    const tail = kind === 'late' ? ' \u25B6' : '';
    const wordEl = el.querySelector('[data-role="popword"]');
    const line1El = el.querySelector('[data-role="popline1"]');
    const line2El = el.querySelector('[data-role="popline2"]');
    if (wordEl) wordEl.textContent = mark + word + tail;
    if (line1El) line1El.textContent = (opts && opts.pitchLine) || '';
    if (line2El) line2El.textContent = (opts && opts.swingLine) || '';
    el.className = 'bb-pop is-' + kind;
    this._positionPop();
    if (this._popTimer) clearTimeout(this._popTimer);
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    el.classList.add('is-on');
    this._popTimer = setTimeout(() => { el.classList.remove('is-on'); if (wordEl) wordEl.textContent = ''; if (line1El) line1El.textContent = ''; if (line2El) line2El.textContent = ''; }, RESULT_MS);
  }

  _setLine1(text) { const el = this.rootEl.querySelector('[data-role="line1"]'); if (el) el.textContent = text; }
  _setLine2(text) { const el = this.rootEl.querySelector('[data-role="line2"]'); if (el) el.textContent = text; }

  /** R4 (docs/BASEBALL-3D-BUILD.md section 9): the pop's OWN third line - which swing outcome this
   *  was, distinct from the big word above it (which stays Ball/Strike/Early/Late/Perfect/Foul,
   *  `_showPop`'s own vocabulary, unchanged). Shown only "when there was one" (the spec's own
   *  words): a swing-and-miss always reads `swing_miss` regardless of its timing (the miss is the
   *  headline fact), a foul reads `swing_foul`, and a swing that connected reads `swing_late`/
   *  `swing_early` ONLY when its timing missed the perfect window - a perfectly-timed swing (or a
   *  called ball/strike, which is not a swing at all) gets no second line, same as the reference
   *  game's own third line only ever appearing on a miss. */
  _swingLine(verdict, timingWord) {
    if (verdict === 'miss') return t('swing_miss');
    if (verdict === 'foul') return t('swing_foul');
    if (timingWord === 'late') return t('swing_late');
    if (timingWord === 'early') return t('swing_early');
    return '';
  }

  /** The pop's own pitch line: "pitch name + mph", painted the instant the ball crosses the plate -
   *  `state.pendingPitchType` was recorded at release (the 'pitch' event) since the resolving
   *  events ('count'/'atBatEnd') don't carry the pitch's own type. R4: moved out of Line 2 (which
   *  is now empty on every pitch) and into the pop itself; the function is unchanged, only its
   *  caller. */
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
    // R4: Line 2 goes empty here too - its old job (the pitch readout) now lives under the pop's
    // own word (`opts.pitchLine` below), same as 'count'. Line 1 keeps its at-bat outcome word,
    // unchanged (the spec's own words: "the result word Strikeout/Walk/Single etc. still shows on
    // Line 1 for at-bat ends, as now").
    this._setLine2('');
    // STAGE 8 row 5: same push point as the 'count' handler - this is the OTHER moment the pop's
    // pitch line paints (a pitch that concludes the at-bat gets 'atBatEnd', not 'count'), so the
    // strip tile still lands at crossing either way. `_flushPendingPitch` no-ops if 'count' already
    // flushed it for this exact pitch (the strikeout/walk double-fire case, its own header).
    this._flushPendingPitch();
    // STAGE 8 row 3: only a ball IN PLAY pops from here. game.js emits 'count' BEFORE 'atBatEnd'
    // on the exact same pitch for a strikeout or a walk (that handler's own header), and 'count'
    // already popped that pitch's word (the timing word, or Strike/Ball for a take) - popping it
    // again here restarted the same word's animation a few ms later, a visible flicker. A ball in
    // play never gets a 'count' event, so its timing word is popped here and nowhere else. There is
    // no `verdict` on a ball-in-play payload (game.js never sets one for that branch), so
    // `_swingLine` only ever reads its timingWord here - exactly right, since a miss/foul can never
    // put a ball in play.
    if (inPlay && payload.timingWord) {
      this._showPop(t('v_' + payload.timingWord), payload.timingWord,
        { pitchLine: this._pitchReadout(), swingLine: this._swingLine(undefined, payload.timingWord) });
    }
    const outsPerInning = SETTINGS.MECHANICS.outsPerInning;
    if (inPlay) {
      // RA: 'sacrifice' is an out that does not END in "out" - the landing marker would otherwise
      // draw a bunt the batter was thrown out on in the green of a base hit.
      const isOut = /out$/.test(outKind) || outKind === 'strikeout' || outKind === 'sacrifice';
      const isHr = outKind === 'homer';
      const rad = (payload.sprayAngleDeg * Math.PI) / 180;
      const xFt = Math.sin(rad) * payload.distanceFt;
      const yFt = Math.cos(rad) * payload.distanceFt;
      // R3: every runner this play moves starts running AT CONTACT, in parallel with the whole
      // contact-hold/chase/marker sequence below (never awaited in this chain - see its own
      // header for why it can never lengthen the beat).
      this._animateRunners(payload);
      // THE CONTACT HOLD (row 4): CONTACT_HOLD_MS on the plate view before the cut.
      await this._contactHold(xFt, yFt, payload.battedKind, payload.distanceFt);
      // THE OVERHEAD, RE-PARTITIONED (row 5): flight, then the landing marker's own hold, then
      // `_returnToPlate()` (which clears the cutaway flag and repaints the plate view).
      // STAGE 8 (docs/BASEBALL-3D-BUILD.md section 8, row 4): `battedKind`/`distanceFt` ride along
      // so the overhead flight can tell a grounder from a fly ball and size the lift by how far it
      // actually carried - `game.js`'s own `_onEngineEvent`/`atBatEnd` payload already carries both
      // (`swingResult.kind`, `outcome.distanceFt`). R3 adds `sprayAngleDeg`, for the chasing
      // fielder to find the fence at the SAME angle on a home run.
      await this._animateBattedBall(xFt, yFt, isOut ? 'out' : (isHr ? 'hr' : 'hit'), basesLabel(payload.bases), payload.battedKind, payload.distanceFt, payload.sprayAngleDeg, payload.exitVeloMph, payload.launchAngleDeg);
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
      // R3: a walk's forced runners (the batter included) - a strikeout moves nobody, and
      // `_animateRunners` is a no-op the instant it sees that outcome (nothing to build a mover
      // list from). Same non-blocking rule as the in-play branch above.
      this._animateRunners(payload);
      await sleep(RESULT_MS);
      // R2's between-pitch gap - unless this at-bat ALSO just ended the half-inning, in which case
      // `_onEngineEvent`'s 'halfInningEnd' case supplies the one gap that transition already gets
      // (spec section 5: the half-inning transition's own beat IS betweenMs) - applying both here
      // would double the pause.
      if (this.game && this.game.outs < outsPerInning) await sleep(BETWEEN_MS);
    }
    this._setLine1(''); this._setLine2('');
  }

  /** THE CONTACT HOLD (stage 7, section 7, row 4): CONTACT_HOLD_MS on the PITCH camera before the
   *  cut to the chase. `_settleAtBat` does not call `idle('batter')` for an in-play outcome, so the
   *  Swing clip's own follow-through keeps playing through this whole hold, and the ball is
   *  animated leaving the bat instead of vanishing on contact.
   *
   *  R1: it flies the FIRST SLICE of the real batted parabola (`_battedBallAt`, the same function
   *  the chase then continues) rather than the old screen-space drift toward the mound anchor - so
   *  the ball a player watches leave the bat is already on the path the chase picks up, and the cut
   *  moves the camera without moving the ball. */
  _contactHold(xFt, yFt, battedKind, distanceFt) {
    // STAGE 8 row 3: a ball in play still crosses first (it is, after all, a pitch) - the CROSSING
    // HOLD's own hide timer may already be counting down toward `_actorBallHide()` when contact
    // takes the ball over. Cancel it here, before anything else, so that hide can never fire out
    // from under this hold's own animation.
    if (this._crossingHideTimer) { clearTimeout(this._crossingHideTimer); this._crossingHideTimer = null; }
    return new Promise((resolve) => {
      if (this.destroyed || !this.actors) { resolve(); return; }
      const z = zoneRectFt();
      const start = this.actors.lastBallPos() || { x: 0, y: z.cy, z: ZONE.z };
      const land = engineToWorld(xFt, yFt, 0);
      const apexFt = this._battedApexFt(battedKind, distanceFt);
      // Only the CONTACT POINT is handed forward. The landing point and the apex are recomputed
      // by `_animateBattedBall` from its own arguments every time, so a stale pair from the last
      // ball in play can never leak into the next one (the cutaway probe calls that function
      // directly, with no hold in front of it, which is exactly where that would show up).
      this._battedFrom = start;
      // How much of the flight is spent on the pitch camera before the cut. The chase then covers
      // the rest, so the two together are one continuous arc, not two.
      const preFrac = CONTACT_HOLD_MS / (CONTACT_HOLD_MS + FLIGHT_MS);
      // R4: the contact burst - 12 lines radiating from the CONTACT POINT, projected ONCE here
      // (the point itself does not move; only the ball leaving it does) and drawn every frame for
      // CONTACT_BURST_MS (< CONTACT_HOLD_MS, so it always finishes inside this hold). Skipped
      // entirely under reduced motion.
      if (!this._reducedMotion() && this._fieldW && this.actors.camera) {
        this._contactBurstStart = performance.now();
        this._contactBurstPx = projectToCanvas(this.actors.camera, start, this._fieldW, this._fieldH);
      } else {
        this._contactBurstStart = null;
      }
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / CONTACT_HOLD_MS);
        this.actors.setBall(this._battedBallAt(start, land, apexFt, frac * preFrac));
        this._drawStaticField();
        if (this._contactBurstStart != null) this._drawContactBurst(now - this._contactBurstStart);
        if (frac < 1) this._contactRaf = requestAnimationFrame(step);
        else resolve();
      };
      this._contactRaf = requestAnimationFrame(step);
    });
  }

  /** R4: the contact burst itself - 12 lines flying out from `_contactBurstPx` (set once, at
   *  contact), 18 to 40px over CONTACT_BURST_MS, white fading to the hub's gold accent, then gone.
   *  Drawn on TOP of `_drawStaticField()`'s own zone-box redraw (never cleared by it - this call
   *  always comes after, in `_contactHold`'s step), `globalCompositeOperation: 'lighter'` so
   *  overlapping lines brighten rather than muddy. */
  _drawContactBurst(elapsedMs) {
    if (!this.ctx || !this._contactBurstPx || this._contactBurstPx.behind || elapsedMs > CONTACT_BURST_MS) return;
    const frac = Math.max(0, Math.min(1, elapsedMs / CONTACT_BURST_MS));
    const r0 = CONTACT_BURST_R0 + (CONTACT_BURST_R1 - CONTACT_BURST_R0) * frac;
    const alpha = 1 - frac;
    const { x, y } = this._contactBurstPx;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    for (let i = 0; i < CONTACT_BURST_LINES; i++) {
      const ang = (i / CONTACT_BURST_LINES) * Math.PI * 2;
      const inner = r0 * 0.4;
      const col = lerpColor([255, 255, 255], [255, 206, 58], frac);
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
      ctx.lineTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The ball is IN PLAY - R1 cuts to the CHASE CAMERA, which follows the ball over the field, in
   *  place of the painted overhead picture and its 2 px dot. Section 9: "a painting cannot follow a
   *  ball." The ball flies the rest of the parabola `_contactHold` already started - from
   *  `_battedFrom`, the contact point that hold recorded, to a landing point and an apex this
   *  recomputes from its OWN arguments every time - the chase camera eases along behind and above
   *  it, and the landing marker is a real disc on the ground where it comes down.
   *
   *  STAGE 7 (section 7, row 5): the partitioning is unchanged - FLIGHT_MS of flight, then
   *  MARKER_HOLD_MS holding the marker, then `_returnToPlate()`. See `_settleAtBat`'s own
   *  book-keeping comment for how that sums against RESULT_MS/BETWEEN_MS.
   *  STAGE 7 row 6: `_cutawayUp` is set here and cleared only by `_returnToPlate()`, so no input
   *  path can switch the camera back over a ball still in the air.
   *
   *  R3: THE CUT is also when the diamond widget appears (`_setDiamondVisible(true)`, hidden again
   *  only by `_returnToPlate()`) and when the nearest fielder starts his own run
   *  (`_animateFielderChase`) - the spec's own words, "starting at the cut". `sprayAngleDeg` rides
   *  along only for that: finding the fence at the SAME angle on a ball that clears it.
   *
   *  R4: on a homer (`kind === 'hr'`), the HOME RUN word triggers HERE, mid-chase, the moment the
   *  ball's own ground distance from home crosses `fenceFtAt(spray)` (the spec's own rule: "the
   *  flight's frac where the ball's plan distance crosses the fence"). Ground distance is linear in
   *  the flight's total completion fraction (`_battedBallAt`'s x/z are a straight lerp from contact
   *  to the landing point, which sits exactly `distanceFt` from home along `spray` - only the
   *  height arcs), so `homerCrossFrac = fenceFt / distanceFt` needs no per-frame trig, just a
   *  threshold on the same `totalFrac` the ball's own position already uses. */
  _animateBattedBall(xFt, yFt, kind, label, battedKind, distanceFt, sprayAngleDeg, exitVeloMph, launchAngleDeg) {
    this._cutawayUp = true;
    this._setDiamondVisible(true);
    const isHr = kind === 'hr';
    const homerCrossFrac = (isHr && distanceFt > 0)
      ? Math.max(0, Math.min(1, fenceFtAt(sprayAngleDeg, this._fenceFt()) / distanceFt)) : null;
    let homerShown = false;
    return new Promise((resolve) => {
      const from = this._battedFrom || { x: 0, y: zoneRectFt().cy, z: ZONE.z };
      const to = engineToWorld(xFt, yFt, 0);
      const apexFt = this._battedApexFt(battedKind, distanceFt);
      const preFrac = CONTACT_HOLD_MS / (CONTACT_HOLD_MS + FLIGHT_MS);
      const dur = FLIGHT_MS;
      const t0 = performance.now();
      const first = this._battedBallAt(from, to, apexFt, preFrac);
      this.actors.setCamera('chase');
      this.actors.chaseAt(first, true);   // snap, so the chase does not fly in from the last ball
      this._animateFielderChase(xFt, yFt, distanceFt, sprayAngleDeg);
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        const totalFrac = preFrac + (1 - preFrac) * frac;
        const p = this._battedBallAt(from, to, apexFt, totalFrac);
        this.actors.setBall(p);
        this.actors.chaseAt(p);
        this._drawOverlayChase(null);
        if (!homerShown && homerCrossFrac != null && totalFrac >= homerCrossFrac) {
          homerShown = true;
          this._triggerHomerun({ distanceFt, exitVeloMph, launchAngleDeg });
        }
        if (frac < 1) {
          this._rafBall = requestAnimationFrame(step);
        } else {
          this._runMarkerHold(xFt, yFt, kind, label, resolve);
        }
      };
      this._rafBall = requestAnimationFrame(step);
    });
  }

  /** THE MARKER HOLD (row 5). R1: the marker is a disc in the WORLD at the landing point (actors.js
   *  `setMarker`, the stage 8 colours and the two-pulse ring kept), and its LABEL - 1B/2B/3B, HR,
   *  or an X for an out - is drawn on the 2-D overlay at the projected position of that same point,
   *  because text on a world quad would be a texture to build and throw away every ball in play.
   *  Reduced motion withholds `pulseT`, so the ring never moves, same total hold. */
  _runMarkerHold(xFt, yFt, kind, label, resolve) {
    const dur = MARKER_HOLD_MS;
    const t0 = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const land = engineToWorld(xFt, yFt, 0);
    this.actors.setBall(null);
    this.actors.setMarker({ x: land.x, z: land.z, kind });
    this.actors.chaseAt({ x: land.x, y: 2, z: land.z });
    const step = (now) => {
      if (this.destroyed) return resolve();
      const elapsed = now - t0;
      this.actors.markerPulse(reduced ? null : Math.min(1, elapsed / dur));
      this._drawOverlayChase({ land, kind, label });
      if (elapsed < dur) {
        this._markerRaf = requestAnimationFrame(step);
      } else {
        this._returnToPlate();
        resolve();
      }
    };
    this._markerRaf = requestAnimationFrame(step);
  }

  // -------------------------------------------------------------------------------- R3: runners
  /** A jersey number for the widget's own filled cell - scanned off both rosters (bases only ever
   *  hold the BATTING team's own players, but scanning both is one cheap `find` and never wrong). */
  _jerseyFor(id) {
    if (!this.game || id == null) return '';
    for (const side of ['home', 'away']) {
      const team = this.game[side];
      const p = team && team.players.find((x) => x.id === id);
      if (p) return p.jersey;
    }
    return '';
  }

  /** docs/BASEBALL-3D-BUILD.md section 9, "R3": opacity only, never layout - `.bb-diamond.is-visible`
   *  is the one class this toggles. Shown from the cut (`_animateBattedBall`) until
   *  `_returnToPlate()`; never shown for a walk or a strikeout (there is no cut for either). */
  _setDiamondVisible(show) {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="diamond"]');
    if (el) el.classList.toggle('is-visible', !!show);
  }

  /** Paints the widget's four cells (filled + jersey number, from `this.game.bases` - the engine's
   *  own current state, MINUS whichever base index a mover is still travelling TO, so a runner in
   *  transit is shown only as the moving dot, never as also already standing on the base he left or
   *  the one he hasn't reached yet) and up to `DIAMOND_DOT_COUNT` moving dots, one per in-transit
   *  mover. Called every frame from `_animateRunners`'s own loop; harmless while hidden (opacity 0,
   *  the DOM still updates underneath). */
  _paintDiamondWidget(movers) {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="diamond"]');
    if (!el || !this.game) return;
    const bases = this.game.bases;
    const inTransitTo = new Set(movers.filter((m) => m.frac < 1 && m.to >= 0 && m.to <= 2).map((m) => m.to));
    const CELL = ['1b', '2b', '3b'];
    for (let i = 0; i < 3; i++) {
      const cellEl = el.querySelector(`[data-cell="${CELL[i]}"]`);
      if (!cellEl) continue;
      const on = bases[i] != null && !inTransitTo.has(i);
      cellEl.classList.toggle('is-on', on);
      const numEl = cellEl.querySelector('[data-role="num"]');
      if (numEl) numEl.textContent = on ? String(this._jerseyFor(bases[i])) : '';
    }
    const inTransit = movers.filter((m) => m.frac < 1);
    for (let i = 0; i < DIAMOND_DOT_COUNT; i++) {
      const dotEl = el.querySelector(`[data-dot="${i}"]`);
      if (!dotEl) continue;
      const m = inTransit[i];
      if (!m) { dotEl.style.opacity = '0'; continue; }
      const p = lerpDiamondPct(m.from, m.to, m.frac);
      dotEl.style.left = p.x + '%';
      dotEl.style.top = p.y + '%';
      dotEl.style.opacity = '1';
    }
  }

  /** A world point at `frac` of the way along a polyline `wp` (world x/z), by DISTANCE - the same
   *  shape as `lerpDiamondPct` above, one dimension higher. Shared by every runner AND the chasing
   *  fielder's own straight-line path (a 2-point `wp` there). */
  _pointOnPath(wp, frac) {
    if (wp.length < 2) return wp[0];
    const lens = []; let total = 0;
    for (let i = 1; i < wp.length; i++) { const d = Math.hypot(wp[i].x - wp[i - 1].x, wp[i].z - wp[i - 1].z); lens.push(d); total += d; }
    let target = Math.max(0, Math.min(1, frac)) * total;
    for (let i = 0; i < lens.length; i++) {
      if (target <= lens[i] || i === lens.length - 1) {
        const tt = lens[i] > 0 ? target / lens[i] : 1;
        const a = wp[i], b = wp[i + 1];
        return { x: a.x + (b.x - a.x) * tt, z: a.z + (b.z - a.z) * tt };
      }
      target -= lens[i];
    }
    return wp[wp.length - 1];
  }

  /** EVERY RUNNER THIS PLAY MOVES, driven ONLY by `payload.basesBefore` -> `this.game.bases` (the
   *  engine's own before/after, R3, docs/BASEBALL-3D-BUILD.md section 9) plus `payload.runnersOut` -
   *  this never decides an advancement itself, it reads one. Runs CONCURRENTLY with whatever beat
   *  called it (never awaited in that beat's own sequential chain, see `RUN_WINDOW_MS`'s own
   *  header) - a mover's natural 27 ft/s duration is used as-is unless the SLOWEST of this play's
   *  movers would not otherwise finish inside `RUN_WINDOW_MS`, in which case every mover this play
   *  has is sped up by the SAME factor (the spec's own "speed up ALL movers uniformly").
   *
   *  Deriving each mover from the before/after diff, rather than from `outcome` alone, is what lets
   *  ONE small function cover a single, a double play, a sac fly and a bases-loaded walk: an
   *  existing runner who is gone from `after` and not in `runnersOut` simply scored (nobody had to
   *  say so); an existing runner in `runnersOut` was forced out exactly one base ahead of where he
   *  stood (the only shape this engine's double play has); the batter-runner on ANY out (including
   *  a productive one, e.g. a sac fly or the front end of a double play) jogs to first and vanishes
   *  there, per the spec, whatever actually happened to him.
   *
   *  A role (r1/r2/r3) is a BASE SLOT, not a person - `_syncBaseRunners` already owns that
   *  convention (whichever actor is currently shown standing on first is always 'r1'). A runner who
   *  advances is animated by the SLOT ACTOR HE STARTED IN (there is no fourth actor to hand him off
   *  to mid-run), so the instant every mover here is done, every one of them - reached a new base,
   *  scored, or was put out, it makes no difference - is simply HIDDEN, and `_syncBaseRunners()` is
   *  called once more to re-derive who is standing where, fresh, off `this.game.bases`, under the
   *  slot roles that actually own those bases now. That one extra call is what stops, say, first's
   *  own 'r1' actor being left standing at third after a triple while a freshly-placed 'r3' actor
   *  also appears there. */
  _animateRunners(payload) {
    if (!this.actors || this.destroyed || !this.game) return;
    if (this._runnersRaf) cancelAnimationFrame(this._runnersRaf);
    const before = payload.basesBefore || [null, null, null];
    const after = this.game.bases;
    const outSet = new Set(payload.runnersOut || []);
    const path = runnerPath();
    const side = payload.side;
    const RUNNER_ROLE = ['r1', 'r2', 'r3'];
    const raw = [];
    for (let i = 0; i < 3; i++) {
      const id = before[i];
      if (id == null) continue;
      const afterAt = after.indexOf(id);
      const toIdx = outSet.has(id) ? i + 1 : (afterAt >= 0 ? afterAt : 3);
      if (toIdx === i) continue; // this engine never leaves a runner exactly where he was and still calls it a move
      raw.push({ role: RUNNER_ROLE[i], from: i, to: toIdx, speedFt: RUNNER_SPEED_FT_S });
    }
    if (payload.outcome !== 'strikeout') {
      // RA: same exception `_settleAtBat` makes - on a sacrifice the batter-runner jogs to first
      // and vanishes there like any other out, while the runners he moved up keep running.
      const wasOut = /out$/.test(payload.outcome || '') || payload.outcome === 'sacrifice';
      const toIdx = payload.outcome === 'walk' ? 0 : (wasOut ? 0 : (payload.bases || 1) - 1);
      const speedFt = payload.outcome === 'walk' ? WALK_RUNNER_SPEED_FT_S : RUNNER_SPEED_FT_S;
      raw.push({ role: 'rb', from: -1, to: toIdx, speedFt });
    }
    if (!raw.length) { this._runnersInMotion = null; return undefined; }
    const movers = raw.map((m) => {
      const wp = path.slice(m.from + 1, m.to + 2);
      let lenFt = 0;
      for (let i = 1; i < wp.length; i++) lenFt += Math.hypot(wp[i].x - wp[i - 1].x, wp[i].z - wp[i - 1].z);
      const facingRad = Math.atan2(wp[1].x - wp[0].x, wp[1].z - wp[0].z);
      return { ...m, wp, naturalS: lenFt / m.speedFt, facingRad, frac: 0, started: false, done: false };
    });
    const longestS = Math.max(...movers.map((m) => m.naturalS));
    const availS = RUN_WINDOW_MS / 1000;
    const scale = longestS > availS ? longestS / availS : 1;
    for (const m of movers) m.durMs = (m.naturalS / scale) * 1000;
    // Orchestrator's RA ship review: this loop and `_animateSteal`'s used to share ONE
    // `this._runnersInMotion` Set and each nulled it on finishing - so when a steal's run and a
    // hit's run overlapped (a caught-stealing beat still animating when the next ball in play
    // cut), the survivor's frame called `.delete` on null. Measured as a page error in the
    // runners-move probe. Each animation owns its own Set now and only clears the field if it is
    // still the one it installed; a previous runners loop is cancelled rather than raced.
    if (this._runnersRaf) cancelAnimationFrame(this._runnersRaf);
    const motion = new Set(movers.map((m) => m.role));
    this._runnersInMotion = motion;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (this.destroyed) { if (this._runnersInMotion === motion) this._runnersInMotion = null; return resolve(); }
        let allDone = true;
        for (const m of movers) {
          if (m.done) continue;
          if (!m.started) { m.started = true; this.actors.play(m.role, 'Run'); }
          m.frac = m.durMs > 0 ? Math.min(1, (now - t0) / m.durMs) : 1;
          if (m.frac < 1) { allDone = false; }
          else { m.done = true; motion.delete(m.role); this.actors.hide(m.role); continue; }
          const p = this._pointOnPath(m.wp, m.frac);
          this.actors.setActor(m.role, { side, pos: p, heightFt: FIGURE_HEIGHT_FT, facingRad: m.facingRad });
        }
        this._paintDiamondWidget(movers);
        if (!allDone) {
          this._runnersRaf = requestAnimationFrame(step);
        } else {
          this._runnersRaf = 0;
          if (this._runnersInMotion === motion) this._runnersInMotion = null;
          this._syncBaseRunners(); // hand every mover off to the slot role that actually owns its base now
          resolve();
        }
      };
      this._runnersRaf = requestAnimationFrame(step);
    });
  }

  /** RA (docs/BASEBALL-3D-BUILD.md section 9): THE PICKOFF, from the tap to the next pitch. The
   *  whole 1.5 s beat lives here and is AWAITED by the event handler, because the engine's next
   *  `decidePitch` fires the instant this returns - so the beat is this method's own duration,
   *  never a number computed somewhere else and hoped to match.
   *
   *  What happens, in order: the `Pickoff` clip plays with its mark (the release) at
   *  PICKOFF_MARK_MS; at the mark the ball leaves the pitcher's REAL hand (`actors.handWorld`, the
   *  same sample the pitch flight takes, so the ball and the arm can never disagree) and flies to
   *  the bag over PICKOFF_BALL_MS; the verdict pops as soon as it arrives; the pitcher returns to
   *  Set and whatever is left of the beat is spent holding the word.
   *
   *  The runner needs no clip of his own - the spec says so ("`Idle` is fine, no new clip"), and
   *  `_syncBaseRunners` puts him back flat on the bag on the next redraw because the LEAD is
   *  cleared here: a pickoff throw is exactly the thing that sends a leaning runner back. If the
   *  engine says he was out, `game.bases[0]` is already null by the time this runs, so the same
   *  redraw hides him with no second decision made here. */
  async _playPickoff(payload) {
    if (this.destroyed || !this.actors) return;
    // "Either way a CPU steal planned for that pitch is cancelled" - for the HUMAN batting side,
    // the plan is `armedSteal`, and the throw over is what cancels it. (A CPU batter's own steal
    // needs no cancelling: it is decided inside `decideSwing`, which a pickoff never reaches.)
    if (this.state.armedSteal) { this.state.armedSteal = false; this._paintActionSlots(); }
    this._runnerStanding = {};
    const t0 = performance.now();
    this.actors.play('pitcher', 'Pickoff', { markAtMs: PICKOFF_MARK_MS });
    this._drawStaticField();
    await sleep(PICKOFF_MARK_MS);
    if (this.destroyed || !this.actors) return;
    // The throw, in world feet, hand to bag.
    const from = this.actors.handWorld('pitcher') || { x: RUBBER.x, y: RUBBER.y + 5, z: RUBBER.z };
    const bag = basePositions().first;
    const to = { x: bag.x, y: 2.5, z: bag.z };
    await new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        if (this.destroyed || !this.actors) { resolve(); return; }
        const frac = Math.min(1, (now - start) / PICKOFF_BALL_MS);
        // A flat throw with a touch of arc, the same shape the pitch's own sag draws: a parabola
        // through both ends lying above its chord.
        const lift = PITCH_SAG_FT * 4 * frac * (1 - frac);
        this.actors.setBall({
          x: from.x + (to.x - from.x) * frac,
          y: from.y + (to.y - from.y) * frac + lift,
          z: from.z + (to.z - from.z) * frac,
        });
        this._drawStaticField();
        if (frac < 1) this._pickoffRaf = requestAnimationFrame(step);
        else { this._pickoffRaf = 0; resolve(); }
      };
      this._pickoffRaf = requestAnimationFrame(step);
    });
    if (this.destroyed || !this.actors) return;
    this._showPop(t(payload.out ? 'v_out' : 'v_safe'), payload.out ? 'out' : 'safe');
    this._setLine1(t(payload.out ? 'v_out' : 'v_safe'));
    this.actors.setBall(null);
    this.actors.toSet();
    this._drawStaticField();
    await sleep(Math.max(0, PICKOFF_BEAT_MS - (performance.now() - t0)));
    if (this.destroyed) return;
    this._setLine1('');
  }

  /** RA: THE STEAL, as a picture. NOT awaited by its caller, on purpose: the engine emits 'steal'
   *  and then goes straight on to emit 'count', whose own handler already holds RESULT_MS +
   *  BETWEEN_MS - so this run happens INSIDE a beat that exists rather than adding one, exactly
   *  the rule `_animateRunners` follows for the same reason (see `RUN_WINDOW_MS`'s header). The
   *  run is STEAL_RUN_MS, comfortably inside RESULT_MS, so the runner is standing on his new bag
   *  before the next wind-up begins.
   *
   *  `this.game.bases` is already the after-state when this fires (the engine mutates it
   *  synchronously before the emit), so `_runnersInMotion` is what stops `_syncBaseRunners` from
   *  snapping the runner straight to where he is headed - the identical guard, for the identical
   *  reason, as a runner advancing on a hit. A runner who was thrown out is hidden at the bag he
   *  was running to, which is where the play ended. */
  _animateSteal(payload) {
    if (!this.actors || this.destroyed || !this.game) return undefined;
    if (this._stealRaf) cancelAnimationFrame(this._stealRaf);
    const ROLE = ['r1', 'r2', 'r3'];
    const role = ROLE[payload.from];
    if (!role) return undefined;
    const side = this.game.half === 'top' ? 'away' : 'home';
    const wp = runnerPath().slice(payload.from + 1, payload.to + 2);
    if (wp.length < 2) return undefined;
    const facingRad = Math.atan2(wp[1].x - wp[0].x, wp[1].z - wp[0].z);
    const motion = new Set([role]); // own Set - see `_animateRunners`'s comment on the shared-null bug
    this._runnersInMotion = motion;
    this._setDiamondVisible(true);
    this.actors.play(role, 'Run');
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (this.destroyed || !this.actors) { if (this._runnersInMotion === motion) this._runnersInMotion = null; resolve(); return; }
        const frac = Math.min(1, (now - t0) / STEAL_RUN_MS);
        const p = this._pointOnPath(wp, frac);
        this.actors.setActor(role, { side, pos: p, heightFt: FIGURE_HEIGHT_FT, facingRad });
        this._paintDiamondWidget([{ from: payload.from, to: payload.to, frac }]);
        if (frac < 1) { this._stealRaf = requestAnimationFrame(step); return; }
        this._stealRaf = 0;
        if (this._runnersInMotion === motion) this._runnersInMotion = null;
        this.actors.hide(role);
        this._runnerStanding = {};
        this._syncBaseRunners();   // the slot role that owns his new bag re-derives him, standing
        this._showPop(t(payload.safe ? 'v_safe' : 'v_out'), payload.safe ? 'safe' : 'out');
        this._paintHud();
        // The widget holds one beat on the finished play, then clears - it is only ever shown for
        // something in motion (R3's own rule: shown from the cut, cleared at `_returnToPlate`).
        this._stealWidgetTimer = setTimeout(() => {
          this._stealWidgetTimer = null;
          if (!this.destroyed) this._setDiamondVisible(false);
        }, RESULT_MS);
        resolve();
      };
      this._stealRaf = requestAnimationFrame(step);
    });
  }

  /** THE CHASE (R3): the fielder nearest the landing point - or, on a ball that clears the fence,
   *  nearest the fence AT THAT SPRAY ANGLE (the spec's own "(or the fence, for a homer)") - jogs
   *  there starting at the cut, arriving no earlier than the ball (`Math.max` against the chase's
   *  own `FLIGHT_MS`), then `Idle`. No fielding AI: the ENGINE already decided the outcome: this is
   *  presentation, run concurrently with the ball's own flight exactly like `_animateRunners`. */
  _animateFielderChase(xFt, yFt, distanceFt, sprayAngleDeg) {
    if (this._fielderRaf) cancelAnimationFrame(this._fielderRaf);
    if (!this.actors || !this.game || sprayAngleDeg == null) { this._chasingFielderRole = null; return; }
    const fenceFt = this._fenceFt();
    const wallFt = fenceFtAt(sprayAngleDeg, fenceFt);
    const overFence = (distanceFt || 0) >= wallFt;
    let targetPlan = { x: xFt, y: yFt };
    if (overFence) {
      const rad = (sprayAngleDeg * Math.PI) / 180;
      targetPlan = { x: Math.sin(rad) * wallFt, y: Math.cos(rad) * wallFt };
    }
    const targetWorld = engineToWorld(targetPlan.x, targetPlan.y, 0);
    const shiftDeg = this._currentShiftDeg || 0;
    let nearestRole = null, nearestDist = Infinity, nearestPos = null;
    for (const role of FIELDER_ROLES) {
      const pos = fielderWorld(role, fenceFt, shiftDeg);
      if (!pos) continue;
      const d = Math.hypot(pos.x - targetWorld.x, pos.z - targetWorld.z);
      if (d < nearestDist) { nearestDist = d; nearestRole = role; nearestPos = pos; }
    }
    if (!nearestRole) { this._chasingFielderRole = null; return; }
    const battingSide = this.game.half === 'top' ? 'away' : 'home';
    const defenseSide = battingSide === 'away' ? 'home' : 'away';
    const naturalS = nearestDist / FIELDER_SPEED_FT_S;
    const arriveMs = Math.max(naturalS, FLIGHT_MS / 1000) * 1000;
    const facingRad = Math.atan2(targetWorld.x - nearestPos.x, targetWorld.z - nearestPos.z);
    this._chasingFielderRole = nearestRole;
    this.actors.play(nearestRole, 'Run');
    const t0 = performance.now();
    const wp = [nearestPos, targetWorld];
    const step = (now) => {
      if (this.destroyed) { this._chasingFielderRole = null; return; }
      const frac = Math.min(1, (now - t0) / arriveMs);
      const p = this._pointOnPath(wp, frac);
      this.actors.setActor(nearestRole, { side: defenseSide, pos: { x: p.x, y: 0, z: p.z }, heightFt: FIGURE_HEIGHT_FT, facingRad });
      if (frac < 1) {
        this._fielderRaf = requestAnimationFrame(step);
      } else {
        this.actors.idle(nearestRole);
        this._chasingFielderRole = null;
        this._fielderRaf = 0;
      }
    };
    this._fielderRaf = requestAnimationFrame(step);
  }

  /** The overlay while the chase camera is live: nothing at all during the flight (the ball is a
   *  real object in the scene now, not a drawn dot), and the landing marker's LABEL once it is
   *  down. Kept separate from `_drawOverlay` because that one draws the strike zone, which means
   *  nothing out in the outfield. */
  _drawOverlayChase(marker) {
    const ctx = this.ctx, w = this._fieldW, h = this._fieldH;
    if (!ctx || !w) return;
    ctx.clearRect(0, 0, w, h);
    // R4: confetti draws on every frame the chase overlay redraws, marker or not - a homer can
    // trigger mid-flight (`marker` still null then) and confetti must keep falling on into the
    // marker hold that follows, right up until `_returnToPlate()` (`_hideHomerun`) cuts it off.
    if (this._homerActive && !this._reducedMotion()) this._drawConfetti(performance.now() - this._homerConfettiStart);
    if (!marker || !this.actors || !this.actors.camera) return;
    const p = projectToCanvas(this.actors.camera, { x: marker.land.x, y: 0.3, z: marker.land.z }, w, h);
    if (p.behind) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    const text = marker.kind === 'out' ? '\u2715' : (marker.kind === 'hr' ? 'HR' : (marker.label || ''));
    if (!text) { ctx.restore(); return; }
    ctx.strokeText(text, p.x, p.y);
    ctx.fillStyle = marker.kind === 'hr' ? '#111' : '#fff';
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
  }

  /** R4 (docs/BASEBALL-3D-BUILD.md section 9): fires once per home run, from
   *  `_animateBattedBall`'s own step the instant the ball's ground distance crosses the fence.
   *  Seeds the confetti particles (so every particle's own random fall is fixed for this one homer,
   *  not re-rolled every frame) and shows the DOM word/strip. */
  _triggerHomerun(stats) {
    this._homerConfettiStart = performance.now();
    this._homerActive = true;
    if (!this._reducedMotion()) this._initConfetti();
    this._showHomerun(stats);
  }

  /** The `HOME RUN` word and its stats strip (`{ft} ft  {mph} mph  {deg}°`) - one DOM element,
   *  opacity/transform only (fixed geometry: it has a reserved spot in the field band, `.bb-homerun`
   *  in baseball.css, and never affects layout). Reduced motion still shows both, just without the
   *  0.6->1.0 scale-in (`.bb-homerun.is-on` under `prefers-reduced-motion: reduce`, baseball.css). */
  _showHomerun(stats) {
    const el = this.rootEl && this.rootEl.querySelector('[data-role="homerun"]');
    if (!el) return;
    const wordEl = el.querySelector('[data-role="hrword"]');
    const stripEl = el.querySelector('[data-role="hrstrip"]');
    if (wordEl) wordEl.textContent = t('homerun');
    if (stripEl) {
      const ft = Math.round(stats.distanceFt || 0);
      const mph = Math.round(stats.exitVeloMph || 0);
      const deg = Math.round(stats.launchAngleDeg || 0);
      stripEl.textContent = `${t('stats_ft', { n: ft })}   ${t('stats_mph', { n: mph })}   ${deg}°`;
    }
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    el.classList.add('is-on');
  }

  /** The homer element's only hide - `_returnToPlate()`'s own call, so it can never outlive the
   *  cutaway (a homer that somehow never got here would leave the word stuck over the plate view). */
  _hideHomerun() {
    this._homerActive = false;
    const el = this.rootEl && this.rootEl.querySelector('[data-role="homerun"]');
    if (el) el.classList.remove('is-on');
  }

  /** CONFETTI_COUNT rectangles, each with a fixed x/delay/colour/spin drawn ONCE per homer so every
   *  frame's fall is deterministic relative to its own start rather than re-randomised. */
  _initConfetti() {
    this._confettiParticles = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      x: Math.random(),
      delay: Math.random() * (CONFETTI_MS * 0.3),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.006,
    }));
  }

  /** 40 falling 6x10px rectangles, from the top of the field band, over CONFETTI_MS - drawn on the
   *  overlay canvas by `_drawOverlayChase`, every frame `_homerActive` is set. A particle past
   *  CONFETTI_MS (relative to its own staggered `delay`) is simply skipped, so the fall thins out
   *  rather than snapping off all at once. */
  _drawConfetti(elapsedMs) {
    const ctx = this.ctx, w = this._fieldW, h = this._fieldH;
    if (!ctx || !w || !this._confettiParticles) return;
    ctx.save();
    for (const p of this._confettiParticles) {
      const t2 = elapsedMs - p.delay;
      if (t2 < 0 || t2 > CONFETTI_MS) continue;
      const frac = t2 / CONFETTI_MS;
      ctx.save();
      ctx.translate(p.x * w, frac * h);
      ctx.rotate(p.rot + p.spin * t2);
      ctx.fillStyle = p.color;
      ctx.fillRect(-3, -5, 6, 10);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The pitch, through the batting camera: the ball leaves the pitcher's hand and
   *  GROWS as it approaches - real engine data (`pitchResult.x`/`timeToPlateS`), not a cosmetic
   *  approximation, since the human batter's own decideSwing has the real resolved pitch in hand.
   *  BB-3b commit 4: the lateral position now follows `_pitchBendFrac` - the engine's own `path`
   *  is a straight line (pitch.js never models an intermediate curve), so a literal read of it
   *  would draw every pitch type identically; the bend shape is presentation only, per the spec
   *  ("curveball bends from release, slider from steerFromFrac") - it always reaches exactly
   *  `pitchResult.x` at t=1, so the engine's own value stays the truth at the plate. Also carries
   *  R1: `_actorBallAt` puts a real sphere on a real line from the pitcher's own hand to the zone
   *  (its own header). The bend is unchanged - it is still presentation only, still exactly the
   *  engine's `x` at t=1 - it just feeds a world x rather than a screen-space lateral offset, and
   *  the ball GROWS because the camera is a camera, not because a pinhole law was written out by
   *  hand. */
  _animatePitchFlight(pitchResult) {
    return new Promise((resolveP) => {
      const dur = pitchResult.timeToPlateS * 1000;
      const t0 = performance.now();
      this._flightActive = true;
      this._resetReleasePoint();
      const resolve = () => {
        // R2: the target marker lives only while the ball does. `_target` is what `_drawBatCursor`
        // draws; clearing it here is what takes the marker off the screen at the crossing.
        this._target = null;
        // STAGE 8 row 3 (THE CROSSING HOLD): leave the ball exactly where it crossed
        // (`setBall` already left it there) instead of hiding it this same frame, so
        // a take's big word (Ball/Strike/Foul) has something to point at. `_contactHold` cancels
        // this if a ball IN PLAY takes the ball over first - see its own header.
        if (this._crossingHideTimer) clearTimeout(this._crossingHideTimer);
        this._crossingHideTimer = setTimeout(() => {
          this._crossingHideTimer = null;
          if (!this.destroyed) this._actorBallHide();
        }, CROSSING_HOLD_MS);
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
        // R2: the ball travels from the pitch's own STRAIGHT point to where it really crosses, in
        // both axes, on the bend shape its type is drawn with - and the batting TARGET MARKER
        // rides the same two numbers, so what the marker promises is exactly where the ball goes.
        const p = pitchPointAt(pitchResult, frac);
        this._target = p;
        this._drawStaticField();
        this._actorBallAt(p.x, p.y + (p.hump || 0), frac);
        // R4: the fire trail, drawn on top of `_drawStaticField()`'s own zone-box redraw this same
        // frame - never before `_actorBallAt`, or the trail would sample a ball position one frame
        // stale.
        this._maybeDrawFireTrail(pitchResult, frac);
        if (frac < 1) {
          this._pitchRaf = requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      this._pitchRaf = requestAnimationFrame(step);
    });
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
    // R2 (docs/BASEBALL-3D-BUILD.md section 9): the meter's and the charged swing's own knobs are
    // gone from settings.js, so a slider for each of them would read `undefined` and write a key
    // nothing consumes. The 2-D cursor's radii and the vertical bands are what took their place.
    const KEYS_ENGINE = ['fastballMs', 'timingWindow', 'foulMult', 'swingDelay', 'perfectMs',
      'flyOffsetFrac', 'popupOffsetFrac', 'offsetSprayDeg', 'aimScatter'];
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

  /** docs/BASEBALL-3D-BUILD.md section 3.7, rebuilt for R1: the dev-only 3D check. It used to be
   *  both figures anchored on a small copy of `plate.webp`; there is no picture any more, so it is
   *  now the REAL scene - a second `Actors` with its own stadium and the same three cameras, in the
   *  panel's own box - plus the clip buttons, the scrubber, a home/away recolour and a camera
   *  picker, so a pose can be seeked to and held, and each camera's composition checked, on the
   *  phone. The model path is `globalThis.__bbDevModelUrl` when a test harness sets it; a
   *  missing/failed load is caught and shown in the panel, never thrown. */
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
    tuneSheet.insertBefore(wrap, tuneSheet.querySelector('.bb-tune-actions'));
    const w = 320, h = 342;

    if (closedOrGoneCheck(this, sheet)) return;
    const [{ Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD, CATCHER_FACING_RAD, UMPIRE_FACING_RAD }, { CLIPS }] =
      await Promise.all([import('./actors.js'), import('./poses.js')]);
    if (closedOrGoneCheck(this, sheet)) return;
    const actors = new Actors(wrap);
    this._devActors = actors;
    if (!actors.initGL()) {
      wrap.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dev3d-err', textContent: 'No WebGL context' }));
      return;
    }
    actors.resize(w, h);
    const modelUrl = globalThis.__bbDevModelUrl || new URL('../models/player.glb', import.meta.url).href;
    try {
      await actors.load(modelUrl);
    } catch (e) {
      console.warn('baseball 3D dev preview: model failed to load', e);
      wrap.appendChild(Object.assign(document.createElement('div'), { className: 'bb-dev3d-err', textContent: 'No model yet (baseball/models/player.glb)' }));
      return;
    }
    if (closedOrGoneCheck(this, sheet)) { actors.dispose(); this._devActors = null; return; }
    actors.buildField(this._fenceFt());
    await actors.setBatter({ side: 'home', pos: { x: -BATTER_BOX.x, y: 0, z: BATTER_BOX.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: BATTER_FACING_RAD });
    await actors.setPitcher({ side: 'away', pos: { x: RUBBER.x, y: RUBBER.y, z: RUBBER.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: PITCHER_FACING_RAD });
    await actors.setCatcher({ side: 'away', pos: { x: CATCHER.x, y: 0, z: CATCHER.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: CATCHER_FACING_RAD });
    await actors.setUmpire({ pos: { x: UMPIRE.x, y: 0, z: UMPIRE.z }, heightFt: FIGURE_HEIGHT_FT, facingRad: UMPIRE_FACING_RAD });
    if (closedOrGoneCheck(this, sheet)) { actors.dispose(); this._devActors = null; return; }
    actors.setCamera('batter');
    actors.idle('pitcher'); actors.idle('catcher'); actors.idle('umpire');
    actors.start();

    // Clip buttons + a scrubber, so a pose can be seeked to and held next to a sprite frame on the
    // phone. Every named CLIPS entry with authored keys gets a button, grouped by the actor that
    // owns it (CLIP_ROLE). The scrubber pauses the mixer action at the chosen time instead of
    // racing the running render loop. A home/away select recolours the players together; R1 adds
    // the camera picker, which is the only way to check the three compositions without playing.
    const CLIP_ROLE = { Idle: 'batter', Swing: 'batter', Miss: 'batter', Set: 'pitcher', Pitch: 'pitcher', Crouch: 'catcher' };
    const clipCtl = document.createElement('div');
    clipCtl.dataset.role = 'dev3d-clipctl';
    clipCtl.className = 'bb-dev3d-clipctl';
    const clipsFor = (role) => Object.keys(CLIPS).filter((n) => CLIPS[n].keys.length && CLIP_ROLE[n] === role);
    clipCtl.innerHTML = `
      <div class="bb-tune-actions" data-role="dev3d-clipbtns">
        ${clipsFor('batter').map((n) => `<button type="button" class="gh-btn" data-clip="${n}">${n}</button>`).join('')}
      </div>
      <div class="bb-tune-actions" data-role="dev3d-clipbtns-pitcher">
        ${[...clipsFor('pitcher'), ...clipsFor('catcher')].map((n) => `<button type="button" class="gh-btn" data-clip="${n}">${n}</button>`).join('')}
      </div>
      <label class="bb-tune-row"><span>Time</span>
        <input type="range" data-role="dev3d-scrub" min="0" max="1" step="0.01" value="0">
        <span class="bb-tune-val" data-role="dev3d-scrub-val">0.00s</span>
      </label>
      <label class="bb-tune-row"><span>Camera</span>
        <select data-role="dev3d-cam"><option value="batter">batter</option><option value="pitcher">pitcher</option><option value="chase">chase</option></select>
      </label>
      <label class="bb-tune-row"><span>Colours</span>
        <select data-role="dev3d-side"><option value="home">home</option><option value="away">away</option></select>
      </label>`;
    tuneSheet.insertBefore(clipCtl, tuneSheet.querySelector('.bb-tune-actions'));
    const scrub = clipCtl.querySelector('[data-role="dev3d-scrub"]');
    const scrubVal = clipCtl.querySelector('[data-role="dev3d-scrub-val"]');
    const sideSel = clipCtl.querySelector('[data-role="dev3d-side"]');
    const camSel = clipCtl.querySelector('[data-role="dev3d-cam"]');
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
    camSel.addEventListener('change', () => {
      actors.setCamera(camSel.value);
      if (camSel.value === 'chase') actors.chaseAt({ x: 0, y: 8, z: -120 }, true);
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
    if (s.destroyed) return { type: 'fastball', aim: { x: 0, y: 0 } };
    s.state.mode = 'pitching';
    // 'Set' (== idle('pitcher')) until the tap - a continuous loop clip, so nothing needs to be
    // replayed per tick. The away batter is static until the 'swing' event.
    s.actors.idle('pitcher'); s.actors.idle('batter');
    s.state.actionLabel = 'act_pitch';
    s._onPickoff = null;   // RA: rebound below, per turn - a stale handler would answer a dead promise
    s._paintStrip();
    s._paintModeLabels();
    s._paintActionSlots();
    s._setLine1(''); s._setLine2('');
    s._paintPadMarker();
    s._drawStaticField(); // cut back to the pitch camera - the last at-bat may have left the
                          // chase camera up (_animateBattedBall)
    s._paintRing('idle');

    // R2 (docs/BASEBALL-3D-BUILD.md section 9): TAP ONCE, THEN AIM. There is no meter, no second
    // tap and no steering after release - the reference game's own shape
    // (docs/BASEBALL-REFERENCE-B9.md, pitching steps 2 and 3). The tap starts the delivery; the
    // pad is live through it; at `PITCH_DRAG_MS` (the delivery's own mark, where the ball leaves
    // the hand) the cursor is SAMPLED and that is the pitch.
    return new Promise((resolve) => {
      let thrown = false;
      s._onMainUp = null;
      // RA (docs/BASEBALL-3D-BUILD.md section 9): THE PICKOFF WELL. It is not an arming action -
      // tapping it IS the decision, so it resolves this turn with `{pickoff: true}` and no pitch is
      // thrown at all. It shares `thrown` with the PITCH tap below, so whichever comes first wins
      // and the other is dead: a tap on PICKOFF while the wind-up is already running cannot throw
      // a second ball from the same hand. The well is only enabled before PITCH in the first place
      // (`_paintActionSlots`), and it is cleared the moment either path fires.
      s._onPickoff = () => {
        if (s.destroyed || thrown) return;
        thrown = true;
        s._onPickoff = null; s._onMainDown = null;
        s.state.actionLabel = null;
        s._paintModeLabels(); s._paintActionSlots();
        resolve({ pickoff: true, type: s.state.selectedPitch, aim: { x: s.cursor.x, y: s.cursor.y } });
      };
      s._onMainDown = () => {
        if (s.destroyed || thrown) return;
        thrown = true;
        s._onMainDown = null;
        // RA: the delivery has started, so the pickoff well goes dead and dark with it.
        s._onPickoff = null;
        s.state.actionLabel = null;
        s._paintActionSlots();
        s.actors.play('pitcher', 'Pitch', { markAtMs: PITCH_DRAG_MS });
        // The sample happens at the MARK, not at the tap: everything the thumb does in between is
        // the aim. Cancelled on destroy (`_pitchDragTimer`, cleared in `destroy()`), so a screen
        // torn down mid-wind-up never throws a pitch into a dead DOM.
        if (s._pitchDragTimer) clearTimeout(s._pitchDragTimer);
        s._pitchDragTimer = setTimeout(() => {
          s._pitchDragTimer = null;
          if (s.destroyed) { resolve({ type: s.state.selectedPitch, aim: { x: 0, y: 0 } }); return; }
          this._throw(view, resolve);
        }, PITCH_DRAG_MS);
      };
    });
  }

  /** The pitch itself, once the wind-up has reached its mark: sample the cursor, run the REAL
   *  `flyPitch` on the REAL pre-rolled draws to learn exactly where this pitch is going, fly it,
   *  and resolve with the aim so `game.js` computes the identical result a moment later.
   *
   *  Running the engine's own function here is what replaces BB-3's hand-copied replica of the
   *  scatter/Nice/hang formula: there is one implementation of "where does this pitch end up", and
   *  the drawn ball and the scored pitch are the same object by construction. The four draws come
   *  from `view.scatterDraw` (game.js's `previewsPitch` seam), so no extra randomness is spent. */
  _throw(view, resolve) {
    const s = this.screen;
    const type = s.state.selectedPitch;
    const aim = { x: s.cursor.x, y: s.cursor.y };
    const pitcher = this._ownPitcher();
    const hand = (pitcher && pitcher.throws) || 'R';
    if (s._testNoScatter) view.scatterDraw = { x: 0.5, y: 0.5, bx: 0.5, by: 0.5 };
    const draws = view.scatterDraw || { x: Math.random(), y: Math.random(), bx: Math.random(), by: Math.random() };
    const cap = SETTINGS.CAPS[this.league] != null ? SETTINGS.CAPS[this.league] : SETTINGS.CAPS.majors;
    const skill01 = Math.max(0, Math.min(1, ((pitcher && pitcher.skills.pitchAcc) || 0) / cap));
    const preview = flyPitch(type, aim, skill01, SETTINGS, () => 0.5, (pitcher && pitcher.skills) || {},
      { scatter: draws, pitcherHand: hand });

    // What this delivery actually asked for and where it is actually going - the pitch-drag
    // probe's own read, and the honest answer to "did the drag reach the engine".
    s._lastThrow = { aim, type, preview };
    const durationMs = preview.timeToPlateS * 1000;
    const t0 = performance.now();
    s._resetReleasePoint();   // R1: sample the hand at THIS release, never the last one
    s._flightActive = true;
    const flightStep = (now) => {
      if (s.destroyed) return finishFlight();
      const frac = Math.min(1, (now - t0) / durationMs);
      const p = pitchPointAt(preview, frac);
      s._drawStaticField();
      s._actorBallAt(p.x, p.y + (p.hump || 0), frac);
      // R4: the human's OWN pitch gets the same fire trail as the CPU's - `preview.isStrike` is
      // known here the same way (`flyPitch` already ran, above).
      s._maybeDrawFireTrail(preview, frac);
      if (frac < 1) s._flightRaf = requestAnimationFrame(flightStep);
      else finishFlight();
    };
    const finishFlight = () => {
      s._flightActive = false;
      // STAGE 8 row 3 (THE CROSSING HOLD): hold the ball at its crossing point rather than hiding
      // it this same frame, so a called ball/strike on the human's OWN pitch also shows where it
      // crossed. `_contactHold` cancels this if the pitch turns out to be put in play.
      if (s._crossingHideTimer) clearTimeout(s._crossingHideTimer);
      s._crossingHideTimer = setTimeout(() => {
        s._crossingHideTimer = null;
        if (!s.destroyed) s._actorBallHide();
      }, CROSSING_HOLD_MS);
      // THE PITCHER RETURNS TO SET (stage 7, section 7, row 3), and the CPU batter drops back to
      // Idle at the same moment rather than staying wherever its last 'swing' event left it.
      if (!s.destroyed) {
        if (s._pitcherReturnTimer) clearTimeout(s._pitcherReturnTimer);
        s._pitcherReturnTimer = setTimeout(() => {
          if (s.destroyed || !s.actors) return;
          s.actors.toSet();
          s.actors.idle('batter');
        }, PITCHER_RETURN_MS);
      }
      resolve({ type, aim });
    };
    s._flightRaf = requestAnimationFrame(flightStep);
  }

  async decideSwing(view) {
    const s = this.screen;
    if (s.destroyed) return { action: 'take' };
    s.state.mode = 'batting';
    s.actors.idle('batter');
    s.state.actionLabel = 'act_ready';
    s._onPickoff = null;   // RA: this is the batting turn; nothing here answers the pickoff well
    s._paintModeLabels();
    s._paintActionSlots();
    s._paintPadMarker();
    s._drawStaticField();
    const pitch = view.pitch;
    // STAGE 8 row 5: staged here, pushed at plate CROSSING (`_flushPendingPitch`).
    s.state.pendingPitch = { type: pitch.type, isStrike: pitch.isStrike, mph: Math.round(pitchMph(pitch, this.league)) };

    // R2: READY, then the pitch. Nothing moves until the player asks for it - the reference
    // game's own batting flow (docs/BASEBALL-REFERENCE-B9.md, batting steps 1 and 2), and the
    // reason the batting half no longer starts a wind-up under a player who is still choosing a
    // mode. The pad is live from READY onward; the button becomes SWING.
    await new Promise((ready) => {
      if (s.destroyed) { ready(); return; }
      s._onMainUp = null;
      // `_pendingReady` is what `destroy()` calls: a screen torn down while this turn is waiting
      // for READY would otherwise leave this promise pending for ever (nothing else can settle it -
      // there is no timer here by design, since a player may take as long as they like), and the
      // engine's own `playAtBat` would sit awaiting a decision that can never arrive.
      s._pendingReady = () => { s._pendingReady = null; s._onMainDown = null; ready(); };
      s._onMainDown = () => { s._pendingReady = null; s._onMainDown = null; ready(); };
    });
    if (s.destroyed) return { action: 'take', steal: !!s.state.armedSteal };
    s.state.actionLabel = 'act_swing';
    s._paintModeLabels();
    // RA (docs/BASEBALL-3D-BUILD.md section 9): READY has been tapped, so STEAL and BUNT are no
    // longer offered - both are decisions made BETWEEN pitches, and the pitch is now coming.
    s._paintActionSlots();
    // RA: "the batter squares on `Bunt` clip at the wind-up". A loop, held from here through the
    // pitch and through contact - a bunt has no separate swing, the bat is already where it is
    // going to meet the ball, which is exactly what `swing.js`'s timing-only bunt branch scores.
    if (s.state.armedBunt) s.actors.play('batter', 'Bunt');

    // The CPU's own wind-up (FEEL.ui.windupMs), THEN the ball leaves the hand.
    await s._stepWindup();
    if (s.destroyed) return { action: 'take', steal: !!s.state.armedSteal };

    const flightPromise = s._animatePitchFlight(pitch);

    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;
      const F = SETTINGS.FEEL.engine;
      const releaseMs0 = performance.now();
      // ONE TAP (R2): the charged swing is gone, so the swing happens on the way DOWN and the
      // timing is that instant - never a release time, which is what the hold-to-charge made it.
      const settle = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        s._onMainDown = null; s._onMainUp = null;
        const releaseMs = performance.now() - releaseMs0;
        const timing = timingFromRelease(releaseMs, pitch.timeToPlateS, F);
        // RA: the two one-pitch arms are read into the decision BEFORE they are cleared, so what
        // the engine is told and what the player armed are the same thing.
        const bunt = !!s.state.armedBunt;
        const steal = !!s.state.armedSteal;
        // STAGE 7 row 4: fade:0 - no cross-fade in, so the swing is visible on the very frame it
        // starts (`markAtMs: 80` lands the contact keyframe where the old sprite frame 5 did).
        // RA: a BUNT plays no swing at all - the batter is already squared and stays squared.
        if (!bunt) s.actors.play('batter', 'Swing', { markAtMs: 80, fade: 0 });
        s._clearArmed();
        resolve({ action: 'swing', cursor: { x: s.cursor.x, y: s.cursor.y }, timingErrorMs: timing, mode: s.state.battingMode, bunt, steal });
      };
      s._onMainDown = settle;
      s._onMainUp = null;

      const timeoutMs = pitch.timeToPlateS * 1000 + 250;
      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        s._onMainDown = null; s._onMainUp = null;
        // A take: the batter never left Idle (no half-cock pose exists - inventing one is a
        // feature not discussed, docs/BASEBALL-3D-BUILD.md section 3.6).
        // RA: a take still carries the steal - the runner left with the pitch, not with the swing.
        // The bunt is dropped with the rest of the arm: "a take in bunt mode is an ordinary take."
        const steal = !!s.state.armedSteal;
        s._clearArmed();
        resolve({ action: 'take', steal });
      }, timeoutMs);
      // The flight promise is what the crossing hold and the pitcher's return hang off; nothing
      // here waits on it (the swing resolves on its own tap or its own timeout), but a rejection
      // must not become an unhandled one.
      if (flightPromise && flightPromise.catch) flightPromise.catch(() => {});
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

/** R4: a flat [r,g,b] lerp, shared by the fire trail (orange->white) and the contact burst
 *  (white->gold) - the two R4 effects that fade a colour over a fraction 0..1. */
function lerpColor(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

/** Presentation-only break SHAPE: what fraction of the pitch's own total break has happened at
 *  flight-fraction `t`. Always 1 at t=1, so the drawn ball always ends exactly on the engine's own
 *  truth - only the PATH there differs by type: a curveball bends from the moment it leaves the
 *  hand, a slider late, a fastball not at all (it has no break to shape). `pitch.js` models the
 *  break as a single offset at the plate, so this is the whole of the curve a player sees. */
function pitchBendFrac(type, t) {
  if (type === 'curveball') return 1 - Math.pow(1 - t, 2.2); // bends early, eases into its final spot
  if (type === 'slider' || type === 'cutter') {
    // Late break: nothing for the first half, then all of it (the slider's own character, and the
    // cutter's more so). `SLIDER_BEND_FROM` replaces the steer table's own deleted steerFromFrac.
    if (t <= SLIDER_BEND_FROM) return 0;
    const local = (t - SLIDER_BEND_FROM) / (1 - SLIDER_BEND_FROM);
    return local * local;
  }
  return t;
}
const SLIDER_BEND_FROM = 0.5;

/** WHERE THE BALL IS, in zone units, at `frac` of its flight (R2) - the ONE function the pitch
 *  animation and the batting target marker both read, so the marker can never promise a spot the
 *  ball does not reach. It runs from the pitch's own straight point to its real crossing point on
 *  `pitchBendFrac`'s shape, in both axes. `hump` is the eephus's lob, PRESENTATION only and added
 *  to the drawn ball's height but never to the marker or to anything the engine scores. */
function pitchPointAt(pitchResult, frac) {
  const sx = pitchResult.straightX != null ? pitchResult.straightX : pitchResult.x;
  const sy = pitchResult.straightY != null ? pitchResult.straightY : (pitchResult.y || 0);
  const b = pitchBendFrac(pitchResult.type, frac);
  const p = {
    x: sx + (pitchResult.x - sx) * b,
    y: sy + ((pitchResult.y || 0) - sy) * b,
  };
  if (pitchResult.type === 'eephus') p.hump = EEPHUS_HUMP_UNITS * 4 * frac * (1 - frac);
  return p;
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

// ---------------------------------------------------------------------------------------------
// R3 (docs/BASEBALL-3D-BUILD.md section 9): THE DIAMOND WIDGET. Four cells, the same left/right
// assignment `basesSvg` above already drew (first on the left, third on the right, seen from
// behind the plate) so the two never disagree about which corner is which. Percent positions
// within the widget's own 84x84 box; `-1`/`3` (home, both ends) share one entry, same as
// `field.js`'s `runnerPath()` shares its own `home` at both ends of the array this indexes into.
const DIAMOND_PCT = [
  { x: 50, y: 88 }, { x: 12, y: 50 }, { x: 50, y: 12 }, { x: 88, y: 50 }, { x: 50, y: 88 },
];
/** A point along the widget's own diamond edges between base index `from` and `to` (the same -1..3
 *  domain `runnerPath()` uses), `frac` of the way there by DISTANCE (not by corner count), so a
 *  two-base move (a runner on first taking a double to third) moves the dot at a constant rate
 *  through second rather than snapping through it. */
function lerpDiamondPct(from, to, frac) {
  const wp = DIAMOND_PCT.slice(from + 1, to + 2);
  if (wp.length < 2) return wp[0] || DIAMOND_PCT[0];
  const lens = []; let total = 0;
  for (let i = 1; i < wp.length; i++) { const d = Math.hypot(wp[i].x - wp[i - 1].x, wp[i].y - wp[i - 1].y); lens.push(d); total += d; }
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const tt = lens[i] > 0 ? target / lens[i] : 1;
      const a = wp[i], b = wp[i + 1];
      return { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt };
    }
    target -= lens[i];
  }
  return wp[wp.length - 1];
}
const DIAMOND_DOT_COUNT = 4; // batter + up to three existing runners, the most one play ever moves
function diamondWidgetHTML() {
  // The rotated diamond LOOK is its own inner `.bb-diamond-cell-shape` - the cell itself (and so
  // its label/number children) stays UNROTATED, because a `position:absolute` child of a rotated
  // ancestor is carried along that same rotation when painted (it does not just inherit the
  // ancestor's coordinate SYSTEM, the whole painted box swings through the rotation), which is
  // what put "3B" a few px past the viewport's own right edge - found by measuring its real
  // getBoundingClientRect, not by eye.
  const cell = (key, label) => `<div class="bb-diamond-cell" data-cell="${key}"><div class="bb-diamond-cell-shape"></div><span>${label}</span><b data-role="num"></b></div>`;
  let dots = '';
  for (let i = 0; i < DIAMOND_DOT_COUNT; i++) dots += `<div class="bb-diamond-dot" data-dot="${i}"></div>`;
  return `<div class="bb-diamond" data-role="diamond" aria-hidden="true">
    ${cell('home', t('widget_home'))}
    ${cell('1b', t('widget_1b'))}
    ${cell('2b', t('widget_2b'))}
    ${cell('3b', t('widget_3b'))}
    ${dots}
  </div>`;
}

/** SPEC.md section 13's exact outcome vocabulary (Single/Double/Triple/Home run/Out/Walk/
 *  Strikeout) - a hit's WORD comes from `bases` (the authoritative count `game.js`'s own
 *  `resolveContact` already resolves), never re-derived from the finer-grained `kind` string
 *  (`ground-gap`/`blooper`/`line-through`/... - those exist for measurement, not for display). */
function outcomeWord(kind, bases) {
  // RA (docs/BASEBALL-3D-BUILD.md section 9): the three bunt outcomes get their own words. They
  // have to be named BEFORE the generic tests below, both because 'bunt-out' ends in "out" and
  // would otherwise read as a plain Out, and because 'bunt-single' carries bases 1 and would read
  // as a plain Single - true in both cases, and in both cases losing the only thing that made the
  // play worth a button.
  if (kind === 'bunt-out') return 'bunt_out';
  if (kind === 'bunt-single') return 'bunt_single';
  if (kind === 'sacrifice') return 'sacrifice';
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
