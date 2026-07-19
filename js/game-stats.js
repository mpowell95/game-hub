// game-stats.js - shared per-device play stats for every game.
//
// One record PER DEVICE (a random UUID in gamehub.deviceId), NEVER keyed by the profile name, so
// renaming the profile never loses or forks a person's stats. Every write is additive (increment,
// never overwrite). The pre-existing per-game stores (chinchon-stats, bd-stats) are folded in ONCE
// per game (a `_leg` guard) so their history carries into the unified stats with no double-count.
//
// Shape of localStorage['gamehub.stats']:
//   { version:1,
//     games: {
//       connect4: {
//         total:  { played, won, lost },
//         byDiff: { <difficultyLabel>: { played, won, lost }, ... },   // 'legacy' = folded-in history
//         grid:   { player:{easy:{w,l},medium,hard,expert}, computer:{...} },  // by WHO MOVED FIRST
//         _leg:   true },
//       chinchon: {
//         total, byDiff,
//         cc: { closed, minusTen, chinchons },   // seeded ONCE from chinchon-stats (_ccSeeded guard)
//         _leg, _ccSeeded },
//       business|parchis: { total, byDiff, _leg },
//       filler: { total, byDiff },   // classic recordResult (beginner/intermediate/pro)
//       mancala: { total, byDiff },  // classic recordResult (beginner/intermediate/pro)
//       nutsbolts: {
//         total, byDiff,
//         nb: { solved, moves, bestLevel } },     // a solo puzzle: no loss state, no difficulty picker
//       escoba: {
//         total, byDiff,
//         es: { escobas } },                      // escobas the human made
//       ballrun: {
//         total, byDiff,                           // byDiff keyed by easy|medium|hard: run counts per difficulty
//         br: { runs, bestObstacles, bestObstaclesByDiff: { easy, medium, hard } },  // a solo,
//                                                   // difficulty-scaled endless runner: no opponent, no loss
//                                                   // state, so every finished run counts as played+won (like
//                                                   // nutsbolts); the score is obstacle rows passed (fourth-
//                                                   // playthrough item 2 - distance alone was a hollow score
//                                                   // since Easy could bank 100+m without meeting an obstacle),
//                                                   // so the honest numbers are runs and best obstacle count,
//                                                   // overall and per difficulty
//         brLegacyMeters: { runs, bestDistance, bestByDiff: { easy, medium, hard } } } },  // preserved verbatim
//                                                   // (never deleted) if an old meter-based `br` was found on
//                                                   // load, folded ONCE via a _brMetricMigrated guard - meters
//                                                   // and obstacle counts are not comparable units, so this is
//                                                   // a start-fresh migration, not a conversion; only present
//                                                   // on devices that had pre-migration Ball Run data.
//                                                   // _brRunsRefolded: the archived `runs` play count (unit-
//                                                   // agnostic, unlike the meter bests) is folded BACK into the
//                                                   // live br.runs once - see refoldBallRunLegacyRuns
//     updatedAt }
//
// `total`/`byDiff` are KEPT for every game (family sync + admin Player Insights read them); the
// per-game screens read the richer `grid`/`cc` dimensions. All additions are strictly additive.

const DEVICE_KEY = 'gamehub.deviceId';
const STATS_KEY = 'gamehub.stats';
const GAMES = ['connect4', 'chinchon', 'business', 'parchis', 'nutsbolts', 'escoba', 'filler', 'mancala', 'ballrun'];
const C4_DIFFS = ['easy', 'medium', 'hard', 'expert'];
// Nuts & Bolts difficulty tiers, lowercased to match normDiff() (its 'extraHard' -> 'extrahard').
export const NB_TIERS = ['easy', 'medium', 'hard', 'extrahard'];
// Ball Run difficulties (easy|medium|hard, no expert tier).
export const BR_DIFFS = ['easy', 'medium', 'hard'];

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function bucket() { return { played: 0, won: 0, lost: 0 }; }
function cell() { return { w: 0, l: 0 }; }
function normDiff(x) { return String(x == null ? '' : x).toLowerCase().trim() || 'unknown'; }

