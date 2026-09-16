#!/usr/bin/env node
// test-hole-editor.mjs - headless tests for the Red Mesa hole editor, section 12 of
// HANDOFF-GOLF-HOLE-EDITOR.md. No browser. Step 1 covers model.js: the normalise round-trip is
// the correctness contract of the whole tool (section 3.2) - if it fails, nothing else matters.
// Export-round-trip and structural checks are added once js/export.js exists (step 2).

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeHole } from './golf/js/holegen.js';
import { SPECS, RM_DEFAULTS, RED_MESA } from './golf/courses/redmesa.js';
import {
  normalise, createDocument, buildHole, mintId,
  movePathPoint, deleteBunker, setBeltSide, addTree, setTreeField,
  smoothPoly, addDrawnShape, setDrawnPoly, translateDrawn, scaleObject, duplicateObject, addBunker, polyCentroid,
  detachGuards, insertSBend, setGreenOutline, clearGreenOutline, setFringe, addPin, movePin, deletePin,
  createEditorState, pushUndo, undo, redo,
  serialiseDocument, loadDocument,
} from './hole-editor/js/model.js';
import { generateSource, generateJSON } from './hole-editor/js/export.js';

let pass = 0; let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`ok - ${name}`); }
  catch (e) { fail++; console.error(`FAIL - ${name}\n    ${e.stack || e}`); }
}

// --- 3.2 / 12: normalise round-trip -----------------------------------------------------------
await test('normalise round-trip: all 18 holes JSON-identical to RED_MESA.holes', () => {
  for (let i = 0; i < 18; i++) {
    const slot = i + 1;
    const norm = normalise(SPECS[i], slot);
    const rebuilt = makeHole({ ...RM_DEFAULTS, ...norm, n: slot });
    assert.equal(
      JSON.stringify(rebuilt),
      JSON.stringify(RED_MESA.holes[i]),
      `hole ${slot} (${SPECS[i].nickname}) differs after normalise round-trip`,
    );
  }
});

await test('yd conversion: a normalised spec has no `at` on any placed thing', () => {
  for (let i = 0; i < 18; i++) {
    const norm = normalise(SPECS[i], i + 1);
    for (const field of ['bunkers', 'water', 'trees', 'sentinels', 'cross']) {
      for (const o of norm[field] || []) {
        assert.equal(o.at, undefined, `hole ${i + 1} ${field} entry still has 'at': ${JSON.stringify(o)}`);
      }
    }
    // fw/fwL/fwR keep `at` - they are a profile, not a placed thing.
    for (const field of ['fw', 'fwL', 'fwR']) {
      if (!Array.isArray(norm[field])) continue;
      for (const p of norm[field]) assert.notEqual(p.at, undefined, `hole ${i + 1} ${field} point lost its 'at'`);
    }
  }
});

await test('pinning: every normalised spec has numeric seed, greenSeed, hard', () => {
  for (let i = 0; i < 18; i++) {
    const norm = normalise(SPECS[i], i + 1);
    assert.equal(typeof norm.seed, 'number');
    assert.equal(typeof norm.greenSeed, 'number');
    assert.equal(typeof norm.hard, 'number');
  }
});

// --- mintId / document ---------------------------------------------------------------------------
await test('mintId: rm-01..rm-18', () => {
  assert.equal(mintId(1), 'rm-01');
  assert.equal(mintId(18), 'rm-18');
});

await test('createDocument: 18 holes, order matches ids, specs match normalised originals', () => {
  const doc = createDocument();
  assert.equal(doc.order.length, 18);
  assert.deepEqual(doc.order, Array.from({ length: 18 }, (_, i) => mintId(i + 1)));
  for (let i = 0; i < 18; i++) {
    const id = mintId(i + 1);
    assert.equal(doc.holes[id].id, id);
    assert.equal(doc.holes[id].broken, null);
    assert.equal(JSON.stringify(doc.holes[id].spec), JSON.stringify(normalise(SPECS[i], i + 1)));
  }
});

await test('buildHole: a fresh document builds every hole identical to RED_MESA.holes', () => {
  const doc = createDocument();
  for (let i = 0; i < 18; i++) {
    const id = mintId(i + 1);
    const built = buildHole(doc, id);
    assert.equal(JSON.stringify(built), JSON.stringify(RED_MESA.holes[i]));
  }
});

