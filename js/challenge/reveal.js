// reveal.js - the celebration overlay a game shows on a qualifying challenge win.
// Displays the earned code big, dramatic, and copyable. It does NOT redeem the code;
// Ana enters it by hand in the Challenge Area (per the approved design). Used by the
// in-hub ES-module games (Connect Four, Chinchon); the single-file games (Business
// Deal, Parchis) inline a compact equivalent since they cannot import modules.

import { ensureChallengeCss } from './unlock.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Show the code-earned overlay. Returns a force-close function. */
export function showCodeReveal(code, taskLabel) {
  ensureChallengeCss();
  const prev = document.querySelector('.ch-reveal');
  if (prev) prev.remove();

  const el = document.createElement('div');
  el.className = 'ch-reveal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'You earned a code');
  el.innerHTML = `
    <div class="ch-unlock-scrim"></div>
    <div class="ch-unlock-card ch-reveal-card">
      <p class="ch-reveal-label">Your code</p>
      <div class="ch-reveal-code" data-role="code">${esc(code)}</div>
      <div class="ch-reveal-actions">
        <button type="button" class="ch-btn ch-btn-go" data-role="copy">Copy</button>
        <button type="button" class="ch-btn ch-btn-ghost" data-role="close">Close</button>
      </div>
      <p class="ch-reveal-msg" data-role="msg" role="status" aria-live="polite"></p>
    </div>`;

  const close = () => el.remove();
  el.querySelector('[data-role="close"]').addEventListener('click', close);
  el.querySelector('.ch-unlock-scrim').addEventListener('click', close);
  el.querySelector('[data-role="copy"]').addEventListener('click', async () => {
    const msg = el.querySelector('[data-role="msg"]');
    try { await navigator.clipboard.writeText(code); msg.textContent = 'Copied.'; }
    catch { msg.textContent = code; }
  });

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  return close;
}

/** Show a taunt (used on each Connect Four rigged loss). Returns a force-close fn. */
export function showTaunt(message) {
  ensureChallengeCss();
  const prev = document.querySelector('.ch-reveal'); if (prev) prev.remove();

  const el = document.createElement('div');
  el.className = 'ch-reveal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Game result');
  el.innerHTML = `
    <div class="ch-unlock-scrim"></div>
    <div class="ch-unlock-card ch-reveal-card">
      <p class="ch-reveal-taunt">${esc(message)}</p>
      <div class="ch-reveal-actions">
        <button type="button" class="ch-btn ch-btn-go" data-role="close">Try Again?</button>
      </div>
    </div>`;

  const close = () => el.remove();
  el.querySelector('[data-role="close"]').addEventListener('click', close);
  el.querySelector('.ch-unlock-scrim').addEventListener('click', close);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  return close;
}

export default { showCodeReveal, showTaunt };
