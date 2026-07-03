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

const DECKS = {
  'baraja-libre': {
    id: 'baraja-libre',
    name: 'Española',
    ext: 'webp',
    hasJoker: false, // deck has no joker face; we render a styled fallback
    credit: 'Baraja Española · CC BY-SA 3.0',
  },
};
const DEFAULT_DECK = 'baraja-libre';
let currentDeck = DEFAULT_DECK;

export function listDecks() { return Object.values(DECKS); }
export function getDeck() { return DECKS[currentDeck]; }
export function setDeck(id) { if (DECKS[id]) currentDeck = id; return DECKS[currentDeck]; }

// Asset base, resolved relative to this module so it works standalone and in-hub.
function base(id) { return new URL(`../decks/${id}/`, import.meta.url).href; }

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
  const b = base(deck.id);
  const names = ['back'];
  for (const s of ['oros', 'copas', 'espadas', 'bastos'])
    for (let r = 1; r <= 12; r++) names.push(`${s}-${r}`);
  for (const n of names) { const img = new Image(); img.src = `${b}${n}.${deck.ext}`; }
}

function faceSrc(card, deck) { return `${base(deck.id)}${card.suit}-${card.rank}.${deck.ext}`; }
function backSrc(deck) { return `${base(deck.id)}back.${deck.ext}`; }

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
