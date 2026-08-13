// test-bug-report.mjs - headless tests for the pure halves of Report a bug (js/bug-report.js)
// and the launcher announcement (js/announce.js).
//
// Run: node test-bug-report.mjs   (also wired into run-all-tests.mjs)
//
// WHAT IS AND IS NOT COVERED, stated plainly rather than implied: everything here is the logic that
// can run without a DOM - the screenshot budget, the description clamp, the environment summary,
// and the announcement's show-once/expire-by-itself decision. The DOM halves (js/bug-report-ui.js,
// js/announce-ui.js) and the Firebase write path are NOT covered by any node suite; they need a
// browser and a real room, the same honest caveat every MP consumer in js/CLAUDE.md carries.
//
// The announcement tests need localStorage, which node does not have. A tiny in-memory stand-in is
// installed on globalThis BEFORE js/announce.js is imported - it reads the store through the same
// `localStorage` global a browser provides, so the code under test is the shipped code, unmodified.

import { existsSync } from 'node:fs';

let passed = 0;
const failures = [];

function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`ok    ${label}`); return; }
  failures.push(label);
  console.log(`FAIL  ${label}${extra ? `\n        ${extra}` : ''}`);
}
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// --- localStorage stand-in (must exist before announce.js is imported) --------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const bug = await import('./js/bug-report.js');
const ann = await import('./js/announce.js');

// =================================================================================================
console.log('\n=== js/bug-report.js: the description clamp ===');

eq('trims whitespace', bug.normalizeDescription('   the board vanished  '), 'the board vanished');
eq('an empty description stays empty (the UI refuses to send it)', bug.normalizeDescription('   \n '), '');
eq('a non-string is not a description', bug.normalizeDescription(null), '');
ok('a very long description is clamped, not rejected',
  bug.normalizeDescription('x'.repeat(5000)).length === bug.MAX_DESCRIPTION);

// =================================================================================================
console.log('\n=== js/bug-report.js: the screenshot budget ===');
// The budget is checked BEFORE a shot is attached, so the player is told at pick time rather than
// after the report has already been built and the send has failed.

ok('the first ordinary screenshot fits', bug.fitsShotBudget([], 300_000));
ok('a shot over the per-shot cap is refused', !bug.fitsShotBudget([], bug.MAX_SHOT_BYTES + 1));
ok('a zero-byte / unmeasurable shot is refused', !bug.fitsShotBudget([], 0));
ok(`a ${bug.MAX_SHOTS + 1}th shot is refused however small`,
  !bug.fitsShotBudget(Array.from({ length: bug.MAX_SHOTS }, () => ({ bytes: 1000 })), 1000));
ok('shots that fit individually but bust the total are refused',
  !bug.fitsShotBudget([{ bytes: 900_000 }, { bytes: 900_000 }], 900_000));
ok('...and the same set still accepts a smaller one that does fit',
  bug.fitsShotBudget([{ bytes: 900_000 }, { bytes: 900_000 }], 400_000));
ok('a malformed existing list never throws', bug.fitsShotBudget(null, 1000) === true);

// =================================================================================================
console.log('\n=== js/bug-report.js: the one-line environment summary ===');

const env = {
  deviceLabel: 'iPhone · iOS 18.2', browserLabel: 'Safari 18.2', displayMode: 'standalone',
  screen: { viewportW: 393, viewportH: 852 }, appVersion: 'v283',
};
const sum = bug.summarizeEnvironment(env);
ok('names the phone, the browser, the install state, the size and the build',
  sum.includes('iPhone') && sum.includes('Safari') && sum.includes('installed app')
  && sum.includes('393x852') && sum.includes('v283'), sum);
eq('a missing environment summarises to nothing rather than throwing', bug.summarizeEnvironment(null), '');
ok('a half-gathered environment still summarises what it has',
  bug.summarizeEnvironment({ browserLabel: 'Chrome 131' }) === 'Chrome 131');

// =================================================================================================
console.log('\n=== js/bug-report.js: the inbox order and unread count ===');
// [KNOWN-BUG PROBE] These use REAL epoch-millisecond values on purpose. The first draft of this
// feature sorted and compared them with `x | 0`, which coerces to a signed 32-bit int - epoch ms
// passed 2^31 in 1970, so every timestamp collapsed to a small, sometimes-negative number and the
// inbox's order and "N new" badge were both quietly wrong. Fake small timestamps would pass either
// way, which is exactly why the bug survived a first read.
const now = Date.UTC(2026, 7, 11, 12);
const REPORTS = [
  { id: 'old', createdAtMs: now - 3 * 86400000 },
  { id: 'newest', createdAtMs: now },
  { id: 'yesterday', createdAtMs: now - 86400000 },
  { id: 'fixed', createdAtMs: now - 600000, status: 'done' },
];
eq('sorts newest first with real epoch timestamps',
  bug.sortReportsNewestFirst(REPORTS).map((r) => r.id), ['newest', 'fixed', 'yesterday', 'old']);
