// career-io.js : the ONE file in this game that touches `js/career-store.js` and
// `js/game-stats.js`. R15-A (docs/BASEBALL-3D-BUILD.md section 9).
//
// `baseball/js/engine/career.js` owns the RULES and is pure; this file owns the WRITES. Nothing
// here decides anything about a season: it takes a career state, wraps it in the store's document,
// saves it, pushes it, and makes the recorder calls `finishGame` told it to make. Keeping the two
// apart is what lets the whole career loop be played in node (test-baseball-career.mjs) without a
// localStorage or a Firebase anywhere near it.
//
// Design doc section 15 [Locked] is the contract:
//   - "Every at-bat writes locally. The remote push is coalesced, one in flight, latest state wins.
//      Always sent at game end and on app hide, verified by fresh re-read at game end."
//   - "The engine checkpoints locally at every pitch boundary, so a resume restores the count."
//   - "The local copy is not a cache. It is the offline source of truth and its own outbox."
//   - "Retire writes the history copy first, then clears the live document... Never clear first."
//
// THE LAW rule 6, no silent write failures: every function here either verifies its write or logs
// loudly at `console.error`/`console.warn`, and NOTHING here throws into a caller. A career that
// cannot reach Firebase keeps playing locally, which is the designed state until
// `database.rules.json`'s `careers` branch is published by hand.

import {
  CAREER_SCHEMA_V, HEALTH_OK, HEALTH_DENIED, HEALTH_OFFLINE_LOCAL, HEALTH_FORK,
  mintCareerId, newCareerDoc, loadLocalCareer, saveLocalCareer,
  pullCareer, pushCareer, retireCareer, careerSyncHealth, validateCareer,
} from '../../js/career-store.js';
import {
  recordBaseball, recordBaseballCareerStarted, setBaseballHand,
} from '../../js/game-stats.js';
import { myCode } from '../../js/messages.js';
import { RULES_V } from './engine/settings.js';
import { newCareer, validateState, historyRow } from './engine/career.js';

export { HEALTH_OK, HEALTH_DENIED, HEALTH_OFFLINE_LOCAL, HEALTH_FORK, careerSyncHealth };

/** The document currently in effect on this device, held so a save does not have to re-read the
 *  store to learn its own `careerId`/`seq`. Always refreshed from `loadLocalCareer()`'s own return
 *  value, never trusted past a save. */
let _doc = null;

function wrap(doc, state, now) {
  return { ...doc, state, updatedAt: Number.isFinite(now) ? now : Date.now() };
}

/** Save `state` into the local document and return the saved document, or null if there is no
 *  career document to save into. Local only: `saveLocalCareer` bumps `seq`, which is what makes
 *  `reconcile` read this device as ahead of the remote until a push agrees. */
function saveLocal(state) {
  const doc = _doc || loadLocalCareer();
  if (!doc) {
    console.warn('[career-io] no local career document to save into; nothing written');
    return null;
  }
  const saved = saveLocalCareer(wrap(doc, state));
  if (!saved || saved.seq <= doc.seq) {
    console.error('[career-io] the local career save did not advance seq', { was: doc.seq, now: saved && saved.seq });
  }
  _doc = saved;
  return saved;
}

/**
 * Load this device's career: the local copy first (the offline source of truth, doc section 15),
 * then `pullCareer()` which reconciles against the remote under the store's own deadline
 * (`CAREER_PULL_TIMEOUT_MS`, the same 2.5s the service worker gives a network-first request).
 *
 * @returns {Promise<null | { doc, state, health }>} null when this device has no career at all.
 *   A document whose `state` fails `validateState` is REJECTED WHOLE rather than half-loaded, and
 *   says so loudly - the local copy is left exactly as it is so a later build can still read it
 *   (THE LAW rules 1 and 5: nothing is deleted because today's code could not parse it).
 */
export async function loadCareer() {
  let doc = loadLocalCareer();
  try {
    const pulled = await pullCareer();
    if (pulled) doc = pulled;
  } catch (err) {
    console.error('[career-io] pullCareer threw; falling back to the local career', err);
  }
  if (!doc) { _doc = null; return null; }
  const errs = validateState(doc.state);
  if (errs.length) {
    console.error('[career-io] the stored career state is not valid and was NOT loaded (nothing was deleted)', errs);
    _doc = null;
    return null;
  }
  _doc = doc;
  return { doc, state: doc.state, health: careerSyncHealth() };
}

/**
 * Start a brand new career from a finished build (R14's player screen).
 *
 * Three writes, in this order: the hand is put on record ONCE (doc section 6, [Locked]: "Pick L or
 * R once per player, not per career" - `setBaseballHand` itself refuses to overwrite an existing
 * one and says so), `careersStarted` is bumped, and the document is minted and saved locally, then
 * pushed. The push may well be denied (the `careers` rules branch is published by hand); that is
 * recorded in sync health and the career plays locally regardless.
 *
 * @param {{ hand:'L'|'R', presetId:string, skills:object, now?:number }} build
 * @returns {Promise<{ doc, state } | null>}
 */
