import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => { try { localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Tester', emoji: '⛳', code: 'ABCDE' })); } catch {} });
await page.goto('http://localhost:8125/hole-editor/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Simulate the engine branch's main.js wiring: getWaterKind/getDecorKind + addDecor mutator.
await page.evaluate(() => {
  const ops = window.__he.editorCanvas.ops;
  ops.getWaterKind = () => 'swamp';
  ops.getDecorKind = () => 'sign';
  ops.mutators.addDecor = (spec, kind, x, y) => ({ ...spec, decor: [...(spec.decor || []), { x, y, kind, rot: 0 }] });
  ops.mutators.moveObject = (spec, group, index, fields) => {
    if (group !== 'decor') return spec;
    const list = spec.decor.map((d, i) => (i === index ? { ...d, ...fields } : d));
    return { ...spec, decor: list };
  };
});

await page.click('.he-tile[data-item="water-swamp"]');
await page.click('#he-canvas', { position: { x: 400, y: 300 } });
await page.waitForTimeout(200);
const water = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.water);
console.log('water kind on new entry:', water[water.length - 1].kind);

await page.click('.he-tile[data-item="decor-sign"]');
await page.click('#he-canvas', { position: { x: 380, y: 350 } });
await page.waitForTimeout(200);
let decor = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.decor);
console.log('decor after place:', JSON.stringify(decor));

// Drag it
const box = await page.locator('#he-canvas').boundingBox();
await page.mouse.move(box.x + 380, box.y + 350);
await page.mouse.down();
await page.mouse.move(box.x + 420, box.y + 380, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(200);
decor = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.decor);
console.log('decor after drag:', JSON.stringify(decor));

// Delete it (select then Delete key)
await page.evaluate(() => window.__he.editorCanvas.setSelection({ group: 'decor', index: 0 }));
await page.keyboard.press('Delete');
await page.waitForTimeout(200);
decor = await page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec.decor);
console.log('decor after delete:', JSON.stringify(decor));

await browser.close();
