// game.js - Battleship engine: fleet resolution, public shot grids, turn/end decisions.
// Pure, DOM-free (root CLAUDE.md: the game.js/fleet.js/ai.js/hash.js seam is what makes test.js
// possible, and what keeps the AI from being able to cheat by construction - see ai.js).
//
// TWO KINDS OF STATE, deliberately kept separate (this is the whole shape of the multiplayer
// protocol, HANDOFF-BATTLESHIP.md section 5/7):
//   - a FLEET is SECRET: which ships, where, which of their cells have been hit. Only the owning
//     device ever holds the real one; the opponent's fleet is `null` in this device's own state
//     in multiplayer (both are known locally in solo, where one process plays both sides).
//   - a SHOTS grid is PUBLIC: what's been fired at a seat's fleet and the result. Both devices
//     always agree on both shot grids, and hash.js hashes ONLY this half of the state.
//
// There is no draw in Battleship (root CLAUDE.md section 3): the first fleet fully sunk loses,
// and only one seat's fleet can finish being sunk on any single shot. So `winner` is never null
// at game end, unlike every draw-capable game in this repo.

export const CELL_UNKNOWN = 0;
export const CELL_MISS = 1;
export const CELL_HIT = 2;
// A cell whose ship has been CONFIRMED sunk, distinct from a still-active CELL_HIT. This is what
// lets the AI's hunt mode (ai.js) tell "still chasing this hit" apart from "already resolved,
// stop looking here" using nothing but the public shots grid - the same information a human
// player has. Also what lets the UI paint a sunk ship's shape distinctly from a live hit peg.
export const CELL_SUNK = 3;

export function emptyShots(size) {
  return { size, cells: new Array(size * size).fill(CELL_UNKNOWN), sunkIds: [] };
}

function idx(size, r, c) { return r * size + c; }

export function cellAt(shots, r, c) { return shots.cells[idx(shots.size, r, c)]; }

function cloneShots(shots) { return { size: shots.size, cells: shots.cells.slice(), sunkIds: shots.sunkIds.slice() }; }

/** A fresh match, no fleets placed yet. `sizeKey` is 'quick'|'classic'; `size` is its board
 *  dimension (fleet.js's boardSizeFor). `turn` is the seat (0|1) that shoots first. */
export function newGame(size, sizeKey, bonusShotOnHit, turn = 0) {
  return {
    size, sizeKey, bonusShotOnHit: !!bonusShotOnHit,
    turn,
    fleets: [null, null],           // this device's known fleets; the opponent's is null in MP
    shots: [emptyShots(size), emptyShots(size)],   // shots[i] = shots fired AT seat i's fleet
    shotCount: [0, 0],              // shotCount[i] = shots FIRED BY seat i
    over: false,
    winner: null,
  };
}

export function setFleet(state, seat, fleet) {
  const fleets = state.fleets.slice();
  fleets[seat] = fleet;
  return { ...state, fleets };
}

/** Has this cell already been fired at (on the PUBLIC shots[seat] grid)? */
export function isShotLegal(state, seat, r, c) {
  if (state.over) return false;
  if (r < 0 || c < 0 || r >= state.size || c >= state.size) return false;
  return cellAt(state.shots[seat], r, c) === CELL_UNKNOWN;
}

/** The only function that reads a fleet (root CLAUDE.md's engine spec). In multiplayer this runs
 *  ONLY on the device that owns `fleet` (the defender), never on the shooter. Returns the fleet
 *  with the hit ship's `hits` updated, plus the public answer to broadcast/apply.
 *
 *  `cells` (only present when `sunk` is true) is the sunk ship's own cell list, so the shooter's
 *  device can paint the ship's shape on its own copy of the enemy grid. This does not leak new
 *  information: a ship can only be reported sunk once every one of its cells has individually
 *  been hit BY THIS SHOOTER, so every cell in `cells` was already known to the shooter as a hit -
 *  the defender is only telling it which of its own prior hits belong to the same ship. */
