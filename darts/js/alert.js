// darts/js/alert.js - what the LAUNCHER says about Darts challenges (2026-10-01).
//
// js/hub.js knows only that a registry entry may declare an `alerts` module with check(), watch(),
// armCeremony(), armOpen(), rowFor(), markSeen() and markResultSeen(); the words are the hub's and
// the decision is here. Cup Pong's alert.js is the model, and Hoops' before it (hoops4/CLAUDE.md,
// "The challenge has to reach you on the LAUNCHER"). It lives in the game folder, not js/, because
// it writes `gamehub.*` keys, which no cache-first shell module may do.
import { readMyGames, myCode, watchMyGames, readSeen, markSeen, SEEN_KEY, recordFinished, readUnseen,
  markResultSeen } from './mp.js';

export { readSeen, markSeen, SEEN_KEY, markResultSeen };

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * PURE. null, or { kind:'challenge'|'turn'|'over', id, name, emoji, names, count, result? }.
 * A match this device has never seen is a challenge (its own writes stamp the seen map, so only the
 * other person's can be news); one whose `updated` moved past the stamp with the turn yours is a
 * turn; a result this device never watched end is 'over'. A challenge outranks the rest.
 */
export function decideAlert(rows, seen, unseen = []) {
  if (!Array.isArray(rows)) return null;
  const live = rows.filter((r) => r && r.id && !r.over && ms(r.updated) > ms(seen && seen[r.id]));
  const ended = rows.filter((r) => r && r.id && r.over && Array.isArray(unseen) && unseen.includes(r.id))
    .sort((a, b) => ms(b.updated) - ms(a.updated));
  const isNew = (r) => !(seen && seen[r.id]);
  const fresh = live.filter((r) => isNew(r) && r.yourTurn).sort((a, b) => ms(b.updated) - ms(a.updated));
  const mine = live.filter((r) => r.yourTurn).sort((a, b) => ms(b.updated) - ms(a.updated));
  if (ended.length && !fresh.length) {
    const r = ended[0];
    return { kind: 'over', id: r.id, name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      result: r.result === 'won' ? 'won' : 'lost', names: [], count: ended.length };
  }
  const pick = fresh[0] || mine[0];
  if (!pick) return null;
  return {
    names: [...new Set(mine.map((r) => String(r.name || '')).filter(Boolean))],
    kind: fresh[0] ? 'challenge' : 'turn',
    id: pick.id, name: String(pick.name || ''), emoji: String(pick.emoji || '🙂'),
    count: mine.length,
  };
}

let lastRows = [];

/** Asked once per launcher paint. Never rejects: a game tile must not be able to break the launcher. */
export async function check() {
  try {
    if (!myCode()) return null;
    lastRows = await readMyGames();
    try { recordFinished(lastRows); } catch (err) { console.warn('[darts] recordFinished', err); }
    return decideAlert(lastRows, readSeen(), readUnseen());
  } catch (err) { console.warn('[darts] could not check for challenges', err); return null; }
}

/** LIVE while the launcher is up: `cb(alert | null)` on every change to your match list. */
export async function watch(cb) {
  try {
    if (!myCode()) return () => {};
    return await watchMyGames((rows) => {
      lastRows = Array.isArray(rows) ? rows : [];
      try { recordFinished(lastRows); } catch { /* counted on the next open instead */ }
      try { cb(decideAlert(lastRows, readSeen(), readUnseen())); } catch (err) { console.warn('[darts] alert watch', err); }
    });
  } catch { return () => {}; }
}

export function rowFor(id) { return lastRows.find((r) => r && r.id === id) || null; }

/** How many matches are waiting on you, from the last read: the hub's Challenges button badge. */
export function myTurnCount() { return lastRows.filter((r) => r && !r.over && r.yourTurn).length; }

// The handoff to the game's next mount: which match to open (sessionStorage, taken once).
const ARM_KEY = 'gamehub.darts.open.v1';
export function armCeremony(alert) {
  try { if (alert && alert.id) sessionStorage.setItem(ARM_KEY, JSON.stringify({ kind: alert.kind, id: String(alert.id) })); } catch { /* opens on setup */ }
}
/** A tapped notification names its match (js/hub.js `_openPushedGame`). */
export function armOpen(id) {
  try { if (id) sessionStorage.setItem(ARM_KEY, JSON.stringify({ kind: 'open', id: String(id) })); } catch { /* opens on setup */ }
}
/** The hub's Challenges screen (js/challenges-ui.js, 2026-10-05): open straight onto "challenge
 *  <them>" with that person already picked. `them` is { code, name, emoji }. */
export function armChallenge(them) {
  try {
    if (!them || !them.code) return;
    sessionStorage.setItem(ARM_KEY, JSON.stringify({ kind: 'pick',
      them: { code: String(them.code), name: String(them.name || ''), emoji: String(them.emoji || '🙂') } }));
  } catch { /* opens on setup */ }
}
/** Take it, once: { kind, id } or { kind: 'pick', them } or null. */
export function takeOpen() {
  try {
    const raw = sessionStorage.getItem(ARM_KEY);
    sessionStorage.removeItem(ARM_KEY);
    const a = raw ? JSON.parse(raw) : null;
    if (a && a.kind === 'pick' && a.them && a.them.code) {
      return { kind: 'pick', them: { code: String(a.them.code), name: String(a.them.name || ''), emoji: String(a.them.emoji || '🙂') } };
    }
    return a && a.id ? { kind: String(a.kind || 'open'), id: String(a.id) } : null;
  } catch { return null; }
}
