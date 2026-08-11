// read-bug-reports.mjs - Matt-only dev tool: reads what the "Report a bug" button
// (js/bug-report.js, `bugReports/<pushId>` in RTDB) has collected, so a report can be reviewed,
// triaged, or pasted into a session without anyone doing anything beyond pressing the button on
// their own phone. The in-app inbox (the hub's "Bug reports" pill, Matt's profile only) shows the
// same records; this is the terminal-side view, and the only one that can save the screenshots to
// disk where a session can actually look at them.
//
// No new dependency, same pattern as read-device-reports.mjs: anonymous sign-in via the plain
// Identity Toolkit REST endpoint, then RTDB's own REST API, both with the built-in `fetch`.
// (js/firebase-config.js's apiKey is not a secret; access control is the RTDB rules.)
//
// Screenshots live in a SEPARATE node (`bugReportShots/<id>`) because they are base64 and big;
// this script does not fetch them unless asked, so the default listing stays fast.
//
// Usage:
//   node read-bug-reports.mjs                  # summary of every report, newest first
//   node read-bug-reports.mjs --open           # only reports not yet marked done
//   node read-bug-reports.mjs <reportId>       # one report, in full
//   node read-bug-reports.mjs <reportId> --shots [dir]   # also write its screenshots to disk
//   node read-bug-reports.mjs --json           # raw JSON (everything, no screenshots)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '(no date)');

function summaryLine(r) {
  const who = (r.reporter && r.reporter.name) || '(unnamed)';
  const where = r.gameTitle || r.game || 'hub';
  const status = r.status === 'done' ? 'done' : 'NEW ';
  const shots = r.shotCount ? ` [${r.shotCount} shot${r.shotCount > 1 ? 's' : ''}]` : '';
  const first = String(r.description || '').split('\n')[0].slice(0, 70);
  return `${status} ${when(r.createdAtMs)}  ${who} · ${where}${shots}\n       ${first}`;
}

/** The fields worth reading before opening the full JSON: who, what, and what they were holding. */
function printReport(r) {
  const env = r.environment || {};
  console.log(`\n=== ${r.id} · ${when(r.createdAtMs)} · ${r.status || 'new'} ===`);
  console.log(`Reporter : ${(r.reporter && r.reporter.name) || '(unnamed)'}  code ${(r.reporter && r.reporter.playerCode) || '-'}  device ${String((r.reporter && r.reporter.deviceId) || '').slice(0, 8)}`);
  console.log(`Where    : ${r.gameTitle || r.game || 'hub / elsewhere'}`);
  console.log(`Device   : ${env.deviceLabel || '?'}`);
  console.log(`Browser  : ${env.browserLabel || '?'}   mode: ${env.installed ? 'installed app' : (env.displayMode || '?')}`);
  console.log(`Screen   : ${(env.screen && `${env.screen.viewportW}x${env.screen.viewportH} @${env.screen.dpr}x, ${env.screen.orientation || '?'}`) || '?'}`);
  console.log(`App      : ${env.appVersion || '?'}  (sw ${(env.serviceWorker && env.serviceWorker.activeCache) || 'none'})`);
  console.log(`Network  : ${(env.network && [env.network.online ? 'online' : 'offline', env.network.effectiveType, env.network.rttMs && `${env.network.rttMs}ms`].filter(Boolean).join(' · ')) || '?'}`);
  console.log(`Prefs    : lang ${(env.prefs && env.prefs.lang) || '-'} · theme ${(env.prefs && env.prefs.theme) || '-'}${env.prefs && env.prefs.prefersReducedMotion ? ' · reduced motion' : ''}`);
  if (env.gpu && env.gpu.renderer) console.log(`GPU      : ${env.gpu.renderer}`);
  console.log(`\n"${r.description || ''}"\n`);
  const errs = (env.recentErrors || []);
  if (errs.length) {
    console.log(`Recent JS errors on that device (${errs.length}):`);
    for (const e of errs.slice(-6)) console.log(`  ${e.at}  ${e.kind}: ${e.msg}${e.src ? `  (${e.src}:${e.line})` : ''}`);
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));
  const [id, dirArg] = positional;
  const has = (f) => flags.includes(f);

  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.error('js/firebase-config.js is not configured - nothing to read.');
    process.exit(1);
  }
  const idToken = await signInAnonymously(firebaseConfig.apiKey);

  if (id) {
    const r = await fetchRTDB(firebaseConfig.databaseURL, `bugReports/${id}`, idToken);
    if (!r) { console.log(`No report ${id}.`); return; }
    r.id = r.id || id;
    printReport(r);
    if (has('--shots')) {
      const shots = await fetchRTDB(firebaseConfig.databaseURL, `bugReportShots/${id}`, idToken);
      const dir = dirArg || `.bug-shots/${id}`;
      if (!shots) { console.log('No screenshots on this report.'); }
      else {
        mkdirSync(dir, { recursive: true });
        for (const [key, shot] of Object.entries(shots)) {
          const b64 = String(shot.dataUrl || '').split(',')[1] || '';
          const file = join(dir, `${key}.jpg`);
          writeFileSync(file, Buffer.from(b64, 'base64'));
          console.log(`wrote ${file}  (${shot.width}x${shot.height})`);
        }
      }
    } else if (r.shotCount) {
      console.log(`(${r.shotCount} screenshot(s); re-run with --shots to save them)`);
    }
    console.log('--- full record ---');
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const all = await fetchRTDB(firebaseConfig.databaseURL, 'bugReports', idToken);
  if (!all) { console.log('No bug reports yet.'); return; }
  // Number(), never `| 0`: epoch ms overflows a signed 32-bit int (see js/bug-report.js's ms()).
  let reports = Object.entries(all).map(([k, v]) => Object.assign({ id: k }, v))
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0));
  if (has('--open')) reports = reports.filter((r) => r.status !== 'done');

  if (has('--json')) { console.log(JSON.stringify(reports, null, 2)); return; }

  console.log(`${reports.length} report(s)${has('--open') ? ' still open' : ''}, newest first:\n`);
  for (const r of reports) console.log(`${summaryLine(r)}\n       id ${r.id}\n`);
  console.log('Run `node read-bug-reports.mjs <id>` for one in full, `--shots` to save its screenshots.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
