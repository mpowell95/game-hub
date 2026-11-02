// tools/read-arrow-pace.mjs - READ ONLY: Arrow Maze POINTS PER MINUTE, per person and per difficulty (2026-11-02,
// Matt: "Keep track and log everyone's games so we can revisit when we have more data", after Expert went to 8).
// Every timed finish is already logged on each record (`wo.log[band]`: t = ms with penalties, m/h = hearts lost and
// hints, l = level, g = board generator, d = when); this reads them and prints, for TODAY'S boards by default
// (Easy and Medium every board, Hard generator 11, Expert generator 10):
//   levels, average time, clean average (no slips), points per minute as earned, and clean points per minute.
// Points are what each finish earned under the table of its time (js/arrow-maze-time.js woEarnedPoints).
//
//   NODE_USE_ENV_PROXY=1 node tools/read-arrow-pace.mjs [--all] [--since YYYY-MM-DD]
//     --all    every board generator, each on its own line (old boards included)
//     --since  only finishes from that day (Eastern) on
import { readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { signInForReading } from './reader-auth.mjs';
import { woList, woEarnedPoints, WO_TIERS } from '../js/arrow-maze-time.js';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const si = args.indexOf('--since');
const SINCE = si >= 0 ? Date.parse(`${args[si + 1]}T00:00:00-05:00`) : 0;
const TODAY = { easy: () => true, medium: () => true, hard: (f) => f.g === 11, expert: (f) => f.g === 10 };

const { idToken } = await signInForReading();
const players = await readPath(firebaseConfig.databaseURL, 'players', idToken);
// One row per person (player code, else name); a person's devices' logs are pooled.
const people = new Map();
for (const p of Object.values(players || {})) {
  const w = p && p.stats && p.stats.games && p.stats.games.wayout;
  if (!w || !w.wo || !w.wo.log) continue;
  const name = (p.profile && p.profile.name) || '?';
  if (/^(test|zzz)/i.test(name)) continue;
  const key = (p.profile && p.profile.playerId) || name;
  if (!people.has(key)) people.set(key, { name, rows: {} });
  const P = people.get(key);
  for (const band of WO_TIERS) {
    for (const f of woList(w.wo.log[band])) {
      if (SINCE && !(f.d >= SINCE)) continue;
      if (!ALL && !TODAY[band](f)) continue;
      const k = ALL ? `${band} g${f.g || '?'}` : band;
      (P.rows[k] = P.rows[k] || []).push({ band, ...f });
    }
  }
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const slipsOf = (f) => Math.max((f.m | 0) + (f.h | 0), f.s | 0);
function line(label, L) {
  const sec = L.reduce((s, f) => s + f.t / 1000, 0);
  const pts = L.reduce((s, f) => s + woEarnedPoints(f.band, slipsOf(f), f.g, f.d), 0);
  const C = L.filter((f) => !slipsOf(f));
  const cs = C.reduce((s, f) => s + f.t / 1000, 0);
  const cp = C.reduce((s, f) => s + woEarnedPoints(f.band, 0, f.g, f.d), 0);
  return `  ${label.padEnd(14)} ${String(L.length).padStart(4)} levels  avg ${clock(sec / L.length)}  clean ${C.length ? clock(cs / C.length) : '-'} (${C.length})`
    + `  pts/min ${(pts / (sec / 60)).toFixed(1)}  clean ${C.length ? (cp / (cs / 60)).toFixed(1) : '-'}`;
}
console.log(`Arrow Maze pace${ALL ? ' (every board)' : " (today's boards: Hard generator 11, Expert generator 10)"}${SINCE ? `, since ${args[si + 1]}` : ''}`);
const pooled = {};
for (const P of [...people.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const keys = Object.keys(P.rows).sort();
  if (!keys.length) continue;
  console.log(`\n${P.name}`);
  for (const k of keys) { console.log(line(k, P.rows[k])); (pooled[k] = pooled[k] || []).push(...P.rows[k]); }
}
console.log('\nEVERYONE');
for (const k of Object.keys(pooled).sort()) console.log(line(k, pooled[k]));
