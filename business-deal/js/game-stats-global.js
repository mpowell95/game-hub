// game-stats-global.js - IN-SCOPE COPY for Business Deal's own nested service worker
// (business-deal/sw.js). MUST stay byte-identical to the canonical ../js/game-stats-global.js.
//
// Why a copy instead of the original path: BD's page is controlled exclusively by its own nested
// SW (the more specific of the two scopes), so ALL of its fetches - including this script's, at
// `../js/game-stats-global.js` - are served through BD's OWN cache/fetch handler, not the root
// hub's. The original file lived outside BD's own ASSETS list, so a device that only ever
// installed /business-deal/ and later went offline would 404 this script, leaving
// window.__ghStats undefined for the rest of that session (ARCH-REVIEW.md S4-1). Copying it into
// BD's own directory and adding it to business-deal/sw.js's ASSETS makes it precache-able within
// BD's own scope - the "in-scope copy" fix from S5-1, without restructuring the double-SW setup.
//
// ---- everything below is the canonical file, verbatim ----
//
// game-stats-global.js - a CLASSIC (non-module) port of game-stats.js's recorder, for the
// launch-out games that are not ES modules (Business Deal, Parchis). It writes the SAME
// localStorage['gamehub.stats'] shape with the SAME per-game `_leg` legacy-fold guard, so it
// interoperates cleanly with the ES-module game-stats.js used by the hub, Connect Four, and
// Chinchon (whoever runs first folds a legacy store; the flag makes the other skip). Exposes
// window.__ghStats.record(gameId, difficulty, won). Fully guarded: never throws, never blocks a game.

(function () {
  'use strict';
  var STATS_KEY = 'gamehub.stats';
  var GAMES = ['connect4', 'chinchon', 'business', 'parchis'];

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function bucket() { return { played: 0, won: 0, lost: 0 }; }

  function normalize(raw) {
    var st = (raw && typeof raw === 'object') ? raw : {};
    st.version = st.version || 1;
    if (!st.games || typeof st.games !== 'object') st.games = {};
    for (var i = 0; i < GAMES.length; i++) {
      var g = st.games[GAMES[i]] || (st.games[GAMES[i]] = {});
      if (!g.total) g.total = bucket();
      if (!g.byDiff || typeof g.byDiff !== 'object') g.byDiff = {};
    }
    return st;
  }

  function foldLegacy(st, gameId, legacyKey, map) {
    var g = st.games[gameId];
    if (g._leg) return;
    var L = readJSON(legacyKey);
    if (L) {
      var t = map(L);
      if ((t.played | 0) > 0) {
        g.total.played += t.played | 0; g.total.won += t.won | 0; g.total.lost += t.lost | 0;
        g.byDiff.legacy = { played: t.played | 0, won: t.won | 0, lost: t.lost | 0 };
      }
    }
    g._leg = true;
  }

  function record(gameId, difficulty, won) {
    try {
      if (GAMES.indexOf(gameId) < 0) return;
      var st = normalize(readJSON(STATS_KEY));
      foldLegacy(st, 'chinchon', 'chinchon-stats', function (c) { return { played: c.games | 0, won: c.wins | 0, lost: c.losses | 0 }; });
      foldLegacy(st, 'business', 'bd-stats', function (b) { return { played: b.played | 0, won: b.won | 0, lost: b.lost | 0 }; });
      var g = st.games[gameId];
      var d = String(difficulty == null ? '' : difficulty).toLowerCase().replace(/^\s+|\s+$/g, '') || 'unknown';
      var b = g.byDiff[d] || (g.byDiff[d] = bucket());
      g.total.played += 1; b.played += 1;
      if (won === true) { g.total.won += 1; b.won += 1; }
      else if (won === false) { g.total.lost += 1; b.lost += 1; }
      st.updatedAt = new Date().toISOString();
      localStorage.setItem(STATS_KEY, JSON.stringify(st));
    } catch (e) { /* never break the game */ }
  }

  // F1 (durability, ARCH-REVIEW.md S4-1/S5-1): drain any Business Deal plays that were queued
  // (business-deal/js/ui.js's _recordResult) because __ghStats wasn't available at game-end. This
  // runs once, right here, the moment this script itself loads successfully - i.e. exactly the
  // "next BD load where __ghStats works" case. Through the SAME `record()` above, so it's the
  // proper recorder, not a bespoke write path.
  var PENDING_STATS_KEY = 'gamehub.bd.pendingStats.v1';
  function drainPending() {
    try {
      var q = readJSON(PENDING_STATS_KEY);
      if (!Array.isArray(q) || !q.length) return;
      for (var i = 0; i < q.length; i++) {
        var e = q[i];
        if (e) record(e.game, e.diff, e.won);
      }
      localStorage.removeItem(PENDING_STATS_KEY);
      console.warn('[game-stats-global] drained ' + q.length + ' pending Business Deal stat(s) that were queued while __ghStats was unavailable');
    } catch (e) { /* never break the game */ }
  }

  (typeof self !== 'undefined' ? self : this).__ghStats = { record: record };
  drainPending();
})();
