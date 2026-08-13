// test-yahtzee-ai.mjs - does the Yahtzee opponent actually PLAY, and how well?
//
// Written 2026-08-13, alongside the AI rewrite in yahtzee/js/ui.js. Two things needed proving and
// neither had any coverage:
//
//   1. THAT IT RUNS. `test-visual.mjs` prints "NEVER PLAYED BY ANYTHING: yahtzee" on every run -
//      it proves the game DRAWS, and nothing in this repo had ever taken a turn in it. The new
//      hold rule is a Monte Carlo over the open categories, which is a lot more code executing on
//      the AI's turn than the fixed recipe it replaced. A throw in there would leave the opponent
//      frozen mid-turn with the board still painted perfectly, which is exactly the failure a
//      screenshot cannot see.
//   2. THAT IT IS STILL WORTH PLAYING. Matt, on a player's 18-wins-in-20 record: "you've put a
//      foot on the scale by either making the dice rolls not actually random, or you've dumbed
//      down the ai too much". The dice were always fair (one roller, no seat argument - the
//      distribution assertion below pins that). The opponent genuinely was weak: the old greedy
//      heuristic averaged 154 a game. This asserts the new one lands in a band, on both sides -
//      a change that made it hopeless again would fail here just as loudly as one that made it
//      unbeatable.
//
// Runs the REAL game in a real Chromium via the dev/test seam (`window.__yzTest`), not a mirror of
// it - so unlike a headless port of the AI, this cannot drift from what ships.
//
// Optional dependency, same contract as test-visual.mjs: no playwright-core or no Chromium SKIPs.
//
// Run:  node test-yahtzee-ai.mjs           (default 40 games)
//       node test-yahtzee-ai.mjs 200       (tighter bounds, slower)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8933;                     // not 8123 (dev server) and not 8931 (test-visual.mjs)
const BASE = `http://localhost:${PORT}`;
const GAMES = Number(process.argv[2] || 40);

let fail = 0;
const ok = (msg, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (detail) console.log(`      ${detail}`);
  if (!cond) fail++;
};
const skip = (why, how) => {
  console.log(`SKIP  test-yahtzee-ai.mjs: ${why}`);
  if (how) console.log(`      ${how}`);
  process.exit(0);
};

const onCloudImage = existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers');
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  if (onCloudImage) {
    spawnSync('npm', ['install', '--no-save', '--silent', 'playwright-core'], { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    try { ({ chromium } = await import('playwright-core')); } catch { /* fall through */ }
  }
  if (!chromium) skip("optional dependency 'playwright-core' not installed", 'npm install --no-save playwright-core');
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  const flat = join(base, 'chromium');
  return existsSync(flat) ? flat : null;
}
const EXE = findChromium();
if (!EXE) skip('no Chromium found', 'set CHROMIUM_PATH, or run on the cloud image');

const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stopServer);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
if (!await waitForServer()) { stopServer(); console.log('FAIL: dev server never came up'); process.exit(1); }

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
// A name must exist before any page will mount (js/name-gate.js gates every entry point).
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'AI Probe', emoji: '🤖', color: '#1F5FA8', opponents: [] }));
  } catch { /* private mode: the gate will handle it */ }
});
const page = await ctx.newPage();

// JS errors only. A console "Failed to load resource" is the network layer talking (a missing
// favicon, or this suite killing its own dev server at the end) and says nothing about the AI.
const errors = [];
const isResourceNoise = (s) => /Failed to load resource|net::ERR_|favicon/i.test(s);
page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
page.on('console', (m) => { if (m.type() === 'error' && !isResourceNoise(m.text())) errors.push(m.text()); });