export async function startCareer(build) {
  const code = myCode();
  if (!code) {
    console.error('[career-io] no player code on this device; a career cannot be started');
    return null;
  }
  const now = Number.isFinite(build && build.now) ? build.now : Date.now();
  // The stored hand always wins if one is already on record: this returns what is NOW on record,
  // whether that is the hand just asked for or one chosen long ago on another career.
  const stored = setBaseballHand(build.hand);
  const hand = (stored && stored.v) || build.hand;
  const careerId = mintCareerId(code, now);
  const state = newCareer({ hand, presetId: build.presetId, skills: build.skills, now, careerId });
  const errs = validateState(state);
  if (errs.length) {
    console.error('[career-io] refusing to start a career from an invalid state', errs);
    return null;
  }
  const doc = newCareerDoc({ careerId, state, rulesV: RULES_V, now, code });
  _doc = saveLocalCareer(doc);
  if (!_doc || !validateCareer(_doc)) {
    console.error('[career-io] the new career document did not save locally', { careerId });
    return null;
  }
  recordBaseballCareerStarted();
  await push('startCareer');
  return { doc: _doc, state };
}

/** Every pitch boundary. LOCAL ONLY, no network (doc section 15: the push cadence is per at-bat,
 *  not per pitch - a pitch-rate push would be a request every two seconds). */
export function saveCheckpoint(state) {
  return saveLocal(state);
}

/** Every at-bat end. Local, then a coalesced push (one in flight, latest state wins - the store's
 *  own `pushCareer` does the coalescing). Deliberately NOT awaited by the caller: an at-bat must
 *  not wait on a network round trip. */
export function saveAtBat(state) {
  const saved = saveLocal(state);
  if (saved) push('saveAtBat');
  return saved;
}

/** Game end. Local, then an AWAITED push, then the store's own health is read back: doc section 15,
 *  [Locked], "always sent at game end... verified by fresh re-read at game end". `pushCareer` does
 *  the re-read itself (it re-writes `baseSeq` only after the set resolved and records health); this
 *  reports what that verification concluded rather than assuming it. */
export async function saveGameEnd(state) {
  const saved = saveLocal(state);
  if (!saved) return { saved: null, pushed: false, health: careerSyncHealth() };
  const pushed = await push('saveGameEnd');
  const health = careerSyncHealth();
  if (!pushed) {
    console.warn('[career-io] the game-end push did not land; the career is saved on this device only', health);
  }
  return { saved, pushed, health };
}

async function push(who) {
  try {
    const ok = await pushCareer();
    if (!ok) console.warn(`[career-io] ${who}: pushCareer reported no write`, careerSyncHealth());
    return !!ok;
  } catch (err) {
    console.error(`[career-io] ${who}: pushCareer threw`, err);
    return false;
  }
}

/**
 * Record ONE finished game. `record` is `finishGame`'s own `{ league, won, extras }` - the caller
 * makes this call exactly once per game and never builds an extras object itself.
 * `js/game-stats.js`'s own idempotency contract: a recorder never de-duplicates.
 *
 * The season's `seasons: 1` and `trophy` ride on the final game's own call (career.js's
 * `finishGame`), so a season is never a second, separate recorder call that could be lost between
 * the two.
 */
export function recordGameResult(record) {
  if (!record || !record.league) {
    console.error('[career-io] recordGameResult called with no record; nothing written');
    return null;
  }
  const st = recordBaseball(record.league, record.won, record.extras || {});
  if (!st) {
    // recordBaseball returns null ONLY when the rate gate refused it ("No human plays this fast").
    console.error('[career-io] recordBaseball refused this result; it was NOT counted', record);
  }
  return st;
}

/**
 * Retire the career: build the FROZEN history row and hand it to the store's `retireCareer`, which
 * writes `history/<careerId>` and nulls `live` in ONE multi-path update, re-reads to verify both
 * landed, clears the local copy only then, and only then folds the row into `bb.history` through
 * `recordBaseballCareerFinished`. History first, live second, local last - never the other way
 * round (doc section 15, [Locked]).
 *
 * A failed retire changes nothing: the career is still there, still playable, and the health state
 * says why.
 * @returns {Promise<{ ok:boolean, row:object, health:object }>}
 */
export async function retire(state, now) {
  const row = historyRow(state, Number.isFinite(now) ? now : Date.now());
  let ok = false;
  try {
    ok = await retireCareer(row);
  } catch (err) {
    console.error('[career-io] retireCareer threw', err);
  }
  if (ok) _doc = null;
  else console.error('[career-io] the career was NOT retired; nothing was cleared', careerSyncHealth());
  return { ok, row, health: careerSyncHealth() };
}

// --- app-hide push --------------------------------------------------------------------------------
//
// doc section 15, [Locked]: the push is "always sent at game end and on app hide". `pagehide` is
// the one event that fires reliably on a mobile browser being backgrounded or killed; a hidden
// `visibilitychange` catches the tab-switch case that does not fire `pagehide` at all. Installed by
// ui.js's `init()` and removed by its `destroy()` - the hub reuses the same container for the next
// game, so a leaked listener would keep pushing a career nobody is playing.

let _lifecycleOn = false;

function onPageHide() { push('pagehide'); }
function onVisibility() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') push('visibilitychange');
}

export function installLifecycle() {
  if (_lifecycleOn || typeof window === 'undefined') return;
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  _lifecycleOn = true;
}

export function uninstallLifecycle() {
  if (!_lifecycleOn || typeof window === 'undefined') return;
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', onVisibility);
  _lifecycleOn = false;
}

export default {
  CAREER_SCHEMA_V,
  loadCareer, startCareer, saveCheckpoint, saveAtBat, saveGameEnd, recordGameResult, retire,
  installLifecycle, uninstallLifecycle, careerSyncHealth,
};
