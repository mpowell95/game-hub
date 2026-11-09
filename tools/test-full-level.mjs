// tools/test-full-level.mjs - FULL_LEVEL (js/stats-corrections.js, Matt 2026-11-07, everyone 2026-11-08): Flick Soccer
// first-to-1 games SHOW at the level picked, read time only; points stay the sheet's. Run: node tools/test-full-level.mjs
import assert from 'node:assert/strict';
import { FULL_LEVEL, fullLevelGame, fullLevelStats } from '../js/stats-corrections.js';
import { aggregatePlayers } from '../js/players-agg.js';

const WHO = 'ABCD1';   // made-up codes: the rule is for everyone
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
ok(FULL_LEVEL.flicksoccer.every((r) => r.code === '*'), 'for everyone');
assert.deepEqual(fullLevelGame(raw, 'flicksoccer', OTHER).byDiff, f.byDiff); n++;   // any player
assert.deepEqual(fullLevelGame(raw, 'flicksoccer', '').byDiff, f.byDiff); n++;      // no code too
ok(fullLevelGame(raw, 'hoops4', WHO) === raw, 'other game unchanged');
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
assert.deepEqual(them.games.flicksoccer.byDiff.hard, { played: 10, won: 4, lost: 6 }); n++;   // everyone moved
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
assert.deepEqual(themA.games.flicksoccer.byDiff.hard, { played: 10, won: 4, lost: 6 }); m++;   // moved, not adjusted
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

// Medium, first to 1 SHOWS at Medium, priced at Easy's 1, with ITS OWN 20-point limit (Matt, 2026-11-08: "I just won medium
// first to 1 twice but it didn't give me any points. I should be at 20 for medium now"; it used to share Easy's limit).
{
  const mg = { total: { played: 30, won: 30, lost: 0 }, byDiff: { easy: { played: 30, won: 30, lost: 0 } },
    byMode: { 'goals=1': { easy: { played: 20, won: 20, lost: 0 }, medium: { played: 10, won: 10, lost: 0 } } } };
  const mm = fullLevelGame(mg, 'flicksoccer', OTHER);
  assert.deepEqual(mm.byDiff.easy, { played: 20, won: 20, lost: 0 });
  assert.deepEqual(mm.byDiff.medium, { played: 10, won: 10, lost: 0 });
  assert.equal(gamePoints(mg, 'flicksoccer').pts, 20);                     // raw: 30 Easy wins, capped at 20
  assert.equal(gamePoints(mm, 'flicksoccer', null, OTHER).pts, 30);        // 20 Easy (its limit) + 10 Medium first to 1 (its own)
  assert.equal(gamePoints(mm, 'flicksoccer', 1, OTHER).pts, 20);           // Easy tab: Easy's own wins only
  assert.equal(gamePoints(mm, 'flicksoccer', 2, OTHER).pts, 10);           // Medium tab: the first-to-1 wins, 1 each
  console.log('test-full-level (medium, first to 1): 6 checks passed');
}
// Never moved twice; a record it was not applied to is priced as stored.
{
  const once = fullLevelGame(rec(), 'flicksoccer', OTHER);
  assert.equal(fullLevelGame(once, 'flicksoccer', OTHER), once);
  assert.deepEqual(once.fl.map(({ level, from, won }) => ({ level, from, won })), [{ level: 'hard', from: 'medium', won: 2 }]);
  assert.equal(gamePoints(rec(), 'flicksoccer').pts, 21);
  console.log('test-full-level (once only): 3 checks passed');
}

// --- EVERY game with a "one level down" rule SHOWS at the level picked (Matt, 2026-11-08: "FIX THIS ALL PERMANENTLY") ---
{
  const { FULL_LEVEL_GAMES } = await import('../js/stats-corrections.js');
  const { LB_RULES } = await import('../js/lb-rules.js');
  let c = 0;
  // Permanent: a game whose shortened setting records one level down (tools/test-lb-rules.mjs makes it list `short`)
  // must be shown at the level picked, on the same ladder.
  for (const [id, r] of Object.entries(LB_RULES)) {
    if (!r.short) continue;
    assert.ok(FULL_LEVEL_GAMES[id], `${id}: has a FULL_LEVEL entry`); c++;
    assert.deepEqual(FULL_LEVEL_GAMES[id].ladder, r.short.ladder, `${id}: same ladder`); c++;
    assert.equal(r.shown, 'picked', `${id}: lb-rules shown: 'picked'`); c++;
  }
  // Each game's own saved mode keys (its modeOf, js/game-stats.js modeKey strips '.'): shortened vs standard.
  const CASES = {
    flicksoccer: [['goals=1'], ['goals=2', 'goals=3']],
    eightball: [['racks=1|game=8'], ['racks=3|game=8', 'racks=5']],
    cuppong: [['first=me|gent=1|rr=inf'], ['first=me|gent=1|rr=0', 'rr=2']],
    darts: [['kind=201', 'kind=101'], ['kind=301', 'kind=cricket']],
    dominoes: [['to=150'], ['to=300', 'to=500']],
    boggle: [['lang=en|min=2'], ['lang=es|min=15', 'lang=en|min=1']],
    hoops4: [['first=me|one=0'], ['first=me|one=1', 'one=1']],
    chinchon: [['ai=normal|sl=50|vc=points', 'ai=hard|rl=5|vc=rounds', 'rl=5|sl=100|vc=roundsOrPoints'], ['ai=normal|sl=100|vc=points', 'rl=10|sl=50|vc=rounds']],
  };
  for (const [id, [shortKeys, stdKeys]] of Object.entries(CASES)) {
    const lad = FULL_LEVEL_GAMES[id].ladder;
    for (const k of [...shortKeys, ...stdKeys]) {
      const isShort = shortKeys.includes(k);
      // One win picked at the top level: recorded one down when short (the game's statsDiff), at the top otherwise.
      const rec0 = isShort ? lad[lad.length - 2] : lad[lad.length - 1];
      const g = { total: { played: 1, won: 1, lost: 0 }, byDiff: { [rec0]: { played: 1, won: 1, lost: 0 } }, byMode: { [k]: { [lad[lad.length - 1]]: { played: 1, won: 1, lost: 0 } } } };
      const m = fullLevelGame(g, id, 'ZZZZ1');
      assert.equal(((m.byDiff[lad[lad.length - 1]] || {}).won) | 0, 1, `${id} ${k}: shown at the level picked`); c++;
      assert.equal(gamePoints(m, id, null, 'ZZZZ1').pts, gamePoints(g, id, null, 'ZZZZ1').pts, `${id} ${k}: points unchanged`); c++;
    }
  }
  console.log(`test-full-level (every game): ${c} checks passed`);
}
