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
import { swing } from './swing.js';
import { resolveContact } from './outcomes.js';
import { emptyBases, advanceAll, advanceWalk, advanceSacFly, advanceDoublePlay } from './bases.js';
import { stepRng } from './rng.js';

export const SNAP_V = 1;

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
      home: { hits: 0, runs: 0, errors: 0, strikeouts: 0, walks: 0 },
      away: { hits: 0, runs: 0, errors: 0, strikeouts: 0, walks: 0 },
    };
    this.pitchHistory = Object.create(null); // batterId -> array of recent pitch types thrown to them

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
    g.over = snap.over;
    g.winner = snap.winner || null;
    g.matchEndReason = snap.matchEndReason || null;
    g.onEvent = null;
    g.onDecided = null;
    g.aborted = false;
    g._resumePending = true;     // the very next playAtBat must not zero the restored balls/strikes
    g._resumeHalfPending = true; // the very next playHalfInning must not zero the restored outs
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
      rngState: this.rngState,
      over: this.over,
      winner: this.winner,
      matchEndReason: this.matchEndReason,
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

  _parkFt() {
    return this.settings.PARKS[this.parkId] || this.settings.PARKS.default;
  }

  _controlSkillFor(pitcher) {
    // doc §6, [Locked]: "Accuracy: pitch lands closer to your aim" - pitchAcc is exactly this.
    const cap = this.settings.CAPS[this.league] != null ? this.settings.CAPS[this.league] : this.settings.CAPS.majors;
    return Math.max(0, Math.min(1, (pitcher.skills.pitchAcc || 0) / cap));
  }

  _defenseLevel01() {
    // There is no per-player "fielding" skill in the real design (doc §6 names only hitAcc/
    // hitPow/hitSpd and pitchSpd/pitchAcc/pitchSpin) - defense there is entirely OUT-ZONE
    // GEOMETRY, sized per league (doc §10: "out zones also grow"). Exact per-league sizing is
    // Open item 7 (undecided), so this is a placeholder league-ordered ramp, not a real model:
    // higher leagues field a little better, same direction as the doc's own "better fielders" line,
    // with no claim to the actual magnitude.
    const idx = Math.max(0, LEAGUES.indexOf(this.league));
    return 0.4 + 0.15 * (idx / (LEAGUES.length - 1));
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
      rand01: () => this._rand(),
    };
  }

  _buildSwingView(battingSide, pitchResult) {
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

  _recordPitch(batterId, type) {
    const hist = this.pitchHistory[batterId] || (this.pitchHistory[batterId] = []);
    hist.push(type);
    if (hist.length > PATTERN_WINDOW * 3) hist.splice(0, hist.length - PATTERN_WINDOW * 3);
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
      if (this.over || this.aborted) break;

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
    // doc §3, [Locked]: "every extra half-inning starts with a runner on second." Only on a
    // genuinely FRESH half (never on a resumed one - a restored snapshot already carries whatever
    // base state it had, ghost runner included if one was already placed).
    if (freshHalf && this.inning > this.settings.SEASON.inningsPerGame
        && this.settings.MECHANICS.extraInningRunnerOnSecond) {
      this.bases = [null, EXTRA_INNING_RUNNER_ID, null];
    }
    await this.emit('halfInningStart', { inning: this.inning, half: this.half });
    if (this.aborted) return;
    while (this.outs < this.settings.MECHANICS.outsPerInning && !this.over && !this.aborted) {
      await this.playAtBat();
      if (this.aborted) return;
    }
    if (!this.over && !this.aborted) {
      this.bases = emptyBases();
      this.balls = 0;
      this.strikes = 0;
      await this.emit('halfInningEnd', { inning: this.inning, half: this.half, score: { ...this.score } });
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
      const pitchDecision = await defenseAgent.decidePitch(pitchView);
      const type = PITCH_TYPES.includes(pitchDecision && pitchDecision.type) ? pitchDecision.type : 'fastball';
      const aimX = (pitchDecision && typeof pitchDecision.aim === 'number') ? pitchDecision.aim : 0;
      const pitchResult = flyPitch(type, aimX, this._controlSkillFor(pitcher), this.settings, () => this._rand());
      this._recordPitch(batterId, pitchResult.type);
      await this.emit('pitch', { type: pitchResult.type, isStrike: pitchResult.isStrike });

      const swingView = this._buildSwingView(battingSide, pitchResult);
      const swingDecision = await battingAgent.decideSwing(swingView);
      const swingResult = swing(pitchResult, batter.skills, swingDecision, this.settings, () => this._rand());

      if (!swingResult.swung) {
        if (pitchResult.isStrike) this.strikes += 1; else this.balls += 1;
      } else if (!swingResult.contact) {
        this.strikes += 1;
      } else if (swingResult.foul) {
        if (this.strikes < 2) this.strikes += 1;
      } else {
        const outcome = resolveContact(swingResult, this._defenseLevel01(), this.settings, this._parkFt(), () => this._rand());
        this._resolveBattedBall(outcome, batterId, battingSide, () => this._rand());
        this._advanceLineup(battingSide);
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: outcome.kind });
        return;
      }

      await this.emit('count', { balls: this.balls, strikes: this.strikes });
      if (this.aborted) return;

      if (this.strikes >= this.settings.MECHANICS.strikesForOut) {
        this.outs += 1;
        this.totals[battingSide].strikeouts += 1;
        this._advanceLineup(battingSide);
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: 'strikeout' });
        return;
      }
      if (this.balls >= this.settings.MECHANICS.ballsForWalk) {
        const { bases, runsScored } = advanceWalk(this.bases, batterId);
        this.bases = bases;
        this.totals[battingSide].walks += 1;
        this._addRuns(battingSide, runsScored);
        this._advanceLineup(battingSide);
        await this.emit('atBatEnd', { batterId, side: battingSide, outcome: 'walk', runsScored });
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
      const isSacFly = outcome.kind === 'flyout'
        && this.bases[2] != null
        && this.outs < this.settings.MECHANICS.outsPerInning - 1;
      if (isSacFly) {
        const { bases, runsScored } = advanceSacFly(this.bases);
        this.bases = bases;
        this.outs += 1; // no hit credited on a sac fly - the batter is out
        this._addRuns(battingSide, runsScored);
        return;
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
        return;
      }
      this.outs += 1;
      return;
    }
    if (outcome.result === 'error') {
      const { bases, runsScored } = advanceAll(this.bases, batterId, 1);
      this.bases = bases;
      this.totals[battingSide].errors += 1;
      this._addRuns(battingSide, runsScored);
      return;
    }
    // a hit
    const { bases, runsScored } = advanceAll(this.bases, batterId, outcome.bases);
    this.bases = bases;
    this.totals[battingSide].hits += 1;
    this._addRuns(battingSide, runsScored);
  }
}

export default { Game, SNAP_V, validateSnapshot, LEAGUES };
