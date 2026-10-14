// match-chat.js - QUICK CHAT INSIDE A MATCH, the data half, for EVERY multiplayer game (2026-10-14).
//
// Matt: "Why don't the new games with multiplayer have the quick chat stuff?" ... "add it to
// whatever documentation you need to add it to so that it's automatically built into new
// multiplayer games going forward." Connect 4 Hoops built in-match chat on 2026-09-22; Cup Pong,
// Darts, Flick Soccer, Skeeball challenges and Air Hockey copied Hoops' challenge system after
// that but not its chat, because chat lived inside hoops4/ and nothing told a new game it existed.
// This module is that chat, made shared. The DOM is js/match-chat-ui.js.
//
// A LINE is the hub's quick-chat payload `{ t, v }` (js/mp-reactions.js): t:'e' an emoji, t:'p' a
// preset phrase id, t:'c' free text. The RECEIVER resolves a preset in its own language, so Anita
// reads "¡Bien!" when Matt tapped "Nice!". The palette is the player's own (profile page).
//
// TWO TRANSPORTS, one panel:
//
//   TURN BY TURN  `<node>/chat/<matchId>/<key>` = `{ by: 'a'|'b', t, v, at }`, one child per line.
//                 A SIBLING of `<node>/games/`, NOT inside the match document. That is deliberate
//                 and it is the difference from Hoops (whose chat is `hoops/games/<id>/chat`): a
//                 game's `watchGame` listens to the whole match document, so a chat line inside it
//                 would wake the game's move handler on every message, and `validateGame` would
//                 have to learn to ignore it. Beside it, a chat line cannot touch the match, the
//                 replay, the turn, `updated`, either index row, the launcher's "your turn" bubble
//                 or the push functions (they watch `<node>/index/...` only). Every challenge
//                 node is `auth != null` read/write in database.rules.json with no per-child rules,
//                 so NO RULES CHANGE is needed for a new game either.
//   LIVE ROOM     `rooms/<CODE>/reactions/<seat>` via js/net.js `sendReaction` (the hub's existing
//                 facility: one slot per seat, overwritten by that seat's newest line), read back
//                 with `watchRoomReactions` here or from the game's own room callback.
//
// THE LAW: chat is not player history, and nothing here deletes anything. A turn-by-turn send is
// ADDITIVE (one new child at a fresh key, never a `set` over the list) and VERIFIED by a fresh
// re-read of that key (rule 6); a failure is returned, and the panel says so. No outbox: tap again.
// A malformed line is DROPPED on read, never a reason to refuse anything.
//
// NETWORK-FIRST in sw.js: it writes Firebase and a `gamehub.*` key (the seen marks).

import { getStatsApp } from './firebase-boot.js';

export const CHAT_MAXLEN = 120;     // Hoops' cap (Matt, 2026-09-24: "please increase that")
export const MAX_CHAT = 40;         // how many lines a match shows (the newest)
const TYPES = ['e', 'p', 'c'];
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const NODE_RE = /^[A-Za-z][A-Za-z0-9]{1,30}$/;
const ROOM_RE = /^[A-Za-z0-9]{3,12}$/;
const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** Trim a free-text line to what the panel holds. Never throws; always a string. */
export function cleanChat(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, CHAT_MAXLEN);
}

/** One payload, cleaned, or null. */
export function cleanPayload(p) {
  if (!p || !TYPES.includes(p.t)) return null;
  const v = p.t === 'c' ? cleanChat(p.v) : String(p.v == null ? '' : p.v).slice(0, CHAT_MAXLEN);
  return v ? { t: p.t, v } : null;
}

/** A stored chat list, cleaned: oldest first, the newest MAX_CHAT, every malformed entry DROPPED. */
export function chatFrom(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const key of Object.keys(raw)) {
    const c = raw[key];
    if (!c || typeof c !== 'object' || (c.by !== 'a' && c.by !== 'b')) continue;
    const p = cleanPayload(c);
    if (!p) continue;
    out.push({ key, by: c.by, t: p.t, v: p.v, at: ms(c.at) });
  }
  out.sort((x, y) => (x.at - y.at) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out.slice(-MAX_CHAT);
}

/** The other side's lines newer than `seenAt` - what "since you were last here" pops. */
export function unseenChat(chat, side, seenAt) {
  const since = ms(seenAt);
  return (Array.isArray(chat) ? chat : []).filter((c) => c && c.by !== side && c.at > since);
}

/** Where a turn-by-turn match's chat lives. Null for anything malformed. */
export function chatPath(node, id) {
  if (!NODE_RE.test(String(node || '')) || !ID_RE.test(String(id || ''))) return null;
  return `${node}/chat/${id}`;
}

