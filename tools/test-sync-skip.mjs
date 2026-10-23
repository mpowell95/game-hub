// tools/test-sync-skip.mjs - a sync with nothing new sends nothing (2026-10-22, js/stats-net.js
// syncSignature): the fingerprint ignores only the two clocks that move on every sync, and changes
// with anything real.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { syncSignature } = await import('../js/stats-net.js');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL ' + n); } };
const rec = (o = {}) => ({ profile: { name: 'Anita', emoji: '🌸', playerId: 'C5PXN' }, stats: { games: { snake: { total: { played: 3 } } }, updatedAt: '2026-10-22' },
  device: { build: 'v1226' }, announce: { seen: { a: 1 }, at: 1 }, rate: null, updatedAt: { '.sv': 'timestamp' }, ...o });
ok('same record, new clocks: same fingerprint', syncSignature(rec()) === syncSignature(rec({ announce: { seen: { a: 1 }, at: 999 }, updatedAt: 5 })));
ok('a play changes it', syncSignature(rec()) !== syncSignature(rec({ stats: { games: { snake: { total: { played: 4 } } }, updatedAt: '2026-10-22' } })));
ok('a name change changes it', syncSignature(rec()) !== syncSignature(rec({ profile: { name: 'Ana', emoji: '🌸', playerId: 'C5PXN' } })));
ok('a new build changes it', syncSignature(rec()) !== syncSignature(rec({ device: { build: 'v1227' } })));
ok('a dismissed popup changes it', syncSignature(rec()) !== syncSignature(rec({ announce: { seen: { a: 1, b: 1 }, at: 1 } })));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
