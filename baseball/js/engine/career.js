// career.js : the career loop, pure and headless. R15-A (docs/BASEBALL-3D-BUILD.md section 9).
//
// No DOM, no storage, no network, no wall clock, no `Math.random`. Every function takes the career
// `state` and returns a NEW state object; nothing here ever mutates its argument (asserted in
// test-baseball-career.mjs). Randomness is seeded through `rng.js`'s `hashSeed`, so the same career
// plays the same games on every device with nothing persisted but the seeds below.
//
// The persistence half lives in `baseball/js/career-io.js` (the one file that touches
// `js/career-store.js` and `js/game-stats.js`); the screens are R15-B. This file is the rules.
//
// Design doc sections: 4 (the ladder, the season, playoffs, trophies), 6 (the player and the
// caps), 7 (earning points), 15 (persistence, the frozen counters and the history row), 16 (the
// leaderboard metric, derived from those counters at read time). Everything the doc marks
// [Locked] is a contract; the numbers it marks [Draft] live in `settings.js` and are snapshotted
// per season (see `startSeason`).
//
// -----------------------------------------------------------------------------------------------
// THE STATE, field by field. This is the `state` the career document wraps
// (`{ v, code, careerId, seq, baseSeq, updatedAt, device, rulesV, state }`, js/career-store.js).
// Frozen once shipped: extend it additively, never rename or repurpose a field (THE LAW rule 5).
//
//   v               state schema version (this file's own, separate from the document's `v`)
//   rulesV          settings.js's RULES_V when the career was created (audit only; the engine
//                   snapshot carries its own and validates it on resume)
//   careerId        the frozen `<CODE>-<startedAtMs>-<RAND>` id, minted by career-store's
//                   `mintCareerId` and passed in - this module never mints one (no randomness)
//   startedAt       epoch ms
//   player          { hand: 'L'|'R', presetId, skills: { the six SKILL_IDS } }
//   unspent         points earned and not yet spent, clamped to `capRoom` (doc section 7:
//                   "points past your caps are lost. No banking")
//   cap             this career's per-skill cap. RISES ONLY (doc section 15: "Caps only ever
//                   rise") - raised when a Gold advances the league, snapshotted into
//                   `season.cap` when a season starts
//   pointsEarned    lifetime GROSS points the results paid (before the cap clamp), audit only
//   pointsLost      lifetime points the cap clamp threw away, audit only - the doc's own Little
//                   League row ("Cap room 30, Yield 38, excess lost") is this number
//   league          the ladder rung being played now, one of LEAGUES
//   bestLeague      furthest rung ever reached, 1..5 (Math.max)
//   bestTrophyByLeague  { <leagueId>: 0..3 }, Math.max per league
//   seasonsPlayed   seasons RESOLVED (doc section 15's own definition of `seasons`)
//   wsTitles        Majors championships won
//   perfectSeasons  Majors seasons in which every regular AND playoff game was won
//   season          null, or the season in progress / just resolved:
//                     n           1-based season number within this career
//                     league      the rung this season is being played on (state.league at start)
//                     seed        the season seed (schedule, game seeds, playoff home)
//                     cap         CAPS snapshot taken at season start
//                     points      POINTS[league] snapshot taken at season start
//                     games       R16: how many regular-season games THIS season plays (absent on
//                                 a document written before R16, which means SEASON.gamesPerSeason)
//                     slots       R16: which makeLeague slots it is played against (absent means
//                                 all eight)
//                     playoffFormat R16: 'all' or 'top4' (absent means 'top4')
//                     schedule    [{ opponentIndex, home }] x the season's own `games`
//                     results     [{ idx, opponentIndex, home, won, you, cpu, forfeit }]
//                     phase       'regular' | 'semifinal' | 'championship' | 'done'
//                     playoff     null, or { seeds, semiOpponentIndex, finalOpponentIndex,
//                                            semiHome, finalHome, semi, final }
//                     trophy      null until the season resolves, then 0..3
//                     perfect     true when every game of a Majors season was won
//   game            null, or the game in progress:
//                     meta  { kind: 'regular'|'semifinal'|'championship', idx, opponentIndex,
//                             home, seed }
//                     snap  the engine's own `Game.snapshot()`, stored with NO translation layer
//                           (doc section 15, [Locked])
//   stats           the per-career counters, the same key list `js/game-stats.js`'s
//                   BB_ADDITIVE_KEYS carries for the lifetime store, plus `streak` (the live win
//                   streak) and the three `best*` fields. These feed `historyRow()`; the LIFETIME
//                   copies are written by `recordBaseball` one game at a time, never from here.
//
// -----------------------------------------------------------------------------------------------
// WHAT THE ENGINE'S EVENTS CANNOT COUNT TODAY (see `gameStatsFromEvents`): nothing in the R15-A
// counter list is fabricated, but three definitions are narrower than a real scorebook's and are
// stated here rather than left to be rediscovered:
//   - a runner PICKED OFF is not charged as `caughtStealing` (only a caught steal is), and the
//     player's own runner being picked off has no counter at all - none exists in the frozen list.
//   - `perfectGames` additionally requires the game not to have gone to extra innings, because
//     doc section 3's extra-inning ghost runner puts an opponent on second without reaching base.
//   - `rbi` is every run that scored on the player's own plate appearance. The engine models no
//     errors and no fielder's-choice RBI exception, so the two disagree nowhere today.

import { hashSeed } from './rng.js';
import {
  RULES_V, LEAGUES, SEASON, POINTS, CAPS, START_CAP, SKILL_IDS,
  BRACKET_MODEL, PLAYOFF_HOME, STANDINGS_MODEL, STANDINGS_TIEBREAK, SCHEDULE_SHAPE, parkFor,
  gamesForLeague, slotsForLeague, playoffFormatFor,
  SPEND_AFTER_SEASON, LIVE_PLAY,
} from './settings.js';
import { makeSchedule, scriptedStandings, playoffs, trophyFor } from './season.js';
import { leagueTeamsFor, makePlayerTeam } from './teams.js';
import { Game } from './game.js';

