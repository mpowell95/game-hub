// hole-editor/js/model.js - the document, normalisation and pure mutation helpers for the Red
// Mesa hole editor. No DOM here; this is what test-hole-editor.mjs exercises headless.
// HANDOFF-GOLF-HOLE-EDITOR.md section 3 is the spec this file implements. R1-R5 there are load-
// bearing invariants (yards only, deleted stays deleted, the tee never moves, nothing derived
// twice) - this module is where each of them is actually enforced.

import { makeHole } from '../../golf/js/holegen.js';
import { SPECS, RM_DEFAULTS } from '../../golf/courses/redmesa.js';

export const COURSE_ID = 'redmesa';
export const HOLE_COUNT = 18;
export const STORAGE_KEY = 'golf.holeEditor.redmesa.v1';

export function mintId(slot) {
  return `rm-${String(slot).padStart(2, '0')}`;
}

/** Apply `at` -> `yd` (R1) to one array of placed things. Entries that are already `yd`-based,
 *  poly-based, or x/y-based (no `at`) pass through untouched.
 *
 *  FULL PRECISION, NOT ROUNDED TO 1 DP. `yd = +(at * L).toFixed(1)` is the tool's rule for a
 *  NEW placement (section 6 - a click has no exact fraction to protect), but normalising an
 *  ORIGINAL spec has one job: reproduce it exactly (section 3.2's round-trip contract, "if it
 *  fails, nothing else matters"). Red Mesa 5's fairway bunker (`at: 0.97`) sits inside a station-
 *  rounding margin of about 0.02 yd in `holegen.js`'s `place()` - measured, not theoretical: with
 *  `L = 329.1`, `0.97 * L = 319.227`, and `(319.227).toFixed(1)` is `"319.2"`, which lands on the
 *  wrong side of that margin and silently relocates the bunker by a whole spline station (~4 yd)
 *  after a round trip. Keeping full precision here costs nothing a player would ever see (the
 *  editor still DISPLAYS every yd field rounded to 1 dp) and is what makes the round-trip test
 *  pass for all 18 holes, not just 17. */
function toYd(list, L) {
  if (!list) return list;
  return list.map((o) => {
    if (o == null || o.at == null) return o;
    const { at, ...rest } = o;
    return { ...rest, yd: at * L };
  });
}

/** The tool's own rounding rule (section 6): a NEW yd, authored from a canvas click, is rounded
 *  to 1 dp. There is no prior exact value to protect, so the collapse `toYd` avoids does not
 *  apply here. */
export function roundYd(yd) {
  return +yd.toFixed(1);
}

/** `place()`'s station lookup in holegen.js is `Math.round(at * (stations.length - 1))` - a
 *  DISCRETE index, chosen from a CONTINUOUS `at`. `cardYards` (what `toYd` above has to use as
 *  `L`, since it is the only length `makeHole` exposes) is itself rounded to 1 dp, so `yd = at * L`
 *  can land a hair on the wrong side of a station boundary that the exact, un-rounded internal
 *  arc length would not - measured on two of Red Mesa's eighteen: hole 5's fairway bunker
 *  (`at: 0.97`) and hole 11's water (`at: 0.5`), both landing within ~0.02-0.05 yd of a boundary
 *  purely by coincidence of the hand-authored `at` value. `L` cannot be made exact from outside
 *  (the raw arc length is never returned - only its 1-dp rounding), so this nudges the affected
 *  entry's `yd` by fractions of a yard, RE-BUILDING THE REAL HOLE each try, until the whole built
 *  hole matches the original bit-for-bit. It is a correction against `makeHole`'s own output, not
 *  a second geometry engine (R5) - every candidate is verified by calling `makeHole` itself. */
