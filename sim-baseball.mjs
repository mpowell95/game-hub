#!/usr/bin/env node
// sim-baseball.mjs : does baseball's engine actually deliver the five promises
// `docs/BASEBALL-DESIGN-DOC.md` makes? Plays real games and real seasons through the real `Game`,
// the real agents, `makeLeague`, `makeSchedule` and `scriptedStandings` - nothing here invents a
// number `sim-baseball.mjs` did not measure. Modeled on `tune-boggle-es.mjs`'s shape: a CLI tool
// that shakes a system through its real code thousands of times and reports what a player would
// actually find, run before a Draft constant is confirmed rather than after.
//
//   node sim-baseball.mjs                          # full sweep, every league, every tier
//   node sim-baseball.mjs --league majors           # one league only
//   node sim-baseball.mjs --tier weak               # one tier only
//   node sim-baseball.mjs --quick                   # a tenth of --games and --seasons
//   node sim-baseball.mjs --games 200 --seasons 100 # override the per-cell sample sizes
//   node sim-baseball.mjs --set outZoneMult=0.9,1.0,1.1   # sweep a settings override
//   node sim-baseball.mjs --json out.json           # write the full report under .sim-out/
//   node sim-baseball.mjs --assert                  # exit non-zero on any FAIL (the phase gate)
//   node sim-baseball.mjs --assert --quick           # the fast phase-gate form
//
// It NEVER edits settings.js. Step 6 of the BB-2 handoff reads this tool's report and hand-writes
// the retuned constants, each with its old and new value stated in the commit - the same discipline
// `tune-boggle-es.mjs` follows for DICE_ES and `tune-ladder.mjs` follows for Skeeball's power bands.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as SETTINGS from './baseball/js/engine/settings.js';
import { Game } from './baseball/js/engine/game.js';
import { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher } from './baseball/js/engine/agents.js';
import { makeLeague, makePlayerTeam, effectiveCapFor, teamStrength, POSITIONS } from './baseball/js/engine/teams.js';
import { makeSchedule, scriptedStandings, playoffs, trophyFor } from './baseball/js/engine/season.js';
import { hashSeed, mulberry32 } from './baseball/js/engine/rng.js';
import { flyPitch } from './baseball/js/engine/pitch.js';
import { swing } from './baseball/js/engine/swing.js';
import { resolveContact } from './baseball/js/engine/outcomes.js';
import { zonesFor } from './baseball/js/engine/zones.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// CLI, `tune-boggle-es.mjs`'s own `arg()` shape.
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const FLAG_QUICK = process.argv.includes('--quick');
const FLAG_ASSERT = process.argv.includes('--assert');
const FLAG_CONTACT_GRID = process.argv.includes('--contact-grid');
const FLAG_STYLES = process.argv.includes('--styles');
const FLAG_STYLES_TUNE = process.argv.includes('--tune');
const ARG_LEAGUE = arg('league', null);
const ARG_TIER = arg('tier', null);
const ARG_JSON = arg('json', null);
const ARG_SET = arg('set', null); // "outZoneMult=0.9,1.0,1.1"

const GAMES_PER_MATCHUP = Number(arg('games', 400));
const SEASONS_PER_CELL = Number(arg('seasons', 300));
const GAMES_N = Math.max(4, Math.round((FLAG_QUICK ? GAMES_PER_MATCHUP / 10 : GAMES_PER_MATCHUP)));
const SEASONS_N = Math.max(3, Math.round((FLAG_QUICK ? SEASONS_PER_CELL / 10 : SEASONS_PER_CELL)));

const LEAGUES = ARG_LEAGUE ? [ARG_LEAGUE] : SETTINGS.LEAGUES;
const TIERS = ARG_TIER ? [ARG_TIER] : ['weak', 'median', 'strong'];

// ---------------------------------------------------------------------------------------------
// The simulator's OWN assumptions, printed at the top of every report (per the handoff: "Matt can
// move them with --tier-sigma" is this file's `--tier-sigma` override below).
const MODEL_TIERS = {
  weak:   { timingSigmaMs: 85, placementSigma: 0.35, variety: 0.3 },
  median: { timingSigmaMs: 55, placementSigma: 0.22, variety: 0.6 },
  strong: { timingSigmaMs: 35, placementSigma: 0.12, variety: 0.85 },
};
const tierSigmaArg = arg('tier-sigma', null);
if (tierSigmaArg) {
  // "--tier-sigma weak=90,median=60,strong=30"
  for (const part of tierSigmaArg.split(',')) {
    const [tier, val] = part.split('=');
    if (MODEL_TIERS[tier]) MODEL_TIERS[tier].timingSigmaMs = Number(val);
  }
}

// ---------------------------------------------------------------------------------------------
// The promise scoreboard's thresholds - Draft, for Matt to confirm from the report (step 6).
const GOLD_SEASONS_MAX_MEDIAN = 2.0;
const GOLD_ONE_SEASON_MIN_MEDIAN = 0.35;
const CHAMPION_GAME_WIN_MIN_MEDIAN = 0.40;
const CAP_BINDS_ONLY = ['little', 'highschool'];
const CAP_SEASONS_MAX_UPPER = 2.0;
const NUDGE_MAX_WINRATE_GAP = 0.08;
// BB-2a step 4: the season A/B (doc §8's "well-timed low-Power beats sloppy high-Power") now needs
// a MARGIN, not just a sign - a promise that barely holds is not a promise the retune should stop
// at. Every league must clear this gap, not merely have `nudgeWins === true`.
const NUDGE_AB_MIN_WINRATE_GAP = 0.10;
// BB-2a step 6: the within-league ladder check needs its own larger sample and a real numeric
// tolerance, not the ad hoc "+0.15" phase 2 shipped with - "the phase 2 noise was sampling at 400."
const LADDER_TOLERANCE = 0.02;
const LADDER_GAMES = 1000;
const LADDER_GAMES_N = Math.max(4, Math.round(FLAG_QUICK ? LADDER_GAMES / 10 : LADDER_GAMES));

