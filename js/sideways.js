// js/sideways.js - phones are portrait only (2026-11-12, Matt: "no game in the entire game hub needs landscape mode...
// Let's just turn it off"). A classic script, loaded right after no-zoom.js on the hub and the profile page.
//
// It reads how the PHONE is held (screen.orientation, else window.orientation), never the page's shape: an on-screen
// keyboard or Android split screen makes an upright phone's page short and wide, and a CSS orientation query then
// covered the name gate while the player typed (2026-11-12 review). A PHONE = a touch screen whose short side is under
// 500 px (tablets and desktops never qualify). When it is sideways, <html> gets `gh-sideways` (css/hub.css shows the
// "Turn your phone upright" cover) and `gamehub:sideways` fires with detail true/false (js/hub.js pauses the game).
// It also stamps the Spanish `lang` early, so the cover is in the right language before js/i18n.js loads.
(function () {
  var root = document.documentElement;
  try { if (localStorage.getItem('gamehub.lang.v1') === 'es') root.lang = 'es'; } catch (e) { /* storage off */ }
  function isPhone() {
    var s = window.screen || {};
    var short = Math.min(s.width || 0, s.height || 0);
    var coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* old browser */ }
    return coarse && short > 0 && short < 500;
  }
  function isSideways() {
    try {
      var o = window.screen && window.screen.orientation && window.screen.orientation.type;
      if (typeof o === 'string' && o) return o.indexOf('landscape') === 0;
    } catch (e) { /* not supported */ }
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    return false;   // unknown: never cover
  }
  var last = null;
  function update() {
    var on = isPhone() && isSideways();
    if (on === last) return;
    last = on;
    if (on) root.classList.add('gh-sideways'); else root.classList.remove('gh-sideways');
    try { window.dispatchEvent(new CustomEvent('gamehub:sideways', { detail: on })); } catch (e) { /* old browser */ }
  }
  update();
  try { if (window.screen.orientation && window.screen.orientation.addEventListener) window.screen.orientation.addEventListener('change', update); } catch (e) { /* not supported */ }
  window.addEventListener('orientationchange', update);
  window.gamehubSideways = function () { return last === true; };
})();
