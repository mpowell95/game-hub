// net-table.js - the online table's Firebase glue, on top of js/net.js.
//
// js/net.js is used UNCHANGED for everything it already does: the room code, the transactional
// seat claim (joinSeat, up to 8 seats), presence (heartbeat), the lobby-only seat release
// (vacateSeat), ending the room (leaveRoom) and the one room subscription (onRoom). What it has no
// shape for is a HOST-AUTHORITATIVE table: every other game here is lockstep (both devices run
// the same engine on the same deck), which poker cannot be - a lockstep deck is a deck every
// device can read. So this game writes one child of its own room, `rooms/<CODE>/pk`, and nothing
// outside it:
//
//   pk/lobby        JSON string, host only: the computer players and settings, before the deal
//   pk/pub          JSON string, host only: engine.publicView() - no deck, no hole cards
//   pk/hole/<seat>  JSON string, host only: { h: handNo, c: [two cards] } for that seat
//   pk/act/<seat>   JSON string, that seat only: { h, k, a, to, n } - one move, or 'leave'/'back'
//   pk/clock        { k, ms } host only: time left on the current turn when it was published
//
// Values are JSON STRINGS on purpose: the Realtime Database silently drops empty arrays and nulls
// and turns sparse arrays into objects, and the engine state is full of both.
//
// Honest limit: the rules on `rooms/` are `auth != null`, so a player who opens developer tools
// can read pk/hole for every seat. Nothing in the app shows another player's cards before the
// showdown; hiding them from a determined snoop would need a server dealer (a Cloud Function),
// which this game does not have.

import { getStatsApp } from '../../js/firebase-boot.js';

let _r = null;
async function db() {
  if (_r) return _r;
  _r = await getStatsApp();
  return _r;
}

const NET_TIMEOUT_MS = 12000;
/** Firebase calls never reject when the link is gone - they just never settle. Race a timeout. */
export function withTimeout(p, ms = NET_TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Multi-path update under rooms/<code>/pk. `patch` keys are relative ('pub', 'hole/3'). */
export async function pkUpdate(code, patch) {
  const r = await db();
  if (!r) throw new Error('offline');
  await withTimeout(r.api.update(r.api.ref(r.db, `rooms/${code}/pk`), patch));
}

/** One read of the whole room (null if it does not exist). */
export async function readRoom(code) {
  const r = await db();
  if (!r) throw new Error('offline');
  const snap = await withTimeout(r.api.get(r.api.ref(r.db, `rooms/${code}`)));
  return snap.val();
}

/** A seat sends one move. `n` is a random nonce so a repeated identical move is still new. */
export function sendAct(code, seat, move) {
  const body = JSON.stringify({ ...move, n: Math.random().toString(36).slice(2, 10) });
  return pkUpdate(code, { [`act/${seat}`]: body });
}

export const parse = (v) => {
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
};

export default { pkUpdate, readRoom, sendAct, parse, withTimeout };