// ---------------------------------------------------------------------------------------------
// BB-2a step 4: `--contact-grid` - an ISOLATED plate-appearance harness (real Game components -
// a real college CpuPitcher, `swing.js`/`outcomes.js`/`zones.js` exactly as `game.js` calls them -
// but no full 3-inning game around it) measuring expected bases PER SWING over a timing-sigma x
// hitPow grid. This is the direct test of the mechanism BB-2a steps 2-3 changed: does a
// well-timed, low-Power swing actually out-produce a sloppy, high-Power one, with a stated margin,
// rather than merely "does the season A/B happen to come out the right way once."
const CONTACT_GRID_SWINGS = Number(arg('contact-grid-swings', 20000));
const CONTACT_GRID_SIGMAS = [35, 55, 85];   // ms - matches MODEL_TIERS' strong/median/weak timing
const CONTACT_GRID_HITPOWS = [2, 6, 10];    // hitPow skill points
const CONTACT_GRID_LEAGUE = 'college';      // "real college CpuPitcher", per the handoff
const CONTACT_GRID_PLACEMENT_SIGMA = 0.22;  // fixed - matches MODEL_TIERS.median's placement
const CONTACT_GRID_HIT_ACC = 5;             // fixed hitAcc, per the handoff
const TIMING_OVER_POWER = 2.0;   // the timing gap at hitPow=2 must be >= this x the power gap at sigma=85
const CONTACT_AB_MARGIN = 0.05;  // E(sigma=35,hitPow=2) must beat E(sigma=85,hitPow=10) by at least this many bases/swing

// ---------------------------------------------------------------------------------------------
// BB-2a step 5: `--styles` - flavor apart from strength. Every TEAM_STYLES vector should be
// roughly as STRONG as `balanced` (the doc names the 8 styles but gives no numbers at all, and
// phase 2 found the within-league ordering noisy team to team - a sluggers-style CPU reliably the
// hardest opponent regardless of its schedule slot). This measures each style's CPU-vs-CPU win
// rate against a `balanced` team at the same league/level, real Game, real CpuPitcher/CpuBatter on
// both sides - style is the only thing that differs between the two rosters.
const STYLE_STRENGTH_BAND = 0.04;      // a style's win rate vs balanced must land within 0.5 +/- this
const STYLE_MEASURE_LEAGUE = arg('styles-league', 'college');
const STYLE_MEASURE_GAMES = Number(arg('styles-games', 3000));
// The tuner's only knob: compress (s<1) or expand (s>1) a style's weight vector toward/away from
// the flat (all-1s) vector, preserving its RELATIVE shape (which skills it favors) while changing
// how far it deviates from `balanced` - a spiky vector loses more to allocateSkills' integer clamp
// at the cap than a flat one, which is exactly the mechanism that made high-variance styles
// (Sluggers, Aces) measure stronger or weaker than their "same mean weight" would suggest.
const STYLE_COMPRESS_CANDIDATES = [1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0];

function compressStyle(style, s) {
  const out = {};
  for (const id of SETTINGS.SKILL_IDS) out[id] = 1 + ((style[id] != null ? style[id] : 1) - 1) * s;
  return out;
}

/** Build one CPU-vs-CPU measurement team directly from a candidate style VECTOR, bypassing
 *  teams.js's own `TEAM_STYLES` lookup (which reads settings.js by import, not by parameter) so a
 *  candidate vector can be measured without editing settings.js first - same allocation math as
 *  `teams.js`'s own (private) `allocateSkills`/`buildRoster`, duplicated here deliberately rather
 *  than exported, since this is a MEASUREMENT tool's own candidate, never a real generated team. */
function buildCandidateTeam(league, name, styleVector, seed) {
  const rand01 = mulberry32(seed >>> 0);
  const effectiveCap = effectiveCapFor(league);
  const capInt = Math.floor(effectiveCap);
  const meanWeight = SETTINGS.SKILL_IDS.reduce((s, id) => s + (styleVector[id] != null ? styleVector[id] : 1), 0) / SETTINGS.SKILL_IDS.length;
  const players = [];
  for (let i = 0; i < 9; i++) {
    const skills = {};
    for (const id of SETTINGS.SKILL_IDS) {
      const w = (styleVector[id] != null ? styleVector[id] : 1) / meanWeight;
      const raw = effectiveCap * 0.5 * w * (0.7 + rand01() * 0.6);
      skills[id] = Math.max(0, Math.min(capInt, Math.round(raw)));
    }
    const bats = rand01() < SETTINGS.LEFTY_RATE ? 'L' : 'R';
    players.push({ id: `p${i}`, jersey: 1 + Math.floor(rand01() * 99), pos: POSITIONS[i] || POSITIONS[POSITIONS.length - 1], bats, throws: bats, skills });
  }
  return { name, league, styleId: name, players, battingOrder: players.map((p) => p.id), pitcherId: players[0].id };
}

/** CPU-vs-CPU: `styleVector` against `settings.TEAM_STYLES.balanced`, alternating home/away,
 *  both sides played by the league's own real CpuPitcher/CpuBatter. Returns the style's win rate. */
async function measureStyleWinRate(styleId, styleVector, league, settings, games) {
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const home = i % 2 === 0;
    const teamStyle = buildCandidateTeam(league, styleId, styleVector, hashSeed('bb-style-team', league, styleId, i));
    const teamBalanced = buildCandidateTeam(league, 'balanced-ref', settings.TEAM_STYLES.balanced, hashSeed('bb-style-balanced', league, styleId, i));
    const agentStyle = mkCpuAgent(teamStyle, league, settings);
    const agentBalanced = mkCpuAgent(teamBalanced, league, settings);
    const seed = hashSeed('bb-style-game', league, styleId, i) >>> 0;
    const g = new Game({
      home: home ? teamStyle : teamBalanced,
      away: home ? teamBalanced : teamStyle,
      seed,
      agents: { home: home ? agentStyle : agentBalanced, away: home ? agentBalanced : agentStyle },
      settings,
    });
    await g.playGame();
    const won = home ? g.winner === 'home' : g.winner === 'away';
    if (won) wins += 1;
  }
  return wins / games;
}

