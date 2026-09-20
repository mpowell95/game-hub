// test-baseball-ring.mjs - STAGE 8 (docs/BASEBALL-3D-BUILD.md section 8, row 1): does the RING
// agree with the ENGINE about what counts as Nice?
//
// Measured cause of the shipped bug (v859): `ring.js` swept a FULL 360deg lap for progress 0..1
// (`angFor(p) = START + p*TWO_PI`), so progress 1.0 (== `meterTime`, the instant `pitch.js` stops
// scoring Nice) landed back at the START angle, not at the geometric top where the Nice zone was
// drawn (`NICE_CENTER` was `(TOP-START)/TWO_PI = 0.667` of that full-lap sweep). A release the
// engine calls Nice (hold in `[meterTime*(1-niceWidth), meterTime]`, i.e. progress in
// `[1-niceWidth, 1]`) drew its release marker about 80deg PAST the lit zone - Matt: "even if it's
// perfect, it doesn't show perfect. It's always like right past the perfect zone thing."
//
// This asserts, for a sweep of hold times, that ring.js's own NICE_START/NICE_END bounds contain a
// hold's progress EXACTLY when the real `flyPitch` (baseball/js/engine/pitch.js) reports
// `wasNice` - no drawing, no canvas, just the two numbers agreeing. Run against the ORIGINAL
// (pre-stage-8) ring.js first (`git show HEAD~1:baseball/js/ring.js`, saved to a scratch copy) to
// prove this is a real, born-red probe - see the report for that run's own failing line.
//
// node test-baseball-ring.mjs

import { readFileSync } from 'node:fs';
import * as SETTINGS from './baseball/js/engine/settings.js';
import { flyPitch } from './baseball/js/engine/pitch.js';
import { angleFor, NICE_START, NICE_END, NICE_CENTER, NICE_HALF } from './baseball/js/ring.js';

let failed = 0;
const ok = (label) => console.log(`ok    ${label}`);
const fail = (label, why) => { failed++; console.log(`FAIL  ${label}: ${why}`); };

// ---------------------------------------------------------------------------------------------
// 1. The ring's own zone bounds agree with the number pitch.js scores Nice against - never a
// second, independently-tuned literal.
const niceWidth = SETTINGS.FEEL.engine.niceWidth;
if (Math.abs(NICE_START - (1 - niceWidth)) < 1e-9) {
  ok(`NICE_START (${NICE_START}) === 1 - SETTINGS.FEEL.engine.niceWidth (${niceWidth})`);
} else {
  fail('NICE_START', `${NICE_START} !== 1 - niceWidth (${1 - niceWidth})`);
}
if (NICE_END === 1) ok(`NICE_END (${NICE_END}) is the meter's own top (progress 1.0)`);
else fail('NICE_END', `expected 1, got ${NICE_END}`);
if (Math.abs(NICE_CENTER - (NICE_START + NICE_END) / 2) < 1e-9 && Math.abs(NICE_HALF - (NICE_END - NICE_START) / 2) < 1e-9) {
  ok('NICE_CENTER/NICE_HALF are derived from NICE_START/NICE_END, not a separate pair of numbers');
} else {
  fail('NICE_CENTER/NICE_HALF', `NICE_CENTER=${NICE_CENTER} NICE_HALF=${NICE_HALF} do not match NICE_START/NICE_END's own midpoint/half-width`);
}

// ---------------------------------------------------------------------------------------------
// 2. angleFor(1.0) lands exactly at 12 o'clock. TOP is ring.js's own internal constant
// (-Math.PI/2); this repo has no PNG decoder to read a rendered pixel back, so the geometric claim
// is checked as the pure angle it actually is.
const TOP = -Math.PI / 2;
const angAtTop = angleFor(1.0);
// angleFor(1.0) is TOP plus a whole number of full turns (the sweep is a fixed 240deg from START,
// and START is itself defined as TOP + 120deg - see ring.js's own header) - normalize both to
// [0, 2*PI) before comparing, since the raw radian values differ by the sweep's own construction.
const TWO_PI = Math.PI * 2;
const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
if (Math.abs(norm(angAtTop) - norm(TOP)) < 1e-9) {
  ok(`angleFor(1.0) = ${angAtTop.toFixed(4)} rad is the geometric top (TOP = ${TOP.toFixed(4)} rad, -90deg / 12 o'clock)`);
} else {
  fail('angleFor(1.0)', `${angAtTop.toFixed(4)} rad (mod 2*PI = ${norm(angAtTop).toFixed(4)}) is not TOP (${TOP.toFixed(4)} rad, mod 2*PI = ${norm(TOP).toFixed(4)})`);
}
// angleFor is monotonically increasing over the whole domain the ring ever passes it (0 through
// past the hang-grace window) - a regression here is exactly the kind of "arc sweeps the wrong
// way" bug the geometry fix is guarding against.
{
  let monotone = true;
  let prev = angleFor(0);
  for (let p = 0.01; p <= 1.6; p += 0.01) {
    const a = angleFor(p);
    if (a < prev) { monotone = false; break; }
    prev = a;
  }
  if (monotone) ok('angleFor is monotonically increasing from progress 0 through 1.6 (no backwards arcs)');
  else fail('angleFor monotonicity', 'angleFor is not monotonically increasing over its own domain');
}

