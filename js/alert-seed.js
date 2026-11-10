// js/alert-seed.js - a fresh storage never reads an old match as news (2026-11-09).
//
// Matt re-added the Home Screen app and every challenge game's launcher bubble treated the matches
// already on the server as brand new ("X challenged you"), because each game's seen-map (a local
// key) started empty. Called by each game's alert.js with the rows it just read: when that game's
// seen key has NEVER existed on this storage, every visible match is stamped seen at its own
// `updated`; a match on your turn one ms under it, so it still shows as "your turn", never as a new
// challenge. A one-tap convenience (THE LAW rule 2's exemption): nothing here touches a result.
export function seedSeenOnce(key, rows, markSeen) {
  try {
    if (!Array.isArray(rows) || !rows.length || localStorage.getItem(key) !== null) return;
    for (const r of rows) {
      if (!r || !r.id) continue;
      const u = Number(r.updated) || 0;
      markSeen(r.id, Math.max(1, u - (r.yourTurn && !r.over ? 1 : 0)));
    }
  } catch (err) { console.warn('[alert-seed] could not seed the seen map', err); }
}
