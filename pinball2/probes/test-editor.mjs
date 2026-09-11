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
    if (sh.kind === 'ribbon') return sh.pts[Math.floor(sh.pts.length / 2)];
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

// ------------------------------------------------- [KNOWN-BUG PROBE] a new build must show
// Three builds in a row produced the same symptom - Matt opening the tool and seeing an old table -
// and the last cause was the persistence layer GUESSING. One autosave slot plus an `edited` flag:
// keep an edited save, drop an unedited one, print a grey warning line when it guessed "keep". It
// worked as designed and the design was the problem.
//
// There is no guess now. Default is not stored at all, so it is the current build by construction,
// and the library is only ever written by an explicit Save as. These cases pin both halves.

const LIBKEY = 'pinball2.editor.tables';

// 1. DEFAULT IS THE BUILD'S TABLE, whatever else is in storage. The old code had to reason about
//    this; now there is nothing for a stale save to overwrite, because Default is never read from
//    storage at all.
await page.evaluate((k) => {
  localStorage.setItem(k, JSON.stringify({
    'Old thing': { table: { name: 'OLD', w: 0.515, h: 1.067, launch: { x: 0.452, y: 0.14 },
      shapes: [{ id: 'd1', kind: 'drain', x: 0, y: 1.005, w: 0.515, h: 0.06 }] }, cfg: {}, savedAt: 1 },
  }));
  localStorage.removeItem('pinball2.editor.current');
}, LIBKEY);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const def = await page.evaluate(() => ({
  name: window.__pb2.tableName,
  kinds: [...new Set(window.__pb2.table.shapes.map((s) => s.kind))].sort().join(','),
  options: [...document.getElementById('tablesel').options].map((o) => o.textContent),
}));
ok(def.name === null && def.kinds.includes('ribbon'),
  `Default is the table this build ships, whatever is stored (${def.kinds})`);
ok(def.options[0].startsWith('Default') && def.options.includes('Old thing'),
  `the selector lists Default first, then every saved name (${def.options.join(' | ')})`);

// 2. EDITING DEFAULT IS A WORKING COPY and is never written. This is the line the whole redesign
//    turns on: Default cannot be silently overwritten, so it cannot go stale.
// A REAL edit, through the palette, so the whole save path runs exactly as it does for a person.
const addPart = async (label) => page.evaluate(async (l) => {
  document.getElementById('tab-edit').click();
  await new Promise((q) => setTimeout(q, 150));
  const b = [...document.querySelectorAll('.palette button')].find((x) => x.textContent.trim() === l);
  if (!b) return false;
  b.click();
  await new Promise((q) => setTimeout(q, 150));
  return true;
}, label);

const scratch = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), LIBKEY);
const addedOk = await addPart('Post');
const nBefore = await page.evaluate(() => window.__pb2.table.shapes.length);
const afterLib = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), LIBKEY);
ok(addedOk, 'the palette adds a part');
ok(JSON.stringify(scratch) === JSON.stringify(afterLib), 'editing Default writes nothing to the library',
  Object.keys(afterLib).join(', '));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const nAfter = await page.evaluate(() => window.__pb2.table.shapes.length);
ok(nAfter < nBefore, `and those edits are gone on the next load (${nBefore} parts became ${nAfter})`);

// 3. SAVE AS names it, and from then on it is yours. A new build never touches it.
const saved = await page.evaluate(async (k) => {
  const a = window.__pb2;
  a.table.shapes.push({ id: 'zz2', kind: 'circle', c: { x: 0.3, y: 0.6 }, r: 0.01 });
  window.prompt = () => 'BOARDWALK';
  document.getElementById('tab-edit').click();
  await new Promise((q) => setTimeout(q, 150));
  const btn = [...document.querySelectorAll('#panel button')].find((b) => /Save as/i.test(b.textContent));
  if (!btn) return { found: false };
  btn.click();
  await new Promise((q) => setTimeout(q, 150));
  const lib = JSON.parse(localStorage.getItem(k) || '{}');
  return { found: true, name: a.tableName, inLib: 'BOARDWALK' in lib, has: !!(lib.BOARDWALK && lib.BOARDWALK.table.shapes.some((s) => s.id === 'zz2')) };
}, LIBKEY);
ok(saved.found, 'the Table group has a Save as button');
ok(saved.name === 'BOARDWALK' && saved.inLib && saved.has, 'Save as stores the working table under that name', JSON.stringify(saved));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const reopened = await page.evaluate(() => ({
  name: window.__pb2.tableName,
  has: window.__pb2.table.shapes.some((s) => s.id === 'zz2'),
}));
ok(reopened.name === 'BOARDWALK' && reopened.has, 'and it is what you get back on the next load', JSON.stringify(reopened));

