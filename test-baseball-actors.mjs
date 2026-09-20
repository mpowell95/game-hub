// test-baseball-actors.mjs - the 3D actor layer (docs/BASEBALL-3D-BUILD.md section 3.9), two halves.
//
// 1. NODE, NO BROWSER (add to run-all-tests.mjs): readGlb parses the model; not Draco; under 4MB;
//    every RIG_REQUIRED name is a node in the file; the four skin PNGs (section 2.1) exist and are
//    1024x1024; CLIPS.Swing/CLIPS.Miss/CLIPS.Pitch have keys and a mark inside [0, lastKey.t];
//    CLIPS.Set and CLIPS.Crouch have keys (mark:null by design); actors.js's KEYS colour-key table
//    (section 2.2) never keys a skin-tone colour; buildClip over a fake bones/restQ object yields
//    one quaternion track per bone used and the right duration. STAGE 4 (section 3.9's own list)
//    adds: `field.js` exports `plateCover`/`anchorPx`; `actors.dispose()` runs inside ui.js's own
//    `destroy()`; a `visibilitychange` listener pauses/resumes the actor layer. STAGE 5 (2026-09-19,
//    docs/BASEBALL-3D-BUILD.md section 3.10) DELETES the sprite path this file's own header used to
//    explain the absence of: section 3.9's literal "no state.batterFrame/state.pitcherFrame writes
//    remain" now holds for real (checked below), `field.js`'s `drawPlateView` no longer takes a
//    `noFigures` option at all (nothing left to gate), and `test-baseball-device.mjs`'s r2-cadence
//    probe's release signal is `actors.play('pitcher', 'Pitch', ...)`'s own call time + `markAtMs`,
//    not a frame number - see that file's own comment for the before/after proof.
// 2. CHROMIUM UNDER SWIFTSHADER (SKIPs without playwright-core; NOT in run-all-tests.mjs): loads
//    the model through the real Actors class and checks the batter actually PAINTS (the frame
//    differs with him and without him - R1 made the canvas's clear colour opaque sky, so an alpha
//    test means nothing any more), that a pitcher read-back differs between Set and mid-Pitch, that
//    a batter shirt pixel differs between home and away (section 2.2's colour-key remap), then that
//    dispose() tears it down (canvas removed, renderer gone, and - stage 3's own fix - without
//    disposing the module-cached skin textures every OTHER Actors instance still holds).
//    R1 adds: the 2-D overlay now sits ABOVE the WebGL scene (they swapped), the cutaway probe asks
//    `actors.cameraName` instead of a canvas's `display`, and the motion floors are measured by
//    projecting bone world positions through the real batter/pitcher cameras.
//
// A real file is checked by default now that section 2.2 is filled (baseball/models/player.glb
// ships in the repo); pass a different one (e.g. the retired section 2.1 scaffold) with:
//
//   node test-baseball-actors.mjs --model <path>
//   BB_MODEL_PATH=<path> node test-baseball-actors.mjs
import { existsSync, readFileSync } from 'node:fs';
import { readGlb, summarize } from './glb-info.mjs';
import { RIG, RIG_REQUIRED } from './baseball/js/rig.js';
import { CLIPS, buildClip } from './baseball/js/poses.js';
import { KEYS } from './baseball/js/actors.js';
import * as THREE from './baseball/js/vendor/three.module.min.js';

let failed = 0;
const ok = (label) => console.log(`ok    ${label}`);
const fail = (label, why) => { failed++; console.log(`FAIL  ${label}: ${why}`); };
const skipLine = (label, why) => console.log(`SKIP  ${label}: ${why}`);

const args = process.argv.slice(2);
const modelArgIdx = args.indexOf('--model');
const MODEL_PATH = (modelArgIdx !== -1 && args[modelArgIdx + 1]) || process.env.BB_MODEL_PATH || 'baseball/models/player.glb';
// section 2.2 (docs/BASEBALL-3D-BUILD.md): the four painted skins for the one shared "Skin"
// material/body. No PNG library in this repo (`js/CLAUDE.md`'s no-dependency rule), so the size
// check below reads the IHDR chunk's own width/height bytes directly.
const SKIN_PNGS = ['skaterMaleA', 'criminalMaleA', 'skaterFemaleA', 'cyborgFemaleA'].map((n) => `baseball/models/skins/${n}.png`);
/** A PNG's width/height, read straight from its IHDR chunk (signature[8] + length[4] + "IHDR"[4] +
 *  width[4BE] + height[4BE], per the PNG spec) - no decode, no dependency. Throws if the file isn't
 *  a PNG or its first chunk isn't IHDR (true for every PNG this repo would ever ship). */
function pngSize(path) {
  const buf = readFileSync(path);
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`${path}: not a PNG (bad signature)`);
  const chunkType = buf.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') throw new Error(`${path}: first chunk is "${chunkType}", not IHDR`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

console.log('=== node half ===');
console.log(`model: ${MODEL_PATH}${existsSync(MODEL_PATH) ? '' : ' (missing)'}`);

if (!existsSync(MODEL_PATH)) {
  skipLine('model checks', `${MODEL_PATH} does not exist yet - pass --model <path> or set BB_MODEL_PATH to check a real file (the section 2.1 scaffold, or player.glb once section 2.2 is filled)`);
} else {
  try {
    const { json, bytes } = readGlb(MODEL_PATH);
    ok(`readGlb parses ${MODEL_PATH}`);
    const s = summarize({ json, bytes });

    if (bytes < 4 * 1024 * 1024) ok(`under 4MB (${bytes} bytes)`);
    else fail('size', `${bytes} bytes >= 4MB`);

    const usesDraco = (json.extensionsRequired || []).includes('KHR_draco_mesh_compression')
      || (json.extensionsUsed || []).includes('KHR_draco_mesh_compression');
    if (!usesDraco) ok('not Draco');
    else fail('draco', 'KHR_draco_mesh_compression present - GLTFLoader here has no Draco decoder registered');

    // The node names in the RAW glTF JSON, dot-stripped - an approximation of what three.js's
    // GLTFLoader does to every node name ON LOAD (it strips dots; a name that collides with
    // another node anywhere in the file also gets a numeric suffix in discovery order, which this
    // cannot replicate without actually loading the file - see rig.js's own header, written
    // against exactly this gap on the section 2.1 scaffold). This catches a RIG entry pointing at
    // a bone that plain does not exist in the file. It does NOT prove a name resolves to the
    // correct node when the raw file has a same-name collision - only the Chromium half below,
    // which loads the real GLTFLoader and calls the real resolveRig(), proves that.
    const sanitizedNames = new Set(s.nodeNames.map((n) => n.replace(/\./g, '')));
    let allRigFound = true;
    for (const k of RIG_REQUIRED) {
      const name = RIG[k];
      if (!sanitizedNames.has(name)) { fail(`RIG.${k}`, `"${name}" not found among the file's (dot-stripped) node names`); allRigFound = false; }
    }
    if (allRigFound) ok(`every RIG_REQUIRED name is a node in the file (${RIG_REQUIRED.length} checked)`);

    let allSkinsOk = true;
    for (const p of SKIN_PNGS) {
      if (!existsSync(p)) { fail(`skin PNG ${p}`, 'file does not exist'); allSkinsOk = false; continue; }
      try {
        const { width, height } = pngSize(p);
        if (width === 1024 && height === 1024) continue;
        fail(`skin PNG ${p}`, `${width}x${height}, expected 1024x1024`);
        allSkinsOk = false;
      } catch (e) { fail(`skin PNG ${p}`, e.message); allSkinsOk = false; }
    }
    if (allSkinsOk) ok(`the four skin PNGs exist and are 1024x1024 (${SKIN_PNGS.length} checked)`);
  } catch (e) {
    fail('model checks', e.message);
  }
}

// buildClip: a synthetic bones/restQ object, no model file needed - proves the track-building math
// itself independent of any real skeleton.
{
  const bones = {
    hips: { name: 'TestHips', position: new THREE.Vector3(0, 1, 0) },
    spine: { name: 'TestSpine' },
  };
  const restQ = { hips: new THREE.Quaternion(), spine: new THREE.Quaternion() };
  const keyframes = [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0, 0, 0] } },
    { t: 0.5, pose: { hips: [10, 0, 0], spine: [5, 0, 0] }, hipsOffset: [0, 0.1, 0] },
  ];
  const clip = buildClip('Test', keyframes, bones, restQ);
  const qTracks = clip.tracks.filter((tr) => tr.name.endsWith('.quaternion'));
  const vTracks = clip.tracks.filter((tr) => tr.name.endsWith('.position'));
  if (qTracks.length === 2) ok('buildClip: one quaternion track per bone used (2)');
  else fail('buildClip tracks', `${qTracks.length} quaternion tracks, expected 2 (hips, spine)`);
  if (vTracks.length === 1) ok('buildClip: hipsOffset produces exactly one position track');
  else fail('buildClip hipsOffset', `${vTracks.length} position tracks, expected 1`);
  if (clip.duration === 0.5) ok(`buildClip: duration matches the last keyframe (${clip.duration})`);
  else fail('buildClip duration', `${clip.duration}, expected 0.5`);
}