/** For one style, try every STYLE_COMPRESS_CANDIDATES factor (largest first) and keep the LARGEST
 *  s (the most flavor preserved) whose measured win rate lands inside STYLE_STRENGTH_BAND; only if
 *  none does, fall back to whichever measured closest to 0.5. A simple, deterministic search - no
 *  gradient, no randomness beyond the seeded games themselves - appropriate for a small, discrete
 *  candidate set measured once each. Compressing all the way to s=0 (identical to `balanced`)
 *  is a valid answer for a style whose doc-intended flavor is a BEHAVIOR, not a skill weighting
 *  (Patient/Shifters, per settings.js's `styleBehavior` - BB-2a step 5), but is a last resort for
 *  every other style, which should keep as much of its named emphasis as the band allows. */
async function tuneStyle(styleId, league, settings, games) {
  const base = settings.TEAM_STYLES[styleId];
  const candidates = STYLE_COMPRESS_CANDIDATES.slice().sort((a, b) => b - a); // largest s first
  let bestInBand = null;
  let bestOverall = null;
  for (const s of candidates) {
    const vector = compressStyle(base, s);
    const winRate = await measureStyleWinRate(styleId, vector, league, settings, games);
    const dist = Math.abs(winRate - 0.5);
    if (!bestOverall || dist < bestOverall.dist) bestOverall = { s, vector, winRate, dist };
    if (dist <= STYLE_STRENGTH_BAND && !bestInBand) bestInBand = { s, vector, winRate, dist };
  }
  return bestInBand || bestOverall;
}

// ---------------------------------------------------------------------------------------------
// Settings override sweep ("--set outZoneMult=0.9,1.0,1.1"), the same trick `--faces` plays in
// `tune-boggle-es.mjs`: measure a candidate value without editing settings.js. Applies to every
// league's FIELD.outZoneMult (the only override this tool wires up; extend here if another knob
// needs sweeping).
function settingsFor(overrideValue) {
  if (overrideValue == null) return SETTINGS;
  const FIELD = {};
  for (const lg of SETTINGS.LEAGUES) FIELD[lg] = { ...SETTINGS.FIELD[lg], outZoneMult: overrideValue };
  return { ...SETTINGS, FIELD };
}
let SET_KEY = null, SET_VALUES = [null];
if (ARG_SET) {
  const [key, vals] = ARG_SET.split('=');
  SET_KEY = key;
  SET_VALUES = vals.split(',').map(Number);
}

// ---------------------------------------------------------------------------------------------
// Agent wiring - CPU exactly as the shipped game builds it; the player is `ModelBatter`/
// `ModelPitcher` at one of the three tiers above, standing in for a human at that skill level.
function mkCpuAgent(team, league, settings) {
  return {
    decidePitch: (v) => new CpuPitcher({ league, settings }).decidePitch(v),
    decideSwing: (v) => {
      const batter = team.players.find((p) => p.id === v.batterId) || team.players[0];
      return new CpuBatter({ league, skills: batter.skills, settings, styleId: team.styleId }).decideSwing(v);
    },
  };
}
function mkModelAgent(league, settings, tier) {
  const cpu = settings.CPU[league] || settings.CPU.college;
  const batter = new ModelBatter({ timingSigmaMs: tier.timingSigmaMs, placementSigma: tier.placementSigma, swingIn: cpu.swingIn, chase: cpu.chase });
  const pitcher = new ModelPitcher({ league, settings, variety: tier.variety, cornerBias: cpu.cornerBias, pitchMix: cpu.pitchMix });
  return { decidePitch: (v) => pitcher.decidePitch(v), decideSwing: (v) => batter.decideSwing(v) };
}

/** The player's own skills for measurement: `PRESETS.twoWayStar` scaled to `effectiveCapFor`
 *  (doc's own expected level for that league), per the handoff. */
function playerSkillsFor(league, settings) {
  const preset = settings.PRESETS.twoWayStar;
  const cap = effectiveCapFor(league);
  const scale = cap / settings.START_CAP;
  const capInt = Math.floor(cap);
  const skills = {};
  for (const id of settings.SKILL_IDS) skills[id] = Math.max(0, Math.min(capInt, Math.round(preset[id] * scale)));
  return skills;
}

/** Play ONE game, player vs one CPU opponent, and return the per-game measurements the report
 *  aggregates. `playerHome` decides which side the player bats/pitches from. */
async function playOneGame(league, settings, opponent, playerAgent, playerTeam, seed, playerHome) {
  const home = playerHome ? playerTeam : opponent;
  const away = playerHome ? opponent : playerTeam;
  const homeAgent = playerHome ? playerAgent : mkCpuAgent(opponent, league, settings);
  const awayAgent = playerHome ? mkCpuAgent(opponent, league, settings) : playerAgent;
  const g = new Game({ home, away, seed, agents: { home: homeAgent, away: awayAgent }, settings });

  let pitches = 0, atBats = 0;
  let playerHits = 0, playerDoubles = 0, playerTriples = 0, playerHomers = 0, playerSO = 0, playerBB = 0;
  const playerSide = playerHome ? 'home' : 'away';
  g.onEvent = async (type, payload) => {
    if (type === 'pitch') pitches += 1;
    if (type === 'atBatEnd' && payload.side === playerSide) {
      atBats += 1;
      if (payload.outcome === 'strikeout') playerSO += 1;
      else if (payload.outcome === 'walk') playerBB += 1;
      else if (payload.bases === 1) playerHits += 1;
      else if (payload.bases === 2) { playerHits += 1; playerDoubles += 1; }
      else if (payload.bases === 3) { playerHits += 1; playerTriples += 1; }
      else if (payload.bases === 4) { playerHits += 1; playerHomers += 1; }
    }
  };
  await g.playGame();

  const playerRuns = playerHome ? g.score.home : g.score.away;
  const oppRuns = playerHome ? g.score.away : g.score.home;
  const won = g.winner === playerSide;
  return { won, playerRuns, oppRuns, pitches, atBats, playerHits, playerDoubles, playerTriples, playerHomers, playerSO, playerBB };
}

/** Play a whole matchup sweep for one (league, team, tier), alternating home/away. `gamesN`
 *  defaults to the sweep's own GAMES_N but can be overridden (BB-2a step 6: the within-league
 *  LADDER_MONOTONE check needs its own larger LADDER_GAMES sample - "the phase 2 noise was
 *  sampling at 400" - independent of whatever `--games`/`--quick` the rest of the report uses). */
