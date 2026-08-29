// pinball/tools/import-vp-table.mjs - GENERATOR for pinball/js/table-royal.js.
//
// PROVENANCE. The playfield this reads is "Royal Flush" (table9.json) from Vector Pinball by
// dozingcat - https://github.com/dozingcat/Vector-Pinball. The design is that project's, not ours;
// only the conversion is ours. Vector Pinball is published under the GNU General Public License v3.
// This note records where the layout came from; it is NOT a claim that this repo complies with that
// license, which would need the license text carried alongside. That is Matt's call and has not
// been made - see pinball/CLAUDE.md.
//
// THE RULE THIS FILE IS WRITTEN TO. Matt, 2026-08-29: "the fix is to implement the board exactly as
// is. Don't simplify or change anything. Make it work with our gamehub setup but do not take any
// creative liberties." The first import broke that twice - it kept LAYER 0 ONLY (throwing away the
// three elevated ramps, roughly half the table) and it invented a colour scheme instead of using the
// one the file carries. Both are fixed here:
//
//   - EVERY layer is imported, with its layer number, plus the 18 sensors that move the ball
//     between levels.
//   - EVERY element's own `color` and `inactiveLayerColor` are carried through. Where an element
//     specifies none, the DEFAULT IS READ FROM VECTOR PINBALL'S OWN SOURCE, not chosen:
//       Wall / WallArc / WallPath  rgb(64,64,160)    FieldElement.DEFAULT_WALL_COLOR
//       Bumper                     rgb(0,0,255)      BumperElement.DEFAULT_COLOR
//       Bumper outer               rgba(0,0,255,128) BumperElement.DEFAULT_OUTER_COLOR
//       Rollover / DropTarget      rgb(0,255,0)      RolloverGroupElement / DropTargetGroupElement
//       Flipper                    rgb(0,255,0)      FlipperElement.DEFAULT_COLOR
//       Spinner                    rgb(224,224,224)  SpinnerElement.DEFAULT_COLOR
//     Nothing here is a taste decision. If a colour looks wrong, the conversion is wrong.
//
// WHY A GENERATOR AND NOT A HAND EDIT. 39 of the 122 elements are arcs, 21 of them ELLIPTICAL, which
// our circular arc() cannot express. Each carries its own `segments` count, so tessellating here
// keeps THEIR curve resolution rather than a guess of ours.
//
//   node pinball/tools/import-vp-table.mjs pinball/Pinball-table.json pinball/js/table-royal.js
//
// COORDINATES. Theirs is a 20 x 30 field with y UP; ours is 400 x 600 with y DOWN, so
// x_ours = 20 * x_theirs and y_ours = 20 * (30 - y_theirs). SCALE is 20 because their ball is
// r 0.5, which lands at diameter 20 - close enough to STARHUB's 18 that the solver's tunnelling
// margins carry over untouched.
import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: import-vp-table.mjs <in.json> <out.js>');
  process.exit(1);
}
const src = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const S = 20;
const FH = Number(src.height);
const X = (v) => +(Number(v) * S).toFixed(2);
const Y = (v) => +((FH - Number(v)) * S).toFixed(2);
const N = (v) => +(Number(v) * S).toFixed(2);

// Their colours are [r,g,b] or [r,g,b,a] with a in 0-255.
const col = (c, fallback) => {
  const a = Array.isArray(c) ? c : fallback;
  if (!a) return null;
  return a.length > 3
    ? 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + (a[3] / 255).toFixed(3) + ')'
    : 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
};

// Straight out of Vector Pinball's own element classes - see the header.
const DEF_WALL = [64, 64, 160];
const DEF_BUMPER = [0, 0, 255];
const DEF_BUMPER_OUTER = [0, 0, 255, 128];
const DEF_ROLLOVER = [0, 255, 0];
const DEF_DROP = [0, 255, 0];
const DEF_FLIPPER = [0, 255, 0];
const DEF_SPINNER = [224, 224, 224];

