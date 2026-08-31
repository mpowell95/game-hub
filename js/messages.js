// messages.js - the DATA half of player-to-player Messages (js/messages-ui.js is the screen).
//
// THE LAW (root CLAUDE.md): this file writes only its own NEW node (`messages/`) and its own NEW
// local key (`gamehub.messages.outbox.v1`). It never touches a stats key, a profile field or a
// players/ record, so no path from here can lose anybody anything. Nothing is ever deleted: the
// only "delete" is a per-person `hiddenAt` stamp on that person's own index row, and a new message
// brings the thread back (see hideThread).
//
// ADDRESSED BY PLAYER CODE, NOT deviceId. This is the one thing bugReplies/ gets wrong: it is keyed
// by deviceId, so Matt's answer only ever appears on the phone that filed the report. A person with
// two phones (this family has several) would read a message on one and never see it on the other.
// The player code (profile.playerId) is the stable cross-device identity - it is minted at the name
// gate for everyone (js/name-gate.js), it is what js/players-agg.js groups devices by, and it uses
// an alphabet with no `. $ # [ ] /` in it, so it is a safe RTDB key with no encoding.
//
// THE NODE
//   messages/threads/<pairKey>/msgs/<pushId>  = { from, text, atMs }
//   messages/index/<CODE>/<otherCode>         = { at, from, preview, name, emoji, seenAt, hiddenAt }
//
// `pairKey` is the two codes sorted A-Z and joined with '_', so both people compute the same key
// from their own side and one conversation is one node. The index exists because a device otherwise
// has no way to know WHICH pair keys concern it - it would have to download every thread in the
// system to find its own. A send writes the message once and updates two index rows (mine and
// theirs), each carrying the OTHER person's name and emoji so an inbox renders from one read.
//
// `seenAt` and `hiddenAt` live ON the index row, not in the thread, so the badge costs exactly one
// read of `messages/index/<myCode>` no matter how many conversations there are. They are stored in
// Firebase rather than localStorage on purpose: reading on one phone has to clear the badge on the
// other, which a local seen-stamp could never do.
//
// Both are PREFERENCES (THE LAW rule 2's carve-out) - one-tap recreatable, never earned history.
// The messages themselves are neither: they are only ever added.

import { loadProfile } from './profile-store.js';
import { getStatsApp } from './firebase-boot.js';
import { readPlayersOnce } from './stats-net.js';
import { aggregatePlayers, isPlaceholderName } from './players-agg.js';

// --- limits ---------------------------------------------------------------------------------

export const MAX_MESSAGE = 300;      // characters, per message
export const MAX_PREVIEW = 60;       // characters of the last message kept on the index row
export const OUTBOX_KEY = 'gamehub.messages.outbox.v1';
export const MAX_OUTBOX = 10;        // sends waiting on this device for a signal

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

// --- small pure helpers (headless-testable: test-messages.mjs) --------------------------------

/** A timestamp as a number. NEVER `x | 0` on an epoch-ms value: bitwise ops coerce to a SIGNED
 *  32-BIT int and epoch ms passed 2^31 in 1970, so `Date.now() | 0` is a small, wrong, sometimes
 *  negative number. It scrambled the bug inbox's order and unread count once already
 *  (js/bug-report.js); the same trap is here, on the same kind of value. */
const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** Sanitize a player code to its canonical form, or null. Same rule as profile-store's code(). */
export function asCode(v) {
  const s = (typeof v === 'string' ? v : '').trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

/** Trim + clamp what the player typed. Returns '' for anything unusable. */
export function normalizeText(text) {
  const s = (typeof text === 'string' ? text : '').trim();
  return s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE) : s;
}

/** The one-line summary kept on both index rows. Newlines collapse: this renders on a single row
 *  in a list, and a preview that carries a line break just gets clipped mid-word by the browser. */
export function previewOf(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW - 1) + '…' : s;
}

/**
 * The thread key for two players: both codes, sorted A-Z, joined with '_'. Sorted so that each
 * side computes the SAME key from its own point of view - the whole reason one conversation is one
 * node rather than two half-conversations that can drift apart. Returns null if either code is not
 * a real code, or if they are the same person (nobody messages themselves).
 */
