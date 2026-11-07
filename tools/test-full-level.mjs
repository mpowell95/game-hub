// tools/test-full-level.mjs - FULL_LEVEL (js/stats-corrections.js, Matt 2026-11-07): a listed player's Flick Soccer
// Hard, first-to-1 games count at Hard, read time only. Run: node tools/test-full-level.mjs
import assert from 'node:assert/strict';
import { FULL_LEVEL, fullLevelGame, fullLevelStats } from '../js/stats-corrections.js';
import { aggregatePlayers } from '../js/players-agg.js';

const WHO = FULL_LEVEL.flicksoccer[0].code;   // read from the config: no player code typed into a test
const OTHER = 'ZZZZ9';
const rec = () => ({
  total: { played: 14, won: 5, lost: 9 },
  byDiff: { medium: { played: 10, won: 3, lost: 7 }, hard: { played: 4, won: 2, lost: 2 } },
  byMode: {
    'def=defend|first=me|goals=1|off=attack': { hard: { played: 6, won: 2, lost: 4 } },   // recorded Medium
    'def=defend|first=me|goals=2|off=attack': { hard: { played: 4, won: 2, lost: 2 }, medium: { played: 4, won: 1, lost: 3 } },
    '?': { hard: { played: 9, won: 9, lost: 0 } },                                       // no mode: never moved
  },
});
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. Moves exactly the goals=1 Hard games, keeps totals, never mutates.
const raw = rec(), before = JSON.stringify(raw);
const f = fullLevelGame(raw, 'flicksoccer', WHO);
ok(JSON.stringify(raw) === before, 'input untouched');
assert.deepEqual(f.byDiff.medium, { played: 4, won: 1, lost: 3 }); n++;
assert.deepEqual(f.byDiff.hard, { played: 10, won: 4, lost: 6 }); n++;
assert.deepEqual(f.total, raw.total); n++;
ok(f.byMode === raw.byMode, 'byMode untouched');
// 2. Nobody else, no other game.
ok(fullLevelGame(raw, 'flicksoccer', OTHER) === raw, 'other player unchanged');
ok(fullLevelGame(raw, 'hoops4', WHO) === raw, 'other game unchanged');
ok(fullLevelGame(raw, 'flicksoccer', '') === raw, 'no code unchanged');
// 3. Never moves more than Medium holds (clamp), never below zero.
const thin = rec(); thin.byDiff.medium = { played: 2, won: 0, lost: 2 };
const t = fullLevelGame(thin, 'flicksoccer', WHO);
assert.deepEqual(t.byDiff.medium, { played: 0, won: 0, lost: 0 }); n++;
assert.deepEqual(t.byDiff.hard, { played: 6, won: 2, lost: 4 }); n++;
// 4. No byMode (older records): unchanged.
const old = rec(); delete old.byMode;
ok(fullLevelGame(old, 'flicksoccer', WHO) === old, 'no byMode unchanged');
// 5. Through the whole-store helper and the leaderboard's aggregation (two devices, one person).
const st = { games: { flicksoccer: rec() } };
ok(fullLevelStats(st, OTHER) === st, 'store: other player unchanged');
ok(fullLevelStats(st, WHO).games.flicksoccer.byDiff.hard.played === 10, 'store: moved');
const all = {
  devA: { profile: { name: 'Matty', playerId: WHO }, stats: { games: { flicksoccer: rec() } }, updatedAt: 1 },
  devB: { profile: { name: 'Matty', playerId: WHO }, stats: { games: { flicksoccer: rec() } }, updatedAt: 2 },
  devC: { profile: { name: 'Someone', playerId: OTHER }, stats: { games: { flicksoccer: rec() } }, updatedAt: 3 },
};
const snap = JSON.stringify(all);
const agg = aggregatePlayers(all);
const me = agg.find((g) => g.playerId === WHO), them = agg.find((g) => g.playerId === OTHER);
assert.deepEqual(me.games.flicksoccer.byDiff.hard, { played: 20, won: 8, lost: 12 }); n++;
assert.deepEqual(me.games.flicksoccer.byDiff.medium, { played: 8, won: 2, lost: 6 }); n++;
assert.deepEqual(them.games.flicksoccer.byDiff.hard, { played: 4, won: 2, lost: 2 }); n++;
assert.deepEqual(me.games.flicksoccer.total, { played: 28, won: 10, lost: 18 }); n++;
ok(JSON.stringify(all) === snap, 'raw records untouched by aggregation');
console.log(`test-full-level: ${n} checks passed`);

