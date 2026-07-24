// Headless unit tests for js/favorites.js. Run: node favorites.test.mjs
// js/favorites.js reads localStorage, so this test installs a minimal in-memory
// localStorage shim before importing it (same reasoning as any other headless
// localStorage-backed module test in this repo).

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

const { loadFavorites, isFavorite, toggleFavorite, moveFavorite } = await import('./js/favorites.js');

let fail = 0;
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } else console.log(`ok   ${label}`); };
const ok = (label, cond) => { if (!cond) { fail++; console.log(`FAIL ${label}`); } else console.log(`ok   ${label}`); };

const KEY = 'gamehub.favorites.v1';
const reset = () => localStorage.clear();

// ---- missing key ----
reset();
eq('missing key -> []', loadFavorites(), []);

// ---- malformed JSON never throws ----
reset();
localStorage.setItem(KEY, '{not json');
eq('malformed JSON -> [] (no throw)', loadFavorites(), []);

// ---- malformed shapes ----
reset();
localStorage.setItem(KEY, JSON.stringify({ version: 1, ids: 'nope' }));
eq('ids not an array -> []', loadFavorites(), []);
reset();
localStorage.setItem(KEY, JSON.stringify(['escoba']));
eq('root not an object -> []', loadFavorites(), []);

// ---- toggle adds then removes ----
reset();
eq('escoba starts unfavorited', isFavorite('escoba'), false);
eq('toggle on -> true', toggleFavorite('escoba'), true);
eq('escoba now favorited', isFavorite('escoba'), true);
eq('persisted ids include escoba', loadFavorites(), ['escoba']);
eq('toggle off -> false', toggleFavorite('escoba'), false);
eq('escoba unfavorited again', isFavorite('escoba'), false);
eq('persisted ids empty again', loadFavorites(), []);

// ---- an unknown id survives a load/save round trip (never pruned) ----
reset();
toggleFavorite('some-retired-game');
toggleFavorite('escoba');
eq('unknown id survives alongside a known one', loadFavorites().sort(), ['escoba', 'some-retired-game']);

// ---- ordering helper: favorites in STORED order, then "All games" alphabetical (batch 4,
// 2026-07-23: js/hub.js's render() now honors the ids array's order for the favorites group
// instead of re-sorting it - this mirrors that logic without importing hub.js itself, which
// is side-effectful on import) ----
const byTitle = (a, b) => a.title.localeCompare(b.title);
function orderGames(games, favIds) {
  const favSet = new Set(favIds);
  const favGames = favIds.map((id) => games.find((g) => g.id === id)).filter(Boolean);
  const restGames = games.filter((g) => !favSet.has(g.id)).sort(byTitle);
  return [...favGames, ...restGames];
}
{
  const games = [
    { id: 'ball-run', title: 'Ball Run' },
    { id: 'chinchon', title: 'Chinchón' },
    { id: 'escoba', title: 'Escoba' },
    { id: 'parchis', title: 'Parchís' },
    { id: 'filler', title: 'Filler' },
  ];
  const ordered = orderGames(games, ['escoba', 'ball-run']);
  eq('favorites in the order they were favorited, then "All games" alphabetical',
    ordered.map((g) => g.id),
    ['escoba', 'ball-run', 'chinchon', 'filler', 'parchis']);

  // localeCompare handles accents correctly (Chinchón sorts as "Chinchon", Parchís as "Parchis").
  const accented = orderGames(games, []);
  eq('localeCompare orders accented titles correctly',
    accented.map((g) => g.title),
    ['Ball Run', 'Chinchón', 'Escoba', 'Filler', 'Parchís']);
}

// ---- moveFavorite: pure splice, out-of-bounds and unknown-id are no-ops ----
reset();
toggleFavorite('ball-run');
toggleFavorite('escoba');
toggleFavorite('filler');
eq('starting order', loadFavorites(), ['ball-run', 'escoba', 'filler']);
eq('move middle up', moveFavorite('escoba', -1), ['escoba', 'ball-run', 'filler']);
eq('persisted after moving up', loadFavorites(), ['escoba', 'ball-run', 'filler']);
eq('move middle down', moveFavorite('ball-run', 1), ['escoba', 'filler', 'ball-run']);
eq('persisted after moving down', loadFavorites(), ['escoba', 'filler', 'ball-run']);
eq('moving the first item up is a no-op', moveFavorite('escoba', -1), ['escoba', 'filler', 'ball-run']);
eq('moving the last item down is a no-op', moveFavorite('ball-run', 1), ['escoba', 'filler', 'ball-run']);
eq('moving an unfavorited id is a no-op', moveFavorite('some-retired-game', -1), ['escoba', 'filler', 'ball-run']);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
