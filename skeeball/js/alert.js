// skeeball/js/alert.js - the launcher's half of Skeeball challenges: a speech bubble on the tile
// when somebody challenged you, or a challenge you sent has been answered.
//
// The hub's generic `alerts` hook (js/hub.js _checkGameAlerts), the same one hoops4/js/alert.js
// registers. The hub only knows the SHAPE returned here, never what a Skeeball challenge is:
//
//   challenge  an unanswered challenge to you this device has not acknowledged
//   over       one you SENT that the other person has now played (won / lost / draw)
//   turn       (hub wording "Your turn vs <names>") never raised here: a challenge's `updated`
//              does not move until it is answered, so a seen one simply waits in the game's list
//
// Nothing here is player history (see challenge.js). It lives in skeeball/, not js/, because it
// writes a `gamehub.*` key and the cache-first shell may not (root CLAUDE.md, sw.js strategy).
import { readMyChallenges, watchMyChallenges, readSeen, markSeen, myCode, isExpired, flushOutbox } from './challenge.js';

export { readSeen, markSeen };

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** PURE: rows + seen map -> null | { kind, id, name, emoji, result?, names, count }. */
export function decideAlert(rows, seen, now = Date.now()) {
  if (!Array.isArray(rows)) return null;
  const unseen = (r) => ms(r.updated) > ms(seen && seen[r.id]);
  const fresh = rows.filter((r) => r && r.id && !r.over && r.yourTurn && !isExpired(r, now) && unseen(r))
    .sort((a, b) => ms(b.updated) - ms(a.updated));
  const ended = rows.filter((r) => r && r.id && r.over && r.sent && unseen(r))
    .sort((a, b) => ms(b.updated) - ms(a.updated));
  if (fresh.length) {
    const r = fresh[0];
    return { kind: 'challenge', id: r.id, name: r.name, emoji: r.emoji, names: [], count: fresh.length + ended.length };
  }
  if (ended.length) {
    const r = ended[0];
    return { kind: 'over', id: r.id, name: r.name, emoji: r.emoji,
      result: r.result === 'won' || r.result === 'lost' ? r.result : 'draw', names: [], count: ended.length };
  }
  return null;
}

let lastRows = [];

/** Asked once per launcher paint. Never rejects. Also sends any score this device still owes. */
export async function check() {
  try {
    if (!myCode()) return null;
    try { await flushOutbox(); } catch { /* retried next time */ }
    lastRows = await readMyChallenges();
    return decideAlert(lastRows, readSeen());
  } catch (err) {
    console.warn('[skeeball] could not check for challenges', err);
    return null;
  }
}

/** LIVE, while the launcher is up. Returns an unsubscribe. Never throws. */
export async function watch(cb) {
  try {
    if (!myCode()) return () => {};
    return await watchMyChallenges((rows) => {
      lastRows = Array.isArray(rows) ? rows : [];
      try { cb(decideAlert(lastRows, readSeen())); } catch (err) { console.warn('[skeeball] alert watch', err); }
    });
  } catch { return () => {}; }
}

export function rowFor(id) {
  return lastRows.find((r) => r && r.id === id) || null;
}

/** A result bubble is acknowledged by the game's own result card (or the bubble's X). */
export function markResultSeen(id) {
  const r = rowFor(id);
  markSeen(id, r ? r.updated : Date.now());
}

// --- the handoff to the game ------------------------------------------------------------------
// Tapping the bubble arms this; skeeball/js/ui.js takes it on mount and opens the challenge list
// (or that result) straight away. Session-only and armed, never backfilled.
const ARM_KEY = 'gamehub.skeeball.challengeArm.v1';

export function armCeremony(alert) {
  try {
    if (!alert) return;
    sessionStorage.setItem(ARM_KEY, JSON.stringify({ kind: alert.kind, id: alert.id }));
  } catch { /* the game simply opens on its gallery */ }
}

export function takeCeremony() {
  try {
    const raw = sessionStorage.getItem(ARM_KEY);
    sessionStorage.removeItem(ARM_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a || (a.kind !== 'challenge' && a.kind !== 'over')) return null;
    return { kind: a.kind, id: String(a.id || '') };
  } catch { return null; }
}
