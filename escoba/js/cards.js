// cards.js : Escoba card faces, rendered from the custom Anita deck that ships
// with Chinchon (chinchon/decks/anita/). Escoba uses that deck exclusively, so
// there is no deck registry or picker here; the assets are shared with (and
// precached by) the Chinchon module.

import { cardLabel } from './deck.js';

// Asset base resolved relative to this module so it works standalone and in-hub.
const BASE = new URL('../../chinchon/decks/anita/', import.meta.url).href;

export function faceUrl(card) { return `${BASE}${card.suit}-${card.rank}.webp`; }
export function backUrl() { return `${BASE}back.webp`; }

/** Warm the browser cache for every face (both numbering modes) so cards render
 *  without a flash. */
export function preloadDeck() {
  const urls = [backUrl()];
  for (const s of ['oros', 'copas', 'espadas', 'bastos'])
    for (let r = 1; r <= 12; r++) urls.push(`${BASE}${s}-${r}.webp`);
  for (const u of urls) { const img = new Image(); img.src = u; }
}

/**
 * One card face as HTML.
 * opts: { faceDown, selected, hinted, mini, static, value }
 *   - static: no data-action (not tappable)
 *   - value:  show the capture-value pip (used on table + hand cards)
 */
export function renderCardFace(card, opts = {}) {
  if (opts.faceDown) {
    return `<div class="eb-card eb-back${opts.mini ? ' eb-mini' : ''}">` +
      `<img class="eb-card-img" src="${backUrl()}" alt="" draggable="false"></div>`;
  }
  const cls = ['eb-card'];
  if (opts.selected) cls.push('is-selected');
  if (opts.hinted) cls.push('is-hinted');
  if (opts.mini) cls.push('eb-mini');
  const act = opts.static ? '' : ` data-action="card" data-id="${card.id}"`;
  const pip = opts.value ? `<span class="eb-card-val" aria-hidden="true">${card.value}</span>` : '';
  return `<div class="${cls.join(' ')}"${act}>` +
    `<img class="eb-card-img" src="${faceUrl(card)}" alt="${cardLabel(card)}" draggable="false">${pip}</div>`;
}

export default { renderCardFace, preloadDeck, faceUrl, backUrl };
