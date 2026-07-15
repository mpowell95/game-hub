// stats-net.js - family-wide stats sync. EVERY device (not just the challenge persona) mirrors its
// profile + game play-counts to a NEW, isolated Firebase node: players/<deviceId>. Keyed by the
// per-device UUID from game-stats.js (NEVER the profile name), so two people who pick the same name
// never merge and a rename never forks a record.
//
// It uses a NAMED Firebase app ('stats') so it can coexist with the challenge's DEFAULT app on the
// admin device without an "app already exists" clash. Fully guarded: if firebase-config.js is
// unconfigured, the SDK fails to load, or the device is offline, init() returns false and every
// call is a safe no-op. Gameplay is never blocked and offline play is unaffected. It only ever
// touches players/ - never the challenge/, flight/, or selfies/ nodes.

import { deviceId, loadStats } from './game-stats.js';
import { loadProfile } from './profile-store.js';

const SDK = '10.12.2';
let _db = null, _api = null, _tried = false, _ok = false;

async function readConfig() {
  try { const m = await import('./firebase-config.js'); return m.firebaseConfig || (m.default && m.default.firebaseConfig) || m.default || null; }
  catch { return null; }
}

/** Initialize a NAMED Firebase app + anonymous auth once. Returns true only when usable. */
export async function init() {
  if (_tried) return _ok;
  _tried = true;
  try {
    const cfg = await readConfig();
    if (!(cfg && cfg.apiKey && cfg.databaseURL)) return (_ok = false);
    const appMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`);
    const dbMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`);
    const app = appMod.initializeApp(cfg, 'stats');   // named app: never collides with the challenge default app
    _db = dbMod.getDatabase(app);
    _api = dbMod;
    await authMod.signInAnonymously(authMod.getAuth(app));
    return (_ok = true);
  } catch { return (_ok = false); }
}

/** Mirror this device's profile + unified stats up to players/<deviceId>. Best-effort, never throws. */
export async function syncMyStats() {
  if (!(await init())) return false;
  try {
    const prof = loadProfile() || {};
    const rec = {
      profile: { name: prof.name || '', emoji: prof.emoji || '' },
      stats: loadStats(),
      updatedAt: _api.serverTimestamp(),
    };
    await _api.update(_api.ref(_db, 'players/' + deviceId()), rec);
    return true;
  } catch { return false; }
}

/** Live-watch every device's record (Admin Insights). cb({deviceId: record}). Returns unsubscribe. */
export async function watchPlayers(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(_api.ref(_db, 'players'), (s) => cb(s.val() || {})); }
  catch { return () => {}; }
}

export default { init, syncMyStats, watchPlayers };