// --- reorder ---------------------------------------------------------------------------------
await test('reorder: swapping two ids changes only n, nothing else in surfaces/trees/green', () => {
  const doc = createDocument();
  const id = 'rm-01';
  const before = buildHole(doc, id);
  assert.equal(before.n, 1);
  // move rm-01 into rm-05's slot
  [doc.order[0], doc.order[4]] = [doc.order[4], doc.order[0]];
  const after = buildHole(doc, id);
  assert.equal(after.n, 5);
  const strip = (h) => JSON.stringify({ ...h, n: undefined });
  assert.equal(strip(before), strip(after), 'reordering changed more than n');
});

// --- R2: deleted stays deleted --------------------------------------------------------------
await test('R2: deleting the last bunker sets defend:false; built hole has no auto bunker', () => {
  const doc = createDocument();
  const id = 'rm-01'; // SPEC_1: one authored fairwayBunker (the landing-zone one) + a guard greensideBunker
  const spec = doc.holes[id].spec;
  assert.equal(spec.bunkers.length, 1);
  const before = buildHole(doc, id);
  assert.equal(before.surfaces.filter((s) => s.kind === 'fairwayBunker').length, 1);

  const edited = deleteBunker(spec, 0);
  assert.equal(edited.bunkers.length, 0);
  assert.equal(edited.defend, false);
  doc.holes[id].spec = edited;
  const after = buildHole(doc, id);
  // The authored fairway bunker is gone and defend:false stops an auto one taking its place.
  assert.equal(after.surfaces.filter((s) => s.kind === 'fairwayBunker').length, 0,
    'an auto-defend bunker reappeared after defend:false');
  // The guard's greensideBunker (unrelated to `defend`) is untouched.
  assert.equal(after.surfaces.filter((s) => s.kind === 'greensideBunker').length,
    before.surfaces.filter((s) => s.kind === 'greensideBunker').length);
});

await test('R2: belt off writes false and preserves the other side', () => {
  const doc = createDocument();
  const id = 'rm-01'; // SPEC_1 has explicit belts on both sides
  const spec = doc.holes[id].spec;
  const rightBefore = spec.belts.right;
  const edited = setBeltSide(spec, 'left', false);
  assert.equal(edited.belts.left, false);
  assert.deepEqual(edited.belts.right, rightBefore);
});

await test('R2: a hole with no belts key gets both sides copied in before one is turned off', () => {
  const doc = createDocument();
  const id = 'rm-06'; // SPEC_6 sets belts: false (both sides off already)
  const spec = { ...doc.holes[id].spec, belts: undefined };
  const edited = setBeltSide(spec, 'left', false);
  assert.equal(edited.belts.left, false);
  assert.deepEqual(edited.belts.right, RM_DEFAULTS.belts.right);
});

// --- R4: the tee never moves -----------------------------------------------------------------
await test('R4: the model rejects a move of path[0]', () => {
  const doc = createDocument();
  const spec = doc.holes['rm-01'].spec;
  assert.throws(() => movePathPoint(spec, 0, 10, 10), /R4|tee/i);
  const moved = movePathPoint(spec, 1, 10, 40);
  assert.deepEqual(moved.path[1], [10, 40]);
  assert.deepEqual(moved.path[0], spec.path[0]);
  // A waypoint can never be dragged behind the tee (first real export had one at y 3.6).
  assert.deepEqual(movePathPoint(spec, 1, 10, 2).path[1], [10, spec.path[0][1] + 10]);
});

// --- undo/redo -----------------------------------------------------------------------------
await test('undo: 3 edits, 3 undos returns the original document; redo returns the edited one', () => {
  const doc = createDocument();
  const original = JSON.stringify({ order: doc.order, holes: doc.holes });
  const state = createEditorState(doc);

  for (let i = 0; i < 3; i++) {
    pushUndo(state);
    doc.holes['rm-01'].spec = { ...doc.holes['rm-01'].spec, nickname: `Edit ${i}` };
  }
  const edited = JSON.stringify({ order: doc.order, holes: doc.holes });
  assert.notEqual(edited, original);

  assert.equal(undo(state), true);
  assert.equal(undo(state), true);
  assert.equal(undo(state), true);
  assert.equal(JSON.stringify({ order: doc.order, holes: doc.holes }), original);
  assert.equal(undo(state), false); // stack exhausted

  assert.equal(redo(state), true);
  assert.equal(redo(state), true);
  assert.equal(redo(state), true);
  assert.equal(JSON.stringify({ order: doc.order, holes: doc.holes }), edited);
  assert.equal(redo(state), false); // stack exhausted
});

