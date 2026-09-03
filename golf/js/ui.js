// golf/js/ui.js - the module contract, and a placeholder screen while the game is rebuilt.
//
// STAGE A of the rewrite (golf-reference-spec.md §16 Phase 1). The 3D stack this file used to
// drive - three.js + cannon-es, render/camera/terrain/minimap/physics/flight/meters/game/clubs,
// and the Harbor Links course - is deleted. The 2D top-down game replaces it in Stage B.
//
// This file exists in this shape so that nothing in the repo carries a broken import for the
// length of the rewrite: js/hub.js still names it as golf's `module:`, and the hub's mount path
// still needs init/destroy/isInProgress to exist and behave. The tile itself is already hidden
// from everyone but a dev profile (adminConfig/v1/games/golf.live = false, set 2026-09-03), so
// in practice only Matt can reach this screen.
//
// Keep the three exports and the .gf-root class when the real game lands - the hub, the CSS and
// test-game-conventions.mjs all key off them.

import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);

function ensureCSS() {
  const href = new URL('../css/golf.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

class GolfGame {
  constructor(container) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'gf-root';
    this.rootEl.innerHTML = `
      <div class="gf-rebuild">
        <h1 class="gf-rebuild__title">${t('title')}</h1>
        <p class="gf-rebuild__body">${t('rebuilding')}</p>
      </div>`;
    this.container.appendChild(this.rootEl);
  }

  destroy() {
    // No listeners, no timers, no animation frame: there is nothing to unwind yet. When the real
    // game lands this must tear down every listener it added (module contract, and the reason
    // test-game-conventions.mjs counts add/remove pairs).
    this.container.innerHTML = '';
    this.rootEl = null;
  }

  // A placeholder holds no round, so leaving is always lossless. Stage C makes this report a
  // part-played round so the hub warns before unmounting (spec §19.B).
  isInProgress() { return false; }
}

let instance = null;

export function init(container) {
  ensureCSS();
  if (instance) instance.destroy();
  instance = new GolfGame(container);
}
export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}
export function isInProgress() {
  return instance ? instance.isInProgress() : false;
}
export default { init, destroy, isInProgress };
