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

import { CPU, PITCH_TRAVEL_MULT, PATTERN_WEIGHTS, STYLE_BEHAVIOR, unlockedPitchesFor,
  AIM_CORNER_CHANCE_MULT, AIM_INZONE_BIAS, AIM_CORNER_BIAS_BASE, AIM_CORNER_BIAS_SCALE,
  WEAKSPOT_AIM_SCATTER, SPEED_DELTA_DEADBAND, FOOL_PENALTY_MS_SCALE, FOOL_BONUS_MS_SCALE,
  LOCATION_LEAN_WEIGHT, VARIETY_REPEAT_BASE_CHANCE,
  CPU_SIGMA_MIN_MS, CPU_SIGMA_ABSOLUTE_FLOOR_MS, LEAGUES,
  SPEED_SURPRISE_MS_PER_MULT } from './settings.js';
import { ZONE } from './pitch.js';
import { pickWeighted } from './rng.js';

/** BB-2c commit 2: the CPU strength contract's timing half, doc §8, [Locked] (design doc v9):
 *  "CPU batters may never time or place better than a median human, in any league or any slot."
 *  Two floors, taken together, replace BB-2b's single flat `CPU_SIGMA_FLOOR_MS` (which turned out
 *  to be exact parity with a median human, not a floor, AND was applied to the league's own base
 *  only - a tough ladder slot's own NEGATIVE offset could still push its effective sigma back
 *  under it, which is exactly what happened to BB-2b's own first-draft champion slot).
 *
 *  `CPU_SIGMA_MIN_MS[league]` bounds that league's own BASE sigma (before any ladder offset) -
 *  Little League can still be far sloppier than a median human while Majors' base can't drift far
 *  above it. `CPU_SIGMA_ABSOLUTE_FLOOR_MS` is applied AFTER the ladder offset, not before, so this
 *  function's own return value can never itself violate the absolute floor - the caller
 *  (`CpuBatter.decideSwing`) additionally re-clamps after its own pattern-read timing bonus, since
 *  that bonus is a further, later adjustment this function has no visibility into. */
/** BB-2d commit 5: `ladderOffset.sigmaFloorMs` (set by `teams.js`'s `makeLeague`, per
 *  `SLOT_SIGMA_DESCENT`) overrides the league-flat floor for slots 5-7 - a real CPU team's own
 *  slot descends this floor toward `CPU_SIGMA_ABSOLUTE_FLOOR_MS`; anything without a resolved
 *  slot (a measurement harness building an ungraded team, or slots 0-4) falls back to the
 *  league-flat floor exactly as before this commit. */
export function cpuSigmaFloorMs(league, settings, ladderOffset) {
  const leagueMin = (settings.CPU_SIGMA_MIN_MS && settings.CPU_SIGMA_MIN_MS[league]) != null
    ? settings.CPU_SIGMA_MIN_MS[league] : CPU_SIGMA_MIN_MS[league];
  const absFloor = settings.CPU_SIGMA_ABSOLUTE_FLOOR_MS != null ? settings.CPU_SIGMA_ABSOLUTE_FLOOR_MS : CPU_SIGMA_ABSOLUTE_FLOOR_MS;
  const slotFloor = (ladderOffset && ladderOffset.sigmaFloorMs != null) ? ladderOffset.sigmaFloorMs : leagueMin;
  return Math.max(slotFloor != null ? slotFloor : absFloor, absFloor);
}
export function cpuBaseTimingSigmaMs(league, settings, ladderOffset) {
  const cpu = (settings.CPU && settings.CPU[league]) || CPU.college;
  const floor = cpuSigmaFloorMs(league, settings, ladderOffset);
  const offsetMs = (ladderOffset && ladderOffset.timingSigmaMs) || 0;
  return Math.max(floor, cpu.timingSigmaMs + offsetMs);
}

