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

  // Slingshots: the angled faces above each flipper that bounce a ball back across the table, and
  // the only route from the upper table down to the bat. One segment rather than the
  // three-post-and-three-face assembly a real one is built from.
  shapes.push({ id: id('s'), kind: 'sling', a: { x: 0.008, y: 0.755 }, b: { x: 0.152, y: 0.885 }, r: 0.008 });
  shapes.push({ id: id('s'), kind: 'sling', a: { x: 0.507, y: 0.755 }, b: { x: 0.363, y: 0.885 }, r: 0.008 });

  // A RAMP. Enters low on the right, climbs to 60mm above the playfield, runs across the top over
  // the bumpers, and comes back down on the left. Two rules, both checked by `rampProbe`:
  //
  //   1. BOTH ENDS ARE AT z = 0. A ball leaving a mouth that is still in the air would need a
  //      flight model, and inventing a landing spot for it is the teleport this design exists to
  //      avoid.
  //   2. NO JUNCTION KINKS. The lane's sideways axis turns with the path, so a sharp corner moves a
  //      ball riding off-centre by `q` times the turn, all at once. A real wireform cannot kink and
  //      neither can this: the path is many gentle points rather than a few long runs, and the
  //      probe fails anything over 20 degrees.
  //   3. NO SEGMENT IS LEVEL. A run that is flat in height AND square to the table has no force
  //      along it at all, so a ball that stops there stops for ever. The first version of this ramp
  //      had exactly that across the top and the rest sweep parked three balls on it. The crest is
  //      a point now, not a plateau: everything before it pushes back, everything after pushes on.
  shapes.push(makeRamp(id('r')));

  shapes.push({ id: id('d'), kind: 'drain', x: 0.0, y: 1.005, w: W, h: H - 1.005 });

  return { name: 'TEST BOX', w: W, h: H, shapes, launch: { x: 0.452, y: 0.140 } };
}

/** The ramp, generated rather than hand placed, because three rules have to hold at once and hand
 *  placed points broke all three:
 *
 *    1. BOTH ENDS AT z = 0. A ball leaving a mouth in mid air would need a flight model, and
 *       inventing a landing spot for it is the teleport this whole design exists to avoid.
 *    2. NO KINKS. The lane's sideways axis turns with the path, so a sharp corner MOVES a ball
 *       riding off the centre line by q times the turn, all at once. Hand placed points kinked at
 *       up to 24 degrees and the probe measured the ball jumping 6.6mm. A Catmull-Rom curve
 *       resampled at 8mm turns a couple of degrees per step.
 *    3. NO SEGMENT WHERE NOTHING MOVES A BALL. Along-lane force is `g sin(tilt) * dir.y` from the
 *       table's own slope minus `g cos(tilt) * slope` from the climb, and those two CANCEL on a run
 *       that heads up the table while descending at just the wrong rate. One did, at 0.02 m/s2, and
 *       the rest sweep parked three balls on it. The height crest is deliberately EARLIER than the
 *       top of the loop, so past the crest the ramp is always descending AND always heading back
 *       down the table, and the two forces add instead of fighting.
 */
function makeRamp(rid) {
  return buildRamp(rid, [
    { x: 0.440, y: 0.720 },
    { x: 0.468, y: 0.580 },
    { x: 0.462, y: 0.430 },
    { x: 0.430, y: 0.300 },
    { x: 0.370, y: 0.232 },
    { x: 0.300, y: 0.240 },
    { x: 0.220, y: 0.262 },
    { x: 0.155, y: 0.302 },
    { x: 0.112, y: 0.366 },
    { x: 0.092, y: 0.440 },
    { x: 0.090, y: 0.505 },
  ]);
}

export const RAMP_DEFAULTS = { zmax: 0.060, w: 0.050, r: 0.006, step: 0.008 };

/** BUILD A RAMP FROM CONTROL POINTS. The ONE implementation: the table's own ramp calls it, and so
 *  does the editor's Ramp tool. A second copy of this in the editor would be two curves that agree
 *  until somebody fixes one of them.
 *
 *  It also STORES the control points on the shape (`ctrl`), which is what makes a ramp re-editable.
 *  The 100-odd `pts` it generates are output, not input: re-fitting control points back out of them
 *  is guesswork, and a ramp you cannot reshape is a ramp you have to delete and lay again.
 *
 *  Three rules have to hold and `rampProbe` checks all three. Two of them are structural here:
 *  both ends land at z = 0 by construction, and the crest sits at the APEX of the path (the point
 *  where it stops heading up the table) so the climb always fights the ball and the descent always
 *  helps it. Get the crest wrong and the table's own slope and the ramp's descent CANCEL over a
 *  whole run, which parked three balls in one sweep. The third rule, no kink over 20 degrees, is
 *  why this RESAMPLES BY DISTANCE rather than by a fixed number of steps per control segment: a
 *  path a person taps has segments of wildly different lengths, and a fixed step count makes the
 *  long ones coarse, which is exactly where a kink appears. */
