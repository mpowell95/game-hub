// js/live-read.js - one download per Firebase path, not one per caller (2026-10-22).
//
// Matt asked for the hub's downloads to be audited. On every open each challenge game's own list
// (`<node>/index/<CODE>`, up to 16 KB for one person in Hoops) came down TWICE: the launcher's
// "your turn" check read it once (get), then its live watch read it again (onValue), and every
// return to the launcher read it a third time while the watch was already holding it.
//
// watchPath() keeps the latest value of a watched path here; readPath() answers from it when a
// watch holds the path, waits for a watch that is still attaching, and only otherwise goes to the
// network. Values are handed out as they arrived (JSON trees from Firebase); callers already treat
// them as read-only. Writes never pass through here.

const live = new Map();   // path -> { value, has, subs, waiters: [] }

function slot(path) {
  let s = live.get(path);
  if (!s) { s = { value: null, has: false, subs: 0, waiters: [] }; live.set(path, s); }
  return s;
}

/** onValue on `path`, remembering each value for readPath. `boot` = getStatsApp()'s { db, api }.
 *  Returns an unsubscribe that is always safe to call. */
export function watchPath(boot, path, cb) {
  const s = slot(path);
  s.subs += 1;
  let stopped = false;
  const stop = boot.api.onValue(boot.api.ref(boot.db, path), (snap) => {
    const v = snap && snap.exists() ? snap.val() : null;
    s.value = v; s.has = true;
    for (const w of s.waiters.splice(0)) w(v);
    try { cb(v); } catch (err) { console.warn('[live-read] watch callback', path, err); }
  }, () => {});
  return () => {
    if (stopped) return;
    stopped = true;
    try { stop(); } catch { /* detached */ }
    s.subs -= 1;
    if (s.subs <= 0) { s.subs = 0; s.has = false; s.value = null; }
  };
}

/** The value at `path`: from a live watch when one holds it (no download), else one get. */
export async function readPath(boot, path, { waitMs = 8000 } = {}) {
  const s = live.get(path);
  if (s && s.subs > 0) {
    if (s.has) return s.value;
    const v = await Promise.race([
      new Promise((res) => s.waiters.push((x) => res({ x }))),
      new Promise((res) => setTimeout(() => res(null), waitMs)),
    ]);
    if (v) return v.x;
  }
  const snap = await boot.api.get(boot.api.ref(boot.db, path));
  return snap && snap.exists() ? snap.val() : null;
}

export default { watchPath, readPath };