// Editing a NAMED table does persist to that name: picking it up again is the point of naming it.
const namedBefore = await page.evaluate(() => window.__pb2.table.shapes.length);
await addPart('Post');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const namedAfter = await page.evaluate(() => window.__pb2.table.shapes.length);
ok(namedAfter === namedBefore + 1,
  `editing a named table keeps the change in that name (${namedBefore} then ${namedAfter})`);

// Switching to Default and back must not disturb the save.
const roundTrip = await page.evaluate(async () => {
  const sel = document.getElementById('tablesel');
  sel.value = ''; sel.dispatchEvent(new Event('change'));
  await new Promise((q) => setTimeout(q, 150));
  const onDefault = { name: window.__pb2.tableName, has: window.__pb2.table.shapes.some((s) => s.id === 'zz2') };
  sel.value = 'BOARDWALK'; sel.dispatchEvent(new Event('change'));
  await new Promise((q) => setTimeout(q, 150));
  return { onDefault, back: window.__pb2.table.shapes.some((s) => s.id === 'zz2') };
});
ok(roundTrip.onDefault.name === null && !roundTrip.onDefault.has, 'switching to Default shows the build, not your save');
ok(roundTrip.back, 'and switching back gives your table again');

// 4. THE LEGACY AUTOSAVE becomes a named save rather than being thrown away, once, and the old key
//    is left exactly where it is so nobody has to trust the migration got it right.
await page.evaluate((k) => {
  localStorage.clear();
  localStorage.setItem('pinball2.editor.v1', JSON.stringify({
    table: { name: 'MINE', w: 0.515, h: 1.067, launch: { x: 0.452, y: 0.14 },
      shapes: [{ id: 'q1', kind: 'circle', c: { x: 0.2, y: 0.4 }, r: 0.01 },
               { id: 'q2', kind: 'drain', x: 0, y: 1.005, w: 0.515, h: 0.06 }] },
    cfg: {}, shipped: 'older', edited: true,
  }));
}, LIBKEY);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const mig = await page.evaluate((k) => {
  const lib = JSON.parse(localStorage.getItem(k) || '{}');
  return {
    names: Object.keys(lib),
    carried: !!(lib['My table'] && lib['My table'].table.shapes.some((s) => s.id === 'q1')),
    legacyIntact: !!localStorage.getItem('pinball2.editor.v1'),
    showing: window.__pb2.tableName,
    kinds: [...new Set(window.__pb2.table.shapes.map((s) => s.kind))].sort().join(','),
  };
}, LIBKEY);
ok(mig.carried, `the old one-slot autosave is migrated to "My table" (${mig.names.join(', ')})`);
ok(mig.legacyIntact, 'and the old key is left alone rather than deleted');
ok(mig.showing === null && mig.kinds.includes('ribbon'),
  'while the tool opens on Default, which is the build - the whole point of the change');

