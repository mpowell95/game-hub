// skeeball/js/swipe.js - HOW A THUMB BECOMES A THROW. The single source of it.
//
// WHY THIS FILE EXISTS. This maths used to live inside ui.js's _swipeEnd, and skeeball's
// flick-test.html carried a hand-copied duplicate of it so the numbers it printed would be the
// numbers the game read. Two copies of the same maths in two files drift, and this pair drifted
// inside ONE edit: moving the test page's pad to the bottom made the pad shorter than the game's
// stage, so the page was switched to normalise against the window while the game still divided by
// the stage. The page then printed confident readings on a scale the game did not use, the
// constants below were tuned from those readings, and a throw measured at 0.46 - as slow as Matt
// could physically move - still had enough in it to reach the 10.
//
// So: BOTH the game and the tool import this file. A measuring tool that does not agree with the
// thing it measures is worse than no tool, because it is wrong with confidence. Never re-inline
// any of this, and never let the page keep its own copy again.
//
// DOM-free on purpose - the caller passes the window height in - so it stays testable.

/** The ends of the NATURAL swipe range, in screen-heights per second.
 *
 *  These are not the limits of a throw, they are the limits of a comfortable one:
 *    SWIPE_SLOW -> power 0 -> the ball just barely reaches the board
 *    SWIPE_FAST -> power 1 -> the top of the 100 ring
 *  Power is deliberately NOT clamped to that range (see powerOf and physics.js's startThrow): a
 *  slower swipe than SWIPE_SLOW should fall short of the board for a 0 or roll back, and a harder
 *  one than SWIPE_FAST should climb the backboard. Matt's rule, 2026-08-14.
 *
 *  MEASURE THESE, DO NOT REASON ABOUT THEM. They describe a hand. Four rounds of setting them by
 *  feel were all wrong, in the same direction, and each one cost a round trip: a value below what
 *  a hand can do makes the gentlest flick start at half power, and a value at an ORDINARY flick's
 *  speed pins every normal throw at maximum. flick-test.html measures them directly.
 */
export const SWIPE_SLOW = 1.10;
export const SWIPE_FAST = 3.05;

/** The smallest upward travel that counts as a throw at all, in px. */
export const MIN_UP_PX = 20;

/**
 * One swipe -> its speed in screen-heights per second, or null if it was not a throw.
 *
 * `samples` is [{ x, y, t }, ...] in order, y in CSS px growing downward, t from `e.timeStamp`
 * (NEVER performance.now(): under load the handlers run late and bunched, and handler-time
 * clocking collapses a strong swipe into a dribble - which only shows on a busy phone).
 *
 * IS IT A THROW? Decided on the WHOLE gesture, never on the last few milliseconds. An older build
 * asked whether the final 130ms carried 24px, which silently discarded any swipe made slowly:
 * two of five deliberate swipes produced no ball and no message at all, including a 464px push up
 * the full lane over 900ms - the most natural "roll it gently" gesture there is.
 *
 * HOW FAST WAS IT? The release window is what a flick IS, but a long deliberate push that eases
 * off at the very end is still a throw of that push's strength, not of its last inch - so the
 * whole swipe's average is a floor under the release speed.
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
  const p = Math.max(-0.75, Math.min(2.0, power));
  return Math.sqrt(Math.max(0.4, minSpeed * minSpeed + p * (maxSpeed * maxSpeed - minSpeed * minSpeed)));
}

export default { SWIPE_SLOW, SWIPE_FAST, MIN_UP_PX, swipeSpeed, powerOf, launchSpeed };
