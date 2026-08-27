// skeeball/js/machines/runaway/machine.js - HOT SHOT: RUNAWAY's OWN geometry. This file serves
// ONE machine (board id `runaway`) and nothing else loads it - see skeeball/js/engines.js. It
// began as a verbatim copy of machines/basketball/ on 2026-08-24 and diverges freely from here;
// an edit made for RUNAWAY must never be carried back into HOT SHOT's copy "to keep them in
// sync". They are different machines.
//
// WHAT MAKES THIS FILE DIFFERENT FROM ITS THREE SIBLINGS: it is the only machine in the repo
// with a MOVING PART, and the only one whose FACE CHANGES SHAPE DURING A RACK.
//
//   - EVERY basket is a ONE-SHOT: land in it and it closes for the rest of the rack.
//   - EVERY ROW PLAYS "LAST ONE STANDING". Close the others and the survivor comes off its mark
//     and sweeps the full width of its row. The top row is two 100s, so it takes one ball; rows 1
//     and 2 are three baskets, so they take two. Up to three baskets can be moving at once.
//   - The top row's survivor is the one basket that NEVER closes - catching it makes it FASTER
//     instead, one rung down a period ladder each time.
//
// All of it lives below as pure functions of (geometry, rack clock, rack state): `sweepU`/
// `sweepVel`/`holeU`/`holeOffset` for the motion, `capFor` for the cap. They are the ONLY source
// of truth - physics.js, render.js and the tools all call them rather than each re-deriving the
// maths. See "The moving basket" in skeeball/CLAUDE.md and MACHINE-RUNAWAY.md.
//
// skeeball/js/machine.js - the machine's GEOMETRY, once, in metres. GUARD: both physics.js and
// render.js build from this one description, so the wall you see IS the wall the ball hits and
// the two can never drift apart.
//
// Coordinates: world x = lateral (right +), y = up, z = toward the player (the machine extends
// into -z). The lane's top surface is y = 0. Face coordinates (u lateral, v metres up the slope
// from the board's bottom edge, h height off the face plane) are mapped through faceToWorld().
//
// Every solid is a BOX: { pos: [x,y,z], half: [hx,hy,hz], rot: {axis, angle} | null, part }.
// Curved furniture is approximated with short box segments; the renderer draws the smooth
// cylinder at the same radius, a sub-centimetre difference that keeps contacts exact.

/** Build the whole machine description for one board's `geom` block. */
// --- THE MOVERS, AND THE ONE-SHOT FACE --------------------------------------------------------
//
/** THE SWEEPS, as pure maths. `sweeps` is game.js's rack state: an object keyed by hole id, one
 *  entry per basket that is CURRENTLY MOVING. An absent key means that basket is standing on its
 *  own mark, which on ball 1 is every basket on the machine.
 *
 *      {}                                            nothing moves (ball 1)
 *      { topR: {...} }                               the surviving 100 is running
 *      { topR: {...}, lowC: {...}, midL: {...} }     up to three at once
 *
 *  One record is `{ hole, t0, dir, amp, period, mode, catches }` and it describes ONE basket's
 *  travel. Two modes, and the difference is entirely about HOW IT STARTS:
 *
 *    'cos'    u(t) = dir * amp * cos(w * (t - t0))
 *             For a survivor standing at an END of the travel (|u| = amp), which is every OUTER
 *             basket on this machine - the top row's two 100s and each lower row's two outside
 *             baskets all rest at +/-2.07X, which IS the amplitude. At t = t0 the cosine puts it
 *             exactly where it already is AND gives it exactly zero velocity: it eases away from
 *             a standstill instead of teleporting to the centre or taking a step change in wall
 *             velocity. `dir` is the sign of its own resting u, so the machine is mirror-
 *             symmetric and it makes no difference which side survives.
 *
 *    'ramp'   u(t) = dir * amp * r(t) * sin(w * (t - t0)),  r ramping 0 -> 1 over one period
 *             For a survivor standing at the CENTRE (u = 0), which no cosine can start from: a
 *             plain sine is at its own mark at t0 but at MAXIMUM speed there, which is the step
 *             change in wall velocity the whole design avoids. The ramp fixes both ends of it -
 *             at t = t0 the position is 0 (its mark) and the velocity is 0 too, because r(0) = 0
 *             kills the one term and sin(0) = 0 kills the other. It winds up to the full travel
 *             over its first period, which also reads as a machine part spooling up.
 *
 *  GUARD: THESE FUNCTIONS ARE THE ONLY PLACE THE MOTION EXISTS. physics.js moves the collar
 *  bodies with them, render.js moves the meshes with them, and the tools measure the travel
 *  envelope with them. A second copy written anywhere else is a mesh drifting off its own
 *  collision wall - the exact class of bug machine.js exists to make impossible.
 *
 *  GUARD: PURE FUNCTIONS OF (GEOMETRY, TIME, RACK STATE). No internal clock, no Date.now(),
 *  nothing accumulated. `t` is the rack clock, handed in by every caller. That is what keeps the
 *  sim deterministic, and what lets two balls in the air at once - running in SEPARATE cannon
 *  worlds - agree about where every basket is.
 */

