// skeeball/js/machine.js - the machine's GEOMETRY, once, in metres. Both engines read this one
// description: physics.js turns every entry in `solids` into a cannon-es static body, and
// render.js turns the same entries into three.js meshes (plus cosmetic dressing that the ball
// can never touch). That is the whole point of this file: the wall you see IS the wall the ball
// hits, so the two can never drift apart the way a hand-drawn board and a hand-rolled collision
// model did.
//
// Coordinates: world x = lateral (right +), y = up, z = toward the player (the machine extends
// into -z). The lane's top surface is y = 0. Face coordinates (u lateral, v metres up the slope
// from the board's bottom edge, h height off the face plane) are mapped through faceToWorld().
//
// Every solid is a BOX: { pos: [x,y,z], half: [hx,hy,hz], rot: {axis, angle} | null, part }.
// Curved furniture (the big ring's band, the cup collars) is approximated with short box
// segments - the standard rigid-body approach - while the renderer draws the smooth cylinder at
// the same radius, a sub-centimetre visual difference that keeps contacts exact.

/** Build the whole machine description for one board's `geom` block. */
export function buildMachine(G) {
  const t = G.boardTilt;
  const sin = Math.sin(t);
  const cos = Math.cos(t);

  // The board's bottom edge (face origin): past the lane, the hump and the trough gap.
  const lipZ = -(G.laneLen + G.humpLen + G.troughLen);
  const lipY = G.boardLipY;

  /** Face (u, v, h) -> world [x, y, z]. u lateral, v up the slope, h off the plane. */
  const faceToWorld = (u, v, h = 0) => [
    u,
    lipY + v * sin + h * cos,
    lipZ - v * cos + h * sin,
  ];

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
  // Where it lands decides the score (physics.js): centre = the 10 slot, corners = the 0s,
  // never-touched-the-board = 0. The floor is real so the ball visibly drops in and rests.
  // Floor runs from the hump's base all the way UNDER the board's bottom edge - no seam a ball
  // can slip through (v1 had a gap here and a soft lob fell out of the world).
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
  // --- the board: one tilted floor slab ---------------------------------------------------------
  const boardCenter = faceToWorld(0, G.boardLen / 2, -G.bedThick / 2);
  solids.push({
    part: 'board',
    pos: boardCenter,
    half: [G.boardW / 2, G.bedThick / 2, G.boardLen / 2],
    rot: rotX(t),                    // slab's +y normal tipped back into the face normal
  });

  // --- the rings: ONE PER HOLE ------------------------------------------------------------------
  // Rewritten 2026-08-14 (batch 3b). There used to be a single big band, `G.ring`, sitting at its
  // own hand-placed centre; the board now has seven rings and every one of them is DERIVED from
  // the hole it belongs to, so the tangency rules in boards.js cannot be broken by editing a
  // number in isolation.
  //
  //   TANGENT AT THE HOLE'S BOTTOM (rule 1). The ring's lowest point is the hole's lowest point,
  //   so its centre sits (R - r) up-slope of the hole's centre. A ring is NEVER concentric with
  //   its hole - it hangs above it, which is why so much white shows over each mouth.
  //
  // The old single band named `G.holes.c50` to decide where to leave a gap, which never fired
  // (so the band ran straight across the 20's and 40's mouths) and threw outright on a board with
  // no c50 - `measure-reach.mjs` builds exactly that. Neither failure is possible now: a ring is
  // tangent to its own hole by construction, and this loop just skips a hole with no `ringD`.
  const ringSegs = [];
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    if (!H.ringD) continue;
    // `ringD` IS THE INSIDE OF THE RING (Matt, 2026-08-14) - the clear opening, not the wall's
    // centreline and not its outside. This was built as the centreline first, which pushed the
    // wall half its thickness (7.5mm) inward of the specified circle; because every ring is
    // tangent to its own hole, that wall then OVERHUNG the hole's edge by 3mm the whole way
    // round, narrowing every mouth the ball has to drop through. Worst on the 100s, whose ring is
    // barely wider than the hole to begin with.
    //
    // So R is the inner radius, and the boxes are placed half a wall-thickness OUTSIDE it. The
    // tangency in `cv` uses R, the inner edge, because that is the circle Matt's table describes.
    const R = H.ringD / 2;
    const Rwall = R + G.ringThick / 2;           // centreline the boxes sit on
    const cu = H.u;
    const cv = H.v - H.r + R;                    // rule 1, the only placement rule there is
    // Segment count follows the RADIUS, not a constant: these rings run from 0.077m (a 100) to
    // 0.518m (the 10's arc), and one fixed count would either facet the big ones into a polygon
    // the ball can catch on a corner of, or spend hundreds of bodies on the small ones.
    const N = Math.max(20, Math.ceil((2 * Math.PI * Rwall) / 0.04));
    const halfChord = Rwall * Math.tan(Math.PI / N);
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = cu + Rwall * Math.cos(phi);
      const pv = cv + Rwall * Math.sin(phi);
      // The 10's ring is an ARC, not a circle (batch 3c): from the left wall, across the bottom,
      // to the right wall, and it STOPS. Only its lower half exists. Without this its upper arc
      // would curve back onto the board and run straight through the 50's mouth - which is a real
      // crossing, not a tangency, and the only one in the whole layout.
      if (H.ringOpen && pv > cv) continue;
      if (Math.abs(pu) > G.boardW / 2) continue;           // clipped at the side rails
      if (pv < 0 || pv > G.boardLen) continue;             // and at the face's own ends
      // EXACT circumscribed-polygon chord so adjacent faces meet flush at the corners. The first
      // draft padded the chord and the overlapping ends left millimetre ledges on the inner
      // surface - enough of a step to park a slow ball against, dead, on the slope.
      ringSegs.push({
        part: 'ringSeg',
        ring: id,
        pos: faceToWorld(pu, pv, G.ringH / 2),
        half: [halfChord, G.ringH / 2, G.ringThick / 2],
        faceRot: { phi: phi + Math.PI / 2, tilt: t },
      });
    }
  }
  solids.push(...ringSegs);

  // --- the 50-ring splitter (Matt, 2026-08-17) -------------------------------------------------
  // A ball thrown to land EXACTLY on the top of the 50 ring perches there and dawdles for a second
  // before rolling off to one side and down to the 10 - an ugly, confusing delay. This is a small
  // thin fin standing on that apex: it removes the flat balance point, so a ball that lands there
  // tips off to the left or right at once. Invisible to the player (render.js skips 'splitter');
  // slick-ish so the ball slides off rather than sticking. It is geometry, not steering - the ball
  // is never pulled anywhere, it just can't balance on a knife edge (the no-magnetism ban holds).
  {
    const c50 = G.holes.c50;
    if (c50 && c50.ringD) {
      const R = c50.ringD / 2;
      const apexV = (c50.v - c50.r + R) + R;       // the 50 ring's top point (up-slope apex)
      // A triangular-prism WEDGE on the board, flush against the 50 ring's up-slope edge (Matt's
      // mockups, 2026-08-17): a triangle seen from above (apex up-slope, base on the ring), a flat
      // top 0.25x tall (NO slope from the side). Its two angled sides shove a ball off to the left
      // or right so it drops to the 10 faster. Built as a convex prism - see physics.js 'prism'.
      const vBase = apexV + G.ringThick / 2;     // the base touches the ring's up-slope outer edge
      const hb = 0.04;                            // half the base width (across u)
      const len = 0.08;                           // up-slope length, base -> apex
      const hgt = G.ringH * 0.25;                 // 0.25x tall, flat top
      solids.push({
        part: 'splitter',
        shape: 'prism',
        verts: [
          faceToWorld(-hb, vBase, 0), faceToWorld(hb, vBase, 0), faceToWorld(0, vBase + len, 0),
          faceToWorld(-hb, vBase, hgt), faceToWorld(hb, vBase, hgt), faceToWorld(0, vBase + len, hgt),
        ],
      });
    }
  }

  // --- the cup collars --------------------------------------------------------------------------
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    if (!H.collarH) continue;                   // the 20 is a flush hole, no collar
    const N = G.cupSegments;
    const rr = H.r + G.collarThick / 2;
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = H.u + rr * Math.cos(phi);
      const pv = H.v + rr * Math.sin(phi);
      // A lipLow cup is the real tilted tube: its mouth faces the incoming ball, so the
      // down-slope lip is LOW (a rolling ball rides straight over it) and the up-slope lip is
      // tall (an overshoot is caught). Height blends around the circle; render.js draws this
      // same profile, vertex for vertex, so the cup you see is the cup the ball hits.
      //
      // `G.lipLowFrac` is how low the front gets, and it is now near zero (2026-08-14). At the
      // old 0.35 the front lip stood ~18mm proud of the face, which to a 50mm ball rolling at
      // walking pace is a step to be hit, not a rim to be crossed - it stopped the ladder before
      // it started.
      const lowFrac = typeof G.lipLowFrac === 'number' ? G.lipLowFrac : 0.35;
      let h = H.collarH;
      if (H.lipLow) h = H.collarH * (lowFrac + (1 - lowFrac) * (Math.sin(phi) + 1) / 2);
      solids.push({
        part: 'cupSeg',
        cup: id,
        pos: faceToWorld(pu, pv, h / 2),
        half: [rr * Math.tan(Math.PI / N), h / 2, G.collarThick / 2],
        faceRot: { phi: phi + Math.PI / 2, tilt: t },
        segH: h,
      });
    }
  }

  // --- rails and the backboard ------------------------------------------------------------------
  const railT = 0.03;
  const topPt = faceToWorld(0, G.boardLen, 0);

  // THE SIDE WALLS OF THE SCORING AREA (rebuilt 2026-08-15). Matt: *"The left and right walls of
  // the scoring area should be much more prominent. They should connect at the top of the back
  // wall, just below 'THE CLASSIC' banner and should be a triangle with the diagonal going from
  // there to the bottom left corner and bottom right corners of the scoring area board. in real
  // life you can bounce the ball off the wall and into the 100, so there needs to be a wall."*
  //
  // They were a 3cm strip standing 10cm off the face, the same height the whole way up - which is
  // a rail to stop a ball leaving, not a wall to play off. A bank shot into a corner 100 needs
  // something the ball can actually meet up there, and at the top of the board the old rail was
  // 10cm against a 14.5cm ball.
  //
  // Each wall in WORLD vertical, not perpendicular to the face - which is what a real cabinet's
  // side panel is, and what makes it read as a wall:
  //     A  the board's bottom corner (player end)
  //     B  the board's top corner
  //     C  the top of the backboard, directly above B
  // AB runs up the board's own slope, BC is the vertical back edge, and the top edge is the
  // diagonal. Sliced into vertical boxes along z; each stands ON the board surface and reaches up
  // to that diagonal, so the ball meets a continuous sloping wall.
  //
  // THE FRONT DOES NOT TAPER TO ZERO ANY MORE (Matt, 2026-08-16: *"l needs to come more towards
  // the player. I want to be able to bounce the ball off it and into the 100, but that's not
  // possible right now because it's not wide enough."*). It used to be a true triangle - zero
  // height at A - so a hard, wide fling reached the side low on the board where there was no wall
  // at all and sailed straight off for a 0 (measured: power 1.0 at any wide aim scored 0/10 with
  // ZERO bounces - the ball never met a wall). `railFrontH` gives the player end a real bankable
  // height, so the wall now runs the whole length and a wide ball caroms off it toward the corner
  // 100 instead of leaving. It still rakes up to the full backboard height at the back, so it
  // reads as a raked side wall rather than a full slab.
  const railFrontH = 0.34;
  const zA = lipZ;
  const yA = lipY;
  const zB = lipZ - G.boardLen * cos;
  const yB = lipY + G.boardLen * sin;
  // The top edge now runs from the front-top corner (yA + railFrontH) up to C.
  const topSlope = ((yB + G.backboardH) - (yA + railFrontH)) / (zB - zA);
  const WALL_SEGS = 20;
  for (const s of [-1, 1]) {
    for (let i = 0; i < WALL_SEGS; i++) {
      const z0 = zA + ((zB - zA) * i) / WALL_SEGS;
      const z1 = zA + ((zB - zA) * (i + 1)) / WALL_SEGS;
      const zm = (z0 + z1) / 2;
      const yBoard = yA + (zA - zm) * (sin / cos);              // the face, climbing as z goes back
      const yTop = (yA + railFrontH) + topSlope * (zm - zA);    // the raked top, front -> C
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
  solids.push({
    part: 'backboard',
    pos: [0, top[1] + G.backboardH / 2 - 0.01, top[2] - 0.02],
    half: [G.boardW / 2 + railT, G.backboardH / 2, 0.02],
    rot: null,
  });

  // --- the cage: REMOVED 2026-08-16 ------------------------------------------------------------
  // There used to be a slanted wire canopy over the board here, to stop rainbow shots: a high arc
  // met it and dropped onto the face instead of sailing out of the machine. Matt spotted its
  // wires as faint lines across the back wall and asked what they were.
  //
  // It went rather than being hidden, because it contradicted a rule he had already set: *"there
  // should be no limit on how high i can throw the ball. If a swipe as hard as i can, the ball
  // should launch like crazy high over the machine or something."* A canopy whose entire job is
  // to catch those throws cannot coexist with that. The clamp on power came off for the same
  // reason; this is the physical half of the same decision.
  //
  // Do not put it back to "fix" a ball leaving the machine. A ball thrown that hard is SUPPOSED
  // to leave, and it still resolves - it arcs out, comes down, and scores the zero it earned.

  // --- the front glass: the pane every real cabinet has above the hump --------------------------
  // Launch arcs pass UNDER its bottom edge on the way in (they cross the crest low); what it
  // stops is the rare hard ricochet flying back out of the machine at half height. Rendered as
  // a faint sheen; physically dead so a ball that meets it drops into the trough.
  solids.push({
    part: 'glass',
    // Bottom edge must clear the LAUNCH ARC. The pane used to sit with its lower edge at
    // y=0.55, which a shallow ramp passed under; a steep one (67.5 deg, crest y 0.43) drives the
    // ball straight into it and every throw dies on the glass. Raised so the ball leaves the
    // crest underneath it and it still catches a high ricochet on the way back.
    pos: [0, 1.15, -(G.laneLen + G.humpLen) + 0.03],
    half: [G.boardW / 2 + railT, 0.4, 0.008],
    rot: null,
  });

  // --- invisible containment (physics only; render skips part 'keep') ---------------------------
  const keepH = 1.6;
  const zMin = top[2] - 0.3;
  solids.push(
    { part: 'keep', pos: [0, keepH, (zMin + 0.4) / 2], half: [1.2, 0.02, (0.4 - zMin) / 2], rot: null },        // ceiling
    { part: 'keep', pos: [0, keepH / 2, 0.45], half: [1.2, keepH / 2, 0.02], rot: null },                        // behind the player
    { part: 'keep', pos: [0, keepH / 2, zMin], half: [1.2, keepH / 2, 0.02], rot: null },                        // behind the backboard
    { part: 'keep', pos: [-(G.boardW / 2 + railT + 0.04), keepH / 2, (zMin + 0.4) / 2], half: [0.02, keepH / 2, (0.4 - zMin) / 2], rot: null },
    { part: 'keep', pos: [G.boardW / 2 + railT + 0.04, keepH / 2, (zMin + 0.4) / 2], half: [0.02, keepH / 2, (0.4 - zMin) / 2], rot: null },
  );

  return {
    solids,
    faceToWorld,
    lipY,
    lipZ,
    tilt: t,
    troughZ: [-(G.laneLen + G.humpLen + G.troughLen) + 0.01, -(G.laneLen + G.humpLen) + 0.01],
    troughY: -G.troughDepth,
    // The side wall's outline in the (z, y) plane, so render.js can draw ONE smooth wall per side
    // instead of the WALL_SEGS boxes above - whose stepped tops read as a pixelated hypotenuse in
    // game (Matt, 2026-08-16). Same source as the physics boxes, so the smooth wall you see is the
    // wall the ball hits (the ramp already does this via _rampSkin). Order: front-bottom,
    // back-bottom, back-top, front-top. railInnerX is the inner face; the wall is railT thick.
    railProfile: [[zA, yA], [zB, yB], [zB, yB + G.backboardH], [zA, yA + railFrontH]],
    railInnerX: G.boardW / 2,
    railT,
  };
}

export default { buildMachine };
