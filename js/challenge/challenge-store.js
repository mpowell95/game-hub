// challenge-store.js - the local-first progress record for the hidden challenge,
// stored obfuscated at localStorage["gamehub.challenge"]. Source of truth for
// gameplay, so everything works offline; the Firebase layer (challenge-net.js)
// mirrors it in Phase C4. Every field is monotonic-additive so sync merges cleanly.
//
// Inert for normal users: this file is only ever loaded by challenge code paths,
// which run only when the profile name matches (see hooks.isChallengeActive).

import { obf, deobf } from './crypt.js';

const KEY = 'gamehub.challenge';

function empty() {
  return {
    v: 1,
    wins: {},                       // { connect4|chinchon|business|parchis: true } qualifying wins recorded
    redeemed: {},                   // { slot: true } codes credited by manual entry
    order: [],                      // slots in redemption order; length = pieces revealed
    cf: { completed: 0 },           // Connect Four hazing counter
    selfie: { status: 'none', submissionId: null, reason: null, rejects: 0 },
    unlockSeen: false,              // full-screen unlock announcement played
    areaUnlocked: false,            // personal question answered on this device
    updatedAt: null,
  };
}

// Merge a parsed object onto a fresh empty() so missing/renamed fields never crash.
function normalize(o) {
  const e = empty();
  if (!o || typeof o !== 'object') return e;
  if (o.wins && typeof o.wins === 'object') for (const g of ['connect4', 'chinchon', 'business', 'parchis']) if (o.wins[g]) e.wins[g] = true;
  if (o.redeemed && typeof o.redeemed === 'object') for (const s in o.redeemed) if (o.redeemed[s]) e.redeemed[s] = true;
  if (Array.isArray(o.order)) e.order = o.order.filter((s) => typeof s === 'string');
  if (o.cf && Number.isFinite(o.cf.completed)) e.cf.completed = Math.max(0, o.cf.completed | 0);
  if (o.selfie && typeof o.selfie === 'object') {
    e.selfie.status = ['none', 'pending', 'approved', 'rejected'].includes(o.selfie.status) ? o.selfie.status : 'none';
    e.selfie.submissionId = o.selfie.submissionId || null;
    e.selfie.reason = typeof o.selfie.reason === 'string' ? o.selfie.reason : null;
    e.selfie.rejects = Number.isFinite(o.selfie.rejects) ? Math.max(0, o.selfie.rejects | 0) : 0;
  }
  e.unlockSeen = !!o.unlockSeen;
  e.areaUnlocked = !!o.areaUnlocked;
  e.updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : null;
  return e;
}

/** Load the progress record. Returns a fresh inert record when absent or corrupt. */
export function loadChallenge() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(deobf(raw))) : empty();
  } catch { return empty(); }
}

/** Persist (obfuscated) and stamp updatedAt. Returns the saved record or null. */
export function saveChallenge(st) {
  try {
    st.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, obf(JSON.stringify(st)));
    return st;
  } catch { return null; }
}

/** Apply mutator(st) to the loaded record and persist. Returns the saved record. */
export function updateChallenge(mutator) {
  const st = loadChallenge();
  mutator(st);
  return saveChallenge(st) || st;
}

/** Record a qualifying win (idempotent). Does NOT redeem a code (that is manual). */
export function recordWin(game) {
  return updateChallenge((st) => { st.wins[game] = true; });
}

/** Redeem a code slot (idempotent). First time appends to order -> reveals next piece. */
export function redeemSlot(slot) {
  return updateChallenge((st) => {
    if (!st.redeemed[slot]) { st.redeemed[slot] = true; st.order.push(slot); }
  });
}

export function markUnlockSeen() { return updateChallenge((st) => { st.unlockSeen = true; }); }
export function unlockArea() { return updateChallenge((st) => { st.areaUnlocked = true; }); }
export function setSelfie(patch) { return updateChallenge((st) => { Object.assign(st.selfie, patch); }); }

/** Pieces earned so far (0..5), by redemption order. */
export function pieceCount(st) { return (st || loadChallenge()).order.length; }

// --- Cross-device sync (Firebase mirror; see challenge-net.js) ------------------
// The record is mirrored to challenge/{PROGRESS_KEY}. Two device-local flags
// (unlockSeen, areaUnlocked) are NEVER synced: answering the personal question is
// required on each device (it is the recovery second factor), so remoteView strips
// them and mergeRemote leaves them untouched.

const GAMES = ['connect4', 'chinchon', 'business', 'parchis'];
const STATUS_RANK = { none: 0, pending: 1, rejected: 2, approved: 3 };

/** The mirrorable subset to push to Firebase (device-local flags removed). */
export function remoteView(st) {
  const s = st || loadChallenge();
  return {
    v: s.v,
    wins: Object.assign({}, s.wins),
    redeemed: Object.assign({}, s.redeemed),
    order: s.order.slice(),
    cf: { completed: s.cf.completed },
    selfie: {
      status: s.selfie.status,
      reason: s.selfie.reason,
      submissionId: s.selfie.submissionId,
      rejects: s.selfie.rejects || 0,
    },
  };
}

/**
 * Merge a pulled remote record into the local one. Every field is monotonic-additive
 * so the merge is conflict-free: wins/redeemed union, order append-only, cf.completed
 * max, selfie by status precedence with rejects max. Returns the saved local record.
 */
export function mergeRemote(remote) {
  return updateChallenge((st) => {
    if (!remote || typeof remote !== 'object') return;
    if (remote.wins && typeof remote.wins === 'object') for (const g of GAMES) if (remote.wins[g]) st.wins[g] = true;
    if (remote.redeemed && typeof remote.redeemed === 'object') for (const s in remote.redeemed) if (remote.redeemed[s]) st.redeemed[s] = true;

    // order: append-only union. Start from the longer sequence, append any slot the
    // other sequence introduces, then any redeemed slot still missing.
    const rOrder = Array.isArray(remote.order) ? remote.order.filter((s) => typeof s === 'string') : [];
    const base = rOrder.length > st.order.length ? rOrder.slice() : st.order.slice();
    const other = rOrder.length > st.order.length ? st.order : rOrder;
    for (const s of other) if (!base.includes(s)) base.push(s);
    for (const s in st.redeemed) if (st.redeemed[s] && !base.includes(s)) base.push(s);
    st.order = base;

    if (remote.cf && Number.isFinite(remote.cf.completed)) st.cf.completed = Math.max(st.cf.completed, remote.cf.completed | 0);

    if (remote.selfie && typeof remote.selfie === 'object') {
      const rs = remote.selfie;
      const rStatus = ['none', 'pending', 'approved', 'rejected'].includes(rs.status) ? rs.status : 'none';
      // Take the remote status/reason/submissionId only when it is at least as advanced
      // (approved > rejected > pending > none), so a stale echo never regresses local.
      if ((STATUS_RANK[rStatus] || 0) >= (STATUS_RANK[st.selfie.status] || 0)) {
        st.selfie.status = rStatus;
        st.selfie.reason = typeof rs.reason === 'string' ? rs.reason : (rStatus === 'rejected' ? st.selfie.reason : null);
        if (rs.submissionId) st.selfie.submissionId = rs.submissionId;
      }
      st.selfie.rejects = Math.max(st.selfie.rejects || 0, Number.isFinite(rs.rejects) ? rs.rejects | 0 : 0);
    }
  });
}

export default {
  loadChallenge, saveChallenge, updateChallenge, recordWin, redeemSlot,
  markUnlockSeen, unlockArea, setSelfie, pieceCount, remoteView, mergeRemote,
};
