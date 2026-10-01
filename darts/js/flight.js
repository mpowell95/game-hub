// darts/js/flight.js - the THROW, in 3D (2026-10-01). Pure maths, no DOM, tested by darts/js/test.js.
//
// Matt, after the first build: "The darts go more like a line drive than in the example video."
// Frame by frame at 60 fps, GamePigeon's dart is not sliding across a picture of a board: it flies
// AWAY from a camera standing behind the thrower. It leaves the hand big and pointing up the screen,
// shrinks fast and then slower as it nears the board (perspective), rises and drops on an arc, and
// tips over as it goes, so it arrives showing only its flights end-on. All of that falls out of one
// model: a real projectile in metres, seen through a pinhole camera.
//
//   - The camera sits at the origin looking down +Z at the board centre, which is OCHE m away
//     (2.37 m, the regulation throwing distance). x right, y DOWN (canvas convention), z away.
//   - The board's scoring radius is BOARD_R m (0.17 m, the double's outer wire), and the camera's
//     focal length is chosen so it projects to exactly R px: the board on screen is unchanged.
//   - A dart is a tip point and an axis (unit vector, tail -> tip). It is drawn by projecting the
//     tip and the tail; a dart pointing away from the camera from below eye level therefore looks
//     like it points UP the screen, and one sticking in the board shrinks to its flights.
//   - The flight (makeFlight / at, below) is paced to match the video rather than a stopwatch, and
//     the axis turns to follow the velocity. It always ends exactly on the landing point the rules
//     already decided (engine.flickLanding / computerThrow / an online log entry), so scoring never
//     depends on it.
//
// Real darts leave the hand at about 5-6 m/s, 15-20 degrees up, and land tilted slightly down
// (published dart-physics write-ups, e.g. dolfdarts.com/science): the arrival here is nose-down too.

export const OCHE = 2.37;
export const BOARD_R = 0.17;
/** How much nearer the camera the dart in the hand is than the board (depth of the hand). */
export const HAND_Z = 0.55;
/** The flight, start to board, in seconds. */
export const FLIGHT_T = 0.34;
/** The dart in the hand: seen side-on, pointing up the screen (and a little into the board). */
export const REST_AXIS = norm([0, -1, 0.35]);
/** The dart in the board: pointing straight in, nose a touch down, so it shows its flights end-on. */
export const STUCK_AXIS = norm([0, 0.1, 1]);
/** When the dart tips over: the fraction of the flight where it starts turning onto its flights. */
export const TIP_FROM = 0.7;

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** A camera for a board drawn at (cx, cy) with scoring radius R px. */
export function makeCamera(cx, cy, R) {
  return { cx, cy, f: (R * OCHE) / BOARD_R };
}
export function project(cam, p) {
  const z = Math.max(1e-3, p[2]);
  return { x: cam.cx + (cam.f * p[0]) / z, y: cam.cy + (cam.f * p[1]) / z, z };
}
/** The world point at depth `z` that projects to screen (px, py). */
export function unproject(cam, px, py, z) {
  return [((px - cam.cx) * z) / cam.f, ((py - cam.cy) * z) / cam.f, z];
}
/** A board point (x, y in units of R) on the board plane, in metres. */
export function boardPoint(x, y) { return [x * BOARD_R, y * BOARD_R, OCHE]; }

/** Screen pose of a dart: tip and tail in px, plus the depth of its middle (for its width). */
export function pose(cam, tip, axis, len) {
  const tail = [tip[0] - axis[0] * len, tip[1] - axis[1] * len, tip[2] - axis[2] * len];
  const a = project(cam, tip), b = project(cam, tail);
  return { tip: a, tail: b, zMid: (a.z + b.z) / 2 };
}

/** The dart's world length so that, resting in the hand at screen (px, py), it is `screenLen` px
 *  long on screen. Found by bisection (projected length grows with world length). */
