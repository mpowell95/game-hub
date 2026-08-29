// pinball/tools/import-vp-table.mjs - GENERATOR for pinball/js/table-royal.js.
//
// PROVENANCE. The playfield layout this reads is "Royal Flush" (table9.json) from Vector Pinball
// by dozingcat - https://github.com/dozingcat/Vector-Pinball. It is that project's design, not
// ours; only the conversion below is ours. Vector Pinball is published under the GNU General
// Public License v3. This note records where the layout came from; it is NOT a claim that this
// repo complies with that license, which would need the license text carried alongside it. That
// is Matt's call and has not been made - see pinball/CLAUDE.md.
//
// WHY A GENERATOR AND NOT A HAND EDIT. The source is 122 elements, 39 of them arcs that have to be
// tessellated into line segments. Vector Pinball tessellates them the same way, and each arc
// carries its own `segments` count, so the curve resolution is theirs rather than a guess of ours.
// Doing that by hand once would be tolerable; redoing it after any change would not.
//
//   node pinball/tools/import-vp-table.mjs pinball/Pinball-table.json pinball/js/table-royal.js
//
// COORDINATES. Theirs is a 20 x 30 field with y UP. Ours is 400 x 600 with y DOWN, so
// x_ours = 20 * x_theirs and y_ours = 20 * (30 - y_theirs). SCALE is 20 because their ball is
// r 0.5, and 20 units per unit puts it at diameter 20 - close enough to STARHUB's 18 that the
// solver's tunnelling margins carry over untouched.
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

/** An arc becomes the polyline Vector Pinball itself draws: its own `segments` count, its own
 *  radii. 21 of the 39 arcs here are ELLIPTICAL (xradius != yradius), which is why they cannot
 *  simply become our circular arc() collider. */
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

const layer0 = (e) => (e.layer ?? 0) === 0;

// `kill: true` is the DRAIN, not a wall. Building it as a collider makes the outhole a solid floor:
// the first headless soak scored fine and never drained once in four 240-second games, because the
// ball simply bounced off the bottom of the table forever. Its y becomes DRAIN_Y instead.
let drainY = null;

function pushWall(pts, e) {
  const mu = e.friction === undefined ? 0 : Number(e.friction);
  const kick = e.kick ? N(e.kick) : 0;
  if (e.kill) {
    for (const [, py] of pts) drainY = drainY === null ? Y(py) : Math.min(drainY, Y(py));
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (ax === bx && ay === by) continue;
    walls.push([X(ax), Y(ay), X(bx), Y(by), mu, kick]);
  }
}

for (const e of src.elements) {
  if (e.ignoreBall) continue;                       // decoration: the ball passes through it
  switch (e.class) {
    case 'WallElement': {
      if (!layer0(e) || e.disabled) break;
      const p = e.position.map(Number);
      pushWall([[p[0], p[1]], [p[2], p[3]]], e);
      break;
    }
    case 'WallPathElement':
      if (!layer0(e)) break;
      pushWall(e.positions.map((q) => q.map(Number)), e);
      break;
    case 'WallArcElement':
      if (!layer0(e)) break;
      pushWall(arcPoints(e), e);
      break;
    case 'BumperElement':
      if (!layer0(e)) break;
      bumpers.push([X(e.position[0]), Y(e.position[1]), N(e.radius), N(e.kick), e.score | 0]);
      break;
    case 'SpinnerElement':
      spins.push([X(e.position[0]), Y(e.position[1]), N(e.radius), e.score | 0]);
      break;
    case 'RolloverGroupElement':
      rolls.push({
        id: e.id || ('roll' + rolls.length),
        r: N(e.radius),
        score: e.score | 0,
        pts: e.rollovers.map((o) => [X(o.position[0]), Y(o.position[1])]),
      });
      break;
    case 'FlipperElement': {
      // Their angles are counter-clockwise from +x with y UP; ours are clockwise with y DOWN, so
      // every angle negates. A NEGATIVE length means the bat points along -x, which in our frame
      // is that same bat measured from PI - the construction table.js already uses for its right
      // flipper. Verified by eye against the rendered layout, not just by algebra.
      const len = Number(e.length);
      const right = len < 0;
      const lo = Number(e.minangle) * Math.PI / 180;
      const hi = Number(e.maxangle) * Math.PI / 180;
      const rest = right ? Math.PI + lo : -lo;
      const up = right ? Math.PI + hi : -hi;
      flips.push([
        X(e.position[0]), Y(e.position[1]), N(Math.abs(len)),
        +rest.toFixed(4), +up.toFixed(4), right ? 1 : 0,
      ]);
      break;
    }
    case 'DropTargetGroupElement': {
      // A bank is declared ALONG A WALL - start point, end point, target width, gaps - not as
      // coordinates. Rebuilding it that way here means the targets land exactly on the wall.
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
      drops.push({ id: e.id, score: e.score | 0, targets });
      break;
    }
    case 'SensorElement':
      break;                                        // layer transitions; see table-royal.js header
    default:
      console.error('UNHANDLED element class:', e.class);
  }
}

const j = (v) => JSON.stringify(v);
const theirs = Math.sqrt(2 * FH / Number(src.gravity)).toFixed(2);
const ours = Math.sqrt(2 * 760 / 564).toFixed(2);
const dropCount = drops.reduce((n, d) => n + d.targets.length, 0);

