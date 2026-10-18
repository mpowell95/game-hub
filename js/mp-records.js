// js/mp-records.js - the LIVE-ROOM half of the Multiplayer screen's Records (2026-10-18).
// js/challenges.js is the turn-by-turn half (each game's challenge index, by player code).
//
// Matt (2026-10-18), asked whether Records should show who you played in the live games: "Yes? Sure?"
// That reverses the 2026-08-11 call that nothing reads `h2h` (js/CLAUDE.md, "Multiplayer on the
// leaderboard"). This is the one reader, and it only READS:
//   - per game: `games[<statsId>].byDiff.mp` (every online match each live game files under 'mp'),
//     summed over all of this person's synced devices by js/players-agg.js, the leaderboard's own sum;
//   - per person: `h2h[<statsId>][<opponentDeviceId>] = {name, w, l}` (js/game-stats.js
//     recordHeadToHead), summed over this person's devices and folded onto the opponent's PERSON
//     (their player code) through the same identity graph.
// Nothing here writes a key, a node or a field (THE LAW). A device that cannot reach Firebase still
// sees its own local store.
//
// Honest limits, said once here and in js/CLAUDE.md:
//   - h2h exists only from the day each game started writing it (Chinchón/Escoba 2026-07-22 ... Battleship
//     2026-08-04); older online matches count under Games, never under People.
//   - Air Hockey, Texas Hold'em and Yahtzee write no h2h: Games only.
//   - At a 3-4 seat Chinchón/Escoba table `won` means "finished ahead of the whole table", so a loss
//     there is counted against every opponent at that table (their writers' own comment).

import { buildIdentity, aggregateForViewer, aggregatePlayers } from './players-agg.js';

/** Live-room multiplayer games: HUB id -> stats id. The turn-by-turn challenge games are NOT here
 *  (their records come from their own indexes; Hoops' live rooms share its 'mp' bucket with its
 *  challenges, so Hoops counts from its index alone, never twice). */
export const LIVE_GAMES = {
  'air-hockey': 'airhockey',
  battleship: 'battleship',
  boggle: 'boggle',
  chinchon: 'chinchon',
  'dots-boxes': 'dotsboxes',
  escoba: 'escoba',
  filler: 'filler',
  holdem: 'holdem',
  mancala: 'mancala',
  'tic-tac-toe': 'tictactoe',
  yahtzee: 'yahtzee',
};

const blank = () => ({ won: 0, lost: 0, draw: 0, other: 0, played: 0 });
const n = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);

/** The players/ record an h2h opponent device id names. A device whose owner shared the phone has
 *  `<deviceId>-<CODE>` nodes too; the row's own name picks between them, else the owner's node. */
function recordForDevice(all, devId, rowName) {
  const ids = Object.keys(all).filter((id) => id === devId || id.startsWith(devId + '-'));
  if (!ids.length) return null;
  const want = String(rowName || '').trim().toLowerCase();
  const byName = want && ids.find((id) => String(((all[id] || {}).profile || {}).name || '').trim().toLowerCase() === want);
  const id = byName || (ids.includes(devId) ? devId : ids[0]);
  return { id, rec: all[id] || {} };
}

/**
 * PURE. Live-room records for the viewer.
 * @param all        players/ (statsId -> record), {} offline
 * @param prof       the viewer's profile ({name, emoji, playerId})
 * @param myStatsId  statsId() - the viewer's own node key
 * @param localStats loadStats() - fresher than the viewer's own mirror
 * @param corrections admin corrections (applied by players-agg exactly as on the leaderboard)
 * @returns {{ byGame: {[hubId]: tally}, people: [{ key, code, name, emoji, ...tally, byGame }] }}
 */
