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
import { loadProfile } from '../../js/profile-store.js';
import { COURSES, ROUNDS, courseById, roundById, roundKey, roundHoles, roundPar, roundYards, stablefordPoints } from './rounds.js';
import { validateHole, surfaceAt, distYd, greenBox } from './holes.js';
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf, mustPutt, canPutt, swingTempo } from './clubs.js';
import { Swing, PHASE, bandsFor, mishit, barPosOf, SWING_MAX, BAR_HALF } from './swing.js';
import { resolveShot, simulatePutt, aimDots, flightPoint, groundPoint, puttRangeFt, FT_PER_YD } from './shot.js';
import { buildMap, makeCamera, drawFrame, PALETTE, paletteFor, VIEW_W_YDS, VIEW_W_GREEN_YDS } from './render.js';
import { recordGolf } from '../../js/game-stats.js';
import { loadStats } from '../../js/game-stats.js';
import { STRINGS } from './strings.js';

const SETTINGS_KEY = 'gamehub.golf.v1';

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The wind indicator, drawn the way the reference draws it: a chunky arrow glyph plus the speed
 *  as a bare number. It shows the arrow AT ZERO too - the reference does, and Matt's note was that
 *  ours said "Wind Calm", which is a phrase the original never uses. The arrow is greyed and
 *  points up while there is no wind; when wind ships, it rotates and brightens. */
