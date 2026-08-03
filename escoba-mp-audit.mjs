// escoba-mp-audit.mjs - READ-ONLY audit that produces the exact multiplayer Escoba match count
// per device, for the window `h2h` cannot see.
//
// WHY THIS EXISTS. Escoba filed every online match under the AI's `normal` difficulty until
// 2026-08-03 (mechanism: escoba/CLAUDE.md). `js/game-stats.js`'s reclassifyEscobaMp moves those
// plays into an `mp` bucket, but a device can only PROVE a match was multiplayer from its own
// `h2h.escoba` rows - and h2h capture began 2026-07-22 (`37275f8`) while Escoba multiplayer
// shipped 2026-07-19 (`c5955a9`). Matches played in that three-day window, plus any committed via
// the restore/rejoin path with no `mp.opp`, leave no h2h trace. h2h is a floor, not the count.
//
// The `rooms/` node is the only surviving record of those matches. This reads it, pairs each
// finished Escoba room with the two device ids that played it, and prints the exact per-device
// total. Paste the emitted block into `ESCOBA_MP_KNOWN` in `js/game-stats.js`: every device tops
// up to it on its next load, including devices that already ran with the lower h2h-only figure
// (reclassifyEscobaMp moves the shortfall, it does not latch).
//
// Read-only, no dependency, same REST pattern as backups/rtdb-backup.mjs and
// read-device-reports.mjs. Run it where outbound access to the RTDB host is permitted:
//   node escoba-mp-audit.mjs            # print the audit + the paste-ready block
//   node escoba-mp-audit.mjs --json     # machine-readable
//
// It writes NOTHING, to Firebase or to disk. Run backups/rtdb-backup.mjs first anyway, per the
// standing rule that nothing touches the database without a restorable snapshot existing first.

import { firebaseConfig } from './js/firebase-config.js';
import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';

const asJson = process.argv.includes('--json');

/** A room counts as a played match only if it actually got underway - a lobby nobody joined, or
 *  one abandoned before a single move, was never a game and must not inflate anyone's count. */
function isPlayedMatch(room) {
  if (!room || typeof room !== 'object') return false;
  const moves = room.moves && typeof room.moves === 'object' ? Object.keys(room.moves).length : 0;
  return moves > 0 || !!room.result;
}

function deviceIdsOf(room) {
  const out = [];
  const add = (p) => {
    const id = p && p.deviceId;
    if (typeof id === 'string' && id.trim() && !out.includes(id.trim())) out.push(id.trim());
  };
  // 2-seat rooms carry host/guest (js/net.js createRoom/joinRoom); the N-player extension
  // (Chinchon at 3-4 seats) uses a `seats` array instead. Escoba is 2-seat today, but a room
  // written by a future N-seat build must not silently count as zero players.
  add(room.host); add(room.guest);
  if (Array.isArray(room.seats)) for (const s of room.seats) add(s);
  return out;
}

/** Did `deviceId` win this room's match? Returns true/false, or null when unknowable. */
function wonBy(room, deviceId) {
  const r = room.result;
  if (!r || typeof r !== 'object') return null;
  const winner = r.winnerId != null ? String(r.winnerId) : null;
  if (winner == null) return null;
  // `winnerId` is a SEAT index (0 = host, 1 = guest) in Escoba's writeResult payload, not a device id.
  const seat = winner === '0' ? 'host' : winner === '1' ? 'guest' : null;
  if (!seat) return null;
  const p = room[seat];
  const id = p && (p.deviceId || p.id);
  return typeof id === 'string' ? id.trim() === deviceId : null;
}

const token = await signInAnonymously(firebaseConfig.apiKey);
const rooms = (await readPath(firebaseConfig.databaseURL, 'rooms', token)) || {};
const players = (await readPath(firebaseConfig.databaseURL, 'players', token)) || {};

const per = new Map();   // deviceId -> { matches, won, lost, unknown, rooms:[] }
const bump = (id) => {
  if (!per.has(id)) per.set(id, { matches: 0, won: 0, lost: 0, unknown: 0, rooms: [] });
  return per.get(id);
};

