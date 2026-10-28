// tabbar-fix.js - keeps the Compact layout's bottom tab bar on the bottom of the screen (2026-10-24).
//
// Matt, 2026-10-24 (screenshot): the bar sat halfway up the launcher with tiles showing below it,
// "Sometimes this happens still to the bottom menu. Fix permanently". It is the iOS 26 WebKit bug in
// CLAUDE-HISTORY.md, "Compact layout: the tab bar halfway up the screen" (WebKit bug 297779): fixed
// elements get placed against a viewport that is shorter than the screen. Locking the page to the
// screen height was tried (v1208) and hit a second iOS 26 bug, so the layout is NOT changed here.
// Instead this watches the bar and repairs it when it is somewhere it cannot legitimately be:
//   1. measure where the bar's bottom edge really is against the true bottom of the screen;
//   2. off by more than SLACK: re-lay the bar out (position toggled, which makes WebKit recompute
//      its fixed placement) and measure again on the next frame;
//   3. still off: push it down by exactly the gap (`translateY`), cleared again the moment the
//      measurement comes back right.
// On a browser without the bug the gap is 0 and nothing is ever touched. Never on a mounted game.

const SLACK = 24;   // px; a URL-bar animation mid-flight can leave a few px for one frame

/** The bottom of the screen the page really owns. An installed iPhone app (standalone, status bar
 *  black-translucent, viewport-fit=cover) always fills the whole screen, so when the bug shrinks
 *  innerHeight too, `screen` is still the truth; in a browser tab innerHeight is the only measure.
 *  Also what a game should size itself to: never `visualViewport.height`, which the same bug leaves
 *  at about half the screen (Battleship, 2026-10-28). */
export function trueBottom() {
  const ih = window.innerHeight;
  const standalone = navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (!standalone || !window.screen) return ih;
  const landscape = window.innerWidth > ih;
  const s = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  // Only trust screen when it is plausibly this window (iPad split view and desktop windows are not).
  if (Math.abs(window.innerWidth - (landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height))) > 2) return ih;
  return Math.max(ih, s);
}

/** Start watching. Returns a stop function. */
export function watchTabBar() {
  if (typeof window === 'undefined') return () => {};
  let frame = 0, shift = 0, retried = false, stopped = false, noted = false;

  const bar = () => (document.documentElement.classList.contains('gh-compact')
    && !document.documentElement.classList.contains('gh-ingame'))
    ? document.querySelector('.hub-tabs') : null;

  const setShift = (el, px) => {
    shift = px;
    el.style.transform = px ? `translateY(${px}px)` : '';
  };

  const check = () => {
    frame = 0;
    if (stopped) return;
    const el = bar();
    if (!el) { shift = 0; retried = false; return; }
    // A re-rendered launcher draws a fresh bar with no transform; follow what is on the element.
    if (!el.style.transform) shift = 0;
    const bottom = el.getBoundingClientRect().bottom - shift;   // where it sits with no repair
    const gap = Math.round(trueBottom() - bottom);
    if (gap <= SLACK) {                     // where it belongs (or a harmless sliver): no repair
      if (shift) setShift(el, 0);
      retried = false;
      return;
    }
    if (!retried) {                         // step 2: ask WebKit to place it again
      retried = true;
      el.style.position = 'absolute';
      void el.offsetHeight;
      el.style.position = '';
      schedule();
      return;
    }
    if (shift !== gap) setShift(el, gap);   // step 3: put it there ourselves
    if (!noted) {
      noted = true;
      console.warn(`[tabbar-fix] tab bar was ${gap}px above the bottom; moved down`);
    }
  };

  function schedule() {
    if (stopped || frame) return;
    frame = requestAnimationFrame(check);
  }

  const vv = window.visualViewport || null;
  const opts = { passive: true };
  window.addEventListener('scroll', schedule, opts);
  window.addEventListener('resize', schedule, opts);
  window.addEventListener('orientationchange', schedule, opts);
  window.addEventListener('pageshow', schedule, opts);
  document.addEventListener('visibilitychange', schedule, opts);
  document.addEventListener('focusout', schedule, opts);
  if (vv) { vv.addEventListener('resize', schedule, opts); vv.addEventListener('scroll', schedule, opts); }
  // The bug can set in with no event at all (the keyboard closing elsewhere); a slow heartbeat
  // catches that. One rect read every 2 s costs nothing.
  const beat = setInterval(schedule, 2000);
  schedule();

  return () => {
    stopped = true;
    clearInterval(beat);
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule, opts);
    window.removeEventListener('resize', schedule, opts);
    window.removeEventListener('orientationchange', schedule, opts);
    window.removeEventListener('pageshow', schedule, opts);
    document.removeEventListener('visibilitychange', schedule, opts);
    document.removeEventListener('focusout', schedule, opts);
    if (vv) { vv.removeEventListener('resize', schedule, opts); vv.removeEventListener('scroll', schedule, opts); }
  };
}

export default { watchTabBar };