// Delete removes one named save and never touches Default.
const deleted = await page.evaluate(async (k) => {
  const sel = document.getElementById('tablesel');
  sel.value = 'My table'; sel.dispatchEvent(new Event('change'));
  await new Promise((q) => setTimeout(q, 150));
  window.confirm = () => true;
  document.getElementById('tab-edit').click();
  await new Promise((q) => setTimeout(q, 150));
  const btn = [...document.querySelectorAll('#panel button')].find((b) => /Delete\.\.\./i.test(b.textContent));
  if (!btn) return { found: false };
  btn.click();
  await new Promise((q) => setTimeout(q, 150));
  return {
    found: true,
    names: Object.keys(JSON.parse(localStorage.getItem(k) || '{}')),
    showing: window.__pb2.tableName,
    kinds: [...new Set(window.__pb2.table.shapes.map((s) => s.kind))].sort().join(','),
  };
}, LIBKEY);
ok(deleted.found && deleted.names.length === 0, 'Delete removes that named save', JSON.stringify(deleted));
ok(deleted.showing === null && deleted.kinds.includes('ribbon'), 'and drops you back on Default');

await page.goto(URL + '?fresh', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const forced = await page.evaluate(() => ({
  name: window.__pb2.tableName,
  kinds: [...new Set(window.__pb2.table.shapes.map((s) => s.kind))].sort().join(','),
}));
ok(forced.name === null && forced.kinds.includes('ribbon'), `?fresh still means Default (${forced.kinds})`);

// ------------------------------------------------------------- precision: zoom, hold, magnifier
// Matt: "When I select an object, the slingshot for example, and I want to extend or shorten it, I
// need an enlarge option. If I hold it down I can precisely move stuff or a smaller enlarged window
// comes up or something."
//
// At the default fit a millimetre of table is under a pixel and a finger is about 9mm across, so an
// end handle is smaller than the finger reaching for it AND hidden under it once reached. Three
// answers, all tested here against the real tool.
await page.goto(URL + '?fresh', { waitUntil: 'networkidle' });
await page.click('#tab-edit');
await page.waitForTimeout(400);

const selectSling = () => page.evaluate(async () => {
  const a = window.__pb2;
  const sh = a.table.shapes.find((x) => x.kind === 'sling');
  a.sel.clear();
  a.sel.add(sh.id);
  await new Promise((q) => setTimeout(q, 60));
  return sh.id;
});

// 1. LENGTH AND ANGLE: the one edit four coordinates cannot express. Shortening a line that is not
//    square to the table means recomputing both ends by hand, and getting its angle slightly wrong.
const slingId = await selectSling();
await page.evaluate(() => window.__pb2 && document.getElementById('tab-edit').click());
await page.waitForTimeout(300);
const lenRow = await page.evaluate((id) => {
  const a = window.__pb2;
  a.sel.clear(); a.sel.add(id);
  return null;
}, slingId);
await page.click('#tab-play');
await page.click('#tab-edit');
await page.waitForTimeout(300);
const shortened = await page.evaluate(async (id) => {
  const before = JSON.parse(JSON.stringify(window.__pb2.table.shapes.find((x) => x.id === id)));
  const rows = [...document.querySelectorAll('#panel .row')];
  const row = rows.find((r) => /Length/.test(r.querySelector('label') ? r.querySelector('label').textContent : ''));
  if (!row) return { found: false };
  const input = row.querySelector('input');
  const was = parseFloat(input.value);
  input.value = String(was - 20);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((q) => setTimeout(q, 60));
  const sh = window.__pb2.table.shapes.find((x) => x.id === id);
  const L = (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const ang = (s) => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  return {
    found: true, was,
    lenNow: L(sh) * 1000,
    angMoved: Math.abs(ang(sh) - ang(before)) * 180 / Math.PI,
    aMoved: Math.hypot(sh.a.x - before.a.x, sh.a.y - before.a.y) * 1000,
  };
}, slingId);
ok(shortened.found, 'a slingshot has a Length row, so it can be shortened without solving for both ends');
ok(shortened.found && Math.abs(shortened.lenNow - (shortened.was - 20)) < 0.2,
  `shortening it by 20mm shortens it by 20mm (${shortened.lenNow && shortened.lenNow.toFixed(1)}mm from ${shortened.was && shortened.was.toFixed(1)})`);
ok(shortened.found && shortened.angMoved < 0.01 && shortened.aMoved < 0.01,
  'and it keeps its angle and its anchored end exactly where they were', JSON.stringify(shortened));

// 2. ZOOM. There was no way to zoom on a phone at all: the wheel handler is a desktop control.
// The buttons live in the TOP BAR, not in a panel: they were in the Edit panel, which meant you
// could not zoom while playing or while tuning, and the dock is exactly where a thumb is not.
const zoomed = await page.evaluate(async () => {
  const a = window.__pb2;
  const start = a.view.zoom;
  const plus = document.getElementById('zoom-in');
  const fit = document.getElementById('zoom-fit');
  if (!plus || !fit || plus.closest('#panel')) return { found: false };
  plus.click(); plus.click();
  await new Promise((q) => setTimeout(q, 60));
  const inz = a.view.zoom;
  fit.click();
  await new Promise((q) => setTimeout(q, 60));
  return { found: true, start, inz, back: a.view.zoom, readout: document.getElementById('zoomval').textContent };
});
ok(zoomed.found, 'the zoom controls are in the top bar, reachable in every mode');
ok(zoomed.found && zoomed.inz > zoomed.start * 1.5, `+ zooms in (${zoomed.start} to ${zoomed.inz})`);
ok(zoomed.found && Math.abs(zoomed.back - 1) < 1e-9, `and Fit puts it back (readout ${zoomed.readout})`);

// Pinching must zoom AND must not leave the part the first finger was on somewhere else. A
// two-finger gesture always starts as one finger landing, and that finger can land on a part.
const pinched = await page.evaluate(async (id) => {
  const a = window.__pb2;
  const canvas = document.getElementById('c');
  const r = canvas.getBoundingClientRect();
  const sh = a.table.shapes.find((x) => x.id === id);
  const before = { a: { ...sh.a }, b: { ...sh.b } };
  const mid = { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2 };
  const v = a.view;
  const s0 = { x: v.ox + (mid.x * v.s + v.px) * v.zoom, y: v.oy + (mid.y * v.s + v.py) * v.zoom };
  const ev = (type, id2, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id2, bubbles: true, clientX: r.left + x, clientY: r.top + y }));
  const z0 = a.view.zoom;
  ev('pointerdown', 1, s0.x, s0.y);
  ev('pointermove', 1, s0.x + 8, s0.y + 8);          // the first finger drags a little, as fingers do
  ev('pointerdown', 2, s0.x + 40, s0.y);
  for (let k = 1; k <= 6; k++) { ev('pointermove', 2, s0.x + 40 + k * 12, s0.y); }
  ev('pointerup', 2, s0.x + 112, s0.y);
  ev('pointerup', 1, s0.x + 8, s0.y + 8);
  await new Promise((q) => setTimeout(q, 80));
  const now = a.table.shapes.find((x) => x.id === id);
  // In millimetres. The restore round-trips through toJSON, which rounds to 0.1mm, so that is the
  // honest tolerance here and it is the same one every undo in this tool has.
  const moved = Math.max(
    Math.hypot(now.a.x - before.a.x, now.a.y - before.a.y),
    Math.hypot(now.b.x - before.b.x, now.b.y - before.b.y),
  ) * 1000;
  return { z0, z1: a.view.zoom, moved };
}, slingId);
ok(pinched.z1 > pinched.z0 * 1.4, `a pinch zooms in (${pinched.z0.toFixed(2)} to ${pinched.z1.toFixed(2)})`);
ok(pinched.moved <= 0.11, `and the part the first finger landed on is put back where it was (moved ${pinched.moved.toFixed(3)}mm)`);

