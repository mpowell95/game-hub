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
      profile: { name: prof.name || '', emoji: prof.emoji || '', playerId: prof.playerId || '' },
      stats: loadStats(),
      updatedAt: _api.serverTimestamp(),
    };
    await _api.update(_api.ref(_db, 'players/' + deviceId()), rec);
    return true;
  } catch { return false; }
}

/** Live-watch every device's record (Admin Insights + Leaderboard). cb({deviceId: record}). Returns unsubscribe. */
export async function watchPlayers(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(_api.ref(_db, 'players'), (s) => cb(s.val() || {})); }
  catch { return () => {}; }
}

/** One-shot read of every device record (for the Stats screen's cross-device aggregation). {} if offline. */
export async function readPlayersOnce() {
  if (!(await init())) return {};
  try { const s = await _api.get(_api.ref(_db, 'players')); return s.val() || {}; }
  catch { return {}; }
}

// --- Username reservation (soft, family-grade) -----------------------------------------------------
// Registry: usernames/<encoded-lowercased-name> = { code, at }. Enforced client-side (the DB rules are
// open), so it is a courtesy lock for a trusted family, not tamper-proof. The leaderboard groups by
// player CODE regardless, so a name clash never steals anyone's stats.
const uname = (name) => (typeof name === 'string' ? name : '').trim().toLowerCase();
// RTDB keys cannot contain . $ # [ ] / — encodeURIComponent handles / # [ ], plus we escape . and $.
const encodeKey = (s) => encodeURIComponent(s).replace(/\./g, '%2E').replace(/\$/g, '%24');

/** Ownership of `name`: 'free' | 'mine' | 'taken' | 'offline'. */
export async function usernameStatus(name, myCode) {
  const key = uname(name);
  if (!key) return 'free';
  if (!(await init())) return 'offline';
  try {
    const s = await _api.get(_api.ref(_db, 'usernames/' + encodeKey(key)));
    const v = s.val();
    if (!v || !v.code) return 'free';
    return (myCode && String(v.code).toUpperCase() === String(myCode).toUpperCase()) ? 'mine' : 'taken';
  } catch { return 'offline'; }
}

/** Claim `name` for myCode, releasing a previously-owned `prevName` (only if I owned it). Best-effort. */
export async function claimUsername(name, myCode, prevName) {
  if (!myCode || !(await init())) return false;
  try {
    const key = uname(name);
    if (key) await _api.update(_api.ref(_db, 'usernames/' + encodeKey(key)), { code: String(myCode).toUpperCase(), at: _api.serverTimestamp() });
    const prev = uname(prevName);
    if (prev && prev !== key) {
      const s = await _api.get(_api.ref(_db, 'usernames/' + encodeKey(prev)));
      const v = s.val();
      if (v && v.code && String(v.code).toUpperCase() === String(myCode).toUpperCase()) await _api.remove(_api.ref(_db, 'usernames/' + encodeKey(prev)));
    }
    return true;
  } catch { return false; }
}

/** Admin escape hatch: force-release a name reservation regardless of owner. */
export async function adminReleaseUsername(name) {
  const key = uname(name);
  if (!key || !(await init())) return false;
  try { await _api.remove(_api.ref(_db, 'usernames/' + encodeKey(key))); return true; }
  catch { return false; }
}

export default { init, syncMyStats, watchPlayers, readPlayersOnce, usernameStatus, claimUsername, adminReleaseUsername };
