// read-ww-daily.mjs - READ ONLY: Word Weaver's daily puzzle board (2026-11-02, word-weaver/js/board.js). Reads
// wwDaily/<lang>-<YYYY-MM-DD> for the last few days in both languages and prints the board as the game orders it
// (most stars, fewest hints, fastest), with each player's first open and post time. No words are stored or printed.
//
//   NODE_USE_ENV_PROXY=1 node tools/read-ww-daily.mjs [--days 3] [--tz America/New_York] [name]
//
// Times: `o` = the server's time of the player's first open of that puzzle, `at` = their last post, both server
// time; `sec` = the solve time the phone measured (first open to the last word, time away counted).

import { signInAnonymously, readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { rowsOf, fmtSec } from '../word-weaver/js/board.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const DAYS = Number(opt('--days', 3));
const TZ = opt('--tz', 'America/New_York');
const who = (args[0] || '').toLowerCase();
const fmt = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
const p2 = (n) => String(n).padStart(2, '0');

const tok = await signInAnonymously(firebaseConfig.apiKey);
for (let i = 0; i < DAYS; i++) {
  const d = new Date(Date.now() - i * 86400000);
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  for (const lang of ['en', 'es']) {
    const key = `${lang}-${day}`;
    const raw = (await readPath(firebaseConfig.databaseURL, `wwDaily/${key}`, tok).catch(() => null)) || {};
    if (!Object.keys(raw).length) continue;
    console.log(`\n${lang === 'es' ? 'Spanish' : 'English'}, ${day}`);
    // rowsOf hides test accounts, as the game does; the raw node is printed only for what it shows.
    for (const r of rowsOf(raw)) {
      if (who && !r.name.toLowerCase().includes(who)) continue;
      const v = raw[r.code] || {};
      const res = r.done ? `${'*'.repeat(r.stars)}${'.'.repeat(3 - r.stars)}  ${r.hints} hint${r.hints === 1 ? '' : 's'}  ${fmtSec(r.sec)}` : 'playing';
      console.log(`  ${r.name.padEnd(16)} ${res.padEnd(28)} opened ${fmt(Number(v.o))}, posted ${fmt(Number(v.at))}`);
    }
  }
}
