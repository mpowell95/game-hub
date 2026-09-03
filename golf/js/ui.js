// golf/js/ui.js - DOM shell: HUD, tap capture, playback, autosave, module contract. The ONLY
// file that touches the DOM except render.js/camera.js (three.js). See §13 of GOLF-HANDOFF.md.
//
// game.js owns every round RULE (strokes, penalties, max-strokes, wind roll, points, hole
// advance, serialize/restore) - this file only calls it and paints. It never mutates
// round.strokes/points/ball/wind/phase/hole itself; round.club is the one field it DOES write
// directly, and only as the player's own override (the club-row tap), which is a choice being
// recorded, not a rule being applied. See DECISIONS.md#part5-scope.

import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { diffShapeSVG } from '../../js/difficulty-tiers.js';
import { loadStats, recordGolf } from '../../js/game-stats.js';
import { courseMode } from '../../js/admin-config.js';
import { isDevProfile } from '../../js/challenge/hooks.js';
import { loadProfile } from '../../js/profile-store.js';

import { build, S, heightAt } from './terrain.js';
import { simulateShot } from './physics.js';
import { pos, aimDeg as aimDegOf, power01 as power01Of, spin01 as spin01Of, DIFF } from './meters.js';
import { CLUBS, autoSelectClub, selectableClubs, TARGET_CARRY_M, lieSpeedMod } from './clubs.js';
import { Renderer } from './render.js';
import { CameraRig, createCamera, applyHFov } from './camera.js';
import { Minimap, MAP_W, MAP_H } from './minimap.js';
import { COURSES, courseById } from '../courses/registry.js';
import { STRINGS } from './strings.js';
import { createRound, restoreRound, applyShotResult, roundTotal } from './game.js';

const SETTINGS_KEY = 'gamehub.golf.v1';
const t = makeT(STRINGS);

function ensureCSS() {
  const uiHref = new URL('../../css/ui.css', import.meta.url).href;
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = uiHref;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  const golfHref = new URL('../css/golf.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${golfHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = golfHref;
    document.head.appendChild(link);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { difficulty: 'standard', lastCourse: 'harbor', round: null };
    const s = JSON.parse(raw);
    return {
      difficulty: s.difficulty || 'standard',
      lastCourse: s.lastCourse || 'harbor',
      round: s.round || null,
    };
  } catch { return { difficulty: 'standard', lastCourse: 'harbor', round: null }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* best effort */ }
}

function toYards(m) { return m / 0.9144; }
function toMph(mps) { return mps * 2.23694; }
function bearingDeg(a, b) { return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; }
function heightAtBall(t, b) { return heightAt(t, b.x, b.z); }

// Presentation only - which scorecard-cell shape to draw for a given strokes/par delta. Not a
// round rule (it decides nothing about strokes or points, both owned by game.js), just a CSS
// class choice; see §13.3's colorblind shape table.
function cellMarkClass(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return 'gf-cell__mark--circle-fill';
  if (d === -1) return 'gf-cell__mark--circle-hollow';
  if (d === 0) return null;
  if (d === 1) return 'gf-cell__mark--square-hollow';
  return 'gf-cell__mark--square-fill';
}

class GolfGame {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.course = courseById(this.settings.lastCourse) || COURSES[0];
    // Validate/normalize whatever was saved through game.js's own restore rule (§13.7's shape),
    // never trusting raw localStorage - see restoreRound's header. An unusable save reads as no
    // save (§13.4's Play button).
    this.settings.round = restoreRound(this.settings.round, this.course);
    this.destroyed = false;
    this._resizeUnsub = null;
    this.raf = null;
    this._lastFrame = 0;
    this._pointerId = null;
    this._pointerStart = null;
    this._pointerMoved = 0;
    this._dragLastX = null;
    // Longest qualifying drive so far THIS round (§11: driver/3-wood off the tee, landing on
    // fairway/green/fringe/tee). UI-transient, not part of game.js's round-state contract - see
    // DECISIONS.md#part8-scope for why, and the one accepted limitation that comes with it.
    this._roundLongestDriveYd = 0;

    // ONE persistent .gf-root for the life of this instance - every other class (.gf-setup,
    // .gf-play, .gf-top, .gf-view, ...) is a genuine DESCENDANT of it, matching the
    // .gf-root .gf-x descendant-scoping convention every CSS rule in golf.css relies on.
    // (Putting .gf-root and a screen class on the SAME element was tried first and is wrong -
    // "A B" never matches when A and B are the same node - see DECISIONS.md#part4-scope.)
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'gf-root';
    // Part 9A: when mounted in the hub, the hub draws its own floating back pill at
    // max(safe-area-top, 54px) x 10px (css/hub.css .hub-top-immersive). The play screen reserves
    // the top strip's left 104 x 56 box for it and pads its top by the same formula, so the pill
    // always lands inside that box - on a notch phone AND on a no-notch one. Standalone
    // (golf/index.html, no hub) the game draws its own back button in that box instead.
    this.inHub = !!document.querySelector('.hub-top .hub-back');
    if (this.inHub) {
      this.rootEl.classList.add('gf-in-hub');
      this.rootEl.style.setProperty('--gf-hub-pad', '54px');
    }
    this.container.appendChild(this.rootEl);

