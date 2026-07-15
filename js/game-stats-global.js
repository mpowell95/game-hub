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

  (typeof self !== 'undefined' ? self : this).__ghStats = { record: record };
})();