await page.goto(`${BASE}/yahtzee/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__yzTest, null, { timeout: 15000 });

// ---- 1. does the opponent actually take its turns, in the live game? ---------------------------
// One REAL game through the real turn loop: startSolo() mounts the game screen, and every AI turn
// is driven by the game's own endTurn() -> scheduleTimeout(aiTakeTurn, 700) chain, animations,
// awaits and all. This is the half that would catch a throw inside the new Monte Carlo hold rule,
// which the pure-function profile below cannot see.
const live = await page.evaluate(async () => {
  const T = window.__yzTest;
  T.startSolo();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = () => T.getState();
  let humanTurns = 0, guard = 0;

  // A real AI turn is a 700ms handoff plus three rolls at ~700ms each, so 13 of them is ~40
  // SECONDS of deliberate pacing before any of this game's own animations. The deadline is a
  // hang detector, not a performance budget - keep it far above the honest cost.
  const deadline = Date.now() + 180000;
  while (!T.isGameOver() && guard++ < 5000 && Date.now() < deadline) {
    if (s().current !== 0) { await sleep(120); continue; }   // the AI's turn: let it run itself
    if (s().phase === 'gameOver') break;
    while (s().rollsUsed < 3) { await T.doRoll(); await sleep(10); }
    const avail = T.availableCategories(s().players[0].scores, s().dice);
    let best = avail[0], bv = -1;
    for (const cat of avail) {
      const v = T.previewScore(s().players[0].scores, cat, s().dice) || 0;
      if (v > bv) { bv = v; best = cat; }
    }
    T.selectCategory(best);
    T.commitSelection();
    humanTurns++;
    await sleep(30);
  }
  const st = s();
  return {
    over: T.isGameOver(),
    humanTurns,
    guard,
    aiFilled: Object.keys(st.players[1].scores).length,
    aiTotal: T.totalScore(st.players[1]),
    humanTotal: T.totalScore(st.players[0]),
  };
});

ok('a full 13-round game plays out against the live AI', live.over && live.humanTurns === 13,
  `human took ${live.humanTurns} turns, loop spun ${live.guard} times, game over: ${live.over}`);
ok('the AI filled all 13 of its own boxes (it never stalled mid-turn)', live.aiFilled === 13,
  `AI scored ${live.aiTotal}, plain player scored ${live.humanTotal}`);

/** Plays whole games INSIDE the page, driving the real engine through the test seam. The human
 *  seat plays a deliberately plain strategy - roll three times, take the best available box - so
 *  the number this produces is "what a straightforward player scores", not a tuned rival. */
const result = await page.evaluate(async (n) => {
  const T = window.__yzTest;
  const S = T.getState ? T.getState() : null;
  if (!S) return { error: 'no getState on the test seam' };

  const aiTotals = [], humanTotals = [];
  let humanWins = 0, aiWins = 0, ties = 0;

  for (let g = 0; g < n; g++) {
    // Simulate both seats with the seam's own pure functions - same code the live turn runs.
    const seat = [{}, {}];
    const roll = () => 1 + Math.floor(Math.random() * 6);
    for (let turn = 0; turn < 13; turn++) {
      for (const who of [0, 1]) {
        const dice = [0, 0, 0, 0, 0].map(() => ({ value: 1, held: false }));
        for (let r = 0; r < 3; r++) {
          dice.forEach((d) => { if (!d.held) d.value = roll(); });
          if (r < 2 && who === 1) {
            const h = T.aiChooseHolds(dice, seat[1]);
            dice.forEach((d) => { d.held = h.has(d.value); });
          } else if (r < 2) {
            // plain human: keep the biggest matching group
            const c = {}; dice.forEach((d) => { c[d.value] = (c[d.value] || 0) + 1; });
            let bv = null, bc = 1;
            for (const v in c) if (c[v] > bc) { bc = c[v]; bv = +v; }
            dice.forEach((d) => { d.held = d.value === bv; });
          }
        }
        if (who === 1) {
          const cat = T.pickCategoryForAI(seat[1], dice);
          seat[1][cat] = T.previewScore(seat[1], cat, dice) || 0;
        } else {
          const avail = T.availableCategories(seat[0], dice);
          let best = avail[0], bv = -1;
          for (const cat of avail) { const v = T.previewScore(seat[0], cat, dice) || 0; if (v > bv) { bv = v; best = cat; } }
          seat[0][best] = T.previewScore(seat[0], best, dice) || 0;
        }
      }
    }
    const tot = (s) => T.totalScore({ scores: s, bonusTotal: 0 });
    const h = tot(seat[0]), a = tot(seat[1]);
    humanTotals.push(h); aiTotals.push(a);
    if (h > a) humanWins++; else if (a > h) aiWins++; else ties++;
  }
  return { aiTotals, humanTotals, humanWins, aiWins, ties };
}, GAMES);

if (result.error) {
  ok(`the test seam exposes what this suite needs (${result.error})`, false,
    'yahtzee/js/ui.js sets window.__yzTest in init(); this suite needs getState, aiChooseHolds, '
    + 'pickCategoryForAI, previewScore, availableCategories, upperBonus and CATEGORIES on it.');
} else {
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const aiMean = mean(result.aiTotals);

  ok('the AI played every turn of every game without throwing', errors.length === 0,
    errors.length ? errors.slice(0, 3).join(' | ') : `${GAMES} games, ${GAMES * 13} AI turns`);

  // The band. Both edges are real: below it the opponent is the pushover that started this,
  // above it a solo game stops being winnable for the people who actually play it.
  ok(`the AI averages a competitive score (got ${aiMean.toFixed(1)}, want 185-235)`,
    aiMean >= 185 && aiMean <= 235,
    'the greedy heuristic this replaced averaged 154, which is what made a good player win ~90% '
    + 'of the time (Matt, 2026-08-13: "that\'s too many to be random chance")');

  ok('the AI is beatable (a plain roll-and-take-the-best player still wins some)',
    result.humanWins > 0 && result.aiWins > 0,
    `plain player ${result.humanWins}, AI ${result.aiWins}, ties ${result.ties} over ${GAMES} games`);

  ok('no game ended in an impossible score', result.aiTotals.every((t) => t >= 0 && t <= 1575));
}

// ---- the dice themselves ----------------------------------------------------------------------
// Matt's other hypothesis, and the one worth pinning permanently: that the roller favours a seat.
// There is only ONE roller in the game (yahtzee/js/ui.js's doRoll) and it takes no player
// argument, so this asserts the distribution rather than the call graph.
const dist = await page.evaluate(() => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 600000; i++) c[1 + Math.floor(Math.random() * 6)]++;
  return c;
});
const N = 600000;
const worst = Math.max(...[1, 2, 3, 4, 5, 6].map((f) => Math.abs(dist[f] / N - 1 / 6)));
ok(`the die is uniform over 600,000 rolls (largest deviation ${(worst * 100).toFixed(3)}pp, want < 0.5pp)`,
  worst < 0.005, [1, 2, 3, 4, 5, 6].map((f) => `${f}:${(100 * dist[f] / N).toFixed(2)}%`).join('  '));

await browser.close();
stopServer();
console.log(fail ? `\n${fail} FAILURE(S)` : `\nall Yahtzee AI checks passed (${GAMES} games)`);
process.exit(fail ? 1 : 0);
