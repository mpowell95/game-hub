// test-hole-editor-mobile.mjs - the golf Course Creator ON A PHONE, driven with real touch
// (docs/HANDOFF-GOLF-COURSE-CREATOR-MOBILE.md, section 5). 390x844, hasTouch, isMobile; single
// taps through Playwright's touchscreen, drags / pinches / long presses through CDP
// Input.dispatchTouchEvent, which Chromium turns into pointer events with pointerType 'touch' -
// the same path a finger takes. test-hole-editor-ui.mjs stays the desktop no-regression proof;
// this file is the phone's. Grows one block per stage.
//
// Needs `node server.mjs` up (HOLE_EDITOR_URL to point elsewhere) and playwright-core + Chromium
// (CHROMIUM_PATH, or PLAYWRIGHT_BROWSERS_PATH); SKIPs cleanly without them. ~20 s.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { console.log('SKIP - playwright-core not installed'); process.exit(0); }
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', '']) {
      const p = rel ? join(base, d, rel) : join(base, d);
      try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}
const EXE = findChromium();
if (!EXE) { console.log('SKIP - no Chromium found'); process.exit(0); }
const URL = process.env.HOLE_EDITOR_URL || 'http://localhost:8123/hole-editor/';
try { await fetch(URL); } catch { console.log(`SKIP - ${URL} not reachable (run node server.mjs)`); process.exit(0); }

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('ok   ' + name); } else { fails.push(name); console.log('FAIL ' + name + (detail ? ' - ' + detail : '')); } };

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--headless=new'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
// Past the first-visit walkthrough redirect, and a course that is already named (the setup screen
// at 390 px is stage 4's).
await ctx.addInitScript(() => { try { localStorage.setItem('golf.holeEditor.tourOffered.v1', '1'); localStorage.setItem('golf.holeEditor.helpNudgeOff.v1', '1'); } catch { /* fine */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
await page.goto(`${URL}?course=new`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__he && window.__he.editorCanvas.camera);
if (await page.$('#he-setup')) { await page.fill('#he-setup-name', 'Phone Test'); await page.click('#he-setup-go'); }
await page.waitForTimeout(300);
const cdp = await ctx.newCDPSession(page);

const settle = () => page.waitForTimeout(250);
const spec = () => page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec);
const cam = () => page.evaluate(() => ({ ...window.__he.editorCanvas.camera }));
const toScreen = (x, y) => page.evaluate(([x, y]) => { const c = window.__he.editorCanvas; const cm = c.camera; const r = c.el.getBoundingClientRect(); const q = c.toScreen(x, y); return { x: r.x + q.x, y: r.y + q.y }; }, [x, y]);
const mapBox = () => page.evaluate(() => { const r = document.getElementById('he-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
async function drag(x0, y0, x1, y1, steps = 8) {
  await touch('touchStart', [[x0, y0]]);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await settle();
}
async function pinch(cx, cy, d0, d1, steps = 8) {
  await touch('touchStart', [[cx - d0 / 2, cy]]);
  await touch('touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
  for (let i = 1; i <= steps; i++) { const d = d0 + (d1 - d0) * i / steps; await touch('touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await settle();
}
async function longPress(x, y) { await touch('touchStart', [[x, y]]); await page.waitForTimeout(650); await touch('touchEnd', []); await settle(); }
const tap = async (x, y) => { await page.touchscreen.tap(x, y); await settle(); };
const tapEl = async (sel) => { const r = await page.locator(sel).first().boundingBox(); await tap(r.x + r.width / 2, r.y + r.height / 2); };

console.log('\n-- stage 1: layout --');
ok('the page does not scroll sideways at 390 px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('the desktop columns and holes bar are hidden', await page.evaluate(() => ['.he-left', '.he-right', '.he-bottom'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')));
ok('the hole picker bar is showing', await page.evaluate(() => getComputedStyle(document.getElementById('he-mbar')).display !== 'none'));
const mb = await mapBox();
ok('the map gets most of the screen (> 70% of the height)', mb.h > 844 * 0.7, `map ${Math.round(mb.h)} px tall`);
await tapEl('#he-m-tools');
ok('Tools unfolds the ribbon', await page.evaluate(() => document.getElementById('he-ribbon').classList.contains('is-open')));
await tapEl('#he-ribbon [data-tool="route"]');
ok('picking a tool in it folds it and switches tool', await page.evaluate(() => !document.getElementById('he-ribbon').classList.contains('is-open') && window.__he.editorCanvas.tool === 'route'));
await tapEl('#he-m-next');
ok('the next-hole arrow moves to hole 2', await page.evaluate(() => window.__he.doc.order.indexOf(window.__he.currentId) === 1 && document.getElementById('he-m-hole').value === window.__he.currentId));
await tapEl('#he-m-prev');

console.log('\n-- stage 2: touch --');
// Pick the fairway bunker from the Add sheet.
await tapEl('#he-m-add');
ok('+ Add opens the Add sheet', await page.evaluate(() => document.querySelector('.he-left').classList.contains('is-open')));
await page.locator('[data-item="bunker-fairway"]').scrollIntoViewIfNeeded();
await tapEl('[data-item="bunker-fairway"]');
ok('picking a tile closes the sheet and arms the Bunker tool', await page.evaluate(() => !document.querySelector('.he-left').classList.contains('is-open') && window.__he.editorCanvas.tool === 'bunker'));

// [KNOWN-BUG PROBE] a placement tool placed on pointerDOWN, so the first finger of a pinch dropped a bunker.
const nB0 = ((await spec()).bunkers || []).length;
const c0 = await cam();
await pinch(mb.x + mb.w / 2, mb.y + mb.h * 0.4, 80, 200);
const c1 = await cam();
ok('[KNOWN-BUG PROBE] a pinch with the Bunker tool places nothing', ((await spec()).bunkers || []).length === nB0);
ok('a pinch outwards zooms in', c1.ppy > c0.ppy * 1.5, `ppy ${c0.ppy.toFixed(2)} -> ${c1.ppy.toFixed(2)}`);

// A tap places one, the way a click does.
const s1 = await spec();
const cup = s1.path[s1.path.length - 1];
const place = await toScreen((s1.path[0][0] + cup[0]) / 2, (s1.path[0][1] + cup[1]) / 2);
await tap(place.x, place.y);
const nB1 = ((await spec()).bunkers || []).length;
ok('a tap places a bunker and selects it', nB1 === nB0 + 1 && (await page.evaluate(() => (window.__he.editorCanvas.selection || {}).group)) === 'bunkers');
ok('selecting on a phone opens the Edit sheet', await page.evaluate(() => document.querySelector('.he-right').classList.contains('is-open')));
ok('...and the map moves so the new bunker shows above the sheet', await page.evaluate(async () => {
  const m = await import('/hole-editor/js/canvas.js'); const c = window.__he.editorCanvas;
  const o = m.listObjects(c.spec, c.stations, c.length).filter((x) => x.group === 'bunkers').pop();
  const r = c.el.getBoundingClientRect();
  return r.top + c.toScreen(o.center[0], o.center[1]).y < document.querySelector('.he-right').getBoundingClientRect().top - 20;
}));
await tapEl('.he-right [data-sheet-close]');

// A one-finger drag on empty ground with the Bunker tool pans (and places nothing).
const c2 = await cam();
await drag(mb.x + 60, mb.y + 120, mb.x + 60, mb.y + 220);
const c3 = await cam();
ok('one finger on empty ground moves the view', Math.abs(c3.cy - c2.cy) > 5, `cy ${c2.cy.toFixed(1)} -> ${c3.cy.toFixed(1)}`);
ok('...and places nothing', ((await spec()).bunkers || []).length === nB1);

// Select tool: one finger on the bunker drags it.
await tapEl('#he-m-tools'); await tapEl('#he-ribbon [data-tool="select"]');
const bObj = await page.evaluate(() => { const o = window.__he.editorCanvas; const b = o.spec.bunkers[o.spec.bunkers.length - 1]; return { yd: b.yd }; });
const bc = await page.evaluate(async () => { const m = await import('/hole-editor/js/canvas.js'); const c = window.__he.editorCanvas; const list = m.listObjects ? m.listObjects(c.spec, c.stations, c.length) : null; const o = list && list.filter((x) => x.group === 'bunkers').pop(); return o ? o.center : null; });
if (bc) {
  const bs = await toScreen(bc[0], bc[1]);
  await drag(bs.x, bs.y, bs.x, bs.y - 60);
  const yd1 = (await spec()).bunkers[nB1 - 1].yd;
  ok('one finger on a bunker (Select) drags it up the hole', yd1 > bObj.yd + 5, `yd ${bObj.yd} -> ${yd1}`);
  ok('...and the drag does not open the Edit sheet over it', await page.evaluate(() => !document.querySelector('.he-right').classList.contains('is-open')));
} else ok('listObjects is exported for the probe', false);

// Long press = double-click: the Route tool adds a dot.
await tapEl('#he-m-tools'); await tapEl('#he-ribbon [data-tool="route"]');
const nP0 = (await spec()).path.length;
const s2 = await spec();
const mid2 = await toScreen((s2.path[0][0] + s2.path[1][0]) / 2 + 3, (s2.path[0][1] + s2.path[1][1]) / 2);
await longPress(mid2.x, mid2.y);
ok('a long press with Route adds a dot (the double-click)', (await spec()).path.length === nP0 + 1, `${nP0} -> ${(await spec()).path.length}`);

// Finger-sized targets: a tap 16 px off a waypoint still grabs it (a mouse needs 12).
const s3 = await spec();
const wp = s3.path[1];
const wps = await toScreen(wp[0], wp[1]);
await drag(wps.x + 16, wps.y, wps.x + 16 + 40, wps.y);
const wp2 = (await spec()).path[1];
ok('a finger 16 px off a route dot still drags it (22 px target)', Math.abs(wp2[0] - wp[0]) > 3, `x ${wp[0]} -> ${wp2[0]}`);

ok('the readout follows the last touch', await page.evaluate(() => /\d/.test(document.getElementById('he-hover').textContent)));
ok('the canvas has touch-action: none', await page.evaluate(() => getComputedStyle(document.getElementById('he-canvas')).touchAction === 'none'));
console.log('\n-- stage 3: on-screen stand-ins for the keys --');
await tapEl('#he-m-tools'); await tapEl('#he-ribbon [data-tool="select"]');
const nB2 = ((await spec()).bunkers || []).length;
const bc2 = await page.evaluate(async () => { const m = await import('/hole-editor/js/canvas.js'); const c = window.__he.editorCanvas; return m.listObjects(c.spec, c.stations, c.length).filter((x) => x.group === 'bunkers').pop().center; });
let bs2 = await toScreen(bc2[0], bc2[1]);
await tap(bs2.x, bs2.y);
ok('tapping the bunker opens the Edit sheet with Delete and Duplicate', await page.evaluate(() => document.querySelector('.he-right').classList.contains('is-open') && !document.getElementById('he-m-del').hidden && !document.getElementById('he-m-dup').hidden));
await tapEl('#he-m-dup');
ok('Duplicate adds a copy', ((await spec()).bunkers || []).length === nB2 + 1);
await tapEl('#he-m-del');
ok('Delete removes the selected one and closes the sheet', ((await spec()).bunkers || []).length === nB2 && await page.evaluate(() => !document.querySelector('.he-right').classList.contains('is-open')));
ok('Delete is hidden with nothing selected', await page.evaluate(() => document.getElementById('he-m-del').hidden));

// Draw a lake: the drawing bar replaces Enter / Backspace / Esc.
const nW = ((await spec()).water || []).length;
await tapEl('#he-m-add'); await page.locator('[data-item="water-draw"]').scrollIntoViewIfNeeded(); await tapEl('[data-item="water-draw"]');
ok('drawing shows the Finish / Undo point / Cancel bar', await page.evaluate(() => getComputedStyle(document.getElementById('he-m-drawbar')).display === 'flex'));
const sp = await spec(); const mid = [(sp.path[0][0] + sp.path[sp.path.length - 1][0]) / 2, (sp.path[0][1] + sp.path[sp.path.length - 1][1]) / 2];
for (const [dx, dy] of [[-30, -10], [-10, -10], [-10, 10], [-30, 10], [-40, 0]]) { const q = await toScreen(mid[0] + dx, mid[1] + dy); await tap(q.x, q.y); }
ok('each tap adds a corner (Finish shows 5)', /\(5\)/.test(await page.textContent('#he-m-draw-finish')));
await tapEl('#he-m-draw-undo');
ok('Undo point takes the last one off', /\(4\)/.test(await page.textContent('#he-m-draw-finish')));
await tapEl('#he-m-draw-finish');
const w2 = (await spec()).water || [];
ok('Finish makes the lake', w2.length === nW + 1 && Array.isArray(w2[nW].poly), JSON.stringify(w2[nW] || null).slice(0, 60));
ok('...and the drawing bar goes away', await page.evaluate(() => getComputedStyle(document.getElementById('he-m-drawbar')).display === 'none'));
await tapEl('.he-right [data-sheet-close]').catch(() => {});
await tapEl('#he-m-add'); await page.locator('[data-item="water-draw"]').scrollIntoViewIfNeeded(); await tapEl('[data-item="water-draw"]');
{ const q = await toScreen(mid[0] + 20, mid[1]); await tap(q.x, q.y); }
await tapEl('#he-m-draw-cancel');
ok('Cancel abandons a drawing', ((await spec()).water || []).length === nW + 1 && await page.evaluate(() => !window.__he.editorCanvas.drawing));

console.log('\n-- stage 4: modals and the walkthrough --');
await tapEl('#he-m-tools'); await tapEl('#he-ribbon #he-compare'); await page.waitForTimeout(400);
ok('Compare fits the screen', await page.evaluate(() => { const b = document.querySelector('.he-modal-box').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }));
await tapEl('#he-compare-close');

// A brand-new phone: the link opens the walkthrough first (first-visit redirect), on the setup screen.
const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('walkthrough: ' + e.message.split('\n')[0]));
await p2.goto(`${URL}?course=new`, { waitUntil: 'networkidle' });
await p2.waitForSelector('.tr-tip .tr-n', { timeout: 20000 }).catch(() => {});
ok('a first visit on a phone opens the walkthrough', /course=tutorial/.test(p2.url()) && !!(await p2.$('.tr-tip .tr-n')));
ok('the setup screen fits the phone', await p2.evaluate(() => { const b = document.querySelector('.he-setup-box').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && document.documentElement.scrollWidth <= innerWidth; }));
ok('...with two terrain columns', await p2.evaluate(() => getComputedStyle(document.getElementById('he-setup-looks')).gridTemplateColumns.split(' ').length === 2));
// Walk every step with its own Skip / Next, checking each pop-up is on screen and says "tap".
const seen = []; const off = []; const click = [];
for (let g = 0; g < 30; g++) {
  const n = parseInt(await p2.locator('.tr-tip .tr-n').textContent().catch(() => ''), 10);
  if (!n || seen.includes(n)) break;
  seen.push(n);
  const bx = await p2.locator('.tr-tip').boundingBox();
  if (!bx || bx.x < 0 || bx.x + bx.width > 390 || bx.y < 0 || bx.y + bx.height > 844) off.push(n);
  if (/\bclick/i.test(await p2.locator('.tr-tip').textContent())) click.push(n);
  if (n === 1) { await p2.fill('#he-setup-name', 'Practice'); await p2.waitForTimeout(1200); continue; }
  if (n === 3) { const r = await p2.locator('#he-setup-go').boundingBox(); await p2.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await p2.waitForTimeout(1200); continue; }
  const btn = p2.locator('.tr-tip [data-go="next"]');
  if (!(await btn.count())) break;
  const r = await btn.boundingBox(); await p2.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await p2.waitForTimeout(350);
}
ok('the walkthrough reaches its last step on a phone', seen.length >= 20 && !!(await p2.$('.tr-tip [data-go="start"]')), `steps seen: ${seen.join(',')}`);
ok('every pop-up stays on the screen', off.length === 0, `off screen: ${off.join(',')}`);
ok('no pop-up says "click" on a phone', click.length === 0, `steps: ${click.join(',')}`);
await ctx2.close();

ok('no page errors during the whole run', errors.length === 0, errors.join(' | '));

await b.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
