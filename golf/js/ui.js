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
import { COURSES, ROUNDS, MODES, courseById, roundById, roundKey, roundHoles, roundPar, roundsOfMode, roundsForCourse, modesForCourse, roundRange, holeKey, stablefordPoints } from './rounds.js';
import { validateHole, surfaceAt, distYd, greenBox } from './holes.js';
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf, mustPutt, canPutt, lockedToPutter, swingTempo, swingZone, clubTier, GREEN_FLOOR } from './clubs.js';
import { Swing, PHASE, bandsFor, mishit, puttMishit, barPosOf, SWING_MAX, BLOCK_FROM, BAR_HALF, ARC_A0_DEG, ARC_DEG_PER_UNIT } from './swing.js';
import { resolveShot, simulatePutt, aimDots, flightPoint, groundPoint, puttRangeFt, windFor, dropNear, FT_PER_YD, PUTT_GAMMA } from './shot.js';
import { buildMap, makeCamera, drawFrame, PALETTE, paletteFor, fillsFor, VIEW_W_YDS, VIEW_W_GREEN_YDS } from './render.js';
import { recordGolf } from '../../js/game-stats.js';
import { loadStats } from '../../js/game-stats.js';
import { STRINGS } from './strings.js';

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
const AIM_STEP_DEG = 1.0;
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
    // The hub's floating back button lives in the top-left, so the HUD's own top row moves down
    // out from under it. Standalone there is nothing there and no pad is needed.
    if (this.inHub) this.rootEl.style.setProperty('--gf-top-pad', '46px');
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
    const vh = window.innerHeight || 720;

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
    const el = document.createElement('div');
    el.className = 'gf-setup';
    this._themeSetup(el);
    el.innerHTML = `
      <h1>${esc(t(`course_${c.id}`))}</h1>
      <div class="gf-coursepick gf-modepick">
        ${modes.map((m) => `<button type="button" class="gf-btn gf-chip${m === mode ? ' is-on' : ''}"
          data-mode="${m}"><span>${esc(t('mode_holes', { n: m }))}</span></button>`).join('')}
      </div>
      <div class="gf-coursepick">
        ${COURSES.map((k) => `<button type="button" class="gf-btn gf-chip${k.id === c.id ? ' is-on' : ''}"
          data-course="${esc(k.id)}"><span>${esc(t(`course_${k.id}`))}</span></button>`).join('')}
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
        <div class="gf-card-blurb gf-pickhead">${esc(rounds.length > 1 ? t('pick_set') : t('pick_round'))}</div>
        <div class="gf-rounds${rounds.length === 1 ? ' is-one' : ''}">
          ${rounds.map((r) => `<button type="button" class="gf-btn gf-roundbtn" data-round="${esc(r.id)}"
            aria-label="${esc(t('holes_range', { range: roundRange(r) }))}">
            <span>${esc(roundRange(r))}</span>
            <small>${esc(t('round_meta', { par: roundPar(c, r.id) }))}</small>
            <small class="gf-best">${esc(this._bestText(roundKey(c, r.id), roundPar(c, r.id)))}</small>
          </button>`).join('')}
        </div>
      </div>
      <button type="button" class="gf-btn" data-role="practice"><span>${esc(t('practice'))}</span></button>`;
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
    for (const b of el.querySelectorAll('[data-round]')) {
      this._on(b, 'click', () => this._startRound(b.dataset.round));
    }
    this._on(el.querySelector('[data-role="practice"]'), 'click', () => this._renderHoleSelect());
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

  /** EACH ROW'S HEIGHT IS MEASURED, NOT PICKED. Every tile's width is its own hole's aspect times
   *  the row height, so a row of nine exactly fills the width at one height and one height only:
   *  `(row width - the gaps) / the sum of that row's aspects`. Picking a height instead would leave
   *  a ragged margin on the right of every row, which is the wasted space this whole layout exists
   *  to remove - and it would differ per course, because Red Mesa's holes are not Pine Valley's.
   *
   *  Measured on Pine Valley at 393px: the front nine's aspects sum to 3.099 and the back nine's to
   *  3.293, so the two rows come out 102px and 96px tall and both end flush. */
  _sizeStripRows() {
    const strip = this.stripEl;
    if (!strip || !strip.isConnected) return;
    const GAP = 4;
    for (const row of strip.querySelectorAll('.gf-strip__row')) {
      const arts = [...row.querySelectorAll('[data-hole-art]')];
      if (!arts.length) continue;
      const w = row.clientWidth;
      if (w < 8) continue;
      let sum = 0;
      for (const cv of arts) sum += parseFloat(cv.style.getPropertyValue('--gf-ar')) || 0.33;
      const h = Math.max(28, (w - GAP * (arts.length - 1)) / sum);
      row.style.setProperty('--gf-strip-h', `${h.toFixed(2)}px`);
    }
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
    const el = document.createElement('div');
    el.className = 'gf-setup';
    this._themeSetup(el);
    el.innerHTML = `
      <h1>${esc(t(`course_${c.id}`))}</h1>
      <div class="gf-card gf-panel"><div class="gf-card-blurb">${esc(t('select_hole'))}</div>
        <div class="gf-holes">${c.holes.map((h, i) => `
          <button type="button" class="gf-btn gf-hole-btn" data-hole="${i}"
            aria-label="${esc(`${t('hole_abbr')} ${h.n}, ${t('par_n', { n: h.par })}`)}">
            <span>${h.n}</span><small>${h.par}</small></button>`).join('')}</div>
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
    this._renderPlay();
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
              <button type="button" class="gf-btn" data-role="quit"><span>${t('quit')}</span></button>
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
    this._on(q('quit'), 'click', () => this._quit());

    // Press-and-hold auto-repeat for the four nudge controls, after a 400 ms delay (§4).
    const hold = (el, fn) => {
      let timer = 0; let heldSince = 0;
      const stop = () => { clearTimeout(timer); timer = 0; heldSince = 0; el.removeAttribute('data-down'); };
      // A self-rescheduling timeout rather than a setInterval, because the gap CHANGES on every
      // repeat: `k` is how far into the ramp we are, so the delay eases from HOLD_SLOW_MS down to
      // HOLD_FAST_MS and then stays there for as long as the finger is down.
      const tick = () => {
        fn();
        const k = Math.min(1, (performance.now() - heldSince - HOLD_DELAY_MS) / HOLD_RAMP_MS);
        timer = setTimeout(tick, HOLD_SLOW_MS + (HOLD_FAST_MS - HOLD_SLOW_MS) * k);
      };
      const start = (ev) => {
        ev.preventDefault();
        el.setAttribute('data-down', '1');
        heldSince = performance.now();
        fn();
        timer = setTimeout(tick, HOLD_DELAY_MS);
      };
      this._on(el, 'pointerdown', start);
      this._on(el, 'pointerup', stop);
      this._on(el, 'pointercancel', stop);
      this._on(el, 'pointerleave', stop);
      this.listeners.push([{ removeEventListener: stop }, '', () => {}, undefined]);
    };
    hold(q('aim-l'), () => this._nudgeAim(-1));
    hold(q('aim-r'), () => this._nudgeAim(+1));
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

  _nudgeAim(dir) {
    if (this.anim || this.swing.phase !== PHASE.IDLE) return;
    if (this.intro) this._endIntro();
    const base = this._bearingToPin();
    let next = this.aimRad + dir * AIM_STEP_DEG * DEG;
    const limit = AIM_LIMIT_DEG * DEG;
    // Aim is limited to +/- 60 deg from the line to the hole, so the player can never lose the
    // hole entirely by leaning on one arrow.
    let rel = next - base;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    rel = Math.max(-limit, Math.min(limit, rel));
    next = base + rel;
    this.aimRad = next;
    this._paintHud();
  }

  _stepClub(dir) {
    if (this.anim || this.swing.phase !== PHASE.IDLE) return;
    if (this.intro) this._endIntro();
    if (lockedToPutter(this._lie())) return;        // the putter is the only club on the green
    this.club = stepClub(this._activeClub(), dir, this._lie());
    this._syncTempo();
    this._paintHud();
  }

  // ---------------------------------------------------------------- the swing ----
  _tap(atMs) {
    if (this.anim) { this._skipAnim(); return; }
    if (this.intro) this._endIntro();
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
    const strokes = this.shotN;
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
    this._recordHole(hole, strokes);
    if (last && !practice) this._recordRound();

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
        <div class="gf-result__name">${esc(last && !practice ? t('round_done') : this._scoreName(strokes, hole.par))}</div>
        <div class="gf-result__sub">${esc(t('holed_in', { n: strokes }))} &middot; ${esc(t('par_n', { n: hole.par }))}</div>
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
        ${this.newBest ? `<div class="gf-result__best">${esc(t('saved_best'))}</div>` : ''}
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
    const close = () => this._quit(() => el.remove());
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
      setTimeout(() => { if (!this.destroyed) this._showHoleResult(); }, 700);
      return;
    }
    this.shotN += 1 + ((a.res && a.res.penalty) || 0);
    this.swing.settle(performance.now());
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
    this.el.mode.textContent = this.roundId === 'practice'
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
      if (this.swing.read(now).expired) { this.swing.tap(now); this._fire(); this._paintHud(); }
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

  _drawMeter(now) {
    const c = this.mctx;
    c.clearRect(0, 0, METER_W, METER_H);
    c.lineCap = 'butt';

    const putting = this._putting();
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
      const [lx, ly] = polar(OUT_R + 11, ang(tickPow(v)));
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
    const b = bandsFor(lieOf(this._lie()).zone, swingZone(this._activeClub()),
      GREEN_FLOOR[clubTier(this._activeClub())] || 0);
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
    const read = this.swing.read(now);
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
    needleAt(read.pos, 5, 2, '#ffffff');

    // THE DEAD ZONE IS VISIBLE NOW. See `_paintSwingLabel` for the report this closes: while
    // `tempo.deadMs` holds the putter's needle at zero, the meter used to be identical to its idle
    // state, so the tap that started the swing left no mark anywhere on screen.
    //
    // A ring around the hub, sweeping clockwise from straight up and completing exactly as the
    // needle starts to climb. It is drawn INSIDE the band's inner radius, so it cannot be mistaken
    // for the needle or for the planted power marker, and it costs nothing on the other thirteen
    // clubs - they have `deadMs: 0` and never enter this branch.
    const dead = this.swing.tempo && this.swing.tempo.deadMs;
    if (read.phase === PHASE.BACK && dead > 0) {
      const q = Math.min(1, Math.max(0, (now - this.swing.t0) / dead));
      if (q < 1) {
        const r = IN_R - 9;
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); c.stroke();
        c.lineWidth = 2.5; c.strokeStyle = '#ffce3a';
        c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); c.stroke();
      }
    }

    // --- the hub readout: how far the PREVIOUS shot travelled ----------------------------------
    if (this.lastShotYd != null) {
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
  isInProgress() { return !!(this.hole && !this.recorded); }

  /** IS THERE A SCORED ROUND HERE THAT LEAVING WOULD THROW AWAY?
   *
   *  Deliberately NARROWER than `isInProgress()` above, which is the hub's question and answers it
   *  for a practice hole too. This one is the QUIT BUTTON's question, and a practice hole is not a
   *  round: it is one unscored hole that writes no `bestRoundByCourse` entry, so stopping the
   *  player to confirm it would only teach them to dismiss the prompt that matters. */
  _roundAtStake() {
    return !!(this.hole && this.roundId && this.roundId !== 'practice' && this.holeIdxs
      && this.scores.filter((v) => Number.isFinite(v)).length < this.holeIdxs.length);
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
    const leave = () => { if (before) before(); this._renderSetup(); };
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
