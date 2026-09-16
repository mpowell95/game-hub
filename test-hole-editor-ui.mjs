// test-hole-editor-ui.mjs - the hole editor DRIVEN IN A REAL BROWSER, tool by tool, with
// assertions - not screenshots. Written 2026-09-16 after a review found five defects that
// `test-hole-editor.mjs` (headless model/export tests) could never see, because each one lived in
// the canvas or the panel wiring:
//
//   - a Width handle dragged by ZERO pixels doubled the fairway (w stored as half * 2);
//   - placing a bunker then Ctrl+Z threw ("Cannot read properties of undefined (reading 'kind')")
//     because the selection outlived the object it pointed at;
//   - the Belts depth/spacing sliders were never wired (guarded on an id that does not exist);
//   - Slope's Paint mode had a panel and a mutator and no canvas code between them;
//   - the Cross panel's `over` never reached the placed hazard.
//
// Each is a [KNOWN-BUG PROBE] here. Needs `node server.mjs` up on :8123 and playwright-core +
// Chromium (SKIPs cleanly without them, like test-visual.mjs). ~20 s.

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
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__he && window.__he.editorCanvas.camera);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__he && window.__he.editorCanvas.camera);

const spec = () => page.evaluate(() => window.__he.doc.holes[window.__he.currentId].spec);
const trees = () => page.evaluate(async () => { const H = await import('/golf/js/holes.js'); return H.treesOf(window.__he.getBuilt(window.__he.currentId)).length; });
const toScreen = (x, y) => page.evaluate(([x, y]) => { const c = window.__he.editorCanvas; const cam = c.camera; const r = c.el.getBoundingClientRect(); return { x: r.x + (x - cam.cx) * cam.ppy + r.width / 2, y: r.y + r.height / 2 - (y - cam.cy) * cam.ppy }; }, [x, y]);
const key = async (k) => { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press(k); await page.waitForTimeout(150); };
const settle = () => page.waitForTimeout(250);

console.log('\n-- boot --');
ok('18 thumbnails painted', await page.evaluate(() => document.querySelectorAll('.he-thumb canvas').length) === 18);
ok('no page errors on boot', errors.length === 0, errors.join(' | '));

console.log('\n-- Width --');
await key('w');
const fwBefore = (await spec()).fw.map((p) => p.w);
const handles = await page.evaluate(() => window.__he.editorCanvas._widthHandles().map((h) => ({ x: h.point[0], y: h.point[1], at: h.at, side: h.side })));
const h1 = handles.find((h) => h.at === 0.5 && h.side === 1) || handles[0];
const hp = await toScreen(h1.x, h1.y);
await page.mouse.move(hp.x, hp.y); await page.mouse.down(); await page.mouse.move(hp.x + 1, hp.y); await page.mouse.move(hp.x, hp.y); await page.mouse.up(); await settle();
const fwAfter = (await spec()).fw.map((p) => p.w);
ok('[KNOWN-BUG PROBE] a width handle dragged by zero pixels leaves the base width within 3 yd', Math.abs(fwAfter[1] - fwBefore[1]) < 3, `${fwBefore} -> ${fwAfter}`);
await key('Control+z');
ok('...and Ctrl+Z restores it exactly', JSON.stringify((await spec()).fw.map((p) => p.w)) === JSON.stringify(fwBefore));

console.log('\n-- Bunker, Select, Delete, Undo --');
await key('b');
const mid = await toScreen(0, 200);
await page.mouse.click(mid.x, mid.y); await settle();
const nB = (await spec()).bunkers.length;
ok('a click places a bunker and selects it', nB === 2 && (await page.evaluate(() => JSON.stringify(window.__he.editorCanvas.selection))) === '{"group":"bunkers","index":1}');
await key('Control+z');
ok('[KNOWN-BUG PROBE] Ctrl+Z with the new bunker still selected does not throw', errors.length === 0, errors.join(' | '));
ok('...and the bunker is gone', (await spec()).bunkers.length === 1);
await key('v');
await page.evaluate(() => window.__he.editorCanvas.setSelection({ group: 'bunkers', index: 0 }));
await key('Delete');
const s1 = await spec();
ok('Delete removes the selected bunker and writes defend:false (R2)', s1.bunkers.length === 0 && s1.defend === false);
await key('Control+z');
ok('...Ctrl+Z brings it back', (await spec()).bunkers.length === 1);

console.log('\n-- Route --');
await key('r');
const len0 = await page.evaluate(() => window.__he.getBuilt(window.__he.currentId).cardYards);
const pin = await page.evaluate(() => window.__he.editorCanvas.built.pin);
const pp = await toScreen(pin[0], pin[1]);
await page.mouse.move(pp.x, pp.y); await page.mouse.down(); await page.mouse.move(pp.x, pp.y - 40, { steps: 5 }); await page.mouse.up(); await settle();
const len1 = await page.evaluate(() => window.__he.getBuilt(window.__he.currentId).cardYards);
ok('dragging the pin up lengthens the hole', len1 > len0 + 5, `${len0} -> ${len1}`);
ok('the tee did not move (R4)', JSON.stringify((await spec()).path[0]) === '[0,5]');
await page.click('#he-dogleg-l'); await settle();
ok('Dogleg left adds a waypoint', (await spec()).path.length >= 4);

