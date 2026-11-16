// MOCKUP PROTOTYPE SHOTS (2026-11-16, Ball Run UX review). Dev only.
// The real Ball Run page (setup, help pages, HUD, game over) at 402x874, DPR 1, profile test1 /
// DREG5, sync off. Pass ?uxproto=1 with UX=1 to see the render cues in a live run.
//   BASE=http://localhost:8123 node tools/ballrun-ux/ui-shots.cjs <outDir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || path.join(process.cwd(), '.visual-out', 'ballrun-ux');
const BASE = process.env.BASE || 'http://localhost:8123';
const UX = process.env.UX === '1';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', playerId: 'DREG5', opponents: [] }));
      localStorage.setItem('ballrun.map', 'orbital');
      localStorage.setItem('ballrun.difficulty', 'medium');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const shot = async (name) => {
    const f = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
    console.log(f);
  };
  await page.goto(`${BASE}/ball-run/${UX ? '?uxproto=1' : ''}`);
  await page.waitForSelector('.br-root');
  if (UX) {
    // MOCKUP CSS (not in ball-run.css): HUD and game-over numbers at the hub's text floor (17px body,
    // near white), and the setup card centred below the floating Hub button.
    await page.addStyleTag({ content: `
      .br-root .br-setup { min-height: 100%; box-sizing: border-box; justify-content: center; padding-top: max(54px, var(--gh-st, env(safe-area-inset-top))); }
      .br-root .br-hud-distance, .br-root .br-hud-orbs { font-size: 17px; color: #eef0ff; font-weight: 800; }
      .br-root .br-orb-dot { width: 12px; height: 12px; }
      .br-root .br-hud-score { font-size: 2rem; }
      .br-root .br-go-distance { font-size: 17px; color: #eef0ff; }
      .br-root .br-help-text { font-size: 17px; }
    ` });
  }
  await page.waitForTimeout(800);
  // First open auto-opens the how-to pager.
  if (await page.isVisible('.br-help-overlay')) {
    for (let i = 1; i <= 4; i++) {
      await shot(`ui-help-${i}`);
      if (i < 4) await page.click('[data-action="help-next"]');
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
  // FPS sample under SwiftShader (software GL; NOT a phone number, only a relative cost check).
  await browser.close();
})();
