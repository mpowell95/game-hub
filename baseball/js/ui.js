// baseball/js/ui.js - phase 3 (BB-3): the real play screen. Quick Play only: pick a league, play a
// full three-inning game against one CPU team, batting and pitching both real, through the actual
// engine (`js/engine/`). No career, no stats recording, no leaderboard - see baseball/CLAUDE.md.
//
// Module contract (docs/BUILDING-A-GAME.md, "Part 1 - Building a game"): init/destroy/isInProgress.

import { makeT } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { isDevProfile } from '../../js/challenge/hooks.js';
import { STRINGS } from './strings.js';

import * as SETTINGS from './engine/settings.js';
import { Game } from './engine/game.js';
import { CpuPitcher, CpuBatter } from './engine/agents.js';
import { makeLeague, makePlayerTeam } from './engine/teams.js';
import { resolveSteer, steerDirectionSign, clampSteerDx } from './engine/pitch.js';
import { drawField, drawBall, drawLandingMarker, project, drawPlateView, drawPlateBall, preloadPlateImages, drawFrameCheck } from './field.js';
import { drawRingState, RING_D, BTN_D, NICE_CENTER, NICE_HALF } from './ring.js';

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

// BB-3b correction: the real 8-frame swing sequence, timed from the swing decision (release), per
// Matt's own spec - [msSinceRelease, frame]. Frame 5 (contact) lands at 80ms; frame 8 is the last
// step and is held (see _startSwingTimeline) rather than looped back automatically.
const SWING_TIMELINE = [[0, 3], [40, 4], [80, 5], [120, 6], [160, 7], [200, 8]];