export function buildRamp(rid, ctrl, opts) {
  const o = Object.assign({}, RAMP_DEFAULTS, opts || {});
  const pts = rampPoints(ctrl, o);
  return { id: rid, kind: 'ribbon', w: o.w, r: o.r, ctrl: ctrl.map((c) => ({ x: r4(c.x), y: r4(c.y) })), pts };
}

/** The curve and the height profile alone, so the editor can draw a live preview of a path that is
 *  not a shape yet. Returns [] for anything under two control points. */
export function rampPoints(ctrl, opts) {
  const o = Object.assign({}, RAMP_DEFAULTS, opts || {});
  if (!Array.isArray(ctrl) || ctrl.length < 2) return [];

  // Catmull-Rom through every control point, sampled finely, then resampled by arc length.
  const at = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  const fine = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    const steps = 24;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      fine.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  fine.push({ x: at(ctrl.length - 1).x, y: at(ctrl.length - 1).y });

  // EVEN SPACING. Walk the fine curve and drop a point every `step` metres, so the turn between
  // consecutive points depends on the curve's radius and nothing else.
  const path = [fine[0]];
  let carry = 0;
  for (let i = 1; i < fine.length; i++) {
    let seg = Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y);
    if (seg < 1e-12) continue;
    let used = 0;
    while (carry + (seg - used) >= o.step) {
      const need = o.step - carry;
      used += need;
      const f = used / seg;
      path.push({ x: fine[i - 1].x + (fine[i].x - fine[i - 1].x) * f, y: fine[i - 1].y + (fine[i].y - fine[i - 1].y) * f });
      carry = 0;
    }
    carry += seg - used;
  }
  const last = fine[fine.length - 1];
  const tail = path[path.length - 1];
  // The final point is the path's real end, not wherever the walk happened to stop. If the leftover
  // is a sliver, MOVE the last point rather than adding one: a stub shorter than the step is a
  // sharper turn than the rest of the curve, which is the kink rule's own failure mode.
  if (Math.hypot(last.x - tail.x, last.y - tail.y) < o.step * 0.5 && path.length > 1) path.pop();
  path.push({ x: last.x, y: last.y });
  if (path.length < 2) return [];

  let total = 0;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(total);
  }
  if (total < 1e-9) return [];

  // THE HEIGHT CREST SITS AT THE TOP OF THE LOOP, where the path stops heading up the table. Put
  // it anywhere else and the two along-lane forces fight: the table's own slope pulls a ball back
  // down while the descent pushes it on, and at one particular combination they CANCEL over a whole
  // run. One version cancelled at 0.02 m/s2 across 26mm and the sweep parked balls there. With the
  // crest here, the climb is always fighting the ball and the descent is always helping it, and the
  // only balance point is the single point at the top - which is a hilltop, and a hilltop is
  // allowed. What is not allowed is a level RUN, and `rampProbe` measures exactly that.
  let apex = 0;
  for (let i = 1; i < path.length; i++) if (path[i].y < path[apex].y) apex = i;
  let crest = cum[apex] / total;
  // A crest at either END would make the whole ramp one long climb or one long fall with nothing on
  // the other side, and dividing by zero besides. A path that never turns back down the table gets
  // its crest in the middle.
  if (crest < 0.05 || crest > 0.95) crest = 0.5;
  return path.map((pt, i) => {
    const f = cum[i] / total;
    const z = f <= crest ? o.zmax * (f / crest) : o.zmax * (1 - (f - crest) / (1 - crest));
    return { x: r4(pt.x), y: r4(pt.y), z: r4(Math.max(0, z)) };
  });
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
  // launchV is OMITTED when a table has none, never written as null. `tableIsFinite` rejects null
  // on purpose (JSON has no NaN, so a NaN comes back as null and null in arithmetic is 0), so a
  // null here fails the autosave's own guard and every save goes silently nowhere.
  const out = { name: table.name, w: table.w, h: table.h, launch: table.launch, shapes: table.shapes };
  if (table.launchV) out.launchV = table.launchV;
  return JSON.stringify(roundDeep(out), null, 2);
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
  // A bumper or slingshot's per-part override was called `kick` until 2026-09-11. Carry the number
  // across rather than silently reverting that part to the table default.
  for (const s of t.shapes) {
    if (s && s.kick != null && s.bounce == null) s.bounce = s.kick;
  }
  return {
    name: t.name || 'TABLE',
    w: t.w || 0.515,
    h: t.h || 1.067,
    launch: t.launch || { x: 0.452, y: 0.140 },
    // THE PLUNGER, as a velocity. Absent means the old behaviour: drop the ball where `launch` says
    // and let gravity have it, which is right for a table whose launch point is in open play. A
    // table with a SHOOTER LANE needs the ball fired UP it, or it rolls back down and drains
    // without ever reaching the playfield - which is what BOARDWALK did on every single launch.
    ...(t.launchV && Number.isFinite(t.launchV.x) && Number.isFinite(t.launchV.y) ? { launchV: t.launchV } : {}),
    shapes: t.shapes,
  };
}

/** Ids stay unique across an editing session, including for shapes pasted in from a file. */
export function newId(prefix) {
  return id(prefix);
}
