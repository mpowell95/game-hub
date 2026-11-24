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
  golf: { stats: 'golf', node: 'golf' },
  'flick-soccer': { stats: 'flicksoccer', node: 'flicksoccer' },
  archery: { stats: 'archery', node: 'archery' },
  chinchon: { stats: 'chinchon', node: 'chinchon' },
  escoba: { stats: 'escoba', node: 'escoba' },        // challenges only; live-room lines reach the thread via logGameChat
  'eight-ball': { stats: 'eightball', node: 'eightball' },   // two-player matches only (mp.js sideOf)
  'battle-arena': { stats: 'battlearena', node: 'battlearena' },   // challenges; live-room lines via logGameChat
  battleship: { stats: 'battleship', node: 'battleship' },          // challenges; live-room lines via logGameChat
};
const LOADERS = {
  hoops4: () => import('../hoops4/js/mp.js'),
  skeeball: () => import('../skeeball/js/challenge.js'),
  cuppong: () => import('../cup-pong/js/mp.js'),
  darts: () => import('../darts/js/mp.js'),
  golf: () => import('../golf/js/mp.js'),
  'flick-soccer': () => import('../flick-soccer/js/mp.js'),
  archery: () => import('../archery/js/mp.js'),
  chinchon: () => import('../chinchon/js/mp.js'),
  escoba: () => import('../escoba/js/mp.js'),
  'eight-ball': () => import('../eight-ball/js/mp.js'),
  'battle-arena': () => import('../battle-arena/js/mp.js'),
  battleship: () => import('../battleship/js/mp.js'),
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
export async function readGameChatsWith(me, them, gameIds = Object.keys(GAMES), cap = MATCH_CAP) {
  if (!me || !them) return [];
  const ids = gameIds.filter((g) => GAMES[g]);
  let rows = [];
  try { rows = (await deps.loadAll(ids)).rows || []; } catch { return []; }
  const mine = rows.filter((r) => r && r.with === them)
    .sort((a, b) => b.updated - a.updated).slice(0, cap);
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
        atMs: Number(c.at) || 0, mine: c.by === side, t: c.t, v: c.v, key: c.key,
        game: r.game, node: cfg.node, statsId: cfg.stats, matchId: r.id,
      }));
    } catch (err) {
      console.warn('[game-chat-history] could not read', r.game, r.id, err);
      return [];
    }
  }));
  return parts.flat().filter((x) => x.atMs > 0).sort((a, b) => a.atMs - b.atMs);
}

/**
 * THE CHAT CARRIES ON FROM MATCH TO MATCH (2026-11-24, Matt: "have chats continue game to game. I
 * sent it to Joe but the game ended immediately and now the chat is cleared"). For the match open
 * now (`node`, `id`, the player's `side`): every earlier chat line with the SAME person in the SAME
 * game, oldest first, as panel lines `{ key, mine, t, v, at, pm }` (`pm` = the match it was said in,
 * where its photo lives). READ ONLY; [] on any failure. The open match's own lines are left out (its
 * watch delivers them).
 */
const EARLIER_CAP = 15;
export async function readEarlierChats({ node, id, side }) {
  try {
    const hub = Object.keys(GAMES).find((g) => GAMES[g].node === node);
    if (!hub || (side !== 'a' && side !== 'b')) return [];
    const cfg = GAMES[hub];
    const M = await deps.loaders[hub]();
    const match = await (cfg.readMatch ? cfg.readMatch(M, id) : M.readGame(id));
    const other = side === 'a' ? 'b' : 'a';
    const me = match && match[side] && match[side].code;
    const them = match && match[other] && match[other].code;
    if (!me || !them) return [];
    const lines = await readGameChatsWith(me, them, [hub], EARLIER_CAP);
    return lines.filter((l) => l.matchId !== id && l.key).map((l) => ({
      key: `${l.matchId}~${l.key}`, mine: l.mine, t: l.t, v: l.v, at: l.atMs, pm: { node, id: l.matchId },
    }));
  } catch (err) {
    console.warn('[game-chat-history] earlier chats', err);
    return [];
  }
}

export const CHAT_GAMES = Object.keys(GAMES);
export default { readGameChatsWith, readEarlierChats, CHAT_GAMES };
