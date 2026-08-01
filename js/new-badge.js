// js/new-badge.js — the launcher's time-limited "New" pill.
//
// A game carries a `released: 'YYYY-MM-DD'` field on its js/hub.js GAMES entry; the hub shows a
// NEW pill on that game's tile for NEW_DAYS days after the date, and the pill then disappears on
// its own with no follow-up commit. Adding a game = set `released` to the day it goes live (see
// "Adding a game" item 5 in the root CLAUDE.md).
//
// Pure and DOM-free on purpose: no storage, no side effects, no clock reading except the `now`
// argument's default. That makes the whole feature a read-time DISPLAY transform over a date
// literal — the same shape as js/leaderboard-rank.js's maths — so it is headless-testable
// (test-new-badge.mjs) and THE LAW has no surface here at all: nothing is written, nothing is
// read back, and a badge that never renders costs a player nothing.
//
// Dates are parsed as UTC midnight and compared against the device's real clock, so the window's
// edge can land up to a day early or late relative to a player's local midnight. At a
// week-long scale that is noise, and the alternative (a local-midnight parse) would just move the
// same fuzziness onto players in other timezones.

/** How many days a game wears the New pill after its release date. */
export const NEW_DAYS = 7;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' -> epoch ms at UTC midnight, or null for anything else (missing field, wrong
 *  shape, or a real-looking-but-impossible date like 2026-02-31, which Date.UTC would roll over
 *  into March rather than reject). A null release date simply never earns a badge. */
export function parseReleaseDate(released) {
  if (typeof released !== 'string') return null;
  const m = DATE_RE.exec(released.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ms)) return null;
  const back = new Date(ms);
  // Reject rolled-over dates: Date.UTC(2026, 1, 31) is 2026-03-03, not an error.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** Whole days elapsed since `released` (negative if the date is still in the future), or null
 *  when the date can't be parsed. */
export function daysSinceRelease(released, now = Date.now()) {
  const ms = parseReleaseDate(released);
  if (ms === null) return null;
  return Math.floor((now - ms) / DAY_MS);
}

/** Is this GAMES entry inside its New window? Accepts the whole entry (or a bare date string) so
 *  call sites read as `isNewGame(g)`.
 *
 *  A FUTURE release date counts as new rather than as "not yet": the card only exists in the
 *  launcher at all once the game is registered, and a device whose clock runs slow shouldn't be
 *  the one player who misses the announcement. */
export function isNewGame(game, now = Date.now()) {
  const released = typeof game === 'string' ? game : (game && game.released);
  const days = daysSinceRelease(released, now);
  return days !== null && days < NEW_DAYS;
}

export default { NEW_DAYS, parseReleaseDate, daysSinceRelease, isNewGame };
