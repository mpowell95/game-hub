// js/stats-corrections.js - ADMIN CORRECTIONS: the read-time layer that lets Matt say "those scores
// were thrown on a machine that was broken at the time, and they do not count."
//
// WHY THIS EXISTS (2026-08-24). Twice - THE CLASSIC and BASKET FEVER - a machine handed out scores
// while its physics were half-tuned, and those scores went into everybody's real record. Editing
// them out of Firebase by hand does not work and cannot be made to work: js/stats-net.js mirrors
// each device's WHOLE local store on every hub load, so the phone's copy overwrites the edit within
// minutes. The device is the source of truth for its own history and this file does not change that
// (THE LAW: nothing here deletes, rewrites or risks a single stored number).
//
// Instead a correction is an OVERLAY, stored where no phone can reach it (`adminConfig/v1`, written
// by the admin page only) and applied every time a number is DISPLAYED. The raw record stays
// exactly as the player's device recorded it - which is also the only honest answer to "why does my
// best say 0 when I remember 700": the 700 is still there, it is marked as not counting, and the
// reason and the date are stored beside it.
//
// THE SHAPE of one correction, per player-device (statsId) per machine:
//
//   { plays, points, best, bestThrow,  // the board's raw totals AT THE MOMENT it was voided
//     upto: 'YYYY-MM-DD',              // daily entries up to and including this day are dropped
//     at, by, why }
//
// It is a BASELINE, not a fixed subtraction, and that is deliberate: everything recorded up to the
// moment of the void stops counting, and everything recorded AFTER it counts normally. Throw a
// legitimate 300 on the fixed machine tomorrow and it shows as 300 - the correction does not have
// to be undone, and it never has to be edited again.
//
// WHAT IT CANNOT DO, stated plainly rather than discovered later:
//   - A device that was offline through the bad build still holds those racks and will upload them
//     the next time it opens the hub. They land AFTER the baseline, so they count. The admin page
//     shows the raw numbers beside the corrected ones so that drift is visible, and re-voiding is
//     one tap. A per-machine cutoff by build number would catch it automatically; per-player is
//     what was asked for (Matt, 2026-08-24) and this is the cost of it.
//   - `sk.balls`, `hundreds`, `fifties`, `tens`..`forties` and `colorSweeps` are LIFETIME counters
//     with no per-machine breakdown stored anywhere, so a per-machine void cannot touch them. They
//     are left exactly as they are rather than guessed at (THE LAW rule 4: never fabricate a
//     conversion between things the store does not actually relate).

/** Correction for one board, or null. Pure over a plain corrections map: `{ <boardId>: {...} }`. */
export function correctionFor(corrs, boardId) {
  const c = corrs && corrs[boardId];
  return c && typeof c === 'object' ? c : null;
}

/**
 * One board's record as it should be SHOWN.
 * - additive counters (plays, points) drop by what stood when the void was taken
 * - maxima (best, bestThrow) are NOT subtractable, so they survive only if a LATER score beat the
 *   voided one; otherwise they read 0 until the player throws something new
 * - daily bests are the one part with real dates on them, so they are filtered by date honestly
 */
export function correctBoard(raw, corr) {
  const b = raw || {};
  if (!corr) return b;
  const daily = {};
  const upto = String(corr.upto || '');
  for (const day of Object.keys(b.daily || {})) {
    if (!upto || day > upto) daily[day] = b.daily[day];
  }
  return {
    plays: Math.max(0, (b.plays | 0) - (corr.plays | 0)),
    points: Math.max(0, (b.points | 0) - (corr.points | 0)),
    best: (b.best | 0) > (corr.best | 0) ? (b.best | 0) : 0,
    bestThrow: (b.bestThrow | 0) > (corr.bestThrow | 0) ? (b.bestThrow | 0) : 0,
    daily,
  };
}

/**
 * A whole `games.skeeball` record as it should be SHOWN, given this player-device's corrections.
 * Returns a corrected COPY; the input is never mutated (it is the caller's live store or a synced
 * record, and mutating either would be the exact failure this file exists to avoid).
 * @param {object} gameRec  { total, byDiff, sk } from a stats store or a synced player record
 * @param {object} corrs    { <boardId>: correction }
 */
