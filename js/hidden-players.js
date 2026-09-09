// hidden-players.js - WHO NEVER RENDERS: test/QA accounts, and devices with no real name.
//
// THE LAW (root CLAUDE.md): this file HIDES, it never deletes. Every record it filters stays in
// localStorage, stays synced to `players/<id>`, and stays fully visible to its owner on My Stats.
// Nothing here can touch a counter.
//
// WHY IT IS ITS OWN MODULE (2026-09-09). This rule had THREE hand-kept copies - js/leaderboard-ui.js
// (canonical), js/messages.js (the recipient list) and test-leaderboard-rank.mjs (a deliberate
// mirror, which stays a mirror: it is the regression check). The duplication was not laziness;
// js/messages.js's own header records the reason, which was that importing it meant importing the
// whole leaderboard overlay onto the launcher's start-up path just to paint a badge. The moment a
// FOURTH consumer appeared (js/admin-ui.js's Announcements section, where ~100 pre-gate nameless
// devices buried the four real people), the answer stopped being "copy it again": a dependency-free
// twenty-line module costs that path nothing and is the thing every caller should have been reading.
//
// WHO ACTUALLY RUNS TEST ROUNDS, from Matt, 2026-08-26: test1, test2 and MattyIce. NOBODY ELSE.
// He said it after a session called *TP* - a real player, and the board's most-played account - a
// test account on the strength of its initials. Do not infer "test" from a name's shape, from
// initials, from an odd play count, or from a name you do not recognise: every name in this family
// is a real person until Matt says otherwise, and hiding one makes their whole history vanish from
// every screen that reads this (THE LAW rule 1). Adding a name here needs him to name it.

/** Old test/debug DEVICE records, matched by deviceId prefix. "Tester", "test1", the preview bot.
 *  A prefix only ever catches devices that already existed when it was written - a fresh test pass
 *  mints a new deviceId every time - which is why the NAME rule below is the durable half. */
export const HIDDEN_DEVICE_PREFIX = ['4392d978', 'f8ad1b82', 'zzz-prev'];

/** Exact test/QA names, alongside the prefixes in isHiddenName(). */
export const HIDDEN_NAMES = new Set(['qa', 'dev', 'demo', 'preview', 'prueba']);

/** A PREFIX, never a substring: "Contest" and "Tess" are names a real person could pick. */
export const HIDDEN_NAME_PREFIX = ['test', 'zzz'];

/** True for a deviceId that must never render. */
export function isHiddenDeviceId(id) {
  const s = typeof id === 'string' ? id : '';
  return HIDDEN_DEVICE_PREFIX.some((p) => s.startsWith(p));
}

/**
 * True for a name that must never render: a test/QA account, or no name at all.
 *
 * NAMELESS counts as hidden (2026-07-31, superseding the 2026-07-30 "show players who never set a
 * profile name" change) and that is only safe BECAUSE the app is no longer playable without a name:
 * js/name-gate.js gates the hub and every standalone game page, so a nameless record can only be
 * pre-gate history, and its owner is gated into naming themselves the next time they open anything.
 * At that moment js/players-agg.js's identity graph attaches that exact history to their real row
 * and it reappears everywhere, because the record was never altered. Until then it stays synced and
 * fully visible to its owner on My Stats. THE LAW rule 1 is about history no screen shows; this
 * history has a screen, and a way back onto the others. DO NOT re-hide nameless rows without that
 * gate in place - that combination is the stored-but-invisible bug 59f8e9b fixed.
 *
 * 'You' is js/profile-store.js's blank default, so it means "nameless" too.
 */
export function isHiddenName(name) {
  const s = (typeof name === 'string' ? name : '').trim().toLowerCase();
  if (!s || s === 'you') return true;
  if (HIDDEN_NAMES.has(s)) return true;
  return HIDDEN_NAME_PREFIX.some((p) => s.startsWith(p));
}

export default { isHiddenName, isHiddenDeviceId, HIDDEN_DEVICE_PREFIX, HIDDEN_NAMES, HIDDEN_NAME_PREFIX };
