// device-report.js - gathers every piece of locally-stored identifying/device/profile
// data on this device, plus two Firebase "conflict detector" reads, for the Device
// Details diagnostic on the profile page. Read-only against every game's own store
// (never mutates any of them); its own new RTDB node (`deviceReports/`) is the only
// thing this module writes, so it doesn't collide with stats-net.js (players/,
// usernames/), net.js (rooms/), or challenge-net.js (its own nodes).
//
// Deliberately excludes js/challenge/ state: that system is a hidden surprise for the
// family, and this diagnostic is meant to be opened by the same family members it's
// hidden from - surfacing an admin/dev flag or the challenge's own record here would
// risk tipping it off for no diagnostic benefit (it has nothing to do with whose stats
// belong to whom).

import { loadProfile } from './profile-store.js';
import { loadStats, deviceId, statsId, statsKey, statsOwner, FORK_KEY } from './game-stats.js';
import { syncHealth } from './stats-net.js';
import { getStatsApp } from './firebase-boot.js';

function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch { return null; }
}
function byteSize(str) {
  try { return new TextEncoder().encode(str).length; } catch { return str ? str.length : 0; }
}
function allLocalStorageKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); }
  catch { /* private mode or storage disabled: leave empty */ }
  return out.sort();
}

// Mirrors stats-net.js's own (unexported) username-key derivation exactly, so the
// "registered owner" check looks up the SAME record claimUsername()/usernameStatus()
// would - trim + lowercase, then RTDB-safe encoding (keys can't contain . $ # [ ] /).
const uname = (name) => (typeof name === 'string' ? name : '').trim().toLowerCase();
const encodeKey = (s) => encodeURIComponent(s).replace(/\./g, '%2E').replace(/\$/g, '%24');

/** Everything this device has stored, keyed by what it's for rather than raw key
 *  names (the raw key dump below covers "list every key" separately). */
async function gatherLocal() {
  // Safe to mint here (unlike the profile page's own quiet id display): pressing a
  // button that reports device details is itself a real interaction, not a passive
  // page load that must stay side-effect-free.
  const id = deviceId();
  const profile = loadProfile();
  const stats = loadStats();
  const favorites = readJSON('gamehub.favorites.v1');
  let health = null;
  try { health = syncHealth(); } catch { /* stats-net not booted yet */ }

  const perGame = {
    chinchonSettings: readJSON('chinchon-settings'),
    chinchonStatsLegacy: readJSON('chinchon-stats'),
    chinchonMpResume: readJSON('gamehub.chinchon.mp.v1'),
    chinchonSoloSave: readJSON('gamehub.chinchon.solo.v1'),
    escobaSettings: readJSON('escoba-settings'),
    escobaSave: readJSON('escoba-save'), // MP state (if any) nests inside this, no separate key
    monopolyDealStatsLegacy: readJSON('bd-stats'),
    monopolyDealPendingQueue: readJSON('gamehub.bd.pendingStats.v1'),
    mancalaSettings: readJSON('gamehub.mancala.v1'),
    mancalaSave: readJSON('gamehub.mancala.game.v1'),
    fillerSettings: readJSON('gamehub.filler.v1'),
    fillerSave: readJSON('gamehub.filler.save.v1'),
    nutsBoltsSettings: readJSON('gamehub.nutsbolts.v1'),
    ticTacToeSettings: readJSON('gamehub.tictactoe.v1'),
    ticTacToeSave: readJSON('gamehub.tictactoe.save.v1'),
    dotsAndBoxesSettings: readJSON('gamehub.dotsboxes.v1'),
    dotsAndBoxesSave: readJSON('gamehub.dotsboxes.save.v1'),
    boggleSettings: readJSON('gamehub.boggle.v1'),
    boggleSave: readJSON('gamehub.boggle.save.v1'),
    connectFourSave: readJSON('gamehub.connect4.save.v1'),
    ballRun: {
      difficulty: readRaw('ballrun.difficulty'),
      seenHelp: readRaw('ballrun.seenHelp'),
      bestObstaclesByDiff: {
        easy: readRaw('ballrun.bestObstacles.easy'),
        medium: readRaw('ballrun.bestObstacles.medium'),
        hard: readRaw('ballrun.bestObstacles.hard'),
      },
      runLog: readJSON('ballrun.runLog.v1'), // the one true per-play record on the device
    },
  };

  const other = {
    addToHomeScreenDismissed: readRaw('hub-a2hs-dismissed-v1') === '1',
  };

  const rawKeyDump = allLocalStorageKeys().map((key) => ({ key, bytes: byteSize(readRaw(key) || '') }));

  // WHOSE stats this device is recording (game-stats.js's "WHOSE stats these are" block). If two
  // people have ever played here, `otherStores` is the tell: it lists every other player's store on
  // this device by key and play count, so a blended-history question is answerable from one report
  // instead of by inference. `stats` above is the ACTIVE player's store only.
  const identity = {
    statsId: statsId(),                    // the players/<id> node this device's active player syncs to
    statsKey: statsKey(),                  // which localStorage key `stats` above came from
    owner: statsOwner(),                   // { code, name, at } of whoever owns the original store here
    forks: readJSON(FORK_KEY),             // append-only log of every additional player seen here
    otherStores: allLocalStorageKeys()
      .filter((k) => k.startsWith('gamehub.stats.p.') && k !== statsKey())
      .map((key) => {
        const st = readJSON(key);
        let plays = 0;
        for (const g of Object.keys((st && st.games) || {})) plays += (((st.games[g] || {}).total || {}).played | 0);
        return { key, plays, updatedAt: (st && st.updatedAt) || null };
      }),
  };

  return {
    capturedAt: new Date().toISOString(),
    deviceId: id,
    identity,
    profile,
    stats,
    favorites,
    syncHealth: health,
    perGame,
    other,
    rawKeyDump,
  };
}

