// js/challenge-life.js - how a turn-by-turn CHALLENGE ends without being played out (2026-10-13).
//
// Matt: "Please implement a way to cancel sent challenge requests, and a way to resign/forfeit.
// Maybe challenges expire if they aren't accepted in 3 days?"
//
// Five games have turn-by-turn challenges, each with its own node and its own mp.js (Hoops, Skeeball,
// Cup Pong, Darts, Flick Soccer). They share nothing else, and this module keeps it that way: it is
// the few PURE words and numbers all five have to agree on, so the hub's Challenges screen and each
// game's own lists read an index row the same way. No storage, no network, no DOM.
//
// A challenge is OPEN until the person it was sent to plays their first move. While it is open:
//   - the sender can CANCEL it, and the receiver can DECLINE it. Either way it counts for nobody.
//   - it EXPIRES once it has waited ANSWER_MS on the receiver without an answer (only on a match
//     made from 2026-10-13, which carries `lapse: true`; an older one never expires, it can only be
//     cancelled or declined). Counts for nobody either. Nothing is written when one expires: every
//     phone works it out from the same stored time.
// Once the receiver has played, the only way out short of finishing is RESIGN (the other person wins).
//
// HOW AN ENDED-WITHOUT-A-RESULT ROW IS STORED, and why it says over:false. Each game's index row is
// watched by a deployed Cloud Function (functions/decide.js) that sends a push when a row turns over.
// Those functions predate this and do not know the word "cancelled": Hoops' would tell the other
// person "<you> won", Skeeball's "it's a tie". A change to functions/ is live only after Matt
// redeploys it by hand. So a cancelled, declined (or Skeeball-resigned) row is written with
// `over: false, yourTurn: false` and `ended: <why>`: no function sends anything for that shape, and
// every reader in the app turns it back into a finished row with `rowEnding` below. No push is sent
// for a cancel or a decline; the other person sees it in their list.
//
// Nothing is ever deleted (THE LAW). A cancelled match keeps its document, its log and both rows.

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** How long a challenge waits on its receiver before it expires: 3 days. Skeeball has used the same
 *  number for every turn since 2026-09-24 (skeeball/js/challenge.js EXPIRE_MS). */
export const ANSWER_MS = 3 * 24 * 60 * 60 * 1000;

/** The ways a challenge ends without anybody winning. The stored `over.why` / row `ended`. */
export const NO_RESULT = ['cancelled', 'declined', 'expired'];
export const isNoResult = (why) => NO_RESULT.includes(why);

/**
 * PURE. How a stored index row ended OUTSIDE play: 'cancelled' | 'declined' | 'expired' |
 * 'resign' (Skeeball only, see the header) | ''. `now` decides expiry from the row's own `expires`.
 */
export function rowEnding(r, now = Date.now()) {
  if (!r || typeof r !== 'object') return '';
  if (typeof r.ended === 'string' && (isNoResult(r.ended) || r.ended === 'resign')) return r.ended;
  // Flick Soccer's first form of a called-off challenge (2026-10-13 morning): over, result 'cancelled'.
  if (r.result === 'cancelled') return 'cancelled';
  if (!r.over && ms(r.expires) > 0 && now >= ms(r.expires)) return 'expired';
  return '';
}

/** PURE. 'sent' (this row's owner sent a challenge still waiting on an answer), 'got' (they were
 *  sent one and have not played yet), or ''. Written by each game's rowFor. */
export function rowOpen(r) {
  return r && (r.open === 'sent' || r.open === 'got') ? r.open : '';
}

/** PURE. The deadline for a match waiting on its receiver since `since`, or 0 when it never expires. */
export function expiresAt(lapse, waiting, since) {
  return lapse && waiting && ms(since) > 0 ? ms(since) + ANSWER_MS : 0;
}
