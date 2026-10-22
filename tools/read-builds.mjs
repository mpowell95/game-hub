// tools/read-builds.mjs - which build each person's phones are running (2026-10-22, Matt: "push this
// update to everyone. make sure they all download it"). Read-only. Every device mirrors the build its
// page runs (`players/<id>/device.build`, js/stats-net.js) on each sync, so this lists, per person,
// each device's build and when it last synced, newest builds first.
//
//   node tools/read-builds.mjs              everyone seen in the last 14 days
//   node tools/read-builds.mjs --days 3     a shorter window
import { firebaseConfig } from '../js/firebase-config.js';
import { signInAnonymously } from '../backups/rtdb-backup.mjs';

const days = Number((process.argv.find((a, i) => process.argv[i - 1] === '--days')) || 14);
const tok = await signInAnonymously(firebaseConfig.apiKey);
const id = typeof tok === 'string' ? tok : tok.idToken;
const [players, version] = await Promise.all([
  fetch(`${firebaseConfig.databaseURL}/players.json?auth=${id}`).then((r) => r.json()),
  fetch(`https://mpowell95.github.io/game-hub/version.json?x=${Date.now()}`).then((r) => r.json()).catch(() => ({})),
]);
const latest = String(version.cache || '').replace(/^game-hub-/, '');
const since = Date.now() - days * 86400000;
const rows = [];
for (const [dev, rec] of Object.entries(players || {})) {
  const at = +rec.updatedAt || 0;
  if (at < since) continue;
  const p = rec.profile || {};
  const name = String(p.name || '').trim();
  if (!name || name.toLowerCase() === 'you') continue;
  rows.push({ name, code: p.playerId || '', build: String((rec.device || {}).build || '?'), at, dev: dev.slice(0, 8), what: `${(rec.device || {}).device || ''} ${(rec.device || {}).installed ? 'app' : 'tab'}` });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || b.at - a.at);
const num = (b) => Number((/v(\d+)/.exec(b) || [])[1] || 0);
let onLatest = 0;
for (const r of rows) {
  const ok = r.build === latest;
  if (ok) onLatest++;
  console.log(`${ok ? 'ok ' : '-- '} ${r.name.padEnd(22)} ${r.build.padEnd(16)} ${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')}  ${r.what} ${r.dev}`);
}
console.log(`\nlatest ${latest}: ${onLatest} of ${rows.length} devices seen in the last ${days} days (oldest build seen: v${Math.min(...rows.map((r) => num(r.build)).filter(Boolean))})`);
