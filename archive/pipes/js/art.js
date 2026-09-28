// pipes/js/art.js - how a pipe is drawn. Pure: takes a mask, returns SVG. No DOM, no state.
//
// EVERY NUMBER IN THIS FILE WAS MEASURED OFF THE REFERENCE, NOT CHOSEN (2026-08-31).
//
// The 2026-08-30 pass redrew this "from the reference screenshots" by eye and Matt's answer was
// that it still did not look like them. So this pass decoded IMG_4602.png pixel by pixel and read
// the geometry out of it. The board there is 7x9 on a 155px grid, and every ratio below is that
// measurement divided by 155:
//
//   cell pitch            155 px    ->  100     (the viewBox)
//   pipe outer width       55 px    ->   35.5   ARM
//   wall thickness          3 px    ->    1.94  WALL
//   pipe interior          49 px    ->   31.6   ARM - 2*WALL
//   bulb outer radius      55.5px   ->   35.8   BULB
//   bulb hole radius       15.5px   ->   10.2   BULB_HOLE
//
// Two of those were the visible faults. The old ARM was 27, so every pipe was two thirds the width
// it should be; the old WALL was 5.5, nearly THREE TIMES the reference's, so what should read as a
// hairline outline around a wide channel read as a fat soft double-stroke around a narrow one.
//
// THE ELBOW WAS THE OTHER ONE, AND THE OLD FILE HAD IT EXACTLY BACKWARDS. Its comment said
// "ELBOWS ARE CURVES ... not two straight arms meeting at a corner. stroke-linejoin: round on a
// right angle does not come close." The reference is two straight arms meeting at the cell centre
// with a round linejoin, and nothing else. Measured on a real elbow (cell 3,1 of IMG_4602): the
// INNER wall of the turn is a sharp right angle at exactly (centre - ARM/2, centre - ARM/2), and
// the OUTER wall is an arc of radius ~26px = ARM/2 centred on the cell centre. That pair - sharp
// inside, outer radius exactly half the stroke width - is the signature of a stroke join, and it
// is not something a quadratic produces. The old quadratic swung ~13 units wide of it, which is
// what made our elbows read as lazy S-bends next to the reference's crisp turns.
//
// A DRY PIPE IS HOLLOW AND A WET ONE IS FULL, and both are the same two-stroke construction: a
// wide stroke, then a narrower one punched back out of the middle. Only the two colours change.
// Measured across a wet pipe, the water is the interior width (31.6) and it carries a near-black
// rim exactly where the white wall is on a dry one - so a wet pipe keeps its silhouette instead of
// becoming a bare blue slab, and a wet run lines up with the dry run it continues into. The old
// file drew the water as a naked solid stroke narrower than the pipe around it.
//
// Everything is drawn in a 100x100 box, so a cell can be any size.
import { N, E, S, W, popcount } from './generator.js';

export const ARM = 35.5;       // pipe outer width (55/155 of a cell)
const WALL = 1.94;             // wall thickness (3/155); the inner stroke is ARM - 2*WALL
const BULB = 35.8;             // a cap's outer radius - almost exactly one pipe width across
const BULB_HOLE = 0.3;         // the hole in a WET bulb, as a fraction of the bulb's interior

/**
 * The centreline path(s) for a mask.
 *
 * An elbow is two straight arms meeting at the cell centre. It is drawn as ONE path so the corner
 * is a stroke JOIN - that is what rounds the outside of the turn while leaving the inside square,
 * which is what the reference does. Splitting it into two paths would lose the join and give two
 * butt-ended arms with a notch between them.
 */
export function pipePaths(mask) {
  const has = (d) => (mask & d) !== 0;
  const n = popcount(mask);
  if (n === 0) return [];
  if (n === 1) {
    if (has(N)) return ['M50 0 V50'];
    if (has(E)) return ['M100 50 H50'];
    if (has(S)) return ['M50 100 V50'];
    return ['M0 50 H50'];
  }
  if (n === 2) {
    if (has(N) && has(S)) return ['M50 0 V100'];
    if (has(E) && has(W)) return ['M0 50 H100'];
    if (has(N) && has(E)) return ['M50 0 L50 50 L100 50'];
    if (has(E) && has(S)) return ['M100 50 L50 50 L50 100'];
    if (has(S) && has(W)) return ['M50 100 L50 50 L0 50'];
    return ['M0 50 L50 50 L50 0'];
  }
  if (n === 4) return ['M50 0 V100', 'M0 50 H100'];
  // Tee: the run straight through, plus the branch out to the third side.
  if (!has(N)) return ['M0 50 H100', 'M50 50 V100'];
  if (!has(E)) return ['M50 0 V100', 'M50 50 H0'];
  if (!has(S)) return ['M0 50 H100', 'M50 50 V0'];
  return ['M50 0 V100', 'M50 50 H100'];
}

/** A cap piece ends in a bulb; everything else does not. */
export function bulbRadius(mask) {
  return popcount(mask) === 1 ? BULB : 0;
}

/**
 * @param {number} mask
 * @param {string} cls   class for the <svg>
 * @param {'dry'|'wet'} mode
 * @param {boolean} [isSource]  the inlet, which is the ONLY bulb that gets a hole
 */
export function pipeSVG(mask, cls, mode, isSource) {
  const open = `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">`;
  if (!popcount(mask)) return open + '</svg>';

  const paths = pipePaths(mask);
  const r = bulbRadius(mask);
  // BUTT caps, not round. An arm ends exactly on the cell edge, so a round cap would bulge half a
  // pipe width into the neighbouring cell - which is invisible where two pipes join and a stray
  // nub everywhere they do not. ROUND joins, because the elbow's outer corner is one (see above).
  const stroke = (w, color) => paths.map((d) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}"`
    + ' stroke-linecap="butt" stroke-linejoin="round"/>').join('');

  // The same construction either way: the wall colour wide, then the fill colour punched back out
  // of the middle. Dry fills with the field so the pipe reads as empty; wet fills with water.
  const wall = mode === 'wet' ? 'var(--pi-water-rim)' : 'var(--pi-pipe)';
  const fill = mode === 'wet' ? 'var(--pi-water)' : 'var(--pi-bg)';
  const inner = (r - WALL).toFixed(2);

  return open
    + stroke(ARM, wall)
    + (r ? `<circle cx="50" cy="50" r="${r}" fill="${wall}"/>` : '')
    + stroke(ARM - WALL * 2, fill)
    + (r ? `<circle cx="50" cy="50" r="${inner}" fill="${fill}"/>` : '')
    // THE HOLE MARKS THE SOURCE, AND ONLY THE SOURCE. It is punched in the FIELD colour, so it
    // reads as an opening - water coming in. Every wet bulb used to get one, which on a solved
    // board of the new full-net rule meant four or five "sources"; the reference's own solved level
    // has exactly one holed bulb and the rest solid.
    + (r && mode === 'wet' && isSource
      ? `<circle cx="50" cy="50" r="${(inner * BULB_HOLE).toFixed(2)}" fill="var(--pi-bg)"/>` : '')
    + '</svg>';
}

export default { pipeSVG, pipePaths, bulbRadius, ARM };
