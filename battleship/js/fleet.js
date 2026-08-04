// fleet.js - pure placement helpers: ship catalogs, legality, auto-place, rotation.
// No DOM. Shared by ui.js (placement screen), ai.js (Pro tier's placement-density search
// re-uses legalPlacements) and test.js.
//
// Ships MAY TOUCH (root CLAUDE.md / HANDOFF-BATTLESHIP.md section 3): no adjacency or diagonal
// restriction. The Pro AI's probability-density model (ai.js) depends on this being true, so a
// "no touching" rule must never be added here.

export const SHIP_SETS = {
  // Total ship cells: 4+3+3+2 = 12
  quick: [
    { id: 'battleship', len: 4 },
    { id: 'cruiser', len: 3 },
    { id: 'submarine', len: 3 },
    { id: 'destroyer', len: 2 },
  ],
  // Total ship cells: 5+4+3+3+2 = 17
  classic: [
    { id: 'carrier', len: 5 },
    { id: 'battleship', len: 4 },
    { id: 'cruiser', len: 3 },
    { id: 'submarine', len: 3 },
    { id: 'destroyer', len: 2 },
  ],
};

export const BOARD_SIZE = { quick: 8, classic: 10 };

export function shipSetFor(size) {
  return SHIP_SETS[size === 'quick' ? 'quick' : 'classic'];
}
export function boardSizeFor(size) {
  return BOARD_SIZE[size === 'quick' ? 'quick' : 'classic'];
}

/** Seeded PRNG (mulberry32), same construction as dominoes/js/game.js's, so auto-place and any
 *  future replay/test stay deterministic given a seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emptyFleet(sizeKey) {
  return { size: boardSizeFor(sizeKey), sizeKey, ships: [] };
}

/** The board cells a ship at (r, c, dir) with length `len` occupies. */
export function shipCells(len, r, c, dir) {
  const cells = [];
  for (let i = 0; i < len; i++) {
    cells.push(dir === 'v' ? [r + i, c] : [r, c + i]);
  }
  return cells;
}

export function inBounds(size, cells) {
  return cells.every(([r, c]) => r >= 0 && r < size && c >= 0 && c < size);
}

/** True if `cells` overlaps any existing ship's own cells (touching is fine; overlap is not).
 *  `excludeId` lets a ship be re-placed against the fleet without colliding with its own prior
 *  position. */
function overlapsAny(ships, cells, excludeId) {
  const set = new Set(cells.map(([r, c]) => `${r},${c}`));
  for (const s of ships) {
    if (excludeId && s.id === excludeId) continue;
    for (const [r, c] of s.cells) if (set.has(`${r},${c}`)) return true;
  }
  return false;
}

/** Place (or re-place) `shipDef` ({id,len}) at (r,c,dir). Returns a NEW fleet, or null if the
 *  placement is illegal (out of bounds or overlapping another ship). Ships may touch. */
export function placeShip(fleet, shipDef, r, c, dir) {
  const cells = shipCells(shipDef.len, r, c, dir);
  if (!inBounds(fleet.size, cells)) return null;
  const others = fleet.ships.filter((s) => s.id !== shipDef.id);
  if (overlapsAny(others, cells)) return null;
  const ship = { id: shipDef.id, len: shipDef.len, r, c, dir, cells, hits: new Array(shipDef.len).fill(false) };
  return { ...fleet, ships: [...others, ship] };
}

export function removeShip(fleet, shipId) {
  return { ...fleet, ships: fleet.ships.filter((s) => s.id !== shipId) };
}

export function isFleetComplete(fleet, shipSet) {
  if (fleet.ships.length !== shipSet.length) return false;
  return shipSet.every((def) => fleet.ships.some((s) => s.id === def.id && s.len === def.len));
}

/** Every legal (r, c, dir) placement of a ship of length `len` on a `size`x`size` board where
 *  `isBlocked(r, c)` is false for every cell. Used by auto-place and the Pro AI's placement
 *  density search (called there over a virtual, opponent-unknown board). */
export function legalPlacements(size, len, isBlocked) {
  const out = [];
  for (const dir of ['h', 'v']) {
    const maxR = dir === 'v' ? size - len : size - 1;
    const maxC = dir === 'h' ? size - len : size - 1;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        const cells = shipCells(len, r, c, dir);
        if (cells.every(([cr, cc]) => !isBlocked(cr, cc))) out.push({ r, c, dir });
      }
    }
  }
  return out;
}

/** A real shuffle, not a fixed layout (root CLAUDE.md item: "Auto-place must be a real shuffle,
 *  not a fixed layout"): places the largest ships first (fewer legal spots left for them later),
 *  each at a uniformly random legal placement given what's already down. `rng` is a 0..1 fn
 *  (pass `mulberry32(seed)()` composed, or Math.random). Always succeeds for the ship sets and
 *  board sizes this game uses (verified over hundreds of seeds in test.js). */
export function autoPlace(sizeKey, shipSet, rng = Math.random) {
  let fleet = emptyFleet(sizeKey);
  const bySize = [...shipSet].sort((a, b) => b.len - a.len);
  for (const def of bySize) {
    const isBlocked = (r, c) => fleet.ships.some((s) => s.cells.some(([sr, sc]) => sr === r && sc === c));
    const spots = legalPlacements(fleet.size, def.len, isBlocked);
    if (!spots.length) return null;   // should not happen for this game's ship sets/sizes
    const pick = spots[Math.floor(rng() * spots.length)];
    const placed = placeShip(fleet, def, pick.r, pick.c, pick.dir);
    if (!placed) return null;
    fleet = placed;
  }
  return fleet;
}

export default {
  SHIP_SETS, BOARD_SIZE, shipSetFor, boardSizeFor, mulberry32, emptyFleet, shipCells,
  inBounds, placeShip, removeShip, isFleetComplete, legalPlacements, autoPlace,
};
