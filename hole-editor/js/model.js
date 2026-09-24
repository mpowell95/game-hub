// hole-editor/js/model.js - the document, normalisation and pure mutation helpers for the Red
// Mesa hole editor. No DOM here; this is what test-hole-editor.mjs exercises headless.
// HANDOFF-GOLF-HOLE-EDITOR.md section 3 is the spec this file implements. R1-R5 there are load-
// bearing invariants (yards only, deleted stays deleted, the tee never moves, nothing derived
// twice) - this module is where each of them is actually enforced.

import { makeHole, slopeFrom } from '../../golf/js/holegen.js';
import { dropLoops } from '../../golf/js/holes.js';
import { PROFILES, defaultsFor } from './course.js';
import { starterSpec, PARKLAND_TYPES, DESERT_TYPES } from './starter.js';
import { OBSTACLE_INDEX } from '../../golf/js/obstacles.js';

// THE ACTIVE COURSE (2026-09-22). Red Mesa until setCourse() says otherwise, so every existing
// caller (and every existing test) sees exactly what it always did. `RM_DEFAULTS` keeps its name
// below because it is used in a dozen makeHole calls; it is simply "the active course's defaults".
export let COURSE = PROFILES.redmesa;
export let COURSE_ID = COURSE.id;
export let HOLE_COUNT = COURSE.specs.length;
export let STORAGE_KEY = COURSE.storageKey;
let SPECS = COURSE.specs;
let RM_DEFAULTS = COURSE.defaults;

/** Point the model at a course profile (course.js). `theme` only matters for the custom course,
 *  whose defaults (obstacle table, rough collar) follow the theme its document carries. */
export function setCourse(profile, theme) {
  COURSE = profile;
  COURSE_ID = profile.id;
  HOLE_COUNT = profile.specs.length;
  STORAGE_KEY = profile.storageKey;
  SPECS = profile.specs;
  RM_DEFAULTS = profile.custom ? defaultsFor(theme || profile.theme) : profile.defaults;
}

/** Forget every cached build for a document - after a theme change, whose defaults are not part
 *  of the cache key. */
export function invalidateBuilds(doc) { _cache.delete(doc); }

