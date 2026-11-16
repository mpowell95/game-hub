// tools/read-farming.mjs - READ ONLY: the standing FARMING check (2026-11-16, Matt: "Standing check: Yes, please
// build", after docs/WINS-POINTS-REVIEW.md found Air Hockey Medium paying 2 points for a 97% win).
// For every real person, every wins game, every level and every saved option: games, wins, what a win pays, and
// POINTS PER GAME PLAYED (= points for a win x how often that person wins it). Most honest setups pay 0.9 to 1.4.
// It prints every setup with at least MIN games that pays more than LIMIT per game played, and every level a person
// wins 90%+ of the time that is NOT under the 20-point limit. Writes nothing anywhere.
//
//   NODE_USE_ENV_PROXY=1 node tools/read-farming.mjs [--min 20] [--over 1.5] [--all]
//     --min   fewest games for a setup to be listed (default 20)
//     --over  points per game played to flag (default 1.5)
//     --all   every setup with --min games, flagged or not
// Needs the reader key (GAMEHUB_READER). Levels cover every game ever recorded; options only games from 2026-10-30.
// Names only, never a code. Hidden test names, nameless devices and test1 are left out.
import zlib from 'node:zlib';
import { signInForReading } from './reader-auth.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { boardList } from '../js/stats-net.js';
import { isHiddenName } from '../js/hidden-players.js';
import { isPlaceholderName } from '../js/players-agg.js';
import { POINT_GAMES, pointsTable, pointsForWin, parseModeKey, CAP } from '../js/lb-points.js';
import { tierOf } from '../js/difficulty-tiers.js';

const args = process.argv.slice(2);
const num = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && Number.isFinite(+args[i + 1]) ? +args[i + 1] : dflt; };
const MIN = num('--min', 20), LIMIT = num('--over', 1.5), ALL = args.includes('--all');
const TIER = ['', 'easy', 'medium', 'hard', 'expert'], WORD = ['', 'Easy', 'Medium', 'Hard', 'Expert'];

const { idToken } = await signInForReading();
const res = await fetch(`${firebaseConfig.databaseURL}/boards/v1/lb/z.json?auth=${idToken}`);
if (!res.ok) { console.error(`Could not read the board (${res.status}).`); process.exit(1); }
const parts = JSON.parse(zlib.gunzipSync(Buffer.from(await res.json(), 'base64')).toString('utf8'));
const people = boardList(parts).list.filter((p) => !isPlaceholderName(p.name) && !isHiddenName(p.name) && p.playerId !== 'DREG5' && !/^guest$/i.test(p.name));

const rows = [];
for (const p of people) {
  for (const id of POINT_GAMES) {
    const g = p.games && p.games[id];
    if (!g || !g.total || !g.total.played) continue;
    const spec = pointsTable(id), capSet = new Set(spec.cap || []);
    // Every level, all time (byDiff). `fl` records are shown at the level picked; the price below is that level's own.
    for (const [d, b] of Object.entries(g.byDiff || {})) {
      const n = b.played | 0, w = b.won | 0;
      if (n < MIN) continue;
      const t = d === 'mp' ? 0 : tierOf(d);
      const pts = pointsForWin(id, d, null);
      rows.push({ who: p.name, id, what: d === 'mp' ? 'Online' : (WORD[t] || d), n, w, pts, capped: capSet.has(t), since: 'all time' });
    }
    // Every saved option (byMode, from 2026-10-30), priced at the level it was RECORDED at.
    for (const [k, ds] of Object.entries(g.byMode || {})) {
      if (k === '?') continue;
      const m = parseModeKey(k);
      for (const [d, b] of Object.entries(ds || {})) {
        const n = b.played | 0, w = b.won | 0;
        if (n < MIN || d === 'mp') continue;
        const t0 = tierOf(d);
        if (!t0) continue;
        const t = Math.max(1, t0 - (spec.down && spec.down(m) ? 1 : 0));
        const pts = pointsForWin(id, TIER[t], m);
        rows.push({ who: p.name, id, what: `${WORD[t0]} [${k}]`, n, w, pts, capped: capSet.has(t), since: 'Oct 30 on' });
      }
    }
  }
}
for (const r of rows) { r.rate = r.w / r.n; r.ppg = r.rate * r.pts; }
const line = (r) => `  ${r.who.padEnd(18)} ${r.id.padEnd(12)} ${r.what}\n      ${r.w}/${r.n} won (${Math.round(100 * r.rate)}%), ${r.pts} a win = ${r.ppg.toFixed(2)} points per game played${r.capped ? `, under the ${CAP}-point limit` : ''} (${r.since})`;

console.log(`Farming check: ${people.length} people, setups with ${MIN}+ games.\n`);
const rich = rows.filter((r) => !r.capped && r.ppg > LIMIT).sort((a, b) => b.ppg - a.ppg);
console.log(`PAYS OVER ${LIMIT} POINTS PER GAME PLAYED (${rich.length})`);
console.log(rich.length ? rich.map(line).join('\n') : '  none');
const sure = rows.filter((r) => !r.capped && r.rate >= 0.9 && !rich.includes(r)).sort((a, b) => b.n - a.n);
console.log(`\nWON 90%+ OF THE TIME AND NOT UNDER THE ${CAP}-POINT LIMIT (${sure.length})`);
console.log(sure.length ? sure.map(line).join('\n') : '  none');
if (ALL) {
  console.log(`\nEVERY SETUP WITH ${MIN}+ GAMES (${rows.length})`);
  console.log(rows.sort((a, b) => b.ppg - a.ppg).map(line).join('\n'));
}