function mintKey(side) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  try { const b = new Uint8Array(6); crypto.getRandomValues(b); for (const x of b) r += alphabet[x % 36]; }
  catch { for (let i = 0; i < 6; i++) r += alphabet[(Math.random() * 36) | 0]; }
  return Date.now().toString(36) + r + side;   // time-ordered, and two phones cannot collide
}

// --- a dev server never writes to the family's database (js/stats-net.js's guard and opt-in key) --
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function writesAllowed() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    const dev = h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
    if (!dev) return true;
    if (localStorage.getItem(DEV_SYNC_OK) === '1') return true;
    console.warn(`[match-chat] chat BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
    return false;
  } catch { return true; }
}

// TEST SEAM: test-match-chat.mjs hands in an in-memory database. No game calls it.
let bootFn = getStatsApp;
export function __setBootForTest(fn) { bootFn = fn || getStatsApp; }
async function ready() { try { return await bootFn(); } catch { return null; } }
const reasonOf = (err) => {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
};

/**
 * Say something in a turn-by-turn match. `side` is the sender's side of THAT match ('a' | 'b'),
 * which the game already knows from the match it has open. Any time: on either person's turn, and
 * on a finished match. Resolves `{ ok: true, entry }` or `{ ok: false, reason, retryable }`.
 */
export async function sendChat({ node, id, side }, payload) {
  const path = chatPath(node, id);
  if (!path) return { ok: false, reason: 'not-found', retryable: false };
  if (side !== 'a' && side !== 'b') return { ok: false, reason: 'not-your-game', retryable: false };
  const p = cleanPayload(payload);
  if (!p) return { ok: false, reason: 'empty', retryable: false };
  if (!writesAllowed()) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const key = mintKey(side);
    const entry = { by: side, t: p.t, v: p.v, at: Date.now() };
    await api.set(api.ref(db, `${path}/${key}`), entry);
    const back = await api.get(api.ref(db, `${path}/${key}`));
    const got = back && back.exists() ? back.val() : null;
    if (!got || got.v !== p.v || got.by !== side) {
      console.error(`[match-chat] VERIFY FAILED for ${path}/${key} - nothing landed.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    return { ok: true, entry: { key, ...entry } };
  } catch (err) {
    console.error('[match-chat] could not send the line', err);
    const reason = reasonOf(err);
    return { ok: false, reason, retryable: reason !== 'denied' };
  }
}

/** Watch one turn-by-turn match's chat. READ ONLY. `cb(list)` gets `chatFrom`'s cleaned list on
 *  every change. Resolves an unsubscribe that is always safe to call. */
export async function watchChat({ node, id }, cb) {
  const path = chatPath(node, id);
  if (!path) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, path), (snap) => {
      try { cb(chatFrom(snap && snap.exists() ? snap.val() : null)); }
      catch (err) { console.warn('[match-chat] chat callback', err); }
    }, () => { /* a denied or dropped watch keeps what it had */ });
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** LIVE ROOM: watch `rooms/<code>/reactions` (one slot per seat) for a game that does not already
 *  receive the whole room (Air Hockey's lobby listens narrowly). READ ONLY. `cb(reactions)` gets
 *  the raw `{ <seat>: { t, v, at } }` object, which match-chat-ui's `onReactions` understands. */
export async function watchRoomReactions(code, cb) {
  if (!ROOM_RE.test(String(code || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `rooms/${code}/reactions`), (snap) => {
      try { cb(snap && snap.exists() ? snap.val() : null); }
      catch (err) { console.warn('[match-chat] room reactions callback', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

// --- "since you were last here" ----------------------------------------------------------------
// `{ "<node>/<id>": <newest at seen> }`, the newest SEEN_MAX matches. A CONVENIENCE in the class of
// a launcher seen-list, never history: losing it re-pops a few old lines once.
export const SEEN_KEY = 'gamehub.matchChatSeen.v1';
const SEEN_MAX = 200;

export function readChatSeen(node, id) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return all && typeof all === 'object' ? ms(all[`${node}/${id}`]) : 0;
  } catch { return 0; }
}
export function markChatSeen(node, id, at) {
  if (!chatPath(node, id) || !(ms(at) > readChatSeen(node, id))) return;
  try {
    let all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if (!all || typeof all !== 'object') all = {};
    all[`${node}/${id}`] = ms(at);
    const keys = Object.keys(all);
    if (keys.length > SEEN_MAX) {
      keys.sort((x, y) => all[x] - all[y]);
      for (const k of keys.slice(0, keys.length - SEEN_MAX)) delete all[k];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* a convenience: a failure only re-pops a line */ }
}

export default {
  CHAT_MAXLEN, MAX_CHAT, cleanChat, cleanPayload, chatFrom, unseenChat, chatPath,
  sendChat, watchChat, watchRoomReactions, readChatSeen, markChatSeen, SEEN_KEY,
};
