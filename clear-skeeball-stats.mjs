// clear-skeeball-stats.mjs - Matt-only, one purpose: remove every Skeeball record from the
// SERVER. Matt asked for it in so many words (2026-08-22, "Delete all Skeeball game data"),
// which is the only thing that permits this under THE LAW.
//
//   node clear-skeeball-stats.mjs            dry run - prints exactly what would go, writes nothing
//   node clear-skeeball-stats.mjs --write    does it, then verifies by fresh re-read
//
// WHAT IT DELETES, and nothing else:
//   players/<id>/stats/games/skeeball        the whole per-game object (byDiff, sk, total)
//
// WHAT IT LEAVES ALONE: every other game, `h2h`, profiles, usernames, rooms, bug reports. The
// h2h node has no skeeball branch (Skeeball is solo, no opponent), and this asserts that before
// writing rather than assuming it.
//
// THIS IS NOT DURABLE ON ITS OWN. js/stats-net.js's syncMyStats() mirrors `loadStats()` - the
// DEVICE'S WHOLE LOCAL STORE - up to its node on every hub load. So any device that still holds
// local Skeeball data re-uploads it the next time it opens the hub, and the record comes back.
// The complete job is: press the dev-only "Reset Skeeball stats" button on every device still in
// use FIRST, then run this to sweep the orphan nodes that will never sync again.
//
// Run backups/rtdb-backup.mjs first. This refuses to start without a backup from today.

import fs from 'node:fs';
import path from 'node:path';
import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';
import { firebaseConfig } from './js/firebase-config.js';

// Read from the SAME config the app and the backup use - never a second copy of the key.
const API_KEY = firebaseConfig.apiKey;
const DB = firebaseConfig.databaseURL;
const WRITE = process.argv.includes('--write');

async function del(p, idToken) {
  const res = await fetch(`${DB}/${p}.json?auth=${idToken}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${p} failed: ${res.status} ${await res.text()}`);
}

// GUARD: never run this without a same-day full snapshot to restore from.
function requireFreshBackup() {
  const dir = 'backups';
  const today = new Date().toISOString().slice(0, 10);
  const hit = fs.readdirSync(dir)
    .filter((n) => n.startsWith('rtdb-') && n.endsWith('.json'))
    .find((n) => n.includes(today));
  if (!hit) {
    console.error(`No backups/rtdb-${today}*.json. Run: node backups/rtdb-backup.mjs`);
    process.exit(1);
  }
  const bytes = fs.statSync(path.join(dir, hit)).size;
  console.log(`backup on hand: ${hit} (${bytes.toLocaleString()} bytes)\n`);
}

async function main() {
  requireFreshBackup();
  const idToken = await signInAnonymously(API_KEY);
  const players = (await readPath(DB, 'players', idToken)) || {};

  const targets = [];
  let h2hSkeeball = 0;
  for (const [id, p] of Object.entries(players)) {
    const st = p && p.stats;
    if (st && st.h2h && st.h2h.skeeball) h2hSkeeball++;
    const sk = st && st.games && st.games.skeeball;
    if (!sk) continue;
    const s = sk.sk || {};
    targets.push({
      id,
      name: (p.profile && p.profile.name) || '(no name)',
      plays: s.played | 0,
      best: s.bestGame | 0,
      points: s.points | 0,
    });
  }

  // GUARD: Skeeball is solo, so nothing should ever have written a skeeball head-to-head. If one
  // exists, the shape is not what this script was written against - stop rather than guess.
  if (h2hSkeeball) {
    console.error(`ABORT: ${h2hSkeeball} node(s) carry stats.h2h.skeeball, which should not exist.`);
    process.exit(1);
  }

  const withPlays = targets.filter((t) => t.plays > 0);
  targets.sort((a, b) => b.best - a.best);
  console.log(`players/* nodes:                       ${Object.keys(players).length}`);
  console.log(`carrying stats.games.skeeball:         ${targets.length}`);
  console.log(`  ...of which have plays > 0:          ${withPlays.length}`);
  console.log(`  ...empty shells (plays 0):           ${targets.length - withPlays.length}`);
  console.log(`total plays to be removed:             ${withPlays.reduce((n, t) => n + t.plays, 0)}`);
  console.log(`highest score to be removed:           ${targets[0] ? targets[0].best : 0}\n`);
  for (const t of withPlays.sort((a, b) => b.best - a.best)) {
    console.log(`  ${t.name.padEnd(15)} plays=${String(t.plays).padStart(3)}  best=${String(t.best).padStart(4)}  ${t.id.slice(0, 8)}`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN. Nothing was written. Re-run with --write to delete these ${targets.length} nodes.`);
    return;
  }

  console.log(`\nDeleting ${targets.length} nodes...`);
  let done = 0;
  for (const t of targets) {
    await del(`players/${t.id}/stats/games/skeeball`, idToken);
    done++;
  }
  console.log(`deleted: ${done}`);

  // THE LAW rule 6: verify by FRESH re-read, never by trusting the write.
  const after = (await readPath(DB, 'players', idToken)) || {};
  const left = Object.entries(after).filter(([, p]) => p && p.stats && p.stats.games && p.stats.games.skeeball);
  const otherGamesBefore = Object.values(players)
    .reduce((n, p) => n + Object.keys((p.stats && p.stats.games) || {}).length, 0) - targets.length;
  const otherGamesAfter = Object.values(after)
    .reduce((n, p) => n + Object.keys((p.stats && p.stats.games) || {}).length, 0);

  console.log(`\nVERIFY (fresh re-read):`);
  console.log(`  nodes still carrying skeeball:       ${left.length}   (want 0)`);
  console.log(`  every OTHER game object, before:     ${otherGamesBefore}`);
  console.log(`  every OTHER game object, after:      ${otherGamesAfter}   (want the same)`);
  if (left.length || otherGamesAfter !== otherGamesBefore) {
    console.error('\nFAILED. Restore from the backup above.');
    process.exit(1);
  }
  console.log('\nOK: every skeeball record gone, every other game untouched.');
  console.log('Devices still holding local Skeeball data will re-upload it on their next hub load.');
}

main().catch((e) => { console.error(e); process.exit(1); });
