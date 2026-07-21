// run-all-tests.mjs - runs every node test in the repo, exit-code aggregated.
// Run: node run-all-tests.mjs        (Node >= 22.7, no dependencies)
//
// KNOWN-RED note: test-mp-lockstep.mjs currently carries seven [KNOWN-BUG PROBE]
// failures - intended-behavior assertions for real multiplayer defects found when the
// tripwire suite was written (guest match-end deadlock, stale presetStockResets,
// recovery seat-swap, restore off-by-one / initMatch wipe). Each probe's failure
// message names the mechanism and file:line. They stay red until the product bugs are
// fixed; every other suite is expected green. See the probe messages before assuming
// a regression.
//
// smoke-match.mjs / smoke-ui.mjs need jsdom (an external package this repo otherwise
// does not depend on); they are SKIPPED, not failed, when jsdom isn't installed.

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
  // shared-module suites
  { file: 'players-agg.test.mjs' },
  { file: 'validate-sw-assets.mjs' },
  // tripwire suites (integration layer)
  { file: 'test-recorder-contract.mjs' },
  { file: 'test-stats-replay.mjs' },
  { file: 'test-mp-lockstep.mjs', knownRed: 'carries [KNOWN-BUG PROBE] assertions for open MP defects' },
  // jsdom-dependent smoke suites (optional)
  { file: 'smoke-match.mjs', optionalDep: 'jsdom' },
  { file: 'smoke-ui.mjs', optionalDep: 'jsdom' },
];

let failures = 0, ran = 0, skipped = 0;
for (const suite of SUITES) {
  const label = suite.file + (suite.knownRed ? `   (known-red: ${suite.knownRed})` : '');
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(process.execPath, [join(ROOT, suite.file)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const out = (res.stdout || '') + (res.stderr || '');
  if (suite.optionalDep && /Cannot find (package|module) '?jsdom/.test(out)) {
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
if (failures) console.log('(if the only failure is test-mp-lockstep.mjs, check whether every FAIL line is a [KNOWN-BUG PROBE] - those are open product bugs, not test regressions)');
process.exit(failures ? 1 : 0);
