// cards.js — Spanish-deck (baraja española) card faces as inline SVG.
//
// Renders the four real Spanish suits — oros (gold coins), copas (goblets),
// espadas (swords), bastos (wooden batons) — with traditional pip layouts, the
// special As de Oros, and stylized Sota/Caballo/Rey court figures.
//
// The suit shapes are INLINED into each card (no shared <use>/<symbol> sprite):
// a <use href="#sprite"> approach hung Chrome's screenshot rasterizer and is
// fragile across browsers, so each pip embeds its own paths. Cards are cheap
// enough (~7 in hand) that the extra markup is negligible.
//
// Exports: renderCardFace(card, opts) -> full card <div> HTML string.

// Inner markup for each suit symbol, authored in a 0..100 local box.
const SUIT_PATHS = {
  oros:
    '<circle cx="50" cy="50" r="46" fill="#f2c84b"/>' +
    '<circle cx="50" cy="50" r="46" fill="none" stroke="#a9760c" stroke-width="5"/>' +
    '<circle cx="50" cy="50" r="33" fill="none" stroke="#a9760c" stroke-width="3"/>' +
    '<circle cx="50" cy="50" r="8" fill="#a9760c"/>' +
    '<g fill="#a9760c"><circle cx="50" cy="18" r="3.4"/><circle cx="50" cy="82" r="3.4"/><circle cx="18" cy="50" r="3.4"/><circle cx="82" cy="50" r="3.4"/></g>',
  copas:
    '<path d="M27 23 H73 L67 49 Q50 62 33 49 Z" fill="#d22f27" stroke="#8f1c16" stroke-width="2.5"/>' +
    '<ellipse cx="50" cy="23" rx="24" ry="6" fill="#f0c33c" stroke="#8f1c16" stroke-width="1.5"/>' +
    '<rect x="45" y="55" width="10" height="18" fill="#e0a93a"/>' +
    '<ellipse cx="50" cy="54" rx="9" ry="4" fill="#e0a93a"/>' +
    '<path d="M30 86 Q50 76 70 86 L66 91 Q50 84 34 91 Z" fill="#e0a93a" stroke="#9c7a2a" stroke-width="1.5"/>' +
    '<rect x="30" y="87" width="40" height="5" rx="2" fill="#e0a93a"/>',
  espadas:
    '<polygon points="50,5 57,22 50,64 43,22" fill="#c2d4f2" stroke="#3a5a9a" stroke-width="2.5"/>' +
    '<line x1="50" y1="14" x2="50" y2="60" stroke="#7f9fd6" stroke-width="2"/>' +
    '<rect x="29" y="63" width="42" height="8" rx="4" fill="#2f4f8f"/>' +
    '<rect x="45.5" y="69" width="9" height="20" rx="3" fill="#6b4f2a"/>' +
    '<circle cx="50" cy="91" r="6" fill="#caa24a" stroke="#9c7a2a" stroke-width="1.5"/>',
  bastos:
    '<path d="M37 93 Q41 62 49 33 Q53 18 61 8 Q72 14 65 27 Q55 47 51 71 Q48 86 49 93 Z" fill="#3f9a4f" stroke="#256630" stroke-width="2.5"/>' +
    '<g fill="#62bd72"><circle cx="61" cy="13" r="4"/><circle cx="56" cy="32" r="3.6"/><circle cx="51" cy="54" r="3.4"/><circle cx="45" cy="78" r="3.2"/></g>',
};

/** Place a suit symbol centred at (cx,cy), scaled to `size`, optionally rotated. */
function placeSuit(suit, cx, cy, size, rot = 0) {
  const s = (size / 100).toFixed(3);
  return `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s}) translate(-50 -50)">${SUIT_PATHS[suit]}</g>`;
}

// Pip centre positions within a 100×140 face viewBox.
const LAYOUTS = {
  1: { size: 46, pos: [[50, 70]] },
  2: { size: 30, pos: [[50, 44], [50, 96]] },
  3: { size: 27, pos: [[50, 36], [50, 70], [50, 104]] },
  4: { size: 28, pos: [[35, 46], [65, 46], [35, 94], [65, 94]] },
  5: { size: 25, pos: [[35, 42], [65, 42], [50, 70], [35, 98], [65, 98]] },
  6: { size: 24, pos: [[35, 40], [65, 40], [35, 70], [65, 70], [35, 100], [65, 100]] },
  7: { size: 22, pos: [[35, 36], [65, 36], [50, 53], [35, 70], [65, 70], [35, 104], [65, 104]] },
  8: { size: 21, pos: [[35, 34], [65, 34], [35, 60], [65, 60], [35, 86], [65, 86], [35, 112], [65, 112]] },
  9: { size: 21, pos: [[28, 40], [50, 40], [72, 40], [28, 70], [50, 70], [72, 70], [28, 100], [50, 100], [72, 100]] },
};

