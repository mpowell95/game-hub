// test-admin-config.mjs - headless tests for js/admin-config.js, the app-wide admin config that
// backs the admin control page (js/admin-ui.js).
//
// Run: node test-admin-config.mjs   (also wired into run-all-tests.mjs)
//
// WHAT IS AND IS NOT COVERED, plainly: everything here is the part that runs without a DOM or a
// network - the shape normalizer, the two resolvers (is this game live, is this machine released),
// the override readers, and the localStorage cache. The Firebase write path (setGameLive /
// setBoardReleased, their dev-origin guard and their verify-by-re-read) and the whole of
// js/admin-ui.js are NOT covered by any node suite; they need a browser and a real database, the
// same honest caveat test-bug-report.mjs carries about the bug-report form.
//
// THE LAW angle this suite exists to pin (rules 1 and 2):
//   - An ABSENT or malformed config must resolve to the CODE DEFAULT, never to hidden. A config
//     node that is empty, wiped or unreachable can therefore never take a released game off the
//     family's launcher.
//   - Moving a Skeeball machine back must be a read-time NO for that machine only. The resolvers
//     answer "has the admin opened this for everyone" and "is it still in testing", and every
//     caller ORs the first with the player's own earned unlock - which is why there is no way,
//     anywhere in this file, to express "un-earn". A machine in testing DECLINES to honor an
//     earned unlock while the flag is set and honors it again the moment it is not; the unlock
//     itself is never touched. The wiring is asserted below against the shipped skeeball/js/ui.js.

import { readFileSync } from 'node:fs';

let passed = 0;
const failures = [];
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`ok    ${label}`); return; }
  failures.push(label);
  console.log(`FAIL  ${label}${extra ? `\n        ${extra}` : ''}`);
}
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// --- localStorage stand-in (must exist before the module is imported) ---------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const A = await import('./js/admin-config.js');

// --- normalizeConfig: anything in, the documented shape out ------------------------------------
console.log('\n--- the shape normalizer ---');
eq('null normalizes to an empty config', A.normalizeConfig(null), { games: {}, skeeball: { boards: {} }, corrections: { skeeball: {} } });
eq('a string normalizes to an empty config', A.normalizeConfig('nonsense'), { games: {}, skeeball: { boards: {} }, corrections: { skeeball: {} } });
eq('junk in the branches is replaced, not trusted',
  A.normalizeConfig({ games: 7, skeeball: { boards: 'x' } }), { games: {}, skeeball: { boards: {} }, corrections: { skeeball: {} } });
eq('a real config survives intact',
  A.normalizeConfig({ games: { pinball: { live: true } }, skeeball: { boards: { popongo: { open: true } } } }),
  { games: { pinball: { live: true } }, skeeball: { boards: { popongo: { open: true } } }, corrections: { skeeball: {} } });

// --- resolveGameLive: the override sits ON TOP of the code default -----------------------------
console.log('\n--- is this game live ---');
ok('no config at all: a released game stays released', A.resolveGameLive(null, 'skeeball', true) === true);
ok('no config at all: a devOnly game stays hidden', A.resolveGameLive(null, 'pinball', false) === false);
ok('override true releases a devOnly game', A.resolveGameLive({ games: { pinball: { live: true } } }, 'pinball', false) === true);
ok('override false pulls a released game back for testing',
  A.resolveGameLive({ games: { skeeball: { live: false } } }, 'skeeball', true) === false);
ok('an override on ANOTHER game does not leak',
  A.resolveGameLive({ games: { pinball: { live: true } } }, 'skeeball', true) === true);
ok('a non-boolean live field is ignored, and the code default wins',
  A.resolveGameLive({ games: { pinball: { live: 'yes' } } }, 'pinball', false) === false);
// THE LAW rule 1, stated as a test: a config that is empty, wiped or malformed can never hide a
// game the code releases. Hiding is only ever an EXPLICIT `live: false`.
ok('an empty games branch cannot hide anything', A.resolveGameLive({ games: {} }, 'uno', true) === true);
eq('gameOverride reports null when nothing is set', A.gameOverride({ games: {} }, 'pinball'), null);
eq('gameOverride reports the set value', A.gameOverride({ games: { pinball: { live: false } } }, 'pinball'), false);

// --- resolveBoardReleased: opt-in only ---------------------------------------------------------
console.log('\n--- the three machine states ---');
const cfgOf = (row) => ({ skeeball: { boards: { popongo: row } } });
ok('no config: nothing is released', A.resolveBoardReleased(null, 'popongo') === false);
ok('open: true releases it', A.resolveBoardReleased(cfgOf({ open: true }), 'popongo') === true);
ok('open: false is not released', A.resolveBoardReleased(cfgOf({ open: false }), 'popongo') === false);
ok('a truthy non-true value does not release a machine', A.resolveBoardReleased(cfgOf({ open: 1 }), 'popongo') === false);
// The testing half is what the first version of the page was missing: with only `open`, an
// adminOnly machine could not be made earnable at all, which is the correction this suite pins.
ok('no config: an adminOnly machine defaults to testing', A.resolveBoardTesting(null, 'popongo', true) === true);
ok('no config: an ordinary machine defaults to not-testing', A.resolveBoardTesting(null, 'popongo', false) === false);
ok('testing: false takes an adminOnly machine OUT of testing',
  A.resolveBoardTesting(cfgOf({ testing: false }), 'popongo', true) === false);
