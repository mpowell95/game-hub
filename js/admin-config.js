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
//   { games:    { pinball:  { live: true, at: <ms>, by: '<deviceId>' } },
//     skeeball: { boards: { popongo: { open: false, testing: false, at: <ms>, by: '<deviceId>' } } } }
//
// A Skeeball machine has THREE states, not two (Matt, 2026-08-24, on the first version of this
// page: "this doesn't allow me to select which skeeball machines are live and can be unlocked and
// played vs what is not able to be played yet"). The two fields encode them together:
//
//   open: true                 OPEN      playable by everyone right now, no unlock needed
//   open: false, testing:false UNLOCKABLE live, earned the normal way (its goals or score)
//   testing: true              TESTING   not playable yet; only a dev profile can open it
//
// `testing` overrides boards.js's `adminOnly` flag, the same way `live` overrides a game's
// `devOnly` - and it is the field the first version was missing, which is why "Earn it" could not
// actually make an adminOnly machine earnable.
//
// A THIRD branch, `corrections`, holds the admin's "those scores were thrown on a broken board and
// do not count" overlays, per player-device per machine:
//
//   corrections: { skeeball: { '<statsId>': { classic: { plays, points, best, bestThrow, upto,
//                                                        at, by, why } } } }
//
// It lives HERE, in the node phones never write, for the reason js/stats-corrections.js opens with:
// every device mirrors its whole local store over players/<id> on each hub load, so a correction
// made inside a player's own record is overwritten within minutes. This one cannot be. What it
// MEANS, and what it deliberately cannot do, is documented in js/stats-corrections.js.
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

// statsId is imported LAZILY, at its one call site, on purpose (2026-09-01).
//
// js/hub.js imports this module statically to decide which game tiles exist, so a static edge from
// here to game-stats.js put that file (91 KB) plus arcade-scores.js, firebase-boot.js and
// install-state.js on the hub's critical path - on every launch, for a value used exactly once, in
// the audit trail of an ADMIN WRITE that only Matt ever performs. Cutting js/hub.js's own
// stats-net.js import without cutting this one does nothing at all: the graph arrives anyway.
//
// GUARD: import it, do not re-implement it. statsId() is resolveStore().syncId - the identity core
// that test-stats-identity.mjs guards and that decides WHOSE stats a device is writing. A local
// copy of that logic is how two devices start disagreeing about who a player is.

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
  const corr = (src.corrections && typeof src.corrections === 'object') ? src.corrections : {};
  const skCorr = (corr.skeeball && typeof corr.skeeball === 'object') ? corr.skeeball : {};
  return { games, skeeball: { boards }, corrections: { skeeball: skCorr } };
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

/** The override on a machine's "open to everyone" field, or null when nothing has been set. */
export function boardOverride(cfg, boardId) {
  const row = normalizeConfig(cfg).skeeball.boards[boardId];
  return row && typeof row.open === 'boolean' ? row.open : null;
}

/**
 * Is this machine still in testing - not playable by anybody but a dev profile? The override sits
 * on top of boards.js's `adminOnly`, exactly as a game's `live` sits on top of `devOnly`.
 * @param {object} cfg
 * @param {string} boardId
 * @param {boolean} codeDefault  the machine's own `adminOnly` flag
 */
export function resolveBoardTesting(cfg, boardId, codeDefault) {
  const row = normalizeConfig(cfg).skeeball.boards[boardId];
  if (row && typeof row.testing === 'boolean') return row.testing;
  return !!codeDefault;
}

/** The override on a machine's testing field, or null when nothing has been set. */
export function boardTestingOverride(cfg, boardId) {
  const row = normalizeConfig(cfg).skeeball.boards[boardId];
  return row && typeof row.testing === 'boolean' ? row.testing : null;
}

/** Every score correction, as js/stats-corrections.js wants them: { skeeball: { <statsId>: {...} } }. */
export function resolveCorrections(cfg) { return normalizeConfig(cfg).corrections; }

/** One player-device's Skeeball corrections, or null. */
export function resolveBoardCorrections(cfg, statsIdOf) {
  const row = normalizeConfig(cfg).corrections.skeeball[statsIdOf];
  return row && typeof row === 'object' ? row : null;
}

/**
 * The one answer the admin page and the game both work from: 'open' | 'unlockable' | 'testing'.
 * Testing wins over open - a machine nobody may play yet cannot also be open to everyone, and
 * resolving it in one place stops the two fields from ever being read as a contradiction.
 */
