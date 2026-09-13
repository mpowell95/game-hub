// season.js : the pure season/standings/playoff model (doc §4). No DOM, no game.js dependency,
// no randomness outside a seeded `hashSeed`/`mulberry32` pair - a reusable module both the phase 2
// simulator and, later, phase 4's real career loop can share, the way `js/leaderboard-rank.js`
// serves both the leaderboard UI and its own headless tests.
//
// A league is `makeLeague(league)`'s 8 CPU teams, ordered weakest to strongest (index 0..7,
// teams.js's own contract), plus the player as a ninth entry (doc §4: "Top 4 of 9 make the
// playoffs"). This module never plays a game itself - every CPU-vs-CPU result is SCRIPTED (doc
// §17/§18's own wording), and the player's own games are played through the real engine by the
// caller and folded in as `playerResults`.

import { hashSeed, mulberry32 } from './rng.js';
import { BRACKET_MODEL, STANDINGS_MODEL, SCHEDULE_SHAPE } from './settings.js';

// doc §4, [Draft]: "12 regular season games per league across 8 opponents." doc §8, [Locked]: "the
// schedule puts harder opponents later in the season... the championship opponent is always the
// toughest team in the league." BB-2c commit 4, doc §13 Open item 13: three shapes, all weakest to
// strongest on the first pass and meeting the champion (index 7) exactly once, in game 12 - see
// `settings.js`'s `SCHEDULE_SHAPE` for the full rationale and the measured proposal.
const OPPONENT_ORDERS = {
  repeatTop: [0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7],
  repeatBottom: [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7],
  repeatMiddle: [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7],
};

/** A Fisher-Yates shuffle of a fixed 6-home/6-away flag array, seeded - "home and away six and
 *  six shuffled by seed" (doc §4). */
function shuffledHomeFlags(rand01) {
  const flags = [true, true, true, true, true, true, false, false, false, false, false, false];
  for (let i = flags.length - 1; i > 0; i--) {
    const j = Math.floor(rand01() * (i + 1));
    const tmp = flags[i]; flags[i] = flags[j]; flags[j] = tmp;
  }
  return flags;
}

/**
 * The 12-game regular-season schedule for one league/season seed.
 * @param {string} league
 * @param {number|string} seasonSeed
 * @param {string} [scheduleShape] - `'repeatTop'` | `'repeatBottom'` | `'repeatMiddle'`, defaults
 *   to `settings.SCHEDULE_SHAPE`
 * @returns {Array<{opponentIndex:number, home:boolean}>} `opponentIndex` indexes the 8 CPU teams
 *   from `makeLeague()` (0 = weakest .. 7 = strongest); a repeated index appears twice.
 */
export function makeSchedule(league, seasonSeed, scheduleShape = SCHEDULE_SHAPE) {
  const order = OPPONENT_ORDERS[scheduleShape] || OPPONENT_ORDERS[SCHEDULE_SHAPE] || OPPONENT_ORDERS.repeatTop;
  const rand01 = mulberry32(hashSeed('bb-schedule', league, seasonSeed));
  const homeFlags = shuffledHomeFlags(rand01);
  return order.map((opponentIndex, i) => ({ opponentIndex, home: homeFlags[i] }));
}

/**
 * The scripted CPU-only standings for a league of 8 teams plus the player (doc §4/§8, [Locked]):
 * "each CPU team beats every weaker CPU team, so the strongest always tops the table" - a full
 * round robin among the 8 (7 games each) resolved purely by strength, with no game actually
 * played. The player's OWN record (from real games, played by the caller) is folded in as a ninth
 * row and ranked by the same `wins` column; ties break on strength rank for two CPU teams (which
 * cannot actually tie under this rule) and, for the player, on career wins per doc §5's own
 * leaderboard tie-break.
 *
 * `standingsModel` (BB-2b commit 2, doc §4/§13 Open item 13): `'rawWins7'` is the original scripted
 * record - a 7-game round robin among the 8 CPUs, so a CPU team's win total tops out at 7 no matter
 * how long the PLAYER's own season is. `'scaledTo12'` scripts the same rank ordering onto a 12-game
 * scale instead (`round(12 * rank / (n-1))`), directly comparable to the player's own 12-game
 * record - see `settings.js`'s `STANDINGS_MODEL` for the full rationale and default.
 * @param {Array} teams - `makeLeague(league)`'s 8 teams, weakest to strongest (index 0..7)
 * @param {{wins:number, losses:number}} playerResults - the player's own regular-season record
 * @param {string} [standingsModel] - `'rawWins7'` | `'scaledTo12'`, defaults to `settings.STANDINGS_MODEL`
 * @returns {Array<{id:string, styleId?:string, wins:number, losses:number, isPlayer:boolean, strengthRank:number}>}
 *   sorted strongest/most-wins first (index 0 = the standings leader)
 */
