// leaderboard2-boards.js - every board of Leaderboard v2, PURE (2026-10-31, docs/LEADERBOARD-V2-PLAN.md).
//
// No DOM, no network, no storage: people in (the server-built board's groups, each what
// js/players-agg.js aggregatePlayers returns), boards out. js/leaderboard2-ui.js renders them;
// tools/test-leaderboard2.mjs tests them headless.
//
// A board = game x mode x difficulty x opponent (x language, as a mode part). Two kinds:
//  - WINS boards (every game with an opponent): vs computer per difficulty TIER from `byDiff`
//    (difficulty labels mapped by tierOf; 'mp' is never a tier), ranked by Win % (10+ games to appear)
//    or Wins; Multiplayer from `byDiff.mp`, ranked by Wins. "All modes" = byDiff (all history, also
//    the games recorded before modes existed, THE LAW rule 1); one mode = `byMode[key][diff]`, the key
//    projected onto the dimensions shown for that game (MODE_DIMS), every other part summed in.
//    A draw is never a win: wins are the stored `won`.
//  - SCORE boards (score and puzzle games, Hold'em's bankroll, Cup Pong's Solo): built by an injected
//    `score` provider (js/leaderboard-ui.js lb2ScoreSpecs/lb2ScoreBoard: that file's own orders and
//    numbers), so v2 can never rank a score game differently from the board it replaces.
// Ranks are competition ranks: a tie shares the place (1, 1, 3), and the Hall of Fame gives each tied
// player that place.
import { tierOf } from './difficulty-tiers.js';

export const MIN_PCT_GAMES = 10;

/** The mode dimensions each game's board offers (the plan's table). Any other part of a stored mode
 *  key (first move, assists, house rules, the computers' levels) is summed into the shown board. */
export const MODE_DIMS = {
  darts: ['kind'],
  eightball: ['game'],
  flicksoccer: ['goals'],
  cuppong: ['rr'],
  battleship: ['size'],
  boggle: ['lang', 'min'],
  chinchon: ['n', 'vc', 'sl', 'rl'],
  escoba: ['n', 'to', 'deck'],
  dominoes: ['to'],
  dotsboxes: ['size'],
  tictactoe: ['v'],
  uno: ['n'],
  business: ['ai'],
  holdem: ['tier'],
};

