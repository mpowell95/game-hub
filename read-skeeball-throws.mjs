// read-skeeball-throws.mjs - DEV TOOL, remove with the in-game throw-logging before Skeeball goes
// public (Matt, 2026-08-17). Reads the real per-throw data the game records to
// skeeballThrows/<deviceId>/ (flick speed -> power -> launch m/s -> aim -> the ACTUAL hole it
// landed in) and summarises it per result value, so the measured play can be checked against the
// calculated ranges. Read-only; same no-dependency REST pattern as read-device-reports.mjs.
//
//   node read-skeeball-throws.mjs            # summary table per result value
//   node read-skeeball-throws.mjs --raw      # every row, newest first
//   node read-skeeball-throws.mjs --json     # the flattened array as JSON

import { firebaseConfig } from './js/firebase-config.js';
import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';

const args = process.argv.slice(2);
const RAW = args.includes('--raw');
const JSON_OUT = args.includes('--json');

const idToken = await signInAnonymously(firebaseConfig.apiKey);
const tree = await readPath(firebaseConfig.databaseURL, 'skeeballThrows', idToken);

// Flatten { deviceId: { pushId: record } } -> [record...]
const rows = [];
for (const dev of Object.keys(tree || {})) {
  const byId = tree[dev] || {};
  for (const id of Object.keys(byId)) {
    const r = byId[id];
    if (r && typeof r === 'object') rows.push({ dev, id, ...r });
  }
}
rows.sort((a, b) => (b.at || 0) - (a.at || 0));

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

console.log(`skeeballThrows: ${rows.length} throws across ${Object.keys(tree || {}).length} device(s)\n`);
if (!rows.length) { console.log('(nothing logged yet - play some throws on a build that has the logging)'); process.exit(0); }

if (RAW) {
  console.log('date               name        flick power m/s   aim    bnc bkbd impV settle  -> result   sequence');
  for (const r of rows) {
    const d = r.at ? new Date(r.at).toISOString().slice(0, 16).replace('T', ' ') : '?';
    console.log(
      d.padEnd(18),
      String(r.name || '-').slice(0, 10).padEnd(11),
      num(r.flick, 5), num(r.power, 5), num(r.launch, 5), num(r.aim, 6),
      String(r.bounces ?? '-').padStart(3), String(r.backboard ?? '-').padStart(4),
      num(r.impactSpeed, 5), (r.settleMs != null ? r.settleMs + 'ms' : '-').padStart(7),
      ' -> ', String(r.value).padStart(3), '(' + (r.hole || '-') + ')',
      ' ', String(r.seq || '').replace(/,/g, ' '),
    );
  }
  process.exit(0);
}

// Summary per result value.
const VALUES = [10, 20, 30, 40, 50, 100];
const groups = new Map();
for (const r of rows) {
  const key = String(r.value | 0);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const keysOrdered = [...VALUES.map(String), ...[...groups.keys()].filter((k) => !VALUES.map(String).includes(k) && k !== '0'), '0'];

console.log('result   n     flick (h/s)          power              |aim|              bounces   settle');
console.log('------   ---   ------------------   ----------------   ----------------   -------   ------');
for (const k of keysOrdered) {
  const g = groups.get(k);
  if (!g || !g.length) continue;
  const label = k === '0' ? 'miss/0' : k;
  console.log(
    label.padEnd(7),
    String(g.length).padStart(3), '  ',
    band(g.map((r) => r.flick)).padEnd(19),
    band(g.map((r) => r.power)).padEnd(17),
    band(g.map((r) => Math.abs(r.aim || 0))).padEnd(16),
    avgOf(g.map((r) => r.bounces)).padEnd(7),
    ' ' + avgOf(g.map((r) => r.settleMs)) + 'ms',
  );
}

// Hole breakdown for the 0/miss bucket (gutter vs returned vs a real low hole).
const zeros = groups.get('0') || [];
if (zeros.length) {
  const byHole = {};
  for (const r of zeros) byHole[r.hole || '-'] = (byHole[r.hole || '-'] || 0) + 1;
  console.log('\nmiss/0 by hole:', Object.entries(byHole).map(([h, n]) => `${h}:${n}`).join('  '));
}

function num(v, w) { return (v == null ? '-' : (+v).toFixed(2)).padStart(w); }
function avgOf(arr) {
  const a = arr.filter((x) => typeof x === 'number');
  if (!a.length) return '-';
  return (a.reduce((p, c) => p + c, 0) / a.length).toFixed(1);
}
function band(arr) {
  const a = arr.filter((x) => typeof x === 'number');
  if (!a.length) return '-';
  const lo = Math.min(...a), hi = Math.max(...a), avg = a.reduce((p, c) => p + c, 0) / a.length;
  return `${lo.toFixed(2)}-${hi.toFixed(2)} (${avg.toFixed(2)})`;
}