/** Stable per-device id, created once. Not a profile name, so it survives every rename. */
export function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* ignore */ }
  if (!id) {
    try { id = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : null; } catch { /* ignore */ }
    if (!id) id = 'd-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 6);
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
  }
  return id;
}

/** Connect 4: the WHO-MOVED-FIRST grid (player|computer x easy/medium/hard/expert x {w,l}). */
function ensureGrid(g) {
  if (!g.grid || typeof g.grid !== 'object') g.grid = {};
  for (const side of ['player', 'computer']) {
    if (!g.grid[side] || typeof g.grid[side] !== 'object') g.grid[side] = {};
    for (const d of C4_DIFFS) if (!g.grid[side][d]) g.grid[side][d] = cell();
  }
}

/** Chinchón: the close-quality counters (all one-per-round events the human triggered). */
function ensureCc(g) {
  if (!g.cc || typeof g.cc !== 'object') g.cc = { closed: 0, minusTen: 0, chinchons: 0 };
  if (!Number.isFinite(g.cc.closed)) g.cc.closed = 0;
  if (!Number.isFinite(g.cc.minusTen)) g.cc.minusTen = 0;
  if (!Number.isFinite(g.cc.chinchons)) g.cc.chinchons = 0;
}

/** Nuts & Bolts: the solo-puzzle counters. A puzzle has no opponent and no loss state, so the
 *  real story is levels solved, moves spent, and how far you got. */
function ensureNb(g) {
  if (!g.nb || typeof g.nb !== 'object') g.nb = { solved: 0, moves: 0, bestLevel: 0 };
  if (!Number.isFinite(g.nb.solved)) g.nb.solved = 0;
  if (!Number.isFinite(g.nb.moves)) g.nb.moves = 0;
  if (!Number.isFinite(g.nb.bestLevel)) g.nb.bestLevel = 0;
}

/** Escoba: the capture-quality counter (escobas the human made). */
function ensureEs(g) {
  if (!g.es || typeof g.es !== 'object') g.es = { escobas: 0 };
  if (!Number.isFinite(g.es.escobas)) g.es.escobas = 0;
}

/** Ball Run: the solo-difficulty-scaled counters. A run has no opponent and no loss state (only a
 *  crash or a fall ends it), so `br.runs` is the true play count and `br.bestObstacles` /
 *  `br.bestObstaclesByDiff` are the honest scoreboard (max, never decreases). Fourth-playthrough
 *  item 2: the score is obstacle rows passed, not meters (see migrateBallRunMetric for the one-time
 *  fold of any pre-existing meter-based data into brLegacyMeters). */
function ensureBr(g) {
  if (!g.br || typeof g.br !== 'object') g.br = { runs: 0, bestObstacles: 0, bestObstaclesByDiff: {} };
  if (!Number.isFinite(g.br.runs)) g.br.runs = 0;
  if (!Number.isFinite(g.br.bestObstacles)) g.br.bestObstacles = 0;
  if (!g.br.bestObstaclesByDiff || typeof g.br.bestObstaclesByDiff !== 'object') g.br.bestObstaclesByDiff = {};
  for (const d of BR_DIFFS) if (!Number.isFinite(g.br.bestObstaclesByDiff[d])) g.br.bestObstaclesByDiff[d] = 0;
}

/** Fourth-playthrough item 2: Ball Run's recorded metric changed from bestDistance/bestByDiff
 *  (meters) to bestObstacles/bestObstaclesByDiff (obstacle rows passed) - old meter values are NOT
 *  comparable to counts and are never converted. One-time, guarded migration (same fold-once pattern
 *  as seedChinchonExtras, guard `_brMetricMigrated`): if the pre-normalize `br` was still in the OLD
 *  meter shape, it is moved VERBATIM to `brLegacyMeters` (never deleted, per this file's "never
 *  overwrite, always additive" discipline) and `br` is reset to a fresh, zeroed obstacle-count shape.
 *  Takes `preNormalizeBr` - a snapshot of `br` taken BEFORE normalize()/ensureBr ran (loadStats()
 *  clones it off `raw` first). Fifth-playthrough fix: this used to be handed `raw.games` itself, but
 *  normalize() mutates `raw` IN PLACE (`st` and `raw` are the same object reference, never cloned),
 *  and normalize() already calls ensureBr() on `st.games.ballrun` before this function ever runs - so
 *  by the time this looked at "raw", ensureBr had already stamped bestObstacles:0 /
 *  bestObstaclesByDiff:{...} onto the still-old-shaped object. The old-shape CHECK below still passed
 *  (bestDistance survives ensureBr, which only ever adds missing fields), so runs kept migrating
 *  correctly, but brLegacyMeters ended up a hybrid of the real old meter fields plus bogus zeroed
 *  count fields bolted on - not the verbatim old record this function's own contract promises. A
 *  cloned pre-normalize snapshot, taken before any mutation, is genuinely untouched. */