// --- ADJUSTMENTS (adminConfig/v1/corrections/adjust, Matt 2026-11-07: "edit firebase directly and have it stick") ---
const { adjustGame, adjustStats } = await import('../js/stats-corrections.js');
const { normalizeConfig } = await import('../js/admin-config.js');
let m = 0;
const g0 = { total: { played: 10, won: 4, lost: 6 }, byDiff: { hard: { played: 10, won: 4, lost: 6 } } };
const g0s = JSON.stringify(g0);
const a1 = adjustGame(g0, { hard: { won: 3, played: 3 } });
assert.deepEqual(a1.byDiff.hard, { played: 13, won: 7, lost: 6 }); m++;
assert.deepEqual(a1.total, { played: 13, won: 7, lost: 6 }); m++;
assert.equal(JSON.stringify(g0), g0s); m++;                                         // never mutates
const a2 = adjustGame(g0, { hard: { lost: -100 }, easy: { won: 2, played: '2' } });  // floor 0, new level, strings
assert.deepEqual(a2.byDiff.hard, { played: 10, won: 4, lost: 0 }); m++;
assert.deepEqual(a2.byDiff.easy, { played: 2, won: 2, lost: 0 }); m++;
assert.deepEqual(a2.total, { played: 12, won: 6, lost: 0 }); m++;
assert.equal(adjustGame(g0, null), g0); m++;
assert.equal(adjustGame(g0, { hard: { won: 'x' } }), g0); m++;
assert.equal(adjustGame(g0, { 'bad key!': { won: 1 } }), g0); m++;
assert.equal(adjustStats({ games: { flicksoccer: g0 } }, { flicksoccer: { hard: { won: 1 } } }).games.flicksoccer.byDiff.hard.won, 5); m++;
// Through the config and aggregation: only the named code changes, once per PERSON (not per device).
const cfg = normalizeConfig({ corrections: { adjust: { [WHO]: { flicksoccer: { hard: { won: 2, played: 2 } } } } } });
const ag = aggregatePlayers(all, cfg.corrections);
const meA = ag.find((g) => g.playerId === WHO), themA = ag.find((g) => g.playerId === OTHER);
assert.deepEqual(meA.games.flicksoccer.byDiff.hard, { played: 22, won: 10, lost: 12 }); m++;
assert.deepEqual(themA.games.flicksoccer.byDiff.hard, { played: 4, won: 2, lost: 2 }); m++;
assert.equal(JSON.stringify(all), snap); m++;
console.log(`test-full-level (adjustments): ${m} checks passed`);

// --- POINTS: moved wins keep the sheet's price (Hard, first to 1 = 3), Matt 2026-11-07 ---
const { gamePoints } = await import('../js/lb-points.js');
let q = 0;
const pr = rec();   // byDiff medium 3 won, hard 2 won; goals=1 Hard (moved) 2 won
const rawPts = gamePoints(pr, 'flicksoccer', null, OTHER).pts;               // nobody moved: medium 3x3 + hard 2x6 = 21
assert.equal(rawPts, 21); q++;
const moved = fullLevelGame(pr, 'flicksoccer', WHO);
assert.equal(gamePoints(moved, 'flicksoccer', null, WHO).pts, 21); q++;          // same points once moved
assert.equal(gamePoints(moved, 'flicksoccer', 3, WHO).pts, 4 * 6 - 2 * 3); q++;  // Hard tab: 2 real Hard (12) + 2 moved (6)
assert.equal(gamePoints(moved, 'flicksoccer', 2, WHO).pts, 1 * 3); q++;          // Medium tab: what is left there
console.log(`test-full-level (points): ${q} checks passed`);
