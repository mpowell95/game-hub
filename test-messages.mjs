// test-messages.mjs - headless tests for the PURE halves of js/messages.js.
//
// WHAT IS NOT COVERED, stated up front so nobody reads a green run as more than it is: the Firebase
// write path (sendMessage/readMyThreads/markThreadSeen/hideThread/readAllThreads) and the whole of
// js/messages-ui.js. Those need a browser and a database; this file needs neither.
//
// What IS covered is every place a bug would be silent:
//   - pairKey's symmetry. Both people must compute the SAME thread key from their own side, or the
//     conversation quietly becomes two half-conversations that never meet.
//   - the unread count at REAL epoch precision, including the `from` guard that stops a person's
//     own message badging them. `| 0` on an epoch-ms value is a signed-32-bit truncation and it
//     scrambled the bug inbox's order and count once already (js/bug-report.js's ms() comment).
//   - visibleThreads' hide rule, which has to let a NEWER message bring a hidden thread back - a
//     hide that could swallow a later message would be a delete wearing a preference's clothes.
//   - the outbox's cap and its drop-vs-retry decision.

import { readFileSync } from 'node:fs';
import {
  MAX_MESSAGE, asCode, normalizeText, previewOf, pairKey, otherInPair, isUnread,
  countUnreadThreads, visibleThreads, sortMessagesOldestFirst, indexPatch, isTestName,
} from './js/messages.js';

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass += 1; } else { fail += 1; console.error('  FAIL ' + what); } };
const eq = (got, want, what) => ok(Object.is(got, want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('test-messages.mjs');

// --- asCode ---------------------------------------------------------------------------------
eq(asCode('ab2cd'), 'AB2CD', 'asCode upper-cases');
eq(asCode('  ab2cd  '), 'AB2CD', 'asCode trims');
eq(asCode('ABCDI'), null, 'asCode rejects I (not in the alphabet)');
eq(asCode('ABCD'), null, 'asCode rejects a short code');
eq(asCode(null), null, 'asCode rejects null');

// --- normalizeText / previewOf --------------------------------------------------------------
eq(normalizeText('  hi  '), 'hi', 'normalizeText trims');
eq(normalizeText('x'.repeat(MAX_MESSAGE + 50)).length, MAX_MESSAGE, 'normalizeText clamps to MAX_MESSAGE');
eq(normalizeText(null), '', 'normalizeText handles a non-string');
eq(previewOf('one\ntwo   three'), 'one two three', 'previewOf collapses whitespace');
ok(previewOf('y'.repeat(200)).length <= 60, 'previewOf clamps');
ok(previewOf('y'.repeat(200)).endsWith('…'), 'previewOf marks that it clipped');

// --- pairKey: the symmetry that makes one conversation one node -----------------------------
eq(pairKey('AAAAA', 'BBBBB'), 'AAAAA_BBBBB', 'pairKey sorts A-Z');
eq(pairKey('BBBBB', 'AAAAA'), 'AAAAA_BBBBB', 'pairKey is symmetric (the whole point)');
eq(pairKey('bbbbb', 'aaaaa'), 'AAAAA_BBBBB', 'pairKey canonicalizes case first');
eq(pairKey('AAAAA', 'AAAAA'), null, 'pairKey refuses a self-thread');
eq(pairKey('AAAAA', 'nope'), null, 'pairKey refuses a bad code');
eq(pairKey(null, 'BBBBB'), null, 'pairKey refuses a missing code');

eq(otherInPair('AAAAA_BBBBB', 'AAAAA'), 'BBBBB', 'otherInPair, first side');
eq(otherInPair('AAAAA_BBBBB', 'BBBBB'), 'AAAAA', 'otherInPair, second side');
eq(otherInPair('AAAAA_BBBBB', 'CCCCC'), null, 'otherInPair refuses a key that is not mine');
eq(otherInPair('garbage', 'AAAAA'), null, 'otherInPair refuses a malformed key');

// --- unread, at real epoch precision --------------------------------------------------------
// Every timestamp here is past 2^31 on purpose: a `| 0` anywhere on this path turns these into
// small, sometimes negative numbers and the comparisons silently invert.
const T = 1_756_000_000_000;
ok(T > 2 ** 31, 'the fixture timestamps really are past the 32-bit boundary');

const rowFrom = (over) => Object.assign({ code: 'BBBBB', at: T, from: 'BBBBB', seenAt: 0 }, over);
ok(isUnread(rowFrom({}), 'AAAAA'), 'a message from them, never opened, is unread');
ok(!isUnread(rowFrom({ seenAt: T }), 'AAAAA'), 'opened at the message time is read');
ok(!isUnread(rowFrom({ seenAt: T + 1 }), 'AAAAA'), 'opened after is read');
ok(isUnread(rowFrom({ seenAt: T - 1 }), 'AAAAA'), 'opened before is unread');
ok(!isUnread(rowFrom({ from: 'AAAAA' }), 'AAAAA'), 'MY OWN last message never badges me');
ok(!isUnread(rowFrom({}), null), 'no code means no badge');
ok(!isUnread(null, 'AAAAA'), 'a missing row never badges');

eq(countUnreadThreads([
  rowFrom({ code: 'BBBBB' }),
  rowFrom({ code: 'CCCCC', seenAt: T }),
  rowFrom({ code: 'DDDDD', from: 'AAAAA' }),
  rowFrom({ code: 'EEEEE', at: T + 5 }),
], 'AAAAA'), 2, 'countUnreadThreads counts only what is really waiting');
eq(countUnreadThreads(null, 'AAAAA'), 0, 'countUnreadThreads survives a non-array');

// --- visibleThreads: hide is a preference, and it must never swallow a later message ---------
const threads = [
  { code: 'BBBBB', at: T },
  { code: 'CCCCC', at: T + 10 },
  { code: 'DDDDD', at: T, hiddenAt: T },          // hidden exactly at the last message
  { code: 'EEEEE', at: T + 20, hiddenAt: T },     // hidden, then they wrote again
  { code: 'AAAAA', at: T },                       // me: never a row of my own
  { code: 'nope', at: T },                        // malformed code
  { code: 'FFFFF', at: 0 },                       // an index row with no message yet
];
const vis = visibleThreads(threads, 'AAAAA');
eq(vis.map((r) => r.code).join(','), 'EEEEE,CCCCC,BBBBB', 'visibleThreads: newest first, hidden dropped, self and junk excluded');
ok(vis.some((r) => r.code === 'EEEEE'), 'a message NEWER than the hide brings the thread back');
eq(visibleThreads(null, 'AAAAA').length, 0, 'visibleThreads survives a non-array');

// --- reading order ---------------------------------------------------------------------------
eq(sortMessagesOldestFirst([{ atMs: T + 2 }, { atMs: T }, { atMs: T + 1 }]).map((m) => m.atMs - T).join(','),
  '0,1,2', 'a conversation reads oldest first, down the screen');
eq(sortMessagesOldestFirst([{ atMs: T }, {}]).length, 2, 'a message with no timestamp is kept, not dropped');

// --- indexPatch --------------------------------------------------------------------------------
const patch = indexPatch({ at: T, from: 'bbbbb', text: '  hello   there  ', name: 'Lili', emoji: '🙂' });
eq(patch.at, T, 'indexPatch keeps the full epoch');
eq(patch.from, 'BBBBB', 'indexPatch canonicalizes the sender code');
eq(patch.preview, 'hello there', 'indexPatch stores a collapsed preview');
eq(patch.name, 'Lili', 'indexPatch carries the other person name');
ok(!('seenAt' in patch), 'indexPatch never writes seenAt (an update() must not clear the read state)');
ok(!('hiddenAt' in patch), 'indexPatch never writes hiddenAt');

// --- the test-account filter (mirrors leaderboard-ui.js's isHiddenRow) -----------------------
// A PREFIX, never a substring: the failure that matters here is hiding a real person, because a
// person nobody can write to is invisible in exactly the way THE LAW rule 1 is about.
ok(isTestName('test1') && isTestName('Tester') && isTestName('zzztest'), 'test/zzz prefixes are hidden');
ok(isTestName('QA') && isTestName('demo') && isTestName('prueba'), 'the exact-name list is hidden');
ok(!isTestName('Contest') && !isTestName('Tess') && !isTestName('Lili'), 'a real name is never hidden');
ok(isTestName(''), 'a blank name is not addressable');

// --- outbox ------------------------------------------------------------------------------------
// The outbox is localStorage-backed, so it needs the smallest possible stand-in rather than a
// browser. Imported after the shim is in place, so the module sees it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const mod = await import('./js/messages.js');
for (let i = 0; i < mod.MAX_OUTBOX + 4; i += 1) mod.queueOutbox({ toCode: 'BBBBB', text: 'm' + i });
eq(mod.outboxCount(), mod.MAX_OUTBOX, 'the outbox is capped');
const kept = JSON.parse(store.get(mod.OUTBOX_KEY)).queue;
eq(kept[kept.length - 1].text, 'm' + (mod.MAX_OUTBOX + 3), 'the cap keeps the NEWEST, not the oldest');

// --- [STRUCTURAL] the rules file and the backup script must agree ---------------------------
// Scoping messages/ forced the root .read to false, and a granted ancestor read cannot be revoked
// below - so every OTHER branch now has to be listed in database.rules.json by hand. Two silent
// failures live here, and neither one shows up at runtime until somebody needs it:
//   - a branch missing from the rules is unreadable AND unwritable, so its whole feature breaks;
//   - a branch missing from BRANCHES is absent from every future backup, which is worse, because
//     a backup with a hole in it is trusted.
const rules = JSON.parse(readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8')).rules;
const { BRANCHES } = await import('./backups/rtdb-backup.mjs');

eq(rules['.read'], false, 'the root read is closed (or nothing below it can be scoped)');
eq(rules['.write'], false, 'the root write is closed');
ok(rules.messages && rules.messages['.read'].includes('admins'), 'messages is admin-readable as a whole');
ok(rules.messages.threads.$pair['.read'].includes('msgAuth'), 'a thread is scoped by the claimed code');
ok(rules.messages.index.$code['.read'].includes('msgAuth'), 'an index row is scoped by the claimed code');
ok(rules.messages.index.$code.$other['.write'].includes('$other'),
  'a SENDER can write the recipient index row (or no message ever reaches anybody)');
ok(rules.msgAuth.$uid['.write'].includes('auth.uid === $uid'), 'a claim is writable only by its own uid');
eq(rules.admins['.write'], false, 'the admins allowlist is console-only');

const ruleBranches = Object.keys(rules).filter((k) => !k.startsWith('.') && k !== 'msgAuth');
const missingFromBackup = ruleBranches.filter((b) => !BRANCHES.includes(b));
const missingFromRules = BRANCHES.filter((b) => !ruleBranches.includes(b));
eq(missingFromBackup.join(','), '', 'every ruled branch is in the backup BRANCHES list');
eq(missingFromRules.join(','), '', 'every backed-up branch has a rule (or it is unreadable)');

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