/** This module's own state schema version, bumped forward-only and never reinterpreted (the same
 *  rule game.js's SNAP_V follows). Carried on every state so a later migration can tell shapes
 *  apart without guessing. */
export const CAREER_STATE_V = 1;

export const PHASES = ['regular', 'semifinal', 'championship', 'done'];
export const GAME_KINDS = ['regular', 'semifinal', 'championship'];

/** The per-career counters, in one list so `newCareer`, `finishGame` and `validateState` cannot
 *  drift apart. Mirrors `js/game-stats.js`'s BB_ADDITIVE_KEYS minus the career-lifecycle keys
 *  (`careersStarted`/`careersFinished`/`seasons`/`wsTitles`/`perfectSeasons`, which live at the
 *  top level of the state or are paid at season resolution) and plus `played`/`won`/`lost`, which
 *  the lifetime store keeps in `total` instead. */
export const CAREER_COUNTER_KEYS = [
  'played', 'won', 'lost', 'forfeits',
  'hits', 'doubles', 'triples', 'homers', 'grandSlams', 'rbi', 'runsScored', 'walksDrawn',
  'atBats', 'sacFlies', 'sacBunts', 'stolenBases', 'caughtStealing',
  'runsAllowed', 'hitsAllowed', 'homersAllowed', 'walksIssued', 'inningsPitchedOuts', 'pickoffs',
  'strikeoutsBatting', 'strikeoutsPitched',
  'shutouts', 'noHitters', 'perfectGames', 'walkoffWins', 'extraInningGames',
  'bronzes', 'silvers', 'golds',
];

/** The three Math.max-only fields, kept apart from the additive list above (THE LAW rule 2). */
export const CAREER_BEST_KEYS = ['bestRunsGame', 'bestStrikeoutsPitchedGame', 'bestWinStreak'];

/** The per-game counters `gameStatsFromEvents` reports, in the order the file header lists them.
 *  Every one of these is also a BB_ADDITIVE_KEYS entry, so `recordBaseball` accepts the object
 *  straight through with no translation. */
export const GAME_STAT_KEYS = [
  'hits', 'doubles', 'triples', 'homers', 'grandSlams', 'rbi', 'walksDrawn', 'strikeoutsBatting',
  'atBats', 'runsScored', 'sacFlies', 'sacBunts', 'stolenBases', 'caughtStealing',
  'runsAllowed', 'hitsAllowed', 'walksIssued', 'homersAllowed', 'inningsPitchedOuts',
  'strikeoutsPitched', 'pickoffs', 'shutouts', 'walkoffWins', 'extraInningGames',
  'noHitters', 'perfectGames',
];

// --- small pure helpers -------------------------------------------------------------------------

function int(n) { return Number.isFinite(n) ? Math.trunc(n) : 0; }
function zeroCounters() {
  const out = {};
  for (const k of CAREER_COUNTER_KEYS) out[k] = 0;
  for (const k of CAREER_BEST_KEYS) out[k] = 0;
  out.streak = 0;
  return out;
}

/** The per-skill cap for a league: doc section 6's START_CAP at Little League, CAPS[league] above
 *  it. (CAPS.little is the same 10 today; the two are kept separate because the doc states them
 *  separately and a retune could move one without the other.) */
export function capForLeague(league) {
  if (league === 'little') return START_CAP;
  return CAPS[league] != null ? CAPS[league] : START_CAP;
}

/** 1..5, the ladder rung number the leaderboard metric (doc section 16) and the frozen history row
 *  both speak in. 0 for an unknown id. */
export function leagueRung(league) { return LEAGUES.indexOf(league) + 1; }

/** How many points this career could still absorb: the sum over the six skills of what is left
 *  under the CURRENT cap, minus what is already banked as `unspent`. Doc section 7, [Locked]:
 *  "Points past your caps are lost. No banking." */
export function capRoom(state) {
  const cap = int(state.cap);
  let room = 0;
  for (const id of SKILL_IDS) room += Math.max(0, cap - int(state.player.skills[id]));
  return Math.max(0, room - int(state.unspent));
}

// ---------------------------------------------------------------------------------------------
// R16 (docs/BASEBALL-3D-BUILD.md section 9): THE SEASON'S OWN SHAPE, read off the season, never off
// today's settings. `startSeason` snapshots `games`, `slots` and `playoffFormat` beside the `cap`
// and `points` it already snapshotted, for exactly the reason doc §15 [Locked] gives: "a season
// snapshots its schedule and point table from the settings block when it starts, so a tuning
// deploy applies from the next season and never rewrites one in progress."
//
// The fallbacks below are THE LAW, not tidiness. A season document written before R16 carries
// none of the three fields, and it was played as 12 games against all eight slots with a top-4
// cut - so that is what it must keep being, whatever `SEASON` says today. Reading `SEASON` for the
// fallback instead would silently reshape a season in progress: a 12-game Little League season
// would find itself 3 games long with its own results already past the end of it.
const LEGACY_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

/** How many regular-season games this season plays. */
export function seasonGames(state) {
  const n = state && state.season && state.season.games;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : SEASON.gamesPerSeason;
}
/** Which `makeLeague` slots this season is played against (0 weakest .. 7 champion). */
export function seasonSlots(state) {
  const s = state && state.season && state.season.slots;
  return Array.isArray(s) && s.length ? s.slice() : LEGACY_SLOTS.slice();
}
/** 'all' (everyone in) or 'top4'. */
export function seasonPlayoffFormat(state) {
  const f = state && state.season && state.season.playoffFormat;
  return f === 'all' ? 'all' : 'top4';
}
/** How many of the standings make the playoffs, under this season's own format. */
function playoffCutFor(state, standingsLength) {
  return seasonPlayoffFormat(state) === 'all' ? standingsLength : SEASON.playoffTeams;
}

/** doc section 4's own schedule seed, derived rather than stored twice. */
function defaultSeasonSeed(careerId, n) { return hashSeed('bb-career-season', careerId, n) >>> 0; }

/** The seed for one game of one season. Deterministic from the career, so a game replays the same
 *  way after a resume on a second device. */