/** BB-2d commit 5: the CHAMPION_CEILING rule - an effective per-slot pitching-behavior value
 *  (after `behaviorMul`) can never exceed the NEXT league's own BASE row for that field (Majors,
 *  with no next league, is its own ceiling). `LEAGUES`' own order is the ladder; a league not in
 *  it (should not happen) falls back to no ceiling beyond the league's own row. */
function championCeilingRow(league, settings) {
  const order = settings.LEAGUES || LEAGUES;
  const idx = order.indexOf(league);
  const nextLeague = (idx >= 0 && idx + 1 < order.length) ? order[idx + 1] : league;
  const cpu = settings.CPU || CPU;
  return cpu[nextLeague] || cpu[league] || CPU.college;
}

/** The shared "a pitch faster or slower than the batter expected fools their timing" mechanism
 *  (doc §8, [Locked]: "Change speeds and he swings early or late") - BB-2b commit 3, applied
 *  identically to `ModelBatter` (which had NO pattern awareness at all before this phase) and
 *  usable by `CpuBatter` alongside its own existing fool/patternWeight formula. Returns extra ms
 *  of timing sigma, proportional to how far the ACTUAL pitch's travel multiple sits from the
 *  EXPECTED one (a weighted average of recent pitches' own multiples). */
export function speedSurpriseMs(actualMult, expectedMult, msPerMult) {
  if (expectedMult == null) return 0;
  return Math.abs(actualMult - expectedMult) * msPerMult;
}

/** The pattern-weighted "expected" pitch-speed travel multiple from a batter's own recent
 *  history (oldest..newest, `{type, x}` per doc §8's last-3-pitches memory), or `null` with no
 *  history to read - shared by `CpuBatter` and `ModelBatter` so both compute "what did I expect"
 *  the same way. */
function expectedTravelMult(hist, travelMult) {
  if (!hist || !hist.length) return null;
  let wSum = 0, multSum = 0;
  for (let i = 0; i < hist.length; i++) {
    const w = PATTERN_WEIGHTS[hist.length - 1 - i] || 0;
    multSum += (travelMult[hist[i].type] || 1) * w;
    wSum += w;
  }
  return wSum > 0 ? multSum / wSum : null;
}

/** A CPU pitcher. Picks from whatever pitches are unlocked for its league (and, for a player's own
 *  career opponent, their World Series titles - CPU rosters never carry titles, doc §8: "CPU stats
 *  do not track or react to your stats", so `wsTitles` is always 0 for a CPU pitcher), weighted by
 *  that league's `pitchMix`. Aims by `cornerBias` - how often and how far off the middle - and, at
 *  a league with `weakSpotWeight` above zero, sometimes aims at the batter's own recent weak zone
 *  instead (doc §8, [Locked]: "Majors: attacks your weak spots"). */
