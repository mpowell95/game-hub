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
const FLAG_STAGES = process.argv.includes('--stages');
const FLAG_ATTRIBUTE = process.argv.includes('--attribute');
const FLAG_RANGE = process.argv.includes('--range');
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
// BB-2c: design doc v9 §8, [Locked] replaces the old flat "Gold in about two seasons everywhere"
// with a per-league SHAPE - Little League near-total dominance, the Majors a real grind. The two
// flat medians (`GOLD_SEASONS_MAX_MEDIAN`/`GOLD_ONE_SEASON_MIN_MEDIAN`) are retired in favor of
// `SEASON_WINRATE_BAND` (the doc's own per-league regular-season win-rate table) and
// `SEASONS_TO_GOLD_TARGET` (its own seasons-to-Gold column, asserted with `SEASONS_TO_GOLD_TOLERANCE`
// - Gold is a CONSEQUENCE of the win-rate band, still asserted, never chased directly).
const SEASON_WINRATE_BAND = {
  little: [0.92, 0.98],
  highschool: [0.70, 0.80],
  college: [0.57, 0.67],
  minors: [0.49, 0.59],
  majors: [0.41, 0.51],
};
const SEASONS_TO_GOLD_TARGET = { little: 1, highschool: 1.5, college: 2, minors: 3, majors: 4.5 };
// Draft, stated tolerance: seasons-to-Gold is 1/(one-season rate), which is highly sensitive to
// sampling noise near small rates (Majors' own target of 4.5 seasons corresponds to a ~22% one-
// season rate - a few percentage points of measurement noise there swings seasons-to-Gold by a
// full season or more), so this is deliberately wide relative to `LADDER_TOLERANCE`.
const SEASONS_TO_GOLD_TOLERANCE = 0.75;
// Doc v9 §8, [Locked]: "the weakest opponent is beaten at 85% or better and the champion sits
// between 40 and 55%" - the within-league ladder's own two endpoints, on top of the existing
// non-increasing (`LADDER_TOLERANCE`) shape check.
const SLOT_WINRATE_WEAKEST_MIN = 0.85;
const SLOT_WINRATE_CHAMPION_MIN = 0.40;
const SLOT_WINRATE_CHAMPION_MAX = 0.55;
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
// `tune-boggle-es.mjs`: measure a candidate value without editing settings.js. A bare key (no dot)
// keeps the original broadcast behavior (every league's FIELD.outZoneMult); BB-2c commit 1 extends
// it to accept any DOTTED path instead, set at that one exact location only (e.g.
// "--set CPU.majors.timingSigmaMs=58") - see `withOverride`, defined further down this file.
function settingsFor(overrideValue) {
  if (overrideValue == null) return SETTINGS;
  if (SET_KEY && SET_KEY.includes('.')) return withOverride(SETTINGS, SET_KEY, overrideValue);
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
      return new CpuBatter({ league, skills: batter.skills, settings, styleId: team.styleId, ladderOffset: team.ladderOffset }).decideSwing(v);
    },
  };
}
function mkModelAgent(league, settings, tier) {
  const cpu = settings.CPU[league] || settings.CPU.college;
  const batter = new ModelBatter({ timingSigmaMs: tier.timingSigmaMs, placementSigma: tier.placementSigma, swingIn: cpu.swingIn, chase: cpu.chase, settings });
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

// ---------------------------------------------------------------------------------------------
// BB-2c commit 1: `--attribute` - which of the two diagnosed CPU stat advantages (timing sigma,
// placement noise) actually causes the regular-season win-rate gap, measured by ONE-FACTOR
// COUNTERFACTUAL swaps through the real engine, not argued from first principles. Measurement
// only - no settings.js value changes; `withOverride` clones just the branch it touches so every
// other constant, including the settings module's own function exports, passes through by
// reference.
function withOverride(settings, path, value) {
  const keys = path.split('.');
  const root = { ...settings };
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cursor[k] = { ...cursor[k] };
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  return root;
}
function withOverrides(settings, overrides) {
  return overrides.reduce((s, [path, value]) => withOverride(s, path, value), settings);
}

// This commit predates commit 2's real `CPU_SIGMA_ABSOLUTE_FLOOR_MS`/`CPU_PLACEMENT_MIN`
// constants - these two literals are exactly the values the handoff specifies for them, used here
// only to build the counterfactual settings a measurement-only commit is allowed to construct.
const ATTRIB_SIGMA_FLOOR = 58;
const ATTRIB_PLACEMENT_MIN = 0.22;
// `readNoise = (1 - guess) * 0.3` is the shipped formula (pre-contract) for a CpuBatter's base
// placement noise - the `guess` value that reproduces ATTRIB_PLACEMENT_MIN under that formula,
// since `placementNoise` does not exist as its own field until commit 2.
const ATTRIB_GUESS_FOR_PLACEMENT_MIN = 1 - ATTRIB_PLACEMENT_MIN / 0.3;

/** Play ONE game and return a full plate-appearance ledger for BOTH sides, not just the player's
 *  own - `--attribute`'s counterfactuals need to see how the SWAPPED side's batting changed, and
 *  the player's own tier is held fixed throughout so its ledger is the constant against which the
 *  opponent's move is read. */
function emptyLedger() { return { pa: 0, so: 0, bb: 0, inPlay: 0, hits: 0, homers: 0, outsFromContact: 0, qSum: 0, qN: 0, centered: 0, centeredN: 0, exitVeloSum: 0, exitVeloN: 0 }; }
function foldAtBat(ledger, payload) {
  ledger.pa += 1;
  if (payload.outcome === 'strikeout') { ledger.so += 1; return; }
  if (payload.outcome === 'walk') { ledger.bb += 1; return; }
  ledger.inPlay += 1;
  if (payload.bases > 0) ledger.hits += 1; else ledger.outsFromContact += 1;
  if (payload.bases === 4) ledger.homers += 1;
  if (payload.q != null) { ledger.qSum += payload.q; ledger.qN += 1; }
  if (payload.centered != null) { if (payload.centered) ledger.centered += 1; ledger.centeredN += 1; }
  if (payload.exitVeloMph != null) { ledger.exitVeloSum += payload.exitVeloMph; ledger.exitVeloN += 1; }
}
async function playOneGameForLedger(league, settings, opponent, playerAgent, playerTeam, seed, playerHome) {
  const home = playerHome ? playerTeam : opponent;
  const away = playerHome ? opponent : playerTeam;
  const homeAgent = playerHome ? playerAgent : mkCpuAgent(opponent, league, settings);
  const awayAgent = playerHome ? mkCpuAgent(opponent, league, settings) : playerAgent;
  const g = new Game({ home, away, seed, agents: { home: homeAgent, away: awayAgent }, settings });
  const playerSide = playerHome ? 'home' : 'away';
  const oppSide = playerHome ? 'away' : 'home';
  const ledgers = { player: emptyLedger(), opp: emptyLedger() };
  g.onEvent = async (type, payload) => {
    if (type !== 'atBatEnd') return;
    if (payload.side === playerSide) foldAtBat(ledgers.player, payload);
    else if (payload.side === oppSide) foldAtBat(ledgers.opp, payload);
  };
  await g.playGame();
  const playerRuns = playerHome ? g.score.home : g.score.away;
  const oppRuns = playerHome ? g.score.away : g.score.home;
  const won = g.winner === playerSide;
  return { won, playerRuns, oppRuns, ledgers };
}

/** Median win rate for one league/tier under one settings object, over `ATTRIBUTE_GAMES` games
 *  against the league's own average team (index 4 of 8, the same "average opponent" stand-in
 *  `measureLeagueGames` uses elsewhere in this file), plus the folded ledger for both sides. */
async function measureAttributeCell(league, settings, tier, gamesN, seedTag) {
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];
  const skills = playerSkillsFor(league, settings);
  const ledgers = { player: emptyLedger(), opp: emptyLedger() };
  let wins = 0;
  for (let i = 0; i < gamesN; i++) {
    const playerAgent = mkModelAgent(league, settings, MODEL_TIERS[tier]);
    const playerTeam = makePlayerTeam({ skills, hand: 'R' });
    const seed = hashSeed('bb-attribute', league, seedTag, i);
    const res = await playOneGameForLedger(league, settings, opponent, playerAgent, playerTeam, seed >>> 0, i % 2 === 0);
    if (res.won) wins += 1;
    for (const key of ['player', 'opp']) {
      for (const field of Object.keys(ledgers[key])) ledgers[key][field] += res.ledgers[key][field];
    }
  }
  return { winRate: wins / gamesN, ledgers };
}