export function pairKey(a, b) {
  const x = asCode(a), y = asCode(b);
  if (!x || !y || x === y) return null;
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

/** The OTHER person in a pair key, from my side. null if the key is malformed or not mine. */
export function otherInPair(key, myCode) {
  const me = asCode(myCode);
  const parts = String(key == null ? '' : key).split('_');
  if (!me || parts.length !== 2) return null;
  const [a, b] = [asCode(parts[0]), asCode(parts[1])];
  if (!a || !b) return null;
  if (a === me) return b;
  if (b === me) return a;
  return null;
}

/** Has this person got something waiting in this thread? My OWN last message never counts - the
 *  send bumps `at` on my row too, so without the `from` guard everyone would badge themselves. */
export function isUnread(row, myCode) {
  const me = asCode(myCode);
  if (!row || !me) return false;
  return ms(row.at) > ms(row.seenAt) && asCode(row.from) !== me;
}

/** How many conversations have something waiting. Pure, so the badge is tested rather than counted
 *  inline in the DOM. */
export function countUnreadThreads(rows, myCode) {
  return (Array.isArray(rows) ? rows : []).filter((r) => isUnread(r, myCode)).length;
}

/** Conversations to show, newest first. A hidden thread stays hidden only while nothing newer has
 *  arrived: `at > hiddenAt` brings it straight back, which is what makes hiding safe (see
 *  hideThread - nothing is deleted, so a hidden thread cannot swallow a later message). */
export function visibleThreads(rows, myCode) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && asCode(r.code) && asCode(r.code) !== asCode(myCode) && ms(r.at) > 0)
    .filter((r) => !(ms(r.hiddenAt) > 0 && ms(r.hiddenAt) >= ms(r.at)))
    .sort((a, b) => ms(b.at) - ms(a.at));
}

/** Messages in reading order: OLDEST first, the way a conversation is read down a screen. */
export function sortMessagesOldestFirst(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => ms(a && a.atMs) - ms(b && b.atMs));
}

/** The index-row patch a send leaves on ONE side. `name`/`emoji` are always the OTHER person as
 *  seen from that side, so an inbox renders from a single read with no second lookup. Pure. */
export function indexPatch({ at, from, text, name, emoji }) {
  return {
    at: ms(at), from: asCode(from) || '', preview: previewOf(text),
    name: String(name == null ? '' : name).slice(0, 20),
    emoji: String(emoji == null ? '' : emoji).slice(0, 8),
  };
}

// --- who am I -------------------------------------------------------------------------------

/** This player's code, or null. Everything here needs it; a device that has never been through the
 *  name gate has none, and the UI says so rather than failing silently. */
export function myCode() {
  try { const p = loadProfile(); return asCode(p && p.playerId); }
  catch { return null; }
}

/** This player's name + emoji, for the copy that lands on the other person's index row. */
function meLabel() {
  try { const p = loadProfile() || {}; return { name: p.name || '', emoji: p.emoji || '' }; }
  catch { return { name: '', emoji: '' }; }
}

// --- a dev server never writes to the family's database ---------------------------------------
// The same guard, and the same opt-in key, as js/stats-net.js. A localhost session verifying this
// screen must not be able to send the family a real message. Reads stay on: an inbox with nothing
// in it cannot be checked.

const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed(what) {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[messages] ${what} BLOCKED: this is a dev origin (${location.hostname}) and dev never writes to the family database. `
    + `To allow it in this browser: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}

// --- the auth claim: what lets the RTDB rules scope this node ---------------------------------
//
// Matt, on being told the database served every thread to anyone signed in: *"Only admin should be
// able to see every thread. Others should only see their own."*
//
// The rules can only see one thing about a client: its anonymous auth `uid`. They cannot see a
// player code, because a code lives in localStorage. So a device WRITES the link - `msgAuth/<uid> =
// <CODE>` - and the rules read it back to answer "is this thread yours". Without a claim, a device
// can read and write nothing under `messages/` at all.
//
// The claim is rewritable by its own uid and nobody else's. It is deliberately NOT claim-once: a
// player who links this device to another player code (js/name-gate.js) changes their code, and a
// frozen claim would lock them out of their own messages. Claim-once would also buy nothing against
// a determined person, who can simply sign in again for a fresh uid.
//
// WHAT THIS DOES AND DOES NOT BUY, stated plainly so nobody oversells it: the app, and the database
// behind it, no longer hand anyone another player's messages - which is the whole of what was wrong.
// It is NOT proof against a person who has somebody's 5-character player code and opens developer
// tools, because that code is printed on the profile page and typed in to link a second device, so
// it is not a secret and cannot be made one. Real per-person authentication is the only thing that
// would close that, and this app has none by design.
//
// Best-effort and cached per page load: a failed claim leaves the reads returning empty (which they
// already do offline), never an exception.

