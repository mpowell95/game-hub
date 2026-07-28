// hash.js — FNV-1a state hash, same construction as chinchon/js/hash.js and
// tic-tac-toe/js/hash.js. Hashes the SETTLED table (positions rounded to kill
// float noise) plus the rule state that actually diverges turn-to-turn, so an
// MP desync (rules.js and physics.js disagreeing between host/guest) is caught
// the same tick it happens rather than several shots later.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function stateHash(state) {
  const balls = state.balls
    .map((b) => `${b.id}:${b.pocketed ? 1 : 0}:${Math.round(b.x * 2000)}:${Math.round(b.y * 2000)}`)
    .sort()
    .join('|');
  const rest = `${state.turnSeat}:${state.groups[0]}:${state.groups[1]}:${state.openTable ? 1 : 0}:${state.ballInHand ? 1 : 0}:${state.over ? 1 : 0}:${state.winner}`;
  return fnv1a(balls + '#' + rest);
}