export function gameSeed(state, kind, idx) {
  return hashSeed('bb-career-game', state.careerId, state.season ? state.season.n : 0, kind, idx) >>> 0;
}

/** PLAYOFF_HOME, resolved. Lifted verbatim from `sim-baseball.mjs`'s own `decidePlayoffHome` so
 *  the career and the simulator cannot disagree about who is at home in a playoff game. */
function decidePlayoffHome(mode, seasonSeed, kind, playerWins, oppWins) {
  if (mode === 'higherSeed') return playerWins >= oppWins;
  if (mode === 'alternate') {
    const base = (Number(seasonSeed) % 2) === 0;
    return kind === 'semifinal' ? base : !base;
  }
  return true; // 'player' - both playoff games forced player-home
}

// --- creating and starting ----------------------------------------------------------------------

/**
 * A brand-new career at Little League, season 0 (no season started yet).
 * @param {object} opts
 * @param {'L'|'R'} opts.hand
 * @param {string} opts.presetId - whatever build.js named the starting build (R14)
 * @param {object} opts.skills - the six SKILL_IDS, summing to 15 per side at the start build
 * @param {number} opts.now - epoch ms; this module never reads a clock
 * @param {string} opts.careerId - minted by `js/career-store.js`'s mintCareerId
 */
export function newCareer({ hand, presetId, skills, now, careerId }) {
  const built = {};
  for (const id of SKILL_IDS) built[id] = int(skills && skills[id]);
  return {
    v: CAREER_STATE_V,
    rulesV: RULES_V,
    careerId: String(careerId || ''),
    startedAt: int(now),
    player: { hand: hand === 'L' ? 'L' : 'R', presetId: String(presetId || 'custom'), skills: built },
    unspent: 0,
    cap: START_CAP,
    pointsEarned: 0,
    pointsLost: 0,
    league: LEAGUES[0],
    bestLeague: 1,
    bestTrophyByLeague: LEAGUES.reduce((o, lg) => { o[lg] = 0; return o; }, {}),
    seasonsPlayed: 0,
    wsTitles: 0,
    perfectSeasons: 0,
    season: null,
    game: null,
    stats: zeroCounters(),
  };
}

/**
 * Start the next season on the career's current league. Snapshots the schedule, the cap and the
 * point table (doc section 15, [Locked]: "A season snapshots its schedule and point table from the
 * settings block when it starts, so a tuning deploy applies from the next season and never rewrites
 * one in progress"). The league's eight teams are NEVER stored - `makeLeague(league)` rebuilds
 * them identically from the league id alone.
 * @param {object} state
 * @param {number} [seed] - the season seed; derived from the careerId and the season number when
 *   omitted, so a caller never has to invent one
 */
export function startSeason(state, seed) {
  const n = int(state.seasonsPlayed) + 1;
  const league = state.league;
  const seasonSeed = Number.isFinite(seed) ? (seed >>> 0) : defaultSeasonSeed(state.careerId, n);
  const cap = Math.max(int(state.cap), capForLeague(league));
  // R16: the three new snapshotted fields. `slots` is stored as the SLOT NUMBERS rather than the
  // teams themselves - `makeLeague(league)` still rebuilds the eight identically from the league
  // id alone, and a stored slot list is what keeps `opponentIndex` meaning the same team after a
  // deploy that changes which slots a league uses.
  const games = gamesForLeague(league);
  const slots = slotsForLeague(league);
  const playoffFormat = playoffFormatFor(league);
  return {
    ...state,
    cap,
    season: {
      n,
      league,
      seed: seasonSeed,
      cap,
      games,
      slots,
      playoffFormat,
      standingsModel: STANDINGS_MODEL,
      parks: true,
      wallHeight: true,   // playtest 1: home runs must clear the wall's height (outcomes.js)
      livePlays: !!LIVE_PLAY.on, // batch 4: balls in play played out in time (liveplay.js); off until 4b draws it
      runControl: !!(LIVE_PLAY.on && LIVE_PLAY.runControl), // batch 5: the player runs his own runners
      points: { ...POINTS[league] },
      schedule: makeSchedule(league, seasonSeed, games, slots.length, SCHEDULE_SHAPE),
      results: [],
      phase: 'regular',
      playoff: null,
      trophy: null,
      perfect: false,
    },
    game: null,
  };
}

// --- the game loop ------------------------------------------------------------------------------

/**
 * The meta of the game to play next, or null when the season is done (or has not started).
 * Read-only: it never touches `state`.
 * @returns {null | { kind, idx, opponentIndex, home, seed }}
 */
export function nextGame(state) {
  const s = state.season;
  if (!s || s.phase === 'done') return null;
  const games = seasonGames(state);
  if (s.phase === 'regular') {
    const idx = s.results.length;
    if (idx >= games) return null;   // resolveSeason has not run yet
    const slot = s.schedule[idx];
    return {
      kind: 'regular', idx, opponentIndex: slot.opponentIndex, home: !!slot.home,
      seed: gameSeed(state, 'regular', idx),
    };
  }
  if (s.phase === 'semifinal') {
    return {
      kind: 'semifinal', idx: games, opponentIndex: s.playoff.semiOpponentIndex,
      home: !!s.playoff.semiHome, seed: gameSeed(state, 'semifinal', games),
    };
  }
  return {
    kind: 'championship', idx: games + 1, opponentIndex: s.playoff.finalOpponentIndex,
    home: !!s.playoff.finalHome, seed: gameSeed(state, 'championship', games + 1),
  };
}

/** The player's own nine-of-one-player team (doc section 6, [Locked]), carrying the season's
 *  league so `game.js`'s `this.league` resolves whichever side the player is on. */
export function playerTeamFor(state) {
  const team = makePlayerTeam({ skills: state.player.skills, hand: state.player.hand });
  team.league = state.season ? state.season.league : state.league;
  return team;
}

/** The CPU teams of the season's league, weakest to strongest (`makeLeague`'s own order), filtered
 *  to the SEASON'S OWN slots - all eight above Little League, three of them at it. Rebuilt from the
 *  league id and the season's frozen slot list, never stored. */
