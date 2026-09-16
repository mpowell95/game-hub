// test-hole-editor-play.mjs - HANDOFF-GOLF-HOLE-EDITOR.md section 9 (phase 2)'s own test: a
// test-visual.mjs-style Playwright run that opens golf/?editor=1 with an edited document already
// in localStorage and asserts the setup screen's course strip shows the EDITED hole 1, not the
// shipped one - proving `globalThis.__gfCourseOverride` actually reached the setup screen, not
// just that the page didn't crash.
//
// Needs the dev server up (`node server.mjs`) and playwright-core/Chromium; SKIPs without them,
// the same convention `test-visual.mjs` and `sheet-course.mjs` use.
//
//   node test-hole-editor-play.mjs

import assert from 'node:assert/strict';
import { createDocument, buildHole, insertDogleg, serialiseDocument } from './hole-editor/js/model.js';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('SKIP - playwright-core not installed'); process.exit(0); }

const BASE = 'http://localhost:8123';

// A real edit, made the same way the editor itself would: lengthen hole 1 with a dogleg so its
// bounds - and so `holeAspect()`, what the setup screen's strip actually keys off - measurably
// change. Written straight into the document, exactly as the editor's own `ops.instant` would.
const doc = createDocument();
const before = buildHole(doc, 'rm-01');
let spec = doc.holes['rm-01'].spec;
spec = insertDogleg(spec, -1, before.cardYards);
doc.holes['rm-01'].spec = spec;
const after = buildHole(doc, 'rm-01');

function holeAspect(h) {
  const w = h.bounds.maxX - h.bounds.minX;
  const y = h.bounds.maxY - h.bounds.minY;
  return (w > 0 && y > 0) ? w / y : 0.33;
}
const beforeAspect = holeAspect(before);
const afterAspect = holeAspect(after);
assert.notEqual(beforeAspect.toFixed(4), afterAspect.toFixed(4), 'the test edit did not actually change hole 1s bounds - fix the test, not the game');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));

// Every standalone page is name-gated (root CLAUDE.md) - seed a profile or nothing mounts. Also
// the editor's own document, so the override in golf/index.html has something to read.
const docJson = serialiseDocument(doc);
await page.addInitScript((json) => {
  localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Visual Test', emoji: '\u{1F419}', color: '#1F5FA8' }));
  localStorage.setItem('golf.holeEditor.redmesa.v1', json);
  // Red Mesa is locked-by-default for a fresh profile (golf/CLAUDE.md, "Who can play it right
  // now"), which would leave its course chip disabled and unclickable. The setup screen reads
  // its INITIAL course straight from this settings key, with no lock check at all - exactly what
  // a hole editor's own Play button needs, since it exists to preview a hole, not to prove the
  // ladder unlocks Red Mesa.
  localStorage.setItem('gamehub.golf.v1', JSON.stringify({ lastCourse: 'redmesa', lastRound: 'quick3' }));
}, docJson);

await page.goto(`${BASE}/golf/?editor=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const overrideActive = await page.evaluate(() => !!(globalThis.__gfCourseOverride && globalThis.__gfCourseOverride.id === 'redmesa' && globalThis.__gfNoRecord === true));
assert.equal(overrideActive, true, '__gfCourseOverride / __gfNoRecord were not set');

// `gamehub.golf.v1`'s `lastCourse` already put the setup screen on Red Mesa (seeded above) -
// read hole 1's strip thumbnail's own aspect custom property straight off it.
const strip = page.locator('[data-hole-art="0"]');
await strip.waitFor({ state: 'attached', timeout: 5000 });
const gfAr = await strip.evaluate((el) => el.style.getPropertyValue('--gf-ar'));
assert.equal(+gfAr, +afterAspect.toFixed(4), `course strip shows hole 1's aspect as ${gfAr}, expected the edited hole's ${afterAspect.toFixed(4)} (shipped hole's is ${beforeAspect.toFixed(4)}) - the override did not reach the setup screen`);

assert.equal(errors.length, 0, `page errors: ${JSON.stringify(errors)}`);

console.log('ok - the setup screen course strip reflects the hole editor override, not the shipped course');
await b.close();
