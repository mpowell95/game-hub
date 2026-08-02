// viewport.js - the ONE way a game subscribes to "the viewport changed, re-fit yourself".
//
// Why this exists (2026-08-02, the sluggish/glitchy pass). Eleven games each did:
//
//     window.addEventListener('resize', this._onResize);
//
// with a handler that synchronously re-measures and re-lays-out the board. On a desktop that is
// fine - `resize` fires a handful of times while you drag a window edge. On a phone it is the
// direct cause of "glitchy scrolling on various screens", because a mobile browser fires `resize`
// CONTINUOUSLY while the URL bar slides in and out - which is to say, on essentially every scroll.
// Each of those events ran a full board re-layout on the main thread, several times per frame,
// while the user was mid-scroll. Dominoes additionally subscribed to `visualViewport`'s own resize,
// which fires on every frame of that animation and on every keyboard show/hide.
//
// The fix is to coalesce: no matter how many events arrive, the callback runs AT MOST ONCE PER
// FRAME, and always with the final measurements for that frame. That is semantically transparent -
// every handler here is an idempotent "re-fit to whatever the size is now", so running it once with
// the settled size is strictly better than running it five times with intermediate ones.
//
// It also skips a re-layout when neither dimension actually changed. This matters more than it
// sounds: iOS fires `resize` for things that do not change the layout box a game cares about, and a
// no-op re-layout mid-scroll is exactly the jank being removed.

/**
 * Subscribe to viewport size changes, coalesced to at most one callback per animation frame.
 *
 * Covers `window` resize, `orientationchange`, and `visualViewport` resize (the last is what
 * actually moves under a mobile keyboard, so a game that cares about the keyboard still gets it) -
 * all three folded into the same single per-frame callback rather than three separate re-layouts.
 *
 * @param {() => void} cb  called after a real size change, at most once per frame
 * @param {{ immediate?: boolean }} [opts]  `immediate: true` also calls `cb` once on subscribe
 * @returns {() => void} unsubscribe - call it in the game's `destroy()`
 */
export function onViewportResize(cb, { immediate = false } = {}) {
  if (typeof window === 'undefined') return () => {};

  let frame = 0;
  let lastW = window.innerWidth;
  let lastH = window.innerHeight;
  let stopped = false;

  const run = () => {
    frame = 0;
    if (stopped) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // A resize event that did not change the box is not a re-layout. Measured once here rather
    // than trusted from the event, because `visualViewport` and `window` disagree during the
    // URL-bar animation and only the settled numbers are worth acting on.
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    try { cb(); } catch (err) { console.error('[viewport] resize handler failed', err); }
  };

  const schedule = () => {
    if (stopped || frame) return;
    frame = requestAnimationFrame(run);
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  const vv = window.visualViewport || null;
  if (vv) vv.addEventListener('resize', schedule);

  if (immediate) { try { cb(); } catch (err) { console.error('[viewport] initial fit failed', err); } }

  return () => {
    stopped = true;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    if (vv) vv.removeEventListener('resize', schedule);
  };
}

export default { onViewportResize };