export class CpuPitcher {
  /** @param {{timingSigmaMs?:number, chase?:number, behaviorMul?:number, changeupShare?:number}} [ladderOffset]
   *  - BB-2d commit 5: the pitching TEAM's own ladder-slot offset (`teams.js`'s `makeLeague`) -
   *  `behaviorMul` scales `cornerBias`/`weakSpotWeight` (both PITCHING behaviors), `changeupShare`
   *  leans the pitch mix toward the changeup. Both are bounded by `championCeilingRow` so a
   *  league's champion slot can never out-pitch the next league's own base row. */
  constructor({ league, settings, ladderOffset }) {
    this.league = league;
    this.settings = settings;
    this.ladderOffset = ladderOffset || null;
  }
  async decidePitch(view) {
    const cpu = this.settings.CPU[this.league] || CPU.college;
    const behaviorMul = (this.ladderOffset && this.ladderOffset.behaviorMul != null) ? this.ladderOffset.behaviorMul : 1;
    const changeupShare = (this.ladderOffset && this.ladderOffset.changeupShare) || 0;
    const ceilingRow = championCeilingRow(this.league, this.settings);

    const unlocked = unlockedPitchesFor(this.league, 0);
    const mix = { ...(cpu.pitchMix || {}) };
    if (unlocked.includes('changeup')) mix.changeup = (mix.changeup || 1) + changeupShare;
    const weights = unlocked.map((t) => (mix && mix[t]) || 1);
    const type = pickWeighted(view.rand01, unlocked, weights);

    const zone = this.settings.ZONE || ZONE;
    const halfWidth = zone.xMax; // zone is symmetric about 0
    const halfHeight = zone.yMax != null ? zone.yMax : 1; // R2: and about the middle of its height

    // BB-2d commit 5: CHAMPION_CEILING - the effective weakSpotWeight/cornerBias (after
    // behaviorMul) can never exceed the NEXT league's own base row for that field.
    const weakSpotWeight = Math.min((cpu.weakSpotWeight || 0) * behaviorMul, ceilingRow.weakSpotWeight != null ? ceilingRow.weakSpotWeight : 1);
    if (weakSpotWeight > 0 && view.weakZone != null && view.rand01() < weakSpotWeight) {
      // doc §8, [Locked]: "Majors: attacks your weak spots." A small scatter around the exact
      // remembered zone, same shape as the ordinary aim scatter below - a pitcher that landed
      // exactly on the recorded x every time would be reading the batter's mind, not their habits.
      // R2: the weak-spot memory (`_recordWeak`, game.js) is lateral only, so the HEIGHT of a
      // weak-spot pitch is chosen the ordinary way rather than invented from a record that does
      // not exist.
      const aimX = view.weakZone + (view.rand01() * 2 - 1) * WEAKSPOT_AIM_SCATTER;
      return { type, aim: { x: aimX, y: (view.rand01() * 2 - 1) * halfHeight * AIM_INZONE_BIAS } };
    }

    // cornerBias: how often the aim leaves the middle of the zone, and how far, both rising with
    // it (doc §8, [Locked]: "each league up... works the corners more"). At cornerBias 0 the
    // pitcher is still not a laser (AIM_INZONE_BIAS x half-width, comfortably outside a token
    // miss); at 1 it is almost always working the very edge or just off it.
    const cornerBias = Math.min((cpu.cornerBias != null ? cpu.cornerBias : 0.5) * behaviorMul,
      ceilingRow.cornerBias != null ? ceilingRow.cornerBias : 1);
    const inZoneBias = view.rand01() < (1 - cornerBias * AIM_CORNER_CHANCE_MULT)
      ? AIM_INZONE_BIAS : (AIM_CORNER_BIAS_BASE + cornerBias * AIM_CORNER_BIAS_SCALE);
    const aimX = (view.rand01() * 2 - 1) * halfWidth * inZoneBias;
    // R2 (docs/BASEBALL-3D-BUILD.md section 9): the aim is 2-D now, so a CPU pitcher picks a
    // HEIGHT the same way it picks a side - the same `inZoneBias`, so a corner-working league
    // works the top and bottom of the zone exactly as hard as it works the edges, and one pitcher
    // does not become a machine that lives at the belt.
    return { type, aim: { x: aimX, y: (view.rand01() * 2 - 1) * halfHeight * inZoneBias } };
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
   *  style (e.g. a test fixture) simply gets no behavior multiplier.
   *  @param {{timingSigmaMs?:number, chase?:number}} [ladderOffset] - BB-2b commit 3: the batting
   *  TEAM's own ladder-slot offset (`teams.js`'s `makeLeague`, from `settings.TEAM_LADDER_OFFSETS`)
   *  - additive ms/chase adjustments so a team's own SLOT (not just its style) makes it bat
   *  sloppier/more patient (weak slots) or sharper/more selective (strong slots) within one league. */
  constructor({ league, skills, settings, styleId, ladderOffset }) {
    this.league = league;
    this.skills = skills;
    this.settings = settings;
    this.styleId = styleId;
    this.ladderOffset = ladderOffset || null;
  }
  async decideSwing(view) {
    const cpu = this.settings.CPU[this.league] || CPU.college;
    const pitch = view.pitch;

    const behavior = (this.settings.STYLE_BEHAVIOR || STYLE_BEHAVIOR)[this.styleId];
    const chaseMul = (behavior && behavior.chaseMul != null) ? behavior.chaseMul : 1;
    const chaseOffset = (this.ladderOffset && this.ladderOffset.chase) || 0;
    const chaseChance = Math.max(0, Math.min(1, cpu.chase * chaseMul + chaseOffset));
    const swingChance = pitch.isStrike ? cpu.swingIn : chaseChance;
    if (view.rand01() >= swingChance) return { action: 'take' };

    // BB-2d commit 5: `behaviorMul` (this batting team's own ladder-slot offset) scales
    // patternWeight too, bounded by CHAMPION_CEILING (the next league's own base patternWeight) -
    // the champion slot reads the human's pitching patterns more sharply than its league's
    // weakest team, but never past what the next league up already does by default.
    const slotBehaviorMul = (this.ladderOffset && this.ladderOffset.behaviorMul != null) ? this.ladderOffset.behaviorMul : 1;
    const patternCeiling = championCeilingRow(this.league, this.settings).patternWeight;
    const patternWeight = Math.min((cpu.patternWeight || 0) * slotBehaviorMul, patternCeiling != null ? patternCeiling : 1);
    const hist = view.pitchHistory;
    const travelMult = this.settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT;
    const baseSigma = cpuBaseTimingSigmaMs(this.league, this.settings, this.ladderOffset);
    let effectiveSigma = baseSigma;
    let locationLean = null;
    if (patternWeight > 0 && hist && hist.length) {
      const expectedMult = expectedTravelMult(hist, travelMult);
      // hist is oldest..newest; PATTERN_WEIGHTS is newest-first, so the LAST entry gets weight[0].
      let wSum = 0, xSum = 0;
      for (let i = 0; i < hist.length; i++) {
        const w = PATTERN_WEIGHTS[hist.length - 1 - i] || 0;
        xSum += (hist[i].x || 0) * w;
        wSum += w;
      }
      if (expectedMult != null && wSum > 0) {
        locationLean = xSum / wSum;
        const actualMult = travelMult[pitch.type] || 1;
        const speedDelta = Math.abs(actualMult - expectedMult);
        // Repeated speed (small delta) narrows the timing spread; a changed speed widens it -
        // both scaled by how much this league's batter actually leans on the read (patternWeight)
        // and how easily it is fooled by a speed change (cpu.fool).
        const penaltyMs = Math.max(0, speedDelta - SPEED_DELTA_DEADBAND) * cpu.fool * FOOL_PENALTY_MS_SCALE * patternWeight;
        const bonusMs = Math.max(0, SPEED_DELTA_DEADBAND - speedDelta) * cpu.fool * FOOL_BONUS_MS_SCALE * patternWeight;
        // BB-2c commit 2: the pattern-read BONUS (a repeated pitch speed narrowing the spread) is
        // re-clamped to the league's own sigma floor here too - `baseSigma` already respects it,
        // but `bonusMs` is a further, later reduction this function's own caller has no visibility
        // into, and nothing before this phase stopped a big bonus from re-opening the exact gap
        // the floor exists to close.
        effectiveSigma = Math.max(cpuSigmaFloorMs(this.league, this.settings), baseSigma + penaltyMs - bonusMs);
      }
    }

    const timingErrorMs = gaussianLite(view.rand01) * effectiveSigma;
    // BB-2c commit 2, doc §8, [Locked] (design doc v9): "CPU batters may never... place better than
    // a median human." Base placement noise is now `CPU[league].placementNoise` (a per-league
    // constant at or above `CPU_PLACEMENT_MIN`) - `guess` no longer touches it at all. `guess`
    // instead drives ONLY how far the aim leans toward the pattern-read `locationLean` (doc §8:
    // "how much CPU leans to your recent spot" - a reading skill, not a placement-precision one).
    // R2 (docs/BASEBALL-3D-BUILD.md section 9): a CPU batter aims its CURSOR, in two axes, at the
    // pitch's STRAIGHT point (`straightX`/`straightY` - where the ball appears to be going when it
    // leaves the hand), never at where it will actually end up. That is the honest model of what a
    // batter can see, and it is what makes a breaking ball worth throwing: the break is exactly the
    // distance the CPU's cursor is off by. A pitch from a fixture with no straight point (a plain
    // `{x}` object in a test) falls back to its own final position, which is the pre-R2 behaviour.
    const seenX = pitch.straightX != null ? pitch.straightX : pitch.x;
    const seenY = pitch.straightY != null ? pitch.straightY : (pitch.y || 0);
    let aimX = seenX + (view.rand01() * 2 - 1) * cpu.placementNoise;
    const aimY = seenY + (view.rand01() * 2 - 1) * cpu.placementNoise;
    if (patternWeight > 0 && locationLean != null) {
      // "Keep hitting one spot and he waits there" - a batter who has been leaning on a location
      // read has their aim pulled toward it, for better or worse depending on whether THIS pitch
      // matches that expectation. The lean weight is scaled by `guess` on top of `patternWeight`,
      // so a league that reads patterns more (patternWeight) AND leans on them harder (guess) both
      // move this, while never touching the base placement noise above.
      const leanWeight = patternWeight * LOCATION_LEAN_WEIGHT * (cpu.guess != null ? cpu.guess : 1);
      aimX = aimX * (1 - leanWeight) + locationLean * leanWeight;
    }
    return { action: 'swing', cursor: { x: aimX, y: aimY }, timingErrorMs, mode: pickMode(this.skills, view.rand01) };
  }
}

