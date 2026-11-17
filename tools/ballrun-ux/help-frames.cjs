// Ball Run How to play pictures (2026-11-17, Matt: "the how to play is atrocious. please improve.").
// Real frames from the game renderer with cues on, cropped to the help picture box (360x450 CSS, 4:5) at 2x,
// saved as JPEG (<= 40 KB) into ball-run/img/help/, plus each page's overlay target in box coordinates
// (printed as JSON; ui.js HELP_PICS holds them). Dev server required:
//   BASE=http://localhost:8123 node tools/ballrun-ux/help-frames.cjs [onlyName]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8123';
const ONLY = process.argv[2] || '';
const OUT = path.join(__dirname, '..', '..', 'ball-run', 'img', 'help');
const TMP = path.join(require('os').tmpdir(), 'ballrun-help-frames');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const BOX = { w: 360, h: 450 };
const MAX_BYTES = 40 * 1024;

// ev: the event to stop before (kind + nth), dz: units before its start, lat: the ball's lateral
// (null = autopilot), top: the crop's top edge in the 402x874 frame, target: what the arrow points at.
const PAGES = [
  { name: 'steer-classic', map: 'classic', seed: 2, ev: 'obst', n: 0, dz: 34, lat: 0, top: 330 },
  { name: 'blocks-classic', map: 'classic', seed: 2, ev: 'obst', n: 0, dz: 11, top: 300, target: 'obst' },
  { name: 'edge-classic', map: 'classic', seed: 2, ev: 'obst', n: 0, dz: 30, lat: -2.05, top: 300, target: 'edge' },
  { name: 'tunnel-classic', map: 'classic', seed: 5, ev: 'tunnel', n: 0, dz: 10, top: 300, target: 'tunnel' },
  { name: 'steer-orbital', map: 'orbital', seed: 2, ev: 'obst', n: 0, dz: 34, lat: 0, top: 330 },
  { name: 'blocks-orbital', map: 'orbital', seed: 2, ev: 'obst', n: 0, dz: 11, top: 300, target: 'obst' },
  { name: 'edge-orbital', map: 'orbital', seed: 2, ev: 'obst', n: 0, dz: 30, lat: -2.05, top: 300, target: 'edge' },
  { name: 'tunnel-orbital', map: 'orbital', seed: 2, ev: 'tunnel', n: 0, dz: 9, lat: 0, top: 300, target: 'tunnel' },
  { name: 'hole', map: 'orbital', seed: 2, ev: 'voidOpen', n: 0, dz: 4, top: 300, target: 'void' },
  { name: 'jump', map: 'orbital', seed: 7, ev: 'jump', n: 0, dz: 9, top: 300, target: 'land' },
  { name: 'droprise', map: 'orbital', seed: 6, ev: 'jump', n: 0, dz: 10, top: 300, target: 'sign' },
  { name: 'pickups', map: 'orbital', seed: 12, ev: 'life', n: 0, dz: 9, lat: -0.4, top: 300, target: 'life' },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(BASE + '/tools/ballrun-ux/harness.html');
  await page.waitForFunction(() => window.__ready === true);
  const targets = {};
  for (const p of PAGES) {
    if (ONLY && !p.name.includes(ONLY)) continue;
    const info = await page.evaluate((p) => {
      H.init(p.seed, 'medium', 1, p.map);
      const e = H.events(1400).filter((x) => x.k === p.ev)[p.n];
      H.advanceTo(e.z - p.dz);
      if (p.lat != null) H.setLateral(p.lat);
      H.draw();
      const st = H.state();
      let t = null;
      if (p.target === 'obst') { const g = H.seg('obst'); const c = g.cubes.slice().sort((a, b) => Math.abs(a) - Math.abs(b))[0]; t = H.project((g.z0 + g.z1) / 2, c, 1.6); }
      else if (p.target === 'edge') { t = H.project(st.z + 5, -2.5, 0); }
      else if (p.target === 'tunnel') { const g = H.seg('tunnel'); t = H.project(g.z0, 0, 1.8); }
      else if (p.target === 'void') { const g = H.seg('void', 3); t = H.project(g.z0, g.wc + g.vc, 0); }
      else if (p.target === 'land') { const g = H.seg('land'); t = H.project(g.z0 + 1, g.wc, g.y); }
      else if (p.target === 'sign') { const g = H.seg('gap'); t = H.project(g.z0, 2.5 + 0.7, 2.2); }
      else if (p.target === 'life') { const g = H.seg('life'); t = H.project((g.z0 + g.z1) / 2, g.wc + g.pick, 0.9); }
      const ball = H.project(st.z, st.lat, 0.5);
      return { t, ball, st };
    }, p);
    const raw = path.join(TMP, p.name + '.png');
    await page.screenshot({ path: raw, clip: { x: 21, y: p.top, width: BOX.w, height: BOX.h } });
    const out = path.join(OUT, p.name + '.jpg');
    let q = 84;
    for (;;) {
      execFileSync('convert', [raw, '-strip', '-sampling-factor', '4:2:0', '-quality', String(q), out]);
      if (fs.statSync(out).size <= MAX_BYTES || q <= 40) break;
      q -= 4;
    }
    const rel = (pt) => pt && { x: Math.round(pt.x - 21), y: Math.round(pt.y - p.top) };
    targets[p.name] = { target: rel(info.t), ball: rel(info.ball) };
    console.log(p.name, fs.statSync(out).size, 'bytes q' + q, JSON.stringify(targets[p.name]));
  }
  console.log(JSON.stringify(targets));
  await browser.close();
})();
