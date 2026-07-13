/* challenge-hook.js - Business Deal side of the hidden challenge. Business Deal is
 * global-JS (no ES modules), so this inlines the tiny pieces of the shared challenge:
 * the name-hash gate, the one code (reversibly obfuscated), a progress write that is
 * byte-compatible with the hub's challenge-store, and a self-contained reveal overlay.
 * Everything is inert unless the gamehub.profile name matches the trigger hash. The
 * SALT/XORKEY/TRIGGER_HASH and the code blob mirror js/challenge/{crypt,secrets}.js. */
(function () {
  'use strict';

  var TRIGGER_HASHES = ['1cabdac0', '39b28c49']; // recipient + test1 tester (mirror js/challenge/secrets.js)
  var SALT = 'gh-v1-9c3f';
  var XORKEY = 'gh-xk-7q2z9';
  var CODE = 'IRpMFghCFwZTCRkXGkIaB0haEEYTWg=='; // obf of the Business Deal code (mirrors js/challenge/secrets.js)

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function hash(str) {
    var s = SALT + String(str == null ? '' : str), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function obf(str) {
    var s = String(str == null ? '' : str), o = '';
    for (var i = 0; i < s.length; i++) o += String.fromCharCode((s.charCodeAt(i) ^ XORKEY.charCodeAt(i % XORKEY.length)) & 0xff);
    try { return btoa(o); } catch (e) { return ''; }
  }
  function deobf(b) {
    try {
      var bin = atob(String(b == null ? '' : b)), o = '';
      for (var i = 0; i < bin.length; i++) o += String.fromCharCode(bin.charCodeAt(i) ^ XORKEY.charCodeAt(i % XORKEY.length));
      return o;
    } catch (e) { return ''; }
  }
  function profileName() {
    try { var p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null'); return p && p.name; }
    catch (e) { return null; }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // Has the Business Deal challenge already been won? (reads the shared record).
  function isDone() {
    try {
      var raw = localStorage.getItem('gamehub.challenge');
      var st = raw ? JSON.parse(deobf(raw)) : null;
      return !!(st && st.wins && st.wins.business);
    } catch (e) { return false; }
  }

  // Read-modify-write the shared record so we never clobber Ana's other progress.
  function recordWin() {
    try {
      var raw = localStorage.getItem('gamehub.challenge');
      var st = raw ? JSON.parse(deobf(raw)) : null;
      if (!st || typeof st !== 'object') st = {};
      if (!st.wins || typeof st.wins !== 'object') st.wins = {};
      st.wins.business = true;
      st.v = 1;
      st.updatedAt = new Date().toISOString();
      localStorage.setItem('gamehub.challenge', obf(JSON.stringify(st)));
    } catch (e) { /* never break the game */ }
  }

  function showReveal(code, label) {
    var prev = document.getElementById('bd-ch-reveal'); if (prev) prev.remove();
    var el = document.createElement('div');
    el.id = 'bd-ch-reveal';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Secret code earned');
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
    el.innerHTML =
      '<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,rgba(30,26,5,.86),rgba(6,8,12,.96));"></div>' +
      '<div style="position:relative;max-width:420px;margin:0 18px;text-align:center;background:#12151c;border:1px solid #f2b705;border-radius:20px;padding:28px 22px;box-shadow:0 24px 70px rgba(0,0,0,.6);">' +
      '<p style="margin:8px 0 0;text-transform:uppercase;letter-spacing:.14em;font-size:.78rem;font-weight:800;color:#9aa7bd;">Your code</p>' +
      '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:1.05rem;letter-spacing:.04em;color:#2a2200;background:#f2b705;border-radius:12px;padding:13px 12px;margin:6px 0 14px;white-space:nowrap;overflow-x:auto;">' + esc(code) + '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
      '<button id="bd-ch-copy" style="flex:1;font:inherit;font-weight:800;border:0;border-radius:11px;padding:14px 16px;cursor:pointer;background:#f2b705;color:#2a2200;">Copy</button>' +
      '<button id="bd-ch-close" style="flex:1;font:inherit;font-weight:700;border:1px solid #2c3340;border-radius:11px;padding:14px 16px;cursor:pointer;background:transparent;color:#eef2f8;">Close</button>' +
      '</div><p id="bd-ch-msg" style="margin:10px 0 0;min-height:1.1em;font-size:.85rem;font-weight:700;color:#9aa7bd;"></p></div>';
    document.body.appendChild(el);
    el.querySelector('#bd-ch-close').addEventListener('click', function () { el.remove(); });
    el.querySelector('#bd-ch-copy').addEventListener('click', function () {
      var msg = el.querySelector('#bd-ch-msg');
      try {
        navigator.clipboard.writeText(code).then(
          function () { msg.textContent = 'Copied.'; },
          function () { msg.textContent = code; });
      } catch (e) { msg.textContent = code; }
    });
  }

  function isActive() { return TRIGGER_HASHES.indexOf(hash(norm(profileName()))) >= 0; }
  window.__bdChallenge = {
    active: isActive,
    done: function () { return isDone(); },
    live: function () { return isActive() && !isDone(); },
    recordWinAndReveal: function () { recordWin(); showReveal(deobf(CODE), 'Business Deal'); }
  };
})();