    this._renderSetup();
  }

  // ---------------------------------------------------------------- setup screen ----
  // Course release state (§14 of GOLF-HANDOFF.md, Part 8): open -> playable; unlockable ->
  // playable if the PREVIOUS course in COURSES order has a bestRoundByCourse entry (the first
  // course has no previous course, so it needs no prerequisite); testing -> locked for everyone
  // but the dev profile, and (in _startNewRound) recorded to the practice bucket instead of the
  // real counters. Resuming an already-saved round is never blocked by a course's CURRENT mode -
  // locking only stops a NEW round from starting, it never takes back one already in progress.
  _courseLockInfo(course) {
    const mode = courseMode(course.id);
    const dev = isDevProfile((loadProfile() || {}).name);
    let gf = null;
    try { const st = loadStats(); gf = st && st.games && st.games.golf && st.games.golf.gf; } catch { /* best effort */ }
    const idx = COURSES.indexOf(course);
    const prevOk = idx <= 0 || !!(gf && gf.bestRoundByCourse && gf.bestRoundByCourse[COURSES[idx - 1].id] !== undefined);
    const locked = mode === 'testing' ? !dev : (mode === 'unlockable' ? !prevOk : false);
    const best = gf && gf.bestRoundByCourse ? gf.bestRoundByCourse[course.id] : undefined;
    return { mode, locked, best };
  }

  _renderSetup() {
    this._stopLoop();
    this._teardownPlayDom();
    this.rootEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'gf-setup';
    const hasSave = !!this.settings.round;
    const { locked, best } = this._courseLockInfo(this.course);
    // Starting a NEW round needs the course unlocked; resuming one already saved never does.
    const canStartNew = !locked;

    const tierOfDiff = { casual: 1, standard: 2, pro: 3 };
    const diffKeys = ['casual', 'standard', 'pro'];

    root.innerHTML = `
      <div class="gf-setup__title">${t('title')}</div>
      <div class="gf-setup__section">
        <button type="button" class="gf-course-tile" data-role="course" data-locked="${locked}" ${locked ? 'disabled' : ''}>
          <div>
            <div class="gf-course-tile__name">${t('course_harbor')}</div>
            <div class="gf-course-tile__meta">${locked ? t('locked') : `${t('par')} ${this.course.par}${best !== undefined ? ' · ' + best : ''}`}</div>
          </div>
          ${locked ? `<svg class="gf-course-tile__lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="1.5"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>` : ''}
        </button>
      </div>
      <div class="gf-setup__section">
        <div class="gh-seg" role="radiogroup">
          ${diffKeys.map(k => `
            <button type="button" class="gh-seg__item gf-diff-item" data-diff="${k}"
              aria-pressed="${this.settings.difficulty === k}">
              ${diffShapeSVG(tierOfDiff[k])}<span>${t('diff_' + k)}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="gf-setup__actions">
        ${hasSave ? `
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>
          ${canStartNew ? `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${t('new_round')}</button>` : ''}
        ` : (canStartNew ? `
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="play">${t('play')}</button>
        ` : '')}
      </div>
    `;
    this.rootEl.appendChild(root);

    root.querySelectorAll('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.difficulty = btn.getAttribute('data-diff');
        saveSettings(this.settings);
        root.querySelectorAll('[data-diff]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      });
    });
    const playBtn = root.querySelector('[data-role="play"]');
    if (playBtn) playBtn.addEventListener('click', () => this._startNewRound());
    const resumeBtn = root.querySelector('[data-role="resume"]');
    if (resumeBtn) resumeBtn.addEventListener('click', () => this._resumeRound());
    const newBtn = root.querySelector('[data-role="new"]');
    if (newBtn) newBtn.addEventListener('click', () => this._startNewRound());
  }

  _startNewRound() {
    // The one piece of round setup that is genuinely random rather than a rule - game.js must
    // never call Math.random (§15), so a fresh round's seed is rolled here and handed in.
    const seed = Math.floor(Math.random() * 1e9);
    // Practice is decided ONCE, here, and frozen for the round's whole lifetime (persisted by
    // game.js, same as difficulty/seed) - re-checking mid-round would let an admin's later flip
    // change what an in-progress round records to, which is exactly the contamination the
    // practice bucket exists to prevent. See DECISIONS.md#part8-scope.
    const practice = courseMode(this.course.id) === 'testing';
    this._roundLongestDriveYd = 0;
    this.round = createRound(this.course, this.settings.difficulty, seed, practice);
    this._enterPlay(true);
  }

  _resumeRound() {
    this.round = this.settings.round;
    // Not persisted (see the constructor's note) - a resume starts this at 0, so a drive hit
    // before the app was closed cannot be credited on this session's eventual recordGolf call.
    // Accepted: the worst case is an undercounted longestDriveYd on the rare round that gets
    // closed and reopened, never a lost or wrong STROKE/POINTS number.
    this._roundLongestDriveYd = 0;
    this._enterPlay(false);
  }

  // ---------------------------------------------------------------- play mount ----
  _enterPlay(isFreshHole) {
    this._teardownPlayDom();
    this.rootEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'gf-play';
    root.innerHTML = `
      <div class="gf-top">
        <div class="gf-top__slot">${this.inHub ? '' : `<button type="button" class="gf-back" data-role="back" aria-label="${t('back')}">&larr;</button>`}</div>
        <div class="gf-top-info" data-role="topinfo"></div>
        <div class="gf-wind" data-role="wind">
          <svg class="gf-wind-arrow" data-role="windarrow" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 2v20M12 2l-5 5M12 2l5 5"/></svg>
          <span data-role="windmph"></span>
        </div>
      </div>
      <div class="gf-card" data-role="card"></div>
      <div class="gf-view" data-role="view">
        <div class="gf-dist" data-role="dist"></div>
        <div class="gf-flash" data-role="flash"></div>
        <canvas class="gf-map" data-role="map" data-show="false" width="${MAP_W}" height="${MAP_H}" aria-hidden="true"></canvas>
      </div>
      <div class="gf-bar" data-role="bar">
        <button type="button" class="gf-club-chip" data-role="clubchip"></button>
        <div class="gf-pin-dist" data-role="pindist"></div>
        <div class="gf-lie" data-role="lie"></div>
      </div>
      <div class="gf-meters" data-role="meters">
        ${['aim', 'power', 'spin'].map((k) => `
          <div class="gf-meter" data-meter="${k}" data-state="pending">
            <div class="gf-meter__label">${t('meter_' + k)}</div>
            <div class="gf-meter__track"></div>
            <div class="gf-meter__flash"></div>
            <div class="gf-meter__marker" style="display:none"></div>
          </div>`).join('')}
      </div>
    `;
    this.rootEl.appendChild(root);
    this.dom = {
      root,
      topinfo: root.querySelector('[data-role="topinfo"]'),
      windarrow: root.querySelector('[data-role="windarrow"]'),
      windmph: root.querySelector('[data-role="windmph"]'),
      card: root.querySelector('[data-role="card"]'),
      view: root.querySelector('[data-role="view"]'),
      dist: root.querySelector('[data-role="dist"]'),
      flash: root.querySelector('[data-role="flash"]'),
      bar: root.querySelector('[data-role="bar"]'),
      clubchip: root.querySelector('[data-role="clubchip"]'),
      pindist: root.querySelector('[data-role="pindist"]'),
      lie: root.querySelector('[data-role="lie"]'),
      meters: root.querySelector('[data-role="meters"]'),
      map: root.querySelector('[data-role="map"]'),
    };

    // Standalone only - in the hub the reserved slot is empty and the hub's own pill does this.
    const backBtn = root.querySelector('[data-role="back"]');
    if (backBtn) backBtn.addEventListener('click', () => this._backToSetup());

    const canvas = document.createElement('canvas');
    this.dom.view.insertBefore(canvas, this.dom.view.firstChild);
    this.canvas = canvas;

    this.hole = this.course.holes[this.round.hole - 1];
    this.terrain = build(this.hole);
    this.renderer = new Renderer(canvas, this.terrain);
    if (!this.camera) this.camera = createCamera(1);
    this.camRig = new CameraRig(this.camera, this.terrain);
    // Part 9A: the overhead map. Base raster once per hole; overlays on every aim change.
    this.minimap = new Minimap(this.dom.map, this.terrain);
    this._bindMap();

    // round.ball and round.wind are already correct for this hole - set by game.js's
    // createRound (hole 1) or applyShotResult's hole-advance (every hole after) - never
    // recomputed here.
    this._resizeUnsub = onViewportResize(() => this._resize(), { immediate: true });

    this._bindInput();
    this._paintTop();
    this._paintCard();
    this._paintWind();

    this._saveRound();

    if (isFreshHole || this.round.phase === 'intro') {
      this.round.phase = 'intro';
      this.camRig.setIntro(this.hole);
      this._introSkippable = true;
    } else {
      this._beginAddress();
    }

    this._startLoop();
  }

  _resize() {
    if (!this.renderer || !this.camera) return;
    const w = this.dom.view.clientWidth || 1;
    const h = this.dom.view.clientHeight || 1;
    this.renderer.resize(w, h, this.camera);
    applyHFov(this.camera);   // 50 deg HORIZONTAL fov at whatever aspect the view has now (Part 9A)
  }

  // ---------------------------------------------------------------- HUD paint ----
  _paintTop() {
    const par = this.hole.par;
    const yd = Math.round(toYards(Math.hypot(this.hole.pin[0] - this.hole.tee[0], this.hole.pin[1] - this.hole.tee[1])));
    this.dom.topinfo.textContent = `${t('hole')} ${this.hole.n} · ${t('par')} ${par} · ${yd} ${t('yd')}`;
  }
  _paintWind() {
    const w = this.round.wind;
    const mph = Math.round(toMph(Math.hypot(w.x, w.z)));
    const bearing = Math.atan2(w.x, w.z) * 180 / Math.PI;
    this.dom.windarrow.style.transform = `rotate(${bearing}deg)`;
    this.dom.windmph.textContent = `${mph} ${t('mph')}`;
  }
  _paintCard() {
    const n = this.course.holes.length;
    let html = '';
    for (let i = 0; i < n; i++) {
      const strokes = this.round.strokes[i];
      const par = this.course.holes[i].par;
      const current = (i + 1) === this.round.hole;
      const markCls = strokes > 0 ? cellMarkClass(strokes, par) : null;
      html += `<div class="gf-cell" data-current="${current}">
        <div class="gf-cell__num">${i + 1}</div>
        <div class="gf-cell__strokes">${strokes > 0 ? strokes : ''}</div>
        ${markCls ? `<div class="gf-cell__mark ${markCls}"></div>` : ''}
      </div>`;
    }
    const total = this.round.points.reduce((a, p) => a + (p || 0), 0);
    const anyPts = this.round.points.some((p) => p !== null);
    html += `<div class="gf-cell gf-cell--pts">${anyPts ? (total >= 0 ? '+' + total : total) : '–'}</div>`;
    this.dom.card.innerHTML = html;
  }
  _paintBar() {
    const ball = this.round.ball;
    const lieKey = ball.lie;
    const club = this._currentClub();
    this.dom.clubchip.textContent = club ? club.name.en : '';
    const distYd = Math.round(toYards(Math.hypot(this.hole.pin[0] - ball.x, this.hole.pin[1] - ball.z)));
    this.dom.pindist.textContent = `${distYd} ${t('yd')}`;
    this.dom.lie.textContent = t('lie_' + lieKey);
  }

  _currentClub() {
    const id = this.round.club || autoSelectClub(this.round.ball.lie, Math.hypot(this.hole.pin[0] - this.round.ball.x, this.hole.pin[1] - this.round.ball.z), this._headwindComponent());
    return CLUBS.find((c) => c.id === id);
  }
  _headwindComponent() {
    // wind component opposing the ball->pin direction, positive = headwind
    const ball = this.round.ball;
    const dx = this.hole.pin[0] - ball.x, dz = this.hole.pin[1] - ball.z;
    const len = Math.hypot(dx, dz) || 1;
    const dirX = dx / len, dirZ = dz / len;
    const w = this.round.wind;
    return -(w.x * dirX + w.z * dirZ);
  }

  // ---------------------------------------------------------------- shot state machine ----
  _beginAddress() {
    const ball = this.round.ball;
    const isPutt = ball.lie === 'green';
    const distToTarget = Math.hypot(this.hole.target[0] - ball.x, this.hole.target[1] - ball.z);
    const distToPin = Math.hypot(this.hole.pin[0] - ball.x, this.hole.pin[1] - ball.z);
    this.targetBearingDeg = distToTarget > 30 ? bearingDeg([ball.x, ball.z], this.hole.target) : bearingDeg([ball.x, ball.z], this.hole.pin);

    // round.club stays whatever it is (null = auto, or the player's own override from the club
    // row) - _currentClub() already ORs in autoSelectClub() at read time, so writing a concrete
    // id back here would collapse "auto" into "override" for no reason. See DECISIONS.md#part5-scope.
    this.round.phase = isPutt ? 'putt' : 'address';
    this._paintBar();
    this._paintCard();

    if (isPutt) this.camRig.setPutt(ball, this.targetBearingDeg);
    else this.camRig.setAddress(ball, this.targetBearingDeg);

    // Part 9A: the 3D aim line + landing ring appear on the first pointerdown in the view and
    // stay until launch; the minimap is up for the whole address/putt.
    this._aimShown = false;
    this.dom.map.setAttribute('data-show', 'true');
    this._updateAimTarget();
    this._startMeterSequence(isPutt);
    // Autosave here, not only after a shot resolves: without this, a save taken while the
    // player is standing at address (the common "close the app mid-shot" moment) still carried
    // phase:'flight' from the PREVIOUS shot's _fireShot(), which _applyResult never corrected
    // once the ball was back at rest. Resuming worked by coincidence (('flight' !== 'intro') took
    // the same _beginAddress() branch as a genuine 'address'/'putt' save), but the persisted
    // phase was lying. See DECISIONS.md#part5-scope.
    this._saveRound();
  }

  // Predicted carry for the landing ring: the club's target carry scaled by the lie's speed
  // modifier (a driver from the rough carries 85% of its fairway number, §5). For a putt it is
  // the putter's 100% roll, which is what the ring on the green should mean.
  _predictedCarryM() {
    const club = this._currentClub();
    const lie = this.round.ball.lie;
    if (club.id === 'pt') return 36 * lieSpeedMod(lie, 'pt');
    return (TARGET_CARRY_M[club.id] || 100) * lieSpeedMod(lie, club.id);
  }

  _updateAimTarget() {
    const ball = this.round.ball;
    const carry = this._predictedCarryM();
    if (this._aimShown) this.renderer.setAimTarget({ x: ball.x, z: ball.z }, this.targetBearingDeg, carry);
    else this.renderer.setAimTarget(null, 0, 0);
    if (this.minimap) this.minimap.update(ball, this.targetBearingDeg, carry, this.hole.pin);
  }

  // The one path every aim change takes (view drag, map tap, map drag): update the bearing,
  // redraw the aim line/ring/minimap, and orbit the camera to the new a-hat (0.25 s ease, ball
  // pinned at 30% up - camera.js). Never during a swing that has started or in flight.
  _setAimDeg(deg) {
    if (!this.round || (this.round.phase !== 'address' && this.round.phase !== 'putt')) return;
    if (this._meterStage && this._meterStage !== 'aim') return;   // aim is locked once the swing starts
    this.targetBearingDeg = deg;
    this._updateAimTarget();
    const ball = this.round.ball;
    const y = heightAtBall(this.terrain, ball);
    this.camRig.aimTo({ x: ball.x, y, z: ball.z }, this.targetBearingDeg, this._isPutt);
  }

  // Minimap input (Part 9A): a tap sets a-hat to the bearing from the ball to the tapped world
  // point; a drag does the same continuously. Handled on the canvas itself and stopped there, so
  // the view's own tap/drag capture never sees it (a map tap must not fire the swing).
  _bindMap() {
    const map = this.dom.map;
    let active = null;
    const aimAt = (e) => {
      const r = map.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (MAP_W / r.width);
      const my = (e.clientY - r.top) * (MAP_H / r.height);
      this._setAimDeg(this.minimap.bearingFromTap(this.round.ball, mx, my));
    };
    const onDown = (e) => {
      e.stopPropagation();
      if (!this.round || (this.round.phase !== 'address' && this.round.phase !== 'putt')) return;
      active = e.pointerId;
      try { map.setPointerCapture(e.pointerId); } catch { /* not capturable: taps still work */ }
      this._aimShown = true;
      aimAt(e);
    };
    const onMove = (e) => {
      if (active !== e.pointerId) return;
      e.stopPropagation();
      aimAt(e);
    };
    const onUp = (e) => {
      if (active !== e.pointerId) return;
      e.stopPropagation();
      active = null;
    };
    map.addEventListener('pointerdown', onDown);
    map.addEventListener('pointermove', onMove);
    map.addEventListener('pointerup', onUp);
    map.addEventListener('pointercancel', onUp);
    this._unbindMap = () => {
      map.removeEventListener('pointerdown', onDown);
      map.removeEventListener('pointermove', onMove);
      map.removeEventListener('pointerup', onUp);
      map.removeEventListener('pointercancel', onUp);
    };
  }

  _startMeterSequence(isPutt) {
    this._isPutt = isPutt;
    this._aimP = null; this._powerP = null; this._spinP = null;
    this._meterStage = 'aim';
    this._meterStartT = performance.now();
    this._paintMeterStates();
  }

  _paintMeterStates() {
    const rows = this.dom.meters.querySelectorAll('.gf-meter');
    rows.forEach((row) => {
      const kind = row.getAttribute('data-meter');
      let state = 'pending';
      if (kind === 'aim') state = this._meterStage === 'aim' ? 'live' : (this._aimP !== null ? 'done' : 'pending');
      if (kind === 'power') state = this._meterStage === 'power' ? 'live' : (this._powerP !== null ? 'done' : 'pending');
      if (kind === 'spin') {
        if (this._isPutt) state = 'pending';
        else state = this._meterStage === 'spin' ? 'live' : (this._spinP !== null ? 'done' : 'pending');
      }
      row.setAttribute('data-state', state);
      const marker = row.querySelector('.gf-meter__marker');
      if (state === 'pending') { marker.style.display = 'none'; }
      else { marker.style.display = ''; }
      if (kind === 'power') this._paintSweetBand(row);
    });
  }
  _paintSweetBand(row) {
    let sweet = row.querySelector('.gf-meter__sweet');
    let notch = row.querySelector('.gf-meter__notch');
    const [lo, hi] = DIFF[this.round.difficulty].sweet;
    if (!sweet) {
      sweet = document.createElement('div'); sweet.className = 'gf-meter__sweet';
      row.insertBefore(sweet, row.querySelector('.gf-meter__flash'));
    }
    if (!notch) {
      notch = document.createElement('div'); notch.className = 'gf-meter__notch';
      row.appendChild(notch);
    }
    sweet.style.left = (lo * 100) + '%';
    sweet.style.width = ((hi - lo) * 100) + '%';
    notch.style.left = `calc(${lo * 100}% - 5px)`;
  }

  _tickMeters() {
    if (this._meterStage !== 'aim' && this._meterStage !== 'power' && this._meterStage !== 'spin') return;
    const diff = DIFF[this.round.difficulty];
    const T = this._meterStage === 'aim' ? diff.aimT : this._meterStage === 'power' ? diff.powerT : diff.spinT;
    const elapsed = (performance.now() - this._meterStartT) / 1000;
    const p = pos(elapsed, T);
    const row = this.dom.meters.querySelector(`[data-meter="${this._meterStage}"]`);
    const marker = row.querySelector('.gf-meter__marker');
    marker.style.left = `calc(${p * 100}% - 2px)`;
  }

  _handleShotTap() {
    if (this._meterStage === 'aim') {
      const diff = DIFF[this.round.difficulty];
      const T = diff.aimT;
      const elapsed = (performance.now() - this._meterStartT) / 1000;
      this._aimP = pos(elapsed, T);
      this._freezeMarker('aim', this._aimP);
      this._meterStage = 'gap1';
      this._paintMeterStates();
      setTimeout(() => {
        if (this.destroyed || this.round.phase === 'flight') return;
        this._meterStage = 'power';
        this._meterStartT = performance.now();
        this._paintMeterStates();
      }, 150);
    } else if (this._meterStage === 'power') {
      const diff = DIFF[this.round.difficulty];
      const T = diff.powerT;
      const elapsed = (performance.now() - this._meterStartT) / 1000;
      this._powerP = pos(elapsed, T);
      this._freezeMarker('power', this._powerP);
      const [lo, hi] = diff.sweet;
      if (this._powerP >= lo && this._powerP <= hi) this._flashSweet();
      if (this._isPutt) {
        this._meterStage = 'fired';
        this._fireShot();
      } else {
        this._meterStage = 'gap2';
        this._paintMeterStates();
        setTimeout(() => {
          if (this.destroyed || this.round.phase === 'flight') return;
          this._meterStage = 'spin';
          this._meterStartT = performance.now();
          this._paintMeterStates();
        }, 150);
      }
    } else if (this._meterStage === 'spin') {
      const diff = DIFF[this.round.difficulty];
      const T = diff.spinT;
      const elapsed = (performance.now() - this._meterStartT) / 1000;
      this._spinP = pos(elapsed, T);
      this._freezeMarker('spin', this._spinP);
      this._meterStage = 'fired';
      this._fireShot();
    }
    // taps during 'gap1'/'gap2'/'fired' are ignored
  }
  _freezeMarker(kind, p) {
    const row = this.dom.meters.querySelector(`[data-meter="${kind}"]`);
    const marker = row.querySelector('.gf-meter__marker');
    marker.style.left = `calc(${p * 100}% - 2px)`;
  }
  _flashSweet() {
    const row = this.dom.meters.querySelector('[data-meter="power"]');
    const flash = row.querySelector('.gf-meter__flash');
    flash.classList.remove('gf-flash-on');
    void flash.offsetWidth;
    flash.classList.add('gf-flash-on');
  }

  _fireShot() {
    this._paintMeterStates();
    const ball = this.round.ball;
    const club = this._currentClub();
    // Captured here, before this shot's outcome can change round.ball.lie: §11's longest-drive
    // rule needs the FROM lie and club of THIS shot, read in _applyResult once the result exists.
    this._lastShotClub = club.id;
    this._lastShotFromTee = ball.lie === 'tee';
    const aimOffset = this._isPutt ? aimDegOf(this._aimP, DIFF[this.round.difficulty].puttRange) : aimDegOf(this._aimP, DIFF[this.round.difficulty].aimRange);
    const dirDeg = this.targetBearingDeg + aimOffset;
    const power = power01Of(this._powerP);
    const spin = this._isPutt ? 0 : spin01Of(this._spinP);
    const seed = this.round.hole * 1000 + this.round.strokes.reduce((a, s) => a + s, 0) + 1;

    const result = simulateShot(this.terrain, {
      from: { x: ball.x, z: ball.z },
      dirDeg, clubId: club.id, lie: ball.lie,
      power01: power, spin01: spin, wind: this.round.wind, seed,
    });

    this.renderer.setAimTarget(null, 0, 0);
    this._aimShown = false;
    this.dom.map.setAttribute('data-show', 'false');   // Part 9A: no map during flight
    this.round.phase = 'flight';
    this.camRig.setFlight(dirDeg);
    this._flightSamples = result.samples;
    this._flightResult = result;
    this._flightStartMs = performance.now();
    this._flightFrom = { x: ball.x, z: ball.z };
    this._flightTrail = [];
    this.dom.dist.setAttribute('data-show', 'true');
  }

  _stepFlight() {
    const elapsed = (performance.now() - this._flightStartMs) / 1000;
    const samples = this._flightSamples;
    if (!this._flightIdx) this._flightIdx = 0;
    while (this._flightIdx < samples.length - 1 && samples[this._flightIdx].t < elapsed) this._flightIdx++;
    const s = samples[this._flightIdx];
    this.renderer.setBallPosition(s.x, s.y, s.z);
    this._flightTrail.push({ x: s.x, y: s.y, z: s.z });
    this.renderer.setTrail(this._flightTrail);
    this.camRig.update(1 / 60, s);
    const distM = Math.hypot(s.x - this._flightFrom.x, s.z - this._flightFrom.z);
    this.dom.dist.textContent = `${Math.round(toYards(distM))} ${t('yd')}`;

    if (this._flightIdx >= samples.length - 1) {
      this._flightIdx = 0;
      this.dom.dist.setAttribute('data-show', 'false');
      this._applyResult(this._flightResult);
    }
  }

  _applyResult(result) {
    // §11: longest drive counts a tee shot with driver/3-wood that finishes on FAIRWAY/GREEN/
    // FRINGE/TEE (holing out counts too - it is a fairway-or-better finish by definition). Read
    // directly off `result` (untouched by applyShotResult's mutation below), never off
    // round.ball - on a hole-advancing shot, round.ball is about to be overwritten with the NEXT
    // hole's tee position before this function returns. See DECISIONS.md#part8-scope.
    if (this._lastShotFromTee && (this._lastShotClub === 'dr' || this._lastShotClub === '3w')
      && result.outcome !== 'water' && result.outcome !== 'ob') {
      const goodSurf = result.outcome === 'hole'
        || result.lie === S.FAIRWAY || result.lie === S.GREEN || result.lie === S.FRINGE || result.lie === S.TEE;
      if (goodSurf) {
        const yd = result.carryM / 0.9144;
        if (yd > this._roundLongestDriveYd) this._roundLongestDriveYd = yd;
      }
    }

    // game.js owns every rule this used to apply inline: stroke +1, water/OB penalty, max
    // strokes, the points table, and (new in Part 5) hole-to-hole advance - rolling the next
    // hole's wind and ball placement, or ending the round on hole 9. This function only paints
    // and animates what `outcome` reports happened. See DECISIONS.md#part5-scope.
    const outcome = applyShotResult(this.round, this.course, result);
    this._saveRound();
    this._paintCard();

    if (outcome.penaltyKey) this._showFlash(t(outcome.penaltyKey));

    const afterFlash = () => {
      if (outcome.roundOver) {
        this._showRoundSummary();
      } else if (outcome.holeAdvanced) {
        this._enterPlay(true);
      } else {
        this.camRig.setRest(this.round.ball, this.hole.pin);
        this._beginAddress();
      }
    };

    if (outcome.holed || outcome.maxed) {
      // Use result.rest (has y) rather than round.ball - by this point round.ball may already
      // have been overwritten with the NEXT hole's tee position (applyShotResult's hole-advance
      // branch), but `this.hole` (ui.js's cached hole-def) still correctly refers to the hole
      // that was just finished, same as `this.hole.pin` below.
      this.camRig.setRest(result.rest, this.hole.pin);
      setTimeout(() => this._showFlash(t(outcome.resultKey), afterFlash), outcome.penaltyKey ? 2000 : 0);
    } else if (outcome.penaltyKey) {
      setTimeout(afterFlash, 2000);
    } else {
      afterFlash();
    }
  }

  _showFlash(text, onDone) {
    this.dom.flash.textContent = text;
    this.dom.flash.classList.remove('gf-flash-show');
    void this.dom.flash.offsetWidth;
    this.dom.flash.classList.add('gf-flash-show');
    if (onDone) setTimeout(onDone, 1900);
  }

  // ---------------------------------------------------------------- round summary ----
  _showRoundSummary() {
    this._stopLoop();
    this._teardownPlayDom();
    this.rootEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'gf-summary';

    const holes = this.course.holes;
    const strokes = this.round.strokes;
    const points = this.round.points;
    const totalStrokes = strokes.reduce((a, s) => a + s, 0);
    const totalPoints = roundTotal(this.round);
    const fmtPts = (n) => (n >= 0 ? '+' + n : String(n));

    // Ace/eagle/birdie counts for recordGolf's extras (§11). No separate "albatross" bucket
    // exists in ensureGf's shape, so d <= -2 (eagle-or-better) folds into eagles, same precedence
    // game.js's own resultKey() uses (ace first - strokes===1 - then eagle-or-better, then birdie).
    let birdies = 0, eagles = 0, aces = 0;
    holes.forEach((h, i) => {
      const s = strokes[i];
      if (!s) return;
      if (s === 1) { aces++; return; }
      const d = s - h.par;
      if (d <= -2) eagles++;
      else if (d === -1) birdies++;
    });

    let rows = holes.map((h, i) => `
      <tr>
        <td>${h.n}</td>
        <td>${h.par}</td>
        <td>${strokes[i] || ''}</td>
        <td>${points[i] !== null ? fmtPts(points[i]) : ''}</td>
      </tr>`).join('');
    rows += `
      <tr>
        <td>${t('total')}</td>
        <td>${this.course.par}</td>
        <td>${totalStrokes}</td>
        <td>${fmtPts(totalPoints)}</td>
      </tr>`;

    // "Skill level before -> after": before is read BEFORE recordGolf writes this round, so it
    // is genuinely the player's history up to (not including) the round just finished.
    let before = 0;
    try {
      const st = loadStats();
      const gf = st && st.games && st.games.golf && st.games.golf.gf;
      if (gf && Number.isFinite(gf.points)) before = gf.points;
    } catch { /* best effort read */ }
    const after = before + totalPoints;

    // Record exactly once, here - the only place a finished round is ever reachable. `practice`
    // was decided once at _startNewRound and is frozen on the round for its whole lifetime
    // (game.js's round.practice), so an admin flip mid-round can never retarget where THIS
    // round's numbers land. See DECISIONS.md#part8-scope.
    try {
      recordGolf(this.round.difficulty, {
        holes: holes.length,
        strokes: totalStrokes,
        points: totalPoints,
        birdies, eagles, aces,
        longestDriveYd: Math.round(this._roundLongestDriveYd || 0),
        courseId: this.round.courseId,
        practice: !!this.round.practice,
      });
    } catch (err) { console.error('[golf] recordGolf failed', err); }

    root.innerHTML = `
      <table class="gf-summary-table">
        <thead><tr><th>${t('hole')}</th><th>${t('par')}</th><th>${t('strokes')}</th><th>${t('pts')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="gf-summary-skill">${t('skill')} ${fmtPts(before)} &rarr; ${fmtPts(after)}</div>
      <div class="gf-summary-actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="again">${t('again')}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="back">${t('back')}</button>
      </div>
    `;
    this.rootEl.appendChild(root);

    // §8: "clear the autosaved round" on finishing hole 9.
    this.settings.round = null;
    this.round = null;
    saveSettings(this.settings);

    root.querySelector('[data-role="again"]').addEventListener('click', () => this._startNewRound());
    root.querySelector('[data-role="back"]').addEventListener('click', () => this._renderSetup());
  }

  // ---------------------------------------------------------------- input ----
  _bindInput() {
    const root = this.dom.root;
    // Part 9A: a horizontal drag ANYWHERE in the view (not just its upper half) aims, at 0.12 deg
    // per px, in both address and putt. The minimap handles its own pointer events and stops
    // them (see _bindMap), so nothing here ever sees a map touch. The first pointerdown in the
    // view also reveals the 3D aim line + landing ring, which then stay up until launch.
    const onDown = (e) => {
      this._pointerId = e.pointerId;
      this._pointerStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      this._pointerMoved = 0;
      this._dragLastX = e.clientX;
      this._dragging = false;
      const aiming = this.round && (this.round.phase === 'address' || this.round.phase === 'putt');
      this._dragInView = !!(aiming && e.target.closest && e.target.closest('.gf-view'));
      if (this._dragInView && !this._aimShown && this._meterStage === 'aim') {
        this._aimShown = true;
        this._updateAimTarget();
      }
    };
    const onMove = (e) => {
      if (this._pointerId !== e.pointerId || !this._pointerStart) return;
      const dx = e.clientX - this._pointerStart.x, dy = e.clientY - this._pointerStart.y;
      this._pointerMoved = Math.max(this._pointerMoved, Math.hypot(dx, dy));
      if (this._dragInView) {
        const stepX = e.clientX - this._dragLastX;
        this._dragLastX = e.clientX;
        if (Math.abs(stepX) > 0.5) {
          this._dragging = true;
          this._setAimDeg(this.targetBearingDeg + stepX * 0.12);
        }
      }
    };
    const onUp = (e) => {
      if (this._pointerId !== e.pointerId || !this._pointerStart) return;
      const dt = performance.now() - this._pointerStart.t;
      // A cancelled pointer (the browser took the gesture - a scroll, a system edge swipe) is
      // never a tap, however short it was. Part 9A: this used to advance the swing.
      const isTap = e.type !== 'pointercancel' && this._pointerMoved < 8 && dt < 250;
      this._pointerId = null; this._pointerStart = null;
      this._dragInView = false;
      if (!isTap) return;
      const target = e.target;
      if (target.closest && (target.closest('.gf-back') || target.closest('.gf-club-chip') || target.closest('.gf-club-item') || target.closest('.gf-map'))) return;
      if (this.round.phase === 'intro') { this._skipIntro(); return; }
      if ((this.round.phase === 'address' || this.round.phase === 'putt') && !this._clubRowOpen) {
        if (target.closest && (target.closest('.gf-view') || target.closest('.gf-meters'))) {
          this._handleShotTap();
        }
      }
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    this._unbindInput = () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
    };

    this.dom.clubchip.addEventListener('click', () => this._toggleClubRow());
  }

  _skipIntro() {
    if (!this._introSkippable) return;
    this._introSkippable = false;
    this.camRig.skip();
    this._beginAddress();
  }

  _toggleClubRow() {
    if (this._clubRowOpen) { this._closeClubRow(); return; }
    this._clubRowOpen = true;
    const ids = selectableClubs(this.round.ball.lie);
    const row = document.createElement('div');
    row.className = 'gf-clubs-row';
    row.innerHTML = ids.map((id) => {
      const c = CLUBS.find((x) => x.id === id);
      const selected = this._currentClub().id === id;
      return `<button type="button" class="gf-club-item" data-club="${id}" aria-selected="${selected}">${c.name.en}</button>`;
    }).join('');
    this.dom.bar.appendChild(row);
    row.querySelectorAll('[data-club]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.round.club = btn.getAttribute('data-club');
        this._closeClubRow();
        this._paintBar();
        this._updateAimTarget();
      });
    });
    this._clubRowEl = row;
    setTimeout(() => {
      const onOutside = (ev) => {
        if (this._clubRowEl && !this._clubRowEl.contains(ev.target) && ev.target !== this.dom.clubchip) {
          this._closeClubRow();
        }
      };
      this._outsideHandler = onOutside;
      document.addEventListener('pointerdown', onOutside, { once: true });
    }, 0);
  }
  _closeClubRow() {
    this._clubRowOpen = false;
    if (this._clubRowEl) { this._clubRowEl.remove(); this._clubRowEl = null; }
  }

  _backToSetup() {
    this.round = null;
    this._renderSetup();
  }

  // ---------------------------------------------------------------- loop ----
  _startLoop() {
    if (this.raf) return;
    this._lastFrame = performance.now();
    const frame = (now) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - this._lastFrame) / 1000);
      this._lastFrame = now;
      if (!this.round) return;
      if (this.round.phase === 'intro') {
        this.camRig.update(dt, null);
        if (this.camRig.idle) { this._introSkippable = false; this._beginAddress(); }
      } else if (this.round.phase === 'flight') {
        this._stepFlight();
      } else {
        this._tickMeters();
        this.camRig.update(dt, null);
      }
      if (this.renderer && this.camera) this.renderer.render(this.camera);
    };
    this.raf = requestAnimationFrame(frame);
  }
  _stopLoop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  }

  _saveRound() {
    this.settings.round = this.round;
    this.settings.lastCourse = this.course.id;
    saveSettings(this.settings);
  }

  _teardownPlayDom() {
    if (this._unbindInput) { this._unbindInput(); this._unbindInput = null; }
    if (this._unbindMap) { this._unbindMap(); this._unbindMap = null; }
    this.minimap = null;
    if (this._outsideHandler) { document.removeEventListener('pointerdown', this._outsideHandler); this._outsideHandler = null; }
    if (this._resizeUnsub) { this._resizeUnsub(); this._resizeUnsub = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    this.canvas = null;
    this.terrain = null;
    this.camRig = null;
  }

  destroy() {
    this.destroyed = true;
    this._stopLoop();
    this._teardownPlayDom();
    this.container.innerHTML = '';
  }

  isInProgress() { return false; } // autosave/resume meaning: leaving is lossless (§13.7)
}

let instance = null;

export function init(container) {
  ensureCSS();
  if (instance) instance.destroy();
  instance = new GolfGame(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
export function isInProgress() {
  return instance ? instance.isInProgress() : false;
}
export default { init, destroy, isInProgress };