function fixStationRounding(rawSpec, slot, candidate) {
  const target = JSON.stringify(makeHole({ ...RM_DEFAULTS, ...rawSpec, n: slot }));
  let out = candidate;
  if (JSON.stringify(makeHole({ ...RM_DEFAULTS, ...out, n: slot })) === target) return out;

  for (const field of ['bunkers', 'water', 'trees', 'sentinels', 'cross']) {
    const orig = rawSpec[field];
    if (!orig) continue;
    for (let i = 0; i < orig.length; i++) {
      if (orig[i] == null || orig[i].at == null) continue;
      const entries = out[field];
      const base = entries[i].yd;
      let fixed = null;
      for (let step = 0.001; step <= 0.5 && !fixed; step = +(step + 0.001).toFixed(3)) {
        for (const delta of [step, -step]) {
          const nextEntries = entries.map((e, j) => (j === i ? { ...e, yd: base + delta } : e));
          const nextOut = { ...out, [field]: nextEntries };
          if (JSON.stringify(makeHole({ ...RM_DEFAULTS, ...nextOut, n: slot })) === target) { fixed = nextOut; break; }
        }
      }
      if (fixed) out = fixed;
    }
  }
  const finalCheck = JSON.stringify(makeHole({ ...RM_DEFAULTS, ...out, n: slot }));
  if (finalCheck !== target) {
    throw new Error(`hole-editor: normalise() could not reproduce hole ${slot} exactly - a placed thing sits within 0.5 yd of a station-rounding boundary that this nudge could not clear`);
  }
  return out;
}

/** normalise(rawSpec, slot) - section 3.2. `slot` is the ORIGINAL 1-based position (what mints
 *  the hole's id and pins its randomness); it is never re-derived from anywhere else. */
export function normalise(rawSpec, slot) {
  const { n, fw, fwL, fwR, bunkers, water, trees, sentinels, cross, ...rest } = rawSpec;
  const built0 = makeHole({ ...RM_DEFAULTS, ...rawSpec, n: slot });
  const L = built0.cardYards;

  const out = { ...rest };
  if (fw !== undefined) out.fw = fw;
  if (fwL !== undefined) out.fwL = fwL;
  if (fwR !== undefined) out.fwR = fwR;
  if (bunkers !== undefined) out.bunkers = toYd(bunkers, L);
  if (water !== undefined) out.water = toYd(water, L);
  if (trees !== undefined) out.trees = toYd(trees, L);
  if (sentinels !== undefined) out.sentinels = toYd(sentinels, L);
  if (cross !== undefined) out.cross = toYd(cross, L);

  const fixed = fixStationRounding(rawSpec, slot, out);
  Object.assign(out, fixed);

  // Pinned so a moved hole keeps its shapes (section 3.2 step 4). Using the ORIGINAL slot, not
  // whatever `order` says later.
  if (out.seed == null) out.seed = slot * 977 + 13;
  if (out.greenSeed == null) out.greenSeed = slot * 6151 + 991;
  if (out.hard == null) out.hard = HOLE_COUNT <= 1 ? 0 : (slot - 1) / (HOLE_COUNT - 1);

  return out;
}

/** The frozen originals, keyed by id. Never stored, never mutated; built fresh from `SPECS` every
 *  time this is called. Deep-frozen so an accidental mutation throws instead of corrupting the
 *  one thing Reset and Compare rely on. */
export function originalSpecs() {
  const out = {};
  for (let i = 0; i < SPECS.length; i++) {
    const slot = i + 1;
    out[mintId(slot)] = deepFreeze(normalise(SPECS[i], slot));
  }
  return out;
}

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

/** A fresh document: `order` in original slot order, every hole's spec a (mutable) deep copy of
 *  its normalised original. */
export function createDocument() {
  const originals = originalSpecs();
  const order = [];
  const holes = {};
  for (let i = 0; i < HOLE_COUNT; i++) {
    const id = mintId(i + 1);
    order.push(id);
    holes[id] = { id, spec: JSON.parse(JSON.stringify(originals[id])), broken: null };
  }
  return { version: 1, courseId: COURSE_ID, order, holes };
}

// --- regeneration (section 3.3) ------------------------------------------------------------------

// Built holes are cached per document instance (a WeakMap keyed on the doc object) so switching
// hole and back does not re-run makeHole for nothing; the cache key includes the slot, so a
// reorder invalidates it on its own.
const _cache = new WeakMap();

/** build(doc, id): makeHole wrapped in try/catch (R5 - the editor never derives its own geometry).
 *  On throw, `doc.holes[id].broken` is set to the message and the previous good build (if any) is
 *  returned so the canvas keeps drawing something; a hole that has never built successfully
 *  re-throws. */
