// pitch.js : one pitch, thrown. Pure function of its inputs (a pitcher's aim, their pitchAcc
// skill, the pitch type, the settings table, and a single [0,1) draw) - never a live clock,
// never module-scope state. Two pitches given the same inputs are identical.
//
// ONE FLAT PLANE (doc §1, [Locked]): "pitches vary left/right and speed. Height does not
// matter." So a pitch has exactly ONE spatial coordinate, `x` - a fraction of the plate's half
// width (doc §15's units note: "Lateral positions... are fractions of the plate's half width").
// `x` in [-1, 1] is inside the strike zone; anything further out is a ball. Phase 1 modeled a 2-D
// box with a height axis that the real design does not have at all - BB-1a corrects that.

import { PITCH_TRAVEL_MULT } from './settings.js';

/** The strike zone's lateral half-width, in the doc's own units (a fraction of the plate's half
 *  width, so the zone IS the unit: |x| <= 1 is a strike). Exported as an object for call-site
 *  symmetry with the rest of the engine's "pass settings.ZONE" convention. */
export const ZONE = { xMin: -1, xMax: 1 };

/**
 * Throw one pitch.
 * @param {string} type - a PITCH_TYPES entry
 * @param {number} aimX - where the pitcher is aiming, as a fraction of the plate half-width
 * @param {number} pitchAccSkill01 - 0..1, higher = tighter around `aimX` (resolved from the
 *   pitcher's pitchAcc skill points by the caller)
 * @param {object} settings - the settings module (or an object shaped like it)
 * @param {function} rand01 - () => next draw in [0,1); caller owns advancing/snapshotting state
 * @returns {{type, x, isStrike, timeToPlateS}}
 */
export function flyPitch(type, aimX, pitchAccSkill01, settings, rand01) {
  const travelMult = (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)[type]
    ?? (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT).fastball;
  const skill = Math.max(0, Math.min(1, pitchAccSkill01));
  // FEEL.engine.aimScatter is the doc's own "normal pitch miss from aim" (§14, [Tested]) - a
  // fraction of the plate half-width. Higher pitchAcc tightens it; a perfectly-skilled arm
  // (skill=1) still keeps a third of it (a pitch is never a laser), same shape phase 1 used.
  const scatter = settings.FEEL.engine.aimScatter * (1 - skill * 0.67);
  const x = aimX + (rand01() * 2 - 1) * scatter;
  const zone = settings.ZONE || ZONE;
  const isStrike = x >= zone.xMin && x <= zone.xMax;
  const timeToPlateS = (settings.FEEL.engine.fastballMs / 1000) * travelMult;
  return { type, x, isStrike, timeToPlateS };
}

export default { ZONE, flyPitch };
