import { fileURLToPath as __toolsF2P } from 'node:url';
// read-minesweeper.mjs - Matt-only, READ-ONLY. Minesweeper per person: games and wins per level,
// WHY each lost board was lost (since 2026-10-15), best % cleared, and no-guess test rounds.
// It reads players/ and writes nothing.
//
//   node tools/read-minesweeper.mjs
//
// Loss reasons (minesweeper/js/engine.js lossCause), judged from what the player could see:
//   slip    - provably a mine, with a provably safe square right beside it (a finger slip?)
//   misread - provably a mine, nothing safe beside it
//   rushed  - a guess, while a provably safe square was on the board
//   forced  - a guess the board demanded (no safe square anywhere)
//   chord   - a chord opened it, so a flag was wrong
//   unknown - the logic ran out of time on a tangled board
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
import { firebaseConfig } from '../js/firebase-config.js';
import { buildIdentity } from '../js/players-agg.js';
import { signInAnonymously, readPath } from '../backups/rtdb-backup.mjs';
void __ROOT_DIR;

const LV = ['easy', 'medium', 'hard', 'expert'];
const CAUSES = ['slip', 'misread', 'rushed', 'forced', 'chord', 'unknown'];
const token = await signInAnonymously(firebaseConfig.apiKey);
const all = (await readPath(firebaseConfig.databaseURL, 'players', token)) || {};
const ident = buildIdentity(all);
const people = new Map();
for (const [id, rec] of Object.entries(all)) {
  const g = rec && rec.stats && rec.stats.games && rec.stats.games.minesweeper;
  if (!g || !g.total) continue;
  const nm = ((rec.profile && rec.profile.name) || '').trim();
  if (/^test/i.test(nm)) continue;
  const key = ident.keyFor(rec.profile || {}, id);
  const p = people.get(key) || { name: nm || key, top: -1, lv: {}, loss: {}, best: {}, pct: {}, prac: {} };
  people.set(key, p);
  // Shown under the name of the record that holds the most Minesweeper plays: a person's devices
  // can carry older names (js/CLAUDE.md, "A code's name is its NEWEST record's name").
  if ((g.total.played | 0) > p.top && nm) { p.top = g.total.played | 0; p.name = nm; }
  for (const l of LV) {
    const b = (g.byDiff || {})[l]; if (b) { const q = p.lv[l] || (p.lv[l] = { played: 0, won: 0 }); q.played += b.played | 0; q.won += b.won | 0; }
    const ms = g.ms || {};
    const lb = (ms.lossBy || {})[l]; if (lb) { const q = p.loss[l] || (p.loss[l] = {}); for (const c of CAUSES) q[c] = (q[c] | 0) + (lb[c] | 0); }
    const t = (ms.bestTimeMs || {})[l] | 0; if (t > 0) p.best[l] = p.best[l] ? Math.min(p.best[l], t) : t;
    const pc = (ms.bestClearedPct || {})[l] | 0; if (pc > 0) p.pct[l] = Math.max(p.pct[l] | 0, pc);
    const pr = (ms.practice || {})[l]; if (pr) { const q = p.prac[l] || (p.prac[l] = { played: 0, won: 0 }); q.played += pr.played | 0; q.won += pr.won | 0; }
  }
}
const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const total = {};
for (const p of [...people.values()].filter((x) => Object.keys(x.lv).length || Object.keys(x.prac).length).sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`\n${p.name}`);
  for (const l of LV) {
    const q = p.lv[l], lb = p.loss[l], pr = p.prac[l];
    if (!q && !pr) continue;
    p.shown = true;
    const why = lb ? CAUSES.filter((c) => lb[c]).map((c) => `${c} ${lb[c]}`).join(', ') : '';
    if (lb) { const t = total[l] || (total[l] = {}); for (const c of CAUSES) t[c] = (t[c] | 0) + (lb[c] | 0); }
    console.log(`  ${l.padEnd(6)} ${q ? `${q.won}/${q.played} won` : '-'}${p.best[l] ? `, best ${fmt(p.best[l])}` : ''}${p.pct[l] ? `, closest ${p.pct[l]}%` : ''}${why ? ` | losses since 15 Oct: ${why}` : ''}${pr ? ` | no-guess test ${pr.won}/${pr.played}` : ''}`);
  }
}
console.log('\nLoss reasons, everyone (since 2026-10-15):');
for (const l of LV) if (total[l]) console.log(`  ${l.padEnd(6)} ${CAUSES.filter((c) => total[l][c]).map((c) => `${c} ${total[l][c]}`).join(', ')}`);
