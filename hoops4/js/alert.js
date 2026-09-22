// hoops4/js/alert.js - IS SOMEBODY WAITING ON YOU? The launcher's half of turn-by-turn.
//
// Matt, having played the shipped multiplayer: "to see a challenge, you must go into the hoops
// connect 4, click play a friend, then it's displayed below 'Challenge'. There is no other
// notification anywhere. Instead of that, can it be super obvious?"
//
// So the LAUNCHER asks this module, once per paint, whether any match wants attention, and draws
// a speech bubble on that game's tile if one does. Two states, and they are different events:
//
//   CHALLENGE  a match id this device has never seen. Somebody started one with you.
//   TURN       a match you have seen, where the turn has come back round to you.
//
// WHY THIS FILE IS IN hoops4/ AND NOT js/. It writes a `gamehub.*` key (the seen map below), and
// `test-sw-strategy.mjs` has a structural check that no CACHE-FIRST SHELL module does that - the
// shell's cache-first tier is for code that cannot go stale in a way that matters, and anything
// touching stored state is deliberately kept out of it. Living in the game's own folder puts it
// in the REST tier, where that rule does not apply, and keeps js/hub.js free of any one game's
// vocabulary: the hub only knows that a registry entry may declare an `alerts` module.
//
// NOTHING HERE IS PLAYER HISTORY. The seen map is a one-tap-recreatable preference (THE LAW rule
// 2's stated exemption, the same class as launcher favourites) - losing it shows a bubble twice,
// which is the harmless direction. It never writes to `hoops/`, so no match state is at risk.
import { readMyGames, myCode } from './mp.js';

export const SEEN_KEY = 'gamehub.hoops4.seen.v1';
const MAX_SEEN = 200;               // a ceiling against a map that only ever grows

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** The seen map: { [gameId]: the `updated` stamp that was acknowledged }. Never throws. */
export function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const k of Object.keys(raw)) if (ms(raw[k])) out[k] = ms(raw[k]);
    return out;
  } catch { return {}; }
}

function writeSeen(map) {
  try {
    let keys = Object.keys(map);
    // Oldest acknowledgements go first. A dropped entry re-shows one bubble; it loses nothing.
    if (keys.length > MAX_SEEN) {
      keys = keys.sort((a, b) => map[b] - map[a]).slice(0, MAX_SEEN);
      const trimmed = {};
      for (const k of keys) trimmed[k] = map[k];
      map = trimmed;
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch { /* private mode: the bubble simply shows again, which is the safe direction */ }
}

/**
 * PURE. Given index rows and the seen map, what should the launcher say?
 *
 * Returns null, or { kind:'challenge'|'turn', id, name, emoji, count }. `count` is how many
 * matches want attention in total, so one bubble can stand for three of them.
 *
 * ORDER MATTERS: a brand new match outranks a turn, because "somebody challenged you" is the
 * bigger event and the one with a person's name attached. Among equals, the most recent.
 */
export function decideAlert(rows, seen) {
  if (!Array.isArray(rows)) return null;
  const live = rows.filter((r) => r && r.id && !r.over && ms(r.updated) > ms(seen && seen[r.id]));
  if (!live.length) return null;
  const isNew = (r) => !(seen && seen[r.id]);
  // A challenge only counts as one while it is genuinely unseen AND still waiting on them: once
  // you have taken a shot the match is just a match, and the next nudge is an ordinary "your turn".
  const fresh = live.filter(isNew).sort((a, b) => ms(b.updated) - ms(a.updated));
  const mine = live.filter((r) => r.yourTurn).sort((a, b) => ms(b.updated) - ms(a.updated));
  const pick = fresh[0] || mine[0];
  if (!pick) return null;
  return {
    kind: fresh[0] ? 'challenge' : 'turn',
    id: pick.id,
    name: String(pick.name || ''),
    emoji: String(pick.emoji || '🙂'),
    count: live.length,
  };
}

/** Acknowledge one match up to `updated`, so its bubble stops until something new happens. */
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  writeSeen(map);
}

// The rows behind the alert the launcher is currently showing, so `markSeen` has an `updated` to
// record and the ceremony has something to open. Set by check(), read by take().
let lastRows = [];

/**
 * THE LAUNCHER'S ONE QUESTION, asked once per paint. Resolves to an alert or null, and never
 * rejects - a game tile must not be able to break the launcher.
 */
export async function check() {
  try {
    if (!myCode()) return null;
    const rows = await readMyGames();
    lastRows = Array.isArray(rows) ? rows : [];
    return decideAlert(lastRows, readSeen());
  } catch (err) {
    console.warn('[hoops4] could not check for challenges', err);
    return null;
  }
}

/** The row behind an alert id, for the ceremony. */
export function rowFor(id) {
  return lastRows.find((r) => r && r.id === id) || null;
}

// --- the ceremony handoff ----------------------------------------------------------------------
// ARMED, NEVER BACKFILLED - the same shape as skeeball's key ceremony. The launcher arms this when
// the player taps the bubble or the tile; hoops4's ui.js takes it on mount and shows the
// full-screen card. An absent entry means "no ceremony owed", so a device that has never seen a
// bubble never gets one retroactively.
const ARM_KEY = 'gamehub.hoops4.ceremony.v1';

/** Arm the full-screen card for the next mount. `alert` is what decideAlert returned. */
export function armCeremony(alert) {
  try {
    if (!alert) return;
    sessionStorage.setItem(ARM_KEY, JSON.stringify({
      kind: alert.kind, id: alert.id, name: alert.name, emoji: alert.emoji, count: alert.count | 0,
    }));
  } catch { /* no session storage: the game simply opens without the card */ }
}

/** Take it, once. Returns the armed alert or null, and clears it either way. */
export function takeCeremony() {
  try {
    const raw = sessionStorage.getItem(ARM_KEY);
    sessionStorage.removeItem(ARM_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a || (a.kind !== 'challenge' && a.kind !== 'turn')) return null;
    return { kind: a.kind, id: String(a.id || ''), name: String(a.name || ''),
      emoji: String(a.emoji || '🙂'), count: a.count | 0 };
  } catch { return null; }
}
