// js/live-leave.js - LEAVING A LIVE ROOM (second pass, 2026-10-29; docs/INTEGRITY-CHECKS-SPEC.md,
// "Holes closed 2026-10-29 (second pass): leaving live rooms, quitting once dealt").
//
// Before this, leaving a live room mid-game recorded nothing for either side, so a player about to
// lose simply left. Now, in every live-room game, the Battle Arena way:
//
//   - LEAVE after your own first move of the game in play (the in-game Leave, the hub's back arrow
//     after its confirm) = YOUR LOSS, recorded at once through the game's own recorder ('mp' bucket)
//     plus head-to-head, and the room ends with `forfeit/<seat>` written in the SAME update as
//     `status: 'ended'` (js/net.js leaveRoom's optional third argument). The other phone sees it and
//     records ITS WIN (2 seats). At 3-4 seats (Chinchon, Escoba) the table ends (the engines cannot
//     drop a seat mid-match) and only the leaver records: nobody else beat the table.
//   - CLOSING THE APP is not leaving: the game's 30-minute rejoin still works. But the loss is ARMED
//     the moment you move (js/game-stats.js armQuitLoss, marker `<statsId>@live`, recorder
//     `recordLiveResult`), so a page that never comes back records it: the game's next mount, or the
//     hub after 30 minutes (settleQuitLosses). A page that is alive keeps the marker fresh.
//   - GONE 90 SECONDS (no heartbeat, CLAIM_MS): the other player sees "Claim win". It records their
//     win and ends the room with a claimed forfeit for the absent seat, whose phone records the loss
//     when it comes back (or its marker does). A claim is offered only once the absent player has
//     moved in that game; before that, leaving is free for the one still there.
//   - ONE RESULT PER GAME: every result decided here goes through `recordLiveResult`, once per
//     `<statsId>:<room>:<game number>` (`gamehub.liveCounted.v1`), and a game that ends normally is
//     listed there too (`endedNormally`), so a late forfeit adds nothing.
//
// Nothing here reads or rewrites a stored result (THE LAW rule 2): it only chooses whether a NEW
// result is written. Words on screen: the fewest (root CLAUDE.md), EN + ES below.

import {
  armQuitLoss, dropQuitLoss, takeQuitLoss, touchQuitLoss, quitLossInfo, releaseQuitLoss,
  recordLiveResult, liveCounted, markLiveCounted,
} from './game-stats.js';
import { makeT } from './i18n.js';

export const CLAIM_MS = 90 * 1000;

export const STRINGS = {
  en: {
    ll_claim: 'Claim win',
    ll_left_win: '{name} left. You win.',
    ll_left: '{name} left.',
    ll_claimed: 'You win.',
    ll_lost: '{name} claimed the win.',
    ll_leave_loss: 'Leave? Counts as a loss.',
  },
  es: {
    ll_claim: 'Reclamar victoria',
    ll_left_win: '{name} se fue. Ganas.',
    ll_left: '{name} se fue.',
    ll_claimed: 'Ganas.',
    ll_lost: '{name} reclamó la victoria.',
    ll_leave_loss: '¿Salir? Cuenta como derrota.',
  },
};
export const lt = makeT(STRINGS);

const marker = (statsId) => `${statsId}@live`;

/** The ledger key of one game in one room: `<statsId>:<room code>:<game number>`. */
export function liveKey(statsId, code, n) { return `${statsId}:${String(code || '')}:${n | 0}`; }

/** This player has moved in game `key`: from now on leaving is their loss, recorded as
 *  `<fn>(...lossArgs)` plus head-to-head against each of `opps` ({ deviceId, name }). Call on every
 *  own move (it refreshes the arguments and the time). Nothing if that game is already counted. */
export function armLeave(statsId, key, fn, lossArgs, opps, tag) {
  if (!key || liveCounted(key)) return;
  const cleanOpps = (Array.isArray(opps) ? opps : []).filter((o) => o && o.deviceId)
    .map((o) => ({ deviceId: String(o.deviceId), name: String(o.name || '') }));
  // `tag` (game-stats.js modeTag, 2026-10-30): the match's mode, recorded with the result.
  armQuitLoss(marker(statsId), 'recordLiveResult', [key, statsId, fn, Array.from(lossArgs || []), cleanOpps, false, tag || null]);
}

/** The game key the armed leave belongs to, or null. */
export function armedKey(statsId) {
  const m = quitLossInfo(marker(statsId));
  return m && Array.isArray(m.a) ? String(m.a[0] || '') || null : null;
}

/** Is leaving game `key` now a loss for this player? */
export function leaveCosts(statsId, key) { return !!key && armedKey(statsId) === key && !liveCounted(key); }

/** A page picked game `key` back up (a rejoin): keep its armed leave fresh. A marker left by ANOTHER
 *  game (a match that died with its page and was never rejoined) is that game's loss, taken now. */
export function resumeLeave(statsId, key) {
  const k = armedKey(statsId);
  if (!k) return;
  if (k === key) { touchQuitLoss(marker(statsId)); return; }
  takeQuitLoss(marker(statsId));
}

/** A mount with no game to rejoin: any armed leave belongs to a game that died with its page. */
export function settleLeave(statsId) { if (armedKey(statsId)) takeQuitLoss(marker(statsId)); }

/** Record the armed loss now (the player is leaving). True when a loss was recorded. */
export function forfeitNow(statsId) { return takeQuitLoss(marker(statsId)); }

/** The game was put away with the match still on (destroy: closing the game is not leaving). The
 *  marker stays armed for the rejoin; this page just stops refreshing it. */
export function detachLeave(statsId) { releaseQuitLoss(marker(statsId)); }

