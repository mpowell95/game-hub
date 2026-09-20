// game.js : the Baseball engine. Owns all rules and state; no DOM, no wall clock, no direct
// randomness (every draw goes through `this._rand()`, which advances and can restore a single
// snapshotted integer - see rng.js's `stepRng`). Async match loop, same shape as Escoba's
// (escoba/js/game.js): the engine `await`s each side's agent for a decision, all pacing/animation
// belongs in the awaited `onEvent` hook, and `onDecided` is a SYNCHRONOUS hook fired the instant
// the game is decided, with no await between the deciding line and the call - the same structural
// guarantee escoba/js/game.js's `checkMatchEnd()` documents, so a future phase that wires this to
// `js/game-stats.js` cannot lose a finished game to a UI event arriving late.
//
// Resumability: because every pitch is resolved synchronously between two awaited agent calls,
// the ENTIRE match state (score, inning, half, outs, count, bases, lineup position, rng position)
// is consistent and safe to snapshot after any pitch. There is no separate "next turn" checkpoint
// to track the way Escoba's `_nextTurn` is - the ordinary state IS the checkpoint.

import { RULES_V, LEAGUES, MECHANICS, PITCH_TYPES, PATTERN_WINDOW } from './settings.js';
import * as SETTINGS_DEFAULTS from './settings.js';
import { ZONE, flyPitch } from './pitch.js';
import { swing, modeOf as swingMode } from './swing.js';
import { resolveContact } from './outcomes.js';
import { zonesFor } from './zones.js';
import { emptyBases, advanceAll, advanceWalk, advanceSacFly, advanceDoublePlay } from './bases.js';
import { stepRng } from './rng.js';

// BB-2f: bumped 1 -> 2, forward-only (doc §15, [Locked]: "SNAP_V is bumped and migrated
// forward-only, never reinterpreted") - the snapshot shape gained `atBatOpen`/`halfInningOpen`,
// needed by the resume-correctness fix below. An old v1 snapshot is rejected outright by
// `validateSnapshot`, never resumed with a guessed value for the new fields.
export const SNAP_V = 2;

// The runner placed on second at the start of every extra half-inning (doc §3, [Locked]: "every
// extra half-inning starts with a runner on second"). Not a real batter - nobody's individual
// stats credit this run this phase (there is no per-player box score yet, only team totals), and
// it is never added to a lineup or a batting order.
const EXTRA_INNING_RUNNER_ID = '__extra';

/** Whole-document rejection, never default-fill - the same rule golf/js/holes.js's
 *  `validateHole()` follows for the same reason: a malformed snapshot must fail loudly rather
 *  than silently resuming into a half-real game state. Returns an array of error strings; empty
 *  means valid. */
export function validateSnapshot(snap) {
  const errs = [];
  if (!snap || typeof snap !== 'object') { errs.push('snapshot is not an object'); return errs; }
  if (snap.v !== SNAP_V) errs.push(`v must be ${SNAP_V}`);
  // Forward-only, never reinterpreted (doc §15, [Locked]): a snapshot built under an older
  // RULES_V is rejected outright rather than resumed under today's rules - the settings shape it
  // depends on (e.g. BB-1a's skill ids) may have changed underneath it.
  if (snap.rulesV !== RULES_V) errs.push(`rulesV must be ${RULES_V} (got ${snap.rulesV})`);
  if (!snap.home || !snap.away) errs.push('home/away teams missing');
  if (typeof snap.inning !== 'number' || snap.inning < 1) errs.push('inning must be >= 1');
  if (snap.half !== 'top' && snap.half !== 'bottom') errs.push('half must be top|bottom');
  if (typeof snap.outs !== 'number' || snap.outs < 0 || snap.outs > 3) errs.push('outs out of range');
  if (typeof snap.balls !== 'number' || snap.balls < 0) errs.push('balls out of range');
  if (typeof snap.strikes !== 'number' || snap.strikes < 0) errs.push('strikes out of range');
  if (!Array.isArray(snap.bases) || snap.bases.length !== 3) errs.push('bases must be a 3-array');
  if (!snap.score || typeof snap.score.home !== 'number' || typeof snap.score.away !== 'number') {
    errs.push('score.home/away must be numbers');
  }
  if (!snap.lineupPos || typeof snap.lineupPos.home !== 'number' || typeof snap.lineupPos.away !== 'number') {
    errs.push('lineupPos.home/away must be numbers');
  }
  if (typeof snap.rngState !== 'number') errs.push('rngState must be a number');
  if (typeof snap.over !== 'boolean') errs.push('over must be a boolean');
  if (typeof snap.atBatOpen !== 'boolean') errs.push('atBatOpen must be a boolean');
  if (typeof snap.halfInningOpen !== 'boolean') errs.push('halfInningOpen must be a boolean');
  return errs;
}