function ledgerSummary(ledger) {
  const pa = ledger.pa || 1;
  return {
    so: ledger.so / pa, bb: ledger.bb / pa, inPlay: ledger.inPlay / pa,
    hitOnContact: ledger.inPlay ? ledger.hits / ledger.inPlay : 0,
    homerRate: ledger.inPlay ? ledger.homers / ledger.inPlay : 0,
    meanQ: ledger.qN ? ledger.qSum / ledger.qN : 0,
    centeredShare: ledger.centeredN ? ledger.centered / ledger.centeredN : 0,
    meanExitVelo: ledger.exitVeloN ? ledger.exitVeloSum / ledger.exitVeloN : 0,
    contactToOuts: ledger.inPlay ? ledger.outsFromContact / ledger.inPlay : 0,
  };
}

/** The five one-factor counterfactuals the handoff names, built for one league. */
function attributeCounterfactuals(league) {
  const cpuLeagues = SETTINGS.LEAGUES;
  return {
    'sigmaFloor': withOverrides(SETTINGS, cpuLeagues.map((lg) => [`CPU.${lg}.timingSigmaMs`, ATTRIB_SIGMA_FLOOR])),
    'placementFloor': withOverrides(SETTINGS, cpuLeagues.map((lg) => [`CPU.${lg}.guess`, ATTRIB_GUESS_FOR_PLACEMENT_MIN])),
    'both': withOverrides(SETTINGS, cpuLeagues.flatMap((lg) => [[`CPU.${lg}.timingSigmaMs`, ATTRIB_SIGMA_FLOOR], [`CPU.${lg}.guess`, ATTRIB_GUESS_FOR_PLACEMENT_MIN]])),
    'pitchingLikeLittle': withOverrides(SETTINGS, [
      [`CPU.${league}.pitchMix`, SETTINGS.CPU.little.pitchMix],
      [`CPU.${league}.cornerBias`, SETTINGS.CPU.little.cornerBias],
      [`CPU.${league}.patternWeight`, SETTINGS.CPU.little.patternWeight],
      [`CPU.${league}.weakSpotWeight`, SETTINGS.CPU.little.weakSpotWeight],
    ]),
    'fieldLikeCollege': withOverrides(SETTINGS, [
      [`FIELD.${league}.outZoneMult`, SETTINGS.FIELD.college.outZoneMult],
      [`FIELD.${league}.fieldScale`, SETTINGS.FIELD.college.fieldScale],
    ]),
  };
}

