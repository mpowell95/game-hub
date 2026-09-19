// test-baseball-actors.mjs - the 3D actor layer (docs/BASEBALL-3D-BUILD.md section 3.9), two halves.
//
// 1. NODE, NO BROWSER (add to run-all-tests.mjs): readGlb parses the model; not Draco; under 4MB;
//    every RIG_REQUIRED name is a node in the file; the shirt material named in section 2.2 exists;
//    CLIPS.Swing/CLIPS.Pitch have keys and a mark inside [0, lastKey.t]; buildClip over a fake
//    bones/restQ object yields one quaternion track per bone used and the right duration.
// 2. CHROMIUM UNDER SWIFTSHADER (SKIPs without playwright-core; NOT in run-all-tests.mjs): loads
//    the model through the real Actors class, checks the actor canvas exists and paints a
//    non-transparent pixel block around an idle anchor, then checks dispose() actually tears it
//    down (canvas removed, renderer gone).
//
// STAGE 1: section 2.2 is unfilled, so `baseball/models/player.glb` does not exist yet and every
// model-dependent check SKIPs with a printed reason instead of failing - pass a real file to check
// it for real, either the section 2.1 scaffold or, once it exists, the real player.glb:
//
//   node test-baseball-actors.mjs --model <path-to-scaffold-or-player.glb>
//   BB_MODEL_PATH=<path> node test-baseball-actors.mjs
//
// Stage 2/3 fill poses.js's CLIPS.Swing/Miss/Set/Pitch keys; until then those two marks SKIP too,
// on purpose - poses.js ships stage 1 with every clip's `keys` empty (see its own header).
import { existsSync } from 'node:fs';
import { readGlb, summarize } from './glb-info.mjs';
import { RIG, RIG_REQUIRED } from './baseball/js/rig.js';
import { CLIPS, buildClip } from './baseball/js/poses.js';
import * as THREE from './baseball/js/vendor/three.module.min.js';

let failed = 0;
const ok = (label) => console.log(`ok    ${label}`);
const fail = (label, why) => { failed++; console.log(`FAIL  ${label}: ${why}`); };
const skipLine = (label, why) => console.log(`SKIP  ${label}: ${why}`);

const args = process.argv.slice(2);
const modelArgIdx = args.indexOf('--model');
const MODEL_PATH = (modelArgIdx !== -1 && args[modelArgIdx + 1]) || process.env.BB_MODEL_PATH || 'baseball/models/player.glb';
// section 2.2 (docs/BASEBALL-3D-BUILD.md) - filled in once Matt picks the model. Until then this
// stays null and the one check that needs it SKIPs.
const SHIRT_MATERIAL = null;

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

    if (SHIRT_MATERIAL) {
      if (s.materials.includes(SHIRT_MATERIAL)) ok(`shirt material "${SHIRT_MATERIAL}" exists`);
      else fail('shirt material', `"${SHIRT_MATERIAL}" not in [${s.materials.join(', ')}]`);
    } else {
      skipLine('shirt material check', 'section 2.2 SHIRT MATERIAL not filled yet');
    }
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

// CLIPS.Swing / CLIPS.Pitch marks: only assert once a stage has authored real keys (stage 2 for
// Swing/Miss, stage 3 for Set/Pitch) - poses.js ships stage 1 with every clip's keys EMPTY on
// purpose (see its own header), so asserting a mark against an empty key list would always fail
// for a reason that has nothing to do with this stage.
for (const name of ['Swing', 'Pitch']) {
  const def = CLIPS[name];
  if (!def.keys.length) { skipLine(`CLIPS.${name}.mark`, 'keys not authored yet (stage 2 for Swing, stage 3 for Pitch)'); continue; }
  const lastT = def.keys[def.keys.length - 1].t;
  if (def.mark != null && def.mark >= 0 && def.mark <= lastT) ok(`CLIPS.${name}.mark (${def.mark}) inside [0, ${lastT}]`);
  else fail(`CLIPS.${name}.mark`, `${def.mark} not inside [0, ${lastT}]`);
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
    const { Actors } = await import('/baseball/js/actors.js');
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
    actors.dispose();
    const canvasGoneAfterDispose = !document.querySelector('canvas.bb-actor-canvas');
    const rendererGone = actors.renderer === null;
    wrap.remove();
    return { hasCanvas, alpha, canvasGoneAfterDispose, rendererGone };
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
}

await runChromiumHalf();

console.log(failed ? `\n${failed} FAILED (test-baseball-actors.mjs)` : '\ntest-baseball-actors.mjs: all checks passed');
process.exit(failed ? 1 : 0);