/** 'kind=301|first=me' -> { kind: '301', first: 'me' }. */
export function parseModeKey(key) {
  const out = {};
  for (const part of String(key || '').split('|')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
/** A stored mode key projected onto the game's shown dimensions ('' = no shown dimension). */
export function projectMode(game, key) {
  const dims = MODE_DIMS[game];
  if (!dims) return '';
  const m = parseModeKey(key);
  return dims.filter((d) => m[d] != null && m[d] !== '').map((d) => d + '=' + m[d]).join('|');
}

const num = (x) => Math.max(0, +x || 0);
const add = (to, b) => { to.played += num(b && b.played); to.won += num(b && b.won); to.lost += num(b && b.lost); };
const zero = () => ({ played: 0, won: 0, lost: 0 });

/** One person's record on one wins board: { played, won, lost }. `diff` is a tier (1-4) or null
 *  (vs computer with no tier: only for games whose buckets map to none). */
export function winsRecord(group, game, { mode = '', diff = null, opp = 'ai' } = {}) {
  const gm = ((group && group.games) || {})[game] || {};
  const out = zero();
  if (!mode) {
    const bd = gm.byDiff || {};
    if (opp === 'mp') { add(out, bd.mp); return out; }
    let sp = 0, sw = 0, sl = 0;
    for (const k of Object.keys(bd)) {
      const b = bd[k] || {};
      sp += num(b.played); sw += num(b.won); sl += num(b.lost);
      if (k === 'mp') continue;
      if ((tierOf(k) || null) === diff) add(out, b);
    }
    // Plays no bucket accounts for (pre-bucket history): no tier, so only a tierless board holds them
    // (js/leaderboard-rank.js bucketsOf's remainder, the same derivation).
    if (diff == null) {
      const t = gm.total || {};
      const rp = num(t.played) - sp;
      if (rp > 0) {
        const rl = Math.max(0, Math.min(num(t.lost) - sl, rp));
        out.played += rp; out.lost += rl; out.won += Math.max(0, Math.min(num(t.won) - sw, rp - rl));
      }
    }
    return out;
  }
  const bm = gm.byMode || {};
  for (const k of Object.keys(bm)) {
    if (projectMode(game, k) !== mode) continue;
    const per = bm[k] || {};
    for (const d of Object.keys(per)) {
      if (opp === 'mp') { if (d === 'mp') add(out, per[d]); continue; }
      if (d === 'mp') continue;
      if ((tierOf(d) || null) === diff) add(out, per[d]);
    }
  }
  return out;
}

/** Competition ranks over rows already in board order; `same(a, b)` says two rows tie. */
export function rankInPlace(rows, same) {
  let rank = 0;
  rows.forEach((r, i) => { if (i === 0 || !same(rows[i - 1], r)) rank = i + 1; r.rank = rank; });
  return rows;
}
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

/** The ranked rows of one wins board. rankBy 'pct' (10+ games, Win % high to low) or 'wins' (1+ win). */
export function winsRows(people, game, spec) {
  const rankBy = spec.opp === 'mp' ? 'wins' : (spec.rankBy || 'pct');
  const rows = [];
  for (const g of people || []) {
    const r = winsRecord(g, game, spec);
    if (r.played <= 0) continue;
    if (rankBy === 'pct' && r.played < MIN_PCT_GAMES) continue;
    if (rankBy === 'wins' && r.won <= 0) continue;
    const won = Math.min(r.won, r.played);
    rows.push({ g, key: g.key, name: g.name || '', emoji: g.emoji || '', games: r.played, won, pct: (won / r.played) * 100,
      value: rankBy === 'pct' ? (won / r.played) * 100 : won });
  }
  if (rankBy === 'pct') {
    // Exact fractions, so two equal records always tie (no float noise); more games first inside a tie.
    rows.sort((a, b) => (b.won * a.games - a.won * b.games) || (b.games - a.games) || byName(a, b));
    rankInPlace(rows, (a, b) => a.won * b.games === b.won * a.games);
  } else {
    rows.sort((a, b) => (b.won - a.won) || (a.games - b.games) || byName(a, b));
    rankInPlace(rows, (a, b) => a.won === b.won);
  }
  return rows;
}

/** Which wins boards a game has, from what anyone recorded: { aiTiers, aiModes, mpModes }.
 *  aiTiers: tiers present ([null] for a game whose buckets map to no tier, [] for no vs computer
 *  plays). Modes: projected keys present ('' = All modes, always first when the opponent exists). */
export function winsShape(people, game) {
  const tiers = new Set(); const aiModes = new Set(); const mpModes = new Set();
  let ai = false, mp = false, aiTierless = false;
  for (const g of people || []) {
    const gm = ((g && g.games) || {})[game] || {};
    const bd = gm.byDiff || {};
    let sp = 0;
    for (const k of Object.keys(bd)) {
      const p = num((bd[k] || {}).played); sp += p;
      if (p <= 0) continue;
      if (k === 'mp') { mp = true; continue; }
      ai = true;
      const t = tierOf(k); if (t) tiers.add(t); else aiTierless = true;
    }
    if (num((gm.total || {}).played) > sp) { ai = true; aiTierless = true; }
    const bm = gm.byMode || {};
    for (const k of Object.keys(bm)) {
      const pm = projectMode(game, k);
      for (const d of Object.keys(bm[k] || {})) {
        if (num((bm[k][d] || {}).played) <= 0) continue;
        if (d === 'mp') { mp = true; if (pm) mpModes.add(pm); continue; }
        ai = true;
        const t = tierOf(d); if (t) tiers.add(t); else aiTierless = true;
        if (pm) aiModes.add(pm);
      }
    }
  }
  const aiTiers = [...tiers].sort((a, b) => a - b);
  return {
    aiTiers: ai ? (aiTiers.length ? aiTiers : (aiTierless ? [null] : [])) : [],
    aiModes: ai ? ['', ...[...aiModes].sort(modeSort)] : [],
    mpModes: mp ? ['', ...[...mpModes].sort(modeSort)] : [],
  };
}
function modeSort(a, b) {
  const x = parseModeKey(a), y = parseModeKey(b);
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k], q = y[k];
    if (p === q) continue;
    if (p == null) return -1; if (q == null) return 1;
    const np = +p, nq = +q;
    if (Number.isFinite(np) && Number.isFinite(nq)) return np - nq;
    return String(p).localeCompare(String(q));
  }
  return 0;
}

export const boardId = (b) => [b.game, b.type, b.opp || '', b.mode || '', b.diff == null ? '' : b.diff, b.view || '', b.lang || '', b.rankBy || ''].join('~');

/** One board, fully built. `spec` = { game, type: 'wins'|'score', opp, mode, diff, rankBy } for wins,
 *  { game, type: 'score', view, diff, lang, by } for score (`score` = the provider). */