const LEAGUE_ORDER = SETTINGS.LEAGUES;

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
    this.league = 'college';
    this.dev = isDevProfile();

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
    this._onVis = () => { if (document.visibilityState === 'visible') this._fit(); };
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

  destroy() {
    this.destroyed = true;
    if (this.offViewport) this.offViewport();
    if (this.ro) this.ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._onWindowPointerUp) window.removeEventListener('pointerup', this._onWindowPointerUp);
    if (this._rafBall) cancelAnimationFrame(this._rafBall);
    if (this._pitchRaf) cancelAnimationFrame(this._pitchRaf);
    if (this._flightRaf) cancelAnimationFrame(this._flightRaf);
    this._clearSwingTimers();
    this._clearPitcherTimer();
    this._clearSwingCue();
    if (this._safeAreaProbe) { this._safeAreaProbe.remove(); this._safeAreaProbe = null; }
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
        <h1 class="bb-setup-title">${t('title')}</h1>
        <div class="gh-seg bb-league-seg" role="radiogroup" aria-label="${t('setup_league')}">
          ${LEAGUE_ORDER.map((lg) => `
            <button type="button" class="gh-seg__item" data-league="${lg}" role="radio" aria-checked="${lg === this.league}" aria-pressed="${lg === this.league}">${t('league_' + lg)}</button>
          `).join('')}
        </div>
        <button type="button" class="gh-btn gh-btn--primary bb-play-btn" data-act="play">${t('setup_play')}</button>
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
    this.rootEl.querySelector('[data-act="play"]').addEventListener('click', () => this._startGame());
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
      pitcherFrame: 1,      // 1-4, the real delivery sequence - see field.js's drawPitcherFigure
      batterFrame: 1,       // 1-8, the real swing sequence - see _startSwingTimeline
      pendingPitchType: null, // Line 2's readout - see _pitchReadout
    };
    this.gameAbort = () => { if (this.game) this.game.abort(); };
    preloadPlateImages();

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
   *  camera was rebuilt to match the reference" for the history. */
  _drawStaticField() {
    if (!this.ctx || !this._fieldW) return;
    const dark = document.documentElement.classList.contains('gh-dark');
    const mode = this.state.mode === 'pitching' ? 'pitching' : 'batting';
    drawPlateView(this.ctx, this._fieldW, this._fieldH, mode, dark, {
      pitcherFrame: this.state.pitcherFrame,
      pitcherFlip: this._currentPitcherFlip(),
      batterFrame: this.state.batterFrame,
      batterFlip: this._currentBatterFlip(),
    });
  }

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

  /** Starts the real swing frame sequence at the moment of the swing decision (release): frame 3
   *  at 0ms, stepping through contact (frame 5, 80ms) to frame 8 at 200ms - see `SWING_TIMELINE`
   *  and `field.js`'s `drawBatterFigure` header. Frame 8 is left standing - `_settleAtBat`'s own
   *  result-beat hold and the next `_stepWindup`/`decidePitch` reset `state.batterFrame` back to
   *  1, per spec. Both these writes and the flight loop's own per-frame redraw read the same
   *  shared `state.batterFrame`, so there is no ordering hazard between them the way a continuous,
   *  separately-tracked animation value would have. */
  _startSwingTimeline() {
    this._clearSwingTimers();
    this._swingTimers = SWING_TIMELINE.map(([atMs, frame]) => setTimeout(() => {
      if (this.destroyed) return;
      this.state.batterFrame = frame;
      this._drawStaticField();
    }, atMs));
  }

  _clearSwingTimers() {
    if (this._swingTimers) this._swingTimers.forEach((id) => clearTimeout(id));
    this._swingTimers = null;
  }

  /** The pitcher steps frame 1 (idle) -> frame 2 (wind-up) -> frame 3 (release) before every
   *  pitch the CPU throws to a human batter (spec section 9, R1). Frame 2 starts 400ms before
   *  release; total lead-in is `FEEL.ui.windupMs`. Frame 3 is where the ball's first frame is
   *  drawn (its own hand anchor, `PLATE_ANCHORS.release`) - the caller starts the flight right
   *  after this resolves. Frame 4 (follow-through, 120ms later, held through the flight and the
   *  result beat) is scheduled by the caller (`decideSwing`), not here, since it outlives this
   *  method's own return. A human's OWN pitch (this.state.mode === 'pitching') steps the same
   *  four frames instead in time with the throw ring's own fill - see
   *  HumanAgent.decidePitch's tick(). */
  async _stepWindup() {
    this._clearPitcherTimer();
    const total = WINDUP_MS;
    const leadIn = Math.max(0, total - 400);
    this.state.pitcherFrame = 1;
    this._drawStaticField();
    if (leadIn > 0) await sleep(leadIn);
    if (this.destroyed) return;
    this.state.pitcherFrame = 2;
    this._drawStaticField();
    await sleep(Math.min(400, total));
    if (this.destroyed) return;
    this.state.pitcherFrame = 3;
    this._drawStaticField();
  }

  /** Frame 4 (follow-through), 120ms after release - see `_stepWindup`'s own header for why this
   *  is scheduled separately rather than inside it. Cleared and restarted by the next
   *  `_stepWindup`/`decidePitch` call, same pattern as `_clearSwingTimers`. */
  _schedulePitcherFollowThrough() {
    this._clearPitcherTimer();
    this._pitcherTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.state.pitcherFrame = 4;
      this._drawStaticField();
    }, 120);
  }

  _clearPitcherTimer() {
    if (this._pitcherTimer) clearTimeout(this._pitcherTimer);
    this._pitcherTimer = null;
  }

  /** Batting's own timing cue: a brief highlight on the swing ring at `delayMs` from now (the
   *  pitch's own ideal release instant, `crossMs - F.swingDelay` - the exact formula
   *  `timingFromRelease` scores a real release against, computed by the caller). Nothing in the
   *  engine's contact model changes - this only tells the player WHEN the window they already
   *  have to hit is centered, the same job pitching's Nice zone already does for the CPU's own
   *  throw. `dev`-gated tuning aside, this is a fixed, honest cue: it fires at the true ideal
   *  instant every time, never nudged toward the player. */
  _scheduleSwingCue(delayMs) {
    this._clearSwingCue();
    const ring = this.rootEl && this.rootEl.querySelector('.bb-ringwrap');
    if (!ring) return;
    this._swingCueTimer = setTimeout(() => {
      if (this.destroyed) return;
      ring.classList.add('is-swingcue');
      this._swingCueOffTimer = setTimeout(() => ring.classList.remove('is-swingcue'), 180);
    }, Math.max(0, delayMs));
  }

  _clearSwingCue() {
    if (this._swingCueTimer) clearTimeout(this._swingCueTimer);
    if (this._swingCueOffTimer) clearTimeout(this._swingCueOffTimer);
    this._swingCueTimer = null;
    this._swingCueOffTimer = null;
    const ring = this.rootEl && this.rootEl.querySelector('.bb-ringwrap');
    if (ring) ring.classList.remove('is-swingcue');
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
        this.state.pitcherFrame = 1;
        this.state.batterFrame = 1;
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
      // inside playAtBat). Only relevant in the pitching state, where the away batter's frames
      // are what's on screen (see field.js's header - the near-box sprite is always whichever
      // team is BATTING). Irrelevant while batting (the human's own swing already drives
      // state.batterFrame directly via HumanAgent.decideSwing's settle()).
      if (this.state.mode === 'pitching') {
        if (payload.action === 'swing') {
          this._startSwingTimeline();
        } else {
          this._clearSwingTimers();
          this.state.batterFrame = 1;
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
    let word = t('res_' + outcomeWord(outKind, payload.bases));
    this._setLine1(word);
    this._setLine2(this._pitchReadout());
    if (payload.distanceFt != null && payload.sprayAngleDeg != null) {
      const isOut = /out$/.test(outKind) || outKind === 'strikeout';
      const isHr = outKind === 'homer';
      const rad = (payload.sprayAngleDeg * Math.PI) / 180;
      const xFt = Math.sin(rad) * payload.distanceFt;
      const yFt = Math.cos(rad) * payload.distanceFt;
      await this._animateBattedBall(xFt, yFt, isOut ? 'out' : (isHr ? 'hr' : 'hit'), basesLabel(payload.bases));
    }
    await sleep(RESULT_MS);
    // R2's between-pitch gap - unless this at-bat ALSO just ended the half-inning, in which case
    // `_onEngineEvent`'s 'halfInningEnd' case supplies the one gap that transition already gets
    // (spec section 5: the half-inning transition's own beat IS betweenMs) - applying both here
    // would double the pause.
    const outsPerInning = SETTINGS.MECHANICS.outsPerInning;
    if (this.game && this.game.outs < outsPerInning) await sleep(BETWEEN_MS);
    this._setLine1(''); this._setLine2('');
  }

  /** The ball is IN PLAY - cuts to the overhead camera for the flight and the landing marker (see
   *  field.js's header for why: the out-zone geometry and the landing marker are both authored for
   *  a top-down view and don't translate to the close plate camera). The plate camera returns on
   *  the next `_drawStaticField()` call, which `decidePitch`/`decideSwing` make at the start of the
   *  next pitch. */
  _animateBattedBall(xFt, yFt, kind, label) {
    return new Promise((resolve) => {
      const dur = 700;
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
          resolve();
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
   *  a short fading trail and cycles through `ball-sheet`'s frames as it spins. */
  _animatePitchFlight(pitchResult) {
    return new Promise((resolve) => {
      const dur = pitchResult.timeToPlateS * 1000;
      const t0 = performance.now();
      const trail = [];
      const step = (now) => {
        if (this.destroyed) return resolve();
        const frac = Math.min(1, (now - t0) / dur);
        const bendT = pitchBendFrac(pitchResult.type, frac);
        const yFt = 60.5 * (1 - frac);
        const xFt = pitchResult.x * 8.5 * bendT;
        this._drawStaticField();
        trail.push({ xFt, yFt });
        if (trail.length > 4) trail.shift();
        for (let i = 0; i < trail.length - 1; i++) {
          const p = trail[i];
          const alpha = 0.12 * ((i + 1) / trail.length);
          drawPlateBall(this.ctx, this._fieldW, this._fieldH, p.xFt, p.yFt, 'batting', { alpha });
        }
        drawPlateBall(this.ctx, this._fieldW, this._fieldH, xFt, yFt, 'batting', { spin: frac * 3 });
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
   *  the eight frames before wiring the timeline." Steps through the batter's 8-frame swing and
   *  the pitcher's 4-frame delivery, with a toggle to compare the raw (uncorrected) frames against
   *  the offset-table correction - this is what proved the batter correction was needed (visible
   *  floating on frames 5-8 without it) before any of the timeline work in this file was written.
   *  Re-open this and re-check whenever either set's art is replaced. */
  _openFrameCheck() {
    if (!this.dev) return;
    preloadPlateImages();
    const sheet = document.createElement('div');
    sheet.className = 'bb-tune-overlay';
    sheet.innerHTML = `
      <div class="bb-tune-sheet">
        <h2>Frames</h2>
        <canvas data-role="fc-canvas" width="320" height="420" style="width:100%;max-width:320px;background:#1c1c1c;border-radius:8px"></canvas>
        <label class="bb-tune-row"><span>Kind</span>
          <select data-role="fc-kind"><option value="batter">batter (8)</option><option value="pitcher">pitcher (4)</option></select>
        </label>
        <label class="bb-tune-row"><span>Side</span>
          <select data-role="fc-side"><option value="home">home</option><option value="away">away</option></select>
        </label>
        <label class="bb-tune-row"><span>Frame</span>
          <input type="range" data-role="fc-frame" min="1" max="8" step="1" value="1">
          <span class="bb-tune-val" data-role="fc-frame-val">1</span>
        </label>
        <label class="bb-tune-row"><span>Ground-corrected</span>
          <input type="checkbox" data-role="fc-offset" checked>
        </label>
        <label class="bb-tune-row"><span>Flip (left-handed)</span>
          <input type="checkbox" data-role="fc-flip">
        </label>
        <div class="bb-tune-actions">
          <button type="button" class="gh-btn" data-act="prev">&larr; Prev</button>
          <button type="button" class="gh-btn" data-act="next">Next &rarr;</button>
          <button type="button" class="gh-btn gh-btn--primary" data-act="close">Close</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    const cv = sheet.querySelector('[data-role="fc-canvas"]');
    const ctx = cv.getContext('2d');
    const kindSel = sheet.querySelector('[data-role="fc-kind"]');
    const sideSel = sheet.querySelector('[data-role="fc-side"]');
    const frameInp = sheet.querySelector('[data-role="fc-frame"]');
    const frameVal = sheet.querySelector('[data-role="fc-frame-val"]');
    const offsetChk = sheet.querySelector('[data-role="fc-offset"]');
    const flipChk = sheet.querySelector('[data-role="fc-flip"]');
    const maxFrame = () => (kindSel.value === 'pitcher' ? 4 : 8);
    kindSel.addEventListener('change', () => {
      frameInp.max = maxFrame();
      if (parseInt(frameInp.value, 10) > maxFrame()) frameInp.value = maxFrame();
    });
    let closed = false;
    const redraw = () => {
      frameVal.textContent = frameInp.value;
      drawFrameCheck(ctx, cv.width, cv.height, kindSel.value, sideSel.value, parseInt(frameInp.value, 10), offsetChk.checked, flipChk.checked);
      if (!this.destroyed && !closed) requestAnimationFrame(redraw);
    };
    requestAnimationFrame(redraw);
    sheet.querySelector('[data-act="prev"]').addEventListener('click', () => {
      frameInp.value = Math.max(1, parseInt(frameInp.value, 10) - 1);
    });
    sheet.querySelector('[data-act="next"]').addEventListener('click', () => {
      frameInp.value = Math.min(maxFrame(), parseInt(frameInp.value, 10) + 1);
    });
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => { closed = true; sheet.remove(); });
  }
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
    s.state.pitcherFrame = 1;
    s._clearSwingTimers();
    s.state.batterFrame = 1; // the away batter is static until commit 4's swing event
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
        s.state.pitcherFrame = frac < 0.55 ? 1 : 2;
        if (elapsed > meterMs) {
          s._paintRing('hung', Math.min(1, (elapsed - meterMs) / hangGraceMs));
        } else if (frac >= NICE_CENTER - NICE_HALF) {
          s._paintRing('nice', frac);
        } else {
          s._paintRing('filling', frac);
        }
        s._drawStaticField();
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
        s.state.pitcherFrame = 3; // release - the ball's first frame draws at this frame's own
                                   // hand anchor (PLATE_ANCHORS.release, re-measured from it)

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
        let followThroughShown = false;
        const flightStep = (now) => {
          if (s.destroyed) return finishFlight();
          // Frame 4 (follow-through), 120ms after release - same fixed delay as the CPU's own
          // wind-up case (_schedulePitcherFollowThrough), just driven by this loop's own clock
          // instead of a separate timer since the flight is already ticking every frame.
          if (!followThroughShown && now - t0 >= 120) {
            followThroughShown = true;
            s.state.pitcherFrame = 4;
          }
          const frac = Math.min(1, (now - t0) / durationMs);
          const stepIdx = Math.round(frac * totalSteps);
          if (steerable) steerSamples.push({ step: stepIdx, dx: s.padX - aimAtRelease });
          const clampedSamples = steerable ? steerSamples.map((sm) => ({ step: sm.step, dx: clampSteerDx(dirSign, sm.dx) })) : steerSamples;
          const netSteer = steerable ? resolveSteer(clampedSamples, (st) => st >= fromStep) : 0;
          let liveX = baseX + netSteer * steerMaxOffset * breakMul;
          if (wasHang) liveX = liveX * (1 - SETTINGS.HANG_CENTER_PULL);
          s._drawStaticField();
          drawPlateBall(s.ctx, s._fieldW, s._fieldH, liveX * 8.5 * frac, 60.5 * (1 - frac), 'pitching', { spin: frac * 3 });
          s._paintSteerArrow(steerable, netSteer);
          if (frac < 1) {
            s._flightRaf = requestAnimationFrame(flightStep);
          } else {
            finishFlight();
          }
        };
        const finishFlight = () => {
          s._paintSteerArrow(false, 0);
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
    s._clearSwingTimers();
    s.state.batterFrame = 1;
    s._paintModeLabels();
    const pitch = view.pitch;
    s.state.lastPitches.push({ type: pitch.type, isStrike: pitch.isStrike, mph: Math.round(pitchMph(pitch, this.league)) });
    s._paintStrip();

    // The CPU's own wind-up (spec section 9, R1): frame 1 -> frame 2 (400ms before release) ->
    // frame 3 (release), a fixed lead-in timed off FEEL.ui.windupMs, THEN the ball actually
    // leaves the hand at frame 3's own throwing-hand anchor. Frame 4 (follow-through) lands
    // 120ms later, independent of the flight's own duration.
    await s._stepWindup();
    if (s.destroyed) return { action: 'take' };
    s._schedulePitcherFollowThrough();

    const flightPromise = s._animatePitchFlight(pitch);
    s._paintRing('idle', 0);

    const F0 = SETTINGS.FEEL.engine;
    s._scheduleSwingCue(pitch.timeToPlateS * 1000 - F0.swingDelay);

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
        s._clearSwingCue();
        clearTimeout(timer);
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        const releaseMs = performance.now() - releaseMs0;
        const charged = heldMs >= F.chargeTime;
        const timing = timingFromRelease(releaseMs, pitch.timeToPlateS, F);
        s._paintRing(charged ? 'charged' : 'idle', Math.min(1, heldMs / F.chargeTime));
        // The real swing frame sequence (BB-3b correction, R3) - starts immediately at release,
        // per spec (frame 3 at 0ms). A take (the timeout branch below) never calls this, so
        // state.batterFrame stays on whatever the charge loop left it at (1 or 2) until the next
        // decideSwing/decidePitch resets it.
        s._startSwingTimeline();
        resolve({ action: 'swing', aimX: s.padX, timingErrorMs: timing, charged });
      };
      s._onMainDown = () => {
        downAt = performance.now();
        const loop = () => {
          if (resolved) return;
          const heldMs = performance.now() - downAt;
          const frac = Math.min(1, heldMs / F.chargeTime);
          s._paintRing(frac >= 1 ? 'charged' : 'charging', frac);
          // Frame 2 while held past chargeTime (spec); frame 1 (idle) before that.
          s.state.batterFrame = frac >= 1 ? 2 : 1;
          s._drawStaticField();
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      };
      s._onMainUp = (heldMs) => settle(heldMs);

      const timeoutMs = pitch.timeToPlateS * 1000 + 250;
      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        s._clearSwingCue();
        if (raf) cancelAnimationFrame(raf);
        s._onMainDown = null; s._onMainUp = null;
        // A take stays on frame 1 (spec), even if the button was mid-hold when the pitch expired.
        s.state.batterFrame = 1;
        s._drawStaticField();
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