function migrateBallRunMetric(st, preNormalizeBr) {
  const g = st.games.ballrun;
  if (g._brMetricMigrated) return false;
  g._brMetricMigrated = true;
  const rawBr = preNormalizeBr;
  const oldShape = rawBr && typeof rawBr === 'object'
    && (Number.isFinite(rawBr.bestDistance) || (rawBr.bestByDiff && typeof rawBr.bestByDiff === 'object'));
  if (oldShape) {
    g.brLegacyMeters = rawBr;
    g.br = { runs: 0, bestObstacles: 0, bestObstaclesByDiff: {} };
  }
  return true;
}

/** Sixth-playthrough incident, the real root cause: the migration above archived the ENTIRE old
 *  `br` object, including `runs`, and reset the live counter to 0 - but `runs` is a play count,
 *  not a meter value; it was never unit-incompatible and should have carried forward. Both the
 *  Game Stats tab and the Leaderboard gate their whole Ball Run display on `br.runs > 0`, so
 *  zeroing it made a player's entire (still stored, never deleted) history invisible on every
 *  screen at once - which reads exactly like deleted data to the player. This folds the archived
 *  play count back into the live counter, once (its own guard, so devices that migrated before
 *  this fix existed are repaired on their next load, and devices migrating fresh get the same
 *  result). The meter-valued best fields stay archived in brLegacyMeters, never converted. */
function refoldBallRunLegacyRuns(st) {
  const g = st.games.ballrun;
  if (g._brRunsRefolded) return false;
  g._brRunsRefolded = true;
  const legacy = g.brLegacyMeters;
  if (legacy && typeof legacy === 'object' && (legacy.runs | 0) > 0) {
    ensureBr(g);
    g.br.runs += legacy.runs | 0;
  }
  return true;
}

/** Fill any missing structure so the rest of the code can assume a full shape. */
function normalize(raw) {
  const st = (raw && typeof raw === 'object') ? raw : {};
  st.version = st.version || 1;
  if (!st.games || typeof st.games !== 'object') st.games = {};
  for (const k of GAMES) {
    const g = st.games[k] || (st.games[k] = {});
    if (!g.total) g.total = bucket();
    if (!g.byDiff || typeof g.byDiff !== 'object') g.byDiff = {};
  }
  ensureGrid(st.games.connect4);
  ensureCc(st.games.chinchon);
  ensureNb(st.games.nutsbolts);
  ensureEs(st.games.escoba);
  ensureBr(st.games.ballrun);
  return st;
}

/** Additively bump a game's total + per-difficulty bucket for one finished game. */
function bumpTotals(g, d, won) {
  if (!g.byDiff[d]) g.byDiff[d] = bucket();
  g.total.played += 1; g.byDiff[d].played += 1;
  if (won === true) { g.total.won += 1; g.byDiff[d].won += 1; }
  else if (won === false) { g.total.lost += 1; g.byDiff[d].lost += 1; }
}

/** Fold a legacy store into a game's totals ONCE (guarded by game._leg). Additive; returns true
 *  if it did anything (so the caller can persist the one-time migration). */
function foldLegacy(st, gameId, legacyKey, map) {
  const g = st.games[gameId];
  if (g._leg) return false;
  const legacy = readJSON(legacyKey);
  if (legacy) {
    const t = map(legacy);
    if ((t.played | 0) > 0) {
      g.total.played += t.played | 0; g.total.won += t.won | 0; g.total.lost += t.lost | 0;
      g.byDiff.legacy = { played: t.played | 0, won: t.won | 0, lost: t.lost | 0 };
    }
  }
  g._leg = true;
  return true;
}