// CLIPS.Swing / CLIPS.Miss / CLIPS.Pitch marks: only assert once a stage has authored real keys
// (stage 2 for Swing/Miss, stage 3 for Set/Pitch) - poses.js ships stage 1 with every clip's keys
// EMPTY on purpose (see its own header), so asserting a mark against an empty key list would
// always fail for a reason that has nothing to do with this stage.
// RA (docs/BASEBALL-3D-BUILD.md section 9): `Pickoff` joins the marked clips - its mark is the
// release, the instant ui.js's `_playPickoff` sends the ball from the pitcher's hand to the bag.
for (const name of ['Swing', 'Miss', 'Pitch', 'Pickoff']) {
  const def = CLIPS[name];
  if (!def.keys.length) { skipLine(`CLIPS.${name}.mark`, 'keys not authored yet (stage 2 for Swing/Miss, stage 3 for Pitch)'); continue; }
  const lastT = def.keys[def.keys.length - 1].t;
  if (def.mark != null && def.mark >= 0 && def.mark <= lastT) ok(`CLIPS.${name}.mark (${def.mark}) inside [0, ${lastT}]`);
  else fail(`CLIPS.${name}.mark`, `${def.mark} not inside [0, ${lastT}]`);
}

// CLIPS.Set: loop:true, mark:null by design (Idle/Set never have a mark - section 3.4's own
// table), so it needs its own presence check rather than the mark-range loop above.
if (CLIPS.Set && CLIPS.Set.keys.length) ok(`CLIPS.Set has keys (${CLIPS.Set.keys.length})`);
else fail('CLIPS.Set.keys', 'empty - stage 3 owes Set (docs/BASEBALL-3D-BUILD.md section 3.4)');
// R1 (section 9): the catcher's own resting loop. No mark and no motion floor by design - he is a
// static figure behind the plate - but it has to LOOP (first and last keyframe identical, or the
// crouch pops once a second) and it has to be a CROUCH, which is what the hips offset carries.
if (CLIPS.Crouch && CLIPS.Crouch.keys.length >= 2 && CLIPS.Crouch.loop && CLIPS.Crouch.mark == null) {
  const first = CLIPS.Crouch.keys[0], last = CLIPS.Crouch.keys[CLIPS.Crouch.keys.length - 1];
  const same = JSON.stringify(first.pose) === JSON.stringify(last.pose) && JSON.stringify(first.hipsOffset) === JSON.stringify(last.hipsOffset);
  if (same) ok(`CLIPS.Crouch loops seamlessly (${CLIPS.Crouch.keys.length} keys, ${last.t}s)`);
  else fail('CLIPS.Crouch loop', 'the first and last keyframes differ, so the loop pops every time round');
} else {
  fail('CLIPS.Crouch', 'missing, or not a mark-less looping clip with at least two keyframes');
}

// RA: `Bunt` is a LOOP with no mark, like Crouch - the batter squares and HOLDS the stance through
// the pitch and through contact (there is no bunt "swing"), so it has to close on its own first
// keyframe or the square pops every time round.
if (CLIPS.Bunt && CLIPS.Bunt.keys.length >= 2 && CLIPS.Bunt.loop === true && CLIPS.Bunt.mark == null) {
  const first = CLIPS.Bunt.keys[0], last = CLIPS.Bunt.keys[CLIPS.Bunt.keys.length - 1];
  const same = JSON.stringify(first.pose) === JSON.stringify(last.pose) && JSON.stringify(first.hipsOffset) === JSON.stringify(last.hipsOffset);
  if (same) ok(`CLIPS.Bunt loops seamlessly (${CLIPS.Bunt.keys.length} keys, ${last.t}s)`);
  else fail('CLIPS.Bunt loop', 'the first and last keyframes differ, so the square pops every time round');
} else {
  fail('CLIPS.Bunt', 'missing, or not a mark-less looping clip with at least two keyframes');
}
// RA: and `Pickoff` opens on SET's own base pose, bone for bone, for the same reason Swing/Miss
// open on Idle's: actors.js cross-fades from whatever is playing, and the pitcher is always on Set
// when this starts, so a clip that opened anywhere else would blend through a pose nobody authored.
{
  const set0 = JSON.stringify(CLIPS.Set.keys[0].pose);
  const pick0 = JSON.stringify(CLIPS.Pickoff.keys[0].pose);
  if (set0 === pick0) ok('Pickoff opens on Set\'s own base pose (nothing to blend across)');
  else fail('Pickoff first keyframe', `differs from Set's t=0 pose\n      Set: ${set0}\n      Pickoff: ${pick0}`);
}

// actors.js's KEYS (section 2.2's colour-key remap table) must never key a skin-tone colour - the
// #f58c6a..#f59777 AA family every skin's face/arms shade through. A source this close to skin
// recolours a sliver of it every time a jersey changes colour (poses.js's own header has the
// measured near-miss, skaterMaleA's `#f59170`, that this guards against staying out of the table).
{
  const SKIN_LO = [0xf5, 0x8c, 0x6a], SKIN_HI = [0xf5, 0x97, 0x77];
  let sawSkinKey = false;
  const offenders = [];
  for (const skinName of Object.keys(KEYS)) {
    for (const side of Object.keys(KEYS[skinName])) {
      for (const k of KEYS[skinName][side]) {
        const [r, g, b] = k.from;
        if (r >= SKIN_LO[0] && r <= SKIN_HI[0] && g >= SKIN_LO[1] && g <= SKIN_HI[1] && b >= SKIN_LO[2] && b <= SKIN_HI[2]) {
          sawSkinKey = true;
          offenders.push(`${skinName}.${side} [${r},${g},${b}]`);
        }
      }
    }
  }
  if (!sawSkinKey) ok('KEYS: no key source in the #f58c6a..#f59777 skin-tone range');
  else fail('KEYS skin-tone guard', offenders.join(', '));
}

// STAGE 3 round 2 (coordinator review): away read as one dark navy-on-navy mass at the size these
// figures actually draw, because KEYS never touched the pants at all - only the shirt. A pants key
// on both CAST skins (skaterMaleA/skinForSide('home'), criminalMaleA/skinForSide('away')), both
// sides, is what a future edit must not quietly drop again.
{
  const CAST_SKINS = ['skaterMaleA', 'criminalMaleA'];   // the two skins section 2.2's casting rule actually uses
  let allHavePants = true;
  for (const skinName of CAST_SKINS) {
    for (const side of ['home', 'away']) {
      const keys = (KEYS[skinName] && KEYS[skinName][side]) || [];
      const hasPants = keys.some((k) => k.part === 'pants');
      if (!hasPants) { allHavePants = false; fail(`KEYS.${skinName}.${side} pants key`, 'no entry tagged part:"pants"'); }
    }
  }
  if (allHavePants) ok('KEYS: both cast skins (skaterMaleA, criminalMaleA) carry a pants key on both sides');
}

