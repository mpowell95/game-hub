// golf/js/ui.js - the DOM shell: the setup screens, the HUD, tap capture, the render loop, and the
// module contract. The ONLY file here that touches the DOM.
//
// Everything it paints comes from modules that are pure and headless-testable: holes.js (geometry
// and the lie lookup), clubs.js (the bag and the lie table), swing.js (the three-tap meters and
// the mishit model), shot.js (flight, roll and the putt), render.js (the tilemap and the camera).
// This file owns no rule; it reads them and paints.
//
// STAGE B: one hole, tee to holed putt. Hazards, the drop prompt, the result banner and the
// scorecard are Stage C, and the stats write is Stage D - so a holed putt here reports and stops
// rather than scoring a round. See golf/CLAUDE.md.

import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { clubArtSVG, CLUB_ART_DEFS } from './club-art.js';
import { loadProfile } from '../../js/profile-store.js';
import { COURSES, ROUNDS, MODES, courseById, roundById, roundKey, roundHoles, roundPar, roundsOfMode, roundsFor, roundsForCourse, modesForCourse, roundRange, holeKey, stablefordPoints, maxStrokes } from './rounds.js';
import { validateHole, surfaceAt, distYd, greenBox } from './holes.js';
import { SAVE_V, validateSave, resumePos, isComplete } from './save.js';
import { CLUBS, PUTTER, clubById, autoSelectClub, stepClub, lieOf, mustPutt, canPutt, lockedToPutter, swingTempo, swingZone, clubTier, GREEN_FLOOR } from './clubs.js';
import { Swing, PHASE, bandsFor, mishit, puttMishit, barPosOf, SWING_MAX, BLOCK_FROM, BAR_HALF, ARC_A0_DEG, ARC_DEG_PER_UNIT } from './swing.js';
import { resolveShot, simulatePutt, aimDots, flightPoint, groundPoint, puttRangeFt, windFor, dropNear, FT_PER_YD, PUTT_GAMMA } from './shot.js';
import { buildMap, makeCamera, drawFrame, PALETTE, paletteFor, fillsFor, VIEW_W_YDS, VIEW_W_GREEN_YDS } from './render.js';
import { recordGolf } from '../../js/game-stats.js';
import { loadStats } from '../../js/game-stats.js';
import { STRINGS } from './strings.js';
import TUTORIAL_COURSE from '../courses/tutorial.js';
import { Coach } from './tutorial.js';
import { gfOf, roundState, modeUnlocked, tutorialDone, practisableHoles, ladderProgress,
  courseOpenByDefault } from './progress.js';
import { isCourseReleased, courseTestingOverride, readCachedConfig } from '../../js/admin-config.js';
import { isDevProfile } from '../../js/challenge/hooks.js';

const SETTINGS_KEY = 'gamehub.golf.v1';

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The wind indicator. MEASURED off all four reference clips at full resolution: the panel reads
 *  `wind`, then a CHUNKY white arrow, then the speed as a bare number to one decimal - `0.9`, with
 *  no unit named, identical in every frame of every clip.
 *
 *  The arrow is FAT: a broad head about two-thirds the glyph's width over a short stubby tail, not
 *  the thin stemmed arrow this used to draw. The stepped edges in the original are the diagonal's
 *  own pixel stair-stepping, not a serration to reproduce.
 *
 *  It shows the arrow AT ZERO too - the reference does, and Matt's note was that ours said "Wind
 *  Calm", which is a phrase the original never uses. Calm is greyed and points up; wind rotates it
 *  to its bearing and brightens it. */
/** THE LIE READOUT IS A PICTURE, NOT A WORD.
 *
 *  Matt's list, from putting our screen beside the reference: ours printed the word "Green" in a
 *  panel. MEASURED off the reference at full resolution: it is an ISOMETRIC BLOCK of the surface
 *  itself - a top face in that surface's own colour with a lighter speckle, a brown SOIL band
 *  across the bottom, a hard black outline with rounded corners - and a large dimpled golf ball
 *  sitting on it, OVERHANGING THE TOP EDGE by about a third of itself, with a soft shadow on the
 *  surface beneath it. About 60 x 49 CSS px with a 37 px ball.
 *
 *  The colours are not a second palette. `fillsFor` is the same map the GROUND is painted from, so
 *  the tile cannot show a green that is a different green from the one under the ball, and a theme
 *  change carries it automatically. The speckle and the shadow are tints of that same colour.
 *
 *  The lie's NAME is still there, on the element's aria-label - a picture is the right readout for
 *  a glance and the wrong one for a screen reader. */
