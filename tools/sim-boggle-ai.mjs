// SIMULATION of Boggle's computers (2026-11-16). Real people's scores (from the play log, read once into a JSON
// file by hand: { en: [scores], es: [scores] }) are compared with the computer's score on freshly shaken boards.
// P(win) = chance a real score beats the computer's score on a random gated board (board size not paired).
//   node tools/sim-boggle-ai.mjs <humans.json> [boards=200] [tier=pct ...]   e.g. beginner=0.1 intermediate=0.2
import fs from 'node:fs';
import { buildTrieFromWords } from '../boggle/js/dict.js';
import { DICE, DICE_ES, parseDiceFaces } from '../boggle/js/game.js';
import { shakePlayableBoard, BOARD_QUALITY, BOARD_QUALITY_ES } from '../boggle/js/solver.js';
import { selectAiWords, totalScore, tierPctFor } from '../boggle/js/ai.js';

const humans = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const N = Number(process.argv[3] || 200);
const over = {};
for (const a of process.argv.slice(4)) { const [k, v] = a.split('='); over[k] = Number(v); }

for (const lang of ['en', 'es']) {
  const words = fs.readFileSync(new URL(`../boggle/data/${lang === 'en' ? 'words.txt' : 'words-es.txt'}`, import.meta.url), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
  const root = buildTrieFromWords(words);
  const boards = [];
  for (let i = 0; i < N; i++) boards.push(shakePlayableBoard(root, Math.random, lang === 'en' ? BOARD_QUALITY : BOARD_QUALITY_ES, parseDiceFaces(lang === 'en' ? DICE : DICE_ES)).solved);
  const H = humans[lang];
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`${lang}: ${H.length} human scores, mean ${mean(H).toFixed(1)}, median ${H.slice().sort((a, b) => a - b)[H.length >> 1]}`);
  if (process.env.SOLVE) {   // find the share of the board that gives each target win rate
    const target = { beginner: 0.5, intermediate: 0.25, pro: 0.10 };
    for (const tier of ['beginner', 'intermediate', 'pro']) {
      let best = null;
      for (let pct = 0.03; pct <= 0.8; pct += 0.01) {
        const ai = [];
        for (const solved of boards) ai.push(totalScore(selectAiWords(solved, tier, Math.random, lang, pct)));
        let w = 0;
        for (const h of H) for (const a of ai) if (h > a) w++;
        const rate = w / (H.length * ai.length);
        if (!best || Math.abs(rate - target[tier]) < Math.abs(best.rate - target[tier])) best = { pct: +pct.toFixed(2), rate, avg: mean(ai) };
      }
      console.log(`  ${tier}: pct ${best.pct} -> computer avg ${best.avg.toFixed(0)}, simulated win ${(100 * best.rate).toFixed(0)}%`);
    }
    continue;
  }
  for (const tier of ['beginner', 'intermediate', 'pro']) {
    const pct = over[`${lang}.${tier}`] ?? over[tier] ?? tierPctFor(lang)[tier];
    const ai = [];
    for (const solved of boards) for (let r = 0; r < 5; r++) ai.push(totalScore(selectAiWords(solved, tier, Math.random, lang, pct)));
    let w = 0, n = 0;
    for (const h of H) for (const a of ai) { n++; if (h > a) w += 1; else if (h === a) w += 0; }
    console.log(`  ${tier.padEnd(12)} pct ${pct}  computer avg ${mean(ai).toFixed(0)}  simulated win ${(100 * w / n).toFixed(0)}%`);
  }
}