// ---------------------------------------------------------------------------------------------
// 3. THE BORN-RED CHECK: for a sweep of hold times, the ring's own zone bounds agree with the
// real engine's wasNice - the same hold pitch.js's own section-26 hang test drives it with
// (baseball/js/test.js ~1780), passed through the same flyPitch/settings this repo ships.
const meterTime = SETTINGS.FEEL.engine.meterTime;
const rand = () => 0.5; // a fixed draw - only wasNice/wasHang are under test, not aimScatter
let mismatches = [];
for (let holdMs = 0; holdMs <= meterTime * 1.3; holdMs += 10) {
  const progress = holdMs / meterTime;
  const ringSaysNice = progress >= NICE_START && progress <= NICE_END;
  const engine = flyPitch('fastball', 0, 0.5, SETTINGS, rand, {}, { hold: holdMs });
  if (ringSaysNice !== engine.wasNice) {
    mismatches.push({ holdMs, progress: progress.toFixed(4), ringSaysNice, wasNice: engine.wasNice });
  }
}
if (mismatches.length === 0) {
  ok(`the ring's own Nice zone (progress in [${NICE_START.toFixed(4)}, ${NICE_END}]) agrees with flyPitch's wasNice for every 10ms hold from 0 to ${(meterTime * 1.3).toFixed(0)}ms`);
} else {
  const first = mismatches[0];
  fail('ring/engine agreement', `${mismatches.length} of the swept hold times disagree - first at holdMs=${first.holdMs} (progress=${first.progress}): ring says Nice=${first.ringSaysNice}, engine says wasNice=${first.wasNice}`);
}

// ---------------------------------------------------------------------------------------------
// 4. Structural: ui.js actually wires the tap-to-start/tap-to-release + geometry fixes in, and
// decideSwing no longer pushes the strip at the pitch DECISION (row 5).
const uiSrc = readFileSync('./baseball/js/ui.js', 'utf8');
const decidePitchMatch = uiSrc.match(/\n {2}async decidePitch\(view\) \{[\s\S]*?\n {2}\}\n/);
if (!decidePitchMatch) {
  fail('ui.js decidePitch', 'could not locate the decidePitch method body');
} else {
  const body = decidePitchMatch[0];
  if (/holdAtMark:\s*true/.test(body)) ok("decidePitch's first-tap branch plays the wind-up with holdAtMark: true");
  else fail('ui.js decidePitch', 'no holdAtMark: true found - the wind-up should hold at its release keyframe until the second tap');
  if (/actors\.release\('pitcher'\)/.test(body)) ok("decidePitch's finish() calls actors.release('pitcher')");
  else fail('ui.js decidePitch', "no actors.release('pitcher') found in finish()");
  if (/actors\.play\('pitcher',\s*'Pitch',\s*\{\s*markAtMs:\s*0\s*\}\)/.test(body)) {
    fail('ui.js decidePitch', "finish() still calls actors.play('pitcher','Pitch',{markAtMs:0}) - should be actors.release('pitcher') instead (STAGE 8 row 2)");
  } else {
    ok("decidePitch's finish() no longer seeks the release keyframe with markAtMs: 0 directly");
  }
}
const decideSwingMatch = uiSrc.match(/\n {2}async decideSwing\(view\) \{[\s\S]*?\n {2}\}\n/);
if (!decideSwingMatch) {
  fail('ui.js decideSwing', 'could not locate the decideSwing method body');
} else {
  if (/lastPitches\.push/.test(decideSwingMatch[0])) {
    fail('ui.js decideSwing', 'decideSwing still pushes lastPitches at the pitch DECISION (STAGE 8 row 5 - should stage pendingPitch instead, pushed at crossing)');
  } else {
    ok('decideSwing no longer pushes lastPitches (pushed at crossing instead, via _flushPendingPitch)');
  }
}
if (/ring\.js's own row-2 change|_paintRing\('idle',\s*0\)/.test(uiSrc) && /s\._onMainDown\s*=\s*\(\)\s*=>/.test(uiSrc)) {
  ok('ui.js paints the ring idle and binds _onMainDown for the tap-to-start turn');
} else {
  fail('ui.js tap-to-start', 'could not find the idle paint + _onMainDown binding for decidePitch');
}

// ---------------------------------------------------------------------------------------------
// 5. Structural: strings.js carries the new word.
const stringsSrc = readFileSync('./baseball/js/strings.js', 'utf8');
const enBlock = stringsSrc.split('es:')[0];
if (/v_hung:\s*'Late'/.test(enBlock)) ok("strings.js EN v_hung is 'Late'");
else fail('strings.js', "EN v_hung is not 'Late'");

console.log('');
console.log(failed === 0 ? 'All checks passed.' : `${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