function lieArt(kind, pal) {
  const base = fillsFor(pal)[kind] || pal.fairwayA;
  const tint = (f) => {
    const n = parseInt(base.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  };
  const soil = kind === 'water' ? '#1a5c9e' : '#8a5a28';
  const speck = tint(kind === 'water' ? 1.18 : 0.93);
  // A FIXED speckle, not a random one: the tile is rebuilt whenever the lie changes and a pattern
  // that reshuffled would shimmer as the player walked up the hole.
  const dots = [[8, 20], [25, 15], [44, 23], [13, 36], [37, 40], [49, 34], [20, 46], [42, 47]]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="5" fill="${speck}"/>`).join('');
  const dimples = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const dx = 30 + (c - 2) * 6.2;
      const dy = 18.5 + (r - 2) * 6.2;
      if (Math.hypot(dx - 30, dy - 18.5) > 13) continue;
      // A dimple is an INDENT, so it is always darker than the half it sits on - which means the
      // split has to be the same diagonal the shading uses, not a separate guess. Below-left of
      // the line from (17.7,6.2) to (42.3,30.8) is the shaded half.
      const onShade = (dy - 18.5) > (dx - 30);
      dimples.push(`<rect x="${dx - 1.3}" y="${dy - 1.3}" width="2.6" height="2.6" fill="${onShade ? '#9aa2a9' : '#cdd3d8'}"/>`);
    }
  }
  // THE PROPORTIONS ARE THE REFERENCE'S, measured off its own tile: the block is 1070 x 920 device
  // px, the ball is 620 across (0.58 of the width, 0.67 of the height), it overhangs the top edge by
  // 26 % of itself, and the brown soil band is the bottom 16 %. A first pass made the ball too big
  // for the tile and there was almost no surface left to look at, which is the whole point of it.
  return `<svg viewBox="0 0 60 63" width="60" height="63" aria-hidden="true">
    <rect x="2" y="10" width="56" height="51" rx="3" fill="${soil}" stroke="#0b0f07" stroke-width="2.5"/>
    <path d="M4.5 12.5 h51 v39.5 h-51 z" fill="${base}"/>
    ${dots}
    <ellipse cx="30" cy="35" rx="15" ry="4.2" fill="${tint(0.78)}"/>
    <circle cx="30" cy="18.5" r="17.4" fill="#ffffff" stroke="#0b0f07" stroke-width="2.5"/>
    <!-- The ball is lit from the upper right, so the lower-LEFT half is in shade. Split along the
         diagonal rather than vertically: that is where the reference's own shading line runs. -->
    <path d="M17.7 6.2 A17.4 17.4 0 0 0 42.3 30.8 Z" fill="#c7ced4"/>
    ${dimples.join('')}
  </svg>`;
}

/** A hole's picture is exactly as wide as the hole is, which is what leaves NO letterbox: the tile
 *  is not a box the hole is fitted into, it IS the hole's own shape. Straight off `bounds`, which
 *  is what `buildMap` rasterises, so the number here and the picture can never disagree. */
function holeAspect(h) {
  const w = h.bounds.maxX - h.bounds.minX;
  const y = h.bounds.maxY - h.bounds.minY;
  return (w > 0 && y > 0) ? w / y : 0.33;
}

/** THE ROWS ARE NINES, NOT WHATEVER `flex-wrap` HAPPENS TO FIT. Left to wrap on its own the strip
 *  came out 9 / 8 / 1 on Pine Valley - hole 18 stranded on a row of its own, which reads as a
 *  mistake rather than as a layout. A nine is also the right unit for golf: an eighteen-hole course
 *  shows its front nine over its back nine, and a nine-hole course is one row. */
function holeRows(course) {
  const rows = [];
  course.holes.forEach((h, i) => {
    if (i % 9 === 0) rows.push([]);
    rows[rows.length - 1].push({ h, i });
  });
  return rows;
}

function windArrow(deg, calm = true) {
  return `<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(${deg}deg)">
    <path d="M8 1 L14.5 8.5 L10.5 8.5 L10.5 15 L5.5 15 L5.5 8.5 L1.5 8.5 Z" fill="${calm ? '#7d8a6d' : '#f2f7ea'}" stroke="#0d1208" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
}
const t = makeT(STRINGS);

// AIM, PER TAP. Was 1.5 deg, which at 215 yds moves the landing 5.6 yds - too coarse to place a
// drive between two trees, and the only fix available to the player was to stop leaning on the
// button at exactly the right moment. 1.0 deg is 3.8 yds at driver range and about 9 INCHES at
// wedge range, which is the resolution the short game actually needs. Holding still crosses the
// full +/- 60 deg quickly, because the repeat below now accelerates.
// A SINGLE TAP IS FINE; HOLDING GETS COARSE. Matt, 2026-09-09: *"the aim arrows move the aim by a
// lot more than usual. I just hit the 2 iron and the 8 iron and a single click moved the aim spot
// by a lot."* MEASURED: the step is exactly 1.000 deg on every club and has never been anything
// else, and the camera frame is the same 95 yds wide whatever is in hand - so nothing moved. What
// moved is what you can SEE: reclaiming the HUD's dead chrome (2026-09-09) made the canvas taller,
// and since the frame's scale is set by its WIDTH, a taller canvas shows further up the hole. The
// aim ladder's far dot - the one that swings the most - used to be off the top of the screen on an
// iron and now is not. At a 2 iron's 175 yds, 1 deg is 3.1 yds of landing spot.
//
// So the tap gets finer and the HOLD does not: one tap is 0.35 deg (about a yard at that range,
// which is the resolution an approach actually needs), and the repeat ramps its own step up to
// 1.4 deg as it accelerates, so a full sweep of the +/- 60 deg arc still takes about 5 s. Tapping
// is for placing the aim, holding is for crossing the arc, and they no longer have to be the same
// number.
const AIM_STEP_DEG = 0.35;
const AIM_STEP_HOLD_DEG = 1.4;
const AIM_LIMIT_DEG = 60;        // aim is limited to +/- 60 deg from the line to the hole
// PRESS-AND-HOLD, ACCELERATING. It used to be a flat 8 taps a second after a 400 ms delay, which
// is the worst of both: too fast to place the aim by holding, too slow to cross the arc. It now
// starts at 4 a second - slow enough that letting go on the step you want is easy - and ramps to
// 16 a second over a second of holding, so a full sweep of the aim arc still takes about 5 s and
// a walk from the driver to the lob wedge about 1.5 s.
const HOLD_DELAY_MS = 400;       // press-and-hold before auto-repeat
const HOLD_SLOW_MS = 250;        // the first repeats: 4 a second
const HOLD_FAST_MS = 62;         // the fastest it gets: 16 a second
const HOLD_RAMP_MS = 1000;       // how long it takes to get there
const DEG = Math.PI / 180;

/** THE GAP BETWEEN THE THIRD TAP AND THE BALL LEAVING THE CLUB, ms. MEASURED off the reference at
 *  60 fps: tap, ~0.25 s of stillness, a ~0.6 s golfer swing animation, then the ball moves. Clip 3
 *  is the clean sample (no camera move in the way): tap at frame 799, ball away at 850 = 0.85 s. */
// THE GOLFER'S SWING, MEASURED (see _frame for the frame-by-frame trace). Relative to the third
// tap: nothing moves at all for 265 ms, then four sprites over ~85 ms, then the finish pose held
// for the remaining ~500 ms until the ball leaves.
const POSE_STILL_MS = 265;
const POSE_BACK_MS = 40;
const POSE_THRU_MS = 45;
const WINDUP_MS = 850;

/** THE OPENING FLYOVER (2026-09-06). The camera opens ON THE GREEN, sits there long enough to
 *  read it, then travels back down the hole to the tee. Held first and eased at BOTH ends: a
 *  move that starts at full speed is over before a player registers what they were shown, which
 *  is how the old 3D build's flyover managed to be invisible while playing correctly every time.
 *  A tap skips it, same as the flight. */
const INTRO_HOLD_MS = 1000;
const INTRO_MOVE_MS = 2600;
// The meter's logical drawing box, in CSS pixels. The canvas itself is backed at devicePixelRatio
// so the 3px band outline and the 13px tick numbers stay crisp on a phone.
/** THE LESSON'S CARETS, in CSS px. `CARET_GAP` is how far the apex stands off the thing it names
 *  (the band's outer rim, or the accuracy bar's lower edge), `CARET_LEN` how long the arrow is and
 *  `CARET_HALF` half its base. They are named here rather than buried in the draw call because the
 *  tick labels have to be pushed out by exactly `CARET_GAP + CARET_LEN` plus a little air whenever
 *  a caret is on the dial, or the 100 % caret lands on the "100". */
/** How long the LESSON waits after a shot comes to rest before it says anything. The ball reaches
 *  its rest position on the same frame `_settleShot` runs, and the camera eases in for ~245 ms
 *  after that, so a card fired immediately lands on a scene that is still moving. 700 ms is the
 *  beat the holed path already waits before showing its result card - one pause in the game, not
 *  two different ones. It gates only the coach; play is not slowed by it. */
const SETTLE_CARD_MS = 700;
const CARET_GAP = 3;
const CARET_LEN = 11;
const CARET_HALF = 5.5;
/** How close (in radians of the dial) a caret has to be to a tick before that tick's LABEL steps
 *  out of its way. `CARET_HALF` is 5.5 px at the caret's base radius of ~68, which is 0.081 rad
 *  of half-width; 0.16 rad is that plus the label's own half-width, so a caret and a number are
 *  never asked to share the same spot and nothing else on the dial moves. */
const CARET_NEAR = 0.16;
const METER_W = 176;
const METER_H = 150;

function ensureCSS() {
  const href = new URL('../css/golf.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {};
    return { lastCourse: COURSES[0].id, lastRound: 'quick3', ...s };
  } catch { return { lastCourse: COURSES[0].id, lastRound: 'quick3' }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* best effort */ }
}

// =================================================================================================
// THE MID-ROUND SAVE (2026-09-09). THE LAW: a round in progress is real, unrecreatable work, and
// until this landed there was NO snapshot at all - `gamehub.golf.v1` held the last course, round
// and length and nothing else, so closing the app on the fifteenth hole of an eighteen destroyed
// the whole round. The two exits asked first; being killed by iOS, which on a phone is routine,
// did not ask anything.
//
// ONE KEY, NOT TWO. Root CLAUDE.md names this: *"Do not mint `gamehub.golf.save.v1`."* The save is
// a `save` FIELD on the settings object. (That instruction's stated reason - that the key "already
// holds the round" - was wrong when it was written; it held settings. The instruction was right
// anyway, so it stands with a corrected reason: one key per game is this repo's convention and a
// second one is a second thing to migrate, back up and reason about for ever. Rule 9.)
//
// WHAT IS DELIBERATELY NOT IN IT, both departures from the handoff's list, both narrowing:
//   * `recorded` / `newBest`. A save exists ONLY while a round is unrecorded - `_recordRound`
//     clears it on success - so a stored `recorded: true` would be a state this code can never be
//     in. Storing a flag whose only legal value is false is an invitation to restore into a round
//     the player has already been paid for.
//   * `tutorialRun`, and practice holes generally. A practice hole is ONE UNSCORED HOLE: it writes
//     no round best, its hole record is written the moment it is holed, and `_roundAtStake()`
//     already refuses to stop the player for one. There is nothing to lose, so there is nothing to
//     save, and every line not written here is a line that cannot restore a round wrong.
//
// A HALF-WRITTEN SAVE MUST BE UNUSABLE RATHER THAN WRONG (rule 4 of the handoff, and the reason
// `readSave` validates every field rather than trusting the shape). A save that restores a round
// into a subtly wrong state is worse than no save at all, because nobody notices until the score
// is stored - and a stored best only ever improves (THE LAW rule 2), so a wrong one is permanent.
// =================================================================================================

/** The round in progress, or null. `validateSave` (golf/js/save.js) is the gate and is its own
 *  pure module so it can be hammered headlessly - see its header for why a half-written save has
 *  to be UNUSABLE rather than repaired. */
function readSave() {
  try { return validateSave(loadSettings().save, COURSES, ROUNDS); } catch { return null; }
}

/** Write (or clear, with `null`) the save. Verified by fresh re-read - rule 6 - and it returns
 *  whether the bytes are actually on disk, because `_quit` uses that to decide whether leaving
 *  still needs a warning. A save that silently failed to write is the exact case the warning is
 *  for. */
function writeSave(sv) {
  try {
    const s = loadSettings();
    if (sv) s.save = sv; else delete s.save;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    const back = loadSettings().save;
    const ok = sv ? !!(back && back.v === SAVE_V && back.pos === sv.pos
      && back.shotN === sv.shotN && back.roundId === sv.roundId) : !back;
    if (!ok) console.error('[golf] the mid-round save did not land', { wrote: sv, read: back });
    return ok;
  } catch (e) {
    console.error('[golf] writing the mid-round save FAILED', e);
    return false;
  }
}

/** Club-head art, drawn BIG enough to fill its tile.
 *
 *  The reference's club tile is mostly picture: a large club head across most of the tile's width
 *  with the name in big type beneath it. Ours was a 34x22 thumbnail floating in a box more than
 *  twice its size - Matt: "the club image and the club name 'driver' take up less than half of the
 *  space the box takes up. fix it by filling the box." */

class GolfGame {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.course = courseById(this.settings.lastCourse);
    this.destroyed = false;
    this.listeners = [];
    this.raf = 0;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'gf-root';
    this.inHub = !!container.closest('.hub-game');
    // THE TOP PAD AND THE BOTTOM SAFE AREA ARE BOTH MEASURED IN `_fit()`, not assumed here.
    // This used to be a flat `--gf-top-pad: 46px` in the hub, on the grounds that "the hub's
    // floating back button lives in the top-left, so the HUD's own top row moves down out from
    // under it". Measured 2026-09-09 in the real hub at 393x852: the back pill runs 54..89 and the
    // game area starts at 98 - it sits ABOVE the game with 9 px to spare and has never overlapped
    // it. So 46 px of a 714 px game area was reserved for nothing. See `_fitInsets`.
    container.appendChild(this.rootEl);

    this.offViewport = onViewportResize(() => this._fit());
    // A ResizeObserver, not just the viewport hook: the hub mounts this element and THEN applies
    // its own chrome, so the first measurement in this constructor is taken before the game has
    // been pushed down the page and is wrong by exactly the height of that chrome. Nothing
    // resizes the window afterwards, so without a real correction path the game stays 136px too
    // tall with its whole control cluster below the fold - measured, in the hub, at both phone
    // heights, before this was here. The observer is that path (docs/BUILDING-A-GAME.md: "if you
    // paint before the data has arrived, name the path back to the truth").
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this._fit());
      this.ro.observe(container);
      if (container.parentElement) this.ro.observe(container.parentElement);
    }
    // THE APP COMING BACK IS A RE-MEASURE (2026-09-09). A phone that changes the viewport while
    // this page is not on screen - leaving Android split-screen, unfolding a foldable, dismissing
    // the keyboard, an app-switcher animation - does not always deliver a resize this game can act
    // on, and nothing else here re-measures. See `_fit`'s underfill guard for the report.
    this._onVis = () => { if (document.visibilityState === 'visible') this._fit(); };
    document.addEventListener('visibilitychange', this._onVis);
    this._renderSetup();
    this._fit();
    requestAnimationFrame(() => this._fit());
  }

  // ---------------------------------------------------------------- listeners ----
  _on(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.listeners.push([el, type, fn, opts]);
  }
  _offAll() {
    for (const [el, type, fn, opts] of this.listeners) el.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }

  // ---------------------------------------------------------------- fit ----
  /** Size the root to the space it actually has, BY MEASUREMENT, never a bare 100dvh.
   *
   *  The hub wraps an immersive game in ~98px of top chrome for its floating back button plus a
   *  gap below, so a game that asks for the whole viewport is that much too tall the moment it is
   *  mounted - the exact way Pool shipped 138px over with its controls below the fold
   *  (docs/BUILDING-A-GAME.md, Part 3). Measuring the host covers standalone and the hub with one
   *  rule and no host-specific constant.
   *
   *  THE PROBE IS THE POINT. The root is collapsed to 1px first, so what is read back is the
   *  space everything ELSE occupies rather than a number this game's own height is already
   *  polluting - and the gap BELOW is measured the same way rather than by guessing which
   *  ancestor owns the padding (it is not `parentElement`; in the hub it belongs to `.hub-main`).
   *  With the page collapsed it also cannot be scrolled, which is what makes the viewport-relative
   *  `rect.top` trustworthy - it moves when the page is scrolled, and the page is scrolled BECAUSE
   *  of the overflow being removed. */
  _fit() {
    if (this.destroyed || !this.rootEl) return;
    const el = this.rootEl;
    const prev = el.style.height;
    // TWO YARDSTICKS FOR ONE VIEWPORT (2026-09-09). TP: *"it's messed up for me"* - a screenshot
    // with golf drawn into the top 40 % of the screen and the hub's background below it. Measured
    // off that screenshot, and the answer is the same at every plausible device pixel ratio, which
    // is what makes it a finding rather than a guess: golf's bottom edge sat exactly where `_fit`
    // puts it if `window.innerHeight` had reported about HALF the real viewport. 51 % at DPR 2,
    // 51 % at 2.5, 51 % at 3. Half a viewport is what Android split-screen gives you, and a
    // foldable's cover screen is near enough.
    //
    // `innerHeight` and the documentElement's `clientHeight` are two readings of the same layout
    // viewport, taken through different paths, so one can be stale while the other is not. Taking
    // the LARGER is the safe direction: too small is what the report looks like (a game in a strip
    // with dead space under it), and too large is corrected on the very next line, where the page's
    // own overflow is measured and given straight back.
    const vh = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0) || 720;

    // Pass 1: collapse ourselves and read where our top actually sits. With the game at zero the
    // page cannot be scrolled by our own overflow, which is what makes this viewport-relative
    // reading trustworthy.
    el.style.height = '0px';
    const top = el.getBoundingClientRect().top;

    // Pass 2: take everything from there to the bottom of the viewport, then measure how far the
    // PAGE overflows and give exactly that much back. This is the only formulation that does not
    // have to know who owns the gap underneath - in the hub it belongs to `.hub-main`, two levels
    // up, and a standalone page's own `min-height: 100vh` wrapper makes "how tall is the document
    // with the game collapsed" answer the wrong question entirely (it reads as a full viewport of
    // chrome and collapses the game to its floor).
    let h = Math.max(320, Math.round(vh - top));
    el.style.height = `${h}px`;
    const over = Math.round(document.documentElement.scrollHeight - vh);
    if (over > 0) { h = Math.max(320, h - over); el.style.height = `${h}px`; }

    // BEFORE the no-op early return below: the insets depend on where we ended up on the page, not
    // on whether our own height changed, and a rotation can move the chrome without resizing us.
    this._fitInsets();

    // THE UNDERFILL GUARD, the backstop to the two yardsticks above. If BOTH readings are short -
    // a layout that has not settled, an app-switcher animation still running - nothing here can
    // tell, so instead of trying to detect the lie we simply ask again shortly. One burst per
    // episode, spread over a second and a half rather than chained frame to frame (four frames are
    // over in 64 ms, shorter than the animation this is trying to survive), re-armed only once the
    // fill comes good. Measured fill at six viewport sizes is 95-96 %, so 88 % sits comfortably
    // below anything legitimate - the gap is the bottom safe area.
    const fill = (top + h) / Math.max(1, vh);
    if (fill < 0.88) {
      if (!this._underfill) {
        this._underfill = 1;
        const again = () => { if (!this.destroyed) this._fit(); };
        requestAnimationFrame(again);
        setTimeout(again, 250);
        setTimeout(again, 750);
        setTimeout(again, 1500);
      }
    } else {
      this._underfill = 0;
    }

    // Setting our own height resizes us, and the ResizeObserver watches for exactly that - so a
    // no-op must stay a no-op or the two chase each other for ever.
    if (`${h}px` === prev) return;
    if (this.canvas) this._sizeCanvas();
    // The setup screen's hole rows are sized by MEASUREMENT, so a rotation has to re-measure them
    // or every row keeps the height it was given in the old orientation. The canvases are then
    // repainted at their new size - `_stripCache` is keyed by size, so the old thumbnails are kept
    // rather than thrown away, and rotating back is free.
    if (this.stripEl && this.stripEl.isConnected) {
      this._sizeStripRows();
      for (const cv of this.stripEl.querySelectorAll('[data-hole-art]')) delete cv.dataset.painted;
      this._paintHoleStrip(this.stripEl);
    }
  }

  /** HOW MUCH ROOM THE HOST'S OWN CHROME ACTUALLY TAKES, measured every fit.
   *
   *  Matt, with a screenshot of the live game beside an edit of his own: *"I moved the HUD higher
   *  up and lower on the screen, creating more room for the golfer."* He was pointing at two
   *  paddings that were each guarding against something that is not there:
   *
   *  **The top.** `--gf-top-pad` was a flat 46 px whenever the game was mounted in the hub, to
   *  keep the HUD out from under the floating back pill. Measured in the real hub at 393x852: the
   *  pill runs 54..89 and the game area starts at 98. It is ABOVE the game with 9 px clear, and a
   *  scan of every positioned element outside the game found NOTHING overlapping it at either
   *  phone height. The pad is measured now, so it is 0 when the pill is clear and exactly enough
   *  when it is not - and it cannot go stale the next time the hub's chrome moves.
   *
   *  **The bottom.** Every bottom inset added `env(safe-area-inset-bottom)`. That is a VIEWPORT
   *  inset, not an element one, so it is the same number wherever the element sits - and in the
   *  hub the game already stops 40 px above the viewport bottom, so the home indicator was being
   *  paid for twice. `--gf-gap-b` is how far our own bottom edge already sits above the viewport,
   *  and the CSS subtracts it from the inset, floored at zero. Standalone the game is full bleed,
   *  the gap is 0, and the safe area is honoured in full exactly as before. */
  _fitInsets() {
    const el = this.rootEl;
    const r = el.getBoundingClientRect();
    // The hub's back pill is the only thing that has ever sat over this game. Asking for it by
    // name is a reach into the host, which is why it is a MEASUREMENT and not a constant: if it
    // is absent, hidden or clear of us, the pad is simply 0.
    let pad = 0;
    if (this.inHub) {
      const back = document.querySelector('.hub-back');
      if (back && !back.hidden && back.offsetParent !== null) {
        const b = back.getBoundingClientRect();
        // Only when it genuinely reaches into us, and only by as much as it does, plus a little air.
        if (b.bottom > r.top && b.right > r.left && b.left < r.right) pad = Math.ceil(b.bottom - r.top) + 6;
      }
    }
    el.style.setProperty('--gf-top-pad', `${Math.max(0, pad)}px`);
    const vh = window.innerHeight || 720;
    el.style.setProperty('--gf-gap-b', `${Math.max(0, Math.round(vh - r.bottom))}px`);
  }

  _sizeCanvas() {
    const r = this.rootEl.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // A zero-size canvas means the flex/layout has not settled: retry next frame rather than
    // building a camera against a 0x0 view (docs/BUILDING-A-GAME.md, "the .hub-game height trap").
    if (r.width < 8 || r.height < 8) { requestAnimationFrame(() => this._sizeCanvas()); return; }
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.meter.width = Math.round(METER_W * dpr);
    this.meter.height = Math.round(METER_H * dpr);
    this.meter.style.width = `${METER_W}px`;
    this.meter.style.height = `${METER_H}px`;
    this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.hole) {
      this.cam = makeCamera(this.hole, r.width, r.height);
      this._aimCamera(true);
    }
  }

  // ---------------------------------------------------------------- setup ----
  /** ONE setup screen, and it now asks in Matt's own order (2026-09-05): *"I want 3 modes: 3 hole,
   *  9 hole, and 18 hole. That's the first selection. Then the second selection should be the
   *  course. If I chose 3 holes, each course should be broken into 6 options of 3 holes."*
   *
   *  It is still ONE screen rather than three, which is the constraint that has held since there
   *  were two courses of eighteen: length chips, then course chips, then the sets - each row swaps
   *  what is under it in place, so the whole choice is visible at once and nothing is a tap deeper
   *  than it needs to be. On a phone, three screens before a ball is struck is where a game gets
   *  closed.
   *
   *  With 18 selected there is exactly one set, so its row is a single wide button rather than a
   *  grid of one - a chooser with one option is not a choice and should not look like one. */
  _renderSetup() {
    this._stopLoop();
    this.hole = null;
    this.rootEl.innerHTML = '';
    const c = this.course;
    // Only the lengths THIS course can actually be played at. A nine-hole course has no back nine
    // and no eighteen, and a remembered mode from an eighteen-hole course must not survive the
    // switch to one - it would leave the screen offering an empty round.
    const modes = modesForCourse(c);
    const mode = modes.includes(this.settings.lastMode || 3) ? (this.settings.lastMode || 3) : modes[0];
    const rounds = roundsForCourse(c, mode);
    // THE LADDER. Everything below is derived from the player's own record - see progress.js for
    // why none of it is stored separately.
    const gf = this._gf();
    const needTutorial = !tutorialDone(gf);
    const ladder = ladderProgress(c, gf);
    // A course still in TESTING is hidden outright; one that is merely not open yet is SHOWN and
    // locked, because a ladder you cannot see is not a ladder. Matt's own rule for Skeeball's
    // machines, and the same reading here.
    const courses = COURSES.filter((k) => this._isDev() || !this._courseTesting(k.id));
    // THE ROUND YOU LEFT, offered before anything else on the screen. `resume` has been sitting in
    // strings.js unused since the setup screen was written - it was named for this and never had
    // anything to call it.
    const sv = readSave();
    // The hole it will actually RESUME ON, which is not always `pos`: a save taken with the hole's
    // result card up has that hole already scored, and `_resumeSaved` steps past it. A button that
    // said "hole 1 of 3" and then opened hole 2 would be a small lie on the one screen a returning
    // player uses to decide whether this is even their round.
    const svNext = resumePos(sv);
    const svLine = sv ? t('resume_where', {
      course: t(`course_${sv.course.id}`),
      range: roundRange(sv.round),
      n: svNext + 1,
      all: sv.holeIdxs.length,
    }) : '';
    const el = document.createElement('div');
    el.className = 'gf-setup';
    this._themeSetup(el);
    el.innerHTML = `
      ${sv ? `<button type="button" class="gf-btn gf-resume is-cta" data-role="resume">
        <span>${esc(t('resume'))}</span><small>${esc(svLine)}</small></button>` : ''}
      <div class="gf-coursepick gf-modepick">
        ${modes.map((m) => {
    const open = modeUnlocked(c, m, gf);
    return `<button type="button" class="gf-btn gf-chip${m === mode ? ' is-on' : ''}${open ? '' : ' is-locked'}"
          data-mode="${m}"
          aria-label="${esc(open ? t('mode_holes', { n: m }) : `${t('mode_holes', { n: m })}, ${t('locked')}`)}"><span>${esc(t('mode_holes', { n: m }))}</span>${open ? '' : `<small>${esc(t('locked'))}</small>`}</button>`;
  }).join('')}
      </div>
      <div class="gf-coursepick">
        ${courses.map((k) => {
    const open = this._courseOpen(k.id);
    return `<button type="button" class="gf-btn gf-chip${k.id === c.id ? ' is-on' : ''}${open ? '' : ' is-locked'}"
          data-course="${esc(k.id)}"${open ? '' : ' disabled'}
          aria-label="${esc(open ? t(`course_${k.id}`) : `${t(`course_${k.id}`)}, ${t('lock_course')}`)}"><span>${esc(t(`course_${k.id}`))}</span>${open ? '' : `<small>${esc(t('lock_course'))}</small>`}</button>`;
  }).join('')}
      </div>
      <div class="gf-strip" data-role="strip" role="group" aria-label="${esc(t('every_hole', { course: t(`course_${c.id}`)}))}">
        ${holeRows(c).map((row) => `<div class="gf-strip__row">
          ${row.map(({ h, i }) => `<canvas class="gf-strip__hole" data-hole-art="${i}"
            style="--gf-ar:${holeAspect(h).toFixed(4)}"
            aria-label="${esc(t('hole_thumb', { n: h.n, par: h.par }))}"></canvas>`).join('')}
        </div>`).join('')}
      </div>
      <div class="gf-card gf-panel">
        <div class="gf-card-meta">
          <span>${esc(t('course_meta', { holes: c.holes.length, par: c.par, yds: Math.round(c.holes.reduce((a, h) => a + h.cardYards, 0)) }))}</span>
        </div>
        <div class="gf-card-blurb">${esc(t(c.blurbKey))}</div>
      </div>
      <div class="gf-card">
        <div class="gf-rounds${rounds.length === 1 ? ' is-one' : ''}">
          ${rounds.map((r) => {
    const st = roundState(c, r.id, gf);
    const lock = st.unlocked ? '' : this._lockText(st.need);
    return `<button type="button" class="gf-btn gf-roundbtn${st.unlocked ? '' : ' is-locked'}"
            data-round="${esc(r.id)}"${st.unlocked ? '' : ' disabled'}
            aria-label="${esc(st.unlocked ? t('holes_range', { range: roundRange(r) })
    : `${t('holes_range', { range: roundRange(r) })}, ${lock}`)}">
            <span>${esc(roundRange(r))}</span>
            ${st.unlocked
    ? `<small>${esc(t('round_meta', { par: roundPar(c, r.id) }))}</small>
            <small class="gf-best">${esc(this._bestText(roundKey(c, r.id), roundPar(c, r.id)))}</small>`
    : `<small class="gf-lock">${esc(lock)}</small>`}
          </button>`;
  }).join('')}
        </div>
      </div>
      <div class="gf-setup__foot">
        <button type="button" class="gf-btn gf-tutbtn${needTutorial ? ' is-cta' : ''}" data-role="tutorial">
          <span>${esc(needTutorial ? t('tutorial_cta') : t('tutorial_again'))}</span></button>
        ${needTutorial ? '' : `<button type="button" class="gf-btn" data-role="practice"><span>${esc(t('practice'))}</span></button>`}
        ${needTutorial ? '' : `<button type="button" class="gf-btn" data-role="board"><span>${esc(t('board'))}</span></button>`}
        <div class="gf-ladder">${esc(t('ladder_progress', ladder))}</div>
      </div>`;
    this.rootEl.appendChild(el);
    this._paintHoleStrip(el.querySelector('[data-role="strip"]'));
    for (const b of el.querySelectorAll('[data-mode]')) {
      this._on(b, 'click', () => {
        this.settings.lastMode = +b.dataset.mode;
        saveSettings(this.settings);
        this._renderSetup();
      });
    }
    for (const b of el.querySelectorAll('[data-course]')) {
      this._on(b, 'click', () => {
        this.course = courseById(b.dataset.course);
        this.settings.lastCourse = this.course.id;
        saveSettings(this.settings);
        this._renderSetup();
      });
    }
    const resume = el.querySelector('[data-role="resume"]');
    if (resume) this._on(resume, 'click', () => { if (!this._resumeSaved()) this._renderSetup(); });
    for (const b of el.querySelectorAll('[data-round]')) {
      this._on(b, 'click', () => this._askDiscard(() => this._startRound(b.dataset.round)));
    }
    // PRACTICE IS HIDDEN UNTIL THE TUTORIAL IS DONE, because before it there is nothing to
    // practise: every hole on the course is locked, so the screen would open on eighteen locked
    // buttons and read as a broken game rather than as a ladder.
    const prac = el.querySelector('[data-role="practice"]');
    if (prac) this._on(prac, 'click', () => this._askDiscard(() => this._renderHoleSelect()));
    // THE BOARD DOES NOT DISCARD A SAVED ROUND. It is a screen you look at and close, so it is not
    // behind `_askDiscard` the way starting something is - a player checking where they stand
    // mid-round must not be asked to throw that round away to do it.
    const board = el.querySelector('[data-role="board"]');
    if (board) this._on(board, 'click', () => this._openBoard());
    this._on(el.querySelector('[data-role="tutorial"]'), 'click',
      () => this._askDiscard(() => this._startTutorial()));
  }

  /** THE PLAYER'S OWN GOLF RECORD, read fresh every time the setup screen is drawn.
   *
   *  It is not cached on the instance on purpose: stats sync in the background (`stats-net.js`
   *  mirrors and merges on every hub load), so a player who shot par on their other phone should
   *  find the next set open the next time they look at this screen, not the next time they restart
   *  the game. Reading it costs one localStorage parse. */
  _gf() { try { return gfOf(loadStats()); } catch { return {}; } }

  /** IS THIS COURSE PLAYABLE AT ALL? The code default, with the admin's overrides ON TOP - never
   *  replacing it, which is the rule `js/admin-config.js`'s own header states for every switch it
   *  owns and the reason a missing, stale or unreachable config leaves the game behaving exactly as
   *  the code says.
   *
   *  `courseTestingOverride`, NOT `isCourseTesting`, AND THE DIFFERENCE IS THE WHOLE BUG.
   *  `resolveCourseTesting` returns TRUE when nothing has been written ("Missing key -> testing"),
   *  which was right in 2026-09-03: golf was a placeholder with no code-side course default at all,
   *  so testing was the only safe answer. It is wrong now that `progress.js` carries
   *  `COURSE_OPEN_BY_DEFAULT` - it would make the code default unreachable and hide ALL THREE
   *  courses from everyone, which is exactly what it did the first time this screen was driven in a
   *  browser (measured: the course picker rendered zero chips). Two switches for one decision is
   *  how a game ends up shipped hidden by accident, and this is that failure in miniature. The
   *  OVERRIDE reader returns null when nothing is set, so an absent config changes nothing. */
  _courseTesting(courseId) {
    return courseTestingOverride(readCachedConfig(), courseId) === true;
  }

  _courseOpen(courseId) {
    if (this._isDev()) return true;
    if (this._courseTesting(courseId)) return false;
    return courseOpenByDefault(courseId) || isCourseReleased(courseId);
  }

  _isDev() {
    try { const p = loadProfile(); return !!(p && isDevProfile(p.name)); } catch { return false; }
  }

  /** What one locked round is waiting on, in words. A lock with no reason is a dead end; this is
   *  what turns it into the next thing to go and do. */
  _lockText(need) {
    if (!need) return '';
    if (need.kind === 'tutorial') return t('lock_tutorial');
    const range = roundRange(need.roundId);
    return need.kind === 'par' ? t('lock_par', { range }) : t('lock_unlock', { range });
  }

  /** The setup screen's backdrop follows the course. It is chrome rather than course art, but a
   *  desert course behind a forest-green wash reads as the wrong game entirely. */
  _themeSetup(el) {
    const pal = paletteFor(this.course.theme);
    el.style.background = `linear-gradient(180deg, ${pal.setupA} 0%, ${pal.setupB} 100%)`;
  }

  /** EVERY HOLE, LEFT TO RIGHT (2026-09-08). Matt: *"get a photo of every hole, like the one that
   *  you have there, and line them up left to right so you can see every hole."*
   *
   *  It used to be ONE picture, of hole 1 - which on a screen whose whole job is choosing which
   *  three holes to play told you nothing about seventeen of them.
   *
   *  Each thumbnail comes from `buildMap`, the same builder the game plays on, so the strip can
   *  never show a course the game does not have. Two things make that affordable:
   *
   *  1. **THE BIG MAP IS DROPPED THE INSTANT IT IS DOWNSCALED.** `buildMap` rasterises at
   *     MAP_PPY (2.4 px/yd), so one hole is roughly 264 x 1128 px and eighteen of them would be
   *     about 21 MB of canvas held live for a menu. Only the thumbnail survives - about 10k px
   *     each - and it is what goes in the cache.
   *  2. **A HOLE IS ONLY BUILT WHEN IT SCROLLS INTO VIEW.** Five or so are visible at a time, so
   *     opening the screen pays for five rather than eighteen, and the rest arrive as the strip is
   *     dragged. `_stripCache` is keyed by course AND hole, so scrolling back, switching course
   *     and coming back, or re-rendering the screen are all free.
   *
   *  **AND IT NEVER LEAVES AN EMPTY BOX.** That is `docs/BUILDING-A-GAME.md`'s own rule - name what
   *  replaces a placeholder and when - and an unpainted canvas is exactly the "empty machine box"
   *  Skeeball shipped. The observer is the path back to the truth where there is one; where there
   *  is no `IntersectionObserver` at all, every hole is painted up front instead, because a picture
   *  that costs a moment beats a row of blank rectangles that never fill. */
  _paintHoleStrip(strip) {
    if (!strip) return;
    if (this.stripObs) { this.stripObs.disconnect(); this.stripObs = null; }
    if (!this._stripCache) this._stripCache = new Map();
    const courseId = this.course.id;

    const paint = (cv) => {
      if (this.destroyed || !cv.isConnected || cv.dataset.painted) return;
      const r = cv.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const i = +cv.dataset.holeArt;
      const hole = this.course.holes[i];
      if (!hole) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const pal = paletteFor(this.course.theme);
      ctx.fillStyle = pal.heavyRough;
      ctx.fillRect(0, 0, cv.width, cv.height);

      const key = `${courseId}:${i}:${cv.width}x${cv.height}`;
      let thumb = this._stripCache.get(key);
      if (!thumb) {
        const map = buildMap(hole, this.course.theme);
        // Fit the whole hole in, letterboxed on whichever axis has room to spare - the same rule
        // the single picture used, so a hole is never cropped and the shapes stay comparable.
        const sc = Math.min(cv.width / map.w, cv.height / map.h);
        thumb = document.createElement('canvas');
        thumb.width = Math.max(1, Math.round(map.w * sc));
        thumb.height = Math.max(1, Math.round(map.h * sc));
        const tctx = thumb.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(map.canvas, 0, 0, thumb.width, thumb.height);
        // `map` goes out of scope here and its ~264x1128 canvas with it. Holding it would be the
        // whole cost this cache exists to avoid.
        this._stripCache.set(key, thumb);
      }
      ctx.drawImage(thumb, (cv.width - thumb.width) / 2, (cv.height - thumb.height) / 2);
      cv.dataset.painted = '1';
    };

    const arts = [...strip.querySelectorAll('[data-hole-art]')];
    this.stripEl = strip;
    requestAnimationFrame(() => {
      if (this.destroyed || !strip.isConnected) return;
      this._sizeStripRows();
      // PAINTED A FEW PER FRAME, NEVER ALL AT ONCE. `buildMap` rasterises a whole hole (roughly
      // 264 x 1176 px on Pine Valley 1), and eighteen of those in one frame is a visible stall on
      // the frame the setup screen appears. Four a frame puts the first row up immediately and the
      // rest in under a hundred milliseconds, which reads as the screen drawing rather than as the
      // screen hanging.
      const chunk = (list) => {
        if (this.destroyed || !strip.isConnected || !list.length) return;
        for (const cv of list.splice(0, 4)) paint(cv);
        if (list.length) requestAnimationFrame(() => chunk(list));
      };
      if (typeof IntersectionObserver !== 'function') { chunk([...arts]); return; }
      this.stripObs = new IntersectionObserver((entries) => {
        const due = [];
        for (const e of entries) if (e.isIntersecting) { due.push(e.target); this.stripObs.unobserve(e.target); }
        chunk(due);
      // THE ROOT IS THE VIEWPORT, NOT THE STRIP, since 2026-09-08: the strip does not scroll any
      // more (every hole is on screen at once), so a strip-rooted observer would simply fire for
      // all eighteen at load and the laziness would be worth nothing. Against the viewport it
      // still defers whatever is below the fold on a short phone, which is where it earns its
      // keep - and `_paintStripChunked` below is what stops the rest landing in one frame.
      }, { rootMargin: '120px' });
      for (const cv of arts) this.stripObs.observe(cv);
    });
  }

  /** EACH ROW'S HEIGHT IS MEASURED, NOT PICKED, AND THE SCREEN'S HEIGHT WINS.
   *
   *  Every tile's width is its own hole's aspect times the row height, so a row of nine fills the
   *  width at exactly one height: `(row width - the gaps) / the sum of that row's aspects`. That is
   *  what removes the letterboxing, and on a tall phone it is the answer.
   *
   *  **BUT THE SETUP SCREEN MUST NOT SCROLL** (Matt, 2026-09-08, with a screen recording: *"Look at
   *  the scroll. I do not want a scroll on these setup/golf landing pages"*). Measured on the
   *  shipped build: 0px of overflow at 393x852 and **82px at 390x664**, before the hub's own ~98px
   *  of chrome is taken off the top - which is the phone in the video.
   *
   *  So the width-filling height is a CEILING, not the answer. Everything else on the screen is
   *  measured first, and the strip gets what is left. When that is less than the rows want, they
   *  are scaled down together and the rows end a little short of the full width - a small margin
   *  down one side, which is a far smaller cost than a screen that scrolls, and the one Matt has
   *  now ruled on twice.
   *
   *  HOW "EVERYTHING ELSE" IS MEASURED: the rows are collapsed to zero and the screen's own
   *  `scrollHeight` is read. That counts the padding, the gaps and every sibling with no list of
   *  them to keep in step - the same reason `_fit()` collapses the root before measuring its top.
   *  It costs one forced reflow, once per render of a menu. */
  _sizeStripRows() {
    const strip = this.stripEl;
    if (!strip || !strip.isConnected) return;
    const setup = strip.closest('.gf-setup');
    const rows = [...strip.querySelectorAll('.gf-strip__row')];
    if (!rows.length) return;
    const GAP = 4;

    // What each row would need to fill the width exactly. This is the ideal, and the ceiling.
    const want = rows.map((row) => {
      const arts = [...row.querySelectorAll('[data-hole-art]')];
      const w = row.clientWidth;
      if (!arts.length || w < 8) return 0;
      let sum = 0;
      for (const cv of arts) sum += parseFloat(cv.style.getPropertyValue('--gf-ar')) || 0.33;
      return (w - GAP * (arts.length - 1)) / sum;
    });
    const wanted = want.reduce((a, v) => a + v, 0) + GAP * (rows.length - 1);

    let scale = 1;
    if (setup) {
      // WHY THIS SUMS THE SIBLINGS INSTEAD OF READING `scrollHeight` WITH THE STRIP COLLAPSED.
      // That was the first attempt and it silently did nothing: `.gf-setup` is `position: absolute;
      // inset: 0`, so its scrollHeight can never fall BELOW its own client height - collapsing the
      // rows to zero still measured 664 of 664, `avail` came out -4, and the strip kept its full
      // size while the screen kept its 82px of overflow. Measured, not reasoned about.
      //
      // The children's heights plus the flex gaps and the padding is the same number without the
      // floor under it, and it needs no reflow.
      const cs = getComputedStyle(setup);
      const gapY = parseFloat(cs.rowGap) || 0;
      const kids = [...setup.children];
      let other = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
        + gapY * Math.max(0, kids.length - 1);
      for (const k of kids) if (k !== strip) other += k.getBoundingClientRect().height;
      // A 4px SAFETY MARGIN. Without it this lands 1-2px over, every time: each tile carries a 1px
      // border under `box-sizing: border-box` and the row heights are fractional, so the sum of what
      // is drawn rounds up against the sum of what was computed. Four pixels is cheaper than a
      // scrollbar.
      const avail = setup.clientHeight - other - GAP * (rows.length - 1) - 4;
      // MIN_ROW is the floor: below about 54px a hole is a smudge rather than a picture, and at
      // that point letting the screen scroll would be the lesser evil. Nothing measured reaches it
      // - the tightest case (390x664 in the hub) lands well above - and if a future screen ever
      // does, `test-visual.mjs`'s no-scroll check is what will say so.
      const MIN_ROW = 54;
      if (avail > 0 && wanted > avail) scale = Math.max((MIN_ROW * rows.length) / wanted, avail / wanted);
    }
    rows.forEach((row, i) => {
      if (!want[i]) return;
      row.style.setProperty('--gf-strip-h', `${(want[i] * scale).toFixed(2)}px`);
    });
  }

  /** The hole strip's observer holds a reference to every thumbnail canvas in it, so it has to go
   *  when the strip does - otherwise leaving the setup screen for a hole parks eighteen detached
   *  canvases alive until the next setup render. Cheap, idempotent, and called from every exit. */
  _dropStripObs() {
    if (this.stripObs) { this.stripObs.disconnect(); this.stripObs = null; }
    this.stripEl = null;
  }

  /** The stored best for one round, as a score TO PAR - the same number the leaderboard shows, so
   *  the two screens can never disagree. The stored value itself is always STROKES (golf/CLAUDE.md,
   *  "Stored shape"); par is subtracted here, at display time, and never on the way in. */
  _bestText(key, par) {
    let strokes = null;
    try {
      const st = loadStats();
      const v = ((((st.games || {}).golf || {}).gf || {}).bestRoundByCourse || {})[key];
      if (Number.isFinite(v)) strokes = v;
    } catch { /* no stats is not an error: it means nobody has played it */ }
    if (strokes == null) return t('best_none');
    const d = strokes - par;
    return t('best_is', { n: d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}` });
  }

  _renderHoleSelect() {
    this._dropStripObs();
    this.rootEl.innerHTML = '';
    const c = this.course;
    const playable = practisableHoles(c, this._gf());
    const el = document.createElement('div');
    el.className = 'gf-setup';
    this._themeSetup(el);
    el.innerHTML = `
      <h1>${esc(t(`course_${c.id}`))}</h1>
      <div class="gf-card gf-panel"><div class="gf-card-blurb">${esc(t('select_hole'))}</div>
        <div class="gf-holes">${c.holes.map((h, i) => {
    // A HOLE IS PRACTISABLE ONCE THE SET THAT INTRODUCES IT IS UNLOCKED. Without this, practice
    // is a way to walk the whole course without earning any of it, which would make the ladder
    // decoration. See `practisableHoles` in progress.js.
    const open = playable.has(i);
    return `
          <button type="button" class="gf-btn gf-hole-btn${open ? '' : ' is-locked'}" data-hole="${i}"${open ? '' : ' disabled'}
            aria-label="${esc(`${t('hole_abbr')} ${h.n}, ${t('par_n', { n: h.par })}${open ? '' : `, ${t('locked')}`}`)}">
            <span>${h.n}</span><small>${open ? h.par : '&#128274;'}</small></button>`;
  }).join('')}</div>
        <div class="gf-card-meta"><span>${esc(t('not_counted'))}</span></div>
      </div>
      <button type="button" class="gf-btn" data-role="back"><span>${esc(t('back'))}</span></button>`;
    this.rootEl.appendChild(el);
    for (const b of el.querySelectorAll('[data-hole]')) {
      this._on(b, 'click', () => this._startPractice(Number(b.dataset.hole)));
    }
    this._on(el.querySelector('[data-role="back"]'), 'click', () => this._renderSetup());
  }

  // ---------------------------------------------------------------- play ----
  /** GOLF'S OWN LEADERBOARD (golf/js/board.js, HANDOFF-GOLF-LAUNCH.md job C3).
   *
   *  The read is paid for HERE rather than inside the board, so the button can say it is working:
   *  `readPlayersOnce` is a network call and on a weak connection it is seconds of nothing. The
   *  module itself is loaded lazily for the same reason the hub lazy-loads its overlays - a player
   *  who never opens this screen never downloads it, and it pulls in the aggregation layer. */
  async _openBoard() {
    if (this._boardBusy) return;
    this._boardBusy = true;
    const btn = this.rootEl && this.rootEl.querySelector('[data-role="board"]');
    const span = btn && btn.querySelector('span');
    const was = span ? span.textContent : '';
    if (span) span.textContent = t('board_loading');
    try {
      const [{ openBoard }, net] = await Promise.all([
        import('./board.js'),
        import('../../js/stats-net.js'),
      ]);
      const players = await net.readPlayersOnce();
      if (this.destroyed || !this.rootEl) return;
      openBoard(this.rootEl, {
        players,
        courseId: this.course.id,
        mode: this.settings.lastMode || 3,
      });
    } catch (err) {
      console.error('[golf] the leaderboard could not open', err);
    } finally {
      this._boardBusy = false;
      if (span) span.textContent = was;
    }
  }

  /** Start a scored round: a course plus the slice of its holes this round plays. */
  _startRound(roundId) {
    this.roundId = roundId;
    this.holeIdxs = roundHoles(this.course, roundId);
    this.pos = 0;
    this.scores = [];
    this.roundStats = { birdies: 0, eagles: 0, aces: 0, points: 0, longestDriveYd: 0 };
    this.recorded = false;
    // AND THE "NEW BEST" FLAG, WHICH USED TO SURVIVE THE ROUND THAT SET IT (2026-09-07).
    //
    // `_recordRound` runs once, on the last hole, and it was the only thing that ever WROTE
    // `newBest`. Nothing cleared it - so a player who set a best and then started another round
    // was told "best saved" on the result card of hole 1, hole 2 and every hole after it, on a
    // round that had recorded nothing at all. Nothing was mis-STORED by that; the store is written
    // by `_recordRound` alone and it was right. It was the card that was lying.
    this.newBest = false;
    this.settings.lastRound = roundId;
    saveSettings(this.settings);
    this._enterHole();
  }

  /** Start ONE hole, unscored. A practice hole never touches bestRoundByCourse - a single hole's
   *  stroke count is not a round, and writing it as one would put a 3 where an 18-hole best goes
   *  and stand there for ever (THE LAW rule 2: bests only ever improve, so a wrong low one can
   *  never be corrected). */
  _startPractice(holeIdx) {
    this.roundId = 'practice';
    this.holeIdxs = [holeIdx];
    this.pos = 0;
    this.scores = [];
    this.roundStats = { birdies: 0, eagles: 0, aces: 0, points: 0, longestDriveYd: 0 };
    this.recorded = false;
    this.newBest = false;                     // see _startRound: it used to outlive its own round
    this._enterHole();
  }

  /** THE LESSON. One hole, off no course, with a `Coach` watching.
   *
   *  It is started exactly like a practice hole - same `_enterHole`, same play screen, same
   *  physics - with two differences: `this.course` is the tutorial's own course object, so
   *  `holeKey` writes `tutorial:1` and `progress.js` can see it; and `this.coach` exists, which is
   *  the only thing the play screen checks. */
  _startTutorial() {
    this.course = TUTORIAL_COURSE;
    this.roundId = 'practice';
    this.holeIdxs = [0];
    this.pos = 0;
    this.scores = [];
    this.roundStats = { birdies: 0, eagles: 0, aces: 0, points: 0, longestDriveYd: 0 };
    this.recorded = false;
    this.newBest = false;
    this.tutorialRun = true;
    this._enterHole();
  }

  /** Back to the setup screen from the tutorial, on the course the player was looking at before.
   *  `this.course` is left pointing at the tutorial while the lesson runs, and the setup screen
   *  reads `this.course` for everything - so without this, finishing the lesson would open a
   *  course picker with a course in it that is not in `COURSES`. */
  _leaveTutorial() {
    this.tutorialRun = false;
    this._dropCoach();
    this.course = courseById(this.settings.lastCourse || COURSES[0].id);
    this._renderSetup();
  }

  _dropCoach() { if (this.coach) { this.coach.destroy(); this.coach = null; } }

  /** Tell the lesson what just happened. Called unconditionally from the game's own paths: the
   *  coach ignores anything the current step is not waiting for, so no caller has to know which
   *  step is up, and a golfer who is not in the lesson has no coach at all. */
  _coach(kind) { if (this.coach) this.coach.event(kind); }

  /** PAINT A STILL DIAL FOR THE LESSON'S POPUPS, through the meter's own painter. Handed to the
   *  Coach as `onDial` so `golf/js/tutorial.js` never has to know how a dial is drawn - and so the
   *  popup that teaches the meter cannot drift from the meter. */
  _paintTutorialDial(canvas, opts) {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(METER_W * dpr);
    canvas.height = Math.round(METER_H * dpr);
    canvas.style.width = `${METER_W}px`;
    canvas.style.height = `${METER_H}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A STILL dial: no needle, no planted marker, no hub readout. `pos: -BAR_HALF` parks the needle
    // off the bottom of the bar where it cannot be mistaken for a mark the lesson is pointing at.
    this._drawMeter(performance.now(), {
      ctx,
      still: true,
      putting: opts.putting,
      club: opts.putting ? PUTTER : CLUBS[0],
      lie: opts.putting ? 'green' : 'fairway',
      read: { phase: PHASE.IDLE, pos: -BAR_HALF, power: null },
      marks: opts.marks,
    });
  }

  _enterHole() {
    this._dropStripObs();
    const hole = this.course.holes[this.holeIdxs[this.pos]];
    // A hole that fails validation must fail LOUDLY rather than half-render: a malformed green
    // silently flattens the break, and that gets diagnosed as "putting feels wrong" for a week.
    const errs = validateHole(hole);
    if (errs.length) { console.error('[golf] invalid hole data:', errs); }

    this.hole = hole;
    this.map = buildMap(hole, this.course.theme);
    this.ball = [...hole.tee];
    this.shotN = 1;
    this.holed = false;
    this.pickedUp = false;
    this.lastShotYd = null;
    this.anim = null;
    this.previewDx = 0;
    this.previewDy = 0;
    this.dragging = false;
    this.returning = false;
    this.swing = new Swing();
    this.aimRad = this._bearingToPin();
    this.club = autoSelectClub(this._distToPin(), this._lie());
    this._syncTempo();
    // THE OPENING LOOK AT THE HOLE. Matt, 2026-09-06: "when you first get to (or open or start)
    // [a hole], I'd like for it to begin by showing the green, then automatically move backwards
    // from the green to the tee box." `t0` is set on the first frame that has a camera, because
    // the camera is not built until the canvas has a real size (_sizeCanvas).
    this.intro = { t0: 0 };
    // The prompt is a child of rootEl, and _renderPlay wipes rootEl - so a stale reference here
    // would leave `if (this.dropEl) return` blocking every later prompt in the round.
    this.dropEl = null;
    // Same reason: `_renderPlay` wipes rootEl, and a stale reference would make `_pauseMenu`'s own
    // "already open" guard refuse to open it again for the rest of the round.
    this.pauseEl = null;
    this._renderPlay();
    // THE COACH IS REBUILT WITH THE SCREEN, because `_renderPlay` wipes `rootEl` and every card,
    // ring and arrow the lesson has drawn goes with it. It keeps its own step index, so a
    // re-render never restarts the lesson.
    if (this.tutorialRun) {
      // THE BOTTOM HUD RIDES UP BY THE RAIL'S OWN HEIGHT while the lesson runs. Matt, picking the
      // rail off the mockups: *"i like the bottom rail with pips, but it covers the buttons"* - so
      // the rail does not float over the controls, the controls move and it takes the strip they
      // give back. `_keepBallAndCupClear` measures those clusters, so the camera follows for free.
      this.rootEl.setAttribute('data-tut', '1');
      if (!this.coach) {
        this.coach = new Coach(this.rootEl, () => {
          this.coach = null;
          if (this.rootEl) this.rootEl.removeAttribute('data-tut');
          // THE LESSON'S END IS THE HOLE'S END. Its last card sits on top of the result panel, so
          // the panel's own close hands off to the coach rather than quitting; leaving is this.
          if (this.tutorialRun && this.holed) this._leaveTutorial();
          else this._fit();
        });
        this.coach.onDial = (cv, o) => this._paintTutorialDial(cv, o);
        this.coach.start();
      } else {
        this.coach.root = this.rootEl;
        this.coach.refresh();
      }
    }
    this._saveRound();
  }

  /** Cut the opening flyover short. Any tap on the course does this, and so does any control that
   *  starts a shot - a player who is already aiming has stopped watching. */
  _endIntro() {
    if (!this.intro) return;
    this.intro = null;
    if (this.el && this.el.tc) this.el.tc.setAttribute('data-faded', '0');
    this._aimCamera(true);
  }

  _bearingToPin() {
    const dx = this.hole.pin[0] - this.ball[0];
    const dy = this.hole.pin[1] - this.ball[1];
    return Math.atan2(dx, dy);
  }
  _distToPin() { return distYd(this.ball, this.hole.pin); }
  _lie() { return surfaceAt(this.hole, this.ball[0], this.ball[1]); }
  /** THE LIE FORCES THE PUTTER: the green and its collar. This gates the auto-pick, the club
   *  ladder (there is nothing else to take) and the camera's zoom.
   *
   *  It used to be one predicate called `_onGreen` gating five separate things, including "may
   *  the player choose a putter". Matt, 2026-09-04: "You should make the putter available when on
   *  the fairway and fringe. Not the rough." A fairway lie must OFFER the putter without FORCING
   *  it, so the question is now three questions with three answers. */
  _mustPutt() { return mustPutt(this._lie()); }

  /** THE PUTTER MAY BE CHOSEN here: the above, plus the fairway and the tee. */
  _canPutt() { return canPutt(this._lie()); }

  /** THE PUTTER IS ACTUALLY IN HAND. This - not the lie - is what decides how the shot resolves,
   *  what the aim ladder draws, and whether the distance reads in feet. The LIE still decides the
   *  camera, because a putt from 15 yds out needs to see where it is going. */
  _putting() { return this._activeClub().id === 'putter'; }

  /** THE club in hand, resolved in ONE place. The HUD paints this and _fire swings it, so the tile
   *  can never name one club while the shot uses another - which is exactly what happened when the
   *  HUD grew its own auto-pick fallback and _fire kept reading the raw field. */
  _activeClub() {
    const lie = this._lie();
    if (lockedToPutter(lie)) return PUTTER;
    // A putter carried onto a lie that cannot hold one (the ball ran into rough) hands the bag
    // back rather than swinging a putter out of the cabbage.
    if (!this.club) this.club = autoSelectClub(this._distToPin(), lie);
    else if (this.club.id === 'putter' && !canPutt(lie)) this.club = autoSelectClub(this._distToPin(), lie);
    return this.club;
  }

  /** Keep the needle's speed in step with the club in hand. Called wherever the club can change
   *  (the club nudges, a settled shot, a new hole) rather than inside `_activeClub`, because that
   *  runs from the render loop too and a `Swing` mid-stroke must never be re-timed. */
  _syncTempo() { this.swing.setTempo(swingTempo(this._activeClub())); }

  _renderPlay() {
    this.rootEl.innerHTML = '';
    this.rootEl.innerHTML = `
      <canvas class="gf-canvas" data-role="canvas" aria-label="${t('a11y_view')}"></canvas>
      <!-- The club artwork's gradients and clips, injected ONCE. Every tile then references a
           symbol out of this, so changing club costs one <use> instead of re-parsing 19 KB. -->
      <svg class="gf-artdefs" aria-hidden="true" focusable="false">${CLUB_ART_DEFS}</svg>
      <div class="gf-hud">
        <div class="gf-tl">
          <div class="gf-tl-col">
            <div class="gf-tl-row">
              <button type="button" class="gf-btn" data-role="pause"><span>${t('pause')}</span></button>
              <div class="gf-flag"><span style="color:${PALETTE.pin}">&#9873;</span><span data-role="holeno"></span></div>
            </div>
            <div class="gf-panel gf-info">
              <b data-role="par"></b>
              <b data-role="shot"></b>
              <span class="gf-mode" data-role="mode"></span>
            </div>
          </div>
        </div>

        <div class="gf-tc" data-role="tc">
          <span class="gf-lieart" data-role="lieart"></span>
          <div class="gf-panel gf-lie" data-role="lie"></div>
          <div class="gf-panel gf-power" data-role="power"></div>
          <div class="gf-dist" data-role="dist"></div>
        </div>

        <div class="gf-tr gf-panel" data-role="windpanel">
          <span>${t('wind')}</span>
          <span class="gf-windarrow" data-role="windarrow">${windArrow(0)}</span>
          <b data-role="wind">0.0</b>
        </div>

        <div class="gf-bl">
          <div class="gf-aimrow">
            <button type="button" class="gf-btn" data-role="aim-l" aria-label="${t('a11y_aim_left')}"><span>&lt;</span></button>
            <div class="gf-panel gf-aimlabel">${t('aim')}</div>
            <button type="button" class="gf-btn" data-role="aim-r" aria-label="${t('a11y_aim_right')}"><span>&gt;</span></button>
          </div>
          <div class="gf-clubrow">
            <div class="gf-panel gf-clubtile">
              <span class="gf-clubartwrap" data-role="clubart"></span>
              <span class="gf-clubname" data-role="clubname"></span>
              <span class="gf-clubyds" data-role="clubyds"></span>
            </div>
            <div class="gf-clubcol">
              <button type="button" class="gf-btn" data-role="club-up" aria-label="${t('a11y_club_up')}"><span>&and;</span></button>
              <button type="button" class="gf-btn" data-role="club-dn" aria-label="${t('a11y_club_down')}"><span>&or;</span></button>
            </div>
          </div>
        </div>

        <div class="gf-br">
          <canvas class="gf-meter" data-role="meter" width="176" height="150" aria-hidden="true"></canvas>
          <button type="button" class="gf-btn gf-swing" data-role="swing" aria-label="${t('a11y_swing')}"><span>${t('swing')}</span></button>
        </div>
      </div>`;

    this.canvas = this.rootEl.querySelector('[data-role="canvas"]');
    this.ctx = this.canvas.getContext('2d');
    this.meter = this.rootEl.querySelector('[data-role="meter"]');
    this.mctx = this.meter.getContext('2d');
    this.el = {};
    for (const k of ['par', 'shot', 'mode', 'holeno', 'lieart', 'lie', 'power', 'dist', 'tc', 'clubart', 'clubname', 'clubyds', 'wind', 'windarrow', 'windpanel', 'swing']) {
      this.el[k] = this.rootEl.querySelector(`[data-role="${k}"]`);
    }
    // The four floating HUD clusters, by class: they carry no data-role because nothing
    // paints into them, but _keepBallAndCupClear has to MEASURE them to know what part of the canvas is
    // covered.
    for (const k of ['tl', 'tr', 'bl', 'br']) this.el[k] = this.rootEl.querySelector('.gf-' + k);

    this._bindPlay();
    this._sizeCanvas();
    this._paintHud();
    this._startLoop();
  }

  _bindPlay() {
    const q = (r) => this.rootEl.querySelector(`[data-role="${r}"]`);
    this._on(q('pause'), 'click', () => this._pauseMenu());

    // Press-and-hold auto-repeat for the four nudge controls, after a 400 ms delay (§4).
    const hold = (el, fn) => {
      let timer = 0; let heldSince = 0;
      const stop = () => { clearTimeout(timer); timer = 0; heldSince = 0; el.removeAttribute('data-down'); };
      // A self-rescheduling timeout rather than a setInterval, because the gap CHANGES on every
      // repeat: `k` is how far into the ramp we are, so the delay eases from HOLD_SLOW_MS down to
      // HOLD_FAST_MS and then stays there for as long as the finger is down.
      const tick = () => {
        // `k` is the ramp: 0 on the first repeat, 1 once the hold is at full speed. It sets the
        // gap to the NEXT repeat and is handed to `fn`, so a control can make its STEP grow with
        // the hold too - which is what lets a single tap on the aim arrows be finer than the
        // sweep a held one has to manage (see AIM_STEP_DEG).
        const k = Math.min(1, (performance.now() - heldSince - HOLD_DELAY_MS) / HOLD_RAMP_MS);
        fn(k);
        timer = setTimeout(tick, HOLD_SLOW_MS + (HOLD_FAST_MS - HOLD_SLOW_MS) * k);
      };
      const start = (ev) => {
        ev.preventDefault();
        el.setAttribute('data-down', '1');
        heldSince = performance.now();
        fn(0);
        timer = setTimeout(tick, HOLD_DELAY_MS);
      };
      this._on(el, 'pointerdown', start);
      this._on(el, 'pointerup', stop);
      this._on(el, 'pointercancel', stop);
      this._on(el, 'pointerleave', stop);
      this.listeners.push([{ removeEventListener: stop }, '', () => {}, undefined]);
    };
    hold(q('aim-l'), (k) => this._nudgeAim(-1, k));
    hold(q('aim-r'), (k) => this._nudgeAim(+1, k));
    hold(q('club-up'), () => this._stepClub(+1));
    hold(q('club-dn'), () => this._stepClub(-1));

    // THE SWING FIRES ON PRESS, NOT ON RELEASE, AND IT IS TIMED BY THE EVENT ITSELF.
    //
    // Matt: "the power/aim meter feels delayed. I don't think it stops when i click the swing
    // button." It did not. It fired on `pointerup`, so the needle kept travelling for the whole
    // duration of the press - and MEASURED against this build's own numbers, a perfectly ordinary
    // 120 ms press is 0.104 power units on the downswing against a BAR_HALF of 0.12. That is
    // EIGHTY-SEVEN PER CENT of the accuracy half-window spent between seeing the needle and the
    // game reading it. The player was aiming at where the needle would be, not where it was.
    //
    // `ev.timeStamp` is the moment the input actually happened, on the same time origin as
    // performance.now(); reading the clock in the handler instead adds however long the event sat
    // in the queue. Guarded, because a hostile or exotic timeStamp must not send the swing
    // backwards in time.
    const sw = q('swing');
    const evNow = (ev) => {
      const now = performance.now();
      const ts = ev && ev.timeStamp;
      return (Number.isFinite(ts) && ts > 0 && now - ts >= 0 && now - ts < 2000) ? ts : now;
    };
    // RAPID TAPS MUST NOT BECOME A DOUBLE TAP. Matt, 2026-09-06, on trying to hit a short putt
    // softly: *"if you tap that fast it selects something to copy."* Two taps inside ~300 ms are
    // iOS's select-a-word gesture; Safari then hunts for the nearest selectable text and latches
    // onto the HUD, and the Copy bar covers the game. A three-tap swing REQUIRES fast taps - a 2 ft
    // putt's second tap lands about 300 ms after the first - so this is not an edge case here.
    //
    // The same four-layer fix Hill Climb needed (hill-climb/CLAUDE.md, "the copy/paste screen pops
    // up"), because no single layer holds: (1) `-webkit-user-select`/`touch-callout`/
    // `tap-highlight-color` on `.gf-root *`, already in golf.css; (2) `.gf-btn > span
    // { pointer-events: none }`, already there; (3) a NON-PASSIVE touchstart that preventDefaults,
    // which is what stops the gesture ever starting - and because that makes the synthesised
    // pointer events unreliable, touch drives the button directly and the pointer path
    // early-returns on `pointerType === 'touch'`; (4) the selectstart/selectionchange backstop
    // below, which holds whichever path Safari took.
    this._on(sw, 'touchstart', (ev) => {
      ev.preventDefault();
      sw.setAttribute('data-down', '1');
      this._tap(evNow(ev));
    }, { passive: false });
    const swEnd = () => sw.removeAttribute('data-down');
    this._on(sw, 'touchend', swEnd);
    this._on(sw, 'touchcancel', swEnd);
    this._on(sw, 'pointerdown', (ev) => {
      if (ev.pointerType === 'touch') return;   // the touchstart above already played this tap
      ev.preventDefault();
      sw.setAttribute('data-down', '1');
      this._tap(evNow(ev));
    });
    this._on(sw, 'pointerup', (ev) => { ev.preventDefault(); sw.removeAttribute('data-down'); });
    this._on(sw, 'pointercancel', swEnd);

    // Layer 4: nothing inside the game is ever selectable, whichever gesture path got there.
    this._on(this.rootEl, 'selectstart', (ev) => ev.preventDefault());
    this._on(document, 'selectionchange', () => {
      const sel = document.getSelection && document.getSelection();
      if (!sel || sel.isCollapsed || !sel.anchorNode) return;
      const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode;
      if (node && this.rootEl.contains(node)) sel.removeAllRanges();
    });

    // FREE LOOK. Drag the course around to study the hole, let go and it eases back to the ball.
    // Bound to the game's own root, NEVER to document - a non-passive touchmove on document turns
    // off compositor scrolling for the whole page while this game is mounted.
    //
    // Matt's playtest (2026-09-04): "in the real game, i can move the map around to check it out,
    // but when i tried in our game things got messed up instantly." Three things were wrong and
    // all three are fixed here:
    //   1. The preview camera was NEVER CLAMPED. `drawFrame` was handed a camera carrying a
    //      clamp() it never called, so a short drag scrolled straight off the map into blank
    //      colour with no way to tell which way was back. That is the "messed up instantly".
    //   2. It only panned VERTICALLY, so a dogleg (hole 3 bends 60 yds right) could not be looked
    //      at along its own line at all.
    //   3. `pointerleave` ended the drag, so sliding a thumb near the screen edge dropped it
    //      mid-look. Pointer capture makes that unnecessary.
    // `this.dragging`, not a closure local: the render loop reads it to know whether to ease the
    // free look back to the ball, and a local here would leave it easing back UNDER the finger.
    let startX = 0; let startY = 0; let baseX = 0; let baseY = 0; let moved = 0; let skipOnTap = false;
    this.dragging = false;
    this._on(this.canvas, 'pointerdown', (ev) => {
      // WHILE THE BALL IS MOVING, THIS IS STILL A PAN. Matt, 2026-09-06: "as the ball rolls, I
      // tried to move the screen so I could see it go in/near the hole. As soon as I did, the shot
      // ended and skipped to where the ball would have ended up." Touching the screen used to skip
      // on pointerDOWN, so a drag could never begin. The skip now happens on release, and only if
      // the press never moved - so a TAP still skips the flight (the reference's own worst flaw is
      // that it cannot be skipped) and a DRAG looks around instead.
      skipOnTap = !!this.anim;
      if (this.intro) this._endIntro();
      this.dragging = true; moved = 0; this.returning = false;
      startX = ev.clientX; startY = ev.clientY;
      baseX = this.previewDx; baseY = this.previewDy;
      this.canvas.setPointerCapture?.(ev.pointerId);
    });
    this._on(this.canvas, 'pointermove', (ev) => {
      if (!this.dragging || !this.cam) return;
      moved = Math.max(moved, Math.hypot(ev.clientX - startX, ev.clientY - startY));
      this.previewDx = baseX - (ev.clientX - startX) / this.cam.ppy;
      this.previewDy = baseY + (ev.clientY - startY) / this.cam.ppy;
      this._clampPreview();
      // The lie tile and the yardage fade while the view is away from the ball, and snap back when
      // it returns - the reference's own idea, and a good one: it says "this is not your shot".
      this.el.tc.setAttribute('data-faded', Math.hypot(this.previewDx, this.previewDy) > 4 ? '1' : '0');
    });
    const release = (ev) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.canvas.releasePointerCapture?.(ev && ev.pointerId);
      const tapped = moved < 8;
      if (skipOnTap) {
        skipOnTap = false;
        // A tap while the ball is in the air or rolling skips to the end of the shot; a drag was
        // a look around, and the shot plays out in full underneath it.
        if (tapped) this._skipAnim();
        return;
      }
      // A TAP (no real drag) snaps the view back to the ball. A drag HOLDS, so the player can
      // study the green for as long as they like.
      if (tapped) { this.returning = true; this.el.tc.setAttribute('data-faded', '0'); }
    };
    this._on(this.canvas, 'pointerup', release);
    this._on(this.canvas, 'pointercancel', release);
  }

  /** `k` is how far into a press-and-hold's acceleration this step is, 0 for a single tap. */
  _nudgeAim(dir, k = 0) {
    if (this.anim || this.swing.phase !== PHASE.IDLE) return;
    if (this.intro) this._endIntro();
    const base = this._bearingToPin();
    const step = AIM_STEP_DEG + (AIM_STEP_HOLD_DEG - AIM_STEP_DEG) * Math.max(0, Math.min(1, k));
    let next = this.aimRad + dir * step * DEG;
    const limit = AIM_LIMIT_DEG * DEG;
    // Aim is limited to +/- 60 deg from the line to the hole, so the player can never lose the
    // hole entirely by leaning on one arrow.
    let rel = next - base;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    rel = Math.max(-limit, Math.min(limit, rel));
    next = base + rel;
    this.aimRad = next;
    this._coach('aim');
    this._paintHud();
  }

  /** The swing button kicks when a tap is refused. 220 ms, class-driven so reduced-motion CSS can
   *  flatten it; re-armed by removing the class first so back-to-back refusals each show. */
  _refuseFlash() {
    const el = this.el && this.el.swing;
    if (!el) return;
    el.classList.remove('is-refused');
    void el.offsetWidth;
    el.classList.add('is-refused');
    clearTimeout(this._refuseT);
    this._refuseT = setTimeout(() => { if (!this.destroyed && el) el.classList.remove('is-refused'); }, 220);
  }

  _stepClub(dir) {
    if (this.anim || this.swing.phase !== PHASE.IDLE) return;
    if (this.intro) this._endIntro();
    if (lockedToPutter(this._lie())) return;        // the putter is the only club on the green
    this.club = stepClub(this._activeClub(), dir, this._lie());
    this._syncTempo();
    this._coach('club');
    this._paintHud();
  }

  // ---------------------------------------------------------------- the swing ----
  _tap(atMs) {
    if (this.anim) { this._skipAnim(); return; }
    if (this.intro) this._endIntro();
    // THE LESSON CAN HOLD THE SWING. Matt: *"you shouldn't be able to swing without first tapping
    // the aim arrows."* The aim and club steps refused to advance on anything else, but the player
    // could still swing straight past them, which made a lesson that teaches by USING a control
    // into one you could ignore. The tap is refused and the rings flash instead - a control that
    // quietly does nothing reads as broken, which is the exact complaint the putter's dead zone got.
    if (this.coach && this.coach.blocksSwing()) { this.coach.nudge(); return; }
    if (this.holed) { this._renderSetup(); return; }
    // `atMs` is the input event's own timestamp when the caller has one - see the swing button's
    // binding. Everything downstream is a pure function of it, so the shot is resolved against
    // the instant the player's finger landed rather than the instant this handler ran.
    const now = Number.isFinite(atMs) ? atMs : performance.now();
    const r = this.swing.tap(now);
    // THE VIEW COMES HOME INSTANTLY WHEN THE STROKE STARTS, it does not glide.
    //
    // Matt, 2026-09-04: "when I first press Swing, the entire screen moves to show the golfer.
    // That's not what the reference clips do either. It's [too] much to focus on the power/aim
    // task when you're moving the whole screen around." The free look HOLDS where you leave it
    // (that was a fix in its own right), so a player who has scrolled 110 yds up the fairway to
    // look at the green was then given half a second of the whole course sliding sideways -
    // starting on the same frame as the backswing, which is the one moment in the game that
    // needs a still screen. Snapping costs nothing: the player is looking at the meter.
    //
    // A TAP ON THE COURSE still eases home (see the pointerup handler). That one is a deliberate
    // "bring me back" gesture with nothing else happening, and the glide is what makes it read as
    // the camera travelling rather than as the hole teleporting.
    // THE READOUTS HAVE TO COME BACK, TOO. Zeroing the preview snaps the camera home but used to
    // leave `data-faded` set, and nothing else clears it except a tap on the course - so ONE free
    // look on hole 1 left the lie tile, the power cap and the yardage at 40 % opacity for the rest
    // of the round. Matt's test-hole video is ghosted in every single frame. It is the same defect
    // the METER had (see "The meter's two real bugs"), surviving in the one cluster that kept its
    // fade on purpose.
    if (r === 'begin') {
      this.previewDx = 0; this.previewDy = 0; this.returning = false;
      this.el.tc.setAttribute('data-faded', '0');
    }
    if (r === 'fire') this._fire();
    // The lesson's three swing steps are exactly the three taps, so they are reported from the one
    // place that knows which tap this was.
    if (r === 'begin') this._coach('tap-begin');
    else if (r === 'power') this._coach('tap-power');
    else if (r === 'fire') this._coach('fire');
    // A REFUSED TAP HAS TO SAY SO. `swing.tap()` returns null for "this tap did nothing", which is
    // the putter's dead zone almost every time (see MIN_TAP_POS in swing.js). Silence there is the
    // whole of Matt's report - *"I have to click swing twice to get it to start moving"* - because
    // a tap that vanishes leaves the player one tap out of step for the rest of the stroke: their
    // next tap sets POWER when they think it is setting accuracy.
    if (r === null) this._refuseFlash();
    this._paintHud();
  }

  _fire() {
    const lie = this._lie();
    // THE BALL DOES NOT LEAVE ON THE THIRD TAP. Measured across all four reference clips: the tap
    // is followed by about a quarter-second of stillness and then a ~0.6 s golfer swing animation,
    // and only then does the ball move. Clip 3 is the clean one, because the player had not moved
    // the camera: tap at frame 799, dead still to 814, the golfer swinging 815-849, ball away at
    // 850 - 0.85 s. Ours fired the instant the finger landed, which is why the swing had no weight
    // to it. `WINDUP_MS` is that gap; `_frame` holds the ball at address and plays the pose until
    // it has passed, and a tap still skips the whole thing.
    const zone = lieOf(lie).zone;
    // The CLUB narrows the green band on top of the lie - a driver is harder to strike clean than a
    // wedge from the same spot (clubs.js's swingZone).
    const clubZone = swingZone(this._activeClub());
    // ONE needle: the power is the marker planted at tap 2, the accuracy is where the needle was
    // stopped on the way back down. `barPosOf` maps that position onto the accuracy bar's 0..1,
    // which is the only form the mishit model has ever taken.
    // The third tap has already LOCKED both values on the Swing, so these are read straight off
    // it rather than re-derived from a clock: re-reading `performance.now()` here would resolve
    // the shot a few milliseconds after the finger landed, which is the whole bug this fixes.
    const { pos, power } = { pos: this.swing.pos, power: this.swing.power };
    // The over-swing spray needs a seed: unpredictable to the player, reproducible for the tests.
    // The ball's own position and the exact needle stop are what the shot already turns on.
    const seed = Math.round(this.ball[0] * 977) ^ Math.round(this.ball[1] * 31) ^ Math.round(pos * 1e5);
    const m = mishit(barPosOf(pos), power, zone, clubZone, seed, GREEN_FLOOR[clubTier(this._activeClub())] || 0);

    // THE SHOT RESOLVES ON THE CLUB IN HAND, NOT ON THE LIE. They agree everywhere except the
    // fairway and the tee, which is exactly the case this split exists for.
    if (this._putting()) {
      // THE PUTTER HAS ITS OWN ACCURACY. See puttMishit's header in swing.js: the old
      // `m.deg * 0.25` could not miss a cup that captures at a fixed 0.30 yds, and the green band
      // carried no pace error at all, so every putt inside 30 ft went in.
      const pm = puttMishit(barPosOf(pos), zone);
      const res = simulatePutt({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + pm.deg * DEG,
        power: Math.max(0, Math.min(1, power * pm.paceMul)),
        rangeFt: puttRangeFt(),
      });
      this.anim = { type: 'putt', t0: performance.now() + WINDUP_MS, dur: res.ms, res, from: [...this.ball] };
    } else {
      const club = this._activeClub();
      // THE MISS IS A CURVE, NOT A ROTATED LAUNCH LINE (2026-09-08). Matt: *"Do off target balls
      // travel in a straight line? Or do they slice/hook like in real golf?"* They travelled dead
      // straight, and that was this call site contradicting the engine: `flightPoint` has always
      // put the lateral term on `p * p` while the along term is linear - a ball that starts on the
      // aim line and bends away from it - and `shot.js` says so in its own header. Handing the miss
      // in as a ROTATION of `aimRad` with `mishitDeg: 0` bypassed all of it, so every mishit left
      // the club already pointing where it would finish.
      //
      // The landing point barely moves: the lateral offset at p = 1 is `tan(deg) * carry` either
      // way, so nothing calibrated against dispersion shifts. What changes is the SHAPE of the
      // flight - and, because `treeHit` samples the same curve, which trees a sliced ball is
      // actually behind.
      const res = resolveShot({
        hole: this.hole, from: this.ball, aimRad: this.aimRad,
        club, power, mishitDeg: m.deg, distanceMul: m.distanceMul,
      });
      this.anim = { type: 'flight', t0: performance.now() + WINDUP_MS, dur: res.flightMs, res, club, from: [...this.ball] };
    }
    // The hub readout is set when the ball STOPS, never here - see _settleShot.
  }

  /** Tap to skip: the reference's 7.5 s drive with no way past it is the main thing worth
   *  changing about it (§13 flaw 7). Ours is ~4.5 s and skippable. */
  _skipAnim() {
    if (!this.anim) return;
    const roll = (this.anim.res && this.anim.res.rollMs) ? this.anim.res.rollMs : 0;
    const el = performance.now() - this.anim.t0;
    // A SKIP DURING THE FLIGHT LANDS THE BALL; IT DOES NOT END THE SHOT. Skipping used to jump
    // straight to the rest position, which threw away the bounce and the run-out - a second half
    // that is 3.4 s long and carries a driver 38 yds. Matt, 2026-09-06: "the roll stops short.
    // Nothing truly rolls out." Anyone impatient enough to tap past a 4.5 s flight was never
    // seeing the roll at all. A tap now cuts to the landing and the ball bounces and runs from
    // there; a second tap, once it is on the ground, ends the shot.
    if (roll > 0 && el < this.anim.dur) {
      this.anim.t0 = performance.now() - this.anim.dur;
      return;
    }
    this.anim.t0 = performance.now() - this.anim.dur - roll - 1;   // also skips any windup left
  }

  /** Score name for a hole, the way a scorecard says it. */
  _scoreName(strokes, par) {
    if (strokes === 1) return t('score_ace');
    const d = strokes - par;
    if (d <= -3) return t('score_albatross');
    if (d === -2) return t('score_eagle');
    if (d === -1) return t('score_birdie');
    if (d === 0) return t('score_par');
    if (d === 1) return t('score_bogey');
    if (d === 2) return t('score_double');
    return t('score_over', { n: d });
  }

  /** REAL SCORECARD NOTATION. Matt, 2026-09-06: *"Look up real golf scorecards. There's already a
   *  system. square for bogey, circle for birdie, double circle for eagle, etc."*
   *
   *  He is right and it is worth spelling out, because the convention is about PAR and not about
   *  the raw number - which is the whole reason it works on a card where every hole has a
   *  different par. It is drawn around the score, never instead of it: the digit still reads
   *  normally and the shape is what a golfer's eye counts down the column.
   *
   *      <= -3   triple circle    albatross or better
   *         -2   double circle    eagle
   *         -1   circle           birdie
   *          0   nothing          par
   *         +1   square           bogey
   *         +2   double square    double bogey
   *      >= +3   triple square    triple bogey or worse
   *
   *  The middle five rows are the standard notation printed on real cards and are the ones Matt
   *  named. The two outer rows are this game EXTENDING the same pattern one ring further: real
   *  cards vary at those extremes and several simply stop at double, so there is no single
   *  convention to clone. An ace takes whatever its par says (a 1 on a par 3 is a birdie, one
   *  ring), because the notation is relative to par and marking it as an eagle would be wrong.
   *
   *  Returns the number of rings and their shape; the rings themselves are CSS (`--gf-mark`),
   *  because three nested borders are three boxes and a box is the one thing CSS is good at. */
  _scoreMark(strokes, par) {
    if (!Number.isFinite(strokes) || !Number.isFinite(par)) return '';
    const d = strokes - par;
    if (d <= -3) return 'c3';
    if (d === -2) return 'c2';
    if (d === -1) return 'c1';
    if (d === 0) return '';
    if (d === 1) return 's1';
    if (d === 2) return 's2';
    return 's3';
  }

  /** THE HOLE IS OVER, AND THE GAME SAYS SO. Matt: "I just holed out and nothing at all happened.
   *  Nothing saying my score, nothing asking if i wanted to play the next hole... It didn't even
   *  indicate that i had finished the hole."
   *
   *  The full sunburst banner and the nine-column scorecard are Stage C; this is the honest
   *  minimum in the meantime - it names the score, shows the card so far, and offers the next
   *  hole. It gets a close (X) top-right, per the repo's win/lose popup rule. */
  /** Has this hole used its whole allowance? `shotN - 1` shots have been played. */
  _capReached() {
    return !!(this.hole && !this.holed && this.shotN - 1 >= maxStrokes(this.hole.par));
  }

  /** THE PLAYER PICKS UP. Same beat as holing out (700 ms, so the ball is seen to stop before the
   *  card arrives), same result card, and the score is the cap - never the stroke count that
   *  overshot it, which a penalty can push past the cap by one.
   *
   *  It is a separate flag rather than "strokes = min(shotN, cap)" because the CARD has to be able
   *  to say what happened. A 9 that reads "Double bogey" when the player never holed out is the
   *  game quietly claiming a shot they did not play. */
  _pickUp() {
    if (this.pickedUp) return;
    this.pickedUp = true;
    this._paintHud();
    // THE LESSON'S 'holed' STEP IS "THE HOLE IS OVER", NOT "THE BALL WENT IN". The tutorial hole is
    // a par 4, so its cap is 9 - reachable by a first-time player, which is exactly who is on it.
    // Without this the lesson's `sink` step would wait for a ball that is never going to drop and
    // the tutorial would stall on the one hole it cannot afford to stall on.
    this._coach('holed');
    // SAVE BEFORE THE BEAT. `_settleShot` returns here without reaching its own `_saveRound`, so
    // without this the shot that hit the cap is not on disk and a kill inside the next 700 ms
    // rewinds the player one shot. It also puts `shotN` past the allowance in the file, which is
    // what `_resumeSaved`'s own cap check reads to finish the hole instead of re-offering it.
    this._saveRound();
    setTimeout(() => { if (!this.destroyed) this._showHoleResult(); }, 700);
  }

  /** The hole is over. Show what it cost, the card so far, and the way onward.
   *
   *  On the LAST hole of a scored round this is also where the round is written to the player's
   *  stats - once, and only if every hole in it has a score. See `_recordRound`. */
  _showHoleResult() {
    const hole = this.hole;
    // THE STROKE COUNT IS `shotN`, NOT `shotN - 1`, AND THE OFF-BY-ONE WAS REAL.
    //
    // Matt, with a screenshot: the HUD read "shot 4" on a par 5 and the card said "Eagle! Holed
    // in 3". `_settleShot` returns EARLY when the ball drops - it has to, so the hole ends - and
    // that early return is above the `shotN += 1`, so the shot that goes in is never counted.
    // `shotN` is therefore already the number of the shot just played, and subtracting one threw
    // it away. Every score in the game was a stroke too low; an ace would have reported 0.
    //
    // This function is only ever called from the holed path (`_settleShot`'s setTimeout), so
    // "the shot just played" and "the shot that holed it" are the same shot, always.
    // THE CAP IS THE SCORE WHEN THE PLAYER PICKED UP (2026-09-09, `maxStrokes` in rounds.js). It is
    // not `min(shotN, cap)`: a water penalty can push `shotN` past the cap by one, and the hole is
    // worth its allowance, not whatever the counter happened to reach.
    const strokes = this.pickedUp ? maxStrokes(hole.par) : this.shotN;
    this.scores[this.pos] = strokes;

    const d = strokes - hole.par;
    if (strokes === 1) this.roundStats.aces += 1;
    else if (d === -2) this.roundStats.eagles += 1;
    else if (d === -1) this.roundStats.birdies += 1;
    this.roundStats.points += stablefordPoints(strokes, hole.par);

    const practice = this.roundId === 'practice';
    const last = practice || this.pos >= this.holeIdxs.length - 1;
    // THE HOLE RECORD IS WRITTEN AS THE HOLE FINISHES, not with the round. Matt, 2026-09-05:
    // *"we'll have individual hole records"*. Writing it here rather than in `_recordRound` is what
    // makes a hole record survive a round that is ABANDONED - you played the hole, you made the
    // score, and it would read as deleted if quitting on the twelfth threw away the ace you made
    // on the third (THE LAW rule 1). It is also why a PRACTICE hole sets one: a hole is a hole.
    // The round best is a separate, stricter thing and keeps its complete-round guard below.
    // WHAT THIS ROUND JUST OPENED, read off the ladder rather than announced by whoever wrote the
    // score. `progress.js` derives every unlock from the stored record, so the honest way to know
    // what changed is to ask it either side of the write - which also means the card can never
    // claim an unlock the setup screen will not then show.
    const openBefore = this._unlockedIds();
    this._recordHole(hole, strokes);
    if (last && !practice) this._recordRound();
    // The score for THIS hole is now in `this.scores`, so the save has to move before the card
    // goes up: the card is a place a player leaves the app from, and the hole they just finished
    // must not have to be played twice. `_recordRound` has already cleared the save if the round
    // ended here, and `_saveRound` returns early once `recorded` is set, so this cannot resurrect
    // a round that is already banked.
    this._saveRound();
    const gained = this._unlockedIds().filter((id) => !openBefore.includes(id));
    const unlockedNow = gained.length
      ? t('unlocked_now', { range: gained.map((id) => roundRange(id)).join(', ') })
      : '';

    const played = this.scores.filter((v) => Number.isFinite(v));
    const parSoFar = this.holeIdxs
      .filter((_, i) => Number.isFinite(this.scores[i]))
      .reduce((a, i) => a + this.course.holes[i].par, 0);
    const toPar = played.reduce((a, v) => a + v, 0) - parSoFar;
    const toParTxt = toPar === 0 ? t('to_par_even')
      : toPar < 0 ? t('to_par_under', { n: -toPar }) : t('to_par_over', { n: toPar });

    const el = document.createElement('div');
    el.className = 'gf-result';
    el.innerHTML = `
      <div class="gf-result__card gf-panel">
        <button type="button" class="gf-result__x" data-role="res-close" aria-label="${esc(t('back'))}">&times;</button>
        <div class="gf-result__name">${esc(this.tutorialRun ? t('tut_complete')
    : last && !practice ? t('round_done')
      : this.pickedUp ? t('picked_up') : this._scoreName(strokes, hole.par))}</div>
        <div class="gf-result__sub">${esc(this.pickedUp
    ? t('picked_up_in', { n: strokes })
    : t('holed_in', { n: strokes }))} &middot; ${esc(t('par_n', { n: hole.par }))}</div>
        ${practice ? '' : `<div class="gf-result__card-grid" data-n="${this.holeIdxs.length}">
          ${this.holeIdxs.map((hi, i) => {
            const sc = this.scores[i];
            const mark = this._scoreMark(sc, this.course.holes[hi].par);
            return `<div class="gf-cell${i === this.pos ? ' is-now' : ''}">
            <span>${this.course.holes[hi].n}</span>
            <b><i class="gf-mark${mark ? ` is-${mark}` : ''}">${Number.isFinite(sc) ? sc : '-'}</i></b></div>`;
          }).join('')}
        </div>`}
        <div class="gf-result__total">${esc(toParTxt)}</div>
        ${this.tutorialRun ? `<div class="gf-result__best">${esc(t('tut_unlocked'))}</div>` : ''}
        ${this.newBest ? `<div class="gf-result__best">${esc(t('saved_best'))}</div>` : ''}
        ${unlockedNow && !this.tutorialRun ? `<div class="gf-result__best">${esc(unlockedNow)}</div>` : ''}
        <div class="gf-actions">
          ${last ? `<button type="button" class="gf-btn" data-role="res-done"><span>${esc(t('finish'))}</span></button>`
    : `<button type="button" class="gf-btn" data-role="res-next"><span>${esc(t('next_hole'))}</span></button>`}
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    // LEAVING FROM HERE ABANDONS THE ROUND TOO, so it asks the same question the quit button does.
    // On the last hole `isInProgress()` is already false (every score is in), so `finish` still
    // closes in one tap; mid-round the prompt goes on TOP of this card, and cancelling leaves the
    // card where it was rather than stranding the player on a hole they have already holed out.
    const onCard = this.coach && this.coach.step && this.coach.step.advance === 'result-closed';
    const close = onCard
      ? () => { el.remove(); this._coach('result-closed'); }
      : () => this._quit(() => el.remove());
    this._on(el.querySelector('[data-role="res-close"]'), 'click', close);
    const done = el.querySelector('[data-role="res-done"]');
    if (done) this._on(done, 'click', close);
    const next = el.querySelector('[data-role="res-next"]');
    if (next) {
      this._on(next, 'click', () => { el.remove(); this.pos += 1; this._enterHole(); });
    }
  }

  /**
   * Write ONE finished round to the player's stats. THE LAW governs every line of this.
   *
   *  - IT ONLY RUNS ON A COMPLETE ROUND. Every hole in the round must carry a score. Recording a
   *    round abandoned after three of eighteen holes would store 12 strokes as an EIGHTEEN-hole
   *    best, and because bests only ever improve (rule 2) that wrong number could never be
   *    corrected by playing better - it would sit at the top of the leaderboard for ever.
   *  - IT ONLY RUNS ONCE. `recorded` guards a re-entry through the close button or a re-shown card.
   *  - THE KEY IS THE ROUND, NOT THE COURSE. `pinevalley9` and `pinevalley18` are different
   *    measurements and are never merged or compared (rule 4).
   *  - IT WRITES STROKES. The leaderboard and My Stats subtract par at DISPLAY time; a to-par
   *    number in the store would be a fabricated conversion the moment par ever changed (rule 4).
   *  - THE DIFFICULTY BUCKET IS THE COURSE ID, following Skeeball's board-as-difficulty precedent
   *    (js/game-stats.js). Golf has no computer opponent and no difficulty setting, so the course
   *    is the only honest axis; `js/difficulty-tiers.js` maps it to no tier and weights it 1.0,
   *    exactly as it does a Skeeball machine.
   *  - A FAILED WRITE IS NOT SILENT (rule 6): the recorder itself queues and replays, and this
   *    verifies by fresh re-read and logs loudly if the best did not land.
   */
  /** Starting anything else throws the saved round away, so it says so first. Only asks when there
   *  is actually a save - which is never for a practice hole or the tutorial, and never once a
   *  round has been recorded. */
  _askDiscard(go) {
    if (!readSave()) { go(); return; }
    const el = document.createElement('div');
    el.className = 'gf-result';
    el.innerHTML = `
      <div class="gf-result__card gf-panel">
        <button type="button" class="gf-result__x" data-role="d-no" aria-label="${esc(t('quit_no'))}">&times;</button>
        <div class="gf-result__name">${esc(t('discard_title'))}</div>
        <div class="gf-result__sub">${esc(t('discard_body'))}</div>
        <div class="gf-actions">
          <button type="button" class="gf-btn" data-role="d-no"><span>${esc(t('discard_no'))}</span></button>
          <button type="button" class="gf-btn" data-role="d-yes"><span>${esc(t('discard_yes'))}</span></button>
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    for (const b of el.querySelectorAll('[data-role="d-no"]')) this._on(b, 'click', () => el.remove());
    this._on(el.querySelector('[data-role="d-yes"]'), 'click', () => {
      el.remove(); this._clearRound(); go();
    });
  }

  /** SNAPSHOT THE ROUND. Called on every beat that changes any of it and at no other time: the
   *  start of a round, entering a hole, a ball coming to REST, and a hole being scored.
   *
   *  AT REST is the load-bearing half of that list. `this.ball` while `this.anim` is running is a
   *  point on a flight path, so a save taken mid-shot would restore the ball into the air as if it
   *  were lying there. Every call site below is a settled state.
   *
   *  Practice and the tutorial are skipped by construction - see the header block on `readSave`. */
  _saveRound() {
    if (!this.hole || this.recorded || !this.roundId || this.roundId === 'practice') return false;
    this.saveOk = writeSave({
      v: SAVE_V,
      courseId: this.course.id,
      roundId: this.roundId,
      holeIdxs: this.holeIdxs.slice(),
      pos: this.pos,
      // `scores` is sparse while a round is in play (holes not reached have no entry) and JSON
      // turns a hole in an array into `null`, which is exactly what `readSave` accepts back.
      scores: this.holeIdxs.map((_, i) => (Number.isFinite(this.scores[i]) ? this.scores[i] : null)),
      roundStats: { ...this.roundStats },
      shotN: this.shotN,
      ball: [this.ball[0], this.ball[1]],
      aimRad: this.aimRad,
      clubId: this._activeClub().id,
      at: Date.now(),
    });
    return this.saveOk;
  }

  /** Drop the save. ONLY after `_recordRound` has succeeded, or when the player has explicitly
   *  chosen to start something else. Clearing it when the ROUND ends rather than when the WRITE
   *  lands is the mistake `js/game-stats.js`'s drain/clear split exists to document: the two look
   *  equivalent and differ in precisely the case the mechanism is for. */
  _clearRound() { this.saveOk = false; writeSave(null); }

  /** Put a saved round back on the screen. Returns false if there was nothing usable.
   *
   *  THE HOLE AT `pos` DECIDES WHICH OF TWO THINGS THIS IS. If it already has a score, the app was
   *  killed while the hole's result card was up - so the honest restore is the NEXT hole from its
   *  tee, not that hole replayed with the ball sitting in the cup. If every hole has a score the
   *  round was finished and only the WRITE was lost, so it is written now (that is the whole point
   *  of clearing on the write rather than on the round's end) and the player is put back on the
   *  setup screen with their result banked. */
  _resumeSaved() {
    const sv = readSave();
    if (!sv) return false;
    this.course = sv.course;
    this.settings.lastCourse = sv.course.id;
    this.settings.lastRound = sv.round.id;
    this.settings.lastMode = sv.round.mode;
    saveSettings(this.settings);
    this.roundId = sv.round.id;
    this.holeIdxs = sv.holeIdxs.slice();
    this.scores = sv.scores.map((v) => (Number.isFinite(v) ? v : undefined));
    this.roundStats = { ...sv.roundStats };
    this.recorded = false;
    this.newBest = false;
    this.tutorialRun = false;
    this.pos = sv.pos;

    if (isComplete(sv)) {
      this.hole = this.course.holes[this.holeIdxs[this.pos]];
      this._recordRound();
      this.hole = null;
      if (this.recorded) this._clearRound();
      this._renderSetup();
      return true;
    }
    if (resumePos(sv) !== sv.pos) {
      this.pos = resumePos(sv);
      this._enterHole();
      return true;
    }
    // MID-HOLE. `_enterHole` builds the hole from its tee, then the four things the player had
    // actually changed are put back over the top of it. The order matters: the club is set before
    // `_syncTempo`, because the swing's tempo is per club and a putter restored at driver tempo
    // would move the needle under the player's thumb on their very first tap back.
    this._enterHole();
    this.ball = [sv.ball[0], sv.ball[1]];
    this.shotN = sv.shotN;
    this.aimRad = sv.aimRad;
    // THE 700 ms BETWEEN THE CAP AND THE CARD IS A REAL WINDOW. `_pickUp` waits that long so the
    // ball is seen to stop, and the save was written when it came to rest - with `shotN` already
    // past the allowance. Restoring that literally would hand the player a shot the cap says does
    // not exist, so the hole is finished here instead of being re-offered.
    if (this._capReached()) { this._pickUp(); return true; }
    const c = sv.clubId ? clubById(sv.clubId) : null;
    if (c) this.club = c;
    this._syncTempo();
    // No flyover on a resume: the player has seen this hole, and they are standing in the middle
    // of it rather than on the tee, so the camera should simply be where the ball is.
    this.intro = null;
    this._aimCamera(true);
    this._paintHud();
    // RE-SAVE, AND THIS LINE IS NOT OPTIONAL. `_enterHole` above puts the ball on the TEE and saves
    // that, so without this the file on disk says "hole 1, shot 1, at the tee" the moment a round
    // is resumed - and a second kill would hand the player back a round they had already replayed
    // part of. Found by driving it: one shot, reload, resume, and the save had silently rewound.
    this._saveRound();
    return true;
  }

  _recordRound() {
    if (this.recorded || this.roundId === 'practice') return;
    if (this.holeIdxs.some((_, i) => !Number.isFinite(this.scores[i]))) return;
    this.recorded = true;
    const key = roundKey(this.course, this.roundId);
    const strokes = this.scores.reduce((a, v) => a + v, 0);
    const before = this._storedBest(key);
    try {
      recordGolf(this.course.id, {
        courseId: key,
        holes: this.holeIdxs.length,
        strokes,
        points: this.roundStats.points,
        birdies: this.roundStats.birdies,
        eagles: this.roundStats.eagles,
        aces: this.roundStats.aces,
        longestDriveYd: Math.round(this.roundStats.longestDriveYd),
      });
    } catch (e) {
      console.error('[golf] recording the round FAILED', e);
      return;
    }
    const after = this._storedBest(key);
    if (!Number.isFinite(after) || after > strokes) {
      console.error(`[golf] the round did not land: ${key} reads ${after} after writing ${strokes}`);
    }
    this.newBest = Number.isFinite(after) && (!Number.isFinite(before) || after < before);
    // THE SAVE GOES NOW, NOT WHEN THE ROUND ENDED. The round is on disk; there is nothing left to
    // resume. Clearing it any earlier - at the last putt, say - would drop the round in exactly
    // the case the save exists for, which is `js/game-stats.js`'s drain/clear lesson.
    this._clearRound();
  }

  /** Every round of the CURRENT course that is open to this player right now, as round ids. Used
   *  either side of a write to say what a score just unlocked. */
  _unlockedIds() {
    try {
      const gf = this._gf();
      const c = courseById(this.settings.lastCourse || COURSES[0].id);
      return roundsFor(c).filter((r) => roundState(c, r.id, gf).unlocked).map((r) => r.id);
    } catch { return []; }
  }

  /** One hole's own record. Additive and Math.min inside the recorder; a failed write is queued
   *  and replayed by `recordGolf` itself, exactly as a round's is. */
  _recordHole(hole, strokes) {
    if (!Number.isFinite(strokes) || strokes <= 0) return;
    try {
      recordGolf(this.course.id, {
        holeOnly: true, holeScores: { [holeKey(this.course, hole.n)]: strokes },
      });
    } catch (e) {
      console.error('[golf] recording the hole record FAILED', e);
    }
  }

  _storedBest(key) {
    try {
      const st = loadStats();
      const v = ((((st.games || {}).golf || {}).gf || {}).bestRoundByCourse || {})[key];
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  }

  _settleShot() {
    const a = this.anim;
    this.anim = null;
    // A look-around DURING the shot ends with the shot. Holding it would leave the next address
    // framed on wherever the player was watching from, which is not where their ball is now.
    if (this.previewDx || this.previewDy) {
      this.previewDx = 0; this.previewDy = 0; this.returning = false;
      this.el.tc.setAttribute('data-faded', '0');
    }
    // WHERE THE SHOT WAS STRUCK FROM IS `a.from`, NOT `this.ball` (2026-09-06).
    //
    // This used to read `const from = this.ball`, and both callers in `_frame` do
    // `this.ball = [...ballPos]; this._settleShot();` - so `this.ball` had ALREADY been moved to
    // the landing point before it was read as the starting point. `lastShotYd` therefore measured
    // a point against itself and the ring's hub printed **0.0 ft on every shot of every round**,
    // which is what Matt's test-hole video shows from the first frame to the last. One of the
    // reference's two numbers had never once worked.
    //
    // The address position is carried on the ANIMATION, which is the only thing that still knows
    // it once the ball has moved. `golferAt` needs exactly the same value and already had this
    // problem (see "The golfer stands still"), so there is now one field both read.
    const from = a.from || this.ball;
    this.ball = [...a.res.rest];
    // THE HUB READOUT IS THE DISTANCE THE LAST SHOT TRAVELLED, and it is set HERE, when the ball
    // comes to rest. It used to be set in _fire(), which meant the third tap printed how far the
    // ball was ABOUT to go before it had gone anywhere - the ring told you the outcome while you
    // were still watching the flight (Matt's playtest, 2026-09-04).
    this.lastShotYd = distYd(from, a.res.rest);
    // LONGEST DRIVE is a lifetime best in the stored shape, so it is measured where a golfer
    // measures one: the TEE SHOT, and only when it was actually a driver. A holed 4 iron from the
    // fairway is not a drive, however far it went.
    if (this.roundStats && this.shotN === 1 && a.type === 'flight' && a.club && a.club.id === 'driver') {
      this.roundStats.longestDriveYd = Math.max(this.roundStats.longestDriveYd, this.lastShotYd);
    }
    // Any shot can be holed, not just a putt: a pitch that drops, a wood that rolls in.
    if (a.res.holed) {
      this.holed = true;
      this.swing.settle(performance.now());
      this._paintHud();
      this._coach('holed');
      setTimeout(() => { if (!this.destroyed) this._showHoleResult(); }, 700);
      return;
    }
    this.shotN += 1 + ((a.res && a.res.penalty) || 0);
    this.swing.settle(performance.now());
    // DOUBLE PAR PLUS ONE, AND THE HOLE ENDS THERE. See `maxStrokes` in rounds.js for the rule and
    // why it is real golf rather than an arbitrary limit. `shotN` is the number of the shot about
    // to be played, so `shotN - 1` is how many have been used - and a water penalty can add two at
    // once, which is why this is `>=` and the score is the cap rather than whatever shotN reached.
    if (this._capReached()) { this._pickUp(); return; }
    // A LESSON CARD WAITS FOR THE BALL TO HAVE STOPPED, not for the frame it stops ON.
    //
    // Matt: "The club thing should only pop up once the ball has stopped moving." Measured at
    // frame rate before the fix: the coach stepped at 17898 ms and the animation ended at 17898 -
    // the SAME FRAME. The card was arriving on top of a ball that had, that instant, been rolling;
    // the camera is still easing in for another 245 ms after that, so the whole scene is moving
    // under a card that has just appeared. Nothing is wrong with the numbers - there is simply no
    // beat between the shot finishing and the lesson speaking.
    //
    // The DELAY IS ON THE LESSON, NOT ON THE GAME. `shotN`, the auto-pick, the HUD, the banner and
    // the drop prompt all still land on the settling frame, so nothing about playing the hole is
    // slowed down; only the coach waits. `SETTLE_CARD_MS` matches the 700 ms the holed path
    // already waits before its result card, so the two beats in the game are the same beat.
    // `on-green` goes with it, in the same order, or the putting popup would overtake the card
    // that comes before it.
    // THE PUTTING LESSON FIRES WHEREVER THE PUTTER IS FORCED ON YOU, not only on the green itself.
    // Matt: *"the putting one didn't popup now when i'm putting from the fringe. It gave me the
    // putter, but the clues didn't come up."* `mustPutt` is the predicate that HANDED him the
    // putter (green or fringe), and the lesson was testing a narrower one - so the collar gave him
    // a club he had not been taught and no card explaining it. It still is not `settled`: the
    // fairway and the rough do not force a putter, so a card there would tell a player standing in
    // the fairway to putt. See golf/js/tutorial.js.
    const onGreen = mustPutt(this._lie());
    setTimeout(() => {
      if (this.destroyed || !this.coach) return;
      this._coach('settled');
      // ON THE PUTTING SURFACE, which is a different question from "the ball stopped". The lesson
      // spans a par 4, so the approach may take one shot or three; a putting card fired on
      // `settled` would tell a player standing in the fairway to putt. See golf/js/tutorial.js.
      if (onGreen) this._coach('on-green');
    }, SETTLE_CARD_MS);
    this.aimRad = this._bearingToPin();
    this.club = autoSelectClub(this._distToPin(), this._lie());
    this._syncTempo();
    this._paintHud();

    // THE PLAYER IS TOLD WHAT THE HAZARD COST, AND ASKED WHEN THERE IS SOMETHING TO ASK.
    // golf-reference-spec.md 21.2: the reference banners the trouble ("In the trees") and then
    // puts up a modal with two stacked buttons - take a drop, or play it as it lies. Ours had
    // neither: a ball in the water was moved and a stroke added with nothing on screen saying so,
    // and a ball in the trees was simply yours to deal with.
    if (a.res && a.res.penalty) this._showBanner(t('in_water'), t('penalty_stroke'));
    else if (this._lie() === 'trees') this._showDropPrompt();
    // THE BALL IS AT REST HERE, which is the only state worth snapshotting: `this.ball` while
    // `this.anim` runs is a point on a flight path, and a save taken then would restore the ball
    // into mid-air as if it were lying there.
    this._saveRound();
  }

  /** The no-choice case: name what happened and clear itself. There is no button because there is
   *  nothing to decide - a ball in the lake cannot be played from the lake. */
  _showBanner(name, sub) {
    const el = document.createElement('div');
    el.className = 'gf-banner';
    el.innerHTML = `<b>${esc(name)}</b><span>${esc(sub)}</span>`;
    this.rootEl.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 2500);
  }

  /** The choice case. A ball in the trees is playable, so the player gets the reference's two
   *  buttons rather than a rule applied over their head. A drop costs a stroke and goes through
   *  the SAME `dropNear` the water rule uses, so both kinds of drop land by one set of numbers. */
  _showDropPrompt() {
    if (this.dropEl) return;
    const el = document.createElement('div');
    el.className = 'gf-drop';
    el.innerHTML = `
      <div class="gf-drop__card gf-panel">
        <div class="gf-drop__name">${esc(t('in_trees'))}</div>
        <div class="gf-drop__q">${esc(t('drop_q'))}</div>
        <div class="gf-drop__cost">${esc(t('drop_costs'))}</div>
        <div class="gf-drop__actions">
          <button type="button" class="gf-btn" data-role="drop-take"><span>${esc(t('take_drop'))}</span></button>
          <button type="button" class="gf-btn" data-role="drop-play"><span>${esc(t('play_from_lie'))}</span></button>
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    this.dropEl = el;
    const close = () => { if (this.dropEl) { this.dropEl.remove(); this.dropEl = null; } };
    this._on(el.querySelector('[data-role="drop-play"]'), 'click', close);
    this._on(el.querySelector('[data-role="drop-take"]'), 'click', () => {
      // Out of the trees AND never into the water; a stroke either way.
      const moved = dropNear(this.hole, this.ball, (k) => k === 'trees' || k === 'water');
      if (moved) {
        this.ball = [...moved.rest];
        this.shotN += 1;
        this.aimRad = this._bearingToPin();
        this.club = autoSelectClub(this._distToPin(), this._lie());
        this._syncTempo();
        this._aimCamera(false);
        this._paintHud();
        this._saveRound();          // the drop moved the ball and cost a stroke: both are state
      }
      close();
    });
  }

  // ---------------------------------------------------------------- painting ----
  _paintHud() {
    if (!this.el || !this.hole) return;
    const lie = this._lie();
    const L = lieOf(lie);
    this.el.par.textContent = t('par_n', { n: this.hole.par });
    this.el.shot.textContent = t('shot_n', { n: this.shotN });
    // THE LESSON IS NOT A PRACTICE HOLE, AND THE HUD SAID IT WAS. It runs as `roundId:
    // 'practice'` (one hole, no `bestRoundByCourse` write), which is right for the recorder and
    // wrong for the label: the result card says "Tutorial complete" while the panel three inches
    // above it read "practice" for the whole lesson.
    this.el.mode.textContent = this.tutorialRun
      ? t('mode_tutorial')
      : this.roundId === 'practice'
        ? t('mode_practice')
        : `${t(roundById(this.roundId).labelKey)} ${this.pos + 1}/${this.holeIdxs.length}`;
    this.el.holeno.textContent = String(this.hole.n);
    // The lie is a PICTURE of the surface now, not the word. The name stays on the aria-label.
    if (this._lieArtFor !== lie) {
      this.el.lieart.innerHTML = lieArt(lie, paletteFor(this.course && this.course.theme));
      this._lieArtFor = lie;
    }
    this.el.lieart.setAttribute('aria-label', t(`lie_${lie}`));
    // AND THE LIE IS NAMED IN WORDS, NOT ONLY DRAWN (2026-09-08). Matt: *"The % power bar isn't
    // clear. It must say why. Rough, deep rough, bunker, etc."* The tile has been a PICTURE since
    // the reference measuring pass, with the word surviving only on the aria-label - so a `Power:
    // 82%` line appeared under it with nothing on screen saying what the 82 % was FOR.
    //
    // IT IS ITS OWN LINE, not appended to the percentage. That pairing was tried and reverted once
    // already ("on one line 'Heavy rough Power: 82%' grew wide enough to run into the flag and the
    // quit button" - visible in Matt's own playtest footage), and the longest string here is the
    // Spanish `Rough alto`, which is longer still.
    this.el.lie.textContent = t(`lie_${lie}`);
    // Every bad lie does two things and BOTH are shown before the swing: it caps distance, and it
    // narrows the accuracy band. The percentage is the cap; the band is drawn narrower.
    // TWO LINES, which is what the spec specified all along (§21.2: `Bunker` / `Power: 88%`).
    // On one line "Heavy rough Power: 82%" grew wide enough to run into the flag and the quit
    // button - visible in Matt's playtest footage.
    this.el.power.textContent = L.power < 1 ? t('power_pct', { n: Math.round(L.power * 100) }) : '';
    this.el.power.hidden = !(L.power < 1);

    // Yards off the green, FEET on it. The switch is on the SURFACE, not on a distance threshold:
    // that matches both of the reference's observations and needs no constant to guess at.
    const d = this._distToPin();
    const club = this._activeClub();
    const putting = club.id === 'putter';
    this.el.dist.textContent = putting
      ? `${(d * FT_PER_YD).toFixed(1)} ${t('ft')}`
      : `${d.toFixed(1)} ${t('yds')}`;

    this.el.clubart.innerHTML = clubArtSVG(club.id);
    this.el.clubname.textContent = t(`club_${club.id}`);
    // HOW FAR THIS CLUB GOES, ON THIS LIE, printed under its name. The reference's tile carries a
    // number and ours did not, so the only way to know what a 6 iron was worth here was to swing
    // it. It is the LIE-ADJUSTED full-power carry, so it drops as the lie worsens - which makes
    // the "Power: 82%" line above it something the player can act on rather than just read.
    this.el.clubyds.textContent = putting
      ? `${puttRangeFt().toFixed(0)} ${t('ft')}`
      : `${Math.round(club.carry * L.power)} ${t('yds')}`;

    // THE WIND. It is a constant for the hole (see shot.js's windFor), so this only has to be
    // painted when the hole changes - but it is painted here with everything else because a HUD
    // whose parts refresh on different schedules is how a panel ends up showing the last hole's
    // number. The arrow points where the wind BLOWS, which is the direction the ball is pushed.
    const w = windFor(this.hole);
    this.el.wind.textContent = w.speed.toFixed(1);
    this.el.windarrow.innerHTML = windArrow(w.bearing * (180 / Math.PI), !(w.speed > 0));
    // AND IT IS HIDDEN ON A PUTT. `shot.js` applies no wind to `simulatePutt` at all - deliberately,
    // because wind does not move a rolling ball meaningfully and it would make the break unreadable
    // - so a wind panel over a putt is a number that cannot affect anything the player is about to
    // do. Reading one and adjusting for it is worse than not having it.
    this.el.windpanel.hidden = this._putting();
    // The swing button's text is `_paintSwingLabel`'s, so that it can name WHICH TAP IS NEXT. This
    // only drops the cache, because the element is rebuilt on a re-render and on a language change.
    this._swingLabelKey = null; this._swingArmed = null;
  }

  /** Hold the free-look camera inside the hole. Without this the view scrolls off the map into
   *  flat colour, which is disorienting and offers no way back. */
  _clampPreview() {
    if (!this.cam) return;
    const b = this.hole.bounds;
    const spanX = b.maxX - b.minX;
    const minX = spanX <= this.cam.halfW * 2 ? (b.minX + b.maxX) / 2 : b.minX + this.cam.halfW;
    const maxX = spanX <= this.cam.halfW * 2 ? (b.minX + b.maxX) / 2 : b.maxX - this.cam.halfW;
    const minY = b.minY + this.cam.halfH;
    const maxY = b.maxY - this.cam.halfH;
    this.previewDx = Math.min(maxX, Math.max(minX, this.cam.x + this.previewDx)) - this.cam.x;
    this.previewDy = Math.min(maxY, Math.max(minY, this.cam.y + this.previewDy)) - this.cam.y;
  }

  _aimCamera(snap) {
    if (!this.cam) return;
    // THE VIEW TIGHTENS ON THE GREEN. A full shot is framed 95 yds across so the landing area and
    // both tree lines are visible; a putt is measured in FEET, and reading a 6 ft putt across
    // 95 yds of screen puts it in 2 % of the frame with a sub-pixel break. It eases between the
    // two rather than snapping, except on the first frame of a hole, so walking onto the green
    // reads as the camera coming down to you.
    const wantW = this._mustPutt() ? VIEW_W_GREEN_YDS : VIEW_W_YDS;
    this.cam.setWidth(snap ? wantW : this.cam.widthYds + (wantW - this.cam.widthYds) * 0.18);
    // The ball sits LOW in the frame so the player sees up the hole toward the green. 0.5 puts it
    // about a quarter of the way up the screen, which is what makes the aim ladder's far dots
    // reachable by eye rather than only by scrolling the preview.
    //
    // ON THE GREEN IT IS ALMOST CENTRED. That offset exists to show a fairway the ball is about to
    // fly up; a putt's target is a few feet away, so pushing the ball to the bottom of the frame
    // just spends the top half of the screen on whatever is behind the green.
    let want = this.ball[1] + this.cam.halfH * (this._mustPutt() ? 0.12 : 0.5);
    want = this._keepBallAndCupClear(want);
    this.cam.x = this.ball[0];
    this.cam.y = snap ? want : this.cam.y + (want - this.cam.y) * 0.18;
    this.cam.clamp();
  }

  /** THE HOLE IS NEVER UNDERNEATH THE CONTROLS. Matt, 2026-09-06: "the hole is behind the aim
   *  button or the power/aim meter... I need the hole to never be covered by the on screen
   *  controls or anything."
   *
   *  The HUD floats OVER a full-bleed canvas (that is the whole layout), so the course keeps
   *  drawing behind the aim row, the club tile and the swing button - and on the green, where the
   *  camera is nearly centred on the BALL, a cup a few feet the other side of it lands in that
   *  bottom band and is simply not visible.
   *
   *  The clear band is MEASURED from the HUD's own boxes rather than hardcoded, so it stays right
   *  when a panel changes size or a phone's safe area moves it. Returns a camera y that puts the
   *  cup inside the band; if the ball and the cup cannot both fit (they are further apart than the
   *  clear band is tall) the ball wins, because that is the one the player is about to hit. */
  _keepBallAndCupClear(wantY) {
    if (!this.cam || !this.el || !this.canvas) return wantY;
    const pin = this.hole.pin;
    // Only worth doing when the cup is actually in play for this shot; a pin 200 yds away is off
    // the top of a 95 yd frame whatever we do, and forcing it in would frame the wrong thing.
    const cupInPlay = distYd(this.ball, pin) <= this.cam.halfH * 1.6;
    const view = this.canvas.getBoundingClientRect();
    if (view.height < 8) return wantY;
    const M = 14;                                    // breathing room past the panel edge, px
    let top = 0;
    let bottom = view.height;
    for (const key of ['tl', 'tc', 'tr']) {
      const n = this.el[key];
      if (!n || n.hidden) continue;
      const r = n.getBoundingClientRect();
      if (r.height > 0) top = Math.max(top, r.bottom - view.top + M);
    }
    for (const key of ['bl', 'br']) {
      const n = this.el[key];
      if (!n || n.hidden) continue;
      const r = n.getBoundingClientRect();
      if (r.height > 0) bottom = Math.min(bottom, r.top - view.top - M);
    }
    if (bottom - top < view.height * 0.25) return wantY;   // nothing sane left to aim at
    // Screen y of a world y is (cam.y - Y) * ppy + height/2, so keeping a point inside
    // [top, bottom] is a range on cam.y.
    const half = view.height / 2;
    const lo = (y) => y + (top - half) / this.cam.ppy;      // lowest cam.y that keeps y above `top`
    const hi = (y) => y + (bottom - half) / this.cam.ppy;   // highest that keeps it above `bottom`
    const loBall = lo(this.ball[1]), hiBall = hi(this.ball[1]);
    if (cupInPlay) {
      const loBoth = Math.max(lo(pin[1]), loBall), hiBoth = Math.min(hi(pin[1]), hiBall);
      if (loBoth <= hiBoth) return Math.min(hiBoth, Math.max(loBoth, wantY));
    }
    // THE BALL ITSELF, on every shot, cup or no cup. `_aimCamera` puts it a fixed fraction of the
    // frame up from the bottom (0.5 x halfH) so the player can see up the hole - and on a phone
    // that fraction lands INSIDE the bottom HUD, so on a long hole the golfer stood behind the aim
    // button and the ball was drawn under the club tile. Matt's Pine Valley screenshots have the
    // ball off the bottom edge entirely with the aim line running out of shot. The fixed fraction
    // still decides the framing whenever it is legal; this only ever pulls it back into view.
    return Math.min(hiBall, Math.max(loBall, wantY));
  }

  _frame = () => {
    if (this.destroyed || !this.ctx || !this.cam) return;
    const now = performance.now();
    let height = 0;
    let ballPos = this.ball;

    // THE OPENING FLYOVER, before anything else can move the camera. It owns cam.x/cam.y outright
    // while it runs, so `_aimCamera` is skipped below rather than being allowed to fight it.
    if (this.intro) {
      if (!this.intro.t0) {
        this.intro.t0 = now;
        this.cam.setWidth(VIEW_W_YDS);
        this.cam.x = this.hole.pin[0];
        this.cam.y = this.hole.pin[1];
        this.cam.clamp();
        this.intro.from = [this.cam.x, this.cam.y];
        // The address pose this hands over to, computed once so the arrival is exact.
        this.intro.to = [this.ball[0], this.ball[1] + this.cam.halfH * 0.5];
        this.el.tc.setAttribute('data-faded', '1');
      }
      const el = now - this.intro.t0;
      const q = Math.min(1, Math.max(0, el - INTRO_HOLD_MS) / INTRO_MOVE_MS);
      const e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;   // ease in AND out
      this.cam.x = this.intro.from[0] + (this.intro.to[0] - this.intro.from[0]) * e;
      this.cam.y = this.intro.from[1] + (this.intro.to[1] - this.intro.from[1]) * e;
      this.cam.clamp();
      if (q >= 1) this._endIntro();
    }

    if (this.anim) {
      const el = now - this.anim.t0;
      // THE WINDUP. `t0` is when the BALL LEAVES, which is WINDUP_MS after the third tap, so `el`
      // is negative for the whole swing animation. Everything below reads `el` clamped at zero, so
      // the ball simply sits at address until the club actually reaches it.
      const winding = el < 0;
      const p = Math.min(1, Math.max(0, el) / Math.max(1, this.anim.dur));
      if (this.anim.type === 'flight') {
        const r = this.anim.res;
        const roll = r.rollMs || 0;
        if (el < this.anim.dur) {
          const f = flightPoint(p, r.carry * (r.blocked ? r.blocked.p : 1), r.sideYd * (r.blocked ? r.blocked.p : 1), r.apex);
          const cos = Math.cos(r.aimRad); const sin = Math.sin(r.aimRad);
          ballPos = [this.ball[0] + sin * f.along + cos * f.side, this.ball[1] + cos * f.along - sin * f.side];
          height = f.height;
        } else {
          // THE GROUND PHASE. Measured off the reference at 30 fps: the ball spends 3.4 s bouncing
          // and rolling against 2.7 s in the air, decaying in stages rather than stopping. Ours
          // used to jump straight to the rest position the instant it touched down, which is
          // exactly what Matt reported.
          const q = roll > 0 ? Math.min(1, (el - this.anim.dur) / roll) : 1;
          const dx = r.rest[0] - r.landing[0];
          const dy = r.rest[1] - r.landing[1];
          const len = Math.hypot(dx, dy);
          const g = groundPoint(q, len, r.apex, r.landedOn);
          const u = len > 0 ? g.along / len : 0;
          ballPos = [r.landing[0] + dx * u, r.landing[1] + dy * u];
          height = g.height;
        }
        // THE CAMERA LOCKS ON IN FLIGHT AND THEN TRAILS THE BALL THROUGH THE RUN-OUT.
        //
        // It used to stop DEAD at touchdown. That was the fix for "the ball rolls a tiny bit...
        // it stops unnaturally short" - with the camera glued to the ball, a run-out moves the
        // BALL zero pixels - and the diagnosis was right but the remedy overshot. Measured across
        // the four whole-hole clips (2026-09-04): the reference's camera keeps moving after the
        // ball lands and DECELERATES WITH IT, the changed-pixel count per frame decaying 75k ->
        // 36k -> 18k -> 0 over the last 1.7 s of a drive. It does not stop and it does not stay
        // glued either.
        //
        // A trailing lerp is both at once: the ball pulls ahead in the frame, so the run-out is
        // plainly visible, and the camera closes the gap as the ball slows, so it finishes
        // centred and never leaves the ball behind. The ball also runs a good deal further than
        // it used to (clubs.js's roll went 0.08 -> 0.145 from the same footage), which is the
        // other half of what Matt was reporting.
        const camY = ballPos[1] + this.cam.halfH * 0.2;
        if (winding) {
          /* the camera holds on the ball through the swing animation */
        } else if (el < this.anim.dur) {
          this.cam.x = ballPos[0];
          this.cam.y = camY;
          this.cam.clamp();
        } else {
          this.cam.x += (ballPos[0] - this.cam.x) * 0.055;
          this.cam.y += (camY - this.cam.y) * 0.055;
          this.cam.clamp();
        }
        if (el >= this.anim.dur + roll) { this.ball = [...ballPos]; this._settleShot(); this._aimCamera(false); }
      } else {
        // The camera does NOT move during a putt. Confirmed frame by frame in the reference, and
        // it is right: a static frame is what lets the player read the break they just played.
        const path = this.anim.res.path;
        ballPos = winding ? this.ball : path[Math.min(path.length - 1, Math.floor(p * (path.length - 1)))];
      }
      if (this.anim && this.anim.type === 'putt' && p >= 1) { this.ball = [...ballPos]; this._settleShot(); this._aimCamera(false); }
    } else {
      // THE SWING CAN RUN OUT OF WINDOW. If the needle comes all the way down and off the bottom
      // of the accuracy bar with no third tap, the shot goes anyway, at the worst accuracy the
      // bar can express - the alternative is a swing that hangs there for ever waiting for a tap
      // the player has already failed to make.
      // THE LESSON HAS TO HEAR THIS ONE TOO. The swing fires itself when the needle runs off the
      // bottom of the bar with no third tap; without telling the coach, the "tap a third time" step
      // would wait for ever on a tap the player has already failed to make.
      if (this.swing.read(now).expired) {
        this.swing.tap(now); this._fire(); this._coach('fire'); this._paintHud();
      }
      if (!this.intro) this._aimCamera(false);
    }

    // THE FREE LOOK HOLDS WHERE YOU LEAVE IT. It used to ease back the instant the finger lifted,
    // which gave about half a second to look at a green 200 yds away - Matt: "it still does not
    // let me move around the map of the hole. It doesn't let me see where the driver will land."
    // The reference player scrolls up to the green and studies it for twelve seconds.
    //
    // It returns to the ball on a TAP (a press that did not drag), or when a swing begins.
    if (!this.dragging && this.returning) {
      this.previewDx *= 0.78; this.previewDy *= 0.78;
      if (Math.abs(this.previewDx) < 0.08) this.previewDx = 0;
      if (Math.abs(this.previewDy) < 0.08) this.previewDy = 0;
      if (this.previewDx === 0 && this.previewDy === 0) this.returning = false;
    }
    const drawCam = { ...this.cam, x: this.cam.x + this.previewDx, y: this.cam.y + this.previewDy };

    const putting = this._putting();
    // The golfer stands at the ball whenever the ball is at rest, and plays its swing poses
    // through the stroke. It is hidden while the ball is in the air or rolling.
    // The windup (WINDUP_MS before `anim.t0`) is where the swing pose earns its keep: it is the
    // 0.85 s the reference spends between the third tap and the ball leaving, so the golfer plays
    // through it on BOTH a full shot and a putt rather than the ball simply teleporting.
    // THE GOLFER'S ANIMATION, MEASURED FRAME BY FRAME (2026-09-04, clip 3 at 60 fps, tracking
    // both the cap's centroid and the changed-pixel count over a 130x190 crop around him):
    //
    //   frames 770-814   IDENTICAL. 4-6 px of noise a frame, cap centroid to two decimals the
    //                    same in all 45. The golfer is a STATIC SPRITE through the entire swing
    //                    meter and for 265 ms after the third tap.
    //   frames 815-820   the swing: four big-change frames (924, 747, 1192, 953 px) with
    //                    near-static frames between them, so it is four sprites over ~100 ms.
    //   frames 821-846   STATIC AGAIN, at a new pose, held for ~440 ms.
    //   frame  847       the camera starts panning; the ball is away at 850.
    //
    // Two things ours got wrong and both are fixed here. It played the backswing pose during the
    // METER (the reference golfer does not move at all until 265 ms after the third tap), and it
    // then held the through-swing for the whole windup with no still period and no backswing at
    // all - so there was no swing to watch, just a pose change.
    const tRel = this.anim ? now - this.anim.t0 : null;   // negative through the windup
    let swingPose = 0;
    if (tRel !== null) {
      const intoWindup = WINDUP_MS + tRel;                // 0 at the third tap, WINDUP_MS at impact
      if (intoWindup < POSE_STILL_MS) swingPose = 0;
      else if (intoWindup < POSE_STILL_MS + POSE_BACK_MS) swingPose = 1;
      else if (intoWindup < POSE_STILL_MS + POSE_BACK_MS + POSE_THRU_MS) swingPose = 2;
      else swingPose = 3;                                 // the finish, held
    }

    drawFrame(this.ctx, this.map, this.hole, drawCam, {
      dpr: this.dpr,
      ball: ballPos,
      height,
      holed: this.holed,
      // THE GOLFER STANDS WHERE THE BALL WAS, NOT WHERE THE BALL IS. Matt: "when i swing, then
      // the cartoon golfer animation swing thing happens, the little guy runs forward. it's very
      // strange. He shouldn't move location on the screen." He was drawn at `st.ball`, which is
      // the LIVE ball - so for the 260 ms after impact he was re-drawn at the flying ball's
      // position every frame and slid down the fairway with it. `this.ball` is not touched until
      // _settleShot, so it IS the address position for the whole animation.
      //
      // He is not hidden any more either. The reference keeps drawing him as the camera pans away
      // (measured: at frame 847+ the cap tracks steadily off screen at ~1.9 px a frame while the
      // camera follows the ball), which is what a golfer watching his own shot looks like. Ours
      // used to blink out 260 ms after impact.
      // ...BUT NOT WHILE A PUTT IS BEING LINED UP. On the green the camera is tight (34 yds) and the
      // sprite is drawn AT the ball, so it covers the ball, the aim line and most of the way to the
      // cup - the three things a putt is entirely about. He comes back the instant the stroke
      // starts, which is when there is something to watch him do.
      golfer: !this.holed && !(putting && !this.anim),
      golferAt: this.ball,
      swingPose,
      aimRad: this.aimRad,
      hideAim: !!this.anim || this.holed,
      aimDots: putting ? null : aimDots(this._activeClub(), this._lie()),
      // MEASURED FROM THE REFERENCE: on the green the dots run WELL PAST the cup - at 67.0 s of
      // hole 1, a 17 ft putt shows dots continuing off the green and into the trees. They are a
      // POWER LADDER, exactly like a full shot's, not a line that stops at the hole. Ours stopped
      // at the pin, which left nothing to gauge power against.
      puttLine: putting ? puttRangeFt() / FT_PER_YD : 0,
    });
    this._drawMeter(now);
    this._paintSwingLabel(now);
    this.raf = requestAnimationFrame(this._frame);
  };

  /**
   * THE SWING METER: one arc, one needle, and the accuracy bar nested in the arc's own mouth.
   *
   * Rebuilt 2026-09-04 from a frame-by-frame measurement of the reference (see swing.js's header
   * for the trace). The old build drew two meters that never moved together. This draws ONE
   * SCALE: `pos`, in power units, running from -BAR_HALF (off the bottom of the accuracy bar)
   * through 0 (dead centre, a perfect strike) up to SWING_MAX (the top of the over-swing block).
   * The needle is a single white radial line at `ang(pos)` - which lands inside the bar when it
   * is near zero and on the band when it is not, with no special case and no discontinuity,
   * because the bar IS the arc's first 12 %, unrolled and magnified.
   *
   * Every proportion below is measured off the reference:
   *   band thickness / outer radius   0.345   (measured 51/148; ours 19/54 = 0.35)
   *   zero at 87 deg, 100 % at 295 deg, over-swing block 311-338 deg
   *   TICK LINES ACROSS THE BAND at 139.0 / 191.6 / 243.0 deg = 25 / 50 / 75 %
   *   the green stripe at 292-296 deg IS the 100 % line
   *   accuracy bar 54 % green, 11 % orange each side, 10 % red each side
   *   outline: BLACK outside WHITE, on both edges - that black key is most of why the original
   *            stays crisp over grass, and ours had no black at all
   *
   * ONE THING THE PREVIOUS BUILD GOT BACKWARDS: the over-swing block does NOT jut outside the
   * arc. Measured radially at 324 deg, its colour runs from r90 to r142 - exactly the plain
   * band's radii - and the outer white outline sits at 143-148 in both places. Ours drew it as a
   * fan sticking a third of a radius past the edge.
   */
  /** THE SWING BUTTON SAYS WHICH TAP IS NEXT (2026-09-08).
   *
   *  Matt: *"The first click on the green while putting does not appear to work. I click swing and
   *  nothing happens. I have to click it a second time to start the swing."*
   *
   *  The tap DID work. `PUTTER_DEAD_MS` holds the putter's needle at zero for 250 ms after tap 1
   *  (clubs.js - it exists to move a tap-in's second tap out of iOS's double-tap window, and it is
   *  load-bearing), and for those 250 ms the meter is byte-identical to its idle state. So the one
   *  club with a dead zone is the one club that gives no sign it heard you, and a second tap inside
   *  the window is correctly ignored - which reads as "the first click did nothing".
   *
   *  Two cues, and neither touches the dial, the tempo or the dead zone itself: this label, which
   *  changes on the frame the tap lands, and the charge ring in `_drawMeter` below, which shows the
   *  hold running down. `data-armed` on the button is the third, for the CSS.
   *
   *  It is written from the render loop rather than from `_tap` because the phase also changes
   *  without a tap (the backswing tops out; the needle runs off the bar and fires), and it writes
   *  only when the text actually changes - a DOM write every frame is not free. */
  /** 1 at the instant of tap 1, easing to 0 as a club's dead zone runs out; 0 when there is none
   *  (every club but the putter). Pure - it reads the swing's own clock, it does not keep one. */
  _chargeK(now, read) {
    const dead = (this.swing.tempo && this.swing.tempo.deadMs) || 0;
    if (!dead || !read || read.phase !== PHASE.BACK || read.pos > 0) return 0;
    const el = now - this.swing.t0;
    return Math.max(0, Math.min(1, 1 - el / dead));
  }

  _paintSwingLabel(now) {
    const ph = this.swing.read(now).phase;
    const key = this.holed ? 'back'
      : ph === PHASE.BACK ? 'swing_power'
        : ph === PHASE.DOWN ? 'swing_aim' : 'swing';
    if (this._swingLabelKey !== key) {
      this._swingLabelKey = key;
      this.el.swing.querySelector('span').textContent = t(key);
    }
    const armed = ph === PHASE.BACK || ph === PHASE.DOWN ? '1' : '0';
    if (this._swingArmed !== armed) {
      this._swingArmed = armed;
      this.el.swing.setAttribute('data-armed', armed);
    }
  }

  /** `opts` lets the tutorial paint a STILL dial into its own canvas without a second painter:
   *  `{ ctx, putting, club, lie, read, marks, still }`. One painter is the point - the popup that
   *  teaches the meter and the meter itself cannot drift apart if they are the same function, and
   *  the putting dial's whole lesson (its 25/50/75 marks sit further round, because distance is
   *  power^PUTT_GAMMA) is a property of this code rather than a picture somebody drew. */
  _drawMeter(now, opts = {}) {
    const c = opts.ctx || this.mctx;
    c.clearRect(0, 0, METER_W, METER_H);
    c.lineCap = 'butt';

    const putting = opts.putting != null ? opts.putting : this._putting();
    // Resolved HERE rather than where the carets are drawn, because the tick labels are painted
    // long before that and have to know to stand out of the way.
    const marks = opts.marks || (this.coach && this.coach.dialMarks && this.coach.dialMarks());
    const hasMarks = !!(marks && marks.length);
    const cx = 88; const cy = 76;
    const OUT_R = 54; const BAND = 19;
    const R = OUT_R - BAND / 2;            // the band's centre radius
    const IN_R = OUT_R - BAND;
    // THE SCALE IS swing.js's, NOT THIS FILE'S. It converts the needle's measured speed in degrees
    // per frame into power units, so a copy here that drifted would put the meter and the model on
    // two different scales while both looked perfectly reasonable. See swing.js's header for the
    // tick measurement that corrected it from 90/221 to 87/208 on 2026-09-05.
    const A0 = ARC_A0_DEG * DEG;           // pos 0: STRAIGHT DOWN, the bar's centre - see swing.js
    const DEG_PER_UNIT = ARC_DEG_PER_UNIT * DEG;   // 90 deg -> 298 deg is 100 % power
    const ang = (v) => A0 + v * DEG_PER_UNIT;
    const polar = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const arc = (from, to, style, width) => {
      c.lineWidth = width; c.strokeStyle = style;
      c.beginPath(); c.arc(cx, cy, R, ang(from), ang(to)); c.stroke();
    };

    // --- the band, its outline, and the zones -------------------------------------------------
    // Black first, then white, then the content: two strokes wider than the band give a hard
    // black key and a white rim on BOTH edges in one pass, which is how the reference reads.
    // The visible band starts where the ACCURACY BAR ends, not at zero: the bar covers the arc's
    // first 12 % and drawing the band under it only leaves a stub of white cap poking out below.
    arc(BAR_HALF, SWING_MAX, '#0b0f07', BAND + 8);
    arc(BAR_HALF, SWING_MAX, '#fffdfc', BAND + 4);
    // THE BAND IS SEMI-TRANSPARENT AND HAS TO COMPOSITE OVER THE COURSE, NOT OVER ITS OWN RIM.
    // Drawn straight on top of the white stroke it lands on 255 and comes out light grey - which
    // is exactly what the first attempt looked like. Punching the band's own width back out to
    // transparent first puts the fairway underneath it again, where the reference has it: its band
    // measures #616736 over grass and #474d32 over a dark patch, so it is genuinely see-through.
    c.globalCompositeOperation = 'destination-out';
    arc(BAR_HALF, SWING_MAX, '#000', BAND);
    c.globalCompositeOperation = 'source-over';
    // 75,75,50 at 78 % composites to exactly the measured #616736 over fairway green.
    arc(BAR_HALF, SWING_MAX, 'rgba(75,75,50,0.78)', BAND);

    // THE OVER-SWING BLOCK STARTS AT 107.6 %, NOT AT 100 %. Measured at 311-338 deg, which on the
    // corrected 87 + 2.08 deg/% scale is 107.6 % to 120.6 %. Between the 100 % line and here the
    // reference draws PLAIN BAND: a buffer between the target and the danger, which is a better
    // design than ours and was invisible while the scale was wrong.
    arc(BLOCK_FROM, SWING_MAX, '#f07c03', BAND);
    arc(BLOCK_FROM + 0.022, SWING_MAX - 0.035, '#fd0001', BAND);

    // THE GREEN STRIPE IS THE 100 % LINE. Measured at 292-296 deg = 98.5-100.4 % on the corrected
    // scale. The old build put it at 91-93 % and called it "a shade under full" - that was an
    // artefact of assuming 100 % sat where the block starts. Matt said it plainly and was right:
    // "The 100 has the green line."
    arc(0.985, 1.004, '#01da04', BAND);

    // The hatch, over everything. MEASURED contrast is tiny - #616736 band against #656938 hatch,
    // four values apart - so this is a whisper, not the stripes the previous build drew.
    if (!this._hatchPat) {
      const hc = document.createElement('canvas'); hc.width = 8; hc.height = 8;
      const hx = hc.getContext('2d');
      hx.strokeStyle = 'rgba(255,255,255,0.075)'; hx.lineWidth = 2;
      hx.beginPath(); hx.moveTo(-3, 11); hx.lineTo(11, -3); hx.stroke();
      this._hatchPat = c.createPattern(hc, 'repeat');
    }
    arc(BAR_HALF, SWING_MAX, this._hatchPat, BAND);

    // The arc's far end cap, black then white, so the block finishes as squarely as it starts.
    for (const [w, col] of [[BAND + 8, '#0b0f07'], [BAND + 4, '#fffdfc']]) {
      const a = ang(SWING_MAX);
      c.lineWidth = 3; c.strokeStyle = col;
      const [x0, y0] = polar(R - w / 2, a); const [x1, y1] = polar(R + w / 2, a);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }

    // --- THE TICK LINES, ACROSS THE BAND -------------------------------------------------------
    // Matt: "We need line indicators of where the 25% 50% 75% and 100% powers are. The 100 has the
    // green line, which is good. but the others need lines as well. Just like all the example
    // images and clips show." They do, and finding them is what caught the arc's scale being wrong
    // - they are a LIGHT TINT rather than white, which is why a scan thresholded at >225 had missed
    // them entirely. MEASURED at 139.0 / 191.6 / 243.0 deg; the 100 % one is the green stripe
    // above. The tint itself is chosen to match "a light tint, not white" rather than sampled - the
    // meter sits over a sand bunker in three of the four clips and the fourth is the putt frame the
    // angles came from, where the line's own colour is mixed with the band under it.
    //
    // ON THE PUTTER THEY SIT WHERE THE BALL GOES A QUARTER, A HALF AND THREE QUARTERS OF THE RANGE,
    // not at a quarter, a half and three quarters of the POWER (2026-09-06). Matt: *"the 25%, 50%,
    // 75%, and 100% red dots and power in general on the putter are all broken. none are correct."*
    //
    // He is right, and it is `PUTT_GAMMA`. A full shot's distance is LINEAR in power, so its dots
    // land at 25/50/75/100 % of the club's carry and the ticks name them exactly. A putt's is
    // `range * power ** 1.6`, so at even power the dots landed at 11 / 33 / 63 / 100 % of the range
    // - the tick reading "50" pointed at a third of the way to the hole. The putter was the one
    // club in the bag where the meter's own labels did not mean what they say.
    //
    // The curve itself STAYS - it is what makes a tap-in hittable at all (see "Short putts ran past
    // the hole"): linear, a 2 ft putt needs 3.3 % of the meter, reached 53 ms after the first tap.
    // So the LADDER is evenly spaced on the ground (15/30/45/60 ft, and see `render.js`) and the
    // TICKS move to the powers that produce it. Everything the player reads now agrees, the spacing
    // never changes, and the short putt stays makeable.
    const tickPow = putting ? (f) => Math.pow(f, 1 / PUTT_GAMMA) : (f) => f;
    for (const v of [0.25, 0.5, 0.75]) {
      const a = ang(tickPow(v));
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.42)';
      const [x0, y0] = polar(IN_R + 1, a); const [x1, y1] = polar(OUT_R - 1, a);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }

    // --- the tick labels, outside the arc ------------------------------------------------------
    c.font = '800 13px ui-monospace, "SF Mono", Menlo, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const v of [0.25, 0.5, 0.75, 1.0]) {
      // A LABEL ONLY MOVES IF A CARET IS ACTUALLY UNDER IT. Pushing all four out whenever the
      // lesson is running shoved "75" hard against the top of the canvas (measured: 0.1 px of
      // clearance at 13 px type) to make room for a caret that is nowhere near it. In practice the
      // only collision is the 100 % mark, so the test is per label: is any caret within CARET_NEAR
      // of this tick's own angle?
      const ta = ang(tickPow(v));
      const near = hasMarks && marks.some((m) => m.power != null
        && Math.abs(((ang(m.power) - ta + Math.PI) % (2 * Math.PI)) - Math.PI) < CARET_NEAR);
      const [lx, ly] = polar(OUT_R + (near ? CARET_GAP + CARET_LEN + 8 : 11), ta);
      c.lineWidth = 3.5; c.strokeStyle = '#0b0f07'; c.lineJoin = 'round';
      c.strokeText(String(v * 100), lx, ly);
      c.fillStyle = '#ffffff';
      c.fillText(String(v * 100), lx, ly);
    }

    // --- the accuracy bar, nested in the arc's mouth -------------------------------------------
    // ITS TRAPEZOID SHAPE IS NOT DECORATION. The four corners are the band's inner and outer radii
    // at the two ends of the accuracy window, so the bar is literally the arc's first 12 %,
    // straightened out. That is also why the needle inside it is a radial line rather than a
    // vertical one, and why it is exactly vertical only at dead centre.
    const [tlx, tly] = polar(IN_R, ang(BAR_HALF));
    const [trx, try_] = polar(IN_R, ang(-BAR_HALF));
    const [blx, bly] = polar(OUT_R, ang(BAR_HALF));
    const [brx, bry] = polar(OUT_R, ang(-BAR_HALF));
    const top = (u) => [tlx + (trx - tlx) * u, tly + (try_ - tly) * u];
    const bot = (u) => [blx + (brx - blx) * u, bly + (bry - bly) * u];
    const quad = (u0, u1, fill) => {
      const [ax, ay] = top(u0); const [bx2, by2] = top(u1);
      const [dx2, dy2] = bot(u1); const [ex, ey] = bot(u0);
      c.fillStyle = fill;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx2, by2); c.lineTo(dx2, dy2); c.lineTo(ex, ey);
      c.closePath(); c.fill();
    };
    const outline = (w, col) => {
      const [ax, ay] = top(0); const [bx2, by2] = top(1);
      const [dx2, dy2] = bot(1); const [ex, ey] = bot(0);
      c.lineWidth = w; c.strokeStyle = col; c.lineJoin = 'miter';
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx2, by2); c.lineTo(dx2, dy2); c.lineTo(ex, ey);
      c.closePath(); c.stroke();
    };
    const bClub = opts.club || this._activeClub();
    const b = bandsFor(lieOf(opts.lie || this._lie()).zone, swingZone(bClub),
      GREEN_FLOOR[clubTier(bClub)] || 0);
    outline(7, '#0b0f07');
    outline(3.5, '#fffdfc');
    quad(0, (1 - b.orange) / 2, '#fd0001');
    quad((1 - b.orange) / 2, (1 - b.green) / 2, '#fb8f20');
    quad((1 - b.green) / 2, (1 + b.green) / 2, '#01da04');
    quad((1 + b.green) / 2, (1 + b.orange) / 2, '#fb8f20');
    quad((1 + b.orange) / 2, 1, '#fd0001');
    outline(2, '#fffdfc');

    // --- the planted power marker, and the needle ----------------------------------------------
    // A radial line at `ang(v)`, black-edged so it reads on the band, the block or the bar alike.
    // The needle lands inside the bar when |pos| <= BAR_HALF and on the band otherwise, from the
    // same expression - the whole point of putting both on one scale.
    const read = opts.read || this.swing.read(now);
    const needleAt = (v, wOuter, wInner, colour) => {
      const inBar = Math.abs(v) <= BAR_HALF;
      const [x0, y0] = inBar ? top(barPosOf(v)) : polar(IN_R - 1, ang(v));
      const [x1, y1] = inBar ? bot(barPosOf(v)) : polar(OUT_R + 1, ang(v));
      c.lineWidth = wOuter; c.strokeStyle = '#0b0f07';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.lineWidth = wInner; c.strokeStyle = colour;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    };
    // THE PLANTED MARKER IS THE WHOLE POINT OF TAP 2: it stays on the arc, showing the power you
    // committed to, for the entire downswing. Measured in the reference at 297 deg for 70+ frames,
    // and measured WHITE - the same as the needle. They are never confusable in practice because
    // the marker is above and the needle is below it, coming down.
    // 5/2 RATHER THAN 6/3. At dpr 3 the old needle was 18 device px of black key across the middle
    // of the accuracy bar, and the bar's whole inner width is about 140 - so it ate 18 px out of
    // every green band, from the centre, which is exactly where the band is. On the hardest tier
    // (woods, floored at 16 % = 22 px) that left 4 px showing. Trimmed, the same band shows 9.
    // It is still the widest single mark on the meter and still black-keyed against grass.
    if (read.power != null) needleAt(read.power, 5, 2, '#ffffff');
    // THE CHARGE. `PUTTER_DEAD_MS` holds the putter's needle at zero for 250 ms after tap 1 (see
    // clubs.js for why that exists and what was tried instead), and for that quarter second the
    // meter gave no sign at all that it had heard the tap - the button's own label changed, which
    // nobody watching the needle ever sees. Matt: *"the putting double tap bug is back. I have to
    // click swing twice to get it to start moving."* He is not tapping twice by choice; the first
    // tap looks like nothing, so the second is instinctive, and MIN_TAP_POS then eats it.
    //
    // So the needle CHARGES: gold, and fatter, easing back to its normal white as the hold runs
    // out, so it is unmistakably alive before it starts to climb. It touches nothing else - not
    // the dial, not the tempo, not the dead zone, not a single power number - which is the same
    // constraint the two reverted fixes (a steeper curve, a slower putter) both broke.
    // Never on the tutorial's STILL dial: that one is handed a fabricated `read` and has no clock.
    const charge = opts.read ? 0 : this._chargeK(now, read);
    if (charge > 0) {
      needleAt(read.pos, 5 + 5 * charge, 2 + 4 * charge, '#ffce3a');
    } else {
      needleAt(read.pos, 5, 2, '#ffffff');
    }

    // ============================================================================================
    // THE LESSON POINTS AT THE DIAL (2026-09-09). Matt: "Use arrows. point to where they should aim
    // to hit on the power meter."
    //
    // TWO GOLD CARETS, AND THEY ARE ON SCREEN BEFORE THE FIRST TAP - never revealed mid-swing.
    // That is the whole constraint here: the backswing is 1585 ms per power unit, so anything that
    // APPEARS while the needle is moving cannot be found, read and acted on in time (the three
    // cards this replaced failed exactly that way). A mark that was already there is read at a
    // glance, which is what an arrow is for and a sentence is not.
    //
    //   * on the BAND, at 100 % power - where to stop it on the way up;
    //   * in the BAR, at dead centre - where to stop it on the way down.
    //
    // Drawn for the whole lesson and for no other player, gold (#ffce3a, the repo's standing
    // "this one" accent) on a black key so it reads over the band, the block and the bar alike.
    // MARKS. Gold carets pointing at a power on the band and/or a spot in the accuracy bar. The
    // lesson uses them two ways: on the LIVE dial while it is teaching the swing, and inside its own
    // popups, which paint a still dial through this same function.
    if (hasMarks) {
      // A CARET STANDS OFF THE METER AND POINTS AT IT. Matt, with a screenshot of the bad-swing
      // card: "The small arrows on the power meter are ON the meter rather than outside the meter
      // pointing at a spot on the meter." They were: the anchor was `OUT_R + 6` (r 60) but the
      // triangle was drawn 9 to 19 px back along the pointing direction, so it occupied r 41-51 -
      // inside a band that runs 35 to 54. It was a mark ON the thing it was labelling.
      //
      // Built from the two ends now rather than from an anchor plus a local shape, because that is
      // what got it wrong: `apex` is the point being named and `base` is CARET_LEN further away
      // from it, so the caret cannot end up on the wrong side of its own target however the
      // rotation is read.
      const tri = (ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len * CARET_HALF, py = dx / len * CARET_HALF;
        c.beginPath();
        c.moveTo(ax, ay); c.lineTo(bx + px, by + py); c.lineTo(bx - px, by - py); c.closePath();
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineJoin = 'round'; c.stroke();
      };
      const caret = (v, inBar, colour) => {
        let ax, ay, bx, by;
        if (inBar) {
          // The bar sits in the ring's mouth, so "off it" is BELOW it: the apex touches the bar's
          // outer edge and the caret hangs under it. `bot()` is that edge (`top()` is the inner
          // one, which is where the old code put the apex - inside the bar).
          const [ex, ey] = bot(barPosOf(v));
          ax = ex; ay = ey + CARET_GAP; bx = ex; by = ay + CARET_LEN;
        } else {
          [ax, ay] = polar(OUT_R + CARET_GAP, ang(v));
          [bx, by] = polar(OUT_R + CARET_GAP + CARET_LEN, ang(v));
        }
        tri(ax, ay, bx, by);
        c.fillStyle = colour || '#ffce3a'; c.fill();
      };
      for (const m of marks) {
        if (m.power != null) caret(m.power, false, m.colour);
        if (m.bar != null) caret(m.bar, true, m.colour);
      }
    }

    // --- the hub readout: how far the PREVIOUS shot travelled ----------------------------------
    if (!opts.still && this.lastShotYd != null) {
      c.font = '600 9px system-ui, sans-serif';
      c.fillStyle = '#a8b895';
      c.fillText(t('last_shot_lbl'), cx, cy - 8);
      c.font = '800 12px system-ui, sans-serif';
      c.fillStyle = '#f2f7ea';
      const txt = this.lastShotYd * FT_PER_YD < 90
        ? `${(this.lastShotYd * FT_PER_YD).toFixed(1)} ${t('ft')}`
        : `${this.lastShotYd.toFixed(1)} ${t('yds')}`;
      c.fillText(txt, cx, cy + 6);
    }
  }

  _startLoop() { if (!this.raf) this.raf = requestAnimationFrame(this._frame); }
  _stopLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  destroy() {
    if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
    this.destroyed = true;
    this._stopLoop();
    this._offAll();
    if (this.offViewport) { this.offViewport(); this.offViewport = null; }
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.stripObs) { this.stripObs.disconnect(); this.stripObs = null; }
    if (this._stripCache) this._stripCache.clear();
    this.container.innerHTML = '';
    this.rootEl = null; this.canvas = null; this.ctx = null; this.map = null;
  }

  /** THE HUB ASKS BEFORE IT TAKES YOU OUT OF A ROUND (2026-09-07).
   *
   *  This returned a flat `false`, on the grounds that golf "will snapshot after every stroke in
   *  Stage C, so leaving is lossless". That snapshot does not exist: `gamehub.golf.v1` holds the
   *  last course, round and length and nothing else. So the two halves were the wrong pair -
   *  no save AND no warning - and tapping the hub's back pill on the fifteenth hole of an
   *  eighteen threw the whole round away without a word.
   *
   *  `true` here is the OTHER honest answer (docs/BUILDING-A-GAME.md, "isInProgress()'s two-plus
   *  meanings"): there is nothing to resume, so say so and let the hub confirm. A hole is mounted
   *  only while a round is actually being played, and `recorded` is set the moment a round is
   *  written, so the last card and the setup screen do not nag. When the Stage C save lands this
   *  should go back to false in the same commit that adds it. */
  isInProgress() { return false; }

  /** IS THERE A SCORED ROUND HERE THAT LEAVING WOULD THROW AWAY?
   *
   *  Deliberately NARROWER than `isInProgress()` above, which is the hub's question and answers it
   *  for a practice hole too. This one is the QUIT BUTTON's question, and a practice hole is not a
   *  round: it is one unscored hole that writes no `bestRoundByCourse` entry, so stopping the
   *  player to confirm it would only teach them to dismiss the prompt that matters. */
  _roundAtStake() {
    // NOTHING IS AT STAKE WHEN THE SAVE LANDED (2026-09-09). Leaving is lossless now, so stopping
    // the player to warn them about a loss that cannot happen is the way a prompt becomes something
    // people dismiss without reading - and then it is not there for them on the day it matters.
    // `saveOk` is the VERIFIED write from `_saveRound`, not the fact that we tried: a device that
    // cannot write (storage full, private mode) still gets the old warning, which is exactly when
    // it is true again.
    if (this.saveOk && readSave()) return false;
    return !!(this.hole && this.roundId && this.roundId !== 'practice' && this.holeIdxs
      && this.scores.filter((v) => Number.isFinite(v)).length < this.holeIdxs.length);
  }

  /** THE PAUSE MENU. Matt, at the end of the tutorial rework: "I want to add a feature where
   *  [players] can pause then report a bug from the pause menu... Something like this is a brand
   *  new game please report any bugs you encounter in the pause menu." The lesson's closing card
   *  says exactly that, so the menu it names has to exist.
   *
   *  IT REPLACED THE TOP-LEFT QUIT BUTTON RATHER THAN JOINING IT. That corner already holds the
   *  button and the flag, and this is an immersive game measured to fit one screen at 390x664 - a
   *  third control there is the kind of thing that fits by a rounding error. Quit is a row in the
   *  menu now, which also puts one more deliberate tap in front of the door that throws a round
   *  away; `_quit()` still asks after it, and that guard is untouched.
   *
   *  A LIVE SWING IS CANCELLED, NOT PAUSED. The needle runs off `_frame`, and `_frame` keeps
   *  running behind an overlay - so a player who taps pause mid-backswing would have the meter
   *  fire itself and be charged a stroke for a shot they never saw. `swing.settle()` puts it back
   *  to address with no stroke and nothing lost. A ball already in the AIR is left alone: the shot
   *  is resolved either way and interrupting it is the one thing that could lose it. */
  _pauseMenu() {
    if (this.pauseEl) return;
    // `reset()`, NOT `settle()`. Settle carries `LOCK_MS` (1.4 s), which is the lock after a ball
    // has been STRUCK - and nothing was struck here, so it left the swing button dead for 1.4 s
    // after the player resumed and swallowed their first tap. Measured in a browser: resume, tap
    // swing, phase still `idle`. A ball already in the AIR keeps its own phase and its own lock,
    // because `_settleShot` owns those and `_tap` already skips the animation rather than
    // starting a swing.
    if (!this.anim) this.swing.reset();
    this._paintHud();
    const el = document.createElement('div');
    this.pauseEl = el;
    el.className = 'gf-result gf-pause';
    el.innerHTML = `
      <div class="gf-result__card gf-panel">
        <div class="gf-pause__h">${esc(t('paused'))}</div>
        <div class="gf-pause__rows">
          <button type="button" class="gf-pause__row" data-role="p-resume">${esc(t('pause_resume'))}</button>
          <button type="button" class="gf-pause__row is-lit" data-role="p-bug">${esc(t('report_bug'))}</button>
          <button type="button" class="gf-pause__row" data-role="p-quit">${esc(t('quit'))}</button>
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    const close = () => { if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; } };
    this._on(el.querySelector('[data-role="p-resume"]'), 'click', close);
    // Tapping the ground behind the card resumes. Safe with no confirm, because resuming loses
    // nothing; the row that DOES lose something goes through `_quit`'s own prompt.
    this._on(el, 'click', (ev) => { if (ev.target === el) close(); });
    this._on(el.querySelector('[data-role="p-quit"]'), 'click', () => { close(); this._quit(); });
    this._on(el.querySelector('[data-role="p-bug"]'), 'click', () => {
      close();
      // Lazily imported: the report form pulls in the whole device-report + Firebase picture, and
      // an immersive game must not carry that on its mount path for a button most rounds never
      // press. `gameId` is the HUB id, which preselects golf in the form's own picker.
      import('../../js/bug-report-ui.js')
        .then((m) => m.openBugReport({ gameId: 'golf' }))
        .catch((err) => { console.error('[golf] bug report failed to open', err); });
    });
  }

  /** LEAVING A ROUND ASKS FIRST. The quit button sits top-left, in the corner a thumb reaches for
   *  first, and it used to drop straight back to the setup screen - one tap, no prompt, and the
   *  round gone. There is no resume and `_recordRound` writes nothing until the round is complete,
   *  so on the seventeenth hole of an eighteen that is the whole round. The hub's own back pill
   *  was fixed the same night (`isInProgress` above); this is the other door out, and it was still
   *  open. A practice hole still leaves instantly: there is nothing to lose.
   *
   *  `before` is run just ahead of the setup screen, so the result card can hand in its own
   *  teardown and stay put if the player changes their mind. */
  _quit(before) {
    const leave = () => {
      if (before) before();
      // THE TUTORIAL IS NOT A COURSE, so leaving it has to put `this.course` back before the setup
      // screen reads it - otherwise the course picker opens on a course that is not in `COURSES`
      // and the chips have nothing highlighted.
      if (this.tutorialRun) { this._leaveTutorial(); return; }
      this._renderSetup();
    };
    if (!this._roundAtStake()) { leave(); return; }
    const el = document.createElement('div');
    el.className = 'gf-result';
    el.innerHTML = `
      <div class="gf-result__card gf-panel">
        <button type="button" class="gf-result__x" data-role="q-no" aria-label="${esc(t('quit_no'))}">&times;</button>
        <div class="gf-result__name">${esc(t('quit_title'))}</div>
        <div class="gf-result__sub">${esc(t('quit_body'))}</div>
        <div class="gf-actions">
          <button type="button" class="gf-btn" data-role="q-no"><span>${esc(t('quit_no'))}</span></button>
          <button type="button" class="gf-btn" data-role="q-yes"><span>${esc(t('quit_yes'))}</span></button>
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    for (const b of el.querySelectorAll('[data-role="q-no"]')) this._on(b, 'click', () => el.remove());
    this._on(el.querySelector('[data-role="q-yes"]'), 'click', () => { el.remove(); leave(); });
  }
}

let instance = null;

export function init(container) {
  ensureCSS();
  if (instance) instance.destroy();
  instance = new GolfGame(container);
  if (typeof window !== 'undefined') window.__gfTest = instance;   // test-visual.mjs's PLAY probe
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
  if (typeof window !== 'undefined') delete window.__gfTest;
}
export function isInProgress() { return instance ? instance.isInProgress() : false; }
export default { init, destroy, isInProgress };
