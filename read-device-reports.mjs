// read-device-reports.mjs - Matt-only dev tool: fetches Device Details reports
// (js/device-report.js, `deviceReports/<deviceId>/<pushId>` in RTDB) so they can be
// reviewed or pasted into a conversation, without Ana/Natalia doing anything beyond
// pressing the "Device details" button on their own phone.
//
// No new dependency: signs in anonymously via the plain Identity Toolkit REST API
// (the same auth flow js/firebase-boot.js uses via the SDK) and reads RTDB over its
// own REST API - both with the built-in `fetch`, matching this repo's "no build step,
// no dependencies" rule. Reuses the same public client config as the app itself
// (js/firebase-config.js's apiKey is not a secret; real access control is RTDB rules).
//
// Usage:
//   node read-device-reports.mjs                 # every device's reports
//   node read-device-reports.mjs <deviceId>       # one device's reports
//   node read-device-reports.mjs <deviceId> --raw # unformatted, full precision

import { firebaseConfig } from './js/firebase-config.js';

async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${data.error && data.error.message || res.status}`);
  return data.idToken;
}

async function fetchRTDB(databaseURL, path, idToken) {
  const url = `${databaseURL}/${path}.json?auth=${idToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`RTDB read failed (${path}): ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const raw = args.includes('--raw');
  const deviceId = args.find((a) => !a.startsWith('--'));

  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.error('js/firebase-config.js is not configured - nothing to read.');
    process.exit(1);
  }

  const idToken = await signInAnonymously(firebaseConfig.apiKey);
  const path = deviceId ? `deviceReports/${deviceId}` : 'deviceReports';
  const data = await fetchRTDB(firebaseConfig.databaseURL, path, idToken);

  if (!data) {
    console.log(deviceId ? `No reports found for device ${deviceId}.` : 'No device reports found at all.');
    return;
  }

  if (raw) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Friendly summary first, then the full JSON per report.
  const byDevice = deviceId ? { [deviceId]: data } : data;
  for (const [devId, reports] of Object.entries(byDevice)) {
    console.log(`\n=== Device ${devId} ===`);
    const entries = Object.entries(reports || {}).sort((a, b) => (a[1].capturedAt || '').localeCompare(b[1].capturedAt || ''));
    for (const [pushId, report] of entries) {
      const name = (report.profile && report.profile.name) || '(no name set)';
      const code = (report.profile && report.profile.playerId) || '-';
      console.log(`\n--- ${pushId} · captured ${report.capturedAt} · "${name}" · code ${code} ---`);
      console.log(JSON.stringify(report, null, 2));
    }
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