// 3. HOLD FOR A FINE DRAG, WITH A MAGNIFIER. A tap that moves straight away is a normal drag; one
//    held still first moves the handle a quarter as far, so a grid step is reachable on a phone.
const fine = await page.evaluate(async (id) => {
  const a = window.__pb2;
  a.view.zoom = 1; a.view.px = 0; a.view.py = 0;
  a.sel.clear(); a.sel.add(id);
  const canvas = document.getElementById('c');
  const r = canvas.getBoundingClientRect();
  const v = a.view;
  const scr = (p) => ({ x: v.ox + (p.x * v.s + v.px) * v.zoom, y: v.oy + (p.y * v.s + v.py) * v.zoom });
  const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 9, bubbles: true, clientX: r.left + x, clientY: r.top + y }));

  const run = async (holdMs) => {
    const sh = a.table.shapes.find((x) => x.id === id);
    const b0 = { x: sh.b.x, y: sh.b.y };
    const s = scr(b0);
    ev('pointerdown', s.x, s.y);
    await new Promise((q) => setTimeout(q, holdMs));
    const seen = [];
    for (let k = 1; k <= 8; k++) {
      ev('pointermove', s.x + k * 6, s.y);
      seen.push(a.__loupe === undefined ? null : a.__loupe);
    }
    const moved = Math.abs(a.table.shapes.find((x) => x.id === id).b.x - b0.x) * 1000;
    ev('pointerup', s.x + 48, s.y);
    await new Promise((q) => setTimeout(q, 40));
    return moved;
  };
  a.snap = false;                                   // the grid would quantise both runs to the same
  const quick = await run(0);
  const held = await run(520);
  return { quick, held };
}, slingId);
ok(fine.quick > 1, `a quick drag moves the handle the whole way (${fine.quick.toFixed(1)}mm)`);
ok(fine.held < fine.quick * 0.5,
  `holding first makes it a fine drag, about a quarter as far (${fine.held.toFixed(1)}mm against ${fine.quick.toFixed(1)}mm)`);

