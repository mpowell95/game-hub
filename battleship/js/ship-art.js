// ship-art.js — inline SVG silhouettes for each ship class (HANDOFF-BATTLESHIP-POLISH.md section
// 3). No DOM, pure markup builders. Drawn horizontally, bow to the right, viewBox
// "0 0 {len*10} 10"; vertical placement rotates the WRAPPER element 90deg — these are never
// redrawn for orientation. Two-tone (hull fill var(--bs-ship), lighter deck-detail fill
// var(--bs-ship-deck)) so dark mode / the colorblind palette both apply for free, same as every
// other color in this game. Reused in three places: placement drag chips, fleet roster
// silhouettes, and the board itself (ui.js).

// A real hull silhouette, not a rounded pill: a SHARP triangular bow (the taper starts well back
// from the tip, at 78% of the length, so the point actually reads as a bow rather than a slightly
// clipped corner), a flat transom stern, and a visible dark outline (`.bs-ship-hull` carries a
// stroke now) so the shape reads as a boat even against a similarly-hued board. A full-length
// waterline stripe (`bs-ship-waterline`) breaks up what used to be a single flat color block.
function hull(len) {
  const w = len * 10;
  const bow = w * 0.78;
  // The rounded stern is a half circle INSIDE the box (x 0.4 to 3.8). It used to be drawn from x 0.4
  // with a radius too small for the gap, which SVG silently enlarges: the stern bulged ~3 units out
  // of the left of the box, so every ship hung a third of a square past its first square (Matt,
  // 2026-10-27: placing ships "is weird").
  return `<path d="M3.8,1.6 H${bow.toFixed(1)} L${(w - 0.4).toFixed(1)},5 L${bow.toFixed(1)},8.4 H3.8 `
    + `A3.4,3.4 0 0 1 3.8,1.6 Z" class="bs-ship-hull"/>`
    + `<path d="M1,6.6 H${(bow - 0.6).toFixed(1)} L${(w - 1.1).toFixed(1)},5 L${(bow - 0.6).toFixed(1)},6.6" `
    + `class="bs-ship-waterline"/>`;
}

// `fill` (the ships ON a board) stretches the art to its squares exactly. Left to keep its aspect
// ratio it drew a little short of them and centred, so a ship never quite sat on its own squares.
function svgWrap(len, fill, inner) {
  return `<svg viewBox="0 0 ${len * 10} 10" class="bs-ship-svg"${fill ? ' preserveAspectRatio="none"' : ''} aria-hidden="true" focusable="false">${inner}</svg>`;
}

// Carrier(5): long flat deck, a wide island block set off-center, a runway stripe. No turrets.
function carrier(len, fill) {
  const w = len * 10;
  return svgWrap(len, fill, `
    ${hull(len)}
    <rect x="${(w * 0.58).toFixed(1)}" y="0.9" width="${(w * 0.15).toFixed(1)}" height="3.4" rx="0.6" class="bs-ship-deck"/>
    <rect x="${(w * 0.6).toFixed(1)}" y="1.5" width="${(w * 0.05).toFixed(1)}" height="1.2" class="bs-ship-hull"/>
    <line x1="2.5" y1="5" x2="${(w * 0.5).toFixed(1)}" y2="5" class="bs-ship-line" stroke-dasharray="1.4 1"/>
  `);
}

// Battleship(4): heavy hull, two turret clusters (fore larger, aft smaller), a bridge tower.
function battleship(len, fill) {
  const w = len * 10;
  return svgWrap(len, fill, `
    ${hull(len)}
    <circle cx="${(w * 0.66).toFixed(1)}" cy="5" r="1.7" class="bs-ship-turret"/>
    <circle cx="${(w * 0.66).toFixed(1)}" cy="5" r="0.7" class="bs-ship-hull"/>
    <circle cx="${(w * 0.22).toFixed(1)}" cy="5" r="1.4" class="bs-ship-turret"/>
    <rect x="${(w * 0.4).toFixed(1)}" y="2.8" width="1.8" height="4.4" rx="0.4" class="bs-ship-deck"/>
    <rect x="${(w * 0.52).toFixed(1)}" y="2" width="1.3" height="2" class="bs-ship-deck"/>
  `);
}

// Cruiser(3): slimmer hull, a single turret fore and aft, one small bridge.
function cruiser(len, fill) {
  const w = len * 10;
  return svgWrap(len, fill, `
    ${hull(len)}
    <circle cx="${(w * 0.68).toFixed(1)}" cy="5" r="1.3" class="bs-ship-turret"/>
    <circle cx="${(w * 0.22).toFixed(1)}" cy="5" r="1.1" class="bs-ship-turret"/>
    <rect x="${(w * 0.42).toFixed(1)}" y="3.2" width="1.4" height="3.6" rx="0.3" class="bs-ship-deck"/>
  `);
}

// Submarine(3): rounded low-profile hull, a conning tower. Deliberately NO turrets, the one
// silhouette cue that must never be confused with the surface combatants.
function submarine(len, fill) {
  const w = len * 10;
  return svgWrap(len, fill, `
    <ellipse cx="${(w / 2).toFixed(1)}" cy="5" rx="${(w / 2 - 0.8).toFixed(1)}" ry="2.3" class="bs-ship-hull"/>
    <path d="M1.6,5 H${(w - 1.6).toFixed(1)}" class="bs-ship-waterline"/>
    <rect x="${(w * 0.44).toFixed(1)}" y="1.7" width="1.8" height="2.6" rx="0.6" class="bs-ship-deck"/>
  `);
}

// Destroyer(2): small, sharp bow, single funnel. Shortest silhouette in the fleet.
function destroyer(len, fill) {
  const w = len * 10;
  return svgWrap(len, fill, `
    ${hull(len)}
    <rect x="${(w * 0.34).toFixed(1)}" y="2.6" width="1.8" height="3.6" rx="0.4" class="bs-ship-deck"/>
  `);
}

export const SHIP_ART = { carrier, battleship, cruiser, submarine, destroyer };

export function shipArtHtml(shipId, len, { fill = false } = {}) {
  const fn = SHIP_ART[shipId];
  return fn ? fn(len, fill) : '';
}

export default { SHIP_ART, shipArtHtml };
