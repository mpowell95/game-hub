// tools/read-new-prices.mjs - READ ONLY: who moves on each wins board under the NEW prices (js/lb-points.js `NEW`,
// docs/HANDOFF-WINS-GAMES-FIXES.md), before vs after, from the live server-built board. Writes nothing anywhere.
//   NODE_USE_ENV_PROXY=1 node tools/read-new-prices.mjs [game id ...]
// Needs the reader key (GAMEHUB_READER). Names only, never a code. Hidden test names, nameless devices and test1 left out.
// Places: points high to low, a tie to fewer wins (the better average), as the board.
import zlib from 'node:zlib';
import { signInForReading } from './reader-auth.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { boardList } from '../js/stats-net.js';
import { isHiddenName } from '../js/hidden-players.js';
import { isPlaceholderName } from '../js/players-agg.js';
import { gamePoints, setNewPrices } from '../js/lb-points.js';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['airhockey', 'connect4', 'darts', 'cuppong', 'business', 'dotsboxes'];
const { idToken } = await signInForReading();
const res = await fetch(`${firebaseConfig.databaseURL}/boards/v1/lb/z.json?auth=${idToken}`);
if (!res.ok) { console.error(`Could not read the board (${res.status}).`); process.exit(1); }
const parts = JSON.parse(zlib.gunzipSync(Buffer.from(await res.json(), 'base64')).toString('utf8'));
const people = boardList(parts).list.filter((p) => !isPlaceholderName(p.name) && !isHiddenName(p.name) && p.playerId !== 'DREG5' && !/^guest$/i.test(p.name));
const MEDAL = ['', 'gold', 'silver', 'bronze'];
for (const id of ids) {
  const rows = [];
  for (const p of people) {
    const g = p.games && p.games[id];
    if (!g || !g.total || !g.total.won) continue;
    setNewPrices(false); const a = gamePoints(g, id, null, p.playerId);
    setNewPrices(true); const b = gamePoints(g, id, null, p.playerId);
    rows.push({ who: p.name, a: a.pts, b: b.pts, wa: a.wins, wb: b.wins });
  }
  const place = (k, w) => { const s = [...rows].sort((x, y) => y[k] - x[k] || x[w] - y[w]); s.forEach((r, i) => { r[k + 'p'] = i + 1; }); };
  place('a', 'wa'); place('b', 'wb');
  console.log(`\n${id}`);
  for (const r of rows.sort((x, y) => x.bp - y.bp)) {
    const moved = r.ap !== r.bp ? `  place ${r.ap} -> ${r.bp}` : '';
    const medal = r.ap <= 3 || r.bp <= 3 ? `  (${MEDAL[r.ap] || '-'} -> ${MEDAL[r.bp] || '-'})` : '';
    console.log(`  ${String(r.bp).padStart(2)}. ${r.who.padEnd(18)} ${String(r.a).padStart(5)} -> ${String(r.b).padStart(5)}${moved}${r.ap !== r.bp ? medal : ''}`);
  }
}
setNewPrices(null);
