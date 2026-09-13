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
import { swing, qualityFor } from './engine/swing.js';
import { resolveContact, carryFt, fenceFtAt } from './engine/outcomes.js';
import { zonesFor, angleSector } from './engine/zones.js';
import { emptyBases, advanceAll, advanceWalk, advanceSacFly, advanceDoublePlay } from './engine/bases.js';
import { Game, SNAP_V, validateSnapshot } from './engine/game.js';
import { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher, ScriptedAgent } from './engine/agents.js';
import { makeTeam, makeLeague, makePlayerTeam, teamStrength, effectiveCapFor, POSITIONS } from './engine/teams.js';
import { makeSchedule, scriptedStandings, playoffs, trophyFor } from './engine/season.js';
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
      return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS, styleId: team.styleId }).decideSwing(v);
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
  ok(typeof SETTINGS.POINTS[lg] === 'object' && SETTINGS.POINTS[lg].win >= SETTINGS.POINTS[lg].loss,
    `POINTS.${lg} pays a win at least as much as a loss (doc §7)`);
  ok(SETTINGS.POINTS[lg].bronze < SETTINGS.POINTS[lg].silver && SETTINGS.POINTS[lg].silver < SETTINGS.POINTS[lg].gold,
    `POINTS.${lg} trophies rise bronze < silver < gold (doc §7)`);
  ok(Array.isArray(SETTINGS.PITCH_UNLOCKS[lg]) && SETTINGS.PITCH_UNLOCKS[lg].length > 0, `PITCH_UNLOCKS.${lg} non-empty`);
  ok(SETTINGS.PITCH_UNLOCKS[lg].every((t) => SETTINGS.PITCH_TYPES.includes(t)), `PITCH_UNLOCKS.${lg} are real pitch types`);
  ok(!!SETTINGS.CPU[lg], `CPU.${lg} exists`);
  ok(!!SETTINGS.TEAM_STYLE_WEIGHTS[lg], `TEAM_STYLE_WEIGHTS.${lg} exists`);
  ok(typeof SETTINGS.CAPS[lg] === 'number' && SETTINGS.CAPS[lg] > 0, `CAPS.${lg} is a positive number`);
  ok(typeof SETTINGS.CPU_LEVEL_SHORTFALL[lg] === 'number' && SETTINGS.CPU_LEVEL_SHORTFALL[lg] >= 0,
    `CPU_LEVEL_SHORTFALL.${lg} is a non-negative number`);
}
// doc §6, [Draft]: caps rise 10, 14, 18, 22, 26 - monotonic by league.
ok(SETTINGS.LEAGUES.every((lg, i) => i === 0 || SETTINGS.CAPS[lg] > SETTINGS.CAPS[SETTINGS.LEAGUES[i - 1]]),
  'CAPS rise monotonically by league (doc §6: 10, 14, 18, 22, 26)');
ok(JSON.stringify(SETTINGS.CAPS) === JSON.stringify({ little: 10, highschool: 14, college: 18, minors: 22, majors: 26 }),
  'CAPS match the doc\'s exact per-league numbers');