let _claimed = null;

async function ensureAuthClaim(boot) {
  const me = myCode();
  if (!me || !boot || !boot.uid) return null;
  if (_claimed === me) return me;
  try {
    const { db, api, uid } = boot;
    const snap = await api.get(api.ref(db, `msgAuth/${uid}`));
    const have = (snap && snap.exists()) ? snap.val() : null;
    // Only write when it is actually wrong: this runs on every hub load, and a no-op write is a
    // round trip every device would pay forever for nothing.
    if (have !== me) {
      if (!writesAllowed('msgAuth claim')) return null;
      await api.set(api.ref(db, `msgAuth/${uid}`), me);
    }
    _claimed = me;
    return me;
  } catch (err) {
    console.warn('[messages] could not claim this device for ' + me + '; messages will read as empty', err);
    return null;
  }
}

/** Boot Firebase AND make sure this device has claimed its code. null when either is unavailable. */
async function ready() {
  const boot = await getStatsApp();
  if (!boot) return null;
  await ensureAuthClaim(boot);
  return boot;
}

// --- sending --------------------------------------------------------------------------------

/**
 * Send one message. Writes the message once and updates BOTH index rows.
 *
 * `update`, never `set`, on the index rows: `seenAt` and `hiddenAt` live there too, and a `set`
 * would wipe the recipient's read state on every message they receive.
 *
 * Verified by a fresh re-read before claiming success, the same habit as stats-net.js and
 * bug-report.js (THE LAW rule 6): a resolved promise is not proof the data landed, and a message
 * that silently evaporates looks exactly like being ignored.
 *
 * Returns { ok:true, id, atMs } or { ok:false, reason, retryable }.
 */