/** One sweep record's absolute face-u at rack time `t`. */
export function sweepU(sw, t) {
  if (!sw || !(sw.period > 0)) return 0;
  const tau = (t || 0) - (sw.t0 || 0);
  const w = (2 * Math.PI) / sw.period;
  if (sw.mode === 'ramp') {
    const r = Math.min(1, Math.max(0, tau / sw.period));
    return sw.dir * sw.amp * r * Math.sin(w * tau);
  }
  return sw.dir * sw.amp * Math.cos(w * tau);
}

/** The same record's LATERAL SPEED (m/s, + is toward the player's right) at rack time `t`.
 *
 *  GUARD: physics.js needs this for two separate reasons and both are load-bearing. It is the
 *  velocity given to the KINEMATIC collar bodies, so the contact solver hands a struck ball a
 *  real impulse instead of teleporting a wall through it; and it is subtracted from the ball's
 *  own speed before the capture test, so capture asks how fast the ball is crossing THE MOUTH
 *  rather than how fast it is crossing the board. Without the subtraction a ball sitting still
 *  on a tread reads as zero speed across a mouth driving over it and is swallowed on contact -
 *  which is MACHINE-SPEC.md section 9's banned magnetism arriving through the back door. */
export function sweepVel(sw, t) {
  if (!sw || !(sw.period > 0)) return 0;
  const tau = (t || 0) - (sw.t0 || 0);
  const w = (2 * Math.PI) / sw.period;
  if (sw.mode === 'ramp') {
    const r = Math.min(1, Math.max(0, tau / sw.period));
    const dr = tau >= 0 && tau < sw.period ? 1 / sw.period : 0;
    return sw.dir * sw.amp * (dr * Math.sin(w * tau) + r * w * Math.cos(w * tau));
  }
  return -sw.dir * sw.amp * w * Math.sin(w * tau);
}

/** The first rung of the top row's escalation ladder - the period its sweep starts at. */
export function basePeriod(G) {
  const m = G && G.mover;
  return m && Array.isArray(m.periods) && m.periods.length ? m.periods[0] : 6;
}

/** One hole's centre-u at rack time `t`: its own resting `u` unless it is currently moving. */
export function holeU(G, id, t, sweeps) {
  const sw = sweeps && sweeps[id];
  if (sw) return sweepU(sw, t);
  const H = G.holes[id];
  return H ? H.u : 0;
}

/** The same hole's lateral speed - 0 for anything standing still. */
export function holeVel(G, id, t, sweeps) {
  const sw = sweeps && sweeps[id];
  return sw ? sweepVel(sw, t) : 0;
}

/** How far a hole is DISPLACED from where machine.js built it - what render.js puts on the
 *  basket's group, and what physics.js adds to a kinematic body's baseX. Zero for every basket
 *  that is not currently moving, which on ball 1 is all of them. */
export function holeOffset(G, id, t, sweeps) {
  const H = G.holes[id];
  const sw = sweeps && sweeps[id];
  if (!H || !sw) return 0;
  return sweepU(sw, t) - H.u;
}

/** Is this hole one that could EVER move? Every such basket gets a KINEMATIC collar from the
 *  first frame, because cannon-es cannot change a body's type after the world is built and any
 *  of them might be the last one standing in its row. A basket that never actually moves is
 *  driven to offset 0 forever, which costs nothing.
 *
 *  On this machine that is every hole: the top row's two 100s (either can be the runaway) and
 *  every basket in a `rows` group (any one of the three can be the last one left). */
export function isMoverHole(G, id) {
  const m = G && G.mover;
  if (!m) return false;
  if (Array.isArray(m.holes) && m.holes.indexOf(id) >= 0) return true;
  return Array.isArray(m.rows) && m.rows.some((r) => r.indexOf(id) >= 0);
}

