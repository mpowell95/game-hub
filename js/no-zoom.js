// no-zoom.js - no screen in this app zooms, and no text on it can be selected (Matt, 2026-10-15:
// "When I'm on a roll and clicking cells fairly quickly, sometimes it zooms in and messes me up...
// No screens should be able to zoom in or select.").
//
// A CLASSIC script (no import/export), so the same file works on the hub, on every standalone game
// page and on the launch-out pages, loaded with a plain <script src> in <head>. Three layers,
// because no single one is honoured everywhere:
//
//   1. The viewport meta on each page says `maximum-scale=1, user-scalable=no` (Android Chrome).
//   2. `touch-action: pan-x pan-y` on EVERY element, here: double-tap zoom and pinch zoom are both
//      off while scrolling still works. It is a `*` rule, the lowest specificity there is, so a
//      game's own `touch-action: none` (a swipe surface) or `manipulation` (a button) still wins;
//      the browser intersects an element's value with its ancestors', so pinch stays off on those
//      too.
//   3. iPhone Safari pinches through all of that, so its own `gesturestart` / `gesturechange`
//      events are cancelled. These are Safari's two-finger gesture events, NOT touchmove: no
//      touchmove listener goes on document (root CLAUDE.md, scroll and touch rules).
//
// Selection: off everywhere (and the iPhone's long-press callout with it), except in the places
// a person types (inputs, text areas, editable text), which must stay selectable to be editable.
(function () {
  if (typeof document === 'undefined' || document.getElementById('gh-no-zoom')) return;
  var css = [
    '*{touch-action:pan-x pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
    'input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}',
    'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
  ].join('');
  var el = document.createElement('style');
  el.id = 'gh-no-zoom';
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
  var stop = function (e) { e.preventDefault(); };
  try {
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
  } catch (e) { /* very old browser: layers 1 and 2 still apply */ }
})();
