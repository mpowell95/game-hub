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
}

// =================================================================================================
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
