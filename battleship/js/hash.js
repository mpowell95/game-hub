// hash.js - canonical state hash for multiplayer lockstep verification. FNV-1a, same
// construction as every other game's (tic-tac-toe/js/hash.js, dots-boxes/js/hash.js).
//
// HASHES PUBLIC STATE ONLY: both shot grids (cells + sunkIds), both shot counts, turn, over and
// winner. IT MUST NEVER INCLUDE EITHER FLEET (HANDOFF-BATTLESHIP.md section 7.4). This is not a
// shortcut - it is the whole point of the protocol. Each device holds ONE real fleet and one
// `null` (the opponent's, unknown by construction in multiplayer), so a fleet-inclusive hash
// would diverge on the very first byte on every single match: one side's `fleets[1]` is real data,
// the other's is `null`, and they can never agree. If a later session "fixes" this by hashing
// `state.fleets`, every real-room match will fail its very first hash check.
//
// Nothing here is sorted: `cells` is positional (index i IS cell i), and `sunkIds` is append-order
// (both devices append sunk ships in the same order, since they process the same answer stream).

function canonicalShots(s) {
  return { size: s.size, cells: s.cells, sunkIds: s.sunkIds };
}

function canonicalState(state) {
  return {
    size: state.size,
    bonusShotOnHit: !!state.bonusShotOnHit,
    turn: state.turn,
    shots: [canonicalShots(state.shots[0]), canonicalShots(state.shots[1])],
    shotCount: [state.shotCount[0] | 0, state.shotCount[1] | 0],
    over: !!state.over,
    winner: state.winner == null ? null : state.winner,
  };
}

/** FNV-1a 32-bit hash of the canonical (public-only) serialization, as an 8-hex-char string. */
export function stateHash(state) {
  const s = JSON.stringify(canonicalState(state));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default { stateHash };
