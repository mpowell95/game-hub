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
//         brLegacyMeters: { runs, bestDistance, bestByDiff: { easy, medium, hard } } },  // preserved verbatim
//                                                   // (never deleted) if an old meter-based `br` was found on
//                                                   // load, folded ONCE via a _brMetricMigrated guard - meters
//                                                   // and obstacle counts are not comparable units, so this is
//                                                   // a start-fresh migration, not a conversion; only present
//                                                   // on devices that had pre-migration Ball Run data.
//                                                   // _brRunsRefolded: the archived `runs` play count (unit-
//                                                   // agnostic, unlike the meter bests) is folded BACK into the
//                                                   // live br.runs once - see refoldBallRunLegacyRuns
//         brOrbital: { runs, bestObstacles, bestObstaclesByDiff: { easy, medium, hard } } },  // Ball
//                                                   // Run's second map (BALLRUNMAP2ORBITALSPEC.md, Phase 1),
//                                                   // same shape as `br` - a fresh sibling key, not a migration:
//                                                   // all pre-existing history IS Classic history (Orbital
//                                                   // didn't exist before), so `br` itself needs no change at
//                                                   // all, only a new bucket for the new map. `total`/`byDiff`
//                                                   // above stay combined across both maps (an overall play
//                                                   // count is still meaningful either way).
//       tictactoe: {
//         total, byDiff,                           // classic recordResult-shaped (beginner/intermediate/pro)
//         tt: { classic: { played, won, lost, tied }, ultimate: { played, won, lost, tied } } },
//                                                   // tic-tac-toe is draw-heavy (Pro Classic is an unbeatable
//                                                   // solved game -- see tic-tac-toe/js/ai.js -- so most Pro
//                                                   // Classic games are draws), so `tied` is stored EXPLICITLY
//                                                   // per variant here, unlike `total`/`byDiff` above which
//                                                   // keep the shared {played,won,lost} shape (a draw stays
//                                                   // derivable there as played-won-lost, same as every other
//                                                   // game); see recordTicTacToe
//       dotsboxes: {
//         total, byDiff,
//         db: { played, won, lost, tied, boxes, bestChain } },  // Medium (4x4) can end in an 8-8 tie, so
//                                                   // `tied` is stored EXPLICITLY here too, same reasoning as
//                                                   // tictactoe's tt above; `boxes` is the human's cumulative
//                                                   // claimed-box count across every game (additive), and
//                                                   // `bestChain` is the longest single-turn capture run the
//                                                   // human has ever made (Math.max only, per THE LAW rule 2 --
//                                                   // never overwritten with a lower value); see recordDotsBoxes
//       boggle: {
//         total, byDiff,
//         bg: { played, won, lost, tied, words, bestScore, longestWord: { word, len } } },  // a timed round
//                                                   // scored against the AI's own found-word total, so it CAN
//                                                   // tie -- `tied` is stored EXPLICITLY, same reasoning as
//                                                   // tictactoe/dotsboxes above; `words` is the human's
//                                                   // cumulative found-word count (additive); `bestScore` and
//                                                   // `longestWord` are bests (Math.max / longer-only, per THE
//                                                   // LAW rule 2 -- never overwritten with a lower value); see
//                                                   // recordBoggle
//       yahtzee: {
//         total, byDiff,                           // difficulty is 'ai' (solo vs the AI, no tiers exist)
//                                                   // or 'mp' (multiplayer) -- both are unrecognized by
//                                                   // difficulty-tiers.js and read as a legacy/no-pill
//                                                   // bucket in the leaderboard, same convention as every
//                                                   // other MP game's 'mp' difficulty (see tictactoe)
//         yz: { played, won, lost, tied, yahtzees, bestScore } },  // a 13-round match scored against an
//                                                   // opponent's total, so it CAN tie -- `tied` is stored
//                                                   // EXPLICITLY, same reasoning as tictactoe/dotsboxes/
//                                                   // boggle above; `yahtzees` is the human's cumulative
//                                                   // count of Yahtzee-box scores of 50 PLUS bonus Yahtzees
//                                                   // across every game (additive); `bestScore` is the
//                                                   // highest single-game total ever reached (Math.max
//                                                   // only, per THE LAW rule 2); see recordYahtzee
//       dominoes: {
//         total, byDiff,                           // byDiff keyed by easy|medium|hard (the bot tier)
//         dm: { played, won, lost, tied, rounds, bestRound, points } },  // BOTH players score the
//                                                   // pips left in the opponent's hand at every round
//                                                   // end, so both totals can cross the target in the
//                                                   // same settle and the match CAN end level --
//                                                   // `tied` is stored EXPLICITLY, same reasoning as
//                                                   // tictactoe/dotsboxes/boggle/yahtzee above (it is
//                                                   // rare, not impossible); `rounds` is the human's
//                                                   // cumulative count of rounds played and `points`
//                                                   // their cumulative match-score total, both
//                                                   // additive; `bestRound` is the highest single
//                                                   // round the human has ever scored (Math.max only,
//                                                   // per THE LAW rule 2); see recordDominoes
//       hillclimb: {
//         total, byDiff,                           // byDiff keyed easy|medium|hard|expert -- Hill Climb's
//                                                   // four STAGES are its difficulty axis, mapped 1:1 and
//                                                   // in unlock order (HC_STAGES), so there is no separate
//                                                   // difficulty picker to reconcile
//         hc: { runs, bestDistance, bestDistanceByStage: { countryside, desert, arctic, moon },
//               coins, bestCoins, flips } },        // a solo endless driving run: no opponent, no loss
//                                                   // state (it ends in a crash or an empty tank), so
//                                                   // every finished run counts as played+won, same as
//                                                   // ballrun/snake/nutsbolts. Distance in whole meters,
//                                                   // bests Math.max only; `coins`/`flips` are LIFETIME
//                                                   // counters and only ever add. The game's spendable
//                                                   // coin WALLET is deliberately not here -- it lives in
//                                                   // hill-climb's own save (gamehub.hillclimb.v1), so
//                                                   // nothing that can go down is ever written into the
//                                                   // shared store; see recordHillClimb
//     updatedAt }
//
// `total`/`byDiff` are KEPT for every game (family sync + admin Player Insights read them); the
// per-game screens read the richer `grid`/`cc` dimensions. All additions are strictly additive.

