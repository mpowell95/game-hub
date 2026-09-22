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
  serialiseDocument, loadDocument, migrateDocument, CATALOG_VERSION,
  addWater, setWaterField, deleteWater, addCross,
  addDecor, setDecorField, deleteDecor, deleteObject, moveObject, DECOR_KINDS,
} from './hole-editor/js/model.js';
import { OBSTACLE_CATALOG, OBSTACLE_INDEX, catalogFor } from './golf/js/obstacles.js';
import { validateHole as validateHoleTop } from './golf/js/holes.js';
import { STRINGS as GOLF_STRINGS } from './golf/js/strings.js';
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


// --- THE COURSE CREATOR (2026-09-22): the same editor on a blank course ---------------------------
// These run LAST because setCourse() re-points the whole model; everything above assumes Red Mesa.
console.log('\n-- Course Creator (hole-editor/js/course.js, starter.js) --');
{
  const { PROFILES, resolveProfile, slugOf } = await import('./hole-editor/js/course.js');
  const { STARTER_SPECS, THEME_DEFAULTS } = await import('./hole-editor/js/starter.js');
  const { setCourse, invalidateBuilds, setCourseMeta, addHole, deleteHole } = await import('./hole-editor/js/model.js');
  const { validateHole } = await import('./golf/js/holes.js');
  const { generateSource, exportFileName } = await import('./hole-editor/js/export.js');

  await test('the plain link is Red Mesa; ?course=new is the blank course', () => {
    assert.equal(resolveProfile('').id, 'redmesa');
    assert.equal(resolveProfile('?foo=1').id, 'redmesa');
    assert.equal(resolveProfile('?course=new').id, 'custom');
    assert.equal(resolveProfile('?course=custom').id, 'custom');
  });

  await test('every starter hole builds and validates on BOTH looks, par 72', () => {
    for (const theme of ['parkland', 'desert']) {
      let par = 0;
      STARTER_SPECS.forEach((s, i) => {
        const h = makeHole({ ...THEME_DEFAULTS[theme], ...s, n: i + 1 });
        assert.deepEqual(validateHole(h), [], `${theme} hole ${i + 1}`);
        par += h.par;
      });
      assert.equal(par, 72, theme);
    }
    assert.equal(STARTER_SPECS.length, 18);
    assert.ok(STARTER_SPECS.every((s) => s.defend === false && !s.bunkers && !s.water && !s.trees && !s.guard), 'starters carry no hazards');
  });

  await test('a Course Creator document: its own ids, key, name and theme; Red Mesa untouched', () => {
    setCourse(PROFILES.custom);
    const doc = createDocument();
    assert.equal(doc.courseId, 'custom');
    assert.equal(doc.order[0], 'h-01');
    assert.deepEqual(doc.course, { name: 'My Course', theme: 'parkland' });
    assert.equal(PROFILES.custom.storageKey, 'golf.holeEditor.custom.v1');
    assert.notEqual(PROFILES.custom.storageKey, PROFILES.redmesa.storageKey);
    for (const id of doc.order) assert.deepEqual(validateHole(buildHole(doc, id)), [], id);
    const back = loadDocument(serialiseDocument(doc));
    assert.deepEqual(back.course, doc.course, 'name and theme survive a save');
  });

  // SINCE THE CATALOGUE (2026-09-22) BOTH LOOKS CARRY THE SAME `treeTypes`, so a theme switch can
  // no longer be read off `treeTypes[0]`. What a look now decides is the BELT SPECIES, which is
  // also the thing a designer actually sees change; this test follows the code rather than being
  // deleted with the behaviour it used to describe.
  await test('theme switch swaps the belt species on the next build, not the whole table', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    const speciesOf = (d) => {
      const h = buildHole(d, 'h-01');
      return h.treeTypes[h.treeBelts[0].type].name;
    };
    assert.equal(speciesOf(doc), 'pine');
    assert.equal(buildHole(doc, 'h-01').treeTypes.length, OBSTACLE_CATALOG.length);
    doc.course = setCourseMeta(doc, { theme: 'desert' }).course;
    setCourse(PROFILES.custom, 'desert');
    invalidateBuilds(doc);
    assert.equal(speciesOf(doc), 'saguaro');
    assert.equal(buildHole(doc, 'h-01').treeTypes.length, OBSTACLE_CATALOG.length, 'the catalogue is the table on both looks');
  });

  await test('add hole appends a fresh starter with an id no other hole holds; delete keeps at least three', () => {
    setCourse(PROFILES.custom);
    let doc = createDocument();
    doc = addHole(doc);
    assert.equal(doc.order.length, 19);
    assert.equal(doc.order[18], 'h-19');
    assert.deepEqual(validateHole(buildHole(doc, 'h-19')), []);
    doc = deleteHole(doc, 'h-03');
    doc = addHole(doc);
    assert.equal(new Set(doc.order).size, doc.order.length, 'ids stay unique after a delete in the middle');
    assert.ok(doc.order.every((id) => doc.holes[id]), 'every id in order has a hole');
    while (doc.order.length > 3) doc = deleteHole(doc, doc.order[0]);
    assert.equal(deleteHole(doc, doc.order[0]).order.length, 3, 'three is the floor');
  });

  await test('export names the file after the course and the generated module loads with its own defaults', async () => {
    setCourse(PROFILES.custom, 'desert');
    let doc = createDocument();
    doc.course = setCourseMeta(doc, { name: "King's Landing", theme: 'desert' }).course;
    assert.equal(exportFileName(doc), 'kingslanding.js');
    assert.equal(slugOf('  '), 'mycourse');
    const src = generateSource(doc, '2026-09-22');
    assert.match(src, /export const KINGSLANDING_COURSE = \{/);
    assert.match(src, /id: 'kingslanding'/);
    // THE CATALOGUE IS IMPORTED, NEVER INLINED (docs/HANDOFF-GOLF-OBJECTS.md section 1): an
    // exported course that carried its own copy of the table would be frozen at the catalogue as
    // it stood on export day, and a later APPEND would never reach it.
    assert.match(src, /import \{ OBSTACLE_CATALOG as TREE_TYPES \} from '\.\.\/js\/obstacles\.js';/);
    assert.doesNotMatch(src, /const TREE_TYPES = \[/, 'the table must not be inlined');
    assert.match(src, /rough: 7,/);
    assert.match(src, /belts: \{ left: \{ depth: 20, spacing: 14, type: 10 \}/, "the desert look's belts are saguaros by catalogue index");
    assert.doesNotMatch(src, /RED_MESA|Red Mesa/);
    const tmp = new URL('./.cc-export-test.mjs', import.meta.url);
    writeFileSync(tmp, src.replace("'../js/holegen.js'", "'./golf/js/holegen.js'").replace("'../js/obstacles.js'", "'./golf/js/obstacles.js'"));
    try {
      const mod = await import(tmp.href + '?t=' + Date.now());
      assert.equal(mod.default.par, 72);
      assert.equal(mod.default.holes.length, 18);
      assert.equal(mod.default.holes[0].treeTypes.length, OBSTACLE_CATALOG.length);
      const h1 = mod.default.holes[0];
      assert.equal(h1.treeTypes[h1.treeBelts[0].type].name, 'saguaro', 'a desert export still lines its holes with saguaros');
    } finally { unlinkSync(tmp); }
  });

  // --- the obstacle catalogue, and the migration onto it (2026-09-22) ------------------------

  await test('the catalogue is the shape the engine and the renderer each expect', () => {
    assert.equal(OBSTACLE_CATALOG.length, 17);
    const names = OBSTACLE_CATALOG.map((o) => o.name);
    assert.equal(new Set(names).size, names.length, 'no duplicate names');
    for (const o of OBSTACLE_CATALOG) {
      // What validateHole itself demands of a treeTypes row.
      assert.ok(o.trunk > 0 && o.canopy >= o.trunk && o.height > 0, `${o.name} is not a valid tree type`);
      assert.equal(typeof o.shape, 'string');
      assert.ok(Array.isArray(o.looks) && o.looks.length, `${o.name} has no looks`);
      assert.ok(o.looks.every((l) => l === 'parkland' || l === 'desert'), `${o.name} names a look that does not exist`);
    }
    // A rock is solid to every club: canopy === trunk, height 40 (redmesa.js records the 8 iron's
    // 32.3 yd apex as why 40 and not 30).
    for (const n of ['boulder', 'smallrock', 'rockpile']) {
      const o = OBSTACLE_CATALOG[OBSTACLE_INDEX[n]];
      assert.equal(o.canopy, o.trunk, n);
      assert.equal(o.height, 40, n);
    }
    // THE ORDER IS FROZEN: every saved draft stores an INDEX into it. These three are the ones the
    // migration and THEME_DEFAULTS name by number, so pin them explicitly.
    assert.equal(OBSTACLE_INDEX.pine, 0);
    assert.equal(OBSTACLE_INDEX.saguaro, 10);
    assert.equal(OBSTACLE_INDEX.boulder, 13);
  });

  await test('every catalogue entry has an obst_ label in EN and ES', () => {
    for (const o of OBSTACLE_CATALOG) {
      assert.equal(typeof GOLF_STRINGS.en[`obst_${o.name}`], 'string', `en obst_${o.name}`);
      assert.equal(typeof GOLF_STRINGS.es[`obst_${o.name}`], 'string', `es obst_${o.name}`);
    }
  });

  await test('catalogFor orders a look first but drops nothing, and keeps the real index', () => {
    for (const look of ['parkland', 'desert']) {
      const rows = catalogFor(look);
      assert.equal(rows.length, OBSTACLE_CATALOG.length, `${look} loses entries`);
      assert.equal(new Set(rows.map((r) => r.index)).size, rows.length);
      for (const r of rows) assert.equal(OBSTACLE_CATALOG[r.index], r.entry, 'index must address the catalogue itself');
      const firstOther = rows.findIndex((r) => !(r.entry.looks || []).includes(look));
      const lastMine = rows.map((r) => (r.entry.looks || []).includes(look)).lastIndexOf(true);
      assert.ok(firstOther === -1 || firstOther > lastMine, `${look}: its own species are not all first`);
    }
  });

  // A HAND-WRITTEN PRE-CATALOGUE DOCUMENT - exactly the shape the Course Creator wrote before the
  // catalogue existed (no `catalog` stamp, tree `type` 0-2 into the look's own three-entry table).
  // Rule 7: the fixture is what the OLD writer actually produced, not a convenient invention.
  const preCatalogueDoc = (theme) => ({
    version: 1,
    courseId: 'custom',
    course: { name: 'Old Draft', theme },
    order: ['h-01', 'h-02'],
    holes: {
      'h-01': { id: 'h-01', broken: null, spec: {
        par: 4, nickname: 'Hole 1', path: [[0, 5], [0, 380]],
        fw: [{ at: 0, w: 17 }, { at: 0.5, w: 14 }, { at: 1, w: 13 }],
        hard: 0, seed: 1097, greenSeed: 5131, defend: false, slope: 'gentle',
        trees: [{ yd: 120, side: -1, off: 24, type: 0 }, { yd: 200, side: 1, off: 26, type: 2 }, { yd: 260, side: -1, off: 22, type: 1 }],
        sentinels: [{ yd: 300, side: 1, off: 30, n: 5, spread: 7, type: 2 }],
      } },
      'h-02': { id: 'h-02', broken: null, spec: {
        par: 3, nickname: 'Hole 2', path: [[0, 5], [0, 165]],
        fw: [{ at: 0, w: 12 }, { at: 0.5, w: 10 }, { at: 1, w: 13 }],
        hard: 0.059, seed: 1194, greenSeed: 5262, defend: false, slope: 'crown',
        belts: { left: { depth: 20, spacing: 14 }, right: false },
        trees: [{ yd: 90, side: 1, off: 20 }],
      } },
    },
  });

  await test('migration: a PRE-CATALOGUE desert draft keeps every tree it had, by species', () => {
    const before = preCatalogueDoc('desert');
    const after = migrateDocument(JSON.parse(JSON.stringify(before)));
    assert.equal(after.catalog, CATALOG_VERSION, 'stamped');
    // saguaro / paloverde / boulder were 0 / 1 / 2.
    const t = after.holes['h-01'].spec.trees;
    assert.deepEqual(t.map((x) => OBSTACLE_CATALOG[x.type].name), ['saguaro', 'boulder', 'paloverde']);
    assert.equal(OBSTACLE_CATALOG[after.holes['h-01'].spec.sentinels[0].type].name, 'boulder');
    // An ABSENT type meant 0, which in the desert meant a saguaro - the case that would silently
    // have become a pine.
    assert.equal(OBSTACLE_CATALOG[after.holes['h-02'].spec.trees[0].type].name, 'saguaro');
    // A belt the designer had touched carried no type at all; it meant 0 too.
    assert.equal(OBSTACLE_CATALOG[after.holes['h-02'].spec.belts.left.type].name, 'saguaro');
    assert.equal(after.holes['h-02'].spec.belts.right, false, 'a belt turned off stays off');
    // Nothing else moved: every placed thing keeps its position, and rule 2 means nothing is lost.
    for (const id of after.order) {
      const a = before.holes[id].spec; const b = after.holes[id].spec;
      assert.equal((b.trees || []).length, (a.trees || []).length);
      (b.trees || []).forEach((x, i) => { assert.equal(x.yd, a.trees[i].yd); assert.equal(x.off, a.trees[i].off); });
    }
  });

  await test('migration: a PRE-CATALOGUE parkland draft is pine/oak/sentinel, unchanged in position', () => {
    const after = migrateDocument(preCatalogueDoc('parkland'));
    assert.deepEqual(after.holes['h-01'].spec.trees.map((x) => OBSTACLE_CATALOG[x.type].name),
      ['pine', 'sentinel', 'oak']);
    assert.equal(OBSTACLE_CATALOG[after.holes['h-02'].spec.belts.left.type].name, 'pine');
  });

  await test('migration: it runs ONCE - a second pass is a no-op, and Red Mesa is never touched', () => {
    const once = migrateDocument(preCatalogueDoc('desert'));
    const twice = migrateDocument(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice, once, 'the stamp stops a second re-index');
    assert.equal(migrateDocument(once), once, 'a stamped document is returned as-is');
    const rm = { version: 1, courseId: 'redmesa', order: ['rm-01'], holes: { 'rm-01': { id: 'rm-01', spec: { trees: [{ yd: 1, type: 2 }] } } } };
    assert.equal(migrateDocument(rm), rm, 'Red Mesa has its own frozen table and must not be re-indexed');
  });

  await test('migration: it happens on the way IN, through loadDocument, and survives a save', () => {
    setCourse(PROFILES.custom, 'desert');
    const raw = JSON.stringify(preCatalogueDoc('desert'));
    const loaded = loadDocument(raw);
    assert.equal(loaded.catalog, CATALOG_VERSION);
    assert.equal(OBSTACLE_CATALOG[loaded.holes['h-01'].spec.trees[0].type].name, 'saguaro');
    // ...and the migrated document builds and validates, which is the point of carrying it forward.
    for (const id of loaded.order) assert.deepEqual(validateHoleTop(buildHole(loaded, id)), [], id);
    const round = loadDocument(serialiseDocument(loaded));
    assert.equal(round.catalog, CATALOG_VERSION, 'the stamp is serialised');
    assert.deepEqual(round.holes['h-01'].spec.trees, loaded.holes['h-01'].spec.trees);
    setCourse(PROFILES.custom, 'parkland');
  });

  // --- swamp and decor mutators (docs/HANDOFF-GOLF-OBJECTS.md sections 2 and 4) -----------------

  await test('addWater places a swamp; a lake is still written exactly as it always was', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    const spec0 = doc.holes['h-01'].spec;
    const lake = addWater(spec0, { yd: 200, side: -1, off: 24 });
    assert.equal(lake.water[0].kind, undefined, 'a lake carries no kind at all');
    const swamp = addWater(lake, { yd: 260, side: 1, off: 22 }, 'swamp');
    assert.equal(swamp.water[1].kind, 'swamp');
    assert.notEqual(swamp.water[0].seed, swamp.water[1].seed, 'each blob gets its own seed');
    doc.holes['h-01'].spec = swamp;
    const built = buildHole(doc, 'h-01');
    assert.deepEqual(validateHoleTop(built), []);
    const kinds = built.surfaces.map((s) => s.kind);
    assert.ok(kinds.includes('water') && kinds.includes('swamp'), `built ${[...new Set(kinds)].join()}`);
  });

  await test('setWaterField flips a lake to a swamp and back, and back means NO key', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    let spec = addWater(doc.holes['h-01'].spec, { yd: 200, side: -1, off: 24 });
    spec = setWaterField(spec, 0, { kind: 'swamp' });
    assert.equal(spec.water[0].kind, 'swamp');
    spec = setWaterField(spec, 0, { kind: 'water' });
    assert.ok(!('kind' in spec.water[0]), 'turning it back leaves the entry the shape every shipped hole has');
    spec = deleteWater(spec, 0);
    assert.equal(spec.water.length, 0);
  });

  await test('a DRAWN swamp keeps its kind through draw, redraw, translate and scale', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    const pts = [[-30, 150], [10, 150], [10, 190], [-30, 190]];
    let spec = addDrawnShape(doc.holes['h-01'].spec, 'water', pts, 'swamp');
    assert.equal(spec.water[0].kind, 'swamp');
    assert.ok(spec.water[0].poly.length > 4, 'smoothed');
    spec = setDrawnPoly(spec, 'water', 0, [[-28, 152], [8, 152], [8, 188], [-28, 188]]);
    assert.equal(spec.water[0].kind, 'swamp', 'a redraw must not turn a swamp back into a lake');
    spec = translateDrawn(spec, 'water', 0, 3, 4);
    assert.equal(spec.water[0].kind, 'swamp');
    spec = scaleObject(spec, 'water', 0, 1.2, 1.2);
    assert.equal(spec.water[0].kind, 'swamp');
    // ...and a drawn LAKE is still a bare {poly}.
    const lake = addDrawnShape(spec, 'water', pts);
    assert.ok(!('kind' in lake.water[1]));
    doc.holes['h-01'].spec = lake;
    assert.deepEqual(validateHoleTop(buildHole(doc, 'h-01')), []);
  });

  await test('a swamp CROSS band builds as a swamp right across the corridor', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    doc.holes['h-01'].spec = addCross(doc.holes['h-01'].spec, { yd: 190, kind: 'swamp', depth: 22 });
    const built = buildHole(doc, 'h-01');
    assert.deepEqual(validateHoleTop(built), []);
    assert.ok(built.surfaces.some((s) => s.kind === 'swamp'), 'no swamp surface was built');
  });

  await test('decor: add, patch, move, duplicate and delete a sprite; the hole still validates', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    let spec = addDecor(doc.holes['h-01'].spec, 'bench', 21.44, 140.06);
    assert.deepEqual(spec.decor[0], { at: [21.4, 140.1], kind: 'bench', rot: 0 });
    spec = addDecor(spec, 'sign', -18, 60);
    spec = addDecor(spec, 'flagpole', 12, 330);
    assert.deepEqual(spec.decor.map((d) => d.kind), ['bench', 'sign', 'flagpole']);
    assert.ok(DECOR_KINDS.includes('path') && DECOR_KINDS.includes('bench'));
    spec = setDecorField(spec, 1, { rot: 45 });
    assert.equal(spec.decor[1].rot, 45);
    spec = moveObject(spec, 'decor', 1, { x: -20.5, y: 65.5 });
    assert.deepEqual(spec.decor[1].at, [-20.5, 65.5]);
    spec = duplicateObject(spec, 'decor', 1);
    assert.deepEqual(spec.decor[3].at, [-20.5, 77.5], 'a copy sits 12 yd up the hole');
    // A drawn cart path is the same list, with a poly instead of a point.
    spec = addDrawnShape(spec, 'decor', [[6, 40], [10, 40], [10, 300], [6, 300]]);
    assert.ok(Array.isArray(spec.decor[4].poly));
    doc.holes['h-01'].spec = spec;
    const built = buildHole(doc, 'h-01');
    assert.deepEqual(validateHoleTop(built), [], 'sprite decor must validate');
    assert.equal(built.decor.length, 5, 'decor is carried through verbatim');
    // The bounds pass has to have SEEN the sprites, or a hole could paint one off the map.
    assert.ok(built.bounds.maxY >= 330, `bounds stop at ${built.bounds.maxY}`);
    spec = deleteObject(spec, 'decor', 4);
    spec = deleteDecor(spec, 0);
    assert.equal(spec.decor.length, 3);
    while (spec.decor && spec.decor.length) spec = deleteDecor(spec, 0);
    assert.equal(spec.decor, undefined, 'the last delete removes the key rather than leaving []');
  });

  await test('validateHole refuses a sprite off the map, and a malformed one, by name', () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    const built = buildHole(doc, 'h-01');
    const bad = JSON.parse(JSON.stringify(built));
    bad.decor = [{ at: [built.bounds.maxX + 50, 100], kind: 'sign', rot: 0 }];
    assert.ok(validateHoleTop(bad).some((e) => /decor\[0\] sits outside bounds/.test(e)), validateHoleTop(bad).join('; '));
    bad.decor = [{ at: ['x', 1], kind: 'sign' }];
    assert.ok(validateHoleTop(bad).some((e) => /decor\[0\] has a malformed point/.test(e)));
    bad.decor = [{ kind: 'path' }];
    assert.ok(validateHoleTop(bad).some((e) => /decor\[0\] has fewer than 3 points/.test(e)));
  });

  await test('export prints swamps and decor, and the generated module builds them', async () => {
    setCourse(PROFILES.custom, 'parkland');
    const doc = createDocument();
    let spec = addWater(doc.holes['h-01'].spec, { yd: 200, side: -1, off: 24 }, 'swamp');
    spec = addCross(spec, { yd: 140, kind: 'swamp', depth: 20 });
    spec = addDecor(spec, 'bench', 20, 150);
    spec = addDrawnShape(spec, 'decor', [[6, 40], [10, 40], [10, 300], [6, 300]]);
    doc.holes['h-01'].spec = spec;
    const src = generateSource(doc, '2026-09-22');
    assert.match(src, /kind: 'swamp'/);
    assert.match(src, /decor: \[/);
    assert.match(src, /\{ at: \[20, 150\], kind: 'bench', rot: 0 \}/);
    // Copy JSON prints them too - it is the document verbatim, which is what a shared draft is.
    const json = JSON.parse(generateJSON(doc));
    assert.equal(json.holes['h-01'].spec.decor.length, 2);
    assert.equal(json.holes['h-01'].spec.water[0].kind, 'swamp');
    assert.equal(json.catalog, CATALOG_VERSION);
    const tmp = new URL('./.cc-swamp-test.mjs', import.meta.url);
    writeFileSync(tmp, src.replace("'../js/holegen.js'", "'./golf/js/holegen.js'").replace("'../js/obstacles.js'", "'./golf/js/obstacles.js'"));
    try {
      const mod = await import(tmp.href + '?t=' + Date.now());
      const h = mod.default.holes[0];
      assert.deepEqual(validateHoleTop(h), []);
      assert.ok(h.surfaces.some((x) => x.kind === 'swamp'), 'the exported course has no swamp');
      assert.equal(h.decor.length, 2);
    } finally { unlinkSync(tmp); }
  });

  setCourse(PROFILES.redmesa);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