export function resolveShot(fleet, r, c) {
  if (!fleet) return { fleet, result: 'miss', shipId: null, sunk: false, fleetSunk: false };
  const ship = fleet.ships.find((s) => s.cells.some(([sr, sc]) => sr === r && sc === c));
  if (!ship) return { fleet, result: 'miss', shipId: null, sunk: false, fleetSunk: false };
  const cellIndex = ship.cells.findIndex(([sr, sc]) => sr === r && sc === c);
  const hits = ship.hits.slice();
  hits[cellIndex] = true;
  const sunk = hits.every(Boolean);
  const newShip = { ...ship, hits };
  const ships = fleet.ships.map((s) => (s.id === ship.id ? newShip : s));
  const newFleet = { ...fleet, ships };
  const fleetSunk = sunk && ships.every((s) => s.hits.every(Boolean));
  return {
    fleet: newFleet, result: 'hit', shipId: ship.id, sunk, fleetSunk,
    cells: sunk ? newShip.cells.slice() : undefined,
  };
}

/** Apply the defender's answer to the shared PUBLIC state. `seat` is the DEFENDER (the fleet that
 *  was shot at) - shots[seat] is the grid updated, and the shooter is the other seat, 1 - seat.
 *
 *  Decides the match end HERE, from the answer, and carries it as a field (`over`/`winner`) on
 *  the returned state - both devices reach "over" through this same function fed the same
 *  answer, never a locally-guessed conclusion (MP invariant 1). Turn flips to the DEFENDER
 *  (whose turn it is to shoot back) unless `bonusShotOnHit` is on and this shot was a hit and the
 *  match isn't over, in which case the same shooter keeps going. */
export function applyAnswer(state, seat, r, c, answer) {
  const shooter = 1 - seat;
  const shots = state.shots.slice();
  const grid = cloneShots(shots[seat]);
  grid.cells[idx(grid.size, r, c)] = answer.result === 'hit' ? CELL_HIT : CELL_MISS;
  if (answer.sunk && answer.shipId) {
    grid.sunkIds = [...grid.sunkIds, answer.shipId];
    // Resolve every cell of the now-sunk ship from CELL_HIT to CELL_SUNK, so hunt-mode AI (and
    // the UI's sunk-ship reveal) can tell a resolved hit apart from one still worth chasing.
    if (Array.isArray(answer.cells)) {
      for (const [sr, sc] of answer.cells) grid.cells[idx(grid.size, sr, sc)] = CELL_SUNK;
    }
  }
  shots[seat] = grid;
  const shotCount = state.shotCount.slice();
  shotCount[shooter] += 1;

  if (answer.fleetSunk) {
    return { ...state, shots, shotCount, over: true, winner: shooter };
  }
  const keepShooting = state.bonusShotOnHit && answer.result === 'hit';
  return { ...state, shots, shotCount, turn: keepShooting ? shooter : seat };
}

/** Fire+resolve+apply in one step for the device that holds BOTH fleets (solo). `seat` is the
 *  DEFENDER. Mutates nothing; returns { state, answer, cells }. */
export function fireAndResolve(state, seat, r, c) {
  const res = resolveShot(state.fleets[seat], r, c);
  const answer = { result: res.result, shipId: res.shipId, sunk: res.sunk, fleetSunk: res.fleetSunk, cells: res.cells };
  const withFleet = setFleet(state, seat, res.fleet);
  const next = applyAnswer(withFleet, seat, r, c, answer);
  return { state: next, answer };
}

/** Ship lengths still afloat on `shots` (a seat's PUBLIC grid), given the ship set that was
 *  placed on it. Used by ai.js - it is the only way the AI learns "what's left", never a fleet. */
export function shipsAfloat(shipSet, shots) {
  const sunk = new Set(shots.sunkIds);
  return shipSet.filter((def) => !sunk.has(def.id)).map((def) => def.len);
}

export default {
  CELL_UNKNOWN, CELL_MISS, CELL_HIT, CELL_SUNK, emptyShots, cellAt, newGame, setFleet, isShotLegal,
  resolveShot, applyAnswer, fireAndResolve, shipsAfloat,
};