// --- persistence -----------------------------------------------------------------------------
await test('persistence: a document serialises and reloads equal', () => {
  const doc = createDocument();
  doc.holes['rm-03'].spec = { ...doc.holes['rm-03'].spec, nickname: 'Edited' };
  const raw = serialiseDocument(doc);
  const loaded = loadDocument(raw);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.courseId, 'redmesa');
  assert.deepEqual(loaded.order, doc.order);
  assert.equal(JSON.stringify(loaded.holes), JSON.stringify(doc.holes));
});

await test('persistence: malformed/absent/wrong-version input loads as null', () => {
  assert.equal(loadDocument(null), null);
  assert.equal(loadDocument(''), null);
  assert.equal(loadDocument('not json'), null);
  assert.equal(loadDocument(JSON.stringify({ version: 2 })), null);
});

// --- 8: export round-trip -----------------------------------------------------------------------
// Written into golf/courses/ itself (temporarily) so the generated file's own
// `import { makeHole } from '../js/holegen.js'` resolves exactly as it will once folded back.
await (async () => {
  const tmpName = '__hole-editor-export-test__.mjs';
  const tmpPath = join('golf', 'courses', tmpName);
  try {
    const doc = createDocument(); // fresh, unedited, normalised
    const src = generateSource(doc, '2026-09-16');
    writeFileSync(tmpPath, src);
    const mod = await import(pathToFileURL(tmpPath).href + `?t=${Date.now()}`);
    test('export round-trip: the fresh document exports 18 holes identical to RED_MESA.holes', () => {
      assert.equal(mod.HOLES.length, 18);
      for (let i = 0; i < 18; i++) {
        assert.equal(JSON.stringify(mod.HOLES[i]), JSON.stringify(RED_MESA.holes[i]), `hole ${i + 1} differs after export round-trip`);
      }
      assert.equal(mod.RED_MESA.par, RED_MESA.par);
    });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
  }
})();

await test('export: Copy JSON round-trips through loadDocument', () => {
  const doc = createDocument();
  const json = generateJSON(doc);
  const loaded = loadDocument(json);
  assert.equal(JSON.stringify(loaded.holes), JSON.stringify(doc.holes));
});

// --- structural (section 12) ----------------------------------------------------------------
await test('structural: hole-editor/ has no js/ui.js', () => {
  assert.equal(existsSync('hole-editor/js/ui.js'), false);
});

await test('structural: sw.js ASSETS contains no hole-editor/ path', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const m = sw.match(/const ASSETS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'could not find ASSETS array in sw.js');
  assert.equal(/hole-editor\//.test(m[1]), false, 'sw.js ASSETS references hole-editor/');
});