/** Seed Chinchón's close-quality counters from chinchon-stats ONCE (its own guard, separate from
 *  `_leg` which is already set on live devices). closes/chinchons carry over; minusTen was never
 *  tracked before so it starts at 0 (or from a newer chinchon-stats that now records it). */
function seedChinchonExtras(st) {
  const g = st.games.chinchon;
  if (g._ccSeeded) return false;
  g._ccSeeded = true;
  ensureCc(g);
  const legacy = readJSON('chinchon-stats');
  if (legacy) {
    g.cc.closed += legacy.closes | 0;
    g.cc.chinchons += legacy.chinchons | 0;
    g.cc.minusTen += legacy.minusTen | 0;
  }
  return true;
}

function foldAll(st) {
  let changed = foldLegacy(st, 'chinchon', 'chinchon-stats', (c) => ({ played: c.games | 0, won: c.wins | 0, lost: c.losses | 0 }));
  changed = foldLegacy(st, 'business', 'bd-stats', (b) => ({ played: b.played | 0, won: b.won | 0, lost: b.lost | 0 })) || changed;
  return changed;
}

// Sixth-playthrough incident (Ball Run): a storage-write failure here was completely silent, with
// no trace anywhere a player or a future debugging session could see it. Every call site already
// discards this function's return value, so returning a success flag (instead of nothing) and
// logging on failure is purely additive: zero risk to any existing game, strictly more visibility
// for every game that shares this store.
function persist(st) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); return true; }
  catch (err) { console.error('[game-stats] persist failed, this write was not saved', err); return false; }
}

/** The unified stats, with the legacy stores folded in (persisted the first time). */
export function loadStats() {
  const raw = readJSON(STATS_KEY);
  // Snapshot `br` BEFORE normalize() runs: normalize() mutates `raw` in place (`st` below is the
  // same object, never cloned) and calls ensureBr() on it, which would otherwise stamp fresh
  // bestObstacles/bestObstaclesByDiff fields onto an old-shape `br` before migrateBallRunMetric
  // gets a chance to look at it. A deep clone taken here is genuinely untouched either way.
  const rawBr = raw && raw.games && raw.games.ballrun && raw.games.ballrun.br;
  const preNormalizeBr = rawBr && typeof rawBr === 'object' ? JSON.parse(JSON.stringify(rawBr)) : null;
  const st = normalize(raw);
  let changed = foldAll(st);
  changed = seedChinchonExtras(st) || changed;
  changed = migrateBallRunMetric(st, preNormalizeBr) || changed;
  changed = refoldBallRunLegacyRuns(st) || changed;
  ensureBr(st.games.ballrun); // re-fill BR_DIFFS defaults; migration may have reset `br` to a bare shape
  if (changed) persist(st);
  return st;
}

/** Record one finished game. `difficulty` is the game's own label (easy/normal/hard/expert, or
 *  beginner/intermediate/pro/expert, etc). `won` is true (human won), false (human lost), or null
 *  for a draw (counted in `played` only; draws = played - won - lost). Additive; never overwrites. */
