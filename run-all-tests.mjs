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
  { file: 'test-mp-lockstep.mjs' },
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
if (failures) console.log('(a red [KNOWN-BUG PROBE] in test-mp-lockstep.mjs means a previously-fixed MP defect has REGRESSED - its failure message names the mechanism and file)');
process.exit(failures ? 1 : 0);
