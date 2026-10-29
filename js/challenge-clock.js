// js/challenge-clock.js - THE SERVER'S CLOCK for turn-by-turn challenges (2026-10-29, second pass).
//
// The first pass of "7 days, then forfeit" (js/challenge-life.js) trusted the phone clock twice:
//   1. every move's `at` and the match's `updated` were stamped with Date.now(), so a player who set
//      the phone's date back 8 days before moving made the opponent forfeit at once;
//   2. whether a match had timed out was decided with Date.now(), so a player who set the date 8 days
//      FORWARD saw the opponent time out and the win was counted.
// This module is the one place every challenge game's mp.js asks instead:
//   stampFor(api)   the value a write stores as "now": Firebase's serverTimestamp() (the SERVER fills it
//                   in, and database.rules.json refuses a new move whose `at` is anything else). Only an
//                   in-memory test database without one gets Date.now().
//   decideNow()     the time to decide expiry and timeouts with: the server's time measured on this
//                   page's connection (js/server-time.js liveNow), else bestNow() (the last measured
//                   gap, else the phone). Display only when it is not live.
//   liveTime(api)   the LIVE server time, waiting up to LIVE_WAIT_MS for the connection to measure it, or
//                   null. Writers call it before re-reading the match, so "has it timed out / expired"
//                   is decided on the server's clock at the moment of the move.
//   withTimeout bookkeeping (noteTimeout / timeoutUnsure): a timeout derived WITHOUT live server time
//                   is shown but never counted (each game's countResult asks timeoutUnsure).
//   queueConfirm    a timeout seen on an index row is counted only after the MATCH is re-read and the
//                   timeout confirmed against live server time (rows are written by phones and can lag
//                   or lie; the match decides).
// It also hands js/game-stats.js the server's clock for each storage's "counting since" stamp.
import { liveNow, serverNow, bestNow, whenLive } from './server-time.js';
import { setTrustedClock } from './game-stats.js';
import { TIMEOUT } from './challenge-life.js';

setTrustedClock(() => serverNow());

let LIVE_WAIT_MS = 4000;
/** Tests only: how long liveTime / queueConfirm wait for a connection to measure the server's time. */
export function __setLiveWaitForTest(ms) { LIVE_WAIT_MS = Math.max(0, +ms || 0); }

/** What a write stores as "now": the server fills it in. */
export function stampFor(api) {
  return api && typeof api.serverTimestamp === 'function' ? api.serverTimestamp() : Date.now();
}

/** { now, live }: the time to decide with, and whether it is this page's live server time. */
export function clockNow() {
  const l = liveNow();
  return l != null ? { now: l, live: true } : { now: bestNow(), live: false };
}
export const decideNow = () => clockNow().now;

/** The live server time, or null. Waits for a connection only on a real database (one that can stamp
 *  server time); an in-memory test database answers at once. */
export async function liveTime(api, waitMs = LIVE_WAIT_MS) {
  const l = liveNow();
  if (l != null) return l;
  if (!api || typeof api.serverTimestamp !== 'function') return null;
  return whenLive(waitMs);
}

// --- timeouts derived without live server time: shown, never counted --------------------------------
const _unsure = new Set();
const key = (node, id) => `${node}/${id}`;
/** Called by each game's withTimeout whenever it derives a timeout for match `id`. */
export function noteTimeout(node, id, live) {
  if (!id) return;
  if (live) _unsure.delete(key(node, id)); else _unsure.add(key(node, id));
}
/** True when this page's latest look at that match decided a timeout without live server time. */
export const timeoutUnsure = (node, id) => _unsure.has(key(node, id));

// --- counting a timeout seen on an index row: re-read the match first --------------------------------
const _chains = new Map();
/**
 * Queue the timed-out `rows` (each game's rowsFromIndex marks them `why: 'timeout'`) for counting:
 * each match is re-read (`read(id)`, the game's readGame, which re-derives the timeout) once live
 * server time is known, and `count(row, game)` is called only when the MATCH confirms the timeout with
 * live time. With no live time nothing is counted (a later list read asks again; nothing is marked).
 * Runs one at a time per game. Returns the promise of how many were counted.
 */
export function queueConfirm(node, rows, read, count) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && r.why === TIMEOUT);
  const prev = _chains.get(node) || Promise.resolve(0);
  const next = prev.catch(() => 0).then(async () => {
    if (!list.length) return 0;
    const live = liveNow() != null ? liveNow() : await whenLive(LIVE_WAIT_MS);
    if (live == null) return 0;
    let n = 0;
    for (const r of list) {
      try {
        const g = await read(r.id);
        if (!g || !g.over || g.over.why !== TIMEOUT || timeoutUnsure(node, r.id)) continue;
        if (count(r, g)) n++;
      } catch (err) { console.warn(`[${node}] could not confirm a timeout`, err); }
    }
    return n;
  });
  _chains.set(node, next);
  return next;
}
/** Resolves once every queued confirmation for `node` has run (tests, and a screen that wants to know). */
export function confirmsSettled(node) { return _chains.get(node) || Promise.resolve(0); }