async function sweepMatchup(league, settings, opponent, tier, seedBase, gamesN = GAMES_N) {
  const cpu = settings.CPU[league] || settings.CPU.college;
  const skills = playerSkillsFor(league, settings);
  const results = [];
  for (let i = 0; i < gamesN; i++) {
    const seed = hashSeed('bb-sim', league, opponent.styleId, tier, seedBase, i);
    const playerAgent = mkModelAgent(league, settings, MODEL_TIERS[tier]);
    const playerTeam = makePlayerTeam({ skills, hand: 'R' });
    results.push(await playOneGame(league, settings, opponent, playerAgent, playerTeam, seed >>> 0, i % 2 === 0));
  }
  void cpu;
  return results;
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }

/** BB-2a step 6: the within-league LADDER_MONOTONE check's own dedicated measurement, at
 *  LADDER_GAMES_N per opponent (median tier only) rather than reusing whatever --games/--quick the
 *  rest of the report used - "the phase 2 noise was sampling at 400," per the handoff. Returns win
 *  rates in SLOT order (weakest..strongest), matching makeLeague's own order. */
async function measureLadderWinRates(league, settings) {
  const teams = makeLeague(league);
  const rates = [];
  for (const team of teams) {
    const rows = await sweepMatchup(league, settings, team, 'median', 'ladder', LADDER_GAMES_N);
    rates.push(rows.filter((r) => r.won).length / rows.length);
  }
  return rates;
}

// ---------------------------------------------------------------------------------------------
// Per-league/team/tier per-game measurement.
async function measureLeagueGames(league, settings) {
  const teams = makeLeague(league);
  const perTeam = [];
  for (const team of teams) {
    const perTier = {};
    for (const tier of TIERS) {
      const rows = await sweepMatchup(league, settings, team, tier, 'games');
      const wins = rows.filter((r) => r.won).length;
      perTier[tier] = {
        winRate: wins / rows.length,
        runsFor: mean(rows.map((r) => r.playerRuns)),
        runsAgainst: mean(rows.map((r) => r.oppRuns)),
        hits: mean(rows.map((r) => r.playerHits)),
        doubles: mean(rows.map((r) => r.playerDoubles)),
        triples: mean(rows.map((r) => r.playerTriples)),
        homers: mean(rows.map((r) => r.playerHomers)),
        strikeouts: mean(rows.map((r) => r.playerSO)),
        walks: mean(rows.map((r) => r.playerBB)),
        pitches: mean(rows.map((r) => r.pitches)),
        atBats: mean(rows.map((r) => r.atBats)),
        // FEEL.ui pacing: betweenMs + windupMs per pitch, resultMs per at-bat, roughly.
        estMinutes: (mean(rows.map((r) => r.pitches)) * (settings.FEEL.ui.betweenMs + settings.FEEL.ui.windupMs)
          + mean(rows.map((r) => r.atBats)) * settings.FEEL.ui.resultMs) / 60000,
      };
    }
    perTeam.push({ styleId: team.styleId, strengthIndex: teams.indexOf(team), perTier });
  }
  return perTeam;
}

// ---------------------------------------------------------------------------------------------
// Season-level measurement: play whole 12-game regular seasons, resolve the CPU-scripted bracket,
// and play the player's own semifinal/championship when they reach it.
async function playSeason(league, settings, tier, seasonSeed) {
  const teams = makeLeague(league);
  const schedule = makeSchedule(league, seasonSeed);
  const skills = playerSkillsFor(league, settings);
  const playerAgent = mkModelAgent(league, settings, MODEL_TIERS[tier]);
  const playerTeam = makePlayerTeam({ skills, hand: 'R' });

  let wins = 0, losses = 0;
  for (let i = 0; i < schedule.length; i++) {
    const g = schedule[i];
    const opponent = teams[g.opponentIndex];
    const seed = hashSeed('bb-season', league, tier, seasonSeed, i);
    const res = await playOneGame(league, settings, opponent, playerAgent, playerTeam, seed >>> 0, g.home);
    if (res.won) wins += 1; else losses += 1;
  }

  const standings = scriptedStandings(teams, { wins, losses });
  const playerRank = standings.findIndex((r) => r.isPlayer);
  const madePlayoffs = playerRank < 4;
  let reachedSemifinal = false, reachedChampionship = false, wonChampionship = false;
  if (madePlayoffs) {
    const bracket = playoffs(standings);
    const sfIndex = bracket.semifinals.findIndex((pair) => pair.some((t) => t.isPlayer));
    reachedSemifinal = true;
    const sfOpponentRow = bracket.semifinals[sfIndex].find((t) => !t.isPlayer);
    const sfOpponentTeam = teams.find((t) => t.name === sfOpponentRow.id) || teams[teams.length - 1];
    const sfSeed = hashSeed('bb-playoff-sf', league, tier, seasonSeed);
    const sfRes = await playOneGame(league, settings, sfOpponentTeam, playerAgent, playerTeam, sfSeed >>> 0, true);
    if (sfRes.won) {
      reachedChampionship = true;
      // doc §8, [Locked]: "the championship opponent is always the toughest team in the league."
      const champOpponent = teams[teams.length - 1];
      const chSeed = hashSeed('bb-playoff-champ', league, tier, seasonSeed);
      const chRes = await playOneGame(league, settings, champOpponent, playerAgent, playerTeam, chSeed >>> 0, true);
      wonChampionship = chRes.won;
    }
  }
  const trophy = trophyFor({ reachedSemifinal, reachedChampionship, wonChampionship });
  const points = wins * settings.POINTS[league].win + losses * settings.POINTS[league].loss
    + [0, settings.POINTS[league].bronze, settings.POINTS[league].silver, settings.POINTS[league].gold][trophy];
  return { wins, losses, madePlayoffs, trophy, points, reachedChampionship };
}

