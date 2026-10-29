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

  // THE RATE GATE (2026-10-29): the same 30 results per game per minute as game-stats.js's
  // tooFast(), on the same `gamehub.rate.v1` record, refused BEFORE the store is read, each refusal
  // counted in `blocked` (it rides the stats mirror as `rate`). Keep in step with tooFast().
  var RATE_KEY = 'gamehub.rate.v1';
  var RATE_WINDOW_MS = 60000;
  var RATE_MAX = 30;
  function tooFast(gameId, now) {
    var rec = readJSON(RATE_KEY);
    if (!rec || typeof rec !== 'object') rec = { seen: {}, blocked: {} };
    if (!rec.seen || typeof rec.seen !== 'object') rec.seen = {};
    if (!rec.blocked || typeof rec.blocked !== 'object') rec.blocked = {};
    var stamps = Array.isArray(rec.seen[gameId]) ? rec.seen[gameId] : [];
    var recent = [];
    for (var i = 0; i < stamps.length; i++) if (isFinite(stamps[i]) && now - stamps[i] < RATE_WINDOW_MS) recent.push(stamps[i]);
    if (recent.length >= RATE_MAX) {
      var b = rec.blocked[gameId] || { n: 0, firstAt: now };
      b.n = (b.n | 0) + 1; b.lastAt = now; b.firstAt = b.firstAt || now;
      rec.blocked[gameId] = b;
      rec.seen[gameId] = recent;
      try { localStorage.setItem(RATE_KEY, JSON.stringify(rec)); } catch (e) { /* nothing to do */ }
      console.warn('[game-stats-global] "' + gameId + '" result REFUSED: ' + RATE_MAX + '+ results in ' + (RATE_WINDOW_MS / 1000) + 's is faster than anyone can play. Nothing was recorded.');
      return true;
    }
    recent.push(now);
    rec.seen[gameId] = recent;
    try { localStorage.setItem(RATE_KEY, JSON.stringify(rec)); } catch (e) { /* a full disk must not block a real play */ }
    return false;
  }

  // THE PLAY LOG (2026-10-29): every accepted result, queued exactly as js/play-log-queue.js's
  // appendPlayLog does (`gamehub.playlog.v1`, newest 3,000 kept), for js/play-log.js to send from the
  // next hub page. Evidence only, never read back. Keep in step with appendPlayLog().
  var PLAYLOG_KEY = 'gamehub.playlog.v1';
  var PLAYLOG_MAX = 3000;
  var playSeq = 0;
  function notePlay(gameId, fn, args) {
    try {
      var code = activeCode();
      if (!code) return;
      var q = readJSON(PLAYLOG_KEY);
      if (!Array.isArray(q)) q = [];
      var t = Date.now();
      var a = [];
      for (var i = 0; i < args.length; i++) a.push(args[i] === undefined ? null : args[i]);
      q.push({ c: code, id: t + '-' + (playSeq++ % 10000), t: t, g: String(gameId).slice(0, 24), f: String(fn).slice(0, 40), a: JSON.stringify(a).slice(0, 1600) });
      localStorage.setItem(PLAYLOG_KEY, JSON.stringify(q.slice(-PLAYLOG_MAX)));
    } catch (e) { console.error('[game-stats-global] play not logged', e); }
  }

  function record(gameId, difficulty, won, drained) {
    try {
      if (GAMES.indexOf(gameId) < 0) return;
      // A queued backlog (drainPending) is not a burst of play: it skips the gate, like
      // game-stats.js's drainPendingResults, and is logged as 'record(queued)'.
      if (!drained && tooFast(gameId, Date.now())) return;
      notePlay(gameId, drained ? 'record(queued)' : 'record', [gameId, difficulty, won]);
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
      noteActivity(key, gameId, Date.now());
    } catch (e) { /* never break the game */ }
  }

  // WHEN this game was played: the same `gamehub.activity.v1` stamp as game-stats.js's
  // stampActivity()/activityWeek() (2026-10-11). Keep in step with it.
  function noteActivity(key, gameId, now) {
    try {
      var all = readJSON('gamehub.activity.v1');
      if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
      var a = all[key] && typeof all[key] === 'object' ? all[key] : (all[key] = {});
      var g = a[gameId] && typeof a[gameId] === 'object' ? a[gameId] : (a[gameId] = {});
      if (!g.w || typeof g.w !== 'object' || Array.isArray(g.w)) g.w = {};
      var d = new Date(now);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      var wk = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      g.w[wk] = (g.w[wk] | 0) + 1;
      if (!(+g.first > 0) || now < +g.first) g.first = now;
      if (!(+g.last > 0) || now > +g.last) g.last = now;
      localStorage.setItem('gamehub.activity.v1', JSON.stringify(all));
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
        if (e) record(e.game, e.diff, e.won, true);
      }
      localStorage.removeItem(PENDING_STATS_KEY);
      console.warn('[game-stats-global] drained ' + q.length + ' pending Monopoly Deal stat(s) that were queued while __ghStats was unavailable');
    } catch (e) { /* never break the game */ }
  }

  // QUITTING A GAME AGAINST THE COMPUTER (2026-10-29): a game with no resume (Monopoly Deal) ARMS its
  // loss once the player has moved, in the same `gamehub.quitLoss.v1` marker game-stats.js uses
  // (armQuitLoss): { f: 'recordResult', a: [gameId, difficulty, false], c, k, t }. The real result
  // DROPS it; a quit TAKES it (records the loss once); a page that died mid-game leaves it for the
  // next load of the game, or the hub after 30 minutes (js/game-stats.js settleQuitLosses).
  var QUIT_KEY = 'gamehub.quitLoss.v1';
  function readQuit() { var q = readJSON(QUIT_KEY); return q && typeof q === 'object' && !Array.isArray(q) ? q : {}; }
  function writeQuit(q) { try { localStorage.setItem(QUIT_KEY, JSON.stringify(q)); } catch (e) { console.error('[game-stats-global] quit-loss marker not saved', e); } }
  // KEPT FRESH WHILE PLAYED (2026-10-29, second pass): the hub settles a marker 30+ minutes old, so a
  // long game open in another window could be settled as a loss and later record its real result
  // too. A marker this page armed is refreshed every minute (and by `touchQuit` on every turn), and
  // `quitLost` tells the game when its marker was taken anyway (a page frozen that long), so it
  // records nothing more: that game already counted.
  var armedHere = {};
  var tick = null;
  function quitTick() {
    var ids = Object.keys(armedHere);
    if (!ids.length) { if (tick) { clearInterval(tick); tick = null; } return; }
    var q = readQuit(), changed = false;
    for (var i = 0; i < ids.length; i++) if (q[ids[i]]) { q[ids[i]].t = Date.now(); changed = true; }
    if (changed) writeQuit(q);
  }
  function keepFresh(gameId) {
    armedHere[gameId] = true;
    if (!tick && typeof setInterval === 'function') {
      tick = setInterval(quitTick, 60 * 1000);
      if (tick && typeof tick.unref === 'function') tick.unref();
    }
  }
  function armQuit(gameId, difficulty) {
    if (GAMES.indexOf(gameId) < 0) return;
    var q = readQuit();
    q[gameId] = { f: 'recordResult', a: [gameId, difficulty, false], c: activeCode(), k: activeStatsKey(), t: Date.now() };
    writeQuit(q);
    keepFresh(gameId);
  }
  /** The game is still being played: refresh its marker's time. */
  function touchQuit(gameId) {
    var q = readQuit();
    if (!q[gameId]) return false;
    q[gameId].t = Date.now();
    writeQuit(q);
    keepFresh(gameId);
    return true;
  }
  /** This page armed `gameId`'s loss and someone else has since recorded it. */
  function quitLost(gameId) { return !!armedHere[gameId] && !readQuit()[gameId]; }
  function dropQuit(gameId) {
    delete armedHere[gameId];
    var q = readQuit();
    if (!q[gameId]) return;
    delete q[gameId];
    writeQuit(q);
  }
  function quitArmed(gameId) { return !!readQuit()[gameId]; }
  /** Record the armed loss once. True when it was recorded (the marker is dropped first). */
  function takeQuit(gameId) {
    var q = readQuit();
    var m = q[gameId];
    if (!m || (m.k && m.k !== activeStatsKey())) return false;
    delete armedHere[gameId];
    delete q[gameId];
    writeQuit(q);
    notePlay(gameId, 'quitLoss', ['recordResult', m.t]);
    var a = Array.isArray(m.a) ? m.a : [];
    record(gameId, a[1], false);
    return true;
  }

  (typeof self !== 'undefined' ? self : this).__ghStats = { record: record, armQuit: armQuit, dropQuit: dropQuit, quitArmed: quitArmed, takeQuit: takeQuit, touchQuit: touchQuit, quitLost: quitLost };
  drainPending();
})();
