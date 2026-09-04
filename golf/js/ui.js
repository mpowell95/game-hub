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
import PINE_VALLEY from '../courses/pinevalley.js';
import { validateHole, surfaceAt, distYd, greenBox } from './holes.js';
import { CLUBS, PUTTER, autoSelectClub, stepClub, lieOf } from './clubs.js';
import { Swing, PHASE, bandsFor, mishit, RING_MAX } from './swing.js';
import { resolveShot, simulatePutt, aimDots, flightPoint, MAX_PUTT_FT, FT_PER_YD } from './shot.js';
import { buildMap, makeCamera, drawFrame, PALETTE } from './render.js';
import { STRINGS } from './strings.js';

const SETTINGS_KEY = 'gamehub.golf.v1';
const t = makeT(STRINGS);

const AIM_STEP_DEG = 1.5;        // §4, ours: 1.5 deg at 215 yds moves the landing about 5.6 yds
const AIM_LIMIT_DEG = 60;        // aim is limited to +/- 60 deg from the line to the hole
const HOLD_DELAY_MS = 400;       // press-and-hold before auto-repeat
const HOLD_RATE_MS = 125;        // then 8 taps a second
const DEG = Math.PI / 180;

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
    return { lastCourse: s.lastCourse || PINE_VALLEY.id, round: s.round || null, ...s };
  } catch { return { lastCourse: PINE_VALLEY.id, round: null }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* best effort */ }
}

/** Club-head art: a driver's big wood, an iron's angled blade, a wedge's steeper one, the putter's
 *  flat blade. Drawn rather than named so the tile reads at a glance, same as the reference. */
function clubArt(id) {
  const c = '#d8dee6'; const d = '#5c6672';
  if (id === 'putter') return `<svg class="gf-clubart" width="34" height="22" viewBox="0 0 34 22" aria-hidden="true"><rect x="3" y="9" width="24" height="6" fill="${c}" stroke="${d}"/><rect x="25" y="2" width="3" height="13" fill="${d}"/></svg>`;
  if (id === 'driver' || id.endsWith('wood')) return `<svg class="gf-clubart" width="34" height="22" viewBox="0 0 34 22" aria-hidden="true"><ellipse cx="13" cy="13" rx="11" ry="7" fill="${c}" stroke="${d}"/><rect x="22" y="1" width="3" height="12" fill="${d}"/></svg>`;
  const wedge = id.endsWith('wedge');
  return `<svg class="gf-clubart" width="34" height="22" viewBox="0 0 34 22" aria-hidden="true"><path d="${wedge ? 'M5 18 L11 6 L20 8 L16 19 Z' : 'M6 18 L10 7 L19 9 L16 19 Z'}" fill="${c}" stroke="${d}"/><rect x="18" y="1" width="3" height="10" fill="${d}"/></svg>`;
}