let escobaRooms = 0, playedRooms = 0, skippedNoIds = 0;
for (const code of Object.keys(rooms)) {
  const room = rooms[code] || {};
  const game = room.game || (room.config && room.config.game);
  if (game !== 'escoba') continue;
  escobaRooms++;
  if (!isPlayedMatch(room)) continue;
  playedRooms++;
  const ids = deviceIdsOf(room);
  if (!ids.length) { skippedNoIds++; continue; }
  for (const id of ids) {
    const rec = bump(id);
    rec.matches++;
    rec.rooms.push(code);
    const w = wonBy(room, id);
    if (w === true) rec.won++;
    else if (w === false) rec.lost++;
    else rec.unknown++;
  }
}

// What each device's own h2h currently proves - the floor the shipped migration already reaches.
const h2hFloor = new Map();
for (const statsId of Object.keys(players)) {
  const rows = ((players[statsId] || {}).stats || {}).h2h;
  const esc = rows && rows.escoba;
  if (!esc || typeof esc !== 'object') continue;
  let w = 0, l = 0;
  for (const opp of Object.keys(esc)) { const r = esc[opp] || {}; w += Math.max(0, r.w | 0); l += Math.max(0, r.l | 0); }
  if (w + l > 0) h2hFloor.set(statsId, { won: w, lost: l });
}

const nameOf = (statsId) => (((players[statsId] || {}).profile || {}).name || '(unnamed)');
// A device's stats id is its device id, or `<deviceId>-<CODE>` for a second player on that phone.
const statsIdsForDevice = (deviceId) => Object.keys(players).filter((s) => s === deviceId || s.startsWith(deviceId + '-'));

const report = [];
for (const [deviceId, rec] of [...per.entries()].sort((a, b) => b[1].matches - a[1].matches)) {
  const sids = statsIdsForDevice(deviceId);
  const sid = sids[0] || deviceId;
  const floor = h2hFloor.get(sid) || { won: 0, lost: 0 };
  report.push({
    deviceId, statsId: sid, name: nameOf(sid),
    roomsMatches: rec.matches, roomsWon: rec.won, roomsLost: rec.lost, roomsUnknown: rec.unknown,
    h2hWon: floor.won, h2hLost: floor.lost,
    missedByH2h: rec.matches - (floor.won + floor.lost),
    ambiguousStatsId: sids.length > 1 ? sids : undefined,
  });
}

if (asJson) { console.log(JSON.stringify({ escobaRooms, playedRooms, skippedNoIds, report }, null, 2)); }
else {
  console.log(`Escoba rooms: ${escobaRooms}   of those actually played: ${playedRooms}   skipped (no device ids): ${skippedNoIds}\n`);
  console.log('device    name              rooms  W   L   ?   h2h(W-L)  h2h missed');
  for (const r of report) {
    console.log(
      `${r.deviceId.slice(0, 8)}  ${String(r.name).slice(0, 16).padEnd(16)}  ${String(r.roomsMatches).padStart(5)}  ${String(r.roomsWon).padStart(2)}  ${String(r.roomsLost).padStart(2)}  ${String(r.roomsUnknown).padStart(2)}  ${String(r.h2hWon + '-' + r.h2hLost).padStart(8)}  ${String(r.missedByH2h).padStart(10)}`
      + (r.ambiguousStatsId ? `   AMBIGUOUS: ${r.ambiguousStatsId.join(', ')}` : ''));
  }
  console.log('\n"h2h missed" is how many played matches this device\'s own h2h rows cannot prove.');
  console.log('A row with an unresolved "?" count has rooms whose winner could not be read; those');
  console.log('matches are counted as played but their W/L split is not asserted.\n');
  console.log('--- paste into ESCOBA_MP_KNOWN in js/game-stats.js ---');
  for (const r of report) {
    if (r.roomsUnknown > 0) { console.log(`  // ${r.name}: ${r.roomsUnknown} match(es) with an unreadable winner - resolve before adding`); continue; }
    if (r.roomsWon + r.roomsLost <= r.h2hWon + r.h2hLost) continue;   // h2h already reaches it
    console.log(`  '${r.statsId}': { won: ${r.roomsWon}, lost: ${r.roomsLost} },   // ${r.name}`);
  }
}
