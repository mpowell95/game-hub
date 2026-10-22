// js/challenges.js - the DATA half of the hub's Challenges screen (2026-10-05). js/challenges-ui.js
// is the screen.
//
// Matt: "i want to add a Challenges section. a button you can press where you can see all your live
// challenges - if it's your turn vs theirs, more info on your records total and against specific
// players, etc. You should also be able to send challenges and jump into games from this page."
//
// EVERY GAME KEEPS ITS OWN CHALLENGES. Seven games have turn-by-turn challenges, each in its own
// Firebase node, each with a per-player index (`<node>/index/<CODE>/<id>`): Connect 4 Hoops
// (`hoops/`), Skeeball (`skeeChallenges/`), Cup Pong (`cuppong/`), Darts (`darts/`), Flick Soccer
// (`flicksoccer/`, 2026-10-11), Pool (`eightball/`, 2026-10-22), Archery (`archery/`, 2026-10-14) and Escoba (`escoba/`, 2026-10-18). This module READS those indexes through each game's own reader and folds them into one list. It writes
// nothing itself - no Firebase node, no `gamehub.*` key. Opening a match or starting a challenge is
// handed to the game (its alerts module's armOpen / armChallenge), and CANCEL / DECLINE / RESIGN
// (2026-10-13, Matt: "a way to cancel sent challenge requests, and a way to resign/forfeit") call
// the game's own mp.js (`endAction` / `endMatch` below), so every write still lives in the game.
//
// The records are worked out from FINISHED index rows only, grouped by the other person's PLAYER
// CODE (a name can change, a code cannot). A row with no stored result (Hoops rows from before
// 2026-09-22) counts as played and in no win/loss/draw column, never guessed into one (THE LAW
// rule 4's spirit, the same call as hoops4/js/mp.js `recordsFrom`).

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** Each challenge game's reader. Keyed by the HUB id (js/hub.js GAMES). Lazily imported. */
/**
 * What may be done to one live match of a turn-by-turn game, read FRESH from the match itself (not
 * from the list row, which can be a turn behind): 'cancel' (you sent it and they have not
 * answered), 'decline' (it was sent to you and you have not played), 'resign' (it is under way), or
 * null (over, expired, unreadable, or not yours). js/challenge-life.js has the rules.
 */
async function logGameAction(M, id) {
  const g = await M.readGame(id);
  const me = M.myCode();
  const side = g && me ? M.sideOf(g, me) : null;
  if (!g || g.over || !side) return null;
  const life = M.lifeOf(g);
  if (life.expired) return null;
  if (!life.open) return 'resign';
  return side === M.recipientOf(g) ? 'decline' : 'cancel';
}
async function logGameEnd(M, id, action) {
  const res = action === 'resign' ? await M.resignGame(id) : await M.cancelGame(id);
  // A resignation is a loss, counted here once through the game's own ledger, exactly as the game's
  // own Resign button does (Darts, Cup Pong, Flick Soccer). Left to the next list read instead, it
  // would also queue a "Game over" popup for your own resignation. Hoops has no countResult: its
  // own Quit leaves the count to recordFinished too, and so does this.
  if (res && res.ok && action === 'resign' && !res.cancelled && typeof M.countResult === 'function') {
    try { M.countResult(id, false); } catch (err) { console.error('[challenges] could not count the resignation', err); }
  }
  return res;
}