const DEVICE_KEY = 'gamehub.deviceId';
const STATS_KEY = 'gamehub.stats';
const GAMES = ['connect4', 'chinchon', 'business', 'parchis', 'nutsbolts', 'escoba', 'filler', 'mancala', 'ballrun', 'tictactoe', 'dotsboxes', 'boggle', 'snake', 'uno', 'pool', 'poolv2', 'yahtzee', 'dominoes', 'hillclimb', 'battleship'];

// --- WHOSE stats these are (2026-07-23) -------------------------------------------------------------
//
// The store used to be keyed by DEVICE alone, so two people sharing one phone wrote into the same
// counters and there was no way to tell their plays apart afterwards. That is exactly what happened
// to Ana and Natalia (see CLAUDE.md, "The Ana/Natalia correction"): one device, one store, a week of
// blended history and no per-play log to unpick it with. This is the structural fix.
//
// The store is now chosen by the ACTIVE PROFILE'S PLAYER CODE, with one rule that makes the change
// free for every device that already exists:
//
//   * The FIRST code ever seen on a device becomes its OWNER and keeps `gamehub.stats` and the
//     `players/<deviceId>` sync node, exactly as before. **Nothing is migrated, copied, moved or
//     rewritten** - the owner's store is the same key holding the same bytes it held yesterday, so
//     there is no migration to get wrong and no window where history is anywhere but where it was
//     (THE LAW rules 1, 3 and 5 hold trivially rather than by careful handling).
//   * Any DIFFERENT code that later becomes active on that device gets its OWN store
//     (`gamehub.stats.p.<CODE>`) and its OWN sync node (`players/<deviceId>-<CODE>`). Two people on
//     one phone can no longer land in one record no matter what either of them does.
//   * A device with no profile code at all behaves exactly as it always did (device-wide store).
//
// The owner is recorded in `gamehub.stats.owner.v1`; every fork is appended to
// `gamehub.stats.forks.v1`, which is diagnostic only (nothing reads it but a human and
// js/device-report.js) and, per rule 5, is never pruned.
//
// KNOWN, DOCUMENTED GAP: if the SAME person loses their profile and is issued a brand-new code, this
// forks them away from their own history. Their old store is untouched on disk and their old node is
// untouched in Firebase, and players-agg.js unions devices by NAME as well as by code, so both My
// Stats and the leaderboard still show the full history whenever the device is online. Offline, the
// local view would show only the new store. js/hub.js's first-run gate narrows this by reusing the
// owner's code when the name typed matches the owner's own name; it cannot be closed completely
// without asking the player who they are, which is a product decision, not a storage one.
const OWNER_KEY = 'gamehub.stats.owner.v1';       // { code, name, at } - who owns STATS_KEY here
const FORK_KEY = 'gamehub.stats.forks.v1';        // append-only: every time a second identity appeared
const storeKeyFor = (code) => 'gamehub.stats.p.' + code;
const C4_DIFFS = ['easy', 'medium', 'hard', 'expert'];
// Nuts & Bolts difficulty tiers, lowercased to match normDiff() (its 'extraHard' -> 'extrahard').
export const NB_TIERS = ['easy', 'medium', 'hard', 'extrahard'];
// Ball Run difficulties (easy|medium|hard, no expert tier).
export const BR_DIFFS = ['easy', 'medium', 'hard'];
// Snake difficulties (easy|medium|hard — speed tiers; same axis shape as Ball Run, own constant
// so the two games can diverge without a rename).
export const SN_DIFFS = ['easy', 'medium', 'hard'];
// Snake's rule-variant axis (walls kill vs wrap-around), split out for the leaderboard (2026-07-28)
// — a rule variant, not a difficulty tier, so it stays a separate constant, never folded into
// SN_DIFFS (see snake/CLAUDE.md: wrap games record under the same easy/medium/hard ids).
export const SN_WALLS = ['on', 'off'];
// Hill Climb's stages, in unlock order. They ARE this game's difficulty axis (there is no
// separate picker), and hill-climb/js/catalog.js maps them 1:1 onto easy|medium|hard|expert for
// byDiff, so the leaderboard's per-tier breakdown reads as the per-stage breakdown.
export const HC_STAGES = ['countryside', 'desert', 'arctic', 'moon'];

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

/** The active profile's player code, or null. Read straight from localStorage rather than through
 *  profile-store.js: this module is imported by players-agg.js, which runs headless in Node, and the
 *  read must stay a bare, throw-proof key lookup with no module graph behind it. The regex is the
 *  same canonical form profile-store.js's `code()` enforces - keep the two in step. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export function activeCode() {
  try {
    const p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null');
    const c = (p && typeof p.playerId === 'string' ? p.playerId : '').trim().toUpperCase();
    return CODE_RE.test(c) ? c : null;
  } catch { return null; }
}
function activeName() {
  try {
    const p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null');
    return (p && typeof p.name === 'string' ? p.name : '').trim();
  } catch { return ''; }
}

/** Who owns this device's original store: { code, name, at }, or null if no code has appeared yet. */
export function statsOwner() { const o = readJSON(OWNER_KEY); return (o && typeof o === 'object' && o.code) ? o : null; }

function writeOwner(o) {
  try { localStorage.setItem(OWNER_KEY, JSON.stringify(o)); }
  catch (err) { console.error('[game-stats] could not record the store owner', err); }
}

