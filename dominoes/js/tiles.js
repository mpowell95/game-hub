// dominoes/js/tiles.js — the domino as markup. PURE and i18n-free (callers pass any aria label
// in), so both the live game (ui.js) and the how-to-play illustrations (tutorial.js) draw the
// SAME tile rather than keeping two versions that drift.
//
// One drawn component plus a pip-position lookup, never 28 images.

/** Pip positions on a 3x3 grid, [col, row]. */
export const PIPS = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const pipsHTML = (n) => (PIPS[n] || []).map(([c, r]) =>
  `<i class="dm-pip" style="left:${22 + c * 28}%;top:${22 + r * 28}%"></i>`).join('');

/**
 * One domino. `values` reads left-to-right (horizontal) or top-to-bottom (vertical).
 * @param {?number[]} values  the two halves, or null when the face is hidden
 * @param {{vertical?:boolean, back?:boolean, blank?:boolean, button?:boolean,
 *          cls?:string, style?:string, attrs?:string, aria?:string}} opts
 *   `back`  the bot's olive face-down tile; `blank` a cream tile with its face hidden (the
 *   boneyard drawer). Both suppress the pips.
 */
export function tileHTML(values, opts = {}) {
  const cls = ['dm-tile'];
  if (opts.vertical) cls.push('is-v');
  if (opts.back) cls.push('is-back');
  if (opts.cls) cls.push(opts.cls);
  const hidden = opts.back || opts.blank;
  const halves = hidden
    ? '<div class="dm-half"></div><div class="dm-half"></div>'
    : `<div class="dm-half">${pipsHTML(values[0])}</div><div class="dm-half">${pipsHTML(values[1])}</div>`;
  const aria = opts.aria ? ` aria-label="${esc(opts.aria)}"` : ' aria-hidden="true"';
  // A tappable tile is a DIV with a button role, never a real <button>. WebKit before Safari
  // 16.4 refuses to let a <button> be a flex container: it wraps the children in an anonymous
  // block, so the two `.dm-half` divs (which carry no intrinsic size) collapsed to zero height
  // and every tile in the hand and the boneyard rendered as an empty shell - no pips, no divider
  // - while board tiles, being plain divs, drew correctly. Reported from a real phone
  // 2026-08-01. ui.js delegates on [data-action], so nothing needed a real button anyway; the
  // role and tabindex keep it a button to assistive tech and the keyboard.
  const role = opts.button ? ' role="button" tabindex="0"' : '';
  return `<div class="${cls.join(' ')}"${role}${opts.attrs || ''}${aria} style="${opts.style || ''}">${halves}</div>`;
}

export default { PIPS, pipsHTML, tileHTML };
