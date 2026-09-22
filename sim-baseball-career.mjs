// sim-baseball-career.mjs : DOES THE CAREER LADDER ACTUALLY CLIMB? R16
// (docs/BASEBALL-3D-BUILD.md section 9, "the career economy, rebuilt from measurement").
//
// `sim-baseball.mjs` measures ONE SEASON at a fixed, assumed skill level. This plays WHOLE
// CAREERS: the player starts at the start build, earns points from real results, spends them,
// gets stronger, and climbs (or replays) the ladder until a World Series title or the season cap.
// That is the only way to answer the question the design doc actually asks - "Winning the World
// Series in the majors should take at least 2 seasons" (Matt, 2026-09-22) - because a career
// player is a different, stronger player every season and a fixed-skill season measurement can
// never see it. Measured before R16: the shipped economy gave a median player a first-attempt
// Gold 99 / 97 / 79 / 68 / 51 percent down the ladder and a World Series in six seasons, every
// single time.
//
// IT DRIVES THE REAL CODE, not a mirror of it. The career rules are `baseball/js/engine/career.js`
// (`newCareer`, `startSeason`, `nextGame`, `finishGame`, `buildGame`, `spend`), the season shape
// is `season.js`, the teams are `teams.js`, and every game is a real `Game` played out pitch by
// pitch by the real CPU agents. The study version of this tool (the session scratchpad's
// `econ/career-sim.mjs`) mirrored career.js because most of what it needed did not exist yet;
// everything it mirrored exists now and is imported here instead.
//
// WHAT IT CANNOT SEE, stated because a number this tool prints is easy to over-read: the model
// human swings CONTACT or POWER and nothing else. It never steals, never bunts, never attempts a
// pickoff. So `hitSpd` - whose whole asymmetric mechanic is the steal - is invisible to every
// number below, and this tool cannot be used to argue that skill is fine.
//
//   node sim-baseball-career.mjs [--careers N] [--tier weak|median|strong] [--all-tiers]
//        [--perfect N] [--assert] [--json out.json] [--seed S] [--seasons-cap N]
//
// It REPORTS; `--assert` is the phase gate, and like `sim-baseball.mjs --assert` it is
// deliberately NOT in `run-all-tests.mjs` - 150 careers is about a minute, not a second.

import fs from 'fs';
import {
  newCareer, startSeason, nextGame, finishGame, buildGame, spend, leagueTeams,
} from './baseball/js/engine/career.js';
import { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher } from './baseball/js/engine/agents.js';
import { hashSeed } from './baseball/js/engine/rng.js';
import * as SETTINGS from './baseball/js/engine/settings.js';

const LEAGUES = SETTINGS.LEAGUES;
const SKILL_IDS = SETTINGS.SKILL_IDS;

// ---------------------------------------------------------------------------------------------
// CLI
function arg(name, dflt) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : dflt; }
const FLAG_ASSERT = process.argv.includes('--assert');
const FLAG_ALL_TIERS = process.argv.includes('--all-tiers');
const CAREERS = Math.max(1, Number(arg('careers', 150)));
const PERFECT_N = Math.max(0, Number(arg('perfect', 0)));
const SEED0 = Number(arg('seed', 1));
const SEASON_CAP = Math.max(1, Number(arg('seasons-cap', 25)));
const ARG_JSON = arg('json', null);
const TIERS = FLAG_ALL_TIERS ? ['weak', 'median', 'strong'] : [arg('tier', 'median')];

// ---------------------------------------------------------------------------------------------
// The human model. Copied from `sim-baseball.mjs`'s own MODEL_TIERS so the two tools speak the
// same three tiers - a number from one is comparable with a number from the other.
const MODEL_TIERS = {
  weak:   { timingSigmaMs: 85, placementSigma: 0.35, variety: 0.3, swingIn: 0.85, chase: 0.35 },
  median: { timingSigmaMs: 55, placementSigma: 0.22, variety: 0.6, swingIn: 0.85, chase: 0.22 },
  strong: { timingSigmaMs: 35, placementSigma: 0.12, variety: 0.85, swingIn: 0.88, chase: 0.12 },
};