export function mintId(slot) {
  return `${COURSE.idPrefix}-${String(slot).padStart(2, '0')}`;
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

/** Build the ORIGINAL hole for an id, at its original slot (never its current position in some
 *  document's `order`) - what Compare (section 7) shows beside the current one. */
export function buildOriginalHole(id, originals) {
  const slot = Number(id.slice(3));
  return makeHole({ ...RM_DEFAULTS, ...(originals || originalSpecs())[id], n: slot });
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
  const doc = { version: 1, courseId: COURSE_ID, order, holes };
  // A custom course carries its own name, theme and hole count; Red Mesa's are the shipped file's.
  // `catalog: 1` says "this document's tree indices are already catalogue indices" - see
  // `migrateDocument`. A document born today has never held the old three-entry indices.
  if (COURSE.custom) { doc.course = { name: COURSE.name, theme: COURSE.theme }; doc.catalog = CATALOG_VERSION; }
  return doc;
}

// --- the custom course's own shape (2026-09-22) ---------------------------------------------------
// Only the blank course adds, removes and renames; Red Mesa is eighteen pages you shuffle.

/** Course name / theme. Returns a NEW doc (holes shared); the caller pushes undo and re-sets the
 *  model's defaults through setCourse() when the theme changed. */
export function setCourseMeta(doc, patch) {
  return { ...doc, course: { ...(doc.course || {}), ...patch } };
}

/** Append one starter hole after the last. Ids never repeat within a document, even after deletes. */
export function addHole(doc) {
  let n = doc.order.length + 1;
  while (doc.holes[mintId(n)]) n++;
  const id = mintId(n);
  const spec = normalise(starterSpec(doc.order.length + 1), doc.order.length + 1);
  return { ...doc, order: [...doc.order, id], holes: { ...doc.holes, [id]: { id, spec, broken: null } } };
}

/** Remove one hole. A course keeps at least three (the shortest round the game offers). */
export function deleteHole(doc, id) {
  if (doc.order.length <= 3 || !doc.holes[id]) return doc;
  const holes = { ...doc.holes }; delete holes[id];
  return { ...doc, order: doc.order.filter((x) => x !== id), holes };
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
/** No waypoint may sit behind the tee: the first real export had one dragged to y 3.6 on a tee at
 *  y 5, and the fairway, rough and belt polygons all folded over on themselves at the tee box. */
export function clampAheadOfTee(spec, y) {
  return Math.max(+y, spec.path[0][1] + 10);
}

export function movePathPoint(spec, index, x, y) {
  if (index === 0) throw new Error('hole-editor: path[0] is the tee and cannot be moved (R4)');
  const path = spec.path.map((p, i) => (i === index ? [+x, clampAheadOfTee(spec, y)] : p));
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

// --- generic field/object mutators (section 6) -----------------------------------------------
// All pure: return a NEW spec, never mutate the one passed in. Callers push undo and write the
// result back onto doc.holes[id].spec, exactly like the R2/R4 helpers above.

/** A scalar Hole-panel field (nickname, par, hard, rough, defend). `undefined` deletes the key -
 *  how the "auto" checkboxes (pinch, rough) work. */
export function setField(spec, key, value) {
  if (value === undefined) { const out = { ...spec }; delete out[key]; return out; }
  return { ...spec, [key]: value };
}

// --- Route (6.2) ---------------------------------------------------------------------------

export function insertWaypoint(spec, index, x, y) {
  const path = spec.path.slice();
  path.splice(index, 0, [+x, +y]);
  return { ...spec, path };
}

/** A path always keeps at least 2 points (section 6.2); index 0 (the tee) is never removable (R4). */
export function removeWaypoint(spec, index) {
  if (index === 0) throw new Error('hole-editor: path[0] is the tee and cannot be removed (R4)');
  if (spec.path.length <= 2) return spec;
  const path = spec.path.filter((_, i) => i !== index);
  return { ...spec, path };
}

export function straightenPath(spec) {
  return { ...spec, path: [spec.path[0], spec.path[spec.path.length - 1]] };
}

/** Dogleg left/right (section 6.2): one waypoint at the drive landing distance, offset 28 yd to
 *  `side` of the straight tee-pin line, replacing any existing waypoint within 40 yd of that
 *  station. `length` is the built hole's own `cardYards` (R5 - never re-derived). */
export function insertDogleg(spec, side, length) {
  const zoneYd = spec.par <= 3 ? length * 0.55 : 215;
  const tee = spec.path[0];
  const pin = spec.path[spec.path.length - 1];
  const dx = pin[0] - tee[0]; const dy = pin[1] - tee[1];
  const lineLen = Math.hypot(dx, dy) || 1;
  const ux = dx / lineLen; const uy = dy / lineLen; // along the straight tee-pin line
  const nx = uy; const ny = -ux;                    // one normal; `side` picks the sign
  const t = Math.max(0, Math.min(1, zoneYd / lineLen));
  const bx = tee[0] + dx * t; const by = tee[1] + dy * t;
  const point = [+(bx + nx * 28 * side).toFixed(1), +(by + ny * 28 * side).toFixed(1)];

  const path = spec.path.filter((p, i) => {
    if (i === 0 || i === spec.path.length - 1) return true;
    return Math.hypot(p[0] - bx, p[1] - by) > 40;
  });
  // Insert in arc-order: after the last remaining point closer to the tee than `t`.
  let insertAt = 1;
  for (let i = 1; i < path.length - 1; i++) {
    const pd = Math.hypot(path[i][0] - tee[0], path[i][1] - tee[1]);
    if (pd < zoneYd) insertAt = i + 1;
  }
  path.splice(insertAt, 0, point);
  return { ...spec, path };
}

// --- Width (6.3) -----------------------------------------------------------------------------

function widthProfile(spec, side) {
  if (side === 'L' && spec.fwL) return spec.fwL;
  if (side === 'R' && spec.fwR) return spec.fwR;
  return Array.isArray(spec.fw) ? spec.fw : [{ at: 0, w: spec.fw || 15 }, { at: 1, w: spec.fw || 15 }];
}

/** Set one control point's width, on `fw` (symmetric) unless the spec already has a `fwL`/`fwR`
 *  override for that side, in which case that side's own profile is edited instead (section 6.3). */
export function setWidthPoint(spec, side, index, w) {
  const key = spec.fwL || spec.fwR ? (side === -1 ? 'fwL' : 'fwR') : 'fw';
  const profile = key === 'fw' ? widthProfile(spec, null) : widthProfile(spec, side === -1 ? 'L' : 'R');
  const next = profile.map((p, i) => (i === index ? { ...p, w: +w } : p));
  return { ...spec, [key]: next };
}

export function insertWidthPoint(spec, side, at) {
  const key = spec.fwL || spec.fwR ? (side === -1 ? 'fwL' : 'fwR') : 'fw';
  const profile = key === 'fw' ? widthProfile(spec, null) : widthProfile(spec, side === -1 ? 'L' : 'R');
  const w = profile[0] ? profile[0].w : 15;
  const next = [...profile, { at: +at, w }].sort((a, b) => a.at - b.at);
  return { ...spec, [key]: next };
}

/** Minimum 2 points; `at` 0 and 1 always present (section 6.3). */
export function deleteWidthPoint(spec, side, index) {
  const key = spec.fwL || spec.fwR ? (side === -1 ? 'fwL' : 'fwR') : 'fw';
  const profile = key === 'fw' ? widthProfile(spec, null) : widthProfile(spec, side === -1 ? 'L' : 'R');
  if (profile.length <= 2) return spec;
  const p = profile[index];
  if (p && (p.at === 0 || p.at === 1)) return spec;
  const next = profile.filter((_, i) => i !== index);
  return { ...spec, [key]: next };
}

/** Scale every width control point by the same factor, on every profile the spec actually has -
 *  `fw` alone, or `fwL`/`fwR` if it has those instead (section 6.3's "base width, whole hole"). */
export function scaleWidth(spec, factor) {
  const out = { ...spec };
  for (const key of ['fw', 'fwL', 'fwR']) {
    if (Array.isArray(spec[key])) out[key] = spec[key].map((p) => ({ ...p, w: +(p.w * factor).toFixed(1) }));
  }
  return out;
}

// --- generic placed-object list mutators (Bunker/Water/Tree/Stand/Cross, sections 6.4-6.6/6.10) ---

function nextSeed(list, base) {
  const used = (list || []).map((o) => o.seed).filter((s) => s != null);
  return used.length ? Math.max(base - 1, ...used) + 1 : base;
}

/** Bunker tool click (section 6.4). `length` is the built hole's cardYards; `pinYd` defaults to
 *  `length` (the pin sits at the end of the hole by construction). */
export function addBunker(spec, { yd, side, off }, length, chosenKind) {
  const seed0 = spec.seed;
  const kind = chosenKind || ((length - yd) <= 40 ? 'greensideBunker' : 'fairwayBunker');
  const bunkers = [...(spec.bunkers || []), { yd: +yd, side, off: +off, r: 10, ry: 7, kind, seed: nextSeed(spec.bunkers, seed0 + 80) }];
  return { ...spec, bunkers };
}

export function setBunkerField(spec, index, fields) {
  const bunkers = spec.bunkers.map((b, i) => (i === index ? { ...b, ...fields } : b));
  return { ...spec, bunkers };
}

export function rerollBunker(spec, index) {
  const b = spec.bunkers[index];
  return setBunkerField(spec, index, { seed: (b.seed || 0) + 1 });
}

/** Water tool click (section 6.5). `kind` is 'water' (the default) or 'swamp' - both live in the
 *  same `water` list because holegen.js lays them at the same layer and builds them the same way;
 *  only the surface kind differs, and with it the whole of how the hole plays there (a lake is a
 *  penalty drop, a swamp is a lie you hit out of at 55 % power). An absent `kind` is never written,
 *  so an existing lake's entry is byte-identical to what it was before this option existed. */
export function addWater(spec, { yd, side, off }, kind) {
  const seed0 = spec.seed;
  const entry = { yd: +yd, side, off: +off, rx: 12, ry: 9, seed: nextSeed(spec.water, seed0 + 40) };
  if (kind === 'swamp' || kind === 'tallGrass' || kind === 'oob') entry.kind = kind;   // tall grass (2026-09-23) rides the same list
  const water = [...(spec.water || []), entry];
  return { ...spec, water };
}

/** `fields` may carry `kind: 'swamp'` to turn a lake into a swamp, or `kind: 'water'` to turn it
 *  back - and 'water' DELETES the key rather than writing it, so a lake's entry stays the shape
 *  every hole in the repo already has (holegen.js reads an absent kind as water). */
export function setWaterField(spec, index, fields) {
  const water = spec.water.map((w, i) => {
    if (i !== index) return w;
    const next = { ...w, ...fields };
    if (next.kind !== 'swamp' && next.kind !== 'tallGrass' && next.kind !== 'oob') delete next.kind;
    return next;
  });
  return { ...spec, water };
}

export function deleteWater(spec, index) {
  return { ...spec, water: (spec.water || []).filter((_, i) => i !== index) };
}

export function rerollWater(spec, index) {
  const w = spec.water[index];
  return setWaterField(spec, index, { seed: (w.seed || 0) + 1 });
}

/** Tree tool: a single specimen (section 6.6). */
export function addTree(spec, { yd, side, off, type }) {
  const trees = [...(spec.trees || []), { yd: +yd, side, off: +off, type: type || 0 }];
  return { ...spec, trees };
}

export function setTreeField(spec, index, fields) {
  const trees = spec.trees.map((t, i) => (i === index ? { ...t, ...fields } : t));
  return { ...spec, trees };
}

export function deleteTree(spec, index) {
  return { ...spec, trees: (spec.trees || []).filter((_, i) => i !== index) };
}

/** Tree tool: a stand (section 6.6). */
export function addSentinel(spec, { yd, side, off, type }) {
  const sentinels = [...(spec.sentinels || []), { yd: +yd, side, off: +off, n: 5, spread: 7, type: type || 0 }];
  return { ...spec, sentinels };
}

export function setSentinelField(spec, index, fields) {
  const sentinels = spec.sentinels.map((s, i) => (i === index ? { ...s, ...fields } : s));
  return { ...spec, sentinels };
}

export function deleteSentinel(spec, index) {
  return { ...spec, sentinels: (spec.sentinels || []).filter((_, i) => i !== index) };
}

/** Cross tool (section 6.10). */
export function addCross(spec, { yd, kind, depth, over }) {
  const entry = { yd: +yd, kind: kind || 'water', depth: depth == null ? 22 : depth };
  if (over != null && over !== 8) entry.over = over;   // 8 is holegen's own default; only write a real choice
  const cross = [...(spec.cross || []), entry];
  return { ...spec, cross };
}

export function setCrossField(spec, index, fields) {
  const cross = spec.cross.map((c, i) => (i === index ? { ...c, ...fields } : c));
  return { ...spec, cross };
}

export function deleteCross(spec, index) {
  return { ...spec, cross: (spec.cross || []).filter((_, i) => i !== index) };
}

/** Select tool drag (section 6.1): move a placed thing (not the tee/waypoints, not guards) to a
 *  new {yd, side, off}. `group` is 'bunkers' | 'water' | 'trees' | 'sentinels' | 'cross'. A DRAWN
 *  object (one with its own `poly`, see `addDrawnShape`) has no yd/side/off: it is translated. */
export function moveObject(spec, group, index, { yd, side, off, x, y }) {
  const list = spec[group].map((o, i) => {
    if (i !== index) return o;
    if (group === 'cross') return { ...o, yd: +yd };
    // A decor SPRITE is placed in world yards (see "Decor" below), so it is moved by its point.
    if (Array.isArray(o.at)) return { ...o, at: [+(+x).toFixed(1), +(+y).toFixed(1)] };
    return { ...o, yd: +yd, side, off: +off };
  });
  return { ...spec, [group]: list };
}

// --- drawn shapes, duplicate, resize (Matt, 2026-09-16) ------------------------------------------
//
// Matt: *"can i resize objects like bunkers and bodies of water on the map... small white squares
// on the sides that i can click and drag... And instead of 'reroll shape' can i draw shapes?"*
//
// A drawn bunker or lake is `{poly, kind}` / `{poly}` - the form holegen.js has always accepted
// beside the seeded blob ("or handed a polygon outright for a shape a blob cannot be"). Its points
// are world yards, which for a hole whose tee never moves (R4) IS yards from the tee, so R1 holds.
// Nothing is derived twice: the polygon a person draws is the polygon the game paints.

export function polyCentroid(poly) {
  let x = 0; let y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

/** Chaikin's corner-cutting on a CLOSED polygon: the handful of points a person clicks becomes a
 *  rounded outline, the way a real bunker's edge is. Two passes turn a 5-click pentagon into 20
 *  smooth points; it can never self-intersect if the clicked outline did not. */
export function smoothPoly(points, passes = 2) {
  let pts = points.map((p) => [+p[0], +p[1]]);
  for (let k = 0; k < passes; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  // A traced outline whose last points double back makes a tiny loop the game refuses; cut it.
  return dropLoops(pts.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]));
}

/** A drawn bunker (`kind` decides fairway/greenside), lake or swamp from clicked points, smoothed.
 *  For the `water` group `kind` is 'water' (or absent) for a lake and 'swamp' for a swamp; a lake
 *  is still written as a bare `{poly}`, exactly as it always was. */
export function addDrawnShape(spec, group, points, kind) {
  // A power line is drawn with the same click-points flow, but it is a polyline, not a closed
  // outline: never smoothed, and two points are enough.
  if (group === 'lines') return addLine(spec, points, undefined, kind);
  if (!points || points.length < 3) return spec;
  const poly = smoothPoly(points);
  const entry = group === 'bunkers'
    ? { poly, kind: kind || 'greensideBunker' }
    : (group === 'water' && (kind === 'swamp' || kind === 'tallGrass' || kind === 'oob') ? { poly, kind }
      : (group === 'decor' && kind === 'flowerbed' ? { poly, kind: 'flowerbed' } : { poly }));
  return { ...spec, [group]: [...(spec[group] || []), entry] };
}

/** Replace a placed (blob) bunker/lake with a drawn outline in the same slot, keeping `kind`. */
export function setDrawnPoly(spec, group, index, points) {
  if (!points || points.length < 3) return spec;
  const poly = smoothPoly(points);
  const list = spec[group].map((o, i) => (i === index
    ? (group === 'bunkers' ? { poly, kind: o.kind || 'greensideBunker' } : (o.kind ? { poly, kind: o.kind } : { poly }))
    : o));
  return { ...spec, [group]: list };
}

export function translateDrawn(spec, group, index, dx, dy) {
  const shift = (pts) => pts.map((p) => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1)]);
  const list = spec[group].map((o, i) => {
    if (i !== index) return o;
    if (o.poly) return { ...o, poly: shift(o.poly) };
    if (group === 'lines' && Array.isArray(o.pts)) return { ...o, pts: shift(o.pts) };   // a whole power line
    return o;
  });
  return { ...spec, [group]: list };
}

/** Resize about the object's own centre. A blob scales `r`/`ry` (bunker) or `rx`/`ry` (water);
 *  a drawn shape scales its points. `fx`/`fy` are multipliers (1 = unchanged). */
export function scaleObject(spec, group, index, fx, fy) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const list = spec[group].map((o, i) => {
    if (i !== index) return o;
    if (o.poly) {
      const [cx, cy] = polyCentroid(o.poly);
      return { ...o, poly: o.poly.map((p) => [+(cx + (p[0] - cx) * fx).toFixed(1), +(cy + (p[1] - cy) * fy).toFixed(1)]) };
    }
    if (group === 'bunkers') {
      const r = o.r || 6; const ry = o.ry || r * 0.72;
      return { ...o, r: +clamp(r * fx, 2, 40).toFixed(1), ry: +clamp(ry * fy, 2, 40).toFixed(1) };
    }
    const rx = o.rx; const ry = o.ry == null ? rx : o.ry;
    return { ...o, rx: +clamp(rx * fx, 2, 80).toFixed(1), ry: +clamp(ry * fy, 2, 80).toFixed(1) };
  });
  return { ...spec, [group]: list };
}