export function buildHole(doc, id) {
  let cache = _cache.get(doc);
  if (!cache) { cache = new Map(); _cache.set(doc, cache); }
  const slot = doc.order.indexOf(id) + 1;
  const spec = doc.holes[id].spec;
  const sig = `${slot}|${JSON.stringify(spec)}`;
  const prev = cache.get(id);
  if (prev && prev.sig === sig) return prev.hole;
  try {
    const hole = makeHole({ ...RM_DEFAULTS, ...spec, n: slot });
    doc.holes[id].broken = null;
    cache.set(id, { sig, hole });
    return hole;
  } catch (e) {
    doc.holes[id].broken = String((e && e.message) || e);
    if (prev) return prev.hole;
    throw e;
  }
}

// --- pure mutation helpers (section 3.4) ---------------------------------------------------------
// These return a NEW spec; callers (panels.js / canvas.js) are responsible for pushing undo and
// writing the result back onto doc.holes[id].spec.

/** R4: the tee (path[0]) never moves. Every other waypoint may. */
export function movePathPoint(spec, index, x, y) {
  if (index === 0) throw new Error('hole-editor: path[0] is the tee and cannot be moved (R4)');
  const path = spec.path.map((p, i) => (i === index ? [+x, +y] : p));
  return { ...spec, path };
}

/** R2: deleting a bunker writes `defend: false` on the spec, once, and it stays false - so an
 *  auto-defend bunker can never reappear in its place. `index` is into `spec.bunkers`. */
export function deleteBunker(spec, index) {
  const bunkers = (spec.bunkers || []).filter((_, i) => i !== index);
  return { ...spec, bunkers, defend: false };
}

/** R2: a belt side switched off writes `false`; the other side is preserved. Turning a side back
 *  on restores RM_DEFAULTS for that side. A spec with no `belts` key at all gets BOTH sides copied
 *  in from RM_DEFAULTS first, so the untouched side does not change. */
export function setBeltSide(spec, side, enabled) {
  const other = side === 'left' ? 'right' : 'left';
  let belts;
  if (spec.belts === undefined) {
    belts = { left: RM_DEFAULTS.belts.left, right: RM_DEFAULTS.belts.right };
  } else if (spec.belts === false) {
    belts = { left: false, right: false };
  } else {
    belts = { ...spec.belts };
    if (belts[other] === undefined) belts[other] = RM_DEFAULTS.belts[other];
  }
  belts[side] = enabled ? RM_DEFAULTS.belts[side] : false;
  return { ...spec, belts };
}

// --- undo (section 3.5) ---------------------------------------------------------------------------

export const UNDO_CAP = 200;

export function createEditorState(doc) {
  return { doc, undo: [], redo: [] };
}

function snapshot(doc) {
  return JSON.parse(JSON.stringify({ order: doc.order, holes: doc.holes }));
}

function restore(doc, snap) {
  doc.order = snap.order;
  doc.holes = snap.holes;
}

/** Push the CURRENT state onto the undo stack, before a committed change is applied. Clears redo. */
export function pushUndo(state) {
  state.undo.push(snapshot(state.doc));
  if (state.undo.length > UNDO_CAP) state.undo.shift();
  state.redo = [];
}

export function undo(state) {
  if (!state.undo.length) return false;
  state.redo.push(snapshot(state.doc));
  restore(state.doc, state.undo.pop());
  return true;
}

export function redo(state) {
  if (!state.redo.length) return false;
  state.undo.push(snapshot(state.doc));
  restore(state.doc, state.redo.pop());
  return true;
}

// --- persistence (section 3.6) --------------------------------------------------------------------

export function serialiseDocument(doc) {
  return JSON.stringify({ version: doc.version, courseId: doc.courseId, order: doc.order, holes: doc.holes });
}

/** Returns the parsed document, or null if the string is missing/malformed/a different version -
 *  callers fall back to a fresh document (createDocument()) in that case. */
export function loadDocument(raw) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || parsed.version !== 1) return null;
  return parsed;
}
