// tools/read-lb-snapshot.mjs - READ-ONLY local copy of the server-built leaderboard for dev tools
// (tools/lb2-shots.cjs, tools/test-lb2-parity.mjs): boards/v1/lb/z, adminConfig/v1, boards/v1/bee ->
// backups/lb-z.json, lb-admin.json, lb-bee.json (git-ignored: real names). Writes nothing to Firebase.
//   GAMEHUB_READER=<key> node tools/read-lb-snapshot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInForReading } from './reader-auth.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { idToken } = await signInForReading();
for (const [p, f] of [['boards/v1/lb/z', 'lb-z.json'], ['adminConfig/v1', 'lb-admin.json'], ['boards/v1/bee', 'lb-bee.json']]) {
  const r = await fetch(`${firebaseConfig.databaseURL}/${p}.json?auth=${idToken}`);
  const t = await r.text();
  console.log(p, r.status, t.length);
  if (r.ok) fs.writeFileSync(path.join(ROOT, 'backups', f), t);
}
