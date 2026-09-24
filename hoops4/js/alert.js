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
import { readMyGames, myCode, watchMyGames, readSeen, markSeen, armTurn, readGame, sideOf, SEEN_KEY,
  recordFinished, readUnseen, markResultSeen } from './mp.js';

// The seen map moved to mp.js (2026-09-23) so that mp.js's own writes can stamp it - see there.
// Re-exported so callers (js/hub.js, the tests) keep one import site.
export { readSeen, markSeen, SEEN_KEY, markResultSeen };

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * PURE. Given index rows and the seen map, what should the launcher say?
 *
 * Returns null, or { kind:'challenge'|'turn', id, name, emoji, count }. `count` is how many
 * matches want attention in total, so one bubble can stand for three of them.
 *
 * ORDER MATTERS: a brand new match outranks a turn, because "somebody challenged you" is the
 * bigger event and the one with a person's name attached. Among equals, the most recent.
 */
export function decideAlert(rows, seen, unseen = []) {
  if (!Array.isArray(rows)) return null;
  const live = rows.filter((r) => r && r.id && !r.over && ms(r.updated) > ms(seen && seen[r.id]));
  // (2026-09-24) A MATCH THAT ENDED WHILE YOU WERE AWAY: "GAME OVER - You lost vs <name>". Below a
  // new challenge, above an ordinary turn. `unseen` is mp.js's readUnseen(); the game's own Game
  // Over popup clears it, so the bubble goes when the popup has been seen.
  const ended = rows.filter((r) => r && r.id && r.over && Array.isArray(unseen) && unseen.includes(r.id))
    .sort((a, b) => ms(b.updated) - ms(a.updated));
  if (!live.length && !ended.length) return null;
  const isNew = (r) => !(seen && seen[r.id]);
  if (ended.length && !live.some(isNew)) {
    const r = ended[0];
    return { kind: 'over', id: r.id, name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      result: r.result === 'won' || r.result === 'lost' ? r.result : 'draw', names: [], count: ended.length };
  }
  // A challenge only counts as one while it is genuinely unseen AND still waiting on them: once
  // you have taken a shot the match is just a match, and the next nudge is an ordinary "your turn".
  const fresh = live.filter(isNew).sort((a, b) => ms(b.updated) - ms(a.updated));
  const mine = live.filter((r) => r.yourTurn).sort((a, b) => ms(b.updated) - ms(a.updated));
  const pick = fresh[0] || mine[0];
  if (!pick) return null;
  // (2026-09-23) EVERY NAME WAITING ON YOU, newest first. Matt: "when the Your Turn pops up, it
  // should say the peoples names who i'm playing against where it's my turn."
  const names = [...new Set(mine.map((r) => String(r.name || '')).filter(Boolean))];
  return {
    names,
    kind: fresh[0] ? 'challenge' : 'turn',
    id: pick.id,
    name: String(pick.name || ''),
    emoji: String(pick.emoji || '🙂'),
    count: live.length,
  };
}

// CHALLENGES SENT BEFORE THE FIRST SHOT DELIVERED THEM (2026-09-23). Until then createGame told
// the other person at once, and stamped the sender's own seen map at `updated` - so a sender who
// walked away without shooting was never reminded, and the person they challenged opened a board
// that was not their turn. The King of Games' challenge to Matt is sitting exactly like that.
// createGame now arms "your turn" itself (mp.js armTurn); this re-arms the ones made before it,
// ONCE per match: a first game (seriesNo 1, so this device made it), on its side 'a', its turn,
// with no shot in it yet. Only matches made before the fix are looked at, so a reminder the
// player has since closed stays closed. Reads a match only when its row already fits.
const UNSHOT_BEFORE = Date.parse('2026-09-24T00:00:00Z');
const UNSHOT_KEY = 'gamehub.hoops4.unshot.v1';
async function rearmUnshot(rows) {
  let done;
  try { done = new Set(JSON.parse(localStorage.getItem(UNSHOT_KEY) || '[]')); } catch { done = new Set(); }
  const todo = rows.filter((r) => r && r.id && !r.over && r.yourTurn && (r.seriesNo | 0) <= 1
    && ms(r.updated) < UNSHOT_BEFORE && !done.has(r.id));
  if (!todo.length) return;
  const me = myCode();
  for (const r of todo) {
    const g = await readGame(r.id);
    if (!g) continue;                  // could not read it: try again next time
    if (!g.over && !g.moves.length && g.turn === 'a' && sideOf(g, me) === 'a') armTurn(r.id, r.updated);
    done.add(r.id);
  }
  try { localStorage.setItem(UNSHOT_KEY, JSON.stringify([...done].slice(-200))); } catch { /* shows again: harmless */ }
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
    await rearmUnshot(lastRows);
    try { recordFinished(lastRows); } catch (err) { console.warn('[hoops4] recordFinished', err); }
    return decideAlert(lastRows, readSeen(), readUnseen());
  } catch (err) {
    console.warn('[hoops4] could not check for challenges', err);
    return null;
  }
}

/**
 * LIVE: call `cb(alert | null)` every time the match list changes, while the launcher is up.
 * Matt: "If i'm in the hub and someone plays me back, will I see?" - with only check() he would
 * not, until the launcher next painted. Returns an unsubscribe. Never throws.
 */
export async function watch(cb) {
  try {
    if (!myCode()) return () => {};
    return await watchMyGames(async (rows) => {
      lastRows = Array.isArray(rows) ? rows : [];
      try { await rearmUnshot(lastRows); } catch { /* the plain decision below still stands */ }
      try { recordFinished(lastRows); } catch { /* counted on the next open instead */ }
      try { cb(decideAlert(lastRows, readSeen(), readUnseen())); } catch (err) { console.warn('[hoops4] alert watch', err); }
    });
  } catch { return () => {}; }
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

/** A tapped NOTIFICATION names its match: open that match directly on the next mount, no card.
 *  (2026-09-24, js/hub.js `_openPushedGame`.) Same handoff key, kind 'open'. */
export function armOpen(id) {
  try {
    if (!id) return;
    sessionStorage.setItem(ARM_KEY, JSON.stringify({ kind: 'open', id: String(id), name: '', emoji: '', count: 0 }));
  } catch { /* no session storage: the game opens on its setup screen, as before */ }
}

/** Take it, once. Returns the armed alert or null, and clears it either way. */
export function takeCeremony() {
  try {
    const raw = sessionStorage.getItem(ARM_KEY);
    sessionStorage.removeItem(ARM_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a || (a.kind !== 'challenge' && a.kind !== 'turn' && a.kind !== 'open')) return null;
    return { kind: a.kind, id: String(a.id || ''), name: String(a.name || ''),
      emoji: String(a.emoji || '🙂'), count: a.count | 0 };
  } catch { return null; }
}
