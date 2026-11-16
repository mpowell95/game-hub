// MOCKUP PROTOTYPE SHOTS (2026-11-16, Ball Run UX review). Dev only.
// Renders the same seed + z with the render.js cues off (before) and on (after), at 402x874, DPR 1,
// JPEG q85, into OUT (default: ./.visual-out/ballrun-ux). Needs `node server.mjs` on :8123.
//   node tools/ballrun-ux/shots.cjs [outDir] [only-name-substring]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || path.join(process.cwd(), '.visual-out', 'ballrun-ux');
const ONLY = process.argv[3] || '';
fs.mkdirSync(OUT, { recursive: true });

// Each shot: seed, difficulty, which event (kind + nth on the track), distance before it (dz < 0 =
// past its start), optional fixed lateral.
const SHOTS = [
  // Split void (a deadly hole)
  { name: 'split-far', seed: 2, ev: 'voidOpen', n: 0, dz: 45 },
  { name: 'split-mid', seed: 2, ev: 'voidOpen', n: 0, dz: 22 },
  { name: 'split-close', seed: 2, ev: 'voidOpen', n: 0, dz: 6 },
  { name: 'split-in', seed: 2, ev: 'voidOpen', n: 0, dz: -14 },
  // Plain flat jump (gap you are meant to fly)
  { name: 'jump-flat-far', seed: 7, ev: 'jump', n: 0, dz: 45 },
  { name: 'jump-flat-mid', seed: 7, ev: 'jump', n: 0, dz: 22 },
  { name: 'jump-flat-close', seed: 7, ev: 'jump', n: 0, dz: 8 },
  // Drop (landing 2 lower)
  { name: 'drop-far', seed: 6, ev: 'jump', n: 0, dz: 45 },
  { name: 'drop-mid', seed: 6, ev: 'jump', n: 0, dz: 22 },
  { name: 'drop-close', seed: 6, ev: 'jump', n: 0, dz: 8 },
  { name: 'drop-after', seed: 6, ev: 'jump', n: 0, dz: -9 },
  // Rise (landing 2 higher, longer gap)
  { name: 'rise-far', seed: 3, ev: 'jump', n: 0, dz: 45 },
  { name: 'rise-mid', seed: 3, ev: 'jump', n: 0, dz: 22 },
  { name: 'rise-close', seed: 3, ev: 'jump', n: 0, dz: 8 },
  // Offset + narrow pad
  { name: 'offset-mid', seed: 11, ev: 'jump', n: 1, dz: 22 },
  { name: 'offset-close', seed: 11, ev: 'jump', n: 1, dz: 8 },
  // Split landing pad
  { name: 'splitpad-mid', seed: 2, ev: 'jump', n: 0, dz: 22 },
  { name: 'splitpad-close', seed: 2, ev: 'jump', n: 0, dz: 8 },
  { name: 'splitpad-air', seed: 2, ev: 'jump', n: 0, dz: -2 },
  // Obstacle row, tunnel, pickups
  { name: 'obstacles', seed: 2, ev: 'obst', n: 0, dz: 22 },
  { name: 'split-obstacles', seed: 4, ev: 'voidOpen', n: 0, dz: -4 },
  { name: 'tunnel', seed: 2, ev: 'tunnel', n: 0, dz: 18 },
  { name: 'heart', seed: 1, ev: 'life', n: 0, dz: 14 },
  { name: 'orb', seed: 1, ev: 'orb', n: 1, dz: 12 },
  // Optional higher camera (UX_CAM_*), on top of every other cue
  { name: 'cam-drop-close', seed: 6, ev: 'jump', n: 0, dz: 8, cam: true },
  { name: 'cam-split-far', seed: 2, ev: 'voidOpen', n: 0, dz: 45, cam: true },
  { name: 'cam-rise-far', seed: 3, ev: 'jump', n: 0, dz: 45, cam: true },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', playerId: 'DREG5', opponents: [] }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto((process.env.BASE || 'http://localhost:8123') + '/tools/ballrun-ux/harness.html');
  await page.waitForFunction(() => window.__ready === true);
  for (const s of SHOTS) {
    if (ONLY && !s.name.includes(ONLY)) continue;
    for (const ux of [0, 1]) {
      const info = await page.evaluate(({ s, ux }) => {
        H.init(s.seed, s.diff || 'medium', ux ? (s.cam ? { cam: true } : 1) : 0);
        const evs = H.events(1400).filter((e) => e.k === s.ev);
        const e = evs[s.n];
        if (!e) return { err: 'no event ' + s.ev + ' #' + s.n };
        const r = H.advanceTo(e.z - s.dz);
        if (s.lat != null) H.setLateral(s.lat);
        H.draw();
        return { e, r };
      }, { s, ux });
      if (info.err) { console.log(s.name, info.err); continue; }
      const file = path.join(OUT, `${s.name}-${ux ? 'after' : 'before'}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
      console.log(file, JSON.stringify(info));
    }
  }
  await browser.close();
})();
