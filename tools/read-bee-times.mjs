// read-bee-times.mjs - READ ONLY: when each player played Spelling Bee (Matt, 2026-10-26: "Just record
// when he plays"). Reads beeDaily/<puzzle> for the last few days in both languages and prints, per
// player: first word, Genius, last update, and the gaps between words. Words themselves are never
// stored or printed (no spoilers).
//
//   NODE_USE_ENV_PROXY=1 node tools/read-bee-times.mjs [--days 3] [--tz America/New_York] [name]
//
// Times exist only for words found from 2026-10-27 on (spelling-bee/js/ui.js `rec.times`); older rows
// show "-". Times come from each phone's clock.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signInAnonymously, readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { parseData, dayNumber, puzzleAt, puzzleOf, answersFor, totalPoints } from '../spelling-bee/js/engine.js';
import { boardKey } from '../spelling-bee/js/board.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const DAYS = Number(opt('--days', 3));
const TZ = opt('--tz', 'America/New_York');
const who = (args[0] || '').toLowerCase();
const fmt = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '-');
const mins = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? `${Math.round((b - a) / 60000)} min` : '-');

const tok = await signInAnonymously(firebaseConfig.apiKey);
for (const [file, label] of [['bee.json', 'English'], ['bee-es.json', 'Spanish']]) {
  const data = parseData(JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../spelling-bee/data/${file}`, import.meta.url)), 'utf8')));
  const today = dayNumber(data.epoch, new Date());
  for (let n = today; n > today - DAYS && n >= 0; n--) {
    const keys = [puzzleAt(data, n).key];
    if (data.retired[n]) keys.push(puzzleOf(data.retired[n], data.lang).key);
    for (const key of keys) {
      const rows = await readPath(firebaseConfig.databaseURL, `beeDaily/${boardKey(key)}`, tok).catch(() => null);
      if (!rows) continue;
      const p = puzzleAt(data, n);
      console.log(`\n${label}, day ${n}${key !== p.key ? ' (old puzzle)' : ''}: ${totalPoints(answersFor(data, p), p)} points possible`);
      for (const [code, r] of Object.entries(rows)) {
        if (who && !String(r.name || '').toLowerCase().includes(who)) continue;
        const gaps = String(r.ts || '').split(',').filter(Boolean).map(Number);
        const steps = gaps.slice(1).map((g, i) => g - gaps[i]).sort((a, b) => a - b);
        const med = steps.length ? steps[steps.length >> 1] : null;
        const quick = steps.filter((s) => s < 3).length;
        console.log(`  ${r.name} (${code}): ${r.words} words, ${r.points} pts`);
        console.log(`    first word ${fmt(r.t0)} | Genius ${fmt(r.tg)} (${mins(r.t0, r.tg)} in) | last update ${fmt(r.at)}`);
        if (steps.length) console.log(`    ${gaps.length} timed words; median gap ${med}s; gaps under 3s: ${quick}`);
      }
    }
  }
}