await test('structural: validate-sw-assets.mjs carries the hole-editor exclusion', () => {
  const src = readFileSync('validate-sw-assets.mjs', 'utf8');
  assert.match(src, /hole-editor\\\//);
});


// --- a tree's own size and height (2026-09-16) --------------------------------------------------
await test('tree size/height: s and h on a placed tree survive build and export', async () => {
  const doc = createDocument();
  const id = 'rm-01';
  let spec = doc.holes[id].spec;
  spec = addTree(spec, { yd: 150, side: 1, off: 20, type: 0 });
  spec = setTreeField(spec, spec.trees.length - 1, { s: 1.5, h: 22 });
  doc.holes[id].spec = spec;
  const built = buildHole(doc, id);
  const placed = built.trees[built.trees.length - 1 - 0];
  const mine = built.trees.find((t) => t.s === 1.5 && t.h === 22);
  assert.ok(mine, 'the built hole carries s and h on the placed tree');
  assert.ok(placed, 'built.trees is non-empty');
  const src = generateSource(doc, '2026-09-16');
  assert.match(src, /s: 1\.5, h: 22/, 'export prints s and h on the tree entry');
});

// --- drawn shapes, duplicate, resize (2026-09-16) ------------------------------------------------
await test('smoothPoly: a 4-click square becomes 16 rounded points that all lie inside the square', () => {
  const sq = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const out = smoothPoly(sq);
  assert.equal(out.length, 16);
  assert.ok(out.every(([x, y]) => x >= 0 && x <= 20 && y >= 0 && y <= 20));
  const [cx, cy] = polyCentroid(out);
  assert.ok(Math.abs(cx - 10) < 0.2 && Math.abs(cy - 10) < 0.2);
});

await test('a drawn bunker builds as a greensideBunker surface with that outline, validates, and exports', async () => {
  const doc = createDocument();
  const id = 'rm-03';
  let spec = doc.holes[id].spec;
  const pin = buildHole(doc, id).pin;
  const pts = [[pin[0] - 8, pin[1] + 20], [pin[0] + 8, pin[1] + 20], [pin[0] + 10, pin[1] + 34], [pin[0] - 10, pin[1] + 34]];
  spec = addDrawnShape(spec, 'bunkers', pts, 'greensideBunker');
  doc.holes[id].spec = spec;
  const built = buildHole(doc, id);
  const mine = built.surfaces.filter((s) => s.kind === 'greensideBunker').find((s) => s.poly.length === 16);
  assert.ok(mine, 'the drawn outline is painted as a greenside bunker');
  const { validateHole } = await import('./golf/js/holes.js');
  assert.deepEqual(validateHole(built), []);
  assert.match(generateSource(doc, '2026-09-16'), /poly: \[\[/, 'export prints the polygon');
});

await test('scaleObject: a blob bunker scales r/ry, a drawn one scales its points about its centre', () => {
  const doc = createDocument();
  let spec = doc.holes['rm-01'].spec;
  spec = scaleObject(spec, 'bunkers', 0, 2, 0.5);
  assert.equal(spec.bunkers[0].r, 16);      // hole 1's bunker is r 8 with no ry (0.72 r implied)
  assert.equal(spec.bunkers[0].ry, 2.9);
  spec = addDrawnShape(spec, 'water', [[0, 100], [10, 100], [10, 110], [0, 110]]);
  const before = polyCentroid(spec.water[spec.water.length - 1].poly);
  spec = scaleObject(spec, 'water', spec.water.length - 1, 3, 3);
  const after = spec.water[spec.water.length - 1].poly;
  const c = polyCentroid(after);
  assert.ok(Math.abs(c[0] - before[0]) < 0.2 && Math.abs(c[1] - before[1]) < 0.2, 'centre stays put');
  assert.ok(Math.max(...after.map((p) => p[0])) - Math.min(...after.map((p) => p[0])) > 25, 'and it is three times wider');
});

await test('duplicateObject: the copy is 12 yd further up with a fresh seed; a drawn copy is translated', () => {
  const doc = createDocument();
  let spec = doc.holes['rm-01'].spec;
  const n = spec.bunkers.length;
  spec = duplicateObject(spec, 'bunkers', 0);
  assert.equal(spec.bunkers.length, n + 1);
  assert.ok(Math.abs(spec.bunkers[n].yd - spec.bunkers[0].yd - 12) < 0.06);   // the copy is rounded to 0.1, the original may carry a float tail
  // hole 1's bunker has no seed of its own (holegen derives one from its index, so the copy already
  // differs); a seeded original must get a fresh seed.
  const seeded = duplicateObject({ ...spec, bunkers: [{ ...spec.bunkers[0], seed: 500 }] }, 'bunkers', 0);
  assert.equal(seeded.bunkers[1].seed, 501);
  spec = addDrawnShape(spec, 'water', [[0, 100], [10, 100], [10, 110], [0, 110]]);
  const i = spec.water.length - 1;
  spec = duplicateObject(spec, 'water', i);
  assert.ok(Math.abs(polyCentroid(spec.water[i + 1].poly)[1] - polyCentroid(spec.water[i].poly)[1] - 12) < 0.01);
  spec = translateDrawn(spec, 'water', i + 1, 5, -3);
  assert.ok(Math.abs(polyCentroid(spec.water[i + 1].poly)[0] - polyCentroid(spec.water[i].poly)[0] - 5) < 0.01);
});

await test('addBunker honours a chosen kind and still auto-picks without one', () => {
  const doc = createDocument();
  const spec = doc.holes['rm-01'].spec;
  const L = buildHole(doc, 'rm-01').cardYards;
  assert.equal(addBunker(spec, { yd: 100, side: 1, off: 20 }, L).bunkers.at(-1).kind, 'fairwayBunker');
  assert.equal(addBunker(spec, { yd: L - 10, side: 1, off: 20 }, L).bunkers.at(-1).kind, 'greensideBunker');
  assert.equal(addBunker(spec, { yd: 100, side: 1, off: 20 }, L, 'greensideBunker').bunkers.at(-1).kind, 'greensideBunker');
});

// --- detach guards, S-bend (2026-09-16) ----------------------------------------------------------
await test('detachGuards: hole 10 guard bunkers become drawn bunkers, the token is gone, the hole paints the same', () => {
  const doc = createDocument();
  const id = 'rm-10';
  const spec = doc.holes[id].spec;
  assert.ok((spec.guard || []).length > 0, 'hole 10 has guard tokens');
  const before = buildHole(doc, id);
  const sandBefore = before.surfaces.filter((s) => s.kind === 'greensideBunker' || s.kind === 'fairwayBunker').map((s) => JSON.stringify(s.poly)).sort();
  const detached = detachGuards(spec, 10);
  assert.equal(detached.guard, undefined);
  assert.ok(detached.bunkers.filter((b) => b.poly).length >= 1, 'at least one drawn bunker was added');
  doc.holes[id].spec = detached;
  const after = buildHole(doc, id);
  const sandAfter = after.surfaces.filter((s) => s.kind === 'greensideBunker' || s.kind === 'fairwayBunker').map((s) => JSON.stringify(s.poly)).sort();
  assert.deepEqual(sandAfter, sandBefore, 'every bunker polygon is still painted, unchanged');
});

await test('insertSBend: two middle waypoints on opposite sides of the tee-pin line', () => {
  const doc = createDocument();
  const spec = doc.holes['rm-01'].spec;
  const L = buildHole(doc, 'rm-01').cardYards;
  const s = insertSBend(spec, -1, L);
  assert.equal(s.path.length, 4);
  assert.ok(s.path[1][0] < spec.path[0][0] - 10, 'first bend goes left');
  assert.ok(s.path[2][0] > spec.path[0][0] + 10, 'second bend comes back right');
  assert.ok(s.path[2][1] - s.path[1][1] >= 60, 'the two bends are at least 60 yd apart');
});

// --- drawn green, fringe, pins (2026-09-16) ------------------------------------------------------
await test('a drawn green outline, a per-side fringe and two pins build, validate and export', async () => {
  const doc = createDocument();
  const id = 'rm-03';
  let spec = { ...doc.holes[id].spec }; delete spec.pins;   // the shipped hole 3 has its own pins
  doc.holes[id].spec = spec;
  const c = buildHole(doc, id).pin;
  spec = setGreenOutline(spec, [[c[0] - 14, c[1] - 10], [c[0] + 14, c[1] - 10], [c[0] + 16, c[1] + 12], [c[0] - 16, c[1] + 12]]);
  spec = setFringe(spec, { front: 9, back: 4, left: 6, right: 6 });
  spec = addPin(spec, c[0] - 5, c[1] - 3);
  spec = addPin(spec, c[0] + 6, c[1] + 5);
  doc.holes[id].spec = spec;
  const built = buildHole(doc, id);
  const { validateHole } = await import('./golf/js/holes.js');
  assert.deepEqual(validateHole(built), []);
  assert.equal(built.green.poly.length, 16, 'the outline was rounded to 16 points');
  assert.equal(built.pins.length, 2);
  const src = generateSource(doc, '2026-09-16');
  assert.match(src, /greenOutline: \[\[/);
  assert.match(src, /fringe: \{ front: 9/);
  assert.match(src, /pins: \[\[/);
  spec = movePin(spec, 1, c[0] + 2, c[1] + 2);
  assert.deepEqual(spec.pins[1], [+(c[0] + 2).toFixed(1), +(c[1] + 2).toFixed(1)]);
  spec = deletePin(deletePin(spec, 1), 0);
  assert.equal(spec.pins, undefined, 'deleting every pin removes the key');
  const back = clearGreenOutline(spec);
  assert.equal(back.greenOutline, undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
