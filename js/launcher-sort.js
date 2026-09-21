// launcher-sort.js - how the "All games" group on the launcher is ordered, stored at
// localStorage["gamehub.launchersort.v1"]. Pure and DOM-free, same shape as js/favorites.js.
//
// Contract: { version:1, sort:'alpha'|'new', updatedAt }
//
// THE LAW does not govern this key: it protects history and achievement data a player earned and
// cannot recreate. A sort order is a user-controlled preference restorable in one tap, so changing
// it is user intent, not data loss (root CLAUDE.md's THE LAW rule 2 carve-out, the same class as
// favorites, theme, language and the leaderboard's own sort).
//
// FAVORITES ARE NEVER SORTED BY THIS. They sit above the list in the player's OWN custom order
// (js/favorites.js's stored `ids` array IS that order), and reordering them is a separate control.
// This decides the order of everything below that group only.

const KEY = 'gamehub.launchersort.v1';

/** The orders the launcher offers. 'alpha' is the default and the pre-existing behaviour. */
export const SORTS = ['alpha', 'new'];
export const DEFAULT_SORT = 'alpha';

/** Read the stored order. Anything missing or malformed reads as the default; never throws. */
export function loadSort() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SORT;
    const v = JSON.parse(raw);
    return (v && SORTS.includes(v.sort)) ? v.sort : DEFAULT_SORT;
  } catch { return DEFAULT_SORT; }
}

/** Store the order. Returns what is now in force, so a rejected value still reads correctly. */
export function saveSort(sort) {
  const next = SORTS.includes(sort) ? sort : DEFAULT_SORT;
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, sort: next, updatedAt: new Date().toISOString() }));
  } catch { /* best-effort; never throw into the caller */ }
  return next;
}

/**
 * Order a list of games.
 *
 * `msOf(game)` returns that game's release time in epoch ms, or null when it has none, and
 * `titleOf(game)` its DISPLAYED title. Both are passed in rather than imported: this module stays
 * pure and headless-testable, and the caller already owns the language-resolved title and the
 * admin config (the same reason js/leaderboard-rank.js takes its metric accessors as arguments).
 *
 * NEWEST puts the games that HAVE a release date first, most recent first, and everything with no
 * date after them in alphabetical order. That is the honest answer rather than a tidy one: only a
 * third of this registry carries a `released` date, the pre-existing games deliberately carry none
 * (root CLAUDE.md: do NOT backfill git commit dates, they are not release dates), and inventing a
 * date to sort by would be exactly the fabrication THE LAW rule 4 forbids on the stats side. An
 * undated game is not claimed to be old, it is simply not claimed to be new.
 *
 * Ties break on title, so the order is total and a re-render can never shuffle two games past each
 * other.
 */
export function sortGames(games, sort, msOf, titleOf) {
  const list = [...games];
  const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b));
  if (sort !== 'new') return list.sort(byTitle);
  return list.sort((a, b) => {
    const ma = msOf(a), mb = msOf(b);
    const da = Number.isFinite(ma) ? ma : null;
    const db = Number.isFinite(mb) ? mb : null;
    if (da === null && db === null) return byTitle(a, b);
    if (da === null) return 1;
    if (db === null) return -1;
    if (da !== db) return db - da;
    return byTitle(a, b);
  });
}

export default { KEY, SORTS, DEFAULT_SORT, loadSort, saveSort, sortGames };
