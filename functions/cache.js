// SERVER READ CACHE (2026-11-09, Matt's Google bill: the database's "Outgoing Bandwidth" was the whole
// charge, 4.36 GB in 9 days; the free allowance is ~360 MB a day). Every leaderboard rebuild downloaded
// all of players/ (722 KB on 2026-11-09), up to every 2 minutes. Now the instance keeps players/ in
// memory and asks only for the records whose `updatedAt` moved (every sync stamps it, js/stats-net.js;
// the sync is the only writer of players/<id>). A full read still happens on a cold instance and every
// FULL_MS, which also drops a record deleted on the server (tools/delete-device-record.mjs).
//
// THE LAW: read only. Each caller gets its own deep copy, so nothing a rebuild does to its copy (Contexto's
// fewestNH, buildBoardParts) can leak into the next one.
//
// Needs `.indexOn: ["updatedAt"]` on players in database.rules.json; without it the SDK downloads the
// whole node and filters locally (the old cost, never wrong data).
export const FULL_MS = 3 * 60 * 60 * 1000;
export const SLACK_MS = 10 * 60 * 1000;   // re-ask a little behind the newest stamp seen (clock + in-flight writes)

const caches = new WeakMap();   // db -> { data, max, fullAt }; one per database handle (tests use many)

const stampOf = (rec) => (rec && typeof rec === 'object' ? Number(rec.updatedAt) || 0 : 0);

/** players/ as of now, downloading only what changed since the last call on this instance. */
export async function readPlayers(db, now = Date.now()) {
  let c = caches.get(db);
  if (!c || !c.data || now - c.fullAt > FULL_MS) {
    const all = (await db.ref('players').get()).val() || {};
    let max = 0;
    for (const rec of Object.values(all)) max = Math.max(max, stampOf(rec));
    c = { data: all, max, fullAt: now };
    caches.set(db, c);
  } else {
    const snap = await db.ref('players').orderByChild('updatedAt').startAt(c.max - SLACK_MS).get();
    const got = snap.val() || {};
    for (const [id, rec] of Object.entries(got)) {
      c.data[id] = rec;
      c.max = Math.max(c.max, stampOf(rec));
    }
  }
  return structuredClone(c.data);
}

const nodeCaches = new WeakMap();   // db -> Map(path -> { at, val })

/** A small node re-read at most every `maxAgeMs` (ctHistory, 41 KB on 2026-11-09 and growing: it only
 *  lowers Contexto's fewest guesses before a phone's own sync carries it, so 30 minutes late is harmless). */
export async function readNodeCached(db, path, maxAgeMs, now = Date.now()) {
  let m = nodeCaches.get(db);
  if (!m) { m = new Map(); nodeCaches.set(db, m); }
  const c = m.get(path);
  if (!c || now - c.at > maxAgeMs) {
    const val = (await db.ref(path).get()).val();
    m.set(path, { at: now, val });
    return structuredClone(val);
  }
  return structuredClone(c.val);
}

/** Tests only. */
export function _cacheState(db) { return caches.get(db) || null; }
