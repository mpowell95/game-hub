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

// --- 7 DAYS, THEN FORFEIT (Matt's decision, 2026-10-29) ---------------------------------------------
// Expiry above ends only an UNANSWERED challenge. Once it has been answered the only way out used to be
// Resign, so a player who was losing could simply stop moving and the winner never got the win. Now:
// once a match is ANSWERED (past its open stage), the player whose turn it is has FORFEIT_MS (7 days)
// from the moment the turn became theirs. Past that they LOSE and the other side wins, why 'timeout'.
// Like expiry, NOTHING is written to decide it: every phone works it out from the same stored time (the
// match's own log, or the index row's `turnAt`), a late move is refused, and each phone counts it once
// through its game's own ledger like any other result. Matches idle before FORFEIT_FROM get their
// 7 days counted from FORFEIT_FROM, so nothing changes result before players could react.

/** How long a player may sit on their turn in an answered challenge: 7 days. */
export const FORFEIT_MS = 7 * 24 * 60 * 60 * 1000;
/** The rule's first day: a turn that began earlier is timed from here (2026-10-29, UTC midnight). */
export const FORFEIT_FROM = Date.UTC(2026, 9, 29);
/** The derived `over.why` and row `why` of a forfeit. */
export const TIMEOUT = 'timeout';
/** A result the log did not produce: a resignation or a forfeit. */
export const isForcedEnd = (why) => why === 'resign' || why === TIMEOUT;

/** PURE. When a turn that began at `turnAt` is forfeited. */
export function forfeitAt(turnAt) { return Math.max(ms(turnAt), FORFEIT_FROM) + FORFEIT_MS; }

/**
 * PURE. Each entry's time, made safe to decide anything with (2026-10-29, second pass): a time may
 * never run BACKWARDS (an entry is lifted to the one before it, so a move stamped with a phone clock
 * set back cannot pretend the turn began days earlier) and never lies in the FUTURE (capped at `cap`,
 * the server's now, when given). A missing time is 0 ("unknown"). Since 2026-10-29 every new entry
 * is stamped by the SERVER (Firebase serverTimestamp, enforced in database.rules.json), so this only
 * matters for times written before that, by an older build or a changed phone clock.
 */
export function safeTimes(log, ats = null, cap = 0) {
  const list = Array.isArray(log) ? log : [];
  const out = [];
  let prev = 0;
  for (let i = 0; i < list.length; i++) {
    const raw = ms(Array.isArray(ats) ? ats[i] : list[i] && list[i].at);
    let t = raw > 0 ? Math.max(raw, prev) : 0;
    if (t && cap > 0 && t > cap) t = cap;
    if (t) prev = t;
    out.push(t);
  }
  return out;
}

/** PURE. When the current turn of a two-sided log began: the time of the last entry made by a side
 *  NOT on turn (it ended their turn), else `fallback` (the match's `updated`). `ats` is the entries'
 *  times when the cleaned log does not keep them (Battle Arena, Battleship). Times go through
 *  `safeTimes` (never backwards, never past `cap`); when the entry that ended the last turn has no
 *  time, the later of the previous known time and `fallback` stands in (the generous direction: a
 *  player on turn is never timed from earlier than the turn really began). */
export function turnStartOf(log, turn, fallback = 0, ats = null, cap = 0) {
  const list = Array.isArray(log) ? log : [];
  const times = safeTimes(list, ats, cap);
  const fb = cap > 0 ? Math.min(ms(fallback), cap) : ms(fallback);
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (!e || e.by === turn) continue;
    if (times[i] > 0) return times[i];
    let known = 0;
    for (let j = i - 1; j >= 0; j--) if (times[j] > 0) { known = times[j]; break; }
    return Math.max(known, fb);
  }
  return fb;
}

/**
 * PURE. Has an ANSWERED, unfinished match timed out? `turn` is the side on turn, `turnAt` when that
 * turn began, `other(turn)` the winner. Returns { winner, why: 'timeout', at } or null.
 */
