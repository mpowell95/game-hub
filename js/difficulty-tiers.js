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
// Display vocabulary (2026-07-24, Matt's explicit reversal of batch 8's Beginner/Intermediate/
// Pro): Easy/Medium/Hard/Expert. Stored ids/byDiff buckets are untouched everywhere (THE LAW
// rule 5) — this is a label-only rename.
export const TIER_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };
/** Short forms for narrow cells (the tier-mix bar's tooltip, the detail table on a phone). */
export const TIER_SHORT = { 1: 'Easy', 2: 'Med', 3: 'Hard', 4: 'Exp' };

/** Ski-slope shape color per tier (2026-07-24): moved here from leaderboard-ui.js so every
 *  setup screen can color its own shapes, not just the leaderboard. Values unchanged. */
export const TIER_COLOR = { 1: '#2e9e44', 2: '#1F5FA8', 3: '#1c2430', 4: '#1c2430' };

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

/** Ski-slope difficulty shape markup (pure, no DOM): tier 1 circle, 2 square, 3 diamond,
 *  4 double-diamond. Moved here verbatim from leaderboard-ui.js (2026-07-23, batch 8) so every
 *  game's setup screen can render the SAME shape leaderboard-ui.js uses, not a re-derived copy.
 *  **2026-07-24**: each shape now also carries a per-tier `lb-dshape-tN` class AND an inline
 *  `fill="<TIER_COLOR>"` attribute (Matt: the shapes shipped without their color code, so
 *  "it doesn't make any sense to use those symbols"). The inline fill makes color work on every
 *  surface with zero per-game CSS (standalone game pages never load hub.css, and `diffShapeSVG`
 *  emits `currentColor` shapes otherwise); the class exists so CSS can still override it (the
 *  leaderboard's `--lb-pill-color` does, on an active pill; dark mode overrides tiers 3/4 to a
 *  light color in css/hub.css's `:root.gh-dark` block). Colorblind rule holds by construction:
 *  color is paired with shape, never alone. */
export function diffShapeSVG(tier) {
  const fill = TIER_COLOR[tier] || 'currentColor';
  if (tier === 1) return `<svg viewBox="0 0 20 20" class="lb-dshape lb-dshape-t1" fill="${fill}" aria-hidden="true"><circle cx="10" cy="10" r="8"/></svg>`;
  if (tier === 2) return `<svg viewBox="0 0 20 20" class="lb-dshape lb-dshape-t2" fill="${fill}" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3"/></svg>`;
  if (tier === 3) return `<svg viewBox="0 0 20 20" class="lb-dshape lb-dshape-t3" fill="${fill}" aria-hidden="true"><rect x="4.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 10 10)"/></svg>`;
  if (tier === 4) return `<svg viewBox="0 0 34 20" class="lb-dshape lb-dshape-x2 lb-dshape-t4" fill="${fill}" aria-hidden="true"><rect x="1.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 7 10)"/><rect x="21.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 27 10)"/></svg>`;
  return '';
}

export default { TIERS, TIER_LABEL, TIER_SHORT, TIER_COLOR, tierOf, TIER_WEIGHT, weightOf, diffShapeSVG };