// ---------------------------------------------------------------------------------------------
// The assertion bands (R16 spec item 6). Every one is a MEASURED band, not an aspiration: the
// study that set them is the proposal of 2026-09-22, whose median-tier measurements were
// 99 / 83 / 52 / 36 / 11 percent first-attempt Gold, a median of 11 seasons to the first World
// Series and 5 Majors seasons before it. The bands are wider than those numbers on purpose - the
// three engine fixes R16 ships (the flight-time window, the aim compensation, the corner aim)
// landed after the study measured, and a band that only passes at the exact number it was set
// from is a band that gets edited rather than believed.
const BANDS = {
  firstAttemptGold: {
    little:     [0.90, 1.00],
    highschool: [0.70, 0.95],   // R16 ship review: Matt's brief is "win first time" in the lower leagues; 0.90 was the study's own translation, not his
    college:    [0.40, 0.65],
    minors:     [0.25, 0.45],
    majors:     [0.00, 0.15],
  },
  seasonsToTitleMedian: [8, 13],
  majorsSeasonsMedian: [2, Infinity],
  perfectSeason: [0.02, 0.12],
};

// ---------------------------------------------------------------------------------------------
// small helpers
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
/** Wilson score 95% interval for k successes of n - this tool reports intervals at all because of
 *  audit finding 3 of the study: "4 of 30 Golds" is a 5 to 30 percent interval, so a quick run
 *  cannot decide anything. */
function wilson95(k, n) {
  if (!n) return [0, 1];
  const z = 1.959964, p = k / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;

// ---------------------------------------------------------------------------------------------
// Agents. `mkCpuAgent` is `sim-baseball.mjs`'s, verbatim - the CPU here must be the CPU the
// shipped game builds. `mkModelAgent` is its model human WITH `skills` passed, which is what turns
// POWER mode on (audit finding 5: the shipped simulator never passes them, so its human swings
// CONTACT at every pitch of every measurement it has ever printed).
function mkCpuAgent(team, league) {
  return {
    decidePitch: (v) => new CpuPitcher({ league, settings: SETTINGS, ladderOffset: team.ladderOffset }).decidePitch(v),
    decideSwing: (v) => {
      const batter = team.players.find((p) => p.id === v.batterId) || team.players[0];
      return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS, styleId: team.styleId,
        ladderOffset: team.ladderOffset }).decideSwing(v);
    },
  };
}
function mkModelAgent(league, tier, skills) {
  const cpu = SETTINGS.CPU[league] || SETTINGS.CPU.college;
  const batter = new ModelBatter({
    timingSigmaMs: tier.timingSigmaMs, placementSigma: tier.placementSigma,
    swingIn: tier.swingIn, chase: tier.chase, settings: SETTINGS, skills,
  });
  const pitcher = new ModelPitcher({ league, settings: SETTINGS, variety: tier.variety,
    cornerBias: cpu.cornerBias, pitchMix: cpu.pitchMix });
  return { decidePitch: (v) => pitcher.decidePitch(v), decideSwing: (v) => batter.decideSwing(v) };
}

// ---------------------------------------------------------------------------------------------
/** Play the ONE game `nextGame(state)` says is next, through the real engine, and fold it back in
 *  with the real `finishGame`. A FRESH agent per game, deliberately: audit finding 6 is that
 *  `sim-baseball.mjs` reuses one across a whole season, so its ModelPitcher's `_lastType` leaks
 *  across game boundaries and its variety model measures something no real game does. */
async function playNext(state, tier) {
  const meta = nextGame(state);
  if (!meta) return null;
  const teams = leagueTeams(state);
  const opponent = teams[meta.opponentIndex];
  const league = state.season.league;
  const playerAgent = mkModelAgent(league, tier, state.player.skills);
  const cpuAgent = mkCpuAgent(opponent, league);
  const agents = meta.home ? { home: playerAgent, away: cpuAgent } : { home: cpuAgent, away: playerAgent };
  const g = buildGame(state, meta, agents);
  await g.playGame();
  const side = meta.home ? 'home' : 'away';
  const you = meta.home ? g.score.home : g.score.away;
  const cpu = meta.home ? g.score.away : g.score.home;
  const out = finishGame(state, { won: g.winner === side, you, cpu, meta });
  return { ...out, meta, you, cpu };
}

