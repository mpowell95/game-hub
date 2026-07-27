// hash.js : canonical state hash for multiplayer lockstep verification.
// Mirrors chinchon/js/hash.js, escoba/js/hash.js, tic-tac-toe/js/hash.js and mancala/js/hash.js
// exactly (same FNV-1a construction), adapted to Dots and Boxes' edge grids.
//
// Two engines fed the same sequence of moves must reach byte-identical logical state. This
// hashes a fixed-key-order snapshot of that state so a receiving device can confirm it applied
// a move the same way the sender did.
//
// hEdges/vEdges/boxes are POSITIONAL (hEdges[r][c] IS that edge), never sorted -- sorting would
// destroy the very information the hash exists to compare, same reasoning as tic-tac-toe/js/
// hash.js's board array and mancala/js/hash.js's pits array. `turn` and `drawnEdges` are
// included because they are exactly where a chain-capture desync would hide: game.js's
// applyMove() only flips `turn` when a move claims nothing, so two engines that captured a
// different number of boxes for the same edge would otherwise look identical on the edge grids
// alone for a move or two before the divergence became visible.

/** Fixed-key-order canonical form. Key order is the serialization, so never reorder these
 *  literals -- two devices building the object differently would hash differently while
 *  holding identical state. */
function canonicalState(s) {
  return {
    rows: s.rows,
    cols: s.cols,
    hEdges: s.hEdges,
    vEdges: s.vEdges,
    boxes: s.boxes,
    turn: s.turn,
    drawnEdges: s.drawnEdges | 0,
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
