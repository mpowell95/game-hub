// swing.js : resolve one batter decision against one already-thrown pitch. Pure function of its
// inputs (the pitch, the batter's skills, the batter's decision, settings, one rand01 stream) -
// no clock, no module-scope state, no direct RNG object (the caller owns advancing/snapshotting
// the stream via a plain `rand01` callback, same contract as pitch.js's `flyPitch`).

import { ZONE } from './pitch.js';

/**
 * @param {object} pitchResult - flyPitch()'s return value
 * @param {{contact:number, power:number}} batterSkills - 0..CAPS.perSkill point values
 * @param {{action:'swing'|'take', timingErrorMs?:number, power?:number}} decision
 * @param {object} settings
 * @param {function} rand01
 * @returns {{swung:boolean, contact:boolean, foul:boolean, inPlay:boolean,
 *            exitVeloMph?:number, launchAngleDeg?:number, sprayAngleDeg?:number}}
 */
export function swing(pitchResult, batterSkills, decision, settings, rand01) {
  if (!decision || decision.action !== 'swing') {
    return { swung: false, contact: false, foul: false, inPlay: false };
  }

  const zone = settings.ZONE || ZONE;
  const contactPts = Math.max(0, Math.min(settings.CAPS.perSkill, batterSkills.contact || 0));
  const powerPts = Math.max(0, Math.min(settings.CAPS.perSkill, batterSkills.power || 0));
  const effect = settings.SKILL_EFFECT;

  // How far the pitch sat from the zone's own center, in feet - the harder-to-hit measure a real
  // swing struggles with (a pitch dead center is the easiest to square up).
  const cx = (zone.xMin + zone.xMax) / 2;
  const cz = (zone.zMin + zone.zMax) / 2;
  const missFt = Math.hypot(pitchResult.x - cx, pitchResult.z - cz);

  const timingErrorMs = decision.timingErrorMs || 0;
  const timingPenalty = Math.min(1, Math.abs(timingErrorMs) / 220);

  const contactRadiusFt = 1.0 + contactPts * effect.contact.contactRadiusInPerPt / 12;
  const whiffReduction = contactPts * effect.contact.whiffReductionPerPt;

  // Base whiff chance rises with how far off-center the pitch was and how mistimed the swing was,
  // and falls with contact skill. Clamped so neither a perfect swing nor a terrible one is a sure
  // thing - this game should never guarantee an outcome from pure stats alone.
  let whiffChance = 0.12 + missFt / contactRadiusFt * 0.35 + timingPenalty * 0.4 - whiffReduction;
  whiffChance = Math.max(0.03, Math.min(0.92, whiffChance));

  if (rand01() < whiffChance) {
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  // Contact made. A fraction of contact is foul rather than fair, worse with more timing error.
  const foulChance = Math.max(0.08, Math.min(0.6, 0.18 + timingPenalty * 0.35));
  if (rand01() < foulChance) {
    return { swung: true, contact: true, foul: true, inPlay: false };
  }

  // In play: exit velocity from power skill plus swing quality, launch angle and spray from the
  // pitch location, the swing's own aim, and randomness.
  const power = Math.max(0, Math.min(1, decision.power != null ? decision.power : 0.6));
  const baseExitVelo = 62 + power * 30;
  const powerBonus = powerPts * effect.power.exitVeloMphPerPt;
  const qualityLoss = (missFt / contactRadiusFt) * 14 + timingPenalty * 10;
  const exitVeloMph = Math.max(35, baseExitVelo + powerBonus - qualityLoss + (rand01() * 2 - 1) * 4);

  // Launch angle: a pitch low in the zone tends to be lifted more; add swing/random spread.
  const zoneFrac = (pitchResult.z - zone.zMin) / (zone.zMax - zone.zMin); // 0 low .. 1 high
  const launchAngleDeg = Math.max(-25, Math.min(55,
    32 - zoneFrac * 22 + (rand01() * 2 - 1) * 18));

  const sprayAngleDeg = (rand01() * 2 - 1) * 44; // -44..44, 0 straight up the middle

  return { swung: true, contact: true, foul: false, inPlay: true, exitVeloMph, launchAngleDeg, sprayAngleDeg };
}

export default { swing };