export function timeoutOver({ over, open, turn, turnAt, other }, now = Date.now()) {
  if (over || open || turn == null || turn === '') return null;
  const at = forfeitAt(turnAt);
  if (now < at) return null;
  return { winner: other(turn), why: TIMEOUT, at };
}

/**
 * PURE. A stored index row's forfeit, from the row alone: null, or { result: 'won' | 'lost', at } for
 * the row's owner. Only an ANSWERED row (written since 2026-10-13, so it carries `open: ''`) can time
 * out; an older row without `open` is left to the match itself. `turnAt` is written on rows from
 * 2026-10-29; before that the row's `updated` (when the turn last passed) stands in.
 */
export function rowTimeout(r, now = Date.now()) {
  if (!r || typeof r !== 'object' || r.over || r.result === 'cancelled') return null;
  if (typeof r.ended === 'string' && r.ended) return null;
  if (!Object.prototype.hasOwnProperty.call(r, 'open') || r.open) return null;
  const at = forfeitAt(ms(r.turnAt) || ms(r.updated));
  if (now < at) return null;
  return { result: r.yourTurn ? 'lost' : 'won', at };
}

// --- CALLING OFF AFTER THE SENDER HAS PLAYED IS A LOSS (Matt's decision, 2026-10-29) ----------------
// A free cancel was a do-over: the sender could throw a bad first turn, cancel and send it again, and
// the receiver could decline after seeing a strong first turn. Now, once the SENDER has played anything
// in the match, a cancel (by the sender) or a decline (by the receiver) counts as a LOSS for whoever
// does it: the other side wins, exactly like a resignation. It is STORED as a resignation
// (`over: { winner, why: 'resign', via: 'cancelled' | 'declined', at }`), so every validator, list,
// record and deployed push function already reads it right ("You won! <name> resigned."). Before the
// sender has played anything, cancel and decline still count for nobody (the shape above). Each game's
// own cancelGame decides it from the match itself; the row's `pl` (sender has played) only chooses the
// words on a confirm screen.

/** The `over.via` of a called-off challenge that cost its caller the match. */
export const CALL_OFF_LOSS = ['cancelled', 'declined'];

/** PURE. Does calling off an open challenge whose sender `senderPlayed` cost the caller a loss? */
export function callOffCosts(senderPlayed) { return !!senderPlayed; }

/**
 * PURE. The same answer from an index row alone (the Multiplayer screen's confirm words). Rows from
 * 2026-10-29 carry `pl` (the sender has played). An older row: a challenge that reached its receiver
 * ('got', or a 'sent' row no longer on the sender's turn) was delivered after the sender's first turn.
 */
export function rowCallOffCosts(r) {
  if (!r || typeof r !== 'object') return false;
  if (typeof r.pl === 'boolean') return r.pl;
  return r.open === 'got' || (r.open === 'sent' && !r.yourTurn);
}

// --- A LOST INDEX WRITE (2026-10-29, second pass) ----------------------------------------------------
// A move writes the match, THEN the index rows. When the rows' write failed after the match landed, the
// retry found the move already there and returned ok without the rows, so the other person never saw
// "your turn" (and their row later read as a timeout). The retry now rewrites any row that disagrees
// with the MATCH: the match decides, the row follows.

/** PURE. Does a stored index row disagree with the row the match says it should be? Only what a
 *  reader acts on is compared (whose turn, finished, called off); a missing row disagrees. */
export function rowStale(stored, want) {
  if (!stored || typeof stored !== 'object') return true;
  if (!want || typeof want !== 'object') return false;
  return !!stored.yourTurn !== !!want.yourTurn || !!stored.over !== !!want.over
    || String(stored.ended || '') !== String(want.ended || '') || String(stored.result || '') !== String(want.result || '');
}
