// js/hub-messages.js - messages FROM THE GAME HUB itself (2026-10-14).
//
// Matt: "Draft an inbox message to king of games from the gamehub" ... "No reply box. Just a
// notification from the hub." Every other message is one player writing to another
// (js/messages.js, Firebase `messages/`). These are different on purpose:
//
//   - They live HERE, in code. Sending one = appending an entry and deploying. No Firebase node, no
//     rules change, no Cloud Function: nothing that Matt has to publish by hand before it works, and
//     nothing a player's device can write.
//   - They are addressed by PLAYER CODE (`to`), like Messages, so every phone a person owns gets it.
//   - They show as ONE "Game Hub" conversation in the inbox, with the hub's own icon, newest first
//     among the person's other conversations. No reply box, no Hide.
//   - An entry can carry `play: '<hubId>'`: the bubble gets a Play button that loads the newest
//     build and that game's newest files first, then opens the game (js/hub.js `openGameFresh`).
//   - Read state is a PREFERENCE (THE LAW rule 2's carve-out): `gamehub.hubMessages.v1` =
//     `{ seen: { <CODE>: <newest message's own atMs> }, read: { <id>: { code, at } } }`. `read`
//     is WHEN each message was first opened, kept for Matt's read receipt: js/stats-net.js mirrors
//     it to `players/<id>/hubMsgs` (a REPORT, never read back by any phone) and the admin page's
//     "Game Hub messages" section shows Read <time> / Not yet per recipient.
//
// APPEND ONLY. Never reuse or renumber an `id`; never edit a sent message's words (someone has read
// them). Times are fixed epoch ms, never Date.now() (a message's time is when it was SENT).
// No phone notification goes out for these: that would need a Cloud Function (root CLAUDE.md, "Push
// notifications"). The person sees it next time they open the hub (badge on Messages).

import { getLang } from './i18n.js';

/** The sender's stand-in code on an inbox row. Not a player code (asCode() rejects it), so nothing
 *  that looks a person up by code can ever mistake it for one. */
export const HUB_CODE = 'HUB';

export const HUB_MESSAGES = [
  {
    id: 'arrow-maze-rush-3vn33',
    to: ['3VN33'],                                   // King of Games
    atMs: Date.UTC(2026, 9, 14, 22, 45),
    text: {
      en: 'Arrow Maze is back, with a new mode: Rush! 🎯',
      es: '¡Laberinto de flechas ha vuelto, con un modo nuevo: Rush! 🎯',
    },
    play: 'way-out',
  },
];

const KEY = 'gamehub.hubMessages.v1';
const CODE_RE = /^[A-Z2-9]{5}$/;
const HUB_ID_RE = /^[a-z0-9-]{2,40}$/;

const asCode = (v) => {
  const s = (typeof v === 'string' ? v : '').trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
};

/** The words in the chosen language, English when that one is missing. */
export function hubText(m, lang = getLang()) {
  const t = (m && m.text) || {};
  return String(t[lang] || t.en || '');
}

/** The hub id a Play button opens, or '' (a malformed entry shows no button rather than a broken one). */
export function playOf(m) {
  const p = m && typeof m.play === 'string' ? m.play : '';
  return HUB_ID_RE.test(p) ? p : '';
}

/** Messages for this code, OLDEST first (reading order). Pure; `list` is injectable for tests. */
export function hubMessagesFor(code, list = HUB_MESSAGES) {
  const me = asCode(code);
  if (!me) return [];
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && Array.isArray(m.to) && m.to.map(asCode).includes(me) && Number(m.atMs) > 0)
    .slice()
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function readStore() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object' && v.seen && typeof v.seen === 'object') {
      if (!v.read || typeof v.read !== 'object') v.read = {};
      return v;
    }
  } catch { /* unreadable: treat as nothing seen */ }
  return { seen: {}, read: {} };
}

/** When this code last read the Game Hub conversation (its newest message's own time), else 0. */
export function hubSeenAt(code) {
  const me = asCode(code);
  return me ? Number(readStore().seen[me]) || 0 : 0;
}

/** Mark the Game Hub conversation read up to `atMs`, and stamp WHEN each message in it was first
 *  opened (the read receipt). Only ever moves forward. Returns true when something new was stamped.
 *  Logged, never thrown. */
export function markHubSeen(code, atMs, now = Date.now()) {
  const me = asCode(code);
  const at = Number(atMs) || 0;
  if (!me || !at) return false;
  try {
    const store = readStore();
    let changed = false;
    if ((Number(store.seen[me]) || 0) < at) { store.seen[me] = at; changed = true; }
    for (const m of hubMessagesFor(me)) {
      if (Number(m.atMs) <= at && !store.read[m.id]) { store.read[m.id] = { code: me, at: now }; changed = true; }
    }
    if (!changed) return false;
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (err) { console.error('[hub-messages] could not save read state', err); return false; }
}

/** The read receipt this device reports (js/stats-net.js `hubMsgs`), or null when it has opened
 *  none - null is OMITTED from the mirror, so a cleared phone never blanks an earlier report. */
export function hubReadReport(list = HUB_MESSAGES) {
  const { seen, read } = readStore();
  const out = {};
  for (const id of Object.keys(read)) {
    const r = read[id];
    if (r && asCode(r.code) && Number(r.at) > 0) out[id] = { code: asCode(r.code), at: Number(r.at) };
  }
  // Opened on a build from before the receipt existed: `seen` says it was read, nobody wrote down
  // when. Reported as read with `at: 0` (time unknown) rather than not at all, or as a made-up time.
  for (const code of Object.keys(seen)) {
    for (const m of hubMessagesFor(code, list)) {
      if (!out[m.id] && Number(seen[code]) >= Number(m.atMs)) out[m.id] = { code: asCode(code), at: 0 };
    }
  }
  return Object.keys(out).length ? { read: out, at: Date.now() } : null;
}

/** Has `code` opened message `id`, and when, across a set of mirrored player records (the admin
 *  page's read of `players/`): `{ read, at }`, `at` 0 when the time is unknown. The earliest
 *  reported time wins (two phones). Pure. */
export function readStatusFor(players, id, code) {
  const c = asCode(code);
  let read = false, at = 0;
  for (const rec of Object.values(players || {})) {
    const r = rec && rec.hubMsgs && rec.hubMsgs.read && rec.hubMsgs.read[id];
    if (!r || asCode(r.code) !== c) continue;
    read = true;
    const t = Number(r.at) || 0;
    if (t > 0 && (!at || t < at)) at = t;
  }
  return { read, at };
}

/**
 * The inbox row for the Game Hub conversation, shaped like a `messages/index` row so isUnread(),
 * countUnreadThreads() and the list renderers treat it like any other. Null when there is nothing
 * for this code. `seenAt` is injectable for tests.
 */
export function hubThreadRow(code, { list = HUB_MESSAGES, lang = getLang(), seenAt } = {}) {
  const msgs = hubMessagesFor(code, list);
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  return {
    code: HUB_CODE, hub: true, from: HUB_CODE, name: 'Game Hub', emoji: '',
    at: Number(last.atMs), seenAt: seenAt == null ? hubSeenAt(code) : Number(seenAt) || 0,
    preview: hubText(last, lang).replace(/\s+/g, ' ').trim().slice(0, 60),
  };
}

/** Merge the Game Hub row into a newest-first list of conversations. Pure. */
export function withHubRow(rows, row) {
  const list = Array.isArray(rows) ? rows.filter((r) => !(r && r.hub)) : [];
  if (!row) return list;
  return list.concat([row]).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
}
