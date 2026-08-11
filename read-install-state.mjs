// read-install-state.mjs - Matt-only: who is playing in the INSTALLED app, and who is still in a
// browser tab.
//
// Why it exists (2026-08-11): Matt found out Ana had been playing in a Safari tab for two months.
// She dismissed the add-to-home-screen sheet early on, nothing ever asked again, and nothing
// anywhere recorded that she had. Every game here is built for the installed route, so this is a
// real diagnostic - it just had nowhere to live until js/install-state.js started riding along on
// the ordinary stats mirror (js/stats-net.js writes `players/<id>/device` on every hub load).
//
// So the data only appears for a device AFTER it next opens the hub on a build that has this. A
// phone that has not been opened since shows "(not seen yet)" - that is missing data, NOT a
// browser tab, and the two must never be confused. Nothing here is retroactive: there is no record
// of how anyone played before this shipped.
//
// Same no-dependency pattern as read-bug-reports.mjs / read-device-reports.mjs: anonymous sign-in
// via the Identity Toolkit REST endpoint, then RTDB's REST API, both with the built-in `fetch`.
//
// Usage:
//   node read-install-state.mjs            # one line per person, browser tabs first
//   node read-install-state.mjs --json     # the raw per-device records

import { firebaseConfig } from './js/firebase-config.js';

async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anonymous sign-in failed: ${(data.error && data.error.message) || res.status}`);
  return data.idToken;
}

async function fetchRTDB(databaseURL, path, idToken) {
  const res = await fetch(`${databaseURL}/${path}.json?auth=${idToken}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`RTDB read failed (${path}): ${JSON.stringify(data)}`);
  return data;
}

const when = (ms) => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) : '(never synced)');

function main() {
  return (async () => {
    const raw = process.argv.includes('--json');
    if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
      console.error('js/firebase-config.js is not configured - nothing to read.');
      process.exit(1);
    }
    const idToken = await signInAnonymously(firebaseConfig.apiKey);
    const players = await fetchRTDB(firebaseConfig.databaseURL, 'players', idToken) || {};

    const rows = Object.entries(players).map(([id, rec]) => {
      const p = (rec && rec.profile) || {};
      const d = (rec && rec.device) || null;
      return {
        id,
        name: (p.name || '').trim() || '(unnamed)',
        code: p.playerId || '-',
        installed: d ? d.installed : null,
        mode: d ? d.mode : null,
        browser: d ? d.browser : null,
        device: d ? d.device : null,
        // The tell for Ana's exact case: asked, and said no.
        dismissedTheSheet: d ? d.a2hsDismissed : null,
        lastSync: (rec && rec.updatedAt) || 0,
      };
    });

    if (raw) { console.log(JSON.stringify(rows, null, 2)); return; }

    // Browser tabs first - they are the ones worth a nudge - then unknown, then installed.
    const rank = (r) => (r.installed === false ? 0 : r.installed == null ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    const tabs = rows.filter((r) => r.installed === false);
    const unknown = rows.filter((r) => r.installed == null);
    const app = rows.filter((r) => r.installed === true);

    for (const r of rows) {
      const state = r.installed === true ? 'INSTALLED APP'
        : r.installed === false ? 'browser tab  '
          : '(not seen yet)';
      const extra = [r.device, r.browser, r.dismissedTheSheet ? 'dismissed the install prompt' : '']
        .filter(Boolean).join(' · ');
      console.log(`${state}  ${r.name.padEnd(14)} ${r.code.padEnd(6)} ${when(r.lastSync)}  ${extra}`);
    }
    console.log(`\n${app.length} on the installed app, ${tabs.length} in a browser tab, ${unknown.length} not seen since this shipped.`);
    if (unknown.length) {
      console.log('"(not seen yet)" means that device has not opened the hub since this went live -');
      console.log('it is missing data, not a browser tab. Nothing here is retroactive.');
    }
  })();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
