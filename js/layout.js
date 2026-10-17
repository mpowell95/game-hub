// layout.js — the launcher's Comfortable / Compact choice (2026-10-17). Same shape as js/theme.js
// (storage key + getter/setter + change event) on purpose, so it reads the same way.
//
// Storage key gamehub.layout.v1: 'comfortable' | 'compact', default 'comfortable' (the launcher
// everyone already knows). Compact (Matt's mockup C): one title row, 3-across tiles with the name
// under the art, and a bottom tab bar (Games, Challenges, Messages, Leaderboards, Profile) in place
// of the second row of buttons and the Challenges bar. setLayout() and this module's own load-time
// side effect stamp `.gh-compact` on <html>; that class is the ONE thing css/hub.css keys off.
//
// A preference, not history: THE LAW's rule-2 carve-out applies, same as theme and language.

const KEY = 'gamehub.layout.v1';
export const LAYOUTS = ['comfortable', 'compact'];
const EVENT = 'gamehub:layout';

/** The stored choice. Unset or unrecognized reads as 'comfortable'. */
export function getLayout() {
  try { const v = localStorage.getItem(KEY); return LAYOUTS.includes(v) ? v : 'comfortable'; }
  catch { return 'comfortable'; }
}

export const isCompact = () => getLayout() === 'compact';

function applyDom(layout) {
  try { document.documentElement.classList.toggle('gh-compact', layout === 'compact'); }
  catch { /* not in a DOM */ }
}

/** Persist the layout, restamp the DOM, and notify listeners. Returns the layout actually set. */
export function setLayout(layout) {
  const v = LAYOUTS.includes(layout) ? layout : 'comfortable';
  try { localStorage.setItem(KEY, v); }
  catch (err) { console.warn('[layout] could not save the layout choice (it applies to this visit only)', err); }
  applyDom(v);
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { layout: v } })); } catch { /* headless */ }
  return v;
}

/** Subscribe to layout changes: cb(layout). Returns an unsubscribe function. */
export function onLayoutChange(cb) {
  const h = (e) => { try { cb((e.detail && e.detail.layout) || getLayout()); } catch { /* listener's problem */ } };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// Stamp at load, before the launcher's first paint, so a compact phone never flashes the other one.
applyDom(getLayout());
