// skeeball/js/swipe.js - HOW A THUMB BECOMES A THROW. The single source of it. This maths must
// never be duplicated into a second file (a measuring tool that disagrees with the thing it
// measures is worse than no tool - see DECISIONS.md#measured-swipe-data for what that cost once).
// DOM-free on purpose - the caller passes the window height in - so it stays testable.

/** The ends of the NATURAL swipe range, in screen-heights per second.
 *
 *  These are not the limits of a throw, they are the limits of a comfortable one:
 *    SWIPE_SLOW -> power 0 -> the ball just barely reaches the board
 *    SWIPE_FAST -> power 1 -> the top of the 100 ring
 *  Power is deliberately NOT clamped to that range (see powerOf and physics.js's startThrow): a
 *  slower swipe than SWIPE_SLOW should fall short of the board for a 0 or roll back, and a harder
 *  one than SWIPE_FAST should climb the backboard.
 *
 *  MEASURE THESE, DO NOT REASON ABOUT THEM. They describe a hand, not a formula. See
 *  DECISIONS.md#measured-swipe-data before changing either value.
 */
export const SWIPE_SLOW = 0.65;
export const SWIPE_FAST = 4.20;

/** The smallest upward travel that counts as a throw at all, in px. */
export const MIN_UP_PX = 20;

/**
 * One swipe -> its speed in screen-heights per second, or null if it was not a throw.
 *
 * `samples` is [{ x, y, t }, ...] in order, y in CSS px growing downward, t from `e.timeStamp`
 * (NEVER performance.now(): under load the handlers run late and bunched, and handler-time
 * clocking collapses a strong swipe into a dribble - which only shows on a busy phone).
 *
 * Whether it counts as a throw is decided on the WHOLE gesture, never on just the final release
 * window - a slow, deliberate push is still a real throw, and speed is the max of the release
 * window's rate and the whole gesture's average so a soft finish never masks a real throw.
 */
export function swipeSpeed(samples, windowH) {
  if (!samples || samples.length < 2) return null;
  const first = samples[0];
  const end = samples[samples.length - 1];
  const totalUp = first.y - end.y;                          // + = upward
  if (totalUp < MIN_UP_PX) return null;                     // a tap or a sideways smudge

  const totalMs = Math.max(16, end.t - first.t);
  let ref = first;
  for (const smp of samples) { if (end.t - smp.t <= 200) { ref = smp; break; } }
  const releaseUp = (ref.y - end.y) / (Math.max(16, end.t - ref.t) / 1000);
  const wholeUp = totalUp / (totalMs / 1000);
  const up = Math.max(releaseUp, wholeUp);                  // px/s

  // Normalised against the WINDOW so a phone and a desktop feel alike - and so the tool and the
  // game share one ruler. The floor only stops a silly divisor on a tiny embedded frame.
  return up / Math.max(320, windowH);
}

/** Swipe speed -> power. NOT clamped: outside 0..1 is meaningful (see SWIPE_SLOW's note). */
export function powerOf(perH) {
  return (perH - SWIPE_SLOW) / (SWIPE_FAST - SWIPE_SLOW);
}

/**
 * Power -> the launch speed physics.js will actually use, in m/s. Exported so the flick test can
 * show what a given flick becomes without importing the whole solver, and so the two can never
 * disagree about it. Mirrors startThrow: power is spent as ENERGY (v^2 interpolated, not v), and
 * extrapolates outside 0..1 by the same rule.
 */
export function launchSpeed(power, minSpeed, maxSpeed) {
  const p = Math.max(-0.75, power);          // no upper bound - see startThrow
  return Math.sqrt(Math.max(0.4, minSpeed * minSpeed + p * (maxSpeed * maxSpeed - minSpeed * minSpeed)));
}

export default { SWIPE_SLOW, SWIPE_FAST, MIN_UP_PX, swipeSpeed, powerOf, launchSpeed };