export class Game {
  /**
   * @param {object} opts
   * @param {object} opts.home - a teams.js `makeTeam()` result
   * @param {object} opts.away - a teams.js `makeTeam()` result
   * @param {number} opts.seed - initial RNG seed (integer)
   * @param {{home:object, away:object}} opts.agents - each with async decidePitch()/decideSwing()
   * @param {string} [opts.parkId] - a settings.PARKS key; falls back to 'default'
   * @param {object} [opts.settings] - override settings (tests only); merged over the real module
   */
  constructor({ home, away, seed, agents, parkId = 'default', settings }) {
    this.home = home;
    this.away = away;
    this.agents = agents;
    this.parkId = parkId;
    // Both sides play in the same league (a Career opponent is always drawn from the player's own
    // league); home's is authoritative if the two ever disagreed.
    this.league = home.league || away.league;
    this.settings = { ...SETTINGS_DEFAULTS, ZONE, ...(settings || {}) };

    this.rngState = seed >>> 0;
    this.inning = 1;
    this.half = 'top';
    this.outs = 0;
    this.balls = 0;
    this.strikes = 0;
    this.bases = emptyBases();
    this.score = { home: 0, away: 0 };
    this.lineupPos = { home: 0, away: 0 };
    this.totals = {
      home: { hits: 0, runs: 0, strikeouts: 0, walks: 0 },
      away: { hits: 0, runs: 0, strikeouts: 0, walks: 0 },
    };
    this.pitchHistory = Object.create(null); // batterId -> array of recent pitch types thrown to them
    // batterId -> array of recent sprayAngleDeg for balls this batter has put in play, capped at
    // SHIFT_WINDOW - the doc §9 "shifters" style reads this to rotate its out-zone geometry toward
    // where a batter tends to hit (settings.js's SHIFTERS_ADJUST_OUT_ZONES, [Locked]).
    this.sprayHistory = Object.create(null);
    // batterId -> array of pitch x-locations this batter swung at and missed, capped at
    // WEAKSPOT_WINDOW - what a `weakSpotWeight` CpuPitcher (doc §8: "Majors: attacks your weak
    // spots") reads before aiming there. Step 2.
    this.weakZoneLog = Object.create(null);

    this.over = false;
    this.winner = null;         // 'home' | 'away' | 'tie' | null
    this.matchEndReason = null; // 'scheduled' | 'scheduled-skip' | 'walkoff' | 'extra-innings-cap' | null

    this.onEvent = null;   // async (type, payload) => void, UI pacing only
    this.onDecided = null; // SYNCHRONOUS (winner) => void, fired the instant the game is decided
    this.aborted = false;
    // One-shot resume checkpoint (Escoba's `_resumeMidRound` pattern, escoba/js/game.js): a
    // freshly-constructed game is never resuming, so playAtBat's count reset always runs. Set to
    // true only by fromSnapshot(), and consumed (set back to false) the first time playAtBat
    // would otherwise have clobbered the balls/strikes count the snapshot just restored.
    this._resumePending = false;
    // Same one-shot pattern, one level up: a snapshot can also land mid-half-inning (outs > 0),
    // and playHalfInning()'s own `this.outs = 0` must not run again in that case.
    this._resumeHalfPending = false;
    // BB-2f: whether the CURRENT at-bat/half-inning is genuinely still in progress right now -
    // true for the whole span between `atBatStart`/`halfInningStart` and the moment that unit
    // actually concludes (a hit/walk/strikeout; 3 outs), set false the instant it concludes,
    // BEFORE the return - unconditionally, regardless of `aborted` (see the header note on
    // `playAtBat`/`playHalfInning` below for why these two must never be gated on `aborted`).
    // `fromSnapshot` restores `_resumePending`/`_resumeHalfPending` FROM these two flags, not
    // unconditionally true - see that method's own comment for the bug this fixes.
    this._atBatOpen = false;
    this._halfInningOpen = false;
  }

