// game-stats-global.js - IN-SCOPE COPY for Monopoly Deal's own nested service worker
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
// launch-out games that are not ES modules (Monopoly Deal, Parchis). It writes the SAME
// localStorage['gamehub.stats'] shape with the SAME per-game `_leg` legacy-fold guard, so it
// interoperates cleanly with the ES-module game-stats.js used by the hub, Connect Four, and
// Chinchon (whoever runs first folds a legacy store; the flag makes the other skip). Exposes
// window.__ghStats.record(gameId, difficulty, won). Fully guarded: never throws, never blocks a game.

(function () {
  'use strict';
  var STATS_KEY = 'gamehub.stats';
  var OWNER_KEY = 'gamehub.stats.owner.v1';
  var CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
  var GAMES = ['connect4', 'chinchon', 'business', 'parchis'];

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function bucket() { return { played: 0, won: 0, lost: 0 }; }

  // WHOSE stats these are. Mirrors game-stats.js's resolveStore(), minus the ownership CLAIM: this
  // is a secondary writer, so it only ever READS who the owner is and never records one. When no
  // owner has been recorded yet it uses the device-wide store, which is precisely what the ES-module
  // recorder does at the moment it claims - so the two agree either way. Keep in step with
  // game-stats.js; test-recorder-contract.mjs pins the shared surface.
  function activeCode() {
    try {
      var p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null');
      var c = (p && typeof p.playerId === 'string' ? p.playerId : '').replace(/^\s+|\s+$/g, '').toUpperCase();
      return CODE_RE.test(c) ? c : null;
    } catch (e) { return null; }
  }
  function activeStatsKey() {
    var code = activeCode();
    if (!code) return STATS_KEY;
    var o = readJSON(OWNER_KEY);
    if (!o || !o.code || o.code === code) return STATS_KEY;
    return 'gamehub.stats.p.' + code;
  }

  // The device-wide legacy stores belong to whoever owned the original store here; folding them into
  // a second player's forked store would hand them the first player's history. Latch the fold-once
  // guards instead, exactly as game-stats.js's latchLegacyGuards does.
  function latchLegacyGuards(st) {
    for (var i = 0; i < 2; i++) st.games[['chinchon', 'business'][i]]._leg = true;
  }

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
      var key = activeStatsKey();
      var st = normalize(readJSON(key));
      if (key !== STATS_KEY) latchLegacyGuards(st);
      else {
        foldLegacy(st, 'chinchon', 'chinchon-stats', function (c) { return { played: c.games | 0, won: c.wins | 0, lost: c.losses | 0 }; });
        foldLegacy(st, 'business', 'bd-stats', function (b) { return { played: b.played | 0, won: b.won | 0, lost: b.lost | 0 }; });
      }
      var g = st.games[gameId];
      var d = String(difficulty == null ? '' : difficulty).toLowerCase().replace(/^\s+|\s+$/g, '') || 'unknown';
      var b = g.byDiff[d] || (g.byDiff[d] = bucket());
      g.total.played += 1; b.played += 1;
      if (won === true) { g.total.won += 1; b.won += 1; }
      else if (won === false) { g.total.lost += 1; b.lost += 1; }
      st.updatedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(st));
    } catch (e) { /* never break the game */ }
  }

  // F1 (durability, ARCH-REVIEW.md S4-1/S5-1): drain any Monopoly Deal plays that were queued
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
      console.warn('[game-stats-global] drained ' + q.length + ' pending Monopoly Deal stat(s) that were queued while __ghStats was unavailable');
    } catch (e) { /* never break the game */ }
  }

  (typeof self !== 'undefined' ? self : this).__ghStats = { record: record };
  drainPending();
})();