/** The `rows` group this hole belongs to, or null. A row is a set of baskets that plays
 *  "last one standing": close two of the three and the survivor starts moving. */
export function rowOf(G, id) {
  const m = G && G.mover;
  if (!m || !Array.isArray(m.rows)) return null;
  return m.rows.find((r) => r.indexOf(id) >= 0) || null;
}

/** THE CAP that closes a basket once it has been hit.
 *
 *  GUARD: CLOSING A BASKET IS NOT "CAPTURE TURNED OFF". Leaving the collar standing and refusing
 *  to capture turns a cup into a BOWL: the ball drops in, cannot be taken, and sits there until
 *  the watchdog walks it out twelve seconds later. That is precisely BRICK CITY's parked-ball
 *  failure (test-brickcity-stall.mjs) rebuilt on purpose. So closing a basket REMOVES its collar
 *  segments, and what is left is the board slab - which was solid under the mouth all along,
 *  because capture is the thing that takes the floor away and a closed hole never captures. A
 *  ball rolls over a closed basket exactly the way it rolls over bare tread.
 *
 *  GUARD: FLUSH BY DEFAULT (`capRise` 0), AND ON A ROW THAT CAN MOVE, FLUSH ALWAYS. A raised cap
 *  reads better and deflects a ball with some feel, but it costs two things this machine cannot
 *  pay:
 *
 *    1. A MOVER SWEEPS STRAIGHT OVER THE BASKETS YOU ALREADY CLOSED. Every travel on this machine
 *       runs the full width of its row, so a surviving basket passes through its dead neighbours'
 *       marks twice a period. A bump there is a moving collar converging on a static obstacle -
 *       the pinch that three-contact-locks the solver, which cost POPONGO's first draft 12% of
 *       all throws (MACHINE-SPEC.md section 12). Non-negotiable, and it now applies to EVERY row.
 *    2. A raised cap deflects balls THROWN PAST IT at a row further up. The face closes as the
 *       rack goes on, so it would get progressively more hostile to the top row - exactly when
 *       the top row is the only thing left to throw at.
 *
 *  So `capRise` is a knob left at 0, not a feature removed. Raise it and RE-RUN
 *  test-runaway-capped.mjs, which sweeps the face with every basket closed and fails on a parked
 *  ball. The cap is then a spherical cap of rise h over the collar's outer circle a, with
 *  R = (a^2 + h^2) / (2h), centred (R - h) below the face plane. */
export function capFor(G, id) {
  const H = G.holes[id];
  if (!H) return null;
  const a = H.r + G.collarThick;                       // base circle: the collar's outer wall
  // Anything that can move is flush ALWAYS - something sweeps over it. See guard 1 above.
  const rise = isMoverHole(G, id)
    ? 0
    : G.ballR * (typeof G.capRise === 'number' ? G.capRise : 0);
  if (!(rise > 1e-6)) return { u: H.u, v: H.v, r: a, rise: 0, R: 0, sink: 0 };
  const R = (a * a + rise * rise) / (2 * rise);
  return { u: H.u, v: H.v, r: a, rise, R, sink: R - rise };
}