// The magnifier is drawn onto the canvas, so the test looks at PIXELS: with a drag in progress, the
// far top corner must stop being empty background.
const loupe = await page.evaluate(async (id) => {
  const a = window.__pb2;
  const canvas = document.getElementById('c');
  const ctx2 = canvas.getContext('2d');
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / r.width;
  const sh = a.table.shapes.find((x) => x.id === id);
  const v = a.view;
  const s = { x: v.ox + (sh.b.x * v.s + v.px) * v.zoom, y: v.oy + (sh.b.y * v.s + v.py) * v.zoom };
  const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, bubbles: true, clientX: r.left + x, clientY: r.top + y }));
  const corner = () => {
    // the loupe sits in the top corner AWAY from the finger, 14px in, radius 62
    const cx = s.x < r.width / 2 ? r.width - 76 : 76;
    const d = ctx2.getImageData(Math.round(cx * dpr), Math.round(76 * dpr), 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  };
  const idle = corner();
  ev('pointerdown', s.x, s.y);
  ev('pointermove', s.x + 5, s.y + 5);
  await new Promise((q) => requestAnimationFrame(() => requestAnimationFrame(q)));
  const during = corner();
  ev('pointerup', s.x + 5, s.y + 5);
  await new Promise((q) => requestAnimationFrame(() => requestAnimationFrame(q)));
  const after = corner();
  return { idle, during, after };
}, slingId);
ok(loupe.during !== loupe.idle, `a magnifier appears in the far corner while dragging (${loupe.idle} to ${loupe.during})`);
ok(loupe.after === loupe.idle, 'and it goes away when the finger lifts');