/** The two checks that would have caught a mixed-up profile immediately: is the
 *  registered owner of this name's Firebase reservation the SAME code as this
 *  device's profile, and does Firebase's own record for this device id agree with
 *  what's stored locally. Degrades to nulls (never throws) when offline. */
async function gatherConflictChecks(local) {
  const out = { registeredOwner: null, remotePlayer: null, error: null };
  try {
    const boot = await getStatsApp();
    if (!boot) { out.error = 'offline or Firebase unavailable'; return out; }
    const { db, api } = boot;
    const name = local.profile && local.profile.name;
    const key = uname(name);
    if (key) {
      const snap = await api.get(api.ref(db, 'usernames/' + encodeKey(key)));
      out.registeredOwner = snap.exists() ? snap.val() : null; // { code, at } or null if unclaimed
    }
    // The ACTIVE player's node, which is deviceId for this device's owner and <deviceId>-<CODE> for
    // anyone else playing here - comparing against players/<deviceId> would compare a second player's
    // local stats to the first player's remote record and report a phantom disagreement.
    const psnap = await api.get(api.ref(db, 'players/' + local.identity.statsId));
    out.remotePlayer = psnap.exists() ? psnap.val() : null;
  } catch (e) {
    out.error = String(e && e.message ? e.message : e);
  }
  return out;
}

/** The full Device Details report: everything local plus the two conflict checks. */
export async function gatherDeviceReport() {
  const local = await gatherLocal();
  const conflicts = await gatherConflictChecks(local);
  return { ...local, conflicts };
}

/** Uploads a report to `deviceReports/<deviceId>/<pushId>` - a new, timestamped entry
 *  per press (never overwrites a prior report), so pressing the button again after a
 *  fix ships doubles as a before/after record. Returns { ok, path } or { ok:false, reason }. */
export async function uploadDeviceReport(report) {
  try {
    const boot = await getStatsApp();
    if (!boot) return { ok: false, reason: 'offline or Firebase unavailable' };
    const { db, api } = boot;
    const listRef = api.ref(db, 'deviceReports/' + report.deviceId);
    const newRef = api.push(listRef, report);
    await newRef;
    return { ok: true, path: 'deviceReports/' + report.deviceId + '/' + newRef.key };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

export default { gatherDeviceReport, uploadDeviceReport };
