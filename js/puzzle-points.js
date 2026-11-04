// puzzle-points.js - POINTS for the solo puzzle boards: Sudoku, Murdoku, Nuts & Bolts, Minesweeper (Matt,
// 2026-11-03: "I'm fine with all proposals" + "hints should always reduce how many points you get";
// docs/LB-PUZZLE-POINTS-PROPOSAL.md). ADMIN DEVICES ONLY until Matt says "release it": js/leaderboard-ui.js gates
// every use on isAdminDevice().
//
// Sudoku / Murdoku: a solve is worth its level's points, stepped down by the help it used, the Arrow Maze way:
// Easy 1; Medium 2, 1; Hard 4, 3, 2, 1; Expert 8, 5, 3, 1 (0, 1, 2, 3+ hints; a Sudoku mistake counts as a hint).
// The help COUNT per solve is stored only from 2026-11-03 (`sd.hc` / `mu.hc`: { <level>: { h1, h2, h3 } }, h3 = 3+);
// an older solve with help (or not proven clean) pays HALF its level, never below 1: 1, 1, 2, 4.
// Nuts & Bolts: each level solved Easy 1, Medium 2, Hard 4, Expert 8, Easy at most 20 points in all (Matt chose "B",
// 2026-11-03: Easy levels never run out, so Easy is capped like the wins games' near-certain levels); levels are
// counted once per person by players-agg's dedupeNutsBolts; a win saved before levels existed is 1. No hints exist.
// Minesweeper: each board cleared Easy 1, Medium 3, Hard 8, Expert 20. Losses cost nothing.
//
// PURE and READ-TIME ONLY (THE LAW): reads one person's aggregated record (players-agg's shape), stores nothing.
import { tierOf } from './difficulty-tiers.js';

export const PUZZLE_POINT_GAMES = ['sudoku', 'murdoku', 'nutsbolts', 'minesweeper'];
/** Points for 0, 1, 2 and 3+ hints, per tier 1-4 (Sudoku, Murdoku). */
export const HINT_STEPS = { 1: [1, 1, 1, 1], 2: [2, 1, 1, 1], 3: [4, 3, 2, 1], 4: [8, 5, 3, 1] };
/** A helped solve from before the count was stored: half its level, never below 1. */
export const HINT_UNKNOWN = { 1: 1, 2: 1, 3: 2, 4: 4 };
export const LEVEL_POINTS = { nutsbolts: { 1: 1, 2: 2, 3: 4, 4: 8 }, minesweeper: { 1: 1, 2: 3, 3: 8, 4: 20 } };
/** The most points a level can add in all (Nuts & Bolts Easy: 20, the wins boards' CAP). */
export const LEVEL_CAP = { nutsbolts: { 1: 20 } };
export const NO_LEVEL_POINTS = 1;
export const HELP_KEYS = ['h1', 'h2', 'h3'];

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const n0 = (x) => Math.max(0, Number(x) | 0);

/** Solves per tier 1-4 from byDiff (several stored keys can share a tier), plus the wins with no level. */
function solvesByTier(game) {
  const bd = obj(game.byDiff), per = { 1: 0, 2: 0, 3: 0, 4: 0 }, keys = { 1: [], 2: [], 3: [], 4: [] };
  let tiered = 0;
  for (const k of Object.keys(bd)) {
    const t = tierOf(k);
    if (!per[t] && per[t] !== 0) continue;
    const w = n0(obj(bd[k]).won);
    per[t] += w; keys[t].push(k); tiered += w;
  }
  const noLevel = Math.max(0, n0(obj(game.total).won) - tiered);
  return { per, keys, noLevel };
}

/** Sudoku / Murdoku: { pts, wins } at `tier` (null = every tier). */
function hintPoints(game, id, tier) {
  const { per, keys } = solvesByTier(game);
  const sub = id === 'sudoku' ? obj(game.sd) : obj(game.mu);
  const clean = id === 'sudoku' ? obj(sub.noHint) : obj(sub.clean);
  const hc = obj(sub.hc);
  let pts = 0, wins = 0;
  for (const t of [1, 2, 3, 4]) {
    if (tier != null && t !== tier) continue;
    const won = per[t];
    if (!won) continue;
    let left = won;
    const take = (n) => { const k = Math.min(left, n0(n)); left -= k; return k; };
    const c = take(keys[t].reduce((s, k) => s + n0(clean[k]), 0));
    pts += c * HINT_STEPS[t][0];
    HELP_KEYS.forEach((h, i) => { pts += take(keys[t].reduce((s, k) => s + n0(obj(hc[k])[h]), 0)) * HINT_STEPS[t][i + 1]; });
    pts += left * HINT_UNKNOWN[t];
    wins += won;
  }
  return { pts, wins };
}

/** Nuts & Bolts / Minesweeper: { pts, wins } at `tier` (null = every tier, wins with no level included). */
function levelPoints(game, id, tier) {
  const { per, noLevel } = solvesByTier(game);
  let pts = 0, wins = 0;
  for (const t of [1, 2, 3, 4]) {
    if (tier != null && t !== tier) continue;
    const cap = (LEVEL_CAP[id] || {})[t];
    pts += cap != null ? Math.min(cap, per[t] * LEVEL_POINTS[id][t]) : per[t] * LEVEL_POINTS[id][t]; wins += per[t];
  }
  if (tier == null && id === 'nutsbolts') { pts += noLevel * NO_LEVEL_POINTS; wins += noLevel; }
  return { pts, wins };
}

/** One person's points in a puzzle game: { pts, wins }. `game` = their aggregated record for it (may be absent). */
export function puzzlePoints(game, id, tier = null) {
  const g = obj(game);
  if (id === 'sudoku' || id === 'murdoku') return hintPoints(g, id, tier);
  if (id === 'nutsbolts' || id === 'minesweeper') return levelPoints(g, id, tier);
  return { pts: 0, wins: 0 };
}

/** The help bucket a solve goes in: null = clean (0), else 'h1' | 'h2' | 'h3' (3 or more). For the recorders. */
export function helpKey(help) {
  const h = n0(help);
  return h === 0 ? null : h === 1 ? 'h1' : h === 2 ? 'h2' : 'h3';
}

export default { PUZZLE_POINT_GAMES, HINT_STEPS, HINT_UNKNOWN, LEVEL_POINTS, puzzlePoints, helpKey };