  /** Rebuild a Game from `snapshot()`'s output. `agents` is supplied fresh (never serialized),
   *  same reasoning as Escoba's `agentsById` parameter to `Game.fromSnapshot`. Throws if the
   *  snapshot fails `validateSnapshot()` - never silently resumes a malformed state. */
  static fromSnapshot(snap, agents) {
    const errs = validateSnapshot(snap);
    if (errs.length) throw new Error(`invalid baseball snapshot: ${errs.join('; ')}`);
    const g = Object.create(Game.prototype);
    g.home = snap.home;
    g.away = snap.away;
    g.agents = agents;
    g.parkId = snap.parkId || 'default';
    g.league = snap.home.league || snap.away.league;
    g.settings = { ...SETTINGS_DEFAULTS, ZONE };
    g.rngState = snap.rngState >>> 0;
    g.inning = snap.inning;
    g.half = snap.half;
    g.outs = snap.outs;
    g.balls = snap.balls;
    g.strikes = snap.strikes;
    g.bases = snap.bases.slice();
    g.score = { ...snap.score };
    g.lineupPos = { ...snap.lineupPos };
    g.totals = {
      home: { ...snap.totals.home },
      away: { ...snap.totals.away },
    };
    g.pitchHistory = { ...(snap.pitchHistory || {}) };
    g.sprayHistory = { ...(snap.sprayHistory || {}) };
    g.weakZoneLog = { ...(snap.weakZoneLog || {}) };
    g.over = snap.over;
    g.winner = snap.winner || null;
    g.matchEndReason = snap.matchEndReason || null;
    g.onEvent = null;
    g.onDecided = null;
    g.aborted = false;
    g._atBatOpen = snap.atBatOpen;
    g._halfInningOpen = snap.halfInningOpen;
    // BB-2f fix: these used to be unconditionally `true` - wrong whenever the snapshot was taken
    // right as an at-bat/half-inning had ALREADY concluded (a hit/walk/strikeout, or the 3rd out)
    // but before the next one's own state (balls/strikes reset, or outs reset for the next
    // half-inning) had run - which the old code deferred to run ONLY on the very next
    // playAtBat()/playHalfInning() call, a call that never happened on the aborted game itself
    // (the outer loop stops the instant `aborted` is set). Unconditionally trusting "resuming"
    // meant that next call wrongly preserved a STALE count instead of starting the new batter/half
    // at zero - found by this file's own resume-determinism test once a settings change (BB-2f
    // commit 2) shifted which pitch of a fixed seed happened to be the one an existing test's
    // scripted abort lands on, landing it exactly on an at-bat conclusion for the first time.
    // Restoring from the flags this snapshot actually carries (rather than a blanket `true`) is
    // the fix: `_resumePending`/`_resumeHalfPending` are `true` only when the unit was genuinely
    // still open at snapshot time.
    g._resumePending = !!snap.atBatOpen;
    g._resumeHalfPending = !!snap.halfInningOpen;
    return g;
  }

  /** Plain-JSON snapshot. Teams/agents' team data is already plain (teams.js's own output);
   *  agents themselves are never serialized. */
  snapshot() {
    return {
      v: SNAP_V,
      rulesV: RULES_V,
      home: this.home,
      away: this.away,
      parkId: this.parkId,
      inning: this.inning,
      half: this.half,
      outs: this.outs,
      balls: this.balls,
      strikes: this.strikes,
      bases: this.bases.slice(),
      score: { ...this.score },
      lineupPos: { ...this.lineupPos },
      totals: { home: { ...this.totals.home }, away: { ...this.totals.away } },
      pitchHistory: { ...this.pitchHistory },
      sprayHistory: { ...this.sprayHistory },
      weakZoneLog: { ...this.weakZoneLog },
      rngState: this.rngState,
      over: this.over,
      winner: this.winner,
      matchEndReason: this.matchEndReason,
      atBatOpen: this._atBatOpen,
      halfInningOpen: this._halfInningOpen,
    };
  }

  abort() { this.aborted = true; }

  async emit(type, payload) {
    if (this.aborted) return;
    if (this.onEvent) await this.onEvent(type, payload);
  }

  /** The one place randomness is drawn. Advances and returns a value in [0,1); the new state is
   *  what `snapshot()` persists, so a resumed game draws exactly the next number a straight-
   *  through game would have. */
  _rand() {
    const { value, next } = stepRng(this.rngState);
    this.rngState = next;
    return value;
  }