export function scriptedStandings(teams, playerResults, standingsModel = STANDINGS_MODEL) {
  const n = teams.length;
  const rows = teams.map((team, rank) => {
    const scaled = standingsModel === 'scaledTo12';
    const wins = scaled ? Math.round((12 * rank) / (n - 1)) : rank;
    const losses = scaled ? 12 - wins : (n - 1) - rank;
    return {
      id: team.name,
      styleId: team.styleId,
      wins,
      losses,
      isPlayer: false,
      strengthRank: rank,
    };
  });
  rows.push({
    id: 'you',
    wins: playerResults.wins || 0,
    losses: playerResults.losses || 0,
    isPlayer: true,
    strengthRank: -1, // the player has no CPU strength rank; ties break after every CPU team
  });
  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.strengthRank - a.strengthRank;
  });
  return rows;
}

/**
 * doc §4, [Locked]: "Regular season, then semifinal, then championship. No quarterfinal." Top 4
 * seed 1-4 (seed 1 strongest/most wins). "The strongest team always wins its semifinal" resolves
 * any semifinal with NO player in it outright; a semifinal the player IS in is left `null` for the
 * caller to resolve by actually playing the game.
 *
 * `bracketModel` (BB-2b commit 2, doc §4/§13 Open item 13): `'asCoded'` is the original positional
 * bracket (seed 1 v seed 4, seed 2 v seed 3) - since a low-skill player is nearly always seed 4
 * under `'rawWins7'` standings, this pairs the player against the single STRONGEST of the four
 * qualifiers in the semifinal, and the championship opponent (always the league's overall
 * strongest team, decided by the caller, never by this function) is that same team again.
 * `'strongestInFinal'` is the bracket doc §8's own wording implies ("the championship opponent is
 * always the toughest team in the league") - the player's semifinal opponent is chosen to EXCLUDE
 * the strongest of the four qualifiers (by `strengthRank`, which is 1:1 with `makeLeague`'s own
 * slot order), so that team reaches the final by winning ITS OWN scripted semifinal instead of by
 * being fed to the player twice. See `settings.js`'s `BRACKET_MODEL` for the measured effect and
 * default. Player-absent seasons fall back to the positional pairing (this function is only ever
 * called by a caller that already knows the player qualified, but never assumes it here).
 * @param {Array} standings - `scriptedStandings()`'s sorted output
 * @param {string} [bracketModel] - `'asCoded'` | `'strongestInFinal'`, defaults to `settings.BRACKET_MODEL`
 * @returns {{seeds:Array, semifinals:Array<Array>, winners:Array}}
 */
export function playoffs(standings, bracketModel = BRACKET_MODEL) {
  const seeds = standings.slice(0, 4);
  const playerIdx = seeds.findIndex((s) => s.isPlayer);
  if (bracketModel === 'strongestInFinal' && playerIdx !== -1) {
    const cpuSeeds = seeds.filter((s) => !s.isPlayer);
    const strongest = cpuSeeds.reduce((a, b) => (b.strengthRank > a.strengthRank ? b : a));
    const others = cpuSeeds.filter((s) => s !== strongest);
    const semifinals = [[seeds[playerIdx], others[0]], [strongest, others[1]]];
    const winners = semifinals.map((pair) => (pair.some((t) => t.isPlayer) ? null : pair[0]));
    return { seeds, semifinals, winners };
  }
  const semifinals = [[seeds[0], seeds[3]], [seeds[1], seeds[2]]];
  const winners = semifinals.map((pair) => (pair.some((t) => t.isPlayer) ? null : pair[0]));
  return { seeds, semifinals, winners };
}

/**
 * doc §4, [Locked]: "Lose the semifinal = Bronze. Lose the championship = Silver. Win it = Gold."
 * Missing the playoffs entirely (doc: "Miss the playoffs = replay that league's season") is 0,
 * matching `baseball/CLAUDE.md`'s frozen trophy scale (0 none, 1 bronze, 2 silver, 3 gold).
 * @param {{reachedSemifinal:boolean, reachedChampionship:boolean, wonChampionship:boolean}} result
 * @returns {0|1|2|3}
 */
export function trophyFor(result) {
  if (result.wonChampionship) return 3;
  if (result.reachedChampionship) return 2;
  if (result.reachedSemifinal) return 1;
  return 0;
}

export default { makeSchedule, scriptedStandings, playoffs, trophyFor };
