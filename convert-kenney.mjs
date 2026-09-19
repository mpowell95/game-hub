// convert-kenney.mjs - builds baseball/models/player.glb (+ skins/) from Kenney's "Animated
// Characters Protagonists" pack (CC0; the pack's own License.txt is beside the zip in
// reference/baseball/models/kenney/). Matt's pick, 2026-09-19, over the robot / KayKit / Quaternius
// candidates: "Let's use this pack then. The Kenney."
//
// Why a converter exists at all: the pack ships FBX only (one body mesh, characterMedium.fbx, plus
// idle/run/jump.fbx animation files and four 1024x1024 skin textures). The game loads glTF, and
// there is no Blender in the cloud container - so this drives three.js's own FBXLoader and
// GLTFExporter in headless Chromium, which is the same code that will draw the figure in the game.
// What it writes, deliberately:
//   baseball/models/player.glb    the body mesh + its 58-bone skeleton + ONE clip, "Idle" (the
//                                 pack's own; run/jump are useless here), NO texture embedded: the
//                                 skin is applied at runtime so team colours can be colour-keyed
//                                 onto it (docs/BASEBALL-3D-BUILD.md section 2.2).
//   baseball/models/skins/*.png   the four skins, byte for byte from the zip.
// Re-run after any change here or to the zip; commit the outputs. ~20 s.
//   node convert-kenney.mjs [--zip reference/baseball/models/kenney/kenney_animated-characters-protagonists.zip]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const argZip = process.argv.indexOf('--zip');
const ZIP = argZip > 0 ? process.argv[argZip + 1] : path.join(ROOT, 'reference/baseball/models/kenney/kenney_animated-characters-protagonists.zip');
const OUT_GLB = path.join(ROOT, 'baseball/models/player.glb');
const OUT_SKINS = path.join(ROOT, 'baseball/models/skins');
const VENDOR = path.join(ROOT, 'baseball/js/vendor');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kenney-'));
execFileSync('unzip', ['-q', '-o', ZIP, '-d', work]);
for (const f of ['Model/characterMedium.fbx', 'Animations/idle.fbx', 'Skins/skaterMaleA.png']) {
  if (!fs.existsSync(path.join(work, f))) { console.error(`zip is missing ${f}`); process.exit(1); }
}

// The browser needs FBXLoader + fflate + NURBS helpers + GLTFExporter, none of which the game
// vendors (they are conversion-time only). Fetched into the work dir from the same three release
// the game uses (0.185.0), imports rewritten to the game's own vendored core.
const jsd = 'https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/';
const extras = { 'FBXLoader.js': 'loaders/FBXLoader.js', 'GLTFExporter.js': 'exporters/GLTFExporter.js', 'fflate.module.js': 'libs/fflate.module.js', 'NURBSCurve.js': 'curves/NURBSCurve.js', 'NURBSUtils.js': 'curves/NURBSUtils.js' };
const vdir = path.join(work, 'vendor'); fs.mkdirSync(vdir);
for (const f of ['three.core.min.js', 'three.module.min.js', 'BufferGeometryUtils.js']) fs.copyFileSync(path.join(VENDOR, f), path.join(vdir, f));
for (const [name, rel] of Object.entries(extras)) {
  const res = await fetch(jsd + rel);
  if (!res.ok) { console.error(`fetch ${rel}: ${res.status}`); process.exit(1); }
  let src = await res.text();
  src = src.replace(/from 'three'/g, "from './three.module.min.js'").replace(/from '\.\.\/[a-z]+\/([A-Za-z.]+)'/g, "from './$1'");
  fs.writeFileSync(path.join(vdir, name), src);
}

fs.writeFileSync(path.join(work, 'convert.html'), `<!doctype html><html><body><script type="module">
import * as THREE from './vendor/three.module.min.js';
import { FBXLoader } from './vendor/FBXLoader.js';
import { GLTFExporter } from './vendor/GLTFExporter.js';
const out = { err: null };
try {
  const loader = new FBXLoader();
  const model = await loader.loadAsync('/Model/characterMedium.fbx');
  model.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ name: 'Skin', color: 0xffffff, roughness: 0.9, metalness: 0 }); o.name = 'characterMedium'; } });
  const idle = await loader.loadAsync('/Animations/idle.fbx');
  const clip = idle.animations.find((a) => /idle/i.test(a.name)) || idle.animations[0];
  clip.name = 'Idle';
  const box = new THREE.Box3().setFromObject(model);
  out.height = box.max.y - box.min.y; out.minY = box.min.y;
  out.bones = []; model.traverse((o) => { if (o.isBone) out.bones.push(o.name); });
  const glb = await new GLTFExporter().parseAsync(model, { binary: true, animations: [clip] });
  out.bytes = glb.byteLength;
  let bin = ''; const u8 = new Uint8Array(glb); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  out.b64 = btoa(bin);
} catch (e) { out.err = String(e && e.stack || e); }
window.__out = out;
</script></body></html>`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.fbx': 'application/octet-stream' };
const server = http.createServer((req, res) => { const p = path.join(work, decodeURIComponent(req.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage();
const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('ERR ' + e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/convert.html`);
await page.waitForFunction(() => window.__out, null, { timeout: 120000 });
const out = await page.evaluate(() => window.__out);
await browser.close(); server.close();
if (out.err) { console.error('conversion failed:', out.err, logs.join('\n')); process.exit(1); }

fs.mkdirSync(path.dirname(OUT_GLB), { recursive: true });
fs.writeFileSync(OUT_GLB, Buffer.from(out.b64, 'base64'));
fs.mkdirSync(OUT_SKINS, { recursive: true });
const skins = fs.readdirSync(path.join(work, 'Skins')).filter((f) => f.endsWith('.png')).sort();
for (const f of skins) fs.copyFileSync(path.join(work, 'Skins', f), path.join(OUT_SKINS, f));
console.log(`ok   ${path.relative(ROOT, OUT_GLB)}: ${out.bytes} bytes, ${out.bones.length} bones, height ${out.height.toFixed(3)} (minY ${out.minY.toFixed(3)}), clip Idle`);
console.log(`ok   skins: ${skins.join(', ')} -> ${path.relative(ROOT, OUT_SKINS)}/`);
fs.rmSync(work, { recursive: true, force: true });
