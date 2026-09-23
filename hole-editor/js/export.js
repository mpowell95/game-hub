// hole-editor/js/export.js - generates redmesa.js text from the document. Pure and node-testable
// (test-hole-editor.mjs writes it to a temp file and import()s it). HANDOFF-GOLF-HOLE-EDITOR.md
// section 8. Never templated from the current file: it is text generation from the document, plus
// three blocks copied verbatim (the header comment, DESERT_TYPES, RM_DEFAULTS/rm and RED_MESA).

import { serialiseDocument } from './model.js';
import { slugOf, defaultsFor } from './course.js';
import { THEME_DEFAULTS } from './starter.js';

// --- verbatim blocks (section 8.1/8.2) -----------------------------------------------------------
// Copied from golf/courses/redmesa.js as shipped. If that file's header, obstacle table or house
// defaults ever change, copy the change here too - this is the one place outside the game file
// itself where they are duplicated on purpose (the export has to stand alone).

const HEADER = `// golf/courses/redmesa.js - RED MESA, eighteen holes of high desert. The second course, and
// deliberately nothing like the first.
//
// Pine Valley is a wooded parkland course: green from edge to edge, corridors walled with pines,
// water as the recurring hazard. Red Mesa is its opposite in every axis that the engine can
// actually express, which is the whole point of building a second course rather than eighteen
// more of the same:
//
//  - THE GROUND IS THE HAZARD. \`base\` is the desert floor, and the turf is a narrow irrigated
//    ribbon laid on top of it. On Pine Valley the fairway sits inside rough inside woods; here the
//    fairway simply STOPS and there is red dirt and rock. Missing by ten yards is a different kind
//    of miss.
//  - THE OBSTACLES ARE NOT TREES. A saguaro is a pillar - you cannot fly it with anything and it
//    is barely wider than its own trunk, so it is gone around or hit. A palo verde is low and wide:
//    trivial to fly, awkward to walk out from under. A BOULDER blocks at any height at all. That is
//    three genuinely different obstacle behaviours out of the same \`{trunk, canopy, height}\` triple
//    the pines already used, with no engine change.
//  - IT IS SHORTER AND TIGHTER. Par 71 over ~6,200 yards against Pine Valley's 72 over ~6,500, but
//    the corridors are narrower and there is far less rough between the turf and trouble.
//
// Built entirely with \`makeHole()\` (golf/js/holegen.js) from design specs; every hole passes
// validateHole() and golf/js/test.js plays all eighteen out with clean strikes.
//
// Yards throughout. x across the hole (right positive), y up it away from the tee.`;

const IMPORT_AND_DEFAULTS = `import { makeHole } from '../js/holegen.js';

/** Red Mesa's obstacle table. All three are \`trees\` to the engine, and all three behave
 *  differently, which is the point of the {trunk, canopy, height} triple.
 *
 *  A saguaro CANNOT BE FLOWN: its canopy stops at 15 yards and nothing in the bag peaks under that
 *  from any meaningful distance, so in practice it only ever blocks with its trunk - a narrow
 *  pillar to go round. A palo verde is the reverse: 8 yards tall and 6.5 wide, so any wedge clears
 *  it and a long iron never will. A boulder's canopy equals its trunk at 30 yards of height, which
 *  is this engine's way of saying "solid": it blocks at any height, from any club.
 */
const DESERT_TYPES = [
  { name: 'saguaro', trunk: 0.9, canopy: 1.8, height: 15 },
  { name: 'paloverde', trunk: 0.7, canopy: 6.5, height: 8 },
  // 40, NOT 30. MEASURED: the highest-peaking club in the stock bag is the 8 iron at 32.3 yds of
  // apex, so a 30 yd boulder could be flown at the top of an 8 iron's arc - which quietly undid
  // the one thing this obstacle exists to say. At 40 it is solid to everything, from anywhere.
  { name: 'boulder', trunk: 3.2, canopy: 3.2, height: 40 },
];

/** Red Mesa's house style: sparse scrub both sides, saguaros by default, and a narrower collar of
 *  rough than Pine Valley's - the desert starts sooner here. */
/** The course-level defaults every spec below is laid on top of. EXPORTED for the hole editor
 *  (HANDOFF-GOLF-HOLE-EDITOR.md), which needs the recipe and the defaults separately. */
export const RM_DEFAULTS = {
  treeTypes: DESERT_TYPES,
  rough: 7,
  belts: { left: { depth: 20, spacing: 14 }, right: { depth: 20, spacing: 14 } },
};
const rm = (spec) => makeHole({ ...RM_DEFAULTS, ...spec });`;

