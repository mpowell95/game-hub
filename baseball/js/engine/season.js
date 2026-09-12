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

// doc §4, [Draft]: "12 regular season games per league across 8 opponents." Every opponent once,
// then the four strongest a second time (doc §8, [Locked]: "the schedule puts harder opponents
// later in the season... the championship opponent is always the toughest team in the league") -
// Draft [Open item 13], confirmed by Matt: this exact shape, not merely "12 games somehow".
const OPPONENT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7];

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
 * @returns {Array<{opponentIndex:number, home:boolean}>} `opponentIndex` indexes the 8 CPU teams
 *   from `makeLeague()` (0 = weakest .. 7 = strongest); a repeated index appears twice, always in
 *   the second half of the schedule.
 */
export function makeSchedule(league, seasonSeed) {
  const rand01 = mulberry32(hashSeed('bb-schedule', league, seasonSeed));
  const homeFlags = shuffledHomeFlags(rand01);
  return OPPONENT_ORDER.map((opponentIndex, i) => ({ opponentIndex, home: homeFlags[i] }));
}

/**
 * The scripted CPU-only standings for a league of 8 teams plus the player (doc §4/§8, [Locked]):
 * "each CPU team beats every weaker CPU team, so the strongest always tops the table" - a full
 * round robin among the 8 (7 games each) resolved purely by strength, with no game actually
 * played. The player's OWN record (from real games, played by the caller) is folded in as a ninth
 * row and ranked by the same `wins` column; ties break on strength rank for two CPU teams (which
 * cannot actually tie under this rule) and, for the player, on career wins per doc §5's own
 * leaderboard tie-break.
 * @param {Array} teams - `makeLeague(league)`'s 8 teams, weakest to strongest (index 0..7)
 * @param {{wins:number, losses:number}} playerResults - the player's own regular-season record
 * @returns {Array<{id:string, styleId?:string, wins:number, losses:number, isPlayer:boolean, strengthRank:number}>}
 *   sorted strongest/most-wins first (index 0 = the standings leader)
 */
export function scriptedStandings(teams, playerResults) {
  const n = teams.length;
  const rows = teams.map((team, rank) => ({
    id: team.name,
    styleId: team.styleId,
    // Rank 0 is the weakest of 8, so it beats nobody: wins = rank, losses = (n-1-rank).
    wins: rank,
    losses: (n - 1) - rank,
    isPlayer: false,
    strengthRank: rank,
  }));
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
 * seed 1-4 (seed 1 strongest/most wins); the bracket is 1v4 and 2v3. "The strongest team always
 * wins its semifinal" resolves any semifinal with NO player in it outright; a semifinal the
 * player IS in is left `null` for the caller to resolve by actually playing the game.
 * @param {Array} standings - `scriptedStandings()`'s sorted output
 * @returns {{seeds:Array, semifinals:Array<Array>, winners:Array}}
 */
export function playoffs(standings) {
  const seeds = standings.slice(0, 4);
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
