import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().includes('[decor]')) console.log('LOG:', m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Tester', emoji: '⛳', code: 'ABCDE' })); } catch {} });
await page.goto('http://localhost:8125/hole-editor/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Place a swamp
await page.click('.he-tile[data-item="water-swamp"]');
await page.click('#he-canvas', { position: { x: 400, y: 300 } });
await page.waitForTimeout(200);
const water = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.water);
console.log('water entries:', JSON.stringify(water));

// Place a bench
await page.click('.he-tile[data-item="decor-bench"]');
await page.click('#he-canvas', { position: { x: 380, y: 350 } });
await page.waitForTimeout(200);
const decor = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.decor);
console.log('decor entries:', JSON.stringify(decor));

console.log('page errors:', errors.filter((e) => !e.includes('404')));
await browser.close();
