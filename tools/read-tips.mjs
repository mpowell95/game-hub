// tools/read-tips.mjs - who has seen each in-game tip, and when (2026-11-15). Read-only. Every phone mirrors
// js/tips-log.js's report as players/<id>/tips on each sync; this merges it per person (all their devices), times
// in Eastern. First user: Battle Arena's first-match tutorial (game id `battlearena`).
//
//   node tools/read-tips.mjs               every game in any report
//   node tools/read-tips.mjs battlearena   one game
//   --days N                               people seen in the last N days (default 30)
import { firebaseConfig } from '../js/firebase-config.js';
import { signInAnonymously } from '../backups/rtdb-backup.mjs';
import { isHiddenName } from '../js/hidden-players.js';
import { mergeTips } from '../js/tips-log.js';

const only = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || null;
const days = Number(process.argv.find((a, i) => process.argv[i - 1] === '--days') || 30);
const since = Date.now() - days * 86400000;
const tok = await signInAnonymously(firebaseConfig.apiKey);
const id = typeof tok === 'string' ? tok : tok.idToken;
const players = await fetch(`${firebaseConfig.databaseURL}/players.json?auth=${id}`).then((r) => r.json());
const et = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const people = new Map();
const games = new Set();
for (const rec of Object.values(players || {})) {
  const p = (rec && rec.profile) || {};
  const name = String(p.name || '').trim();
  if (!name || isHiddenName(name)) continue;
  const k = p.playerId || name;
  if (!people.has(k)) people.set(k, { name, reps: [], at: 0 });
  const x = people.get(k);
  if (rec.tips) { x.reps.push(rec.tips); for (const g of Object.keys(rec.tips)) games.add(g); }
  x.at = Math.max(x.at, +rec.updatedAt || 0);
}
for (const g of only ? [only] : [...games]) {
  console.log(`\n== ${g}`);
  for (const x of [...people.values()].filter((p) => p.at >= since && p.reps.length).sort((a, b) => a.name.localeCompare(b.name))) {
    const m = mergeTips(x.reps, g);
    const tips = Object.entries(m).sort((a, b) => a[1].s - b[1].s);
    console.log(`${x.name}: ${tips.length ? '' : 'none yet'}`);
    for (const [t, r] of tips) console.log(`   ${t.padEnd(10)} seen ${et(r.s)}${r.n > 1 ? ` (${r.n}x)` : ''}${r.d ? ` · OK ${et(r.d)}` : ''}`);
  }
}
