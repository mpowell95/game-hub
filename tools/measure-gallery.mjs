// Scratch harness (not committed): counts WebGL machine-picture renders per mount, per swipe and
// on re-entry. Counts, not milliseconds - this browser is on SwiftShader, so the timings here say
// nothing about a phone, but "how many times is a scene built and read back" transfers exactly.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const srv = spawn('node', ['server.mjs'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await b.newPage({ viewport: { width: 393, height: 852 } });

await page.addInitScript(() => {
  localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Measure', emoji: '🎯', color: '#1F5FA8' }));
  localStorage.setItem('gamehub.stats', JSON.stringify({ v: 1, games: {} }));
  // BEFORE any module runs, or the first mount's renders are missed.
  window.__renders = 0;
  const orig = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { window.__renders++; return orig.apply(this, a); };
});
await page.goto('http://localhost:8123/skeeball/', { waitUntil: 'domcontentloaded' });
const mark = () => page.evaluate(() => window.__renders | 0);
const wait = (ms) => page.waitForTimeout(ms);

await page.waitForSelector('.sk-slide', { timeout: 15000 });
// Wait for the SELECTED machine's picture to actually land before marking - under SwiftShader one
// render takes seconds, so a fixed delay would time the browser rather than the code.
await page.waitForFunction(
  () => [...document.querySelectorAll('img[data-machine], img[data-machine-locked]')]
    .some((e) => /^data:image\/jpeg/.test(e.src)), null, { timeout: 60000 });
const afterFirstPaint = await mark();
await wait(30000);                       // let the idle prewarm run
const afterIdle = await mark();

// swipe to the next machine, exactly as the carousel does
const swipeNext = async () => {
  await page.evaluate(() => {
    const car = document.querySelector('[data-role="car"]');
    car.scrollLeft += car.clientWidth;
    car.dispatchEvent(new Event('scroll'));
  });
  await wait(2500);
};
const before1 = await mark(); await swipeNext(); const swipe1 = (await mark()) - before1;
await wait(20000);
const before2 = await mark(); await swipeNext(); const swipe2 = (await mark()) - before2;
await wait(20000);

// leave and come back, the 25s moment on Matt's recording
const beforeRemount = await mark();
await page.evaluate(async () => {
  const m = await import('/skeeball/js/ui.js');
  m.destroy();
  m.init(document.getElementById('skeeball') || document.body.querySelector('#skeeball') || document.body);
});
await wait(4000);
const remount = (await mark()) - beforeRemount;

// and what the player actually sees: how many slides hold a real picture
const painted = await page.evaluate(() => {
  const all = [...document.querySelectorAll('img[data-machine], img[data-machine-locked]')];
  return { total: all.length, drawn: all.filter((e) => /^data:image\/jpeg/.test(e.src)).length };
});
console.log(JSON.stringify({ afterFirstPaint, afterIdle, swipe1, swipe2, remount, painted }, null, 2));
await b.close(); srv.kill();