/** DETACH the green's guard tokens into ordinary objects (Matt, 2026-09-16, hole 6: *"I cannot
 *  select, move, or delete them"*). A token is a recipe (`frontJaws` = two bunkers pinching the
 *  front); once detached, each hazard it produced becomes a drawn bunker / lake / a placed tree
 *  in the spec, and the token is removed. The hazards are found by DIFFERENCE - the hole built
 *  with the tokens against the hole built without them - so this never re-derives holegen's
 *  geometry (R5); it reads what makeHole painted. `slot` is the hole number for the build. */
export function detachGuards(spec, slot) {
  const guard = spec.guard || [];
  if (!guard.length) return spec;
  const withG = makeHole({ ...RM_DEFAULTS, ...spec, n: slot });
  const without = makeHole({ ...RM_DEFAULTS, ...spec, guard: [], n: slot });
  const key = (poly) => JSON.stringify(poly);
  const base = new Set(without.surfaces.filter((s) => Array.isArray(s.poly)).map((s) => key(s.poly)));
  const bunkers = [...(spec.bunkers || [])];
  const water = [...(spec.water || [])];
  for (const s of withG.surfaces) {
    if (!Array.isArray(s.poly) || base.has(key(s.poly))) continue;
    if (s.kind === 'greensideBunker' || s.kind === 'fairwayBunker') bunkers.push({ poly: s.poly, kind: s.kind });
    else if (s.kind === 'water') water.push({ poly: s.poly });
  }
  const baseTrees = new Set(without.trees.map((t) => `${t.x},${t.y}`));
  const trees = [...(spec.trees || [])];
  for (const t of withG.trees) if (!baseTrees.has(`${t.x},${t.y}`)) trees.push({ x: t.x, y: t.y, type: t.type });
  const out = { ...spec, bunkers, water, trees };
  delete out.guard;
  return out;
}

