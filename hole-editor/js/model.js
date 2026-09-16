// hole-editor/js/model.js - the document, normalisation and pure mutation helpers for the Red
// Mesa hole editor. No DOM here; this is what test-hole-editor.mjs exercises headless.
// HANDOFF-GOLF-HOLE-EDITOR.md section 3 is the spec this file implements. R1-R5 there are load-
// bearing invariants (yards only, deleted stays deleted, the tee never moves, nothing derived
// twice) - this module is where each of them is actually enforced.

import { makeHole, slopeFrom } from '../../golf/js/holegen.js';
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

/** Water tool click (section 6.5). */
export function addWater(spec, { yd, side, off }) {
  const seed0 = spec.seed;
  const water = [...(spec.water || []), { yd: +yd, side, off: +off, rx: 12, ry: 9, seed: nextSeed(spec.water, seed0 + 40) }];
  return { ...spec, water };
}

export function setWaterField(spec, index, fields) {
  const water = spec.water.map((w, i) => (i === index ? { ...w, ...fields } : w));
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
export function moveObject(spec, group, index, { yd, side, off }) {
  const list = spec[group].map((o, i) => {
    if (i !== index) return o;
    if (group === 'cross') return { ...o, yd: +yd };
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
  return pts.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]);
}

/** A drawn bunker (`kind` decides fairway/greenside) or lake from clicked points, smoothed. */
export function addDrawnShape(spec, group, points, kind) {
  if (!points || points.length < 3) return spec;
  const poly = smoothPoly(points);
  const entry = group === 'bunkers' ? { poly, kind: kind || 'greensideBunker' } : { poly };
  return { ...spec, [group]: [...(spec[group] || []), entry] };
}

/** Replace a placed (blob) bunker/lake with a drawn outline in the same slot, keeping `kind`. */
export function setDrawnPoly(spec, group, index, points) {
  if (!points || points.length < 3) return spec;
  const poly = smoothPoly(points);
  const list = spec[group].map((o, i) => (i === index ? (group === 'bunkers' ? { poly, kind: o.kind || 'greensideBunker' } : { poly }) : o));
  return { ...spec, [group]: list };
}

export function translateDrawn(spec, group, index, dx, dy) {
  const list = spec[group].map((o, i) => (i === index && o.poly ? { ...o, poly: o.poly.map((p) => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1)]) } : o));
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

/** Duplicate a placed thing beside itself (12 yd further up the hole, or 12 yd up for a drawn
 *  shape), with a fresh seed so a blob is not the identical blob. Returns the new spec; the copy
 *  is the last entry of its group. */
export function duplicateObject(spec, group, index) {
  const o = spec[group] && spec[group][index];
  if (!o) return spec;
  let copy;
  if (o.poly) copy = { ...o, poly: o.poly.map((p) => [p[0], +(p[1] + 12).toFixed(1)]) };
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
  throw new Error(`hole-editor: unknown object group "${group}"`);
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
