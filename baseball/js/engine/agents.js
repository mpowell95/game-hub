// agents.js : the pluggable decision-makers. `game.js` awaits `agent.decidePitch(view)` for the
// team on defense and `agent.decideSwing(view)` for the team at bat; it legalizes/validates
// whatever comes back the same way Escoba's `Game.legalize()` never trusts an agent blindly (see
// escoba/js/game.js). Every agent here is synchronous under the hood but returns a Promise, so a
// future human-driven agent (resolving on a UI tap) can share the exact same call shape with no
// change to game.js.
//
// DETERMINISM: every agent below draws its randomness from `view.rand01`, the SAME seeded stream
// game.js itself advances and snapshots (see rng.js's `stepRng`). An agent that reached for
// Math.random would make two runs of an identical seed diverge the moment it acted.
//
// Step 2 (phase 2): CPU behavior now actually spreads by league (doc §8, [Locked]) instead of
// copying one tested tier everywhere - `CpuPitcher` draws from `CPU[league].pitchMix`, aims by
// `cornerBias`, and (at leagues with `weakSpotWeight` above zero) leans toward the batter's own
// recently-weak zone; `CpuBatter` reads `view.pitchHistory` (now `{type, x}` per entry) through
// `patternWeight` to shift its timing (repeated SPEED) and its aim (repeated LOCATION).

import { CPU, PITCH_TRAVEL_MULT, PATTERN_WEIGHTS, STYLE_BEHAVIOR, unlockedPitchesFor } from './settings.js';
import { ZONE } from './pitch.js';
import { pickWeighted } from './rng.js';

/** A CPU pitcher. Picks from whatever pitches are unlocked for its league (and, for a player's own
 *  career opponent, their World Series titles - CPU rosters never carry titles, doc §8: "CPU stats
 *  do not track or react to your stats", so `wsTitles` is always 0 for a CPU pitcher), weighted by
 *  that league's `pitchMix`. Aims by `cornerBias` - how often and how far off the middle - and, at
 *  a league with `weakSpotWeight` above zero, sometimes aims at the batter's own recent weak zone
 *  instead (doc §8, [Locked]: "Majors: attacks your weak spots"). */
export class CpuPitcher {
  constructor({ league, settings }) {
    this.league = league;
    this.settings = settings;
  }
  async decidePitch(view) {
    const cpu = this.settings.CPU[this.league] || CPU.college;
    const unlocked = unlockedPitchesFor(this.league, 0);
    const weights = unlocked.map((t) => (cpu.pitchMix && cpu.pitchMix[t]) || 1);
    const type = pickWeighted(view.rand01, unlocked, weights);

    const zone = this.settings.ZONE || ZONE;
    const halfWidth = zone.xMax; // zone is symmetric about 0

    const weakSpotWeight = cpu.weakSpotWeight || 0;
    if (weakSpotWeight > 0 && view.weakZone != null && view.rand01() < weakSpotWeight) {
      // doc §8, [Locked]: "Majors: attacks your weak spots." A small scatter around the exact
      // remembered zone, same shape as the ordinary aim scatter below - a pitcher that landed
      // exactly on the recorded x every time would be reading the batter's mind, not their habits.
      const aimX = view.weakZone + (view.rand01() * 2 - 1) * 0.15;
      return { type, aim: aimX };
    }

    // cornerBias: how often the aim leaves the middle of the zone, and how far, both rising with
    // it (doc §8, [Locked]: "each league up... works the corners more"). At cornerBias 0 the
    // pitcher is still not a laser (0.4 x half-width, comfortably outside a token miss); at 1 it
    // is almost always working the very edge or just off it.
    const cornerBias = cpu.cornerBias != null ? cpu.cornerBias : 0.5;
    const inZoneBias = view.rand01() < (1 - cornerBias * 0.5) ? 0.4 : (0.9 + cornerBias * 0.9);
    const aimX = (view.rand01() * 2 - 1) * halfWidth * inZoneBias;
    return { type, aim: aimX };
  }
}

