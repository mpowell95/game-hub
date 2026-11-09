// tools/test-repair-1109.mjs - js/repair-1109.js, the one-time "re-added app" repair (2026-11-09).
// Made-up code and device ids only (never Matt's). Checks: it syncs this phone first and stops if that
// fails; it refuses a record with another code; on success the old stats/activity are in place, the
// device id is the old one, a backup of the phone's own store exists, and it never runs twice; a failure
// halfway puts every key back.
//   node tools/test-repair-1109.mjs
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const { repairReinstall1109 } = await import('../js/repair-1109.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const T = { code: 'TZZZ9', newId: 'new-device', oldId: 'old-device' };
const oldRec = { profile: { playerId: 'TZZZ9' }, stats: { version: 1, games: { gridlock: { total: { played: 50, won: 50 } } } }, activity: { gridlock: { first: 1, last: 2, w: {} } } };
function reset() {
  for (const k of Object.keys(store)) delete store[k];
  store['gamehub.profile'] = JSON.stringify({ version: 1, name: 'zzztest', playerId: 'TZZZ9' });
  store['gamehub.deviceId'] = 'new-device';
  store['gamehub.stats'] = JSON.stringify({ version: 1, games: { gridlock: { total: { played: 2, won: 2 } } } });
  store['gamehub.activity.v1'] = JSON.stringify({ 'gamehub.stats': { gridlock: { first: 9, last: 9, w: {} } } });
}
const net = (good) => ({ syncMyStats: async () => good });

reset();
ok(await repairReinstall1109({ ...T, net: net(false), readOld: async () => oldRec }) === false, 'stops when this phone did not sync');
ok(store['gamehub.deviceId'] === 'new-device' && !store['gamehub.repair.reinstall1109.v1'], 'nothing changed after a failed sync');

ok(await repairReinstall1109({ ...T, net: net(true), readOld: async () => ({ ...oldRec, profile: { playerId: 'OTHER' } }) }) === false, 'refuses another code');
ok(store['gamehub.deviceId'] === 'new-device', 'refused: device id unchanged');

reset();
const before = { ...store };
ok(await repairReinstall1109({ ...T, net: net(true), readOld: async () => oldRec, failAt: 'device' }) === false, 'failure halfway returns false');
ok(store['gamehub.deviceId'] === before['gamehub.deviceId'] && store['gamehub.stats'] === before['gamehub.stats'] && store['gamehub.activity.v1'] === before['gamehub.activity.v1'], 'failure halfway: every key put back');
ok(!store['gamehub.repair.reinstall1109.v1'], 'failure halfway: not stamped');

reset();
const own = store['gamehub.stats'];
ok(await repairReinstall1109({ ...T, net: net(true), readOld: async () => oldRec }) === true, 'repair runs');
ok(store['gamehub.deviceId'] === 'old-device', 'device id is the old one');
ok(JSON.parse(store['gamehub.stats']).games.gridlock.total.played === 50, 'old stats in place');
ok(JSON.parse(store['gamehub.activity.v1'])['gamehub.stats'].gridlock.first === 1, 'old activity in place');
ok(JSON.parse(store['gamehub.repair1109.backup']).stats === own, 'backup holds this phone\'s own store');
ok(await repairReinstall1109({ ...T, net: net(true), readOld: async () => oldRec }) === false, 'never runs twice');

reset();
ok(await repairReinstall1109({ net: net(true), readOld: async () => oldRec }) === false && store['gamehub.deviceId'] === 'new-device', 'real ids: any other phone untouched');
console.log(`\nRepair 1109 tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
