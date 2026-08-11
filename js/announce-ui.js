// announce-ui.js - draws the one-time launcher announcement js/announce.js decided to show.
//
// Built on css/ui.css's `.gh-overlay`/`.gh-modal`, like js/bug-report-ui.js, so it inherits dark
// mode, the focus ring, scroll containment and the reduced-motion pass instead of being this
// repo's fifth hand-rolled modal.
//
// Dismissal is recorded (markSeen) when the popup CLOSES by ANY route - Got it, the X, Escape, or
// the call-to-action. Someone who taps "Try it now" has plainly seen it, and showing them the same
// notice again after they acted on it is its own small bug.

import { markSeen, textFor } from './announce.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('ann-css')) return;
  const style = document.createElement('style');
  style.id = 'ann-css';
  style.textContent = `
  .ann-overlay { z-index: 290; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                 max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  .ann-modal { width: min(420px, 100%); text-align: center; }
  .ann-icon { font-size: 42px; line-height: 1; }
  .ann-modal h2 { margin: var(--gh-sp-3) var(--gh-sp-6) var(--gh-sp-3); font-size: var(--gh-fs-lg); font-weight: 800; }
  .ann-body { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.55; text-align: left; }
  .ann-modal .gh-modal__actions { justify-content: center; }
  `;
  document.head.appendChild(style);
}

/**
 * Show one announcement. `onAction(action)` fires when the player taps its call-to-action (the hub
 * passes a handler that opens the report form for `action: 'bug-report'`). Resolves once closed.
 */
export function showAnnouncement(a, { onAction } = {}) {
  return new Promise((resolve) => {
    if (!a || !a.id) { resolve(); return; }
    ensureCss();
    const lang = getLang();
    const host = document.createElement('div');
    host.className = 'gh-overlay ann-overlay';
    const body = textFor(a.body, lang);
    const paras = (Array.isArray(body) ? body : [body]).filter(Boolean);
    host.innerHTML = `
      <div class="gh-modal ann-modal" role="dialog" aria-modal="true" aria-label="${esc(t('ann_dialog_aria'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
        <div class="ann-icon" aria-hidden="true">${esc(a.icon || '📣')}</div>
        <h2>${esc(textFor(a.title, lang))}</h2>
        ${paras.map((p) => `<p class="ann-body">${esc(p)}</p>`).join('')}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--ghost" data-role="dismiss">${esc(t('ann_dismiss'))}</button>
          ${a.cta ? `<button type="button" class="gh-btn gh-btn--primary" data-role="cta">${esc(textFor(a.cta, lang))}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(host);

    let done = false;
    const finish = (action) => {
      if (done) return;
      done = true;
      markSeen(a.id);
      document.removeEventListener('keydown', onKey);
      host.remove();
      if (action && typeof onAction === 'function') {
        try { onAction(action); } catch (err) { console.error('[announce] action failed', err); }
      }
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', (e) => { if (e.target === host) finish(null); });
    host.querySelector('[data-role="close"]').addEventListener('click', () => finish(null));
    host.querySelector('[data-role="dismiss"]').addEventListener('click', () => finish(null));
    const cta = host.querySelector('[data-role="cta"]');
    if (cta) cta.addEventListener('click', () => finish(a.action || 'cta'));
  });
}

export default { showAnnouncement };