// --- field order (section 8.3) -------------------------------------------------------------------

const FIELD_ORDER = [
  'n', 'par', 'nickname', 'path', 'fw', 'fwL', 'fwR', 'rough', 'hard', 'wind', 'seed', 'greenSeed',
  'pinchTo', 'defend', 'greenR', 'greenRy', 'greenShape', 'greenAngle', 'greenOutline', 'fringe', 'pins', 'slope', 'slopeK',
  'guard', 'guardTree', 'cross', 'bunkers', 'water', 'trees', 'sentinels', 'lines', 'belts', 'base', 'decor',
];

// --- formatting -----------------------------------------------------------------------------------
// Two space indent, single quotes, trailing commas. "Numbers as-is" (section 8.3) means printed
// with no re-rounding - whatever precision the document holds is what is written, which is what
// keeps the export round-trip exact for the same reason normalise() keeps full precision (see
// hole-editor/CLAUDE.md, "A decision the spec's formula didn't survive contact with").

function fmtString(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function isPointArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((p) => Array.isArray(p) && p.every((n) => typeof n === 'number'));
}

function isPlainObjectArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((v) => v && typeof v === 'object' && !Array.isArray(v));
}

/** Render any value INLINE (on one line), recursively. Used for point arrays, guard's string
 *  array, and any object (belts, a slope grid, a single bunker/water/tree entry). */
function fmtInline(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(fmtInline).join(', ')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return `{ ${keys.map((k) => `${k}: ${fmtInline(v[k])}`).join(', ')} }`;
  }
  if (typeof v === 'string') return fmtString(v);
  return String(v);
}

/** Render one top-level field of a spec, at the given indent depth (in units of 2 spaces). */
function fmtField(key, value, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    if (isPointArray(value)) return `${key}: ${fmtInline(value)}`;
    if (isPlainObjectArray(value)) {
      const lines = value.map((v) => `${pad}  ${fmtInline(v)},`);
      return `${key}: [\n${lines.join('\n')}\n${pad}]`;
    }
  }
  return `${key}: ${fmtInline(value)}`;
}

function printSpec(name, spec, n) {
  const full = { n, ...spec };
  const lines = [];
  for (const key of FIELD_ORDER) {
    if (full[key] === undefined) continue;
    lines.push(`  ${fmtField(key, full[key], 1)},`);
  }
  return `export const ${name} = {\n${lines.join('\n')}\n};`;
}

// --- RED_MESA, verbatim -----------------------------------------------------------------------

function printRedMesa() {
  return `export const RED_MESA = {
  id: 'redmesa',
  name: 'Red Mesa',
  theme: 'desert',
  blurbKey: 'blurb_redmesa',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },   // 71
};

export default RED_MESA;`;
}

// --- the whole file ---------------------------------------------------------------------------

/** Generate the full `redmesa.js` text for a document. `doc.order` decides the slot (and so the
 *  SPEC_i / HOLE_i numbering and every `n`) - never the id. */