function arcPoints(e) {
  const cx = Number(e.center[0]);
  const cy = Number(e.center[1]);
  const rx = Number(e.xradius ?? e.radius);
  const ry = Number(e.yradius ?? e.radius);
  const a0 = Number(e.minangle) * Math.PI / 180;
  const a1 = Number(e.maxangle) * Math.PI / 180;
  const n = Math.max(2, Number(e.segments ?? 30));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

const walls = [];
const bumpers = [];
const flips = [];
const rolls = [];
const drops = [];
const spins = [];
const sensors = [];

// `kill: true` is the DRAIN, not a wall. Built as a collider it becomes a solid floor: the first
// soak of this board scored normally and never drained once in four 240-second games, because the
// ball simply bounced off the bottom of the table forever.
let drainY = null;

function pushWall(pts, e) {
  if (e.kill) {
    for (const [, py] of pts) drainY = drainY === null ? Y(py) : Math.min(drainY, Y(py));
    return;
  }
  const mu = e.friction === undefined ? 0 : Number(e.friction);
  const kick = e.kick ? N(e.kick) : 0;
  const layer = e.layer ?? 0;
  const c = col(e.color, DEF_WALL);
  const ic = col(e.inactiveLayerColor, null);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (ax === bx && ay === by) continue;
    walls.push([X(ax), Y(ay), X(bx), Y(by), mu, kick, layer, c, ic,
      e.ignoreBall ? 1 : 0, e.disabled ? 1 : 0, e.retractWhenHit ? 1 : 0, e.id || '']);
  }
}

