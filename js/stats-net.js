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

import { statsId, statsKey, loadStats, rateReport, activityReport, GAMES } from './game-stats.js';
import { loadProfile } from './profile-store.js';
import { getStatsApp, perfReport } from './firebase-boot.js';
import { installState, appVersion } from './install-state.js';
import { loadSeen } from './announce.js';
import { hubReadReport } from './hub-messages.js';

let _db = null, _api = null;

/** Ensure the shared named Firebase app + anonymous auth are ready. Returns true only when usable. */
export async function init() {
  const r = await getStatsApp();
  if (!r) return false;
  _db = r.db; _api = r.api;
  return true;
}

// Sync health, recorded locally on EVERY attempt so a device that is silently failing to mirror can
// be diagnosed from the device itself (`syncHealth()` / the hub's stats screens) rather than only by
// noticing a missing row on someone else's leaderboard.
//
// This exists because the opposite happened: a player's history sat correct in their own localStorage
// and simply never reached players/<deviceId>, and because syncMyStats swallowed every failure in a
// bare `catch {}` (THE LAW rule 6, violated in the one place it mattered most) NOTHING anywhere
// reported it - not the device, not the hub, not the leaderboard. The first anyone knew was a person
// asking why they were not on the board. A sync that cannot fail loudly is a sync you cannot trust.
const SYNC_KEY = 'gamehub.syncHealth.v1';

// A DEV SERVER NEVER WRITES TO THE FAMILY'S DATABASE. Reads are fine and stay on - a leaderboard
// with no data in it cannot be checked - but nothing local may ever create or change a players/ or
// usernames/ record.
//
// This is not hypothetical. It has happened three times: test-visual.mjs's PLAY probes minted a
// throwaway "Visual Test" player on every run until 17 of them were deleted on 2026-08-22, and
// twice that same day a session verifying a change in a localhost preview seeded a profile, loaded
// the hub, and watched syncMyStats() mirror its scratch data straight onto the real leaderboard
// where Matt then found it. syncMyStats() sends loadStats() wholesale, so ANY local store becomes a
// public record on the next hub load. Cleaning up afterwards is not a fix - it depends on the
// person who made the mess noticing it.
//
// NOT COVERED, deliberately: a dev server reached over the LAN by IP (192.168.x, phone-to-laptop).
// Every incident so far has been localhost, and a hostname allowlist that tries to guess at private
// ranges is a worse trade than a short honest one.
//
// To test the sync itself, opt in per browser rather than editing this file:
//   localStorage.setItem('gamehub.devAllowSync.v1', '1')
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}
/** True when this page may write. Loud and recorded when it may not - a skipped write that says
 *  nothing is the exact shape of the bug THE LAW rule 6 exists for, even when the skip is wanted. */
export function writesAllowed(what) {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[stats-net] ${what} BLOCKED: this is a dev origin (${location.hostname}) and dev never writes to the family database. `
    + `Local play is still recorded on this device. To allow it in this browser: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}

function readSyncHealth() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null') || {}; } catch { return {}; }
}
function writeSyncHealth(patch) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(Object.assign(readSyncHealth(), patch))); }
  catch (err) { console.error('[stats-net] could not record sync health', err); }
}
/** Last known mirror state for THIS device: { ok, lastOkAt, lastErrAt, lastErr, localPlays, remotePlays }. */
export function syncHealth() { return readSyncHealth(); }

/** Total recorded plays in the local store, the number that must survive the trip to Firebase. */
function localPlayCount() {
  try {
    const st = loadStats();
    let n = 0;
    for (const g of Object.keys(st.games || {})) n += ((st.games[g] || {}).total || {}).played | 0;
    return n;
  } catch { return 0; }
}
function remotePlayCount(rec) {
  const games = (rec && rec.stats && rec.stats.games) || {};
  let n = 0;
  for (const g of Object.keys(games)) n += ((games[g] || {}).total || {}).played | 0;
  return n;
}