/** The spend policy: LOWEST SKILL FIRST, until nothing more can be spent. The study measured this
 *  against preset-proportional spending and the two were identical, so this is the simple one. */
function spendAll(state) {
  let st = state;
  for (let guard = 0; guard < 1000 && st.unspent > 0; guard++) {
    let pick = null, low = Infinity;
    for (const id of SKILL_IDS) {
      const v = st.player.skills[id] || 0;
      if (v >= st.cap) continue;
      if (v < low) { low = v; pick = id; }
    }
    if (!pick) break;
    const next = spend(st, pick);
    if (next === st) break;
    st = next;
  }
  return st;
}

/** One whole career, through the real rules, until a World Series title or the season cap. */
async function playCareer(tier, careerSeed) {
  const startSkills = { ...SETTINGS.PRESETS.twoWayStar };
  let st = newCareer({ hand: 'R', presetId: 'twoWayStar', skills: startSkills, now: 0,
    careerId: `SIM-${careerSeed}` });
  const perLeague = Object.fromEntries(LEAGUES.map((lg) => [lg, {
    seasons: 0, firstAttemptGold: null, winRates: [], arrivalSkills: null,
    pointsEarned: 0, pointsLost: 0, runsFor: [], runsAgainst: [],
  }]));
  const seasons = [];
  let totalGames = 0;

  while (st.seasonsPlayed < SEASON_CAP) {
    const league = st.league;
    const L = perLeague[league];
    if (L.arrivalSkills == null) L.arrivalSkills = { ...st.player.skills };
    const before = { earned: st.pointsEarned, lost: st.pointsLost };
    st = startSeason(st, hashSeed('sim-career-season', careerSeed, st.seasonsPlayed + 1) >>> 0);
    let wins = 0, losses = 0, trophy = 0, resolved = false;
    for (let guard = 0; guard < 64 && !resolved; guard++) {
      const out = await playNext(st, tier);
      if (!out) break;
      st = spendAll(out.state);
      totalGames += 1;
      if (out.meta.kind === 'regular') {
        if (out.record.won) wins += 1; else losses += 1;
        L.runsFor.push(out.you); L.runsAgainst.push(out.cpu);
      }
      if (out.resolved) { resolved = true; trophy = out.trophy; }
    }
    st = spendAll(st);
    L.seasons += 1;
    L.winRates.push(wins / Math.max(1, wins + losses));
    if (L.firstAttemptGold == null) L.firstAttemptGold = (trophy === 3);
    L.pointsEarned += st.pointsEarned - before.earned;
    L.pointsLost += st.pointsLost - before.lost;
    seasons.push({ league, n: st.seasonsPlayed, wins, losses, trophy });
    if (st.wsTitles > 0) break;   // stop at the first World Series, per the brief
  }
  return { st, perLeague, seasons, totalGames, titled: st.wsTitles > 0,
    seasonsToTitle: st.wsTitles > 0 ? st.seasonsPlayed : null };
}

/** ONE Majors season at MAXED skills and the given tier - doc section 5, [Locked]: a Perfect
 *  Season is every regular AND playoff game of a Majors season won. Built by handing `newCareer` a
 *  maxed build and putting it straight onto the Majors rung, so the season it plays is the real
 *  one (real schedule, real bracket, real opponents) rather than a hand-rolled copy of it. */
async function playPerfectProbe(tier, seed) {
  const cap = SETTINGS.CAPS.majors;
  const skills = Object.fromEntries(SKILL_IDS.map((id) => [id, cap]));
  let st = newCareer({ hand: 'R', presetId: 'maxed', skills, now: 0, careerId: `PERFECT-${seed}` });
  st = { ...st, league: 'majors', cap, bestLeague: LEAGUES.length };
  st = startSeason(st, hashSeed('sim-career-perfect', seed) >>> 0);
  let losses = 0, trophy = 0;
  for (let guard = 0; guard < 64; guard++) {
    const out = await playNext(st, tier);
    if (!out) break;
    st = out.state;
    if (!out.record.won) losses += 1;
    if (out.resolved) { trophy = out.trophy; break; }
  }
  return { perfect: losses === 0 && trophy === 3 };
}

