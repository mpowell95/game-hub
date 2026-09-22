import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

await page.addInitScript(() => {
  try {
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Tester', emoji: '⛳', code: 'ABCDE' }));
  } catch {}
});

await page.goto('http://localhost:8125/hole-editor/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('Red Mesa load errors:', errors.length);
errors.forEach((e) => console.log(' -', e));

// Click the tile with Decor / Bench label if present
const paletteText = await page.locator('#he-palette').innerText().catch(() => '');
console.log('Has "Bench" tile:', paletteText.includes('Bench'));
console.log('Has "Swamp" tile:', paletteText.includes('Swamp'));
console.log('Has "Trees" subhead:', paletteText.includes('Trees'));
console.log('Has "Rocks" subhead:', paletteText.includes('Rocks'));
console.log('Has "Stands" subhead:', paletteText.includes('Stands'));

await page.screenshot({ path: '/tmp/claude-0/-home-user-game-hub/740f2466-9be2-5290-a608-37426dfdd1f1/scratchpad/redmesa.png' });

// Now the custom course
errors.length = 0;
await page.goto('http://localhost:8125/hole-editor/?course=new', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('Custom course load errors:', errors.length);
errors.forEach((e) => console.log(' -', e));
const paletteText2 = await page.locator('#he-palette').innerText().catch(() => '');
console.log('Custom: has "Sentinel" tile:', paletteText2.includes('Sentinel') || paletteText2.includes('sentinel'));
console.log('Custom: has "Willow" tile:', paletteText2.toLowerCase().includes('willow'));
console.log('Custom: has "Log" tile:', paletteText2.toLowerCase().includes('log'));

await page.screenshot({ path: '/tmp/claude-0/-home-user-game-hub/740f2466-9be2-5290-a608-37426dfdd1f1/scratchpad/custom.png' });

await browser.close();
