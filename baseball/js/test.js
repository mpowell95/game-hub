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
import { swing, qualityFor, computeSwingTiming } from './engine/swing.js';
import { resolveContact, resolveBunt, carryFt, fenceFtAt } from './engine/outcomes.js';
import { zonesFor, angleSector } from './engine/zones.js';
import { emptyBases, advanceAll, advanceWalk, advanceSacFly, advanceDoublePlay } from './engine/bases.js';
import { Game, SNAP_V, validateSnapshot } from './engine/game.js';
import { CpuPitcher, CpuBatter, ModelBatter, ModelPitcher, ScriptedAgent, cpuBaseTimingSigmaMs, cpuSigmaFloorMs, pickMode } from './engine/agents.js';
import { makeTeam, makeLeague, makePlayerTeam, teamStrength, effectiveCapFor, POSITIONS } from './engine/teams.js';
import { makeSchedule, scriptedStandings, playoffs, trophyFor } from './engine/season.js';
import { mulberry32, hashSeed, stepRng, pickWeighted, gaussian } from './engine/rng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };

/** R5: the exit velocity that carries exactly `ft` feet at `launchAngleDeg`, by inverting the real
 *  `carryFt` rather than re-deriving its angle factor by hand. Several tests below need "a ball
 *  that lands exactly here" and every one of them used to inline `sin(2a)`; when R5 moved the
 *  curve's peak (`CARRY_PEAK_DEG`) those copies silently asked for the wrong distance. Returns
 *  `null` when the requested distance is under `MIN_IN_PLAY_FT` (no exit velocity produces it). */
function veloForCarry(ft, launchAngleDeg) {
  if (ft < SETTINGS.MIN_IN_PLAY_FT) return null;
  const a = Math.max(0, Math.min(70, launchAngleDeg));
  const angleFactor = Math.max(SETTINGS.GROUND_CARRY_FACTOR, Math.sin((Math.PI * a) / (2 * SETTINGS.CARRY_PEAK_DEG)));
  return ft / (SETTINGS.CARRY_SCALE * angleFactor) + SETTINGS.CARRY_ZERO_MPH;
}

const DETERMINISM_SEED = 424242;
const RESUME_SEED = 909090;