export function leagueTeams(state) {
  const league = state.season ? state.season.league : state.league;
  // Batch 4: a live-play season's CPU rosters are built to the live model's own level table
  // (`LIVE_PLAY.cpuRosterLevel`); an out-zone season keeps `CPU_ROSTER_LEVEL`.
  const live = !!(state.season && state.season.livePlays);
  return leagueTeamsFor(league, state.season ? seasonSlots(state) : undefined,
    live ? { rosterLevel: LIVE_PLAY.cpuRosterLevel[league] } : undefined);
}

/**
 * Build the real engine `Game` for one game of this career. Pure: it constructs engine objects and
 * reads nothing outside `state`. `agents` is handed straight to the Game and is never serialized
 * (game.js's own contract), so a caller that only wants the opening snapshot may pass nulls.
 */
export function buildGame(state, meta, agents = { home: null, away: null }) {
  const teams = leagueTeams(state);
  const opponent = teams[meta.opponentIndex];
  const you = playerTeamFor(state);
  const home = meta.home ? you : opponent;
  const away = meta.home ? opponent : you;
  // Doc item 11 (Matt, 2026-09-23): Majors games are at the HOME team's park - the player's own is
  // Boston's. Only a season that snapshotted `parks` uses them, so a season in progress when this
  // shipped keeps the even field it started on.
  const s = state.season;
  const parkId = (s && s.parks) ? parkFor(s.league, !!meta.home, opponent && opponent.styleId) : 'default';
  // Playtest 1: the wall-height home run rule, snapshotted the same way (an older season keeps
  // the distance-only rule it started with).
  const wallHeight = !!(s && s.wallHeight);
  // Batch 4: the live play, snapshotted the same way - a season started without it keeps the
  // out-zone model to its last game.
  const livePlays = !!(s && s.livePlays);
  // Batch 5: the player running his own runners, snapshotted the same way (a season started before
  // it keeps automatic base running to its last game).
  const runControl = !!(s && s.runControl);
  return new Game({ home, away, seed: meta.seed >>> 0, agents, parkId, quickPlay: false, wallHeight, livePlays, runControl });
}

/** Which engine side ('home'|'away') the player is, for a given meta. */
export function playerSideFor(meta) { return meta.home ? 'home' : 'away'; }

/**
 * Open the next game: writes `state.game.meta` and a fresh engine snapshot, and hands back the
 * live `Game` so the caller does not build it twice.
 * @returns {{ state: object, game: Game, meta: object }}
 */
export function startGame(state, seed, agents) {
  const base = nextGame(state);
  if (!base) throw new Error('startGame: the season has no next game');
  const meta = Number.isFinite(seed) ? { ...base, seed: seed >>> 0 } : base;
  const game = buildGame(state, meta, agents || { home: null, away: null });
  return { state: { ...state, game: { meta, snap: game.snapshot() } }, game, meta };
}

/** Rebuild the in-progress game from the career's own snapshot (doc section 4, [Locked]: "You can
 *  leave to the hub or force close the app mid-game and resume exactly where you were"). Throws if
 *  the snapshot fails the engine's own `validateSnapshot`, never resumes a malformed one. */
export function resumeGame(state, agents) {
  if (!state.game || !state.game.snap) throw new Error('resumeGame: no game in progress');
  return Game.fromSnapshot(state.game.snap, agents);
}

/** Replace the stored engine snapshot. Called at every pitch boundary (doc section 4, [Locked]:
 *  "The engine checkpoints locally at every pitch boundary, so a resume restores the count"). */
export function checkpoint(state, snap) {
  if (!state.game) return state;
  return { ...state, game: { ...state.game, snap } };
}

// --- points ---------------------------------------------------------------------------------------

/**
 * Pay `n` points into `unspent`, clamped to `capRoom`. The excess is LOST, not banked (doc section
 * 7, [Locked]). `pointsEarned`/`pointsLost` keep the gross and the loss so a screen (and the test)
 * can say what the cap actually cost.
 */
export function earn(state, n) {
  const gross = Math.max(0, int(n));
  if (!gross) return state;
  const room = capRoom(state);
  const granted = Math.min(gross, room);
  return {
    ...state,
    unspent: int(state.unspent) + granted,
    pointsEarned: int(state.pointsEarned) + gross,
    pointsLost: int(state.pointsLost) + (gross - granted),
  };
}

/** Move one unspent point onto one skill, under the cap. A refused spend returns the state
 *  unchanged (the button reads disabled, R15-B) - it never throws and never half-applies. */
/** R19: true while a season is in progress in a league whose points are spent between seasons
 *  (settings.js `SPEND_AFTER_SEASON`). The points are not touched; they wait in `unspent`. */
export function spendLocked(state) {
  const s = state && state.season;
  return !!(s && s.phase !== 'done' && SPEND_AFTER_SEASON[s.league]);
}

export function spend(state, id) {
  if (SKILL_IDS.indexOf(id) < 0) return state;
  if (spendLocked(state)) return state;
  if (int(state.unspent) <= 0) return state;
  if (int(state.player.skills[id]) >= int(state.cap)) return state;
  return {
    ...state,
    unspent: int(state.unspent) - 1,
    player: { ...state.player, skills: { ...state.player.skills, [id]: int(state.player.skills[id]) + 1 } },
  };
}

// --- standings, playoffs, resolution ---------------------------------------------------------------

/** The player's own regular-season record so far. */
export function seasonRecord(state) {
  const results = (state.season && state.season.results) || [];
  const wins = results.filter((r) => r.won).length;
  return { wins, losses: results.length - wins };
}

/**
 * The nine-row table (doc section 4, [Locked]: "Top 4 of 9 make the playoffs"), the player folded
 * in by `scriptedStandings`.
 *
 * TIE-BREAKERS, documented because the doc leaves them open (section 17 item 13). R16 REVERSES
 * THEM: `scriptedStandings` still sorts on wins and then on `strengthRank` descending, but under
 * `STANDINGS_TIEBREAK` 'player' the player's own rank sits ABOVE every CPU team, so the player now
 * WINS every tie. (Before R16 it was -1 and they lost every one, which at 12 games put the top-4
 * cut at "more than 4 wins" rather than at 4.) Under `STANDINGS_MODEL` 'scaledToSeason' the eight
 * CPU teams' records are scripted onto THIS season's own length, so the cut is a share of the
 * season rather than a fixed number of wins: at College's 10 games the four CPU records above the
 * cut are 10, 9, 7 and 6, and the player makes the top 4 with 6 wins of 10.
 */
