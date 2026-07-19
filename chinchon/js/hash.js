// hash.js : canonical state hash for multiplayer lockstep verification.
// Mirrors escoba/js/hash.js exactly (same FNV-1a construction), adapted to
// Chinchón's richer per-player state and its ORDER-SIGNIFICANT discard pile.
//
// Two engines fed the same preset deck and the same sequence of turn
// decisions must reach byte-identical logical state. This hashes a
// fixed-key-order snapshot of that state so a receiving device can confirm
// it applied a turn the same way the sender did.
//
// Cosmetic-order fields (hands, melds -- their on-screen order is a
// rendering choice, not game state) are sorted before hashing so harmless
// ordering drift never false-positives a desync. Stock and discard are NOT
// sorted: stock is dealt from in order and the discard pile's top/order is
// real, visible state (discardTop() reads its last element), so both matter.

function sortIds(cards) { return (cards || []).map((c) => c.id).sort(); }

/** A locked-melds partition (array of card-id arrays) is itself a set of
 *  melds with no meaningful order between or within them once locked; sort
 *  both levels so cosmetic grouping order never affects the hash. */
function sortMelds(melds) {
  if (!melds) return null;
  return melds
    .map((m) => (Array.isArray(m) ? m.map((c) => (c && c.id != null ? c.id : c)).sort() : m))
    .sort((a, b) => (a.join(',') > b.join(',') ? 1 : a.join(',') < b.join(',') ? -1 : 0));
}

function canonicalState(game) {
  return {
    round: game.round,
    nextTurn: game._nextTurn,
    stock: game.stock.map((c) => c.id),
    discard: game.discard.map((c) => c.id),
    resetsUsed: game.resetsUsed,
    dealerIndex: game.dealerIndex,
    whoClosed: game.whoClosed,
    closeType: game.closeType,
    lockedMelds: sortMelds(game.lockedMelds),
    players: game.players.map((p) => ({
      hand: sortIds(p.hand),
      placed: sortIds(p.placed),
      roundScore: p.roundScore,
      totalScore: p.totalScore,
      scoreHistory: p.scoreHistory,
    })),
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