// ---------------------------------------------------------------------------------------------
async function runTier(tierName, careers) {
  const tier = MODEL_TIERS[tierName];
  if (!tier) throw new Error(`unknown tier: ${tierName} (weak|median|strong)`);
  const t0 = Date.now();
  const rows = [];
  for (let i = 0; i < careers; i++) {
    rows.push(await playCareer(tier, hashSeed('sim-career', tierName, SEED0, i) >>> 0));
  }
  const out = { tier: tierName, careers, leagues: {}, elapsedS: 0 };
  for (const lg of LEAGUES) {
    const reached = rows.filter((r) => r.perLeague[lg].seasons > 0);
    const fa = reached.filter((r) => r.perLeague[lg].firstAttemptGold === true).length;
    const arrivals = reached.map((r) => r.perLeague[lg].arrivalSkills).filter(Boolean);
    const arrivalMean = Object.fromEntries(SKILL_IDS.map((id) =>
      [id, arrivals.length ? mean(arrivals.map((a) => a[id] || 0)) : 0]));
    out.leagues[lg] = {
      reached: reached.length,
      firstAttemptGold: reached.length ? fa / reached.length : null,
      firstAttemptGoldCI: wilson95(fa, reached.length),
      seasonsMedian: median(reached.map((r) => r.perLeague[lg].seasons)),
      seasonsMean: mean(reached.map((r) => r.perLeague[lg].seasons)),
      winRate: mean(reached.flatMap((r) => r.perLeague[lg].winRates)),
      pointsPerSeason: mean(reached.map((r) => r.perLeague[lg].pointsEarned / Math.max(1, r.perLeague[lg].seasons))),
      pointsLostPerSeason: mean(reached.map((r) => r.perLeague[lg].pointsLost / Math.max(1, r.perLeague[lg].seasons))),
      runsFor: mean(reached.flatMap((r) => r.perLeague[lg].runsFor)),
      runsAgainst: mean(reached.flatMap((r) => r.perLeague[lg].runsAgainst)),
      arrivalSkills: arrivalMean,
      games: SETTINGS.gamesForLeague(lg),
    };
  }
  const titled = rows.filter((r) => r.titled);
  out.titledRate = titled.length / rows.length;
  out.titledCI = wilson95(titled.length, rows.length);
  out.seasonsToTitleMedian = median(titled.map((r) => r.seasonsToTitle));
  out.seasonsToTitleMean = mean(titled.map((r) => r.seasonsToTitle));
  const majorsSeasons = rows.filter((r) => r.perLeague.majors.seasons > 0).map((r) => r.perLeague.majors.seasons);
  out.majorsSeasonsMedian = median(majorsSeasons);
  out.majorsReached = majorsSeasons.length;
  out.gamesPerCareer = mean(rows.map((r) => r.totalGames));
  out.elapsedS = (Date.now() - t0) / 1000;
  return out;
}

async function runPerfect(n) {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = await playPerfectProbe(MODEL_TIERS.strong, hashSeed('sim-career-pf', SEED0, i) >>> 0);
    if (r.perfect) k += 1;
  }
  return { rate: k / n, ci: wilson95(k, n), n };
}