/** Note a fork the first time a given code needs its own store here. Diagnostic + append-only; a
 *  failure to record it must never stop the fork itself, which is the part that protects the data. */
function noteFork(code, prevKey) {
  try {
    const log = readJSON(FORK_KEY);
    const list = Array.isArray(log) ? log : [];
    if (list.some((e) => e && e.code === code)) return;
    let prevPlays = 0;
    try {
      const prev = JSON.parse(localStorage.getItem(prevKey) || 'null');
      for (const g of Object.keys((prev && prev.games) || {})) prevPlays += (((prev.games[g] || {}).total || {}).played | 0);
    } catch { /* diagnostic only */ }
    list.push({ code, at: new Date().toISOString(), prevKey, prevPlays });
    localStorage.setItem(FORK_KEY, JSON.stringify(list));
    console.warn(`[game-stats] a second player (${code}) is now recording on this device. Their stats go to ${storeKeyFor(code)} and players/<deviceId>-${code}; the previous player's ${prevPlays} plays stay untouched in ${prevKey}.`);
  } catch (err) { console.error('[game-stats] could not record the store fork', err); }
}

/** Resolve WHOSE store is active: { code, key, syncId, forked }. Claims ownership of the legacy
 *  device-wide store for the first code ever seen here, and keeps the owner's display name fresh. */
function resolveStore() {
  const code = activeCode();
  const id = deviceId();
  if (!code) return { code: null, key: STATS_KEY, syncId: id, forked: false };
  const owner = statsOwner();
  if (!owner) {
    writeOwner({ code, name: activeName(), at: new Date().toISOString() });
    return { code, key: STATS_KEY, syncId: id, forked: false };
  }
  if (owner.code === code) {
    const name = activeName();
    if (name && name !== owner.name) writeOwner(Object.assign({}, owner, { name }));
    return { code, key: STATS_KEY, syncId: id, forked: false };
  }
  noteFork(code, STATS_KEY);
  return { code, key: storeKeyFor(code), syncId: id + '-' + code, forked: true };
}

/** The localStorage key holding the ACTIVE player's stats on this device. */
export function statsKey() { return resolveStore().key; }

/** The id this device's ACTIVE player syncs under: `players/<statsId()>`. Equals deviceId() for the
 *  device's owner (so every record that already exists keeps its exact node) and
 *  `<deviceId>-<CODE>` for anyone else playing here. Not a network identity - multiplayer still uses
 *  deviceId(), which is per-device by design. */
export function statsId() { return resolveStore().syncId; }

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

/** Ball Run's second map, Orbital (BALLRUNMAP2ORBITALSPEC.md, Phase 1). `br` above is Classic's
 *  bucket and stays completely untouched by this - all pre-existing history IS Classic history
 *  (Orbital didn't exist before this), so there is nothing to migrate or carry forward here, only
 *  a fresh, empty, additive sibling key for the new map. Same shape as `br`, same Math.max-only
 *  discipline (THE LAW rule 2). */
