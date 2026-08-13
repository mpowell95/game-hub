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

  // --- the board: one tilted floor slab ---------------------------------------------------------
  const boardCenter = faceToWorld(0, G.boardLen / 2, -G.bedThick / 2);
  solids.push({
    part: 'board',
    pos: boardCenter,
    half: [G.boardW / 2, G.bedThick / 2, G.boardLen / 2],
    rot: rotX(t),                    // slab's +y normal tipped back into the face normal
  });

  // --- the big ring's band ----------------------------------------------------------------------
  const ringSegs = [];
  {
    const N = G.ringSegments;
    const cu = G.ring.u;
    const cv = G.ring.v;
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = cu + G.ring.R * Math.cos(phi);
      const pv = cv + G.ring.R * Math.sin(phi);
      // The cup owns the junction (the pinball parking-space lesson, now applied by GEOMETRY):
      // where the 50's collar merges into the band's top arc, the band simply has no segment.
      const near50 = Math.hypot(pu - G.holes.c50.u, pv - G.holes.c50.v) < G.holes.c50.r + G.collarThick * 2.5;
      if (near50) continue;
      // EXACT circumscribed-polygon chord so adjacent faces meet flush at the corners. The first
      // draft padded the chord and the overlapping ends left millimetre ledges on the inner
      // surface - enough of a step to park a slow ball against, dead, on the slope.
      const halfChord = G.ring.R * Math.tan(Math.PI / N);
      ringSegs.push({
        part: 'ringSeg',
        pos: faceToWorld(pu, pv, G.ringH / 2),
        half: [halfChord, G.ringH / 2, G.ringThick / 2],
        faceRot: { phi: phi + Math.PI / 2, tilt: t },
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
    for (let i = 0; i < N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const pu = H.u + rr * Math.cos(phi);
      const pv = H.v + rr * Math.sin(phi);
      // A lipLow cup is the real tilted tube: its mouth faces the incoming ball, so the
      // down-slope lip is LOW (a rolling ball hops it in) and the up-slope lip is tall (an
      // overshoot is caught). Height blends around the circle; the renderer draws the same tilt.
      let h = H.collarH;
      if (H.lipLow) h = H.collarH * (0.35 + 0.65 * (Math.sin(phi) + 1) / 2);
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
  for (const s of [-1, 1]) {
    // Board rails ride ON the face along its whole length.
    solids.push({
      part: 'rail',
      pos: faceToWorld(s * (G.boardW / 2 + railT / 2), G.boardLen / 2, G.railH / 2),
      half: [railT / 2, G.railH / 2, G.boardLen / 2],
      rot: rotX(t),
      railSide: s,
    });
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

  // --- the cage: the slanted wire canopy every real classic has over its board ------------------
  // It is what stops rainbow shots: a high arc (or a high backboard rebound) meets it and drops
  // onto the face to rattle out honestly, instead of sailing back over the trough to the lane.
  // Physics treats it as a dead slab; the renderer draws it as sparse wire so it reads true.
  {
    const cageHigh = [top[1] + G.backboardH * 0.68, top[2] - 0.04];       // above the backboard
    const cageLow = [lipY + 0.60, lipZ - 0.02];                            // over the board's lip
    const dy = cageLow[0] - cageHigh[0];
    const dz = cageLow[1] - cageHigh[1];
    const ang = Math.atan2(-dy, dz);
    solids.push({
      part: 'cage',
      pos: [0, (cageHigh[0] + cageLow[0]) / 2, (cageHigh[1] + cageLow[1]) / 2],
      half: [G.boardW / 2 + railT, 0.015, Math.hypot(dy, dz) / 2 + 0.02],
      rot: rotX(ang),
    });
  }

  // --- the front glass: the pane every real cabinet has above the hump --------------------------
  // Launch arcs pass UNDER its bottom edge on the way in (they cross the crest low); what it
  // stops is the rare hard ricochet flying back out of the machine at half height. Rendered as
  // a faint sheen; physically dead so a ball that meets it drops into the trough.
  solids.push({
    part: 'glass',
    pos: [0, 0.95, -(G.laneLen + G.humpLen) + 0.03],
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
  };
}

export default { buildMachine };