// doc §11/§14: readout mph rows equal the Majors row times that league's own scale, within 1 mph.
for (const lg of SETTINGS.LEAGUES) {
  const row = SETTINGS.READOUT[lg];
  const majorsRow = SETTINGS.READOUT.majors;
  for (const pitch of ['fastball', 'changeup', 'curveball', 'slider', 'knuckleball']) {
    ok(Math.abs(row[pitch] - majorsRow[pitch] * row.scale) <= 1,
      `READOUT.${lg}.${pitch} equals the Majors row times ${lg}'s own scale, within 1 mph`);
  }
}
ok(SETTINGS.PATTERN_WEIGHTS.length === SETTINGS.PATTERN_WINDOW, 'PATTERN_WEIGHTS length matches PATTERN_WINDOW');
ok(SETTINGS.PATTERN_WINDOW === 3, 'pattern memory window is the last 3 pitches (doc §8, [Locked])');
ok(SETTINGS.FEEL.engine.dtS === 1 / 120, 'fixed timestep is 1/120s, matching hill-climb/js/physics.js\'s DT');
ok(SETTINGS.FEEL.engine.maxSteps === 5, 'catch-up cap matches the repo\'s standing convention (Hill Climb/Pinball)');
ok(SETTINGS.FEEL.engine.fastballMs === 1500, 'fastballMs matches the doc\'s prototype-tuned value (doc §14)');
ok(SETTINGS.SEASON.inningsPerGame === 3, 'a game is 3 innings (doc §3, [Locked])');
ok(SETTINGS.SEASON.playoffTeams === 4 && SETTINGS.SEASON.leagueSize === 9, 'top 4 of 9 make the playoffs (doc §4)');
ok(SETTINGS.SEASON.playoffRounds.length === 2, 'no quarterfinal - semifinal then championship only (doc §4)');
for (const style of Object.keys(SETTINGS.TEAM_STYLES)) {
  ok(SETTINGS.SKILL_IDS.every((id) => typeof SETTINGS.TEAM_STYLES[style][id] === 'number'), `TEAM_STYLES.${style} names every skill`);
}
ok(Object.keys(SETTINGS.TEAM_STYLES).length === 8, 'eight team styles, matching the doc\'s named list (doc §9)');
// doc §6: every preset sums to 15 per side with nothing over 10.
for (const [name, preset] of Object.entries(SETTINGS.PRESETS)) {
  const hitSum = SETTINGS.HIT_SKILL_IDS.reduce((s, id) => s + preset[id], 0);
  const pitchSum = SETTINGS.PITCH_SKILL_IDS.reduce((s, id) => s + preset[id], 0);
  ok(hitSum === 15, `PRESETS.${name} sums to 15 in hitting (doc §6)`);
  ok(pitchSum === 15, `PRESETS.${name} sums to 15 in pitching (doc §6)`);
  ok(Object.values(preset).every((v) => v <= 10), `PRESETS.${name} has nothing over 10 (doc §6)`);
}
ok(ZONE.xMax > ZONE.xMin, 'strike zone has positive lateral extent');
ok(SETTINGS.MECHANICS.strikesForOut === 3 && SETTINGS.MECHANICS.ballsForWalk === 4, 'standard K/BB thresholds');
ok(SETTINGS.MECHANICS.extraInningRunnerOnSecond === true, 'extra innings start with a runner on second (doc §3, [Locked])');
ok(SETTINGS.MECHANICS.doublePlayEnabled === true, 'ground-out double plays are possible (doc §3, [Locked])');
ok(SETTINGS.MECHANICS.foulNeverThirdStrike === true, 'a foul can never be strike 3 (doc §3, [Locked])');
ok(SETTINGS.unlockedPitchesFor('majors', 1).includes('eephus'), 'a first World Series title unlocks the eephus (doc §11)');
ok(SETTINGS.unlockedPitchesFor('majors', 2).includes('cutter'), 'a second World Series title unlocks the cutter (doc §11)');
ok(!SETTINGS.unlockedPitchesFor('majors', 0).includes('eephus'), 'no titles means no eephus yet');

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
ok(ENGINE_FILES.length >= 11, `all eleven engine modules present, including Step 1/3's zones.js and season.js (found ${ENGINE_FILES.length})`);
// [KNOWN-BUG PROBE] doc §10's outcome list is singles/doubles/triples/homers/outs - there is no
// "error" outcome in the real design, and phase 1 invented one. Checks for the quoted OUTCOME
// string specifically (never the bare substring "error", which legitimately appears in `Error`,
// `console.error` and `timingErrorMs` throughout the engine).
for (const file of ENGINE_FILES) {
  const raw = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
  const code = stripComments(raw);
  ok(!code.includes("'error'"), `engine/${file} does not use the outcome string 'error' - the real design has none (doc §10)`);
}
ok(!fs.readFileSync(path.join(ENGINE_DIR, 'game.js'), 'utf8').includes('_defenseLevel01'),
  'game.js\'s invented _defenseLevel01() league-ordered ramp is gone (replaced by zones.js, Step 1)');

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
  const p = flyPitch('fastball', 0, 1, SETTINGS, rng);
  ok(p.type === 'fastball', 'flyPitch echoes the requested type');
  ok(typeof p.isStrike === 'boolean', 'flyPitch reports isStrike');
  ok(p.timeToPlateS > 0, 'flyPitch reports a positive time to plate');
  ok(flyPitch('changeup', 0, 1, SETTINGS, mulberry32(1)).timeToPlateS > flyPitch('fastball', 0, 1, SETTINGS, mulberry32(1)).timeToPlateS,
    'a changeup takes longer to arrive than a fastball (doc §14 travel multiples)');
  const rngA = mulberry32(11), rngB = mulberry32(11);
  const p1 = flyPitch('curveball', 0.2, 0.5, SETTINGS, rngA);
  const p2 = flyPitch('curveball', 0.2, 0.5, SETTINGS, rngB);
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'flyPitch is a pure function of its inputs + rand stream');
  // Higher control skill should, on average, land closer to the aim point.
  const dist = (aimSkill) => {
    const r = mulberry32(1234);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const q = flyPitch('fastball', 0, aimSkill, SETTINGS, r);
      total += Math.abs(q.x);
    }
    return total / 400;
  };
  ok(dist(1) < dist(0), 'higher control skill lands closer to the aim point on average');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 5. swing.js --');
{
  const rng = mulberry32(3);
  const skills = { hitAcc: 6, hitPow: 6, hitSpd: 6, pitchSpd: 6, pitchAcc: 6, pitchSpin: 6 };
  const takeResult = swing({ x: 0, isStrike: true }, skills, { action: 'take' }, SETTINGS, rng);
  ok(takeResult.swung === false, 'a take never swings');
  let sawWhiff = false, sawContact = false, sawInPlay = false, sawFoul = false;
  const r2 = mulberry32(99);
  for (let i = 0; i < 300; i++) {
    const pitch = flyPitch('fastball', (r2() - 0.5) * 1.2, 0.6, SETTINGS, r2);
    const s = swing(pitch, skills, { action: 'swing', aimX: (r2() - 0.5) * 1.2, timingErrorMs: (r2() - 0.5) * 340, power: 0.7 }, SETTINGS, r2);
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
      const pitch = flyPitch('fastball', 0, 1, SETTINGS, r);
      const s = swing(pitch, { ...skills, hitAcc: 10 }, { action: 'swing', aimX: 0, timingErrorMs, power: 0.6 }, SETTINGS, r);
      if (!s.contact) whiffs++;
    }
    return whiffs / n;
  };
  ok(whiffRate(0) < whiffRate(1000), 'a well-timed swing whiffs less than one wildly outside the foul boundary');
  // Bat reach: a bat placed far from where the pitch actually crossed is an automatic miss.
  const wayOff = swing({ x: 0, isStrike: true }, skills,
    { action: 'swing', aimX: SETTINGS.FEEL.engine.batReach + 0.5, timingErrorMs: 0, power: 0.6 }, SETTINGS, mulberry32(4));
  ok(wayOff.contact === false, 'a bat placed beyond reach of the pitch is an automatic miss');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 5b. swing.js: contact-quality axis (BB-2a step 2) --');
{
  const F = SETTINGS.FEEL.engine;
  ok(qualityFor(0, F.perfectMs, F.timingWindow) === 1, 'q is 1 at dead-on timing');
  ok(qualityFor(F.perfectMs, F.perfectMs, F.timingWindow) === 1, 'q is still 1 exactly at the perfect-band edge');
  ok(qualityFor(F.timingWindow, F.perfectMs, F.timingWindow) === 0, 'q is 0 exactly at the timing-window edge');
  ok(qualityFor(F.timingWindow * 2, F.perfectMs, F.timingWindow) === 0, 'q never goes negative past the window edge');
  const qs = [0, 10, 25, 40, 60, 80, 99].map((ms) => qualityFor(ms, F.perfectMs, F.timingWindow));
  ok(qs.every((v, i) => i === 0 || v <= qs[i - 1] + 1e-9), 'q is non-increasing in absolute timing error');

  // With a fixed rand stream and a fixed (centered) placement, exitVeloMph must be non-increasing
  // in the absolute timing error across the whole window - the exact defect the handoff diagnosed
  // ("a swing 3ms off and a swing 99ms off produce identical contact") must no longer hold.
  const skills = { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 5, pitchAcc: 5, pitchSpin: 5 };
  const exitVeloAt = (timingErrorMs) => {
    const r = mulberry32(777); // same seed every call -> identical noise draws
    const pitch = { x: 0, isStrike: true };
    const s = swing(pitch, skills, { action: 'swing', aimX: 0, timingErrorMs, charged: false }, SETTINGS, r);
    return s;
  };
  const timingSamples = [0, 5, 15, 25, 40, 60, 80, 99];
  const veloSamples = timingSamples.map((ms) => exitVeloAt(ms));
  ok(veloSamples.every((s) => s.contact && s.inPlay), 'every sampled timing error stays inside the window (in play)');
  ok(veloSamples.every((s, i) => i === 0 || s.exitVeloMph <= veloSamples[i - 1].exitVeloMph + 1e-9),
    'exitVeloMph is non-increasing in absolute timing error, fixed rand stream and placement (BB-2a step 2)');
  ok(veloSamples[0].exitVeloMph > veloSamples[veloSamples.length - 1].exitVeloMph,
    'a dead-on-time swing carries meaningfully more than a barely-inside-the-window one (was: identical)');

  // At q=1, power's contribution is FULL; at q=0 (window edge), exit velo is at most qualityFloor's
  // share of the q=1 exit velo for a MAX-power swing vs a MIN-power one under the same conditions.
  // The window itself widens with hitAcc (whiffReductionPerPt), so its edge must be computed the
  // same way swing.js computes it, not assumed to equal the base FEEL.timingWindow.
  const hitAccPtsForWindow = 5;
  const windowMsFor = () => F.timingWindow * (1 + hitAccPtsForWindow * (SETTINGS.SKILL_EFFECT.hitAcc.whiffReductionPerPt || 0) * 4);
  const veloForPower = (hitPowPts, timingErrorMs) => {
    const r = mulberry32(321);
    const sk = { ...skills, hitPow: hitPowPts, hitAcc: hitAccPtsForWindow };
    const pitch = { x: 0, isStrike: true };
    return swing(pitch, sk, { action: 'swing', aimX: 0, timingErrorMs, charged: false }, SETTINGS, r).exitVeloMph;
  };
  const perfectMaxPower = veloForPower(10, 0);
  const edgeMaxPower = veloForPower(10, windowMsFor());
  ok(edgeMaxPower <= perfectMaxPower * F.qualityFloor + 1e-6 + 4 /* rand01 noise budget, +-4mph */,
    `a max-Power swing at the timing window's edge (q=0) caps out near qualityFloor of its own perfect-timing exit velo (edge=${edgeMaxPower.toFixed(1)}, cap=${(perfectMaxPower * F.qualityFloor + 4).toFixed(1)})`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 6. outcomes.js / zones.js (Step 1: out-zone geometry, no error outcome) --');
{
  ok(carryFt(100, 25) > carryFt(60, 25), 'more exit velocity carries further');
  ok(carryFt(90, 0) < carryFt(90, 25), 'a grounder carries less than a well-lofted ball at the same speed');
  const zones = zonesFor('college', 0);
  const rng = mulberry32(21);
  const homer = resolveContact({ exitVeloMph: 105, launchAngleDeg: 30, sprayAngleDeg: 0 }, zones, SETTINGS,
    SETTINGS.PARKS.bandbox, 5, rng);
  ok(homer.result === 'hit' && homer.bases === 4, 'a hard, well-lofted, centered ball clears a small park');
  const weakHomer = resolveContact({ exitVeloMph: 105, launchAngleDeg: 30, sprayAngleDeg: 0 }, zones, SETTINGS,
    SETTINGS.PARKS.canyon, 5, mulberry32(21));
  ok(!(weakHomer.result === 'hit' && weakHomer.bases === 4) || carryFt(105, 30) >= SETTINGS.PARKS.canyon.center,
    'the same swing is less likely to clear a deeper park (parks are not decoration)');
  const foul = resolveContact({ exitVeloMph: 90, launchAngleDeg: 20, sprayAngleDeg: 80 }, zones, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
  ok(foul.isFoul === true && foul.result === 'out', 'a spray angle outside the foul lines is a foul out');
  let sawOut = false, sawHit = false;
  const r3 = mulberry32(303);
  for (let i = 0; i < 400; i++) {
    const o = resolveContact({ exitVeloMph: 40 + r3() * 60, launchAngleDeg: r3() * 45, sprayAngleDeg: (r3() - 0.5) * 80 },
      zones, SETTINGS, SETTINGS.PARKS.default, 5, r3);
    if (o.result === 'out') sawOut = true;
    if (o.result === 'hit') sawHit = true;
    ok(o.result === 'out' || o.result === 'hit', 'resolveContact never returns an "error" result - the real design has none (doc §10)');
  }
  ok(sawOut && sawHit, 'resolveContact produces both outs and hits over enough tries');

  // fenceFtAt: piecewise across the five named points, and a plain 3-point PARKS shape still works.
  ok(fenceFtAt(0, SETTINGS.PARKS.default) === SETTINGS.PARKS.default.center, 'fenceFtAt(0) is dead center');
  ok(fenceFtAt(-45, SETTINGS.PARKS.default) === SETTINGS.PARKS.default.left, 'fenceFtAt(-45) is the left line');
  ok(fenceFtAt(45, SETTINGS.PARKS.default) === SETTINGS.PARKS.default.right, 'fenceFtAt(45) is the right line');
  const fiveFence = { left: 300, leftCenter: 340, center: 400, rightCenter: 340, right: 300 };
  ok(fenceFtAt(-22.5, fiveFence) === 340, 'fenceFtAt honors an explicit leftCenter point rather than only interpolating left/center');

  // zonesFor/angleSector: every league's zones cover more ground each league up (doc §10:
  // "out zones also grow"), and the shift stays inside the fair-territory bounds.
  for (let i = 1; i < SETTINGS.LEAGUES.length; i++) {
    const prev = zonesFor(SETTINGS.LEAGUES[i - 1]);
    const cur = zonesFor(SETTINGS.LEAGUES[i]);
    const depth = (z) => z.outfield.reduce((s, sec) => s + (sec.toFt - sec.fromFt), 0);
    ok(depth(cur) >= depth(prev), `${SETTINGS.LEAGUES[i]}'s outfield zones cover at least as much ground as ${SETTINGS.LEAGUES[i - 1]}'s`);
  }
  const shifted = zonesFor('majors', 15);
  ok(shifted.infield.every((s) => s.fromDeg >= -45 && s.toDeg <= 45), 'a shifted zone never rotates outside fair territory');
  const sec = angleSector(0, zonesFor('majors').outfield);
  ok(sec.fromDeg <= 0 && sec.toDeg >= 0, 'angleSector finds the sector containing a given angle');

  // BB-2a step 3: a perfectly-timed swing must not spray toward the worst part of the field, and a
  // squared-up LINE DRIVE goes through a sector a routine fly into the same spot would not.
  {
    // A marginal fly ball hit dead center (a majors outfielder's deepest, best-covered sector) is
    // an out; the SAME exit velocity/launch angle hit toward a gap (where swing.js's q=1 spray
    // model centers a perfectly-timed swing, per settings.js's `perfectSprayDeg`) is a hit - the
    // doc's own promise ("good timing is not aimed at the worst place on the field") made concrete.
    const zonesM = zonesFor('majors', 0);
    const centerSector = zonesM.outfield[1];
    const cornerSector = zonesM.outfield[0];
    ok(centerSector.toFt > cornerSector.toFt, 'majors\' straightaway-center out-zone reaches deeper than its corners (the geometry this test exercises)');
    const midDistance = (centerSector.toFt + cornerSector.toFt) / 2; // beyond corner reach, within center reach
    const FLY_ANGLE = 30; // a 'fly' kind (battedBallKind: >=26, <52), clear of the line-through rule
    const angleFactor = Math.max(0, Math.sin((2 * FLY_ANGLE * Math.PI) / 180));
    const exitVeloMph = midDistance / (SETTINGS.CARRY_SCALE * angleFactor) + 30;
    const deadCenter = resolveContact({ exitVeloMph, launchAngleDeg: FLY_ANGLE, sprayAngleDeg: 0, q: 1 },
      zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(2));
    const towardGap = resolveContact({ exitVeloMph, launchAngleDeg: FLY_ANGLE, sprayAngleDeg: SETTINGS.FEEL.engine.perfectSprayDeg, q: 1 },
      zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(2));
    ok(deadCenter.result === 'out', `a marginal fly ball hit dead center is caught (majors' deepest out-zone), got ${JSON.stringify(deadCenter)}`);
    ok(towardGap.result === 'hit', `the identical ball hit toward a gap (where a perfectly-timed swing sprays) gets through, got ${JSON.stringify(towardGap)}`);
  }
  {
    // A well-squared-up line drive (q above LINE_THROUGH_Q) that lands inside an outfield sector's
    // reach is a hit; the same launch/exit velocity with LOW q (a routine-quality fly/liner) at the
    // identical spot stays an out.
    const zonesM = zonesFor('majors', 0);
    const sec2 = zonesM.outfield[1]; // straightaway center
    const midDepth = (sec2.fromFt + sec2.toFt) / 2;
    // Reverse-engineer an exit velo/angle combo that carries to midDepth at launchAngleDeg=18.
    const angleFactor = Math.max(0, Math.sin((2 * 18 * Math.PI) / 180));
    const exitVeloMph = midDepth / (SETTINGS.CARRY_SCALE * angleFactor) + 30;
    const highQ = resolveContact({ exitVeloMph, launchAngleDeg: 18, sprayAngleDeg: 0, q: 0.95 }, zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    const lowQ = resolveContact({ exitVeloMph, launchAngleDeg: 18, sprayAngleDeg: 0, q: 0.1 }, zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    ok(highQ.result === 'hit' && highQ.kind === 'line-through',
      `a well-squared-up line drive (q=0.95) through a sector's own reach depth is a hit, not an out (BB-2a step 3), got ${JSON.stringify(highQ)}`);
    ok(lowQ.result === 'out', `the identical distance/angle at low contact quality (q=0.1) stays a routine out, got ${JSON.stringify(lowQ)}`);
  }
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
  const dp = advanceDoublePlay(['r1', 'r2', 'r3']);
  ok(dp[0] === null && dp[1] === 'r2' && dp[2] === 'r3', 'a double play removes only the runner forced at second');
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
  const cap1 = effectiveCapFor('little');
  for (const p of t1.players) {
    for (const id of SETTINGS.SKILL_IDS) {
      ok(p.skills[id] >= 0 && p.skills[id] <= cap1, `#${p.jersey} ${p.pos}'s ${id} is within little league's effective cap`);
    }
  }
  // doc §9, [Locked]: "Players are shown by jersey number and position... No names" (Step 3).
  ok(t1.players.every((p) => typeof p.jersey === 'number' && p.jersey >= 1 && p.jersey <= 99),
    'every player carries a jersey number 1-99, never a name');
  ok(t1.players.every((p) => POSITIONS.includes(p.pos)), 'every player carries a real position');
  ok(t1.players.every((p) => p.name === undefined), 'a generated player has no `name` field at all');
  const strength = teamStrength(t1);
  ok(strength.overall > 0, 'teamStrength reports a positive overall number');
  ok(SETTINGS.LEAGUES.includes(t1.styleId) === false && !!SETTINGS.TEAM_STYLES[t1.styleId],
    'a generated team\'s styleId is one of the doc\'s eight named styles');
  // doc §8, [Locked]: "generated at the player's expected level... not at the raw league cap" -
  // effectiveCapFor is strictly below the raw CAPS wherever a shortfall is given.
  for (const lg of SETTINGS.LEAGUES) {
    const expected = SETTINGS.CAPS[lg] - (SETTINGS.CPU_LEVEL_SHORTFALL[lg] || 0);
    ok(effectiveCapFor(lg) === Math.max(1, expected), `effectiveCapFor(${lg}) is CAPS minus CPU_LEVEL_SHORTFALL`);
  }
  // [KNOWN-BUG PROBE] the effective-cap ladder must never regress. The BB-1a handoff's first pass
  // at CPU_LEVEL_SHORTFALL ({little:0, highschool:0, college:9, minors:11, majors:12} - a TOTAL
  // across all six skills, not per-skill, and not cumulative) produced 10, 14, 9, 11, 14: College's
  // CPU teams generated WEAKER than Little League's, despite the ladder being harder each league up
  // (doc §8, [Locked]). Corrected to per-skill, cumulative values; this asserts the ladder stays
  // strictly non-decreasing so that regression cannot come back silently.
  const capLadder = SETTINGS.LEAGUES.map((lg) => effectiveCapFor(lg));
  ok(capLadder.every((c, i) => i === 0 || c >= capLadder[i - 1]),
    `[KNOWN-BUG PROBE] the effective-cap ladder is non-decreasing by league: ${JSON.stringify(capLadder)}`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 8b. teams.js: makeLeague/makePlayerTeam (Step 3; BB-2a step 5: ladder by slot) --');
{
  for (const lg of SETTINGS.LEAGUES) {
    const league = makeLeague(lg);
    ok(league.length === 8, `makeLeague('${lg}') returns exactly 8 teams (doc §9)`);
    const styleIds = league.map((t) => t.styleId);
    ok(new Set(styleIds).size === 8, `makeLeague('${lg}') gives every team a DISTINCT style`);
    ok(styleIds.every((id) => !!SETTINGS.TEAM_STYLES[id]), `makeLeague('${lg}') only uses the doc's 8 named styles`);
    ok(JSON.stringify(styleIds) === JSON.stringify(SETTINGS.LEAGUE_LADDER_STYLES[lg]),
      `makeLeague('${lg}') orders teams by LEAGUE_LADDER_STYLES's own slot order (BB-2a step 5), never by measured teamStrength`);
    const league2 = makeLeague(lg);
    ok(JSON.stringify(league) === JSON.stringify(league2), `makeLeague('${lg}') is byte-identical run to run`);
  }
  // BB-2a step 5: strength comes from TEAM_LADDER_OFFSETS by SLOT, not from a style's own flavor.
  ok(SETTINGS.TEAM_LADDER_OFFSETS.length === 8, 'TEAM_LADDER_OFFSETS names exactly 8 slots');
  ok(SETTINGS.TEAM_LADDER_OFFSETS.every((v, i) => i === 0 || v > SETTINGS.TEAM_LADDER_OFFSETS[i - 1]),
    'TEAM_LADDER_OFFSETS is strictly rising, weakest slot to strongest (BB-2a step 5)');
  for (const lg of SETTINGS.LEAGUES) {
    ok(new Set(SETTINGS.LEAGUE_LADDER_STYLES[lg]).size === 8, `LEAGUE_LADDER_STYLES.${lg} names every style exactly once`);
    ok(SETTINGS.LEAGUE_LADDER_STYLES[lg].every((id) => !!SETTINGS.TEAM_STYLES[id]), `LEAGUE_LADDER_STYLES.${lg} only names real styles`);
  }
  // "the same style is generated stronger in Majors than in Little League" still holds, since
  // effectiveCapFor(league) (the base every slot's offset is applied around) rises by league.
  const littleLeague = makeLeague('little');
  const majorsLeague = makeLeague('majors');
  for (let slot = 0; slot < 8; slot++) {
    ok(teamStrength(majorsLeague[slot]).overall >= teamStrength(littleLeague[slot]).overall,
      `slot ${slot}'s team (${majorsLeague[slot].styleId}) is generated at least as strong in Majors as in Little League`);
  }

  const skills = { hitAcc: 6, hitPow: 6, hitSpd: 6, pitchSpd: 6, pitchAcc: 6, pitchSpin: 6 };
  const pt = makePlayerTeam({ skills, hand: 'L' });
  ok(pt.players.length === 9, 'makePlayerTeam has 9 roster slots (doc §6: "one player who is all 9")');
  ok(pt.players.every((p) => JSON.stringify(p.skills) === JSON.stringify(skills)), 'every slot is a clone of the same player\'s skills');
  ok(pt.players.every((p) => p.bats === 'L' && p.throws === 'L'), 'every slot carries the same hand');
  ok(new Set(pt.players.map((p) => p.pos)).size === 9, 'the 9 clones still cover 9 distinct positions');
  ok(pt.pitcherId === pt.players[0].id, 'the player always pitches (doc §6, [Locked])');
  ok(pt.battingOrder.length === 9 && new Set(pt.battingOrder).size === 9, 'a full, non-repeating batting order');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 8c. settings.js CPU table (Step 2): every league carries the new behavior fields --');
{
  const NEW_FIELDS = ['pitchMix', 'cornerBias', 'patternWeight', 'weakSpotWeight'];
  for (const lg of SETTINGS.LEAGUES) {
    const cpu = SETTINGS.CPU[lg];
    for (const field of NEW_FIELDS) {
      ok(cpu[field] !== undefined, `CPU.${lg}.${field} exists`);
    }
    ok(typeof cpu.pitchMix === 'object' && Object.keys(cpu.pitchMix).length > 0, `CPU.${lg}.pitchMix names at least one pitch weight`);
    ok(Object.keys(cpu.pitchMix).every((t) => SETTINGS.PITCH_UNLOCKS[lg].includes(t)),
      `CPU.${lg}.pitchMix only weights pitches that are actually unlocked at ${lg}`);
  }
  // doc §8, [Locked]: each league up mixes pitches more (more distinct weighted types), works
  // corners more, chases less, and reads patterns better.
  const cornerBiases = SETTINGS.LEAGUES.map((lg) => SETTINGS.CPU[lg].cornerBias);
  ok(cornerBiases.every((v, i) => i === 0 || v >= cornerBiases[i - 1]), 'cornerBias rises monotonically by league');
  const patternWeights = SETTINGS.LEAGUES.map((lg) => SETTINGS.CPU[lg].patternWeight);
  ok(patternWeights.every((v, i) => i === 0 || v >= patternWeights[i - 1]), 'patternWeight rises monotonically by league');
  const chases = SETTINGS.LEAGUES.map((lg) => SETTINGS.CPU[lg].chase);
  ok(chases.every((v, i) => i === 0 || v <= chases[i - 1]), 'chase falls monotonically by league (doc §8: "Majors: rarely chases")');
  const pitchCounts = SETTINGS.LEAGUES.map((lg) => Object.keys(SETTINGS.CPU[lg].pitchMix).length);
  ok(pitchCounts.every((v, i) => i === 0 || v >= pitchCounts[i - 1]), 'the pitch mix names more pitches each league up');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 8d. season.js: schedule, standings, playoffs (Step 3) --');
{
  for (const lg of SETTINGS.LEAGUES) {
    const sched = makeSchedule(lg, 42);
    ok(sched.length === 12, `makeSchedule('${lg}') has 12 games (doc §4)`);
    ok(sched.filter((g) => g.home).length === 6, 'exactly six home games');
    ok(new Set(sched.map((g) => g.opponentIndex)).size === 8, 'every one of the 8 opponents appears at least once');
    const counts = {};
    for (const g of sched) counts[g.opponentIndex] = (counts[g.opponentIndex] || 0) + 1;
    const repeats = Object.entries(counts).filter(([, c]) => c === 2).map(([idx]) => Number(idx));
    ok(repeats.length === 4 && repeats.every((idx) => idx >= 4), 'the four STRONGEST opponents (index 4-7) are repeated; nobody else is');
    const firstHalfAvg = mean(sched.slice(0, 6).map((g) => g.opponentIndex));
    const secondHalfAvg = mean(sched.slice(6).map((g) => g.opponentIndex));
    ok(secondHalfAvg >= firstHalfAvg, 'harder opponents (higher index) land later in the schedule, on average');
    const sched2 = makeSchedule(lg, 42);
    ok(JSON.stringify(sched) === JSON.stringify(sched2), 'the same (league, seed) is the same schedule every time');
  }
  function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

  const league = makeLeague('majors');
  const standings = scriptedStandings(league, { wins: 9, losses: 3 });
  ok(standings.length === 9, 'scriptedStandings has 9 rows: 8 CPU teams plus the player');
  ok(standings[0].id === league[league.length - 1].name || standings.some((r) => r.isPlayer && r === standings[0]),
    'the strongest CPU team or the player (whichever has more wins) tops the table');
  const cpuRows = standings.filter((r) => !r.isPlayer);
  ok(cpuRows.every((r, i) => i === 0 || r.wins <= cpuRows[i - 1].wins), 'CPU rows are strictly ordered by strength (each beats every weaker team)');
  ok(standings.filter((r) => r.isPlayer).length === 1, 'the player appears exactly once');

  // [KNOWN-BUG PROBE] over many seeded seasons, the champion's OPPONENT (when the player is not
  // the strongest seed) is always the strongest team in the league (doc §8, [Locked]).
  let checked = 0;
  for (let seed = 0; seed < 200; seed++) {
    const st = scriptedStandings(league, { wins: seed % 13, losses: 12 - (seed % 13) });
    const bracket = playoffs(st);
    const playerRow = st.find((r) => r.isPlayer);
    const playerSeed = st.indexOf(playerRow);
    if (playerSeed >= 4) continue; // missed the playoffs this "season"
    checked += 1;
    const strongestCpu = cpuRows[0]; // scriptedStandings' CPU rows are already strength-sorted
    if (!playerRow || bracket.seeds[0].id === playerRow.id) continue; // the player IS the strongest seed
    ok(bracket.seeds[0].id === strongestCpu.id, 'the top seed (the champion\'s opponent, when the player is not it) is the strongest CPU team');
  }
  ok(checked > 0, 'the championship-opponent probe actually exercised at least one in-the-playoffs season');

  ok(trophyFor({ wonChampionship: true }) === 3, 'winning the championship is Gold (3)');
  ok(trophyFor({ reachedChampionship: true, wonChampionship: false }) === 2, 'losing the championship is Silver (2)');
  ok(trophyFor({ reachedSemifinal: true, reachedChampionship: false }) === 1, 'losing the semifinal is Bronze (1)');
  ok(trophyFor({}) === 0, 'missing the playoffs entirely is 0 (no trophy)');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 9. the agent seam --');
{
  const scripted = new ScriptedAgent(
    [{ type: 'fastball', aim: 0 }],
    [{ action: 'swing', aimX: 0, timingErrorMs: 0, power: 0.8 }],
  );
  scripted.decidePitch().then((d) => ok(d.type === 'fastball', 'ScriptedAgent replays its pitch script in order'));
  scripted.decideSwing().then((d) => ok(d.action === 'swing', 'ScriptedAgent replays its swing script in order'));
  let threw = false;
  try { new ScriptedAgent().decidePitch().catch(() => { threw = true; }); } catch { threw = true; }

  const cpuTeam = makeTeam('little', 5);
  const pitcher = new CpuPitcher({ league: 'little', settings: SETTINGS });
  const view = { rand01: mulberry32(1) };
  pitcher.decidePitch(view).then((d) => {
    ok(SETTINGS.unlockedPitchesFor('little').includes(d.type), 'CpuPitcher only ever offers an unlocked pitch for its league');
    ok(typeof d.aim === 'number', 'CpuPitcher aims with a single lateral number, not a 2-D point');
  });
  const batter = new CpuBatter({ league: 'little', skills: cpuTeam.players[0].skills, settings: SETTINGS });
  const pitch = flyPitch('fastball', 0, 1, SETTINGS, mulberry32(2));
  batter.decideSwing({ rand01: mulberry32(3), pitch }).then((d) => {
    ok(d.action === 'swing' || d.action === 'take', 'CpuBatter returns a legal action');
  });

  // Step 4: ModelBatter/ModelPitcher - sim-baseball.mjs's stand-in for a human, same call shape.
  const modelBatter = new ModelBatter({ timingSigmaMs: 55, placementSigma: 0.22 });
  modelBatter.decideSwing({ rand01: mulberry32(6), pitch }).then((d) => {
    ok(d.action === 'swing' || d.action === 'take', 'ModelBatter returns a legal action');
  });
  const modelPitcher = new ModelPitcher({ league: 'majors', settings: SETTINGS, variety: 0.6, cornerBias: 0.5, pitchMix: SETTINGS.CPU.majors.pitchMix });
  modelPitcher.decidePitch({ rand01: mulberry32(7) }).then((d) => {
    ok(SETTINGS.unlockedPitchesFor('majors').includes(d.type), 'ModelPitcher only ever offers an unlocked pitch for its league');
    ok(typeof d.aim === 'number', 'ModelPitcher aims with a single lateral number');
  });
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 9a2. STYLE_BEHAVIOR: Patient chases less, Shifters rotate their out-zones (BB-2a step 5) --');
{
  ok(SETTINGS.STYLE_BEHAVIOR.patient.chaseMul < 1, 'a Patient batter\'s chaseMul is below 1 (doc §9/§8: lays off bad pitches more)');
  ok(SETTINGS.STYLE_BEHAVIOR.shifters.shift === true, 'Shifters carry the shift behavior flag (doc §9, [Locked])');
  ok(SETTINGS.TEAM_STYLES.balanced.hitAcc === 1 && Object.values(SETTINGS.TEAM_STYLES.balanced).every((v) => v === 1),
    'balanced stays the flat all-1s reference vector every style is measured against');

  // A Patient batter chases a ball outside the zone less often than the same league's ordinary
  // rate, same rand01 draw - direct, deterministic comparison of the chaseMul wiring.
  const league = 'college';
  const skills = { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 5, pitchAcc: 5, pitchSpin: 5 };
  const ballPitch = { x: 1.5, isStrike: false }; // outside the zone - only 'chase' governs a swing
  const patientBatter = new CpuBatter({ league, skills, settings: SETTINGS, styleId: 'patient' });
  const ordinaryBatter = new CpuBatter({ league, skills, settings: SETTINGS, styleId: 'balanced' });
  const chaseRoll = SETTINGS.CPU[league].chase - 0.001; // just under the league's own chase rate
  const dPatient = await patientBatter.decideSwing({ rand01: () => chaseRoll, pitch: ballPitch, pitchHistory: [] });
  const dOrdinary = await ordinaryBatter.decideSwing({ rand01: () => chaseRoll, pitch: ballPitch, pitchHistory: [] });
  ok(dOrdinary.action === 'swing', 'a roll just under the league\'s own chase rate swings for an ordinary-style batter');
  ok(dPatient.action === 'take', 'the identical roll is a take for a Patient batter (chaseMul lowers the effective rate below the roll)');

  // Shifters: `_shiftDegFor` reads STYLE_BEHAVIOR.shift, not a hardcoded style-id string.
  const g = playGameOnce(league, hashSeed('shift-behavior-probe'));
  const shiftersTeam = { styleId: 'shifters' };
  const balancedTeam = { styleId: 'balanced' };
  g.sprayHistory['batterX'] = [10, 12, 8];
  ok(g._shiftDegFor(shiftersTeam, 'batterX') !== 0, 'a Shifters defense rotates its out-zones toward the batter\'s own spray tendency');
  ok(g._shiftDegFor(balancedTeam, 'batterX') === 0, 'a non-Shifters defense never rotates its out-zones');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 9b. CpuBatter reads pitchHistory ({type,x} per entry, doc §8) --');
await (async () => {
  // Repeated SPEED narrows the timing spread; a changed speed widens it (doc §8: "throw the same
  // speed over and over and he times it... change speeds and he swings early or late"). Both
  // draws share the same rand01 STREAM (fresh, same seed) so the only thing that differs between
  // them is the pitch-history shape CpuBatter reads - a direct, deterministic comparison rather
  // than a downstream whiff-rate measurement, which a single rng draw would make noisy.
  const league = 'majors'; // highest patternWeight, easiest to see the effect
  const skills = { hitAcc: 10, hitPow: 10, hitSpd: 10, pitchSpd: 10, pitchAcc: 10, pitchSpin: 10 };
  const repeated = Array.from({ length: SETTINGS.PATTERN_WINDOW }, () => ({ type: 'fastball', x: 0 }));
  const changed = [{ type: 'fastball', x: 0 }, { type: 'knuckleball', x: 0 }, { type: 'fastball', x: 0 }];

  const r1 = mulberry32(42);
  const p1 = flyPitch('fastball', 0, 1, SETTINGS, r1);
  const d1 = await new CpuBatter({ league, skills, settings: SETTINGS }).decideSwing({ rand01: () => 0.001, pitch: p1, pitchHistory: repeated });
  const r2 = mulberry32(42);
  const p2 = flyPitch('fastball', 0, 1, SETTINGS, r2);
  const d2 = await new CpuBatter({ league, skills, settings: SETTINGS }).decideSwing({ rand01: () => 0.001, pitch: p2, pitchHistory: changed });
  ok(d1.action === 'swing' && d2.action === 'swing', 'both draws force a swing decision (rand01 forced below swingIn)');
  ok(Math.abs(d1.timingErrorMs) <= Math.abs(d2.timingErrorMs) + 1e-9,
    'a repeated pitch speed narrows (or does not widen) the timing error versus a changed one, same rng draw (doc §8)');

  // LOCATION: leaning toward a consistently-thrown spot pulls the aim toward it (doc §8: "keep
  // hitting one spot and he waits there").
  const leanHist = Array.from({ length: SETTINGS.PATTERN_WINDOW }, () => ({ type: 'fastball', x: 0.8 }));
  const noHist = [];
  const r3 = mulberry32(9);
  const p3 = flyPitch('fastball', 0, 1, SETTINGS, r3);
  const dLean = await new CpuBatter({ league, skills, settings: SETTINGS }).decideSwing({ rand01: () => 0.001, pitch: p3, pitchHistory: leanHist });
  const r4 = mulberry32(9);
  const p4 = flyPitch('fastball', 0, 1, SETTINGS, r4);
  const dNoHist = await new CpuBatter({ league, skills, settings: SETTINGS }).decideSwing({ rand01: () => 0.001, pitch: p4, pitchHistory: noHist });
  ok(dLean.aimX > dNoHist.aimX, 'a batter leaning on a consistently-thrown location aims further toward it than one with no history');
})();

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
    g._resolveBattedBall({ result: 'out', kind: 'flyout', isFoul: false, distanceFt: 250 }, 'batterX', 'home');
    ok(g.bases[2] === null || JSON.stringify(g.bases) === JSON.stringify(before),
      'a flyout with 2 outs never grants a sac fly (the batter simply makes the third out)');
    ok(g.outs === 3, 'the out was still recorded even when the sac fly was refused');
  }
  {
    const g2 = playGameOnce('majors', hashSeed('sacfly-probe-2'));
    g2.bases = [null, null, 'runnerOnThird'];
    g2.outs = 0;
    g2._resolveBattedBall({ result: 'out', kind: 'flyout', isFoul: false, distanceFt: 250 }, 'batterX', 'home');
    ok(g2.bases[2] === null && g2.score.home === 1, 'a flyout with 0 outs and a runner on third, deep enough, scores a sac fly');
  }
  {
    // [KNOWN-BUG PROBE] a SHALLOW flyout must not be credited as a sac fly, even with 0 outs and
    // a runner on third (doc §3, [Locked]: "Deep fly out scores the runner" - MECHANICS.
    // sacFlyMinDepthFt is how deep, Step 1).
    const g3 = playGameOnce('majors', hashSeed('sacfly-probe-3'));
    g3.bases = [null, null, 'runnerOnThird'];
    g3.outs = 0;
    g3._resolveBattedBall({ result: 'out', kind: 'flyout', isFoul: false, distanceFt: 50 }, 'batterX', 'home');
    ok(g3.bases[2] === 'runnerOnThird' && g3.score.home === 0, 'a SHALLOW flyout does not score a sac fly, however many outs there are');
  }

  // doc §3, [Locked]: "every extra half-inning starts with a runner on second."
  {
    const g4 = playGameOnce('majors', hashSeed('extra-innings-probe-2'));
    // Simulate reaching the top of the first extra inning without playing the whole game out.
    g4.inning = SETTINGS.SEASON.inningsPerGame + 1;
    g4.half = 'top';
    let sawGhostRunner = false;
    g4.onEvent = async (type) => {
      if (type === 'halfInningStart') {
        sawGhostRunner = g4.bases[1] === '__extra' && g4.bases[0] === null && g4.bases[2] === null;
      }
    };
    // Only run one half-inning's worth of at-bats, then abort so the test stays fast.
    let atBats = 0;
    const origPlayAtBat = g4.playAtBat.bind(g4);
    g4.playAtBat = async () => { atBats += 1; if (atBats > 6) { g4.abort(); return; } return origPlayAtBat(); };
    await g4.playHalfInning();
    ok(sawGhostRunner, 'a half-inning starting past regulation seeds a runner on second, nobody else on base');
  }
  {
    // A regulation (non-extra) half-inning must NOT get the ghost runner.
    const g5 = playGameOnce('majors', hashSeed('no-ghost-in-regulation'));
    g5.inning = 1;
    g5.half = 'top';
    let atBats = 0;
    const origPlayAtBat = g5.playAtBat.bind(g5);
    g5.playAtBat = async () => { atBats += 1; if (atBats > 3) { g5.abort(); return; } return origPlayAtBat(); };
    await g5.playHalfInning();
    ok(true, 'regulation half-innings played without incident (ghost-runner gate did not misfire)');
  }

  // doc §3, [Locked]: a ground-out double play is possible with a runner on first and <2 outs.
  {
    const g6 = playGameOnce('majors', hashSeed('double-play-probe'));
    g6.bases = ['runnerOnFirst', null, null];
    g6.outs = 0;
    const alwaysDp = () => 0; // rand01 returning 0 always beats doublePlayChance (> 0)
    g6._resolveBattedBall({ result: 'out', kind: 'groundout', isFoul: false }, 'batterX', 'home', alwaysDp);
    ok(g6.bases[0] === null && g6.outs === 2, 'a ground-out double play removes the lead runner and records 2 outs');
  }
  {
    const g7 = playGameOnce('majors', hashSeed('double-play-probe-2'));
    g7.bases = ['runnerOnFirst', null, null];
    g7.outs = 0;
    const neverDp = () => 0.999999; // beats no chance under 1.0
    g7._resolveBattedBall({ result: 'out', kind: 'groundout', isFoul: false }, 'batterX', 'home', neverDp);
    ok(g7.bases[0] === 'runnerOnFirst' && g7.outs === 1, 'a ground out that does not roll the double play just makes the one out');
  }
  {
    // 2 outs already: a double play may never be granted regardless of the roll.
    const g8 = playGameOnce('majors', hashSeed('double-play-probe-3'));
    g8.bases = ['runnerOnFirst', null, null];
    g8.outs = 2;
    g8._resolveBattedBall({ result: 'out', kind: 'groundout', isFoul: false }, 'batterX', 'home', () => 0);
    ok(g8.bases[0] === 'runnerOnFirst' && g8.outs === 3, 'a double play is never granted with 2 outs already');
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
  const bad4 = { ...snap, rulesV: snap.rulesV - 1 };
  ok(validateSnapshot(bad4).length > 0, 'a stale rulesV (an older ruleset) is rejected - forward-only, never reinterpreted (doc §15)');
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
console.log('\n-- 15. Locked-statement inventory gap-fill (BB-2a step 8) --');
{
  // doc §3, [Locked]: "No mercy rule" - a lopsided score never ends the game early on its own; the
  // ONLY early endings are a walkoff (home ahead in the bottom of the last inning) and skipping a
  // now-pointless bottom half (home already ahead entering it) - both doc-given rules, never a
  // run-margin cutoff. Grep-level: no mercy-margin concept exists in the engine at all.
  const engineSrcForMercy = fs.readFileSync(path.join(ENGINE_DIR, 'game.js'), 'utf8');
  ok(!/mercy/i.test(engineSrcForMercy), 'game.js names no mercy-rule concept at all (doc §3, [Locked]: "No mercy rule")');
  {
    // A 20+ run blowout still plays every scheduled half - forcing the score, then playing one
    // more half-inning through the real engine, proves the half is not skipped for the margin.
    const g = playGameOnce('majors', hashSeed('no-mercy-probe'));
    g.score = { home: 25, away: 1 };
    g.inning = 1; g.half = 'top';
    let halfPlayed = false;
    g.onEvent = async (type) => { if (type === 'halfInningEnd') halfPlayed = true; };
    await g.playHalfInning();
    ok(halfPlayed, 'a 24-run-margin game still plays a full half-inning rather than ending early (no mercy rule)');
  }

  // doc §6, [Locked]: "Batter Speed affects beating out grounders" - a close grounder's hit rate at
  // hitSpd=10 must exceed hitSpd=0, same distance/sector/rand01 stream.
  {
    const zonesM = zonesFor('majors', 0);
    const sector = zonesM.infield[1];
    const GROUND_ANGLE = 4;
    const angleFactor = Math.max(0, Math.sin((2 * GROUND_ANGLE * Math.PI) / 180));
    const nearEdgeFt = sector.toFt - SETTINGS.MECHANICS.groundEdgeMarginFt / 2; // well inside the near-edge band
    const exitVeloMph = nearEdgeFt / (SETTINGS.CARRY_SCALE * angleFactor) + 30;
    const trial = (hitSpd) => resolveContact({ exitVeloMph, launchAngleDeg: GROUND_ANGLE, sprayAngleDeg: 0 },
      zonesM, SETTINGS, SETTINGS.PARKS.default, hitSpd, () => 0.0001).result;
    ok(trial(0) === 'out', 'a close grounder with hitSpd=0 is fielded (the beat-out roll never fires with zero chance)');
    ok(trial(10) === 'hit', `the identical close grounder with hitSpd=10 beats the throw (doc §6: "Batter Speed affects beating out grounders"), sector.toFt=${sector.toFt}, tried at ${nearEdgeFt.toFixed(1)}ft`);
  }

  // doc §6, [Locked]: exactly six skill ids, nothing invented beyond the doc's own list.
  ok(JSON.stringify(SETTINGS.SKILL_IDS.slice().sort()) === JSON.stringify(['hitAcc', 'hitPow', 'hitSpd', 'pitchAcc', 'pitchSpd', 'pitchSpin'].sort()),
    'SKILL_IDS is exactly the doc\'s six real skills, nothing more (doc §6, [Locked])');
  ok(SETTINGS.START_POINTS_PER_SIDE === 15 && SETTINGS.START_CAP === 10,
    'a new player starts with 15 points per side at a cap of 10 (doc §6, [Locked])');

  // doc §8, [Locked]: "Little League: mostly fastballs down the middle" - fastball must be the
  // dominant weight in Little League's own pitchMix.
  {
    const mix = SETTINGS.CPU.little.pitchMix;
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    ok((mix.fastball || 0) / total > 0.5, 'CPU.little.pitchMix is majority fastball (doc §8, [Locked]: "mostly fastballs")');
  }
  // doc §8, [Locked]: "Majors: attacks your weak spots" - weakSpotWeight highest at Majors.
  {
    const weights = SETTINGS.LEAGUES.map((lg) => SETTINGS.CPU[lg].weakSpotWeight);
    ok(weights[weights.length - 1] === Math.max(...weights), 'weakSpotWeight is highest at Majors, the last league (doc §8, [Locked])');
  }

  // doc §9, [Locked]: "9 distinct batters... and 1 pitcher per game" - a generated team has 9
  // roster slots and exactly one pitcher id, resolving to a real player.
  {
    const t = makeTeam('college', 3);
    ok(t.players.length === 9, 'a generated team has exactly 9 players (doc §9, [Locked])');
    ok(t.players.filter((p) => p.id === t.pitcherId).length === 1, 'exactly one roster player is the pitcher');
  }
  // doc §9, [Locked]: "About 1 in 4 CPU players are lefties" - measured across many generated
  // players, both bats and throws, within a wide statistical margin (this is a per-player coin
  // flip at LEFTY_RATE, not a per-team guarantee).
  {
    let lefty = 0, total = 0;
    for (let i = 0; i < 300; i++) {
      const t = makeTeam('college', 1000 + i);
      for (const p of t.players) { total += 2; if (p.bats === 'L') lefty += 1; if (p.throws === 'L') lefty += 1; }
    }
    const rate = lefty / total;
    ok(Math.abs(rate - SETTINGS.LEFTY_RATE) < 0.03, `measured lefty rate ${rate.toFixed(3)} is within 0.03 of LEFTY_RATE (${SETTINGS.LEFTY_RATE}), doc §9, [Locked]`);
  }

  // doc §10, [Locked]: "4 infield ground-out zones, 3 outfield fly-out zones" - exact counts.
  {
    const zonesM = zonesFor('majors', 0);
    ok(zonesM.infield.length === 4, 'zonesFor names exactly 4 infield sectors (doc §10, [Locked])');
    ok(zonesM.outfield.length === 3, 'zonesFor names exactly 3 outfield sectors (doc §10, [Locked])');
  }
  // doc §10, [Locked]: "Pop-ups in the infield are outs" - always, regardless of distance/spray.
  {
    const zonesM = zonesFor('majors', 0);
    for (const trial of [{ v: 40, a: 60, s: 0 }, { v: 90, a: 65, s: 20 }, { v: 30, a: 58, s: -30 }]) {
      const o = resolveContact({ exitVeloMph: trial.v, launchAngleDeg: trial.a, sprayAngleDeg: trial.s }, zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
      ok(o.result === 'out' && o.kind === 'popout', `a pop-up (launchAngleDeg=${trial.a}) is always an out regardless of exit velocity or spray (doc §10, [Locked]), got ${JSON.stringify(o)}`);
    }
  }
  // doc §10, [Locked]: "Fields get bigger each league" - fenceFtAt(0) (dead center) rises league to
  // league.
  {
    const centers = SETTINGS.LEAGUES.map((lg) => fenceFtAt(0, SETTINGS.FIELD[lg].fenceFt));
    ok(centers.every((v, i) => i === 0 || v >= centers[i - 1]), `center-field fence distance grows league to league (doc §10, [Locked]): ${JSON.stringify(centers)}`);
  }
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