/** Forget the armed leave without recording (the game ended some other way). */
export function disarmLeave(statsId) { dropQuitLoss(marker(statsId)); }

/** The game ended normally and its result was recorded: list it, so a late forfeit adds nothing. */
export function endedNormally(statsId, key) { if (key) markLiveCounted(key); disarmLeave(statsId); }

/** Was game `key` already decided by a leave on this phone? (Then the normal result must not count.) */
export function alreadyCounted(key) { return !!key && liveCounted(key); }

/** Record this player's WIN decided by a leave (the other left, or a claim), once. */
export function recordLeaveWin(statsId, key, fn, winArgs, opps, tag) {
  disarmLeave(statsId);
  const cleanOpps = (Array.isArray(opps) ? opps : []).filter((o) => o && o.deviceId);
  return recordLiveResult(key, statsId, fn, winArgs, cleanOpps, true, tag || null);
}

/** The forfeits written into a room for game `n`: [{ seat, n, at, claim }]. */
export function forfeitsOf(room, n) {
  const f = room && room.forfeit;
  if (!f || typeof f !== 'object') return [];
  return Object.keys(f).map((k) => f[k]).filter((x) => x && x.seat != null && (n == null || (x.n | 0) === (n | 0)));
}

/** Seat keys compare as strings ('host' / 'guest' / 0..7). */
const sameSeat = (a, b) => String(a) === String(b);

/**
 * The room ended (`status: 'ended'`) while game `key` (number `n`) was in play. Decides this phone's
 * result: 'won' (the other player left or was claimed against, 2 seats: the win is recorded here),
 * 'lost' (someone claimed against THIS seat: the armed loss is recorded), or 'none' (a plain leave
 * from an older build, a leave before anyone's first move, or a 3-4 seat table: nothing recorded).
 *   o = { statsId, key, n, mySeat, seats (2 by default), fn, winArgs, opps }
 */
export function onRoomEnded(room, o) {
  const list = forfeitsOf(room, o.n);
  if (list.some((x) => sameSeat(x.seat, o.mySeat))) {
    return forfeitNow(o.statsId) ? 'lost' : (disarmLeave(o.statsId), 'none');
  }
  if (list.length && (o.seats || 2) === 2) {
    recordLeaveWin(o.statsId, o.key, o.fn, o.winArgs, o.opps);
    return 'won';
  }
  disarmLeave(o.statsId);
  return 'none';
}

/** How long a seat record has been silent (no heartbeat), in ms; 0 with no record. */
export function awayMs(rec, now = Date.now()) {
  return rec && rec.lastSeen ? Math.max(0, now - rec.lastSeen) : 0;
}

/** Leave the room, writing the forfeit for `seat` in the same update as the end. */
export function leaveWithForfeit(net, code, role, seat, n, claim) {
  const f = { seat, n: n | 0, at: Date.now() };
  if (claim) f.claim = true;
  return Promise.resolve().then(() => net.leaveRoom(code, role, f));
}

/**
 * Before a page rejoins game `o.key` from its save: was it decided while this phone was away?
 *   - the hub already settled this phone's armed leave (30 minutes away): the match is lost here,
 *     so the room is left with this seat's forfeit (the other phone records its win);
 *   - the room ended: `onRoomEnded` decides this phone's result;
 *   - the room is gone: the armed loss stands.
 * Resolves { go: true } to rejoin as before (also when the room cannot be read: offline), or
 * { go: false, res: 'won' | 'lost' | 'none', room } when nothing is left to rejoin.
 *   o = { statsId, key, n, mySeat, role, seats, fn, winArgs, oppsOf(room) -> [{ deviceId, name }] }
 */
export async function checkRejoin(net, code, o) {
  if (alreadyCounted(o.key)) {
    disarmLeave(o.statsId);
    try { await leaveWithForfeit(net, code, o.role, o.mySeat, o.n); } catch { /* best-effort */ }
    return { go: false, res: 'lost', room: null };
  }
  let r = { error: 'offline' };
  try { if (net && typeof net.readRoom === 'function') r = await net.readRoom(code); } catch { /* offline */ }
  if (r.error) return { go: true };
  const room = r.room;
  if (!room) { settleLeave(o.statsId); return { go: false, res: 'none', room: null }; }
  if (room.status === 'ended') {
    const opps = typeof o.oppsOf === 'function' ? o.oppsOf(room) : (o.opps || []);
    return { go: false, res: onRoomEnded(room, { ...o, opps }), room };
  }
  resumeLeave(o.statsId, o.key);
  return { go: true, room };
}

// --- the "Claim win" button: one small pill, added to the game's root, no game CSS needed ---------
export function showClaim(root, onClaim) {
  if (!root || typeof document === 'undefined') return;
  let b = root.querySelector('.gh-live-claim');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.className = 'gh-btn gh-btn-primary gh-live-claim';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:60;touch-action:manipulation;';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideClaim(root); try { b._onClaim && b._onClaim(); } catch (err) { console.error('[live-leave] claim failed', err); } });
    root.appendChild(b);
  }
  b.textContent = lt('ll_claim');
  b._onClaim = onClaim;
}
export function hideClaim(root) {
  const b = root && root.querySelector && root.querySelector('.gh-live-claim');
  if (b) b.remove();
}

export default {
  CLAIM_MS, STRINGS, lt, liveKey, armLeave, armedKey, leaveCosts, resumeLeave, settleLeave, forfeitNow,
  detachLeave, disarmLeave, endedNormally, alreadyCounted, recordLeaveWin, forfeitsOf, onRoomEnded, awayMs,
  leaveWithForfeit, checkRejoin, showClaim, hideClaim,
};
