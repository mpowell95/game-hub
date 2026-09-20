// render-actor.mjs - the pose-authoring loop's instrument (docs/BASEBALL-3D-BUILD.md section 3.8).
// Opens a minimal page that imports actors.js directly, loads a given glb, places one actor at a
// given height, plays a clip to a given time, and writes a PNG. This is how a pose in poses.js is
// checked against the sprite it must match - by rendering, never by imagination.
//
// Needs `node server.mjs` up (repo root, so actors.js's own relative imports resolve, and so
// `--beside` can read the shipped reference/baseball/*.png over HTTP). A `--model` given as a
// local path (the scratchpad scaffold, or a not-yet-committed player.glb) is served by a small
// throwaway static server this script starts itself, since it usually lives outside the repo the
// dev server serves.
//
//   node render-actor.mjs --model <path-or-url> --clip Swing --t 0.30 --height 400 --facing 80 --out x.png
//   node render-actor.mjs --model ... --clip Swing --sheet 0,0.1,0.2,0.3,0.4,0.5,0.6 \
//     --beside reference/baseball/batter-home-3.png,reference/baseball/batter-home-4.png --out sheet.png
//
// --sheet renders several times and lays them in one row; --beside puts the named sprite frames
// under them, scaled to the same height, so a silhouette comparison is one picture, not several.
// --role batter|pitcher|catcher|umpire (default batter) picks which actor is placed and played -
// only the batter has a bat attached (_attachBat in actors.js), which matters for Set/Pitch/Crouch.
// --side home|away (default home, stage 3) calls setBatter/setPitcher with that side first, for a
// recolour check; anchor/heightPx are the same square this script already places the actor at.
// --beside paths are resolved against the dev server root (so a repo-relative path like
// reference/baseball/batter-home-3.png just works); an absolute local path is served the same way
// as --model. Chromium flags: ['--no-sandbox', '--use-gl=swiftshader']; preserveDrawingBuffer on;
// read back via canvas.toDataURL().
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, basename, dirname, resolve } from 'node:path';

const BASE = 'http://localhost:8123';
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const has = (name) => args.includes(`--${name}`);

const modelArg = opt('model');
const clipName = opt('clip', 'Idle');
const tArg = opt('t', '0');
const sheetArg = opt('sheet');
const besideArg = opt('beside');
const height = Number(opt('height', '400'));
const facingDeg = Number(opt('facing', '0'));
const role = opt('role', 'batter');   // stage 3: 'pitcher' renders the pitcher actor (no bat attached)
const side = opt('side', 'home');     // stage 3: 'home' or 'away', for a recolour check
const out = opt('out');

if (!modelArg || !out) {
  console.error('usage: node render-actor.mjs --model <path-or-url> [--clip Idle] [--t 0] [--sheet t1,t2,...] [--beside a.png,b.png] [--height 400] [--facing 0] [--role batter|pitcher|catcher|umpire] [--side home|away|umpire] --out <file.png>');
  process.exit(2);
}

const MIME = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// A tiny throwaway static server for local files outside the repo (the scaffold, a --beside image
// given as an absolute path). Each file gets its own route so nothing outside the named files is
// exposed. The repo's own files (actors.js, its vendor/, reference/baseball/*) are read through the
// real dev server at BASE instead - this one exists only to bridge the gap.
const routes = new Map();  // '/local/<n>' -> absolute path
function addLocalRoute(absPath) {
  const n = routes.size;
  const route = `/local/${n}${extname(absPath)}`;
  routes.set(route, absPath);
  return route;
}
const localSrv = createServer((req, res) => {
  const abs = routes.get(req.url);
  if (!abs || !existsSync(abs)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  res.end(readFileSync(abs));
});
await new Promise((r) => localSrv.listen(0, '127.0.0.1', r));
const localPort = localSrv.address().port;
const localUrl = (route) => `http://127.0.0.1:${localPort}${route}`;

function resolveAsUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const abs = resolve(pathOrUrl);
  const repoRoot = resolve('.');
  if (abs.startsWith(repoRoot + '/') || abs === repoRoot) {
    // Inside the repo: the real dev server already serves it.
    return BASE + '/' + abs.slice(repoRoot.length + 1);
  }
  return localUrl(addLocalRoute(abs));
}

const modelUrl = resolveAsUrl(modelArg);
const besideUrls = besideArg ? besideArg.split(',').map((p) => resolveAsUrl(p.trim())) : [];
const sheetTimes = sheetArg ? sheetArg.split(',').map(Number) : [Number(tArg)];