export function standingsFor(state) {
  const rec = seasonRecord(state);
  // The season's own snapshot (startSeason); a season started before 2026-09-23 has none and keeps
  // the fully scripted table it began with.
  const model = (state.season && state.season.standingsModel) || 'scaledToSeason';
  return scriptedStandings(leagueTeams(state), { ...rec, results: (state.season && state.season.results) || [] },
    seasonGames(state), model, STANDINGS_TIEBREAK, rec.wins + rec.losses);
}

/** Build the playoff branch when the regular season ends in a top-4 place. Pure. */
function buildPlayoff(state, standings) {
  const teams = leagueTeams(state);
  const format = seasonPlayoffFormat(state);
  const bracket = playoffs(standings, BRACKET_MODEL, format);
  const pair = bracket.semifinals.find((p) => p.some((t) => t.isPlayer));
  const oppRow = pair.find((t) => !t.isPlayer);
  const semiOpponentIndex = Math.max(0, teams.findIndex((t) => t.name === oppRow.id));
  // doc section 8, [Locked]: "the championship opponent is always the toughest team in the league."
  // R16: that rule is the TOP-4 bracket's, where the league's strongest team is fed to the final by
  // `BRACKET_MODEL` 'strongestInFinal'. In the everyone-in bracket the field IS the league and the
  // other semifinal is a real pairing, so the final opponent is whoever WON it (scripted by
  // strength in `playoffs`) - which at Little League can be the middle team when the champion is
  // the one the player already drew.
  let finalOpponentIndex = teams.length - 1;
  if (format === 'all') {
    const otherWinner = bracket.winners.find((w) => w && !w.isPlayer
      && !bracket.semifinals.find((p) => p.some((t) => t.isPlayer)).includes(w));
    if (otherWinner) {
      const idx = teams.findIndex((t) => t.name === otherWinner.id);
      if (idx >= 0) finalOpponentIndex = idx;
    }
  }
  const { wins } = seasonRecord(state);
  const winsOf = (i) => {
    const row = standings.find((r) => r.id === teams[i].name);
    return row ? row.wins : 0;
  };
  const seed = state.season.seed;
  return {
    seeds: standings.slice(0, playoffCutFor(state, standings.length)).map((r) => ({
      id: r.id, wins: r.wins, losses: r.losses, isPlayer: !!r.isPlayer, strengthRank: r.strengthRank,
    })),
    semiOpponentIndex,
    finalOpponentIndex,
    semiHome: decidePlayoffHome(PLAYOFF_HOME, seed, 'semifinal', wins, winsOf(semiOpponentIndex)),
    finalHome: decidePlayoffHome(PLAYOFF_HOME, seed, 'championship', wins, winsOf(finalOpponentIndex)),
    semi: null,
    final: null,
  };
}

/**
 * Close a season that has run out of games: works out the trophy, pays the bonus, folds the
 * league/trophy bests, advances the ladder on a Gold, and returns the extras the season adds to the
 * final game's `recordBaseball` call.
 *
 * Callers do not normally reach for this - `finishGame` calls it on the game that ends the season,
 * so exactly ONE recorder call carries the season (spec item 5). It is exported for the tests and
 * for a future screen that needs to replay the decision without a game.
 * @returns {{ state: object, extras: object }}
 */
export function resolveSeason(state) {
  const s = state.season;
  const reachedSemifinal = !!(s.playoff);
  const reachedChampionship = !!(s.playoff && s.playoff.semi && s.playoff.semi.won);
  const wonChampionship = !!(s.playoff && s.playoff.final && s.playoff.final.won);
  const trophy = trophyFor({ reachedSemifinal, reachedChampionship, wonChampionship });
  const { wins, losses } = seasonRecord(state);
  const perfect = s.league === 'majors' && losses === 0 && wonChampionship;

  const bonus = [0, s.points.bronze, s.points.silver, s.points.gold][trophy] | 0;
  let next = earn(state, bonus);

  const stats = { ...next.stats };
  if (trophy === 1) stats.bronzes += 1;
  else if (trophy === 2) stats.silvers += 1;
  else if (trophy === 3) stats.golds += 1;

  const bestTrophyByLeague = { ...next.bestTrophyByLeague };
  bestTrophyByLeague[s.league] = Math.max(int(bestTrophyByLeague[s.league]), trophy);

  let league = next.league;
  let cap = int(next.cap);
  let wsTitles = int(next.wsTitles);
  let perfectSeasons = int(next.perfectSeasons);
  if (trophy === 3) {
    if (s.league === 'majors') {
      // doc section 4, [Locked]: "Winning the World Series repeats the Majors season for more
      // titles." The league does not advance; the title is the reward.
      wsTitles += 1;
      if (perfect) perfectSeasons += 1;
    } else {
      // doc section 4, [Locked]: "Only Gold advances to the next league." The cap rises with it -
      // AFTER the trophy bonus was clamped above, so the doc's own Little League row (30 of room,
      // 38 earned, 8 lost) still holds on the season that earned the promotion.
      league = LEAGUES[Math.min(LEAGUES.length - 1, LEAGUES.indexOf(s.league) + 1)];
      cap = Math.max(cap, capForLeague(league));
    }
  }
  // doc section 4, [Locked]: anything short of Gold replays the league - `state.league` is left
  // exactly as it was and the next `startSeason` runs the same rung again.

  const extras = {
    seasons: 1,
    trophy,
    wsTitles: (trophy === 3 && s.league === 'majors') ? 1 : 0,
    perfectSeasons: perfect ? 1 : 0,
  };

  return {
    state: {
      ...next,
      league,
      cap,
      wsTitles,
      perfectSeasons,
      bestLeague: Math.max(int(next.bestLeague), leagueRung(league)),
      bestTrophyByLeague,
      seasonsPlayed: int(next.seasonsPlayed) + 1,
      stats,
      season: { ...s, phase: 'done', trophy, perfect },
      game: null,
    },
    extras,
  };
}

