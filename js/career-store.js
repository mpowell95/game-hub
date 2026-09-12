// career-store.js - the shared, network-first career sync store for Baseball's career mode
// (BB-0-phase-0-handoff.md). Phase 0: no game reads or writes through this yet - it exists so the
// shape and the reconcile rule are settled and tested before any game logic depends on them.
//
// Shared with js/stats-net.js's own conventions on purpose: boots through js/firebase-boot.js's
// getStatsApp() (never a second Firebase app), never imports Firebase at module scope, and never
// fails a caller silently (THE LAW rule 6) - every failure records a health state and logs loudly
// instead of throwing.
//
// Full contract, the node shape and why `live` sits one level down from `baseball`:
// js/CLAUDE.md, "Career sync". Frozen identifiers: baseball/CLAUDE.md.

import { getStatsApp } from './firebase-boot.js';
import { writesAllowed } from './stats-net.js';
import { ensureAuthClaim, myCode } from './messages.js';
import { deviceId, recordBaseballCareerFinished } from './game-stats.js';

export const CAREER_SCHEMA_V = 1;
export const CAREER_NODE = 'careers';
export const CAREER_GAME = 'baseball';
export const CAREER_LIVE = 'live';
export const CAREER_HISTORY = 'history';
export const CAREER_FORKS = 'forks';
export const CAREER_LOCAL_KEY = 'gamehub.baseball.v1';
export const CAREER_LOCAL_FIELD = 'career';
// The service worker's own network-first deadline (sw.js's NET_TIMEOUT_MS) - stated here too so a
// caller reading this file understands why a pull can come back null on a slow connection rather
// than hanging: the SW itself gives up on the request after this long.
export const CAREER_PULL_TIMEOUT_MS = 2500;
export const CAREER_ID_RANDOM_LEN = 4;
export const CAREER_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const CAREER_HEALTH_KEY = 'gamehub.careerSync.v1';
export const HEALTH_OK = 'ok';
export const HEALTH_PULLING = 'pulling';
export const HEALTH_OFFLINE_LOCAL = 'offline-local';
export const HEALTH_FORK = 'fork';
export const HEALTH_DENIED = 'denied';

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (err) { console.error(`[career-store] could not write ${k}`, err); return false; } }

function readHealth() { return readJSON(CAREER_HEALTH_KEY) || {}; }
function writeHealth(patch) { writeJSON(CAREER_HEALTH_KEY, Object.assign(readHealth(), patch, { at: Date.now() })); }

/** Last known career-sync state for this device: `{ state, at, code, careerId, seq, reason }`. */
export function careerSyncHealth() { return readHealth(); }

function livePath(code) { return `${CAREER_NODE}/${code}/${CAREER_GAME}/${CAREER_LIVE}`; }
function historyPath(code, careerId) { return `${CAREER_NODE}/${code}/${CAREER_GAME}/${CAREER_HISTORY}/${careerId}`; }
function forkPath(code, tag) { return `${CAREER_NODE}/${code}/${CAREER_GAME}/${CAREER_FORKS}/${tag}`; }

// --- pure, headless-testable exports -----------------------------------------------------------

/** Whole-document reject, never default-fill (golf/js/save.js's model: a half-trusted career
 *  document is worse than none - a stored best only ever improves, THE LAW rule 2, so a wrong
 *  field invented by a default could never be corrected by playing better). Returns the document
 *  unchanged or null; never throws, never mutates its input. */
export function validateCareer(raw) {
  try {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.v !== CAREER_SCHEMA_V) return null;
    if (typeof raw.code !== 'string' || !raw.code) return null;
    if (typeof raw.careerId !== 'string' || !raw.careerId) return null;
    if (!Number.isInteger(raw.seq) || raw.seq < 0) return null;
    if (!Number.isInteger(raw.baseSeq) || raw.baseSeq < 0) return null;
    if (!Number.isFinite(raw.updatedAt)) return null;
    if (typeof raw.device !== 'string' || !raw.device) return null;
    if (!Number.isInteger(raw.rulesV) || raw.rulesV < 1) return null;
    if (raw.state === undefined) return null;   // opaque, but must exist
    return raw;
  } catch { return null; }
}

/** Compares a LOCAL document against what was just PULLED from Firebase (both already validated,
 *  or null) and decides what to do: 'none' (nothing changed on either side since the last shared
 *  baseSeq), 'adopt' (take the remote copy), 'push' (the remote copy already reflects local, or
 *  there is no remote yet - write local up), 'fork' (BOTH sides advanced past baseSeq since they
 *  last agreed - genuine concurrent edits, e.g. two devices playing offline at once). */
export function reconcile(local, remote) {
  if (!remote) return local ? 'push' : 'none';
  if (!local) return 'adopt';
  const localAhead = local.seq > local.baseSeq;
  const remoteAhead = remote.seq > local.baseSeq;
  if (!localAhead && !remoteAhead) return 'none';
  if (localAhead && !remoteAhead) return 'push';
  if (!localAhead && remoteAhead) return 'adopt';
  return 'fork';
}

