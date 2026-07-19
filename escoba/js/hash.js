// hash.js : canonical state hash for multiplayer lockstep verification.
//
// Two engines fed the same preset deck and the same sequence of moves must
// reach byte-identical logical state. This hashes a fixed-key-order snapshot
// of that state (FNV-1a 32-bit over its JSON serialization) so a receiving
// device can confirm it applied a move the same way the sender did.
//
// Cosmetic-order fields (hand/captured/table -- their on-screen order is a
// rendering choice, not game state) are sorted before hashing so harmless
// ordering drift never false-positives a desync. Stock order is NOT sorted:
// it is dealt from in order, so it is real state.

function sortIds(cards) { return cards.map((c) => c.id).sort(); }

function canonicalState(game) {
  return {
    round: game.round,
    table: sortIds(game.table),
    stock: game.stock.map((c) => c.id),
    players: game.players.map((p) => ({
      hand: sortIds(p.hand),
      captured: sortIds(p.captured),
      escobas: p.escobas,
      totalScore: p.totalScore,
      roundScore: p.roundScore,
    })),
    lastCapturer: game.lastCapturer,
    nextTurn: game._nextTurn,
  };
}

/** FNV-1a 32-bit hash of the canonical serialization, as an 8-hex-char string. */
export function stateHash(game) {
  const s = JSON.stringify(canonicalState(game));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default { stateHash };