/** An S-bend (Matt, 2026-09-16: "a dogleg left between the first 2 points, then back to the
 *  right after"): two waypoints, the first at the drive landing distance offset to `firstSide`,
 *  the second ~120 yd on, offset the other way, so the hole swings out and comes back. Replaces
 *  the middle waypoints. */
export function insertSBend(spec, firstSide, length) {
  const tee = spec.path[0];
  const pin = spec.path[spec.path.length - 1];
  const dx = pin[0] - tee[0]; const dy = pin[1] - tee[1];
  const lineLen = Math.hypot(dx, dy) || 1;
  const ux = dx / lineLen; const uy = dy / lineLen;
  const nx = uy; const ny = -ux;
  const d1 = Math.min(215, lineLen * 0.45);
  const d2 = Math.min(lineLen - 60, d1 + Math.max(90, lineLen * 0.3));
  const p1 = [+(tee[0] + ux * d1 + nx * 24 * firstSide).toFixed(1), +(tee[1] + uy * d1 + ny * 24 * firstSide).toFixed(1)];
  const p2 = [+(tee[0] + ux * d2 - nx * 20 * firstSide).toFixed(1), +(tee[1] + uy * d2 - ny * 20 * firstSide).toFixed(1)];
  return { ...spec, path: [tee, p1, p2, pin] };
}

