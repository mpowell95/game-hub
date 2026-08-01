// dominoes/js/tutorial.js — the eight-page How to Play carousel (addendum §B/§C).
//
// Every illustration is the REAL game rendered small, not a drawing: the same `tileHTML` the
// board uses, positioned by the same `layoutChain` geometry, on a frame whose three background
// colours are swapped to the tutorial palette (cyan header for the bot side, peach felt, a flat
// red band for your side, so the art itself teaches which end is yours). That is why there are
// no eight images to keep in step with the game — change a tile or the layout and the tutorial
// follows for free.

import { TILES, placeOn } from './game.js';
import { layoutChain } from './board.js';
import { tileHTML } from './tiles.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const PAGE_COUNT = 8;

// The illustration frame, in px. Small and fixed: the board scales into it exactly the way it
// scales into the real felt.
const ILLO_W = 244, ILLO_H = 176;
const BOARD_TOP = 34, BOARD_H = 96;         // the felt strip between the two hand rows
const UNIT = 6.4;                            // px per board unit (see board.js)

const idOf = (a, b) => TILES.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Build a chain from [a, b, side] triples, using the engine's own placement so the art can
 *  never show a board the rules would reject. */
function chainOf(moves) {
  const c = { line: [], up: [], down: [], spinnerId: null, originId: null };
  for (const [a, b, side] of moves) placeOn(c, idOf(a, b), side || 'right');
  return c;
}

// The four boards the eight pages draw between them.
const BOARD_SPINNER = () => chainOf([[6, 6], [6, 2, 'right']]);
const BOARD_TWO_ENDS = () => chainOf([[6, 6], [6, 2, 'right'], [6, 3, 'left']]);
const BOARD_FIVE = () => chainOf([[0, 0], [0, 1, 'right'], [1, 5, 'right']]);
const BOARD_LONG = () => chainOf([
  [6, 6], [6, 4, 'right'], [4, 2, 'right'], [2, 0, 'right'], [0, 3, 'right'],
  [3, 5, 'right'], [5, 1, 'right'], [1, 4, 'right'],
  [6, 5, 'left'], [5, 2, 'left'], [2, 1, 'left'], [1, 3, 'left'],
]);

/** The chain, laid out and scaled into the illustration's felt strip. Returns positioned tiles
 *  plus the transform, so badges and rings can be placed in the same space. */
function miniBoard(chain, opts = {}) {
  const { tiles, ends, bbox } = layoutChain(chain);
  if (!tiles.length) return { html: '', ends: [], fit: null };
  const s = Math.min(1, (ILLO_W - 18) / (bbox.w * UNIT), (BOARD_H - 8) / (bbox.h * UNIT));
  const tx = ILLO_W / 2 - (bbox.x + bbox.w / 2) * UNIT * s;
  const ty = BOARD_H / 2 - (bbox.y + bbox.h / 2) * UNIT * s;
  const parts = tiles.map((tl) => tileHTML(tl.values, {
    vertical: tl.vertical,
    cls: 'dm-mini-tile',
    style: `left:${tx + tl.x * UNIT * s}px;top:${ty + tl.y * UNIT * s}px;`
      + `width:${tl.w * UNIT * s}px;height:${tl.h * UNIT * s}px`,
  }));
  // End badges, in the same screen space, so a ring can be drawn straight onto one.
  const placed = ends.map((e) => ({ ...e, px: tx + e.x * UNIT * s, py: ty + e.y * UNIT * s }));
  for (const e of placed) {
    if (opts.badges === false) continue;
    const green = opts.scoring ? 'is-scoring' : '';
    parts.push(`<span class="dm-mini-end ${green}" style="left:${e.px}px;top:${e.py}px">${e.value}</span>`);
  }
  // Amber teaching rings, drawn around whichever ends the caption is talking about.
  for (const side of opts.ringEnds || []) {
    const e = placed.find((x) => x.side === side);
    if (e) parts.push(`<span class="dm-ring is-round" style="left:${e.px}px;top:${e.py}px"></span>`);
  }
  // `at(a, b)` gives a tile's rect in the frame's own screen space, so a page can hang the
  // pointing hand off the exact tile its caption is about instead of a guessed coordinate.
  const at = (a, b) => {
    const id = idOf(a, b);
    const tl = tiles.find((x) => x.id === id);
    return tl ? { x: tx + tl.x * UNIT * s, y: ty + tl.y * UNIT * s, w: tl.w * UNIT * s, h: tl.h * UNIT * s } : null;
  };
  return { html: parts.join(''), ends: placed, at, fit: { tx, ty, s } };
}

