// skeeball/js/picstore.js - the machine pictures, kept on disk between page loads.
//
// WHY THIS EXISTS (2026-09-02). Matt: "can we make it so the skeeball images of the machines load
// faster? it's a black screen for a second before the machine image loads."
//
// A machine's picture is not a file - it is a WebGL scene built from that machine's own render.js
// and read back as a JPEG (ui.js's renderMachineImage), with the player's four records baked into
// the backboard. The 2026-09-01 pass made that cost survive LEAVING the game (a module-scope
// cache) and drew the next machine before the swipe, but the cache dies with the page, so the
// FIRST open of every session still paid the whole thing: a dynamic import of ~110-146 KB of
// engine, a scene build and a readback. That is the second of black box.
//
// So the picture is written to IndexedDB and read back on the next open. Three properties matter:
//
//   - IT IS NOT localStorage. Five machines of ~60 KB of JPEG data URL would be a meaningful bite
//     out of a ~5 MB origin-wide localStorage quota that `gamehub.stats` lives in, and a stats
//     write that fails for space is THE LAW's problem, not a performance one. IndexedDB has its
//     own, far larger budget. This module never touches localStorage.
//   - IT IS A CACHE, AND ONLY A CACHE. Nothing here is player data: every byte can be regenerated
//     by drawing the machine again. Every call is guarded and resolves to null on any failure, so
//     a browser with IndexedDB blocked (private windows, locked-down settings) behaves exactly as
//     the app did before this file existed.
//   - THE STORED KEY IS THE 2026-09-01 CACHE KEY: board id plus every record value the picture has
//     baked into it. An EXACT match is served as the final picture and skips the render entirely;
//     a stale one is still worth painting (it is the same machine, with older numbers on its
//     backboard) while the fresh render runs, which is the difference between a black box and a
//     picture. See ui.js's _ensureMachineImg for that decision - this file only stores and fetches.
//
// PIC_V is the invalidator. The stored picture is the output of render.js at a moment in time, so
// a session that changes how a machine is DRAWN must bump it or old pictures would be served for
// ever. Bumping it is one line and costs one re-render per machine.

export const PIC_V = 1;

const DB_NAME = 'gamehub-skeeball';
const DB_VERSION = 1;
const STORE = 'pics';

let _dbPromise = null;

/** THE READ IS ON A DEADLINE, and that is not a nicety. ui.js waits for this answer before it
 *  starts drawing the picture (an exact hit means it never has to), so a read that NEVER SETTLES -
 *  a blocked upgrade, a storage layer wedged by a private window - would leave the slide on its
 *  skeleton for ever: the cache would have become a way to lose the picture entirely. 300ms is far
 *  longer than a keyed IndexedDB get on any device here and far shorter than the render it is
 *  racing, so on a healthy phone it never fires and on a broken one it costs a fifth of a second. */
const READ_MS = 300;
const deadline = (ms) => new Promise((resolve) => { setTimeout(() => resolve(null), ms); });

/** The one open, memoized. Resolves to null (never rejects) when IndexedDB is unavailable or the
 *  open is blocked - every caller below treats null as "no cache", which is the pre-2026-09-02
 *  behaviour. */
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      } catch { /* resolved as null below if the store is missing */ }
    };
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return _dbPromise;
}

/** The stored picture for a board, or null. Shape: `{ url, key, fresh }`, where `fresh` says the
 *  stored key matches the one asked for - i.e. this IS the picture the caller would have drawn,
 *  not merely a picture of the same machine. */
export async function readPic(boardId, key) {
  const db = await Promise.race([openDb(), deadline(READ_MS)]);
  if (!db) return null;
  const read = new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(String(boardId));
      req.onsuccess = () => {
        const rec = req.result || null;
        if (!rec || rec.pv !== PIC_V || typeof rec.url !== 'string' || !rec.url) { resolve(null); return; }
        resolve({ url: rec.url, key: rec.key, fresh: rec.key === key });
      };
      req.onerror = () => resolve(null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
  return Promise.race([read, deadline(READ_MS)]);
}

/** Store a board's picture. Last write wins - one record per machine, so the store cannot grow
 *  past the number of machines however many record values pass through it. Resolves either way. */
export async function writePic(boardId, key, url) {
  if (typeof url !== 'string' || !url) return false;
  // No deadline on the WRITE's open: nothing waits for this, and a slow disk should still get to
  // save the picture for next time.
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: String(boardId), key, url, pv: PIC_V, at: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export default { readPic, writePic, PIC_V };