export function correctSkeeballRecord(gameRec, corrs) {
  const g = gameRec || {};
  const sk = g.sk || {};
  const ids = Object.keys(corrs || {}).filter((id) => correctionFor(corrs, id));
  if (!ids.length || !sk || typeof sk !== 'object') return g;

  const boards = Object.assign({}, sk.boards || {});
  let lostPlays = 0, lostPoints = 0;
  const byDiff = Object.assign({}, g.byDiff || {});
  for (const id of ids) {
    const before = boards[id];
    if (!before) continue;
    const after = correctBoard(before, corrs[id]);
    lostPlays += Math.max(0, (before.plays | 0) - (after.plays | 0));
    lostPoints += Math.max(0, (before.points | 0) - (after.points | 0));
    boards[id] = after;
    // `byDiff` is bucketed by BOARD id for Skeeball (js/game-stats.js's bumpTotals), so the voided
    // racks come out of that bucket too - otherwise the leaderboard's per-tier counts would still
    // carry them while every other screen had dropped them.
    const d = byDiff[id];
    if (d) {
      const drop = Math.max(0, (before.plays | 0) - (after.plays | 0));
      byDiff[id] = Object.assign({}, d, {
        played: Math.max(0, (d.played | 0) - drop),
        won: Math.max(0, (d.won | 0) - drop),
      });
    }
  }

  // The lifetime maxima blend every machine, so they can only be lowered when the record BELONGS to
  // a voided board - i.e. nothing else the player has ever thrown beat it. Otherwise it stands.
  const remainingBest = Math.max(0, ...Object.keys(boards).map((id) => boards[id].best | 0));
  const remainingThrow = Math.max(0, ...Object.keys(boards).map((id) => boards[id].bestThrow | 0));
  const voidedBest = Math.max(0, ...ids.map((id) => corrs[id].best | 0));
  const voidedThrow = Math.max(0, ...ids.map((id) => corrs[id].bestThrow | 0));
  const bestGame = (sk.bestGame | 0) > voidedBest ? (sk.bestGame | 0) : remainingBest;
  const bestThrow = (sk.bestThrow | 0) > voidedThrow ? (sk.bestThrow | 0) : remainingThrow;

  return Object.assign({}, g, {
    total: Object.assign({}, g.total || {}, {
      played: Math.max(0, ((g.total || {}).played | 0) - lostPlays),
      won: Math.max(0, ((g.total || {}).won | 0) - lostPlays),
    }),
    byDiff,
    sk: Object.assign({}, sk, {
      boards,
      played: Math.max(0, (sk.played | 0) - lostPlays),
      points: Math.max(0, (sk.points | 0) - lostPoints),
      bestGame,
      bestThrow,
    }),
  });
}

/**
 * Apply every correction that names this player-device to a whole stats store.
 * @param {object} stats  a `{ version, games }` store (local) or a synced record's `stats`
 * @param {string} id     the statsId this store belongs to
 * @param {object} all    every correction: { skeeball: { <statsId>: { <boardId>: {...} } } }
 */
export function correctStats(stats, id, all) {
  const st = stats || {};
  const corrs = (((all || {}).skeeball || {})[id]) || null;
  if (!corrs || !st.games || !st.games.skeeball) return st;
  const fixed = correctSkeeballRecord(st.games.skeeball, corrs);
  if (fixed === st.games.skeeball) return st;
  return Object.assign({}, st, { games: Object.assign({}, st.games, { skeeball: fixed }) });
}

/** What a void would store for a board right now: its raw totals, plus today. */
export function snapshotOf(board, day) {
  const b = board || {};
  return {
    plays: b.plays | 0, points: b.points | 0, best: b.best | 0, bestThrow: b.bestThrow | 0,
    upto: String(day || ''),
  };
}

export default { correctionFor, correctBoard, correctSkeeballRecord, correctStats, snapshotOf };