class GolfGame {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.course = PINE_VALLEY;
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
    if (this.hole) {
      this.cam = makeCamera(this.hole, r.width, r.height);
      this._aimCamera(true);
    }
  }

  // ---------------------------------------------------------------- setup ----
  _renderSetup() {
    this._stopLoop();
    this.hole = null;
    this.rootEl.innerHTML = '';
    const best = this._bestText();
    const el = document.createElement('div');
    el.className = 'gf-setup';
    el.innerHTML = `
      <h1>${t('course')}</h1>
      <div class="gf-card gf-panel">
        <div class="gf-card-meta"><span>${t('holes_n')}</span><span>${best}</span></div>
        <div class="gf-card-blurb">${t('blurb')}</div>
      </div>
      <div class="gf-card gf-actions">
        <button type="button" class="gf-btn" data-role="play"><span>${t('play')}</span></button>
        <button type="button" class="gf-btn" data-role="practice"><span>${t('practice')}</span></button>
      </div>`;
    this.rootEl.appendChild(el);
    this._on(el.querySelector('[data-role="play"]'), 'click', () => this._startRound('round', 0));
    this._on(el.querySelector('[data-role="practice"]'), 'click', () => this._renderHoleSelect());
  }

  _bestText() {
    // Stage D wires the real bestRoundByCourse read. Until a round can be completed there is
    // nothing true to show, and the reference's own literal dash is the honest placeholder.
    return t('best_none');
  }

  _renderHoleSelect() {
    this.rootEl.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'gf-setup';
    el.innerHTML = `
      <h1>${t('course')}</h1>
      <div class="gf-card gf-panel"><div class="gf-card-blurb">${t('select_hole')}</div>
        <div class="gf-holes">${this.course.holes.map((h) => `
          <button type="button" class="gf-btn gf-hole-btn" data-hole="${h.n}"><span>${h.n}</span></button>`).join('')}</div>
        <div class="gf-card-meta"><span>${this.course.holes.map((h) => `${t('par_n', { n: h.par })}`).join('  ')}</span></div>
      </div>
      <button type="button" class="gf-btn" data-role="back"><span>${t('back')}</span></button>`;
    this.rootEl.appendChild(el);
    for (const b of el.querySelectorAll('[data-hole]')) {
      this._on(b, 'click', () => this._startRound('practice', Number(b.dataset.hole) - 1));
    }
    this._on(el.querySelector('[data-role="back"]'), 'click', () => this._renderSetup());
  }

  // ---------------------------------------------------------------- play ----
  _startRound(kind, holeIdx) {
    this.roundKind = kind;
    this.holeIdx = holeIdx;
    this.scores = [];
    this._enterHole();
  }

  _enterHole() {
    const hole = this.course.holes[this.holeIdx];
    // A hole that fails validation must fail LOUDLY rather than half-render: a malformed green
    // silently flattens the break, and that gets diagnosed as "putting feels wrong" for a week.
    const errs = validateHole(hole);
    if (errs.length) { console.error('[golf] invalid hole data:', errs); }

    this.hole = hole;
    this.map = buildMap(hole);
    this.ball = [...hole.tee];
    this.shotN = 1;
    this.holed = false;
    this.lastShotYd = null;
    this.anim = null;
    this.previewDy = 0;
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
  _onGreen() { return this._lie() === 'green'; }

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
          <div class="gf-panel gf-lie"><b data-role="lie"></b><span data-role="power"></span></div>
          <div class="gf-dist" data-role="dist"></div>
        </div>

        <div class="gf-tr gf-panel">
          <span>${t('wind')}</span>
          <b data-role="wind">${t('calm')}</b>
        </div>

        <div class="gf-bl">
          <div class="gf-aimrow">
            <button type="button" class="gf-btn" data-role="aim-l" aria-label="${t('a11y_aim_left')}"><span>&lt;</span></button>
            <div class="gf-panel gf-aimlabel">${t('aim')}</div>
            <button type="button" class="gf-btn" data-role="aim-r" aria-label="${t('a11y_aim_right')}"><span>&gt;</span></button>
          </div>
          <div class="gf-clubrow">
            <div class="gf-panel gf-clubtile">
              <span data-role="clubart"></span>
              <span class="gf-clubname" data-role="clubname"></span>
            </div>
            <div class="gf-clubcol">
              <button type="button" class="gf-btn" data-role="club-up" aria-label="${t('a11y_club_up')}"><span>&and;</span></button>
              <button type="button" class="gf-btn" data-role="club-dn" aria-label="${t('a11y_club_down')}"><span>&or;</span></button>
            </div>
          </div>
        </div>

        <div class="gf-br">
          <canvas class="gf-meter" data-role="meter" width="150" height="156" aria-hidden="true"></canvas>
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

    // Free-scroll preview: drag the course up to look at the green, release to snap back to the
    // ball. Bound to the game's own root, NEVER to document - a non-passive touchmove on document
    // turns off compositor scrolling for the whole page while this game is mounted.
    let dragging = false; let startY = 0; let startPreview = 0;
    this._on(this.canvas, 'pointerdown', (ev) => {
      if (this.anim) { this._skipAnim(); return; }
      dragging = true; startY = ev.clientY; startPreview = this.previewDy;
      this.canvas.setPointerCapture?.(ev.pointerId);
    });
    this._on(this.canvas, 'pointermove', (ev) => {
      if (!dragging || !this.cam) return;
      this.previewDy = startPreview + (ev.clientY - startY) / this.cam.ppy;
      this.el.tc.setAttribute('data-faded', Math.abs(this.previewDy) > 4 ? '1' : '0');
    });
    const release = () => {
      if (!dragging) return;
      dragging = false; this.previewDy = 0;
      this.el.tc.setAttribute('data-faded', '0');
    };
    this._on(this.canvas, 'pointerup', release);
    this._on(this.canvas, 'pointercancel', release);
    this._on(this.canvas, 'pointerleave', release);
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
    if (r === 'fire') this._fire();
    this._paintHud();
  }

  _fire() {
    const lie = this._lie();
    const zone = lieOf(lie).zone;
    const { power, bar } = this.swing.read(performance.now());
    const m = mishit(bar, power, zone);

    if (this._onGreen()) {
      const res = simulatePutt({ hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG * 0.25, power });
      this.anim = { type: 'putt', t0: performance.now(), dur: res.ms, res };
      this.lastShotYd = distYd(this.ball, res.rest);
    } else {
      const res = resolveShot({
        hole: this.hole, from: this.ball, aimRad: this.aimRad + m.deg * DEG,
        club: this.club, power, mishitDeg: 0, distanceMul: m.distanceMul,
      });
      this.anim = { type: 'flight', t0: performance.now(), dur: res.flightMs, res };
      this.lastShotYd = res.travelledYd;
    }
  }

  /** Tap to skip: the reference's 7.5 s drive with no way past it is the main thing worth
   *  changing about it (§13 flaw 7). Ours is ~4.5 s and skippable. */
  _skipAnim() {
    if (!this.anim) return;
    this.anim.t0 = performance.now() - this.anim.dur - 1;
  }

  _settleShot() {
    const a = this.anim;
    this.anim = null;
    if (a.type === 'putt') {
      this.ball = [...a.res.rest];
      if (a.res.holed) { this.holed = true; this.swing.settle(performance.now()); this._paintHud(); return; }
    } else {
      this.ball = [...a.res.rest];
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
    this.el.mode.textContent = this.roundKind === 'practice' ? t('mode_practice') : t('mode_round');
    this.el.holeno.textContent = String(this.hole.n);
    this.el.lie.textContent = t(`lie_${lie}`);
    // Every bad lie does two things and BOTH are shown before the swing: it caps distance, and it
    // narrows the accuracy band. The percentage is the cap; the band is drawn narrower.
    this.el.power.textContent = L.power < 1 ? ` ${t('power_pct', { n: Math.round(L.power * 100) })}` : '';

    // Yards off the green, FEET on it. The switch is on the SURFACE, not on a distance threshold:
    // that matches both of the reference's observations and needs no constant to guess at.
    const d = this._distToPin();
    this.el.dist.textContent = this._onGreen()
      ? `${(d * FT_PER_YD).toFixed(1)} ${t('ft')}`
      : `${d.toFixed(1)} ${t('yds')}`;

    const club = this._onGreen() ? PUTTER : (this.club || autoSelectClub(d, lie));
    this.el.clubart.innerHTML = clubArt(club.id);
    this.el.clubname.textContent = t(`club_${club.id}`);
    this.el.swing.querySelector('span').textContent = this.holed ? t('back') : t('swing');
  }

  _aimCamera(snap) {
    if (!this.cam) return;
    // The ball sits LOW in the frame so the player sees up the hole toward the green. 0.5 puts it
    // about a quarter of the way up the screen, which is what makes the aim ladder's far dots
    // reachable by eye rather than only by scrolling the preview.
    const want = this.ball[1] + this.cam.halfH * 0.5;
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
        const f = flightPoint(p, r.carry * (r.blocked ? r.blocked.p : 1), r.sideYd * (r.blocked ? r.blocked.p : 1), r.apex);
        const cos = Math.cos(r.aimRad); const sin = Math.sin(r.aimRad);
        ballPos = [this.ball[0] + sin * f.along + cos * f.side, this.ball[1] + cos * f.along - sin * f.side];
        height = f.height;
        // The camera TRACKS the ball in flight, scrolling the course past at flight speed.
        this.cam.x = ballPos[0];
        this.cam.y = ballPos[1] + this.cam.halfH * 0.2;
        this.cam.clamp();
      } else {
        // The camera does NOT move during a putt. Confirmed frame by frame in the reference, and
        // it is right: a static frame is what lets the player read the break they just played.
        const path = this.anim.res.path;
        ballPos = path[Math.min(path.length - 1, Math.floor(p * (path.length - 1)))];
      }
      if (p >= 1) { this.ball = [...ballPos]; this._settleShot(); this._aimCamera(false); }
    } else {
      this._aimCamera(false);
    }

    const previewing = Math.abs(this.previewDy) > 0.5;
    const camY = this.cam.y + this.previewDy;
    const drawCam = { ...this.cam, y: camY, clamp: this.cam.clamp };

    const onGreen = this._onGreen();
    drawFrame(this.ctx, this.map, this.hole, drawCam, {
      dpr: this.dpr,
      ball: ballPos,
      height,
      holed: this.holed,
      aimRad: this.aimRad,
      hideAim: !!this.anim || this.holed,
      aimDots: onGreen ? null : aimDots(this.club, this._lie()),
      puttLine: onGreen ? Math.min(this._distToPin(), (MAX_PUTT_FT / FT_PER_YD)) : 0,
    });
    this._drawMeter(now, previewing);
    this.raf = requestAnimationFrame(this._frame);
  };

  /** The C-ring and the accuracy bar. The ring opens to the RIGHT with its ticks OUTSIDE the arc:
   *  25 at the bottom, 50 left, 75 upper-left, 100 top-right, a short green segment just before
   *  100 and the orange-to-red over-swing block beyond it (§5.1). */
  _drawMeter(now, faded) {
    const c = this.mctx;
    const W = this.meter.width; const H = this.meter.height;
    c.clearRect(0, 0, W, H);
    c.globalAlpha = faded ? 0.4 : 1;

    // The ring is centred on 80, not on the canvas midpoint: the tick labels sit OUTSIDE the arc
    // and the "50" at the far left needs the room. Laid out so every label clears the edge by
    // about 10px at the sizes below - check all four if any of them changes.
    const cx = 80; const cy = 68; const R = 46; const band = 13;
    const A0 = 90 * DEG; const A1 = 315 * DEG;
    const ang = (v) => A0 + (Math.min(RING_MAX, Math.max(0, v)) / RING_MAX) * (A1 - A0);

    // The band itself: dark, semi-transparent, white 1px outline, the course showing through.
    c.lineWidth = band;
    c.strokeStyle = 'rgba(16,20,12,0.72)';
    c.beginPath(); c.arc(cx, cy, R, A0, A1); c.stroke();
    // The green "good" segment just under 100, then the over-swing block past it.
    c.strokeStyle = '#37a13c';
    c.beginPath(); c.arc(cx, cy, R, ang(0.93), ang(1.0)); c.stroke();
    c.strokeStyle = '#e54e00';
    c.beginPath(); c.arc(cx, cy, R, ang(1.0), ang(1.05)); c.stroke();
    c.strokeStyle = '#c81f10';
    c.beginPath(); c.arc(cx, cy, R, ang(1.05), ang(RING_MAX)); c.stroke();
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.beginPath(); c.arc(cx, cy, R + band / 2, A0, A1); c.stroke();
    c.beginPath(); c.arc(cx, cy, R - band / 2, A0, A1); c.stroke();

    // Tick labels, OUTSIDE the arc. 11px is the repo's text-size floor and this is exactly it.
    c.fillStyle = '#fff';
    c.font = '700 11px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const v of [0.25, 0.5, 0.75, 1.0]) {
      const a = ang(v);
      c.fillText(String(v * 100), cx + Math.cos(a) * (R + band / 2 + 11), cy + Math.sin(a) * (R + band / 2 + 11));
    }

    const read = this.swing.read(now);
    // The white radial tick crossing the band.
    const a = ang(read.power);
    c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * (R - band / 2), cy + Math.sin(a) * (R - band / 2));
    c.lineTo(cx + Math.cos(a) * (R + band / 2), cy + Math.sin(a) * (R + band / 2));
    c.stroke();

    // The hub readout: the distance the PREVIOUS shot travelled. Labelled, unlike the reference,
    // whose unlabelled number reads as stale or wrong (§13 flaw 5).
    if (this.lastShotYd != null) {
      c.font = '600 10px system-ui, sans-serif';
      c.fillStyle = '#cfd8c2';
      const txt = this._onGreen() && this.lastShotYd * FT_PER_YD < 100
        ? `${(this.lastShotYd * FT_PER_YD).toFixed(1)} ${t('ft')}`
        : `${this.lastShotYd.toFixed(1)} ${t('yds')}`;
      c.fillText(txt, cx, cy + 4);
    }

    // The accuracy bar at the foot of the ring: red | orange | GREEN | orange | red, with a white
    // vertical marker. The green band NARROWS on a bad lie (clubs.js's LIES.zone) - shown, not
    // hidden: leaving it looking normal while punishing the same stop harder reads as cheating.
    const bx = 8; const bw = W - 16; const by = 128; const bh = 16;
    const zone = lieOf(this._lie()).zone;
    const b = bandsFor(zone);
    const seg = (from, to, fill) => {
      c.fillStyle = fill;
      c.fillRect(bx + bw * from, by, bw * (to - from), bh);
    };
    seg(0, (1 - b.orange) / 2, '#c81f10');
    seg((1 - b.orange) / 2, (1 - b.green) / 2, '#e54e00');
    seg((1 - b.green) / 2, (1 + b.green) / 2, '#37a13c');
    seg((1 + b.green) / 2, (1 + b.orange) / 2, '#e54e00');
    seg((1 + b.orange) / 2, 1, '#c81f10');
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1;
    c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    if (this.swing.phase === PHASE.ACCURACY || this.swing.phase === PHASE.LIVE) {
      c.fillStyle = '#fff';
      c.fillRect(bx + bw * read.bar - 1.5, by - 3, 3, bh + 6);
    }
    c.globalAlpha = 1;
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
