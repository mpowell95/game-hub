// read-activity.mjs - Matt-only: WHEN each game is being played, per person, for trends.
//
// Matt (2026-10-11): *"I want trends data. What game has the most traction right now? What game do
// people come back to the most? What do people play once then never again?"* The stats store only
// holds lifetime counters, so game-stats.js now notes when each play happens (`gamehub.activity.v1`,
// mirrored as `players/<id>/activity`: per game { first, last, w: { <Monday YYYY-MM-DD>: plays } }).
//
// NOTHING HERE IS RETROACTIVE. A device only reports activity after it plays a game on a build that
// has this, so the first weeks will look thin. A person with no activity yet is "not seen yet", not
// "stopped playing". Read-only, same no-dependency pattern as read-install-state.mjs.
//
// Usage:
//   node read-activity.mjs            # one row per game, busiest this week first
//   node read-activity.mjs --weeks 8  # how many weeks of plays to show (default 6)
//   node read-activity.mjs --json     # the merged per-person activity

import { firebaseConfig } from './js/firebase-config.js';
import { buildIdentity } from './js/players-agg.js';
import { signInAnonymously, readPath } from './backups/rtdb-backup.mjs';

const args = process.argv.slice(2);
const WEEKS = Math.max(1, +(args[args.indexOf('--weeks') + 1]) || 6);
const DAY = 864e5;

function monday(t) {
  const d = new Date(t); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const token = await signInAnonymously(firebaseConfig.apiKey);
const all = (await readPath(firebaseConfig.databaseURL, 'players', token)) || {};
const ident = buildIdentity(all);

// person -> game -> merged { first, last, w }
const people = new Map();
const names = new Map();
for (const [id, rec] of Object.entries(all)) {
  const act = rec && rec.activity;
  if (!act || typeof act !== 'object') continue;
  const key = ident.keyFor(rec.profile || {}, id);
  const nm = ((rec.profile && rec.profile.name) || '').trim();
  if (nm && !names.has(key)) names.set(key, nm);
  if (/^test/i.test(nm)) continue;
  const p = people.get(key) || new Map(); people.set(key, p);
  for (const [game, a] of Object.entries(act)) {
    if (!a || typeof a !== 'object') continue;
    const m = p.get(game) || { first: Infinity, last: 0, w: {} }; p.set(game, m);
    if (+a.first > 0) m.first = Math.min(m.first, +a.first);
    if (+a.last > 0) m.last = Math.max(m.last, +a.last);
    for (const [wk, n] of Object.entries(a.w || {})) m.w[wk] = (m.w[wk] | 0) + (n | 0);
  }
}

if (args.includes('--json')) {
  const out = {};
  for (const [k, p] of people) out[names.get(k) || k] = Object.fromEntries(p);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const now = Date.now();
const weeks = []; for (let i = WEEKS - 1; i >= 0; i--) weeks.push(monday(now - i * 7 * DAY));
const games = new Map();
for (const [, p] of people) for (const [game, m] of p) {
  const g = games.get(game) || { people: 0, d7: 0, d30: 0, back: 0, gone: 0, w: {} }; games.set(game, g);
  g.people++;
  if (now - m.last < 7 * DAY) g.d7++;
  if (now - m.last < 30 * DAY) g.d30++;
  const active = Object.keys(m.w).filter((k) => m.w[k] > 0).length;
  if (active >= 2) g.back++;
  // Played in one week only, and not in the last 14 days: tried it and left.
  else if (now - m.last > 14 * DAY) g.gone++;
  for (const wk of weeks) g.w[wk] = (g.w[wk] | 0) + (m.w[wk] | 0);
}

console.log(`${people.size} people with activity so far (tracking started 2026-10-11; nothing before that).\n`);
const rows = [...games].sort((a, b) => (b[1].w[weeks.at(-1)] - a[1].w[weeks.at(-1)]) || (b[1].d7 - a[1].d7));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('game', 13) + pad('people', 8) + pad('7d', 5) + pad('30d', 5) + pad('came back', 11) + pad('left', 6)
  + 'plays per week ' + weeks.map((w) => w.slice(5)).join(' '));
for (const [game, g] of rows) {
  console.log(pad(game, 13) + pad(g.people, 8) + pad(g.d7, 5) + pad(g.d30, 5) + pad(g.back, 11) + pad(g.gone, 6)
    + '               ' + weeks.map((w) => String(g.w[w]).padStart(5)).join(' '));
}
console.log('\n7d / 30d = people who played it in the last 7 / 30 days. came back = played it in 2+ different');
console.log('weeks. left = played it in one week only and not in the last 14 days.');
