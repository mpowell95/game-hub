// hash.js : canonical state hash for multiplayer lockstep verification.
// Mirrors chinchon/js/hash.js, escoba/js/hash.js and tic-tac-toe/js/hash.js exactly (same
// FNV-1a construction), adapted to Mancala's flat 14-pit board.
//
// Two engines fed the same sequence of moves must reach byte-identical logical state. This
// hashes a fixed-key-order snapshot of that state so a receiving device can confirm it applied
// a move the same way the sender did.
//
// `pits` is POSITIONAL (pits[i] IS pit i, per game.js's board layout comment), never sorted --
// sorting would destroy the very information the hash exists to compare, same reasoning as
// tic-tac-toe/js/hash.js's board array.

/** Fixed-key-order canonical form. Key order is the serialization, so never reorder these
 *  literals -- two devices building the object differently would hash differently while
 *  holding identical state. */
function canonicalState(s) {
  return {
    pits: s.pits,
    turn: s.turn,
    over: !!s.over,
    winner: s.winner == null ? null : s.winner,
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
