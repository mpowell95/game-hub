// js/repair-1109.js - ONE-TIME REPAIR for one phone (2026-11-09).
//
// Matt deleted the Home Screen app and added it back (a session told him to, without warning him it
// wipes the phone's storage). The new install became a new device (af19bf92...) with an empty local
// stats store, so every game with levels started him at level 1, though his old device's record
// (players/dc1745bc..., last synced 5:04 PM ET that day) still holds everything. Matt: "How much of
// this can you fix?"; root CLAUDE.md: a save on one phone is fixed by a one-time repair keyed to his
// code, stamped, verified by re-read.
//
// What it does, in this order (RESTORE.md (b), "Restoring the exact same device id"):
//   1. Sync THIS phone first and require a verified sync, so every play made since the reinstall is on
//      the server under players/af19bf92... (that record is kept and keeps counting; nothing deleted).
//   2. Read players/dc1745bc... fresh; it must carry code QZCC4 and a stats store.
//   3. Back up this phone's own store, activity and device id to gamehub.repair1109.backup (never removed).
//   4. Put the old record's stats + activity back in this phone's store and make this phone that device
//      again (gamehub.deviceId). Each write re-read. The next sync re-writes the same numbers to
//      players/dc1745bc... (no plays counted twice: the two records stay separate, as before).
//   5. Stamp, so it never runs again; the caller reloads the page.
// Acts ONLY on code QZCC4 on device af19bf92-7d90-428f-a2ce-1e5c7d67c5c1. Every other phone: nothing.
import { activeCode, statsId, statsKey, DEVICE_KEY } from './game-stats.js';

const CODE_1109 = 'QZCC4';
const NEW_1109 = 'af19bf92-7d90-428f-a2ce-1e5c7d67c5c1';
const OLD_1109 = 'dc1745bc-f183-481d-8c63-d79b4727ad2d';
const STAMP = 'gamehub.repair.reinstall1109.v1';
const BACKUP = 'gamehub.repair1109.backup';
const ACTIVITY_KEY = 'gamehub.activity.v1';
const SYNC_SIG_KEY = 'gamehub.syncSig.v1';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function put(k, v) {
  localStorage.setItem(k, v);
  if (localStorage.getItem(k) !== v) throw new Error('re-read mismatch on ' + k);
}

/** Resolves true when this phone was switched back (the caller reloads), else false. Never throws. */
export async function repairReinstall1109(t = {}) {
  // `t` is passed only by tools/test-repair-1109.mjs (a made-up code and ids, fake network).
  const CODE = t.code || CODE_1109, NEW_ID = t.newId || NEW_1109, OLD_ID = t.oldId || OLD_1109;
  let started = false;
  try {
    if (get(STAMP)) return false;
    if (activeCode() !== CODE || get(DEVICE_KEY) !== NEW_ID || statsId() !== NEW_ID || statsKey() !== 'gamehub.stats') return false;
    const net = t.net || await import('./stats-net.js');
    // 1. This phone's own plays reach the server first, verified.
    if (!(await net.syncMyStats())) { console.warn('[repair-1109] this phone did not sync yet; trying again next open'); return false; }
    // 2. The old device's record, fresh from the server.
    let old = null;
    if (t.readOld) old = await t.readOld(OLD_ID);
    else {
      const { getStatsApp } = await import('./firebase-boot.js');
      const boot = await getStatsApp();
      if (!boot) return false;
      const snap = await boot.api.get(boot.api.ref(boot.db, 'players/' + OLD_ID));
      old = snap && snap.exists() ? snap.val() : null;
    }
    if (!old || !old.profile || old.profile.playerId !== CODE || !old.stats || typeof old.stats.games !== 'object') {
      console.error('[repair-1109] the old record is not what was expected; nothing changed');
      return false;
    }
    // 3. Back up what this phone holds now (kept forever).
    if (!get(BACKUP)) {
      put(BACKUP, JSON.stringify({ at: Date.now(), deviceId: NEW_ID, stats: get('gamehub.stats'), activity: get(ACTIVITY_KEY), syncSig: get(SYNC_SIG_KEY) }));
    }
    // 4. The old device's store and activity back on this phone, and this phone is that device again.
    // Any failure from here puts every key back from the backup (a half-switched phone could sync one
    // device's store under the other's id).
    started = true;
    put('gamehub.stats', JSON.stringify(old.stats));
    if (old.activity && typeof old.activity === 'object') {
      let all = {};
      try { all = JSON.parse(get(ACTIVITY_KEY) || '{}') || {}; } catch { all = {}; }
      all['gamehub.stats'] = old.activity;
      put(ACTIVITY_KEY, JSON.stringify(all));
    }
    if (t.failAt === 'device') throw new Error('test failure');
    put(DEVICE_KEY, OLD_ID);
    try { localStorage.removeItem(SYNC_SIG_KEY); } catch { /* the next sync just re-sends */ }
    // 5. Never again.
    put(STAMP, JSON.stringify({ at: Date.now(), from: NEW_ID, to: OLD_ID }));
    console.info('[repair-1109] this phone is device ' + OLD_ID + ' again, with its stats');
    return true;
  } catch (err) {
    console.error('[repair-1109] repair failed (backup in ' + BACKUP + ')', err);
    if (started) rollBack();
    return false;
  }
}

/** Put this phone back exactly as it was before step 4. */
function rollBack() {
  try {
    const b = JSON.parse(get(BACKUP) || 'null');
    if (!b) return;
    localStorage.setItem(DEVICE_KEY, b.deviceId);
    if (typeof b.stats === 'string') localStorage.setItem('gamehub.stats', b.stats);
    if (typeof b.activity === 'string') localStorage.setItem(ACTIVITY_KEY, b.activity); else localStorage.removeItem(ACTIVITY_KEY);
    console.warn('[repair-1109] rolled back; will try again next open');
  } catch (err) { console.error('[repair-1109] ROLLBACK FAILED', err); }
}