const out = [
  '// pinball/js/table-royal.js - GENERATED by pinball/tools/import-vp-table.mjs. DO NOT EDIT BY HAND.',
  '//',
  '// PROVENANCE: the playfield below is "' + src.name + '" from Vector Pinball by dozingcat',
  '// (https://github.com/dozingcat/Vector-Pinball, table9.json), converted into this engine\'s',
  '// shapes. The design is theirs; the conversion is ours. Vector Pinball is GPL-3.0 licensed.',
  '// See the generator\'s header and pinball/CLAUDE.md for what that does and does not mean here.',
  '//',
  '// WHAT IS AND IS NOT IMPORTED. The source table is built in FOUR LAYERS: a playfield plus three',
  '// elevated ramps stacked over it, with 18 sensors handing the ball between levels. This engine',
  '// has one playfield, so ONLY LAYER 0 IS HERE - ' + walls.length + ' wall segments. The three ramps are',
  '// deliberately ABSENT rather than flattened onto the playfield: flattening them would drop walls',
  '// into the middle of shots that are meant to run underneath them. Their entrances are open lanes',
  '// until this engine grows real layers.',
  '//',
  '// Regenerate: node pinball/tools/import-vp-table.mjs pinball/Pinball-table.json pinball/js/table-royal.js',
  "import { seg, circle, flipper, BALL_R } from './physics.js';",
  '',
  'export const NAME = ' + j(src.name) + ';',
  'export const W = ' + X(src.width) + ';',
  'export const H = ' + Y(0) + ';',
  '/** The drain, taken from the source table\x27s own `kill` wall - NOT the bottom of the field. */',
  'export const DRAIN_Y = ' + (drainY === null ? Y(0) : drainY) + ';',
  '',
  '/** THEIR gravity, in our units: ' + Number(src.gravity) + ' * ' + S + '. STARHUB runs at 564, and that gap is the',
  ' *  whole reason this board is worth having - a ball crosses this field in ' + theirs + 's against',
  ' *  STARHUB\'s ' + ours + 's. The layout was designed around this number, so changing it changes their',
  ' *  table into something else. */',
  'export const GRAVITY = ' + N(src.gravity) + ';',
  'export const BALLS = ' + (src.numballs | 0) + ';',
  'export const PLUNGER = { x: ' + X(src.launchPosition[0]) + ', y: ' + Y(src.launchPosition[1])
    + ', v: ' + N(src.launchVelocity[1]) + ', jitter: ' + N(src.launchVelocityRandomDelta[1]) + ' };',
  '',
  'const WALLS = ' + j(walls) + ';',
  'const BUMPERS = ' + j(bumpers) + ';',
  'const FLIPPERS = ' + j(flips) + ';',
  'export const ROLLOVERS = ' + j(rolls) + ';',
  'export const DROPS = ' + j(drops) + ';',
  'export const SPINNERS = ' + j(spins) + ';',
  '/** Point value per bumper, in the order buildRoyal() creates them. Read from the source table so',
  ' *  the three small chip bumpers stay worth less than the three big ones: their intent, not ours. */',
  'export const BUMPER_SCORES = ' + j(bumpers.map((b) => b[4])) + ';',
  '',
  '/** Build the colliders and flippers. `down` is a Set of drop-target keys already knocked over,',
  ' *  so a cleared target stops being a wall - the bank is REBUILT rather than mutated, which is',
  ' *  the same discipline table.js uses for its own drop bank. */',
  'export function buildRoyal(down = new Set()) {',
  '  const colliders = [];',
  '  for (const [ax, ay, bx, by, mu, kick] of WALLS) {',
  '    colliders.push(seg(ax, ay, bx, by, { r: 3, mu, kick }));',
  '  }',
  '  for (let i = 0; i < BUMPERS.length; i++) {',
  '    const [x, y, r, kick] = BUMPERS[i];',
  "    colliders.push(circle(x, y, r, { kick, e: 0.5, id: 'bump:' + i }));",
  '  }',
  '  for (const d of DROPS) {',
  '    for (let i = 0; i < d.targets.length; i++) {',
  "      const key = d.id + ':' + i;",
  '      if (down.has(key)) continue;',
  '      const [ax, ay, bx, by] = d.targets[i];',
  "      colliders.push(seg(ax, ay, bx, by, { r: 3, e: 0.35, id: 'drop:' + key }));",
  '    }',
  '  }',
  '  const flippers = FLIPPERS.map(([px, py, len, rest, up, right], i) =>',
  "    flipper(px, py, len, rest, up, { r: 8, id: (right ? 'flipR' : 'flipL') + i }));",
  '  return { colliders, flippers };',
  '}',
  '',
  'export { BALL_R };',
  'export default { NAME, W, H, DRAIN_Y, GRAVITY, BALLS, PLUNGER, ROLLOVERS, DROPS, SPINNERS, buildRoyal };',
  '',
].join('\n');

fs.writeFileSync(outPath, out);
console.log(src.name + ': ' + src.elements.length + ' elements -> ' + walls.length + ' layer-0 segments, '
  + bumpers.length + ' bumpers, ' + flips.length + ' flippers, ' + drops.length + ' drop banks ('
  + dropCount + ' targets), ' + rolls.length + ' rollover groups, ' + spins.length + ' spinner');