// --- the green's own outline, fringe widths and pins (Matt, 2026-09-16) --------------------------

/** A drawn putting surface: the clicked corners, rounded, become `greenOutline` (world yards).
 *  The shape family / angle / radii stop mattering for the shape (holegen keeps them only as the
 *  reach the fairway stops short of), so they are left in place for "Use preset shape" to return
 *  to. Pins outside the new outline are dropped rather than left invalid. */
export function setGreenOutline(spec, points) {
  if (!points || points.length < 3) return spec;
  const greenOutline = smoothPoly(points);
  const out = { ...spec, greenOutline };
  if (Array.isArray(spec.pins)) {
    const inside = spec.pins.filter((p) => pointInPolyLocal(p, greenOutline));
    if (inside.length) out.pins = inside; else delete out.pins;
  }
  return out;
}

export function clearGreenOutline(spec) {
  const out = { ...spec };
  delete out.greenOutline;
  delete out.pins;             // a preset green is a different shape; old pins may fall outside it
  return out;
}

/** `fringe` is a number (same all round) or {front, right, back, left} in yards. `undefined`
 *  restores holegen's default of 6. */
export function setFringe(spec, fringe) {
  const out = { ...spec };
  if (fringe == null) delete out.fringe; else out.fringe = fringe;
  return out;
}