/**
 * Fold one finished game into the career.
 *
 * @param {object} state
 * @param {object} result
 * @param {boolean} result.won
 * @param {number} result.you - the player's team's runs
 * @param {number} result.cpu - the opponent's runs
 * @param {boolean} [result.forfeit] - doc section 4, [Locked]: "Forfeiting is a loss"
 * @param {object} [result.gameStats] - `gameStatsFromEvents()`'s output for this game
 * @param {object} [result.meta] - overrides `state.game.meta`; lets a headless test script a whole
 *   season without building engines
 * @returns {{ state, record: { league, won, extras }, resolved: boolean, trophy: 0|1|2|3|null }}
 *   `record` is the ONE `recordBaseball(league, won, extras)` call the caller must make for this
 *   game, exactly once (js/game-stats.js's own idempotency contract). The season's `seasons: 1`
 *   and `trophy` ride on the final game's call rather than a second one.
 */
export function finishGame(state, result) {
  const s = state.season;
  if (!s || s.phase === 'done') throw new Error('finishGame: no season in progress');
  const meta = result.meta || (state.game && state.game.meta) || nextGame(state);
  if (!meta) throw new Error('finishGame: no game in progress');

  const won = !!result.won;
  const forfeit = !!result.forfeit;
  const gs = result.gameStats || {};

  // 1. the counters, additively; the bests by Math.max only (THE LAW rule 2).
  const stats = { ...state.stats };
  for (const k of GAME_STAT_KEYS) stats[k] = int(stats[k]) + Math.max(0, int(gs[k]));
  stats.played = int(stats.played) + 1;
  if (won) stats.won = int(stats.won) + 1; else stats.lost = int(stats.lost) + 1;
  if (forfeit) stats.forfeits = int(stats.forfeits) + 1;
  stats.streak = won ? int(stats.streak) + 1 : 0;
  stats.bestWinStreak = Math.max(int(stats.bestWinStreak), stats.streak);
  stats.bestRunsGame = Math.max(int(stats.bestRunsGame), int(result.you));
  stats.bestStrikeoutsPitchedGame = Math.max(int(stats.bestStrikeoutsPitchedGame), int(gs.strikeoutsPitched));

  // 2. the season's own record of the game, and the points it pays.
  const season = { ...s, results: s.results.slice(), playoff: s.playoff ? { ...s.playoff } : null };
  let next = { ...state, stats, season, game: null };
  if (meta.kind === 'regular') {
    season.results.push({
      idx: meta.idx, opponentIndex: meta.opponentIndex, home: !!meta.home,
      won, you: int(result.you), cpu: int(result.cpu), forfeit,
    });
    // doc section 7, [Locked]: "Every Career win earns points... Losses pay a little in Little
    // League and High School, and nothing from College up" - read off the SEASON's own snapshot of
    // POINTS, never today's table.
    next = earn(next, won ? season.points.win : season.points.loss);
  } else {
    // doc section 7, [Locked]: "Playoff wins pay no per-win points. The trophy bonus is the entire
    // playoff reward."
    season.playoff[meta.kind === 'semifinal' ? 'semi' : 'final'] = {
      opponentIndex: meta.opponentIndex, home: !!meta.home,
      won, you: int(result.you), cpu: int(result.cpu), forfeit,
    };
  }

  // 3. where the season goes next.
  let resolved = false;
  if (meta.kind === 'regular' && season.results.length >= seasonGames(next)) {
    const standings = standingsFor(next);
    const rank = standings.findIndex((r) => r.isPlayer);
    if (rank >= 0 && rank < playoffCutFor(next, standings.length)) {
      season.phase = 'semifinal';
      season.playoff = buildPlayoff(next, standings);
      next = { ...next, season };
    } else {
      resolved = true;   // doc section 4: "Miss the playoffs = replay that league's season"
    }
  } else if (meta.kind === 'semifinal') {
    if (won) season.phase = 'championship';
    else resolved = true;   // Bronze
  } else if (meta.kind === 'championship') {
    resolved = true;        // Silver or Gold
  }

  const league = s.league;
  let extras = { ...pickGameExtras(gs), forfeits: forfeit ? 1 : 0, winStreak: stats.streak,
    runsThisGame: int(result.you), strikeoutsPitchedThisGame: int(gs.strikeoutsPitched) };
  let trophy = null;
  if (resolved) {
    const done = resolveSeason(next);
    next = done.state;
    extras = { ...extras, ...done.extras };
    trophy = done.extras.trophy;
  }
  return { state: next, record: { league, won, extras }, resolved, trophy };
}

/** The subset of a game's stats that rides on `recordBaseball`'s extras, normalized to integers so
 *  a malformed collector output can never write a float or a NaN into the lifetime store. */
function pickGameExtras(gs) {
  const out = {};
  for (const k of GAME_STAT_KEYS) {
    const v = Math.max(0, int(gs[k]));
    if (v) out[k] = v;
  }
  return out;
}

// --- the history row ------------------------------------------------------------------------------

/**
 * The FROZEN summary row (baseball/CLAUDE.md, "The history row, frozen"), written into
 * `bb.history[careerId]` and to `careers/<CODE>/baseball/history/<careerId>` by `retireCareer`.
 * Every numeric field is an integer; timestamps are epoch ms. This is a summary, not the career -
 * the full document is what Firebase keeps.
 */
export function historyRow(state, now) {
  return {
    v: 1,
    careerId: state.careerId,
    startedAt: int(state.startedAt),
    endedAt: int(now),
    hand: state.player.hand,
    finalLeague: leagueRung(state.league),
    bestLeague: int(state.bestLeague),
    bestTrophyByLeague: { ...state.bestTrophyByLeague },
    wsTitles: int(state.wsTitles),
    perfectSeasons: int(state.perfectSeasons),
    seasons: int(state.seasonsPlayed),
    played: int(state.stats.played),
    won: int(state.stats.won),
    lost: int(state.stats.lost),
    forfeits: int(state.stats.forfeits),
    rulesV: int(state.rulesV),
  };
}

