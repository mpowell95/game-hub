// unlock.js - the full-screen "you have been chosen" announcement. Played once by
// the hub on first activation, and replayable from inside the Challenge Area.
// Maximum drama about minimum stakes. Self-contained; injects challenge.css.

import { loadProfile } from '../profile-store.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Idempotently ensure the challenge stylesheet is on the page. */
export function ensureChallengeCss() {
  const href = new URL('../../css/challenge.css', import.meta.url).href;
  const has = [...document.querySelectorAll('link[rel="stylesheet"]')].some(
    (l) => l.href === href || (l.getAttribute('href') || '').endsWith('css/challenge.css'));
  if (has) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.chStyle = '';
  document.head.appendChild(link);
}

/**
 * Play the unlock announcement. Returns a function that force-closes it.
 * onDone fires when the user accepts (or it is force-closed).
 */
export function playUnlock(onDone) {
  ensureChallengeCss();
  const name = esc((loadProfile() || {}).name || 'Agent');   // runtime, so no literal name in source
  const prev = document.querySelector('.ch-unlock');
  if (prev) prev.remove();

  const el = document.createElement('div');
  el.className = 'ch-unlock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Secret challenge unlocked');
  el.innerHTML = `
    <div class="ch-unlock-scrim"></div>
    <div class="ch-unlock-card">
      <div class="ch-unlock-sparkles" aria-hidden="true">
        <span>✦</span><span>✧</span><span>✦</span><span>✧</span><span>✦</span><span>✧</span>
      </div>
      <p class="ch-unlock-kicker">Top secret transmission</p>
      <h1 class="ch-unlock-title">Operation<br>${name}</h1>
      <p class="ch-unlock-sub">You have been chosen, agent. A mission of the very highest stakes.</p>
      <p class="ch-unlock-fine">(The stakes are not high. The stakes are, in fact, quite low.)</p>
      <button type="button" class="ch-btn ch-btn-go" data-role="accept">Accept the mission</button>
    </div>`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('is-leaving');
    const done = () => { el.remove(); if (typeof onDone === 'function') onDone(); };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 500); // fallback if animationend does not fire
  };
  el.querySelector('[data-role="accept"]').addEventListener('click', close);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  return close;
}

export default { playUnlock, ensureChallengeCss };
