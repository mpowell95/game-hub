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
//         es: { escobas } } },                    // escobas the human made
//     updatedAt }
//
// `total`/`byDiff` are KEPT for every game (family sync + admin Player Insights read them); the
// per-game screens read the richer `grid`/`cc` dimensions. All additions are strictly additive.

const DEVICE_KEY = 'gamehub.deviceId';
const STATS_KEY = 'gamehub.stats';
const GAMES = ['connect4', 'chinchon', 'business', 'parchis', 'nutsbolts', 'escoba', 'filler', 'mancala'];
const C4_DIFFS = ['easy', 'medium', 'hard', 'expert'];
// Nuts & Bolts difficulty tiers, lowercased to match normDiff() (its 'extraHard' -> 'extrahard').
export const NB_TIERS = ['easy', 'medium', 'hard', 'extrahard'];

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

function persist(st) { try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch { /* ignore */ } }

/** The unified stats, with the legacy stores folded in (persisted the first time). */
export function loadStats() {
  const st = normalize(readJSON(STATS_KEY));
  let changed = foldAll(st);
  changed = seedChinchonExtras(st) || changed;
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

export { GAMES, STATS_KEY, DEVICE_KEY };
export default { deviceId, loadStats, recordResult, recordConnect4, recordChinchon, recordNutsBolts, recordEscoba, GAMES, STATS_KEY, DEVICE_KEY };
