// deck.js — Chinchón card model and deck construction.
//
// Pure data only: no DOM, no game state, no module-level mutable singletons.
// A "card" is a plain object with a stable unique `id` so the engine can track
// identity (wildcard assignment, locked melds, place-cards) across moves.
//
//   { id:'o7', suit:'oros', rank:7, value:7, isJoker:false, isWild:false }
//   { id:'jk1', suit:null,  rank:0, value:25, isJoker:true, isWild:true }
//
// `rank` is the Spanish face number: 1–7 (and 8,9 in the extended deck) for pip
// cards, then 10 (Sota), 11 (Caballo), 12 (Rey) for figures. Joker rank = 0.

/** Suit ids, in canonical sort order. */
export const SUITS = ['oros', 'copas', 'espadas', 'bastos'];

/** Display metadata for each suit. `glyph` is a simple, license-free symbol;
 *  `cssVar` is the CSS custom property holding the suit colour (see chinchon.css). */
export const SUIT_META = {
  oros:    { label: 'Oros',    glyph: '●', cssVar: '--cc-suit-oros' },    // gold coin
  copas:   { label: 'Copas',   glyph: '♥', cssVar: '--cc-suit-copas' },   // red cup
  espadas: { label: 'Espadas', glyph: '♠', cssVar: '--cc-suit-espadas' }, // blue sword
  bastos:  { label: 'Bastos',  glyph: '♣', cssVar: '--cc-suit-bastos' },  // green club
};

const SUIT_INITIAL = { oros: 'o', copas: 'c', espadas: 'e', bastos: 'b' };

/**
 * The ordered rank ladder used for RUN adjacency. Adjacency is positional in
 * this list — never `rank - 1`. In the 40-card deck the 7 sits directly next to
 * the 10 (Sota), so 7-10-11 is a valid run; in the 48-card deck the 8 and 9 sit
 * between them, so it is not. There is no wrap-around (12 does not join 1).
 */
export function rankLadder(cfg) {
  return cfg && cfg.extended
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
}

/** Map of rank -> ladder position, derived from {@link rankLadder}. */
export function rankOrderMap(cfg) {
  const map = new Map();
  rankLadder(cfg).forEach((rank, i) => map.set(rank, i));
  return map;
}

/**
 * Point value of a rank for scoring.
 * - Pip cards (1–9): face value.
 * - Figures (10,11,12): flat 10 by default, or their own value when
 *   `cfg.figuresFaceValue` is set.
 * (The Joker's value is fixed at 25 and handled in {@link jokerCard}.)
 */
export function cardValue(rank, cfg) {
  if (rank >= 10) return cfg && cfg.figuresFaceValue ? rank : 10;
  return rank;
}

function makeCard(suit, rank, cfg) {
  return {
    id: SUIT_INITIAL[suit] + rank,
    suit,
    rank,
    value: cardValue(rank, cfg),
    isJoker: false,
    // The Ace of Oros optionally doubles as a wildcard while keeping its natural
    // identity (1 of Oros, value 1) for any meld/score that uses it as itself.
    isWild: !!(cfg && cfg.aceOrosWild) && suit === 'oros' && rank === 1,
  };
}

function jokerCard(n) {
  return { id: 'jk' + n, suit: null, rank: 0, value: 25, isJoker: true, isWild: true };
}

/**
 * Build a fresh, unshuffled deck for the given config.
 * @param {object} cfg - { extended, joker, aceOrosWild, figuresFaceValue }
 * @returns {Array} 40 cards (48 if extended) plus 2 jokers if enabled.
 */
export function makeDeck(cfg) {
  const ranks = rankLadder(cfg);
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of ranks) deck.push(makeCard(suit, rank, cfg));
  }
  if (cfg && cfg.joker) { deck.push(jokerCard(1)); deck.push(jokerCard(2)); }
  return deck;
}

/**
 * Fisher–Yates shuffle, returning a new array. `rng` is injectable so tests can
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

/** Total point value of a set of cards. */
export function handValue(cards) {
  return cards.reduce((sum, c) => sum + c.value, 0);
}