function pointInPolyLocal(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1]; const xj = poly[j][0]; const yj = poly[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Pins are world points on the green. One is simply where the cup is; two or more and the game
 *  picks one each time the hole is played (golf/js/ui.js). */
export function addPin(spec, x, y) {
  const pins = [...(spec.pins || []), [+(+x).toFixed(1), +(+y).toFixed(1)]];
  return { ...spec, pins };
}

export function movePin(spec, index, x, y) {
  const pins = (spec.pins || []).map((p, i) => (i === index ? [+(+x).toFixed(1), +(+y).toFixed(1)] : p));
  return { ...spec, pins };
}

export function deletePin(spec, index) {
  const pins = (spec.pins || []).filter((_, i) => i !== index);
  const out = { ...spec, pins };
  if (!pins.length) delete out.pins;
  return out;
}

/** Duplicate a placed thing beside itself (12 yd further up the hole, or 12 yd up for a drawn
 *  shape), with a fresh seed so a blob is not the identical blob. Returns the new spec; the copy
 *  is the last entry of its group. */
export function duplicateObject(spec, group, index) {
  const o = spec[group] && spec[group][index];
  if (!o) return spec;
  let copy;
  if (o.poly) copy = { ...o, poly: o.poly.map((p) => [p[0], +(p[1] + 12).toFixed(1)]) };
  else if (group === 'lines') copy = { ...o, pts: o.pts.map((p) => [p[0], +(p[1] + 12).toFixed(1)]) };
  else if (Array.isArray(o.at)) copy = { ...o, at: [o.at[0], +(o.at[1] + 12).toFixed(1)] };
  else {
    copy = { ...o, yd: +(o.yd + 12).toFixed(1) };
    if (o.seed != null) copy.seed = nextSeed(spec[group], o.seed);
  }
  return { ...spec, [group]: [...spec[group], copy] };
}

/** Select tool Delete key (section 6.1). Bunkers go through `deleteBunker` for R2; every other
 *  group is a plain removal - deletion is only "sticky" (R2) for bunkers, per the handoff. */
export function deleteObject(spec, group, index) {
  if (group === 'bunkers') return deleteBunker(spec, index);
  if (group === 'water') return deleteWater(spec, index);
  if (group === 'trees') return deleteTree(spec, index);
  if (group === 'sentinels') return deleteSentinel(spec, index);
  if (group === 'cross') return deleteCross(spec, index);
  if (group === 'decor') return deleteDecor(spec, index);
  if (group === 'lines') return deleteLine(spec, index);
  if (group === 'pins') return deletePin(spec, index);
  throw new Error(`hole-editor: unknown object group "${group}"`);
}

// --- Decor: art only, never consulted for anything (2026-09-22) --------------------------------
//
// docs/HANDOFF-GOLF-OBJECTS.md section 4. Two forms, and the difference is the `poly`:
//
//   { poly, kind: 'path' }                         a drawn cart path (the existing draw flow,
//                                                  group 'decor'; `kind` defaults to 'path')
//   { at: [x, y], kind: 'bench'|'sign'|'flagpole', rot }   a sprite, 3-4 yds across, `rot` degrees
//
// DECOR CANNOT AFFECT PLAY, and that is the whole reason it is a separate list rather than a
// surface or a tree: nothing in shot.js, clubs.js or holes.js reads it, so art can be added to a
// hole without a physics review. Anything that should stop a ball is a tree object (the catalogue
// has a log and three rocks for exactly that), never a decor sprite.
//
// A sprite is stored in WORLD YARDS like a drawn shape, not as {yd, side, off} - it is placed
// relative to the ground, not to the corridor, so a route edit must not drag the clubhouse sign
// sideways with it.

/** The sprite kinds a decor entry may take. 'path' is the drawn polygon; the rest are sprites. */
export const DECOR_KINDS = ['path', 'bench', 'sign', 'flagpole', 'flowerbed'];

export function addDecor(spec, kind, x, y) {
  const k = DECOR_KINDS.includes(kind) && kind !== 'path' ? kind : 'bench';
  const entry = { at: [+(+x).toFixed(1), +(+y).toFixed(1)], kind: k, rot: 0 };
  return { ...spec, decor: [...(spec.decor || []), entry] };
}

/** Patch one decor entry: `{ kind }`, `{ rot }`, or `{ at: [x, y] }` from a drag. */
export function setDecorField(spec, index, fields) {
  const decor = (spec.decor || []).map((d, i) => (i === index ? { ...d, ...fields } : d));
  return { ...spec, decor };
}

export function deleteDecor(spec, index) {
  const decor = (spec.decor || []).filter((_, i) => i !== index);
  const out = { ...spec, decor };
  if (!decor.length) delete out.decor;
  return out;
}

// --- Power lines (2026-09-22, docs/HANDOFF-GOLF-POWER-LINES.md section 3) -----------------------
//
// `lines: [{ pts: [[x, y], ...], h }]`, in WORLD yards like a drawn shape (a wire is strung
// between points on the ground, not along the corridor, so a route edit must not drag it). `h` is
// the wire's height, 4..20, default 10. holegen.js puts a pole tree at every point and turns `h`
// into the band `{lo: h - 1.0, hi: h + 0.6}` that golf/js/shot.js's `wireHit` reads.

const LINE_H_MIN = 4;
const LINE_H_MAX = 20;
const clampLineH = (h) => Math.max(LINE_H_MIN, Math.min(LINE_H_MAX, Number.isFinite(+h) ? +h : 10));
const linePts = (pts) => (pts || []).map((p) => [+(+p[0]).toFixed(1), +(+p[1]).toFixed(1)]);

/** A new power line through `pts` (2 or more clicked points; fewer is a no-op). */
export function addLine(spec, pts, h, kind) {
  if (!Array.isArray(pts) || pts.length < 2) return spec;
  // A HEDGE (2026-09-24) is a line of `kind: 'hedge'`: same points, its own height range (0.8-4 yd).
  if (kind === 'hedge') return { ...spec, lines: [...(spec.lines || []), { pts: linePts(pts), h: clampHedgeH(h == null ? 2 : h), kind: 'hedge' }] };
  return { ...spec, lines: [...(spec.lines || []), { pts: linePts(pts), h: clampLineH(h == null ? 10 : h) }] };
}
const clampHedgeH = (h) => Math.max(0.8, Math.min(4, Math.round(+h * 10) / 10 || 2));

/** Patch one field of line `i`: `'h'` (clamped to 4..20) or `'pts'` (2+ points, else no-op). */
export function setLineField(spec, i, field, value) {
  const list = spec.lines || [];
  if (!list[i]) return spec;
  let patch;
  if (field === 'h') patch = { h: list[i].kind === 'hedge' ? clampHedgeH(value) : clampLineH(value) };
  else if (field === 'pts') {
    if (!Array.isArray(value) || value.length < 2) return spec;
    patch = { pts: linePts(value) };
  } else return spec;
  return { ...spec, lines: list.map((ln, k) => (k === i ? { ...ln, ...patch } : ln)) };
}

/** Drag point `k` of line `i` (its pole moves with it: poles are built from these points). */
export function moveLinePoint(spec, i, k, x, y) {
  const ln = (spec.lines || [])[i];
  if (!ln || !ln.pts[k]) return spec;
  const pts = ln.pts.map((p, j) => (j === k ? [+(+x).toFixed(1), +(+y).toFixed(1)] : p));
  return { ...spec, lines: spec.lines.map((l, j) => (j === i ? { ...l, pts } : l)) };
}

export function deleteLine(spec, i) {
  const lines = (spec.lines || []).filter((_, k) => k !== i);
  const out = { ...spec, lines };
  if (!lines.length) delete out.lines;
  return out;
}

// --- Belts (6.7) -----------------------------------------------------------------------------

export function setBeltField(spec, side, fields) {
  const belts = spec.belts && spec.belts !== false ? { ...spec.belts } : { left: RM_DEFAULTS.belts.left, right: RM_DEFAULTS.belts.right };
  const current = belts[side] && belts[side] !== false ? belts[side] : RM_DEFAULTS.belts[side];
  belts[side] = { ...current, ...fields };
  return { ...spec, belts };
}

// --- Green (6.8) -----------------------------------------------------------------------------

export function setGreenField(spec, fields) {
  return { ...spec, ...fields };
}

export function rerollGreen(spec) {
  return { ...spec, greenSeed: (spec.greenSeed || 0) + 1 };
}

/** Guard order is authoring order (section 6.8: "order in guard = the order checked"). */
export function toggleGuard(spec, token, on) {
  const guard = spec.guard || [];
  if (on) return guard.includes(token) ? spec : { ...spec, guard: [...guard, token] };
  return { ...spec, guard: guard.filter((g) => g !== token) };
}

// --- Slope (6.9) -----------------------------------------------------------------------------

export function setSlopePreset(spec, name, slopeK) {
  const out = { ...spec, slope: name };
  if (slopeK != null) out.slopeK = slopeK; else delete out.slopeK;
  return out;
}

/** Entering Paint from a preset bakes it into cells first (section 6.9), via `slopeFrom` -
 *  imported from holegen.js, never re-derived. */
export function bakeSlopeToCells(spec) {
  const cells = slopeFrom(spec.slope || { fall: [0, -0.15] }, spec.slopeK == null ? 1 : spec.slopeK);
  const out = { ...spec, slope: cells };
  delete out.slopeK;
  return out;
}

export function setSlopeCell(spec, row, col, vec) {
  const sl = spec.slope && spec.slope.cells ? spec.slope : { cols: 8, rows: 8, cells: new Array(64).fill(0).map(() => [0, 0]) };
  const cells = sl.cells.slice();
  cells[row * sl.cols + col] = vec;
  return { ...spec, slope: { ...sl, cells } };
}

export function flattenSlope(spec) {
  const sl = spec.slope && spec.slope.cells ? spec.slope : { cols: 8, rows: 8 };
  return { ...spec, slope: { cols: sl.cols, rows: sl.rows, cells: new Array(sl.cols * sl.rows).fill(0).map(() => [0, 0]) } };
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
  return JSON.stringify({ version: doc.version, courseId: doc.courseId, ...(doc.course ? { course: doc.course } : {}), ...(doc.catalog ? { catalog: doc.catalog } : {}), order: doc.order, holes: doc.holes });
}

/** Returns the parsed document, or null if the string is missing/malformed/a different version -
 *  callers fall back to a fresh document (createDocument()) in that case. */
export function loadDocument(raw) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || parsed.version !== 1) return null;
  // EVERY ROUTE INTO THE EDITOR COMES THROUGH HERE - localStorage, an imported .json file, and a
  // shared draft pulled out of Firebase (main.js) - which is why the catalogue migration lives at
  // this one door rather than at three.
  return migrateDocument(parsed);
}

