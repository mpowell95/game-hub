// js/admin-config.js - the REMOTE ADMIN CONFIG: the small set of app-wide switches Matt can flip
// from inside the app instead of from a commit.
//
// WHY THIS EXISTS (2026-08-24, Matt: "I need an admin control page in the hub. I need to be able to
// make games admin only for testing and make them live. I need to be able to release specific
// skeeball machines too."). Both switches already existed - as SOURCE EDITS. Making a game
// admin-only meant adding `devOnly: true` to its js/hub.js entry, a GAME_META edit, a test-list
// edit, a CACHE bump and a deploy; Skeeball alone went through that cycle three times in three
// days (released 08-22, pulled back 08-23, re-released 08-24). Releasing a Skeeball machine early
// was not possible at all: a machine is opened by earning it, and the only bypass was the dev
// profile. This module moves both decisions to a value every device reads at load.
//
// THE SHAPE, at `adminConfig/v1` in the shared 'stats' Firebase app:
//
//   { games:    { pinball:  { live: true,  at: <ms>, by: '<deviceId>' } },
//     skeeball: { boards: { popongo: { open: true, at: <ms>, by: '<deviceId>' } } } }
//
// An ABSENT entry means "whatever the code says", which is the important half: this layer is an
// OVERRIDE of the source defaults, never a replacement for them. Clearing an override (the Default
// button on the admin page) writes null and the code default takes back over, so a config node that
// is wiped, unreachable or never written leaves the app behaving exactly as it does today.
//
// THE LAW (root CLAUDE.md): nothing here is player history. It touches no stats path, no profile,
// no players/ record, and the ONE local key it owns (`gamehub.adminConfig.v1`) is a CACHE of a
// remote value - rule 2's preference carve-out, the same class as theme or language. Two rules
// still bind and shaped the code:
//   - Rule 2, on the Skeeball half: releasing a machine is a READ-TIME `or` over the earned unlock
//     (`isUnlocked(...) || isBoardReleased(...)`). It never writes `sk.unlocked`, so nothing is
//     granted that was not earned, and - the part that matters - LOCKING A MACHINE BACK CANNOT TAKE
//     AN EARNED ONE AWAY. Someone who completed the objectives keeps the machine forever.
//   - Rule 6, on every write: each write is verified by a fresh re-read and reports failure loudly.
//     A switch that silently did not flip is exactly the "I flipped it and nothing happened" bug
//     this file would otherwise create.
//
// OFFLINE / FIRST PAINT: readers are SYNCHRONOUS reads of the localStorage cache, so the launcher
// never waits on the network to decide what to draw and a plane-mode device keeps the last known
// config. js/hub.js kicks refreshAdminConfig() once per load; when the fetched value differs from
// the cache it fires `gamehub:adminconfig` and the launcher re-renders in place.

import { statsId } from './game-stats.js';

/** The local cache of the remote config. A CACHE, not a source of truth: safe to lose. */
export const CACHE_KEY = 'gamehub.adminConfig.v1';
/** The remote node. Versioned so a future shape change never has to reinterpret this one. */
export const CONFIG_PATH = 'adminConfig/v1';
/** Fired on `window` when a refresh brought back something different from the cache. */
export const EVENT = 'gamehub:adminconfig';

// --- pure resolution (unit-tested headless by test-admin-config.mjs) ---------------------------

/** Coerce anything into the config shape, so every reader below can assume it. Never throws. */
export function normalizeConfig(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const games = (src.games && typeof src.games === 'object') ? src.games : {};
  const sk = (src.skeeball && typeof src.skeeball === 'object') ? src.skeeball : {};
  const boards = (sk.boards && typeof sk.boards === 'object') ? sk.boards : {};
  return { games, skeeball: { boards } };
}

/**
 * Is this game on the launcher for ordinary players?
 * @param {object} cfg   a normalized config
 * @param {string} id    the HUB registry id ('pinball', 'skeeball', ...)
 * @param {boolean} codeDefault  what js/hub.js's registry says (`!g.devOnly`)
 * @returns {boolean}
 */
export function resolveGameLive(cfg, id, codeDefault) {
  const row = normalizeConfig(cfg).games[id];
  if (row && typeof row.live === 'boolean') return row.live;
  return !!codeDefault;
}

/** The override on a game, or null when the code default is in force. */
export function gameOverride(cfg, id) {
  const row = normalizeConfig(cfg).games[id];
  return row && typeof row.live === 'boolean' ? row.live : null;
}

/**
 * Has this Skeeball machine been released to everyone by the admin? Callers OR this with the
 * player's own earned unlock - see the header: it never replaces the earned state, only adds to it.
 */
export function resolveBoardReleased(cfg, boardId) {
  const row = normalizeConfig(cfg).skeeball.boards[boardId];
  return !!(row && row.open === true);
}

/** The override on a machine, or null when nothing has been set. */
export function boardOverride(cfg, boardId) {
  const row = normalizeConfig(cfg).skeeball.boards[boardId];
  return row && typeof row.open === 'boolean' ? row.open : null;
}

// --- the local cache ---------------------------------------------------------------------------

let _mem = null;   // last value read/written this page load, so repeated reads cost nothing

/** The cached config, normalized. Synchronous, never throws, `{}`-shaped when there is nothing. */
export function readCachedConfig() {
  if (_mem) return _mem;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { raw = null; }
  _mem = normalizeConfig(raw);
  return _mem;
}

