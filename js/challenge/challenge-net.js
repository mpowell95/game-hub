// challenge-net.js - the Firebase layer for the hidden challenge. Reuses ONLY the
// shared Firebase project (never js/net.js / GameNet). Dynamically imported, and only
// when the challenge is active. FULLY GUARDED: if js/firebase-config.js has no real
// values yet (or the SDK fails to load), init() returns false and every operation
// resolves to a safe no-op, so the offline challenge is completely unaffected.
//
// C4 scaffold: the operations are implemented and ready. They light up the moment Matt
// completes MP-01 and pastes the config. Selfie UI + Mission Control panel are wired in
// full C4 on top of these functions. See CHALLENGE-PLAN.md.

import { PROGRESS_KEY } from './secrets.js';

const SDK = '10.12.2';

let _db = null, _uid = null, _api = null, _tried = false, _ok = false;

// The progress record key for the ACTIVE persona (recipient or a tester). Defaults to
// the recipient's; challenge-ui sets it per active profile name so testers stay isolated.
let _key = PROGRESS_KEY;
export function setProgressKey(k) { if (typeof k === 'string' && k) _key = k; }

async function readConfig() {
  try { const m = await import('../firebase-config.js'); return m.firebaseConfig || (m.default && m.default.firebaseConfig) || m.default || null; }
  catch { return null; }
}
function isConfigured(c) { return !!(c && c.apiKey && c.databaseURL); }

/** Initialize Firebase + anonymous auth once. Returns true only when usable. */
export async function init() {
  if (_tried) return _ok;
  _tried = true;
  try {
    const cfg = await readConfig();
    if (!isConfigured(cfg)) return (_ok = false);
    const appMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`);
    const dbMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`);
    const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`);
    const app = appMod.initializeApp(cfg);
    _db = dbMod.getDatabase(app);
    _api = dbMod; // ref/get/set/update/push/onValue/remove/serverTimestamp
    const cred = await authMod.signInAnonymously(authMod.getAuth(app));
    _uid = cred.user.uid;
    return (_ok = true);
  } catch { return (_ok = false); }
}

export function uid() { return _uid; }
const path = (p) => _api.ref(_db, p);

/** Read the flight node for the finale. Null when unconfigured or absent. */
export async function fetchFlight() {
  if (!(await init())) return null;
  try { const s = await _api.get(path('flight')); return s.exists() ? s.val() : null; }
  catch { return null; }
}

/** Mirror local progress up to challenge/{active key}. */
export async function syncUp(state) {
  if (!(await init())) return false;
  try { const o = Object.assign({}, state); o.updatedAt = _api.serverTimestamp(); await _api.update(path('challenge/' + _key), o); return true; }
  catch { return false; }
}

/** Pull the remote progress record (recovery / cross-device). Null if none. */
export async function pull() {
  if (!(await init())) return null;
  try { const s = await _api.get(path('challenge/' + _key)); return s.exists() ? s.val() : null; }
  catch { return null; }
}

/** Delete the active persona's remote progress record (tester reset). */
export async function resetProgress() {
  if (!(await init())) return false;
  try { await _api.remove(path('challenge/' + _key)); return true; }
  catch { return false; }
}

/** Submit a compressed selfie data URL. Tags it with the submitter's progress key so
 *  Mission Control credits the right persona. Returns the pushId or null. */
export async function submitSelfie(dataUrl) {
  if (!(await init())) return null;
  try { const r = _api.push(path('selfies')); await _api.set(r, { by: _uid, key: _key, at: _api.serverTimestamp(), status: 'pending', image: dataUrl }); return r.key; }
  catch { return null; }
}

/** Watch my selfie status. cb({status, reason}). Returns an unsubscribe fn. */
export async function watchMySelfie(submissionId, cb) {
  if (!submissionId || !(await init())) return () => {};
  try { return _api.onValue(path('selfies/' + submissionId), (s) => { const v = s.val(); if (v) cb({ status: v.status, reason: v.reason || null }); }); }
  catch { return () => {}; }
}

// --- Mission Control (admin; gated only by the in-app PIN) ----------------------

/** Watch all selfies. cb(selfiesObject). Returns unsubscribe. */
export async function watchSelfies(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(path('selfies'), (s) => cb(s.val() || {})); }
  catch { return () => {}; }
}
/**
 * Record a selfie decision. Writes the verdict onto the SUBMITTER's progress record
 * challenge/{key}/selfie (Mission Control passes the selfie's own `key`, so testers and
 * the recipient stay separate) and mirrors { status, reason } onto selfies/{id}. The
 * image is intentionally KEPT (Matt wants to download it), not deleted.
 * `selfiePatch`: { status, reason, submissionId, rejects? }.
 */
export async function decideSelfie(id, key, selfiePatch) {
  if (!(await init())) return false;
  const patch = selfiePatch || {};
  const target = key || _key;
  try {
    await _api.update(path('challenge/' + target + '/selfie'), patch);
    await _api.update(path('selfies/' + id), { status: patch.status || 'rejected', reason: patch.reason || null });
    return true;
  } catch { return false; }
}
/** Save/edit the flight node. */
export async function saveFlight(flight) {
  if (!(await init())) return false;
  try { await _api.set(path('flight'), flight); return true; }
  catch { return false; }
}
/**
 * Live-watch the active persona's progress record challenge/{active key}. Used by a
 * player's device for cross-device sync + live selfie verdicts. cb(record|null).
 */
export async function watchProgress(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(path('challenge/' + _key), (s) => cb(s.val() || null)); }
  catch { return () => {}; }
}
/** Live-watch EVERY persona's progress record (Mission Control dashboard). cb({key:record}). */
export async function watchAllProgress(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(path('challenge'), (s) => cb(s.val() || {})); }
  catch { return () => {}; }
}

export default {
  init, uid, setProgressKey, fetchFlight, syncUp, pull, resetProgress, submitSelfie, watchMySelfie,
  watchSelfies, decideSelfie, saveFlight, watchProgress, watchAllProgress,
};
