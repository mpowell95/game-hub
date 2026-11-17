// Ball Run screen shots (2026-11-16, docs/BALL-RUN-UX-REVIEW.md). Dev only.
// The real Ball Run page (setup, help pages, HUD, game over) at 402x874, DPR 1, profile test1 /
// DREG5, sync off. ADMIN=1 marks the browser an admin device (gamehub.adminDevice.v1 = '1'): cues on.
//   BASE=http://localhost:8123 node tools/ballrun-ux/ui-shots.cjs <outDir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || path.join(process.cwd(), '.visual-out', 'ballrun-ux');
const BASE = process.env.BASE || 'http://localhost:8123';
const ADMIN = process.env.ADMIN === '1';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript((admin) => {
    try {
      if (admin) localStorage.setItem('gamehub.adminDevice.v1', '1');
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', playerId: 'DREG5', opponents: [] }));
      localStorage.setItem('ballrun.map', 'orbital');
      localStorage.setItem('ballrun.difficulty', 'medium');
    } catch {}
  }, ADMIN);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const shot = async (name) => {
    const f = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
    console.log(f);
  };
  await page.goto(`${BASE}/ball-run/`);
  await page.waitForSelector('.br-root');
  await page.waitForTimeout(800);
  // First open auto-opens the how-to pager.
  if (await page.isVisible('.br-help-overlay')) {
    const pages = await page.$$eval('.br-help-dots .br-dot', (d) => d.length);
    for (let i = 1; i <= pages; i++) {
      await shot(`ui-help-${i}`);
      if (i < pages) await page.click('[data-action="help-next"]');
      await page.waitForTimeout(200);
    }
    await page.click('[data-action="help-ok"]');
  }
  await page.waitForTimeout(300);
  await shot('ui-setup');
  await page.click('[data-role="play"]');
  await page.waitForTimeout(700);
  await shot('ui-hud');
  // Unsteered: wait for the run to end on its own.
  await page.waitForSelector('[data-role="gameover"]:not([hidden])', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot('ui-gameover');
  await browser.close();
})();
