// ship-art.js — inline SVG silhouettes for each ship class (HANDOFF-BATTLESHIP-POLISH.md section
// 3). No DOM, pure markup builders. Drawn horizontally, bow to the right, viewBox
// "0 0 {len*10} 10"; vertical placement rotates the WRAPPER element 90deg — these are never
// redrawn for orientation. Two-tone (hull fill var(--bs-ship), lighter deck-detail fill
// var(--bs-ship-deck)) so dark mode / the colorblind palette both apply for free, same as every
// other color in this game. Reused in three places: placement drag chips, fleet roster
// silhouettes, and the board itself (ui.js).

function hull(len) {
  const w = len * 10;
  return `<path d="M0.6,2 H${(w - 3.2).toFixed(1)} L${(w - 0.6).toFixed(1)},5 L${(w - 3.2).toFixed(1)},8 H0.6 A1.6,1.6 0 0 1 0.6,2 Z" class="bs-ship-hull"/>`;
}

function svgWrap(len, inner) {
  return `<svg viewBox="0 0 ${len * 10} 10" class="bs-ship-svg" aria-hidden="true" focusable="false">${inner}</svg>`;
}

// Carrier(5): long flat deck, an offset island block, deck-line markings. No turrets.
function carrier(len) {
  const w = len * 10;
  return svgWrap(len, `
    ${hull(len)}
    <rect x="${(w * 0.16).toFixed(1)}" y="1" width="${(w * 0.18).toFixed(1)}" height="2.6" rx="0.5" class="bs-ship-deck"/>
    <line x1="2.5" y1="5.4" x2="${(w - 5).toFixed(1)}" y2="5.4" class="bs-ship-line"/>
    <line x1="2.5" y1="6.8" x2="${(w - 5).toFixed(1)}" y2="6.8" class="bs-ship-line"/>
  `);
}

// Battleship(4): heavy hull, two turret clusters, a bridge tower, a funnel.
function battleship(len) {
  const w = len * 10;
  return svgWrap(len, `
    ${hull(len)}
    <circle cx="${(w * 0.26).toFixed(1)}" cy="5" r="1.5" class="bs-ship-turret"/>
    <circle cx="${(w * 0.72).toFixed(1)}" cy="5" r="1.3" class="bs-ship-turret"/>
    <rect x="${(w * 0.44).toFixed(1)}" y="3.3" width="1.6" height="3.4" rx="0.3" class="bs-ship-deck"/>
    <rect x="${(w * 0.58).toFixed(1)}" y="2.6" width="1.2" height="1.8" class="bs-ship-deck"/>
  `);
}

// Cruiser(3): slimmer hull, a single turret fore and aft, one small bridge.
function cruiser(len) {
  const w = len * 10;
  return svgWrap(len, `
    ${hull(len)}
    <circle cx="${(w * 0.28).toFixed(1)}" cy="5" r="1.2" class="bs-ship-turret"/>
    <circle cx="${(w * 0.78).toFixed(1)}" cy="5" r="1" class="bs-ship-turret"/>
    <rect x="${(w * 0.48).toFixed(1)}" y="3.5" width="1.2" height="3" rx="0.3" class="bs-ship-deck"/>
  `);
}

// Submarine(3): rounded low-profile hull, a conning tower. Deliberately NO turrets — the one
// silhouette cue that must never be confused with the surface combatants.
function submarine(len) {
  const w = len * 10;
  return svgWrap(len, `
    <ellipse cx="${(w / 2).toFixed(1)}" cy="5" rx="${(w / 2 - 0.8).toFixed(1)}" ry="2.3" class="bs-ship-hull"/>
    <rect x="${(w * 0.46).toFixed(1)}" y="1.9" width="1.6" height="2.4" rx="0.5" class="bs-ship-deck"/>
  `);
}

// Destroyer(2): small, sharp bow, single funnel. Shortest silhouette in the fleet.
function destroyer(len) {
  const w = len * 10;
  return svgWrap(len, `
    ${hull(len)}
    <rect x="${(w * 0.38).toFixed(1)}" y="2.6" width="1.6" height="3.2" rx="0.4" class="bs-ship-deck"/>
  `);
}

export const SHIP_ART = { carrier, battleship, cruiser, submarine, destroyer };

export function shipArtHtml(shipId, len) {
  const fn = SHIP_ART[shipId];
  return fn ? fn(len) : '';
}

export default { SHIP_ART, shipArtHtml };