// --- the obstacle-catalogue migration (2026-09-22) ------------------------------------------------
//
// THE LAW rule 3: a saved draft must come back as the course its designer drew, and every tree in
// it CAN be carried, so every tree in it is carried.
//
// Before the catalogue (golf/js/obstacles.js) the Course Creator handed each look a THREE-entry
// obstacle table and a placed tree stored an index 0-2 into it. The catalogue is one shared
// seventeen-entry table for both looks, so those indices mean something different now - and a
// desert draft is the case that would actually break: its 0 meant `saguaro`, and unmigrated it
// would come back as `pine`. (Parkland's old table happens to be the catalogue's first three
// entries in the same order, so its numbers survive untouched; the map below states that by NAME
// rather than relying on it.)
//
// It runs EXACTLY ONCE per document. `catalog: 1` is stamped on the way out, so re-opening a
// migrated draft cannot re-index it a second time - a migration that ran twice would walk every
// tree further down the catalogue on every load, which is the silent-corruption shape rules 3 and
// 7 exist for. Red Mesa documents are NEVER touched: that course has its own frozen table.
export const CATALOG_VERSION = 1;

/** Old three-entry index -> catalogue index, per look. Derived from the pre-catalogue tables kept
 *  in starter.js, BY NAME, so neither side can be silently renumbered. */
