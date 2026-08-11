// arcade-scores.js - the shared high-score + unlock layer for the ARCADE-CABINET games (Skeeball
// now, Pinball next). Pure: no DOM, no localStorage, no Firebase. Every function takes a stats
// sub-counter and gives an answer, so it unit-tests headless and both games get identical
// semantics rather than two hand-written copies that drift.
//
// It exists as a SHARED module from day one on purpose. Matt asked for Skeeball and Pinball to
// work the same way, and this repo's own history (three storage-key generations, two setup-screen
// patterns) is what happens when "we'll extract it when the second one arrives" meets a fresh
// session with no memory of the first.
//
// THE LAW governs everything here, and two rules shaped the design directly:
//
// RULE 2 (writes are additive; nothing is ever zeroed) is why **the daily best is a DATE-KEYED MAP,
// not a value that resets**. `daily: { '2026-08-11': 640 }`. "Today's best" is a READ of today's
// key; tomorrow simply reads a different one. Nothing is ever cleared, no expiry job exists to get
// wrong, and the player keeps a real history for free. A `todayBest` field that a timer reset would
// have been a rule 2 violation with a cron job attached.
//
// RULE 2 again is why **unlocks merge as a UNION** across a person's devices. Intersecting - or
// letting the newest device win - would take a board away from someone who earned it on their
// phone the moment their tablet synced.

/** Local calendar day, YYYY-MM-DD. LOCAL, not UTC: "today" has to mean what the player thinks it
 *  means, and a day boundary that lands mid-evening for them would be indefensible. The cost is
 *  that a player who travels can see a day roll early or late once - which is the right trade. */
export function dayKey(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Fill in a per-board record so callers can assume the shape. Never throws. */
export function ensureBoard(boards, boardId) {
  const b = boards[boardId] || (boards[boardId] = {});
  for (const k of ['plays', 'points', 'best', 'bestThrow']) {
    if (!Number.isFinite(b[k])) b[k] = 0;
  }
  if (!b.daily || typeof b.daily !== 'object') b.daily = {};
  return b;
}

/**
 * Record one finished game on one board. ADDITIVE ONLY - counters climb, bests take Math.max,
 * and today's entry only ever improves.
 * @param {object} sub the game's stats sub-counter (Skeeball's `sk`)
 * @param {string} boardId
 * @param {{score:number, bestThrow?:number, at?:number}} game
 */
export function recordBoardGame(sub, boardId, game) {
  if (!sub || !boardId) return sub;
  if (!sub.boards || typeof sub.boards !== 'object') sub.boards = {};
  const b = ensureBoard(sub.boards, boardId);
  const score = Math.max(0, game?.score | 0);
  const key = dayKey(game?.at);
  b.plays += 1;
  b.points += score;
  b.best = Math.max(b.best | 0, score);
  b.bestThrow = Math.max(b.bestThrow | 0, Math.max(0, game?.bestThrow | 0));
  b.daily[key] = Math.max(b.daily[key] | 0, score);
  return sub;
}

/** Mark a board unlocked. Additive: an id that is already there stays, and nothing is ever removed
 *  (there is deliberately no `lock()` - a board you earned is history, not a preference). */
export function unlockBoard(sub, boardId) {
  if (!sub || !boardId) return sub;
  if (!sub.unlocked || typeof sub.unlocked !== 'object') sub.unlocked = {};
  sub.unlocked[boardId] = true;
  return sub;
}

export function isUnlocked(sub, boardId, defaultBoardId) {
  if (boardId === defaultBoardId) return true;        // the first machine is always playable
  return !!(sub && sub.unlocked && sub.unlocked[boardId]);
}

/** This player's all-time best on a board. */
export function bestOn(sub, boardId) {
  return ((sub && sub.boards && sub.boards[boardId]) || {}).best | 0;
}

/** This player's best on a board TODAY (a read of today's key - nothing resets). */
export function todayBestOn(sub, boardId, now) {
  const b = (sub && sub.boards && sub.boards[boardId]) || {};
  return ((b.daily || {})[dayKey(now)]) | 0;
}

/**
 * Merge one device's board records into an accumulator - the cross-device combine
 * (`js/players-agg.js` calls this). Counters add, bests take Math.max, and each DAY takes the max
 * of that day across devices. A day played on two devices keeps the better of the two, which is
 * the only answer that cannot lose a score.
 */
export function mergeBoards(dst, src) {
  if (!src || typeof src !== 'object') return dst;
  for (const id of Object.keys(src)) {
    const s = src[id] || {};
    const d = ensureBoard(dst, id);
    d.plays += s.plays | 0;
    d.points += s.points | 0;
    d.best = Math.max(d.best | 0, s.best | 0);
    d.bestThrow = Math.max(d.bestThrow | 0, s.bestThrow | 0);
    const sd = s.daily || {};
    for (const day of Object.keys(sd)) d.daily[day] = Math.max(d.daily[day] | 0, sd[day] | 0);
  }
  return dst;
}

/** Union of unlocked boards across devices. See the header: never an intersection. */
export function mergeUnlocked(dst, src) {
  if (!src || typeof src !== 'object') return dst;
  for (const id of Object.keys(src)) if (src[id]) dst[id] = true;
  return dst;
}

/**
 * The APP-WIDE record for a board: the best anyone has ever thrown on that machine.
 *
 * Derived at READ time from the already-synced player records rather than from a shared
 * `highscores/` node that every device writes to. That choice is deliberate: it needs no new
 * Firebase node, no write path, no rules change and no way for one device to corrupt a number
 * everyone sees - and it is guaranteed consistent with the leaderboard, which reads the same
 * records. The cost is that a new record appears only once that player's device next syncs.
 *
 * @param {Array} players aggregated rows from js/players-agg.js
 * @param {string} gameId stats id, e.g. 'skeeball'
 * @param {string} subKey the game's sub-counter key within that record - 'sk' for Skeeball, 'pb'
 *   for Pinball. A parameter rather than a guess: an aggregated row is
 *   `games[gameId] = { total, byDiff, <subKey>: {...} }`, and hardcoding one game's key here is
 *   exactly the kind of shared-module assumption that breaks the second consumer silently.
 * @param {string} boardId
 * @returns {{score:number, name:string}} score 0 and an empty name when nobody has played it
 */
export function appWideBest(players, gameId, subKey, boardId) {
  let out = { score: 0, name: '' };
  for (const p of players || []) {
    const sub = (((p.games || {})[gameId] || {})[subKey] || {});
    const b = ((sub.boards || {})[boardId] || {});
    const s = b.best | 0;
    if (s > out.score) out = { score: s, name: (p.name || '').trim() };
  }
  return out;
}

export default {
  dayKey, ensureBoard, recordBoardGame, unlockBoard, isUnlocked, bestOn, todayBestOn,
  mergeBoards, mergeUnlocked, appWideBest,
};