  /** The park's fence distances (doc §10, [Locked]: "Fields get bigger each league"). BB-2b
   *  commit 3: every league's own fence now comes straight from `FIELD[league].fenceFt` - the
   *  doc's real per-league fence table `zones.js`/`fenceFtAt` already read for everything else.
   *  `PARKS` (a flat, league-independent {left,center,right} shape) is used ONLY when a real
   *  named Majors park is actually requested (`parkId` is not `'default'`, and the league is
   *  majors) - a named park's own distances are already at major-league scale and need no further
   *  scaling. Before this phase every league's fence was `PARKS.default` scaled by that league's
   *  `fieldScale` - a DIFFERENT number from `FIELD[league].fenceFt`, which nothing outside
   *  `_parkFt()` ever consulted, so `zones.js`'s out-zone reach and the fence a batted ball
   *  actually had to clear could silently disagree. */
  _parkFt() {
    if (this.league === 'majors' && this.parkId && this.parkId !== 'default' && this.settings.PARKS[this.parkId]) {
      return { ...this.settings.PARKS[this.parkId] };
    }
    const fenceFt = (this.settings.FIELD[this.league] || this.settings.FIELD.majors).fenceFt;
    return { ...fenceFt };
  }

  _controlSkillFor(pitcher) {
    // doc §6, [Locked]: "Accuracy: pitch lands closer to your aim" - pitchAcc is exactly this.
    const cap = this.settings.CAPS[this.league] != null ? this.settings.CAPS[this.league] : this.settings.CAPS.majors;
    return Math.max(0, Math.min(1, (pitcher.skills.pitchAcc || 0) / cap));
  }

  /** How far a "shifters" team (doc §9, [Locked]) rotates its out-zone geometry toward this
   *  batter's own recent spray tendency. Every other style shifts nothing - `zonesFor`'s default
   *  `shiftDeg` of 0 leaves the base geometry untouched. */
  _shiftDegFor(defenseTeam, batterId) {
    // BB-2a step 5: reads settings.js's STYLE_BEHAVIOR table (was a hardcoded 'shifters' string
    // check) - a team's shifting behavior is now named alongside the rest of its flavor.
    const behavior = this.settings.STYLE_BEHAVIOR && this.settings.STYLE_BEHAVIOR[defenseTeam.styleId];
    if (!behavior || !behavior.shift) return 0;
    const hist = this.sprayHistory[batterId];
    // BB-2d commit 6: SHIFT_MIN_SAMPLES - a shift is a TENDENCY, not a fluke off one ball in play.
    // Before this commit a single recorded spray angle (hist.length checked only against 0) could
    // already trigger a shift, which is not "where you tend to hit," just where you hit once.
    const minSamples = this.settings.SHIFT_MIN_SAMPLES != null ? this.settings.SHIFT_MIN_SAMPLES : 1;
    if (!hist || hist.length < minSamples) return 0;
    const mean = hist.reduce((s, v) => s + v, 0) / hist.length;
    const max = this.settings.SHIFT_MAX_DEG;
    return Math.max(-max, Math.min(max, mean));
  }

  _recordSpray(batterId, sprayAngleDeg) {
    if (typeof sprayAngleDeg !== 'number') return;
    const hist = this.sprayHistory[batterId] || (this.sprayHistory[batterId] = []);
    hist.push(sprayAngleDeg);
    const window = this.settings.SHIFT_WINDOW;
    if (hist.length > window) hist.splice(0, hist.length - window);
  }

  _buildPitchView(defenseSide) {
    const batterId = this._currentBatterId(defenseSide === 'home' ? 'away' : 'home');
    return {
      side: defenseSide,
      inning: this.inning,
      half: this.half,
      outs: this.outs,
      balls: this.balls,
      strikes: this.strikes,
      bases: this.bases.slice(),
      score: { ...this.score },
      batterId,
      pitchHistory: (this.pitchHistory[batterId] || []).slice(-PATTERN_WINDOW),
      weakZone: this._weakZoneFor(batterId),
      rand01: () => this._rand(),
    };
  }

  /** BB-2b commit 3: `pitchHistory` here MUST be the batter's history from BEFORE this pitch -
   *  the caller (`playAtBat`) captures it before calling `_recordPitch` and passes it in
   *  explicitly, rather than this method reading `this.pitchHistory` itself (which by the time
   *  the swing view is built already has the CURRENT pitch appended, and a batter "reading its own
   *  pattern" against a history that already contains the pitch it is deciding on can never be
   *  surprised - the exact defect this fixes; see the doc §8 "pitch speed reaches the batter"
   *  mechanism in agents.js). */
  _buildSwingView(battingSide, pitchResult, priorPitchHistory) {
    return {
      side: battingSide,
      inning: this.inning,
      half: this.half,
      outs: this.outs,
      balls: this.balls,
      strikes: this.strikes,
      bases: this.bases.slice(),
      score: { ...this.score },
      batterId: this._currentBatterId(battingSide),
      pitch: pitchResult,
      pitchHistory: priorPitchHistory,
      rand01: () => this._rand(),
    };
  }

