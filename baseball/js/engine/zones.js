// zones.js : out-zone geometry (doc §10, [Locked]: "No fielders drawn. Out zones sit where
// fielders would stand" - 4 infield ground-out zones, 3 outfield fly-out zones). Pure - no
// randomness, no state - replaces phase 1's invented `_defenseLevel01()` league-ordered ramp with
// real geometry, scaled per league by `settings.FIELD[league].outZoneMult`/`fieldScale` (still
// Draft, Open item 7: the doc locks that zones exist and grow per league, not their exact sizes).
//
// Coordinates: sprayAngleDeg is degrees off dead center (negative = left field, positive = right),
// matching outcomes.js's existing foul-line convention (`FOUL_LINE_DEG`, doc §15's units note -
// fair territory spans the full -45..+45). Distances are feet from home plate, `carryFt`'s units.

import { FIELD } from './settings.js';

// One geometry, invented (Open item 7), shared by every league before per-league scaling: four
// infield sectors roughly 3B/SS/2B/1B, three outfield sectors LF/CF/RF. `toFt - fromFt` is the
// sector's COVERAGE DEPTH, which is what `outZoneMult` scales - the near edge (`fromFt`) scales
// with `fieldScale` (the field's own size) instead, so the two multipliers scale two different
// things rather than compounding onto one number (compounding both onto `toFt` directly, tried
// first, put a majors outfielder's reach past that league's own fence).
const BASE_INFIELD_SECTORS = [
  { fromDeg: -45, toDeg: -22.5, fromFt: 8, toFt: 62 },
  { fromDeg: -22.5, toDeg: 0, fromFt: 8, toFt: 68 },
  { fromDeg: 0, toDeg: 22.5, fromFt: 8, toFt: 68 },
  { fromDeg: 22.5, toDeg: 45, fromFt: 8, toFt: 62 },
];
const BASE_OUTFIELD_SECTORS = [
  { fromDeg: -45, toDeg: -15, fromFt: 90, toFt: 160 },
  { fromDeg: -15, toDeg: 15, fromFt: 90, toFt: 180 },
  { fromDeg: 15, toDeg: 45, fromFt: 90, toFt: 160 },
];

function shiftSector(s, shiftDeg) {
  return {
    fromDeg: Math.max(-45, Math.min(45, s.fromDeg + shiftDeg)),
    toDeg: Math.max(-45, Math.min(45, s.toDeg + shiftDeg)),
    fromFt: s.fromFt,
    toFt: s.toFt,
  };
}

/** The out-zone geometry for one league, optionally rotated toward a batter's own spray tendency
 *  (doc §9, [Locked]: "some teams shift their out zones toward where you tend to hit" -
 *  `SHIFTERS_ADJUST_OUT_ZONES` in settings.js; `shiftDeg` is `game.js`'s own call, clamped to
 *  `SHIFT_MAX_DEG`). `fieldScale` moves the sector's near edge with the field's own size;
 *  `outZoneMult` scales its coverage DEPTH on top of that - a better-fielded league's out zones
 *  reach further past their own near edge, never simply "the whole field is bigger". */
export function zonesFor(league, shiftDeg = 0) {
  const f = FIELD[league] || FIELD.majors;
  const scale = (s) => {
    const fromFt = s.fromFt * f.fieldScale;
    const depth = (s.toFt - s.fromFt) * f.outZoneMult;
    return { fromDeg: s.fromDeg, toDeg: s.toDeg, fromFt, toFt: fromFt + depth };
  };
  const infield = BASE_INFIELD_SECTORS.map((s) => shiftSector(scale(s), shiftDeg));
  const outfield = BASE_OUTFIELD_SECTORS.map((s) => shiftSector(scale(s), shiftDeg));
  return { infield, outfield };
}

/** The sector a spray angle falls in. Clamps to the nearest edge sector rather than failing open,
 *  because a spray angle sitting exactly on the foul line (+/-45) can round outside every
 *  sector's own bounds after a shift. */
export function angleSector(deg, sectors) {
  for (const s of sectors) {
    if (deg >= s.fromDeg && deg <= s.toDeg) return s;
  }
  return deg < 0 ? sectors[0] : sectors[sectors.length - 1];
}

export default { zonesFor, angleSector };
