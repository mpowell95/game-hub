// TEST BOX: the bare table step 2 exists to judge. Walls, two flippers, a drain, nothing else.
// It is not a game and is not meant to be one. It is the smallest thing that answers "does the
// ball feel right", which is the only question worth asking before any content is built.

const D = Math.PI / 180;

let nextId = 1;
const id = (p) => `${p}${nextId++}`;

export function makeTable() {
  nextId = 1;
  const W = 0.515;
  const H = 1.067;
  const wr = 0.008;            // rail half thickness

  const shapes = [];
  const seg = (a, b, r, extra) => shapes.push(Object.assign({ id: id('w'), kind: 'seg', a, b, r: r || wr }, extra));
  const arc = (c, radius, a0, a1, r) => shapes.push({ id: id('a'), kind: 'arc', c, radius, a0, a1, r: r || wr });

  // outer rails, with real arcs at the top corners rather than a chain of short straights
  seg({ x: 0.008, y: 0.098 }, { x: 0.008, y: 1.030 });
  seg({ x: 0.507, y: 0.098 }, { x: 0.507, y: 1.030 });
  seg({ x: 0.098, y: 0.008 }, { x: 0.417, y: 0.008 });
  arc({ x: 0.098, y: 0.098 }, 0.090, 180 * D, 270 * D);
  arc({ x: 0.417, y: 0.098 }, 0.090, 270 * D, 360 * D);

  // The outer rails run PAST THE DRAIN LINE, not to it. Two bugs came from getting this wrong.
  // Stopping them at the feed rail opened the bottom corners and 96 balls in one sweep fell out
  // sideways. Stopping them at y = 985, twenty millimetres above the drain at y = 1005, left a
  // band with rails on neither side: Matt found that one by playing, and it is the reason a ball
  // could leave the machine over the left flipper. They end below the drain now, so there is no
  // height at which a ball can reach the side of the cabinet without a rail there.
  //
  // THE SLINGSHOT IS THE FEED, and it is anchored to the wall. The first version put a slingshot
  // beside a separate feed rail, and the rest sweep found four dead stops in the pockets that made
  // between the two of them and the wall. A real lower third has one continuous line from the wall
  // down to the flipper, so that is what this is: nothing can get behind it, and the wedge that
  // was catching balls is not a space any more.
  shapes.push({
    id: id('f'), kind: 'flipper', side: 'L',
    pivot: { x: 0.1666, y: 0.9554 }, len: 0.070, r0: 0.012, r1: 0.007,
    restAng: 25 * D, endAng: -27 * D,
  });
  shapes.push({
    id: id('f'), kind: 'flipper', side: 'R',
    pivot: { x: 0.3484, y: 0.9554 }, len: 0.070, r0: 0.012, r1: 0.007,
    restAng: 155 * D, endAng: 207 * D,
  });

  // Three pop bumpers in the classic triangle, high enough that a ball rattling between them is
  // being sent back UP the table rather than fed to the drain.
  const bump = (x, y, r) => shapes.push({ id: id('b'), kind: 'bumper', c: { x, y }, r: r || 0.026 });
  bump(0.195, 0.300);
  bump(0.320, 0.300);
  bump(0.2575, 0.395);

  // Slingshots: the angled faces above each flipper that kick a ball back across the table, and
  // the only route from the upper table down to the bat. One segment rather than the
  // three-post-and-three-face assembly a real one is built from.
  shapes.push({ id: id('s'), kind: 'sling', a: { x: 0.008, y: 0.755 }, b: { x: 0.152, y: 0.885 }, r: 0.008 });
  shapes.push({ id: id('s'), kind: 'sling', a: { x: 0.507, y: 0.755 }, b: { x: 0.363, y: 0.885 }, r: 0.008 });

  shapes.push({ id: id('d'), kind: 'drain', x: 0.0, y: 1.005, w: W, h: H - 1.005 });

  return { name: 'TEST BOX', w: W, h: H, shapes, launch: { x: 0.452, y: 0.140 } };
}

const r4 = (n) => Math.round(n * 1e4) / 1e4;

function roundDeep(v) {
  if (typeof v === 'number') return r4(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = roundDeep(v[k]);
    return o;
  }
  return v;
}

export function toJSON(table) {
  return JSON.stringify(roundDeep({ name: table.name, w: table.w, h: table.h, launch: table.launch, shapes: table.shapes }), null, 2);
}

export function fromJSON(text) {
  const t = typeof text === 'string' ? JSON.parse(text) : text;
  if (!t || !Array.isArray(t.shapes)) throw new Error('not a table');
  let max = 0;
  for (const s of t.shapes) {
    const n = parseInt(String(s.id).replace(/^\D+/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  nextId = max + 1;
  return {
    name: t.name || 'TABLE',
    w: t.w || 0.515,
    h: t.h || 1.067,
    launch: t.launch || { x: 0.452, y: 0.140 },
    shapes: t.shapes,
  };
}

/** Ids stay unique across an editing session, including for shapes pasted in from a file. */
export function newId(prefix) {
  return id(prefix);
}