function writeCachedConfig(cfg) {
  _mem = normalizeConfig(cfg);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(_mem)); } catch { /* private mode: memory only */ }
  return _mem;
}

// --- what the rest of the app calls -------------------------------------------------------------

/** Is this hub game live for ordinary players? `codeDefault` is `!g.devOnly`. */
export function isGameLive(id, codeDefault) { return resolveGameLive(readCachedConfig(), id, codeDefault); }

/** Has this Skeeball machine been released to everyone? OR it with the earned unlock, never replace. */
export function isBoardReleased(boardId) { return resolveBoardReleased(readCachedConfig(), boardId); }

/** Subscribe to config changes (a refresh that actually changed something). Returns an unsubscribe. */
export function onAdminConfig(cb) {
  const h = () => { try { cb(readCachedConfig()); } catch (err) { console.error('[admin-config] listener failed', err); } };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// --- the network half ---------------------------------------------------------------------------

async function boot() {
  const { getStatsApp } = await import('./firebase-boot.js');
  return getStatsApp();
}

/**
 * Fetch the remote config and update the cache. Best effort: offline, unconfigured or failing, the
 * cached value simply stays in force (which is why every reader is a cache read). Fires EVENT only
 * when something actually changed, so a re-render is never triggered for nothing.
 * @returns {Promise<object|null>} the fresh config, or null when it could not be read
 */
export async function refreshAdminConfig() {
  try {
    const r = await boot();
    if (!r) return null;
    const { db, api } = r;
    const snap = await api.get(api.ref(db, CONFIG_PATH));
    const fresh = normalizeConfig(snap.exists() ? snap.val() : {});
    const before = JSON.stringify(readCachedConfig());
    writeCachedConfig(fresh);
    if (JSON.stringify(_mem) !== before) {
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: _mem })); } catch { /* no DOM: cache is still updated */ }
    }
    return _mem;
  } catch (err) {
    console.warn('[admin-config] could not read the remote config; the cached one stays in force', err);
    return null;
  }
}

// A DEV SERVER NEVER WRITES APP-WIDE CONFIG, for the same reason js/stats-net.js never writes
// player records from one: this node is shared by every device in the family, and a switch flipped
// while poking at localhost would go live for everyone. Same opt-in key as stats-net's, so a
// browser deliberately set up to talk to the real database gets both.
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed() {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  return false;
}

/** Thrown-free result shape shared by both writers: { ok, error }. */
function fail(msg) { console.error('[admin-config] ' + msg); return { ok: false, error: msg }; }

/**
 * Write one override and VERIFY IT LANDED by fresh re-read (THE LAW rule 6). `value === null`
 * clears the override and hands the decision back to the code default.
 * @param {string} path  a path under CONFIG_PATH, e.g. 'games/pinball'
 * @param {string} field 'live' or 'open'
 * @param {boolean|null} value
 */
async function writeOverride(path, field, value) {
  if (!writesAllowed()) {
    return fail(`write BLOCKED: this is a dev origin (${location.hostname}) and dev never writes the family's config. `
      + `To allow it in this browser: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  }
  const r = await boot();
  if (!r) return fail('write failed: Firebase is unreachable or unconfigured (are you offline?)');
  const { db, api } = r;
  const full = `${CONFIG_PATH}/${path}`;
  let by = '';
  try { by = statsId() || ''; } catch { by = ''; }
  const patch = value === null
    ? { [field]: null, at: null, by: null }
    : { [field]: !!value, at: Date.now(), by };
  try {
    await api.update(api.ref(db, full), patch);
  } catch (err) {
    return fail(`write to ${full} failed: ${(err && err.message) || err}`);
  }
  // Fresh re-read of the WHOLE node, not of the field we just wrote: it both verifies the write and
  // leaves the cache holding exactly what every other device will read.
  const fresh = await refreshAdminConfig();
  if (!fresh) return fail(`write to ${full} could not be verified (the re-read failed)`);
  const key = path.split('/').pop();
  const got = path.startsWith('games/') ? gameOverride(fresh, key) : boardOverride(fresh, key);
  const want = value === null ? null : !!value;
  if (got !== want) return fail(`write to ${full} did not take: wanted ${want}, re-read ${got}`);
  return { ok: true, config: fresh };
}

/**
 * Show or hide a game for ordinary players.
 * @param {string} id     hub registry id
 * @param {boolean|null} live  true = live for everyone, false = admin only (testing), null = code default
 */
export function setGameLive(id, live) { return writeOverride(`games/${id}`, 'live', live); }

/**
 * Release a Skeeball machine to everyone, or hand it back to its unlock.
 * @param {string} boardId  a boards.js machine id
 * @param {boolean|null} open  true = open for everyone, false/null = earn it (earned unlocks keep it)
 */
export function setBoardReleased(boardId, open) { return writeOverride(`skeeball/boards/${boardId}`, 'open', open); }

export default {
  CACHE_KEY, CONFIG_PATH, EVENT, normalizeConfig, resolveGameLive, gameOverride, resolveBoardReleased,
  boardOverride, readCachedConfig, isGameLive, isBoardReleased, onAdminConfig, refreshAdminConfig,
  setGameLive, setBoardReleased,
};
