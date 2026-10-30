// tools/reader-auth.mjs - how a session signs in to READ the admin-only logs (2026-10-30, Matt: "set up
// the read-only list"). With the environment variable GAMEHUB_READER (the key Matt creates on the admin
// page, Admin > gear > Reader key) the session signs in as that one reader: database.rules.json lets a uid
// in readers/ READ playLog, beeAlerts, integrityFlags and integrityAlerts, and change nothing. Without it,
// an ordinary anonymous sign-in (the admin-only branches then say "Permission denied").
//
//   import { signInForReading } from './reader-auth.mjs';
//   const { idToken, reader } = await signInForReading();
import { signInAnonymously } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';

export async function signInForReading() {
  const key = String(process.env.GAMEHUB_READER || '').trim();
  if (!key) return { idToken: await signInAnonymously(firebaseConfig.apiKey), reader: false };
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(key)}`,
  });
  const data = await res.json();
  if (!res.ok || !data.id_token) throw new Error(`Reader sign-in failed: ${(data.error && data.error.message) || res.status}`);
  return { idToken: data.id_token, reader: true, uid: data.user_id };
}
