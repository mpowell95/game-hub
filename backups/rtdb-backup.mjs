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

// --- the whole database, branch by branch (2026-08-31) --------------------------------------------
//
// This used to read `/` in one request. It cannot any more: scoping `messages/` to its own two
// participants meant the root `.read` had to become `false`, because a granted ANCESTOR read
// cascades down and cannot be revoked by a child rule. So the snapshot is assembled from the
// branches instead.
//
// KEEP THIS LIST IN STEP WITH database.rules.json. A branch added there and forgotten here is
// silently absent from every future backup, which is the worst shape a backup bug can take. The
// run prints every branch and its size, so a missing one is visible rather than inferred.
export const BRANCHES = [
  'players', 'usernames', 'rooms', 'adminConfig', 'admins', 'archive',
  'bugReports', 'bugReportShots', 'bugReplies', 'deviceReports',
  'skeeballThrows', 'challenge', 'flight', 'selfies',
  // messages/ is deliberately last: an anonymous sign-in is not on the admins allowlist, so this
  // one comes back denied and is recorded as such rather than as an empty branch. See the warning
  // main() prints, and database.rules.README.md for how to export it from the console.
  'messages',
];

/** Read every branch. Returns { data, denied: [names] } - a denied branch is NEVER silently
 *  recorded as empty; it is left out and named, so nobody mistakes a permission for an absence. */
export async function readWholeDatabase(databaseURL, idToken) {
  const data = {};
  const denied = [];
  for (const b of BRANCHES) {
    try {
      const v = await readPath(databaseURL, b, idToken);
      if (v !== null && v !== undefined) data[b] = v;
    } catch (err) {
      if (/permission/i.test(String(err.message || err))) denied.push(b);
      else throw err;
    }
  }
  return { data, denied };
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
  let data, denied = [];
  if (path) {
    data = await readPath(firebaseConfig.databaseURL, path, idToken);
  } else {
    ({ data, denied } = await readWholeDatabase(firebaseConfig.databaseURL, idToken));
  }

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
  if (!path) {
    console.log(`  branches: ${Object.keys(data).join(', ') || '(none)'}`);
  }
  // Loud, never a footnote: a backup with a hole in it that nobody knows about is worse than no
  // backup, because it is trusted.
  if (denied.length) {
    console.warn(`\n  NOT INCLUDED (the rules refuse an anonymous read): ${denied.join(', ')}`);
    console.warn('  This snapshot is NOT complete. Export those branches from the Firebase console');
    console.warn('  (Realtime Database > the branch > the three-dot menu > Export JSON), which runs');
    console.warn('  as you rather than anonymously. See database.rules.README.md.');
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('rtdb-backup.mjs')) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