try {
  const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error('bad status');
} catch {
  console.error(`dev server not reachable at ${BASE} - run: node server.mjs`);
  localSrv.close();
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error("playwright-core not installed - run this from the repo root ('node_modules/playwright-core' resolves there)");
  localSrv.close();
  process.exit(1);
}
const EXE = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page error]', e.message));

// Any page under BASE gives actors.js's own relative imports (./vendor/...) the right module URL.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { window.__bbTest = true; });   // preserveDrawingBuffer, for toDataURL readback

const frames = await page.evaluate(async ({ modelUrl, clipName, sheetTimes, height, facingDeg, role, side }) => {
  const { Actors } = await import('/baseball/js/actors.js');
  const THREE = await import('/baseball/js/vendor/three.module.min.js');
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed; left:0; top:0; width:${height + 40}px; height:${height + 40}px; background:transparent;`;
  document.body.appendChild(wrap);
  const actors = new Actors(wrap);
  const okGL = actors.initGL();
  if (!okGL) throw new Error('initGL() failed - no WebGL context (headless Chromium without --use-gl=swiftshader?)');
  await actors.load(modelUrl);
  const side_ = height + 40;
  actors.resize(side_, side_);
  // R1 (docs/BASEBALL-3D-BUILD.md section 9): actors.js is world-space now, so this script places
  // the figure at the world origin, 6 ft tall, and builds its OWN camera framing a 6 ft figure to
  // exactly `height` pixels of the square canvas. The game's three cameras are compositions of a
  // whole stadium; this one exists to compare ONE silhouette against a sprite frame, which is a
  // different job, so it is a plain head-on shot at the same fov.
  const FIG_FT = 6;
  const fov = 50;
  const dist = (FIG_FT * side_) / (height * 2 * Math.tan((fov / 2) * Math.PI / 180));
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
  cam.position.set(0, FIG_FT / 2, dist);
  cam.lookAt(0, FIG_FT / 2, 0);
  actors.camera = cam;
  // The setter (setBatter/setPitcher/setCatcher/setUmpire) recolours AND places in one call -
  // always going through it, never a bare place(), is what lets --side render a recolour too.
  const setter = role === 'pitcher' ? actors.setPitcher
    : role === 'catcher' ? actors.setCatcher
    : role === 'umpire' ? actors.setUmpire : actors.setBatter;
  await setter.call(actors, { side, pos: { x: 0, y: 0, z: 0 }, heightFt: FIG_FT, facingRad: facingDeg * Math.PI / 180 });
  const out = [];
  for (const t of sheetTimes) {
    actors.play(role, clipName);
    const a = actors.actors[role].actions[clipName];
    if (a) { a.time = t; a.paused = true; }
    actors.actors[role].mixer.update(0);
    actors.renderer.render(actors.scene, actors.camera);
    out.push(actors.canvas.toDataURL('image/png'));
  }
  actors.dispose();
  wrap.remove();
  return out;
}, { modelUrl, clipName, sheetTimes, height, facingDeg, role, side });

if (frames.some((f) => !f || f.length < 100)) {
  console.error('render produced no image data');
  await browser.close(); localSrv.close();
  process.exit(1);
}

// Composite the frame(s), and any --beside sprite references, into one row in a real 2D canvas -
// no node-side image library needed, the browser already decodes and draws PNGs.
const finalDataUrl = await page.evaluate(async ({ frames, besideUrls, height }) => {
  const cellW = height + 40, cellH = height + 40;
  const rows = besideUrls.length ? 2 : 1;
  const cv = document.createElement('canvas');
  cv.width = cellW * frames.length; cv.height = cellH * rows;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#20242c'; ctx.fillRect(0, 0, cv.width, cv.height);
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  for (let i = 0; i < frames.length; i++) {
    const im = await loadImg(frames[i]);
    ctx.drawImage(im, i * cellW, 0, cellW, cellH);
  }
  for (let i = 0; i < besideUrls.length; i++) {
    const im = await loadImg(besideUrls[i] || besideUrls[besideUrls.length - 1]);
    const s = height / im.naturalHeight;
    const w = im.naturalWidth * s;
    const x = (i % frames.length) * cellW + (cellW - w) / 2;
    ctx.drawImage(im, x, cellH + 20, w, height);
  }
  return cv.toDataURL('image/png');
}, { frames, besideUrls, height });

writeFileSync(out, Buffer.from(finalDataUrl.split(',')[1], 'base64'));
console.log(`wrote ${out} (${frames.length} frame${frames.length === 1 ? '' : 's'}${besideUrls.length ? `, ${besideUrls.length} reference row` : ''})`);

await browser.close();
localSrv.close();