function ensureBrOrbital(g) {
  if (!g.brOrbital || typeof g.brOrbital !== 'object') g.brOrbital = { runs: 0, bestObstacles: 0, bestObstaclesByDiff: {} };
  if (!Number.isFinite(g.brOrbital.runs)) g.brOrbital.runs = 0;
  if (!Number.isFinite(g.brOrbital.bestObstacles)) g.brOrbital.bestObstacles = 0;
  if (!g.brOrbital.bestObstaclesByDiff || typeof g.brOrbital.bestObstaclesByDiff !== 'object') g.brOrbital.bestObstaclesByDiff = {};
  for (const d of BR_DIFFS) if (!Number.isFinite(g.brOrbital.bestObstaclesByDiff[d])) g.brOrbital.bestObstaclesByDiff[d] = 0;
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

/** Snake: the solo-run counters, Ball Run's proven shape (a run has no opponent and no loss
 *  state — it ends in a crash — so `sn.runs` is the true play count and the length bests are
 *  the scoreboard, Math.max only, per THE LAW rule 2). `bestLen` is the snake's LENGTH (start 3
 *  + food eaten) — the iconic "how long did it get" number. `bestLen`/`bestLenByDiff`/`runs`
 *  stay the combined-across-modes totals forever (rule 1: whatever already reads them keeps
 *  working). `bestLenByWalls`/`bestLenByDiffWalls`/`runsByWalls` (2026-07-28, the walls-mode
 *  leaderboard split) are the SAME numbers again, bucketed by `'on'|'off'` — additive fields
 *  alongside the originals, never replacing them. */
function ensureSn(g) {
  if (!g.sn || typeof g.sn !== 'object') g.sn = { runs: 0, bestLen: 0, bestLenByDiff: {} };
  if (!Number.isFinite(g.sn.runs)) g.sn.runs = 0;
  if (!Number.isFinite(g.sn.bestLen)) g.sn.bestLen = 0;
  if (!g.sn.bestLenByDiff || typeof g.sn.bestLenByDiff !== 'object') g.sn.bestLenByDiff = {};
  for (const d of SN_DIFFS) if (!Number.isFinite(g.sn.bestLenByDiff[d])) g.sn.bestLenByDiff[d] = 0;
  if (!g.sn.bestLenByWalls || typeof g.sn.bestLenByWalls !== 'object') g.sn.bestLenByWalls = { on: 0, off: 0 };
  for (const w of SN_WALLS) if (!Number.isFinite(g.sn.bestLenByWalls[w])) g.sn.bestLenByWalls[w] = 0;
  if (!g.sn.bestLenByDiffWalls || typeof g.sn.bestLenByDiffWalls !== 'object') g.sn.bestLenByDiffWalls = { on: {}, off: {} };
  for (const w of SN_WALLS) {
    if (!g.sn.bestLenByDiffWalls[w] || typeof g.sn.bestLenByDiffWalls[w] !== 'object') g.sn.bestLenByDiffWalls[w] = {};
    for (const d of SN_DIFFS) if (!Number.isFinite(g.sn.bestLenByDiffWalls[w][d])) g.sn.bestLenByDiffWalls[w][d] = 0;
  }
  if (!g.sn.runsByWalls || typeof g.sn.runsByWalls !== 'object') g.sn.runsByWalls = { on: 0, off: 0 };
  for (const w of SN_WALLS) if (!Number.isFinite(g.sn.runsByWalls[w])) g.sn.runsByWalls[w] = 0;
}

/** One-time seed (2026-07-28, Snake walls-mode leaderboard split). Every run recorded before this
 *  milestone carries no `walls` tag at all — Matt's explicit call is to treat that entire history
 *  as Walls off (a policy decision, not a recovered fact, the same footing as the Ana/Natalia date
 *  rule in js/CLAUDE.md), so it seeds the off-bucket from the legacy `bestLen`/`bestLenByDiff`/
 *  `runs` ONCE. The legacy fields themselves are never touched by this (THE LAW rule 5) and keep
 *  being updated by every future run regardless of mode, so anything still reading them (My Stats'
 *  combined tallies, the leaderboard's "Longest snake" texture chip) stays correct. Guarded so it
 *  can never re-run and clobber a real Walls-on score with a stale legacy value. */
function seedSnWallsLegacy(g) {
  if (g._snWallsSeeded) return false;
  g._snWallsSeeded = true;
  const sn = g.sn;
  sn.bestLenByWalls.off = Math.max(sn.bestLenByWalls.off | 0, sn.bestLen | 0);
  for (const d of SN_DIFFS) {
    sn.bestLenByDiffWalls.off[d] = Math.max(sn.bestLenByDiffWalls.off[d] | 0, sn.bestLenByDiff[d] | 0);
  }
  sn.runsByWalls.off += sn.runs | 0;
  return true;
}

/** Tic Tac Toe: the per-variant W/L/Tie counters. Draw-heavy by design (Pro
 *  Classic is unbeatable, see tic-tac-toe/js/ai.js), so `tied` is tracked
 *  explicitly here rather than left to be derived, unlike `total`/`byDiff`. */
function ensureTt(g) {
  if (!g.tt || typeof g.tt !== 'object') g.tt = {};
  for (const v of ['classic', 'ultimate']) {
    if (!g.tt[v] || typeof g.tt[v] !== 'object') g.tt[v] = { played: 0, won: 0, lost: 0, tied: 0 };
    for (const k of ['played', 'won', 'lost', 'tied']) if (!Number.isFinite(g.tt[v][k])) g.tt[v][k] = 0;
  }
}

/** Dots and Boxes: the per-match W/L/Tie counters plus the human's cumulative box
 *  count and best single-turn chain. Medium (4x4) can end 8-8, so `tied` is tracked
 *  explicitly here, same reasoning as ensureTt above. */
function ensureDb(g) {
  if (!g.db || typeof g.db !== 'object') g.db = { played: 0, won: 0, lost: 0, tied: 0, boxes: 0, bestChain: 0 };
  for (const k of ['played', 'won', 'lost', 'tied', 'boxes', 'bestChain']) if (!Number.isFinite(g.db[k])) g.db[k] = 0;
}

/** Boggle: the per-round W/L/Tie counters plus the human's cumulative found-word
 *  count and two bests (highest score, longest word). Scored against the AI's own
 *  found-word total, so it CAN tie -- `tied` is tracked explicitly, same reasoning
 *  as ensureTt/ensureDb above. */
function ensureBg(g) {
  if (!g.bg || typeof g.bg !== 'object') g.bg = { played: 0, won: 0, lost: 0, tied: 0, words: 0, bestScore: 0, longestWord: { word: '', len: 0 } };
  for (const k of ['played', 'won', 'lost', 'tied', 'words', 'bestScore']) if (!Number.isFinite(g.bg[k])) g.bg[k] = 0;
  if (!g.bg.longestWord || typeof g.bg.longestWord !== 'object') g.bg.longestWord = { word: '', len: 0 };
  if (typeof g.bg.longestWord.word !== 'string') g.bg.longestWord.word = '';
  if (!Number.isFinite(g.bg.longestWord.len)) g.bg.longestWord.len = 0;
}

/** Yahtzee: the per-match W/L/Tie counters plus the human's cumulative Yahtzee count
 *  and best single-game total. A 13-round match is scored against an opponent's
 *  total, so it CAN tie -- `tied` is tracked explicitly, same reasoning as
 *  ensureTt/ensureDb/ensureBg above. */
function ensureYz(g) {
  if (!g.yz || typeof g.yz !== 'object') g.yz = { played: 0, won: 0, lost: 0, tied: 0, yahtzees: 0, bestScore: 0 };
  for (const k of ['played', 'won', 'lost', 'tied', 'yahtzees', 'bestScore']) if (!Number.isFinite(g.yz[k])) g.yz[k] = 0;
}

/** Dominoes: the per-match W/L/Tie counters plus the human's cumulative rounds and points and
 *  their best single round. Every round end pays BOTH players the pips left in the opponent's
 *  hand, so both totals can cross the target in the same settle and the match can end level --
 *  `tied` is tracked explicitly, same reasoning as ensureTt/ensureDb/ensureBg/ensureYz above.
 *  `bestRound` is Math.max only (THE LAW rule 2). */
function ensureDm(g) {
  if (!g.dm || typeof g.dm !== 'object') g.dm = { played: 0, won: 0, lost: 0, tied: 0, rounds: 0, bestRound: 0, points: 0 };
  for (const k of ['played', 'won', 'lost', 'tied', 'rounds', 'bestRound', 'points']) if (!Number.isFinite(g.dm[k])) g.dm[k] = 0;
}

/** Hill Climb: a solo, distance-scored driving run. Same shape family as Ball Run's `br` and
 *  Snake's `sn` — a run has no opponent and no loss axis (it ends in a crash or an empty tank),
 *  so `hc.runs` is the true play count and the distance bests are the scoreboard.
 *    bestDistance / bestDistanceByStage   furthest meters, overall and per stage. Math.max ONLY
 *                                         (THE LAW rule 2), same discipline as every other best.
 *    coins / flips                        lifetime totals, pure counters, additive forever. These
 *                                         are the EARNED history; the spendable wallet balance
 *                                         lives only in hill-climb's own save (see its store.js),
 *                                         never here, precisely so nothing that can go DOWN is
 *                                         ever written into the shared store.
 *    bestCoins                            best single-run coin haul, Math.max. */
function ensureHc(g) {
  if (!g.hc || typeof g.hc !== 'object') g.hc = { runs: 0, bestDistance: 0, bestDistanceByStage: {}, coins: 0, bestCoins: 0, flips: 0 };
  for (const k of ['runs', 'bestDistance', 'coins', 'bestCoins', 'flips']) {
    if (!Number.isFinite(g.hc[k])) g.hc[k] = 0;
  }
  if (!g.hc.bestDistanceByStage || typeof g.hc.bestDistanceByStage !== 'object') g.hc.bestDistanceByStage = {};
  for (const s of HC_STAGES) if (!Number.isFinite(g.hc.bestDistanceByStage[s])) g.hc.bestDistanceByStage[s] = 0;
}

/** Battleship: W/L counters plus shots/hits/ships-sunk and two bests. This game has NO DRAW
 *  (root CLAUDE.md, section 3: the first fleet fully sunk loses, and only one side's fleet can
 *  finish being sunk on any single shot), so there is deliberately no `tied` field here -- do not
 *  add one; a later session "fixing" its omission would be fixing a bug that isn't one.
 *
 *  `fewestShotsWin` is the repo's FIRST best that improves by going DOWN (every other best in
 *  this file is Math.max). `0` is an unset sentinel meaning "no win recorded yet", never "zero
 *  shots" -- a real win always takes at least one shot. Handled explicitly here AND at the
 *  aggregation site (js/players-agg.js): a naive `Math.min(dst, src)` there would latch every
 *  player at 0 the moment a device with no wins syncs. `bestAccuracy` is a percentage 0-100,
 *  Math.max, and only updated here (recordBattleship is only ever called on a FINISHED game), so
 *  a quit game can never mint a fake accuracy. */
function ensureBs(g) {
  if (!g.bs || typeof g.bs !== 'object') g.bs = { played: 0, won: 0, lost: 0, shots: 0, hits: 0, sunk: 0, bestAccuracy: 0, fewestShotsWin: 0 };
  for (const k of ['played', 'won', 'lost', 'shots', 'hits', 'sunk', 'bestAccuracy', 'fewestShotsWin']) {
    if (!Number.isFinite(g.bs[k])) g.bs[k] = 0;
  }
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
  ensureBrOrbital(st.games.ballrun);
  ensureTt(st.games.tictactoe);
  ensureDb(st.games.dotsboxes);
  ensureBg(st.games.boggle);
  ensureYz(st.games.yahtzee);
  ensureDm(st.games.dominoes);
  ensureSn(st.games.snake);
  ensureHc(st.games.hillclimb);
  ensureBs(st.games.battleship);
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

/** Forked-store counterparts of foldAll/seedChinchonExtras: set the same fold-once guards so the
 *  device-wide legacy stores are never folded into a second player's store, and never will be on a
 *  later load either. The legacy keys themselves are left completely untouched (THE LAW rule 5) -
 *  they still belong to, and still show for, the owner. */
function latchLegacyGuards(st) {
  let changed = false;
  for (const id of ['chinchon', 'business']) { if (!st.games[id]._leg) { st.games[id]._leg = true; changed = true; } }
  return changed;
}
function latchChinchonSeed(st) {
  const g = st.games.chinchon;
  if (g._ccSeeded) return false;
  g._ccSeeded = true;
  ensureCc(g);
  return true;
}

function foldAll(st) {
  let changed = foldLegacy(st, 'chinchon', 'chinchon-stats', (c) => ({ played: c.games | 0, won: c.wins | 0, lost: c.losses | 0 }));
  changed = foldLegacy(st, 'business', 'bd-stats', (b) => ({ played: b.played | 0, won: b.won | 0, lost: b.lost | 0 })) || changed;
  return changed;
}

// F1 (durability, ARCH-REVIEW.md S4-1/S5-1): Monopoly Deal queues a play here
// (gamehub.bd.pendingStats.v1, in business-deal/js/ui.js's _recordResult) when its own
// window.__ghStats was unavailable at game-end - e.g. offline on a device whose install of BD's
// nested service worker predates game-stats-global.js being added to that worker's own cache
// list. Draining it here, on every hub load (loadStats() runs via hub.js's syncMyStats on every
// visit - see js/hub.js), guarantees the play still reaches the unified store: the hub's own ESM
// code is loaded fresh over the network by the ROOT service worker regardless of what BD's
// nested-SW seam is doing. Additive only, through the same bumpTotals() every other recorder uses.
const PENDING_BD_KEY = 'gamehub.bd.pendingStats.v1';
function drainPendingBusinessDeal(st) {
  const q = readJSON(PENDING_BD_KEY);
  if (!Array.isArray(q) || !q.length) return false;
  for (const e of q) {
    if (!e || GAMES.indexOf(e.game) < 0) continue;
    bumpTotals(st.games[e.game], normDiff(e.diff), e.won);
  }
  try { localStorage.removeItem(PENDING_BD_KEY); } catch { /* ignore */ }
  console.warn(`[game-stats] drained ${q.length} pending Monopoly Deal stat(s) that were queued while __ghStats was unavailable`);
  return true;
}

// Sixth-playthrough incident (Ball Run): a storage-write failure here was completely silent, with
// no trace anywhere a player or a future debugging session could see it. Every call site already
// discards this function's return value, so returning a success flag (instead of nothing) and
// logging on failure is purely additive: zero risk to any existing game, strictly more visibility
// for every game that shares this store.
function persist(st) {
  const key = statsKey();
  try { localStorage.setItem(key, JSON.stringify(st)); return true; }
  catch (err) { console.error(`[game-stats] persist failed, this write was not saved (${key})`, err); return false; }
}

/** The unified stats, with the legacy stores folded in (persisted the first time). */
export function loadStats() {
  const store = resolveStore();
  const raw = readJSON(store.key);
  // Snapshot `br` BEFORE normalize() runs: normalize() mutates `raw` in place (`st` below is the
  // same object, never cloned) and calls ensureBr() on it, which would otherwise stamp fresh
  // bestObstacles/bestObstaclesByDiff fields onto an old-shape `br` before migrateBallRunMetric
  // gets a chance to look at it. A deep clone taken here is genuinely untouched either way.
  const rawBr = raw && raw.games && raw.games.ballrun && raw.games.ballrun.br;
  const preNormalizeBr = rawBr && typeof rawBr === 'object' ? JSON.parse(JSON.stringify(rawBr)) : null;
  const st = normalize(raw);
  // The per-game legacy stores (chinchon-stats, bd-stats) are DEVICE-wide: they predate player codes
  // entirely, so they belong to whoever owned this device's original store. Folding them into a
  // second person's forked store would hand them the first person's history - the exact blending
  // this whole split exists to prevent. Latch the fold-once guards without folding instead.
  let changed = store.forked ? latchLegacyGuards(st) : foldAll(st);
  changed = (store.forked ? latchChinchonSeed(st) : seedChinchonExtras(st)) || changed;
  changed = migrateBallRunMetric(st, preNormalizeBr) || changed;
  changed = refoldBallRunLegacyRuns(st) || changed;
  changed = seedSnWallsLegacy(st.games.snake) || changed;
  changed = drainPendingBusinessDeal(st) || changed;
  ensureBr(st.games.ballrun); // re-fill BR_DIFFS defaults; migration may have reset `br` to a bare shape
  ensureBrOrbital(st.games.ballrun);
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
 *  bestObstacles/bestObstaclesByDiff only ever go up, matching every other best-tracking field here.
 *  `mapKey` (BALLRUNMAP2ORBITALSPEC.md, Phase 1) defaults to 'classic' so any caller that hasn't
 *  been updated for maps yet keeps writing exactly where it always did; `total`/`byDiff` are bumped
 *  regardless of map (an overall play count is still meaningful across maps), only the per-map
 *  best-score bucket (`br` for Classic, `brOrbital` for Orbital) is chosen by it. */
export function recordBallRun(obstaclesPassed, difficulty, mapKey = 'classic') {
  const st = loadStats();
  const g = st.games.ballrun;
  ensureBr(g);
  ensureBrOrbital(g);
  const mapBucket = mapKey === 'orbital' ? g.brOrbital : g.br;
  const d = BR_DIFFS.indexOf(normDiff(difficulty)) >= 0 ? normDiff(difficulty) : null;
  const score = Number.isFinite(obstaclesPassed) ? Math.max(0, Math.floor(obstaclesPassed)) : 0;
  if (d) bumpTotals(g, d, true); else { g.total.played += 1; g.total.won += 1; }
  mapBucket.runs += 1;
  mapBucket.bestObstacles = Math.max(mapBucket.bestObstacles | 0, score);
  if (d) mapBucket.bestObstaclesByDiff[d] = Math.max(mapBucket.bestObstaclesByDiff[d] | 0, score);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Tic Tac Toe: record a finished game, split by VARIANT. Maintains total/byDiff (as
 *  recordResult) AND the per-variant breakdown in `tt`. `variant` is 'classic' or
 *  'ultimate'; `difficulty` is beginner/intermediate/pro. `won` is true, false, or null
 *  for a draw (draws are very common here, especially Classic vs Pro -- Pro Classic is
 *  an unbeatable solved game by design, see tic-tac-toe/js/ai.js). A draw increments
 *  `played` and `tied` only; `won`/`lost` are never touched for it. Additive; never
 *  overwrites. */
export function recordTicTacToe(variant, difficulty, won) {
  const st = loadStats();
  const g = st.games.tictactoe;
  bumpTotals(g, normDiff(difficulty), won);
  ensureTt(g);
  const v = variant === 'ultimate' ? 'ultimate' : 'classic';
  const rec = g.tt[v];
  rec.played += 1;
  if (won === true) rec.won += 1;
  else if (won === false) rec.lost += 1;
  else rec.tied += 1;
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Dots and Boxes: record a finished match. Maintains total/byDiff (as recordResult)
 *  AND the `db` breakdown. `won` is true, false, or null for a tie (Medium/4x4 can end
 *  8-8) -- a tie increments `played` and `tied` only, matching recordTicTacToe.
 *  `extras` = { boxes, bestChain } for THIS game: `boxes` (the human's claimed-box
 *  count) is added to the running total; `bestChain` (the human's longest single-turn
 *  capture run) only ever raises the stored best (Math.max), per THE LAW rule 2.
 *  Additive; never overwrites. */
export function recordDotsBoxes(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.dotsboxes;
  bumpTotals(g, normDiff(difficulty), won);
  ensureDb(g);
  const e = extras || {};
  g.db.played += 1;
  if (won === true) g.db.won += 1;
  else if (won === false) g.db.lost += 1;
  else g.db.tied += 1;
  g.db.boxes += Math.max(0, e.boxes | 0);
  g.db.bestChain = Math.max(g.db.bestChain | 0, e.bestChain | 0);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Boggle: record a finished round. Maintains total/byDiff (as recordResult)
 *  AND the `bg` breakdown. `won` is true, false, or null for a tie (scored
 *  against the AI's own found-word total, so it CAN tie) -- a tie increments
 *  `played` and `tied` only, matching recordTicTacToe/recordDotsBoxes.
 *  `extras` = { words, score, longestWord: { word, len } } for THIS round:
 *  `words` (the human's found-word count) is added to the running total;
 *  `bestScore` only ever raises the stored best (Math.max), and
 *  `longestWord` is replaced only when this round's word is STRICTLY longer
 *  than the stored one, per THE LAW rule 2. Additive; never overwrites. */
export function recordBoggle(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.boggle;
  bumpTotals(g, normDiff(difficulty), won);
  ensureBg(g);
  const e = extras || {};
  g.bg.played += 1;
  if (won === true) g.bg.won += 1;
  else if (won === false) g.bg.lost += 1;
  else g.bg.tied += 1;
  g.bg.words += Math.max(0, e.words | 0);
  g.bg.bestScore = Math.max(g.bg.bestScore | 0, e.score | 0);
  const lw = e.longestWord;
  if (lw && typeof lw.word === 'string' && (lw.len | 0) > (g.bg.longestWord.len | 0)) {
    g.bg.longestWord = { word: lw.word, len: lw.len | 0 };
  }
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Yahtzee: record a finished 13-round match. Maintains total/byDiff (as recordResult) AND the
 *  `yz` breakdown. `difficulty` is 'ai' (solo vs the AI) or 'mp' (multiplayer) -- neither is a
 *  real tier, same convention as recordTicTacToe's 'mp' bucket. `won` is true, false, or null for
 *  a tie (matching totals) -- a tie increments `played` and `tied` only, matching
 *  recordTicTacToe/recordDotsBoxes/recordBoggle. `extras` = { yahtzees, score } for THIS game:
 *  `yahtzees` (first Yahtzee scored + every bonus Yahtzee) is added to the running total;
 *  `bestScore` only ever raises the stored best (Math.max), per THE LAW rule 2. Additive; never
 *  overwrites. */
export function recordYahtzee(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.yahtzee;
  bumpTotals(g, normDiff(difficulty), won);
  ensureYz(g);
  const e = extras || {};
  g.yz.played += 1;
  if (won === true) g.yz.won += 1;
  else if (won === false) g.yz.lost += 1;
  else g.yz.tied += 1;
  g.yz.yahtzees += Math.max(0, e.yahtzees | 0);
  g.yz.bestScore = Math.max(g.yz.bestScore | 0, e.score | 0);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Dominoes: record one finished MATCH (a race to the target score, not a single round).
 *  Maintains total/byDiff (as recordResult) AND the `dm` breakdown. `difficulty` is the bot tier
 *  (easy|medium|hard). `won` is true, false, or null for a tie -- both players score the pips
 *  left in the opponent's hand at every round end, so both totals can pass the target in the
 *  same settle and land equal; a tie increments `played` and `tied` only, matching
 *  recordTicTacToe/recordDotsBoxes/recordBoggle/recordYahtzee.
 *  `extras` = { rounds, bestRound, points } for THIS match: `rounds` (rounds played) and
 *  `points` (the human's final score) are added to the running totals; `bestRound` only ever
 *  raises the stored best (Math.max), per THE LAW rule 2. Additive; never overwrites. */
export function recordDominoes(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.dominoes;
  bumpTotals(g, normDiff(difficulty), won);
  ensureDm(g);
  const e = extras || {};
  g.dm.played += 1;
  if (won === true) g.dm.won += 1;
  else if (won === false) g.dm.lost += 1;
  else g.dm.tied += 1;
  g.dm.rounds += Math.max(0, e.rounds | 0);
  g.dm.points += Math.max(0, e.points | 0);
  g.dm.bestRound = Math.max(g.dm.bestRound | 0, e.bestRound | 0);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Snake: record one finished run. `length` is the snake's final length (start 3 + food eaten);
 *  `difficulty` is easy|medium|hard (speed tiers); `walls` is 'on'|'off' (defaults to 'on', the
 *  game's own classic default — an unrecognized value also reads as 'on', same tolerance as the
 *  setup screen's own save-shape read in snake/js/ui.js). A run has no opponent and no loss state,
 *  so it counts as played+won and `lost` is never touched (mirrors Ball Run / Nuts & Bolts).
 *  Additive; the length bests only ever go up, in BOTH the combined legacy fields (still updated
 *  every run, per THE LAW rule 1) and their walls-mode-split counterparts. */
export function recordSnake(length, difficulty, walls) {
  const st = loadStats();
  const g = st.games.snake;
  ensureSn(g);
  const d = SN_DIFFS.indexOf(normDiff(difficulty)) >= 0 ? normDiff(difficulty) : null;
  const w = SN_WALLS.indexOf(walls) >= 0 ? walls : 'on';
  const len = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (d) bumpTotals(g, d, true); else { g.total.played += 1; g.total.won += 1; }
  g.sn.runs += 1;
  g.sn.bestLen = Math.max(g.sn.bestLen | 0, len);
  if (d) g.sn.bestLenByDiff[d] = Math.max(g.sn.bestLenByDiff[d] | 0, len);
  g.sn.runsByWalls[w] += 1;
  g.sn.bestLenByWalls[w] = Math.max(g.sn.bestLenByWalls[w] | 0, len);
  if (d) g.sn.bestLenByDiffWalls[w][d] = Math.max(g.sn.bestLenByDiffWalls[w][d] | 0, len);
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Hill Climb: record one finished run. `distance` is whole meters reached; `stage` is one of
 *  HC_STAGES; `extras` is { coins, flips } from the run. A run has no opponent and no loss state,
 *  so it counts as played+won and `lost` is never touched (mirrors Ball Run / Snake / Nuts &
 *  Bolts). The stage maps onto the shared easy|medium|hard|expert difficulty axis for byDiff (see
 *  HC_STAGES), so an unrecognized stage still records its play in `total`, just not per-tier.
 *  Additive; the bests only ever go up, the lifetime coin/flip counters only ever add. */
export function recordHillClimb(distance, stage, extras) {
  const st = loadStats();
  const g = st.games.hillclimb;
  ensureHc(g);
  const s = HC_STAGES.indexOf(String(stage || '').trim()) >= 0 ? String(stage).trim() : null;
  const d = s ? ['easy', 'medium', 'hard', 'expert'][HC_STAGES.indexOf(s)] : null;
  const dist = Number.isFinite(distance) ? Math.max(0, Math.floor(distance)) : 0;
  const x = extras || {};
  const coins = Number.isFinite(x.coins) ? Math.max(0, Math.floor(x.coins)) : 0;
  const flips = Number.isFinite(x.flips) ? Math.max(0, Math.floor(x.flips)) : 0;
  if (d) bumpTotals(g, d, true); else { g.total.played += 1; g.total.won += 1; }
  g.hc.runs += 1;
  g.hc.bestDistance = Math.max(g.hc.bestDistance | 0, dist);
  if (s) g.hc.bestDistanceByStage[s] = Math.max(g.hc.bestDistanceByStage[s] | 0, dist);
  g.hc.coins += coins;
  g.hc.bestCoins = Math.max(g.hc.bestCoins | 0, coins);
  g.hc.flips += flips;
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Battleship: record one finished match. Maintains total/byDiff (as recordResult) AND the `bs`
 *  breakdown. `won` is true or false -- NEVER null (this game has no draw, see ensureBs above;
 *  callers must not pass null). `extras` = { shots, hits, sunk, accuracy } for THIS match:
 *  `shots`/`hits`/`sunk` are added to the running totals; `bestAccuracy` takes Math.max.
 *  `fewestShotsWin` only updates on a WIN, and only via the sentinel-aware Math.min below (0 =
 *  unset, never a real "won in 0 shots"). Additive; never overwrites. */
export function recordBattleship(difficulty, won, extras) {
  const st = loadStats();
  const g = st.games.battleship;
  bumpTotals(g, normDiff(difficulty), won);
  ensureBs(g);
  const e = extras || {};
  g.bs.played += 1;
  if (won === true) g.bs.won += 1; else if (won === false) g.bs.lost += 1;
  g.bs.shots += Math.max(0, e.shots | 0);
  g.bs.hits += Math.max(0, e.hits | 0);
  g.bs.sunk += Math.max(0, e.sunk | 0);
  g.bs.bestAccuracy = Math.max(g.bs.bestAccuracy | 0, e.accuracy | 0);
  if (won === true && (e.shots | 0) > 0) {
    g.bs.fewestShotsWin = g.bs.fewestShotsWin ? Math.min(g.bs.fewestShotsWin, e.shots | 0) : (e.shots | 0);
  }
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

/** Multiplayer head-to-head. CAPTURE ONLY -- nothing displays this yet, and that is deliberate.
 *
 *    gamehub.stats -> h2h: { [gameId]: { [opponentDeviceId]: { name, w, l } } }
 *
 *  A NEW top-level key holding nothing but incrementing counters, so it needs no migration and
 *  cannot disturb any existing shape (THE LAW rules 2 and 5 are satisfied by construction).
 *  stats-net.js mirrors `gamehub.stats` wholesale, so it syncs with no change there either.
 *
 *  It is written BEFORE there is a screen for it because the opponent's identity only exists while
 *  the multiplayer room is live: Chinchón and Escoba both know exactly who they just played, and
 *  both used to throw it away at match end. A display can be added whenever; matches played
 *  without this are permanently unrecoverable.
 *
 *  `opponent` is a room participant, `{ name, avatar, deviceId }` (js/net.js). `won` is true/false;
 *  anything else records the encounter without crediting either side. */
export function recordHeadToHead(gameId, opponent, won) {
  if (GAMES.indexOf(gameId) < 0) return null;
  const oppId = String((opponent && opponent.deviceId) || '').trim();
  if (!oppId || oppId === deviceId()) return null;         // no self-play rows
  const st = loadStats();
  if (!st.h2h || typeof st.h2h !== 'object') st.h2h = {};
  const perGame = st.h2h[gameId] || (st.h2h[gameId] = {});
  const row = perGame[oppId] || (perGame[oppId] = { name: '', w: 0, l: 0 });
  if (!Number.isFinite(row.w)) row.w = 0;
  if (!Number.isFinite(row.l)) row.l = 0;
  const name = String((opponent && opponent.name) || '').trim();
  if (name) row.name = name;                               // keep the freshest name seen
  if (won === true) row.w += 1;
  else if (won === false) row.l += 1;
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

export { GAMES, STATS_KEY, DEVICE_KEY, OWNER_KEY, FORK_KEY, storeKeyFor };
export default {
  deviceId, loadStats, recordResult, recordConnect4, recordChinchon, recordNutsBolts, recordEscoba,
  recordBallRun, recordTicTacToe, recordDotsBoxes, recordBoggle, recordSnake, recordYahtzee,
  recordDominoes, recordHillClimb, recordBattleship, recordHeadToHead,
  statsKey, statsId, statsOwner, activeCode,
  GAMES, STATS_KEY, DEVICE_KEY, OWNER_KEY, FORK_KEY, storeKeyFor,
};