/** A CPU batter. Swings at strikes at its league's `swingIn` rate and chases pitches outside the
 *  zone at its `chase` rate (doc §14; per-league since Step 2, see settings.js's CPU table). Times
 *  its swing with a Gaussian error whose spread (`timingSigmaMs`) widens when the last few pitches'
 *  SPEED has been inconsistent and narrows when it has been repeated - doc §8, [Locked]: "Throw the
 *  same speed over and over and he times it. Change speeds and he swings early or late" - and leans
 *  its aim toward where recent pitches have been LOCATED, doc §8, [Locked]: "Keep hitting one spot
 *  and he waits there. Move the ball around for weaker contact." Both read `view.pitchHistory`
 *  (oldest first, `{type, x}` per entry) through `PATTERN_WEIGHTS` (newest weighted most) scaled by
 *  the league's own `patternWeight` - "the window is the same in every league; how strongly it is
 *  used scales by league." Sees the already-thrown pitch on `view.pitch`, same as a human agent
 *  would. */
export class CpuBatter {
  /** @param {string} [styleId] - BB-2a step 5: the batting TEAM's own style, so a `chaseMul`
   *  behavior (settings.js's STYLE_BEHAVIOR - "Patient" lays off bad pitches more than its
   *  league's own baseline) can apply without a whole extra league tier. Optional: a team with no
   *  style (e.g. a test fixture) simply gets no behavior multiplier. */
  constructor({ league, skills, settings, styleId }) {
    this.league = league;
    this.skills = skills;
    this.settings = settings;
    this.styleId = styleId;
  }
  async decideSwing(view) {
    const cpu = this.settings.CPU[this.league] || CPU.college;
    const pitch = view.pitch;

    const behavior = (this.settings.STYLE_BEHAVIOR || STYLE_BEHAVIOR)[this.styleId];
    const chaseMul = (behavior && behavior.chaseMul != null) ? behavior.chaseMul : 1;
    const swingChance = pitch.isStrike ? cpu.swingIn : cpu.chase * chaseMul;
    if (view.rand01() >= swingChance) return { action: 'take' };

    const patternWeight = cpu.patternWeight || 0;
    const hist = view.pitchHistory;
    let effectiveSigma = cpu.timingSigmaMs;
    let locationLean = null;
    if (patternWeight > 0 && hist && hist.length) {
      // hist is oldest..newest; PATTERN_WEIGHTS is newest-first, so the LAST entry gets weight[0].
      let wSum = 0, multSum = 0, xSum = 0;
      for (let i = 0; i < hist.length; i++) {
        const w = PATTERN_WEIGHTS[hist.length - 1 - i] || 0;
        const mult = (this.settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)[hist[i].type] || 1;
        multSum += mult * w;
        xSum += (hist[i].x || 0) * w;
        wSum += w;
      }
      if (wSum > 0) {
        const expectedMult = multSum / wSum;
        locationLean = xSum / wSum;
        const actualMult = (this.settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)[pitch.type] || 1;
        const speedDelta = Math.abs(actualMult - expectedMult);
        // Repeated speed (small delta) narrows the timing spread; a changed speed widens it -
        // both scaled by how much this league's batter actually leans on the read (patternWeight)
        // and how easily it is fooled by a speed change (cpu.fool).
        const penaltyMs = Math.max(0, speedDelta - 0.05) * cpu.fool * 400 * patternWeight;
        const bonusMs = Math.max(0, 0.05 - speedDelta) * cpu.fool * 200 * patternWeight;
        effectiveSigma = Math.max(10, cpu.timingSigmaMs + penaltyMs - bonusMs);
      }
    }

    const timingErrorMs = gaussianLite(view.rand01) * effectiveSigma;
    const readNoise = (1 - cpu.guess) * 0.3;
    let aimX = pitch.x + (view.rand01() * 2 - 1) * readNoise;
    if (patternWeight > 0 && locationLean != null) {
      // "Keep hitting one spot and he waits there" - a batter who has been leaning on a location
      // read has their aim pulled toward it, for better or worse depending on whether THIS pitch
      // matches that expectation.
      aimX = aimX * (1 - patternWeight * 0.5) + locationLean * (patternWeight * 0.5);
    }
    // The CPU never charges its swing this phase - doc's charge mechanic is a held-input UI
    // concern (§12), and no CPU tuning field here says how often a CPU would choose to charge.
    return { action: 'swing', aimX, timingErrorMs, charged: false };
  }
}