  _currentBatterId(battingSide) {
    const team = this[battingSide];
    return team.battingOrder[this.lineupPos[battingSide] % team.battingOrder.length];
  }

  _advanceLineup(side) {
    const team = this[side];
    this.lineupPos[side] = (this.lineupPos[side] + 1) % team.battingOrder.length;
  }

  _addRuns(side, runs) {
    if (!runs) return;
    this.score[side] += runs;
    this.totals[side].runs += runs;
    this._checkWalkoff();
  }

  _checkWalkoff() {
    if (this.over) return;
    if (this.half === 'bottom'
        && this.inning >= this.settings.SEASON.inningsPerGame
        && this.score.home > this.score.away
        && this.settings.MECHANICS.walkoffEndsImmediately) {
      this._finalize('home', 'walkoff');
    }
  }

  _finalize(winner, reason) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.matchEndReason = reason;
    if (this.onDecided) {
      try { this.onDecided(winner); }
      catch (err) { console.error('Baseball onDecided hook threw; the game still concluded', err); }
    }
  }

  _recordPitch(batterId, type, x) {
    const hist = this.pitchHistory[batterId] || (this.pitchHistory[batterId] = []);
    hist.push({ type, x });
    if (hist.length > PATTERN_WINDOW * 3) hist.splice(0, hist.length - PATTERN_WINDOW * 3);
  }

  /** doc §8, [Locked]: "Majors: attacks your weak spots" - a batter's own recent swing-and-miss
   *  locations, averaged, or null with too few samples to mean anything. */
  _weakZoneFor(batterId) {
    const log = this.weakZoneLog[batterId];
    if (!log || log.length < 2) return null;
    return log.reduce((s, x) => s + x, 0) / log.length;
  }

  _recordWeak(batterId, x) {
    if (typeof x !== 'number') return;
    const log = this.weakZoneLog[batterId] || (this.weakZoneLog[batterId] = []);
    log.push(x);
    const window = this.settings.WEAKSPOT_WINDOW;
    if (log.length > window) log.splice(0, log.length - window);
  }

  async playGame() {
    await this.emit('gameStart', {});
    while (!this.over && !this.aborted) {
      if (this.half === 'bottom' && this.inning >= this.settings.SEASON.inningsPerGame
          && this.score.home > this.score.away) {
        this._finalize('home', 'scheduled-skip');
        break;
      }
      await this.playHalfInning();
      if (this.over) break;
      // BB-2f fix: advancing to the next half/inning is NOT gated on `!this.aborted` any more -
      // only on whether the half-inning `playHalfInning()` just ran ACTUALLY concluded
      // (`_halfInningOpen` false). An abort can land exactly on the pitch that also completes the
      // half-inning's 3rd out; that half-inning is genuinely over and the advance must still
      // happen, or a resumed game re-enters the SAME (already-finished) half instead of the next
      // one. If `_halfInningOpen` is still true, the half is genuinely still in progress (this can
      // only happen while aborted - the while loop below never exits early otherwise), so there is
      // nothing to advance yet; the outer `while (!aborted)` condition stops iteration on its own.
      if (this._halfInningOpen) break;

      if (this.half === 'bottom') {
        if (this.inning >= this.settings.SEASON.inningsPerGame && this.score.home !== this.score.away) {
          this._finalize(this.score.home > this.score.away ? 'home' : 'away', 'scheduled');
          break;
        }
        if (this.inning >= this.settings.SEASON.inningsPerGame + this.settings.MECHANICS.maxExtraInnings) {
          this._finalize(this.score.home === this.score.away ? 'tie'
            : (this.score.home > this.score.away ? 'home' : 'away'), 'extra-innings-cap');
          break;
        }
        this.inning += 1;
        this.half = 'top';
      } else {
        this.half = 'bottom';
      }
    }
    if (this.aborted) return;
    await this.emit('gameEnd', { score: { ...this.score }, winner: this.winner, reason: this.matchEndReason });
  }

  async playHalfInning() {
    let freshHalf = true;
    if (this._resumeHalfPending) {
      this._resumeHalfPending = false;
      freshHalf = false;
    } else {
      this.outs = 0;
    }
    this._halfInningOpen = true;
    // doc §3, [Locked]: "every extra half-inning starts with a runner on second." Only on a
    // genuinely FRESH half (never on a resumed one - a restored snapshot already carries whatever
    // base state it had, ghost runner included if one was already placed).
    if (freshHalf && this.inning > this.settings.SEASON.inningsPerGame
        && this.settings.MECHANICS.extraInningRunnerOnSecond) {
      this.bases = [null, EXTRA_INNING_RUNNER_ID, null];
    }
    await this.emit('halfInningStart', { inning: this.inning, half: this.half });
    if (this.aborted) return;
    // BB-2f fix: no early `return` on `aborted` here any more - the while loop's own condition
    // already stops it from calling `playAtBat()` again, and falling through to the block below
    // is exactly what lets a half-inning that concluded (3rd out) on the SAME pitch that triggered
    // an abort still get its state properly closed out, instead of leaving `outs`/bases/balls/
    // strikes stale for whatever resumes next.
    while (this.outs < this.settings.MECHANICS.outsPerInning && !this.over && !this.aborted) {
      await this.playAtBat();
    }
    // The half-inning is only genuinely OVER once outs reaches the limit - not merely because
    // `aborted` is true (that can be true here with outs still short of the limit, meaning this
    // half-inning is still mid-progress and must resume exactly as-is, per `_halfInningOpen`
    // staying true). The state reset itself must run whenever the half genuinely concluded,
    // regardless of `aborted` - only the notification (`emit`) is conditional on `!aborted`
    // (and `emit()` already no-ops once aborted on its own, so this condition is for clarity, not
    // strictly required).
    if (!this.over && this.outs >= this.settings.MECHANICS.outsPerInning) {
      this.bases = emptyBases();
      this.balls = 0;
      this.strikes = 0;
      this._halfInningOpen = false;
      if (!this.aborted) await this.emit('halfInningEnd', { inning: this.inning, half: this.half, score: { ...this.score } });
    }
  }

  async playAtBat() {
    const battingSide = this.half === 'top' ? 'away' : 'home';
    const defenseSide = battingSide === 'home' ? 'away' : 'home';
    const battingTeam = this[battingSide];
    const defenseTeam = this[defenseSide];
    const battingAgent = this.agents[battingSide];
    const defenseAgent = this.agents[defenseSide];

    const batterId = this._currentBatterId(battingSide);
    const batter = battingTeam.players.find((p) => p.id === batterId);
    const pitcher = defenseTeam.players.find((p) => p.id === defenseTeam.pitcherId);

    if (this._resumePending) {
      // A snapshot restored mid-at-bat: the balls/strikes/bases it carried are exactly where
      // this at-bat left off, and must not be zeroed out from under it.
      this._resumePending = false;
    } else {
      this.balls = 0;
      this.strikes = 0;
    }
    this._atBatOpen = true;
    await this.emit('atBatStart', { batterId, side: battingSide });
    if (this.aborted) return;

    // A single pass through this loop (one pitch AND its swing decision) is the atomic unit of
    // play - `abort()` is honored only BETWEEN passes (the loop condition), never in the middle
    // of one. A pitch that has already been thrown always gets its swing decided against it: the
    // alternative (stopping right after the pitch and, on resume, throwing a brand-new one) would
    // silently discard the random draws real gameplay already spent on that pitch, and a resumed
    // game would diverge from an uninterrupted one from that moment on - the exact defect this
    // phase's resume gate exists to catch (found by that gate, verified born red beforehand).
    while (!this.over && !this.aborted) {
      const pitchView = this._buildPitchView(defenseSide);
      // BB-3b commit 4: an agent that wants to PREVIEW the pitch while its own UI is still
      // deciding (a human pitcher, drawing the throw before flyPitch has even run) opts in via
      // `previewsPitch` - only then is the extra draw taken, so a CPU/model agent (which never
      // sets it) consumes rand01() at exactly the same points in the stream as before this
      // commit, and every existing seeded test/sim stays byte-identical. The draw itself is the
      // SAME one flyPitch would otherwise make internally for its own aim-scatter term (see
      // pitch.js's header) - pre-rolling it here just lets the UI show it before flyPitch runs.
      // R2 (docs/BASEBALL-3D-BUILD.md section 9): FOUR pre-rolled draws, not one - the two aim
      // scatters and the two a knuckleball's break reads (`flyPitch`'s own header). A human
      // pitcher's UI runs the identical `flyPitch` on them while the ball is still in the air, so
      // what the player watches IS what this function scores a moment later.
      if (defenseAgent && defenseAgent.previewsPitch) {
        pitchView.scatterDraw = { x: this._rand(), y: this._rand(), bx: this._rand(), by: this._rand() };
      }
      const pitchDecision = await defenseAgent.decidePitch(pitchView);
      const type = PITCH_TYPES.includes(pitchDecision && pitchDecision.type) ? pitchDecision.type : 'fastball';
      // R2: the aim is 2-D. A plain number still means "x, at the middle of the zone's height" -
      // `flyPitch` accepts both shapes, so a scripted agent or an old fixture keeps working.
      const aim = (pitchDecision && pitchDecision.aim != null) ? pitchDecision.aim : 0;
      // Captured BEFORE `_recordPitch` appends the pitch about to be thrown - see
      // `_buildSwingView`'s own header for why this ordering matters.
      const priorPitchHistory = (this.pitchHistory[batterId] || []).slice(-PATTERN_WINDOW);
      // `pitcherHand` (pitcher.throws) is which way a handed break goes (doc §11, [Locked]:
      // "never which way") - always the REAL pitcher's own hand, whether they're human or CPU.
      // `scatter` is the pre-rolled draw set above, present only when it was actually drawn.
      // R2 deleted the `hold`/`steer` fields the meter and the steer pad used to put here.
      const pitchExtras = { scatter: pitchView.scatterDraw || null, pitcherHand: pitcher.throws };
      const pitchResult = flyPitch(type, aim, this._controlSkillFor(pitcher), this.settings, () => this._rand(), pitcher.skills, pitchExtras);
      this._recordPitch(batterId, pitchResult.type, pitchResult.x);
      await this.emit('pitch', { type: pitchResult.type, isStrike: pitchResult.isStrike });

      const swingView = this._buildSwingView(battingSide, pitchResult, priorPitchHistory);
      const swingDecision = await battingAgent.decideSwing(swingView);
      // BB-3b commit 4: additive event, so the UI can animate a CPU batter's swing when a human
      // is pitching (nothing told it before - the decision was made and consumed entirely inside
      // this function). No existing listener reacts to an event type it doesn't recognize.
      // R2: `mode` (contact/power) replaces `charged` - the charged swing is deleted, and which
      // mode the batter was in is the thing a UI would want to show instead.
      await this.emit('swing', { side: battingSide, action: swingDecision && swingDecision.action, mode: swingMode(swingDecision) });
      const swingResult = swing(pitchResult, batter.skills, swingDecision, this.settings, () => this._rand(), this.league);
      // BB-3b commit 6: two additive readouts for Line 1 (SPEC.md section 3/9) - `verdict` names
      // what the pitch itself was (a called ball/strike, a foul, or a swing that missed
      // entirely), and `timingWord` is the swing's own early/late/perfect classification, read
      // straight off the same `timingErrorMs`/`perfectMs`/`timingWindow` axis `swing.js`'s own
      // contact-quality model (`qualityFor`) already scores against - never a second, invented
      // threshold. Present only when a real swing was attempted (a take carries no timing at
      // all); `null` otherwise. Both ride the 'count' and 'atBatEnd' events every existing
      // listener already destructures by name, so nothing reading the old fields is affected.
      const F = this.settings.FEEL.engine;
      const timingErrorMs = swingDecision && swingDecision.action === 'swing' ? swingDecision.timingErrorMs : null;
      const timingWord = typeof timingErrorMs === 'number'
        ? (Math.abs(timingErrorMs) <= F.perfectMs ? 'perfect' : (timingErrorMs < 0 ? 'early' : 'late'))
        : null;
      let verdict;

      if (!swingResult.swung) {
        verdict = pitchResult.isStrike ? 'strike' : 'ball';
        if (pitchResult.isStrike) this.strikes += 1; else this.balls += 1;
      } else if (!swingResult.contact) {
        verdict = 'miss';
        this._recordWeak(batterId, pitchResult.x);
        this.strikes += 1;
      } else if (swingResult.foul) {
        verdict = 'foul';
        if (this.strikes < 2) this.strikes += 1;
      } else {
        const shiftDeg = this._shiftDegFor(defenseTeam, batterId);
        const zones = zonesFor(this.league, shiftDeg);
        const outcome = resolveContact(swingResult, zones, this.settings, this._parkFt(), batter.skills.hitSpd, () => this._rand());
        this._recordSpray(batterId, swingResult.sprayAngleDeg);
        const { bases, runsScored } = this._resolveBattedBall(outcome, batterId, battingSide, () => this._rand());
        this._advanceLineup(battingSide);
        this._atBatOpen = false;
        // BB-2c commit 1: q/exitVeloMph/centered exposed for measurement
        // (`sim-baseball.mjs --attribute`'s plate-appearance ledger) - purely additive fields on an
        // event payload every existing consumer already destructures by name, so nothing reading
        // the old fields is affected.
        // BB-2d commit 1: distanceFt/sprayAngleDeg/battedKind exposed for measurement
        // (`sim-baseball.mjs --range`'s batted-ball census) - purely additive, same discipline as
        // BB-2c commit 1's q/exitVeloMph/centered; no existing caller reads them.
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: outcome.kind, bases, runsScored,
          q: swingResult.q, exitVeloMph: swingResult.exitVeloMph, centered: swingResult.centered,
          distanceFt: outcome.distanceFt, sprayAngleDeg: swingResult.sprayAngleDeg, battedKind: swingResult.kind,
          timingWord });
        return;
      }

      await this.emit('count', { balls: this.balls, strikes: this.strikes, verdict, timingWord });
      // BB-2f fix: no early `return` here either, for the same reason as the two removed above -
      // an abort can land on the exact pitch that pushes strikes/balls to their own threshold, and
      // returning here BEFORE the strikeout/walk checks below would snapshot an invalid, stuck
      // state (3 strikes that were never converted into an out) instead of letting the at-bat's
      // own conclusion run. If neither threshold is met, the while loop's own condition
      // (`!this.aborted`) still stops the next pitch from being thrown.

      if (this.strikes >= this.settings.MECHANICS.strikesForOut) {
        this.outs += 1;
        this.totals[battingSide].strikeouts += 1;
        this._advanceLineup(battingSide);
        this._atBatOpen = false;
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: 'strikeout', bases: 0, runsScored: 0 });
        return;
      }
      if (this.balls >= this.settings.MECHANICS.ballsForWalk) {
        const { bases, runsScored } = advanceWalk(this.bases, batterId);
        this.bases = bases;
        this.totals[battingSide].walks += 1;
        this._addRuns(battingSide, runsScored);
        this._advanceLineup(battingSide);
        this._atBatOpen = false;
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: 'walk', bases: 1, runsScored });
        return;
      }
    }
  }

  /** Apply a resolved batted-ball outcome to outs/bases/runs/totals. Synchronous - nothing here
   *  awaits, so `_checkWalkoff` (called from `_addRuns`) always fires before the caller's next
   *  `await this.emit(...)`, preserving the "decide, then announce" ordering `_finalize` depends
   *  on. */
  _resolveBattedBall(outcome, batterId, battingSide, rand01) {
    if (outcome.isFoul || outcome.result === 'out') {
      // doc §3, [Locked]: "Deep fly out scores the runner from third (sac fly)" - DEEP, not any
      // fly out; MECHANICS.sacFlyMinDepthFt is how deep (Draft, new).
      const isSacFly = outcome.kind === 'flyout'
        && this.bases[2] != null
        && this.outs < this.settings.MECHANICS.outsPerInning - 1
        && (outcome.distanceFt || 0) >= this.settings.MECHANICS.sacFlyMinDepthFt;
      if (isSacFly) {
        const { bases, runsScored } = advanceSacFly(this.bases);
        this.bases = bases;
        this.outs += 1; // no hit credited on a sac fly - the batter is out
        this._addRuns(battingSide, runsScored);
        return { bases: 0, runsScored };
      }
      // doc §3, [Locked]: "Ground out with a runner on first and fewer than 2 outs CAN be a
      // double play" - the doc locks that it can happen, not how often (Draft, MECHANICS.
      // doublePlayChance). Removes only the lead runner from first; nobody else moves.
      const canDoublePlay = outcome.kind === 'groundout'
        && this.bases[0] != null
        && this.outs < this.settings.MECHANICS.outsPerInning - 1
        && this.settings.MECHANICS.doublePlayEnabled;
      if (canDoublePlay && rand01 && rand01() < this.settings.MECHANICS.doublePlayChance) {
        this.bases = advanceDoublePlay(this.bases);
        this.outs += 2; // the batter, plus the runner forced at second
        return { bases: 0, runsScored: 0 };
      }
      this.outs += 1;
      return { bases: 0, runsScored: 0 };
    }
    // a hit - doc §10's outcome list is singles/doubles/triples/homers/outs; there is no "error"
    // outcome in the real design (phase 1's invented one is gone as of Step 1).
    const { bases, runsScored } = advanceAll(this.bases, batterId, outcome.bases);
    this.bases = bases;
    this.totals[battingSide].hits += 1;
    this._addRuns(battingSide, runsScored);
    return { bases: outcome.bases, runsScored };
  }
}

export default { Game, SNAP_V, validateSnapshot, LEAGUES };
