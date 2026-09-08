// measure-hole-strip.mjs - DOES EVERY HOLE IN GOLF'S SETUP STRIP ACTUALLY PAINT?
//
// The setup screen shows a picture of every hole, left to right (Matt, 2026-09-08: "get a photo of
// every hole... and line them up left to right so you can see every hole"). Eighteen `buildMap`
// calls is far too much to pay for a menu - one hole rasterises to roughly 264 x 1128 px - so a
// thumbnail is only built when it scrolls into view, and the big map is dropped the moment it has
// been downscaled.
//
// THAT LAZINESS IS EXACTLY THE BUG CLASS `docs/BUILDING-A-GAME.md` PART 0 NAMES: a placeholder
// whose path back to the truth never fires is Skeeball's "empty machine box", and a blank canvas
// looks identical to a canvas nobody has scrolled to yet. Reading `ui.js` cannot tell them apart;
// only driving the real strip in a real browser can.
//
// So this COUNTS, the way `measure-gallery.mjs` counts Skeeball's gallery: how many thumbnails
// carry real pixels on open, after a scroll to the end, and after a course switch. A count
// transfers to a phone in a way a millisecond in this SwiftShader container does not.
//
// Needs the dev server up (`node server.mjs`). ~10 s.
//
//   node measure-hole-strip.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.addInitScript(() => {
  localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Visual Test', emoji: '🐙', color: '#1F5FA8', opponents: [] }));
  localStorage.setItem('gamehub.lang.v1', 'en');
});
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:8123/golf/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

const painted = () => p.evaluate(() => {
  const arts = [...document.querySelectorAll('[data-hole-art]')];
  // "painted" = the canvas has non-uniform pixels, i.e. a real hole, not a flat placeholder.
  let real = 0;
  for (const cv of arts) {
    const c = cv.getContext('2d');
    if (!cv.width) continue;
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    const first = [d[0], d[1], d[2]].join(); let varied = false;
    for (let i = 4; i < d.length; i += 400) { if ([d[i], d[i+1], d[i+2]].join() !== first) { varied = true; break; } }
    if (varied) real++;
  }
  return { total: arts.length, real, flagged: arts.filter(c => c.dataset.painted).length };
});
console.log('on open:', JSON.stringify(await painted()));
const t0 = Date.now();
await p.evaluate(async () => {
  const s = document.querySelector('.gf-strip');
  for (let x = 0; x <= s.scrollWidth; x += 120) { s.scrollLeft = x; await new Promise(r => requestAnimationFrame(r)); }
  await new Promise(r => setTimeout(r, 600));
});
console.log('after scrolling to the end:', JSON.stringify(await painted()), `(${Date.now() - t0} ms)`);
await p.evaluate(() => document.querySelector('.gf-strip').scrollLeft = 0);
await p.waitForTimeout(200);
await p.locator('.gf-strip').screenshot({ path: '.visual-out/golf-strip-start.png' });
await p.evaluate(() => { const s = document.querySelector('.gf-strip'); s.scrollLeft = s.scrollWidth; });
await p.waitForTimeout(400);
await p.locator('.gf-strip').screenshot({ path: '.visual-out/golf-strip-end.png' });
// and the same for Red Mesa, to prove the cache is keyed per course
await p.evaluate(() => [...document.querySelectorAll('[data-course]')].find(b => b.dataset.course === 'redmesa').click());
await p.waitForTimeout(900);
console.log('after switching to Red Mesa:', JSON.stringify(await painted()));
await p.locator('.gf-strip').screenshot({ path: '.visual-out/golf-strip-redmesa.png' });
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