export function recordResult(gameId, difficulty, won) {
  if (GAMES.indexOf(gameId) < 0) return null;
  const st = loadStats();
  bumpTotals(st.games[gameId], normDiff(difficulty), won);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Connect 4: record a finished game with WHO MOVED FIRST. Maintains total/byDiff (as recordResult)
 *  AND the who-moved-first grid. `firstMove` is 'player' or 'computer'; `difficulty` is the player's
 *  pick (easy/medium/hard/expert). A draw (won === null) counts in totals only, never in the grid. */
export function recordConnect4(difficulty, firstMove, won) {
  const st = loadStats();
  const g = st.games.connect4;
  const d = normDiff(difficulty);
  bumpTotals(g, d, won);
  ensureGrid(g);
  const side = firstMove === 'computer' ? 'computer' : 'player';
  if (C4_DIFFS.indexOf(d) >= 0) {
    const c = g.grid[side][d];
    if (won === true) c.w += 1; else if (won === false) c.l += 1;
  }
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Chinchón: record a finished match. Maintains total/byDiff (as recordResult) AND the close-quality
 *  counters `cc` from this match's per-round tallies. `extras` = { closed, minusTen, chinchons }. */
export function recordChinchon(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.chinchon;
  bumpTotals(g, normDiff(difficulty), won);
  ensureCc(g);
  const e = extras || {};
  g.cc.closed += e.closed | 0;
  g.cc.minusTen += e.minusTen | 0;
  g.cc.chinchons += e.chinchons | 0;
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Nuts & Bolts: record ONE solved level. A solo puzzle has no opponent and no loss state, so a
 *  solve counts as played+won and `lost` is never touched (the shared readers - family sync and
 *  admin Player Insights - only read `total`). `tier` is the difficulty the level was solved on
 *  (easy|medium|hard|extraHard); it lands in `byDiff` so levels-beaten-per-tier aggregates across a
 *  person's devices for free, and `nb.bestByTier` keeps the furthest level reached in each. Solves
 *  recorded before tiers were tracked simply have no byDiff entry; `nb.solved` stays the true total.
 *  Additive; never overwrites. Its own save (gamehub.nutsbolts.v1) is never read here. */
export function recordNutsBolts(level, moves, tier) {
  const st = loadStats();
  const g = st.games.nutsbolts;
  ensureNb(g);
  g.total.played += 1;
  g.total.won += 1;
  g.nb.solved += 1;
  g.nb.moves += Math.max(0, moves | 0);
  g.nb.bestLevel = Math.max(g.nb.bestLevel | 0, level | 0);
  const t = NB_TIERS.indexOf(normDiff(tier)) >= 0 ? normDiff(tier) : null;
  if (t) {
    if (!g.byDiff[t]) g.byDiff[t] = bucket();
    g.byDiff[t].played += 1; g.byDiff[t].won += 1;
    if (!g.nb.bestByTier || typeof g.nb.bestByTier !== 'object') g.nb.bestByTier = {};
    g.nb.bestByTier[t] = Math.max(g.nb.bestByTier[t] | 0, level | 0);
  }
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Escoba: record a finished match. Maintains total/byDiff (as recordResult) AND the escoba
 *  counter from this match. `extras` = { escobas }. Additive; never overwrites. */
export function recordEscoba(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.escoba;
  bumpTotals(g, normDiff(difficulty), won);
  ensureEs(g);
  g.es.escobas += (extras && extras.escobas) | 0;
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Ball Run: record one finished run. `difficulty` is easy|medium|hard; `obstaclesPassed` is the
 *  obstacle-row score (floored, never negative - fourth-playthrough item 2: obstacle rows passed,
 *  not meters, see the header comment block and migrateBallRunMetric). A run has no opponent and no
 *  loss state, so it counts as played+won (mirrors Nuts & Bolts); `lost` is never touched. Additive;
 *  bestObstacles/bestObstaclesByDiff only ever go up, matching every other best-tracking field here. */
export function recordBallRun(obstaclesPassed, difficulty) {
  const st = loadStats();
  const g = st.games.ballrun;
  ensureBr(g);
  const d = BR_DIFFS.indexOf(normDiff(difficulty)) >= 0 ? normDiff(difficulty) : null;
  const score = Number.isFinite(obstaclesPassed) ? Math.max(0, Math.floor(obstaclesPassed)) : 0;
  if (d) bumpTotals(g, d, true); else { g.total.played += 1; g.total.won += 1; }
  g.br.runs += 1;
  g.br.bestObstacles = Math.max(g.br.bestObstacles | 0, score);
  if (d) g.br.bestObstaclesByDiff[d] = Math.max(g.br.bestObstaclesByDiff[d] | 0, score);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

export { GAMES, STATS_KEY, DEVICE_KEY };
export default { deviceId, loadStats, recordResult, recordConnect4, recordChinchon, recordNutsBolts, recordEscoba, recordBallRun, GAMES, STATS_KEY, DEVICE_KEY };