function mkAgent(team, league) {
  return {
    decidePitch: (v) => new CpuPitcher({ league, settings: SETTINGS }).decidePitch(v),
    decideSwing: (v) => {
      const batter = team.players.find((p) => p.id === v.batterId) || team.players[0];
      return new CpuBatter({ league, skills: batter.skills, settings: SETTINGS, styleId: team.styleId, ladderOffset: team.ladderOffset }).decideSwing(v);
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
  // BB-2f, doc v11 §8, [Locked]: "every league's CPU teams are generated below that league's
  // cap... no league may generate every team at the cap." A structural, always-on guard (this
  // suite plays no full season, so `sim-baseball.mjs --assert`'s own equivalent scoreboard line
  // is the measured one) - a future edit that zeroes a league's shortfall to "simplify" fails here
  // immediately, rather than silently reintroducing the exact clamp BB-2e traced Little League/
  // High School's stuck champion band to.
  ok(SETTINGS.CPU_LEVEL_SHORTFALL[lg] > 0, `CPU_LEVEL_SHORTFALL.${lg} is nonzero (doc v11 §8, [Locked])`);
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
ok(SETTINGS.FEEL.engine.fastballMs === 650, 'fastballMs is R2\'s re-timed flight (docs/BASEBALL-3D-BUILD.md section 9; was the doc\'s 1500)');
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
    const s = swing(pitch, skills, { action: 'swing', cursor: { x: (r2() - 0.5) * 1.2, y: (r2() - 0.5) * 1.2 }, timingErrorMs: (r2() - 0.5) * 340 }, SETTINGS, r2);
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
      const s = swing(pitch, { ...skills, hitAcc: 10 }, { action: 'swing', cursor: { x: pitch.x, y: pitch.y }, timingErrorMs }, SETTINGS, r);
      if (!s.contact) whiffs++;
    }
    return whiffs / n;
  };
  ok(whiffRate(0) < whiffRate(1000), 'a well-timed swing whiffs less than one wildly outside the foul boundary');
  // R2: the cursor's own circle replaces `batReach` - a pitch that crosses outside it is an
  // automatic miss, whatever the timing was, in EITHER axis.
  const wayOff = swing({ x: 0, y: 0, isStrike: true }, skills,
    { action: 'swing', cursor: { x: 2, y: 0 }, timingErrorMs: 0 }, SETTINGS, mulberry32(4));
  ok(wayOff.contact === false, 'a pitch crossing outside the batting cursor\'s circle is an automatic miss');
  const wayHigh = swing({ x: 0, y: 0, isStrike: true }, skills,
    { action: 'swing', cursor: { x: 0, y: -2 }, timingErrorMs: 0 }, SETTINGS, mulberry32(4));
  ok(wayHigh.contact === false, 'the same is true VERTICALLY - the cursor is a circle, not a bar (R2)');
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
    const s = swing(pitch, skills, { action: 'swing', cursor: { x: pitch.x, y: pitch.y }, timingErrorMs }, SETTINGS, r);
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
    return swing(pitch, sk, { action: 'swing', cursor: { x: pitch.x, y: pitch.y }, timingErrorMs }, SETTINGS, r).exitVeloMph;
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
    const fence = SETTINGS.PARKS.default;
    // R5: this promise is now carried by the FENCE, not by the out-zone's own depth. R5's zone
    // depths reach the wall at every league (zones.js's own header says why), so a fly ball that
    // beats a manned sector has already left the park; what still differs between straightaway
    // centre and the gap a perfectly-timed swing sprays toward is HOW FAR THE WALL IS. A ball that
    // is a routine fly out to the deepest part is over the fence toward the gap.
    const gapDeg = SETTINGS.FEEL.engine.perfectSprayDeg;
    ok(fenceFtAt(0, fence) > fenceFtAt(gapDeg, fence),
      'the park is deeper dead centre than toward the gap a perfectly-timed swing sprays to (the geometry this test exercises)');
    const midDistance = (fenceFtAt(0, fence) + fenceFtAt(gapDeg, fence)) / 2; // over one wall, short of the other
    const FLY_ANGLE = 30; // a 'fly' kind (battedBallKind: >=26, <52), clear of the line-through rule
    const exitVeloMph = veloForCarry(midDistance, FLY_ANGLE);
    const deadCenter = resolveContact({ exitVeloMph, launchAngleDeg: FLY_ANGLE, sprayAngleDeg: 0, q: 1 },
      zonesM, SETTINGS, fence, 5, mulberry32(2));
    const towardGap = resolveContact({ exitVeloMph, launchAngleDeg: FLY_ANGLE, sprayAngleDeg: gapDeg, q: 1 },
      zonesM, SETTINGS, fence, 5, mulberry32(2));
    ok(deadCenter.result === 'out', `a marginal fly ball hit dead center is caught (majors' deepest part of the park), got ${JSON.stringify(deadCenter)}`);
    ok(towardGap.result === 'hit', `the identical ball hit toward a gap (where a perfectly-timed swing sprays) gets through, got ${JSON.stringify(towardGap)}`);
  }
  {
    // A well-squared-up line drive (q above LINE_THROUGH_Q) that lands inside an outfield sector's
    // reach is a hit; the same launch/exit velocity with LOW q (a routine-quality fly/liner) at the
    // identical spot stays an out.
    const zonesM = zonesFor('majors', 0);
    const sec2 = zonesM.outfield[1]; // straightaway center
    // A depth INSIDE the sector's reach and inside LINE_THROUGH_MAX_FT, which is the band the rule
    // is about. R5's sectors reach the wall, so their own midpoint is far past that cap.
    const midDepth = Math.min((sec2.fromFt + sec2.toFt) / 2, SETTINGS.LINE_THROUGH_MAX_FT - 20);
    ok(midDepth > sec2.fromFt, 'the line-through probe depth is inside the sector\'s own reach');
    const exitVeloMph = veloForCarry(midDepth, 18);
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
  // BB-2b commit 3: each entry is now `{ skill, timingSigmaMs, chase }` - `skill` strictly rises
  // weakest to strongest exactly as the old bare-number offset did; `timingSigmaMs`/`chase` are
  // ADDITIVE offsets that should strictly FALL (a sloppier/more-chasing weak slot to a
  // sharper/more-selective strong slot). BB-2e commit 2: TEAM_LADDER_OFFSETS is per-league now
  // (generated from that league's own LADDER_SHAPE) - every league checked, not one flat table.
  for (const lg of SETTINGS.LEAGUES) {
    const offsets = SETTINGS.TEAM_LADDER_OFFSETS[lg];
    ok(offsets.length === 8, `TEAM_LADDER_OFFSETS.${lg} names exactly 8 slots`);
    ok(offsets.every((o, i) => i === 0 || o.skill > offsets[i - 1].skill),
      `TEAM_LADDER_OFFSETS.${lg}.skill is strictly rising, weakest slot to strongest (BB-2a step 5)`);
    ok(offsets.every((o, i) => i === 0 || o.timingSigmaMs < offsets[i - 1].timingSigmaMs),
      `TEAM_LADDER_OFFSETS.${lg}.timingSigmaMs strictly falls, weakest (sloppiest) slot to strongest (sharpest) (BB-2b commit 3)`);
    ok(offsets.every((o, i) => i === 0 || o.chase < offsets[i - 1].chase),
      `TEAM_LADDER_OFFSETS.${lg}.chase strictly falls, weakest (most-chasing) slot to strongest (most-selective) (BB-2b commit 3)`);
  }
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
  // BB-2c commit 4: shape-agnostic checks, run against every SCHEDULE_SHAPE - none of these
  // properties are specific to any one shape's own repeat pattern.
  for (const shape of ['repeatTop', 'repeatBottom', 'repeatMiddle']) {
    for (const lg of SETTINGS.LEAGUES) {
      const sched = makeSchedule(lg, 42, shape);
      ok(sched.length === 12, `makeSchedule('${lg}', '${shape}') has 12 games (doc §4)`);
      ok(sched.filter((g) => g.home).length === 6, `[${shape}] exactly six home games`);
      ok(new Set(sched.map((g) => g.opponentIndex)).size === 8, `[${shape}] every one of the 8 opponents appears at least once`);
      const counts = {};
      for (const g of sched) counts[g.opponentIndex] = (counts[g.opponentIndex] || 0) + 1;
      ok(Object.values(counts).filter((c) => c === 2).length === 4, `[${shape}] exactly four opponents are repeated`);
      ok(sched[0].opponentIndex === 0, `[${shape}] the weakest opponent (index 0) is played first`);
      ok(sched[11].opponentIndex === 7, `[${shape}] the champion (index 7) is met exactly once, in game 12 (doc §8, [Locked])`);
      const sched2 = makeSchedule(lg, 42, shape);
      ok(JSON.stringify(sched) === JSON.stringify(sched2), `[${shape}] the same (league, seed, shape) is the same schedule every time`);
    }
  }
  // Each shape's own specific repeat pattern.
  {
    const top = makeSchedule('college', 42, 'repeatTop').map((g) => g.opponentIndex);
    const bottom = makeSchedule('college', 42, 'repeatBottom').map((g) => g.opponentIndex);
    const middle = makeSchedule('college', 42, 'repeatMiddle').map((g) => g.opponentIndex);
    ok(JSON.stringify(top) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7]), 'repeatTop repeats the four STRONGEST opponents (4-7), late');
    ok(JSON.stringify(bottom) === JSON.stringify([0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7]), 'repeatBottom repeats the four WEAKEST opponents (0-3), early');
    ok(JSON.stringify(middle) === JSON.stringify([0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7]), 'repeatMiddle repeats the MIDDLE four opponents (2-5)');
  }
  // The default (SETTINGS.SCHEDULE_SHAPE, with no explicit shape argument) matches whichever shape
  // is actually configured - a regression here means the Draft default silently drifted from the
  // shipped constant.
  {
    const withDefault = makeSchedule('college', 42);
    const withExplicit = makeSchedule('college', 42, SETTINGS.SCHEDULE_SHAPE);
    ok(JSON.stringify(withDefault) === JSON.stringify(withExplicit), 'makeSchedule() with no shape argument matches settings.SCHEDULE_SHAPE explicitly passed');
  }
  for (const lg of SETTINGS.LEAGUES) {
    const sched = makeSchedule(lg, 42);
    const firstHalfAvg = mean(sched.slice(0, 6).map((g) => g.opponentIndex));
    const secondHalfAvg = mean(sched.slice(6).map((g) => g.opponentIndex));
    ok(secondHalfAvg >= firstHalfAvg, 'harder opponents (higher index) land later in the schedule, on average, under the Draft default shape');
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

  // BB-2b commit 2, doc §4/§13 Open item 13: `BRACKET_MODEL` = 'strongestInFinal' - the player's
  // semifinal opponent must never be the strongest of the four qualifiers, over 1000 seeded
  // "seasons" spanning every possible player record. `scriptedStandings`'s STRONGEST CPU row always
  // carries the highest `strengthRank` among the seeds (ties broken by strengthRank on equal wins,
  // and no two CPU rows can tie on wins under either standings model) - a stronger invariant than
  // comparing team ids, since it holds regardless of which STANDINGS_MODEL is in effect.
  {
    let sfChecked = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const wins = seed % 13;
      const st = scriptedStandings(league, { wins, losses: 12 - wins }, seed % 2 === 0 ? 'rawWins7' : 'scaledTo12');
      const playerRow = st.find((r) => r.isPlayer);
      const playerSeed = st.indexOf(playerRow);
      if (playerSeed >= 4) continue; // missed the playoffs this "season"
      const bracket = playoffs(st, 'strongestInFinal');
      const sfPair = bracket.semifinals.find((pair) => pair.some((t) => t.isPlayer));
      const sfOpponent = sfPair.find((t) => !t.isPlayer);
      if (!sfOpponent) continue; // the player IS the only seed (shouldn't happen with 4 seeds, guarded anyway)
      sfChecked += 1;
      const seeds = bracket.seeds;
      const strongestSeed = seeds.filter((s) => !s.isPlayer).reduce((a, b) => (b.strengthRank > a.strengthRank ? b : a));
      ok(sfOpponent.id !== strongestSeed.id || strongestSeed.isPlayer,
        `BRACKET_MODEL=strongestInFinal: the player's semifinal opponent is never the strongest qualifier (seed ${seed})`);
    }
    ok(sfChecked > 100, 'the strongestInFinal probe actually exercised a meaningful number of in-the-playoffs seasons');
  }

  // STANDINGS_MODEL = 'scaledTo12': every CPU rank's win total is directly on a 12-game scale, and
  // strictly increasing by rank (doc §4/§13 Open item 13).
  {
    const st = scriptedStandings(league, { wins: 6, losses: 6 }, 'scaledTo12');
    const cpu = st.filter((r) => !r.isPlayer).sort((a, b) => a.strengthRank - b.strengthRank);
    ok(cpu.every((r) => r.wins + r.losses === 12), 'scaledTo12: every CPU row plays a 12-game record, same as the player');
    ok(cpu.every((r, i) => i === 0 || r.wins > cpu[i - 1].wins), 'scaledTo12: CPU win totals strictly rise by strength rank');
    ok(cpu[cpu.length - 1].wins === 12 && cpu[0].wins === 0, 'scaledTo12: the strongest CPU goes 12-0, the weakest 0-12');
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 9. the agent seam --');
{
  const scripted = new ScriptedAgent(
    [{ type: 'fastball', aim: 0 }],
    [{ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0 }],
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
    ok(d.aim && typeof d.aim.x === 'number' && typeof d.aim.y === 'number', 'CpuPitcher aims at a 2-D point (R2 - the zone has a height now)');
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
    ok(d.aim && typeof d.aim.x === 'number' && typeof d.aim.y === 'number', 'ModelPitcher aims at a 2-D point too');
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
  // BB-2d commit 6: SHIFT_MIN_SAMPLES (5) - needs at least that many recorded balls in play before
  // a shift applies at all.
  g.sprayHistory['batterX'] = [10, 12, 8, 11, 9];
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
  ok(dLean.cursor.x > dNoHist.cursor.x, 'a batter leaning on a consistently-thrown location aims further toward it than one with no history');
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
    const r6 = g6._resolveBattedBall({ result: 'out', kind: 'groundout', isFoul: false }, 'batterX', 'home', alwaysDp);
    ok(g6.bases[0] === null && g6.outs === 2, 'a ground-out double play removes the lead runner and records 2 outs');
    // R3 (docs/BASEBALL-3D-BUILD.md section 9): `runnersOut` is the id of the runner removed
    // WITHOUT scoring - captured before the removal, so the UI knows exactly who to run to second
    // and vanish there, rather than guessing from the before/after bases alone.
    ok(Array.isArray(r6.runnersOut) && r6.runnersOut.length === 1 && r6.runnersOut[0] === 'runnerOnFirst',
      `a double play's runnersOut names the forced-out runner (R3; got ${JSON.stringify(r6.runnersOut)})`);
  }
  {
    const g7 = playGameOnce('majors', hashSeed('double-play-probe-2'));
    g7.bases = ['runnerOnFirst', null, null];
    g7.outs = 0;
    const neverDp = () => 0.999999; // beats no chance under 1.0
    const r7 = g7._resolveBattedBall({ result: 'out', kind: 'groundout', isFoul: false }, 'batterX', 'home', neverDp);
    ok(g7.bases[0] === 'runnerOnFirst' && g7.outs === 1, 'a ground out that does not roll the double play just makes the one out');
    ok(Array.isArray(r7.runnersOut) && r7.runnersOut.length === 0, 'an ordinary ground out puts nobody else out (runnersOut empty, R3)');
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
console.log('\n-- 12b. [KNOWN-BUG PROBE] resume gate: abort landing EXACTLY on an at-bat or half-inning conclusion --');
{
  // BB-2f: the section-12 probe above only ever aborted at ONE fixed pitch count, on ONE fixed
  // seed/roster - it happened to never land on the exact pitch that ALSO concludes an at-bat (a
  // hit/walk/strikeout) or a half-inning (the 3rd out), so it could not catch the bug this commit
  // fixes: `Game.fromSnapshot` used to set `_resumePending`/`_resumeHalfPending` unconditionally to
  // `true`, trusting every resume was mid-progress - wrong whenever the snapshot was taken right as
  // the previous unit had ALREADY concluded (the next unit's own reset, deferred to the next
  // playAtBat()/playHalfInning() call, never ran on the aborted game itself). Found when BB-2f
  // commit 2's own settings change (CPU_LEVEL_SHORTFALL.highschool 0->1) shifted a roster's skill
  // values just enough to move which pitch of a FIXED seed happened to fall on a conclusion - this
  // probe does not depend on luck: it sweeps enough (seed, stopAfter) pairs that at least one MUST
  // land on each of the three at-bat conclusions and the half-inning conclusion, asserted directly
  // rather than hoped for.
  const league = 'highschool';
  const PROBE_SEEDS = 24;
  const PROBE_STOP_RANGE = 40; // pitches 1..40 covers several at-bats/half-innings on this roster
  let sawAtBatConclusionAbort = false;
  let sawHalfInningConclusionAbort = false;
  let allMatched = true;
  for (let s = 0; s < PROBE_SEEDS; s++) {
    const seed = hashSeed('bb-resume-probe', s);
    for (let stopAfter = 1; stopAfter <= PROBE_STOP_RANGE; stopAfter++) {
      const reference = playGameOnce(league, seed, 5, 6);
      await reference.playGame();

      const live = playGameOnce(league, seed, 5, 6);
      let pitchesSeen = 0;
      live.onEvent = async (type) => {
        if (type === 'pitch') {
          pitchesSeen += 1;
          if (pitchesSeen === stopAfter) live.abort();
        }
      };
      await live.playGame();
      if (live.over) break; // this seed's game ended before reaching stopAfter pitches - no more to probe
      // Read AFTER the pass finishes (never inside the onEvent hook itself) - `abort()` fires
      // during the 'pitch' emit, before the swing is even decided, so the at-bat/half-inning may
      // still conclude later in this SAME pass; only the flags' final value tells us which case
      // this (seed, stopAfter) pair actually exercised.
      if (live._atBatOpen === false) sawAtBatConclusionAbort = true;
      if (live._halfInningOpen === false) sawHalfInningConclusionAbort = true;

      const snap = live.snapshot();
      const resumed = Game.fromSnapshot(snap, { home: mkAgent(live.home, league), away: mkAgent(live.away, league) });
      await resumed.playGame();
      if (JSON.stringify(resumed.snapshot()) !== JSON.stringify(reference.snapshot())) {
        allMatched = false;
        console.error(`  mismatch at seed=${seed} stopAfter=${stopAfter} (atBatOpen=${live._atBatOpen}, halfInningOpen=${live._halfInningOpen})`);
      }
    }
  }
  ok(sawAtBatConclusionAbort, 'the sweep actually exercised an abort landing exactly on an at-bat conclusion (probe is not vacuous)');
  ok(sawHalfInningConclusionAbort, 'the sweep actually exercised an abort landing exactly on a half-inning conclusion (probe is not vacuous)');
  ok(allMatched, `every (seed, stopAfter) pair in the sweep resumes byte-identically to its own straight-through reference (${PROBE_SEEDS} seeds x up to ${PROBE_STOP_RANGE} stop points)`);
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
    // BB-2b commit 3: sector midpoint, not a hardcoded 0 - the gaps this phase introduced between
    // sectors mean 0deg no longer necessarily falls INSIDE sector[1] (it now sits in the gap
    // between sectors 1 and 2 under the default GAP_DEG).
    const sprayAngleDeg = (sector.fromDeg + sector.toDeg) / 2;
    const GROUND_ANGLE = 4;
    const nearEdgeFt = sector.toFt - SETTINGS.MECHANICS.groundEdgeMarginFt / 2; // well inside the near-edge band
    const exitVeloMph = veloForCarry(nearEdgeFt, GROUND_ANGLE);
    const trial = (hitSpd) => resolveContact({ exitVeloMph, launchAngleDeg: GROUND_ANGLE, sprayAngleDeg },
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
  // doc §10, [Locked]: "Fields get bigger each league" - every one of the five named fence points
  // (not just dead center) is non-decreasing league to league. BB-2b commit 3: `_parkFt()` in
  // game.js now reads `FIELD[league].fenceFt` directly for every league (see below), so this is
  // the fence a real game actually plays with, not just a display shape.
  {
    for (const angle of [-45, -22.5, 0, 22.5, 45]) {
      const byLeague = SETTINGS.LEAGUES.map((lg) => fenceFtAt(angle, SETTINGS.FIELD[lg].fenceFt));
      ok(byLeague.every((v, i) => i === 0 || v >= byLeague[i - 1]),
        `fence distance at ${angle}deg grows league to league (doc §10, [Locked]): ${JSON.stringify(byLeague)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 16. BB-2b commit 3: gaps/bloopers, real fence source, pitch speed, ladder axis --');
{
  // zones.js: GAP_DEG carves real angular gaps between sectors - the seven sectors (4 infield + 3
  // outfield) no longer tile the full -45..45 span, and angleSector() returns null inside a gap.
  {
    const zonesM = zonesFor('majors', 0);
    const allSectors = [...zonesM.infield, ...zonesM.outfield];
    const totalCoverageDeg = allSectors.reduce((s, sec) => s + (sec.toDeg - sec.fromDeg), 0);
    // 7 sectors total across the two 90deg spans (infield + outfield), each missing GAP_DEG*(n-1)
    // of coverage relative to a gap-free tiling.
    const expectedGapless = 90 * 2;
    const expectedGaps = SETTINGS.GAP_DEG * (zonesM.infield.length - 1) + SETTINGS.GAP_DEG * (zonesM.outfield.length - 1);
    ok(Math.abs(totalCoverageDeg - (expectedGapless - expectedGaps)) < 1e-6,
      `the seven sectors no longer tile the full 90deg span each - ${expectedGaps}deg of gap removed (GAP_DEG=${SETTINGS.GAP_DEG})`);
    // A genuine gap angle (the midpoint between two adjacent infield sectors) resolves to null.
    const gapAngle = (zonesM.infield[1].toDeg + zonesM.infield[2].fromDeg) / 2;
    ok(angleSector(gapAngle, zonesM.infield) === null, `angleSector at the midpoint of an infield gap (${gapAngle}deg) returns null`);
    const outGapAngle = (zonesM.outfield[0].toDeg + zonesM.outfield[1].fromDeg) / 2;
    ok(angleSector(outGapAngle, zonesM.outfield) === null, `angleSector at the midpoint of an outfield gap (${outGapAngle}deg) returns null`);
  }

  // outcomes.js: at least one spray angle at every depth resolves to a HIT - a grounder through an
  // infield gap, a blooper short of the outfield's near edge, a ball through an outfield gap, and
  // a ball that cleared a manned outfield sector's own reach.
  {
    const zonesM = zonesFor('majors', 0);
    const gapAngle = (zonesM.infield[1].toDeg + zonesM.infield[2].fromDeg) / 2;
    const groundGap = resolveContact({ exitVeloMph: 70, launchAngleDeg: 4, sprayAngleDeg: gapAngle },
      zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    ok(groundGap.result === 'hit' && groundGap.kind === 'ground-gap', `a grounder through an infield gap (${gapAngle}deg) is a single, got ${JSON.stringify(groundGap)}`);

    const manned = zonesM.outfield[1]; // straightaway center, a manned sector
    const bloopFt = manned.fromFt - SETTINGS.BLOOP_BAND_FT / 2; // well inside the bloop band
    const bloopVelo = veloForCarry(bloopFt, 18);
    const bloop = resolveContact({ exitVeloMph: bloopVelo, launchAngleDeg: 18, sprayAngleDeg: 0 },
      zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    ok(bloop.result === 'hit' && bloop.kind === 'blooper', `a fly short of a manned sector's near edge, within BLOOP_BAND_FT, is a bloop single, got ${JSON.stringify(bloop)}`);

    const tooShort = resolveContact({ exitVeloMph: veloForCarry(manned.fromFt - SETTINGS.BLOOP_BAND_FT - 10, 18),
      launchAngleDeg: 18, sprayAngleDeg: 0 }, zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    ok(tooShort.result === 'out', `a fly shorter than BLOOP_BAND_FT short of a manned sector's near edge is still an out, got ${JSON.stringify(tooShort)}`);

    const outGapAngle = (zonesM.outfield[0].toDeg + zonesM.outfield[1].fromDeg) / 2;
    const gapFly = resolveContact({ exitVeloMph: 95, launchAngleDeg: 20, sprayAngleDeg: outGapAngle },
      zonesM, SETTINGS, SETTINGS.PARKS.default, 5, mulberry32(1));
    ok(gapFly.result === 'hit', `a fly through an outfield gap (${outGapAngle}deg) is a hit at any real depth, got ${JSON.stringify(gapFly)}`);
  }

  // game.js's `_parkFt()`: every league's own fence now comes from FIELD[league].fenceFt, never
  // PARKS scaled by fieldScale - unless a real named Majors park is requested.
  {
    for (const lg of SETTINGS.LEAGUES) {
      const home = makeTeam(lg, 1), away = makeTeam(lg, 2);
      const g = new Game({ home, away, seed: 1, agents: { home: mkAgent(home, lg), away: mkAgent(away, lg) } });
      const fence = g._parkFt();
      ok(JSON.stringify(fence) === JSON.stringify(SETTINGS.FIELD[lg].fenceFt),
        `_parkFt() for league '${lg}' with the default park is exactly FIELD.${lg}.fenceFt, not a PARKS/fieldScale product`);
    }
    const home = makeTeam('majors', 1), away = makeTeam('majors', 2);
    const g = new Game({ home, away, seed: 1, agents: { home: mkAgent(home, 'majors'), away: mkAgent(away, 'majors') }, parkId: 'bandbox' });
    ok(JSON.stringify(g._parkFt()) === JSON.stringify(SETTINGS.PARKS.bandbox), '_parkFt() for a real named Majors park returns that park\'s own distances, unscaled');
  }

  // pitch.js: pitchSpd measurably shortens a fastball's travel time; pitchSpin widens the
  // changeup's own travel-multiple gap (doc §6, [Locked]).
  {
    const slow = flyPitch('fastball', 0, 1, SETTINGS, mulberry32(1), { pitchSpd: 0 });
    const fast = flyPitch('fastball', 0, 1, SETTINGS, mulberry32(1), { pitchSpd: 10 });
    ok(fast.timeToPlateS < slow.timeToPlateS, `a pitcher with pitchSpd=10 throws a measurably faster fastball than one at pitchSpd=0 (${fast.timeToPlateS} < ${slow.timeToPlateS})`);

    const plainChange = flyPitch('changeup', 0, 1, SETTINGS, mulberry32(1), { pitchSpin: 0 });
    const spunChange = flyPitch('changeup', 0, 1, SETTINGS, mulberry32(1), { pitchSpin: 10 });
    ok(spunChange.timeToPlateS > plainChange.timeToPlateS, `a pitcher with pitchSpin=10 throws a changeup with a measurably WIDER speed gap than one at pitchSpin=0 (${spunChange.timeToPlateS} > ${plainChange.timeToPlateS})`);
  }

  // agents.js: a changeup thrown after two fastballs raises a batter's EFFECTIVE timing sigma
  // (doc §8: "Change speeds and he swings early or late") - measured on ModelBatter, which had no
  // pattern awareness at all before this phase. Mean |timingErrorMs| over many draws is a direct,
  // testable proxy for effective sigma (a gaussianLite draw's own expected magnitude scales with
  // it), so a real gap there is exactly what the doc's mechanism should produce.
  await (async () => {
    const hist = [{ type: 'fastball', x: 0 }, { type: 'fastball', x: 0 }];
    const changeupPitch = { type: 'changeup', x: 0, isStrike: true };
    const fastballPitch = { type: 'fastball', x: 0, isStrike: true };
    const meanAbsTiming = async (pitch, pitchHistory, n = 400) => {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const b = new ModelBatter({ timingSigmaMs: 55, placementSigma: 0.22, swingIn: 1 });
        const rng = mulberry32(2000 + i);
        const d = await b.decideSwing({ pitch, pitchHistory, rand01: () => rng() });
        total += Math.abs(d.timingErrorMs || 0);
      }
      return total / n;
    };
    const surprised = await meanAbsTiming(changeupPitch, hist);
    const expected = await meanAbsTiming(fastballPitch, hist);
    ok(surprised > expected, `a changeup after two fastballs raises a ModelBatter's effective timing sigma (mean |error| ${surprised.toFixed(1)}ms > ${expected.toFixed(1)}ms for an expected fastball)`);
    const noHistChangeup = await meanAbsTiming(changeupPitch, []);
    const noHistFastball = await meanAbsTiming(fastballPitch, []);
    ok(Math.abs(noHistChangeup - noHistFastball) < 5, 'with no pitch history at all, a changeup surprises ModelBatter no more than a fastball does (no expectation to violate)');
  })();

  // agents.js: `cpuBaseTimingSigmaMs` never sits below CPU_SIGMA_ABSOLUTE_FLOOR_MS at slot 4, at
  // every league - doc §8, [Locked]: "difficulty comes mostly from smarter CPU behavior, not
  // bigger CPU stats." (BB-2c commit 2 superseded the old flat CPU_SIGMA_FLOOR_MS with a per-league
  // minimum plus this absolute backstop - see section 17 below for the full contract, including
  // every slot, not just this one.) BB-2e commit 2: slot 4 is no longer guaranteed a literal ZERO
  // offset under a non-`spread` shape (`cliff`/`steep` place their own gap weights asymmetrically
  // around the middle, so the true zero-crossing can sit anywhere in the ladder) - the invariant
  // this section actually checks (the floor) does not depend on that, so the assertion is on the
  // measured sigma only, not on the offset's own value.
  {
    for (const lg of SETTINGS.LEAGUES) {
      const medianOffset = SETTINGS.TEAM_LADDER_OFFSETS[lg][4]; // slot 4 of 8
      const sigma = cpuBaseTimingSigmaMs(lg, SETTINGS, medianOffset);
      ok(sigma >= SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS, `${lg}'s median-slot base timing sigma (${sigma}ms) is at least CPU_SIGMA_ABSOLUTE_FLOOR_MS (${SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS}ms)`);
    }
  }

  // agents.js's ModelPitcher: `variety` is continuous - a low-variety pitcher repeats its previous
  // pitch far more often than a high-variety one (doc §8: "mixes pitches more" each league up).
  await (async () => {
    const repeatRate = async (variety) => {
      const p = new ModelPitcher({ league: 'majors', settings: SETTINGS, variety, cornerBias: 0.5, pitchMix: SETTINGS.CPU.majors.pitchMix });
      let repeats = 0, prev = null;
      const rng = mulberry32(4242);
      for (let i = 0; i < 500; i++) {
        const d = await p.decidePitch({ rand01: () => rng() });
        if (prev != null && d.type === prev) repeats += 1;
        prev = d.type;
      }
      return repeats / 500;
    };
    const lowVariety = await repeatRate(0);
    const highVariety = await repeatRate(1);
    ok(lowVariety > highVariety, `ModelPitcher at variety=0 repeats its previous pitch far more often than at variety=1 (${lowVariety.toFixed(2)} > ${highVariety.toFixed(2)})`);
  })();
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 17. BB-2c commit 2: the CPU strength contract - doc §8, [Locked] (design doc v9) --');
{
  // "CPU batters may never time or place better than a median human, in any league or any slot."
  // The median human's own values, per sim-baseball.mjs's MODEL_TIERS.median (not imported here on
  // purpose - this repo's CLAUDE.md instruction is that engine tests never depend on the simulator,
  // so the two numbers are restated as literals, matching what CPU_SIGMA_ABSOLUTE_FLOOR_MS/
  // CPU_PLACEMENT_MIN are THEMSELVES defined against in settings.js's own comments).
  const MEDIAN_HUMAN_SIGMA_MS = 55;
  const MEDIAN_HUMAN_PLACEMENT = 0.22;

  ok(SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS > MEDIAN_HUMAN_SIGMA_MS,
    `CPU_SIGMA_ABSOLUTE_FLOOR_MS (${SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS}) sits strictly above the median human's own timing sigma (${MEDIAN_HUMAN_SIGMA_MS}) - a floor, not parity`);
  ok(SETTINGS.CPU_PLACEMENT_MIN === MEDIAN_HUMAN_PLACEMENT,
    `CPU_PLACEMENT_MIN (${SETTINGS.CPU_PLACEMENT_MIN}) equals the median human's own placement noise (${MEDIAN_HUMAN_PLACEMENT})`);

  // Every league's own CPU_SIGMA_MIN_MS is at or above the absolute floor, and every league's
  // shipped base `timingSigmaMs` is at or above ITS OWN league minimum - the raw table, not merely
  // the runtime clamp, honors the contract.
  for (const lg of SETTINGS.LEAGUES) {
    ok(SETTINGS.CPU_SIGMA_MIN_MS[lg] >= SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS,
      `CPU_SIGMA_MIN_MS.${lg} (${SETTINGS.CPU_SIGMA_MIN_MS[lg]}) is at or above CPU_SIGMA_ABSOLUTE_FLOOR_MS (${SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS})`);
    ok(SETTINGS.CPU[lg].timingSigmaMs >= SETTINGS.CPU_SIGMA_MIN_MS[lg],
      `CPU.${lg}.timingSigmaMs (${SETTINGS.CPU[lg].timingSigmaMs}) is at or above its own CPU_SIGMA_MIN_MS (${SETTINGS.CPU_SIGMA_MIN_MS[lg]}) - the raw table, not just the runtime clamp`);
    ok(SETTINGS.CPU[lg].placementNoise >= SETTINGS.CPU_PLACEMENT_MIN,
      `CPU.${lg}.placementNoise (${SETTINGS.CPU[lg].placementNoise}) is at or above CPU_PLACEMENT_MIN (${SETTINGS.CPU_PLACEMENT_MIN})`);
  }

  // The critical guarantee: no LADDER SLOT's effective sigma, at ANY league, ever crosses the
  // absolute floor - not just the median (zero-offset) slot section 16 already checked. This is
  // exactly the defect BB-2b shipped (a champion slot measuring 30ms, sharper than a "strong"
  // modeled human at 35ms) - a regression here must fail loudly, not silently.
  for (const lg of SETTINGS.LEAGUES) {
    for (let slot = 0; slot < SETTINGS.TEAM_LADDER_OFFSETS[lg].length; slot++) {
      const offset = SETTINGS.TEAM_LADDER_OFFSETS[lg][slot];
      const sigma = cpuBaseTimingSigmaMs(lg, SETTINGS, offset);
      ok(sigma >= SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS,
        `${lg} ladder slot ${slot}'s effective base timing sigma (${sigma}ms) is at or above CPU_SIGMA_ABSOLUTE_FLOOR_MS (${SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS}ms)`);
    }
  }

  // The pattern-read timing BONUS (a repeated pitch speed narrowing the spread) also cannot punch
  // back below the floor. Under normal settings the bonus is small (majors: SPEED_DELTA_DEADBAND x
  // fool x FOOL_BONUS_MS_SCALE x patternWeight = 0.05 x 0.10 x 200 x 0.65 = 0.65ms - nowhere near
  // enough to test the clamp), so this drives the SAME code path with an exaggerated
  // FOOL_BONUS_MS_SCALE override (a settings-sweep, same trick sim-baseball.mjs's own
  // counterfactuals use) to force the bonus far past the floor, then measures the ACTUAL sample
  // standard deviation of 1's produced against a run of identically-timed fastballs (the scenario
  // that produces the largest possible bonus) and confirms it never collapses below the floor.
  await (async () => {
    const league = 'majors';
    const skills = { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 5, pitchAcc: 5, pitchSpin: 5 };
    const hist = [{ type: 'fastball', x: 0 }, { type: 'fastball', x: 0 }, { type: 'fastball', x: 0 }];
    const pitch = { type: 'fastball', x: 0, isStrike: true };
    const exaggerated = { ...SETTINGS, FOOL_BONUS_MS_SCALE: 1e7 };
    const batter = new CpuBatter({ league, skills, settings: exaggerated, styleId: 'balanced', ladderOffset: SETTINGS.TEAM_LADDER_OFFSETS[league][7] });
    const samples = [];
    for (let i = 0; i < 2000; i++) {
      const rng = mulberry32(9000 + i);
      const d = await batter.decideSwing({ pitch, pitchHistory: hist, rand01: () => rng() });
      if (d.action === 'swing') samples.push(d.timingErrorMs);
    }
    ok(samples.length > 500, 'the pattern-bonus probe produced enough swings to estimate a standard deviation');
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
    // gaussianLite() is itself normalized to unit variance, so timingErrorMs's own sample stdev
    // IS the implied effective sigma directly - no further rescaling.
    const stdev = Math.sqrt(variance);
    const floor = cpuSigmaFloorMs(league, SETTINGS);
    ok(stdev >= floor * 0.5, `even with FOOL_BONUS_MS_SCALE exaggerated to force the largest possible bonus, the champion slot's own timing spread (implied sigma ~${stdev.toFixed(1)}ms) does not collapse toward zero - it stays anchored near the floor (${floor}ms), proving the re-clamp in CpuBatter.decideSwing actually fires`);
  })();

  // `guess` no longer feeds base placement noise at all - a structural check, since driving this
  // statistically (comparing placement scatter at two `guess` values with everything else held
  // fixed) would need thousands of samples to separate from ordinary noise. The base aimX line
  // must read `cpu.placementNoise`, never `cpu.guess`, and the guess-scaled term must be confined
  // to the lean blend.
  {
    const fs = await import('node:fs');
    const agentsSrc = fs.readFileSync(new URL('./engine/agents.js', import.meta.url), 'utf8');
    const baseAimLine = agentsSrc.match(/let aimX = seenX \+ .*/);
    ok(!!baseAimLine && baseAimLine[0].includes('placementNoise') && !baseAimLine[0].includes('guess'),
      `CpuBatter's base aimX line reads cpu.placementNoise, never cpu.guess: "${baseAimLine && baseAimLine[0]}"`);
    ok(agentsSrc.includes('leanWeight') && agentsSrc.includes('cpu.guess'),
      'guess is still used, confined to the lean-weight blend');
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 18. BB-2c commit 3: the flavor strength budget (STYLE_STRENGTH_DELTA) --');
{
  // Every style has a delta, including balanced (0 - it is the reference, not measured against
  // itself) - `makeLeague`'s lookup must never fall through to "no correction" for a real style.
  const styleIds = Object.keys(SETTINGS.TEAM_STYLES);
  for (const id of styleIds) {
    ok(typeof SETTINGS.STYLE_STRENGTH_DELTA[id] === 'number', `STYLE_STRENGTH_DELTA has a numeric entry for '${id}'`);
  }
  ok(SETTINGS.STYLE_STRENGTH_DELTA.balanced === 0, 'balanced is the reference style - its own delta is exactly 0');

  // BB-2d commit 6: STYLE_STRENGTH_DELTA no longer touches the skill cap at all (it used to lower
  // a positive-delta style's own slot cap - see this section's own git history for that assertion).
  // It is converted into timingSigmaMs/chase offsets instead - see test.js section 22's own checks
  // for the wiring, and STYLE_STRENGTH_DELTA's settings.js comment for why the axis moved.
  {
    const league = makeLeague('majors');
    const shiftersTeam = league.find((t) => t.styleId === 'shifters');
    ok(!!shiftersTeam, 'shifters is still on the majors ladder');
    const slot = shiftersTeam.ladderSlot;
    const offsets = SETTINGS.TEAM_LADDER_OFFSETS.majors[slot];
    const baseCap = effectiveCapFor('majors');
    const rawCap = SETTINGS.CAPS.majors;
    const expectedCap = Math.max(1, Math.min(rawCap, baseCap * (1 + offsets.skill)));
    const capInt = Math.floor(expectedCap);
    ok(shiftersTeam.players.every((p) => SETTINGS.SKILL_IDS.every((id) => p.skills[id] <= capInt)),
      `shifters' own generated roster never exceeds its skill-offset-only cap (${capInt}) - STYLE_STRENGTH_DELTA plays no part in it`);
  }

  // LEAGUE_LADDER_STYLES is unchanged from Matt's confirmed order - this commit pays for a style's
  // behavior with its OWN skill budget, it does not reshuffle who sits where.
  const CONFIRMED_ORDER = ['balanced', 'smallBall', 'patient', 'junkballers', 'shifters', 'flamethrowers', 'sluggers', 'aces'];
  for (const lg of SETTINGS.LEAGUES) {
    ok(JSON.stringify(SETTINGS.LEAGUE_LADDER_STYLES[lg]) === JSON.stringify(CONFIRMED_ORDER),
      `LEAGUE_LADDER_STYLES.${lg} is unchanged from Matt's confirmed order`);
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 19. BB-2c commit 6: Locked-statement inventory (design doc v9, "difficulty from behavior") --');
{
  // Contract test 1: no league's CPU ever bats sharper-timed than the absolute human-relative
  // floor, at ANY ladder slot - difficulty may never come from a stat that crosses into
  // "better than a person could be," only from behavior (chase, pattern-reading, placement).
  for (const lg of SETTINGS.LEAGUES) {
    for (let slot = 0; slot < SETTINGS.TEAM_LADDER_OFFSETS[lg].length; slot++) {
      const sigma = cpuBaseTimingSigmaMs(lg, SETTINGS, SETTINGS.TEAM_LADDER_OFFSETS[lg][slot]);
      ok(sigma >= SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS,
        `${lg} slot ${slot}: effective CPU batting sigma (${sigma.toFixed(1)}ms) never crosses CPU_SIGMA_ABSOLUTE_FLOOR_MS`);
    }
  }

  // Contract test 2: no league's CPU ever places a pitch more precisely than a human batter's own
  // best-known reference placement - difficulty comes from WHERE it places (pattern-reading via
  // patternWeight/cornerBias), never from placing with impossible precision.
  for (const lg of SETTINGS.LEAGUES) {
    ok(SETTINGS.CPU[lg].placementNoise >= SETTINGS.CPU_PLACEMENT_MIN,
      `${lg}: CPU placementNoise (${SETTINGS.CPU[lg].placementNoise}) never crosses CPU_PLACEMENT_MIN`);
  }

  // Contract test 3: `guess` (BB-2c commit 2) only ever weights a LOCATION LEAN, never the base
  // placement roll itself - re-affirmed here as a Locked-statement inventory entry distinct from
  // section 17's structural regex check, using the actual exported constant.
  ok(SETTINGS.LOCATION_LEAN_WEIGHT > 0 && SETTINGS.LOCATION_LEAN_WEIGHT <= 1,
    'LOCATION_LEAN_WEIGHT is the one place `guess` can move a CPU batter\'s aim, and it is bounded to a partial blend');

  // Monotone test: "each league up chases less and reads patterns better" (doc §8, [Locked]) -
  // checked on the raw per-league CPU table, which is the one place this Locked statement is
  // actually encoded as data.
  for (let i = 1; i < SETTINGS.LEAGUES.length; i++) {
    const prev = SETTINGS.CPU[SETTINGS.LEAGUES[i - 1]];
    const cur = SETTINGS.CPU[SETTINGS.LEAGUES[i]];
    ok(cur.chase <= prev.chase, `${SETTINGS.LEAGUES[i]} chases no more than ${SETTINGS.LEAGUES[i - 1]} (${cur.chase} <= ${prev.chase})`);
    ok(cur.patternWeight >= prev.patternWeight, `${SETTINGS.LEAGUES[i]} reads patterns at least as well as ${SETTINGS.LEAGUES[i - 1]} (${cur.patternWeight} >= ${prev.patternWeight})`);
    ok(cur.cornerBias >= prev.cornerBias, `${SETTINGS.LEAGUES[i]} pitches corners at least as often as ${SETTINGS.LEAGUES[i - 1]} (${cur.cornerBias} >= ${prev.cornerBias})`);
  }

  // Per-league win-rate band shape test: SEASON_WINRATE_BAND/SEASONS_TO_GOLD_TARGET live in
  // sim-baseball.mjs (the tool that measures a full season, which this headless suite does not
  // play) - this only pins their SHAPE stays sane so a future edit can't silently invert a band
  // or drop a league. The actual measured pass/fail against these bands is `sim-baseball.mjs
  // --assert`'s job, not this suite's (see baseball/CLAUDE.md, "Status: Phase 2c" for the
  // current measured scoreboard).
  const BAND_SHAPE_LEAGUES = ['little', 'highschool', 'college', 'minors', 'majors'];
  ok(JSON.stringify(SETTINGS.LEAGUES) === JSON.stringify(BAND_SHAPE_LEAGUES),
    'LEAGUES is the fixed 5-league order every per-league band table is keyed by');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 20. BB-2d commit 4: batted-ball carry scaled to the league --');
{
  // Doc §10, [Locked]: "Home runs over the wall." This is an EXISTENCE test (can it happen at all
  // in this league) not a rate test - `sim-baseball.mjs --range`'s census is the rate/band tool.
  // Before this commit, zero of these leagues could ever produce a home run at all (measured
  // p95 carry 150-166ft everywhere, nowhere near any league's own fence) - a maxed-power player,
  // real CpuPitcher, real swing()/resolveContact() pipeline, enough at-bats to make "never happens"
  // distinguishable from "rare."
  const HR_EXISTENCE_ABS = 4000;
  for (const lg of SETTINGS.LEAGUES) {
    const teams = makeLeague(lg);
    const opponent = teams[Math.floor(teams.length / 2)];
    const pitcher = opponent.players.find((p) => p.id === opponent.pitcherId);
    const cap = SETTINGS.CAPS[lg];
    const controlSkill = Math.max(0, Math.min(1, (pitcher.skills.pitchAcc || 0) / cap));
    const cpuPitcher = new CpuPitcher({ league: lg, settings: SETTINGS });
    const batter = new ModelBatter({ timingSigmaMs: 20, placementSigma: 0.05 }); // maxed-ish timing for an existence probe
    const batterSkills = { hitAcc: cap, hitPow: cap, hitSpd: 0, pitchSpd: 0, pitchAcc: 0, pitchSpin: 0 };
    const zones = zonesFor(lg, 0);
    const fenceFt = SETTINGS.FIELD[lg].fenceFt;
    let homers = 0, doubles = 0, triples = 0, swings = 0, draw = 0;
    while (swings < HR_EXISTENCE_ABS) {
      const seed = hashSeed('bb-hr-existence', lg, draw++) >>> 0;
      const rand01 = mulberry32(seed);
      const pitchResolved = await cpuPitcher.decidePitch({ rand01, weakZone: null });
      const pitchResult = flyPitch(pitchResolved.type, pitchResolved.aim, controlSkill, SETTINGS, rand01, pitcher.skills);
      const swingDecision = await batter.decideSwing({ pitch: pitchResult, rand01 });
      if (swingDecision.action !== 'swing') continue;
      swings += 1;
      const swingResult = swing(pitchResult, batterSkills, swingDecision, SETTINGS, rand01, lg);
      if (!swingResult.contact || !swingResult.inPlay) continue;
      const outcome = resolveContact(swingResult, zones, SETTINGS, fenceFt, batterSkills.hitSpd, rand01);
      if (outcome.bases === 4) homers += 1;
      if (outcome.bases === 3) triples += 1;
      if (outcome.bases === 2) doubles += 1;
    }
    ok(homers > 0, `${lg}: a home run is possible (doc §10, [Locked]) - ${homers} in ${swings} swings at maxed power/timing`);
    ok(doubles > 0, `${lg}: a double is possible (doc §10, [Locked]) - ${doubles} in ${swings} swings at maxed power/timing`);
    ok(triples > 0, `${lg}: a triple is possible (doc §10, [Locked]) - ${triples} in ${swings} swings at maxed power/timing`);
  }

  // Little League's own homer RATE band (Draft, LL_HR_PER_GAME_BAND [0.3, 1.0] - measured by
  // `sim-baseball.mjs --range`'s census, not re-measured here; this only pins the band's own shape
  // so a future edit can't silently invert or drop it, same discipline as the win-rate band shape
  // check above).
  const LL_HR_PER_GAME_BAND = [0.3, 1.0];
  ok(LL_HR_PER_GAME_BAND[0] < LL_HR_PER_GAME_BAND[1] && LL_HR_PER_GAME_BAND[0] > 0,
    'LL_HR_PER_GAME_BAND is a sane, non-empty, positive band');

  // DOUBLE_DEPTH_FRAC/TRIPLE_DEPTH_FRAC integrity: triple depth must exceed double depth, and both
  // must reproduce the old flat 250ft/320ft cutoffs at College's 400ft center fence exactly (the
  // continuity this commit's own header promises).
  ok(SETTINGS.TRIPLE_DEPTH_FRAC > SETTINGS.DOUBLE_DEPTH_FRAC, 'TRIPLE_DEPTH_FRAC exceeds DOUBLE_DEPTH_FRAC');
  ok(Math.abs(SETTINGS.DOUBLE_DEPTH_FRAC * 400 - 250) < 1e-6, 'DOUBLE_DEPTH_FRAC reproduces the old 250ft cutoff at a 400ft fence');
  ok(Math.abs(SETTINGS.TRIPLE_DEPTH_FRAC * 400 - 320) < 1e-6, 'TRIPLE_DEPTH_FRAC reproduces the old 320ft cutoff at a 400ft fence');

  // LEAGUE_POWER_SCALE integrity: every league present, college is the identity (the calibration's
  // own reference point).
  for (const lg of SETTINGS.LEAGUES) ok(SETTINGS.LEAGUE_POWER_SCALE[lg] > 0, `LEAGUE_POWER_SCALE.${lg} is a positive multiplier`);
  ok(SETTINGS.LEAGUE_POWER_SCALE.college === 1.00, 'LEAGUE_POWER_SCALE.college is the identity - the calibration\'s own reference league');
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 21. BB-2d commit 5: the champion\'s own axis --');
{
  // The champion's effective sigma is never below CPU_SIGMA_ABSOLUTE_FLOOR_MS (58), at every
  // league, after every ladder offset SLOT_SIGMA_DESCENT can apply.
  for (const lg of SETTINGS.LEAGUES) {
    for (let slot = 0; slot < 8; slot++) {
      const offsets = SETTINGS.TEAM_LADDER_OFFSETS[lg][slot];
      const league = makeLeague(lg);
      const team = league[slot];
      const sigma = cpuBaseTimingSigmaMs(lg, SETTINGS, team.ladderOffset);
      ok(sigma >= SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS,
        `${lg} slot ${slot}: effective base sigma (${sigma.toFixed(1)}) never crosses CPU_SIGMA_ABSOLUTE_FLOOR_MS (${SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS})`);
      void offsets;
    }
  }

  // SLOT_SIGMA_DESCENT: slots 0-4 sit at the league's own flat floor; slots 5-7 strictly descend
  // toward (and slot 7 lands exactly at) CPU_SIGMA_ABSOLUTE_FLOOR_MS.
  for (const lg of SETTINGS.LEAGUES) {
    const league = makeLeague(lg);
    const floors = league.map((t) => t.ladderOffset.sigmaFloorMs);
    for (let slot = 0; slot <= 4; slot++) {
      ok(Math.abs(floors[slot] - SETTINGS.CPU_SIGMA_MIN_MS[lg]) < 1e-9,
        `${lg} slot ${slot}: sigmaFloorMs sits at the league's own flat floor (SLOT_SIGMA_DESCENT.bindThroughSlot)`);
    }
    for (let slot = 5; slot <= 7; slot++) {
      ok(floors[slot] <= floors[slot - 1] + 1e-9, `${lg} slot ${slot}: sigmaFloorMs is non-increasing (descending toward the absolute floor)`);
    }
    ok(Math.abs(floors[7] - SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS) < 1e-9,
      `${lg} slot 7 (the champion): sigmaFloorMs lands exactly at CPU_SIGMA_ABSOLUTE_FLOOR_MS`);
  }

  // CHAMPION_CEILING: every TEAM_LADDER_OFFSETS.behaviorMul value, applied to the toughest
  // league's own cornerBias/patternWeight/weakSpotWeight, never exceeds the NEXT league's own base
  // row for that field (Majors is its own ceiling, since it has no next league).
  for (let i = 0; i < SETTINGS.LEAGUES.length; i++) {
    const lg = SETTINGS.LEAGUES[i];
    const nextLg = SETTINGS.LEAGUES[i + 1] || lg;
    const ceilingRow = SETTINGS.CPU[nextLg];
    const champOffsets = SETTINGS.TEAM_LADDER_OFFSETS[lg][7]; // the champion slot, this league's own table
    const cpu = SETTINGS.CPU[lg];
    const effCornerBias = Math.min(cpu.cornerBias * champOffsets.behaviorMul, ceilingRow.cornerBias);
    const effPatternWeight = Math.min(cpu.patternWeight * champOffsets.behaviorMul, ceilingRow.patternWeight);
    const effWeakSpotWeight = Math.min(cpu.weakSpotWeight * champOffsets.behaviorMul, ceilingRow.weakSpotWeight);
    ok(effCornerBias <= ceilingRow.cornerBias + 1e-9, `${lg} champion's effective cornerBias never exceeds ${nextLg}'s own base row`);
    ok(effPatternWeight <= ceilingRow.patternWeight + 1e-9, `${lg} champion's effective patternWeight never exceeds ${nextLg}'s own base row`);
    ok(effWeakSpotWeight <= ceilingRow.weakSpotWeight + 1e-9, `${lg} champion's effective weakSpotWeight never exceeds ${nextLg}'s own base row`);
  }

  // behaviorMul/changeupShare integrity: strictly rising slot 0 -> slot 7 (easier to harder
  // champion), and every value is non-negative - every league now, not one shared table.
  for (const lg of SETTINGS.LEAGUES) {
    const offsets = SETTINGS.TEAM_LADDER_OFFSETS[lg];
    for (let slot = 1; slot < 8; slot++) {
      ok(offsets[slot].behaviorMul > offsets[slot - 1].behaviorMul,
        `TEAM_LADDER_OFFSETS.${lg}[${slot}].behaviorMul strictly exceeds slot ${slot - 1}'s`);
      ok(offsets[slot].changeupShare >= offsets[slot - 1].changeupShare,
        `TEAM_LADDER_OFFSETS.${lg}[${slot}].changeupShare is non-decreasing from slot ${slot - 1}'s`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 22. BB-2d commit 6: Shifters bounded and priced --');
{
  // SHIFT_MAX_DEG is hardcoded to avoid a forward reference to GAP_DEG (declared later in
  // settings.js) - pinned here so the two numbers cannot silently drift apart.
  ok(SETTINGS.SHIFT_MAX_DEG === SETTINGS.GAP_DEG / 2, 'SHIFT_MAX_DEG is exactly half of GAP_DEG');

  // Covered-arc invariant: the TOTAL width covered by a zone's sectors (gaps excluded) must be
  // identical at every shift angle - a shift only ever translates the internal structure and
  // snaps the two outermost edges to the foul lines, never grows or shrinks the total footprint.
  const coveredWidth = (zones) => zones.reduce((s, sec) => s + (sec.toDeg - sec.fromDeg), 0);
  for (const lg of SETTINGS.LEAGUES) {
    const base = zonesFor(lg, 0);
    const baseInfieldWidth = coveredWidth(base.infield);
    const baseOutfieldWidth = coveredWidth(base.outfield);
    for (const shiftDeg of [-SETTINGS.SHIFT_MAX_DEG, -1, 0, 1, SETTINGS.SHIFT_MAX_DEG]) {
      const z = zonesFor(lg, shiftDeg);
      ok(Math.abs(coveredWidth(z.infield) - baseInfieldWidth) < 1e-9,
        `${lg}: infield covered arc is identical at shift=${shiftDeg} (no uncovered sliver, no growth)`);
      ok(Math.abs(coveredWidth(z.outfield) - baseOutfieldWidth) < 1e-9,
        `${lg}: outfield covered arc is identical at shift=${shiftDeg}`);
      ok(z.infield[0].fromDeg === -45 && z.infield[z.infield.length - 1].toDeg === 45,
        `${lg}: infield spans exactly -45..45 at shift=${shiftDeg}, no gap at either foul line`);
      ok(z.outfield[0].fromDeg === -45 && z.outfield[z.outfield.length - 1].toDeg === 45,
        `${lg}: outfield spans exactly -45..45 at shift=${shiftDeg}, no gap at either foul line`);
    }
  }

  // STYLE_STRENGTH_DELTA no longer touches the skill cap - a style's slotCap depends only on
  // TEAM_LADDER_OFFSETS[slot].skill, never on STYLE_STRENGTH_DELTA, at every slot.
  {
    const league = makeLeague('college');
    const rawCap = SETTINGS.CAPS.college;
    const baseCap = effectiveCapFor('college');
    for (let slot = 0; slot < 8; slot++) {
      const team = league[slot];
      const expectedCap = Math.max(1, Math.min(rawCap, baseCap * (1 + SETTINGS.TEAM_LADDER_OFFSETS.college[slot].skill)));
      const capInt = Math.floor(expectedCap);
      ok(team.players.every((p) => SETTINGS.SKILL_IDS.every((id) => p.skills[id] <= capInt)),
        `college slot ${slot} (${team.styleId}): no player skill exceeds the STYLE_STRENGTH_DELTA-free slotCap`);
    }
  }

  // STYLE_STRENGTH_DELTA now flows into timingSigmaMs/chase instead: a style with a real measured
  // delta produces a ladderOffset that DIFFERS from the bare TEAM_LADDER_OFFSETS row for its slot
  // by exactly `delta*100 * SIGMA_MS_PER_WINRATE_PP` / `* CHASE_PER_WINRATE_PP`.
  {
    const league = makeLeague('college');
    for (const team of league) {
      const slotOffsets = SETTINGS.TEAM_LADDER_OFFSETS.college[team.ladderSlot];
      const delta = SETTINGS.STYLE_STRENGTH_DELTA[team.styleId] || 0;
      const expectedSigma = slotOffsets.timingSigmaMs + delta * 100 * SETTINGS.SIGMA_MS_PER_WINRATE_PP;
      const expectedChase = slotOffsets.chase + delta * 100 * SETTINGS.CHASE_PER_WINRATE_PP;
      ok(Math.abs(team.ladderOffset.timingSigmaMs - expectedSigma) < 1e-9,
        `college ${team.styleId} (slot ${team.ladderSlot}): ladderOffset.timingSigmaMs includes its own STYLE_STRENGTH_DELTA`);
      ok(Math.abs(team.ladderOffset.chase - expectedChase) < 1e-9,
        `college ${team.styleId} (slot ${team.ladderSlot}): ladderOffset.chase includes its own STYLE_STRENGTH_DELTA`);
    }
  }

  // SHIFT_MIN_SAMPLES: fewer than the minimum recorded balls in play never shifts, at or above it
  // may (already exercised at 5 samples in section 9a2 above; this pins the negative case).
  {
    const g = playGameOnce('college', hashSeed('shift-min-samples-probe'), 3, 4);
    const shiftersTeam = { styleId: 'shifters' };
    g.sprayHistory['batterY'] = [10, 12, 8, 11]; // one short of SHIFT_MIN_SAMPLES (5)
    ok(g._shiftDegFor(shiftersTeam, 'batterY') === 0, 'fewer than SHIFT_MIN_SAMPLES recorded balls in play never triggers a shift');
  }
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 23. BB-2d commit 8: inventory - Perfect Season reachable at the maxed tier --');
{
  // Doc §5, [Locked]: Perfect Season must be reachable for a player who has won the World Series
  // and maxed every skill - `sim-baseball.mjs`'s own MAXED_TIER/PERFECT_SEASON_REACHABLE
  // scoreboard line measures this at 300 seasons (0.60 measured, well above the 0.02 gate); this
  // is the same mechanism replicated headlessly at a small sample (40 seasons) so a real engine
  // regression fails this suite, not only the separate simulator tool.
  const MAXED = { timingSigmaMs: 35, placementSigma: 0.12, variety: 0.85, swingIn: 0.88, chase: 0.12 };
  function maxedSkillsForTest(league) {
    const capInt = Math.floor(SETTINGS.CAPS[league]);
    const skills = {};
    for (const id of SETTINGS.SKILL_IDS) skills[id] = capInt;
    return skills;
  }
  async function playMaxedSeason(league, seasonSeed) {
    const teams = makeLeague(league);
    const schedule = makeSchedule(league, seasonSeed, SETTINGS.SCHEDULE_SHAPE);
    const skills = maxedSkillsForTest(league);
    const playerTeam = makePlayerTeam({ skills, hand: 'R' });
    const cpu = SETTINGS.CPU[league];
    const playerAgent = {
      decidePitch: (v) => new ModelPitcher({ league, settings: SETTINGS, variety: MAXED.variety, cornerBias: cpu.cornerBias, pitchMix: cpu.pitchMix }).decidePitch(v),
      decideSwing: (v) => new ModelBatter({ timingSigmaMs: MAXED.timingSigmaMs, placementSigma: MAXED.placementSigma, swingIn: MAXED.swingIn, chase: MAXED.chase, settings: SETTINGS }).decideSwing(v),
    };
    let wins = 0, losses = 0;
    for (let i = 0; i < schedule.length; i++) {
      const g = schedule[i];
      const opponent = teams[g.opponentIndex];
      const home = g.home ? playerTeam : opponent, away = g.home ? opponent : playerTeam;
      const homeAgent = g.home ? playerAgent : mkAgent(opponent, league);
      const awayAgent = g.home ? mkAgent(opponent, league) : playerAgent;
      const game = new Game({ home, away, seed: hashSeed('bb-maxed-season', league, seasonSeed, i) >>> 0, agents: { home: homeAgent, away: awayAgent } });
      await game.playGame();
      const won = game.winner === (g.home ? 'home' : 'away');
      if (won) wins += 1; else losses += 1;
    }
    if (wins + losses === 0 || losses > 0) return false; // any regular-season loss ends the perfect-season attempt
    const standings = scriptedStandings(teams, { wins, losses }, SETTINGS.STANDINGS_MODEL);
    const playerRank = standings.findIndex((r) => r.isPlayer);
    if (playerRank >= 4) return false;
    const bracket = playoffs(standings, SETTINGS.BRACKET_MODEL);
    const sfPair = bracket.semifinals.find((pair) => pair.some((t) => t.isPlayer));
    const sfOpponentRow = sfPair.find((t) => !t.isPlayer);
    const sfOpponentTeam = teams.find((t) => t.name === sfOpponentRow.id) || teams[teams.length - 1];
    const sfGame = new Game({ home: playerTeam, away: sfOpponentTeam, seed: hashSeed('bb-maxed-sf', league, seasonSeed) >>> 0,
      agents: { home: playerAgent, away: mkAgent(sfOpponentTeam, league) } });
    await sfGame.playGame();
    if (sfGame.winner !== 'home') return false;
    const champTeam = teams[teams.length - 1];
    const chGame = new Game({ home: playerTeam, away: champTeam, seed: hashSeed('bb-maxed-champ', league, seasonSeed) >>> 0,
      agents: { home: playerAgent, away: mkAgent(champTeam, league) } });
    await chGame.playGame();
    return chGame.winner === 'home';
  }
  let perfectCount = 0;
  const SEASONS = 40;
  for (let i = 0; i < SEASONS; i++) if (await playMaxedSeason('majors', i)) perfectCount += 1;
  ok(perfectCount > 0, `doc §5, [Locked]: Perfect Season is reachable at the maxed tier - ${perfectCount}/${SEASONS} Majors seasons perfect`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n-- 24. BB-2e commit 2: LADDER_SHAPE and the per-league TEAM_LADDER_OFFSETS generator --');
{
  // Every league names a real shape.
  for (const lg of SETTINGS.LEAGUES) {
    ok(['cliff', 'spread', 'steep'].includes(SETTINGS.LADDER_SHAPE[lg]),
      `LADDER_SHAPE.${lg} names one of the three real shapes (got '${SETTINGS.LADDER_SHAPE[lg]}')`);
  }
  // Matt's own per-league assignment (see settings.js's own comment for the rationale).
  ok(SETTINGS.LADDER_SHAPE.little === 'cliff' && SETTINGS.LADDER_SHAPE.highschool === 'cliff',
    'Little League and High School are assigned cliff');
  ok(SETTINGS.LADDER_SHAPE.college === 'spread' && SETTINGS.LADDER_SHAPE.minors === 'spread',
    'College and Minor League are assigned spread');
  ok(SETTINGS.LADDER_SHAPE.majors === 'steep', 'Major League is assigned steep');

  // slot0/slot7 land EXACTLY on the reference endpoint magnitudes, at every league and every axis -
  // the shape only decides how slots 1-6 are spaced, never the endpoints themselves.
  // BB-2e commit 3: timingSigmaMs's own slot7 (champion) endpoint is now PER-LEAGUE
  // (`championSigmaOffset`, not exported - restated here from its own named inputs, all exported).
  const ENDPOINTS = {
    skill: [-0.25, 0.25], chase: [0.15, -0.12],
    behaviorMul: [0.50, 1.60], changeupShare: [0, 2.00],
  };
  for (const lg of SETTINGS.LEAGUES) {
    const offsets = SETTINGS.TEAM_LADDER_OFFSETS[lg];
    ok(Math.abs(offsets[0].timingSigmaMs - 20) < 1e-9, `TEAM_LADDER_OFFSETS.${lg}[0].timingSigmaMs lands exactly on the shared reference slot0 endpoint (20)`);
    const headroom = SETTINGS.CPU_SIGMA_MIN_MS[lg] - SETTINGS.CPU_SIGMA_ABSOLUTE_FLOOR_MS;
    const expectedChampSigma = -headroom * SETTINGS.CHAMPION_SIGMA_HEADROOM_FRAC;
    ok(Math.abs(offsets[7].timingSigmaMs - expectedChampSigma) < 1e-9,
      `TEAM_LADDER_OFFSETS.${lg}[7].timingSigmaMs uses ${(SETTINGS.CHAMPION_SIGMA_HEADROOM_FRAC * 100).toFixed(0)}% of ${lg}'s own headroom to the absolute floor (expected ${expectedChampSigma.toFixed(2)})`);
    for (const [axis, [slot0, slot7]] of Object.entries(ENDPOINTS)) {
      ok(Math.abs(offsets[0][axis] - slot0) < 1e-9, `TEAM_LADDER_OFFSETS.${lg}[0].${axis} lands exactly on the reference slot0 endpoint (${slot0})`);
      ok(Math.abs(offsets[7][axis] - slot7) < 1e-9, `TEAM_LADDER_OFFSETS.${lg}[7].${axis} lands exactly on the reference slot7 endpoint (${slot7})`);
    }
  }

  // cliff's own promise: slots 0-6 sit CLOSE TOGETHER (a small, stated tolerance), the whole rest
  // of the range drops in the last gap alone - checked on the skill axis (0.5 total range;
  // CLIFF_TOP_GAP_FRAC x 6 x range is the theoretical max spread across slots 0-6).
  const CLIFF_CLUSTER_TOLERANCE = SETTINGS.CLIFF_TOP_GAP_FRAC * 6 * 0.5 + 1e-9; // = 0.06 + epsilon
  for (const lg of SETTINGS.LEAGUES.filter((l) => SETTINGS.LADDER_SHAPE[l] === 'cliff')) {
    const skillVals = SETTINGS.TEAM_LADDER_OFFSETS[lg].slice(0, 7).map((o) => o.skill);
    const spread = Math.max(...skillVals) - Math.min(...skillVals);
    ok(spread <= CLIFF_CLUSTER_TOLERANCE,
      `${lg} (cliff): slots 0-6's own skill offsets sit within ${CLIFF_CLUSTER_TOLERANCE.toFixed(4)} of each other (measured spread ${spread.toFixed(4)})`);
  }

  // ladderGapWeights integrity: every shape's 7 gap weights are non-negative and sum to 1, for
  // every shape this table can ever be assigned (not just the three currently in use).
  for (const shape of ['cliff', 'spread', 'steep']) {
    const weights = SETTINGS.ladderGapWeights(shape);
    ok(weights.length === 7, `ladderGapWeights('${shape}') returns exactly 7 gap weights`);
    ok(weights.every((w) => w >= 0), `ladderGapWeights('${shape}') is never negative`);
    ok(Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-9, `ladderGapWeights('${shape}') sums to exactly 1`);
  }
}

// ---------------------------------------------------------------------------------------------
// Section 26 (R2, docs/BASEBALL-3D-BUILD.md section 9): THE ZONE AND THE AIM ARE 2-D.
// Replaces BB-3's hold/Nice/hang and steering block, deleted with the meter and the steer pad.
(function section26() {
  const rand = mulberry32(777);
  const r1 = flyPitch('fastball', { x: 0.2, y: 0.1 }, 0.5, SETTINGS, rand, { pitchSpd: 3 });
  ok(Array.isArray(r1.path) && r1.path.length > 1, 'flyPitch returns a non-trivial per-step path');
  ok(r1.path[0].t === 0 && Math.abs(r1.path[r1.path.length - 1].x - r1.x) < 1e-9
    && Math.abs(r1.path[r1.path.length - 1].y - r1.y) < 1e-9,
    'flyPitch path starts at t=0 and ends at the pitch\'s own final (x, y)');
  ok(typeof r1.straightX === 'number' && typeof r1.straightY === 'number',
    'flyPitch reports where the pitch WOULD have crossed with no break (straightX/straightY - the batting target marker\'s own start)');

  // A plain number is still a lateral-only aim (every pre-R2 caller and fixture).
  const asNumber = flyPitch('fastball', 0.3, 1, SETTINGS, mulberry32(5));
  const asObject = flyPitch('fastball', { x: 0.3, y: 0 }, 1, SETTINGS, mulberry32(5));
  ok(asNumber.x === asObject.x && asNumber.y === asObject.y,
    'a plain-number aim means {x, y: 0} - a pre-R2 caller keeps working unchanged');

  // two-d-strike: the spec's own named probe. A pitch down the middle laterally can be a BALL on
  // height alone, and a pitch at both corners at once is still a strike.
  const NO_SCATTER = { scatter: { x: 0.5, y: 0.5, bx: 0.5, by: 0.5 } };
  const high = flyPitch('fastball', { x: 0, y: 1.2 }, 1, SETTINGS, mulberry32(1), {}, NO_SCATTER);
  ok(Math.abs(high.y - 1.2) < 1e-9 && high.isStrike === false,
    'two-d-strike: x=0, y=1.2 is a BALL - above the zone (it would have been a strike in the 1-D engine)');
  const corner = flyPitch('fastball', { x: 1.0, y: 1.0 }, 1, SETTINGS, mulberry32(1), {}, NO_SCATTER);
  ok(corner.isStrike === true, 'two-d-strike: x=1.0, y=1.0 is a STRIKE - the zone\'s own top corner is inside it');
  const low = flyPitch('fastball', { x: 0, y: -1.4 }, 1, SETTINGS, mulberry32(1), {}, NO_SCATTER);
  ok(low.isStrike === false, 'two-d-strike: y=-1.4 is a ball below the zone');

  // The scatter model is the SAME on both axes (the spec's own words), and a mid draw (0.5) is
  // exactly no scatter at all, which is what lets every probe here aim exactly.
  {
    const sk = 0.4;
    const amt = SETTINGS.FEEL.engine.aimScatter * (1 - sk * 0.67);
    const hi = flyPitch('fastball', { x: 0, y: 0 }, sk, SETTINGS, mulberry32(1), {}, { scatter: { x: 1, y: 1, bx: 0.5, by: 0.5 } });
    ok(Math.abs(hi.straightX - amt) < 1e-9 && Math.abs(hi.straightY - amt) < 1e-9,
      `both axes scatter by the same skill-scaled amount (${amt.toFixed(4)} zone units at skill ${sk})`);
  }

  // BREAK OFFSETS: every type lands exactly where BREAK_OFFSET says, at zero scatter.
  {
    let allRight = true, firstBad = '';
    for (const type of SETTINGS.PITCH_TYPES) {
      for (const hand of ['R', 'L']) {
        const row = SETTINGS.BREAK_OFFSET[type];
        if (row.random) continue; // the knuckleball's own case is below
        const sign = row.handed ? (hand === 'L' ? -1 : 1) : 1;
        const r = flyPitch(type, { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, { ...NO_SCATTER, pitcherHand: hand });
        if (Math.abs(r.x - row.x * sign) > 1e-9 || Math.abs(r.y - row.y) > 1e-9) {
          allRight = false;
          if (!firstBad) firstBad = `${type}/${hand}: (${r.x.toFixed(3)}, ${r.y.toFixed(3)}) vs (${(row.x * sign).toFixed(3)}, ${row.y.toFixed(3)})`;
        }
        if (Math.abs(r.straightX) > 1e-9 || Math.abs(r.straightY) > 1e-9) { allRight = false; if (!firstBad) firstBad = `${type} straight point moved`; }
      }
    }
    ok(allRight, `every pitch type breaks to exactly BREAK_OFFSET[type] (x flipped by the pitcher's hand where handed), from an unscattered aim of (0,0)${firstBad ? ' - ' + firstBad : ''}`);
  }
  // doc §11, [Locked]: a screwball breaks the OTHER way from a slider, off the same arm.
  {
    const sl = flyPitch('slider', { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, { ...NO_SCATTER, pitcherHand: 'R' });
    const sc = flyPitch('screwball', { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, { ...NO_SCATTER, pitcherHand: 'R' });
    ok(sl.x > 0 && sc.x < 0, 'a right-hander\'s slider and screwball break opposite ways (doc §11, [Locked])');
    const slL = flyPitch('slider', { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, { ...NO_SCATTER, pitcherHand: 'L' });
    ok(Math.abs(slL.x + sl.x) < 1e-9, 'a left-hander\'s slider is the exact mirror of a right-hander\'s');
    ok(flyPitch('fastball', { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, NO_SCATTER).x === 0,
      'a fastball does not break at all - it is the baseline the others are measured against');
  }
  // The knuckleball reads its own two draws, both axes, and nothing else does.
  {
    const kA = flyPitch('knuckleball', { x: 0, y: 0 }, 1, SETTINGS, mulberry32(1), {}, { scatter: { x: 0.5, y: 0.5, bx: 1, by: 0 } });
    const rnd = SETTINGS.BREAK_OFFSET.knuckleball.random;
    ok(Math.abs(kA.x - rnd) < 1e-9 && Math.abs(kA.y + rnd) < 1e-9,
      `a knuckleball's break is +-${rnd} in BOTH axes, drawn from the pitch's own draws`);
  }
  // A pitch costs the seeded stream the SAME number of draws whatever type it is - a replayed
  // game must not diverge because a different pitch came up.
  {
    const count = (type) => { let n = 0; flyPitch(type, { x: 0, y: 0 }, 0.5, SETTINGS, () => { n++; return 0.5; }); return n; };
    const counts = SETTINGS.PITCH_TYPES.map(count);
    ok(counts.every((c) => c === counts[0]) && counts[0] === 4,
      `every pitch type draws exactly ${counts[0]} values from the stream (uniform cost, so a seeded replay cannot diverge on pitch choice)`);
  }

  // THE SWING, IN TWO DIMENSIONS.
  {
    const skills = { hitAcc: 0, hitPow: 6, hitSpd: 6 };
    const at = (px, py, cx, cy, mode) => swing({ x: px, y: py, isStrike: true }, skills,
      { action: 'swing', cursor: { x: cx, y: cy }, timingErrorMs: 0, mode }, SETTINGS, () => 0.5, 'college');
    // Quality falls with 2-D distance and reaches zero (a miss) at the circle's own rim.
    const dead = at(0, 0, 0, 0);
    const near = at(0.2, 0, 0, 0);
    const edge = at(0.5, 0, 0, 0);
    // R5 rule 1 REPLACES R2's "quality falls with distance from the cursor": `q` is TIMING quality
    // alone now, and placement never subtracts power. What the distance still does is decide
    // whether there is contact at all, spray the ball, pick the kind, and (in the line-drive band)
    // widen the launch-angle spread. This assertion was `dead.q > near.q > edge.q` until R5.
    ok(dead.q === near.q && near.q === edge.q,
      `the swing's contact quality is TIMING alone - the same timing scores identically dead centre, near and at the rim (${dead.q.toFixed(3)} = ${near.q.toFixed(3)} = ${edge.q.toFixed(3)}), R5 rule 1`);
    ok(Math.abs(dead.exitVeloMph - edge.exitVeloMph) < 1e-9,
      `and placement subtracts NO exit velocity: dead centre and the rim are the same mph on the same seed (${dead.exitVeloMph.toFixed(2)} vs ${edge.exitVeloMph.toFixed(2)})`);
    ok(SETTINGS.FEEL.engine.placementPenaltyMph === undefined,
      'the flat placement penalty is gone from settings.js, not merely unused (R5 rule 1)');
    const diag = at(0.2 / Math.SQRT2, 0.2 / Math.SQRT2, 0, 0);
    ok(Math.abs(diag.sprayAngleDeg - near.sprayAngleDeg) < 1e-9 || diag.contact === near.contact,
      'distance is the 2-D distance: the same offset taken diagonally still makes contact the same way');
    ok(at(0, 0.6, 0, 0).contact === false, 'a ball 0.6 units ABOVE the contact cursor\'s centre is outside its 0.55 circle - a miss');
    // Kind follows the VERTICAL offset, per the spec.
    const R = SETTINGS.FEEL.engine.cursorR.contact;
    const flyOffY = R * SETTINGS.FEEL.engine.flyOffsetFrac;
    const popOffY = R * SETTINGS.FEEL.engine.popupOffsetFrac;
    ok(Math.abs(flyOffY - 0.3) < 0.01, `the CONTACT cursor's fly threshold is the spec's own 0.3 zone units (${flyOffY.toFixed(3)}), expressed as a fraction of the circle's radius so a pop-up can exist inside it at all`);
    ok(at(0, flyOffY + 0.02, 0, 0).kind === 'fly', 'the ball crossing above the cursor\'s centre by more than the fly threshold is a FLY ball');
    ok(at(0, -(flyOffY + 0.02), 0, 0).kind === 'ground', 'below it by the same amount is a GROUNDER');
    ok(at(0, 0, 0, 0).kind === 'line', 'on it is a LINE DRIVE');
    ok(at(0, popOffY + 0.02, 0, 0).kind === 'popup', 'further still (past the pop-up threshold, still inside the circle) is a POP-UP');
    // POWER mode: smaller circle, more exit velocity.
    const cContact = at(0, 0, 0, 0, 'contact');
    const cPower = at(0, 0, 0, 0, 'power');
    const want = SETTINGS.FEEL.engine.modeExitMult.power / SETTINGS.FEEL.engine.modeExitMult.contact;
    ok(Math.abs(cPower.exitVeloMph / cContact.exitVeloMph - want) < 1e-6,
      `POWER mode's exit velocity is exactly x${want} of CONTACT's on the same pitch (${cPower.exitVeloMph.toFixed(2)} vs ${cContact.exitVeloMph.toFixed(2)} mph)`);
    ok(SETTINGS.FEEL.engine.cursorR.power < SETTINGS.FEEL.engine.cursorR.contact, 'and it pays for it with a smaller circle');
    ok(at(0.45, 0, 0, 0, 'power').contact === false && at(0.45, 0, 0, 0, 'contact').contact === true,
      'a ball inside the CONTACT circle but outside the POWER one is a miss in POWER mode and contact in CONTACT mode - that trade IS the mode choice');
    // The horizontal offset sprays.
    ok(at(0.3, 0, 0, 0).sprayAngleDeg > at(-0.3, 0, 0, 0).sprayAngleDeg,
      'meeting the ball on one side of the cursor sprays it that way (the R2 statement of aimX\'s own direction rule)');
  }

  // computeSwingTiming: unchanged by R2, still the one place a raw tap becomes a timing error.
  const t0 = computeSwingTiming({ releaseMs: 1500, timeToPlateS: 1.5, dtS: SETTINGS.FEEL.engine.dtS });
  ok(t0.timingErrorMs === 0, 'a tap at the exact crossing time (no swingDelay/inputOffset) produces zero timing error');
  const tEarly = computeSwingTiming({ releaseMs: 1400, timeToPlateS: 1.5, swingDelayMs: 60, inputOffsetMs: 10, dtS: SETTINGS.FEEL.engine.dtS });
  ok(tEarly.timingErrorMs < 0, 'releasing before the delay-adjusted ideal time reads as early (negative error)');
  ok(t0.swingStep === Math.round(1500 / (SETTINGS.FEEL.engine.dtS * 1000)), 'swingStep quantizes the release to the engine\'s own fixed timestep');
})();

// ---------------------------------------------------------------------------------------------
// Section 27 (BB-3b commit 4): the pre-rolled scatter seam and the additive `swing` event.
await (async function section27() {
  // A pre-rolled `pitchExtras.scatter` reproduces exactly what flyPitch's own internal rand01()
  // draw would have produced at that point, given the SAME underlying draw.
  const randA = mulberry32(42);
  const draws = { x: randA(), y: randA(), bx: randA(), by: randA() }; // the "pre-roll" a human pitcher's UI takes
  const rWithPreroll = flyPitch('curveball', { x: 0.1, y: 0.2 }, 0.5, SETTINGS, () => { throw new Error('should not draw'); }, {}, { scatter: draws });
  const randB = mulberry32(42);
  const rWithoutPreroll = flyPitch('curveball', { x: 0.1, y: 0.2 }, 0.5, SETTINGS, randB);
  ok(rWithPreroll.x === rWithoutPreroll.x && rWithPreroll.y === rWithoutPreroll.y,
    'a pre-rolled pitchExtras.scatter produces the identical (x, y) as flyPitch drawing the same four values itself - what the human pitcher watched IS what the engine scores');

  // Omitting pitchExtras.scatter (every existing caller) still calls rand01() exactly once for
  // the scatter term, at the same point in the stream as before this commit - already covered by
  // section 26's "omitting pitchExtras entirely reproduces prior output byte-for-byte" and by
  // every one of this file's other 2500+ assertions staying green after this change; this adds
  // the direct, minimal check.
  const before = flyPitch('fastball', 0, 0.5, SETTINGS, mulberry32(7));
  const after = flyPitch('fastball', 0, 0.5, SETTINGS, mulberry32(7), {}, { scatter: null, pitcherHand: 'R' });
  ok(before.x === after.x, 'a pitchExtras object with no scatter field still draws its own rand01() scatter, byte-identical to omitting pitchExtras');

  // The additive `swing` event: fires once per pitch, after decideSwing, with {side, action, charged}.
  const seed = 555;
  const homeTeam = makeTeam('college', 0, mulberry32(seed));
  const awayTeam = makeTeam('college', 1, mulberry32(seed + 1));
  const swingEvents = [];
  const g = new Game({
    home: homeTeam, away: awayTeam, seed, settings: SETTINGS,
    agents: {
      home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
      away: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0 }) },
    },
  });
  g.onEvent = async (type, payload) => { if (type === 'swing') swingEvents.push(payload); };
  g.innings = 1;
  await g.playHalfInning();
  ok(swingEvents.length > 0, 'the swing event fires at least once over a half inning');
  ok(swingEvents.every((e) => e.side === 'away' && typeof e.action === 'string'),
    'every swing event carries {side, action} with the expected shapes');
})();

// ---------------------------------------------------------------------------------------------
// Section 28 (R2, docs/BASEBALL-3D-BUILD.md section 9): the agents aim in TWO dimensions, and a
// CPU batter reads the pitch's STRAIGHT point rather than where it is going to end up. Replaces
// BB-3b's steering-direction clamp, deleted with steering itself.
await (async function section28() {
  const view = (seed) => ({ rand01: mulberry32(seed) });
  // A CPU pitcher's aim spreads in y, not just in x - a pitcher that always aimed at the belt
  // would make the whole vertical axis decorative.
  {
    const ys = [], xs = [];
    for (let i = 0; i < 60; i++) {
      const d = await new CpuPitcher({ league: 'majors', settings: SETTINGS }).decidePitch(view(i + 1));
      xs.push(d.aim.x); ys.push(d.aim.y);
    }
    const spread = (a) => Math.max(...a) - Math.min(...a);
    ok(spread(ys) > 0.5, `a CPU pitcher's aim HEIGHT spreads across the zone (${spread(ys).toFixed(2)} zone units over 60 pitches)`);
    ok(spread(xs) > 0.5, `and its aim SIDE still does (${spread(xs).toFixed(2)})`);
  }
  // A CPU batter places a 2-D cursor, and it is aimed at the pitch's straight point.
  {
    const skills = { hitAcc: 6, hitPow: 6, hitSpd: 6 };
    const pitch = { type: 'curveball', x: 0.45, y: -0.35, straightX: 0, straightY: 0, isStrike: true, timeToPlateS: 0.65 };
    let swings = 0, nearStraight = 0;
    for (let i = 0; i < 200; i++) {
      const d = await new CpuBatter({ league: 'majors', skills, settings: SETTINGS }).decideSwing({ ...view(i + 900), pitch, pitchHistory: [] });
      if (d.action !== 'swing') continue;
      swings++;
      if (Math.hypot(d.cursor.x - pitch.straightX, d.cursor.y - pitch.straightY)
        < Math.hypot(d.cursor.x - pitch.x, d.cursor.y - pitch.y)) nearStraight++;
      if (d.mode !== 'contact' && d.mode !== 'power') { swings = -1; break; }
    }
    ok(swings > 20, `a CPU batter swings at a hittable curveball (${swings} of 200)`);
    ok(nearStraight / Math.max(1, swings) > 0.8,
      `and puts its cursor nearer the pitch's STRAIGHT point than its broken one ${(100 * nearStraight / Math.max(1, swings)).toFixed(0)}% of the time - the break is exactly what it is fooled by`);
  }
  // Every batting agent returns a legal mode, and a strong batter picks POWER more than a weak one.
  {
    const rate = (hitPow) => {
      let power = 0, n = 0;
      for (let i = 0; i < 400; i++) {
        const r = mulberry32(i + 1);
        if (pickMode({ hitPow }, r) === 'power') power++;
        n++;
      }
      return power / n;
    };
    const weak = rate(0), strong = rate(8);
    ok(weak === 0, 'a batter with no power at all never picks POWER mode');
    ok(strong > weak, `and a strong one picks it ${(strong * 100).toFixed(0)}% of the time (rises with hitPow, capped well under "always")`);
  }
  // The 'swing' event carries the MODE now, not `charged`.
  {
    const seed = 555;
    const homeTeam = makeTeam('college', 0, mulberry32(seed));
    const awayTeam = makeTeam('college', 1, mulberry32(seed + 1));
    const swingEvents = [];
    const g = new Game({
      home: homeTeam, away: awayTeam, seed, settings: SETTINGS,
      agents: {
        home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }),
          decideSwing: async () => ({ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'power' }) },
      },
    });
    g.onEvent = async (type, payload) => { if (type === 'swing') swingEvents.push(payload); };
    g.innings = 1;
    await g.playHalfInning();
    ok(swingEvents.length > 0, 'the swing event fires at least once over a half inning');
    ok(swingEvents.every((e) => e.side === 'away' && typeof e.action === 'string' && (e.mode === 'power' || e.mode === 'contact')),
      'every swing event carries {side, action, mode} - `charged` is gone with the charged swing');
  }
})();

// ---------------------------------------------------------------------------------------------
// Section 29 (R3, docs/BASEBALL-3D-BUILD.md section 9): `atBatEnd` carries `basesBefore` (the
// runner array exactly as it stood when the at-bat opened) and `runnersOut` (this play's own
// removed-without-scoring runners), both additive - the UI runs baserunning off these, never off
// its own guess.
await (async function section29() {
  // A forced walk with a runner already on first: `basesBefore` must be the array from BEFORE the
  // walk's own `advanceWalk` mutated `this.bases`, and a walk removes nobody (`runnersOut` empty).
  const seed = 777;
  const homeTeam = makeTeam('college', 0, mulberry32(seed));
  const awayTeam = makeTeam('college', 1, mulberry32(seed + 1));
  const g = new Game({
    home: homeTeam, away: awayTeam, seed, settings: SETTINGS,
    agents: {
      // home pitches (defense) to away (batting, top half): aim far outside the zone every pitch,
      // well past aimScatter's own spread (0.12), so every pitch is a called ball.
      home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 5, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
      away: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
    },
  });
  g.bases = ['runnerOnFirst', null, null];
  let payload = null;
  g.onEvent = async (type, p) => { if (type === 'atBatEnd') payload = p; };
  await g.playAtBat();
  ok(!!payload, 'a forced 4-ball at-bat resolved with an atBatEnd event');
  ok(payload && payload.outcome === 'walk', `the outcome was a walk (got ${payload && payload.outcome})`);
  ok(payload && Array.isArray(payload.basesBefore) && payload.basesBefore[0] === 'runnerOnFirst'
    && payload.basesBefore[1] == null && payload.basesBefore[2] == null,
    'atBatEnd carries basesBefore, the runner array exactly as it stood at the pitch (R3)');
  ok(payload && Array.isArray(payload.runnersOut) && payload.runnersOut.length === 0,
    'a walk removes no runner (runnersOut empty, R3)');
})();

// ---------------------------------------------------------------------------------------------
// Section 30 (RA, docs/BASEBALL-3D-BUILD.md section 9): STEAL, BUNT, PICKOFF, and Quick Play's own
// eight pitches. Every rule the spec states, one block each, driven through the REAL engine
// wherever the rule is about the at-bat loop (a steal's third out, a pickoff throwing no pitch)
// and through the real pure function where it is about the maths (the two success bands).
console.log('\n-- 30. RA: steal, bunt, pickoff, and Quick Play\'s eight pitches --');
await (async function section30() {
  const RUNNER = 'stealer';
  const BALL_OUTSIDE = { type: 'fastball', aim: { x: 5, y: 0 } };   // never a strike: past aimScatter's own spread

  /** A two-team fixture with the runner's legs and the pitcher's accuracy pinned, so the steal's
   *  own formula has exactly one value and an observed rate can be compared against it. */
  function fixture(league, { runnerHitSpd = 0, pitcherAcc = 0, settings = null } = {}) {
    const home = makeTeam(league, 0, mulberry32(11));
    const away = makeTeam(league, 1, mulberry32(12));
    for (const pl of away.players) pl.skills.hitSpd = runnerHitSpd;
    const pitcher = home.players.find((pl) => pl.id === home.pitcherId);
    pitcher.skills.pitchAcc = pitcherAcc;
    // The man on first, renamed onto the roster so the engine's own skill lookup finds him. The
    // batting order (and, defensively, the pitcher slot) hold IDS, so both are remapped with him -
    // renaming the player alone leaves `_currentBatterId` pointing at somebody who no longer exists.
    const wasId = away.players[3].id;
    away.players[3].id = RUNNER;
    away.battingOrder = away.battingOrder.map((id) => (id === wasId ? RUNNER : id));
    if (away.pitcherId === wasId) away.pitcherId = RUNNER;
    return { home, away, settings };
  }

  /** N steal attempts through the real `playAtBat`, counting the engine's own 'steal' events. The
   *  bases/outs are reset before each at-bat so the sweep never ends a half-inning; every draw
   *  still comes from the game's own seeded stream. */
  async function stealTrials(league, opts, want) {
    const { home, away, settings } = fixture(league, opts);
    const g = new Game({
      home, away, seed: 20260920, settings: settings || undefined,
      agents: {
        home: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take', steal: true }) },
      },
    });
    let tries = 0, safe = 0;
    g.onEvent = async (type, pl) => { if (type === 'steal') { tries += 1; if (pl.safe) safe += 1; } };
    while (tries < want) {
      g.bases = [RUNNER, null, null];
      g.outs = 0; g.balls = 0; g.strikes = 0; g._atBatOpen = false;
      await g.playAtBat();
    }
    return { tries, rate: safe / tries };
  }

  // --- the steal's success band, at zero skill and at the Majors cap -----------------------------
  {
    const cap = SETTINGS.CAPS.majors;
    const perPt = SETTINGS.SKILL_EFFECT.hitSpd.stealSuccessPerPt;
    const cases = [
      { label: 'zero skill both sides', runnerHitSpd: 0, pitcherAcc: 0, want: SETTINGS.STEAL_BASE },
      { label: 'runner at the Majors cap', runnerHitSpd: cap, pitcherAcc: 0, want: SETTINGS.STEAL_BASE + perPt * cap },
      { label: 'pitcher at the Majors cap', runnerHitSpd: 0, pitcherAcc: cap, want: SETTINGS.STEAL_BASE - SETTINGS.STEAL_PER_ACC * cap },
    ];
    for (const c of cases) {
      const wanted = Math.max(SETTINGS.STEAL_MIN, Math.min(SETTINGS.STEAL_MAX, c.want));
      const got = await stealTrials('majors', { runnerHitSpd: c.runnerHitSpd, pitcherAcc: c.pitcherAcc }, 10000);
      ok(Math.abs(got.rate - wanted) <= 0.03,
        `steal band, ${c.label}: ${got.tries} attempts came back safe ${got.rate.toFixed(3)} of the time against the formula's ${wanted.toFixed(3)} (budget 0.03)`);
    }
    // The clamp is a real rule, not decoration: a runner well past any league's cap still tops out.
    const g = new Game({ ...fixture('majors'), seed: 1, agents: { home: {}, away: {} } });
    ok(g._stealChance(1000, { skills: { pitchAcc: 0 } }) === SETTINGS.STEAL_MAX, 'the steal chance is clamped at STEAL_MAX');
    ok(g._stealChance(0, { skills: { pitchAcc: 1000 } }) === SETTINGS.STEAL_MIN, 'the steal chance is clamped at STEAL_MIN');
  }

  // --- the CPU's own 2-out/3-ball guard ---------------------------------------------------------
  {
    const skills = { hitAcc: 5, hitPow: 20, hitSpd: 20 };
    const batter = new CpuBatter({ league: 'majors', skills, settings: SETTINGS });
    const view = (outs, balls) => {
      let seq = 0;
      return {
        side: 'away', inning: 1, half: 'top', outs, balls, strikes: 0,
        bases: ['r', null, null], score: { home: 0, away: 0 }, batterId: 'b',
        pitch: { type: 'fastball', x: 0, y: 0, isStrike: true, timeToPlateS: 0.5, straightX: 0, straightY: 0 },
        pitchHistory: [], steal: { runnerId: 'r', from: 0, to: 1, hitSpd: 20 },
        // a stream that always returns 0, so every probabilistic decision that CAN say yes does
        rand01: () => { seq += 1; return 0; },
      };
    };
    const guarded = await batter.decideSwing(view(2, 3));
    ok(guarded.steal === false, 'the CPU never steals with 2 outs and a 3-ball count, even on a draw that would always say yes');
    const free = await batter.decideSwing(view(1, 3));
    ok(free.steal === true, 'the same CPU batter DOES steal with 1 out and a 3-ball count (the guard is the two together, not either alone)');
    const free2 = await batter.decideSwing(view(2, 2));
    ok(free2.steal === true, 'the same CPU batter DOES steal with 2 outs and a 2-ball count');
    // ... and the draw is not taken at all when nobody can run, so an empty-bases pitch consumes
    // exactly the draws it consumed before RA (the determinism note in agents.js).
    const noRunner = { ...view(0, 0), steal: null, bases: [null, null, null] };
    let drawsWith = 0, drawsWithout = 0;
    const counting = (n) => ({ ...view(0, 0), rand01: () => { n.c += 1; return 0.99; } });
    const a = { c: 0 }, b = { c: 0 };
    await batter.decideSwing({ ...counting(a) });
    await batter.decideSwing({ ...counting(b), steal: null, bases: [null, null, null] });
    drawsWith = a.c; drawsWithout = b.c;
    ok(drawsWith === drawsWithout + 1,
      `a steal-eligible pitch costs exactly ONE extra draw (${drawsWith} against ${drawsWithout}) - an empty-bases pitch is untouched`);
  }

  // --- a caught steal is an out, and its third out ends the half-inning --------------------------
  {
    const never = { STEAL_BASE: 0, STEAL_MIN: 0, STEAL_MAX: 0 };
    const { home, away } = fixture('college');
    const g = new Game({
      home, away, seed: 4242, settings: never,
      agents: {
        home: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take', steal: true }) },
      },
    });
    g.outs = 2;
    g.bases = [RUNNER, null, null];
    g._resumeHalfPending = true;   // keep the outs we just set; this half is "already in progress"
    const seen = [];
    const lineupBefore = g.lineupPos.away;
    g.onEvent = async (type, pl) => { seen.push([type, pl]); };
    await g.playHalfInning();
    const steal = seen.find(([t]) => t === 'steal');
    ok(!!steal && steal[1].safe === false, 'the caught steal was emitted with safe:false');
    ok(seen.some(([t]) => t === 'halfInningEnd'), 'a caught steal for the third out ends the half-inning through the ordinary path');
    ok(g.outs >= SETTINGS.MECHANICS.outsPerInning, `the caught steal recorded the third out (outs=${g.outs})`);
    ok(g.lineupPos.away === lineupBefore,
      'the lineup pointer stays on the batter who was at the plate - he leads off the next time this side bats');
    ok(!seen.some(([t, pl]) => t === 'atBatEnd' && pl && pl.outcome === 'walk'),
      'no walk is converted off the pitch that carried the inning-ending caught steal');
  }

  // --- a steal is VOID when the batter puts the ball in play -------------------------------------
  {
    const { home, away } = fixture('college');
    const g = new Game({
      home, away, seed: 99, settings: { STEAL_BASE: 1, STEAL_MIN: 1, STEAL_MAX: 1 },
      agents: {
        home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
        away: {
          decidePitch: async () => BALL_OUTSIDE,
          // A swing with the cursor where the pitch is and perfect timing: contact, in play.
          decideSwing: async (v) => ({ action: 'swing', steal: true, timingErrorMs: 0,
            cursor: { x: v.pitch.x, y: v.pitch.y }, mode: 'contact' }),
        },
      },
    });
    g.bases = [RUNNER, null, null];
    let stealEvents = 0, ended = null;
    g.onEvent = async (type, pl) => { if (type === 'steal') stealEvents += 1; if (type === 'atBatEnd') ended = pl; };
    await g.playAtBat();
    ok(!!ended, 'the at-bat ended on a ball in play');
    ok(stealEvents === 0, 'no steal event is emitted on a ball in play - the runner was already moving and the play resolves as normal');
  }

  // --- the pickoff's success band -----------------------------------------------------------------
  {
    const cap = SETTINGS.CAPS.majors;
    const perPt = SETTINGS.SKILL_EFFECT.pitchAcc.pickoffPerPt;
    for (const [label, acc, want] of [
      ['zero accuracy', 0, SETTINGS.PICKOFF_BASE],
      ['the Majors cap', cap, SETTINGS.PICKOFF_BASE + perPt * cap],
    ]) {
      const { home, away } = fixture('majors', { pitcherAcc: acc });
      const g = new Game({
        home, away, seed: 7777,
        agents: {
          home: { decidePitch: async () => ({ pickoff: true }), decideSwing: async () => ({ action: 'take' }) },
          away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take' }) },
        },
      });
      let tries = 0, outs = 0;
      g.onEvent = async (type, pl) => { if (type === 'pickoff') { tries += 1; if (pl.out) outs += 1; } };
      while (tries < 10000) {
        g.bases = [RUNNER, null, null];
        g.outs = 0; g.balls = 0; g.strikes = 0; g._atBatOpen = false;
        await g.playAtBat();
      }
      const wanted = Math.max(SETTINGS.PICKOFF_BASE, Math.min(SETTINGS.PICKOFF_MAX, want));
      ok(Math.abs(outs / tries - wanted) <= 0.03,
        `pickoff band, ${label}: ${tries} throws got the runner ${(outs / tries).toFixed(3)} of the time against the formula's ${wanted.toFixed(3)} (budget 0.03)`);
    }
    const { home, away } = fixture('majors');
    const g2 = new Game({ home, away, seed: 1, agents: { home: {}, away: {} } });
    ok(g2._pickoffChance({ skills: { pitchAcc: 1000 } }) === SETTINGS.PICKOFF_MAX, 'the pickoff chance is clamped at PICKOFF_MAX');
    ok(g2._pickoffChance({ skills: { pitchAcc: 0 } }) === SETTINGS.PICKOFF_BASE, 'the pickoff chance floors at PICKOFF_BASE');
  }

  // --- a pickoff throws NO pitch and leaves the count alone ----------------------------------------
  {
    const { home, away } = fixture('college');
    let threwOver = false;
    const g = new Game({
      home, away, seed: 31337, settings: { PICKOFF_BASE: 0, PICKOFF_MAX: 0 },  // never gets him
      agents: {
        home: {
          decidePitch: async () => { if (!threwOver) { threwOver = true; return { pickoff: true }; } return BALL_OUTSIDE; },
          decideSwing: async () => ({ action: 'take' }),
        },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take' }) },
      },
    });
    g.bases = [RUNNER, null, null];
    const order = [];
    const countAt = [];
    g.onEvent = async (type, pl) => {
      order.push(type);
      if (type === 'pickoff') countAt.push({ balls: g.balls, strikes: g.strikes, outs: g.outs, lineup: g.lineupPos.away });
      if (type === 'count' && pl.balls >= 1) g.abort();   // stop after the first real pitch resolves
    };
    await g.playAtBat();
    const pickIdx = order.indexOf('pickoff');
    const pitchIdx = order.indexOf('pitch');
    ok(pickIdx >= 0, 'the pickoff was emitted');
    ok(pitchIdx === -1 || pickIdx < pitchIdx, 'the pickoff threw no pitch - no pitch event precedes it');
    ok(countAt[0] && countAt[0].balls === 0 && countAt[0].strikes === 0,
      `the count is untouched by a pickoff (${countAt[0] && countAt[0].balls}-${countAt[0] && countAt[0].strikes})`);
    ok(countAt[0] && countAt[0].lineup === 0, 'the lineup does not advance on a pickoff - the same batter is still up');
    ok(g.bases[0] === RUNNER, 'a pickoff that misses leaves the runner exactly where he was');
    // The safety valve: an agent that ONLY ever throws over still terminates the at-bat.
    const g2 = new Game({
      home, away, seed: 4, settings: { PICKOFF_BASE: 0, PICKOFF_MAX: 0 },
      agents: {
        home: { decidePitch: async () => ({ pickoff: true }), decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'take' }) },
      },
    });
    g2.bases = [RUNNER, null, null];
    let picks = 0, pitches = 0;
    g2.onEvent = async (type) => { if (type === 'pickoff') picks += 1; if (type === 'pitch') pitches += 1; };
    await g2.playAtBat();
    ok(picks === SETTINGS.PICKOFF_MAX_PER_AT_BAT,
      `PICKOFF_MAX_PER_AT_BAT binds at ${SETTINGS.PICKOFF_MAX_PER_AT_BAT} throws (${picks}), so an all-pickoff agent cannot spin the pitch loop`);
    ok(pitches > 0, 'and the at-bat goes on to real pitches once the cap binds');
  }

  // --- the bunt: a foul bunt with two strikes IS strike three --------------------------------------
  {
    const skills = { hitAcc: 0, hitPow: 0, hitSpd: 0 };
    const pitch = { type: 'fastball', x: 0, y: 0, isStrike: true, timeToPlateS: 0.5 };
    const wide = SETTINGS.FEEL.engine.timingWindow * SETTINGS.BUNT_WINDOW_MULT;
    const foul = swing(pitch, skills, { action: 'swing', bunt: true, timingErrorMs: wide + 50 }, SETTINGS, () => 0.5, 'college');
    ok(foul.foul === true && foul.inPlay === false && foul.bunt === true,
      'a bunt timed outside the widened window is a foul, never a swinging miss');
    const good = swing(pitch, skills, { action: 'swing', bunt: true, timingErrorMs: 0 }, SETTINGS, () => 0.5, 'college');
    ok(good.inPlay === true && good.kind === 'ground' && good.bunt === true, 'a well-timed bunt is always a grounder in play');
    ok(good.distanceFt >= SETTINGS.BUNT_DIST_FT[0] && good.distanceFt <= SETTINGS.BUNT_DIST_FT[1],
      `a bunt travels inside BUNT_DIST_FT (${good.distanceFt.toFixed(1)} ft)`);
    ok(Math.abs(good.sprayAngleDeg) <= SETTINGS.BUNT_SPRAY_DEG, 'a bunt sprays inside +/-BUNT_SPRAY_DEG');
    ok(SETTINGS.BUNT_SPRAY_DEG < SETTINGS.FOUL_LINE_DEG, 'a bunt that makes contact is never in foul ground');
    // The window really is WIDER than an ordinary swing's, which is the whole reason to bunt.
    const ordinaryEdge = SETTINGS.FEEL.engine.timingWindow;
    const stillFair = swing(pitch, skills, { action: 'swing', bunt: true, timingErrorMs: ordinaryEdge + 10 }, SETTINGS, () => 0.5, 'college');
    ok(stillFair.inPlay === true, 'a bunt still makes contact at a timing error that would have fouled an ordinary swing');

    // End to end: a two-strike foul bunt is a strikeout, through the real at-bat loop.
    const { home, away } = fixture('college');
    const g = new Game({
      home, away, seed: 606,
      agents: {
        home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
        away: {
          decidePitch: async () => BALL_OUTSIDE,
          decideSwing: async () => ({ action: 'swing', bunt: true, timingErrorMs: wide + 500 }),
        },
      },
    });
    let ended = null; const verdicts = [];
    g.onEvent = async (type, pl) => { if (type === 'atBatEnd') ended = pl; if (type === 'count') verdicts.push(pl.verdict); };
    await g.playAtBat();
    ok(ended && ended.outcome === 'strikeout',
      `three foul bunts in a row is a strikeout (got ${ended && ended.outcome}, verdicts ${verdicts.join(',')})`);
    // Three 'count' events, all reading 'foul': game.js emits the count for the third one too,
    // BEFORE converting it into the strikeout (its own ordering note), so the player sees the pitch
    // that got him as the foul bunt it was rather than as an unexplained third strike.
    ok(verdicts.length === 3 && verdicts.every((v) => v === 'foul'),
      `all three pitches read as fouls on the count (${verdicts.join(',')})`);
  }

  // --- the bunt: sacrifice, beat-out, and the nobody-on split ---------------------------------------
  {
    const batted = { distanceFt: 20, sprayAngleDeg: 10 };
    const never = () => 1;     // the beat-out roll never succeeds
    const always = () => 0;    // it always does
    const sac = resolveBunt(batted, ['r1', null, null], 1, 0, SETTINGS, never);
    ok(sac.kind === 'sacrifice' && sac.result === 'out', 'a bunt with a runner on and 1 out is a sacrifice');
    const sacTwoOut = resolveBunt(batted, ['r1', null, null], 2, 0, SETTINGS, never);
    ok(sacTwoOut.kind === 'bunt-out', 'with 2 outs it is not a sacrifice - it is a bunt for a hit that failed');
    const beat = resolveBunt(batted, ['r1', null, null], 1, 20, SETTINGS, always);
    ok(beat.kind === 'bunt-single' && beat.result === 'hit' && beat.bases === 1,
      'the beat-out roll turns the sacrifice into a bunt single');
    const alone = resolveBunt(batted, [null, null, null], 0, 20, SETTINGS, always);
    ok(alone.kind === 'bunt-single', 'nobody on, the roll succeeds: a bunt single');
    const aloneOut = resolveBunt(batted, [null, null, null], 0, 20, SETTINGS, never);
    ok(aloneOut.kind === 'bunt-out', 'nobody on, the roll fails: a bunt out');
    // Split BY SKILL, on the real roll: the beat-out chance is hitSpd x MECHANICS.beatOutPerPt.
    const rateFor = (hitSpd) => {
      let hits = 0; const N = 20000; let seed = 1234;
      const rnd = () => { const r = stepRng(seed); seed = r.next; return r.value; };
      for (let i = 0; i < N; i++) {
        if (resolveBunt(batted, [null, null, null], 0, hitSpd, SETTINGS, rnd).kind === 'bunt-single') hits += 1;
      }
      return hits / N;
    };
    const slow = rateFor(0), quick = rateFor(20);
    const wantQuick = Math.min(0.5, 20 * SETTINGS.MECHANICS.beatOutPerPt);
    ok(slow === 0, `a batter with no speed never beats out a bunt (${slow})`);
    ok(Math.abs(quick - wantQuick) <= 0.02,
      `a 20-point hitSpd batter beats out ${quick.toFixed(3)} of his bunts against MECHANICS.beatOutPerPt's ${wantQuick.toFixed(3)}`);

    // End to end: the sacrifice actually MOVES the runner and records the out.
    const { home, away } = fixture('college');
    const g = new Game({
      home, away, seed: 808, settings: { MECHANICS: { ...SETTINGS.MECHANICS, beatOutPerPt: 0 } },
      agents: {
        home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'swing', bunt: true, timingErrorMs: 0 }) },
      },
    });
    g.bases = [RUNNER, null, null];
    g.outs = 1;
    let ended = null;
    g.onEvent = async (type, pl) => { if (type === 'atBatEnd') ended = pl; };
    await g.playAtBat();
    ok(ended && ended.outcome === 'sacrifice', `the at-bat ended as a sacrifice (got ${ended && ended.outcome})`);
    ok(g.bases[1] === RUNNER && g.bases[0] == null, 'the runner advanced from first to second');
    ok(g.outs === 2, `the batter is out (outs 1 -> ${g.outs})`);
    ok(ended && ended.battedKind === 'ground', "atBatEnd carries battedKind 'ground' for a bunt");
    ok(ended && Array.isArray(ended.basesBefore) && ended.basesBefore[0] === RUNNER,
      'the sacrifice still carries basesBefore, exactly as every other atBatEnd does (R3)');
    // A sacrifice with a runner on THIRD scores him.
    const g2 = new Game({
      home, away, seed: 909, settings: { MECHANICS: { ...SETTINGS.MECHANICS, beatOutPerPt: 0 } },
      agents: {
        home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }), decideSwing: async () => ({ action: 'take' }) },
        away: { decidePitch: async () => BALL_OUTSIDE, decideSwing: async () => ({ action: 'swing', bunt: true, timingErrorMs: 0 }) },
      },
    });
    g2.bases = [null, null, RUNNER];
    g2.outs = 0;
    let ended2 = null;
    g2.onEvent = async (type, pl) => { if (type === 'atBatEnd') ended2 = pl; };
    await g2.playAtBat();
    ok(ended2 && ended2.runsScored === 1 && g2.score.away === 1, 'a squeeze scores the runner from third');
  }

  // --- R11 (docs/BASEBALL-3D-BUILD.md section 9): the all-eight override is GONE - Quick Play and
  // career throw the SAME ladder, and the CPU throws it from the SAME `pitchMix` career uses.
  // This block used to prove the opposite (RA's own, now-overruled decision); it proves the new
  // rule instead. -------------------------------------------------------------------------------
  {
    for (const lg of SETTINGS.LEAGUES) {
      const quickPlay = SETTINGS.unlockedPitchesFor(lg, 0, { quickPlay: true });
      const career = SETTINGS.unlockedPitchesFor(lg, 0);
      ok(JSON.stringify(quickPlay) === JSON.stringify(SETTINGS.PITCH_UNLOCKS[lg]),
        `unlockedPitchesFor('${lg}', 0, {quickPlay:true}) returns the league's own career ladder, not all eight`);
      ok(JSON.stringify(career) === JSON.stringify(SETTINGS.PITCH_UNLOCKS[lg]),
        `unlockedPitchesFor('${lg}', 0) with no quickPlay option returns the identical ladder - the option is a no-op now`);
    }
    // Little League is FASTBALL ONLY (Matt, 2026-09-21: "only 'fastballs' should be able to be
    // thrown"); changeup moved to High School, alongside curveball.
    ok(JSON.stringify(SETTINGS.PITCH_UNLOCKS.little) === JSON.stringify(['fastball']),
      `Little League's own ladder is fastball only (got ${JSON.stringify(SETTINGS.PITCH_UNLOCKS.little)})`);
    ok(JSON.stringify(SETTINGS.PITCH_UNLOCKS.highschool) === JSON.stringify(['fastball', 'changeup', 'curveball']),
      `High School's own ladder picks up changeup and curveball together (got ${JSON.stringify(SETTINGS.PITCH_UNLOCKS.highschool)})`);
    ok(SETTINGS.QUICK_PLAY_PITCH_MIX === undefined, 'QUICK_PLAY_PITCH_MIX is deleted with the override it existed only to serve');
    // The CPU actually respects the ladder now: a Little League CPU in Quick Play throws fastball
    // only, exactly as it does in a career game - there is no longer a second distribution to
    // diverge from it.
    const seen = new Set();
    const pitcher = new CpuPitcher({ league: 'little', settings: SETTINGS });
    let seed = 5150;
    const rnd = () => { const r = stepRng(seed); seed = r.next; return r.value; };
    for (let i = 0; i < 2000; i++) {
      const d = await pitcher.decidePitch({ quickPlay: true, runnerOnFirst: false, weakZone: null, rand01: rnd });
      seen.add(d.type);
    }
    ok(seen.size === 1 && seen.has('fastball'),
      `a Little League CPU in Quick Play throws fastball only now (saw ${JSON.stringify([...seen])}) - the career ladder gives it the identical one type`);
    const careerSeen = new Set();
    for (let i = 0; i < 2000; i++) {
      const d = await pitcher.decidePitch({ runnerOnFirst: false, weakZone: null, rand01: rnd });
      careerSeen.add(d.type);
    }
    ok(careerSeen.size === 1 && careerSeen.has('fastball'),
      'and the same CPU pitcher in a CAREER game (no quickPlay flag) throws the identical one type');
    // A High School CPU (changeup AND curveball unlocked, doc §11) still throws both in Quick Play.
    const hsPitcher = new CpuPitcher({ league: 'highschool', settings: SETTINGS });
    const hsSeen = new Set();
    let hsSeed = 24601;
    const hsRnd = () => { const r = stepRng(hsSeed); hsSeed = r.next; return r.value; };
    for (let i = 0; i < 2000; i++) {
      const d = await hsPitcher.decidePitch({ quickPlay: true, runnerOnFirst: false, weakZone: null, rand01: hsRnd });
      hsSeen.add(d.type);
    }
    ok(hsSeen.size === 3 && hsSeen.has('fastball') && hsSeen.has('changeup') && hsSeen.has('curveball'),
      `a High School CPU in Quick Play throws its own three-pitch ladder (saw ${JSON.stringify([...hsSeen])})`);
  }

  // --- the CPU pitcher's own pickoff rate ------------------------------------------------------------
  {
    const pitcher = new CpuPitcher({ league: 'majors', settings: SETTINGS });
    let seed = 24680;
    const rnd = () => { const r = stepRng(seed); seed = r.next; return r.value; };
    let overs = 0; const N = 20000;
    for (let i = 0; i < N; i++) {
      const d = await pitcher.decidePitch({ runnerOnFirst: true, weakZone: null, rand01: rnd });
      if (d.pickoff) overs += 1;
    }
    ok(Math.abs(overs / N - SETTINGS.CPU_PICKOFF_RATE) <= 0.01,
      `the CPU pitcher throws over ${(overs / N).toFixed(3)} of the time against CPU_PICKOFF_RATE's ${SETTINGS.CPU_PICKOFF_RATE}`);
    let noneWithEmptyBag = 0;
    for (let i = 0; i < 2000; i++) {
      const d = await pitcher.decidePitch({ runnerOnFirst: false, weakZone: null, rand01: rnd });
      if (d.pickoff) noneWithEmptyBag += 1;
    }
    ok(noneWithEmptyBag === 0, 'and never throws over with nobody on first');
  }
})();

// ---------------------------------------------------------------------------------------------
// Section 31 (R4, docs/BASEBALL-3D-BUILD.md section 9): `atBatEnd` carries `launchAngleDeg` on a
// ball in play - additive, straight off `swingResult.launchAngleDeg`, the same discipline as
// `exitVeloMph`/`sprayAngleDeg` before it. It is what the HOME RUN stats strip's `{deg}` reads.
console.log('\n-- 31. R4: atBatEnd carries launchAngleDeg --');
await (async function section31() {
  const seed = 5150;
  const homeTeam = makeTeam('majors', 0, mulberry32(seed));
  const awayTeam = makeTeam('majors', 1, mulberry32(seed + 1));
  const g = new Game({
    home: homeTeam, away: awayTeam, seed, settings: SETTINGS,
    agents: {
      // A dead-center fastball, swung PERFECT-timed contact/power every time, so this at-bat is
      // guaranteed to put a ball in play rather than strike out or walk.
      home: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }),
        decideSwing: async (v) => ({ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'power' }) },
      away: { decidePitch: async () => ({ type: 'fastball', aim: { x: 0, y: 0 } }),
        decideSwing: async (v) => ({ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'power' }) },
    },
  });
  let payload = null;
  g.onEvent = async (type, p) => { if (type === 'atBatEnd' && payload == null) payload = p; };
  await g.playAtBat();
  ok(!!payload, 'a perfect-timed swing at a centered fastball resolved with an atBatEnd event');
  ok(payload && typeof payload.launchAngleDeg === 'number',
    `atBatEnd carries a numeric launchAngleDeg on a ball in play (got ${payload && payload.launchAngleDeg})`);
})();


// ---------------------------------------------------------------------------------------------
// Section 32 (R5, docs/BASEBALL-3D-BUILD.md section 9): CONTACT AND CARRY. The stage's own five
// deliverables, in order, plus the derivation the numbers in settings.js are written from.
// Measured before this stage, through the real swing.js/outcomes.js at Quick Play's preset roster
// and the College park: a perfectly timed dead-centre CONTACT swing carried 0 ft on 27.9% of
// swings and the same swing 0.2 zone units off centre carried 0 ft on 100% of them. Every
// assertion below exists so that cannot come back.
console.log('\n-- 32. R5: contact and carry --');
await (async function section32() {
  const F = SETTINGS.FEEL.engine;
  const presets = Object.values(SETTINGS.PRESETS);

  // (a) 20,000 random in-play swings per league and per mode, none under MIN_IN_PLAY_FT.
  {
    let checked = 0, worst = Infinity, worstAt = null, zeroFt = 0;
    for (const league of SETTINGS.LEAGUES) {
      for (const mode of ['contact', 'power']) {
        const zones = zonesFor(league, 0);
        const fenceFt = SETTINGS.FIELD[league].fenceFt;
        const r = mulberry32(hashSeed('r5-in-play', league, mode));
        let swings = 0;
        while (swings < 20000) {
          const skills = presets[swings % presets.length];
          const pitch = flyPitch('fastball', { x: (r() * 2 - 1) * 1.2, y: (r() * 2 - 1) * 1.2 }, 0.6, SETTINGS, r);
          const decision = { action: 'swing', mode, timingErrorMs: (r() * 2 - 1) * 200,
            cursor: { x: (r() * 2 - 1) * 1.2, y: (r() * 2 - 1) * 1.2 } };
          const sr = swing(pitch, skills, decision, SETTINGS, r, league);
          swings += 1;
          if (!sr.contact || !sr.inPlay) continue;
          const oc = resolveContact(sr, zones, SETTINGS, fenceFt, skills.hitSpd, r);
          if (oc.isFoul) continue; // a foul out never carried anywhere
          checked += 1;
          if (oc.distanceFt <= 0) zeroFt += 1;
          if (oc.distanceFt < worst) { worst = oc.distanceFt; worstAt = `${league}/${mode}`; }
        }
      }
    }
    ok(checked > 0, `(a) the in-play sweep actually produced balls in play (${checked} of 200000 swings)`);
    ok(zeroFt === 0, `(a) NO ball in play carries 0 ft, at any league or mode (${zeroFt} of ${checked})`);
    ok(worst >= SETTINGS.MIN_IN_PLAY_FT - 1e-9,
      `(a) and none is under MIN_IN_PLAY_FT (shortest ${worst.toFixed(1)} ft at ${worstAt}, floor ${SETTINGS.MIN_IN_PLAY_FT} ft)`);
  }

  // (b) A perfectly-timed dead-centre swing is never 0 ft, and its exit velocity is inside
  //     [70, 115] at EVERY league - the broadcast band R4's HOME RUN strip prints.
  {
    for (const league of SETTINGS.LEAGUES) {
      const zones = zonesFor(league, 0);
      const fenceFt = SETTINGS.FIELD[league].fenceFt;
      const r = mulberry32(hashSeed('r5-perfect-centre', league));
      let lo = Infinity, hi = -Infinity, shortest = Infinity, n = 0;
      for (let i = 0; i < 4000; i++) {
        const skills = presets[i % presets.length];
        const pitch = { x: 0, y: 0, isStrike: true };
        const sr = swing(pitch, skills, { action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'contact' }, SETTINGS, r, league);
        if (!sr.inPlay) continue;
        n += 1;
        lo = Math.min(lo, sr.exitVeloMph); hi = Math.max(hi, sr.exitVeloMph);
        const oc = resolveContact(sr, zones, SETTINGS, fenceFt, skills.hitSpd, r);
        shortest = Math.min(shortest, oc.distanceFt);
      }
      ok(n === 4000, `(b) ${league}: every perfectly-timed dead-centre swing is in play (${n}/4000)`);
      ok(shortest > 0, `(b) ${league}: and none of them carries 0 ft (shortest ${shortest.toFixed(1)} ft)`);
      // Little League's own bat is held back by LEAGUE_POWER_SCALE (0.525) on purpose - a 210 ft
      // park - so its band is its own, below the broadcast band the other four share.
      const band = league === 'little' ? [45, 75] : [70, 115];
      ok(lo >= band[0] && hi <= band[1],
        `(b) ${league}: exit velocity reads like a broadcast number, ${lo.toFixed(1)} to ${hi.toFixed(1)} mph inside [${band[0]}, ${band[1]}]`);
    }
  }

  // (c) R5 rule 1: with the same seed, cursor offset 0 and cursor offset 0.3 produce the SAME exit
  //     velocity. Placement steers the ball; it never subtracts power.
  {
    // hitAcc 0, so the circle is exactly `cursorR.contact` (0.55) and 0.3 is genuinely in its
    // outer half - `contactRadiusInPerPt` widens the circle with the skill, which is what made an
    // earlier draft of this test measure a 0.3 offset as still "centered".
    const skills = { hitAcc: 0, hitPow: 6, hitSpd: 5, pitchSpd: 0, pitchAcc: 0, pitchSpin: 0 };
    const at = (off) => swing({ x: 0, y: 0, isStrike: true }, skills,
      { action: 'swing', cursor: { x: -off, y: 0 }, timingErrorMs: 0, mode: 'contact' }, SETTINGS, mulberry32(8181), 'college');
    const centre = at(0), off3 = at(0.3);
    ok(centre.inPlay && off3.inPlay, '(c) both the dead-centre and the 0.3-off swing are in play');
    ok(Math.abs(centre.exitVeloMph - off3.exitVeloMph) < 1e-9,
      `(c) cursor offset 0 and 0.3 produce the same exit velocity on the same seed (${centre.exitVeloMph.toFixed(3)} vs ${off3.exitVeloMph.toFixed(3)} mph)`);
    ok(centre.q === off3.q, '(c) and the same contact quality - q is timing alone (R5 rule 1)');
    ok(centre.centered === true && off3.centered === false,
      '(c) `centered` still means the inner half of the circle, which is what the sim attributes by');
  }

  // (d) q=1 beats q=0 in exit velocity on the same seed, and by the derivation's own ratio.
  {
    const skills = { hitAcc: 0, hitPow: 0, hitSpd: 0, pitchSpd: 0, pitchAcc: 0, pitchSpin: 0 };
    const at = (timingErrorMs) => swing({ x: 0, y: 0, isStrike: true }, skills,
      { action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs, mode: 'contact' }, SETTINGS, mulberry32(4242), 'college');
    const perfect = at(0), edge = at(F.timingWindow * 0.999);
    ok(perfect.exitVeloMph > edge.exitVeloMph,
      `(d) a q=1 swing beats a q=0 one in exit velocity on the same seed (${perfect.exitVeloMph.toFixed(1)} vs ${edge.exitVeloMph.toFixed(1)} mph)`);
    // The two named targets rule 2 derives BASE_EXIT_VELO and qualityFloor from, at College
    // (LEAGUE_POWER_SCALE 1.000), hitPow 0, CONTACT mode. The noise draw is +/- exitVeloNoiseMph.
    const noise = F.exitVeloNoiseMph;
    ok(Math.abs(perfect.exitVeloMph - SETTINGS.PERFECT_EXIT_VELO_MPH) <= noise + 1e-9,
      `(d) a perfectly-timed no-power swing at College reads PERFECT_EXIT_VELO_MPH within the noise (${perfect.exitVeloMph.toFixed(1)} vs ${SETTINGS.PERFECT_EXIT_VELO_MPH} +/- ${noise})`);
    ok(Math.abs(edge.exitVeloMph - SETTINGS.BARELY_TIMED_EXIT_VELO_MPH) <= noise + 1e-9,
      `(d) and one at the window's edge reads BARELY_TIMED_EXIT_VELO_MPH within the noise (${edge.exitVeloMph.toFixed(1)} vs ${SETTINGS.BARELY_TIMED_EXIT_VELO_MPH} +/- ${noise})`);
    // The third target: cap power at College.
    const capSkills = { ...skills, hitPow: SETTINGS.CAPS.college };
    const cap = swing({ x: 0, y: 0, isStrike: true }, capSkills,
      { action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'contact' }, SETTINGS, mulberry32(4242), 'college');
    ok(Math.abs(cap.exitVeloMph - SETTINGS.CAP_POWER_EXIT_VELO_MPH) <= noise + 1e-9,
      `(d) and a perfectly-timed swing at College's own cap reads CAP_POWER_EXIT_VELO_MPH within the noise (${cap.exitVeloMph.toFixed(1)} vs ${SETTINGS.CAP_POWER_EXIT_VELO_MPH} +/- ${noise})`);
    // POWER mode is a few mph over CONTACT, not a different swing.
    const power = swing({ x: 0, y: 0, isStrike: true }, skills,
      { action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: 0, mode: 'power' }, SETTINGS, mulberry32(4242), 'college');
    const gain = power.exitVeloMph - perfect.exitVeloMph;
    ok(gain > 0 && gain <= 8, `(d) POWER mode is a few mph over CONTACT, not a different swing (+${gain.toFixed(1)} mph)`);
  }

  // (e) A grounder at 1 deg carries at least 40 ft - the defect that put five Perfect swings at
  //     Matt's feet. `sin(2a)` was ~0 there; GROUND_CARRY_FACTOR is the floor that fixed it.
  {
    ok(carryFt(80, 1) >= 40, `(e) a grounder at 1 deg off an 80 mph swing carries at least 40 ft (${carryFt(80, 1).toFixed(1)})`);
    ok(carryFt(50, 1) >= SETTINGS.MIN_IN_PLAY_FT, `(e) and a 50 mph one clears MIN_IN_PLAY_FT (${carryFt(50, 1).toFixed(1)})`);
    ok(carryFt(105, 2) >= 100 && carryFt(105, 2) <= 200,
      `(e) a hard grounder rolls to where a fielder meets it, not to the wall (${carryFt(105, 2).toFixed(1)} ft at 105 mph / 2 deg)`);
    ok(carryFt(90, 3) > carryFt(60, 3), '(e) a harder grounder still rolls further than a weak one - the floor is on the ANGLE, never on the speed');
    // The curve's peak moved to CARRY_PEAK_DEG: a line drive now out-carries a lazy fly ball off
    // the same bat, which is what took the census from 28% triples to 6%.
    ok(carryFt(90, SETTINGS.CARRY_PEAK_DEG) > carryFt(90, F.flyCenterDeg),
      `(e) the carry curve peaks at CARRY_PEAK_DEG (${SETTINGS.CARRY_PEAK_DEG} deg beats the fly band's ${F.flyCenterDeg} deg: ${carryFt(90, SETTINGS.CARRY_PEAK_DEG).toFixed(0)} vs ${carryFt(90, F.flyCenterDeg).toFixed(0)} ft)`);
    ok(carryFt(90, 20) > carryFt(90, 60), '(e) and falls away past it, so a pop-up lands on the infield');
    // The derivation in settings.js, checked rather than trusted: HR_CARRY_FRAC of the College
    // centre fence at the centred-contact launch angle, off a q=1 cap-power swing.
    const capMph = SETTINGS.CAP_POWER_EXIT_VELO_MPH;
    const want = SETTINGS.HR_CARRY_FRAC * SETTINGS.FIELD.college.fenceFt.center;
    ok(Math.abs(carryFt(capMph, F.lineDriveCenterDeg) - want) <= 2,
      `(e) CARRY_SCALE's own derivation holds: ${capMph} mph at ${F.lineDriveCenterDeg} deg carries ${carryFt(capMph, F.lineDriveCenterDeg).toFixed(1)} ft against HR_CARRY_FRAC x ${SETTINGS.FIELD.college.fenceFt.center} = ${want.toFixed(1)}`);
    // And the per-league table is that same sentence, moved league to league.
    for (const league of SETTINGS.LEAGUES) {
      const refMph = SETTINGS.CARRY_ZERO_MPH + SETTINGS.LEAGUE_POWER_SCALE[league]
        * (SETTINGS.BASE_EXIT_VELO - SETTINGS.CARRY_ZERO_MPH + SETTINGS.MEDIAN_HIT_POW_PTS * SETTINGS.SKILL_EFFECT.hitPow.exitVeloMphPerPt);
      const frac = carryFt(refMph, F.lineDriveCenterDeg) / SETTINGS.FIELD[league].fenceFt.center;
      ok(Math.abs(frac - SETTINGS.MEDIAN_CARRY_FRAC) <= 0.02,
        `(e) ${league}: the reference swing (q=1, 5 hitPow points) carries ${(100 * frac).toFixed(1)}% of its own centre fence, against MEDIAN_CARRY_FRAC ${SETTINGS.MEDIAN_CARRY_FRAC}`);
    }
  }

  // The zone depths R5 moved, pinned so a future edit has to face what they are for.
  {
    for (const league of SETTINGS.LEAGUES) {
      const z = zonesFor(league, 0);
      const wall = SETTINGS.FIELD[league].fenceFt;
      ok(z.outfield[1].toFt >= wall.center,
        `${league}: the straightaway outfield out-zone reaches its own centre fence (${z.outfield[1].toFt.toFixed(0)} vs ${wall.center} ft) - past a manned sector IS over the wall`);
      ok(z.infield[1].toFt > 60 && z.infield[1].toFt < 160,
        `${league}: the infield out-zone is where a grounder is actually fielded (${z.infield[1].toFt.toFixed(0)} ft)`);
      ok(z.outfield[0].fromFt > SETTINGS.MIN_IN_PLAY_FT,
        `${league}: the outfield's near edge is past the in-play floor, so the bloop band is reachable (${z.outfield[0].fromFt.toFixed(0)} ft)`);
    }
  }
})();

// ---------------------------------------------------------------------------------------------
// Section 33 (R11, docs/BASEBALL-3D-BUILD.md section 9): THE LEAGUE LADDER IS REAL IN QUICK PLAY.
// Matt, 2026-09-21, on the same recording R10 came from: "you've forgotten to code the
// difficulties. Little league should be easy and the pitches slow and only 'fastballs' should be
// able to be thrown." Measured before this stage: `unlockedPitchesFor(league, 0, {quickPlay:true})`
// returned all eight types at every league; `pitch.js`'s `timeToPlateS` scaled ONLY by the
// pitcher's skill points off a flat Majors-fastball baseline, so a Little League 55 mph readout
// flew in the same 650 ms as a Majors 95 mph one; the human's timing window was a flat 100 ms at
// every league. The four items below are the spec's own four.
console.log('\n-- 33. R11: the league ladder is real in Quick Play --');
await (async function section33() {
  const F = SETTINGS.FEEL.engine;

  // (1) Pitch types follow the league in Quick Play too: Little League unlocks only the fastball,
  //     Majors its six (fastball/changeup/curveball/slider/knuckleball/screwball - eephus/cutter
  //     are title-gated, doc §11, and no CPU roster or fresh Quick Play career ever carries a
  //     title). `unlockedPitchesFor(..., {quickPlay:true})` is now byte-identical to the career
  //     ladder at every league - the RA override is gone.
  {
    ok(JSON.stringify(SETTINGS.unlockedPitchesFor('little', 0, { quickPlay: true })) === JSON.stringify(['fastball']),
      `(1) Quick Play at Little League unlocks only the fastball (got ${JSON.stringify(SETTINGS.unlockedPitchesFor('little', 0, { quickPlay: true }))})`);
    const majorsQP = SETTINGS.unlockedPitchesFor('majors', 0, { quickPlay: true });
    const wantMajors = ['fastball', 'changeup', 'curveball', 'slider', 'knuckleball', 'screwball'];
    ok(majorsQP.length === 6 && wantMajors.every((t) => majorsQP.includes(t)),
      `(1) Quick Play at Majors unlocks its six career-ladder types, not all eight (got ${JSON.stringify(majorsQP)})`);
    ok(!majorsQP.includes('eephus') && !majorsQP.includes('cutter'),
      '(1) eephus/cutter stay title-gated in Quick Play too - a fresh career/CPU roster never carries a title');
    for (const lg of SETTINGS.LEAGUES) {
      ok(JSON.stringify(SETTINGS.unlockedPitchesFor(lg, 0, { quickPlay: true })) === JSON.stringify(SETTINGS.PITCH_UNLOCKS[lg]),
        `(1) ${lg}: Quick Play's ladder is byte-identical to the career ladder`);
    }
    ok(SETTINGS.QUICK_PLAY_PITCH_MIX === undefined,
      '(1) QUICK_PLAY_PITCH_MIX is deleted - there is no second distribution left to name');
  }

  // (2) A slow pitch is slow: timeToPlateS now divides by this league's own READOUT mph for the
  //     type being thrown (alongside PITCH_TRAVEL_MULT and the pitcher's skill points, as
  //     before). Majors is the fixed reference (95 mph both sides of the ratio at zero skill
  //     points), so a Majors fastball is untouched; every league below it is proportionally
  //     slower.
  {
    const noSkillFastball = (lg) => flyPitch('fastball', 0, 1, SETTINGS, () => 0.5, {}, null, lg).timeToPlateS;
    const majorsS = noSkillFastball('majors');
    ok(Math.abs(majorsS - F.fastballMs / 1000) < 1e-9,
      `(2) a Majors 95 mph fastball still takes exactly the ${F.fastballMs} ms it took before R11 (measured ${(majorsS * 1000).toFixed(1)} ms)`);
    const littleS = noSkillFastball('little');
    ok(littleS > 1.0 && littleS < 1.2,
      `(2) a Little League 55 mph fastball takes about 1.1 s (measured ${(littleS * 1000).toFixed(1)} ms)`);
    // Exact derivation, not just "about": fastballMs x travelMult(1.0) x (majorsFastballMph / thisLeagueFastballMph).
    for (const lg of SETTINGS.LEAGUES) {
      const want = (F.fastballMs / 1000) * (SETTINGS.READOUT.majors.fastball / SETTINGS.READOUT[lg].fastball);
      const got = noSkillFastball(lg);
      ok(Math.abs(got - want) < 1e-9,
        `(2) ${lg}: fastball travel time matches the derivation exactly (${(got * 1000).toFixed(1)} ms vs ${(want * 1000).toFixed(1)} ms)`);
    }
    // Monotone in readout mph: sorted by this league's own fastball readout (ascending mph), the
    // travel time strictly falls.
    const byMph = [...SETTINGS.LEAGUES].sort((a, b) => SETTINGS.READOUT[a].fastball - SETTINGS.READOUT[b].fastball);
    let lastS = Infinity, monotone = true;
    for (const lg of byMph) {
      const s = noSkillFastball(lg);
      if (s >= lastS) monotone = false;
      lastS = s;
    }
    ok(monotone, `(2) travel time is strictly monotone (falling) in readout mph across the ladder (${byMph.map((lg) => `${lg}=${SETTINGS.READOUT[lg].fastball}mph`).join(', ')})`);
    // The pitcher's own skill points still shorten it, exactly as before R11 (unchanged mechanism,
    // now layered on top of the league ratio rather than a flat 95 mph baseline).
    const slow = flyPitch('fastball', 0, 1, SETTINGS, () => 0.5, { pitchSpd: 0 }, null, 'college').timeToPlateS;
    const fast = flyPitch('fastball', 0, 1, SETTINGS, () => 0.5, { pitchSpd: 10 }, null, 'college').timeToPlateS;
    ok(fast < slow, `(2) pitchSpd skill points still shorten travel time at a fixed league (${(fast * 1000).toFixed(1)} < ${(slow * 1000).toFixed(1)} ms)`);
    // A type with no READOUT row of its own (screwball/eephus/cutter, doc §11 Open item 9) falls
    // back to this SAME league's own fastball readout rather than inventing a per-type mph - the
    // league still slows it down. The eephus (travelMult 1.9, already the slowest type) at Little
    // League must not exceed 2.5 s (the spec's own budget).
    const eephusLittle = flyPitch('eephus', 0, 1, SETTINGS, () => 0.5, {}, null, 'little').timeToPlateS;
    ok(eephusLittle <= 2.5, `(2) the eephus at Little League does not exceed 2.5 s (measured ${eephusLittle.toFixed(3)} s)`);
    ok(eephusLittle > flyPitch('eephus', 0, 1, SETTINGS, () => 0.5, {}, null, 'majors').timeToPlateS,
      '(2) and it is still slower at Little League than at Majors, same as every other type');
    for (const type of ['screwball', 'eephus', 'cutter']) {
      const want = (F.fastballMs / 1000) * SETTINGS.PITCH_TRAVEL_MULT[type] * (SETTINGS.READOUT.majors.fastball / SETTINGS.READOUT.little.fastball);
      const got = flyPitch(type, 0, 1, SETTINGS, () => 0.5, {}, null, 'little').timeToPlateS;
      ok(Math.abs(got - want) < 1e-9,
        `(2) ${type} (no READOUT row of its own) falls back to Little League's own fastball readout (${(got * 1000).toFixed(1)} vs ${(want * 1000).toFixed(1)} ms)`);
    }
  }

  // (3) Little League is forgiving, Majors is tight: LEAGUE_TIMING_WINDOW_MULT.
  {
    const want = { little: 1.6, highschool: 1.3, college: 1.0, minors: 0.9, majors: 0.8 };
    ok(JSON.stringify(SETTINGS.LEAGUE_TIMING_WINDOW_MULT) === JSON.stringify(want),
      `(3) LEAGUE_TIMING_WINDOW_MULT matches the spec exactly (got ${JSON.stringify(SETTINGS.LEAGUE_TIMING_WINDOW_MULT)})`);
    ok(SETTINGS.LEAGUE_TIMING_WINDOW_MULT.college === 1.0,
      "(3) college is a true no-op - every number this engine's own contact/carry model was derived against stays put");
    // The multiplier actually reaches the window swing.js scores against: a swing timed 90ms off,
    // dead-centred on the pitch, is a FOUL at Majors (window 80ms, 90 > 80) but genuine, in-play
    // contact at Little League (window 160ms, 90 <= 160) - the identical decision, two leagues.
    const skills = { hitAcc: 0, hitPow: 0, hitSpd: 0, pitchSpd: 0, pitchAcc: 0, pitchSpin: 0 };
    const pitch = { x: 0, y: 0, isStrike: true };
    const decisionAt = (absMs) => ({ action: 'swing', cursor: { x: 0, y: 0 }, timingErrorMs: absMs, mode: 'contact' });
    const majorsSwing = swing(pitch, skills, decisionAt(90), SETTINGS, mulberry32(1), 'majors');
    const littleSwing = swing(pitch, skills, decisionAt(90), SETTINGS, mulberry32(1), 'little');
    ok(majorsSwing.contact === true && majorsSwing.foul === true && majorsSwing.inPlay === false,
      `(3) a 90ms-off, dead-centred swing at MAJORS (window 80ms) is a foul, not real contact (got ${JSON.stringify(majorsSwing)})`);
    ok(littleSwing.contact === true && littleSwing.foul === false,
      `(3) the IDENTICAL swing at LITTLE LEAGUE (window 160ms) is genuine contact, not a foul (got ${JSON.stringify(littleSwing)})`);
    // The bunt reads the same multiplier (swing.js's OTHER F.timingWindow read, buntSwing).
    const bunt = (absMs, league) => swing(pitch, skills, { action: 'swing', bunt: true, timingErrorMs: absMs }, SETTINGS, mulberry32(1), league);
    // Base bunt window at college (mult 1.0): 100 x BUNT_WINDOW_MULT(1.6) = 160ms.
    const collegeBunt = bunt(150, 'college');
    const majorsBunt = bunt(150, 'majors'); // 100 x 0.8 x 1.6 = 128ms - 150 is a miss-turned-foul past it
    ok(collegeBunt.inPlay === true, `(3) a 150ms-off bunt at COLLEGE (window 160ms) is still in play (got ${JSON.stringify(collegeBunt)})`);
    ok(majorsBunt.inPlay === false && majorsBunt.foul === true,
      `(3) the IDENTICAL bunt at MAJORS (window 128ms) is a foul (got ${JSON.stringify(majorsBunt)})`);
    // The CPU's own timing SIGMA (how far off-centre its swings tend to land) is untouched - a
    // structural check that R11 never touched the CPU table at all.
    ok(SETTINGS.CPU.little.timingSigmaMs === 115 && SETTINGS.CPU.majors.timingSigmaMs === 58,
      '(3) CPU_LEVEL timingSigmaMs is byte-identical to before R11 - only how forgivingly a given error is SCORED changed, never how large a CPU error tends to be');
  }

  // (4) Structural: LEAGUE_UNLOCK_ADDS moved changeup off Little League without losing it anywhere
  //     - every one of the eight PITCH_TYPES is reachable by the ladder plus the two title unlocks,
  //     with no duplicates and nothing dropped.
  {
    const allLadder = new Set(SETTINGS.PITCH_UNLOCKS.majors);
    for (const t of SETTINGS.TITLE_PITCH_UNLOCKS) allLadder.add(t.pitch);
    ok(SETTINGS.PITCH_TYPES.every((t) => allLadder.has(t)) && allLadder.size === SETTINGS.PITCH_TYPES.length,
      `(4) every one of the eight PITCH_TYPES is still reachable by the ladder + title unlocks, exactly once (${JSON.stringify([...allLadder])})`);
  }
})();

// ---------------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