/** A hand row of face-up tiles; `bright` is the index left undimmed (all of them if omitted),
 *  `ring` the index that gets the amber teaching ring. */
function handRow(list, opts = {}) {
  const cells = list.map((v, i) => {
    const dim = opts.bright != null && i !== opts.bright ? ' is-dead' : '';
    const ring = i === opts.ring ? '<span class="dm-ring is-tile"></span>' : '';
    return `<span class="dm-mini-slot">${tileHTML(v, { vertical: true, cls: 'dm-mini-hand' + dim })}${ring}</span>`;
  }).join('');
  return `<div class="dm-mini-hand-row">${cells}</div>`;
}

function backRow(n) {
  return `<div class="dm-mini-bot-row">${Array.from({ length: n }, () =>
    tileHTML(null, { vertical: true, back: true, cls: 'dm-mini-back' })).join('')}</div>`;
}

/** The cartoon pointing hand. `faded` draws it in the washed red the addendum describes for the
 *  "this tap does nothing" page. */
function pointerHTML(x, y, faded) {
  return `<span class="dm-point ${faded ? 'is-faded' : ''}" style="left:${x}px;top:${y}px">
    <svg viewBox="0 0 44 56" aria-hidden="true">
      <path d="M17 8 a4.5 4.5 0 0 1 9 0 v20 l4-3 a5 5 0 0 1 7 4 l-2 14 a10 10 0 0 1-10 9 h-8
               a10 10 0 0 1-8-4 l-6-9 a4.5 4.5 0 0 1 6-6 l3 3 V13 a4.5 4.5 0 0 1 5-5 z"
            fill="currentColor" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
    </svg></span>`;
}

/** A mini scoreboard in the cyan header band. */
function miniScores(you, bot) {
  return `<div class="dm-mini-head">
    <span class="dm-mini-s you">${you}</span><span class="dm-mini-goal">300</span><span class="dm-mini-s bot">${bot}</span>
  </div>`;
}

/** A mini Game Finished card, for page 8. */
function finishedHTML(t) {
  return `<div class="dm-mini-modal">
    <span class="dm-mini-crown">${CROWN_SVG}</span>
    <b>${esc(t('game_over'))}</b>
    <span class="dm-mini-row"><i class="dm-mini-medal is-1">1</i>${esc(t('you'))}<em>304</em></span>
    <span class="dm-mini-row"><i class="dm-mini-medal is-2">2</i>${esc(t('bot'))}<em>60</em></span>
  </div>`;
}

