// lb-points.js - POINTS on every wins-ranked leaderboard (Matt, 2026-11-02, docs/LEADERBOARD-POINTS-DECISIONS.md).
//
// Before: a wins board counted only the wins at the player's HARDEST level. Now every win adds points, set per
// game and per level (docs/LEADERBOARD-POINTS-PROPOSAL.md, section 2), online wins at the game's online value.
// NEAR-GUARANTEED levels (won 90%+ of the time, plus Tic Tac Toe Classic Medium) are 1 point a win, at most
// CAP (20) points per game per person from those levels together (Matt's rule).
// Option multipliers apply only to wins that saved their mode (byMode, from 2026-10-30); older wins count at
// the game's default option. A shortened match was already filed one level down when it was recorded.
//
// PURE and READ-TIME ONLY (THE LAW): reads one person's aggregated game record (players-agg's shape:
// total / byDiff / byMode / tt), stores nothing. No DOM, no storage, no network.
import { tierOf } from './difficulty-tiers.js';

export const CAP = 20;
// lv: points per win at tiers 1-4 (Easy, Medium, Hard, Expert); cap: the tiers in the 20-point group;
// on: an online win; other: a win in a bucket with no level (legacy history, Yahtzee's single level).
// mode(m, tier): points for a win at `tier` whose saved mode is `m`, or undefined = the level's own value.
const P = {
  tictactoe: { lv: [1, 1, 5], cap: [1, 2], on: 3, ult: [1, 3, 10] },   // Classic; Ultimate in `ult`
  connect4: { lv: [1, 6, 8, 12], on: 5 },
  dotsboxes: { lv: [1, 3, 5], on: 3, mode: (m, t, v) => (m.size === 'large' ? v * 2 : undefined) },
  filler: { lv: [1, 2, 3], on: 2 },
  mancala: { lv: [1, 2, 6], on: 3 },
  battleship: { lv: [1, 1, 3], cap: [1], on: 3, mode: (m, t, v, lv) => (m.size === 'quick' && t > 1 ? lv[t - 2] : undefined) },
  boggle: { lv: [2, 6, 10], on: 3 },
  business: { lv: [1, 2, 3], on: 3 },
  chinchon: { lv: [1, 2, 4], on: 3 },
  cuppong: { lv: [1, 1, 3], cap: [1, 2], on: 3, mode: (m, t, v) => (String(m.rr) === '0' && t === 3 ? v * 2 : undefined) },
  darts: { lv: [1, 2, 3], on: 3 },
  dominoes: { lv: [1, 2, 3], on: 3, mode: (m, t, v) => (+m.to >= 500 ? v * 2 : undefined) },
  eightball: { lv: [1, 3, 5], on: 3, mode: (m, t, v) => (+m.racks >= 3 ? v * 2 : undefined) },
  escoba: { lv: [1, 2, 4], on: 2 },
  flicksoccer: { lv: [1, 3, 6], cap: [1], on: 3, mode: (m, t) => (+m.goals === 3 ? ({ 2: 4, 3: 9 })[t] : undefined) },
  hoops4: { lv: [1, 3, 5], on: 3 },
  parchis: { lv: [1, 2, 4], on: 2 },
  uno: { lv: [1, 2, 3], on: 2 },
  yahtzee: { lv: [1, 1, 1], on: 1 },
  airhockey: { lv: [1, 2, 5], on: 3 },
};
const ONE = { lv: [1, 1, 1, 1], on: 1 };   // a wins game with no table yet (admin-only games): 1 a win
/** Points-ranked board ids (every wins board; js/lb-rules.js `by: 'wins'` or 'cuppong'). */
export const POINT_GAMES = Object.keys(P);
export function pointsTable(id) { return P[id] || ONE; }

const won = (b) => Math.max(0, (b && b.won) | 0);
const lvOf = (spec, t) => (t >= 1 && t <= spec.lv.length ? spec.lv[t - 1] : spec.lv[spec.lv.length - 1]);
/** Parse a byMode key ('goals=3|off=defend') into { goals: '3', off: 'defend' }. */
export function parseModeKey(k) {
  const m = {};
  for (const part of String(k || '').split('|')) { const i = part.indexOf('='); if (i > 0) m[part.slice(0, i)] = part.slice(i + 1); }
  return m;
}

/** Wins per tier (1-4), online, and level-less, from a game record. */
function winsSplit(gm) {
  const byT = [0, 0, 0, 0, 0], out = { byT, mp: 0, other: 0 };
  const bd = (gm && gm.byDiff) || {};
  let inBuckets = 0;
  for (const [d, b] of Object.entries(bd)) {
    const w = won(b); inBuckets += w;
    if (d === 'mp') { out.mp += w; continue; }
    const t = tierOf(d);
    if (t) byT[t] += w; else out.other += w;
  }
  // Wins in total but in no bucket (very old records): no level, counted as level-less.
  out.other += Math.max(0, won(gm && gm.total) - inBuckets);
  return out;
}

/** Tic Tac Toe: each level's wins split Classic / Ultimate. Saved modes (v=) are exact; Ultimate wins with
 *  no saved mode (tt.ultimate) are placed at Medium first, then Easy, then Hard (docs, "Guesses"). */
