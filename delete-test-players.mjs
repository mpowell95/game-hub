// delete-test-players.mjs - Matt-only. Removes whole `players/<id>` nodes belonging to a TEST
// HARNESS, never to a person. Matt asked for the first one in so many words (2026-08-22,
// "Delete 'Visual Test' player data"), which is the only thing that permits this under THE LAW.
//
//   node delete-test-players.mjs                 dry run - prints exactly what would go
//   node delete-test-players.mjs --write         does it, then verifies by fresh re-read
//   node delete-test-players.mjs --name "..."    a different harness name (exact, case-insensitive)
//
// WHY A WHOLE NODE, when clear-skeeball-stats.mjs only took one game's object out: these nodes are
// not people. `test-visual.mjs`'s PLAY probes set a profile and play a real rack, and every run
// mints a FRESH deviceId, so the database accumulates one throwaway player per run. There is no
// human history inside them to preserve.
//
// IT REFUSES unless all four hold, checked per node before a single write:
//   1. the profile name matches exactly (case-insensitive, trimmed) - never a substring
//   2. the node has no `stats.h2h` of its own
//   3. no OTHER player's h2h names this node as an opponent (deleting it would strand their row)
//   4. the node is absent from the `usernames` registry
// Anything that fails is skipped and printed. A real player who happened to pick the name is
// therefore safe: they would have h2h, or a username, or somebody would have played them.
//
// Run backups/rtdb-backup.mjs first. This refuses to start without a backup from today.

import fs from 'node:fs';
import path from 'node:path';
import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';
import { firebaseConfig } from './js/firebase-config.js';

const API_KEY = firebaseConfig.apiKey;
const DB = firebaseConfig.databaseURL;
const WRITE = process.argv.includes('--write');
const nameIdx = process.argv.indexOf('--name');
const TARGET = (nameIdx >= 0 ? process.argv[nameIdx + 1] : 'Visual Test').trim().toLowerCase();

async function del(p, idToken) {
  const res = await fetch(`${DB}/${p}.json?auth=${idToken}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${p} failed: ${res.status} ${await res.text()}`);
}

function requireFreshBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const hit = fs.readdirSync('backups')
    .filter((n) => n.startsWith('rtdb-') && n.endsWith('.json'))
    .find((n) => n.includes(today));
  if (!hit) {
    console.error(`No backups/rtdb-${today}*.json. Run: node backups/rtdb-backup.mjs`);
    process.exit(1);
  }
  console.log(`backup on hand: ${hit} (${fs.statSync(path.join('backups', hit)).size.toLocaleString()} bytes)\n`);
}

async function main() {
  requireFreshBackup();
  const idToken = await signInAnonymously(API_KEY);
  const players = (await readPath(DB, 'players', idToken)) || {};
  const usernames = (await readPath(DB, 'usernames', idToken)) || {};

  // Who is named as an opponent ANYWHERE, and who owns a username.
  const opponentOf = new Set();
  for (const p of Object.values(players)) {
    for (const g of Object.values((p.stats && p.stats.h2h) || {})) {
      for (const opp of Object.keys(g || {})) opponentOf.add(opp);
    }
  }
  const registered = new Set(Object.values(usernames).map((v) => (v && v.id) || v));

  const go = [];
  const skip = [];
  for (const [id, p] of Object.entries(players)) {
    const nm = ((p.profile && p.profile.name) || '').trim();
    if (nm.toLowerCase() !== TARGET) continue;
    const plays = Object.entries((p.stats && p.stats.games) || {})
      .map(([g, o]) => [g, (o.total && o.total.played) | 0]).filter(([, n]) => n > 0);
    const why = [];
    if (p.stats && p.stats.h2h && Object.keys(p.stats.h2h).length) why.push('has its own h2h');
    if (opponentOf.has(id)) why.push('is another player\'s recorded opponent');
    if (registered.has(id)) why.push('owns a username');
    (why.length ? skip : go).push({ id, nm, plays, why });
  }

  console.log(`profile name targeted: "${TARGET}"`);
  console.log(`matching nodes:        ${go.length + skip.length}`);
  console.log(`  safe to delete:      ${go.length}`);
  console.log(`  REFUSED:             ${skip.length}\n`);
  for (const t of go) {
    const p = t.plays.length ? t.plays.map(([g, n]) => `${g}=${n}`).join(', ') : 'no plays';
    console.log(`  DELETE  ${t.id}  (${p})`);
  }
  for (const t of skip) console.log(`  KEEP    ${t.id}  - ${t.why.join('; ')}`);

  if (!go.length) { console.log('\nNothing to do.'); return; }
  if (!WRITE) { console.log(`\nDRY RUN. Nothing was written. Re-run with --write.`); return; }

  console.log(`\nDeleting ${go.length} whole player nodes...`);
  for (const t of go) await del(`players/${t.id}`, idToken);

  // THE LAW rule 6: verify by FRESH re-read.
  const after = (await readPath(DB, 'players', idToken)) || {};
  const left = Object.entries(after).filter(([, p]) =>
    ((p.profile && p.profile.name) || '').trim().toLowerCase() === TARGET).length;
  const before = Object.keys(players).length;
  const now = Object.keys(after).length;
  console.log(`\nVERIFY (fresh re-read):`);
  console.log(`  nodes still named "${TARGET}":  ${left}   (want ${skip.length})`);
  console.log(`  player nodes before:            ${before}`);
  console.log(`  player nodes after:             ${now}   (want ${before - go.length})`);
  if (left !== skip.length || now !== before - go.length) {
    console.error('\nFAILED. Restore from the backup above.');
    process.exit(1);
  }
  console.log('\nOK: every targeted node gone, every other player untouched.');
}

main().catch((e) => { console.error(e); process.exit(1); });
