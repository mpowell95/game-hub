// tools/test-contexto-daily.mjs - Contexto's Daily board (2026-10-30): recordContexto counts a daily play
// a second time in ct.d, and js/players-agg.js adds ct.d across a person's devices.  node tools/test-contexto-daily.mjs
// Recorder writes ct.d only for daily plays; players-agg adds ct.d across devices.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; } };
const gs = await import('../js/game-stats.js');
const agg = await import('../js/players-agg.js');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'ok   ' : 'FAIL ') + n); };
gs.recordContexto('en', true, { guesses: 30, hints: 0 });                 // past puzzle, gold
gs.recordContexto('en', true, { guesses: 20, hints: 1, daily: true });    // today, silver
gs.recordContexto('en', true, { guesses: 25, hints: 5, daily: true });    // today, 3+ hints
gs.recordContexto('en', false, { guesses: 40, hints: 2, daily: true });   // today, gave up
const ct = gs.loadStats().games.contexto.ct;
t('All counts every play', ct.solved === 3 && ct.noHint === 1 && ct.silver === 1);
t('Daily counts only daily plays', ct.d && ct.d.played === 3 && ct.d.solved === 2 && ct.d.noHint === 0 && ct.d.silver === 1 && ct.d.bronze === 0 && ct.d.hints === 8 && ct.d.guesses === 45);
const rec = (id, d) => ({ profile: { name: 'Zed', playerId: 'ZZZQ9' }, stats: { games: { contexto: { total: { played: 2, won: 2, lost: 0 }, byDiff: { en: { played: 2, won: 2, lost: 0 } }, ct: { solved: 2, guesses: 10, hints: 0, noHint: 2, fewest: 4, silver: 0, bronze: 0, d } } } }, updatedAt: 1 });
const out = agg.aggregatePlayers({ a: rec('a', { played: 1, solved: 1, guesses: 5, hints: 0, noHint: 1, silver: 0, bronze: 0 }), b: rec('b', { played: 2, solved: 1, guesses: 7, hints: 1, noHint: 0, silver: 1, bronze: 0 }) });
const g = (Array.isArray(out) ? out : Object.values(out)).find((x) => x && x.games && x.games.contexto);
const d = g && g.games.contexto.ct.d;
t('Daily counters add across devices', d && d.played === 3 && d.solved === 2 && d.noHint === 1 && d.silver === 1 && d.guesses === 12);
console.log(`Contexto daily: ${ok} passed, ${bad} failed.`);
if (bad) process.exit(1);