/** Mirror this device's profile + unified stats up to players/<deviceId>. Never throws, but never
 *  fails QUIETLY either: every failure path logs loudly and is recorded in syncHealth(). The write is
 *  verified by a fresh re-read, because a resolved promise is not proof the data landed. Idempotent -
 *  it mirrors the whole store every time, so any retry naturally repairs a previously failed sync. */

// --- DEVICE RESET: the device half -------------------------------------------------------------
//
// The server half is a delete of `players/<id>`; on its own it survives until this device's next
// hub load, because the mirror below sends `stats: loadStats()` - the WHOLE local store - and
// writes it straight back over that node. So the device has to drop its own copy first, and this
// is the only place that can guarantee the ordering: syncMyStats() is the single uploader, and
// this runs inside it, before the record is built.
//
// Why a STAMP compared against a local ack rather than a flag: a flag would clear this device on
// every load for ever, so the player could never build a new history. An ack means each stamp is
// acted on exactly once, and everything played afterwards is kept and synced normally.
//
// The full rationale, and Matt's explicit override of THE LAW that authorises it, are in
// js/admin-config.js's "DEVICE RESET" block. Read that before touching this.
const RESET_ACK_KEY = 'gamehub.statsResetAck.v1';

function readResetAck() {
  try { return +JSON.parse(localStorage.getItem(RESET_ACK_KEY) || '0') || 0; } catch { return 0; }
}

/**
 * Clear this device's stats store if it has been told to, and say whether it did.
 *
 * Deliberately narrow: it clears the ACTIVE player's stats store and nothing else. The profile,
 * the device id, every game's own settings key and any OTHER player's forked store on this same
 * phone are untouched - a reset is aimed at one person's history on one device, and a second
 * person who happens to play on the same laptop has nothing to do with it.
 *
 * Loud on both paths (rule 6's spirit, which outlives the override): a clear this size must never
 * be something you can only infer afterwards.
 */
export async function applyDeviceReset() {
  let at = 0;
  try {
    const { deviceResetAt } = await import('./admin-config.js');
    at = deviceResetAt(statsId()) | 0;
  } catch { return false; }
  if (!at) return false;
  if (at <= readResetAck()) return false;
  const key = statsKey();
  try {
    localStorage.removeItem(key);
    // Stamp the ack ONLY after the removal succeeded. Stamping first and failing to clear would
    // mark the reset done on a device that still holds everything, and it would re-upload on the
    // very next load with nothing left to trigger it again.
    localStorage.setItem(RESET_ACK_KEY, JSON.stringify(at));
    console.warn(`[stats-net] device reset ${new Date(at).toISOString()} applied: local stats store "${key}" cleared for players/${statsId()}.`);
    return true;
  } catch (err) {
    console.error('[stats-net] device reset FAILED to clear the local store; it will be retried on the next load.', err);
    return false;
  }
}

