// test-baseball-actors.mjs - the 3D actor layer (docs/BASEBALL-3D-BUILD.md section 3.9), two halves.
//
// 1. NODE, NO BROWSER (add to run-all-tests.mjs): readGlb parses the model; not Draco; under 4MB;
//    every RIG_REQUIRED name is a node in the file; the four skin PNGs (section 2.1) exist and are
//    1024x1024; CLIPS.Swing/CLIPS.Miss/CLIPS.Pitch have keys and a mark inside [0, lastKey.t];
//    CLIPS.Set has keys (mark:null by design, so no mark check); actors.js's KEYS colour-key table
//    (section 2.2) never keys a skin-tone colour; buildClip over a fake bones/restQ object yields
//    one quaternion track per bone used and the right duration. STAGE 4 (section 3.9's own list)
//    adds: `field.js` exports `plateCover`/`anchorPx`; `actors.dispose()` runs inside ui.js's own
//    `destroy()`; a `visibilitychange` listener pauses/resumes the actor layer; ui.js's live play
//    screen passes `noFigures` to `drawPlateView` so the 3D layer, when live, actually replaces the
//    sprite figures rather than drawing under them - see that check's own comment for why this
//    stands in for section 3.9's literal "no state.batterFrame/state.pitcherFrame writes remain":
//    those writes are KEPT (the required sprite-path fallback - section 3.6's own "if initGL()
//    returns false, the sprite path keeps running unchanged" - cannot work without them, and
//    test-baseball-device.mjs's own r2-cadence probe watches state.pitcherFrame reach 3 as its
//    release signal on both the CPU-pitches path and the human-pitches path), so a literal zero-
//    writes check would have to fail against a stage that satisfies every other requirement in the
//    same document.
// 2. CHROMIUM UNDER SWIFTSHADER (SKIPs without playwright-core; NOT in run-all-tests.mjs): loads
//    the model through the real Actors class, checks the actor canvas exists and paints a
//    non-transparent pixel block around an idle anchor, checks a pitcher read-back differs between
//    Set and mid-Pitch and a batter shirt pixel differs between home and away (section 2.2's
//    colour-key remap), then checks dispose() actually tears it down (canvas removed, renderer
//    gone, and - stage 3's own fix - without disposing the module-cached skin textures every OTHER
//    Actors instance still holds, see actors.js's dispose() comment).
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
for (const name of ['Swing', 'Miss', 'Pitch']) {
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

// ============================================================== STAGE 4 structural checks (ui.js) ==
// docs/BASEBALL-3D-BUILD.md section 3.9's own list, adapted per this file's header comment above:
// `field.js` exports `plateCover`/`anchorPx`, `ui.js`'s `destroy()` disposes the actor layer, a
// `visibilitychange` listener exists, and the live play screen actually hands `noFigures` to
// `drawPlateView` rather than always drawing sprites underneath a 3D layer that would then be
// drawing over them for nothing.
{
  const fieldSrc = readFileSync('./baseball/js/field.js', 'utf8');
  const uiSrc = readFileSync('./baseball/js/ui.js', 'utf8');

  if (/export function plateCover\(/.test(fieldSrc)) ok('field.js: plateCover is exported');
  else fail('field.js plateCover export', 'no "export function plateCover(" found');

  if (/export function anchorPx\(/.test(fieldSrc)) ok('field.js: anchorPx is exported');
  else fail('field.js anchorPx export', 'no "export function anchorPx(" found');

  if (/noFigures\b/.test(fieldSrc) && /if \(!opts\.noFigures\)/.test(fieldSrc)) {
    ok('field.js: drawPlateView accepts opts.noFigures and gates the sprite figures on it');
  } else {
    fail('field.js noFigures', 'drawPlateView does not gate drawBatterFigure/drawPitcherFigure on opts.noFigures');
  }

  if (/noFigures:\s*this\._actorsLive/.test(uiSrc)) {
    ok('ui.js: _drawStaticField passes noFigures: this._actorsLive to drawPlateView');
  } else {
    fail('ui.js noFigures wiring', 'no "noFigures: this._actorsLive" found - the live play screen may still draw sprites over/under the 3D layer');
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

  // The actor calls that replace each state.pitcherFrame/state.batterFrame write's DRAWING role
  // (section 3.6's own mapping table) - present alongside the kept sprite-path writes, per this
  // file's header comment.
  const wantCalls = [
    [/actors\.play\('pitcher', 'Pitch', \{ *markAtMs: *WINDUP_MS *\}\)/, '_stepWindup calls actors.play(\'pitcher\',\'Pitch\',{markAtMs:WINDUP_MS})'],
    [/actors\.play\('pitcher', 'Pitch', \{ *markAtMs: *0 *\}\)/, "HumanAgent.decidePitch's release calls actors.play('pitcher','Pitch',{markAtMs:0})"],
    [/actors\.play\('batter', 'Swing', \{ *markAtMs: *80 *\}\)/, "_startSwingTimeline calls actors.play('batter','Swing',{markAtMs:80})"],
    [/actors\.setBall\(/, 'the pitch flight calls actors.setBall(...)'],
    [/actors\.setBatter\(\{/, '_syncActors calls actors.setBatter({...})'],
    [/actors\.setPitcher\(\{/, '_syncActors calls actors.setPitcher({...})'],
  ];
  let allCallsFound = true;
  for (const [re, label] of wantCalls) {
    if (!re.test(uiSrc)) { fail('ui.js actor call', `missing: ${label}`); allCallsFound = false; }
  }
  if (allCallsFound) ok(`ui.js: every section 3.6 mapping-table actor call is present (${wantCalls.length} checked)`);

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
    const actors = new Actors(wrap);
    const glOk = actors.initGL();
    if (!glOk) return { error: 'initGL() returned false' };
    await actors.load(modelUrl);
    actors.resize(300, 300, null);
    actors.place('batter', { anchor: { x: 150, y: 280 }, heightPx: 260, facingRad: 0 });
    actors.idle('batter');
    actors.actors.batter.mixer.update(0);
    actors.renderer.render(actors.scene, actors.camera);
    const gl = actors.renderer.getContext();
    const px = new Uint8Array(4);
    // Canvas pixel space is y-down from the TOP; our anchor's "feet" are near the bottom of the
    // 300x300 canvas, so sample a block partway up from there, at actual device pixels (dpr may
    // scale the drawing buffer beyond the 300x300 CSS size).
    const dw = actors.canvas.width, dh = actors.canvas.height;
    gl.readPixels(Math.floor(dw / 2), Math.floor(dh * 0.35), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const hasCanvas = !!document.querySelector('canvas.bb-actor-canvas');
    const alpha = px[3];

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
    actors.place('pitcher', { anchor: { x: 150, y: 280 }, heightPx: 200, facingRad: PITCHER_FACING_RAD });
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
    actors.place('batter', { anchor: { x: 150, y: 280 }, heightPx: 260, facingRad: BATTER_FACING_RAD });
    actors.idle('batter');
    actors.actors.batter.mixer.update(0);
    await actors.setBatter({ side: 'home' });
    actors.renderer.render(actors.scene, actors.camera);
    const shirtPxHome = new Uint8Array(4);
    gl.readPixels(Math.floor(dw / 2), Math.floor(dh * 0.35), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, shirtPxHome);
    await actors.setBatter({ side: 'away' });
    actors.renderer.render(actors.scene, actors.camera);
    const shirtPxAway = new Uint8Array(4);
    gl.readPixels(Math.floor(dw / 2), Math.floor(dh * 0.35), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, shirtPxAway);

    actors.dispose();
    const canvasGoneAfterDispose = !document.querySelector('canvas.bb-actor-canvas');
    const rendererGone = actors.renderer === null;
    wrap.remove();
    return {
      hasCanvas, alpha, canvasGoneAfterDispose, rendererGone,
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
  if (result.alpha > 0) ok(`idle pixel block is non-transparent (alpha ${result.alpha})`);
  else fail('idle pixel block', `alpha ${result.alpha}, expected > 0`);
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

  const layerCheck = await page.evaluate(() => {
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
    const px = new Uint8Array(4);
    const dw = actorCanvas.width, dh = actorCanvas.height;
    // Sample around the BATTER's own anchor (`place()`'s own last call - anchor is the feet, in CSS
    // px), not a fixed screen fraction: the field band's own shape (a tall, narrow crop, see
    // field.js's plateCover) puts the near-box batter low in the frame, not at a generic mid-canvas
    // point a fixed-fraction guess would assume.
    const last = inst.actors.actors.batter._last;
    const rect = actorCanvas.getBoundingClientRect();
    const scaleX = dw / rect.width, scaleY = dh / rect.height;
    // A BLOCK around the batter's own anchor, not one exact pixel: the figure is a silhouette with
    // real gaps (between the arms and the torso, around the bat), so a single guessed point can
    // land on a gap even when the figure is plainly on screen next to it - a real screenshot of
    // this exact scene (mounted in the hub, this same anchor) confirmed the render itself is
    // correct; only a one-pixel probe was too exact a claim to make about where "the batter" is.
    // The block spans the anchor's own heightPx (feet to head) and a generous width either side.
    const bw = Math.round((last ? last.heightPx : 100) * 0.7 * scaleX);
    const bh = Math.round((last ? last.heightPx : 100) * scaleY);
    const bx = Math.round(((last ? last.anchor.x : rect.width / 2) * scaleX) - bw / 2);
    const by = Math.round(((last ? last.anchor.y : rect.height * 0.9) * scaleY) - bh);
    const x0 = Math.max(0, Math.min(dw - 1, bx)), y0 = Math.max(0, Math.min(dh - 1, by));
    const w = Math.max(1, Math.min(dw - x0, bw)), h = Math.max(1, Math.min(dh - y0, bh));
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let maxAlpha = 0;
    for (let i = 3; i < buf.length; i += 4) if (buf[i] > maxAlpha) maxAlpha = buf[i];
    return { fieldZ, actorZ, idleAlpha: maxAlpha };
  });
  if (layerCheck.error) {
    fail('mount-in-hub layering', layerCheck.error);
  } else {
    if (layerCheck.actorZ > layerCheck.fieldZ) ok(`actor canvas sits above the field canvas (z-index ${layerCheck.actorZ} > ${layerCheck.fieldZ})`);
    else fail('mount-in-hub layering', `actor canvas z-index ${layerCheck.actorZ} does not sit above field canvas z-index ${layerCheck.fieldZ}`);
    if (layerCheck.idleAlpha > 0) ok(`idle pixel block is non-transparent on the real play screen (alpha ${layerCheck.idleAlpha})`);
    else fail('mount-in-hub idle pixel', `alpha ${layerCheck.idleAlpha}, expected > 0`);
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

// r2-cadence (docs/BASEBALL-3D-BUILD.md section 3.9: "re-run that suite; do not reimplement it") -
// test-baseball-device.mjs is the one place that measures it; this just proves it still passes with
// the 3D layer live, as a subprocess rather than a second copy of its own timing logic.
console.log('\n=== r2-cadence (delegated to test-baseball-device.mjs) ===');
{
  if (!existsSync(MODEL_PATH)) {
    skipLine('r2-cadence', 'player.glb missing - test-baseball-device.mjs would have nothing to measure');
  } else {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['test-baseball-device.mjs'], { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const cadenceLine = out.split('\n').find((l) => /r2-cadence/.test(l)) || '(no r2-cadence line in output)';
    if (r.status === 0) ok(`test-baseball-device.mjs passed - ${cadenceLine.trim()}`);
    else fail('r2-cadence (test-baseball-device.mjs)', `exit ${r.status} - ${cadenceLine.trim()}\n${out.slice(-2000)}`);
  }
}

console.log(failed ? `\n${failed} FAILED (test-baseball-actors.mjs)` : '\ntest-baseball-actors.mjs: all checks passed');
process.exit(failed ? 1 : 0);