function asDeOros() {
  return `<circle cx="50" cy="70" r="40" fill="none" stroke="#c8920f" stroke-width="2.5" opacity="0.6"/>` +
    `<circle cx="50" cy="70" r="36" fill="none" stroke="#c8920f" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.6"/>` +
    placeSuit('oros', 50, 70, 58);
}

function pipSVG(card) {
  const { suit, rank } = card;
  if (suit === 'oros' && rank === 1) return asDeOros();
  const L = LAYOUTS[rank] || LAYOUTS[9];
  const cross = suit === 'espadas' || suit === 'bastos';
  return L.pos.map(([x, y]) => {
    const rot = cross ? (x < 50 ? 15 : x > 50 ? -15 : 0) : 0;
    return placeSuit(suit, x, y, L.size, rot);
  }).join('');
}

function crown() {
  return `<g transform="translate(26 52)">
    <path d="M2 40 V8 L14 22 L25 2 L36 22 L48 8 V40 Z" fill="#e9bd3f" stroke="#9c7a2a" stroke-width="2"/>
    <rect x="0" y="40" width="50" height="9" rx="2" fill="#c8920f"/>
    <circle cx="25" cy="6" r="4" fill="#d22f27"/><circle cx="2" cy="10" r="3" fill="#2e8b57"/><circle cx="48" cy="10" r="3" fill="#2e8b57"/>
  </g>`;
}

function horse() {
  return `<g transform="translate(28 48)">
    <path d="M20 2 C12 5 9 13 12 21 L5 27 C3 31 7 33 10 31 L15 28 C12 36 9 42 9 54 L44 54 C46 41 44 29 39 21 C36 12 30 4 20 2 Z"
      fill="#7a5230" stroke="#3f2a18" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="30" cy="20" r="2.4" fill="#fff"/>
    <path d="M16 8 L22 2 L24 9 Z" fill="#7a5230"/>
  </g>`;
}

function page() {
  return `<g transform="translate(0 50)">
    <rect x="69" y="2" width="3" height="48" rx="1.5" fill="#6b4a2e"/>
    <path d="M64 2 q10 3 9 11 q-9 -2 -9 2 Z" fill="#d22f27"/>
    <circle cx="50" cy="8" r="11" fill="#e3c489" stroke="#9c7a2a" stroke-width="1.5"/>
    <path d="M31 54 Q31 24 50 20 Q69 24 69 54 Z" fill="#3a5a9a" stroke="#26406e" stroke-width="1.5"/>
    <path d="M44 54 V30 H56 V54 Z" fill="#5273b8"/>
  </g>`;
}

function courtSVG(card) {
  const { suit, rank } = card;
  const figure = rank === 12 ? crown() : rank === 11 ? horse() : page();
  const label = rank === 12 ? 'REY' : rank === 11 ? 'CABALLO' : 'SOTA';
  return `<rect x="9" y="10" width="82" height="120" rx="9" fill="currentColor" opacity="0.06"/>
    <rect x="9" y="10" width="82" height="120" rx="9" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
    ${placeSuit(suit, 50, 30, 30)}
    ${figure}
    <text x="50" y="126" text-anchor="middle" font-size="10.5" font-weight="700" fill="currentColor" font-family="system-ui, sans-serif" letter-spacing="0.5">${label}</text>`;
}

function jokerSVG() {
  return `<text x="50" y="92" text-anchor="middle" font-size="62" fill="currentColor">★</text>
    <text x="50" y="118" text-anchor="middle" font-size="13" font-weight="800" fill="currentColor" font-family="system-ui, sans-serif">JOKER</text>`;
}

/**
 * Full card face HTML.
 * opts: { selected, melded, dead, faceDown, static, mini, meldColor, draggable }
 */
export function renderCardFace(card, opts = {}) {
  if (opts.faceDown) return '<div class="cc-card cc-back"></div>';
  const cls = ['cc-card'];
  cls.push(card.isJoker ? 'cc-joker' : 'cc-suit-' + card.suit);
  if (opts.selected) cls.push('is-selected');
  if (opts.melded) cls.push('is-melded');
  if (opts.dead) cls.push('is-dead');
  if (opts.mini) cls.push('cc-mini');
  if (opts.meldColor != null) cls.push('cc-meld-c' + (opts.meldColor % 6));
  const act = opts.static ? '' : ` data-action="card" data-id="${card.id}"`;
  const drag = opts.draggable ? ` data-drag="${card.id}"` : '';
  const face = card.isJoker ? jokerSVG() : (card.rank >= 10 ? courtSVG(card) : pipSVG(card));
  const rk = card.isJoker ? '★' : String(card.rank);
  const mini = card.isJoker ? '' : `<svg class="cc-mini-suit" viewBox="0 0 100 100" aria-hidden="true">${SUIT_PATHS[card.suit]}</svg>`;
  return `<div class="${cls.join(' ')}"${act}${drag}>` +
    `<span class="cc-idx cc-tl"><b>${rk}</b>${mini}</span>` +
    `<svg class="cc-face" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${face}</svg>` +
    `<span class="cc-idx cc-br"><b>${rk}</b>${mini}</span>` +
    `</div>`;
}