export const SOURCES = {
  hoops4: {
    load: () => import('../hoops4/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  skeeball: {
    load: () => import('../skeeball/js/challenge.js'),
    read: async (M) => { try { await M.flushOutbox(); } catch { /* sent next time */ } return M.readMyChallenges(); },
    watch: (M, cb) => M.watchMyChallenges(cb),
    expired: (M, r, now) => !r.over && M.isExpired(r, now),
    action: async (M, id) => {
      const g = await M.readChallenge(id);
      const me = M.myCode();
      const side = g && me ? M.sideOf(g, me) : null;
      if (!g || g.over || !side || M.isExpired(g)) return null;
      if (!M.isOpen(g)) return 'resign';
      return side === 'b' ? 'decline' : 'cancel';
    },
    end: (M, id, action) => (action === 'resign' ? M.resignChallenge(id) : M.cancelChallenge(id)),
  },
  cuppong: {
    load: () => import('../cup-pong/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  darts: {
    load: () => import('../darts/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  'flick-soccer': {
    load: () => import('../flick-soccer/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  // Archery (2026-10-14): archery/js/mp.js, the same log-game shape as Darts.
  archery: {
    load: () => import('../archery/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  // Chinchón (2026-10-18): chinchon/js/mp.js, the same log-game shape (a log of draws, discards and
  // closes). Also a live-room game: js/mp-records.js counts its Games row from 'mp' once.
  chinchon: {
    load: () => import('../chinchon/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  // Escoba (2026-10-18): escoba/js/mp.js, the same log-game shape as Darts. Escoba also has live
  // rooms; its challenge results are counted in the same 'mp' bucket and never in head-to-head.
  escoba: {
    load: () => import('../escoba/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: logGameAction,
    end: logGameEnd,
  },
  // Pool (2026-10-22): eight-ball/js/mp.js. Two OR THREE players (Cutthroat): a match keeps a list
  // of seats, not sides, so its own action reader; a row's `with` is one fixed other player (its
  // records count against that person) and `name` names both.
  'eight-ball': {
    load: () => import('../eight-ball/js/mp.js'),
    read: (M) => M.readMyGames(),
    watch: (M, cb) => M.watchMyGames(cb),
    action: async (M, id) => {
      const g = await M.readGame(id);
      const seat = g ? M.seatOf(g, M.myCode()) : -1;
      if (!g || g.over || seat < 0) return null;
      const life = M.lifeOf(g);
      if (life.expired) return null;
      if (!life.open) return 'resign';
      return seat === 0 ? 'cancel' : 'decline';
    },
    end: logGameEnd,
  },
};

/** What may be done to a live match right now ('cancel' | 'decline' | 'resign' | null). Never rejects. */
export async function endAction(game, id) {
  try { const src = SOURCES[game]; if (!src) return null; return await src.action(await src.load(), id); }
  catch (err) { console.warn('[challenges] could not read that match', err); return null; }
}

/** Cancel, decline or resign one match, through the GAME's own writer. Returns its result:
 *  { ok, cancelled? } or { ok:false, reason }. Never rejects. */
export async function endMatch(game, id, action) {
  try {
    const src = SOURCES[game];
    if (!src || !['cancel', 'decline', 'resign'].includes(action)) return { ok: false, reason: 'bad-action' };
    return await src.end(await src.load(), id, action);
  } catch (err) {
    console.error('[challenges] could not end that match', err);
    return { ok: false, reason: String((err && err.message) || err) };
  }
}
export const CHALLENGE_GAMES = Object.keys(SOURCES);

const RESULTS = ['won', 'lost', 'draw'];

/**
 * PURE. One game's index row as the Challenges screen sees it:
 * { game, id, with, name, emoji, updated, state:'yours'|'theirs'|'done'|'expired'|'cancelled',
 *   result, ended, open, sent, info }.
 * `ended` is how a match ended without a result ('cancelled' | 'declined' | 'expired', from each
 * game's row: js/challenge-life.js), `open` whether it is still unanswered ('sent' | 'got' | ''),
 * `sent` whether this player sent it. `info` carries the few game-specific facts the row's subtitle
 * names (series, darts game, machine).
 */
export function normalizeRow(game, r, expired = false) {
  if (!r || !r.id || !r.with) return null;
  const ended = ['cancelled', 'declined', 'expired'].includes(r.ended) ? r.ended : (expired ? 'expired' : '');
  const state = ended === 'cancelled' || ended === 'declined' ? 'cancelled'
    : ended === 'expired' ? 'expired'
      : r.over ? 'done' : r.yourTurn ? 'yours' : 'theirs';
  return {
    game, id: String(r.id), with: String(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
    updated: ms(r.updated), state, ended,
    open: state === 'yours' || state === 'theirs' ? (r.open === 'sent' || r.open === 'got' ? r.open : '') : '',
    sent: !!r.sent,
    // When a live match stops waiting on somebody (js/challenge-life.js; Skeeball: every turn). 0 = never.
    expires: state === 'yours' || state === 'theirs' ? ms(r.expires) : 0,
    result: state === 'done' && RESULTS.includes(r.result) ? r.result : null,
    resigned: state === 'done' && (r.why === 'resign' || r.ended === 'resign'),
    info: {
      series: ms(r.series) > 1 ? ms(r.series) : 0,
      seriesNo: Math.max(1, ms(r.seriesNo) || 1),
      kind: typeof r.kind === 'string' ? r.kind : '',
      su: r.su === true,
      all: !!r.all,
      n: ms(r.n),
      boardName: String(r.boardName || ''),
      len: typeof r.len === 'string' ? r.len : '',          // Escoba: '1' one hand, '11' / '21'
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
    // Expired and called-off matches are listed (so a player sees what became of a challenge) and
    // counted in no record: nobody played them.
    finished: list.filter((r) => r.state === 'done' || r.state === 'expired' || r.state === 'cancelled'),
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

/** This device's player code, or '' (the screen needs one to show anything). Straight from the
 *  shared profile (2026-10-18): it used to import Connect 4 Hoops' mp.js just to ask, a network
 *  fetch on every phone that does not show Hoops (its files are held back, sw.js HELD_BACK). */
export async function myCode() {
  try { const { loadProfile, canonicalizeCode } = await import('./profile-store.js'); const p = loadProfile(); return canonicalizeCode(p && p.playerId) || ''; } catch { return ''; }
}