// ------------------------------------------------------- the workspace, and what must not move
// The canvas used to be a flex child that grew and shrank with whatever the panel below happened
// to contain, so switching tabs resized it with no window resize event and every tap landed an
// inch from the finger. It is a fixed grid row now. This measures the box in all four modes: if
// they ever differ again, that whole class of bug is back.
const boxes = {};
for (const m of ['play', 'edit', 'tune', 'check']) {
  await page.click('#tab-' + m);
  await page.waitForTimeout(250);
  boxes[m] = await page.evaluate(() => {
    const r = document.getElementById('c').getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}`;
  });
}
const same = new Set(Object.values(boxes));
ok(same.size === 1, `the table is the same box in every mode (${[...same].join(' | ')})`, JSON.stringify(boxes));

// The page itself must never scroll. The dock scrolls inside its own row; if the page scrolls, the
// layout has overflowed and the table can be pushed off screen.
const pageScrolls = await page.evaluate(() => ({
  v: document.documentElement.scrollHeight > window.innerHeight + 1,
  h: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
ok(!pageScrolls.v && !pageScrolls.h, 'the page does not scroll, only the dock does', JSON.stringify(pageScrolls));

// NOTHING WAS SILENTLY DROPPED IN THE REORGANISATION. Every control that existed before the
// layout overhaul, found by the text a person reads, in the mode it belongs to.
const WANT_CTL = {
  play: ['New ball', 'Slow motion', 'Pause', 'Step frame'],
  edit: ['Wall', 'Arc', 'Post', 'Bumper', 'Sling', 'Flipper', 'Drain', 'Save as', 'Delete', 'Revert', 'Export JSON', 'Import'],
  tune: ['Copy config', 'Back to defaults'],
  check: ['Find traps', 'Tunnel test', 'Gap rule', 'Show reachable', 'Clear marks'],
};
const ALWAYS = ['Undo', 'Redo', 'Duplicate', 'Delete', 'Fit'];
const missingCtl = [];
for (const m of Object.keys(WANT_CTL)) {
  await page.click('#tab-' + m);
  await page.waitForTimeout(250);
  const seen = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button, summary')) out.push(b.textContent.trim());
    return out;
  });
  for (const w of WANT_CTL[m].concat(ALWAYS)) {
    if (!seen.some((t) => t === w || t.includes(w))) missingCtl.push(`${m}: ${w}`);
  }
}
ok(missingCtl.length === 0, 'every control from before the overhaul is still there', missingCtl.join(', '));

// Tune's 22 sliders were one unbroken list. They are collapsible groups now, and the group
// belonging to whatever is selected opens itself.
await page.evaluate(() => {
  const a = window.__pb2;
  const sh = a.table.shapes.find((x) => x.kind === 'bumper');
  a.sel.clear(); a.sel.add(sh.id);
});
await page.click('#tab-play');
await page.click('#tab-tune');
await page.waitForTimeout(300);
const grp = await page.evaluate(() => {
  const all = [...document.querySelectorAll('details.grp')];
  const open = all.filter((d) => d.open).map((d) => d.querySelector('summary').textContent.trim());
  return { count: all.length, open, marked: all.filter((d) => d.classList.contains('sel')).length };
});
ok(grp.count >= 2, `Tune is collapsible groups, not one list (${grp.count} groups)`);
ok(grp.open.some((t) => /BUMPER/i.test(t)), `the selected part's group opens itself (open: ${grp.open.join(', ')})`);
ok(grp.marked === 1, `and is the one marked as the selection (${grp.marked} marked)`);

// ------------------------------------------- [KNOWN-BUG PROBE] the long press selected the page
// Matt, on the fine drag that had just shipped: "it also selects everything, the whole page, as if
// I was going to copy something." A long press is the OS gesture for "select this text", and a fine
// drag begins with one by definition, so the tool cannot have the second without killing the first.
// Asserted on the COMPUTED style, not the source: a stylesheet that fails to apply reads the same
// as one that was never written.
const selectable = await page.evaluate(() => {
  const bad = [];
  const check = (el, label) => {
    const cs = getComputedStyle(el);
    const v = cs.userSelect || cs.webkitUserSelect;
    if (v !== 'none') bad.push(`${label}: ${v}`);
  };
  check(document.body, 'body');
  check(document.getElementById('c'), 'canvas');
  check(document.getElementById('panel'), 'panel');
  const h2 = document.querySelector('#panel h2') || document.querySelector('#panel .note');
  if (h2) check(h2, 'panel text');
  // A number field must stay selectable, or a value you cannot select is a value you cannot correct.
  const inp = document.querySelector('#panel input[type=number]');
  // 'auto' counts: the requirement is that it is SELECTABLE, not that one particular keyword set
  // it. This guards against the global rule above swallowing the inputs, not against a spelling.
  const iv = inp ? (getComputedStyle(inp).userSelect || getComputedStyle(inp).webkitUserSelect) : null;
  const inputOk = inp ? (iv === 'text' || iv === 'auto') : null;
  return { bad, inputOk };
});
ok(selectable.bad.length === 0, 'a long press cannot select the page', selectable.bad.join(', '));
ok(selectable.inputOk !== false, 'but a number field is still selectable, so a value can be corrected');

// And the long press must not raise the OS context menu over the table either. CSS does not stop
// that one; only a preventDefault on the canvas does.
const menu = await page.evaluate(() => {
  const c = document.getElementById('c');
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  c.dispatchEvent(e);
  return e.defaultPrevented;
});
ok(menu, 'and it cannot raise the context menu over the table');

// ------------------------------------------------------------------------ Tune tunes ONE part
// Matt: "when I'm on the Tune tab, I should be able to select an object and see the tune objects for
// only that object." Twenty two sliders in one list is a list you scroll rather than read.
//
// Tapping on this tab must NEVER move the part. A tap on a phone drags a few pixels, and Edit's
// handler turns that into a move: on a tab where nobody is watching the table, the geometry would
// drift under the person tuning it.
await page.click('#tab-tune');
await page.waitForTimeout(300);
const tuneAll = await page.evaluate(async () => {
  window.__pb2.sel.clear();                       // the baseline is the UNFILTERED list
  document.getElementById('tab-play').click();
  document.getElementById('tab-tune').click();
  await new Promise((q) => setTimeout(q, 80));
  return document.querySelectorAll('#panel input[type=range]').length;
});

const tapKind = async (kind) => page.evaluate(async (k) => {
  const a = window.__pb2;
  const sh = a.table.shapes.find((x) => x.kind === k);
  const c = k === 'bumper' ? sh.c
    : k === 'sling' ? { x: (sh.a.x + sh.b.x) / 2, y: (sh.a.y + sh.b.y) / 2 }
      : { x: sh.pivot.x + sh.len * 0.5 * Math.cos(sh.restAng), y: sh.pivot.y + sh.len * 0.5 * Math.sin(sh.restAng) };
  const before = JSON.stringify(sh);
  const v = a.view;
  const s = { x: v.ox + (c.x * v.s + v.px) * v.zoom, y: v.oy + (c.y * v.s + v.py) * v.zoom };
  const canvas = document.getElementById('c');
  const r = canvas.getBoundingClientRect();
  // down, a real finger's worth of drift, then up
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, clientX: r.left + s.x, clientY: r.top + s.y }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true, clientX: r.left + s.x + 6, clientY: r.top + s.y + 6 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true, clientX: r.left + s.x + 6, clientY: r.top + s.y + 6 }));
  await new Promise((q) => setTimeout(q, 60));
  return {
    selected: a.sel.has(sh.id),
    moved: JSON.stringify(a.table.shapes.find((x) => x.id === sh.id)) !== before,
    labels: [...document.querySelectorAll('#panel .row label')].map((n) => n.textContent),
    sliders: document.querySelectorAll('#panel input[type=range]').length,
  };
}, kind);