function secureRand() {
  try {
    if (self.crypto && self.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      self.crypto.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
  } catch { /* fall through */ }
  return Math.random();
}

/** `<CODE>-<startedAtMs>-<RAND>`, RAND drawn from CAREER_ID_ALPHABET at CAREER_ID_RANDOM_LEN chars.
 *  `rand` is an injectable RNG (`() => 0..1`) for deterministic tests; production omits it and this
 *  falls back to `crypto.getRandomValues`, with the same plain-Math.random fallback deviceId() uses
 *  when crypto is unavailable. */
export function mintCareerId(code, now, rand) {
  const draw = rand || secureRand;
  let out = '';
  for (let i = 0; i < CAREER_ID_RANDOM_LEN; i++) {
    out += CAREER_ID_ALPHABET[Math.floor(draw() * CAREER_ID_ALPHABET.length) % CAREER_ID_ALPHABET.length];
  }
  return `${code}-${now}-${out}`;
}

// --- storage + network --------------------------------------------------------------------------

function readLocalSettings() { return readJSON(CAREER_LOCAL_KEY) || {}; }

/** The locally-saved career document, or null. Lives on `gamehub.baseball.v1`'s own `career`
 *  field - one settings key per game, never a second `gamehub.baseball.save.v1` (root CLAUDE.md's
 *  standing rule for this game). */
export function loadLocalCareer() {
  const s = readLocalSettings();
  return validateCareer(s[CAREER_LOCAL_FIELD]);
}

/** Save the local career document. Increments `seq` and marks it dirty against `baseSeq` (a save
 *  is a local edit, so it must look locally-ahead until a push or pull says otherwise). */
export function saveLocalCareer(doc) {
  const s = readLocalSettings();
  const next = Object.assign({}, doc, { seq: (doc.seq | 0) + 1 });
  s[CAREER_LOCAL_FIELD] = next;
  writeJSON(CAREER_LOCAL_KEY, s);
  return next;
}

async function boot() {
  // TEST-ONLY seam: test-career-sync.mjs sets this global to a fake { db, api, uid } so
  // pullCareer/pushCareer/retireCareer can be exercised against an in-memory store rather than a
  // real Firebase boot, without adding a production-facing export beyond the ones this file's
  // header documents. Never set outside a test process.
  if (typeof globalThis !== 'undefined' && globalThis.__CAREER_TEST_BOOT__ !== undefined) {
    return globalThis.__CAREER_TEST_BOOT__;
  }
  const r = await getStatsApp();
  return r; // { db, api, uid } or null
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function claimedCode(boot0) {
  const code = myCode();
  if (!code) return null;
  await ensureAuthClaim(boot0);
  return code;
}

/** Pull the code's live career document, reconcile against the local copy, and act: adopt, push,
 *  or fork (archiving the local copy under `forks/` FIRST, then adopting remote). Returns the
 *  document now in effect locally, or null if nothing could be resolved (offline/unconfigured). */
export async function pullCareer() {
  const code = myCode();
  if (!code) { writeHealth({ state: HEALTH_OFFLINE_LOCAL, reason: 'no-player-code' }); return loadLocalCareer(); }
  writeHealth({ state: HEALTH_PULLING, code });
  const boot0 = await boot();
  if (!boot0) { writeHealth({ state: HEALTH_OFFLINE_LOCAL, code, reason: 'firebase-unavailable' }); return loadLocalCareer(); }
  await ensureAuthClaim(boot0);
  const local = loadLocalCareer();
  let remote = null;
  try {
    const snap = await withTimeout(boot0.api.get(boot0.api.ref(boot0.db, livePath(code))), CAREER_PULL_TIMEOUT_MS);
    remote = snap && snap.exists ? validateCareer(snap.val()) : null;
  } catch (err) {
    console.error('[career-store] pull failed', err);
    writeHealth({ state: HEALTH_OFFLINE_LOCAL, code, reason: String((err && err.message) || err) });
    return local;
  }
  const decision = reconcile(local, remote);
  if (decision === 'none') { writeHealth({ state: HEALTH_OK, code, careerId: (local && local.careerId) || null, seq: local ? local.seq : 0 }); return local; }
  if (decision === 'push') { await pushCareer(); return loadLocalCareer(); }
  if (decision === 'adopt') {
    writeJSON(CAREER_LOCAL_KEY, Object.assign(readLocalSettings(), { [CAREER_LOCAL_FIELD]: Object.assign({}, remote, { baseSeq: remote.seq }) }));
    writeHealth({ state: HEALTH_OK, code, careerId: remote.careerId, seq: remote.seq });
    return remote;
  }
  // fork: archive the local copy first, THEN adopt remote - nothing local is ever silently lost.
  const tag = `${deviceId()}-${Date.now()}`;
  if (writesAllowed('career fork archive')) {
    try { await boot0.api.set(boot0.api.ref(boot0.db, forkPath(code, tag)), local); }
    catch (err) { console.error('[career-store] could not archive forked career', err); }
  }
  writeJSON(CAREER_LOCAL_KEY, Object.assign(readLocalSettings(), { [CAREER_LOCAL_FIELD]: Object.assign({}, remote, { baseSeq: remote.seq }) }));
  writeHealth({ state: HEALTH_FORK, code, careerId: remote.careerId, seq: remote.seq, forkPath: forkPath(code, tag) });
  return remote;
}

let _pushInFlight = null;
let _pushQueued = false;

async function doPush() {
  const code = myCode();
  const local = loadLocalCareer();
  if (!code || !local) return false;
  if (!writesAllowed('pushCareer')) { writeHealth({ state: HEALTH_DENIED, code, reason: 'dev-origin-blocked' }); return false; }
  const boot0 = await boot();
  if (!boot0) { writeHealth({ state: HEALTH_OFFLINE_LOCAL, code, reason: 'firebase-unavailable' }); return false; }
  await ensureAuthClaim(boot0);
  try {
    await boot0.api.set(boot0.api.ref(boot0.db, livePath(code)), local);
    const s = readLocalSettings();
    s[CAREER_LOCAL_FIELD] = Object.assign({}, local, { baseSeq: local.seq });
    writeJSON(CAREER_LOCAL_KEY, s);
    writeHealth({ state: HEALTH_OK, code, careerId: local.careerId, seq: local.seq });
    return true;
  } catch (err) {
    const denied = /permission/i.test(String((err && err.message) || err));
    console.error('[career-store] push failed', err);
    writeHealth({ state: denied ? HEALTH_DENIED : HEALTH_OFFLINE_LOCAL, code, reason: String((err && err.message) || err) });
    return false;
  }
}

/** Coalesced push: one in flight at a time, latest local state wins. Sets `baseSeq` on success. */
export async function pushCareer() {
  if (_pushInFlight) { _pushQueued = true; return _pushInFlight; }
  _pushInFlight = (async () => {
    let ok = await doPush();
    while (_pushQueued) { _pushQueued = false; ok = await doPush(); }
    _pushInFlight = null;
    return ok;
  })();
  return _pushInFlight;
}

/** Retire a finished career: one multi-path update writing `history/<careerId>` and nulling
 *  `live` together, re-read to verify both landed, THEN fold the summary row into the local
 *  game-stats store via recordBaseballCareerFinished - in that order, so a career is never marked
 *  finished locally before Firebase actually agrees it is gone from `live`. */
export async function retireCareer(row) {
  const code = myCode();
  if (!code || !row || !row.careerId) return false;
  if (!writesAllowed('retireCareer')) { writeHealth({ state: HEALTH_DENIED, code, reason: 'dev-origin-blocked' }); return false; }
  const boot0 = await boot();
  if (!boot0) { writeHealth({ state: HEALTH_OFFLINE_LOCAL, code, reason: 'firebase-unavailable' }); return false; }
  await ensureAuthClaim(boot0);
  const updates = {};
  updates[historyPath(code, row.careerId)] = row;
  updates[livePath(code)] = null;
  try {
    await boot0.api.update(boot0.api.ref(boot0.db), updates);
    const [hSnap, lSnap] = await Promise.all([
      boot0.api.get(boot0.api.ref(boot0.db, historyPath(code, row.careerId))),
      boot0.api.get(boot0.api.ref(boot0.db, livePath(code))),
    ]);
    const landed = hSnap && hSnap.exists() && (!lSnap || !lSnap.exists());
    if (!landed) {
      console.error('[career-store] retireCareer did not verify on re-read', { code, careerId: row.careerId });
      writeHealth({ state: HEALTH_OFFLINE_LOCAL, code, reason: 'verify-failed' });
      return false;
    }
    const s = readLocalSettings();
    delete s[CAREER_LOCAL_FIELD];
    writeJSON(CAREER_LOCAL_KEY, s);
    recordBaseballCareerFinished(row);
    writeHealth({ state: HEALTH_OK, code, careerId: row.careerId });
    return true;
  } catch (err) {
    const denied = /permission/i.test(String((err && err.message) || err));
    console.error('[career-store] retireCareer failed', err);
    writeHealth({ state: denied ? HEALTH_DENIED : HEALTH_OFFLINE_LOCAL, code, reason: String((err && err.message) || err) });
    return false;
  }
}

export default {
  CAREER_SCHEMA_V, CAREER_NODE, CAREER_GAME, CAREER_LIVE, CAREER_HISTORY, CAREER_FORKS,
  CAREER_LOCAL_KEY, CAREER_LOCAL_FIELD, CAREER_PULL_TIMEOUT_MS, CAREER_ID_RANDOM_LEN, CAREER_ID_ALPHABET,
  CAREER_HEALTH_KEY, HEALTH_OK, HEALTH_PULLING, HEALTH_OFFLINE_LOCAL, HEALTH_FORK, HEALTH_DENIED,
  validateCareer, reconcile, mintCareerId, loadLocalCareer, saveLocalCareer,
  pullCareer, pushCareer, retireCareer, careerSyncHealth,
};