async function measureLeagueSeasons(league, settings) {
  const perTier = {};
  for (const tier of TIERS) {
    const seasons = [];
    for (let i = 0; i < SEASONS_N; i++) seasons.push(await playSeason(league, settings, tier, i));
    const goldRate = seasons.filter((s) => s.trophy === 3).length / seasons.length;
    const top4Rate = seasons.filter((s) => s.madePlayoffs).length / seasons.length;
    const champGames = seasons.filter((s) => s.reachedChampionship);
    const champWinRate = champGames.length ? champGames.filter((s) => s.trophy === 3).length / champGames.length : null;
    const avgPoints = mean(seasons.map((s) => s.points));
    const capRoom = Math.max(0, settings.CAPS[league] * settings.SKILL_IDS.length
      - settings.START_POINTS_PER_SIDE * 2);
    perTier[tier] = {
      goldRate,
      expectedSeasonsToGold: goldRate > 0 ? 1 / goldRate : Infinity,
      top4Rate,
      champWinRate,
      avgPointsPerSeason: avgPoints,
      seasonsToCap: avgPoints > 0 ? capRoom / avgPoints : Infinity,
    };
  }
  return perTier;
}

// ---------------------------------------------------------------------------------------------
// Experiment A: "a well-timed low-Power swing beats a sloppy high-Power swing" (doc §8, [Locked]).
// Slugger scaled with the WEAK tier's timing, against Table Setter with the STRONG tier's timing.
async function experimentNudgeAB(league, settings) {
  const cap = effectiveCapFor(league);
  const scale = cap / settings.START_CAP;
  const scalePreset = (preset) => {
    const skills = {};
    for (const id of settings.SKILL_IDS) skills[id] = Math.max(0, Math.min(Math.floor(cap), Math.round(preset[id] * scale)));
    return skills;
  };
  const sluggerSkills = scalePreset(settings.PRESETS.slugger);
  const tableSetterSkills = scalePreset(settings.PRESETS.tableSetter);
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];

  const play = async (skills, tier, seedTag) => {
    const rows = [];
    for (let i = 0; i < GAMES_N; i++) {
      const agent = mkModelAgent(league, settings, MODEL_TIERS[tier]);
      const team = makePlayerTeam({ skills, hand: 'R' });
      const seed = hashSeed('bb-ab', league, seedTag, i);
      rows.push(await playOneGame(league, settings, opponent, agent, team, seed >>> 0, i % 2 === 0));
    }
    return rows.filter((r) => r.won).length / rows.length;
  };
  // [KNOWN-BUG PROBE, fixed BB-2a step 4] this call used to read `play(sluggerSkills, 'strong', ...)`
  // / `play(tableSetterSkills, 'weak', ...)` - the OPPOSITE of both the comment above and the
  // field names below (`sluggerHighPowerSloppyWinRate`, `tableSetterLowPowerWellTimedWinRate`).
  // That swap tested "Slugger with GOOD timing and high Power beats Table Setter with BAD timing
  // and low Power" - a foregone conclusion, not doc §8's actual promise - which is why NUDGE_A_B
  // failed in every league throughout phase 2 regardless of the contact model underneath it.
  const sluggerWinRate = await play(sluggerSkills, 'weak', 'slugger-weak');
  const tableSetterWinRate = await play(tableSetterSkills, 'strong', 'tablesetter-strong');
  return { sluggerHighPowerSloppyWinRate: sluggerWinRate, tableSetterLowPowerWellTimedWinRate: tableSetterWinRate, nudgeWins: tableSetterWinRate > sluggerWinRate };
}

// Experiment B: SKILL_EFFECT sensitivity - win rate at cap minus ten points versus at cap, per
// league, spent evenly across the six skills.
async function experimentSkillEffect(league, settings) {
  const cap = effectiveCapFor(league);
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];
  const atCap = {}; const belowCap = {};
  const capInt = Math.floor(cap);
  const lowInt = Math.max(0, Math.floor(cap) - 10 / settings.SKILL_IDS.length);
  for (const id of settings.SKILL_IDS) { atCap[id] = capInt; belowCap[id] = Math.round(lowInt); }
  const play = async (skills, seedTag) => {
    const rows = [];
    for (let i = 0; i < GAMES_N; i++) {
      const agent = mkModelAgent(league, settings, MODEL_TIERS.median);
      const team = makePlayerTeam({ skills, hand: 'R' });
      const seed = hashSeed('bb-skilleffect', league, seedTag, i);
      rows.push(await playOneGame(league, settings, opponent, agent, team, seed >>> 0, i % 2 === 0));
    }
    return rows.filter((r) => r.won).length / rows.length;
  };
  const atCapRate = await play(atCap, 'atcap');
  const belowCapRate = await play(belowCap, 'belowcap');
  return { atCapWinRate: atCapRate, tenPointsBelowWinRate: belowCapRate, gap: atCapRate - belowCapRate };
}

// ---------------------------------------------------------------------------------------------
// BB-2a step 4: the isolated contact-quality grid. One cell = one (timingSigmaMs, hitPow) pair;
// keeps throwing/deciding until it has CONTACT_GRID_SWINGS actual SWING decisions (a take costs a
// draw but is not counted - this measures what a swing itself produces, not how often one happens)
// and reports mean bases per swing (an out is 0 bases).
async function measureContactCell(sigma, hitPow, settings) {
  const league = CONTACT_GRID_LEAGUE;
  const teams = makeLeague(league);
  const oppTeam = teams[Math.floor(teams.length / 2)];
  const pitcher = oppTeam.players.find((p) => p.id === oppTeam.pitcherId);
  const cap = settings.CAPS[league] != null ? settings.CAPS[league] : settings.CAPS.majors;
  const controlSkill = Math.max(0, Math.min(1, (pitcher.skills.pitchAcc || 0) / cap));
  const cpuPitcher = new CpuPitcher({ league, settings });
  const batter = new ModelBatter({ timingSigmaMs: sigma, placementSigma: CONTACT_GRID_PLACEMENT_SIGMA });
  const batterSkills = { hitAcc: CONTACT_GRID_HIT_ACC, hitPow, hitSpd: 0, pitchSpd: 0, pitchAcc: 0, pitchSpin: 0 };
  const zones = zonesFor(league, 0);
  const fenceFt = settings.PARKS.default;

  let draw = 0;
  let swings = 0;
  let totalBases = 0;
  while (swings < CONTACT_GRID_SWINGS) {
    const seed = hashSeed('bb-contact-grid', sigma, hitPow, draw++) >>> 0;
    const rand01 = mulberry32(seed);
    const pitchDecision = await cpuPitcher.decidePitch({ rand01, weakZone: null });
    const pitchResult = flyPitch(pitchDecision.type, pitchDecision.aim, controlSkill, settings, rand01);
    const swingDecision = await batter.decideSwing({ pitch: pitchResult, rand01 });
    if (swingDecision.action !== 'swing') continue; // a take is not a swing - draw again
    swings += 1;
    const swingResult = swing(pitchResult, batterSkills, swingDecision, settings, rand01);
    if (!swingResult.contact || !swingResult.inPlay) continue; // whiff/foul: 0 bases, already counted
    const outcome = resolveContact(swingResult, zones, settings, fenceFt, batterSkills.hitSpd, rand01);
    if (outcome.result === 'hit') totalBases += outcome.bases;
  }
  return totalBases / CONTACT_GRID_SWINGS;
}

