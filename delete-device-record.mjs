// delete-device-record.mjs - Matt-only: DELETE one device's whole `players/<id>` record.
//
// Written 2026-09-12, for one specific instruction. A player told Matt he had botted Tic Tac Toe
// and edited his coins in devtools on his Windows laptop; Matt: *"we should delete all activity
// that took place on his windows device."* This session raised THE LAW (root CLAUDE.md) and Matt
// overruled it in those words - *"It's my game, I control every aspect of it... The rules are for
// YOU"* - which is his call to make and the only thing that authorises this file to exist.
//
// It is deliberately NOT a general-purpose tool. It deletes ONE node named on the command line,
// refuses anything it was not pointed at, and prints the whole record before touching it.
//
//   node delete-device-record.mjs <deviceId>            dry run: show exactly what would go
//   node delete-device-record.mjs <deviceId> --write    do it, then verify by fresh re-read
//
// IT DOES BOTH HALVES, and it has to. js/stats-net.js's syncMyStats() sends `stats: loadStats()`,
// the device's ENTIRE local store, and writes it over players/<id> on every hub load. The device
// still holds every one of those plays in its own localStorage, so a server-side delete on its own
// lasts exactly until that laptop next opens the hub. So this ALSO stamps the DEVICE RESET in
// `adminConfig/v1/deviceResets/<id>` (see js/admin-config.js's "DEVICE RESET" block), which the
// device reads on load and which makes it drop its local store BEFORE it syncs. The two steps are
// in one script on purpose: doing only the first is a no-op with extra steps.
//
// Re-running it once the record is already gone just (re-)stamps the reset, so the durable half
// can be repaired without a record to delete.

import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';
import { firebaseConfig } from './js/firebase-config.js';
import { readdirSync } from 'node:fs';

const DB = firebaseConfig.databaseURL;
const WRITE = process.argv.includes('--write');
const id = process.argv.slice(2).find((a) => !a.startsWith('--'));

if (!id) {
  console.error('Usage: node delete-device-record.mjs <deviceId> [--write]');
  process.exit(2);
}

// A same-day backup is mandatory, the same guard clear-skeeball-stats.mjs uses. A delete with no
// restorable copy is the one version of this that is simply not acceptable, whoever asked for it.
function hasTodaysBackup() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    return readdirSync('./backups').some((f) => f.startsWith(`rtdb-${today}`) && f.endsWith('.json'));
  } catch { return false; }
}

function summarise(rec) {
  const games = (rec && rec.stats && rec.stats.games) || {};
  const rows = Object.entries(games)
    .map(([g, v]) => ({ g, played: (v && v.total && v.total.played) | 0, won: (v && v.total && v.total.won) | 0 }))
    .filter((r) => r.played > 0)
    .sort((a, b) => b.played - a.played);
  return rows;
}

const token = await signInAnonymously(firebaseConfig.apiKey);
const rec = await readPath(DB, `players/${id}`, token);

async function stampReset(why) {
  const at = Date.now();
  const res = await fetch(`${DB}/adminConfig/v1/deviceResets/${id}.json?auth=${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ at, by: 'delete-device-record.mjs' }),
  });
  if (!res.ok) throw new Error(`reset stamp failed: ${res.status} ${await res.text()}`);
  const back = await readPath(DB, `adminConfig/v1/deviceResets/${id}`, token);
  if (!back || back.at !== at) throw new Error('reset stamp did not verify on fresh re-read');
  console.log(`  device reset  : stamped ${new Date(at).toISOString()} (${why})`);
  console.log('                  the device clears its local store on its next hub load, before it syncs.');
  return at;
}

if (!rec) {
  console.log(`players/${id} does not exist (already deleted).`);
  if (!WRITE) { console.log('\nDRY RUN. Re-run with --write to (re-)stamp the device reset.'); process.exit(0); }
  await stampReset('record already gone');
  process.exit(0);
}

console.log(`players/${id}`);
console.log(`  name        : ${(rec.profile && rec.profile.name) || '(none)'}`);
console.log(`  device      : ${(rec.device && rec.device.device) || '?'} / ${(rec.device && rec.device.browser) || '?'}`);
console.log(`  last synced : ${rec.stats && rec.stats.updatedAt}`);
console.log('  WOULD DELETE, in full:');
const rows = summarise(rec);
let totalPlays = 0;
for (const r of rows) { totalPlays += r.played; console.log(`      ${r.g.padEnd(14)} ${String(r.played).padStart(6)} played  ${String(r.won).padStart(6)} won`); }
console.log(`      ${'TOTAL'.padEnd(14)} ${String(totalPlays).padStart(6)} plays`);
if (rec.h2h) console.log(`  also: an h2h branch (${Object.keys(rec.h2h).length} games)`);

// Other people's records can reference this one as an opponent. Deleting it does not rewrite
// theirs - say so out loud rather than leaving it to be discovered later.
const all = await readPath(DB, 'players', token);
const named = Object.entries(all || {})
  .filter(([k, p]) => k !== id && p && p.h2h && JSON.stringify(p.h2h).includes(id))
  .map(([k, p]) => (p.profile && p.profile.name) || k.slice(0, 8));
if (named.length) console.log(`\n  NOTE: ${named.length} other record(s) reference this device in their h2h: ${named.join(', ')}\n        Those are NOT touched; their own history stays exactly as it is.`);

if (!WRITE) {
  console.log('\nDRY RUN. Nothing was written. Re-run with --write to delete this record.');
  process.exit(0);
}

if (!hasTodaysBackup()) {
  console.error('\nREFUSING: no backups/rtdb-<today>.json. Run `node backups/rtdb-backup.mjs` first.');
  process.exit(1);
}

const res = await fetch(`${DB}/players/${id}.json?auth=${token}`, { method: 'DELETE' });
if (!res.ok) {
  console.error(`DELETE failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

// Verify by fresh re-read (THE LAW rule 6's pattern, which survives Matt's override: an
// unverified write is not a completed one whatever the write was).
const after = await readPath(DB, `players/${id}`, token);
const others = await readPath(DB, 'players', token);
const otherCount = Object.keys(others || {}).length;
console.log(`\nVerified by fresh re-read:`);
console.log(`  players/${id} : ${after === null ? 'GONE' : 'STILL PRESENT - THE DELETE FAILED'}`);
console.log(`  other records  : ${otherCount} (was ${Object.keys(all).length}, expected ${Object.keys(all).length - 1})`);
if (after !== null || otherCount !== Object.keys(all).length - 1) process.exit(1);
await stampReset('paired with the delete above');
console.log('\nDone. Both halves are in place.');
