// test-launcher-sort.mjs - the launcher's "All games" ordering (js/launcher-sort.js), headless.
// Run: node test-launcher-sort.mjs  (no deps, no browser)
//
// Covers the pure module: the stored preference's read/write and its behaviour on garbage, and
// sortGames' two orders including the part that is easy to get wrong - what happens to the MANY
// games that carry no release date at all (18 of 26 in this registry, deliberately: root
// CLAUDE.md forbids backfilling git commit dates as release dates).
//
// NOT covered: js/hub.js's rendering of the control, and js/admin-config.js's gameLiveAt() read of
// the live Firebase cache. Those are a browser and a network away from here.

import { SORTS, DEFAULT_SORT, loadSort, saveSort, sortGames } from './js/launcher-sort.js';
import { releaseMsOf, isNewGame, NEW_DAYS } from './js/new-badge.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);

// --- a localStorage stand-in, so the preference half can be driven at all in node --------------
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

console.log('\n--- the stored preference ---');
store = {};
eq('an unset preference reads as the default', loadSort(), DEFAULT_SORT);
ok('the default is alphabetical, i.e. the behaviour that already shipped', DEFAULT_SORT === 'alpha');
saveSort('new');
eq('a saved order reads back', loadSort(), 'new');
saveSort('alpha');
eq('and can be set back', loadSort(), 'alpha');

console.log('\n--- garbage never throws and never sticks ---');
for (const [label, raw] of [
  ['not JSON', '{oh no'],
  ['null', 'null'],
  ['an array', '[]'],
  ['a number', '7'],
  ['the right shape, an unknown sort', JSON.stringify({ version: 1, sort: 'sideways' })],
  ['no sort field at all', JSON.stringify({ version: 1 })],
]) {
  store = { 'gamehub.launchersort.v1': raw };
  let threw = false, got;
  try { got = loadSort(); } catch { threw = true; }
  ok(`${label}: never throws`, !threw);
  eq(`${label}: reads as the default`, got, DEFAULT_SORT);
}
store = {};
eq('saveSort refuses an unknown value and reports what is really in force', saveSort('sideways'), DEFAULT_SORT);
eq('...and that is what was stored', loadSort(), DEFAULT_SORT);

// A write that throws (private mode, quota) must not take the launcher down with it.
const realSet = globalThis.localStorage.setItem;
globalThis.localStorage.setItem = () => { throw new Error('quota'); };
let threw = false;
try { saveSort('new'); } catch { threw = true; }
ok('a failing write never throws into the caller', !threw);
globalThis.localStorage.setItem = realSet;

console.log('\n--- sortGames ---');
const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 21);
const titleOf = (g) => g.title;
const msOf = (g) => g.ms;
const G = (title, ms) => ({ title, ms });

const mixed = [
  G('Zebra', null),
  G('Boggle', NOW - 30 * DAY),
  G('Apple', null),
  G('Skeeball', NOW - 2 * DAY),
  G('Mancala', NOW - 400 * DAY),
];

eq('alphabetical ignores dates entirely',
  sortGames(mixed, 'alpha', msOf, titleOf).map(titleOf),
  ['Apple', 'Boggle', 'Mancala', 'Skeeball', 'Zebra']);

eq('newest puts dated games first, most recent first, undated after in A-Z',
  sortGames(mixed, 'new', msOf, titleOf).map(titleOf),
  ['Skeeball', 'Boggle', 'Mancala', 'Apple', 'Zebra']);

eq('an unknown sort falls back to alphabetical rather than an arbitrary order',
  sortGames(mixed, 'sideways', msOf, titleOf).map(titleOf),
  ['Apple', 'Boggle', 'Mancala', 'Skeeball', 'Zebra']);

eq('every game undated is simply alphabetical',
  sortGames([G('Pear', null), G('Fig', null)], 'new', msOf, titleOf).map(titleOf),
  ['Fig', 'Pear']);

eq('two games released the same day break the tie on title, so the order is total',
  sortGames([G('Yak', NOW), G('Ant', NOW), G('Moose', NOW)], 'new', msOf, titleOf).map(titleOf),
  ['Ant', 'Moose', 'Yak']);

const input = [G('One', NOW), G('Two', null)];
const copy = [...input];
sortGames(input, 'new', msOf, titleOf);
eq('sortGames does not mutate the array it is given', input.map(titleOf), copy.map(titleOf));

ok('a NaN/undefined date is treated as no date, not as epoch zero',
  sortGames([G('Has', NOW), G('NaN', NaN), G('Undef', undefined)], 'new', msOf, titleOf).map(titleOf)[0] === 'Has');

console.log('\n--- releaseMsOf: the admin-page release (the hole this closed) ---');
ok('a coded `released` date wins over the config stamp',
  releaseMsOf({ released: '2026-08-01' }, NOW) === Date.UTC(2026, 7, 1));
ok('with no coded date, the config stamp stands in',
  releaseMsOf({ id: 'minesweeper' }, NOW) === NOW);
ok('with neither, there is no release date and nothing is invented',
  releaseMsOf({ id: 'snake' }, 0) === null);
ok('a zero/absent stamp is not a date at the epoch',
  releaseMsOf({ id: 'snake' }) === null);

console.log('\n--- and the badge follows it ---');
ok('a game released from the admin page moments ago IS new',
  isNewGame({ id: 'minesweeper' }, NOW, NOW - 1000) === true);
ok('...and stops being new once the window passes',
  isNewGame({ id: 'minesweeper' }, NOW, NOW - (NEW_DAYS + 1) * DAY) === false);
ok('a game with no date and no stamp is never new (the pre-existing games)',
  isNewGame({ id: 'snake' }, NOW) === false);
ok('the old two-argument call still behaves exactly as it did',
  isNewGame({ released: '2026-09-20' }, NOW) === true && isNewGame({ released: '2026-01-01' }, NOW) === false);

console.log(`\nLauncher sort tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
