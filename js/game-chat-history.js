// game-chat-history.js - the in-game quick chat you had with ONE person, for their Messages
// conversation (2026-10-17). Matt: "in game quick chats should be included here. Like they should
// appear within your convo with that person. It should be obvious which chats happen in game and in
// which game they occurred."
//
// READ ONLY. Nothing here writes, so nothing here can lose anything. It folds two things that
// already exist:
//   1. which challenge matches you have with that player code: each game's own index, through
//      js/challenges.js `loadAll` (one read per game);
//   2. each match's chat: `<node>/chat/<id>` (js/match-chat.js), or the match document's own `chat`
//      for Connect 4 Hoops (`hoops/games/<id>/chat`, the shape it was built with).
// A chat line says only `by: 'a'|'b'`, so the match is read for WHICH SIDE this player was, and only
// when that match has chat at all.
//
// LIVE-ROOM games (Air Hockey, Hold'em, ...) are not here: their chat is one overwritten slot per
// seat (`rooms/<CODE>/reactions`), so no history of it exists to show.

import { loadAll } from './challenges.js';
import { chatFrom, readChat } from './match-chat.js';

// hub id -> how to reach that game's matches and chat. `stats` names its title string.
const GAMES = {
  hoops4: { stats: 'hoops4', hoops: true },
  skeeball: { stats: 'skeeball', node: 'skeeChallenges', readMatch: (M, id) => M.readChallenge(id) },
  cuppong: { stats: 'cuppong', node: 'cuppong' },
  darts: { stats: 'darts', node: 'darts' },
  'flick-soccer': { stats: 'flicksoccer', node: 'flicksoccer' },
  archery: { stats: 'archery', node: 'archery' },
  chinchon: { stats: 'chinchon', node: 'chinchon' },
  escoba: { stats: 'escoba', node: 'escoba' },        // challenges only; live-room lines reach the thread via logGameChat
  'eight-ball': { stats: 'eightball', node: 'eightball' },   // two-player matches only (mp.js sideOf)
};
const LOADERS = {
  hoops4: () => import('../hoops4/js/mp.js'),
  skeeball: () => import('../skeeball/js/challenge.js'),
  cuppong: () => import('../cup-pong/js/mp.js'),
  darts: () => import('../darts/js/mp.js'),
  'flick-soccer': () => import('../flick-soccer/js/mp.js'),
  archery: () => import('../archery/js/mp.js'),
  chinchon: () => import('../chinchon/js/mp.js'),
  escoba: () => import('../escoba/js/mp.js'),
  'eight-ball': () => import('../eight-ball/js/mp.js'),
};
const MATCH_CAP = 30;

// TEST SEAM: tools/test-game-chat-history.mjs hands in fakes. No screen calls it.
let deps = { loadAll, readChat, loaders: LOADERS };
export function __setDepsForTest(d) { deps = d ? { ...deps, ...d } : { loadAll, readChat, loaders: LOADERS }; }   // the newest matches with this person; older chat is still in each match

/**
 * Every in-game chat line between this player (`me`) and `them` (player codes), oldest first:
 * `{ atMs, mine, t, v, game, statsId, matchId }`. `gameIds` limits it to games this launcher shows.
 * Never rejects; a game that cannot be read just adds nothing.
 */
export async function readGameChatsWith(me, them, gameIds = Object.keys(GAMES)) {
  if (!me || !them) return [];
  const ids = gameIds.filter((g) => GAMES[g]);
  let rows = [];
  try { rows = (await deps.loadAll(ids)).rows || []; } catch { return []; }
  const mine = rows.filter((r) => r && r.with === them)
    .sort((a, b) => b.updated - a.updated).slice(0, MATCH_CAP);
  const parts = await Promise.all(mine.map(async (r) => {
    const cfg = GAMES[r.game];
    try {
      const M = await deps.loaders[r.game]();
      let chat, match;
      if (cfg.hoops) {
        match = await M.readGame(r.id);
        chat = match ? (Array.isArray(match.chat) ? match.chat : chatFrom(match.chat)) : [];
      } else {
        chat = await deps.readChat({ node: cfg.node, id: r.id });
        if (!chat.length) return [];
        match = await (cfg.readMatch ? cfg.readMatch(M, r.id) : M.readGame(r.id));
      }
      if (!chat.length || !match) return [];
      const side = M.sideOf(match, me);
      if (side !== 'a' && side !== 'b') return [];
      return chat.map((c) => ({
        atMs: Number(c.at) || 0, mine: c.by === side, t: c.t, v: c.v,
        game: r.game, statsId: cfg.stats, matchId: r.id,
      }));
    } catch (err) {
      console.warn('[game-chat-history] could not read', r.game, r.id, err);
      return [];
    }
  }));
  return parts.flat().filter((x) => x.atMs > 0).sort((a, b) => a.atMs - b.atMs);
}

export const CHAT_GAMES = Object.keys(GAMES);
export default { readGameChatsWith, CHAT_GAMES };