/** A cheap four-draw approximation of a standard normal (Irwin-Hall(4), mean 0, sd ~= 0.577),
 *  used so CpuBatter's timing error does not need rng.js's full Box-Muller `gaussian` (which
 *  wants an rng OBJECT, not a bound rand01 callback) threaded through here. Always consumes
 *  exactly four draws from the stream, so its cost is fixed and its position in the RNG sequence
 *  is as predictable as any other draw. */
function gaussianLite(rand01) {
  return (rand01() + rand01() + rand01() + rand01() - 2) / Math.sqrt(4 / 12);
}

/** Step 4: `sim-baseball.mjs`'s stand-in for a HUMAN at a given skill level - three named tiers
 *  (`MODEL_TIERS` in the simulator), never the CPU's own AI. Draws only from `view.rand01`, same
 *  discipline as every other agent. */
export class ModelBatter {
  /** @param {{timingSigmaMs:number, placementSigma:number, swingIn?:number, chase?:number}} opts
   *  `timingSigmaMs`/`placementSigma` are the model's own skill knobs (how tight the timing and
   *  the bat placement are); `swingIn`/`chase` reuse the CPU's own strike/ball swing-decision
   *  rates, since "does a human swing at this pitch" is not a different question from a CPU's. */
  constructor({ timingSigmaMs, placementSigma, swingIn = 0.85, chase = 0.20 }) {
    this.timingSigmaMs = timingSigmaMs;
    this.placementSigma = placementSigma;
    this.swingIn = swingIn;
    this.chase = chase;
  }
  async decideSwing(view) {
    const pitch = view.pitch;
    const swingChance = pitch.isStrike ? this.swingIn : this.chase;
    if (view.rand01() >= swingChance) return { action: 'take' };
    const timingErrorMs = gaussianLite(view.rand01) * this.timingSigmaMs;
    const aimX = pitch.x + (view.rand01() * 2 - 1) * this.placementSigma;
    return { action: 'swing', aimX, timingErrorMs, charged: false };
  }
}

/** Step 4: the model pitcher half of the same stand-in. `variety` plays the same role
 *  `cornerBias` plays for a CPU - how often the aim leaves dead center - and `pitchMix` is drawn
 *  from the same per-league CPU table by default, since a human is choosing among the SAME
 *  unlocked pitches a CPU would. */
export class ModelPitcher {
  constructor({ league, settings, variety, cornerBias, pitchMix }) {
    this.league = league;
    this.settings = settings;
    this.variety = variety;
    this.cornerBias = cornerBias;
    this.pitchMix = pitchMix;
  }
  async decidePitch(view) {
    const unlocked = unlockedPitchesFor(this.league, 0);
    const mix = this.pitchMix || (this.settings.CPU[this.league] || CPU.college).pitchMix;
    const weights = unlocked.map((t) => (mix && mix[t]) || 1);
    const type = this.variety > 0 ? pickWeighted(view.rand01, unlocked, weights) : unlocked[0];
    const zone = this.settings.ZONE || ZONE;
    const halfWidth = zone.xMax;
    const inZoneBias = view.rand01() < (1 - this.cornerBias * 0.5) ? 0.4 : (0.9 + this.cornerBias * 0.9);
    const aimX = (view.rand01() * 2 - 1) * halfWidth * inZoneBias;
    return { type, aim: aimX };
  }
}

/** Replays a fixed, pre-recorded script of decisions - one per call, in order - for deterministic
 *  test scenarios that need to force an exact sequence of pitches/swings rather than let a CPU
 *  agent choose. Throws if asked for more decisions than the script provides, rather than
 *  silently falling back to something a test did not ask for. */
export class ScriptedAgent {
  constructor(pitchScript = [], swingScript = []) {
    this._pitches = pitchScript.slice();
    this._swings = swingScript.slice();
    this._pi = 0;
    this._si = 0;
  }
  async decidePitch() {
    if (this._pi >= this._pitches.length) throw new Error('ScriptedAgent: pitch script exhausted');
    return this._pitches[this._pi++];
  }
  async decideSwing() {
    if (this._si >= this._swings.length) throw new Error('ScriptedAgent: swing script exhausted');
    return this._swings[this._si++];
  }
}

export default { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher, ScriptedAgent };
