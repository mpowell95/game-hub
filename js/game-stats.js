// game-stats.js - shared per-device play stats for every game.
//
// One record PER DEVICE (a random UUID in gamehub.deviceId), NEVER keyed by the profile name, so
// renaming the profile never loses or forks a person's stats. Every write is additive (increment,
// never overwrite). The pre-existing per-game stores (chinchon-stats, bd-stats) are folded in ONCE
// per game (a `_leg` guard) so their history carries into the unified stats with no double-count.
//
// Shape of localStorage['gamehub.stats']:
//   { version:1,
//     games: { connect4|chinchon|business|parchis: {
//       total:  { played, won, lost },
//       byDiff: { <difficultyLabel>: { played, won, lost }, ... },   // 'legacy' = folded-in history
//       _leg:   true } },
//     updatedAt }

const DEVICE_KEY = 'gamehub.deviceId';
const STATS_KEY = 'gamehub.stats';
const GAMES = ['connect4', 'chinchon', 'business', 'parchis'];

function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function bucket() { return { played: 0, won: 0, lost: 0 }; }

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
  return st;
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

function foldAll(st) {
  let changed = foldLegacy(st, 'chinchon', 'chinchon-stats', (c) => ({ played: c.games | 0, won: c.wins | 0, lost: c.losses | 0 }));
  changed = foldLegacy(st, 'business', 'bd-stats', (b) => ({ played: b.played | 0, won: b.won | 0, lost: b.lost | 0 })) || changed;
  return changed;
}

function persist(st) { try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch { /* ignore */ } }

/** The unified stats, with the legacy stores folded in (persisted the first time). */
export function loadStats() {
  const st = normalize(readJSON(STATS_KEY));
  if (foldAll(st)) persist(st);
  return st;
}

/** Record one finished game. `difficulty` is the game's own label (easy/normal/hard/expert, or
 *  beginner/intermediate/pro/expert, etc). `won` is true (human won), false (human lost), or null
 *  for a draw (counted in `played` only; draws = played - won - lost). Additive; never overwrites. */
export function recordResult(gameId, difficulty, won) {
  if (GAMES.indexOf(gameId) < 0) return null;
  const st = loadStats();
  const g = st.games[gameId];
  const d = String(difficulty == null ? '' : difficulty).toLowerCase().trim() || 'unknown';
  if (!g.byDiff[d]) g.byDiff[d] = bucket();
  g.total.played += 1; g.byDiff[d].played += 1;
  if (won === true) { g.total.won += 1; g.byDiff[d].won += 1; }
  else if (won === false) { g.total.lost += 1; g.byDiff[d].lost += 1; }
  st.updatedAt = new Date().toISOString();
  persist(st);
  return st;
}

export { GAMES, STATS_KEY, DEVICE_KEY };
export default { deviceId, loadStats, recordResult, GAMES, STATS_KEY, DEVICE_KEY };
