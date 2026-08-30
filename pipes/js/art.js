// pipes/js/art.js - how a pipe is drawn. Pure: takes a mask, returns SVG. No DOM, no state.
//
// REDRAWN 2026-08-30 FROM THE REFERENCE SCREENSHOTS Matt pushed into pipes/ (IMG_4594 to IMG_4604,
// a real Pipes app). The differences from the first version were not details:
//
//   - NO TILE BOXES, NO GRID, NO GAPS. The reference draws pipes on one flat dark field, running
//     edge to edge, so a joined run reads as ONE CONTINUOUS PIPE instead of a row of decorated
//     squares. That is why the board now has no per-cell background, no per-cell rounding and no
//     gap at all. It was the single biggest thing making ours look like a spreadsheet.
//   - A DRY PIPE IS HOLLOW - a thin outline with the background showing through - and a WET one is
//     solid. Drawn with two strokes: a wide one in the outline colour, then a narrower one in the
//     BACKGROUND colour on top, which leaves a wall a few pixels thick. It joins correctly across
//     neighbouring cells because both halves meet exactly on the shared edge.
//   - ELBOWS ARE CURVES, not two straight arms meeting at a corner. A quadratic through the centre
//     is what gives the reference its plumbed look; `stroke-linejoin: round` on a right angle does
//     not come close.
//   - AN END IS A BULB - a real circle on a stem - not a dot on a stub. The source bulb has a dark
//     centre when wet, which is straight off the reference.
//
// Everything is drawn in a 100x100 box, so a cell can be any size.
import { N, E, S, W, popcount } from './generator.js';

export const ARM = 27;      // pipe outer width
const WALL = 5.5;           // outline thickness; the inner stroke is ARM - 2*WALL

/** The centreline path(s) for a mask. */
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
    if (has(N) && has(E)) return ['M50 0 Q50 50 100 50'];
    if (has(E) && has(S)) return ['M100 50 Q50 50 50 100'];
    if (has(S) && has(W)) return ['M50 100 Q50 50 0 50'];
    return ['M0 50 Q50 50 50 0'];
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
  return popcount(mask) === 1 ? ARM * 0.78 : 0;
}

/**
 * @param {number} mask
 * @param {string} cls   class for the <svg>
 * @param {'dry'|'wet'} mode
 */
export function pipeSVG(mask, cls, mode) {
  const open = `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">`;
  if (!popcount(mask)) return open + '</svg>';

  const paths = pipePaths(mask);
  const r = bulbRadius(mask);
  const stroke = (w, color) => paths.map((d) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}"`
    + ' stroke-linecap="round" stroke-linejoin="round"/>').join('');

  if (mode === 'wet') {
    return open
      + stroke(ARM, 'var(--pi-water)')
      + (r ? `<circle cx="50" cy="50" r="${r}" fill="var(--pi-water)"/>`
        + `<circle cx="50" cy="50" r="${(r * 0.26).toFixed(2)}" fill="var(--pi-bg)"/>` : '')
      + '</svg>';
  }
  // Dry: the wide outline, then the background punched back out of the middle.
  return open
    + stroke(ARM, 'var(--pi-pipe)')
    + (r ? `<circle cx="50" cy="50" r="${r}" fill="var(--pi-pipe)"/>` : '')
    + stroke(ARM - WALL * 2, 'var(--pi-bg)')
    + (r ? `<circle cx="50" cy="50" r="${(r - WALL).toFixed(2)}" fill="var(--pi-bg)"/>` : '')
    + '</svg>';
}

export default { pipeSVG, pipePaths, bulbRadius, ARM };
