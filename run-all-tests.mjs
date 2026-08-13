// run-all-tests.mjs - runs every node test in the repo, exit-code aggregated.
// Run: node run-all-tests.mjs        (Node >= 22.7, no dependencies)
//
// ALL suites are expected green. test-mp-lockstep.mjs's [KNOWN-BUG PROBE] assertions
// were born red against five real MP defects (guest match-end deadlock, stale
// presetStockResets, recovery seat-swap, restore off-by-one / initMatch wipe); the
// defects are fixed and the probes now serve as regression tripwires - a red probe
// means one of those bugs came BACK, and its failure message names the mechanism.
//
// smoke-match.mjs / smoke-ui.mjs need jsdom (an external package this repo otherwise
// does not depend on); they are SKIPPED, not failed, when jsdom isn't installed.
//
// test-visual.mjs is the same shape for a different reason: it drives a real Chromium, which
// exists on the cloud image but not on a laptop that hasn't opted in. It is the ONLY suite here
// that can see whether a game rendered - every other one runs in node, which has no layout
// engine. See VISUAL-PROCESS.md.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  // engine suites
  { file: 'chinchon/js/test.js' },
  { file: 'chinchon/js/sim.js' },
  { file: 'escoba/js/test.js' },
  { file: 'connect-four/js/test.js' },
  { file: 'nuts-bolts/js/test.js' },
  { file: 'tic-tac-toe/js/test.js' },
  { file: 'dots-boxes/js/test.js' },
  { file: 'boggle/js/test.js' },
  { file: 'snake/js/test.js' },
  { file: 'uno/js/test.js' },
  { file: 'dominoes/js/test.js' },
  { file: 'hill-climb/js/test.js' },
  { file: 'skeeball/js/test.js' },
  { file: 'skeeball_old/js/test.js' },
  { file: 'test-arcade-scores.mjs' },
  { file: 'battleship/js/test.js' },
  { file: 'pinball/js/test.js' },
  { file: 'pool/js/test-physics.mjs' },
  { file: 'pool/js/test-rules.mjs' },
  // shared-module suites
  { file: 'players-agg.test.mjs' },
  { file: 'test-leaderboard-rank.mjs' },
  { file: 'favorites.test.mjs' },
  { file: 'test-new-badge.mjs' },
  { file: 'test-bug-report.mjs' },
  { file: 'test-i18n-strings.mjs' },
  { file: 'validate-sw-assets.mjs' },
  // validate-sw-assets checks WHICH files sw.js precaches; this one checks HOW it serves them
  // (the two-tier install and the fetch deadline). See its header for why both are needed.
  { file: 'test-sw-strategy.mjs' },
  // The "Adding a game" checklist, enforced rather than merely written down.
  { file: 'test-game-conventions.mjs' },
  // The first suite here that LOOKS at the game. Needs a real browser, so it SKIPs (never
  // fails) without playwright-core/Chromium - same contract as the jsdom suites below.
  { file: 'test-visual.mjs', optionalDep: 'playwright-core' },
  // The only suite that PLAYS a game rather than looking at one: it drives a full 13-round
  // Yahtzee against the live AI, then profiles the opponent's strength on both edges. Same
  // browser contract as test-visual.mjs, so it SKIPs without playwright-core/Chromium.
  { file: 'test-yahtzee-ai.mjs', optionalDep: 'playwright-core' },
  // tripwire suites (integration layer)
  { file: 'test-recorder-contract.mjs' },
  { file: 'test-stats-replay.mjs' },
  { file: 'test-stats-identity.mjs' },
  { file: 'test-mp-lockstep.mjs' },
  { file: 'test-boggle-mp.mjs' },
  // jsdom-dependent smoke suites (optional)
  { file: 'smoke-match.mjs', optionalDep: 'jsdom' },
  { file: 'smoke-ui.mjs', optionalDep: 'jsdom' },
  { file: 'test-dotsboxes-stats.mjs', optionalDep: 'jsdom' },
  { file: 'test-filler-stats.mjs', optionalDep: 'jsdom' },
  { file: 'test-mancala-stats.mjs', optionalDep: 'jsdom' },
];

let failures = 0, ran = 0, skipped = 0;
for (const suite of SUITES) {
  const label = suite.file + (suite.knownRed ? `   (known-red: ${suite.knownRed})` : '');
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(process.execPath, [join(ROOT, suite.file)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const out = (res.stdout || '') + (res.stderr || '');
  if (suite.optionalDep && new RegExp(`Cannot find (package|module) '?${suite.optionalDep}|SKIP  ${suite.file}`).test(out)) {
    skipped++;
    console.log(`SKIP  ${suite.file}: optional dependency '${suite.optionalDep}' not installed`);
    continue;
  }
  process.stdout.write(out);
  ran++;
  if (res.status !== 0) {
    failures++;
    console.log(`>>> ${suite.file} FAILED (exit ${res.status})`);
  }
}

console.log(`\n==================================================`);
console.log(`${ran} suite(s) ran, ${skipped} skipped, ${failures} failed`);
if (failures) console.log('(a red [KNOWN-BUG PROBE] in test-mp-lockstep.mjs means a previously-fixed MP defect has REGRESSED - its failure message names the mechanism and file)');
process.exit(failures ? 1 : 0);
