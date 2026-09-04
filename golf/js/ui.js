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
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf, isPuttable } from './clubs.js';
import { Swing, PHASE, bandsFor, mishit, RING_MAX } from './swing.js';
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

const AIM_STEP_DEG = 1.5;        // §4, ours: 1.5 deg at 215 yds moves the landing about 5.6 yds
const AIM_LIMIT_DEG = 60;        // aim is limited to +/- 60 deg from the line to the hole
const HOLD_DELAY_MS = 400;       // press-and-hold before auto-repeat
const HOLD_RATE_MS = 125;        // then 8 taps a second
const DEG = Math.PI / 180;
// The meter's logical drawing box, in CSS pixels. The canvas itself is backed at devicePixelRatio
// so the 3px band outline and the 13px tick numbers stay crisp on a phone.
const METER_W = 184;
const METER_H = 152;

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
    this._renderPlay();
  }

  _bearingToPin() {
    const dx = this.hole.pin[0] - this.ball[0];
    const dy = this.hole.pin[1] - this.ball[1];
    return Math.atan2(dx, dy);
  }
  _distToPin() { return distYd(this.ball, this.hole.pin); }
  _lie() { return surfaceAt(this.hole, this.ball[0], this.ball[1]); }
  /** Putting range: the green AND its collar (clubs.js's isPuttable). Named for what it gates -
   *  the putter, the feet readout and the putt simulation - rather than for the green alone. */
  _onGreen() { return isPuttable(this._lie()); }

  /** THE club in hand, resolved in ONE place. The HUD paints this and _fire swings it, so the tile
   *  can never name one club while the shot uses another - which is exactly what happened when the
   *  HUD grew its own auto-pick fallback and _fire kept reading the raw field. */
  _activeClub() {
    if (this._onGreen()) return PUTTER;
    if (!this.club || this.club.id === 'putter') this.club = autoSelectClub(this._distToPin(), this._lie());
    return this.club;
  }

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
            </div>
            <div class="gf-clubcol">
              <button type="button" class="gf-btn" data-role="club-up" aria-label="${t('a11y_club_up')}"><span>&and;</span></button>
              <button type="button" class="gf-btn" data-role="club-dn" aria-label="${t('a11y_club_down')}"><span>&or;</span></button>
            </div>
          </div>
        </div>

        <div class="gf-br">
          <canvas class="gf-meter" data-role="meter" width="184" height="152" aria-hidden="true"></canvas>
          <button type="button" class="gf-btn gf-swing" data-role="swing" aria-label="${t('a11y_swing')}"><span>${t('swing')}</span></button>
        </div>
      </div>`;

    this.canvas = this.rootEl.querySelector('[data-role="canvas"]');
    this.ctx = this.canvas.getContext('2d');
    this.meter = this.rootEl.querySelector('[data-role="meter"]');
    this.mctx = this.meter.getContext('2d');
    this.el = {};
    for (const k of ['par', 'shot', 'mode', 'holeno', 'lie', 'power', 'dist', 'tc', 'clubart', 'clubname', 'swing']) {
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
      let timer = 0; let rep = 0;
      const stop = () => { clearTimeout(timer); clearInterval(rep); timer = 0; rep = 0; el.removeAttribute('data-down'); };
      const start = (ev) => {
        ev.preventDefault();
        el.setAttribute('data-down', '1');
        fn();
        timer = setTimeout(() => { rep = setInterval(fn, HOLD_RATE_MS); }, HOLD_DELAY_MS);
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

    // The swing button darkens while held (33-67 ms in the reference - that is literally how the
    // taps were detected at all), then fires on release.
    const sw = q('swing');
    this._on(sw, 'pointerdown', (ev) => { ev.preventDefault(); sw.setAttribute('data-down', '1'); });
    this._on(sw, 'pointerup', (ev) => { ev.preventDefault(); sw.removeAttribute('data-down'); this._tap(); });
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
    if (this._onGreen()) return;                    // the putter is the only club on the green
    this.club = stepClub(this.club, dir);
    this._paintHud();
  }

  // ---------------------------------------------------------------- the swing ----
  _tap() {
    if (this.anim) { this._skipAnim(); return; }
    if (this.holed) { this._renderSetup(); return; }
    const now = performance.now();
    const r = this.swing.tap(now);
    if (r === 'begin') this.returning = true;      // the view comes home when the stroke starts
    if (r === 'fire') this._fire();
    this._paintHud();
  }

  _fire() {
    const lie = this._lie();
    const zone = lieOf(lie).zone;
    const { power, bar } = this.swing.read(performance.now());
    const m = mishit(bar, power, zone);

    if (this._onGreen()) {
      const res = simulatePutt({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG * 0.25, power,
        rangeFt: puttRangeFt(this._distToPin() * FT_PER_YD),
      });
      this.anim = { type: 'putt', t0: performance.now(), dur: res.ms, res };
    } else {
      const club = this._activeClub();
      const res = resolveShot({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG,
        club, power, mishitDeg: 0, distanceMul: m.distanceMul,
      });
      this.anim = { type: 'flight', t0: performance.now(), dur: res.flightMs, res, club };
    }
    // The hub readout is set when the ball STOPS, never here - see _settleShot.
  }

  /** Tap to skip: the reference's 7.5 s drive with no way past it is the main thing worth
   *  changing about it (§13 flaw 7). Ours is ~4.5 s and skippable. */
  _skipAnim() {
    if (!this.anim) return;
    const total = this.anim.dur + (this.anim.res && this.anim.res.rollMs ? this.anim.res.rollMs : 0);
    this.anim.t0 = performance.now() - total - 1;
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
    const strokes = this.shotN - 1;
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
    this.el.dist.textContent = this._onGreen()
      ? `${(d * FT_PER_YD).toFixed(1)} ${t('ft')}`
      : `${d.toFixed(1)} ${t('yds')}`;

    const club = this._activeClub();
    this.el.clubart.innerHTML = clubArt(club.id);
    this.el.clubname.textContent = t(`club_${club.id}`);
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
    const wantW = this._onGreen() ? VIEW_W_GREEN_YDS : VIEW_W_YDS;
    this.cam.setWidth(snap ? wantW : this.cam.widthYds + (wantW - this.cam.widthYds) * 0.18);
    // The ball sits LOW in the frame so the player sees up the hole toward the green. 0.5 puts it
    // about a quarter of the way up the screen, which is what makes the aim ladder's far dots
    // reachable by eye rather than only by scrolling the preview.
    //
    // ON THE GREEN IT IS ALMOST CENTRED. That offset exists to show a fairway the ball is about to
    // fly up; a putt's target is a few feet away, so pushing the ball to the bottom of the frame
    // just spends the top half of the screen on whatever is behind the green.
    const want = this.ball[1] + this.cam.halfH * (this._onGreen() ? 0.12 : 0.5);
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
      const p = Math.min(1, (now - this.anim.t0) / Math.max(1, this.anim.dur));
      if (this.anim.type === 'flight') {
        const r = this.anim.res;
        const el = now - this.anim.t0;
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
        // The camera TRACKS the ball, through the flight AND the rollout, scrolling the course past.
        this.cam.x = ballPos[0];
        this.cam.y = ballPos[1] + this.cam.halfH * 0.2;
        this.cam.clamp();
        if (el >= this.anim.dur + roll) { this.ball = [...ballPos]; this._settleShot(); this._aimCamera(false); }
      } else {
        // The camera does NOT move during a putt. Confirmed frame by frame in the reference, and
        // it is right: a static frame is what lets the player read the break they just played.
        const path = this.anim.res.path;
        ballPos = path[Math.min(path.length - 1, Math.floor(p * (path.length - 1)))];
      }
      if (this.anim && this.anim.type === 'putt' && p >= 1) { this.ball = [...ballPos]; this._settleShot(); this._aimCamera(false); }
    } else {
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

    const onGreen = this._onGreen();
    // The golfer stands at the ball whenever the ball is at rest, and plays its swing poses
    // through the stroke. It is hidden while the ball is in the air or rolling.
    let swingPose = 0;
    if (this.swing.phase === PHASE.ACCURACY) swingPose = 1;
    else if (this.anim && this.anim.type === 'flight' && now - this.anim.t0 < 260) swingPose = 2;

    drawFrame(this.ctx, this.map, this.hole, drawCam, {
      dpr: this.dpr,
      ball: ballPos,
      height,
      holed: this.holed,
      golfer: !this.anim || (now - this.anim.t0) < 260,
      swingPose,
      aimRad: this.aimRad,
      hideAim: !!this.anim || this.holed,
      aimDots: onGreen ? null : aimDots(this._activeClub(), this._lie()),
      // MEASURED FROM THE REFERENCE: on the green the dots run WELL PAST the cup - at 67.0 s of
      // hole 1, a 17 ft putt shows dots continuing off the green and into the trees. They are a
      // POWER LADDER, exactly like a full shot's, not a line that stops at the hole. Ours stopped
      // at the pin, which left nothing to gauge power against.
      puttLine: onGreen ? puttRangeFt(this._distToPin() * FT_PER_YD) / FT_PER_YD : 0,
    });
    this._drawMeter(now);
    this.raf = requestAnimationFrame(this._frame);
  };

  /**
   * The C-ring and the accuracy bar.
   *
   * TWO REAL BUGS lived here, and neither was cosmetic:
   *
   *  1. THE WHOLE METER RENDERED AT 40 % OPACITY while the free look was off the ball
   *     (`globalAlpha = faded ? 0.4 : 1`). Once free look started HOLDING its position, that meant
   *     the meter stayed dimmed for as long as the player studied the hole - so the green target
   *     band, the over-swing block and the 25/50/75/100 labels were all washed out at exactly the
   *     moment they were about to be used. The reference fades the top-centre lie tile and yardage
   *     ONLY; it never touches the meter. The fade is gone from here entirely.
   *
   *  2. THE HATCH WAS PAINTED OVER A PIE, NOT THE BAND. `ctx.clip()` clips to the region ENCLOSED
   *     by the current path, and the path was an arc - so clipping to it gave the whole chord/pie
   *     behind the ring, and the hatch lightened a large wedge of course behind the meter. That is
   *     the pale patch. It is a repeating PATTERN used as the band's strokeStyle now, which is
   *     confined to the band by construction.
   *
   * Geometry is the reference's: 0 at the bottom (90 deg) sweeping round to the upper right
   * (315 deg), ticks OUTSIDE the arc, a thin bright green stripe just under 100, a striped
   * over-swing tab that JUTS PAST the end of the arc, and the accuracy bar nested in the ring's
   * own bottom opening rather than floating below it.
   */
  _drawMeter(now) {
    const c = this.mctx;
    c.clearRect(0, 0, METER_W, METER_H);
    c.lineCap = 'butt';

    const cx = 88; const cy = 74; const R = 46; const band = 24;
    const A0 = 90 * DEG; const A1 = 315 * DEG;
    const ang = (v) => A0 + (Math.min(RING_MAX, Math.max(0, v)) / RING_MAX) * (A1 - A0);
    const arc = (from, to, style, width) => {
      c.lineWidth = width; c.strokeStyle = style;
      c.beginPath(); c.arc(cx, cy, R, ang(from), ang(to)); c.stroke();
    };

    // The band: dark and semi-transparent so the course shows through, with a diagonal hatch that
    // is a PATTERN on the stroke - it cannot bleed outside the band the way a clipped fill did.
    if (!this._hatchPat) {
      const hc = document.createElement('canvas'); hc.width = 8; hc.height = 8;
      const hx = hc.getContext('2d');
      hx.strokeStyle = 'rgba(255,255,255,0.16)'; hx.lineWidth = 2.5;
      hx.beginPath(); hx.moveTo(-3, 11); hx.lineTo(11, -3); hx.stroke();
      this._hatchPat = c.createPattern(hc, 'repeat');
    }
    arc(0, RING_MAX, 'rgba(16,22,12,0.80)', band);
    arc(0, RING_MAX, this._hatchPat, band);

    // The THIN BRIGHT GREEN stripe just under 100: this is the target for a full-power swing, so
    // it is the one thing on the ring that must never be ambiguous.
    arc(0.945, 1.0, '#3fe04a', band);

    // THE OVER-SWING TAB. Drawn WIDER than the band so it juts out past the arc, exactly as the
    // reference does - it marks where the risk starts (over 100 % multiplies the mishit angle by
    // 1.5) and a sliver contained inside the band cannot say that.
    const tabW = band + 12;
    c.lineWidth = tabW + 5; c.strokeStyle = '#ffffff';
    c.beginPath(); c.arc(cx, cy, R, ang(1.0), ang(RING_MAX)); c.stroke();
    c.lineWidth = tabW; c.strokeStyle = '#f2801f';
    c.beginPath(); c.arc(cx, cy, R, ang(1.0), ang(RING_MAX)); c.stroke();
    // red stripes across the tab
    c.lineWidth = tabW; c.strokeStyle = '#e01d10';
    for (let v = 1.008; v < RING_MAX; v += 0.032) {
      c.beginPath(); c.arc(cx, cy, R, ang(v), ang(Math.min(RING_MAX, v + 0.016))); c.stroke();
    }

    // The bold white outline, inside and out, plus capped ends.
    c.lineWidth = 3; c.strokeStyle = '#ffffff';
    c.beginPath(); c.arc(cx, cy, R + band / 2, A0, ang(1.0)); c.stroke();
    c.beginPath(); c.arc(cx, cy, R - band / 2, A0, ang(1.0)); c.stroke();
    c.beginPath();
    c.moveTo(cx + Math.cos(A0) * (R - band / 2), cy + Math.sin(A0) * (R - band / 2));
    c.lineTo(cx + Math.cos(A0) * (R + band / 2), cy + Math.sin(A0) * (R + band / 2));
    c.stroke();

    // Tick labels OUTSIDE the arc: bright white on a hard dark shadow, at full opacity. These are
    // the scale the sweeping tick is read against.
    c.font = '800 13px ui-monospace, "SF Mono", Menlo, monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const v of [0.25, 0.5, 0.75, 1.0]) {
      const a = ang(v);
      const lx = cx + Math.cos(a) * (R + band / 2 + 12);
      const ly = cy + Math.sin(a) * (R + band / 2 + 12);
      c.fillStyle = '#0b1006';
      c.fillText(String(v * 100), lx + 2, ly + 2);
      c.fillStyle = '#ffffff';
      c.fillText(String(v * 100), lx, ly);
    }

    const read = this.swing.read(now);
    // The white radial tick crossing the band, dark-edged so it reads on any colour under it.
    const a = ang(read.power);
    const x0 = cx + Math.cos(a) * (R - band / 2 - 1); const y0 = cy + Math.sin(a) * (R - band / 2 - 1);
    const x1 = cx + Math.cos(a) * (R + band / 2 + 1); const y1 = cy + Math.sin(a) * (R + band / 2 + 1);
    c.lineWidth = 7; c.strokeStyle = '#0b1006';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.lineWidth = 4; c.strokeStyle = '#ffffff';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();

    // The hub readout: the distance the PREVIOUS shot travelled, labelled.
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

    // THE ACCURACY BAR, NESTED IN THE RING'S BOTTOM OPENING, not floating below it. Saturated, so
    // the green centre - the most important judgement in the game - is unmistakable. Flared ends
    // and a hard black outline, as the reference draws it. The green band NARROWS on a bad lie.
    const bw = 96; const bh = 24;
    const bx = cx - bw / 2 + 10; const by = cy + R - band / 2 + 12;
    const zone = lieOf(this._lie()).zone;
    const b = bandsFor(zone);
    const flare = 5;
    const seg = (from, to, fill) => {
      const x0s = bx + bw * from; const x1s = bx + bw * to;
      c.fillStyle = fill;
      c.beginPath();
      // ends flare outward at the bottom, giving the bar the reference's trapezoid silhouette
      const lf = from === 0 ? flare : 0; const rf = to === 1 ? flare : 0;
      c.moveTo(x0s, by); c.lineTo(x1s, by);
      c.lineTo(x1s + rf, by + bh); c.lineTo(x0s - lf, by + bh);
      c.closePath(); c.fill();
    };
    seg(0, (1 - b.orange) / 2, '#e01d10');
    seg((1 - b.orange) / 2, (1 - b.green) / 2, '#f2801f');
    seg((1 - b.green) / 2, (1 + b.green) / 2, '#3fe04a');
    seg((1 + b.green) / 2, (1 + b.orange) / 2, '#f2801f');
    seg((1 + b.orange) / 2, 1, '#e01d10');
    c.strokeStyle = '#0b1006'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(bx, by); c.lineTo(bx + bw, by);
    c.lineTo(bx + bw + flare, by + bh); c.lineTo(bx - flare, by + bh);
    c.closePath(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(bx + 1.5, by + 1.5); c.lineTo(bx + bw - 1.5, by + 1.5);
    c.lineTo(bx + bw + flare - 2, by + bh - 1.5); c.lineTo(bx - flare + 2, by + bh - 1.5);
    c.closePath(); c.stroke();
    // A shape marker at the safe centre, so the target is findable without relying on hue alone.
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillRect(bx + bw / 2 - 1, by, 2, 5); c.fillRect(bx + bw / 2 - 1, by + bh - 5, 2, 5);
    if (this.swing.phase === PHASE.ACCURACY || this.swing.phase === PHASE.LIVE) {
      const mx = bx + bw * read.bar;
      c.fillStyle = '#0b1006'; c.fillRect(mx - 3.5, by - 5, 7, bh + 10);
      c.fillStyle = '#ffffff'; c.fillRect(mx - 2, by - 4, 4, bh + 8);
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
