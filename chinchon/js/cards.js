// cards.js — card faces rendered from an image deck (default: "baraja-libre").
//
// The traditional Spanish deck ships as WebP card faces, rasterized from an open
// CC BY-SA 3.0 vector set (see decks/baraja-libre/CREDITS.md). Rendering goes
// through a small deck registry so additional decks can be added later and
// offered in a picker without touching the game logic.
//
// Exports:
//   renderCardFace(card, opts) -> card <div> HTML
//   preloadDeck()              -> warm the image cache (no flash on first render)
//   listDecks() / getDeck() / setDeck(id)

// Anita ships a custom back + every numbered pip (ranks 1–9, all four suits); the
// figure cards (10–12) fall back to baraja-libre until custom art is added per suit.
const ANITA_OWN = new Set(['back']);
for (const s of ['oros', 'copas', 'espadas', 'bastos']) for (let r = 1; r <= 9; r++) ANITA_OWN.add(`${s}-${r}`);
// All 12 illustrated court cards (every suit, ranks 10-12) — Anita is now a full deck.
for (const s of ['oros', 'copas', 'espadas', 'bastos']) for (const r of [10, 11, 12]) ANITA_OWN.add(`${s}-${r}`);

const DECKS = {
  'baraja-libre': {
    id: 'baraja-libre',
    name: 'Española',
    ext: 'webp',
    hasJoker: false, // deck has no joker face; we render a styled fallback
    credit: 'Baraja Española · CC BY-SA 3.0',
  },
  'anita': {
    id: 'anita',
    name: 'Anita',
    ext: 'webp',
    hasJoker: false, // no joker face; styled fallback
    base: 'baraja-libre', // fall back here for any face this deck doesn't ship…
    own: ANITA_OWN,       // …except the custom pips (all suits, 1–9) + the custom back
    credit: 'Anita — Española deck with a custom Oros coin',
  },
};
const DEFAULT_DECK = 'anita';
let currentDeck = DEFAULT_DECK;

export function listDecks() { return Object.values(DECKS); }
export function getDeck() { return DECKS[currentDeck]; }
export function setDeck(id) { if (DECKS[id]) currentDeck = id; return DECKS[currentDeck]; }

// Asset base, resolved relative to this module so it works standalone and in-hub.
function base(id) { return new URL(`../decks/${id}/`, import.meta.url).href; }

// A deck may ship only some faces (its `own` set) and delegate the rest to a `base`
// deck. Given a face name ('oros-1', 'back', …), return the deck that holds the file.
// Plain decks (no base/own) resolve to themselves, so behaviour is unchanged.
function ownerDeck(deck, faceName) {
  if (deck.own && deck.own.has(faceName)) return deck;
  if (deck.base) return DECKS[deck.base];
  return deck;
}

/** Resolved URL for one face of a specific deck (for previews in the picker). */
export function deckAssetUrl(id, name) {
  const d = DECKS[id]; if (!d) return '';
  const owner = ownerDeck(d, name);
  return `${base(owner.id)}${name}.${owner.ext}`;
}

const SUIT_LABEL = { oros: 'Oros', copas: 'Copas', espadas: 'Espadas', bastos: 'Bastos' };
function cardLabel(card) {
  if (card.isJoker) return 'Comodín';
  const r = card.rank === 1 ? 'As' : card.rank === 10 ? 'Sota'
    : card.rank === 11 ? 'Caballo' : card.rank === 12 ? 'Rey' : card.rank;
  return `${r} de ${SUIT_LABEL[card.suit]}`;
}

/** Warm the browser cache for every face so cards render without a flash. */
export function preloadDeck() {
  const deck = DECKS[currentDeck];
  const names = ['back'];
  for (const s of ['oros', 'copas', 'espadas', 'bastos'])
    for (let r = 1; r <= 12; r++) names.push(`${s}-${r}`);
  for (const n of names) {
    const owner = ownerDeck(deck, n);
    const img = new Image(); img.src = `${base(owner.id)}${n}.${owner.ext}`;
  }
}

function faceSrc(card, deck) {
  const name = `${card.suit}-${card.rank}`;
  const owner = ownerDeck(deck, name);
  return `${base(owner.id)}${name}.${owner.ext}`;
}
function backSrc(deck) {
  const owner = ownerDeck(deck, 'back');
  return `${base(owner.id)}back.${owner.ext}`;
}

/**
 * Full card face HTML.
 * opts: { selected, melded, dead, faceDown, static, mini, meldColor, draggable }
 */
export function renderCardFace(card, opts = {}) {
  const deck = DECKS[currentDeck];
  if (opts.faceDown) {
    return `<div class="cc-card cc-back${opts.mini ? ' cc-mini' : ''}">` +
      `<img class="cc-card-img" src="${backSrc(deck)}" alt="" draggable="false"></div>`;
  }
  const cls = ['cc-card'];
  cls.push(card.isJoker ? 'cc-joker' : 'cc-suit-' + card.suit);
  if (opts.selected) cls.push('is-selected');
  if (opts.melded) cls.push('is-melded');
  if (opts.dead) cls.push('is-dead');
  if (opts.mini) cls.push('cc-mini');
  if (opts.meldColor != null) cls.push('cc-meld-c' + (opts.meldColor % 6));
  const act = opts.static ? '' : ` data-action="card" data-id="${card.id}"`;
  const drag = opts.draggable ? ` data-drag="${card.id}"` : '';
  const inner = card.isJoker
    ? '<span class="cc-joker-face"><span class="cc-joker-star">★</span><span class="cc-joker-txt">COMODÍN</span></span>'
    : `<img class="cc-card-img" src="${faceSrc(card, deck)}" alt="${cardLabel(card)}" draggable="false">`;
  return `<div class="${cls.join(' ')}"${act}${drag}>${inner}</div>`;
}
