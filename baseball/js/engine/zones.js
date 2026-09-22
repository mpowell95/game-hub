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

// R5 (docs/BASEBALL-3D-BUILD.md section 9, rule 5's "zones.js's depths if the report says why"):
// EVERY NUMBER BELOW IS IN FEET, AND UNTIL R5 ALMOST NOTHING EVER REACHED THEM. `carryFt` returned
// 0 ft for 96% to 99% of balls in play (measured, shipped v865, five leagues), so a batted ball's
// fate was decided by its SPRAY ANGLE alone - whether it happened to land in one of the `GAP_DEG`
// dead zones - and these depths were nearly inert. R5 gives the ball a real exit velocity and a
// real carry (40 to 470 ft), which puts every one of them back in play, and the old numbers are
// wrong by a factor of two to three against real feet:
//
//   - INFIELD toFt 62/68 was "where a grounder is fielded". A grounder now ROLLS 32 to 121 ft
//     (`GROUND_CARRY_FACTOR`), so at 62 ft every solidly hit grounder was through the infield for a
//     single. 115/125 (College: 110/119 ft after `outZoneMult`) is where an infielder actually
//     fields one, and it leaves the hardest grounders getting through: measured, grounders are a
//     hit 32% of the time at College, against ~24% in the real game.
//   - OUTFIELD 90..160/180 was shallower than the median fly ball (248 ft at College). Two
//     consequences, both measured: a 170 ft pop fly landed past the sector and was scored a HIT,
//     and - because `TRIPLE_DEPTH_FRAC` is 0.80 OF THE WALL (264 ft at College's corners), which is
//     BELOW any plausible outfielder's reach - every ball that beat a sector was a TRIPLE. 14.8% of
//     balls in play at College, against about 1% in the real game.
//
// So the outfield out-zone is set to REACH THE WALL at every league (College 378 ft in the corners
// against a 330 to 365 ft fence, 416 ft in the centre against 400). That is the honest reading of
// "out zones sit where fielders would stand": an outfielder gets to anything that stays in the
// park, and what beats him is the fence or a gap, not depth. The consequence, and it is worth
// knowing before changing these: the double/triple depth ladder in `outcomes.js` now only ever
// decides a ball hit into an angular GAP, because nothing else gets past a manned sector.
// `fromFt` 150 (College) is the near edge, so the bloop band (`BLOOP_BAND_FT`, 25 ft) is the 125 to
// 150 ft flare nobody reaches and anything shallower is an infielder's catch.
const INFIELD_DEPTHS = [
  { fromFt: 8, toFt: 115 },
  { fromFt: 8, toFt: 125 },
  { fromFt: 8, toFt: 125 },
  { fromFt: 8, toFt: 115 },
];
const OUTFIELD_DEPTHS = [
  { fromFt: 150, toFt: 390 },
  { fromFt: 150, toFt: 430 },
  { fromFt: 150, toFt: 390 },
];

const BASE_INFIELD_SECTORS = layoutSectors(INFIELD_DEPTHS, GAP_DEG);
const BASE_OUTFIELD_SECTORS = layoutSectors(OUTFIELD_DEPTHS, GAP_DEG);

/** BB-2d commit 6: shift the WHOLE sector list together, then snap only the two OUTERMOST edges
 *  (the first sector's `fromDeg`, the last sector's `toDeg`) exactly to the foul lines - never
 *  clamp each sector independently. Clamping per-sector (the old behavior) could leave an
 *  UNCOVERED SLIVER on the trailing edge: a positive shift pushes every sector right, opening a
 *  gap between -45 and the first sector's new (still-unclamped) position while doing nothing to
 *  compress it, and the leading sector could simultaneously overshoot +45 with no fix on that
 *  side either. Snapping the two true endpoints to +/-45 unconditionally - compressing whichever
 *  end overshot, extending whichever end fell short - keeps the TOTAL covered arc (the sum of
 *  every sector's own width, gaps excluded) IDENTICAL at every shift angle: every internal
 *  GAP_DEG gap between sectors is preserved exactly as laid out, only uniformly translated, and
 *  only the two boundary sectors ever change width. Safe because SHIFT_MAX_DEG is bounded to at
 *  most half of GAP_DEG - the shift can never be large enough to invert sector order or collapse
 *  an internal gap. */
function shiftSectors(sectors, shiftDeg) {
  const shifted = sectors.map((s) => ({ ...s, fromDeg: s.fromDeg + shiftDeg, toDeg: s.toDeg + shiftDeg }));
  if (shifted.length) {
    shifted[0] = { ...shifted[0], fromDeg: -45 };
    shifted[shifted.length - 1] = { ...shifted[shifted.length - 1], toDeg: 45 };
  }
  return shifted;
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
  const infield = shiftSectors(BASE_INFIELD_SECTORS.map(scale), shiftDeg);
  const outfield = shiftSectors(BASE_OUTFIELD_SECTORS.map(scale), shiftDeg);
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
