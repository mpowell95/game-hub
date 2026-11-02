// lb2-lost.js - Leaderboard v2's "Lost records" (2026-11-02, Matt: "so you can see if someone overtook you").
// PURE diff + a small per-device cache `gamehub.lb2.held.v1`: { v:1, byKey: { <viewer key>: { held: {<game>: <firstSeenMs>},
// lost: [{ game, takenBy: [names], at }] } } }. A preference-class cache (never synced, nothing earned lives
// here): the last seen set of games the viewer holds (rank 1, ties count) and the ones taken since.
// Names only, never player codes. First run seeds the held set with no losses.
export const LOST_KEY = 'gamehub.lb2.held.v1';
export const LOST_CAP = 50;

/** state = { held: {game: ms}, lost: [{game, takenBy, at}] } or null (first run). `now` = { <game>: { mine, by } }
 *  for every game whose standing is known (mine = viewer is rank 1, by = names of the OTHER rank-1 holders).
 *  A game missing from `now` is unknown: left exactly as it was. Returns a new state. */
export function diffHeld(state, now, at) {
  const seeded = !!(state && state.held);
  const held = { ...((state && state.held) || {}) };
  let lost = ((state && state.lost) || []).map((x) => ({ ...x, takenBy: (x.takenBy || []).slice() }));
  for (const game of Object.keys(now || {})) {
    const n = now[game];
    if (n.mine) {
      if (!(game in held)) held[game] = at;
      lost = lost.filter((x) => x.game !== game);               // taken back
    } else if (game in held) {
      delete held[game];
      if (seeded && n.by && n.by.length) lost.unshift({ game, takenBy: n.by.slice(), at });
    } else {
      const e = lost.find((x) => x.game === game);              // still lost: show who holds it now
      if (e && n.by && n.by.length) e.takenBy = n.by.slice();
    }
  }
  lost.sort((a, b) => b.at - a.at);
  return { held, lost: lost.slice(0, LOST_CAP) };
}

function readAll() {
  try { const o = JSON.parse(localStorage.getItem(LOST_KEY) || 'null'); return o && o.byKey ? o : { v: 1, byKey: {} }; } catch { return { v: 1, byKey: {} }; }
}
export function loadLost(viewerKey) { const s = readAll().byKey[viewerKey]; return s && s.held ? s : null; }
/** Diff against what this device saw last and store it; returns the new state. Never throws. */
export function noteHeld(viewerKey, now, at = Date.now()) {
  if (!viewerKey) return null;
  const next = diffHeld(loadLost(viewerKey), now, at);
  try {
    const all = readAll();
    all.byKey[viewerKey] = next;
    localStorage.setItem(LOST_KEY, JSON.stringify(all));
    if (localStorage.getItem(LOST_KEY) == null) console.error('[lb2-lost] could not store');   // rule 6
  } catch (err) { console.error('[lb2-lost] could not store', err); }
  return next;
}
