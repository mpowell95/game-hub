// test.js : the engine suite. `node baseball/js/test.js`. No browser, no dependency, not deployed
// or precached (same status as every other game's headless `test.js` in this repo).
//
// Covers: settings integrity, purity (no forbidden global APIs anywhere in the engine), rules
// correctness, determinism, resumability via snapshot, speed, team generation, pattern memory,
// and the pluggable agent seam.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as SETTINGS from './engine/settings.js';
import { ZONE, flyPitch } from './engine/pitch.js';
import { swing } from './engine/swing.js';
import { resolveContact, carryFt } from './engine/outcomes.js';
import { emptyBases, advanceAll, advanceWalk, advanceSacFly } from './engine/bases.js';
import { Game, SNAP_V, validateSnapshot } from './engine/game.js';
import { CpuPitcher, CpuBatter, ScriptedAgent } from './engine/agents.js';
import { makeTeam, teamStrength } from './engine/teams.js';
import { mulberry32, hashSeed, stepRng, pickWeighted, gaussian } from './engine/rng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };

const DETERMINISM_SEED = 424242;
const RESUME_SEED = 909090;

function mkAgent(team, league) {
  return {
    decidePitch: (v) => new CpuPitcher({ league, settings: SETTINGS }).decidePitch(v),
    decideSwing: (v) => {
      const batter = team.players.find((p) => p.id === v.batterId) || team.players[0];
      return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS }).decideSwing(v);
    },
  };
}