export function buildMachine(G) {
  const t = G.boardTilt;
  const sin = Math.sin(t);
  const cos = Math.cos(t);

  // The board's bottom edge (face origin): past the lane, the hump and the trough gap.
  const lipZ = -(G.laneLen + G.humpLen + G.troughLen);
  const lipY = G.boardLipY;

  // THE PLAYING SURFACE AS SEGMENTS. One tilted segment (every board until HOT SHOT's
  // stepped rebuild, 2026-08-22), or `G.steps` - an ordered list of { len, tilt } segments
  // forming a STAIRCASE (near-flat treads alternating with vertical risers, Matt's real-machine
  // footage). Face coordinates are UNROLLED along the whole surface: v runs up tread 1, up
  // riser 1, along tread 2, and so on - so holes, collars, paint and capture all keep their one
  // (u, v) address system and nothing downstream has to know how many segments exist. The
  // single-segment case reduces to exactly the old fixed-tilt mapping.
  const segs = Array.isArray(G.steps) && G.steps.length
    ? G.steps
    : [{ len: G.boardLen, tilt: t }];
  const frames = [];
  {
    let y = lipY;
    let z = lipZ;
    let v0 = 0;
    for (const s of segs) {
      const fsin = Math.sin(s.tilt);
      const fcos = Math.cos(s.tilt);
      frames.push({ v0, v1: v0 + s.len, y0: y, z0: z, tilt: s.tilt, sin: fsin, cos: fcos });
      y += s.len * fsin;
      z -= s.len * fcos;
      v0 += s.len;
    }
  }
  const frameAt = (v) => frames.find((fr) => v <= fr.v1) || frames[frames.length - 1];
  /** The local surface tilt at unrolled v. */
  const tiltAt = (v) => frameAt(v).tilt;

  /** Face (u, v, h) -> world [x, y, z]. u lateral, v up the (unrolled) surface, h off it. */
  const faceToWorld = (u, v, h = 0) => {
    const fr = frameAt(v);
    const dv = v - fr.v0;
    return [u, fr.y0 + dv * fr.sin + h * fr.cos, fr.z0 - dv * fr.cos + h * fr.sin];
  };

  /** Face (u, v, h) -> world, IN A GIVEN SEGMENT'S FRAME. Same maths as faceToWorld, except the
   *  caller says which staircase segment the point belongs to instead of letting `v` choose.
   *
   *  GUARD: A COLLAR MUST BE BUILT IN ITS OWN HOLE'S FRAME, NOT SEGMENT-BY-SEGMENT. A collar is
   *  14 boxes on a circle of radius rr around (H.u, H.v), so the rearmost segments carry a `pv`
   *  slightly PAST the hole's own tread. Let faceToWorld resolve those and they are built in the
   *  RISER's frame - which on BRICK CITY put a 5cm bar straight across the throat of every
   *  bottom-row basket, 7cm low and 7cm forward, invisible (render.js draws a wire basket, not
   *  these boxes) and perfectly placed to park a ball half in and half out. Ask each hole's
   *  question in that hole's own frame. */
  const faceToWorldIn = (fr, u, v, h = 0) => {
    const dv = v - fr.v0;
    return [u, fr.y0 + dv * fr.sin + h * fr.cos, fr.z0 - dv * fr.cos + h * fr.sin];
  };

  /** World -> face {u, v, h, tilt} IN A GIVEN SEGMENT'S FRAME, with no nearest-segment search.
   *
   *  GUARD: THIS IS WHAT LETS THE ENGINE SEE A BASKET IT HAS THE BALL IN. worldToFace below picks
   *  the NEAREST segment, and a ball deep in a basket is nearer the RISER standing behind the
   *  mouth than the tread the cup is sunk into - so past a certain depth every basket on a
   *  staircase resolved to a riser frame, where physics.js measured the hole's distance as ~0.22
   *  against a ~0.09 mouth and skipped the very cup the ball was sitting in. The 2026-08-22 rule
   *  that a ball whose centre is below the rim inside the mouth IS captured could therefore never
   *  fire on the deepest part of any basket here. */
  const worldToFaceIn = (fr, p) => {
    const dy = p.y - fr.y0;
    const dz = p.z - fr.z0;
    return {
      u: p.x,
      v: fr.v0 + (dy * fr.sin - dz * fr.cos),
      h: dy * fr.cos + dz * fr.sin,
      tilt: fr.tilt,
    };
  };

  /** World -> face {u, v, h, tilt}: the nearest segment's local coordinates. Physics reads this
   *  for the FREE position of the ball; with one segment it is the exact inverse of faceToWorld.
   *  Anything asking about a specific HOLE must use worldToFaceIn with that hole's frame. */
  const worldToFace = (p) => {
    let best = null;
    for (const fr of frames) {
      const dy = p.y - fr.y0;
      const dz = p.z - fr.z0;
      const lv = dy * fr.sin - dz * fr.cos;
      const lh = dy * fr.cos + dz * fr.sin;
      const len = fr.v1 - fr.v0;
      const inSeg = lv >= -0.02 && lv <= len + 0.02;
      const score = (inSeg ? 0 : 1000) + Math.abs(lh);
      if (!best || score < best.score) {
        best = { u: p.x, v: fr.v0 + Math.max(0, Math.min(len, lv)), h: lh, tilt: fr.tilt, score };
      }
    }
    return best;
  };

  /** The playing surface's y at world z (the staircase silhouette; risers are z-constant). */
  const surfYAt = (z) => {
    let yTop = lipY;
    for (const fr of frames) {
      const len = fr.v1 - fr.v0;
      const z1 = fr.z0 - len * fr.cos;
      if (fr.cos > 1e-6 && z <= fr.z0 + 1e-9 && z >= z1 - 1e-9) {
        return fr.y0 + ((fr.z0 - z) / fr.cos) * fr.sin;
      }
      yTop = fr.y0 + len * fr.sin;
    }
    return yTop;
  };

  const solids = [];
  const rotX = (angle) => ({ axis: [1, 0, 0], angle });

  // --- the lane bed -----------------------------------------------------------------------------
  solids.push({
    part: 'lane',
    pos: [0, -G.bedThick / 2, -G.laneLen / 2],
    half: [G.laneW / 2, G.bedThick / 2, G.laneLen / 2],
    rot: null,
  });

  // --- the hump: a rising quarter-pipe out of angled segments -----------------------------------
  // Segment angles step up to the launch angle; the ball tracks the surface and leaves the lip
  // at (roughly) the last segment's angle - the launch is geometry, not a formula.
  {
    const segs = G.humpAngles.length;
    const segLen = G.humpLen / segs;
    let y = 0;
    let z = -G.laneLen;
    for (let i = 0; i < segs; i++) {
      const a = G.humpAngles[i];
      const dy = segLen * Math.tan(a);
      // A box whose top surface runs from (z, y) to (z - segLen, y + dy).
      const cx = [0, y + dy / 2 - G.bedThick / 2 * Math.cos(a), z - segLen / 2];
      solids.push({
        part: 'hump',
        pos: [cx[0], cx[1], cx[2]],
        half: [G.laneW / 2, G.bedThick / 2, (segLen / Math.cos(a)) / 2 + 0.004],
        rot: rotX(a),
      });
      y += dy;
      z -= segLen;
    }
  }

  // --- the trough: the catch pit between the hump's crest and the board's bottom edge -----------
  // A weak lob dies here; a ball that rolls back off the board's bottom edge lands here too.
  // GUARD: the floor runs from the hump's base all the way UNDER the board's bottom edge - no
  // seam a ball can slip through.
  const troughFar = lipZ - 0.18;
  const troughNear = -G.laneLen - G.humpLen + 0.02;
  solids.push({
    part: 'trough',
    pos: [0, -G.troughDepth - G.bedThick / 2, (troughNear + troughFar) / 2],
    half: [G.laneW / 2 + 0.06, G.bedThick / 2, (troughNear - troughFar) / 2],
    rot: null,
  });
  // The kick panel under the board's lip: a trough ball bounces off it and stays in the trough.
  // Its top stops 3cm short of the lip so there is no ledge a ball could park on (the gap is
  // half a ball wide - nothing fits in it).
  solids.push({
    part: 'kick',
    pos: [0, (lipY - 0.03 - G.troughDepth - 0.02) / 2, lipZ - 0.03],
    half: [G.boardW / 2 + 0.05, (lipY - 0.03 + G.troughDepth + 0.02) / 2, 0.02],
    rot: null,
  });

  // --- the flare: the taper from the lane out to the board -------------------------------------
  // The board is 1.00m wide against a 0.53m lane (see boards.js on why the board is deliberately
  // wider than a real machine). Without this the two just butt together at different widths and
  // read as a mistake. A straight taper across the trough gap makes it read as a flared cabinet,
  // which is what a real one has - just less of it.
  {
    const crestY = G.humpAngles.reduce((a, ang) => a + (G.humpLen / G.humpAngles.length) * Math.tan(ang), 0);
    const crestZ = -(G.laneLen + G.humpLen);
    const dx = G.boardW / 2 - G.laneW / 2;
    const len = Math.hypot(dx, G.troughLen);
    for (const side of [-1, 1]) {
      solids.push({
        part: 'flare',
        pos: [side * (G.laneW / 2 + G.boardW / 2) / 2, (crestY + lipY) / 2, (crestZ + lipZ) / 2],
        half: [0.015, G.railH / 2 + 0.02, len / 2],
        rot: { axis: [0, 1, 0], angle: Math.atan2(side * dx, -G.troughLen) },
      });
    }
  }
  // --- the board: the playing surface, one slab PER SEGMENT -------------------------------------
  // Near-flat segments (treads, and the classic's single face) are part 'board' - the floor that
  // capture removes from under the ball. Steep segments (a staircase's risers) are part 'riser':
  // solid walls the ball bounces off toward the player, NEVER intangible - a captured ball must
  // fall through a tread, not through a wall.
  for (const fr of frames) {
    const len = fr.v1 - fr.v0;
    const mid = (fr.v0 + fr.v1) / 2;
    solids.push({
      part: fr.tilt < 1.0 ? 'board' : 'riser',
      pos: faceToWorld(0, mid, -G.bedThick / 2),
      half: [G.boardW / 2, G.bedThick / 2, len / 2],
      rot: rotX(fr.tilt),
      segV0: fr.v0,
      segV1: fr.v1,
    });
  }

  // --- the rings: ONE PER HOLE ------------------------------------------------------------------
  // GUARD: every ring is DERIVED from the hole it belongs to (rule 1 - tangent at the hole's
  // bottom, centre sits (R - r) up-slope of the hole's centre), not hand-placed. A ring is never
  // concentric with its hole. See DECISIONS.md#ring-geometry.
  const ringSegs = [];
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    if (!H.ringD) continue;
    // GUARD: `ringD` is the INSIDE of the ring (the clear opening), not the wall's centreline.
    // R is the inner radius; the boxes sit half a wall-thickness OUTSIDE it, and `cv` (rule 1's
    // placement) uses R, the inner edge. See DECISIONS.md#ring-geometry.
    const R = H.ringD / 2;
    const Rwall = R + G.ringThick / 2;           // centreline the boxes sit on
    const cu = H.u;
    const cv = H.v - H.r + R;                    // rule 1, the only placement rule there is
    // Segment count scales with RADIUS, not a fixed constant, since these rings range from a
    // 100's small ring to the 10's much larger arc.
    const N = Math.max(20, Math.ceil((2 * Math.PI * Rwall) / 0.04));
    const halfChord = Rwall * Math.tan(Math.PI / N);
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = cu + Rwall * Math.cos(phi);
      const pv = cv + Rwall * Math.sin(phi);
      // GUARD: the 10's ring is an ARC, not a circle - only its lower half exists, because a full
      // circle at that diameter crosses the 50's mouth.
      if (H.ringOpen && pv > cv) continue;
      if (Math.abs(pu) > G.boardW / 2) continue;           // clipped at the side rails
      if (pv < 0 || pv > G.boardLen) continue;             // and at the face's own ends
      // GUARD: EXACT circumscribed-polygon chord so adjacent faces meet flush at the corners - a
      // padded chord leaves a ledge a slow ball can rest against.
      ringSegs.push({
        part: 'ringSeg',
        ring: id,
        pos: faceToWorld(pu, pv, G.ringH / 2),
        half: [halfChord, G.ringH / 2, G.ringThick / 2],
        faceRot: { phi: phi + Math.PI / 2, tilt: tiltAt(H.v) },
      });
    }
  }
  solids.push(...ringSegs);

  // --- the cup collars --------------------------------------------------------------------------
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    if (!H.collarH) continue;                   // the 20 is a flush hole, no collar
    const N = G.cupSegments;
    const rr = H.r + G.collarThick / 2;
    // THE HOLE'S OWN FRAME, resolved ONCE - every segment of this collar is built in it, even the
    // rearmost ones whose `pv` runs past this tread's back edge. See faceToWorldIn's guard.
    const cupFrame = frameAt(H.v);
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = H.u + rr * Math.cos(phi);
      const pv = H.v + rr * Math.sin(phi);
      // A lipLow cup is a tilted tube: the down-slope lip is LOW (a rolling ball rides over it)
      // and the up-slope lip is tall (an overshoot is caught). Height blends around the circle;
      // render.js draws this same profile, vertex for vertex, so the cup you see is the cup the
      // ball hits.
      const lowFrac = typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35;
      let h = H.collarH;
      if (H.lipLow) h = H.collarH * (lowFrac + (1 - lowFrac) * (Math.sin(phi) + 1) / 2);
      solids.push({
        part: 'cupSeg',
        cup: id,
        pos: faceToWorldIn(cupFrame, pu, pv, h / 2),
        half: [rr * Math.tan(Math.PI / N), h / 2, G.collarThick / 2],
        faceRot: { phi: phi + Math.PI / 2, tilt: tiltAt(H.v) },
        segH: h,
        // THE RUNAWAY's collar segments carry the ID OF THE HOLE THEY BELONG TO, and nothing
        // else. Their `pos` above is the RESTING position; physics.js turns exactly these into
        // KINEMATIC bodies and drives each one's x off holeOffset() every substep, and render.js
        // shifts the drawn basket by the same number. Everything else about them - radius,
        // height, rotation, material, the collar's whole shape - is identical to a static
        // basket's, because a moving basket IS a basket that moves and nothing more.
        //
        // GUARD: BOTH TOP-ROW 100s ARE TAGGED, not only the one that ends up sweeping. Either can
        // become the runaway (whichever one you do NOT cap first), and cannon-es cannot change a
        // body's type after the world is built. The one that never moves is driven to offset 0
        // forever, which costs nothing and keeps the two 100s identical until the handoff.
        mover: isMoverHole(G, id) ? id : undefined,
      });
    }
  }

  // --- rails and the backboard ------------------------------------------------------------------
  const railT = 0.03;
  const topPt = faceToWorld(0, G.boardLen, 0);

  // GUARD: the side walls must be bankable - a hard, wide throw needs a wall it can actually
  // carom off into a corner 100, not just a rail that stops a ball leaving. And the front must
  // NOT taper to zero height: a true triangle leaves the player end of the wall too short to
  // meet a low, wide fling, which sails off the side untouched instead of banking. See
  // DECISIONS.md#side-walls.
  //
  // Each wall in WORLD vertical, not perpendicular to the face - what a real cabinet's side panel
  // is, and what makes it read as a wall:
  //     A  the board's bottom corner (player end)
  //     B  the board's top corner
  //     C  the top of the backboard, directly above B
  // AB runs up the board's own slope, BC is the vertical back edge, and the top edge is the
  // diagonal. Sliced into vertical boxes along z; each stands ON the board surface and reaches up
  // to that diagonal, so the ball meets a continuous sloping wall. `railFrontH` gives the player
  // end a real bankable height instead of tapering to zero.
  const railFrontH = 0.34;
  const zA = lipZ;
  const yA = lipY;
  const zB = lipZ - G.boardLen * cos;
  const yB = lipY + G.boardLen * sin;
  // GUARD: THE WALL STARTS OVER THE TROUGH, NOT AT THE BOARD'S LIP. It used to begin exactly at
  // zA, which left the narrow END of it - the edge facing the player - standing in the air the
  // ball flies through on its way to a corner 100. Measured over 210 hard-angled throws: 9% hit
  // that end face, and every single one of them came back a 0, a 10 or a 20. Never anything
  // else, because a flat edge-on hit kills the ball's angle instead of turning it. Carried
  // forward over the trough, an angled ball meets the wall's INNER FACE and banks, which is the
  // shot the corner cups exist for. (Matt, 2026-08-20.)
  const zFront = lipZ + G.troughLen;
  const yTrough = -G.troughDepth;
  // The top edge runs from the front-top corner (yA + railFrontH) up to C.
  const topSlope = ((yB + G.backboardH) - (yA + railFrontH)) / (zB - zFront);
  const WALL_SEGS = 24;
  for (const s of [-1, 1]) {
    for (let i = 0; i < WALL_SEGS; i++) {
      const z0 = zFront + ((zB - zFront) * i) / WALL_SEGS;
      const z1 = zFront + ((zB - zFront) * (i + 1)) / WALL_SEGS;
      const zm = (z0 + z1) / 2;
      // Over the trough there is no board under the wall, so it reaches down to the trough floor
      // - otherwise the extension would hang in the air with a gap beneath it. Over the board it
      // reaches down to the playing surface (the staircase silhouette on a stepped machine).
      const yBoard = zm > zA ? yTrough : surfYAt(zm);
      const yTop = (yA + railFrontH) + topSlope * (zm - zFront);   // the raked top, front -> C
      const h = yTop - yBoard;
      if (h <= 0.004) continue;
      solids.push({
        part: 'rail',
        pos: [s * (G.boardW / 2 + railT / 2), yBoard + h / 2, zm],
        half: [railT / 2, h / 2, Math.abs(z1 - z0) / 2],
        rot: null,
        railSide: s,
      });
    }
    // Lane rails keep the roll on the wood.
    solids.push({
      part: 'laneRail',
      pos: [s * (G.laneW / 2 + railT / 2), G.laneRailH / 2, -(G.laneLen + G.humpLen) / 2],
      half: [railT / 2, G.laneRailH / 2, (G.laneLen + G.humpLen) / 2],
      rot: null,
      railSide: s,
    });
    // Trough side cheeks so a corner ball stays in its corner.
    solids.push({
      part: 'troughWall',
      pos: [s * (G.laneW / 2 + 0.03 + railT / 2), -G.troughDepth / 2, -G.laneLen - G.humpLen - G.troughLen / 2],
      half: [railT / 2, G.troughDepth / 2 + 0.02, G.troughLen / 2 + 0.05],
      rot: null,
    });
  }
  // The backboard: the vertical wall rising from the board's top edge. A real wall the engine
  // bounces the ball off - the reaction IS the contact solve, nothing is scripted.
  const top = faceToWorld(0, G.boardLen, 0);
  // GUARD: THE WALL REACHES PAST THE MARQUEE. render.js draws the marquee as a box 0.3 tall
  // centred 0.02 above backboardH, so its top sits 0.17 higher than the wall used to. That left
  // an 18cm slot between wall-top and sign-top, and a hard throw threaded it and finished BEHIND
  // the header board (Matt, 2026-08-22: "it goes over the wall but under/behind the THE CLASSIC
  // header board thing. that's wrong"). A real cabinet has no such slot - the sign is mounted on
  // a solid back, not hung in front of a gap.
  //
  // NOT the banned ceiling (MACHINE-SPEC section 9): nothing spans the top, and a ball thrown
  // hard enough still clears the machine and leaves. This closes the slot BEHIND the sign, which
  // is cabinet, not sky. 0.18 not 0.17 because the box is seated 0.01 low (the -0.01 below).
  // If render.js's marquee size or offset moves, move this with it.
  const MARQUEE_RISE = 0.18;
  const bbH = G.backboardH + MARQUEE_RISE;
  solids.push({
    part: 'backboard',
    pos: [0, top[1] + bbH / 2 - 0.01, top[2] - 0.02],
    half: [G.boardW / 2 + railT, bbH / 2, 0.02],
    rot: null,
  });

  // --- the cage: REMOVED, do not reintroduce -----------------------------------------------------
  // GUARD: there is no wire canopy over the board. There used to be, to catch overly high
  // "rainbow" throws before they left the machine, but it contradicts the rule that there is no
  // upper limit on throw power - a ball thrown hard enough to leave the machine is SUPPOSED to
  // leave, and it still resolves (arcs out, comes down, scores what it earned). Do not put a
  // canopy back to "fix" a ball leaving the machine. See DECISIONS.md#removed-features-and-why-they-stay-removed.


  // --- invisible containment: FOUR WALLS, NO LID (physics only; render skips part 'keep') -------
  // GUARD: nothing spans the top of the machine. A ball thrown hard enough leaves, and resolves
  // on the way down - physics.js catches anything below y -0.3 and the stall watchdog covers the
  // rest. Do not add a ceiling, a canopy or a pane over the crest.
  const keepH = 1.6;
  const zMin = top[2] - 0.3;
  solids.push(
    { part: 'keep', pos: [0, keepH / 2, 0.45], half: [1.2, keepH / 2, 0.02], rot: null },                        // behind the player
    { part: 'keep', pos: [0, keepH / 2, zMin], half: [1.2, keepH / 2, 0.02], rot: null },                        // behind the backboard
    { part: 'keep', pos: [-(G.boardW / 2 + railT + 0.04), keepH / 2, (zMin + 0.4) / 2], half: [0.02, keepH / 2, (0.4 - zMin) / 2], rot: null },
    { part: 'keep', pos: [G.boardW / 2 + railT + 0.04, keepH / 2, (zMin + 0.4) / 2], half: [0.02, keepH / 2, (0.4 - zMin) / 2], rot: null },
  );

  return {
    solids,
    faceToWorld,
    faceToWorldIn,
    worldToFace,
    worldToFaceIn,
    frameAt,
    tiltAt,
    frames,
    lipY,
    lipZ,
    tilt: t,
    troughZ: [-(G.laneLen + G.humpLen + G.troughLen) + 0.01, -(G.laneLen + G.humpLen) + 0.01],
    troughY: -G.troughDepth,
    // The side wall's outline in the (z, y) plane, so render.js can draw ONE smooth wall per
    // side instead of the WALL_SEGS boxes above (same pattern as the ramp's _rampSkin - the
    // smooth wall drawn is built from the same points the physics boxes use). Order:
    // front-bottom, back-bottom, back-top, front-top. railInnerX is the inner face; the wall is
    // railT thick.
    railProfile: [[zFront, yTrough], [zB, yB], [zB, yB + G.backboardH], [zFront, yA + railFrontH]],
    railInnerX: G.boardW / 2,
    railT,
  };
}

export default {
  buildMachine, sweepU, sweepVel, holeU, holeVel, holeOffset, isMoverHole, rowOf, capFor,
  basePeriod,
};
