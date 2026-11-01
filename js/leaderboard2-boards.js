// leaderboard2-boards.js - Leaderboard v2's tallies, PURE (2026-10-31, round 1: docs/LEADERBOARD-V2-PLAN-R1.md).
//
// No DOM, no network, no storage. Matt, 2026-10-31: "an interface redesign, not a stats redesign". So v2
// builds NO board of its own: every board's rows come from the old board's code (js/leaderboard-ui.js
// lb2Board), and every medal TALLY here (Hall of Fame, the viewer's places) reads ONLY the old board's one
// standing per game (lb2Standing = gameStanding). One standing per game = the old board's gold count.
// (Round 0 built a board per difficulty x mode x opponent ranked by Win %: 104 golds where the old board
// had 40. Removed.) tools/test-leaderboard2.mjs tests this file; tools/test-lb2-parity.mjs the screens.

/** Competition ranks over rows already in order; `same(a, b)` says two rows tie. */
export function rankInPlace(rows, same) {
  let rank = 0;
  rows.forEach((r, i) => { if (i === 0 || !same(rows[i - 1], r)) rank = i + 1; r.rank = rank; });
  return rows;
}
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

/** `standings` = [{ game, rows: [{ key, g, name, emoji, rank, noMedal }] }] (one per game). */
export function hallOfFame(standings) {
  const tally = new Map();
  for (const st of standings || []) {
    for (const r of st.rows) {
      if (r.rank > 3 || r.noMedal) continue;
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
/** Medal totals over every standing: [golds, silvers, bronzes]. */
export function medalTotals(standings) {
  const out = [0, 0, 0];
  for (const st of standings || []) for (const r of st.rows) if (r.rank <= 3 && !r.noMedal) out[r.rank - 1] += 1;
  return out;
}
/** How many more golds `me` needs to pass the row above (null when leading or absent). */
export function firstsToPass(me, above) {
  if (!me || !above) return null;
  const restWins = (me.seconds - above.seconds) || (me.thirds - above.thirds);
  return Math.max(1, above.firsts - me.firsts + (restWins > 0 ? 0 : 1));
}
/** The nearest row ranked above `me`, or null when leading. */
export function aboveOf(rows, me) {
  if (!me || me.rank <= 1) return null;
  let best = null;
  for (const r of rows) if (r.rank < me.rank && (!best || r.rank > best.rank)) best = r;
  return best;
}
/** One person's place per game: { place: { game: { rank, tie } }, golds }. */
export function personPlaces(standings, key) {
  const out = { place: {}, golds: 0 };
  for (const st of standings || []) {
    const r = st.rows.find((x) => x.key === key);
    if (!r) continue;
    out.place[st.game] = { rank: r.rank, tie: !!r.tie, noMedal: !!r.noMedal };
    if (r.rank === 1 && !r.noMedal) out.golds += 1;
  }
  return out;
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

export default { rankInPlace, hallOfFame, medalTotals, firstsToPass, aboveOf, personPlaces, keyHash, rankSnapshot, rollRanks, moveOf, nyDay };
