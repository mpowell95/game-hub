// THE SERVER-BUILT LEADERBOARD (2026-10-22, Matt: "why are we making every individual phone do all
// that work when we could have firebase do it?").
//
// Every phone used to download all of players/ (~930 KB, one record per DEVICE, most of it blank
// games nobody played) and group it into people itself (js/players-agg.js aggregatePlayers). This
// does that grouping ONCE, on the server, with the phone's own code (shared/js/, copied byte for
// byte by tools/sync-functions-shared.mjs), and publishes the result:
//
// ONE COMPRESSED PACKAGE: boards/v1/lb/z = base64(gzip(JSON of { people, defaults })), about 60 KB
// for what was ~930 KB of players/ (measured on the 2026-10-22 snapshot). Inside it:
//
//   people/<enc key> = JSON string of ONE person's group, exactly what
//                                   aggregatePlayers(visible devices, corrections) returns for them,
//                                   minus every game entry equal to that game's DEFAULT below, plus
//                                   `_ids` (that person's device ids, so a phone can find its row).
//   defaults/<game>  = JSON string of that game's most common entry (a game the person
//                                   never played: zeros). Most of players/ is exactly these, so
//                                   they are sent once instead of once per person per game.
//
// Each person is a JSON STRING, not a tree, on purpose: Firebase drops empty objects and turns
// arrays into maps, so a tree would not come back identical (and gzip needs a string anyway). The phone parses it, puts the empty games back
// (js/stats-net.js fillBoardGroup) and gets a group deep-equal to computing it itself
// (tools/test-boards.mjs checks that against real data). players/ is only READ here.
import './shared-env.js';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { aggregatePlayers, buildIdentity } from './shared/js/players-agg.js';
import { resolveCorrections } from './shared/js/admin-config.js';
import { isHiddenDeviceId } from './shared/js/hidden-players.js';
import { activeVoids } from './shared/js/integrity.js';

export const EMPTY_GAME = JSON.stringify({ total: { played: 0, won: 0, lost: 0 }, byDiff: {} });

/** A group key ("code:QZCC4", "name:matt", "device:<id>") as a legal Firebase key. */
export function encKey(key) { return encodeURIComponent(String(key)).replace(/\./g, '%2E'); }

/** The leaderboard's view of players/: the same devices it showed (hidden test devices left out,
 *  as js/leaderboard-ui.js visibleRecords did), grouped and corrected exactly as the phone did. */
export function buildBoard(players, adminConfig, integrityFlags) {
  return buildBoardParts(players, adminConfig, integrityFlags).people;
}
/** `integrityFlags`: the integrityFlags/ node (functions/integrity.js); its strong flags, minus Matt's
 *  undo, void those games on those records (js/stats-corrections.js voidIntegrityGame). */
export function buildBoardParts(players, adminConfig, integrityFlags) {
  const visible = {};
  for (const id of Object.keys(players || {})) if (!isHiddenDeviceId(id)) visible[id] = players[id];
  const corrections = resolveCorrections(adminConfig || null);
  corrections.integrity = activeVoids(integrityFlags || {}, adminConfig || {});
  const groups = aggregatePlayers(visible, corrections);
  const ident = buildIdentity(visible);
  const ids = new Map();
  for (const id of Object.keys(visible)) {
    const k = ident.keyFor((visible[id] || {}).profile || {}, id);
    if (!ids.has(k)) ids.set(k, []);
    ids.get(k).push(id);
  }
  // Each game's most common entry across everyone: the never-played zeros.
  const counts = new Map();
  for (const g of groups) for (const [id, v] of Object.entries(g.games || {})) {
    const s = JSON.stringify(v), m = counts.get(id) || new Map();
    m.set(s, (m.get(s) || 0) + 1);
    counts.set(id, m);
  }
  const defaults = {};
  for (const [id, m] of counts) defaults[id] = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  // The most common ORDER of game ids, sent once (defaults._order); a person whose games are in
  // another order carries their own (`_g`), so the phone rebuilds the very same object.
  const orders = new Map();
  for (const g of groups) { const o = JSON.stringify(Object.keys(g.games || {})); orders.set(o, (orders.get(o) || 0) + 1); }
  const order = [...orders.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (order) defaults._order = order[0];
  const people = {};
  for (const g of groups) {
    const games = {}, ids0 = Object.keys(g.games || {});
    for (const id of ids0) { const s = JSON.stringify(g.games[id]); if (s !== defaults[id]) games[id] = g.games[id]; }
    const own = JSON.stringify(ids0) === defaults._order ? {} : { _g: ids0 };
    people[encKey(g.key)] = JSON.stringify({ ...g, games, ...own, _ids: ids.get(g.key) || [] });
  }
  return { people, defaults };
}

/** The package the phones read: { people, defaults } gzipped and base64'd (js/stats-net.js
 *  watchBoard undoes it). */
export function packBoard(parts) { return gzipSync(JSON.stringify(parts), { level: 9 }).toString('base64'); }

export const sumOf = (s) => createHash('sha1').update(s).digest('base64').slice(0, 16);
