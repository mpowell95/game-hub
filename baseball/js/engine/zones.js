// zones.js : out-zone geometry (doc §10, [Locked]: "No fielders drawn. Out zones sit where
// fielders would stand" - 4 infield ground-out zones, 3 outfield fly-out zones). Pure - no
// randomness, no state - replaces phase 1's invented `_defenseLevel01()` league-ordered ramp with
// real geometry, scaled per league by `settings.FIELD[league].outZoneMult`/`fieldScale` (still
// Draft, Open item 7: the doc locks that zones exist and grow per league, not their exact sizes).
//
// Coordinates: sprayAngleDeg is degrees off dead center (negative = left field, positive = right),
// matching outcomes.js's existing foul-line convention (`FOUL_LINE_DEG`, doc §15's units note -
// fair territory spans the full -45..+45). Distances are feet from home plate, `carryFt`'s units.

import { FIELD, GAP_DEG } from './settings.js';

// One geometry, invented (Open item 7), shared by every league before per-league scaling: four
// infield sectors roughly 3B/SS/2B/1B, three outfield sectors LF/CF/RF. `toFt - fromFt` is the
// sector's COVERAGE DEPTH, which is what `outZoneMult` scales - the near edge (`fromFt`) scales
// with `fieldScale` (the field's own size) instead, so the two multipliers scale two different
// things rather than compounding onto one number (compounding both onto `toFt` directly, tried
// first, put a majors outfielder's reach past that league's own fence).
//
// BB-2b commit 3: each sector list is now laid out with a `GAP_DEG`-wide dead zone between
// adjacent sectors (doc §10, [Locked]: "Singles go through gaps and as bloopers") - phase 2/2a's
// sectors tiled the full -45..45 span edge to edge, so a batted ball always landed inside exactly
// one sector (or was clamped to the nearest one at the foul lines) and nothing could ever actually
// be "in a gap." `angleSector` below now returns `null` for an angle that falls in one of these
// gaps rather than clamping to it; `outcomes.js` reads a `null` sector as "no fielder is
// positioned here at all" - a grounder through an infield gap is always a single, and a fly/line
// through an outfield gap is a hit whose bases come from depth alone (the same "how far it
// carried" rule that already decided doubles/triples once a ball got past a MANNED sector's own
// reach). The angular WIDTH each sector keeps shrinks to make room for the gaps; each sector's own
// depth (`fromFt`/`toFt`) is unchanged from before this phase.
const SECTOR_SPAN_DEG = 90; // -45..45, the full fair-territory arc

/** Lay out `depths.length` sectors evenly across `SECTOR_SPAN_DEG`, each `gapDeg` degrees apart,
 *  keeping every entry's own `{fromFt, toFt}` depth. */
function layoutSectors(depths, gapDeg) {
  const n = depths.length;
  const totalGap = gapDeg * (n - 1);
  const width = (SECTOR_SPAN_DEG - totalGap) / n;
  const sectors = [];
  let cursor = -45;
  for (let i = 0; i < n; i++) {
    sectors.push({ fromDeg: cursor, toDeg: cursor + width, fromFt: depths[i].fromFt, toFt: depths[i].toFt });
    cursor += width + gapDeg;
  }
  return sectors;
}

const INFIELD_DEPTHS = [
  { fromFt: 8, toFt: 62 },
  { fromFt: 8, toFt: 68 },
  { fromFt: 8, toFt: 68 },
  { fromFt: 8, toFt: 62 },
];
const OUTFIELD_DEPTHS = [
  { fromFt: 90, toFt: 160 },
  { fromFt: 90, toFt: 180 },
  { fromFt: 90, toFt: 160 },
];

const BASE_INFIELD_SECTORS = layoutSectors(INFIELD_DEPTHS, GAP_DEG);
const BASE_OUTFIELD_SECTORS = layoutSectors(OUTFIELD_DEPTHS, GAP_DEG);

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

/** The sector a spray angle falls in, or `null` if it lands in one of the `GAP_DEG` dead zones
 *  BETWEEN two sectors (BB-2b commit 3 - see the header above). Still clamps to the nearest edge
 *  sector past the outermost bound, because a spray angle sitting exactly on (or just past) the
 *  foul line (+/-45) can round outside every sector's own bounds after a shift - that is an edge
 *  case of the shift, not a genuine gap. */
export function angleSector(deg, sectors) {
  for (const s of sectors) {
    if (deg >= s.fromDeg && deg <= s.toDeg) return s;
  }
  if (deg < sectors[0].fromDeg) return sectors[0];
  if (deg > sectors[sectors.length - 1].toDeg) return sectors[sectors.length - 1];
  return null; // inside a genuine gap between two sectors
}

export default { zonesFor, angleSector };