const bump = await tapKind('bumper');
ok(bump.selected, 'tapping a bumper on the Tune tab selects it');
ok(!bump.moved, 'and tapping it does NOT move it, even with a finger that drifts');
ok(bump.sliders < tuneAll, `the panel is filtered to that part (${bump.sliders} sliders, was ${tuneAll})`);
ok(bump.labels.some((l) => /Bumper bounce/.test(l)) && !bump.labels.some((l) => /Slingshot|Rubber|Ramp/.test(l)),
  'and it shows the bumper numbers and nobody else\'s', bump.labels.join(' | '));
ok(bump.labels.some((l) => /Tilt/.test(l)), 'the table-wide numbers are still there, because they govern it too');

const sling = await tapKind('sling');
ok(sling.labels.some((l) => /Slingshot bounce/.test(l)) && !sling.labels.some((l) => /Bumper/.test(l)),
  'tapping a slingshot swaps the panel to the slingshot numbers', sling.labels.join(' | '));

const flip = await tapKind('flipper');
ok(flip.labels.some((l) => /Rubber bounce/.test(l)), 'and a flipper shows the flipper numbers', flip.labels.join(' | '));

// "Kick" was Matt's actual complaint, so the word is the assertion.
const anyKick = await page.evaluate(() => document.getElementById('panel').textContent);
ok(!/kick/i.test(anyKick), 'the word "kick" appears nowhere in the Tune panel');