export function resolveBoardMode(cfg, boardId, codeAdminOnly) {
  if (resolveBoardTesting(cfg, boardId, codeAdminOnly)) return 'testing';
  return resolveBoardReleased(cfg, boardId) ? 'open' : 'unlockable';
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

/** Is this machine still in testing (nobody but a dev profile may open it)? `codeDefault` is its
 *  own `adminOnly` flag from boards.js. */
export function isBoardTesting(boardId, codeDefault) {
  return resolveBoardTesting(readCachedConfig(), boardId, codeDefault);
}

/** 'open' | 'unlockable' | 'testing' for this machine, from the cache. */
export function boardMode(boardId, codeAdminOnly) {
  return resolveBoardMode(readCachedConfig(), boardId, codeAdminOnly);
}

/** Every score correction, from the cache. Synchronous, so a screen can apply it while painting. */
export function corrections() { return resolveCorrections(readCachedConfig()); }

/** This player-device's Skeeball corrections, from the cache. */
export function myBoardCorrections(statsIdOf) { return resolveBoardCorrections(readCachedConfig(), statsIdOf); }

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

// --- who is actually an admin -------------------------------------------------------------------
//
// Matt, 2026-09-01: "nobody else should see 'admin mode' as an option and especially should never
// see 'read all messages' or whatever."
//
// Every admin surface used to be gated on `isAdmin(profile.name)` - a hash of the PROFILE NAME.
// That name is printed on the leaderboard, so anyone in the family could read it off their own
// screen, type it into their profile, and be handed the Admin button and the read-all button. The
// database has refused them the actual threads since the rules landed, but the OPTION was there,
// and `adminConfig` is still `auth != null` for writes - so a renamed profile could flip games
// live or into testing for everybody.
//
// So the UI now asks the SAME QUESTION THE DATABASE ASKS: is this device's anonymous auth uid in
// `admins/`? That node is `".write": false` in database.rules.json - unreachable from any client,
// only editable in the Firebase console - so this cannot be faked by renaming, by editing
// localStorage, or by anything short of console access.
//
// `admins` is `".read": "auth != null"`, so a device is allowed to ask about itself. Reading
// another uid's row tells you nothing you can act on.
const ADMIN_DEVICE_KEY = 'gamehub.adminDevice.v1';
let _adminDevice = null;

/** Cached answer, SYNCHRONOUS, so a render never waits on the network (same shape as the config
 *  cache above). Unknown until the first successful read, and `false` is the safe default: a
 *  device that has never been able to ask simply does not show the controls. */
export function isAdminDevice() {
  if (_adminDevice !== null) return _adminDevice;
  try { _adminDevice = localStorage.getItem(ADMIN_DEVICE_KEY) === '1'; }
  catch { _adminDevice = false; }
  return _adminDevice;
}

/**
 * Ask the database whether THIS device is on the allowlist, and cache it. Called once per hub load
 * and by the profile page.
 *
 * A FAILED READ NEVER REVOKES a cached yes: offline, or with Firebase unreachable, Matt keeps the
 * controls he had on his own phone. A successful read that says no DOES clear it, so removing a
 * uid in the console really does take the buttons away on that device's next load.
 * @returns {Promise<boolean|null>} the fresh answer, or null when it could not be read
 */
export async function refreshAdminDevice() {
  try {
    const r = await boot();
    if (!r || !r.uid) return null;
    const { db, api } = r;
    const snap = await api.get(api.ref(db, 'admins/' + r.uid));
    const yes = snap.exists() && snap.val() === true;
    _adminDevice = yes;
    try { localStorage.setItem(ADMIN_DEVICE_KEY, yes ? '1' : '0'); } catch { /* memory only */ }
    return yes;
  } catch (err) {
    console.warn('[admin-config] could not read the admins allowlist; the cached answer stays', err);
    return null;
  }
}

/** This device's anonymous auth uid - the value that goes in `admins/`. Shown on the profile page
 *  so there is a way to BOOTSTRAP: a device that is not on the list yet has no admin UI at all, so
 *  without this there would be nowhere to read the id it needs to be granted. Harmless to show to
 *  anyone: it is an identifier, not a credential, and `admins` cannot be written from a client. */
export async function myAuthUid() {
  try { const r = await boot(); return (r && r.uid) || null; } catch { return null; }
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
 * Write one node's override fields and VERIFY THEY LANDED by fresh re-read (THE LAW rule 6).
 * A field whose value is `null` is CLEARED, handing that decision back to the code default.
 * @param {string} path    a path under CONFIG_PATH, e.g. 'games/pinball'
 * @param {object} fields  { field: boolean|null, ... } - written together, so a machine's two
 *                         fields can never land half-applied and read as a contradiction
 * @param {(cfg:object)=>boolean} verify  re-read check, run against the freshly fetched config
 */
async function writeNode(path, fields, verify) {
  if (!writesAllowed()) {
    return fail(`write BLOCKED: this is a dev origin (${location.hostname}) and dev never writes the family's config. `
      + `To allow it in this browser: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  }
  const r = await boot();
  if (!r) return fail('write failed: Firebase is unreachable or unconfigured (are you offline?)');
  const { db, api } = r;
  const full = `${CONFIG_PATH}/${path}`;
  const cleared = Object.keys(fields).every((k) => fields[k] === null);
  let by = '';
  try { by = (await import('./game-stats.js')).statsId() || ''; } catch { by = ''; }
  const patch = Object.assign({}, fields, cleared ? { at: null, by: null } : { at: Date.now(), by });
  try {
    await api.update(api.ref(db, full), patch);
  } catch (err) {
    return fail(`write to ${full} failed: ${(err && err.message) || err}`);
  }
  // Fresh re-read of the WHOLE node, not of the fields we just wrote: it both verifies the write
  // and leaves the cache holding exactly what every other device will read.
  const fresh = await refreshAdminConfig();
  if (!fresh) return fail(`write to ${full} could not be verified (the re-read failed)`);
  if (!verify(fresh)) return fail(`write to ${full} did not take: the re-read disagrees with what was sent`);
  return { ok: true, config: fresh };
}

/**
 * Show or hide a game for ordinary players.
 * @param {string} id     hub registry id
 * @param {boolean|null} live  true = live for everyone, false = admin only (testing), null = code default
 */
export function setGameLive(id, live) {
  const want = live === null ? null : !!live;
  return writeNode(`games/${id}`, { live: want }, (cfg) => gameOverride(cfg, id) === want);
}

/** The two stored fields behind each mode. `testing` wins on read, but both are always written
 *  explicitly so a mode change can never leave the previous mode's field behind. */
const MODE_FIELDS = {
  open:       { open: true,  testing: false },
  unlockable: { open: false, testing: false },
  testing:    { open: false, testing: true },
};

/**
 * Set a Skeeball machine's state - the three-way choice the admin page offers:
 *   'open'        playable by everyone right now, no unlock needed
 *   'unlockable'  live, earned the normal way (its goals or score)
 *   'testing'     not playable yet; only a dev profile can open it
 *   null          clear the override; boards.js's own `adminOnly` decides again
 *
 * Nothing here can un-earn a machine: `open` is ORed with the player's earned unlock at read time
 * and no path from this file writes `sk.unlocked` (THE LAW rule 2). Moving a machine to 'testing'
 * declines to HONOR an earned unlock while it is set, and honors it again the moment it is not.
 */
export function setBoardMode(boardId, mode) {
  const fields = mode === null ? { open: null, testing: null } : MODE_FIELDS[mode];
  if (!fields) return Promise.resolve(fail(`unknown machine mode "${mode}"`));
  return writeNode(`skeeball/boards/${boardId}`, fields, (cfg) => {
    if (mode === null) return boardOverride(cfg, boardId) === null && boardTestingOverride(cfg, boardId) === null;
    return boardOverride(cfg, boardId) === fields.open && boardTestingOverride(cfg, boardId) === fields.testing;
  });
}

/**
 * Void (or un-void) one player-device's scores on one machine.
 * @param {string} statsIdOf  the players/<id> key - a device+player, not a person
 * @param {string} boardId
 * @param {object|null} snapshot  js/stats-corrections.js's snapshotOf(board, day), or null to undo
 * @param {string} [why]  free text, stored for the record
 */
export function setSkeeballCorrection(statsIdOf, boardId, snapshot, why) {
  const path = `corrections/skeeball/${statsIdOf}/${boardId}`;
  const fields = snapshot === null
    ? { plays: null, points: null, best: null, bestThrow: null, upto: null, why: null }
    : {
      plays: snapshot.plays | 0, points: snapshot.points | 0, best: snapshot.best | 0,
      bestThrow: snapshot.bestThrow | 0, upto: String(snapshot.upto || ''), why: String(why || ''),
    };
  return writeNode(path, fields, (cfg) => {
    const got = resolveBoardCorrections(cfg, statsIdOf);
    const row = got && got[boardId];
    if (snapshot === null) return !row;
    return !!row && (row.plays | 0) === (snapshot.plays | 0) && (row.points | 0) === (snapshot.points | 0);
  });
}

export default {
  CACHE_KEY, CONFIG_PATH, EVENT, normalizeConfig, resolveGameLive, gameOverride, resolveBoardReleased,
  boardOverride, resolveBoardTesting, boardTestingOverride, resolveBoardMode, readCachedConfig,
  isGameLive, isBoardReleased, isBoardTesting, boardMode, onAdminConfig, refreshAdminConfig,
  setGameLive, setBoardMode, resolveCorrections, resolveBoardCorrections, corrections,
  myBoardCorrections, setSkeeballCorrection,
};
