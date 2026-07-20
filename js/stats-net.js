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
//
// The named app + auth are booted through js/firebase-boot.js, shared with net.js, so there is
// only ever one initializeApp('stats') call on the page (see firebase-boot.js for why).

import { deviceId, loadStats } from './game-stats.js';
import { loadProfile } from './profile-store.js';
import { getStatsApp } from './firebase-boot.js';

let _db = null, _api = null;

/** Ensure the shared named Firebase app + anonymous auth are ready. Returns true only when usable. */
export async function init() {
  const r = await getStatsApp();
  if (!r) return false;
  _db = r.db; _api = r.api;
  return true;
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

/** Who owns `code`: { name, emoji } from that player's most recently active NAMED device, or null.
 *  Linking a new device to a code adopts this, so a second phone inherits the player's real name
 *  instead of syncing the 'You' placeholder (which would rename the whole player on the board). */
export async function lookupCodeOwner(playerCode) {
  const want = (typeof playerCode === 'string' ? playerCode : '').trim().toUpperCase();
  if (!want) return null;
  const all = await readPlayersOnce();
  let best = null, bestAt = -1;
  for (const id of Object.keys(all)) {
    const rec = all[id] || {}, p = rec.profile || {};
    const name = (typeof p.name === 'string' ? p.name : '').trim();
    if (!name || name.toLowerCase() === 'you') continue;                       // skip the placeholder
    if ((typeof p.playerId === 'string' ? p.playerId : '').trim().toUpperCase() !== want) continue;
    const at = +rec.updatedAt || 0;
    if (at >= bestAt) { bestAt = at; best = { name, emoji: p.emoji || '' }; }
  }
  return best;
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