const shown = await page.evaluate(async () => {
  [...document.querySelectorAll('#panel button')].find((b) => b.textContent === 'Show all').click();
  await new Promise((q) => setTimeout(q, 60));
  return document.querySelectorAll('#panel input[type=range]').length;
});
ok(shown === tuneAll, `Show all puts every slider back (${shown} of ${tuneAll})`);

// A slider rendered twice is two sliders as far as the eye is concerned, and dragging one leaves
// the other reading the old number. Bounce off walls belongs to walls, arcs AND posts.
const dupes = await page.evaluate(() => {
  const seen = {};
  for (const n of document.querySelectorAll('#panel .row label')) seen[n.textContent] = (seen[n.textContent] || 0) + 1;
  return Object.keys(seen).filter((k) => seen[k] > 1);
});
ok(dupes.length === 0, 'no slider is rendered twice in the full list', dupes.join(', '));

// Every row must name a constant that exists, or it is a slider that does nothing.
const orphans = await page.evaluate(async () => {
  const m = await import('../machines/testbox/config.js');
  return m.TUNABLES.filter((t) => !(t.key in m.CONFIG)).map((t) => t.key);
});
ok(orphans.length === 0, 'every TUNABLES row names a real constant', orphans.join(', '));

// A tune stored before the rename still uses SLING_KICK. Dropping a number somebody dialled in by
// hand because a label got clearer would be the tool losing work.
const carried = await page.evaluate(async () => {
  const m = await import('../machines/testbox/config.js');
  const c = m.cloneConfig({ SLING_KICK: 4.4, BUMPER_KICK: 1.2, FLIP_KICK: 0.3 });
  return { s: c.SLING_BOUNCE, b: c.BUMPER_BOUNCE, f: c.FLIP_PUSH };
});
ok(carried.s === 4.4 && carried.b === 1.2 && carried.f === 0.3,
  'a tune saved under the old names is carried across, not dropped', JSON.stringify(carried));

// ------------------------------------------------------------ [KNOWN-BUG PROBE] a stale module
// Matt, on a build whose version chip read v782: a screenshot of the bare box from hours earlier,
// with no bumpers, no slingshots and no ramp. The chip reads the service worker and was telling the
// truth; the MODULE GRAPH was older. index.html now installs an import map that stamps the build
// onto every module URL, so a cache belonging to an older build cannot answer one.
//
// The TRANSITIVE edges are the half that a `import('...?v=')` inside editor.js would have missed,
// and missing them is worse than the original bug because the build would then be MIXED: render.js
// imports physics.js, and checks.js imports physics.js and config.js. So this asserts on the actual
// network log, not on the source.
const vpage = await browser.newPage();
const seen = [];
vpage.on('request', (r) => { if (/\/pinball2\/.*\.js/.test(r.url())) seen.push(r.url().split('/pinball2/')[1]); });
await vpage.goto(URL, { waitUntil: 'networkidle' });
await vpage.waitForTimeout(400);
const build = await vpage.evaluate(() => fetch('../../version.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.cache));
const WANT = ['editor/editor.js', 'machines/testbox/config.js', 'machines/testbox/physics.js',
  'machines/testbox/table.js', 'machines/testbox/render.js', 'probes/checks.js'];
const missing = WANT.filter((m) => !seen.some((u) => u === `${m}?v=${build}`));
ok(missing.length === 0, `every module is fetched with the build in its URL (${seen.length} requests, ${build})`,
  missing.length ? 'unversioned or absent: ' + missing.join(', ') + '\n      saw: ' + seen.join(', ') : '');
await vpage.close();

await browser.close();
console.log(`\nEditor tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