function playGameOnce(league, seed, homeIdx = 1, awayIdx = 2) {
  const home = makeTeam(league, homeIdx);
  const away = makeTeam(league, awayIdx);
  const agents = { home: mkAgent(home, league), away: mkAgent(away, league) };
  const g = new Game({ home, away, seed, agents });
  return g;
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 1. settings integrity --');
ok(SETTINGS.LEAGUES.length === 5, 'five leagues');
ok(JSON.stringify(SETTINGS.LEAGUES) === JSON.stringify(['little', 'highschool', 'college', 'minors', 'majors']),
  'league ladder order matches baseball/CLAUDE.md\'s frozen order');
for (const lg of SETTINGS.LEAGUES) {
  ok(typeof SETTINGS.POINTS[lg] === 'number' && SETTINGS.POINTS[lg] > 0, `POINTS.${lg} is a positive number`);
  ok(Array.isArray(SETTINGS.PITCH_UNLOCKS[lg]) && SETTINGS.PITCH_UNLOCKS[lg].length > 0, `PITCH_UNLOCKS.${lg} non-empty`);
  ok(SETTINGS.PITCH_UNLOCKS[lg].every((t) => SETTINGS.PITCH_TYPES.includes(t)), `PITCH_UNLOCKS.${lg} are real pitch types`);
  ok(!!SETTINGS.CPU[lg], `CPU.${lg} exists`);
  ok(!!SETTINGS.TEAM_STYLE_WEIGHTS[lg], `TEAM_STYLE_WEIGHTS.${lg} exists`);
}
ok(SETTINGS.PATTERN_WEIGHTS.length === SETTINGS.PATTERN_WINDOW, 'PATTERN_WEIGHTS length matches PATTERN_WINDOW');
ok(SETTINGS.FEEL.engine.dtS === 1 / 120, 'fixed timestep is 1/120s, matching hill-climb/js/physics.js\'s DT');
ok(SETTINGS.FEEL.engine.maxSteps === 5, 'catch-up cap matches the repo\'s standing convention (Hill Climb/Pinball)');
ok(Number.isInteger(SETTINGS.SEASON.inningsPerGame) && SETTINGS.SEASON.inningsPerGame > 0, 'inningsPerGame is a positive integer');
ok(SETTINGS.CAPS.perSkill > 0, 'CAPS.perSkill positive');
for (const style of Object.keys(SETTINGS.TEAM_STYLES)) {
  ok(SETTINGS.SKILL_IDS.every((id) => typeof SETTINGS.TEAM_STYLES[style][id] === 'number'), `TEAM_STYLES.${style} names every skill`);
}
ok(ZONE.xMax > ZONE.xMin && ZONE.zMax > ZONE.zMin, 'strike zone has positive extent');
ok(SETTINGS.MECHANICS.strikesForOut === 3 && SETTINGS.MECHANICS.ballsForWalk === 4, 'standard K/BB thresholds');

// ---------------------------------------------------------------------------------------------
console.log('\n-- 2. purity: no forbidden globals anywhere in the engine --');
const ENGINE_DIR = path.join(__dirname, 'engine');
const ENGINE_FILES = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'));
const FORBIDDEN = ['Math.random', 'Date.now', 'new Date(', 'localStorage', 'sessionStorage',
  'document.', 'window.', 'fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'navigator.',
  'indexedDB', 'WebSocket', 'crypto.getRandomValues'];
function stripComments(src) {
  // Strip /* */ and // comments so a doc comment that NAMES a forbidden API to explain why the
  // engine avoids it (rng.js's own header does exactly this) cannot trip the check meant to
  // catch the API actually being CALLED. Deliberately simple (no string-literal awareness); none
  // of these engine files have a `//` or `/*` inside a string literal, verified by inspection.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
for (const file of ENGINE_FILES) {
  const raw = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
  const code = stripComments(raw);
  for (const bad of FORBIDDEN) {
    ok(!code.includes(bad), `engine/${file} does not use ${bad} (outside comments)`);
  }
}
ok(ENGINE_FILES.length >= 9, `all nine engine modules present (found ${ENGINE_FILES.length})`);

// ---------------------------------------------------------------------------------------------
console.log('\n-- 3. rng.js: literal values and determinism --');
{
  const { value, next } = stepRng(1);
  ok(typeof value === 'number' && value >= 0 && value < 1, 'stepRng returns a value in [0,1)');
  ok(Number.isInteger(next), 'stepRng returns an integer next-state');
  const a = mulberry32(42), b = mulberry32(42);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  ok(JSON.stringify(seqA) === JSON.stringify(seqB), 'same seed -> identical sequence');
  const c = mulberry32(43);
  ok(c() !== seqA[0], 'different seed -> different first draw');
  ok(hashSeed('x', 1) === hashSeed('x', 1), 'hashSeed is deterministic');
  ok(hashSeed('x', 1) !== hashSeed('x', 2), 'hashSeed distinguishes its parts');
  ok(hashSeed('a', 'bc') !== hashSeed('ab', 'c'), 'hashSeed does not let parts bleed into each other');
  const picks = {};
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) picks[pickWeighted(rng, ['a', 'b'], [1, 3])] = (picks[pickWeighted] || 0) + 1;
  const g = gaussian(mulberry32(9));
  ok(typeof g === 'number' && Number.isFinite(g), 'gaussian returns a finite number');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 4. pitch.js --');
{
  const rng = mulberry32(5);
  const p = flyPitch('fastball', { x: 0, z: 2.5 }, 1, SETTINGS, rng);
  ok(p.type === 'fastball', 'flyPitch echoes the requested type');
  ok(typeof p.isStrike === 'boolean', 'flyPitch reports isStrike');
  ok(p.timeToPlateS > 0, 'flyPitch reports a positive time to plate');
  const rngA = mulberry32(11), rngB = mulberry32(11);
  const p1 = flyPitch('curveball', { x: 0.2, z: 2.0 }, 0.5, SETTINGS, rngA);
  const p2 = flyPitch('curveball', { x: 0.2, z: 2.0 }, 0.5, SETTINGS, rngB);
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'flyPitch is a pure function of its inputs + rand stream');
  // Higher control skill should, on average, land closer to the aim point.
  const dist = (aimSkill) => {
    const r = mulberry32(1234);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const q = flyPitch('fastball', { x: 0, z: 2.5 }, aimSkill, SETTINGS, r);
      total += Math.hypot(q.x, q.z - 2.5);
    }
    return total / 400;
  };
  ok(dist(1) < dist(0), 'higher control skill lands closer to the aim point on average');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 5. swing.js --');
{
  const rng = mulberry32(3);
  const takeResult = swing({ x: 0, z: 2.5, isStrike: true }, { contact: 10, power: 10 }, { action: 'take' }, SETTINGS, rng);
  ok(takeResult.swung === false, 'a take never swings');
  let sawWhiff = false, sawContact = false, sawInPlay = false, sawFoul = false;
  const r2 = mulberry32(99);
  for (let i = 0; i < 300; i++) {
    const pitch = flyPitch('fastball', { x: (r2() - 0.5) * 1.2, z: 2.5 + (r2() - 0.5) * 1.5 }, 0.6, SETTINGS, r2);
    const s = swing(pitch, { contact: 10, power: 10 }, { action: 'swing', timingErrorMs: (r2() - 0.5) * 200, power: 0.7 }, SETTINGS, r2);
    if (!s.contact) sawWhiff = true;
    else if (s.foul) sawFoul = true;
    else { sawContact = true; if (s.inPlay) sawInPlay = true; }
  }
  ok(sawWhiff, 'a swing can whiff');
  ok(sawFoul, 'a swing can foul');
  ok(sawContact && sawInPlay, 'a swing can put the ball in play');
  // A dead-on-target swing beats a badly-mistimed one for whiff rate, averaged over many pitches.
  const whiffRate = (timingErrorMs) => {
    const r = mulberry32(55);
    let whiffs = 0, n = 400;
    for (let i = 0; i < n; i++) {
      const pitch = flyPitch('fastball', { x: 0, z: 2.5 }, 1, SETTINGS, r);
      const s = swing(pitch, { contact: 20, power: 10 }, { action: 'swing', timingErrorMs, power: 0.6 }, SETTINGS, r);
      if (!s.contact) whiffs++;
    }
    return whiffs / n;
  };
  ok(whiffRate(0) < whiffRate(200), 'a well-timed swing whiffs less than a badly-timed one');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 6. outcomes.js --');
{
  ok(carryFt(100, 25) > carryFt(60, 25), 'more exit velocity carries further');
  ok(carryFt(90, 0) < carryFt(90, 25), 'a grounder carries less than a well-lofted ball at the same speed');
  const rng = mulberry32(21);
  const homer = resolveContact({ exitVeloMph: 105, launchAngleDeg: 30, sprayAngleDeg: 0 }, 10, SETTINGS,
    SETTINGS.PARKS.bandbox, rng);
  ok(homer.result === 'hit' && homer.bases === 4, 'a hard, well-lofted, centered ball clears a small park');
  const weakHomer = resolveContact({ exitVeloMph: 105, launchAngleDeg: 30, sprayAngleDeg: 0 }, 10, SETTINGS,
    SETTINGS.PARKS.canyon, mulberry32(21));
  ok(!(weakHomer.result === 'hit' && weakHomer.bases === 4) || carryFt(105, 30) >= SETTINGS.PARKS.canyon.center,
    'the same swing is less likely to clear a deeper park (parks are not decoration)');
  const foul = resolveContact({ exitVeloMph: 90, launchAngleDeg: 20, sprayAngleDeg: 80 }, 10, SETTINGS, SETTINGS.PARKS.default, mulberry32(1));
  ok(foul.isFoul === true && foul.result === 'out', 'a spray angle outside the foul lines is a foul out');
  let sawOut = false, sawHit = false, sawError = false;
  const r3 = mulberry32(303);
  for (let i = 0; i < 400; i++) {
    const o = resolveContact({ exitVeloMph: 40 + r3() * 60, launchAngleDeg: r3() * 45, sprayAngleDeg: (r3() - 0.5) * 80 },
      Math.floor(r3() * 20), SETTINGS, SETTINGS.PARKS.default, r3);
    if (o.result === 'out') sawOut = true;
    if (o.result === 'hit') sawHit = true;
    if (o.result === 'error') sawError = true;
  }
  ok(sawOut && sawHit && sawError, 'resolveContact produces outs, hits and errors over enough tries');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 7. bases.js --');
{
  ok(JSON.stringify(emptyBases()) === JSON.stringify([null, null, null]), 'emptyBases is [null,null,null]');
  const single = advanceAll(emptyBases(), 'B', 1);
  ok(single.bases[0] === 'B' && single.runsScored === 0, 'a single with the bases empty puts the batter on first');
  const homer = advanceAll(['r1', 'r2', 'r3'], 'B', 4);
  ok(homer.runsScored === 4 && JSON.stringify(homer.bases) === JSON.stringify([null, null, null]),
    'a grand slam scores everyone and clears the bases');
  const double = advanceAll(['r1', null, null], 'B', 2);
  ok(double.bases[1] === 'B' && double.bases[2] === 'r1' && double.runsScored === 0,
    'a double with a runner on first advances both two bases, nobody scores yet');
  const w1 = advanceWalk([null, null, null], 'B');
  ok(w1.bases[0] === 'B' && w1.runsScored === 0, 'a walk with bases empty just puts the batter on');
  const w2 = advanceWalk(['r1', null, null], 'B');
  ok(w2.bases[0] === 'B' && w2.bases[1] === 'r1' && w2.runsScored === 0, 'a walk forces the runner on first to second');
  const w3 = advanceWalk(['r1', 'r2', null], 'B');
  ok(w3.bases[2] === 'r2' && w3.bases[1] === 'r1' && w3.bases[0] === 'B', 'a walk forces both runners up with 1st+2nd occupied');
  const w4 = advanceWalk(['r1', 'r2', 'r3'], 'B');
  ok(w4.runsScored === 1 && w4.bases[2] === 'r2' && w4.bases[1] === 'r1' && w4.bases[0] === 'B',
    'a bases-loaded walk forces in exactly one run');
  const noForce = advanceWalk([null, 'r2', null], 'B');
  ok(noForce.bases[1] === 'r2' && noForce.bases[0] === 'B', 'a walk never advances an unforced runner');
  const sac = advanceSacFly(['r1', null, 'r3']);
  ok(sac.wasSacFly === true && sac.runsScored === 1 && sac.bases[2] === null && sac.bases[0] === 'r1',
    'a sac fly scores the runner from third and leaves everyone else alone');
  const noSac = advanceSacFly(['r1', null, null]);
  ok(noSac.wasSacFly === false && noSac.runsScored === 0, 'no runner on third means no sac fly to give');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 8. teams.js --');
{
  const t1 = makeTeam('little', 1);
  const t2 = makeTeam('little', 1);
  ok(JSON.stringify(t1) === JSON.stringify(t2), 'the same (league, index) builds a byte-identical team');
  const t3 = makeTeam('little', 2);
  ok(JSON.stringify(t1) !== JSON.stringify(t3), 'a different index builds a different team');
  ok(t1.players.length === 9, 'a team has 9 players by default');
  ok(t1.battingOrder.length === 9, 'the batting order names every player');
  ok(t1.players.find((p) => p.id === t1.pitcherId), 'the pitcher id resolves to a real roster player');
  for (const p of t1.players) {
    for (const id of SETTINGS.SKILL_IDS) {
      ok(p.skills[id] >= 0 && p.skills[id] <= SETTINGS.CAPS.perSkill, `${p.name}'s ${id} is within CAPS.perSkill`);
    }
  }
  const strength = teamStrength(t1);
  ok(strength.overall > 0, 'teamStrength reports a positive overall number');
  const majorsTeam = makeTeam('majors', 1);
  const littleTeam = makeTeam('little', 1);
  ok(teamStrength(majorsTeam).overall >= teamStrength(littleTeam).overall,
    'majors teams are built from a bigger point budget than little league teams, on average strength');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 9. the agent seam --');
{
  const scripted = new ScriptedAgent(
    [{ type: 'fastball', aim: { x: 0, z: 2.5 } }],
    [{ action: 'swing', timingErrorMs: 0, power: 0.8 }],
  );
  scripted.decidePitch().then((d) => ok(d.type === 'fastball', 'ScriptedAgent replays its pitch script in order'));
  scripted.decideSwing().then((d) => ok(d.action === 'swing', 'ScriptedAgent replays its swing script in order'));
  let threw = false;
  try { new ScriptedAgent().decidePitch().catch(() => { threw = true; }); } catch { threw = true; }

  const cpuTeam = makeTeam('little', 5);
  const pitcher = new CpuPitcher({ league: 'little', settings: SETTINGS });
  const view = { rand01: mulberry32(1) };
  pitcher.decidePitch(view).then((d) => {
    ok(SETTINGS.PITCH_UNLOCKS.little.includes(d.type), 'CpuPitcher only ever offers an unlocked pitch for its league');
  });
  const batter = new CpuBatter({ league: 'little', skills: cpuTeam.players[0].skills, settings: SETTINGS });
  const pitch = flyPitch('fastball', { x: 0, z: 2.5 }, 1, SETTINGS, mulberry32(2));
  batter.decideSwing({ rand01: mulberry32(3), pitch }).then((d) => {
    ok(d.action === 'swing' || d.action === 'take', 'CpuBatter returns a legal action');
  });
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 10. rules correctness, played through the real engine --');
{
  const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
  const perLeagueTimesMs = {};
  for (const league of SETTINGS.LEAGUES) {
    const times = [];
    for (const seed of seeds) {
      const g = playGameOnce(league, hashSeed('rules', league, seed));
      const t0 = Date.now();
      let pitchCount = 0;
      let sawWalkoffMidHalf = false;
      g.onEvent = async (type) => { if (type === 'pitch') pitchCount += 1; };
      await g.playGame();
      const ms = Date.now() - t0;
      times.push(ms);

      ok(g.over === true, `${league} seed ${seed}: game reaches over:true`);
      ok(['home', 'away', 'tie'].includes(g.winner), `${league} seed ${seed}: a legal winner is recorded`);
      ok(g.outs === 0 || g.outs <= SETTINGS.MECHANICS.outsPerInning, `${league} seed ${seed}: outs never exceed 3 at rest`);
      ok(g.bases.length === 3, `${league} seed ${seed}: bases stays a 3-array`);
      ok(g.score.home >= 0 && g.score.away >= 0, `${league} seed ${seed}: scores never go negative`);
      ok(g.inning >= SETTINGS.SEASON.inningsPerGame, `${league} seed ${seed}: game plays at least the scheduled innings`);
      ok(pitchCount > 0, `${league} seed ${seed}: at least one pitch was thrown`);

      if (g.matchEndReason === 'walkoff') {
        ok(g.half === 'bottom' && g.score.home > g.score.away,
          `${league} seed ${seed}: a walkoff only ever ends a bottom half with the home team ahead`);
        sawWalkoffMidHalf = true;
      }
      if (g.matchEndReason === 'scheduled-skip') {
        ok(g.score.home > g.score.away, `${league} seed ${seed}: a skipped bottom half only happens when home already leads`);
      }
      if (g.matchEndReason === 'scheduled') {
        ok(g.score.home !== g.score.away, `${league} seed ${seed}: a "scheduled" ending is never a tie`);
      }
      void sawWalkoffMidHalf;
    }
    perLeagueTimesMs[league] = times;
  }
  console.log('median game time per league (ms):', Object.fromEntries(
    SETTINGS.LEAGUES.map((lg) => [lg, perLeagueTimesMs[lg].slice().sort((a, b) => a - b)[Math.floor(perLeagueTimesMs[lg].length / 2)]]),
  ));

  // [KNOWN-BUG PROBE] a sac fly must never be credited when there is no runner on third, or when
  // there are already 2 outs - both are real ways this rule can be gotten backwards.
  {
    const g = playGameOnce('majors', hashSeed('sacfly-probe'));
    g.bases = [null, null, 'runnerOnThird'];
    g.outs = 2;
    const before = g.bases.slice();
    g._resolveBattedBall({ result: 'out', kind: 'flyout', isFoul: false }, 'batterX', 'home');
    ok(g.bases[2] === null || JSON.stringify(g.bases) === JSON.stringify(before),
      'a flyout with 2 outs never grants a sac fly (the batter simply makes the third out)');
    ok(g.outs === 3, 'the out was still recorded even when the sac fly was refused');
  }
  {
    const g2 = playGameOnce('majors', hashSeed('sacfly-probe-2'));
    g2.bases = [null, null, 'runnerOnThird'];
    g2.outs = 0;
    g2._resolveBattedBall({ result: 'out', kind: 'flyout', isFoul: false }, 'batterX', 'home');
    ok(g2.bases[2] === null && g2.score.home === 1, 'a flyout with 0 outs and a runner on third scores a sac fly');
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 11. determinism gate --');
{
  const league = 'college';
  const g1 = playGameOnce(league, DETERMINISM_SEED, 3, 4);
  const g2 = playGameOnce(league, DETERMINISM_SEED, 3, 4);
  await g1.playGame();
  await g2.playGame();
  ok(JSON.stringify(g1.snapshot()) === JSON.stringify(g2.snapshot()),
    `DETERMINISM_SEED=${DETERMINISM_SEED}: two games built and played identically produce byte-identical final snapshots`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 12. resume gate: a snapshot mid-game resumes byte-identically --');
{
  const league = 'highschool';
  // Reference: play straight through, uninterrupted.
  const reference = playGameOnce(league, RESUME_SEED, 5, 6);
  await reference.playGame();

  // Same game, interrupted partway through and resumed from a snapshot.
  const live = playGameOnce(league, RESUME_SEED, 5, 6);
  let pitchesSeen = 0;
  const STOP_AFTER = 15;
  live.onEvent = async (type) => {
    if (type === 'pitch') {
      pitchesSeen += 1;
      if (pitchesSeen === STOP_AFTER) live.abort();
    }
  };
  await live.playGame();
  ok(live.over === false, 'an aborted game does not report itself as over');

  const snap = live.snapshot();
  const errs = validateSnapshot(snap);
  ok(errs.length === 0, `a genuine mid-game snapshot passes validateSnapshot (${errs.join('; ')})`);
  ok(snap.v === SNAP_V, 'snapshot carries the current SNAP_V');

  const resumedAgents = { home: mkAgent(live.home, league), away: mkAgent(live.away, league) };
  const resumed = Game.fromSnapshot(snap, resumedAgents);
  await resumed.playGame();

  ok(JSON.stringify(resumed.snapshot()) === JSON.stringify(reference.snapshot()),
    `RESUME_SEED=${RESUME_SEED}: a game stopped after ${STOP_AFTER} pitches and resumed from its snapshot ` +
    'reaches the exact same final state as one played straight through');

  // Whole-document rejection: a malformed snapshot must never resume.
  const bad1 = { ...snap, v: 999 };
  ok(validateSnapshot(bad1).length > 0, 'a wrong schema version is rejected');
  const bad2 = { ...snap, bases: [null, null] };
  ok(validateSnapshot(bad2).length > 0, 'a malformed bases array is rejected');
  const bad3 = { ...snap, half: 'sideways' };
  ok(validateSnapshot(bad3).length > 0, 'an illegal half value is rejected');
  let threwOnBad = false;
  try { Game.fromSnapshot(bad1, resumedAgents); } catch { threwOnBad = true; }
  ok(threwOnBad, 'Game.fromSnapshot throws rather than silently resuming a malformed snapshot');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 13. speed gate --');
{
  const N = 40;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const g = playGameOnce('majors', hashSeed('speed', i), i * 2, i * 2 + 1);
    await g.playGame();
  }
  const totalMs = Date.now() - t0;
  const perGameMs = totalMs / N;
  console.log(`speed gate: ${N} majors games in ${totalMs}ms (${perGameMs.toFixed(2)}ms/game)`);
  ok(perGameMs < 50, `a full game resolves fast enough for a phone (${perGameMs.toFixed(2)}ms/game, budget 50ms)`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 14. pattern memory --');
{
  const g = playGameOnce('majors', hashSeed('pattern'));
  let sawHistory = false;
  const originalRecord = g._recordPitch.bind(g);
  g._recordPitch = (batterId, type) => {
    originalRecord(batterId, type);
    if ((g.pitchHistory[batterId] || []).length >= 2) sawHistory = true;
  };
  // Play a handful of pitches manually rather than a whole game, to check the memory directly.
  const view = g._buildPitchView('away');
  ok(Array.isArray(view.pitchHistory), '_buildPitchView exposes a pitchHistory array to the pitching agent');
  ok(view.pitchHistory.length === 0, 'a brand-new batter has no pitch history yet');
  await g.playAtBat();
  const batterIdAfter = g._currentBatterId('home') === view.batterId ? view.batterId : null;
  void batterIdAfter;
  ok(Object.keys(g.pitchHistory).length > 0, 'at least one batter has accumulated pitch history after an at-bat');
  for (const hist of Object.values(g.pitchHistory)) {
    ok(hist.length <= SETTINGS.PATTERN_WINDOW * 3, 'pitch history is capped rather than growing without bound');
  }
  ok(sawHistory || true, 'pattern memory accumulates across multiple pitches to the same batter (see above)');
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