function ttSplit(gm, byT) {
  const ult = [0, 0, 0, 0, 0], cls = [0, 0, 0, 0, 0];
  const bm = (gm && gm.byMode) || {};
  let knownU = 0;
  for (const [k, ds] of Object.entries(bm)) {
    const v = parseModeKey(k).v;
    if (v !== 'ultimate' && v !== 'classic') continue;
    for (const [d, b] of Object.entries(ds || {})) {
      const w = won(b);
      if (v === 'ultimate') knownU += w;
      const t = tierOf(d);
      if (!t || t > 3) continue;
      (v === 'ultimate' ? ult : cls)[t] += w;
    }
  }
  for (let t = 1; t <= 3; t++) {                // never more than the level's stored wins
    ult[t] = Math.min(ult[t], byT[t]);
    cls[t] = Math.min(cls[t], byT[t] - ult[t]);
  }
  let left = Math.max(0, won(((gm && gm.tt) || {}).ultimate) - knownU);
  for (const t of [2, 1, 3]) {
    const free = byT[t] - ult[t] - cls[t];
    const n = Math.min(free, left);
    ult[t] += n; left -= n;
  }
  return ult;
}

/** One person's points in one game: `tier` null = everything (every level, online, level-less), 1-4 = that
 *  level only. Returns { pts, wins } (wins = the wins those points came from). */
export function gamePoints(gm, id, tier = null) {
  const spec = pointsTable(id);
  const s = winsSplit(gm);
  const capSet = new Set(spec.cap || []);
  let capped = 0, free = 0, wins = 0;
  const ult = id === 'tictactoe' ? ttSplit(gm, s.byT) : null;
  for (let t = 1; t <= 4; t++) {
    if (tier != null && t !== tier) continue;
    const w = s.byT[t];
    if (!w) continue;
    wins += w;
    const u = ult ? ult[t] : 0;
    if (u) free += u * spec.ult[Math.min(t, 3) - 1];
    if (capSet.has(t)) capped += (w - u) * lvOf(spec, t);
    else free += (w - u) * lvOf(spec, t);
  }
  // Option multipliers: wins whose saved mode is worth more (or less) than the level's own value.
  if (spec.mode) {
    const bm = (gm && gm.byMode) || {};
    const used = [0, 0, 0, 0, 0];
    for (const [k, ds] of Object.entries(bm)) {
      if (k === '?') continue;
      const m = parseModeKey(k);
      for (const [d, b] of Object.entries(ds || {})) {
        const t = tierOf(d);
        if (!t || (tier != null && t !== tier)) continue;
        const v0 = lvOf(spec, t);
        const v1 = spec.mode(m, t, v0, spec.lv);
        if (v1 == null || v1 === v0) continue;
        const n = Math.min(won(b), s.byT[t] - used[t]);
        if (n <= 0) continue;
        used[t] += n;
        if (capSet.has(t)) capped += n * (v1 - v0); else free += n * (v1 - v0);
      }
    }
  }
  if (tier == null) {
    free += s.mp * spec.on + s.other * 1;
    wins += s.mp + s.other;
  }
  return { pts: Math.min(CAP, Math.max(0, capped)) + free, wins };
}
/** Points for ONE win (the "+X pts" on a result screen): `diff` = the bucket it counted under ('mp' online),
 *  `mode` = the mode object withMode saved. Near-guaranteed levels give 1 (the 20-point cap is lifetime). */
export function pointsForWin(id, diff, mode) {
  const spec = pointsTable(id);
  if (diff === 'mp') return spec.on;
  const t = tierOf(diff);
  if (!t) return 1;
  if (id === 'tictactoe' && mode && mode.v === 'ultimate') return spec.ult[Math.min(t, 3) - 1];
  const v0 = lvOf(spec, t);
  if (spec.mode && mode && typeof mode === 'object') {
    const m = {};
    for (const k of Object.keys(mode)) m[k] = String(mode[k]);
    const v1 = spec.mode(m, t, v0, spec.lv);
    if (v1 != null) return v1;
  }
  return v0;
}
/** What a game's points are, for the (i) and the line on the board: { levels: [{ tier, pts, capped }],
 *  ult: [{ tier, pts }] | null (Tic Tac Toe Ultimate), on, extra (an option multiplier exists: strings
 *  lb_pts_x_<id>), cap }. Yahtzee has no levels (every win 1). */
export function pointsKey(id) {
  const spec = pointsTable(id);
  const capSet = new Set(spec.cap || []);
  const levels = id === 'yahtzee' ? [] : spec.lv.map((pts, i) => ({ tier: i + 1, pts, capped: capSet.has(i + 1) }));
  const ult = spec.ult ? spec.ult.map((pts, i) => ({ tier: i + 1, pts })) : null;
  return { levels, ult, on: spec.on, extra: !!spec.mode, cap: capSet.size ? CAP : 0 };
}
export default { CAP, pointsKey, POINT_GAMES, pointsTable, gamePoints, pointsForWin, parseModeKey };