async function measureContactGrid(settings) {
  const grid = {};
  for (const sigma of CONTACT_GRID_SIGMAS) {
    grid[sigma] = {};
    for (const hitPow of CONTACT_GRID_HITPOWS) {
      grid[sigma][hitPow] = await measureContactCell(sigma, hitPow, settings);
    }
  }
  return grid;
}

function printContactGrid(grid) {
  console.log(`  E[bases/swing], sigma (ms, rows) x hitPow (cols), ${CONTACT_GRID_SWINGS} swings/cell, league=${CONTACT_GRID_LEAGUE}:`);
  console.log('  sigma\\hitPow  ' + CONTACT_GRID_HITPOWS.map((hp) => String(hp).padStart(8)).join(''));
  for (const sigma of CONTACT_GRID_SIGMAS) {
    console.log(`  ${String(sigma).padEnd(12)} ` + CONTACT_GRID_HITPOWS.map((hp) => grid[sigma][hp].toFixed(4).padStart(8)).join(''));
  }
}

/** The four contact-grid assertions (BB-2a step 4). Returns {ok, lines} - `lines` are the
 *  [PASS]/[FAIL] strings, printed by the caller so both `--contact-grid` alone and the full sweep
 *  format identically. */
function assertContactGrid(grid) {
  const lo = CONTACT_GRID_SIGMAS[0], hi = CONTACT_GRID_SIGMAS[CONTACT_GRID_SIGMAS.length - 1];
  const pLo = CONTACT_GRID_HITPOWS[0], pHi = CONTACT_GRID_HITPOWS[CONTACT_GRID_HITPOWS.length - 1];
  const lines = [];
  let ok = true;
  const line = (label, pass, measured, threshold) => {
    if (!pass) ok = false;
    lines.push(`  [${pass ? 'PASS' : 'FAIL'}] ${label}: measured ${measured}, threshold ${threshold}`);
  };

  const monotoneSigma = CONTACT_GRID_HITPOWS.every((hp) =>
    CONTACT_GRID_SIGMAS.every((s, i) => i === 0 || grid[s][hp] <= grid[CONTACT_GRID_SIGMAS[i - 1]][hp] + 1e-9));
  const sigmaFalls = CONTACT_GRID_HITPOWS.every((hp) => grid[hi][hp] < grid[lo][hp]);
  line('CONTACT_GRID monotone (E falls as timing sigma rises, every hitPow)', monotoneSigma && sigmaFalls,
    JSON.stringify(CONTACT_GRID_HITPOWS.map((hp) => CONTACT_GRID_SIGMAS.map((s) => +grid[s][hp].toFixed(3)))), 'non-increasing, strictly falls end to end');

  const monotonePower = CONTACT_GRID_SIGMAS.every((s) =>
    CONTACT_GRID_HITPOWS.every((hp, i) => i === 0 || grid[s][hp] >= grid[s][CONTACT_GRID_HITPOWS[i - 1]] - 1e-9));
  const powerRises = CONTACT_GRID_SIGMAS.every((s) => grid[s][pHi] > grid[s][pLo]);
  line('CONTACT_GRID monotone (E rises with hitPow, every sigma - power is a nudge, never zero)', monotonePower && powerRises,
    JSON.stringify(CONTACT_GRID_SIGMAS.map((s) => CONTACT_GRID_HITPOWS.map((hp) => +grid[s][hp].toFixed(3)))), 'non-decreasing, strictly rises end to end');

  const timingGapAtLowPower = grid[lo][pLo] - grid[hi][pLo];
  const powerGapAtHighSigma = grid[hi][pHi] - grid[hi][pLo];
  line('CONTACT_GRID ratio (timing gap at hitPow=2 vs power gap at sigma=85)',
    timingGapAtLowPower >= TIMING_OVER_POWER * powerGapAtHighSigma,
    `timingGap=${timingGapAtLowPower.toFixed(4)}, powerGap=${powerGapAtHighSigma.toFixed(4)}`,
    `timingGap >= ${TIMING_OVER_POWER} x powerGap`);

  const cross = grid[lo][pLo] - grid[hi][pHi];
  line('CONTACT_GRID cross (well-timed low-Power beats sloppy high-Power, by a margin)',
    cross >= CONTACT_AB_MARGIN, cross.toFixed(4), `>= ${CONTACT_AB_MARGIN}`);

  const powerGapAtLowSigma = grid[lo][pHi] - grid[lo][pLo];
  line('CONTACT_GRID ceiling (power gap at sigma=35 is at most half the timing gap at hitPow=2)',
    powerGapAtLowSigma <= timingGapAtLowPower * 0.5,
    `powerGap=${powerGapAtLowSigma.toFixed(4)}, timingGap=${timingGapAtLowPower.toFixed(4)}`,
    '<= 0.5 x timingGap');

  return { ok, lines };
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();

  if (FLAG_STYLES) {
    const league = STYLE_MEASURE_LEAGUE;
    console.log(`sim-baseball.mjs --styles${FLAG_STYLES_TUNE ? ' --tune' : ''} - league=${league}, games=${STYLE_MEASURE_GAMES}, band=${STYLE_STRENGTH_BAND}`);
    const styleIds = Object.keys(SETTINGS.TEAM_STYLES).filter((id) => id !== 'balanced');
    let anyOut = false;
    if (FLAG_STYLES_TUNE) {
      console.log('\n  style          best-s   winRate  vector');
      const results = {};
      for (const id of styleIds) {
        const best = await tuneStyle(id, league, SETTINGS, STYLE_MEASURE_GAMES);
        results[id] = best;
        const inBand = best.dist <= STYLE_STRENGTH_BAND;
        if (!inBand) anyOut = true;
        console.log(`  ${id.padEnd(14)} ${best.s.toFixed(2).padStart(6)}   ${(best.winRate * 100).toFixed(1).padStart(5)}%  ${inBand ? '' : '[OUT OF BAND] '}${JSON.stringify(best.vector)}`);
      }
      console.log(`\n${anyOut ? 'Some styles remain outside the +/-' + STYLE_STRENGTH_BAND + ' band even at the search bounds - widen STYLE_COMPRESS_CANDIDATES.' : 'Every style lands within the band.'}`);
    } else {
      console.log('\n  style          winRate (vs balanced)');
      for (const id of styleIds) {
        const winRate = await measureStyleWinRate(id, SETTINGS.TEAM_STYLES[id], league, SETTINGS, STYLE_MEASURE_GAMES);
        const inBand = Math.abs(winRate - 0.5) <= STYLE_STRENGTH_BAND;
        if (!inBand) anyOut = true;
        console.log(`  ${id.padEnd(14)} ${(winRate * 100).toFixed(1).padStart(5)}%${inBand ? '' : '  [OUT OF BAND]'}`);
      }
    }
    console.log(`\nwall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (FLAG_ASSERT && anyOut) process.exitCode = 1;
    return;
  }

  if (FLAG_CONTACT_GRID) {
    console.log(`sim-baseball.mjs --contact-grid - ${CONTACT_GRID_SWINGS} swings/cell, league=${CONTACT_GRID_LEAGUE}`);
    const grid = await measureContactGrid(SETTINGS);
    printContactGrid(grid);
    const { ok, lines } = assertContactGrid(grid);
    console.log('\n=== CONTACT GRID SCOREBOARD ===');
    for (const l of lines) console.log(l);
    console.log(`\nwall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (FLAG_ASSERT && !ok) {
      console.log('\nFAIL: one or more contact-grid assertions did not meet their threshold (see above).');
      process.exitCode = 1;
    }
    return;
  }

  console.log(`sim-baseball.mjs - GAMES_N=${GAMES_N} SEASONS_N=${SEASONS_N} leagues=${LEAGUES.join(',')} tiers=${TIERS.join(',')}`);
  console.log('MODEL_TIERS (this tool\'s own assumptions):', JSON.stringify(MODEL_TIERS));

  const report = { generatedAt: new Date().toISOString(), gamesN: GAMES_N, seasonsN: SEASONS_N, modelTiers: MODEL_TIERS, leagues: {} };

  for (const setValue of SET_VALUES) {
    const settings = settingsFor(setValue);
    const setLabel = SET_KEY && setValue != null ? ` [${SET_KEY}=${setValue}]` : '';

    for (const league of LEAGUES) {
      console.log(`\n=== ${league}${setLabel} ===`);
      const gameStats = await measureLeagueGames(league, settings);
      const seasonStats = await measureLeagueSeasons(league, settings);
      report.leagues[league] = report.leagues[league] || {};
      const key = setLabel || 'default';
      report.leagues[league][key] = { gameStats, seasonStats };

      console.log('  per-team win rate by tier (weakest..strongest):');
      for (const t of gameStats) {
        console.log(`    ${t.styleId.padEnd(14)} ` + TIERS.map((tier) => `${tier}=${(t.perTier[tier].winRate * 100).toFixed(0)}%`).join('  '));
      }
      console.log('  season odds by tier:');
      for (const tier of TIERS) {
        const s = seasonStats[tier];
        console.log(`    ${tier.padEnd(8)} top4=${(s.top4Rate * 100).toFixed(0)}%  gold=${(s.goldRate * 100).toFixed(0)}%  ` +
          `E[seasons to Gold]=${s.expectedSeasonsToGold === Infinity ? 'inf' : s.expectedSeasonsToGold.toFixed(2)}  ` +
          `champGameWin=${s.champWinRate == null ? 'n/a' : (s.champWinRate * 100).toFixed(0) + '%'}  ` +
          `pts/season=${s.avgPointsPerSeason.toFixed(1)}  seasonsToCap=${s.seasonsToCap === Infinity ? 'inf' : s.seasonsToCap.toFixed(1)}`);
      }
    }
  }

  // Experiments (default settings only - these are about mechanics, not a settings sweep).
  console.log('\n=== Experiment: well-timed low-Power vs sloppy high-Power (doc §8) ===');
  const ab = {};
  for (const league of LEAGUES) {
    ab[league] = await experimentNudgeAB(league, SETTINGS);
    console.log(`  ${league}: Slugger(strong power, weak timing)=${(ab[league].sluggerHighPowerSloppyWinRate * 100).toFixed(0)}%  ` +
      `TableSetter(low power, strong timing)=${(ab[league].tableSetterLowPowerWellTimedWinRate * 100).toFixed(0)}%  ` +
      `nudge wins=${ab[league].nudgeWins}`);
  }

  console.log('\n=== Experiment: SKILL_EFFECT sensitivity (win rate at cap vs 10 pts below) ===');
  const skillEffect = {};
  for (const league of LEAGUES) {
    skillEffect[league] = await experimentSkillEffect(league, SETTINGS);
    console.log(`  ${league}: atCap=${(skillEffect[league].atCapWinRate * 100).toFixed(0)}%  ` +
      `-10pts=${(skillEffect[league].tenPointsBelowWinRate * 100).toFixed(0)}%  gap=${(skillEffect[league].gap * 100).toFixed(1)}pp`);
  }
  report.experiments = { nudgeAB: ab, skillEffect };

  // -----------------------------------------------------------------------------------------
  // The promise scoreboard.
  console.log('\n=== PROMISE SCOREBOARD ===');
  let anyFail = false;
  const scoreLine = (label, ok, measured, threshold) => {
    if (!ok) anyFail = true;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: measured ${measured}, threshold ${threshold}`);
  };

  const medianAcross = (fn) => median(LEAGUES.map((lg) => fn(report.leagues[lg].default.seasonStats.median)));
  if (report.leagues[LEAGUES[0]].default) {
    const medGoldSeasons = medianAcross((s) => s.expectedSeasonsToGold);
    scoreLine('GOLD_SEASONS_MAX_MEDIAN (median tier, every league)', medGoldSeasons <= GOLD_SEASONS_MAX_MEDIAN,
      medGoldSeasons.toFixed(2), `<= ${GOLD_SEASONS_MAX_MEDIAN}`);

    const medGoldOneSeasons = medianAcross((s) => s.goldRate);
    scoreLine('GOLD_ONE_SEASON_MIN_MEDIAN', medGoldOneSeasons >= GOLD_ONE_SEASON_MIN_MEDIAN,
      medGoldOneSeasons.toFixed(3), `>= ${GOLD_ONE_SEASON_MIN_MEDIAN}`);

    const champRates = LEAGUES.map((lg) => report.leagues[lg].default.seasonStats.median.champWinRate).filter((v) => v != null);
    const medChamp = champRates.length ? median(champRates) : null;
    scoreLine('CHAMPION_GAME_WIN_MIN_MEDIAN', medChamp != null && medChamp >= CHAMPION_GAME_WIN_MIN_MEDIAN,
      medChamp == null ? 'n/a (no sample reached the championship)' : medChamp.toFixed(3), `>= ${CHAMPION_GAME_WIN_MIN_MEDIAN}`);

    // LADDER_MONOTONE: median win rate against the league-average team falls each league up.
    const ladderWinRates = LEAGUES.map((lg) => mean(report.leagues[lg].default.gameStats.map((t) => t.perTier.median.winRate)));
    const ladderOk = ladderWinRates.every((v, i) => i === 0 || v <= ladderWinRates[i - 1] + 1e-9);
    scoreLine('LADDER_MONOTONE (win rate falls each league up)', ladderOk, JSON.stringify(ladderWinRates.map((v) => +v.toFixed(3))), 'non-increasing');

    // within-league schedule-order monotonicity (weakest..strongest opponent), BB-2a step 6: its
    // own LADDER_GAMES_N-game measurement and a real LADDER_TOLERANCE, replacing phase 2's ad hoc
    // "+0.15" (which was hiding real disorder, not just noise, at only 400 games/opponent).
    const ladderRatesByLeague = {};
    for (const lg of LEAGUES) ladderRatesByLeague[lg] = await measureLadderWinRates(lg, SETTINGS);
    console.log(`\n  within-league ladder check (median tier, ${LADDER_GAMES_N} games/opponent, tolerance ${LADDER_TOLERANCE}):`);
    for (const lg of LEAGUES) console.log(`    ${lg.padEnd(12)} ` + ladderRatesByLeague[lg].map((v) => (v * 100).toFixed(1) + '%').join('  '));
    const withinLeagueOk = LEAGUES.every((lg) => {
      const rates = ladderRatesByLeague[lg];
      return rates.every((v, i) => i === 0 || v <= rates[i - 1] + LADDER_TOLERANCE);
    });
    scoreLine('LADDER_MONOTONE (within-league, weakest..strongest opponent)', withinLeagueOk,
      'see the within-league ladder check above', `non-increasing within ${LADDER_TOLERANCE}`);
  }

  const nudgeGaps = LEAGUES.map((lg) => ab[lg].tableSetterLowPowerWellTimedWinRate - ab[lg].sluggerHighPowerSloppyWinRate);
  scoreLine('NUDGE_A_B (well-timed low-Power beats sloppy high-Power, by a margin)',
    nudgeGaps.every((g) => g >= NUDGE_AB_MIN_WINRATE_GAP),
    JSON.stringify(nudgeGaps.map((g) => +g.toFixed(3))), `>= ${NUDGE_AB_MIN_WINRATE_GAP} in every league`);

  const bindingLeagues = LEAGUES.filter((lg) => CAP_BINDS_ONLY.includes(lg));
  const nonBindingLeagues = LEAGUES.filter((lg) => !CAP_BINDS_ONLY.includes(lg));
  if (bindingLeagues.length) {
    const bindOk = bindingLeagues.every((lg) => report.leagues[lg].default.seasonStats.median.seasonsToCap <= CAP_SEASONS_MAX_UPPER);
    scoreLine('CAP_BINDS_ONLY (little/highschool cap within seasons)', bindOk,
      JSON.stringify(bindingLeagues.map((lg) => report.leagues[lg].default.seasonStats.median.seasonsToCap.toFixed(1))),
      `<= ${CAP_SEASONS_MAX_UPPER}`);
  }
  if (nonBindingLeagues.length) {
    const notBoundOk = nonBindingLeagues.every((lg) => report.leagues[lg].default.seasonStats.median.seasonsToCap > CAP_SEASONS_MAX_UPPER);
    scoreLine('CAP_BINDS_ONLY (college/minors/majors do NOT bind quickly)', notBoundOk,
      JSON.stringify(nonBindingLeagues.map((lg) => report.leagues[lg].default.seasonStats.median.seasonsToCap.toFixed(1))),
      `> ${CAP_SEASONS_MAX_UPPER}`);
  }

  const gapsOk = LEAGUES.every((lg) => skillEffect[lg].gap <= NUDGE_MAX_WINRATE_GAP + 0.25); // report-only, wide margin pre-retune
  scoreLine('SKILL_EFFECT sensitivity (reported, not gated pre-retune)', gapsOk,
    JSON.stringify(LEAGUES.map((lg) => skillEffect[lg].gap.toFixed(3))), `<= ${NUDGE_MAX_WINRATE_GAP} after step 6's retune`);

  const wallMs = Date.now() - t0;
  console.log(`\nwall clock: ${(wallMs / 1000).toFixed(1)}s`);

  if (ARG_JSON) {
    const outDir = path.join(ROOT, '.sim-out');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.isAbsolute(ARG_JSON) ? ARG_JSON : path.join(outDir, ARG_JSON);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`report written to ${outPath}`);
  }

  if (FLAG_ASSERT && anyFail) {
    console.log('\nFAIL: one or more promises did not meet their threshold (see above).');
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
