// hash.js : canonical state hash for multiplayer lockstep verification.
// Mirrors chinchon/js/hash.js and escoba/js/hash.js exactly (same FNV-1a
// construction), adapted to Tic Tac Toe's two variants.
//
// Two engines fed the same sequence of moves must reach byte-identical logical
// state. This hashes a fixed-key-order snapshot of that state so a receiving
// device can confirm it applied a move the same way the sender did.
//
// NOTHING IS SORTED HERE, unlike the card games. Chinchón sorts hands and melds
// because their on-screen order is a rendering choice; every array in a Tic Tac
// Toe state is POSITIONAL (board[i] IS cell i, meta[b] IS small board b), so
// sorting would destroy the very information the hash exists to compare.
//
// Ultimate's derived routing state is deliberately IN the hash: `meta` (which
// small boards are won/DEAD) and `forcedBoard` (which board the opponent is
// sent to) are computed locally by each engine from the same move payload, and
// they are exactly where an Ultimate desync would hide -- the wrong sub-board
// unlocked on the remote side. Hashing them turns that into a detected
// mismatch at the next verify instead of silent divergence.

/** Fixed-key-order canonical form. Key order is the serialization, so never
 *  reorder these literals -- two devices building the object differently would
 *  hash differently while holding identical state. */
function canonicalState(s) {
  if (s.variant === 'ultimate') {
    return {
      variant: 'ultimate',
      boards: s.boards,
      meta: s.meta,
      turn: s.turn,
      forcedBoard: s.forcedBoard == null ? null : s.forcedBoard,
      winner: s.winner || null,
      winLine: s.winLine || null,
      over: !!s.over,
      isDraw: !!s.isDraw,
      moves: s.moves | 0,
      // Normalized to a positional pair: an object's key order is not
      // guaranteed to survive a JSON round-trip through the room document.
      lastMove: s.lastMove ? [s.lastMove.board, s.lastMove.cell] : null,
    };
  }
  return {
    variant: 'classic',
    board: s.board,
    turn: s.turn,
    winner: s.winner || null,
    winLine: s.winLine || null,
    over: !!s.over,
    isDraw: !!s.isDraw,
    moves: s.moves | 0,
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