export function buildBoard(people, spec, score) {
  if (spec.type === 'score') {
    const r = score.board(people, spec.game, { view: spec.view || '', tier: spec.diff, lang: spec.lang, by: spec.by });
    const rows = r.rows.map((x) => ({ g: x.g, key: x.key, name: x.g.name || '', emoji: x.g.emoji || '', rank: x.rank, games: x.games,
      num: x.num, tier: x.tier, html: x.html, text: x.text, value: x.num, noPodium: !!x.noPodium }));
    const b = { ...spec, metric: 'score', unit: r.unit, kind: r.kind, lower: r.lower, gapFn: r.gap, rows };
    b.id = boardId(b);
    return b;
  }
  const rankBy = spec.opp === 'mp' ? 'wins' : (spec.rankBy || 'pct');
  const b = { ...spec, type: 'wins', rankBy, metric: rankBy, rows: winsRows(people, spec.game, { ...spec, rankBy }) };
  b.id = boardId(b);
  return b;
}

/** Every default board of one game (wins: Win % vs computer, Wins multiplayer; score: each tab at its
 *  default number). `isScore(game)` picks the provider path; wins games may add provider extras. */
export function gameBoards(people, game, { isScore, score }) {
  const out = [];
  const addScore = (sp, views) => {
    for (const v of views) {
      const tiers = v.tiered && sp.tiers.length ? sp.tiers : [null];
      const langs = sp.langs ? sp.langs.map((l) => l.lang) : [undefined];
      const by = sp.rankBy.length ? sp.rankBy[0].by : undefined;
      for (const lang of langs) for (const diff of tiers) out.push(buildBoard(people, { game, type: 'score', view: v.view, diff, lang, by }, score));
    }
  };
  if (isScore(game)) {
    const sp = score.specs(people, game);
    addScore(sp, sp.views);
    return out;
  }
  const sh = winsShape(people, game);
  for (const mode of sh.aiModes) for (const diff of sh.aiTiers) out.push(buildBoard(people, { game, type: 'wins', opp: 'ai', mode, diff, rankBy: 'pct' }));
  for (const mode of sh.mpModes) out.push(buildBoard(people, { game, type: 'wins', opp: 'mp', mode, diff: null, rankBy: 'wins' }));
  // Extra boards a wins game also has (Hold'em's Bankroll, Cup Pong's Solo): the provider's `extras`.
  const ex = score && score.extras ? score.extras(people, game) : null;
  if (ex && ex.views && ex.views.length) addScore(ex, ex.views);
  return out;
}

/** The hardest tier any board of the game is at, or null when it has none. */
export function topTierOf(boards) {
  let top = null;
  for (const b of boards) if (b.diff != null && (top == null || b.diff > top)) top = b.diff;
  return top;
}
/** Top level = the game's hardest difficulty only (Hard in a 3-level game, Expert in a 4-level one).
 *  Multiplayer and "All" tabs have no level, so they count only in All levels; a game with no
 *  difficulty at all has one level, its top. */
export function isTopLevel(board, top) {
  if (board.opp === 'mp') return false;
  return top == null ? true : board.diff === top;
}

/** Hall of Fame: every person with a podium place, by 1sts, then 2nds, then 3rds. `boards` = every
 *  default board; `topLevel` keeps only each game's hardest level. */
export function hallOfFame(boards, { topLevel = false } = {}) {
  const tops = {};
  if (topLevel) {
    const byGame = {};
    for (const b of boards) (byGame[b.game] || (byGame[b.game] = [])).push(b);
    for (const g of Object.keys(byGame)) tops[g] = topTierOf(byGame[g]);
  }
  const tally = new Map();
  for (const b of boards) {
    if (topLevel && !isTopLevel(b, tops[b.game])) continue;
    for (const r of b.rows) {
      if (r.rank > 3 || r.noPodium) continue;
      const t = tally.get(r.key) || { key: r.key, g: r.g, name: r.name, emoji: r.emoji, p: [0, 0, 0] };
      t.p[r.rank - 1] += 1;
      tally.set(r.key, t);
    }
  }
  const rows = [...tally.values()].map((t) => ({ ...t, firsts: t.p[0], seconds: t.p[1], thirds: t.p[2] }));
  const cmp = (a, b) => (b.firsts - a.firsts) || (b.seconds - a.seconds) || (b.thirds - a.thirds);
  rows.sort((a, b) => cmp(a, b) || byName(a, b));
  return rankInPlace(rows, (a, b) => cmp(a, b) === 0);
}
/** How many more 1sts `me` needs to pass the row above (null when leading or absent). */
export function firstsToPass(me, above) {
  if (!me || !above) return null;
  const restWins = (me.seconds - above.seconds) || (me.thirds - above.thirds);
  return Math.max(1, above.firsts - me.firsts + (restWins > 0 ? 0 : 1));
}

