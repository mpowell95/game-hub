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
//   - The flight (makeFlight / at, below) is copied off GamePigeon's video, frame by frame, and the
//     axis turns from side-on to end-on. It always ends exactly on the landing point the rules
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
export const FLIGHT_T = 0.47;
/** The dart in the hand: seen side-on, pointing up the screen (and a little into the board). */
export const REST_AXIS = norm([0, -1, 0.35]);
/** The dart in the board: pointing straight in, nose a touch down, so it shows its flights end-on. */
export const STUCK_AXIS = norm([0, 0.1, 1]);

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
 * COPIED FROM GAMEPIGEON'S VIDEO, frame by frame (2026-10-01, Matt: "make it match game pigeon").
 * Twelve of its throws were tracked at 60 fps - where the dart is on screen and how big it is (its
 * size gives its depth) - and every one does the same two things in 0.47 s:
 *
 *   1. CLIMB (the first 60%): it rushes up the screen and slows (screen progress 1-(1-k)^3) to a
 *      point ABOVE its target - about a third of a board radius above, a little more for a low
 *      target, a little less for a high one (APEX_*). Its depth starts slowly and speeds up
 *      ((k)^1.8), so it stays big off the hand and shrinks late. It turns from side-on to its
 *      flights end-on in the first 42%, slowly at first.
 *   2. SETTLE (the last 40%): already small and end-on, nearly at the board, it drops straight down
 *      onto its target, gathering speed (v^1.5).
 *
 * Impossible in real life (it slides down the face of the board), and exactly what the video shows.
 * The two halves are written in SCREEN terms (a = x/z, b = y/z) plus a depth, then lifted back into
 * the world, so this camera draws exactly that.
 *
 * What it replaced: a lob solved on screen with the axis steered along the screen path. At the top
 * the path reversed, the steered axis swung through it, and for a frame the dart was drawn as a big
 * sideways cross by the bull, then popped up by the 20 pointing down (Matt: "Something has gone
 * horribly wrong"). Here the axis is never derived from the path, so it cannot flip.
 */
/** Where the climb ends: this many board radii above the target, plus APEX_SLOPE per radius the
 *  target sits below the bull (measured 0.24R aimed high, 0.33R mid, 0.43R low, 0.52R very low). */
export const APEX = 0.33;
export const APEX_SLOPE = 0.128;
/** The climb's share of the flight; the settle is the rest. */
export const CLIMB = 0.6;
/** The axis is end-on by this fraction of the flight. */
export const TURN = 0.42;

/** The least a throw climbs on screen before it settles, in board radii (2026-10-02). */
export const MIN_RISE = 0.3;

export function makeFlight(from, bx, by, T = FLIGHT_T) {
  const to = boardPoint(bx, by);
  const k = BOARD_R / OCHE;
  let off = Math.max(0.12, APEX + APEX_SLOPE * (by + 0.45)) * k;
  // EVERY THROW CLIMBS FIRST (Matt, 2026-10-02: "If I drag the dart up instead of doing a very quick
  // flick, it reverts to do that weird impossible trajectory"). A dart dragged up the screen can be
  // let go ABOVE the point it climbs to, so the "climb" ran DOWN the screen into the board. Now the
  // climb always ends at least MIN_RISE above where the dart was let go, and the settle drops the
  // rest of the way: the same two halves as every other throw, just a longer drop.
  const b0 = from[1] / from[2], b1 = to[1] / to[2];
  if (b1 - off > b0 - MIN_RISE * k) off = b1 - (b0 - MIN_RISE * k);
  return { from, to, T, off };
}
function pointAt(fl, k) {
  k = Math.max(0, Math.min(1, k));
  const { from: f, to } = fl;
  const a0 = f[0] / f[2], b0 = f[1] / f[2], a1 = to[0] / to[2], b1 = to[1] / to[2];
  const bApex = b1 - fl.off;
  let a, b, q;
  if (k < CLIMB) {
    const u = k / CLIMB, p = 1 - Math.pow(1 - u, 3);
    a = a0 + (a1 - a0) * p; b = b0 + (bApex - b0) * p; q = 0.9 * Math.pow(u, 1.8);
  } else {
    const v = (k - CLIMB) / (1 - CLIMB);
    a = a1; b = bApex + fl.off * Math.pow(v, 1.5); q = 0.9 + 0.1 * v;
  }
  const z = f[2] + (to[2] - f[2]) * q;
  return [a * z, b * z, z];
}
export function at(fl, t) {
  const k = Math.max(0, Math.min(1, t / fl.T));
  // Side-on in the hand (REST_AXIS) to end-on (STUCK_AXIS), slow to start, done by TURN. Neither axis has a
  // sideways part, so the dart only ever leans the way perspective leans it.
  const u = Math.min(1, k / TURN), w = u * u;
  const axis = norm(REST_AXIS.map((v, i) => v + (STUCK_AXIS[i] - v) * w));
  return { tip: pointAt(fl, k), axis };
}

/** The way a dart sits in the board once it lands: every flight ends on STUCK_AXIS, so a dart
 *  replayed from an online log or restored from a save sits exactly as a freshly thrown one does. */
export function stuckAxis() { return STUCK_AXIS; }
