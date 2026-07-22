// difficulty-tiers.js - READ-PATH normalization of every game's difficulty vocabulary onto one
// shared 1-4 tier scale, so the leaderboard can say "10 wins on Pro" and "10 wins on Beginner"
// are not the same achievement.
//
// This is deliberately a SEPARATE module from game-stats.js's normDiff(), which is on the WRITE
// path: normDiff only lowercases/trims, and changing it would alter what future records store.
// Nothing here ever writes. Pure and DOM-free, so it unit-tests headless with `node`.
//
// The canonical scale is the shared profile's (CLAUDE.md, "Consuming it in a game"): skill maps
// 1:1 as 1 Beginner, 2 Intermediate, 3 Pro. Connect Four's Expert is explicitly NOT a profile
// tier, so it (and Nuts & Bolts' Extra Hard) sit in an optional tier 4 above Pro.

export const TIERS = [1, 2, 3, 4];
export const TIER_LABEL = { 1: 'Beginner', 2: 'Intermediate', 3: 'Pro', 4: 'Expert' };
/** Short forms for narrow cells (the tier-mix bar's tooltip, the detail table on a phone). */
export const TIER_SHORT = { 1: 'Beg', 2: 'Int', 3: 'Pro', 4: 'Exp' };

// Three live vocabularies plus Parchís's Spanish one. Verified against each game's record call:
//   beginner/intermediate/pro  filler, mancala, tictactoe, dotsboxes, boggle (LEVEL_KEY/DIFFICULTIES)
//   easy/medium/hard/expert    connect4 (C4_DIFFS)
//   easy/medium/hard/extrahard nutsbolts (NB_TIERS)
//   easy/medium/hard           ballrun (BR_DIFFS)
//   easy/normal/hard           business
//   facil/normal/dificil       parchis
//   normal (default)           chinchon, escoba (opponent difficulty)
const MAP = {
  beginner: 1, easy: 1, facil: 1,
  intermediate: 2, medium: 2, normal: 2,
  pro: 3, hard: 3, dificil: 3,
  expert: 4, extrahard: 4,
};

/** Returns 1-4, or null for unrankable buckets ('unknown', 'legacy', anything unmapped).
 *  A null tier is still COUNTED everywhere (at weight 1.0) - it is only left out of the per-tier
 *  breakdown display. Dropping those plays would be a THE LAW rule 1 regression on exactly the
 *  legacy data foldLegacy() exists to preserve. */
export function tierOf(diffKey) {
  return MAP[String(diffKey == null ? '' : diffKey).toLowerCase().trim()] || null;
}

/** Rating multiplier per tier. Applied to BOTH numerator and denominator of the win rate, so the
 *  weighted rate stays inside [0,1]; see js/leaderboard-rank.js. Unmapped tiers use 1.0. */
export const TIER_WEIGHT = { 1: 0.8, 2: 1.0, 3: 1.25, 4: 1.5 };

/** Weight for a raw byDiff key, including the 1.0 fallback for null tiers. */
export function weightOf(diffKey) { return TIER_WEIGHT[tierOf(diffKey)] || 1.0; }

export default { TIERS, TIER_LABEL, TIER_SHORT, tierOf, TIER_WEIGHT, weightOf };
