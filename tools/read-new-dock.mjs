// tools/read-new-dock.mjs - who has seen the launcher's "New game" bubble (2026-11-13). Read-only. Every phone
// mirrors js/new-dock-log.js's report as players/<id>/newDock on each sync; this merges it per person (all their
// devices) for each game, times in Eastern. Phones on a build before v1548 have no report yet.
//
//   node tools/read-new-dock.mjs            every game in any report
//   node tools/read-new-dock.mjs tower      one game
import { firebaseConfig } from '../js/firebase-config.js';
import { signInAnonymously } from '../backups/rtdb-backup.mjs';
import { isHiddenName } from '../js/hidden-players.js';
import { mergeNewDock } from '../js/new-dock-log.js';

const only = process.argv[2] || null;
const tok = await signInAnonymously(firebaseConfig.apiKey);
const id = typeof tok === 'string' ? tok : tok.idToken;
const players = await fetch(`${firebaseConfig.databaseURL}/players.json?auth=${id}`).then((r) => r.json());
const et = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const people = new Map();
const games = new Set();
for (const [dev, rec] of Object.entries(players || {})) {
  const p = (rec && rec.profile) || {};
  const name = String(p.name || '').trim();
  if (!name || isHiddenName(name)) continue;
  const k = p.playerId || name;
  if (!people.has(k)) people.set(k, { name, reps: [], build: '' });
  const x = people.get(k);
  if (rec.newDock) { x.reps.push(rec.newDock); for (const kind of Object.values(rec.newDock)) for (const g of Object.keys(kind || {})) games.add(g); }
  const b = String((rec.device || {}).build || '');
  if (b > x.build) x.build = b;
}
for (const g of only ? [only] : [...games]) {
  console.log(`\n== ${g}`);
  for (const x of [...people.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const m = mergeNewDock(x.reps, g);
    const acts = ['tapped', 'closed', 'opened', 'done'].filter((k) => m[k]).map((k) => `${k} ${et(m[k])}`);
    const seen = m.shown ? `seen ${et(m.shown)}${m.n > 1 ? ` (${m.n}x, last ${et(m.last)})` : ''}` : '';
    console.log(`${x.name.padEnd(16)} ${(x.build || '?').padEnd(6)} ${[seen, ...acts].filter(Boolean).join(' · ') || (x.reps.length ? 'not yet' : 'no report yet')}`);
  }
}
