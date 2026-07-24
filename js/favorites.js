// favorites.js — hub-only launcher favorites, stored at localStorage["gamehub.favorites.v1"].
// Pure, DOM-free. Stores hub REGISTRY ids (GAMES[].id, e.g. 'tic-tac-toe'), never stats keys
// (e.g. 'tictactoe') - same dashed/undashed trap as every other game handoff.
//
// Contract: { version:1, ids:['escoba','tic-tac-toe'], updatedAt }
// An id that no longer matches a registered game is ignored on READ but never pruned from
// storage - if a game is temporarily unregistered, its favorite returns when the game does.
//
// THE LAW does not govern this key: THE LAW protects history/achievement data a player earned
// and cannot recreate. A favorite is a user-controlled preference restorable in one tap, so
// removal here is user intent, not data loss (see CLAUDE.md's THE LAW carve-out).

const KEY = 'gamehub.favorites.v1';

/** Validate/normalize any value into a list of ids, or [] if not usable. */
function normalize(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of v.ids) {
    if (typeof id !== 'string' || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Read the favorited hub ids. Returns [] on missing/malformed data; never throws. */
export function loadFavorites() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : [];
  } catch { return []; }
}

function persist(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, ids, updatedAt: new Date().toISOString() }));
  } catch { /* best-effort; never throw into the caller */ }
}

/** True if `id` is currently favorited. */
export function isFavorite(id) {
  return loadFavorites().includes(id);
}

/** Flip the favorite state of `id`, persist it, and return the NEW state (true = now favorited). */
export function toggleFavorite(id) {
  const ids = loadFavorites();
  const i = ids.indexOf(id);
  const next = i === -1;
  if (next) ids.push(id); else ids.splice(i, 1);
  persist(ids);
  return next;
}

/** Move `id` by `delta` slots (-1 up, +1 down) in the stored order. The `ids` array IS the
 *  favorites display order (batch 4, 2026-07-23) - this is a pure splice, no new storage key,
 *  no shape change. No-op (returns the unchanged order) if `id` isn't favorited or the move
 *  would go out of bounds. */
export function moveFavorite(id, delta) {
  const ids = loadFavorites();
  const i = ids.indexOf(id);
  if (i === -1) return ids;
  const j = i + delta;
  if (j < 0 || j >= ids.length) return ids;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  persist(ids);
  return ids;
}

export default { loadFavorites, isFavorite, toggleFavorite, moveFavorite };
