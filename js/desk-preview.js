// desk-preview.js - Desktop view on a phone (2026-11-23, Matt: "Add a toggle in my admin settings that allows me to view
// desktop mode while on mobile"; option 1, the real preview). ADMIN DEVICES ONLY: Admin > gear > Desktop view.
// When on, and only on a small screen, the LAUNCHER is laid out 1440 CSS px wide and the phone shows it zoomed out to fit
// (the viewport meta), so it is exactly what a computer shows (js/hub.js deskOn(), html.gh-desk). A mounted game and every
// other page get the normal viewport back. A preference of this phone (gamehub.deskPreview.v1); never synced.
const KEY = 'gamehub.deskPreview.v1';
const WIDTH = 1440;
let orig = null;

export function deskPreviewOn() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setDeskPreview(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (err) { console.error('[desk-preview] not saved', err); }
  try { window.dispatchEvent(new CustomEvent('gamehub:deskpreview', { detail: !!on })); } catch { /* old browser */ }
}

/** The phone's real width in CSS px (screen.* is not changed by the viewport meta). */
function realWidth() {
  try { return Math.min(screen.width, screen.height) || 0; } catch { return 0; }
}

/** A touch phone (no mouse): never a laptop, however small its screen. */
function isPhone() {
  try { return matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
}

/** True when the preview applies on this device: switched on, a touch phone, a small screen. A computer needs none. */
export function deskPreviewActive() {
  return deskPreviewOn() && isPhone() && realWidth() > 0 && realWidth() < 900;
}

/** Lay the page out WIDTH px wide (on) or restore the page's own viewport (off). Idempotent. */
export function applyDeskViewport(on) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  if (orig === null) orig = meta.getAttribute('content') || '';
  let want = orig;
  if (on) {
    const s = Math.max(0.1, Math.round((realWidth() / WIDTH) * 1000) / 1000);
    want = `width=${WIDTH}, initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, user-scalable=no`
      + (/viewport-fit=cover/.test(orig) ? ', viewport-fit=cover' : '');
  }
  try {
    document.documentElement.classList.toggle('gh-deskview', !!on);
    if (on) document.documentElement.style.setProperty('--dv-s', String(Math.max(0.1, realWidth() / WIDTH)));
  } catch { /* no DOM */ }
  if (meta.getAttribute('content') !== want) meta.setAttribute('content', want);
}
