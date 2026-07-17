// game.js - Mancala (Kalah) rules engine. Pure logic, no DOM.
//
// Board layout (14 pits, counterclockwise sow order):
//   0..5   player 1 pits (P1 sows 0 -> 5 -> own store)
//   6      player 1 store (mancala)
//   7..12  player 2 pits
//   13     player 2 store (mancala)
// Sowing drops one stone per pit going i+1 mod 14, always skipping the
// opponent's store.
//
// Rules (per the reference how-to-play):
//   1. Each side has six pits (4 stones each) and a mancala.
//   2. A turn empties one of your pits and sows counterclockwise.
//   3. Last stone in your own mancala: you move again.
//   4. Last stone in an empty pit on YOUR side: you capture that stone plus
//      everything in the opposite pit.
//   5. The game ends when all six pits on one side are empty; the other side
//      sweeps its remaining stones into its own mancala.
//   6. Most stones in your mancala wins.

export const P1 = 0;
export const P2 = 1;
export const P1_STORE = 6;
export const P2_STORE = 13;
export const PITS_PER_SIDE = 6;
export const START_STONES = 4;

/** Pit indexes owned by a player, in sow order. */
export function pitsOf(player) {
  const base = player === P1 ? 0 : 7;
  return [base, base + 1, base + 2, base + 3, base + 4, base + 5];
}

export function storeOf(player) { return player === P1 ? P1_STORE : P2_STORE; }

/** The pit directly across the board (0<->12, 1<->11, ... 5<->7). */
export function oppositeOf(pit) { return 12 - pit; }

export function isStore(pit) { return pit === P1_STORE || pit === P2_STORE; }

/** Which player owns a pit or store. */
export function ownerOf(pit) { return pit <= P1_STORE ? P1 : P2; }

export function newGame(starter = P1) {
  const pits = new Array(14).fill(START_STONES);
  pits[P1_STORE] = 0;
  pits[P2_STORE] = 0;
  return { pits, turn: starter, over: false, winner: null };
}

/** Pits the current player may sow from (own, non-empty). */
export function legalMoves(state) {
  return pitsOf(state.turn).filter((p) => state.pits[p] > 0);
}

function sideEmpty(pits, player) {
  return pitsOf(player).every((p) => pits[p] === 0);
}

/**
 * Apply one move. Returns { state, events } where `events` describes exactly
 * what happened, for the UI to animate:
 *   path      pit index each sown stone landed in, in drop order
 *   extraTurn last stone landed in the mover's store
 *   capture   { pit, opposite, store, count } or null
 *   sweep     { player, pits: [idx...], store, count } or null (end-of-game)
 *   over, winner (P1 | P2 | null for a tie, only meaningful when over)
 */
export function applyMove(state, pit) {
  const me = state.turn;
  const myStore = storeOf(me);
  const skip = storeOf(me === P1 ? P2 : P1);
  const pits = state.pits.slice();
  let hand = pits[pit];
  if (state.over || ownerOf(pit) !== me || isStore(pit) || hand === 0) return null;

  pits[pit] = 0;
  const path = [];
  let at = pit;
  while (hand > 0) {
    at = (at + 1) % 14;
    if (at === skip) continue;
    pits[at] += 1;
    path.push(at);
    hand -= 1;
  }

  const last = path[path.length - 1];
  const extraTurn = last === myStore;

  // Capture: last stone into an empty pit on the mover's side.
  let capture = null;
  if (!extraTurn && !isStore(last) && ownerOf(last) === me && pits[last] === 1) {
    const opp = oppositeOf(last);
    const count = pits[last] + pits[opp];
    capture = { pit: last, opposite: opp, store: myStore, count };
    pits[myStore] += count;
    pits[last] = 0;
    pits[opp] = 0;
  }

  // End of game: one side has no stones left; the other sweeps its remainder.
  let sweep = null;
  let over = false;
  let winner = null;
  if (sideEmpty(pits, P1) || sideEmpty(pits, P2)) {
    over = true;
    const rest = sideEmpty(pits, P1) ? P2 : P1;
    const restPits = pitsOf(rest).filter((p) => pits[p] > 0);
    const count = restPits.reduce((n, p) => n + pits[p], 0);
    if (count > 0) {
      sweep = { player: rest, pits: restPits, store: storeOf(rest), count };
      pits[storeOf(rest)] += count;
      for (const p of restPits) pits[p] = 0;
    }
    winner = pits[P1_STORE] > pits[P2_STORE] ? P1
      : pits[P2_STORE] > pits[P1_STORE] ? P2 : null;
  }

  const next = {
    pits,
    turn: over ? me : (extraTurn ? me : (me === P1 ? P2 : P1)),
    over,
    winner,
  };
  return { state: next, events: { path, extraTurn: extraTurn && !over, capture, sweep, over, winner } };
}

export default {
  P1, P2, P1_STORE, P2_STORE, PITS_PER_SIDE, START_STONES,
  pitsOf, storeOf, oppositeOf, isStore, ownerOf,
  newGame, legalMoves, applyMove,
};
