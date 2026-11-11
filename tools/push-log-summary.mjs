// tools/push-log-summary.mjs - PUSH LOG SUMMARY (2026-11-11, Matt: "I'm not getting notifications
// anymore... Make sure it's working for everyone else as well").
// Reads `gcloud logging read --format=json` output (a file path) of the push functions and prints
// TOTALS ONLY: per Eastern day, per function, what happened (sent / failed + Apple's reason / skipped,
// app open / removed expired subscription / errors). No player code, subscription key or endpoint is
// printed: the repo's Actions logs are public, and a code is the whole identity.
// Run by .github/workflows/push-logs.yml (workflow_dispatch only).
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8') || '[]');
const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const redact = (s) => String(s || '').replace(/\b[A-Z0-9]{5}\b/g, '<code>').replace(/https?:\/\/\S+/g, '<url>').slice(0, 160);
const counts = new Map();
const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
for (const e of rows) {
  const fn = (e.resource && e.resource.labels && (e.resource.labels.service_name || e.resource.labels.function_name)) || '?';
  const j = e.jsonPayload || {};
  let what = j.message || e.textPayload || '';
  if (/push failed/.test(what)) {
    let reason = '';
    try { reason = JSON.parse(j.body || '{}').reason || ''; } catch { reason = redact(j.body); }
    what = `push failed ${j.status || ''} ${reason}`.trim();
  } else if (e.severity === 'ERROR' || e.severity === 'CRITICAL') {
    what = `ERROR ${redact(what)}`;
  } else if (!/^(sent|skipped, app open|removed expired subscription)$/.test(what)) {
    continue;                                     // everything else is noise for this question
  }
  add(`${day(e.timestamp)}  ${fn.padEnd(24)}  ${what}`);
}
const lines = [...counts].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, n]) => `${String(n).padStart(5)}  ${k}`);
console.log(`${rows.length} log entries read`);
console.log(lines.join('\n') || '(no push results in this window)');
