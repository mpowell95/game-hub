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

// TODO(C4): verify the current Firebase JS SDK version against the official docs at build
// time (the MP standing rule) and pin it here.
const SDK = '10.12.2';

let _db = null, _uid = null, _api = null, _tried = false, _ok = false;

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

/** Mirror local progress up to challenge/{PROGRESS_KEY}. */
export async function syncUp(state) {
  if (!(await init())) return false;
  try { const o = Object.assign({}, state); o.updatedAt = _api.serverTimestamp(); await _api.update(path('challenge/' + PROGRESS_KEY), o); return true; }
  catch { return false; }
}

/** Pull the remote progress record (recovery / cross-device). Null if none. */
export async function pull() {
  if (!(await init())) return null;
  try { const s = await _api.get(path('challenge/' + PROGRESS_KEY)); return s.exists() ? s.val() : null; }
  catch { return null; }
}

/** Submit a compressed selfie data URL. Returns the pushId or null. */
export async function submitSelfie(dataUrl) {
  if (!(await init())) return null;
  try { const r = _api.push(path('selfies')); await _api.set(r, { by: _uid, at: _api.serverTimestamp(), status: 'pending', image: dataUrl }); return r.key; }
  catch { return null; }
}

/** Watch my selfie status. cb({status, reason}). Returns an unsubscribe fn. */
export async function watchMySelfie(submissionId, cb) {
  if (!submissionId || !(await init())) return () => {};
  try { return _api.onValue(path('selfies/' + submissionId), (s) => { const v = s.val(); if (v) cb({ status: v.status, reason: v.reason || null }); }); }
  catch { return () => {}; }
}

// --- Mission Control (admin) ---------------------------------------------------

/** Whether this anonymous uid is on the admins allowlist. */
export async function isAdminUid() {
  if (!(await init())) return false;
  try { const s = await _api.get(path('admins/' + _uid)); return s.val() === true; }
  catch { return false; }
}
/** Watch all pending selfies (admin only). cb(selfiesObject). Returns unsubscribe. */
export async function watchSelfies(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(path('selfies'), (s) => cb(s.val() || {})); }
  catch { return () => {}; }
}
/**
 * Record a selfie decision, then delete the image immediately (privacy hardening).
 * `selfiePatch` is merged onto challenge/{PROGRESS_KEY}/selfie (Mission Control builds
 * it: { status, reason, submissionId, rejects? } - `rejects` carries the escalating
 * rejection counter). Only { status, reason } persist on selfies/{id}; the image is
 * removed so no photo lingers server-side after a decision.
 */
export async function decideSelfie(id, selfiePatch) {
  if (!(await init())) return false;
  const patch = selfiePatch || {};
  try {
    await _api.update(path('challenge/' + PROGRESS_KEY + '/selfie'), patch);
    await _api.update(path('selfies/' + id), { status: patch.status || 'rejected', reason: patch.reason || null });
    await _api.remove(path('selfies/' + id + '/image'));
    return true;
  } catch { return false; }
}
/** Save/edit the flight node (admin only; keeps real details out of the repo). */
export async function saveFlight(flight) {
  if (!(await init())) return false;
  try { await _api.set(path('flight'), flight); return true; }
  catch { return false; }
}
/**
 * Live-watch the single progress record challenge/{PROGRESS_KEY}. Used BOTH by Ana's
 * device (cross-device sync + live selfie verdicts) and by Mission Control's dashboard;
 * the record is readable by any authed client. cb(record|null). Returns unsubscribe.
 */
export async function watchProgress(cb) {
  if (!(await init())) return () => {};
  try { return _api.onValue(path('challenge/' + PROGRESS_KEY), (s) => cb(s.val() || null)); }
  catch { return () => {}; }
}

export default {
  init, uid, fetchFlight, syncUp, pull, submitSelfie, watchMySelfie,
  isAdminUid, watchSelfies, decideSelfie, saveFlight, watchProgress,
};
