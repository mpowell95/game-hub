// hash.js : canonical state hash for multiplayer lockstep verification.
// Mirrors chinchon/js/hash.js, escoba/js/hash.js, tic-tac-toe/js/hash.js and
// mancala/js/hash.js exactly (same FNV-1a construction), adapted to Filler's
// flat COLS x ROWS tile grid.
//
// Two engines fed the same sequence of moves must reach byte-identical logical state. This
// hashes a fixed-key-order snapshot of that state so a receiving device can confirm it applied
// a move the same way the sender did.
//
// `colors` and `owner` are POSITIONAL (index i IS tile i, per game.js's board layout comment),
// never sorted -- sorting would destroy the very information the hash exists to compare, same
// reasoning as tic-tac-toe's board array and mancala's pits array. Both are typed arrays
// (Uint8Array) in the live engine state; Array.from() flattens them to plain arrays first, since
// JSON.stringify on a typed array serializes as an object ({"0":.. ,"1":..}), not an array, which
// would silently change the hash's input shape between a fresh game and one rebuilt from a plain
// JSON snapshot (recovery/autosave).

/** Fixed-key-order canonical form. Key order is the serialization, so never reorder these
 *  literals -- two devices building the object differently would hash differently while
 *  holding identical state. */
function canonicalState(s) {
  return {
    colors: Array.from(s.colors),
    owner: Array.from(s.owner),
    turn: s.turn,
    counts: Array.from(s.counts),
    current: Array.from(s.current),
    over: !!s.over,
    winner: s.winner | 0,
  };
}

/** FNV-1a 32-bit hash of the canonical serialization, as an 8-hex-char string. */
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