export function solveLength(cam, px, py, screenLen) {
  const tip = unproject(cam, px, py, HAND_Z);
  let lo = 0.005, hi = HAND_Z * 0.9;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = pose(cam, tip, REST_AXIS, mid);
    if (Math.hypot(p.tip.x - p.tail.x, p.tip.y - p.tail.y) < screenLen) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A flight from world point `from` (the dart's tip in the hand) to board point (bx, by).
 *
 * NOT a textbook parabola, on purpose, and measured against the reference: in GamePigeon's video the
 * dart stays big and upright for most of the flight, travels up the screen at a steady, slowing pace,
 * and only tips over onto its flights in the last few frames. A true constant-speed throw does the
 * opposite (it shrinks fourfold in the first third, flattens at once, then crawls), which read as
 * wrong the moment it was filmed. So the DEPTH is paced in inverse depth (1/z moves evenly), which
 * makes the screen position and size move evenly, and its speed away from the camera (dz/dt grows
 * with z squared) is small at first and large at the end - so the axis, which follows the velocity,
 * points up the screen early and swings into the board late: the pitch-over in the video.
 * A LOB (Matt, 2026-10-01: "Yes I want a bigger one"): the path always peaks ARC board radii ABOVE
 * its landing point, whatever the target, then drops onto it nose-first. The rise needed for that
 * is solved per flight (`makeFlight`), since a dart aimed low has further to climb than one aimed at
 * the top of the board.
 */
export const ARC = 0.45;
/** Screen pace: eased out, so it slows into the board, but never to a dead stop - it still has the
 *  last of its drop when it hits, so it lands nose-down. */
const ease = (u) => 0.65 * (1 - Math.pow(1 - u, 1.8)) + 0.35 * u;

export function makeFlight(from, bx, by, T = FLIGHT_T) {
  const to = boardPoint(bx, by);
  const b0 = from[1] / from[2], b1 = to[1] / to[2];
  // The highest point of b0 + (b1 - b0) s - H sin(pi s) must sit ARC board radii above b1: solve H.
  const want = b1 - ARC * (BOARD_R / OCHE);
  const peak = (H) => { let m = Infinity; for (let i = 0; i <= 60; i++) { const q = i / 60; m = Math.min(m, b0 + (b1 - b0) * q - H * Math.sin(Math.PI * q)); } return m; };
  let lo = 0, hi = 4 * (BOARD_R / OCHE) + Math.abs(b0 - b1) * 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (peak(mid) > want) lo = mid; else hi = mid; }
  const fl = { from, to, T, H: (lo + hi) / 2 };
  // The typical screen speed of this flight, so the apex (where the dart all but stops on screen)
  // can be recognised and drawn nose-over, pointing INTO the board, rather than turned sideways.
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += screenStep(fl, i / 50, (i + 1) / 50).d;
  fl.dMean = sum / 50;
  return fl;
}
function screenStep(fl, q1, q2) {
  const p1 = pointAt(fl, q1), p2 = pointAt(fl, q2);
  const da = p2[0] / p2[2] - p1[0] / p1[2], db = p2[1] / p2[2] - p1[1] / p1[2];
  return { da, db, d: Math.hypot(da, db) };
}
function pointAt(fl, k) {
  const s = ease(Math.max(0, Math.min(1, k)));
  const z0 = fl.from[2], z1 = fl.to[2];
  // Depth lags the screen position: the dart is nearly over its target while still big, then
  // shrinks fast as it tips in (the video's last frames).
  const sz = Math.pow(s, 1.8);
  const z = 1 / (1 / z0 + (1 / z1 - 1 / z0) * sz);
  // Screen-plane coordinates (x/z, y/z) move evenly between the two ends, with the rise added.
  const a0 = fl.from[0] / z0, a1 = fl.to[0] / z1;
  const b0 = fl.from[1] / z0, b1 = fl.to[1] / z1;
  const rise = (fl.H || 0) * Math.sin(Math.PI * s);
  return [(a0 + (a1 - a0) * s) * z, (b0 + (b1 - b0) * s - rise) * z, z];
}
export function at(fl, t) {
  const k = Math.max(0, Math.min(1, t / fl.T));
  const tip = pointAt(fl, k);
  // THE AXIS IS STEERED, NOT DERIVED. In true perspective a dart pointing at the board is seen
  // end-on the moment it is level with its target, so it flattened a third of the way up the screen.
  // GamePigeon keeps it side-on, pointing along its path on screen - up while it climbs, nose over
  // and down as the lob falls - and tips it onto its flights only in the last stretch (TIP_FROM).
  const q2 = Math.min(1, k + 0.02), q1 = q2 - 0.02;
  const { da, db, d } = screenStep(fl, q1, q2);
  // Along the path on screen, with a fixed lean into the board - which takes over as the dart slows
  // at the top of the lob, so it noses over THROUGH end-on instead of swinging round sideways.
  const floor = 0.6 * ((fl.dMean || 0) * 0.02 / 0.02);
  const lean = (REST_AXIS[2] / -REST_AXIS[1]) * Math.max(d, floor);
  // In world terms: a vector with depth component `lean` projects at (vx - a*lean, vy - b*lean) for
  // a dart at screen-plane position (a, b), so add that back or off-centre darts lean sideways.
  const a = tip[0] / tip[2], b = tip[1] / tip[2];
  const up = d + lean > 1e-12 ? norm([da + a * lean, db + b * lean, lean]) : REST_AXIS;
  const u = Math.max(0, Math.min(1, (k - TIP_FROM) / (1 - TIP_FROM)));
  const w = u * u * (3 - 2 * u);
  const start = k < 0.12 ? norm(REST_AXIS.map((v, i) => v + (up[i] - v) * (k / 0.12))) : up;
  const axis = norm(start.map((v, i) => v + (STUCK_AXIS[i] - v) * w));
  return { tip, axis };
}

/** The way a dart sits in the board once it lands: every flight ends on STUCK_AXIS, so a dart
 *  replayed from an online log or restored from a save sits exactly as a freshly thrown one does. */
export function stuckAxis() { return STUCK_AXIS; }