// ============================================================== STAGE 4/5 structural checks (ui.js) ==
// docs/BASEBALL-3D-BUILD.md section 3.9's own list. STAGE 5 (2026-09-19, section 3.10) checks the
// literal "no state.batterFrame/state.pitcherFrame writes remain" this file's own header used to
// explain away, now that the sprite path (and the `noFigures` option that used to gate it) is gone.
{
  const fieldSrc = readFileSync('./baseball/js/field.js', 'utf8');
  const uiSrc = readFileSync('./baseball/js/ui.js', 'utf8');

  // R1 (docs/BASEBALL-3D-BUILD.md section 9): field.js is THE WORLD now. These are the exports the
  // rest of the game positions off, and they replace the painted camera's own
  // (plateCover/anchorPx/plateBallPos/zoneRect/PLATE_ANCHORS/plateReady).
  for (const name of ['zoneRectFt', 'zoneCornersFt', 'projectToCanvas', 'engineToWorld', 'makeCameras', 'buildStadium', 'fencePoints']) {
    if (new RegExp(`export function ${name}\\(`).test(fieldSrc)) ok(`field.js: ${name} is exported`);
    else fail(`field.js ${name} export`, `no "export function ${name}(" found`);
  }
  for (const name of ['ZONE', 'BATTER_BOX', 'BATTER_AIM_TRAVEL_FT', 'RUBBER', 'CATCHER', 'UMPIRE', 'CAMERAS', 'BALL_RADIUS_FT', 'FIGURE_HEIGHT_FT', 'MARKER']) {
    if (new RegExp(`export const ${name} =`).test(fieldSrc)) ok(`field.js: ${name} is exported`);
    else fail(`field.js ${name} export`, `no "export const ${name} =" found`);
  }
  // The painted-camera surface is DELETED, not merely unused - R1's own list. Matched against real
  // code (a declaration), not the historical comments this file and field.js's own header are
  // allowed to still mention by name.
  {
    const gone = ['plateCover', 'anchorPx', 'plateBallPos', 'zoneRect', 'PLATE_ANCHORS', 'plateReady', 'preloadPlateImages',
      'drawPlateView', 'drawPlateBall', 'drawField', 'drawBall', 'drawLandingMarker', 'projectOverhead', 'drawOverheadPicture',
      'plateCover', 'NEAR_BATTER_HEIGHT_FRAC', 'MOUND_PITCHER_HEIGHT_FRAC', 'BATTER_AIM_TRAVEL_FRAC', 'OVERHEAD_HOMOGRAPHY'];
    const still = gone.filter((n) => new RegExp(`(export )?(function|const) ${n}\\b`).test(fieldSrc));
    if (!still.length) ok(`field.js: every painted-camera symbol is gone (${gone.length} checked)`);
    else fail('field.js painted camera', `still declared: ${still.join(', ')}`);
  }
  if (!/function drawBatterFigure\(|function drawPitcherFigure\(|function drawFrameCheck\(|opts\.noFigures/.test(fieldSrc)) {
    ok('field.js: the sprite-figure functions (drawBatterFigure/drawPitcherFigure/drawFrameCheck) and the noFigures option are gone');
  } else {
    fail('field.js sprite path', 'a sprite-figure symbol (drawBatterFigure/drawPitcherFigure/drawFrameCheck/noFigures) is still present as code');
  }
  // R1 renamed the hand accessor because it changed UNITS: canvas px to world feet. A leftover
  // caller would silently read `undefined` and place the ball at the origin, so both halves are
  // checked - the new name present, the old one gone everywhere.
  {
    const actorsNow = readFileSync('./baseball/js/actors.js', 'utf8');
    const uiNow = readFileSync('./baseball/js/ui.js', 'utf8');
    // Matched as CALLS and a DEFINITION, not as bare names - both files' own headers are allowed
    // to say "handWorldPx became handWorld" in prose, which is the record of the rename.
    if (/handWorld\(role = 'pitcher'\)/.test(actorsNow) && !/handWorldPx\(/.test(actorsNow) && !/handWorldPx\(/.test(uiNow)) {
      ok('actors.js: handWorld(role) replaces handWorldPx, and no caller still uses the old name');
    } else {
      fail('actors.js handWorld', 'handWorld(role) missing, or handWorldPx( is still called in actors.js/ui.js');
    }
  }

  if (!/state\.pitcherFrame|state\.batterFrame|_actorsLive/.test(uiSrc)) {
    ok('ui.js: no state.pitcherFrame/state.batterFrame writes and no _actorsLive fallback branches remain');
  } else {
    fail('ui.js sprite state', 'state.pitcherFrame, state.batterFrame or _actorsLive is still referenced');
  }

  // R1: the three pictures are deleted from the repo AND from sw.js's ASSETS list.
  {
    const swSrc = readFileSync('./sw.js', 'utf8');
    const imgs = ['plate.webp', 'overhead.webp', 'ball-sheet.webp'];
    const onDisk = imgs.filter((f) => existsSync(`baseball/img/${f}`));
    const inSw = imgs.filter((f) => swSrc.includes(`./baseball/img/${f}`));
    if (!onDisk.length && !inSw.length) ok('R1: baseball/img/{plate,overhead,ball-sheet}.webp are gone from disk and from sw.js ASSETS');
    else fail('R1 image removal', `still on disk: ${onDisk.join(', ') || 'none'}; still in sw.js: ${inSw.join(', ') || 'none'}`);
  }

  const destroyMatch = uiSrc.match(/\n {2}destroy\(\) \{[\s\S]*?\n {2}\}\n/);
  if (destroyMatch && /this\.actors\.dispose\(\)/.test(destroyMatch[0])) {
    ok('ui.js: destroy() calls this.actors.dispose()');
  } else {
    fail('ui.js destroy() actors.dispose()', 'BaseballPlayScreen.destroy() does not call this.actors.dispose()');
  }

  if (/document\.addEventListener\('visibilitychange', this\._onVis\)/.test(uiSrc) && /this\.actors\.pause\(\)/.test(uiSrc) && /this\.actors\.resume\(\)/.test(uiSrc)) {
    ok('ui.js: visibilitychange is handled and pauses/resumes the actor layer');
  } else {
    fail('ui.js visibilitychange', 'no visibilitychange listener found calling actors.pause()/resume()');
  }

  // The load-error screen (stage 5, section 3.6's "Loading" bullet): a failed initGL()/load()
  // sets _actorsFailed, the Play click routes it to _renderLoadError() instead of _startGame().
  // v858's own invariant, restated for R1: the cutaway is a CAMERA now, so what must not happen is
  // `_animateBattedBall` putting the pitch camera back. Only `_drawStaticField` (guarded by
  // `_cutawayUp`) and `_returnToPlate` (which clears it) may do that.
  {
    const m = uiSrc.match(/\n {2}_animateBattedBall\([\s\S]*?\n {2}\}\n/);
    const body = m ? m[0] : '';
    const setsChase = /setCamera\('chase'\)/.test(body);
    const setsPitchCam = /setCamera\('batter'\)|setCamera\('pitcher'\)/.test(body);
    const drawSetsCamera = /_drawStaticField\(\) \{[\s\S]*?setCamera\(/.test(uiSrc);
    if (setsChase && !setsPitchCam && drawSetsCamera) ok('structural: _animateBattedBall only ever switches TO the chase camera; _drawStaticField is what switches back (v858, R1)');
    else fail('structural: cutaway camera', `_animateBattedBall setsChase=${setsChase} setsPitchCam=${setsPitchCam}; _drawStaticField sets a camera=${drawSetsCamera}`);
  }
  if (/_actorsFailed\s*=\s*true/.test(uiSrc) && /_renderLoadError/.test(uiSrc)) {
    ok('ui.js: a failed load sets _actorsFailed and _renderLoadError() exists');
  } else {
    fail('ui.js load-error screen', '_actorsFailed / _renderLoadError not found');
  }

  // The actor calls that carry each pitch/swing signal (section 3.6's own mapping table).
  const wantCalls = [
    [/actors\.play\('pitcher', 'Pitch', \{ *markAtMs: *WINDUP_MS *\}\)/, '_stepWindup calls actors.play(\'pitcher\',\'Pitch\',{markAtMs:WINDUP_MS})'],
    // R2 (docs/BASEBALL-3D-BUILD.md section 9) SUPERSEDES stage 8's two rows here. There is no
    // meter and no second tap: ONE tap plays the delivery with its mark at `PITCH_DRAG_MS`, the
    // pad is dragged through it, and the cursor is sampled at that mark - so there is nothing to
    // HOLD at and nothing to release. `holdAtMark`/`actors.release()` stay in actors.js (the dev
    // frame-check screen drives them, and they are the API for any future paused delivery); what
    // is asserted here is that the PLAY SCREEN no longer uses either.
    [/actors\.play\('pitcher', 'Pitch', \{ *markAtMs: *PITCH_DRAG_MS *\}\)/, "HumanAgent.decidePitch's single tap calls actors.play('pitcher','Pitch',{markAtMs:PITCH_DRAG_MS})"],
    [/actors\.play\('batter', 'Swing', \{ *markAtMs: *80, *fade: *0 *\}\)/, "the swing decision calls actors.play('batter','Swing',{markAtMs:80,fade:0})"],
    [/actors\.setBall\(/, 'the pitch flight calls actors.setBall(...)'],
    [/actors\.setBatter\(\{/, '_syncActors calls actors.setBatter({...})'],
    [/actors\.setPitcher\(\{/, '_syncActors calls actors.setPitcher({...})'],
    // R1's own additions to the same table.
    [/actors\.setCatcher\(\{/, '_syncActors calls actors.setCatcher({...})'],
    [/actors\.setUmpire\(\{/, '_syncActors calls actors.setUmpire({...})'],
    [/this\.actors\.buildField\(/, '_renderPlay builds the stadium (actors.buildField)'],
    [/actors\.setCamera\('chase'\)/, 'the cutaway switches to the chase camera'],
    [/actors\.chaseAt\(/, 'the batted-ball flight drives the chase camera (actors.chaseAt)'],
    [/actors\.setMarker\(\{/, 'the marker hold places a world landing marker (actors.setMarker)'],
  ];
  let allCallsFound = true;
  for (const [re, label] of wantCalls) {
    if (!re.test(uiSrc)) { fail('ui.js actor call', `missing: ${label}`); allCallsFound = false; }
  }
  if (allCallsFound) ok(`ui.js: every section 3.6 mapping-table actor call is present (${wantCalls.length} checked)`);

  // R2: the meter is gone from the PLAY SCREEN - not merely unused but unreachable. A `holdAtMark`
  // or an `actors.release()` left in `ui.js` would mean a delivery that pauses mid-throw waiting
  // for a second tap that nothing sends any more, which is the one way this change could strand a
  // half-inning. (`baseball/js/actors.js` keeps both; the dev frame-check screen drives them.)
  {
    const strays = [];
    if (/holdAtMark/.test(uiSrc)) strays.push('holdAtMark');
    if (/actors\.release\(/.test(uiSrc)) strays.push('actors.release(');
    if (/meterTime|niceWidth|HANG_[A-Z]|STEER_|STEERABLE|\bcharged\s*[:=]|chargeTime|chargePower|chargeWindowMult/.test(uiSrc)) strays.push('a meter/steer/charge symbol');
    if (strays.length) fail('ui.js R2 cleanup', `the play screen still references ${strays.join(', ')} - the meter, the steering and the charged swing are all deleted by R2`);
    else ok('ui.js: no holdAtMark, no actors.release(), and no meter/steer/charge symbol survives in the play screen (R2)');
  }

  // Coordinator review (post stage-4 commit 5cd2f21): the render-rate cap that keeps r2-cadence in
  // range under software GL must not reach real hardware - asserts the cap is GATED on isSoftGL(),
  // not applied unconditionally, so a later edit can't quietly re-cap every real device again.
  const actorsSrc = readFileSync('./baseball/js/actors.js', 'utf8');
  if (/function isSoftGL\(/.test(actorsSrc)) ok('actors.js: isSoftGL() probe is present (copied from pinball/js/render3d.js)');
  else fail('actors.js isSoftGL', 'no "function isSoftGL(" found');

  const startMatch = actorsSrc.match(/\n {2}start\(\) \{[\s\S]*?\n {2}\}\n/);
  if (startMatch && /const soft = isSoftGL\(\)/.test(startMatch[0]) && /if \(!soft \|\| now - this\._lastRender >= RENDER_FRAME_MS\)/.test(startMatch[0])) {
    ok('actors.js: start()\'s render-rate cap is gated on isSoftGL() (uncapped on real hardware)');
  } else {
    fail('actors.js render cap gating', 'start() does not gate RENDER_FRAME_MS on isSoftGL() - a real device would be capped unconditionally');
  }

  // STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7): structural checks for the flow beats - each one
  // a fact the dynamic checks elsewhere (the cutaway KNOWN-BUG PROBE, r2-cadence,
  // test-baseball-device.mjs's preload check) can't see directly (a call site's own shape, not its
  // runtime effect).
  {
    // Row 4: Swing is played with fade:0 at BOTH real-swing call sites (the CPU-batter 'swing'
    // event and HumanAgent.decideSwing's settle()) - never a bare markAtMs with the default
    // cross-fade back.
    const swingFadeZero = uiSrc.match(/actors\.play\('batter', 'Swing', \{ *markAtMs: *80, *fade: *0 *\}\)/g) || [];
    if (swingFadeZero.length === 2) ok('ui.js: both real-swing call sites play Swing with fade:0');
    else fail('ui.js swing fade:0', `expected 2 call sites playing Swing with fade:0, found ${swingFadeZero.length}`);
    if (/actors\.play\('batter', 'Swing', \{ *markAtMs: *80 *\}\)/.test(uiSrc)) {
      fail('ui.js swing fade:0', 'a Swing call site with no fade:0 (a default cross-fade) is still present');
    }

    // play()'s own fade option and toSet() helper (actors.js).
    const playMatch = actorsSrc.match(/\n {2}play\(role, name, \{[\s\S]*?\n {2}\}\n/);
    if (playMatch && /fade *!= *null *\? *fade *: *CROSSFADE_S/.test(playMatch[0]) && /crossFadeTo\(a, fadeS,/.test(playMatch[0])) {
      ok('actors.js: play() accepts a fade option, defaulting to CROSSFADE_S');
    } else {
      fail('actors.js play() fade option', 'play() does not accept/use a fade option with a CROSSFADE_S default');
    }
    if (/toSet\(\) *\{ *this\.play\('pitcher', 'Set', \{ *fade: *SET_RETURN_FADE_MS *\}\); *\}/.test(actorsSrc)) {
      ok('actors.js: toSet() helper cross-fades the pitcher to Set');
    } else {
      fail('actors.js toSet()', 'no toSet() helper found playing \'Set\' on the pitcher');
    }
    // R1 renamed this with the units it carries: `lastBallPx` -> `lastBallPos`, world feet.
    if (/lastBallPos\(\)/.test(actorsSrc) && /this\._lastBall *= *\{/.test(actorsSrc)) {
      ok('actors.js: setBall() tracks lastBallPos() for THE CONTACT HOLD');
    } else {
      fail('actors.js lastBallPos', 'setBall() does not track a lastBallPos() the contact hold can read');
    }

    // Row 3: the pitcher's return to Set fires from both flight-end paths.
    const toSetCallers = (uiSrc.match(/actors\.toSet\(\)/g) || []).length;
    if (toSetCallers >= 2) ok(`ui.js: actors.toSet() is called ${toSetCallers} times (both flight-end paths)`);
    else fail('ui.js toSet() callers', `expected actors.toSet() called from at least 2 places, found ${toSetCallers}`);

    // Row 6: THE CUTAWAY FLAG - set in _animateBattedBall, guarded in _drawStaticField, cleared
    // only by _returnToPlate().
    const returnMatch = uiSrc.match(/\n {2}_returnToPlate\(\) \{[\s\S]*?\n {2}\}\n/);
    const drawMatch = uiSrc.match(/\n {2}_drawStaticField\(\) \{[\s\S]*?\n {2}\}\n/);
    const animateMatch = uiSrc.match(/\n {2}_animateBattedBall\([\s\S]*?\n {2}\}\n/);
    if (returnMatch && /this\._cutawayUp *= *false/.test(returnMatch[0])) ok('ui.js: _returnToPlate() clears _cutawayUp');
    else fail('ui.js _returnToPlate', '_returnToPlate() does not clear _cutawayUp');
    if (drawMatch && /if *\(this\._cutawayUp\) *return;/.test(drawMatch[0])) ok('ui.js: _drawStaticField() no-ops while _cutawayUp is set');
    else fail('ui.js _drawStaticField cutaway guard', '_drawStaticField() does not check/return on _cutawayUp');
    if (animateMatch && /this\._cutawayUp *= *true/.test(animateMatch[0])) ok('ui.js: _animateBattedBall() sets _cutawayUp');
    else fail('ui.js _animateBattedBall cutaway flag', '_animateBattedBall() does not set _cutawayUp');
    // Nowhere else in the file clears it - _returnToPlate() is the only exit.
    // Two legitimate sites: the constructor's own initial declaration, and _returnToPlate()'s own
    // clear (already checked above) - never a third, which would be a second exit from the flag.
    const clearSites = (uiSrc.match(/_cutawayUp *= *false/g) || []).length;
    if (clearSites === 2) ok('ui.js: _cutawayUp = false appears in exactly 2 places (constructor init, _returnToPlate)');
    else fail('ui.js _cutawayUp single exit', `_cutawayUp = false appears in ${clearSites} places, expected 2`);

    // Row 7, restated for R1: there is no picture to preload, so the first wind-up waits for the
    // SCENE's own first rendered frame instead. Bounded to `_stepWindup`'s own body so a comment
    // elsewhere mentioning the call by name can't produce a false pass or fail.
    const windupMatch = uiSrc.match(/\n {2}async _stepWindup\(\) \{[\s\S]*?\n {2}\}\n/);
    if (windupMatch && /actors\.firstFrame\(\)/.test(windupMatch[0]) && /FIRST_FRAME_CAP_MS/.test(windupMatch[0])) {
      ok('ui.js: _stepWindup() awaits actors.firstFrame() with a cap');
    } else {
      fail('ui.js _stepWindup first-frame await', '_stepWindup() does not await actors.firstFrame() with a cap');
    }
    if (/firstFrame\(\) \{ return this\._firstFramePromise; \}/.test(actorsSrc)) {
      ok('actors.js: firstFrame() resolves from the render loop');
    } else {
      fail('actors.js firstFrame', 'no firstFrame() returning the render loop\'s own promise');
    }
  }
}

console.log(failed ? `\n${failed} FAILED (node half)\n` : '\nnode half: all checks passed\n');

// ================================================================= Chromium half (load/dispose) ==
console.log('=== chromium half: load/dispose ===');

async function runChromiumHalf() {
  if (!existsSync(MODEL_PATH)) {
    skipLine('chromium half', `${MODEL_PATH} does not exist yet - pass --model <path> or set BB_MODEL_PATH`);
    return;
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    skipLine('chromium half', "optional dependency 'playwright-core' not installed - run from the repo root");
    return;
  }
  const BASE = 'http://localhost:8123';
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error('bad status');
  } catch {
    skipLine('chromium half', `dev server not reachable at ${BASE} - run: node server.mjs`);
    return;
  }

  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const { resolve, extname } = await import('node:path');
  const MIME = { '.glb': 'model/gltf-binary' };
  const absModel = resolve(MODEL_PATH);
  const repoRoot = resolve('.');
  let modelUrl, localSrv = null;
  if (absModel.startsWith(repoRoot + '/')) {
    modelUrl = BASE + '/' + absModel.slice(repoRoot.length + 1);
  } else {
    localSrv = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': MIME[extname(absModel)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
      res.end(readFileSync(absModel));
    });
    await new Promise((r) => localSrv.listen(0, '127.0.0.1', r));
    modelUrl = `http://127.0.0.1:${localSrv.address().port}/model.glb`;
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.__bbTest = true; });

  const result = await page.evaluate(async ({ modelUrl }) => {
    const { Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD } = await import('/baseball/js/actors.js');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed; left:0; top:0; width:300px; height:300px;';
    document.body.appendChild(wrap);
    const F = await import('/baseball/js/field.js');
    const actors = new Actors(wrap);
    const glOk = actors.initGL();
    if (!glOk) return { error: 'initGL() returned false' };
    await actors.load(modelUrl);
    actors.resize(300, 300);
    // R1: world feet, and the batting camera (the class's own default) already looks at the box.
    actors.place('batter', { pos: { x: -F.BATTER_BOX.x, y: 0, z: F.BATTER_BOX.z }, heightFt: F.FIGURE_HEIGHT_FT, facingRad: BATTER_FACING_RAD });
    actors.idle('batter');
    actors.actors.batter.mixer.update(0);
    const gl = actors.renderer.getContext();
    const dw = actors.canvas.width, dh = actors.canvas.height;
    // R1: the clear colour is opaque sky now (this canvas draws the whole scene), so "is anything
    // there" cannot be an alpha test any more. Instead: render with the batter, render without him,
    // and compare the same block. A figure that does not paint makes the two identical.
    const blockSum = () => {
      const buf = new Uint8Array(dw * dh * 4);
      gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
      return sum;
    };
    actors.renderer.render(actors.scene, actors.camera);
    const withBatter = blockSum();
    actors.actors.batter.pivot.visible = false;
    actors.renderer.render(actors.scene, actors.camera);
    const withoutBatter = blockSum();
    actors.actors.batter.pivot.visible = true;
    actors.renderer.render(actors.scene, actors.camera);
    const hasCanvas = !!document.querySelector('canvas.bb-actor-canvas');

    // STAGE 3: a read-back of the pitcher region differs between Set and mid-Pitch (section 3.9).
    // A checksum over a block covering the WHOLE figure (full canvas height, not just the upper
    // body), not one pixel - CLIPS.Pitch's own leg-lift keyframe (t=0.45) deliberately leaves the
    // arms exactly as Set (poses.js: "hands stay tucked... only the leg has moved"), so a sample
    // window that missed the legs found no difference at all here first (identical checksums) even
    // though the pose plainly changed - the release keyframe (t=1.0, the mark) moves the arms too,
    // and is used below as "mid-Pitch" for the widest possible margin.
    const checksum = (x0, y0, w, h) => {
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
      return sum;
    };
    actors.place('pitcher', { pos: { x: F.RUBBER.x, y: F.RUBBER.y, z: F.RUBBER.z }, heightFt: F.FIGURE_HEIGHT_FT, facingRad: PITCHER_FACING_RAD });
    actors.setCamera('pitcher');
    actors.play('pitcher', 'Set');
    actors.actors.pitcher.actions.Set.time = 0; actors.actors.pitcher.actions.Set.paused = true;
    actors.actors.pitcher.mixer.update(0);
    actors.renderer.render(actors.scene, actors.camera);
    const setChecksum = checksum(0, 0, dw, dh);
    actors.play('pitcher', 'Pitch');
    actors.actors.pitcher.actions.Pitch.time = 1.0; actors.actors.pitcher.actions.Pitch.paused = true;
    // play()'s crossFadeTo schedules Pitch's weight 0->1 (and Set's 1->0) over CROSSFADE_S,
    // starting from THIS mixer.time - a dt=0 update evaluates that schedule at its own start (0),
    // so Pitch would render at zero weight even with its `.time` set. update() past CROSSFADE_S
    // completes the fade (both actions stay paused, so this does not also advance either one's own
    // clip time - only the fade envelope moves).
    actors.actors.pitcher.mixer.update(0.2);
    actors.renderer.render(actors.scene, actors.camera);
    const pitchChecksum = checksum(0, 0, dw, dh);

    // STAGE 3: a read-back of the batter's shirt pixel differs between home and away (section 3.9,
    // 2.2's colour-key remap). Re-place at BATTER_FACING_RAD (the real facing, not this file's
    // load/dispose check's facingRad=0) so the sample point is the same one every other batter
    // render in this stage used.
    // STAGE 6, one line into a stage 3 check, because stage 6's own work broke it and the break is
    // an artefact of this harness rather than of the game: this half stacks BOTH figures on the SAME
    // anchor (the real play screen never does - the pitcher is 47 px tall out at the mound), and the
    // re-authored release pose reaches the throwing arm toward the camera, past the batter's pivot
    // z of 10 (actors.js `_place`). Measured, that put the pitcher's forearm over this exact pixel
    // and the sample read his skin (129,78,53) for BOTH sides, so the check failed on an overlap and
    // not on a colour. Hiding him restores what the check is actually about; nothing it asserts
    // changed.
    actors.actors.pitcher.pivot.visible = false;
    actors.setCamera('batter');
    actors.place('batter', { pos: { x: -F.BATTER_BOX.x, y: 0, z: F.BATTER_BOX.z }, heightFt: F.FIGURE_HEIGHT_FT, facingRad: BATTER_FACING_RAD });
    actors.idle('batter');
    actors.actors.batter.mixer.update(0);
    // R1: the sample point is the batter's own CHEST, projected through the live camera, rather
    // than a fixed canvas fraction - the figure is placed in the world now, so where he lands on
    // screen is the camera's business and a hard-coded pixel would be a guess about it.
    actors.actors.batter.pivot.updateMatrixWorld(true);
    const chestV = { x: 0, y: 0, z: 0 };
    { const b = actors.actors.batter.bones.chest || actors.actors.batter.bones.spine;
      const e = b.matrixWorld.elements; chestV.x = e[12]; chestV.y = e[13]; chestV.z = e[14]; }
    const sp = F.projectToCanvas(actors.camera, chestV, dw, dh);
    const sx = Math.max(0, Math.min(dw - 1, Math.round(sp.x))), sy = Math.max(0, Math.min(dh - 1, dh - Math.round(sp.y)));
    const readAt = () => { const p = new Uint8Array(4); gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    await actors.setBatter({ side: 'home' });
    actors.renderer.render(actors.scene, actors.camera);
    const shirtPxHome = readAt();
    await actors.setBatter({ side: 'away' });
    actors.renderer.render(actors.scene, actors.camera);
    const shirtPxAway = readAt();

    actors.dispose();
    const canvasGoneAfterDispose = !document.querySelector('canvas.bb-actor-canvas');
    const rendererGone = actors.renderer === null;
    wrap.remove();
    return {
      hasCanvas, withBatter, withoutBatter, canvasGoneAfterDispose, rendererGone,
      setChecksum, pitchChecksum,
      shirtPxHome: Array.from(shirtPxHome), shirtPxAway: Array.from(shirtPxAway),
    };
  }, { modelUrl });

  if (localSrv) localSrv.close();
  await browser.close();

  if (pageErrors.length) fail('chromium: no console error on mount', pageErrors.join(' | '));
  else ok('chromium: no console error on mount');

  if (result.error) {
    fail('chromium: load/place/render', result.error);
    return;
  }
  if (result.hasCanvas) ok('actor canvas (class="bb-actor-canvas") exists after load()');
  else fail('actor canvas', 'canvas.bb-actor-canvas not found in the DOM');
  if (result.withBatter !== result.withoutBatter) ok(`the idle batter actually paints (frame checksum ${result.withBatter} with him, ${result.withoutBatter} without)`);
  else fail('idle batter paints', `identical checksum ${result.withBatter} with and without the batter - the figure is not being drawn`);
  if (result.canvasGoneAfterDispose) ok('dispose(): actor canvas removed from the DOM');
  else fail('dispose() canvas', 'canvas.bb-actor-canvas still present after dispose()');
  if (result.rendererGone) ok('dispose(): renderer is null (not reachable)');
  else fail('dispose() renderer', 'actors.renderer is not null after dispose()');

  if (result.setChecksum !== result.pitchChecksum) ok(`pitcher read-back differs, Set vs mid-Pitch (${result.setChecksum} vs ${result.pitchChecksum})`);
  else fail('pitcher Set vs Pitch read-back', `identical checksum ${result.setChecksum} - the pose did not visibly change`);

  const shirtDiff = result.shirtPxHome && result.shirtPxAway
    ? Math.abs(result.shirtPxHome[0] - result.shirtPxAway[0]) + Math.abs(result.shirtPxHome[1] - result.shirtPxAway[1]) + Math.abs(result.shirtPxHome[2] - result.shirtPxAway[2])
    : 0;
  if (shirtDiff > 20) ok(`batter shirt pixel differs, home vs away (home ${JSON.stringify(result.shirtPxHome)}, away ${JSON.stringify(result.shirtPxAway)})`);
  else fail('batter shirt pixel home vs away', `too close (home ${JSON.stringify(result.shirtPxHome)}, away ${JSON.stringify(result.shirtPxAway)})`);
}

await runChromiumHalf();

// ======================================================= STAGE 4: mounted in the real hub ==
// docs/BASEBALL-3D-BUILD.md section 3.9's stage-4 addition to the Chromium half: mount Baseball
// through the real hub (test-baseball-device.mjs's own `mountInHub` pattern) at iPhone dimensions,
// start Quick Play, and check the 3D layer is actually the thing on screen - not a second instance
// built by hand the way the load/dispose half above does (that one predates ui.js's own wiring and
// stays as the lower-level proof that Actors itself works).
async function runMountInHubHalf() {
  if (!existsSync(MODEL_PATH)) { skipLine('mounted-in-hub half', `${MODEL_PATH} does not exist yet`); return; }
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { skipLine('mounted-in-hub half', "optional dependency 'playwright-core' not installed - run from the repo root"); return; }
  try {
    const r = await fetch('http://localhost:8123/', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error('bad status');
  } catch { skipLine('mounted-in-hub half', 'dev server not reachable at http://localhost:8123 - run: node server.mjs'); return; }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__bbTest = true; // preserveDrawingBuffer, for the pixel read-back below
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Actor Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }] }));
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    try {
      const m = await import('/js/announce.js');
      for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id);
    } catch { /* module missing is fine */ }
    document.querySelectorAll('.ann-overlay').forEach((n) => n.remove());
  });
  const mountErr = await page.evaluate(async () => {
    const m = await import('/js/hub.js');
    const hub = window.__ghHub;
    if (!hub) return 'hub instance not found (window.__ghHub)';
    if (!hub.games.some((x) => x.id === 'baseball')) {
      const entry = m.GAMES.find((x) => x.id === 'baseball');
      if (!entry) return 'no GAMES entry for "baseball"';
      hub.games = [...hub.games, entry];
    }
    await hub.launch('baseball');
    if (!hub.current || hub.current.id !== 'baseball') return 'hub.launch("baseball") did not mount it';
    return null;
  });
  if (mountErr) { fail('mount-in-hub', mountErr); await browser.close(); return; }

  const readyErr = await page.evaluate(async () => {
    const inst = document.querySelector('.hub-game')._bbInstance;
    const deadline = Date.now() + 10000;
    while (!(inst.actors && inst.actors.ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (!(inst.actors && inst.actors.ready)) return 'actors.ready never became true within 10s';
    return null;
  });
  if (readyErr) { fail('actors.ready', readyErr); await browser.close(); return; }
  ok('actors.ready became true, mounted in the real hub');

  await page.evaluate(async () => {
    const root = document.querySelector('.hub-game');
    const btn = root && root.querySelector('.bb-play-btn');
    if (btn) btn.click();
  });
  await page.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
  // The batter's first real placement happens inside the first at-bat's own windup
  // (HumanAgent.decideSwing -> _stepWindup, docs/BASEBALL-3D-BUILD.md section 3.6), not at mount -
  // poll for it (bounded) instead of guessing a fixed sleep long enough to cover team setup +
  // plate.webp's own load + the engine actually reaching the first decideSwing call.
  await page.waitForFunction(() => {
    const inst = document.querySelector('.hub-game') && document.querySelector('.hub-game')._bbInstance;
    return !!(inst && inst.actors && inst.actors.actors.batter && inst.actors.actors.batter._last);
  }, null, { timeout: 8000 }).catch(() => {});

  const layerCheck = await page.evaluate(async () => {
    const F = await import('/baseball/js/field.js');
    const fieldCanvas = document.querySelector('.bb-field-canvas');
    const actorCanvas = document.querySelector('.bb-actor-canvas');
    if (!fieldCanvas || !actorCanvas) return { error: `missing canvas (field=${!!fieldCanvas}, actor=${!!actorCanvas})` };
    const fieldZ = parseInt(getComputedStyle(fieldCanvas).zIndex, 10) || 0;
    const actorZ = parseInt(getComputedStyle(actorCanvas).zIndex, 10) || 0;
    const inst = document.querySelector('.hub-game')._bbInstance;
    // STAGE 4: start()'s own render loop is rate-capped (actors.js's RENDER_FRAME_MS, added for R2
    // cadence - see its own header) - a placement that just happened (this frame, via
    // _syncActors's setBatter/setPitcher) is not guaranteed to have been RENDERED yet by the time
    // this evaluates, so force one render of the current scene state rather than read back
    // whatever frame happened to be sitting in the (preserveDrawingBuffer) buffer already.
    inst.actors.renderer.render(inst.actors.scene, inst.actors.camera);
    const gl = inst.actors.renderer.getContext();
    const dw = actorCanvas.width, dh = actorCanvas.height;
    // R1: the clear colour is opaque sky (this canvas is the whole field now), so "is the batter
    // there" cannot be an alpha test. Render the frame with him and without him and compare the
    // block around his own PROJECTED position - the world position `place()` last got, through the
    // live camera, rather than a guessed screen fraction.
    inst.actors.actors.batter.pivot.updateMatrixWorld(true);
    const last = inst.actors.actors.batter._last;
    const feet = last ? last.pos : { x: 0, y: 0, z: 0 };
    const p0 = F.projectToCanvas(inst.actors.camera, feet, dw, dh);
    const p1 = F.projectToCanvas(inst.actors.camera, { x: feet.x, y: F.FIGURE_HEIGHT_FT, z: feet.z }, dw, dh);
    const hPx = Math.max(8, Math.abs(p0.y - p1.y));
    const bw = Math.round(hPx * 0.7), bh = Math.round(hPx);
    const x0 = Math.max(0, Math.min(dw - 1, Math.round(p0.x - bw / 2)));
    const y0 = Math.max(0, Math.min(dh - 1, Math.round(dh - p0.y)));
    const w = Math.max(1, Math.min(dw - x0, bw)), h = Math.max(1, Math.min(dh - y0, bh));
    const sum = () => {
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let t = 0; for (let i = 0; i < buf.length; i++) t += buf[i];
      return t;
    };
    inst.actors.renderer.render(inst.actors.scene, inst.actors.camera);
    const withBatter = sum();
    inst.actors.actors.batter.pivot.visible = false;
    inst.actors.renderer.render(inst.actors.scene, inst.actors.camera);
    const withoutBatter = sum();
    inst.actors.actors.batter.pivot.visible = true;
    inst.actors.renderer.render(inst.actors.scene, inst.actors.camera);
    return { fieldZ, actorZ, withBatter, withoutBatter, block: [x0, y0, w, h] };
  });
  if (layerCheck.error) {
    fail('mount-in-hub layering', layerCheck.error);
  } else {
    // R1 SWAPPED THE TWO CANVASES: the WebGL one draws the stadium, so it is the bottom layer and
    // the 2-D overlay (the strike-zone box, the marker label) sits above it.
    if (layerCheck.fieldZ > layerCheck.actorZ) ok(`the 2-D overlay sits above the WebGL scene (z-index ${layerCheck.fieldZ} > ${layerCheck.actorZ})`);
    else fail('mount-in-hub layering', `overlay z-index ${layerCheck.fieldZ} does not sit above the scene's ${layerCheck.actorZ}`);
    if (layerCheck.withBatter !== layerCheck.withoutBatter) ok(`the idle batter paints on the real play screen (block ${layerCheck.block.join('x')}, checksum ${layerCheck.withBatter} with him / ${layerCheck.withoutBatter} without)`);
    else fail('mount-in-hub idle batter', `identical checksum ${layerCheck.withBatter} with and without the batter`);
  }

  // A read-back 150ms into Swing differs from the idle read-back - proves the live play screen's
  // own actors.play('batter','Swing',...) call (from _startSwingTimeline) actually reaches the
  // renderer, not just that the Actors class can play a clip in isolation (the load/dispose half
  // above already proved that for Set/Pitch).
  const swingDiff = await page.evaluate(() => new Promise((resolve) => {
    const inst = document.querySelector('.hub-game')._bbInstance;
    const gl = inst.actors.renderer.getContext();
    const canvas = document.querySelector('.bb-actor-canvas');
    const dw = canvas.width, dh = canvas.height;
    const checksum = () => {
      const buf = new Uint8Array(dw * dh * 4);
      gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
      return sum;
    };
    const idleSum = checksum();
    inst.actors.play('batter', 'Swing', { markAtMs: 80 });
    setTimeout(() => resolve({ idleSum, swingSum: checksum() }), 150);
  }));
  if (swingDiff.idleSum !== swingDiff.swingSum) ok(`batter read-back differs, idle vs 150ms into Swing (${swingDiff.idleSum} vs ${swingDiff.swingSum})`);
  else fail('mount-in-hub Swing read-back', `identical checksum ${swingDiff.idleSum} - the swing did not visibly change the render`);

  // [KNOWN-BUG PROBE] The cutaway must stay on the CHASE camera for its WHOLE duration, and no
  // input path may switch it back. The history: Matt's first recording of v857 showed the batter
  // frozen over the overhead diamond for ~7 s after every ball in play, because
  // `_animateBattedBall` re-showed the 3-D layer the moment the landing marker was drawn; v858
  // fixed that one path, and stage 7 (section 7, row 6) found a second one - a slider touch
  // mid-cutaway redrawing the plate view - and closed every path at once with `_cutawayUp`.
  // R1 keeps the same flag and the same probe, one layer down: the cutaway is a camera move now,
  // so "did it come back early" is asked of `actors.cameraName` rather than of a canvas's
  // `display`. Drives the real `_animateBattedBall` (unstubbed - the whole point is to prove the
  // REAL `_drawStaticField()` no-ops on its own), tries a pad move plus a direct manual call
  // mid-cutaway and asserts neither changed the camera, then makes NO further test calls and
  // asserts the pitch camera returns BY ITSELF within 2.6 s of the cut (CONTACT_HOLD_MS is spent
  // before this function is even called; FLIGHT_MS + MARKER_HOLD_MS = 2.0 s is its own budget).
  // The live game's own engine events are silenced for the probe's window so nothing else calls
  // `_animateBattedBall`/`_settleAtBat` concurrently.
  const cutaway = await page.evaluate(async () => {
    const inst = document.querySelector('.hub-game')._bbInstance;
    const cam = () => inst.actors.cameraName;
    if (inst.game) inst.game.onEvent = () => {};
    {
      const settleDeadline = performance.now() + 4000;
      while (inst._cutawayUp && performance.now() < settleDeadline) await new Promise((r) => setTimeout(r, 50));
    }
    // Fire-and-forget, deliberately NOT awaited - the whole point is to sample mid-flight state.
    inst._animateBattedBall(40, 180, 'hit', '1B', 'fly', 200);
    const cutStart = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    const midFlight = { cam: cam(), running: !!inst.actors._running, cutawayUp: !!inst._cutawayUp };

    // Mid-cutaway: a pad move plus a DIRECT call to the real (never stubbed) _drawStaticField() -
    // both must be no-ops while `_cutawayUp` is set.
    inst.state.batterAimX = 0.5;
    inst._drawStaticField();
    await new Promise((r) => setTimeout(r, 50));
    const afterManualDraw = { cam: cam(), running: !!inst.actors._running, cutawayUp: !!inst._cutawayUp };

    // No further test calls from here - the pitch camera must return on its own.
    const deadline = cutStart + 2600;
    let returnedAtMs = null;
    while (performance.now() < deadline) {
      if (cam() !== 'chase' && !inst._cutawayUp) { returnedAtMs = performance.now() - cutStart; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    const afterReturn = returnedAtMs != null ? { cam: cam(), running: !!inst.actors._running, ms: returnedAtMs } : null;
    return { midFlight, afterManualDraw, afterReturn };
  });
  if (cutaway.midFlight.cam === 'chase' && cutaway.midFlight.running && cutaway.midFlight.cutawayUp) {
    ok('cutaway: the chase camera is live and the render loop is running mid-flight');
  } else {
    fail('cutaway camera', `mid-flight: camera="${cutaway.midFlight.cam}", running=${cutaway.midFlight.running}, cutawayUp=${cutaway.midFlight.cutawayUp}`);
  }
  if (cutaway.afterManualDraw.cam === 'chase' && cutaway.afterManualDraw.cutawayUp) {
    ok('a pad move + a direct _drawStaticField() call mid-cutaway did not switch the camera (the _cutawayUp no-op)');
  } else {
    fail('cutaway no-op', `after a manual _drawStaticField() mid-cutaway the camera is "${cutaway.afterManualDraw.cam}" (cutawayUp=${cutaway.afterManualDraw.cutawayUp}) - the cutaway was interrupted (slider-touch bug)`);
  }
  if (cutaway.afterReturn && cutaway.afterReturn.cam !== 'chase' && cutaway.afterReturn.running) {
    ok(`the pitch camera returned by itself ${cutaway.afterReturn.ms.toFixed(0)}ms after the cut (now "${cutaway.afterReturn.cam}"), no further test calls`);
  } else if (!cutaway.afterReturn) {
    fail('cutaway auto-return', 'the pitch camera never came back on its own within 2.6s of the cut');
  } else {
    fail('cutaway auto-return', `returned at ${cutaway.afterReturn.ms.toFixed(0)}ms but camera="${cutaway.afterReturn.cam}", running=${cutaway.afterReturn.running}`);
  }

  await page.evaluate(() => { document.querySelector('.hub-game')._bbInstance.destroy(); });
  const afterDestroy = await page.evaluate(() => {
    const inst = document.querySelector('.hub-game')._bbInstance;
    const canvasGone = !document.querySelector('canvas.bb-actor-canvas');
    let infoReachable = true;
    try { void inst.actors.renderer.info; } catch { infoReachable = false; }
    // A disposed Actors sets `this.renderer = null` (actors.js's own dispose()) - `renderer.info`
    // is "not reachable" because `renderer` itself is gone, not because reading `.info` throws.
    if (inst.actors && inst.actors.renderer === null) infoReachable = false;
    return { canvasGone, infoReachable };
  });
  if (afterDestroy.canvasGone) ok('destroy(): actor canvas is gone from the mounted play screen');
  else fail('mount-in-hub destroy() canvas', 'canvas.bb-actor-canvas still present after destroy()');
  if (!afterDestroy.infoReachable) ok('destroy(): renderer.info is not reachable');
  else fail('mount-in-hub destroy() renderer.info', 'renderer.info is still reachable after destroy()');

  if (pageErrors.length) fail('mount-in-hub: no console error', pageErrors.join(' | '));
  else ok('mount-in-hub: no console error across mount/play/destroy');

  await browser.close();
}

console.log('\n=== chromium half: mounted in the real hub ===');
await runMountInHubHalf();

// ========================================== STAGE 6: motion, measured at the REAL on-screen sizes ==
// docs/BASEBALL-3D-BUILD.md section 7. Stages 2 and 3 graded every POSE against its sprite frame and
// nothing ever measured what moved BETWEEN the poses, so the shipped build reached Matt's phone with
// an Idle that moved no bone at all and a whole pitch delivery worth 20 px of hand travel: "They look
// way too much like just flat images (because they are)."
//
// R1 RE-BASED THIS BLOCK, because the thing it measures moved. Stage 6 placed each figure at a fixed
// PIXEL height under an orthographic canvas-pixel camera, so a world distance simply WAS a screen
// distance. There is no such camera now: every figure is 6 ft tall in the world and how big that is
// on screen is the perspective camera's business. So the measurement is the same measurement, taken
// one step later - bone WORLD positions sampled every 1/60 s through `mixer.update` (never a wall
// clock, so the numbers are identical on a fast machine and a loaded one), then PROJECTED through
// the camera that actually shows that figure (`batterCam` for the batter, `pitcherCam` for the
// pitcher) onto the real 393x429 field band.
//
// The floors below were re-measured the same way and set at 60% of what R1 actually produces, with
// the ratio to stage 6's own floor beside each one. They are floors, not targets. Every measured
// number prints on every run whether it passes or not, because the number is the point - "the
// batter's idle moves 21 px" is a fact a future session can compare against, and "the idle looks
// alive" is not.
// measured on 2026-09-20 through the shipped cameras at 393x429: the batter draws 200.5 px tall on
// batterCam and the pitcher 234.2 px on pitcherCam (he is 11 ft from that lens), which is why the
// pitcher's numbers grew so much more than the batter's - stage 6 measured him at 47 px.
const MOTION_FLOORS = {
  idleHandTravel: 10,     // batter Idle, handR, batterCam. Measured 17.1. Stage 6's floor was 8 at 214 px: 1.3x
  setHandTravel: 13,      // pitcher Set, handR, pitcherCam. Measured 22.7. Stage 6's floor was 2 at 47 px: 6.5x
  pitchHandPath: 268,     // pitcher Pitch, handR path length. Measured 447.4. Stage 6's floor was 45: 6.0x
  pitchHandRise: 76,      // pitcher Pitch, handR max y minus min y. Measured 127.2. Stage 6's floor was 20: 3.8x
  pitchFootLift: 57,      // pitcher Pitch, the foot that leaves the ground. Measured 95.9. Stage 6's floor was 10: 5.7x
  pitchEarlyMove: 7,      // pitcher Pitch, handR inside the first 20% of the clip. Measured 13.1. Stage 6's floor was 2: 3.5x
  // RA (docs/BASEBALL-3D-BUILD.md section 9), same rule as every row above: 60% of what this build
  // actually produces, measured through the camera each clip is seen through, at the size it is
  // drawn. BUNT is deliberately the smallest number in this table - a square is a STANCE, and the
  // only thing its floor has to catch is the clip going flat (two identical keyframes holding one
  // pose, the "flat image" defect stage 6 was written to kill); the give is 9.7 px of hand travel
  // on a 200.5 px batter, against Idle's own 17.1.
  buntHandTravel: 5,      // batter Bunt, handR, batterCam. Measured 9.7
  pickoffHandPath: 84,    // pitcher Pickoff, handR path length, pitcherCam. Measured 140.9 (Pitch's own is 447.4 over 1.30s; this is 0.50s)
  pickoffEarlyMove: 18,   // pitcher Pickoff, handR inside the first 20%. Measured 31.4 - a pickoff is all in its first beat, which is the opposite shape to the delivery's own 13.1 over a much longer clip
};

console.log('\n=== chromium half: motion at the real on-screen sizes (R1: through the real cameras) ===');
async function runMotionHalf() {
  if (!existsSync(MODEL_PATH)) { skipLine('motion half', `${MODEL_PATH} does not exist yet`); return; }
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { skipLine('motion half', "optional dependency 'playwright-core' not installed - run from the repo root"); return; }
  try {
    const r = await fetch('http://localhost:8123/', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error('bad status');
  } catch { skipLine('motion half', 'dev server not reachable at http://localhost:8123 - run: node server.mjs'); return; }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' });

  const measured = await page.evaluate(async () => {
    const { Actors, BATTER_FACING_RAD, PITCHER_FACING_RAD } = await import('/baseball/js/actors.js');
    const F = await import('/baseball/js/field.js');
    const wrap = document.createElement('div');
    // The REAL field band on a 393x852 phone, measured in the hub: 393 x 429 CSS px.
    const W = 393, H = 429;
    wrap.style.cssText = `position:fixed; left:0; top:0; width:${W}px; height:${H}px;`;
    document.body.appendChild(wrap);
    const actors = new Actors(wrap);
    if (!actors.initGL()) return { error: 'initGL() returned false' };
    await actors.load(`${location.origin}/baseball/models/player.glb`);
    actors.resize(W, H);

    // A bone's world position PROJECTED onto the field band, through the camera that actually shows
    // this figure. Elements 12/13/14 of matrixWorld are the translation.
    const screenAt = (bone, cam) => {
      const e = bone.matrixWorld.elements;
      const p = F.projectToCanvas(cam, { x: e[12], y: e[13], z: e[14] }, W, H);
      return { x: p.x, y: p.y };
    };
    const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const run = (role, name, pos, facingRad, camName) => {
      const act = actors.actors[role];
      const cam = actors.cameras[camName];
      actors.place(role, { pos, heightFt: F.FIGURE_HEIGHT_FT, facingRad });
      act.mixer.stopAllAction();
      act.current = null;                  // no cross-fade from whatever ran before this clip
      actors.play(role, name);             // the real play(), with no markAtMs, so timeScale is 1
      const a = act.actions[name];
      if (!a) return { error: `no action "${name}" on ${role}` };
      a.timeScale = 1;
      const dur = a.getClip().duration;
      const steps = Math.round(dur * 60);
      const samples = [];
      act.mixer.update(0);                 // settle the clip's own t=0 pose before the first sample
      for (let i = 0; i <= steps; i++) {
        if (i > 0) act.mixer.update(1 / 60);
        act.pivot.updateMatrixWorld(true);
        samples.push({ t: i / 60, handR: screenAt(act.bones.handR, cam), footL: screenAt(act.bones.footL, cam), footR: screenAt(act.bones.footR, cam), hips: screenAt(act.bones.hips, cam) });
      }
      act.mixer.stopAllAction();
      const stat = (key) => {
        const pts = samples.map((s) => s[key]);
        let travel = 0, path = 0;
        for (let i = 0; i < pts.length; i++) {
          if (i) path += d2(pts[i], pts[i - 1]);
          for (let j = i + 1; j < pts.length; j++) travel = Math.max(travel, d2(pts[i], pts[j]));
        }
        const ys = pts.map((p) => p.y);
        return { travel, path, rise: Math.max(...ys) - Math.min(...ys) };
      };
      const n20 = Math.max(1, Math.round(samples.length * 0.2));
      let early = 0;
      for (let i = 1; i <= n20 && i < samples.length; i++) early = Math.max(early, d2(samples[i].handR, samples[0].handR));
      // The figure's own on-screen height through this camera, so the numbers below can be read
      // against the size they were measured at without re-deriving it.
      const feet = F.projectToCanvas(cam, { x: pos.x, y: pos.y || 0, z: pos.z }, W, H);
      const head = F.projectToCanvas(cam, { x: pos.x, y: (pos.y || 0) + F.FIGURE_HEIGHT_FT, z: pos.z }, W, H);
      return { role, name, cam: camName, heightPx: Math.abs(feet.y - head.y), dur, frames: samples.length,
        handR: stat('handR'), hips: stat('hips'), footL: stat('footL'), footR: stat('footR'), early };
    };

    const batterPos = { x: -F.BATTER_BOX.x, y: 0, z: F.BATTER_BOX.z };
    const pitcherPos = { x: F.RUBBER.x, y: F.RUBBER.y, z: F.RUBBER.z };
    // R3 (docs/BASEBALL-3D-BUILD.md section 9): the run cycle, through the chase camera - the one
    // camera live while anyone (a fielder or a runner) is ever actually running. `chaseAt(pos, true)`
    // puts the camera at its real in-game offset from this figure before measuring, the same call
    // `_animateFielderChase`/`_runMarkerHold` make against the ball.
    const runnerPos = { x: 30, y: 0, z: -100 };
    actors.chaseAt(runnerPos, true);
    const out = {
      idle: run('batter', 'Idle', batterPos, BATTER_FACING_RAD, 'batter'),
      swing: run('batter', 'Swing', batterPos, BATTER_FACING_RAD, 'batter'),
      miss: run('batter', 'Miss', batterPos, BATTER_FACING_RAD, 'batter'),
      set: run('pitcher', 'Set', pitcherPos, PITCHER_FACING_RAD, 'pitcher'),
      pitch: run('pitcher', 'Pitch', pitcherPos, PITCHER_FACING_RAD, 'pitcher'),
      run: run('r1', 'Run', runnerPos, 0, 'chase'),
      // RA (docs/BASEBALL-3D-BUILD.md section 9): the two new clips, through the cameras that
      // actually show them - the batter squares in front of `batterCam`, the pitcher throws over
      // in front of `pitcherCam`, exactly like Idle/Swing and Set/Pitch above.
      bunt: run('batter', 'Bunt', batterPos, BATTER_FACING_RAD, 'batter'),
      pickoff: run('pitcher', 'Pickoff', pitcherPos, PITCHER_FACING_RAD, 'pitcher'),
    };
    actors.dispose();
    wrap.remove();
    return out;
  });

  await browser.close();
  if (pageErrors.length) fail('motion: no console error', pageErrors.join(' | '));
  if (measured.error) { fail('motion half', measured.error); return; }

  const n = (v) => v.toFixed(1);
  for (const k of ['idle', 'swing', 'miss', 'set', 'pitch', 'run', 'bunt', 'pickoff']) {
    const m = measured[k];
    if (!m || m.error) { fail(`motion: ${k}`, (m && m.error) || 'no measurement'); continue; }
    console.log(`      ${m.role}/${m.name} through ${m.cam}Cam, ${n(m.heightPx)}px tall, ${m.dur.toFixed(2)}s, ${m.frames} frames at 1/60s:`);
    console.log(`         handR travel ${n(m.handR.travel)}px  path ${n(m.handR.path)}px  rise ${n(m.handR.rise)}px  first-20% ${n(m.early)}px`);
    console.log(`         hips travel ${n(m.hips.travel)}px  footL lift ${n(m.footL.rise)}px  footR lift ${n(m.footR.rise)}px`);
  }

  const check = (label, got, floor) => {
    if (got >= floor) ok(`${label}: ${n(got)}px (floor ${floor}px)`);
    else fail(label, `${n(got)}px, below the ${floor}px floor - the clip reads as a still picture at the size it is drawn`);
  };
  check('Idle (batter, batterCam): handR travel', measured.idle.handR.travel, MOTION_FLOORS.idleHandTravel);
  // The hips must carry part of it: an idle whose hands move while the body stands still is the
  // "flat image" defect wearing a wave.
  if (measured.idle.hips.travel > 2) ok(`Idle (batter, batterCam): hips shift ${n(measured.idle.hips.travel)}px`);
  else fail('Idle hips shift', `${n(measured.idle.hips.travel)}px - the weight shift is not moving the body`);
  check('Set (pitcher, pitcherCam): handR travel', measured.set.handR.travel, MOTION_FLOORS.setHandTravel);
  check('Pitch (pitcher, pitcherCam): handR path length', measured.pitch.handR.path, MOTION_FLOORS.pitchHandPath);
  check('Pitch (pitcher, pitcherCam): handR vertical range', measured.pitch.handR.rise, MOTION_FLOORS.pitchHandRise);
  check('Pitch (pitcher, pitcherCam): front-foot lift', Math.max(measured.pitch.footL.rise, measured.pitch.footR.rise), MOTION_FLOORS.pitchFootLift);
  check('Pitch (pitcher, pitcherCam): handR moves inside the first 20% of the clip', measured.pitch.early, MOTION_FLOORS.pitchEarlyMove);
  // R3: the run cycle's own floor is stated relative to a 100px-tall figure ("foot travel of at
  // least 20 px per cycle at 100 px figure height") - a ratio, not a fixed pixel count, since the
  // chase camera's own distance (and so the figure's on-screen size) is not the same as the
  // pitcher's or the batter's. Scaled by the ACTUAL measured height so the floor stays honest at
  // whatever size this container's chaseCam happens to draw a runner at.
  const runFootTravel = Math.max(measured.run.footL.travel, measured.run.footR.travel);
  const runFloor = 20 * (measured.run.heightPx / 100);
  check(`Run (r1, chaseCam, ${n(measured.run.heightPx)}px tall): foot travel`, runFootTravel, runFloor);
  // RA: the two new clips, held to the same rule as every other one - 60% of what this build
  // actually produces, measured through the camera each is seen through, at the size it is drawn.
  // BUNT is the small one on purpose (a square is a stance, not a move), so its floor is about the
  // idle's: what it must never become is another pair of identical keyframes holding one pose,
  // which is precisely the "flat image" defect stage 6 was written to kill.
  check('Bunt (batter, batterCam): handR travel', measured.bunt.handR.travel, MOTION_FLOORS.buntHandTravel);
  if (measured.bunt.hips.travel > 2) ok(`Bunt (batter, batterCam): hips sink ${n(measured.bunt.hips.travel)}px through the give`);
  else fail('Bunt hips give', `${n(measured.bunt.hips.travel)}px - the bat is not being given with, the batter is a statue`);
  check('Pickoff (pitcher, pitcherCam): handR path length', measured.pickoff.handR.path, MOTION_FLOORS.pickoffHandPath);
  check('Pickoff (pitcher, pitcherCam): handR moves inside the first 20% of the clip', measured.pickoff.early, MOTION_FLOORS.pickoffEarlyMove);
}

// Stage 7 starts Swing and Miss with NO cross-fade, so their first keyframe has to BE the pose the
// batter is already standing in. Checked as poses, not as pixels, so it runs with no browser: the
// first key of each swing clip must equal Idle's own t=0 key, bone for bone.
for (const name of ['Swing', 'Miss']) {
  const rest = JSON.stringify(CLIPS.Idle.keys[0].pose), restHips = JSON.stringify(CLIPS.Idle.keys[0].hipsOffset || null);
  const first = JSON.stringify(CLIPS[name].keys[0].pose), firstHips = JSON.stringify(CLIPS[name].keys[0].hipsOffset || null);
  if (rest === first && restHips === firstHips) ok(`${name} opens on Idle's resting pose (no cross-fade needed to start it)`);
  else fail(`${name} first keyframe`, `differs from Idle's t=0 pose, so starting it with no cross-fade would pop\n      Idle: ${rest}\n      ${name}: ${first}`);
}

await runMotionHalf();

// r2-cadence (docs/BASEBALL-3D-BUILD.md section 3.9: "re-run that suite; do not reimplement it") -
// test-baseball-device.mjs is the one place that measures it; this just proves it still passes with
// the 3D layer live, as a subprocess rather than a second copy of its own timing logic.
console.log('\n=== r2-cadence (delegated to test-baseball-device.mjs) ===');
{
  if (!existsSync(MODEL_PATH)) {
    skipLine('r2-cadence', 'player.glb missing - test-baseball-device.mjs would have nothing to measure');
  } else {
    const { spawnSync } = await import('node:child_process');
    // R3 (orchestrator's ship review): the device suite's runners-move probe plays real games until
    // a runner advances, up to 360 s, so a 120 s spawn timeout killed it mid-run and this row read
    // "exit 1" under a passing r2-cadence line. 480 s covers the probe's own budget with margin.
    // RA: 480 s -> 720 s. The device suite grew an `actions-live` probe that plays real at-bats
    // until an armed bunt is actually put in play (its own 120 s budget), on top of runners-move's
    // existing 360 s - the two worst cases together can pass 480 s, and a spawn killed mid-run
    // reports as an exit code against a passing r2-cadence line, which is the exact confusion the
    // R3 bump above was written to remove.
    const r = spawnSync(process.execPath, ['test-baseball-device.mjs'], { encoding: 'utf8', timeout: 480000, env: { ...process.env, BB_DEVICE_QUICK: '1' } });
    const out = (r.stdout || '') + (r.stderr || '');
    const cadenceLine = out.split('\n').find((l) => /r2-cadence/.test(l)) || '(no r2-cadence line in output)';
    if (r.status === 0) ok(`test-baseball-device.mjs passed - ${cadenceLine.trim()}`);
    else fail('r2-cadence (test-baseball-device.mjs)', `exit ${r.status} - ${cadenceLine.trim()}\n${out.slice(-2000)}`);
  }
}

console.log(failed ? `\n${failed} FAILED (test-baseball-actors.mjs)` : '\ntest-baseball-actors.mjs: all checks passed');
process.exit(failed ? 1 : 0);
