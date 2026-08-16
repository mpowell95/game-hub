// mp-code-copy.js - tap-to-copy for the multiplayer room CODE, shared by every
// MP game's lobby. No game has its own lobby module (each hand-rolls one inside
// its ui.js with innerHTML), so this is a tiny drop-in: mark the code element
// `data-role="mp-code"`, call enableCodeCopy(root) once at mount, and call the
// returned cleanup in destroy().
//
// Scope discipline: touches only the DOM element you point it at and its own
// injected <style>. No storage, no network, no globals. Guarded end to end so a
// blocked clipboard (older iOS Safari, insecure context) falls back to the
// execCommand path and, failing that, flashes an honest "couldn't copy".
//
// It never copies the placeholder: a room code is exactly four chars drawn from
// net.js's CODE_CHARS, and the empty-slot placeholder is four U+00B7 middots, so
// a strict CODE_RE test rejects the placeholder (and any transient empty string)
// without needing each game's own -empty class.

import { getLang } from './i18n.js';

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const COPIED = { en: 'Copied!', es: '¡Copiado!' };
const FAILED = { en: "Couldn't copy", es: 'No se pudo copiar' };

let _cssInjected = false;

/** Attach delegated tap/keyboard copy for every [data-role="mp-code"] under
 *  `root`. Returns an unsubscribe to call from the game's destroy(). */
export function enableCodeCopy(root) {
  if (!root) return () => {};
  injectCss();

  const onActivate = (target) => {
    const el = target && target.closest && target.closest('[data-role="mp-code"]');
    if (!el || !root.contains(el)) return;
    const code = (el.textContent || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return;   // placeholder / empty slot: nothing to copy
    doCopy(code).then((ok) => flash(el, ok));
  };

  const onClick = (e) => onActivate(e.target);
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const el = e.target && e.target.closest && e.target.closest('[data-role="mp-code"]');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    onActivate(e.target);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
  };
}

async function doCopy(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  return legacyCopy(text);
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function flash(el, ok) {
  const lang = getLang();
  const msg = (ok ? COPIED : FAILED)[lang] || (ok ? COPIED : FAILED).en;
  let bubble = el.querySelector(':scope > .mp-copied-flash');
  if (!bubble) {
    bubble = document.createElement('span');
    bubble.className = 'mp-copied-flash';
    bubble.setAttribute('aria-hidden', 'true');
    el.appendChild(bubble);
  }
  bubble.textContent = msg;
  bubble.classList.toggle('is-err', !ok);
  // restart the animation even on a rapid second tap
  bubble.classList.remove('is-on');
  void bubble.offsetWidth;
  bubble.classList.add('is-on');
  clearTimeout(bubble._t);
  bubble._t = setTimeout(() => bubble.classList.remove('is-on'), 1200);
}

function injectCss() {
  if (_cssInjected || typeof document === 'undefined') return;
  if (document.getElementById('mp-code-copy-css')) { _cssInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'mp-code-copy-css';
  s.textContent = `
[data-role="mp-code"]{ cursor:pointer; position:relative; -webkit-user-select:all; user-select:all; -webkit-tap-highlight-color:transparent; }
[data-role="mp-code"]:active{ transform:scale(0.97); }
[data-role="mp-code"] .mp-copied-flash{
  position:absolute; left:50%; bottom:100%; transform:translate(-50%,4px);
  margin-bottom:6px; padding:3px 9px; border-radius:8px;
  background:rgba(20,22,26,0.92); color:#fff; font-size:12px; font-weight:600;
  line-height:1.3; white-space:nowrap; letter-spacing:0; pointer-events:none;
  opacity:0; transition:opacity .16s ease, transform .16s ease; z-index:50;
  box-shadow:0 4px 14px rgba(0,0,0,0.25);
}
[data-role="mp-code"] .mp-copied-flash.is-err{ background:rgba(176,58,46,0.95); }
[data-role="mp-code"] .mp-copied-flash.is-on{ opacity:1; transform:translate(-50%,0); }
@media (prefers-reduced-motion: reduce){
  [data-role="mp-code"]:active{ transform:none; }
  [data-role="mp-code"] .mp-copied-flash{ transition:opacity .16s ease; }
  [data-role="mp-code"] .mp-copied-flash.is-on{ transform:translate(-50%,0); }
}`;
  (document.head || document.documentElement).appendChild(s);
  _cssInjected = true;
}

export default { enableCodeCopy };