/** R2 (docs/BASEBALL-3D-BUILD.md section 9): WHICH BATTING MODE a non-human batter picks. POWER is
 *  a smaller cursor circle for x1.12 exit velocity (settings.js's `cursorR`/`modeExitMult`), so it
 *  is a bet a strong batter is right to make more often - the chance rises with hitPow and is
 *  capped well under "always", because a CPU that never chose CONTACT would simply miss more.
 *  `POWER_MODE_PER_HITPOW`/`POWER_MODE_MAX` are R2's own choice, not a measured value; what
 *  measures it is `sim-baseball.mjs`'s batted-ball census. Always consumes exactly one draw, so
 *  its cost in the seeded stream is fixed. */
const POWER_MODE_PER_HITPOW = 0.05;
const POWER_MODE_MAX = 0.6;
export function pickMode(skills, rand01, override) {
  const chance = override != null ? override
    : Math.min(POWER_MODE_MAX, Math.max(0, (skills && skills.hitPow) || 0) * POWER_MODE_PER_HITPOW);
  return rand01() < chance ? 'power' : 'contact';
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
  /** @param {{timingSigmaMs:number, placementSigma:number, swingIn?:number, chase?:number, settings?:object}} opts
   *  `timingSigmaMs`/`placementSigma` are the model's own skill knobs (how tight the timing and
   *  the bat placement are); `swingIn`/`chase` reuse the CPU's own strike/ball swing-decision
   *  rates, since "does a human swing at this pitch" is not a different question from a CPU's.
   *  `settings` (BB-2b commit 3, optional) is only needed for `PITCH_TRAVEL_MULT`/
   *  `SPEED_SURPRISE_MS_PER_MULT` overrides in a settings-sweep test; the real module's own values
   *  are the default. */
  constructor({ timingSigmaMs, placementSigma, swingIn = 0.85, chase = 0.20, settings, skills, powerChance }) {
    this.timingSigmaMs = timingSigmaMs;
    this.placementSigma = placementSigma;
    this.swingIn = swingIn;
    this.chase = chase;
    this.settings = settings;
    // R2: a model human picks CONTACT or POWER like anyone else. `skills` (optional) lets
    // `pickMode` read hitPow; `powerChance` overrides the whole decision for a sweep that wants
    // one mode held fixed.
    this.skills = skills;
    this.powerChance = powerChance;
  }
  async decideSwing(view) {
    const pitch = view.pitch;
    const swingChance = pitch.isStrike ? this.swingIn : this.chase;
    if (view.rand01() >= swingChance) return { action: 'take' };
    // BB-2b commit 3, doc §8: "Change speeds and he swings early or late" - a human is fooled by a
    // pitch speed that surprises them exactly the way a CpuBatter's own pattern read already was
    // (see `speedSurpriseMs`/`expectedTravelMult` above), which `ModelBatter` never modeled before
    // this phase (it read no pitch history at all).
    const travelMult = (this.settings && (this.settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)) || PITCH_TRAVEL_MULT;
    const msPerMult = (this.settings && this.settings.SPEED_SURPRISE_MS_PER_MULT) || SPEED_SURPRISE_MS_PER_MULT;
    const expectedMult = expectedTravelMult(view.pitchHistory, travelMult);
    const actualMult = travelMult[pitch.type] || 1;
    const surpriseMs = speedSurpriseMs(actualMult, expectedMult, msPerMult);
    const effectiveSigma = this.timingSigmaMs + surpriseMs;
    const timingErrorMs = gaussianLite(view.rand01) * effectiveSigma;
    // R2: the same 2-D cursor a CPU batter places, and against the same STRAIGHT point (see
    // `CpuBatter.decideSwing`'s own note) - a model human reads the pitch out of the hand too.
    const seenX = pitch.straightX != null ? pitch.straightX : pitch.x;
    const seenY = pitch.straightY != null ? pitch.straightY : (pitch.y || 0);
    const aimX = seenX + (view.rand01() * 2 - 1) * this.placementSigma;
    const aimY = seenY + (view.rand01() * 2 - 1) * this.placementSigma;
    return { action: 'swing', cursor: { x: aimX, y: aimY }, timingErrorMs, mode: pickMode(this.skills || {}, view.rand01, this.powerChance) };
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
    this._lastType = null; // BB-2b commit 3: continuous variety needs to know the PREVIOUS pitch
  }
  async decidePitch(view) {
    const unlocked = unlockedPitchesFor(this.league, 0);
    const mix = this.pitchMix || (this.settings.CPU[this.league] || CPU.college).pitchMix;
    const weights = unlocked.map((t) => (mix && mix[t]) || 1);
    // BB-2b commit 3: `variety` is now CONTINUOUS - the chance of repeating the immediately-
    // previous pitch type falls linearly from `VARIETY_REPEAT_BASE_CHANCE` at variety=0 to 0 at
    // variety=1, replacing the old binary "variety>0 draws randomly, variety<=0 always throws the
    // same pitch forever" (doc §8's own framing - "mixes pitches more" each league up - is a
    // continuous quantity, not an on/off switch).
    const repeatBase = (this.settings && this.settings.VARIETY_REPEAT_BASE_CHANCE) || VARIETY_REPEAT_BASE_CHANCE;
    const repeatChance = Math.max(0, repeatBase * (1 - Math.max(0, Math.min(1, this.variety))));
    let type;
    if (this._lastType && unlocked.includes(this._lastType) && view.rand01() < repeatChance) {
      type = this._lastType;
    } else {
      type = pickWeighted(view.rand01, unlocked, weights);
    }
    this._lastType = type;
    const zone = this.settings.ZONE || ZONE;
    const halfWidth = zone.xMax;
    const inZoneBias = view.rand01() < (1 - this.cornerBias * AIM_CORNER_CHANCE_MULT)
      ? AIM_INZONE_BIAS : (AIM_CORNER_BIAS_BASE + this.cornerBias * AIM_CORNER_BIAS_SCALE);
    const aimX = (view.rand01() * 2 - 1) * halfWidth * inZoneBias;
    const halfHeight = zone.yMax != null ? zone.yMax : 1;
    return { type, aim: { x: aimX, y: (view.rand01() * 2 - 1) * halfHeight * inZoneBias } };
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

export default { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher, ScriptedAgent, cpuBaseTimingSigmaMs, cpuSigmaFloorMs, speedSurpriseMs, pickMode };
