// Does the TOOL work? The engine probes in run.mjs answer questions about the ball; this answers
// questions about the editor, and every case in it is something Matt hit by using it.
//
//   node pinball2/probes/test-editor.mjs        (needs `node server.mjs` running)
//
// SKIPs without playwright-core or Chromium, the same as the repo's other browser suites.

import { existsSync } from 'node:fs';

const PORT = process.env.PORT || 8123;
const URL = `http://localhost:${PORT}/pinball2/editor/index.html`;
const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].find((p) => existsSync(p));

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (e) { /* handled below */ }
if (!chromium || !CHROME) {
  console.log('SKIP: playwright-core or Chromium not available');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '\n      ' + detail : ''}`); }
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

const framesIn = (ms) => page.evaluate((d) => new Promise((r) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < d) requestAnimationFrame(tick); else r(n); };
  requestAnimationFrame(tick);
}), ms);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// ---------------------------------------------------------------- [KNOWN-BUG PROBE] touch offset
// Matt: "the editor can't tell what I'm selecting, it's like it thinks I'm selecting something an
// inch above where my finger actually is." The canvas is laid out by flex and each tab's panel is a
// different height, so switching tabs resized it with NO window resize event: the view transform
// still described the previous height. Tapping a part's own centre is the whole test.
await page.click('#tab-edit');
await page.waitForTimeout(400);
const taps = await page.evaluate(async () => {
  const a = window.__pb2;
  const canvas = document.getElementById('c');
  const out = [];
  // Every kind the table can hold. A kind missing here falls through to the drain branch and
  // produces NaN coordinates, which is how this test failed loudly the day bumpers were added.
  const centre = (sh) => {
    if (sh.kind === 'seg' || sh.kind === 'sling') return { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2 };
    if (sh.kind === 'arc') return { x: sh.c.x + sh.radius * Math.cos((sh.a0 + sh.a1) / 2), y: sh.c.y + sh.radius * Math.sin((sh.a0 + sh.a1) / 2) };
    if (sh.kind === 'circle' || sh.kind === 'bumper') return sh.c;
    if (sh.kind === 'flipper') return { x: sh.pivot.x + sh.len * 0.5 * Math.cos(sh.restAng), y: sh.pivot.y + sh.len * 0.5 * Math.sin(sh.restAng) };
    if (sh.kind === 'drain') return { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 };
    throw new Error('this test does not know the shape kind ' + sh.kind);
  };
  const toScreen = (v, q) => ({ x: v.ox + (q.x * v.s + v.px) * v.zoom, y: v.oy + (q.y * v.s + v.py) * v.zoom });
  for (const sh of a.table.shapes) {
    a.sel.clear();
    const s = toScreen(a.view, centre(sh));
    const r = canvas.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: r.left + s.x, clientY: r.top + s.y }));
    }
    await new Promise((r2) => setTimeout(r2, 10));
    out.push({ id: sh.id, hit: a.sel.has(sh.id) });
  }
  return out;
});
const missed = taps.filter((t) => !t.hit);
ok(missed.length === 0, `every part is selected by tapping its own centre (${taps.length - missed.length}/${taps.length})`,
  missed.map((m) => 'missed ' + m.id).join(', '));

// ---------------------------------------------------------------- [KNOWN-BUG PROBE] NaN freeze
// Matt filmed a ball resting in mid air at 0.00 m/s, touching nothing, for four seconds. It was not
// a physics bug: a number field was momentarily empty, parseFloat('') is NaN, the NaN went into the
// geometry, and createRadialGradient THROWS on a non-finite value rather than drawing nothing. The
// exception came out of the animation callback and rAF was never called again, so the page sat on
// its last painted frame. The autosave had already stored it, so a reload did not help.
const before = await framesIn(400);
const fields = await page.$$('#panel input[type=number]');
ok(fields.length > 0, 'the property panel shows number fields to edit');
if (fields.length) {
  // Both ways a field stops being a number: emptied, and typed into with rubbish. A number input
  // reports value '' for both, and parseFloat('') is NaN.
  for (const bad of ['', 'abc']) {
    await page.evaluate((v) => {
      const f = document.querySelector('#panel input[type=number]');
      f.value = v;
      f.dispatchEvent(new Event('change', { bubbles: true }));
    }, bad);
    await page.waitForTimeout(150);
  }
}
const finite = await page.evaluate(() => {
  const bad = [];
  const walk = (o, path) => {
    if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); return; }
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path + '.' + k);
  };
  walk(window.__pb2.table.shapes, 'shapes');
  let saved = '';
  try { saved = localStorage.getItem('pinball2.editor.v1') || ''; } catch (e) {}
  return { bad, savedNull: saved.includes('null') };
});
ok(finite.bad.length === 0, 'an empty or non-numeric field cannot put a NaN in the table', finite.bad.join(', '));
ok(!finite.savedNull, 'a broken number is never written to the autosave');

await page.click('#tab-play');
await page.evaluate(() => document.getElementById('launch').click());
await page.waitForTimeout(800);
const after = await framesIn(400);
ok(after > before * 0.5, `the animation loop is still running after that (${before} then ${after} frames per 400ms)`);

// ---------------------------------------------------------------- a phone already poisoned heals
// The autosave survives a reload and a force quit, so a phone that stored a NaN before this fix
// must repair itself on the next load rather than needing site data cleared.
await page.evaluate(() => {
  const raw = { table: { name: 'T', w: 0.515, h: 1.067, launch: { x: 0.452, y: 0.14 },
    shapes: [{ id: 'w1', kind: 'seg', a: { x: null, y: 0.1 }, b: { x: 0.008, y: 0.9 }, r: 0.008 },
             { id: 'd2', kind: 'drain', x: 0, y: 1.005, w: 0.515, h: 0.06 }] }, cfg: {} };
  localStorage.setItem('pinball2.editor.v1', JSON.stringify(raw));
});
errors.length = 0;
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const healed = await page.evaluate(() => {
  const a = window.__pb2;
  const bad = [];
  const walk = (o, path) => {
    if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); return; }
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path + '.' + k);
  };
  walk(a.table.shapes, 'shapes');
  return { bad, parts: a.table.shapes.length, repaired: a.repaired };
});
ok(healed.bad.length === 0, `a stored table containing a broken number is repaired on load (dropped ${healed.repaired})`, healed.bad.join(', '));
const afterHeal = await framesIn(400);
ok(afterHeal > 5, `the loop runs after loading a poisoned autosave (${afterHeal} frames per 400ms)`);
ok(errors.length === 0, 'no page errors', errors.join('\n      '));

await browser.close();
console.log(`\nEditor tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
