// baseball/js/ui.js - phase 0 placeholder module. No game yet; see baseball/CLAUDE.md.
//
// This exists only so the hub's `devOnly` tile has something real to mount: the module contract
// (docs/BUILDING-A-GAME.md, "The module contract") requires `init`/`destroy`/`isInProgress` from
// day one, so a later session building the real game drops into an already-conforming shell
// rather than retrofitting one. `init` renders one screen through `t()`; nothing else runs.

import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);

let root = null;

export function init(el) {
  root = el;
  root.innerHTML = `
    <div class="bb-root">
      <h1 class="bb-title">${t('placeholder_title')}</h1>
      <p class="bb-body">${t('placeholder_body')}</p>
    </div>`;
}

export function destroy() {
  if (root) root.innerHTML = '';
  root = null;
}

/** No game exists yet, so there is nothing in progress to lose. Phase 4's own decision on what
 *  this means for a real, resumable game belongs here later; see baseball/CLAUDE.md. */
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