// --- validation ------------------------------------------------------------------------------------

/**
 * Whole-state rejection, never default-fill - the same rule `game.js`'s `validateSnapshot` and
 * `js/career-store.js`'s `validateCareer` follow, for the same reason: a half-trusted career is
 * worse than none, because a best only ever improves (THE LAW rule 2) and a wrong value invented by
 * a default could never be corrected by playing.
 * @returns {string[]} error strings; empty means valid. Never throws, never mutates.
 */
export function validateState(state) {
  const errs = [];
  try {
    if (!state || typeof state !== 'object') return ['state is not an object'];
    if (state.v !== CAREER_STATE_V) errs.push(`v must be ${CAREER_STATE_V}`);
    if (typeof state.careerId !== 'string' || !state.careerId) errs.push('careerId must be a non-empty string');
    if (!Number.isInteger(state.startedAt) || state.startedAt < 0) errs.push('startedAt must be a non-negative integer');
    if (!state.player || typeof state.player !== 'object') errs.push('player missing');
    else {
      if (state.player.hand !== 'L' && state.player.hand !== 'R') errs.push('player.hand must be L or R');
      if (!state.player.skills || typeof state.player.skills !== 'object') errs.push('player.skills missing');
      else for (const id of SKILL_IDS) {
        const v = state.player.skills[id];
        if (!Number.isInteger(v) || v < 0) errs.push(`player.skills.${id} must be a non-negative integer`);
      }
    }
    if (!Number.isInteger(state.unspent) || state.unspent < 0) errs.push('unspent must be a non-negative integer');
    if (!Number.isInteger(state.cap) || state.cap < 1) errs.push('cap must be a positive integer');
    if (!Number.isInteger(state.rulesV) || state.rulesV < 1) errs.push('rulesV must be a positive integer');
    for (const k of ['pointsEarned', 'pointsLost']) {
      if (!Number.isInteger(state[k]) || state[k] < 0) errs.push(`${k} must be a non-negative integer`);
    }
    if (LEAGUES.indexOf(state.league) < 0) errs.push('league is not a known ladder id');
    for (const k of ['bestLeague', 'seasonsPlayed', 'wsTitles', 'perfectSeasons']) {
      if (!Number.isInteger(state[k]) || state[k] < 0) errs.push(`${k} must be a non-negative integer`);
    }
    if (!state.bestTrophyByLeague || typeof state.bestTrophyByLeague !== 'object') errs.push('bestTrophyByLeague missing');
    if (!state.stats || typeof state.stats !== 'object') errs.push('stats missing');
    else for (const k of CAREER_COUNTER_KEYS.concat(CAREER_BEST_KEYS, ['streak'])) {
      if (!Number.isInteger(state.stats[k]) || state.stats[k] < 0) errs.push(`stats.${k} must be a non-negative integer`);
    }
    if (state.season !== null) {
      const s = state.season;
      if (!s || typeof s !== 'object') errs.push('season must be null or an object');
      else {
        if (!Number.isInteger(s.n) || s.n < 1) errs.push('season.n must be a positive integer');
        if (LEAGUES.indexOf(s.league) < 0) errs.push('season.league is not a known ladder id');
        if (!Number.isInteger(s.cap) || s.cap < 1) errs.push('season.cap must be a positive integer');
        if (!s.points || typeof s.points !== 'object') errs.push('season.points missing');
        // R16: a season is as long as IT says it is - `seasonGames` falls back to the frozen
        // `SEASON.gamesPerSeason` for a document written before the per-league table existed, so a
        // 12-game season saved under the old shape still validates and still plays out.
        const games = seasonGames(state);
        if (s.games !== undefined && !(Number.isInteger(s.games) && s.games > 0)) {
          errs.push('season.games must be a positive integer when present');
        }
        if (s.slots !== undefined && !(Array.isArray(s.slots) && s.slots.length
          && s.slots.every((i) => Number.isInteger(i) && i >= 0))) {
          errs.push('season.slots must be an array of slot indexes when present');
        }
        if (s.playoffFormat !== undefined && s.playoffFormat !== 'all' && s.playoffFormat !== 'top4') {
          errs.push('season.playoffFormat must be all or top4 when present');
        }
        if (!Array.isArray(s.schedule) || s.schedule.length !== games) {
          errs.push(`season.schedule must be ${games} entries`);
        }
        if (!Array.isArray(s.results)) errs.push('season.results must be an array');
        else if (s.results.length > games) errs.push('season.results is longer than the schedule');
        if (PHASES.indexOf(s.phase) < 0) errs.push('season.phase is not a known phase');
        if (s.trophy !== null && !(Number.isInteger(s.trophy) && s.trophy >= 0 && s.trophy <= 3)) {
          errs.push('season.trophy must be null or 0..3');
        }
      }
    }
    if (state.game !== null) {
      if (!state.game || typeof state.game !== 'object') errs.push('game must be null or an object');
      else {
        const m = state.game.meta;
        if (!m || typeof m !== 'object') errs.push('game.meta missing');
        else {
          if (GAME_KINDS.indexOf(m.kind) < 0) errs.push('game.meta.kind is not a known kind');
          if (!Number.isInteger(m.opponentIndex) || m.opponentIndex < 0) errs.push('game.meta.opponentIndex must be a non-negative integer');
        }
        if (!state.game.snap || typeof state.game.snap !== 'object') errs.push('game.snap missing');
      }
    }
  } catch (err) {
    return [`validateState threw: ${String((err && err.message) || err)}`];
  }
  return errs;
}

// --- the per-game stats collector -------------------------------------------------------------------

const OUT_KINDS = new Set([
  'strikeout', 'groundout', 'flyout', 'lineout', 'popout', 'foulout', 'sacrifice', 'bunt-out',
]);