eq('sorting does not mutate the caller\'s list', REPORTS.map((r) => r.id), ['old', 'newest', 'yesterday', 'fixed']);
eq('a report with no timestamp sorts last rather than throwing',
  bug.sortReportsNewestFirst([{ id: 'a', createdAtMs: now }, { id: 'b' }]).map((r) => r.id), ['a', 'b']);
eq('unread counts only what arrived after the last look', bug.countUnread(REPORTS, now - 2 * 86400000), 2);
eq('...and never counts one already marked done', bug.countUnread(REPORTS, now - 86400000 - 1), 2);
eq('a device that has never opened the inbox sees everything open', bug.countUnread(REPORTS, 0), 3);
eq('having looked just now, nothing is unread', bug.countUnread(REPORTS, now), 0);
eq('junk in, zero out', bug.countUnread(null, 'nonsense'), 0);

// =================================================================================================
console.log('\n=== js/announce.js: shown once, then never again ===');

const A = {
  id: 'test-a', from: '2026-08-11', until: '2026-10-15',
  title: { en: 'Hello', es: 'Hola' }, body: { en: ['one'], es: ['uno'] },
};
const day = (d) => Date.parse(`2026-${d}T12:00:00Z`);

eq('an unseen, live announcement is pending', (ann.pendingAnnouncement(day('08-12'), [], [A]) || {}).id, 'test-a');
eq('a dismissed one is not', ann.pendingAnnouncement(day('08-12'), ['test-a'], [A]), null);
eq('one that has not started yet is not', ann.pendingAnnouncement(day('08-01'), [], [A]), null);
eq('one past its until date is not', ann.pendingAnnouncement(day('10-20'), [], [A]), null);
ok('the until date is inclusive of that whole day', ann.isLive(A, day('10-15')));
eq('the oldest unseen one comes first',
  (ann.pendingAnnouncement(day('08-12'), [], [A, { id: 'test-b', from: '2026-08-11' }]) || {}).id, 'test-a');
eq('...and once that one is dismissed, the next appears',
  (ann.pendingAnnouncement(day('08-12'), ['test-a'], [A, { id: 'test-b', from: '2026-08-11' }]) || {}).id, 'test-b');

// A bad date must fail SAFE: an announcement that shows is a smaller mistake than one that never
// does, because the second failure mode is invisible until someone asks why nobody knew.
ok('a malformed from-date means "live already"', ann.isLive({ id: 'x', from: 'soon' }, day('08-12')));
ok('a malformed until-date means "no expiry"', ann.isLive({ id: 'x', until: 'never' }, day('12-31')));

// =================================================================================================
console.log('\n=== js/announce.js: the seen list (a preference, THE LAW rule 2 carve-out) ===');

store.clear();
eq('a device with no store has seen nothing', ann.loadSeen(), []);
ann.markSeen('one');
ann.markSeen('two');
eq('marking appends, in order', ann.loadSeen(), ['one', 'two']);
ann.markSeen('one');
eq('marking the same id twice does not duplicate it', ann.loadSeen(), ['one', 'two']);
ann.markSeen('');
ann.markSeen(null);
eq('junk ids are ignored', ann.loadSeen(), ['one', 'two']);

// Rule 5's habit, applied to a key this feature owns: an id written by a NEWER build (one this
// device is about to update to) must survive being read by an older one, never be pruned.
store.set('gamehub.announce.v1', JSON.stringify({ version: 1, seen: ['from-a-newer-build'] }));
ann.markSeen('mine');
eq('an unrecognised id is kept alongside the new one', ann.loadSeen(), ['from-a-newer-build', 'mine']);

store.set('gamehub.announce.v1', '{{not json');
eq('a corrupted store reads as "seen nothing" instead of throwing', ann.loadSeen(), []);
ok('...and can still be written over', (() => { ann.markSeen('after'); return ann.loadSeen().includes('after'); })());

// =================================================================================================
console.log('\n=== the shipped announcement is well-formed ===');
// The failure this catches is silent: a typo'd date or a missing Spanish body ships an
// announcement that either never appears or appears half-translated, and nobody finds out.