console.log('\n-- Belts --');
await key('l');
const t0 = await trees();
await page.fill('#he-belt-left-spacing-n', '7'); await page.keyboard.press('Tab'); await settle();
const t1 = await trees();
ok('[KNOWN-BUG PROBE] the belt spacing slider changes the wood', t1 > t0 * 1.5, `${t0} -> ${t1}`);
await page.click('#he-belt-right-on'); await settle();
ok('switching a side off writes belts.right = false', (await spec()).belts.right === false);

console.log('\n-- Slope --');
await key('s');
await page.selectOption('#he-slope-preset', 'crown'); await settle();
ok('a preset writes spec.slope', (await spec()).slope === 'crown');
page.once('dialog', (d) => d.accept());
await page.click('#he-context .gh-seg__item[data-val="paint"]'); await settle();
ok('entering Paint bakes the preset into cells', !!(await spec()).slope.cells);
const gb = await page.evaluate(async () => { const H = await import('/golf/js/holes.js'); return H.greenBox(window.__he.getBuilt(window.__he.currentId)); });
const cellW = (gb.maxX - gb.minX) / 8; const cellH = (gb.maxY - gb.minY) / 8;
const cx = gb.minX + cellW * 2.5; const cy = gb.minY + cellH * 3.5;
const cp = await toScreen(cx, cy);
await page.mouse.move(cp.x, cp.y); await page.mouse.down(); await page.mouse.move(cp.x + 40, cp.y, { steps: 4 }); await page.mouse.up(); await settle();
const painted = (await spec()).slope.cells[3 * 8 + 2];
ok('[KNOWN-BUG PROBE] a drag inside a cell paints it (rightward drag -> +x downhill, magnitude 1)', painted[0] > 0.9 && Math.abs(painted[1]) < 0.1, JSON.stringify(painted));
await page.mouse.click(cp.x, cp.y); await settle();
ok('...and a plain click zeroes it', JSON.stringify((await spec()).slope.cells[3 * 8 + 2]) === '[0,0]');
page.once('dialog', (d) => d.accept());
await page.click('#he-context .gh-seg__item[data-val="preset"]'); await settle();
ok('[KNOWN-BUG PROBE] Preset can be re-entered from Paint (it replaces the cells with a preset)', typeof (await spec()).slope === 'string');

console.log('\n-- Cross --');
await key('c');
await page.fill('#he-c-over-n', '15'); await page.keyboard.press('Tab'); await settle();
const cpos = await toScreen(0, 120);
await page.mouse.click(cpos.x, cpos.y); await settle();
const cross = (await spec()).cross; const last = cross[cross.length - 1];
ok('[KNOWN-BUG PROBE] the panel\'s `over` reaches the placed cross hazard', last.over === 15, JSON.stringify(last));

console.log('\n-- Tree size / height --');
await key('t');
const tp = await toScreen(6, 250);
await page.mouse.click(tp.x, tp.y); await settle();
await page.fill('#he-t-size-n', '2'); await page.keyboard.press('Tab'); await settle();
await page.fill('#he-t-height-n', '35'); await page.keyboard.press('Tab'); await settle();
const tr = (await spec()).trees; const lt = tr[tr.length - 1];
ok('size and height are written on the placed tree', lt.s === 2 && lt.h === 35, JSON.stringify(lt));

console.log('\n-- Zoom, pan, hole switching --');
const z0 = await page.evaluate(() => +document.getElementById('he-zoom').value);
await key('+');
ok('[KNOWN-BUG PROBE] the + key moves the zoom slider', (await page.evaluate(() => +document.getElementById('he-zoom').value)) > z0);
await key('v');
const cam0 = await page.evaluate(() => ({ ...window.__he.editorCanvas.camera }));
const r = await page.evaluate(() => { const q = window.__he.editorCanvas.el.getBoundingClientRect(); return { x: q.x, y: q.y }; });
await page.mouse.move(r.x + 30, r.y + 30); await page.mouse.down(); await page.mouse.move(r.x + 130, r.y + 130, { steps: 4 }); await page.mouse.up(); await settle();
const cam1 = await page.evaluate(() => ({ ...window.__he.editorCanvas.camera }));
ok('Select-drag on empty ground pans', cam0.cx !== cam1.cx || cam0.cy !== cam1.cy);
await key(']');
ok('] moves to the next hole', (await page.evaluate(() => window.__he.currentId)) === 'rm-02');
await key('[');
ok('[ moves back', (await page.evaluate(() => window.__he.currentId)) === 'rm-01');

console.log('\n-- Validate / Reset / persistence --');
await page.click('#he-validate'); await settle();
ok('Validate reports on the hole', /validate/i.test(await page.evaluate(() => document.getElementById('he-hole').innerText)));
page.once('dialog', (d) => d.accept());
await page.click('#he-reset'); await settle();
const reset = await spec();
ok('Reset restores the original (no cross, no placed tree, belts back)', !(reset.cross || []).length && !(reset.trees || []).length && reset.belts.right !== false);
await page.fill('#he-h-nick', 'Probe'); await page.keyboard.press('Tab'); await settle();
await page.waitForTimeout(400);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__he && window.__he.editorCanvas.camera);
ok('the nickname survives a reload (autosave)', (await spec()).nickname === 'Probe');

ok('no page errors during the whole run', errors.length === 0, errors.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
