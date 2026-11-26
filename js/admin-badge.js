// js/admin-badge.js - THE ADMIN BADGE (2026-11-26, Matt: "When there's something for me to look at in my admin
// settings, put a notification badge on my profile thing on the bottom right of the regular games page, then on
// Admin, so i know to look"). ADMIN DEVICES ONLY: watches ONE small number, adminNow/v1/n, that the server counts
// from what Admin > Now shows (functions/admin-now.js, js/admin-now.js), so the launcher downloads a few bytes,
// never players/. The last number is kept in `gamehub.adminNow.v1` (a cache, display only) so the badge is there at
// first paint. Every other phone never reads it (the rules refuse them anyway).
import { isAdminDevice } from './admin-config.js';

const KEY = 'gamehub.adminNow.v1';

/** The last number seen on this admin device (0 elsewhere). */
export function cachedAdminNow() {
  try { return isAdminDevice() ? (Number(localStorage.getItem(KEY)) | 0) : 0; } catch { return 0; }
}

/** Calls `cb(n)` now (cached) and on every change. Returns a stop function. A no-op off an admin device. */
export function watchAdminNow(cb) {
  if (!isAdminDevice()) return () => {};
  let unsub = null, dead = false;
  try { cb(cachedAdminNow()); } catch { /* a painter never stops the watch */ }
  (async () => {
    try {
      const { getStatsApp } = await import('./firebase-boot.js');   // after the cached paint: offline still shows it
      const boot = await getStatsApp();
      if (!boot || dead) return;
      const { db, api } = boot;
      unsub = api.onValue(api.ref(db, 'adminNow/v1/n'), (s) => {
        const n = Number(s && s.val()) | 0;
        try { localStorage.setItem(KEY, String(n)); } catch { /* the badge still paints */ }
        try { cb(n); } catch (err) { console.error('[admin-badge] paint failed', err); }
      }, (err) => console.error('[admin-badge] watch refused', err));
      if (dead && unsub) unsub();
    } catch (err) { console.error('[admin-badge] watch failed', err); }
  })();
  return () => { dead = true; if (unsub) unsub(); };
}

export default { cachedAdminNow, watchAdminNow };
