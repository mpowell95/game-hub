// test-automation-guard.mjs - TEST AUTOMATION NEVER WRITES (js/automation.js; Matt, 2026-10-29: "make it so the app
// lets test automations play anything and always ignore their scores/rounds etc"). Run: node tools/test-automation-guard.mjs
//
// Pretends to be a WebDriver browser (navigator.webdriver = true) on the LIVE site's hostname, with the dev write
// override switched ON, so the automation guard is the only thing that can say no. No network is reached: every
// writer must refuse before it boots Firebase. Then the same calls with webdriver false must NOT be refused by it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } };

const store = new Map([['gamehub.devAllowSync.v1', '1']]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
Object.defineProperty(globalThis, 'location', { value: { hostname: 'mpowell95.github.io', origin: 'https://mpowell95.github.io', href: 'https://mpowell95.github.io/game-hub/' }, configurable: true });
let driven = true;
Object.defineProperty(globalThis, 'navigator', { value: { get webdriver() { return driven; }, userAgent: 'HeadlessChrome' }, configurable: true });
let fetched = 0;
globalThis.fetch = async () => { fetched++; throw new Error('no network in this test'); };

const A = await import('../js/automation.js');
ok('webdriver = automation', A.isAutomation() === true);
const N = await import('../js/stats-net.js');
ok('stats-net writesAllowed refuses (stats sync, names, Spelling Bee, challenges, careers, play log, chat)', N.writesAllowed('test') === false);
ok('claimUsername refuses (no new player, no "Smokey")', (await N.claimUsername('zzzguard', 'ZZZZ1', '')) === false);
const G = await import('../js/online-gate.js');
ok('no online play', G.onlineGate() === 'not-approved');
const B = await import('../js/bug-report.js');
const br = await B.submitBugReport({ description: 'x' });
ok('no bug report, and not queued', br.ok === false && br.retryable === false && br.reason === 'test automation');
const M = await import('../js/messages.js');
const sm = await M.sendMessage('ZZZZ2', 'hi').catch((e) => ({ threw: e.message }));
ok('no message', sm && sm.ok === false);
const C = await import('../js/admin-config.js');
const ac = await C.setGameLive('snake', true).catch((e) => ({ threw: e.message }));
ok('no admin config write', ac && ac.ok === false);
const CH = await import('../js/challenge/challenge-net.js');
ok('the retired challenge never boots', (await CH.init()) === false);
ok('nothing above reached the network', fetched === 0);

driven = false;
ok('a person\'s browser is not automation', A.isAutomation() === false);
ok('...and the live site still writes for people', N.writesAllowed('test') === true);

// Every module that writes to Firebase goes through a guard that asks js/automation.js.
const GUARDS = /writesAllowed|automationBlocks|navigator\.webdriver/;
const WRITES = /\b_?api\.(set|update|push|runTransaction|remove)\(|\b(set|update|runTransaction)\(\s*(ref|_api\.ref|api\.ref|db\.ref)\(/;
const skip = /\/(vendor|archive|functions|node_modules|tools|data)\//;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!f.startsWith('.')) walk(p); } else if (p.endsWith('.js')) files.push(p); } };
walk(new URL('..', import.meta.url).pathname);
const unguarded = files.filter((p) => !skip.test(p) && WRITES.test(readFileSync(p, 'utf8')) && !GUARDS.test(readFileSync(p, 'utf8')));
// Rooms (js/net.js and the games that write into a room they joined) are guarded by onlineGate before any write.
const ROOMS = /\/(js\/net\.js|holdem\/js\/net-table\.js|[a-z-]+\/js\/(live|net|room)[a-z-]*\.js)$/;
const left = unguarded.filter((p) => !ROOMS.test(p));
ok(`every Firebase writer asks the guard (${left.map((p) => p.split('/game-hub/')[1]).join(', ') || 'all do'})`, left.length === 0);

// The guard is in the offline shell (every writer imports it; tools/validate-sw-assets.mjs did not flag it missing).
ok('js/automation.js is in sw.js ASSETS', /'\.\/js\/automation\.js',/.test(readFileSync(new URL('../sw.js', import.meta.url), 'utf8')));

console.log(`Automation guard tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