export function liveRecords(all, prof, myStatsId, localStats, corrections) {
  const merged = Object.assign({}, all || {});
  const me = aggregateForViewer(merged, prof, myStatsId, localStats, corrections);
  const byGame = {};
  for (const [hub, sid] of Object.entries(LIVE_GAMES)) {
    const mp = me && me.games && me.games[sid] && me.games[sid].byDiff && me.games[sid].byDiff.mp;
    if (!mp || !(mp.played > 0)) continue;
    const won = n(mp.won), lost = n(mp.lost), played = Math.max(n(mp.played), won + lost);
    byGame[hub] = { won, lost, draw: played - won - lost, other: 0, played };
  }

  // The same merge aggregateForViewer made: the viewer's own node is their LOCAL store.
  const baseProf = (merged[myStatsId] && merged[myStatsId].profile) || {};
  const myProf = Object.assign({}, baseProf, {
    name: (prof && prof.name) || baseProf.name || '',
    emoji: (prof && prof.emoji) || baseProf.emoji || '',
    playerId: (prof && prof.playerId) || baseProf.playerId || '',
  });
  merged[myStatsId] = { profile: myProf, stats: localStats, updatedAt: Number.MAX_SAFE_INTEGER };
  const ident = buildIdentity(merged);
  const myKey = ident.keyFor(myProf, myStatsId);
  const groups = new Map(aggregatePlayers(merged).map((g) => [g.key, g]));

  const people = new Map();
  for (const id of Object.keys(merged)) {
    const rec = merged[id] || {};
    if (ident.keyFor(rec.profile || {}, id) !== myKey) continue;            // only the viewer's devices
    const h2h = (rec.stats && rec.stats.h2h) || {};
    for (const [hub, sid] of Object.entries(LIVE_GAMES)) {
      const per = h2h[sid];
      if (!per || typeof per !== 'object') continue;
      for (const devId of Object.keys(per)) {
        const row = per[devId] || {};
        const w = n(row.w), l = n(row.l);
        if (!w && !l) continue;
        const found = recordForDevice(merged, devId, row.name);
        const key = found ? ident.keyFor(found.rec.profile || {}, found.id) : 'h2h:' + devId;
        if (key === myKey) continue;                                        // never yourself
        const grp = groups.get(key);
        let p = people.get(key);
        if (!p) {
          p = {
            key,
            code: (grp && grp.playerId) || '',
            name: (grp && grp.name) || String(row.name || ''),
            emoji: (grp && grp.emoji) || '🙂',
            ...blank(), byGame: {},
          };
          people.set(key, p);
        }
        const g = p.byGame[hub] || (p.byGame[hub] = blank());
        p.won += w; p.lost += l; p.played += w + l;
        g.won += w; g.lost += l; g.played += w + l;
      }
    }
  }
  return { byGame, people: [...people.values()] };
}

/**
 * PURE. One Records view from the challenge summary (js/challenges.js summarize) and liveRecords():
 * people merged by PLAYER CODE (a live opponent with no code stays its own row, never guessed onto
 * someone), games by hub id, and the overall total as the sum of the games.
 */
export function mergeRecords(sum, live) {
  const add = (dst, src) => {
    for (const k of ['won', 'lost', 'draw', 'other', 'played']) dst[k] = (dst[k] || 0) + (src[k] || 0);
    return dst;
  };
  const byGame = {};
  for (const [g, o] of Object.entries((sum && sum.byGame) || {})) add(byGame[g] || (byGame[g] = blank()), o);
  for (const [g, o] of Object.entries((live && live.byGame) || {})) add(byGame[g] || (byGame[g] = blank()), o);
  const total = blank();
  for (const o of Object.values(byGame)) add(total, o);

  const people = new Map();
  for (const o of ((sum && sum.opponents) || [])) {
    const p = { key: 'code:' + o.code, code: o.code, name: o.name, emoji: o.emoji, ...blank(),
      live: o.live || 0, yours: o.yours || 0, last: o.last || 0, byGame: {} };
    add(p, o);
    for (const [g, t] of Object.entries(o.byGame || {})) p.byGame[g] = add(blank(), t);
    people.set(p.key, p);
  }
  for (const o of ((live && live.people) || [])) {
    const key = o.code ? 'code:' + o.code : o.key;
    let p = people.get(key);
    if (!p) {
      p = { key, code: o.code || '', name: o.name, emoji: o.emoji, ...blank(), live: 0, yours: 0, last: 0, byGame: {} };
      people.set(key, p);
    }
    if (!p.name) p.name = o.name;
    add(p, o);
    for (const [g, t] of Object.entries(o.byGame || {})) add(p.byGame[g] || (p.byGame[g] = blank()), t);
  }
  const list = [...people.values()].filter((p) => p.played > 0 || p.live > 0)
    .sort((x, y) => (y.played - x.played) || (y.live - x.live) || (y.last - x.last));
  return { total, byGame, people: list };
}

/** The viewer's live-room records, read once. Never rejects; offline = this device's own store. */
export async function loadLiveRecords() {
  try {
    const [{ readPlayersOnce }, gs, { loadProfile }, { corrections }] = await Promise.all([
      import('./stats-net.js'), import('./game-stats.js'), import('./profile-store.js'), import('./admin-config.js'),
    ]);
    // An RTDB read on a dead connection never settles (js/CLAUDE.md): give up on it after 8 s and
    // show this device's own store rather than a spinner for ever.
    let all = {};
    try {
      all = await Promise.race([readPlayersOnce(), new Promise((res) => setTimeout(() => res({}), 8000))]) || {};
    } catch { all = {}; }
    return liveRecords(all, loadProfile() || {}, gs.statsId(), gs.loadStats(), corrections());
  } catch (err) {
    console.warn('[mp-records] could not read the live-game records', err);
    return { byGame: {}, people: [] };
  }
}

export default { LIVE_GAMES, liveRecords, mergeRecords, loadLiveRecords };