/**
 * Turn one game's engine event stream into the per-game counters `recordBaseball` takes.
 *
 * PURE: feed it the events and it returns an object; it reads no engine instance and holds no
 * state between calls. The caller collects `{ type, payload }` from the Game's own `onEvent` hook
 * (every event, in order) and passes the array here once the game is over.
 *
 * Which event carries what, so a later session does not have to re-derive it from game.js:
 *   atBatStart  -> `side`, which is the batting side for every steal/pickoff until the next one
 *   atBatEnd    -> `side`, `outcome` (the outcome kind, or 'walk'/'strikeout'), `bases`,
 *                  `runsScored`, `runnersOut`
 *   steal       -> `safe`
 *   pickoff     -> `out`
 *   halfInningStart -> `inning` (how extra innings are detected)
 *   gameEnd     -> `score`, `winner`, `reason`
 *
 * @param {Array<{type:string, payload:object}>} events
 * @param {object} opts
 * @param {'home'|'away'} opts.playerSide
 * @param {number} [opts.inningsPerGame] - defaults to SEASON.inningsPerGame
 * @returns {object} every GAME_STAT_KEYS entry, plus `you`/`cpu`/`won`/`complete` for the caller's
 *   own `finishGame` call.
 */
export function gameStatsFromEvents(events, opts) {
  const playerSide = opts && opts.playerSide === 'home' ? 'home' : 'away';
  const cpuSide = playerSide === 'home' ? 'away' : 'home';
  const innings = (opts && Number.isFinite(opts.inningsPerGame)) ? opts.inningsPerGame : SEASON.inningsPerGame;

  const out = {};
  for (const k of GAME_STAT_KEYS) out[k] = 0;
  let plateAppearances = 0;
  let maxInning = 1;
  let batting = null;
  let complete = false;
  let you = 0, cpu = 0, won = false;

  for (const ev of (events || [])) {
    const type = ev && ev.type;
    const p = (ev && ev.payload) || {};
    if (type === 'halfInningStart') {
      if (Number.isFinite(p.inning) && p.inning > maxInning) maxInning = p.inning;
    } else if (type === 'atBatStart') {
      batting = p.side === 'home' ? 'home' : 'away';
    } else if (type === 'steal') {
      if (batting === playerSide) { if (p.safe) out.stolenBases += 1; else out.caughtStealing += 1; }
    } else if (type === 'pickoff') {
      // A pickoff is thrown by the DEFENSE, so the player earns one while the CPU is batting.
      if (batting === cpuSide) {
        if (p.out) { out.pickoffs += 1; out.inningsPitchedOuts += 1; }
      }
    } else if (type === 'atBatEnd') {
      const side = p.side === 'home' ? 'home' : 'away';
      const kind = p.outcome;
      const bases = int(p.bases);
      const runs = Math.max(0, int(p.runsScored));
      const outsMade = (OUT_KINDS.has(kind) ? 1 : 0) + ((p.runnersOut && p.runnersOut.length) | 0);
      // The engine's sac fly is the ONLY out that scores a run (its `_resolveBattedBall` sac-fly
      // branch); a double play, a plain out and a foul out all score zero. So a 'flyout' that
      // scored is a sac fly, and nothing else can be one. `sacrifice` is the sac BUNT's own kind.
      const isSacFly = kind === 'flyout' && runs > 0;
      const isSacBunt = kind === 'sacrifice';
      const isHit = bases >= 1 && kind !== 'walk';
      if (side === playerSide) {
        plateAppearances += 1;
        out.rbi += runs;
        if (kind === 'walk') out.walksDrawn += 1;
        else if (kind === 'strikeout') out.strikeoutsBatting += 1;
        if (isSacFly) out.sacFlies += 1;
        if (isSacBunt) out.sacBunts += 1;
        if (isHit) {
          out.hits += 1;
          if (bases === 2) out.doubles += 1;
          else if (bases === 3) out.triples += 1;
          else if (bases === 4) {
            out.homers += 1;
            if (runs >= 4) out.grandSlams += 1;
          }
        }
      } else {
        if (kind === 'walk') out.walksIssued += 1;
        else if (kind === 'strikeout') out.strikeoutsPitched += 1;
        if (isHit) {
          out.hitsAllowed += 1;
          if (bases === 4) out.homersAllowed += 1;
        }
        out.inningsPitchedOuts += outsMade;
      }
    } else if (type === 'gameEnd') {
      complete = true;
      you = Math.max(0, int(p.score && p.score[playerSide]));
      cpu = Math.max(0, int(p.score && p.score[cpuSide]));
      won = p.winner === playerSide;
      if (p.reason === 'walkoff' && won) out.walkoffWins += 1;
    }
  }

  out.runsScored = you;
  out.runsAllowed = cpu;
  // doc section 15, [Locked] pinned definition: "atBats is plate appearances minus walksDrawn,
  // sacFlies and sacBunts."
  out.atBats = Math.max(0, plateAppearances - out.walksDrawn - out.sacFlies - out.sacBunts);
  if (maxInning > innings) out.extraInningGames = 1;
  if (complete) {
    if (cpu === 0) out.shutouts = 1;
    if (out.hitsAllowed === 0) out.noHitters = 1;
    // A perfect game needs nobody to have reached base at all. Extra innings are excluded because
    // doc section 3's ghost runner starts on second without reaching (file header).
    if (out.hitsAllowed === 0 && out.walksIssued === 0 && cpu === 0 && !out.extraInningGames) {
      out.perfectGames = 1;
    }
  }
  return { ...out, you, cpu, won, complete };
}

export default {
  CAREER_STATE_V, CAREER_COUNTER_KEYS, CAREER_BEST_KEYS, GAME_STAT_KEYS, PHASES, GAME_KINDS,
  capForLeague, leagueRung, capRoom, gameSeed,
  newCareer, startSeason, nextGame, startGame, checkpoint, finishGame, resolveSeason,
  earn, spend, validateState, historyRow, gameStatsFromEvents,
  buildGame, resumeGame, playerTeamFor, leagueTeams, playerSideFor, seasonRecord, standingsFor,
  seasonGames, seasonSlots, seasonPlayoffFormat,
};
