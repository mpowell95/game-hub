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

const { loadFavorites, isFavorite, toggleFavorite } = await import('./js/favorites.js');

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

// ---- ordering helper: favorites first, alphabetical within each group ----
const byTitle = (a, b) => a.title.localeCompare(b.title);
function orderGames(games, favIds) {
  const favs = new Set(favIds);
  return [
    ...games.filter((g) => favs.has(g.id)).sort(byTitle),
    ...games.filter((g) => !favs.has(g.id)).sort(byTitle),
  ];
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
  eq('favorites first, then alphabetical within each group',
    ordered.map((g) => g.id),
    ['ball-run', 'escoba', 'chinchon', 'filler', 'parchis']);

  // localeCompare handles accents correctly (Chinchón sorts as "Chinchon", Parchís as "Parchis").
  const accented = orderGames(games, []);
  eq('localeCompare orders accented titles correctly',
    accented.map((g) => g.title),
    ['Ball Run', 'Chinchón', 'Escoba', 'Filler', 'Parchís']);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