for (const a of ann.ANNOUNCEMENTS) {
  ok(`${a.id}: has a parseable from-date`, /^\d{4}-\d{2}-\d{2}$/.test(a.from || ''));
  ok(`${a.id}: has a parseable until-date (it must retire itself)`, /^\d{4}-\d{2}-\d{2}$/.test(a.until || ''));
  ok(`${a.id}: until is after from`, Date.parse(a.until) > Date.parse(a.from));
  for (const field of ['title', 'body', 'cta']) {
    if (!a[field]) continue;
    ok(`${a.id}: ${field} has both en and es`, !!(a[field].en && a[field].es));
  }
  ok(`${a.id}: en and es bodies have the same number of paragraphs`,
    (a.body.en || []).length === (a.body.es || []).length);
  // A typo'd image path is silent: the popup still opens, just with a hole where the picture was
  // (announce-ui.js removes a figure whose image fails to load, on purpose). So check the files.
  // Not a failure - a reminder. A gated announcement is invisible to the family, and the whole
  // point of gating it is that somebody flips it back, so it says so on every single test run.
  if (a.adminOnly) console.log(`      NOTE  ${a.id} is adminOnly: nobody but Matt sees it. Delete that line in js/announce.js to go live.`);
  for (const s of a.shots || []) {
    for (const field of ['img', 'imgDark']) {
      for (const lg of ['en', 'es']) {
        const path = ann.textFor(s[field], lg);
        ok(`${a.id}: ${field}.${lg} is set`, !!path);
        if (path) ok(`${a.id}: ${path} exists on disk`, existsSync(new URL('./' + path, import.meta.url)));
      }
    }
    ok(`${a.id}: ${ann.textFor(s.img, 'en')} has a caption in both languages`,
      !!(s.caption && s.caption.en && s.caption.es));
  }
}

// =================================================================================================
console.log('\n=== js/bug-report.js: replying, and clearing the inbox (2026-08-13) ===');
// Matt: "how do I reply to the bug report to tell him it's fixed and that all his wins counted,
// they didn't vanish? I must be able to delete the reports in my inbox once addressed as well."
// The Firebase halves are not covered here (see the header); these are the pure decisions the two
// inboxes are built on.

eq('a reply is trimmed like a description', bug.normalizeReply('  fixed it  '), 'fixed it');
eq('an empty reply is empty (the UI refuses to send it)', bug.normalizeReply('  \n  '), '');
ok('a very long reply is clamped, not rejected', bug.normalizeReply('x'.repeat(5000)).length === bug.MAX_REPLY);

// Ordering is by when the REPLY was written, not when the report was filed - an old report Matt
// answers today belongs at the top of the player's list, above a newer one he has not answered.
{
  const sorted = bug.sortRepliesNewestFirst([
    { reportId: 'old-report-new-reply', reportCreatedAtMs: 1_600_000_000_000, atMs: 1_755_000_000_000 },
    { reportId: 'new-report-old-reply', reportCreatedAtMs: 1_754_000_000_000, atMs: 1_754_100_000_000 },
  ]);
  eq('replies sort by reply time, not report time', sorted[0].reportId, 'old-report-new-reply');
  // Real epoch values on purpose: the `| 0` bug this file's header records truncated exactly these.
  ok('epoch-ms timestamps survive the sort (no 32-bit truncation)',
    sorted[0].atMs === 1_755_000_000_000);
}

{
  const replies = [{ atMs: 1_755_000_000_000 }, { atMs: 1_754_000_000_000 }, { atMs: 1_700_000_000_000 }];
  eq('a device that has never looked has every reply unread', bug.countUnreadReplies(replies, 0), 3);
  eq('only replies newer than the last look count', bug.countUnreadReplies(replies, 1_754_000_000_000), 1);
  eq('caught up means no badge', bug.countUnreadReplies(replies, 1_755_000_000_000), 0);
  eq('nothing to read is not an error', bug.countUnreadReplies(null, 0), 0);
}

// The seen stamp round-trips through the same localStorage stand-in the app uses.
{
  bug.markRepliesSeen(1_755_000_000_000);
  eq('the seen stamp round-trips at full epoch precision', bug.repliesSeenAt(), 1_755_000_000_000);
  store.set(bug.REPLIES_SEEN_KEY, 'not json at all');
  eq('a corrupt seen stamp reads as "never looked", not as a crash', bug.repliesSeenAt(), 0);
  store.delete(bug.REPLIES_SEEN_KEY);
}

// Deleting is a soft delete: hidden from Matt's inbox, still in the record. THE LAW's habit - and
// the reporter's copy of a reply lives under bugReplies/, so it is not reachable from here at all.
{
  const all = [
    { id: 'a', description: 'still open' },
    { id: 'b', description: 'cleared', deleted: true, deletedAtMs: 1_755_000_000_000 },
    { id: 'c', description: 'handled', status: 'done' },
  ];
  const shown = bug.visibleInInbox(all);
  eq('a deleted report is out of the inbox', shown.length, 2);
  ok('a DONE report is still in the inbox (it folds away, it does not vanish)',
    shown.some((r) => r.id === 'c'));
  ok('the deleted record itself is untouched - visibleInInbox only filters a view',
    all.length === 3 && all[1].deleted === true);
  eq('nothing to show is not an error', bug.visibleInInbox(null).length, 0);
}

// =================================================================================================
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