function printRun(out) {
  console.log(`\n=== tier ${out.tier} / N=${out.careers} careers (${out.elapsedS.toFixed(1)}s, ${out.gamesPerCareer.toFixed(0)} games per career) ===`);
  console.log('league       games  reached  1st-Gold  95% CI             seasons med/mean  winRate  pts/s  lost/s  runs for-against  arrival');
  for (const lg of LEAGUES) {
    const r = out.leagues[lg];
    const ci = `[${pct(r.firstAttemptGoldCI[0])},${pct(r.firstAttemptGoldCI[1])}]`;
    const arr = mean(SKILL_IDS.map((id) => r.arrivalSkills[id])).toFixed(1);
    console.log(`${lg.padEnd(12)} ${String(r.games).padStart(5)}  ${String(r.reached).padStart(7)}  ${(r.firstAttemptGold == null ? 'n/a' : pct(r.firstAttemptGold)).padStart(8)}  ${ci.padEnd(17)} ${r.seasonsMedian.toFixed(1).padStart(6)}/${r.seasonsMean.toFixed(2).padStart(5)}    ${pct(r.winRate).padStart(6)} ${r.pointsPerSeason.toFixed(1).padStart(6)}  ${r.pointsLostPerSeason.toFixed(1).padStart(5)}  ${r.runsFor.toFixed(1).padStart(6)}-${r.runsAgainst.toFixed(1).padEnd(5)}  ${arr}`);
  }
  console.log(`first World Series title: ${pct(out.titledRate)} of careers inside ${SEASON_CAP} seasons [${pct(out.titledCI[0])},${pct(out.titledCI[1])}], median ${out.seasonsToTitleMedian.toFixed(1)} / mean ${out.seasonsToTitleMean.toFixed(2)} seasons; Majors seasons median ${out.majorsSeasonsMedian.toFixed(1)} (${out.majorsReached} careers reached the Majors)`);
}

// ---------------------------------------------------------------------------------------------
const report = { generatedAt: new Date().toISOString(), careers: CAREERS, seed: SEED0, tiers: {}, perfect: null };
for (const t of TIERS) {
  const out = await runTier(t, CAREERS);
  report.tiers[t] = out;
  printRun(out);
}
if (PERFECT_N || FLAG_ASSERT) {
  const n = PERFECT_N || 200;
  const pf = await runPerfect(n);
  report.perfect = pf;
  console.log(`\nPerfect Season (maxed skills, strong tier, N=${pf.n}): ${pct(pf.rate)} [${pct(pf.ci[0])},${pct(pf.ci[1])}]`);
}
if (ARG_JSON) {
  fs.writeFileSync(ARG_JSON, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${ARG_JSON}`);
}

if (FLAG_ASSERT) {
  const med = report.tiers.median;
  let failed = 0;
  const score = (name, pass, got, want) => {
    if (!pass) failed += 1;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${String(got).padStart(10)}  want ${want}`);
  };
  console.log('\n--- assertions (median tier) ---');
  if (!med) {
    console.log('  FAIL  --assert needs the median tier (run without --tier, or with --all-tiers)');
    process.exit(1);
  }
  if (med.careers < 150) {
    console.log(`  NOTE  N=${med.careers} careers: the intervals are wider than the bands. R16 asks for N >= 150.`);
  }
  for (const lg of LEAGUES) {
    const [lo, hi] = BANDS.firstAttemptGold[lg];
    const v = med.leagues[lg].firstAttemptGold;
    score(`FIRST_ATTEMPT_GOLD ${lg}`, v != null && v >= lo && v <= hi,
      v == null ? 'n/a' : v.toFixed(3), `${lo} to ${hi}`);
  }
  const [sLo, sHi] = BANDS.seasonsToTitleMedian;
  score('SEASONS_TO_FIRST_TITLE (median)', med.seasonsToTitleMedian >= sLo && med.seasonsToTitleMedian <= sHi,
    med.seasonsToTitleMedian.toFixed(1), `${sLo} to ${sHi}`);
  score('MAJORS_SEASONS_BEFORE_TITLE (median)', med.majorsSeasonsMedian >= BANDS.majorsSeasonsMedian[0],
    med.majorsSeasonsMedian.toFixed(1), `>= ${BANDS.majorsSeasonsMedian[0]}`);
  if (report.perfect) {
    const [pLo, pHi] = BANDS.perfectSeason;
    score('PERFECT_SEASON (maxed, strong)', report.perfect.rate >= pLo && report.perfect.rate <= pHi,
      report.perfect.rate.toFixed(3), `${pLo} to ${pHi}`);
  }
  console.log(failed ? `\n${failed} assertion(s) FAILED` : '\nall assertions PASS');
  process.exit(failed ? 1 : 0);
}