/** The nearest row ranked above `me` on a board (the "behind #K" target), or null when leading. */
export function aboveOf(rows, me) {
  if (!me || me.rank <= 1) return null;
  let best = null;
  for (const r of rows) if (r.rank < me.rank && (!best || r.rank > best.rank)) best = r;
  return best;
}

/** What separates `me` from `above` on a board: { k, v, n } (v formatted) or null.
 *  `fmt(x, digits)` formats a number for the viewer's language. */
export function gapOf(board, me, above, fmt = (x, d) => (d ? x.toFixed(d) : String(x))) {
  if (!me || !above) return null;
  if (board.metric === 'pct') {
    const d = Math.round((above.pct - me.pct) * 10) / 10;
    return d > 0 ? { k: 'pct', v: fmt(d, 1), n: d } : null;
  }
  if (board.metric === 'wins') {
    const d = above.won - me.won;
    return d > 0 ? { k: 'wins', v: fmt(d, 0), n: d } : null;
  }
  return board.gapFn ? board.gapFn(me, above) : null;
}
/** The pinned row's line: '1st' leading, 'Not ranked' absent, else "<amount> behind #K".
 *  `t2(key, params)` is the v2 strings' t (lb2_first, lb2_not_ranked, lb2_behind, lb2_amt). */
export function gapLine(board, me, t2, fmt) {
  if (!me) return t2('lb2_not_ranked');
  if (me.rank === 1) return t2('lb2_first');
  const above = aboveOf(board.rows, me);
  const gap = gapOf(board, me, above, fmt);
  if (!gap || gap.k === 'tier') return t2('lb2_behind_only', { r: above ? above.rank : me.rank - 1 });
  return t2('lb2_behind', { a: t2('lb2_amt', gap), r: above.rank });
}

/** Per-person summary over every board: { firsts, ranked, best: {game: rank}, crowns: {game: n} }. */
export function personSummary(boards, key) {
  const s = { firsts: 0, ranked: 0, best: {}, crowns: {}, boards: {}, played: {} };
  for (const b of boards) {
    const r = b.rows.find((x) => x.key === key);
    if (!r) continue;
    s.ranked += 1;
    s.boards[b.game] = (s.boards[b.game] || 0) + 1;
    if (s.best[b.game] == null || r.rank < s.best[b.game]) s.best[b.game] = r.rank;
    if (r.rank === 1 && !r.noPodium) { s.firsts += 1; s.crowns[b.game] = (s.crowns[b.game] || 0) + 1; }
  }
  return s;
}

// --- arrows: rank change since yesterday (a per-device daily snapshot until the server keeps one) ----
/** A short, stable, code-free hash of a person key (keys can hold a player code). */
export function keyHash(key) {
  let h = 0x811c9dc5;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
/** { boardId: { hash: rank } } for every row ranked `depth` or better, plus the viewer's own row. */
export function rankSnapshot(boards, meKey, depth = 15) {
  const out = {};
  for (const b of boards) {
    const m = {};
    for (const r of b.rows) if (r.rank <= depth || r.key === meKey) m[keyHash(r.key)] = r.rank;
    if (Object.keys(m).length) out[b.id] = m;
  }
  return out;
}
/** The stored snapshot after today's look: on a new day yesterday's `cur` becomes `prev`. */
export function rollRanks(stored, day, cur) {
  const s = stored && typeof stored === 'object' ? stored : null;
  if (!s || !s.day) return { v: 1, day, prev: null, cur };
  if (s.day === day) return { v: 1, day, prev: s.prev || null, cur };
  return { v: 1, day, prev: s.cur || null, cur };
}
/** Places moved since yesterday (+ up, - down, 0 none or unknown). */
export function moveOf(stored, bid, key, rank) {
  const p = stored && stored.prev && stored.prev[bid];
  if (!p) return 0;
  const was = p[keyHash(key)];
  return was ? was - rank : 0;
}
/** Today's date in America/New_York (Matt's day), 'YYYY-MM-DD'. */
export function nyDay(now = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  } catch { return new Date(now).toISOString().slice(0, 10); }
}

export default { MODE_DIMS, MIN_PCT_GAMES, parseModeKey, projectMode, winsRecord, winsRows, winsShape, buildBoard, gameBoards,
  hallOfFame, firstsToPass, aboveOf, gapOf, gapLine, personSummary, topTierOf, isTopLevel, keyHash, rankSnapshot, rollRanks, moveOf, nyDay, boardId };