function windArrow(deg, calm = true) {
  return `<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(${deg}deg)">
    <path d="M8 1 L13 9 L9 9 L9 15 L7 15 L7 9 L3 9 Z" fill="${calm ? '#7d8a6d' : '#e8f0dc'}" stroke="#0d1208" stroke-width="1"/>
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
function clubArt(id) {
  const metal = '#d8dee6'; const dark = '#5c6672'; const shaft = '#2b3138';
  const wrap = (inner) => `<svg class="gf-clubart" viewBox="0 0 80 46" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
  if (id === 'putter') {
    return wrap(`<rect x="6" y="24" width="52" height="12" fill="${metal}" stroke="${dark}" stroke-width="2"/>
      <rect x="52" y="4" width="6" height="24" fill="${shaft}"/>`);
  }
  if (id === 'driver' || id.endsWith('wood')) {
    return wrap(`<ellipse cx="28" cy="30" rx="24" ry="14" fill="${metal}" stroke="${dark}" stroke-width="2"/>
      <ellipse cx="22" cy="27" rx="9" ry="5" fill="#eef2f6"/>
      <rect x="46" y="2" width="6" height="26" fill="${shaft}"/>`);
  }
  const wedge = id.endsWith('wedge');
  return wrap(`<path d="${wedge ? 'M10 40 L24 12 L46 17 L36 42 Z' : 'M12 40 L22 14 L44 19 L36 42 Z'}"
      fill="${metal}" stroke="${dark}" stroke-width="2"/>
    <rect x="40" y="2" width="6" height="20" fill="${shaft}"/>`);
}

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
  /** ONE setup screen: pick the course, pick how much of it to play, go.
   *
   *  It was a course card and a "play" button when there was one course of three holes. Two
   *  courses of eighteen could have become course list -> round list -> hole list, three taps deep
   *  before a ball is struck, and on a phone that is where a game gets closed. The course chips
   *  swap the picture and the numbers in place, so the whole choice is visible at once. */
  _renderSetup() {
    this._stopLoop();
    this.hole = null;
    this.rootEl.innerHTML = '';
    const c = this.course;
    const el = document.createElement('div');
    el.className = 'gf-setup';
    this._themeSetup(el);
    el.innerHTML = `
      <h1>${esc(t(`course_${c.id}`))}</h1>
      <div class="gf-coursepick">
        ${COURSES.map((k) => `<button type="button" class="gf-btn gf-chip${k.id === c.id ? ' is-on' : ''}"
          data-course="${esc(k.id)}"><span>${esc(t(`course_${k.id}`))}</span></button>`).join('')}
      </div>
      <canvas class="gf-setup__art" data-role="art" aria-hidden="true"></canvas>
      <div class="gf-card gf-panel">
        <div class="gf-card-meta">
          <span>${esc(t('course_meta', { holes: c.holes.length, par: c.par, yds: Math.round(c.holes.reduce((a, h) => a + h.cardYards, 0)) }))}</span>
        </div>
        <div class="gf-card-blurb">${esc(t(c.blurbKey))}</div>
      </div>
      <div class="gf-card">
        <div class="gf-card-blurb gf-pickhead">${esc(t('pick_round'))}</div>
        <div class="gf-rounds">
          ${ROUNDS.map((r) => `<button type="button" class="gf-btn gf-roundbtn" data-round="${esc(r.id)}">
            <span>${esc(t(r.labelKey))}</span>
            <small>${esc(t('round_meta', { par: roundPar(c, r.id), yds: Math.round(roundYards(c, r.id)) }))}</small>
            <small class="gf-best">${esc(this._bestText(roundKey(c, r.id), roundPar(c, r.id)))}</small>
          </button>`).join('')}
        </div>
      </div>
      <button type="button" class="gf-btn" data-role="practice"><span>${esc(t('practice'))}</span></button>`;
    this.rootEl.appendChild(el);
    this._paintSetupArt(el.querySelector('[data-role="art"]'));
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

  /** The course card's picture: hole 1 rendered whole, from the same map builder the game plays
   *  on, so it can never show a course the game does not have. Cheap - one buildMap, drawn once. */
  _paintSetupArt(cv) {
    if (!cv) return;
    requestAnimationFrame(() => {
      if (this.destroyed || !cv.isConnected) return;
      const r = cv.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const pal = paletteFor(this.course.theme);
      const map = buildMap(this.course.holes[0], this.course.theme);
      // Fit the whole hole in, letterboxed on whichever axis has room to spare.
      const sc = Math.min(cv.width / map.w, cv.height / map.h);
      const w = map.w * sc;
      const h = map.h * sc;
      ctx.fillStyle = pal.heavyRough;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(map.canvas, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    });
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
    this._enterHole();
  }

  _enterHole() {
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
    this._renderPlay();
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
    if (mustPutt(lie)) return PUTTER;
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
          <div class="gf-panel gf-lie"><b data-role="lie"></b><span class="gf-power" data-role="power"></span></div>
          <div class="gf-dist" data-role="dist"></div>
        </div>

        <div class="gf-tr gf-panel">
          <span>${t('wind')}</span>
          <span class="gf-windarrow" data-role="windarrow">${windArrow(0)}</span>
          <b data-role="wind">0</b>
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
    for (const k of ['par', 'shot', 'mode', 'holeno', 'lie', 'power', 'dist', 'tc', 'clubart', 'clubname', 'clubyds', 'swing']) {
      this.el[k] = this.rootEl.querySelector(`[data-role="${k}"]`);
    }

    this._bindPlay();
    this._sizeCanvas();
    this._paintHud();
    this._startLoop();
  }

  _bindPlay() {
    const q = (r) => this.rootEl.querySelector(`[data-role="${r}"]`);
    this._on(q('quit'), 'click', () => this._renderSetup());

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
    this._on(sw, 'pointerdown', (ev) => {
      ev.preventDefault();
      sw.setAttribute('data-down', '1');
      this._tap(evNow(ev));
    });
    this._on(sw, 'pointerup', (ev) => { ev.preventDefault(); sw.removeAttribute('data-down'); });
    this._on(sw, 'pointercancel', () => sw.removeAttribute('data-down'));

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
    let startX = 0; let startY = 0; let baseX = 0; let baseY = 0; let moved = 0;
    this.dragging = false;
    this._on(this.canvas, 'pointerdown', (ev) => {
      if (this.anim) { this._skipAnim(); return; }
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
      // A TAP (no real drag) snaps the view back to the ball. A drag HOLDS, so the player can
      // study the green for as long as they like.
      if (moved < 8) { this.returning = true; this.el.tc.setAttribute('data-faded', '0'); }
    };
    this._on(this.canvas, 'pointerup', release);
    this._on(this.canvas, 'pointercancel', release);
  }

  _nudgeAim(dir) {
    if (this.anim || this.swing.phase !== PHASE.IDLE) return;
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
    if (this._mustPutt()) return;                   // the putter is the only club on the green
    this.club = stepClub(this._activeClub(), dir, this._lie());
    this._syncTempo();
    this._paintHud();
  }

  // ---------------------------------------------------------------- the swing ----
  _tap(atMs) {
    if (this.anim) { this._skipAnim(); return; }
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
    if (r === 'begin') { this.previewDx = 0; this.previewDy = 0; this.returning = false; }
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
    // ONE needle: the power is the marker planted at tap 2, the accuracy is where the needle was
    // stopped on the way back down. `barPosOf` maps that position onto the accuracy bar's 0..1,
    // which is the only form the mishit model has ever taken.
    // The third tap has already LOCKED both values on the Swing, so these are read straight off
    // it rather than re-derived from a clock: re-reading `performance.now()` here would resolve
    // the shot a few milliseconds after the finger landed, which is the whole bug this fixes.
    const { pos, power } = { pos: this.swing.pos, power: this.swing.power };
    const m = mishit(barPosOf(pos), power, zone);

    // THE SHOT RESOLVES ON THE CLUB IN HAND, NOT ON THE LIE. They agree everywhere except the
    // fairway and the tee, which is exactly the case this split exists for.
    if (this._putting()) {
      const res = simulatePutt({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG * 0.25, power,
        rangeFt: puttRangeFt(),
      });
      this.anim = { type: 'putt', t0: performance.now() + WINDUP_MS, dur: res.ms, res };
    } else {
      const club = this._activeClub();
      const res = resolveShot({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG,
        club, power, mishitDeg: 0, distanceMul: m.distanceMul,
      });
      this.anim = { type: 'flight', t0: performance.now() + WINDUP_MS, dur: res.flightMs, res, club };
    }
    // The hub readout is set when the ball STOPS, never here - see _settleShot.
  }

  /** Tap to skip: the reference's 7.5 s drive with no way past it is the main thing worth
   *  changing about it (§13 flaw 7). Ours is ~4.5 s and skippable. */
  _skipAnim() {
    if (!this.anim) return;
    const total = this.anim.dur + (this.anim.res && this.anim.res.rollMs ? this.anim.res.rollMs : 0);
    this.anim.t0 = performance.now() - total - 1;   // also skips any windup still to run
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
        ${practice ? '' : `<div class="gf-result__card-grid">
          ${this.holeIdxs.map((hi, i) => `<div class="gf-cell${i === this.pos ? ' is-now' : ''}">
            <span>${this.course.holes[hi].n}</span><b>${Number.isFinite(this.scores[i]) ? this.scores[i] : '-'}</b></div>`).join('')}
        </div>`}
        <div class="gf-result__total">${esc(toParTxt)}</div>
        ${this.newBest ? `<div class="gf-result__best">${esc(t('saved_best'))}</div>` : ''}
        <div class="gf-actions">
          ${last ? `<button type="button" class="gf-btn" data-role="res-done"><span>${esc(t('finish'))}</span></button>`
    : `<button type="button" class="gf-btn" data-role="res-next"><span>${esc(t('next_hole'))}</span></button>`}
        </div>
      </div>`;
    this.rootEl.appendChild(el);
    const close = () => { el.remove(); this._renderSetup(); };
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
    const from = this.ball;
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
    this.shotN += 1;
    this.swing.settle(performance.now());
    this.aimRad = this._bearingToPin();
    this.club = autoSelectClub(this._distToPin(), this._lie());
    this._syncTempo();
    this._paintHud();
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

    this.el.clubart.innerHTML = clubArt(club.id);
    this.el.clubname.textContent = t(`club_${club.id}`);
    // HOW FAR THIS CLUB GOES, ON THIS LIE, printed under its name. The reference's tile carries a
    // number and ours did not, so the only way to know what a 6 iron was worth here was to swing
    // it. It is the LIE-ADJUSTED full-power carry, so it drops as the lie worsens - which makes
    // the "Power: 82%" line above it something the player can act on rather than just read.
    this.el.clubyds.textContent = putting
      ? `${puttRangeFt().toFixed(0)} ${t('ft')}`
      : `${Math.round(club.carry * L.power)} ${t('yds')}`;
    this.el.swing.querySelector('span').textContent = this.holed ? t('back') : t('swing');
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
    const want = this.ball[1] + this.cam.halfH * (this._mustPutt() ? 0.12 : 0.5);
    this.cam.x = this.ball[0];
    this.cam.y = snap ? want : this.cam.y + (want - this.cam.y) * 0.18;
    this.cam.clamp();
  }

  _frame = () => {
    if (this.destroyed || !this.ctx || !this.cam) return;
    const now = performance.now();
    let height = 0;
    let ballPos = this.ball;

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
          const g = groundPoint(q, len, r.apex);
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
      this._aimCamera(false);
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
      golfer: !this.holed,
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
   *   zero at 90 deg, 100 % at 311 deg, over-swing block 311-337 deg
   *   green stripe at 91-93 % power, thin - it is NOT adjacent to 100 %
   *   accuracy bar 54 % green, 11 % orange each side, 10 % red each side
   *   outline: BLACK outside WHITE, on both edges - that black key is most of why the original
   *            stays crisp over grass, and ours had no black at all
   *
   * ONE THING THE PREVIOUS BUILD GOT BACKWARDS: the over-swing block does NOT jut outside the
   * arc. Measured radially at 324 deg, its colour runs from r90 to r142 - exactly the plain
   * band's radii - and the outer white outline sits at 143-148 in both places. Ours drew it as a
   * fan sticking a third of a radius past the edge.
   */
  _drawMeter(now) {
    const c = this.mctx;
    c.clearRect(0, 0, METER_W, METER_H);
    c.lineCap = 'butt';

    const cx = 88; const cy = 76;
    const OUT_R = 54; const BAND = 19;
    const R = OUT_R - BAND / 2;            // the band's centre radius
    const IN_R = OUT_R - BAND;
    const A0 = 90 * DEG;                   // pos 0: straight down, the bar's centre
    const DEG_PER_UNIT = 221 * DEG;        // 90 deg -> 311 deg is 100 % power
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

    // The over-swing block: flush with the band, orange at both ends, red through the middle.
    arc(1.0, SWING_MAX, '#f07c03', BAND);
    arc(1.023, 1.09, '#fd0001', BAND);

    // The green stripe. MEASURED at 292-296 deg = 91-93 % power, and thin. It is deliberately NOT
    // touching 100 %: the target is a shade under full, with the over-swing beyond it.
    arc(0.912, 0.932, '#01da04', BAND);

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

    // --- the tick labels, outside the arc ------------------------------------------------------
    c.font = '800 13px ui-monospace, "SF Mono", Menlo, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const v of [0.25, 0.5, 0.75, 1.0]) {
      const [lx, ly] = polar(OUT_R + 11, ang(v));
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
    const b = bandsFor(lieOf(this._lie()).zone);
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
    if (read.power != null) needleAt(read.power, 6, 3, '#ffffff');
    needleAt(read.pos, 6, 3, '#ffffff');

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
    this.container.innerHTML = '';
    this.rootEl = null; this.canvas = null; this.ctx = null; this.map = null;
  }

  /** Autosave/resume meaning (docs/BUILDING-A-GAME.md): golf will snapshot after every stroke in
   *  Stage C, so leaving is lossless and this returns false for ordinary play. Until that save
   *  exists there is nothing to resume and nothing to warn about either way. */
  isInProgress() { return false; }
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