async function runAttribute(t0) {
  const gamesN = Math.max(4, Math.round(FLAG_QUICK ? 1000 / 10 : 1000));
  console.log(`sim-baseball.mjs --attribute - ATTRIBUTE_GAMES=${gamesN}, tier=median, leagues=${LEAGUES.join(',')}`);
  console.log(`measurement only - counterfactuals use ATTRIB_SIGMA_FLOOR=${ATTRIB_SIGMA_FLOOR}, ATTRIB_PLACEMENT_MIN=${ATTRIB_PLACEMENT_MIN} (anticipating commit 2's real constants)\n`);
  for (const league of LEAGUES) {
    const baseline = await measureAttributeCell(league, SETTINGS, 'median', gamesN, 'baseline');
    console.log(`=== ${league} (median tier) ===`);
    console.log(`  baseline: winRate=${fmtPct(baseline.winRate)} runsFor/against per PA-ledger below`);
    console.log(`  player ledger: ${JSON.stringify(ledgerSummary(baseline.ledgers.player))}`);
    console.log(`  opp    ledger: ${JSON.stringify(ledgerSummary(baseline.ledgers.opp))}`);

    const cfs = attributeCounterfactuals(league);
    for (const [name, settings] of Object.entries(cfs)) {
      const r = await measureAttributeCell(league, settings, 'median', gamesN, name);
      const delta = r.winRate - baseline.winRate;
      console.log(`  cf ${name.padEnd(18)} winRate=${fmtPct(r.winRate)}  delta=${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`);
    }
    console.log('');
  }
  console.log(`wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
  const schedule = makeSchedule(league, seasonSeed, settings.SCHEDULE_SHAPE);
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

  // BB-2b commit 2: bracket/home/standings are no longer hardcoded here - `scriptedStandings`/
  // `playoffs` read `settings.STANDINGS_MODEL`/`settings.BRACKET_MODEL` themselves (Open item 13),
  // and both playoff games' home/away now follows `settings.PLAYOFF_HOME` instead of being forced
  // player-home while the 12-game regular season alternates 6/6 (baseball/CLAUDE.md's own finding).
  const standings = scriptedStandings(teams, { wins, losses }, settings.STANDINGS_MODEL);
  const playerRank = standings.findIndex((r) => r.isPlayer);
  const madePlayoffs = playerRank < 4;
  let reachedSemifinal = false, reachedChampionship = false, wonChampionship = false;
  if (madePlayoffs) {
    const bracket = playoffs(standings, settings.BRACKET_MODEL);
    const sfIndex = bracket.semifinals.findIndex((pair) => pair.some((t) => t.isPlayer));
    reachedSemifinal = true;
    const sfOpponentRow = bracket.semifinals[sfIndex].find((t) => !t.isPlayer);
    const sfOpponentTeam = teams.find((t) => t.name === sfOpponentRow.id) || teams[teams.length - 1];
    const sfHome = decidePlayoffHome(settings.PLAYOFF_HOME, seasonSeed, 'semifinal', wins, winsForTeam(standings, sfOpponentTeam));
    const sfSeed = hashSeed('bb-playoff-sf', league, tier, seasonSeed);
    const sfRes = await playOneGame(league, settings, sfOpponentTeam, playerAgent, playerTeam, sfSeed >>> 0, sfHome);
    if (sfRes.won) {
      reachedChampionship = true;
      // doc §8, [Locked]: "the championship opponent is always the toughest team in the league."
      const champOpponent = teams[teams.length - 1];
      const chHome = decidePlayoffHome(settings.PLAYOFF_HOME, seasonSeed, 'final', wins, winsForTeam(standings, champOpponent));
      const chSeed = hashSeed('bb-playoff-champ', league, tier, seasonSeed);
      const chRes = await playOneGame(league, settings, champOpponent, playerAgent, playerTeam, chSeed >>> 0, chHome);
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
    // BB-2c: the regular-season win RATE (design doc v9 §8's own per-league band) - wins across
    // the whole 12-game schedule, not the flat "vs one average opponent" number `measureLeagueGames`
    // reports elsewhere in this file (that number ignores the schedule's own repeats entirely).
    const seasonWinRate = mean(seasons.map((s) => s.wins / (s.wins + s.losses)));
    perTier[tier] = {
      goldRate,
      expectedSeasonsToGold: goldRate > 0 ? 1 / goldRate : Infinity,
      top4Rate,
      champWinRate,
      seasonWinRate,
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
    const pitchResult = flyPitch(pitchDecision.type, pitchDecision.aim, controlSkill, settings, rand01, pitcher.skills);
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
// BB-2b commit 1: `--stages` - a per-stage decomposition of Gold, MEASUREMENT ONLY (no engine
// change - `season.js`'s real `playoffs()`/schedule are untouched; every variant below is
// duplicated locally here). Names the stage eating the seasons: top4 odds x semifinal win rate x
// championship win rate should multiply out to the measured one-season Gold rate; the diagnosis
// (baseball/CLAUDE.md's BB-2a report) is that the player is charged twice - seeded low (so the
// semifinal opponent is the strongest qualifier) AND handed the strongest team again in a
// hardcoded, forced-home final - while the season alternates home/away for every other game.
const BRACKET_MODELS = ['asCoded', 'strongestInFinal'];
// BB-2c commit 4: `SCHEDULE_SHAPE` is now a real, settings-driven `season.js` parameter (see
// settings.js's own constant) - `spread` (BB-2b's own ad hoc third shape) is replaced by
// `repeatMiddle`, the handoff's own third named shape; the diagnostic below now calls the REAL
// `makeSchedule(league, seasonSeed, shape)` directly instead of duplicating its own copy.
const SCHEDULE_SHAPES = ['repeatTop', 'repeatBottom', 'repeatMiddle'];
const PLAYOFF_HOMES = ['player', 'higherSeed', 'alternate'];
const STANDINGS_MODELS = ['rawWins7', 'scaledTo12'];

/** The CPU-scripted "record" a standings row carries for one team, for a higher-seed home-field
 *  decision - `scriptedStandings`'s own `wins` column (see season.js), looked up by team name. */
function winsForTeam(standings, team) {
  const row = standings.find((s) => s.id === team.name);
  return row ? row.wins : 0;
}

/** BB-2b commit 2: `season.js`'s real `playoffs()` now takes `bracketModel` directly (Open item
 *  13) - this used to be duplicated here in commit 1 before that landed; kept as a thin wrapper so
 *  `playSeasonStaged` below reads the same way it did in commit 1's diagnostic. */
function pickSemifinalOpponent(standings, bracketModel) {
  const bracket = playoffs(standings, bracketModel); // season.js's real implementation
  const sfPair = bracket.semifinals.find((pair) => pair.some((t) => t.isPlayer));
  if (!sfPair) return null; // shouldn't happen when madePlayoffs is true
  return sfPair.find((t) => !t.isPlayer) || null;
}

function decidePlayoffHome(mode, seasonSeed, gameLabel, playerWins, oppWins) {
  if (mode === 'higherSeed') return playerWins >= oppWins;
  if (mode === 'alternate') {
    const base = (Number(seasonSeed) % 2) === 0;
    return gameLabel === 'semifinal' ? base : !base;
  }
  return true; // 'player' - as coded, both playoff games are forced player-home
}

/** One season, played under a named (bracketModel, playoffHome, scheduleShape) combination -
 *  everything else identical to the real `playSeason` above (same skills, same tiers, same real
 *  `Game`). Returns per-stage detail `--stages` needs that the scoreboard's `playSeason` throws
 *  away: home/away split, seed, which slot each playoff opponent came from, and whether each
 *  playoff round was actually reached/won. */
async function playSeasonStaged(league, settings, tier, seasonSeed, opts) {
  const teams = makeLeague(league);
  const schedule = makeSchedule(league, seasonSeed, opts.scheduleShape);
  const skills = playerSkillsFor(league, settings);
  const playerAgent = mkModelAgent(league, settings, MODEL_TIERS[tier]);
  const playerTeam = makePlayerTeam({ skills, hand: 'R' });

  let wins = 0, losses = 0, homeWins = 0, homeGames = 0, awayWins = 0, awayGames = 0;
  for (let i = 0; i < schedule.length; i++) {
    const g = schedule[i];
    const opponent = teams[g.opponentIndex];
    const seed = hashSeed('bb-stage-season', league, tier, seasonSeed, opts.scheduleShape, i);
    const res = await playOneGame(league, settings, opponent, playerAgent, playerTeam, seed >>> 0, g.home);
    if (g.home) { homeGames += 1; if (res.won) homeWins += 1; } else { awayGames += 1; if (res.won) awayWins += 1; }
    if (res.won) wins += 1; else losses += 1;
  }

  const standings = scriptedStandings(teams, { wins, losses }, opts.standingsModel);
  const playerRank = standings.findIndex((r) => r.isPlayer);
  const madePlayoffs = playerRank < 4;
  const result = {
    wins, losses, homeWins, homeGames, awayWins, awayGames, madePlayoffs, seed: playerRank,
    semifinalOpponentSlot: null, semifinalWon: false, reachedChampionship: false,
    finalOpponentSlot: null, wonChampionship: false, trophy: 0,
  };
  if (!madePlayoffs) return result;

  const sfOpponentRow = pickSemifinalOpponent(standings, opts.bracketModel);
  const sfOpponentTeam = teams.find((t) => t.name === sfOpponentRow.id) || teams[teams.length - 1];
  result.semifinalOpponentSlot = teams.indexOf(sfOpponentTeam);
  const sfHome = decidePlayoffHome(opts.playoffHome, seasonSeed, 'semifinal', wins, winsForTeam(standings, sfOpponentTeam));
  const sfSeed = hashSeed('bb-stage-sf', league, tier, seasonSeed, opts.bracketModel, opts.playoffHome, opts.scheduleShape);
  const sfRes = await playOneGame(league, settings, sfOpponentTeam, playerAgent, playerTeam, sfSeed >>> 0, sfHome);
  result.semifinalWon = sfRes.won;
  if (!sfRes.won) { result.trophy = 1; return result; }

  result.reachedChampionship = true;
  // doc §8, [Locked]: "the championship opponent is always the toughest team in the league" - the
  // strongest team is ALWAYS teams[teams.length-1] by makeLeague's own weakest..strongest order,
  // regardless of bracket model; only the SEMIFINAL opponent choice differs between models.
  const champTeam = teams[teams.length - 1];
  result.finalOpponentSlot = teams.indexOf(champTeam);
  const chHome = decidePlayoffHome(opts.playoffHome, seasonSeed, 'final', wins, winsForTeam(standings, champTeam));
  const chSeed = hashSeed('bb-stage-champ', league, tier, seasonSeed, opts.bracketModel, opts.playoffHome, opts.scheduleShape);
  const chRes = await playOneGame(league, settings, champTeam, playerAgent, playerTeam, chSeed >>> 0, chHome);
  result.wonChampionship = chRes.won;
  result.trophy = chRes.won ? 3 : 2;
  return result;
}

function modeOf(arr) {
  const counts = new Map();
  for (const v of arr) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, bestCount = -1;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

function fmtPct(v) { return v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`; }

async function runStagesConfig(league, settings, bracketModel, playoffHome, scheduleShape, standingsModel = 'rawWins7') {
  const seasons = [];
  for (let i = 0; i < SEASONS_N; i++) {
    seasons.push(await playSeasonStaged(league, settings, 'median', i, { bracketModel, playoffHome, scheduleShape, standingsModel }));
  }
  const homeGames = seasons.reduce((s, x) => s + x.homeGames, 0);
  const homeWins = seasons.reduce((s, x) => s + x.homeWins, 0);
  const awayGames = seasons.reduce((s, x) => s + x.awayGames, 0);
  const awayWins = seasons.reduce((s, x) => s + x.awayWins, 0);
  const top4Rate = seasons.filter((s) => s.madePlayoffs).length / seasons.length;
  const seedCounts = {};
  for (const s of seasons) { const k = s.seed + 1; seedCounts[k] = (seedCounts[k] || 0) + 1; }
  const sfPlayed = seasons.filter((s) => s.madePlayoffs);
  const sfWinRate = sfPlayed.length ? sfPlayed.filter((s) => s.semifinalWon).length / sfPlayed.length : null;
  const sfSlot = modeOf(sfPlayed.map((s) => s.semifinalOpponentSlot));
  const finalPlayed = seasons.filter((s) => s.reachedChampionship);
  const finalWinRate = finalPlayed.length ? finalPlayed.filter((s) => s.wonChampionship).length / finalPlayed.length : null;
  const finalSlot = modeOf(finalPlayed.map((s) => s.finalOpponentSlot));
  const goldRate = seasons.filter((s) => s.trophy === 3).length / seasons.length;
  const productRate = top4Rate * (sfWinRate || 0) * (finalWinRate || 0);
  return {
    homeWinRate: homeGames ? homeWins / homeGames : null,
    awayWinRate: awayGames ? awayWins / awayGames : null,
    top4Rate, seedCounts, sfSlot, sfWinRate, finalSlot, finalWinRate, goldRate, productRate,
  };
}

async function runStages(t0) {
  console.log(`sim-baseball.mjs --stages - SEASONS_N=${SEASONS_N}, tier=median, leagues=${LEAGUES.join(',')}`);
  console.log('measurement only - no engine change; every variant below is duplicated locally in this file.\n');
  for (const league of LEAGUES) {
    console.log(`=== ${league} (median tier) ===`);

    console.log('  bracket model (schedule=repeatTop, playoffHome=player):');
    for (const bracketModel of BRACKET_MODELS) {
      const r = await runStagesConfig(league, SETTINGS, bracketModel, 'player', 'repeatTop');
      console.log(`    ${bracketModel.padEnd(18)} regHome=${fmtPct(r.homeWinRate)} regAway=${fmtPct(r.awayWinRate)} top4=${fmtPct(r.top4Rate)} ` +
        `sfSlot=${r.sfSlot} sfWin=${fmtPct(r.sfWinRate)} finalSlot=${r.finalSlot} finalWin=${fmtPct(r.finalWinRate)} ` +
        `gold=${fmtPct(r.goldRate)} product=${fmtPct(r.productRate)} seeds=${JSON.stringify(r.seedCounts)}`);
    }

    console.log('  schedule shape (bracket=asCoded, playoffHome=player):');
    for (const scheduleShape of SCHEDULE_SHAPES) {
      const r = await runStagesConfig(league, SETTINGS, 'asCoded', 'player', scheduleShape);
      console.log(`    ${scheduleShape.padEnd(18)} regHome=${fmtPct(r.homeWinRate)} regAway=${fmtPct(r.awayWinRate)} top4=${fmtPct(r.top4Rate)} ` +
        `sfSlot=${r.sfSlot} sfWin=${fmtPct(r.sfWinRate)} finalSlot=${r.finalSlot} finalWin=${fmtPct(r.finalWinRate)} gold=${fmtPct(r.goldRate)}`);
    }

    console.log('  playoff home policy (bracket=asCoded, schedule=repeatTop):');
    for (const playoffHome of PLAYOFF_HOMES) {
      const r = await runStagesConfig(league, SETTINGS, 'asCoded', playoffHome, 'repeatTop');
      console.log(`    ${playoffHome.padEnd(18)} sfWin=${fmtPct(r.sfWinRate)} finalWin=${fmtPct(r.finalWinRate)} gold=${fmtPct(r.goldRate)}`);
    }

    console.log('  standings model (bracket=asCoded, schedule=repeatTop, playoffHome=player):');
    for (const standingsModel of STANDINGS_MODELS) {
      const r = await runStagesConfig(league, SETTINGS, 'asCoded', 'player', 'repeatTop', standingsModel);
      console.log(`    ${standingsModel.padEnd(18)} top4=${fmtPct(r.top4Rate)} gold=${fmtPct(r.goldRate)} seeds=${JSON.stringify(r.seedCounts)}`);
    }
    console.log('');
  }
  console.log(`wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------------------------
// BB-2d commit 1: `--range` - measurement only, no settings.js change. Three questions per league:
// (1) the batted-ball census (is a home run even possible, and how often), (2) the ceiling/floor -
// every lever pushed to its easiest/hardest extreme within the current contract (CPU_SIGMA_MIN_MS/
// CPU_SIGMA_ABSOLUTE_FLOOR_MS/CPU_PLACEMENT_MIN are never crossed) - and (3) a per-lever range,
// one factor at a time, so commits 2-7 know which levers actually move win rate before they touch
// any of them.
const RANGE_GAMES = 1000;
const RANGE_GAMES_N = Math.max(4, Math.round(FLAG_QUICK ? RANGE_GAMES / 10 : RANGE_GAMES));
const RANGE_LEVER_LEAGUE = 'college'; // matches CONTACT_GRID_LEAGUE/STYLE_MEASURE_LEAGUE's own default

function emptyCensus() { return { games: 0, pa: 0, homers: 0, triples: 0, doubles: 0, singles: 0, outs: 0, flyBalls: 0, flyHomers: 0, carries: [] }; }
function foldCensusPA(census, payload) {
  if (payload.outcome === 'strikeout' || payload.outcome === 'walk') { census.pa += 1; return; }
  census.pa += 1;
  const bases = payload.bases || 0;
  if (bases === 4) census.homers += 1;
  else if (bases === 3) census.triples += 1;
  else if (bases === 2) census.doubles += 1;
  else if (bases === 1) census.singles += 1;
  else census.outs += 1;
  if (payload.battedKind === 'fly') {
    census.flyBalls += 1;
    if (bases === 4) census.flyHomers += 1;
  }
  if (payload.distanceFt != null) census.carries.push(payload.distanceFt);
}
async function playOneGameForCensus(league, settings, opponent, playerAgent, playerTeam, seed, playerHome) {
  const home = playerHome ? playerTeam : opponent;
  const away = playerHome ? opponent : playerTeam;
  const homeAgent = playerHome ? playerAgent : mkCpuAgent(opponent, league, settings);
  const awayAgent = playerHome ? mkCpuAgent(opponent, league, settings) : playerAgent;
  const g = new Game({ home, away, seed, agents: { home: homeAgent, away: awayAgent }, settings });
  const playerSide = playerHome ? 'home' : 'away';
  const oppSide = playerHome ? 'away' : 'home';
  const census = { player: emptyCensus(), opp: emptyCensus() };
  g.onEvent = async (type, payload) => {
    if (type !== 'atBatEnd') return;
    if (payload.side === playerSide) foldCensusPA(census.player, payload);
    else if (payload.side === oppSide) foldCensusPA(census.opp, payload);
  };
  await g.playGame();
  census.player.games = 1; census.opp.games = 1;
  return census;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}
async function measureCensus(league, settings, gamesN) {
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];
  const skills = playerSkillsFor(league, settings);
  const total = { player: emptyCensus(), opp: emptyCensus() };
  for (let i = 0; i < gamesN; i++) {
    const agent = mkModelAgent(league, settings, MODEL_TIERS.median);
    const team = makePlayerTeam({ skills, hand: 'R' });
    const seed = hashSeed('bb-range-census', league, i);
    const { player, opp } = await playOneGameForCensus(league, settings, opponent, agent, team, seed >>> 0, i % 2 === 0);
    for (const key of ['games', 'pa', 'homers', 'triples', 'doubles', 'singles', 'outs', 'flyBalls', 'flyHomers']) {
      total.player[key] += player[key]; total.opp[key] += opp[key];
    }
    total.player.carries.push(...player.carries); total.opp.carries.push(...opp.carries);
  }
  return total;
}
function censusSummary(census, gamesN, fenceCenterFt) {
  return {
    homersPerGame: census.homers / gamesN,
    triplesPerGame: census.triples / gamesN,
    doublesPerGame: census.doubles / gamesN,
    singlesPerGame: census.singles / gamesN,
    outsPerGame: census.outs / gamesN,
    flyFenceShare: census.flyBalls ? census.flyHomers / census.flyBalls : 0,
    meanCarryFt: mean(census.carries),
    p95CarryFt: percentile(census.carries, 0.95),
    fenceCenterFt,
  };
}

/** Ceiling: the weakest ladder slot (index 0), every CPU behavior lever pushed to its easiest
 *  extreme WITHIN the current contract (CPU_SIGMA_MIN_MS is a per-league MINIMUM, never crossed
 *  upward-bounded here - sloppier CPU timing is always "easier" with no contract ceiling, so a
 *  generous 200ms stands in for "as sloppy as this measurement bothers to check"; cornerBias/
 *  patternWeight/weakSpotWeight/outZoneMult all have real bounds and are pushed to their easiest
 *  legal end). Floor: the strongest ladder slot (index 7), every lever at its hardest legal
 *  extreme - CPU_SIGMA_ABSOLUTE_FLOOR_MS/CPU_PLACEMENT_MIN are the two the contract itself pins,
 *  used here exactly (never crossed), cornerBias/patternWeight/weakSpotWeight at 1, outZoneMult at
 *  its own settings.js ceiling (1.05, `FIELD` header's own comment).
 */
function ceilingFloorSettings(league, extreme) {
  const easy = extreme === 'ceiling';
  return withOverrides(SETTINGS, [
    [`CPU.${league}.timingSigmaMs`, easy ? 200 : SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS],
    [`CPU.${league}.placementNoise`, easy ? 0.45 : SETTINGS.CPU_PLACEMENT_MIN],
    [`CPU.${league}.cornerBias`, easy ? 0 : 1],
    [`CPU.${league}.patternWeight`, easy ? 0 : 1],
    [`CPU.${league}.weakSpotWeight`, easy ? 0 : 1],
    [`CPU.${league}.chase`, easy ? 0.9 : 0.02],
    [`FIELD.${league}.outZoneMult`, easy ? 0.75 : 1.05],
  ]);
}
async function measureCeilingFloor(league) {
  const teams = makeLeague(league);
  const skills = playerSkillsFor(league, SETTINGS);
  const out = {};
  for (const [label, opponentTeam] of [['ceiling', teams[0]], ['floor', teams[teams.length - 1]]]) {
    const settings = ceilingFloorSettings(league, label);
    const rows = [];
    for (let i = 0; i < RANGE_GAMES_N; i++) {
      const agent = mkModelAgent(league, settings, MODEL_TIERS.median);
      const team = makePlayerTeam({ skills, hand: 'R' });
      const seed = hashSeed('bb-range-extreme', league, label, i);
      rows.push(await playOneGame(league, settings, opponentTeam, agent, team, seed >>> 0, i % 2 === 0));
    }
    out[label] = rows.filter((r) => r.won).length / rows.length;
  }
  return out;
}

/** Per-lever range: one factor at a time, min vs max, win rate at each - RANGE_LEVER_LEAGUE only
 *  (matches the existing convention of `--contact-grid`/`--styles` measuring at one representative
 *  league rather than all five). Every lever named by the handoff. */
async function measureLeverWinRate(league, settings) {
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];
  const skills = playerSkillsFor(league, settings);
  const rows = [];
  for (let i = 0; i < RANGE_GAMES_N; i++) {
    const agent = mkModelAgent(league, settings, MODEL_TIERS.median);
    const team = makePlayerTeam({ skills, hand: 'R' });
    const seed = hashSeed('bb-range-lever', league, i, JSON.stringify(settings.CPU[league]).length);
    rows.push(await playOneGame(league, settings, opponent, agent, team, seed >>> 0, i % 2 === 0));
  }
  return rows.filter((r) => r.won).length / rows.length;
}
async function measureLeverRange() {
  const league = RANGE_LEVER_LEAGUE;
  const levers = [
    ['outZoneMult', [0.75, 1.05], (v) => withOverride(SETTINGS, `FIELD.${league}.outZoneMult`, v)],
    ['fieldScale', [0.6, 1.10], (v) => withOverride(SETTINGS, `FIELD.${league}.fieldScale`, v)],
    ['cornerBias', [0, 1], (v) => withOverride(SETTINGS, `CPU.${league}.cornerBias`, v)],
    ['pitchMix.changeup share', [0, 4], (v) => withOverride(SETTINGS, `CPU.${league}.pitchMix`, { ...SETTINGS.CPU[league].pitchMix, changeup: v })],
    ['patternWeight', [0, 1], (v) => withOverride(SETTINGS, `CPU.${league}.patternWeight`, v)],
    ['weakSpotWeight', [0, 1], (v) => withOverride(SETTINGS, `CPU.${league}.weakSpotWeight`, v)],
    ['chase', [0.9, 0.02], (v) => withOverride(SETTINGS, `CPU.${league}.chase`, v)],
    ['CPU sigma (within contract)', [200, SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS], (v) => withOverride(SETTINGS, `CPU.${league}.timingSigmaMs`, v)],
    ['SPEED_SURPRISE_MS_PER_MULT', [0, 200], (v) => withOverride(SETTINGS, 'SPEED_SURPRISE_MS_PER_MULT', v)],
    ['human swingIn (median-tier own value)', [0.95, 0.65], (v) => v], // measured separately below - see humanOwnDiscipline
    ['human chase (median-tier own value)', [0.45, 0.05], (v) => v],  // measured separately below
  ];
  const results = [];
  for (const [name, [lo, hi], build] of levers) {
    if (name.startsWith('human ')) continue; // measured by measureHumanOwnDiscipline below
    const loRate = await measureLeverWinRate(league, build(lo));
    const hiRate = await measureLeverWinRate(league, build(hi));
    results.push({ name, lo, hi, loRate, hiRate });
  }
  for (const axis of ['skill', 'timingSigmaMs', 'chase']) {
    results.push({ name: `TEAM_LADDER_OFFSETS.${axis}`, lo: SETTINGS.TEAM_LADDER_OFFSETS[0][axis], hi: SETTINGS.TEAM_LADDER_OFFSETS[7][axis], note: 'see the within-league ladder check' });
  }
  return results;
}

/** BB-2d commit 1's own anticipation of commit 2: what does the human's OWN median-tier discipline
 *  (not the league's CPU row) do to win rate at this league, held fixed across every league rather
 *  than copied from `CPU[league].swingIn/chase`? Uses the Draft `MODEL_TIERS.median` values this
 *  commit proposes for commit 2 (swingIn 0.85, chase 0.22 - see commit 2's own header) purely as a
 *  MEASUREMENT here; `mkModelAgent` itself is not changed until commit 2. */
const HUMAN_MEDIAN_DISCIPLINE = { swingIn: 0.85, chase: 0.22 };
async function measureHumanOwnDiscipline(league) {
  const settings = SETTINGS;
  const teams = makeLeague(league);
  const opponent = teams[Math.floor(teams.length / 2)];
  const skills = playerSkillsFor(league, settings);
  const play = async (swingIn, chase) => {
    const rows = [];
    for (let i = 0; i < RANGE_GAMES_N; i++) {
      const batter = new ModelBatter({ timingSigmaMs: MODEL_TIERS.median.timingSigmaMs, placementSigma: MODEL_TIERS.median.placementSigma, swingIn, chase, settings });
      const pitcher = new ModelPitcher({ league, settings, variety: MODEL_TIERS.median.variety, cornerBias: settings.CPU[league].cornerBias, pitchMix: settings.CPU[league].pitchMix });
      const agent = { decidePitch: (v) => pitcher.decidePitch(v), decideSwing: (v) => batter.decideSwing(v) };
      const team = makePlayerTeam({ skills, hand: 'R' });
      const seed = hashSeed('bb-range-humandiscipline', league, i);
      rows.push(await playOneGame(league, settings, opponent, agent, team, seed >>> 0, i % 2 === 0));
    }
    return rows.filter((r) => r.won).length / rows.length;
  };
  const leagueRowRate = await play(settings.CPU[league].swingIn, settings.CPU[league].chase);
  const humanOwnRate = await play(HUMAN_MEDIAN_DISCIPLINE.swingIn, HUMAN_MEDIAN_DISCIPLINE.chase);
  return { leagueRowRate, humanOwnRate };
}

/** Shifters against the human, at every league, every tier, and once more with SHIFT_MAX_DEG=0. */
async function measureShiftersDelta(league) {
  const settings = SETTINGS;
  const teams = makeLeague(league);
  const shiftersTeam = teams.find((t) => t.styleId === 'shifters');
  const balancedTeam = teams.find((t) => t.styleId === 'balanced');
  const skills = playerSkillsFor(league, settings);
  const play = async (opponent, tier, settingsForGame, seedTag) => {
    const rows = [];
    for (let i = 0; i < RANGE_GAMES_N; i++) {
      const agent = mkModelAgent(league, settingsForGame, MODEL_TIERS[tier]);
      const team = makePlayerTeam({ skills, hand: 'R' });
      const seed = hashSeed('bb-range-shifters', league, tier, seedTag, i);
      rows.push(await playOneGame(league, settingsForGame, opponent, agent, team, seed >>> 0, i % 2 === 0));
    }
    return rows.filter((r) => r.won).length / rows.length;
  };
  const noShiftSettings = withOverride(settings, 'SHIFT_MAX_DEG', 0);
  const out = {};
  for (const tier of TIERS) {
    const shiftersRate = await play(shiftersTeam, tier, settings, `shifters-${tier}`);
    const balancedRate = await play(balancedTeam, tier, settings, `balanced-${tier}`);
    const shiftersRateNoShift = await play(shiftersTeam, tier, noShiftSettings, `shifters-noshift-${tier}`);
    out[tier] = { shiftersRate, balancedRate, delta: shiftersRate - balancedRate, shiftersRateNoShift };
  }
  return out;
}

async function runRange(t0) {
  console.log(`sim-baseball.mjs --range - RANGE_GAMES_N=${RANGE_GAMES_N}, leagues=${LEAGUES.join(',')}, lever league=${RANGE_LEVER_LEAGUE}`);
  console.log('measurement only - no settings.js change.\n');

  console.log('=== Batted-ball census (median tier, both sides, per game) ===');
  for (const league of LEAGUES) {
    const fenceCenterFt = SETTINGS.FIELD[league].fenceFt.center;
    const total = await measureCensus(league, SETTINGS, RANGE_GAMES_N);
    const playerS = censusSummary(total.player, RANGE_GAMES_N, fenceCenterFt);
    const oppS = censusSummary(total.opp, RANGE_GAMES_N, fenceCenterFt);
    console.log(`  ${league} (fence center ${fenceCenterFt}ft):`);
    console.log(`    player: HR/g=${playerS.homersPerGame.toFixed(3)} 3B/g=${playerS.triplesPerGame.toFixed(3)} 2B/g=${playerS.doublesPerGame.toFixed(3)} 1B/g=${playerS.singlesPerGame.toFixed(3)} out/g=${playerS.outsPerGame.toFixed(3)} flyClearsFence=${fmtPct(playerS.flyFenceShare)} meanCarry=${playerS.meanCarryFt.toFixed(0)}ft p95Carry=${playerS.p95CarryFt.toFixed(0)}ft`);
    console.log(`    opp:    HR/g=${oppS.homersPerGame.toFixed(3)} 3B/g=${oppS.triplesPerGame.toFixed(3)} 2B/g=${oppS.doublesPerGame.toFixed(3)} 1B/g=${oppS.singlesPerGame.toFixed(3)} out/g=${oppS.outsPerGame.toFixed(3)} flyClearsFence=${fmtPct(oppS.flyFenceShare)} meanCarry=${oppS.meanCarryFt.toFixed(0)}ft p95Carry=${oppS.p95CarryFt.toFixed(0)}ft`);
    if (playerS.homersPerGame === 0 && oppS.homersPerGame === 0) {
      console.log(`    **HOME RUNS IMPOSSIBLE AT ${league.toUpperCase()}** (fence ${fenceCenterFt}ft, p95 carry only ${playerS.p95CarryFt.toFixed(0)}ft)`);
    }
  }

  console.log('\n=== Ceiling/floor (median tier, every lever at its easiest/hardest legal extreme) ===');
  for (const league of LEAGUES) {
    const { ceiling, floor } = await measureCeilingFloor(league);
    const bold = league === 'little' && ceiling < 0.92 ? '  **BELOW 0.92**' : '';
    console.log(`  ${league.padEnd(12)} ceiling=${fmtPct(ceiling)}  floor=${fmtPct(floor)}${bold}`);
  }

  console.log(`\n=== Per-lever range (league=${RANGE_LEVER_LEAGUE}, median tier, vs average opponent) ===`);
  const leverRows = await measureLeverRange();
  for (const row of leverRows) {
    if (row.note) { console.log(`  ${row.name.padEnd(28)} lo=${row.lo} hi=${row.hi} (${row.note})`); continue; }
    console.log(`  ${row.name.padEnd(28)} lo=${row.lo}->${fmtPct(row.loRate)}  hi=${row.hi}->${fmtPct(row.hiRate)}`);
  }

  console.log(`\n=== Human's own discipline vs CPU league row (${RANGE_LEVER_LEAGUE}'s own row for reference; every league measured) ===`);
  for (const league of LEAGUES) {
    const { leagueRowRate, humanOwnRate } = await measureHumanOwnDiscipline(league);
    console.log(`  ${league.padEnd(12)} leagueRow(swingIn=${SETTINGS.CPU[league].swingIn},chase=${SETTINGS.CPU[league].chase})=${fmtPct(leagueRowRate)}  humanOwn(swingIn=${HUMAN_MEDIAN_DISCIPLINE.swingIn},chase=${HUMAN_MEDIAN_DISCIPLINE.chase})=${fmtPct(humanOwnRate)}`);
  }

  console.log('\n=== Shifters vs the human, every league, every tier (and with SHIFT_MAX_DEG=0) ===');
  for (const league of LEAGUES) {
    const byTier = await measureShiftersDelta(league);
    console.log(`  ${league}:`);
    for (const tier of TIERS) {
      const r = byTier[tier];
      console.log(`    ${tier.padEnd(8)} shifters=${fmtPct(r.shiftersRate)} balanced=${fmtPct(r.balancedRate)} delta=${(r.delta >= 0 ? '+' : '') + (r.delta * 100).toFixed(1)}pp  noShift=${fmtPct(r.shiftersRateNoShift)}`);
    }
  }

  console.log(`\nwall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const t0 = Date.now();

  if (FLAG_ATTRIBUTE) {
    await runAttribute(t0);
    return;
  }

  if (FLAG_RANGE) {
    await runRange(t0);
    return;
  }

  if (FLAG_STAGES) {
    await runStages(t0);
    return;
  }

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
      // BB-2c commit 3: this IS the STYLE_STRENGTH_DELTA measurement - every style at its own
      // TEAM_STYLES vector (the shipped, uncompressed weights - a "fixed middle slot", the same
      // effectiveCapFor(league) both `buildCandidateTeam` calls use), full behavior on (STYLE_BEHAVIOR
      // reads styleId regardless of ladder slot), against Balanced. `delta = winRate - 0.5` is what
      // `makeLeague` (teams.js) now subtracts from a style's own ladder slot budget, so a style's
      // measured strength - flavor AND behavior together - never has to be re-fought by hand-picking
      // which slot it sits in.
      console.log('\n  style          winRate (vs balanced)   delta (STYLE_STRENGTH_DELTA)');
      const deltas = {};
      for (const id of styleIds) {
        const winRate = await measureStyleWinRate(id, SETTINGS.TEAM_STYLES[id], league, SETTINGS, STYLE_MEASURE_GAMES);
        const delta = winRate - 0.5;
        deltas[id] = delta;
        const inBand = Math.abs(delta) <= STYLE_STRENGTH_BAND;
        if (!inBand) anyOut = true;
        console.log(`  ${id.padEnd(14)} ${(winRate * 100).toFixed(1).padStart(5)}%${inBand ? '' : '  [OUT OF BAND]'}                    ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`);
      }
      console.log('\n  STYLE_STRENGTH_DELTA (paste into settings.js):');
      console.log('  ' + JSON.stringify(deltas, null, 2).split('\n').join('\n  '));
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

  // BB-2b commit 2: these three lines used to report the MEDIAN across leagues, which a small
  // number of easy leagues (Little/High School) could drag comfortably over the threshold while
  // the leagues that actually matter (College/Minors/Majors, per commit 1's own `--stages`
  // decomposition) stayed badly broken - majors measured a 0.3% top-4 rate under the un-retuned
  // ladder, invisible to a median across five leagues. `worstAcross` reports the single WORST
  // league instead, so the scoreboard cannot pass while any one league is still failing the
  // player.
  const worstAcross = (fn, worseIsHigher) => {
    const values = LEAGUES.map((lg) => fn(report.leagues[lg].default.seasonStats.median));
    return worseIsHigher ? Math.max(...values) : Math.min(...values);
  };
  if (report.leagues[LEAGUES[0]].default) {
    // BB-2c: design doc v9 §8, [Locked] - a per-league regular-season win-rate BAND, not a flat
    // "gold in two seasons everywhere." Every league must land inside its own band; a single FAIL
    // anywhere fails this line (there is no "worst league" reduction here - each league's band is
    // already specific to it).
    for (const lg of LEAGUES) {
      const [lo, hi] = SEASON_WINRATE_BAND[lg];
      const rate = report.leagues[lg].default.seasonStats.median.seasonWinRate;
      scoreLine(`SEASON_WINRATE_BAND.${lg} (median tier, regular season)`, rate >= lo && rate <= hi,
        rate.toFixed(3), `[${lo}, ${hi}]`);
    }
    // Seasons to Gold is a CONSEQUENCE of the win-rate band above, still asserted (per league, with
    // SEASONS_TO_GOLD_TOLERANCE), never chased directly by retuning Gold odds on their own.
    for (const lg of LEAGUES) {
      const target = SEASONS_TO_GOLD_TARGET[lg];
      const measured = report.leagues[lg].default.seasonStats.median.expectedSeasonsToGold;
      const ok = measured <= target + SEASONS_TO_GOLD_TOLERANCE;
      scoreLine(`SEASONS_TO_GOLD_TARGET.${lg} (median tier)`, ok,
        measured === Infinity ? 'inf' : measured.toFixed(2), `<= ${target} + ${SEASONS_TO_GOLD_TOLERANCE}`);
    }

    const champRates = LEAGUES.map((lg) => report.leagues[lg].default.seasonStats.median.champWinRate).filter((v) => v != null);
    const worstChamp = champRates.length ? Math.min(...champRates) : null;
    scoreLine('CHAMPION_GAME_WIN_MIN_MEDIAN (worst league)', worstChamp != null && worstChamp >= CHAMPION_GAME_WIN_MIN_MEDIAN,
      worstChamp == null ? 'n/a (no sample reached the championship)' : worstChamp.toFixed(3), `>= ${CHAMPION_GAME_WIN_MIN_MEDIAN}`);

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

    // BB-2c, design doc v9 §8, [Locked]: "the weakest opponent is beaten at 85% or better and the
    // champion sits between 40 and 55%" - the ladder's own two endpoints, at every league.
    const weakestOk = LEAGUES.every((lg) => ladderRatesByLeague[lg][0] >= SLOT_WINRATE_WEAKEST_MIN);
    scoreLine('SLOT_WINRATE_BAND (weakest opponent >= 85% at every league)', weakestOk,
      JSON.stringify(LEAGUES.map((lg) => +ladderRatesByLeague[lg][0].toFixed(3))), `every value >= ${SLOT_WINRATE_WEAKEST_MIN}`);
    const championBandOk = LEAGUES.every((lg) => {
      const champ = ladderRatesByLeague[lg][ladderRatesByLeague[lg].length - 1];
      return champ >= SLOT_WINRATE_CHAMPION_MIN && champ <= SLOT_WINRATE_CHAMPION_MAX;
    });
    scoreLine('SLOT_WINRATE_BAND (champion in [0.40, 0.55] at every league)', championBandOk,
      JSON.stringify(LEAGUES.map((lg) => +ladderRatesByLeague[lg][ladderRatesByLeague[lg].length - 1].toFixed(3))),
      `every value in [${SLOT_WINRATE_CHAMPION_MIN}, ${SLOT_WINRATE_CHAMPION_MAX}]`);

    // BB-2b commit 5: CHAMPION_IS_HARDEST - doc §8, [Locked]: "the championship opponent is always
    // the toughest team in the league" is only a real promise if the strongest ladder slot (index
    // 7, the last column above) is ALSO the lowest win rate of any opponent within that league -
    // otherwise a player could face an "easier" team in the final than one they already beat in
    // the regular season, which would make the doc's own wording false even with the bracket fixed.
    const championIsHardestOk = LEAGUES.every((lg) => {
      const rates = ladderRatesByLeague[lg];
      const champion = rates[rates.length - 1];
      return rates.every((v) => champion <= v + LADDER_TOLERANCE);
    });
    scoreLine('CHAMPION_IS_HARDEST (the strongest ladder slot is the lowest win rate of any opponent)', championIsHardestOk,
      'see the within-league ladder check above', `champion's win rate <= every other slot's, within ${LADDER_TOLERANCE}`);
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
