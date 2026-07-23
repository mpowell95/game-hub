// backups/rtdb-backup.mjs - full, timestamped snapshot of the Firebase Realtime Database.
//
// THE LAW, rule 6 ("no silent write failures") and the whole spirit of rules 1-5: nothing that
// writes to RTDB should ever run without a restorable copy of what was there first. Run this
// BEFORE any script that writes, any rules change, and any schema change. It is read-only.
//
// No new dependency (this repo has none, by design): signs in anonymously via the plain Identity
// Toolkit REST API and reads RTDB over its own REST API, both with the built-in `fetch` - the same
// pattern as read-device-reports.mjs. Reuses the app's own public client config
// (js/firebase-config.js's apiKey is not a secret; real access control is RTDB rules).
//
// Usage:
//   node backups/rtdb-backup.mjs                  # whole DB -> backups/rtdb-<ISO>.json
//   node backups/rtdb-backup.mjs players          # one subtree -> backups/rtdb-players-<ISO>.json
//   node backups/rtdb-backup.mjs --out path.json  # explicit destination
//
// Restoring is deliberately NOT automated: a restore is a destructive write and must be a
// considered, hand-driven action. The snapshot is plain JSON - the shape RTDB's own console
// "Import JSON" accepts.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseConfig } from '../js/firebase-config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${(data.error && data.error.message) || res.status}`);
  return data.idToken;
}

export async function readPath(databaseURL, path, idToken) {
  const res = await fetch(`${databaseURL}/${path}.json?auth=${idToken}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`RTDB read failed (${path}): ${JSON.stringify(data)}`);
  return data;
}

/** Count total recorded plays under a players/ map, the number THE LAW says must never shrink. */
export function totalPlays(players) {
  let n = 0;
  for (const id of Object.keys(players || {})) {
    const games = (((players[id] || {}).stats) || {}).games || {};
    for (const g of Object.keys(games)) n += ((games[g] || {}).total || {}).played | 0;
  }
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const explicitOut = outIdx >= 0 ? args[outIdx + 1] : null;
  const path = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1) || '';

  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.error('js/firebase-config.js is not configured - nothing to back up.');
    process.exit(1);
  }

  const idToken = await signInAnonymously(firebaseConfig.apiKey);
  const data = await readPath(firebaseConfig.databaseURL, path, idToken);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `rtdb${path ? '-' + path.replace(/\//g, '-') : ''}-${stamp}.json`;
  const out = explicitOut || join(HERE, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');

  const players = path === '' ? (data || {}).players : (path === 'players' ? data : null);
  console.log(`Backed up ${path ? `"${path}"` : 'the whole database'} -> ${out}`);
  console.log(`  ${JSON.stringify(data).length.toLocaleString()} bytes of JSON`);
  if (players) {
    console.log(`  ${Object.keys(players).length} player device records, ${totalPlays(players)} total recorded plays`);
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('rtdb-backup.mjs')) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
