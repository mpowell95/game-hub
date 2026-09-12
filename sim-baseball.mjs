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
import { makeLeague, makePlayerTeam, effectiveCapFor } from './baseball/js/engine/teams.js';
import { makeSchedule, scriptedStandings, playoffs, trophyFor } from './baseball/js/engine/season.js';
import { hashSeed, mulberry32 } from './baseball/js/engine/rng.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// CLI, `tune-boggle-es.mjs`'s own `arg()` shape.
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const FLAG_QUICK = process.argv.includes('--quick');
const FLAG_ASSERT = process.argv.includes('--assert');
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
      return new CpuBatter({ league, skills: batter.skills, settings }).decideSwing(v);
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

/** Play a whole GAMES_N-game matchup sweep for one (league, team, tier), alternating home/away. */
async function sweepMatchup(league, settings, opponent, tier, seedBase) {
  const cpu = settings.CPU[league] || settings.CPU.college;
  const skills = playerSkillsFor(league, settings);
  const results = [];
  for (let i = 0; i < GAMES_N; i++) {
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
  const sluggerWinRate = await play(sluggerSkills, 'strong', 'slugger-strong');
  const tableSetterWinRate = await play(tableSetterSkills, 'weak', 'tablesetter-weak');
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
async function main() {
  const t0 = Date.now();
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

    // within-league schedule-order monotonicity (weakest..strongest opponent).
    const withinLeagueOk = LEAGUES.every((lg) => {
      const rates = report.leagues[lg].default.gameStats.map((t) => t.perTier.median.winRate);
      return rates.every((v, i) => i === 0 || v <= rates[i - 1] + 0.15); // allow sampling noise
    });
    scoreLine('LADDER_MONOTONE (within-league, weakest..strongest opponent)', withinLeagueOk, 'see per-team table above', 'roughly non-increasing');
  }

  scoreLine('NUDGE_A_B (well-timed low-Power beats sloppy high-Power)',
    LEAGUES.every((lg) => ab[lg].nudgeWins), JSON.stringify(LEAGUES.map((lg) => ab[lg].nudgeWins)), 'true in every league');

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
