#!/usr/bin/env node
// test-hole-editor.mjs - headless tests for the Red Mesa hole editor, section 12 of
// HANDOFF-GOLF-HOLE-EDITOR.md. No browser. Step 1 covers model.js: the normalise round-trip is
// the correctness contract of the whole tool (section 3.2) - if it fails, nothing else matters.
// Export-round-trip and structural checks are added once js/export.js exists (step 2).

import assert from 'node:assert/strict';
import { makeHole } from './golf/js/holegen.js';
import { SPECS, RM_DEFAULTS, RED_MESA } from './golf/courses/redmesa.js';
import {
  normalise, createDocument, buildHole, mintId,
  movePathPoint, deleteBunker, setBeltSide,
  createEditorState, pushUndo, undo, redo,
  serialiseDocument, loadDocument,
} from './hole-editor/js/model.js';

let pass = 0; let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`ok - ${name}`); }
  catch (e) { fail++; console.error(`FAIL - ${name}\n    ${e.stack || e}`); }
}

// --- 3.2 / 12: normalise round-trip -----------------------------------------------------------
test('normalise round-trip: all 18 holes JSON-identical to RED_MESA.holes', () => {
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

test('yd conversion: a normalised spec has no `at` on any placed thing', () => {
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

test('pinning: every normalised spec has numeric seed, greenSeed, hard', () => {
  for (let i = 0; i < 18; i++) {
    const norm = normalise(SPECS[i], i + 1);
    assert.equal(typeof norm.seed, 'number');
    assert.equal(typeof norm.greenSeed, 'number');
    assert.equal(typeof norm.hard, 'number');
  }
});

// --- mintId / document ---------------------------------------------------------------------------
test('mintId: rm-01..rm-18', () => {
  assert.equal(mintId(1), 'rm-01');
  assert.equal(mintId(18), 'rm-18');
});

test('createDocument: 18 holes, order matches ids, specs match normalised originals', () => {
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

test('buildHole: a fresh document builds every hole identical to RED_MESA.holes', () => {
  const doc = createDocument();
  for (let i = 0; i < 18; i++) {
    const id = mintId(i + 1);
    const built = buildHole(doc, id);
    assert.equal(JSON.stringify(built), JSON.stringify(RED_MESA.holes[i]));
  }
});

// --- reorder ---------------------------------------------------------------------------------
test('reorder: swapping two ids changes only n, nothing else in surfaces/trees/green', () => {
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
test('R2: deleting the last bunker sets defend:false; built hole has no auto bunker', () => {
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

test('R2: belt off writes false and preserves the other side', () => {
  const doc = createDocument();
  const id = 'rm-01'; // SPEC_1 has explicit belts on both sides
  const spec = doc.holes[id].spec;
  const rightBefore = spec.belts.right;
  const edited = setBeltSide(spec, 'left', false);
  assert.equal(edited.belts.left, false);
  assert.deepEqual(edited.belts.right, rightBefore);
});

test('R2: a hole with no belts key gets both sides copied in before one is turned off', () => {
  const doc = createDocument();
  const id = 'rm-06'; // SPEC_6 sets belts: false (both sides off already)
  const spec = { ...doc.holes[id].spec, belts: undefined };
  const edited = setBeltSide(spec, 'left', false);
  assert.equal(edited.belts.left, false);
  assert.deepEqual(edited.belts.right, RM_DEFAULTS.belts.right);
});

// --- R4: the tee never moves -----------------------------------------------------------------
test('R4: the model rejects a move of path[0]', () => {
  const doc = createDocument();
  const spec = doc.holes['rm-01'].spec;
  assert.throws(() => movePathPoint(spec, 0, 10, 10), /R4|tee/i);
  const moved = movePathPoint(spec, 1, 10, 10);
  assert.deepEqual(moved.path[1], [10, 10]);
  assert.deepEqual(moved.path[0], spec.path[0]);
});

// --- undo/redo -----------------------------------------------------------------------------
test('undo: 3 edits, 3 undos returns the original document; redo returns the edited one', () => {
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
test('persistence: a document serialises and reloads equal', () => {
  const doc = createDocument();
  doc.holes['rm-03'].spec = { ...doc.holes['rm-03'].spec, nickname: 'Edited' };
  const raw = serialiseDocument(doc);
  const loaded = loadDocument(raw);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.courseId, 'redmesa');
  assert.deepEqual(loaded.order, doc.order);
  assert.equal(JSON.stringify(loaded.holes), JSON.stringify(doc.holes));
});

test('persistence: malformed/absent/wrong-version input loads as null', () => {
  assert.equal(loadDocument(null), null);
  assert.equal(loadDocument(''), null);
  assert.equal(loadDocument('not json'), null);
  assert.equal(loadDocument(JSON.stringify({ version: 2 })), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
