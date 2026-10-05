// js/challenges.js - the DATA half of the hub's Challenges screen (2026-10-05). js/challenges-ui.js
// is the screen.
//
// Matt: "i want to add a Challenges section. a button you can press where you can see all your live
// challenges - if it's your turn vs theirs, more info on your records total and against specific
// players, etc. You should also be able to send challenges and jump into games from this page."
//
// EVERY GAME KEEPS ITS OWN CHALLENGES. Four games have turn-by-turn challenges, each in its own
// Firebase node, each with a per-player index (`<node>/index/<CODE>/<id>`): Connect 4 Hoops
// (`hoops/`), Skeeball (`skeeChallenges/`), Cup Pong (`cuppong/`) and Darts (`darts/`). This module
// READS those four indexes through each game's own reader and folds them into one list. It writes
// nothing - no Firebase node, no `gamehub.*` key - so it cannot put any player data at risk (THE
// LAW). Opening a match or starting a challenge is handed to the game itself (its alerts module's
// armOpen / armChallenge), which is where every write already lives.
//
// The records are worked out from FINISHED index rows only, grouped by the other person's PLAYER
// CODE (a name can change, a code cannot). A row with no stored result (Hoops rows from before
// 2026-09-22) counts as played and in no win/loss/draw column, never guessed into one (THE LAW
// rule 4's spirit, the same call as hoops4/js/mp.js `recordsFrom`).

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** Each challenge game's reader. Keyed by the HUB id (js/hub.js GAMES). Lazily imported. */
export const SOURCES = {
  hoops4: {
    load: () => import('../hoops4/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
  },
  skeeball: {
    load: () => import('../skeeball/js/challenge.js'),
    read: async (M) => { try { await M.flushOutbox(); } catch { /* sent next time */ } return M.readMyChallenges(); },
    watch: (M, cb) => M.watchMyChallenges(cb),
    expired: (M, r, now) => !r.over && M.isExpired(r, now),
  },
  cuppong: {
    load: () => import('../cup-pong/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
  },
  darts: {
    load: () => import('../darts/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
  },
};
export const CHALLENGE_GAMES = Object.keys(SOURCES);

const RESULTS = ['won', 'lost', 'draw'];

/**
 * PURE. One game's index row as the Challenges screen sees it:
 * { game, id, with, name, emoji, updated, state:'yours'|'theirs'|'done'|'expired', result, info }.
 * `info` carries the few game-specific facts the row's subtitle names (series, darts game, machine).
 */
export function normalizeRow(game, r, expired = false) {
  if (!r || !r.id || !r.with) return null;
  const state = r.over ? 'done' : expired ? 'expired' : r.yourTurn ? 'yours' : 'theirs';
  return {
    game, id: String(r.id), with: String(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
    updated: ms(r.updated), state,
    result: r.over && RESULTS.includes(r.result) ? r.result : null,
    resigned: r.over && r.why === 'resign',
    info: {
      series: ms(r.series) > 1 ? ms(r.series) : 0,
      seriesNo: Math.max(1, ms(r.seriesNo) || 1),
      kind: typeof r.kind === 'string' ? r.kind : '',
      su: r.su === true,
      all: !!r.all,
      n: ms(r.n),
      boardName: String(r.boardName || ''),
    },
  };
}

const blank = () => ({ won: 0, lost: 0, draw: 0, other: 0, played: 0 });
function tallyInto(o, result) {
  o.played += 1;
  if (result === 'won') o.won += 1;
  else if (result === 'lost') o.lost += 1;
  else if (result === 'draw') o.draw += 1;
  else o.other += 1;
}

/**
 * PURE. Everything the screen shows, from normalised rows:
 *   yours / theirs  live matches, newest first
 *   finished        finished (and expired) matches, newest first
 *   total           { won, lost, draw, other, played } over finished matches
 *   byGame          { [game]: same }
 *   opponents       one per PLAYER CODE, most played first: { code, name, emoji, ...tally, live,
 *                   yours, last, byGame }. Named by their most recent row.
 */
export function summarize(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice().sort((x, y) => y.updated - x.updated);
  const total = blank();
  const byGame = {};
  const opp = new Map();
  for (const r of list) {
    let o = opp.get(r.with);
    if (!o) {
      o = { code: r.with, name: r.name, emoji: r.emoji, ...blank(), live: 0, yours: 0, last: r.updated, byGame: {} };
      opp.set(r.with, o);
    }
    if (r.state === 'yours' || r.state === 'theirs') {
      o.live += 1;
      if (r.state === 'yours') o.yours += 1;
    } else if (r.state === 'done') {
      tallyInto(total, r.result);
      tallyInto(byGame[r.game] || (byGame[r.game] = blank()), r.result);
      tallyInto(o, r.result);
      tallyInto(o.byGame[r.game] || (o.byGame[r.game] = blank()), r.result);
    }
  }
  const opponents = [...opp.values()]
    .sort((x, y) => (y.yours - x.yours) || (y.played - x.played) || (y.live - x.live) || (y.last - x.last));
  return {
    yours: list.filter((r) => r.state === 'yours'),
    theirs: list.filter((r) => r.state === 'theirs'),
    finished: list.filter((r) => r.state === 'done' || r.state === 'expired'),
    total, byGame, opponents,
  };
}

/** Every challenge in the given games: { rows, failed }. One read per game, in parallel. Never rejects. */
export async function loadAll(gameIds, now = Date.now()) {
  const ids = (gameIds || []).filter((g) => SOURCES[g]);
  const failed = [];
  const parts = await Promise.all(ids.map(async (g) => {
    try {
      const M = await SOURCES[g].load();
      const raw = await SOURCES[g].read(M);
      return toRows(g, M, raw, now);
    } catch (err) {
      console.warn('[challenges] could not read', g, err);
      failed.push(g);
      return [];
    }
  }));
  return { rows: parts.flat(), failed };
}

function toRows(g, M, raw, now = Date.now()) {
  const src = SOURCES[g];
  return (Array.isArray(raw) ? raw : [])
    .map((r) => normalizeRow(g, r, src.expired ? src.expired(M, r, now) : false))
    .filter(Boolean);
}

/** LIVE: `cb(rows, covered)` whenever any game's index changes: the rows of every game heard from so
 *  far, and which games those are (a game not yet heard from keeps whatever was read). Returns an
 *  unsubscribe. */
export async function watchAll(gameIds, cb) {
  const ids = (gameIds || []).filter((g) => SOURCES[g]);
  const per = {};
  const stops = [];
  let stopped = false;
  await Promise.all(ids.map(async (g) => {
    try {
      const M = await SOURCES[g].load();
      const stop = await SOURCES[g].watch(M, (raw) => {
        per[g] = toRows(g, M, raw);
        if (!stopped) {
          try { cb(ids.flatMap((x) => per[x] || []), Object.keys(per)); } catch (err) { console.warn('[challenges] watch', err); }
        }
      });
      if (stopped) { try { stop(); } catch { /* fine */ } } else stops.push(stop);
    } catch { /* that game simply is not live */ }
  }));
  return () => { stopped = true; for (const s of stops) { try { s(); } catch { /* fine */ } } };
}

/** Who you can challenge, one row per PLAYER CODE: Hoops' list, which Skeeball already reuses. */
export async function readOpponents() {
  try { return await (await import('../hoops4/js/mp.js')).readOpponents(); }
  catch (err) { console.warn('[challenges] could not read the player list', err); return []; }
}

/** This device's player code, or '' (the screen needs one to show anything). */
export async function myCode() {
  try { return (await import('../hoops4/js/mp.js')).myCode() || ''; } catch { return ''; }
}