export function generateSource(doc, date = new Date().toISOString().slice(0, 10)) {
  const custom = doc.courseId === 'custom';
  const meta = custom ? customMeta(doc) : null;
  const blocks = [];
  if (custom) {
    blocks.push(`// golf/courses/${meta.slug}.js - ${meta.name.toUpperCase()}, ${doc.order.length} holes. Built in the hole editor's\n// Course Creator on ${date} (hole-editor/CLAUDE.md, "The Course Creator") and folded in as a course.\n// Yards throughout. x across the hole (right positive), y up it away from the tee.`);
    blocks.push(customDefaults(meta));
  } else {
    blocks.push(`${HEADER}\n// EDITED IN THE HOLE EDITOR on ${date} - see HANDOFF-GOLF-HOLE-EDITOR.md`);
    blocks.push(IMPORT_AND_DEFAULTS);
  }

  const specNames = [];
  const holeNames = [];
  for (let i = 0; i < doc.order.length; i++) {
    const slot = i + 1;
    const id = doc.order[i];
    const spec = doc.holes[id].spec;
    const specName = `SPEC_${slot}`;
    const holeName = `HOLE_${slot}`;
    specNames.push(specName);
    holeNames.push(holeName);
    blocks.push(`${printSpec(specName, spec, slot)}\nexport const ${holeName} = rm(${specName});`);
  }

  blocks.push(`/** THE RECIPES, in slot order - what the hole editor reads and what it writes back. Each SPEC_n is\n *  exactly the object HOLE_n is built from; nothing here is derived twice. */\nexport const SPECS = [\n  ${specNames.join(', ')},\n];`);
  blocks.push(`export const HOLES = [\n  ${holeNames.join(', ')},\n];`);
  blocks.push(custom ? printCustomCourse(meta) : printRedMesa());

  return `${blocks.join('\n\n')}\n`;
}

// --- a custom course (2026-09-22) -------------------------------------------------------------

function customMeta(doc) {
  const name = (doc.course && doc.course.name) || 'My Course';
  const t = doc.course && doc.course.theme;
  const theme = THEME_DEFAULTS[t] ? t : 'parkland';
  const slug = slugOf(name);
  return { name, theme, slug, constName: slug.toUpperCase() + '_COURSE' };
}

function customDefaults(meta) {
  const r = defaultsFor(meta.theme).rough;
  const rough = r != null ? `\n  rough: ${r},` : '';
  const belts = fmtInline(defaultsFor(meta.theme).belts);
  // THE CATALOGUE IS IMPORTED, NOT INLINED (2026-09-22). Every placed tree stores an INDEX into
  // `treeTypes`, so an exported course that carried its own copy of the table would be frozen at
  // the catalogue as it stood on export day: a later APPEND (the only change the catalogue permits)
  // would reach the editor and never reach the course. Importing it is also what makes the index a
  // designer's draft stores and the index their exported course reads the same number for ever.
  return `import { makeHole } from '../js/holegen.js';
import { OBSTACLE_CATALOG as TREE_TYPES } from '../js/obstacles.js';

/** Course-level defaults every recipe below is laid on top of. EXPORTED for the hole editor.
 *  The obstacle table is the shared catalogue (golf/js/obstacles.js), whose ORDER IS FROZEN -
 *  every \`trees[].type\` below is an index into it. */
export const RM_DEFAULTS = {
  treeTypes: TREE_TYPES,${rough}
  belts: ${belts},
};
const rm = (spec) => makeHole({ ...RM_DEFAULTS, ...spec });`;
}

function printCustomCourse(meta) {
  return `export const ${meta.constName} = {
  id: '${meta.slug}',
  name: ${JSON.stringify(meta.name)},
  theme: '${meta.theme}',
  blurbKey: 'blurb_custom',
  holes: HOLES,
  get par() { return this.holes.reduce((a, h) => a + h.par, 0); },
};

export default ${meta.constName};`;
}

/** What the Export button names the download. */
export function exportFileName(doc) {
  return doc.courseId === 'custom' ? `${customMeta(doc).slug}.js` : 'redmesa.js';
}

/** The "Copy JSON" button: the document, verbatim. */
export function generateJSON(doc) {
  return serialiseDocument(doc);
}
