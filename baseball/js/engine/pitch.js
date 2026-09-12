// pitch.js : one pitch, thrown. Pure function of its inputs (a pitcher's arm skill, the pitch type,
// the pitcher's aim, the settings table, and a single [0,1) draw) plus the settings' own tables -
// never a live clock, never module-scope state. Two pitches given the same inputs are identical.

import { PITCH_PROFILE } from './settings.js';

/** Strike zone in feet, centered on home plate: x in [-0.83, 0.83] (17in plate), z (height) in
 *  [1.5, 3.5] (a fixed zone - a batter's real height would shrink/grow this in a later phase). */
export const ZONE = { xMin: -0.83, xMax: 0.83, zMin: 1.5, zMax: 3.5 };

/**
 * Throw one pitch.
 * @param {string} type - a PITCH_TYPES entry
 * @param {{x:number, z:number}} aim - where the pitcher is aiming, zone-relative feet
 * @param {number} controlSkill - 0..1, higher = tighter around `aim` (a pitcher's arm skill,
 *   already resolved from their skill points by the caller)
 * @param {object} settings - the settings module (or an object shaped like it)
 * @param {function} rand01 - () => next draw in [0,1); caller owns advancing/snapshotting state
 * @returns {{type, speedMph, moveIn, x, z, isStrike, timeToPlateS}}
 */
export function flyPitch(type, aim, controlSkill, settings, rand01) {
  const profile = settings.PITCH_PROFILE[type] || PITCH_PROFILE.fastball;
  const skill = Math.max(0, Math.min(1, controlSkill));
  // Higher control -> smaller spread. controlDeg is the pitch's own baseline difficulty; a
  // perfectly-skilled arm (skill=1) still keeps a third of it (a pitch is never a laser).
  const spreadFt = (profile.controlDeg / 12) * (1 - skill * 0.67);
  const jx = (rand01() * 2 - 1) * spreadFt;
  const jz = (rand01() * 2 - 1) * spreadFt;
  const x = aim.x + jx;
  const z = aim.z + jz;
  const zone = settings.ZONE || ZONE;
  const isStrike = x >= zone.xMin && x <= zone.xMax && z >= zone.zMin && z <= zone.zMax;
  const timeToPlateS = settings.FEEL.engine.pitchFlightS * (92 / profile.speedMph);
  return { type, speedMph: profile.speedMph, moveIn: profile.moveIn, x, z, isStrike, timeToPlateS };
}

export default { ZONE, flyPitch };
