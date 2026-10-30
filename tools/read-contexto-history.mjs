// tools/read-contexto-history.mjs - READ ONLY: every Contexto puzzle each phone has uploaded from its save
// (ctHistory/, js/contexto-history.js, 2026-10-30). Needs the reader key (tools/reader-auth.mjs, env
// GAMEHUB_READER). Answer words are never printed: guesses print as counts.
//
//   NODE_USE_ENV_PROXY=1 node tools/read-contexto-history.mjs            # one line per player: averages
//   NODE_USE_ENV_PROXY=1 node tools/read-contexto-history.mjs <CODE>     # that player's puzzles, one per line
//
// A puzzle on two phones of one person (same lang-n) counts once: the copy with more guesses.
import { readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { signInForReading } from './reader-auth.mjs';

const code = (process.argv[2] || '').toUpperCase();
const CT_EPOCH = Date.UTC(2026, 8, 28);   // contexto/js/engine.js EPOCH: puzzle 1 = Sep 28 2026
const ctDay = (n) => new Date(CT_EPOCH + (n - 1) * 86400000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

const { idToken, reader } = await signInForReading();
const U = firebaseConfig.databaseURL;
let all;
try { all = await readPath(U, code ? `ctHistory/${code}` : 'ctHistory', idToken); }
catch (err) { console.error(reader ? err.message : 'No reader key (GAMEHUB_READER): ctHistory is admin-only.'); process.exit(1); }
if (code) all = { [code]: all };
let dir = {}; try { dir = await readPath(U, 'directory', idToken) || {}; } catch { /* names optional */ }

const fmt = (x) => (x == null ? '-' : x.toFixed(1));
for (const [c, devs] of Object.entries(all || {})) {
  const best = new Map();
  for (const puzzles of Object.values(devs || {})) for (const [k, p] of Object.entries(puzzles || {})) {
    const g = Array.isArray(p.g) ? p.g : Object.values(p.g || {});
    const row = { k, n: p.n, l: p.l, d: p.d || null, hints: g.filter((x) => x && x.h).length, typed: g.filter((x) => x && !x.h).length };
    const had = best.get(k);
    if (!had || row.typed + row.hints > had.typed + had.hints) best.set(k, row);
  }
  const rows = [...best.values()].sort((a, b) => a.l.localeCompare(b.l) || a.n - b.n);
  const wins = rows.filter((r) => r.d === 'won'), clean = wins.filter((r) => !r.hints);
  const avg = (list, w) => (list.length ? list.reduce((s, r) => s + r.typed + w * r.hints, 0) / list.length : null);
  const name = (dir[c] && dir[c].name) || c;
  console.log(`${name}: ${rows.length} puzzles, ${wins.length} won, ${rows.filter((r) => r.d === 'gave').length} given up`
    + ` | avg (hint=1) ${fmt(avg(wins, 1))} | avg (hint=10) ${fmt(avg(wins, 10))} | no-hint wins ${clean.length}, avg ${fmt(avg(clean, 0))}`);
  if (code) for (const r of rows) console.log(`  ${r.k}  for ${r.n > 0 ? ctDay(r.n) : '?'}  ${r.d === 'won' ? 'WON' : r.d === 'gave' ? 'GAVE UP' : 'unfinished'}  typed ${r.typed}  hints ${r.hints}`);
}
