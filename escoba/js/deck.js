// deck.js : Escoba card model and deck construction.
//
// Pure data only: no DOM, no game state. A card is a plain object with a stable
// unique `id` so the engine and UI can track identity across moves.
//
//   { id:'o7', suit:'oros', rank:7, value:7 }
//
// `rank` is the Spanish face number: 1-7 for pip cards, then 10 (Sota),
// 11 (Caballo), 12 (Rey). `value` is the capture value used to sum to 15:
// pips count their face, Sota is 8, Caballo is 9, Rey is 10.

/** Suit ids, in canonical order. */
export const SUITS = ['oros', 'copas', 'espadas', 'bastos'];

/** The 40-card deck ranks (no 8s or 9s). */
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export const SUIT_LABEL = { oros: 'Oros', copas: 'Copas', espadas: 'Espadas', bastos: 'Bastos' };

const SUIT_INITIAL = { oros: 'o', copas: 'c', espadas: 'e', bastos: 'b' };

/** Capture value of a rank: pips 1-7 count their face, Sota 8, Caballo 9, Rey 10. */
export function captureValue(rank) {
  return rank >= 10 ? rank - 2 : rank;
}

/** Spanish name of a rank ('As', '5', 'Sota', ...). */
export function rankName(rank) {
  return rank === 1 ? 'As' : rank === 10 ? 'Sota' : rank === 11 ? 'Caballo' : rank === 12 ? 'Rey' : String(rank);
}

/** Full display label, e.g. '7 de Oros'. */
export function cardLabel(card) {
  return `${rankName(card.rank)} de ${SUIT_LABEL[card.suit]}`;
}

function makeCard(suit, rank) {
  return { id: SUIT_INITIAL[suit] + rank, suit, rank, value: captureValue(rank) };
}

/** Build a fresh, unshuffled 40-card deck. */
export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(suit, rank));
  return deck;
}

/**
 * Fisher-Yates shuffle, returning a new array. `rng` is injectable so tests can
 * shuffle deterministically; defaults to Math.random.
 */
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sum of capture values of a set of cards. */
export function sumValues(cards) {
  return cards.reduce((s, c) => s + c.value, 0);
}

/**
 * All subsets of `table` that the played `card` captures (subset sum + card
 * value = 15). Returns an array of card arrays; empty if the card cannot
 * capture. Table size is at most ~14 cards so plain recursion is fine.
 */
export function captureOptions(table, card) {
  const need = 15 - card.value;
  const out = [];
  if (need <= 0) return out;
  const n = table.length;
  const pick = [];
  (function walk(i, sum) {
    if (sum === need) { out.push(pick.slice()); return; }
    if (i >= n || sum > need) return;
    pick.push(table[i]);
    walk(i + 1, sum + table[i].value);
    pick.pop();
    walk(i + 1, sum);
  })(0, 0);
  return out;
}

/** True if the played card has at least one capture on this table. */
export function canCapture(table, card) {
  return captureOptions(table, card).length > 0;
}

export default { SUITS, RANKS, makeDeck, shuffle, sumValues, captureOptions, canCapture, captureValue, cardLabel, rankName };