ok('testing: true puts an ordinary machine INTO testing',
  A.resolveBoardTesting(cfgOf({ testing: true }), 'popongo', false) === true);
eq('boardOverride reports null when nothing is set', A.boardOverride({}, 'basketball'), null);
eq('boardOverride reports the set value', A.boardOverride({ skeeball: { boards: { basketball: { open: true } } } }, 'basketball'), true);
eq('boardTestingOverride reports null when nothing is set', A.boardTestingOverride({}, 'basketball'), null);
eq('boardTestingOverride reports the set value', A.boardTestingOverride({ skeeball: { boards: { basketball: { testing: true } } } }, 'basketball'), true);

// resolveBoardMode is the one answer the page and the game share.
eq('mode with no config, adminOnly machine', A.resolveBoardMode(null, 'popongo', true), 'testing');
eq('mode with no config, ordinary locked machine', A.resolveBoardMode(null, 'popongo', false), 'unlockable');
eq('mode: open', A.resolveBoardMode(cfgOf({ open: true, testing: false }), 'popongo', true), 'open');
eq('mode: unlockable (an adminOnly machine made earnable)',
  A.resolveBoardMode(cfgOf({ open: false, testing: false }), 'popongo', true), 'unlockable');
eq('mode: testing (an ordinary machine pulled back)',
  A.resolveBoardMode(cfgOf({ open: false, testing: true }), 'popongo', false), 'testing');
// A contradictory pair cannot read as playable: testing wins, so a half-applied write is safe.
eq('testing wins over open, so a contradiction is never playable',
  A.resolveBoardMode(cfgOf({ open: true, testing: true }), 'popongo', false), 'testing');

// --- the local cache ----------------------------------------------------------------------------
console.log('\n--- the local cache ---');
// The cache is read ONCE per page load and memoized, so this block has to plant its value before
// the first read - which is also the honest test: a corrupt cache is what a device would actually
// boot with, not something it acquires halfway through a session.
store.set(A.CACHE_KEY, '{ not json');
eq('a corrupt cache reads as an empty config instead of throwing',
  A.readCachedConfig(), { games: {}, skeeball: { boards: {} }, corrections: { skeeball: {} } });
ok('and the code default still decides every game', A.isGameLive('uno', true) === true);
ok('a devOnly game stays hidden through a corrupt cache', A.isGameLive('pinball', false) === false);
ok('no machine is released by a corrupt cache', A.isBoardReleased('popongo') === false);

// --- the wiring, checked against the shipped files ----------------------------------------------
// These are STRUCTURAL: the resolvers above are only correct if the callers actually OR them with
// the earned unlock and with the registry default. Both have been silently dropped in this repo
// before (a missing GAME_META row, a raw resize listener), which is why the check is a test and
// not a sentence in a CLAUDE.md.
console.log('\n--- the wiring ---');
const sk = readFileSync(new URL('./skeeball/js/ui.js', import.meta.url), 'utf8');
const orsEarned = [...sk.matchAll(/isBoardReleased\(b\.id\)/g)].length;
ok(`skeeball/js/ui.js consults isBoardReleased on every gallery gate (${orsEarned} sites)`, orsEarned >= 3);
// The unlock paths must read the RESOLVED testing state, not boards.js's raw adminOnly flag -
// otherwise "Unlockable" is a label with no effect, which is the bug this revision fixes.
const testingSites = [...sk.matchAll(/isBoardTesting\(/g)].length;
ok(`skeeball/js/ui.js resolves the testing state rather than reading adminOnly directly (${testingSites} sites)`,
  testingSites >= 5 && !/\bif \(b\.adminOnly\) continue/.test(sk));
ok('the two unlock writers both skip a machine that is still in testing',
  /_earnedUnlocks[\s\S]{0,900}?isBoardTesting/.test(sk) && /_ensureGoalUnlocks[\s\S]{0,900}?isBoardTesting/.test(sk));
ok('skeeball/js/ui.js never writes an unlock from the admin release (THE LAW rule 2)',
  !/isBoardReleased\([^)]*\)\s*(&&|\?)?[^\n]*unlockSkeeballBoard/.test(sk));
const adm = readFileSync(new URL('./js/admin-ui.js', import.meta.url), 'utf8');
ok('the admin page offers all three machine states',
  /adm_mode_open/.test(adm) && /adm_mode_unlockable/.test(adm) && /adm_mode_testing/.test(adm));
const hub = readFileSync(new URL('./js/hub.js', import.meta.url), 'utf8');
ok('js/hub.js resolves card visibility through isGameLive with !g.devOnly as the default',
  /isGameLive\(g\.id,\s*!g\.devOnly\)/.test(hub));
const statsUi = readFileSync(new URL('./js/game-stats-ui.js', import.meta.url), 'utf8');
ok('js/game-stats-ui.js gates its tabs on the SAME resolver (a released game keeps its stats screen)',
  /isGameLive\(hubIdOf\(tab\.id\)/.test(statsUi));
// A game released from inside the app gets no release commit, so its leaderboard row cannot wait
// for one. players-agg.test.mjs enforces the general rule; this names the case that created it.
const lb = readFileSync(new URL('./js/leaderboard-ui.js', import.meta.url), 'utf8');
ok("js/leaderboard-ui.js has a row for the admin-only game, so releasing it cannot zero its scores",
  /id:\s*'pinball'/.test(lb));

console.log(`\nAdmin config tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