const CATALOG_REMAP = {
  parkland: PARKLAND_TYPES.map((t) => OBSTACLE_INDEX[t.name]),
  desert: DESERT_TYPES.map((t) => OBSTACLE_INDEX[t.name]),
};

/** Re-index one pre-catalogue tree/stand/belt `type` under a look. An index the old table never
 *  had is left exactly as it is: carrying it forward wrongly would be worse than leaving a number
 *  that at least still points somewhere. */
function remapType(type, look) {
  const map = CATALOG_REMAP[look] || CATALOG_REMAP.parkland;
  const i = type == null ? 0 : type;         // absent meant 0 (holegen's own `t.type || 0`)
  return map[i] == null ? type : map[i];
}

/** Bring a stored document onto the obstacle catalogue. Returns the SAME object when there is
 *  nothing to do (a Red Mesa document, or one already stamped), so this is safe to call on
 *  everything that comes through `loadDocument`. */
export function migrateDocument(doc) {
  if (!doc || doc.courseId !== 'custom' || doc.catalog) return doc;
  const look = (doc.course && doc.course.theme) === 'desert' ? 'desert' : 'parkland';
  const holes = {};
  for (const [id, hole] of Object.entries(doc.holes || {})) {
    const spec = { ...(hole && hole.spec) };
    for (const group of ['trees', 'sentinels']) {
      if (!Array.isArray(spec[group])) continue;
      spec[group] = spec[group].map((o) => ({ ...o, type: remapType(o.type, look) }));
    }
    // A belt only carries a `type` once the designer has touched that side; an untouched one takes
    // the look's default, which is already a catalogue index (starter.js). Both are handled.
    if (spec.belts && spec.belts !== false) {
      const belts = { ...spec.belts };
      for (const side of ['left', 'right']) {
        if (belts[side] && belts[side] !== false) belts[side] = { ...belts[side], type: remapType(belts[side].type, look) };
      }
      spec.belts = belts;
    }
    holes[id] = { ...hole, spec };
  }
  return { ...doc, holes, catalog: CATALOG_VERSION };
}