// SKIP A SYNC WITH NOTHING NEW (2026-10-22, Matt: "skip the sync when there's no new data"). Every
// open, switch-away and return to the launcher re-uploaded the whole record (up to ~43 KB) and read it
// back to verify (~90 KB a sync for a heavy player), and each one woke the server's leaderboard
// rebuild. The record minus its clock fields is fingerprinted; the same fingerprint as the last
// VERIFIED sync of this same node, under SYNC_HEARTBEAT_MS ago, sends nothing. A real change (a play,
// a profile edit, a new build) always syncs and verifies as before. The heartbeat keeps a phone that
// is only opened, never played, showing as seen at least twice a day. A report, not player data.
const SYNC_SIG_KEY = 'gamehub.syncSig.v1';
const SYNC_HEARTBEAT_MS = 12 * 60 * 60 * 1000;
export function syncSignature(rec) {
  // Only the two clocks that change on every sync are left out: the record's own updatedAt and the
  // announce report's `at`. Everything else, stats included, counts as a change.
  const s = JSON.stringify({ ...rec, updatedAt: null, announce: rec.announce ? { seen: rec.announce.seen } : null });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${s.length}:${h.toString(36)}`;
}
function readSyncSig() { try { return JSON.parse(localStorage.getItem(SYNC_SIG_KEY) || 'null'); } catch { return null; } }
function writeSyncSig(v) { try { localStorage.setItem(SYNC_SIG_KEY, JSON.stringify(v)); } catch { /* syncs next time */ } }

export async function syncMyStats() {
  // statsId(), not deviceId(): the node is per (device, player). For the device's owner the two are
  // the same string, so every record that already exists keeps its exact key; a SECOND person playing
  // on the same phone syncs to `players/<deviceId>-<CODE>` instead of overwriting the first person's
  // node (see game-stats.js's "WHOSE stats these are" block).
  const id = statsId();
  // BEFORE anything is read for upload: an admin may have told this device to clear itself, and
  // the mirror below would otherwise write the whole local store straight back over the node the
  // delete just emptied. See the DEVICE RESET block above.
  await applyDeviceReset();
  const localPlays = localPlayCount();
  if (!writesAllowed('syncMyStats')) {
    writeSyncHealth({ ok: false, lastErrAt: Date.now(), lastErr: 'dev-origin-blocked', localPlays });
    return false;
  }
  if (!(await init())) {
    // Not necessarily a bug (offline play is supported and expected), but it must be VISIBLE: while
    // this persists, this device's history exists nowhere but this device.
    console.error(`[stats-net] sync skipped: Firebase unavailable (offline or unconfigured). ${localPlays} local plays are NOT mirrored to players/${id}.`);
    writeSyncHealth({ ok: false, lastErrAt: Date.now(), lastErr: 'firebase-unavailable', localPlays });
    return false;
  }
  try {
    const prof = loadProfile() || {};
    const rec = {
      profile: {
        name: prof.name || '', emoji: prof.emoji || '', playerId: prof.playerId || '',
        message: prof.message || '', messageAt: +prof.messageAt || 0,
      },
      stats: loadStats(),
      // Is this person on the installed app or a browser tab? (2026-08-11, after Ana turned out to
      // have been in a Safari tab for two months.) ADDITIVE and diagnostic: a new child node, never
      // read by any gameplay or stats path, and it cannot affect a single counter. It rides the
      // existing mirror rather than getting its own write, so a device reports its route on the
      // same load/tab-hide/reconnect beats it already syncs on - no extra traffic, and every
      // device answers within one app open instead of only the ones that file a bug report.
      // ...plus WHICH BUILD they are on. The app auto-updates (sw.js skipWaiting + clients.claim),
      // so nobody should be more than one launch behind - but "should" is a guess, and this makes
      // it a fact. It also catches the one case an auto-reload could never fix: a device whose
      // shell install FAILED sits on an old build indefinitely and looks completely normal.
      device: Object.assign(installState(), { build: await appVersion() }),
      // WHICH LAUNCHER ANNOUNCEMENTS THIS DEVICE HAS DISMISSED (2026-09-09). Matt, releasing golf:
      // *"i want a way to see who has seen the popup too."* The seen-list is a local preference and
      // never left the phone, so "did everyone get told about the new game" had no answer anywhere.
      // Same shape of addition as `device` above and for the same reasons: a new child node, read
      // by no gameplay or stats path, riding the mirror this device already performs rather than
      // getting a write of its own. It is a REPORT, never a source - nothing reads it back, so a
      // wiped or stale copy cannot make a popup reappear or vanish on anybody's phone.
      announce: { seen: loadSeen(), at: Date.now() },
      // ANYTHING THIS DEVICE REFUSED FOR BEING TOO FAST TO BE REAL (2026-09-12). See
      // game-stats.js's "No human plays this fast". Same additive-diagnostic shape as the two
      // above: a child node no gameplay or stats path reads, riding the mirror this device
      // already performs. It is `null` (so the node stays absent) on every device that has never
      // tripped the gate, which is every honest one. It is a REPORT, never a source - nothing
      // reads it back, so it can never affect a counter on anybody's phone.
      rate: rateReport(),
      updatedAt: _api.serverTimestamp(),
    };
    // WHEN EACH GAME WAS PLAYED (2026-10-11): game-stats.js's activityReport(). Same additive
    // REPORT shape as `rate`, read by `read-activity.mjs` only. Omitted (never sent as null) while
    // this player has nothing local yet, so a fresh or cleared phone cannot blank what is there.
    const activity = activityReport();
    if (activity) rec.activity = activity;
    // WHICH GAME HUB MESSAGES THIS PHONE HAS OPENED, AND WHEN (2026-10-14, js/hub-messages.js).
    // Matt: "Make sure there's a way for me to tell if he's read it." Same additive REPORT shape:
    // read only by the admin page, never by a phone, and omitted while there is nothing to report.
    const hubRead = hubReadReport();
    if (hubRead) rec.hubMsgs = hubRead;
    // SLOW DATABASE READS ON THIS PHONE (2026-10-27, js/firebase-boot.js perfReport). Same additive
    // REPORT shape: read by no phone, omitted while there is nothing slow to report.
    const perf = perfReport();
    if (perf) rec.perf = perf;
    const sig = syncSignature(rec);
    const last = readSyncSig();
    if (last && last.id === id && last.sig === sig && Date.now() - (+last.at || 0) < SYNC_HEARTBEAT_MS) return true;   // nothing new
    await _api.update(_api.ref(_db, 'players/' + id), rec);
    // Verify by fresh re-read (THE LAW rule 6's reference pattern, as used by game-stats.js persist()).
    const snap = await _api.get(_api.ref(_db, 'players/' + id));
    const landed = snap && snap.exists() ? snap.val() : null;
    const remotePlays = remotePlayCount(landed);
    if (!landed || remotePlays < localPlays) {
      console.error(`[stats-net] sync VERIFY FAILED for players/${id}: ${localPlays} local plays, ${remotePlays} landed. History is still safe locally; it will retry on the next open or reconnect.`);
      writeSyncHealth({ ok: false, lastErrAt: Date.now(), lastErr: 'verify-short', localPlays, remotePlays });
      return false;
    }
    writeSyncHealth({ ok: true, lastOkAt: Date.now(), lastErr: '', localPlays, remotePlays });
    writeSyncSig({ id, sig, at: Date.now() });
    _playersMemo = null; _playersGen += 1;   // this device's record just changed: the next one-shot read goes to the server
    return true;
  } catch (err) {
    console.error(`[stats-net] sync FAILED for players/${id}: ${localPlays} local plays not mirrored. History is still safe locally; it will retry on the next open or reconnect.`, err);
    writeSyncHealth({ ok: false, lastErrAt: Date.now(), lastErr: String((err && err.message) || err), localPlays });
    return false;
  }
}

// ONE COPY OF players/ PER PAGE (2026-10-18). The Leaderboard, the Multiplayer screen's Records and
// the New message picker each downloaded the whole family's node, every time each was opened. Now
// the last successful read is kept in memory: a live watch paints from it at once and catches up,
// and a one-shot read reuses it for READ_REUSE_MS (or shares a read already in flight). Display
// only; nothing stored, nothing written. `{ fresh: true }` always goes to the server.
const READ_REUSE_MS = 60 * 1000;
let _playersMemo = null;          // { val, at }
let _playersRead = null;          // a read in flight
let _playersGen = 0;              // bumped by this device's own sync; an older read is not kept
function rememberPlayers(val, gen = _playersGen) { if (gen === _playersGen) _playersMemo = { val, at: Date.now() }; return copyOf(val); }
// Every caller gets its OWN copy (each used to get a fresh object per read), so one screen can never
// change what another is shown.
function copyOf(v) {
  try { return structuredClone(v); } catch { try { return JSON.parse(JSON.stringify(v)); } catch { return {}; } }
}

/** Live-watch every device's record (Admin Insights + Leaderboard). cb({deviceId: record}). Returns
 *  unsubscribe. Called first with the last copy read on this page, if any, then live. */
export async function watchPlayers(cb) {
  if (!(await init())) return () => {};
  let live = false;
  if (_playersMemo) {
    const val = _playersMemo.val;
    Promise.resolve().then(() => { if (!live) { try { cb(copyOf(val)); } catch (err) { console.warn('[stats-net] watchPlayers', err); } } });
  }
  try { return _api.onValue(_api.ref(_db, 'players'), (s) => { live = true; cb(rememberPlayers(s.val() || {})); }); }
  catch { return () => {}; }
}

/** One-shot read of every device record (for the Stats screen's cross-device aggregation). {} if offline. */
export async function readPlayersOnce({ fresh = false } = {}) {
  if (!(await init())) return {};
  if (!fresh && _playersMemo && Date.now() - _playersMemo.at < READ_REUSE_MS) return copyOf(_playersMemo.val);
  if (!fresh && _playersRead && _playersRead.gen === _playersGen) return _playersRead.then(copyOf);
  const gen = _playersGen;
  const read = (async () => {
    try { const s = await _api.get(_api.ref(_db, 'players')); return rememberPlayers(s.val() || {}, gen); }
    catch { return {}; }
  })();
  read.gen = gen;
  if (!fresh) { _playersRead = read; read.finally(() => { if (_playersRead === read) _playersRead = null; }); }
  return read;
}

/** THE SERVER-BUILT LEADERBOARD (2026-10-22, functions/boards.js). Each child of
 *  boards/v1/lb/people is ONE person's group as a JSON string: aggregatePlayers' own output minus
 *  game entries that are only the empty default, plus `_ids` (their device ids). This puts the
 *  empty games back in GAMES order, so the group is deep-equal to computing it on the phone
 *  (tools/test-boards.mjs). Returns { group, ids } or null for anything malformed. */
export function fillBoardGroup(json, defaults = {}) {
  let g;
  try { g = JSON.parse(json); } catch { return null; }
  if (!g || typeof g !== 'object' || !g.games || typeof g.games !== 'object') return null;
  const ids = Array.isArray(g._ids) ? g._ids.map(String) : [];
  let order = Array.isArray(g._g) ? g._g.map(String) : null;
  if (!order) { try { order = JSON.parse(defaults._order); } catch { order = null; } }
  if (!Array.isArray(order)) order = GAMES;
  delete g._ids; delete g._g;
  const fresh = (id) => { try { return JSON.parse(defaults[id]); } catch { return null; } };
  const games = {};
  for (const id of order) games[id] = g.games[id] || fresh(id) || { total: { played: 0, won: 0, lost: 0 }, byDiff: {} };
  for (const id of Object.keys(g.games)) if (!(id in games)) games[id] = g.games[id];
  g.games = games;
  return { group: g, ids };
}
/** boards/v1/lb/z -> { people, defaults }: base64, then gunzip (DecompressionStream: iOS 16.4+,
 *  every current Chrome). null when it cannot be undone here. */
export async function unpackBoard(b64) {
  if (typeof b64 !== 'string' || !b64 || typeof DecompressionStream === 'undefined') return null;
  try {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const v = JSON.parse(text);
    return v && typeof v === 'object' && v.people && typeof v.people === 'object' ? v : null;
  } catch { return null; }
}
/** { people, defaults } -> { list, idsByKey } (every person rebuilt by fillBoardGroup). */
export function boardList(parts) {
  const list = [], idsByKey = new Map();
  for (const k of Object.keys(parts.people)) {
    const r = fillBoardGroup(parts.people[k], parts.defaults || {});
    if (!r) continue;
    list.push(r.group);
    idsByKey.set(r.group.key, r.ids);
  }
  return { list, idsByKey };
}
/** The board, live: cb({ list, idsByKey }) each time the server republishes it (only when a number
 *  changed). Resolves to the unsubscribe function, or null when there is no board yet, it cannot be
 *  read or unpacked: the caller then falls back to watchPlayers, as before. */
export async function watchBoard(cb) {
  if (!(await init())) return null;
  return new Promise((resolve) => {
    let first = true, off = () => {}, seq = 0;
    const done = (v) => { if (first) { first = false; resolve(v); } };
    try {
      off = _api.onValue(_api.ref(_db, 'boards/v1/lb/z'), async (s) => {
        const n = ++seq;
        const parts = await unpackBoard(s.val());
        if (n !== seq) return;                                   // a newer package already arrived
        if (!parts || !Object.keys(parts.people).length) { if (first) { off(); done(null); } return; }
        done(off);
        try { cb(boardList(parts)); } catch (err) { console.warn('[stats-net] watchBoard', err); }
      }, () => done(null));
    } catch { done(null); }
  });
}

/** The board once (not live), reused for READ_REUSE_MS like readPlayersOnce. null = no board. */
let _boardMemo = null;
export async function readBoardOnce() {
  if (!(await init())) return null;
  if (_boardMemo && Date.now() - _boardMemo.at < READ_REUSE_MS) return _boardMemo.val ? boardList(_boardMemo.val) : null;
  let parts = null;
  try { const s = await _api.get(_api.ref(_db, 'boards/v1/lb/z')); parts = await unpackBoard(s.val()); } catch { parts = null; }
  if (parts && !Object.keys(parts.people).length) parts = null;
  _boardMemo = { at: Date.now(), val: parts };
  return parts ? boardList(parts) : null;
}

/** THIS person's device ids on the board: the group holding this device, else the one with this
 *  player code. Always includes this device. */
function myGroupOn(board) {
  const sid = statsId(), code = String((loadProfile() || {}).playerId || '').trim().toUpperCase();
  return board.list.find((x) => (board.idsByKey.get(x.key) || []).includes(sid))
    || (code ? board.list.find((x) => x.playerId === code) : null) || null;
}
function myIdsOn(board) {
  const g = myGroupOn(board);
  const ids = new Set(g ? board.idsByKey.get(g.key) || [] : []);
  ids.add(statsId());
  return [...ids];
}

/** A players/-shaped map for the screens that need only THIS person's full records and everyone
 *  else's NAME (My Stats, Records, the Hold'em bank, Arrow Maze's leaders), 2026-10-22: this
 *  person's own devices read in full (a few KB each), every other device stood in by its person's
 *  name / emoji / code from the board (no stats). Every grouping question then answers as before,
 *  for a fraction of the download. No board: the whole players/ node, as before. */
export async function readPlayersForMe() {
  const board = await readBoardOnce();
  if (!board) return readPlayersOnce();
  const out = {};
  for (const g of board.list) {
    for (const id of board.idsByKey.get(g.key) || []) {
      out[id] = { profile: { name: g.name || '', emoji: g.emoji || '', playerId: g.playerId || '' }, updatedAt: g.updatedAt || 0, stats: {} };
    }
  }
  const ids = myIdsOn(board);
  const recs = await Promise.all(ids.map((id) => _api.get(_api.ref(_db, 'players/' + id)).then((s) => s.val()).catch(() => null)));
  ids.forEach((id, i) => { if (recs[i]) out[id] = recs[i]; });
  return out;
}

/** Everyone, already grouped by person and corrected (the board's list), for the screens that rank
 *  everybody (Hold'em's bank list, Skeeball's top records, the Messages contact list). null when
 *  there is no board: the caller keeps its own old read. `me` = this person's group key. */
export async function readPeople() {
  const board = await readBoardOnce();
  if (!board) return null;
  const me = myGroupOn(board);
  return { list: board.list, meKey: me ? me.key : '' };
}

/** THE "PICK A PERSON" READ (2026-10-22): the server's small directory/<CODE> = { name, emoji, at }
 *  (functions/index.js directoryBuild) instead of all of players/ (~940 KB on a phone signal), in
 *  the SAME shape readPlayersOnce returns ({ id: { profile, updatedAt } }), so every game's
 *  opponentsFrom works unchanged. No directory yet, or unreadable: the full read, as before. Names
 *  only; anything that needs stats (records, unlocks) still calls readPlayersOnce. */
let _dirMemo = null;
export async function readOpponentProfiles() {
  if (!(await init())) return {};
  if (_dirMemo && Date.now() - _dirMemo.at < READ_REUSE_MS) return copyOf(_dirMemo.val);
  let dir = null;
  try { const s = await _api.get(_api.ref(_db, 'directory')); dir = s.val(); } catch { dir = null; }
  if (!dir || typeof dir !== 'object' || !Object.keys(dir).length) return readPlayersOnce();
  const out = {};
  for (const code of Object.keys(dir)) {
    const d = dir[code] || {};
    out['dir:' + code] = { profile: { name: String(d.name || ''), emoji: String(d.emoji || ''), playerId: code }, updatedAt: +d.at || 0 };
  }
  _dirMemo = { at: Date.now(), val: out };
  return copyOf(out);
}

/** Who owns `code`: { name, emoji } from that player's most recently active NAMED device, or null.
 *  Linking a new device to a code adopts this, so a second phone inherits the player's real name
 *  instead of syncing the 'You' placeholder (which would rename the whole player on the board). */
export async function lookupCodeOwner(playerCode) {
  const want = (typeof playerCode === 'string' ? playerCode : '').trim().toUpperCase();
  if (!want) return null;
  const all = await readPlayersOnce({ fresh: true });
  let best = null, bestAt = -1;
  for (const id of Object.keys(all)) {
    const rec = all[id] || {}, p = rec.profile || {};
    const name = (typeof p.name === 'string' ? p.name : '').trim();
    if (!name || name.toLowerCase() === 'you') continue;                       // skip the placeholder
    if ((typeof p.playerId === 'string' ? p.playerId : '').trim().toUpperCase() !== want) continue;
    const at = +rec.updatedAt || 0;
    if (at >= bestAt) { bestAt = at; best = { name, emoji: p.emoji || '', message: p.message || '', messageAt: +p.messageAt || 0 }; }
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

/** Who reserved `name`: { code, at } (at = server ms of the claim, 0 if unknown), or null if free or
 *  unreachable. The name gate's "That's me" uses it (an iPhone's Home Screen app shares no storage
 *  with the Safari tab that just claimed the name). */
export async function usernameOwner(name) {
  const key = uname(name);
  if (!key || !(await init())) return null;
  try {
    const v = (await _api.get(_api.ref(_db, 'usernames/' + encodeKey(key)))).val();
    return (v && v.code) ? { code: String(v.code).toUpperCase(), at: +v.at || 0 } : null;
  } catch { return null; }
}

/** Claim `name` for myCode, releasing a previously-owned `prevName` (only if I owned it). Best-effort. */
export async function claimUsername(name, myCode, prevName) {
  if (!myCode || !writesAllowed('claimUsername') || !(await init())) return false;
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
  if (!key || !writesAllowed('adminReleaseUsername') || !(await init())) return false;
  try { await _api.remove(_api.ref(_db, 'usernames/' + encodeKey(key))); return true; }
  catch { return false; }
}

export default { init, syncMyStats, applyDeviceReset, syncHealth, watchPlayers, readPlayersOnce, usernameStatus, claimUsername, adminReleaseUsername, writesAllowed };