export const CROWN_SVG = `<svg viewBox="0 0 44 30" aria-hidden="true">
  <path d="M4 26 L2 6 l12 9 L22 2 l8 13 L42 6 l-2 20 z" fill="#F2C33C" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

const SEVEN = [[6, 6], [5, 3], [4, 1], [3, 3], [2, 6], [1, 0], [0, 4]];

/** One illustration frame. `n` is the 1-based page number. */
function illoHTML(n, t) {
  const head = (y, b) => miniScores(y, b);
  const frame = (inner, opts = {}) => `<div class="dm-illo" aria-hidden="true">
    ${opts.head || head(0, 0)}
    <div class="dm-illo-felt">${inner}</div>
    <div class="dm-illo-floor"></div>
  </div>`;

  if (n === 1) {
    return frame(backRow(7) + '<div class="dm-illo-board"></div>' + handRow(SEVEN));
  }
  if (n === 2) {
    return frame(backRow(7) + '<div class="dm-illo-board"></div>' + handRow(SEVEN, { ring: 0 }));
  }
  if (n === 3) {
    const b = miniBoard(BOARD_SPINNER(), { badges: false });
    const tile = b.at(6, 2);                     // the one played off the spinner's side
    return frame(backRow(6)
      + `<div class="dm-illo-board">${b.html}${pointerHTML(tile.x + tile.w - 6, tile.y + tile.h - 4)}</div>`
      + handRow(SEVEN.slice(1), { bright: 3 }));
  }
  if (n === 4) {
    const b = miniBoard(BOARD_TWO_ENDS(), { ringEnds: ['left', 'right'] });
    return frame(backRow(5)
      + `<div class="dm-illo-board">${b.html}${pointerHTML(198, 62, true)}</div>`
      + handRow(SEVEN.slice(2), { bright: -1 }));
  }
  if (n === 5 || n === 7) {
    const b = miniBoard(BOARD_LONG(), { badges: false });
    return frame(backRow(n === 5 ? 1 : 2)
      + `<div class="dm-illo-board">${b.html}</div>`
      + handRow(SEVEN.slice(0, 1)), { head: head(295, 60) });
  }
  if (n === 6) {
    const b = miniBoard(BOARD_FIVE(), { scoring: true });
    const tile = b.at(1, 5);                     // the tile that just scored the five
    return frame(backRow(4)
      + `<div class="dm-illo-board">${b.html}${pointerHTML(tile.x + tile.w - 8, tile.y + tile.h - 4)}</div>`
      + handRow(SEVEN.slice(3), { bright: 0 }));
  }
  return frame(`<div class="dm-illo-board">${finishedHTML(t)}</div>`, { head: head(304, 60) });
}

const ICON_FIRST = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 L11 12 L19 19"/><path d="M6 5 V19"/></svg>';
const ICON_LAST = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5 L13 12 L5 19"/><path d="M18 5 V19"/></svg>';

/**
 * Open the tutorial over `host`. Returns a teardown function.
 * @param {HTMLElement} host   the element the overlay is appended to
 * @param {(k:string, p?:object) => string} t   the game's translator
 */
export function openTutorial(host, t) {
  let page = 1;

  const overlay = document.createElement('div');
  overlay.className = 'dm-overlay dm-tut-overlay';
  overlay.innerHTML = `
    <div class="dm-scrim" data-action="close-card"></div>
    <div class="dm-tut" role="dialog" aria-modal="true" aria-label="${esc(t('howto'))}">
      <button type="button" class="dm-x" data-action="close-card" aria-label="${esc(t('aria_close'))}">&times;</button>
      <h3 class="dm-tut-title">${esc(t('howto'))}</h3>
      <div class="dm-tut-white">
        <div class="dm-tut-illo" data-role="illo"></div>
        <p class="dm-tut-cap" data-role="cap"></p>
      </div>
      <div class="dm-dots" data-role="dots" role="tablist" aria-label="${esc(t('aria_tut_pages'))}"></div>
      <div class="dm-tut-actions">
        <button type="button" class="dm-btn is-purple is-icon" data-role="first" data-action="tut-first" aria-label="${esc(t('aria_tut_first'))}">${ICON_FIRST}</button>
        <button type="button" class="dm-btn is-purple" data-action="close-card">${esc(t('tut_ok'))}</button>
        <button type="button" class="dm-btn is-purple is-icon" data-role="last" data-action="tut-last" aria-label="${esc(t('aria_tut_last'))}">${ICON_LAST}</button>
      </div>
    </div>`;
  host.appendChild(overlay);

  const el = {
    illo: overlay.querySelector('[data-role="illo"]'),
    cap: overlay.querySelector('[data-role="cap"]'),
    dots: overlay.querySelector('[data-role="dots"]'),
    first: overlay.querySelector('[data-role="first"]'),
    last: overlay.querySelector('[data-role="last"]'),
    card: overlay.querySelector('.dm-tut'),
  };

  function render() {
    el.illo.innerHTML = illoHTML(page, t);
    el.cap.textContent = t('tut_' + page);
    el.dots.innerHTML = Array.from({ length: PAGE_COUNT }, (_, i) =>
      `<button type="button" class="dm-dot ${i + 1 === page ? 'is-on' : ''}" data-action="tut-go" data-n="${i + 1}"
        role="tab" aria-selected="${i + 1 === page}" aria-label="${esc(t('aria_tut_page', { n: i + 1 }))}"></button>`).join('');
    el.first.disabled = page === 1;
    el.last.disabled = page === PAGE_COUNT;
  }

  const go = (n) => { page = Math.min(PAGE_COUNT, Math.max(1, n)); render(); };

  // Swipe, per the addendum's "8-page swipeable carousel". Tracked on the card rather than the
  // illustration so the whole white block is the swipe surface.
  let x0 = null, y0 = null;
  const onDown = (e) => { x0 = e.clientX; y0 = e.clientY; };
  const onUp = (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(page + (dx < 0 ? 1 : -1));
  };
  // Keyboard, because the two side buttons jump to the FIRST and LAST page (per the addendum),
  // which leaves nothing to page one step at a time on a device with no touchscreen.
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { go(page + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(page - 1); e.preventDefault(); }
  };
  const onClick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !overlay.contains(btn)) return;
    if (btn.dataset.action === 'tut-first') go(1);
    else if (btn.dataset.action === 'tut-last') go(PAGE_COUNT);
    else if (btn.dataset.action === 'tut-go') go(Number(btn.dataset.n));
  };

  el.card.addEventListener('pointerdown', onDown);
  el.card.addEventListener('pointerup', onUp);
  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  render();

  return function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
}

export default { openTutorial, PAGE_COUNT };
