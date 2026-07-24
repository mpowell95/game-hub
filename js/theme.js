// theme.js — the hub-wide light/dark/auto theme layer. Same shape as js/i18n.js
// (storage key + getter/setter + change event) on purpose, so it reads the same way.
//
// Storage key gamehub.theme.v1: 'light' | 'dark' | 'auto', default 'auto' (follow
// prefers-color-scheme, live via a matchMedia listener). setTheme() and this module's
// own load-time side effect stamp `.gh-dark` on <html> whenever the RESOLVED theme is
// dark — that class is the ONE thing every surface's CSS keys off (`:root.gh-dark`
// overrides of each surface's own --xx-* custom properties), so a manual choice always
// wins over the OS preference and 'auto' is resolved once, here, not via a CSS media
// query duplicated in every game's stylesheet (see root CLAUDE.md, "Rules").
//
// A preference, not history: THE LAW's rule-2 carve-out applies, same as js/i18n.js's
// language pref and js/favorites.js.

const KEY = 'gamehub.theme.v1';
export const THEMES = ['light', 'dark', 'auto'];
const EVENT = 'gamehub:theme';

let mql = null;
function media() {
  if (mql !== null) return mql;
  try { mql = window.matchMedia('(prefers-color-scheme: dark)'); } catch { mql = undefined; }
  return mql || null;
}

/** The stored preference: 'light' | 'dark' | 'auto'. Unset or unrecognized reads as 'auto'. */
export function getTheme() {
  try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : 'auto'; }
  catch { return 'auto'; }
}

/** 'light' | 'dark' — 'auto' resolved against the OS preference (defaults light if unknown). */
export function resolvedTheme(theme) {
  const v = theme || getTheme();
  if (v !== 'auto') return v;
  const m = media();
  return (m && m.matches) ? 'dark' : 'light';
}

function applyDom(theme) {
  try { document.documentElement.classList.toggle('gh-dark', resolvedTheme(theme) === 'dark'); }
  catch { /* not in a DOM */ }
}

function announce(theme) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { theme, resolved: resolvedTheme(theme) } })); }
  catch { /* headless */ }
}

/** Persist the theme, restamp the DOM, and notify listeners. Returns the theme actually set. */
export function setTheme(theme) {
  const v = THEMES.includes(theme) ? theme : 'auto';
  try { localStorage.setItem(KEY, v); } catch { /* still usable this session via the event */ }
  applyDom(v);
  announce(v);
  return v;
}

/** Subscribe to theme changes: cb(theme, resolvedTheme). Returns an unsubscribe function
 *  (call it in destroy()). Fires on an explicit setTheme() AND on a live OS-preference
 *  change while the stored mode is 'auto'. */
export function onThemeChange(cb) {
  const h = (e) => {
    try { cb((e.detail && e.detail.theme) || getTheme(), (e.detail && e.detail.resolved) || resolvedTheme()); }
    catch { /* listener's problem */ }
  };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// Stamp .gh-dark at load, not just on a toggle tap, and keep it live while the stored
// mode is 'auto' — a system theme switch (e.g. sunset) should re-resolve without
// requiring a tap. try/catch throughout: node tests import this module headlessly with
// no `document`/`window`, same guard shape as i18n.js's.
applyDom(getTheme());
try {
  const m = media();
  const onSystemChange = () => { if (getTheme() === 'auto') { applyDom('auto'); announce('auto'); } };
  if (m) { if (m.addEventListener) m.addEventListener('change', onSystemChange); else if (m.addListener) m.addListener(onSystemChange); }
} catch { /* not in a DOM */ }

export default { getTheme, setTheme, resolvedTheme, onThemeChange, THEMES };