export async function sendMessage({ toCode, toName, toEmoji, text }) {
  const me = myCode();
  const to = asCode(toCode);
  const body = normalizeText(text);
  const key = pairKey(me, to);
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!key) return { ok: false, reason: 'bad-recipient', retryable: false };
  if (!body) return { ok: false, reason: 'empty', retryable: false };
  if (!writesAllowed('sendMessage')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };

  const atMs = Date.now();
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;

    const ref = api.push(api.ref(db, `messages/threads/${key}/msgs`));
    await api.set(ref, { from: me, text: body, atMs });

    // Verify the MESSAGE landed before touching either index. An index row pointing at a message
    // that is not there is worse than no row: the inbox would show a preview that opens an empty
    // conversation, which reads as data loss even though nothing was ever lost.
    const snap = await api.get(api.ref(db, `messages/threads/${key}/msgs/${ref.key}/atMs`));
    if (!snap || !snap.exists()) {
      console.error(`[messages] write VERIFY FAILED for messages/threads/${key}/msgs/${ref.key} - nothing landed.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }

    const mine = meLabel();
    const base = { at: atMs, from: me, text: body };
    // Their row: the other person is ME. Mine: the other person is THEM, and `seenAt` is stamped
    // now so my own send can never badge me.
    await api.update(api.ref(db, `messages/index/${to}/${me}`), indexPatch(Object.assign({}, base, mine)));
    await api.update(api.ref(db, `messages/index/${me}/${to}`), Object.assign(
      indexPatch(Object.assign({}, base, { name: toName, emoji: toEmoji })), { seenAt: atMs }));

    return { ok: true, id: ref.key, atMs };
  } catch (err) {
    console.error('[messages] send failed', err);
    return { ok: false, reason: String((err && err.message) || err), retryable: true };
  }
}

/** Matt's broadcast: the same words to every recipient, each in their OWN thread. No separate node
 *  and no separate reader - a broadcast is just several ordinary messages, so replying to one is an
 *  ordinary conversation. Returns { sent, failed }. */
export async function sendBroadcast(recipients, text) {
  let sent = 0; const failed = [];
  for (const r of (Array.isArray(recipients) ? recipients : [])) {
    const res = await sendMessage({ toCode: r.code, toName: r.name, toEmoji: r.emoji, text });
    if (res.ok) sent += 1; else failed.push({ code: r.code, reason: res.reason });
  }
  return { sent, failed };
}

// --- reading --------------------------------------------------------------------------------

/** My conversations, newest first, already filtered for hidden ones. `[]` offline - never throws. */
export async function readMyThreads() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, `messages/index/${me}`));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val) return [];
    return visibleThreads(Object.keys(val).map((k) => Object.assign({ code: k }, val[k])), me);
  } catch (err) {
    console.error('[messages] could not read the inbox', err);
    return [];
  }
}

/** One conversation, oldest first. `[]` offline - never throws. */
export async function readThread(otherCode) {
  const key = pairKey(myCode(), otherCode);
  if (!key) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, `messages/threads/${key}/msgs`));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val) return [];
    return sortMessagesOldestFirst(Object.keys(val).map((k) => Object.assign({ id: k }, val[k])));
  } catch (err) {
    console.error('[messages] could not read the thread', err);
    return [];
  }
}

/** Live-watch one conversation while its screen is open. cb(messages). Returns an unsubscribe
 *  function, always - a caller must be able to tear down without checking anything. */
export async function watchThread(otherCode, cb) {
  const key = pairKey(myCode(), otherCode);
  if (!key) return () => {};
  try {
    const boot = await ready();
    if (!boot) return () => {};
    const { db, api } = boot;
    return api.onValue(api.ref(db, `messages/threads/${key}/msgs`), (s) => {
      const val = s.val() || {};
      cb(sortMessagesOldestFirst(Object.keys(val).map((k) => Object.assign({ id: k }, val[k]))));
    });
  } catch { return () => {}; }
}

/** Opening IS reading. Stamped from the newest message's own timestamp rather than from now, so a
 *  message that arrives WHILE the thread is open is still unread next time instead of being
 *  silently skipped (the same rule as js/bug-report-ui.js's markRepliesSeen). */
export async function markThreadSeen(otherCode, atMs) {
  const me = myCode(), to = asCode(otherCode);
  if (!me || !to || !writesAllowed('markThreadSeen')) return false;
  try {
    const boot = await ready();
    if (!boot) return false;
    const { db, api } = boot;
    await api.update(api.ref(db, `messages/index/${me}/${to}`), { seenAt: ms(atMs) || Date.now() });
    return true;
  } catch (err) { console.error('[messages] could not mark the thread read', err); return false; }
}

/**
 * Hide a conversation from MY list. A stamp, not a delete: the messages stay exactly where they
 * are, the other person's copy is untouched, and anything newer than the stamp brings the thread
 * straight back (visibleThreads). THE LAW rule 5's habit - the same reason the bug inbox's delete
 * is soft. There is deliberately no hard delete anywhere in this file.
 */
export async function hideThread(otherCode) {
  const me = myCode(), to = asCode(otherCode);
  if (!me || !to || !writesAllowed('hideThread')) return false;
  try {
    const boot = await ready();
    if (!boot) return false;
    const { db, api } = boot;
    await api.update(api.ref(db, `messages/index/${me}/${to}`), { hiddenAt: Date.now() });
    return true;
  } catch (err) { console.error('[messages] could not hide the thread', err); return false; }
}

/** Conversations with something waiting. 0 offline, so the profile pill shows no badge rather than
 *  claiming there is nothing there. */
export async function unreadMessageCount() {
  const me = myCode();
  if (!me) return 0;
  return countUnreadThreads(await readMyThreads(), me);
}

// --- who can I write to -----------------------------------------------------------------------

/**
 * Test and debug accounts, hidden from the recipient list.
 *
 * SECOND SITE, KEPT IN STEP BY HAND: `isHiddenRow()` in js/leaderboard-ui.js is the canonical copy
 * of this rule (and `test-leaderboard-rank.mjs` mirrors it a third time). It is duplicated rather
 * than imported because js/messages.js is a SHELL asset the launcher loads on every start just to
 * paint the pill's badge, and leaderboard-ui.js is the whole leaderboard overlay - the wrong thing
 * to drag onto that path. If the canonical list changes, change this one too.
 *
 * A PREFIX, never a substring: "Contest" and "Tess" are real names a real person could pick.
 */
const HIDDEN_NAMES = new Set(['qa', 'dev', 'demo', 'preview', 'prueba']);
const isTestName = (n) => {
  const s = (typeof n === 'string' ? n : '').trim().toLowerCase();
  return !s || s.startsWith('test') || s.startsWith('zzz') || HIDDEN_NAMES.has(s);
};

/**
 * The recipient list: one row per PERSON, not per device. aggregatePlayers() has already folded a
 * person's phones into one row (that is what js/players-agg.js is for), so Lili's two devices are
 * one entry here and a message reaches her on both.
 *
 * Rows with no player code cannot be addressed and are left out: a code is minted at the name gate,
 * so this only ever excludes a record from before that existed.
 */
export async function readContacts() {
  const me = myCode();
  try {
    const all = await readPlayersOnce();
    return aggregatePlayers(all)
      .filter((r) => r && asCode(r.playerId) && asCode(r.playerId) !== me
        && !isPlaceholderName(r.name) && !isTestName(r.name))
      .map((r) => ({ code: asCode(r.playerId), name: r.name, emoji: r.emoji || '🙂' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[messages] could not read the player list', err);
    return [];
  }
}

// --- offline outbox ---------------------------------------------------------------------------
// A message written on a phone with no signal is KEPT and retried on the next hub load, rather than
// lost with an apology. Same pattern as js/bug-report.js's outbox, and drained from the same place.

function readOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed && parsed.queue) ? parsed.queue : [];
  } catch { return []; }
}
function writeOutbox(queue) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, queue: queue.slice(-MAX_OUTBOX) }));
}

/** How many messages are waiting to be sent from this device. */
export function outboxCount() { return readOutbox().length; }

/** Keep a message that could not be sent. Returns true when it is safely queued. */
export function queueOutbox(item) {
  try { writeOutbox(readOutbox().concat([item])); return true; }
  catch (err) { console.error('[messages] could not queue the message', err); return false; }
}

/** Try everything waiting. Anything that still fails for a RETRYABLE reason stays queued; a message
 *  that can never succeed (no recipient, empty text) is dropped rather than retried forever.
 *  Returns how many were sent. */
export async function drainOutbox() {
  const queue = readOutbox();
  if (!queue.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of queue) {
    const res = await sendMessage(item);
    if (res.ok) sent += 1;
    else if (res.retryable) left.push(item);
    else console.warn('[messages] dropping an unsendable queued message:', res.reason);
  }
  try { writeOutbox(left); }
  catch (err) { console.error('[messages] could not update the outbox', err); }
  if (sent) console.info(`[messages] sent ${sent} message(s) that were waiting on this device.`);
  return sent;
}

// --- admin read-all ---------------------------------------------------------------------------

/**
 * Every conversation in the system, newest first, for the admin page's moderation view. Read-only:
 * there is no admin write path in this file at all, so nothing here can edit or remove what anyone
 * said.
 *
 * The RTDB rules, not this function, are what make it admin-only: reading `messages/threads` needs
 * `admins/<auth.uid> === true`, so anybody else gets a permission error here no matter how they
 * reached the call.
 *
 * Returns `{ threads, denied }`, not a bare array, because "no messages exist" and "this device is
 * not on the allowlist" must not render as the same empty screen - the second is a thing Matt has
 * to fix (his auth id changes when a browser's site data is cleared), and a screen that says
 * "No messages yet" would hide it.
 */
export async function readAllThreads() {
  try {
    const boot = await ready();
    if (!boot) return { threads: [], denied: false };
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, 'messages/threads'));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val) return { threads: [], denied: false };
    const threads = Object.keys(val).map((key) => {
      const msgs = sortMessagesOldestFirst(Object.values((val[key] || {}).msgs || {}));
      const parts = key.split('_');
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return { key, a: parts[0] || '', b: parts[1] || '', count: msgs.length, at: ms(last && last.atMs), msgs };
    }).sort((x, y) => y.at - x.at);
    return { threads, denied: false };
  } catch (err) {
    const denied = /permission|PERMISSION_DENIED/i.test(String((err && err.message) || err));
    console.error('[messages] could not read every thread', err);
    return { threads: [], denied };
  }
}

/** This device's anonymous auth id - the ONLY thing the RTDB rules can see about a client, and so
 *  the value that goes in `admins/<uid>`. Shown on the admin page so Matt can copy it. */
export async function authId() {
  try { const boot = await getStatsApp(); return (boot && boot.uid) || null; }
  catch { return null; }
}

export { isTestName };

export default {
  MAX_MESSAGE, asCode, normalizeText, previewOf, pairKey, otherInPair, isUnread, isTestName,
  countUnreadThreads, visibleThreads, sortMessagesOldestFirst, indexPatch, myCode,
  sendMessage, sendBroadcast, readMyThreads, readThread, watchThread, markThreadSeen,
  hideThread, unreadMessageCount, readContacts, queueOutbox, drainOutbox, outboxCount,
  readAllThreads, authId,
};