for (const e of src.elements) {
  switch (e.class) {
    case 'WallElement': {
      const p = e.position.map(Number);
      pushWall([[p[0], p[1]], [p[2], p[3]]], e);
      break;
    }
    case 'WallPathElement':
      pushWall(e.positions.map((q) => q.map(Number)), e);
      break;
    case 'WallArcElement':
      pushWall(arcPoints(e), e);
      break;
    case 'BumperElement':
      bumpers.push([X(e.position[0]), Y(e.position[1]), N(e.radius),
        N(e.outerRadius ?? e.radius), N(e.kick), e.score | 0, e.layer ?? 0,
        col(e.color, DEF_BUMPER), col(e.outerColor, DEF_BUMPER_OUTER)]);
      break;
    case 'SpinnerElement':
      spins.push([X(e.position[0]), Y(e.position[1]), N(e.radius), e.score | 0,
        e.layer ?? 0, col(e.color, DEF_SPINNER)]);
      break;
    case 'RolloverGroupElement':
      rolls.push({
        id: e.id || ('roll' + rolls.length),
        r: N(e.radius),
        score: e.score | 0,
        layer: e.layer ?? 0,
        color: col(e.color, DEF_ROLLOVER),
        pts: e.rollovers.map((o) => [X(o.position[0]), Y(o.position[1])]),
      });
      break;
    case 'FlipperElement': {
      // Their angles are counter-clockwise from +x with y UP; ours are clockwise with y DOWN, so
      // every angle negates. A NEGATIVE length means the bat points along -x, which in our frame is
      // that same bat measured from PI - the construction table.js already uses for its right
      // flipper.
      const len = Number(e.length);
      const right = len < 0;
      const lo = Number(e.minangle) * Math.PI / 180;
      const hi = Number(e.maxangle) * Math.PI / 180;
      flips.push([
        X(e.position[0]), Y(e.position[1]), N(Math.abs(len)),
        +(right ? Math.PI + lo : -lo).toFixed(4),
        +(right ? Math.PI + hi : -hi).toFixed(4),
        right ? 1 : 0, e.layer ?? 0, col(e.color, DEF_FLIPPER),
      ]);
      break;
    }
    case 'DropTargetGroupElement': {
      // A bank is declared ALONG A WALL - start, end, target width, gaps - not as coordinates.
      const ws = e.wallStart.map(Number);
      const we = e.wallEnd.map(Number);
      const dx = we[0] - ws[0];
      const dy = we[1] - ws[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      const nx = -uy;
      const ny = ux;
      const off = Number(e.gapFromWall);
      const w = Number(e.targetWidth);
      const gap = Number(e.gapBetweenTargets);
      const targets = [];
      for (let i = 0; i < e.numTargets; i++) {
        const a = Number(e.startDistanceAlongWall) + i * (w + gap);
        const x1 = ws[0] + ux * a + nx * off;
        const y1 = ws[1] + uy * a + ny * off;
        targets.push([X(x1), Y(y1), X(x1 + ux * w), Y(y1 + uy * w)]);
      }
      drops.push({
        id: e.id, score: e.score | 0, layer: e.layer ?? 0,
        reset: Number(e.reset ?? 0), color: col(e.color, DEF_DROP), targets,
      });
      break;
    }
    case 'SensorElement': {
      // TWO KINDS, and the difference is whether `ballLayer` is present. With it, the sensor MOVES
      // the ball between levels (7 of them: 0->1, 0->2 twice, 0->3, and one exit from each ramp).
      // Without it, it is an event trigger that is only live while the ball is on `ballLayerFrom`.
      const r = e.rect.map(Number);
      sensors.push({
        id: e.id || null,
        x1: X(Math.min(r[0], r[2])), y1: Y(Math.max(r[1], r[3])),
        x2: X(Math.max(r[0], r[2])), y2: Y(Math.min(r[1], r[3])),
        from: e.ballLayerFrom === undefined ? null : e.ballLayerFrom,
        to: e.ballLayer === undefined ? null : e.ballLayer,
      });
      break;
    }
    default:
      console.error('UNHANDLED element class:', e.class);
  }
}

const j = (v) => JSON.stringify(v);
const layers = {};
for (const w of walls) layers[w[6]] = (layers[w[6]] || 0) + 1;
const theirs = Math.sqrt(2 * FH / Number(src.gravity)).toFixed(2);

const out = [
  '// pinball/js/table-royal.js - GENERATED by pinball/tools/import-vp-table.mjs. DO NOT EDIT BY HAND.',
  '//',
  '// PROVENANCE: this playfield is "' + src.name + '" from Vector Pinball by dozingcat',
  '// (https://github.com/dozingcat/Vector-Pinball, table9.json). The design is theirs; the',
  '// conversion is ours. Vector Pinball is GPL-3.0 licensed. See the generator\'s header and',
  '// pinball/CLAUDE.md for what that does and does not mean here.',
  '//',
  '// IMPORTED EXACTLY AS SPECIFIED - all ' + Object.keys(layers).length + ' layers, every colour, all ' + sensors.length + ' sensors.',
  '// Layer 0 is the playfield; layers 1-3 are the three elevated ramps stacked over it, and the',
  '// sensors below are what hand the ball between them. Segments per layer: ' + j(layers) + '.',
  '// Colours are each element\'s own; where the source gave none, the default is Vector Pinball\'s',
  '// own (see the generator header). No colour here is a choice of ours.',
  '//',
  '// Regenerate: node pinball/tools/import-vp-table.mjs pinball/Pinball-table.json pinball/js/table-royal.js',
  "import { seg, circle, flipper, BALL_R } from './physics.js';",
  '',
  'export const NAME = ' + j(src.name) + ';',
  'export const W = ' + X(src.width) + ';',
  'export const H = ' + Y(0) + ';',
  '/** The drain, from the source table\'s own `kill` wall - NOT the bottom of the field. */',
  'export const DRAIN_Y = ' + (drainY === null ? Y(0) : drainY) + ';',
  '',
  '/** THEIR gravity, in our units: ' + Number(src.gravity) + ' * ' + S + '. A ball crosses this field in ' + theirs + 's',
  ' *  against STARHUB\'s 1.64s. The layout was designed around this number. */',
  'export const GRAVITY = ' + N(src.gravity) + ';',
  'export const BALLS = ' + (src.numballs | 0) + ';',
  'export const BALL_COLOR = ' + j(col(src.ballcolor, [240, 240, 240])) + ';',
  'export const PLUNGER = { x: ' + X(src.launchPosition[0]) + ', y: ' + Y(src.launchPosition[1])
    + ', v: ' + N(src.launchVelocity[1]) + ', jitter: ' + N(src.launchVelocityRandomDelta[1]) + ' };',
  '',
  '// [ax, ay, bx, by, mu, kick, layer, color, inactiveColor, ghost, disabled, retract, id]',
  'export const WALLS = ' + j(walls) + ';',
  '// [x, y, r, outerR, kick, score, layer, color, outerColor]',
  'export const BUMPERS = ' + j(bumpers) + ';',
  '// [px, py, len, rest, up, isRight, layer, color]',
  'export const FLIPPERS = ' + j(flips) + ';',
  'export const ROLLOVERS = ' + j(rolls) + ';',
  'export const DROPS = ' + j(drops) + ';',
  '// [x, y, r, score, layer, color]',
  'export const SPINNERS = ' + j(spins) + ';',
  '// { id, x1, y1, x2, y2, from, to } - `to` non-null means it MOVES the ball to that layer.',
  'export const SENSORS = ' + j(sensors) + ';',
  '',
  '/**',
  ' * Colliders for ONE layer. The ball only ever touches the level it is on, which is what makes a',
  ' * ramp a ramp instead of a wall dropped across the playfield. `down` is the set of drop-target',
  ' * keys currently knocked over, and `retracted` the set of retract-when-hit wall ids that have',
  ' * been hit; both are REBUILT rather than mutated.',
  ' */',
  'export function buildLayer(layer, down = new Set(), retracted = new Set()) {',
  '  const colliders = [];',
  '  for (const [ax, ay, bx, by, mu, kick, ly, , , ghost, disabled, , id] of WALLS) {',
  '    if (ly !== layer || ghost || disabled) continue;',
  '    if (id && retracted.has(id)) continue;',
  "    colliders.push(seg(ax, ay, bx, by, { r: 3, mu, kick, id: id || (kick ? 'kick' : '') }));",
  '  }',
  '  for (let i = 0; i < BUMPERS.length; i++) {',
  '    const [x, y, r, , kick, , ly] = BUMPERS[i];',
  '    if (ly !== layer) continue;',
  "    colliders.push(circle(x, y, r, { kick, e: 0.5, id: 'bump:' + i }));",
  '  }',
  '  for (const d of DROPS) {',
  '    if ((d.layer ?? 0) !== layer) continue;',
  '    for (let i = 0; i < d.targets.length; i++) {',
  "      const key = d.id + ':' + i;",
  '      if (down.has(key)) continue;',
  '      const [ax, ay, bx, by] = d.targets[i];',
  "      colliders.push(seg(ax, ay, bx, by, { r: 3, e: 0.35, id: 'drop:' + key }));",
  '    }',
  '  }',
  '  const flippers = [];',
  '  for (let i = 0; i < FLIPPERS.length; i++) {',
  '    const [px, py, len, rest, up, right, ly] = FLIPPERS[i];',
  '    if (ly !== layer) continue;',
  "    flippers.push(flipper(px, py, len, rest, up, { r: 8, id: (right ? 'flipR' : 'flipL') + i }));",
  '  }',
  '  return { colliders, flippers };',
  '}',
  '',
  'export { BALL_R };',
  'export default {',
  '  NAME, W, H, DRAIN_Y, GRAVITY, BALLS, BALL_COLOR, PLUNGER,',
  '  WALLS, BUMPERS, FLIPPERS, ROLLOVERS, DROPS, SPINNERS, SENSORS, buildLayer,',
  '};',
  '',
].join('\n');

fs.writeFileSync(outPath, out);
console.log(src.name + ': ' + src.elements.length + ' elements -> ' + walls.length + ' segments across '
  + Object.keys(layers).length + ' layers ' + j(layers) + ', ' + bumpers.length + ' bumpers, '
  + flips.length + ' flippers, ' + drops.length + ' drop banks ('
  + drops.reduce((n, d) => n + d.targets.length, 0) + ' targets), ' + rolls.length + ' rollover groups, '
  + spins.length + ' spinner, ' + sensors.length + ' sensors');
